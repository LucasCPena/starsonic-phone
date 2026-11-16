package banco

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

const (
	umDia = int64(24 * time.Hour / time.Millisecond)
	hora  = int64(time.Hour / time.Millisecond)
)

func agora(b *Banco) int64 { return b.agoraMs() }

func andar(b *Banco, d time.Duration) { b.Relogio().(*tempo.Teste).Avancar(d) }

// marcada cria uma reunião marcada da pessoa, que começa daqui a inicio ms e vale por mais 2 h.
func marcada(t *testing.T, b *Banco, empresaID, pessoaID, inicio int64) Reuniao {
	t.Helper()
	r, err := b.CriarReuniao(context.Background(), Reuniao{
		EmpresaID: empresaID, Tipo: TipoMarcada, Assunto: "Planejamento",
		Inicio: agora(b) + inicio, ValeAte: agora(b) + inicio + 2*hora, CriouID: pessoaID,
	})
	if err != nil {
		t.Fatalf("CriarReuniao: %v", err)
	}
	return r
}

func TestCriarReuniao(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")

	r := marcada(t, b, e.ID, ana.ID, hora)
	if r.ID == 0 || r.CriadaEm != inicioTeste || r.EmpresaID != e.ID || r.CriouID != ana.ID ||
		r.Tipo != TipoMarcada || r.Assunto != "Planejamento" || r.Inicio != inicioTeste+hora || r.ValeAte != inicioTeste+3*hora {
		t.Fatalf("reunião = %+v", r)
	}
	if !regexp.MustCompile(`^[abcdefghjkmnpqrstvwxyz23456789]{10}$`).MatchString(r.Codigo) {
		t.Fatalf("código = %q", r.Codigo)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(r.Sala) {
		t.Fatalf("sala = %q", r.Sala)
	}
	r2 := marcada(t, b, e.ID, ana.ID, 2*hora)
	if r2.Codigo == r.Codigo || r2.Sala == r.Sala {
		t.Fatalf("duas reuniões com o mesmo código ou sala: %+v e %+v", r, r2)
	}
	// O que foi guardado volta igual.
	got, err := b.ReuniaoPorCodigo(ctx, r.Codigo)
	if err != nil || got != r {
		t.Fatalf("ReuniaoPorCodigo = %+v, %v; queria %+v", got, err, r)
	}
	if _, err := b.ReuniaoPorCodigo(ctx, "aaaaaaaaaa"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("código que não existe: %v", err)
	}

	// A naHora não tem início nem validade, e o criador pode faltar.
	n, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: e.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	if err != nil || n.Tipo != TipoNaHora || n.Inicio != 0 || n.ValeAte != 0 || n.Assunto != "" {
		t.Fatalf("naHora = %+v, %v", n, err)
	}
	// O que o banco não aceita (as CHECKs da migração) dá erro.
	if _, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: e.ID, Tipo: TipoMarcada, CriouID: ana.ID}); err == nil {
		t.Fatal("marcada sem início nem validade devia dar erro")
	}
	if _, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: e.ID, Tipo: TipoTeste, ValeAte: 1}); err == nil {
		t.Fatal("teste com empresa devia dar erro")
	}
	if _, err := b.CriarReuniao(ctx, Reuniao{Tipo: "outra", ValeAte: 1}); err == nil {
		t.Fatal("tipo desconhecido devia dar erro")
	}
}

