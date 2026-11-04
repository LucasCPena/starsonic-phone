package admin_test

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

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

var (
	reCSRF   = regexp.MustCompile(`name="csrf" value="([A-Za-z0-9_-]{43})"`)
	reCodigo = regexp.MustCompile(`STAR-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}`)
)

// painel é o ambiente da API com a página de administração num segundo servidor, com o
// mesmo banco, o mesmo hub e o mesmo armazém: o Fora da página chega aos WebSockets da API.
type painel struct {
	a   *apitest.Ambiente
	srv *httptest.Server
}

func novoPainel(t *testing.T) *painel {
	t.Helper()
	a := apitest.Novo(t)
	srv := httptest.NewServer(admin.Novo(admin.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem, Teste: true}))
	t.Cleanup(srv.Close) // antes do banco fechar: os Cleanup correm do último para o primeiro
	if err := a.Banco.CriarAdmin(t.Context(), usuarioTeste, senhaTeste); err != nil {
		t.Fatal(err)
	}
	return &painel{a: a, srv: srv}
}

// navegador é um cliente com cookies que não segue os redirecionamentos: os testes conferem
// o 303. O csrf é o da sessão, lido do HTML.
type navegador struct {
	t    *testing.T
	p    *painel
	c    *http.Client
	csrf string
}

func (p *painel) navegador(t *testing.T) *navegador {
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &navegador{t: t, p: p, c: &http.Client{Jar: jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
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

// cookieDe é o valor do cookie que o navegador guardou para a página.
func cookieDe(t *testing.T, n *navegador, nome string) string {
	t.Helper()
	u, _ := url.Parse(n.p.srv.URL + "/admin/")
	for _, c := range n.c.Jar.Cookies(u) {
		if c.Name == nome {
			return c.Value
		}
	}
	t.Fatalf("sem o cookie %s", nome)
	return ""
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

func enviarArquivo(t *testing.T, a *apitest.Ambiente, chave string, conversa int64, idLocal, arquivo string) {
	t.Helper()
	esperarAPI(t, a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conversa),
		map[string]string{"idLocal": idLocal, "arquivo": arquivo}), http.StatusCreated)
}

// idDoComputador acha o id do computador pelo nome (a API não mostra o id).
func idDoComputador(p *painel, nome string) int64 {
	return int64(p.a.Contar(`SELECT id FROM computadores WHERE nome = ?`, nome))
}

func TestNovo_SemDependencias(t *testing.T) {
	a := apitest.Novo(t)
	for nome, d := range map[string]admin.Deps{
		"Banco":   {Hub: a.Hub, Armazem: a.Armazem},
		"Hub":     {Banco: a.Banco, Armazem: a.Armazem},
		"Armazem": {Banco: a.Banco, Hub: a.Hub},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("sem o %s, o admin.Novo devia entrar em pânico", nome)
				}
			}()
			admin.Novo(d)
		}()
	}
}

func TestEntrar_SenhaCerta(t *testing.T) {
	p := novoPainel(t)
	n := p.navegador(t)
	resp, _ := n.get("/admin/")
	esperarIr(t, resp, "/admin/entrar")

	resp, corpo := n.get("/admin/entrar")
	esperarStatus(t, resp, corpo, http.StatusOK)
	for _, campo := range []string{`name="usuario"`, `name="senha"`, `type="password"`, `autocomplete="current-password"`} {
		if !strings.Contains(corpo, campo) {
			t.Fatalf("a entrada não tem %s:\n%s", campo, corpo)
		}
	}
	resp, _ = n.entrar(" Suporte@Starsonic ", senhaTeste)
	esperarIr(t, resp, "/admin/")
	resp, corpo = n.get("/admin/")
	esperarStatus(t, resp, corpo, http.StatusOK)
	for _, s := range []string{"Empresas", usuarioTeste, ">Sair<"} {
		if !strings.Contains(corpo, s) {
			t.Fatalf("a lista não tem %q:\n%s", s, corpo)
		}
	}
	// Com a sessão, a entrada manda para a lista.
	resp, _ = n.get("/admin/entrar")
	esperarIr(t, resp, "/admin/")

	// O cookie leva o token; o banco guarda só o SHA-256 dele.
	token := cookieDe(t, n, "sessao")
	h := sha256.Sum256([]byte(token))
	if c := p.a.Contar(`SELECT COUNT(*) FROM sessoes_admin WHERE token_hash = ? AND usuario = ?`, h[:], usuarioTeste); c != 1 {
		t.Fatalf("%d sessões com o hash do cookie", c)
	}
	if c := p.a.Contar(`SELECT COUNT(*) FROM sessoes_admin WHERE token_hash = ? OR csrf = ?`, []byte(token), token); c != 0 {
		t.Fatal("o token do cookie ficou no banco")
	}
}

