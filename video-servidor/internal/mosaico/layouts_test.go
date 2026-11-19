package mosaico

import (
	"fmt"
	"testing"
)

func TestLayouts_Tabela(t *testing.T) {
	esperado := []struct {
		nome            string
		largura, altura int
		imagens         int
	}{
		{"starsonic-4", 1920, 1080, 4},
		{"starsonic-9", 1920, 1086, 9},
		{"starsonic-12", 1920, 810, 12},
		{"starsonic-apresentacao-2", 1920, 1620, 3},
		{"starsonic-apresentacao-4", 1920, 1350, 5},
		{"starsonic-apresentacao-12", 1920, 1440, 13},
	}
	ls := Layouts()
	if len(ls) != len(esperado) {
		t.Fatalf("layouts: %d, esperava %d", len(ls), len(esperado))
	}
	for i, e := range esperado {
		l := ls[i]
		if l.Nome != e.nome || l.Largura != e.largura || l.Altura != e.altura || len(l.Imagens) != e.imagens {
			t.Errorf("layout %d: %s %dx%d com %d imagens; esperava %s %dx%d com %d", i,
				l.Nome, l.Largura, l.Altura, len(l.Imagens), e.nome, e.largura, e.altura, e.imagens)
		}
		apresentacao := i >= 3
		reservas := []string{}
		if apresentacao {
			reservas = append(reservas, ReservaDaTela)
		}
		for c, n := 1, e.imagens-len(reservas); c <= n; c++ {
			reservas = append(reservas, fmt.Sprintf("c%d", c))
		}
		for j, im := range l.Imagens {
			if im.Reserva != reservas[j] {
				t.Errorf("%s: a reserva %d é %q, esperava %q", l.Nome, j, im.Reserva, reservas[j])
			}
		}
		celulas := e.imagens
		if apresentacao {
			celulas--
		}
		if l.Celulas() != celulas {
			t.Errorf("%s: %d células, esperava %d", l.Nome, l.Celulas(), celulas)
		}
	}
}

func TestLayouts_PontosInteiros(t *testing.T) {
	for _, l := range Layouts() {
		for _, im := range l.Imagens {
			h := im.HScale
			if h == 0 {
				h = im.Scale
			}
			for nome, v := range map[string]int{
				"Largura*X": l.Largura * im.X, "Largura*Scale": l.Largura * im.Scale,
				"Altura*Y": l.Altura * im.Y, "Altura*hscale": l.Altura * h,
			} {
				if v%360 != 0 {
					t.Errorf("%s %s: %s = %d não divide por 360", l.Nome, im.Reserva, nome, v)
				}
			}
		}
	}
}

func TestLayouts_TamanhosDiferentes(t *testing.T) {
	vistos := map[[2]int]string{}
	for _, l := range Layouts() {
		par := [2]int{l.Largura, l.Altura}
		if outro, ok := vistos[par]; ok {
			t.Errorf("%s e %s têm o mesmo tamanho %dx%d", l.Nome, outro, l.Largura, l.Altura)
		}
		vistos[par] = l.Nome
	}
}

func TestLayouts_SemSobrepor(t *testing.T) {
	for _, l := range Layouts() {
		type ret struct{ x, y, w, h int }
		var rs []ret
		for _, im := range l.Imagens {
			x, y, w, h, ok := l.Retangulo(im.Reserva)
			if !ok {
				t.Fatalf("%s: sem retângulo para %s", l.Nome, im.Reserva)
			}
			if x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > l.Largura || y+h > l.Altura {
				t.Errorf("%s %s: (%d,%d,%d,%d) passa do mosaico %dx%d", l.Nome, im.Reserva, x, y, w, h, l.Largura, l.Altura)
			}
			rs = append(rs, ret{x, y, w, h})
		}
		for i := range rs {
			for j := i + 1; j < len(rs); j++ {
				a, b := rs[i], rs[j]
				if a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h {
					t.Errorf("%s: %s e %s se cruzam", l.Nome, l.Imagens[i].Reserva, l.Imagens[j].Reserva)
				}
			}
		}
	}
}

