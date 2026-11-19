package admin

// A página "Reuniões" da administração (docs/video-servidor.md, passo 3): o servidor de vídeo (o endereço e a chave),
// o teste dele, o limite de reuniões ao mesmo tempo, as empresas com as reuniões liberadas e a reunião de teste, e
// o cartão "Reuniões" da lista das empresas. A página nunca mostra quem está numa reunião: só as contagens, o uso do
// servidor de vídeo e o link da reunião de teste.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/reunioes"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// Os textos da página das reuniões.
const (
	textoNaoConfigurado = "O servidor de vídeo ainda não foi configurado."
	textoEndereco       = "Escreva só o endereço do servidor de vídeo (e a porta, se tiver), sem https://."
	textoChave          = "A chave tem 43 caracteres. Copie de novo a chave mostrada na instalação."
	textoLimite         = "O número de reuniões ao mesmo tempo vai de 1 a 20."
	textoChaveRecusada  = "A chave não confere. Copie de novo a chave mostrada na instalação."
	textoSemResposta    = "O servidor de vídeo não respondeu. Confira o endereço e se a porta dele está aberta (a 443, ou a que vem depois do endereço)."
	textoFreeSwitchFora = "O servidor de vídeo respondeu, mas o FreeSWITCH está fora do ar. Veja os registros na VM de vídeo."
)

const (
	validadeDoTeste = 2 * time.Hour    // a reunião de teste vale por 2 horas
	esperaNoAr      = 3 * time.Second  // o quanto o "Guardar e testar" espera a conexão dos eventos abrir
	prazoCancelar   = 10 * time.Second // o encerrar das reuniões que acabam aqui, como o cancelar da API
	desvioDoRelogio = 5 * time.Second  // a partir daqui, o teste avisa do relógio
	limiteMinimo    = 1                // de reuniões ao mesmo tempo (a regra do banco)
	limiteMaximo    = 20
)

// linhaResultado é uma linha do resultado do teste do servidor de vídeo.
type linhaResultado struct{ Classe, Texto string }

type linhaEmpresaReunioes struct {
	Nome, Acao, Liberar, Botao string
	Liberadas                  bool
}

type testeVista struct{ Link, ValeAte string }

type telaReunioes struct {
	Endereco     string
	EnderecoDado bool // o Endereco é o que a pessoa escreveu (num formulário que não valeu), e não o guardado
	TemChave     bool
	ErroServidor string
	Resultado    []linhaResultado

	Limite     string
	LimiteDado bool
	ErroLimite string

	Agora    string // "<n> reuniões acontecendo · <n> pessoas"
	Servidor string // "Servidor de vídeo: <endereço> · respondendo", ou o texto de que não foi configurado
	Empresas []linhaEmpresaReunioes
	Teste    *testeVista
}

// cartaoReunioes é o cartão "REUNIÕES" da lista das empresas.
type cartaoReunioes struct {
	Servidor string
	Agora    string
}

// contagem escreve as reuniões acontecendo e as pessoas nelas.
func contagem(reunioes, pessoas int) string {
	return fmt.Sprintf("%d %s acontecendo · %d %s", reunioes, plural(reunioes, "reunião", "reuniões"),
		pessoas, plural(pessoas, "pessoa", "pessoas"))
}

// situacao diz do servidor de vídeo guardado: o endereço e se ele responde (o gerente tem a conexão dos eventos
// aberta e o FreeSWITCH no ar). Sem endereço guardado, ele não foi configurado.
func (p *painel) situacao(cfg banco.ConfigReunioes) (endereco string, configurado, noAr bool) {
	if cfg.Endereco == "" || cfg.Chave == "" {
		return "", false, false
	}
	v := p.gerente.Video()
	return cfg.Endereco, true, v != nil && v.NoAr()
}

func respondendo(noAr bool) string {
	if noAr {
		return "respondendo"
	}
	return "sem resposta"
}

