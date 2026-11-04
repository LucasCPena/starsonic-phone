package banco

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func abrirTeste(t *testing.T) *Banco {
	t.Helper()
	b, err := Abrir(filepath.Join(t.TempDir(), "chat.db"), tempo.NovoTeste(time.UnixMilli(1_700_000_000_000)))
	if err != nil {
		t.Fatalf("Abrir: %v", err)
	}
	t.Cleanup(func() { b.Fechar() })
	return b
}

func TestAbrir_Novo(t *testing.T) {
	b := abrirTeste(t)
	var v int
	if err := b.db.QueryRow("PRAGMA user_version").Scan(&v); err != nil || v != 1 {
		t.Fatalf("user_version = %d, %v; queria 1", v, err)
	}
	var modo string
	if err := b.db.QueryRow("PRAGMA journal_mode").Scan(&modo); err != nil || modo != "wal" {
		t.Fatalf("journal_mode = %q, %v; queria wal", modo, err)
	}
	var fk int
	if err := b.db.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
		t.Fatalf("foreign_keys = %d, %v; queria 1", fk, err)
	}
}

func TestAbrir_DeNovo(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "chat.db")
	r := tempo.NovoTeste(time.UnixMilli(1_700_000_000_000))
	for i := 0; i < 2; i++ {
		b, err := Abrir(caminho, r)
		if err != nil {
			t.Fatalf("Abrir #%d: %v", i+1, err)
		}
		var v int
		if err := b.db.QueryRow("PRAGMA user_version").Scan(&v); err != nil || v != 1 {
			t.Fatalf("user_version = %d, %v; queria 1", v, err)
		}
		if err := b.Fechar(); err != nil {
			t.Fatalf("Fechar: %v", err)
		}
	}
}

func TestChavesEstrangeiras(t *testing.T) {
	b := abrirTeste(t)
	_, err := b.db.Exec(`INSERT INTO pessoas(empresa_id, ramal, nome, nome_busca, entrou_em) VALUES (999, '2003', 'Ana Souza', 'ana souza', 1)`)
	if err == nil {
		t.Fatal("pessoa com empresa_id 999 devia dar erro")
	}
}

