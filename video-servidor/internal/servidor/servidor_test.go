package servidor

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl/esltest"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler)) // os testes não imprimem o log
	os.Exit(m.Run())
}

// Os nomes são inventados: as salas, os participantes e as ligações são hexadecimais de teste.
const (
	salaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	anaID    = "a1a1a1a1a1a1a1a1"
	biaID    = "b3b3b3b3b3b3b3b3"
	carlosID = "c2c2c2c2c2c2c2c2"

	uuidAna     = "00000000-0000-4000-8000-0000000000a1"
	uuidBia     = "00000000-0000-4000-8000-0000000000b1"
	uuidBiaTela = "00000000-0000-4000-8000-0000000000b2"
	uuidCarlos  = "00000000-0000-4000-8000-0000000000c1"

	senhaESL = "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"
)

func configDeTeste() config.Config {
	return config.Config{Endereco: "video.exemplo.com.br", Chat: "chat.exemplo.com.br", Chave: senha.NovaChave(),
		SenhaESL: senhaESL, IPPrivado: "10.0.0.5", IPPublico: "203.0.113.10"}
}

// portaLivre devolve um endereço 127.0.0.1:porta que estava livre agora.
func portaLivre(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

// trocar muda uma variável do pacote até o fim do teste. Como o Cleanup roda ao contrário, o servidor que
// o teste sobe depois já parou quando o valor volta.
func trocar[T any](t *testing.T, alvo *T, valor T) {
	t.Helper()
	antigo := *alvo
	*alvo = valor
	t.Cleanup(func() { *alvo = antigo })
}

// ambiente aponta o ESL, a discagem, o destino do /sip e o /proc para lugares de teste, e encurta os prazos.
type ambiente struct {
	esl     *esltest.Servidor
	discag  string
	destino *httptest.Server
	proc    string
}

func prepararAmbiente(t *testing.T) *ambiente {
	t.Helper()
	a := &ambiente{esl: esltest.Novo(t, senhaESL), discag: portaLivre(t), proc: t.TempDir()}
	a.destino = destinoSIPFalso(t)
	a.esl.Responder("conference json_list", "[]")
	a.esl.Responder("reloadcert", "+OK\n")
	escrever(t, a.proc, "meminfo", "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    6000000 kB\n")
	escrever(t, a.proc, "stat", "cpu  50 0 50 850 50 0 0 0 0 0\n")
	trocar(t, &enderecoESL, a.esl.Endereco())
	trocar(t, &enderecoDiscagem, a.discag)
	trocar(t, &destinoSIP, a.destino.URL+"/")
	trocar(t, &procDir, a.proc)
	trocar(t, &esperaESLMinima, 20*time.Millisecond)
	trocar(t, &esperaESLMaxima, 80*time.Millisecond)
	return a
}

func escrever(t *testing.T, pasta, nome, texto string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(pasta, nome), []byte(texto), 0o644); err != nil {
		t.Fatal(err)
	}
}

