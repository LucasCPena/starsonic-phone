package reunioes

import (
	"fmt"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// A cena do palco: a reunião marcada, com a Ana (colega, pelo app), a Maria e a Bia (de fora, aceitas, cada uma com o
// canal dela) e o Davi, de fora, que ainda espera na sala de espera, na mesma reunião.
type cenaPalco struct {
	*cena
	r                 banco.Reuniao
	ana, maria, bia   string
	pm, pb, pd        *Pedido
	canM, canB, canDa *canalFalso
}

func novaCenaPalco(t *testing.T) *cenaPalco {
	t.Helper()
	c := novaCena(t)
	p := &cenaPalco{cena: c, r: c.marcada()}
	p.ana = c.dentro(p.r, c.ana)
	p.maria, p.pm, p.canM = c.aceito(p.r, c.ana, "Maria Lima")
	c.entrou(p.r, p.maria)
	p.bia, p.pb, p.canB = c.aceito(p.r, c.ana, "Bia Ramos")
	c.entrou(p.r, p.bia)
	p.pd, p.canDa = c.pedir(p.r, "Davi Rocha")
	anotar(p.ana, p.maria, p.bia)
	return p
}

func qd(participante string, tela bool, x, y, l, a int) video.Quadro {
	anotar(participante)
	return video.Quadro{Participante: participante, Tela: tela, X: x, Y: y, L: l, A: a}
}

// palco é o evento palco do agente.
func (p *cenaPalco) palco(largura, altura int, quadros ...video.Quadro) {
	p.evento(video.Evento{Tipo: "palco", Sala: p.r.Sala, Largura: largura, Altura: altura, Quadros: quadros})
}

// anaEMaria é o palco de 1920x1080 com a Ana na metade de cima e a Maria na de baixo.
func (p *cenaPalco) anaEMaria() {
	p.palco(1920, 1080, qd(p.ana, false, 0, 0, 960, 540), qd(p.maria, false, 960, 0, 960, 540))
}

// textoAnaEMaria é o palco do anaEMaria como a página o recebe; voceMaria diz se quem recebe é a Maria.
func (p *cenaPalco) textoAnaEMaria(voceMaria bool) string {
	return fmt.Sprintf(`{"tipo":"palco","largura":1920,"altura":1080,"quadros":[`+
		`{"quem":%q,"nome":"Ana Souza","voce":false,"tela":false,"semCamera":false,"x":0,"y":0,"l":960,"a":540},`+
		`{"quem":%q,"nome":"Maria Lima","voce":%t,"tela":false,"semCamera":false,"x":960,"y":0,"l":960,"a":540}]}`,
		p.ana, p.maria, voceMaria)
}

func quantosPalcos(can *canalFalso) int {
	n := 0
	for _, tp := range can.tipos() {
		if tp == "palco" {
			n++
		}
	}
	return n
}

func ultimoPalco(t *testing.T, can *canalFalso) map[string]any {
	t.Helper()
	ms := can.mensagens()
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i]["tipo"] == "palco" {
			return ms[i]
		}
	}
	t.Fatalf("o canal não recebeu um palco: %q", can.tipos())
	return nil
}

func TestPalco_VaiAsPaginasAceitas(t *testing.T) {
	p := novaCenaPalco(t)
	p.avisos.limpar()
	p.anaEMaria()

	if got, quer := p.canM.ultima(), p.textoAnaEMaria(true); got != quer {
		t.Fatalf("o canal da Maria recebeu\n%s\nqueria\n%s", got, quer)
	}
	if got, quer := p.canB.ultima(), p.textoAnaEMaria(false); got != quer {
		t.Fatalf("o canal da Bia recebeu\n%s\nqueria\n%s", got, quer)
	}
	// Quem ainda espera, na mesma reunião, não recebe nada, e os apps não recebem evento novo.
	p.canDa.conferir(t, "Davi, que espera", []string{"aguardando"}, false)
	if n := p.avisos.total(); n != 0 {
		t.Fatalf("os apps receberam %d evento(s) com o palco", n)
	}
}

func TestPalco_DepoisDoAceito(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	p.canDa.conferir(t, "Davi, aceito", []string{"aguardando", "aceito", "palco"}, false)
	if got, quer := p.canDa.ultima(), p.textoAnaEMaria(false); got != quer {
		t.Fatalf("o Davi recebeu\n%s\nqueria\n%s", got, quer)
	}
}

