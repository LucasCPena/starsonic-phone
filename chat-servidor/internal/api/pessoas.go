package api

import (
	"errors"
	"net/http"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// pessoaJSON é a Pessoa da seção 4 do protocolo.
type pessoaJSON struct {
	ID    int64  `json:"id"`
	Ramal string `json:"ramal"`
	Nome  string `json:"nome"`
	Saiu  bool   `json:"saiu"`
}

func novaPessoaJSON(p banco.Pessoa) pessoaJSON {
	return pessoaJSON{ID: p.ID, Ramal: p.Ramal, Nome: p.Nome, Saiu: p.Saiu}
}

// eventoComputadorNovo avisa a pessoa de um computador novo dela (seção 7 do protocolo).
type eventoComputadorNovo struct {
	Tipo       string `json:"tipo"`
	Computador string `json:"computador"`
}

// POST /api/v1/pessoas/eu: o computador passa a agir como a pessoa do ramal.
func (s *servidor) entrarComoPessoa(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	var corpo struct {
		Ramal string `json:"ramal"`
		Nome  string `json:"nome"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	ramal, err := regras.Ramal(corpo.Ramal)
	if err != nil {
		erroCampo(w, "ramal")
		return
	}
	nome, err := regras.NomePessoa(corpo.Nome)
	if err != nil {
		erroCampo(w, "nome")
		return
	}

	soltar := s.travar(c.ID)
	p, outros, err := s.banco.EntrarComoPessoa(r.Context(), c.ID, c.EmpresaID, ramal, nome)
	if err == nil {
		s.hub.DefinirPessoa(c.ID, p.ID)
	}
	soltar()
	if errors.Is(err, banco.ErrNaoEncontrado) {
		// O computador saiu entre a conferência da chave e a entrada.
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	if len(outros) > 0 {
		s.hub.ParaComputadores(outros, eventoComputadorNovo{Tipo: "computadorNovo", Computador: c.Nome})
	}
	escreverJSON(w, http.StatusOK, map[string]any{"pessoa": novaPessoaJSON(p)})
}

// GET /api/v1/pessoas: os colegas da pessoa da vez.
func (s *servidor) colegas(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	lista, err := s.banco.Colegas(r.Context(), c.EmpresaID, c.PessoaID)
	if err != nil {
		erroServidor(w, err)
		return
	}
	pessoas := make([]pessoaJSON, 0, len(lista))
	for _, p := range lista {
		pessoas = append(pessoas, novaPessoaJSON(p))
	}
	escreverJSON(w, http.StatusOK, map[string]any{"pessoas": pessoas})
}