// destinoSIPFalso responde o 101 e devolve cada byte que recebe.
func destinoSIPFalso(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		buf.Flush()
		io.Copy(conn, buf)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// ligado é um agente no ar, em HTTP (o modo de teste) ou em TLS.
type ligado struct {
	endereco string // host:porta da porta principal
	cancel   context.CancelFunc
	fim      chan error
	c        config.Config
}

func (s *ligado) url() string { return "http://" + s.endereco }

func iniciar(t *testing.T, opc opcoes) *ligado {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	opc.principal = l
	c := configDeTeste()
	ctx, cancel := context.WithCancel(t.Context())
	s := &ligado{endereco: l.Addr().String(), cancel: cancel, fim: make(chan error, 1), c: c}
	go func() { s.fim <- rodar(ctx, c, "0.1.0", opc) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-s.fim:
			s.fim <- err
		case <-time.After(15 * time.Second):
			t.Error("o agente não parou")
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
		s.fim <- nil // para o Cleanup
	case <-time.After(15 * time.Second):
		t.Fatal("o agente não parou em 15 s")
	}
	return time.Since(inicio)
}

func (s *ligado) teste() opcoes { return opcoes{origens: []string{s.c.OrigemDoChat()}} }

// pedir faz um pedido a /agente/v1/ com a chave.
func pedir(t *testing.T, cliente *http.Client, metodo, alvo, chave string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(metodo, alvo, nil)
	if err != nil {
		t.Fatal(err)
	}
	if chave != "" {
		req.Header.Set("Authorization", "Bearer "+chave)
	}
	resp, err := cliente.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// esperarAte repete a conferência até ela dar certo ou o prazo acabar.
func esperarAte(t *testing.T, prazo time.Duration, oque string, ok func() bool) {
	t.Helper()
	limite := time.Now().Add(prazo)
	for !ok() {
		if time.Now().After(limite) {
			t.Fatalf("passou %v sem: %s", prazo, oque)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// ---- o ESL falso e os eventos do agente ----

func entra(sala, uuid, participante string) esl.Evento {
	return esl.Evento{
		"Event-Name":                      "CUSTOM",
		"Event-Subclass":                  "conference::maintenance",
		"Action":                          "add-member",
		"Conference-Name":                 sala,
		"Unique-ID":                       uuid,
		"variable_starsonic_participante": participante,
		"variable_starsonic_tela":         "false",
	}
}

// entraTela é o add-member da ligação da tela compartilhada.
func entraTela(sala, uuid, participante string) esl.Evento {
	ev := entra(sala, uuid, participante)
	ev["variable_starsonic_tela"] = "true"
	return ev
}

func sai(sala, uuid string) esl.Evento {
	return esl.Evento{
		"Event-Name":      "CUSTOM",
		"Event-Subclass":  "conference::maintenance",
		"Action":          "del-member",
		"Conference-Name": sala,
		"Unique-ID":       uuid,
	}
}

// listaFS é o que o "conference json_list" responde.
func listaFS(sala string, uuids ...string) string {
	var membros []map[string]any
	for i, u := range uuids {
		membros = append(membros, map[string]any{"id": i + 1, "uuid": u})
	}
	b, _ := json.Marshal([]map[string]any{{"conference_name": sala, "member_count": len(membros), "running": true, "members": membros}})
	return string(b)
}

func combinarLigacao(f *esltest.Servidor, uuid, participante string) {
	f.Responder("uuid_getvar "+uuid+" starsonic_participante", participante)
	f.Responder("uuid_getvar "+uuid+" starsonic_tela", "false")
}

// leitor lê os eventos de /agente/v1/eventos, um a um.
type leitor struct {
	r *bufio.Reader
}

func conectarEventos(t *testing.T, url, chave string) *leitor {
	t.Helper()
	req, _ := http.NewRequest("GET", url+"/agente/v1/eventos", nil)
	req.Header.Set("Authorization", "Bearer "+chave)
	resp, err := (&http.Client{Transport: &http.Transport{DisableKeepAlives: true}}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != 200 {
		t.Fatalf("eventos: %d", resp.StatusCode)
	}
	return &leitor{r: bufio.NewReader(resp.Body)}
}

// proximo lê o próximo evento que não seja um relógio.
func (c *leitor) proximo(t *testing.T) map[string]any {
	t.Helper()
	for {
		ch := make(chan map[string]any, 1)
		go func() {
			linha, err := c.r.ReadString('\n')
			if err != nil {
				ch <- nil
				return
			}
			c.r.ReadString('\n') // a linha vazia
			var v map[string]any
			json.Unmarshal([]byte(strings.TrimPrefix(strings.TrimSuffix(linha, "\n"), "data: ")), &v)
			ch <- v
		}()
		select {
		case v := <-ch:
			if v == nil {
				t.Fatal("os eventos acabaram")
			}
			if v["tipo"] != "relogio" {
				return v
			}
		case <-time.After(5 * time.Second):
			t.Fatal("o evento não chegou em 5 s")
		}
	}
}

// ate lê os eventos até um servir ao teste, e o devolve.
func (c *leitor) ate(t *testing.T, ok func(map[string]any) bool) map[string]any {
	t.Helper()
	for range 50 {
		if ev := c.proximo(t); ok(ev) {
			return ev
		}
	}
	t.Fatal("o evento esperado não veio")
	return nil
}

func ehEstado(freeswitch bool) func(map[string]any) bool {
	return func(ev map[string]any) bool { return ev["tipo"] == "estado" && ev["freeswitch"] == freeswitch }
}

func participantesDe(ev map[string]any) []string {
	var nomes []string
	for _, s := range ev["salas"].([]any) {
		for _, p := range s.(map[string]any)["participantes"].([]any) {
			nomes = append(nomes, s.(map[string]any)["sala"].(string)+"/"+p.(map[string]any)["participante"].(string))
		}
	}
	return nomes
}

// ---- o modo de teste ----

func TestModoTeste_SoLocal(t *testing.T) {
	for _, escutar := range []string{"0.0.0.0:8095", "192.168.0.5:80", "localhost:8095", "127.0.0.2:8095", ":8095", "[::]:8095", "127.0.0.1"} {
		err := RodarTeste(t.Context(), configDeTeste(), "0.1.0", escutar, nil)
		if err == nil || err.Error() != "o modo de teste só escuta em 127.0.0.1 ou [::1]" {
			t.Fatalf("%q: erro %v", escutar, err)
		}
		if err != ErroModoTeste {
			t.Fatalf("%q: não é o ErroModoTeste", escutar)
		}
	}
	for _, escutar := range []string{"127.0.0.1:8095", "[::1]:8095"} {
		if err := ValidarEscutar(escutar); err != nil {
			t.Errorf("%q: %v", escutar, err)
		}
	}
}

func TestModoTeste_Responde(t *testing.T) {
	a := prepararAmbiente(t)
	s := iniciar(t, opcoes{origens: []string{configDeTeste().OrigemDoChat(), "http://127.0.0.1:8090"}})
	cliente := &http.Client{Timeout: 5 * time.Second}

	resp := pedir(t, cliente, "GET", s.url()+"/agente/v1/saude", "")
	corpo, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || strings.TrimSpace(string(corpo)) != `{"ok":true}` {
		t.Fatalf("saude: %d %q", resp.StatusCode, corpo)
	}
	if got := resp.Header.Get("Strict-Transport-Security"); got != "" {
		t.Errorf("o modo de teste mandou Strict-Transport-Security %q", got)
	}
	if resp := pedir(t, cliente, "GET", s.url()+"/nada", ""); resp.StatusCode != 404 {
		t.Errorf("/nada: %d, want 404", resp.StatusCode)
	} else {
		resp.Body.Close()
	}
	if resp := pedir(t, cliente, "GET", s.url()+"/agente/v1/estado", ""); resp.StatusCode != 401 {
		t.Errorf("estado sem chave: %d, want 401", resp.StatusCode)
	} else {
		resp.Body.Close()
	}

	// A discagem, pelo endereço da variável: só o POST /freeswitch/discagem.
	esperarAte(t, 3*time.Second, "a discagem responder", func() bool {
		r, err := cliente.Post("http://"+a.discag+"/freeswitch/discagem", "application/x-www-form-urlencoded", strings.NewReader("section=dialplan"))
		if err != nil {
			return false
		}
		r.Body.Close()
		return r.StatusCode == 200
	})
	r, err := cliente.Get("http://" + a.discag + "/freeswitch/discagem")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET na discagem: %d, want 405", r.StatusCode)
	}
	r, err = cliente.Post("http://"+a.discag+"/agente/v1/saude", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Errorf("a API na porta da discagem: %d, want 404", r.StatusCode)
	}
	// E a discagem não está na porta principal.
	r, err = cliente.Post(s.url()+"/freeswitch/discagem", "application/x-www-form-urlencoded", strings.NewReader("section=dialplan"))
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Errorf("a discagem na porta principal: %d, want 404", r.StatusCode)
	}
}

// As origens do /sip no modo de teste: a do chat e as do --origem, e mais nenhuma.
func TestModoTeste_OrigensDoSIP(t *testing.T) {
	prepararAmbiente(t)
	s := iniciar(t, opcoes{origens: []string{configDeTeste().OrigemDoChat(), "http://127.0.0.1:8090"}})
	for origem, want := range map[string]int{
		"https://chat.exemplo.com.br": 101, "http://127.0.0.1:8090": 101, "http://127.0.0.1:8091": 403, "": 403,
	} {
		conn, err := net.Dial("tcp", s.endereco)
		if err != nil {
			t.Fatal(err)
		}
		pedido := "GET /sip HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n"
		if origem != "" {
			pedido += "Origin: " + origem + "\r\n"
		}
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		io.WriteString(conn, pedido+"\r\n")
		resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != want {
			t.Errorf("origem %q: %d, want %d", origem, resp.StatusCode, want)
		}
		conn.Close()
	}
}

func TestRodarTeste_Escuta(t *testing.T) {
	prepararAmbiente(t)
	escutar := portaLivre(t)
	ctx, cancel := context.WithCancel(t.Context())
	fim := make(chan error, 1)
	go func() { fim <- RodarTeste(ctx, configDeTeste(), "0.1.0", escutar, []string{"http://127.0.0.1:8090"}) }()
	esperarAte(t, 3*time.Second, "o RodarTeste responder", func() bool {
		r, err := http.Get("http://" + escutar + "/agente/v1/saude")
		if err != nil {
			return false
		}
		r.Body.Close()
		return r.StatusCode == 200
	})
	cancel()
	select {
	case err := <-fim:
		if err != nil {
			t.Fatalf("RodarTeste: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("o RodarTeste não parou")
	}
}

// Um endereço ocupado é um erro, e a porta da discagem não fica aberta.
func TestRodarTeste_PortaOcupada(t *testing.T) {
	a := prepararAmbiente(t)
	ocupada, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ocupada.Close()
	if err := RodarTeste(t.Context(), configDeTeste(), "0.1.0", ocupada.Addr().String(), nil); err == nil {
		t.Fatal("RodarTeste numa porta ocupada deu certo")
	}
	if l, err := net.Listen("tcp", a.discag); err != nil {
		t.Errorf("a porta da discagem ficou aberta: %v", err)
	} else {
		l.Close()
	}
}

// ---- o certificado, o HTTP/1.1 e o HSTS (a 443, com um listener de teste) ----

// certificadoDeTeste escreve um certificado autoassinado, com este número de série, e a chave.
func certificadoDeTeste(t *testing.T, pasta string, serie int64) {
	t.Helper()
	chave, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	modelo := &x509.Certificate{
		SerialNumber: big.NewInt(serie), Subject: pkix.Name{CommonName: "video.exemplo.com.br"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames: []string{"video.exemplo.com.br"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, modelo, modelo, &chave.PublicKey, chave)
	if err != nil {
		t.Fatal(err)
	}
	chaveDER, err := x509.MarshalECPrivateKey(chave)
	if err != nil {
		t.Fatal(err)
	}
	// Grava a chave primeiro: quem relê no meio nunca vê um par trocado por mais de um instante.
	if err := os.WriteFile(filepath.Join(pasta, "chave.pem"), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: chaveDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pasta, "certificado.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		t.Fatal(err)
	}
}

func carregarDeTeste(t *testing.T, serie int64) (*certificado, string) {
	t.Helper()
	pasta := t.TempDir()
	certificadoDeTeste(t, pasta, serie)
	c, err := carregarCertificado(filepath.Join(pasta, "certificado.pem"), filepath.Join(pasta, "chave.pem"))
	if err != nil {
		t.Fatal(err)
	}
	return c, pasta
}

// serieVista faz um aperto de mão TLS e devolve o número de série do certificado que o servidor mostrou.
func serieVista(t *testing.T, endereco string) int64 {
	t.Helper()
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 3 * time.Second}, "tcp", endereco,
		&tls.Config{InsecureSkipVerify: true, ServerName: "video.exemplo.com.br"})
	if err != nil {
		t.Fatalf("aperto de mão: %v", err)
	}
	defer conn.Close()
	return conn.ConnectionState().PeerCertificates[0].SerialNumber.Int64()
}

func TestCertificado_Recarrega(t *testing.T) {
	a := prepararAmbiente(t)
	cert, pasta := carregarDeTeste(t, 1001)
	recarga := make(chan os.Signal, 1)
	s := iniciar(t, opcoes{cert: cert, recarga: recarga, origens: []string{configDeTeste().OrigemDoChat()}})
	esperarAte(t, 3*time.Second, "o ESL ligar", func() bool { return len(a.esl.Comandos()) > 1 })

	if got := serieVista(t, s.endereco); got != 1001 {
		t.Fatalf("o primeiro aperto de mão viu %d, want 1001", got)
	}

	// Um par que não vale não troca o certificado, e o servidor continua de pé.
	if err := os.WriteFile(filepath.Join(pasta, "certificado.pem"), []byte("lixo"), 0o644); err != nil {
		t.Fatal(err)
	}
	recarga <- syscall.SIGHUP
	esperarAte(t, 3*time.Second, "o reloadcert depois do SIGHUP com o par ruim", func() bool {
		return contar(a.esl.Comandos(), "api reloadcert") == 1
	})
	if got := serieVista(t, s.endereco); got != 1001 {
		t.Fatalf("com o arquivo ruim o aperto de mão viu %d, want 1001", got)
	}

	// O certificado novo.
	certificadoDeTeste(t, pasta, 2002)
	recarga <- syscall.SIGHUP
	esperarAte(t, 3*time.Second, "o aperto de mão ver o certificado novo", func() bool { return serieVista(t, s.endereco) == 2002 })
	esperarAte(t, 3*time.Second, "o segundo reloadcert", func() bool { return contar(a.esl.Comandos(), "api reloadcert") == 2 })
}

func contar(comandos []string, quero string) int {
	n := 0
	for _, c := range comandos {
		if c == quero {
			n++
		}
	}
	return n
}

// Com o FreeSWITCH respondendo -ERR (a versão sem o reloadcert), o SIGHUP só anota um aviso, e o
// certificado novo vale do mesmo jeito.
func TestCertificado_ReloadcertRecusado(t *testing.T) {
	a := prepararAmbiente(t)
	a.esl.Responder("reloadcert", "-ERR no such command\n")
	cert, pasta := carregarDeTeste(t, 1001)
	recarga := make(chan os.Signal, 1)
	log := capturar(t)
	s := iniciar(t, opcoes{cert: cert, recarga: recarga, origens: []string{configDeTeste().OrigemDoChat()}})
	esperarAte(t, 3*time.Second, "o ESL ligar", func() bool { return len(a.esl.Comandos()) > 1 })

	certificadoDeTeste(t, pasta, 3003)
	recarga <- syscall.SIGHUP
	esperarAte(t, 3*time.Second, "o aviso do reloadcert", func() bool { return strings.Contains(log.String(), "reloadcert") })
	if got := serieVista(t, s.endereco); got != 3003 {
		t.Fatalf("viu %d, want 3003", got)
	}
	if !strings.Contains(log.String(), "level=WARN") {
		t.Errorf("sem o aviso: %q", log.String())
	}
}

func TestSoHTTP1(t *testing.T) {
	prepararAmbiente(t)
	cert, _ := carregarDeTeste(t, 1001)
	s := iniciar(t, opcoes{cert: cert, origens: []string{configDeTeste().OrigemDoChat()}})

	conn, err := tls.Dial("tcp", s.endereco, &tls.Config{InsecureSkipVerify: true, ServerName: "video.exemplo.com.br", NextProtos: []string{"h2", "http/1.1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if got := conn.ConnectionState().NegotiatedProtocol; got != "http/1.1" {
		t.Fatalf("ALPN %q, want http/1.1", got)
	}
	if conn.ConnectionState().Version < tls.VersionTLS12 {
		t.Fatalf("versão %x", conn.ConnectionState().Version)
	}
	// E um cliente que só sabe o h2 não entra em HTTP/2.
	if c2, err := tls.Dial("tcp", s.endereco, &tls.Config{InsecureSkipVerify: true, ServerName: "video.exemplo.com.br", NextProtos: []string{"h2"}}); err == nil {
		if got := c2.ConnectionState().NegotiatedProtocol; got == "h2" {
			t.Errorf("o servidor aceitou o h2")
		}
		c2.Close()
	}
	// TLS 1.1 não passa.
	if c3, err := tls.Dial("tcp", s.endereco, &tls.Config{InsecureSkipVerify: true, MaxVersion: tls.VersionTLS11}); err == nil {
		c3.Close()
		t.Error("o servidor aceitou o TLS 1.1")
	}
}

func TestHSTS(t *testing.T) {
	prepararAmbiente(t)
	cert, _ := carregarDeTeste(t, 1001)
	s := iniciar(t, opcoes{cert: cert, origens: []string{configDeTeste().OrigemDoChat()}})
	cliente := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, DisableKeepAlives: true},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, caminho := range []string{"/agente/v1/saude", "/agente/v1/estado", "/sip", "/nada", "/"} {
		resp, err := cliente.Get("https://" + s.endereco + caminho)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if got := resp.Header.Get("Strict-Transport-Security"); got != "max-age=31536000" {
			t.Fatalf("%s: Strict-Transport-Security %q", caminho, got)
		}
	}
	// O /sip sem o upgrade é um 400, e o que não é rota, 404.
	resp, _ := cliente.Get("https://" + s.endereco + "/sip")
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Errorf("/sip sem upgrade: %d", resp.StatusCode)
	}
	resp, _ = cliente.Get("https://" + s.endereco + "/nada")
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Errorf("/nada: %d", resp.StatusCode)
	}
}

func TestServidorProducao_Prazos(t *testing.T) {
	cert, _ := carregarDeTeste(t, 1001)
	srv := novoServidor(nil, cert)
	if srv.ReadHeaderTimeout != 10*time.Second || srv.IdleTimeout != 120*time.Second {
		t.Errorf("ReadHeaderTimeout %v, IdleTimeout %v", srv.ReadHeaderTimeout, srv.IdleTimeout)
	}
	if srv.WriteTimeout != 0 || srv.ReadTimeout != 0 {
		t.Errorf("o servidor tem WriteTimeout %v e ReadTimeout %v: os eventos e o WebSocket ficam abertos", srv.WriteTimeout, srv.ReadTimeout)
	}
	if srv.TLSNextProto == nil || len(srv.TLSNextProto) != 0 {
		t.Errorf("TLSNextProto %v: tem de ser vazio, para só falar HTTP/1.1", srv.TLSNextProto)
	}
	if srv.TLSConfig.MinVersion != tls.VersionTLS12 || srv.TLSConfig.GetCertificate == nil {
		t.Errorf("TLSConfig sem o TLS 1.2 ou sem o GetCertificate")
	}
}

// ---- o ESL ----

func TestESL_Reconecta(t *testing.T) {
	a := prepararAmbiente(t)
	s := iniciar(t, s0())
	eventos := conectarEventos(t, s.url(), s.c.Chave)

	// A primeira conexão: um estado com o FreeSWITCH no ar e sem salas.
	ev := eventos.ate(t, ehEstado(true))
	if len(participantesDe(ev)) != 0 {
		t.Fatalf("estado inicial %v", ev)
	}
	cmds := a.esl.Comandos()
	if cmds[0] != "auth "+senhaESL || contar(cmds, "api conference json_list") != 1 {
		t.Fatalf("a conversa com o ESL: %q", cmds)
	}

	a.esl.Mandar(entra(salaA, uuidAna, anaID))
	eventos.ate(t, func(ev map[string]any) bool { return ev["tipo"] == "entrou" && ev["participante"] == anaID })

	// O FreeSWITCH cai: um acabou por sala e um estado vazio.
	a.esl.Responder("conference json_list", listaFS(salaA, uuidAna))
	combinarLigacao(a.esl, uuidAna, anaID)
	a.esl.Derrubar()
	ev = eventos.ate(t, func(ev map[string]any) bool { return ev["tipo"] == "acabou" })
	if ev["sala"] != salaA {
		t.Fatalf("acabou: %v", ev)
	}
	ev = eventos.ate(t, ehEstado(false))
	if len(ev["salas"].([]any)) != 0 {
		t.Fatalf("o estado depois da queda não veio vazio: %v", ev)
	}
	if resp := pedir(t, http.DefaultClient, "GET", s.url()+"/agente/v1/estado", s.c.Chave); resp.StatusCode != 200 {
		t.Fatalf("estado: %d", resp.StatusCode)
	} else {
		resp.Body.Close()
	}

	// A volta: o agente lê o json_list e manda um estado com a sala.
	ev = eventos.ate(t, ehEstado(true))
	if got := participantesDe(ev); !slices.Equal(got, []string{salaA + "/" + anaID}) {
		t.Fatalf("o estado da volta: %v", got)
	}

	// Mais uma queda, e agora um del-member chega enquanto a reconstrução lê: o que saiu não volta.
	combinarLigacao(a.esl, uuidBia, biaID)
	a.esl.Responder("conference json_list", listaFS(salaA, uuidAna, uuidBia))
	a.esl.Atrasar("conference json_list", 300*time.Millisecond, listaFS(salaA, uuidAna, uuidBia))
	a.esl.Derrubar()
	eventos.ate(t, ehEstado(false))
	esperarAte(t, 3*time.Second, "o terceiro json_list", func() bool { return contar(a.esl.Comandos(), "api conference json_list") == 3 })
	a.esl.Mandar(sai(salaA, uuidBia)) // a reconstrução está esperando a resposta atrasada
	ev = eventos.ate(t, ehEstado(true))
	if got := participantesDe(ev); !slices.Equal(got, []string{salaA + "/" + anaID}) {
		t.Fatalf("o que saiu durante a leitura voltou: %v", got)
	}
}

// s0 são as opções do modo de teste, com a origem do chat.
func s0() opcoes { return opcoes{origens: []string{configDeTeste().OrigemDoChat()}} }

// Quem foi tirado e liga a tela com uma senha da tela que ainda valia (a revisão final, I1): o tirar chega pela API do
// chat, os eventos pelo ESL, e o que sai para o chat pelos eventos do agente. A ligação da tela cai na hora, o layout
// não muda, e nenhum entrou sai para o chat (seção 6 do contrato).
func TestTirar_TelaDeQuemFoiTirado(t *testing.T) {
	a := prepararAmbiente(t)
	a.esl.Responder("uuid_kill", "+OK\n")
	s := iniciar(t, s0())
	eventos := conectarEventos(t, s.url(), s.c.Chave)
	eventos.ate(t, ehEstado(true))
	a.esl.Mandar(entra(salaA, uuidAna, anaID))
	a.esl.Mandar(entra(salaA, uuidBia, biaID))
	eventos.ate(t, func(ev map[string]any) bool { return ev["tipo"] == "entrou" && ev["participante"] == biaID })

	// O chat tira a Bia: o agente derruba a câmera dela, e o FreeSWITCH avisa que ela saiu.
	resp := pedir(t, http.DefaultClient, "POST", s.url()+"/agente/v1/salas/"+salaA+"/participantes/"+biaID+"/tirar", s.c.Chave)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("tirar: %d, want 204", resp.StatusCode)
	}
	esperarAte(t, 3*time.Second, "o uuid_kill da câmera da Bia", func() bool {
		return contar(a.esl.Comandos(), "api uuid_kill "+uuidBia) == 1
	})
	a.esl.Mandar(sai(salaA, uuidBia))
	if ev := eventos.proximo(t); ev["tipo"] != "saiu" || ev["participante"] != biaID {
		t.Fatalf("depois do tirar, o chat recebeu %v; want o saiu da Bia", ev)
	}

	// A Bia liga a tela com a senha que ainda valia.
	a.esl.Mandar(entraTela(salaA, uuidBiaTela, biaID))
	esperarAte(t, 3*time.Second, "o uuid_kill da tela da Bia", func() bool {
		return contar(a.esl.Comandos(), "api uuid_kill "+uuidBiaTela) == 1
	})
	a.esl.Mandar(sai(salaA, uuidBiaTela))
	// Os eventos saem na ordem: o próximo que o chat recebe é a entrada do Carlos, e nada da tela da Bia.
	a.esl.Mandar(entra(salaA, uuidCarlos, carlosID))
	if ev := eventos.proximo(t); ev["tipo"] != "entrou" || ev["participante"] != carlosID {
		t.Fatalf("depois da tela da Bia, o chat recebeu %v; want a entrada do Carlos", ev)
	}
	for _, c := range a.esl.Comandos() {
		if strings.Contains(c, "vid-layout") {
			t.Errorf("o layout mudou: %q", c)
		}
	}
}

// Sem o FreeSWITCH no ar, o agente continua de pé, diz isso nos eventos e tenta de novo, com a espera subindo.
func TestESL_ForaDoAr(t *testing.T) {
	prepararAmbiente(t)
	fora := portaLivre(t)
	trocar(t, &enderecoESL, fora)
	trocar(t, &esperaESLMinima, 10*time.Millisecond)
	trocar(t, &esperaESLMaxima, 40*time.Millisecond)
	s := iniciar(t, s0())
	eventos := conectarEventos(t, s.url(), s.c.Chave)
	ev := eventos.ate(t, ehEstado(false))
	if len(ev["salas"].([]any)) != 0 {
		t.Fatalf("estado %v", ev)
	}
	resp := pedir(t, http.DefaultClient, "POST", s.url()+"/agente/v1/salas/"+salaA+"/encerrar", s.c.Chave)
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Errorf("encerrar sem o ESL: %d, want 503", resp.StatusCode)
	}
}

func TestProximaEspera(t *testing.T) {
	var got []time.Duration
	e := 2 * time.Second
	for range 6 {
		got = append(got, e)
		e = proximaEspera(e, 10*time.Second)
	}
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 10 * time.Second, 10 * time.Second, 10 * time.Second}
	if !slices.Equal(got, want) {
		t.Fatalf("esperas %v, want %v", got, want)
	}
}

// ---- o uso, o desligamento e os registros ----

func TestUso_UltimaLeitura(t *testing.T) {
	a := prepararAmbiente(t)
	trocar(t, &intervaloUso, time.Hour) // só a leitura do começo
	trocar(t, &primeiraCPU, time.Hour)
	s := iniciar(t, s0())
	estado := func() (cpu, memoria float64) {
		resp := pedir(t, http.DefaultClient, "GET", s.url()+"/agente/v1/estado", s.c.Chave)
		defer resp.Body.Close()
		var corpo struct {
			Versao string `json:"versao"`
			Uso    struct{ CPU, Memoria float64 }
		}
		if err := json.NewDecoder(resp.Body).Decode(&corpo); err != nil {
			t.Fatal(err)
		}
		if corpo.Versao != "0.1.0" {
			t.Errorf("versao %q", corpo.Versao)
		}
		return corpo.Uso.CPU, corpo.Uso.Memoria
	}
	esperarAte(t, 3*time.Second, "a leitura do começo", func() bool { _, m := estado(); return m == 25 })

	// O /proc muda, mas o estado dá a última leitura: nenhum pedido mede de novo.
	escrever(t, a.proc, "meminfo", "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    2000000 kB\n")
	escrever(t, a.proc, "stat", "cpu  900 0 50 850 50 0 0 0 0 0\n")
	for range 3 {
		if _, m := estado(); m != 25 {
			t.Fatalf("o pedido mediu de novo: memória %v", m)
		}
	}
}

func TestUso_MedeACadaIntervalo(t *testing.T) {
	a := prepararAmbiente(t)
	trocar(t, &intervaloUso, 30*time.Millisecond)
	s := iniciar(t, s0())
	escrever(t, a.proc, "meminfo", "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    2000000 kB\n")
	esperarAte(t, 3*time.Second, "a memória nova no estado", func() bool {
		resp := pedir(t, http.DefaultClient, "GET", s.url()+"/agente/v1/estado", s.c.Chave)
		defer resp.Body.Close()
		var corpo struct{ Uso struct{ Memoria int } }
		json.NewDecoder(resp.Body).Decode(&corpo)
		return corpo.Uso.Memoria == 75
	})
}

// A leitura do começo não tem com que comparar a CPU, e o estado dava a CPU 0 até a leitura do primeiro intervalo, um
// minuto depois (a revisão final, M9). A segunda leitura vem segundos depois do começo. O /proc de teste conta a CPU
// sempre andando, com 30% ocupada: o estado dá os 30 logo, com o intervalo de uma hora e sem olhar a máquina.
func TestUso_PrimeiraCPULogo(t *testing.T) {
	a := prepararAmbiente(t)
	trocar(t, &intervaloUso, time.Hour)
	trocar(t, &primeiraCPU, 50*time.Millisecond)
	parar, parou := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(parou)
		ocupado, livre := 100, 900
		for {
			select {
			case <-parar:
				return
			case <-time.After(5 * time.Millisecond):
			}
			// A cada passo, 10 a mais no total e 3 deles ocupados; o arquivo troca de uma vez (o rename).
			ocupado, livre = ocupado+3, livre+7
			novo := filepath.Join(a.proc, "stat.novo")
			if os.WriteFile(novo, fmt.Appendf(nil, "cpu  %d 0 0 %d 0 0 0 0 0 0\n", ocupado, livre), 0o644) == nil {
				os.Rename(novo, filepath.Join(a.proc, "stat"))
			}
		}
	}()
	t.Cleanup(func() {
		close(parar)
		<-parou
	})
	s := iniciar(t, s0())
	cpu := func() int {
		resp := pedir(t, http.DefaultClient, "GET", s.url()+"/agente/v1/estado", s.c.Chave)
		defer resp.Body.Close()
		var corpo struct{ Uso struct{ CPU int } }
		if err := json.NewDecoder(resp.Body).Decode(&corpo); err != nil {
			t.Fatal(err)
		}
		return corpo.Uso.CPU
	}
	esperarAte(t, 3*time.Second, "a CPU de 30% no estado, antes do primeiro intervalo", func() bool { return cpu() == 30 })
}

// gorotinasNossas lista as goroutines que ainda rodam código do agente, fora o dos testes e o do ESL falso.
func gorotinasNossas() []string {
	buf := make([]byte, 1<<20)
	buf = buf[:runtime.Stack(buf, true)]
	var achadas []string
	for _, g := range strings.Split(string(buf), "\n\n") {
		if !strings.Contains(g, "video-servidor/internal/") || strings.Contains(g, "esltest.") ||
			strings.Contains(g, "servidor.Test") || strings.Contains(g, "servidor.iniciar") || strings.Contains(g, "testing.") {
			continue
		}
		achadas = append(achadas, g)
	}
	return achadas
}

func TestDesligarComCalma(t *testing.T) {
	a := prepararAmbiente(t)
	a.esl.Responder("conference json_list", "[]")
	s := iniciar(t, s0())
	cliente := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}

	// Um cliente dos eventos aberto e um túnel do /sip aberto: nenhum dos dois segura o desligamento.
	eventos := conectarEventos(t, s.url(), s.c.Chave)
	eventos.ate(t, ehEstado(true))
	tunel, err := net.Dial("tcp", s.endereco)
	if err != nil {
		t.Fatal(err)
	}
	defer tunel.Close()
	tunel.SetDeadline(time.Now().Add(10 * time.Second))
	io.WriteString(tunel, "GET /sip HTTP/1.1\r\nHost: x\r\nOrigin: "+s.c.OrigemDoChat()+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
	rt := bufio.NewReader(tunel)
	if resp, err := http.ReadResponse(rt, nil); err != nil || resp.StatusCode != 101 {
		t.Fatalf("o túnel: %v %v", resp, err)
	}

	if d := s.parar(t); d >= 10*time.Second {
		t.Fatalf("o agente levou %v para fechar", d)
	} else if d > 5*time.Second {
		t.Errorf("o agente levou %v: devia fechar logo, com os eventos soltos antes do Shutdown", d)
	}
	// Os eventos acabaram, o túnel fechou, as portas fecharam.
	if _, err := io.ReadAll(eventos.r); err != nil {
		t.Logf("os eventos fecharam com: %v", err)
	}
	if _, err := rt.ReadByte(); err == nil {
		t.Error("o túnel do /sip continua aberto")
	}
	if c, err := net.DialTimeout("tcp", s.endereco, time.Second); err == nil {
		c.Close()
		t.Error("a porta principal continua aberta")
	}
	if c, err := net.DialTimeout("tcp", a.discag, time.Second); err == nil {
		c.Close()
		t.Error("a porta da discagem continua aberta")
	}
	cliente.CloseIdleConnections()
	esperarAte(t, 3*time.Second, "nenhuma goroutine do agente sobrar", func() bool { return len(gorotinasNossas()) == 0 })
	if sobrou := gorotinasNossas(); len(sobrou) != 0 {
		t.Fatalf("sobraram goroutines: %s", strings.Join(sobrou, "\n\n"))
	}
}

// Desligar com o ESL fora do ar e com um pedido preso no destino também acaba dentro do prazo.
func TestDesligarComCalma_ESLEmReconexao(t *testing.T) {
	prepararAmbiente(t)
	trocar(t, &enderecoESL, portaLivre(t))
	trocar(t, &esperaESLMinima, 5*time.Second) // dormindo na espera: o ctx tem de acordar o laço
	trocar(t, &esperaESLMaxima, 10*time.Second)
	s := iniciar(t, s0())
	time.Sleep(100 * time.Millisecond)
	if d := s.parar(t); d > 3*time.Second {
		t.Fatalf("levou %v", d)
	}
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

// capturar troca o log por um que escreve no buffer, até o fim do teste.
func capturar(t *testing.T) *syncBuffer {
	t.Helper()
	b := &syncBuffer{}
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(b, nil)))
	t.Cleanup(func() { slog.SetDefault(antigo) })
	return b
}

