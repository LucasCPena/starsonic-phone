package banco

import (
	"context"
	"errors"
	"maps"
	"slices"
	"testing"
	"time"

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

// arquivoComTamanho grava um arquivo do autor direto na tabela, com o tamanho dado; expirado
// marca a hora da expiração.
func arquivoComTamanho(t *testing.T, b *Banco, empresaID, autorID int64, id string, tamanho int64, expirado bool) {
	t.Helper()
	var exp any
	if expirado {
		exp = b.agoraMs()
	}
	exec(t, b, `INSERT INTO arquivos (id, empresa_id, autor_id, nome, tipo, tamanho, criado_em, expirado_em)
		VALUES (?, ?, ?, 'Proposta.pdf', 'application/pdf', ?, ?, ?)`, id, empresaID, autorID, tamanho, b.agoraMs(), exp)
}

func TestEmpresas_Resumo(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	rota, _ := b.CriarEmpresa(ctx, "Transportadora Rota Sul")
	avancar(b, time.Hour)
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	avancar(b, time.Hour)
	clinica, _ := b.CriarEmpresa(ctx, "Clínica Vida")

	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	pessoaDe(t, b, acme.ID, "2004", "Beatriz Ramos")
	saiu := pessoaDe(t, b, acme.ID, "2011", "Carlos Lima")
	exec(t, b, `UPDATE pessoas SET saiu_em = 1 WHERE id = ?`, saiu.ID) // quem saiu não conta
	abel := pessoaDe(t, b, rota.ID, "2001", "Abel")
	// O espaço é o dos arquivos que estão no disco: o expirado já saiu.
	arquivoComTamanho(t, b, acme.ID, ana.ID, "a1", 1000, false)
	arquivoComTamanho(t, b, acme.ID, saiu.ID, "a2", 2500, false)
	arquivoComTamanho(t, b, acme.ID, ana.ID, "a3", 4000, true)
	arquivoComTamanho(t, b, rota.ID, abel.ID, "r1", 7, false)

	lista, err := b.Empresas(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Em ordem de nome, sem acento e sem caixa.
	want := []ResumoEmpresa{
		{Empresa: acme, Pessoas: 2, Bytes: 3500},
		{Empresa: clinica, Pessoas: 0, Bytes: 0},
		{Empresa: rota, Pessoas: 1, Bytes: 7},
	}
	if len(lista) != len(want) {
		t.Fatalf("Empresas = %+v", lista)
	}
	for i := range want {
		if lista[i] != want[i] {
			t.Fatalf("Empresas[%d] = %+v; queria %+v", i, lista[i], want[i])
		}
	}
	if acme.CriadaEm != inicioTeste+60*60*1000 {
		t.Fatalf("criada_em da ACME = %d", acme.CriadaEm)
	}

	r, err := b.ResumoDaEmpresa(ctx, acme.ID)
	if err != nil || r != want[0] {
		t.Fatalf("ResumoDaEmpresa = %+v, %v; queria %+v", r, err, want[0])
	}
	if _, err := b.ResumoDaEmpresa(ctx, 9999); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("empresa que não existe: %v", err)
	}

	vazio := abrirTeste(t)
	if l, err := vazio.Empresas(ctx); err != nil || l == nil || len(l) != 0 {
		t.Fatalf("sem empresas = %#v, %v; queria uma lista vazia", l, err)
	}
}

func TestTrocarCodigo(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")

	novo, err := b.TrocarCodigo(ctx, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if c, ok := segredo.NormalizarCodigo(novo); !ok || c != novo || novo == e.Codigo {
		t.Fatalf("código novo %q (o antigo era %q)", novo, e.Codigo)
	}
	if _, err := b.EmpresaPorCodigo(ctx, e.Codigo); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("o código antigo: %v; queria ErrNaoEncontrado", err)
	}
	if got, err := b.EmpresaPorCodigo(ctx, novo); err != nil || got.ID != e.ID || got.Codigo != novo {
		t.Fatalf("o código novo = %+v, %v", got, err)
	}
	if got, err := b.EmpresaPorCodigo(ctx, outra.Codigo); err != nil || got != outra {
		t.Fatalf("a outra empresa mudou: %+v, %v", got, err)
	}
	if _, err := b.TrocarCodigo(ctx, 9999); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("empresa que não existe: %v", err)
	}
}

