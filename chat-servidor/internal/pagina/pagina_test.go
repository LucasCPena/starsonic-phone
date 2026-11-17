package pagina

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const cspBase = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self' "
const cspFim = "; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

func pedir(h http.Handler, metodo, caminho string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(metodo, caminho, nil))
	return rec
}

func novoPadrao(video string) http.Handler {
	return Novo(Deps{Video: func() string { return video }, OrigemCanal: "wss://chat.exemplo.com.br"})
}

func TestPagina_QualquerCodigo(t *testing.T) {
	h := novoPadrao("")
	for _, c := range []string{"/r/k7q49xwpht", "/r/qualquercoisa"} {
		rec := pedir(h, "GET", c)
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", c, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Errorf("%s: Content-Type %q", c, ct)
		}
		if !strings.Contains(rec.Body.String(), "/r/estatico/inicio.js") {
			t.Errorf("%s: o corpo não leva o inicio.js", c)
		}
	}
}

func TestPagina_Cabecalhos(t *testing.T) {
	rec := pedir(novoPadrao("wss://video.exemplo.com.br:7443/sip"), "GET", "/r/k7q49xwpht")
	quer := map[string]string{
		"Content-Security-Policy": cspBase + "wss://chat.exemplo.com.br wss://video.exemplo.com.br:7443" + cspFim,
		"Referrer-Policy":         "no-referrer",
		"Permissions-Policy":      "camera=(self), microphone=(self), display-capture=(self)",
		"X-Content-Type-Options":  "nosniff",
		"Cache-Control":           "no-store",
	}
	for k, v := range quer {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s:\n got %q\nwant %q", k, got, v)
		}
	}
}

func TestPagina_SemVideo(t *testing.T) {
	rec := pedir(novoPadrao(""), "GET", "/r/k7q49xwpht")
	want := cspBase + "wss://chat.exemplo.com.br" + cspFim
	if got := rec.Header().Get("Content-Security-Policy"); got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}

func TestPagina_Teste(t *testing.T) {
	h := Novo(Deps{Video: func() string { return "ws://127.0.0.1:9443/sip" }, OrigemCanal: "ws://127.0.0.1:8090"})
	rec := pedir(h, "GET", "/r/k7q49xwpht")
	want := cspBase + "ws://127.0.0.1:8090 ws://127.0.0.1:9443" + cspFim
	if got := rec.Header().Get("Content-Security-Policy"); got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}

func TestPagina_Estaticos(t *testing.T) {
	h := novoPadrao("")
	casos := map[string]string{
		"/r/estatico/inicio.js":         "text/javascript; charset=utf-8",
		"/r/estatico/pagina.css":        "text/css; charset=utf-8",
		"/r/estatico/jssip-licenca.txt": "text/plain; charset=utf-8",
	}
	for caminho, tipo := range casos {
		rec := pedir(h, "GET", caminho)
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", caminho, rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != tipo {
			t.Errorf("%s: Content-Type %q, quer %q", caminho, got, tipo)
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q", caminho, got)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("%s: Cache-Control %q", caminho, got)
		}
	}
}

func TestPagina_NaoEncontrado(t *testing.T) {
	h := novoPadrao("")
	for _, c := range []string{"/r/", "/r/a/b", "/r/estatico/nada.js", "/r/estatico/..%2fpagina.go"} {
		if rec := pedir(h, "GET", c); rec.Code != 404 {
			t.Errorf("%s: status %d, quer 404", c, rec.Code)
		}
	}
}

func TestPagina_SoLeitura(t *testing.T) {
	if rec := pedir(novoPadrao(""), "POST", "/r/k7q49xwpht"); rec.Code != 405 {
		t.Errorf("status %d, quer 405", rec.Code)
	}
}
