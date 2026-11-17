package servidor

import (
	"bytes"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	tokenDeTeste   = "abc123_-XYZ"
	caminhoDesafio = "/.well-known/acme-challenge/" + tokenDeTeste
)

// pedidoVisto é o que o servidor de mentira da VM do vídeo recebeu.
type pedidoVisto struct {
	metodo, host, caminho, consulta string
	cabecalhos                      http.Header
	corpo                           string
}

// videoDeMentira sobe um httptest.Server no lugar da porta 80 da VM do vídeo, troca a porta do repasse para a
// dele e devolve a Config do repasse (o IP é o 127.0.0.1) e a lista dos pedidos que chegaram.
func videoDeMentira(t *testing.T, h http.HandlerFunc) (*CertificadoDoVideo, *[]pedidoVisto) {
	t.Helper()
	var mu sync.Mutex
	var vistos []pedidoVisto
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		corpo, _ := io.ReadAll(r.Body)
		mu.Lock()
		vistos = append(vistos, pedidoVisto{r.Method, r.Host, r.URL.Path, r.URL.RawQuery, r.Header.Clone(), string(corpo)})
		mu.Unlock()
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	_, porta, err := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	antes := portaDoDesafioDoVideo
	portaDoDesafioDoVideo = porta
	t.Cleanup(func() { portaDoDesafioDoVideo = antes })
	return &CertificadoDoVideo{Endereco: "video.example.com", IP: "127.0.0.1"}, &vistos
}

// m é o manipulador da porta 80 com o repasse, e o "próximo" é o do autocert e do redirecionamento de verdade.
func manipuladorDe(t *testing.T, cv *CertificadoDoVideo) http.Handler {
	t.Helper()
	m := gerenciador(Config{Endereco: "chat.example.com", Dados: t.TempDir()})
	return redirecionador(m, "chat.example.com", cv)
}

func pedirRepasse(h http.Handler, metodo, host, alvo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(metodo, "http://"+host+alvo, nil)
	req.Host = host
	req.RemoteAddr = "198.51.100.77:4242"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func logEmBuffer(t *testing.T) *bytes.Buffer {
	t.Helper()
	var b bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&b, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &b
}

func TestRepasse_CaminhoFeliz(t *testing.T) {
	cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Set-Cookie", "x=1")
		io.WriteString(w, tokenDeTeste+".chave-da-conta")
	})
	log := logEmBuffer(t)
	for _, host := range []string{"video.example.com", "VIDEO.Example.COM", "video.example.com:80"} {
		*vistos = nil
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", host, caminhoDesafio)
		if rec.Code != 200 || rec.Body.String() != tokenDeTeste+".chave-da-conta" {
			t.Fatalf("%s: %d %q", host, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Fatalf("%s: Content-Type %q; queria text/plain", host, ct)
		}
		if rec.Header().Get("Set-Cookie") != "" {
			t.Fatalf("%s: o Set-Cookie do vídeo passou", host)
		}
		if len(*vistos) != 1 {
			t.Fatalf("%s: o vídeo recebeu %d pedidos", host, len(*vistos))
		}
		v := (*vistos)[0]
		if v.metodo != "GET" || v.host != "video.example.com" || v.caminho != caminhoDesafio || v.consulta != "" {
			t.Fatalf("%s: o vídeo recebeu %+v", host, v)
		}
	}
	if !strings.Contains(log.String(), "status=200") {
		t.Fatalf("o log não diz o status: %q", log.String())
	}
	for _, proibido := range []string{tokenDeTeste, "acme-challenge", "198.51.100.77", "chave-da-conta"} {
		if strings.Contains(log.String(), proibido) {
			t.Fatalf("o log tem %q: %s", proibido, log.String())
		}
	}
}

