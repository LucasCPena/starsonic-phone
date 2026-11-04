package banco

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
)

// MaxPagina é o máximo de mensagens que um pedido traz (seção 8 do protocolo).
const MaxPagina = 50

// colunasMensagem e juncoesMensagem são o SELECT de uma Mensagem inteira: o autor, o alvo do
// aviso e o arquivo. lerMensagem lê as colunas nesta ordem.
const (
	colunasMensagem = `m.id, m.conversa_id, m.tipo, m.texto, m.aviso_acao, m.id_local, m.criada_em,
		a.id, a.ramal, a.nome, a.saiu_em, t.id, t.ramal, t.nome, t.saiu_em,
		f.id, f.nome, f.tipo, f.tamanho, f.miniatura, f.expirado_em`
	juncoesMensagem = `FROM mensagens m
		LEFT JOIN pessoas a ON a.id = m.autor_id
		LEFT JOIN pessoas t ON t.id = m.aviso_alvo_id
		LEFT JOIN arquivos f ON f.id = m.arquivo_id`
)

// escaneavel é o que o *sql.Row e o *sql.Rows têm em comum para ler uma linha.
type escaneavel interface {
	Scan(dest ...any) error
}

// lerMensagem lê uma linha do SELECT de colunasMensagem.
func lerMensagem(l escaneavel) (Mensagem, error) {
	var (
		m                               Mensagem
		texto, aviso, idLocal           sql.NullString
		aID, tID                        sql.NullInt64
		aRamal, aNome, tRamal, tNome    sql.NullString
		aSaiu, tSaiu                    sql.NullInt64
		fID, fNome, fTipo               sql.NullString
		fTamanho, fMiniatura, fExpirado sql.NullInt64
	)
	err := l.Scan(&m.ID, &m.ConversaID, &m.Tipo, &texto, &aviso, &idLocal, &m.CriadaEm,
		&aID, &aRamal, &aNome, &aSaiu, &tID, &tRamal, &tNome, &tSaiu,
		&fID, &fNome, &fTipo, &fTamanho, &fMiniatura, &fExpirado)
	if err != nil {
		return Mensagem{}, err
	}
	m.Texto, m.AvisoAcao, m.IDLocal = texto.String, aviso.String, idLocal.String
	if aID.Valid {
		m.Autor = &Pessoa{ID: aID.Int64, Ramal: aRamal.String, Nome: aNome.String, Saiu: aSaiu.Valid}
	}
	if tID.Valid {
		m.AvisoAlvo = &Pessoa{ID: tID.Int64, Ramal: tRamal.String, Nome: tNome.String, Saiu: tSaiu.Valid}
	}
	if fID.Valid {
		_, foto := regras.TipoArquivo(fTipo.String)
		m.Arquivo = &Arquivo{ID: fID.String, Nome: fNome.String, Tipo: fTipo.String, Tamanho: fTamanho.Int64,
			Foto: foto, Miniatura: fMiniatura.Int64 != 0, Expirado: fExpirado.Valid}
	}
	return m, nil
}

