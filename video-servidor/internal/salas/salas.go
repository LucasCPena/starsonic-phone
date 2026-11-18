// Package salas guarda as reuniões que existem no FreeSWITCH: quem está em cada sala, montado pelos eventos das
// conferências, e manda ao FreeSWITCH o que o agente decide (a célula de cada pessoa, o layout, o tamanho e a banda do
// mosaico, tirar e encerrar). O contrato é a seção 5 do docs/video-agente.md, as regras da ligação principal são as da
// seção 6, e as do mosaico, as da seção 7.
//
// Um mutex guarda o estado, e nenhum comando ao FreeSWITCH nem aviso sai com ele preso. Outro, só do arrumar, faz o
// mosaico de cada sala mudar um arrumar por vez.
package salas

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/mosaico"
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

// Aviso é uma mudança nas salas. O Tipo é "entrou", "saiu", "acabou" ou "palco". O acabou só leva a Sala, e o palco
// leva a Sala e o Palco, uma cópia que é de quem recebe.
type Aviso struct {
	Tipo         string
	Sala         string
	Participante string
	Tela         bool
	Palco        *mosaico.Palco
}

// Participante é uma ligação da sala: a principal (a da câmera, que leva o som), com Tela falso, ou a da tela
// compartilhada.
type Participante struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
}

// Sala é uma reunião no FreeSWITCH, como na seção 5 do contrato. O Palco é o último avisado, e falta na sala que
// ainda não tem um.
type Sala struct {
	Sala          string         `json:"sala"`
	Participantes []Participante `json:"participantes"`
	Palco         *mosaico.Palco `json:"palco,omitempty"`
}

type ligacao struct {
	participante string
	tela         bool
	membro       string // o Member-ID da conferência, o que vai no vid-res-id
	celula       int    // a célula já dita ao FreeSWITCH para esta ligação; 0: nenhuma
}

// mosaicoDaSala é o que o FreeSWITCH já tem aplicado no mosaico da sala, e o último palco avisado. Nasce com a
// primeira ligação da sala e some com ela.
type mosaicoDaSala struct {
	estado mosaico.Estado
	palco  *mosaico.Palco
}

// Salas é o estado das reuniões. O valor zero não serve: use Nova.
type Salas struct {
	avisar func(Aviso)

	// arrumando deixa um arrumar por vez. Ele é pego antes do mu, e nunca com o mu preso.
	arrumando sync.Mutex

	mu       sync.Mutex
	api      API
	salas    map[string]map[string]ligacao // sala -> uuid da ligação -> quem é
	mosaicos map[string]*mosaicoDaSala     // sala -> o mosaico dela

	// Enquanto um Reconstruir lê o FreeSWITCH, o que um evento tira do estado fica aqui, para a junção não
	// trazer de volta o que já acabou.
	reconstruindo int
	geracao       uint64                     // sobe a cada Esvaziar: uma reconstrução que o viu passar não junta nada
	uuidsSaidos   map[string]map[string]bool // sala -> uuids que saíram
	salasAcabadas map[string]bool
}