func TestEntrar_SenhaErrada(t *testing.T) {
	p := novoPainel(t)
	n := p.navegador(t)
	for i := 1; i <= 5; i++ {
		resp, corpo := n.entrar(usuarioTeste, senhaErrada)
		esperarStatus(t, resp, corpo, http.StatusUnauthorized)
		if !strings.Contains(corpo, "Usuário ou senha incorretos.") {
			t.Fatalf("tentativa %d:\n%s", i, corpo)
		}
		if strings.Contains(corpo, senhaErrada) {
			t.Fatal("a página devolveu a senha digitada")
		}
	}
	if resp, _ := n.get("/admin/"); resp.StatusCode != http.StatusSeeOther {
		t.Fatal("entrou com a senha errada")
	}
	// A 6ª tentativa, mesmo com a senha certa, encontra a trava.
	resp, corpo := n.entrar(usuarioTeste, senhaTeste)
	esperarStatus(t, resp, corpo, http.StatusTooManyRequests)
	if !strings.Contains(corpo, "Muitas tentativas. Tente de novo daqui a 15 minutos.") {
		t.Fatalf("a 6ª tentativa:\n%s", corpo)
	}
	if resp, _ := n.get("/admin/"); resp.StatusCode != http.StatusSeeOther {
		t.Fatal("entrou travado")
	}
	// Com o relógio 15 minutos adiante, a senha certa entra.
	p.a.Relogio.Avancar(15 * time.Minute)
	resp, _ = n.entrar(usuarioTeste, senhaTeste)
	esperarIr(t, resp, "/admin/")

	// Quem não existe recebe a mesma resposta.
	resp, corpo = p.navegador(t).entrar("ninguem@starsonic", senhaTeste)
	esperarStatus(t, resp, corpo, http.StatusUnauthorized)
	if !strings.Contains(corpo, "Usuário ou senha incorretos.") {
		t.Fatalf("usuário que não existe:\n%s", corpo)
	}
}

func TestSessao_Expira(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	p.a.Relogio.Avancar(12*time.Hour - time.Second)
	if resp, corpo := n.get("/admin/"); resp.StatusCode != http.StatusOK {
		t.Fatalf("1 s antes de vencer = %d:\n%s", resp.StatusCode, corpo)
	}
	p.a.Relogio.Avancar(2 * time.Second) // 12 h e 1 s
	resp, _ := n.get("/admin/")
	esperarIr(t, resp, "/admin/entrar")
}

func TestCookie(t *testing.T) {
	a := apitest.Novo(t)
	if err := a.Banco.CriarAdmin(t.Context(), usuarioTeste, senhaTeste); err != nil {
		t.Fatal(err)
	}
	achar := func(cs []*http.Cookie, nome string) *http.Cookie {
		for _, c := range cs {
			if c.Name == nome {
				return c
			}
		}
		t.Fatalf("sem o cookie %s", nome)
		return nil
	}
	protegido := func(c *http.Cookie, seguro bool) bool {
		return c.Value != "" && c.HttpOnly && c.SameSite == http.SameSiteStrictMode && c.Path == "/admin" && c.Secure == seguro
	}
	for _, teste := range []bool{true, false} {
		h := admin.Novo(admin.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem, Teste: teste})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/admin/entrar", nil))
		entrada := achar(rec.Result().Cookies(), "entrada")
		form := url.Values{"usuario": {usuarioTeste}, "senha": {senhaTeste}, "csrf": {csrfDe(t, rec.Body.String())}}
		req := httptest.NewRequest("POST", "/admin/entrar", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.AddCookie(entrada)
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusSeeOther {
			t.Fatalf("Teste %v: entrar = %d", teste, rec.Code)
		}
		// Fora do modo de teste, os dois cookies são Secure.
		if s := achar(rec.Result().Cookies(), "sessao"); !protegido(s, !teste) {
			t.Fatalf("Teste %v: o cookie da sessão = %+v", teste, s)
		}
		if !protegido(entrada, !teste) {
			t.Fatalf("Teste %v: o cookie da entrada = %+v", teste, entrada)
		}
	}
}

// estado resume o que as ações da página mudam, para conferir que nada mudou.
func estado(p *painel, empresaID int64) string {
	r, err := p.a.Banco.ResumoDaEmpresa(p.a.T.Context(), empresaID)
	return fmt.Sprintf("empresas %d, pessoas ativas %d, computadores ativos %d, código %q (%v)",
		p.a.Contar(`SELECT COUNT(*) FROM empresas`), p.a.Contar(`SELECT COUNT(*) FROM pessoas WHERE saiu_em IS NULL`),
		p.a.Contar(`SELECT COUNT(*) FROM computadores WHERE saiu_em IS NULL`), r.Codigo, err)
}

