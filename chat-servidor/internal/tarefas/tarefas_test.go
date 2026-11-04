package tarefas

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

const dia = 24 * time.Hour

type cena struct {
	a          *apitest.Ambiente
	kAna, kBia string
	conversa   int64
}

func novaCena(t *testing.T) *cena {
	t.Helper()
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	c := &cena{a: a}
	c.kAna = a.Ligar(acme.Codigo, "PC-ANA")
	c.kBia = a.Ligar(acme.Codigo, "PC-BIA")
	a.Entrar(c.kAna, "2003", "Ana Souza")
	bia := a.Entrar(c.kBia, "2004", "Beatriz")
	resp := a.Pedir(c.kAna, "POST", "/api/v1/conversas", map[string]any{"tipo": "dupla", "com": bia.ID})
	if resp.StatusCode != 201 {
		t.Fatalf("criar a dupla respondeu %d", resp.StatusCode)
	}
	c.conversa = apitest.LerJSON[struct {
		Conversa struct{ ID int64 }
	}](t, resp).Conversa.ID
	return c
}

// arquivo envia um arquivo da Ana e põe a criação dele há idade (relativo ao relógio de teste).
func (c *cena) arquivo(nome string, idade time.Duration) apitest.Arquivo {
	c.a.T.Helper()
	arq := c.a.Enviar(c.kAna, nome, "application/pdf", []byte("conteudo "+nome))
	c.a.Exec(`UPDATE arquivos SET criado_em = ? WHERE id = ?`, c.a.Relogio.Agora().Add(-idade).UnixMilli(), arq.ID)
	return arq
}

func (c *cena) mensagem(arq apitest.Arquivo) {
	c.a.T.Helper()
	resp := c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", c.conversa),
		map[string]string{"idLocal": "m-" + arq.ID, "arquivo": arq.ID})
	if resp.StatusCode != 201 {
		c.a.T.Fatalf("mensagem com arquivo respondeu %d", resp.StatusCode)
	}
}

func (c *cena) caminho(id string) string { return filepath.Join(c.a.Arquivos, id[:2], id) }

// miniatura grava uma miniatura direto no disco e marca no banco.
func (c *cena) miniatura(id string) {
	c.a.T.Helper()
	if err := os.WriteFile(c.caminho(id)+".mini", []byte("\xff\xd8\xff\xe0mini"), 0o600); err != nil {
		c.a.T.Fatal(err)
	}
	c.a.Exec(`UPDATE arquivos SET miniatura = 1 WHERE id = ?`, id)
}

func existe(p string) bool { _, err := os.Lstat(p); return err == nil }

func (c *cena) expirar(t *testing.T) (int, int) {
	t.Helper()
	e, l, err := Expirar(context.Background(), c.a.Banco, c.a.Armazem)
	if err != nil {
		t.Fatalf("Expirar: %v", err)
	}
	return e, l
}

