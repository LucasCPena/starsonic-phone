package api

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func novaGuardaDePasses() (*passes, *tempo.Teste) {
	rel := tempo.NovoTeste(time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC))
	return novosPasses(rel), rel
}

var anaNaReuniao7 = colegaDaPagina{reuniaoID: 7, empresaID: 1, pessoaID: 11, computadorID: 21}

func TestPasses_UmaVezSo(t *testing.T) {
	p, _ := novaGuardaDePasses()
	passe := p.novoPasse(anaNaReuniao7)
	if len(passe) != 43 {
		t.Fatalf("o passe tem %d caracteres; queria 43", len(passe))
	}
	c, ok := p.gastarPasse(passe, 7)
	if !ok || c != anaNaReuniao7 {
		t.Fatalf("gastarPasse = %+v, %v; queria o colega da Ana", c, ok)
	}
	if _, ok := p.gastarPasse(passe, 7); ok {
		t.Fatal("o passe valeu duas vezes")
	}
}

func TestPasses_DoisAoMesmoTempo(t *testing.T) {
	p, _ := novaGuardaDePasses()
	passe := p.novoPasse(anaNaReuniao7)
	var vitorias atomic.Int32
	var fila sync.WaitGroup
	largada := make(chan struct{})
	for i := 0; i < 50; i++ {
		fila.Add(1)
		go func() {
			defer fila.Done()
			<-largada
			if _, ok := p.gastarPasse(passe, 7); ok {
				vitorias.Add(1)
			}
		}()
	}
	close(largada)
	fila.Wait()
	if n := vitorias.Load(); n != 1 {
		t.Fatalf("%d goroutines gastaram o passe; queria 1", n)
	}
}

func TestPasses_Vence(t *testing.T) {
	p, rel := novaGuardaDePasses()
	cedo := p.novoPasse(anaNaReuniao7)
	tarde := p.novoPasse(anaNaReuniao7)
	rel.Avancar(119 * time.Second)
	if _, ok := p.gastarPasse(cedo, 7); !ok {
		t.Fatal("o passe não vale 119 s depois")
	}
	rel.Avancar(2 * time.Second)
	if _, ok := p.gastarPasse(tarde, 7); ok {
		t.Fatal("o passe vale 121 s depois")
	}
}

func TestPasses_SoDaReuniaoDele(t *testing.T) {
	p, _ := novaGuardaDePasses()
	passe := p.novoPasse(anaNaReuniao7)
	if _, ok := p.gastarPasse(passe, 8); ok {
		t.Fatal("o passe valeu para outra reunião")
	}
	if c, ok := p.gastarPasse(passe, 7); !ok || c != anaNaReuniao7 {
		t.Fatalf("o passe não vale mais para a reunião certa (%+v, %v)", c, ok)
	}
}

func TestPasses_ChaveVale12Horas(t *testing.T) {
	p, rel := novaGuardaDePasses()
	chave := p.novaChave(anaNaReuniao7)
	if len(chave) != 43 {
		t.Fatalf("a chave tem %d caracteres; queria 43", len(chave))
	}
	for i := 0; i < 3; i++ {
		if c, ok := p.conferirChave(chave, 7); !ok || c != anaNaReuniao7 {
			t.Fatalf("a chave não confere na vez %d (%+v, %v)", i, c, ok)
		}
	}
	rel.Avancar(11*time.Hour + 59*time.Minute)
	if _, ok := p.conferirChave(chave, 7); !ok {
		t.Fatal("a chave não confere 11 h 59 min depois")
	}
	rel.Avancar(2 * time.Minute)
	if _, ok := p.conferirChave(chave, 7); ok {
		t.Fatal("a chave confere 12 h 1 min depois")
	}
}

func TestPasses_ChaveSoDaReuniaoDela(t *testing.T) {
	p, _ := novaGuardaDePasses()
	chave := p.novaChave(anaNaReuniao7)
	if _, ok := p.conferirChave(chave, 8); ok {
		t.Fatal("a chave conferiu para outra reunião")
	}
}