func exec(t *testing.T, b *Banco, q string, args ...any) {
	t.Helper()
	if _, err := b.db.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func TestApagarEmpresa_EmCascata(t *testing.T) {
	b := abrirTeste(t)
	exec(t, b, `INSERT INTO empresas(id, nome, codigo, criada_em) VALUES (1, 'ACME Comércio Ltda', 'ABCD-EFGH', 1)`)
	exec(t, b, `INSERT INTO pessoas(id, empresa_id, ramal, nome, nome_busca, entrou_em) VALUES (1, 1, '2003', 'Ana Souza', 'ana souza', 1)`)
	exec(t, b, `INSERT INTO computadores(id, empresa_id, chave_hash, nome, pessoa_id, ligado_em, ultima_vez) VALUES (1, 1, x'0102', 'PC da Ana', 1, 1, 1)`)
	exec(t, b, `INSERT INTO computador_pessoas(computador_id, pessoa_id, primeira_vez, ultima_vez) VALUES (1, 1, 1, 1)`)
	exec(t, b, `INSERT INTO conversas(id, empresa_id, tipo, nome, criou_id, cuida_id, criada_em, atualizada_em) VALUES (1, 1, 'grupo', 'Vendas', 1, 1, 1, 1)`)
	exec(t, b, `INSERT INTO membros(conversa_id, pessoa_id, entrou_em) VALUES (1, 1, 1)`)
	exec(t, b, `INSERT INTO arquivos(id, empresa_id, autor_id, nome, tipo, tamanho, criado_em) VALUES ('aa', 1, 1, 'a.pdf', 'application/pdf', 10, 1)`)
	exec(t, b, `INSERT INTO mensagens(conversa_id, autor_id, tipo, arquivo_id, criada_em) VALUES (1, 1, 'arquivo', 'aa', 1)`)
	exec(t, b, `INSERT INTO leituras(pessoa_id, conversa_id, ate) VALUES (1, 1, 1)`)

	exec(t, b, `DELETE FROM empresas WHERE id=?`, 1)

	for _, tabela := range []string{"empresas", "pessoas", "computadores", "computador_pessoas", "conversas", "membros", "arquivos", "mensagens", "leituras"} {
		var n int
		if err := b.db.QueryRow("SELECT COUNT(*) FROM " + tabela).Scan(&n); err != nil {
			t.Fatalf("%s: %v", tabela, err)
		}
		if n != 0 {
			t.Errorf("%s ficou com %d linhas", tabela, n)
		}
	}
}

func TestRamalAtivoUnico(t *testing.T) {
	b := abrirTeste(t)
	exec(t, b, `INSERT INTO empresas(id, nome, codigo, criada_em) VALUES (1, 'ACME Comércio Ltda', 'ABCD-EFGH', 1), (2, 'Outra Ltda', 'WXYZ-2345', 1)`)
	const ins = `INSERT INTO pessoas(empresa_id, ramal, nome, nome_busca, entrou_em) VALUES (?, '2003', ?, ?, 1)`
	exec(t, b, ins, 1, "Ana Souza", "ana souza")
	if _, err := b.db.Exec(ins, 1, "Bia Lima", "bia lima"); err == nil {
		t.Fatal("dois ativos com o mesmo ramal na mesma empresa deviam dar erro")
	}
	exec(t, b, `UPDATE pessoas SET saiu_em=2 WHERE nome='Ana Souza'`)
	exec(t, b, ins, 1, "Bia Lima", "bia lima")
	exec(t, b, ins, 2, "Caio Reis", "caio reis")
}

func TestTx_UsaBeginImmediate(t *testing.T) {
	// Com BEGIN IMMEDIATE o bloqueio de escrita é tomado já no início da transação,
	// então outra conexão não consegue escrever enquanto a transação está aberta,
	// mesmo que a transação ainda não tenha escrito nada.
	b := abrirTeste(t)
	outra, err := sql.Open("sqlite", "file:"+b.caminho+"?_pragma=busy_timeout(100)")
	if err != nil {
		t.Fatal(err)
	}
	defer outra.Close()
	err = b.Tx(context.Background(), func(tx *sql.Tx) error {
		_, e := outra.Exec(`INSERT INTO empresas(nome, codigo, criada_em) VALUES ('X', 'X', 1)`)
		if e == nil {
			t.Error("a escrita de outra conexão devia ser bloqueada durante a Tx")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestTx_Desfaz(t *testing.T) {
	b := abrirTeste(t)
	falha := errors.New("falha")
	err := b.Tx(context.Background(), func(tx *sql.Tx) error {
		if _, e := tx.Exec(`INSERT INTO empresas(nome, codigo, criada_em) VALUES ('X', 'X', 1)`); e != nil {
			return e
		}
		return falha
	})
	if !errors.Is(err, falha) {
		t.Fatalf("err = %v", err)
	}
	var n int
	if err := b.db.QueryRow("SELECT COUNT(*) FROM empresas").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("a Tx devia ter desfeito, mas há %d empresas", n)
	}
	if err := b.Tx(context.Background(), func(tx *sql.Tx) error {
		_, e := tx.Exec(`INSERT INTO empresas(nome, codigo, criada_em) VALUES ('X', 'X', 1)`)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if err := b.db.QueryRow("SELECT COUNT(*) FROM empresas").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("a Tx devia ter confirmado, mas há %d empresas", n)
	}
}

func TestAgoraMs_ERelogio(t *testing.T) {
	b := abrirTeste(t)
	if b.agoraMs() != 1_700_000_000_000 {
		t.Fatalf("agoraMs = %d", b.agoraMs())
	}
	if b.Relogio() == nil {
		t.Fatal("Relogio nil")
	}
}

func TestTx_PanicDesfaz(t *testing.T) {
	b := abrirTeste(t)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("o pânico devia continuar subindo")
			}
		}()
		b.Tx(context.Background(), func(tx *sql.Tx) error {
			if _, err := tx.Exec(`INSERT INTO empresas(nome, codigo, criada_em) VALUES ('X', 'X', 1)`); err != nil {
				t.Error(err)
			}
			panic("falha")
		})
	}()

	feito := make(chan error, 1)
	go func() {
		var n int
		err := b.db.QueryRow("SELECT COUNT(*) FROM empresas").Scan(&n)
		if err == nil && n != 0 {
			err = errors.New("a linha do pânico não foi desfeita")
		}
		if err == nil {
			err = b.Tx(context.Background(), func(tx *sql.Tx) error {
				_, e := tx.Exec(`INSERT INTO empresas(nome, codigo, criada_em) VALUES ('Y', 'Y', 1)`)
				return e
			})
		}
		feito <- err
	}()
	select {
	case err := <-feito:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a conexão ficou presa depois do pânico")
	}
}

func TestMigrar_DuasAberturasJuntas(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "chat.db")
	r := tempo.NovoTeste(time.UnixMilli(1_700_000_000_000))
	var wg sync.WaitGroup
	bancos := make([]*Banco, 2)
	erros := make([]error, 2)
	inicio := make(chan struct{})
	for i := range bancos {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-inicio
			bancos[i], erros[i] = Abrir(caminho, r)
		}()
	}
	close(inicio)
	wg.Wait()
	for i := range bancos {
		if erros[i] != nil {
			t.Fatalf("Abrir #%d: %v", i+1, erros[i])
		}
		defer bancos[i].Fechar()
	}
	var v int
	if err := bancos[0].db.QueryRow("PRAGMA user_version").Scan(&v); err != nil || v != 1 {
		t.Fatalf("user_version = %d, %v; queria 1", v, err)
	}
}
