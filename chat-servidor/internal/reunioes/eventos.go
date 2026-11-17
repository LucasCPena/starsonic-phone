package reunioes

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// ---------- O fim de uma reunião ----------

type motivo int

const (
	porAcabou   motivo = iota // o FreeSWITCH acabou a sala (o acabou, ou a sala sumiu do estado)
	porEncerrar               // o Encerrar para todos
	porCancelar               // a reunião foi cancelada
)

// terminar acaba a reunião na memória. Os colegas que estavam nela recebem o reuniaoAcabou, e quem estava nela
// sai da memória, com o nome; a página de quem é de fora (também a de quem foi aceito e não entrou) recebe o
// encerrada e fecha. No acabou, quem tem o papel de colega e não está na reunião fica, como no comecando: o colega
// com uma senha que ainda não entrou, ou quem foi aceito na reunião de teste. A senha dele pode recomeçar a reunião.
// Quem espera volta ao naoComecou, ou recebe o linkInvalido quando a reunião acaba de vez: a cancelada, e a naHora
// sem um colega entrando. Devolve o id da naHora que acabou, para o banco (0: nenhuma). Com g.mu.
func (g *Gerente) terminar(s *sala, m motivo, agora time.Time) int64 {
	if s.conhecida {
		g.avisar(s.colegas(), eventoAcabou{Tipo: "reuniaoAcabou", Reuniao: s.reuniao.Codigo})
	}
	for _, p := range s.emOrdem() {
		if m == porAcabou && p.papel == video.Colega && !p.naReuniao && !p.tela {
			continue
		}
		g.esquecer(s, p, "encerrada")
	}
	switch {
	case m == porCancelar:
		g.acabarDeVez(s, agora)
		return 0
	case s.conhecida && s.reuniao.Tipo == banco.TipoNaHora && (m == porEncerrar || !s.comecando()):
		g.acabarDeVez(s, agora)
		return s.reuniao.ID
	}
	g.ajustarPedidos(s, agora)
	g.limpar(s)
	return 0
}

// acabarDeVez fecha a sala de uma reunião que acabou de vez (a naHora ou a cancelada): quem ainda está na memória
// sai, quem espera recebe o linkInvalido, e a sala fica recusada por um tempo. Com g.mu.
func (g *Gerente) acabarDeVez(s *sala, agora time.Time) {
	for _, p := range s.emOrdem() {
		g.esquecer(s, p, "encerrada")
	}
	for _, p := range s.pedidosEmOrdem() {
		g.responder(s, p, "linkInvalido")
	}
	g.marcarFim(s.id, agora)
	if g.salas[s.id] == s {
		delete(g.salas, s.id)
	}
}

// talvezAcabarNaHora acaba a naHora sem ninguém dentro e sem um colega entrando: aos 10 minutos do prazo, se
// ninguém entrou nela, ou já, se alguém entrou e todos saíram. Devolve o id dela para o banco (0: ela continua).
// Com g.mu.
func (g *Gerente) talvezAcabarNaHora(s *sala, agora time.Time) int64 {
	if !s.conhecida || s.reuniao.Tipo != banco.TipoNaHora || s.alguemDentro() || s.comecando() {
		return 0
	}
	if !s.alguemEntrou && agora.Before(s.prazo) {
		return 0
	}
	g.acabarDeVez(s, agora)
	return s.reuniao.ID
}

// acabarNoBanco marca no banco o fim da naHora (o link para de valer). Fora do mutex; o id 0 não faz nada.
func (g *Gerente) acabarNoBanco(id int64) {
	if id == 0 {
		return
	}
	if err := g.banco.AcabarReuniao(g.raiz, id); err != nil && g.raiz.Err() == nil {
		slog.Error("reunioes: não marcou no banco o fim da reunião na hora", "erro", codigoDoErro(err))
	}
}

// codigoDoErro é o código de um erro para o log: nunca o texto dele.
func codigoDoErro(err error) string {
	switch {
	case errors.Is(err, video.ErrNaoEncontrado), errors.Is(err, banco.ErrNaoEncontrado):
		return "naoEncontrado"
	case errors.Is(err, video.ErrSemResposta):
		return "semResposta"
	case errors.Is(err, video.ErrChave):
		return "chave"
	case errors.Is(err, context.Canceled):
		return "cancelado"
	case errors.Is(err, context.DeadlineExceeded):
		return "prazo"
	default:
		return "outro"
	}
}