// contagens diz quantas linhas de cada tabela são da empresa.
func contagens(t *testing.T, b *Banco, empresaID int64) map[string]int {
	t.Helper()
	porTabela := map[string]string{
		"empresas":           `SELECT COUNT(*) FROM empresas WHERE id = ?`,
		"pessoas":            `SELECT COUNT(*) FROM pessoas WHERE empresa_id = ?`,
		"computadores":       `SELECT COUNT(*) FROM computadores WHERE empresa_id = ?`,
		"computador_pessoas": `SELECT COUNT(*) FROM computador_pessoas x JOIN computadores c ON c.id = x.computador_id WHERE c.empresa_id = ?`,
		"conversas":          `SELECT COUNT(*) FROM conversas WHERE empresa_id = ?`,
		"membros":            `SELECT COUNT(*) FROM membros x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"mensagens":          `SELECT COUNT(*) FROM mensagens x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"arquivos":           `SELECT COUNT(*) FROM arquivos WHERE empresa_id = ?`,
		"leituras":           `SELECT COUNT(*) FROM leituras x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
	}
	n := map[string]int{}
	for tabela, q := range porTabela {
		n[tabela] = contar(t, b, q, empresaID)
	}
	return n
}

// totais diz quantas linhas cada tabela tem, de todas as empresas.
func totais(t *testing.T, b *Banco) map[string]int {
	t.Helper()
	n := map[string]int{}
	for _, tabela := range []string{"empresas", "pessoas", "computadores", "computador_pessoas", "conversas",
		"membros", "mensagens", "arquivos", "leituras"} {
		n[tabela] = contar(t, b, `SELECT COUNT(*) FROM `+tabela)
	}
	return n
}

// encherEmpresa põe na empresa duas pessoas com computadores (um deles desligado), uma
// conversa a dois com texto e arquivo, um grupo e uma leitura. Devolve os ids dos
// computadores e dos arquivos, em ordem.
func encherEmpresa(t *testing.T, b *Banco, empresaID int64, prefixo string) (computadores []int64, arquivos []string) {
	t.Helper()
	ctx := context.Background()
	c1 := computadorTeste(t, b, empresaID, prefixo+"-1")
	c2 := computadorTeste(t, b, empresaID, prefixo+"-2")
	c3 := computadorTeste(t, b, empresaID, prefixo+"-3")
	ana, _ := entrar(t, b, c1, "2003", "Ana "+prefixo)
	entrar(t, b, c3, "2003", "Ana "+prefixo)
	bia, _ := entrar(t, b, c2, "2004", "Bia "+prefixo)
	if err := b.DesligarComputador(ctx, c3.ID); err != nil {
		t.Fatal(err)
	}
	dupla, _, err := b.CriarDupla(ctx, empresaID, ana.ID, bia.ID)
	if err != nil {
		t.Fatal(err)
	}
	texto(t, b, dupla, ana.ID, "Olá")
	f1, f2 := prefixo+"f1", prefixo+"f2"
	arquivoComTamanho(t, b, empresaID, ana.ID, f1, 10, false)
	arquivoComTamanho(t, b, empresaID, bia.ID, f2, 20, false) // sem mensagem
	exec(t, b, `INSERT INTO mensagens (conversa_id, autor_id, tipo, arquivo_id, criada_em) VALUES (?, ?, 'arquivo', ?, ?)`,
		dupla, ana.ID, f1, b.agoraMs())
	if _, _, err := b.CriarGrupo(ctx, empresaID, ana.ID, "Comercial", []int64{bia.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.MarcarLida(ctx, bia.ID, dupla, 1<<40); err != nil {
		t.Fatal(err)
	}
	return []int64{c1.ID, c2.ID, c3.ID}, []string{f1, f2}
}

func TestApagarEmpresa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	pcsAcme, arqsAcme := encherEmpresa(t, b, acme.ID, "a")
	encherEmpresa(t, b, outra.ID, "o")
	daOutra := contagens(t, b, outra.ID)
	for tabela, n := range contagens(t, b, acme.ID) {
		if n == 0 {
			t.Fatalf("a cena não pôs nada em %s", tabela)
		}
	}

	arquivos, computadores, err := b.ApagarEmpresa(ctx, acme.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Os arquivos (também o que não entrou numa mensagem), para tirar do disco, e todos os
	// computadores, também o desligado, para o Fora.
	if !slices.Equal(arquivos, arqsAcme) || !slices.Equal(computadores, pcsAcme) {
		t.Fatalf("ApagarEmpresa = %v, %v; queria %v, %v", arquivos, computadores, arqsAcme, pcsAcme)
	}
	// Nada da ACME fica, nem linha solta: o total de cada tabela é o da outra empresa.
	if got := totais(t, b); !maps.Equal(got, daOutra) {
		t.Fatalf("depois de apagar = %v; queria só os da outra empresa, %v", got, daOutra)
	}
	if got := contagens(t, b, outra.ID); !maps.Equal(got, daOutra) {
		t.Fatalf("a outra empresa mudou: %v; era %v", got, daOutra)
	}
	if _, err := b.EmpresaPorCodigo(ctx, acme.Codigo); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("o código da empresa apagada: %v", err)
	}
	if _, _, err := b.ApagarEmpresa(ctx, acme.ID); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("de novo: %v; queria ErrNaoEncontrado", err)
	}
	if _, _, err := b.ApagarEmpresa(ctx, 9999); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("empresa que não existe: %v", err)
	}
}
