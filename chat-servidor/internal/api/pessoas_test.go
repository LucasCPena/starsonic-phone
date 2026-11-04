package api_test

import (
	"net/http"
	"slices"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

func entrarComo(a *apitest.Ambiente, chave, ramal, nome string) *http.Response {
	return a.Pedir(chave, "POST", "/api/v1/pessoas/eu", map[string]string{"ramal": ramal, "nome": nome})
}

func TestEntrar_CriaEAtualiza(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")

	resp := entrarComo(a, chave, "2001", "Recepção")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	// O corpo é {"pessoa": <Pessoa>}, com os campos da seção 4 do protocolo e só eles.
	corpo := apitest.LerJSON[map[string]map[string]any](t, resp)
	p := corpo["pessoa"]
	if len(corpo) != 1 || len(p) != 4 || p["ramal"] != "2001" || p["nome"] != "Recepção" || p["saiu"] != false {
		t.Fatalf("corpo = %v", corpo)
	}
	id, ok := p["id"].(float64)
	if !ok || id <= 0 {
		t.Fatalf("id = %v", p["id"])
	}

	p2 := a.Entrar(chave, "2001", "Recepção 1")
	if p2.ID != int64(id) || p2.Ramal != "2001" || p2.Nome != "Recepção 1" || p2.Saiu {
		t.Fatalf("segunda entrada = %+v; queria o id %v com o nome novo", p2, id)
	}
}

func TestEntrar_PessoaQueSaiuNaoVolta(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	ana := a.Entrar(chave, "2003", "Ana Souza")
	a.Exec(`UPDATE pessoas SET saiu_em = ? WHERE id = ?`, a.Relogio.Agora().UnixMilli(), ana.ID)

	nova := a.Entrar(chave, "2003", "Ana Souza")
	if nova.ID == ana.ID || nova.Saiu {
		t.Fatalf("depois de sair, o ramal 2003 entrou como %+v; queria uma pessoa nova", nova)
	}
}

func TestEntrar_Invalido(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	if e := esperarErro(t, entrarComo(a, chave, "20 03", "Ana Souza"), 400, "invalido"); e.Campo != "ramal" {
		t.Fatalf("campo = %q; queria ramal", e.Campo)
	}
	if e := esperarErro(t, entrarComo(a, chave, "2003", "   "), 400, "invalido"); e.Campo != "nome" {
		t.Fatalf("campo = %q; queria nome", e.Campo)
	}
}

func TestColegas(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	outra := a.Empresa("Outra Ltda")

	recepcao := a.Ligar(acme.Codigo, "RECEPCAO-01")
	for _, p := range []struct{ ramal, nome string }{{"2001", "Ana"}, {"2002", "Álvaro"}, {"2003", "Beatriz"}} {
		a.Entrar(recepcao, p.ramal, p.nome)
	}
	bruna := a.Entrar(recepcao, "2004", "Bruna")
	a.Exec(`UPDATE pessoas SET saiu_em = ? WHERE id = ?`, a.Relogio.Agora().UnixMilli(), bruna.ID)
	a.Entrar(a.Ligar(outra.Codigo, "PC"), "2005", "Abel")
	eu := a.Ligar(acme.Codigo, "RECEPCAO-02")
	carlos := a.Entrar(eu, "2010", "Carlos")

	resp := a.Pedir(eu, "GET", "/api/v1/pessoas", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	lista := apitest.LerJSON[struct {
		Pessoas []apitest.Pessoa `json:"pessoas"`
	}](t, resp).Pessoas
	var nomes []string
	for _, p := range lista {
		if p.ID == carlos.ID || p.Saiu {
			t.Fatalf("pessoa inesperada: %+v", p)
		}
		nomes = append(nomes, p.Nome)
	}
	// Sem a da vez (Carlos), sem quem saiu (Bruna), sem a outra empresa (Abel), na ordem
	// do nome sem acento e sem caixa.
	if quer := []string{"Álvaro", "Ana", "Beatriz"}; !slices.Equal(nomes, quer) {
		t.Fatalf("colegas = %v; queria %v", nomes, quer)
	}
}

func TestColegas_Vazio(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	a.Entrar(chave, "2003", "Ana Souza")
	resp := a.Pedir(chave, "GET", "/api/v1/pessoas", nil)
	if corpo := apitest.LerJSON[map[string]any](t, resp); len(corpo) != 1 || corpo["pessoas"] == nil {
		t.Fatalf("corpo = %v; queria {\"pessoas\": []}", corpo)
	}
}

func TestSemPessoa(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	esperarErro(t, a.Pedir(chave, "GET", "/api/v1/pessoas", nil), 409, "pessoa")
}