// TestCriarReuniao_RepeteCodigoESala: um código ou uma sala que já existe é sorteado de novo,
// e a reunião nova sai com valores livres.
func TestCriarReuniao_RepeteCodigoESala(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	velha := marcada(t, b, e.ID, ana.ID, hora)

	codigos := []string{velha.Codigo, velha.Codigo, "bbbbbbbbbb", "cccccccccc"}
	salas := []string{"0000000000000000aaaaaaaaaaaaaaaa", velha.Sala, velha.Sala, "1111111111111111bbbbbbbbbbbbbbbb"}
	i, j := 0, 0
	t.Cleanup(func(c, s func() string) func() { return func() { sorteiaCodigo, sorteiaSala = c, s } }(sorteiaCodigo, sorteiaSala))
	sorteiaCodigo = func() string { v := codigos[min(i, len(codigos)-1)]; i++; return v }
	sorteiaSala = func() string { v := salas[min(j, len(salas)-1)]; j++; return v }

	r := marcada(t, b, e.ID, ana.ID, 2*hora)
	// As três primeiras tentativas repetem o código ou a sala da velha; a quarta serve.
	if r.Codigo == velha.Codigo || r.Sala == velha.Sala {
		t.Fatalf("a nova repetiu o código ou a sala da velha: %+v", r)
	}
	if got, err := b.ReuniaoPorCodigo(ctx, r.Codigo); err != nil || got != r {
		t.Fatalf("a nova não foi guardada: %+v, %v", got, err)
	}

	// Se nada serve depois de várias tentativas, devolve erro e não guarda nada.
	sorteiaCodigo = func() string { return velha.Codigo }
	_, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: e.ID, Tipo: TipoNaHora})
	if err == nil {
		t.Fatal("sem um código livre devia dar erro")
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM reunioes`); n != 2 {
		t.Fatalf("há %d reuniões; queria 2", n)
	}
}

func TestReuniao_Vale(t *testing.T) {
	const ate = int64(10_000)
	casos := []struct {
		nome  string
		r     Reuniao
		agora int64
		quer  bool
	}{
		{"marcada 1 ms antes do valeAte", Reuniao{Tipo: TipoMarcada, ValeAte: ate}, ate - 1, true},
		{"marcada no valeAte", Reuniao{Tipo: TipoMarcada, ValeAte: ate}, ate, false},
		{"marcada depois do valeAte", Reuniao{Tipo: TipoMarcada, ValeAte: ate}, ate + 1, false},
		{"marcada cancelada", Reuniao{Tipo: TipoMarcada, ValeAte: ate, CanceladaEm: 5}, 6, false},
		{"naHora aberta", Reuniao{Tipo: TipoNaHora}, 1 << 40, true},
		{"naHora acabada", Reuniao{Tipo: TipoNaHora, AcabouEm: 5}, 6, false},
		{"naHora cancelada", Reuniao{Tipo: TipoNaHora, CanceladaEm: 5}, 6, false},
		{"teste 1 ms antes", Reuniao{Tipo: TipoTeste, ValeAte: ate}, ate - 1, true},
		{"teste no valeAte", Reuniao{Tipo: TipoTeste, ValeAte: ate}, ate, false},
		{"teste cancelada", Reuniao{Tipo: TipoTeste, ValeAte: ate, CanceladaEm: 5}, 6, false},
	}
	for _, c := range casos {
		if got := c.r.Vale(c.agora); got != c.quer {
			t.Errorf("%s: Vale(%d) = %v; queria %v", c.nome, c.agora, got, c.quer)
		}
	}
}

func TestReunioesMarcadas(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, acme.ID, "2004", "Bia Ramos")
	abel := pessoaDe(t, b, outra.ID, "2003", "Abel")

	tarde := marcada(t, b, acme.ID, ana.ID, 5*hora)
	cedo := marcada(t, b, acme.ID, ana.ID, hora)
	cancelada := marcada(t, b, acme.ID, ana.ID, 2*hora)
	if _, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, cancelada.Codigo); err != nil {
		t.Fatal(err)
	}
	marcada(t, b, acme.ID, ana.ID, -3*hora) // o valeAte foi 1 h atrás
	marcada(t, b, acme.ID, bia.ID, hora)    // de outra pessoa
	marcada(t, b, outra.ID, abel.ID, hora)  // de outra empresa
	if _, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID}); err != nil {
		t.Fatal(err)
	}

	got, err := b.ReunioesMarcadas(ctx, acme.ID, ana.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != cedo || got[1] != tarde {
		t.Fatalf("ReunioesMarcadas = %+v; queria [%+v %+v]", got, cedo, tarde)
	}
	// A empresa de fora nunca vê as da ACME, nem com o id da Ana.
	if got, err := b.ReunioesMarcadas(ctx, outra.ID, ana.ID); err != nil || len(got) != 0 {
		t.Fatalf("outra empresa com a pessoa da ACME = %+v, %v", got, err)
	}
	// Sem nenhuma, a lista vem vazia, não nula.
	if got, err := b.ReunioesMarcadas(ctx, acme.ID, 9999); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("sem reuniões = %#v, %v", got, err)
	}
	// Com o tempo, a que passou do valeAte sai da lista.
	andar(b, 2*time.Hour)
	if got, _ := b.ReunioesMarcadas(ctx, acme.ID, ana.ID); len(got) != 2 {
		t.Fatalf("2 h depois: %+v", got) // a cedo vale até +3 h
	}
	andar(b, time.Hour)
	if got, _ := b.ReunioesMarcadas(ctx, acme.ID, ana.ID); len(got) != 1 || got[0].Codigo != tarde.Codigo {
		t.Fatalf("3 h depois: %+v", got)
	}
}

func TestCancelarReuniao(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, acme.ID, "2004", "Bia Ramos")
	abel := pessoaDe(t, b, outra.ID, "2003", "Abel")
	r := marcada(t, b, acme.ID, ana.ID, hora)

	// Outra pessoa da empresa: proibido, e nada muda.
	if _, err := b.CancelarReuniao(ctx, acme.ID, bia.ID, r.Codigo); !errors.Is(err, ErrProibido) {
		t.Fatalf("outra pessoa da empresa: %v", err)
	}
	// Outra empresa, e um código que não existe: não encontrado.
	if _, err := b.CancelarReuniao(ctx, outra.ID, abel.ID, r.Codigo); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("outra empresa: %v", err)
	}
	if _, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, "aaaaaaaaaa"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("código que não existe: %v", err)
	}
	if got, _ := b.ReuniaoPorCodigo(ctx, r.Codigo); got.CanceladaEm != 0 || !got.Vale(agora(b)) {
		t.Fatalf("as tentativas negadas mudaram a reunião: %+v", got)
	}

	andar(b, time.Minute)
	got, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, r.Codigo)
	if err != nil || got.CanceladaEm != inicioTeste+60_000 || got.Codigo != r.Codigo {
		t.Fatalf("quem criou cancela: %+v, %v", got, err)
	}
	if got.Vale(agora(b)) {
		t.Fatal("a cancelada ainda vale")
	}
	// A reunião continua no banco (a limpeza a leva depois), em qualquer estado.
	if p, err := b.ReuniaoPorCodigo(ctx, r.Codigo); err != nil || p.CanceladaEm == 0 {
		t.Fatalf("ReuniaoPorCodigo da cancelada = %+v, %v", p, err)
	}
	// Cancelar de novo não muda a hora.
	andar(b, time.Minute)
	if again, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, r.Codigo); err != nil || again.CanceladaEm != got.CanceladaEm {
		t.Fatalf("cancelar de novo = %+v, %v", again, err)
	}
}

func TestMuitasReunioes(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	bia := pessoaDe(t, b, acme.ID, "2004", "Bia Ramos")

	var primeira Reuniao
	for i := 0; i < 100; i++ {
		r := marcada(t, b, acme.ID, ana.ID, hora+int64(i))
		if i == 0 {
			primeira = r
		}
	}
	_, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoMarcada, Inicio: agora(b) + hora, ValeAte: agora(b) + 2*hora, CriouID: ana.ID})
	if !errors.Is(err, ErrMuitasReunioes) {
		t.Fatalf("a 101ª: %v; queria ErrMuitasReunioes", err)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM reunioes`); n != 100 {
		t.Fatalf("há %d reuniões; queria 100 (a 101ª não se guarda)", n)
	}
	// O limite é de cada pessoa, e a naHora não conta.
	marcada(t, b, acme.ID, bia.ID, hora)
	if _, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID}); err != nil {
		t.Fatalf("naHora da Ana com 100 marcadas: %v", err)
	}
	// Depois de cancelar uma, cabe outra.
	if _, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, primeira.Codigo); err != nil {
		t.Fatal(err)
	}
	marcada(t, b, acme.ID, ana.ID, hora)
	if _, err := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoMarcada, Inicio: agora(b) + hora, ValeAte: agora(b) + 2*hora, CriouID: ana.ID}); !errors.Is(err, ErrMuitasReunioes) {
		t.Fatalf("de novo a 101ª: %v", err)
	}
	// As que passaram do valeAte não contam.
	andar(b, 4*time.Hour)
	marcada(t, b, acme.ID, ana.ID, hora)
}