func TestRepasse_NaoLevaNadaDoPedido(t *testing.T) {
	cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	req := httptest.NewRequest("GET", "http://video.example.com"+caminhoDesafio+"?x=1", strings.NewReader("corpo"))
	req.Host = "video.example.com"
	req.Header.Set("Cookie", "sessao=segredo")
	req.Header.Set("Authorization", "Bearer segredo")
	req.Header.Set("X-Forwarded-For", "198.51.100.77")
	req.Header.Set("User-Agent", "Let's Encrypt validation server")
	rec := httptest.NewRecorder()
	manipuladorDe(t, cv).ServeHTTP(rec, req)
	if rec.Code != 200 || len(*vistos) != 1 {
		t.Fatalf("%d, %d pedidos", rec.Code, len(*vistos))
	}
	v := (*vistos)[0]
	if v.corpo != "" || v.consulta != "" {
		t.Fatalf("o corpo %q ou a consulta %q passaram", v.corpo, v.consulta)
	}
	for _, h := range []string{"Cookie", "Authorization", "X-Forwarded-For", "User-Agent", "Referer", "Origin"} {
		if got := v.cabecalhos.Get(h); got != "" {
			t.Errorf("o cabeçalho %s passou: %q", h, got)
		}
	}
	// O vídeo recebe só o Host (que o Go lê à parte) e o Connection: close do cliente.
	var chaves []string
	for k := range v.cabecalhos {
		chaves = append(chaves, k)
	}
	if len(chaves) != 1 || chaves[0] != "Connection" || v.cabecalhos.Get("Connection") != "close" {
		t.Errorf("cabeçalhos no vídeo: %v; queria só o Connection: close", v.cabecalhos)
	}
}

func TestRepasse_HEAD(t *testing.T) {
	cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "corpo") })
	rec := pedirRepasse(manipuladorDe(t, cv), "HEAD", "video.example.com", caminhoDesafio)
	if rec.Code != 200 || len(*vistos) != 1 || (*vistos)[0].metodo != "HEAD" {
		t.Fatalf("%d, %+v", rec.Code, *vistos)
	}
}

func TestRepasse_StatusDoVideoPassa(t *testing.T) {
	for _, status := range []int{200, 404, 301, 500, 403} {
		cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {
			if status == 301 {
				w.Header().Set("Location", "https://video.example.com/")
			}
			w.WriteHeader(status)
			io.WriteString(w, "texto do vídeo")
		})
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", caminhoDesafio)
		if rec.Code != status || rec.Body.String() != "texto do vídeo" {
			t.Fatalf("status %d: veio %d %q", status, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Location") != "" {
			t.Fatalf("status %d: o Location passou", status)
		}
		if len(*vistos) != 1 { // o redirecionamento do vídeo não é seguido
			t.Fatalf("status %d: %d pedidos ao vídeo", status, len(*vistos))
		}
	}
}

// Tudo o que não é o desafio do nome do vídeo segue para o manipulador de sempre, e o vídeo não recebe nada.
func TestRepasse_AsGuardasCaemNoDeSempre(t *testing.T) {
	cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "do vídeo") })
	longo := strings.Repeat("a", 129)
	casos := []struct{ nome, metodo, host, alvo string }{
		{"outro nome", "GET", "chat.example.com", caminhoDesafio},
		{"outro nome parecido", "GET", "video.example.com.evil.example", caminhoDesafio},
		{"sem host", "GET", "", caminhoDesafio},
		{"POST", "POST", "video.example.com", caminhoDesafio},
		{"PUT", "PUT", "video.example.com", caminhoDesafio},
		{"outro caminho", "GET", "video.example.com", "/admin"},
		{"a raiz", "GET", "video.example.com", "/"},
		{"o caminho sem token", "GET", "video.example.com", "/.well-known/acme-challenge/"},
		{"o caminho sem a barra", "GET", "video.example.com", "/.well-known/acme-challenge"},
		{"caminho dentro do caminho", "GET", "video.example.com", "/.well-known/acme-challenge/a/b"},
		{"token com ponto", "GET", "video.example.com", "/.well-known/acme-challenge/a.b"},
		{"token com ..", "GET", "video.example.com", "/.well-known/acme-challenge/.."},
		{"token com barra codificada", "GET", "video.example.com", "/.well-known/acme-challenge/a%2Fb"},
		{"token com espaço", "GET", "video.example.com", "/.well-known/acme-challenge/a%20b"},
		{"token com 129 letras", "GET", "video.example.com", "/.well-known/acme-challenge/" + longo},
		{"prefixo a mais", "GET", "video.example.com", "/x/.well-known/acme-challenge/" + tokenDeTeste},
		{"o outro desafio", "GET", "video.example.com", "/.well-known/other/" + tokenDeTeste},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			rec := pedirRepasse(manipuladorDe(t, cv), c.metodo, c.host, c.alvo)
			if rec.Body.String() == "do vídeo" {
				t.Fatalf("o repasse atendeu: %d", rec.Code)
			}
			if len(*vistos) != 0 {
				t.Fatalf("o vídeo recebeu %+v", *vistos)
			}
			// O de sempre: o autocert recusa o desafio de um nome que não é o do chat, e o resto é o 301.
			if rec.Code != http.StatusMovedPermanently && rec.Code != http.StatusNotFound && rec.Code != http.StatusForbidden && rec.Code != http.StatusBadRequest {
				t.Fatalf("%d fora do esperado do manipulador de sempre", rec.Code)
			}
		})
	}
	t.Run("o token de 128 letras vale", func(t *testing.T) {
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", "/.well-known/acme-challenge/"+strings.Repeat("a", 128))
		if rec.Body.String() != "do vídeo" {
			t.Fatalf("%d %q", rec.Code, rec.Body.String())
		}
	})
}

