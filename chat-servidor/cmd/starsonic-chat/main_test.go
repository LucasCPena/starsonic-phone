package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestVersao(t *testing.T) {
	var saida bytes.Buffer
	if cod := run([]string{"versao"}, strings.NewReader(""), &saida); cod != 0 {
		t.Fatalf("código %d", cod)
	}
	if saida.String() != "0.0.0-dev\n" {
		t.Fatalf("saída %q", saida.String())
	}
}

func TestSubcomandoDesconhecido(t *testing.T) {
	for _, args := range [][]string{{"xis"}, {}} {
		var saida bytes.Buffer
		if cod := run(args, strings.NewReader(""), &saida); cod != 2 {
			t.Fatalf("%v: código %d, esperava 2", args, cod)
		}
		if !strings.Contains(saida.String(), "uso:") {
			t.Fatalf("%v: o uso não foi escrito: %q", args, saida.String())
		}
	}
}
