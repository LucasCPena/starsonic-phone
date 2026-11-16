package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video/videotest"
)

// ---------- Os apoios ----------

type reuniaoResp struct {
	Codigo      string  `json:"codigo"`
	Link        string  `json:"link"`
	Tipo        string  `json:"tipo"`
	Assunto     *string `json:"assunto"`
	Inicio      *int64  `json:"inicio"`
	ValeAte     *int64  `json:"valeAte"`
	CriouEu     bool    `json:"criouEu"`
	Acontecendo bool    `json:"acontecendo"`
	Pessoas     int     `json:"pessoas"`
}

type acessoResp struct {
	Participante string `json:"participante"`
	Senha        string `json:"senha"`
	Turn         struct {
		URLs    []string `json:"urls"`
		Usuario string   `json:"usuario"`
		Senha   string   `json:"senha"`
	} `json:"turn"`
	Video struct {
		WSS string `json:"wss"`
		URI string `json:"uri"`
		SIP string `json:"sip"`
	} `json:"video"`
	Reuniao reuniaoResp `json:"reuniao"`
}

type listaResp struct {
	Participantes []struct {
		ID     string `json:"id"`
		Nome   string `json:"nome"`
		DeFora bool   `json:"deFora"`
		Tela   bool   `json:"tela"`
	} `json:"participantes"`
	Pedidos []struct {
		ID   string `json:"id"`
		Nome string `json:"nome"`
	} `json:"pedidos"`
}

var (
	hex16 = regexp.MustCompile(`^[0-9a-f]{16}$`)
	// alfabeto é o do código da reunião.
	alfabeto = "abcdefghjkmnpqrstvwxyz23456789"
)

// codigoQueNaoExiste é um código bem formado de que nenhuma reunião é dona: o i-ésimo de uma sequência.
func codigoQueNaoExiste(i int) string {
	return "aaaaaaaa" + string(alfabeto[(i/30)%30]) + string(alfabeto[i%30])
}

// cenaR são duas empresas com as reuniões liberadas: a ACME (a Ana, o Carlos e a Bia) e a Beta (o Davi).
type cenaR struct {
	a                *apitest.Ambiente
	acme, beta       banco.Empresa
	kAna, kCarlos    string
	kBia, kDavi      string
	ana, carlos, bia apitest.Pessoa
	davi             apitest.Pessoa
	inicioPadrao     int64 // daqui a 1 hora, em ms
}

func novaCenaR(t *testing.T) *cenaR {
	t.Helper()
	a := apitest.Novo(t)
	c := &cenaR{a: a, acme: a.Empresa("ACME Comércio Ltda"), beta: a.Empresa("Beta Serviços")}
	a.LiberarReunioes(c.acme.ID)
	a.LiberarReunioes(c.beta.ID)
	c.kAna, c.ana = a.LigarComPessoa(c.acme, "2001", "Ana Souza")
	c.kCarlos, c.carlos = a.LigarComPessoa(c.acme, "2003", "Carlos Lima")
	c.kBia, c.bia = a.LigarComPessoa(c.acme, "2004", "Bia Ramos")
	c.kDavi, c.davi = a.LigarComPessoa(c.beta, "2003", "Davi Alves")
	c.inicioPadrao = a.Relogio.Agora().Add(time.Hour).UnixMilli()
	return c
}

func (c *cenaR) criar(chave string, corpo any) *http.Response {
	return c.a.Pedir(chave, "POST", "/api/v1/reunioes", corpo)
}

// marcada cria uma reunião marcada pela pessoa da chave, que começa daqui a uma hora.
func (c *cenaR) marcada(t *testing.T, chave string) reuniaoResp {
	t.Helper()
	resp := c.criar(chave, map[string]any{"assunto": "Planejamento", "inicio": c.inicioPadrao})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[struct {
		Reuniao reuniaoResp `json:"reuniao"`
	}](t, resp).Reuniao
}

func (c *cenaR) entrarEm(chave, codigo string) *http.Response {
	return c.a.Pedir(chave, "POST", "/api/v1/reunioes/"+codigo+"/entrar", nil)
}

// entrar é o entrar que tem de dar 200.
func (c *cenaR) entrar(t *testing.T, chave, codigo string) acessoResp {
	t.Helper()
	resp := c.entrarEm(chave, codigo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("entrar respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[acessoResp](t, resp)
}

func (c *cenaR) sala(t *testing.T, codigo string) string {
	t.Helper()
	r, err := c.a.Banco.ReuniaoPorCodigo(t.Context(), codigo)
	if err != nil {
		t.Fatal(err)
	}
	return r.Sala
}

// entrou é o evento "entrou" do agente: a câmera do participante entrou na sala da reunião.
func (c *cenaR) entrou(t *testing.T, codigo, participante string) {
	t.Helper()
	c.a.Gerente.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: c.sala(t, codigo), Participante: participante})
}

// entrouNaReuniao faz a pessoa entrar (o entrar e o entrou do agente) e devolve o participante.
func (c *cenaR) entrouNaReuniao(t *testing.T, chave, codigo string) string {
	t.Helper()
	ac := c.entrar(t, chave, codigo)
	c.entrou(t, codigo, ac.Participante)
	return ac.Participante
}

func (c *cenaR) lista(t *testing.T, chave, codigo string) listaResp {
	t.Helper()
	resp := c.a.Pedir(chave, "GET", "/api/v1/reunioes/"+codigo+"/participantes", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("participantes respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[listaResp](t, resp)
}

// canalDaPagina é a página de quem é de fora, para o gerente.
type canalDaPagina struct {
	mu     sync.Mutex
	msgs   []map[string]any
	fechou bool
}

func (p *canalDaPagina) Mandar(msg any) {
	b, _ := json.Marshal(msg)
	var m map[string]any
	json.Unmarshal(b, &m)
	p.mu.Lock()
	p.msgs = append(p.msgs, m)
	p.mu.Unlock()
}

func (p *canalDaPagina) Fechar() {
	p.mu.Lock()
	p.fechou = true
	p.mu.Unlock()
}

func (p *canalDaPagina) tipos() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var l []string
	for _, m := range p.msgs {
		s, _ := m["tipo"].(string)
		l = append(l, s)
	}
	return l
}

// pedirDeFora faz alguém de fora pedir para entrar na reunião, pelo gerente.
func (c *cenaR) pedirDeFora(t *testing.T, codigo, nome string) *canalDaPagina {
	t.Helper()
	r, err := c.a.Banco.ReuniaoPorCodigo(t.Context(), codigo)
	if err != nil {
		t.Fatal(err)
	}
	canal := &canalDaPagina{}
	if _, err := c.a.Gerente.Pedir(t.Context(), r, nome, canal); err != nil {
		t.Fatalf("Pedir: %v", err)
	}
	return canal
}

func contextoAte(t time.Time) (context.Context, context.CancelFunc) {
	return context.WithDeadline(context.Background(), t)
}

// aceito é o participante que a página recebeu no aceito ("" se ele não chegou).
func (p *canalDaPagina) aceito() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, m := range p.msgs {
		if m["tipo"] == "aceito" {
			s, _ := m["participante"].(string)
			return s
		}
	}
	return ""
}

