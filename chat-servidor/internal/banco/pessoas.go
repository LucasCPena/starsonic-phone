package banco

import (
	"context"
	"database/sql"
	"errors"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// Pessoa é uma pessoa de uma empresa. Saiu diz se ela foi tirada do chat.
type Pessoa struct {
	ID, EmpresaID int64
	Ramal, Nome   string
	Saiu          bool
}

// EntrarComoPessoa faz o computador agir como a pessoa ativa da empresa com esse ramal, que
// fica com o nome novo; sem ela, cria uma pessoa nova (quem foi tirada nunca volta). outros
// são os computadores ativos que agem como essa pessoa agora, para o evento computadorNovo,
// e só vêm na primeira vez dela neste computador. Um computador que saiu, ou de outra
// empresa, dá ErrNaoEncontrado, sem mudar nada.
func (b *Banco) EntrarComoPessoa(ctx context.Context, computadorID, empresaID int64, ramal, nome string) (p Pessoa, outros []int64, err error) {
	agora := b.agoraMs()
	p = Pessoa{EmpresaID: empresaID, Ramal: ramal, Nome: nome}
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM pessoas WHERE empresa_id = ? AND ramal = ? AND saiu_em IS NULL`,
			empresaID, ramal).Scan(&p.ID)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			r, err := tx.ExecContext(ctx,
				`INSERT INTO pessoas (empresa_id, ramal, nome, nome_busca, entrou_em) VALUES (?, ?, ?, ?, ?)`,
				empresaID, ramal, nome, regras.Dobrar(nome), agora)
			if err != nil {
				return err
			}
			if p.ID, err = r.LastInsertId(); err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			if _, err := tx.ExecContext(ctx,
				`UPDATE pessoas SET nome = ?, nome_busca = ? WHERE id = ?`,
				nome, regras.Dobrar(nome), p.ID); err != nil {
				return err
			}
		}

		r, err := tx.ExecContext(ctx,
			`UPDATE computadores SET pessoa_id = ? WHERE id = ? AND empresa_id = ? AND saiu_em IS NULL`,
			p.ID, computadorID, empresaID)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNaoEncontrado // desfaz a pessoa criada acima
		}

		r, err = tx.ExecContext(ctx,
			`INSERT INTO computador_pessoas (computador_id, pessoa_id, primeira_vez) VALUES (?, ?, ?)
			 ON CONFLICT DO NOTHING`, computadorID, p.ID, agora)
		if err != nil {
			return err
		}
		n, err := r.RowsAffected()
		if err != nil || n == 0 {
			return err // ela já esteve neste computador: ninguém é avisado
		}
		outros, err = lerIDs(ctx, tx,
			`SELECT id FROM computadores WHERE pessoa_id = ? AND saiu_em IS NULL AND id <> ? ORDER BY id`,
			p.ID, computadorID)
		return err
	})
	if err != nil {
		return Pessoa{}, nil, err
	}
	return p, outros, nil
}

// Colegas são as pessoas ativas da empresa menos a da vez, na ordem do nome sem acento e
// sem caixa (o nome_busca) e, no empate, do id. Sem ninguém, a lista vem vazia, não nil.
func (b *Banco) Colegas(ctx context.Context, empresaID, excetoPessoaID int64) ([]Pessoa, error) {
	linhas, err := b.db.QueryContext(ctx,
		`SELECT id, ramal, nome FROM pessoas
		  WHERE empresa_id = ? AND saiu_em IS NULL AND id <> ?
		  ORDER BY nome_busca, id`, empresaID, excetoPessoaID)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	lista := []Pessoa{}
	for linhas.Next() {
		p := Pessoa{EmpresaID: empresaID}
		if err := linhas.Scan(&p.ID, &p.Ramal, &p.Nome); err != nil {
			return nil, err
		}
		lista = append(lista, p)
	}
	return lista, linhas.Err()
}

// PessoaPorID acha a pessoa da empresa, também a que saiu. O id de uma pessoa de outra
// empresa dá ErrNaoEncontrado, como um que não existe.
func (b *Banco) PessoaPorID(ctx context.Context, empresaID, id int64) (Pessoa, error) {
	p := Pessoa{EmpresaID: empresaID}
	var saiu sql.NullInt64
	err := b.db.QueryRowContext(ctx,
		`SELECT id, ramal, nome, saiu_em FROM pessoas WHERE id = ? AND empresa_id = ?`, id, empresaID).
		Scan(&p.ID, &p.Ramal, &p.Nome, &saiu)
	if errors.Is(err, sql.ErrNoRows) {
		return Pessoa{}, ErrNaoEncontrado
	}
	if err != nil {
		return Pessoa{}, err
	}
	p.Saiu = saiu.Valid
	return p, nil
}

// ComputadoresDaPessoa são os computadores ativos que agem como a pessoa agora, em ordem
// de id.
func (b *Banco) ComputadoresDaPessoa(ctx context.Context, pessoaID int64) ([]int64, error) {
	return lerIDs(ctx, b.db,
		`SELECT id FROM computadores WHERE pessoa_id = ? AND saiu_em IS NULL ORDER BY id`, pessoaID)
}

// leitor é o que o *sql.DB e o *sql.Tx têm em comum para as consultas.
type leitor interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// lerIDs devolve a primeira coluna de cada linha da consulta.
func lerIDs(ctx context.Context, l leitor, consulta string, args ...any) ([]int64, error) {
	linhas, err := l.QueryContext(ctx, consulta, args...)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	var ids []int64
	for linhas.Next() {
		var id int64
		if err := linhas.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, linhas.Err()
}
