package servidor

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/crypto/acme/autocert"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler)) // os testes não imprimem o log
	os.Exit(m.Run())
}

func escreverConfig(t *testing.T, conteudo string) string {
	t.Helper()
	caminho := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(caminho, []byte(conteudo), 0o600); err != nil {
		t.Fatal(err)
	}
	return caminho
}

func TestConfig(t *testing.T) {
	dados := filepath.Join(t.TempDir(), "dados")

	t.Run("sem origens vale a padrão", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`}`))
		if err != nil {
			t.Fatal(err)
		}
		if c.Endereco != "chat.example.com" || c.Dados != dados {
			t.Fatalf("config %+v", c)
		}
		if len(c.Origens) != 1 || c.Origens[0] != "https://app.starsonic.local" {
			t.Fatalf("origens %v", c.Origens)
		}
	})
	t.Run("com origens", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`,"origens":["https://a.example","https://b.example"]}`))
		if err != nil {
			t.Fatal(err)
		}
		if len(c.Origens) != 2 || c.Origens[1] != "https://b.example" {
			t.Fatalf("origens %v", c.Origens)
		}
	})
	t.Run("sem porta vale a 443", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`}`))
		if err != nil {
			t.Fatal(err)
		}
		if c.Porta != 443 {
			t.Fatalf("porta %d; queria 443", c.Porta)
		}
	})
	t.Run("com porta", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`,"porta":8443}`))
		if err != nil {
			t.Fatal(err)
		}
		if c.Porta != 8443 {
			t.Fatalf("porta %d; queria 8443", c.Porta)
		}
	})
	erros := map[string]string{
		"porta zero":         `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"porta":0}`,
		"porta 80":           `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"porta":80}`,
		"porta grande":       `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"porta":70000}`,
		"porta em texto":     `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"porta":"8443"}`,
		"porta quebrada":     `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"porta":8443.5}`,
		"sem endereco":       `{"dados":` + quote(dados) + `}`,
		"endereco vazio":     `{"endereco":"  ","dados":` + quote(dados) + `}`,
		"sem dados":          `{"endereco":"chat.example.com"}`,
		"dados relativo":     `{"endereco":"chat.example.com","dados":"var/dados"}`,
		"json quebrado":      `{"endereco":`,
		"origens vazia":      `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"origens":[""]}`,
		"chave desconhecida": `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"origem":["https://a.example"]}`,
		"dois objetos":       `{"endereco":"chat.example.com","dados":` + quote(dados) + `}{"endereco":"b.example.com"}`,
		"lixo no fim":        `{"endereco":"chat.example.com","dados":` + quote(dados) + `} x`,
		"endereco com rota":  `{"endereco":"chat.example.com/x","dados":` + quote(dados) + `}`,
	}
	for nome, conteudo := range erros {
		t.Run(nome, func(t *testing.T) {
			if _, err := LerConfig(escreverConfig(t, conteudo)); err == nil {
				t.Fatal("esperava erro")
			}
		})
	}
	t.Run("a chave desconhecida é nomeada", func(t *testing.T) {
		_, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`,"origem":[]}`))
		if err == nil || !strings.Contains(err.Error(), "origem") {
			t.Fatalf("erro %v; queria um que nomeie a chave origem", err)
		}
	})
	t.Run("arquivo que não existe", func(t *testing.T) {
		if _, err := LerConfig(filepath.Join(t.TempDir(), "nada.json")); err == nil {
			t.Fatal("esperava erro")
		}
	})
}

func quote(s string) string { b, _ := json.Marshal(s); return string(b) }

func TestHostPolicy(t *testing.T) {
	m := gerenciador(Config{Endereco: "chat.example.com", Dados: "/var/lib/x"})
	if err := m.HostPolicy(context.Background(), "chat.example.com"); err != nil {
		t.Fatalf("o endereço da configuração foi recusado: %v", err)
	}
	if err := m.HostPolicy(context.Background(), "outro.example"); err == nil {
		t.Fatal("outro.example foi aceito")
	}
	dados := "/var/lib/x"
	if got, quer := m.Cache, autocert.DirCache(filepath.Join(dados, "certificados")); got != quer {
		t.Fatalf("cache %v; queria %v", got, quer)
	}
	if m.Prompt == nil {
		t.Fatal("o autocert precisa aceitar os termos (Prompt)")
	}
}

