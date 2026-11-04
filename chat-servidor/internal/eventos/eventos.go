// Package eventos é o hub do WebSocket (seção 7 do protocolo). Cada computador tem uma
// conexão só, com uma fila e uma goroutine que escreve. Quem manda um evento nunca espera:
// com a fila cheia, a conexão daquele computador fecha com 4002, e os outros nem percebem.
package eventos

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Os códigos de fechamento do protocolo.
const (
	CodigoOutraConexao websocket.StatusCode = 4000 // o mesmo computador conectou de novo
	CodigoFora         websocket.StatusCode = 4001 // o computador saiu do chat
	CodigoLento        websocket.StatusCode = 4002 // a fila do computador encheu
)

// Config são os tempos e o tamanho da fila. Um campo zerado vale o padrão.
type Config struct {
	Ping   time.Duration // o intervalo entre os pings (25 s)
	Espera time.Duration // quanto o servidor espera o pong, ou uma escrita, antes de fechar (60 s)
	Fila   int           // quantos eventos esperam por um computador antes do 4002 (64)
}

// esperaFechar é o prazo da escrita do último evento (o fora) antes do fechamento.
const esperaFechar = 5 * time.Second

var eventoFora = []byte(`{"tipo":"fora"}`)

// Hub entrega os eventos aos computadores conectados.
type Hub struct {
	cfg Config

	mu sync.Mutex
	// A conexão (ou a reserva) de cada computador. A conexão que vai fechar sai daqui na
	// hora, com h.mu travado: depois disso nenhum evento chega mais a ela.
	conexoes map[int64]*conexao
}

type conexao struct {
	computador int64
	pessoa     int64       // a pessoa da vez (0: ninguém), com Hub.mu
	fila       chan []byte // os eventos esperando a escrita

	fechar chan struct{} // fechado quando a conexão tem de fechar
	umaVez sync.Once
	// Escritos antes de o canal fechar ser fechado, e lidos só depois.
	codigo websocket.StatusCode // 0: fecha já, sem o aperto de mão do fechamento
	motivo string
	ultimo []byte // o evento que vai antes do fechamento (o fora)
}

// encerrar manda a conexão fechar, sem esperar. Só o primeiro motivo vale.
func (c *conexao) encerrar(codigo websocket.StatusCode, motivo string, ultimo []byte) {
	c.umaVez.Do(func() {
		c.codigo, c.motivo, c.ultimo = codigo, motivo, ultimo
		close(c.fechar)
	})
}

// NovoHub cria o hub. Os campos zerados da Config valem 25 s, 60 s e 64.
func NovoHub(c Config) *Hub {
	if c.Ping <= 0 {
		c.Ping = 25 * time.Second
	}
	if c.Espera <= 0 {
		c.Espera = 60 * time.Second
	}
	if c.Fila <= 0 {
		c.Fila = 64
	}
	return &Hub{cfg: c, conexoes: map[int64]*conexao{}}
}

// Reserva é o lugar de um computador no hub, tomado antes do aperto de mão do WebSocket.
type Reserva struct {
	h *Hub
	c *conexao
}

// Reservar põe o computador no hub já, antes de o pedido ler o banco e abrir o WebSocket,
// e a conexão anterior dele fecha com 4000. Daqui em diante, um Fora ou um DefinirPessoa
// do computador vale para a reserva, e os eventos esperam na fila até o Servir. Assim, um
// Fora que chega enquanto o pedido lê o banco não se perde. Depois, Servir ou Desistir.
func (h *Hub) Reservar(computadorID int64) *Reserva {
	c := &conexao{
		computador: computadorID,
		fila:       make(chan []byte, h.cfg.Fila),
		fechar:     make(chan struct{}),
	}
	h.mu.Lock()
	if velha := h.conexoes[computadorID]; velha != nil {
		velha.encerrar(CodigoOutraConexao, "outra conexão", nil)
	}
	h.conexoes[computadorID] = c
	h.mu.Unlock()
	return &Reserva{h: h, c: c}
}

// DefinirPessoa diz a pessoa da vez da reserva, a que o pedido leu no banco.
func (r *Reserva) DefinirPessoa(pessoaID int64) {
	r.h.mu.Lock()
	r.c.pessoa = pessoaID
	r.h.mu.Unlock()
}

// Desistir tira a reserva do hub, quando o WebSocket não abre. Depois do Servir, ou de uma
// conexão nova do mesmo computador, não faz nada.
func (r *Reserva) Desistir() {
	r.h.encerrar(r.c, websocket.StatusGoingAway, "", nil)
}

// Servir põe a conexão do computador no hub e bloqueia até ela fechar. A conexão anterior
// do computador fecha com 4000. A pessoa da vez começa sem ninguém, até um DefinirPessoa.
// Quem ainda vai ler o banco antes de abrir o WebSocket usa o Reservar.
func (h *Hub) Servir(ctx context.Context, conn *websocket.Conn, computadorID int64) {
	h.Reservar(computadorID).Servir(ctx, conn)
}

