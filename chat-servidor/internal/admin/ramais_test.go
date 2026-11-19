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
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/ramais"
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

// --- A primeira página ----------------------------------------------------------------------

// secao devolve o HTML da parte da página com esse data-ao-vivo (um <section>).
func secao(t *testing.T, corpo, chave string) string {
	t.Helper()
	m := regexp.MustCompile(`(?s)<section\b[^>]*data-ao-vivo="` + chave + `"[^>]*>.*?</section>`).FindString(corpo)
	if m == "" {
		t.Fatalf("a página não tem a parte %q:\n%s", chave, corpo)
	}
	return m
}

// semRegistro é uma linha do cartão "Sem registro agora".
type semRegistro struct{ empresa, nome, ramal, ha, diz, endereco string }

var reLinhaSemRegistro = regexp.MustCompile(`(?s)<tr>\s*<td class="forte">([^<]*)</td>\s*<td class="nome-pessoa">([^<]*)</td>\s*` +
	`<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td class="suave">([^<]*)</td>\s*<td class="fim"><a class="abrir" href="([^"]*)"`)

// listaSemRegistro lê as linhas do cartão "Sem registro agora", na ordem em que aparecem.
func listaSemRegistro(t *testing.T, corpo string) []semRegistro {
	t.Helper()
	lista := []semRegistro{}
	for _, m := range reLinhaSemRegistro.FindAllStringSubmatch(secao(t, corpo, "sem-registro"), -1) {
		for i := range m {
			m[i] = html.UnescapeString(m[i])
		}
		lista = append(lista, semRegistro{m[1], m[2], m[3], m[4], m[5], m[6]})
	}
	return lista
}

// linhaDaEmpresa devolve o HTML da linha da empresa na tabela das empresas.
func linhaDaEmpresa(t *testing.T, corpo, nome string) string {
	t.Helper()
	re := regexp.MustCompile(`(?s)<tr>\s*<td class="forte">` + regexp.QuoteMeta(html.EscapeString(nome)) + `</td>.*?</tr>`)
	linha := re.FindString(secao(t, corpo, "empresas"))
	if linha == "" {
		t.Fatalf("a tabela das empresas não tem a linha de %s:\n%s", nome, corpo)
	}
	return linha
}

var reAlerta = regexp.MustCompile(`(?s)<div class="numero numero-alerta">\s*<span class="numero-valor">(?:<svg.*?</svg>)?([^<]*)</span>\s*<span class="numero-legenda">([^<]*)</span>`)

// alerta lê o cartão de número dos ramais sem registro: o número e a legenda ("" sem o cartão).
func alerta(corpo string) (valor, legenda string) {
	if m := reAlerta.FindStringSubmatch(corpo); m != nil {
		return strings.TrimSpace(m[1]), m[2]
	}
	return "", ""
}

func primeiraPagina(t *testing.T, p *painel) (*http.Response, string) {
	t.Helper()
	resp, corpo := p.logado(t).get("/admin/")
	esperarStatus(t, resp, corpo, http.StatusOK)
	return resp, corpo
}

