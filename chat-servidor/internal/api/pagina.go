package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/reunioes"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// A página de quem entra pelo navegador (docs/chat-protocolo.md, seção 10): o abrir, o bilhete e o canal, que é a
// ponta do WebSocket da sala de espera do gerente.

const (
	filaDoCanal       = 32          // as mensagens de um canal esperando a escrita; com a fila cheia, o canal cai
	maxMensagensCanal = 20          // as mensagens da página por minuto, em cada canal
	periodoCanal      = time.Minute // o período da janela das mensagens da página
	limiteLeitura     = 4096        // o maior quadro que a página manda; passando disso, o canal fecha (1009)
	prazoEscrita      = 10 * time.Second
	prazoFechar       = 5 * time.Second // o aperto de mão do fechamento, e a escrita do que sobrou antes dele
)

// O ping do canal, e quanto o servidor espera o pong. Variáveis (em ns) para o teste as encurtar.
var pingIntervalo, pingEspera atomic.Int64

// pedirEspera é o prazo do primeiro pedir: sem ele, o servidor fecha o canal (1000). Os pongs não contam. Em ns.
var pedirEspera atomic.Int64

func init() {
	pingIntervalo.Store(int64(25 * time.Second))
	pingEspera.Store(int64(60 * time.Second))
	pedirEspera.Store(int64(2 * time.Minute))
}

func (s *servidor) rotasDaPagina(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/pagina/reunioes/{codigo}", s.abrirPagina)
	mux.HandleFunc("GET /api/v1/pagina/canal", s.canalDaPagina)
}

// ---------- O abrir ----------

// paginaReuniaoJSON é o que a página vê da reunião: o tipo, o assunto e o inicio (só na marcada).
type paginaReuniaoJSON struct {
	Tipo    string  `json:"tipo"`
	Assunto *string `json:"assunto"`
	Inicio  *int64  `json:"inicio"`
}

// POST /api/v1/pagina/reunioes/{codigo}: sem chave e sem corpo. A janela das aberturas é a mesma do entrar do app, e
// é conferida primeiro (sem contar): cheia, é 429 tentativas, até com o código certo. Conta nela só o abrir que falha,
// o 404, como no entrar. O abrir que dá certo tem a janela própria, aberturasBoas (60 por minuto), também conferida
// antes do banco e contada só no 200: assim um endereço não empurra os bilhetes dos outros para fora da fila. O código
// que não existe, a reunião que não vale e a empresa sem as reuniões liberadas dão o mesmo 404: a página não aprende
// qual deles foi.
func (s *servidor) abrirPagina(w http.ResponseWriter, r *http.Request) {
	endereco := limites.Endereco(r)
	if ok, esperar := s.aberturas.Cabe(endereco, 1); !ok {
		erroEspera(w, "tentativas", esperar)
		return
	}
	if ok, esperar := s.aberturasBoas.Cabe(endereco, 1); !ok {
		erroEspera(w, "tentativas", esperar)
		return
	}
	naoEncontrado := func() {
		s.aberturas.Contar(endereco, 1)
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
	}
	codigo, ok := segredo.NormalizarCodigoReuniao(r.PathValue("codigo"))
	if !ok {
		naoEncontrado()
		return
	}
	reuniao, err := s.banco.ReuniaoPorCodigo(r.Context(), codigo)
	if errors.Is(err, banco.ErrNaoEncontrado) {
		naoEncontrado()
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	if !reuniao.Vale(s.agoraMs()) {
		naoEncontrado()
		return
	}
	if reuniao.Tipo != banco.TipoTeste { // a de teste não tem empresa
		e, err := s.banco.EmpresaPorID(r.Context(), reuniao.EmpresaID)
		if errors.Is(err, banco.ErrNaoEncontrado) || (err == nil && !e.Reunioes) {
			naoEncontrado()
			return
		}
		if err != nil {
			erroServidor(w, err)
			return
		}
	}
	j := paginaReuniaoJSON{Tipo: reuniao.Tipo}
	if reuniao.Assunto != "" {
		a := reuniao.Assunto
		j.Assunto = &a
	}
	if reuniao.Tipo == banco.TipoMarcada {
		inicio := reuniao.Inicio
		j.Inicio = &inicio
	}
	s.aberturasBoas.Contar(endereco, 1)
	w.Header().Set("Cache-Control", "no-store")
	escreverJSON(w, http.StatusOK, map[string]any{"reuniao": j, "bilhete": s.bilhetesPagina.novo(reuniao.ID)})
}

// ---------- Os canais abertos ----------

// Canais são os canais abertos da página. O servidor os fecha com 1001 quando desliga (Encerrar), como o hub faz com
// os WebSockets do app.
type Canais struct {
	mu        sync.Mutex
	abertos   map[*canalPagina]struct{}
	encerrado bool
}

// NovosCanais cria o conjunto, vazio.
func NovosCanais() *Canais { return &Canais{abertos: map[*canalPagina]struct{}{}} }

// registrar põe o canal no conjunto. Depois do Encerrar, não põe e devolve false: o canal fecha na hora.
func (cs *Canais) registrar(c *canalPagina) bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if cs.encerrado {
		return false
	}
	cs.abertos[c] = struct{}{}
	return true
}