func TestCSRF(t *testing.T) {
	p := novoPainel(t)
	n1, n2 := p.logado(t), p.logado(t)
	if n1.csrf == n2.csrf {
		t.Fatal("duas sessões com o mesmo csrf")
	}
	e := p.a.Empresa("ACME Comércio Ltda")
	k := p.a.Ligar(e.Codigo, "NOTE-ANA")
	ana := p.a.Entrar(k, "2003", "Ana Souza")
	antes := estado(p, e.ID)

	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	rotas := []string{
		"/admin/empresas",
		pagina + "/codigo",
		fmt.Sprintf("%s/pessoas/%d/tirar", pagina, ana.ID),
		fmt.Sprintf("%s/computadores/%d/tirar", pagina, idDoComputador(p, "NOTE-ANA")),
		pagina + "/apagar",
		"/admin/sair",
	}
	for _, r := range rotas {
		for nome, csrf := range map[string][]string{"sem o token": nil, "com o da outra sessão": {n2.csrf}, "vazio": {""}} {
			campos := url.Values{"nome": {"ACME Comércio Ltda"}}
			if csrf != nil {
				campos["csrf"] = csrf
			}
			if resp, corpo := n1.post(r, campos); resp.StatusCode != http.StatusForbidden {
				t.Fatalf("POST %s %s = %d; queria 403:\n%s", r, nome, resp.StatusCode, corpo)
			}
		}
	}
	if depois := estado(p, e.ID); depois != antes {
		t.Fatalf("o POST recusado mudou o banco: %s; era %s", depois, antes)
	}
	// O /admin/sair recusado não encerrou a sessão; com o próprio token, a ação vale.
	if resp, _ := n1.get("/admin/"); resp.StatusCode != http.StatusOK {
		t.Fatalf("a sessão acabou com o sair recusado: %d", resp.StatusCode)
	}
	resp, _ := n1.acao("/admin/empresas", url.Values{"nome": {"Outra Ltda"}})
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("com o próprio token = %d", resp.StatusCode)
	}

	// A entrada também pede o token dela: um POST de fora, sem a página, não entra.
	sem := p.navegador(t)
	resp, corpo := sem.post("/admin/entrar", url.Values{"usuario": {usuarioTeste}, "senha": {senhaTeste}})
	esperarStatus(t, resp, corpo, http.StatusForbidden)
	if resp, _ := sem.get("/admin/"); resp.StatusCode != http.StatusSeeOther {
		t.Fatal("entrou sem o token da entrada")
	}
}

// conferirCabecalhos confere os cabeçalhos de toda resposta da página e, no HTML, que nada
// precisa de mais que a CSP default-src 'self': sem script nem estilo inline, sem on*=, e
// sem nada de fora da página.
func conferirCabecalhos(t *testing.T, nome string, resp *http.Response, corpo string) {
	t.Helper()
	h := resp.Header
	quer := map[string]string{
		"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
		"Cache-Control":           "no-store",
		"X-Content-Type-Options":  "nosniff",
	}
	for k, v := range quer {
		if got := h.Get(k); got != v {
			t.Errorf("%s (%d): %s = %q; queria %q", nome, resp.StatusCode, k, got, v)
		}
	}
	if !strings.HasPrefix(h.Get("Content-Type"), "text/html") {
		return
	}
	minusculo := strings.ToLower(corpo)
	if strings.Contains(minusculo, "<style") || regexp.MustCompile(`\sstyle\s*=`).MatchString(minusculo) ||
		regexp.MustCompile(`\son[a-z]+\s*=`).MatchString(minusculo) || strings.Contains(minusculo, "javascript:") {
		t.Errorf("%s: estilo ou script inline:\n%s", nome, corpo)
	}
	for _, m := range regexp.MustCompile(`(?s)<script\b([^>]*)>(.*?)</script>`).FindAllStringSubmatch(corpo, -1) {
		if !strings.Contains(m[1], `src="/admin/estatico/`) || strings.TrimSpace(m[2]) != "" {
			t.Errorf("%s: script inline: %s", nome, m[0])
		}
	}
	for _, m := range regexp.MustCompile(`\b(?:src|href|action)="([^"]*)"`).FindAllStringSubmatch(corpo, -1) {
		if !strings.HasPrefix(m[1], "/admin/") {
			t.Errorf("%s: endereço de fora da página: %q", nome, m[1])
		}
	}
}

