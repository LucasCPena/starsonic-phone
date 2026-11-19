package reunioes

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// O chat da reunião (docs/chat-protocolo.md, seção 10), com a cena do palco: a Ana (colega, pelo app), a Maria e a Bia
// (de fora, na reunião, cada uma com a página dela) e o Davi, de fora, que ainda espera. Os textos e os ids dos testes
// são compridos e próprios, e todos passam pelo anotar: o TestMain os procura no registro do pacote inteiro.

// quantasMensagens é quantas mensagens do chat da reunião o canal recebeu.
func quantasMensagens(can *canalFalso) int {
	n := 0
	for _, tp := range can.tipos() {
		if tp == "mensagem" {
			n++
		}
	}
	return n
}

// mandaMensagem manda o texto pelo pedido e confere que valeu.
func (p *cenaPalco) mandaMensagem(ped *Pedido, id, texto string) {
	p.t.Helper()
	anotar(id, texto)
	if err := p.g.Mensagem(ped, id, texto); err != nil {
		p.t.Fatalf("Mensagem(%q): %v", id, err)
	}
}

// foraDaReuniao confere que a mensagem do pedido é recusada, e que ninguém a recebe.
func (p *cenaPalco) foraDaReuniao(quem string, ped *Pedido, canais ...*canalFalso) {
	p.t.Helper()
	antes := make([]int, len(canais))
	for i, c := range canais {
		antes[i] = quantasMensagens(c)
	}
	anotar("recusadaX9", "Um texto que ninguém pode receber")
	if err := p.g.Mensagem(ped, "recusadaX9", "Um texto que ninguém pode receber"); !errors.Is(err, ErrForaDaReuniao) {
		p.t.Fatalf("%s: o erro é %v; queria ErrForaDaReuniao", quem, err)
	}
	for i, c := range canais {
		if quantasMensagens(c) != antes[i] {
			p.t.Fatalf("%s: o canal %d recebeu a mensagem recusada: %q", quem, i, c.tipos())
		}
	}
}

func TestMensagem_VaiAsPaginasDaReuniao(t *testing.T) {
	p := novaCenaPalco(t)
	p.avisos.limpar()
	p.mandaMensagem(p.pm, "recadoDaMaria01", "Bom dia a todos da reunião")

	// Quem escreveu recebe o id e o voce; os outros, não.
	querM := fmt.Sprintf(`{"tipo":"mensagem","id":"recadoDaMaria01","de":%q,"nome":"Maria Lima","voce":true,`+
		`"texto":"Bom dia a todos da reunião"}`, p.maria)
	if got := p.canM.ultima(); got != querM {
		t.Fatalf("a Maria, que escreveu, recebeu\n%s\nqueria\n%s", got, querM)
	}
	querB := fmt.Sprintf(`{"tipo":"mensagem","de":%q,"nome":"Maria Lima","voce":false,`+
		`"texto":"Bom dia a todos da reunião"}`, p.maria)
	if got := p.canB.ultima(); got != querB {
		t.Fatalf("a Bia recebeu\n%s\nqueria\n%s", got, querB)
	}
	if n := quantasMensagens(p.canM) + quantasMensagens(p.canB); n != 2 {
		t.Fatalf("as duas páginas receberam %d mensagens; queria uma em cada", n)
	}
	// Quem ainda espera não recebe nada, e os apps dos colegas não ganham evento nenhum.
	p.canDa.conferir(t, "Davi, que espera", []string{"aguardando"}, false)
	if n := p.avisos.total(); n != 0 {
		t.Fatalf("os apps receberam %d evento(s) com a mensagem", n)
	}
}

func TestMensagem_QuemEntraDepoisNaoVe(t *testing.T) {
	p := novaCenaPalco(t)
	p.mandaMensagem(p.pm, "recadoDeAntes01", "Uma mensagem de antes de o Davi entrar")
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	p.entrou(p.r, mustParticipante(t, p.canDa))
	// O servidor não guardou nada: a página que entra depois só recebe o aceito.
	p.canDa.conferir(t, "Davi, aceito depois da mensagem", []string{"aguardando", "aceito"}, false)
	// E dali em diante ele recebe.
	p.mandaMensagem(p.pb, "recadoDepois01", "Uma mensagem com o Davi já na reunião")
	if quantasMensagens(p.canDa) != 1 {
		t.Fatalf("o Davi, na reunião, recebeu %q", p.canDa.tipos())
	}
}

