// Package reunioes é o gerente das reuniões com link no chat (docs/chat-protocolo.md, seções 9 a 12): quem está
// em cada reunião, as senhas de uso único ainda não usadas, a sala de espera e os limites. Tudo fica na memória,
// sob um mutex só; os nomes de quem é de fora nunca vão ao banco e somem quando a reunião acaba.
//
// O gerente segue os eventos do servidor de vídeo (docs/video-agente.md, seção 5). Ele nunca chama o servidor de
// vídeo, nem avisa um app ou uma página, com o mutex travado: os avisos e as mensagens entram numa fila, na ordem
// em que o estado mudou, e saem depois dele.
package reunioes

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
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
	// ErrEsperaCheia: a sala de espera da reunião já tem 50 pedidos esperando.
	ErrEsperaCheia = errors.New("reunioes: a sala de espera está cheia")
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
		v.Acompanhar(ctx, func(ev video.Evento) { g.evento(ctx, ev, geracao) })
	}()
}

// Video é o servidor de vídeo ligado (nil: nenhum).
func (g *Gerente) Video() Video {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.video
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
// de fora recebe o tirado e fecha, e a senha nova não a deixa voltar. Uma senha que o participante já tinha, e que
// ainda vale no agente, também não: o entrou dela é o de um participante que a sala não conhece (o ligacao).
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
