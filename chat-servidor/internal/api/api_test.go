package api_test

import (
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

func TestNovo_SemHubEntraEmPanico(t *testing.T) {
	a := apitest.Novo(t)
	defer func() {
		if recover() == nil {
			t.Fatal("api.Novo sem Hub não entrou em pânico")
		}
	}()
	api.Novo(api.Deps{Banco: a.Banco})
}
