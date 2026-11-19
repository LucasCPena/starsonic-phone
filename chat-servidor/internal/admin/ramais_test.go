package admin_test

import (
	"fmt"
	"html"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
)

// Os instantes dos testes do estado dos ramais, no horário de Brasília.
var (
	ontem1802 = time.Date(2026, 11, 3, 21, 2, 0, 0, time.UTC)  // ontem, 18:02
	hoje0943  = time.Date(2026, 11, 4, 12, 43, 0, 0, time.UTC) // hoje, 09:43
)

// entrarNoPC liga um computador da empresa e entra nele como a pessoa do ramal, sem abrir o
// canal dos eventos. Devolve a chave do computador.
func entrarNoPC(p *painel, e banco.Empresa, computador, ramal, nome string) string {
	p.a.T.Helper()
	k := p.a.Ligar(e.Codigo, computador)
	p.a.Entrar(k, ramal, nome)
	return k
}

// noCanal abre o canal dos eventos do computador da chave: daqui em diante ele está ligado ao
// chat.
func noCanal(p *painel, chave string) {
	p.a.T.Helper()
	p.a.Conectar(chave)
}

// dizRamal faz o computador dizer o estado do ramal, como o app.
func dizRamal(p *painel, chave, estado string, segundos int) {
	p.a.T.Helper()
	resp := p.a.Pedir(chave, "PUT", "/api/v1/computadores/eu/ramal", map[string]any{"estado": estado, "segundos": segundos})
	if resp.StatusCode != http.StatusNoContent {
		p.a.T.Fatalf("dizer o ramal (%s, %d s): status %d", estado, segundos, resp.StatusCode)
	}
}

// ligadoCom liga um computador, entra como a pessoa, abre o canal e, com um estado, diz o ramal.
func ligadoCom(p *painel, e banco.Empresa, computador, ramal, nome, estado string, segundos int) string {
	p.a.T.Helper()
	k := entrarNoPC(p, e, computador, ramal, nome)
	noCanal(p, k)
	if estado != "" {
		dizRamal(p, k, estado, segundos)
	}
	return k
}

// linhaDaPessoa devolve o HTML da linha da pessoa na tabela das pessoas (o <tr> dela).
func linhaDaPessoa(t *testing.T, corpo, nome string) string {
	t.Helper()
	re := regexp.MustCompile(`(?s)<tr>\s*<td class="forte">` + regexp.QuoteMeta(html.EscapeString(nome)) + `</td>.*?</tr>`)
	linha := re.FindString(corpo)
	if linha == "" {
		t.Fatalf("a página não tem a linha de %s:\n%s", nome, corpo)
	}
	return linha
}

var (
	reEstado  = regexp.MustCompile(`<td class="estado estado-([a-z-]+)">`)
	reNome    = regexp.MustCompile(`<span class="estado-nome">([^<]*)</span>`)
	reDetalhe = regexp.MustCompile(`<span class="estado-detalhe">([^<]*)</span>`)
	reConta   = regexp.MustCompile(`(?s)<span class="contagem contagem-([a-z-]+)">(?:<svg.*?</svg>)?([^<]*)</span>`)
	reContas  = regexp.MustCompile(`(?s)<div class="contagens">(.*?)</div>`)
)

// estadoNaLinha lê, na linha de uma pessoa, a classe da célula do estado, o nome do estado e a
// segunda linha.
func estadoNaLinha(t *testing.T, linha string) (classe, nome, detalhe string) {
	t.Helper()
	c, n, d := reEstado.FindStringSubmatch(linha), reNome.FindStringSubmatch(linha), reDetalhe.FindStringSubmatch(linha)
	if c == nil || n == nil || d == nil {
		t.Fatalf("a linha não tem a célula do estado inteira:\n%s", linha)
	}
	return c[1], n[1], html.UnescapeString(d[1])
}

// pcNaLinha lê, na linha de uma pessoa, a classe da bolinha do computador e o texto do estado
// dele para o leitor de tela.
func pcNaLinha(t *testing.T, linha, computador string) (classe, texto string) {
	t.Helper()
	re := regexp.MustCompile(`<span class="pc pc-([a-z-]+)" aria-hidden="true"></span>\s*<span>` +
		regexp.QuoteMeta(html.EscapeString(computador)) + `</span>\s*<span class="so-leitor">([^<]*)</span>`)
	m := re.FindStringSubmatch(linha)
	if m == nil {
		t.Fatalf("a linha não tem o computador %s com a bolinha e o texto do estado:\n%s", computador, linha)
	}
	return m[1], m[2]
}

