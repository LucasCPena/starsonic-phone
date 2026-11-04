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

// TestArquivoParaBaixar_ComoAsMensagens: uma pessoa baixa o arquivo exatamente quando a
// mensagem dele aparece para ela nas Mensagens, ou quando ela é a autora (que baixa até depois
// de sair do grupo).
func TestArquivoParaBaixar_ComoAsMensagens(t *testing.T) {
	ctx := context.Background()
	// cena monta a ACME (Ana, Beatriz, Carlos) e a Outra (Abel), um grupo da Ana com a
	// Beatriz, e um arquivo da Ana numa mensagem do grupo. O caso mexe nas pessoas depois.
	type cena struct {
		c      cenaMensagens
		carlos Pessoa
		grupo  int64
	}
	nova := func(t *testing.T, naDupla bool) cena {
		c := novaCenaMensagens(t)
		emp := c.ana.EmpresaID
		carlos := pessoaDe(t, c.b, emp, "2005", "Carlos")
		g, _, err := c.b.CriarGrupo(ctx, emp, c.ana.ID, "Comercial", []int64{c.bia.ID})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := c.b.CriarArquivo(ctx, idArq, emp, c.ana.ID, "Proposta ACME.pdf", "application/pdf", 1000); err != nil {
			t.Fatal(err)
		}
		avancar(c.b, time.Minute)
		onde := g
		if naDupla {
			onde = c.dupla
		}
		if _, _, err := c.b.EnviarArquivo(ctx, c.ana.ID, onde, "m1", idArq); err != nil {
			t.Fatal(err)
		}
		avancar(c.b, time.Minute)
		return cena{c, carlos, g}
	}
	casos := []struct {
		nome    string
		naDupla bool // o arquivo vai numa mensagem da conversa a dois, não do grupo
		monta   func(t *testing.T, s cena) (conversa int64, quem Pessoa)
		baixa   bool
	}{
		{"duplaAutora", true, func(t *testing.T, s cena) (int64, Pessoa) { return s.c.dupla, s.c.ana }, true},
		{"duplaOutraPessoa", true, func(t *testing.T, s cena) (int64, Pessoa) { return s.c.dupla, s.c.bia }, true},
		{"membroDeAntes", false, func(t *testing.T, s cena) (int64, Pessoa) { return s.grupo, s.c.bia }, true},
		{"entrouDepois", false, func(t *testing.T, s cena) (int64, Pessoa) {
			if _, err := s.c.b.PorNoGrupo(ctx, s.c.ana.ID, s.grupo, []int64{s.carlos.ID}); err != nil {
				t.Fatal(err)
			}
			return s.grupo, s.carlos
		}, false},
		{"saiu", false, func(t *testing.T, s cena) (int64, Pessoa) {
			if _, err := s.c.b.TirarMembro(ctx, s.c.bia.ID, s.grupo, s.c.bia.ID); err != nil {
				t.Fatal(err)
			}
			return s.grupo, s.c.bia
		}, false},
		{"tirada", false, func(t *testing.T, s cena) (int64, Pessoa) {
			if _, err := s.c.b.TirarMembro(ctx, s.c.ana.ID, s.grupo, s.c.bia.ID); err != nil {
				t.Fatal(err)
			}
			return s.grupo, s.c.bia
		}, false},
		{"mesmaEmpresaForaDoGrupo", false, func(t *testing.T, s cena) (int64, Pessoa) { return s.grupo, s.carlos }, false},
		{"outraEmpresa", false, func(t *testing.T, s cena) (int64, Pessoa) { return s.grupo, s.c.abe }, false},
		{"autoraDepoisDeSair", false, func(t *testing.T, s cena) (int64, Pessoa) {
			if _, err := s.c.b.TirarMembro(ctx, s.c.ana.ID, s.grupo, s.c.ana.ID); err != nil {
				t.Fatal(err)
			}
			return s.grupo, s.c.ana
		}, true},
	}
	for _, k := range casos {
		t.Run(k.nome, func(t *testing.T) {
			s := nova(t, k.naDupla)
			conversa, quem := k.monta(t, s)
			// A mensagem aparece para a pessoa nas Mensagens?
			veNasMensagens := false
			ms, _, err := s.c.b.Mensagens(ctx, quem.ID, conversa, 0, 0, MaxPagina)
			if err != nil && !errors.Is(err, ErrNaoEncontrado) {
				t.Fatal(err)
			}
			for _, m := range ms {
				if m.Arquivo != nil && m.Arquivo.ID == idArq {
					veNasMensagens = true
				}
			}
			autora := quem.ID == s.c.ana.ID
			_, err = s.c.b.ArquivoParaBaixar(ctx, quem.EmpresaID, quem.ID, idArq)
			if err != nil && !errors.Is(err, ErrNaoEncontrado) {
				t.Fatal(err)
			}
			baixou := err == nil
			if quer := veNasMensagens || autora; baixou != quer {
				t.Fatalf("baixou = %v; as Mensagens (%v) ou a autoria (%v) dizem %v", baixou, veNasMensagens, autora, quer)
			}
			if baixou != k.baixa {
				t.Fatalf("baixou = %v; queria %v", baixou, k.baixa)
			}
		})
	}
}
