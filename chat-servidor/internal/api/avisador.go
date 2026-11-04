package api

import (
	"context"
	"errors"
	"log/slog"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
)

// Os eventos das mensagens e das conversas (seção 7 do protocolo).
type eventoMensagem struct {
	Tipo     string       `json:"tipo"` // "mensagem"
	Mensagem mensagemJSON `json:"mensagem"`
}

type eventoConversa struct {
	Tipo     string       `json:"tipo"` // "conversa"
	Conversa conversaJSON `json:"conversa"`
}

// Avisador manda os eventos mensagem e conversa, montados num lugar só: a API e a página de
// administração usam este. Os eventos vão depois do commit; um erro aqui só entra no log,
// porque a mudança já valeu e o app acerta o que perdeu quando relê.
type Avisador struct {
	banco *banco.Banco
	hub   *eventos.Hub
}

// NovoAvisador monta o avisador com o banco e o hub dos WebSockets, os mesmos da API.
func NovoAvisador(b *banco.Banco, h *eventos.Hub) *Avisador {
	return &Avisador{banco: b, hub: h}
}

// Mensagens manda o evento mensagem de cada id a todos os membros da conversa agora, na
// ordem dos ids.
func (a *Avisador) Mensagens(ctx context.Context, conversaID int64, ids []int64) {
	if len(ids) == 0 {
		return
	}
	ctx = context.WithoutCancel(ctx)
	msgs, err := a.banco.MensagensPorID(ctx, ids)
	if err != nil {
		slog.Error("evento mensagem", "erro", err)
		return
	}
	quem, err := a.banco.PessoasDaConversa(ctx, conversaID)
	if err != nil {
		slog.Error("evento mensagem", "erro", err)
		return
	}
	for _, m := range msgs {
		a.hub.ParaPessoas(quem, eventoMensagem{Tipo: "mensagem", Mensagem: novaMensagemJSON(m)})
	}
}

// Conversa manda o evento conversa a cada membro da conversa agora, um de cada vez: o cuida e
// o naoLidas são de cada um.
func (a *Avisador) Conversa(ctx context.Context, empresaID, conversaID int64) {
	ctx = context.WithoutCancel(ctx)
	quem, err := a.banco.PessoasDaConversa(ctx, conversaID)
	if err != nil {
		slog.Error("evento conversa", "erro", err)
		return
	}
	for _, id := range quem {
		c, err := a.banco.Conversa(ctx, empresaID, id, conversaID)
		if errors.Is(err, banco.ErrNaoEncontrado) {
			continue
		}
		if err != nil {
			slog.Error("evento conversa", "erro", err)
			continue
		}
		a.hub.ParaPessoas([]int64{id}, eventoConversa{Tipo: "conversa", Conversa: novaConversaJSON(c)})
	}
}

// Grupo avisa que os membros do grupo mudaram: o evento conversa a cada membro e, depois, o
// evento mensagem de cada aviso (criou, pos, tirou ou saiu).
func (a *Avisador) Grupo(ctx context.Context, empresaID, conversaID int64, avisos []int64) {
	a.Conversa(ctx, empresaID, conversaID)
	a.Mensagens(ctx, conversaID, avisos)
}
