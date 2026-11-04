package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

type eventoMensagem struct {
	Tipo     string       `json:"tipo"`
	Mensagem mensagemResp `json:"mensagem"`
}

type eventoLida struct {
	Tipo     string `json:"tipo"`
	Conversa int64  `json:"conversa"`
	Ate      int64  `json:"ate"`
}

type paginaResp struct {
	Mensagens []mensagemResp `json:"mensagens"`
	TemMais   bool           `json:"temMais"`
}

func (c *cena) enviar(chave string, conversa int64, idLocal, texto string) *http.Response {
	return c.a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conversa),
		map[string]string{"idLocal": idLocal, "texto": texto})
}

func (c *cena) pagina(t *testing.T, chave string, conversa int64, query string) paginaResp {
	t.Helper()
	resp := c.a.Pedir(chave, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens%s", conversa, query), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mensagens%s respondeu %d", query, resp.StatusCode)
	}
	return apitest.LerJSON[paginaResp](t, resp)
}

func (c *cena) lida(chave string, conversa int64, corpo any) *http.Response {
	return c.a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/lida", conversa), corpo)
}

// duplaAnaBia cria a conversa a dois da Ana com a Beatriz.
func (c *cena) duplaAnaBia(t *testing.T) int64 {
	t.Helper()
	resp := c.dupla(t, c.kAna, c.bia.ID)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar a dupla respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa.ID
}

// descartarMensagens lê n eventos da conexão e confere que todos são mensagem.
func descartarMensagens(t *testing.T, conn *websocket.Conn, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if ev := apitest.LerEvento[eventoMensagem](t, conn); ev.Tipo != "mensagem" {
			t.Fatalf("evento %d = %q; queria mensagem", i, ev.Tipo)
		}
	}
}

func idsDe(l []mensagemResp) []int64 {
	var ids []int64
	for _, m := range l {
		ids = append(ids, m.ID)
	}
	return ids
}

func TestEnviar_Texto(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)

	resp := c.enviar(c.kAna, conv, "id-1", "Olá, Beatriz")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	m := apitest.LerJSON[struct{ Mensagem mensagemResp }](t, resp).Mensagem
	if m.Tipo != "texto" || m.Texto == nil || *m.Texto != "Olá, Beatriz" || m.Conversa != conv ||
		m.Autor == nil || m.Autor.ID != c.ana.ID || m.CriadaEm != c.a.Relogio.Agora().UnixMilli() ||
		m.IDLocal == nil || *m.IDLocal != "id-1" || m.ID == 0 {
		t.Fatalf("mensagem = %+v", m)
	}

	// Os dois computadores da dupla recebem o evento, também o de quem enviou.
	for nome, conn := range map[string]*websocket.Conn{"Ana": cAna, "Beatriz": cBia} {
		ev := apitest.LerEvento[eventoMensagem](t, conn)
		if ev.Tipo != "mensagem" || ev.Mensagem.ID != m.ID || ev.Mensagem.Texto == nil || *ev.Mensagem.Texto != "Olá, Beatriz" ||
			ev.Mensagem.Autor == nil || ev.Mensagem.Autor.ID != c.ana.ID || ev.Mensagem.CriadaEm != m.CriadaEm {
			t.Fatalf("evento de %s = %+v", nome, ev)
		}
	}
	// Quem não está na conversa não recebe nada.
	apitest.SemEvento(t, cCarlos, 150*time.Millisecond)

	// A conversa passa a ter a mensagem como última, e a Beatriz tem uma não lida.
	l := c.lista(t, c.kBia)
	if len(l) != 1 || l[0].Ultima == nil || l[0].Ultima.ID != m.ID || l[0].NaoLidas != 1 || l[0].AtualizadaEm != m.CriadaEm {
		t.Fatalf("lista da Beatriz = %+v", l)
	}
}

