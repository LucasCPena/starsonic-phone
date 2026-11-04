package eventos

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// transporte faz o aperto de mão do WebSocket na memória e entrega a conexão por um
// net.Pipe, como o wstest.Pipe do próprio coder/websocket.
type transporte struct{ aceitar http.HandlerFunc }

func (tr transporte) RoundTrip(r *http.Request) (*http.Response, error) {
	cli, srv := net.Pipe()
	rec := httptest.NewRecorder()
	tr.aceitar(sequestro{rec, srv}, r)
	resp := rec.Result()
	if resp.StatusCode == http.StatusSwitchingProtocols {
		resp.Body = cli
	} else {
		cli.Close()
		srv.Close()
	}
	return resp, nil
}

type sequestro struct {
	*httptest.ResponseRecorder
	conn net.Conn
}

func (s sequestro) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return s.conn, bufio.NewReadWriter(bufio.NewReader(s.conn), bufio.NewWriter(s.conn)), nil
}

// par liga um cliente ao lado do servidor de um WebSocket por um net.Pipe. O net.Pipe não
// guarda nada: o que o servidor escreve só anda quando o cliente lê, como um app que parou
// de ler com o buffer do TCP cheio.
func par(t *testing.T, opcoes *websocket.DialOptions) (cliente, servidor *websocket.Conn) {
	t.Helper()
	var o websocket.DialOptions
	if opcoes != nil {
		o = *opcoes
	}
	o.HTTPClient = &http.Client{Transport: transporte{func(w http.ResponseWriter, r *http.Request) {
		var err error
		if servidor, err = websocket.Accept(w, r, nil); err != nil {
			t.Errorf("Accept: %v", err)
		}
	}}}
	cliente, _, err := websocket.Dial(context.Background(), "ws://chat.example/api/v1/eventos", &o)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	t.Cleanup(func() { cliente.CloseNow() })
	return cliente, servidor
}

// servir roda o Servir da reserva e devolve um canal que fecha quando ele volta. No fim do
// teste, fecha a conexão e espera o Servir voltar.
func servir(t *testing.T, r *Reserva, conn *websocket.Conn) <-chan struct{} {
	return servirCom(t, context.Background(), r, conn)
}

func servirCom(t *testing.T, ctx context.Context, r *Reserva, conn *websocket.Conn) <-chan struct{} {
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		r.Servir(ctx, conn)
	}()
	t.Cleanup(func() {
		conn.CloseNow()
		select {
		case <-feito:
		case <-time.After(10 * time.Second):
			t.Error("o Servir não voltou depois de a conexão fechar")
		}
	})
	return feito
}

// ler lê a próxima mensagem, com prazo de 5 s.
func ler(t *testing.T, c *websocket.Conn) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, msg, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("ler: %v", err)
	}
	return string(msg)
}

// fechamento lê até a conexão fechar, pulando as mensagens, e devolve o código.
func fechamento(t *testing.T, c *websocket.Conn) websocket.StatusCode {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("a conexão não fechou em 5 s")
			}
			return websocket.CloseStatus(err)
		}
	}
}

// esperar espera o Servir voltar, por até 5 s.
func esperar(t *testing.T, feito <-chan struct{}) {
	t.Helper()
	select {
	case <-feito:
	case <-time.After(5 * time.Second):
		t.Fatal("o Servir não voltou em 5 s")
	}
}

// conectados diz quantas conexões o hub tem agora.
func conectados(h *Hub) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conexoes)
}

type evento struct {
	Tipo string `json:"tipo"`
	N    int    `json:"n,omitempty"`
}

func TestNovoHub_Padrao(t *testing.T) {
	h := NovoHub(Config{})
	if h.cfg != (Config{Ping: 25 * time.Second, Espera: 60 * time.Second, Fila: 512}) {
		t.Fatalf("Config = %+v", h.cfg)
	}
}