func TestExpirar_365Dias(t *testing.T) {
	c := novaCena(t)
	velho := c.arquivo("velho.pdf", 365*dia+time.Millisecond)
	c.mensagem(velho)
	c.miniatura(velho.ID)
	novo := c.arquivo("novo.pdf", 364*dia)
	c.mensagem(novo)
	exato := c.arquivo("exato.pdf", 365*dia)
	c.mensagem(exato)

	e, l := c.expirar(t)
	if e != 1 || l != 0 {
		t.Fatalf("expirados, limpos = %d, %d; queria 1, 0", e, l)
	}
	if existe(c.caminho(velho.ID)) || existe(c.caminho(velho.ID)+".mini") {
		t.Fatal("o arquivo vencido (ou a miniatura) ficou no disco")
	}
	if c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ? AND expirado_em = ? AND miniatura = 0`,
		velho.ID, c.a.Relogio.Agora().UnixMilli()) != 1 {
		t.Fatal("a linha não ficou expirada, sem miniatura, com a hora de agora")
	}
	// A mensagem continua, e o download dá 410.
	if r := c.a.Pedir(c.kBia, "GET", "/api/v1/arquivos/"+velho.ID, nil); r.StatusCode != 410 {
		t.Fatalf("download do vencido respondeu %d; queria 410", r.StatusCode)
	}
	resp := c.a.Pedir(c.kBia, "GET", fmt.Sprintf("/api/v1/conversas/%d/mensagens", c.conversa), nil)
	pag := apitest.LerJSON[struct {
		Mensagens []struct{ Arquivo *apitest.Arquivo }
	}](t, resp)
	achou := map[string]apitest.Arquivo{}
	for _, m := range pag.Mensagens {
		if m.Arquivo != nil {
			achou[m.Arquivo.ID] = *m.Arquivo
		}
	}
	if v := achou[velho.ID]; !v.Expirado || v.Miniatura {
		t.Fatalf("na lista, o vencido = %+v; queria expirado e sem miniatura", v)
	}
	if achou[novo.ID].Expirado || achou[exato.ID].Expirado {
		t.Fatal("um arquivo de 364 ou 365 dias exatos foi marcado como expirado")
	}
	for _, a := range []apitest.Arquivo{novo, exato} {
		if !existe(c.caminho(a.ID)) {
			t.Fatalf("o arquivo %s saiu do disco", a.ID)
		}
		if r := c.a.Pedir(c.kBia, "GET", "/api/v1/arquivos/"+a.ID, nil); r.StatusCode != 200 {
			t.Fatalf("download respondeu %d", r.StatusCode)
		}
	}
	// Uma segunda rodada não faz nada.
	if e, l := c.expirar(t); e != 0 || l != 0 {
		t.Fatalf("segunda rodada = %d, %d; queria 0, 0", e, l)
	}
}

func TestLimpar_SemMensagem(t *testing.T) {
	c := novaCena(t)
	velho := c.arquivo("velho.pdf", 24*time.Hour+time.Minute)
	c.miniatura(velho.ID)
	novo := c.arquivo("novo.pdf", 23*time.Hour)
	usado := c.arquivo("usado.pdf", 30*dia)
	c.mensagem(usado)
	c.miniatura(usado.ID)

	e, l := c.expirar(t)
	if e != 0 || l != 1 {
		t.Fatalf("expirados, limpos = %d, %d; queria 0, 1", e, l)
	}
	if existe(c.caminho(velho.ID)) || existe(c.caminho(velho.ID)+".mini") {
		t.Fatal("o arquivo sem mensagem ficou no disco")
	}
	if c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ?`, velho.ID) != 0 {
		t.Fatal("a linha do arquivo sem mensagem ficou no banco")
	}
	if !existe(c.caminho(novo.ID)) || c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ?`, novo.ID) != 1 {
		t.Fatal("o arquivo de 23 h não devia sair")
	}
	// O usado nunca é tocado: nem a linha, nem o arquivo, nem a miniatura.
	if !existe(c.caminho(usado.ID)) || !existe(c.caminho(usado.ID)+".mini") ||
		c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ? AND expirado_em IS NULL AND miniatura = 1`, usado.ID) != 1 {
		t.Fatal("o arquivo com mensagem foi tocado")
	}
}

// Uma mensagem que chega entre a consulta e o DELETE não perde o arquivo.
func TestApagarArquivo_SoSemMensagem(t *testing.T) {
	c := novaCena(t)
	usado := c.arquivo("usado.pdf", 3*dia)
	c.mensagem(usado)
	livre := c.arquivo("livre.pdf", 3*dia)
	ctx := context.Background()
	if ok, err := c.a.Banco.ApagarArquivo(ctx, usado.ID); err != nil || ok {
		t.Fatalf("ApagarArquivo(usado) = %v, %v; queria false, nil", ok, err)
	}
	if ok, err := c.a.Banco.ApagarArquivo(ctx, livre.ID); err != nil || !ok {
		t.Fatalf("ApagarArquivo(livre) = %v, %v; queria true, nil", ok, err)
	}
	if ok, err := c.a.Banco.MarcarExpirado(ctx, usado.ID); err != nil || !ok {
		t.Fatalf("MarcarExpirado = %v, %v", ok, err)
	}
	if ok, err := c.a.Banco.MarcarExpirado(ctx, usado.ID); err != nil || ok {
		t.Fatalf("MarcarExpirado de novo = %v, %v; queria false, nil", ok, err)
	}
}

