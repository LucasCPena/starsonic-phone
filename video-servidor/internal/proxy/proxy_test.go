package proxy

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const origemCerta = "https://chat.exemplo.com.br"

// destinoFalso responde o 101 a quem pede o upgrade e devolve cada byte que recebe.
func destinoFalso(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		buf.Flush()
		io.Copy(conn, buf) // devolve o que chega, até a conexão fechar
	}))
	t.Cleanup(srv.Close)
	return srv
}

// abrir manda o pedido de upgrade ao proxy e devolve a conexão e a resposta lida.
func abrir(t *testing.T, proxy *httptest.Server, origem string) (net.Conn, *bufio.Reader, *http.Response) {
	t.Helper()
	conn, err := net.Dial("tcp", strings.TrimPrefix(proxy.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	pedido := "GET /sip HTTP/1.1\r\nHost: video.exemplo.com.br\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: sip\r\n"
	if origem != "" {
		pedido += "Origin: " + origem + "\r\n"
	}
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.WriteString(conn, pedido+"\r\n"); err != nil {
		t.Fatal(err)
	}
	r := bufio.NewReader(conn)
	resp, err := http.ReadResponse(r, nil)
	if err != nil {
		t.Fatalf("lendo a resposta: %v", err)
	}
	return conn, r, resp
}

func TestProxy_Origem(t *testing.T) {
	destino := destinoFalso(t)
	srv := httptest.NewServer(Novo(destino.URL+"/", []string{origemCerta}, 30))
	defer srv.Close()

	for _, origem := range []string{"", "https://mal.example", "https://chat.exemplo.com.br.mal.example", "http://chat.exemplo.com.br", "https://chat.exemplo.com.br/", "HTTPS://CHAT.EXEMPLO.COM.BR"} {
		_, _, resp := abrir(t, srv, origem)
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("origem %q: status %d, want 403", origem, resp.StatusCode)
		}
	}

	conn, r, resp := abrir(t, srv, origemCerta)
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("origem certa: status %d, want 101", resp.StatusCode)
	}
	if _, err := io.WriteString(conn, "INVITE sip:reuniao@video.exemplo.com.br SIP/2.0\r\n"); err != nil {
		t.Fatal(err)
	}
	linha, err := r.ReadString('\n')
	if err != nil || linha != "INVITE sip:reuniao@video.exemplo.com.br SIP/2.0\r\n" {
		t.Fatalf("os bytes voltaram como %q (%v)", linha, err)
	}
}

// Duas origens configuradas: cada uma passa, e uma terceira não.
func TestProxy_VariasOrigens(t *testing.T) {
	destino := destinoFalso(t)
	srv := httptest.NewServer(Novo(destino.URL+"/", []string{origemCerta, "http://127.0.0.1:8090"}, 30))
	defer srv.Close()
	for origem, want := range map[string]int{origemCerta: 101, "http://127.0.0.1:8090": 101, "http://127.0.0.1:8091": 403} {
		_, _, resp := abrir(t, srv, origem)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("origem %q: status %d, want %d", origem, resp.StatusCode, want)
		}
	}
}

func TestProxy_LimitePorEndereco(t *testing.T) {
	destino := destinoFalso(t)
	srv := httptest.NewServer(Novo(destino.URL+"/", []string{origemCerta}, 3))
	defer srv.Close()

	var abertas []net.Conn
	for i := 0; i < 3; i++ {
		conn, _, resp := abrir(t, srv, origemCerta)
		if resp.StatusCode != http.StatusSwitchingProtocols {
			t.Fatalf("conexão %d: status %d, want 101", i+1, resp.StatusCode)
		}
		abertas = append(abertas, conn)
	}
	_, _, resp := abrir(t, srv, origemCerta)
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("a 4ª: status %d, want 429", resp.StatusCode)
	}

	// Um pedido recusado por outro motivo não ocupa vaga.
	for i := 0; i < 5; i++ {
		_, _, resp := abrir(t, srv, "https://mal.example")
		resp.Body.Close()
	}

	// Fechada uma, outra passa (a vaga volta quando o túnel acaba).
	abertas[0].Close()
	passou := false
	for i := 0; i < 100 && !passou; i++ {
		conn, _, resp := abrir(t, srv, origemCerta)
		if resp.StatusCode == http.StatusSwitchingProtocols {
			passou = true
			continue
		}
		resp.Body.Close()
		conn.Close()
		time.Sleep(20 * time.Millisecond)
	}
	if !passou {
		t.Fatal("depois de fechar uma conexão, nenhuma outra passou")
	}
}

func TestProxy_SoWebSocket(t *testing.T) {
	destino := destinoFalso(t)
	srv := httptest.NewServer(Novo(destino.URL+"/", []string{origemCerta}, 30))
	defer srv.Close()

	pedir := func(metodo string, cabecalhos map[string]string) int {
		req, _ := http.NewRequest(metodo, srv.URL+"/sip", nil)
		req.Header.Set("Origin", origemCerta)
		for k, v := range cabecalhos {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if got := pedir("GET", nil); got != http.StatusBadRequest {
		t.Errorf("GET comum: %d, want 400", got)
	}
	if got := pedir("GET", map[string]string{"Upgrade": "h2c", "Connection": "Upgrade"}); got != http.StatusBadRequest {
		t.Errorf("GET com outro upgrade: %d, want 400", got)
	}
	if got := pedir("POST", map[string]string{"Upgrade": "websocket", "Connection": "Upgrade"}); got != http.StatusBadRequest {
		t.Errorf("POST: %d, want 400", got)
	}
}

// O destino fora do ar dá 502, sem o erro do destino na resposta.
func TestProxy_DestinoForaDoAr(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	fora := l.Addr().String()
	l.Close()
	srv := httptest.NewServer(Novo("http://"+fora+"/", []string{origemCerta}, 30))
	defer srv.Close()
	_, _, resp := abrir(t, srv, origemCerta)
	defer resp.Body.Close()
	corpo, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadGateway || strings.Contains(string(corpo), "127.0.0.1") {
		t.Fatalf("status %d, corpo %q", resp.StatusCode, corpo)
	}
}
