// Package salas guarda as reuniões que existem no FreeSWITCH: quem está em cada sala, montado pelos eventos das
// conferências, e manda ao FreeSWITCH o que o agente decide (os layouts, tirar e encerrar). O contrato é a
// seção 5 do docs/video-agente.md.
//
// Um mutex guarda o estado, e nenhum comando ao FreeSWITCH nem aviso sai com ele preso.
package salas

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
)

var (
	// ErrNaoEncontrado: a sala ou o participante não estão no estado.
	ErrNaoEncontrado = errors.New("salas: não encontrado")
	// ErrSemFreeSWITCH: o agente está sem a ligação com o FreeSWITCH (o ESL).
	ErrSemFreeSWITCH = errors.New("salas: sem ligação com o FreeSWITCH")
)

// API é o que as salas pedem ao ESL.
type API interface {
	API(ctx context.Context, comando string) (string, error)
}

// Aviso é uma mudança nas salas. O Tipo é "entrou", "saiu" ou "acabou" (o acabou só leva a Sala).
type Aviso struct {
	Tipo         string
	Sala         string
	Participante string
	Tela         bool
}

// Participante é uma ligação da sala: a da câmera, com Tela falso, ou a da tela compartilhada.
type Participante struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
}

// Sala é uma reunião no FreeSWITCH, como na seção 5 do contrato.
type Sala struct {
	Sala          string         `json:"sala"`
	Participantes []Participante `json:"participantes"`
}

const (
	layoutTela = "starsonic-apresentacao"
	grupoGrade = "starsonic-grade"
)

type ligacao struct {
	participante string
	tela         bool
}

// Salas é o estado das reuniões. O valor zero não serve: use Nova.
type Salas struct {
	avisar func(Aviso)

	mu    sync.Mutex
	api   API
	salas map[string]map[string]ligacao // sala -> uuid da ligação -> quem é

	// Enquanto um Reconstruir lê o FreeSWITCH, o que um evento tira do estado fica aqui, para a junção não
	// trazer de volta o que já acabou.
	reconstruindo int
	uuidsSaidos   map[string]map[string]bool // sala -> uuids que saíram
	salasAcabadas map[string]bool
}

// Nova cria as salas. O avisar recebe cada mudança, fora do mutex; pode ser nil.
func Nova(avisar func(Aviso)) *Salas {
	if avisar == nil {
		avisar = func(Aviso) {}
	}
	return &Salas{avisar: avisar, salas: map[string]map[string]ligacao{},
		uuidsSaidos: map[string]map[string]bool{}, salasAcabadas: map[string]bool{}}
}

// Ligar põe a API do ESL, ou nil quando o ESL cai.
func (s *Salas) Ligar(api API) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.api = api
}

func (s *Salas) apiAtual() API {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.api
}