func TestRepasse_SemConfiguracaoNaoRepassa(t *testing.T) {
	_, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "do vídeo") })
	rec := pedirRepasse(manipuladorDe(t, nil), "GET", "video.example.com", caminhoDesafio)
	if rec.Body.String() == "do vídeo" || len(*vistos) != 0 {
		t.Fatalf("repassou sem configuração: %d", rec.Code)
	}
}

// O desafio do nome do chat continua com o autocert, e o resto, com o 301, mesmo com o repasse ligado.
func TestRepasse_ODesafioDoChatContinuaNoAutocert(t *testing.T) {
	cv, vistos := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "do vídeo") })
	h := manipuladorDe(t, cv)
	rec := pedirRepasse(h, "GET", "chat.example.com", caminhoDesafio)
	// Sem o token no cache, o autocert responde 404 "certificate cache miss" (e não um 301 nem o corpo do vídeo):
	// quem tratou foi ele.
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "autocert") {
		t.Fatalf("o desafio do chat: %d %q; queria o 404 do autocert", rec.Code, rec.Body.String())
	}
	rec = pedirRepasse(h, "GET", "chat.example.com", "/admin/entrar?x=1")
	if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "https://chat.example.com/admin/entrar?x=1" {
		t.Fatalf("o redirecionamento: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	rec = pedirRepasse(h, "GET", "video.example.com", "/outra-coisa")
	if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "https://chat.example.com/outra-coisa" {
		t.Fatalf("o video com outro caminho: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	if len(*vistos) != 0 {
		t.Fatalf("o vídeo recebeu %+v", *vistos)
	}
}

func TestRepasse_LimiteDe4096Bytes(t *testing.T) {
	grande := strings.Repeat("x", 10000)
	cv, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, grande) })
	rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", caminhoDesafio)
	if rec.Code != 200 || rec.Body.Len() != 4096 {
		t.Fatalf("%d com %d bytes; queria 200 com 4096", rec.Code, rec.Body.Len())
	}
	justo := strings.Repeat("y", 4096)
	cv2, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, justo) })
	rec = pedirRepasse(manipuladorDe(t, cv2), "GET", "video.example.com", caminhoDesafio)
	if rec.Body.String() != justo {
		t.Fatalf("4096 bytes exatos: veio %d", rec.Body.Len())
	}
}

