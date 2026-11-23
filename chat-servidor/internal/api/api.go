// Package api é a API HTTP do app (docs/chat-protocolo.md), montada em /api/v1/.
package api

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/reunioes"
)

// OrigemPadrao é a origem do WebView do app.
const OrigemPadrao = "https://app.starsonic.local"

const prefixo = "/api/v1/"

// Deps é o que a API usa.
type Deps struct {
	Banco   *banco.Banco
	Hub     *eventos.Hub     // obrigatório, e o mesmo da página de administração: o Fora dela só alcança as conexões deste hub
	Armazem *armazem.Armazem // obrigatório: os arquivos no disco
	Origens []string         // as origens do CORS; sem nenhuma, vale OrigemPadrao
	// Gerente é o das reuniões (Task 11). Sem ele, as rotas das reuniões não existem (404 naoEncontrado).
	Gerente *reunioes.Gerente
	// Base é o começo do link das reuniões, sem a barra do fim: https://chat.exemplo.com.br:8443. O link é
	// Base + "/r/" + código.
	Base string
	// Canais guarda os canais abertos da página, para o desligamento os fechar com 1001 (o servidor chama o
	// Encerrar). Sem ele, a API usa um só dela, que ninguém encerra.
	Canais *Canais
}

type servidor struct {
	banco    *banco.Banco
	hub      *eventos.Hub
	avisos   *Avisador // os eventos mensagem e conversa
	armazem  *armazem.Armazem
	origens  map[string]bool
	padroes  []string        // as origens, como OriginPatterns do websocket.Accept
	erradas  *limites.Janela // os códigos errados, por endereço
	bilhetes *bilhetes
	// bilhetesPagina são os bilhetes do canal da página: o dono de cada um é o id da reunião.
	bilhetesPagina *bilhetes
	// origensPagina são as origens do canal da página: o Base mais as do --origem (sem o padrão do app).
	origensPagina map[string]bool
	canais        *Canais           // os canais abertos da página, para o desligamento
	gerente       *reunioes.Gerente // nil: as rotas das reuniões não existem
	base          string            // o começo do link das reuniões, sem a barra do fim
	// aberturas são as tentativas de abrir uma reunião, por endereço: 20 por minuto. Só contam as que não levam a
	// uma reunião em que a pessoa possa entrar: o entrar do app (reunioes.go), o abrir da página e o voltar da página que falha (pagina.go).
	aberturas *limites.Janela
	// aberturasBoas são as aberturas da página que deram certo, por endereço: 60 por minuto, uma janela à parte da das
	// falhas. Sem ela, um endereço com um link bom empurraria os bilhetes das outras páginas para fora da fila da reunião.
	aberturasBoas *limites.Janela
	// passes guarda os passes e as chaves do colega da página (passes.go); passesDoMinuto limita os passes que cada
	// computador pede: 10 por minuto, pelo id dele.
	passes         *passes
	passesDoMinuto *limites.Janela

	mensagensLimite *limites.Janela // as mensagens novas, por computador
	arquivosLimite  *limites.Janela // os bytes de arquivos enviados, por computador
	geralLimite     *limites.Janela // todo pedido com chave, por computador (R43)
	pessoasEuLimite *limites.Janela // o POST /pessoas/eu, por computador, além do geral (R43)
	ramalLimite     *limites.Janela // o PUT /computadores/eu/ramal, por computador, além do geral
	// travasConversa segura uma conversa (pelo id, em 64 faixas) enquanto uma mensagem é
	// gravada e o evento sai: assim os eventos saem na ordem dos ids.
	travasConversa [64]sync.Mutex

	// travas seguram um computador (pelo id, em 64 faixas) enquanto um pedido lê ou muda a
	// pessoa da vez no banco e depois avisa o hub: assim o hub fica com a mesma pessoa que
	// o banco, mesmo com dois pedidos do mesmo computador juntos.
	travas [64]sync.Mutex
}

