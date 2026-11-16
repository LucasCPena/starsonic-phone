package reunioes

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

func TestPedido_AntesDeComecar(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	_, can := c.pedir(r, "Maria Lima")
	can.conferir(t, "Maria", []string{"naoComecou"}, false)
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos com ninguém na reunião", n)
	}

	// Antes de um colega entrar, o pedido espera sem limite.
	c.andar(30 * time.Minute)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"naoComecou"}, false)

	ana := c.dentro(r, c.ana)
	can.conferir(t, "Maria", []string{"naoComecou", "aguardando"}, false)
	evs := c.avisos.de(c.ana.computador)
	if len(evs) != 2 || evs[0]["tipo"] != "reuniaoPedido" || evs[1]["tipo"] != "reuniaoParticipantes" {
		t.Fatalf("a Ana recebeu %v", evs)
	}
	pedido, _ := evs[0]["pedido"].(map[string]any)
	id, _ := pedido["id"].(string)
	anotar(id)
	if !hex16.MatchString(id) || !reflect.DeepEqual(evs[0], map[string]any{"tipo": "reuniaoPedido", "reuniao": r.Codigo,
		"pedido": pd(id, "Maria Lima")}) {
		t.Fatalf("o reuniaoPedido é %v", evs[0])
	}
	quer := map[string]any{"tipo": "reuniaoParticipantes", "reuniao": r.Codigo,
		"participantes": lista(pv(ana, "Ana Souza", false, false)), "pedidos": lista(pd(id, "Maria Lima"))}
	if !reflect.DeepEqual(evs[1], quer) {
		t.Fatalf("o reuniaoParticipantes é %v\nqueria %v", evs[1], quer)
	}

	// Os 10 minutos contam de quando o pedido chegou aos colegas.
	c.andar(10*time.Minute - time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"naoComecou", "aguardando"}, false)
	c.andar(time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"naoComecou", "aguardando", "recusado"}, true)
}

func TestPedido_Aceito(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	_, can := c.pedir(r, "Maria Lima")
	id := c.pedidoDe(r, c.ana, "Maria Lima")
	c.avisos.limpar()

	if err := c.g.Aceitar(c.ctx, r, c.ana.p.ID, id); err != nil {
		t.Fatalf("Aceitar: %v", err)
	}
	can.conferir(t, "Maria", []string{"aguardando", "aceito"}, false)
	// O aceito é o Acesso, sem a reuniao, com a senha de quem é de fora.
	if chaves := slices.Sorted(maps.Keys(can.mensagens()[1])); !slices.Equal(chaves,
		[]string{"participante", "senha", "tipo", "turn", "video"}) {
		t.Fatalf("o aceito tem %q", chaves)
	}
	maria, senha := aceitoDe(t, can)
	s := lerSenha(t, senha)
	quer := video.Senha{V: 1, Sala: r.Sala, Participante: maria, Papel: video.Fora, Nome: "Maria Lima",
		Vence: 1794488430000, ID: s.ID}
	if s != quer || !hex16.MatchString(maria) {
		t.Fatalf("a senha é %+v\nqueria %+v", s, quer)
	}
	evs := c.avisos.de(c.ana.computador)
	if len(evs) != 2 || !reflect.DeepEqual(evs[0], map[string]any{"tipo": "reuniaoPedidoFim", "reuniao": r.Codigo, "pedido": id}) ||
		!reflect.DeepEqual(evs[1]["pedidos"], lista()) {
		t.Fatalf("a Ana recebeu %v", evs)
	}

	c.avisos.limpar()
	c.entrou(r, maria)
	queroLista := map[string]any{"tipo": "reuniaoParticipantes", "reuniao": r.Codigo,
		"participantes": lista(pv(ana, "Ana Souza", false, false), pv(maria, "Maria Lima", true, false)), "pedidos": lista()}
	if evs := c.avisos.de(c.ana.computador); len(evs) != 1 || !reflect.DeepEqual(evs[0], queroLista) {
		t.Fatalf("depois do entrou, a Ana recebeu %v\nqueria %v", evs, queroLista)
	}
	if ac, n := c.g.Contagem(r.Sala); !ac || n != 2 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
	// Responder de novo não vale.
	conferirErro(t, "Aceitar de novo", c.g.Aceitar(c.ctx, r, c.ana.p.ID, id), ErrJaRespondido)
	conferirErro(t, "Recusar depois", c.g.Recusar(c.ctx, r, c.ana.p.ID, id), ErrJaRespondido)
}

