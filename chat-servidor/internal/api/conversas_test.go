package api_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// As formas da seção 4 do protocolo, como o app as lê.
type mensagemResp struct {
	ID       int64           `json:"id"`
	Conversa int64           `json:"conversa"`
	Autor    *apitest.Pessoa `json:"autor"`
	Tipo     string          `json:"tipo"`
	Aviso    *struct {
		Acao string          `json:"acao"`
		Quem apitest.Pessoa  `json:"quem"`
		Alvo *apitest.Pessoa `json:"alvo"`
	} `json:"aviso"`
	CriadaEm int64 `json:"criadaEm"`
}

type conversaResp struct {
	ID           int64           `json:"id"`
	Tipo         string          `json:"tipo"`
	Com          *apitest.Pessoa `json:"com"`
	Nome         string          `json:"nome"`
	Pessoas      *int            `json:"pessoas"`
	Cuida        *bool           `json:"cuida"`
	Ultima       *mensagemResp   `json:"ultima"`
	NaoLidas     int             `json:"naoLidas"`
	AtualizadaEm int64           `json:"atualizadaEm"`
}

type eventoResp struct {
	Tipo     string          `json:"tipo"`
	Conversa json.RawMessage `json:"conversa"`
}

// cena são três pessoas da ACME, cada uma no seu computador, e uma de outra empresa.
type cena struct {
	a                      *apitest.Ambiente
	ana, bia, carlos, dani apitest.Pessoa
	kAna, kBia, kCarlos    string
	kDani                  string
	abel                   apitest.Pessoa // da outra empresa
	kAbel                  string
}

func novaCena(t *testing.T) *cena {
	t.Helper()
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	outra := a.Empresa("Outra Ltda")
	c := &cena{a: a}
	c.kAna = a.Ligar(acme.Codigo, "PC-ANA")
	c.kBia = a.Ligar(acme.Codigo, "PC-BIA")
	c.kCarlos = a.Ligar(acme.Codigo, "PC-CARLOS")
	c.kDani = a.Ligar(acme.Codigo, "PC-DANI")
	c.kAbel = a.Ligar(outra.Codigo, "PC-ABEL")
	c.ana = a.Entrar(c.kAna, "2003", "Ana Souza")
	c.bia = a.Entrar(c.kBia, "2004", "Beatriz")
	c.carlos = a.Entrar(c.kCarlos, "2005", "Carlos")
	c.dani = a.Entrar(c.kDani, "2006", "Daniela")
	c.abel = a.Entrar(c.kAbel, "2003", "Abel")
	return c
}

func (c *cena) dupla(t *testing.T, chave string, com int64) *http.Response {
	return c.a.Pedir(chave, "POST", "/api/v1/conversas", map[string]any{"tipo": "dupla", "com": com})
}

func (c *cena) grupo(chave, nome string, pessoas ...int64) *http.Response {
	if pessoas == nil {
		pessoas = []int64{}
	}
	return c.a.Pedir(chave, "POST", "/api/v1/conversas", map[string]any{"tipo": "grupo", "nome": nome, "pessoas": pessoas})
}

// criarGrupo cria o grupo e falha o teste se não responder 201.
func (c *cena) criarGrupo(t *testing.T, chave, nome string, pessoas ...int64) conversaResp {
	t.Helper()
	resp := c.grupo(chave, nome, pessoas...)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar o grupo %q respondeu %d", nome, resp.StatusCode)
	}
	return apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa
}

