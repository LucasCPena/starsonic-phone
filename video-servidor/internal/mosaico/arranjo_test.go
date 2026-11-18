package mosaico

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Os participantes inventados (16 hex cada um).
const (
	ana    = "a1a1a1a1a1a1a1a1"
	carlos = "c2c2c2c2c2c2c2c2"
	bia    = "b3b3b3b3b3b3b3b3"
	davi   = "d4d4d4d4d4d4d4d4"
	eva    = "e5e5e5e5e5e5e5e5"
)

func cam(membro, participante string, celula int) Chamada {
	return Chamada{UUID: "u" + membro, Membro: membro, Participante: participante, Celula: celula}
}

func tela(membro, participante string) Chamada {
	return Chamada{UUID: "u" + membro, Membro: membro, Participante: participante, Tela: true}
}

// aplicar devolve o estado depois do plano, e as chamadas com a célula já dita.
func aplicar(p Plano) Estado {
	return Estado{Layout: p.Layout, Banda: p.Banda, Celulas: p.Celulas}
}

func comCelulas(p Plano, chamadas []Chamada) []Chamada {
	saida := make([]Chamada, len(chamadas))
	copy(saida, chamadas)
	for i, c := range saida {
		if !c.Tela {
			saida[i].Celula = p.Celulas[c.Participante]
		}
	}
	return saida
}

func textos(p Plano) []string {
	saida := []string{}
	for _, c := range p.Comandos {
		saida = append(saida, c.Texto)
	}
	return saida
}

func igual(t *testing.T, rotulo string, obtido, esperado []string) {
	t.Helper()
	if !reflect.DeepEqual(obtido, esperado) {
		t.Errorf("%s:\n obtido    %q\n esperado %q", rotulo, obtido, esperado)
	}
}

func quadro(participante string, ehTela bool, x, y, l, a int) Quadro {
	return Quadro{Participante: participante, Tela: ehTela, X: x, Y: y, L: l, A: a}
}

func palcoIgual(t *testing.T, rotulo string, p Palco, largura, altura int, quadros ...Quadro) {
	t.Helper()
	if quadros == nil {
		quadros = []Quadro{}
	}
	esperado := Palco{Largura: largura, Altura: altura, Quadros: quadros}
	if !reflect.DeepEqual(p, esperado) {
		t.Errorf("%s:\n obtido    %+v\n esperado %+v", rotulo, p, esperado)
	}
}

// quatro entra um por vez e devolve o plano das quatro pessoas, com as chamadas.
func quatro(t *testing.T) (Plano, []Chamada) {
	t.Helper()
	estado := EstadoInicial()
	chamadas := []Chamada{}
	var p Plano
	for i, pessoa := range []string{ana, carlos, bia, davi} {
		chamadas = append(chamadas, cam(string(rune('1'+i)), pessoa, 0))
		p = Planejar(estado, chamadas, false)
		chamadas = comCelulas(p, chamadas)
		estado = aplicar(p)
	}
	return p, chamadas
}