// As contas de cada empresa, o cartão de número e a lista dos ramais sem registro.
func TestPrimeiraPagina_Contas(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	acme := p.a.Empresa("ACME Comércio Ltda")
	clinica := p.a.Empresa("Clínica Vida")
	p.a.Empresa("Transportadora Rota Sul")
	ligadoCom(p, acme, "NOTE-ANA", "2003", "Ana Souza", "conectado", 7200)
	ligadoCom(p, acme, "COMERCIAL-03", "2011", "Carlos Lima", "conectando", 720)
	entrarNoPC(p, acme, "FIN-01", "3004", "Beatriz Ramos")
	ligadoCom(p, clinica, "CONSULTORIO-01", "1001", "Recepção", "", 0)
	entrarNoPC(p, clinica, "CONSULTORIO-02", "1002", "Marcos Teles")

	resp, corpo := primeiraPagina(t, p)
	conferirContas(t, "a ACME", linhaDaEmpresa(t, corpo, "ACME Comércio Ltda"), "1 online", "1 sem registro", "1 offline")
	conferirContas(t, "a Clínica Vida", linhaDaEmpresa(t, corpo, "Clínica Vida"), "0 online", "1 no chat", "1 offline")
	conferirContas(t, "a empresa sem ninguém", linhaDaEmpresa(t, corpo, "Transportadora Rota Sul"), "0 online", "0 offline")
	if valor, legenda := alerta(corpo); valor != "1" || legenda != "ramal sem registro agora" {
		t.Errorf("o cartão a mais mostra %q e %q; queria 1 e \"ramal sem registro agora\"", valor, legenda)
	}
	quero := semRegistro{"ACME Comércio Ltda", "Carlos Lima", "2011", "há 12 min", "Conectando…", fmt.Sprintf("/admin/empresas/%d", acme.ID)}
	if lista := listaSemRegistro(t, corpo); len(lista) != 1 || lista[0] != quero {
		t.Errorf("a lista = %+v; queria só %+v", lista, quero)
	}
	for _, s := range []string{
		`data-ao-vivo="numeros"`, `data-ao-vivo="reunioes"`, `data-ao-vivo="sem-registro"`, `data-ao-vivo="empresas"`,
		">SEM REGISTRO AGORA<", "O app está aberto, mas o ramal não registra na central.",
		">EMPRESA<", ">NOME<", ">RAMAL<", ">HÁ QUANTO TEMPO<", ">O APP DIZ<", ">RAMAIS AGORA<",
		`<span data-so-com-script hidden>Esta página se atualiza sozinha a cada 30 segundos. </span>Só aparecem os computadores com o app do Windows ligado ao chat: o celular e os aparelhos de mesa não entram na conta.`,
		"Os arquivos ficam 1 ano no servidor.",
	} {
		if !strings.Contains(corpo, s) {
			t.Errorf("a página não tem %q", s)
		}
	}
	// A coluna nova vem logo depois da EMPRESA.
	if cabeca := secao(t, corpo, "empresas"); !regexp.MustCompile(`(?s)>EMPRESA</th>\s*<th scope="col">RAMAIS AGORA</th>\s*<th scope="col">PESSOAS</th>`).MatchString(cabeca) {
		t.Errorf("as colunas da tabela das empresas não estão na ordem EMPRESA, RAMAIS AGORA, PESSOAS")
	}
	conferirCabecalhos(t, "a primeira página", resp, corpo)
	if t.Failed() {
		t.Logf("a página:\n%s", corpo)
	}
}

// Sem ramal sem registro: o cartão a mais não existe, e a lista diz que não há nenhum.
func TestPrimeiraPagina_SemNinguem(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	acme := p.a.Empresa("ACME Comércio Ltda")
	ligadoCom(p, acme, "NOTE-ANA", "2003", "Ana Souza", "conectado", 60)
	ligadoCom(p, acme, "FIN-01", "3004", "Beatriz Ramos", "erro", 59) // ainda registrando: não é "sem registro"
	_, corpo := primeiraPagina(t, p)
	if strings.Contains(corpo, "numero-alerta") {
		t.Error("a página tem o cartão a mais sem nenhum ramal sem registro")
	}
	if lista := listaSemRegistro(t, corpo); len(lista) != 0 {
		t.Errorf("a lista = %+v; queria vazia", lista)
	}
	if !strings.Contains(secao(t, corpo, "sem-registro"), "Nenhum ramal sem registro agora.") {
		t.Errorf("o cartão da lista não diz que não há nenhum:\n%s", secao(t, corpo, "sem-registro"))
	}
	conferirContas(t, "a ACME", linhaDaEmpresa(t, corpo, "ACME Comércio Ltda"), "1 online", "1 no chat", "0 offline")
}

// O que está sem registro há mais tempo vem primeiro, de todas as empresas juntas.
func TestPrimeiraPagina_Ordem(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	acme := p.a.Empresa("ACME Comércio Ltda")
	clinica := p.a.Empresa("Clínica Vida")
	ligadoCom(p, acme, "FIN-01", "3004", "Beatriz Ramos", "erro", 180)
	ligadoCom(p, clinica, "CONSULTORIO-01", "1001", "Recepção", "semConexao", 7200)
	ligadoCom(p, acme, "COMERCIAL-03", "2011", "Carlos Lima", "conectando", 720)
	// Dois há o mesmo tempo: a ordem do nome da empresa, e depois a do nome da pessoa.
	ligadoCom(p, clinica, "CONSULTORIO-02", "1002", "Marcos Teles", "erro", 180)
	ligadoCom(p, acme, "NOTE-ANA", "2003", "Ana Souza", "erro", 180)
	_, corpo := primeiraPagina(t, p)
	got := []string{}
	for _, l := range listaSemRegistro(t, corpo) {
		got = append(got, l.nome+", "+l.ha+", "+l.diz)
	}
	quero := []string{
		"Recepção, há 2 h, Sem conexão com a central",
		"Carlos Lima, há 12 min, Conectando…",
		"Ana Souza, há 3 min, Erro no cadastro",
		"Beatriz Ramos, há 3 min, Erro no cadastro",
		"Marcos Teles, há 3 min, Erro no cadastro",
	}
	if strings.Join(got, " | ") != strings.Join(quero, " | ") {
		t.Fatalf("a lista = %q; queria %q", got, quero)
	}
	if valor, legenda := alerta(corpo); valor != "5" || legenda != "ramais sem registro agora" {
		t.Errorf("o cartão a mais mostra %q e %q; queria 5 e \"ramais sem registro agora\"", valor, legenda)
	}
}

