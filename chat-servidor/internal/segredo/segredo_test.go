package segredo

import (
	"bytes"
	"regexp"
	"testing"
)

func TestNovoCodigo_Formato(t *testing.T) {
	re := regexp.MustCompile(`^STAR-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$`)
	vistos := map[string]bool{}
	for i := 0; i < 1000; i++ {
		c := NovoCodigo()
		if !re.MatchString(c) {
			t.Fatalf("código fora do formato: %q", c)
		}
		if vistos[c] {
			t.Fatalf("código repetido: %q", c)
		}
		vistos[c] = true
	}
}

func TestNormalizarCodigo(t *testing.T) {
	validos := map[string]string{
		" star 7kq4 9xwp ": "STAR-7KQ4-9XWP",
		"STAR7KQ49XWP":     "STAR-7KQ4-9XWP",
		"STAR-7KQ4-9XWP":   "STAR-7KQ4-9XWP",
	}
	for in, esperado := range validos {
		got, ok := NormalizarCodigo(in)
		if !ok || got != esperado {
			t.Errorf("NormalizarCodigo(%q) = %q, %v; esperava %q, true", in, got, ok, esperado)
		}
	}
	for _, in := range []string{"STAR-7KQ4-9XW", "STAR-7KQ4-9XWI", "XTAR-7KQ4-9XWP", "", "STAR-7KQ4-9XWP1", "STAR-7KQ4-9XW0"} {
		if got, ok := NormalizarCodigo(in); ok {
			t.Errorf("NormalizarCodigo(%q) = %q, true; esperava inválido", in, got)
		}
	}
}

func TestNovaChave(t *testing.T) {
	re := regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	c1, h1 := NovaChave()
	c2, _ := NovaChave()
	if !re.MatchString(c1) {
		t.Fatalf("chave fora do formato: %q", c1)
	}
	if !bytes.Equal(Hash(c1), h1) {
		t.Fatal("Hash(chave) difere do hash devolvido")
	}
	if len(h1) != 32 {
		t.Fatalf("hash de %d bytes", len(h1))
	}
	if c1 == c2 {
		t.Fatal("duas chaves iguais")
	}
}

func TestNovoBilhete(t *testing.T) {
	b1, b2 := NovoBilhete(), NovoBilhete()
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(b1) || b1 == b2 {
		t.Fatalf("bilhetes ruins: %q %q", b1, b2)
	}
}

func TestNovoIDArquivo(t *testing.T) {
	re := regexp.MustCompile(`^[0-9a-f]{32}$`)
	a, b := NovoIDArquivo(), NovoIDArquivo()
	if !re.MatchString(a) || !re.MatchString(b) || a == b {
		t.Fatalf("ids ruins: %q %q", a, b)
	}
}

func TestNovoToken(t *testing.T) {
	re := regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	vistos := map[string]bool{}
	for i := 0; i < 100; i++ {
		s := NovoToken()
		if !re.MatchString(s) {
			t.Fatalf("token fora do formato: %q", s)
		}
		if vistos[s] {
			t.Fatalf("token repetido: %q", s)
		}
		vistos[s] = true
	}
}