// cartaoDasReunioes monta o cartão da lista das empresas.
func (p *painel) cartaoDasReunioes(ctx context.Context) (cartaoReunioes, error) {
	cfg, err := p.banco.ConfigReunioes(ctx)
	if err != nil {
		return cartaoReunioes{}, err
	}
	c := cartaoReunioes{}
	c.Agora = contagem(p.gerente.Resumo())
	if endereco, ok, noAr := p.situacao(cfg); ok {
		c.Servidor = endereco + " · " + respondendo(noAr)
	} else {
		c.Servidor = textoNaoConfigurado
	}
	return c, nil
}

// preencher completa a tela com o que vem do banco e do gerente: o que o formulário não deu, as contagens, as
// empresas e a reunião de teste.
func (p *painel) preencher(ctx context.Context, t *telaReunioes) error {
	cfg, err := p.banco.ConfigReunioes(ctx)
	if err != nil {
		return err
	}
	if !t.EnderecoDado {
		t.Endereco = cfg.Endereco
	}
	t.TemChave = cfg.Chave != ""
	if !t.LimiteDado {
		t.Limite = strconv.Itoa(cfg.Limite)
	}
	t.Agora = contagem(p.gerente.Resumo())
	if endereco, ok, noAr := p.situacao(cfg); ok {
		t.Servidor = "Servidor de vídeo: " + endereco + " · " + respondendo(noAr)
	} else {
		t.Servidor = textoNaoConfigurado
	}
	lista, err := p.banco.Empresas(ctx)
	if err != nil {
		return err
	}
	for _, e := range lista {
		l := linhaEmpresaReunioes{Nome: e.Nome, Liberadas: e.Reunioes, Acao: fmt.Sprintf("/admin/reunioes/empresas/%d", e.ID),
			Liberar: "1", Botao: "Liberar"}
		if e.Reunioes {
			l.Liberar, l.Botao = "0", "Bloquear"
		}
		t.Empresas = append(t.Empresas, l)
	}
	teste, err := p.banco.ReuniaoDeTeste(ctx)
	switch {
	case err == nil:
		t.Teste = &testeVista{Link: p.base + "/r/" + teste.Codigo,
			ValeAte: time.UnixMilli(teste.ValeAte).In(tempo.Fuso()).Format("15:04")}
	case !errors.Is(err, banco.ErrNaoEncontrado):
		return err
	}
	return nil
}

// mostrarReunioes completa a tela e a mostra; um erro ao completar vira a página de erro.
func (p *painel) mostrarReunioes(w http.ResponseWriter, r *http.Request, s sessao, status int, t telaReunioes) {
	if err := p.preencher(r.Context(), &t); err != nil {
		p.erroServidor(w, s, err)
		return
	}
	p.mostrarComSessao(w, s, status, "reunioes", "reuniões", t)
}

// GET /admin/reunioes
func (p *painel) paginaReunioes(w http.ResponseWriter, r *http.Request, s sessao) {
	p.mostrarReunioes(w, r, s, http.StatusOK, telaReunioes{})
}

// testarVideo pergunta o estado ao servidor de vídeo e conta o que se vê: a versão e o uso, o aviso do relógio, ou
// o motivo de não estar no ar. O relógio do agente é comparado com o do chat (o que o banco usa), não com o do
// sistema.
func (p *painel) testarVideo(ctx context.Context, v reunioes.Video) []linhaResultado {
	e, err := v.Estado(ctx)
	switch {
	case errors.Is(err, video.ErrChave):
		return []linhaResultado{{"erro", textoChaveRecusada}}
	case err != nil:
		return []linhaResultado{{"erro", textoSemResposta}}
	case !e.FreeSWITCH:
		return []linhaResultado{{"erro", textoFreeSwitchFora}}
	}
	linhas := []linhaResultado{
		{"resultado-ok", fmt.Sprintf("O servidor de vídeo respondeu: versão %s, FreeSWITCH no ar.", e.Versao)},
		{"resultado-ok", fmt.Sprintf("Uso agora: CPU %d%% · memória %d%%.", e.Uso.CPU, e.Uso.Memoria)},
	}
	if d := time.UnixMilli(e.Agora).Sub(p.banco.Relogio().Agora()); d >= desvioDoRelogio || d <= -desvioDoRelogio {
		lado := "adiantado"
		if d < 0 {
			lado = "atrasado"
		}
		linhas = append(linhas, linhaResultado{"resultado-aviso", fmt.Sprintf(
			"O relógio do servidor de vídeo está %d s %s em relação ao do chat. As reuniões funcionam assim mesmo, mas ligue o horário automático nas duas VMs.",
			int(math.Round(math.Abs(d.Seconds()))), lado)})
	}
	return linhas
}

