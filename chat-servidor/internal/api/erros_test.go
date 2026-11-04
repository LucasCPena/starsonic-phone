package api_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// registroLog guarda as linhas do log com o nível e os atributos, para o teste conferir.
type registroLog struct {
	mu     sync.Mutex
	linhas []slog.Record
}

func (r *registroLog) Enabled(context.Context, slog.Level) bool { return true }
func (r *registroLog) Handle(_ context.Context, rec slog.Record) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.linhas = append(r.linhas, rec.Clone())
	return nil
}
func (r *registroLog) WithAttrs([]slog.Attr) slog.Handler { return r }
func (r *registroLog) WithGroup(string) slog.Handler      { return r }

// erros devolve as linhas de nível Error, cada uma como "mensagem erro=<texto>".
func (r *registroLog) erros() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, rec := range r.linhas {
		if rec.Level < slog.LevelError {
			continue
		}
		s := rec.Message
		rec.Attrs(func(a slog.Attr) bool {
			s += " " + a.Key + "=" + a.Value.String()
			return true
		})
		out = append(out, s)
	}
	return out
}

// capturarLog troca o log padrão por um registro, até o fim do teste. Vem depois do
// apitest.Novo, que o silencia.
func capturarLog(t *testing.T) *registroLog {
	t.Helper()
	antes := slog.Default()
	r := &registroLog{}
	slog.SetDefault(slog.New(r))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return r
}

func TestErroServidor_RegistraACausa(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(acme.Codigo, "PC-ANA")
	a.Entrar(chave, "2003", "Ana Souza")

	log := capturarLog(t)
	a.Banco.Fechar() // o banco quebra por baixo da API
	resp := a.Pedir(chave, "GET", "/api/v1/pessoas", nil)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status %d; queria 500", resp.StatusCode)
	}
	erros := log.erros()
	if len(erros) != 1 {
		t.Fatalf("linhas de Error = %q; queria exatamente uma", erros)
	}
	if !strings.Contains(erros[0], "closed") {
		t.Fatalf("a linha não diz a causa: %q", erros[0])
	}
	if strings.Contains(erros[0], chave) {
		t.Fatalf("a linha leva a chave: %q", erros[0])
	}
}

func TestErroServidor_PedidoCanceladoNaoRegistraError(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(acme.Codigo, "PC-ANA")
	a.Entrar(chave, "2003", "Ana Souza")
	h := api.Novo(api.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem})

	log := capturarLog(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // o cliente foi embora
	req := httptest.NewRequestWithContext(ctx, "GET", "/api/v1/pessoas", nil)
	req.Header.Set("Authorization", "Bearer "+chave)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d; queria 500 (o pedido cancelado falha no banco)", rec.Code)
	}
	if erros := log.erros(); len(erros) != 0 {
		t.Fatalf("o pedido cancelado registrou Error: %q", erros)
	}
}

func TestJSON_Nosniff(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(acme.Codigo, "PC-ANA")
	a.Entrar(chave, "2003", "Ana Souza")

	respostas := map[string]*http.Response{
		"200 pessoas":   a.Pedir(chave, "GET", "/api/v1/pessoas", nil),
		"401 sem chave": a.Pedir("", "GET", "/api/v1/pessoas", nil),
		"404 rota":      a.Pedir(chave, "GET", "/api/v1/nada", nil),
		"404 código":    a.Pedir("", "POST", "/api/v1/computadores", map[string]string{"codigo": "XXXX-XXXX", "computador": "PC-X"}),
	}
	for nome, resp := range respostas {
		if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q; queria nosniff", nome, got)
		}
	}
}
