package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// Os eventos das conversas (seção 7 do protocolo).
type eventoConversa struct {
	Tipo     string       `json:"tipo"` // "conversa"
	Conversa conversaJSON `json:"conversa"`
}

type eventoConversaSaiu struct {
	Tipo     string `json:"tipo"` // "conversaSaiu"
	Conversa int64  `json:"conversa"`
}

// avisarMembros manda o evento conversa a cada pessoa de quem, um de cada vez: o cuida e o
// naoLidas são de cada uma. Vai depois do commit; um erro aqui só entra no log, porque a
// mudança já valeu e o app acerta a lista na próxima vez que a buscar.
func (s *servidor) avisarMembros(ctx context.Context, empresaID, conversaID int64, quem []int64) {
	ctx = context.WithoutCancel(ctx)
	for _, id := range quem {
		c, err := s.banco.Conversa(ctx, empresaID, id, conversaID)
		if errors.Is(err, banco.ErrNaoEncontrado) {
			continue
		}
		if err != nil {
			slog.Error("evento conversa", "erro", err)
			continue
		}
		s.hub.ParaPessoas([]int64{id}, eventoConversa{Tipo: "conversa", Conversa: novaConversaJSON(c)})
	}
}

// avisarMudanca manda o evento conversa a todos os membros da conversa agora.
func (s *servidor) avisarMudanca(ctx context.Context, empresaID, conversaID int64) {
	quem, err := s.banco.PessoasDaConversa(context.WithoutCancel(ctx), conversaID)
	if err != nil {
		slog.Error("evento conversa", "erro", err)
		return
	}
	s.avisarMembros(ctx, empresaID, conversaID, quem)
}

// idDoCaminho lê o número do segmento {nome} da rota. Um texto que não é um número
// positivo é um id que não existe: responde 404 naoEncontrado e devolve false.
func idDoCaminho(w http.ResponseWriter, r *http.Request, nome string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(nome), 10, 64)
	if err != nil || id <= 0 {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
		return 0, false
	}
	return id, true
}

// erroDoBanco traduz os erros comuns das consultas em resposta (404, 403, 409 ou 500).
func erroDoBanco(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, banco.ErrNaoEncontrado):
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
	case errors.Is(err, banco.ErrProibido):
		escreverErro(w, http.StatusForbidden, "proibido", nil)
	case errors.Is(err, banco.ErrGrupoCheio):
		escreverErro(w, http.StatusConflict, "grupoCheio", nil)
	default:
		slog.Error("banco", "erro", err)
		erroServidor(w)
	}
}

// GET /api/v1/conversas: as conversas da pessoa da vez.
func (s *servidor) conversas(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	lista, err := s.banco.Conversas(r.Context(), c.PessoaID)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	conversas := make([]conversaJSON, 0, len(lista))
	for _, x := range lista {
		conversas = append(conversas, novaConversaJSON(x))
	}
	escreverJSON(w, http.StatusOK, map[string]any{"conversas": conversas})
}

// POST /api/v1/conversas: uma conversa a dois ou um grupo.
func (s *servidor) criarConversa(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	var corpo struct {
		Tipo    string  `json:"tipo"`
		Com     *int64  `json:"com"`
		Nome    string  `json:"nome"`
		Pessoas []int64 `json:"pessoas"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	switch corpo.Tipo {
	case "dupla":
		s.criarDupla(w, r, c, corpo.Com)
	case "grupo":
		s.criarGrupo(w, r, c, corpo.Nome, corpo.Pessoas)
	default:
		erroCampo(w, "tipo")
	}
}

func (s *servidor) criarDupla(w http.ResponseWriter, r *http.Request, c banco.Computador, com *int64) {
	if com == nil {
		erroCampo(w, "com")
		return
	}
	id, nova, err := s.banco.CriarDupla(r.Context(), c.EmpresaID, c.PessoaID, *com)
	if errors.Is(err, banco.ErrInvalido) {
		erroCampo(w, "com")
		return
	}
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	conv, err := s.banco.Conversa(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	status := http.StatusOK
	if nova {
		status = http.StatusCreated
		s.avisarMudanca(r.Context(), c.EmpresaID, id)
	}
	escreverJSON(w, status, map[string]any{"conversa": novaConversaJSON(conv)})
}

func (s *servidor) criarGrupo(w http.ResponseWriter, r *http.Request, c banco.Computador, nome string, pessoas []int64) {
	nome, err := regras.NomeGrupo(nome)
	if err != nil {
		erroCampo(w, "nome")
		return
	}
	// Os ids dos avisos são da Task 6, que manda o evento mensagem de cada um.
	id, _, err := s.banco.CriarGrupo(r.Context(), c.EmpresaID, c.PessoaID, nome, pessoas)
	if errors.Is(err, banco.ErrInvalido) {
		erroCampo(w, "pessoas")
		return
	}
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	conv, err := s.banco.Conversa(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	s.avisarMudanca(r.Context(), c.EmpresaID, id)
	escreverJSON(w, http.StatusCreated, map[string]any{"conversa": novaConversaJSON(conv)})
}

// GET /api/v1/conversas/{id}/membros: os membros de um grupo em que a pessoa está.
func (s *servidor) membros(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	conv, err := s.banco.Conversa(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err == nil && conv.Tipo != "grupo" {
		err = banco.ErrNaoEncontrado // numa conversa a dois não há membros
	}
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	lista, err := s.banco.Membros(r.Context(), id)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	type membro struct {
		Pessoa pessoaJSON `json:"pessoa"`
		Cuida  bool       `json:"cuida"`
		Criou  bool       `json:"criou"`
	}
	membros := make([]membro, 0, len(lista))
	for _, m := range lista {
		membros = append(membros, membro{novaPessoaJSON(m.Pessoa), m.Cuida, m.Criou})
	}
	escreverJSON(w, http.StatusOK, map[string]any{"membros": membros})
}

// POST /api/v1/conversas/{id}/membros: põe pessoas no grupo.
func (s *servidor) porNoGrupo(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	var corpo struct {
		Pessoas []int64 `json:"pessoas"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if len(corpo.Pessoas) == 0 {
		erroCampo(w, "pessoas")
		return
	}
	avisos, err := s.banco.PorNoGrupo(r.Context(), c.PessoaID, id, corpo.Pessoas)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	if len(avisos) > 0 {
		s.avisarMudanca(r.Context(), c.EmpresaID, id)
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/v1/conversas/{id}/membros/{idPessoa}: tira uma pessoa do grupo, ou a própria
// pessoa sai.
func (s *servidor) tirarDoGrupo(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	alvo, ok := idDoCaminho(w, r, "idPessoa")
	if !ok {
		return
	}
	if _, err := s.banco.TirarMembro(r.Context(), c.PessoaID, id, alvo); err != nil {
		erroDoBanco(w, err)
		return
	}
	// Quem saiu perde a conversa; os que ficam recebem o grupo com as pessoas e o cuida novos.
	s.hub.ParaPessoas([]int64{alvo}, eventoConversaSaiu{Tipo: "conversaSaiu", Conversa: id})
	s.avisarMudanca(r.Context(), c.EmpresaID, id)
	w.WriteHeader(http.StatusNoContent)
}
