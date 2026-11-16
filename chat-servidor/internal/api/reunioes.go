package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/reunioes"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// As reuniões do app (docs/chat-protocolo.md, seção 9).

const (
	maxAberturas     = 20          // tentativas de abrir uma reunião por endereço, por minuto (seção 12)
	periodoAberturas = time.Minute // o período da janela aberturas
	maxRamaisAgora   = 9           // os ramais do "Gerar link"
	// validadeMaxima é o quanto o valeAte pode passar do inicio.
	validadeMaxima = 31 * 24 * time.Hour
	// maxInicio é o último inicio aceito (o fim do ano 9999, em ms): só para a conta do dia não estourar.
	maxInicio = 253402300799999
	// prazoCancelar é o tempo que o gerente tem, no cancelar, para encerrar a reunião no servidor de vídeo: o
	// pedido não o corta se o cliente desligar.
	prazoCancelar = 10 * time.Second
)

// rotasDasReunioes liga as rotas da seção 9. Todas pedem a chave e a pessoa da vez; menos o entrar, todas pedem
// também que a empresa tenha as reuniões liberadas (403 semReunioes). O entrar confere isso depois da janela das
// tentativas, que ele conta.
func (s *servidor) rotasDasReunioes(mux *http.ServeMux) {
	liberada := func(f http.HandlerFunc) http.HandlerFunc {
		return s.autenticar(precisaPessoa(s.comReunioes(f)))
	}
	mux.HandleFunc("POST /api/v1/reunioes", liberada(s.criarReuniao))
	mux.HandleFunc("GET /api/v1/reunioes", liberada(s.minhasReunioes))
	mux.HandleFunc("POST /api/v1/reunioes/agora", liberada(s.reuniaoAgora))
	mux.HandleFunc("DELETE /api/v1/reunioes/{codigo}", liberada(s.cancelarReuniao))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/entrar", s.autenticar(precisaPessoa(s.entrarNaReuniao)))
	mux.HandleFunc("GET /api/v1/reunioes/{codigo}/participantes", liberada(s.participantesDaReuniao))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/aceitar", liberada(s.aceitarPedido))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/recusar", liberada(s.recusarPedido))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/tirar", liberada(s.tirarDaReuniao))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/encerrar", liberada(s.encerrarReuniao))
	mux.HandleFunc("POST /api/v1/reunioes/{codigo}/tela", liberada(s.telaDaReuniao))
}

// comReunioes protege uma rota que só vale para a empresa com as reuniões liberadas: sem elas, 403 semReunioes.
// A empresa vem do banco a cada pedido (o autenticar a lê), então a liberação vale na hora. Vai dentro do
// autenticar.
func (s *servidor) comReunioes(f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, e := computadorDe(r); !e.Reunioes {
			escreverErro(w, http.StatusForbidden, "semReunioes", nil)
			return
		}
		f(w, r)
	}
}

// ---------- Os erros ----------

// erroDaReuniao responde o erro do gerente ou do banco com o status e o código do protocolo. Os que não são de
// nenhum deles dão 500. Com doVideo, o erro do agente que não é do gerente (o video.ErrSemResposta e o
// video.ErrChave, pelo Tirar e pelo Encerrar) dá 503 servidorVideo.
func erroDaReuniao(w http.ResponseWriter, err error, doVideo bool) {
	switch {
	case errors.Is(err, reunioes.ErrLinkInvalido), errors.Is(err, banco.ErrNaoEncontrado),
		errors.Is(err, reunioes.ErrPedidoNaoEncontrado), errors.Is(err, reunioes.ErrParticipanteNaoEncontrado):
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
	case errors.Is(err, reunioes.ErrCheia):
		escreverErro(w, http.StatusConflict, "cheia", nil)
	case errors.Is(err, reunioes.ErrServidorCheio):
		escreverErro(w, http.StatusConflict, "servidorCheio", nil)
	case errors.Is(err, reunioes.ErrSemServidor):
		escreverErro(w, http.StatusServiceUnavailable, "servidorVideo", nil)
	case errors.Is(err, reunioes.ErrJaRespondido):
		escreverErro(w, http.StatusConflict, "jaRespondido", nil)
	case errors.Is(err, reunioes.ErrForaDaReuniao):
		escreverErro(w, http.StatusConflict, "foraDaReuniao", nil)
	case errors.Is(err, banco.ErrMuitasReunioes):
		escreverErro(w, http.StatusConflict, "muitasReunioes", nil)
	case errors.Is(err, banco.ErrProibido):
		escreverErro(w, http.StatusForbidden, "proibido", nil)
	case doVideo && !errors.Is(err, context.Canceled):
		// Só o código no log: nunca o texto do erro, que pode ter o endereço do servidor de vídeo.
		slog.Warn("reunioes: o servidor de vídeo falhou", "erro", codigoDoVideo(err))
		escreverErro(w, http.StatusServiceUnavailable, "servidorVideo", nil)
	default:
		erroServidor(w, err)
	}
}

