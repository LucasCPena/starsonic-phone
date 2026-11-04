package api_test

import (
	"crypto/sha256"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	_ "modernc.org/sqlite"
)

type erroResp struct {
	Erro            string `json:"erro"`
	Campo           string `json:"campo"`
	EsperarSegundos int    `json:"esperarSegundos"`
}

type ligarResp struct {
	Chave   string `json:"chave"`
	Empresa struct {
		Nome string `json:"nome"`
	} `json:"empresa"`
}

func ligar(a *apitest.Ambiente, codigo, nome string) *http.Response {
	return a.Pedir("", "POST", "/api/v1/computadores", map[string]string{"codigo": codigo, "computador": nome})
}

func esperarErro(t *testing.T, resp *http.Response, status int, erro string) erroResp {
	t.Helper()
	if resp.StatusCode != status {
		t.Fatalf("status = %d; queria %d", resp.StatusCode, status)
	}
	e := apitest.LerJSON[erroResp](t, resp)
	if e.Erro != erro {
		t.Fatalf("erro = %q; queria %q", e.Erro, erro)
	}
	return e
}

func TestLigar_Certo(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	resp := ligar(a, emp.Codigo, "RECEPCAO-01")
	if resp.StatusCode != 201 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	r := apitest.LerJSON[ligarResp](t, resp)
	if len(r.Chave) != 43 || r.Empresa.Nome != "ACME Comércio Ltda" {
		t.Fatalf("resposta = %+v", r)
	}

	// No banco: só o SHA-256 da chave, e a chave em coluna nenhuma.
	db, err := sql.Open("sqlite", "file:"+a.Caminho+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var hash []byte
	var nome string
	if err := db.QueryRow("SELECT chave_hash, nome FROM computadores").Scan(&hash, &nome); err != nil {
		t.Fatal(err)
	}
	esperado := sha256.Sum256([]byte(r.Chave))
	if string(hash) != string(esperado[:]) || nome != "RECEPCAO-01" {
		t.Fatalf("chave_hash/nome inesperados: %x %q", hash, nome)
	}
	for _, tabela := range []string{"empresas", "pessoas", "computadores", "computador_pessoas", "conversas", "membros", "arquivos", "mensagens", "leituras", "admins", "sessoes_admin"} {
		linhas, err := db.Query("SELECT * FROM " + tabela)
		if err != nil {
			t.Fatal(err)
		}
		cols, _ := linhas.Columns()
		for linhas.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := linhas.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			for _, v := range vals {
				var s string
				switch x := v.(type) {
				case string:
					s = x
				case []byte:
					s = string(x)
				}
				if strings.Contains(s, r.Chave) {
					t.Fatalf("a chave aparece na tabela %s", tabela)
				}
			}
		}
		linhas.Close()
	}
}

func TestLigar_CodigoNormalizado(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	bagunca := strings.ToLower(strings.ReplaceAll(emp.Codigo, "-", " "))
	if resp := ligar(a, " "+bagunca+" ", "PC"); resp.StatusCode != 201 {
		t.Fatalf("com espaços e minúsculas: %d", resp.StatusCode)
	}
	if resp := ligar(a, strings.ReplaceAll(emp.Codigo, "-", ""), "PC2"); resp.StatusCode != 201 {
		t.Fatalf("sem hífen: %d", resp.StatusCode)
	}
}

func TestLigar_CodigoErrado(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	for i := 0; i < 10; i++ {
		esperarErro(t, ligar(a, "STAR-AAAA-BBBB", "PC"), 404, "codigo")
	}
	e := esperarErro(t, ligar(a, "STAR-AAAA-BBBB", "PC"), 429, "tentativas")
	if e.EsperarSegundos < 3590 || e.EsperarSegundos > 3600 {
		t.Fatalf("esperarSegundos = %d", e.EsperarSegundos)
	}
	// Bloqueado, nem o código certo passa.
	esperarErro(t, ligar(a, emp.Codigo, "PC"), 429, "tentativas")
	a.Relogio.Avancar(time.Hour)
	if resp := ligar(a, emp.Codigo, "PC"); resp.StatusCode != 201 {
		t.Fatalf("uma hora depois: %d", resp.StatusCode)
	}
}