func TestParaPessoas(t *testing.T) {
	h := NovoHub(Config{})
	conectar := func(computador, pessoa int64) *websocket.Conn {
		cli, srv := par(t, nil)
		r := h.Reservar(computador)
		r.DefinirPessoa(pessoa)
		servir(t, r, srv)
		return cli
	}
	ana1, bia, ana2, ninguem := conectar(1, 10), conectar(2, 20), conectar(3, 10), conectar(4, 0)

	h.ParaPessoas([]int64{10}, evento{Tipo: "a"})
	h.ParaPessoas([]int64{20, 0}, evento{Tipo: "b"}) // o 0 não é ninguém: o computador sem pessoa fica de fora
	h.ParaComputadores([]int64{4}, evento{Tipo: "marca"})
	// Cada conexão recebe na ordem: a primeira mensagem diz o que ela não recebeu.
	for nome, c := range map[string]*websocket.Conn{"ana1": ana1, "ana2": ana2} {
		if m := ler(t, c); m != `{"tipo":"a"}` {
			t.Fatalf("%s recebeu %s", nome, m)
		}
	}
	if m := ler(t, bia); m != `{"tipo":"b"}` {
		t.Fatalf("a Beatriz recebeu %s; queria só o b", m)
	}
	if m := ler(t, ninguem); m != `{"tipo":"marca"}` {
		t.Fatalf("o computador sem pessoa recebeu %s", m)
	}

	// A pessoa da vez muda: o computador 2 passa a agir como a pessoa 10.
	h.DefinirPessoa(2, 10)
	h.ParaPessoas([]int64{10}, evento{Tipo: "c"})
	for _, c := range []*websocket.Conn{ana1, bia, ana2} {
		if m := ler(t, c); m != `{"tipo":"c"}` {
			t.Fatalf("recebeu %s; queria o c", m)
		}
	}
}

func TestFora(t *testing.T) {
	h := NovoHub(Config{})
	cli, srv := par(t, nil)
	r := h.Reservar(1)
	r.DefinirPessoa(10)
	feito := servir(t, r, srv)
	outro, srvOutro := par(t, nil)
	servir(t, h.Reservar(2), srvOutro)

	h.Fora([]int64{1})
	if m := ler(t, cli); m != `{"tipo":"fora"}` {
		t.Fatalf("recebeu %s; queria o fora", m)
	}
	if c := fechamento(t, cli); c != CodigoFora {
		t.Fatalf("fechou com %d; queria 4001", c)
	}
	esperar(t, feito)
	// Só ele saiu: o outro segue no hub.
	h.ParaPessoas([]int64{10}, evento{Tipo: "depois"})
	h.ParaComputadores([]int64{2}, evento{Tipo: "outro"})
	if m := ler(t, outro); m != `{"tipo":"outro"}` {
		t.Fatalf("o outro recebeu %s", m)
	}
	if n := conectados(h); n != 1 {
		t.Fatalf("o hub tem %d conexões; queria 1", n)
	}
}

// O fora passa na frente dos eventos que esperam na fila: depois de o computador sair,
// nada mais da pessoa vai para ele.
func TestFora_PassaNaFrente(t *testing.T) {
	h := NovoHub(Config{})
	cli, srv := par(t, nil)
	servir(t, h.Reservar(1), srv)
	h.mu.Lock()
	fila := h.conexoes[1].fila
	h.mu.Unlock()
	// O cliente ainda não lê: o 1 fica no meio da escrita, e o 2 e o 3 esperam na fila.
	for i := 1; i <= 3; i++ {
		h.ParaComputadores([]int64{1}, evento{Tipo: "teste", N: i})
	}
	for prazo := time.Now().Add(5 * time.Second); len(fila) != 2; time.Sleep(time.Millisecond) {
		if time.Now().After(prazo) {
			t.Fatalf("a fila ficou com %d; queria o 1 na escrita e 2 esperando", len(fila))
		}
	}
	h.Fora([]int64{1})
	if m := ler(t, cli); m != `{"tipo":"teste","n":1}` {
		t.Fatalf("recebeu %s; queria o 1, que já estava sendo escrito", m)
	}
	if m := ler(t, cli); m != `{"tipo":"fora"}` {
		t.Fatalf("recebeu %s; queria o fora antes do resto da fila", m)
	}
	if c := fechamento(t, cli); c != CodigoFora {
		t.Fatalf("fechou com %d; queria 4001", c)
	}
}

// O Fora que chega entre a reserva e o Servir (o pedido ainda lia o banco e abria o
// WebSocket) não se perde.
func TestFora_DuranteAReserva(t *testing.T) {
	h := NovoHub(Config{})
	cli, srv := par(t, nil)
	r := h.Reservar(1)
	h.Fora([]int64{1})
	servir(t, r, srv)
	if m := ler(t, cli); m != `{"tipo":"fora"}` {
		t.Fatalf("recebeu %s; queria o fora", m)
	}
	if c := fechamento(t, cli); c != CodigoFora {
		t.Fatalf("fechou com %d; queria 4001", c)
	}
}

