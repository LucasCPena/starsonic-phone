package banco

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestComputador_LigarAcharDesligar(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	chave, hash := segredo.NovaChave()
	c, err := b.LigarComputador(ctx, e.ID, "RECEPCAO-01", hash)
	if err != nil || c.ID == 0 || c.EmpresaID != e.ID || c.Nome != "RECEPCAO-01" || c.PessoaID != 0 {
		t.Fatalf("Ligar = %+v, %v", c, err)
	}
	c2, e2, err := b.ComputadorPorChave(ctx, segredo.Hash(chave))
	if err != nil || c2 != c || e2 != e {
		t.Fatalf("ComputadorPorChave = %+v %+v, %v", c2, e2, err)
	}
	if _, _, err := b.ComputadorPorChave(ctx, segredo.Hash("outra")); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("chave desconhecida: %v", err)
	}
	if err := b.DesligarComputador(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.ComputadorPorChave(ctx, hash); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("computador desligado: %v", err)
	}
}

func TestComputador_UltimaVezUmaPorMinuto(t *testing.T) {
	b := abrirTeste(t)
	rel := b.Relogio().(*tempo.Teste)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME")
	_, hash := segredo.NovaChave()
	c, _ := b.LigarComputador(ctx, e.ID, "PC", hash)
	ultima := func() int64 {
		var v int64
		if err := b.db.QueryRow("SELECT ultima_vez FROM computadores WHERE id = ?", c.ID).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	inicio := ultima()
	rel.Avancar(30 * time.Second)
	b.ComputadorPorChave(ctx, hash)
	if ultima() != inicio {
		t.Fatal("antes de 1 minuto a ultima_vez não deve mudar")
	}
	rel.Avancar(31 * time.Second)
	b.ComputadorPorChave(ctx, hash)
	if ultima() != inicio+61_000 {
		t.Fatalf("ultima_vez = %d; queria %d", ultima(), inicio+61_000)
	}
}
