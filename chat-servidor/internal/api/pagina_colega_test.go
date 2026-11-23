package api_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// abrirResp é a resposta do abrir da página.
type abrirResp struct {
	Reuniao struct {
		Tipo string `json:"tipo"`
	} `json:"reuniao"`
	Bilhete string `json:"bilhete"`
	Colega  *struct {
		Nome    string  `json:"nome"`
		Chave   *string `json:"chave"`
		ValeAte *int64  `json:"valeAte"`
	} `json:"colega"`
}

// abrirCom faz o abrir da página com um corpo (nil é sem corpo). Não chama o Fatalf: roda em goroutines.
func (c *cenaR) abrirCom(codigo string, corpo any) *http.Response {
	var dados io.Reader
	switch b := corpo.(type) {
	case nil:
	case string:
		dados = strings.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		dados = strings.NewReader(string(j))
	}
	req, err := http.NewRequest("POST", c.a.Servidor.URL+"/api/v1/pagina/reunioes/"+codigo, dados)
	if err != nil {
		panic(err)
	}
	resp, err := c.a.Servidor.Client().Do(req)
	if err != nil {
		panic(err)
	}
	return resp
}

// abrirBom é o abrir que tem de dar 200.
func (c *cenaR) abrirBom(t *testing.T, codigo string, corpo any) abrirResp {
	t.Helper()
	resp := c.abrirCom(codigo, corpo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("abrir respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[abrirResp](t, resp)
}

func TestAbrirColega_SemCorpoComoHoje(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	resp := c.abrirCom(r.Codigo, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[map[string]json.RawMessage](t, resp)
	if _, tem := corpo["colega"]; tem || len(corpo) != 2 {
		t.Fatalf("corpo = %v; queria só reuniao e bilhete", corpo)
	}
}

func TestAbrirColega_ComOPasse(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)

	resp := c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q", cc)
	}
	a := apitest.LerJSON[abrirResp](t, resp)
	if len(a.Bilhete) != 43 || a.Reuniao.Tipo != "marcada" {
		t.Fatalf("resposta = %+v", a)
	}
	if a.Colega == nil || a.Colega.Nome != "Carlos Lima" {
		t.Fatalf("colega = %+v; queria o Carlos Lima", a.Colega)
	}
	if a.Colega.Chave == nil || !formaDoPasse.MatchString(*a.Colega.Chave) {
		t.Fatalf("a chave = %v; queria 43 caracteres base64url", a.Colega.Chave)
	}
	if a.Colega.ValeAte == nil || r.ValeAte == nil || *a.Colega.ValeAte != *r.ValeAte {
		t.Fatalf("valeAte = %v; queria o da reunião, %v", a.Colega.ValeAte, r.ValeAte)
	}
}

func TestAbrirColega_NaHoraNaoTemValeAte(t *testing.T) {
	c := novaCenaR(t)
	resp := c.a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": []string{"2003"}})
	r := apitest.LerJSON[struct {
		Reuniao reuniaoResp `json:"reuniao"`
	}](t, resp).Reuniao
	p := c.passe(t, c.kCarlos, r.Codigo)
	resp = c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[struct {
		Colega map[string]json.RawMessage `json:"colega"`
	}](t, resp)
	if v, tem := corpo.Colega["valeAte"]; !tem || string(v) != "null" {
		t.Fatalf("colega = %v; queria o valeAte null", corpo.Colega)
	}
}

func TestAbrirColega_OPasseValeUmaVez(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	c.abrirBom(t, r.Codigo, map[string]string{"passe": p.Passe})
	resp := c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode == http.StatusOK {
		t.Fatal("o passe gasto abriu de novo")
	}
	e := esperarErro(t, resp, 401, "passe")
	if e.Campo != "" {
		t.Fatalf("campo = %q", e.Campo)
	}
}

func TestAbrirColega_DoisAoMesmoTempo(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	var wg sync.WaitGroup
	respostas := make([]*http.Response, 2)
	for i := range respostas {
		wg.Add(1)
		go func() {
			defer wg.Done()
			respostas[i] = c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
		}()
	}
	wg.Wait()
	status := []int{respostas[0].StatusCode, respostas[1].StatusCode}
	if !(status[0] == 200 && status[1] == 401) && !(status[0] == 401 && status[1] == 200) {
		t.Fatalf("status = %v; queria um 200 e um 401", status)
	}
	for _, resp := range respostas {
		if resp.StatusCode == 401 {
			esperarErro(t, resp, 401, "passe")
		}
	}
}

func TestAbrirColega_ComAChave(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	troca := c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe})
	chave := *troca.Colega.Chave

	for i := range 3 {
		resp := c.abrirCom(r.Codigo, map[string]string{"colega": chave})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("o abrir %d com a chave deu %d", i+1, resp.StatusCode)
		}
		corpo := apitest.LerJSON[struct {
			Bilhete string                     `json:"bilhete"`
			Colega  map[string]json.RawMessage `json:"colega"`
		}](t, resp)
		if _, tem := corpo.Colega["chave"]; tem || len(corpo.Colega) != 2 {
			t.Fatalf("colega = %v; queria só nome e valeAte", corpo.Colega)
		}
		if string(corpo.Colega["nome"]) != `"Carlos Lima"` || len(corpo.Bilhete) != 43 {
			t.Fatalf("resposta = %+v", corpo)
		}
		var valeAte int64
		if json.Unmarshal(corpo.Colega["valeAte"], &valeAte) != nil || valeAte != *r.ValeAte {
			t.Fatalf("valeAte = %s; queria %d", corpo.Colega["valeAte"], *r.ValeAte)
		}
	}
}

