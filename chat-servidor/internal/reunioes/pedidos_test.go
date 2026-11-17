package reunioes

import (
	"database/sql"
	"encoding/base64"
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
		[]string{"participante", "senha", "tipo", "turn", "video", "volta"}) {
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

	c.g.Desistir(p, can)
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
	c.g.Desistir(p2, can2)
	c.g.Desistir(p2, can2)
	c.g.Desistir(nil, nil)
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
	maria, pm, canM := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	bia, pb, canB := c.aceito(r, c.ana, "Bia Ramos") // aceita, e ainda fora
	c.avisos.limpar()

	// Fechar a página depois do aceito não tira ninguém.
	c.g.Desistir(pm, canM)
	c.g.Desistir(pb, canB)
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

// A sala de espera de uma reunião guarda até 50 pedidos (a revisão final, M2). O 51º recebe o ErrEsperaCheia: não
// espera, não chega aos colegas e o nome não fica na memória. Quando um pedido sai, um novo espera normalmente.
func TestPedido_EsperaCheia(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	var pedidos []*Pedido
	var canais []*canalFalso
	for i := range 50 {
		p, can := c.pedir(r, fmt.Sprintf("Visitante %d", i))
		can.conferir(t, fmt.Sprintf("o pedido %d", i), []string{"aguardando"}, false)
		pedidos = append(pedidos, p)
		canais = append(canais, can)
	}
	c.avisos.limpar()

	can := &canalFalso{}
	p, err := c.g.Pedir(c.ctx, r, "Bia Ramos", can)
	conferirErro(t, "o 51º pedido", err, ErrEsperaCheia)
	if p != nil {
		t.Fatal("o 51º pedido voltou um Pedido")
	}
	can.conferir(t, "o 51º pedido", nil, false)
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("o 51º pedido mandou %d avisos", n)
	}
	if slices.Contains(nomesNaMemoria(c.g), "Bia Ramos") {
		t.Fatal("o nome do 51º pedido ficou na memória")
	}

	// Um pedido sai (a página fechou), e o novo espera.
	c.g.Desistir(pedidos[0], canais[0])
	_, can = c.pedir(r, "Bia Ramos")
	can.conferir(t, "Bia", []string{"aguardando"}, false)
	c.pedidoDe(r, c.ana, "Bia Ramos")
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

	// Na reunião, também: a ligação caiu e a página quer ligar de novo, antes de o agente dar por perdida a antiga.
	// O limite de 5 por minuto é o mesmo.
	c.andar(time.Minute)
	c.entrou(r, maria)
	if _, err := c.g.NovaSenha(p); err != nil {
		t.Fatalf("na reunião: %v", err)
	}
	for i := 2; i <= 5; i++ {
		if _, err := c.g.NovaSenha(p); err != nil {
			t.Fatalf("a %dª na reunião: %v", i, err)
		}
	}
	_, err = c.g.NovaSenha(p)
	conferirErro(t, "a 6ª na reunião", err, ErrLimite)
	c.andar(time.Minute)
	// A ligação caiu de vez: pode de novo.
	c.saiu(r, maria)
	if _, err := c.g.NovaSenha(p); err != nil {
		t.Fatalf("depois de sair: %v", err)
	}
	c.video.DefinirNoAr(false)
	_, err = c.g.NovaSenha(p)
	conferirErro(t, "com o FreeSWITCH fora", err, ErrSemServidor)

	t.Run("a ordem vem antes do banco e do servidor", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		espera, _ := c.pedir(r, "Bia Ramos")
		_, aceita, _ := c.aceito(r, c.ana, "Maria Lima")
		c.g.Ligar(nil)
		c.b.Fechar() // nenhuma leitura do banco pode esconder a resposta
		_, err := c.g.NovaSenha(espera)
		conferirErro(t, "fora de ordem, sem servidor", err, ErrForaDeOrdem)
		_, err = c.g.NovaSenha(aceita)
		conferirErro(t, "na ordem, sem servidor", err, ErrSemServidor)
	})
	t.Run("quem entra enquanto o banco responde ainda ganha a senha", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
		// O banco ocupado (uma conexão só) segura o NovaSenha entre a primeira conferência e a segunda, e a Maria
		// entra nesse meio. Se ele demorar a chegar ao banco, a primeira já responde o mesmo.
		ocupado, liberar := make(chan struct{}), make(chan struct{})
		go c.b.Tx(c.ctx, func(*sql.Tx) error {
			close(ocupado)
			<-liberar
			return nil
		})
		<-ocupado
		resposta := make(chan error, 1)
		go func() {
			_, err := c.g.NovaSenha(pm)
			resposta <- err
		}()
		time.Sleep(50 * time.Millisecond)
		c.entrou(r, maria)
		close(liberar)
		if err := <-resposta; err != nil {
			t.Fatalf("a senha de quem entrou no meio: %v", err)
		}
	})
	t.Run("na reunião cheia, quem está nela ainda ganha a senha", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		for i := 1; i <= 8; i++ {
			c.dentro(r, c.colega(fmt.Sprint(2100+i), fmt.Sprintf("Colega %d", i)))
		}
		if _, n := c.g.Contagem(r.Sala); n != 10 {
			t.Fatalf("a reunião tem %d pessoas; queria 10", n)
		}
		if _, err := c.g.NovaSenha(pm); err != nil {
			t.Fatalf("NovaSenha na reunião de 10: %v", err)
		}
		if _, n := c.g.Contagem(r.Sala); n != 10 {
			t.Fatalf("depois da senha, %d pessoas; queria 10", n)
		}
	})
	t.Run("depois do tirar, a senha nova não vale", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
			t.Fatal(err)
		}
		_, err := c.g.NovaSenha(pm)
		conferirErro(t, "depois do tirar", err, ErrForaDeOrdem)
	})
}

