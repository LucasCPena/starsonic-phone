package reunioes

import (
	"context"
	"slices"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// Os limites da sala de espera (docs/chat-protocolo.md, seções 10 e 12).
const (
	esperaPedido   = 10 * time.Minute // a espera depois de o pedido chegar aos colegas
	novasPorMinuto = 5                // as senhas novas de um participante
)

// Canal é a página de quem é de fora: o WebSocket da seção 10. O Mandar e o Fechar não esperam (o gerente os
// chama também na goroutine dos eventos do vídeo); o Mandar recebe as mensagens da página, que viram JSON.
type Canal interface {
	Mandar(msg any)
	Fechar()
}

// mensagem é uma mensagem para a página só com o tipo: naoComecou, aguardando, recusado, linkInvalido, tirado
// ou encerrada.
type mensagem struct {
	Tipo string `json:"tipo"`
}

// mensagemAceito é o aceito: o Acesso, sem a reuniao.
type mensagemAceito struct {
	Tipo string `json:"tipo"`
	Acesso
}

type fase int

const (
	esperando fase = iota // na sala de espera
	aceito                // tem um participante
	fim                   // recusado, retirado, vencido, tirado ou encerrado
)

// Pedido é o pedido de quem é de fora para entrar numa reunião. A página o guarda e o devolve ao Desistir, ao
// NovaSenha e ao TelaDeFora.
type Pedido struct {
	// Tudo com o Gerente.mu.
	id      string
	nome    string // vazio depois do fim
	sala    string
	canal   Canal // nil depois do Desistir e do fim
	fase    fase
	visivel bool      // chegou aos colegas na reunião
	desde   time.Time // desde quando ele é visível (relógio do chat)
	seq     uint64
	part    *participante // depois do aceito
}

// Pedir faz o pedido de quem é de fora, com o nome que a pessoa digitou (a regra do nome de uma pessoa; um nome
// que não vale dá o *regras.Erro e não chega a ninguém). As conferências são as do EntrarColega, na mesma ordem.
// Sem um colega na reunião, a página recebe o naoComecou, e o pedido espera sem limite; com um, ela recebe o
// aguardando, e os colegas, o reuniaoPedido. Na reunião de teste, que não tem sala de espera, a página recebe o
// aceito na hora, com a senha de colega: a primeira pessoa a começa. Os erros voltam a quem chamou, que os diz à
// página.
func (g *Gerente) Pedir(ctx context.Context, r banco.Reuniao, nome string, c Canal) (*Pedido, error) {
	nome, err := regras.NomePessoa(nome)
	if err != nil {
		return nil, err
	}
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
	p := &Pedido{id: novoIDDePedido(s), nome: nome, sala: s.id, canal: c, seq: g.proximo()}
	if r.Tipo == banco.TipoTeste {
		part := g.novoParticipante(s, 0, 0, nome, true, video.Colega)
		senha, err := emitir(d, s, part, false)
		if err != nil {
			delete(s.participantes, part.id)
			g.limpar(s)
			g.mu.Unlock()
			return nil, err
		}
		s.respondidos[p.id] = true
		p.fase, p.part, part.pedido = aceito, part, p
		g.mandar(c, mensagemAceito{Tipo: "aceito", Acesso: d.acesso(part.id, senha)})
	} else {
		s.pedidos[p.id] = p
		if s.temColega() {
			g.ajustarPedidos(s, agora)
		} else {
			g.mandar(c, mensagem{Tipo: "naoComecou"})
		}
	}
	g.depois(s, antes)
	g.mu.Unlock()
	g.despachar()
	return p, nil
}

// Desistir: a página fechou, ou a pessoa desistiu. Enquanto espera, o pedido sai, e os colegas que o viam recebem
// o reuniaoPedidoFim; nada vai à página. Depois do aceito, ninguém sai da reunião: só a página deixa de receber.
func (g *Gerente) Desistir(p *Pedido) {
	if p == nil {
		return
	}
	g.mu.Lock()
	switch p.fase {
	case esperando:
		if s := g.salas[p.sala]; s != nil && s.pedidos[p.id] == p {
			antes := s.retrato()
			p.canal = nil
			g.responder(s, p, "")
			g.depois(s, antes)
			g.limpar(s)
		}
	case aceito:
		p.canal = nil // o Varrer esquece o participante que não está na reunião nem tem senha pendente
	}
	g.mu.Unlock()
	g.despachar()
}

// DesistirEsperando é o desistir da página, sem cruzar com o aceito de um colega: numa trava só, retira o pedido que
// ainda espera (os colegas que o viam recebem o reuniaoPedidoFim; nada vai à página) e devolve true. Com o pedido
// nulo, já aceito ou já no fim, devolve false e não muda nada: o aceito, se vier, chega à página.
func (g *Gerente) DesistirEsperando(p *Pedido) bool {
	if p == nil {
		return false
	}
	g.mu.Lock()
	s := g.salas[p.sala]
	if p.fase != esperando || s == nil || s.pedidos[p.id] != p {
		g.mu.Unlock()
		return false
	}
	antes := s.retrato()
	g.responder(s, p, "")
	g.depois(s, antes)
	g.limpar(s)
	g.mu.Unlock()
	g.despachar()
	return true
}

// Aceitar: um colega na reunião aceita o pedido. Vale a primeira resposta que chega: um pedido que já saiu da
// espera dá ErrJaRespondido. Sem o servidor no ar, ErrSemServidor; com a reunião cheia, ErrCheia; nos dois, o
// pedido continua esperando. A página recebe o aceito, com a senha de quem é de fora, e os colegas, o
// reuniaoPedidoFim.
func (g *Gerente) Aceitar(ctx context.Context, r banco.Reuniao, pessoaID int64, pedido string) error {
	d := g.lerVideo()
	return g.responderPedido(r, pessoaID, pedido, func(s *sala, p *Pedido) error {
		if !g.serve(d) {
			return ErrSemServidor
		}
		if s.pessoas() >= maxPessoas {
			return ErrCheia
		}
		part := g.novoParticipante(s, 0, 0, p.nome, true, video.Fora)
		senha, err := emitir(d, s, part, false)
		if err != nil {
			delete(s.participantes, part.id)
			return err
		}
		g.tirarDaEspera(s, p)
		p.fase, p.part, part.pedido = aceito, part, p
		g.mandar(p.canal, mensagemAceito{Tipo: "aceito", Acesso: d.acesso(part.id, senha)})
		return nil
	})
}

// Recusar: um colega na reunião recusa o pedido, com as regras do Aceitar. A página recebe o recusado e fecha.
func (g *Gerente) Recusar(ctx context.Context, r banco.Reuniao, pessoaID int64, pedido string) error {
	return g.responderPedido(r, pessoaID, pedido, func(s *sala, p *Pedido) error {
		g.responder(s, p, "recusado")
		return nil
	})
}

// responderPedido faz, com o mutex, as conferências do Aceitar e do Recusar e chama responda com o pedido que
// espera: quem responde está na reunião (ErrForaDaReuniao), o pedido existe (ErrPedidoNaoEncontrado) e ainda
// espera (ErrJaRespondido). Antes, os pedidos vencidos da reunião são respondidos, como no Varrer.
func (g *Gerente) responderPedido(r banco.Reuniao, pessoaID int64, id string, responda func(*sala, *Pedido) error) error {
	agora := g.relogio.Agora()
	g.mu.Lock()
	s := g.salas[r.Sala]
	if s == nil || s.colegaNaReuniao(pessoaID) == nil {
		g.mu.Unlock()
		return ErrForaDaReuniao
	}
	antes := s.retrato()
	g.vencerPedidos(s, agora)
	var err error
	switch p := s.pedidos[id]; {
	case p != nil:
		err = responda(s, p)
	case s.respondidos[id]:
		err = ErrJaRespondido
	default:
		err = ErrPedidoNaoEncontrado
	}
	g.depois(s, antes)
	g.mu.Unlock()
	g.despachar()
	return err
}

// NovaSenha dá a quem é de fora, aceito e ainda fora da reunião (a senha venceu, ou a ligação caiu), uma senha nova
// com o mesmo participante, até 5 por minuto (ErrLimite). Antes do aceito, depois do fim do pedido, ou com a pessoa
// na reunião, ErrForaDeOrdem. É uma entrada nova: valem as conferências do Pedir, e a senha que pode começar a
// reunião (a de colega, na de teste) cabe no limite. A ordem e as duas primeiras conferências vêm antes de ler o
// banco, e de novo depois.
func (g *Gerente) NovaSenha(p *Pedido) (string, error) {
	if p == nil {
		return "", ErrForaDeOrdem
	}
	agora := g.relogio.Agora()
	d := g.lerVideo()
	if err := g.antesDaSenha(p, d, agora); err != nil {
		return "", err
	}
	limite, err := g.limite(g.raiz)
	if err != nil {
		return "", err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	s, part, err := g.ordemDaSenha(p)
	if err != nil {
		return "", err
	}
	if err := g.conferirEntrada(s.reuniao, d, limite, agora, !part.temSenha(false), part.papel == video.Colega); err != nil {
		return "", err
	}
	part.novas = slices.DeleteFunc(part.novas, func(t time.Time) bool { return !t.After(agora.Add(-time.Minute)) })
	if len(part.novas) >= novasPorMinuto {
		return "", ErrLimite
	}
	senha, err := emitir(d, s, part, false)
	if err != nil {
		return "", err
	}
	part.novas = append(part.novas, agora)
	return senha, nil
}

// TelaDeFora dá a quem é de fora, na reunião, a senha da tela compartilhada, com o mesmo participante. Fora da
// reunião (antes do entrou, ou depois de sair), ErrForaDaReuniao.
func (g *Gerente) TelaDeFora(p *Pedido) (string, error) {
	if p == nil {
		return "", ErrForaDaReuniao
	}
	d := g.lerVideo()
	g.mu.Lock()
	defer g.mu.Unlock()
	s, part := g.aceitoDe(p)
	if part == nil || !part.naReuniao {
		return "", ErrForaDaReuniao
	}
	if !g.serve(d) {
		return "", ErrSemServidor
	}
	return emitir(d, s, part, true)
}

// antesDaSenha faz, antes de ler o limite no banco, a conferência da ordem e as duas primeiras de uma entrada: um
// senha fora de ordem, ou sem o servidor no ar, nem espera o banco nem fica escondido atrás de um erro dele.
func (g *Gerente) antesDaSenha(p *Pedido, d doVideo, agora time.Time) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	s, _, err := g.ordemDaSenha(p)
	if err != nil {
		return err
	}
	return g.conferirAntes(s.reuniao, d, agora)
}

// ordemDaSenha é a sala e o participante do pedido aceito que ainda está fora da reunião; fora disso,
// ErrForaDeOrdem. Com g.mu.
func (g *Gerente) ordemDaSenha(p *Pedido) (*sala, *participante, error) {
	s, part := g.aceitoDe(p)
	if part == nil || part.naReuniao {
		return nil, nil, ErrForaDeOrdem
	}
	return s, part, nil
}

// aceitoDe é a sala e o participante do pedido aceito, enquanto ele está na memória. Com g.mu.
func (g *Gerente) aceitoDe(p *Pedido) (*sala, *participante) {
	if p.fase != aceito || p.part == nil {
		return nil, nil
	}
	s := g.salas[p.sala]
	if s == nil || s.participantes[p.part.id] != p.part {
		return nil, nil
	}
	return s, p.part
}

// novoIDDePedido é um id de pedido que a sala não usou.
func novoIDDePedido(s *sala) string {
	for {
		if id := segredo.NovoHex(8); s.pedidos[id] == nil && !s.respondidos[id] {
			return id
		}
	}
}

// ajustarPedidos leva os pedidos aos colegas quando algum está na reunião, e os devolve à espera sem limite
// quando nenhum está. O pedido que chega aos colegas recebe o aguardando, com os 10 minutos contando de agora, e
// os colegas recebem o reuniaoPedido; o que volta recebe o naoComecou. Com g.mu.
func (g *Gerente) ajustarPedidos(s *sala, agora time.Time) {
	temColega := s.temColega()
	for _, p := range s.pedidosEmOrdem() {
		switch {
		case temColega && !p.visivel:
			p.visivel, p.desde = true, agora
			g.mandar(p.canal, mensagem{Tipo: "aguardando"})
			g.avisar(s.colegas(), eventoPedido{Tipo: "reuniaoPedido", Reuniao: s.reuniao.Codigo,
				Pedido: PedidoVisto{ID: p.id, Nome: p.nome}})
		case !temColega && p.visivel:
			p.visivel = false
			g.mandar(p.canal, mensagem{Tipo: "naoComecou"})
		}
	}
}

// vencerPedidos responde os pedidos vencidos: o linkInvalido, quando a reunião deixou de valer, e o recusado, aos
// 10 minutos de espera visível. Devolve quantos. Com g.mu.
func (g *Gerente) vencerPedidos(s *sala, agora time.Time) int {
	vale := !s.conhecida || s.reuniao.Vale(agora.UnixMilli())
	n := 0
	for _, p := range s.pedidosEmOrdem() {
		switch {
		case !vale:
			g.responder(s, p, "linkInvalido")
		case p.visivel && !agora.Before(p.desde.Add(esperaPedido)):
			g.responder(s, p, "recusado")
		default:
			continue
		}
		n++
	}
	return n
}

// tirarDaEspera tira o pedido da sala de espera; os colegas que o viam recebem o reuniaoPedidoFim. Com g.mu.
func (g *Gerente) tirarDaEspera(s *sala, p *Pedido) {
	delete(s.pedidos, p.id)
	s.respondidos[p.id] = true
	if p.visivel {
		g.avisar(s.colegas(), eventoPedidoFim{Tipo: "reuniaoPedidoFim", Reuniao: s.reuniao.Codigo, Pedido: p.id})
	}
	p.visivel = false
}

// responder tira o pedido da espera e o acaba: a página recebe msg e fecha (sem msg, nada vai a ela). Com g.mu.
func (g *Gerente) responder(s *sala, p *Pedido, msg string) {
	g.tirarDaEspera(s, p)
	if msg != "" && p.canal != nil {
		g.mandar(p.canal, mensagem{Tipo: msg})
		g.fechar(p.canal)
	}
	p.fase, p.canal, p.nome = fim, nil, ""
}