func TestRepasse_ErroEPrazoViram502(t *testing.T) {
	t.Run("o vídeo demora mais que o prazo", func(t *testing.T) {
		parar := make(chan struct{})
		t.Cleanup(func() { close(parar) })
		cv, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-parar:
			case <-r.Context().Done():
			}
		})
		antes := prazoDoRepasse
		prazoDoRepasse = 100 * time.Millisecond
		t.Cleanup(func() { prazoDoRepasse = antes })
		log := logEmBuffer(t)
		inicio := time.Now()
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", caminhoDesafio)
		if rec.Code != http.StatusBadGateway || rec.Body.Len() == 0 {
			t.Fatalf("%d %q; queria 502 com um texto", rec.Code, rec.Body.String())
		}
		if time.Since(inicio) > 5*time.Second {
			t.Fatalf("esperou %v", time.Since(inicio))
		}
		if !strings.Contains(log.String(), "status=502") || strings.Contains(log.String(), tokenDeTeste) || strings.Contains(log.String(), "127.0.0.1") {
			t.Fatalf("o log: %s", log.String())
		}
	})
	t.Run("ninguém escuta na porta", func(t *testing.T) {
		cv, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {})
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		_, porta, _ := net.SplitHostPort(l.Addr().String())
		l.Close()
		portaDoDesafioDoVideo = porta // o videoDeMentira restaura a anterior no fim
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", caminhoDesafio)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("%d; queria 502", rec.Code)
		}
	})
	t.Run("o vídeo corta no meio da resposta", func(t *testing.T) {
		cv, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "100")
			io.WriteString(w, "só um pedaço")
		})
		rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", caminhoDesafio)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("%d %q; queria 502", rec.Code, rec.Body.String())
		}
	})
}

// ---- a configuração ----

