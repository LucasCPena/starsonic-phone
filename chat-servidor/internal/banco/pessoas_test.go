package banco

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// computadorTeste liga um computador novo da empresa.
func computadorTeste(t *testing.T, b *Banco, empresaID int64, nome string) Computador {
	t.Helper()
	_, hash := segredo.NovaChave()
	c, err := b.LigarComputador(context.Background(), empresaID, nome, hash)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// entrar faz o computador agir como a pessoa e falha o teste num erro.
func entrar(t *testing.T, b *Banco, c Computador, ramal, nome string) (Pessoa, []int64) {
	t.Helper()
	p, outros, err := b.EntrarComoPessoa(context.Background(), c.ID, c.EmpresaID, ramal, nome)
	if err != nil {
		t.Fatalf("EntrarComoPessoa(%q, %q): %v", ramal, nome, err)
	}
	return p, outros
}

func contar(t *testing.T, b *Banco, q string, args ...any) int {
	t.Helper()
	var n int
	if err := b.db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func TestEntrarComoPessoa_CriaEAtualiza(t *testing.T) {
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(context.Background(), "ACME Comércio Ltda")
	c := computadorTeste(t, b, e.ID, "RECEPCAO-01")

	p, outros := entrar(t, b, c, "2001", "Recepção")
	if p.ID == 0 || p.EmpresaID != e.ID || p.Ramal != "2001" || p.Nome != "Recepção" || p.Saiu || len(outros) != 0 {
		t.Fatalf("primeira entrada = %+v, outros %v", p, outros)
	}
	p2, _ := entrar(t, b, c, "2001", "Recepção 1")
	if p2.ID != p.ID || p2.Nome != "Recepção 1" {
		t.Fatalf("segunda entrada = %+v; queria o id %d com o nome novo", p2, p.ID)
	}

	var nome, busca string
	if err := b.db.QueryRow(`SELECT nome, nome_busca FROM pessoas WHERE id = ?`, p.ID).Scan(&nome, &busca); err != nil {
		t.Fatal(err)
	}
	if nome != "Recepção 1" || busca != regras.Dobrar("Recepção 1") {
		t.Fatalf("nome = %q, nome_busca = %q", nome, busca)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM pessoas`); n != 1 {
		t.Fatalf("%d pessoas; queria 1", n)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM computadores WHERE id = ? AND pessoa_id = ?`, c.ID, p.ID); n != 1 {
		t.Fatal("o computador não age como a pessoa")
	}
}

func TestEntrarComoPessoa_QuemSaiuNaoVolta(t *testing.T) {
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(context.Background(), "ACME Comércio Ltda")
	c := computadorTeste(t, b, e.ID, "RECEPCAO-01")
	p, _ := entrar(t, b, c, "2003", "Ana Souza")
	exec(t, b, `UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, p.ID)

	nova, _ := entrar(t, b, c, "2003", "Ana Souza")
	if nova.ID == p.ID {
		t.Fatal("o mesmo ramal devia virar uma pessoa nova")
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM pessoas WHERE id = ? AND saiu_em = 1`, p.ID); n != 1 {
		t.Fatal("a pessoa que saiu mudou")
	}
}

func TestEntrarComoPessoa_Outros(t *testing.T) {
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(context.Background(), "ACME Comércio Ltda")
	pc := func(nome string) Computador { return computadorTeste(t, b, e.ID, nome) }
	ca, cb, cc, cd, ce := pc("A"), pc("B"), pc("C"), pc("D"), pc("E")

	quer := func(etapa string, outros []int64, ids ...int64) {
		t.Helper()
		if !slices.Equal(outros, ids) {
			t.Fatalf("%s: outros = %v; queria %v", etapa, outros, ids)
		}
	}
	_, outros := entrar(t, b, ca, "2003", "Ana Souza")
	quer("a Ana no A, sozinha", outros)
	_, outros = entrar(t, b, cb, "2003", "Ana Souza")
	quer("a Ana no B", outros, ca.ID)
	_, outros = entrar(t, b, cb, "2003", "Ana Souza")
	quer("a Ana no B de novo", outros)
	_, outros = entrar(t, b, cc, "2003", "Ana Souza")
	quer("a Ana no C", outros, ca.ID, cb.ID)

	// O B passa a agir como a Beatriz, e o A desliga: nenhum dos dois é mais da Ana.
	entrar(t, b, cb, "2004", "Beatriz Lima")
	if err := b.DesligarComputador(context.Background(), ca.ID); err != nil {
		t.Fatal(err)
	}
	_, outros = entrar(t, b, cd, "2003", "Ana Souza")
	quer("a Ana no D", outros, cc.ID)

	// A Beatriz no E: só os computadores que agem como ela agora (o B), não os da Ana.
	_, outros = entrar(t, b, ce, "2004", "Beatriz Lima")
	quer("a Beatriz no E", outros, cb.ID)
}

func TestEntrarComoPessoa_ComputadorFora(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	desligado := computadorTeste(t, b, acme.ID, "VELHO")
	if err := b.DesligarComputador(ctx, desligado.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.EntrarComoPessoa(ctx, desligado.ID, acme.ID, "2003", "Ana Souza"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("computador desligado: %v; queria ErrNaoEncontrado", err)
	}
	// Um computador da outra empresa, com o id da ACME: nada muda.
	daOutra := computadorTeste(t, b, outra.ID, "PC")
	if _, _, err := b.EntrarComoPessoa(ctx, daOutra.ID, acme.ID, "2003", "Ana Souza"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("computador de outra empresa: %v; queria ErrNaoEncontrado", err)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM pessoas`); n != 0 {
		t.Fatalf("ficaram %d pessoas; a transação devia desfazer", n)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM computador_pessoas`); n != 0 {
		t.Fatalf("ficaram %d pares computador-pessoa", n)
	}
}

func TestColegas(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	c := computadorTeste(t, b, acme.ID, "RECEPCAO-01")
	var ids = map[string]int64{}
	for _, p := range []struct{ ramal, nome string }{
		{"2001", "Beatriz"}, {"2002", "Ana"}, {"2003", "Álvaro"}, {"2004", "ana"}, {"2005", "Bruna"}, {"2006", "Carlos"},
	} {
		pessoa, _ := entrar(t, b, c, p.ramal, p.nome)
		ids[p.nome] = pessoa.ID
	}
	exec(t, b, `UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, ids["Bruna"])
	abel, _ := entrar(t, b, computadorTeste(t, b, outra.ID, "PC"), "2001", "Abel")

	lista, err := b.Colegas(ctx, acme.ID, ids["Carlos"])
	if err != nil {
		t.Fatal(err)
	}
	var nomes []string
	for _, p := range lista {
		if p.EmpresaID != acme.ID || p.Saiu || p.ID != ids[p.Nome] {
			t.Fatalf("pessoa inesperada: %+v", p)
		}
		nomes = append(nomes, p.Nome)
	}
	// "Ana" e "ana" têm o mesmo nome_busca: vêm pelo id.
	if quer := []string{"Álvaro", "Ana", "ana", "Beatriz"}; !slices.Equal(nomes, quer) {
		t.Fatalf("colegas = %v; queria %v", nomes, quer)
	}

	// Da outra empresa, só o Abel aparece; sem ele, a lista vem vazia (e não nil, para o JSON).
	daOutra, err := b.Colegas(ctx, outra.ID, 0)
	if err != nil || len(daOutra) != 1 || daOutra[0].ID != abel.ID {
		t.Fatalf("colegas da outra empresa = %+v, %v; queria só o Abel", daOutra, err)
	}
	vazia, err := b.Colegas(ctx, outra.ID, abel.ID)
	if err != nil || vazia == nil || len(vazia) != 0 {
		t.Fatalf("sem colegas = %#v, %v; queria uma lista vazia", vazia, err)
	}
}

func TestPessoaPorID(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana, _ := entrar(t, b, computadorTeste(t, b, acme.ID, "PC"), "2003", "Ana Souza")

	p, err := b.PessoaPorID(ctx, acme.ID, ana.ID)
	if err != nil || p != ana {
		t.Fatalf("PessoaPorID = %+v, %v; queria %+v", p, err, ana)
	}
	if _, err := b.PessoaPorID(ctx, outra.ID, ana.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("pessoa de outra empresa: %v; queria ErrNaoEncontrado", err)
	}
	if _, err := b.PessoaPorID(ctx, acme.ID, ana.ID+1); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("id que não existe: %v; queria ErrNaoEncontrado", err)
	}
	exec(t, b, `UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, ana.ID)
	if p, err := b.PessoaPorID(ctx, acme.ID, ana.ID); err != nil || !p.Saiu {
		t.Fatalf("quem saiu = %+v, %v; queria Saiu", p, err)
	}
}

func TestComputadoresDaPessoa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ca, cb, cc, cd := computadorTeste(t, b, e.ID, "A"), computadorTeste(t, b, e.ID, "B"),
		computadorTeste(t, b, e.ID, "C"), computadorTeste(t, b, e.ID, "D")
	ana, _ := entrar(t, b, ca, "2003", "Ana Souza")
	entrar(t, b, cb, "2003", "Ana Souza")
	entrar(t, b, cc, "2003", "Ana Souza")
	entrar(t, b, cd, "2003", "Ana Souza")
	entrar(t, b, cc, "2004", "Beatriz Lima") // o C agora é da Beatriz
	if err := b.DesligarComputador(ctx, cd.ID); err != nil {
		t.Fatal(err)
	}
	ids, err := b.ComputadoresDaPessoa(ctx, ana.ID)
	if err != nil || !slices.Equal(ids, []int64{ca.ID, cb.ID}) {
		t.Fatalf("ComputadoresDaPessoa = %v, %v; queria [%d %d]", ids, err, ca.ID, cb.ID)
	}
}

func TestComputadorAtivo(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	c := computadorTeste(t, b, e.ID, "RECEPCAO-01")
	if got, err := b.ComputadorAtivo(ctx, c.ID); err != nil || got != c {
		t.Fatalf("sem pessoa: %+v, %v; queria %+v", got, err, c)
	}
	ana, _ := entrar(t, b, c, "2003", "Ana Souza")
	if got, err := b.ComputadorAtivo(ctx, c.ID); err != nil || got.PessoaID != ana.ID {
		t.Fatalf("com a Ana: %+v, %v", got, err)
	}
	if err := b.DesligarComputador(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := b.ComputadorAtivo(ctx, c.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("desligado: %v; queria ErrNaoEncontrado", err)
	}
}