func (cs *Canais) tirar(c *canalPagina) {
	cs.mu.Lock()
	delete(cs.abertos, c)
	cs.mu.Unlock()
}

// Encerrar fecha todos os canais com 1001, sem esperar, e o mesmo com todo canal que chegar depois. Quem espera
// por eles é o servidor, pelo fim dos manipuladores.
func (cs *Canais) Encerrar() {
	cs.mu.Lock()
	cs.encerrado = true
	todos := make([]*canalPagina, 0, len(cs.abertos))
	for c := range cs.abertos {
		todos = append(todos, c)
	}
	cs.mu.Unlock()
	for _, c := range todos {
		c.fechar(websocket.StatusGoingAway, "o servidor vai desligar")
	}
}

// ---------- O canal ----------

const (
	canalAberto    = iota
	canalFechando  // o Fechar: escreve o que sobrou na fila e fecha com o código
	canalDerrubado // a fila encheu, o ping não voltou, ou o canal acabou: nada mais sai
)

// canalPagina é a página de quem é de fora, para o gerente (o reunioes.Canal): a conexão, uma fila de 32 mensagens e
// uma goroutine que escreve. O Mandar e o Fechar nunca esperam: o gerente os chama de uma fila do servidor inteiro, e
// uma página parada não pode segurar os avisos das outras (M-7).
type canalPagina struct {
	conn *websocket.Conn
	fila chan []byte

	ctx    context.Context
	cancel context.CancelFunc // derruba a conexão: a leitura e a escrita voltam, e a biblioteca fecha a conexão

	mu     sync.Mutex
	estado int
	codigo websocket.StatusCode // o código do fechamento do canalFechando
	motivo string
	drenar chan struct{} // fechado no canalFechando

	pediu    chan struct{} // fechado na primeira mensagem pedir
	pediuUma sync.Once
}

func novoCanalPagina(conn *websocket.Conn) *canalPagina {
	ctx, cancel := context.WithCancel(context.Background())
	return &canalPagina{conn: conn, fila: make(chan []byte, filaDoCanal), ctx: ctx, cancel: cancel,
		drenar: make(chan struct{}), pediu: make(chan struct{})}
}

// Mandar põe a mensagem (um valor, que vira JSON) na fila, sem esperar. Com a fila cheia, derruba a conexão. Depois
// do Fechar ou da queda, não faz nada.
func (c *canalPagina) Mandar(msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		slog.Error("pagina: mensagem que não vira JSON")
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.estado != canalAberto {
		return
	}
	select {
	case c.fila <- b:
	default:
		c.estado = canalDerrubado
		c.cancel()
	}
}

// Fechar fecha o canal com o 1000, depois das mensagens que já estão na fila, sem esperar.
func (c *canalPagina) Fechar() { c.fechar(websocket.StatusNormalClosure, "") }

