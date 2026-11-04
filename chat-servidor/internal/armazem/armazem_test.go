package armazem

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const idA = "0123456789abcdef0123456789abcdef"

func novo(t *testing.T) (*Armazem, string) {
	t.Helper()
	pasta := filepath.Join(t.TempDir(), "arquivos")
	a, err := Novo(pasta)
	if err != nil {
		t.Fatal(err)
	}
	return a, pasta
}

// arquivosEm lista os arquivos (não as pastas) de baixo da pasta.
func arquivosEm(t *testing.T, pasta string) []string {
	t.Helper()
	var lista []string
	err := filepath.WalkDir(pasta, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			lista = append(lista, p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return lista
}

func TestNovo_CriaAPasta(t *testing.T) {
	_, pasta := novo(t)
	fi, err := os.Stat(pasta)
	if err != nil || !fi.IsDir() || fi.Mode().Perm() != 0o700 {
		t.Fatalf("pasta = %v, %v; queria uma pasta 0700", fi, err)
	}
}

func TestGravar_CaminhoEPermissoes(t *testing.T) {
	a, pasta := novo(t)
	dados := bytes.Repeat([]byte("ACME"), 250)
	n, err := a.Gravar(idA, bytes.NewReader(dados), 1<<20)
	if err != nil || n != int64(len(dados)) {
		t.Fatalf("Gravar = %d, %v", n, err)
	}
	destino := filepath.Join(pasta, "01", idA)
	got, err := os.ReadFile(destino)
	if err != nil || !bytes.Equal(got, dados) {
		t.Fatalf("o arquivo em %s não tem os bytes: %v", destino, err)
	}
	if fi, _ := os.Stat(destino); fi.Mode().Perm() != 0o600 {
		t.Fatalf("permissão do arquivo = %v; queria 0600", fi.Mode().Perm())
	}
	if fi, _ := os.Stat(filepath.Join(pasta, "01")); fi.Mode().Perm() != 0o700 {
		t.Fatalf("permissão da subpasta = %v; queria 0700", fi.Mode().Perm())
	}
	if l := arquivosEm(t, pasta); len(l) != 1 {
		t.Fatalf("arquivos = %v; queria só o gravado, sem temporário", l)
	}
	f, err := a.Abrir(idA)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, _ = io.ReadAll(f)
	if !bytes.Equal(got, dados) {
		t.Fatal("Abrir devolveu outros bytes")
	}
}

func TestGravar_ExatamenteOMaximo(t *testing.T) {
	a, _ := novo(t)
	if n, err := a.Gravar(idA, bytes.NewReader(make([]byte, 100)), 100); err != nil || n != 100 {
		t.Fatalf("Gravar com o máximo exato = %d, %v", n, err)
	}
}

func TestGravar_PassouDoMaximo(t *testing.T) {
	a, pasta := novo(t)
	_, err := a.Gravar(idA, bytes.NewReader(make([]byte, 101)), 100)
	if !errors.Is(err, ErrGrande) {
		t.Fatalf("erro = %v; queria ErrGrande", err)
	}
	if l := arquivosEm(t, pasta); len(l) != 0 {
		t.Fatalf("sobrou %v", l)
	}
	if _, err := a.Abrir(idA); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Abrir = %v; queria não existe", err)
	}
}

// leitorQueFalha entrega alguns bytes e depois dá erro, como uma rede que cai.
type leitorQueFalha struct{ restam int }

func (l *leitorQueFalha) Read(p []byte) (int, error) {
	if l.restam == 0 {
		return 0, io.ErrUnexpectedEOF
	}
	n := min(len(p), l.restam)
	l.restam -= n
	return n, nil
}

func TestGravar_ErroDeLeituraNaoDeixaNada(t *testing.T) {
	a, pasta := novo(t)
	if _, err := a.Gravar(idA, &leitorQueFalha{restam: 5000}, 1<<20); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("erro = %v; queria o erro de leitura", err)
	}
	if l := arquivosEm(t, pasta); len(l) != 0 {
		t.Fatalf("sobrou %v", l)
	}
}