func TestPedido_PrimeiraRespostaVale(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	for i := range 200 {
		nome := fmt.Sprintf("Visitante %d", i)
		_, can := c.pedir(r, nome)
		id := c.pedidoDe(r, c.ana, nome)
		var errAceitar, errRecusar error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			errAceitar = c.g.Aceitar(c.ctx, r, c.ana.p.ID, id)
		}()
		go func() {
			defer wg.Done()
			errRecusar = c.g.Recusar(c.ctx, r, c.ana.p.ID, id)
		}()
		wg.Wait()
		var resposta string
		switch {
		case errAceitar == nil && errors.Is(errRecusar, ErrJaRespondido):
			resposta = "aceito"
		case errRecusar == nil && errors.Is(errAceitar, ErrJaRespondido):
			resposta = "recusado"
		default:
			t.Fatalf("rodada %d: Aceitar %v, Recusar %v", i, errAceitar, errRecusar)
		}
		tipos := can.tipos()
		if slices.Contains(tipos, "aceito") == slices.Contains(tipos, "recusado") || !slices.Contains(tipos, resposta) ||
			len(tipos) != 2 {
			t.Fatalf("rodada %d: o canal recebeu %q, e venceu o %s", i, tipos, resposta)
		}
		// A senha do aceito vence antes da rodada seguinte: a reunião não enche.
		c.agente.Avancar(31 * time.Second)
		c.g.Varrer()
	}
}

func TestPedido_DezMinutos(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	_, can := c.pedir(r, "Maria Lima")
	id := c.pedidoDe(r, c.ana, "Maria Lima")
	c.avisos.limpar()

	c.andar(10*time.Minute - time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"aguardando"}, false)
	c.andar(time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"aguardando", "recusado"}, true)
	evs := c.avisos.de(c.ana.computador)
	if len(evs) != 2 || !reflect.DeepEqual(evs[0], map[string]any{"tipo": "reuniaoPedidoFim", "reuniao": r.Codigo, "pedido": id}) ||
		!reflect.DeepEqual(evs[1]["pedidos"], lista()) {
		t.Fatalf("a Ana recebeu %v", evs)
	}
	conferirErro(t, "Aceitar o vencido", c.g.Aceitar(c.ctx, r, c.ana.p.ID, id), ErrJaRespondido)

	t.Run("vencido no meio de duas rodadas do Varrer", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		_, can := c.pedir(r, "Maria Lima")
		id := c.pedidoDe(r, c.ana, "Maria Lima")
		c.andar(10 * time.Minute)
		conferirErro(t, "Aceitar com 10 minutos", c.g.Aceitar(c.ctx, r, c.ana.p.ID, id), ErrJaRespondido)
		can.conferir(t, "Maria", []string{"aguardando", "recusado"}, true)
	})
}

func TestPedido_SoQuemEstaNaReuniao(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	c.pedir(r, "Maria Lima")
	id := c.pedidoDe(r, c.ana, "Maria Lima")
	c.entrar(r, c.carlos) // o Carlos tem a senha, mas a câmera dele ainda não entrou

	fora := func(oque string, err error) {
		t.Helper()
		conferirErro(t, oque, err, ErrForaDaReuniao)
	}
	carlos := c.carlos.p.ID
	fora("Aceitar", c.g.Aceitar(c.ctx, r, carlos, id))
	fora("Recusar", c.g.Recusar(c.ctx, r, carlos, id))
	_, err := c.g.Lista(r, carlos)
	fora("Lista", err)
	fora("Tirar", c.g.Tirar(c.ctx, r, carlos, ana))
	fora("Encerrar", c.g.Encerrar(c.ctx, r, carlos))
	_, err = c.g.Tela(c.ctx, r, carlos)
	fora("Tela", err)
	// A Ana, numa reunião em que não está, também não.
	_, err = c.g.Lista(c.marcada(), c.ana.p.ID)
	fora("a Lista de outra reunião", err)
	if cmds := c.video.Comandos(); len(cmds) != 0 {
		t.Fatalf("o agente recebeu %q", cmds)
	}
	// O pedido de quem está fora continua lá, e um que não existe dá 404.
	if got := c.pedidoDe(r, c.ana, "Maria Lima"); got != id {
		t.Fatal("o pedido mudou")
	}
	conferirErro(t, "Aceitar o que não existe", c.g.Aceitar(c.ctx, r, c.ana.p.ID, "0011223344556677"), ErrPedidoNaoEncontrado)
	conferirErro(t, "Recusar o que não existe", c.g.Recusar(c.ctx, r, c.ana.p.ID, "0011223344556677"), ErrPedidoNaoEncontrado)
}