func (c *canalPagina) fechar(codigo websocket.StatusCode, motivo string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.estado != canalAberto {
		return
	}
	c.estado, c.codigo, c.motivo = canalFechando, codigo, motivo
	close(c.drenar)
}

// derrubar corta a conexão já: nada mais sai, e a leitura e a escrita voltam.
func (c *canalPagina) derrubar() {
	c.mu.Lock()
	c.estado = canalDerrubado
	c.mu.Unlock()
	c.cancel()
}

// escrever é a goroutine que escreve. No Fechar, escreve o que sobrou na fila e faz o aperto de mão do fechamento.
func (c *canalPagina) escrever() {
	escreve := func(ctx context.Context, b []byte, prazo time.Duration) bool {
		ctx, cancelar := context.WithTimeout(ctx, prazo)
		defer cancelar()
		if err := c.conn.Write(ctx, websocket.MessageText, b); err != nil {
			c.derrubar()
			return false
		}
		return true
	}
	for {
		select {
		case b := <-c.fila:
			if !escreve(c.ctx, b, prazoEscrita) {
				return
			}
		case <-c.drenar:
			fim := time.Now().Add(prazoFechar)
			for {
				select {
				case b := <-c.fila:
					if !escreve(c.ctx, b, time.Until(fim)) {
						return
					}
					continue
				default:
				}
				break
			}
			c.conn.Close(c.codigo, c.motivo) // espera o fechamento do outro lado, até 5 s
			return
		case <-c.ctx.Done():
			return
		}
	}
}

// pingar manda o ping a cada pingIntervalo. Sem o pong em pingEspera, derruba a conexão. A leitura do canal tem de
// estar rodando: é ela que recebe o pong.
func (c *canalPagina) pingar() {
	t := time.NewTicker(time.Duration(pingIntervalo.Load()))
	defer t.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-t.C:
			ctx, cancelar := context.WithTimeout(c.ctx, time.Duration(pingEspera.Load()))
			err := c.conn.Ping(ctx)
			cancelar()
			if err != nil {
				c.derrubar()
				return
			}
		}
	}
}

// esperarPedir fecha o canal (1000) se nenhum pedir chegar em pedirEspera: um canal parado, que só responde ao ping,
// não fica aberto para sempre.
func (c *canalPagina) esperarPedir() {
	t := time.NewTimer(time.Duration(pedirEspera.Load()))
	defer t.Stop()
	select {
	case <-c.ctx.Done():
	case <-c.pediu:
	case <-t.C:
		c.Fechar()
	}
}

// ---------- O manipulador do canal ----------

// GET /api/v1/pagina/canal?bilhete=…: o WebSocket da página. A ordem das conferências: a origem (sem gastar o
// bilhete), o bilhete, a reunião dele; só então o 101.
func (s *servidor) canalDaPagina(w http.ResponseWriter, r *http.Request) {
	// A página é de um navegador, que sempre manda a Origin: sem ela, ou com outra que não a do chat (ou do --origem),
	// é 403, e o bilhete continua valendo.
	if o := r.Header.Get("Origin"); o == "" || !s.origensPagina[o] {
		escreverErro(w, http.StatusForbidden, "proibido", nil)
		return
	}
	id, ok := s.bilhetesPagina.usar(r.URL.Query().Get("bilhete"))
	if !ok {
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return
	}
	reuniao, err := s.banco.ReuniaoPorID(r.Context(), id)
	if errors.Is(err, banco.ErrNaoEncontrado) {
		escreverErro(w, http.StatusUnauthorized, "chave", nil) // a reunião foi apagada depois do bilhete
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	var padroes []string
	for o := range s.origensPagina {
		padroes = append(padroes, padraoExato(o))
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: padroes})
	if err != nil {
		return // o Accept já respondeu
	}
	conn.SetReadLimit(limiteLeitura)
	c := novoCanalPagina(conn)
	if !s.canais.registrar(c) {
		conn.Close(websocket.StatusGoingAway, "o servidor vai desligar")
		return
	}
	defer s.canais.tirar(c)
	s.servirCanal(c, reuniao, limites.Endereco(r))
}

