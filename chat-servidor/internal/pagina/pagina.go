// Package pagina serve a página das reuniões no navegador: o esqueleto em /r/<código> (o mesmo para qualquer código;
// quem confere o código é a API) e os arquivos estáticos em /r/estatico/. Os cabeçalhos são estritos: a CSP só deixa
// a página falar com a própria origem, com o canal do chat e com o WSS do servidor de vídeo.
package pagina

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
)

//go:embed pagina.html
var esqueletoBase []byte

// marcadorDoApp é o lugar, no pagina.html, das origens que podem mostrar a página dentro de si.
const marcadorDoApp = "{{ORIGENS_DO_APP}}"

// OrigemDoApp é a origem da interface do app do Windows.
const OrigemDoApp = "https://app.starsonic.local"

//go:embed estatico/*
var estaticos embed.FS

// Deps é o que a página usa.
type Deps struct {
	// Video devolve o WSS do servidor de vídeo de agora, ou "" (sem vídeo ligado).
	Video func() string
	// OrigemCanal é o ws:// ou wss:// do próprio chat.
	OrigemCanal string
	// OrigensDoApp: quem mais pode mostrar a página dentro de si (as origens de teste, só no modo de teste), além da OrigemDoApp, que vale
	// sempre. Vazio vale só a OrigemDoApp.
	OrigensDoApp []string
}

// Novo devolve o manipulador de /r/.
func Novo(d Deps) http.Handler {
	origens := origensDoApp(d.OrigensDoApp)
	return &pagina{
		d:       d,
		origens: strings.Join(origens, " "),
		corpo:   bytes.Replace(esqueletoBase, []byte(marcadorDoApp), []byte(strings.Join(origens, " ")), 1),
	}
}

// pagina guarda os bytes do esqueleto já com as origens do app: cada instância serve os seus.
type pagina struct {
	d       Deps
	origens string
	corpo   []byte
}

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
		w.Write(p.corpo)
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
		"connect-src " + connect + "; frame-ancestors " + p.origens + "; base-uri 'none'; form-action 'none'"
}

// hostDoWSS é o que a origem do vídeo pode ter no CSP: letras minúsculas, números, pontos e hífens, e a porta se tiver.
var hostDoWSS = regexp.MustCompile(`^[a-z0-9.-]+(:[0-9]{1,5})?$`)

// origemDoWSS devolve esquema://host[:porta] do WSS de agora, ou "". Só ws e wss entram, e só com o host acima: o
// que sobrar (outro esquema, usuário, colchetes, vírgula, espaço, curinga) deixa o vídeo fora do CSP.
func origemDoWSS(video func() string) string {
	if video == nil {
		return ""
	}
	u, err := url.Parse(video())
	if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.User != nil || !hostDoWSS.MatchString(u.Host) {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// origemDeApp é o que uma origem de quem mostra a página pode ter: http ou https, o host de letras minúsculas, números,
// pontos e hífens e a porta, se tiver, e mais nada (nem caminho, nem usuário, nem espaço, nem ponto e vírgula, nem
// curinga), porque ela entra no cabeçalho e no HTML.
var origemDeApp = regexp.MustCompile(`^https?://[a-z0-9.-]+(:[0-9]{1,5})?$`)

// origensDoApp devolve a OrigemDoApp e, depois dela, as de teste que valem, na ordem dada e sem repetir. Sempre
// devolve ao menos a OrigemDoApp.
func origensDoApp(teste []string) []string {
	origens := []string{OrigemDoApp}
	for _, o := range teste {
		if origemDeApp.MatchString(o) && !slices.Contains(origens, o) {
			origens = append(origens, o)
		}
	}
	return origens
}