func TestReuniaoDeTeste(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	if _, err := b.ReuniaoDeTeste(ctx); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("sem nenhuma: %v", err)
	}
	primeira, err := b.CriarReuniaoDeTeste(ctx, agora(b)+hora)
	if err != nil || primeira.Tipo != TipoTeste || primeira.EmpresaID != 0 || primeira.CriouID != 0 || primeira.ValeAte != inicioTeste+hora {
		t.Fatalf("CriarReuniaoDeTeste = %+v, %v", primeira, err)
	}
	if got, err := b.ReuniaoDeTeste(ctx); err != nil || got != primeira || !got.Vale(agora(b)) {
		t.Fatalf("ReuniaoDeTeste = %+v, %v", got, err)
	}
	andar(b, time.Minute)
	segunda, err := b.CriarReuniaoDeTeste(ctx, agora(b)+hora)
	if err != nil || segunda.Codigo == primeira.Codigo {
		t.Fatalf("a segunda = %+v, %v", segunda, err)
	}
	if got, err := b.ReuniaoDeTeste(ctx); err != nil || got != segunda {
		t.Fatalf("ReuniaoDeTeste = %+v, %v; queria a segunda", got, err)
	}
	antiga, _ := b.ReuniaoPorCodigo(ctx, primeira.Codigo)
	if antiga.CanceladaEm != inicioTeste+60_000 || antiga.Vale(agora(b)) {
		t.Fatalf("a primeira ficou %+v; queria cancelada", antiga)
	}
	// Uma de teste que já venceu não volta, e a nova não mexe na hora dela.
	andar(b, 2*time.Hour)
	if _, err := b.ReuniaoDeTeste(ctx); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("depois do valeAte: %v", err)
	}
	vencida, _ := b.ReuniaoPorCodigo(ctx, segunda.Codigo)
	terceira, err := b.CriarReuniaoDeTeste(ctx, agora(b)+hora)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := b.ReuniaoPorCodigo(ctx, segunda.Codigo); again.CanceladaEm != vencida.CanceladaEm {
		t.Fatalf("a vencida foi cancelada de novo: %+v", again)
	}
	if got, _ := b.ReuniaoDeTeste(ctx); got != terceira {
		t.Fatalf("ReuniaoDeTeste = %+v; queria a terceira", got)
	}
}