// esperarEvento lê a conexão até chegar um evento do tipo, pulando os outros.
func esperarEvento(t *testing.T, conn *websocket.Conn, tipo string) map[string]any {
	t.Helper()
	for range 20 {
		ev := apitest.LerEvento[map[string]any](t, conn)
		if ev["tipo"] == tipo {
			return ev
		}
	}
	t.Fatalf("nenhum evento %q em 20 eventos", tipo)
	return nil
}

// semEventoDe confere que nada do tipo chega pela conexão em d (os de outros tipos passam).
func semEventoDe(t *testing.T, conn *websocket.Conn, tipos []string, d time.Duration) {
	t.Helper()
	fim := time.Now().Add(d)
	for time.Now().Before(fim) {
		ctx, cancel := contextoAte(fim)
		_, dados, err := conn.Read(ctx)
		cancel()
		if err != nil {
			return
		}
		var ev map[string]any
		json.Unmarshal(dados, &ev)
		if s, _ := ev["tipo"].(string); slices.Contains(tipos, s) {
			t.Fatalf("chegou %s; não queria", dados)
		}
	}
}

// ---------- Criar ----------

func TestCriar_Marcada(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	inicio := time.Date(2026, 11, 12, 13, 0, 0, 0, time.UTC).UnixMilli()
	valeAteDoDia := time.Date(2026, 11, 13, 2, 59, 59, 999_000_000, time.UTC).UnixMilli() // 23:59:59,999 em Brasília

	t.Run("sem valeAte vale até o fim do dia em Brasília", func(t *testing.T) {
		a := a.Com(t)
		resp := c.criar(c.kAna, map[string]any{"assunto": "Planejamento", "inicio": inicio})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		r := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
		if len(r.Codigo) != 10 || r.Link != a.Base+"/r/"+r.Codigo {
			t.Fatalf("codigo %q, link %q; queria %q", r.Codigo, r.Link, a.Base+"/r/"+r.Codigo)
		}
		if r.Tipo != "marcada" || r.Assunto == nil || *r.Assunto != "Planejamento" ||
			r.Inicio == nil || *r.Inicio != inicio || r.ValeAte == nil || *r.ValeAte != valeAteDoDia ||
			!r.CriouEu || r.Acontecendo || r.Pessoas != 0 {
			t.Fatalf("reunião = %+v", r)
		}
		if *r.ValeAte != 1794538799999 {
			t.Fatalf("valeAte = %d", *r.ValeAte)
		}
	})

	t.Run("o criador é a pessoa do computador, nunca o corpo", func(t *testing.T) {
		resp := c.criar(c.kAna, map[string]any{"inicio": inicio, "criouId": c.carlos.ID, "criou": c.carlos.ID,
			"empresaId": c.beta.ID, "empresa": c.beta.ID, "tipo": "naHora", "sala": "x", "codigo": "aaaaaaaaaa"})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		r := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
		if r.Tipo != "marcada" || r.Codigo == "aaaaaaaaaa" || !r.CriouEu {
			t.Fatalf("reunião = %+v", r)
		}
		b, err := c.a.Banco.ReuniaoPorCodigo(t.Context(), r.Codigo)
		if err != nil {
			t.Fatal(err)
		}
		if b.CriouID != c.ana.ID || b.EmpresaID != c.acme.ID || b.Tipo != banco.TipoMarcada {
			t.Fatalf("no banco: criou %d (queria %d), empresa %d (queria %d), tipo %q",
				b.CriouID, c.ana.ID, b.EmpresaID, c.acme.ID, b.Tipo)
		}
		if r.Assunto != nil {
			t.Fatalf("sem assunto, o assunto é null; veio %q", *r.Assunto)
		}
	})

	t.Run("com valeAte", func(t *testing.T) {
		valeAte := inicio + (2 * time.Hour).Milliseconds()
		resp := c.criar(c.kAna, map[string]any{"inicio": inicio, "valeAte": valeAte})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		r := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
		if r.ValeAte == nil || *r.ValeAte != valeAte {
			t.Fatalf("valeAte = %v; queria %d", r.ValeAte, valeAte)
		}
	})

	t.Run("31 dias valem, 31 dias e 1 ms não", func(t *testing.T) {
		trinta := (31 * 24 * time.Hour).Milliseconds()
		if resp := c.criar(c.kAna, map[string]any{"inicio": inicio, "valeAte": inicio + trinta}); resp.StatusCode != http.StatusCreated {
			t.Fatalf("31 dias respondeu %d", resp.StatusCode)
		}
		esperarCampo(t, c.criar(c.kAna, map[string]any{"inicio": inicio, "valeAte": inicio + trinta + 1}), "valeAte")
	})

	t.Run("o assunto é aparado, e vazio vale null", func(t *testing.T) {
		resp := c.criar(c.kAna, map[string]any{"assunto": "  Planejamento  ", "inicio": inicio})
		r := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
		if r.Assunto == nil || *r.Assunto != "Planejamento" {
			t.Fatalf("assunto = %v", r.Assunto)
		}
		for _, vazio := range []any{"", "   ", nil} {
			resp := c.criar(c.kAna, map[string]any{"assunto": vazio, "inicio": inicio})
			if resp.StatusCode != http.StatusCreated {
				t.Fatalf("assunto %v respondeu %d", vazio, resp.StatusCode)
			}
			r := apitest.LerJSON[struct {
				Reuniao reuniaoResp `json:"reuniao"`
			}](t, resp).Reuniao
			if r.Assunto != nil {
				t.Fatalf("assunto %v virou %q; queria null", vazio, *r.Assunto)
			}
		}
		if resp := c.criar(c.kAna, map[string]any{"assunto": strings.Repeat("ã", 120), "inicio": inicio}); resp.StatusCode != http.StatusCreated {
			t.Fatalf("120 caracteres respondeu %d", resp.StatusCode)
		}
	})

	agora := a.Relogio.Agora().UnixMilli()
	invalidos := []struct {
		nome  string
		corpo any
		campo string
	}{
		{"assunto de 121 caracteres", map[string]any{"assunto": strings.Repeat("ã", 121), "inicio": inicio}, "assunto"},
		{"assunto com controle", map[string]any{"assunto": "a\x07b", "inicio": inicio}, "assunto"},
		{"sem inicio", map[string]any{"assunto": "Planejamento"}, "inicio"},
		{"inicio null", map[string]any{"inicio": nil}, "inicio"},
		{"inicio zero", map[string]any{"inicio": 0}, "inicio"},
		{"inicio negativo", map[string]any{"inicio": -5}, "inicio"},
		{"inicio gigante", map[string]any{"inicio": int64(9_000_000_000_000_000)}, "inicio"},
		{"valeAte antes do inicio", map[string]any{"inicio": inicio, "valeAte": inicio - 1}, "valeAte"},
		{"valeAte igual ao inicio", map[string]any{"inicio": inicio, "valeAte": inicio}, "valeAte"},
		// Com o inicio no passado, o valeAte é depois dele e ainda assim não é depois de agora.
		{"valeAte igual a agora", map[string]any{"inicio": agora - 3_600_000, "valeAte": agora}, "valeAte"},
		{"valeAte antes de agora", map[string]any{"inicio": agora - 7_200_000, "valeAte": agora - 3_600_000}, "valeAte"},
		// Sem valeAte, o dia do inicio já acabou em São Paulo (02:59:59,999Z do dia 4): o campo é o que a pessoa mandou.
		{"o dia do inicio já acabou", map[string]any{"inicio": time.Date(2026, 11, 3, 15, 0, 0, 0, time.UTC).UnixMilli()}, "inicio"},
	}
	for _, tc := range invalidos {
		t.Run(tc.nome, func(t *testing.T) {
			esperarCampo(t, c.criar(c.kAna, tc.corpo), tc.campo)
		})
	}

	t.Run("o inicio de hoje, que já passou, vale se o dia não acabou", func(t *testing.T) {
		// 11h Z é 08h em Brasília no dia 4: o dia acaba às 02:59:59,999Z do dia 5, depois de agora.
		resp := c.criar(c.kAna, map[string]any{"inicio": agora - 3_600_000})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d", resp.StatusCode)
		}
	})

	t.Run("JSON que não dá para ler vem sem campo", func(t *testing.T) {
		e := esperarErro(t, c.criar(c.kAna, "{não é json"), 400, "invalido")
		if e.Campo != "" {
			t.Fatalf("campo = %q", e.Campo)
		}
		esperarErro(t, c.criar(c.kAna, map[string]any{"inicio": "amanhã"}), 400, "invalido")
	})

	t.Run("sem a pessoa da vez", func(t *testing.T) {
		sem := a.Ligar(c.acme.Codigo, "SEM-PESSOA")
		esperarErro(t, c.criar(sem, map[string]any{"inicio": inicio}), 409, "pessoa")
	})
	t.Run("sem chave", func(t *testing.T) {
		esperarErro(t, c.criar("", map[string]any{"inicio": inicio}), 401, "chave")
	})
}

