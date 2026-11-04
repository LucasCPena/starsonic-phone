package copia

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// relogio para as 12:00 UTC de 4/11/2026, 09:00 em Brasília.
func relogio() *tempo.Teste {
	return tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
}

// bancoComConversa abre o banco da pasta e deixa uma dupla de pessoas pronta para conversar.
func bancoComConversa(t *testing.T, dados string, r tempo.Relogio) (b *banco.Banco, eu, conversa int64) {
	t.Helper()
	ctx := context.Background()
	b, err := banco.Abrir(filepath.Join(dados, banco.NomeArquivo), r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Fechar() })
	e, err := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	if err != nil {
		t.Fatal(err)
	}
	pc, err := b.LigarComputador(ctx, e.ID, "PC da Ana", bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	ana, _, err := b.EntrarComoPessoa(ctx, pc.ID, e.ID, "2003", "Ana Souza")
	if err != nil {
		t.Fatal(err)
	}
	bia, _, err := b.EntrarComoPessoa(ctx, pc.ID, e.ID, "2004", "Beatriz")
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := b.CriarDupla(ctx, e.ID, ana.ID, bia.ID)
	if err != nil {
		t.Fatal(err)
	}
	return b, ana.ID, c
}

func TestCopia_Consistente(t *testing.T) {
	ctx := context.Background()
	dados, destino := t.TempDir(), t.TempDir()
	r := relogio()
	b, eu, conversa := bancoComConversa(t, dados, r)

	parar := make(chan struct{})
	var feito sync.WaitGroup
	var gravadas atomic.Int64
	feito.Add(1)
	go func() {
		defer feito.Done()
		for i := 1; ; i++ {
			select {
			case <-parar:
				return
			default:
			}
			if _, _, err := b.EnviarTexto(ctx, eu, conversa, fmt.Sprintf("m%d", i), fmt.Sprintf("mensagem %d", i)); err != nil {
				t.Errorf("EnviarTexto %d: %v", i, err)
				return
			}
			gravadas.Add(1)
		}
	}()
	// Deixa algumas mensagens entrarem e copia no meio da gravação.
	for {
		if gravadas.Load() >= 50 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	antes := gravadas.Load()
	arquivo, err := Fazer(ctx, dados, destino, r)
	durante := gravadas.Load() - antes
	close(parar)
	feito.Wait()
	if err != nil {
		t.Fatalf("Fazer: %v", err)
	}
	if durante == 0 {
		t.Fatal("nenhuma mensagem foi gravada enquanto a cópia andava; o teste não prova nada")
	}
	if arquivo != filepath.Join(destino, "chat-2026-11-04.db") {
		t.Fatalf("arquivo = %q", arquivo)
	}

	db, err := sql.Open("sqlite", "file:"+arquivo+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var integro string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&integro); err != nil || integro != "ok" {
		t.Fatalf("integrity_check = %q, %v", integro, err)
	}
	linhas, err := db.Query(`SELECT id, texto FROM mensagens ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	n := 0
	for linhas.Next() {
		var id int64
		var texto string
		if err := linhas.Scan(&id, &texto); err != nil {
			t.Fatal(err)
		}
		n++
		if id != int64(n) || texto != fmt.Sprintf("mensagem %d", n) {
			t.Fatalf("buraco: a %dª linha é a mensagem %d, %q", n, id, texto)
		}
	}
	if n < 50 {
		t.Fatalf("a cópia tem %d mensagens; queria pelo menos 50", n)
	}
	db.Close()

	// A cópia abre com o banco.Abrir, como o servidor faria ao voltar uma cópia.
	c, err := banco.Abrir(arquivo, r)
	if err != nil {
		t.Fatalf("banco.Abrir da cópia: %v", err)
	}
	c.Fechar()
}

// copiaDe cria um arquivo chat-AAAA-MM-DD.db qualquer em destino.
func copiaDe(t *testing.T, destino, data string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(destino, "chat-"+data+".db"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func listar(t *testing.T, pasta string) map[string]bool {
	t.Helper()
	itens, err := os.ReadDir(pasta)
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]bool{}
	for _, i := range itens {
		m[i.Name()] = true
	}
	return m
}

func TestCopia_Guarda30Dias(t *testing.T) {
	dados, destino := t.TempDir(), t.TempDir()
	r := relogio() // 4/11/2026 em Brasília
	bancoComConversa(t, dados, r)
	hoje := time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)
	for dias := 1; dias <= 35; dias++ {
		copiaDe(t, destino, hoje.AddDate(0, 0, -dias).Format("2006-01-02"))
	}
	// Nomes que não são de cópia, mesmo velhos, ficam como estão.
	for _, nome := range []string{"chat-2020-01-01.db.bak", "chat-ontem.db", "notas.txt", "chat-2020-13-45.db"} {
		if err := os.WriteFile(filepath.Join(destino, nome), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := Fazer(context.Background(), dados, destino, r); err != nil {
		t.Fatal(err)
	}
	got := listar(t, destino)
	for dias := 0; dias <= 35; dias++ {
		nome := "chat-" + hoje.AddDate(0, 0, -dias).Format("2006-01-02") + ".db"
		if quer := dias <= 30; got[nome] != quer {
			t.Errorf("%s (%d dias): existe = %v; queria %v", nome, dias, got[nome], quer)
		}
	}
	for _, nome := range []string{"chat-2020-01-01.db.bak", "chat-ontem.db", "notas.txt", "chat-2020-13-45.db"} {
		if !got[nome] {
			t.Errorf("%s foi apagado", nome)
		}
	}
}

func TestCopia_DataDeBrasilia(t *testing.T) {
	dados, destino := t.TempDir(), t.TempDir()
	// 01:00 UTC de 5/11 ainda é 22:00 de 4/11 em Brasília.
	r := tempo.NovoTeste(time.Date(2026, 11, 5, 1, 0, 0, 0, time.UTC))
	bancoComConversa(t, dados, r)
	arquivo, err := Fazer(context.Background(), dados, destino, r)
	if err != nil || filepath.Base(arquivo) != "chat-2026-11-04.db" {
		t.Fatalf("Fazer = %q, %v", arquivo, err)
	}
}

func TestCopia_MesmoDiaDuasVezes(t *testing.T) {
	ctx := context.Background()
	dados, destino := t.TempDir(), t.TempDir()
	r := relogio()
	b, eu, conversa := bancoComConversa(t, dados, r)
	if _, _, err := b.EnviarTexto(ctx, eu, conversa, "a", "primeira"); err != nil {
		t.Fatal(err)
	}
	if _, err := Fazer(ctx, dados, destino, r); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.EnviarTexto(ctx, eu, conversa, "b", "segunda"); err != nil {
		t.Fatal(err)
	}
	arquivo, err := Fazer(ctx, dados, destino, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := listar(t, destino); len(got) != 1 || !got["chat-2026-11-04.db"] {
		t.Fatalf("destino = %v; queria só a cópia do dia", got)
	}
	db, err := sql.Open("sqlite", "file:"+arquivo+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM mensagens`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("mensagens = %d, %v; a cópia ficou a primeira", n, err)
	}
}

func TestCopia_SemWalNemShm(t *testing.T) {
	dados, destino := t.TempDir(), t.TempDir()
	r := relogio()
	b, eu, conversa := bancoComConversa(t, dados, r)
	if _, _, err := b.EnviarTexto(context.Background(), eu, conversa, "a", "oi"); err != nil {
		t.Fatal(err)
	}
	if err := b.Fechar(); err != nil { // o último a fechar apaga o -wal e o -shm
		t.Fatal(err)
	}
	caminho := filepath.Join(dados, banco.NomeArquivo)
	for _, suf := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(caminho + suf); err == nil {
			t.Fatalf("o %s continua depois de fechar; o teste não vale", suf)
		}
	}
	antes, err := os.ReadFile(caminho)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Fazer(context.Background(), dados, destino, r); err != nil {
		t.Fatalf("Fazer: %v", err)
	}
	depois, err := os.ReadFile(caminho)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(antes, depois) {
		t.Fatal("a cópia mudou o chat.db")
	}
}

func TestCopia_ErroNaoDeixaRastro(t *testing.T) {
	dados, destino := t.TempDir(), t.TempDir()
	r := relogio()
	bancoComConversa(t, dados, r)
	// Um .tmp- de uma cópia que caiu antes também sai.
	velho := filepath.Join(destino, ".tmp-chat-antigo")
	if err := os.WriteFile(velho, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Uma pasta no lugar do nome final faz o último passo falhar, depois de a cópia pronta.
	if err := os.MkdirAll(filepath.Join(destino, "chat-2026-11-04.db", "dentro"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Fazer(context.Background(), dados, destino, r); err == nil {
		t.Fatal("Fazer não deu erro")
	}
	for nome := range listar(t, destino) {
		if nome != "chat-2026-11-04.db" {
			t.Errorf("sobrou %s", nome)
		}
	}
}

func TestCopia_BancoQueNaoExiste(t *testing.T) {
	destino := t.TempDir()
	if _, err := Fazer(context.Background(), t.TempDir(), destino, relogio()); err == nil {
		t.Fatal("Fazer não deu erro")
	}
	if got := listar(t, destino); len(got) != 0 {
		t.Fatalf("sobrou %v", got)
	}
}