// mensagemPorID lê a mensagem como está gravada. Sem ela, dá ErrNaoEncontrado.
func mensagemPorID(ctx context.Context, l linhaUnica, id int64) (Mensagem, error) {
	m, err := lerMensagem(l.QueryRowContext(ctx, `SELECT `+colunasMensagem+` `+juncoesMensagem+` WHERE m.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Mensagem{}, ErrNaoEncontrado
	}
	return m, err
}

// MensagensPorID lê as mensagens de ids, na ordem dos ids, como estão gravadas (os avisos que
// a API manda como evento). Um id que não existe dá ErrNaoEncontrado.
func (b *Banco) MensagensPorID(ctx context.Context, ids []int64) ([]Mensagem, error) {
	lista := make([]Mensagem, 0, len(ids))
	for _, id := range ids {
		m, err := mensagemPorID(ctx, b.db, id)
		if err != nil {
			return nil, err
		}
		lista = append(lista, m)
	}
	return lista, nil
}

// desdeDe confere que eu está na conversa (a dois, ou grupo em que é membro ativo, da mesma
// empresa) e devolve a hora a partir da qual ele vê as mensagens: a última entrada no grupo,
// ou 0 na conversa a dois. Se não, dá ErrNaoEncontrado.
func desdeDe(ctx context.Context, l linhaUnica, eu, conversaID int64) (int64, error) {
	var (
		tipo         string
		duplaA, dupB sql.NullInt64
		entrou, saiu sql.NullInt64
	)
	err := l.QueryRowContext(ctx,
		`SELECT c.tipo, c.dupla_a, c.dupla_b, m.entrou_em, m.saiu_em
		   FROM conversas c
		   JOIN pessoas p ON p.id = ? AND p.empresa_id = c.empresa_id
		   LEFT JOIN membros m ON m.conversa_id = c.id AND m.pessoa_id = p.id
		  WHERE c.id = ?`, eu, conversaID).Scan(&tipo, &duplaA, &dupB, &entrou, &saiu)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNaoEncontrado
	}
	if err != nil {
		return 0, err
	}
	if tipo == "dupla" {
		if eu != duplaA.Int64 && eu != dupB.Int64 {
			return 0, ErrNaoEncontrado
		}
		return 0, nil
	}
	if !entrou.Valid || saiu.Valid {
		return 0, ErrNaoEncontrado
	}
	return entrou.Int64, nil
}

// EnviarTexto grava uma mensagem de texto de eu na conversa. Se eu já enviou uma mensagem com
// esse idLocal, devolve essa mesma, com nova falsa, sem gravar outra. Quem não está na
// conversa dá ErrNaoEncontrado. O texto já vem conferido (regras.Texto).
func (b *Banco) EnviarTexto(ctx context.Context, eu, conversaID int64, idLocal, texto string) (m Mensagem, nova bool, err error) {
	return b.enviar(ctx, eu, conversaID, idLocal, texto, "")
}

// EnviarArquivo grava uma mensagem de arquivo de eu na conversa, com as mesmas regras do
// idLocal do EnviarTexto. O arquivo tem de ter sido enviado por eu, na empresa dele, não pode
// ter expirado nem estar em outra mensagem: se não, dá ErrInvalido. Um idLocal repetido
// devolve a mensagem de antes, sem conferir o arquivo de novo.
func (b *Banco) EnviarArquivo(ctx context.Context, eu, conversaID int64, idLocal, arquivoID string) (Mensagem, bool, error) {
	if arquivoID == "" {
		return Mensagem{}, false, ErrInvalido
	}
	return b.enviar(ctx, eu, conversaID, idLocal, "", arquivoID)
}

// enviar grava uma mensagem de texto (arquivoID vazio) ou de arquivo, numa transação só: a
// busca do idLocal, a gravação e o atualizada_em da conversa. A transação é a única que
// escreve por vez, então dois envios com o mesmo idLocal nunca gravam duas mensagens.
func (b *Banco) enviar(ctx context.Context, eu, conversaID int64, idLocal, texto, arquivoID string) (m Mensagem, nova bool, err error) {
	agora := b.agoraMs()
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := desdeDe(ctx, tx, eu, conversaID); err != nil {
			return err
		}
		var existente int64
		err := tx.QueryRowContext(ctx, `SELECT id FROM mensagens WHERE autor_id = ? AND id_local = ?`, eu, idLocal).Scan(&existente)
		if err == nil {
			m, err = mensagemPorID(ctx, tx, existente)
			nova = false
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		tipo := "texto"
		var arq sql.NullString
		if arquivoID != "" {
			tipo, arq = "arquivo", sql.NullString{String: arquivoID, Valid: true}
			if err := conferirArquivo(ctx, tx, eu, arquivoID); err != nil {
				return err
			}
		}
		var txt sql.NullString
		if tipo == "texto" {
			txt = sql.NullString{String: texto, Valid: true}
		}
		r, err := tx.ExecContext(ctx,
			`INSERT INTO mensagens (conversa_id, autor_id, tipo, texto, arquivo_id, id_local, criada_em)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`, conversaID, eu, tipo, txt, arq, idLocal, agora)
		if err != nil {
			return err
		}
		id, err := r.LastInsertId()
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE conversas SET atualizada_em = MAX(atualizada_em, ?) WHERE id = ?`, agora, conversaID); err != nil {
			return err
		}
		m, err = mensagemPorID(ctx, tx, id)
		nova = true
		return err
	})
	if err != nil {
		return Mensagem{}, false, err
	}
	return m, nova, nil
}