// Novo monta a API. O manipulador responde a tudo em /api/v1/.
func Novo(d Deps) http.Handler {
	if d.Banco == nil {
		panic("api.Novo: Deps.Banco é obrigatório")
	}
	if d.Hub == nil {
		panic("api.Novo: Deps.Hub é obrigatório, e tem de ser o mesmo da página de administração")
	}
	if d.Armazem == nil {
		panic("api.Novo: Deps.Armazem é obrigatório")
	}
	s := &servidor{
		banco:          d.Banco,
		hub:            d.Hub,
		avisos:         NovoAvisador(d.Banco, d.Hub),
		armazem:        d.Armazem,
		origens:        map[string]bool{},
		erradas:        limites.Nova(maxErradas, periodoErradas, d.Banco.Relogio()),
		bilhetes:       novosBilhetes(d.Banco.Relogio(), maxBilhetesPorComputador),
		bilhetesPagina: novosBilhetes(d.Banco.Relogio(), maxBilhetesPorReuniao),
		gerente:        d.Gerente,
		base:           strings.TrimRight(d.Base, "/"),
		canais:         d.Canais,
		origensPagina:  map[string]bool{},

		aberturas:     limites.Nova(maxAberturas, periodoAberturas, d.Banco.Relogio()),
		aberturasBoas: limites.Nova(maxAbrirBom, periodoAberturas, d.Banco.Relogio()),

		passes:         novosPasses(d.Banco.Relogio()),
		passesDoMinuto: limites.Nova(maxPassesPorMinuto, time.Minute, d.Banco.Relogio()),

		mensagensLimite: limites.Nova(maxMensagens, periodoMensagens, d.Banco.Relogio()),
		arquivosLimite:  limites.Nova(maxArquivosHora, periodoArquivos, d.Banco.Relogio()),
		geralLimite:     limites.Nova(maxPedidos, periodoPedidos, d.Banco.Relogio()),
		pessoasEuLimite: limites.Nova(maxPessoasEu, periodoPedidos, d.Banco.Relogio()),
		ramalLimite:     limites.Nova(maxRamal, periodoPedidos, d.Banco.Relogio()),
	}
	if s.canais == nil {
		s.canais = NovosCanais()
	}
	// As origens da página: a do próprio chat (o Base) e as do --origem, sem o padrão do app.
	if s.base != "" {
		s.origensPagina[s.base] = true
	}
	for _, o := range d.Origens {
		s.origensPagina[o] = true
	}
	origens := d.Origens
	if len(origens) == 0 {
		origens = []string{OrigemPadrao}
	}
	for _, o := range origens {
		s.origens[o] = true
		s.padroes = append(s.padroes, padraoExato(o))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/computadores", s.ligarComputador)
	mux.HandleFunc("DELETE /api/v1/computadores/eu", s.autenticar(s.desligarComputador))
	mux.HandleFunc("PUT /api/v1/computadores/eu/ramal",
		s.proteger(precisaPessoa(s.dizerRamal), s.banco.ComputadorPorChave, s.ramalLimite))
	mux.HandleFunc("POST /api/v1/pessoas/eu", s.autenticarTroca(s.entrarComoPessoa))
	mux.HandleFunc("GET /api/v1/pessoas", s.autenticar(precisaPessoa(s.colegas)))
	mux.HandleFunc("GET /api/v1/conversas", s.autenticar(precisaPessoa(s.conversas)))
	mux.HandleFunc("POST /api/v1/conversas", s.autenticar(precisaPessoa(s.criarConversa)))
	mux.HandleFunc("GET /api/v1/conversas/{id}/membros", s.autenticar(precisaPessoa(s.membros)))
	mux.HandleFunc("POST /api/v1/conversas/{id}/membros", s.autenticar(precisaPessoa(s.porNoGrupo)))
	mux.HandleFunc("DELETE /api/v1/conversas/{id}/membros/{idPessoa}", s.autenticar(precisaPessoa(s.tirarDoGrupo)))
	mux.HandleFunc("GET /api/v1/conversas/{id}/mensagens", s.autenticar(precisaPessoa(s.mensagens)))
	mux.HandleFunc("POST /api/v1/conversas/{id}/mensagens", s.autenticar(precisaPessoa(s.enviar)))
	mux.HandleFunc("POST /api/v1/conversas/{id}/lida", s.autenticar(precisaPessoa(s.lida)))
	mux.HandleFunc("POST /api/v1/arquivos", s.autenticar(precisaPessoa(s.enviarArquivo)))
	mux.HandleFunc("GET /api/v1/arquivos/{id}", s.autenticar(precisaPessoa(s.baixarArquivo)))
	mux.HandleFunc("PUT /api/v1/arquivos/{id}/miniatura", s.autenticar(precisaPessoa(s.enviarMiniatura)))
	mux.HandleFunc("GET /api/v1/arquivos/{id}/miniatura", s.autenticar(precisaPessoa(s.baixarMiniatura)))
	mux.HandleFunc("POST /api/v1/eventos/bilhete", s.autenticar(s.novoBilhete))
	mux.HandleFunc("GET /api/v1/eventos", s.eventos) // sem a chave: vale o bilhete
	if s.gerente != nil {
		s.rotasDasReunioes(mux)
		s.rotasDaPagina(mux)
	}
	// O resto de /api/v1/ (rota que não existe, ou método errado numa rota que existe)
	// responde 404 naoEncontrado em JSON. Quem não manda uma chave boa leva 401 antes.
	mux.HandleFunc(prefixo, s.autenticar(func(w http.ResponseWriter, r *http.Request) {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
	}))
	return s.registrar(s.cors(mux))
}

// travar segura o computador (veja servidor.travas) e devolve a função que solta.
func (s *servidor) travar(computadorID int64) (soltar func()) {
	m := &s.travas[uint64(computadorID)%uint64(len(s.travas))]
	m.Lock()
	return m.Unlock
}

// cors responde ao OPTIONS e põe a origem permitida nas respostas.
func (s *servidor) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, prefixo) {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Add("Vary", "Origin")
		origem := r.Header.Get("Origin")
		if origem != "" && s.origens[origem] {
			h.Set("Access-Control-Allow-Origin", origem)
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Arquivo-Nome")
				h.Set("Access-Control-Max-Age", "600")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// gravador guarda o status da resposta, para o log.
type gravador struct {
	http.ResponseWriter
	status int
}

func (g *gravador) WriteHeader(status int) {
	if g.status == 0 {
		g.status = status
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gravador) Write(b []byte) (int, error) {
	if g.status == 0 {
		g.status = http.StatusOK
	}
	return g.ResponseWriter.Write(b)
}

func (g *gravador) Flush() {
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack deixa o WebSocket (Task 4) assumir a conexão.
func (g *gravador) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	c, rw, err := http.NewResponseController(g.ResponseWriter).Hijack()
	if err == nil && g.status == 0 {
		g.status = http.StatusSwitchingProtocols
	}
	return c, rw, err
}

func (g *gravador) Unwrap() http.ResponseWriter { return g.ResponseWriter }

// registrar anota no log o método, o padrão da rota, o status e o tempo. Nada mais:
// nem caminho, nem query string, nem cabeçalhos.
func (s *servidor) registrar(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		g := &gravador{ResponseWriter: w}
		next.ServeHTTP(g, r)
		padrao := r.Pattern // o ServeMux preenche no próprio r
		if padrao == "" {
			padrao = "-"
		}
		status := g.status
		if status == 0 {
			status = http.StatusOK
		}
		slog.Info("pedido", "metodo", r.Method, "rota", padrao, "status", status,
			"ms", time.Since(inicio).Milliseconds())
	})
}
