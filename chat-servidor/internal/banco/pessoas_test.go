package banco

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

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

func TestPessoasDaEmpresa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")

	noteAna := computadorTeste(t, b, acme.ID, "NOTE-ANA")
	recepcao := computadorTeste(t, b, acme.ID, "RECEPCAO-02")
	fin := computadorTeste(t, b, acme.ID, "FIN-01")
	velho := computadorTeste(t, b, acme.ID, "VELHO-01")
	doCarlos := computadorTeste(t, b, acme.ID, "COMERCIAL-03")
	daOutra := computadorTeste(t, b, outra.ID, "PC-ABEL")

	// Cada entrada num minuto: a última vez de uma pessoa num computador é a da entrada dela
	// nele, não a do computador.
	entrarNoMinuto := func(c Computador, ramal, nome string) Pessoa {
		avancar(b, time.Minute)
		p, _ := entrar(t, b, c, ramal, nome)
		return p
	}
	ana := entrarNoMinuto(noteAna, "2003", "Ana Souza")       // 1
	entrarNoMinuto(recepcao, "2003", "Ana Souza")             // 2
	bia := entrarNoMinuto(recepcao, "3004", "Beatriz Ramos")  // 3: a recepção agora é da Beatriz
	entrarNoMinuto(fin, "3004", "Beatriz Ramos")              // 4
	alvaro := entrarNoMinuto(velho, "2001", "Álvaro Reis")    // 5
	carlos := entrarNoMinuto(doCarlos, "2011", "Carlos Lima") // 6
	entrarNoMinuto(daOutra, "2003", "Abel")                   // 7
	// O Álvaro só tinha um computador, que saiu; o Carlos saiu do chat.
	if err := b.DesligarComputador(ctx, velho.ID); err != nil {
		t.Fatal(err)
	}
	exec(t, b, `UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, carlos.ID)

	lista, err := b.PessoasDaEmpresa(ctx, acme.ID)
	if err != nil {
		t.Fatal(err)
	}
	minuto := func(n int64) int64 { return inicioTeste + n*60*1000 }
	// Em ordem de nome sem acento; os computadores ativos em que a pessoa já entrou, em ordem
	// de nome, com a última vez dela em cada um; a da pessoa é a mais nova delas. A recepção,
	// que agora é da Beatriz, fica com o minuto 2 na linha da Ana e o 3 na da Beatriz.
	want := []PessoaComComputadores{
		{Pessoa: alvaro, Computadores: []ComputadorVisto{}, UltimaVez: 0},
		{Pessoa: ana, Computadores: []ComputadorVisto{
			{ID: noteAna.ID, Nome: "NOTE-ANA", UltimaVez: minuto(1)},
			{ID: recepcao.ID, Nome: "RECEPCAO-02", UltimaVez: minuto(2)},
		}, UltimaVez: minuto(2)},
		{Pessoa: bia, Computadores: []ComputadorVisto{
			{ID: fin.ID, Nome: "FIN-01", UltimaVez: minuto(4)},
			{ID: recepcao.ID, Nome: "RECEPCAO-02", UltimaVez: minuto(3)},
		}, UltimaVez: minuto(4)},
	}
	if len(lista) != len(want) {
		t.Fatalf("PessoasDaEmpresa = %+v", lista)
	}
	for i := range want {
		g, w := lista[i], want[i]
		if g.Pessoa != w.Pessoa || g.UltimaVez != w.UltimaVez || g.Computadores == nil ||
			!slices.Equal(g.Computadores, w.Computadores) {
			t.Fatalf("pessoa %d = %+v; queria %+v", i, g, w)
		}
	}
	if l, err := b.PessoasDaEmpresa(ctx, 9999); err != nil || l == nil || len(l) != 0 {
		t.Fatalf("empresa que não existe = %#v, %v; queria uma lista vazia", l, err)
	}
}

// aviso lê a ação, o autor e o alvo de um aviso gravado.
func aviso(t *testing.T, b *Banco, id int64) (acao string, autor int64, alvo *int64) {
	t.Helper()
	if err := b.db.QueryRow(`SELECT aviso_acao, autor_id, aviso_alvo_id FROM mensagens WHERE id = ? AND tipo = 'aviso'`, id).
		Scan(&acao, &autor, &alvo); err != nil {
		t.Fatalf("aviso %d: %v", id, err)
	}
	return acao, autor, alvo
}

func TestTirarPessoa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	k1, k2 := computadorTeste(t, b, acme.ID, "NOTE-ANA"), computadorTeste(t, b, acme.ID, "CASA-ANA")
	recepcao := computadorTeste(t, b, acme.ID, "RECEPCAO-02")
	ana, _ := entrar(t, b, k1, "2003", "Ana Souza")
	entrar(t, b, k2, "2003", "Ana Souza")
	entrar(t, b, recepcao, "2003", "Ana Souza")
	bia, _ := entrar(t, b, recepcao, "3004", "Beatriz Ramos") // a recepção agora é da Beatriz
	carlos := pessoaDe(t, b, acme.ID, "2011", "Carlos Lima")
	dani := pessoaDe(t, b, acme.ID, "2012", "Daniela")
	abel := pessoaDe(t, b, outra.ID, "2003", "Abel")

	// g1: a Ana cuida; a Daniela entra 1 s depois do Carlos e da Beatriz. g2: a Beatriz
	// cuida. g3: a Ana já saiu dele. A Ana tem também uma conversa a dois com a Beatriz.
	g1, _, err := b.CriarGrupo(ctx, acme.ID, ana.ID, "Comercial", []int64{carlos.ID, bia.ID})
	if err != nil {
		t.Fatal(err)
	}
	avancar(b, time.Second)
	if _, err := b.PorNoGrupo(ctx, ana.ID, g1, []int64{dani.ID}); err != nil {
		t.Fatal(err)
	}
	g2, _, _ := b.CriarGrupo(ctx, acme.ID, bia.ID, "Financeiro", []int64{ana.ID})
	g3, _, _ := b.CriarGrupo(ctx, acme.ID, carlos.ID, "Antigo", []int64{ana.ID})
	if _, err := b.TirarMembro(ctx, ana.ID, g3, ana.ID); err != nil {
		t.Fatal(err)
	}
	dupla, _, _ := b.CriarDupla(ctx, acme.ID, ana.ID, bia.ID)
	msg := texto(t, b, dupla, ana.ID, "Bom dia")
	avisosG3 := contar(t, b, `SELECT COUNT(*) FROM mensagens WHERE conversa_id = ?`, g3)

	avancar(b, time.Minute)
	agora := b.agoraMs()
	computadores, avisos, err := b.TirarPessoa(ctx, acme.ID, ana.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Saem os computadores que agem como ela; a recepção, que agora é da Beatriz, fica.
	if !slices.Equal(computadores, []int64{k1.ID, k2.ID}) {
		t.Fatalf("computadores = %v; queria [%d %d]", computadores, k1.ID, k2.ID)
	}
	for _, c := range []Computador{k1, k2} {
		if _, err := b.ComputadorAtivo(ctx, c.ID); !errors.Is(err, ErrNaoEncontrado) {
			t.Fatalf("o computador %s continua ativo: %v", c.Nome, err)
		}
	}
	if _, err := b.ComputadorAtivo(ctx, recepcao.ID); err != nil {
		t.Fatalf("a recepção saiu: %v", err)
	}
	if p, err := b.PessoaPorID(ctx, acme.ID, ana.ID); err != nil || !p.Saiu {
		t.Fatalf("a Ana = %+v, %v; queria Saiu", p, err)
	}
	// Um aviso saiu, da Ana e sem alvo, em cada grupo em que ela estava; no g3, nada.
	if len(avisos) != 2 || avisos[0].ConversaID != g1 || avisos[1].ConversaID != g2 {
		t.Fatalf("avisos = %+v; queria um no %d e um no %d", avisos, g1, g2)
	}
	for _, a := range avisos {
		if acao, autor, alvo := aviso(t, b, a.MensagemID); acao != "saiu" || autor != ana.ID || alvo != nil {
			t.Fatalf("aviso %+v = %s, %d, %v", a, acao, autor, alvo)
		}
		if n := contar(t, b, `SELECT COUNT(*) FROM mensagens WHERE id = ? AND conversa_id = ? AND criada_em = ?`,
			a.MensagemID, a.ConversaID, agora); n != 1 {
			t.Fatalf("o aviso %+v não é da conversa, ou não é de agora", a)
		}
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM mensagens WHERE conversa_id = ?`, g3); n != avisosG3 {
		t.Fatal("o g3, de onde a Ana já tinha saído, ganhou um aviso")
	}
	// O cuidado do g1 passa à mais antiga no grupo (a Beatriz e o Carlos empatam: o menor id).
	cuida := func(g int64) int64 {
		var c int64
		b.db.QueryRow(`SELECT cuida_id FROM conversas WHERE id = ?`, g).Scan(&c)
		return c
	}
	if want := min(bia.ID, carlos.ID); cuida(g1) != want || cuida(g2) != bia.ID {
		t.Fatalf("cuidam g1 = %d, g2 = %d; queria %d e %d", cuida(g1), cuida(g2), want, bia.ID)
	}
	for g, want := range map[int64][]int64{g1: {bia.ID, carlos.ID, dani.ID}, g2: {bia.ID}} {
		ids, _ := b.PessoasDaConversa(ctx, g)
		slices.Sort(want)
		if !slices.Equal(ids, want) {
			t.Fatalf("membros do %d = %v; queria %v", g, ids, want)
		}
	}
	// As mensagens dela continuam, com ela marcada como saiu.
	lista, _, err := b.Mensagens(ctx, bia.ID, dupla, 0, 0, MaxPagina)
	if err != nil || len(lista) != 1 || lista[0].ID != msg || lista[0].Autor == nil || !lista[0].Autor.Saiu {
		t.Fatalf("as mensagens da dupla = %+v, %v", lista, err)
	}

	// De novo: não muda nada.
	c2, a2, err := b.TirarPessoa(ctx, acme.ID, ana.ID)
	if err != nil || len(c2) != 0 || len(a2) != 0 {
		t.Fatalf("de novo = %v, %v, %v; queria nada", c2, a2, err)
	}
	// O mesmo ramal, num computador novo, é uma pessoa nova.
	nova, _ := entrar(t, b, computadorTeste(t, b, acme.ID, "NOVO"), "2003", "Ana Souza")
	if nova.ID == ana.ID || nova.Saiu {
		t.Fatalf("a nova = %+v; a tirada era %d", nova, ana.ID)
	}
	// A pessoa de outra empresa, ou que não existe, dá ErrNaoEncontrado, sem mudar nada.
	for _, id := range []int64{abel.ID, 9999} {
		if _, _, err := b.TirarPessoa(ctx, acme.ID, id); !errors.Is(err, ErrNaoEncontrado) {
			t.Fatalf("pessoa %d: %v", id, err)
		}
	}
	if p, _ := b.PessoaPorID(ctx, outra.ID, abel.ID); p.Saiu {
		t.Fatal("o Abel, da outra empresa, saiu")
	}
}