func (c *cena) lista(t *testing.T, chave string) []conversaResp {
	t.Helper()
	resp := c.a.Pedir(chave, "GET", "/api/v1/conversas", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /conversas respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[struct{ Conversas []conversaResp }](t, resp).Conversas
}

func (c *cena) pôr(chave string, conversa int64, pessoas ...int64) *http.Response {
	return c.a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/membros", conversa), map[string]any{"pessoas": pessoas})
}

func (c *cena) tirar(chave string, conversa, pessoa int64) *http.Response {
	return c.a.Pedir(chave, "DELETE", fmt.Sprintf("/api/v1/conversas/%d/membros/%d", conversa, pessoa), nil)
}

// bancoDe abre o arquivo do banco por outra conexão, para o teste ler e gravar direto.
func bancoDe(t *testing.T, a *apitest.Ambiente) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+a.Caminho+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// avisosDe lista os avisos da conversa, do mais antigo ao mais novo, como "acao:quem" ou
// "acao:quem>alvo".
func avisosDe(t *testing.T, a *apitest.Ambiente, conversa int64) []string {
	t.Helper()
	rows, err := bancoDe(t, a).Query(
		`SELECT m.aviso_acao, q.nome, al.nome FROM mensagens m
		   JOIN pessoas q ON q.id = m.autor_id LEFT JOIN pessoas al ON al.id = m.aviso_alvo_id
		  WHERE m.conversa_id = ? AND m.tipo = 'aviso' ORDER BY m.id`, conversa)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var acao, quem string
		var alvo *string
		if err := rows.Scan(&acao, &quem, &alvo); err != nil {
			t.Fatal(err)
		}
		s := acao + ":" + quem
		if alvo != nil {
			s += ">" + *alvo
		}
		out = append(out, s)
	}
	return out
}

