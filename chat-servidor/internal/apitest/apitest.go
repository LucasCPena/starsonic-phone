// Package apitest é o ambiente de teste da API: uma pasta temporária, o banco, o relógio
// de teste, o hub dos eventos e um servidor HTTP de verdade. Só os testes usam.
package apitest

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// Ambiente é um servidor de teste inteiro.
type Ambiente struct {
	T        testing.TB
	Dir      string
	Caminho  string // o arquivo do banco
	Banco    *banco.Banco
	Relogio  *tempo.Teste
	Hub      *eventos.Hub // com a Config padrão
	Servidor *httptest.Server
}

// Pessoa é a pessoa como a API devolve (seção 4 do protocolo).
type Pessoa struct {
	ID    int64  `json:"id"`
	Ramal string `json:"ramal"`
	Nome  string `json:"nome"`
	Saiu  bool   `json:"saiu"`
}

// Novo monta o ambiente; o t.Cleanup desmonta.
func Novo(t *testing.T) *Ambiente {
	t.Helper()
	slog.SetDefault(slog.New(slog.DiscardHandler)) // os testes não imprimem o log de pedidos
	dir := t.TempDir()
	rel := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	caminho := filepath.Join(dir, "chat.db")
	b, err := banco.Abrir(caminho, rel)
	if err != nil {
		t.Fatalf("apitest: abrir o banco: %v", err)
	}
	hub := eventos.NovoHub(eventos.Config{})
	srv := httptest.NewServer(api.Novo(api.Deps{Banco: b, Hub: hub}))
	t.Cleanup(func() {
		srv.Close()
		b.Fechar()
	})
	return &Ambiente{T: t, Dir: dir, Caminho: caminho, Banco: b, Relogio: rel, Hub: hub, Servidor: srv}
}

// Com devolve uma cópia ligada ao t (um subteste, por exemplo), com o mesmo servidor,
// banco e relógio. Os métodos chamam o Fatalf do t que o Ambiente guarda, e só o
// teste dono da goroutine pode chamá-lo: dentro de t.Run, use a.Com(t).
func (a *Ambiente) Com(t testing.TB) *Ambiente {
	c := *a
	c.T = t
	return &c
}

// Empresa cria uma empresa direto no banco.
func (a *Ambiente) Empresa(nome string) banco.Empresa {
	a.T.Helper()
	e, err := a.Banco.CriarEmpresa(a.T.Context(), nome)
	if err != nil {
		a.T.Fatalf("apitest: criar empresa: %v", err)
	}
	return e
}

// Ligar liga um computador pela API e devolve a chave. Falha o teste se não for 201.
func (a *Ambiente) Ligar(codigo, computador string) string {
	a.T.Helper()
	resp := a.Pedir("", "POST", "/api/v1/computadores", map[string]string{"codigo": codigo, "computador": computador})
	if resp.StatusCode != http.StatusCreated {
		a.T.Fatalf("apitest: ligar respondeu %d", resp.StatusCode)
	}
	return LerJSON[struct {
		Chave string `json:"chave"`
	}](a.T, resp).Chave
}

// Entrar faz o computador da chave agir como a pessoa (POST /api/v1/pessoas/eu). Falha o
// teste se não for 200.
func (a *Ambiente) Entrar(chave, ramal, nome string) Pessoa {
	a.T.Helper()
	resp := a.Pedir(chave, "POST", "/api/v1/pessoas/eu", map[string]string{"ramal": ramal, "nome": nome})
	if resp.StatusCode != http.StatusOK {
		a.T.Fatalf("apitest: entrar respondeu %d", resp.StatusCode)
	}
	return LerJSON[struct {
		Pessoa Pessoa `json:"pessoa"`
	}](a.T, resp).Pessoa
}

// Bilhete pede um bilhete do WebSocket para o computador da chave. Falha o teste se não
// for 200.
func (a *Ambiente) Bilhete(chave string) string {
	a.T.Helper()
	resp := a.Pedir(chave, "POST", "/api/v1/eventos/bilhete", nil)
	if resp.StatusCode != http.StatusOK {
		a.T.Fatalf("apitest: bilhete respondeu %d", resp.StatusCode)
	}
	return LerJSON[struct {
		Bilhete string `json:"bilhete"`
	}](a.T, resp).Bilhete
}

