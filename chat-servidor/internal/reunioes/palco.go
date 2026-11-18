package reunioes

import (
	"log/slog"
	"slices"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// O palco de uma sala (docs/chat-protocolo.md, seção 10): o tamanho do mosaico e o retângulo de cada pessoa e da tela
// dentro dele. O agente o manda sem nomes; o chat guarda o último que vale e o repassa às páginas aceitas da reunião,
// com o nome de cada quadro, o voce e o semCamera. Só vai à página aceita, com o canal aberto, da reunião do palco:
// quem espera, quem foi recusado ou tirado e quem é de outra reunião nunca recebe nada dele, e os apps não o veem.

// Os limites de um palco que vale.
const (
	minLado     = 16   // a largura e a altura do mosaico, e de cada quadro, no mínimo
	maxLargura  = 7680 // a largura do mosaico, no máximo
	maxAltura   = 4320 // a altura do mosaico, no máximo
	maxQuadros  = 13   // as 10 pessoas, e as telas delas que cabem no mosaico
	tamanhoDeId = 16   // os caracteres hexadecimais de um participante
)

// mensagemQuadro é um quadro do palco, como a página o recebe.
type mensagemQuadro struct {
	Quem      string `json:"quem"`
	Nome      string `json:"nome"`
	Voce      bool   `json:"voce"`
	Tela      bool   `json:"tela"`
	SemCamera bool   `json:"semCamera"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	L         int    `json:"l"`
	A         int    `json:"a"`
}

// mensagemPalco é o palco para uma página. Os quadros nunca são nulos.
type mensagemPalco struct {
	Tipo    string           `json:"tipo"`
	Largura int              `json:"largura"`
	Altura  int              `json:"altura"`
	Quadros []mensagemQuadro `json:"quadros"`
}

// palcoVale diz se o palco do agente é o que o chat repassa: o mosaico de 16 a 7680 por 16 a 4320, até 13 quadros,
// cada um com 16 ou mais de largura e de altura, inteiro dentro do mosaico, e o participante de 16 hexadecimais
// minúsculos. O palco sem quadros vale.
func palcoVale(p video.Palco) bool {
	if p.Largura < minLado || p.Largura > maxLargura || p.Altura < minLado || p.Altura > maxAltura ||
		len(p.Quadros) > maxQuadros {
		return false
	}
	for _, q := range p.Quadros {
		if q.L < minLado || q.A < minLado || q.X < 0 || q.Y < 0 ||
			q.X > p.Largura-q.L || q.Y > p.Altura-q.A || !idValido(q.Participante) {
			return false
		}
	}
	return true
}

func idValido(id string) bool {
	if len(id) != tamanhoDeId {
		return false
	}
	for i := range len(id) {
		if c := id[i]; !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// guardarPalco é o palco que o agente mandou, no evento palco ou no estado (nil: a sala não tem palco, e o chat o
// esquece, sem mensagem). O que não vale não muda nada, e o registro diz só que um palco não valeu. O palco igual ao
// que a sala já tem não manda nada. Com g.mu.
func (g *Gerente) guardarPalco(s *sala, novo *video.Palco) {
	if novo == nil {
		s.palco = nil
		return
	}
	if !palcoVale(*novo) {
		slog.Warn("reunioes: um palco do servidor de vídeo não valeu")
		return
	}
	if a := s.palco; a != nil && a.Largura == novo.Largura && a.Altura == novo.Altura && slices.Equal(a.Quadros, novo.Quadros) {
		return
	}
	s.palco = &video.Palco{Largura: novo.Largura, Altura: novo.Altura, Quadros: slices.Clone(novo.Quadros)}
	g.mandarPalco(s)
}

// paginasAceitas são os participantes de quem é de fora com o pedido aceito e o canal aberto: os únicos a quem o palco
// vai. Com g.mu.
func (s *sala) paginasAceitas() []*participante {
	var l []*participante
	for _, p := range s.emOrdem() {
		if ped := p.pedido; ped != nil && ped.fase == aceito && ped.canal != nil {
			l = append(l, p)
		}
	}
	return l
}

// mandarPalco manda o palco da sala a cada página aceita. Com g.mu.
func (g *Gerente) mandarPalco(s *sala) {
	if s.palco == nil {
		return
	}
	for _, p := range s.paginasAceitas() {
		g.mandar(p.pedido.canal, s.mensagemPalco(p))
	}
}

// mandarPalcoA manda o palco da sala a uma página, logo depois do aceito ou do voltou. Com g.mu.
func (g *Gerente) mandarPalcoA(s *sala, p *participante) {
	if s.palco != nil && p.pedido != nil && p.pedido.fase == aceito && p.pedido.canal != nil {
		g.mandar(p.pedido.canal, s.mensagemPalco(p))
	}
}

// mensagemPalco é o palco como o participante o recebe: o nome de cada quadro (vazio para quem a sala não
// conhece), o voce nos quadros dele e o semCamera de cada pessoa (a tela nunca o leva). Com g.mu.
func (s *sala) mensagemPalco(para *participante) mensagemPalco {
	m := mensagemPalco{Tipo: "palco", Largura: s.palco.Largura, Altura: s.palco.Altura,
		Quadros: make([]mensagemQuadro, 0, len(s.palco.Quadros))}
	for _, q := range s.palco.Quadros {
		mq := mensagemQuadro{Quem: q.Participante, Voce: q.Participante == para.id, Tela: q.Tela,
			X: q.X, Y: q.Y, L: q.L, A: q.A}
		if dono := s.participantes[q.Participante]; dono != nil {
			mq.Nome = dono.nome
			mq.SemCamera = !q.Tela && dono.semCamera
		}
		m.Quadros = append(m.Quadros, mq)
	}
	return m
}

// Camera é o aviso da página de que a câmera dela foi ligada ou desligada. O palco sai de novo às páginas aceitas
// quando o aviso muda o que se sabe, e fica guardado se a sala ainda não tem palco. Antes do aceito, ou depois do
// fim do pedido, ErrForaDeOrdem.
func (g *Gerente) Camera(p *Pedido, ligada bool) error {
	if p == nil {
		return ErrForaDeOrdem
	}
	g.mu.Lock()
	s, part := g.aceitoDe(p)
	if part == nil {
		g.mu.Unlock()
		return ErrForaDeOrdem
	}
	if part.semCamera == ligada {
		part.semCamera = !ligada
		g.mandarPalco(s)
	}
	g.mu.Unlock()
	g.despachar()
	return nil
}
