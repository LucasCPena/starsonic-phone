package admin_test

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

func TestTirarPessoa(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	kAna1, kAna2 := p.a.Ligar(e.Codigo, "NOTE-ANA"), p.a.Ligar(e.Codigo, "CASA-ANA")
	kBia, kCarlos := p.a.Ligar(e.Codigo, "FIN-01"), p.a.Ligar(e.Codigo, "COMERCIAL-03")
	kAbel := p.a.Ligar(outra.Codigo, "PC-ABEL")
	ana := p.a.Entrar(kAna1, "2003", "Ana Souza")
	p.a.Entrar(kAna2, "2003", "Ana Souza")
	bia := p.a.Entrar(kBia, "3004", "Beatriz Ramos")
	carlos := p.a.Entrar(kCarlos, "2011", "Carlos Lima")
	abel := p.a.Entrar(kAbel, "2003", "Abel")
	grupo := criarConversa(t, p.a, kAna1, map[string]any{"tipo": "grupo", "nome": "Comercial", "pessoas": []int64{bia.ID, carlos.ID}})
	enviarTexto(t, p.a, kAna1, grupo, "m-1", "Bom dia")
	cAna1, cAna2 := p.a.Conectar(kAna1), p.a.Conectar(kAna2)
	cBia, cCarlos := p.a.Conectar(kBia), p.a.Conectar(kCarlos)

	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	_, corpo := n.get(pagina)
	tirar := fmt.Sprintf("%s/pessoas/%d/tirar", pagina, ana.ID)
	if !strings.Contains(corpo, `action="`+tirar+`"`) || !strings.Contains(corpo, `aria-label="Tirar Ana Souza do chat"`) {
		t.Fatalf("a página não tem o Tirar do chat da Ana:\n%s", corpo)
	}
	resp, _ := n.acao(tirar, nil)
	esperarIr(t, resp, pagina)

	// Os computadores dela recebem o fora, fecham com 4001 e a chave deixa de valer.
	esperarFora(t, cAna1)
	esperarFora(t, cAna2)
	for _, k := range []string{kAna1, kAna2} {
		esperarErroAPI(t, p.a.Pedir(k, "GET", "/api/v1/conversas", nil), http.StatusUnauthorized, "chave")
	}
	// Quem fica no grupo recebe o grupo com as pessoas novas (a Beatriz, que entrou junto
	// com o Carlos e tem o menor id, passa a cuidar) e depois o aviso saiu da Ana.
	for _, x := range []struct {
		nome  string
		c     *websocket.Conn
		cuida bool
	}{{"Beatriz", cBia, true}, {"Carlos", cCarlos, false}} {
		ev := apitest.LerEvento[evento](t, x.c)
		if ev.Tipo != "conversa" || ev.Conversa.ID != grupo || ev.Conversa.Pessoas != 2 || ev.Conversa.Cuida != x.cuida {
			t.Fatalf("%s: o primeiro evento = %+v", x.nome, ev)
		}
		ev = apitest.LerEvento[evento](t, x.c)
		av := ev.Mensagem.Aviso
		if ev.Tipo != "mensagem" || av == nil || av.Acao != "saiu" || av.Quem.ID != ana.ID || !av.Quem.Saiu || av.Alvo != nil {
			t.Fatalf("%s: o segundo evento = %+v", x.nome, ev)
		}
	}
	// As mensagens dela continuam, com autor.saiu.
	resp = p.a.Pedir(kBia, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens", grupo), nil)
	esperarAPI(t, resp, http.StatusOK)
	var achou bool
	for _, m := range apitest.LerJSON[struct{ Mensagens []mensagem }](t, resp).Mensagens {
		if m.Tipo == "texto" && m.Texto == "Bom dia" {
			achou = m.Autor != nil && m.Autor.ID == ana.ID && m.Autor.Saiu
		}
	}
	if !achou {
		t.Fatal("a mensagem da Ana não veio com autor.saiu")
	}
	// A página não mostra mais a Ana.
	if _, corpo := n.get(pagina); strings.Contains(corpo, "Ana Souza") {
		t.Fatalf("a página ainda mostra a Ana:\n%s", corpo)
	}
	// O mesmo ramal, num computador novo, vira uma pessoa nova.
	nova := p.a.Entrar(p.a.Ligar(e.Codigo, "NOTE-NOVO"), "2003", "Ana Souza")
	if nova.ID == ana.ID || nova.Saiu {
		t.Fatalf("a pessoa nova = %+v; a tirada era %d", nova, ana.ID)
	}
	// A pessoa de outra empresa, pela página desta: 404, e nada muda.
	resp, corpo = n.acao(fmt.Sprintf("%s/pessoas/%d/tirar", pagina, abel.ID), nil)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	esperarAPI(t, p.a.Pedir(kAbel, "GET", "/api/v1/conversas", nil), http.StatusOK)
}

func TestTirarComputador(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	k1, k2 := p.a.Ligar(e.Codigo, "NOTE-ANA"), p.a.Ligar(e.Codigo, "CASA-ANA")
	kAbel := p.a.Ligar(outra.Codigo, "PC-ABEL")
	p.a.Entrar(k1, "2003", "Ana Souza")
	p.a.Entrar(k2, "2003", "Ana Souza")
	c1, c2 := p.a.Conectar(k1), p.a.Conectar(k2)

	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	_, corpo := n.get(pagina)
	tirar := fmt.Sprintf("%s/computadores/%d/tirar", pagina, idDoComputador(p, "NOTE-ANA"))
	if !strings.Contains(corpo, `action="`+tirar+`"`) || !strings.Contains(corpo, `aria-label="Tirar o computador NOTE-ANA do chat"`) {
		t.Fatalf("a página não tem o × do NOTE-ANA:\n%s", corpo)
	}
	resp, _ := n.acao(tirar, nil)
	esperarIr(t, resp, pagina)

	// Só esse computador sai; o outro da mesma pessoa continua.
	esperarFora(t, c1)
	esperarErroAPI(t, p.a.Pedir(k1, "GET", "/api/v1/conversas", nil), http.StatusUnauthorized, "chave")
	esperarAPI(t, p.a.Pedir(k2, "GET", "/api/v1/conversas", nil), http.StatusOK)
	apitest.SemEvento(t, c2, 150*time.Millisecond)
	_, corpo = n.get(pagina)
	if strings.Contains(corpo, "NOTE-ANA") || !strings.Contains(corpo, "CASA-ANA") || !strings.Contains(corpo, "Ana Souza") {
		t.Fatalf("a página depois de tirar o NOTE-ANA:\n%s", corpo)
	}
	// O computador de outra empresa, pela página desta: 404, e ele continua.
	resp, corpo = n.acao(fmt.Sprintf("%s/computadores/%d/tirar", pagina, idDoComputador(p, "PC-ABEL")), nil)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	p.a.Entrar(kAbel, "2003", "Abel")
}

// ultimaVezNaLinha lê, na tabela de pessoas da página da empresa, a ÚLTIMA VEZ da linha da
// pessoa e o title ("Última vez: …") do primeiro computador dela.
func ultimaVezNaLinha(t *testing.T, corpo, nome string) (ultima, computador string) {
	t.Helper()
	m := regexp.MustCompile(`(?s)<td class="forte">` + regexp.QuoteMeta(nome) + `</td>(.*?)<td class="suave">([^<]*)</td>`).
		FindStringSubmatch(corpo)
	if m == nil {
		t.Fatalf("a página não tem a linha de %s:\n%s", nome, corpo)
	}
	c := regexp.MustCompile(`title="Última vez: ([^"]*)"`).FindStringSubmatch(m[1])
	if c == nil {
		t.Fatalf("a linha de %s não tem computador:\n%s", nome, m[0])
	}
	return m[2], c[1]
}

// TestUltimaVezDaPessoa: a ÚLTIMA VEZ de uma pessoa é a dela nos computadores, não a do
// computador. A Ana usou a RECEPCAO-02 ontem às 18:02; hoje às 09:40, a Recepção entra nela. A
// linha da Ana mostra "ontem, 18:02", e a da Recepção, "hoje, 09:40"; o title da RECEPCAO-02,
// em cada linha, é a vez daquela pessoa nela.
func TestUltimaVezDaPessoa(t *testing.T) {
	p := novoPainel(t)
	rel := p.a.Relogio
	e := p.a.Empresa("ACME Comércio Ltda")
	rel.Definir(time.Date(2026, 11, 3, 21, 2, 0, 0, time.UTC)) // ontem, 18:02 em Brasília
	k := p.a.Ligar(e.Codigo, "RECEPCAO-02")
	p.a.Entrar(k, "2003", "Ana Souza")
	rel.Definir(time.Date(2026, 11, 4, 12, 40, 0, 0, time.UTC)) // hoje, 09:40
	p.a.Entrar(k, "2001", "Recepção")
	rel.Definir(time.Date(2026, 11, 4, 12, 43, 0, 0, time.UTC))
	_, corpo := p.logado(t).get(fmt.Sprintf("/admin/empresas/%d", e.ID))
	for nome, vez := range map[string]string{"Ana Souza": "ontem, 18:02", "Recepção": "hoje, 09:40"} {
		ultima, computador := ultimaVezNaLinha(t, corpo, nome)
		if ultima != vez || computador != vez {
			t.Errorf("a linha de %s mostra %q, e o title da RECEPCAO-02 %q; queria %q nos dois", nome, ultima, computador, vez)
		}
	}
}

func TestHorasDeBrasilia(t *testing.T) {
	p := novoPainel(t)
	rel := p.a.Relogio
	e := p.a.Empresa("ACME Comércio Ltda")
	for _, x := range []struct{ quando, pc, ramal, nome string }{
		{"2026-11-01T15:00:00Z", "PC-DIA-1", "2001", "Pessoa Um"},
		{"2026-11-03T21:02:00Z", "PC-ONTEM", "2002", "Pessoa Dois"},
		{"2026-11-04T12:43:00Z", "PC-HOJE", "2003", "Pessoa Três"},
	} {
		quando, err := time.Parse(time.RFC3339, x.quando)
		if err != nil {
			t.Fatal(err)
		}
		rel.Definir(quando)
		p.a.Entrar(p.a.Ligar(e.Codigo, x.pc), x.ramal, x.nome)
	}
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	_, corpo := p.logado(t).get(pagina) // às 12:43Z
	for _, s := range []string{"hoje, 09:43", "ontem, 18:02", "01/11/2026"} {
		if !strings.Contains(corpo, s) {
			t.Fatalf("a página não mostra %q:\n%s", s, corpo)
		}
	}
	for _, s := range []string{"12:43", "21:02", "15:00"} {
		if strings.Contains(corpo, s) {
			t.Fatalf("a página mostra a hora UTC %q:\n%s", s, corpo)
		}
	}

	// 02:30Z do dia 5 ainda é dia 4 em Brasília (23:30): o de 12:43Z continua "hoje". Uma
	// empresa criada agora entra no dia 4.
	rel.Definir(time.Date(2026, 11, 5, 2, 30, 0, 0, time.UTC))
	p.a.Empresa("Clínica Vida")
	n := p.logado(t)
	_, corpo = n.get(pagina)
	for _, s := range []string{"hoje, 09:43", "ontem, 18:02", "01/11/2026"} {
		if !strings.Contains(corpo, s) {
			t.Fatalf("às 23:30 de Brasília, a página não mostra %q:\n%s", s, corpo)
		}
	}
	_, corpo = n.get("/admin/")
	if !strings.Contains(corpo, "04/11/2026") || strings.Contains(corpo, "05/11/2026") {
		t.Fatalf("a lista com a data em UTC:\n%s", corpo)
	}
}
