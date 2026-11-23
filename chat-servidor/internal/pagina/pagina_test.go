package pagina

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const cspBase = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self' "
const cspFim = "; frame-ancestors https://app.starsonic.local; base-uri 'none'; form-action 'none'"

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

// A origem do vídeo só entra no CSP quando é ws ou wss, com o host de letras minúsculas, números, pontos e hífens e a
// porta, se tiver; qualquer outra coisa deixa a origem de fora.
func TestPagina_OrigemDoVideoSoQuandoServe(t *testing.T) {
	boas := map[string]string{
		"wss://video.exemplo.com.br/sip":      "wss://video.exemplo.com.br",
		"wss://video.exemplo.com.br:7443/sip": "wss://video.exemplo.com.br:7443",
		"ws://127.0.0.1:9443/sip":             "ws://127.0.0.1:9443",
	}
	for video, origem := range boas {
		if got := origemDoWSS(func() string { return video }); got != origem {
			t.Errorf("origemDoWSS(%q) = %q, queria %q", video, got, origem)
		}
	}
	ruins := []string{
		"", "video.exemplo.com.br", "https://video.exemplo.com.br/sip", "http://video.exemplo.com.br",
		"ftp://video.exemplo.com.br",
		"wss://", "wss://Video.Exemplo.com.br/sip", "wss://video.exemplo.com.br:/sip", "wss://video.exemplo.com.br:abc/sip",
		"wss://video.exemplo.com.br:123456/sip", "wss://usuario@video.exemplo.com.br/sip", "wss://[::1]:7443/sip",
		"wss://video_exemplo.com.br/sip", "wss://video.exemplo.com.br%3Bscript-src/sip", "wss://*.exemplo.com.br/sip",
		"wss://video.exemplo.com.br,evil.com/sip",
	}
	for _, video := range ruins {
		if got := origemDoWSS(func() string { return video }); got != "" {
			t.Errorf("origemDoWSS(%q) = %q, queria vazio", video, got)
		}
		want := cspBase + "wss://chat.exemplo.com.br" + cspFim
		if got := pedir(novoPadrao(video), "GET", "/r/k7q49xwpht").Header().Get("Content-Security-Policy"); got != want {
			t.Errorf("o CSP com o vídeo %q:\n got %q\nwant %q", video, got, want)
		}
	}
}

func TestPagina_Estaticos(t *testing.T) {
	h := novoPadrao("")
	casos := map[string]string{
		"/r/estatico/inicio.js":         "text/javascript; charset=utf-8",
		"/r/estatico/pagina.css":        "text/css; charset=utf-8",
		"/r/estatico/jssip-licenca.txt": "text/plain; charset=utf-8",
		// Os arquivos do chat da reunião e o do sinalizador de qualidade: como os outros, nunca vêm do cache (no dia
		// de uma atualização, a página nova não roda com uma peça velha).
		"/r/estatico/mensagens.js": "text/javascript; charset=utf-8",
		"/r/estatico/painel.js":    "text/javascript; charset=utf-8",
		"/r/estatico/qualidade.js": "text/javascript; charset=utf-8",
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

func frameAncestorsDe(t *testing.T, csp string) string {
	t.Helper()
	for _, d := range strings.Split(csp, "; ") {
		if v, ok := strings.CutPrefix(d, "frame-ancestors "); ok {
			return v
		}
	}
	t.Fatalf("o CSP não tem frame-ancestors: %q", csp)
	return ""
}

func metaDoApp(t *testing.T, corpo string) string {
	t.Helper()
	const ini = `<meta name="starsonic-app" content="`
	i := strings.Index(corpo, ini)
	if i < 0 {
		t.Fatalf("o HTML não tem o meta starsonic-app")
	}
	resto := corpo[i+len(ini):]
	return resto[:strings.Index(resto, `"`)]
}

func TestCSP_FrameAncestorsDoApp(t *testing.T) {
	rec := pedir(novoPadrao(""), "GET", "/r/k7q49xwpht")
	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors https://app.starsonic.local;") {
		t.Errorf("o CSP não deixa o app mostrar a página: %q", csp)
	}
	if strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("o CSP ainda proíbe a moldura: %q", csp)
	}
}

