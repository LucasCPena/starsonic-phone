package video

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Os erros do cliente. Nenhum leva a chave, uma sala ou um participante.
var (
	// ErrChave: a chave não vale (o 401 do agente), ou não é uma chave.
	ErrChave = errors.New("video: chave recusada")
	// ErrSemResposta: o agente não respondeu (falha de rede, um 5xx ou o tempo esgotado). O 503 "freeswitch" cai
	// aqui também: quem usa decide o que ele quer dizer.
	ErrSemResposta = errors.New("video: o servidor de vídeo não respondeu")
	// ErrNaoEncontrado: a sala ou o participante não estão no FreeSWITCH (o 404).
	ErrNaoEncontrado = errors.New("video: não encontrado")
)

// Os tempos do cliente. São variáveis do pacote para os testes os encurtarem.
var (
	// EsperaPedido é quanto um pedido (estado, tirar, encerrar) pode levar.
	EsperaPedido = 10 * time.Second
	// SilencioMaximo é quanto a conexão dos eventos pode ficar sem nada (o agente manda um relógio a cada 25 s)
	// antes de contar como caída.
	SilencioMaximo = 60 * time.Second
	// EsperaReconexao é a primeira espera antes de conectar de novo. Ela dobra até EsperaReconexaoMaxima.
	EsperaReconexao = time.Second
	// EsperaReconexaoMaxima é a maior espera entre duas conexões.
	EsperaReconexaoMaxima = 30 * time.Second
)

const (
	maximoResposta = 1 << 20 // o corpo de uma resposta, e uma linha dos eventos
	prefixoAPI     = "/agente/v1"
)

// Participante é uma ligação da sala: a da câmera, com Tela falso, ou a da tela compartilhada.
type Participante struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
}

// Sala é uma reunião no servidor de vídeo.
type Sala struct {
	Sala          string         `json:"sala"`
	Participantes []Participante `json:"participantes"`
}

// Uso é a CPU (a do último minuto) e a memória (a de agora) da VM, em porcentagem inteira.
type Uso struct {
	CPU     int `json:"cpu"`
	Memoria int `json:"memoria"`
}

// Estado é a resposta do GET /agente/v1/estado.
type Estado struct {
	Versao     string `json:"versao"`
	FreeSWITCH bool   `json:"freeswitch"`
	Agora      int64  `json:"agora"` // o relógio do agente, em milissegundos UTC
	Salas      []Sala `json:"salas"`
	Uso        Uso    `json:"uso"`
}

// Evento é um evento da conexão dos eventos (seção 5). Cada Tipo usa só os seus campos: o "estado" usa o Agora, o
// FreeSWITCH e as Salas; o "entrou" e o "saiu", a Sala, o Participante e a Tela; o "acabou", a Sala; o "relogio", o
// Agora.
type Evento struct {
	Tipo         string `json:"tipo"`
	Sala         string `json:"sala"`
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
	Agora        int64  `json:"agora"`
	FreeSWITCH   bool   `json:"freeswitch"`
	Salas        []Sala `json:"salas"`
}

// ValidarEndereco confere o endereço do servidor de vídeo: um nome com pelo menos um ponto e a porta opcional,
// sem "https://" e sem caminho. No modo de teste vale também "http://127.0.0.1:<porta>".
func ValidarEndereco(endereco string, teste bool) error {
	if strings.HasPrefix(endereco, "http://") {
		if !teste {
			return errors.New("o endereço do vídeo é um nome, sem \"http://\"")
		}
		host, porta, err := net.SplitHostPort(strings.TrimPrefix(endereco, "http://"))
		if err != nil || host != "127.0.0.1" || !portaValida(porta) {
			return errors.New("no modo de teste, o endereço é http://127.0.0.1:<porta>")
		}
		return nil
	}
	host, porta := endereco, ""
	if i := strings.LastIndexByte(endereco, ':'); i >= 0 {
		host, porta = endereco[:i], endereco[i+1:]
		if !portaValida(porta) {
			return errors.New("a porta do endereço do vídeo não vale")
		}
	}
	if !nomeValido(host) {
		return errors.New("o endereço do vídeo deve ser um nome, como video.exemplo.com.br, com a porta se houver, sem https:// e sem caminho")
	}
	return nil
}

func portaValida(p string) bool {
	n, err := strconv.Atoi(p)
	return err == nil && n >= 1 && n <= 65535 && strconv.Itoa(n) == p
}

