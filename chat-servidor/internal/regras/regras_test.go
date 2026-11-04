package regras

import (
	"errors"
	"strings"
	"testing"
)

type caso struct {
	nome    string
	entrada string
	saida   string
	ok      bool
}

func rodar(t *testing.T, f func(string) (string, error), casos []caso) {
	t.Helper()
	for _, c := range casos {
		got, err := f(c.entrada)
		if c.ok {
			if err != nil || got != c.saida {
				t.Errorf("%s: (%q) = %q, %v; esperava %q", c.nome, c.entrada, got, err, c.saida)
			}
		} else if err == nil {
			t.Errorf("%s: (%q) devia falhar, deu %q", c.nome, c.entrada, got)
		}
	}
}

func TestRamal(t *testing.T) {
	rodar(t, Ramal, []caso{
		{"tira as pontas", " 2003 ", "2003", true},
		{"32 vale", strings.Repeat("1", 32), strings.Repeat("1", 32), true},
		{"33 não", strings.Repeat("1", 33), "", false},
		{"espaço no meio", "20 03", "", false},
		{"arroba", "2003@x", "", false},
		{"dois pontos", "a:b", "", false},
		{"vazio", "", "", false},
		{"tab", "\t", "", false},
		{"controle", "20\x0003", "", false},
	})
}

func TestNomePessoa(t *testing.T) {
	rodar(t, NomePessoa, []caso{
		{"normal", " Ana Souza ", "Ana Souza", true},
		{"80 vale", strings.Repeat("a", 80), strings.Repeat("a", 80), true},
		{"81 não", strings.Repeat("a", 81), "", false},
		{"controle", "Ana\x00", "", false},
		{"vazio", "  ", "", false},
	})
}

func TestNomeComputador(t *testing.T) {
	rodar(t, NomeComputador, []caso{
		{"normal", "RECEPCAO-01", "RECEPCAO-01", true},
		{"64 vale", strings.Repeat("a", 64), strings.Repeat("a", 64), true},
		{"65 não", strings.Repeat("a", 65), "", false},
		{"controle", "PC\x07", "", false},
		{"vazio", "", "", false},
	})
}

func TestNomeGrupo(t *testing.T) {
	rodar(t, NomeGrupo, []caso{
		{"normal", "Comercial", "Comercial", true},
		{"60 vale", strings.Repeat("a", 60), strings.Repeat("a", 60), true},
		{"61 não", strings.Repeat("a", 61), "", false},
		{"vazio", "", "", false},
	})
}

func TestTexto(t *testing.T) {
	rodar(t, Texto, []caso{
		{"curto", "oi", "oi", true},
		{"4000 runas", strings.Repeat("é", 4000), strings.Repeat("é", 4000), true},
		{"4000 com emoji", strings.Repeat("😀", 4000), strings.Repeat("😀", 4000), true},
		{"4001 não", strings.Repeat("a", 4001), "", false},
		{"4001 emoji não", strings.Repeat("😀", 4001), "", false},
		{"só espaços", "   \n ", "", false},
		{"vazio", "", "", false},
		{"quebra de linha", "linha1\nlinha2", "linha1\nlinha2", true},
		{"controle", "a\x07b", "", false},
		{"utf8 inválido", "a\xffb", "", false},
	})
	_, err := Texto("")
	var e *Erro
	if !errors.As(err, &e) || e.Campo != "texto" {
		t.Fatalf("erro = %#v, esperava *Erro com Campo texto", err)
	}
}

func TestIDLocal(t *testing.T) {
	ok := []string{"a1-B2", strings.Repeat("a", 64)}
	ruim := []string{"a b", strings.Repeat("a", 65), "", "a_b", "é"}
	for _, s := range ok {
		if err := IDLocal(s); err != nil {
			t.Errorf("IDLocal(%q) = %v", s, err)
		}
	}
	for _, s := range ruim {
		var e *Erro
		if err := IDLocal(s); !errors.As(err, &e) || e.Campo != "idLocal" {
			t.Errorf("IDLocal(%q) = %v, esperava erro", s, err)
		}
	}
}

func TestNomeArquivo(t *testing.T) {
	longo := strings.Repeat("a", 300) + ".pdf"
	got := NomeArquivo(longo)
	if len([]rune(got)) != 120 || !strings.HasSuffix(got, ".pdf") {
		t.Errorf("nome longo: %d caracteres, %q", len([]rune(got)), got)
	}
	tab := map[string]string{
		"../../etc/passwd":             "passwd",
		"C:\\x\\Proposta \"ACME\".pdf": "Proposta ACME.pdf",
		"...  ":                        "arquivo",
		"relatório: final?.xlsx":       "relatório final.xlsx",
		"":                             "arquivo",
		"a\x00b\nc.txt":                "abc.txt",
		"pasta/":                       "arquivo",
		"  .oculto.txt ":               "oculto.txt",
		"a<b>|c*.txt":                  "abc.txt",
	}
	for in, esperado := range tab {
		if got := NomeArquivo(in); got != esperado {
			t.Errorf("NomeArquivo(%q) = %q, esperava %q", in, got, esperado)
		}
	}
}

func TestTipoArquivo(t *testing.T) {
	tab := []struct {
		in   string
		tipo string
		foto bool
	}{
		{"image/png", "image/png", true},
		{"IMAGE/JPEG", "image/jpeg", true},
		{"image/gif", "image/gif", true},
		{"image/webp", "image/webp", true},
		{"image/svg+xml", "image/svg+xml", false},
		{"application/pdf; charset=x", "application/pdf", false},
		{"lixo", "application/octet-stream", false},
		{"", "application/octet-stream", false},
		{"a/b/c", "application/octet-stream", false},
	}
	for _, c := range tab {
		tipo, foto := TipoArquivo(c.in)
		if tipo != c.tipo || foto != c.foto {
			t.Errorf("TipoArquivo(%q) = %q, %v; esperava %q, %v", c.in, tipo, foto, c.tipo, c.foto)
		}
	}
}

func TestDobrar(t *testing.T) {
	if got := Dobrar("João Ção ÁÉÍÓÚ ü"); got != "joao cao aeiou u" {
		t.Errorf("Dobrar = %q", got)
	}
	if got := Dobrar("ÀÂÃÄÇÈÊËÌÎÏÑÒÔÕÖÙÛÝ"); got != "aaaaceeeiiinoooouuy" {
		t.Errorf("Dobrar(maiúsculas) = %q", got)
	}
}

func TestErro(t *testing.T) {
	var err error = &Erro{Campo: "ramal"}
	if !strings.Contains(err.Error(), "ramal") {
		t.Fatalf("Error() = %q", err.Error())
	}
}
