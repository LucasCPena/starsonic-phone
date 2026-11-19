package api

import (
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// O Mandar nunca espera: com a fila de 32 cheia, ele derruba a conexão e volta (R: M-7).
func TestCanalPagina_MandarNaoEspera(t *testing.T) {
	c := novoCanalPagina(nil) // sem conexão e sem a goroutine que escreve: a fila só enche
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		for range filaDoCanal {
			c.Mandar(map[string]string{"tipo": "aguardando"})
		}
		if c.ctx.Err() != nil {
			t.Error("a conexão caiu com a fila no limite, antes de passar dele")
		}
		c.Mandar(map[string]string{"tipo": "aguardando"}) // a 33ª
		c.Mandar(map[string]string{"tipo": "aguardando"}) // e depois da queda: ignorada
		c.Fechar()                                        // idem, e nunca espera
	}()
	select {
	case <-feito:
	case <-time.After(5 * time.Second):
		t.Fatal("o Mandar ou o Fechar esperou")
	}
	if c.ctx.Err() == nil {
		t.Fatal("a fila cheia não derrubou a conexão")
	}
}

func TestBilhetes_LimitePorDono(t *testing.T) {
	rel := tempo.NovoTeste(time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC))
	b := novosBilhetes(rel, maxBilhetesPorReuniao)
	var todos []string
	for range maxBilhetesPorReuniao + 5 {
		todos = append(todos, b.novo(7))
	}
	outro := b.novo(8)
	for i, s := range todos[:5] {
		if _, ok := b.usar(s); ok {
			t.Fatalf("o bilhete %d, dos 5 mais velhos, ainda vale", i)
		}
	}
	for i, s := range todos[5:] {
		if d, ok := b.usar(s); !ok || d != 7 {
			t.Fatalf("o bilhete %d, dos %d vivos, não vale (%d, %v)", i+5, maxBilhetesPorReuniao, d, ok)
		}
	}
	if d, ok := b.usar(outro); !ok || d != 8 {
		t.Fatalf("o bilhete da outra reunião não vale (%d, %v)", d, ok)
	}
	if maxBilhetesPorReuniao != 100 || maxBilhetesPorComputador != 4 {
		t.Fatalf("os máximos são %d e %d; queria 100 e 4", maxBilhetesPorReuniao, maxBilhetesPorComputador)
	}
	// A janela dos abrir bons de um endereço fica abaixo da fila de uma reunião (o desenho da 1b, item 10).
	if maxAbrirBom >= maxBilhetesPorReuniao {
		t.Fatalf("a janela dos bons (%d) não fica abaixo da fila (%d)", maxAbrirBom, maxBilhetesPorReuniao)
	}
}
