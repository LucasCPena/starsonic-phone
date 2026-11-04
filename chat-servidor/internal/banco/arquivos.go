package banco

import (
	"context"
	"database/sql"
	"errors"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// ErrExpirado diz que o arquivo passou do prazo e saiu do servidor.
var ErrExpirado = errors.New("banco: arquivo expirado")

// CriarArquivo grava a linha de um arquivo já guardado no disco, com o id que ele tem lá. O
// autor tem de ser da empresa, senão dá ErrNaoEncontrado. O tipo é o já conferido
// (regras.TipoArquivo), e o nome o já limpo (regras.NomeArquivo).
func (b *Banco) CriarArquivo(ctx context.Context, id string, empresaID, autorID int64, nome, tipo string, tamanho int64) (Arquivo, error) {
	_, foto := regras.TipoArquivo(tipo)
	r, err := b.db.ExecContext(ctx,
		`INSERT INTO arquivos (id, empresa_id, autor_id, nome, tipo, tamanho, criado_em)
		 SELECT ?, p.empresa_id, p.id, ?, ?, ?, ? FROM pessoas p WHERE p.id = ? AND p.empresa_id = ?`,
		id, nome, tipo, tamanho, b.agoraMs(), autorID, empresaID)
	if err != nil {
		return Arquivo{}, err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return Arquivo{}, ErrNaoEncontrado
	}
	return Arquivo{ID: id, Nome: nome, Tipo: tipo, Tamanho: tamanho, Foto: foto}, nil
}

// lerArquivo lê as colunas de um arquivo (id, nome, tipo, tamanho, miniatura, expirado_em).
func lerArquivo(l escaneavel) (Arquivo, error) {
	var (
		a        Arquivo
		mini     int64
		expirado sql.NullInt64
	)
	if err := l.Scan(&a.ID, &a.Nome, &a.Tipo, &a.Tamanho, &mini, &expirado); err != nil {
		return Arquivo{}, err
	}
	_, a.Foto = regras.TipoArquivo(a.Tipo)
	a.Miniatura = mini != 0
	a.Expirado = expirado.Valid
	return a, nil
}

// ArquivoParaBaixar acha o arquivo que pessoaID pode baixar na empresa: o que ela enviou, ou
// o que está numa mensagem que ela vê (numa conversa a dois dela, ou num grupo em que é
// membro e a mensagem é de depois de ela entrar). Os outros casos dão ErrNaoEncontrado,
// iguais a um id que não existe. Um arquivo expirado que ela poderia baixar dá ErrExpirado.
func (b *Banco) ArquivoParaBaixar(ctx context.Context, empresaID, pessoaID int64, id string) (Arquivo, error) {
	a, err := lerArquivo(b.db.QueryRowContext(ctx,
		`SELECT a.id, a.nome, a.tipo, a.tamanho, a.miniatura, a.expirado_em
		   FROM arquivos a
		  WHERE a.id = ? AND a.empresa_id = ?
		    AND (a.autor_id = ?
		         OR EXISTS (SELECT 1 FROM mensagens m
		                      JOIN conversas c ON c.id = m.conversa_id AND c.empresa_id = a.empresa_id
		                      LEFT JOIN membros mb ON mb.conversa_id = c.id AND mb.pessoa_id = ?
		                     WHERE m.arquivo_id = a.id
		                       AND ((c.tipo = 'dupla' AND (c.dupla_a = ? OR c.dupla_b = ?))
		                         OR (c.tipo = 'grupo' AND mb.saiu_em IS NULL
		                             AND mb.entrou_em IS NOT NULL AND m.criada_em >= mb.entrou_em))))`,
		id, empresaID, pessoaID, pessoaID, pessoaID, pessoaID))
	if errors.Is(err, sql.ErrNoRows) {
		return Arquivo{}, ErrNaoEncontrado
	}
	if err != nil {
		return Arquivo{}, err
	}
	if a.Expirado {
		return Arquivo{}, ErrExpirado
	}
	return a, nil
}

// ArquivoDoAutor acha o arquivo que autorID enviou, na empresa. De outra pessoa, ou de outra
// empresa, dá ErrNaoEncontrado; expirado, dá ErrExpirado.
func (b *Banco) ArquivoDoAutor(ctx context.Context, empresaID, autorID int64, id string) (Arquivo, error) {
	a, err := lerArquivo(b.db.QueryRowContext(ctx,
		`SELECT id, nome, tipo, tamanho, miniatura, expirado_em FROM arquivos
		  WHERE id = ? AND empresa_id = ? AND autor_id = ?`, id, empresaID, autorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Arquivo{}, ErrNaoEncontrado
	}
	if err != nil {
		return Arquivo{}, err
	}
	if a.Expirado {
		return Arquivo{}, ErrExpirado
	}
	return a, nil
}

// MarcarMiniatura diz que o arquivo de autorID tem miniatura. Só o autor marca (se não, dá
// ErrNaoEncontrado), só numa foto (se não, ErrInvalido), e não num arquivo expirado
// (ErrExpirado). Marcar de novo não muda nada.
func (b *Banco) MarcarMiniatura(ctx context.Context, autorID int64, id string) error {
	return b.Tx(ctx, func(tx *sql.Tx) error {
		var tipo string
		var expirado sql.NullInt64
		err := tx.QueryRowContext(ctx,
			`SELECT tipo, expirado_em FROM arquivos WHERE id = ? AND autor_id = ?`, id, autorID).Scan(&tipo, &expirado)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNaoEncontrado
		}
		if err != nil {
			return err
		}
		if expirado.Valid {
			return ErrExpirado
		}
		if _, foto := regras.TipoArquivo(tipo); !foto {
			return ErrInvalido
		}
		_, err = tx.ExecContext(ctx, `UPDATE arquivos SET miniatura = 1 WHERE id = ?`, id)
		return err
	})
}

// ArquivosParaExpirar acha os arquivos criados antes de antesDe (ms UTC) que ainda não
// foram marcados como expirados.
func (b *Banco) ArquivosParaExpirar(ctx context.Context, antesDe int64) ([]string, error) {
	return b.ids(ctx, `SELECT id FROM arquivos WHERE criado_em < ? AND expirado_em IS NULL ORDER BY criado_em`, antesDe)
}

// ArquivosSemMensagem acha os arquivos criados antes de antesDe (ms UTC) que nenhuma
// mensagem usa e que não expiraram: foram enviados e nunca entraram numa mensagem.
func (b *Banco) ArquivosSemMensagem(ctx context.Context, antesDe int64) ([]string, error) {
	return b.ids(ctx,
		`SELECT a.id FROM arquivos a
		  WHERE a.criado_em < ? AND a.expirado_em IS NULL
		    AND NOT EXISTS (SELECT 1 FROM mensagens m WHERE m.arquivo_id = a.id)
		  ORDER BY a.criado_em`, antesDe)
}

func (b *Banco) ids(ctx context.Context, q string, args ...any) ([]string, error) {
	rows, err := b.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// MarcarExpirado marca o arquivo como expirado agora e zera a miniatura. Devolve se marcou:
// um arquivo que já estava expirado, ou que não existe, devolve false.
func (b *Banco) MarcarExpirado(ctx context.Context, id string) (bool, error) {
	r, err := b.db.ExecContext(ctx,
		`UPDATE arquivos SET expirado_em = ?, miniatura = 0 WHERE id = ? AND expirado_em IS NULL`,
		b.agoraMs(), id)
	if err != nil {
		return false, err
	}
	n, err := r.RowsAffected()
	return n > 0, err
}

// ApagarArquivo apaga a linha do arquivo, mas só se nenhuma mensagem o usa; a conferência e
// o DELETE são um só comando, então uma mensagem que chega no meio não perde o arquivo.
// Devolve se apagou.
func (b *Banco) ApagarArquivo(ctx context.Context, id string) (bool, error) {
	r, err := b.db.ExecContext(ctx,
		`DELETE FROM arquivos WHERE id = ? AND NOT EXISTS (SELECT 1 FROM mensagens WHERE arquivo_id = ?)`,
		id, id)
	if err != nil {
		return false, err
	}
	n, err := r.RowsAffected()
	return n > 0, err
}

// EstadoArquivo diz se há linha para o id e, havendo, se está expirada e se tem miniatura.
// Serve à varredura do disco.
func (b *Banco) EstadoArquivo(ctx context.Context, id string) (existe, expirado, miniatura bool, err error) {
	var mini int64
	var exp sql.NullInt64
	err = b.db.QueryRowContext(ctx, `SELECT miniatura, expirado_em FROM arquivos WHERE id = ?`, id).Scan(&mini, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, false, nil
	}
	if err != nil {
		return false, false, false, err
	}
	return true, exp.Valid, mini != 0, nil
}
