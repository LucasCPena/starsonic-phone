package banco

import (
	"context"
	"database/sql"
	"errors"
	"sort"
)

// MaxGrupo é o limite de pessoas ativas num grupo, com quem cuida (seção 8 do protocolo).
const MaxGrupo = 200

// ErrInvalido é um pedido fora da regra que o banco confere: uma conversa a dois com a
// própria pessoa, ou com uma que saiu do chat.
var ErrInvalido = errors.New("banco: pedido inválido")

// Arquivo é o arquivo de uma mensagem (seção 4 do protocolo).
type Arquivo struct {
	ID, Nome, Tipo string
	Tamanho        int64
	Foto           bool
	Miniatura      bool
	Expirado       bool
}

// Mensagem é uma mensagem da conversa. O Autor é nil se o banco não tem autor; o AvisoAlvo
// só vem no aviso pos e tirou; o Arquivo só no tipo arquivo.
type Mensagem struct {
	ID, ConversaID int64
	Autor          *Pessoa
	Tipo           string // "texto", "arquivo" ou "aviso"
	Texto          string
	Arquivo        *Arquivo
	AvisoAcao      string // "criou", "pos", "tirou" ou "saiu"
	AvisoAlvo      *Pessoa
	IDLocal        string // vazio se a mensagem não tem
	CriadaEm       int64
}

// ResumoConversa é a Conversa da seção 4 do protocolo, do ponto de vista de uma pessoa.
type ResumoConversa struct {
	ID           int64
	Tipo         string  // "dupla" ou "grupo"
	Com          *Pessoa // só na dupla: a outra pessoa
	Nome         string  // só no grupo
	Pessoas      int     // só no grupo: as pessoas ativas
	Cuida        bool    // só no grupo: se a pessoa cuida
	Ultima       *Mensagem
	NaoLidas     int
	AtualizadaEm int64
}

// Membro é uma pessoa ativa de um grupo.
type Membro struct {
	Pessoa       Pessoa
	Cuida, Criou bool
}

// linhaUnica é o que o *sql.DB e o *sql.Tx têm em comum para ler uma linha.
type linhaUnica interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// unicos tira os repetidos de ids (fica a primeira vez) e o valor excetuado.
func unicos(ids []int64, exceto int64) []int64 {
	visto := make(map[int64]bool, len(ids))
	var lista []int64
	for _, id := range ids {
		if id == exceto || visto[id] {
			continue
		}
		visto[id] = true
		lista = append(lista, id)
	}
	return lista
}

