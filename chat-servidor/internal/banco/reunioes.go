package banco

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// Os tipos de reunião.
const (
	TipoMarcada = "marcada" // criada no app, para um dia; vale até o valeAte
	TipoNaHora  = "naHora"  // o "Gerar link" de uma chamada; vale até acabar
	TipoTeste   = "teste"   // a da administração, sem empresa; vale até o valeAte
)

// maxMarcadas é o máximo de reuniões marcadas que ainda valem por pessoa.
const maxMarcadas = 100

// maxNaHora é o máximo de reuniões na hora abertas (as que não acabaram nem foram canceladas) por pessoa.
const maxNaHora = 10

// tentativasCodigo é quantas vezes CriarReuniao sorteia de novo se o código ou a sala já existem.
const tentativasCodigo = 20

// ErrMuitasReunioes: a pessoa já tem 100 reuniões marcadas que ainda valem, ou 10 na hora abertas.
var ErrMuitasReunioes = errors.New("banco: a pessoa já tem reuniões demais")

// Os sorteios do código e da sala. São variáveis só para o teste forçar uma repetição.
var (
	sorteiaCodigo = segredo.NovoCodigoReuniao
	sorteiaSala   = func() string { return segredo.NovoHex(16) }
)

// Reuniao é uma reunião com link. O 0 e o "" são o vazio do banco (o NULL): EmpresaID 0 é a de
// teste, Inicio e ValeAte 0 são os que a naHora não tem, e assim por diante.
type Reuniao struct {
	ID, EmpresaID                   int64
	Codigo, Sala, Tipo, Assunto     string
	Inicio, ValeAte, CriouID        int64
	CriadaEm, CanceladaEm, AcabouEm int64
}

// Vale diz se o link da reunião vale em agoraMs: ela não foi cancelada e, na marcada e na de
// teste, o valeAte ainda não chegou; na naHora, ela ainda não acabou. (Quem já está numa reunião
// que passou do valeAte continua nela: isso é do gerente, não do banco.)
func (r Reuniao) Vale(agoraMs int64) bool {
	if r.CanceladaEm != 0 {
		return false
	}
	if r.Tipo == TipoNaHora {
		return r.AcabouEm == 0
	}
	return agoraMs < r.ValeAte
}

const colunasReuniao = `id, empresa_id, codigo, sala, tipo, assunto, inicio, vale_ate, criou_id, criada_em, cancelada_em, acabou_em`

type varredor interface{ Scan(dest ...any) error }

func lerReuniao(l varredor) (Reuniao, error) {
	var r Reuniao
	var empresa, inicio, valeAte, criou, cancelada, acabou sql.NullInt64
	var assunto sql.NullString
	if err := l.Scan(&r.ID, &empresa, &r.Codigo, &r.Sala, &r.Tipo, &assunto, &inicio, &valeAte, &criou,
		&r.CriadaEm, &cancelada, &acabou); err != nil {
		return Reuniao{}, err
	}
	r.EmpresaID, r.Assunto, r.Inicio, r.ValeAte = empresa.Int64, assunto.String, inicio.Int64, valeAte.Int64
	r.CriouID, r.CanceladaEm, r.AcabouEm = criou.Int64, cancelada.Int64, acabou.Int64
	return r, nil
}

// nulo guarda o vazio (0 ou "") como NULL.
func nulo[T int64 | string](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

// inserirReuniao grava r (já com a hora de criação) com um código e uma sala que nenhuma outra
// reunião usa. Vai dentro de uma transação, que segura a escrita: ninguém pega o mesmo código no
// meio. Sorteia de novo (até 20 vezes) se o código ou a sala já existem.
func inserirReuniao(ctx context.Context, tx *sql.Tx, r Reuniao) (Reuniao, error) {
	for i := 0; i < tentativasCodigo; i++ {
		r.Codigo, r.Sala = sorteiaCodigo(), sorteiaSala()
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM reunioes WHERE codigo = ? OR sala = ?`,
			r.Codigo, r.Sala).Scan(&n); err != nil {
			return Reuniao{}, err
		}
		if n > 0 {
			continue
		}
		res, err := tx.ExecContext(ctx,
			`INSERT INTO reunioes (empresa_id, codigo, sala, tipo, assunto, inicio, vale_ate, criou_id, criada_em)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			nulo(r.EmpresaID), r.Codigo, r.Sala, r.Tipo, nulo(r.Assunto), nulo(r.Inicio), nulo(r.ValeAte),
			nulo(r.CriouID), r.CriadaEm)
		if err != nil {
			return Reuniao{}, err
		}
		r.ID, err = res.LastInsertId()
		return r, err
	}
	return Reuniao{}, errors.New("banco: não achei um código livre para a reunião")
}

