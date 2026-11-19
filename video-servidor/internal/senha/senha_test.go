package senha

import (
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// O vetor de teste da seção 3 do docs/video-agente.md.
const (
	chaveVetor = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	jsonVetor  = `{"v":1,"sala":"0123456789abcdef0123456789abcdef","participante":"0011223344556677","papel":"fora","tela":false,"nome":"Maria Lima","vence":1794495630000,"id":"ffeeddccbbaa99887766554433221100"}`
	senhaVetor = "eyJ2IjoxLCJzYWxhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJwYXJ0aWNpcGFudGUiOiIwMDExMjIzMzQ0NTU2Njc3IiwicGFwZWwiOiJmb3JhIiwidGVsYSI6ZmFsc2UsIm5vbWUiOiJNYXJpYSBMaW1hIiwidmVuY2UiOjE3OTQ0OTU2MzAwMDAsImlkIjoiZmZlZWRkY2NiYmFhOTk4ODc3NjY1NTQ0MzMyMjExMDAifQ.uytClxmyRbyRIdxNiofeKfNt5unNa7TsnEPn1rjtwq4"
)

// venceVetor é as 15:00:30 UTC de 12/11/2026.
var venceVetor = time.UnixMilli(1794495630000)

func senhaDoVetor() Senha {
	return Senha{
		V:            1,
		Sala:         "0123456789abcdef0123456789abcdef",
		Participante: "0011223344556677",
		Papel:        Fora,
		Tela:         false,
		Nome:         "Maria Lima",
		Vence:        1794495630000,
		ID:           "ffeeddccbbaa99887766554433221100",
	}
}

func chaveDoVetor(t *testing.T) []byte {
	t.Helper()
	chave, err := LerChave(chaveVetor)
	if err != nil {
		t.Fatalf("LerChave(vetor): %v", err)
	}
	return chave
}

func TestAssinar_Vetor(t *testing.T) {
	chave := chaveDoVetor(t)
	s := senhaDoVetor()
	texto, err := Assinar(chave, s)
	if err != nil {
		t.Fatalf("Assinar: %v", err)
	}
	if texto != senhaVetor {
		t.Errorf("a senha não é a do vetor:\n got %s\nwant %s", texto, senhaVetor)
	}
	// O JSON do vetor é o que o json.Marshal gera, na ordem dos campos.
	carga := strings.SplitN(texto, ".", 2)[0]
	decodificada, err := decodificar(carga)
	if err != nil || string(decodificada) != jsonVetor {
		t.Errorf("a carga não é o JSON do vetor: %q (%v)", decodificada, err)
	}
}

func TestVerificar_Vetor(t *testing.T) {
	chave := chaveDoVetor(t)

	s, err := Verificar(chave, senhaVetor, venceVetor.Add(-time.Millisecond))
	if err != nil {
		t.Fatalf("Verificar 1 ms antes: %v", err)
	}
	if s != senhaDoVetor() {
		t.Errorf("os campos não são os do vetor: %+v", s)
	}

	if _, err := Verificar(chave, senhaVetor, venceVetor); !errors.Is(err, ErrVencida) {
		t.Errorf("no instante do vence: got %v, want ErrVencida", err)
	}
	if _, err := Verificar(chave, senhaVetor, venceVetor.Add(time.Hour)); !errors.Is(err, ErrVencida) {
		t.Errorf("uma hora depois: got %v, want ErrVencida", err)
	}
}

// assinarJSON assina uma carga qualquer, para testar o que o Assinar não gera.
func assinarJSON(chave []byte, carga string) string {
	c := codificar([]byte(carga))
	return c + "." + assinatura(chave, c)
}

func trocar(texto string, i int) string {
	b := []byte(texto)
	if b[i] == 'A' {
		b[i] = 'B'
	} else {
		b[i] = 'A'
	}
	return string(b)
}

func TestVerificar_Recusa(t *testing.T) {
	chave := chaveDoVetor(t)
	agora := venceVetor.Add(-10 * time.Second)
	outraChave := make([]byte, 32)
	for i := range outraChave {
		outraChave[i] = byte(100 + i)
	}
	ponto := strings.IndexByte(senhaVetor, '.')

	// com devolve o JSON do vetor com um trecho trocado.
	com := func(de, para string) string {
		if !strings.Contains(jsonVetor, de) {
			t.Fatalf("o vetor não tem %q", de)
		}
		return assinarJSON(chave, strings.Replace(jsonVetor, de, para, 1))
	}
	com31 := strings.Repeat("a", 31)
	maiuscula := strings.Repeat("A", 32)

	casos := []struct {
		nome  string
		texto string
		agora time.Time
	}{
		{"caractere da carga trocado", trocar(senhaVetor, 10), agora},
		{"caractere da assinatura trocado", trocar(senhaVetor, ponto+5), agora},
		{"último caractere da assinatura trocado", trocar(senhaVetor, len(senhaVetor)-1), agora},
		{"assinada com outra chave", assinarJSON(outraChave, jsonVetor), agora},
		{"vazia", "", agora},
		{"abc", "abc", agora},
		{"a.b.c", "a.b.c", agora},
		{"sem a assinatura", senhaVetor[:ponto+1], agora},
		{"carga bem assinada que não é JSON", assinarJSON(chave, "isto não é JSON"), agora},
		{"carga com lixo depois do JSON", assinarJSON(chave, jsonVetor+" {}"), agora},
		{"campo a mais", assinarJSON(chave, strings.Replace(jsonVetor, `"id":`, `"extra":1,"id":`, 1)), agora},
		{"v igual a 2", com(`"v":1`, `"v":2`), agora},
		{"papel chefe", com(`"papel":"fora"`, `"papel":"chefe"`), agora},
		{"sala com 31 caracteres", com("0123456789abcdef0123456789abcdef", com31), agora},
		{"sala com 33 caracteres", com("0123456789abcdef0123456789abcdef", com31+"ab"), agora},
		{"sala com maiúsculas", com("0123456789abcdef0123456789abcdef", maiuscula), agora},
		{"sala que não é hexadecimal", com("0123456789abcdef0123456789abcdef", strings.Repeat("g", 32)), agora},
		{"participante com 15 caracteres", com("0011223344556677", "001122334455667"), agora},
		{"id com 33 caracteres", com("ffeeddccbbaa99887766554433221100", "ffeeddccbbaa998877665544332211001"), agora},
		{"nome vazio", com(`"nome":"Maria Lima"`, `"nome":""`), agora},
		// O vetor, só que 61 segundos adiante de agora.
		{"vence 61 segundos adiante", senhaVetor, venceVetor.Add(-MaximoAdiante - time.Second)},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			if _, err := Verificar(chave, c.texto, c.agora); !errors.Is(err, ErrInvalida) {
				t.Errorf("got %v, want ErrInvalida", err)
			}
		})
	}

	// No limite: 60 segundos adiante ainda vale.
	t.Run("vence 60 segundos adiante vale", func(t *testing.T) {
		if _, err := Verificar(chave, senhaVetor, venceVetor.Add(-MaximoAdiante)); err != nil {
			t.Errorf("got %v, want nil", err)
		}
	})
}

