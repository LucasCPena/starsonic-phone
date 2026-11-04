// Package api é a API HTTP do app (docs/chat-protocolo.md), montada em /api/v1/.
package api

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
)

// OrigemPadrao é a origem do WebView do app.
const OrigemPadrao = "https://app.starsonic.local"

const prefixo = "/api/v1/"

// Deps é o que a API usa. As próximas tarefas acrescentam o Hub e o Armazem.
type Deps struct {
	Banco   *banco.Banco
	Origens []string // as origens do CORS; sem nenhuma, vale OrigemPadrao
}

type servidor struct {
	banco   *banco.Banco
	origens map[string]bool
	erradas *limites.Janela // os códigos errados, por endereço
}

// Novo monta a API. O manipulador responde a tudo em /api/v1/.
func Novo(d Deps) http.Handler {
	s := &servidor{
		banco:   d.Banco,
		origens: map[string]bool{},
		erradas: limites.Nova(maxErradas, periodoErradas, d.Banco.Relogio()),
	}
	origens := d.Origens
	if len(origens) == 0 {
		origens = []string{OrigemPadrao}
	}
	for _, o := range origens {
		s.origens[o] = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/computadores", s.ligarComputador)
	mux.HandleFunc("DELETE /api/v1/computadores/eu", s.autenticar(s.desligarComputador))
	// O resto de /api/v1/ (rota que não existe, ou método errado numa rota que existe)
	// responde 404 naoEncontrado em JSON. Quem não manda uma chave boa leva 401 antes.
	mux.HandleFunc(prefixo, s.autenticar(func(w http.ResponseWriter, r *http.Request) {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
	}))
	return s.registrar(s.cors(mux))
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