func TestPedido_Desistir(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	p, can := c.pedir(r, "Maria Lima")
	id := c.pedidoDe(r, c.ana, "Maria Lima")
	c.avisos.limpar()

	c.g.Desistir(p)
	can.conferir(t, "Maria", []string{"aguardando"}, false)
	evs := c.avisos.de(c.ana.computador)
	if len(evs) != 2 || !reflect.DeepEqual(evs[0], map[string]any{"tipo": "reuniaoPedidoFim", "reuniao": r.Codigo, "pedido": id}) ||
		!reflect.DeepEqual(evs[1]["pedidos"], lista()) {
		t.Fatalf("a Ana recebeu %v", evs)
	}
	conferirErro(t, "Aceitar o retirado", c.g.Aceitar(c.ctx, r, c.ana.p.ID, id), ErrJaRespondido)
	if nomes := nomesNaMemoria(c.g); slices.Contains(nomes, "Maria Lima") {
		t.Fatalf("o gerente ainda guarda %q", nomes)
	}

	// Antes de a reunião começar, ninguém sabia do pedido: o Desistir não avisa ninguém.
	r2 := c.marcada()
	p2, can2 := c.pedir(r2, "Bia Ramos")
	c.avisos.limpar()
	c.g.Desistir(p2)
	c.g.Desistir(p2)
	c.g.Desistir(nil)
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos", n)
	}
	c.dentro(r2, c.carlos)
	if l, err := c.g.Lista(r2, c.carlos.p.ID); err != nil || len(l.Pedidos) != 0 {
		t.Fatalf("Lista = %+v, %v", l, err)
	}
	can2.conferir(t, "Bia", []string{"naoComecou"}, false)
}

func TestPedido_DesistirDepoisDoAceito(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	bia, pb, _ := c.aceito(r, c.ana, "Bia Ramos") // aceita, e ainda fora
	c.avisos.limpar()

	// Fechar a página depois do aceito não tira ninguém.
	c.g.Desistir(pm)
	c.g.Desistir(pb)
	if cmds := c.video.Comandos(); len(cmds) != 0 {
		t.Fatalf("o agente recebeu %q", cmds)
	}
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos", n)
	}
	c.entrou(r, bia) // a senha da Bia continua valendo
	l, err := c.g.Lista(r, c.ana.p.ID)
	if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(ana, "Ana Souza", false, false),
		pv(maria, "Maria Lima", true, false), pv(bia, "Bia Ramos", true, false))) {
		t.Fatalf("Lista = %+v, %v", l, err)
	}
}

