package reunioes

import (
	"fmt"
	"maps"
	"reflect"
	"slices"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// O colega entra pela página (o EntrarPelaPagina): sem a sala de espera, com o participante de quem entra pelo app.

// pelaPagina é o EntrarPelaPagina que tem de dar certo, com um canal novo. Devolve o pedido, o canal e o participante
// do aceito.
func (c *cena) pelaPagina(r banco.Reuniao, k colega) (*Pedido, *canalFalso, string) {
	c.t.Helper()
	can := &canalFalso{}
	p, err := c.g.EntrarPelaPagina(c.ctx, r, k.p, k.computador, can)
	if err != nil {
		c.t.Fatalf("EntrarPelaPagina de %s: %v", k.p.Nome, err)
	}
	part, _ := aceitoDe(c.t, can)
	anotar(voltaDe(c.t, can))
	return p, can, part
}

// participantesDe são quantos participantes a sala guarda na memória (0 sem a sala).
func participantesDe(g *Gerente, sala string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	if s := g.salas[sala]; s != nil {
		return len(s.participantes)
	}
	return 0
}

func TestEntrarPelaPagina_Aceito(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	p, can, part := c.pelaPagina(r, c.carlos)
	if p == nil {
		t.Fatal("o EntrarPelaPagina não devolveu o pedido")
	}
	can.conferir(t, "Carlos", []string{"aceito"}, false)
	m := can.mensagens()[0]
	if chaves := slices.Sorted(maps.Keys(m)); !slices.Equal(chaves, []string{"participante", "senha", "tipo", "turn", "video", "volta"}) {
		t.Fatalf("o aceito tem %q", chaves)
	}
	if !hex16.MatchString(part) {
		t.Fatalf("participante = %q", part)
	}
	_, senha := aceitoDe(t, can)
	s := lerSenha(t, senha)
	quer := video.Senha{V: 1, Sala: r.Sala, Participante: part, Papel: video.Colega, Nome: "Carlos Lima",
		Vence: 1794488430000, ID: s.ID}
	if s != quer {
		t.Fatalf("a senha é %+v\nqueria %+v", s, quer)
	}
	turn, _ := m["turn"].(map[string]any)
	enderecos, _ := m["video"].(map[string]any)
	if turn["usuario"] != "1794531600:"+part || enderecos["wss"] != "wss://video.exemplo.com.br/sip" {
		t.Fatalf("o turn é %v e o video, %v", turn, enderecos)
	}
	if v := voltaDe(t, can); len(v) != 43 {
		t.Fatalf("a volta é %q; queria 43 caracteres", v)
	}
	// Ninguém foi avisado: a câmera ainda não entrou.
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos", n)
	}
}

func TestEntrarPelaPagina_ComecaAReuniao(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	_, canMaria := c.pedir(r, "Maria Lima")
	canMaria.conferir(t, "Maria", []string{"naoComecou"}, false)

	_, _, carlos := c.pelaPagina(r, c.carlos)
	// O aceito do colega não leva o pedido aos colegas: só a câmera dele na reunião.
	canMaria.conferir(t, "Maria", []string{"naoComecou"}, false)
	c.entrou(r, carlos)
	canMaria.conferir(t, "Maria", []string{"naoComecou", "aguardando"}, false)
	ev := c.avisos.ultimo(c.carlos.computador, "reuniaoPedido")
	if p, _ := ev["pedido"].(map[string]any); p["nome"] != "Maria Lima" {
		t.Fatalf("o Carlos recebeu %v", ev)
	}
	if ac, n := c.g.Contagem(r.Sala); !ac || n != 1 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
}

func TestEntrarPelaPagina_NaLista(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	_, _, carlos := c.pelaPagina(r, c.carlos)
	c.entrou(r, carlos)

	l, err := c.g.Lista(r, c.ana.p.ID)
	if err != nil {
		t.Fatalf("Lista: %v", err)
	}
	quer := map[string]any{"participantes": lista(pv(ana, "Ana Souza", false, false), pv(carlos, "Carlos Lima", false, false)),
		"pedidos": lista()}
	if got := emJSON(l); !reflect.DeepEqual(got, quer) {
		t.Fatalf("a lista é %v\nqueria %v", got, quer)
	}
}