// texto grava uma mensagem de texto direto no banco, na hora do relógio de teste (a Task 6
// ainda não tem a rota). Devolve o id.
func texto(t *testing.T, a *apitest.Ambiente, conversa, autor int64, s string) int64 {
	t.Helper()
	r, err := bancoDe(t, a).Exec(
		`INSERT INTO mensagens (conversa_id, autor_id, tipo, texto, criada_em) VALUES (?, ?, 'texto', ?, ?)`,
		conversa, autor, s, a.Relogio.Agora().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	id, _ := r.LastInsertId()
	return id
}

// proximo lê o próximo evento da conexão e confere o tipo.
func proximo(t *testing.T, conn *websocket.Conn, tipo string) eventoResp {
	t.Helper()
	ev := apitest.LerEvento[eventoResp](t, conn)
	if ev.Tipo != tipo {
		t.Fatalf("evento %q; queria %q", ev.Tipo, tipo)
	}
	return ev
}

func conversaDo(t *testing.T, ev eventoResp) conversaResp {
	t.Helper()
	var c conversaResp
	if err := json.Unmarshal(ev.Conversa, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func chaves(t *testing.T, resp *http.Response) []string {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	var ks []string
	for k := range m {
		ks = append(ks, k)
	}
	slices.Sort(ks)
	return ks
}

func TestDupla_UmaSoPorPar(t *testing.T) {
	c := novaCena(t)

	resp := c.dupla(t, c.kAna, c.bia.ID)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("Ana com Beatriz: status %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[map[string]map[string]any](t, resp)
	conv := corpo["conversa"]
	// A dupla leva os campos da seção 4 e só eles: sem nome, pessoas nem cuida.
	var ks []string
	for k := range conv {
		ks = append(ks, k)
	}
	slices.Sort(ks)
	if want := []string{"atualizadaEm", "com", "id", "naoLidas", "tipo", "ultima"}; !slices.Equal(ks, want) {
		t.Fatalf("campos = %v; queria %v", ks, want)
	}
	if conv["tipo"] != "dupla" || conv["ultima"] != nil || conv["naoLidas"] != float64(0) {
		t.Fatalf("conversa = %v", conv)
	}
	com := conv["com"].(map[string]any)
	if com["id"] != float64(c.bia.ID) || com["nome"] != "Beatriz" {
		t.Fatalf("com = %v", com)
	}

	// A Beatriz com a Ana é a mesma conversa; a "com" dela é a Ana.
	resp = c.dupla(t, c.kBia, c.ana.ID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Beatriz com Ana: status %d", resp.StatusCode)
	}
	conv2 := apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa
	if conv2.ID != int64(conv["id"].(float64)) || conv2.Com == nil || conv2.Com.ID != c.ana.ID {
		t.Fatalf("segunda = %+v", conv2)
	}

	e := esperarErro(t, c.dupla(t, c.kAna, c.ana.ID), 400, "invalido")
	if e.Campo != "com" {
		t.Fatalf("campo = %q; queria com", e.Campo)
	}
}

func TestDupla_ComQuemSaiu(t *testing.T) {
	c := novaCena(t)
	c.a.Exec(`UPDATE pessoas SET saiu_em = ? WHERE id = ?`, c.a.Relogio.Agora().UnixMilli(), c.carlos.ID)
	if e := esperarErro(t, c.dupla(t, c.kAna, c.carlos.ID), 400, "invalido"); e.Campo != "com" {
		t.Fatalf("campo = %q; queria com", e.Campo)
	}
}

func TestDupla_Invalida(t *testing.T) {
	c := novaCena(t)
	if e := esperarErro(t, c.a.Pedir(c.kAna, "POST", "/api/v1/conversas", map[string]any{"tipo": "dupla"}), 400, "invalido"); e.Campo != "com" {
		t.Fatalf("sem com: campo = %q", e.Campo)
	}
	if e := esperarErro(t, c.a.Pedir(c.kAna, "POST", "/api/v1/conversas", map[string]any{"tipo": "sala"}), 400, "invalido"); e.Campo != "tipo" {
		t.Fatalf("tipo ruim: campo = %q", e.Campo)
	}
	esperarErro(t, c.dupla(t, c.kAna, 99999), 404, "naoEncontrado")
}

func TestConversas_SemPessoa(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "PC-NOVO") // ninguém entrou neste computador
	for _, r := range [][2]string{
		{"GET", "/api/v1/conversas"}, {"POST", "/api/v1/conversas"},
		{"GET", "/api/v1/conversas/1/membros"}, {"POST", "/api/v1/conversas/1/membros"},
		{"DELETE", "/api/v1/conversas/1/membros/1"},
	} {
		esperarErro(t, a.Pedir(chave, r[0], r[1], nil), 409, "pessoa")
	}
	esperarErro(t, a.Pedir("", "GET", "/api/v1/conversas", nil), 401, "chave")
}

func TestGrupo_Criar(t *testing.T) {
	c := novaCena(t)
	cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)

	resp := c.grupo(c.kAna, "Comercial", c.bia.ID, c.carlos.ID)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	conv := apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa
	if conv.Tipo != "grupo" || conv.Nome != "Comercial" || conv.Pessoas == nil || *conv.Pessoas != 3 ||
		conv.Cuida == nil || !*conv.Cuida || conv.Com != nil || conv.NaoLidas != 0 {
		t.Fatalf("conversa da Ana = %+v", conv)
	}
	// Na Conversa o último é o aviso pos do Carlos, com autor, quem e alvo.
	u := conv.Ultima
	if u == nil || u.Tipo != "aviso" || u.Conversa != conv.ID || u.Aviso == nil || u.Aviso.Acao != "pos" ||
		u.Aviso.Quem.ID != c.ana.ID || u.Aviso.Alvo == nil || u.Aviso.Alvo.ID != c.carlos.ID ||
		u.Autor == nil || u.Autor.ID != c.ana.ID {
		t.Fatalf("ultima = %+v", u)
	}
	if got, want := avisosDe(t, c.a, conv.ID), []string{"criou:Ana Souza", "pos:Ana Souza>Beatriz", "pos:Ana Souza>Carlos"}; !slices.Equal(got, want) {
		t.Fatalf("avisos = %v; queria %v", got, want)
	}

	// Cada um dos três recebe o evento conversa, com o seu "cuida".
	for _, x := range []struct {
		nome  string
		conn  *websocket.Conn
		cuida bool
	}{{"Ana", cAna, true}, {"Beatriz", cBia, false}, {"Carlos", cCarlos, false}} {
		got := conversaDo(t, proximo(t, x.conn, "conversa"))
		if got.ID != conv.ID || got.Cuida == nil || *got.Cuida != x.cuida || got.Pessoas == nil || *got.Pessoas != 3 {
			t.Fatalf("evento de %s = %+v", x.nome, got)
		}
	}

	// Na lista da Beatriz o grupo vem sem cuida.
	l := c.lista(t, c.kBia)
	if len(l) != 1 || l[0].ID != conv.ID || *l[0].Cuida {
		t.Fatalf("lista da Beatriz = %+v", l)
	}
	// Os campos do grupo: sem com.
	resp = c.a.Pedir(c.kAna, "GET", "/api/v1/conversas", nil)
	var lista struct{ Conversas []map[string]any }
	if err := json.NewDecoder(resp.Body).Decode(&lista); err != nil {
		t.Fatal(err)
	}
	var ks []string
	for k := range lista.Conversas[0] {
		ks = append(ks, k)
	}
	slices.Sort(ks)
	if want := []string{"atualizadaEm", "cuida", "id", "naoLidas", "nome", "pessoas", "tipo", "ultima"}; !slices.Equal(ks, want) {
		t.Fatalf("campos = %v; queria %v", ks, want)
	}
	ult := lista.Conversas[0]["ultima"].(map[string]any)
	var uk []string
	for k := range ult {
		uk = append(uk, k)
	}
	slices.Sort(uk)
	if want := []string{"autor", "aviso", "conversa", "criadaEm", "id", "idLocal", "tipo"}; !slices.Equal(uk, want) {
		t.Fatalf("campos da mensagem = %v; queria %v", uk, want)
	}
}

func TestGrupo_Invalido(t *testing.T) {
	c := novaCena(t)
	for _, x := range []struct{ nome, campo string }{{"   ", "nome"}, {strings.Repeat("a", 61), "nome"}} {
		if e := esperarErro(t, c.grupo(c.kAna, x.nome, c.bia.ID), 400, "invalido"); e.Campo != x.campo {
			t.Fatalf("nome %q: campo = %q", x.nome, e.Campo)
		}
	}
	esperarErro(t, c.grupo(c.kAna, "Comercial", 99999), 404, "naoEncontrado")
	// Quem saiu do chat não entra num grupo.
	c.a.Exec(`UPDATE pessoas SET saiu_em = ? WHERE id = ?`, c.a.Relogio.Agora().UnixMilli(), c.carlos.ID)
	esperarErro(t, c.grupo(c.kAna, "Comercial", c.bia.ID, c.carlos.ID), 404, "naoEncontrado")
	if l := c.lista(t, c.kAna); len(l) != 0 {
		t.Fatalf("sobrou uma conversa: %+v", l)
	}
}

// extras cria n pessoas da ACME direto no banco e devolve os ids.
func extras(t *testing.T, c *cena, n int) []int64 {
	t.Helper()
	c.a.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		INSERT INTO pessoas (empresa_id, ramal, nome, nome_busca, entrou_em)
		SELECT (SELECT empresa_id FROM pessoas WHERE id = ?), 'X' || i, 'Extra ' || i, 'extra ' || i, ? FROM n`,
		n, c.ana.ID, c.a.Relogio.Agora().UnixMilli())
	rows, err := bancoDe(t, c.a).Query(`SELECT id FROM pessoas WHERE ramal LIKE 'X%' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func TestGrupo_Cheio(t *testing.T) {
	c := novaCena(t)
	ids := extras(t, c, 200)

	// 200 pessoas mais quem cria passam de 200.
	esperarErro(t, c.grupo(c.kAna, "Todos", ids...), 409, "grupoCheio")
	if l := c.lista(t, c.kAna); len(l) != 0 {
		t.Fatalf("o grupo cheio deixou %d conversas", len(l))
	}
	// 199 pessoas mais quem cria são 200: cabe, com a própria Ana na lista valendo uma vez.
	conv := c.criarGrupo(t, c.kAna, "Todos", append(ids[:199:199], c.ana.ID)...)
	if conv.Pessoas == nil || *conv.Pessoas != 200 {
		t.Fatalf("pessoas = %v", conv.Pessoas)
	}
	// Mais uma pessoa não cabe; quem já está é ignorada.
	esperarErro(t, c.pôr(c.kAna, conv.ID, ids[199]), 409, "grupoCheio")
	if r := c.pôr(c.kAna, conv.ID, ids[0]); r.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr quem já está: status %d", r.StatusCode)
	}
	// Quem sai abre uma vaga.
	if r := c.tirar(c.kAna, conv.ID, ids[0]); r.StatusCode != http.StatusNoContent {
		t.Fatalf("tirar: status %d", r.StatusCode)
	}
	if r := c.pôr(c.kAna, conv.ID, ids[199]); r.StatusCode != http.StatusNoContent {
		t.Fatalf("pôr depois da vaga: status %d", r.StatusCode)
	}
}

func TestGrupo_SoQuemCuida(t *testing.T) {
	c := novaCena(t)
	conv := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID, c.carlos.ID)

	esperarErro(t, c.pôr(c.kBia, conv.ID, c.dani.ID), 403, "proibido")
	esperarErro(t, c.tirar(c.kBia, conv.ID, c.carlos.ID), 403, "proibido")
	if got := avisosDe(t, c.a, conv.ID); len(got) != 3 {
		t.Fatalf("avisos = %v; os 403 não podem criar nenhum", got)
	}

	// Quem cuida põe e tira.
	if r := c.pôr(c.kAna, conv.ID, c.dani.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("Ana pondo: status %d", r.StatusCode)
	}
	if r := c.tirar(c.kAna, conv.ID, c.dani.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("Ana tirando: status %d", r.StatusCode)
	}
	// Qualquer um sai.
	if r := c.tirar(c.kBia, conv.ID, c.bia.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("Beatriz saindo: status %d", r.StatusCode)
	}
	want := []string{"criou:Ana Souza", "pos:Ana Souza>Beatriz", "pos:Ana Souza>Carlos",
		"pos:Ana Souza>Daniela", "tirou:Ana Souza>Daniela", "saiu:Beatriz"}
	if got := avisosDe(t, c.a, conv.ID); !slices.Equal(got, want) {
		t.Fatalf("avisos = %v; queria %v", got, want)
	}
	// Quem saiu não tem mais a conversa, nem mexe nela.
	esperarErro(t, c.pôr(c.kBia, conv.ID, c.dani.ID), 404, "naoEncontrado")
	esperarErro(t, c.tirar(c.kBia, conv.ID, c.bia.ID), 404, "naoEncontrado")
	// Tirar quem não está.
	esperarErro(t, c.tirar(c.kAna, conv.ID, c.bia.ID), 404, "naoEncontrado")
}

func TestGrupo_PassaParaOMaisAntigo(t *testing.T) {
	t.Run("empateNoMesmoMilissegundo", func(t *testing.T) {
		c := novaCena(t)
		cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)
		// O Carlos vem antes na lista, mas a Beatriz tem o menor id.
		conv := c.criarGrupo(t, c.kAna, "Comercial", c.carlos.ID, c.bia.ID)
		for _, conn := range []*websocket.Conn{cAna, cBia, cCarlos} {
			proximo(t, conn, "conversa")
		}
		if r := c.tirar(c.kAna, conv.ID, c.ana.ID); r.StatusCode != http.StatusNoContent {
			t.Fatalf("status %d", r.StatusCode)
		}
		// Quem saiu recebe conversaSaiu; os outros, a conversa com quem cuida agora.
		var id int64
		if err := json.Unmarshal(proximo(t, cAna, "conversaSaiu").Conversa, &id); err != nil || id != conv.ID {
			t.Fatalf("conversaSaiu = %d, %v", id, err)
		}
		b := conversaDo(t, proximo(t, cBia, "conversa"))
		k := conversaDo(t, proximo(t, cCarlos, "conversa"))
		if !*b.Cuida || *k.Cuida || *b.Pessoas != 2 || *k.Pessoas != 2 {
			t.Fatalf("Beatriz %+v, Carlos %+v", b, k)
		}
		if l := c.lista(t, c.kAna); len(l) != 0 {
			t.Fatalf("a Ana ainda vê %+v", l)
		}
		if l := c.lista(t, c.kBia); len(l) != 1 || !*l[0].Cuida {
			t.Fatalf("lista da Beatriz = %+v", l)
		}
	})

	t.Run("quemEntrouAntes", func(t *testing.T) {
		c := novaCena(t)
		cAna, cBia, cCarlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kCarlos)
		// O Carlos entra com o grupo; a Beatriz, 1 s depois. Ele passa a cuidar, apesar do id maior.
		conv := c.criarGrupo(t, c.kAna, "Financeiro", c.carlos.ID)
		proximo(t, cAna, "conversa")
		proximo(t, cCarlos, "conversa")
		c.a.Relogio.Avancar(time.Second)
		if r := c.pôr(c.kAna, conv.ID, c.bia.ID); r.StatusCode != http.StatusNoContent {
			t.Fatalf("pôr: status %d", r.StatusCode)
		}
		for _, conn := range []*websocket.Conn{cAna, cBia, cCarlos} {
			proximo(t, conn, "conversa")
		}
		if r := c.tirar(c.kAna, conv.ID, c.ana.ID); r.StatusCode != http.StatusNoContent {
			t.Fatalf("status %d", r.StatusCode)
		}
		proximo(t, cAna, "conversaSaiu")
		b := conversaDo(t, proximo(t, cBia, "conversa"))
		k := conversaDo(t, proximo(t, cCarlos, "conversa"))
		if *b.Cuida || !*k.Cuida {
			t.Fatalf("Beatriz cuida = %v, Carlos cuida = %v; queria o Carlos", *b.Cuida, *k.Cuida)
		}
		// A saída também aparece nos membros: o Carlos primeiro.
		resp := c.a.Pedir(c.kBia, "GET", fmt.Sprintf("/api/v1/conversas/%d/membros", conv.ID), nil)
		ms := apitest.LerJSON[struct {
			Membros []struct {
				Pessoa apitest.Pessoa `json:"pessoa"`
				Cuida  bool           `json:"cuida"`
				Criou  bool           `json:"criou"`
			}
		}](t, resp).Membros
		if len(ms) != 2 || ms[0].Pessoa.ID != c.carlos.ID || !ms[0].Cuida || ms[0].Criou || ms[1].Pessoa.ID != c.bia.ID {
			t.Fatalf("membros = %+v", ms)
		}
	})
}