func TestEnviar_QuebraDeLinhaECaracteres(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	resp := c.enviar(c.kAna, conv, "id-q", "linha 1\r\nlinha 2\rlinha 3")
	m := apitest.LerJSON[struct{ Mensagem mensagemResp }](t, resp).Mensagem
	if m.Texto == nil || *m.Texto != "linha 1\nlinha 2\nlinha 3" {
		t.Fatalf("texto = %v", m.Texto)
	}
	// 4.000 pontos de código valem, mesmo com mais bytes que isso.
	if resp := c.enviar(c.kAna, conv, "id-4000", strings.Repeat("😀", 4000)); resp.StatusCode != http.StatusCreated {
		t.Fatalf("4.000 emojis: status %d", resp.StatusCode)
	}
}

func TestEnviar_IdLocalNaoDuplica(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	cBia := c.a.Conectar(c.kBia)

	r1 := c.enviar(c.kAna, conv, "mesmo-id", "primeira")
	if r1.StatusCode != http.StatusCreated {
		t.Fatalf("primeira: status %d", r1.StatusCode)
	}
	m1 := apitest.LerJSON[struct{ Mensagem mensagemResp }](t, r1).Mensagem
	r2 := c.enviar(c.kAna, conv, "mesmo-id", "segunda, que o servidor ignora")
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("segunda: status %d", r2.StatusCode)
	}
	m2 := apitest.LerJSON[struct{ Mensagem mensagemResp }](t, r2).Mensagem
	if m2.ID != m1.ID || m2.Texto == nil || *m2.Texto != "primeira" {
		t.Fatalf("segunda = %+v; queria a mesma que %+v", m2, m1)
	}
	if n := contarMensagens(t, c, conv); n != 1 {
		t.Fatalf("o banco tem %d mensagens; queria 1", n)
	}
	// O evento saiu uma vez só.
	if ev := apitest.LerEvento[eventoMensagem](t, cBia); ev.Mensagem.ID != m1.ID {
		t.Fatalf("evento = %+v", ev)
	}
	apitest.SemEvento(t, cBia, 150*time.Millisecond)

	// Outra pessoa pode usar o mesmo idLocal.
	if r := c.enviar(c.kBia, conv, "mesmo-id", "da Beatriz"); r.StatusCode != http.StatusCreated {
		t.Fatalf("da Beatriz: status %d", r.StatusCode)
	}
}

func contarMensagens(t *testing.T, c *cena, conv int64) int {
	t.Helper()
	var n int
	if err := bancoDe(t, c.a).QueryRow(`SELECT COUNT(*) FROM mensagens WHERE conversa_id = ? AND tipo = 'texto'`, conv).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestEnviar_TextoInvalido(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	for nome, texto := range map[string]string{
		"4.001 caracteres": strings.Repeat("a", 4001),
		"só espaços":       "  ",
		"vazio":            "",
		"controle":         "a\x00b",
	} {
		resp := c.enviar(c.kAna, conv, "id-x", texto)
		if e := esperarErro(t, resp, 400, "invalido"); e.Campo != "texto" {
			t.Fatalf("%s: campo = %q; queria texto", nome, e.Campo)
		}
	}
	// Sem o campo texto, e com o idLocal fora da regra.
	resp := c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv), map[string]string{"idLocal": "id-x"})
	if e := esperarErro(t, resp, 400, "invalido"); e.Campo != "texto" {
		t.Fatalf("sem texto: campo = %q", e.Campo)
	}
	for _, id := range []string{"", "tem espaço", strings.Repeat("a", 65), "acentuação"} {
		if e := esperarErro(t, c.enviar(c.kAna, conv, id, "oi"), 400, "invalido"); e.Campo != "idLocal" {
			t.Fatalf("idLocal %q: campo = %q", id, e.Campo)
		}
	}
	esperarErro(t, c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv), "{não é json"), 400, "invalido")
	// Nada disso gastou o limite nem gravou mensagem.
	if n := contarMensagens(t, c, conv); n != 0 {
		t.Fatalf("o banco tem %d mensagens; queria 0", n)
	}
}

