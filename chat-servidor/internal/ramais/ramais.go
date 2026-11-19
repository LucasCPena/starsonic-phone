// Package ramais são as regras do estado dos ramais na página de administração (seção 4.2 da
// spec do estado dos ramais): o que o app diz do ramal, o estado de cada computador e o de
// cada pessoa. Não tem banco nem HTTP: quem chama diz que horas são.
package ramais

import "time"

// Estado é o que o app diz do ramal (seção 5 do protocolo).
type Estado string

const (
	Conectado  Estado = "conectado"
	Conectando Estado = "conectando"
	Erro       Estado = "erro"
	SemConexao Estado = "semConexao"
)

// Valido diz se o texto é um dos quatro estados.
func Valido(e string) bool {
	switch Estado(e) {
	case Conectado, Conectando, Erro, SemConexao:
		return true
	}
	return false
}

const (
	// MaxSegundos é o maior tempo que o app pode mandar: um ano.
	MaxSegundos = 31_536_000
	// EsperaSemRegistro é quanto um ramal fica sem registrar antes de o computador contar como
	// "sem registro". Sem ela, todo app que abre apareceria em vermelho por alguns segundos.
	EsperaSemRegistro = 60 * time.Second
)

// Dito é o que o app disse do ramal: o estado, e desde quando ele vale (registrado, com o
// Conectado; sem registrar, com os outros três).
type Dito struct {
	Estado Estado
	Desde  time.Time
}

// DoComputador é o estado de um computador na página.
type DoComputador int

const (
	PCFora        DoComputador = iota // o chat não tem o computador ligado como esta pessoa
	PCSemDado                         // ligado, e o app não disse nada (um app antigo)
	PCRegistrando                     // ligado, sem registrar há menos de EsperaSemRegistro
	PCSemRegistro                     // ligado, sem registrar há EsperaSemRegistro ou mais
	PCRegistrado                      // ligado, e o ramal está registrado
)

// Visto é um computador de uma pessoa: se está ligado ao chat como ela agora, e o que o app
// disse do ramal.
type Visto struct {
	Ligado bool
	Dito   *Dito // nil: o app não disse nada
}

// Computador calcula o estado de um computador. Um Desde depois do agora (o relógio do
// servidor andou para trás) conta como zero.
func Computador(v Visto, agora time.Time) DoComputador {
	switch {
	case !v.Ligado:
		return PCFora
	case v.Dito == nil:
		return PCSemDado
	case v.Dito.Estado == Conectado:
		return PCRegistrado
	case agora.Sub(v.Dito.Desde) >= EsperaSemRegistro:
		return PCSemRegistro
	}
	return PCRegistrando
}

// DaPessoa é o estado de uma pessoa na página.
type DaPessoa int

const (
	Offline DaPessoa = iota
	NoChat
	SemRegistro
	Online
)

// Pessoa é o estado de uma pessoa, com o que a segunda linha da página precisa.
type Pessoa struct {
	Estado DaPessoa
	// Desde, no Online e no SemRegistro: desde quando está assim o computador que está assim há
	// mais tempo. Nos outros, o zero.
	Desde time.Time
	// Diz, no SemRegistro: o que diz esse computador. Nos outros, vazio.
	Diz Estado
	// Registrando, no NoChat: algum computador está registrando (senão, é um app antigo).
	Registrando bool
}

// DaPessoaCom calcula o estado da pessoa pelos computadores dela. Vale a primeira linha que
// bate, na ordem da spec: algum registrado, algum sem registro, algum registrando ou sem dado,
// e senão offline.
func DaPessoaCom(computadores []Visto, agora time.Time) Pessoa {
	var online, sem *Dito
	registrando, noChat := false, false
	for _, v := range computadores {
		switch Computador(v, agora) {
		case PCRegistrado:
			if online == nil || v.Dito.Desde.Before(online.Desde) {
				online = v.Dito
			}
		case PCSemRegistro:
			if sem == nil || v.Dito.Desde.Before(sem.Desde) {
				sem = v.Dito
			}
		case PCRegistrando:
			registrando, noChat = true, true
		case PCSemDado:
			noChat = true
		}
	}
	switch {
	case online != nil:
		return Pessoa{Estado: Online, Desde: online.Desde}
	case sem != nil:
		return Pessoa{Estado: SemRegistro, Desde: sem.Desde, Diz: sem.Estado}
	case noChat:
		return Pessoa{Estado: NoChat, Registrando: registrando}
	}
	return Pessoa{Estado: Offline}
}