func esperarCampo(t *testing.T, resp *http.Response, campo string) {
	t.Helper()
	e := esperarErro(t, resp, 400, "invalido")
	if e.Campo != campo {
		t.Fatalf("campo = %q; queria %q", e.Campo, campo)
	}
}

func TestCriar_MuitasReunioes(t *testing.T) {
	c := novaCenaR(t)
	valeAte := c.a.Relogio.Agora().Add(48 * time.Hour).UnixMilli()
	for range 100 {
		if _, err := c.a.Banco.CriarReuniao(t.Context(), banco.Reuniao{EmpresaID: c.acme.ID, Tipo: banco.TipoMarcada,
			Inicio: c.inicioPadrao, ValeAte: valeAte, CriouID: c.ana.ID}); err != nil {
			t.Fatal(err)
		}
	}
	esperarErro(t, c.criar(c.kAna, map[string]any{"inicio": c.inicioPadrao}), 409, "muitasReunioes")
	if resp := c.criar(c.kCarlos, map[string]any{"inicio": c.inicioPadrao}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("a outra pessoa tem as suas 100: status %d", resp.StatusCode)
	}
}

func TestCriar_SemReunioes(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("Sem Reuniões Ltda")
	chave, _ := a.LigarComPessoa(emp, "2001", "Ana Souza")
	inicio := a.Relogio.Agora().Add(time.Hour).UnixMilli()

	esperarErro(t, a.Pedir(chave, "POST", "/api/v1/reunioes", map[string]any{"inicio": inicio}), 403, "semReunioes")

	// Todas as rotas da seção 9 respondem assim, também quando o código não existe.
	rotas := []struct{ metodo, caminho string }{
		{"GET", "/api/v1/reunioes"},
		{"POST", "/api/v1/reunioes/agora"},
		{"DELETE", "/api/v1/reunioes/aaaaaaaaaa"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/entrar"},
		{"GET", "/api/v1/reunioes/aaaaaaaaaa/participantes"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/aceitar"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/recusar"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/tirar"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/encerrar"},
		{"POST", "/api/v1/reunioes/aaaaaaaaaa/tela"},
	}
	for _, r := range rotas {
		t.Run(r.metodo+" "+r.caminho, func(t *testing.T) {
			esperarErro(t, a.Com(t).Pedir(chave, r.metodo, r.caminho, map[string]string{"pedido": "x", "participante": "x"}), 403, "semReunioes")
		})
	}

	// Liberada na administração, a mesma empresa passa a poder (a empresa é lida a cada pedido).
	a.LiberarReunioes(emp.ID)
	if resp := a.Pedir(chave, "POST", "/api/v1/reunioes", map[string]any{"inicio": inicio}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("liberada: status %d", resp.StatusCode)
	}
}

// ---------- Minhas ----------

func TestMinhas(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	agora := a.Relogio.Agora()
	h := func(n int) int64 { return agora.Add(time.Duration(n) * time.Hour).UnixMilli() }

	criar := func(chave string, inicio int64, assunto string) reuniaoResp {
		t.Helper()
		resp := c.criar(chave, map[string]any{"assunto": assunto, "inicio": inicio, "valeAte": inicio + 3_600_000})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("criar respondeu %d", resp.StatusCode)
		}
		return apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
	}
	tarde := criar(c.kAna, h(5), "tarde")
	cedo := criar(c.kAna, h(2), "cedo")
	meio := criar(c.kAna, h(3), "meio")
	cancelada := criar(c.kAna, h(4), "cancelada")
	deCarlos := criar(c.kCarlos, h(1), "do Carlos")
	if resp := a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+cancelada.Codigo, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("cancelar respondeu %d", resp.StatusCode)
	}
	// Uma que já venceu, e uma naHora: não entram.
	if _, err := a.Banco.CriarReuniao(t.Context(), banco.Reuniao{EmpresaID: c.acme.ID, Tipo: banco.TipoMarcada,
		Inicio: h(-3), ValeAte: h(-1), CriouID: c.ana.ID, Assunto: "vencida"}); err != nil {
		t.Fatal(err)
	}
	if resp := a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("agora respondeu %d", resp.StatusCode)
	}

	lista := func(chave string) []reuniaoResp {
		t.Helper()
		resp := a.Pedir(chave, "GET", "/api/v1/reunioes", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("minhas respondeu %d", resp.StatusCode)
		}
		return apitest.LerJSON[struct {
			Reunioes []reuniaoResp `json:"reunioes"`
		}](t, resp).Reunioes
	}
	got := lista(c.kAna)
	var codigos []string
	for _, r := range got {
		codigos = append(codigos, r.Codigo)
		if !r.CriouEu || r.Tipo != "marcada" || r.Link != a.Base+"/r/"+r.Codigo {
			t.Fatalf("reunião %+v", r)
		}
	}
	if want := []string{cedo.Codigo, meio.Codigo, tarde.Codigo}; !slices.Equal(codigos, want) {
		t.Fatalf("minhas da Ana = %v; queria %v (pelo inicio)", codigos, want)
	}
	if got := lista(c.kCarlos); len(got) != 1 || got[0].Codigo != deCarlos.Codigo {
		t.Fatalf("minhas do Carlos = %+v", got)
	}

	// Quem está nela aparece em acontecendo e pessoas.
	c.entrouNaReuniao(t, c.kCarlos, cedo.Codigo)
	got = lista(c.kAna)
	if !got[0].Acontecendo || got[0].Pessoas != 1 || got[1].Acontecendo || got[1].Pessoas != 0 {
		t.Fatalf("acontecendo e pessoas: %+v", got)
	}

	// Sem nenhuma, a lista vem vazia, não null.
	resp := a.Pedir(c.kBia, "GET", "/api/v1/reunioes", nil)
	var cru map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&cru); err != nil || string(cru["reunioes"]) != "[]" {
		t.Fatalf("lista vazia = %s (%v)", cru["reunioes"], err)
	}
}