func TestEnviar_Limite(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	for i := 1; i <= 60; i++ {
		if resp := c.enviar(c.kAna, conv, fmt.Sprintf("m%d", i), "oi"); resp.StatusCode != http.StatusCreated {
			t.Fatalf("mensagem %d: status %d", i, resp.StatusCode)
		}
	}
	e := esperarErro(t, c.enviar(c.kAna, conv, "m61", "oi"), 429, "limite")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("esperarSegundos = %d", e.EsperarSegundos)
	}
	// O limite é do computador: o da Beatriz segue livre.
	if resp := c.enviar(c.kBia, conv, "b1", "oi"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("outro computador: status %d", resp.StatusCode)
	}
	// Uma mensagem que não entrou não deixa rastro.
	if n := contarMensagens(t, c, conv); n != 61 {
		t.Fatalf("o banco tem %d mensagens; queria 61", n)
	}
	c.a.Relogio.Avancar(60 * time.Second)
	if resp := c.enviar(c.kAna, conv, "m61", "oi"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("60 s depois: status %d", resp.StatusCode)
	}
}

func TestEnviar_RepetidaNaoGastaLimite(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	if resp := c.enviar(c.kAna, conv, "unica", "oi"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("primeira: status %d", resp.StatusCode)
	}
	for i := 0; i < 100; i++ {
		if resp := c.enviar(c.kAna, conv, "unica", "oi"); resp.StatusCode != http.StatusOK {
			t.Fatalf("repetição %d: status %d", i, resp.StatusCode)
		}
	}
	// Com a mensagem acima, ainda cabem 59.
	for i := 1; i <= 59; i++ {
		if resp := c.enviar(c.kAna, conv, fmt.Sprintf("n%d", i), "oi"); resp.StatusCode != http.StatusCreated {
			t.Fatalf("mensagem %d: status %d", i, resp.StatusCode)
		}
	}
	esperarErro(t, c.enviar(c.kAna, conv, "n60", "oi"), 429, "limite")
}

func TestMensagens_Paginas(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	var ids []int64
	for i := 1; i <= 120; i++ {
		autor := c.ana.ID
		if i%2 == 0 {
			autor = c.bia.ID
		}
		ids = append(ids, texto(t, c.a, conv, autor, fmt.Sprintf("mensagem %d", i)))
	}

	// Sem parâmetros: as 50 mais novas, da 71 à 120, em ordem.
	p := c.pagina(t, c.kAna, conv, "")
	if !p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[70:120]) {
		t.Fatalf("sem parâmetros = %v, temMais %v", idsDe(p.Mensagens), p.TemMais)
	}
	if m := p.Mensagens[0]; m.Texto == nil || *m.Texto != "mensagem 71" || m.Tipo != "texto" || m.Autor == nil || m.Autor.ID != c.ana.ID || m.Conversa != conv {
		t.Fatalf("primeira = %+v", m)
	}
	// antes=71 traz da 21 à 70.
	p = c.pagina(t, c.kAna, conv, fmt.Sprintf("?antes=%d", ids[70]))
	if !p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[20:70]) {
		t.Fatalf("antes=71 = %v, temMais %v", idsDe(p.Mensagens), p.TemMais)
	}
	// antes=21 traz da 1 à 20, e não há mais antigas.
	p = c.pagina(t, c.kAna, conv, fmt.Sprintf("?antes=%d", ids[20]))
	if p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[0:20]) {
		t.Fatalf("antes=21 = %v, temMais %v", idsDe(p.Mensagens), p.TemMais)
	}
	// depois=100 traz da 101 à 120, e não há mais novas.
	p = c.pagina(t, c.kAna, conv, fmt.Sprintf("?depois=%d", ids[99]))
	if p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[100:120]) {
		t.Fatalf("depois=100 = %v, temMais %v", idsDe(p.Mensagens), p.TemMais)
	}
	// depois=10 traz da 11 à 60, e há mais novas.
	p = c.pagina(t, c.kAna, conv, fmt.Sprintf("?depois=%d", ids[9]))
	if !p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[10:60]) {
		t.Fatalf("depois=10 = %v, temMais %v", idsDe(p.Mensagens), p.TemMais)
	}
	// O limite.
	p = c.pagina(t, c.kAna, conv, "?limite=5")
	if !p.TemMais || !slices.Equal(idsDe(p.Mensagens), ids[115:120]) {
		t.Fatalf("limite=5 = %v", idsDe(p.Mensagens))
	}
	p = c.pagina(t, c.kAna, conv, fmt.Sprintf("?limite=50&depois=%d", ids[59]))
	if !p.TemMais || len(p.Mensagens) != 50 || p.Mensagens[0].ID != ids[60] {
		t.Fatalf("limite=50 = %v", idsDe(p.Mensagens))
	}
	// Uma página vazia vem como lista, não como null.
	resp := c.a.Pedir(c.kAna, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens?depois=%d", conv, ids[119]), nil)
	var bruto map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&bruto); err != nil {
		t.Fatal(err)
	}
	if l, ok := bruto["mensagens"].([]any); !ok || len(l) != 0 || bruto["temMais"] != false {
		t.Fatalf("página vazia = %v", bruto)
	}

	for _, q := range []string{"?limite=0", "?limite=51", "?limite=-1", "?limite=abc", "?antes=abc", "?depois=0",
		fmt.Sprintf("?antes=%d&depois=%d", ids[50], ids[10])} {
		resp := c.a.Pedir(c.kAna, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens%s", conv, q), nil)
		esperarErro(t, resp, 400, "invalido")
	}
}