func TestPalco_DepoisDoVoltou(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	novo := &canalFalso{}
	if _, _, err := p.g.Voltar(p.r, p.maria, voltaDe(t, p.canM), novo); err != nil {
		t.Fatal(err)
	}
	novo.conferir(t, "Maria, que voltou", []string{"voltou", "palco"}, false)
	q := ultimoPalco(t, novo)["quadros"].([]any)
	if q[1].(map[string]any)["voce"] != true || q[0].(map[string]any)["voce"] != false {
		t.Fatalf("o palco do voltou: %v", q)
	}
}

func TestPalco_Tela(t *testing.T) {
	p := novaCenaPalco(t)
	p.entrouTela(p.r, p.maria)
	p.palco(1920, 1080, qd(p.maria, true, 0, 0, 1280, 720), qd(p.maria, false, 1280, 0, 640, 360))
	quer := func(voce bool) string {
		return fmt.Sprintf(`{"tipo":"palco","largura":1920,"altura":1080,"quadros":[`+
			`{"quem":%q,"nome":"Maria Lima","voce":%t,"tela":true,"semCamera":false,"x":0,"y":0,"l":1280,"a":720},`+
			`{"quem":%q,"nome":"Maria Lima","voce":%t,"tela":false,"semCamera":false,"x":1280,"y":0,"l":640,"a":360}]}`,
			p.maria, voce, p.maria, voce)
	}
	if got := p.canM.ultima(); got != quer(true) {
		t.Fatalf("a Maria recebeu\n%s\nqueria\n%s", got, quer(true))
	}
	if got := p.canB.ultima(); got != quer(false) {
		t.Fatalf("a Bia recebeu\n%s\nqueria\n%s", got, quer(false))
	}
}

func TestPalco_Desconhecido(t *testing.T) {
	p := novaCenaPalco(t)
	p.palco(1920, 1080, qd("00ff00ff00ff00ff", false, 0, 0, 1920, 1080))
	q := ultimoPalco(t, p.canM)["quadros"].([]any)
	if len(q) != 1 || q[0].(map[string]any)["nome"] != "" || q[0].(map[string]any)["quem"] != "00ff00ff00ff00ff" ||
		q[0].(map[string]any)["voce"] != false {
		t.Fatalf("o quadro do desconhecido: %v", q)
	}
}

func TestPalco_Vazio(t *testing.T) {
	p := novaCenaPalco(t)
	p.evento(video.Evento{Tipo: "palco", Sala: p.r.Sala, Largura: 1920, Altura: 1080}) // Quadros nulo
	if got, quer := p.canM.ultima(), `{"tipo":"palco","largura":1920,"altura":1080,"quadros":[]}`; got != quer {
		t.Fatalf("a Maria recebeu %s; queria %s", got, quer)
	}
}

func TestPalco_Repetido(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	p.anaEMaria()
	pal := video.Palco{Largura: 1920, Altura: 1080, Quadros: []video.Quadro{qd(p.ana, false, 0, 0, 960, 540), qd(p.maria, false, 960, 0, 960, 540)}}
	s := salaDoEstado(p.r, p.ana, p.maria, p.bia)
	s.Palco = &pal
	p.estado(s) // o estado que repete o palco também não manda de novo
	if n := quantosPalcos(p.canM); n != 1 {
		t.Fatalf("a Maria recebeu %d palcos; queria 1", n)
	}
	if n := quantosPalcos(p.canB); n != 1 {
		t.Fatalf("a Bia recebeu %d palcos; queria 1", n)
	}
}