func TestReunioesNaHora(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	a1, _ := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	a2, _ := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	marcada(t, b, acme.ID, ana.ID, hora)

	got, err := b.ReunioesNaHoraAbertas(ctx)
	if err != nil || len(got) != 2 || got[0] != a1 || got[1] != a2 {
		t.Fatalf("abertas = %+v, %v", got, err)
	}
	andar(b, time.Minute)
	if err := b.AcabarReuniao(ctx, a1.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.ReunioesNaHoraAbertas(ctx); len(got) != 1 || got[0] != a2 {
		t.Fatalf("depois de acabar a primeira: %+v", got)
	}
	acabada, _ := b.ReuniaoPorCodigo(ctx, a1.Codigo)
	if acabada.AcabouEm != inicioTeste+60_000 || acabada.Vale(agora(b)) {
		t.Fatalf("a acabada = %+v", acabada)
	}
	// Acabar de novo não muda a hora; acabar o que não existe dá ErrNaoEncontrado.
	andar(b, time.Minute)
	if err := b.AcabarReuniao(ctx, a1.ID); err != nil {
		t.Fatal(err)
	}
	if again, _ := b.ReuniaoPorCodigo(ctx, a1.Codigo); again.AcabouEm != acabada.AcabouEm {
		t.Fatalf("a hora do fim mudou: %+v", again)
	}
	if err := b.AcabarReuniao(ctx, 99999); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("id que não existe: %v", err)
	}
}

