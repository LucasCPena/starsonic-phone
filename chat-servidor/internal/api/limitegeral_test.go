package api_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// R43: 600 pedidos por minuto por computador, em todo pedido com chave.
func TestLimiteGeral_600PorMinuto(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k1 := a.Ligar(acme.Codigo, "PC-ANA")
	k2 := a.Ligar(acme.Codigo, "PC-BIA")
	a.Entrar(k1, "2003", "Ana Souza") // o 1º pedido do minuto
	a.Entrar(k2, "2004", "Beatriz")

	for i := 2; i <= 600; i++ {
		if resp := a.Pedir(k1, "GET", "/api/v1/pessoas", nil); resp.StatusCode != http.StatusOK {
			t.Fatalf("pedido %d: status %d", i, resp.StatusCode)
		}
	}
	resp := a.Pedir(k1, "GET", "/api/v1/pessoas", nil) // o 601º
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("o 601º pedido respondeu %d; queria 429", resp.StatusCode)
	}
	e := apitest.LerJSON[erroResp](t, resp)
	if e.Erro != "limite" || e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("resposta = %+v; queria limite com esperarSegundos de 1 a 60", e)
	}

	// Outro computador não é afetado.
	if resp := a.Pedir(k2, "GET", "/api/v1/pessoas", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("outro computador: status %d", resp.StatusCode)
	}
	// Uma chave desconhecida continua 401: o limite só conta depois de achar a chave.
	esperarErro(t, a.Pedir("chave-que-nao-existe", "GET", "/api/v1/pessoas", nil), 401, "chave")

	// Um minuto depois, o computador volta a pedir.
	a.Relogio.Avancar(time.Minute)
	if resp := a.Pedir(k1, "GET", "/api/v1/pessoas", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("um minuto depois: status %d", resp.StatusCode)
	}
}

// R43: o POST /api/v1/pessoas/eu tem, além do geral, 20 por minuto.
func TestLimiteGeral_PessoasEu20PorMinuto(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	k1 := a.Ligar(acme.Codigo, "PC-ANA")
	k2 := a.Ligar(acme.Codigo, "PC-BIA")

	for i := 1; i <= 20; i++ {
		a.Entrar(k1, "2003", "Ana Souza")
	}
	resp := a.Pedir(k1, "POST", "/api/v1/pessoas/eu", map[string]string{"ramal": "2003", "nome": "Ana Souza"})
	e := esperarErro(t, resp, 429, "limite")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("esperarSegundos = %d", e.EsperarSegundos)
	}
	// As outras rotas do mesmo computador seguem; outro computador também.
	if resp := a.Pedir(k1, "GET", "/api/v1/pessoas", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /pessoas: status %d", resp.StatusCode)
	}
	a.Entrar(k2, "2004", "Beatriz")

	a.Relogio.Avancar(time.Minute)
	a.Entrar(k1, "2003", "Ana Souza")
}