// CriarReuniao guarda a reunião, que ganha o Codigo, a Sala e a hora de criação (as que vêm em r
// são ignoradas). Na marcada, a pessoa (r.CriouID) pode ter até 100 que ainda valem, e na naHora,
// até 10 abertas: a 101ª (ou a 11ª) dá ErrMuitasReunioes e nada é guardado. A conferência e a
// gravação vão na mesma transação.
func (b *Banco) CriarReuniao(ctx context.Context, r Reuniao) (Reuniao, error) {
	r.CriadaEm, r.CanceladaEm, r.AcabouEm = b.agoraMs(), 0, 0
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		var n, maximo int
		var err error
		switch r.Tipo {
		case TipoMarcada:
			maximo = maxMarcadas
			err = tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM reunioes
				  WHERE tipo = 'marcada' AND empresa_id = ? AND criou_id = ? AND cancelada_em IS NULL AND vale_ate > ?`,
				r.EmpresaID, r.CriouID, r.CriadaEm).Scan(&n)
		case TipoNaHora:
			maximo = maxNaHora
			err = tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM reunioes
				  WHERE tipo = 'naHora' AND empresa_id = ? AND criou_id = ? AND cancelada_em IS NULL AND acabou_em IS NULL`,
				r.EmpresaID, r.CriouID).Scan(&n)
		}
		if err != nil {
			return err
		}
		if maximo > 0 && n >= maximo {
			return ErrMuitasReunioes
		}
		r, err = inserirReuniao(ctx, tx, r)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrMuitasReunioes) {
			return Reuniao{}, err
		}
		return Reuniao{}, fmt.Errorf("banco: criar reunião: %w", err)
	}
	return r, nil
}

// ReuniaoPorCodigo acha a reunião pelo código (já normalizado), em qualquer estado: valendo,
// cancelada, vencida ou acabada. Quem chama confere o Vale. Sem ela, ErrNaoEncontrado.
func (b *Banco) ReuniaoPorCodigo(ctx context.Context, codigo string) (Reuniao, error) {
	r, err := lerReuniao(b.db.QueryRowContext(ctx, `SELECT `+colunasReuniao+` FROM reunioes WHERE codigo = ?`, codigo))
	if errors.Is(err, sql.ErrNoRows) {
		return Reuniao{}, ErrNaoEncontrado
	}
	return r, err
}

// ReuniaoPorID acha a reunião pelo id, em qualquer estado, como o ReuniaoPorCodigo: o canal da página guarda no
// bilhete o id da reunião. Sem ela, ErrNaoEncontrado.
func (b *Banco) ReuniaoPorID(ctx context.Context, id int64) (Reuniao, error) {
	r, err := lerReuniao(b.db.QueryRowContext(ctx, `SELECT `+colunasReuniao+` FROM reunioes WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Reuniao{}, ErrNaoEncontrado
	}
	return r, err
}

// listarReunioes roda a consulta e lê as reuniões dela. A lista nunca é nula.
func (b *Banco) listarReunioes(ctx context.Context, q string, args ...any) ([]Reuniao, error) {
	linhas, err := b.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	lista := []Reuniao{}
	for linhas.Next() {
		r, err := lerReuniao(linhas)
		if err != nil {
			return nil, err
		}
		lista = append(lista, r)
	}
	return lista, linhas.Err()
}

// ReunioesMarcadas são as reuniões marcadas da pessoa, na empresa, que ainda valem, da que
// começa mais cedo para a mais tarde (no empate, a mais antiga). As de outra empresa nunca vêm.
func (b *Banco) ReunioesMarcadas(ctx context.Context, empresaID, pessoaID int64) ([]Reuniao, error) {
	return b.listarReunioes(ctx,
		`SELECT `+colunasReuniao+` FROM reunioes
		  WHERE tipo = 'marcada' AND empresa_id = ? AND criou_id = ? AND cancelada_em IS NULL AND vale_ate > ?
		  ORDER BY inicio, id`, empresaID, pessoaID, b.agoraMs())
}

// CancelarReuniao cancela a reunião (o link para de valer) e a devolve. Um código de outra
// empresa, ou que não existe, dá ErrNaoEncontrado; se não foi a pessoa que criou, ErrProibido.
// Cancelar uma já cancelada não muda a hora do cancelamento.
func (b *Banco) CancelarReuniao(ctx context.Context, empresaID, pessoaID int64, codigo string) (Reuniao, error) {
	var r Reuniao
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		r, err = lerReuniao(tx.QueryRowContext(ctx,
			`SELECT `+colunasReuniao+` FROM reunioes WHERE codigo = ? AND empresa_id = ?`, codigo, empresaID))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNaoEncontrado
		}
		if err != nil {
			return err
		}
		if r.CriouID != pessoaID {
			return ErrProibido
		}
		if r.CanceladaEm != 0 {
			return nil
		}
		r.CanceladaEm = b.agoraMs()
		_, err = tx.ExecContext(ctx, `UPDATE reunioes SET cancelada_em = ? WHERE id = ?`, r.CanceladaEm, r.ID)
		return err
	})
	if err != nil {
		return Reuniao{}, err
	}
	return r, nil
}

// AcabarReuniao marca o fim de uma reunião naHora (o link para de valer). Acabar uma que já
// acabou não muda a hora. Um id que não é de uma naHora dá ErrNaoEncontrado.
func (b *Banco) AcabarReuniao(ctx context.Context, id int64) error {
	return b.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM reunioes WHERE id = ? AND tipo = 'naHora'`, id).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return ErrNaoEncontrado
		}
		_, err := tx.ExecContext(ctx, `UPDATE reunioes SET acabou_em = ? WHERE id = ? AND acabou_em IS NULL`, b.agoraMs(), id)
		return err
	})
}