func TestTeste_SenhaPendenteFicaNoAcabou(t *testing.T) {
	// Na reunião de teste, todos entram com a senha de colega, que pode começar a reunião: quem foi aceito e ainda não
	// entrou fica quando o último sai (o acabou), e entra com a senha que tem.
	c := novaCena(t)
	tst := c.deTeste()
	_, canMaria := c.pedir(tst, "Maria Lima")
	maria, _ := aceitoDe(t, canMaria)
	c.entrou(tst, maria)
	pb, canBia := c.pedir(tst, "Bia Ramos")
	bia, _ := aceitoDe(t, canBia)
	c.saiu(tst, maria)
	c.acabou(tst)
	canBia.conferir(t, "Bia", []string{"aceito"}, false)

	c.entrou(tst, bia)
	if ac, n := c.g.Contagem(tst.Sala); !ac || n != 1 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
	senha, err := c.g.TelaDeFora(pb)
	if err != nil {
		t.Fatalf("a tela da Bia, na reunião: %v", err)
	}
	if s := lerSenha(t, senha); s.Participante != bia || s.Nome != "Bia Ramos" || !s.Tela || s.Papel != video.Colega {
		t.Fatalf("a senha da tela da Bia é %+v", s)
	}
}

// ---------- O Voltar: a chave de volta da página ----------

// voltaDe é a chave de volta do último aceito ou voltou que o canal recebeu.
func voltaDe(t *testing.T, can *canalFalso) string {
	t.Helper()
	for _, m := range slices.Backward(can.mensagens()) {
		if m["tipo"] == "aceito" || m["tipo"] == "voltou" {
			v, _ := m["volta"].(string)
			anotar(v)
			return v
		}
	}
	t.Fatalf("o canal não recebeu a volta: %q", can.tipos())
	return ""
}