func TestMensagens_DesdeQueEntrou(t *testing.T) {
	c := novaCena(t)
	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	c.a.Relogio.Avancar(time.Minute)
	for i := 1; i <= 3; i++ {
		if resp := c.enviar(c.kAna, g.ID, fmt.Sprintf("antes-%d", i), fmt.Sprintf("antes %d", i)); resp.StatusCode != http.StatusCreated {
			t.Fatalf("mensagem %d: status %d", i, resp.StatusCode)
		}
	}
	c.a.Relogio.Avancar(time.Minute)
	if resp := c.pôr(c.kAna, g.ID, c.carlos.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr o Carlos: status %d", resp.StatusCode)
	}
	c.a.Relogio.Avancar(time.Minute)
	if resp := c.enviar(c.kBia, g.ID, "depois-1", "depois da entrada"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("depois: status %d", resp.StatusCode)
	}

	// A Beatriz, que estava desde o começo, vê tudo: criou, pos, 3 mensagens, pos, 1 mensagem.
	if p := c.pagina(t, c.kBia, g.ID, ""); len(p.Mensagens) != 7 {
		t.Fatalf("Beatriz vê %d mensagens; queria 7", len(p.Mensagens))
	}
	// O Carlos vê o aviso da entrada dele e a mensagem de depois, e só.
	p := c.pagina(t, c.kCarlos, g.ID, "")
	if p.TemMais || len(p.Mensagens) != 2 {
		t.Fatalf("Carlos vê %+v", p)
	}
	if a := p.Mensagens[0]; a.Tipo != "aviso" || a.Aviso == nil || a.Aviso.Acao != "pos" || a.Aviso.Alvo == nil || a.Aviso.Alvo.ID != c.carlos.ID {
		t.Fatalf("primeira do Carlos = %+v", a)
	}
	if m := p.Mensagens[1]; m.Texto == nil || *m.Texto != "depois da entrada" {
		t.Fatalf("segunda do Carlos = %+v", m)
	}
	// Mesmo pedindo "antes" de tudo, as de antes da entrada não aparecem.
	p = c.pagina(t, c.kCarlos, g.ID, fmt.Sprintf("?antes=%d", p.Mensagens[0].ID))
	if p.TemMais || len(p.Mensagens) != 0 {
		t.Fatalf("antes da entrada do Carlos = %+v", p)
	}
	// O naoLidas do Carlos conta só a mensagem de depois.
	if l := c.lista(t, c.kCarlos); len(l) != 1 || l[0].NaoLidas != 1 {
		t.Fatalf("lista do Carlos = %+v", l)
	}
}

