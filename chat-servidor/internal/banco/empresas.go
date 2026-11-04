package banco

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// Empresa é uma empresa cliente, com o código que liga os computadores dela.
type Empresa struct {
	ID       int64
	Nome     string
	Codigo   string
	CriadaEm int64
}

// ResumoEmpresa é a empresa na página de administração: as pessoas ativas e os bytes dos
// arquivos que estão no disco (os expirados já saíram).
type ResumoEmpresa struct {
	Empresa
	Pessoas int
	Bytes   int64
}

// codigoLivre sorteia um código que nenhuma empresa usa. Vai dentro da transação, que segura
// a escrita: ninguém pega o mesmo código no meio. Tenta até 20 vezes.
func codigoLivre(ctx context.Context, tx *sql.Tx) (string, error) {
	for i := 0; i < 20; i++ {
		c := segredo.NovoCodigo()
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM empresas WHERE codigo = ?`, c).Scan(&n); err != nil {
			return "", err
		}
		if n == 0 {
			return c, nil
		}
	}
	return "", errors.New("banco: não achei um código livre para a empresa")
}

// CriarEmpresa cria uma empresa com um código novo, que nenhuma outra usa.
func (b *Banco) CriarEmpresa(ctx context.Context, nome string) (Empresa, error) {
	e := Empresa{Nome: nome, CriadaEm: b.agoraMs()}
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if e.Codigo, err = codigoLivre(ctx, tx); err != nil {
			return err
		}
		r, err := tx.ExecContext(ctx,
			`INSERT INTO empresas (nome, codigo, criada_em) VALUES (?, ?, ?)`, e.Nome, e.Codigo, e.CriadaEm)
		if err != nil {
			return err
		}
		e.ID, err = r.LastInsertId()
		return err
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

// TrocarCodigo dá à empresa um código novo; o antigo deixa de valer para ligar computadores.
// Os computadores já ligados continuam (eles usam a chave). Devolve o código novo. Uma
// empresa que não existe dá ErrNaoEncontrado.
func (b *Banco) TrocarCodigo(ctx context.Context, empresaID int64) (string, error) {
	var codigo string
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if codigo, err = codigoLivre(ctx, tx); err != nil { // o atual está em uso: nunca volta
			return err
		}
		r, err := tx.ExecContext(ctx, `UPDATE empresas SET codigo = ? WHERE id = ?`, codigo, empresaID)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNaoEncontrado
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return codigo, nil
}

// Empresas são todas as empresas, com o resumo de cada uma, em ordem de nome sem acento e sem
// caixa (no empate, de id). Sem nenhuma, a lista vem vazia.
func (b *Banco) Empresas(ctx context.Context) ([]ResumoEmpresa, error) {
	return b.resumosEmpresas(ctx, 0)
}

// ResumoDaEmpresa é o resumo de uma empresa. Uma que não existe dá ErrNaoEncontrado.
func (b *Banco) ResumoDaEmpresa(ctx context.Context, id int64) (ResumoEmpresa, error) {
	if id <= 0 {
		return ResumoEmpresa{}, ErrNaoEncontrado
	}
	l, err := b.resumosEmpresas(ctx, id)
	if err != nil {
		return ResumoEmpresa{}, err
	}
	if len(l) == 0 {
		return ResumoEmpresa{}, ErrNaoEncontrado
	}
	return l[0], nil
}

// resumosEmpresas monta os resumos; id 0 não filtra.
func (b *Banco) resumosEmpresas(ctx context.Context, id int64) ([]ResumoEmpresa, error) {
	linhas, err := b.db.QueryContext(ctx,
		`SELECT e.id, e.nome, e.codigo, e.criada_em, COALESCE(p.n, 0), COALESCE(a.bytes, 0)
		   FROM empresas e
		   LEFT JOIN (SELECT empresa_id, COUNT(*) AS n FROM pessoas
		               WHERE saiu_em IS NULL AND (?1 = 0 OR empresa_id = ?1) GROUP BY empresa_id) p
		          ON p.empresa_id = e.id
		   LEFT JOIN (SELECT empresa_id, SUM(tamanho) AS bytes FROM arquivos
		               WHERE expirado_em IS NULL AND (?1 = 0 OR empresa_id = ?1) GROUP BY empresa_id) a
		          ON a.empresa_id = e.id
		  WHERE ?1 = 0 OR e.id = ?1`, id)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	lista := []ResumoEmpresa{}
	for linhas.Next() {
		var r ResumoEmpresa
		if err := linhas.Scan(&r.ID, &r.Nome, &r.Codigo, &r.CriadaEm, &r.Pessoas, &r.Bytes); err != nil {
			return nil, err
		}
		lista = append(lista, r)
	}
	if err := linhas.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(lista, func(i, j int) bool {
		a, c := regras.Dobrar(lista[i].Nome), regras.Dobrar(lista[j].Nome)
		if a != c {
			return a < c
		}
		return lista[i].ID < lista[j].ID
	})
	return lista, nil
}

// ApagarEmpresa apaga a empresa e tudo dela no banco (as tabelas apagam em cascata), numa
// transação só. Devolve os ids dos arquivos dela, para quem chama tirar do disco, e de todos
// os computadores dela, para o Hub.Fora. Uma empresa que não existe dá ErrNaoEncontrado.
func (b *Banco) ApagarEmpresa(ctx context.Context, empresaID int64) (arquivos []string, computadores []int64, err error) {
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if arquivos, err = lerTextos(ctx, tx, `SELECT id FROM arquivos WHERE empresa_id = ? ORDER BY id`, empresaID); err != nil {
			return err
		}
		if computadores, err = lerIDs(ctx, tx, `SELECT id FROM computadores WHERE empresa_id = ? ORDER BY id`, empresaID); err != nil {
			return err
		}
		r, err := tx.ExecContext(ctx, `DELETE FROM empresas WHERE id = ?`, empresaID)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNaoEncontrado
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return arquivos, computadores, nil
}
