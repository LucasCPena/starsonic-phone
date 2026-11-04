package admin_test

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/admin"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

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