// nomeValido: pelo menos dois rótulos de letras, números e hífens (sem hífen nas pontas), e o último não
// numérico (um IP não é um nome).
func nomeValido(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	rotulos := strings.Split(h, ".")
	if len(rotulos) < 2 {
		return false
	}
	for _, r := range rotulos {
		if r == "" || len(r) > 63 || r[0] == '-' || r[len(r)-1] == '-' {
			return false
		}
		for i := range len(r) {
			c := r[i]
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	ultimo := rotulos[len(rotulos)-1]
	if _, err := strconv.Atoi(ultimo); err == nil {
		return false
	}
	return true
}

// Cliente fala com o agente de um servidor de vídeo. É seguro entre goroutines.
type Cliente struct {
	base     string // https://<endereço>, ou http://127.0.0.1:<porta> no modo de teste
	endereco string // o host com a porta
	wss      string
	chave    []byte
	bearer   string

	pedidos *http.Client // com o prazo dos pedidos, pelo EsperaPedido de cada um
	fluxo   *http.Client // os eventos, sem prazo: quem manda é o silêncio

	mu        sync.Mutex
	conectou  bool          // a conexão dos eventos está aberta
	fsNoAr    bool          // o último estado dos eventos disse freeswitch verdadeiro
	diferenca time.Duration // o relógio do agente menos o local, medido no último estado ou relogio
}

// NovoCliente valida o endereço e a chave e devolve o cliente. Nada vai à rede aqui.
func NovoCliente(endereco, chave string, teste bool) (*Cliente, error) {
	if err := ValidarEndereco(endereco, teste); err != nil {
		return nil, err
	}
	bytes, err := LerChave(chave)
	if err != nil {
		return nil, err
	}
	c := &Cliente{chave: bytes, bearer: "Bearer " + chave}
	if strings.HasPrefix(endereco, "http://") {
		c.base = endereco
		c.endereco = strings.TrimPrefix(endereco, "http://")
		c.wss = "ws://" + c.endereco + "/sip"
	} else {
		c.base = "https://" + endereco
		c.endereco = endereco
		c.wss = "wss://" + endereco + "/sip"
	}
	semRedirecionar := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c.pedidos = &http.Client{CheckRedirect: semRedirecionar}
	c.fluxo = &http.Client{CheckRedirect: semRedirecionar}
	return c, nil
}

// Endereco é o host do servidor de vídeo, com a porta.
func (c *Cliente) Endereco() string { return c.endereco }

// WSS é o endereço do /sip que o navegador abre: wss://<endereço>/sip, ou ws://127.0.0.1:<porta>/sip no modo de
// teste.
func (c *Cliente) WSS() string { return c.wss }

// Chave são os 32 bytes da chave, para assinar a senha e tirar o segredo do TURN.
func (c *Cliente) Chave() []byte { return c.chave }

// Agora é a hora do servidor de vídeo: a local mais a diferença medida no último estado ou relogio. Sem medida
// ainda, é a local. A senha leva o vence nesse relógio (seção 3).
func (c *Cliente) Agora() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return time.Now().Add(c.diferenca)
}

// NoAr diz se o vídeo está no ar: a conexão dos eventos está aberta e o último estado dela disse que o agente está
// ligado ao FreeSWITCH.
func (c *Cliente) NoAr() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conectou && c.fsNoAr
}

// medir guarda a diferença entre o relógio do agente (agoraMs) e o local, medida no instante recebido.
func (c *Cliente) medir(agoraMs int64, recebido time.Time) {
	if agoraMs <= 0 {
		return
	}
	d := time.UnixMilli(agoraMs).Sub(recebido)
	c.mu.Lock()
	c.diferenca = d
	c.mu.Unlock()
}

func (c *Cliente) novoPedido(ctx context.Context, metodo, caminho string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, metodo, c.base+caminho, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.bearer)
	return req, nil
}

// traduzir dá o erro de um status que não é de sucesso. Nunca devolve o texto da resposta nem o da rede.
func traduzir(status int) error {
	switch {
	case status == http.StatusUnauthorized:
		return ErrChave
	case status == http.StatusNotFound:
		return ErrNaoEncontrado
	case status >= 500:
		return ErrSemResposta
	default:
		return fmt.Errorf("video: resposta inesperada do servidor de vídeo (%d)", status)
	}
}

// fazer manda o pedido, com o prazo de EsperaPedido, e devolve o corpo (até 1 MiB) de uma resposta 2xx. Se o ctx de
// quem chamou acaba, devolve o erro dele; no mais, a rede e o prazo viram ErrSemResposta, sem o texto da rede (que
// leva o endereço e a rota).
func (c *Cliente) fazer(ctx context.Context, metodo, caminho string) ([]byte, error) {
	pedCtx, cancela := context.WithTimeout(ctx, EsperaPedido)
	defer cancela()
	req, err := c.novoPedido(pedCtx, metodo, caminho)
	if err != nil {
		return nil, ErrSemResposta
	}
	resp, err := c.pedidos.Do(req)
	if err != nil {
		return nil, erroDeRede(ctx)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, maximoResposta))
		return nil, traduzir(resp.StatusCode)
	}
	corpo, err := io.ReadAll(io.LimitReader(resp.Body, maximoResposta))
	if err != nil {
		return nil, erroDeRede(ctx)
	}
	return corpo, nil
}