func TestLayouts_Retangulo(t *testing.T) {
	casos := []struct {
		layout, reserva string
		x, y, l, a      int
	}{
		{"starsonic-4", "c4", 960, 540, 960, 540},
		{"starsonic-9", "c5", 640, 362, 640, 362},
		{"starsonic-12", "c12", 1440, 540, 480, 270},
		{"starsonic-apresentacao-2", "c2", 960, 1080, 960, 540},
		{"starsonic-apresentacao-4", "c4", 1440, 1080, 480, 270},
		{"starsonic-apresentacao-12", "c7", 0, 1260, 320, 180},
		{"starsonic-apresentacao-2", "tela", 0, 0, 1920, 1080},
		{"starsonic-apresentacao-4", "tela", 0, 0, 1920, 1080},
		{"starsonic-apresentacao-12", "tela", 0, 0, 1920, 1080},
	}
	porNome := map[string]Layout{}
	for _, l := range Layouts() {
		porNome[l.Nome] = l
	}
	for _, c := range casos {
		x, y, l, a, ok := porNome[c.layout].Retangulo(c.reserva)
		if !ok || x != c.x || y != c.y || l != c.l || a != c.a {
			t.Errorf("%s %s: (%d,%d,%d,%d) ok=%v; esperava (%d,%d,%d,%d)", c.layout, c.reserva, x, y, l, a, ok, c.x, c.y, c.l, c.a)
		}
	}
	if _, _, _, _, ok := porNome["starsonic-4"].Retangulo("c5"); ok {
		t.Error("c5 no starsonic-4: esperava ok falso")
	}
	if _, _, _, _, ok := porNome["starsonic-4"].Retangulo("tela"); ok {
		t.Error("tela no starsonic-4: esperava ok falso")
	}
}

func TestLayouts_Escolha(t *testing.T) {
	grade := map[int]string{0: "starsonic-4", 4: "starsonic-4", 5: "starsonic-9", 9: "starsonic-9", 10: "starsonic-12", 12: "starsonic-12"}
	for p, nome := range grade {
		if g := Grade(p).Nome; g != nome {
			t.Errorf("Grade(%d) = %s, esperava %s", p, g, nome)
		}
	}
	apres := map[int]string{0: "starsonic-apresentacao-2", 2: "starsonic-apresentacao-2", 3: "starsonic-apresentacao-4", 4: "starsonic-apresentacao-4", 5: "starsonic-apresentacao-12", 12: "starsonic-apresentacao-12"}
	for p, nome := range apres {
		if g := Apresentacao(p).Nome; g != nome {
			t.Errorf("Apresentacao(%d) = %s, esperava %s", p, g, nome)
		}
	}
	// Mais de 12 pessoas: o maior layout.
	if Grade(13).Nome != "starsonic-12" || Apresentacao(13).Nome != "starsonic-apresentacao-12" {
		t.Error("com mais de 12 pessoas, esperava os layouts de 12")
	}
}

func TestLayouts_Copia(t *testing.T) {
	a := Layouts()
	a[0].Nome = "outro"
	a[0].Imagens[0].X = 99
	g := Grade(1)
	g.Imagens[0].Scale = 7
	b := Layouts()
	if b[0].Nome != "starsonic-4" || b[0].Imagens[0].X != 0 || b[0].Imagens[0].Scale != 180 {
		t.Errorf("a tabela mudou por fora: %+v", b[0])
	}
	if Grade(1).Imagens[0].Scale != 180 {
		t.Error("o Grade devolveu a tabela, não uma cópia")
	}
}

func TestReserva(t *testing.T) {
	if Reserva(3) != "c3" {
		t.Errorf("Reserva(3) = %q", Reserva(3))
	}
}