func TestAbrirColega_PasseDeOutraReuniao(t *testing.T) {
	c := novaCenaR(t)
	a, b := c.marcada(t, c.kAna), c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, a.Codigo)
	esperarErro(t, c.abrirCom(b.Codigo, map[string]string{"passe": p.Passe}), 401, "passe")
	if x := c.abrirBom(t, a.Codigo, map[string]string{"passe": p.Passe}); x.Colega == nil {
		t.Fatal("o passe da A deixou de valer na A")
	}
}

func TestAbrirColega_PessoaTirada(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
	passe := c.passe(t, c.kCarlos, r.Codigo).Passe
	// A Bia também tem uma chave, que continua valendo.
	chaveBia := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kBia, r.Codigo).Passe}).Colega.Chave

	if _, _, err := c.a.Banco.TirarPessoa(t.Context(), c.acme.ID, c.carlos.ID); err != nil {
		t.Fatal(err)
	}
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": passe}), 401, "passe")
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	// A chave de quem saiu continua respondendo 401; que ela foi esquecida é o TestAbrirColega_AChaveEsquecidaNaoVolta.
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	c.abrirBom(t, r.Codigo, map[string]string{"colega": chaveBia})
}

func TestAbrirColega_ComputadorDesligado(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
	passe := c.passe(t, c.kCarlos, r.Codigo).Passe
	if resp := c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
		t.Fatalf("desligar deu %d", resp.StatusCode)
	}
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": passe}), 401, "passe")
}

func TestAbrirColega_ReuniaoCancelada(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil)
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe}), 404, "naoEncontrado")
	// Um corpo ruim também: o 404 vem antes de qualquer coisa do corpo.
	esperarErro(t, c.abrirCom(r.Codigo, "{quebrado"), 404, "naoEncontrado")
}

func TestAbrirColega_CorpoQueNaoVale(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	boa := strings.Repeat("a", 43)
	casos := []struct {
		nome, corpo, campo string
	}{
		{"os dois campos", `{"passe":"` + boa + `","colega":"` + boa + `"}`, "corpo"},
		{"um campo a mais", `{"passe":"` + boa + `","outro":1}`, "corpo"},
		{"só um campo desconhecido", `{"outro":"` + boa + `"}`, "corpo"},
		{"o objeto vazio", `{}`, "corpo"},
		{"um passe de 42 caracteres", `{"passe":"` + boa[:42] + `"}`, "passe"},
		{"uma chave de 44 caracteres", `{"colega":"` + boa + `a"}`, "colega"},
		{"fora do alfabeto", `{"passe":"` + boa[:42] + `+"}`, "passe"},
		{"um número no lugar do texto", `{"passe":12345}`, "passe"},
		{"o null no lugar do texto", `{"colega":null}`, "colega"},
		{"um corpo de 300 bytes", `{"passe":"` + strings.Repeat("a", 300) + `"}`, "corpo"},
		{"um JSON quebrado", `{"passe":`, "corpo"},
		{"lixo depois do objeto", `{"passe":"` + boa + `"} {}`, "corpo"},
		{"uma lista", `["` + boa + `"]`, "corpo"},
		{"só espaço", `   `, "corpo"},
	}
	for _, k := range casos {
		t.Run(k.nome, func(t *testing.T) {
			e := esperarErro(t, c.abrirCom(r.Codigo, k.corpo), 400, "invalido")
			if e.Campo != k.campo {
				t.Fatalf("campo = %q; queria %q", e.Campo, k.campo)
			}
		})
	}
}

func TestAbrirColega_AsFalhasContam(t *testing.T) {
	t.Run("com um passe inventado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 20 {
			esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": strings.Repeat("b", 43)}), 401, "passe")
		}
		esperarErro(t, c.abrirCom(r.Codigo, nil), 429, "tentativas")
	})
	t.Run("com corpos que não valem", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 20 {
			esperarErro(t, c.abrirCom(r.Codigo, `{}`), 400, "invalido")
		}
		esperarErro(t, c.abrirCom(r.Codigo, nil), 429, "tentativas")
	})
	t.Run("o abrir bom com a chave não gasta as falhas", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
		for range 25 {
			c.abrirBom(t, r.Codigo, map[string]string{"colega": chave})
		}
		esperarErro(t, c.abrirCom(r.Codigo, `{}`), 400, "invalido")
	})
}

func TestAbrirColega_ReuniaoDeTeste(t *testing.T) {
	c := novaCenaR(t)
	teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	esperarErro(t, c.abrirCom(teste.Codigo, map[string]string{"passe": strings.Repeat("c", 43)}), 401, "passe")
	// Sem corpo, abre como hoje.
	if x := c.abrirBom(t, teste.Codigo, nil); x.Colega != nil || x.Reuniao.Tipo != "teste" {
		t.Fatalf("resposta = %+v", x)
	}
}

