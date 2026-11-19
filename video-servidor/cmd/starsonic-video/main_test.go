package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

func TestVersao(t *testing.T) {
	var saida, erros bytes.Buffer
	if codigo := run([]string{"versao"}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0", codigo)
	}
	if saida.String() != "0.0.0-dev\n" {
		t.Errorf("saída %q, want %q", saida.String(), "0.0.0-dev\n")
	}

	// Um uso errado vai para a saída de erros.
	saida.Reset()
	if codigo := run([]string{"inexistente"}, &saida, &erros); codigo != 2 {
		t.Errorf("subcomando desconhecido: código %d, want 2", codigo)
	}
	if !strings.Contains(erros.String(), "subcomando desconhecido: inexistente") || !strings.Contains(erros.String(), "uso: starsonic-video") {
		t.Errorf("sem o uso em português: %q", erros.String())
	}
	if saida.Len() != 0 {
		t.Errorf("o uso foi para a saída: %q", saida.String())
	}

	erros.Reset()
	if codigo := run(nil, &saida, &erros); codigo != 2 || !strings.Contains(erros.String(), "uso: starsonic-video") {
		t.Errorf("sem argumentos: codigo %d, erros %q", codigo, erros.String())
	}
	if saida.Len() != 0 {
		t.Errorf("sem argumentos, o uso foi para a saída: %q", saida.String())
	}
}

func TestChave(t *testing.T) {
	var saida, erros bytes.Buffer
	if codigo := run([]string{"chave"}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0", codigo)
	}
	texto := saida.String()
	if len(texto) != 44 || !strings.HasSuffix(texto, "\n") {
		t.Fatalf("saída %q: want uma linha de 43 caracteres", texto)
	}
	if _, err := senha.LerChave(strings.TrimSuffix(texto, "\n")); err != nil {
		t.Errorf("LerChave: %v", err)
	}
}

// configDeTeste escreve um config.json numa pasta temporária, com uma chave nova, e devolve o caminho
// e a chave.
func configDeTeste(t *testing.T) (caminho, chave string) {
	t.Helper()
	chave = senha.NovaChave()
	caminho = filepath.Join(t.TempDir(), "config.json")
	conteudo := `{"endereco": "video.exemplo.com.br", "chat": "chat.exemplo.com.br", "chave": "` + chave +
		`", "senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56", "ipPrivado": "10.0.0.5", "ipPublico": "203.0.113.10"}`
	if err := os.WriteFile(caminho, []byte(conteudo), 0o600); err != nil {
		t.Fatal(err)
	}
	return caminho, chave
}

// modo confere o tipo (arquivo ou pasta) e as permissões de um caminho.
func modo(t *testing.T, caminho string, pasta bool, permissoes os.FileMode) {
	t.Helper()
	info, err := os.Stat(caminho)
	if err != nil {
		t.Errorf("%v", err)
		return
	}
	if info.IsDir() != pasta {
		t.Errorf("%s: pasta = %v, want %v", caminho, info.IsDir(), pasta)
	}
	if info.Mode().Perm() != permissoes {
		t.Errorf("%s: permissões %v, want %v", caminho, info.Mode().Perm(), permissoes)
	}
}

// arquivos devolve os nomes dentro de uma pasta, em ordem.
func arquivos(t *testing.T, pasta string) []string {
	t.Helper()
	entradas, err := os.ReadDir(pasta)
	if err != nil {
		t.Fatal(err)
	}
	var nomes []string
	for _, e := range entradas {
		nomes = append(nomes, e.Name())
	}
	return nomes
}