// estadoDaPagina é o que a leitura do canal sabe da página: o pedido, depois do pedir.
type estadoDaPagina struct {
	reuniao  banco.Reuniao
	endereco string           // quem abriu o canal, para a janela das falhas do voltar
	pedido   *reunioes.Pedido // nil até o pedir ou o voltar darem certo; vale uma vez por canal
	tratou   bool             // o canal já tratou alguma mensagem (qualquer uma): o voltar só vale como a primeira
	acabou   bool             // o voltar falhou: o canal fecha e não trata mais nada
	desistiu bool             // o Desistir já foi chamado
}

// desistir chama o Desistir do gerente, uma vez só por canal.
// O canal que desiste vai junto: depois de um voltar, o Desistir do canal velho não solta o canal novo.
func (s *servidor) desistir(st *estadoDaPagina, c *canalPagina) {
	if !st.desistiu {
		st.desistiu = true
		s.gerente.Desistir(st.pedido, c) // nil (nenhum pedido) não faz nada
	}
}

// servirCanal lê as mensagens da página até o canal acabar. Quem quer que feche o canal (a página, o servidor depois
// de uma resposta final, a fila cheia, o ping, o desligamento), a leitura volta, e o gerente recebe o Desistir uma vez:
// ele nunca guarda uma página que foi embora.
func (s *servidor) servirCanal(c *canalPagina, reuniao banco.Reuniao, endereco string) {
	st := &estadoDaPagina{reuniao: reuniao, endereco: endereco}
	var goroutines sync.WaitGroup
	goroutines.Go(c.escrever)
	goroutines.Go(c.pingar)
	goroutines.Go(c.esperarPedir)
	defer func() {
		s.desistir(st, c)
		c.derrubar()
		c.conn.CloseNow()
		goroutines.Wait()
	}()

	limite := limites.Nova(maxMensagensCanal, periodoCanal, s.banco.Relogio())
	for {
		tipo, dados, err := c.conn.Read(c.ctx)
		if err != nil {
			return
		}
		if ok, _ := limite.Usar("", 1); !ok {
			c.Mandar(erroDoCanal("limite"))
			continue
		}
		s.mensagemDaPagina(c, st, tipo, dados)
	}
}

type mensagemSimples struct {
	Tipo string `json:"tipo"`
}

type mensagemSenha struct {
	Tipo  string `json:"tipo"` // senha ou tela
	Senha string `json:"senha"`
}

type mensagemErro struct {
	Tipo string `json:"tipo"`
	Erro string `json:"erro"`
}

func erroDoCanal(erro string) mensagemErro { return mensagemErro{Tipo: "erro", Erro: erro} }

