// Package videotest é um agente de vídeo falso, na memória, para os testes de quem usa o video.Cliente (o gerente
// das reuniões). Tem os mesmos métodos do Cliente, mais os que o teste usa para mexer nele.
package videotest

import (
	"context"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// Falso é o agente falso. É seguro entre goroutines.
type Falso struct {
	chave []byte
	agora func() time.Time

	mu       sync.Mutex
	noAr     bool
	estado   video.Estado
	comandos []string
	erro     error          // o que o DefinirErro pôs
	fila     []video.Evento // o que o Mandar pôs e o Acompanhar ainda não entregou
	aviso    chan struct{}  // acorda o Acompanhar quando chega um evento
}

// NovoFalso devolve um agente falso no ar, com a chave e o relógio dados (agora nil é o relógio do sistema).
func NovoFalso(chave []byte, agora func() time.Time) *Falso {
	if agora == nil {
		agora = time.Now
	}
	return &Falso{chave: chave, agora: agora, noAr: true, aviso: make(chan struct{}, 1)}
}

// Endereco é o host fictício do servidor de vídeo.
func (f *Falso) Endereco() string { return "video.exemplo.com.br" }

// WSS é o endereço fictício do /sip.
func (f *Falso) WSS() string { return "wss://video.exemplo.com.br/sip" }

// Chave é a chave com que o falso foi feito.
func (f *Falso) Chave() []byte { return f.chave }

// Agora é o relógio do agente falso.
func (f *Falso) Agora() time.Time { return f.agora() }

// NoAr diz o que o DefinirNoAr pôs (no ar, a princípio).
func (f *Falso) NoAr() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.noAr
}

// DefinirNoAr põe o vídeo no ar ou fora dele. Fora do ar, o Estado, o Tirar e o Encerrar dão video.ErrSemResposta.
// Vale pelas duas condições do Cliente.NoAr: a conexão aberta e o FreeSWITCH ligado.
func (f *Falso) DefinirNoAr(noAr bool) {
	f.mu.Lock()
	f.noAr = noAr
	f.mu.Unlock()
}

// DefinirEstado põe o estado que o Estado devolve. O Agora vem do relógio do falso, quando está zerado.
func (f *Falso) DefinirEstado(e video.Estado) {
	f.mu.Lock()
	f.estado = e
	f.mu.Unlock()
}

// Estado devolve o estado definido.
func (f *Falso) Estado(ctx context.Context) (video.Estado, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.noAr {
		return video.Estado{}, video.ErrSemResposta
	}
	e := f.estado
	if e.Agora == 0 {
		e.Agora = f.agora().UnixMilli()
	}
	return e, nil
}

// DefinirErro faz o Tirar e o Encerrar devolverem err, sem anotar comando nenhum, enquanto ele estiver posto
// (nil o desfaz). É a falha do agente que não é o 404, como o video.ErrSemResposta ou o video.ErrChave.
func (f *Falso) DefinirErro(err error) {
	f.mu.Lock()
	f.erro = err
	f.mu.Unlock()
}

func (f *Falso) comando(c string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.erro != nil {
		return f.erro
	}
	if !f.noAr {
		return video.ErrSemResposta
	}
	f.comandos = append(f.comandos, c)
	return nil
}

// Tirar anota "tirar <sala> <participante>".
func (f *Falso) Tirar(ctx context.Context, sala, participante string) error {
	return f.comando("tirar " + sala + " " + participante)
}

// Encerrar anota "encerrar <sala>".
func (f *Falso) Encerrar(ctx context.Context, sala string) error {
	return f.comando("encerrar " + sala)
}

// Comandos são os comandos recebidos, em ordem.
func (f *Falso) Comandos() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.comandos...)
}

// Mandar entrega o evento ao f de quem acompanha, na ordem. Um evento mandado antes de alguém acompanhar fica
// guardado e sai quando o Acompanhar põe o f. A entrega é feita pelo Acompanhar, numa goroutine só, então o f pode
// chamar o falso à vontade. O falso não manda um estado sozinho: o teste manda o que quer.
func (f *Falso) Mandar(ev video.Evento) {
	f.mu.Lock()
	f.fila = append(f.fila, ev)
	f.mu.Unlock()
	select {
	case f.aviso <- struct{}{}:
	default:
	}
}

// Acompanhar passa ao f os eventos do Mandar, os que já esperavam e os de depois, e volta quando o ctx acaba.
func (f *Falso) Acompanhar(ctx context.Context, fn func(video.Evento)) {
	for {
		f.mu.Lock()
		var ev video.Evento
		tem := len(f.fila) > 0
		if tem {
			ev = f.fila[0]
			f.fila = f.fila[1:]
		}
		f.mu.Unlock()
		if tem {
			if ctx.Err() != nil {
				f.mu.Lock()
				f.fila = append([]video.Evento{ev}, f.fila...) // não se perde: o próximo Acompanhar o entrega
				f.mu.Unlock()
				return
			}
			fn(ev)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-f.aviso:
		}
	}
}
