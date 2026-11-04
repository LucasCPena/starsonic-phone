package banco

import (
	"context"
	"database/sql"
	"errors"
)

// Computador é um computador ligado a uma empresa. PessoaID 0 quer dizer "sem pessoa".
type Computador struct {
	ID        int64
	EmpresaID int64
	Nome      string
	PessoaID  int64
}

// LigarComputador guarda um computador novo da empresa. O banco guarda só o SHA-256 da chave.
func (b *Banco) LigarComputador(ctx context.Context, empresaID int64, nome string, chaveHash []byte) (Computador, error) {
	agora := b.agoraMs()
	r, err := b.db.ExecContext(ctx,
		`INSERT INTO computadores (empresa_id, chave_hash, nome, ligado_em, ultima_vez) VALUES (?, ?, ?, ?, ?)`,
		empresaID, chaveHash, nome, agora, agora)
	if err != nil {
		return Computador{}, err
	}
	id, err := r.LastInsertId()
	return Computador{ID: id, EmpresaID: empresaID, Nome: nome}, err
}

// ComputadorPorChave acha o computador ativo e a empresa dele pelo hash da chave, e
// atualiza a ultima_vez dele, no máximo uma vez por minuto. Junto, no mesmo ritmo, atualiza a
// última vez da pessoa da vez nele (a do computador_pessoas), que a página de administração
// mostra.
func (b *Banco) ComputadorPorChave(ctx context.Context, chaveHash []byte) (Computador, Empresa, error) {
	return b.computadorPorChave(ctx, chaveHash, true)
}

// ComputadorParaTrocar é o ComputadorPorChave do pedido que troca a pessoa do computador (o
// POST /api/v1/pessoas/eu): atualiza a ultima_vez do computador, mas não a da pessoa de antes
// nele, porque quem pede já é a próxima. A da próxima vem no EntrarComoPessoa.
func (b *Banco) ComputadorParaTrocar(ctx context.Context, chaveHash []byte) (Computador, Empresa, error) {
	return b.computadorPorChave(ctx, chaveHash, false)
}

func (b *Banco) computadorPorChave(ctx context.Context, chaveHash []byte, daPessoa bool) (Computador, Empresa, error) {
	var c Computador
	var e Empresa
	var pessoa sql.NullInt64
	err := b.db.QueryRowContext(ctx,
		`SELECT c.id, c.empresa_id, c.nome, c.pessoa_id, e.id, e.nome, e.codigo, e.criada_em
		   FROM computadores c JOIN empresas e ON e.id = c.empresa_id
		  WHERE c.chave_hash = ? AND c.saiu_em IS NULL`, chaveHash).
		Scan(&c.ID, &c.EmpresaID, &c.Nome, &pessoa, &e.ID, &e.Nome, &e.Codigo, &e.CriadaEm)
	if errors.Is(err, sql.ErrNoRows) {
		return Computador{}, Empresa{}, ErrNaoEncontrado
	}
	if err != nil {
		return Computador{}, Empresa{}, err
	}
	c.PessoaID = pessoa.Int64
	agora := b.agoraMs()
	r, err := b.db.ExecContext(ctx,
		`UPDATE computadores SET ultima_vez = ? WHERE id = ? AND ultima_vez <= ?`,
		agora, c.ID, agora-60_000)
	if err != nil {
		return Computador{}, Empresa{}, err
	}
	if !daPessoa || c.PessoaID == 0 {
		return c, e, nil
	}
	// A última vez da pessoa da vez neste computador vai junto com a dele, no mesmo ritmo.
	if n, err := r.RowsAffected(); err != nil {
		return Computador{}, Empresa{}, err
	} else if n == 1 {
		if _, err := b.db.ExecContext(ctx,
			`UPDATE computador_pessoas SET ultima_vez = ? WHERE computador_id = ? AND pessoa_id = ?`,
			agora, c.ID, c.PessoaID); err != nil {
			return Computador{}, Empresa{}, err
		}
	}
	return c, e, nil
}

// ComputadorAtivo acha o computador pelo id, se ele não saiu. É para o WebSocket, que chega
// com o bilhete e não com a chave.
func (b *Banco) ComputadorAtivo(ctx context.Context, id int64) (Computador, error) {
	var c Computador
	var pessoa sql.NullInt64
	err := b.db.QueryRowContext(ctx,
		`SELECT id, empresa_id, nome, pessoa_id FROM computadores WHERE id = ? AND saiu_em IS NULL`, id).
		Scan(&c.ID, &c.EmpresaID, &c.Nome, &pessoa)
	if errors.Is(err, sql.ErrNoRows) {
		return Computador{}, ErrNaoEncontrado
	}
	if err != nil {
		return Computador{}, err
	}
	c.PessoaID = pessoa.Int64
	return c, nil
}

// DesligarComputador faz a chave do computador deixar de valer.
func (b *Banco) DesligarComputador(ctx context.Context, id int64) error {
	_, err := b.db.ExecContext(ctx,
		`UPDATE computadores SET saiu_em = ? WHERE id = ? AND saiu_em IS NULL`, b.agoraMs(), id)
	return err
}

// TirarComputador faz a chave do computador da empresa deixar de valer, pela página de
// administração. Tirar de novo não muda nada. Um computador de outra empresa, ou que não
// existe, dá ErrNaoEncontrado.
func (b *Banco) TirarComputador(ctx context.Context, empresaID, computadorID int64) error {
	return b.Tx(ctx, func(tx *sql.Tx) error {
		var saiu sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT saiu_em FROM computadores WHERE id = ? AND empresa_id = ?`,
			computadorID, empresaID).Scan(&saiu)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNaoEncontrado
		}
		if err != nil || saiu.Valid {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE computadores SET saiu_em = ? WHERE id = ?`, b.agoraMs(), computadorID)
		return err
	})
}