// mensagemDaPagina trata uma mensagem da página.
func (s *servidor) mensagemDaPagina(c *canalPagina, st *estadoDaPagina, tipo websocket.MessageType, dados []byte) {
	if st.acabou {
		return // o canal de um voltar que falhou está fechando: nada mais chega ao gerente
	}
	primeira := !st.tratou
	st.tratou = true
	var m struct {
		Tipo         string `json:"tipo"`
		Nome         string `json:"nome"`
		Participante string `json:"participante"`
		Volta        string `json:"volta"`
	}
	if tipo != websocket.MessageText || json.Unmarshal(dados, &m) != nil {
		c.Mandar(erroDoCanal("invalido"))
		return
	}
	switch m.Tipo {
	case "pedir":
		c.pediuUma.Do(func() { close(c.pediu) })
		if st.pedido != nil {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		p, err := s.gerente.Pedir(c.ctx, st.reuniao, m.Nome, c)
		if err != nil {
			s.erroDoGerente(c, err)
			return
		}
		st.pedido = p
	case "voltar":
		// A página que perdeu o canal volta ao pedido aceito, com a chave do aceito (ou do voltou anterior), sem a sala
		// de espera. Só vale como a primeira mensagem do canal (qualquer mensagem tratada antes, até uma sem sentido,
		// o põe fora de ordem, e o canal fica); o pedir depois do voltar também é fora de ordem. O voltou, com a chave nova, o gerente manda na mesma
		// trava que liga o canal, antes de qualquer outra mensagem. Quem falha (chave errada, pessoa esquecida,
		// reunião que acabou) conta uma falha do endereço, na janela do abrir, e o canal fecha. Nada disso vai ao log.
		c.pediuUma.Do(func() { close(c.pediu) })
		if !primeira || st.pedido != nil {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		p, _, err := s.gerente.Voltar(st.reuniao, m.Participante, m.Volta, c)
		switch {
		case err == nil:
			st.pedido = p
		case errors.Is(err, reunioes.ErrLinkInvalido):
			s.aberturas.Contar(st.endereco, 1)
			st.acabou = true
			c.Mandar(mensagemSimples{Tipo: "linkInvalido"})
			c.Fechar()
		default: // ErrForaDeOrdem: o voltar não tem outro erro
			s.aberturas.Contar(st.endereco, 1)
			st.acabou = true
			c.Mandar(erroDoCanal("invalido"))
			c.Fechar()
		}
	case "desistir":
		// A última palavra da página sobre um pedido que espera: o pedido sai (um Desistir), e o canal fecha com 1000,
		// sem mandar nada. Sem pedido, ou com ele já aceito (ou respondido), é fora de ordem e nada muda; depois do
		// aceito a página sai fechando o canal.
		// A retirada e o aceito de um colega não se cruzam: o gerente retira o pedido que espera numa trava só.
		if !s.gerente.DesistirEsperando(st.pedido) {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		st.desistiu = true // o pedido já saiu: o Desistir do fim não precisa de outro
		c.Fechar()
	case "senha":
		senha, err := s.gerente.NovaSenha(st.pedido)
		switch {
		case errors.Is(err, reunioes.ErrForaDeOrdem):
			c.Mandar(erroDoCanal("invalido"))
		case errors.Is(err, reunioes.ErrLimite):
			c.Mandar(erroDoCanal("limite"))
		case err != nil:
			s.erroDoGerente(c, err)
		default:
			c.Mandar(mensagemSenha{Tipo: "senha", Senha: senha})
		}
	case "tela":
		senha, err := s.gerente.TelaDeFora(st.pedido)
		switch {
		case errors.Is(err, reunioes.ErrForaDaReuniao):
			c.Mandar(erroDoCanal("foraDaReuniao"))
		case err != nil:
			s.erroDoGerente(c, err)
		default:
			c.Mandar(mensagemSenha{Tipo: "tela", Senha: senha})
		}
	default:
		c.Mandar(erroDoCanal("invalido"))
	}
}

// erroDoGerente diz à página o erro de uma entrada (o pedir ou o senha). O nome que não vale é o erro invalido. O
// linkInvalido é uma resposta final: o canal fecha. O cheia, o esperaCheia, o servidorCheio e o semServidor deixam o
// canal aberto, e a página pode tentar de novo. Qualquer outro erro (o banco) é do servidor: o canal fecha com 1011, e
// o log leva só o tipo do erro, nunca o texto, que podia ter dado da página.
func (s *servidor) erroDoGerente(c *canalPagina, err error) {
	var campo *regras.Erro
	switch {
	case errors.As(err, &campo):
		c.Mandar(erroDoCanal("invalido"))
	case errors.Is(err, reunioes.ErrLinkInvalido):
		c.Mandar(mensagemSimples{Tipo: "linkInvalido"})
		c.Fechar()
	case errors.Is(err, reunioes.ErrCheia):
		c.Mandar(mensagemSimples{Tipo: "cheia"})
	case errors.Is(err, reunioes.ErrEsperaCheia):
		c.Mandar(mensagemSimples{Tipo: "esperaCheia"})
	case errors.Is(err, reunioes.ErrServidorCheio):
		c.Mandar(mensagemSimples{Tipo: "servidorCheio"})
	case errors.Is(err, reunioes.ErrSemServidor):
		c.Mandar(mensagemSimples{Tipo: "semServidor"})
	case errors.Is(err, context.Canceled):
		// o canal já caiu
	default:
		slog.Error("pagina: o gerente falhou", "erro", "servidor")
		c.fechar(websocket.StatusInternalError, "erro do servidor")
	}
}
