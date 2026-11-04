// Package regras tem as regras dos campos (seção 3 do protocolo) e o "sem acento, sem caixa".
package regras

import (
	"mime"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Erro diz qual campo não passou nas regras.
type Erro struct{ Campo string }

func (e *Erro) Error() string { return "campo inválido: " + e.Campo }

func temControle(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// nome confere um nome já sem os espaços das pontas: de 1 a max caracteres, sem controle.
func nome(campo, s string, max int) (string, error) {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	if n < 1 || n > max || !utf8.ValidString(s) || temControle(s) {
		return "", &Erro{Campo: campo}
	}
	return s, nil
}

// Ramal confere o ramal: de 1 a 32 caracteres, sem espaço, tab, @, : nem controle.
func Ramal(s string) (string, error) {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	if n < 1 || n > 32 || !utf8.ValidString(s) {
		return "", &Erro{Campo: "ramal"}
	}
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsControl(r) || r == '@' || r == ':' {
			return "", &Erro{Campo: "ramal"}
		}
	}
	return s, nil
}

// NomePessoa confere o nome de uma pessoa (até 80 caracteres).
func NomePessoa(s string) (string, error) { return nome("nome", s, 80) }

// NomeComputador confere o nome de um computador (até 64 caracteres).
func NomeComputador(s string) (string, error) { return nome("computador", s, 64) }

// NomeGrupo confere o nome de um grupo (até 60 caracteres).
func NomeGrupo(s string) (string, error) { return nome("nome", s, 60) }

// Texto confere o texto de uma mensagem: de 1 a 4.000 pontos de código, não só de espaços;
// só a quebra de linha vale entre os caracteres de controle. O texto volta como veio.
func Texto(s string) (string, error) {
	if !utf8.ValidString(s) {
		return "", &Erro{Campo: "texto"}
	}
	n := utf8.RuneCountInString(s)
	if n < 1 || n > 4000 || strings.TrimSpace(s) == "" {
		return "", &Erro{Campo: "texto"}
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' {
			return "", &Erro{Campo: "texto"}
		}
	}
	return s, nil
}

var reIDLocal = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// IDLocal confere o idLocal que o app gera para cada mensagem.
func IDLocal(s string) error {
	if !reIDLocal.MatchString(s) {
		return &Erro{Campo: "idLocal"}
	}
	return nil
}

// NomeArquivo limpa o nome de um arquivo para guardar: fica só o que vem depois da última / ou \,
// saem controles e : * ? " < > |, e os pontos e espaços das pontas; até 120 caracteres,
// mantendo a extensão. Se ficar vazio, vira "arquivo".
func NomeArquivo(s string) string {
	if i := strings.LastIndexAny(s, `/\`); i >= 0 {
		s = s[i+1:]
	}
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`:*?"<>|`, r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, s)
	corta := func(x string) string { return strings.Trim(x, ". \t") }
	s = corta(s)
	if r := []rune(s); len(r) > 120 {
		ext := ""
		if i := strings.LastIndex(s, "."); i > 0 {
			ext = s[i:]
		}
		if er := []rune(ext); len(er) > 0 && len(er) < 120 {
			base := []rune(s[:len(s)-len(ext)])
			s = string(base[:120-len(er)]) + ext
		} else {
			s = string(r[:120])
		}
		s = corta(s)
	}
	if s == "" {
		return "arquivo"
	}
	return s
}

var reMIME = regexp.MustCompile("^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")

// TipoArquivo devolve o tipo do envio, se for um tipo MIME bem formado; se não,
// application/octet-stream. foto diz se é uma das fotos aceitas.
func TipoArquivo(contentType string) (tipo string, foto bool) {
	t, _, err := mime.ParseMediaType(contentType)
	if err != nil || !reMIME.MatchString(strings.ToLower(t)) {
		return "application/octet-stream", false
	}
	t = strings.ToLower(t)
	switch t {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return t, true
	}
	return t, false
}

// Dobrar deixa o texto sem acento e sem caixa, para a busca e a ordem.
func Dobrar(s string) string {
	return strings.Map(func(r rune) rune {
		r = unicode.ToLower(r)
		if sem, ok := semAcento[r]; ok {
			return sem
		}
		return r
	}, s)
}

// semAcento liga cada letra acentuada (minúscula) à letra base.
var semAcento = func() map[rune]rune {
	grupos := []string{
		"aàáâãäåāăą", "cçćĉċč", "dďđ", "eèéêëēĕėęě", "gĝğġģ", "hĥħ", "iìíîïĩīĭįı", "jĵ", "kķ",
		"lĺļľł", "nñńņň", "oòóôõöøōŏő", "rŕŗř", "sśŝşš", "tţťŧ", "uùúûüũūŭůűų", "wŵ", "yýÿŷ", "zźżž",
	}
	m := map[rune]rune{}
	for _, g := range grupos {
		r := []rune(g)
		for _, x := range r[1:] {
			m[x] = r[0]
		}
	}
	return m
}()