func TestConfigurar(t *testing.T) {
	arquivo, _ := configDeTeste(t)

	for _, teste := range []bool{false, true} {
		pasta := filepath.Join(t.TempDir(), "etc")
		args := []string{"configurar", "--config", arquivo, "--saida", pasta}
		if teste {
			args = append(args, "--teste")
		}
		var saida, erros bytes.Buffer
		if codigo := run(args, &saida, &erros); codigo != 0 {
			t.Fatalf("teste=%v: código %d, want 0 (erros: %q)", teste, codigo, erros.String())
		}

		modo(t, filepath.Join(pasta, "freeswitch", "freeswitch.xml"), false, 0o640)
		modo(t, filepath.Join(pasta, "freeswitch", "sem-camera.png"), false, 0o644)
		modo(t, filepath.Join(pasta, "freeswitch", "tls"), true, 0o750)
		modo(t, filepath.Join(pasta, "turnserver.conf"), false, 0o640)
		if got := arquivos(t, pasta); !slices.Equal(got, []string{"freeswitch", "turnserver.conf"}) {
			t.Errorf("teste=%v: a pasta tem %q", teste, got)
		}
		if got := arquivos(t, filepath.Join(pasta, "freeswitch")); !slices.Equal(got, []string{"freeswitch.xml", "sem-camera.png", "tls"}) {
			t.Errorf("teste=%v: a pasta freeswitch tem %q", teste, got)
		}

		tlsPasta := filepath.Join(pasta, "freeswitch", "tls")
		if !teste {
			// Em produção, o certificado do perfil tls é do certificado.sh.
			if got := arquivos(t, tlsPasta); len(got) != 0 {
				t.Errorf("sem --teste, a pasta tls tem %q", got)
			}
			continue
		}

		// No modo de teste, o certificado autoassinado do endereço: a chave e o certificado no
		// agent.pem, e o mesmo certificado no cafile.pem.
		if got := arquivos(t, tlsPasta); !slices.Equal(got, []string{"agent.pem", "cafile.pem"}) {
			t.Fatalf("com --teste, a pasta tls tem %q", got)
		}
		modo(t, filepath.Join(tlsPasta, "agent.pem"), false, 0o600)
		modo(t, filepath.Join(tlsPasta, "cafile.pem"), false, 0o644)
		agent, err := os.ReadFile(filepath.Join(tlsPasta, "agent.pem"))
		if err != nil {
			t.Fatal(err)
		}
		cafile, err := os.ReadFile(filepath.Join(tlsPasta, "cafile.pem"))
		if err != nil {
			t.Fatal(err)
		}
		primeiro, resto := pem.Decode(agent)
		if primeiro == nil || primeiro.Type != "PRIVATE KEY" {
			t.Fatalf("o agent.pem não começa pela chave privada")
		}
		if !bytes.Equal(resto, cafile) {
			t.Errorf("o certificado do agent.pem não é o do cafile.pem")
		}
		par, err := tls.X509KeyPair(agent, agent)
		if err != nil {
			t.Fatalf("o agent.pem não é um par de chave e certificado: %v", err)
		}
		cert, err := x509.ParseCertificate(par.Certificate[0])
		if err != nil {
			t.Fatal(err)
		}
		if cert.Subject.CommonName != "video.exemplo.com.br" || !slices.Equal(cert.DNSNames, []string{"video.exemplo.com.br"}) {
			t.Errorf("o certificado é de %q %q, want video.exemplo.com.br", cert.Subject.CommonName, cert.DNSNames)
		}
		if err := cert.VerifyHostname("video.exemplo.com.br"); err != nil {
			t.Errorf("VerifyHostname: %v", err)
		}
		// ECDSA P-256, o tipo de chave que o certbot faz por padrão.
		if k, ok := cert.PublicKey.(*ecdsa.PublicKey); !ok || k.Curve != elliptic.P256() {
			t.Errorf("a chave é %v, want ECDSA P-256", cert.PublicKeyAlgorithm)
		}
	}
}