// codigoDoVideo é o código de uma falha do agente, para o log.
func codigoDoVideo(err error) string {
	switch {
	case errors.Is(err, video.ErrSemResposta):
		return "semResposta"
	case errors.Is(err, video.ErrChave):
		return "chave"
	case errors.Is(err, context.DeadlineExceeded):
		return "prazo"
	default:
		return "outro"
	}
}

// ---------- Apoios ----------

// lerJSONOpcional é o lerJSON de um corpo que pode faltar: sem corpo (ou só espaços), não lê nada e vale.
func lerJSONOpcional(w http.ResponseWriter, r *http.Request, destino any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limiteJSON)
	dados, err := io.ReadAll(r.Body)
	if err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			escreverErro(w, http.StatusRequestEntityTooLarge, "grande", nil)
		} else {
			escreverErro(w, http.StatusBadRequest, "invalido", nil)
		}
		return false
	}
	if len(bytes.TrimSpace(dados)) == 0 {
		return true
	}
	r.Body = io.NopCloser(bytes.NewReader(dados))
	return lerJSON(w, r, destino)
}

// fimDoDia é 23:59:59,999 do dia do inicio (em ms UTC), no horário de Brasília.
func fimDoDia(inicio int64) int64 {
	fuso := tempo.Fuso()
	t := time.UnixMilli(inicio).In(fuso)
	return time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, fuso).UnixMilli() - 1
}

// reuniaoDaEmpresa acha a reunião do {codigo} do caminho, para as rotas que não são o entrar. Um código mal
// formado, que não existe ou que é de outra empresa dá 404 naoEncontrado, e devolve false.
func (s *servidor) reuniaoDaEmpresa(w http.ResponseWriter, r *http.Request) (banco.Reuniao, bool) {
	c, _ := computadorDe(r)
	codigo, ok := segredo.NormalizarCodigoReuniao(r.PathValue("codigo"))
	if !ok {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
		return banco.Reuniao{}, false
	}
	reuniao, err := s.banco.ReuniaoPorCodigo(r.Context(), codigo)
	if err == nil && reuniao.EmpresaID != c.EmpresaID {
		err = banco.ErrNaoEncontrado
	}
	if err != nil {
		erroDaReuniao(w, err, false)
		return banco.Reuniao{}, false
	}
	return reuniao, true
}

func (s *servidor) agoraMs() int64 { return s.banco.Relogio().Agora().UnixMilli() }

// ---------- Criar, listar, cancelar, gerar link ----------