// Servir escreve os eventos da reserva na conexão e bloqueia até ela fechar: pelo hub (4000,
// 4001 ou 4002), pelo cliente, pela rede, por um ping sem resposta ou pelo fim do ctx (1001).
func (r *Reserva) Servir(ctx context.Context, conn *websocket.Conn) {
	h, c := r.h, r.c
	// O cliente não manda nada, mas alguém tem de ler a conexão: é a leitura que responde
	// ao fechamento e entrega os pongs ao Ping. lido acaba quando a conexão cai.
	lido := conn.CloseRead(context.Background())

	acabou := make(chan struct{})
	var pinger sync.WaitGroup
	pinger.Go(func() { h.pingar(conn, c, acabou) })
	defer pinger.Wait()
	defer close(acabou)

	h.escrever(ctx, conn, c, lido)

	// A conexão já saiu do hub; c.codigo diz como fechar.
	if c.codigo == 0 {
		conn.CloseNow()
		return
	}
	if c.ultimo != nil {
		escreverUma(conn, c.ultimo, esperaFechar)
	}
	conn.Close(c.codigo, c.motivo)
}

// escrever manda os eventos da fila, um de cada vez, até a conexão ter de fechar.
func (h *Hub) escrever(ctx context.Context, conn *websocket.Conn, c *conexao, lido context.Context) {
	for {
		// O fechamento passa na frente dos eventos que ainda estão na fila.
		select {
		case <-c.fechar:
			return
		default:
		}
		select {
		case msg := <-c.fila:
			if escreverUma(conn, msg, h.cfg.Espera) != nil {
				h.encerrar(c, 0, "", nil)
			}
		case <-c.fechar:
			return
		case <-lido.Done(): // o cliente fechou, ou a rede caiu
			h.encerrar(c, 0, "", nil)
		case <-ctx.Done():
			h.encerrar(c, websocket.StatusGoingAway, "o servidor vai desligar", nil)
		}
	}
}

// escreverUma manda uma mensagem de texto, esperando no máximo espera. Se o prazo acaba no
// meio da escrita, o coder/websocket fecha a conexão.
func escreverUma(conn *websocket.Conn, msg []byte, espera time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), espera)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, msg)
}

// pingar manda um ping a cada Config.Ping e espera o pong por até Config.Espera. Sem o
// pong, a conexão fecha já, sem o aperto de mão: do outro lado ninguém responde.
func (h *Hub) pingar(conn *websocket.Conn, c *conexao, acabou <-chan struct{}) {
	t := time.NewTicker(h.cfg.Ping)
	defer t.Stop()
	for {
		select {
		case <-acabou:
			return
		case <-t.C:
		}
		ctx, cancel := context.WithTimeout(context.Background(), h.cfg.Espera)
		err := conn.Ping(ctx)
		cancel()
		if err != nil {
			h.encerrar(c, 0, "", nil)
			return
		}
	}
}

// encerrar tira a conexão do hub, se ela ainda for a do computador, e a manda fechar.
func (h *Hub) encerrar(c *conexao, codigo websocket.StatusCode, motivo string, ultimo []byte) {
	h.mu.Lock()
	if h.conexoes[c.computador] == c {
		delete(h.conexoes, c.computador)
	}
	h.mu.Unlock()
	c.encerrar(codigo, motivo, ultimo)
}

// DefinirPessoa muda a pessoa da vez do computador conectado (ou reservado). Sem conexão,
// não faz nada: quem conectar depois lê a pessoa no banco.
func (h *Hub) DefinirPessoa(computadorID, pessoaID int64) {
	h.mu.Lock()
	if c := h.conexoes[computadorID]; c != nil {
		c.pessoa = pessoaID
	}
	h.mu.Unlock()
}

// ParaPessoas manda o evento, em JSON, a todo computador conectado cuja pessoa da vez está
// em ids.
func (h *Hub) ParaPessoas(ids []int64, ev any) {
	msg, ok := codificar(ev)
	if !ok || len(ids) == 0 {
		return
	}
	quem := make(map[int64]bool, len(ids))
	for _, id := range ids {
		quem[id] = true
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.conexoes {
		if c.pessoa != 0 && quem[c.pessoa] {
			h.enfileirar(c, msg)
		}
	}
}

// ParaComputadores manda o evento, em JSON, aos computadores de ids que estão conectados.
func (h *Hub) ParaComputadores(ids []int64, ev any) {
	msg, ok := codificar(ev)
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range ids {
		if c := h.conexoes[id]; c != nil {
			h.enfileirar(c, msg)
		}
	}
}

// Fora manda {"tipo":"fora"} aos computadores e fecha a conexão deles com 4001. Vale também
// para a reserva de um pedido que ainda está lendo o banco. Chame depois de marcar a saída
// no banco: assim, quem conectar depois do Fora já é recusado pelo banco.
func (h *Hub) Fora(computadorIDs []int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range computadorIDs {
		if c := h.conexoes[id]; c != nil {
			delete(h.conexoes, id)
			c.encerrar(CodigoFora, "fora", eventoFora)
		}
	}
}

// enfileirar põe o evento na fila da conexão, sem esperar. Com a fila cheia, a conexão sai
// do hub e fecha com 4002. Com h.mu travado.
func (h *Hub) enfileirar(c *conexao, msg []byte) {
	select {
	case c.fila <- msg:
	default:
		delete(h.conexoes, c.computador)
		c.encerrar(CodigoLento, "lento", nil)
	}
}

func codificar(ev any) ([]byte, bool) {
	msg, err := json.Marshal(ev)
	if err != nil {
		slog.Error("eventos: evento sem JSON", "erro", err)
		return nil, false
	}
	return msg, true
}