func TestAbrirColega_NaoVaiAoLog(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	var log registroSeguro
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	p := c.passe(t, c.kCarlos, r.Codigo)
	a := c.abrirBom(t, r.Codigo, map[string]string{"passe": p.Passe})
	chave := *a.Colega.Chave
	c.abrirBom(t, r.Codigo, map[string]string{"colega": chave})
	inventada := strings.Repeat("d", 43)
	c.abrirCom(r.Codigo, map[string]string{"passe": inventada}).Body.Close()
	c.abrirCom(r.Codigo, `{"passe":"curto"}`).Body.Close()
	c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil)
	c.abrirCom(r.Codigo, map[string]string{"colega": chave}).Body.Close()

	texto := log.String()
	if !strings.Contains(texto, "pedido") {
		t.Fatalf("o log não tem os pedidos; o teste não prova nada: %q", texto)
	}
	for o, s := range map[string]string{
		"o passe": p.Passe, "a chave": chave, "o nome": "Carlos Lima", "o bilhete": a.Bilhete,
		"o passe inventado": inventada, "o código": r.Codigo,
	} {
		if strings.Contains(texto, s) {
			t.Fatalf("o log tem %s (%q):\n%s", o, s, texto)
		}
	}
}

// trocaPorChave faz o abrir com o passe do Carlos e devolve a chave do colega.
func (c *cenaR) trocaPorChave(t *testing.T, codigo string) string {
	t.Helper()
	return *c.abrirBom(t, codigo, map[string]string{"passe": c.passe(t, c.kCarlos, codigo).Passe}).Colega.Chave
}

// A pessoa saiu, mas o computador continua ativo (o TirarPessoa desligaria os dois): só a conferência da pessoa
// pode recusar.
func TestAbrirColega_PessoaQueSaiu(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	chave := c.trocaPorChave(t, r.Codigo)
	passe := c.passe(t, c.kCarlos, r.Codigo).Passe

	c.a.Exec(`UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, c.carlos.ID)
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": passe}), 401, "passe")
}

// A chave que deu 401 por a pessoa ter saído é esquecida: com a pessoa de volta, ela não abre mais.
func TestAbrirColega_AChaveEsquecidaNaoVolta(t *testing.T) {
	t.Run("a pessoa que saiu", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		chave := c.trocaPorChave(t, r.Codigo)
		c.a.Exec(`UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, c.carlos.ID)
		esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
		c.a.Exec(`UPDATE pessoas SET saiu_em = NULL WHERE id = ?`, c.carlos.ID)
		esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	})
	t.Run("o computador desligado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		chave := c.trocaPorChave(t, r.Codigo)
		c.a.Exec(`UPDATE computadores SET saiu_em = 1 WHERE pessoa_id = ?`, c.carlos.ID)
		esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
		c.a.Exec(`UPDATE computadores SET saiu_em = NULL WHERE pessoa_id = ?`, c.carlos.ID)
		esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	})
}

// ---------- O canal de colega: o entrar ----------

// canalComBilhete abre o WebSocket da página com o bilhete, com a origem do chat (tem de dar 101).
func (c *cenaR) canalComBilhete(t *testing.T, bilhete string) *websocket.Conn {
	t.Helper()
	conn, resp, err := c.a.CanalDaPagina(bilhete, c.a.Base)
	if err != nil {
		s := 0
		if resp != nil {
			s = resp.StatusCode
		}
		t.Fatalf("canal (status %d): %v", s, err)
	}
	return conn
}

// canalDeColega faz o que a página do Carlos faz: o passe pelo app, o abrir com ele e o canal com o bilhete.
func (c *cenaR) canalDeColega(t *testing.T, codigo string) *websocket.Conn {
	t.Helper()
	a := c.abrirBom(t, codigo, map[string]string{"passe": c.passe(t, c.kCarlos, codigo).Passe})
	if a.Colega == nil {
		t.Fatal("o abrir com o passe não reconheceu o colega")
	}
	return c.canalComBilhete(t, a.Bilhete)
}

// fechouCom1000 confere que o servidor fechou o canal com 1000.
func fechouCom1000(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	if cod := apitest.Fechamento(t, conn); cod != websocket.StatusNormalClosure {
		t.Fatalf("o canal fechou com %d; queria 1000", cod)
	}
}

// soOTipo confere que a próxima mensagem é só o tipo, sem outro campo.
func soOTipo(t *testing.T, conn *websocket.Conn, tipo string) {
	t.Helper()
	if m := aPagina(t, conn); len(m) != 1 || m["tipo"] != tipo {
		t.Fatalf("a página recebeu %v; queria só {tipo: %s}", m, tipo)
	}
}

// entrouOCarlos confere o aceito do Carlos: o participante, a senha de colega com o nome do cadastro e a volta.
// Devolve o participante.
func entrouOCarlos(t *testing.T, m map[string]any) string {
	t.Helper()
	part, _ := m["participante"].(string)
	senha, _ := m["senha"].(string)
	volta, _ := m["volta"].(string)
	if !hex16.MatchString(part) || senha == "" || !formaDoPasse.MatchString(volta) || m["turn"] == nil || m["video"] == nil {
		t.Fatalf("aceito = %v", m)
	}
	carga := cargaDaSenha(t, senha)
	if carga["papel"] != "colega" || carga["participante"] != part || carga["nome"] != "Carlos Lima" || carga["tela"] != false {
		t.Fatalf("carga da senha = %v; queria a de colega, do Carlos", carga)
	}
	return part
}

