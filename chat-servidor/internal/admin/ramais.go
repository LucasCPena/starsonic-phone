package admin

import (
	"fmt"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/ramais"
)

// O estado dos ramais nas duas páginas (a spec do estado dos ramais, seção 4): o que o banco dá
// (as pessoas e os computadores de cada uma) junto com o que o hub sabe agora (quem está ligado, e
// o que o app disse do ramal). As regras são as do pacote ramais; aqui ficam a conta de cada
// empresa e os textos da página.

// contas são as pessoas de uma empresa em cada estado. A soma é o número de pessoas.
type contas struct{ Online, SemRegistro, NoChat, Offline int }

// pessoaVista é uma pessoa com o estado dela e o de cada computador (na ordem do Computadores).
type pessoaVista struct {
	banco.PessoaComComputadores
	Estado ramais.Pessoa
	PCs    []ramais.DoComputador
}

// verPessoas calcula o estado de cada pessoa. Um computador só conta para a pessoa quando o hub
// o tem ligado como ela: na linha de quem já usou aquele PC e não é a pessoa da vez, ele está
// fora.
func verPessoas(pessoas []banco.PessoaComComputadores, ligados map[int64]eventos.Ligado, agora time.Time) []pessoaVista {
	vistas := make([]pessoaVista, 0, len(pessoas))
	for _, p := range pessoas {
		v := pessoaVista{PessoaComComputadores: p, PCs: make([]ramais.DoComputador, 0, len(p.Computadores))}
		vistos := make([]ramais.Visto, 0, len(p.Computadores))
		for _, c := range p.Computadores {
			var visto ramais.Visto
			if l, ok := ligados[c.ID]; ok && l.Pessoa == p.ID {
				visto = ramais.Visto{Ligado: true, Dito: l.Ramal}
			}
			vistos = append(vistos, visto)
			v.PCs = append(v.PCs, ramais.Computador(visto, agora))
		}
		v.Estado = ramais.DaPessoaCom(vistos, agora)
		vistas = append(vistas, v)
	}
	return vistas
}

func contar(vistas []pessoaVista) contas {
	var c contas
	for _, v := range vistas {
		switch v.Estado.Estado {
		case ramais.Online:
			c.Online++
		case ramais.SemRegistro:
			c.SemRegistro++
		case ramais.NoChat:
			c.NoChat++
		default:
			c.Offline++
		}
	}
	return c
}

// ha escreve há quanto tempo, sempre para baixo: "há menos de 1 min", "há 12 min", "há 2 h",
// "há 3 dias". Um tempo negativo (o relógio andou para trás) conta como zero.
func ha(d time.Duration) string {
	const dia = 24 * time.Hour
	switch {
	case d < time.Minute:
		return "há menos de 1 min"
	case d < time.Hour:
		return fmt.Sprintf("há %d min", int(d/time.Minute))
	case d < dia:
		return fmt.Sprintf("há %d h", int(d/time.Hour))
	}
	dias := int(d / dia)
	return fmt.Sprintf("há %d %s", dias, plural(dias, "dia", "dias"))
}

// oQueDiz escreve o que o app diz de um ramal que não registra, com os textos do próprio app.
func oQueDiz(e ramais.Estado) string {
	switch e {
	case ramais.Conectando:
		return "Conectando…"
	case ramais.Erro:
		return "Erro no cadastro"
	case ramais.SemConexao:
		return "Sem conexão com a central"
	}
	return ""
}

// estadoNaTela é o estado de uma pessoa como a página o mostra.
type estadoNaTela struct {
	Classe  string // online, sem-registro, no-chat ou offline: a classe do desenho
	Nome    string // Online, Sem registro, No chat ou Offline
	Detalhe string // a segunda linha
}

// naTela escreve o estado da pessoa: o nome dele e a segunda linha.
func naTela(v pessoaVista, agora time.Time) estadoNaTela {
	switch v.Estado.Estado {
	case ramais.Online:
		return estadoNaTela{"online", "Online", ha(agora.Sub(v.Estado.Desde))}
	case ramais.SemRegistro:
		return estadoNaTela{"sem-registro", "Sem registro",
			ha(agora.Sub(v.Estado.Desde)) + " · o app diz “" + oQueDiz(v.Estado.Diz) + "”"}
	case ramais.NoChat:
		if v.Estado.Registrando {
			return estadoNaTela{"no-chat", "No chat", "registrando o ramal…"}
		}
		return estadoNaTela{"no-chat", "No chat", "o app é antigo e não diz o ramal"}
	}
	// A última vez de uma pessoa é a dela nos computadores: sem nenhum, não há o que mostrar.
	if v.UltimaVez == 0 {
		return estadoNaTela{"offline", "Offline", "sem computador no chat"}
	}
	return estadoNaTela{"offline", "Offline", "última vez " + quando(v.UltimaVez, agora)}
}

// doPC devolve a classe da bolinha de um computador e o estado dele para o leitor de tela.
func doPC(e ramais.DoComputador) (classe, texto string) {
	switch e {
	case ramais.PCRegistrado:
		return "online", "online"
	case ramais.PCSemRegistro:
		return "sem-registro", "sem registro"
	case ramais.PCRegistrando, ramais.PCSemDado:
		return "no-chat", "no chat"
	}
	return "offline", "offline"
}