// contasDe lê as contas de um trecho do HTML (o primeiro <div class="contagens"> dele), na ordem
// em que aparecem: "1 online", "1 sem registro"…
func contasDe(t *testing.T, trecho string) []string {
	t.Helper()
	bloco := reContas.FindStringSubmatch(trecho)
	if bloco == nil {
		t.Fatalf("o trecho não tem as contas:\n%s", trecho)
	}
	lista := []string{}
	for _, m := range reConta.FindAllStringSubmatch(bloco[1], -1) {
		texto := strings.TrimSpace(m[2])
		if !strings.HasSuffix(texto, strings.ReplaceAll(m[1], "-", " ")) {
			t.Fatalf("a conta %q tem a classe contagem-%s", texto, m[1])
		}
		lista = append(lista, texto)
	}
	return lista
}

func conferirContas(t *testing.T, onde, trecho string, quero ...string) {
	t.Helper()
	if got := contasDe(t, trecho); strings.Join(got, " | ") != strings.Join(quero, " | ") {
		t.Fatalf("%s: as contas são %q; queria %q", onde, got, quero)
	}
}

type esperado struct {
	pessoa, classe, nome, detalhe string
	pcs                           map[string]string // o computador e a classe da bolinha dele
}

// conferirPessoas confere a linha de cada pessoa na página da empresa.
func conferirPessoas(t *testing.T, corpo string, lista []esperado) {
	t.Helper()
	textoDoPC := map[string]string{"online": ", online", "sem-registro": ", sem registro", "no-chat": ", no chat", "offline": ", offline"}
	for _, e := range lista {
		linha := linhaDaPessoa(t, corpo, e.pessoa)
		classe, nome, detalhe := estadoNaLinha(t, linha)
		if classe != e.classe || nome != e.nome || detalhe != e.detalhe {
			t.Errorf("%s: estado-%s, %q, %q; queria estado-%s, %q, %q", e.pessoa, classe, nome, detalhe, e.classe, e.nome, e.detalhe)
		}
		for pc, quer := range e.pcs {
			if c, texto := pcNaLinha(t, linha, pc); c != quer || texto != textoDoPC[quer] {
				t.Errorf("%s, o computador %s: pc-%s e %q; queria pc-%s e %q", e.pessoa, pc, c, texto, quer, textoDoPC[quer])
			}
		}
	}
}

func paginaDaEmpresa(t *testing.T, p *painel, e banco.Empresa) (*http.Response, string) {
	t.Helper()
	resp, corpo := p.logado(t).get(fmt.Sprintf("/admin/empresas/%d", e.ID))
	esperarStatus(t, resp, corpo, http.StatusOK)
	return resp, corpo
}

