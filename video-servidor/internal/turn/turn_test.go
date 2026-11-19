package turn

import (
	"testing"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

func TestSegredo_Vetor(t *testing.T) {
	// O vetor da seção 4 do docs/video-agente.md.
	chave, err := senha.LerChave("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
	if err != nil {
		t.Fatal(err)
	}
	const esperado = "jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4"
	if got := Segredo(chave); got != esperado {
		t.Errorf("Segredo = %s, want %s", got, esperado)
	}
}