// ---------- Cancelar ----------

func TestCancelar(t *testing.T) {
	c := novaCenaR(t)
	a := c.a

	t.Run("quem criou cancela, e o entrar depois dá 404", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("cancelar respondeu %d", resp.StatusCode)
		}
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
		// Cancelar de novo não é erro.
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("cancelar de novo respondeu %d", resp.StatusCode)
		}
		// Já não está nas minhas.
		resp := c.a.Pedir(c.kAna, "GET", "/api/v1/reunioes", nil)
		if l := apitest.LerJSON[struct {
			Reunioes []reuniaoResp `json:"reunioes"`
		}](t, resp).Reunioes; len(l) != 0 {
			t.Fatalf("minhas = %+v", l)
		}
	})

	t.Run("outra pessoa da empresa recebe 403 proibido", func(t *testing.T) {
		r := c.marcada(t, c.kAna)
		esperarErro(t, a.Pedir(c.kCarlos, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil), 403, "proibido")
		// Segue valendo.
		c.entrar(t, c.kCarlos, r.Codigo)
	})

	t.Run("alguém de outra empresa, um código que não existe e um malformado recebem 404", func(t *testing.T) {
		r := c.marcada(t, c.kAna)
		esperarErro(t, a.Pedir(c.kDavi, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil), 404, "naoEncontrado")
		esperarErro(t, a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/aaaaaaaaaa", nil), 404, "naoEncontrado")
		esperarErro(t, a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/curto", nil), 404, "naoEncontrado")
		c.entrar(t, c.kCarlos, r.Codigo) // a de Ana não foi cancelada
	})

	t.Run("com gente nela, encerra no vídeo e todos saem", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		conn := c.a.Conectar(c.kCarlos)
		c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("cancelar respondeu %d", resp.StatusCode)
		}
		if got := c.a.Video.Comandos(); !slices.Contains(got, "encerrar "+c.sala(t, r.Codigo)) {
			t.Fatalf("comandos = %v; queria o encerrar da sala", got)
		}
		esperarEvento(t, conn, "reuniaoAcabou")
	})

	t.Run("com o vídeo fora do ar, cancela do mesmo jeito", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Video.DefinirNoAr(false)
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("cancelar respondeu %d", resp.StatusCode)
		}
		c.a.Video.DefinirNoAr(true)
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
	})
}

// videoQueEspera é o agente falso cujo Encerrar espera o teste soltar, e guarda o erro do contexto que recebeu.
type videoQueEspera struct {
	*videotest.Falso
	chegou chan struct{} // fechado quando o Encerrar começa
	solto  chan struct{} // o teste o fecha para o Encerrar seguir
	ctxErr chan error    // o ctx.Err() do Encerrar, depois de solto
}

func (v *videoQueEspera) Encerrar(ctx context.Context, sala string) error {
	close(v.chegou)
	<-v.solto
	v.ctxErr <- ctx.Err()
	return v.Falso.Encerrar(ctx, sala)
}

