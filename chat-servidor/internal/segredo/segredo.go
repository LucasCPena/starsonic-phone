// Package segredo gera e confere os segredos do chat: o código da empresa, a chave do
// computador, o bilhete e o id de arquivo. Tudo vem de crypto/rand.
package segredo

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math/big"
	"strings"
)

// alfabeto tem 30 caracteres: ficam de fora o I, o L, o O, o U, o 0 e o 1.
const alfabeto = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

func aleatorio(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// Sem aleatoriedade segura não há como seguir.
		panic("segredo: crypto/rand falhou: " + err.Error())
	}
	return b
}

func letras(n int) string {
	var sb strings.Builder
	limite := big.NewInt(int64(len(alfabeto)))
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, limite)
		if err != nil {
			panic("segredo: crypto/rand falhou: " + err.Error())
		}
		sb.WriteByte(alfabeto[v.Int64()])
	}
	return sb.String()
}

// NovoCodigo gera o código de uma empresa, no formato STAR-XXXX-XXXX.
func NovoCodigo() string {
	return "STAR-" + letras(4) + "-" + letras(4)
}

// NormalizarCodigo passa o código para maiúsculas, tira espaços e hífens e confere o formato.
// Devolve a forma STAR-XXXX-XXXX.
func NormalizarCodigo(s string) (string, bool) {
	var sb strings.Builder
	for _, r := range strings.ToUpper(s) {
		if r == ' ' || r == '-' || r == '\t' || r == '\n' || r == '\r' {
			continue
		}
		sb.WriteRune(r)
	}
	c := sb.String()
	if len(c) != 12 || c[:4] != "STAR" {
		return "", false
	}
	for i := 4; i < 12; i++ {
		if !strings.ContainsRune(alfabeto, rune(c[i])) {
			return "", false
		}
	}
	return "STAR-" + c[4:8] + "-" + c[8:12], true
}

func base64url32() string {
	return base64.RawURLEncoding.EncodeToString(aleatorio(32))
}

// NovaChave gera a chave de um computador (43 caracteres base64url) e o SHA-256 dela.
func NovaChave() (chave string, hash []byte) {
	chave = base64url32()
	return chave, Hash(chave)
}

// Hash é o SHA-256 do texto. O banco guarda só isto, nunca o segredo.
func Hash(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// NovoBilhete gera um bilhete (43 caracteres base64url).
func NovoBilhete() string { return base64url32() }

// NovoIDArquivo gera o id de um arquivo: 16 bytes em hexadecimal.
func NovoIDArquivo() string { return hex.EncodeToString(aleatorio(16)) }

// NovoToken gera um token da página de administração (o da sessão ou o do CSRF): 32 bytes
// aleatórios em base64url (43 caracteres).
func NovoToken() string { return base64url32() }