func TestMembros_Lista(t *testing.T) {
	c := novaCena(t)
	conv := c.criarGrupo(t, c.kBia, "Comercial", c.carlos.ID, c.ana.ID) // a Beatriz cria e cuida
	resp := c.a.Pedir(c.kCarlos, "GET", fmt.Sprintf("/api/v1/conversas/%d/membros", conv.ID), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[map[string][]map[string]any](t, resp)
	ms := corpo["membros"]
	if len(corpo) != 1 || len(ms) != 3 {
		t.Fatalf("corpo = %v", corpo)
	}
	// Quem cuida primeiro, e o resto por nome: Ana e depois Carlos.
	nomes := []string{}
	for _, m := range ms {
		if len(m) != 3 {
			t.Fatalf("membro = %v; queria pessoa, cuida e criou", m)
		}
		nomes = append(nomes, m["pessoa"].(map[string]any)["nome"].(string))
	}
	if want := []string{"Beatriz", "Ana Souza", "Carlos"}; !slices.Equal(nomes, want) {
		t.Fatalf("nomes = %v; queria %v", nomes, want)
	}
	if ms[0]["cuida"] != true || ms[0]["criou"] != true || ms[1]["cuida"] != false || ms[1]["criou"] != false {
		t.Fatalf("membros = %v", ms)
	}

	// Numa conversa a dois, quem não está nela e um id que não existe: 404.
	d := apitest.LerJSON[struct{ Conversa conversaResp }](t, c.dupla(t, c.kAna, c.bia.ID)).Conversa
	esperarErro(t, c.a.Pedir(c.kAna, "GET", fmt.Sprintf("/api/v1/conversas/%d/membros", d.ID), nil), 404, "naoEncontrado")
	esperarErro(t, c.a.Pedir(c.kDani, "GET", fmt.Sprintf("/api/v1/conversas/%d/membros", conv.ID), nil), 404, "naoEncontrado")
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/conversas/99999/membros", nil), 404, "naoEncontrado")
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/conversas/abc/membros", nil), 404, "naoEncontrado")
	esperarErro(t, c.pôr(c.kAna, d.ID, c.carlos.ID), 404, "naoEncontrado") // não se põe ninguém numa dupla
}

func TestGrupo_PorPessoas(t *testing.T) {
	c := novaCena(t)
	cAna, cBia, cDani := c.a.Conectar(c.kAna), c.a.Conectar(c.kBia), c.a.Conectar(c.kDani)
	conv := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	proximo(t, cAna, "conversa")
	proximo(t, cBia, "conversa")

	// A Beatriz já está (ignorada); a Daniela entra e o Carlos também, na ordem da lista.
	if r := c.pôr(c.kAna, conv.ID, c.bia.ID, c.dani.ID, c.carlos.ID, c.dani.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", r.StatusCode)
	}
	want := []string{"criou:Ana Souza", "pos:Ana Souza>Beatriz", "pos:Ana Souza>Daniela", "pos:Ana Souza>Carlos"}
	if got := avisosDe(t, c.a, conv.ID); !slices.Equal(got, want) {
		t.Fatalf("avisos = %v; queria %v", got, want)
	}
	for _, conn := range []*websocket.Conn{cAna, cBia, cDani} {
		if got := conversaDo(t, proximo(t, conn, "conversa")); got.ID != conv.ID || *got.Pessoas != 4 {
			t.Fatalf("evento = %+v", got)
		}
	}
	// Ninguém novo: nada de aviso nem de evento.
	if r := c.pôr(c.kAna, conv.ID, c.bia.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", r.StatusCode)
	}
	if got := avisosDe(t, c.a, conv.ID); len(got) != 4 {
		t.Fatalf("avisos = %v", got)
	}
	apitest.SemEvento(t, cBia, 100*time.Millisecond)

	// Os erros.
	esperarErro(t, c.pôr(c.kAna, conv.ID, 99999), 404, "naoEncontrado")
	esperarErro(t, c.pôr(c.kAna, conv.ID, c.abel.ID), 404, "naoEncontrado")
	if e := esperarErro(t, c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/membros", conv.ID), map[string]any{"pessoas": []int64{}}), 400, "invalido"); e.Campo != "pessoas" {
		t.Fatalf("campo = %q", e.Campo)
	}
}

func TestGrupo_VoltaComEntradaNova(t *testing.T) {
	c := novaCena(t)
	conv := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	c.a.Relogio.Avancar(time.Second)
	antes := texto(t, c.a, conv.ID, c.ana.ID, "antes")
	c.a.Relogio.Avancar(time.Second)
	c.tirar(c.kBia, conv.ID, c.bia.ID)
	c.a.Relogio.Avancar(time.Second)
	texto(t, c.a, conv.ID, c.ana.ID, "enquanto ela estava fora")
	c.a.Relogio.Avancar(time.Second)
	if r := c.pôr(c.kAna, conv.ID, c.bia.ID); r.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", r.StatusCode)
	}
	c.a.Relogio.Avancar(time.Second)
	depois := texto(t, c.a, conv.ID, c.ana.ID, "depois")

	l := c.lista(t, c.kBia)
	if len(l) != 1 || l[0].NaoLidas != 1 || l[0].Ultima.ID != depois || *l[0].Pessoas != 2 || l[0].Ultima.ID == antes {
		t.Fatalf("lista da Beatriz = %+v", l)
	}
	if got := avisosDe(t, c.a, conv.ID); !slices.Equal(got[2:], []string{"saiu:Beatriz", "pos:Ana Souza>Beatriz"}) {
		t.Fatalf("avisos = %v", got)
	}
}