// Nova cria as salas. O avisar recebe cada mudança, fora do mutex; pode ser nil.
func Nova(avisar func(Aviso)) *Salas {
	if avisar == nil {
		avisar = func(Aviso) {}
	}
	return &Salas{avisar: avisar, salas: map[string]map[string]ligacao{}, mosaicos: map[string]*mosaicoDaSala{},
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

// membroValido aceita o <membro> de 1 a 10 dígitos, e só dígitos: ele vai dentro do vid-res-id.
func membroValido(v string) bool {
	if len(v) < 1 || len(v) > 10 {
		return false
	}
	for i := 0; i < len(v); i++ {
		if v[i] < '0' || v[i] > '9' {
			return false
		}
	}
	return true
}

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

// entrou põe a ligação na sala e segue as regras da ligação principal (seção 6 do contrato): a tela de quem não tem
// a principal na sala cai na hora, antes do aviso e de qualquer comando do mosaico, e não entra no estado; uma
// principal nova derruba a anterior do mesmo participante. Enquanto um Reconstruir lê o FreeSWITCH, o estado está pela
// metade, e as regras esperam. Uma tela nova toma sempre o lugar da anterior. Depois do aviso, o mosaico é arrumado, e
// só então as ligações substituídas caem: a nova já está no lugar.
func (s *Salas) entrou(ctx context.Context, sala string, ev esl.Evento) {
	uuid := ev["Unique-ID"]
	participante := ev["variable_starsonic_participante"]
	membro := ev["Member-ID"]
	if !uuidValido(uuid) || !participanteValido(participante) || !membroValido(membro) {
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
	regras := s.reconstruindo == 0
	var telas, principais []string // as telas da sala, e as principais do participante
	for u, l := range ligacoes {
		switch {
		case l.tela:
			telas = append(telas, u)
		case l.participante == participante:
			principais = append(principais, u)
		}
	}
	api := s.api
	if regras && tela && len(principais) == 0 {
		s.mu.Unlock()
		if api != nil {
			api.API(ctx, "uuid_kill "+uuid)
		}
		return
	}
	ligacoes[uuid] = ligacao{participante: participante, tela: tela, membro: membro}
	if s.mosaicos[sala] == nil {
		s.mosaicos[sala] = &mosaicoDaSala{estado: mosaico.EstadoInicial()}
	}
	delete(s.uuidsSaidos[sala], uuid)
	s.mu.Unlock()

	s.avisar(Aviso{Tipo: "entrou", Sala: sala, Participante: participante, Tela: tela})
	if api == nil {
		return
	}
	var derrubar []string
	switch {
	case !tela:
		if regras {
			derrubar = principais // a principal nova toma o lugar da anterior
		}
	default:
		derrubar = telas // uma tela nova toma o lugar da anterior
	}
	s.arrumar(ctx, sala, false, true)
	sort.Strings(derrubar)
	for _, u := range derrubar {
		api.API(ctx, "uuid_kill "+u)
	}
}

// saiu tira a ligação da sala. O saiu só é avisado quando sai a última ligação daquele tipo (a principal, ou a tela)
// do participante: a que outra do mesmo participante substituiu sai sem aviso, porque ele continua na sala. Quando sai
// a última principal, as telas dele caem também (fora de um Reconstruir, como no entrou). No fim, o mosaico é
// arrumado: quando sai a última tela da sala, ele volta à grade.
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
	restaOutra := false
	var telasDele []string
	for u, outra := range s.salas[sala] {
		if outra.participante != l.participante {
			continue
		}
		if outra.tela == l.tela {
			restaOutra = true
		}
		if outra.tela {
			telasDele = append(telasDele, u)
		}
	}
	regras := s.reconstruindo == 0
	api := s.api
	s.mu.Unlock()

	if !restaOutra {
		s.avisar(Aviso{Tipo: "saiu", Sala: sala, Participante: l.participante, Tela: l.tela})
	}
	if api == nil {
		return
	}
	if !l.tela && !restaOutra && regras {
		sort.Strings(telasDele)
		for _, u := range telasDele {
			api.API(ctx, "uuid_kill "+u)
		}
	}
	s.arrumar(ctx, sala, false, true)
}

func (s *Salas) acabou(sala string) {
	s.mu.Lock()
	delete(s.salas, sala)
	delete(s.mosaicos, sala)
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
		sala := Sala{Sala: nome, Participantes: ps}
		if m := s.mosaicos[nome]; m != nil && m.palco != nil {
			sala.Palco = copiarPalco(*m.palco)
		}
		saida = append(saida, sala)
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
	s.mosaicos = map[string]*mosaicoDaSala{}
	s.geracao++
	s.mu.Unlock()
	sort.Strings(nomes)
	for _, nome := range nomes {
		s.avisar(Aviso{Tipo: "acabou", Sala: nome})
	}
}

type conferenciaJSON struct {
	Nome    string `json:"conference_name"`
	Membros []struct {
		ID   json.RawMessage `json:"id"` // o <membro>: um número, que o membroValido confere
		UUID string          `json:"uuid"`
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
// o estado inteiro depois, e não derruba nada: refaz o que acha, também a tela sem a principal e a segunda principal
// do mesmo participante; as regras da ligação principal são dos eventos, e esperam enquanto ela lê. Uma ligação que
// sumiu no meio da leitura, ou que não é nossa (sem o starsonic_participante, ou sem um <membro> que vale), fica de
// fora. Se o Esvaziar roda durante a leitura (o ESL caiu), a junção inteira é descartada e o Reconstruir devolve nil:
// o que foi lido é de antes da queda, e a próxima conexão reconstrói.
//
// Depois da leitura, cada sala é arrumada do começo: o que o FreeSWITCH tem aplicado é desconhecido, e os quatro tipos
// de comando vão. O palco fica no estado, sem aviso.
func (s *Salas) Reconstruir(ctx context.Context) error {
	api := s.apiAtual()
	if api == nil {
		return ErrSemFreeSWITCH
	}
	arrumar, err := s.lerEJuntar(ctx, api)
	if err != nil {
		return err
	}
	for _, sala := range arrumar {
		s.arrumar(ctx, sala, true, false)
	}
	return nil
}

// lerEJuntar é a leitura do Reconstruir e a junção dela ao estado. Ela devolve as salas a arrumar, cada uma com o
// mosaico recomeçado de um estado vazio.
func (s *Salas) lerEJuntar(ctx context.Context, api API) ([]string, error) {
	geracao := s.comecarReconstrucao()
	defer s.terminarReconstrucao()
	resp, err := api.API(ctx, "conference json_list")
	if err != nil {
		return nil, erroDoESL(err)
	}
	lista, err := listaDeConferencias(resp)
	if err != nil {
		return nil, err
	}

	achadas := map[string]map[string]ligacao{}
	for _, conf := range lista {
		if !salaValida(conf.Nome) {
			continue
		}
		for _, m := range conf.Membros {
			membro := string(m.ID)
			if !uuidValido(m.UUID) || !membroValido(membro) {
				continue
			}
			l, ok, err := lerLigacao(ctx, api, m.UUID)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			l.membro = membro
			if achadas[conf.Nome] == nil {
				achadas[conf.Nome] = map[string]ligacao{}
			}
			achadas[conf.Nome][m.UUID] = l
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.geracao != geracao {
		return nil, nil // o Esvaziar passou durante a leitura: o que se leu é de antes da queda
	}
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
	// Cada sala recomeça o mosaico de um estado vazio: o que o FreeSWITCH tem aplicado não se sabe. Um arrumar que
	// estava no meio vê o mosaico novo e descarta o que fez.
	nomes := make([]string, 0, len(s.salas))
	for sala, ligacoes := range s.salas {
		for u, l := range ligacoes {
			l.celula = 0
			ligacoes[u] = l
		}
		s.mosaicos[sala] = &mosaicoDaSala{estado: mosaico.Estado{Celulas: map[string]int{}}}
		nomes = append(nomes, sala)
	}
	sort.Strings(nomes)
	return nomes, nil
}

func (s *Salas) comecarReconstrucao() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconstruindo++
	return s.geracao
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

// arrumar leva o mosaico da sala ao que o mosaico.Planejar decide para as ligações de agora (seção 7 do contrato):
// manda os comandos, na ordem, guarda o que deu certo e, com o tamanho e o layout aceitos, avisa o palco quando ele
// muda. Só um arrumar roda por vez, e os comandos e o aviso saem sem o mutex do estado. Enquanto um Reconstruir lê,
// ele não faz nada, e a sala sem ligação nenhuma não é arrumada: o acabou basta. Com tudo, manda os quatro tipos de
// comando mesmo sem mudança; sem avisar, só guarda o palco.
func (s *Salas) arrumar(ctx context.Context, sala string, tudo, avisar bool) {
	s.arrumando.Lock()
	defer s.arrumando.Unlock()

	s.mu.Lock()
	m, ligacoes, api := s.mosaicos[sala], s.salas[sala], s.api
	if s.reconstruindo > 0 || api == nil || m == nil || len(ligacoes) == 0 {
		s.mu.Unlock()
		return
	}
	chamadas := make([]mosaico.Chamada, 0, len(ligacoes))
	for u, l := range ligacoes {
		chamadas = append(chamadas, mosaico.Chamada{UUID: u, Membro: l.membro, Participante: l.participante, Tela: l.tela, Celula: l.celula})
	}
	antes := m.estado
	antes.Celulas = make(map[string]int, len(m.estado.Celulas))
	for p, c := range m.estado.Celulas {
		antes.Celulas[p] = c
	}
	s.mu.Unlock()

	plano := mosaico.Planejar(antes, chamadas, tudo)
	r := mandarAoMosaico(ctx, api, sala, plano.Comandos)

	s.mu.Lock()
	if s.mosaicos[sala] != m {
		s.mu.Unlock()
		return // a sala acabou, ou um Reconstruir recomeçou o mosaico dela, enquanto os comandos iam
	}
	m.estado.Celulas = plano.Celulas
	if r.layoutRecusado {
		m.estado.Layout = "" // desconhecido: o próximo arrumar manda o tamanho e o layout de novo
	} else {
		m.estado.Layout = plano.Layout
	}
	switch r.banda {
	case aceito:
		m.estado.Banda = plano.Banda
	case recusado:
		m.estado.Banda = ""
	}
	for uuid, celula := range r.celulas {
		if l, ok := s.salas[sala][uuid]; ok {
			l.celula = celula
			s.salas[sala][uuid] = l
		}
	}
	var aviso *mosaico.Palco
	if !r.layoutRecusado && (m.palco == nil || !mesmoPalco(*m.palco, plano.Palco)) {
		m.palco = copiarPalco(plano.Palco)
		if avisar {
			aviso = copiarPalco(plano.Palco)
		}
	}
	s.mu.Unlock()

	if aviso != nil {
		s.avisar(Aviso{Tipo: "palco", Sala: sala, Palco: aviso})
	}
}

const (
	naoMandado = iota
	aceito
	recusado
)

// resultadoDoMosaico é o que deu certo dos comandos de um arrumar.
type resultadoDoMosaico struct {
	layoutRecusado bool           // o vid-res ou o vid-layout recusado: o resto não foi
	banda          int            // naoMandado, aceito ou recusado
	celulas        map[string]int // uuid -> a célula que ficou dita ao FreeSWITCH; 0: a reserva recusada
}

// mandarAoMosaico manda os comandos, na ordem, e para no vid-res ou no vid-layout recusado. Cada recusa vai ao registro
// numa linha, só com o nome do comando: a resposta do FreeSWITCH leva nomes de canal.
func mandarAoMosaico(ctx context.Context, api API, sala string, comandos []mosaico.Comando) resultadoDoMosaico {
	r := resultadoDoMosaico{celulas: map[string]int{}}
	for _, c := range comandos {
		resp, err := api.API(ctx, "conference "+sala+" "+c.Texto)
		ok := err == nil && comandoAceito(resp)
		if !ok {
			nome, _, _ := strings.Cut(c.Texto, " ")
			slog.Warn("o FreeSWITCH recusou um comando do mosaico", "comando", nome)
		}
		switch c.Tipo {
		case "res", "layout":
			if !ok {
				r.layoutRecusado = true
				return r
			}
		case "celula":
			if ok {
				r.celulas[c.UUID] = c.Celula
			} else {
				r.celulas[c.UUID] = 0
			}
		case "banda":
			r.banda = recusado
			if ok {
				r.banda = aceito
			}
		}
	}
	return r
}

// comandoAceito diz se o FreeSWITCH aceitou o comando: a resposta começa com +OK, e nenhuma linha dela começa com
// -ERR (o vid-bandwidth sem o mosaico muda a banda dos membros e termina com o -ERR).
func comandoAceito(resposta string) bool {
	if !strings.HasPrefix(resposta, "+OK") {
		return false
	}
	for _, linha := range strings.Split(resposta, "\n") {
		if strings.HasPrefix(strings.TrimSpace(linha), "-ERR") {
			return false
		}
	}
	return true
}

func mesmoPalco(a, b mosaico.Palco) bool {
	return a.Largura == b.Largura && a.Altura == b.Altura && slices.Equal(a.Quadros, b.Quadros)
}

// copiarPalco devolve uma cópia que não divide nada com o original. Os quadros nunca são nil.
func copiarPalco(p mosaico.Palco) *mosaico.Palco {
	p.Quadros = append([]mosaico.Quadro{}, p.Quadros...)
	return &p
}
