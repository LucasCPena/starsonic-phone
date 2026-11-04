package banco

import (
	"context"
	"errors"
	"testing"
	"time"
)

const idArq = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestCriarArquivo(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	a, err := c.b.CriarArquivo(ctx, idArq, c.ana.EmpresaID, c.ana.ID, "Proposta ACME.pdf", "application/pdf", 1000)
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != idArq || a.Nome != "Proposta ACME.pdf" || a.Tipo != "application/pdf" || a.Tamanho != 1000 ||
		a.Foto || a.Miniatura || a.Expirado {
		t.Fatalf("arquivo = %+v", a)
	}
	f, err := c.b.CriarArquivo(ctx, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", c.ana.EmpresaID, c.ana.ID, "foto.png", "image/png", 5)
	if err != nil || !f.Foto {
		t.Fatalf("foto = %+v, %v", f, err)
	}
	// O mesmo id duas vezes não vale.
	if _, err := c.b.CriarArquivo(ctx, idArq, c.ana.EmpresaID, c.ana.ID, "x", "text/plain", 1); err == nil {
		t.Fatal("criou duas vezes o mesmo id")
	}
	// Uma pessoa de outra empresa não é autora de um arquivo desta.
	if _, err := c.b.CriarArquivo(ctx, "cccccccccccccccccccccccccccccccc", c.ana.EmpresaID, c.abe.ID, "x", "text/plain", 1); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("autor de outra empresa: %v", err)
	}
	if n := contar(t, c.b, `SELECT COUNT(*) FROM arquivos`); n != 2 {
		t.Fatalf("arquivos = %d; queria 2", n)
	}
}

func TestArquivoParaBaixar_Dupla(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	emp := c.ana.EmpresaID
	c.b.CriarArquivo(ctx, idArq, emp, c.ana.ID, "Proposta ACME.pdf", "application/pdf", 1000)

	// Antes da mensagem, só quem enviou baixa.
	if a, err := c.b.ArquivoParaBaixar(ctx, emp, c.ana.ID, idArq); err != nil || a.Nome != "Proposta ACME.pdf" {
		t.Fatalf("autora: %+v, %v", a, err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.bia.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Beatriz antes da mensagem: %v", err)
	}
	if _, _, err := c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "m1", idArq); err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.bia.ID, idArq); err != nil {
		t.Fatalf("Beatriz depois da mensagem: %v", err)
	}
	// De outra empresa, com o id da empresa dela ou da outra: nunca.
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.abe.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Abel com a empresa da ACME: %v", err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, c.abe.EmpresaID, c.abe.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Abel com a empresa dele: %v", err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, c.abe.EmpresaID, c.ana.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Ana com a empresa errada: %v", err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.ana.ID, "ffffffffffffffffffffffffffffffff"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("id que não existe: %v", err)
	}
}

func TestArquivoParaBaixar_Grupo(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	emp := c.ana.EmpresaID
	carlos := pessoaDe(t, c.b, emp, "2005", "Carlos")
	g, _, err := c.b.CriarGrupo(ctx, emp, c.ana.ID, "Comercial", []int64{c.bia.ID})
	if err != nil {
		t.Fatal(err)
	}
	c.b.CriarArquivo(ctx, idArq, emp, c.ana.ID, "Proposta ACME.pdf", "application/pdf", 1000)
	avancar(c.b, time.Minute)
	if _, _, err := c.b.EnviarArquivo(ctx, c.ana.ID, g, "m1", idArq); err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.bia.ID, idArq); err != nil {
		t.Fatalf("membro: %v", err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, carlos.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("fora do grupo: %v", err)
	}
	// Quem entra depois não vê a mensagem de antes, então não baixa.
	avancar(c.b, time.Minute)
	if _, err := c.b.PorNoGrupo(ctx, c.ana.ID, g, []int64{carlos.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, carlos.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("entrou depois da mensagem: %v", err)
	}
	// Quem saiu do grupo deixa de baixar; quem enviou segue baixando.
	if _, err := c.b.TirarMembro(ctx, c.bia.ID, g, c.bia.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.bia.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("quem saiu: %v", err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.ana.ID, idArq); err != nil {
		t.Fatalf("autora: %v", err)
	}
}

func TestArquivoParaBaixar_Expirado(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	emp := c.ana.EmpresaID
	c.b.CriarArquivo(ctx, idArq, emp, c.ana.ID, "a.pdf", "application/pdf", 1)
	c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "m1", idArq)
	if _, err := c.b.db.Exec(`UPDATE arquivos SET expirado_em = ?`, c.b.agoraMs()); err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.ArquivoParaBaixar(ctx, emp, c.bia.ID, idArq); !errors.Is(err, ErrExpirado) {
		t.Fatalf("expirado: %v", err)
	}
	// Quem não pode baixar continua vendo 404, não 410: não revela que o arquivo existiu.
	if _, err := c.b.ArquivoParaBaixar(ctx, c.abe.EmpresaID, c.abe.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("expirado, de outra empresa: %v", err)
	}
}

func TestMiniatura_Marcar(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	emp := c.ana.EmpresaID
	c.b.CriarArquivo(ctx, idArq, emp, c.ana.ID, "foto.png", "image/png", 10)
	c.b.CriarArquivo(ctx, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", emp, c.ana.ID, "a.pdf", "application/pdf", 10)

	if a, err := c.b.ArquivoDoAutor(ctx, emp, c.ana.ID, idArq); err != nil || !a.Foto {
		t.Fatalf("ArquivoDoAutor = %+v, %v", a, err)
	}
	if _, err := c.b.ArquivoDoAutor(ctx, emp, c.bia.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("ArquivoDoAutor de outra pessoa: %v", err)
	}
	if err := c.b.MarcarMiniatura(ctx, c.bia.ID, idArq); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Beatriz: %v", err)
	}
	if err := c.b.MarcarMiniatura(ctx, c.ana.ID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); !errors.Is(err, ErrInvalido) {
		t.Fatalf("PDF: %v", err)
	}
	if err := c.b.MarcarMiniatura(ctx, c.ana.ID, idArq); err != nil {
		t.Fatal(err)
	}
	if err := c.b.MarcarMiniatura(ctx, c.ana.ID, idArq); err != nil { // de novo substitui
		t.Fatal(err)
	}
	if n := contar(t, c.b, `SELECT miniatura FROM arquivos WHERE id = ?`, idArq); n != 1 {
		t.Fatalf("miniatura = %d", n)
	}
	c.b.db.Exec(`UPDATE arquivos SET expirado_em = 1 WHERE id = ?`, idArq)
	if err := c.b.MarcarMiniatura(ctx, c.ana.ID, idArq); !errors.Is(err, ErrExpirado) {
		t.Fatalf("expirado: %v", err)
	}
}