// mustParticipante é o participante do aceito que o canal recebeu.
func mustParticipante(t *testing.T, can *canalFalso) string {
	t.Helper()
	part, _ := aceitoDe(t, can)
	return part
}

func TestMensagem_QuemSaiu(t *testing.T) {
	p := novaCenaPalco(t)
	p.saiu(p.r, p.bia) // a Bia clicou em Sair, e a página dela continua aberta
	antesB := quantasMensagens(p.canB)
	p.mandaMensagem(p.pm, "recadoSemABia1", "A Bia saiu e não pode receber isto")
	if quantasMensagens(p.canB) != antesB {
		t.Fatal("a página de quem saiu recebeu a mensagem de quem ficou")
	}
	p.foraDaReuniao("a Bia, que saiu", p.pb, p.canM, p.canB)

	// O Entrar de novo: com uma senha nova, ela está entrando, e volta a receber e a mandar.
	if _, err := p.g.NovaSenha(p.pb); err != nil {
		t.Fatal(err)
	}
	p.mandaMensagem(p.pm, "recadoComABia1", "A Bia está entrando de novo")
	if quantasMensagens(p.canB) != antesB+1 {
		t.Fatalf("a Bia, entrando de novo, recebeu %q", p.canB.tipos())
	}
	antesM := quantasMensagens(p.canM)
	p.mandaMensagem(p.pb, "recadoDaBia001", "A Bia, entrando de novo, também manda")
	if quantasMensagens(p.canM) != antesM+1 {
		t.Fatal("a mensagem de quem está entrando de novo não chegou à Maria")
	}
}

func TestMensagem_QuemAcabouDeSerAceita(t *testing.T) {
	p := novaCenaPalco(t)
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	davi := mustParticipante(t, p.canDa)
	// Ele ainda não entrou (a ligação dele está subindo): recebe o que os outros mandam, e manda.
	p.mandaMensagem(p.pm, "recadoAoDavi01", "O Davi acabou de ser aceito")
	if quantasMensagens(p.canDa) != 1 {
		t.Fatalf("o Davi, entrando, recebeu %q", p.canDa.tipos())
	}
	p.mandaMensagem(p.pd, "recadoDoDavi01", "Cheguei agora, um instante")
	quer := fmt.Sprintf(`{"tipo":"mensagem","id":"recadoDoDavi01","de":%q,"nome":"Davi Rocha","voce":true,`+
		`"texto":"Cheguei agora, um instante"}`, davi)
	if got := p.canDa.ultima(); got != quer {
		t.Fatalf("o Davi, que escreveu entrando, recebeu\n%s\nqueria\n%s", got, quer)
	}
	if !strings.Contains(p.canM.ultima(), `"nome":"Davi Rocha","voce":false`) {
		t.Fatalf("a Maria recebeu %s", p.canM.ultima())
	}
}

func TestMensagem_SenhaQueVenceu(t *testing.T) {
	p := novaCenaPalco(t)
	if err := p.g.Aceitar(p.ctx, p.r, p.cena.ana.p.ID, p.pedidoDe(p.r, p.cena.ana, "Davi Rocha")); err != nil {
		t.Fatal(err)
	}
	mustParticipante(t, p.canDa)
	// O Davi nunca entrou, e a senha dele venceu: a página continua aberta, fora da reunião.
	p.andar(duracaoSenha + time.Second)
	p.g.Varrer()
	p.mandaMensagem(p.pm, "recadoSemODavi1", "O Davi deixou a senha vencer")
	p.canDa.conferir(t, "Davi, com a senha vencida", []string{"aguardando", "aceito"}, false)
	p.foraDaReuniao("o Davi, com a senha vencida", p.pd, p.canM, p.canB, p.canDa)
}

