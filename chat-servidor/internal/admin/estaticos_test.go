package admin_test

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/admin"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

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
