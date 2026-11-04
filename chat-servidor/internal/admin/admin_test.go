package admin_test

import (
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/admin"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// O usuário e as senhas dos testes são inventados e valem só aqui.
const (
	usuarioTeste = "suporte@starsonic"
	senhaTeste   = "senha-inventada-de-teste-1"
	senhaErrada  = "senha-errada-de-teste-1"
)

var reCSRF = regexp.MustCompile(`name="csrf" value="([A-Za-z0-9_-]{43})"`)

// painel é o ambiente da API com a página de administração num segundo servidor, com o
// mesmo banco, o mesmo hub e o mesmo armazém: o Fora da página chega aos WebSockets da API.
type painel struct {
	a   *apitest.Ambiente
	srv *httptest.Server
}

// cabecalhoEndereco é o cabeçalho com que um teste diz de que endereço o pedido vem: o
// httptest.Server só vê 127.0.0.1, e as entradas têm um limite por endereço. O servidor do
// teste põe o valor no RemoteAddr antes de a página ver o pedido.
const cabecalhoEndereco = "X-Teste-Endereco"

func novoPainel(t *testing.T) *painel {
	t.Helper()
	a := apitest.Novo(t)
	h := admin.Novo(admin.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem, Teste: true})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if e := r.Header.Get(cabecalhoEndereco); e != "" {
			r.RemoteAddr = e
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close) // antes do banco fechar: os Cleanup correm do último para o primeiro
	if err := a.Banco.CriarAdmin(t.Context(), usuarioTeste, senhaTeste); err != nil {
		t.Fatal(err)
	}
	return &painel{a: a, srv: srv}
}

// navegador é um cliente com cookies que não segue os redirecionamentos: os testes conferem
// o 303. O csrf é o da sessão, lido do HTML. Com o endereco, os pedidos vêm dele (veja
// cabecalhoEndereco); sem ele, de 127.0.0.1.
type navegador struct {
	t        *testing.T
	p        *painel
	c        *http.Client
	csrf     string
	endereco string
}