func TestCabecalhos(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	k := p.a.Ligar(e.Codigo, "NOTE-ANA")
	p.a.Entrar(k, "2003", "Ana Souza")
	anonimo := p.navegador(t)
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)

	resp, corpo := anonimo.get("/admin/entrar")
	conferirCabecalhos(t, "GET /admin/entrar", resp, corpo)
	resp, corpo = anonimo.entrar(usuarioTeste, senhaErrada)
	conferirCabecalhos(t, "POST /admin/entrar errada", resp, corpo)
	resp, corpo = anonimo.post("/admin/entrar", nil)
	conferirCabecalhos(t, "POST /admin/entrar sem o token", resp, corpo)
	resp, corpo = anonimo.get("/admin/")
	conferirCabecalhos(t, "GET /admin/ sem sessão", resp, corpo)
	resp, corpo = anonimo.get("/admin/estatico/estilo.css")
	conferirCabecalhos(t, "GET estilo.css", resp, corpo)

	n := p.logado(t)
	for _, c := range []string{"/admin/", "/admin/empresas/nova", pagina, pagina + "/apagar", "/admin/nada",
		"/admin/empresas/9999", "/admin/estatico/copiar.js"} {
		resp, corpo := n.get(c)
		conferirCabecalhos(t, "GET "+c, resp, corpo)
	}
	resp, corpo = n.acao("/admin/empresas", url.Values{"nome": {""}})
	conferirCabecalhos(t, "POST /admin/empresas sem nome", resp, corpo)
	resp, corpo = n.acao(pagina+"/apagar", url.Values{"nome": {"errado"}})
	conferirCabecalhos(t, "POST apagar com o nome errado", resp, corpo)
	resp, corpo = n.post(pagina+"/codigo", nil)
	conferirCabecalhos(t, "POST sem o csrf", resp, corpo)
	resp, corpo = n.acao(pagina+"/codigo", nil)
	conferirCabecalhos(t, "POST codigo", resp, corpo)
	resp, corpo = n.acao("/admin/sair", nil)
	conferirCabecalhos(t, "POST /admin/sair", resp, corpo)
}