func TestConfigurar_Erros(t *testing.T) {
	arquivo, _ := configDeTeste(t)
	pasta := filepath.Join(t.TempDir(), "etc")
	ruim := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(ruim, []byte(`{"endereco": "video"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	casos := []struct {
		nome   string
		args   []string
		codigo int
	}{
		{"sem a saída", []string{"configurar", "--config", arquivo}, 2},
		{"sem a config", []string{"configurar", "--saida", pasta}, 2},
		{"argumento a mais", []string{"configurar", "--config", arquivo, "--saida", pasta, "x"}, 2},
		{"opção desconhecida", []string{"configurar", "--config", arquivo, "--saida", pasta, "--producao"}, 2},
		{"config que não vale", []string{"configurar", "--config", ruim, "--saida", pasta}, 1},
		{"config que não existe", []string{"configurar", "--config", filepath.Join(t.TempDir(), "nada.json"), "--saida", pasta}, 1},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			var saida, erros bytes.Buffer
			if codigo := run(caso.args, &saida, &erros); codigo != caso.codigo {
				t.Errorf("código %d, want %d", codigo, caso.codigo)
			}
			if erros.Len() == 0 || saida.Len() != 0 {
				t.Errorf("saída %q e erros %q: o erro vai para os erros", saida.String(), erros.String())
			}
		})
	}
	if _, err := os.Stat(pasta); !os.IsNotExist(err) {
		t.Errorf("um configurar que deu erro escreveu a pasta: %v", err)
	}
}

func TestMostrarChave(t *testing.T) {
	arquivo, chave := configDeTeste(t)
	var saida, erros bytes.Buffer
	if codigo := run([]string{"mostrar-chave", "--config", arquivo}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0 (erros: %q)", codigo, erros.String())
	}
	if saida.String() != chave+"\n" {
		t.Errorf("saída %q, want só a chave", saida.String())
	}

	saida.Reset()
	erros.Reset()
	if codigo := run([]string{"mostrar-chave", "--config", filepath.Join(t.TempDir(), "nada.json")}, &saida, &erros); codigo != 1 {
		t.Errorf("sem o arquivo: código %d, want 1", codigo)
	}
	if saida.Len() != 0 || erros.Len() == 0 {
		t.Errorf("sem o arquivo: saída %q e erros %q", saida.String(), erros.String())
	}
}

func TestServir_ModoTesteSoLocal(t *testing.T) {
	for _, escutar := range []string{"0.0.0.0:8095", "192.168.0.5:80", "localhost:8095", "[::]:8095"} {
		var saida, erros bytes.Buffer
		codigo := run([]string{"servir", "--teste", "--escutar", escutar}, &saida, &erros)
		if codigo != 2 {
			t.Errorf("%q: código %d, want 2", escutar, codigo)
		}
		if !strings.Contains(erros.String(), "o modo de teste só escuta em 127.0.0.1 ou [::1]") {
			t.Errorf("%q: erros %q", escutar, erros.String())
		}
		if saida.Len() != 0 {
			t.Errorf("%q: saída %q", escutar, saida.String())
		}
	}
}

func TestServir_UsoErrado(t *testing.T) {
	casos := map[string][]string{
		"escutar sem teste":     {"servir", "--escutar", "127.0.0.1:8095"},
		"origem sem teste":      {"servir", "--origem", "http://127.0.0.1:8090"},
		"argumento sobrando":    {"servir", "sobra"},
		"origem com caminho":    {"servir", "--teste", "--origem", "http://127.0.0.1:8090/x"},
		"origem sem esquema":    {"servir", "--teste", "--origem", "127.0.0.1:8090"},
		"flag que não existe":   {"servir", "--inexistente"},
		"origem com a consulta": {"servir", "--teste", "--origem", "http://127.0.0.1:8090?a=b"},
	}
	for nome, args := range casos {
		var saida, erros bytes.Buffer
		if codigo := run(args, &saida, &erros); codigo != 2 {
			t.Errorf("%s: código %d, want 2 (erros %q)", nome, codigo, erros.String())
		}
		if saida.Len() != 0 {
			t.Errorf("%s: saída %q", nome, saida.String())
		}
	}
}

// Um config.json que não vale é um erro de execução (1), e nada sobe.
func TestServir_ConfigRuim(t *testing.T) {
	var saida, erros bytes.Buffer
	if codigo := run([]string{"servir", "--config", filepath.Join(t.TempDir(), "nao-existe.json")}, &saida, &erros); codigo != 1 {
		t.Errorf("código %d, want 1", codigo)
	}
	if !strings.HasPrefix(erros.String(), "Erro: ") {
		t.Errorf("erros %q", erros.String())
	}
}

func TestUso_ListaOServir(t *testing.T) {
	var saida, erros bytes.Buffer
	run(nil, &saida, &erros)
	if !strings.Contains(erros.String(), "servir [--config <arquivo>]") {
		t.Errorf("o uso não fala do servir: %q", erros.String())
	}
	if !strings.Contains(erros.String(), "reunioes [--config <arquivo>]") {
		t.Errorf("o uso não fala do reunioes: %q", erros.String())
	}
}

// O estado de um agente com duas reuniões, uma delas com a tela compartilhada: três ligações, duas salas.
const estadoDuasSalas = `{"versao":"0.1.0","freeswitch":true,"agora":1794495600000,"salas":[` +
	`{"sala":"0123456789abcdef0123456789abcdef","participantes":[{"participante":"0011223344556677","tela":false},` +
	`{"participante":"0011223344556677","tela":true}]},` +
	`{"sala":"fedcba9876543210fedcba9876543210","participantes":[{"participante":"8899aabbccddeeff","tela":false}]}],` +
	`"uso":{"cpu":34,"memoria":41}}`

// agenteDeTeste faz o papel do agente no estado: com a chave, responde o estado de agora; sem ela, o 401 da
// seção 5 do docs/video-agente.md. Guarda o Authorization de cada pedido.
type agenteDeTeste struct {
	chave  string
	estado atomic.Pointer[string]

	mu      sync.Mutex
	pedidos []string
}

func novoAgenteDeTeste(chave, estado string) *agenteDeTeste {
	a := &agenteDeTeste{chave: chave}
	a.responder(estado)
	return a
}

// responder troca o corpo das próximas respostas ao estado.
func (a *agenteDeTeste) responder(corpo string) { a.estado.Store(&corpo) }

func (a *agenteDeTeste) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	a.pedidos = append(a.pedidos, r.Header.Get("Authorization"))
	a.mu.Unlock()
	if r.Method != http.MethodGet || r.URL.Path != "/agente/v1/estado" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != "Bearer "+a.chave {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"erro":"chave"}`)
		return
	}
	fmt.Fprint(w, *a.estado.Load())
}