func TestPlanejar_QuemEntraPegaAMenorLivre(t *testing.T) {
	estado := EstadoInicial()
	chamadas := []Chamada{cam("1", ana, 0)}
	p := Planejar(estado, chamadas, false)
	igual(t, "ana", textos(p), []string{"vid-res-id 1 c1 force"})
	if p.Comandos[0].Tipo != "celula" || p.Comandos[0].UUID != "u1" || p.Comandos[0].Celula != 1 {
		t.Errorf("comando da ana: %+v", p.Comandos[0])
	}
	palcoIgual(t, "palco da ana", p.Palco, 1920, 1080, quadro(ana, false, 0, 0, 960, 540))

	chamadas = comCelulas(p, chamadas)
	estado = aplicar(p)
	chamadas = append(chamadas, cam("2", carlos, 0))
	p = Planejar(estado, chamadas, false)
	igual(t, "carlos", textos(p), []string{"vid-res-id 2 c2 force"})
	palcoIgual(t, "palco do carlos", p.Palco, 1920, 1080,
		quadro(ana, false, 0, 0, 960, 540), quadro(carlos, false, 960, 0, 960, 540))

	chamadas = comCelulas(p, chamadas)
	estado = aplicar(p)
	chamadas = append(chamadas, cam("3", bia, 0))
	p = Planejar(estado, chamadas, false)
	igual(t, "bia", textos(p), []string{"vid-res-id 3 c3 force"})
	if q := p.Palco.Quadros[2]; q != quadro(bia, false, 0, 540, 960, 540) {
		t.Errorf("quadro da bia: %+v", q)
	}

	chamadas = comCelulas(p, chamadas)
	estado = aplicar(p)
	chamadas = append(chamadas, cam("4", davi, 0))
	p = Planejar(estado, chamadas, false)
	igual(t, "davi", textos(p), []string{"vid-res-id 4 c4 force"})
	if q := p.Palco.Quadros[3]; q != quadro(davi, false, 960, 540, 960, 540) {
		t.Errorf("quadro do davi: %+v", q)
	}
}

func TestPlanejar_QuemSaiDoMeioNaoMexeNosOutros(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1, carlos: 2, bia: 3}}
	// carlos (membro 2) sai.
	semCarlos := []Chamada{cam("1", ana, 1), cam("3", bia, 3)}
	p := Planejar(estado, semCarlos, false)
	igual(t, "carlos sai", textos(p), []string{})
	palcoIgual(t, "palco sem carlos", p.Palco, 1920, 1080,
		quadro(ana, false, 0, 0, 960, 540), quadro(bia, false, 0, 540, 960, 540))

	// davi entra: ocupa a c2 que ficou livre.
	p = Planejar(aplicar(p), append(semCarlos, cam("4", davi, 0)), false)
	igual(t, "davi entra", textos(p), []string{"vid-res-id 4 c2 force"})
}

func TestPlanejar_DeQuatroParaCinco(t *testing.T) {
	p, chamadas := quatro(t)
	chamadas = append(chamadas, cam("5", eva, 0))
	p = Planejar(aplicar(p), chamadas, false)
	igual(t, "eva entra", textos(p), []string{"vid-res 1920x1086", "vid-layout starsonic-9", "vid-res-id 5 c5 force"})
	if p.Layout != "starsonic-9" || p.Banda != "3mb" {
		t.Errorf("layout %s banda %s", p.Layout, p.Banda)
	}
	if p.Palco.Largura != 1920 || p.Palco.Altura != 1086 {
		t.Errorf("palco %dx%d", p.Palco.Largura, p.Palco.Altura)
	}
	if q := p.Palco.Quadros[4]; q != quadro(eva, false, 640, 362, 640, 362) {
		t.Errorf("quadro da eva: %+v", q)
	}
}