func TestEntrarPelaPagina_OComputadorRecebeOsEventos(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	_, _, carlos := c.pelaPagina(r, c.carlos)
	c.entrou(r, carlos)
	c.avisos.limpar()

	c.pedir(r, "Maria Lima")
	ev := c.avisos.ultimo(c.carlos.computador, "reuniaoPedido")
	if p, _ := ev["pedido"].(map[string]any); ev["reuniao"] != r.Codigo || p["nome"] != "Maria Lima" {
		t.Fatalf("o computador do Carlos recebeu %v", c.avisos.de(c.carlos.computador))
	}
}

func TestEntrarPelaPagina_AsRotasDoAppValem(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	_, _, carlos := c.pelaPagina(r, c.carlos)
	c.entrou(r, carlos)
	_, canMaria := c.pedir(r, "Maria Lima")

	if err := c.g.Aceitar(c.ctx, r, c.carlos.p.ID, c.pedidoDe(r, c.carlos, "Maria Lima")); err != nil {
		t.Fatalf("o Aceitar do Carlos: %v", err)
	}
	canMaria.conferir(t, "Maria", []string{"aguardando", "aceito"}, false)
}

func TestEntrarPelaPagina_OsErros(t *testing.T) {
	semNada := func(t *testing.T, c *cena, r banco.Reuniao, quer error) {
		t.Helper()
		antes := participantesDe(c.g, r.Sala)
		can := &canalFalso{}
		p, err := c.g.EntrarPelaPagina(c.ctx, r, c.carlos.p, c.carlos.computador, can)
		conferirErro(t, "EntrarPelaPagina", err, quer)
		if p != nil {
			t.Fatal("o erro devolveu um pedido")
		}
		can.conferir(t, "Carlos", nil, false)
		if depois := participantesDe(c.g, r.Sala); depois != antes {
			t.Fatalf("a sala guarda %d participantes; queria os %d de antes", depois, antes)
		}
		if slices.Contains(nomesNaMemoria(c.g), "Carlos Lima") {
			t.Fatal("o nome do Carlos ficou na memória")
		}
	}
	t.Run("ErrLinkInvalido", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.cancelar(r)
		semNada(t, c, c.recarregar(r), ErrLinkInvalido)
	})
	t.Run("ErrSemServidor", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.video.DefinirNoAr(false)
		semNada(t, c, r, ErrSemServidor)
	})
	t.Run("ErrCheia", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		for i := 1; i <= 10; i++ {
			c.dentro(r, c.colega(fmt.Sprint(2200+i), fmt.Sprintf("Colega %d", i)))
		}
		semNada(t, c, r, ErrCheia)
	})
	t.Run("ErrServidorCheio", func(t *testing.T) {
		c := novaCena(t)
		a, b, d := c.marcada(), c.marcada(), c.marcada()
		c.dentro(a, c.ana)
		c.dentro(b, c.bia)
		semNada(t, c, d, ErrServidorCheio)
	})
}

func TestEntrarPelaPagina_Volta(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	p, can, carlos := c.pelaPagina(r, c.carlos)
	c.entrou(r, carlos)

	novo := &canalFalso{}
	got, v, err := c.g.Voltar(r, carlos, voltaDe(t, can), novo)
	if err != nil || got != p {
		t.Fatalf("Voltar = %v, %v; queria o mesmo pedido", got, err)
	}
	anotar(v)
	if m := novo.mensagens(); len(m) != 1 || m[0]["tipo"] != "voltou" || m[0]["volta"] != v {
		t.Fatalf("o canal novo recebeu %v", m)
	}
	// O canal velho fecha, e o novo é o do participante: o tirado chega a ele.
	can.conferir(t, "Carlos, o canal velho", []string{"aceito"}, true)
	c.dentro(r, c.ana)
	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, carlos); err != nil {
		t.Fatalf("Tirar: %v", err)
	}
	novo.conferir(t, "Carlos, o canal novo", []string{"voltou", "tirado"}, true)
}