func TestCanalDeColega_Entrar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	app := c.a.Conectar(c.kCarlos)
	pagina := c.canalDeColega(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	part := entrouOCarlos(t, aPaginaTipo(t, pagina, "aceito"))

	// A câmera entra: o Carlos está na reunião, como quem entrou pelo app, e as rotas do app valem para ele.
	c.entrou(t, r.Codigo, part)
	l := c.lista(t, c.kCarlos, r.Codigo)
	if len(l.Participantes) != 1 || l.Participantes[0].ID != part || l.Participantes[0].Nome != "Carlos Lima" ||
		l.Participantes[0].DeFora {
		t.Fatalf("a lista é %+v", l)
	}
	// O computador do passe recebe os eventos da reunião.
	maria := c.canal(t, r.Codigo)
	daPagina(t, maria, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, maria, "aguardando")
	c.aceitar(t, c.kCarlos, r.Codigo, pedidoDe(t, app, "Maria Lima"))
	aPaginaTipo(t, maria, "aceito")
	// A página do Carlos, na reunião, recebe a lista a cada mudança: a entrada dele, o pedido e o aceito.
	for range 3 {
		aPaginaTipo(t, pagina, "participantes")
	}

	// Depois do aceito, o canal é o de uma página aceita: o senha vale.
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	s := aPaginaTipo(t, pagina, "tela")
	if carga := cargaDaSenha(t, s["senha"].(string)); carga["papel"] != "colega" || carga["tela"] != true {
		t.Fatalf("carga da tela = %v", carga)
	}
}

func TestCanalDeColega_PedirNaoVale(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canalDeColega(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Carlos Lima"})
	aPaginaErro(t, pagina, "invalido")
	daPagina(t, pagina, map[string]any{"tipo": "desistir"})
	aPaginaErro(t, pagina, "invalido")
	// O canal continua: o entrar ainda vale.
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaTipo(t, pagina, "aceito")
	// Depois do aceito também.
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Carlos Lima"})
	aPaginaErro(t, pagina, "invalido")
	daPagina(t, pagina, map[string]any{"tipo": "desistir"})
	aPaginaErro(t, pagina, "invalido")
	daPagina(t, pagina, map[string]any{"tipo": "senha"})
	aPaginaTipo(t, pagina, "senha")
}

func TestCanalComum_EntrarNaoVale(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canal(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaErro(t, pagina, "invalido")
	// O canal continua, e o pedir vale.
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "naoComecou")
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaErro(t, pagina, "invalido")
}

func TestCanalDeColega_EntrarUmaVez(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canalDeColega(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	part := entrouOCarlos(t, aPaginaTipo(t, pagina, "aceito"))
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaErro(t, pagina, "invalido")
	// O segundo entrar não pôs ninguém a mais: a reunião só tem a vaga do Carlos.
	c.entrou(t, r.Codigo, part)
	if _, pessoas := c.a.Gerente.Contagem(c.sala(t, r.Codigo)); pessoas != 1 {
		t.Fatalf("a reunião tem %d pessoas", pessoas)
	}
}

func TestCanalDeColega_DoisMinutos(t *testing.T) {
	api.AjustarPedirEspera(t, 400*time.Millisecond)

	t.Run("sem o entrar, o canal fecha com 1000", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		fechouCom1000(t, c.canalDeColega(t, r.Codigo))
	})

	t.Run("o pedir que não vale não segura o canal", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Carlos Lima"})
		aPaginaErro(t, pagina, "invalido")
		fechouCom1000(t, pagina)
	})

	t.Run("o canal que mandou o entrar não fecha", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Video.DefinirNoAr(false) // o entrar que não dá certo também conta, como o pedir
		pagina := c.canalDeColega(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		soOTipo(t, pagina, "semServidor")
		lidas := make(chan map[string]any, 1)
		go func() {
			_, dados, err := pagina.Read(t.Context())
			var m map[string]any
			if err != nil {
				m = map[string]any{"erro de leitura": err.Error()}
			} else {
				json.Unmarshal(dados, &m)
			}
			lidas <- m
		}()
		time.Sleep(1200 * time.Millisecond) // três vezes o limite
		daPagina(t, pagina, map[string]any{"tipo": "tela"})
		if m := <-lidas; m["erro"] != "foraDaReuniao" {
			t.Fatalf("a página recebeu %v; queria o foraDaReuniao, de um canal aberto", m)
		}
	})
}

func TestCanalDeColega_Cheia(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	var partes []string
	for range 10 {
		partes = append(partes, c.entrouNaReuniao(t, c.kBia, r.Codigo))
	}
	pagina := c.canalDeColega(t, r.Codigo)
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	soOTipo(t, pagina, "cheia")

	// Uma pessoa sai, e o mesmo canal entra.
	c.a.Gerente.EventoDoVideo(video.Evento{Tipo: "saiu", Sala: c.sala(t, r.Codigo), Participante: partes[0]})
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	entrouOCarlos(t, aPaginaTipo(t, pagina, "aceito"))
}

func TestCanalDeColega_OutrasRespostas(t *testing.T) {
	t.Run("o semServidor deixa o canal aberto", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		c.a.Video.DefinirNoAr(false)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		soOTipo(t, pagina, "semServidor")
		c.a.Video.DefinirNoAr(true)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		aPaginaTipo(t, pagina, "aceito")
	})

	t.Run("o servidorCheio deixa o canal aberto", func(t *testing.T) {
		c := novaCenaR(t)
		// O limite padrão é de 2 reuniões ao mesmo tempo.
		r1, r2, r3 := c.marcada(t, c.kAna), c.marcada(t, c.kAna), c.marcada(t, c.kAna)
		c.entrouNaReuniao(t, c.kAna, r1.Codigo)
		c.entrouNaReuniao(t, c.kBia, r2.Codigo)
		pagina := c.canalDeColega(t, r3.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		soOTipo(t, pagina, "servidorCheio")
		if err := c.a.Banco.GuardarLimiteReunioes(t.Context(), 3); err != nil {
			t.Fatal(err)
		}
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		aPaginaTipo(t, pagina, "aceito")
	})

	t.Run("o linkInvalido fecha o canal", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		c.a.Relogio.Avancar(72 * time.Hour) // passou do valeAte
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		soOTipo(t, pagina, "linkInvalido")
		fechouCom1000(t, pagina)
	})
}