func TestLigar_CodigoCertoNaoConta(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	for i := 0; i < 15; i++ {
		if resp := ligar(a, emp.Codigo, "PC"); resp.StatusCode != 201 {
			t.Fatalf("ligação %d: %d", i+1, resp.StatusCode)
		}
	}
}

func TestLigar_NomeComputadorInvalido(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	e := esperarErro(t, ligar(a, emp.Codigo, "   "), 400, "invalido")
	if e.Campo != "computador" {
		t.Fatalf("campo = %q", e.Campo)
	}
}

func TestLigar_CorpoRuim(t *testing.T) {
	a := apitest.Novo(t)
	esperarErro(t, a.Pedir("", "POST", "/api/v1/computadores", []byte("{não é json")), 400, "invalido")
}

func TestAutenticacao(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	desligada := a.Ligar(emp.Codigo, "PC-VELHO")
	if resp := a.Pedir(desligada, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
		t.Fatalf("desligar: %d", resp.StatusCode)
	}
	for nome, chave := range map[string]string{"sem chave": "", "inventada": strings.Repeat("a", 43), "desligada": desligada} {
		t.Run(nome, func(t *testing.T) {
			esperarErro(t, a.Com(t).Pedir(chave, "GET", "/api/v1/pessoas", nil), 401, "chave")
		})
	}
	// Outro esquema que não Bearer também é recusado.
	req, _ := http.NewRequest("GET", a.Servidor.URL+"/api/v1/pessoas", nil)
	req.Header.Set("Authorization", "Basic abc")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	esperarErro(t, resp, 401, "chave")
}

func TestDesligar(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "PC")
	if resp := a.Pedir(chave, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	esperarErro(t, a.Pedir(chave, "DELETE", "/api/v1/computadores/eu", nil), 401, "chave")
}

func TestCORS(t *testing.T) {
	a := apitest.Novo(t)
	pedir := func(origem, metodo, caminho string) *http.Response {
		req, _ := http.NewRequest(metodo, a.Servidor.URL+caminho, nil)
		req.Header.Set("Origin", origem)
		req.Header.Set("Access-Control-Request-Method", "POST")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		return resp
	}
	resp := pedir("https://app.starsonic.local", "OPTIONS", "/api/v1/conversas/7/mensagens")
	if resp.StatusCode != 204 {
		t.Fatalf("OPTIONS: %d", resp.StatusCode)
	}
	h := resp.Header
	if h.Get("Access-Control-Allow-Origin") != "https://app.starsonic.local" ||
		h.Get("Access-Control-Allow-Methods") != "GET, POST, PUT, DELETE" ||
		h.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type, X-Arquivo-Nome" ||
		h.Get("Access-Control-Max-Age") != "600" || h.Get("Vary") != "Origin" {
		t.Fatalf("cabeçalhos: %v", h)
	}
	// Origem de fora: nenhum Access-Control-Allow-*.
	for _, metodo := range []string{"OPTIONS", "GET"} {
		resp = pedir("https://mal.example", metodo, "/api/v1/nada")
		for k := range resp.Header {
			if strings.HasPrefix(k, "Access-Control-Allow") {
				t.Fatalf("%s de origem de fora recebeu %s", metodo, k)
			}
		}
	}
	// Resposta de verdade, de origem permitida, também leva a origem.
	resp = pedir("https://app.starsonic.local", "GET", "/api/v1/nada")
	if resp.Header.Get("Access-Control-Allow-Origin") != "https://app.starsonic.local" || resp.Header.Get("Vary") != "Origin" {
		t.Fatalf("resposta real sem CORS: %v", resp.Header)
	}
	// Sem Origin (curl, o core): sem cabeçalhos de CORS.
	resp = a.Pedir("", "GET", "/api/v1/nada", nil)
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("sem Origin não deve ter CORS")
	}
}

