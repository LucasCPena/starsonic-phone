package reunioes

import (
	"log/slog"
	"slices"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// O palco de uma sala (docs/chat-protocolo.md, seção 10): o tamanho do mosaico e o retângulo de cada pessoa e da tela
// dentro dele. O agente o manda sem nomes; o chat guarda o último que vale e o repassa às páginas aceitas que estão na
// reunião, ou entrando, com o nome de cada quadro, o voce e o semCamera. Só vai à página aceita, com o canal aberto, da
// reunião do palco, de quem está nela (a câmera ou a tela) ou tem uma senha da câmera ainda não usada: quem espera,
// quem foi recusado ou tirado, quem saiu (a página aberta, para o Entrar de novo), quem deixou a senha vencer sem
// entrar e quem é de outra reunião nunca recebe nada dele, e os apps não o veem.

// Os limites de um palco que vale. Os mesmos números estão na página, no lerPalco de
// chat-servidor/internal/pagina/estatico/palco.js: os dois mudam juntos.
const (
	minLado     = 16   // a largura e a altura do mosaico, e de cada quadro, no mínimo
	maxLargura  = 7680 // a largura do mosaico, no máximo
	maxAltura   = 4320 // a altura do mosaico, no máximo
	maxQuadros  = 13   // as 12 células do maior layout, mais a tela (um palco nunca tem mais de uma)
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

// recebePalco diz se o palco vai à página do participante: a de quem é de fora, com o pedido aceito e o canal aberto,
// que está na reunião (a câmera ou a tela) ou entrando (uma senha da câmera ainda não usada; o aceito traz uma). Quem
// saiu, quem nunca entrou e deixou a senha vencer, e quem não tem a página, não. É a única regra: todo palco passa por
// ela, e o chat da reunião também (mensagens.go). Com g.mu.
func (p *participante) recebePalco() bool {
	ped := p.pedido
	return ped != nil && ped.fase == aceito && ped.canal != nil && (p.naReuniao || p.tela || p.entrando())
}

// entrando: a pessoa tem uma senha da câmera ainda não usada, e é uma das senhasParaEntrar primeiras desde a última
// vez que ela esteve na reunião (ou desde o aceito). A página de verdade gasta uma no aceito ou no Entrar de novo, e
// até três nas tentativas de voltar. Sem o limite, quem saiu (ou nunca entrou) e só pede senhas, sem entrar, ficava
// recebendo o palco e o chat sem aparecer para ninguém: quem está na reunião é só quem a lista mostra.
func (p *participante) entrando() bool {
	return p.temSenha(false) && p.semEntrar <= senhasParaEntrar
}

// paginasAceitas são os participantes cuja página recebe o palco (recebePalco): as páginas aceitas que estão na
// reunião, ou entrando. Com g.mu.
func (s *sala) paginasAceitas() []*participante {
	var l []*participante
	for _, p := range s.emOrdem() {
		if p.recebePalco() {
			l = append(l, p)
		}
	}
	return l
}

// mandarPalco manda o palco da sala a cada página aceita que está na reunião, ou entrando. Com g.mu.
func (g *Gerente) mandarPalco(s *sala) {
	if s.palco == nil {
		return
	}
	for _, p := range s.paginasAceitas() {
		g.mandar(p.pedido.canal, s.mensagemPalco(p))
	}
}

// mandarPalcoA manda o palco da sala a uma página, logo depois do aceito, do voltou ou de uma senha da câmera, se
// ela recebe o palco (recebePalco). Com g.mu.
func (g *Gerente) mandarPalcoA(s *sala, p *participante) {
	if s.palco != nil && p.recebePalco() {
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

// Camera é o aviso da página de que a câmera dela foi ligada ou desligada. O valor fica sempre guardado (o próximo
// palco com o quadro da pessoa o leva); o palco sai de novo às páginas aceitas que estão na reunião, ou entrando, só
// quando o aviso muda o valor e a pessoa tem um quadro da câmera (não o da tela) no palco de agora da sala: sem ele,
// o palco seria o mesmo. Antes do aceito, ou depois do fim do pedido, ErrForaDeOrdem.
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
		if s.temQuadroDaCamera(part.id) {
			g.mandarPalco(s)
		}
	}
	g.mu.Unlock()
	g.despachar()
	return nil
}

// temQuadroDaCamera diz se o participante tem um quadro da câmera (não o da tela) no palco de agora da sala. Com g.mu.
func (s *sala) temQuadroDaCamera(id string) bool {
	return s.palco != nil && slices.ContainsFunc(s.palco.Quadros, func(q video.Quadro) bool {
		return q.Participante == id && !q.Tela
	})
}