// ---------- A varredura ----------

// Varrer é a rodada de cada segundo:
//   - as senhas pendentes vencidas saem, pelo relógio do servidor de vídeo, o do vence delas;
//   - os pedidos vencidos são respondidos: o recusado aos 10 minutos de espera, e o linkInvalido quando a reunião
//     deixa de valer;
//   - a naHora sem ninguém acaba: aos 10 minutos se ninguém entrou nela, ou quando todos saíram.
//
// A cada minuto, ela lê no banco as naHora abertas: a que ninguém abriu também acaba, e a que ficou aberta de
// antes de um reinício conta os 10 minutos do começo do gerente.
func (g *Gerente) Varrer() {
	agora := g.relogio.Agora()
	g.lerNaHora(agora)
	agoraVideo := agora
	if v := g.Video(); v != nil {
		agoraVideo = v.Agora()
	}
	g.mu.Lock()
	var acabar []int64
	vencidos := 0
	for _, s := range g.salasEmOrdem() {
		antes := s.retrato()
		for _, p := range s.emOrdem() {
			p.vencerSenhas(agoraVideo)
			if !p.fica(agoraVideo) {
				g.esquecer(s, p, "")
			}
		}
		vencidos += g.vencerPedidos(s, agora)
		if id := g.talvezAcabarNaHora(s, agora); id != 0 {
			acabar = append(acabar, id)
			continue
		}
		g.depois(s, antes)
		g.limpar(s)
	}
	for sala, fim := range g.acabadas {
		if agora.Sub(fim.quando) >= memoriaDoFim {
			delete(g.acabadas, sala)
		}
	}
	g.mu.Unlock()
	for _, id := range acabar {
		g.acabarNoBanco(id)
	}
	g.despachar()
	if vencidos > 0 || len(acabar) > 0 {
		slog.Info("reunioes: varredura", "pedidosVencidos", vencidos, "naHoraAcabadas", len(acabar))
	}
}

