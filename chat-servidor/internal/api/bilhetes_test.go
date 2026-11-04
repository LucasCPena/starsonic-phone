package api

import (
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestBilhetes_Varre(t *testing.T) {
	rel := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	b := novosBilhetes(rel)
	b.novo(1)
	rel.Avancar(61 * time.Second)
	b.novo(2)
	b.mu.Lock()
	n := len(b.porHash)
	b.mu.Unlock()
	if n != 1 {
		t.Fatalf("o mapa guarda %d bilhetes; queria 1 (o vencido sai na varredura)", n)
	}
}

func TestBilhetes_LimitePorComputador(t *testing.T) {
	rel := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	b := novosBilhetes(rel)
	var seis []string
	for i := 0; i < 6; i++ {
		seis = append(seis, b.novo(1))
	}
	outros := []string{b.novo(2), b.novo(2)}

	b.mu.Lock()
	n := len(b.porHash)
	b.mu.Unlock()
	if n != 4+2 {
		t.Fatalf("o mapa guarda %d bilhetes; queria 6 (4 do computador 1 e 2 do 2)", n)
	}
	for i, s := range seis[:2] {
		if _, ok := b.usar(s); ok {
			t.Fatalf("o bilhete %d, dos 2 mais velhos, ainda conecta", i)
		}
	}
	for i, s := range seis[2:] {
		if c, ok := b.usar(s); !ok || c != 1 {
			t.Fatalf("o bilhete %d, dos 4 vivos, não conecta (%d, %v)", i+2, c, ok)
		}
	}
	for i, s := range outros {
		if c, ok := b.usar(s); !ok || c != 2 {
			t.Fatalf("o bilhete %d do computador 2 não conecta (%d, %v)", i, c, ok)
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.porHash) != 0 || len(b.porComputador) != 0 {
		t.Fatalf("sobrou estado: %d bilhetes, %d computadores", len(b.porHash), len(b.porComputador))
	}
}