func erroDeRede(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return ErrSemResposta
}

// Estado lê o estado do agente e mede o relógio dele.
func (c *Cliente) Estado(ctx context.Context) (Estado, error) {
	corpo, err := c.fazer(ctx, http.MethodGet, prefixoAPI+"/estado")
	recebido := time.Now()
	if err != nil {
		return Estado{}, err
	}
	var e Estado
	if err := json.Unmarshal(corpo, &e); err != nil {
		return Estado{}, ErrSemResposta
	}
	c.medir(e.Agora, recebido)
	return e, nil
}

// Tirar derruba as ligações do participante na sala, a da câmera e a da tela.
func (c *Cliente) Tirar(ctx context.Context, sala, participante string) error {
	_, err := c.fazer(ctx, http.MethodPost,
		prefixoAPI+"/salas/"+url.PathEscape(sala)+"/participantes/"+url.PathEscape(participante)+"/tirar")
	return err
}

// Encerrar derruba todas as ligações da sala.
func (c *Cliente) Encerrar(ctx context.Context, sala string) error {
	_, err := c.fazer(ctx, http.MethodPost, prefixoAPI+"/salas/"+url.PathEscape(sala)+"/encerrar")
	return err
}

// Acompanhar mantém aberta a conexão dos eventos e passa cada evento ao f, na ordem, na mesma goroutine (um f
// lento atrasa a leitura, e o silêncio conta também esse tempo). Bloqueia até o ctx acabar.
//
// Quando a conexão cai, ou fica SilencioMaximo sem nada, conecta de novo, esperando EsperaReconexao e dobrando até
// EsperaReconexaoMaxima; uma conexão que trouxe algum evento volta a espera para a primeira. Depois de uma queda, o
// primeiro evento é um estado novo, e quem usa se acerta por ele. Os avisos podem se repetir com o estado (seção 5):
// o f deve tratá-los como idempotentes.
func (c *Cliente) Acompanhar(ctx context.Context, f func(Evento)) {
	inicial, maxima, silencio := EsperaReconexao, EsperaReconexaoMaxima, SilencioMaximo
	espera := inicial
	for ctx.Err() == nil {
		if c.uma(ctx, f, silencio) {
			espera = inicial
		}
		if ctx.Err() != nil {
			return
		}
		t := time.NewTimer(espera)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
		espera = min(espera*2, maxima)
	}
}

// uma faz uma conexão dos eventos, até ela cair. Diz se trouxe algum evento.
func (c *Cliente) uma(ctx context.Context, f func(Evento), silencio time.Duration) (trouxe bool) {
	conCtx, cancela := context.WithCancel(ctx)
	defer cancela()
	// O silêncio vale desde o pedido: um agente que aceita e não responde também cai.
	vigia := time.AfterFunc(silencio, cancela)
	defer vigia.Stop()

	req, err := c.novoPedido(conCtx, http.MethodGet, prefixoAPI+"/eventos")
	if err != nil {
		return false
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.fluxo.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	c.mu.Lock()
	c.conectou, c.fsNoAr = true, false
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.conectou, c.fsNoAr = false, false
		c.mu.Unlock()
	}()

	leitor := bufio.NewReaderSize(resp.Body, 64<<10)
	var dados []string
	for {
		linha, err := lerLinha(leitor)
		if err != nil {
			return trouxe
		}
		vigia.Reset(silencio)
		if linha != "" {
			if v, ok := strings.CutPrefix(linha, "data:"); ok {
				dados = append(dados, strings.TrimPrefix(v, " "))
			}
			continue // os comentários (": ...") e os outros campos não levam evento
		}
		if len(dados) == 0 {
			continue
		}
		texto := strings.Join(dados, "\n")
		dados = dados[:0]
		var ev Evento
		if json.Unmarshal([]byte(texto), &ev) != nil || ev.Tipo == "" {
			continue
		}
		trouxe = true
		c.aplicar(ev, time.Now())
		f(ev)
	}
}

// aplicar guarda o que o evento diz do relógio e do FreeSWITCH, antes de o f vê-lo.
func (c *Cliente) aplicar(ev Evento, recebido time.Time) {
	switch ev.Tipo {
	case "estado":
		c.medir(ev.Agora, recebido)
		c.mu.Lock()
		c.fsNoAr = ev.FreeSWITCH
		c.mu.Unlock()
	case "relogio":
		c.medir(ev.Agora, recebido)
	}
}

// lerLinha lê uma linha, sem o "\n" ou o "\r\n", de até 1 MiB.
func lerLinha(r *bufio.Reader) (string, error) {
	var b []byte
	for {
		parte, mais, err := r.ReadLine()
		if err != nil {
			return "", err
		}
		b = append(b, parte...)
		if len(b) > maximoResposta {
			return "", errors.New("linha grande demais")
		}
		if !mais {
			return string(b), nil
		}
	}
}