func TestDesistir(t *testing.T) {
	h := NovoHub(Config{})
	velho, srvVelho := par(t, nil)
	servir(t, h.Reservar(1), srvVelho)
	r := h.Reservar(1) // fecha a conexão velha, com 4000
	if c := fechamento(t, velho); c != CodigoOutraConexao {
		t.Fatalf("a velha fechou com %d; queria 4000", c)
	}
	r.Desistir()
	if n := conectados(h); n != 0 {
		t.Fatalf("o hub tem %d conexões depois de desistir", n)
	}
	// Um Desistir atrasado não tira a reserva nova do mesmo computador.
	cli, srv := par(t, nil)
	nova := h.Reservar(1)
	servir(t, nova, srv)
	r.Desistir()
	h.ParaComputadores([]int64{1}, evento{Tipo: "nova"})
	if m := ler(t, cli); m != `{"tipo":"nova"}` {
		t.Fatalf("recebeu %s", m)
	}
}

// O Servir do hub (sem reserva) põe a conexão no hub e entrega os eventos.
func TestServir_PeloHub(t *testing.T) {
	h := NovoHub(Config{})
	cli, srv := par(t, nil)
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		h.Servir(context.Background(), srv, 7)
	}()
	t.Cleanup(func() { srv.CloseNow(); esperar(t, feito) })
	for prazo := time.Now().Add(5 * time.Second); conectados(h) != 1; time.Sleep(time.Millisecond) {
		if time.Now().After(prazo) {
			t.Fatal("o computador não entrou no hub")
		}
	}
	h.DefinirPessoa(7, 70)
	h.ParaPessoas([]int64{70}, evento{Tipo: "oi"})
	if m := ler(t, cli); m != `{"tipo":"oi"}` {
		t.Fatalf("recebeu %s", m)
	}
}

func TestServir_Fim(t *testing.T) {
	t.Run("oClienteFecha", func(t *testing.T) {
		h := NovoHub(Config{})
		cli, srv := par(t, nil)
		feito := servir(t, h.Reservar(1), srv)
		cli.Close(websocket.StatusNormalClosure, "")
		esperar(t, feito)
		if n := conectados(h); n != 0 {
			t.Fatalf("o hub tem %d conexões", n)
		}
	})
	t.Run("oCtxAcaba", func(t *testing.T) {
		h := NovoHub(Config{})
		cli, srv := par(t, nil)
		ctx, cancel := context.WithCancel(context.Background())
		servirCom(t, ctx, h.Reservar(1), srv)
		cancel()
		if c := fechamento(t, cli); c != websocket.StatusGoingAway {
			t.Fatalf("fechou com %d; queria 1001", c)
		}
	})
}

// Review Focus 4: um app que conecta e não lê é fechado com 4002, sem atrasar os outros.
func TestComputadorLento(t *testing.T) {
	h := NovoHub(Config{Fila: 4})
	lento, srvLento := par(t, nil)
	rapido, srvRapido := par(t, nil)
	servir(t, h.Reservar(1), srvLento)
	servir(t, h.Reservar(2), srvRapido)

	// O lento não lê: pelo net.Pipe, a primeira escrita para ele fica parada, e a fila dele
	// enche. Cada envio vai aos dois e não pode esperar pelo lento.
	for i := 1; i <= 10; i++ {
		prazo := time.Now().Add(200 * time.Millisecond)
		enviou := make(chan struct{})
		go func() {
			defer close(enviou)
			h.ParaComputadores([]int64{1, 2}, evento{Tipo: "teste", N: i})
		}()
		select {
		case <-enviou:
		case <-time.After(time.Until(prazo)):
			t.Fatalf("o envio %d esperou pelo computador lento", i)
		}
		ctx, cancel := context.WithDeadline(context.Background(), prazo)
		_, msg, err := rapido.Read(ctx)
		cancel()
		if err != nil {
			t.Fatalf("o evento %d não chegou ao rápido em 200 ms: %v", i, err)
		}
		if quer := fmt.Sprintf(`{"tipo":"teste","n":%d}`, i); string(msg) != quer {
			t.Fatalf("o rápido recebeu %s; queria %s", msg, quer)
		}
	}
	if c := fechamento(t, lento); c != CodigoLento {
		t.Fatalf("o lento fechou com %d; queria 4002", c)
	}
	h.mu.Lock()
	_, temLento := h.conexoes[1]
	_, temRapido := h.conexoes[2]
	h.mu.Unlock()
	if temLento || !temRapido {
		t.Fatalf("no hub: lento %v, rápido %v; queria só o rápido", temLento, temRapido)
	}
}