func TestUsoUnico(t *testing.T) {
	agora := venceVetor.Add(-10 * time.Second)
	s := senhaDoVetor()

	t.Run("uma vez só", func(t *testing.T) {
		u := NovoUsoUnico()
		if err := u.Usar(s, agora); err != nil {
			t.Fatalf("primeira vez: %v", err)
		}
		if err := u.Usar(s, agora); !errors.Is(err, ErrUsada) {
			t.Errorf("segunda vez: got %v, want ErrUsada", err)
		}
		outra := s
		outra.ID = "00000000000000000000000000000001"
		if err := u.Usar(outra, agora); err != nil {
			t.Errorf("outra senha, com outro id: %v", err)
		}
	})

	t.Run("100 goroutines ao mesmo tempo", func(t *testing.T) {
		u := NovoUsoUnico()
		var passaram, usadas atomic.Int32
		var largada, fim sync.WaitGroup
		largada.Add(1)
		for range 100 {
			fim.Add(1)
			go func() {
				defer fim.Done()
				largada.Wait()
				switch err := u.Usar(s, agora); {
				case err == nil:
					passaram.Add(1)
				case errors.Is(err, ErrUsada):
					usadas.Add(1)
				}
			}()
		}
		largada.Done()
		fim.Wait()
		if passaram.Load() != 1 || usadas.Load() != 99 {
			t.Errorf("passaram %d e foram recusadas %d, want 1 e 99", passaram.Load(), usadas.Load())
		}
	})

	t.Run("a vencida sai da memória", func(t *testing.T) {
		u := NovoUsoUnico()
		if err := u.Usar(s, agora); err != nil {
			t.Fatal(err)
		}
		if u.Tamanho() != 1 {
			t.Fatalf("Tamanho = %d, want 1", u.Tamanho())
		}
		// Ainda dentro do 1 minuto depois do vence: o id continua guardado.
		if err := u.Usar(s, venceVetor.Add(30*time.Second)); err == nil {
			t.Error("uma senha vencida não pode passar")
		}
		if u.Tamanho() != 1 {
			t.Errorf("Tamanho com 30 s de vencida = %d, want 1", u.Tamanho())
		}
		// Vencida há mais de 1 minuto: sai na próxima chamada, e a vencida não entra de novo.
		if err := u.Usar(s, venceVetor.Add(time.Minute+time.Second)); !errors.Is(err, ErrVencida) {
			t.Errorf("got %v, want ErrVencida", err)
		}
		if u.Tamanho() != 0 {
			t.Errorf("Tamanho = %d, want 0", u.Tamanho())
		}
	})
}

func TestLerChave(t *testing.T) {
	chave, err := LerChave(chaveVetor)
	if err != nil {
		t.Fatal(err)
	}
	if len(chave) != 32 {
		t.Fatalf("len = %d, want 32", len(chave))
	}
	for i, b := range chave {
		if int(b) != i {
			t.Fatalf("byte %d = %d, want %d", i, b, i)
		}
	}

	recusas := map[string]string{
		"42 caracteres":       chaveVetor[:42],
		"44 caracteres":       chaveVetor + "A",
		"com +":               "+" + chaveVetor[1:],
		"com /":               "/" + chaveVetor[1:],
		"com = no fim":        chaveVetor[:42] + "=",
		"vazia":               "",
		"com espaço":          " " + chaveVetor[1:],
		"bits a mais no fim":  chaveVetor[:42] + "9",
		"com quebra de linha": chaveVetor[:42] + "\n",
	}
	for nome, texto := range recusas {
		if _, err := LerChave(texto); err == nil {
			t.Errorf("%s: LerChave aceitou %q", nome, texto)
		}
	}
}

func TestNovaChave(t *testing.T) {
	a, b := NovaChave(), NovaChave()
	if len(a) != 43 || len(b) != 43 {
		t.Fatalf("tamanhos %d e %d, want 43", len(a), len(b))
	}
	if _, err := LerChave(a); err != nil {
		t.Errorf("LerChave(NovaChave()): %v", err)
	}
	if a == b {
		t.Error("duas chaves iguais")
	}
}