// POST /admin/reunioes/servidor: confere o endereço e a chave, guarda, liga o gerente ao servidor novo e testa. A
// chave em branco mantém a guardada. Com o formulário que não vale, nada é guardado nem ligado. O servidor fica
// guardado e ligado mesmo que o teste ache um problema: o resultado diz qual.
func (p *painel) guardarServidor(w http.ResponseWriter, r *http.Request, s sessao) {
	endereco := strings.TrimSpace(r.PostForm.Get("endereco"))
	chave := strings.TrimSpace(r.PostForm.Get("chave"))
	recusar := func(texto string) {
		p.mostrarReunioes(w, r, s, http.StatusBadRequest, telaReunioes{Endereco: endereco, EnderecoDado: true, ErroServidor: texto})
	}
	if err := video.ValidarEndereco(endereco, p.teste); err != nil {
		recusar(textoEndereco)
		return
	}
	if chave == "" {
		cfg, err := p.banco.ConfigReunioes(r.Context())
		if err != nil {
			p.erroServidor(w, s, err)
			return
		}
		chave = cfg.Chave
	}
	cliente, err := video.NovoCliente(endereco, chave, p.teste)
	if err != nil {
		recusar(textoChave)
		return
	}
	if err := p.banco.GuardarServidorVideo(r.Context(), endereco, chave); err != nil {
		p.erroServidor(w, s, err)
		return
	}
	p.gerente.Ligar(cliente)
	slog.Info("admin: servidor de vídeo guardado", "usuario", s.Usuario)
	resultado := p.testarVideo(r.Context(), cliente)
	if len(resultado) > 0 && resultado[0].Classe == "resultado-ok" {
		esperarNoAr(r.Context(), cliente)
	}
	p.mostrarReunioes(w, r, s, http.StatusOK, telaReunioes{Resultado: resultado})
}

// esperarNoAr dá ao cliente recém-ligado um instante para abrir a conexão dos eventos, que é o que o cartão "AGORA"
// chama de "respondendo": sem isso, a página diria "sem resposta" logo abaixo de "O servidor de vídeo respondeu".
func esperarNoAr(ctx context.Context, v reunioes.Video) {
	fim := time.NewTimer(esperaNoAr)
	defer fim.Stop()
	tique := time.NewTicker(25 * time.Millisecond)
	defer tique.Stop()
	for !v.NoAr() {
		select {
		case <-ctx.Done():
			return
		case <-fim.C:
			return
		case <-tique.C:
		}
	}
}

// POST /admin/reunioes/testar: testa o servidor de vídeo que o gerente usa.
func (p *painel) testarServidor(w http.ResponseWriter, r *http.Request, s sessao) {
	cfg, err := p.banco.ConfigReunioes(r.Context())
	if err != nil {
		p.erroServidor(w, s, err)
		return
	}
	v := p.gerente.Video()
	if _, ok, _ := p.situacao(cfg); !ok || v == nil {
		p.mostrarReunioes(w, r, s, http.StatusOK, telaReunioes{Resultado: []linhaResultado{{"erro", textoNaoConfigurado}}})
		return
	}
	p.mostrarReunioes(w, r, s, http.StatusOK, telaReunioes{Resultado: p.testarVideo(r.Context(), v)})
}

