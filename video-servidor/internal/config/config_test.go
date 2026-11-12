package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A chave do vetor de teste da seção 3 do docs/video-agente.md (os bytes 0 a 31).
const chaveVetor = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

// certo é um config.json que vale. Cada caso de TestConfig_Ler troca um trecho dele.
const certo = `{
  "endereco": "video.exemplo.com.br",
  "chat": "chat.exemplo.com.br",
  "chave": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56",
  "ipPrivado": "10.0.0.5",
  "ipPublico": "203.0.113.10"
}`

func escreverConfig(t *testing.T, conteudo string) string {
	t.Helper()
	caminho := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(caminho, []byte(conteudo), 0o600); err != nil {
		t.Fatal(err)
	}
	return caminho
}

// com devolve o config.json certo com um trecho trocado.
func com(t *testing.T, de, para string) string {
	t.Helper()
	if !strings.Contains(certo, de) {
		t.Fatalf("o config.json certo não tem %q", de)
	}
	return strings.Replace(certo, de, para, 1)
}

func TestConfig_Ler(t *testing.T) {
	t.Run("um arquivo certo é lido", func(t *testing.T) {
		c, err := Ler(escreverConfig(t, certo))
		if err != nil {
			t.Fatal(err)
		}
		esperada := Config{
			Endereco:  "video.exemplo.com.br",
			Chat:      "chat.exemplo.com.br",
			Chave:     chaveVetor,
			SenhaESL:  "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56",
			IPPrivado: "10.0.0.5",
			IPPublico: "203.0.113.10",
		}
		if c != esperada {
			t.Errorf("config %+v, want %+v", c, esperada)
		}
		if got := c.OrigemDoChat(); got != "https://chat.exemplo.com.br" {
			t.Errorf("OrigemDoChat = %q, want https://chat.exemplo.com.br", got)
		}
		chave := c.ChaveCrua()
		if len(chave) != 32 {
			t.Fatalf("ChaveCrua tem %d bytes, want 32", len(chave))
		}
		for i, b := range chave {
			if int(b) != i {
				t.Fatalf("ChaveCrua: byte %d = %d, want %d", i, b, i)
			}
		}
	})

	// O chat aceita um nome ou um IPv4, com a porta quando ele usa uma.
	aceitos := map[string]struct{ chat, origem string }{
		"o chat com porta":          {"chat.exemplo.com.br:8443", "https://chat.exemplo.com.br:8443"},
		"o chat num IPv4 com porta": {"127.0.0.1:4191", "https://127.0.0.1:4191"},
		"o chat num IPv4":           {"192.0.2.10", "https://192.0.2.10"},
	}
	for nome, caso := range aceitos {
		t.Run(nome, func(t *testing.T) {
			c, err := Ler(escreverConfig(t, com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "`+caso.chat+`"`)))
			if err != nil {
				t.Fatal(err)
			}
			if got := c.OrigemDoChat(); got != caso.origem {
				t.Errorf("OrigemDoChat = %q, want %q", got, caso.origem)
			}
		})
	}
	t.Run("os dois IPs iguais", func(t *testing.T) {
		if _, err := Ler(escreverConfig(t, com(t, `"ipPublico": "203.0.113.10"`, `"ipPublico": "10.0.0.5"`))); err != nil {
			t.Fatal(err)
		}
	})

	// Cada caso não vale, e o erro diz o campo. Um erro nunca mostra a chave nem a senha do ESL.
	recusas := []struct {
		nome, conteudo, campo string
	}{
		{"endereco com https://", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "https://video.exemplo.com.br"`), `"endereco"`},
		{"endereco com porta", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "video.exemplo.com.br:443"`), `"endereco"`},
		{"endereco sem ponto", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "video"`), `"endereco"`},
		{"endereco com caminho", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "video.exemplo.com.br/x"`), `"endereco"`},
		{"endereco com maiúsculas", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "Video.Exemplo.com.br"`), `"endereco"`},
		{"endereco que é um IP", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": "203.0.113.10"`), `"endereco"`},
		{"endereco vazio", com(t, `"endereco": "video.exemplo.com.br"`, `"endereco": ""`), `"endereco"`},
		{"chat com caminho", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat.exemplo.com.br/x"`), `"chat"`},
		{"chat com https://", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "https://chat.exemplo.com.br"`), `"chat"`},
		{"chat sem ponto", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat"`), `"chat"`},
		{"chat com a porta 0", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat.exemplo.com.br:0"`), `"chat"`},
		{"chat com a porta 70000", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat.exemplo.com.br:70000"`), `"chat"`},
		{"chat com a porta vazia", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat.exemplo.com.br:"`), `"chat"`},
		// O Origin do navegador nunca leva a 443, a porta padrão do https: a OrigemDoChat não bateria.
		{"chat com a porta 443", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "chat.exemplo.com.br:443"`), `"chat"`},
		{"chat num IPv4 com a porta 443", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "192.0.2.10:443"`), `"chat"`},
		{"chat num IPv6", com(t, `"chat": "chat.exemplo.com.br"`, `"chat": "[2001:db8::1]:443"`), `"chat"`},
		{"chave com 42 caracteres", com(t, chaveVetor, chaveVetor[:42]), `"chave"`},
		{"chave com =", com(t, chaveVetor, chaveVetor[:42]+"="), `"chave"`},
		{"chave com +", com(t, chaveVetor, "+"+chaveVetor[1:]), `"chave"`},
		{"sem a chave", com(t, `"chave": "`+chaveVetor+`",`, ``), `"chave"`},
		{"senhaEsl com 23 caracteres", com(t, `"senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"`, `"senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl1"`), `"senhaEsl"`},
		// O FreeSWITCH expande o $${...} da configuração antes de ler o XML.
		{"senhaEsl com $${}", com(t, `"senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"`, `"senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12$${hostname}"`), `"senhaEsl"`},
		{"senhaEsl com espaço", com(t, `"senhaEsl": "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"`, `"senhaEsl": "Ab12Cd34Ef56Gh78 Ij90Kl12Mn34Op56"`), `"senhaEsl"`},
		{"ipPrivado IPv6", com(t, `"ipPrivado": "10.0.0.5"`, `"ipPrivado": "fd00::5"`), `"ipPrivado"`},
		{"ipPrivado IPv4 dentro do IPv6", com(t, `"ipPrivado": "10.0.0.5"`, `"ipPrivado": "::ffff:10.0.0.5"`), `"ipPrivado"`},
		{"ipPrivado com três partes", com(t, `"ipPrivado": "10.0.0.5"`, `"ipPrivado": "10.0.5"`), `"ipPrivado"`},
		{"ipPrivado com zero na frente", com(t, `"ipPrivado": "10.0.0.5"`, `"ipPrivado": "10.0.0.05"`), `"ipPrivado"`},
		{"ipPublico IPv6", com(t, `"ipPublico": "203.0.113.10"`, `"ipPublico": "2001:db8::10"`), `"ipPublico"`},
		{"ipPublico um nome", com(t, `"ipPublico": "203.0.113.10"`, `"ipPublico": "video.exemplo.com.br"`), `"ipPublico"`},
		{"uma chave a mais", com(t, `"ipPublico": "203.0.113.10"`, `"ipPublico": "203.0.113.10", "porta": 443`), `"porta"`},
	}
	for _, caso := range recusas {
		t.Run(caso.nome, func(t *testing.T) {
			_, err := Ler(escreverConfig(t, caso.conteudo))
			if err == nil {
				t.Fatal("Ler aceitou")
			}
			if !strings.Contains(err.Error(), caso.campo) {
				t.Errorf("o erro %q não diz o campo %s", err, caso.campo)
			}
			for _, segredo := range []string{chaveVetor[:20], "Ab12Cd34Ef56Gh78"} {
				if strings.Contains(err.Error(), segredo) {
					t.Errorf("o erro %q mostra um segredo", err)
				}
			}
		})
	}

	outras := map[string]string{
		"json quebrado":       `{"endereco":`,
		"lixo no fim":         certo + ` x`,
		"dois objetos":        certo + certo,
		"não é objeto":        `["video.exemplo.com.br"]`,
		"campo de outro tipo": com(t, `"chat": "chat.exemplo.com.br"`, `"chat": 8443`),
	}
	for nome, conteudo := range outras {
		t.Run(nome, func(t *testing.T) {
			if _, err := Ler(escreverConfig(t, conteudo)); err == nil {
				t.Fatal("Ler aceitou")
			}
		})
	}
	t.Run("arquivo que não existe", func(t *testing.T) {
		if _, err := Ler(filepath.Join(t.TempDir(), "nada.json")); err == nil {
			t.Fatal("Ler aceitou")
		}
	})
}
