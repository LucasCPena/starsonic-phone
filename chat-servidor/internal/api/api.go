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
}

type servidor struct {
	banco    *banco.Banco
	hub      *eventos.Hub
	armazem  *armazem.Armazem
	origens  map[string]bool
	padroes  []string        // as origens, como OriginPatterns do websocket.Accept
	erradas  *limites.Janela // os códigos errados, por endereço
	bilhetes *bilhetes

	mensagensLimite *limites.Janela // as mensagens novas, por computador
	arquivosLimite  *limites.Janela // os bytes de arquivos enviados, por computador
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
		banco:    d.Banco,
		hub:      d.Hub,
		armazem:  d.Armazem,
		origens:  map[string]bool{},
		erradas:  limites.Nova(maxErradas, periodoErradas, d.Banco.Relogio()),
		bilhetes: novosBilhetes(d.Banco.Relogio()),

		mensagensLimite: limites.Nova(maxMensagens, periodoMensagens, d.Banco.Relogio()),
		arquivosLimite:  limites.Nova(maxArquivosHora, periodoArquivos, d.Banco.Relogio()),
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
	mux.HandleFunc("POST /api/v1/pessoas/eu", s.autenticar(s.entrarComoPessoa))
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
