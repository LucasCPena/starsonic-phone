package banco

import (
	"context"
	"errors"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

func TestCriarEmpresa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, err := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	if err != nil {
		t.Fatal(err)
	}
	if e.ID == 0 || e.Nome != "ACME Comércio Ltda" || e.CriadaEm != 1_700_000_000_000 {
		t.Fatalf("empresa = %+v", e)
	}
	if _, ok := segredo.NormalizarCodigo(e.Codigo); !ok {
		t.Fatalf("código inválido: %q", e.Codigo)
	}
	e2, err := b.EmpresaPorCodigo(ctx, e.Codigo)
	if err != nil || e2 != e {
		t.Fatalf("EmpresaPorCodigo = %+v, %v", e2, err)
	}
	if _, err := b.EmpresaPorCodigo(ctx, "STAR-AAAA-BBBB"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("código que não existe: %v", err)
	}
}
