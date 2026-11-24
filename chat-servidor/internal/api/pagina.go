package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
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
	// filaDoCanal são as mensagens de um canal esperando a escrita; com a fila cheia, o canal cai. Ela cabe a pior
	// rajada do chat da reunião que os limites deixam (10 páginas com 20 mensagens cada, num minuto), com folga para o
	// palco: só a página que parou de ler enche a fila.
	filaDoCanal       = 256
	maxMensagensCanal = 20 // as mensagens da página por minuto, em cada canal
	maxCamerasCanal   = 30 // os avisos da câmera por minuto, em cada canal: a janela é à parte das 20
	// As mensagens do chat da reunião por minuto, em cada canal: outra janela à parte, que conta toda mensagem com esse
	// tipo. O limite de cada pessoa (as 20 que ela repassa por minuto, com um canal ou com vários) é do gerente.
	maxMensagensChat = 20
	periodoCanal     = time.Minute // o período da janela das mensagens da página
	limiteLeitura    = 4096        // o maior quadro que a página manda; passando disso, o canal fecha (1009)
	prazoEscrita     = 10 * time.Second
	prazoFechar      = 5 * time.Second // o aperto de mão do fechamento, e a escrita do que sobrou antes dele
)

// O ping do canal, e quanto o servidor espera o pong. Variáveis (em ns) para o teste as encurtar.
var pingIntervalo, pingEspera atomic.Int64

// pedirEspera é o prazo do primeiro pedir (ou do entrar, no canal de colega): sem ele, o servidor fecha o canal (1000).
// Os pongs não contam. Em ns.
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

// POST /api/v1/pagina/reunioes/{codigo}: sem chave. O corpo é opcional (ver colegaDoCorpo): sem ele, quem abre é de
// fora; com o passe ou com a chave do colega, a página o reconhece. A janela das aberturas é a mesma do entrar do app, e
// é conferida primeiro (sem contar): cheia, é 429 tentativas, até com o código certo. Conta nela só o abrir que falha,
// o 404, como no entrar, e o 400 e o 401 do corpo. O abrir que dá certo tem a janela própria, aberturasBoas (60 por minuto), também conferida
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
	// O corpo só é lido depois de tudo que vale hoje: o 404 vem antes de qualquer coisa do passe.
	colega, trocouPasse, quem, ok := s.colegaDoCorpo(w, r, reuniao, endereco)
	if !ok {
		return
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
	resposta := map[string]any{"reuniao": j}
	if quem != nil {
		if trocouPasse {
			quem["chave"] = s.passes.novaChave(colega)
		}
		quem["valeAte"] = nil // a naHora vale até acabar
		if reuniao.Tipo != banco.TipoNaHora {
			quem["valeAte"] = reuniao.ValeAte
		}
		resposta["colega"] = quem
	}
	bilhete := s.bilhetesPagina.novo(reuniao.ID)
	if quem != nil {
		s.passes.prenderBilhete(bilhete, colega)
	}
	resposta["bilhete"] = bilhete
	resposta["partida"] = s.partida
	s.aberturasBoas.Contar(endereco, 1)
	w.Header().Set("Cache-Control", "no-store")
	escreverJSON(w, http.StatusOK, resposta)
}

// maxCorpoDoAbrir é o maior corpo do abrir: um objeto com um passe ou uma chave de 43 caracteres cabe com folga.
const maxCorpoDoAbrir = 256