// Um cliente que desliga no meio do cancelar não corta o encerrar no servidor de vídeo (o contexto dele não é o do
// pedido), e o banco já cancelou antes: ninguém novo entra enquanto o vídeo encerra.
func TestCancelar_ClienteQueDesliga(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	v := &videoQueEspera{Falso: c.a.Video, chegou: make(chan struct{}), solto: make(chan struct{}), ctxErr: make(chan error, 1)}
	c.a.Gerente.Ligar(v)

	ctx, desligar := context.WithCancel(t.Context())
	defer desligar()
	req, err := http.NewRequestWithContext(ctx, "DELETE", c.a.Servidor.URL+"/api/v1/reunioes/"+r.Codigo, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+c.kAna)
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		if resp, err := c.a.Servidor.Client().Do(req); err == nil {
			resp.Body.Close()
		}
	}()
	select {
	case <-v.chegou:
	case <-time.After(5 * time.Second):
		t.Fatal("o cancelar não chegou ao encerrar do vídeo")
	}
	// O banco já cancelou: o entrar dá 404, mesmo com o vídeo ainda encerrando.
	esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")

	desligar() // o cliente desliga
	<-feito
	time.Sleep(300 * time.Millisecond) // o servidor percebe que o cliente foi embora
	close(v.solto)
	select {
	case err := <-v.ctxErr:
		if err != nil {
			t.Fatalf("o contexto do encerrar tinha erro %v; o do pedido não vale aqui", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("o encerrar não voltou")
	}
}

// ---------- Agora ----------

func TestAgora(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	connCarlos := a.Conectar(c.kCarlos) // o ramal 2003 da ACME
	connDavi := a.Conectar(c.kDavi)     // o ramal 2003 da Beta
	connBia := a.Conectar(c.kBia)       // o 2004, que não foi convidada
	connAna := a.Conectar(c.kAna)       // quem convida

	resp := a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": []string{"2003", "9999", "2001"}})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	r := apitest.LerJSON[struct {
		Reuniao reuniaoResp `json:"reuniao"`
	}](t, resp).Reuniao
	if len(r.Codigo) != 10 || r.Link != a.Base+"/r/"+r.Codigo || r.Tipo != "naHora" ||
		r.Assunto != nil || r.Inicio != nil || r.ValeAte != nil || !r.CriouEu || r.Acontecendo || r.Pessoas != 0 {
		t.Fatalf("reunião = %+v", r)
	}
	b, err := a.Banco.ReuniaoPorCodigo(t.Context(), r.Codigo)
	if err != nil || b.Tipo != banco.TipoNaHora || b.CriouID != c.ana.ID || b.EmpresaID != c.acme.ID {
		t.Fatalf("no banco: %+v (%v)", b, err)
	}

	// O Carlos (ramal 2003 da ACME) recebe o reuniaoAgora, com a reunião nova e o convidador.
	ev := esperarEvento(t, connCarlos, "reuniaoAgora")
	rv, _ := ev["reuniao"].(map[string]any)
	if rv["codigo"] != r.Codigo || rv["link"] != r.Link || rv["tipo"] != "naHora" || rv["assunto"] != nil ||
		rv["inicio"] != nil || rv["valeAte"] != nil || rv["acontecendo"] != false || rv["pessoas"] != float64(0) {
		t.Fatalf("reuniao do evento = %v; queria a naHora da resposta (%+v)", rv, r)
	}
	de, _ := ev["de"].(map[string]any)
	if de["id"] != float64(c.ana.ID) || de["ramal"] != "2001" || de["nome"] != "Ana Souza" {
		t.Fatalf("de = %v; queria a Ana", de)
	}
	// A Reunião do evento é a do convidado: ele não a criou.
	if rv, _ := ev["reuniao"].(map[string]any); rv["criouEu"] != false {
		t.Fatalf("criouEu do convidado = %v; queria false", rv["criouEu"])
	}

	apitest.SemEvento(t, connDavi, 300*time.Millisecond)
	semEventoDe(t, connBia, []string{"reuniaoAgora"}, 100*time.Millisecond)
	semEventoDe(t, connAna, []string{"reuniaoAgora"}, 100*time.Millisecond)

	t.Run("sem corpo e com o corpo vazio", func(t *testing.T) {
		for _, corpo := range []any{nil, "{}", `{"ramais":[]}`, `{"ramais":null}`} {
			if resp := a.Com(t).Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", corpo); resp.StatusCode != http.StatusCreated {
				t.Fatalf("corpo %v respondeu %d", corpo, resp.StatusCode)
			}
		}
	})
	t.Run("até 9 ramais; 10 dão invalido", func(t *testing.T) {
		nove := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"}
		if resp := a.Com(t).Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": nove}); resp.StatusCode != http.StatusCreated {
			t.Fatalf("9 ramais: status %d", resp.StatusCode)
		}
		dez := append(slices.Clone(nove), "10")
		esperarCampo(t, a.Com(t).Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": dez}), "ramais")
	})
	t.Run("um ramal que não vale dá invalido", func(t *testing.T) {
		for _, ruim := range []string{"", "a b", "a@b", strings.Repeat("9", 33)} {
			esperarCampo(t, a.Com(t).Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": []string{ruim}}), "ramais")
		}
	})
	t.Run("ramais que não são uma lista de textos", func(t *testing.T) {
		esperarErro(t, a.Com(t).Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", `{"ramais":"2003"}`), 400, "invalido")
	})
}

func TestAgora_OsDoisComputadoresDaPessoa(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	// O Carlos tem dois computadores conectados: os dois recebem. Quem saiu do chat não recebe.
	k2 := a.Ligar(c.acme.Codigo, "SEGUNDO")
	a.Entrar(k2, "2003", "Carlos Lima")
	conn1, conn2 := a.Conectar(c.kCarlos), a.Conectar(k2)
	if resp := a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": []string{"2003"}}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	esperarEvento(t, conn1, "reuniaoAgora")
	esperarEvento(t, conn2, "reuniaoAgora")
}

// ---------- Entrar ----------

func TestEntrar_Colega(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)

	resp := c.entrarEm(c.kCarlos, r.Codigo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	ac := apitest.LerJSON[acessoResp](t, resp)
	if !hex16.MatchString(ac.Participante) || ac.Senha == "" {
		t.Fatalf("participante %q, senha %q", ac.Participante, ac.Senha)
	}
	if len(ac.Turn.URLs) != 2 ||
		ac.Turn.URLs[0] != "turn:video.exemplo.com.br:3478?transport=udp" ||
		ac.Turn.URLs[1] != "turns:video.exemplo.com.br:5349?transport=tcp" ||
		!strings.HasSuffix(ac.Turn.Usuario, ":"+ac.Participante) || ac.Turn.Senha == "" {
		t.Fatalf("turn = %+v", ac.Turn)
	}
	if ac.Video.WSS != c.a.Video.WSS() || ac.Video.URI != "sip:reuniao@video.exemplo.com.br" ||
		ac.Video.SIP != "sips:reuniao@video.exemplo.com.br:5061;transport=tls" {
		t.Fatalf("video = %+v", ac.Video)
	}
	if ac.Reuniao.Codigo != r.Codigo || ac.Reuniao.Link != r.Link || ac.Reuniao.Tipo != "marcada" ||
		ac.Reuniao.CriouEu || ac.Reuniao.Acontecendo || ac.Reuniao.Pessoas != 0 ||
		ac.Reuniao.Assunto == nil || *ac.Reuniao.Assunto != "Planejamento" {
		t.Fatalf("reuniao = %+v", ac.Reuniao)
	}

	// Cada entrar é um participante novo.
	outro := c.entrar(t, c.kCarlos, r.Codigo)
	if outro.Participante == ac.Participante || outro.Senha == ac.Senha {
		t.Fatal("o segundo entrar repetiu o participante ou a senha")
	}

	// Quem criou também entra, e o código vale em maiúsculas e com espaços.
	if got := c.entrar(t, c.kAna, strings.ToUpper(r.Codigo)); !got.Reuniao.CriouEu {
		t.Fatalf("a Ana criou: %+v", got.Reuniao)
	}
	if got := c.entrar(t, c.kBia, url.PathEscape(" "+strings.ToUpper(r.Codigo[:5])+" "+r.Codigo[5:]+" ")); got.Reuniao.Codigo != r.Codigo {
		t.Fatalf("código normalizado: %+v", got.Reuniao)
	}

	// Depois do entrou, a reunião está acontecendo.
	c.entrou(t, r.Codigo, ac.Participante)
	got := c.entrar(t, c.kBia, r.Codigo)
	if !got.Reuniao.Acontecendo || got.Reuniao.Pessoas != 1 {
		t.Fatalf("acontecendo %v, pessoas %d", got.Reuniao.Acontecendo, got.Reuniao.Pessoas)
	}
}

func TestEntrar_NaHora(t *testing.T) {
	c := novaCenaR(t)
	resp := c.a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", nil)
	r := apitest.LerJSON[struct {
		Reuniao reuniaoResp `json:"reuniao"`
	}](t, resp).Reuniao
	if ac := c.entrar(t, c.kCarlos, r.Codigo); ac.Reuniao.Tipo != "naHora" || ac.Reuniao.ValeAte != nil {
		t.Fatalf("reuniao = %+v", ac.Reuniao)
	}
}

func TestEntrar_OutraEmpresa(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	esperarErro(t, c.entrarEm(c.kDavi, r.Codigo), 403, "outraEmpresa")

	// A reunião de teste da administração é de ninguém: para o app, é de outra empresa.
	teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	esperarErro(t, c.entrarEm(c.kAna, teste.Codigo), 403, "outraEmpresa")
}

func TestEntrar_Erros(t *testing.T) {
	c := novaCenaR(t)
	a := c.a

	t.Run("um código que não existe, e um malformado", func(t *testing.T) {
		for _, codigo := range []string{"aaaaaaaaaa", "curto", "k7q49xwph0", "k7q49xwph", "k7q49xwpht2", "k7q4-9xwpht"} {
			esperarErro(t, c.entrarEm(c.kCarlos, codigo), 404, "naoEncontrado")
		}
	})

	t.Run("cancelada", func(t *testing.T) {
		r := c.marcada(t, c.kAna)
		a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil)
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
	})

	t.Run("vencida", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.entrar(t, c.kCarlos, r.Codigo)
		c.a.Relogio.Avancar(48 * time.Hour)
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
	})

	t.Run("a naHora que acabou", func(t *testing.T) {
		c := novaCenaR(t)
		r := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, c.a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", nil)).Reuniao
		b, _ := c.a.Banco.ReuniaoPorCodigo(t.Context(), r.Codigo)
		if err := c.a.Banco.AcabarReuniao(t.Context(), b.ID); err != nil {
			t.Fatal(err)
		}
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
	})

	t.Run("sem servidor de vídeo", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Video.DefinirNoAr(false)
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 503, "servidorVideo")
		c.a.Video.DefinirNoAr(true)
		c.entrar(t, c.kCarlos, r.Codigo)
	})

	t.Run("sem nenhum vídeo ligado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Gerente.Ligar(nil)
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 503, "servidorVideo")
	})

	t.Run("cheia", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 10 {
			c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
		}
		esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 409, "cheia")
		esperarErro(t, c.entrarEm(c.kAna, r.Codigo), 409, "cheia")
	})

	t.Run("servidor cheio", func(t *testing.T) {
		c := novaCenaR(t)
		// O limite padrão é de 2 reuniões ao mesmo tempo.
		r1, r2, r3 := c.marcada(t, c.kAna), c.marcada(t, c.kAna), c.marcada(t, c.kAna)
		c.entrouNaReuniao(t, c.kCarlos, r1.Codigo)
		c.entrouNaReuniao(t, c.kBia, r2.Codigo)
		esperarErro(t, c.entrarEm(c.kAna, r3.Codigo), 409, "servidorCheio")
		// Uma reunião que já acontece continua aceitando gente.
		c.entrar(t, c.kAna, r1.Codigo)
		// Quando o limite sobe, a terceira começa.
		if err := c.a.Banco.GuardarLimiteReunioes(t.Context(), 3); err != nil {
			t.Fatal(err)
		}
		c.entrar(t, c.kAna, r3.Codigo)
	})

	t.Run("sem chave e sem a pessoa da vez", func(t *testing.T) {
		esperarErro(t, c.entrarEm("", "aaaaaaaaaa"), 401, "chave")
		sem := a.Com(t).Ligar(c.acme.Codigo, "SEM-PESSOA")
		esperarErro(t, c.entrarEm(sem, "aaaaaaaaaa"), 409, "pessoa")
	})
}

