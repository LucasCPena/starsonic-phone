package gerar

// Os layouts da reunião, os da seção 7 do docs/video-agente.md. As medidas são as do FreeSWITCH, num
// quadro de 360×360 esticado sobre o mosaico de 1280×720. Nenhum quadro é o "floor": cada pessoa fica
// no seu lugar enquanto fala.

// quadro é uma image de um layout: x, y e o scale (a largura). O hscale (a altura) só vai quando é
// outro, e é 0 quando é igual ao scale.
type quadro struct {
	X, Y, Scale, HScale int
	Reserva             string // o reservation_id: só a tela da apresentação tem, "tela"
}

type layout struct {
	Nome    string
	Quadros []quadro
}

type grupo struct {
	Nome    string
	Layouts []string // os nomes, na ordem
}

// quadrado é um quadro com o hscale igual ao scale, sem reserva.
func quadrado(x, y, scale int) quadro { return quadro{X: x, Y: y, Scale: scale} }

// layouts são os sete, na ordem da tabela. As grades vão linha por linha.
var layouts = []layout{
	{"starsonic-1", []quadro{quadrado(0, 0, 360)}},
	{"starsonic-2", []quadro{quadrado(0, 90, 180), quadrado(180, 90, 180)}},
	{"starsonic-4", []quadro{
		quadrado(0, 0, 180), quadrado(180, 0, 180),
		quadrado(0, 180, 180), quadrado(180, 180, 180),
	}},
	{"starsonic-6", []quadro{
		quadrado(0, 60, 120), quadrado(120, 60, 120), quadrado(240, 60, 120),
		quadrado(0, 180, 120), quadrado(120, 180, 120), quadrado(240, 180, 120),
	}},
	{"starsonic-9", []quadro{
		quadrado(0, 0, 120), quadrado(120, 0, 120), quadrado(240, 0, 120),
		quadrado(0, 120, 120), quadrado(120, 120, 120), quadrado(240, 120, 120),
		quadrado(0, 240, 120), quadrado(120, 240, 120), quadrado(240, 240, 120),
	}},
	{"starsonic-12", []quadro{
		{X: 0, Y: 0, Scale: 90, HScale: 120}, {X: 90, Y: 0, Scale: 90, HScale: 120},
		{X: 180, Y: 0, Scale: 90, HScale: 120}, {X: 270, Y: 0, Scale: 90, HScale: 120},
		{X: 0, Y: 120, Scale: 90, HScale: 120}, {X: 90, Y: 120, Scale: 90, HScale: 120},
		{X: 180, Y: 120, Scale: 90, HScale: 120}, {X: 270, Y: 120, Scale: 90, HScale: 120},
		{X: 0, Y: 240, Scale: 90, HScale: 120}, {X: 90, Y: 240, Scale: 90, HScale: 120},
		{X: 180, Y: 240, Scale: 90, HScale: 120}, {X: 270, Y: 240, Scale: 90, HScale: 120},
	}},
	// A tela compartilhada no quadro grande, e até 10 pessoas na coluna da direita e na linha de baixo.
	{"starsonic-apresentacao", []quadro{
		{X: 0, Y: 0, Scale: 300, Reserva: "tela"},
		quadrado(300, 0, 60), quadrado(300, 60, 60), quadrado(300, 120, 60), quadrado(300, 180, 60), quadrado(300, 240, 60), quadrado(300, 300, 60),
		quadrado(60, 300, 60), quadrado(120, 300, 60), quadrado(180, 300, 60), quadrado(240, 300, 60),
	}},
}

// grade é o layout da reunião sem tela: o FreeSWITCH escolhe, entre os seis, o que cabe quem está nela.
// Quando a ligação de uma tela entra, o agente põe o starsonic-apresentacao, e volta ao grupo quando a
// última tela sai.
var grade = grupo{
	Nome:    "starsonic-grade",
	Layouts: []string{"starsonic-1", "starsonic-2", "starsonic-4", "starsonic-6", "starsonic-9", "starsonic-12"},
}
