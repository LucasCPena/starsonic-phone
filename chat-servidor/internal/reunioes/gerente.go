// Package reunioes é o gerente das reuniões com link no chat (docs/chat-protocolo.md, seções 9 a 12): quem está
// em cada reunião, as senhas de uso único ainda não usadas, a sala de espera e os limites. Tudo fica na memória,
// sob um mutex só; os nomes de quem é de fora nunca vão ao banco e somem quando a reunião acaba.
//
// O gerente segue os eventos do servidor de vídeo (docs/video-agente.md, seção 5). Ele nunca chama o servidor de
// vídeo, nem avisa um app ou uma página, com o mutex travado: os avisos e as mensagens entram numa fila, na ordem
// em que o estado mudou, e saem depois dele.
package reunioes

import (
	"cmp"
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// Os limites das reuniões (docs/chat-protocolo.md, seção 12).
const (
	maxPessoas    = 10               // pessoas por reunião, sem contar a tela compartilhada
	esperaNaHora  = 10 * time.Minute // a naHora em que ninguém entrou acaba
	leituraNaHora = time.Minute      // de quanto em quanto o Varrer lê no banco as naHora abertas
	// memoriaDoFim é quanto tempo a sala de uma reunião que acabou de vez fica recusada na memória: quem leu a
	// reunião do banco antes do fim não entra nela.
	memoriaDoFim = 10 * time.Minute
)

// Os erros do gerente. A API do app e a da página dão a cada um o status e a mensagem do protocolo.
var (
	// ErrLinkInvalido: a reunião não vale (cancelada, depois do valeAte, ou a naHora acabou).
	ErrLinkInvalido = errors.New("reunioes: o link não vale")
	// ErrCheia: a reunião já tem 10 pessoas, contando as senhas da câmera emitidas e ainda não usadas.
	ErrCheia = errors.New("reunioes: a reunião está cheia")
	// ErrServidorCheio: a reunião está parada, e o servidor de vídeo já está no limite de reuniões ao mesmo tempo.
	ErrServidorCheio = errors.New("reunioes: o servidor de vídeo está no limite de reuniões ao mesmo tempo")
	// ErrSemServidor: nenhum servidor de vídeo foi ligado, ou ele não está no ar (o agente ou o FreeSWITCH).
	ErrSemServidor = errors.New("reunioes: o servidor de vídeo não está no ar")
	// ErrJaRespondido: o pedido já foi aceito, recusado, retirado ou venceu.
	ErrJaRespondido = errors.New("reunioes: o pedido já foi respondido")
	// ErrPedidoNaoEncontrado: o pedido não existe nesta reunião.
	ErrPedidoNaoEncontrado = errors.New("reunioes: o pedido não existe")
	// ErrForaDaReuniao: a pessoa não está na reunião (a câmera dela não entrou, ou já saiu).
	ErrForaDaReuniao = errors.New("reunioes: a pessoa não está na reunião")
	// ErrParticipanteNaoEncontrado: o participante não está na reunião.
	ErrParticipanteNaoEncontrado = errors.New("reunioes: o participante não está na reunião")
	// ErrLimite: mais de 5 senhas novas no minuto para o mesmo participante.
	ErrLimite = errors.New("reunioes: senhas novas demais neste minuto")
	// ErrForaDeOrdem: o NovaSenha antes do aceito, depois do fim do pedido ou com a pessoa já na reunião. A página
	// responde erro invalido.
	ErrForaDeOrdem = errors.New("reunioes: o pedido não espera uma senha nova agora")
)

// Video é o servidor de vídeo: o video.Cliente, ou o videotest.Falso nos testes.
type Video interface {
	Tirar(ctx context.Context, sala, participante string) error
	Encerrar(ctx context.Context, sala string) error
	Estado(ctx context.Context) (video.Estado, error)
	Acompanhar(ctx context.Context, f func(video.Evento))
	NoAr() bool
	Endereco() string
	WSS() string
	Chave() []byte
	Agora() time.Time
}

// Avisos manda os eventos da seção 11 aos computadores dos apps: o eventos.Hub. Não pode esperar.
type Avisos interface {
	ParaComputadores(ids []int64, ev any)
}

// Deps são as dependências do gerente, todas obrigatórias.
type Deps struct {
	Banco   *banco.Banco
	Avisos  Avisos
	Relogio tempo.Relogio // o relógio do chat
}

// ParticipanteVisto é o Participante da seção 9: quem está na reunião. Depois de um reinício do chat, quem já
// estava nela aparece sem o nome e com o deFora falso.
type ParticipanteVisto struct {
	ID     string `json:"id"`
	Nome   string `json:"nome"`
	DeFora bool   `json:"deFora"`
	Tela   bool   `json:"tela"`
}

// PedidoVisto é o Pedido da seção 9: quem pediu para entrar e espera.
type PedidoVisto struct {
	ID   string `json:"id"`
	Nome string `json:"nome"`
}

// Lista é o que os colegas na reunião veem (o GET participantes e o reuniaoParticipantes). As listas nunca são nulas.
type Lista struct {
	Participantes []ParticipanteVisto `json:"participantes"`
	Pedidos       []PedidoVisto       `json:"pedidos"`
}

// Os eventos das reuniões para os apps (seção 11). O reuniaoAgora é da API do app.
type (
	eventoPedido struct {
		Tipo    string      `json:"tipo"`
		Reuniao string      `json:"reuniao"`
		Pedido  PedidoVisto `json:"pedido"`
	}
	eventoPedidoFim struct {
		Tipo    string `json:"tipo"`
		Reuniao string `json:"reuniao"`
		Pedido  string `json:"pedido"`
	}
	eventoParticipantes struct {
		Tipo    string `json:"tipo"`
		Reuniao string `json:"reuniao"`
		Lista
	}
	eventoAcabou struct {
		Tipo    string `json:"tipo"`
		Reuniao string `json:"reuniao"`
	}
)

// Gerente guarda as reuniões que estão acontecendo, começando ou com gente esperando.
type Gerente struct {
	banco   *banco.Banco
	avisos  Avisos
	relogio tempo.Relogio
	inicio  time.Time // o começo do gerente: a naHora aberta de antes dele conta os 10 minutos daqui

	raiz      context.Context // o do gerente: o laço dos eventos e o banco; o fim do Rodar o cancela
	pararRaiz context.CancelFunc
	ligarMu   sync.Mutex // um Ligar (ou o fim do Rodar) por vez

	mu        sync.Mutex
	video     Video
	geracao   uint64 // cresce a cada Ligar: o laço de um servidor anterior não muda mais nada
	laco      laco
	salas     map[string]*sala
	acabadas  map[string]time.Time // as salas das reuniões que acabaram de vez, e quando (relógio do chat)
	leuNaHora time.Time            // quando o Varrer leu as naHora abertas (relógio do chat)
	seq       uint64               // a ordem de chegada dos participantes e dos pedidos
	saida     []func()             // os avisos e as mensagens, na ordem do estado, para depois do mutex
	enviando  bool                 // uma goroutine está mandando a saida
}

// laco é o laço que acompanha os eventos do servidor de vídeo ligado.
type laco struct {
	parar context.CancelFunc
	fim   chan struct{} // fechado quando o Acompanhar volta
}

// sala é uma reunião na memória, pela sala dela no servidor de vídeo.
type sala struct {
	id            string
	reuniao       banco.Reuniao // a reunião, quando conhecida (um EntrarColega, um Pedir ou a leitura das naHora)
	conhecida     bool
	prazo         time.Time // naHora: o fim, se ninguém entrar (relógio do chat)
	alguemEntrou  bool      // alguém já esteve na reunião
	participantes map[string]*participante
	pedidos       map[string]*Pedido // os que esperam
	respondidos   map[string]bool    // os ids dos pedidos que saíram da espera, para o ErrJaRespondido
}

// participante é uma pessoa na reunião, ou com uma senha para entrar nela.
type participante struct {
	id         string
	pessoa     int64 // o colega; 0 para quem é de fora e para quem o chat não conhece
	computador int64 // o computador do colega, que recebe os avisos
	nome       string
	deFora     bool
	papel      video.Papel
	naReuniao  bool // a câmera entrou e não saiu
	tela       bool // a tela compartilhada entrou e não saiu
	pendentes  []pendente
	esquecerEm time.Time   // relógio do vídeo: quem não entrou sai da memória depois disto
	pedido     *Pedido     // de quem é de fora: o pedido aceito, com a página
	novas      []time.Time // os NovaSenha do último minuto (relógio do chat)
	seq        uint64
}

// Novo cria o gerente, sem servidor de vídeo.
func Novo(d Deps) *Gerente {
	raiz, parar := context.WithCancel(context.Background())
	return &Gerente{banco: d.Banco, avisos: d.Avisos, relogio: d.Relogio, inicio: d.Relogio.Agora(),
		raiz: raiz, pararRaiz: parar, salas: map[string]*sala{}, acabadas: map[string]time.Time{}}
}

// Rodar chama o Varrer a cada segundo, a primeira vez já, até o ctx acabar. No fim, para o laço dos eventos do
// servidor de vídeo e espera ele voltar.
func (g *Gerente) Rodar(ctx context.Context) {
	defer g.parar()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		g.Varrer()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (g *Gerente) parar() {
	g.pararRaiz()
	g.ligarMu.Lock()
	defer g.ligarMu.Unlock()
	g.mu.Lock()
	fim := g.laco.fim
	g.mu.Unlock()
	if fim != nil {
		<-fim
	}
}

// Ligar passa a usar o servidor de vídeo v (nil: nenhum). O laço dos eventos do anterior para, e o Ligar espera
// ele voltar antes de começar o de v: há um Acompanhar só por cliente, e um evento atrasado do anterior não muda
// nada. O laço roda num contexto do gerente, também quando o Ligar vem antes do Rodar. As reuniões na memória
// ficam: o primeiro estado de v as acerta.
func (g *Gerente) Ligar(v Video) {
	if c, ok := v.(*video.Cliente); ok && c == nil {
		v = nil
	}
	g.ligarMu.Lock()
	defer g.ligarMu.Unlock()
	g.mu.Lock()
	velho := g.laco
	g.video, g.laco = v, laco{}
	g.geracao++
	geracao := g.geracao
	g.mu.Unlock()
	if velho.parar != nil {
		velho.parar()
		<-velho.fim
	}
	if v == nil {
		return
	}
	ctx, parar := context.WithCancel(g.raiz)
	fim := make(chan struct{})
	g.mu.Lock()
	g.laco = laco{parar: parar, fim: fim}
	g.mu.Unlock()
	go func() {
		defer close(fim)
		v.Acompanhar(ctx, func(ev video.Evento) { g.evento(ev, geracao) })
	}()
}

// Video é o servidor de vídeo ligado (nil: nenhum).
func (g *Gerente) Video() Video {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.video
}

// ---------- O estado de cada sala (tudo com g.mu) ----------

func novaSala(id string) *sala {
	return &sala{id: id, participantes: map[string]*participante{}, pedidos: map[string]*Pedido{},
		respondidos: map[string]bool{}}
}

// emOrdem são os participantes, na ordem de chegada.
func (s *sala) emOrdem() []*participante {
	l := make([]*participante, 0, len(s.participantes))
	for _, p := range s.participantes {
		l = append(l, p)
	}
	slices.SortFunc(l, func(a, b *participante) int { return cmp.Compare(a.seq, b.seq) })
	return l
}

// pedidosEmOrdem são os pedidos que esperam, na ordem de chegada.
func (s *sala) pedidosEmOrdem() []*Pedido {
	l := make([]*Pedido, 0, len(s.pedidos))
	for _, p := range s.pedidos {
		l = append(l, p)
	}
	slices.SortFunc(l, func(a, b *Pedido) int { return cmp.Compare(a.seq, b.seq) })
	return l
}

// naReuniao é quantas pessoas estão na reunião: as câmeras, sem a tela.
func (s *sala) naReuniao() int {
	n := 0
	for _, p := range s.participantes {
		if p.naReuniao {
			n++
		}
	}
	return n
}

// pessoas são as que contam nas 10: quem está na reunião mais quem tem uma senha da câmera ainda não usada.
func (s *sala) pessoas() int {
	n := 0
	for _, p := range s.participantes {
		if p.naReuniao || p.temSenha(false) {
			n++
		}
	}
	return n
}

// comecando diz se alguém com o papel de colega tem uma senha da câmera ainda não usada: ele pode começar a reunião.
func (s *sala) comecando() bool {
	for _, p := range s.participantes {
		if p.papel == video.Colega && !p.naReuniao && p.temSenha(false) {
			return true
		}
	}
	return false
}

// ativa: a reunião acontece ou está começando. As duas contam no limite de reuniões ao mesmo tempo.
func (s *sala) ativa() bool { return s.naReuniao() > 0 || s.comecando() }

// alguemDentro: alguma ligação está na sala, a de uma câmera ou a de uma tela.
func (s *sala) alguemDentro() bool {
	for _, p := range s.participantes {
		if p.naReuniao || p.tela {
			return true
		}
	}
	return false
}

// temColega: algum colega da empresa está na reunião. Os pedidos chegam só a ele.
func (s *sala) temColega() bool {
	for _, p := range s.participantes {
		if p.pessoa != 0 && p.naReuniao {
			return true
		}
	}
	return false
}

// colegas são os computadores dos colegas na reunião: os que recebem os avisos da seção 11.
func (s *sala) colegas() []int64 {
	var ids []int64
	for _, p := range s.participantes {
		if p.pessoa != 0 && p.naReuniao && p.computador != 0 && !slices.Contains(ids, p.computador) {
			ids = append(ids, p.computador)
		}
	}
	slices.Sort(ids)
	return ids
}

// colegaNaReuniao é o participante do colega na reunião (o que chegou por último, se ele entrou de dois
// computadores), ou nil.
func (s *sala) colegaNaReuniao(pessoaID int64) *participante {
	var achado *participante
	for _, p := range s.participantes {
		if pessoaID != 0 && p.pessoa == pessoaID && p.naReuniao && (achado == nil || p.seq > achado.seq) {
			achado = p
		}
	}
	return achado
}

// retrato é a Lista de agora: quem está na reunião e os pedidos que chegaram aos colegas.
func (s *sala) retrato() Lista {
	l := Lista{Participantes: []ParticipanteVisto{}, Pedidos: []PedidoVisto{}}
	for _, p := range s.emOrdem() {
		if p.naReuniao {
			l.Participantes = append(l.Participantes, ParticipanteVisto{ID: p.id, Nome: p.nome, DeFora: p.deFora, Tela: p.tela})
		}
	}
	for _, p := range s.pedidosEmOrdem() {
		if p.visivel {
			l.Pedidos = append(l.Pedidos, PedidoVisto{ID: p.id, Nome: p.nome})
		}
	}
	return l
}

// vazia: a sala não guarda mais nada. A naHora conhecida fica até acabar, pela regra dos 10 minutos.
func (s *sala) vazia() bool {
	return len(s.participantes) == 0 && len(s.pedidos) == 0 && !(s.conhecida && s.reuniao.Tipo == banco.TipoNaHora)
}

// chamadas põe no participante as ligações que o servidor de vídeo diz que ele tem. A ligação que entra usa as
// senhas pendentes dela.
func (s *sala) chamadas(p *participante, camera, tela bool) {
	if camera && !p.naReuniao {
		p.usouSenha(false)
		p.esquecerEm = time.Time{}
		s.alguemEntrou = true
	}
	if tela && !p.tela {
		p.usouSenha(true)
	}
	p.naReuniao, p.tela = camera, tela
}

// fica diz se o participante ainda tem por que estar na memória: está na reunião, tem uma senha pendente (ou na
// graça depois dela), ou é de fora com a página aberta depois do aceito.
func (p *participante) fica(agoraVideo time.Time) bool {
	return p.naReuniao || p.tela || len(p.pendentes) > 0 || agoraVideo.Before(p.esquecerEm) ||
		(p.pedido != nil && p.pedido.canal != nil)
}

// salaDe é a sala da reunião, criada se preciso, com a reunião conhecida.
func (g *Gerente) salaDe(r banco.Reuniao) *sala {
	s := g.salas[r.Sala]
	if s == nil {
		s = novaSala(r.Sala)
		g.salas[r.Sala] = s
	}
	g.conhecer(s, r)
	return s
}

// conhecer põe a reunião na sala que ainda não a tinha. A naHora ganha o prazo dos 10 minutos, contados da
// criação ou, se ela é de antes do gerente (um reinício), do começo dele.
func (g *Gerente) conhecer(s *sala, r banco.Reuniao) {
	if s.conhecida {
		return
	}
	s.reuniao, s.conhecida = r, true
	if r.Tipo == banco.TipoNaHora {
		s.prazo = maisTarde(time.UnixMilli(r.CriadaEm), g.inicio).Add(esperaNaHora)
	}
}

// limpar tira da memória a sala que não guarda mais nada.
func (g *Gerente) limpar(s *sala) {
	if g.salas[s.id] == s && s.vazia() {
		delete(g.salas, s.id)
	}
}

func (g *Gerente) proximo() uint64 {
	g.seq++
	return g.seq
}

// novoParticipante põe na sala um participante novo, com um id que ela não usa.
func (g *Gerente) novoParticipante(s *sala, pessoa, computador int64, nome string, deFora bool, papel video.Papel) *participante {
	id := segredo.NovoHex(8)
	for s.participantes[id] != nil {
		id = segredo.NovoHex(8)
	}
	p := &participante{id: id, pessoa: pessoa, computador: computador, nome: nome, deFora: deFora, papel: papel,
		seq: g.proximo()}
	s.participantes[id] = p
	return p
}

// desconhecido põe na sala quem o servidor de vídeo diz que está nela e o chat não conhece (depois de um
// reinício do chat): sem nome, sem pessoa e não de fora.
func (g *Gerente) desconhecido(s *sala, id string) *participante {
	p := &participante{id: id, seq: g.proximo()}
	s.participantes[id] = p
	return p
}

// esquecer tira o participante da memória, com o nome. A página de quem é de fora, aberta depois do aceito,
// recebe msg e fecha (sem msg, nada vai a ela).
func (g *Gerente) esquecer(s *sala, p *participante, msg string) {
	delete(s.participantes, p.id)
	if ped := p.pedido; ped != nil {
		if msg != "" && ped.canal != nil {
			g.mandar(ped.canal, mensagem{Tipo: msg})
			g.fechar(ped.canal)
		}
		ped.fase, ped.canal, ped.part, ped.nome = fim, nil, nil, ""
	}
}

func (g *Gerente) fechada(sala string) bool {
	_, ok := g.acabadas[sala]
	return ok
}

func (g *Gerente) ativas() int {
	n := 0
	for _, s := range g.salas {
		if s.ativa() {
			n++
		}
	}
	return n
}

// salasEmOrdem são as salas pelo id: os avisos de uma varredura saem sempre na mesma ordem.
func (g *Gerente) salasEmOrdem() []*sala {
	l := make([]*sala, 0, len(g.salas))
	for _, s := range g.salas {
		l = append(l, s)
	}
	slices.SortFunc(l, func(a, b *sala) int { return strings.Compare(a.id, b.id) })
	return l
}

// ---------- A saída: os avisos e as mensagens, depois do mutex ----------

// avisar põe na saída o evento para os computadores. Com g.mu.
func (g *Gerente) avisar(ids []int64, ev any) {
	if len(ids) > 0 {
		g.saida = append(g.saida, func() { g.avisos.ParaComputadores(ids, ev) })
	}
}

// mandar põe na saída a mensagem para a página. Com g.mu.
func (g *Gerente) mandar(c Canal, msg any) {
	if c != nil {
		g.saida = append(g.saida, func() { c.Mandar(msg) })
	}
}

// fechar põe na saída o fechamento da página. Com g.mu.
func (g *Gerente) fechar(c Canal) {
	if c != nil {
		g.saida = append(g.saida, c.Fechar)
	}
}

// depois avisa os colegas na reunião se a lista que eles veem mudou desde antes. Com g.mu.
func (g *Gerente) depois(s *sala, antes Lista) {
	if !s.conhecida {
		return
	}
	agora := s.retrato()
	if slices.Equal(antes.Participantes, agora.Participantes) && slices.Equal(antes.Pedidos, agora.Pedidos) {
		return
	}
	g.avisar(s.colegas(), eventoParticipantes{Tipo: "reuniaoParticipantes", Reuniao: s.reuniao.Codigo, Lista: agora})
}

// despachar manda o que está na saída, sem o mutex, na ordem em que entrou. Uma goroutine manda por vez: quem
// chega enquanto outra manda deixa os seus para ela, que os pega na volta seguinte. Assim um aviso nunca passa na
// frente de outro, e um Mandar que chama o gerente de volta não trava.
func (g *Gerente) despachar() {
	for {
		g.mu.Lock()
		if g.enviando || len(g.saida) == 0 {
			g.mu.Unlock()
			return
		}
		lote := g.saida
		g.saida, g.enviando = nil, true
		g.mu.Unlock()
		g.enviar(lote)
	}
}

func (g *Gerente) enviar(lote []func()) {
	defer func() {
		g.mu.Lock()
		g.enviando = false
		g.mu.Unlock()
	}()
	for _, f := range lote {
		f()
	}
}

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
	g.acabadas[s.id] = agora
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
	for sala, quando := range g.acabadas {
		if agora.Sub(quando) >= memoriaDoFim {
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
//     leva os pedidos aos colegas, e o último que sai os devolve ao naoComecou;
//   - o acabou acaba a reunião na memória: a naHora acaba também no banco, e a marcada para.
func (g *Gerente) EventoDoVideo(ev video.Evento) { g.evento(ev, 0) }

// evento segue o evento. Com a geracao de um laço (não 0), só se o laço é o do servidor ligado agora.
func (g *Gerente) evento(ev video.Evento, geracao uint64) {
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
	switch ev.Tipo {
	case "estado":
		acabar = g.reconciliar(ev.Salas, agora, agoraVideo)
	case "entrou", "saiu":
		g.ligacao(ev.Sala, ev.Participante, ev.Tela, ev.Tipo == "entrou", agora, agoraVideo)
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
// entra sem nome. Com g.mu.
func (g *Gerente) ligacao(salaID, id string, tela, entrou bool, agora, agoraVideo time.Time) {
	s := g.salas[salaID]
	if s == nil {
		if !entrou {
			return
		}
		s = novaSala(salaID)
		g.salas[salaID] = s
	}
	antes := s.retrato()
	p := s.participantes[id]
	if p == nil {
		if !entrou {
			return
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

// ---------- O que o app pede ----------

// limite é o de reuniões ao mesmo tempo, lido do banco a cada vez: a administração o muda sem reiniciar o chat.
func (g *Gerente) limite(ctx context.Context) (int, error) {
	cfg, err := g.banco.ConfigReunioes(ctx)
	return cfg.Limite, err
}

// antesDoBanco faz as duas primeiras conferências de uma entrada, antes de ler o limite no banco.
func (g *Gerente) antesDoBanco(r banco.Reuniao, d doVideo, agora time.Time) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.conferirAntes(r, d, agora)
}

// conferirAntes faz as duas primeiras conferências de uma entrada: a reunião vale (ErrLinkInvalido) e o servidor de
// vídeo está no ar (ErrSemServidor). Com g.mu.
func (g *Gerente) conferirAntes(r banco.Reuniao, d doVideo, agora time.Time) error {
	if !r.Vale(agora.UnixMilli()) || g.fechada(r.Sala) {
		return ErrLinkInvalido
	}
	if !g.serve(d) {
		return ErrSemServidor
	}
	return nil
}

// conferirEntrada faz as conferências de uma entrada nova, na ordem do protocolo: as duas do conferirAntes, a
// reunião não está cheia (ErrCheia, quando a entrada é de uma pessoa a mais) e, quando a entrada pode começar a
// reunião parada, ela cabe no limite (ErrServidorCheio). Com g.mu.
func (g *Gerente) conferirEntrada(r banco.Reuniao, d doVideo, limite int, agora time.Time, maisUma, comeca bool) error {
	if err := g.conferirAntes(r, d, agora); err != nil {
		return err
	}
	s := g.salas[r.Sala]
	switch {
	case maisUma && s != nil && s.pessoas() >= maxPessoas:
		return ErrCheia
	case comeca && (s == nil || !s.ativa()) && g.ativas() >= limite:
		return ErrServidorCheio
	}
	return nil
}

// EntrarColega dá ao colega da empresa o Acesso a uma reunião: um participante novo, com a senha de colega, que
// começa a reunião parada. As conferências vão na ordem do protocolo: ErrLinkInvalido, ErrSemServidor, ErrCheia e
// ErrServidorCheio. A empresa e as reuniões liberadas são da API.
func (g *Gerente) EntrarColega(ctx context.Context, r banco.Reuniao, p banco.Pessoa, computadorID int64) (Acesso, error) {
	agora := g.relogio.Agora()
	d := g.lerVideo()
	if err := g.antesDoBanco(r, d, agora); err != nil {
		return Acesso{}, err
	}
	limite, err := g.limite(ctx)
	if err != nil {
		return Acesso{}, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.conferirEntrada(r, d, limite, agora, true, true); err != nil {
		return Acesso{}, err
	}
	s := g.salaDe(r)
	part := g.novoParticipante(s, p.ID, computadorID, p.Nome, false, video.Colega)
	senha, err := emitir(d, s, part, false)
	if err != nil {
		delete(s.participantes, part.id)
		g.limpar(s)
		return Acesso{}, err
	}
	return d.acesso(part.id, senha), nil
}

// Tirar tira o participante da reunião, com a câmera e a tela, pelo servidor de vídeo. Quem pede tem de estar na
// reunião. O 404 do vídeo vale como feito: ele já tinha saído; outro erro volta, e nada muda. A página de quem é
// de fora recebe o tirado e fecha, e a senha nova não a deixa voltar.
func (g *Gerente) Tirar(ctx context.Context, r banco.Reuniao, pessoaID int64, participante string) error {
	g.mu.Lock()
	s := g.salas[r.Sala]
	if s == nil || s.colegaNaReuniao(pessoaID) == nil {
		g.mu.Unlock()
		return ErrForaDaReuniao
	}
	if p := s.participantes[participante]; p == nil || !p.naReuniao && !p.tela {
		g.mu.Unlock()
		return ErrParticipanteNaoEncontrado
	}
	v := g.video
	g.mu.Unlock()
	if v == nil {
		return ErrSemServidor
	}
	if err := v.Tirar(ctx, r.Sala, participante); err != nil && !errors.Is(err, video.ErrNaoEncontrado) {
		return err
	}
	agora := g.relogio.Agora()
	g.mu.Lock()
	if s := g.salas[r.Sala]; s != nil {
		if p := s.participantes[participante]; p != nil {
			antes := s.retrato()
			g.esquecer(s, p, "tirado")
			g.ajustarPedidos(s, agora)
			g.depois(s, antes)
			g.limpar(s)
		}
	}
	g.mu.Unlock()
	g.despachar()
	return nil
}

// Encerrar encerra a reunião para todos, pelo servidor de vídeo: todos saem, e a página de cada um recebe o
// encerrada. A naHora acaba, e o link dela para de valer; a marcada para, e quem espera volta ao naoComecou. Quem
// pede tem de estar na reunião; o pessoaID 0 é o próprio servidor. O 404 do vídeo vale como feito; outro erro
// volta, e nada muda.
func (g *Gerente) Encerrar(ctx context.Context, r banco.Reuniao, pessoaID int64) error {
	g.mu.Lock()
	if pessoaID != 0 {
		if s := g.salas[r.Sala]; s == nil || s.colegaNaReuniao(pessoaID) == nil {
			g.mu.Unlock()
			return ErrForaDaReuniao
		}
	}
	v := g.video
	g.mu.Unlock()
	if v == nil {
		return ErrSemServidor
	}
	if err := v.Encerrar(ctx, r.Sala); err != nil && !errors.Is(err, video.ErrNaoEncontrado) {
		return err
	}
	agora := g.relogio.Agora()
	g.mu.Lock()
	var acabar int64
	if s := g.salas[r.Sala]; s != nil {
		g.conhecer(s, r)
		acabar = g.terminar(s, porEncerrar, agora)
	} else if r.Tipo == banco.TipoNaHora {
		g.acabadas[r.Sala] = agora
		acabar = r.ID
	}
	g.mu.Unlock()
	g.acabarNoBanco(acabar)
	g.despachar()
	return nil
}

// Lista é o que o colega na reunião vê: quem está nela e os pedidos que esperam.
func (g *Gerente) Lista(r banco.Reuniao, pessoaID int64) (Lista, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	s := g.salas[r.Sala]
	if s == nil || s.colegaNaReuniao(pessoaID) == nil {
		return Lista{}, ErrForaDaReuniao
	}
	return s.retrato(), nil
}

// Tela dá ao colega na reunião a senha da tela compartilhada: a segunda ligação dele, com o mesmo participante.
// Ela não conta nas 10 pessoas.
func (g *Gerente) Tela(ctx context.Context, r banco.Reuniao, pessoaID int64) (string, error) {
	d := g.lerVideo()
	g.mu.Lock()
	defer g.mu.Unlock()
	s := g.salas[r.Sala]
	if s == nil {
		return "", ErrForaDaReuniao
	}
	p := s.colegaNaReuniao(pessoaID)
	if p == nil {
		return "", ErrForaDaReuniao
	}
	if !g.serve(d) {
		return "", ErrSemServidor
	}
	return emitir(d, s, p, true)
}

// Cancelada fica sabendo que a reunião foi cancelada no banco. Ela é encerrada no servidor de vídeo, quem está
// nela ou foi aceito sai (a página de cada um recebe o encerrada), quem espera recebe o linkInvalido, e a reunião
// sai da memória. Um erro do vídeo, fora o 404 (que vale como feito), vai ao log só com o código, e o resto
// acontece assim mesmo.
func (g *Gerente) Cancelada(ctx context.Context, r banco.Reuniao) {
	g.mu.Lock()
	g.acabadas[r.Sala] = g.relogio.Agora()
	v := g.video
	g.mu.Unlock()
	if v != nil {
		if err := v.Encerrar(ctx, r.Sala); err != nil && !errors.Is(err, video.ErrNaoEncontrado) {
			slog.Warn("reunioes: o servidor de vídeo não encerrou a reunião cancelada", "erro", codigoDoErro(err))
		}
	}
	agora := g.relogio.Agora()
	g.mu.Lock()
	if s := g.salas[r.Sala]; s != nil {
		g.conhecer(s, r)
		g.terminar(s, porCancelar, agora)
	}
	g.mu.Unlock()
	g.despachar()
}

// Contagem diz se a reunião está acontecendo (alguém com a câmera nela) e quantas pessoas estão nela, sem a tela.
func (g *Gerente) Contagem(sala string) (acontecendo bool, pessoas int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if s := g.salas[sala]; s != nil {
		pessoas = s.naReuniao()
	}
	return pessoas > 0, pessoas
}

// Resumo são as reuniões acontecendo e as pessoas nelas, em todo o servidor (o cartão "Reuniões").
func (g *Gerente) Resumo() (reunioes, pessoas int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, s := range g.salas {
		if n := s.naReuniao(); n > 0 {
			reunioes++
			pessoas += n
		}
	}
	return reunioes, pessoas
}
