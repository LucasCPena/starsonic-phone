package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/mosaico"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/salas"
)

// esperaEscrita é quanto uma escrita a um cliente pode levar. Passando disso, a conexão cai: é o que solta o
// handler de um cliente que não lê e já foi desligado.
const esperaEscrita = 10 * time.Second

// cliente é uma conexão dos eventos. A fila é só dele: quem manda nunca espera.
type cliente struct {
	fila chan []byte
	fora chan struct{} // fecha quando o cliente é desligado
}

type eventoEstado struct {
	Tipo       string       `json:"tipo"`
	Agora      int64        `json:"agora"`
	FreeSWITCH bool         `json:"freeswitch"`
	Salas      []salas.Sala `json:"salas"`
}

// estadoJSON monta um evento estado.
func (a *API) estadoJSON() []byte {
	b, _ := json.Marshal(eventoEstado{"estado", a.agoraMs(), a.d.NoAr(), a.salasAgora()})
	return b
}

// desligar tira o cliente e fecha o fora. Com a.mu travado.
func (a *API) desligar(c *cliente) {
	if _, ok := a.clientes[c]; ok {
		delete(a.clientes, c)
		close(c.fora)
	}
}

// enviar põe o evento na fila do cliente. Fila cheia: o cliente sai, sem espera. Com a.mu travado.
func (a *API) enviar(c *cliente, ev []byte) {
	select {
	case c.fila <- ev:
	default:
		a.desligar(c)
	}
}

// Avisar manda uma mudança das salas a todos os clientes dos eventos, e não espera ninguém.
func (a *API) Avisar(av salas.Aviso) {
	var ev []byte
	switch av.Tipo {
	case "entrou", "saiu":
		ev, _ = json.Marshal(struct {
			Tipo         string `json:"tipo"`
			Sala         string `json:"sala"`
			Participante string `json:"participante"`
			Tela         bool   `json:"tela"`
		}{av.Tipo, av.Sala, av.Participante, av.Tela})
	case "acabou":
		ev, _ = json.Marshal(struct {
			Tipo string `json:"tipo"`
			Sala string `json:"sala"`
		}{av.Tipo, av.Sala})
	case "palco":
		if av.Palco == nil {
			return
		}
		ev, _ = json.Marshal(struct {
			Tipo    string           `json:"tipo"`
			Sala    string           `json:"sala"`
			Largura int              `json:"largura"`
			Altura  int              `json:"altura"`
			Quadros []mosaico.Quadro `json:"quadros"`
		}{av.Tipo, av.Sala, av.Palco.Largura, av.Palco.Altura, av.Palco.Quadros})
	default:
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for c := range a.clientes {
		a.enviar(c, ev)
	}
}

// Retrato manda um estado novo a cada cliente dos eventos.
func (a *API) Retrato() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.clientes) == 0 {
		return
	}
	ev := a.estadoJSON()
	for c := range a.clientes {
		a.enviar(c, ev)
	}
}

// Fechar desliga todos os clientes dos eventos, e depois dele nenhum entra. É para o desligamento do servidor.
func (a *API) Fechar() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.fechada = true
	for c := range a.clientes {
		a.desligar(c)
	}
}

// registrar põe o cliente na lista e devolve o primeiro estado dele. O estado e a entrada na lista são um passo
// só, para nenhum aviso cair entre os dois. O estado é lido com a.mu travado: as salas nunca avisam com o
// mutex delas preso, então não há espera em círculo.
func (a *API) registrar() (*cliente, []byte) {
	c := &cliente{fila: make(chan []byte, a.fila), fora: make(chan struct{})}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.fechada {
		close(c.fora)
		return c, nil
	}
	a.clientes[c] = struct{}{}
	return c, a.estadoJSON()
}

func (a *API) eventos(w http.ResponseWriter, r *http.Request) {
	c, primeiro := a.registrar()
	if primeiro == nil {
		erro(w, http.StatusServiceUnavailable, "interno") // o agente está desligando
		return
	}
	defer func() {
		a.mu.Lock()
		a.desligar(c)
		a.mu.Unlock()
	}()

	rc := http.NewResponseController(w)
	escrever := func(ev []byte) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(esperaEscrita))
		buf := make([]byte, 0, len(ev)+8)
		buf = append(append(append(buf, "data: "...), ev...), '\n', '\n')
		if _, err := w.Write(buf); err != nil {
			return false
		}
		return rc.Flush() == nil
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if !escrever(primeiro) {
		return
	}

	relogio := time.NewTicker(a.d.Pulso)
	defer relogio.Stop()
	for {
		select { // desligado: sai logo, sem esvaziar a fila
		case <-c.fora:
			return
		default:
		}
		select { // os avisos na fila vão antes do relógio
		case ev := <-c.fila:
			if !escrever(ev) {
				return
			}
			continue
		default:
		}
		select {
		case ev := <-c.fila:
			if !escrever(ev) {
				return
			}
		case <-relogio.C:
			b, _ := json.Marshal(struct {
				Tipo  string `json:"tipo"`
				Agora int64  `json:"agora"`
			}{"relogio", a.agoraMs()})
			if !escrever(b) {
				return
			}
		case <-c.fora:
			return
		case <-r.Context().Done():
			return
		}
	}
}