// POST /api/v1/reunioes: cria uma reunião marcada. A empresa e quem criou são a empresa e a pessoa do
// computador, nunca do corpo: o banco não confere isso.
func (s *servidor) criarReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	var corpo struct {
		Assunto *string `json:"assunto"`
		Inicio  *int64  `json:"inicio"`
		ValeAte *int64  `json:"valeAte"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	assunto := ""
	if corpo.Assunto != nil {
		var err error
		if assunto, err = regras.Assunto(*corpo.Assunto); err != nil {
			erroCampo(w, "assunto")
			return
		}
	}
	if corpo.Inicio == nil || *corpo.Inicio < 1 || *corpo.Inicio > maxInicio {
		erroCampo(w, "inicio")
		return
	}
	inicio, agora := *corpo.Inicio, s.agoraMs()
	var valeAte int64
	if corpo.ValeAte == nil {
		// O dia do inicio já acabou: o campo é o que a pessoa mandou.
		if valeAte = fimDoDia(inicio); valeAte <= agora {
			erroCampo(w, "inicio")
			return
		}
	} else {
		valeAte = *corpo.ValeAte
		if valeAte <= inicio || valeAte <= agora || valeAte > inicio+validadeMaxima.Milliseconds() {
			erroCampo(w, "valeAte")
			return
		}
	}
	reuniao, err := s.banco.CriarReuniao(r.Context(), banco.Reuniao{EmpresaID: c.EmpresaID, Tipo: banco.TipoMarcada,
		Assunto: assunto, Inicio: inicio, ValeAte: valeAte, CriouID: c.PessoaID})
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	escreverJSON(w, http.StatusCreated, map[string]any{"reuniao": novaReuniaoJSON(reuniao, s.base, c.PessoaID, s.gerente)})
}

// GET /api/v1/reunioes: as marcadas da pessoa que ainda valem, pelo inicio.
func (s *servidor) minhasReunioes(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	lista, err := s.banco.ReunioesMarcadas(r.Context(), c.EmpresaID, c.PessoaID)
	if err != nil {
		erroServidor(w, err)
		return
	}
	reunioesJSON := make([]reuniaoJSON, 0, len(lista))
	for _, reuniao := range lista {
		reunioesJSON = append(reunioesJSON, novaReuniaoJSON(reuniao, s.base, c.PessoaID, s.gerente))
	}
	escreverJSON(w, http.StatusOK, map[string]any{"reunioes": reunioesJSON})
}

// DELETE /api/v1/reunioes/{codigo}: quem criou cancela. O banco cancela primeiro, para ninguém novo entrar; depois
// o gerente encerra a reunião no servidor de vídeo e avisa quem está nela, com um contexto que não é o do pedido.
func (s *servidor) cancelarReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	codigo, ok := segredo.NormalizarCodigoReuniao(r.PathValue("codigo"))
	if !ok {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
		return
	}
	reuniao, err := s.banco.CancelarReuniao(r.Context(), c.EmpresaID, c.PessoaID, codigo)
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	ctx, cancelar := context.WithTimeout(context.WithoutCancel(r.Context()), prazoCancelar)
	defer cancelar()
	s.gerente.Cancelada(ctx, reuniao)
	w.WriteHeader(http.StatusNoContent)
}

// eventoReuniaoAgora é o reuniaoAgora (seção 11): o "Gerar link" de um colega.
type eventoReuniaoAgora struct {
	Tipo    string      `json:"tipo"`
	Reuniao reuniaoJSON `json:"reuniao"`
	De      pessoaJSON  `json:"de"`
}

// POST /api/v1/reunioes/agora: cria a reunião naHora e avisa os colegas dos ramais, que estão na chamada. Um ramal
// que não é de ninguém é ignorado; quem convida não recebe o próprio convite.
func (s *servidor) reuniaoAgora(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	var corpo struct {
		Ramais []string `json:"ramais"`
	}
	if !lerJSONOpcional(w, r, &corpo) {
		return
	}
	if len(corpo.Ramais) > maxRamaisAgora {
		erroCampo(w, "ramais")
		return
	}
	ramais := make(map[string]bool, len(corpo.Ramais))
	for _, ramal := range corpo.Ramais {
		ramal, err := regras.Ramal(ramal)
		if err != nil {
			erroCampo(w, "ramais")
			return
		}
		ramais[ramal] = true
	}

	// Quem convida e quem é convidado, antes de criar a reunião: se o banco falhar, nada fica criado.
	de, err := s.banco.PessoaPorID(r.Context(), c.EmpresaID, c.PessoaID)
	if err != nil {
		erroDaPessoaDaVez(w, err)
		return
	}
	var convidados []int64
	if len(ramais) > 0 {
		colegas, err := s.banco.Colegas(r.Context(), c.EmpresaID, c.PessoaID)
		if err != nil {
			erroServidor(w, err)
			return
		}
		for _, p := range colegas {
			if ramais[p.Ramal] {
				convidados = append(convidados, p.ID)
			}
		}
	}

	reuniao, err := s.banco.CriarReuniao(r.Context(), banco.Reuniao{EmpresaID: c.EmpresaID, Tipo: banco.TipoNaHora,
		CriouID: c.PessoaID})
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	if len(convidados) > 0 {
		// Para quem recebe, a reunião não é dele: o criouEu é falso.
		s.hub.ParaPessoas(convidados, eventoReuniaoAgora{Tipo: "reuniaoAgora",
			Reuniao: novaReuniaoJSON(reuniao, s.base, 0, s.gerente), De: novaPessoaJSON(de)})
	}
	escreverJSON(w, http.StatusCreated, map[string]any{"reuniao": novaReuniaoJSON(reuniao, s.base, c.PessoaID, s.gerente)})
}

// erroDaPessoaDaVez responde quando a pessoa do computador não está mais na empresa: o computador saiu do chat
// entre a conferência da chave e agora (401 chave, como no POST /pessoas/eu).
func erroDaPessoaDaVez(w http.ResponseWriter, err error) {
	if errors.Is(err, banco.ErrNaoEncontrado) {
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return
	}
	erroServidor(w, err)
}

// ---------- Entrar ----------

// acessoJSON é o Acesso com a reuniao (seção 9).
type acessoJSON struct {
	reunioes.Acesso
	Reuniao reuniaoJSON `json:"reuniao"`
}

// POST /api/v1/reunioes/{codigo}/entrar: um colega da mesma empresa entra direto. A ordem das conferências:
//  1. a janela das tentativas (sem contar): cheia, é 429 tentativas, até com o código certo;
//  2. a empresa tem as reuniões liberadas (403 semReunioes);
//  3. o código existe (404);
//  4. a reunião é da empresa (403 outraEmpresa);
//  5. o gerente: o link vale (404), o vídeo está no ar (503), a reunião cabe mais uma pessoa (409 cheia) e,
//     parada, cabe no limite de reuniões ao mesmo tempo (409 servidorCheio).
//
// Conta na janela só o que não deu em reunião em que a pessoa pudesse entrar: o 404, o outraEmpresa e o
// semReunioes. Quem entra, e a reunião cheia, o servidor cheio e o vídeo fora do ar de um código bom, não contam:
// um escritório atrás de um endereço só entra de uma vez na hora marcada.
func (s *servidor) entrarNaReuniao(w http.ResponseWriter, r *http.Request) {
	c, e := computadorDe(r)
	endereco := limites.Endereco(r)
	if ok, esperar := s.aberturas.Cabe(endereco, 1); !ok {
		erroEspera(w, "tentativas", esperar)
		return
	}
	errada := func(status int, codigo string) {
		s.aberturas.Contar(endereco, 1)
		escreverErro(w, status, codigo, nil)
	}
	if !e.Reunioes {
		errada(http.StatusForbidden, "semReunioes")
		return
	}
	codigo, ok := segredo.NormalizarCodigoReuniao(r.PathValue("codigo"))
	if !ok {
		errada(http.StatusNotFound, "naoEncontrado")
		return
	}
	reuniao, err := s.banco.ReuniaoPorCodigo(r.Context(), codigo)
	if errors.Is(err, banco.ErrNaoEncontrado) {
		errada(http.StatusNotFound, "naoEncontrado")
		return
	}
	if err != nil {
		erroServidor(w, err)
		return
	}
	if reuniao.EmpresaID != c.EmpresaID {
		errada(http.StatusForbidden, "outraEmpresa")
		return
	}
	pessoa, err := s.banco.PessoaPorID(r.Context(), c.EmpresaID, c.PessoaID)
	if err != nil {
		erroDaPessoaDaVez(w, err)
		return
	}
	acesso, err := s.gerente.EntrarColega(r.Context(), reuniao, pessoa, c.ID)
	if errors.Is(err, reunioes.ErrLinkInvalido) {
		errada(http.StatusNotFound, "naoEncontrado")
		return
	}
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	escreverJSON(w, http.StatusOK, acessoJSON{Acesso: acesso, Reuniao: novaReuniaoJSON(reuniao, s.base, c.PessoaID, s.gerente)})
}

// ---------- Com a pessoa na reunião ----------

// GET /api/v1/reunioes/{codigo}/participantes: quem está na reunião e os pedidos que esperam.
func (s *servidor) participantesDaReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	lista, err := s.gerente.Lista(reuniao, c.PessoaID)
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	escreverJSON(w, http.StatusOK, lista)
}

// pedidoDoCorpo lê o {"pedido": "<id>"} do aceitar e do recusar.
func pedidoDoCorpo(w http.ResponseWriter, r *http.Request) (string, bool) {
	var corpo struct {
		Pedido string `json:"pedido"`
	}
	if !lerJSON(w, r, &corpo) {
		return "", false
	}
	if corpo.Pedido == "" {
		erroCampo(w, "pedido")
		return "", false
	}
	return corpo.Pedido, true
}

// POST /api/v1/reunioes/{codigo}/aceitar: o pedido de quem é de fora entra na reunião.
func (s *servidor) aceitarPedido(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	pedido, ok := pedidoDoCorpo(w, r)
	if !ok {
		return
	}
	if err := s.gerente.Aceitar(r.Context(), reuniao, c.PessoaID, pedido); err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/reunioes/{codigo}/recusar: o pedido de quem é de fora é recusado.
func (s *servidor) recusarPedido(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	pedido, ok := pedidoDoCorpo(w, r)
	if !ok {
		return
	}
	if err := s.gerente.Recusar(r.Context(), reuniao, c.PessoaID, pedido); err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/reunioes/{codigo}/tirar: o participante sai da reunião, com a câmera e com a tela.
func (s *servidor) tirarDaReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	var corpo struct {
		Participante string `json:"participante"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if corpo.Participante == "" {
		erroCampo(w, "participante")
		return
	}
	if err := s.gerente.Tirar(r.Context(), reuniao, c.PessoaID, corpo.Participante); err != nil {
		erroDaReuniao(w, err, true)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/reunioes/{codigo}/encerrar: a reunião acaba para todos.
func (s *servidor) encerrarReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	if err := s.gerente.Encerrar(r.Context(), reuniao, c.PessoaID); err != nil {
		erroDaReuniao(w, err, true)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/reunioes/{codigo}/tela: a senha da ligação da tela compartilhada.
func (s *servidor) telaDaReuniao(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	reuniao, ok := s.reuniaoDaEmpresa(w, r)
	if !ok {
		return
	}
	senha, err := s.gerente.Tela(r.Context(), reuniao, c.PessoaID)
	if err != nil {
		erroDaReuniao(w, err, false)
		return
	}
	escreverJSON(w, http.StatusOK, map[string]string{"senha": senha})
}