func TestPing(t *testing.T) {
	cfg := Config{Ping: 50 * time.Millisecond, Espera: 150 * time.Millisecond}

	t.Run("responde", func(t *testing.T) {
		h := NovoHub(cfg)
		var pings atomic.Int32
		cli, srv := par(t, &websocket.DialOptions{OnPingReceived: func(context.Context, []byte) bool {
			pings.Add(1)
			return true
		}})
		feito := servir(t, h.Reservar(1), srv)
		msgs := make(chan string, 1)
		go func() { // o cliente lê sempre, e a leitura responde aos pings
			for {
				_, m, err := cli.Read(context.Background())
				if err != nil {
					return
				}
				msgs <- string(m)
			}
		}()
		select {
		case <-feito:
			t.Fatal("o servidor fechou um cliente que responde aos pings")
		case <-time.After(time.Second):
		}
		if n := pings.Load(); n < 5 {
			t.Fatalf("o cliente recebeu %d pings em 1 s; queria uns 20", n)
		}
		h.ParaComputadores([]int64{1}, evento{Tipo: "ainda"})
		select {
		case m := <-msgs:
			if m != `{"tipo":"ainda"}` {
				t.Fatalf("recebeu %s", m)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("depois de 1 s, o evento não chegou")
		}
	})

	t.Run("naoResponde", func(t *testing.T) {
		h := NovoHub(cfg)
		cli, srv := par(t, &websocket.DialOptions{OnPingReceived: func(context.Context, []byte) bool {
			return false // lê o ping, mas não manda o pong
		}})
		feito := servir(t, h.Reservar(1), srv)
		caiu := make(chan struct{})
		go func() {
			defer close(caiu)
			for {
				if _, _, err := cli.Read(context.Background()); err != nil {
					return
				}
			}
		}()
		select {
		case <-feito:
		case <-time.After(time.Second):
			t.Fatal("sem pong, o servidor não fechou a conexão em 1 s")
		}
		if n := conectados(h); n != 0 {
			t.Fatalf("o hub tem %d conexões", n)
		}
		select {
		case <-caiu:
		case <-time.After(5 * time.Second):
			t.Fatal("o cliente não viu a conexão cair")
		}
	})
}

// O Encerrar fecha todas as conexões com 1001, e quem chega depois também.
func TestEncerrar(t *testing.T) {
	h := NovoHub(Config{})
	cli1, srv1 := par(t, nil)
	feito1 := servir(t, h.Reservar(1), srv1)
	cli2, srv2 := par(t, nil)
	feito2 := servir(t, h.Reservar(2), srv2)

	h.Encerrar()
	for i, cli := range []*websocket.Conn{cli1, cli2} {
		if c := fechamento(t, cli); c != websocket.StatusGoingAway {
			t.Fatalf("a conexão %d fechou com %d; queria 1001", i+1, c)
		}
	}
	esperar(t, feito1)
	esperar(t, feito2)
	if n := conectados(h); n != 0 {
		t.Fatalf("o hub tem %d conexões; queria 0", n)
	}

	// Depois do Encerrar, uma conexão nova fecha na hora com 1001, pelos dois caminhos.
	cli3, srv3 := par(t, nil)
	feito3 := make(chan struct{})
	go func() { defer close(feito3); h.Servir(context.Background(), srv3, 3) }()
	if c := fechamento(t, cli3); c != websocket.StatusGoingAway {
		t.Fatalf("a conexão nova fechou com %d; queria 1001", c)
	}
	esperar(t, feito3)
	cli4, srv4 := par(t, nil)
	feito4 := servir(t, h.Reservar(4), srv4)
	if c := fechamento(t, cli4); c != websocket.StatusGoingAway {
		t.Fatalf("a reserva nova fechou com %d; queria 1001", c)
	}
	esperar(t, feito4)
	if n := conectados(h); n != 0 {
		t.Fatalf("o hub tem %d conexões depois; queria 0", n)
	}
}