// ---------- As tentativas ----------

func TestTentativas(t *testing.T) {
	// esperar429 confere o 429 tentativas, com o esperarSegundos de 1 a 60.
	esperar429 := func(t *testing.T, resp *http.Response) {
		t.Helper()
		e := esperarErro(t, resp, 429, "tentativas")
		if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
			t.Fatalf("esperarSegundos = %d; queria de 1 a 60", e.EsperarSegundos)
		}
	}

	t.Run("20 errados passam, o 21º dá 429, com código certo ou errado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for i := range 20 {
			codigo := codigoQueNaoExiste(i)
			if i%2 == 1 {
				codigo = "curto" // um malformado também conta
			}
			esperarErro(t, c.entrarEm(c.kCarlos, codigo), 404, "naoEncontrado")
		}
		esperar429(t, c.entrarEm(c.kCarlos, codigoQueNaoExiste(99)))
		esperar429(t, c.entrarEm(c.kCarlos, r.Codigo)) // até com o código certo
		esperar429(t, c.entrarEm(c.kBia, r.Codigo))    // o endereço é o mesmo, e a janela é dele
		// Passado o minuto, volta.
		c.a.Relogio.Avancar(61 * time.Second)
		c.entrar(t, c.kCarlos, r.Codigo)
	})

	t.Run("os que deram certo não contam", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 5 {
			c.entrar(t, c.kCarlos, r.Codigo)
		}
		for i := range 20 {
			esperarErro(t, c.entrarEm(c.kCarlos, codigoQueNaoExiste(i)), 404, "naoEncontrado")
		}
		esperar429(t, c.entrarEm(c.kCarlos, codigoQueNaoExiste(50)))
	})

	t.Run("a reunião cheia não conta", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 10 {
			c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
		}
		for range 25 {
			esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 409, "cheia")
		}
		esperarErro(t, c.entrarEm(c.kBia, codigoQueNaoExiste(1)), 404, "naoEncontrado") // e não 429
	})

	t.Run("o servidor de vídeo fora do ar e o servidor cheio não contam", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Video.DefinirNoAr(false)
		for range 25 {
			esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 503, "servidorVideo")
		}
		c.a.Video.DefinirNoAr(true)
		r1, r2 := c.marcada(t, c.kAna), c.marcada(t, c.kAna)
		c.entrouNaReuniao(t, c.kCarlos, r1.Codigo)
		c.entrouNaReuniao(t, c.kCarlos, r2.Codigo)
		for range 25 {
			esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 409, "servidorCheio")
		}
		esperarErro(t, c.entrarEm(c.kBia, codigoQueNaoExiste(2)), 404, "naoEncontrado")
	})

	t.Run("outraEmpresa e semReunioes contam", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 20 {
			esperarErro(t, c.entrarEm(c.kDavi, r.Codigo), 403, "outraEmpresa")
		}
		esperar429(t, c.entrarEm(c.kDavi, r.Codigo))

		c = novaCenaR(t)
		c.a.Banco.LiberarReunioes(t.Context(), c.acme.ID, false)
		for range 20 {
			esperarErro(t, c.entrarEm(c.kCarlos, "aaaaaaaaaa"), 403, "semReunioes")
		}
		esperar429(t, c.entrarEm(c.kCarlos, "aaaaaaaaaa"))
	})

	t.Run("o 429 tem o corpo e o status certos", func(t *testing.T) {
		c := novaCenaR(t)
		for i := range 20 {
			c.entrarEm(c.kCarlos, codigoQueNaoExiste(i))
		}
		resp := c.entrarEm(c.kCarlos, codigoQueNaoExiste(30))
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		var cru map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&cru); err != nil {
			t.Fatal(err)
		}
		if cru["erro"] != "tentativas" || len(cru) != 2 {
			t.Fatalf("corpo = %v", cru)
		}
	})
}

// ---------- Com a pessoa na reunião ----------

