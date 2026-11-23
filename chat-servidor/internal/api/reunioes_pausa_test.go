package api_test

import (
	"net/http"
	"strings"
	"testing"
)

// pausaEm é o POST da pausa, com o corpo dado.
func (c *cenaR) pausaEm(chave, codigo string, corpo any) *http.Response {
	return c.a.Pedir(chave, "POST", "/api/v1/reunioes/"+codigo+"/pausa", corpo)
}

func TestRotaDaPausa_DaCerto(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, _, _ := c.carlosNaReuniao(t, r.Codigo)

	resp := c.pausaEm(c.kCarlos, r.Codigo, map[string]any{"pausada": true, "vez": "p1"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pausa respondeu %d; queria 204", resp.StatusCode)
	}
	m := aPaginaTipo(t, pagina, "pausa")
	if len(m) != 3 || m["pausada"] != true || m["vez"] != "p1" {
		t.Fatalf("a página recebeu %v; queria {tipo: pausa, pausada: true, vez: p1}", m)
	}

	// O "não pausada" e o código em maiúsculas.
	resp = c.pausaEm(c.kCarlos, strings.ToUpper(r.Codigo), map[string]any{"pausada": false, "vez": "P2"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("a pausa desfeita respondeu %d; queria 204", resp.StatusCode)
	}
	if m := aPaginaTipo(t, pagina, "pausa"); m["pausada"] != false || m["vez"] != "P2" {
		t.Fatalf("a página recebeu %v", m)
	}
}

func TestRotaDaPausa_ForaDaReuniao(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	corpo := map[string]any{"pausada": true, "vez": "p1"}
	esperarErro(t, c.pausaEm(c.kCarlos, r.Codigo, corpo), http.StatusConflict, "foraDaReuniao")

	// Quem entrou pela rota do app, sem página, também está fora.
	c.entrar(t, c.kCarlos, r.Codigo)
	esperarErro(t, c.pausaEm(c.kCarlos, r.Codigo, corpo), http.StatusConflict, "foraDaReuniao")
}

func TestRotaDaPausa_CamposRuins(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	c.carlosNaReuniao(t, r.Codigo)
	for nome, p := range map[string]struct {
		corpo any
		campo string
	}{
		"sem o pausada":      {map[string]any{"vez": "p1"}, "pausada"},
		"o pausada em texto": {map[string]any{"pausada": "true", "vez": "p1"}, "pausada"},
		"o pausada nulo":     {map[string]any{"pausada": nil, "vez": "p1"}, "pausada"},
		"sem o vez":          {map[string]any{"pausada": true}, "vez"},
		"o vez vazio":        {map[string]any{"pausada": true, "vez": ""}, "vez"},
		"o vez com 33":       {map[string]any{"pausada": true, "vez": strings.Repeat("a", 33)}, "vez"},
		"o vez com hífen":    {map[string]any{"pausada": true, "vez": "a-b"}, "vez"},
		"o vez em número":    {map[string]any{"pausada": true, "vez": 7}, "vez"},
	} {
		t.Run(nome, func(t *testing.T) {
			e := esperarErro(t, c.pausaEm(c.kCarlos, r.Codigo, p.corpo), http.StatusBadRequest, "invalido")
			if e.Campo != p.campo {
				t.Fatalf("campo = %q; queria %q", e.Campo, p.campo)
			}
		})
	}
	// O vez de 32 caracteres vale.
	if resp := c.pausaEm(c.kCarlos, r.Codigo, map[string]any{"pausada": true, "vez": strings.Repeat("Z", 32)}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("o vez com 32 respondeu %d", resp.StatusCode)
	}
}

func TestRotaDaPausa_OutraEmpresa(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	c.carlosNaReuniao(t, r.Codigo)
	esperarErro(t, c.pausaEm(c.kDavi, r.Codigo, map[string]any{"pausada": true, "vez": "p1"}), http.StatusNotFound, "naoEncontrado")
}