func TestModoTeste_SoLocal(t *testing.T) {
	for _, escutar := range []string{"0.0.0.0:8090", "192.168.0.5:80", "localhost:8090", "127.0.0.2:8090", ":8090", "[::]:8090", "127.0.0.1"} {
		err := RodarTeste(t.Context(), Config{Dados: t.TempDir()}, escutar)
		if err == nil || err.Error() != "o modo de teste só escuta em 127.0.0.1 ou [::1]" {
			t.Fatalf("%q: erro %v", escutar, err)
		}
		if err != ErroModoTeste {
			t.Fatalf("%q: não é o ErroModoTeste", escutar)
		}
	}
}

// Prepara uma pasta de dados com uma empresa e devolve o código dela.
func preparar(t *testing.T) (dados, codigo string) {
	t.Helper()
	dados = t.TempDir()
	b, err := banco.Abrir(filepath.Join(dados, banco.NomeArquivo), tempo.Real())
	if err != nil {
		t.Fatal(err)
	}
	e, err := b.CriarEmpresa(t.Context(), "ACME Comércio Ltda")
	if err != nil {
		t.Fatal(err)
	}
	if err := b.Fechar(); err != nil {
		t.Fatal(err)
	}
	return dados, e.Codigo
}

// ligado é um servidor de teste de verdade, num 127.0.0.1:0.
type ligado struct {
	url    string
	cancel context.CancelFunc
	fim    chan error
}

func iniciar(t *testing.T, dados string) *ligado {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	s := &ligado{url: "http://" + l.Addr().String(), cancel: cancel, fim: make(chan error, 1)}
	go func() { s.fim <- servirTeste(ctx, Config{Dados: dados}, l) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-s.fim:
		case <-time.After(15 * time.Second):
			t.Error("o servidor não parou")
		}
	})
	return s
}