func TestCanalDeColega_PessoaSumiu(t *testing.T) {
	t.Run("tirada da empresa", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		if _, _, err := c.a.Banco.TirarPessoa(t.Context(), c.acme.ID, c.carlos.ID); err != nil {
			t.Fatal(err)
		}
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		aPaginaErro(t, pagina, "invalido")
		fechouCom1000(t, pagina)
		if _, pessoas := c.a.Gerente.Contagem(c.sala(t, r.Codigo)); pessoas != 0 {
			t.Fatalf("a reunião tem %d pessoas", pessoas)
		}
	})
	t.Run("que saiu, com o computador ainda ativo", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		c.a.Exec(`UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, c.carlos.ID)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		aPaginaErro(t, pagina, "invalido")
		fechouCom1000(t, pagina)
	})
}

func TestCanalDeColega_EntrarDoComputadorDesligado(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canalDeColega(t, r.Codigo)
	if resp := c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
		t.Fatalf("desligar deu %d", resp.StatusCode)
	}
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaErro(t, pagina, "invalido")
	fechouCom1000(t, pagina)
	if _, pessoas := c.a.Gerente.Contagem(c.sala(t, r.Codigo)); pessoas != 0 {
		t.Fatalf("a reunião tem %d pessoas", pessoas)
	}
}

// carlosComABiaEAMaria faz o Carlos entrar pela página, a Bia entrar pelo app e a Maria pedir, e lê as listas que a
// página do Carlos recebe. Devolve a página, a Bia e o pedido da Maria.
func (c *cenaR) carlosComABiaEAMaria(t *testing.T, codigo string) (pagina *websocket.Conn, bia, pedido string) {
	t.Helper()
	pagina, _, _ = c.carlosNaReuniao(t, codigo)
	bia = c.entrouNaReuniao(t, c.kBia, codigo)
	for {
		if ps, _ := aPaginaTipo(t, pagina, "participantes")["participantes"].([]any); len(ps) == 2 {
			break
		}
	}
	_, pedido = pedeAMaria(t, c, codigo, pagina)
	return pagina, bia, pedido
}

// respostasDeQuemNaoValeMais: o Carlos está na reunião pela página, com a Bia (pelo app) e com o pedido da Maria
// esperando; depois do mudar, que tira dele o que o reconhecia, cada uma das quatro respostas recebe o erro invalido,
// o canal fecha, e nada acontece na reunião: a Bia continua, o pedido espera, e o agente não recebe nada.
func respostasDeQuemNaoValeMais(t *testing.T, mudar func(t *testing.T, c *cenaR)) {
	for _, tipo := range []string{"aceitar", "recusar", "tirar", "encerrar"} {
		t.Run(tipo, func(t *testing.T) {
			c := novaCenaR(t)
			r := c.marcada(t, c.kAna)
			pagina, bia, pedido := c.carlosComABiaEAMaria(t, r.Codigo)
			mudar(t, c)

			m := map[string]any{"tipo": tipo}
			switch tipo {
			case "aceitar", "recusar":
				m["pedido"] = pedido
			case "tirar":
				m["participante"] = bia
			}
			daPagina(t, pagina, m)
			aPaginaErro(t, pagina, "invalido")
			fechouCom1000(t, pagina)

			l := c.lista(t, c.kBia, r.Codigo)
			comBia := false
			for _, p := range l.Participantes {
				comBia = comBia || p.ID == bia
			}
			if !comBia || len(l.Pedidos) != 1 || l.Pedidos[0].ID != pedido {
				t.Fatalf("a lista é %+v; queria a Bia na reunião e o pedido da Maria esperando", l)
			}
			if cs := c.a.Video.Comandos(); len(cs) != 0 {
				t.Fatalf("o agente recebeu %q", cs)
			}
		})
	}
}

func TestCanalDeColega_RespostaDeQuemSaiuDaEmpresa(t *testing.T) {
	respostasDeQuemNaoValeMais(t, func(t *testing.T, c *cenaR) {
		if _, _, err := c.a.Banco.TirarPessoa(t.Context(), c.acme.ID, c.carlos.ID); err != nil {
			t.Fatal(err)
		}
	})
}

func TestCanalDeColega_RespostaDoComputadorDesligado(t *testing.T) {
	respostasDeQuemNaoValeMais(t, func(t *testing.T, c *cenaR) {
		if resp := c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
			t.Fatalf("desligar deu %d", resp.StatusCode)
		}
	})
}

func TestCanalDeColega_BilheteComum(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	doColega := c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe})
	comum := c.abrirBom(t, r.Codigo, nil)
	if comum.Colega != nil {
		t.Fatalf("o abrir sem corpo reconheceu %+v", comum.Colega)
	}

	// O bilhete do abrir sem corpo, logo depois do abrir com o passe, abre um canal de quem é de fora.
	pagina := c.canalComBilhete(t, comum.Bilhete)
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aPaginaErro(t, pagina, "invalido")
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "naoComecou")

	// E o do abrir com o passe continua sendo o do colega.
	colega := c.canalComBilhete(t, doColega.Bilhete)
	daPagina(t, colega, map[string]any{"tipo": "entrar"})
	entrouOCarlos(t, aPaginaTipo(t, colega, "aceito"))
}

// ---------- O canal de colega: a lista e as respostas ----------

// carlosNaReuniao faz a página do Carlos entrar (o entrar) e a câmera dele entrar, e lê a lista da entrada. Devolve o
// canal, o participante e a chave de volta do aceito.
func (c *cenaR) carlosNaReuniao(t *testing.T, codigo string) (pagina *websocket.Conn, part, volta string) {
	t.Helper()
	pagina = c.canalDeColega(t, codigo)
	daPagina(t, pagina, map[string]any{"tipo": "entrar"})
	aceito := aPaginaTipo(t, pagina, "aceito")
	part = entrouOCarlos(t, aceito)
	volta, _ = aceito["volta"].(string)
	c.entrou(t, codigo, part)
	l := aPaginaTipo(t, pagina, "participantes")
	if ps, _ := l["participantes"].([]any); len(ps) != 1 {
		t.Fatalf("a lista da entrada é %v", l)
	}
	return pagina, part, volta
}

// pedeAMaria faz a Maria pedir, numa página de fora, e lê o pedido na lista nova da página do colega. Devolve a página
// da Maria e o id do pedido.
func pedeAMaria(t *testing.T, c *cenaR, codigo string, colega *websocket.Conn) (*websocket.Conn, string) {
	t.Helper()
	maria := c.canal(t, codigo)
	daPagina(t, maria, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, maria, "aguardando")
	l := aPaginaTipo(t, colega, "participantes")
	ps, _ := l["pedidos"].([]any)
	if len(ps) != 1 {
		t.Fatalf("a lista é %v; queria o pedido da Maria", l)
	}
	p, _ := ps[0].(map[string]any)
	id, _ := p["id"].(string)
	if p["nome"] != "Maria Lima" || !hex16.MatchString(id) {
		t.Fatalf("o pedido é %v", p)
	}
	return maria, id
}

// recusaDoCanal confere que a próxima mensagem é o recusa, só com o de e o motivo.
func recusaDoCanal(t *testing.T, conn *websocket.Conn, de, motivo string) {
	t.Helper()
	if m := aPagina(t, conn); len(m) != 3 || m["tipo"] != "recusa" || m["de"] != de || m["motivo"] != motivo {
		t.Fatalf("a página recebeu %v; queria {tipo: recusa, de: %s, motivo: %s}", m, de, motivo)
	}
}

// soOCarlos confere a lista com só o Carlos, com o voce, e sem pedidos.
func soOCarlos(t *testing.T, l map[string]any, carlos string) {
	t.Helper()
	ps, _ := l["participantes"].([]any)
	pedidos, _ := l["pedidos"].([]any)
	if len(ps) != 1 || pedidos == nil || len(pedidos) != 0 {
		t.Fatalf("a lista é %v; queria só o Carlos, sem pedidos", l)
	}
	if p, _ := ps[0].(map[string]any); p["id"] != carlos || p["voce"] != true || p["nome"] != "Carlos Lima" {
		t.Fatalf("o participante é %v", p)
	}
}

// semRecusa confere que nada ficou na fila da página antes da resposta do tela.
func semRecusa(t *testing.T, pagina *websocket.Conn) {
	t.Helper()
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	aPaginaTipo(t, pagina, "tela")
}

func TestCanalDeColega_Aceitar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, carlos, _ := c.carlosNaReuniao(t, r.Codigo)
	maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)

	daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
	aPaginaTipo(t, maria, "aceito")
	soOCarlos(t, aPaginaTipo(t, pagina, "participantes"), carlos)
	semRecusa(t, pagina)
}

func TestCanalDeColega_Recusar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, carlos, _ := c.carlosNaReuniao(t, r.Codigo)
	maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)

	daPagina(t, pagina, map[string]any{"tipo": "recusar", "pedido": pedido})
	soOTipo(t, maria, "recusado")
	fechouCom1000(t, maria)
	soOCarlos(t, aPaginaTipo(t, pagina, "participantes"), carlos)
	semRecusa(t, pagina)
}

func TestCanalDeColega_Tirar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, carlos, _ := c.carlosNaReuniao(t, r.Codigo)
	maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)
	daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
	parteMaria, _ := aPaginaTipo(t, maria, "aceito")["participante"].(string)
	aPaginaTipo(t, pagina, "participantes")
	c.entrou(t, r.Codigo, parteMaria)
	if ps, _ := aPaginaTipo(t, pagina, "participantes")["participantes"].([]any); len(ps) != 2 {
		t.Fatalf("a lista tem %v; queria o Carlos e a Maria", ps)
	}

	daPagina(t, pagina, map[string]any{"tipo": "tirar", "participante": parteMaria})
	soOTipo(t, maria, "tirado")
	fechouCom1000(t, maria)
	soOCarlos(t, aPaginaTipo(t, pagina, "participantes"), carlos)
	semRecusa(t, pagina)
	if cs := c.a.Video.Comandos(); len(cs) != 1 || cs[0] != "tirar "+c.sala(t, r.Codigo)+" "+parteMaria {
		t.Fatalf("o agente recebeu %q", cs)
	}
}

func TestCanalDeColega_Encerrar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
	maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)
	daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
	parteMaria, _ := aPaginaTipo(t, maria, "aceito")["participante"].(string)
	aPaginaTipo(t, pagina, "participantes")
	c.entrou(t, r.Codigo, parteMaria)
	aPaginaTipo(t, pagina, "participantes")

	daPagina(t, pagina, map[string]any{"tipo": "encerrar"})
	for quem, conn := range map[string]*websocket.Conn{"o Carlos": pagina, "a Maria": maria} {
		if m := aPagina(t, conn); len(m) != 1 || m["tipo"] != "encerrada" {
			t.Fatalf("%s recebeu %v; queria o encerrada", quem, m)
		}
		fechouCom1000(t, conn)
	}
}

func TestCanalDeColega_PrimeiraResposta(t *testing.T) {
	t.Run("a página aceita primeiro", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
		maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)
		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
		aPaginaTipo(t, maria, "aceito")
		aPaginaTipo(t, pagina, "participantes")

		resp := c.a.Pedir(c.kCarlos, "POST", "/api/v1/reunioes/"+r.Codigo+"/recusar", map[string]string{"pedido": pedido})
		esperarErro(t, resp, http.StatusConflict, "jaRespondido")
		semRecusa(t, pagina)
	})
	t.Run("a rota recusa primeiro", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
		maria, pedido := pedeAMaria(t, c, r.Codigo, pagina)
		resp := c.a.Pedir(c.kCarlos, "POST", "/api/v1/reunioes/"+r.Codigo+"/recusar", map[string]string{"pedido": pedido})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("recusar respondeu %d", resp.StatusCode)
		}
		soOTipo(t, maria, "recusado")
		aPaginaTipo(t, pagina, "participantes")

		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
		recusaDoCanal(t, pagina, "aceitar", "jaRespondido")
	})
}

func TestCanalDeColega_Recusas(t *testing.T) {
	const inventado = "0123456789abcdef"
	t.Run("naoEncontrado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": inventado})
		recusaDoCanal(t, pagina, "aceitar", "naoEncontrado")
		daPagina(t, pagina, map[string]any{"tipo": "recusar", "pedido": inventado})
		recusaDoCanal(t, pagina, "recusar", "naoEncontrado")
		daPagina(t, pagina, map[string]any{"tipo": "tirar", "participante": inventado})
		recusaDoCanal(t, pagina, "tirar", "naoEncontrado")
	})
	t.Run("cheia", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
		_, pedido := pedeAMaria(t, c, r.Codigo, pagina)
		for range 9 {
			c.entrouNaReuniao(t, c.kBia, r.Codigo)
			aPaginaTipo(t, pagina, "participantes")
		}
		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
		recusaDoCanal(t, pagina, "aceitar", "cheia")
		// O pedido continua esperando.
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Pedidos) != 1 || l.Pedidos[0].ID != pedido {
			t.Fatalf("os pedidos são %+v; queria o da Maria", l.Pedidos)
		}
	})
	t.Run("foraDaReuniao", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canalDeColega(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "entrar"})
		aPaginaTipo(t, pagina, "aceito") // a câmera não entra
		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": inventado})
		recusaDoCanal(t, pagina, "aceitar", "foraDaReuniao")
		daPagina(t, pagina, map[string]any{"tipo": "recusar", "pedido": inventado})
		recusaDoCanal(t, pagina, "recusar", "foraDaReuniao")
		daPagina(t, pagina, map[string]any{"tipo": "tirar", "participante": inventado})
		recusaDoCanal(t, pagina, "tirar", "foraDaReuniao")
		daPagina(t, pagina, map[string]any{"tipo": "encerrar"})
		recusaDoCanal(t, pagina, "encerrar", "foraDaReuniao")
	})
}

func TestCanalDeColega_RecusaDoServidorDeVideo(t *testing.T) {
	// O Carlos na reunião pela página, com a Bia (pelo app) e o pedido da Maria esperando.
	naReuniao := func(t *testing.T) (c *cenaR, codigo string, pagina *websocket.Conn, bia, pedido string) {
		c = novaCenaR(t)
		codigo = c.marcada(t, c.kAna).Codigo
		pagina, bia, pedido = c.carlosComABiaEAMaria(t, codigo)
		return c, codigo, pagina, bia, pedido
	}
	// Nada mudou: a Bia continua na reunião, e o pedido da Maria espera.
	nadaMudou := func(t *testing.T, c *cenaR, codigo, pedido string) {
		if l := c.lista(t, c.kBia, codigo); len(l.Participantes) != 2 || len(l.Pedidos) != 1 || l.Pedidos[0].ID != pedido {
			t.Fatalf("a lista é %+v", l)
		}
	}

	t.Run("fora do ar", func(t *testing.T) {
		c, codigo, pagina, bia, pedido := naReuniao(t)
		c.a.Video.DefinirNoAr(false)
		daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
		recusaDoCanal(t, pagina, "aceitar", "servidorVideo")
		daPagina(t, pagina, map[string]any{"tipo": "tirar", "participante": bia})
		recusaDoCanal(t, pagina, "tirar", "servidorVideo")
		daPagina(t, pagina, map[string]any{"tipo": "encerrar"})
		recusaDoCanal(t, pagina, "encerrar", "servidorVideo")
		c.a.Video.DefinirNoAr(true)
		semRecusa(t, pagina)
		nadaMudou(t, c, codigo, pedido)
	})

	t.Run("o agente falha", func(t *testing.T) {
		c, codigo, pagina, bia, pedido := naReuniao(t)
		c.a.Video.DefinirErro(video.ErrSemResposta)
		daPagina(t, pagina, map[string]any{"tipo": "tirar", "participante": bia})
		recusaDoCanal(t, pagina, "tirar", "servidorVideo")
		daPagina(t, pagina, map[string]any{"tipo": "encerrar"})
		recusaDoCanal(t, pagina, "encerrar", "servidorVideo")
		c.a.Video.DefinirErro(nil)
		semRecusa(t, pagina)
		nadaMudou(t, c, codigo, pedido)
		if cs := c.a.Video.Comandos(); len(cs) != 0 {
			t.Fatalf("o agente recebeu %q", cs)
		}
	})
}

func TestCanalDeColega_CamposRuins(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)
	longo := strings.Repeat("a", 100)
	for _, m := range []map[string]any{
		{"tipo": "aceitar"},
		{"tipo": "aceitar", "pedido": 12345},
		{"tipo": "aceitar", "pedido": longo},
		{"tipo": "recusar"},
		{"tipo": "recusar", "pedido": 12345},
		{"tipo": "recusar", "pedido": longo},
		{"tipo": "tirar"},
		{"tipo": "tirar", "participante": 12345},
		{"tipo": "tirar", "participante": longo},
	} {
		daPagina(t, pagina, m)
		aPaginaErro(t, pagina, "invalido")
	}
	semRecusa(t, pagina) // o canal continua
}

// asQuatro manda o aceitar, o recusar, o tirar e o encerrar, com ids bem formados, e confere o erro invalido de cada um.
func asQuatro(t *testing.T, pagina *websocket.Conn, pedido, participante string) {
	t.Helper()
	for _, m := range []map[string]any{
		{"tipo": "aceitar", "pedido": pedido},
		{"tipo": "recusar", "pedido": pedido},
		{"tipo": "tirar", "participante": participante},
		{"tipo": "encerrar"},
	} {
		daPagina(t, pagina, m)
		aPaginaErro(t, pagina, "invalido")
	}
}

func TestCanalComum_RespostasNaoValem(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	app := c.colegaNaReuniao(t, r.Codigo)
	carlos := c.lista(t, c.kCarlos, r.Codigo).Participantes[0].ID

	// Antes do pedir, o canal não tem pedido: as quatro não valem, e o canal continua.
	bia := c.canal(t, r.Codigo)
	asQuatro(t, bia, "0123456789abcdef", carlos)
	daPagina(t, bia, map[string]any{"tipo": "pedir", "nome": "Bia Ramos"})
	aPaginaTipo(t, bia, "aguardando")
	pedidoBia := pedidoDe(t, app, "Bia Ramos")

	// A Maria, aceita: as quatro também não valem, nem com o pedido da Bia nem com o Carlos.
	maria := c.canal(t, r.Codigo)
	c.aceita(t, r.Codigo, app, maria, "Maria Lima")
	asQuatro(t, maria, pedidoBia, carlos)
	daPagina(t, maria, map[string]any{"tipo": "senha"})
	aPaginaTipo(t, maria, "senha")
	// Nada mudou: o Carlos continua na reunião, e o pedido da Bia espera.
	if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 1 || len(l.Pedidos) != 1 || l.Pedidos[0].ID != pedidoBia {
		t.Fatalf("a lista é %+v", l)
	}
}

func TestCanalComum_DepoisDoVoltar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	app := c.colegaNaReuniao(t, r.Codigo)
	carlos := c.lista(t, c.kCarlos, r.Codigo).Participantes[0].ID
	maria := c.canal(t, r.Codigo)
	m := c.aceita(t, r.Codigo, app, maria, "Maria Lima")
	part, _ := m["participante"].(string)
	volta, _ := m["volta"].(string)
	c.entrou(t, r.Codigo, part)
	maria.Close(websocket.StatusNormalClosure, "")

	nova := c.voltaDoCanal(t, r.Codigo, part, volta)
	aPaginaTipo(t, nova, "voltou")
	asQuatro(t, nova, "0123456789abcdef", carlos)
	if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 2 {
		t.Fatalf("a lista é %+v", l)
	}
}

func TestCanalDeColega_ContaNoLimite(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, _, _ := c.carlosNaReuniao(t, r.Codigo) // o entrar é a primeira do minuto
	for range 19 {
		daPagina(t, pagina, map[string]any{"tipo": "recusar", "pedido": "0123456789abcdef"})
		recusaDoCanal(t, pagina, "recusar", "naoEncontrado")
	}
	daPagina(t, pagina, map[string]any{"tipo": "encerrar"})
	aPaginaErro(t, pagina, "limite")
	// O encerrar além do limite não chegou ao gerente: a reunião continua.
	if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 1 {
		t.Fatalf("a lista é %+v", l)
	}
	if cs := c.a.Video.Comandos(); len(cs) != 0 {
		t.Fatalf("o agente recebeu %q", cs)
	}
}

func TestCanalDeColega_DepoisDoVoltar(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, carlos, volta := c.carlosNaReuniao(t, r.Codigo)
	pagina.Close(websocket.StatusNormalClosure, "")

	// O canal novo é aberto com um bilhete comum (o abrir sem corpo): quem diz que ele é de colega é o participante.
	nova := c.voltaDoCanal(t, r.Codigo, carlos, volta)
	aPaginaTipo(t, nova, "voltou")
	soOCarlos(t, aPaginaTipo(t, nova, "participantes"), carlos)
	maria, pedido := pedeAMaria(t, c, r.Codigo, nova)
	daPagina(t, nova, map[string]any{"tipo": "aceitar", "pedido": pedido})
	aPaginaTipo(t, maria, "aceito")
	soOCarlos(t, aPaginaTipo(t, nova, "participantes"), carlos)
}