func TestPlanejar_DeCincoParaQuatro(t *testing.T) {
	p, chamadas := quatro(t)
	chamadas = append(chamadas, cam("5", eva, 0))
	p = Planejar(aplicar(p), chamadas, false)
	chamadas = comCelulas(p, chamadas)
	// carlos (membro 2) sai.
	semCarlos := []Chamada{chamadas[0], chamadas[2], chamadas[3], chamadas[4]}
	p = Planejar(aplicar(p), semCarlos, false)
	igual(t, "carlos sai", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 5 c2 force"})
	var doEva Quadro
	for _, q := range p.Palco.Quadros {
		if q.Participante == eva {
			doEva = q
		}
	}
	if doEva != quadro(eva, false, 960, 0, 960, 540) {
		t.Errorf("quadro da eva: %+v", doEva)
	}
}

func TestPlanejar_Dez(t *testing.T) {
	estado := EstadoInicial()
	chamadas := []Chamada{}
	nomes := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10"}
	var p Plano
	for i, m := range nomes {
		chamadas = append(chamadas, cam(m, strings.Repeat(string(rune('a'+i)), 16), 0))
		p = Planejar(estado, chamadas, false)
		chamadas = comCelulas(p, chamadas)
		estado = aplicar(p)
	}
	igual(t, "a décima", textos(p), []string{"vid-res 1920x810", "vid-layout starsonic-12", "vid-res-id 10 c10 force"})
}

func TestPlanejar_Treze(t *testing.T) {
	chamadas := []Chamada{}
	for i := 1; i <= 13; i++ {
		chamadas = append(chamadas, cam(string(rune('0'+i/10))+string(rune('0'+i%10)), strings.Repeat(string(rune('a'+i-1)), 16), 0))
	}
	p := Planejar(EstadoInicial(), chamadas, false)
	if len(p.Palco.Quadros) != 12 || len(p.Celulas) != 12 {
		t.Fatalf("%d quadros e %d células, esperava 12 e 12", len(p.Palco.Quadros), len(p.Celulas))
	}
	treze := strings.Repeat("m", 16)
	if _, tem := p.Celulas[treze]; tem {
		t.Error("o de maior membro devia ficar sem célula")
	}
	for _, q := range p.Palco.Quadros {
		if q.Participante == treze {
			t.Error("o de maior membro devia ficar fora do palco")
		}
	}
	for _, c := range p.Comandos {
		if c.Tipo == "celula" && c.UUID == chamadas[12].UUID {
			t.Error("o de maior membro não devia receber comando")
		}
	}
	if p.Layout != "starsonic-12" {
		t.Errorf("layout %s", p.Layout)
	}
	// Alguém sai: o que ficou de fora ganha a célula.
	chamadas = comCelulas(p, chamadas)
	sem := append([]Chamada{}, chamadas[:5]...)
	sem = append(sem, chamadas[6:]...)
	p2 := Planejar(aplicar(p), sem, false)
	if p2.Celulas[treze] != 6 {
		t.Errorf("o de fora devia ganhar a c6, ganhou %d", p2.Celulas[treze])
	}
}

func TestPlanejar_ATelaEntra(t *testing.T) {
	estado := EstadoInicial()
	chamadas := []Chamada{cam("1", ana, 0), cam("2", carlos, 0)}
	p := Planejar(estado, chamadas, false)
	chamadas = comCelulas(p, chamadas)
	estado = aplicar(p)
	chamadas = append(chamadas, tela("3", ana))
	p = Planejar(estado, chamadas, false)
	igual(t, "a tela entra", textos(p), []string{"vid-res 1920x1620", "vid-layout starsonic-apresentacao-2", "vid-bandwidth 4mb '' 1"})
	if p.Banda != BandaDaTela {
		t.Errorf("banda %s", p.Banda)
	}
	palcoIgual(t, "palco da tela", p.Palco, 1920, 1620,
		quadro(ana, true, 0, 0, 1920, 1080),
		quadro(ana, false, 0, 1080, 960, 540),
		quadro(carlos, false, 960, 1080, 960, 540))
}

func TestPlanejar_ATelaAperta(t *testing.T) {
	// ana na c1, carlos saiu e bia na c3: com a tela são só duas células.
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1, bia: 3}}
	chamadas := []Chamada{cam("1", ana, 1), cam("3", bia, 3), tela("4", ana)}
	p := Planejar(estado, chamadas, false)
	igual(t, "a tela aperta", textos(p), []string{
		"vid-res 1920x1620", "vid-layout starsonic-apresentacao-2", "vid-res-id 3 c2 force", "vid-bandwidth 4mb '' 1"})
	if p.Celulas[bia] != 2 || p.Celulas[ana] != 1 {
		t.Errorf("células: %v", p.Celulas)
	}
}

