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

// ColegaDoPedido diz se o pedido é o de um colega que entrou pela página, e quem ele é: o pedido aceito, ainda na
// memória, cujo participante tem a pessoa. Vale também depois do Voltar (quem diz que o canal é de colega é o
// participante, e não o bilhete). O pedido de quem é de fora, o da reunião de teste (o participante sem pessoa), o
// que acabou e o nil não são.
func (g *Gerente) ColegaDoPedido(p *Pedido) (pessoaID int64, ok bool) {
	if p == nil {
		return 0, false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	_, part := g.aceitoDe(p)
	if part == nil || part.pessoa == 0 {
		return 0, false
	}
	return part.pessoa, true
}

// ---------- A lista na página do colega ----------

// participanteDaPagina é o participante da lista como a página do colega o vê: o da seção 9, com o voce no dela.
type participanteDaPagina struct {
	ParticipanteVisto
	Voce bool `json:"voce"`
}

// mensagemParticipantes é a lista inteira para a página do colega: a mesma do reuniaoParticipantes, com o voce. As
// listas nunca são nulas.
type mensagemParticipantes struct {
	Tipo          string                 `json:"tipo"`
	Participantes []participanteDaPagina `json:"participantes"`
	Pedidos       []PedidoVisto          `json:"pedidos"`
}

// recebeLista diz se a página do participante recebe o participantes: a de um colega (a pessoa), aceita, com o canal
// aberto, e com a câmera na reunião. Com g.mu.
func (p *participante) recebeLista() bool {
	ped := p.pedido
	return p.pessoa != 0 && p.naReuniao && ped != nil && ped.fase == aceito && ped.canal != nil
}

// mensagemLista é a lista l como a página do participante a recebe.
func mensagemLista(l Lista, para *participante) mensagemParticipantes {
	m := mensagemParticipantes{Tipo: "participantes", Participantes: make([]participanteDaPagina, 0, len(l.Participantes)),
		Pedidos: l.Pedidos}
	for _, v := range l.Participantes {
		m.Participantes = append(m.Participantes, participanteDaPagina{ParticipanteVisto: v, Voce: v.ID == para.id})
	}
	return m
}

// mandarLista manda a lista l a cada página de colega que a recebe (recebeLista), pela fila do gerente. Com g.mu.
func (g *Gerente) mandarLista(s *sala, l Lista) {
	for _, p := range s.emOrdem() {
		if p.recebeLista() {
			g.mandar(p.pedido.canal, mensagemLista(l, p))
		}
	}
}

// mandarListaA manda a lista de agora à página do participante, logo depois do voltou, se ela a recebe. Com g.mu.
func (g *Gerente) mandarListaA(s *sala, p *participante) {
	if p.recebeLista() {
		g.mandar(p.pedido.canal, mensagemLista(s.retrato(), p))
	}
}

// ---------- A pausa pelo chat ----------

// mensagemPausa é o aviso à página do colega: o app dele atendeu uma ligação (ou a largou). O vez é o do app, e a
// página o usa para não desfazer uma pausa que já ficou para trás.
type mensagemPausa struct {
	Tipo    string `json:"tipo"`
	Pausada bool   `json:"pausada"`
	Vez     string `json:"vez"`
}

// Pausa repassa a pausa às páginas de colega daquela pessoa e daquele computador naquela reunião: os participantes
// que entraram pela página (com Pedido) e estão na reunião ou entrando nela (a câmera no ar, ou uma senha da câmera
// ainda não usada, como no pessoas da sala). Sem nenhum participante assim, ErrForaDaReuniao: o que entrou pela rota
// do app (EntrarColega, sem Pedido) não conta, e quem saiu (a câmera saiu, com a página aberta no "Você saiu da
// reunião") também não, até a senha nova do Entrar de novo. Uma página sem canal não recebe nada, e isso não é erro.
// Não guarda nada: o app repete a pausa enquanto a ligação dura.
func (g *Gerente) Pausa(r banco.Reuniao, pessoaID, computadorID int64, pausada bool, vez string) error {
	g.mu.Lock()
	s := g.salas[r.Sala]
	if s == nil {
		g.mu.Unlock()
		return ErrForaDaReuniao
	}
	achou := false
	for _, p := range s.emOrdem() {
		if pessoaID == 0 || p.pessoa != pessoaID || p.computador != computadorID || p.pedido == nil {
			continue
		}
		if !p.naReuniao && !p.temSenha(false) {
			continue
		}
		achou = true
		if p.pedido.fase == aceito && p.pedido.canal != nil {
			g.mandar(p.pedido.canal, mensagemPausa{Tipo: "pausa", Pausada: pausada, Vez: vez})
		}
	}
	g.mu.Unlock()
	g.despachar()
	if !achou {
		return ErrForaDaReuniao
	}
	return nil
}