func TestVarrer_Orfaos(t *testing.T) {
	c := novaCena(t)
	agora := c.a.Relogio.Agora()
	velhice := func(p string, idade time.Duration) {
		t.Helper()
		h := agora.Add(-idade)
		if err := os.Chtimes(p, h, h); err != nil {
			t.Fatal(err)
		}
	}
	escrever := func(p string) string {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	idOrfao := func(prefixo string) string { return prefixo + strings.Repeat("a", 30) }
	path := func(id string) string { return filepath.Join(c.a.Arquivos, id[:2], id) }

	// Temporário: velho sai, novo fica.
	tmpVelho := escrever(filepath.Join(c.a.Arquivos, "ab", ".tmp-velho"))
	velhice(tmpVelho, 25*time.Hour)
	tmpNovo := escrever(filepath.Join(c.a.Arquivos, "ab", ".tmp-novo"))
	velhice(tmpNovo, time.Hour)
	// Órfão sem linha: arquivo e miniatura, velhos saem, novos ficam.
	orfaoVelho := escrever(path(idOrfao("b1")))
	velhice(orfaoVelho, 25*time.Hour)
	miniOrfaoVelha := escrever(path(idOrfao("b1")) + ".mini")
	velhice(miniOrfaoVelha, 25*time.Hour)
	orfaoNovo := escrever(path(idOrfao("b2")))
	velhice(orfaoNovo, time.Hour)
	miniOrfaoNova := escrever(path(idOrfao("b2")) + ".mini")
	velhice(miniOrfaoNova, time.Hour)

	// Arquivo com linha e mensagem, miniatura = 0: a .mini velha sai, a nova fica; o arquivo fica.
	semMini := c.arquivo("a.pdf", 2*dia)
	c.mensagem(semMini)
	escrever(c.caminho(semMini.ID) + ".mini")
	velhice(c.caminho(semMini.ID)+".mini", 25*time.Hour)
	semMiniNovo := c.arquivo("b.pdf", 2*dia)
	c.mensagem(semMiniNovo)
	escrever(c.caminho(semMiniNovo.ID) + ".mini")
	velhice(c.caminho(semMiniNovo.ID)+".mini", time.Hour)
	// Com miniatura = 1, a miniatura velha fica.
	comMini := c.arquivo("c.pdf", 2*dia)
	c.mensagem(comMini)
	c.miniatura(comMini.ID)
	velhice(c.caminho(comMini.ID)+".mini", 30*dia)
	velhice(c.caminho(comMini.ID), 30*dia)

	// Linha expirada: arquivo e miniatura saem em qualquer idade (aqui, recém-criados).
	expirado := c.arquivo("d.pdf", 2*dia)
	c.mensagem(expirado)
	escrever(c.caminho(expirado.ID) + ".mini")
	c.a.Exec(`UPDATE arquivos SET expirado_em = ? WHERE id = ?`, agora.UnixMilli(), expirado.ID)

	// Nomes que não são do armazém ficam: id curto, id em maiúsculas, estranho, subpasta
	// errada, subpasta que não é hexadecimal e um link simbólico.
	ficam := []string{
		escrever(filepath.Join(c.a.Arquivos, "ab", "lixo.txt")),
		escrever(filepath.Join(c.a.Arquivos, "ab", strings.Repeat("A", 32))),
		escrever(filepath.Join(c.a.Arquivos, "ab", idOrfao("cc"))), // id na subpasta errada
		escrever(filepath.Join(c.a.Arquivos, "zz", idOrfao("zz"))),
		escrever(filepath.Join(c.a.Arquivos, "solto.txt")),
	}
	fora := filepath.Join(t.TempDir(), "fora")
	escrever(fora)
	velhice(fora, 30*dia)
	link := filepath.Join(c.a.Arquivos, "b3", idOrfao("b3"))
	if err := os.MkdirAll(filepath.Dir(link), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(fora, link); err != nil {
		t.Fatal(err)
	}
	ficam = append(ficam, link)
	for _, p := range ficam {
		if _, err := os.Lstat(p); err == nil && !strings.HasSuffix(p, "solto.txt") && !strings.HasSuffix(p, "lixo.txt") {
			if info, _ := os.Lstat(p); info.Mode()&os.ModeSymlink == 0 {
				velhice(p, 30*dia)
			}
		}
	}

	e, l := c.expirar(t)
	if e != 0 {
		t.Fatalf("expirados = %d; queria 0", e)
	}
	saem := []string{tmpVelho, orfaoVelho, miniOrfaoVelha, c.caminho(semMini.ID) + ".mini",
		c.caminho(expirado.ID), c.caminho(expirado.ID) + ".mini"}
	if l != len(saem) {
		t.Fatalf("limpos = %d; queria %d", l, len(saem))
	}
	for _, p := range saem {
		if existe(p) {
			t.Errorf("devia ter saído: %s", p)
		}
	}
	fica := append([]string{tmpNovo, orfaoNovo, miniOrfaoNova, c.caminho(semMini.ID),
		c.caminho(semMiniNovo.ID), c.caminho(semMiniNovo.ID) + ".mini",
		c.caminho(comMini.ID), c.caminho(comMini.ID) + ".mini", fora}, ficam...)
	for _, p := range fica {
		if !existe(p) {
			t.Errorf("devia ter ficado: %s", p)
		}
	}
	// A linha expirada continua (a mensagem a usa).
	if c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ?`, expirado.ID) != 1 {
		t.Error("a linha do expirado sumiu")
	}
}

func TestProximaRodada(t *testing.T) {
	fuso := tempo.Fuso()
	casos := []struct {
		nome        string
		agora, quer time.Time
	}{
		{"23h", time.Date(2026, 11, 4, 23, 0, 0, 0, fuso), time.Date(2026, 11, 5, 4, 0, 0, 0, fuso)},
		{"03h", time.Date(2026, 11, 4, 3, 0, 0, 0, fuso), time.Date(2026, 11, 4, 4, 0, 0, 0, fuso)},
		{"04h em ponto", time.Date(2026, 11, 4, 4, 0, 0, 0, fuso), time.Date(2026, 11, 5, 4, 0, 0, 0, fuso)},
		{"04h e 1 ns", time.Date(2026, 11, 4, 4, 0, 0, 1, fuso), time.Date(2026, 11, 5, 4, 0, 0, 0, fuso)},
		{"fim do mês", time.Date(2026, 11, 30, 12, 0, 0, 0, fuso), time.Date(2026, 12, 1, 4, 0, 0, 0, fuso)},
		// Um servidor em UTC: 06:30 UTC é 03:30 em Brasília, ainda antes das 04:00 de hoje.
		{"em UTC", time.Date(2026, 11, 4, 6, 30, 0, 0, time.UTC), time.Date(2026, 11, 4, 4, 0, 0, 0, fuso)},
		{"em UTC, depois", time.Date(2026, 11, 4, 7, 0, 0, 0, time.UTC), time.Date(2026, 11, 5, 4, 0, 0, 0, fuso)},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			rel := tempo.NovoTeste(c.agora)
			got := proximaRodada(rel.Agora())
			if !got.Equal(c.quer) {
				t.Fatalf("proximaRodada(%v) = %v; queria %v", c.agora, got, c.quer)
			}
			if got.In(fuso).Hour() != 4 {
				t.Fatalf("a hora em Brasília é %d; queria 4", got.In(fuso).Hour())
			}
		})
	}
}

func TestRodar_RodadaAoComecarEPara(t *testing.T) {
	c := novaCena(t)
	velho := c.arquivo("velho.pdf", 366*dia)
	c.mensagem(velho)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	feito := make(chan struct{})
	go func() {
		Rodar(ctx, c.a.Banco, c.a.Armazem)
		close(feito)
	}()
	espera := time.Now().Add(5 * time.Second)
	for existe(c.caminho(velho.ID)) {
		if time.Now().After(espera) {
			t.Fatal("o arquivo vencido não saiu depois de Rodar começar")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// A linha já está marcada, pois a marca vem antes do disco.
	if c.a.Contar(`SELECT COUNT(*) FROM arquivos WHERE id = ? AND expirado_em IS NOT NULL`, velho.ID) != 1 {
		t.Fatal("a linha não ficou expirada")
	}
	cancel()
	select {
	case <-feito:
	case <-time.After(time.Second):
		t.Fatal("Rodar não voltou em 1 s depois do cancel")
	}
}