// Nos registros nunca ficam a chave, a senha do ESL, uma sala, um participante, uma ligação nem nada do
// caminho de um pedido.
func TestLogs_SemSegredos(t *testing.T) {
	a := prepararAmbiente(t)
	log := capturar(t)
	a.esl.Responder("conference json_list", listaFS(salaA, uuidAna))
	combinarLigacao(a.esl, uuidAna, anaID)
	cert, pasta := carregarDeTeste(t, 1001)
	recarga := make(chan os.Signal, 1)
	s := iniciar(t, opcoes{cert: cert, recarga: recarga, origens: []string{configDeTeste().OrigemDoChat()}})
	cliente := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, DisableKeepAlives: true}}
	base := "https://" + s.endereco
	esperarAte(t, 3*time.Second, "o ESL ligar", func() bool { return len(a.esl.Comandos()) > 2 })
	a.esl.Mandar(entra(salaA, uuidBia, biaID))
	for _, alvo := range []string{
		"/agente/v1/estado", "/agente/v1/salas/" + salaA + "/participantes/" + anaID + "/tirar", "/segredo-no-caminho?chave=" + s.c.Chave, "/sip",
	} {
		metodo := "GET"
		if strings.HasSuffix(alvo, "/tirar") {
			metodo = "POST"
		}
		resp := pedir(t, cliente, metodo, base+alvo, s.c.Chave)
		resp.Body.Close()
	}
	// Uma queda do ESL e uma recarga com o arquivo ruim.
	os.WriteFile(filepath.Join(pasta, "certificado.pem"), []byte("lixo"), 0o644)
	recarga <- syscall.SIGHUP
	a.esl.Derrubar()
	esperarAte(t, 3*time.Second, "o aviso da recarga", func() bool { return strings.Contains(log.String(), "certificado") })
	time.Sleep(200 * time.Millisecond)
	s.parar(t)

	texto := log.String()
	for nome, proibido := range map[string]string{
		"a chave": s.c.Chave, "a senha do ESL": senhaESL, "a sala": salaA, "o participante": anaID, "o outro participante": biaID,
		"a ligação": uuidAna, "o caminho": "segredo-no-caminho", "a consulta": "chave=",
	} {
		if strings.Contains(texto, proibido) {
			t.Errorf("o registro tem %s (%q):\n%s", nome, proibido, texto)
		}
	}
	if !strings.Contains(texto, "rota=") {
		t.Errorf("o registro dos pedidos sumiu:\n%s", texto)
	}
}