func TestLida(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	// A Beatriz tem um segundo computador.
	kBia2 := c.a.Ligar(codigoDe(t, c), "PC-BIA-2")
	if p := c.a.Entrar(kBia2, "2004", "Beatriz"); p.ID != c.bia.ID {
		t.Fatalf("segundo computador da Beatriz entrou como %+v", p)
	}
	cBia1, cBia2 := c.a.Conectar(c.kBia), c.a.Conectar(kBia2)

	var ids []int64
	for i := 1; i <= 6; i++ {
		ids = append(ids, texto(t, c.a, conv, c.ana.ID, fmt.Sprintf("mensagem %d", i)))
	}
	if l := c.lista(t, c.kBia); l[0].NaoLidas != 6 {
		t.Fatalf("naoLidas antes = %d; queria 6", l[0].NaoLidas)
	}

	// ate=5 (a quinta mensagem): 204, e o outro computador recebe o evento.
	if resp := c.lida(c.kBia, conv, map[string]int64{"ate": ids[4]}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ate=5: status %d", resp.StatusCode)
	}
	ev := apitest.LerEvento[eventoLida](t, cBia2)
	if ev != (eventoLida{Tipo: "lida", Conversa: conv, Ate: ids[4]}) {
		t.Fatalf("evento = %+v", ev)
	}
	if l := c.lista(t, c.kBia); l[0].NaoLidas != 1 {
		t.Fatalf("naoLidas depois = %d; queria 1", l[0].NaoLidas)
	}

	// ate=3: a leitura continua em 5, e ninguém recebe evento.
	if resp := c.lida(c.kBia, conv, map[string]int64{"ate": ids[2]}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ate=3: status %d", resp.StatusCode)
	}
	var ate int64
	if err := bancoDe(t, c.a).QueryRow(`SELECT ate FROM leituras WHERE pessoa_id = ? AND conversa_id = ?`, c.bia.ID, conv).Scan(&ate); err != nil || ate != ids[4] {
		t.Fatalf("leitura = %d, %v; queria %d", ate, err, ids[4])
	}
	if l := c.lista(t, c.kBia); l[0].NaoLidas != 1 {
		t.Fatalf("naoLidas depois do ate=3 = %d; queria 1", l[0].NaoLidas)
	}
	// O mesmo ate de novo também não é novidade.
	c.lida(c.kBia, conv, map[string]int64{"ate": ids[4]})
	apitest.SemEvento(t, cBia2, 150*time.Millisecond)
	apitest.SemEvento(t, cBia1, 150*time.Millisecond) // o computador que marcou nunca recebe

	// O corpo ruim.
	for nome, corpo := range map[string]any{"sem ate": map[string]int64{}, "ate zero": map[string]int64{"ate": 0}, "ate negativo": map[string]int64{"ate": -3}, "texto": map[string]string{"ate": "x"}} {
		if resp := c.lida(c.kBia, conv, corpo); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: status %d; queria 400", nome, resp.StatusCode)
		}
	}
}

// codigoDe devolve o código da empresa ACME da cena.
func codigoDe(t *testing.T, c *cena) string {
	t.Helper()
	var codigo string
	err := bancoDe(t, c.a).QueryRow(`SELECT codigo FROM empresas WHERE nome = 'ACME Comércio Ltda'`).Scan(&codigo)
	if err != nil {
		t.Fatal(err)
	}
	return codigo
}

func TestLida_NaoPassaDaUltima(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	ultima := texto(t, c.a, conv, c.ana.ID, "primeira")
	if resp := c.lida(c.kBia, conv, map[string]int64{"ate": ultima + 1000}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", resp.StatusCode)
	}
	// A mensagem que chega depois não nasce lida.
	texto(t, c.a, conv, c.ana.ID, "segunda")
	if l := c.lista(t, c.kBia); l[0].NaoLidas != 1 {
		t.Fatalf("naoLidas = %d; queria 1", l[0].NaoLidas)
	}
}