// semRegistroNoHub põe n pessoas da empresa sem registro, direto no banco e no hub (sem a API: são muitas).
func semRegistroNoHub(t *testing.T, p *painel, e banco.Empresa, n int) {
	t.Helper()
	for i := 1; i <= n; i++ {
		k := p.a.Ligar(e.Codigo, fmt.Sprintf("PC-%03d", i))
		pessoa := p.a.Entrar(k, fmt.Sprintf("%d", 3000+i), fmt.Sprintf("Pessoa %03d", i))
		id := int64(p.a.Contar(`SELECT id FROM computadores WHERE empresa_id = ? AND nome = ?`, e.ID, fmt.Sprintf("PC-%03d", i)))
		r := p.a.Hub.Reservar(id)
		t.Cleanup(r.Desistir)
		r.DefinirPessoa(pessoa.ID)
		p.a.Hub.DefinirRamal(id, pessoa.ID, ramais.Dito{Estado: ramais.Erro, Desde: p.a.Relogio.Agora().Add(-time.Duration(60+i) * time.Second)})
	}
}

// A lista mostra até 50, e diz quantos não couberam; o cartão de número e as contas contam todos.
func TestPrimeiraPagina_Corte(t *testing.T) {
	for _, c := range []struct {
		n    int
		mais string
	}{
		{50, ""},
		{51, "Mais 1 ramal sem registro não cabe nesta lista. Abra a empresa para ver."},
		{62, "Mais 12 ramais sem registro não cabem nesta lista. Abra a empresa para ver todos."},
	} {
		t.Run(fmt.Sprintf("%d sem registro", c.n), func(t *testing.T) {
			p := novoPainel(t)
			p.a.Relogio.Definir(hoje0943)
			acme := p.a.Empresa("ACME Comércio Ltda")
			semRegistroNoHub(t, p, acme, c.n)
			_, corpo := primeiraPagina(t, p)
			lista := listaSemRegistro(t, corpo)
			if len(lista) != 50 {
				t.Fatalf("a lista tem %d linhas; queria 50", len(lista))
			}
			// A mais antiga é a última pessoa posta (cada uma está sem registro há um segundo a mais).
			if quero := fmt.Sprintf("Pessoa %03d", c.n); lista[0].nome != quero {
				t.Errorf("a primeira linha é de %q; queria %q", lista[0].nome, quero)
			}
			if valor, _ := alerta(corpo); valor != fmt.Sprintf("%d", c.n) {
				t.Errorf("o cartão a mais mostra %q; queria %d", valor, c.n)
			}
			conferirContas(t, "a ACME", linhaDaEmpresa(t, corpo, "ACME Comércio Ltda"), "0 online", fmt.Sprintf("%d sem registro", c.n), "0 offline")
			parte := secao(t, corpo, "sem-registro")
			if c.mais == "" {
				if strings.Contains(parte, "sem registro não cab") {
					t.Errorf("com %d, a lista diz que sobrou gente:\n%s", c.n, parte)
				}
			} else if !strings.Contains(parte, c.mais) {
				t.Errorf("a lista não diz %q:\n%s", c.mais, parte)
			}
		})
	}
}

// Os nomes da empresa e da pessoa aparecem escritos nos lugares novos, e não viram HTML.
func TestPrimeiraPagina_NomesComSinais(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	e := p.a.Empresa(`A&B <Matriz>`)
	ligadoCom(p, e, `<i>PC</i>`, "2003", `<b>&"Zé"`, "erro", 720)
	resp, corpo := primeiraPagina(t, p)
	quero := semRegistro{`A&B <Matriz>`, `<b>&"Zé"`, "2003", "há 12 min", "Erro no cadastro", fmt.Sprintf("/admin/empresas/%d", e.ID)}
	if lista := listaSemRegistro(t, corpo); len(lista) != 1 || lista[0] != quero {
		t.Errorf("a lista = %+v; queria só %+v", lista, quero)
	}
	conferirContas(t, "a empresa", linhaDaEmpresa(t, corpo, `A&B <Matriz>`), "0 online", "1 sem registro", "0 offline")
	for _, cru := range []string{`<b>&`, `<Matriz>`, `<i>PC`} {
		if strings.Contains(corpo, cru) {
			t.Errorf("a página tem %q sem escapar", cru)
		}
	}
	conferirCabecalhos(t, "a primeira página", resp, corpo)
}