func TestGravar_SobrescreveSemTemporario(t *testing.T) {
	a, pasta := novo(t)
	a.Gravar(idA, strings.NewReader("um"), 10)
	if _, err := a.Gravar(idA, strings.NewReader("dois"), 10); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(pasta, "01", idA))
	if string(got) != "dois" || len(arquivosEm(t, pasta)) != 1 {
		t.Fatalf("conteúdo %q, arquivos %v", got, arquivosEm(t, pasta))
	}
}

func TestIDInvalido(t *testing.T) {
	a, pasta := novo(t)
	for _, id := range []string{"", "../../etc/passwd", "0123456789ABCDEF0123456789ABCDEF", idA[:31], idA + "0", idA[:30] + "/x"} {
		if _, err := a.Gravar(id, strings.NewReader("x"), 10); !errors.Is(err, ErrID) {
			t.Errorf("Gravar(%q) = %v; queria ErrID", id, err)
		}
		if _, err := a.Abrir(id); !errors.Is(err, ErrID) {
			t.Errorf("Abrir(%q) = %v; queria ErrID", id, err)
		}
		if err := a.Apagar(id); !errors.Is(err, ErrID) {
			t.Errorf("Apagar(%q) = %v; queria ErrID", id, err)
		}
	}
	if l := arquivosEm(t, filepath.Dir(pasta)); len(l) != 0 {
		t.Fatalf("saiu da pasta: %v", l)
	}
}

func TestMiniatura(t *testing.T) {
	a, pasta := novo(t)
	if _, err := a.AbrirMiniatura(idA); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("sem miniatura: %v", err)
	}
	if _, err := a.GravarMiniatura(idA, strings.NewReader("primeira"), 100); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GravarMiniatura(idA, strings.NewReader("segunda"), 100); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(pasta, "01", idA+".mini"))
	if err != nil || string(got) != "segunda" {
		t.Fatalf("miniatura = %q, %v", got, err)
	}
	if _, err := a.GravarMiniatura(idA, strings.NewReader(strings.Repeat("x", 101)), 100); !errors.Is(err, ErrGrande) {
		t.Fatalf("miniatura grande: %v", err)
	}
	got, _ = os.ReadFile(filepath.Join(pasta, "01", idA+".mini"))
	if string(got) != "segunda" || len(arquivosEm(t, pasta)) != 1 {
		t.Fatalf("a miniatura grande mexeu no disco: %q %v", got, arquivosEm(t, pasta))
	}
	f, err := a.AbrirMiniatura(idA)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
}

func TestApagar(t *testing.T) {
	a, pasta := novo(t)
	a.Gravar(idA, strings.NewReader("arquivo"), 100)
	a.GravarMiniatura(idA, strings.NewReader("mini"), 100)
	if err := a.Apagar(idA); err != nil {
		t.Fatal(err)
	}
	if l := arquivosEm(t, pasta); len(l) != 0 {
		t.Fatalf("sobrou %v", l)
	}
	if err := a.Apagar(idA); err != nil {
		t.Fatalf("Apagar de novo: %v", err)
	}
	if err := a.Apagar("ffffffffffffffffffffffffffffffff"); err != nil {
		t.Fatalf("Apagar do que nunca existiu: %v", err)
	}
}

func TestApagarMiniatura_DeixaOArquivo(t *testing.T) {
	a, pasta := novo(t)
	a.Gravar(idA, strings.NewReader("arquivo"), 100)
	a.GravarMiniatura(idA, strings.NewReader("mini"), 100)
	if err := a.ApagarMiniatura(idA); err != nil {
		t.Fatal(err)
	}
	if l := arquivosEm(t, pasta); len(l) != 1 || filepath.Base(l[0]) != idA {
		t.Fatalf("arquivos = %v", l)
	}
	if err := a.ApagarMiniatura(idA); err != nil {
		t.Fatal(err)
	}
}
