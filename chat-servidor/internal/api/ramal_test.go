package api_test

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/ramais"
)

const rotaDoRamal = "/api/v1/computadores/eu/ramal"

// idDoComputador acha no banco o id do computador pelo nome que ele tem no teste.
func idDoComputador(a *apitest.Ambiente, nome string) int64 {
	a.T.Helper()
	return int64(a.Contar(`SELECT id FROM computadores WHERE nome = ?`, nome))
}

// computadorNoCanal liga um computador da empresa como a pessoa do ramal e abre o canal dos
// eventos dele. Devolve a chave e o id do computador.
func computadorNoCanal(a *apitest.Ambiente, codigo, computador, ramal, nome string) (chave string, id int64) {
	a.T.Helper()
	chave = a.Ligar(codigo, computador)
	a.Entrar(chave, ramal, nome)
	a.Conectar(chave)
	return chave, idDoComputador(a, computador)
}

func dizerRamal(a *apitest.Ambiente, chave, estado string, segundos int) *http.Response {
	a.T.Helper()
	return a.Pedir(chave, "PUT", rotaDoRamal, map[string]any{"estado": estado, "segundos": segundos})
}

// O estado e os segundos chegam ao hub, com o Desde contado pelo relógio do servidor.
func TestRamal_Guarda(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k, id := computadorNoCanal(a, acme.Codigo, "RECEPCAO-01", "2001", "Recepção")
	for _, estado := range []string{"conectado", "conectando", "erro", "semConexao"} {
		for _, segundos := range []int{0, 734, 31536000} {
			resp := dizerRamal(a, k, estado, segundos)
			if resp.StatusCode != http.StatusNoContent || resp.ContentLength > 0 {
				t.Fatalf("%s, %d s: status %d com %d bytes; queria 204 sem corpo", estado, segundos, resp.StatusCode, resp.ContentLength)
			}
			d := a.Hub.Ligados()[id].Ramal
			desde := a.Relogio.Agora().Add(-time.Duration(segundos) * time.Second)
			if d == nil || d.Estado != ramais.Estado(estado) || !d.Desde.Equal(desde) {
				t.Fatalf("%s, %d s: o hub guardou %+v; queria o estado, desde %v", estado, segundos, d, desde)
			}
		}
	}
}

func TestRamal_Invalido(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k, id := computadorNoCanal(a, acme.Codigo, "RECEPCAO-01", "2001", "Recepção")
	for _, c := range []struct{ corpo, campo string }{
		{`{"estado":"ok","segundos":1}`, "estado"},
		{`{"segundos":1}`, "estado"},
		{`{"estado":null,"segundos":1}`, "estado"},
		{`{"estado":"erro"}`, "segundos"},
		{`{"estado":"erro","segundos":null}`, "segundos"},
		{`{"estado":"erro","segundos":-1}`, "segundos"},
		{`{"estado":"erro","segundos":31536001}`, "segundos"},
		// O que o servidor não consegue ler nesse formato vem sem campo, como nas outras operações.
		{`{"estado":"erro","segundos":"7"}`, ""},
		{`{"estado":"erro","segundos":1.5}`, ""},
		{`isto não é JSON`, ""},
	} {
		e := esperarErro(t, a.Pedir(k, "PUT", rotaDoRamal, c.corpo), 400, "invalido")
		if e.Campo != c.campo {
			t.Errorf("%s: campo %q; queria %q", c.corpo, e.Campo, c.campo)
		}
		if d := a.Hub.Ligados()[id].Ramal; d != nil {
			t.Fatalf("%s: o hub guardou %+v", c.corpo, *d)
		}
	}
}

func TestRamal_SemChave(t *testing.T) {
	a := apitest.Novo(t)
	esperarErro(t, dizerRamal(a, "", "conectado", 0), 401, "chave")
	esperarErro(t, dizerRamal(a, "chave-que-nao-existe", "conectado", 0), 401, "chave")
}

// Num computador em que ninguém entrou, mesmo com o canal aberto: 409 pessoa.
func TestRamal_SemPessoa(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k := a.Ligar(acme.Codigo, "PC-NOVO")
	a.Conectar(k)
	esperarErro(t, dizerRamal(a, k, "conectado", 0), 409, "pessoa")
	// A pessoa vem antes do corpo: um corpo errado, sem pessoa, ainda é 409 pessoa.
	esperarErro(t, a.Pedir(k, "PUT", rotaDoRamal, `isto não é JSON`), 409, "pessoa")
}