func TestPalco_NoEstado(t *testing.T) {
	p := novaCenaPalco(t)
	pal := &video.Palco{Largura: 1920, Altura: 1080, Quadros: []video.Quadro{qd(p.maria, false, 0, 0, 1920, 1080)}}
	s := salaDoEstado(p.r, p.ana, p.maria, p.bia)
	s.Palco = pal
	p.estado(s)
	if n := quantosPalcos(p.canM); n != 1 {
		t.Fatalf("o estado com o palco mandou %d à Maria; queria 1", n)
	}
	if n := quantosPalcos(p.canDa); n != 0 {
		t.Fatalf("o Davi, que espera, recebeu %d palcos", n)
	}
	p.estado(salaDoEstado(p.r, p.ana, p.maria, p.bia)) // sem o palco: o chat o esquece, sem mensagem
	if n := quantosPalcos(p.canM) + quantosPalcos(p.canB); n != 2 {
		t.Fatalf("o estado sem o palco mandou mensagem: %d palcos no total", n)
	}
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	p.canDa.conferir(t, "Davi, aceito depois de o palco ser esquecido", []string{"aguardando", "aceito"}, false)
}

func TestPalco_QueNaoVale(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	antesM, antesB := len(p.canM.mensagens()), len(p.canB.mensagens())
	p.avisos.limpar()
	treze := func(n int) []video.Quadro {
		var l []video.Quadro
		for range n {
			l = append(l, qd(p.ana, false, 0, 0, 100, 100))
		}
		return l
	}
	casos := []struct {
		nome            string
		largura, altura int
		quadros         []video.Quadro
	}{
		{"largura 0", 0, 1080, []video.Quadro{qd(p.ana, false, 0, 0, 16, 16)}},
		{"largura 15", 15, 1080, nil},
		{"largura 7681", 7681, 1080, nil},
		{"altura 0", 1920, 0, nil},
		{"altura 9000", 1920, 9000, nil},
		{"14 quadros", 1920, 1080, treze(14)},
		{"passa do mosaico na largura", 1920, 1080, []video.Quadro{qd(p.ana, false, 1000, 0, 960, 540)}},
		{"passa do mosaico na altura", 1920, 1080, []video.Quadro{qd(p.ana, false, 0, 600, 960, 540)}},
		{"x negativo", 1920, 1080, []video.Quadro{qd(p.ana, false, -1, 0, 960, 540)}},
		{"y negativo", 1920, 1080, []video.Quadro{qd(p.ana, false, 0, -1, 960, 540)}},
		{"l de 15", 1920, 1080, []video.Quadro{qd(p.ana, false, 0, 0, 15, 540)}},
		{"a de 15", 1920, 1080, []video.Quadro{qd(p.ana, false, 0, 0, 960, 15)}},
		{"soma que estoura", 1920, 1080, []video.Quadro{qd(p.ana, false, 1<<62, 0, 1<<62, 540)}},
		{"participante curto", 1920, 1080, []video.Quadro{{Participante: "abc", L: 960, A: 540}}},
		{"participante com maiúsculas", 1920, 1080, []video.Quadro{{Participante: "00FF00FF00FF00FF", L: 960, A: 540}}},
		{"participante que não é hexadecimal", 1920, 1080, []video.Quadro{{Participante: "00ff00ff00ff00fg", L: 960, A: 540}}},
	}
	for _, k := range casos {
		antes := strings.Count(registro.String(), "reunioes: um palco do servidor de vídeo não valeu")
		p.palco(k.largura, k.altura, k.quadros...)
		if depois := strings.Count(registro.String(), "reunioes: um palco do servidor de vídeo não valeu"); depois != antes+1 {
			t.Errorf("%s: o registro ganhou %d linha(s); queria 1", k.nome, depois-antes)
		}
	}
	if len(p.canM.mensagens()) != antesM || len(p.canB.mensagens()) != antesB || p.avisos.total() != 0 {
		t.Fatalf("um palco que não vale mandou mensagem")
	}
	// O palco que valeu continua o da sala: quem é aceito agora o recebe.
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	if got, quer := p.canDa.ultima(), p.textoAnaEMaria(false); got != quer {
		t.Fatalf("o Davi recebeu\n%s\nqueria\n%s", got, quer)
	}
	// Dentro do limite vale: 13 quadros, o menor tamanho e o maior mosaico.
	p.palco(7680, 4320, append(treze(12), qd(p.ana, false, 7664, 4304, 16, 16))...)
	if n := quantosPalcos(p.canM); n != 2 {
		t.Fatalf("o palco no limite não valeu: a Maria recebeu %d palcos", n)
	}
}

