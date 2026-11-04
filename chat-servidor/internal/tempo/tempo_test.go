package tempo

import (
	"sync"
	"testing"
	"time"
)

func TestRelogioTeste(t *testing.T) {
	inicio := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	r := NovoTeste(inicio)
	var _ Relogio = r
	if !r.Agora().Equal(inicio) {
		t.Fatalf("Agora = %v, esperava %v", r.Agora(), inicio)
	}
	r.Avancar(90 * time.Second)
	if !r.Agora().Equal(inicio.Add(90 * time.Second)) {
		t.Fatalf("depois de Avancar: %v", r.Agora())
	}
	novo := inicio.Add(48 * time.Hour)
	r.Definir(novo)
	if !r.Agora().Equal(novo) {
		t.Fatalf("depois de Definir: %v", r.Agora())
	}
}

func TestRelogioTeste_Concorrente(t *testing.T) {
	inicio := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	r := NovoTeste(inicio)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.Avancar(time.Second)
			_ = r.Agora()
		}()
	}
	wg.Wait()
	if !r.Agora().Equal(inicio.Add(50 * time.Second)) {
		t.Fatalf("Agora = %v", r.Agora())
	}
}

func TestReal(t *testing.T) {
	antes := time.Now()
	a := Real().Agora()
	if a.Before(antes) || time.Since(a) > time.Minute {
		t.Fatalf("o relógio real está fora de hora: %v", a)
	}
}