// pessoaDaEmpresa acha a pessoa da empresa, também a que saiu. Outra empresa dá ErrNaoEncontrado.
func pessoaDaEmpresa(ctx context.Context, l linhaUnica, empresaID, id int64) (Pessoa, error) {
	p := Pessoa{EmpresaID: empresaID}
	var saiu sql.NullInt64
	err := l.QueryRowContext(ctx,
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

// avisar grava um aviso da conversa. alvo 0 é "sem alvo".
func avisar(ctx context.Context, tx *sql.Tx, conversaID, quem int64, acao string, alvo int64, agora int64) (int64, error) {
	a := sql.NullInt64{Int64: alvo, Valid: alvo != 0}
	r, err := tx.ExecContext(ctx,
		`INSERT INTO mensagens (conversa_id, autor_id, tipo, aviso_acao, aviso_alvo_id, criada_em)
		 VALUES (?, ?, 'aviso', ?, ?, ?)`, conversaID, quem, acao, a, agora)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE conversas SET atualizada_em = MAX(atualizada_em, ?) WHERE id = ?`, agora, conversaID); err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

// CriarDupla acha ou cria a conversa a dois de eu com com, que é uma só por par (guardada
// com dupla_a < dupla_b). nova diz se acabou de ser criada. Com a própria pessoa, ou com
// uma que saiu do chat, dá ErrInvalido; com uma pessoa que não é da empresa, ErrNaoEncontrado.
func (b *Banco) CriarDupla(ctx context.Context, empresaID, eu, com int64) (conversaID int64, nova bool, err error) {
	if eu == com {
		return 0, false, ErrInvalido
	}
	agora := b.agoraMs()
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := pessoaDaEmpresa(ctx, tx, empresaID, eu); err != nil {
			return err
		}
		outra, err := pessoaDaEmpresa(ctx, tx, empresaID, com)
		if err != nil {
			return err
		}
		if outra.Saiu {
			return ErrInvalido
		}
		a, bb := min(eu, com), max(eu, com)
		err = tx.QueryRowContext(ctx,
			`SELECT id FROM conversas WHERE empresa_id = ? AND tipo = 'dupla' AND dupla_a = ? AND dupla_b = ?`,
			empresaID, a, bb).Scan(&conversaID)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		r, err := tx.ExecContext(ctx,
			`INSERT INTO conversas (empresa_id, tipo, criou_id, dupla_a, dupla_b, criada_em, atualizada_em)
			 VALUES (?, 'dupla', ?, ?, ?, ?, ?)`, empresaID, eu, a, bb, agora, agora)
		if err != nil {
			return err
		}
		conversaID, err = r.LastInsertId()
		nova = true
		return err
	})
	if err != nil {
		return 0, false, err
	}
	return conversaID, nova, nil
}

// CriarGrupo cria o grupo: eu cuida dele e entra, junto com as pessoas (repetidos, e o
// próprio eu na lista, valem uma vez). A conversa ganha o aviso criou e um pos por pessoa,
// nessa ordem. Mais de 200 pessoas no total dá ErrGrupoCheio; um id que não é de uma
// pessoa ativa da empresa dá ErrNaoEncontrado, sem criar nada. Sem nenhuma outra pessoa na
// lista dá ErrInvalido. Devolve também os ids dos avisos criados, na ordem (criou, e um pos
// por pessoa).
func (b *Banco) CriarGrupo(ctx context.Context, empresaID, eu int64, nome string, pessoas []int64) (id int64, avisos []int64, err error) {
	outras := unicos(pessoas, eu)
	if len(outras) == 0 {
		return 0, nil, ErrInvalido
	}
	if len(outras)+1 > MaxGrupo {
		return 0, nil, ErrGrupoCheio
	}
	agora := b.agoraMs()
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := pessoaDaEmpresa(ctx, tx, empresaID, eu); err != nil {
			return err
		}
		for _, o := range outras {
			p, err := pessoaDaEmpresa(ctx, tx, empresaID, o)
			if err != nil {
				return err
			}
			if p.Saiu {
				return ErrNaoEncontrado
			}
		}
		r, err := tx.ExecContext(ctx,
			`INSERT INTO conversas (empresa_id, tipo, nome, cuida_id, criou_id, criada_em, atualizada_em)
			 VALUES (?, 'grupo', ?, ?, ?, ?, ?)`, empresaID, nome, eu, eu, agora, agora)
		if err != nil {
			return err
		}
		if id, err = r.LastInsertId(); err != nil {
			return err
		}
		for _, m := range append([]int64{eu}, outras...) {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO membros (conversa_id, pessoa_id, entrou_em) VALUES (?, ?, ?)`, id, m, agora); err != nil {
				return err
			}
		}
		a, err := avisar(ctx, tx, id, eu, "criou", 0, agora)
		if err != nil {
			return err
		}
		avisos = append(avisos, a)
		for _, o := range outras {
			if a, err = avisar(ctx, tx, id, eu, "pos", o, agora); err != nil {
				return err
			}
			avisos = append(avisos, a)
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	return id, avisos, nil
}

// grupoDe confere que a conversa é um grupo da empresa de eu em que eu é membro ativo, e
// devolve quem cuida (0 se ninguém) e a empresa. Se não, dá ErrNaoEncontrado.
func grupoDe(ctx context.Context, tx *sql.Tx, eu, conversaID int64) (cuida, empresaID int64, err error) {
	var c sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT c.empresa_id, c.cuida_id FROM conversas c
		   JOIN pessoas p ON p.id = ? AND p.empresa_id = c.empresa_id
		   JOIN membros m ON m.conversa_id = c.id AND m.pessoa_id = p.id AND m.saiu_em IS NULL
		  WHERE c.id = ? AND c.tipo = 'grupo'`, eu, conversaID).Scan(&empresaID, &c)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, ErrNaoEncontrado
	}
	return c.Int64, empresaID, err
}

// PorNoGrupo põe as pessoas no grupo, a pedido de eu, que tem de cuidar dele (ErrProibido).
// Quem já está é ignorada; quem saiu antes volta com uma entrada nova. Devolve os ids dos
// avisos pos criados. Uma pessoa que não é ativa na empresa dá ErrNaoEncontrado, e passar
// de 200 dá ErrGrupoCheio, sem mudar nada. Uma conversa que não é um grupo de eu dá
// ErrNaoEncontrado.
func (b *Banco) PorNoGrupo(ctx context.Context, eu, conversaID int64, pessoas []int64) ([]int64, error) {
	ids := unicos(pessoas, 0)
	if len(ids) > MaxGrupo { // nem se todas fossem membras o grupo cabia mais
		return nil, ErrGrupoCheio
	}
	agora := b.agoraMs()
	var avisos []int64
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		cuida, empresaID, err := grupoDe(ctx, tx, eu, conversaID)
		if err != nil {
			return err
		}
		if cuida != eu {
			return ErrProibido
		}
		var novos []int64
		for _, id := range ids {
			p, err := pessoaDaEmpresa(ctx, tx, empresaID, id)
			if err != nil {
				return err
			}
			if p.Saiu {
				return ErrNaoEncontrado
			}
			var ativo int
			if err := tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM membros WHERE conversa_id = ? AND pessoa_id = ? AND saiu_em IS NULL`,
				conversaID, id).Scan(&ativo); err != nil {
				return err
			}
			if ativo == 0 {
				novos = append(novos, id)
			}
		}
		var total int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM membros WHERE conversa_id = ? AND saiu_em IS NULL`, conversaID).Scan(&total); err != nil {
			return err
		}
		if total+len(novos) > MaxGrupo {
			return ErrGrupoCheio
		}
		for _, id := range novos {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO membros (conversa_id, pessoa_id, entrou_em) VALUES (?, ?, ?)
				 ON CONFLICT (conversa_id, pessoa_id) DO UPDATE SET entrou_em = excluded.entrou_em, saiu_em = NULL`,
				conversaID, id, agora); err != nil {
				return err
			}
			a, err := avisar(ctx, tx, conversaID, eu, "pos", id, agora)
			if err != nil {
				return err
			}
			avisos = append(avisos, a)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return avisos, nil
}