// POST /admin/reunioes/limite: guarda quantas reuniões podem acontecer ao mesmo tempo, de 1 a 20. O gerente lê o
// número do banco a cada entrada: não reinicia nada.
func (p *painel) guardarLimite(w http.ResponseWriter, r *http.Request, s sessao) {
	texto := strings.TrimSpace(r.PostForm.Get("limite"))
	n, err := strconv.Atoi(texto)
	if err != nil || n < limiteMinimo || n > limiteMaximo {
		p.mostrarReunioes(w, r, s, http.StatusBadRequest, telaReunioes{Limite: texto, LimiteDado: true, ErroLimite: textoLimite})
		return
	}
	if err := p.banco.GuardarLimiteReunioes(r.Context(), n); err != nil {
		p.erroServidor(w, s, err)
		return
	}
	slog.Info("admin: limite de reuniões guardado", "usuario", s.Usuario, "limite", n)
	http.Redirect(w, r, "/admin/reunioes", http.StatusSeeOther)
}

// encerrarDaEmpresa acaba, pelo gerente, as reuniões da empresa que perdeu as reuniões (o Bloquear, ou o Apagar a
// empresa) e que estão na memória: o agente recebe o encerrar de cada sala, e a página de quem está nelas, o
// encerrada. As reuniões foram lidas do banco antes da mudança. Usa um contexto que não é o do pedido, com o prazo do
// cancelar da API para todas. Devolve quantas acabaram.
func (p *painel) encerrarDaEmpresa(r *http.Request, rs []banco.Reuniao) int {
	if len(rs) == 0 {
		return 0
	}
	ctx, cancelar := context.WithTimeout(context.WithoutCancel(r.Context()), prazoCancelar)
	defer cancelar()
	return p.gerente.Bloqueadas(ctx, rs)
}

// POST /admin/reunioes/empresas/{id}: libera (liberar=1) ou bloqueia (liberar=0) as reuniões da empresa. As
// reuniões abertas dela são lidas antes da mudança. Depois do bloqueio, as que estão acontecendo acabam; depois da
// liberação, todas saem da memória do fim, onde o bloqueio as pôs, e a entrada nelas vale de novo na hora.
func (p *painel) liberarEmpresa(w http.ResponseWriter, r *http.Request, s sessao) {
	id, ok := idDe(r, "id")
	if !ok {
		p.naoEncontrada(w, r, s)
		return
	}
	var liberar bool
	switch r.PostForm.Get("liberar") {
	case "1":
		liberar = true
	case "0":
	default:
		p.erro(w, s, http.StatusBadRequest, "Pedido inválido", "O pedido não diz se é para liberar ou bloquear. Volte e tente de novo.")
		return
	}
	daEmpresa, err := p.banco.ReunioesDaEmpresa(r.Context(), id)
	if err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	if err := p.banco.LiberarReunioes(r.Context(), id, liberar); err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	encerradas := 0
	if liberar {
		p.gerente.Liberadas(daEmpresa)
	} else {
		encerradas = p.encerrarDaEmpresa(r, daEmpresa)
	}
	slog.Info("admin: reuniões da empresa", "usuario", s.Usuario, "empresa", id, "liberadas", liberar,
		"encerradas", encerradas)
	http.Redirect(w, r, "/admin/reunioes", http.StatusSeeOther)
}

// POST /admin/reunioes/teste: cria a reunião de teste, que vale por 2 horas e substitui a anterior. A anterior
// também acaba no servidor de vídeo: quem ainda estava nela sai. Isso usa um contexto que não é o do pedido, com o
// prazo do cancelar da API.
func (p *painel) criarTeste(w http.ResponseWriter, r *http.Request, s sessao) {
	velha, err := p.banco.ReuniaoDeTeste(r.Context())
	if err != nil && !errors.Is(err, banco.ErrNaoEncontrado) {
		p.erroServidor(w, s, err)
		return
	}
	temVelha := err == nil
	valeAte := p.banco.Relogio().Agora().Add(validadeDoTeste).UnixMilli()
	if _, err := p.banco.CriarReuniaoDeTeste(r.Context(), valeAte); err != nil {
		p.erroServidor(w, s, err)
		return
	}
	if temVelha {
		ctx, cancelar := context.WithTimeout(context.WithoutCancel(r.Context()), prazoCancelar)
		defer cancelar()
		p.gerente.Cancelada(ctx, velha)
	}
	slog.Info("admin: reunião de teste criada", "usuario", s.Usuario)
	http.Redirect(w, r, "/admin/reunioes", http.StatusSeeOther)
}