func TestConversas_Ordem(t *testing.T) {
	c := novaCena(t)
	dupla := apitest.LerJSON[struct{ Conversa conversaResp }](t, c.dupla(t, c.kAna, c.bia.ID)).Conversa
	c.a.Relogio.Avancar(time.Minute)
	grupo := c.criarGrupo(t, c.kAna, "Comercial", c.carlos.ID) // sem mensagens: vale o criada_em

	l := c.lista(t, c.kAna)
	if len(l) != 2 || l[0].ID != grupo.ID || l[1].ID != dupla.ID {
		t.Fatalf("lista = %+v; queria o grupo novo primeiro", l)
	}
	if l[0].AtualizadaEm != c.a.Relogio.Agora().UnixMilli() || l[1].AtualizadaEm >= l[0].AtualizadaEm || l[1].Ultima != nil {
		t.Fatalf("atualizadaEm = %d e %d", l[0].AtualizadaEm, l[1].AtualizadaEm)
	}

	// Uma mensagem nova na dupla leva a dupla para o alto.
	c.a.Relogio.Avancar(time.Minute)
	m := texto(t, c.a, dupla.ID, c.bia.ID, "oi")
	l = c.lista(t, c.kAna)
	if l[0].ID != dupla.ID || l[0].Ultima == nil || l[0].Ultima.ID != m || l[0].AtualizadaEm != c.a.Relogio.Agora().UnixMilli() {
		t.Fatalf("lista = %+v", l)
	}
}

