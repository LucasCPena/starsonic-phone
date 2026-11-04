package banco

import (
	"context"
	"errors"
	"testing"
	"time"
)

// cenaMensagens são a Ana e a Beatriz da ACME, uma conversa a dois, e o Abel de outra empresa.
type cenaMensagens struct {
	b             *Banco
	ana, bia, abe Pessoa
	dupla         int64
}

func novaCenaMensagens(t *testing.T) cenaMensagens {
	t.Helper()
	ctx := context.Background()
	b := abrirTeste(t)
	e, _ := b.CriarEmpresa(ctx, "ACME Comércio Ltda")
	outra, _ := b.CriarEmpresa(ctx, "Outra Ltda")
	c := cenaMensagens{b: b}
	c.ana = pessoaDe(t, b, e.ID, "2003", "Ana Souza")
	c.bia = pessoaDe(t, b, e.ID, "2004", "Beatriz")
	c.abe = pessoaDe(t, b, outra.ID, "2003", "Abel")
	var err error
	if c.dupla, _, err = b.CriarDupla(ctx, e.ID, c.ana.ID, c.bia.ID); err != nil {
		t.Fatal(err)
	}
	return c
}

// arquivoDe grava um arquivo direto na tabela, enviado por autor.
func arquivoDe(t *testing.T, b *Banco, empresaID, autorID int64, id, tipo string) {
	t.Helper()
	_, err := b.db.Exec(`INSERT INTO arquivos (id, empresa_id, autor_id, nome, tipo, tamanho, criado_em)
		VALUES (?, ?, ?, 'Proposta ACME.pdf', ?, 1024, ?)`, id, empresaID, autorID, tipo, b.agoraMs())
	if err != nil {
		t.Fatal(err)
	}
}

func TestEnviarTexto_NovaERepetida(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	avancar(c.b, time.Minute)

	m, nova, err := c.b.EnviarTexto(ctx, c.ana.ID, c.dupla, "abc-1", "Olá, Beatriz")
	if err != nil || !nova {
		t.Fatalf("EnviarTexto = %+v, %v, %v", m, nova, err)
	}
	if m.Tipo != "texto" || m.Texto != "Olá, Beatriz" || m.ConversaID != c.dupla || m.IDLocal != "abc-1" ||
		m.Autor == nil || m.Autor.ID != c.ana.ID || m.CriadaEm != c.b.agoraMs() {
		t.Fatalf("mensagem = %+v", m)
	}
	var atualizada int64
	c.b.db.QueryRow(`SELECT atualizada_em FROM conversas WHERE id = ?`, c.dupla).Scan(&atualizada)
	if atualizada != m.CriadaEm {
		t.Fatalf("atualizada_em = %d; queria %d", atualizada, m.CriadaEm)
	}

	// O mesmo idLocal da mesma pessoa devolve a mesma mensagem, mesmo com outro texto.
	m2, nova2, err := c.b.EnviarTexto(ctx, c.ana.ID, c.dupla, "abc-1", "outro texto")
	if err != nil || nova2 || m2.ID != m.ID || m2.Texto != "Olá, Beatriz" {
		t.Fatalf("repetida = %+v, %v, %v", m2, nova2, err)
	}
	// Outra pessoa pode usar o mesmo idLocal.
	m3, nova3, err := c.b.EnviarTexto(ctx, c.bia.ID, c.dupla, "abc-1", "Oi, Ana")
	if err != nil || !nova3 || m3.ID == m.ID {
		t.Fatalf("outra pessoa = %+v, %v, %v", m3, nova3, err)
	}
	if n := contar(t, c.b, `SELECT COUNT(*) FROM mensagens WHERE conversa_id = ?`, c.dupla); n != 2 {
		t.Fatalf("mensagens = %d; queria 2", n)
	}
}