func TestPalco_ReuniaoQueAcaba(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	p.saiu(p.r, p.maria)
	p.saiu(p.r, p.bia)
	p.saiu(p.r, p.ana)
	p.acabou(p.r)
	p.g.mu.Lock()
	s := p.g.salas[p.r.Sala]
	guarda := s != nil && s.palco != nil
	p.g.mu.Unlock()
	if guarda {
		t.Fatal("depois do acabou, a sala ainda guarda o palco")
	}
	// A reunião recomeça sem o palco de antes.
	p.cena.dentro(p.r, p.cena.ana)
	_, _, can := p.cena.aceito(p.r, p.cena.ana, "Caio Dias")
	can.conferir(t, "Caio, aceito na reunião que recomeçou", []string{"aguardando", "aceito"}, false)
}

func TestCamera_Desligada(t *testing.T) {
	p := novaCenaPalco(t)
	p.anaEMaria()
	quer := func(sem bool) string {
		return strings.Replace(p.textoAnaEMaria(true), `"nome":"Maria Lima","voce":true,"tela":false,"semCamera":false`,
			fmt.Sprintf(`"nome":"Maria Lima","voce":true,"tela":false,"semCamera":%t`, sem), 1)
	}
	if err := p.g.Camera(p.pm, false); err != nil {
		t.Fatal(err)
	}
	if got := p.canM.ultima(); got != quer(true) {
		t.Fatalf("a Maria recebeu\n%s\nqueria\n%s", got, quer(true))
	}
	if got, w := p.canB.ultima(), strings.Replace(quer(true), `"voce":true`, `"voce":false`, 1); got != w {
		t.Fatalf("a Bia recebeu\n%s\nqueria\n%s", got, w)
	}
	if err := p.g.Camera(p.pm, false); err != nil { // de novo: nada muda
		t.Fatal(err)
	}
	if quantosPalcos(p.canM) != 2 || quantosPalcos(p.canB) != 2 {
		t.Fatal("o aviso repetido mandou o palco de novo")
	}
	if err := p.g.Camera(p.pm, true); err != nil {
		t.Fatal(err)
	}
	if got := p.canM.ultima(); got != quer(false) {
		t.Fatalf("a Maria recebeu\n%s\nqueria\n%s", got, quer(false))
	}
	if n := quantosPalcos(p.canDa); n != 0 {
		t.Fatalf("o Davi, que espera, recebeu %d palcos", n)
	}
}

func TestCamera_SemPalco(t *testing.T) {
	p := novaCenaPalco(t)
	if err := p.g.Camera(p.pm, false); err != nil {
		t.Fatal(err)
	}
	if quantosPalcos(p.canM) != 0 || quantosPalcos(p.canB) != 0 {
		t.Fatal("o aviso da câmera, sem palco, mandou mensagem")
	}
	p.anaEMaria()
	if got := ultimoPalco(t, p.canM)["quadros"].([]any)[1].(map[string]any)["semCamera"]; got != true {
		t.Fatalf("o primeiro palco saiu com semCamera %v; queria true", got)
	}
}

func TestCamera_ForaDeOrdem(t *testing.T) {
	p := novaCenaPalco(t)
	conferirErro(t, "o pedido nulo", p.g.Camera(nil, false), ErrForaDeOrdem)
	conferirErro(t, "o que ainda espera", p.g.Camera(p.pd, false), ErrForaDeOrdem)
	p.saiu(p.r, p.maria)
	p.saiu(p.r, p.bia)
	p.saiu(p.r, p.ana)
	p.acabou(p.r)
	conferirErro(t, "o que acabou", p.g.Camera(p.pm, false), ErrForaDeOrdem)
}

func TestPalco_SemNomesNoLog(t *testing.T) {
	segredosMu.Lock()
	exigirLog = true
	segredosMu.Unlock()
	p := novaCenaPalco(t)
	p.anaEMaria()
	p.palco(0, 0)
	_ = p.g.Camera(p.pm, false)
	pal := &video.Palco{Largura: 1920, Altura: 1080, Quadros: []video.Quadro{qd(p.bia, false, 0, 0, 1920, 1080)}}
	s := salaDoEstado(p.r, p.ana, p.maria, p.bia)
	s.Palco = pal
	p.estado(s)
	p.saiu(p.r, p.ana)
	p.acabou(p.r)
	if err := conferirLog(registro.String()); err != nil {
		t.Fatal(err)
	}
}
