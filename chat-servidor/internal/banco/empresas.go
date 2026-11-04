package banco

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// Empresa é uma empresa cliente, com o código que liga os computadores dela.
type Empresa struct {
	ID       int64
	Nome     string
	Codigo   string
	CriadaEm int64
}

// CriarEmpresa cria uma empresa com um código novo. Se o código sortear repetido,
// sorteia outro.
func (b *Banco) CriarEmpresa(ctx context.Context, nome string) (Empresa, error) {
	e := Empresa{Nome: nome, CriadaEm: b.agoraMs()}
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		for i := 0; i < 20; i++ {
			e.Codigo = segredo.NovoCodigo()
			r, err := tx.ExecContext(ctx,
				`INSERT INTO empresas (nome, codigo, criada_em) VALUES (?, ?, ?) ON CONFLICT(codigo) DO NOTHING`,
				e.Nome, e.Codigo, e.CriadaEm)
			if err != nil {
				return err
			}
			if n, _ := r.RowsAffected(); n == 1 {
				e.ID, err = r.LastInsertId()
				return err
			}
		}
		return errors.New("banco: não achei um código livre para a empresa")
	})
	if err != nil {
		return Empresa{}, fmt.Errorf("banco: criar empresa: %w", err)
	}
	return e, nil
}

// EmpresaPorCodigo acha a empresa pelo código (já no formato STAR-XXXX-XXXX).
func (b *Banco) EmpresaPorCodigo(ctx context.Context, codigo string) (Empresa, error) {
	var e Empresa
	err := b.db.QueryRowContext(ctx,
		`SELECT id, nome, codigo, criada_em FROM empresas WHERE codigo = ?`, codigo).
		Scan(&e.ID, &e.Nome, &e.Codigo, &e.CriadaEm)
	if errors.Is(err, sql.ErrNoRows) {
		return Empresa{}, ErrNaoEncontrado
	}
	return e, err
}