func TestPedido_ReuniaoParaEVolta(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	_, can := c.pedir(r, "Maria Lima")
	c.andar(5 * time.Minute)
	c.acabou(r) // a marcada para: todos saíram de uma vez
	can.conferir(t, "Maria", []string{"aguardando", "naoComecou"}, false)

	// Parada, ela espera sem limite.
	c.andar(time.Hour)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"aguardando", "naoComecou"}, false)

	// Recomeça: o pedido volta aos colegas, com 10 minutos de novo.
	c.dentro(r, c.ana)
	can.conferir(t, "Maria", []string{"aguardando", "naoComecou", "aguardando"}, false)
	if got := c.avisos.ultimo(c.ana.computador, "reuniaoPedido"); got == nil {
		t.Fatal("a Ana não recebeu o pedido de novo")
	}
	c.andar(10*time.Minute - time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"aguardando", "naoComecou", "aguardando"}, false)
	c.andar(time.Millisecond)
	c.g.Varrer()
	can.conferir(t, "Maria", []string{"aguardando", "naoComecou", "aguardando", "recusado"}, true)

	t.Run("o último colega sai, e quem é de fora fica", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		ana := c.dentro(r, c.ana)
		maria, _, _ := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		_, can := c.pedir(r, "Bia Ramos")
		c.saiu(r, ana)
		// Sem colega na reunião, ninguém responde: o pedido volta a esperar sem limite.
		can.conferir(t, "Bia", []string{"aguardando", "naoComecou"}, false)
		if ac, n := c.g.Contagem(r.Sala); !ac || n != 1 {
			t.Fatalf("Contagem = %v, %d", ac, n)
		}
		c.andar(time.Hour)
		c.g.Varrer()
		can.conferir(t, "Bia", []string{"aguardando", "naoComecou"}, false)
		c.dentro(r, c.carlos)
		can.conferir(t, "Bia", []string{"aguardando", "naoComecou", "aguardando"}, false)
	})
}

func TestPedido_AceitarCheia(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	_, can := c.pedir(r, "Maria Lima")
	id := c.pedidoDe(r, c.ana, "Maria Lima")
	var parts []string
	for i := 1; i <= 9; i++ {
		parts = append(parts, c.dentro(r, c.colega(fmt.Sprint(2100+i), fmt.Sprintf("Colega %d", i))))
	}
	conferirErro(t, "Aceitar com 10 na reunião", c.g.Aceitar(c.ctx, r, c.ana.p.ID, id), ErrCheia)
	can.conferir(t, "Maria", []string{"aguardando"}, false)
	if got := c.pedidoDe(r, c.ana, "Maria Lima"); got != id {
		t.Fatal("o pedido saiu da lista")
	}
	c.saiu(r, parts[0])
	if err := c.g.Aceitar(c.ctx, r, c.ana.p.ID, id); err != nil {
		t.Fatalf("Aceitar com 9: %v", err)
	}
	can.conferir(t, "Maria", []string{"aguardando", "aceito"}, false)
}

func TestPedido_NomeInvalido(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	c.avisos.limpar()
	for _, nome := range []string{"", "   ", strings.Repeat("a", 81), "Ana\u0007"} {
		can := &canalFalso{}
		_, err := c.g.Pedir(c.ctx, r, nome, can)
		var e *regras.Erro
		if !errors.As(err, &e) || e.Campo != "nome" {
			t.Fatalf("Pedir(%q): %v; queria o erro do campo nome", nome, err)
		}
		can.conferir(t, fmt.Sprintf("%q", nome), nil, false)
	}
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos", n)
	}
}

// TestPedido_OrdemDasMensagens: as mensagens saem depois de soltar o mutex, mas na ordem em que o estado mudou. Com
// dois colegas entrando e saindo ao mesmo tempo, cada mensagem de uma página é uma mudança dela (o pedido chega aos
// colegas, ou volta à espera): elas se alternam, sem duas iguais seguidas, e a última é a que vale no fim.
func TestPedido_OrdemDasMensagens(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	// A Ana e o Carlos com a senha da tela pendente: saindo, eles ficam na memória e entram de novo com o mesmo
	// participante, sem o banco no meio.
	colegas := []string{c.dentro(r, c.ana), c.dentro(r, c.carlos)}
	for _, k := range []colega{c.ana, c.carlos} {
		if _, err := c.g.Tela(c.ctx, r, k.p.ID); err != nil {
			t.Fatal(err)
		}
	}
	canais := make([]*canalFalso, 20)
	for i := range canais {
		_, canais[i] = c.pedir(r, fmt.Sprintf("Visitante %d", i))
	}
	var wg sync.WaitGroup
	for _, part := range colegas {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 200 {
				c.g.EventoDoVideo(video.Evento{Tipo: "saiu", Sala: r.Sala, Participante: part})
				c.g.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: part})
			}
		}()
	}
	wg.Wait()
	for i, can := range canais {
		tipos := can.tipos()
		for j := 1; j < len(tipos); j++ {
			if tipos[j] == tipos[j-1] {
				t.Fatalf("o canal %d recebeu dois %q seguidos, nas mensagens %d e %d de %d", i, tipos[j], j-1, j, len(tipos))
			}
		}
		if tipos[len(tipos)-1] != "aguardando" {
			t.Fatalf("o canal %d terminou com %q", i, tipos)
		}
	}
}

