// Package turn tira da chave o segredo do coturn (a seção 4 do docs/video-agente.md).
package turn

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

// Segredo é o static-auth-secret do coturn: o HMAC-SHA256, com a chave, de "starsonic-turn-v1", em
// base64url sem "=" (43 caracteres). O chat tira o mesmo da mesma chave.
func Segredo(chave []byte) string {
	m := hmac.New(sha256.New, chave)
	m.Write([]byte("starsonic-turn-v1"))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