func TestEnviarTexto_QuemNaoEstaNaConversa(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	if _, _, err := c.b.EnviarTexto(ctx, c.abe.ID, c.dupla, "x1", "oi"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("de outra empresa: %v", err)
	}
	if _, _, err := c.b.EnviarTexto(ctx, c.ana.ID, 9999, "x2", "oi"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("conversa que não existe: %v", err)
	}
	// Quem saiu do grupo não envia mais.
	g, _, err := c.b.CriarGrupo(ctx, c.ana.EmpresaID, c.ana.ID, "Comercial", []int64{c.bia.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.b.TirarMembro(ctx, c.bia.ID, g, c.bia.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.b.EnviarTexto(ctx, c.bia.ID, g, "x3", "oi"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("quem saiu: %v", err)
	}
	if _, _, err := c.b.Mensagens(ctx, c.bia.ID, g, 0, 0, 50); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("Mensagens de quem saiu: %v", err)
	}
	if _, err := c.b.MarcarLida(ctx, c.bia.ID, g, 1); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("MarcarLida de quem saiu: %v", err)
	}
}

func TestEnviarArquivo(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	emp := c.ana.EmpresaID
	arquivoDe(t, c.b, emp, c.ana.ID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "application/pdf")
	arquivoDe(t, c.b, emp, c.bia.ID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "image/png")
	arquivoDe(t, c.b, emp, c.ana.ID, "cccccccccccccccccccccccccccccccc", "application/pdf")
	c.b.db.Exec(`UPDATE arquivos SET expirado_em = ? WHERE id = 'cccccccccccccccccccccccccccccccc'`, c.b.agoraMs())

	m, nova, err := c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "f-1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil || !nova {
		t.Fatalf("EnviarArquivo = %+v, %v, %v", m, nova, err)
	}
	if m.Tipo != "arquivo" || m.Arquivo == nil || m.Arquivo.ID != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ||
		m.Arquivo.Nome != "Proposta ACME.pdf" || m.Arquivo.Tamanho != 1024 || m.Arquivo.Foto || m.Arquivo.Expirado || m.Texto != "" {
		t.Fatalf("mensagem = %+v (arquivo %+v)", m, m.Arquivo)
	}
	var atualizada int64
	c.b.db.QueryRow(`SELECT atualizada_em FROM conversas WHERE id = ?`, c.dupla).Scan(&atualizada)
	if atualizada != m.CriadaEm {
		t.Fatalf("atualizada_em = %d; queria %d", atualizada, m.CriadaEm)
	}

	// O mesmo idLocal repete a mensagem, sem conferir o arquivo de novo (que já está nela).
	m2, nova2, err := c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "f-1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil || nova2 || m2.ID != m.ID {
		t.Fatalf("repetida = %+v, %v, %v", m2, nova2, err)
	}
	// Um arquivo que já está numa mensagem não entra em outra.
	if _, _, err := c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "f-2", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); !errors.Is(err, ErrInvalido) {
		t.Fatalf("arquivo em outra mensagem: %v", err)
	}
	// Um arquivo de outra pessoa, um que não existe e um expirado.
	for nome, id := range map[string]string{
		"de outra pessoa": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"que não existe":  "dddddddddddddddddddddddddddddddd",
		"expirado":        "cccccccccccccccccccccccccccccccc",
	} {
		if _, _, err := c.b.EnviarArquivo(ctx, c.ana.ID, c.dupla, "g-"+nome[:2], id); !errors.Is(err, ErrInvalido) {
			t.Fatalf("arquivo %s: %v", nome, err)
		}
	}
	// Quem não está na conversa recebe 404 antes de qualquer conferência do arquivo.
	if _, _, err := c.b.EnviarArquivo(ctx, c.abe.ID, c.dupla, "h-1", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("de outra empresa: %v", err)
	}
	if n := contar(t, c.b, `SELECT COUNT(*) FROM mensagens WHERE tipo = 'arquivo'`); n != 1 {
		t.Fatalf("mensagens de arquivo = %d; queria 1", n)
	}
}

