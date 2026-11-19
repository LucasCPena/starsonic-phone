// Package api serve a API do agente ao chat (/agente/v1/, seção 5 do docs/video-agente.md): a saúde, o estado,
// os eventos (SSE), o tirar e o encerrar.
//
// Nos registros ficam só o método, o padrão da rota, o status e o tempo, como no chat. Nunca a chave, uma sala
// ou um participante.
package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/salas"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/uso"
)

const (
	pulsoPadrao = 25 * time.Second
	filaPadrao  = 1024
)

// Salas é o que a API pede às reuniões.
type Salas interface {
	Estado() []salas.Sala
	Tirar(ctx context.Context, sala, participante string) error
	Encerrar(ctx context.Context, sala string) error
}

// Deps é o que a API precisa de fora.
type Deps struct {
	Chave  string
	Salas  Salas
	NoAr   func() bool // o agente está ligado ao FreeSWITCH (nil: não está)
	Uso    func() uso.Uso
	Versao string
	Agora  func() time.Time // nil: time.Now
	Pulso  time.Duration    // de quanto em quanto tempo vai um relogio; 0: 25 s
	Fila   int              // o tamanho da fila de cada cliente dos eventos; 0: 1.024. Só os testes mudam.
}

// API é o handler de /agente/v1/. Use Novo.
type API struct {
	d         Deps
	hashChave [sha256.Size]byte
	mux       *http.ServeMux
	fila      int

	mu       sync.Mutex
	clientes map[*cliente]struct{}
	fechada  bool
}

// Novo cria a API.
func Novo(d Deps) *API {
	if d.Agora == nil {
		d.Agora = time.Now
	}
	if d.Pulso <= 0 {
		d.Pulso = pulsoPadrao
	}
	if d.NoAr == nil {
		d.NoAr = func() bool { return false }
	}
	if d.Uso == nil {
		d.Uso = func() uso.Uso { return uso.Uso{} }
	}
	a := &API{d: d, hashChave: sha256.Sum256([]byte(d.Chave)), mux: http.NewServeMux(), fila: d.Fila, clientes: map[*cliente]struct{}{}}
	if a.fila <= 0 {
		a.fila = filaPadrao
	}
	a.mux.HandleFunc("GET /agente/v1/saude", a.saude)
	a.mux.HandleFunc("GET /agente/v1/estado", a.autenticar(a.estado))
	a.mux.HandleFunc("GET /agente/v1/eventos", a.autenticar(a.eventos))
	a.mux.HandleFunc("POST /agente/v1/salas/{sala}/participantes/{participante}/tirar", a.autenticar(a.tirar))
	a.mux.HandleFunc("POST /agente/v1/salas/{sala}/encerrar", a.autenticar(a.encerrar))
	return a
}

// ServeHTTP serve as rotas de /agente/v1/ e registra cada pedido.
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	inicio := time.Now()
	g := &gravador{ResponseWriter: w}
	a.mux.ServeHTTP(g, r)
	padrao := r.Pattern // o ServeMux preenche no próprio r
	if padrao == "" {
		padrao = "-"
	}
	status := g.status
	if status == 0 {
		status = http.StatusOK
	}
	slog.Info("pedido", "metodo", r.Method, "rota", padrao, "status", status, "ms", time.Since(inicio).Milliseconds())
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

func (g *gravador) Unwrap() http.ResponseWriter { return g.ResponseWriter }

func escreverJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func erro(w http.ResponseWriter, status int, codigo string) {
	escreverJSON(w, status, map[string]string{"erro": codigo})
}

// autenticar confere a chave, em tempo constante: compara os SHA-256, para o tamanho da chave também não vazar.
// Sem chave configurada, nada passa.
func (a *API) autenticar(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		chave, ok := strings.CutPrefix(auth, "Bearer ")
		h := sha256.Sum256([]byte(chave))
		if !ok || a.d.Chave == "" || subtle.ConstantTimeCompare(h[:], a.hashChave[:]) != 1 {
			erro(w, http.StatusUnauthorized, "chave")
			return
		}
		next(w, r)
	}
}

func hexMinusculo(v string, tamanho int) bool {
	if len(v) != tamanho {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (a *API) saude(w http.ResponseWriter, _ *http.Request) {
	escreverJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *API) agoraMs() int64 { return a.d.Agora().UnixMilli() }

func (a *API) salasAgora() []salas.Sala {
	s := a.d.Salas.Estado()
	if s == nil {
		s = []salas.Sala{}
	}
	return s
}

func (a *API) estado(w http.ResponseWriter, _ *http.Request) {
	escreverJSON(w, http.StatusOK, struct {
		Versao     string       `json:"versao"`
		FreeSWITCH bool         `json:"freeswitch"`
		Agora      int64        `json:"agora"`
		Salas      []salas.Sala `json:"salas"`
		Uso        uso.Uso      `json:"uso"`
	}{a.d.Versao, a.d.NoAr(), a.agoraMs(), a.salasAgora(), a.d.Uso()})
}

func (a *API) tirar(w http.ResponseWriter, r *http.Request) {
	sala, participante := r.PathValue("sala"), r.PathValue("participante")
	if !hexMinusculo(sala, 32) || !hexMinusculo(participante, 16) {
		erro(w, http.StatusBadRequest, "invalido")
		return
	}
	a.responder(w, a.d.Salas.Tirar(r.Context(), sala, participante))
}

func (a *API) encerrar(w http.ResponseWriter, r *http.Request) {
	sala := r.PathValue("sala")
	if !hexMinusculo(sala, 32) {
		erro(w, http.StatusBadRequest, "invalido")
		return
	}
	a.responder(w, a.d.Salas.Encerrar(r.Context(), sala))
}

// responder traduz o resultado de um comando às salas.
func (a *API) responder(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, salas.ErrNaoEncontrado):
		erro(w, http.StatusNotFound, "naoEncontrado")
	case errors.Is(err, salas.ErrSemFreeSWITCH):
		erro(w, http.StatusServiceUnavailable, "freeswitch")
	default:
		registrarFalha(err)
		erro(w, http.StatusInternalServerError, "interno")
	}
}

// ids casa o que parece um id (uuid ou hexadecimal comprido) num texto do FreeSWITCH.
var ids = regexp.MustCompile(`[0-9a-fA-F-]{8,}`)

// registrarFalha anota, abaixo da linha do pedido, só o texto do erro do FreeSWITCH, com qualquer id coberto.
// Outros erros não levam texto.
func registrarFalha(err error) {
	var e *esl.ErroFS
	if errors.As(err, &e) {
		slog.Warn("o FreeSWITCH recusou o comando", "erro", ids.ReplaceAllString(e.Motivo, "<id>"))
		return
	}
	slog.Warn("o comando ao FreeSWITCH falhou")
}
