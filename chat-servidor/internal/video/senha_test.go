package video

import (
	"strings"
	"testing"
	"time"
)

// Os vetores das seções 3 e 4 do docs/video-agente.md: o agente e o chat conferem os mesmos.
const (
	chaveVetor = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	senhaVetor = "eyJ2IjoxLCJzYWxhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJwYXJ0aWNpcGFudGUiOiIwMDExMjIzMzQ0NTU2Njc3IiwicGFwZWwiOiJmb3JhIiwidGVsYSI6ZmFsc2UsIm5vbWUiOiJNYXJpYSBMaW1hIiwidmVuY2UiOjE3OTQ0OTU2MzAwMDAsImlkIjoiZmZlZWRkY2NiYmFhOTk4ODc3NjY1NTQ0MzMyMjExMDAifQ.uytClxmyRbyRIdxNiofeKfNt5unNa7TsnEPn1rjtwq4"
)

func chaveDoVetor(t *testing.T) []byte {
	t.Helper()
	chave, err := LerChave(chaveVetor)
	if err != nil {
		t.Fatalf("LerChave: %v", err)
	}
	if len(chave) != 32 || chave[0] != 0 || chave[31] != 31 {
		t.Fatalf("a chave do vetor deveria ser os bytes 0 a 31: %v", chave)
	}
	return chave
}

func TestSenha_Vetor(t *testing.T) {
	chave := chaveDoVetor(t)
	got, err := AssinarSenha(chave, Senha{
		V: 1, Sala: "0123456789abcdef0123456789abcdef", Participante: "0011223344556677",
		Papel: Fora, Tela: false, Nome: "Maria Lima", Vence: 1794495630000,
		ID: "ffeeddccbbaa99887766554433221100",
	})
	if err != nil {
		t.Fatalf("AssinarSenha: %v", err)
	}
	if got != senhaVetor {
		t.Fatalf("a senha não é a do contrato:\n got %s\nwant %s", got, senhaVetor)
	}
}

func TestTurn_Vetor(t *testing.T) {
	chave := chaveDoVetor(t)
	segredo := SegredoTurn(chave)
	if segredo != "jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4" {
		t.Fatalf("segredo = %s", segredo)
	}
	usuario, senha := CredencialTurn(segredo, "0011223344556677", time.Date(2026, 11, 13, 3, 0, 0, 0, time.UTC))
	if usuario != "1794538800:0011223344556677" {
		t.Fatalf("usuario = %s", usuario)
	}
	if senha != "lTe50TxrbuhEaWJVPhFLOGOJYRI=" {
		t.Fatalf("senha = %s", senha)
	}
}

func TestLerChave(t *testing.T) {
	for nome, texto := range map[string]string{
		"curta":        chaveVetor[:42],
		"longa":        chaveVetor + "A",
		"com igual":    chaveVetor[:42] + "=",
		"base64 comum": strings.Repeat("+", 43),
		"vazia":        "",
	} {
		if _, err := LerChave(texto); err == nil {
			t.Errorf("%s: LerChave aceitou %q", nome, texto)
		}
	}
	if _, err := LerChave(chaveVetor); err != nil {
		t.Errorf("a chave do vetor deveria valer: %v", err)
	}
}
