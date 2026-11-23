package api

import (
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// validadeDoPasse é quanto um passe vale: o app o pede e a página o gasta logo em seguida.
const validadeDoPasse = 120 * time.Second

// validadeDaChave é quanto uma chave do colega vale. Ela só existe na memória do chat.
const validadeDaChave = 12 * time.Hour

// maxChavesPorComputador é quantas chaves um computador tem de uma vez. A seguinte apaga a mais velha
// dele, sem mexer nas dos outros.
const maxChavesPorComputador = 50

// colegaDaPagina é quem um passe, uma chave ou um bilhete de colega reconhece.
type colegaDaPagina struct{ reuniaoID, empresaID, pessoaID, computadorID int64 }

// passes guarda na memória os passes, as chaves do colega e os bilhetes de colega, só pelo SHA-256
// (como os bilhetes de eventos.go). Um reinício perde tudo: o app pede outro passe e a página, outra chave.
type passes struct {
	relogio tempo.Relogio

	mu       sync.Mutex
	passes   map[string]vigencia // a chave é o SHA-256 do passe
	chaves   map[string]vigencia // a chave é o SHA-256 da chave do colega
	bilhetes map[string]vigencia // a chave é o SHA-256 do bilhete

	// chavesPorComputador guarda os hashes das chaves de cada computador, da mais velha à mais nova.
	chavesPorComputador map[int64][]string
}

// vigencia é um colega e o instante em que o que o reconhece deixa de valer.
type vigencia struct {
	colega colegaDaPagina
	vence  time.Time
}

func novosPasses(r tempo.Relogio) *passes {
	return &passes{
		relogio:             r,
		passes:              map[string]vigencia{},
		chaves:              map[string]vigencia{},
		bilhetes:            map[string]vigencia{},
		chavesPorComputador: map[int64][]string{},
	}
}

// novoPasse cria um passe de uso único para o colega. Quem limita quantos o computador pede é a rota.
func (p *passes) novoPasse(c colegaDaPagina) string {
	s := segredo.NovoToken()
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	p.passes[string(segredo.Hash(s))] = vigencia{colega: c, vence: agora.Add(validadeDoPasse)}
	return s
}

// gastarPasse tira o passe da guarda e devolve o colega dele. Com outro reuniaoID, não devolve nem tira.
func (p *passes) gastarPasse(passe string, reuniaoID int64) (colegaDaPagina, bool) {
	h := string(segredo.Hash(passe))
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	v, ok := p.passes[h]
	if !ok || v.colega.reuniaoID != reuniaoID {
		return colegaDaPagina{}, false
	}
	delete(p.passes, h)
	return v.colega, true
}

// novaChave cria a chave do colega. Passando de maxChavesPorComputador, a mais velha do computador sai.
func (p *passes) novaChave(c colegaDaPagina) string {
	s := segredo.NovoToken()
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	h := string(segredo.Hash(s))
	p.chaves[h] = vigencia{colega: c, vence: agora.Add(validadeDaChave)}
	fila := append(p.chavesPorComputador[c.computadorID], h)
	for len(fila) > maxChavesPorComputador {
		delete(p.chaves, fila[0])
		fila = fila[1:]
	}
	p.chavesPorComputador[c.computadorID] = fila
	return s
}

// conferirChave devolve o colega da chave, que continua valendo. Com outro reuniaoID, não confere.
func (p *passes) conferirChave(chave string, reuniaoID int64) (colegaDaPagina, bool) {
	h := string(segredo.Hash(chave))
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	v, ok := p.chaves[h]
	if !ok || v.colega.reuniaoID != reuniaoID {
		return colegaDaPagina{}, false
	}
	return v.colega, true
}

// esquecerChave apaga a chave, se ela existir.
func (p *passes) esquecerChave(chave string) {
	h := string(segredo.Hash(chave))
	p.mu.Lock()
	defer p.mu.Unlock()
	p.tirarChave(h)
}

// prenderBilhete prende o bilhete ao colega, por duracaoBilhete.
func (p *passes) prenderBilhete(bilhete string, c colegaDaPagina) {
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	p.bilhetes[string(segredo.Hash(bilhete))] = vigencia{colega: c, vence: agora.Add(duracaoBilhete)}
}

// colegaDoBilhete gasta o bilhete e devolve o colega dele. O bilhete sai na primeira tentativa, mesmo vencido.
func (p *passes) colegaDoBilhete(bilhete string) (colegaDaPagina, bool) {
	h := string(segredo.Hash(bilhete))
	agora := p.relogio.Agora()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.varrer(agora)
	v, ok := p.bilhetes[h]
	if !ok {
		return colegaDaPagina{}, false
	}
	delete(p.bilhetes, h)
	return v.colega, true
}

// tirarChave apaga a chave e a tira da fila do computador. Com p.mu travado.
func (p *passes) tirarChave(h string) {
	v, ok := p.chaves[h]
	if !ok {
		return
	}
	delete(p.chaves, h)
	id := v.colega.computadorID
	fila := p.chavesPorComputador[id]
	for i, f := range fila {
		if f == h {
			fila = append(fila[:i], fila[i+1:]...)
			break
		}
	}
	if len(fila) == 0 {
		delete(p.chavesPorComputador, id)
	} else {
		p.chavesPorComputador[id] = fila
	}
}

// varrer tira da memória o que venceu, a cada chamada. Com p.mu travado.
func (p *passes) varrer(agora time.Time) {
	for h, v := range p.passes {
		if !agora.Before(v.vence) {
			delete(p.passes, h)
		}
	}
	for h, v := range p.bilhetes {
		if !agora.Before(v.vence) {
			delete(p.bilhetes, h)
		}
	}
	for h, v := range p.chaves {
		if !agora.Before(v.vence) {
			p.tirarChave(h)
		}
	}
}
