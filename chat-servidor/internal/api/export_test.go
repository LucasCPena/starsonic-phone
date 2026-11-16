package api

import (
	"testing"
	"time"
)

// AjustarPing encurta o ping do canal da página (e a espera do pong) até o fim do teste.
func AjustarPing(t *testing.T, intervalo, espera time.Duration) {
	t.Helper()
	i, e := pingIntervalo.Load(), pingEspera.Load()
	pingIntervalo.Store(int64(intervalo))
	pingEspera.Store(int64(espera))
	t.Cleanup(func() { pingIntervalo.Store(i); pingEspera.Store(e) })
}

// AjustarPedirEspera encurta o prazo do primeiro pedir de um canal até o fim do teste.
func AjustarPedirEspera(t *testing.T, d time.Duration) {
	t.Helper()
	antes := pedirEspera.Load()
	pedirEspera.Store(int64(d))
	t.Cleanup(func() { pedirEspera.Store(antes) })
}