// conferirArquivo vê se eu pode pôr o arquivo numa mensagem: foi ele que enviou, o arquivo
// ainda não expirou e não está em outra mensagem. Se não, dá ErrInvalido.
func conferirArquivo(ctx context.Context, tx *sql.Tx, eu int64, arquivoID string) error {
	var expirado sql.NullInt64
	err := tx.QueryRowContext(ctx,
		`SELECT a.expirado_em FROM arquivos a
		   JOIN pessoas p ON p.id = ? AND p.empresa_id = a.empresa_id
		  WHERE a.id = ? AND a.autor_id = p.id`, eu, arquivoID).Scan(&expirado)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalido
	}
	if err != nil {
		return err
	}
	if expirado.Valid {
		return ErrInvalido
	}
	var usos int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM mensagens WHERE arquivo_id = ?`, arquivoID).Scan(&usos); err != nil {
		return err
	}
	if usos > 0 {
		return ErrInvalido
	}
	return nil
}

// Mensagens lê uma página da conversa, da mais antiga para a mais nova, só do que eu pode ver
// (a partir da última entrada dele). Sem antes nem depois vêm as mais novas; com antes, as
// anteriores a essa mensagem; com depois, as seguintes. temMais diz se há mais além da
// página, no sentido pedido. O limite vai de 1 a MaxPagina, e antes com depois juntos dá
// ErrInvalido, como o limite fora da faixa. Quem não está na conversa dá ErrNaoEncontrado.
func (b *Banco) Mensagens(ctx context.Context, eu, conversaID int64, antes, depois int64, limite int) ([]Mensagem, bool, error) {
	if limite < 1 || limite > MaxPagina || (antes > 0 && depois > 0) {
		return nil, false, ErrInvalido
	}
	desde, err := desdeDe(ctx, b.db, eu, conversaID)
	if err != nil {
		return nil, false, err
	}
	var q strings.Builder
	q.WriteString(`SELECT ` + colunasMensagem + ` ` + juncoesMensagem + ` WHERE m.conversa_id = ? AND m.criada_em >= ?`)
	args := []any{conversaID, desde}
	novas := depois > 0 // lê para frente; senão, para trás a partir do fim ou do antes
	switch {
	case depois > 0:
		q.WriteString(` AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
		args = append(args, depois, limite+1)
	case antes > 0:
		q.WriteString(` AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
		args = append(args, antes, limite+1)
	default:
		q.WriteString(` ORDER BY m.id DESC LIMIT ?`)
		args = append(args, limite+1)
	}
	linhas, err := b.db.QueryContext(ctx, q.String(), args...)
	if err != nil {
		return nil, false, err
	}
	defer linhas.Close()
	lista := make([]Mensagem, 0, limite+1)
	for linhas.Next() {
		m, err := lerMensagem(linhas)
		if err != nil {
			return nil, false, err
		}
		lista = append(lista, m)
	}
	if err := linhas.Err(); err != nil {
		return nil, false, err
	}
	temMais := len(lista) > limite
	if temMais {
		lista = lista[:limite]
	}
	if !novas { // veio da mais nova para a mais antiga
		for i, j := 0, len(lista)-1; i < j; i, j = i+1, j-1 {
			lista[i], lista[j] = lista[j], lista[i]
		}
	}
	return lista, temMais, nil
}

// MarcarLida diz que eu leu a conversa até a mensagem ate. A leitura só avança: avancou diz se
// ela andou. Veja MarcarLidaAte.
func (b *Banco) MarcarLida(ctx context.Context, eu, conversaID, ate int64) (avancou bool, err error) {
	_, avancou, err = b.MarcarLidaAte(ctx, eu, conversaID, ate)
	return avancou, err
}

// MarcarLidaAte é o MarcarLida que também devolve até onde a leitura ficou. Um ate que passa
// da última mensagem que eu vê vale só até ela: as mensagens que chegarem depois não nascem
// lidas. Quem não está na conversa dá ErrNaoEncontrado.
func (b *Banco) MarcarLidaAte(ctx context.Context, eu, conversaID, ate int64) (lido int64, avancou bool, err error) {
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		desde, err := desdeDe(ctx, tx, eu, conversaID)
		if err != nil {
			return err
		}
		var ultima int64
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(MAX(id), 0) FROM mensagens WHERE conversa_id = ? AND criada_em >= ?`,
			conversaID, desde).Scan(&ultima); err != nil {
			return err
		}
		ate = min(ate, ultima)
		var antes int64
		err = tx.QueryRowContext(ctx, `SELECT ate FROM leituras WHERE pessoa_id = ? AND conversa_id = ?`,
			eu, conversaID).Scan(&antes)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if ate <= antes {
			lido = antes
			return nil
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leituras (pessoa_id, conversa_id, ate) VALUES (?, ?, ?)
			 ON CONFLICT (pessoa_id, conversa_id) DO UPDATE SET ate = excluded.ate WHERE excluded.ate > leituras.ate`,
			eu, conversaID, ate); err != nil {
			return err
		}
		lido, avancou = ate, true
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	return lido, avancou, nil
}