func TestEntrarPelaPagina_SenhaETela(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	p, _, carlos := c.pelaPagina(r, c.carlos)

	// Antes da câmera entrar, a tela não vale.
	_, err := c.g.TelaDeFora(p)
	conferirErro(t, "a tela antes do entrou", err, ErrForaDaReuniao)

	senha, err := c.g.NovaSenha(p)
	if err != nil {
		t.Fatalf("NovaSenha: %v", err)
	}
	if s := lerSenha(t, senha); s.Participante != carlos || s.Papel != video.Colega || s.Nome != "Carlos Lima" || s.Tela {
		t.Fatalf("a senha nova é %+v", s)
	}

	c.entrou(r, carlos)
	tela, err := c.g.TelaDeFora(p)
	if err != nil {
		t.Fatalf("TelaDeFora: %v", err)
	}
	if s := lerSenha(t, tela); s.Participante != carlos || s.Papel != video.Colega || s.Nome != "Carlos Lima" || !s.Tela {
		t.Fatalf("a senha da tela é %+v", s)
	}
}

func TestEntrarPelaPagina_PalcoEChat(t *testing.T) {
	p := novaCenaPalco(t) // a Ana pelo app, a Maria e a Bia de fora, na reunião
	p.anaEMaria()
	p.canM.conferir(t, "Maria", []string{"aguardando", "aceito", "palco"}, false)

	// O aceito, e o palco que a sala já tem, na mesma trava: o palco vem logo depois do aceito.
	pc, canC, carlos := p.pelaPagina(p.r, p.carlos)
	canC.conferir(t, "Carlos", []string{"aceito", "palco"}, false)
	p.entrou(p.r, carlos)
	p.palco(1920, 1080, qd(p.ana, false, 0, 0, 960, 540), qd(carlos, false, 960, 0, 960, 540))
	q, _ := ultimoPalco(t, canC)["quadros"].([]any)
	if len(q) != 2 {
		t.Fatalf("o palco do Carlos tem %v", q)
	}
	if eu, _ := q[1].(map[string]any); eu["nome"] != "Carlos Lima" || eu["voce"] != true {
		t.Fatalf("o quadro do Carlos é %v", eu)
	}

	// O Carlos manda e recebe o chat da reunião, como as páginas de quem é de fora.
	p.mandaMensagem(pc, "doCarlos01", "Bom dia, aqui é pela página")
	minha := canC.mensagens()[len(canC.mensagens())-1]
	if minha["tipo"] != "mensagem" || minha["id"] != "doCarlos01" || minha["voce"] != true || minha["nome"] != "Carlos Lima" {
		t.Fatalf("o Carlos recebeu %v", minha)
	}
	daMaria := p.canM.mensagens()[len(p.canM.mensagens())-1]
	if daMaria["tipo"] != "mensagem" || daMaria["de"] != carlos || daMaria["nome"] != "Carlos Lima" || daMaria["voce"] != false {
		t.Fatalf("a Maria recebeu %v", daMaria)
	}
	p.mandaMensagem(p.pm, "daMaria01", "Bom dia, Carlos")
	if m := canC.mensagens()[len(canC.mensagens())-1]; m["tipo"] != "mensagem" || m["de"] != p.maria || m["texto"] != "Bom dia, Carlos" {
		t.Fatalf("o Carlos recebeu %v", m)
	}
}

func TestEntrarPelaPagina_Tirado(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	p, can, carlos := c.pelaPagina(r, c.carlos)
	c.entrou(r, carlos)

	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, carlos); err != nil {
		t.Fatalf("Tirar: %v", err)
	}
	can.conferir(t, "Carlos", []string{"aceito", "tirado"}, true)
	_, err := c.g.NovaSenha(p)
	conferirErro(t, "a senha nova de quem foi tirado", err, ErrForaDeOrdem)
	if ac, n := c.g.Contagem(r.Sala); !ac || n != 1 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
}
