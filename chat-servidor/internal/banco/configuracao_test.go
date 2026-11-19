package banco

import (
	"context"
	"errors"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

func TestConfigReunioes(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()

	// Num banco novo: sem servidor de vídeo e com o limite padrão de 2.
	c, err := b.ConfigReunioes(ctx)
	if err != nil || c != (ConfigReunioes{Limite: 2}) {
		t.Fatalf("ConfigReunioes no banco novo = %+v, %v", c, err)
	}

	if err := b.GuardarServidorVideo(ctx, "video.exemplo.com.br", "chave-de-teste"); err != nil {
		t.Fatal(err)
	}
	if c, err = b.ConfigReunioes(ctx); err != nil || c != (ConfigReunioes{Endereco: "video.exemplo.com.br", Chave: "chave-de-teste", Limite: 2}) {
		t.Fatalf("depois de guardar o servidor = %+v, %v", c, err)
	}
	if err := b.GuardarLimiteReunioes(ctx, 7); err != nil {
		t.Fatal(err)
	}
	if c, _ = b.ConfigReunioes(ctx); c.Limite != 7 || c.Endereco != "video.exemplo.com.br" {
		t.Fatalf("depois de guardar o limite = %+v", c)
	}
	// Guardar de novo troca o valor, sem duplicar a linha.
	if err := b.GuardarServidorVideo(ctx, "outro.exemplo.com.br", "outra"); err != nil {
		t.Fatal(err)
	}
	if err := b.GuardarLimiteReunioes(ctx, 20); err != nil {
		t.Fatal(err)
	}
	if c, _ = b.ConfigReunioes(ctx); c != (ConfigReunioes{Endereco: "outro.exemplo.com.br", Chave: "outra", Limite: 20}) {
		t.Fatalf("depois de trocar = %+v", c)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM configuracao`); n != 3 {
		t.Fatalf("a tabela tem %d linhas; queria 3", n)
	}
	// Limpar o servidor (endereço e chave vazios) vale.
	if err := b.GuardarServidorVideo(ctx, "", ""); err != nil {
		t.Fatal(err)
	}
	if c, _ = b.ConfigReunioes(ctx); c.Endereco != "" || c.Chave != "" || c.Limite != 20 {
		t.Fatalf("depois de limpar = %+v", c)
	}
	// O limite fica de 1 a 20 (docs/chat-protocolo.md, seção 12).
	for _, ruim := range []int{0, -1, 21} {
		if err := b.GuardarLimiteReunioes(ctx, ruim); err == nil {
			t.Errorf("GuardarLimiteReunioes(%d) devia dar erro", ruim)
		}
	}
	if c, _ = b.ConfigReunioes(ctx); c.Limite != 20 {
		t.Fatalf("um limite que não vale mudou o guardado: %+v", c)
	}
}

// TestConfigReunioes_LimiteGuardadoRuim: um valor que não é número (o banco mexido à mão) volta
// ao padrão, em vez de derrubar a leitura.
func TestConfigReunioes_LimiteGuardadoRuim(t *testing.T) {
	b := abrirTeste(t)
	exec(t, b, `INSERT INTO configuracao (chave, valor) VALUES ('limite_reunioes', 'muitas')`)
	if c, err := b.ConfigReunioes(context.Background()); err != nil || c.Limite != 2 {
		t.Fatalf("ConfigReunioes = %+v, %v; queria o limite 2", c, err)
	}
}

// TestLiberarReunioes: o flag da empresa chega ao Empresa.Reunioes em todo caminho que monta uma
// Empresa: ComputadorPorChave (e o ComputadorParaTrocar), EmpresaPorCodigo, Empresas e
// ResumoDaEmpresa.
func TestLiberarReunioes(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	if acme.Reunioes || outra.Reunioes {
		t.Fatalf("uma empresa nova nasce sem as reuniões: %+v %+v", acme, outra)
	}
	_, hash := segredo.NovaChave()
	if _, err := b.LigarComputador(ctx, acme.ID, "PC-ANA", hash); err != nil {
		t.Fatal(err)
	}

	confere := func(quer bool) {
		t.Helper()
		if _, e, err := b.ComputadorPorChave(ctx, hash); err != nil || e.Reunioes != quer {
			t.Errorf("ComputadorPorChave: Reunioes = %v, %v; queria %v", e.Reunioes, err, quer)
		}
		if _, e, err := b.ComputadorParaTrocar(ctx, hash); err != nil || e.Reunioes != quer {
			t.Errorf("ComputadorParaTrocar: Reunioes = %v, %v; queria %v", e.Reunioes, err, quer)
		}
		if e, err := b.EmpresaPorCodigo(ctx, acme.Codigo); err != nil || e.Reunioes != quer {
			t.Errorf("EmpresaPorCodigo: Reunioes = %v, %v; queria %v", e.Reunioes, err, quer)
		}
		lista, err := b.Empresas(ctx)
		if err != nil || len(lista) != 2 {
			t.Fatalf("Empresas = %+v, %v", lista, err)
		}
		for _, r := range lista {
			if quero := quer && r.ID == acme.ID; r.Reunioes != quero {
				t.Errorf("Empresas: %s com Reunioes = %v; queria %v", r.Nome, r.Reunioes, quero)
			}
		}
		if r, err := b.ResumoDaEmpresa(ctx, acme.ID); err != nil || r.Reunioes != quer {
			t.Errorf("ResumoDaEmpresa: Reunioes = %v, %v; queria %v", r.Reunioes, err, quer)
		}
	}
	confere(false)
	if err := b.LiberarReunioes(ctx, acme.ID, true); err != nil {
		t.Fatal(err)
	}
	confere(true)                                                 // e só a ACME: a outra empresa segue sem
	if err := b.LiberarReunioes(ctx, acme.ID, true); err != nil { // liberar de novo não muda nada
		t.Fatal(err)
	}
	confere(true)
	if err := b.LiberarReunioes(ctx, acme.ID, false); err != nil {
		t.Fatal(err)
	}
	confere(false)
	if err := b.LiberarReunioes(ctx, 9999, true); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("empresa que não existe: %v", err)
	}
}