// Discar abre o WebSocket com o bilhete, com o cabeçalho Origin se a origem não for vazia.
// Sem o 101, o resp traz o status e o começo do corpo. A conexão que abrir fecha no fim
// do teste. Não chama o Fatalf: pode rodar em outras goroutines.
func (a *Ambiente) Discar(bilhete, origem string) (*websocket.Conn, *http.Response, error) {
	cab := http.Header{}
	if origem != "" {
		cab.Set("Origin", origem)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, a.Servidor.URL+"/api/v1/eventos?bilhete="+url.QueryEscape(bilhete),
		&websocket.DialOptions{HTTPClient: a.Servidor.Client(), HTTPHeader: cab})
	if conn != nil {
		a.T.Cleanup(func() { conn.CloseNow() })
	}
	return conn, resp, err
}

// Conectar pede um bilhete e abre o WebSocket do computador da chave. Quando ele volta, o
// computador já está no hub, com a pessoa da vez: o servidor só responde o 101 depois.
func (a *Ambiente) Conectar(chave string) *websocket.Conn {
	a.T.Helper()
	conn, resp, err := a.Discar(a.Bilhete(chave), "")
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		a.T.Fatalf("apitest: conectar (status %d): %v", status, err)
	}
	return conn
}

// LerEvento lê o próximo evento da conexão, em JSON, como T. Falha o teste se nada chegar
// em 5 s.
func LerEvento[T any](t testing.TB, c *websocket.Conn) T {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tipo, dados, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("apitest: ler evento: %v", err)
	}
	if tipo != websocket.MessageText {
		t.Fatalf("apitest: evento %v; queria texto", tipo)
	}
	var v T
	if err := json.Unmarshal(dados, &v); err != nil {
		t.Fatalf("apitest: evento %s: %v", dados, err)
	}
	return v
}

// SemEvento confere que nada chega pela conexão em d. Depois disso ela fica fechada: o
// coder/websocket fecha a conexão quando o prazo de uma leitura acaba.
func SemEvento(t testing.TB, c *websocket.Conn, d time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	_, dados, err := c.Read(ctx)
	if err == nil {
		t.Fatalf("apitest: chegou %s; não queria nada", dados)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("apitest: a conexão fechou, em vez de ficar quieta: %v", err)
	}
}

// Fechamento lê até a conexão fechar, pulando os eventos, e devolve o código do
// fechamento (-1 se ela caiu sem um). Falha o teste se ela não fechar em 5 s.
func Fechamento(t testing.TB, c *websocket.Conn) websocket.StatusCode {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("apitest: a conexão não fechou em 5 s")
			}
			return websocket.CloseStatus(err)
		}
	}
}

// Exec roda um comando direto no arquivo do banco, por outra conexão, para pôr o banco num
// estado que a API ainda não cria (uma pessoa que saiu, por exemplo).
func (a *Ambiente) Exec(q string, args ...any) {
	a.T.Helper()
	db, err := sql.Open("sqlite", "file:"+a.Caminho+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		a.T.Fatalf("apitest: abrir o banco: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(q, args...); err != nil {
		a.T.Fatalf("apitest: %s: %v", q, err)
	}
}

// Pedir faz um pedido à API. A chave vazia não manda Authorization. O corpo nil não manda
// corpo; []byte e string vão como estão; o resto vira JSON.
func (a *Ambiente) Pedir(chave, metodo, caminho string, corpo any) *http.Response {
	a.T.Helper()
	var dados []byte
	switch c := corpo.(type) {
	case nil:
	case []byte:
		dados = c
	case string:
		dados = []byte(c)
	default:
		var err error
		if dados, err = json.Marshal(c); err != nil {
			a.T.Fatalf("apitest: corpo: %v", err)
		}
	}
	req, err := http.NewRequestWithContext(a.T.Context(), metodo, a.Servidor.URL+caminho, bytes.NewReader(dados))
	if err != nil {
		a.T.Fatalf("apitest: pedido: %v", err)
	}
	if dados != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if chave != "" {
		req.Header.Set("Authorization", "Bearer "+chave)
	}
	resp, err := a.Servidor.Client().Do(req)
	if err != nil {
		a.T.Fatalf("apitest: %s %s: %v", metodo, caminho, err)
	}
	a.T.Cleanup(func() { resp.Body.Close() })
	return resp
}

// LerJSON lê o corpo da resposta como T.
func LerJSON[T any](t testing.TB, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("apitest: ler o JSON da resposta: %v", err)
	}
	return v
}
