package api

import (
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// enderecoDe é o endereço de quem pediu, sem a porta. O servidor não fica atrás de
// proxy, então o X-Forwarded-For não é lido.
func enderecoDe(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// POST /api/v1/computadores: liga um computador a uma empresa pelo código.
func (s *servidor) ligarComputador(w http.ResponseWriter, r *http.Request) {
	var corpo struct {
		Codigo     string `json:"codigo"`
		Computador string `json:"computador"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	nome, err := regras.NomeComputador(corpo.Computador)
	if err != nil {
		var e *regras.Erro
		if errors.As(err, &e) {
			erroCampo(w, e.Campo)
		} else {
			erroCampo(w, "computador")
		}
		return
	}

	// Cada tentativa reserva um lugar na janela do endereço (assim, tentativas juntas
	// não furam o limite). O código certo devolve o lugar: só o errado conta.
	end := enderecoDe(r)
	if ok, esperar := s.erradas.Usar(end, 1); !ok {
		erroEspera(w, "tentativas", esperar)
		return
	}
	var emp banco.Empresa
	codigo, ok := segredo.NormalizarCodigo(corpo.Codigo)
	if ok {
		emp, err = s.banco.EmpresaPorCodigo(r.Context(), codigo)
		if errors.Is(err, banco.ErrNaoEncontrado) {
			ok = false
		} else if err != nil {
			s.erradas.Devolver(end, 1)
			erroServidor(w)
			return
		}
	}
	if !ok {
		escreverErro(w, http.StatusNotFound, "codigo", nil)
		return
	}
	s.erradas.Devolver(end, 1)

	chave, hash := segredo.NovaChave()
	if _, err := s.banco.LigarComputador(r.Context(), emp.ID, nome, hash); err != nil {
		erroServidor(w)
		return
	}
	escreverJSON(w, http.StatusCreated, map[string]any{
		"chave":   chave,
		"empresa": map[string]any{"nome": emp.Nome},
	})
}

// DELETE /api/v1/computadores/eu: a chave deixa de valer.
func (s *servidor) desligarComputador(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	if err := s.banco.DesligarComputador(r.Context(), c.ID); err != nil {
		erroServidor(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

const (
	maxErradas     = 10
	periodoErradas = time.Hour
)