func (a *agenteDeTeste) ultimoPedido() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.pedidos) == 0 {
		return ""
	}
	return a.pedidos[len(a.pedidos)-1]
}

func TestContarReunioes(t *testing.T) {
	chave := senha.NovaChave()
	agente := novoAgenteDeTeste(chave, estadoDuasSalas)
	srv := httptest.NewTLSServer(agente)
	defer srv.Close()
	url := srv.URL + "/agente/v1/estado"
	ctx := context.Background()

	t.Run("manda a chave e conta as salas", func(t *testing.T) {
		n, err := contarReunioes(ctx, srv.Client(), url, chave)
		if err != nil || n != 2 {
			t.Fatalf("contarReunioes = %d, %v; want 2, nil", n, err)
		}
		if got := agente.ultimoPedido(); got != "Bearer "+chave {
			t.Errorf("Authorization %q, want o Bearer com a chave", got)
		}
	})

	t.Run("nenhuma reunião", func(t *testing.T) {
		agente.responder(`{"versao":"0.1.0","freeswitch":true,"agora":1794495600000,"salas":[],"uso":{"cpu":0,"memoria":12}}`)
		defer agente.responder(estadoDuasSalas)
		if n, err := contarReunioes(ctx, srv.Client(), url, chave); err != nil || n != 0 {
			t.Errorf("contarReunioes = %d, %v; want 0, nil", n, err)
		}
	})

	t.Run("outra chave", func(t *testing.T) {
		n, err := contarReunioes(ctx, srv.Client(), url, senha.NovaChave())
		if err == nil || !strings.Contains(err.Error(), "401") {
			t.Errorf("contarReunioes = %d, %v; want o erro do 401", n, err)
		}
	})

	t.Run("uma resposta sem o estado", func(t *testing.T) {
		defer agente.responder(estadoDuasSalas)
		for _, corpo := range []string{`{"ok":true}`, `não é JSON`, `{"salas":3}`} {
			agente.responder(corpo)
			if n, err := contarReunioes(ctx, srv.Client(), url, chave); err == nil {
				t.Errorf("%s: contarReunioes = %d, nil; want um erro", corpo, n)
			}
		}
	})

	// O cliente do reunioes confere o certificado pelo endereço do servidor de vídeo (o ServerName), e não pelo
	// 127.0.0.1 do pedido.
	t.Run("o certificado é conferido pelo endereço", func(t *testing.T) {
		raizes := x509.NewCertPool()
		raizes.AddCert(srv.Certificate())
		nome := srv.Certificate().DNSNames[0]
		if n, err := contarReunioes(ctx, clienteDoAgente(nome, raizes), url, chave); err != nil || n != 2 {
			t.Errorf("com o ServerName %s: contarReunioes = %d, %v; want 2, nil", nome, n, err)
		}
		if n, err := contarReunioes(ctx, clienteDoAgente("video.exemplo.com.br", raizes), url, chave); err == nil {
			t.Errorf("com um certificado de outro nome: contarReunioes = %d, nil; want um erro", n)
		}
		if n, err := contarReunioes(ctx, clienteDoAgente(nome, x509.NewCertPool()), url, chave); err == nil {
			t.Errorf("com um certificado que não é das raízes: contarReunioes = %d, nil; want um erro", n)
		}
	})

	t.Run("sem resposta", func(t *testing.T) {
		srv.Close()
		if n, err := contarReunioes(ctx, srv.Client(), url, chave); err == nil {
			t.Errorf("contarReunioes = %d, nil; want um erro", n)
		}
	})
}

