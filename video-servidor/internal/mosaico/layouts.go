// Package mosaico decide o desenho do mosaico de uma reunião: a célula de cada pessoa, o layout, o tamanho
// do quadro e a banda. É puro: sem rede, sem relógio, sem registro, e sem outro pacote do repositório.
// As medidas são as dos layouts do FreeSWITCH, num quadro de 360x360 esticado sobre o mosaico.
package mosaico

import "strconv"

const (
	// ReservaDaTela é a reserva da imagem da tela compartilhada, posta pela discagem.
	ReservaDaTela = "tela"
	// BandaDaGrade e BandaDaTela são os valores de vid-bandwidth.
	BandaDaGrade = "3mb"
	BandaDaTela  = "4mb"
	// LayoutInicial é o do perfil da conferência.
	LayoutInicial = "starsonic-4"
	// ImagensPorSegundo é o video-fps do perfil.
	ImagensPorSegundo = 25
)

// Imagem é uma imagem do layout, em unidades do quadro de 360x360.
type Imagem struct {
	X, Y, Scale, HScale int // HScale 0: igual ao Scale
	Reserva             string
}

// Layout é um layout do FreeSWITCH, com o tamanho do mosaico em pontos.
type Layout struct {
	Nome            string
	Largura, Altura int
	Imagens         []Imagem
}

var tabela = montarTabela()

func montarTabela() []Layout {
	// a grade: colunas x linhas de imagens de lado igual, c1 em diante.
	grade := func(nome string, altura, colunas, lado, hlado int) Layout {
		l := Layout{Nome: nome, Largura: 1920, Altura: altura}
		for n := 0; n < colunas*3; n++ {
			l.Imagens = append(l.Imagens, Imagem{X: n % colunas * lado, Y: n / colunas * 120, Scale: lado, HScale: hlado, Reserva: Reserva(n + 1)})
		}
		return l
	}
	// a apresentação: a tela em cima e as células embaixo, em linhas de colunas imagens.
	apresentacao := func(nome string, altura, altura360, colunas, lado, hlado, linhas int) Layout {
		l := Layout{Nome: nome, Largura: 1920, Altura: altura,
			Imagens: []Imagem{{X: 0, Y: 0, Scale: 360, HScale: altura360, Reserva: ReservaDaTela}}}
		for n := 0; n < colunas*linhas; n++ {
			l.Imagens = append(l.Imagens, Imagem{X: n % colunas * lado, Y: altura360 + n/colunas*hlado, Scale: lado, HScale: hlado, Reserva: Reserva(n + 1)})
		}
		return l
	}
	quatro := Layout{Nome: "starsonic-4", Largura: 1920, Altura: 1080}
	for n := 0; n < 4; n++ {
		quatro.Imagens = append(quatro.Imagens, Imagem{X: n % 2 * 180, Y: n / 2 * 180, Scale: 180, Reserva: Reserva(n + 1)})
	}
	nove := grade("starsonic-9", 1086, 3, 120, 0)
	doze := grade("starsonic-12", 810, 4, 90, 120)
	return []Layout{
		quatro, nove, doze,
		apresentacao("starsonic-apresentacao-2", 1620, 240, 2, 180, 120, 1),
		apresentacao("starsonic-apresentacao-4", 1350, 288, 4, 90, 72, 1),
		apresentacao("starsonic-apresentacao-12", 1440, 270, 6, 60, 45, 2),
	}
}

func copiar(l Layout) Layout {
	l.Imagens = append([]Imagem(nil), l.Imagens...)
	return l
}

// Layouts devolve os seis layouts, na ordem da tabela; uma cópia.
func Layouts() []Layout {
	saida := make([]Layout, len(tabela))
	for i, l := range tabela {
		saida[i] = copiar(l)
	}
	return saida
}

func porNome(nome string) (Layout, bool) {
	for _, l := range tabela {
		if l.Nome == nome {
			return copiar(l), true
		}
	}
	return Layout{}, false
}

// Grade devolve o layout da grade para esse número de pessoas: starsonic-4, -9 ou -12.
func Grade(pessoas int) Layout {
	switch {
	case pessoas <= 4:
		return copiar(tabela[0])
	case pessoas <= 9:
		return copiar(tabela[1])
	}
	return copiar(tabela[2])
}

// Apresentacao devolve o layout com a tela para esse número de pessoas: -2, -4 ou -12.
func Apresentacao(pessoas int) Layout {
	switch {
	case pessoas <= 2:
		return copiar(tabela[3])
	case pessoas <= 4:
		return copiar(tabela[4])
	}
	return copiar(tabela[5])
}

// Reserva é o nome da reserva da célula: 3 → "c3".
func Reserva(celula int) string { return "c" + strconv.Itoa(celula) }

// Celulas conta as imagens que não são a tela.
func (l Layout) Celulas() int {
	n := 0
	for _, im := range l.Imagens {
		if im.Reserva != ReservaDaTela {
			n++
		}
	}
	return n
}

// Retangulo devolve o retângulo da reserva, em pontos do mosaico. ok é falso se o layout não a tem.
func (l Layout) Retangulo(reserva string) (x, y, largura, altura int, ok bool) {
	for _, im := range l.Imagens {
		if im.Reserva != reserva {
			continue
		}
		h := im.HScale
		if h == 0 {
			h = im.Scale
		}
		return im.X * l.Largura / 360, im.Y * l.Altura / 360, im.Scale * l.Largura / 360, h * l.Altura / 360, true
	}
	return 0, 0, 0, 0, false
}