// ReunioesDaEmpresa são as reuniões da empresa que podem estar acontecendo: as que não foram canceladas e, na naHora,
// não acabaram, da mais antiga para a mais nova. A marcada que passou do valeAte também vem: quem já está nela
// continua. A administração as lê antes de bloquear as reuniões da empresa ou de apagá-la (o apagar as leva junto),
// para o gerente encerrar as que estão acontecendo.
func (b *Banco) ReunioesDaEmpresa(ctx context.Context, empresaID int64) ([]Reuniao, error) {
	return b.listarReunioes(ctx,
		`SELECT `+colunasReuniao+` FROM reunioes
		  WHERE empresa_id = ? AND cancelada_em IS NULL AND acabou_em IS NULL ORDER BY id`, empresaID)
}

// ReunioesNaHoraAbertas são as reuniões naHora que não acabaram nem foram canceladas, da mais
// antiga para a mais nova. O gerente as lê ao começar, para acabar as que ficaram abertas.
func (b *Banco) ReunioesNaHoraAbertas(ctx context.Context) ([]Reuniao, error) {
	return b.listarReunioes(ctx,
		`SELECT `+colunasReuniao+` FROM reunioes
		  WHERE tipo = 'naHora' AND acabou_em IS NULL AND cancelada_em IS NULL ORDER BY id`)
}

// CriarReuniaoDeTeste cria a reunião de teste da administração (sem empresa, valendo até
// valeAte) e cancela as de teste anteriores que ainda valiam, tudo numa transação.
func (b *Banco) CriarReuniaoDeTeste(ctx context.Context, valeAte int64) (Reuniao, error) {
	agora := b.agoraMs()
	r := Reuniao{Tipo: TipoTeste, ValeAte: valeAte, CriadaEm: agora}
	err := b.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`UPDATE reunioes SET cancelada_em = ? WHERE tipo = 'teste' AND cancelada_em IS NULL AND vale_ate > ?`,
			agora, agora); err != nil {
			return err
		}
		var err error
		r, err = inserirReuniao(ctx, tx, r)
		return err
	})
	if err != nil {
		return Reuniao{}, fmt.Errorf("banco: criar reunião de teste: %w", err)
	}
	return r, nil
}

// ReuniaoDeTeste é a reunião de teste que vale agora, ou ErrNaoEncontrado.
func (b *Banco) ReuniaoDeTeste(ctx context.Context) (Reuniao, error) {
	r, err := lerReuniao(b.db.QueryRowContext(ctx,
		`SELECT `+colunasReuniao+` FROM reunioes
		  WHERE tipo = 'teste' AND cancelada_em IS NULL AND vale_ate > ? ORDER BY id DESC LIMIT 1`, b.agoraMs()))
	if errors.Is(err, sql.ErrNoRows) {
		return Reuniao{}, ErrNaoEncontrado
	}
	return r, err
}

// ApagarReunioesVelhas apaga as reuniões que acabaram antes de antesDe (em milissegundos): a
// cancelada, a marcada ou de teste com o valeAte, e a naHora com o acabou_em antes do limite.
// No limite exato, fica. Devolve quantas apagou.
func (b *Banco) ApagarReunioesVelhas(ctx context.Context, antesDe int64) (int, error) {
	r, err := b.db.ExecContext(ctx,
		`DELETE FROM reunioes
		  WHERE cancelada_em < ?1
		     OR (tipo IN ('marcada', 'teste') AND vale_ate < ?1)
		     OR (tipo = 'naHora' AND acabou_em < ?1)`, antesDe)
	if err != nil {
		return 0, err
	}
	n, err := r.RowsAffected()
	return int(n), err
}

// LiberarReunioes liga ou desliga as reuniões com link da empresa (o Empresa.Reunioes). Uma
// empresa que não existe dá ErrNaoEncontrado.
func (b *Banco) LiberarReunioes(ctx context.Context, empresaID int64, liberar bool) error {
	r, err := b.db.ExecContext(ctx, `UPDATE empresas SET reunioes = ? WHERE id = ?`, liberar, empresaID)
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNaoEncontrado
	}
	return nil
}