// As reuniões da empresa que podem estar acontecendo, que a administração lê antes de bloquear ou apagar a empresa:
// a marcada que passou do valeAte vem (quem está nela continua); a cancelada, a naHora que acabou e as de outra
// empresa, não.
func TestReunioesDaEmpresa(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	abel := pessoaDe(t, b, outra.ID, "2003", "Abel")

	passou := marcada(t, b, acme.ID, ana.ID, -3*hora) // o valeAte foi 1 h atrás
	vale := marcada(t, b, acme.ID, ana.ID, hora)
	cancelada := marcada(t, b, acme.ID, ana.ID, hora)
	if _, err := b.CancelarReuniao(ctx, acme.ID, ana.ID, cancelada.Codigo); err != nil {
		t.Fatal(err)
	}
	aberta, _ := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	acabou, _ := b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	if err := b.AcabarReuniao(ctx, acabou.ID); err != nil {
		t.Fatal(err)
	}
	marcada(t, b, outra.ID, abel.ID, hora)
	if _, err := b.CriarReuniaoDeTeste(ctx, agora(b)+hora); err != nil {
		t.Fatal(err)
	}

	got, err := b.ReunioesDaEmpresa(ctx, acme.ID)
	if err != nil || len(got) != 3 || got[0] != passou || got[1] != vale || got[2] != aberta {
		t.Fatalf("ReunioesDaEmpresa = %+v, %v; queria a que passou, a que vale e a naHora aberta", got, err)
	}
	if got, err := b.ReunioesDaEmpresa(ctx, 9999); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("sem empresa = %#v, %v", got, err)
	}
}