func TestNaReuniao_Rotas(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	r := c.marcada(t, c.kAna)
	base := "/api/v1/reunioes/" + r.Codigo
	corpoVazio := map[string]string{"pedido": "0123456789abcdef", "participante": "0123456789abcdef"}

	rotas := []struct{ metodo, caminho string }{
		{"GET", base + "/participantes"},
		{"POST", base + "/aceitar"},
		{"POST", base + "/recusar"},
		{"POST", base + "/tirar"},
		{"POST", base + "/encerrar"},
		{"POST", base + "/tela"},
	}

	// Antes do entrou do agente, a pessoa não está na reunião: mesmo com o entrar feito.
	acCarlos := c.entrar(t, c.kCarlos, r.Codigo)
	for _, rota := range rotas {
		esperarErro(t, a.Pedir(c.kCarlos, rota.metodo, rota.caminho, corpoVazio), 409, "foraDaReuniao")
	}
	if got := a.Video.Comandos(); len(got) != 0 {
		t.Fatalf("o vídeo recebeu %v antes de alguém estar na reunião", got)
	}

	c.entrou(t, r.Codigo, acCarlos.Participante)
	acAna := c.entrar(t, c.kAna, r.Codigo)
	c.entrou(t, r.Codigo, acAna.Participante)

	t.Run("participantes", func(t *testing.T) {
		l := c.lista(t, c.kCarlos, r.Codigo)
		if len(l.Participantes) != 2 || len(l.Pedidos) != 0 {
			t.Fatalf("lista = %+v", l)
		}
		nomes := map[string]string{}
		for _, p := range l.Participantes {
			if p.DeFora || p.Tela {
				t.Fatalf("participante %+v", p)
			}
			nomes[p.ID] = p.Nome
		}
		if nomes[acCarlos.Participante] != "Carlos Lima" || nomes[acAna.Participante] != "Ana Souza" {
			t.Fatalf("nomes = %v", nomes)
		}
		// A lista vazia de pedidos é [], não null.
		resp := a.Com(t).Pedir(c.kCarlos, "GET", base+"/participantes", nil)
		var cru map[string]json.RawMessage
		json.NewDecoder(resp.Body).Decode(&cru)
		if string(cru["pedidos"]) != "[]" {
			t.Fatalf("pedidos = %s", cru["pedidos"])
		}
	})

	t.Run("aceitar e recusar", func(t *testing.T) {
		a := a.Com(t)
		canalMaria := c.pedirDeFora(t, r.Codigo, "Maria Lima")
		canalJoao := c.pedirDeFora(t, r.Codigo, "João Dias")
		l := c.lista(t, c.kCarlos, r.Codigo)
		if len(l.Pedidos) != 2 {
			t.Fatalf("pedidos = %+v", l.Pedidos)
		}
		idMaria, idJoao := l.Pedidos[0].ID, l.Pedidos[1].ID
		if l.Pedidos[0].Nome != "Maria Lima" {
			idMaria, idJoao = idJoao, idMaria
		}

		if resp := a.Pedir(c.kCarlos, "POST", base+"/aceitar", map[string]string{"pedido": idMaria}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("aceitar respondeu %d", resp.StatusCode)
		}
		if !slices.Contains(canalMaria.tipos(), "aceito") {
			t.Fatalf("a página da Maria recebeu %v", canalMaria.tipos())
		}
		// O mesmo pedido outra vez: 409 jaRespondido.
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/aceitar", map[string]string{"pedido": idMaria}), 409, "jaRespondido")
		esperarErro(t, a.Pedir(c.kAna, "POST", base+"/recusar", map[string]string{"pedido": idMaria}), 409, "jaRespondido")
		// Um pedido que não existe.
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/aceitar", map[string]string{"pedido": "ffffffffffffffff"}), 404, "naoEncontrado")
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/recusar", map[string]string{"pedido": "ffffffffffffffff"}), 404, "naoEncontrado")

		if resp := a.Pedir(c.kAna, "POST", base+"/recusar", map[string]string{"pedido": idJoao}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("recusar respondeu %d", resp.StatusCode)
		}
		if got := canalJoao.tipos(); !slices.Contains(got, "recusado") {
			t.Fatalf("a página do João recebeu %v", got)
		}
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/recusar", map[string]string{"pedido": idJoao}), 409, "jaRespondido")

		// Os corpos que não valem.
		esperarCampo(t, a.Pedir(c.kCarlos, "POST", base+"/aceitar", map[string]string{}), "pedido")
		esperarCampo(t, a.Pedir(c.kCarlos, "POST", base+"/recusar", map[string]string{"pedido": ""}), "pedido")
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/aceitar", "{não é json"), 400, "invalido")
	})

	t.Run("tirar", func(t *testing.T) {
		a := a.Com(t)
		canal := c.pedirDeFora(t, r.Codigo, "Pedro Reis")
		id := c.lista(t, c.kCarlos, r.Codigo).Pedidos[0].ID
		a.Pedir(c.kCarlos, "POST", base+"/aceitar", map[string]string{"pedido": id})
		part := canal.aceito()
		if part == "" {
			t.Fatal("a página do Pedro não recebeu o aceito")
		}
		c.entrou(t, r.Codigo, part)
		l := c.lista(t, c.kCarlos, r.Codigo)
		if len(l.Participantes) != 3 {
			t.Fatalf("participantes = %+v", l.Participantes)
		}

		// Uma falha do agente (que não é o 404) dá 503, e o participante continua na lista.
		for _, falha := range []error{video.ErrSemResposta, video.ErrChave} {
			a.Video.DefinirErro(falha)
			esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/tirar", map[string]string{"participante": part}), 503, "servidorVideo")
			a.Video.DefinirErro(nil)
			if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 3 {
				t.Fatalf("depois da falha %v: participantes = %+v", falha, l.Participantes)
			}
		}
		if got := a.Video.Comandos(); len(got) != 0 {
			t.Fatalf("a falha não devia deixar comandos: %v", got)
		}

		if resp := a.Pedir(c.kCarlos, "POST", base+"/tirar", map[string]string{"participante": part}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("tirar respondeu %d", resp.StatusCode)
		}
		if got := a.Video.Comandos(); !slices.Equal(got, []string{"tirar " + c.sala(t, r.Codigo) + " " + part}) {
			t.Fatalf("comandos = %v", got)
		}
		if !slices.Contains(canal.tipos(), "tirado") {
			t.Fatalf("a página do Pedro recebeu %v", canal.tipos())
		}
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 2 {
			t.Fatalf("depois do tirar: %+v", l.Participantes)
		}
		// Quem não está na reunião: 404.
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/tirar", map[string]string{"participante": part}), 404, "naoEncontrado")
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/tirar", map[string]string{"participante": "ffffffffffffffff"}), 404, "naoEncontrado")
		esperarCampo(t, a.Pedir(c.kCarlos, "POST", base+"/tirar", map[string]string{}), "participante")
	})

	t.Run("tela", func(t *testing.T) {
		resp := a.Com(t).Pedir(c.kCarlos, "POST", base+"/tela", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("tela respondeu %d", resp.StatusCode)
		}
		corpo := apitest.LerJSON[map[string]string](t, resp)
		if len(corpo) != 1 || corpo["senha"] == "" {
			t.Fatalf("corpo = %v", corpo)
		}
		a.Video.DefinirNoAr(false)
		defer a.Video.DefinirNoAr(true)
		esperarErro(t, a.Com(t).Pedir(c.kCarlos, "POST", base+"/tela", nil), 503, "servidorVideo")
	})

	t.Run("encerrar com o agente fora do ar não encerra nada", func(t *testing.T) {
		a := a.Com(t)
		a.Video.DefinirErro(video.ErrSemResposta)
		esperarErro(t, a.Pedir(c.kCarlos, "POST", base+"/encerrar", nil), 503, "servidorVideo")
		a.Video.DefinirErro(nil)
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 2 {
			t.Fatalf("participantes = %+v", l.Participantes)
		}
	})

	t.Run("encerrar", func(t *testing.T) {
		a := a.Com(t)
		if resp := a.Pedir(c.kCarlos, "POST", base+"/encerrar", nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("encerrar respondeu %d", resp.StatusCode)
		}
		if got := a.Video.Comandos(); !slices.Contains(got, "encerrar "+c.sala(t, r.Codigo)) {
			t.Fatalf("comandos = %v", got)
		}
		// Todos saíram.
		esperarErro(t, a.Pedir(c.kCarlos, "GET", base+"/participantes", nil), 409, "foraDaReuniao")
		esperarErro(t, a.Pedir(c.kAna, "POST", base+"/tela", nil), 409, "foraDaReuniao")
		// A marcada continua valendo até o valeAte.
		c.entrar(t, c.kBia, r.Codigo)
	})

	t.Run("um código que não existe", func(t *testing.T) {
		for _, rota := range rotas {
			caminho := strings.Replace(rota.caminho, r.Codigo, "aaaaaaaaaa", 1)
			esperarErro(t, a.Com(t).Pedir(c.kCarlos, rota.metodo, caminho, corpoVazio), 404, "naoEncontrado")
			caminho = strings.Replace(rota.caminho, r.Codigo, "curto", 1)
			esperarErro(t, a.Com(t).Pedir(c.kCarlos, rota.metodo, caminho, corpoVazio), 404, "naoEncontrado")
		}
	})
}

// ---------- Os eventos ----------

func TestEventos_Reunioes(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	r := c.marcada(t, c.kAna)
	base := "/api/v1/reunioes/" + r.Codigo

	connCarlos, connAna, connBia := a.Conectar(c.kCarlos), a.Conectar(c.kAna), a.Conectar(c.kBia)
	c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
	c.entrouNaReuniao(t, c.kAna, r.Codigo)

	// Alguém de fora pede: os dois colegas na reunião recebem o reuniaoPedido.
	canalMaria := c.pedirDeFora(t, r.Codigo, "Maria Lima")
	var idPedido string
	for _, conn := range []*websocket.Conn{connCarlos, connAna} {
		ev := esperarEvento(t, conn, "reuniaoPedido")
		pedido, _ := ev["pedido"].(map[string]any)
		if ev["reuniao"] != r.Codigo || pedido["nome"] != "Maria Lima" || pedido["id"] == "" {
			t.Fatalf("reuniaoPedido = %v", ev)
		}
		idPedido, _ = pedido["id"].(string)
	}

	// A Ana aceita: o pedido acaba, e as listas mudam.
	if resp := a.Pedir(c.kAna, "POST", base+"/aceitar", map[string]string{"pedido": idPedido}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("aceitar respondeu %d", resp.StatusCode)
	}
	for _, conn := range []*websocket.Conn{connCarlos, connAna} {
		fim := esperarEvento(t, conn, "reuniaoPedidoFim")
		if fim["reuniao"] != r.Codigo || fim["pedido"] != idPedido {
			t.Fatalf("reuniaoPedidoFim = %v", fim)
		}
	}

	// A Maria entra na sala: a lista de participantes, que sai a cada mudança, passa a ter os três.
	c.entrou(t, r.Codigo, canalMaria.aceito())
	for _, conn := range []*websocket.Conn{connCarlos, connAna} {
		var ev map[string]any
		for range 10 {
			ev = esperarEvento(t, conn, "reuniaoParticipantes")
			if l, _ := ev["participantes"].([]any); len(l) == 3 {
				break
			}
		}
		l, _ := ev["participantes"].([]any)
		pedidos, ok := ev["pedidos"].([]any)
		if ev["reuniao"] != r.Codigo || len(l) != 3 || !ok || len(pedidos) != 0 {
			t.Fatalf("reuniaoParticipantes = %v", ev)
		}
	}

	// Quem não está na reunião não recebe os eventos dela.
	semEventoDe(t, connBia, []string{"reuniaoPedido", "reuniaoPedidoFim", "reuniaoParticipantes", "reuniaoAcabou"}, 300*time.Millisecond)

	// A Ana encerra: quem estava nela recebe o reuniaoAcabou.
	if resp := a.Pedir(c.kAna, "POST", base+"/encerrar", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("encerrar respondeu %d", resp.StatusCode)
	}
	for _, conn := range []*websocket.Conn{connCarlos, connAna} {
		if ev := esperarEvento(t, conn, "reuniaoAcabou"); ev["reuniao"] != r.Codigo {
			t.Fatalf("reuniaoAcabou = %v", ev)
		}
	}
}

// ---------- O isolamento ----------

func TestIsolamento_Reunioes(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	r := c.marcada(t, c.kAna)
	c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
	base := "/api/v1/reunioes/" + r.Codigo

	// O Davi, da Beta, não vê as reuniões da ACME.
	resp := a.Pedir(c.kDavi, "GET", "/api/v1/reunioes", nil)
	if l := apitest.LerJSON[struct {
		Reunioes []reuniaoResp `json:"reunioes"`
	}](t, resp).Reunioes; len(l) != 0 {
		t.Fatalf("minhas do Davi = %+v", l)
	}
	// E o cancelar e as rotas da reunião dão 404.
	esperarErro(t, a.Pedir(c.kDavi, "DELETE", base, nil), 404, "naoEncontrado")
	corpo := map[string]string{"pedido": "0123456789abcdef", "participante": "0123456789abcdef"}
	for _, rota := range []struct{ metodo, caminho string }{
		{"GET", base + "/participantes"},
		{"POST", base + "/aceitar"},
		{"POST", base + "/recusar"},
		{"POST", base + "/tirar"},
		{"POST", base + "/encerrar"},
		{"POST", base + "/tela"},
	} {
		esperarErro(t, a.Pedir(c.kDavi, rota.metodo, rota.caminho, corpo), 404, "naoEncontrado")
	}
	// Só o entrar diz que o link é de outra empresa.
	esperarErro(t, c.entrarEm(c.kDavi, r.Codigo), 403, "outraEmpresa")

	// Nada disso mexeu na reunião da ACME.
	if got := a.Video.Comandos(); len(got) != 0 {
		t.Fatalf("o vídeo recebeu %v", got)
	}
	if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Participantes) != 1 {
		t.Fatalf("participantes = %+v", l.Participantes)
	}
	// A reunião da Beta é da Beta, e a ACME não a vê.
	rBeta := c.marcada(t, c.kDavi)
	esperarErro(t, a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+rBeta.Codigo, nil), 404, "naoEncontrado")
	esperarErro(t, a.Pedir(c.kAna, "GET", "/api/v1/reunioes/"+rBeta.Codigo+"/participantes", nil), 404, "naoEncontrado")
}