func TestMensagem_TiradoEsperandoEOutraReuniao(t *testing.T) {
	p := novaCenaPalco(t)
	// Outra reunião, com o Carlos e a página do Caio, os dois dentro.
	r2 := p.cena.marcada()
	p.cena.dentro(r2, p.cena.carlos)
	caio, pc, canC := p.cena.aceito(r2, p.cena.carlos, "Caio Dias")
	p.cena.entrou(r2, caio)
	if err := p.g.Tirar(p.ctx, p.r, p.cena.ana.p.ID, p.maria); err != nil {
		t.Fatal(err)
	}
	antesM := p.canM.tipos()

	p.mandaMensagem(p.pb, "recadoSoDaqui1", "Só quem está nesta reunião recebe")
	p.canM.conferir(t, "Maria, tirada", antesM, true)
	p.canDa.conferir(t, "Davi, que espera", []string{"aguardando"}, false)
	canC.conferir(t, "Caio, da outra reunião", []string{"aguardando", "aceito"}, false)

	// E a da outra reunião fica nela.
	antesB := quantasMensagens(p.canB)
	anotar("recadoDoCaio01", "A conversa da outra reunião")
	if err := p.g.Mensagem(pc, "recadoDoCaio01", "A conversa da outra reunião"); err != nil {
		t.Fatal(err)
	}
	if quantasMensagens(canC) != 1 || quantasMensagens(p.canB) != antesB {
		t.Fatalf("a mensagem do Caio: ele recebeu %q, e a Bia, da outra reunião, %q", canC.tipos(), p.canB.tipos())
	}

	todos := []*canalFalso{p.canM, p.canB, p.canDa, canC}
	p.foraDaReuniao("a Maria, tirada", p.pm, todos...)
	p.foraDaReuniao("o Davi, que espera", p.pd, todos...)
	p.foraDaReuniao("sem pedido", nil, todos...)
}

func TestMensagem_SoComATela(t *testing.T) {
	p := novaCenaPalco(t)
	p.entrouTela(p.r, p.maria)
	p.saiu(p.r, p.maria) // a câmera da Maria saiu; a tela dela continua na reunião
	p.mandaMensagem(p.pb, "recadoParaATela", "A Maria continua aqui pela tela")
	if quantasMensagens(p.canM) != 1 {
		t.Fatalf("a página que está na reunião só pela tela recebeu %q", p.canM.tipos())
	}
	p.mandaMensagem(p.pm, "recadoDaTela01", "E ela também escreve")
	if quantasMensagens(p.canB) != 2 {
		t.Fatalf("a mensagem de quem está só pela tela: a Bia recebeu %q", p.canB.tipos())
	}
}

func TestMensagem_DoisComOMesmoNome(t *testing.T) {
	p := novaCenaPalco(t)
	// Outra aba da mesma pessoa é outro participante, com o mesmo nome.
	outra, pm2, canM2 := p.cena.aceito(p.r, p.cena.ana, "Maria Lima")
	p.cena.entrou(p.r, outra)
	anotar(outra)
	p.mandaMensagem(p.pm, "recadoDaAba0001", "As duas abas têm o mesmo nome")

	quer := fmt.Sprintf(`{"tipo":"mensagem","de":%q,"nome":"Maria Lima","voce":false,`+
		`"texto":"As duas abas têm o mesmo nome"}`, p.maria)
	if got := canM2.ultima(); got != quer {
		t.Fatalf("a outra aba recebeu\n%s\nqueria\n%s", got, quer)
	}
	if !strings.Contains(p.canM.ultima(), `"id":"recadoDaAba0001"`) || !strings.Contains(p.canM.ultima(), `"voce":true`) {
		t.Fatalf("a aba que escreveu recebeu %s", p.canM.ultima())
	}
	// E o contrário: a que escreve agora é a outra.
	p.mandaMensagem(pm2, "recadoDaAba0002", "Agora é a segunda aba")
	if got := p.canM.ultima(); !strings.Contains(got, fmt.Sprintf(`"de":%q`, outra)) || !strings.Contains(got, `"voce":false`) ||
		strings.Contains(got, `"id"`) {
		t.Fatalf("a primeira aba recebeu %s", got)
	}
}