func TestIsolamento_Mensagens(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	m := texto(t, c.a, conv, c.ana.ID, "só da ACME")
	caminho := fmt.Sprintf("/api/v1/conversas/%d", conv)

	// O Abel, de outra empresa, e o Carlos, da ACME mas fora da conversa.
	for nome, chave := range map[string]string{"Abel": c.kAbel, "Carlos": c.kCarlos} {
		esperarErro(t, c.a.Pedir(chave, "GET", caminho+"/mensagens", nil), 404, "naoEncontrado")
		esperarErro(t, c.enviar(chave, conv, "intruso", "oi"), 404, "naoEncontrado")
		esperarErro(t, c.lida(chave, conv, map[string]int64{"ate": m}), 404, "naoEncontrado")
		if n := contarMensagens(t, c, conv); n != 1 {
			t.Fatalf("%s: o banco tem %d mensagens; queria 1", nome, n)
		}
	}
	// Um id que não existe, e um que nem é número.
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/conversas/99999/mensagens", nil), 404, "naoEncontrado")
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/conversas/abc/mensagens", nil), 404, "naoEncontrado")
	esperarErro(t, c.enviar(c.kAna, 99999, "x", "oi"), 404, "naoEncontrado")
	esperarErro(t, c.lida(c.kAna, 99999, map[string]int64{"ate": 1}), 404, "naoEncontrado")
	// Sem a chave e num computador sem pessoa.
	esperarErro(t, c.a.Pedir("", "GET", caminho+"/mensagens", nil), 401, "chave")
	acme := codigoDe(t, c)
	novo := c.a.Ligar(acme, "PC-NOVO")
	esperarErro(t, c.a.Pedir(novo, "GET", caminho+"/mensagens", nil), 409, "pessoa")
	esperarErro(t, c.enviar(novo, conv, "x", "oi"), 409, "pessoa")
	esperarErro(t, c.lida(novo, conv, map[string]int64{"ate": 1}), 409, "pessoa")
	// Quem saiu do grupo também não vê mais.
	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	if resp := c.tirar(c.kBia, g.ID, c.bia.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sair: status %d", resp.StatusCode)
	}
	esperarErro(t, c.a.Pedir(c.kBia, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens", g.ID), nil), 404, "naoEncontrado")
	esperarErro(t, c.enviar(c.kBia, g.ID, "saiu", "oi"), 404, "naoEncontrado")
}

// pedidoCru faz um pedido sem chamar o t: serve às goroutines dos testes simultâneos.
func pedidoCru(a *apitest.Ambiente, chave, metodo, caminho string, corpo any) (int, []byte, error) {
	dados, err := json.Marshal(corpo)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(metodo, a.Servidor.URL+caminho, bytes.NewReader(dados))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+chave)
	resp, err := a.Servidor.Client().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, err = buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes(), err
}

// TestEnviar_Simultaneo é o Review Focus 2: vários computadores enviando juntos, por HTTP de
// verdade, sem erro de banco ocupado e com os ids sempre crescendo.
func TestEnviar_Simultaneo(t *testing.T) {
	const computadores, porComputador = 5, 10
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	var chaves []string
	var pessoas []apitest.Pessoa
	for i := 0; i < computadores; i++ {
		k := a.Ligar(emp.Codigo, fmt.Sprintf("PC-%d", i))
		chaves = append(chaves, k)
		pessoas = append(pessoas, a.Entrar(k, fmt.Sprintf("20%02d", i), fmt.Sprintf("Pessoa %d", i)))
	}
	c := &cena{a: a}
	var outras []int64
	for _, p := range pessoas[1:] {
		outras = append(outras, p.ID)
	}
	g := c.criarGrupo(t, chaves[0], "Comercial", outras...)
	vigia := a.Conectar(chaves[1]) // vê os eventos na ordem em que saem

	type resultado struct {
		status int
		id     int64
		erro   error
	}
	resultados := make([][]resultado, computadores)
	inicio := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < computadores; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-inicio
			for j := 0; j < porComputador; j++ {
				status, corpo, err := pedidoCru(a, chaves[i], "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", g.ID),
					map[string]string{"idLocal": fmt.Sprintf("pc%d-m%d", i, j), "texto": fmt.Sprintf("do computador %d, número %d", i, j)})
				r := resultado{status: status, erro: err}
				if err == nil && status == http.StatusCreated {
					var m struct{ Mensagem mensagemResp }
					if err := json.Unmarshal(corpo, &m); err != nil {
						r.erro = err
					}
					r.id = m.Mensagem.ID
				}
				resultados[i] = append(resultados[i], r)
			}
		}()
	}
	close(inicio)
	wg.Wait()

	vistos := map[int64]bool{}
	for i, lista := range resultados {
		var anterior int64
		for j, r := range lista {
			if r.erro != nil || r.status != http.StatusCreated {
				t.Fatalf("computador %d, envio %d: status %d, erro %v", i, j, r.status, r.erro)
			}
			if r.id <= anterior {
				t.Fatalf("computador %d: o id %d não passa do anterior %d", i, r.id, anterior)
			}
			anterior = r.id
			vistos[r.id] = true
		}
	}
	if len(vistos) != computadores*porComputador {
		t.Fatalf("ids diferentes = %d; queria %d", len(vistos), computadores*porComputador)
	}

	// No GET os 50 aparecem crescendo, e são os mesmos dos 201.
	p := c.pagina(t, chaves[2], g.ID, "")
	if len(p.Mensagens) != 50 || !slices.IsSorted(idsDe(p.Mensagens)) {
		t.Fatalf("GET = %v", idsDe(p.Mensagens))
	}
	for _, m := range p.Mensagens {
		if !vistos[m.ID] || m.Tipo != "texto" {
			t.Fatalf("o GET trouxe %+v, que nenhum envio criou", m)
		}
	}
	// Os eventos saem na ordem dos ids.
	var anterior int64
	for k := 0; k < computadores*porComputador; k++ {
		ev := apitest.LerEvento[eventoMensagem](t, vigia)
		if ev.Tipo != "mensagem" || ev.Mensagem.ID <= anterior || !vistos[ev.Mensagem.ID] {
			t.Fatalf("evento %d = %+v (anterior %d)", k, ev, anterior)
		}
		anterior = ev.Mensagem.ID
	}
}