func (p *painel) navegador(t *testing.T) *navegador {
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &navegador{t: t, p: p, c: &http.Client{Jar: jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// navegadorDe é um navegador cujos pedidos vêm do endereço dado ("192.0.2.10:1000").
func (p *painel) navegadorDe(t *testing.T, endereco string) *navegador {
	n := p.navegador(t)
	n.endereco = endereco
	return n
}

// pedir faz o pedido (com o formulário, se houver) e devolve a resposta e o corpo já lido.
func (n *navegador) pedir(metodo, caminho string, campos url.Values) (*http.Response, string) {
	n.t.Helper()
	var corpo io.Reader
	if campos != nil {
		corpo = strings.NewReader(campos.Encode())
	}
	req, err := http.NewRequestWithContext(n.t.Context(), metodo, n.p.srv.URL+caminho, corpo)
	if err != nil {
		n.t.Fatal(err)
	}
	if campos != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if n.endereco != "" {
		req.Header.Set(cabecalhoEndereco, n.endereco)
	}
	resp, err := n.c.Do(req)
	if err != nil {
		n.t.Fatalf("%s %s: %v", metodo, caminho, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		n.t.Fatal(err)
	}
	return resp, string(b)
}

func (n *navegador) get(caminho string) (*http.Response, string) { return n.pedir("GET", caminho, nil) }

// post manda o formulário como está, com ou sem o csrf.
func (n *navegador) post(caminho string, campos url.Values) (*http.Response, string) {
	if campos == nil {
		campos = url.Values{}
	}
	return n.pedir("POST", caminho, campos)
}

// acao manda o formulário com o csrf da sessão.
func (n *navegador) acao(caminho string, campos url.Values) (*http.Response, string) {
	c := url.Values{}
	maps.Copy(c, campos)
	c.Set("csrf", n.csrf)
	return n.post(caminho, c)
}

func csrfDe(t *testing.T, corpo string) string {
	t.Helper()
	m := reCSRF.FindStringSubmatch(corpo)
	if m == nil {
		t.Fatalf("a página não tem o csrf:\n%s", corpo)
	}
	return m[1]
}

// entrar abre a página de entrada, como o navegador, e manda o usuário e a senha.
func (n *navegador) entrar(usuario, senha string) (*http.Response, string) {
	n.t.Helper()
	resp, corpo := n.get("/admin/entrar")
	if resp.StatusCode != http.StatusOK {
		n.t.Fatalf("GET /admin/entrar = %d", resp.StatusCode)
	}
	return n.post("/admin/entrar", url.Values{"usuario": {usuario}, "senha": {senha}, "csrf": {csrfDe(n.t, corpo)}})
}

// logado é um navegador que já entrou, com o csrf da sessão.
func (p *painel) logado(t *testing.T) *navegador {
	t.Helper()
	n := p.navegador(t)
	resp, _ := n.entrar(usuarioTeste, senhaTeste)
	esperarIr(t, resp, "/admin/")
	_, corpo := n.get("/admin/")
	n.csrf = csrfDe(t, corpo)
	return n
}

// esperarIr confere o 303 para o destino.
func esperarIr(t *testing.T, resp *http.Response, destino string) {
	t.Helper()
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != destino {
		t.Fatalf("resposta %d para %q; queria 303 para %q", resp.StatusCode, resp.Header.Get("Location"), destino)
	}
}

func esperarStatus(t *testing.T, resp *http.Response, corpo string, status int) {
	t.Helper()
	if resp.StatusCode != status {
		t.Fatalf("%s %s = %d; queria %d:\n%s", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, status, corpo)
	}
}

// esperarErroAPI confere o status e o erro de uma resposta da API.
func esperarErroAPI(t *testing.T, resp *http.Response, status int, erro string) {
	t.Helper()
	e := apitest.LerJSON[struct{ Erro string }](t, resp)
	if resp.StatusCode != status || e.Erro != erro {
		t.Fatalf("API = %d %q; queria %d %q", resp.StatusCode, e.Erro, status, erro)
	}
}

func esperarAPI(t *testing.T, resp *http.Response, status int) {
	t.Helper()
	if resp.StatusCode != status {
		t.Fatalf("API = %d; queria %d", resp.StatusCode, status)
	}
}

// Os eventos como o app os lê (seção 7 do protocolo).
type evento struct {
	Tipo     string `json:"tipo"`
	Conversa struct {
		ID      int64 `json:"id"`
		Pessoas int   `json:"pessoas"`
		Cuida   bool  `json:"cuida"`
	} `json:"conversa"`
	Mensagem mensagem `json:"mensagem"`
}

type mensagem struct {
	ID    int64           `json:"id"`
	Tipo  string          `json:"tipo"`
	Texto string          `json:"texto"`
	Autor *apitest.Pessoa `json:"autor"`
	Aviso *struct {
		Acao string          `json:"acao"`
		Quem apitest.Pessoa  `json:"quem"`
		Alvo *apitest.Pessoa `json:"alvo"`
	} `json:"aviso"`
}

func esperarFora(t *testing.T, c *websocket.Conn) {
	t.Helper()
	if ev := apitest.LerEvento[evento](t, c); ev.Tipo != "fora" {
		t.Fatalf("evento %q; queria fora", ev.Tipo)
	}
	if cod := apitest.Fechamento(t, c); cod != 4001 {
		t.Fatalf("fechou com %d; queria 4001", cod)
	}
}

// criarConversa cria a conversa pela API e devolve o id.
func criarConversa(t *testing.T, a *apitest.Ambiente, chave string, corpo map[string]any) int64 {
	t.Helper()
	resp := a.Pedir(chave, "POST", "/api/v1/conversas", corpo)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("criar a conversa = %d", resp.StatusCode)
	}
	return apitest.LerJSON[struct{ Conversa struct{ ID int64 } }](t, resp).Conversa.ID
}

func enviarTexto(t *testing.T, a *apitest.Ambiente, chave string, conversa int64, idLocal, texto string) {
	t.Helper()
	esperarAPI(t, a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conversa),
		map[string]string{"idLocal": idLocal, "texto": texto}), http.StatusCreated)
}

// idDoComputador acha o id do computador pelo nome (a API não mostra o id).
func idDoComputador(p *painel, nome string) int64 {
	return int64(p.a.Contar(`SELECT id FROM computadores WHERE nome = ?`, nome))
}