// TirarMembro tira a pessoa alvo do grupo, a pedido de eu: outra pessoa (só quem cuida,
// ErrProibido) ou ele mesmo (alvo igual a eu, o aviso saiu). Devolve o id do aviso criado,
// numa lista. Se quem cuida sai, o cuidado passa como diz o sairDoGrupo. Quem não está no
// grupo, ou um alvo que não está, dá ErrNaoEncontrado.
func (b *Banco) TirarMembro(ctx context.Context, eu, conversaID, alvo int64) ([]int64, error) {
	agora := b.agoraMs()
	var avisos []int64
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		cuida, _, err := grupoDe(ctx, tx, eu, conversaID)
		if err != nil {
			return err
		}
		if alvo != eu && cuida != eu {
			return ErrProibido
		}
		a, err := sairDoGrupo(ctx, tx, conversaID, cuida, eu, alvo, agora)
		if err != nil {
			return err
		}
		avisos = append(avisos, a)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return avisos, nil
}

// sairDoGrupo marca a saída de alvo do grupo e grava o aviso de quem: saiu, se quem é o
// próprio alvo, ou tirou, com o alvo. Se alvo cuidava (cuida é quem cuida agora), passa a
// cuidar o membro ativo com a entrada mais antiga (no empate, o de menor id); sem ninguém, o
// grupo fica sem quem cuide. Devolve o id do aviso. Se alvo não é membro ativo, dá
// ErrNaoEncontrado. É a saída do grupo do TirarMembro e do TirarPessoa, dentro da Tx deles.
func sairDoGrupo(ctx context.Context, tx *sql.Tx, conversaID, cuida, quem, alvo, agora int64) (int64, error) {
	acao, alvoAviso := "saiu", int64(0)
	if alvo != quem {
		acao, alvoAviso = "tirou", alvo
	}
	r, err := tx.ExecContext(ctx,
		`UPDATE membros SET saiu_em = ? WHERE conversa_id = ? AND pessoa_id = ? AND saiu_em IS NULL`,
		agora, conversaID, alvo)
	if err != nil {
		return 0, err
	}
	if n, err := r.RowsAffected(); err != nil {
		return 0, err
	} else if n == 0 {
		return 0, ErrNaoEncontrado
	}
	a, err := avisar(ctx, tx, conversaID, quem, acao, alvoAviso, agora)
	if err != nil {
		return 0, err
	}
	if cuida != alvo {
		return a, nil
	}
	var novo sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT pessoa_id FROM membros WHERE conversa_id = ? AND saiu_em IS NULL
		  ORDER BY entrou_em, pessoa_id LIMIT 1`, conversaID).Scan(&novo)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversas SET cuida_id = ? WHERE id = ?`, novo, conversaID); err != nil {
		return 0, err
	}
	return a, nil
}