// TestEnviar_MesmoIdLocalSimultaneo: dois envios juntos com o mesmo idLocal respondem com a
// mesma mensagem, um com 201 e o resto com 200, e as repetidas não gastam o limite.
func TestEnviar_MesmoIdLocalSimultaneo(t *testing.T) {
	const juntos = 8
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	cBia := c.a.Conectar(c.kBia)

	status := make([]int, juntos)
	ids := make([]int64, juntos)
	inicio := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < juntos; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-inicio
			s, corpo, err := pedidoCru(c.a, c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv),
				map[string]string{"idLocal": "corrida", "texto": "uma só"})
			status[i] = s
			if err != nil {
				status[i] = -1
				return
			}
			var m struct{ Mensagem mensagemResp }
			json.Unmarshal(corpo, &m)
			ids[i] = m.Mensagem.ID
		}()
	}
	close(inicio)
	wg.Wait()

	novas := 0
	for i := range status {
		switch status[i] {
		case http.StatusCreated:
			novas++
		case http.StatusOK:
		default:
			t.Fatalf("envio %d: status %d", i, status[i])
		}
		if ids[i] == 0 || ids[i] != ids[0] {
			t.Fatalf("ids = %v; queria todos iguais", ids)
		}
	}
	if novas != 1 {
		t.Fatalf("%d respostas 201; queria 1 (status %v)", novas, status)
	}
	if n := contarMensagens(t, c, conv); n != 1 {
		t.Fatalf("o banco tem %d mensagens; queria 1", n)
	}
	apitest.LerEvento[eventoMensagem](t, cBia)
	apitest.SemEvento(t, cBia, 150*time.Millisecond)

	// As 7 repetidas devolveram o lugar: cabem mais 59 e a 61ª do minuto é recusada.
	for i := 1; i <= 59; i++ {
		if resp := c.enviar(c.kAna, conv, fmt.Sprintf("n%d", i), "oi"); resp.StatusCode != http.StatusCreated {
			t.Fatalf("mensagem %d: status %d", i, resp.StatusCode)
		}
	}
	esperarErro(t, c.enviar(c.kAna, conv, "n60", "oi"), 429, "limite")
}

// As mensagens de aviso do grupo saem como o evento mensagem (ruling R13).

// lerAvisos lê n eventos mensagem da conexão e devolve como "acao:alvo" (alvo vazio se não há).
func lerAvisos(t *testing.T, conn *websocket.Conn, n int) ([]string, []int64) {
	t.Helper()
	var out []string
	var ids []int64
	for i := 0; i < n; i++ {
		ev := apitest.LerEvento[eventoMensagem](t, conn)
		if ev.Tipo != "mensagem" || ev.Mensagem.Tipo != "aviso" || ev.Mensagem.Aviso == nil {
			t.Fatalf("evento %d = %+v; queria um aviso", i, ev)
		}
		s := ev.Mensagem.Aviso.Acao + ":" + ev.Mensagem.Aviso.Quem.Nome
		if al := ev.Mensagem.Aviso.Alvo; al != nil {
			s += ">" + al.Nome
		}
		out = append(out, s)
		ids = append(ids, ev.Mensagem.ID)
	}
	return out, ids
}

