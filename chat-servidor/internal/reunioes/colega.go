package reunioes

import (
	"context"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// EntrarPelaPagina: o colega entra pela página. As conferências são as do EntrarColega, na mesma ordem
// (ErrLinkInvalido, ErrSemServidor, ErrCheia, ErrServidorCheio); uma reunião parada começa. O participante nasce
// com a pessoa, o computador, o nome do cadastro, o deFora falso e o papel de colega, preso a um Pedido já aceito,
// com o canal c e a chave de volta. A página recebe o aceito e o palco, na mesma trava.
//
// O participante é o mesmo do EntrarColega: para o resto do gerente, o computador do colega entrou pelo app (ele
// recebe os eventos da seção 11, e as rotas do app na reunião valem para a pessoa). O Pedido é o que a página usa
// depois do aceito (o senha, o tela, o camera, o chat e o voltar), como o de quem é de fora; ele nunca esteve na
// sala de espera.
func (g *Gerente) EntrarPelaPagina(ctx context.Context, r banco.Reuniao, p banco.Pessoa, computadorID int64, c Canal) (*Pedido, error) {
	agora := g.relogio.Agora()
	d := g.lerVideo()
	if err := g.antesDoBanco(r, d, agora); err != nil {
		return nil, err
	}
	limite, err := g.limite(ctx)
	if err != nil {
		return nil, err
	}
	g.mu.Lock()
	if err := g.conferirEntrada(r, d, limite, agora, true, true); err != nil {
		g.mu.Unlock()
		return nil, err
	}
	s := g.salaDe(r)
	antes := s.retrato()
	part := g.novoParticipante(s, p.ID, computadorID, p.Nome, false, video.Colega)
	senha, err := emitir(d, s, part, false)
	if err != nil {
		delete(s.participantes, part.id)
		g.limpar(s)
		g.mu.Unlock()
		return nil, err
	}
	ped := &Pedido{id: novoIDDePedido(s), nome: p.Nome, sala: s.id, canal: c, seq: g.proximo()}
	s.respondidos[ped.id] = true // o id não volta a ser de outro pedido da sala
	ped.fase, ped.part, part.pedido, ped.volta = aceito, part, ped, segredo.NovoToken()
	g.mandar(c, mensagemAceito{Tipo: "aceito", Acesso: d.acesso(part.id, senha), Volta: ped.volta})
	g.mandarPalcoA(s, part)
	g.depois(s, antes)
	g.mu.Unlock()
	g.despachar()
	return ped, nil
}