func TestPlanejar_ATelaComTres(t *testing.T) {
	chamadas := []Chamada{cam("1", ana, 1), cam("2", carlos, 2), cam("3", bia, 3), tela("4", ana)}
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1, carlos: 2, bia: 3}}
	p := Planejar(estado, chamadas, false)
	igual(t, "com 3", textos(p), []string{"vid-res 1920x1350", "vid-layout starsonic-apresentacao-4", "vid-bandwidth 4mb '' 1"})

	cinco := []Chamada{cam("1", ana, 1), cam("2", carlos, 2), cam("3", bia, 3), cam("5", davi, 4), cam("6", eva, 5), tela("7", ana)}
	estado = Estado{Layout: "starsonic-9", Banda: "3mb", Celulas: map[string]int{ana: 1, carlos: 2, bia: 3, davi: 4, eva: 5}}
	p = Planejar(estado, cinco, false)
	igual(t, "com 5", textos(p), []string{"vid-res 1920x1440", "vid-layout starsonic-apresentacao-12", "vid-bandwidth 4mb '' 1"})
}

func TestPlanejar_ATelaSai(t *testing.T) {
	estado := Estado{Layout: "starsonic-apresentacao-2", Banda: "4mb", Celulas: map[string]int{ana: 1, carlos: 2}}
	chamadas := []Chamada{cam("1", ana, 1), cam("2", carlos, 2)}
	p := Planejar(estado, chamadas, false)
	igual(t, "a tela sai", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-bandwidth 3mb '' 1"})
}

func TestPlanejar_AMesmaPessoaDeNovo(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1}}
	chamadas := []Chamada{cam("1", ana, 1), cam("7", ana, 0)}
	p := Planejar(estado, chamadas, false)
	igual(t, "ana de novo", textos(p), []string{"vid-res-id 7 c1 force"})
	palcoIgual(t, "palco da ana", p.Palco, 1920, 1080, quadro(ana, false, 0, 0, 960, 540))
	if len(p.Celulas) != 1 || p.Celulas[ana] != 1 {
		t.Errorf("células: %v", p.Celulas)
	}
}

func TestPlanejar_AAnteriorSai(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, []Chamada{cam("7", ana, 1)}, false)
	igual(t, "a anterior sai", textos(p), []string{})
	palcoIgual(t, "palco", p.Palco, 1920, 1080, quadro(ana, false, 0, 0, 960, 540))
}

func TestPlanejar_DuasTelas(t *testing.T) {
	estado := Estado{Layout: "starsonic-apresentacao-2", Banda: "4mb", Celulas: map[string]int{ana: 1, carlos: 2}}
	chamadas := []Chamada{cam("1", ana, 1), cam("2", carlos, 2), tela("3", ana), tela("6", carlos)}
	p := Planejar(estado, chamadas, false)
	igual(t, "duas telas", textos(p), []string{})
	if q := p.Palco.Quadros[0]; q != quadro(carlos, true, 0, 0, 1920, 1080) {
		t.Errorf("o quadro da tela: %+v", q)
	}
	n := 0
	for _, q := range p.Palco.Quadros {
		if q.Tela {
			n++
		}
	}
	if n != 1 {
		t.Errorf("%d quadros de tela, esperava 1", n)
	}
	// O número do membro compara como número: 10 é maior que 9.
	chamadas = []Chamada{cam("1", ana, 1), cam("2", carlos, 2), tela("9", ana), tela("10", carlos)}
	p = Planejar(estado, chamadas, false)
	if p.Palco.Quadros[0].Participante != carlos {
		t.Errorf("a tela do membro 10 devia vencer a do 9: %+v", p.Palco.Quadros[0])
	}
}

func TestPlanejar_Tudo(t *testing.T) {
	chamadas := []Chamada{cam("4", bia, 0), cam("9", ana, 0), cam("2", carlos, 0)}
	p := Planejar(Estado{}, chamadas, true)
	igual(t, "tudo", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 2 c1 force",
		"vid-res-id 4 c2 force", "vid-res-id 9 c3 force", "vid-bandwidth 3mb '' 1"})
	tipos := []string{}
	for _, c := range p.Comandos {
		tipos = append(tipos, c.Tipo)
	}
	igual(t, "tipos", tipos, []string{"res", "layout", "celula", "celula", "celula", "banda"})
}

func TestPlanejar_TudoComEstadoConhecido(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, []Chamada{cam("1", ana, 1)}, true)
	igual(t, "tudo", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 1 c1 force", "vid-bandwidth 3mb '' 1"})
}

