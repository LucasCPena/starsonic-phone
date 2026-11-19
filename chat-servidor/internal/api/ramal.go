package api

import (
	"net/http"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/ramais"
)

// maxRamal é quantas vezes por minuto um computador diz o estado do ramal, além do limite
// geral. O app manda a cada abertura do canal, a cada troca de conta e a cada mudança (com 2 s
// de espera): 30 sobram, e um app com defeito não enche o servidor de pedidos.
const maxRamal = 30

// PUT /api/v1/computadores/eu/ramal: o app diz o estado do ramal da pessoa da vez, e há quantos
// segundos ele está assim. O chat guarda só na memória, na ligação do computador com o hub: é o
// que a página de administração mostra. Sem o computador no hub (o canal dos eventos fechado),
// não guarda nada e responde 409 semLigacao: o app manda de novo quando o canal abrir.
//
// O estado e os segundos não vão para o banco nem para o log.
func (s *servidor) dizerRamal(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	var corpo struct {
		Estado   *string `json:"estado"`
		Segundos *int64  `json:"segundos"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if corpo.Estado == nil || !ramais.Valido(*corpo.Estado) {
		erroCampo(w, "estado")
		return
	}
	if corpo.Segundos == nil || *corpo.Segundos < 0 || *corpo.Segundos > ramais.MaxSegundos {
		erroCampo(w, "segundos")
		return
	}
	desde := s.banco.Relogio().Agora().Add(-time.Duration(*corpo.Segundos) * time.Second)
	if !s.hub.DefinirRamal(c.ID, c.PessoaID, ramais.Dito{Estado: ramais.Estado(*corpo.Estado), Desde: desde}) {
		escreverErro(w, http.StatusConflict, "semLigacao", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
