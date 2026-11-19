package banco

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// TestMigrar_DaVersao1ComDados abre um chat.db da versão 1 (o esquema da 0001, com uma empresa, uma pessoa
// e um computador) e confere que o Abrir o leva à versão 2 sem perder nada e sem liberar as reuniões.
func TestMigrar_DaVersao1ComDados(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "chat.db")
	antigo, err := sql.Open("sqlite", "file:"+caminho+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("abrir o banco antigo: %v", err)
	}
	inicio, err := migracoes.ReadFile("migracoes/0001_inicio.sql")
	if err != nil {
		t.Fatalf("ler a migração 1: %v", err)
	}
	for _, comando := range []string{
		string(inicio),
		`INSERT INTO empresas (id, nome, codigo, criada_em) VALUES (7, 'ACME Comércio Ltda', 'STAR-AAAA-BBBB', 1700000000000)`,
		`INSERT INTO pessoas (id, empresa_id, ramal, nome, nome_busca, entrou_em) VALUES (3, 7, '2001', 'Ana Souza', 'ana souza', 1700000001000)`,
		`INSERT INTO computadores (id, empresa_id, chave_hash, nome, pessoa_id, ligado_em, ultima_vez) VALUES (5, 7, x'0102030405', 'Mesa 1', 3, 1700000002000, 1700000003000)`,
		`PRAGMA user_version = 1`,
	} {
		if _, err := antigo.Exec(comando); err != nil {
			t.Fatalf("montar o banco da versão 1: %v", err)
		}
	}
	if err := antigo.Close(); err != nil {
		t.Fatalf("fechar o banco antigo: %v", err)
	}

	b, err := Abrir(caminho, tempo.NovoTeste(time.UnixMilli(1_700_000_010_000)))
	if err != nil {
		t.Fatalf("Abrir: %v", err)
	}
	defer b.Fechar()

	var v int
	if err := b.db.QueryRow("PRAGMA user_version").Scan(&v); err != nil || v != 2 {
		t.Fatalf("user_version = %d, %v; queria 2", v, err)
	}
	e, err := b.EmpresaPorCodigo(context.Background(), "STAR-AAAA-BBBB")
	if err != nil {
		t.Fatalf("EmpresaPorCodigo: %v", err)
	}
	if e.ID != 7 || e.Nome != "ACME Comércio Ltda" || e.CriadaEm != 1700000000000 {
		t.Fatalf("a empresa mudou: %+v", e)
	}
	if e.Reunioes {
		t.Fatal("Empresa.Reunioes = true; queria false depois da migração")
	}
	p, err := b.PessoaPorID(context.Background(), 7, 3)
	if err != nil || p.Nome != "Ana Souza" || p.Ramal != "2001" || p.Saiu {
		t.Fatalf("a pessoa mudou: %+v, %v", p, err)
	}
	var computadores int
	var nome string
	if err := b.db.QueryRow(`SELECT COUNT(*), MIN(nome) FROM computadores WHERE id = 5 AND empresa_id = 7 AND pessoa_id = 3`).
		Scan(&computadores, &nome); err != nil || computadores != 1 || nome != "Mesa 1" {
		t.Fatalf("o computador mudou: %d, %q, %v", computadores, nome, err)
	}
}