func TestMarcarLida_SoAvanca(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	var ids []int64
	for _, id := range []string{"m1", "m2", "m3", "m4", "m5"} {
		m, _, err := c.b.EnviarTexto(ctx, c.ana.ID, c.dupla, id, "texto "+id)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	lido := func() int64 {
		var ate int64
		c.b.db.QueryRow(`SELECT COALESCE((SELECT ate FROM leituras WHERE pessoa_id = ? AND conversa_id = ?), 0)`,
			c.bia.ID, c.dupla).Scan(&ate)
		return ate
	}

	if av, err := c.b.MarcarLida(ctx, c.bia.ID, c.dupla, ids[4]); err != nil || !av || lido() != ids[4] {
		t.Fatalf("ate=%d: avancou=%v, err=%v, lido=%d", ids[4], av, err, lido())
	}
	if av, err := c.b.MarcarLida(ctx, c.bia.ID, c.dupla, ids[2]); err != nil || av || lido() != ids[4] {
		t.Fatalf("ate menor: avancou=%v, err=%v, lido=%d; queria %d", av, err, lido(), ids[4])
	}
	if av, err := c.b.MarcarLida(ctx, c.bia.ID, c.dupla, ids[4]); err != nil || av {
		t.Fatalf("ate igual: avancou=%v, err=%v", av, err)
	}
	// Um ate que passa da última mensagem vale só até ela: as próximas não nascem lidas.
	if av, err := c.b.MarcarLida(ctx, c.ana.ID, c.dupla, ids[4]+1000); err != nil || !av {
		t.Fatalf("ate alto: avancou=%v, err=%v", av, err)
	}
	var ate int64
	c.b.db.QueryRow(`SELECT ate FROM leituras WHERE pessoa_id = ? AND conversa_id = ?`, c.ana.ID, c.dupla).Scan(&ate)
	if ate != ids[4] {
		t.Fatalf("ate guardado = %d; queria %d", ate, ids[4])
	}
	if _, err := c.b.MarcarLida(ctx, c.abe.ID, c.dupla, 1); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("de outra empresa: %v", err)
	}
}

func TestMensagens_AntesEDepois(t *testing.T) {
	ctx := context.Background()
	c := novaCenaMensagens(t)
	for i := 0; i < 7; i++ {
		if _, _, err := c.b.EnviarTexto(ctx, c.ana.ID, c.dupla, "m"+string(rune('a'+i)), "x"); err != nil {
			t.Fatal(err)
		}
	}
	ids := func(l []Mensagem) []int64 {
		var out []int64
		for _, m := range l {
			out = append(out, m.ID)
		}
		return out
	}
	todas, temMais, err := c.b.Mensagens(ctx, c.bia.ID, c.dupla, 0, 0, 50)
	if err != nil || len(todas) != 7 || temMais {
		t.Fatalf("todas = %v, %v, %v", ids(todas), temMais, err)
	}
	pag, temMais, err := c.b.Mensagens(ctx, c.bia.ID, c.dupla, 0, 0, 3)
	if err != nil || !temMais || len(pag) != 3 || pag[2].ID != todas[6].ID || pag[0].ID >= pag[1].ID {
		t.Fatalf("mais novas = %v, %v, %v", ids(pag), temMais, err)
	}
	antes, temMais, err := c.b.Mensagens(ctx, c.bia.ID, c.dupla, todas[3].ID, 0, 3)
	if err != nil || temMais || len(antes) != 3 || antes[2].ID != todas[2].ID {
		t.Fatalf("antes = %v, %v, %v", ids(antes), temMais, err)
	}
	depois, temMais, err := c.b.Mensagens(ctx, c.bia.ID, c.dupla, 0, todas[1].ID, 3)
	if err != nil || !temMais || len(depois) != 3 || depois[0].ID != todas[2].ID {
		t.Fatalf("depois = %v, %v, %v", ids(depois), temMais, err)
	}
}
