// Package limites guarda as janelas de tempo dos limites: no máximo N usos por período,
// por chave (um endereço, um computador).
package limites

import (
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// Endereco é a chave dos limites por endereço para quem pediu: a dos códigos errados da API e
// a das entradas da página de administração. O servidor não fica atrás de proxy, então o
// X-Forwarded-For não é lido.
//   - IPv4: o próprio endereço (um IPv4 mapeado em IPv6 vira IPv4);
//   - IPv6: o prefixo /64, para que girar endereços dentro do /64 não dê tentativas novas;
//   - o que não der para ler: o RemoteAddr como veio.
func Endereco(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return r.RemoteAddr
	}
	a = a.WithZone("").Unmap()
	if a.Is4() {
		return a.String()
	}
	return netip.PrefixFrom(a, 64).Masked().String()
}

type uso struct {
	quando time.Time
	quanto int
}

// Janela deixa gastar até max por período, por chave. A janela anda com o tempo: cada
// uso sai dela exatamente um período depois de entrar. Vive só na memória.
type Janela struct {
	max     int
	periodo time.Duration
	r       tempo.Relogio

	mu       sync.Mutex
	chaves   map[string][]uso
	limpouEm time.Time
}

// Nova cria uma janela de max usos por período.
func Nova(max int, periodo time.Duration, r tempo.Relogio) *Janela {
	return &Janela{max: max, periodo: periodo, r: r, chaves: map[string][]uso{}, limpouEm: r.Agora()}
}

// podar tira os usos já vencidos de uma chave e devolve o total que sobra. Com j.mu travado.
func (j *Janela) podar(chave string, agora time.Time) int {
	lista := j.chaves[chave]
	corte := agora.Add(-j.periodo)
	i := 0
	for i < len(lista) && !lista[i].quando.After(corte) {
		i++
	}
	lista = lista[i:]
	if len(lista) == 0 {
		delete(j.chaves, chave)
		return 0
	}
	j.chaves[chave] = lista
	total := 0
	for _, u := range lista {
		total += u.quanto
	}
	return total
}

// varrer tira da memória as chaves vencidas, no máximo uma vez por período. Com j.mu travado.
func (j *Janela) varrer(agora time.Time) {
	if agora.Sub(j.limpouEm) < j.periodo {
		return
	}
	j.limpouEm = agora
	for k := range j.chaves {
		j.podar(k, agora)
	}
}

// Usar gasta quanto da chave, se couber, e devolve ok. Se não couber, não conta nada e
// esperar diz quanto falta até caber (um período inteiro, se quanto passa do máximo).
func (j *Janela) Usar(chave string, quanto int) (ok bool, esperar time.Duration) {
	j.mu.Lock()
	defer j.mu.Unlock()
	agora := j.r.Agora()
	j.varrer(agora)
	total := j.podar(chave, agora)
	if total+quanto <= j.max {
		j.chaves[chave] = append(j.chaves[chave], uso{agora, quanto})
		return true, 0
	}
	if quanto > j.max {
		return false, j.periodo
	}
	// Espera até saírem usos suficientes para caber.
	excesso := total + quanto - j.max
	for _, u := range j.chaves[chave] {
		excesso -= u.quanto
		if excesso <= 0 {
			return false, u.quando.Add(j.periodo).Sub(agora)
		}
	}
	return false, j.periodo
}

// Contar gasta quanto da chave sem conferir o máximo.
func (j *Janela) Contar(chave string, quanto int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	agora := j.r.Agora()
	j.varrer(agora)
	j.chaves[chave] = append(j.chaves[chave], uso{agora, quanto})
}

// Devolver desfaz um Usar: tira até quanto dos usos mais novos da chave.
func (j *Janela) Devolver(chave string, quanto int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	lista := j.chaves[chave]
	for quanto > 0 && len(lista) > 0 {
		u := &lista[len(lista)-1]
		if u.quanto > quanto {
			u.quanto -= quanto
			quanto = 0
			break
		}
		quanto -= u.quanto
		lista = lista[:len(lista)-1]
	}
	if len(lista) == 0 {
		delete(j.chaves, chave)
	} else {
		j.chaves[chave] = lista
	}
}

// Tamanho diz quantas chaves a janela guarda na memória agora (para os testes).
func (j *Janela) Tamanho() int {
	j.mu.Lock()
	defer j.mu.Unlock()
	return len(j.chaves)
}