func TestCSP_OrigensDeTeste(t *testing.T) {
	h := Novo(Deps{OrigemCanal: "wss://chat.exemplo.com.br", OrigensDoApp: []string{"http://127.0.0.1:4194", "https://outra.exemplo.com.br:8443"}})
	rec := pedir(h, "GET", "/r/k7q49xwpht")
	want := "https://app.starsonic.local http://127.0.0.1:4194 https://outra.exemplo.com.br:8443"
	if got := frameAncestorsDe(t, rec.Header().Get("Content-Security-Policy")); got != want {
		t.Errorf("frame-ancestors:\n got %q\nwant %q", got, want)
	}
	if got := metaDoApp(t, rec.Body.String()); got != want {
		t.Errorf("meta:\n got %q\nwant %q", got, want)
	}
	// A origem repetida (inclusive a do app) aparece uma vez só.
	h = Novo(Deps{OrigensDoApp: []string{OrigemDoApp, "http://127.0.0.1:4194", "http://127.0.0.1:4194"}})
	rec = pedir(h, "GET", "/r/k7q49xwpht")
	if got := frameAncestorsDe(t, rec.Header().Get("Content-Security-Policy")); got != OrigemDoApp+" http://127.0.0.1:4194" {
		t.Errorf("repetidas: %q", got)
	}
}

func TestCSP_OrigemQueNaoVale(t *testing.T) {
	ruins := []string{
		"http://a.exemplo.com.br http://b.exemplo.com.br", // espaço
		"https://a.exemplo.com.br;",                       // ponto e vírgula
		"https://a.exemplo.com.br/caminho",                // caminho
		"https://*.exemplo.com.br",                        // curinga
		"*",                                               // curinga puro
		"a.exemplo.com.br",                                // sem esquema
		"ftp://a.exemplo.com.br",                          // outro esquema
		"https://ana@a.exemplo.com.br",                    // usuário
		"https://a.exemplo.com.br?x=1",                    // consulta
		"",
	}
	h := Novo(Deps{OrigensDoApp: append(append([]string{}, ruins...), "http://127.0.0.1:4194")})
	rec := pedir(h, "GET", "/r/k7q49xwpht")
	want := OrigemDoApp + " http://127.0.0.1:4194"
	if got := frameAncestorsDe(t, rec.Header().Get("Content-Security-Policy")); got != want {
		t.Errorf("frame-ancestors:\n got %q\nwant %q", got, want)
	}
	if got := metaDoApp(t, rec.Body.String()); got != want {
		t.Errorf("meta:\n got %q\nwant %q", got, want)
	}
}

func TestEsqueleto_MetaDoApp(t *testing.T) {
	rec := pedir(novoPadrao(""), "GET", "/r/k7q49xwpht")
	corpo := rec.Body.String()
	if !strings.Contains(corpo, `<meta name="starsonic-app" content="https://app.starsonic.local">`) {
		t.Errorf("o meta não é o esperado")
	}
	if strings.Contains(corpo, "{{") || strings.Contains(corpo, "}}") {
		t.Errorf("sobrou um marcador por trocar")
	}
	// Cada instância serve os seus bytes.
	outra := pedir(Novo(Deps{OrigensDoApp: []string{"http://127.0.0.1:4194"}}), "GET", "/r/k7q49xwpht").Body.String()
	if got := metaDoApp(t, outra); got != OrigemDoApp+" http://127.0.0.1:4194" {
		t.Errorf("a outra instância: %q", got)
	}
	if got := metaDoApp(t, pedir(novoPadrao(""), "GET", "/r/k7q49xwpht").Body.String()); got != OrigemDoApp {
		t.Errorf("a primeira instância mudou: %q", got)
	}
}

func TestCSP_ORestoNaoMudou(t *testing.T) {
	want := "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; " +
		"connect-src 'self' wss://chat.exemplo.com.br wss://video.exemplo.com.br:7443; " +
		"frame-ancestors https://app.starsonic.local; base-uri 'none'; form-action 'none'"
	rec := pedir(novoPadrao("wss://video.exemplo.com.br:7443/sip"), "GET", "/r/k7q49xwpht")
	if got := rec.Header().Get("Content-Security-Policy"); got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}
