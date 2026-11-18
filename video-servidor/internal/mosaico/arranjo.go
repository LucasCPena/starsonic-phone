package mosaico

import (
	"sort"
	"strconv"
)

// Quadro é um quadro do palco, em pontos do mosaico.
type Quadro struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	L            int    `json:"l"`
	A            int    `json:"a"`
}

// Palco é o desenho do mosaico que o agente manda ao chat. Quadros nunca é nil.
type Palco struct {
	Largura int      `json:"largura"`
	Altura  int      `json:"altura"`
	Quadros []Quadro `json:"quadros"`
}

// Chamada é uma ligação de vídeo da sala.
type Chamada struct {
	UUID, Membro, Participante string
	Tela                       bool
	Celula                     int // a célula já dita ao FreeSWITCH para esta ligação; 0: nenhuma
}

// Estado é o que o FreeSWITCH já tem aplicado.
type Estado struct {
	Layout, Banda string         // os aplicados; "": desconhecidos
	Celulas       map[string]int // participante → célula
}

// Comando é um comando da conferência, sem o "conference <sala> " da frente.
type Comando struct {
	Tipo   string // "res", "layout", "celula" ou "banda"
	Texto  string
	UUID   string // no "celula": a ligação que recebe a reserva
	Celula int    // no "celula": a célula
}

// Plano é o que mudar, e o que fica depois da mudança.
type Plano struct {
	Layout, Banda string
	Celulas       map[string]int
	Comandos      []Comando
	Palco         Palco
}

// EstadoInicial é o de uma conferência nova: LayoutInicial, BandaDaGrade, sem células.
func EstadoInicial() Estado {
	return Estado{Layout: LayoutInicial, Banda: BandaDaGrade, Celulas: map[string]int{}}
}

// membroNumero lê o <membro> como número, para ordenar (10 vem depois de 9).
func membroNumero(m string) uint64 {
	n, _ := strconv.ParseUint(m, 10, 64)
	return n
}

func antes(a, b Chamada) bool {
	na, nb := membroNumero(a.Membro), membroNumero(b.Membro)
	if na != nb {
		return na < nb
	}
	return a.Membro < b.Membro
}

// Planejar decide as células, o layout, o tamanho, a banda e o palco para as chamadas da sala, e os comandos
// que levam o FreeSWITCH do estado de antes até aí. Com tudo, manda os quatro tipos de comando mesmo sem
// mudança. Não muda o que recebe.
func Planejar(antesDe Estado, chamadas []Chamada, tudo bool) Plano {
	// Quem tem câmera, com o menor <membro> de cada um; e a tela de maior <membro>.
	menor := map[string]Chamada{}
	var telaAtual *Chamada
	for i := range chamadas {
		c := chamadas[i]
		if c.Tela {
			if telaAtual == nil || antes(*telaAtual, c) {
				telaAtual = &chamadas[i]
			}
			continue
		}
		if m, ok := menor[c.Participante]; !ok || antes(c, m) {
			menor[c.Participante] = c
		}
	}
	pessoas := make([]string, 0, len(menor))
	for p := range menor {
		pessoas = append(pessoas, p)
	}
	sort.Slice(pessoas, func(i, j int) bool { return antes(menor[pessoas[i]], menor[pessoas[j]]) })

	layout := Grade(len(pessoas))
	banda := BandaDaGrade
	if telaAtual != nil {
		layout = Apresentacao(len(pessoas))
		banda = BandaDaTela
	}

	// As células: quem já tem a mantém, se couber; os outros pegam a menor livre.
	celulas := map[string]int{}
	ocupada := map[int]bool{}
	var deslocados, novos []string
	for _, p := range pessoas {
		c, tinha := antesDe.Celulas[p]
		switch {
		case !tinha || c < 1:
			novos = append(novos, p)
		case c > layout.Celulas() || ocupada[c]:
			deslocados = append(deslocados, p)
		default:
			celulas[p] = c
			ocupada[c] = true
		}
	}
	// Os que perderam a célula vão primeiro, na ordem das células de antes; depois os novos, pelo <membro>.
	sort.SliceStable(deslocados, func(i, j int) bool { return antesDe.Celulas[deslocados[i]] < antesDe.Celulas[deslocados[j]] })
	proxima := 1
	for _, p := range append(deslocados, novos...) {
		for proxima <= layout.Celulas() && ocupada[proxima] {
			proxima++
		}
		if proxima > layout.Celulas() {
			break // sem célula livre: fica de fora até uma vagar
		}
		celulas[p] = proxima
		ocupada[proxima] = true
	}

	// Os comandos, na ordem de uma troca.
	desconhecido := antesDe.Layout == "" || antesDe.Banda == ""
	var comandos []Comando
	if anterior, ok := porNome(antesDe.Layout); tudo || desconhecido || !ok || anterior.Largura != layout.Largura || anterior.Altura != layout.Altura {
		comandos = append(comandos, Comando{Tipo: "res", Texto: "vid-res " + strconv.Itoa(layout.Largura) + "x" + strconv.Itoa(layout.Altura)})
	}
	if tudo || desconhecido || antesDe.Layout != layout.Nome {
		comandos = append(comandos, Comando{Tipo: "layout", Texto: "vid-layout " + layout.Nome})
	}
	var cameras []Chamada
	for _, c := range chamadas {
		if cel, tem := celulas[c.Participante]; tem && !c.Tela && (tudo || c.Celula != cel) {
			cameras = append(cameras, c)
		}
	}
	sort.SliceStable(cameras, func(i, j int) bool { return antes(cameras[i], cameras[j]) })
	for _, c := range cameras {
		cel := celulas[c.Participante]
		comandos = append(comandos, Comando{Tipo: "celula", Texto: "vid-res-id " + c.Membro + " " + Reserva(cel) + " force", UUID: c.UUID, Celula: cel})
	}
	if tudo || desconhecido || antesDe.Banda != banda {
		comandos = append(comandos, Comando{Tipo: "banda", Texto: "vid-bandwidth " + banda + " '' 1"})
	}

	// O palco: a tela, se houver, e as pessoas pela célula.
	quadros := []Quadro{}
	if telaAtual != nil {
		x, y, l, a, _ := layout.Retangulo(ReservaDaTela)
		quadros = append(quadros, Quadro{Participante: telaAtual.Participante, Tela: true, X: x, Y: y, L: l, A: a})
	}
	porCelula := make([]string, 0, len(celulas))
	for p := range celulas {
		porCelula = append(porCelula, p)
	}
	sort.Slice(porCelula, func(i, j int) bool { return celulas[porCelula[i]] < celulas[porCelula[j]] })
	for _, p := range porCelula {
		x, y, l, a, _ := layout.Retangulo(Reserva(celulas[p]))
		quadros = append(quadros, Quadro{Participante: p, X: x, Y: y, L: l, A: a})
	}

	return Plano{Layout: layout.Nome, Banda: banda, Celulas: celulas, Comandos: comandos,
		Palco: Palco{Largura: layout.Largura, Altura: layout.Altura, Quadros: quadros}}
}