// A tabela inteira da seção 4.2 da spec, numa página só: os quatro estados da pessoa, a segunda
// linha de cada um, a bolinha de cada computador, as contas, a legenda e a nota.
func TestEmpresa_Estados(t *testing.T) {
	p := novoPainel(t)
	rel := p.a.Relogio
	e := p.a.Empresa("ACME Comércio Ltda")

	// Ontem, às 18:02: a Ana usou a RECEPCAO-02, e depois a Recepção entrou nela. Ninguém abriu o canal.
	rel.Definir(ontem1802)
	kRec := entrarNoPC(p, e, "RECEPCAO-02", "2003", "Ana Souza")
	p.a.Entrar(kRec, "2001", "Recepção")

	rel.Definir(hoje0943)
	ligadoCom(p, e, "NOTE-ANA", "2003", "Ana Souza", "conectado", 7200)
	ligadoCom(p, e, "COMERCIAL-03", "2011", "Carlos Lima", "conectando", 720)
	ligadoCom(p, e, "FIN-01", "3004", "Beatriz Ramos", "erro", 20)
	ligadoCom(p, e, "COMERCIAL-01", "3002", "João Pereira", "", 0)

	resp, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{
		{"Ana Souza", "online", "Online", "há 2 h", map[string]string{"NOTE-ANA": "online", "RECEPCAO-02": "offline"}},
		{"Carlos Lima", "sem-registro", "Sem registro", "há 12 min · o app diz “Conectando…”", map[string]string{"COMERCIAL-03": "sem-registro"}},
		{"Beatriz Ramos", "no-chat", "No chat", "registrando o ramal…", map[string]string{"FIN-01": "no-chat"}},
		{"João Pereira", "no-chat", "No chat", "o app é antigo e não diz o ramal", map[string]string{"COMERCIAL-01": "no-chat"}},
		{"Recepção", "offline", "Offline", "última vez ontem, 18:02", map[string]string{"RECEPCAO-02": "offline"}},
	})
	conferirContas(t, "a página da empresa", corpo, "1 online", "1 sem registro", "2 no chat", "1 offline")

	for _, s := range []string{
		`data-ao-vivo="pessoas"`,
		">NOME<", ">RAMAL<", ">ESTADO<", ">COMPUTADORES<",
		"<strong>Online:</strong> o app está aberto e o ramal está registrado na central.",
		"<strong>Sem registro:</strong> o app está aberto, mas o ramal não registra há 1 minuto ou mais. É o caso para olhar.",
		"<strong>Offline:</strong> o chat perdeu o computador. O app foi fechado, o PC desligou ou a internet caiu.",
		"<strong>No chat:</strong> o app acabou de abrir e está registrando o ramal, ou é um app antigo, que ainda não diz como está o ramal.",
		`<span data-so-com-script hidden>Esta página se atualiza sozinha a cada 30 segundos. </span>Um PC que perde a rede pode levar até 2 minutos para aparecer offline. O celular e os aparelhos de mesa não aparecem aqui.`,
	} {
		if !strings.Contains(corpo, s) {
			t.Errorf("a página não tem %q", s)
		}
	}
	if strings.Contains(corpo, "ÚLTIMA VEZ") {
		t.Error("a página ainda tem a coluna ÚLTIMA VEZ")
	}
	// A legenda segue a ordem do quadro.
	ordem := []string{"<strong>Online:</strong>", "<strong>Sem registro:</strong>", "<strong>Offline:</strong>", "<strong>No chat:</strong>"}
	for i := 1; i < len(ordem); i++ {
		if strings.Index(corpo, ordem[i-1]) > strings.Index(corpo, ordem[i]) {
			t.Errorf("na legenda, %s vem depois de %s", ordem[i-1], ordem[i])
		}
	}
	// Nenhum estilo nem script dentro da página, com os quatro estados nela.
	conferirCabecalhos(t, "a página da empresa", resp, corpo)
	if t.Failed() {
		t.Logf("a página:\n%s", corpo)
	}
}

// Sem ninguém sem registro nem no chat, essas duas contas não aparecem.
func TestEmpresa_ContasSemAlerta(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	ligadoCom(p, e, "NOTE-ANA", "2003", "Ana Souza", "conectado", 60)
	entrarNoPC(p, e, "FIN-01", "3004", "Beatriz Ramos")
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirContas(t, "a página da empresa", corpo, "1 online", "1 offline")
	for _, s := range []string{"contagem-sem-registro", "contagem-no-chat"} {
		if strings.Contains(corpo, s) {
			t.Errorf("a página tem %q sem ninguém nesse estado", s)
		}
	}
}

// Um computador que duas pessoas usam só conta para a pessoa da vez dele.
func TestEmpresa_ComputadorCompartilhado(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	k := entrarNoPC(p, e, "RECEPCAO-02", "2003", "Ana Souza")
	p.a.Entrar(k, "2001", "Recepção")
	noCanal(p, k)
	dizRamal(p, k, "conectado", 300)
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{
		{"Recepção", "online", "Online", "há 5 min", map[string]string{"RECEPCAO-02": "online"}},
		{"Ana Souza", "offline", "Offline", "última vez hoje, 09:43", map[string]string{"RECEPCAO-02": "offline"}},
	})
	conferirContas(t, "a página da empresa", corpo, "1 online", "1 offline")
}