var formaDoPasseOuChave = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// colegaDoCorpo lê o corpo do abrir e, com um passe ou uma chave do colega que valem, devolve quem é. Sem corpo,
// devolve quem == nil e ok: a página é de fora. Qualquer outro corpo tem de ser um objeto JSON com exatamente um
// campo, passe ou colega, e nada depois dele; senão é 400 invalido, com o campo que está fora da regra ("corpo" nos
// outros casos). O passe, a chave, a pessoa ou o computador que não valem mais são 401 passe, e a chave que veio é
// esquecida. O 400 e o 401 contam na janela das tentativas, como o 404. quem já leva o nome; o valeAte e a chave
// nova quem põe é o abrirPagina.
func (s *servidor) colegaDoCorpo(w http.ResponseWriter, r *http.Request, reuniao banco.Reuniao, endereco string) (colega colegaDaPagina, trocouPasse bool, quem map[string]any, ok bool) {
	falhou := func(status int, erro string, extras map[string]any) {
		s.aberturas.Contar(endereco, 1)
		escreverErro(w, status, erro, extras)
	}
	invalido := func(campo string) {
		falhou(http.StatusBadRequest, "invalido", map[string]any{"campo": campo})
	}
	dados, err := io.ReadAll(io.LimitReader(r.Body, maxCorpoDoAbrir+1))
	if err != nil {
		invalido("corpo")
		return
	}
	if len(dados) == 0 {
		return colega, false, nil, true
	}
	if len(dados) > maxCorpoDoAbrir {
		invalido("corpo")
		return
	}
	var campos map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(dados))
	if err := dec.Decode(&campos); err != nil {
		invalido("corpo")
		return
	}
	if _, err := dec.Token(); err != io.EOF { // depois do objeto só pode haver espaço em branco
		invalido("corpo")
		return
	}
	if len(campos) != 1 {
		invalido("corpo")
		return
	}
	var campo string
	var bruto json.RawMessage
	for k, v := range campos {
		campo, bruto = k, v
	}
	if campo != "passe" && campo != "colega" {
		invalido("corpo")
		return
	}
	var texto string
	if json.Unmarshal(bruto, &texto) != nil || !formaDoPasseOuChave.MatchString(texto) {
		invalido(campo)
		return
	}

	var achou bool
	if campo == "passe" {
		colega, achou = s.passes.gastarPasse(texto, reuniao.ID)
	} else {
		colega, achou = s.passes.conferirChave(texto, reuniao.ID)
	}
	semPasse := func() {
		if campo == "colega" {
			s.passes.esquecerChave(texto)
		}
		falhou(http.StatusUnauthorized, "passe", nil)
	}
	if !achou {
		semPasse()
		return
	}
	// Quem o passe reconhece pode ter saído do chat depois: a pessoa, ou o computador que o pediu.
	pessoa, err := s.banco.PessoaPorID(r.Context(), colega.empresaID, colega.pessoaID)
	if errors.Is(err, banco.ErrNaoEncontrado) || (err == nil && pessoa.Saiu) {
		semPasse()
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	computador, err := s.banco.ComputadorAtivo(r.Context(), colega.computadorID)
	if errors.Is(err, banco.ErrNaoEncontrado) || (err == nil && computador.EmpresaID != colega.empresaID) {
		semPasse()
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	return colega, campo == "passe", map[string]any{"nome": pessoa.Nome}, true
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

// canalPagina é a página de quem é de fora, para o gerente (o reunioes.Canal): a conexão, uma fila de mensagens e
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

	pediu    chan struct{} // fechado na primeira mensagem pedir (ou entrar, no canal de colega)
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

// esperarPedir fecha o canal (1000) se nenhum pedir (ou entrar) chegar em pedirEspera: um canal parado, que só responde
// ao ping, não fica aberto para sempre.
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
// bilhete), o bilhete, a reunião dele; só então o 101. O bilhete que o abrir prendeu a um colega desta reunião abre o
// canal de colega (o entrar, sem a sala de espera); qualquer outro abre o de quem é de fora, como sempre.
func (s *servidor) canalDaPagina(w http.ResponseWriter, r *http.Request) {
	// A página é de um navegador, que sempre manda a Origin: sem ela, ou com outra que não a do chat (ou do --origem),
	// é 403, e o bilhete continua valendo.
	if o := r.Header.Get("Origin"); o == "" || !s.origensPagina[o] {
		escreverErro(w, http.StatusForbidden, "proibido", nil)
		return
	}
	bilhete := r.URL.Query().Get("bilhete")
	id, ok := s.bilhetesPagina.usar(bilhete)
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
	var colega *colegaDaPagina
	if k, ok := s.passes.colegaDoBilhete(bilhete); ok && k.reuniaoID == reuniao.ID {
		colega = &k
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
	s.servirCanal(c, reuniao, colega, limites.Endereco(r))
}

// estadoDaPagina é o que a leitura do canal sabe da página: o pedido, depois do pedir (ou do entrar).
type estadoDaPagina struct {
	reuniao  banco.Reuniao
	colega   *colegaDaPagina  // o colega que o bilhete reconheceu: o canal é de colega; nil no de quem é de fora
	endereco string           // quem abriu o canal, para a janela das falhas do voltar
	pedido   *reunioes.Pedido // nil até o pedir ou o voltar darem certo; vale uma vez por canal
	tratou   bool             // o canal já tratou alguma mensagem (qualquer uma): o voltar só vale como a primeira
	voltou   bool             // o voltar deu certo, e o canal ainda não tratou outra mensagem
	acabou   bool             // o voltar falhou, ou o colega não vale mais: o canal fecha e não trata mais nada
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
func (s *servidor) servirCanal(c *canalPagina, reuniao banco.Reuniao, colega *colegaDaPagina, endereco string) {
	st := &estadoDaPagina{reuniao: reuniao, colega: colega, endereco: endereco}
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
	limiteCamera := limites.Nova(maxCamerasCanal, periodoCanal, s.banco.Relogio())
	limiteChat := limites.Nova(maxMensagensChat, periodoCanal, s.banco.Relogio())
	for {
		tipo, dados, err := c.conn.Read(c.ctx)
		if err != nil {
			return
		}
		qual := ""
		if tipo == websocket.MessageText {
			qual = tipoDaMensagem(dados)
		}
		switch qual {
		case "camera":
			// O aviso da câmera tem a janela dele, e não gasta a das 20. O que passa das 30 é ignorado, sem resposta.
			if ok, _ := limiteCamera.Usar("", 1); !ok {
				continue
			}
		case "mensagem":
			// O chat da reunião também tem a dele: não gasta a das 20, e as outras mensagens não gastam a dele. Toda
			// mensagem com esse tipo conta, valha ou não. A que passa das 20 é recusada, e não chega ao gerente.
			if ok, _ := limiteChat.Usar("", 1); !ok {
				c.Mandar(alemDoLimiteDoChat(dados))
				continue
			}
		default:
			if ok, _ := limite.Usar("", 1); !ok {
				c.Mandar(erroDoCanal("limite"))
				continue
			}
		}
		s.mensagemDaPagina(c, st, tipo, dados)
	}
}

// tipoDaMensagem é o tipo de uma mensagem da página, antes dos limites ("" se não for um JSON com tipo de texto).
func tipoDaMensagem(dados []byte) string {
	var m struct {
		Tipo string `json:"tipo"`
	}
	if json.Unmarshal(dados, &m) != nil {
		return ""
	}
	return m.Tipo
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

// mensagemRecusada é a recusa de uma mensagem do chat da reunião, só para quem a escreveu: o id é o da mensagem.
type mensagemRecusada struct {
	Tipo   string `json:"tipo"`
	ID     string `json:"id"`
	Motivo string `json:"motivo"` // limite, grande, foraDaReuniao ou invalida
}

func recusaDoChat(id, motivo string) mensagemRecusada {
	return mensagemRecusada{Tipo: "mensagemRecusada", ID: id, Motivo: motivo}
}

// O id de uma mensagem do chat da reunião: de 1 a 16 letras ou números. É a página que o escolhe.
var reIDDaMensagem = regexp.MustCompile(`^[A-Za-z0-9]{1,16}$`)

// mensagemDoChat são os campos de uma mensagem do chat da reunião. O texto que falta (ou que é null) fica nil.
type mensagemDoChat struct {
	ID    string  `json:"id"`
	Texto *string `json:"texto"`
}

// lerMensagemDoChat lê o id e o texto. Sem um id que valha, ou sem um texto que seja texto, não há mensagem.
func lerMensagemDoChat(dados []byte) (id, texto string, ok bool) {
	var m mensagemDoChat
	if json.Unmarshal(dados, &m) != nil || !reIDDaMensagem.MatchString(m.ID) || m.Texto == nil {
		return "", "", false
	}
	return m.ID, *m.Texto, true
}

// alemDoLimiteDoChat é a resposta à mensagem do chat que passou das 20 do minuto: a recusa, com o id dela; sem um
// id que valha, não há de qual mensagem dizer, e a resposta é o erro de sempre.
func alemDoLimiteDoChat(dados []byte) any {
	var m mensagemDoChat
	if json.Unmarshal(dados, &m) != nil || !reIDDaMensagem.MatchString(m.ID) {
		return erroDoCanal("limite")
	}
	return recusaDoChat(m.ID, "limite")
}

// mensagemDaPagina trata uma mensagem da página.
func (s *servidor) mensagemDaPagina(c *canalPagina, st *estadoDaPagina, tipo websocket.MessageType, dados []byte) {
	if st.acabou {
		return // o canal de um voltar que falhou está fechando: nada mais chega ao gerente
	}
	primeira := !st.tratou
	st.tratou = true
	if st.voltou {
		// A primeira mensagem depois do voltou (o senha ou o tela, que a página só manda com ele na mão) mostra que a
		// página tem a chave nova: a anterior, que ainda valia para o voltou que se perdesse, para de valer.
		st.voltou = false
		s.gerente.VoltaConfirmada(st.pedido, c)
	}
	var m struct {
		Tipo         string `json:"tipo"`
		Nome         string `json:"nome"`
		Participante string `json:"participante"`
		Volta        string `json:"volta"`
		Ligada       *bool  `json:"ligada"` // o camera: tem de ser um booleano
	}
	if tipo != websocket.MessageText || json.Unmarshal(dados, &m) != nil {
		c.Mandar(erroDoCanal("invalido"))
		return
	}
	switch m.Tipo {
	case "pedir":
		// O colega não pede: ele entra. No canal dele, o pedir é fora de ordem, não conta no prazo, e o canal fica.
		if st.colega != nil {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
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
	case "entrar":
		// O colega que a página reconheceu entra sem a sala de espera. Só no canal de colega (no de quem é de fora, é
		// fora de ordem, e o canal fica), e uma vez: depois do aceito, ou do voltou, também é fora de ordem. Conta no
		// prazo como o pedir. A pessoa e o computador são lidos agora no banco: a que saiu da empresa depois do abrir,
		// ou o computador desligado do chat, não entra, e o canal fecha; o nome que vai à reunião é o do cadastro de
		// agora. Os outros erros são os do pedir.
		if st.colega == nil {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		c.pediuUma.Do(func() { close(c.pediu) })
		if st.pedido != nil {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		pessoa, ok := s.colegaAindaVale(c, st, st.colega.empresaID, st.colega.pessoaID, st.colega.computadorID)
		if !ok {
			return
		}
		p, err := s.gerente.EntrarPelaPagina(c.ctx, st.reuniao, pessoa, st.colega.computadorID, c)
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
			st.pedido, st.voltou = p, true
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
		// A retirada e o aceito de um colega não se cruzam: o gerente retira o pedido que espera numa trava só. O canal de
		// colega nunca tem um pedido esperando: nele, o desistir é sempre fora de ordem.
		if st.colega != nil || !s.gerente.DesistirEsperando(st.pedido) {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		st.desistiu = true // o pedido já saiu: o Desistir do fim não precisa de outro
		c.Fechar()
	case "camera":
		// O aviso da câmera nunca tem resposta quando vale: o palco, se mudou, chega pelo gerente às páginas aceitas que
		// estão na reunião, ou entrando.
		if m.Ligada == nil || errors.Is(s.gerente.Camera(st.pedido, *m.Ligada), reunioes.ErrForaDeOrdem) {
			c.Mandar(erroDoCanal("invalido"))
		}
	case "mensagem":
		// O chat da reunião: o gerente repassa o texto às páginas da reunião, também a esta, que recebe a própria
		// mensagem de volta com o id; não há outra resposta. A recusa diz o id e o motivo. Nada disso vai ao log.
		id, texto, ok := lerMensagemDoChat(dados)
		if !ok {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
		switch err := s.gerente.Mensagem(st.pedido, id, texto); {
		case err == nil:
		case errors.Is(err, reunioes.ErrForaDaReuniao):
			c.Mandar(recusaDoChat(id, "foraDaReuniao"))
		case errors.Is(err, reunioes.ErrLimiteDoChat): // as 20 do participante, que um canal novo dele não zera
			c.Mandar(recusaDoChat(id, "limite"))
		case errors.Is(err, regras.ErrTextoGrande):
			c.Mandar(recusaDoChat(id, "grande"))
		default: // o *regras.Erro: o texto vazio, ou com um caractere que não vale
			c.Mandar(recusaDoChat(id, "invalida"))
		}
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
	case "aceitar", "recusar", "tirar", "encerrar":
		s.respostaDoColega(c, st, m.Tipo, dados)
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

// O id de um pedido ou de um participante, como o gerente os emite: 16 hexadecimais minúsculos.
var reIDDoGerente = regexp.MustCompile(`^[0-9a-f]{16}$`)

// mensagemRecusa é a recusa de uma resposta do colega (o aceitar, o recusar, o tirar ou o encerrar): de é o tipo da
// mensagem que falhou.
type mensagemRecusa struct {
	Tipo   string `json:"tipo"`
	De     string `json:"de"`
	Motivo string `json:"motivo"` // jaRespondido, naoEncontrado, cheia, foraDaReuniao ou servidorVideo
}

// mensagemFeito confirma, só ao canal que respondeu, a resposta (o aceitar, o recusar ou o tirar) que deu certo: de é o
// tipo da resposta e id, o do pedido ou o do participante. O encerrar que dá certo não tem feito: o encerrada é o fim.
type mensagemFeito struct {
	Tipo string `json:"tipo"`
	De   string `json:"de"`
	ID   string `json:"id"`
}

// idDaMensagem é o campo da mensagem, quando ele é um texto com a forma de um id do gerente.
func idDaMensagem(dados []byte, campo string) (string, bool) {
	var campos map[string]json.RawMessage
	var id string
	if json.Unmarshal(dados, &campos) != nil || json.Unmarshal(campos[campo], &id) != nil || !reIDDoGerente.MatchString(id) {
		return "", false
	}
	return id, true
}

// respostaDoColega trata o aceitar, o recusar (com o pedido), o tirar (com o participante) e o encerrar: as rotas do
// app com o mesmo nome, pelo canal. Valem só no canal cujo pedido é o de um colega (o ColegaDoPedido), também o que
// voltou pelo voltar com um bilhete comum; em outro canal, ou com o campo que falta ou não é um id, a resposta é o erro
// invalido, e o canal fica. A pessoa e o computador do participante são lidos de novo a cada resposta, como as rotas do
// app fazem a cada pedido: a pessoa que saiu da empresa, ou o computador desligado do chat, recebe o erro invalido, e o
// canal fecha. As regras são as do gerente, pela pessoa: o colega tem de estar na reunião. O que dá certo é confirmado
// com o feito (o aceitar, o recusar e o tirar) além do participantes novo, ou termina no encerrada; o que falha recebe
// o recusa. Nada disso vai ao log, a não ser o código de uma falha do servidor de vídeo.
func (s *servidor) respostaDoColega(c *canalPagina, st *estadoDaPagina, tipo string, dados []byte) {
	pessoa, computador, ok := s.gerente.ColegaDoPedido(st.pedido)
	if !ok {
		c.Mandar(erroDoCanal("invalido"))
		return
	}
	if _, ok := s.colegaAindaVale(c, st, st.reuniao.EmpresaID, pessoa, computador); !ok {
		return
	}
	campo := "pedido"
	switch tipo {
	case "tirar":
		campo = "participante"
	case "encerrar":
		campo = ""
	}
	var id string
	if campo != "" {
		if id, ok = idDaMensagem(dados, campo); !ok {
			c.Mandar(erroDoCanal("invalido"))
			return
		}
	}
	var err error
	switch tipo {
	case "aceitar":
		err = s.gerente.Aceitar(c.ctx, st.reuniao, pessoa, id)
	case "recusar":
		err = s.gerente.Recusar(c.ctx, st.reuniao, pessoa, id)
	case "tirar":
		err = s.gerente.Tirar(c.ctx, st.reuniao, pessoa, id)
	default:
		err = s.gerente.Encerrar(c.ctx, st.reuniao, pessoa)
	}
	if err != nil {
		c.Mandar(mensagemRecusa{Tipo: "recusa", De: tipo, Motivo: motivoDaRecusa(err)})
	} else if tipo != "encerrar" {
		c.Mandar(mensagemFeito{Tipo: "feito", De: tipo, ID: id})
	}
}

// colegaAindaVale lê de novo a pessoa e o computador de um colega do canal. A pessoa que saiu da empresa (ou que não
// existe mais) e o computador desligado (ou de outra empresa) recebem o erro invalido, e o canal fecha e não trata mais
// nada; a falha do banco é a do erroDoGerente. Só com ok o canal segue.
func (s *servidor) colegaAindaVale(c *canalPagina, st *estadoDaPagina, empresaID, pessoaID, computadorID int64) (banco.Pessoa, bool) {
	pessoa, err := s.banco.PessoaPorID(c.ctx, empresaID, pessoaID)
	if err == nil && !pessoa.Saiu {
		var computador banco.Computador
		computador, err = s.banco.ComputadorAtivo(c.ctx, computadorID)
		if err == nil && computador.EmpresaID == empresaID {
			return pessoa, true
		}
	}
	if err == nil || errors.Is(err, banco.ErrNaoEncontrado) {
		st.acabou = true
		c.Mandar(erroDoCanal("invalido"))
		c.Fechar()
	} else {
		s.erroDoGerente(c, err)
	}
	return banco.Pessoa{}, false
}

// motivoDaRecusa é o motivo do recusa para o erro do gerente. Os que não são dele (o servidor de vídeo fora do ar, ou
// uma falha do agente no tirar ou no encerrar) são o servidorVideo; a falha do agente vai ao log só com o código.
func motivoDaRecusa(err error) string {
	switch {
	case errors.Is(err, reunioes.ErrJaRespondido):
		return "jaRespondido"
	case errors.Is(err, reunioes.ErrPedidoNaoEncontrado), errors.Is(err, reunioes.ErrParticipanteNaoEncontrado):
		return "naoEncontrado"
	case errors.Is(err, reunioes.ErrCheia):
		return "cheia"
	case errors.Is(err, reunioes.ErrForaDaReuniao):
		return "foraDaReuniao"
	case errors.Is(err, reunioes.ErrSemServidor), errors.Is(err, context.Canceled):
	default:
		slog.Warn("pagina: o servidor de vídeo falhou", "erro", codigoDoVideo(err))
	}
	return "servidorVideo"
}

// erroDoGerente diz à página o erro de uma entrada (o pedir, o entrar ou o senha). O nome que não vale é o erro
// invalido. O linkInvalido é uma resposta final: o canal fecha. O cheia, o esperaCheia, o servidorCheio e o semServidor
// deixam o canal aberto, e a página pode tentar de novo. Qualquer outro erro (o banco) é do servidor: o canal fecha com 1011, e
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
