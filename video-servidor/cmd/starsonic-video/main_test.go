package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

func TestVersao(t *testing.T) {
	var saida, erros bytes.Buffer
	if codigo := run([]string{"versao"}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0", codigo)
	}
	if saida.String() != "0.0.0-dev\n" {
		t.Errorf("saída %q, want %q", saida.String(), "0.0.0-dev\n")
	}

	saida.Reset()
	if codigo := run([]string{"inexistente"}, &saida, &erros); codigo != 2 {
		t.Errorf("subcomando desconhecido: código %d, want 2", codigo)
	}
	if !strings.Contains(saida.String(), "subcomando desconhecido: inexistente") || !strings.Contains(saida.String(), "uso: starsonic-video") {
		t.Errorf("sem o uso em português: %q", saida.String())
	}

	saida.Reset()
	if codigo := run(nil, &saida, &erros); codigo != 2 || !strings.Contains(saida.String(), "uso: starsonic-video") {
		t.Errorf("sem argumentos: codigo %d, saída %q", codigo, saida.String())
	}
}

func TestChave(t *testing.T) {
	var saida, erros bytes.Buffer
	if codigo := run([]string{"chave"}, &saida, &erros); codigo != 0 {
		t.Fatalf("código %d, want 0", codigo)
	}
	texto := saida.String()
	if len(texto) != 44 || !strings.HasSuffix(texto, "\n") {
		t.Fatalf("saída %q: want uma linha de 43 caracteres", texto)
	}
	if _, err := senha.LerChave(strings.TrimSuffix(texto, "\n")); err != nil {
		t.Errorf("LerChave: %v", err)
	}
}
