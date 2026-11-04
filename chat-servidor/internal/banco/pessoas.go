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

		// A última vez dela neste computador é agora, a primeira ou não (a página mostra).
		r, err = tx.ExecContext(ctx,
			`INSERT INTO computador_pessoas (computador_id, pessoa_id, primeira_vez, ultima_vez) VALUES (?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`, computadorID, p.ID, agora, agora)
		if err != nil {
			return err
		}
		n, err := r.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 { // ela já esteve neste computador: ninguém é avisado
			_, err = tx.ExecContext(ctx,
				`UPDATE computador_pessoas SET ultima_vez = ? WHERE computador_id = ? AND pessoa_id = ?`,
				agora, computadorID, p.ID)
			return err
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
	return lerColuna[int64](ctx, l, consulta, args...)
}

// lerTextos devolve a primeira coluna de cada linha da consulta, como texto.
func lerTextos(ctx context.Context, l leitor, consulta string, args ...any) ([]string, error) {
	return lerColuna[string](ctx, l, consulta, args...)
}

func lerColuna[T any](ctx context.Context, l leitor, consulta string, args ...any) ([]T, error) {
	linhas, err := l.QueryContext(ctx, consulta, args...)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	var lista []T
	for linhas.Next() {
		var v T
		if err := linhas.Scan(&v); err != nil {
			return nil, err
		}
		lista = append(lista, v)
	}
	return lista, linhas.Err()
}

// ComputadorVisto é um computador ativo na lista da página de administração, na linha de uma
// pessoa. UltimaVez é a última vez dessa pessoa nele (a do computador_pessoas), não a do
// computador: um computador de várias pessoas tem uma em cada linha.
type ComputadorVisto struct {
	ID        int64
	Nome      string
	UltimaVez int64 // ms UTC
}

// PessoaComComputadores é uma pessoa ativa da empresa, na página de administração, com os
// computadores ativos em que ela já entrou (um computador de várias pessoas aparece em cada
// uma), em ordem de nome. UltimaVez é a mais nova das últimas vezes dela nesses computadores,
// ou 0 sem nenhum: quem deixou um computador que outra pessoa usa agora não parece ativa hoje.
type PessoaComComputadores struct {
	Pessoa
	Computadores []ComputadorVisto
	UltimaVez    int64
}

// PessoasDaEmpresa são as pessoas ativas da empresa, em ordem de nome sem acento e sem caixa
// (no empate, de id), cada uma com os computadores dela. Sem ninguém, a lista vem vazia.
func (b *Banco) PessoasDaEmpresa(ctx context.Context, empresaID int64) ([]PessoaComComputadores, error) {
	linhas, err := b.db.QueryContext(ctx,
		`SELECT id, ramal, nome FROM pessoas WHERE empresa_id = ? AND saiu_em IS NULL ORDER BY nome_busca, id`,
		empresaID)
	if err != nil {
		return nil, err
	}
	lista := []PessoaComComputadores{}
	pos := map[int64]int{}
	for linhas.Next() {
		p := PessoaComComputadores{Pessoa: Pessoa{EmpresaID: empresaID}, Computadores: []ComputadorVisto{}}
		if err := linhas.Scan(&p.ID, &p.Ramal, &p.Nome); err != nil {
			linhas.Close()
			return nil, err
		}
		pos[p.ID] = len(lista)
		lista = append(lista, p)
	}
	err = linhas.Err()
	linhas.Close() // com uma só conexão, a consulta abaixo espera esta terminar
	if err != nil {
		return nil, err
	}

	linhas, err = b.db.QueryContext(ctx,
		`SELECT x.pessoa_id, c.id, c.nome, x.ultima_vez
		   FROM computador_pessoas x JOIN computadores c ON c.id = x.computador_id
		  WHERE c.empresa_id = ? AND c.saiu_em IS NULL
		  ORDER BY c.nome, c.id`, empresaID)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	for linhas.Next() {
		var pessoaID int64
		var c ComputadorVisto
		if err := linhas.Scan(&pessoaID, &c.ID, &c.Nome, &c.UltimaVez); err != nil {
			return nil, err
		}
		i, ok := pos[pessoaID]
		if !ok { // uma pessoa que saiu
			continue
		}
		lista[i].Computadores = append(lista[i].Computadores, c)
		lista[i].UltimaVez = max(lista[i].UltimaVez, c.UltimaVez)
	}
	return lista, linhas.Err()
}

// AvisoDeGrupo é um aviso gravado num grupo: a conversa e o id da mensagem do aviso.
type AvisoDeGrupo struct{ ConversaID, MensagemID int64 }

// TirarPessoa tira a pessoa do chat, numa transação só: ela sai de todos os grupos em que
// está, com o aviso saiu em cada um e a passagem do cuidado de quem cuidava (a mesma do
// TirarMembro); ela fica marcada como saiu e nunca volta (o mesmo ramal, depois, é uma pessoa
// nova); e os computadores que agem como ela saem do chat. Devolve esses computadores, para o
// Hub.Fora, e os avisos, para os eventos, que vão depois do commit. Uma pessoa que já saiu não
// muda nada. Uma de outra empresa, ou que não existe, dá ErrNaoEncontrado.
func (b *Banco) TirarPessoa(ctx context.Context, empresaID, pessoaID int64) (computadores []int64, avisos []AvisoDeGrupo, err error) {
	agora := b.agoraMs()
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		p, err := pessoaDaEmpresa(ctx, tx, empresaID, pessoaID)
		if err != nil {
			return err
		}
		if p.Saiu {
			return nil
		}
		grupos, err := gruposDaPessoa(ctx, tx, pessoaID)
		if err != nil {
			return err
		}
		for _, g := range grupos {
			a, err := sairDoGrupo(ctx, tx, g.id, g.cuida, pessoaID, pessoaID, agora)
			if err != nil {
				return err
			}
			avisos = append(avisos, AvisoDeGrupo{ConversaID: g.id, MensagemID: a})
		}
		if _, err := tx.ExecContext(ctx, `UPDATE pessoas SET saiu_em = ? WHERE id = ?`, agora, pessoaID); err != nil {
			return err
		}
		computadores, err = lerIDs(ctx, tx,
			`SELECT id FROM computadores WHERE pessoa_id = ? AND saiu_em IS NULL ORDER BY id`, pessoaID)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx,
			`UPDATE computadores SET saiu_em = ? WHERE pessoa_id = ? AND saiu_em IS NULL`, agora, pessoaID)
		return err
	})
	if err != nil {
		return nil, nil, err
	}
	return computadores, avisos, nil
}
