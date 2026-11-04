package api_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// ligados são n pessoas da mesma empresa, cada uma no seu computador e com o WebSocket aberto.
type ligados struct {
	chaves  []string
	pessoas []apitest.Pessoa
	conns   []*websocket.Conn
}

func ligarTodos(t *testing.T, a *apitest.Ambiente, codigo string, n int) ligados {
	t.Helper()
	var l ligados
	for i := 0; i < n; i++ {
		chave := a.Ligar(codigo, fmt.Sprintf("PC-%03d", i))
		p := a.Entrar(chave, fmt.Sprintf("%d", 3000+i), fmt.Sprintf("Pessoa %d", i))
		l.chaves = append(l.chaves, chave)
		l.pessoas = append(l.pessoas, p)
		l.conns = append(l.conns, a.Conectar(chave))
	}
	return l
}

// lerRajada lê da conexão até ter visto o evento conversa e as mensagens esperadas. Se o
// servidor fechar a conexão no meio, o teste falha (4002, por exemplo).
func lerRajada(t *testing.T, i int, c *websocket.Conn, mensagens int) {
	t.Helper()
	vistas, conversas := 0, 0
	for vistas < mensagens || conversas < 1 {
		ev := apitest.LerEvento[struct {
			Tipo string `json:"tipo"`
		}](t, c)
		switch ev.Tipo {
		case "mensagem":
			vistas++
		case "conversa":
			conversas++
		default:
			t.Fatalf("conexão %d: evento %q inesperado", i, ev.Tipo)
		}
	}
}

// R44: criar um grupo de 200 pessoas, todas conectadas, manda 201 eventos a cada uma (o
// conversa e um aviso por pessoa) e não fecha ninguém.
func TestGrupo_Grande_CriarNaoDesconecta(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	l := ligarTodos(t, a, acme.Codigo, 200)

	outras := make([]int64, 0, 199)
	for _, p := range l.pessoas[1:] {
		outras = append(outras, p.ID)
	}
	resp := a.Pedir(l.chaves[0], "POST", "/api/v1/conversas",
		map[string]any{"tipo": "grupo", "nome": "Todos", "pessoas": outras})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar o grupo respondeu %d", resp.StatusCode)
	}
	// 1 aviso "criou" e 199 "pos".
	for i, c := range l.conns {
		lerRajada(t, i, c, 200)
	}
}

// R44: pôr muita gente de uma vez num grupo conectado também não fecha ninguém.
func TestGrupo_Grande_PorNaoDesconecta(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	l := ligarTodos(t, a, acme.Codigo, 200)

	resp := a.Pedir(l.chaves[0], "POST", "/api/v1/conversas",
		map[string]any{"tipo": "grupo", "nome": "Todos", "pessoas": []int64{l.pessoas[1].ID}})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar o grupo respondeu %d", resp.StatusCode)
	}
	conv := apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa
	// Quem já está no grupo recebe o conversa e 2 avisos (criou, pos).
	lerRajada(t, 0, l.conns[0], 2)
	lerRajada(t, 1, l.conns[1], 2)

	novas := make([]int64, 0, 198)
	for _, p := range l.pessoas[2:] {
		novas = append(novas, p.ID)
	}
	resp = a.Pedir(l.chaves[0], "POST", fmt.Sprintf("/api/v1/conversas/%d/membros", conv.ID),
		map[string]any{"pessoas": novas})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr respondeu %d", resp.StatusCode)
	}
	// Cada membro, os antigos e os novos, recebe o conversa e os 198 avisos "pos".
	for i, c := range l.conns {
		lerRajada(t, i, c, 198)
	}
}