func TestConversas_NaoLidas(t *testing.T) {
	c := novaCena(t)
	conv := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	c.a.Relogio.Avancar(time.Second)
	m1 := texto(t, c.a, conv.ID, c.bia.ID, "um")
	texto(t, c.a, conv.ID, c.bia.ID, "dois")
	texto(t, c.a, conv.ID, c.ana.ID, "da própria Ana")

	naoLidas := func(chave string) int {
		t.Helper()
		l := c.lista(t, chave)
		if len(l) != 1 {
			t.Fatalf("lista = %+v", l)
		}
		return l[0].NaoLidas
	}
	// Ana: só as duas da Beatriz; os avisos e a dela mesma não contam.
	if n := naoLidas(c.kAna); n != 2 {
		t.Fatalf("Ana: naoLidas = %d; queria 2", n)
	}
	// Beatriz: só a da Ana (as duas dela e os avisos não contam).
	if n := naoLidas(c.kBia); n != 1 {
		t.Fatalf("Beatriz: naoLidas = %d; queria 1", n)
	}
	// Lida até a primeira.
	c.a.Exec(`INSERT INTO leituras (pessoa_id, conversa_id, ate) VALUES (?, ?, ?)`, c.ana.ID, conv.ID, m1)
	if n := naoLidas(c.kAna); n != 1 {
		t.Fatalf("Ana depois de ler a primeira: naoLidas = %d; queria 1", n)
	}

	// O Carlos entra depois: o que veio antes não conta, e o evento traz o naoLidas dele.
	cCarlos := c.a.Conectar(c.kCarlos)
	c.a.Relogio.Avancar(time.Second)
	c.pôr(c.kAna, conv.ID, c.carlos.ID)
	if got := conversaDo(t, proximo(t, cCarlos, "conversa")); got.NaoLidas != 0 {
		t.Fatalf("evento do Carlos: naoLidas = %d; queria 0", got.NaoLidas)
	}
	c.a.Relogio.Avancar(time.Second)
	texto(t, c.a, conv.ID, c.bia.ID, "depois de o Carlos entrar")
	if n := naoLidas(c.kCarlos); n != 1 {
		t.Fatalf("Carlos: naoLidas = %d; queria 1", n)
	}
}

