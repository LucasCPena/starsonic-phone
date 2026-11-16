// Package video é o cliente do agente do servidor de vídeo (docs/video-agente.md): a senha de uso único, as
// credenciais do TURN, a API do agente e os eventos. Espelha o lado do agente (video-servidor/internal/senha, turn
// e api); os vetores do contrato valem nos dois.
package video

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// Papel é o que a pessoa pode fazer na reunião.
type Papel string

const (
	// Colega pode começar a reunião.
	Colega Papel = "colega"
	// Fora só entra numa reunião que já começou.
	Fora Papel = "fora"
)

// Senha é a carga da senha de uso único. A ordem dos campos é a do JSON do contrato (seção 3), e é a mesma do
// senha.Senha do agente.
type Senha struct {
	V            int    `json:"v"`
	Sala         string `json:"sala"`
	Participante string `json:"participante"`
	Papel        Papel  `json:"papel"`
	Tela         bool   `json:"tela"`
	Nome         string `json:"nome"`
	Vence        int64  `json:"vence"` // milissegundos UTC, no relógio do servidor de vídeo
	ID           string `json:"id"`
}

const prefixoAssinatura = "starsonic-senha-v1."

var base64url = base64.RawURLEncoding

// AssinarSenha devolve a senha "<carga>.<assinatura>" de s.
func AssinarSenha(chave []byte, s Senha) (string, error) {
	texto, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	carga := base64url.EncodeToString(texto)
	m := hmac.New(sha256.New, chave)
	m.Write([]byte(prefixoAssinatura))
	m.Write([]byte(carga))
	return carga + "." + base64url.EncodeToString(m.Sum(nil)), nil
}

// LerChave lê a chave: 43 caracteres em base64url sem "=", que são 32 bytes. O erro nunca leva o texto.
func LerChave(texto string) ([]byte, error) {
	if len(texto) != 43 {
		return nil, fmt.Errorf("%w: deve ter 43 caracteres", ErrChave)
	}
	chave, err := base64url.Strict().DecodeString(texto)
	if err != nil {
		return nil, fmt.Errorf("%w: deve estar em base64url, sem \"=\"", ErrChave)
	}
	return chave, nil
}

// SegredoTurn é o static-auth-secret do coturn: o HMAC-SHA256, com a chave, de "starsonic-turn-v1", em base64url
// sem "=" (43 caracteres).
func SegredoTurn(chave []byte) string {
	m := hmac.New(sha256.New, chave)
	m.Write([]byte("starsonic-turn-v1"))
	return base64url.EncodeToString(m.Sum(nil))
}

// CredencialTurn dá o usuário e a senha do TURN REST API do coturn (seção 4): o usuário é
// "<vence, em segundos UTC>:<participante>", e a senha é o HMAC-SHA1, com o segredo, do usuário, em base64 comum.
func CredencialTurn(segredo, participante string, vence time.Time) (usuario, senha string) {
	usuario = strconv.FormatInt(vence.Unix(), 10) + ":" + participante
	m := hmac.New(sha1.New, []byte(segredo))
	m.Write([]byte(usuario))
	return usuario, base64.StdEncoding.EncodeToString(m.Sum(nil))
}
