package banco

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

// pessoaDe cria a pessoa na empresa, por um computador próprio.
func pessoaDe(t *testing.T, b *Banco, empresaID int64, ramal, nome string) Pessoa {
	t.Helper()
	c := computadorTeste(t, b, empresaID, "PC-"+ramal)
	p, _ := entrar(t, b, c, ramal, nome)
	return p
}

// texto grava uma mensagem de texto direto na tabela (a Task 6 ainda não escreve).
func texto(t *testing.T, b *Banco, conversaID, autorID int64, s string) int64 {
	t.Helper()
	r, err := b.db.Exec(`INSERT INTO mensagens (conversa_id, autor_id, tipo, texto, criada_em) VALUES (?, ?, 'texto', ?, ?)`,
		conversaID, autorID, s, b.agoraMs())
	if err != nil {
		t.Fatal(err)
	}
	id, _ := r.LastInsertId()
	return id
}

func avancar(b *Banco, d time.Duration) { b.relogio.(interface{ Avancar(time.Duration) }).Avancar(d) }

func TestCriarDupla(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	saiu := pessoaDe(t, b, e.ID, "2005", "Carlos")
	b.db.Exec(`UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, saiu.ID)
	estranho := pessoaDe(t, b, outra.ID, "2003", "Abel")

	id, nova, err := b.CriarDupla(ctx, e.ID, bia.ID, ana.ID) // Beatriz primeiro: o par fica ordenado
	if err != nil || !nova || id == 0 {
		t.Fatalf("CriarDupla = %d, %v, %v", id, nova, err)
	}
	var a, bb int64
	b.db.QueryRow(`SELECT dupla_a, dupla_b FROM conversas WHERE id = ?`, id).Scan(&a, &bb)
	if a >= bb {
		t.Fatalf("dupla_a = %d, dupla_b = %d; queria a < b", a, bb)
	}
	id2, nova2, err := b.CriarDupla(ctx, e.ID, ana.ID, bia.ID)
	if err != nil || nova2 || id2 != id {
		t.Fatalf("segunda = %d, %v, %v; queria %d, false", id2, nova2, err, id)
	}
	if _, _, err := b.CriarDupla(ctx, e.ID, ana.ID, ana.ID); !errors.Is(err, ErrInvalido) {
		t.Fatalf("com a própria: %v", err)
	}
	if _, _, err := b.CriarDupla(ctx, e.ID, ana.ID, saiu.ID); !errors.Is(err, ErrInvalido) {
		t.Fatalf("com quem saiu: %v", err)
	}
	if _, _, err := b.CriarDupla(ctx, e.ID, ana.ID, estranho.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("com a outra empresa: %v", err)
	}
	if _, _, err := b.CriarDupla(ctx, e.ID, ana.ID, 9999); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("com id que não existe: %v", err)
	}

	ids, err := b.PessoasDaConversa(ctx, id)
	if err != nil || !slices.Equal(ids, []int64{min(ana.ID, bia.ID), max(ana.ID, bia.ID)}) {
		t.Fatalf("PessoasDaConversa = %v, %v", ids, err)
	}
}

func TestCriarGrupo_Avisos(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	carlos := pessoaDe(t, b, e.ID, "2005", "Carlos")

	// A própria Ana na lista e o Carlos repetido valem uma vez só.
	id, err := b.CriarGrupo(ctx, e.ID, ana.ID, "Comercial", []int64{bia.ID, ana.ID, carlos.ID, bia.ID})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := b.db.Query(`SELECT autor_id, aviso_acao, aviso_alvo_id FROM mensagens WHERE conversa_id = ? ORDER BY id`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type aviso struct {
		autor int64
		acao  string
		alvo  *int64
	}
	var got []aviso
	for rows.Next() {
		var av aviso
		if err := rows.Scan(&av.autor, &av.acao, &av.alvo); err != nil {
			t.Fatal(err)
		}
		got = append(got, av)
	}
	if len(got) != 3 || got[0].acao != "criou" || got[0].alvo != nil ||
		got[1].acao != "pos" || *got[1].alvo != bia.ID || got[2].acao != "pos" || *got[2].alvo != carlos.ID {
		t.Fatalf("avisos = %+v", got)
	}
	ids, _ := b.PessoasDaConversa(ctx, id)
	if len(ids) != 3 {
		t.Fatalf("membros = %v", ids)
	}
}

func TestTirarMembro_PassaParaOMaisAntigo(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	carlos := pessoaDe(t, b, e.ID, "2005", "Carlos")
	dani := pessoaDe(t, b, e.ID, "2006", "Daniela")

	// Ana cria com a Daniela e a Beatriz; 1 s depois entra o Carlos.
	id, err := b.CriarGrupo(ctx, e.ID, ana.ID, "Comercial", []int64{dani.ID, bia.ID})
	if err != nil {
		t.Fatal(err)
	}
	avancar(b, time.Second)
	if _, err := b.PorNoGrupo(ctx, ana.ID, id, []int64{carlos.ID}); err != nil {
		t.Fatal(err)
	}
	cuida := func() any {
		var c *int64
		b.db.QueryRow(`SELECT cuida_id FROM conversas WHERE id = ?`, id).Scan(&c)
		if c == nil {
			return nil
		}
		return *c
	}
	// Empate no mesmo milissegundo entre Beatriz e Daniela: vence o menor id (Beatriz).
	avisos, err := b.TirarMembro(ctx, ana.ID, id, ana.ID)
	if err != nil || len(avisos) != 1 {
		t.Fatalf("TirarMembro = %v, %v", avisos, err)
	}
	if cuida() != bia.ID {
		t.Fatalf("passou a cuidar %v; queria a Beatriz (%d)", cuida(), bia.ID)
	}
	// Beatriz sai, Daniela é a mais antiga que sobra (o Carlos entrou depois).
	if _, err := b.TirarMembro(ctx, bia.ID, id, bia.ID); err != nil {
		t.Fatal(err)
	}
	if cuida() != dani.ID {
		t.Fatalf("passou a cuidar %v; queria a Daniela (%d)", cuida(), dani.ID)
	}
	// Ninguém sobra: o grupo fica sem quem cuide, e ninguém o vê.
	if _, err := b.TirarMembro(ctx, dani.ID, id, dani.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := b.TirarMembro(ctx, carlos.ID, id, carlos.ID); err != nil {
		t.Fatal(err)
	}
	if cuida() != nil {
		t.Fatalf("cuida_id = %v; queria NULL", cuida())
	}
	if l, err := b.Conversas(ctx, carlos.ID); err != nil || len(l) != 0 {
		t.Fatalf("Conversas = %v, %v", l, err)
	}
}

func TestTirarMembro_Regras(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	carlos := pessoaDe(t, b, e.ID, "2005", "Carlos")
	fora := pessoaDe(t, b, e.ID, "2006", "Daniela")
	id, _ := b.CriarGrupo(ctx, e.ID, ana.ID, "Comercial", []int64{bia.ID, carlos.ID})

	if _, err := b.TirarMembro(ctx, bia.ID, id, carlos.ID); !errors.Is(err, ErrProibido) {
		t.Fatalf("Beatriz tirando o Carlos: %v", err)
	}
	if _, err := b.PorNoGrupo(ctx, bia.ID, id, []int64{fora.ID}); !errors.Is(err, ErrProibido) {
		t.Fatalf("Beatriz pondo a Daniela: %v", err)
	}
	if _, err := b.TirarMembro(ctx, fora.ID, id, carlos.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("quem não está no grupo: %v", err)
	}
	if _, err := b.TirarMembro(ctx, ana.ID, id, fora.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("tirar quem não está: %v", err)
	}
	avisos, err := b.TirarMembro(ctx, ana.ID, id, carlos.ID)
	if err != nil || len(avisos) != 1 {
		t.Fatalf("Ana tirando o Carlos: %v, %v", avisos, err)
	}
	var acao string
	var alvo *int64
	b.db.QueryRow(`SELECT aviso_acao, aviso_alvo_id FROM mensagens WHERE id = ?`, avisos[0]).Scan(&acao, &alvo)
	if acao != "tirou" || alvo == nil || *alvo != carlos.ID {
		t.Fatalf("aviso = %s, %v", acao, alvo)
	}
}

func TestPorNoGrupo_VoltaComNovaEntrada(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	id, _ := b.CriarGrupo(ctx, e.ID, ana.ID, "Comercial", []int64{bia.ID})

	avancar(b, time.Second)
	antes := texto(t, b, id, ana.ID, "antes de a Beatriz sair")
	avancar(b, time.Second)
	b.TirarMembro(ctx, bia.ID, id, bia.ID)
	avancar(b, time.Second)
	durante := texto(t, b, id, ana.ID, "enquanto ela estava fora")
	avancar(b, time.Second)
	avisos, err := b.PorNoGrupo(ctx, ana.ID, id, []int64{bia.ID, ana.ID}) // a Ana já está: ignorada
	if err != nil || len(avisos) != 1 {
		t.Fatalf("PorNoGrupo = %v, %v", avisos, err)
	}
	avancar(b, time.Second)
	depois := texto(t, b, id, ana.ID, "depois que ela voltou")

	var entrou int64
	var saiu *int64
	b.db.QueryRow(`SELECT entrou_em, saiu_em FROM membros WHERE conversa_id = ? AND pessoa_id = ?`, id, bia.ID).Scan(&entrou, &saiu)
	if saiu != nil || entrou != b.agoraMs()-time.Second.Milliseconds() {
		t.Fatalf("entrou_em = %d, saiu_em = %v; queria a entrada nova e saiu_em NULL", entrou, saiu)
	}
	rc, err := b.Conversa(ctx, e.ID, bia.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	// Ela só conta a mensagem de depois; a de antes e a de durante não entram.
	if rc.NaoLidas != 1 || rc.Ultima == nil || rc.Ultima.ID != depois || rc.Pessoas != 2 {
		t.Fatalf("Conversa = %+v (ultima %+v); antes %d, durante %d", rc, rc.Ultima, antes, durante)
	}
}

func TestConversas_NaoLidasEOrdem(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, e.ID, "2004", "Beatriz")
	carlos := pessoaDe(t, b, e.ID, "2005", "Carlos")

	dupla, _, _ := b.CriarDupla(ctx, e.ID, ana.ID, bia.ID)
	avancar(b, time.Second)
	grupo, _ := b.CriarGrupo(ctx, e.ID, ana.ID, "Comercial", []int64{bia.ID, carlos.ID})
	avancar(b, time.Second)
	texto(t, b, dupla, bia.ID, "oi")
	texto(t, b, dupla, bia.ID, "tudo bem?")
	texto(t, b, dupla, ana.ID, "tudo")
	texto(t, b, grupo, carlos.ID, "bom dia")

	lista, err := b.Conversas(ctx, ana.ID)
	if err != nil || len(lista) != 2 {
		t.Fatalf("Conversas = %+v, %v", lista, err)
	}
	// As duas têm mensagem no mesmo milissegundo: vence a de maior id (o grupo, criado depois).
	if lista[0].ID != grupo || lista[0].NaoLidas != 1 || lista[1].ID != dupla || lista[1].NaoLidas != 2 {
		t.Fatalf("lista = %+v", lista)
	}
	if lista[1].Com == nil || lista[1].Com.ID != bia.ID {
		t.Fatalf("Com = %+v", lista[1].Com)
	}
	// Ler tudo zera.
	b.db.Exec(`INSERT INTO leituras (pessoa_id, conversa_id, ate) VALUES (?, ?, 1000)`, ana.ID, dupla)
	rc, _ := b.Conversa(ctx, e.ID, ana.ID, dupla)
	if rc.NaoLidas != 0 {
		t.Fatalf("naoLidas = %d", rc.NaoLidas)
	}
	// Quem não está na conversa, ou a empresa errada, não a acha.
	if _, err := b.Conversa(ctx, e.ID, carlos.ID, dupla); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Carlos na dupla: %v", err)
	}
	if _, err := b.Conversa(ctx, e.ID+1, ana.ID, dupla); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("empresa errada: %v", err)
	}
}

func TestMembros_Ordem(t *testing.T) {
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	zeca := pessoaDe(t, b, e.ID, "2003", "Zeca")
	bia := pessoaDe(t, b, e.ID, "2004", "Álvaro")
	carlos := pessoaDe(t, b, e.ID, "2005", "Carlos")
	id, _ := b.CriarGrupo(ctx, e.ID, zeca.ID, "Comercial", []int64{carlos.ID, bia.ID})

	ms, err := b.Membros(ctx, id)
	if err != nil || len(ms) != 3 {
		t.Fatalf("Membros = %+v, %v", ms, err)
	}
	if ms[0].Pessoa.ID != zeca.ID || !ms[0].Cuida || !ms[0].Criou ||
		ms[1].Pessoa.ID != bia.ID || ms[1].Cuida || ms[2].Pessoa.ID != carlos.ID {
		t.Fatalf("Membros = %+v", ms)
	}
}
