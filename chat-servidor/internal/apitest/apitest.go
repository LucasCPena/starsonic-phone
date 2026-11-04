// Package apitest é o ambiente de teste da API: uma pasta temporária, o banco, o relógio
// de teste e um servidor HTTP de verdade. Só os testes usam.
package apitest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// Ambiente é um servidor de teste inteiro.
type Ambiente struct {
	T        *testing.T
	Dir      string
	Caminho  string // o arquivo do banco
	Banco    *banco.Banco
	Relogio  *tempo.Teste
	Servidor *httptest.Server
}

// Novo monta o ambiente; o t.Cleanup desmonta.
func Novo(t *testing.T) *Ambiente {
	t.Helper()
	dir := t.TempDir()
	rel := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	caminho := filepath.Join(dir, "chat.db")
	b, err := banco.Abrir(caminho, rel)
	if err != nil {
		t.Fatalf("apitest: abrir o banco: %v", err)
	}
	srv := httptest.NewServer(api.Novo(api.Deps{Banco: b}))
	t.Cleanup(func() {
		srv.Close()
		b.Fechar()
	})
	return &Ambiente{T: t, Dir: dir, Caminho: caminho, Banco: b, Relogio: rel, Servidor: srv}
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
func LerJSON[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("apitest: ler o JSON da resposta: %v", err)
	}
	return v
}