func TestAvisos_CriarGrupoEmiteMensagem(t *testing.T) {
	c := novaCena(t)
	cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)
	cDani := c.a.Conectar(c.kDani) // fora do grupo

	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID, c.carlos.ID)
	want := []string{"criou:Ana Souza", "pos:Ana Souza>Beatriz", "pos:Ana Souza>Carlos"}
	var primeiros []int64
	for nome, conn := range map[string]*websocket.Conn{"Ana": cAna, "Beatriz": cBia, "Carlos": cCarlos} {
		proximo(t, conn, "conversa")
		got, ids := lerAvisos(t, conn, 3)
		if !slices.Equal(got, want) || !slices.IsSorted(ids) {
			t.Fatalf("avisos de %s = %v, %v; queria %v em ordem", nome, got, ids, want)
		}
		if primeiros == nil {
			primeiros = ids
		} else if !slices.Equal(primeiros, ids) {
			t.Fatalf("ids de %s = %v; os outros viram %v", nome, ids, primeiros)
		}
	}
	apitest.SemEvento(t, cDani, 150*time.Millisecond)
	// Os ids dos eventos são os dos avisos do banco, e o último é o da conversa.
	if g.Ultima == nil || g.Ultima.ID != primeiros[2] {
		t.Fatalf("ultima = %+v; queria o id %d", g.Ultima, primeiros[2])
	}
}

func TestAvisos_PorEmGrupoEmiteMensagem(t *testing.T) {
	c := novaCena(t)
	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	cAna, cBia, cDani := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kDani)

	if resp := c.pôr(c.kAna, g.ID, c.dani.ID, c.carlos.ID, c.bia.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr: status %d", resp.StatusCode)
	}
	// Quem já estava (a Beatriz) não gera aviso; o resto vem na ordem do pedido.
	want := []string{"pos:Ana Souza>Daniela", "pos:Ana Souza>Carlos"}
	for nome, conn := range map[string]*websocket.Conn{"Ana": cAna, "Beatriz": cBia, "Daniela": cDani} {
		proximo(t, conn, "conversa")
		if got, _ := lerAvisos(t, conn, 2); !slices.Equal(got, want) {
			t.Fatalf("avisos de %s = %v; queria %v", nome, got, want)
		}
	}
	// Pôr quem já está não emite nada.
	if resp := c.pôr(c.kAna, g.ID, c.bia.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr de novo: status %d", resp.StatusCode)
	}
	apitest.SemEvento(t, cBia, 150*time.Millisecond)
}

func TestAvisos_TirarESairNaoMandamAoQueSaiu(t *testing.T) {
	c := novaCena(t)
	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID, c.carlos.ID)
	cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)

	// A Ana tira o Carlos: o Carlos recebe conversaSaiu e nada mais.
	if resp := c.tirar(c.kAna, g.ID, c.carlos.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("tirar: status %d", resp.StatusCode)
	}
	proximo(t, cCarlos, "conversaSaiu")
	apitest.SemEvento(t, cCarlos, 150*time.Millisecond)
	for nome, conn := range map[string]*websocket.Conn{"Ana": cAna, "Beatriz": cBia} {
		proximo(t, conn, "conversa")
		if got, _ := lerAvisos(t, conn, 1); !slices.Equal(got, []string{"tirou:Ana Souza>Carlos"}) {
			t.Fatalf("aviso de %s = %v", nome, got)
		}
	}

	// A Beatriz sai: ela recebe conversaSaiu e não o aviso da própria saída; a Ana recebe os dois.
	if resp := c.tirar(c.kBia, g.ID, c.bia.ID); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sair: status %d", resp.StatusCode)
	}
	proximo(t, cBia, "conversaSaiu")
	apitest.SemEvento(t, cBia, 150*time.Millisecond)
	proximo(t, cAna, "conversa")
	if got, _ := lerAvisos(t, cAna, 1); !slices.Equal(got, []string{"saiu:Beatriz"}) {
		t.Fatalf("aviso da saída = %v", got)
	}
}
