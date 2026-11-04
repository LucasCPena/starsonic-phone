package bancotest_test

import (
	"database/sql"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco/bancotest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestTabelas(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), banco.NomeArquivo)
	b, err := banco.Abrir(caminho, tempo.NovoTeste(time.UnixMilli(1_700_000_000_000)))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Fechar()
	db, err := sql.Open("sqlite", "file:"+caminho+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// As tabelas da 0001 com dados de empresa, lidas do sqlite_master.
	tabelas, err := bancotest.Tabelas(db)
	if err != nil {
		t.Fatal(err)
	}
	quer := []string{"arquivos", "computador_pessoas", "computadores", "conversas", "empresas", "leituras",
		"membros", "mensagens", "pessoas"}
	if !slices.Equal(tabelas, quer) {
		t.Fatalf("Tabelas = %v; queria %v", tabelas, quer)
	}
	// Uma tabela nova, sem regra para contar as linhas de uma empresa, é um erro: um dado de
	// empresa novo não escapa dos testes do "Apagar a empresa".
	if _, err := db.Exec(`CREATE TABLE notas (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE)`); err != nil {
		t.Fatal(err)
	}
	if _, err := bancotest.Tabelas(db); err == nil || !strings.Contains(err.Error(), "notas") {
		t.Fatalf("com a tabela notas sem regra: %v; queria um erro que diga notas", err)
	}
}