// grupoAtivo é um grupo em que a pessoa está, com quem cuida dele (0 se ninguém).
type grupoAtivo struct{ id, cuida int64 }

// gruposDaPessoa são os grupos em que a pessoa é membro ativo, em ordem de id.
func gruposDaPessoa(ctx context.Context, tx *sql.Tx, pessoaID int64) ([]grupoAtivo, error) {
	linhas, err := tx.QueryContext(ctx,
		`SELECT c.id, c.cuida_id FROM membros m JOIN conversas c ON c.id = m.conversa_id
		  WHERE m.pessoa_id = ? AND m.saiu_em IS NULL AND c.tipo = 'grupo'
		  ORDER BY c.id`, pessoaID)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	var lista []grupoAtivo
	for linhas.Next() {
		var g grupoAtivo
		var cuida sql.NullInt64
		if err := linhas.Scan(&g.id, &cuida); err != nil {
			return nil, err
		}
		g.cuida = cuida.Int64
		lista = append(lista, g)
	}
	return lista, linhas.Err()
}

// PessoasDaConversa são os membros ativos do grupo, ou as duas pessoas da dupla, em ordem
// de id. Uma conversa que não existe dá ErrNaoEncontrado.
func (b *Banco) PessoasDaConversa(ctx context.Context, conversaID int64) ([]int64, error) {
	var tipo string
	var a, bb sql.NullInt64
	err := b.db.QueryRowContext(ctx, `SELECT tipo, dupla_a, dupla_b FROM conversas WHERE id = ?`, conversaID).
		Scan(&tipo, &a, &bb)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNaoEncontrado
	}
	if err != nil {
		return nil, err
	}
	if tipo == "dupla" {
		return []int64{a.Int64, bb.Int64}, nil
	}
	ids, err := lerIDs(ctx, b.db,
		`SELECT pessoa_id FROM membros WHERE conversa_id = ? AND saiu_em IS NULL ORDER BY pessoa_id`, conversaID)
	if ids == nil {
		ids = []int64{}
	}
	return ids, err
}

// Membros são as pessoas ativas do grupo: quem cuida primeiro, e o resto na ordem do nome
// sem acento e sem caixa. Numa dupla, ou numa conversa que não existe, a lista vem vazia.
func (b *Banco) Membros(ctx context.Context, conversaID int64) ([]Membro, error) {
	linhas, err := b.db.QueryContext(ctx,
		`SELECT p.id, p.empresa_id, p.ramal, p.nome, p.saiu_em,
		        COALESCE(p.id = c.cuida_id, 0), COALESCE(p.id = c.criou_id, 0)
		   FROM membros m
		   JOIN conversas c ON c.id = m.conversa_id
		   JOIN pessoas p ON p.id = m.pessoa_id
		  WHERE m.conversa_id = ? AND m.saiu_em IS NULL
		  ORDER BY COALESCE(p.id = c.cuida_id, 0) DESC, p.nome_busca, p.id`, conversaID)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	lista := []Membro{}
	for linhas.Next() {
		var m Membro
		var saiu sql.NullInt64
		if err := linhas.Scan(&m.Pessoa.ID, &m.Pessoa.EmpresaID, &m.Pessoa.Ramal, &m.Pessoa.Nome, &saiu,
			&m.Cuida, &m.Criou); err != nil {
			return nil, err
		}
		m.Pessoa.Saiu = saiu.Valid
		lista = append(lista, m)
	}
	return lista, linhas.Err()
}

// Conversas são as conversas a dois da pessoa e os grupos em que ela está, com a mais
// nova (pelo AtualizadaEm, no empate o maior id) primeiro. Sem nenhuma, a lista vem vazia.
func (b *Banco) Conversas(ctx context.Context, pessoaID int64) ([]ResumoConversa, error) {
	return b.resumos(ctx, pessoaID, 0, 0)
}

// Conversa é a conversa do ponto de vista da pessoa. Se a empresa é outra, a conversa não
// existe ou a pessoa não está nela (saiu do grupo, por exemplo), dá ErrNaoEncontrado.
func (b *Banco) Conversa(ctx context.Context, empresaID, pessoaID, conversaID int64) (ResumoConversa, error) {
	if conversaID <= 0 || empresaID <= 0 {
		return ResumoConversa{}, ErrNaoEncontrado
	}
	l, err := b.resumos(ctx, pessoaID, empresaID, conversaID)
	if err != nil {
		return ResumoConversa{}, err
	}
	if len(l) == 0 {
		return ResumoConversa{}, ErrNaoEncontrado
	}
	return l[0], nil
}

