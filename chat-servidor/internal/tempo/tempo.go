// Package tempo é o relógio do servidor: o real, e um de teste que anda só quando mandam.
package tempo

import (
	"sync"
	"time"
)

// Relogio diz que horas são agora.
type Relogio interface {
	Agora() time.Time
}

type real struct{}

func (real) Agora() time.Time { return time.Now() }

// Real devolve o relógio do sistema.
func Real() Relogio { return real{} }

// Teste é um relógio parado, que só anda com Avancar ou Definir. É seguro entre goroutines.
type Teste struct {
	mu sync.Mutex
	t  time.Time
}

// NovoTeste cria o relógio de teste, parado em inicio.
func NovoTeste(inicio time.Time) *Teste { return &Teste{t: inicio} }

// Agora devolve o instante em que o relógio está parado.
func (r *Teste) Agora() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.t
}

// Avancar anda o relógio d para a frente (ou para trás, se d for negativo).
func (r *Teste) Avancar(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.t = r.t.Add(d)
}

// Definir põe o relógio em t.
func (r *Teste) Definir(t time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.t = t
}