// ---------- O chat sem o vídeo ----------

func TestSemVideo_OChatSegue(t *testing.T) {
	c := novaCenaR(t)
	a := c.a
	r := c.marcada(t, c.kAna)
	// Um arquivo e uma conversa, de antes de o vídeo cair.
	arq := a.Enviar(c.kAna, "proposta.pdf", "application/pdf", []byte("%PDF-1.4 ACME"))

	a.Video.DefinirNoAr(false)

	esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 503, "servidorVideo")

	// Criar uma conversa, enviar e ler mensagens, e baixar um arquivo: como sempre.
	resp := a.Pedir(c.kAna, "POST", "/api/v1/conversas", map[string]any{"tipo": "dupla", "com": c.carlos.ID})
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("criar a conversa respondeu %d", resp.StatusCode)
	}
	conv := apitest.LerJSON[struct {
		Conversa conversaResp `json:"conversa"`
	}](t, resp).Conversa
	resp = a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv.ID),
		map[string]string{"idLocal": "id-1", "texto": "Oi, Carlos"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("enviar respondeu %d", resp.StatusCode)
	}
	resp = a.Pedir(c.kCarlos, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv.ID), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ler respondeu %d", resp.StatusCode)
	}
	if l := apitest.LerJSON[struct {
		Mensagens []mensagemResp `json:"mensagens"`
	}](t, resp).Mensagens; len(l) != 1 || l[0].Texto == nil || *l[0].Texto != "Oi, Carlos" {
		t.Fatalf("mensagens = %+v", l)
	}
	resp = a.Pedir(c.kAna, "GET", "/api/v1/arquivos/"+arq.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("baixar respondeu %d", resp.StatusCode)
	}
	// As reuniões que não dependem do vídeo também: criar, listar e cancelar.
	if resp := a.Pedir(c.kAna, "GET", "/api/v1/reunioes", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("minhas respondeu %d", resp.StatusCode)
	}
	if resp := a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("cancelar respondeu %d", resp.StatusCode)
	}
}