func TestTeste_EntraDireto(t *testing.T) {
	c := novaCena(t)
	tst := c.deTeste()
	_, can := c.pedir(tst, "Maria Lima")
	can.conferir(t, "Maria", []string{"aceito"}, false)
	maria, senha := aceitoDe(t, can)
	s := lerSenha(t, senha)
	quer := video.Senha{V: 1, Sala: tst.Sala, Participante: maria, Papel: video.Colega, Nome: "Maria Lima",
		Vence: 1794488430000, ID: s.ID}
	if s != quer {
		t.Fatalf("a senha é %+v\nqueria %+v", s, quer)
	}
	// A segunda pessoa também entra direto, e ninguém é avisado: não há sala de espera.
	_, can2 := c.pedir(tst, "Bia Ramos")
	can2.conferir(t, "Bia", []string{"aceito"}, false)
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("%d avisos", n)
	}

	// Ela conta no limite: com ela começando e uma marcada acontecendo, a terceira reunião não começa.
	a, b := c.marcada(), c.marcada()
	c.dentro(a, c.ana)
	_, err := c.g.EntrarColega(c.ctx, b, c.carlos.p, c.carlos.computador)
	conferirErro(t, "a terceira", err, ErrServidorCheio)
	c.entrou(tst, maria)
	if ac, n := c.g.Contagem(tst.Sala); !ac || n != 1 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
}

func TestNovaSenha(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	p, can := c.pedir(r, "Maria Lima")
	_, err := c.g.NovaSenha(p)
	conferirErro(t, "antes do aceito", err, ErrForaDeOrdem)
	if err := c.g.Aceitar(c.ctx, r, c.ana.p.ID, c.pedidoDe(r, c.ana, "Maria Lima")); err != nil {
		t.Fatal(err)
	}
	maria, _ := aceitoDe(t, can)

	// A senha venceu (a pessoa demorou): ela pede outra, com o mesmo participante, até 5 por minuto.
	c.andar(31 * time.Second)
	c.g.Varrer()
	for i := 1; i <= 5; i++ {
		senha, err := c.g.NovaSenha(p)
		if err != nil {
			t.Fatalf("a %dª senha nova: %v", i, err)
		}
		s := lerSenha(t, senha)
		quer := video.Senha{V: 1, Sala: r.Sala, Participante: maria, Papel: video.Fora, Nome: "Maria Lima",
			Vence: inicioTeste.Add(61 * time.Second).UnixMilli(), ID: s.ID}
		if s != quer {
			t.Fatalf("a %dª senha nova é %+v\nqueria %+v", i, s, quer)
		}
	}
	_, err = c.g.NovaSenha(p)
	conferirErro(t, "a 6ª no minuto", err, ErrLimite)
	c.andar(time.Minute)
	if _, err := c.g.NovaSenha(p); err != nil {
		t.Fatalf("um minuto depois: %v", err)
	}

	// Na reunião, não: a senha nova é para quem ainda está fora dela.
	c.entrou(r, maria)
	_, err = c.g.NovaSenha(p)
	conferirErro(t, "na reunião", err, ErrForaDeOrdem)
	// A ligação caiu: pode de novo.
	c.saiu(r, maria)
	if _, err := c.g.NovaSenha(p); err != nil {
		t.Fatalf("depois de sair: %v", err)
	}
	c.video.DefinirNoAr(false)
	_, err = c.g.NovaSenha(p)
	conferirErro(t, "com o FreeSWITCH fora", err, ErrSemServidor)
}