func TestPlanejar_EstadoDesconhecido(t *testing.T) {
	estado := Estado{Layout: "", Banda: "", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, []Chamada{cam("1", ana, 1)}, false)
	igual(t, "desconhecido", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-bandwidth 3mb '' 1"})
}

func TestPlanejar_SoOLayoutDesconhecido(t *testing.T) {
	estado := Estado{Layout: "", Banda: "3mb", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, []Chamada{cam("1", ana, 1)}, false)
	igual(t, "só o layout", textos(p), []string{"vid-res 1920x1080", "vid-layout starsonic-4"})
}

func TestPlanejar_SoABandaDesconhecida(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, []Chamada{cam("1", ana, 1)}, false)
	igual(t, "só a banda", textos(p), []string{"vid-bandwidth 3mb '' 1"})
}

func TestPlanejar_SemMudanca(t *testing.T) {
	p, chamadas := quatro(t)
	chamadas = comCelulas(p, chamadas)
	p2 := Planejar(aplicar(p), chamadas, false)
	igual(t, "sem mudança", textos(p2), []string{})
	if !reflect.DeepEqual(p.Palco, p2.Palco) {
		t.Errorf("o palco mudou:\n%+v\n%+v", p.Palco, p2.Palco)
	}
}

func TestPlanejar_NaoMudaAEntrada(t *testing.T) {
	celulas := map[string]int{ana: 1, carlos: 2, davi: 5}
	estado := Estado{Layout: "starsonic-9", Banda: "3mb", Celulas: celulas}
	chamadas := []Chamada{cam("1", ana, 1), cam("3", bia, 0), cam("4", davi, 5), tela("8", ana)}
	copiaChamadas := append([]Chamada{}, chamadas...)
	_ = Planejar(estado, chamadas, true)
	esperado := map[string]int{ana: 1, carlos: 2, davi: 5}
	if !reflect.DeepEqual(celulas, esperado) {
		t.Errorf("o mapa de entrada mudou: %v", celulas)
	}
	if !reflect.DeepEqual(chamadas, copiaChamadas) {
		t.Error("a lista de chamadas mudou")
	}
	if estado.Layout != "starsonic-9" || estado.Banda != "3mb" {
		t.Errorf("o estado mudou: %+v", estado)
	}
}

func TestPlanejar_SemNinguem(t *testing.T) {
	estado := Estado{Layout: "starsonic-4", Banda: "3mb", Celulas: map[string]int{ana: 1}}
	p := Planejar(estado, nil, false)
	igual(t, "sem ninguém", textos(p), []string{})
	palcoIgual(t, "palco vazio", p.Palco, 1920, 1080)
	if len(p.Celulas) != 0 {
		t.Errorf("células: %v", p.Celulas)
	}
}

func TestPalco_JSONVazio(t *testing.T) {
	p := Planejar(EstadoInicial(), nil, false)
	b, err := json.Marshal(p.Palco)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"largura":1920,"altura":1080,"quadros":[]}` {
		t.Errorf("json: %s", b)
	}
}

func TestPalco_JSONComQuadro(t *testing.T) {
	p := Planejar(EstadoInicial(), []Chamada{cam("1", ana, 0)}, false)
	b, _ := json.Marshal(p.Palco)
	esperado := `{"largura":1920,"altura":1080,"quadros":[{"participante":"a1a1a1a1a1a1a1a1","tela":false,"x":0,"y":0,"l":960,"a":540}]}`
	if string(b) != esperado {
		t.Errorf("json: %s", b)
	}
}

func TestEstadoInicial(t *testing.T) {
	e := EstadoInicial()
	if e.Layout != LayoutInicial || e.Banda != BandaDaGrade || len(e.Celulas) != 0 {
		t.Errorf("%+v", e)
	}
	if LayoutInicial != "starsonic-4" || ImagensPorSegundo != 25 {
		t.Error("constantes")
	}
}