func TestMensagem_Texto(t *testing.T) {
	p := novaCenaPalco(t)
	texto := func(can *canalFalso) string {
		t.Helper()
		ms := can.mensagens()
		s, _ := ms[len(ms)-1]["texto"].(string)
		return s
	}
	// Os espaços das pontas saem, e a quebra de linha fica, sempre como \n.
	p.mandaMensagem(p.pm, "recadoComLinhas", "  Primeira linha do recado\r\nSegunda linha do recado  ")
	anotar("Primeira linha do recado\nSegunda linha do recado")
	for nome, can := range map[string]*canalFalso{"a Maria": p.canM, "a Bia": p.canB} {
		if got := texto(can); got != "Primeira linha do recado\nSegunda linha do recado" {
			t.Fatalf("%s recebeu o texto %q", nome, got)
		}
	}
	// Os sinais de HTML passam como texto: quem os mostra como texto é a página.
	p.mandaMensagem(p.pm, "recadoComSinais", `<b>Negrito de mentira</b> & "aspas"`)
	if got := texto(p.canB); got != `<b>Negrito de mentira</b> & "aspas"` {
		t.Fatalf("a Bia recebeu o texto %q", got)
	}
	// O maior texto vale, contado em pontos de código.
	mil := strings.Repeat("😀", 1000)
	if err := p.g.Mensagem(p.pm, "recadoDeMil0001", mil); err != nil {
		t.Fatalf("o texto de 1.000: %v", err)
	}
	if got := texto(p.canB); got != mil {
		t.Fatalf("a Bia recebeu %d pontos de código; queria 1.000", len([]rune(got)))
	}

	antes := quantasMensagens(p.canM) + quantasMensagens(p.canB)
	if err := p.g.Mensagem(p.pm, "recadoGrande001", strings.Repeat("a", 1001)); !errors.Is(err, regras.ErrTextoGrande) {
		t.Fatalf("o texto de 1.001: o erro é %v; queria regras.ErrTextoGrande", err)
	}
	var campo *regras.Erro
	for _, ruim := range []string{"", "   ", "\n\n", "com o nulo\x00no meio"} {
		if err := p.g.Mensagem(p.pm, "recadoRuim00001", ruim); !errors.As(err, &campo) || campo.Campo != "texto" {
			t.Fatalf("o texto %q: o erro é %v; queria o *regras.Erro do texto", ruim, err)
		}
	}
	if n := quantasMensagens(p.canM) + quantasMensagens(p.canB); n != antes {
		t.Fatalf("um texto que não vale foi repassado: %d mensagens a mais", n-antes)
	}
	// Quem manda vem primeiro: fora da reunião, o erro é o de fora, qualquer que seja o texto.
	if err := p.g.Mensagem(p.pd, "recadoRuim00002", strings.Repeat("a", 1001)); !errors.Is(err, ErrForaDaReuniao) {
		t.Fatalf("o texto grande de quem espera: o erro é %v; queria ErrForaDaReuniao", err)
	}
}

func TestMensagem_SemNadaNoLog(t *testing.T) {
	p := novaCenaPalco(t)
	p.mandaMensagem(p.pm, "recadoNoLog0001", "Este texto nunca pode ir ao registro")
	p.mandaMensagem(p.pb, "recadoNoLog0002", "Nem este, com https://exemplo.com.br/segredo")
	anotar("recadoNoLog0003", "Um texto grande demais")
	_ = p.g.Mensagem(p.pm, "recadoNoLog0003", "Um texto grande demais"+strings.Repeat("a", 1000))
	anotar("recadoNoLog0004")
	_ = p.g.Mensagem(p.pm, "recadoNoLog0004", "   ")
	p.foraDaReuniao("o Davi, que espera", p.pd, p.canM, p.canB)
	p.saiu(p.r, p.maria)
	p.foraDaReuniao("a Maria, que saiu", p.pm, p.canB)
	if err := conferirLog(registro.String()); err != nil {
		t.Fatal(err)
	}
}
