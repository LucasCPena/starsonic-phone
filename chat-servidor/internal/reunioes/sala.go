package reunioes

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// ---------- O estado de cada sala (tudo com g.mu) ----------

func novaSala(id string) *sala {
	return &sala{id: id, participantes: map[string]*participante{}, pedidos: map[string]*Pedido{},
		respondidos: map[string]bool{}}
}

// emOrdem são os participantes, na ordem de chegada.
func (s *sala) emOrdem() []*participante {
	l := make([]*participante, 0, len(s.participantes))
	for _, p := range s.participantes {
		l = append(l, p)
	}
	slices.SortFunc(l, func(a, b *participante) int { return cmp.Compare(a.seq, b.seq) })
	return l
}

// pedidosEmOrdem são os pedidos que esperam, na ordem de chegada.
func (s *sala) pedidosEmOrdem() []*Pedido {
	l := make([]*Pedido, 0, len(s.pedidos))
	for _, p := range s.pedidos {
		l = append(l, p)
	}
	slices.SortFunc(l, func(a, b *Pedido) int { return cmp.Compare(a.seq, b.seq) })
	return l
}

// naReuniao é quantas pessoas estão na reunião: as câmeras, sem a tela.
func (s *sala) naReuniao() int {
	n := 0
	for _, p := range s.participantes {
		if p.naReuniao {
			n++
		}
	}
	return n
}

// pessoas são as que contam nas 10: quem está na reunião mais quem tem uma senha da câmera ainda não usada.
func (s *sala) pessoas() int {
	n := 0
	for _, p := range s.participantes {
		if p.naReuniao || p.temSenha(false) {
			n++
		}
	}
	return n
}

// comecando diz se alguém com o papel de colega tem uma senha da câmera ainda não usada: ele pode começar a reunião.
func (s *sala) comecando() bool {
	for _, p := range s.participantes {
		if p.papel == video.Colega && !p.naReuniao && p.temSenha(false) {
			return true
		}
	}
	return false
}

// ativa: a reunião acontece ou está começando. As duas contam no limite de reuniões ao mesmo tempo.
func (s *sala) ativa() bool { return s.naReuniao() > 0 || s.comecando() }

// alguemDentro: alguma ligação está na sala, a de uma câmera ou a de uma tela.
func (s *sala) alguemDentro() bool {
	for _, p := range s.participantes {
		if p.naReuniao || p.tela {
			return true
		}
	}
	return false
}

// temColega: algum colega da empresa está na reunião. Os pedidos chegam só a ele.
func (s *sala) temColega() bool {
	for _, p := range s.participantes {
		if p.pessoa != 0 && p.naReuniao {
			return true
		}
	}
	return false
}

// colegas são os computadores dos colegas na reunião: os que recebem os avisos da seção 11.
func (s *sala) colegas() []int64 {
	var ids []int64
	for _, p := range s.participantes {
		if p.pessoa != 0 && p.naReuniao && p.computador != 0 && !slices.Contains(ids, p.computador) {
			ids = append(ids, p.computador)
		}
	}
	slices.Sort(ids)
	return ids
}

// colegaNaReuniao é o participante do colega na reunião (o que chegou por último, se ele entrou de dois
// computadores), ou nil.
func (s *sala) colegaNaReuniao(pessoaID int64) *participante {
	var achado *participante
	for _, p := range s.participantes {
		if pessoaID != 0 && p.pessoa == pessoaID && p.naReuniao && (achado == nil || p.seq > achado.seq) {
			achado = p
		}
	}
	return achado
}

// retrato é a Lista de agora: quem está na reunião e os pedidos que chegaram aos colegas.
func (s *sala) retrato() Lista {
	l := Lista{Participantes: []ParticipanteVisto{}, Pedidos: []PedidoVisto{}}
	for _, p := range s.emOrdem() {
		if p.naReuniao {
			l.Participantes = append(l.Participantes, ParticipanteVisto{ID: p.id, Nome: p.nome, DeFora: p.deFora, Tela: p.tela})
		}
	}
	for _, p := range s.pedidosEmOrdem() {
		if p.visivel {
			l.Pedidos = append(l.Pedidos, PedidoVisto{ID: p.id, Nome: p.nome})
		}
	}
	return l
}