func TestIsolamento_Conversas(t *testing.T) {
	c := novaCena(t)
	grupoA := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	duplaA := apitest.LerJSON[struct{ Conversa conversaResp }](t, c.dupla(t, c.kAna, c.bia.ID)).Conversa

	// A Abel é da outra empresa.
	esperarErro(t, c.a.Pedir(c.kAbel, "GET", fmt.Sprintf("/api/v1/conversas/%d/membros", grupoA.ID), nil), 404, "naoEncontrado")
	esperarErro(t, c.dupla(t, c.kAbel, c.ana.ID), 404, "naoEncontrado")
	esperarErro(t, c.grupo(c.kAbel, "Espiões", c.ana.ID), 404, "naoEncontrado")
	esperarErro(t, c.tirar(c.kAbel, grupoA.ID, c.bia.ID), 404, "naoEncontrado")
	esperarErro(t, c.pôr(c.kAbel, grupoA.ID, c.carlos.ID), 404, "naoEncontrado")
	esperarErro(t, c.tirar(c.kAbel, duplaA.ID, c.abel.ID), 404, "naoEncontrado")
	if l := c.lista(t, c.kAbel); len(l) != 0 {
		t.Fatalf("a Abel vê %+v", l)
	}
	// E a Ana não põe a Abel no grupo dela.
	esperarErro(t, c.pôr(c.kAna, grupoA.ID, c.abel.ID), 404, "naoEncontrado")
	if got := avisosDe(t, c.a, grupoA.ID); len(got) != 2 {
		t.Fatalf("avisos = %v", got)
	}
}