// Com mais de um computador registrado, vale o que está assim há mais tempo; com um registrado
// e outro fechado, a pessoa está online.
func TestEmpresa_DoisComputadores(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	ligadoCom(p, e, "NOTE-ANA", "2003", "Ana Souza", "conectado", 600)
	ligadoCom(p, e, "PC-ANA", "2003", "Ana Souza", "conectado", 7200)
	ligadoCom(p, e, "FIN-01", "3004", "Beatriz Ramos", "conectado", 2100)
	entrarNoPC(p, e, "FIN-02", "3004", "Beatriz Ramos") // fechado
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{
		{"Ana Souza", "online", "Online", "há 2 h", map[string]string{"NOTE-ANA": "online", "PC-ANA": "online"}},
		{"Beatriz Ramos", "online", "Online", "há 35 min", map[string]string{"FIN-01": "online", "FIN-02": "offline"}},
	})
	conferirContas(t, "a página da empresa", corpo, "2 online", "0 offline")
}

// Uma pessoa cujo único computador foi tirado do chat: offline, e sem "última vez" para mostrar.
func TestEmpresa_SemComputador(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	entrarNoPC(p, e, "NOTE-ANA", "2003", "Ana Souza")
	id := int64(p.a.Contar(`SELECT id FROM computadores WHERE nome = 'NOTE-ANA'`))
	if err := p.a.Banco.TirarComputador(t.Context(), e.ID, id); err != nil {
		t.Fatal(err)
	}
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{{"Ana Souza", "offline", "Offline", "sem computador no chat", nil}})
	conferirContas(t, "a página da empresa", corpo, "0 online", "1 offline")
}

// O maior tempo que o app pode mandar: um ano.
func TestEmpresa_UmAno(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	k := ligadoCom(p, e, "NOTE-ANA", "2003", "Ana Souza", "erro", 31536000)
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{{"Ana Souza", "sem-registro", "Sem registro", "há 365 dias · o app diz “Erro no cadastro”", nil}})

	// O relógio do servidor andou para trás depois do pedido do app: o tempo não fica negativo.
	dizRamal(p, k, "semConexao", 0)
	p.a.Relogio.Avancar(-5 * time.Second)
	_, corpo = paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{{"Ana Souza", "no-chat", "No chat", "registrando o ramal…", nil}})
	if strings.Contains(corpo, "há -") {
		t.Fatalf("a página mostra um tempo negativo:\n%s", corpo)
	}
}

// Os nomes vêm do app: nos lugares novos da página, eles aparecem escritos, e não viram HTML.
func TestEmpresa_NomesComSinais(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	ligadoCom(p, e, `<i>PC</i>`, "2003", `<b>&"Zé"`, "erro", 720)
	resp, corpo := paginaDaEmpresa(t, p, e)
	for _, s := range []string{`&lt;b&gt;&amp;&#34;Zé&#34;`, `&lt;i&gt;PC&lt;/i&gt;`} {
		if !strings.Contains(corpo, s) {
			t.Errorf("a página não tem %q", s)
		}
	}
	for _, cru := range []string{`<b>&`, `<i>PC`} {
		if strings.Contains(corpo, cru) {
			t.Errorf("a página tem %q sem escapar", cru)
		}
	}
	conferirPessoas(t, corpo, []esperado{{`<b>&"Zé"`, "sem-registro", "Sem registro", "há 12 min · o app diz “Erro no cadastro”",
		map[string]string{`<i>PC</i>`: "sem-registro"}}})
	conferirCabecalhos(t, "a página da empresa", resp, corpo)
	if t.Failed() {
		t.Logf("a página:\n%s", corpo)
	}
}

// Quando o canal fecha, a pessoa passa a offline na próxima vez em que a página é montada.
func TestEmpresa_QuemFechaOApp(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa("ACME Comércio Ltda")
	k := entrarNoPC(p, e, "NOTE-ANA", "2003", "Ana Souza")
	canal := p.a.Conectar(k)
	dizRamal(p, k, "conectado", 60)
	_, corpo := paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{{"Ana Souza", "online", "Online", "há 1 min", nil}})

	canal.CloseNow()
	id := int64(p.a.Contar(`SELECT id FROM computadores WHERE nome = 'NOTE-ANA'`))
	for prazo := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if _, ligado := p.a.Hub.Ligados()[id]; !ligado {
			break
		}
		if time.Now().After(prazo) {
			t.Fatal("o hub não viu o canal fechar em 5 s")
		}
	}
	_, corpo = paginaDaEmpresa(t, p, e)
	conferirPessoas(t, corpo, []esperado{{"Ana Souza", "offline", "Offline", "última vez hoje, 09:43", map[string]string{"NOTE-ANA": "offline"}}})
}