func TestNovaEmpresa(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	resp, corpo := n.get("/admin/empresas/nova")
	esperarStatus(t, resp, corpo, http.StatusOK)
	if !strings.Contains(corpo, `name="nome"`) || !strings.Contains(corpo, `action="/admin/empresas"`) {
		t.Fatalf("a página nova:\n%s", corpo)
	}

	resp, _ = n.acao("/admin/empresas", url.Values{"nome": {"  ACME Comércio Ltda  "}})
	m := regexp.MustCompile(`^/admin/empresas/(\d+)$`).FindStringSubmatch(resp.Header.Get("Location"))
	if resp.StatusCode != http.StatusSeeOther || m == nil {
		t.Fatalf("criar = %d, %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	pagina := m[0]
	resp, corpo = n.get(pagina)
	esperarStatus(t, resp, corpo, http.StatusOK)
	codigo := reCodigo.FindString(corpo)
	if !strings.Contains(corpo, "<h1 class=\"titulo\">ACME Comércio Ltda</h1>") || codigo == "" {
		t.Fatalf("a página da empresa nova:\n%s", corpo)
	}
	// O código liga um computador pela API, na empresa nova.
	k := p.a.Ligar(codigo, "RECEPCAO-01")
	p.a.Entrar(k, "2001", "Recepção")
	if c := p.a.Contar(`SELECT COUNT(*) FROM computadores WHERE nome = 'RECEPCAO-01' AND empresa_id = ?`, m[1]); c != 1 {
		t.Fatal("o computador não ficou na empresa nova")
	}
	// A lista mostra a empresa, com o link, mas não o código: ele fica só na página dela.
	_, corpo = n.get("/admin/")
	if !strings.Contains(corpo, "ACME Comércio Ltda") || !strings.Contains(corpo, `href="`+pagina+`"`) {
		t.Fatalf("a lista não mostra a empresa:\n%s", corpo)
	}
	if strings.Contains(corpo, codigo) {
		t.Fatal("a lista mostra o código da empresa")
	}

	// Um nome vazio, ou de mais de 80 caracteres, volta com o erro, sem criar nada.
	for _, nome := range []string{"   ", strings.Repeat("a", 81)} {
		resp, corpo := n.acao("/admin/empresas", url.Values{"nome": {nome}})
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		if !strings.Contains(corpo, "Escreva o nome da empresa") {
			t.Fatalf("nome %q:\n%s", nome, corpo)
		}
	}
	if c := p.a.Contar(`SELECT COUNT(*) FROM empresas`); c != 1 {
		t.Fatalf("%d empresas; queria 1", c)
	}
}

func TestTrocarCodigo(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	k := p.a.Ligar(e.Codigo, "RECEPCAO-01")
	p.a.Entrar(k, "2001", "Recepção")
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)

	resp, _ := n.acao(pagina+"/codigo", nil)
	esperarIr(t, resp, pagina)
	_, corpo := n.get(pagina)
	novo := reCodigo.FindString(corpo)
	if novo == "" || novo == e.Codigo || strings.Contains(corpo, e.Codigo) {
		t.Fatalf("o código era %s e a página mostra %q", e.Codigo, novo)
	}
	// O código antigo responde 404 codigo na API.
	esperarErroAPI(t, p.a.Pedir("", "POST", "/api/v1/computadores",
		map[string]string{"codigo": e.Codigo, "computador": "PC-2"}), http.StatusNotFound, "codigo")
	// O computador já ligado continua; o código novo liga outro; a outra empresa não mudou.
	esperarAPI(t, p.a.Pedir(k, "GET", "/api/v1/conversas", nil), http.StatusOK)
	p.a.Ligar(novo, "PC-3")
	p.a.Ligar(outra.Codigo, "PC-OUTRA")

	resp, corpo = n.acao("/admin/empresas/9999/codigo", nil)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
}

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

// linhas conta as linhas de cada tabela que são da empresa.
func linhas(p *painel, empresaID int64) map[string]int {
	n := map[string]int{}
	for tabela, q := range map[string]string{
		"empresas":           `SELECT COUNT(*) FROM empresas WHERE id = ?`,
		"pessoas":            `SELECT COUNT(*) FROM pessoas WHERE empresa_id = ?`,
		"computadores":       `SELECT COUNT(*) FROM computadores WHERE empresa_id = ?`,
		"computador_pessoas": `SELECT COUNT(*) FROM computador_pessoas x JOIN computadores c ON c.id = x.computador_id WHERE c.empresa_id = ?`,
		"conversas":          `SELECT COUNT(*) FROM conversas WHERE empresa_id = ?`,
		"membros":            `SELECT COUNT(*) FROM membros x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"mensagens":          `SELECT COUNT(*) FROM mensagens x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"arquivos":           `SELECT COUNT(*) FROM arquivos WHERE empresa_id = ?`,
		"leituras":           `SELECT COUNT(*) FROM leituras x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
	} {
		n[tabela] = p.a.Contar(q, empresaID)
	}
	return n
}

// total conta as linhas de cada tabela, de todas as empresas.
func total(p *painel) map[string]int {
	n := map[string]int{}
	for _, tabela := range []string{"empresas", "pessoas", "computadores", "computador_pessoas", "conversas", "membros",
		"mensagens", "arquivos", "leituras"} {
		n[tabela] = p.a.Contar(`SELECT COUNT(*) FROM ` + tabela)
	}
	return n
}

// noDisco diz se o arquivo e a miniatura dele estão no disco.
func noDisco(t *testing.T, p *painel, id string) (arquivo, miniatura bool) {
	t.Helper()
	existe := func(f *os.File, err error) bool {
		if err == nil {
			f.Close()
			return true
		}
		if !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
		return false
	}
	return existe(p.a.Armazem.Abrir(id)), existe(p.a.Armazem.AbrirMiniatura(id))
}

func TestApagarEmpresa(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	acme := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	kAna, kBia := p.a.Ligar(acme.Codigo, "NOTE-ANA"), p.a.Ligar(acme.Codigo, "FIN-01")
	kAbel := p.a.Ligar(outra.Codigo, "PC-ABEL")
	p.a.Entrar(kAna, "2003", "Ana Souza")
	bia := p.a.Entrar(kBia, "3004", "Beatriz Ramos")
	p.a.Entrar(kAbel, "2003", "Abel")
	// Na ACME, uma conversa com texto e uma foto com miniatura, e um grupo; na outra, um
	// arquivo numa mensagem.
	dupla := criarConversa(t, p.a, kAna, map[string]any{"tipo": "dupla", "com": bia.ID})
	criarConversa(t, p.a, kAna, map[string]any{"tipo": "grupo", "nome": "Comercial", "pessoas": []int64{bia.ID}})
	enviarTexto(t, p.a, kAna, dupla, "m-1", "Bom dia")
	foto := p.a.Enviar(kAna, "foto.jpg", "image/jpeg", []byte("\xff\xd8\xff\xe0 uma foto de teste"))
	esperarAPI(t, p.a.Pedir(kAna, "PUT", "/api/v1/arquivos/"+foto.ID+"/miniatura", "\xff\xd8\xff\xe0 miniatura"), http.StatusNoContent)
	enviarArquivo(t, p.a, kAna, dupla, "m-2", foto.ID)
	esperarAPI(t, p.a.Pedir(kBia, "POST", fmt.Sprintf("/api/v1/conversas/%d/lida", dupla), map[string]int64{"ate": 1 << 40}),
		http.StatusNoContent)
	bruna := p.a.Entrar(p.a.Ligar(outra.Codigo, "PC-BRUNA"), "2004", "Bruna")
	doAbel := p.a.Enviar(kAbel, "proposta.pdf", "application/pdf", []byte("%PDF-1.4 de teste"))
	duplaOutra := criarConversa(t, p.a, kAbel, map[string]any{"tipo": "dupla", "com": bruna.ID})
	enviarArquivo(t, p.a, kAbel, duplaOutra, "o-1", doAbel.ID)
	cAna := p.a.Conectar(kAna)
	daOutra := linhas(p, outra.ID)
	for tabela, c := range linhas(p, acme.ID) {
		if c == 0 {
			t.Fatalf("a cena não pôs nada da ACME em %s", tabela)
		}
	}

	pagina := fmt.Sprintf("/admin/empresas/%d", acme.ID)
	resp, corpo := n.get(pagina + "/apagar")
	esperarStatus(t, resp, corpo, http.StatusOK)
	if !strings.Contains(corpo, `name="nome"`) || !strings.Contains(corpo, "ACME Comércio Ltda") {
		t.Fatalf("a página de apagar:\n%s", corpo)
	}
	// Com o nome errado, nada muda.
	antes := total(p)
	for _, nome := range []string{"", "ACME", "acme comércio ltda", "Outra Ltda"} {
		resp, corpo := n.acao(pagina+"/apagar", url.Values{"nome": {nome}})
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		if !strings.Contains(corpo, "O nome não confere.") {
			t.Fatalf("nome %q:\n%s", nome, corpo)
		}
	}
	if got := total(p); !maps.Equal(got, antes) {
		t.Fatalf("o nome errado mudou o banco: %v; era %v", got, antes)
	}
	if arq, mini := noDisco(t, p, foto.ID); !arq || !mini {
		t.Fatal("o nome errado tirou a foto do disco")
	}
	esperarAPI(t, p.a.Pedir(kAna, "GET", "/api/v1/conversas", nil), http.StatusOK)

	// Com o nome certo, tudo da ACME sai, no banco e no disco, e os computadores dela saem.
	resp, _ = n.acao(pagina+"/apagar", url.Values{"nome": {" ACME Comércio Ltda "}})
	esperarIr(t, resp, "/admin/")
	if got := total(p); !maps.Equal(got, daOutra) {
		t.Fatalf("depois de apagar = %v; queria só as linhas da outra empresa, %v", got, daOutra)
	}
	if arq, mini := noDisco(t, p, foto.ID); arq || mini {
		t.Fatalf("a foto ficou no disco: arquivo %v, miniatura %v", arq, mini)
	}
	esperarFora(t, cAna)
	for _, k := range []string{kAna, kBia} {
		esperarErroAPI(t, p.a.Pedir(k, "GET", "/api/v1/conversas", nil), http.StatusUnauthorized, "chave")
	}
	// A outra empresa continua intacta, também no disco.
	if got := linhas(p, outra.ID); !maps.Equal(got, daOutra) {
		t.Fatalf("a outra empresa mudou: %v; era %v", got, daOutra)
	}
	if arq, _ := noDisco(t, p, doAbel.ID); !arq {
		t.Fatal("o arquivo da outra empresa saiu do disco")
	}
	esperarAPI(t, p.a.Pedir(kAbel, "GET", "/api/v1/arquivos/"+doAbel.ID, nil), http.StatusOK)

	resp, corpo = n.get(pagina)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	if _, corpo := n.get("/admin/"); strings.Contains(corpo, "ACME Comércio Ltda") || !strings.Contains(corpo, "Outra Ltda") {
		t.Fatalf("a lista depois de apagar:\n%s", corpo)
	}
}

func TestSemConversas(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	kAna, kBia := p.a.Ligar(e.Codigo, "NOTE-ANA"), p.a.Ligar(e.Codigo, "FIN-01")
	ana := p.a.Entrar(kAna, "2003", "Ana Souza")
	bia := p.a.Entrar(kBia, "3004", "Beatriz Ramos")
	dupla := criarConversa(t, p.a, kAna, map[string]any{"tipo": "dupla", "com": bia.ID})
	enviarTexto(t, p.a, kAna, dupla, "m-1", "segredo-123")
	arq := p.a.Enviar(kAna, "segredo-123.pdf", "application/pdf", []byte("%PDF-1.4 de teste"))
	enviarArquivo(t, p.a, kAna, dupla, "m-2", arq.ID)
	criarConversa(t, p.a, kBia, map[string]any{"tipo": "grupo", "nome": "segredo-123", "pessoas": []int64{ana.ID}})

	n := p.logado(t)
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	for _, c := range []string{"/admin/", "/admin/empresas/nova", pagina, pagina + "/apagar"} {
		resp, corpo := n.get(c)
		esperarStatus(t, resp, corpo, http.StatusOK)
		if strings.Contains(corpo, "segredo-123") {
			t.Fatalf("GET %s mostra a conversa:\n%s", c, corpo)
		}
		if c == pagina && (!strings.Contains(corpo, "Ana Souza") || !strings.Contains(corpo, "Beatriz Ramos")) {
			t.Fatalf("a página da empresa não mostra as pessoas:\n%s", corpo)
		}
	}
	if _, corpo := p.navegador(t).get("/admin/entrar"); strings.Contains(corpo, "segredo-123") {
		t.Fatal("a entrada mostra a conversa")
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

func TestEstaticos(t *testing.T) {
	p := novoPainel(t)
	n := p.navegador(t) // sem sessão: a página de entrada também usa
	for nome, tipo := range map[string]string{
		"estilo.css":                     "text/css; charset=utf-8",
		"copiar.js":                      "text/javascript; charset=utf-8",
		"PlusJakartaSans-Variable.woff2": "font/woff2",
		"logo-negativo.png":              "image/png",
		"OFL.txt":                        "text/plain; charset=utf-8",
	} {
		resp, corpo := n.get("/admin/estatico/" + nome)
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != tipo || corpo == "" {
			t.Fatalf("%s = %d, %q, %d bytes", nome, resp.StatusCode, resp.Header.Get("Content-Type"), len(corpo))
		}
	}
	// As três cópias são as do app.
	for nosso, doApp := range map[string]string{
		"PlusJakartaSans-Variable.woff2": "PlusJakartaSans-Variable.woff2",
		"OFL.txt":                        "OFL.txt",
		"logo-negativo.png":              "starsonic-logo-negativo.png",
	} {
		want, err := os.ReadFile(filepath.Join("..", "..", "..", "windows", "ui", "assets", doApp))
		if err != nil {
			t.Fatal(err)
		}
		if _, got := n.get("/admin/estatico/" + nosso); got != string(want) {
			t.Fatalf("%s não é a cópia de %s", nosso, doApp)
		}
	}
	// O que não existe, ou tenta sair da pasta, não sai.
	for _, c := range []string{"/admin/estatico/nada.css", "/admin/estatico/.oculto.css", "/admin/estatico/admin.go"} {
		if resp, _ := n.get(c); resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s = %d; queria 404", c, resp.StatusCode)
		}
	}
	if resp, corpo := n.get("/admin/estatico/..%2fadmin.go"); resp.StatusCode == http.StatusOK || strings.Contains(corpo, "package admin") {
		t.Fatalf("..%%2fadmin.go = %d:\n%s", resp.StatusCode, corpo)
	}
}

func TestSemSessao(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	k := p.a.Ligar(e.Codigo, "NOTE-ANA")
	ana := p.a.Entrar(k, "2003", "Ana Souza")
	antes := estado(p, e.ID)
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	n := p.navegador(t)
	for _, c := range []string{"/admin/", "/admin/empresas/nova", pagina, pagina + "/apagar", "/admin/nada"} {
		resp, corpo := n.get(c)
		esperarIr(t, resp, "/admin/entrar")
		if strings.Contains(corpo, e.Codigo) || strings.Contains(corpo, "Ana Souza") {
			t.Fatalf("GET %s sem sessão mostrou dados:\n%s", c, corpo)
		}
	}
	for _, c := range []string{"/admin/empresas", pagina + "/codigo", fmt.Sprintf("%s/pessoas/%d/tirar", pagina, ana.ID),
		fmt.Sprintf("%s/computadores/%d/tirar", pagina, idDoComputador(p, "NOTE-ANA")), pagina + "/apagar", "/admin/sair"} {
		resp, _ := n.post(c, url.Values{"nome": {"ACME Comércio Ltda"}})
		esperarIr(t, resp, "/admin/entrar")
	}
	// Um cookie inventado também não entra.
	u, _ := url.Parse(p.srv.URL + "/admin/")
	n.c.Jar.SetCookies(u, []*http.Cookie{{Name: "sessao", Value: strings.Repeat("A", 43), Path: "/admin"}})
	resp, _ := n.get("/admin/")
	esperarIr(t, resp, "/admin/entrar")
	if depois := estado(p, e.ID); depois != antes {
		t.Fatalf("sem sessão, o banco mudou: %s; era %s", depois, antes)
	}
}

func TestSair(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	token := cookieDe(t, n, "sessao")
	resp, _ := n.acao("/admin/sair", nil)
	esperarIr(t, resp, "/admin/entrar")
	limpo := false
	for _, c := range resp.Cookies() {
		limpo = limpo || (c.Name == "sessao" && c.MaxAge < 0)
	}
	if !limpo {
		t.Fatalf("o sair não limpou o cookie: %v", resp.Header["Set-Cookie"])
	}
	h := sha256.Sum256([]byte(token))
	if c := p.a.Contar(`SELECT COUNT(*) FROM sessoes_admin WHERE token_hash = ?`, h[:]); c != 0 {
		t.Fatal("a sessão ficou no banco")
	}
	resp, _ = n.get("/admin/")
	esperarIr(t, resp, "/admin/entrar")
	// Quem guardou o cookie não volta com ele.
	outro := p.navegador(t)
	u, _ := url.Parse(p.srv.URL + "/admin/")
	outro.c.Jar.SetCookies(u, []*http.Cookie{{Name: "sessao", Value: token, Path: "/admin"}})
	resp, _ = outro.get("/admin/")
	esperarIr(t, resp, "/admin/entrar")
}

func TestNaoEncontrada(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	for _, c := range []string{"/admin/nada", "/admin/empresas/9999", "/admin/empresas/abc", "/admin/empresas/0",
		"/admin/empresas/9999/apagar"} {
		resp, corpo := n.get(c)
		esperarStatus(t, resp, corpo, http.StatusNotFound)
		if !strings.Contains(corpo, `href="/admin/"`) {
			t.Fatalf("GET %s: a página não leva de volta às empresas:\n%s", c, corpo)
		}
	}
	for _, c := range []string{"/admin/empresas/9999/apagar", "/admin/empresas/9999/pessoas/1/tirar",
		"/admin/empresas/9999/computadores/1/tirar", "/admin/empresas/abc/codigo"} {
		resp, corpo := n.acao(c, url.Values{"nome": {"x"}})
		esperarStatus(t, resp, corpo, http.StatusNotFound)
	}
}

func TestListaDeEmpresas(t *testing.T) {
	p := novoPainel(t)
	acme := p.a.Empresa("ACME Comércio Ltda")
	p.a.Empresa("Clínica Vida")
	k := p.a.Ligar(acme.Codigo, "NOTE-ANA")
	p.a.Entrar(k, "2003", "Ana Souza")
	p.a.Entrar(p.a.Ligar(acme.Codigo, "FIN-01"), "3004", "Beatriz Ramos")
	p.a.Enviar(k, "proposta.pdf", "application/pdf", make([]byte, 1536)) // 1,5 KB
	_, corpo := p.logado(t).get("/admin/")
	// Os totais e as linhas, com o espaço em português.
	for _, s := range []string{">2</", "empresas no chat", "pessoas no chat", "1,5 KB", "de arquivos guardados",
		"Clínica Vida", "0 B", "Nova empresa", `href="/admin/empresas/nova"`,
		"Os arquivos ficam 1 ano no servidor."} {
		if !strings.Contains(corpo, s) {
			t.Fatalf("a lista não tem %q:\n%s", s, corpo)
		}
	}
	// A ACME vem antes da Clínica: em ordem de nome.
	if strings.Index(corpo, "ACME Comércio Ltda") > strings.Index(corpo, "Clínica Vida") {
		t.Fatal("a lista não está em ordem de nome")
	}
}

func TestNomesEscapados(t *testing.T) {
	p := novoPainel(t)
	// Os nomes vêm do app (o do computador, o da pessoa) e da página (o da empresa): nenhum
	// vira HTML, em nenhum lugar da página.
	e := p.a.Empresa(`ACME <b>Ltda</b>`)
	p.a.Entrar(p.a.Ligar(e.Codigo, `PC"><script>x()</script>`), "2003", `Ana <img src=x>`)
	n := p.logado(t)
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	for _, c := range []string{"/admin/", pagina, pagina + "/apagar"} {
		resp, corpo := n.get(c)
		esperarStatus(t, resp, corpo, http.StatusOK)
		for _, cru := range []string{"<b>Ltda</b>", "<script>x()", `"><script>`, "<img src=x>"} {
			if strings.Contains(corpo, cru) {
				t.Fatalf("GET %s tem %q sem escapar:\n%s", c, cru, corpo)
			}
		}
		conferirCabecalhos(t, "GET "+c, resp, corpo)
	}
	if _, corpo := n.get(pagina); !strings.Contains(corpo, "ACME &lt;b&gt;Ltda&lt;/b&gt;") || !strings.Contains(corpo, "Ana &lt;img src=x&gt;") {
		t.Fatalf("os nomes sumiram em vez de aparecer escapados:\n%s", corpo)
	}
	// O nome com HTML também confere para apagar, como está.
	resp, _ := n.acao(pagina+"/apagar", url.Values{"nome": {`ACME <b>Ltda</b>`}})
	esperarIr(t, resp, "/admin/")
}