// A primeira página com 200 empresas e 5.000 pessoas, todas ligadas ao chat: menos de 1 s (o valor da spec, seção 8).
func TestPrimeiraPagina_Tempo(t *testing.T) {
	p := novoPainel(t)
	p.a.Relogio.Definir(hoje0943)
	const empresas, pessoas = 200, 5000
	// As linhas entram direto no banco, uma instrução por tabela. Os ids saem em ordem, de 1 em diante.
	serie := fmt.Sprintf(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < %d) `, pessoas-1)
	p.a.Exec(fmt.Sprintf(`INSERT INTO empresas (nome, codigo, criada_em)
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < %d)
		SELECT printf('Empresa %%03d', i), printf('TESTE-%%04d', i), 1 FROM n`, empresas))
	p.a.Exec(`INSERT INTO pessoas (empresa_id, ramal, nome, nome_busca, entrou_em) ` + serie +
		fmt.Sprintf(`SELECT 1 + i %% %d, CAST(1000 + i / %d AS TEXT), printf('Pessoa %%04d', i), printf('pessoa %%04d', i), 1 FROM n`, empresas, empresas))
	p.a.Exec(`INSERT INTO computadores (empresa_id, chave_hash, nome, pessoa_id, ligado_em, ultima_vez) ` + serie +
		fmt.Sprintf(`SELECT 1 + i %% %d, CAST(printf('chave-de-teste-%%05d', i) AS BLOB), printf('PC-%%04d', i), i + 1, 1, 1 FROM n`, empresas))
	p.a.Exec(`INSERT INTO computador_pessoas (computador_id, pessoa_id, primeira_vez, ultima_vez) ` + serie + `SELECT i + 1, i + 1, 1, 1 FROM n`)
	if n := p.a.Contar(`SELECT COUNT(*) FROM pessoas p JOIN computadores c ON c.pessoa_id = p.id AND c.empresa_id = p.empresa_id`); n != pessoas {
		t.Fatalf("o banco ficou com %d pessoas com o computador delas; queria %d", n, pessoas)
	}
	// Todos ligados ao chat: um em cada dez sem registro há 5 minutos, um em cada dez sem dizer nada, e o resto registrado.
	agora := p.a.Relogio.Agora()
	for i := int64(1); i <= pessoas; i++ {
		r := p.a.Hub.Reservar(i)
		t.Cleanup(r.Desistir)
		r.DefinirPessoa(i)
		switch i % 10 {
		case 0:
			p.a.Hub.DefinirRamal(i, i, ramais.Dito{Estado: ramais.Erro, Desde: agora.Add(-5 * time.Minute)})
		case 1:
		default:
			p.a.Hub.DefinirRamal(i, i, ramais.Dito{Estado: ramais.Conectado, Desde: agora.Add(-time.Hour)})
		}
	}

	n := p.logado(t)
	melhor := time.Hour
	var corpo string
	for range 3 {
		inicio := time.Now()
		resp, c := n.get("/admin/")
		if d := time.Since(inicio); d < melhor {
			melhor = d
		}
		esperarStatus(t, resp, c, http.StatusOK)
		corpo = c
	}
	t.Logf("a primeira página com %d empresas e %d pessoas: %v na melhor de três", empresas, pessoas, melhor)
	if melhor >= time.Second {
		t.Errorf("a primeira página levou %v; a spec pede menos de 1 s", melhor)
	}
	if valor, _ := alerta(corpo); valor != "500" {
		t.Errorf("o cartão a mais mostra %q; queria 500", valor)
	}
	if lista := listaSemRegistro(t, corpo); len(lista) != 50 {
		t.Errorf("a lista tem %d linhas; queria 50", len(lista))
	}
	if !strings.Contains(corpo, "Mais 450 ramais sem registro não cabem nesta lista. Abra a empresa para ver todos.") {
		t.Error("a página não diz que 450 não couberam na lista")
	}
	if linhas := strings.Count(secao(t, corpo, "empresas"), `<td class="forte">Empresa `); linhas != empresas {
		t.Errorf("a tabela tem %d empresas; queria %d", linhas, empresas)
	}
	// Cada empresa tem 25 pessoas, todas com o mesmo resto do id por 10 (200 é múltiplo de 10): a 001 inteira não
	// disse nada, a 002 inteira está registrada, e a 010 inteira está sem registro.
	conferirContas(t, "a Empresa 001", linhaDaEmpresa(t, corpo, "Empresa 001"), "0 online", "25 no chat", "0 offline")
	conferirContas(t, "a Empresa 002", linhaDaEmpresa(t, corpo, "Empresa 002"), "25 online", "0 offline")
	conferirContas(t, "a Empresa 010", linhaDaEmpresa(t, corpo, "Empresa 010"), "0 online", "25 sem registro", "0 offline")
}