func TestConfig_CertificadoDoVideo(t *testing.T) {
	dados := filepath.Join(t.TempDir(), "dados")
	com := func(obj string) string {
		return `{"endereco":"chat.example.com","dados":` + quote(dados) + `,"certificadoDoVideo":` + obj + `}`
	}
	t.Run("sem o objeto não repassa", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, `{"endereco":"chat.example.com","dados":`+quote(dados)+`}`))
		if err != nil || c.CertificadoDoVideo != nil {
			t.Fatalf("%v, %+v", err, c.CertificadoDoVideo)
		}
	})
	aceitos := map[string]string{
		"10/8":                        `{"endereco":"video.example.com","ip":"10.0.0.20"}`,
		"172.16/12":                   `{"endereco":"video.example.com","ip":"172.16.5.4"}`,
		"192.168/16":                  `{"endereco":"video.example.com","ip":"192.168.1.9"}`,
		"um IPv6 privado":             `{"endereco":"video.example.com","ip":"fd00::20"}`,
		"nome do chat com subdomínio": `{"endereco":"video.chat.example.com","ip":"10.0.0.20"}`,
	}
	for nome, obj := range aceitos {
		t.Run("aceita "+nome, func(t *testing.T) {
			c, err := LerConfig(escreverConfig(t, com(obj)))
			if err != nil {
				t.Fatal(err)
			}
			if c.CertificadoDoVideo == nil || c.CertificadoDoVideo.Endereco == "" || c.CertificadoDoVideo.IP == "" {
				t.Fatalf("%+v", c.CertificadoDoVideo)
			}
		})
	}
	t.Run("os valores lidos", func(t *testing.T) {
		c, err := LerConfig(escreverConfig(t, com(`{"endereco":"video.example.com","ip":"10.0.0.20"}`)))
		if err != nil {
			t.Fatal(err)
		}
		if *c.CertificadoDoVideo != (CertificadoDoVideo{Endereco: "video.example.com", IP: "10.0.0.20"}) {
			t.Fatalf("%+v", c.CertificadoDoVideo)
		}
	})
	recusados := map[string]string{
		"objeto vazio":         `{}`,
		"null":                 `null`,
		"sem o ip":             `{"endereco":"video.example.com"}`,
		"sem o endereco":       `{"ip":"10.0.0.20"}`,
		"endereco vazio":       `{"endereco":"","ip":"10.0.0.20"}`,
		"endereco com porta":   `{"endereco":"video.example.com:7443","ip":"10.0.0.20"}`,
		"endereco com https":   `{"endereco":"https://video.example.com","ip":"10.0.0.20"}`,
		"endereco com caminho": `{"endereco":"video.example.com/x","ip":"10.0.0.20"}`,
		"endereco sem ponto":   `{"endereco":"video","ip":"10.0.0.20"}`,
		"endereco maiúsculo":   `{"endereco":"Video.Example.com","ip":"10.0.0.20"}`,
		"endereco que é um IP": `{"endereco":"203.0.113.10","ip":"10.0.0.20"}`,
		"o endereco do chat":   `{"endereco":"chat.example.com","ip":"10.0.0.20"}`,
		"ip vazio":             `{"endereco":"video.example.com","ip":""}`,
		"ip que é um nome":     `{"endereco":"video.example.com","ip":"video.internal"}`,
		"ip com porta":         `{"endereco":"video.example.com","ip":"10.0.0.20:80"}`,
		"ip público":           `{"endereco":"video.example.com","ip":"203.0.113.10"}`,
		"ip de loopback":       `{"endereco":"video.example.com","ip":"127.0.0.1"}`,
		"ip de loopback IPv6":  `{"endereco":"video.example.com","ip":"::1"}`,
		"ip 0.0.0.0":           `{"endereco":"video.example.com","ip":"0.0.0.0"}`,
		"ip ::":                `{"endereco":"video.example.com","ip":"::"}`,
		"ip link local":        `{"endereco":"video.example.com","ip":"169.254.1.1"}`,
		"ip do CGNAT":          `{"endereco":"video.example.com","ip":"100.64.0.1"}`,
		"ip 172.32":            `{"endereco":"video.example.com","ip":"172.32.0.1"}`,
		"ip com três partes":   `{"endereco":"video.example.com","ip":"10.0.20"}`,
		"ip IPv4 dentro do v6": `{"endereco":"video.example.com","ip":"::ffff:10.0.0.20"}`,
		"chave a mais":         `{"endereco":"video.example.com","ip":"10.0.0.20","porta":80}`,
		"não é objeto":         `"video.example.com"`,
		"ip em número":         `{"endereco":"video.example.com","ip":167772180}`,
	}
	for nome, obj := range recusados {
		t.Run("recusa "+nome, func(t *testing.T) {
			_, err := LerConfig(escreverConfig(t, com(obj)))
			if err == nil {
				t.Fatal("esperava erro")
			}
		})
	}
	t.Run("o erro nomeia o campo", func(t *testing.T) {
		_, err := LerConfig(escreverConfig(t, com(`{"endereco":"video.example.com","ip":"203.0.113.10"}`)))
		if err == nil || !strings.Contains(err.Error(), "certificadoDoVideo") {
			t.Fatalf("erro %v", err)
		}
	})
	t.Run("o endereço do chat com outras letras também é o do chat", func(t *testing.T) {
		_, err := LerConfig(escreverConfig(t, `{"endereco":"Chat.Example.com","dados":`+quote(dados)+`,"certificadoDoVideo":{"endereco":"chat.example.com","ip":"10.0.0.20"}}`))
		if err == nil {
			t.Fatal("esperava erro")
		}
	})
}

// O guia (docs/video-servidor.md, "Confira o repasse") cita estes dois textos: com o repasse ligado e nada na porta 80
// do vídeo, o 502; com o repasse desligado, o 403 do autocert.
func TestRepasse_OsTextosDoGuia(t *testing.T) {
	cv, _ := videoDeMentira(t, func(w http.ResponseWriter, r *http.Request) {})
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, porta, _ := net.SplitHostPort(l.Addr().String())
	l.Close()
	portaDoDesafioDoVideo = porta
	rec := pedirRepasse(manipuladorDe(t, cv), "GET", "video.example.com", "/.well-known/acme-challenge/teste")
	if rec.Code != http.StatusBadGateway || rec.Body.String() != "Não consegui falar com o servidor de vídeo.\n" {
		t.Fatalf("ligado: %d %q", rec.Code, rec.Body.String())
	}
	rec = pedirRepasse(manipuladorDe(t, nil), "GET", "video.example.com", "/.well-known/acme-challenge/teste")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), `acme/autocert: host "video.example.com" not configured in HostWhitelist`) {
		t.Fatalf("desligado: %d %q", rec.Code, rec.Body.String())
	}
}