func TestApagarReunioesVelhas(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	limite := agora(b) // quem acabou antes de agora sai
	cod := func(r Reuniao) string { return r.Codigo }

	nova := func(r Reuniao) Reuniao {
		t.Helper()
		r.EmpresaID, r.CriouID = acme.ID, ana.ID
		out, err := b.CriarReuniao(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	marcadaAte := func(valeAte int64) Reuniao {
		return nova(Reuniao{Tipo: TipoMarcada, Inicio: valeAte - hora, ValeAte: valeAte})
	}
	sai := []Reuniao{
		marcadaAte(limite - 1), // 1 ms antes do limite
		marcadaAte(limite - 30*umDia),
	}
	fica := []Reuniao{
		marcadaAte(limite),     // no limite: fica
		marcadaAte(limite + 1), // 1 ms depois
		marcadaAte(limite + 29*umDia),
	}
	canc := func(em int64) Reuniao {
		r := marcadaAte(limite + 10*umDia) // ainda valeria
		exec(t, b, `UPDATE reunioes SET cancelada_em = ? WHERE id = ?`, em, r.ID)
		return r
	}
	sai = append(sai, canc(limite-1))
	fica = append(fica, canc(limite))
	acabou := func(em int64) Reuniao {
		r := nova(Reuniao{Tipo: TipoNaHora})
		exec(t, b, `UPDATE reunioes SET acabou_em = ? WHERE id = ?`, em, r.ID)
		return r
	}
	sai = append(sai, acabou(limite-1))
	fica = append(fica, acabou(limite), nova(Reuniao{Tipo: TipoNaHora})) // a aberta fica
	// A de teste segue a regra da marcada.
	exec(t, b, `INSERT INTO reunioes (codigo, sala, tipo, vale_ate, criada_em) VALUES ('tttttttttt', 's1', 'teste', ?, 1)`, limite-1)
	exec(t, b, `INSERT INTO reunioes (codigo, sala, tipo, vale_ate, criada_em) VALUES ('vvvvvvvvvv', 's2', 'teste', ?, 1)`, limite)
	n, err := b.ApagarReunioesVelhas(ctx, limite)
	if err != nil || n != len(sai)+1 {
		t.Fatalf("ApagarReunioesVelhas = %d, %v; queria %d", n, err, len(sai)+1)
	}
	for _, r := range sai {
		if _, err := b.ReuniaoPorCodigo(ctx, cod(r)); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("devia ter saído: %+v (%v)", r, err)
		}
	}
	if _, err := b.ReuniaoPorCodigo(ctx, "tttttttttt"); !errors.Is(err, ErrNaoEncontrado) {
		t.Error("a de teste velha devia ter saído")
	}
	for _, r := range fica {
		if _, err := b.ReuniaoPorCodigo(ctx, cod(r)); err != nil {
			t.Errorf("devia ter ficado: %+v (%v)", r, err)
		}
	}
	if _, err := b.ReuniaoPorCodigo(ctx, "vvvvvvvvvv"); err != nil {
		t.Errorf("a de teste no limite devia ter ficado: %v", err)
	}
	// Rodar de novo não apaga mais nada.
	if n, err := b.ApagarReunioesVelhas(ctx, limite); err != nil || n != 0 {
		t.Fatalf("de novo = %d, %v", n, err)
	}
}

func TestApagarEmpresa_LevaAsReunioes(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	acme, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	ana := pessoaDe(t, b, acme.ID, "2003", "Ana Souza")
	abel := pessoaDe(t, b, outra.ID, "2003", "Abel")
	marcada(t, b, acme.ID, ana.ID, hora)
	b.CriarReuniao(ctx, Reuniao{EmpresaID: acme.ID, Tipo: TipoNaHora, CriouID: ana.ID})
	guardada := marcada(t, b, outra.ID, abel.ID, hora)
	teste, _ := b.CriarReuniaoDeTeste(ctx, agora(b)+hora)

	if _, _, err := b.ApagarEmpresa(ctx, acme.ID); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM reunioes WHERE empresa_id = ?`, acme.ID); n != 0 {
		t.Fatalf("sobraram %d reuniões da empresa apagada", n)
	}
	// A da outra empresa e a de teste (sem empresa) ficam.
	if got, err := b.ReuniaoPorCodigo(ctx, guardada.Codigo); err != nil || got != guardada {
		t.Fatalf("a da outra empresa: %+v, %v", got, err)
	}
	if got, err := b.ReuniaoPorCodigo(ctx, teste.Codigo); err != nil || got != teste {
		t.Fatalf("a de teste: %+v, %v", got, err)
	}
}

func TestReuniaoPorID_EEmpresaPorID(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	ana := pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	r := marcada(t, b, e.ID, ana.ID, hora)

	got, err := b.ReuniaoPorID(ctx, r.ID)
	if err != nil || got != r {
		t.Fatalf("ReuniaoPorID = %+v, %v; queria %+v", got, err, r)
	}
	if _, err := b.ReuniaoPorID(ctx, r.ID+100); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("ReuniaoPorID de um id que não existe = %v; queria ErrNaoEncontrado", err)
	}
	ge, err := b.EmpresaPorID(ctx, e.ID)
	if err != nil || ge != e {
		t.Fatalf("EmpresaPorID = %+v, %v; queria %+v", ge, err, e)
	}
	if _, err := b.EmpresaPorID(ctx, e.ID+100); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("EmpresaPorID de um id que não existe = %v; queria ErrNaoEncontrado", err)
	}
}
