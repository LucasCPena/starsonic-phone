package limites

import (
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestJanela(t *testing.T) {
	r := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	j := Nova(10, time.Hour, r)
	for i := 0; i < 10; i++ {
		if ok, _ := j.Usar("a", 1); !ok {
			t.Fatalf("o uso %d devia caber", i+1)
		}
	}
	ok, esperar := j.Usar("a", 1)
	if ok || esperar != time.Hour {
		t.Fatalf("o 11º: ok=%v esperar=%v; queria false e 1h", ok, esperar)
	}
	// O que não coube não conta: depois de 10 min a espera cai 10 min.
	r.Avancar(10 * time.Minute)
	if _, esperar = j.Usar("a", 1); esperar != 50*time.Minute {
		t.Fatalf("esperar = %v; queria 50m", esperar)
	}
	// Outra chave não é afetada.
	if ok, _ := j.Usar("b", 1); !ok {
		t.Fatal("a chave b devia caber")
	}
	r.Avancar(50 * time.Minute)
	if ok, _ := j.Usar("a", 1); !ok {
		t.Fatal("passada a hora, devia caber de novo")
	}
}

func TestJanela_QuantoEContar(t *testing.T) {
	r := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	j := Nova(100, time.Hour, r)
	if ok, _ := j.Usar("x", 60); !ok {
		t.Fatal("60 cabem")
	}
	r.Avancar(30 * time.Minute)
	if ok, _ := j.Usar("x", 41); ok {
		t.Fatal("41 não cabem (60 + 41 > 100)")
	}
	if ok, _ := j.Usar("x", 40); !ok {
		t.Fatal("40 cabem")
	}
	// Os 60 saem 30 min depois dos 40 entrarem?  Não: saem primeiro, aos 60 min.
	if ok, esperar := j.Usar("x", 1); ok || esperar != 30*time.Minute {
		t.Fatalf("ok=%v esperar=%v; queria false e 30m", ok, esperar)
	}
	j.Contar("y", 500) // conta sem conferir
	if ok, _ := j.Usar("y", 1); ok {
		t.Fatal("y passou do máximo, não devia caber")
	}
	if ok, _ := j.Usar("z", 101); ok {
		t.Fatal("mais que o máximo nunca cabe")
	}
}

func TestJanela_Devolver(t *testing.T) {
	r := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	j := Nova(2, time.Hour, r)
	j.Usar("a", 1)
	j.Usar("a", 1)
	j.Devolver("a", 1)
	if ok, _ := j.Usar("a", 1); !ok {
		t.Fatal("depois de devolver 1, devia caber")
	}
}

func TestJanela_Esquece(t *testing.T) {
	r := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	j := Nova(10, time.Hour, r)
	for i := 0; i < 100; i++ {
		j.Usar(string(rune('a'+i%26))+string(rune('a'+i/26)), 1)
	}
	if n := j.Tamanho(); n != 100 {
		t.Fatalf("Tamanho = %d; queria 100", n)
	}
	r.Avancar(2 * time.Hour)
	j.Usar("nova", 1)
	if n := j.Tamanho(); n != 1 {
		t.Fatalf("depois da janela, Tamanho = %d; queria 1", n)
	}
	// Devolver tudo também esquece a chave.
	j.Devolver("nova", 1)
	if n := j.Tamanho(); n != 0 {
		t.Fatalf("depois de devolver, Tamanho = %d; queria 0", n)
	}
}
