// Package pagina serve a página das reuniões no navegador: o esqueleto em /r/<código> (o mesmo para qualquer código;
// quem confere o código é a API) e os arquivos estáticos em /r/estatico/. Os cabeçalhos são estritos: a CSP só deixa
// a página falar com a própria origem, com o canal do chat e com o WSS do servidor de vídeo.
package pagina

import (
	"embed"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
)

//go:embed pagina.html
var esqueleto []byte

//go:embed estatico/*
var estaticos embed.FS

// Deps é o que a página usa.
type Deps struct {
	// Video devolve o WSS do servidor de vídeo de agora, ou "" (sem vídeo ligado).
	Video func() string
	// OrigemCanal é o ws:// ou wss:// do próprio chat.
	OrigemCanal string
}

// Novo devolve o manipulador de /r/.
func Novo(d Deps) http.Handler {
	return &pagina{d: d}
}

type pagina struct{ d Deps }

var tipos = map[string]string{
	".js":  "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
}

func (p *pagina) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	resto, ok := strings.CutPrefix(r.URL.Path, "/r/")
	switch {
	case !ok || resto == "":
		http.NotFound(w, r)
	case strings.HasPrefix(resto, "estatico/"):
		p.estatico(w, r, strings.TrimPrefix(resto, "estatico/"))
	case strings.Contains(resto, "/"):
		http.NotFound(w, r)
	default:
		p.esqueleto(w, r)
	}
}

func (p *pagina) esqueleto(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", p.csp())
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-store")
	if r.Method != http.MethodHead {
		w.Write(esqueleto)
	}
}

func (p *pagina) estatico(w http.ResponseWriter, r *http.Request, nome string) {
	// Só um nome simples dentro de estatico/: o fs.ValidPath recusa o "..", e a barra não entra.
	if nome == "" || strings.Contains(nome, "/") || !fs.ValidPath(nome) {
		http.NotFound(w, r)
		return
	}
	corpo, err := estaticos.ReadFile(path.Join("estatico", nome))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	tipo, ok := tipos[path.Ext(nome)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", tipo)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-cache")
	if r.Method != http.MethodHead {
		w.Write(corpo)
	}
}

// csp monta a Content-Security-Policy: o connect-src leva o canal do chat e, havendo vídeo, a origem do WSS dele.
func (p *pagina) csp() string {
	connect := "'self'"
	if p.d.OrigemCanal != "" {
		connect += " " + p.d.OrigemCanal
	}
	if o := origemDoWSS(p.d.Video); o != "" {
		connect += " " + o
	}
	return "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; " +
		"connect-src " + connect + "; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}

// origemDoWSS devolve esquema://host[:porta] do WSS de agora, ou "".
func origemDoWSS(video func() string) string {
	if video == nil {
		return ""
	}
	u, err := url.Parse(video())
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
