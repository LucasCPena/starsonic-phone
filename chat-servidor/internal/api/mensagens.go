package api

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// O limite de mensagens por computador (seção 8 do protocolo).
const (
	maxMensagens     = 60
	periodoMensagens = time.Minute
)

// Os eventos das mensagens (seção 7 do protocolo).
type eventoMensagem struct {
	Tipo     string       `json:"tipo"` // "mensagem"
	Mensagem mensagemJSON `json:"mensagem"`
}

type eventoLida struct {
	Tipo     string `json:"tipo"` // "lida"
	Conversa int64  `json:"conversa"`
	Ate      int64  `json:"ate"`
}

// travaConversa segura a conversa enquanto uma mensagem é gravada e o evento sai, para os
// eventos de uma conversa saírem na ordem dos ids.
func (s *servidor) travaConversa(conversaID int64) (soltar func()) {
	m := &s.travasConversa[uint64(conversaID)%uint64(len(s.travasConversa))]
	m.Lock()
	return m.Unlock
}

// emitirMensagens manda o evento mensagem de cada id a todos os membros da conversa agora,
// na ordem dos ids. Vai depois do commit; um erro aqui só entra no log, porque a mensagem já
// foi gravada e o app busca o que perdeu com o depois.
func (s *servidor) emitirMensagens(ctx context.Context, conversaID int64, ids []int64) {
	if len(ids) == 0 {
		return
	}
	ctx = context.WithoutCancel(ctx)
	msgs, err := s.banco.MensagensPorID(ctx, ids)
	if err != nil {
		slog.Error("evento mensagem", "erro", err)
		return
	}
	quem, err := s.banco.PessoasDaConversa(ctx, conversaID)
	if err != nil {
		slog.Error("evento mensagem", "erro", err)
		return
	}
	for _, m := range msgs {
		s.hub.ParaPessoas(quem, eventoMensagem{Tipo: "mensagem", Mensagem: novaMensagemJSON(m)})
	}
}

// GET /api/v1/conversas/{id}/mensagens: uma página das mensagens.
func (s *servidor) mensagens(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	q := r.URL.Query()
	antes, ok := inteiroDaQuery(w, q.Get("antes"), q.Has("antes"), "antes", 1, 1<<62, 0)
	if !ok {
		return
	}
	depois, ok := inteiroDaQuery(w, q.Get("depois"), q.Has("depois"), "depois", 1, 1<<62, 0)
	if !ok {
		return
	}
	limite, ok := inteiroDaQuery(w, q.Get("limite"), q.Has("limite"), "limite", 1, banco.MaxPagina, banco.MaxPagina)
	if !ok {
		return
	}
	if antes > 0 && depois > 0 {
		erroCampo(w, "depois")
		return
	}
	lista, temMais, err := s.banco.Mensagens(r.Context(), c.PessoaID, id, antes, depois, int(limite))
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	mensagens := make([]mensagemJSON, 0, len(lista))
	for _, m := range lista {
		mensagens = append(mensagens, novaMensagemJSON(m))
	}
	escreverJSON(w, http.StatusOK, map[string]any{"mensagens": mensagens, "temMais": temMais})
}

// inteiroDaQuery lê o parâmetro da query como um inteiro de min a max. Faltando, vale padrao.
// Fora da regra, responde 400 invalido (campo) e devolve false.
func inteiroDaQuery(w http.ResponseWriter, valor string, presente bool, campo string, min, max, padrao int64) (int64, bool) {
	if !presente {
		return padrao, true
	}
	n, err := strconv.ParseInt(valor, 10, 64)
	if err != nil || n < min || n > max {
		erroCampo(w, campo)
		return 0, false
	}
	return n, true
}

// POST /api/v1/conversas/{id}/mensagens: envia uma mensagem de texto.
func (s *servidor) enviar(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	var corpo struct {
		IDLocal string  `json:"idLocal"`
		Texto   *string `json:"texto"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if regras.IDLocal(corpo.IDLocal) != nil {
		erroCampo(w, "idLocal")
		return
	}
	if corpo.Texto == nil {
		erroCampo(w, "texto")
		return
	}
	texto, err := regras.Texto(*corpo.Texto)
	if err != nil {
		erroCampo(w, "texto")
		return
	}

	// O lugar no limite é do computador, e só fica gasto por uma mensagem nova.
	chave := strconv.FormatInt(c.ID, 10)
	if ok, esperar := s.mensagensLimite.Usar(chave, 1); !ok {
		erroEspera(w, "limite", esperar)
		return
	}
	// Depois do commit nada mais depende do cliente: o pedido cancelado não pode deixar uma
	// mensagem gravada e sem evento.
	ctx := context.WithoutCancel(r.Context())
	soltar := s.travaConversa(id)
	defer soltar()
	m, nova, err := s.banco.EnviarTexto(ctx, c.PessoaID, id, corpo.IDLocal, texto)
	if err != nil || !nova {
		s.mensagensLimite.Devolver(chave, 1)
	}
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	status := http.StatusOK
	if nova {
		status = http.StatusCreated
		s.emitirMensagens(ctx, id, []int64{m.ID})
	}
	escreverJSON(w, status, map[string]any{"mensagem": novaMensagemJSON(m)})
}

// POST /api/v1/conversas/{id}/lida: marca a conversa como lida até a mensagem.
func (s *servidor) lida(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoCaminho(w, r, "id")
	if !ok {
		return
	}
	var corpo struct {
		Ate *int64 `json:"ate"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if corpo.Ate == nil || *corpo.Ate < 1 {
		erroCampo(w, "ate")
		return
	}
	ate, avancou, err := s.banco.MarcarLidaAte(r.Context(), c.PessoaID, id, *corpo.Ate)
	if err != nil {
		erroDoBanco(w, err)
		return
	}
	if avancou {
		s.avisarLida(r.Context(), c.PessoaID, c.ID, id, ate)
	}
	w.WriteHeader(http.StatusNoContent)
}

// avisarLida manda o evento lida aos outros computadores da pessoa, não ao que marcou.
func (s *servidor) avisarLida(ctx context.Context, pessoaID, computadorID, conversaID, ate int64) {
	todos, err := s.banco.ComputadoresDaPessoa(context.WithoutCancel(ctx), pessoaID)
	if err != nil {
		slog.Error("evento lida", "erro", err)
		return
	}
	var outros []int64
	for _, id := range todos {
		if id != computadorID {
			outros = append(outros, id)
		}
	}
	s.hub.ParaComputadores(outros, eventoLida{Tipo: "lida", Conversa: conversaID, Ate: ate})
}
