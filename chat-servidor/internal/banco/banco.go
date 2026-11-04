// Package banco é o SQLite do servidor: abrir o arquivo, aplicar as migrações e
// guardar as consultas (um arquivo por assunto, nas tarefas seguintes).
package banco

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // o driver, sem cgo

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// Os erros que as consultas devolvem e a API traduz em respostas.
var (
	ErrNaoEncontrado = errors.New("banco: não encontrado")
	ErrProibido      = errors.New("banco: proibido")
	ErrGrupoCheio    = errors.New("banco: o grupo já tem 200 pessoas")
)

//go:embed migracoes/*.sql
var migracoes embed.FS

// Banco é o banco de dados aberto, junto com o relógio que marca as horas.
type Banco struct {
	db      *sql.DB
	relogio tempo.Relogio
	caminho string
}

// Abrir abre (ou cria) o banco em caminho e aplica as migrações que faltam.
//
// Há uma só conexão (SetMaxOpenConns(1)): todo acesso do servidor passa numa fila,
// e o "banco ocupado" não acontece. As transações usam BEGIN IMMEDIATE
// (parâmetro _txlock=immediate do driver). A cópia de segurança usa outra conexão.
func Abrir(caminho string, r tempo.Relogio) (*Banco, error) {
	esc := strings.NewReplacer("%", "%25", "?", "%3F", "#", "%23").Replace(caminho)
	dsn := "file:" + esc +
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("banco: abrir %s: %w", caminho, err)
	}
	db.SetMaxOpenConns(1)
	b := &Banco{db: db, relogio: r, caminho: caminho}
	if err := b.migrar(); err != nil {
		db.Close()
		return nil, err
	}
	return b, nil
}

// Fechar fecha o banco.
func (b *Banco) Fechar() error { return b.db.Close() }

// Relogio devolve o relógio com que o banco foi aberto.
func (b *Banco) Relogio() tempo.Relogio { return b.relogio }

// agoraMs é a hora do relógio em milissegundos UTC, como o banco guarda.
func (b *Banco) agoraMs() int64 { return b.relogio.Agora().UnixMilli() }

// Tx roda f numa transação BEGIN IMMEDIATE: confirma se f devolve nil e desfaz se não.
//
// Regra: com uma só conexão aberta, f deve usar APENAS o *sql.Tx que recebe.
// Chamar o *sql.DB (ou qualquer método do Banco que o use) dentro de f fica
// esperando para sempre pela única conexão, que a transação está segurando.
func (b *Banco) Tx(ctx context.Context, f func(*sql.Tx) error) error {
	tx, err := b.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := f(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

type migracao struct {
	versao int
	nome   string
}

// migrar aplica, em ordem, as migrações com versão maior que o user_version.
func (b *Banco) migrar() error {
	entradas, err := migracoes.ReadDir("migracoes")
	if err != nil {
		return err
	}
	var lista []migracao
	for _, e := range entradas {
		n, _, ok := strings.Cut(e.Name(), "_")
		v, err := strconv.Atoi(n)
		if !ok || err != nil {
			return fmt.Errorf("banco: nome de migração inválido: %s", e.Name())
		}
		lista = append(lista, migracao{v, e.Name()})
	}
	sort.Slice(lista, func(i, j int) bool { return lista[i].versao < lista[j].versao })

	var atual int
	if err := b.db.QueryRow("PRAGMA user_version").Scan(&atual); err != nil {
		return fmt.Errorf("banco: ler user_version: %w", err)
	}
	for _, m := range lista {
		if m.versao <= atual {
			continue
		}
		sqlTexto, err := migracoes.ReadFile("migracoes/" + m.nome)
		if err != nil {
			return err
		}
		err = b.Tx(context.Background(), func(tx *sql.Tx) error {
			if _, err := tx.Exec(string(sqlTexto)); err != nil {
				return err
			}
			_, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", m.versao))
			return err
		})
		if err != nil {
			return fmt.Errorf("banco: migração %s: %w", m.nome, err)
		}
	}
	return nil
}