// resumos monta as Conversas da pessoa. empresaID e conversaID 0 não filtram. A pessoa só
// vê as mensagens a partir da última entrada dela no grupo.
func (b *Banco) resumos(ctx context.Context, pessoaID, empresaID, conversaID int64) ([]ResumoConversa, error) {
	type base struct {
		ResumoConversa
		cuidaID, duplaA, duplaB sql.NullInt64
		empresaID               int64
		criadaEm, desde         int64
	}
	linhas, err := b.db.QueryContext(ctx,
		`SELECT c.id, c.tipo, COALESCE(c.nome, ''), c.cuida_id, c.dupla_a, c.dupla_b, c.empresa_id, c.criada_em,
		        CASE WHEN c.tipo = 'grupo' THEN m.entrou_em ELSE 0 END
		   FROM conversas c
		   JOIN pessoas p ON p.id = ?1 AND p.empresa_id = c.empresa_id
		   LEFT JOIN membros m ON m.conversa_id = c.id AND m.pessoa_id = p.id
		  WHERE (?2 = 0 OR c.empresa_id = ?2) AND (?3 = 0 OR c.id = ?3)
		    AND ((c.tipo = 'dupla' AND p.id IN (c.dupla_a, c.dupla_b))
		      OR (c.tipo = 'grupo' AND m.pessoa_id IS NOT NULL AND m.saiu_em IS NULL))`,
		pessoaID, empresaID, conversaID)
	if err != nil {
		return nil, err
	}
	var bases []base
	for linhas.Next() {
		var x base
		if err := linhas.Scan(&x.ID, &x.Tipo, &x.Nome, &x.cuidaID, &x.duplaA, &x.duplaB, &x.empresaID, &x.criadaEm, &x.desde); err != nil {
			linhas.Close()
			return nil, err
		}
		bases = append(bases, x)
	}
	err = linhas.Err()
	linhas.Close() // com uma só conexão, as consultas abaixo esperam esta terminar
	if err != nil {
		return nil, err
	}

	lista := make([]ResumoConversa, 0, len(bases))
	for _, x := range bases {
		rc := x.ResumoConversa
		if rc.Tipo == "grupo" {
			rc.Cuida = x.cuidaID.Valid && x.cuidaID.Int64 == pessoaID
			if err := b.db.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM membros WHERE conversa_id = ? AND saiu_em IS NULL`, rc.ID).Scan(&rc.Pessoas); err != nil {
				return nil, err
			}
		} else {
			outra := x.duplaA.Int64
			if outra == pessoaID {
				outra = x.duplaB.Int64
			}
			p, err := pessoaDaEmpresa(ctx, b.db, x.empresaID, outra)
			if err != nil {
				return nil, err
			}
			rc.Com = &p
		}
		if rc.Ultima, err = ultimaMensagem(ctx, b.db, rc.ID, x.desde); err != nil {
			return nil, err
		}
		rc.AtualizadaEm = x.criadaEm
		if rc.Ultima != nil {
			rc.AtualizadaEm = rc.Ultima.CriadaEm
		}
		if err := b.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM mensagens
			  WHERE conversa_id = ?1 AND tipo <> 'aviso' AND (autor_id IS NULL OR autor_id <> ?2) AND criada_em >= ?3
			    AND id > COALESCE((SELECT ate FROM leituras WHERE pessoa_id = ?2 AND conversa_id = ?1), 0)`,
			rc.ID, pessoaID, x.desde).Scan(&rc.NaoLidas); err != nil {
			return nil, err
		}
		lista = append(lista, rc)
	}
	sort.SliceStable(lista, func(i, j int) bool {
		if lista[i].AtualizadaEm != lista[j].AtualizadaEm {
			return lista[i].AtualizadaEm > lista[j].AtualizadaEm
		}
		return lista[i].ID > lista[j].ID
	})
	return lista, nil
}

// ultimaMensagem é a mensagem mais nova da conversa desde a hora dada (criada_em >=
// desde), ou nil se não há nenhuma.
func ultimaMensagem(ctx context.Context, l linhaUnica, conversaID, desde int64) (*Mensagem, error) {
	m, err := lerMensagem(l.QueryRowContext(ctx,
		`SELECT `+colunasMensagem+` `+juncoesMensagem+`
		  WHERE m.conversa_id = ? AND m.criada_em >= ?
		  ORDER BY m.id DESC LIMIT 1`, conversaID, desde))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}