func (s *ligado) parar(t *testing.T) time.Duration {
	t.Helper()
	inicio := time.Now()
	s.cancel()
	select {
	case err := <-s.fim:
		if err != nil {
			t.Fatalf("o desligamento deu erro: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("o servidor não parou em 15 s")
	}
	s.fim <- nil // para o Cleanup
	return time.Since(inicio)
}

func pedir(t *testing.T, metodo, alvo, chave string, corpo any) *http.Response {
	t.Helper()
	var dados []byte
	if corpo != nil {
		dados, _ = json.Marshal(corpo)
	}
	req, err := http.NewRequestWithContext(t.Context(), metodo, alvo, bytes.NewReader(dados))
	if err != nil {
		t.Fatal(err)
	}
	if dados != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if chave != "" {
		req.Header.Set("Authorization", "Bearer "+chave)
	}
	cliente := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := cliente.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", metodo, alvo, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// ligar liga um computador e uma pessoa pela API, e devolve a chave.
func (s *ligado) ligar(t *testing.T, codigo string) string {
	t.Helper()
	resp := pedir(t, "POST", s.url+"/api/v1/computadores", "", map[string]string{"codigo": codigo, "computador": "RECEPCAO-01"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("ligar respondeu %d", resp.StatusCode)
	}
	var v struct{ Chave string }
	v.Chave = lerCampo(t, resp, "chave")
	resp = pedir(t, "POST", s.url+"/api/v1/pessoas/eu", v.Chave, map[string]string{"ramal": "2003", "nome": "Ana Souza"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("entrar respondeu %d", resp.StatusCode)
	}
	return v.Chave
}

func lerCampo(t *testing.T, resp *http.Response, campo string) string {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	s, _ := m[campo].(string)
	return s
}

func TestModoTeste_Responde(t *testing.T) {
	dados, codigo := preparar(t)
	s := iniciar(t, dados)

	resp := pedir(t, "POST", s.url+"/api/v1/computadores", "", map[string]string{"codigo": codigo, "computador": "RECEPCAO-01"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /api/v1/computadores respondeu %d", resp.StatusCode)
	}
	resp = pedir(t, "GET", s.url+"/admin/entrar", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/entrar respondeu %d", resp.StatusCode)
	}
	// A raiz leva para a página de administração.
	resp = pedir(t, "GET", s.url+"/", "", nil)
	if resp.StatusCode != http.StatusSeeOther && resp.StatusCode != http.StatusFound && resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("GET / respondeu %d", resp.StatusCode)
	}
	if l := resp.Header.Get("Location"); l != "/admin/" {
		t.Fatalf("GET / foi para %q", l)
	}
	// Outro caminho não existe.
	if resp = pedir(t, "GET", s.url+"/outra", "", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET /outra respondeu %d", resp.StatusCode)
	}
	// Em HTTP, o cookie da página não leva o Secure (o modo de teste não tem TLS).
	resp = pedir(t, "GET", s.url+"/admin/entrar", "", nil)
	for _, c := range resp.Cookies() {
		if c.Secure {
			t.Fatalf("o cookie %s leva Secure no modo de teste", c.Name)
		}
	}
}

func TestDesligarComCalma(t *testing.T) {
	dados, codigo := preparar(t)
	s := iniciar(t, dados)

	var conexoes []*websocket.Conn
	for i := 0; i < 2; i++ {
		chave := s.ligar(t, codigo)
		resp := pedir(t, "POST", s.url+"/api/v1/eventos/bilhete", chave, nil)
		bilhete := lerCampo(t, resp, "bilhete")
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.url, "http")+"/api/v1/eventos?bilhete="+url.QueryEscape(bilhete), nil)
		cancel()
		if err != nil {
			t.Fatalf("Dial: %v", err)
		}
		t.Cleanup(func() { conn.CloseNow() })
		conexoes = append(conexoes, conn)
	}
	codigos := make(chan websocket.StatusCode, len(conexoes))
	for _, c := range conexoes {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			for {
				if _, _, err := c.Read(ctx); err != nil {
					codigos <- websocket.CloseStatus(err)
					return
				}
			}
		}()
	}

	if d := s.parar(t); d >= 10*time.Second {
		t.Fatalf("o servidor levou %v para fechar", d)
	}
	for range conexoes {
		select {
		case c := <-codigos:
			if c != websocket.StatusGoingAway {
				t.Fatalf("a conexão fechou com %d; queria 1001", c)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("uma conexão não recebeu o fechamento")
		}
	}
	// A porta fechou.
	if _, err := net.DialTimeout("tcp", strings.TrimPrefix(s.url, "http://"), time.Second); err == nil {
		t.Fatal("a porta continua aberta")
	}
	// O banco foi fechado: sem nenhuma outra conexão aberta, o SQLite junta o -wal ao arquivo
	// e o apaga ao fechar a última.
	if _, err := os.Stat(filepath.Join(dados, banco.NomeArquivo+"-wal")); !os.IsNotExist(err) {
		t.Fatalf("o chat.db-wal continua lá depois do desligamento (o banco não fechou?): %v", err)
	}
}

// encurtarPrazos troca os prazos por estes e os devolve no fim do teste, depois de o servidor
// parar (os Cleanup rodam do último para o primeiro).
func encurtarPrazos(t *testing.T, arquivos, geral time.Duration) {
	t.Helper()
	a, g := prazoArquivos, prazoGeral
	prazoArquivos, prazoGeral = arquivos, geral
	t.Cleanup(func() { prazoArquivos, prazoGeral = a, g })
}

func TestPrazos_Arquivos(t *testing.T) {
	encurtarPrazos(t, 400*time.Millisecond, time.Hour)
	dados, codigo := preparar(t)
	s := iniciar(t, dados)
	chave := s.ligar(t, codigo)

	// Um envio cujo corpo para no meio (sem Content-Length) acaba dentro do prazo: o servidor
	// responde e fecha a conexão, em vez de esperar o resto para sempre.
	conn, err := net.Dial("tcp", strings.TrimPrefix(s.url, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	inicio := time.Now()
	io.WriteString(conn, "POST /api/v1/arquivos HTTP/1.1\r\nHost: chat\r\nAuthorization: Bearer "+chave+
		"\r\nContent-Type: text/plain\r\nX-Arquivo-Nome: nota.txt\r\nTransfer-Encoding: chunked\r\n\r\n"+
		"5\r\nhello\r\n")
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadAll(conn); err != nil { // lê até o servidor fechar
		t.Fatalf("o envio parado não acabou no prazo: %v", err)
	}
	if d := time.Since(inicio); d < 300*time.Millisecond || d > 3*time.Second {
		t.Fatalf("o envio parado acabou em %v; queria perto de 400 ms", d)
	}
}

// Guarda do comportamento do Go (R34): o Hijack zera os prazos da conexão, então o WebSocket,
// que passa pelo prazo geral como toda rota, continua aberto depois dele. Se um Go futuro
// mantiver o prazo depois do Hijack, este teste falha.
func TestPrazos_WebSocketSobreviveAoPrazo(t *testing.T) {
	encurtarPrazos(t, 300*time.Millisecond, 300*time.Millisecond)
	dados, codigo := preparar(t)
	s := iniciar(t, dados)
	chave := s.ligar(t, codigo)

	bilhete := lerCampo(t, pedir(t, "POST", s.url+"/api/v1/eventos/bilhete", chave, nil), "bilhete")
	conn, _, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(s.url, "http")+"/api/v1/eventos?bilhete="+url.QueryEscape(bilhete), nil)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	ctx := conn.CloseRead(t.Context())

	time.Sleep(1200 * time.Millisecond) // quatro vezes o prazo
	pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := conn.Ping(pctx); err != nil {
		t.Fatalf("a conexão caiu depois do prazo: %v", err)
	}
}

// Montagem de produção, sobre um banco numa pasta temporária.
func depsDeTeste(t *testing.T) Deps {
	t.Helper()
	dir := t.TempDir()
	b, err := banco.Abrir(filepath.Join(dir, banco.NomeArquivo), tempo.Real())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Fechar() })
	a, err := armazem.Novo(filepath.Join(dir, "arquivos"))
	if err != nil {
		t.Fatal(err)
	}
	return Deps{Banco: b, Hub: eventos.NovoHub(eventos.Config{}), Armazem: a}
}

func TestHSTS(t *testing.T) {
	srv := httptest.NewTLSServer(producao(Montar(depsDeTeste(t))))
	defer srv.Close()
	cliente := srv.Client()
	cliente.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for _, caminho := range []string{"/", "/admin/entrar", "/api/v1/computadores", "/nada"} {
		resp, err := cliente.Get(srv.URL + caminho)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if got := resp.Header.Get("Strict-Transport-Security"); got != "max-age=31536000" {
			t.Fatalf("%s: Strict-Transport-Security %q", caminho, got)
		}
	}
}

func TestHTTPParaHTTPS(t *testing.T) {
	m := gerenciador(Config{Endereco: "chat.example.com", Dados: t.TempDir()})
	h := redirecionador(m, "chat.example.com")

	req := httptest.NewRequest("GET", "http://qualquer.example/admin/entrar?x=1&y=a%20b", nil)
	req.Host = "qualquer.example" // o Host do pedido não conta
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("respondeu %d; queria 301", rec.Code)
	}
	if l := rec.Header().Get("Location"); l != "https://chat.example.com/admin/entrar?x=1&y=a%20b" {
		t.Fatalf("Location %q", l)
	}

	req = httptest.NewRequest("POST", "http://chat.example.com/", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "https://chat.example.com/" {
		t.Fatalf("raiz: %d %q", rec.Code, rec.Header().Get("Location"))
	}

	// O desafio do certificado passa: não é redirecionado.
	req = httptest.NewRequest("GET", "http://chat.example.com/.well-known/acme-challenge/token-que-nao-existe", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusMovedPermanently || rec.Header().Get("Location") != "" {
		t.Fatalf("o desafio foi redirecionado: %d %q", rec.Code, rec.Header().Get("Location"))
	}
}

// Atrás de um roteador que traduz outra porta pública para a 443 (NAT), a porta 80 leva para
// essa porta, e não para a 443, que pode ser de outro servidor. A 443 não aparece no endereço.
func TestHTTPParaHTTPS_Porta(t *testing.T) {
	casos := []struct {
		porta   int
		destino string
	}{
		{8443, "https://chat.example.com:8443/admin/entrar?x=1"},
		{443, "https://chat.example.com/admin/entrar?x=1"},
		{0, "https://chat.example.com/admin/entrar?x=1"},
	}
	for _, c := range casos {
		_, http80 := servidoresProducao(Config{Endereco: "chat.example.com", Dados: t.TempDir(), Porta: c.porta}, http.NotFoundHandler())
		rec := httptest.NewRecorder()
		http80.Handler.ServeHTTP(rec, httptest.NewRequest("GET", "http://chat.example.com/admin/entrar?x=1", nil))
		if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != c.destino {
			t.Fatalf("porta %d: %d %q; queria 301 para %q", c.porta, rec.Code, rec.Header().Get("Location"), c.destino)
		}
	}
}

// escritorDePrazos é um ResponseWriter que anota os prazos pedidos pelo ResponseController.
type escritorDePrazos struct {
	http.ResponseWriter
	leitura, escrita time.Time
}

func (e *escritorDePrazos) SetReadDeadline(t time.Time) error  { e.leitura = t; return nil }
func (e *escritorDePrazos) SetWriteDeadline(t time.Time) error { e.escrita = t; return nil }

func TestPrazos_Classes(t *testing.T) {
	casos := []struct {
		metodo, caminho string
		quer            time.Duration
	}{
		{"POST", "/api/v1/arquivos", 5 * time.Minute},
		{"GET", "/api/v1/arquivos/x", 5 * time.Minute},
		{"PUT", "/api/v1/arquivos/x/miniatura", 5 * time.Minute},
		{"GET", "/api/v1/arquivosX", time.Minute},
		{"GET", "/api/v1/eventos", time.Minute}, // R34: sem isenção
		{"POST", "/api/v1/eventos/bilhete", time.Minute},
		{"GET", "/api/v1/conversas", time.Minute},
		{"GET", "/admin/", time.Minute},
		{"GET", "/", time.Minute},
	}
	h := comPrazos(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	for _, c := range casos {
		w := &escritorDePrazos{ResponseWriter: httptest.NewRecorder()}
		antes := time.Now()
		h.ServeHTTP(w, httptest.NewRequest(c.metodo, c.caminho, nil))
		for nome, got := range map[string]time.Time{"leitura": w.leitura, "escrita": w.escrita} {
			if d := got.Sub(antes); d < c.quer || d > c.quer+5*time.Second {
				t.Errorf("%s %s: prazo de %s em %v; queria %v", c.metodo, c.caminho, nome, d, c.quer)
			}
		}
	}
}

// O servidor da porta 80 tem prazo de leitura e de escrita: um corpo parado não o prende.
func TestPrazos_PortaOitenta(t *testing.T) {
	encurtarPrazos(t, time.Hour, 400*time.Millisecond)
	_, http80 := servidoresProducao(Config{Endereco: "chat.example.com", Dados: t.TempDir()}, http.NotFoundHandler())
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go http80.Serve(l)
	t.Cleanup(func() { http80.Close() })

	conn, err := net.Dial("tcp", l.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	inicio := time.Now()
	io.WriteString(conn, "POST /x HTTP/1.1\r\nHost: chat.example.com\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n")
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadAll(conn); err != nil {
		t.Fatalf("o corpo parado prendeu a porta 80: %v", err)
	}
	if d := time.Since(inicio); d < 300*time.Millisecond || d > 3*time.Second {
		t.Fatalf("acabou em %v; queria perto de 400 ms", d)
	}
}

func TestServidoresProducao(t *testing.T) {
	dados := t.TempDir()
	c := Config{Endereco: "chat.example.com", Dados: dados}
	https, http80 := servidoresProducao(c, http.NotFoundHandler())
	if https.Addr != ":443" || http80.Addr != ":80" {
		t.Fatalf("endereços %q e %q", https.Addr, http80.Addr)
	}
	cfg := https.TLSConfig
	if cfg == nil || cfg.MinVersion != tls.VersionTLS12 || cfg.GetCertificate == nil {
		t.Fatalf("TLS %+v", cfg)
	}
	if !slices.Contains(cfg.NextProtos, "acme-tls/1") {
		t.Fatalf("NextProtos %v sem acme-tls/1", cfg.NextProtos)
	}
	if https.ReadHeaderTimeout != 10*time.Second || https.IdleTimeout != 120*time.Second {
		t.Fatalf("443: ReadHeaderTimeout %v, IdleTimeout %v", https.ReadHeaderTimeout, https.IdleTimeout)
	}
	if https.WriteTimeout != 0 || https.ReadTimeout != 0 {
		t.Fatalf("443 tem prazo global: %v e %v", https.ReadTimeout, https.WriteTimeout)
	}
	if http80.ReadTimeout != prazoGeral || http80.WriteTimeout != prazoGeral {
		t.Fatalf("80: ReadTimeout %v, WriteTimeout %v; queria %v", http80.ReadTimeout, http80.WriteTimeout, prazoGeral)
	}
	if http80.ReadHeaderTimeout != 10*time.Second {
		t.Fatalf("80: ReadHeaderTimeout %v", http80.ReadHeaderTimeout)
	}
}

// O destino do redirecionamento é sempre o Endereco, mesmo com um alvo que o Go lê como
// "esquema:opaco".
func TestHTTPParaHTTPS_AlvoEsquisito(t *testing.T) {
	srv := httptest.NewServer(redirecionador(gerenciador(Config{Endereco: "chat.example.com", Dados: t.TempDir()}), "chat.example.com"))
	defer srv.Close()
	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	io.WriteString(conn, "GET a:@evil.example/x HTTP/1.1\r\nHost: chat.example.com\r\nConnection: close\r\n\r\n")
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	loc, err := resp.Location()
	if err != nil {
		t.Fatalf("status %d, sem Location: %v", resp.StatusCode, err)
	}
	if loc.Host != "chat.example.com" || loc.User != nil || loc.Scheme != "https" {
		t.Fatalf("Location %q", loc)
	}
}

func TestRodarTeste_FechaAPortaSeFalhaCedo(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endereco := l.Addr().String()
	l.Close()
	arquivo := filepath.Join(t.TempDir(), "arquivo")
	if err := os.WriteFile(arquivo, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	// A pasta de dados é um arquivo: o banco não abre, e o RodarTeste falha depois de escutar.
	if err := RodarTeste(t.Context(), Config{Dados: arquivo}, endereco); err == nil {
		t.Fatal("esperava erro")
	}
	l2, err := net.Listen("tcp", endereco)
	if err != nil {
		t.Fatalf("a porta continua presa: %v", err)
	}
	l2.Close()
}

func TestEscutarTodos(t *testing.T) {
	livre, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endereco := livre.Addr().String()
	livre.Close()
	ocupado, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ocupado.Close()

	// O segundo falha: o primeiro fecha, e o erro volta.
	if _, err := escutarTodos(endereco, ocupado.Addr().String()); err == nil {
		t.Fatal("esperava erro")
	}
	l, err := net.Listen("tcp", endereco)
	if err != nil {
		t.Fatalf("o primeiro ficou aberto: %v", err)
	}
	l.Close()

	ls, err := escutarTodos(endereco, "127.0.0.1:0")
	if err != nil || len(ls) != 2 {
		t.Fatalf("%v %v", ls, err)
	}
	for _, l := range ls {
		l.Close()
	}
}

// capturar troca o log por um que escreve no buffer, até o fim do teste.
func capturar(t *testing.T) *syncBuffer {
	t.Helper()
	b := &syncBuffer{}
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(b, nil)))
	t.Cleanup(func() { slog.SetDefault(antigo) })
	return b
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func TestLogDaPagina(t *testing.T) {
	h := Montar(depsDeTeste(t))
	log := capturar(t)

	// A entrada leva o usuário, a senha e o csrf num formulário.
	form := url.Values{"usuario": {"ana.souza"}, "senha": {"senha-de-teste-123"}, "csrf": {"csrf-de-teste-xyz"}}
	req := httptest.NewRequest("POST", "/admin/entrar?segredo=consulta-de-teste", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	h.ServeHTTP(httptest.NewRecorder(), req)

	saida := log.String()
	if n := strings.Count(saida, "msg=pedido"); n != 1 {
		t.Fatalf("%d linhas de pedido; queria 1:\n%s", n, saida)
	}
	for _, proibido := range []string{"senha-de-teste-123", "ana.souza", "csrf-de-teste-xyz", "consulta-de-teste", "segredo", "/admin/entrar?"} {
		if strings.Contains(saida, proibido) {
			t.Fatalf("o log tem %q:\n%s", proibido, saida)
		}
	}
	for _, campo := range []string{"metodo=POST", "rota=", "status=", "ms="} {
		if !strings.Contains(saida, campo) {
			t.Fatalf("falta %s no log:\n%s", campo, saida)
		}
	}
	linha := strings.TrimSpace(saida)
	for _, extra := range []string{"usuario", "query", "corpo", "caminho"} {
		if strings.Contains(linha, extra+"=") {
			t.Fatalf("campo a mais %s:\n%s", extra, linha)
		}
	}

	// Um pedido da API dá uma linha só, não duas.
	log2 := capturar(t)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/v1/computadores", strings.NewReader("{}")))
	if n := strings.Count(log2.String(), "msg=pedido"); n != 1 {
		t.Fatalf("a API deu %d linhas; queria 1:\n%s", n, log2.String())
	}
}

func TestModoTeste_SemHSTS(t *testing.T) {
	dados, _ := preparar(t)
	s := iniciar(t, dados)
	for _, caminho := range []string{"/", "/admin/entrar", "/api/v1/computadores"} {
		resp := pedir(t, "GET", s.url+caminho, "", nil)
		if got := resp.Header.Get("Strict-Transport-Security"); got != "" {
			t.Fatalf("%s: o modo de teste mandou Strict-Transport-Security %q", caminho, got)
		}
	}
}