func TestJSONGrande(t *testing.T) {
	a := apitest.Novo(t)
	corpo := []byte(`{"codigo":"` + strings.Repeat("a", 65537-13) + `"}`)
	if len(corpo) != 65537 {
		t.Fatalf("corpo de %d bytes", len(corpo))
	}
	esperarErro(t, a.Pedir("", "POST", "/api/v1/computadores", corpo), 413, "grande")
}

func TestRotaDesconhecida(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	chave := a.Ligar(emp.Codigo, "PC")
	esperarErro(t, a.Pedir(chave, "GET", "/api/v1/nada", nil), 404, "naoEncontrado")
	// Método errado numa rota que existe: também 404 em JSON.
	esperarErro(t, a.Pedir(chave, "GET", "/api/v1/computadores", nil), 404, "naoEncontrado")
}

// ligarDe chama o manipulador direto, com o RemoteAddr dado, e devolve o status.
func ligarDe(h http.Handler, remoto, codigo string) int {
	req := httptest.NewRequest("POST", "/api/v1/computadores",
		strings.NewReader(`{"codigo":"`+codigo+`","computador":"PC"}`))
	req.RemoteAddr = remoto
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestLigar_IPv6MesmoPrefixo(t *testing.T) {
	a := apitest.Novo(t)
	emp := a.Empresa("ACME Comércio Ltda")
	h := api.Novo(api.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem})
	for i := 0; i < 5; i++ {
		if c := ligarDe(h, "[2001:db8:1:2::1]:1000", "STAR-AAAA-BBBB"); c != 404 {
			t.Fatalf("erro %d: %d", i+1, c)
		}
		if c := ligarDe(h, "[2001:db8:1:2::ffff]:2000", "STAR-AAAA-BBBB"); c != 404 {
			t.Fatalf("erro %d: %d", i+1, c)
		}
	}
	for _, r := range []string{"[2001:db8:1:2::1]:1", "[2001:db8:1:2::ffff]:1", "[2001:db8:1:2:9::5]:1", "[2001:db8:1:2::1%eth0]:1"} {
		if c := ligarDe(h, r, "STAR-AAAA-BBBB"); c != 429 {
			t.Fatalf("o 11º de %s: %d; queria 429", r, c)
		}
	}
	// Outro /64 segue aceito.
	if c := ligarDe(h, "[2001:db8:1:3::1]:1", emp.Codigo); c != 201 {
		t.Fatalf("outro /64: %d", c)
	}
}

func TestLigar_IPv4Mapeado(t *testing.T) {
	a := apitest.Novo(t)
	h := api.Novo(api.Deps{Banco: a.Banco, Hub: a.Hub, Armazem: a.Armazem})
	for i := 0; i < 5; i++ {
		ligarDe(h, "[::ffff:192.0.2.1]:1000", "STAR-AAAA-BBBB")
		ligarDe(h, "192.0.2.1:2000", "STAR-AAAA-BBBB")
	}
	if c := ligarDe(h, "192.0.2.1:3000", "STAR-AAAA-BBBB"); c != 429 {
		t.Fatalf("IPv4: %d; queria 429", c)
	}
	if c := ligarDe(h, "[::ffff:192.0.2.1]:3000", "STAR-AAAA-BBBB"); c != 429 {
		t.Fatalf("mapeado: %d; queria 429", c)
	}
	if c := ligarDe(h, "192.0.2.2:3000", "STAR-AAAA-BBBB"); c != 404 {
		t.Fatalf("outro IPv4: %d; queria 404", c)
	}
}

func TestLigar_Concorrente(t *testing.T) {
	a := apitest.Novo(t)
	var mu sync.Mutex
	status := map[int]int{}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := a.Servidor.Client().Post(a.Servidor.URL+"/api/v1/computadores", "application/json",
				strings.NewReader(`{"codigo":"STAR-AAAA-BBBB","computador":"PC"}`))
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			mu.Lock()
			status[resp.StatusCode]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if status[404] != 10 || status[429] != 40 || len(status) != 2 {
		t.Fatalf("status = %v; queria 10x404 e 40x429", status)
	}
}