// lerNaHora lê no banco as naHora abertas, uma vez por minuto, e põe na memória as que o gerente não conhecia,
// para a regra dos 10 minutos. Fora do mutex.
func (g *Gerente) lerNaHora(agora time.Time) {
	g.mu.Lock()
	if !g.leuNaHora.IsZero() && !agora.Before(g.leuNaHora) && agora.Before(g.leuNaHora.Add(leituraNaHora)) {
		g.mu.Unlock()
		return
	}
	g.leuNaHora = agora
	g.mu.Unlock()
	abertas, err := g.banco.ReunioesNaHoraAbertas(g.raiz)
	if err != nil {
		if g.raiz.Err() == nil {
			slog.Error("reunioes: não leu no banco as reuniões na hora abertas", "erro", codigoDoErro(err))
		}
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, r := range abertas {
		if g.fechada(r.Sala) {
			continue
		}
		s := g.salas[r.Sala]
		if s == nil {
			s = novaSala(r.Sala)
			g.salas[r.Sala] = s
		}
		g.conhecer(s, r)
	}
}

// ---------- Os eventos do servidor de vídeo ----------

// EventoDoVideo segue um evento do servidor de vídeo. Roda na goroutine que lê os eventos, então é rápido: o
// mutex não espera nada, e os avisos saem depois dele. Os eventos são idempotentes: um aviso que repete o que o
// estado já mostrou não muda nada nem avisa ninguém de novo.
//   - o estado acerta quem está em cada sala (reconciliar);
//   - o entrou e o saiu mudam a ligação da câmera, ou a da tela, do participante. O primeiro colega que entra
//     leva os pedidos aos colegas, e o último que sai os devolve ao naoComecou. O entrou de um participante que a
//     sala não conhece, numa reunião conhecida, não muda nada, e o agente recebe o tirar dele (o ligacao);
//   - o acabou acaba a reunião na memória: a naHora acaba também no banco, e a marcada para.
func (g *Gerente) EventoDoVideo(ev video.Evento) { g.evento(g.raiz, ev, 0) }

// evento segue o evento. Com a geracao de um laço (não 0), só se o laço é o do servidor ligado agora. O ctx é o do
// laço (o Ligar seguinte e o fim do Rodar o cancelam), e vale para o tirar que vai ao agente depois do mutex.
func (g *Gerente) evento(ctx context.Context, ev video.Evento, geracao uint64) {
	switch ev.Tipo {
	case "estado", "entrou", "saiu", "acabou":
	default:
		return // o relogio é do cliente, que mede a diferença dos relógios
	}
	agora := g.relogio.Agora()
	agoraVideo := agora
	if v := g.Video(); v != nil {
		agoraVideo = v.Agora()
	}
	g.mu.Lock()
	if geracao != 0 && geracao != g.geracao {
		g.mu.Unlock()
		return
	}
	var acabar []int64
	var tirar bool
	var encerrar []string
	v := g.video
	switch ev.Tipo {
	case "estado":
		salas := make([]video.Sala, 0, len(ev.Salas))
		for _, vs := range ev.Salas {
			if g.fechada(vs.Sala) {
				if g.pedirEncerrar(vs.Sala) {
					encerrar = append(encerrar, vs.Sala)
				}
				continue
			}
			salas = append(salas, vs)
		}
		acabar = g.reconciliar(salas, agora, agoraVideo)
	case "entrou", "saiu":
		if ev.Tipo == "entrou" && g.fechada(ev.Sala) {
			if g.pedirEncerrar(ev.Sala) {
				encerrar = append(encerrar, ev.Sala)
			}
			break
		}
		tirar = g.ligacao(ev.Sala, ev.Participante, ev.Tela, ev.Tipo == "entrou", agora, agoraVideo)
	case "acabou":
		if s := g.salas[ev.Sala]; s != nil {
			acabar = append(acabar, g.terminar(s, porAcabou, agora))
		}
	}
	g.mu.Unlock()
	for _, id := range acabar {
		g.acabarNoBanco(id)
	}
	g.despachar()
	if tirar {
		g.tirarDesconhecido(ctx, v, ev.Sala, ev.Participante)
	}
	g.encerrarAcabadas(v, encerrar)
	if ev.Tipo == "estado" {
		pessoas := 0
		for _, s := range ev.Salas {
			for _, p := range s.Participantes {
				if !p.Tela {
					pessoas++
				}
			}
		}
		slog.Info("reunioes: estado do servidor de vídeo", "freeswitch", ev.FreeSWITCH, "salas", len(ev.Salas),
			"pessoas", pessoas)
	}
}

// ligacao muda a ligação da câmera (ou da tela) do participante: entrou ou saiu. Quem entra sem ser conhecido
// entra sem nome (depois de um reinício do chat, com uma senha de antes dele), menos numa reunião conhecida: ali, o
// participante que a sala não conhece foi tirado, ou saiu e foi esquecido, e ligou com uma senha que ainda valia no
// agente. Esse não entra na sala, e o ligacao devolve true: quem chamou pede ao agente que o tire, depois do mutex.
// Com g.mu.
func (g *Gerente) ligacao(salaID, id string, tela, entrou bool, agora, agoraVideo time.Time) (tirar bool) {
	s := g.salas[salaID]
	if s == nil {
		if !entrou {
			return false
		}
		s = novaSala(salaID)
		g.salas[salaID] = s
	}
	antes := s.retrato()
	p := s.participantes[id]
	if p == nil {
		if !entrou {
			return false
		}
		if s.conhecida {
			return true
		}
		p = g.desconhecido(s, id)
	}
	camera, comTela := p.naReuniao, p.tela
	if tela {
		comTela = entrou
	} else {
		camera = entrou
	}
	s.chamadas(p, camera, comTela)
	if !p.fica(agoraVideo) {
		g.esquecer(s, p, "")
	}
	g.ajustarPedidos(s, agora)
	g.depois(s, antes)
	g.limpar(s)
	return false
}

// tirarDesconhecido pede ao agente que tire o participante que entrou sem ser conhecido numa reunião conhecida (o
// ligacao). Roda na goroutine dos eventos, sem o mutex, com o ctx do laço. O 404 vale como feito: a ligação já saiu.
// Outro erro vai ao log só com o código; um ctx que acabou (o Ligar seguinte, ou o fim do Rodar) não vai.
func (g *Gerente) tirarDesconhecido(ctx context.Context, v Video, sala, participante string) {
	if v == nil {
		return
	}
	if err := v.Tirar(ctx, sala, participante); err != nil && !errors.Is(err, video.ErrNaoEncontrado) && ctx.Err() == nil {
		slog.Warn("reunioes: o servidor de vídeo não tirou quem entrou sem ser conhecido", "erro", codigoDoErro(err))
	}
}

// pedirEncerrar diz se o chat ainda tem de pedir ao agente o encerrar da sala que acabou e voltou num entrou ou num
// estado: uma vez por entrada da memória do fim. Com g.mu.
func (g *Gerente) pedirEncerrar(sala string) bool {
	fim, ok := g.acabadas[sala]
	if !ok || fim.encerrada {
		return false
	}
	fim.encerrada = true
	g.acabadas[sala] = fim
	return true
}

// encerrarAcabadas pede ao agente o encerrar de cada sala que acabou e voltou (o pedirEncerrar). Roda na goroutine
// dos eventos, sem o mutex, com um contexto próprio de 10 s por sala (nunca o de um pedido, nem o do laço: o encerrar
// vale mesmo que o Ligar seguinte chegue). O 404 vale como feito. O registro tem só contagens.
func (g *Gerente) encerrarAcabadas(v Video, salas []string) {
	if v == nil || len(salas) == 0 {
		return
	}
	falhas := 0
	for _, sala := range salas {
		ctx, cancelar := context.WithTimeout(g.raiz, prazoEncerrarAcabada)
		err := v.Encerrar(ctx, sala)
		cancelar()
		if err != nil && !errors.Is(err, video.ErrNaoEncontrado) && g.raiz.Err() == nil {
			falhas++
		}
	}
	slog.Info("reunioes: sala que acabou voltou no servidor de vídeo e foi encerrada", "salas", len(salas),
		"falhas", falhas)
}

// reconciliar acerta a memória pelo estado do servidor de vídeo: o primeiro de cada conexão, e o de quando o
// FreeSWITCH cai ou volta. Em cada sala que veio, quem não veio sai, quem veio sem ser conhecido entra sem nome,
// e quem tinha uma senha e aparece entra com o nome dela. Uma sala que não veio acaba só se alguém estava nela: a
// que está só começando (uma senha emitida, ninguém dentro) fica, e a sala de espera também. Devolve as naHora
// que acabaram, para o banco. Com g.mu.
func (g *Gerente) reconciliar(salas []video.Sala, agora, agoraVideo time.Time) []int64 {
	vieram := make(map[string]bool, len(salas))
	for _, vs := range salas {
		vieram[vs.Sala] = true
	}
	var acabar []int64
	for _, s := range g.salasEmOrdem() {
		if !vieram[s.id] && s.alguemDentro() {
			if id := g.terminar(s, porAcabou, agora); id != 0 {
				acabar = append(acabar, id)
			}
		}
	}
	for _, vs := range salas {
		s := g.salas[vs.Sala]
		if s == nil {
			s = novaSala(vs.Sala)
			g.salas[vs.Sala] = s
		}
		antes := s.retrato()
		type ligacoesDe struct{ camera, tela bool }
		ligacoes := map[string]ligacoesDe{}
		var ordem []string
		for _, vp := range vs.Participantes {
			c, ja := ligacoes[vp.Participante]
			if !ja {
				ordem = append(ordem, vp.Participante)
			}
			if vp.Tela {
				c.tela = true
			} else {
				c.camera = true
			}
			ligacoes[vp.Participante] = c
		}
		for _, p := range s.emOrdem() {
			c := ligacoes[p.id]
			s.chamadas(p, c.camera, c.tela)
			if !p.fica(agoraVideo) {
				g.esquecer(s, p, "")
			}
		}
		for _, id := range ordem {
			if s.participantes[id] == nil {
				c := ligacoes[id]
				s.chamadas(g.desconhecido(s, id), c.camera, c.tela)
			}
		}
		g.ajustarPedidos(s, agora)
		g.depois(s, antes)
		g.limpar(s)
	}
	return acabar
}