// O chat só guarda o estado de quem está ligado nele: do Reservar em diante.
func TestRamal_SemLigacao(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k := a.Ligar(acme.Codigo, "RECEPCAO-01")
	p := a.Entrar(k, "2001", "Recepção")
	id := idDoComputador(a, "RECEPCAO-01")

	esperarErro(t, dizerRamal(a, k, "erro", 90), 409, "semLigacao")
	if l, ok := a.Hub.Ligados()[id]; ok {
		t.Fatalf("sem o canal, o hub tem o computador: %+v", l)
	}
	// O corpo vem antes da ligação: um corpo errado, sem o canal, é 400 invalido.
	esperarErro(t, a.Pedir(k, "PUT", rotaDoRamal, `{"estado":"ok","segundos":1}`), 400, "invalido")

	// Só com a reserva (o canal abrindo), o estado já é aceito.
	res := a.Hub.Reservar(id)
	t.Cleanup(res.Desistir)
	res.DefinirPessoa(p.ID)
	if resp := dizerRamal(a, k, "erro", 90); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("com a reserva: status %d; queria 204", resp.StatusCode)
	}
	if d := a.Hub.Ligados()[id].Ramal; d == nil || d.Estado != ramais.Erro {
		t.Fatalf("com a reserva, o hub guardou %+v", d)
	}
}

// 30 por minuto, por computador, além do limite geral. Todo pedido com a chave boa conta.
func TestRamal_Limite(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k1, _ := computadorNoCanal(a, acme.Codigo, "RECEPCAO-01", "2001", "Recepção")
	k2, _ := computadorNoCanal(a, acme.Codigo, "NOTE-ANA", "2003", "Ana Souza")

	for i := 1; i <= 29; i++ {
		if resp := dizerRamal(a, k1, "conectando", i); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("pedido %d: status %d", i, resp.StatusCode)
		}
	}
	// O 30º é um pedido errado: ele também conta.
	esperarErro(t, a.Pedir(k1, "PUT", rotaDoRamal, `{"estado":"ok","segundos":1}`), 400, "invalido")
	e := esperarErro(t, dizerRamal(a, k1, "conectando", 31), 429, "limite")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("esperarSegundos = %d; queria de 1 a 60", e.EsperarSegundos)
	}
	// As outras rotas do mesmo computador seguem; outro computador também.
	if resp := a.Pedir(k1, "GET", "/api/v1/pessoas", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /pessoas: status %d", resp.StatusCode)
	}
	if resp := dizerRamal(a, k2, "conectado", 0); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("outro computador: status %d", resp.StatusCode)
	}

	a.Relogio.Avancar(time.Minute)
	if resp := dizerRamal(a, k1, "conectado", 0); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("um minuto depois: status %d", resp.StatusCode)
	}
}

// O estado é da pessoa da vez: depois de outra pessoa entrar no computador, ele some, até o app
// dizê-lo de novo.
func TestRamal_TrocaDePessoa(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k, id := computadorNoCanal(a, acme.Codigo, "RECEPCAO-01", "2001", "Recepção")
	if resp := dizerRamal(a, k, "erro", 300); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", resp.StatusCode)
	}

	ana := a.Entrar(k, "2003", "Ana Souza")
	if l := a.Hub.Ligados()[id]; l.Pessoa != ana.ID || l.Ramal != nil {
		t.Fatalf("depois da troca: %+v; queria a pessoa %d, sem ramal", l, ana.ID)
	}
	if resp := dizerRamal(a, k, "conectado", 5); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if d := a.Hub.Ligados()[id].Ramal; d == nil || d.Estado != ramais.Conectado {
		t.Fatalf("depois de a pessoa nova dizer o estado: %+v", d)
	}
}

// Os registros do servidor não ganham nome, ramal nem estado: só a linha do pedido, como as
// outras rotas.
func TestRamal_Registros(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k, _ := computadorNoCanal(a, acme.Codigo, "COMERCIAL-03", "2011", "Carlos Lima")
	var log registroSeguro
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	if resp := dizerRamal(a, k, "semConexao", 4242); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", resp.StatusCode)
	}
	// A linha do pedido sai depois da resposta: espera por ela.
	linha := fmt.Sprintf("rota=%q status=204", "PUT "+rotaDoRamal)
	for prazo := time.Now().Add(5 * time.Second); !strings.Contains(log.String(), linha); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(prazo) {
			t.Fatalf("o registro não tem a linha do pedido (%s):\n%s", linha, log.String())
		}
	}
	for _, s := range []string{"semConexao", "Carlos", "2011", "4242", "COMERCIAL"} {
		if strings.Contains(log.String(), s) {
			t.Fatalf("o registro tem %q:\n%s", s, log.String())
		}
	}
}