func TestVoltar_AceitoTrazAChave(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	_, _, can1 := c.aceito(r, c.ana, "Maria Lima")
	_, _, can2 := c.aceito(r, c.ana, "Bia Ramos")
	v1, v2 := voltaDe(t, can1), voltaDe(t, can2)
	for _, v := range []string{v1, v2} {
		if b, err := base64.RawURLEncoding.DecodeString(v); err != nil || len(v) != 43 || len(b) != 32 {
			t.Fatalf("a volta %q não é base64url de 32 bytes, sem preenchimento", v)
		}
	}
	if v1 == v2 {
		t.Fatal("dois aceitos com a mesma chave")
	}

	// O aceito imediato da reunião de teste também leva a chave.
	tst := c.deTeste()
	_, canT := c.pedir(tst, "Caio Dias")
	if vt := voltaDe(t, canT); len(vt) != 43 || vt == v1 || vt == v2 {
		t.Fatalf("a volta do aceito de teste é %q", vt)
	}
}

func TestVoltar_ChaveCertaGiraAChave(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	maria, p, can := c.aceito(r, c.ana, "Maria Lima")
	v1 := voltaDe(t, can)

	novo := &canalFalso{}
	got, v2, err := c.g.Voltar(r, maria, v1, novo)
	if err != nil || got != p {
		t.Fatalf("Voltar = %v, %v; queria o mesmo pedido", got, err)
	}
	if len(v2) != 43 || v2 == v1 {
		t.Fatalf("a chave nova é %q", v2)
	}
	if m := novo.mensagens(); len(m) != 1 || m[0]["tipo"] != "voltou" || m[0]["volta"] != v2 {
		t.Fatalf("o canal novo recebeu %v", m)
	}
	// A chave velha deixou de valer; a nova vale.
	_, _, err = c.g.Voltar(r, maria, v1, &canalFalso{})
	conferirErro(t, "a chave velha", err, ErrForaDeOrdem)
	if _, v3, err := c.g.Voltar(r, maria, v2, &canalFalso{}); err != nil || v3 == v2 {
		t.Fatalf("Voltar com a chave nova = %q, %v", v3, err)
	}
}

func TestVoltar_Recusas(t *testing.T) {
	t.Run("chave errada, vazia ou de outro", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		_, _, canBia := c.aceito(r, c.ana, "Bia Ramos")
		for _, v := range []string{"", "x", voltaDe(t, can)[1:], voltaDe(t, canBia)} {
			_, _, err := c.g.Voltar(r, maria, v, &canalFalso{})
			conferirErro(t, "a chave "+v, err, ErrForaDeOrdem)
		}
		// Os erros não gastam a chave.
		if _, _, err := c.g.Voltar(r, maria, voltaDe(t, can), &canalFalso{}); err != nil {
			t.Fatalf("Voltar com a chave certa: %v", err)
		}
	})
	t.Run("participante desconhecido", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		ana := c.dentro(r, c.ana)
		_, _, can := c.aceito(r, c.ana, "Maria Lima")
		_, _, err := c.g.Voltar(r, "0011223344556677", voltaDe(t, can), &canalFalso{})
		conferirErro(t, "desconhecido", err, ErrForaDeOrdem)
		// A colega está na memória, com participante e sem pedido: nem a chave de outra pessoa nem uma vazia valem.
		_, _, err = c.g.Voltar(r, ana, voltaDe(t, can), &canalFalso{})
		conferirErro(t, "colega com a chave de outro", err, ErrForaDeOrdem)
		_, _, err = c.g.Voltar(r, ana, "", &canalFalso{})
		conferirErro(t, "colega sem chave", err, ErrForaDeOrdem)
	})
	t.Run("pedido ainda esperando", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		_, can := c.pedir(r, "Maria Lima")
		id := c.pedidoDe(r, c.ana, "Maria Lima")
		_, _, err := c.g.Voltar(r, id, "", &canalFalso{})
		conferirErro(t, "esperando", err, ErrForaDeOrdem)
		can.conferir(t, "Maria", []string{"aguardando"}, false)
	})
	t.Run("participante tirado", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		v := voltaDe(t, can)
		c.entrou(r, maria)
		if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
			t.Fatal(err)
		}
		_, _, err := c.g.Voltar(r, maria, v, &canalFalso{})
		conferirErro(t, "tirado", err, ErrForaDeOrdem)
	})
	t.Run("participante varrido", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, p, can := c.aceito(r, c.ana, "Maria Lima") // aceita e nunca entra: a senha vence
		v := voltaDe(t, can)
		c.g.Desistir(p, can) // a página caiu
		c.andar(time.Hour)
		c.g.Varrer()
		_, _, err := c.g.Voltar(r, maria, v, &canalFalso{})
		conferirErro(t, "varrido", err, ErrForaDeOrdem)
	})
	t.Run("a chave de outra sala não vale", func(t *testing.T) {
		c := novaCena(t)
		r1, r2 := c.marcada(), c.marcada()
		c.dentro(r1, c.ana)
		maria, _, can := c.aceito(r1, c.ana, "Maria Lima")
		_, _, err := c.g.Voltar(r2, maria, voltaDe(t, can), &canalFalso{})
		conferirErro(t, "outra sala", err, ErrForaDeOrdem)
	})
}

