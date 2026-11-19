package admin

import (
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/ramais"
)

// O "há quanto tempo" da página: sempre para baixo, e um tempo negativo conta como zero.
func TestHa(t *testing.T) {
	const dia = 24 * time.Hour
	for _, c := range []struct {
		d     time.Duration
		quero string
	}{
		{-5 * time.Second, "há menos de 1 min"},
		{0, "há menos de 1 min"},
		{59 * time.Second, "há menos de 1 min"},
		{60 * time.Second, "há 1 min"},
		{12*time.Minute + 30*time.Second, "há 12 min"},
		{59*time.Minute + 59*time.Second, "há 59 min"},
		{time.Hour, "há 1 h"},
		{2*time.Hour + 5*time.Minute, "há 2 h"},
		{23*time.Hour + 59*time.Minute, "há 23 h"},
		{dia, "há 1 dia"},
		{3*dia + 5*time.Hour, "há 3 dias"},
		{ramais.MaxSegundos * time.Second, "há 365 dias"},
	} {
		if got := ha(c.d); got != c.quero {
			t.Errorf("ha(%v) = %q; queria %q", c.d, got, c.quero)
		}
	}
}

func TestOQueDiz(t *testing.T) {
	for e, quero := range map[ramais.Estado]string{
		ramais.Conectando: "Conectando…",
		ramais.Erro:       "Erro no cadastro",
		ramais.SemConexao: "Sem conexão com a central",
	} {
		if got := oQueDiz(e); got != quero {
			t.Errorf("oQueDiz(%q) = %q; queria %q", e, got, quero)
		}
	}
}