// vazia: a sala não guarda mais nada. A naHora conhecida fica até acabar, pela regra dos 10 minutos.
func (s *sala) vazia() bool {
	return len(s.participantes) == 0 && len(s.pedidos) == 0 && !(s.conhecida && s.reuniao.Tipo == banco.TipoNaHora)
}

// chamadas põe no participante as ligações que o servidor de vídeo diz que ele tem. A ligação que entra usa as
// senhas pendentes dela.
func (s *sala) chamadas(p *participante, camera, tela bool) {
	if camera && !p.naReuniao {
		p.usouSenha(false)
		p.esquecerEm = time.Time{}
		s.alguemEntrou = true
	}
	if tela && !p.tela {
		p.usouSenha(true)
	}
	p.naReuniao, p.tela = camera, tela
}

// fica diz se o participante ainda tem por que estar na memória: está na reunião, tem uma senha pendente (ou na
// graça depois dela), ou é de fora com a página aberta depois do aceito.
func (p *participante) fica(agoraVideo time.Time) bool {
	return p.naReuniao || p.tela || len(p.pendentes) > 0 || agoraVideo.Before(p.esquecerEm) ||
		(p.pedido != nil && p.pedido.canal != nil)
}

// salaDe é a sala da reunião, criada se preciso, com a reunião conhecida.
func (g *Gerente) salaDe(r banco.Reuniao) *sala {
	s := g.salas[r.Sala]
	if s == nil {
		s = novaSala(r.Sala)
		g.salas[r.Sala] = s
	}
	g.conhecer(s, r)
	return s
}

// conhecer põe a reunião na sala que ainda não a tinha. A naHora ganha o prazo dos 10 minutos, contados da
// criação ou, se ela é de antes do gerente (um reinício), do começo dele.
func (g *Gerente) conhecer(s *sala, r banco.Reuniao) {
	if s.conhecida {
		return
	}
	s.reuniao, s.conhecida = r, true
	if r.Tipo == banco.TipoNaHora {
		s.prazo = maisTarde(time.UnixMilli(r.CriadaEm), g.inicio).Add(esperaNaHora)
	}
}

// limpar tira da memória a sala que não guarda mais nada.
func (g *Gerente) limpar(s *sala) {
	if g.salas[s.id] == s && s.vazia() {
		delete(g.salas, s.id)
	}
}

func (g *Gerente) proximo() uint64 {
	g.seq++
	return g.seq
}

// novoParticipante põe na sala um participante novo, com um id que ela não usa.
func (g *Gerente) novoParticipante(s *sala, pessoa, computador int64, nome string, deFora bool, papel video.Papel) *participante {
	id := segredo.NovoHex(8)
	for s.participantes[id] != nil {
		id = segredo.NovoHex(8)
	}
	p := &participante{id: id, pessoa: pessoa, computador: computador, nome: nome, deFora: deFora, papel: papel,
		seq: g.proximo()}
	s.participantes[id] = p
	return p
}

// desconhecido põe na sala quem o servidor de vídeo diz que está nela e o chat não conhece (depois de um
// reinício do chat): sem nome, sem pessoa e não de fora.
func (g *Gerente) desconhecido(s *sala, id string) *participante {
	p := &participante{id: id, seq: g.proximo()}
	s.participantes[id] = p
	return p
}

// esquecer tira o participante da memória, com o nome. A página de quem é de fora, aberta depois do aceito,
// recebe msg e fecha (sem msg, nada vai a ela).
func (g *Gerente) esquecer(s *sala, p *participante, msg string) {
	delete(s.participantes, p.id)
	if ped := p.pedido; ped != nil {
		if msg != "" && ped.canal != nil {
			g.mandar(ped.canal, mensagem{Tipo: msg})
			g.fechar(ped.canal)
		}
		ped.fase, ped.canal, ped.part, ped.nome = fim, nil, nil, ""
	}
}

func (g *Gerente) fechada(sala string) bool {
	_, ok := g.acabadas[sala]
	return ok
}

func (g *Gerente) ativas() int {
	n := 0
	for _, s := range g.salas {
		if s.ativa() {
			n++
		}
	}
	return n
}

// salasEmOrdem são as salas pelo id: os avisos de uma varredura saem sempre na mesma ordem.
func (g *Gerente) salasEmOrdem() []*sala {
	l := make([]*sala, 0, len(g.salas))
	for _, s := range g.salas {
		l = append(l, s)
	}
	slices.SortFunc(l, func(a, b *sala) int { return strings.Compare(a.id, b.id) })
	return l
}