func TestPasses_EsquecerChave(t *testing.T) {
	p, _ := novaGuardaDePasses()
	chave := p.novaChave(anaNaReuniao7)
	p.esquecerChave(chave)
	if _, ok := p.conferirChave(chave, 7); ok {
		t.Fatal("a chave conferiu depois do esquecerChave")
	}
	p.esquecerChave(chave) // esquecer de novo não faz mal
}

func TestPasses_AteCinquentaChaves(t *testing.T) {
	p, _ := novaGuardaDePasses()
	carlos := colegaDaPagina{reuniaoID: 7, empresaID: 1, pessoaID: 12, computadorID: 22}
	deOutro := p.novaChave(carlos)
	var chaves []string
	for i := 0; i < maxChavesPorComputador+1; i++ {
		chaves = append(chaves, p.novaChave(anaNaReuniao7))
	}
	if _, ok := p.conferirChave(chaves[0], 7); ok {
		t.Fatal("a 1ª chave sobreviveu à 51ª")
	}
	for i, k := range chaves[1:] {
		if _, ok := p.conferirChave(k, 7); !ok {
			t.Fatalf("a chave %d, das 50 vivas, não confere", i+2)
		}
	}
	if c, ok := p.conferirChave(deOutro, 7); !ok || c != carlos {
		t.Fatalf("a chave do outro computador saiu (%+v, %v)", c, ok)
	}
}

func TestPasses_BilheteDeColega(t *testing.T) {
	p, rel := novaGuardaDePasses()
	p.prenderBilhete("bilhete-um", anaNaReuniao7)
	p.prenderBilhete("bilhete-dois", anaNaReuniao7)
	if c, ok := p.colegaDoBilhete("bilhete-um"); !ok || c != anaNaReuniao7 {
		t.Fatalf("colegaDoBilhete = %+v, %v; queria a Ana", c, ok)
	}
	if _, ok := p.colegaDoBilhete("bilhete-um"); ok {
		t.Fatal("o bilhete valeu duas vezes")
	}
	rel.Avancar(31 * time.Second)
	if _, ok := p.colegaDoBilhete("bilhete-dois"); ok {
		t.Fatal("o bilhete valeu 31 s depois")
	}
}

func TestPasses_NadaEmClaro(t *testing.T) {
	p, _ := novaGuardaDePasses()
	passe := p.novoPasse(anaNaReuniao7)
	chave := p.novaChave(anaNaReuniao7)
	p.prenderBilhete("bilhete-da-ana", anaNaReuniao7)
	p.mu.Lock()
	defer p.mu.Unlock()
	mapas := map[string]string{
		"passes":   fmt.Sprintf("%v", p.passes),
		"chaves":   fmt.Sprintf("%v", p.chaves),
		"bilhetes": fmt.Sprintf("%v", p.bilhetes),
		"fila":     fmt.Sprintf("%v", p.chavesPorComputador),
	}
	for nome, texto := range mapas {
		for _, segredo := range []string{passe, chave, "bilhete-da-ana"} {
			if strings.Contains(texto, segredo) {
				t.Fatalf("o mapa %s guarda um segredo em claro", nome)
			}
		}
	}
}

func TestPasses_TextoQualquer(t *testing.T) {
	p, _ := novaGuardaDePasses()
	passe := p.novoPasse(anaNaReuniao7)
	chave := p.novaChave(anaNaReuniao7)
	longo := strings.Repeat("a", 10000)
	if _, ok := p.gastarPasse("", 7); ok {
		t.Fatal("o passe vazio valeu")
	}
	if _, ok := p.gastarPasse(longo, 7); ok {
		t.Fatal("o passe de 10.000 caracteres valeu")
	}
	if _, ok := p.conferirChave(passe, 7); ok {
		t.Fatal("um passe conferiu como chave")
	}
	if _, ok := p.gastarPasse(chave, 7); ok {
		t.Fatal("uma chave valeu como passe")
	}
	if _, ok := p.conferirChave("", 7); ok {
		t.Fatal("a chave vazia conferiu")
	}
	if _, ok := p.colegaDoBilhete(longo); ok {
		t.Fatal("o bilhete de 10.000 caracteres valeu")
	}
}
