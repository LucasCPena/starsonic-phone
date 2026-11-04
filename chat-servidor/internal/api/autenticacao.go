package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

const (
	maxPedidos     = 600 // pedidos com chave por computador, por minuto
	maxPessoasEu   = 20  // POST /api/v1/pessoas/eu por computador, por minuto
	periodoPedidos = time.Minute
)

type chaveContexto struct{}

type quem struct {
	computador banco.Computador
	empresa    banco.Empresa
}

// computadorDe devolve o computador e a empresa do pedido. Só vale dentro de uma rota
// protegida por autenticar.
func computadorDe(r *http.Request) (banco.Computador, banco.Empresa) {
	q, _ := r.Context().Value(chaveContexto{}).(quem)
	return q.computador, q.empresa
}

// identificar acha o computador pela chave do cabeçalho Authorization: Bearer, com achar (o
// banco.ComputadorPorChave, ou o ComputadorParaTrocar no pedido que troca a pessoa).
// Se não achar, responde 401 chave (ou 500) e devolve false.
func (s *servidor) identificar(w http.ResponseWriter, r *http.Request,
	achar func(context.Context, []byte) (banco.Computador, banco.Empresa, error)) (*http.Request, bool) {
	cab := r.Header.Get("Authorization")
	chave, ok := "", false
	if len(cab) > 7 && strings.EqualFold(cab[:7], "Bearer ") {
		chave, ok = strings.TrimSpace(cab[7:]), true
	}
	if !ok || chave == "" {
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return r, false
	}
	c, e, err := achar(r.Context(), segredo.Hash(chave))
	if errors.Is(err, banco.ErrNaoEncontrado) {
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return r, false
	}
	if err != nil {
		erroServidor(w, err)
		return r, false
	}
	ctx := context.WithValue(r.Context(), chaveContexto{}, quem{c, e})
	return r.WithContext(ctx), true
}

// autenticar protege uma rota: sem chave válida, responde 401 chave.
func (s *servidor) autenticar(f http.HandlerFunc) http.HandlerFunc {
	return s.proteger(f, s.banco.ComputadorPorChave, nil)
}

// autenticarTroca é o autenticar do POST /api/v1/pessoas/eu: quem pede é a pessoa que vai
// entrar no computador, então o pedido não conta como uma vez da pessoa de antes nele.
func (s *servidor) autenticarTroca(f http.HandlerFunc) http.HandlerFunc {
	return s.proteger(f, s.banco.ComputadorParaTrocar, s.pessoasEuLimite)
}

// proteger acha o computador pela chave e, só então, conta o pedido no limite geral dele
// (R43) e, se houver, no limite extra da rota. Acima de um limite, responde 429 limite.
func (s *servidor) proteger(f http.HandlerFunc,
	achar func(context.Context, []byte) (banco.Computador, banco.Empresa, error),
	extra *limites.Janela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r2, ok := s.identificar(w, r, achar)
		if !ok {
			return
		}
		c, _ := computadorDe(r2)
		chave := strconv.FormatInt(c.ID, 10)
		if ok, esperar := s.geralLimite.Usar(chave, 1); !ok {
			erroEspera(w, "limite", esperar)
			return
		}
		if extra != nil {
			if ok, esperar := extra.Usar(chave, 1); !ok {
				erroEspera(w, "limite", esperar)
				return
			}
		}
		f(w, r2)
	}
}

// precisaPessoa protege uma rota que age como a pessoa da vez: num computador onde ninguém
// entrou, responde 409 pessoa. Vai dentro do autenticar.
func precisaPessoa(f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c, _ := computadorDe(r); c.PessoaID == 0 {
			escreverErro(w, http.StatusConflict, "pessoa", nil)
			return
		}
		f(w, r)
	}
}