func hexMinusculo(v string, tamanho int) bool {
	if len(v) != tamanho {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func salaValida(v string) bool         { return hexMinusculo(v, 32) }
func participanteValido(v string) bool { return hexMinusculo(v, 16) }

// uuidValido recusa o vazio e o que tem espaço ou caractere de controle: o uuid vai dentro de um comando.
func uuidValido(v string) bool {
	if v == "" || len(v) > 64 {
		return false
	}
	for i := 0; i < len(v); i++ {
		if v[i] <= ' ' || v[i] == 0x7f {
			return false
		}
	}
	return true
}

// Evento trata um evento conference::maintenance. O que não é de uma sala nossa (o nome com 32 hexadecimais) é
// ignorado. Os comandos que a mudança pede ao FreeSWITCH são de melhor esforço: o erro de um não desfaz o aviso.
func (s *Salas) Evento(ctx context.Context, ev esl.Evento) {
	if sub, ok := ev["Event-Subclass"]; ok && sub != "conference::maintenance" {
		return
	}
	sala := ev["Conference-Name"]
	if !salaValida(sala) {
		return
	}
	switch ev["Action"] {
	case "add-member":
		s.entrou(ctx, sala, ev)
	case "del-member":
		s.saiu(ctx, sala, ev["Unique-ID"])
	case "conference-destroy":
		s.acabou(sala)
	}
}

func (s *Salas) entrou(ctx context.Context, sala string, ev esl.Evento) {
	uuid := ev["Unique-ID"]
	participante := ev["variable_starsonic_participante"]
	if !uuidValido(uuid) || !participanteValido(participante) {
		return
	}
	tela := ev["variable_starsonic_tela"] == "true"

	s.mu.Lock()
	ligacoes := s.salas[sala]
	if ligacoes == nil {
		ligacoes = map[string]ligacao{}
		s.salas[sala] = ligacoes
	}
	if _, repetida := ligacoes[uuid]; repetida {
		s.mu.Unlock()
		return
	}
	var anteriores []string
	for u, l := range ligacoes {
		if l.tela {
			anteriores = append(anteriores, u)
		}
	}
	sort.Strings(anteriores)
	ligacoes[uuid] = ligacao{participante: participante, tela: tela}
	delete(s.uuidsSaidos[sala], uuid)
	api := s.api
	s.mu.Unlock()

	s.avisar(Aviso{Tipo: "entrou", Sala: sala, Participante: participante, Tela: tela})
	if !tela || api == nil {
		return
	}
	if len(anteriores) == 0 {
		api.API(ctx, "conference "+sala+" vid-layout "+layoutTela)
		return
	}
	// Uma tela nova toma o lugar da anterior.
	for _, u := range anteriores {
		api.API(ctx, "uuid_kill "+u)
	}
}

func (s *Salas) saiu(ctx context.Context, sala, uuid string) {
	s.mu.Lock()
	if s.reconstruindo > 0 {
		if s.uuidsSaidos[sala] == nil {
			s.uuidsSaidos[sala] = map[string]bool{}
		}
		s.uuidsSaidos[sala][uuid] = true
	}
	l, ok := s.salas[sala][uuid]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.salas[sala], uuid)
	restamTelas := false
	for _, outra := range s.salas[sala] {
		if outra.tela {
			restamTelas = true
			break
		}
	}
	api := s.api
	s.mu.Unlock()

	s.avisar(Aviso{Tipo: "saiu", Sala: sala, Participante: l.participante, Tela: l.tela})
	if l.tela && !restamTelas && api != nil {
		api.API(ctx, "conference "+sala+" vid-layout group "+grupoGrade)
	}
}

func (s *Salas) acabou(sala string) {
	s.mu.Lock()
	delete(s.salas, sala)
	if s.reconstruindo > 0 {
		s.salasAcabadas[sala] = true
	}
	s.mu.Unlock()
	s.avisar(Aviso{Tipo: "acabou", Sala: sala})
}

// Estado são as salas de agora, em ordem estável: as salas pelo nome e, em cada uma, as ligações pelo
// participante, com a câmera antes da tela. A lista nunca é nula.
func (s *Salas) Estado() []Sala {
	s.mu.Lock()
	defer s.mu.Unlock()
	nomes := make([]string, 0, len(s.salas))
	for nome := range s.salas {
		nomes = append(nomes, nome)
	}
	sort.Strings(nomes)
	saida := make([]Sala, 0, len(nomes))
	for _, nome := range nomes {
		ps := make([]Participante, 0, len(s.salas[nome]))
		for _, l := range s.salas[nome] {
			ps = append(ps, Participante{Participante: l.participante, Tela: l.tela})
		}
		sort.Slice(ps, func(i, j int) bool {
			if ps[i].Participante != ps[j].Participante {
				return ps[i].Participante < ps[j].Participante
			}
			return !ps[i].Tela && ps[j].Tela
		})
		saida = append(saida, Sala{Sala: nome, Participantes: ps})
	}
	return saida
}

// erroDoESL traduz o erro de um comando: o ESL caído é a falta da ligação.
func erroDoESL(err error) error {
	if errors.Is(err, esl.ErrDesligado) {
		return ErrSemFreeSWITCH
	}
	return err
}

// canalJaSumiu diz se o FreeSWITCH respondeu que a ligação não existe mais: ela já saiu, e o que se queria está feito.
func canalJaSumiu(err error) bool {
	var e *esl.ErroFS
	return errors.As(err, &e) && strings.Contains(strings.ToLower(e.Motivo), "no such channel")
}

// Tirar derruba as ligações do participante na sala, a da câmera e a da tela. O estado muda quando o
// FreeSWITCH avisa que cada uma saiu.
func (s *Salas) Tirar(ctx context.Context, sala, participante string) error {
	s.mu.Lock()
	api := s.api
	var uuids []string
	if api != nil {
		for u, l := range s.salas[sala] {
			if l.participante == participante {
				uuids = append(uuids, u)
			}
		}
	}
	s.mu.Unlock()
	if api == nil {
		return ErrSemFreeSWITCH
	}
	if len(uuids) == 0 {
		return ErrNaoEncontrado
	}
	sort.Strings(uuids)
	var primeiro error
	for _, u := range uuids {
		if _, err := api.API(ctx, "uuid_kill "+u); err != nil && !canalJaSumiu(err) && primeiro == nil {
			primeiro = erroDoESL(err)
		}
	}
	return primeiro
}

// Encerrar derruba todas as ligações da sala. Uma sala que não está no estado dá ErrNaoEncontrado, sem mandar
// nada.
func (s *Salas) Encerrar(ctx context.Context, sala string) error {
	s.mu.Lock()
	api := s.api
	_, existe := s.salas[sala]
	s.mu.Unlock()
	if api == nil {
		return ErrSemFreeSWITCH
	}
	if !existe {
		return ErrNaoEncontrado
	}
	if _, err := api.API(ctx, "conference "+sala+" hup all"); err != nil {
		return erroDoESL(err)
	}
	return nil
}

// Esvaziar avisa "acabou" de cada sala e as esquece todas, em ordem. É o que se faz quando o ESL cai.
func (s *Salas) Esvaziar() {
	s.mu.Lock()
	nomes := make([]string, 0, len(s.salas))
	for nome := range s.salas {
		nomes = append(nomes, nome)
	}
	s.salas = map[string]map[string]ligacao{}
	if s.reconstruindo > 0 {
		for _, nome := range nomes {
			s.salasAcabadas[nome] = true
		}
	}
	s.mu.Unlock()
	sort.Strings(nomes)
	for _, nome := range nomes {
		s.avisar(Aviso{Tipo: "acabou", Sala: nome})
	}
}

type conferenciaJSON struct {
	Nome    string `json:"conference_name"`
	Membros []struct {
		UUID string `json:"uuid"`
	} `json:"members"`
}

// listaDeConferencias lê a resposta do "conference json_list". Sem nenhuma conferência o FreeSWITCH escreve um
// array vazio ("[]", ou "[\n]" sem o compact), e outros comandos de listagem escrevem "+OK No active
// conferences."; as duas, e a resposta vazia, são uma lista vazia.
func listaDeConferencias(resposta string) ([]conferenciaJSON, error) {
	texto := strings.TrimSpace(resposta)
	if texto == "" || strings.HasPrefix(texto, "+OK No active conferences") {
		return nil, nil
	}
	var lista []conferenciaJSON
	if err := json.Unmarshal([]byte(texto), &lista); err != nil {
		return nil, errors.New("salas: o json_list veio ilegível")
	}
	return lista, nil
}

// Reconstruir lê do FreeSWITCH as salas que já existem (o agente reiniciou, ou o ESL acabou de conectar) e as
// junta ao estado: as ligações que o estado já tem ficam como estão. Não avisa nada, porque quem acompanha manda
// o estado inteiro depois. Uma ligação que sumiu no meio da leitura, ou que não é nossa (sem o
// starsonic_participante), fica de fora.
func (s *Salas) Reconstruir(ctx context.Context) error {
	api := s.apiAtual()
	if api == nil {
		return ErrSemFreeSWITCH
	}
	s.comecarReconstrucao()
	defer s.terminarReconstrucao()
	resp, err := api.API(ctx, "conference json_list")
	if err != nil {
		return erroDoESL(err)
	}
	lista, err := listaDeConferencias(resp)
	if err != nil {
		return err
	}

	achadas := map[string]map[string]ligacao{}
	for _, conf := range lista {
		if !salaValida(conf.Nome) {
			continue
		}
		for _, m := range conf.Membros {
			if !uuidValido(m.UUID) {
				continue
			}
			l, ok, err := lerLigacao(ctx, api, m.UUID)
			if err != nil {
				return err
			}
			if !ok {
				continue
			}
			if achadas[conf.Nome] == nil {
				achadas[conf.Nome] = map[string]ligacao{}
			}
			achadas[conf.Nome][m.UUID] = l
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for sala, ligacoes := range achadas {
		if s.salasAcabadas[sala] {
			continue
		}
		for u, l := range ligacoes {
			if s.uuidsSaidos[sala][u] {
				continue
			}
			if s.salas[sala] == nil {
				s.salas[sala] = map[string]ligacao{}
			}
			if _, ja := s.salas[sala][u]; !ja {
				s.salas[sala][u] = l
			}
		}
	}
	return nil
}

func (s *Salas) comecarReconstrucao() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconstruindo++
}

// terminarReconstrucao esquece o que acabou durante a leitura, quando a última reconstrução em curso termina.
func (s *Salas) terminarReconstrucao() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconstruindo--
	if s.reconstruindo == 0 {
		s.uuidsSaidos = map[string]map[string]bool{}
		s.salasAcabadas = map[string]bool{}
	}
}

// lerLigacao pergunta ao FreeSWITCH quem é a ligação. O erro só volta quando o contexto acaba ou o ESL cai;
// uma ligação que não responde (já saiu) ou que não é nossa dá ok falso.
func lerLigacao(ctx context.Context, api API, uuid string) (ligacao, bool, error) {
	participante, err := api.API(ctx, "uuid_getvar "+uuid+" starsonic_participante")
	if err != nil {
		if e := ctx.Err(); e != nil {
			return ligacao{}, false, e
		}
		if errors.Is(err, esl.ErrDesligado) {
			return ligacao{}, false, ErrSemFreeSWITCH
		}
		return ligacao{}, false, nil
	}
	participante = strings.TrimSpace(participante)
	if !participanteValido(participante) {
		return ligacao{}, false, nil
	}
	tela, err := api.API(ctx, "uuid_getvar "+uuid+" starsonic_tela")
	if err != nil {
		if e := ctx.Err(); e != nil {
			return ligacao{}, false, e
		}
		if errors.Is(err, esl.ErrDesligado) {
			return ligacao{}, false, ErrSemFreeSWITCH
		}
		return ligacao{}, false, nil
	}
	return ligacao{participante: participante, tela: strings.TrimSpace(tela) == "true"}, true, nil
}
