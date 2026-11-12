// Package senha cuida da senha de uso único que o chat dá a quem entra numa reunião (a seção 3 do
// docs/video-agente.md): assinar, conferir e deixar usar uma vez só.
package senha

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
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

// Senha é a carga da senha de uso único. A ordem dos campos é a do JSON do contrato.
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

const (
	// Duracao é quanto a senha vale, a partir de quando o chat a assina.
	Duracao = 30 * time.Second
	// MaximoAdiante é o quanto o vence pode estar adiante de agora.
	MaximoAdiante = 60 * time.Second

	// guardaDepoisDoVence é quanto o UsoUnico ainda guarda um id depois do vence.
	guardaDepoisDoVence = time.Minute

	prefixoAssinatura = "starsonic-senha-v1."
)

var (
	// ErrInvalida: a senha não é uma senha nossa (a assinatura, o formato ou um campo não conferem).
	ErrInvalida = errors.New("senha inválida")
	// ErrVencida: a senha é nossa, mas já venceu.
	ErrVencida = errors.New("senha vencida")
	// ErrUsada: a senha já foi usada.
	ErrUsada = errors.New("senha já usada")
)

var base64url = base64.RawURLEncoding

func codificar(b []byte) string { return base64url.EncodeToString(b) }

// decodificar lê o base64url sem "=" e sem sobras: só o texto que o codificar escreveria.
func decodificar(s string) ([]byte, error) {
	return base64url.Strict().DecodeString(s)
}

func assinatura(chave []byte, carga string) string {
	m := hmac.New(sha256.New, chave)
	m.Write([]byte(prefixoAssinatura))
	m.Write([]byte(carga))
	return codificar(m.Sum(nil))
}

// Assinar devolve a senha "<carga>.<assinatura>" de s.
func Assinar(chave []byte, s Senha) (string, error) {
	texto, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	carga := codificar(texto)
	return carga + "." + assinatura(chave, carga), nil
}

// Verificar confere o texto e devolve a Senha. Dá ErrInvalida quando algo não confere e ErrVencida
// quando agora já é o vence ou depois dele. Não marca a senha como usada: isso é do UsoUnico.
func Verificar(chave []byte, texto string, agora time.Time) (Senha, error) {
	carga, dada, ok := strings.Cut(texto, ".")
	if !ok || strings.Contains(dada, ".") {
		return Senha{}, ErrInvalida
	}
	if !hmac.Equal([]byte(dada), []byte(assinatura(chave, carga))) {
		return Senha{}, ErrInvalida
	}
	corpo, err := decodificar(carga)
	if err != nil {
		return Senha{}, ErrInvalida
	}
	s, err := lerCarga(corpo)
	if err != nil {
		return Senha{}, ErrInvalida
	}
	if !camposValem(s) {
		return Senha{}, ErrInvalida
	}
	vence := time.UnixMilli(s.Vence)
	if !agora.Before(vence) {
		return Senha{}, ErrVencida
	}
	if vence.Sub(agora) > MaximoAdiante {
		return Senha{}, ErrInvalida
	}
	return s, nil
}

// lerCarga lê o JSON só com os campos conhecidos e sem nada depois dele.
func lerCarga(texto []byte) (Senha, error) {
	var s Senha
	d := json.NewDecoder(bytes.NewReader(texto))
	d.DisallowUnknownFields()
	if err := d.Decode(&s); err != nil {
		return Senha{}, err
	}
	if _, err := d.Token(); err != io.EOF {
		return Senha{}, errors.New("sobra texto depois do JSON")
	}
	return s, nil
}

func camposValem(s Senha) bool {
	return s.V == 1 &&
		hexMinusculo(s.Sala, 32) &&
		hexMinusculo(s.Participante, 16) &&
		hexMinusculo(s.ID, 32) &&
		(s.Papel == Colega || s.Papel == Fora) &&
		s.Nome != ""
}

func hexMinusculo(s string, tamanho int) bool {
	if len(s) != tamanho {
		return false
	}
	for i := range len(s) {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// UsoUnico guarda os ids das senhas usadas, até um minuto depois do vence delas. É seguro entre
// goroutines.
type UsoUnico struct {
	mu  sync.Mutex
	ids map[string]time.Time // o id e até quando guardá-lo
}

// NovoUsoUnico devolve um UsoUnico vazio.
func NovoUsoUnico() *UsoUnico {
	return &UsoUnico{ids: map[string]time.Time{}}
}

// Usar marca a senha como usada. Dá ErrUsada na segunda vez, e ErrVencida quando ela venceu há mais
// de um minuto (um id assim já não é guardado, e a senha não podia mais valer). Cada chamada tira da
// memória os ids que já não valem.
func (u *UsoUnico) Usar(s Senha, agora time.Time) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	for id, ate := range u.ids {
		if agora.After(ate) {
			delete(u.ids, id)
		}
	}
	ate := time.UnixMilli(s.Vence).Add(guardaDepoisDoVence)
	if agora.After(ate) {
		return ErrVencida
	}
	if _, usada := u.ids[s.ID]; usada {
		return ErrUsada
	}
	u.ids[s.ID] = ate
	return nil
}

// LerChave lê a chave: 43 caracteres em base64url sem "=", que são 32 bytes.
func LerChave(texto string) ([]byte, error) {
	if len(texto) != 43 {
		return nil, errors.New("a chave deve ter 43 caracteres")
	}
	chave, err := decodificar(texto)
	if err != nil {
		return nil, errors.New("a chave deve estar em base64url, sem \"=\"")
	}
	return chave, nil
}

// NovaChave sorteia uma chave de 32 bytes e a devolve em base64url sem "=".
func NovaChave() string {
	chave := make([]byte, 32)
	if _, err := rand.Read(chave); err != nil {
		panic("sem aleatoriedade: " + err.Error())
	}
	return codificar(chave)
}
