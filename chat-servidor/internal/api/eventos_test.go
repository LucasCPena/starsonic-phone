package api_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// esperarRecusa confere que o WebSocket não abriu e que a resposta foi status com o erro.
func esperarRecusa(t *testing.T, conn *websocket.Conn, resp *http.Response, err error, status int, erro string) {
	t.Helper()
	if err == nil || conn != nil {
		t.Fatal("o WebSocket abriu; queria a recusa")
	}
	esperarErro(t, resp, status, erro)
}

// computadorID acha o id do computador da chave, direto no banco.
func computadorID(t *testing.T, a *apitest.Ambiente, chave string) int64 {
	t.Helper()
	c, _, err := a.Banco.ComputadorPorChave(t.Context(), segredo.Hash(chave))
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func TestBilhete(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")

	t.Run("umaVez", func(t *testing.T) {
		a := a.Com(t)
		resp := a.Pedir(chave, "POST", "/api/v1/eventos/bilhete", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		corpo := apitest.LerJSON[map[string]string](t, resp)
		bilhete := corpo["bilhete"]
		if len(corpo) != 1 || len(bilhete) != 43 {
			t.Fatalf("corpo = %v", corpo)
		}
		if _, _, err := a.Discar(bilhete, ""); err != nil {
			t.Fatalf("a primeira vez não conectou: %v", err)
		}
		conn, resp, err := a.Discar(bilhete, "")
		esperarRecusa(t, conn, resp, err, 401, "chave")
	})

	t.Run("vencido", func(t *testing.T) {
		a := a.Com(t)
		bilhete := a.Bilhete(chave)
		a.Relogio.Avancar(31 * time.Second)
		conn, resp, err := a.Discar(bilhete, "")
		esperarRecusa(t, conn, resp, err, 401, "chave")
	})

	t.Run("origemDeFora", func(t *testing.T) {
		a := a.Com(t)
		bilhete := a.Bilhete(chave)
		conn, resp, err := a.Discar(bilhete, "https://mal.example")
		esperarRecusa(t, conn, resp, err, 403, "proibido")
		// A recusa da origem vem antes do bilhete, que não se gasta.
		if _, _, err := a.Discar(bilhete, ""); err != nil {
			t.Fatalf("o bilhete se gastou na origem de fora: %v", err)
		}
	})

	t.Run("inventado", func(t *testing.T) {
		a := a.Com(t)
		conn, resp, err := a.Discar("inventado", "")
		esperarRecusa(t, conn, resp, err, 401, "chave")
	})

	t.Run("juntos", func(t *testing.T) {
		a := a.Com(t)
		bilhete := a.Bilhete(chave)
		var abriram atomic.Int32
		var wg sync.WaitGroup
		for range 10 {
			wg.Go(func() {
				if conn, _, err := a.Discar(bilhete, ""); err == nil && conn != nil {
					abriram.Add(1)
				}
			})
		}
		wg.Wait()
		if n := abriram.Load(); n != 1 {
			t.Fatalf("o mesmo bilhete abriu %d conexões; queria 1", n)
		}
	})
}

func TestEventos_Origem(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")

	t.Run("doApp", func(t *testing.T) {
		a := a.Com(t)
		if _, _, err := a.Discar(a.Bilhete(chave), "https://app.starsonic.local"); err != nil {
			t.Fatalf("a origem do app não conectou: %v", err)
		}
	})
	// O Accept do coder/websocket aceita sozinho a origem do mesmo host; a API não, porque
	// ela não está nas origens do CORS.
	t.Run("doProprioServidor", func(t *testing.T) {
		a := a.Com(t)
		conn, resp, err := a.Discar(a.Bilhete(chave), a.Servidor.URL)
		esperarRecusa(t, conn, resp, err, 403, "proibido")
	})
	// Os colchetes de um IPv6 seriam uma classe no path.Match das OriginPatterns.
	t.Run("comColchetes", func(t *testing.T) {
		srv := httptest.NewServer(api.Novo(api.Deps{Banco: a.Banco, Hub: a.Hub, Origens: []string{"http://[::1]:5173"}}))
		t.Cleanup(srv.Close)
		b := a.Com(t)
		b.Servidor = srv
		if _, _, err := b.Discar(b.Bilhete(chave), "http://[::1]:5173"); err != nil {
			t.Fatalf("a origem com colchetes não conectou: %v", err)
		}
		conn, resp, err := b.Discar(b.Bilhete(chave), "http://1:5173")
		esperarRecusa(t, conn, resp, err, 403, "proibido")
	})
}

func TestComputadorNovo(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	pcA := a.Ligar(emp.Codigo, "A")
	pcB := a.Ligar(emp.Codigo, "B")
	pcBia := a.Ligar(emp.Codigo, "C")

	a.Entrar(pcA, "2003", "Ana Souza")
	connA := a.Conectar(pcA)
	a.Entrar(pcBia, "2004", "Beatriz Lima")
	connBia := a.Conectar(pcBia)

	a.Entrar(pcB, "2003", "Ana Souza")
	ev := apitest.LerEvento[map[string]any](t, connA)
	if len(ev) != 2 || ev["tipo"] != "computadorNovo" || ev["computador"] != "B" {
		t.Fatalf("o A recebeu %v; queria {\"tipo\":\"computadorNovo\",\"computador\":\"B\"}", ev)
	}
	apitest.SemEvento(t, connBia, 300*time.Millisecond)

	// A segunda vez da Ana no B não avisa ninguém.
	a.Entrar(pcB, "2003", "Ana Souza")
	apitest.SemEvento(t, connA, 300*time.Millisecond)
}

// Os eventos de uma pessoa vão aos computadores que agem como ela na hora: a pessoa do
// banco ao conectar, e depois a que entra com o WebSocket aberto.
func TestEventos_PessoaDaVez(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	ana := a.Entrar(chave, "2003", "Ana Souza")
	conn := a.Conectar(chave)
	a.Hub.ParaPessoas([]int64{ana.ID}, map[string]string{"tipo": "paraAna"})
	if ev := apitest.LerEvento[map[string]string](t, conn); ev["tipo"] != "paraAna" {
		t.Fatalf("recebeu %v; queria o evento da Ana", ev)
	}

	bia := a.Entrar(chave, "2004", "Beatriz Lima")
	a.Hub.ParaPessoas([]int64{ana.ID}, map[string]string{"tipo": "paraAna"})
	a.Hub.ParaPessoas([]int64{bia.ID}, map[string]string{"tipo": "paraBia"})
	if ev := apitest.LerEvento[map[string]string](t, conn); ev["tipo"] != "paraBia" {
		t.Fatalf("recebeu %v; queria só o da Beatriz, que entrou no computador", ev)
	}
}

func TestUmaConexaoPorComputador(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	primeira := a.Conectar(chave)
	segunda := a.Conectar(chave)
	if c := apitest.Fechamento(t, primeira); c != 4000 {
		t.Fatalf("a primeira fechou com %d; queria 4000", c)
	}
	// O fechamento da primeira não tira a segunda do hub.
	a.Hub.ParaComputadores([]int64{computadorID(t, a, chave)}, map[string]string{"tipo": "teste"})
	if ev := apitest.LerEvento[map[string]string](t, segunda); ev["tipo"] != "teste" {
		t.Fatalf("a segunda recebeu %v", ev)
	}
}

func TestDesligar_FechaWebSocket(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "RECEPCAO-01")
	outro := a.Ligar(emp.Codigo, "RECEPCAO-02")
	a.Entrar(chave, "2003", "Ana Souza")
	conn := a.Conectar(chave)
	connOutro := a.Conectar(outro)
	guardado := a.Bilhete(chave) // pedido antes de desligar

	if resp := a.Pedir(chave, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("desligar: %d", resp.StatusCode)
	}
	if ev := apitest.LerEvento[map[string]any](t, conn); len(ev) != 1 || ev["tipo"] != "fora" {
		t.Fatalf("recebeu %v; queria {\"tipo\":\"fora\"}", ev)
	}
	if c := apitest.Fechamento(t, conn); c != 4001 {
		t.Fatalf("fechou com %d; queria 4001", c)
	}
	// O bilhete de antes não abre mais nada: o banco já diz que o computador saiu.
	c, resp, err := a.Discar(guardado, "")
	esperarRecusa(t, c, resp, err, 401, "chave")
	// O outro computador não foi junto.
	a.Hub.ParaComputadores([]int64{computadorID(t, a, outro)}, map[string]string{"tipo": "teste"})
	if ev := apitest.LerEvento[map[string]string](t, connOutro); ev["tipo"] != "teste" {
		t.Fatalf("o outro recebeu %v", ev)
	}
}