// certificadoDe faz um certificado autoassinado para o nome, como o do Let's Encrypt para o endereço, e as raízes
// que o aceitam.
func certificadoDe(t *testing.T, nome string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	chave, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	modelo := &x509.Certificate{
		Subject:               pkix.Name{CommonName: nome},
		DNSNames:              []string{nome},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, modelo, modelo, &chave.PublicKey, chave)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	raizes := x509.NewCertPool()
	raizes.AddCert(cert)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: chave}, raizes
}

// O subcomando reunioes, pelo run: pede o estado com a chave e o endereço do config.json e escreve só o número de
// salas. Sem o agente, sai com 1 e não escreve nada na saída.
func TestReunioes(t *testing.T) {
	arquivo, chave := configDeTeste(t)
	par, raizes := certificadoDe(t, "video.exemplo.com.br")
	agente := novoAgenteDeTeste(chave, estadoDuasSalas)
	srv := httptest.NewUnstartedServer(agente)
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{par}}
	srv.StartTLS()
	defer srv.Close()

	urlAntes, raizesAntes := urlEstado, raizesDoAgente
	urlEstado, raizesDoAgente = srv.URL+"/agente/v1/estado", raizes
	t.Cleanup(func() { urlEstado, raizesDoAgente = urlAntes, raizesAntes })

	var saida, erros bytes.Buffer
	if codigo := run([]string{"reunioes", "--config", arquivo}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0 (erros: %q)", codigo, erros.String())
	}
	if saida.String() != "2\n" || erros.Len() != 0 {
		t.Errorf("saída %q e erros %q, want só \"2\\n\"", saida.String(), erros.String())
	}
	if got := agente.ultimoPedido(); got != "Bearer "+chave {
		t.Errorf("Authorization %q, want o Bearer com a chave do config.json", got)
	}

	casos := []struct {
		nome   string
		args   []string
		codigo int
	}{
		{"argumento a mais", []string{"reunioes", "--config", arquivo, "x"}, 2},
		{"opção desconhecida", []string{"reunioes", "--agora"}, 2},
		{"config que não existe", []string{"reunioes", "--config", filepath.Join(t.TempDir(), "nada.json")}, 1},
	}
	for _, caso := range casos {
		saida.Reset()
		erros.Reset()
		if codigo := run(caso.args, &saida, &erros); codigo != caso.codigo {
			t.Errorf("%s: código %d, want %d", caso.nome, codigo, caso.codigo)
		}
		if saida.Len() != 0 || erros.Len() == 0 {
			t.Errorf("%s: saída %q e erros %q", caso.nome, saida.String(), erros.String())
		}
	}

	srv.Close()
	saida.Reset()
	erros.Reset()
	if codigo := run([]string{"reunioes", "--config", arquivo}, &saida, &erros); codigo != 1 {
		t.Errorf("sem o agente: código %d, want 1", codigo)
	}
	if saida.Len() != 0 || !strings.HasPrefix(erros.String(), "Erro: ") {
		t.Errorf("sem o agente: saída %q e erros %q", saida.String(), erros.String())
	}
	if strings.Contains(erros.String(), chave) {
		t.Errorf("o erro mostra a chave: %q", erros.String())
	}
}

// O reunioes pergunta ao agente na porta do config.json: a 443 quando ela falta, e a "porta" quando tem.
func TestUrlDoEstado(t *testing.T) {
	casos := map[int]string{
		0:    "https://127.0.0.1/agente/v1/estado",
		443:  "https://127.0.0.1/agente/v1/estado",
		7443: "https://127.0.0.1:7443/agente/v1/estado",
	}
	for porta, want := range casos {
		if got := urlDoEstado(porta); got != want {
			t.Errorf("urlDoEstado(%d) = %q, want %q", porta, got, want)
		}
	}
}