func TestVoltar_ReuniaoAcabada(t *testing.T) {
	t.Run("cancelada", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		v := voltaDe(t, can)
		c.cancelar(r)
		_, _, err := c.g.Voltar(c.recarregar(r), maria, v, &canalFalso{})
		conferirErro(t, "cancelada", err, ErrLinkInvalido)
	})
	t.Run("vencida", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		v := voltaDe(t, can)
		c.andar(25 * time.Hour)
		_, _, err := c.g.Voltar(r, maria, v, &canalFalso{})
		conferirErro(t, "vencida", err, ErrLinkInvalido)
	})
	t.Run("naHora que acabou", func(t *testing.T) {
		c := novaCena(t)
		r := c.naHora()
		ana := c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		v := voltaDe(t, can)
		c.entrou(r, maria)
		c.saiu(r, maria)
		c.saiu(r, ana)
		c.acabou(r)
		_, _, err := c.g.Voltar(c.recarregar(r), maria, v, &canalFalso{})
		conferirErro(t, "naHora acabada", err, ErrLinkInvalido)
	})
}

func TestVoltar_CanalVelho(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	maria, p, velho := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	novo := &canalFalso{}
	if _, _, err := c.g.Voltar(r, maria, voltaDe(t, velho), novo); err != nil {
		t.Fatal(err)
	}
	// O canal velho ainda estava no pedido (o servidor não viu a queda): foi fechado.
	velho.conferir(t, "o canal velho", []string{"aguardando", "aceito"}, true)

	// A leitura do canal velho acaba depois, e o Desistir dela não solta o canal novo.
	c.g.Desistir(p, velho)
	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
		t.Fatal(err)
	}
	novo.conferir(t, "o canal novo", []string{"voltou", "tirado"}, true)
	velho.conferir(t, "o canal velho", []string{"aguardando", "aceito"}, true)

	// O Desistir do canal que ainda é o do pedido o solta, como antes.
	c2 := novaCena(t)
	r2 := c2.marcada()
	c2.dentro(r2, c2.ana)
	m2, p2, can2 := c2.aceito(r2, c2.ana, "Bia Ramos")
	c2.entrou(r2, m2)
	c2.g.Desistir(p2, can2)
	if err := c2.g.Tirar(c2.ctx, r2, c2.ana.p.ID, m2); err != nil {
		t.Fatal(err)
	}
	can2.conferir(t, "Bia", []string{"aguardando", "aceito"}, false)
}

func TestVoltar_DepoisDaVoltaAsSenhasFuncionam(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.dentro(r, c.ana)
	maria, p, can := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	if _, _, err := c.g.Voltar(r, maria, voltaDe(t, can), &canalFalso{}); err != nil {
		t.Fatal(err)
	}
	senha, err := c.g.NovaSenha(p)
	if err != nil {
		t.Fatalf("NovaSenha depois do Voltar: %v", err)
	}
	if s := lerSenha(t, senha); s.Participante != maria || s.Papel != video.Fora {
		t.Fatalf("a senha é %+v", s)
	}
	if _, err := c.g.TelaDeFora(p); err != nil {
		t.Fatalf("TelaDeFora depois do Voltar: %v", err)
	}
}
