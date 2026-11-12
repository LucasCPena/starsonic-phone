package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

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
