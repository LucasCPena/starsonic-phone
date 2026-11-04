package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"
)

const limiteJSON = 64 * 1024 // o corpo JSON tem até 64 KiB (seção 1 do protocolo)

// escreverJSON responde com o status e o valor em JSON.
func escreverJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// escreverErro responde com {"erro": codigo} e os extras (campo, esperarSegundos).
func escreverErro(w http.ResponseWriter, status int, codigo string, extras map[string]any) {
	corpo := map[string]any{"erro": codigo}
	for k, v := range extras {
		corpo[k] = v
	}
	escreverJSON(w, status, corpo)
}

// erroCampo responde 400 invalido, dizendo o campo.
func erroCampo(w http.ResponseWriter, campo string) {
	escreverErro(w, http.StatusBadRequest, "invalido", map[string]any{"campo": campo})
}

// erroServidor responde 500 servidor, sem detalhes para o app, e registra a causa no log (o
// texto do erro não leva dado do cliente). Um pedido cancelado (o cliente foi embora) não é
// erro do servidor: não registra nada em Error.
func erroServidor(w http.ResponseWriter, err error) {
	if errors.Is(err, context.Canceled) {
		slog.Debug("pedido cancelado", "erro", err)
	} else {
		slog.Error("servidor", "erro", err)
	}
	escreverErro(w, http.StatusInternalServerError, "servidor", nil)
}

// erroEspera responde 429 com o código e quantos segundos esperar (arredondado para cima).
func erroEspera(w http.ResponseWriter, codigo string, esperar time.Duration) {
	seg := int((esperar + time.Second - 1) / time.Second)
	if seg < 1 {
		seg = 1
	}
	escreverErro(w, http.StatusTooManyRequests, codigo, map[string]any{"esperarSegundos": seg})
}

// lerJSON lê o corpo (até 64 KiB) em destino. Se falhar, já responde (413 grande ou
// 400 invalido) e devolve false.
func lerJSON(w http.ResponseWriter, r *http.Request, destino any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limiteJSON)
	dec := json.NewDecoder(r.Body)
	err := dec.Decode(destino)
	if err == nil {
		// Depois do valor só pode haver espaço em branco.
		if _, err2 := dec.Token(); err2 != io.EOF {
			err = errors.New("lixo depois do JSON")
			if err2 != nil {
				err = err2
			}
		}
	}
	if err == nil {
		return true
	}
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		escreverErro(w, http.StatusRequestEntityTooLarge, "grande", nil)
	} else {
		escreverErro(w, http.StatusBadRequest, "invalido", nil)
	}
	return false
}
