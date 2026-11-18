package salas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl/esltest"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/mosaico"
)

// Os nomes são inventados: as salas e os participantes são hexadecimais de teste.
const (
	salaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	salaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	salaC = "cccccccccccccccccccccccccccccccc" // só a da barreira dos testes com o ESL falso

	anaID    = "a1a1a1a1a1a1a1a1"
	carlosID = "c2c2c2c2c2c2c2c2"
	biaID    = "b3b3b3b3b3b3b3b3"

	daviID  = "d4d4d4d4d4d4d4d4"
	mariaID = "e5e5e5e5e5e5e5e5"

	uuidAnaCamera  = "00000000-0000-4000-8000-0000000000a1"
	uuidAnaTela    = "00000000-0000-4000-8000-0000000000a2"
	uuidAnaCamera2 = "00000000-0000-4000-8000-0000000000a3" // a segunda ligação da câmera da Ana
	uuidCarlosCam  = "00000000-0000-4000-8000-0000000000c1"
	uuidCarlosTela = "00000000-0000-4000-8000-0000000000c2"
	uuidCarlosCam2 = "00000000-0000-4000-8000-0000000000c3"
	uuidBiaCamera  = "00000000-0000-4000-8000-0000000000b1"
	uuidBiaTela    = "00000000-0000-4000-8000-0000000000b2"
	uuidBiaCamera2 = "00000000-0000-4000-8000-0000000000b3"
	uuidDaviCamera = "00000000-0000-4000-8000-0000000000d1"
	uuidMariaCam   = "00000000-0000-4000-8000-0000000000e1"

	// Os comandos do mosaico da sala A, sem o "conference <sala> " da frente.
	salaACmd = "conference " + salaA + " "

	senhaESL = "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"
)

// apiFalsa guarda os comandos e responde pelo que foi combinado.
type apiFalsa struct {
	mu        sync.Mutex
	comandos  []string
	respostas map[string]string
	erros     map[string]error
	durante   func() // roda a cada comando, fora do mutex da apiFalsa
	// responder, quando não é nil, responde antes dos mapas: o ok falso deixa o comando para eles. Roda com o
	// mutex da apiFalsa preso.
	responder func(comando string) (resp string, err error, ok bool)
}

func novaAPI() *apiFalsa {
	return &apiFalsa{respostas: map[string]string{}, erros: map[string]error{}}
}

func (a *apiFalsa) API(ctx context.Context, comando string) (string, error) {
	a.mu.Lock()
	a.comandos = append(a.comandos, comando)
	resp, ok := a.respostas[comando]
	err := a.erros[comando]
	if a.responder != nil {
		if r, e, sim := a.responder(comando); sim {
			resp, err, ok = r, e, true
		}
	}
	durante := a.durante
	a.mu.Unlock()
	if durante != nil {
		durante()
	}
	if err != nil {
		return "", err
	}
	if !ok {
		return "+OK\n", nil
	}
	return resp, nil
}

func (a *apiFalsa) Comandos() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.comandos...)
}

func (a *apiFalsa) Limpar() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.comandos = nil
}

type avisos struct {
	mu    sync.Mutex
	lista []Aviso
}

func (v *avisos) Avisar(a Aviso) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.lista = append(v.lista, a)
}

func (v *avisos) Lista() []Aviso {
	v.mu.Lock()
	defer v.mu.Unlock()
	return append([]Aviso(nil), v.lista...)
}

// membros é o <membro> (o Member-ID do FreeSWITCH) de cada ligação dos testes. As telas têm membros maiores que as
// câmeras que entraram antes delas, como no FreeSWITCH, que os dá em ordem.
var membros = map[string]string{
	uuidAnaCamera: "1", uuidCarlosCam: "2", uuidBiaCamera: "3", uuidDaviCamera: "4", uuidMariaCam: "5",
	uuidAnaTela: "6", uuidAnaCamera2: "7", uuidCarlosTela: "8", uuidCarlosCam2: "9", uuidBiaTela: "10", uuidBiaCamera2: "11",
}

// membroDe é o <membro> da ligação: o da tabela, ou um número tirado do uuid, para as ligações sem nome.
func membroDe(uuid string) string {
	if m, ok := membros[uuid]; ok {
		return m
	}
	h := fnv.New32a()
	h.Write([]byte(uuid))
	return fmt.Sprint(h.Sum32()%1_000_000 + 100)
}

func entra(sala, uuid, participante string, tela bool) esl.Evento {
	return esl.Evento{
		"Event-Name":                      "CUSTOM",
		"Event-Subclass":                  "conference::maintenance",
		"Action":                          "add-member",
		"Conference-Name":                 sala,
		"Unique-ID":                       uuid,
		"Member-ID":                       membroDe(uuid),
		"variable_starsonic_participante": participante,
		"variable_starsonic_tela":         fmt.Sprint(tela),
	}
}

func sai(sala, uuid string) esl.Evento {
	return esl.Evento{
		"Event-Name":      "CUSTOM",
		"Event-Subclass":  "conference::maintenance",
		"Action":          "del-member",
		"Conference-Name": sala,
		"Unique-ID":       uuid,
	}
}

func acaba(sala string) esl.Evento {
	return esl.Evento{
		"Event-Name":      "CUSTOM",
		"Event-Subclass":  "conference::maintenance",
		"Action":          "conference-destroy",
		"Conference-Name": sala,
	}
}

func novo(t *testing.T) (*Salas, *apiFalsa, *avisos) {
	t.Helper()
	v := &avisos{}
	s := Nova(v.Avisar)
	a := novaAPI()
	s.Ligar(a)
	return s, a, v
}

func ctx() context.Context { return context.Background() }

// comESL liga as salas a um FreeSWITCH falso (o esltest) pelo cliente do ESL, como o agente faz: os eventos chegam
// pela conexão, na ordem, e os comandos saem por ela. O FreeSWITCH falso responde +OK aos comandos das salas.
func comESL(t *testing.T) (*Salas, *esltest.Servidor, *avisos) {
	t.Helper()
	fs := esltest.Novo(t, senhaESL)
	fs.Responder("uuid_kill", "+OK\n")
	fs.Responder("conference", "+OK\n")
	c, cancel := context.WithTimeout(ctx(), 10*time.Second)
	defer cancel()
	conn, err := esl.Conectar(c, fs.Endereco(), senhaESL)
	if err != nil {
		t.Fatalf("Conectar: %v", err)
	}
	v := &avisos{}
	s := Nova(v.Avisar)
	s.Ligar(conn)
	passou := make(chan struct{})
	go func() {
		defer close(passou)
		for ev := range conn.Eventos() {
			s.Evento(ctx(), ev)
		}
	}()
	t.Cleanup(func() {
		conn.Fechar()
		<-passou
	})
	return s, fs, v
}

// esperarComando espera o FreeSWITCH falso receber o comando, por até 5 s.
func esperarComando(t *testing.T, fs *esltest.Servidor, comando string) {
	t.Helper()
	fim := time.Now().Add(5 * time.Second)
	for contarComando(fs.Comandos(), comando) == 0 {
		if time.Now().After(fim) {
			t.Fatalf("o comando %q não chegou em 5 s; chegaram %q", comando, fs.Comandos())
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func contarComando(comandos []string, quero string) int {
	n := 0
	for _, c := range comandos {
		if c == quero {
			n++
		}
	}
	return n
}

// barreira manda o fim da sala C e espera o aviso dele: os eventos chegam na ordem, então, quando ele chega, tudo o
// que foi mandado antes já foi tratado, com os comandos que pediu.
func barreira(t *testing.T, fs *esltest.Servidor, v *avisos) {
	t.Helper()
	contar := func() int {
		n := 0
		for _, a := range v.Lista() {
			if a.Sala == salaC {
				n++
			}
		}
		return n
	}
	antes := contar()
	fs.Mandar(acaba(salaC))
	fim := time.Now().Add(5 * time.Second)
	for contar() == antes {
		if time.Now().After(fim) {
			t.Fatal("a barreira não passou em 5 s")
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// semBarreira são os avisos sem os da barreira.
func semBarreira(lista []Aviso) []Aviso {
	var saida []Aviso
	for _, a := range lista {
		if a.Sala != salaC {
			saida = append(saida, a)
		}
	}
	return saida
}

// semPalco são os avisos sem os do palco, para os testes de quem entra e sai.
func semPalco(lista []Aviso) []Aviso {
	var saida []Aviso
	for _, a := range lista {
		if a.Tipo != "palco" {
			saida = append(saida, a)
		}
	}
	return saida
}

// semOPalco é o estado sem o palco das salas, para os testes de quem está em cada uma.
func semOPalco(salas []Sala) []Sala {
	saida := make([]Sala, len(salas))
	for i, s := range salas {
		s.Palco = nil
		saida[i] = s
	}
	return saida
}

// palco monta um palco; cam e tela, os quadros dele.
func palco(largura, altura int, quadros ...mosaico.Quadro) *mosaico.Palco {
	return &mosaico.Palco{Largura: largura, Altura: altura, Quadros: append([]mosaico.Quadro{}, quadros...)}
}

func cam(participante string, x, y, l, a int) mosaico.Quadro {
	return mosaico.Quadro{Participante: participante, X: x, Y: y, L: l, A: a}
}

func tela(participante string, x, y, l, a int) mosaico.Quadro {
	return mosaico.Quadro{Participante: participante, Tela: true, X: x, Y: y, L: l, A: a}
}

// Os quadros da grade de 4 (1920×1080), da de 9 (1920×1086) e da apresentação de 2 (1920×1620).
func c4(p string, celula int) mosaico.Quadro {
	return cam(p, (celula-1)%2*960, (celula-1)/2*540, 960, 540)
}

func c9(p string, celula int) mosaico.Quadro {
	return cam(p, (celula-1)%3*640, (celula-1)/3*362, 640, 362)
}

func ap2(p string, celula int) mosaico.Quadro { return cam(p, (celula-1)*960, 1080, 960, 540) }

func telaAp2(p string) mosaico.Quadro { return tela(p, 0, 0, 1920, 1080) }

func avisoPalco(p *mosaico.Palco) Aviso { return Aviso{Tipo: "palco", Sala: salaA, Palco: p} }

// mosaicoDaSalaA são os comandos que a sala A recebeu, sem o "conference <sala> " da frente, e sem os outros.
func mosaicoDaSalaA(comandos []string) []string {
	var saida []string
	for _, c := range comandos {
		c = strings.TrimPrefix(c, "api ")
		if r, ok := strings.CutPrefix(c, salaACmd); ok {
			saida = append(saida, r)
		}
	}
	return saida
}

// registro troca o registro padrão por um que o teste lê.
func registro(t *testing.T) *strings.Builder {
	t.Helper()
	var buf strings.Builder
	var mu sync.Mutex
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(escritorSeguro{&buf, &mu}, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &buf
}

type escritorSeguro struct {
	b  *strings.Builder
	mu *sync.Mutex
}

func (e escritorSeguro) Write(p []byte) (int, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.b.Write(p)
}

func TestSalas_EntrouSaiu(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {carlosID, false}}}}
	if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado = %+v, want %+v", got, want)
	}
	s.Evento(ctx(), sai(salaA, uuidAnaCamera))
	want = []Sala{{Sala: salaA, Participantes: []Participante{{carlosID, false}}}}
	if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado depois da saída = %+v, want %+v", got, want)
	}
	avisosWant := []Aviso{
		{Tipo: "entrou", Sala: salaA, Participante: anaID},
		{Tipo: "entrou", Sala: salaA, Participante: carlosID},
		{Tipo: "saiu", Sala: salaA, Participante: anaID},
	}
	if got := semPalco(v.Lista()); !reflect.DeepEqual(got, avisosWant) {
		t.Errorf("avisos = %+v, want %+v", got, avisosWant)
	}
}

func TestSalas_Estado(t *testing.T) {
	t.Run("sem salas é uma lista vazia, e não nula", func(t *testing.T) {
		s, _, _ := novo(t)
		got := s.Estado()
		if got == nil || len(got) != 0 {
			t.Fatalf("Estado = %#v, want lista vazia", got)
		}
		b, _ := json.Marshal(got)
		if string(b) != "[]" {
			t.Errorf("JSON = %s, want []", b)
		}
	})
	t.Run("o JSON é o da seção 5 do contrato, em ordem estável", func(t *testing.T) {
		// Sem o FreeSWITCH, nenhuma sala tem palco: o campo falta (o palco tem o teste dele).
		s := Nova(nil)
		s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
		s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false)) // a tela só entra depois da câmera (seção 6)
		s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		b, _ := json.Marshal(s.Estado())
		want := fmt.Sprintf(`[{"sala":%q,"participantes":[{"participante":%q,"tela":false},{"participante":%q,"tela":false},{"participante":%q,"tela":true}]},{"sala":%q,"participantes":[{"participante":%q,"tela":false}]}]`,
			salaA, anaID, carlosID, carlosID, salaB, biaID)
		if string(b) != want {
			t.Errorf("JSON =\n%s\nwant\n%s", b, want)
		}
	})
	t.Run("o resultado é uma cópia", func(t *testing.T) {
		s, _, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		e := s.Estado()
		e[0].Participantes[0].Participante = "mexido"
		e[0].Palco.Quadros[0].X = 99
		e[0].Palco.Largura = 99
		if got := s.Estado()[0].Participantes[0].Participante; got != anaID {
			t.Errorf("o Estado mudou por fora: %s", got)
		}
		if got := s.Estado()[0].Palco; !reflect.DeepEqual(got, palco(1920, 1080, c4(anaID, 1))) {
			t.Errorf("o palco mudou por fora: %+v", got)
		}
	})
}

// A tela muda o layout para a apresentação, com o tamanho e a banda dela, e a saída dela volta à grade. O palco sai
// depois dos comandos, com a tela primeiro.
func TestSalas_Tela(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))

	passos := []struct {
		nome   string
		evento esl.Evento
		want   []string
		palco  *mosaico.Palco
	}{
		{"a tela de Ana entra", entra(salaA, uuidAnaTela, anaID, true),
			[]string{"vid-res 1920x1620", "vid-layout starsonic-apresentacao-2", "vid-bandwidth 4mb '' 1"},
			palco(1920, 1620, telaAp2(anaID), ap2(anaID, 1), ap2(carlosID, 2))},
		{"ela sai", sai(salaA, uuidAnaTela),
			[]string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-bandwidth 3mb '' 1"},
			palco(1920, 1080, c4(anaID, 1), c4(carlosID, 2))},
	}
	for _, p := range passos {
		a.Limpar()
		antes := len(v.Lista())
		s.Evento(ctx(), p.evento)
		if got := mosaicoDaSalaA(a.Comandos()); !reflect.DeepEqual(got, p.want) {
			t.Errorf("%s: comandos = %q, want %q", p.nome, got, p.want)
		}
		if got := a.Comandos(); len(got) != len(p.want) {
			t.Errorf("%s: comandos = %q, want só os do mosaico", p.nome, got)
		}
		depois := v.Lista()[antes:]
		if len(depois) != 2 || depois[0].Tipo == "palco" || !reflect.DeepEqual(depois[1], avisoPalco(p.palco)) {
			t.Errorf("%s: avisos = %+v, want o da tela e depois o palco %+v", p.nome, depois, p.palco)
		}
	}
	want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {carlosID, false}},
		Palco: palco(1920, 1080, c4(anaID, 1), c4(carlosID, 2))}}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v, want %+v", got, want)
	}
}

// Uma tela nova toma o lugar da anterior: o palco passa a ter a tela nova (a de maior <membro>), e a anterior cai
// depois dele.
func TestSalas_TelaNova(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	a.Limpar()
	antes := len(v.Lista())
	avisosNoKill := -1
	a.durante = func() {
		if cmds := a.Comandos(); cmds[len(cmds)-1] == "uuid_kill "+uuidAnaTela {
			avisosNoKill = len(v.Lista())
		}
	}
	s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
	if got, want := a.Comandos(), []string{"uuid_kill " + uuidAnaTela}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
	want := []Aviso{
		{Tipo: "entrou", Sala: salaA, Participante: carlosID, Tela: true},
		avisoPalco(palco(1920, 1620, telaAp2(carlosID), ap2(anaID, 1), ap2(carlosID, 2))),
	}
	if got := v.Lista()[antes:]; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v\nwant %+v", got, want)
	}
	if avisosNoKill != antes+2 {
		t.Errorf("o uuid_kill da tela da Ana saiu com %d avisos, want %d (depois do palco)", avisosNoKill, antes+2)
	}
}

func TestSalas_Tela_SemFreeSWITCH(t *testing.T) {
	// Sem a ligação o evento só acompanha o estado: nenhum comando, nenhum pânico.
	s := Nova(nil)
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	s.Evento(ctx(), sai(salaA, uuidAnaTela))
	if got := s.Estado(); len(got) != 1 || len(got[0].Participantes) != 0 {
		t.Errorf("Estado = %+v", got)
	}
}

// A primeira regra da ligação principal (seção 6 do contrato): a tela de quem não tem a ligação principal (a da câmera)
// na sala cai na hora, sem o entrou e sem nenhum comando do mosaico. O quadro grande nunca é dela, e o chat não a vê
// nem no palco: é a tela de alguém que foi tirado e ligou com uma senha da tela que ainda valia.
func TestSalas_TelaSemAPrincipal(t *testing.T) {
	s, fs, v := comESL(t)
	fs.Mandar(entra(salaA, uuidAnaCamera, anaID, false))
	esperarComando(t, fs, "api "+salaACmd+"vid-res-id 1 c1 force")
	antes := len(fs.Comandos())
	fs.Mandar(entra(salaA, uuidCarlosTela, carlosID, true)) // o Carlos não tem a câmera na sala
	esperarComando(t, fs, "api uuid_kill "+uuidCarlosTela)
	// O FreeSWITCH avisa que ela saiu: isso também não muda nada.
	fs.Mandar(sai(salaA, uuidCarlosTela))
	barreira(t, fs, v)
	if got, want := fs.Comandos()[antes:], []string{"api uuid_kill " + uuidCarlosTela}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
	want := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}
	if got := semBarreira(v.Lista()); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v, want %+v", got, want)
	}
	if got, want := semOPalco(s.Estado()), []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}}}}; !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v, want %+v", got, want)
	}

	// A tela de quem tem a câmera na sala entra, como sempre.
	fs.Mandar(entra(salaA, uuidAnaTela, anaID, true))
	esperarComando(t, fs, "api "+salaACmd+"vid-layout starsonic-apresentacao-2")
	if n := contarComando(fs.Comandos(), "api uuid_kill "+uuidAnaTela); n != 0 {
		t.Errorf("a tela da Ana, com a câmera dela na sala, caiu")
	}
}

// A segunda regra: quando a última ligação principal de um participante sai da sala, as telas dele caem com ela (a
// câmera caiu, ou ele foi tirado), e o layout volta à grade quando a tela sai.
func TestSalas_TelaSaiComAPrincipal(t *testing.T) {
	s, fs, v := comESL(t)
	fs.Mandar(entra(salaA, uuidAnaCamera, anaID, false))
	fs.Mandar(entra(salaA, uuidCarlosCam, carlosID, false))
	fs.Mandar(entra(salaA, uuidAnaTela, anaID, true))
	esperarComando(t, fs, "api "+salaACmd+"vid-layout starsonic-apresentacao-2")

	// A câmera de outra pessoa sai: a tela da Ana fica.
	fs.Mandar(sai(salaA, uuidCarlosCam))
	barreira(t, fs, v)
	if n := contarComando(fs.Comandos(), "api uuid_kill "+uuidAnaTela); n != 0 {
		t.Fatalf("a saída do Carlos derrubou a tela da Ana")
	}

	// A câmera da Ana cai: a tela dela cai junto.
	fs.Mandar(sai(salaA, uuidAnaCamera))
	esperarComando(t, fs, "api uuid_kill "+uuidAnaTela)
	fs.Mandar(sai(salaA, uuidAnaTela))
	barreira(t, fs, v)
	want := []Aviso{
		{Tipo: "entrou", Sala: salaA, Participante: anaID},
		{Tipo: "entrou", Sala: salaA, Participante: carlosID},
		{Tipo: "entrou", Sala: salaA, Participante: anaID, Tela: true},
		{Tipo: "saiu", Sala: salaA, Participante: carlosID},
		{Tipo: "saiu", Sala: salaA, Participante: anaID},
		{Tipo: "saiu", Sala: salaA, Participante: anaID, Tela: true},
	}
	if got := semPalco(semBarreira(v.Lista())); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v\nwant %+v", got, want)
	}
	if got := s.Estado(); len(got) != 1 || len(got[0].Participantes) != 0 {
		t.Errorf("Estado = %+v", got)
	}
}

// A terceira regra: uma ligação principal nova do participante toma o lugar da anterior, que o agente derruba depois de
// pôr a nova na célula dele. O chat não recebe o saiu da anterior, nem um palco novo: o participante continua na sala,
// no mesmo lugar, e a tela dele também. O saiu vem quando sai a última.
func TestSalas_PrincipalNovaTomaOLugar(t *testing.T) {
	s, fs, v := comESL(t)
	fs.Mandar(entra(salaA, uuidAnaCamera, anaID, false))
	fs.Mandar(entra(salaA, uuidAnaTela, anaID, true))
	esperarComando(t, fs, "api "+salaACmd+"vid-layout starsonic-apresentacao-2")
	barreira(t, fs, v)
	avisosAntes := len(semBarreira(v.Lista()))

	// Uma segunda senha da câmera da Ana, usada: a ligação anterior cai.
	antes := len(fs.Comandos())
	fs.Mandar(entra(salaA, uuidAnaCamera2, anaID, false))
	esperarComando(t, fs, "api uuid_kill "+uuidAnaCamera)
	barreira(t, fs, v)
	if got, want := fs.Comandos()[antes:], []string{"api " + salaACmd + "vid-res-id 7 c1 force", "api uuid_kill " + uuidAnaCamera}; !reflect.DeepEqual(got, want) {
		t.Fatalf("comandos da câmera nova = %q, want %q", got, want)
	}
	antes = len(fs.Comandos())
	fs.Mandar(sai(salaA, uuidAnaCamera))
	barreira(t, fs, v)
	if got := fs.Comandos()[antes:]; len(got) != 0 {
		t.Fatalf("a saída da câmera anterior mandou %q, want nada", got)
	}
	want := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}}
	if got := semBarreira(v.Lista())[avisosAntes:]; !reflect.DeepEqual(got, want) {
		t.Fatalf("avisos = %+v\nwant %+v (sem o saiu da câmera anterior, e sem palco novo)", got, want)
	}
	if got, want := semOPalco(s.Estado()), []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {anaID, true}}}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado = %+v, want %+v", got, want)
	}

	// A última principal sai: o saiu vem, e a tela cai com ela.
	fs.Mandar(sai(salaA, uuidAnaCamera2))
	esperarComando(t, fs, "api uuid_kill "+uuidAnaTela)
	barreira(t, fs, v)
	if got := semPalco(semBarreira(v.Lista())); len(got) != 4 || got[3] != (Aviso{Tipo: "saiu", Sala: salaA, Participante: anaID}) {
		t.Errorf("avisos = %+v; o último devia ser o saiu da câmera da Ana", got)
	}
	if n := contarComando(fs.Comandos(), "api uuid_kill "+uuidAnaCamera2); n != 0 {
		t.Errorf("a câmera nova também caiu")
	}
}

func TestSalas_TirarEncerrar(t *testing.T) {
	t.Run("o Tirar de quem tem câmera e tela manda os dois uuid_kill", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
		a.Limpar()
		if err := s.Tirar(ctx(), salaA, anaID); err != nil {
			t.Fatal(err)
		}
		got := a.Comandos()
		want := []string{"uuid_kill " + uuidAnaCamera, "uuid_kill " + uuidAnaTela}
		if len(got) != 2 || !(got[0] == want[0] && got[1] == want[1] || got[0] == want[1] && got[1] == want[0]) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
		// O estado só muda quando o FreeSWITCH avisa que saiu.
		if n := len(s.Estado()[0].Participantes); n != 3 {
			t.Errorf("o Tirar mexeu no estado: %d ligações", n)
		}
	})
	t.Run("um participante desconhecido dá ErrNaoEncontrado, sem comando", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.Limpar()
		if err := s.Tirar(ctx(), salaA, biaID); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("participante desconhecido: err = %v", err)
		}
		if err := s.Tirar(ctx(), salaB, anaID); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("sala desconhecida: err = %v", err)
		}
		if got := a.Comandos(); len(got) != 0 {
			t.Errorf("comandos = %q, want nenhum", got)
		}
	})
	t.Run("o Encerrar manda conference <sala> hup all", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.Limpar()
		if err := s.Encerrar(ctx(), salaA); err != nil {
			t.Fatal(err)
		}
		if got, want := a.Comandos(), []string{"conference " + salaA + " hup all"}; !reflect.DeepEqual(got, want) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
	})
	t.Run("o Encerrar de uma sala desconhecida dá ErrNaoEncontrado, sem comando", func(t *testing.T) {
		s, a, _ := novo(t)
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("err = %v, want ErrNaoEncontrado", err)
		}
		if got := a.Comandos(); len(got) != 0 {
			t.Errorf("comandos = %q, want nenhum", got)
		}
	})
	t.Run("sem o Ligar, os dois dão ErrSemFreeSWITCH", func(t *testing.T) {
		s := Nova(nil)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("o Ligar com nil, quando o ESL cai, volta a ErrSemFreeSWITCH", func(t *testing.T) {
		s, _, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Ligar(nil)
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("o ESL desligado no meio vira ErrSemFreeSWITCH", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.erros["uuid_kill "+uuidAnaCamera] = esl.ErrDesligado
		a.erros["conference "+salaA+" hup all"] = esl.ErrDesligado
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("um uuid_kill que acha o canal já ido conta como feito", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		a.erros["uuid_kill "+uuidAnaCamera] = &esl.ErroFS{Motivo: "No such channel!"}
		if err := s.Tirar(ctx(), salaA, anaID); err != nil {
			t.Errorf("err = %v, want nil", err)
		}
	})
	t.Run("outro -ERR volta ao chamador", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.erros["uuid_kill "+uuidAnaCamera] = &esl.ErroFS{Motivo: "Permission denied"}
		err := s.Tirar(ctx(), salaA, anaID)
		if err == nil || errors.Is(err, ErrNaoEncontrado) || errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v, want o erro do FreeSWITCH", err)
		}
	})
}

func TestSalas_Acabou(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), acaba(salaA))
	want := []Sala{{Sala: salaB, Participantes: []Participante{{biaID, false}}}}
	if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v, want %+v", got, want)
	}
	lista := v.Lista()
	if got := lista[len(lista)-1]; got != (Aviso{Tipo: "acabou", Sala: salaA}) {
		t.Errorf("último aviso = %+v", got)
	}
	// A sala que acabou não aceita mais o Encerrar.
	if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("Encerrar depois do fim: err = %v", err)
	}
}

func TestSalas_IgnoraOutras(t *testing.T) {
	casos := []struct {
		nome   string
		evento esl.Evento
	}{
		{"conferência com outro nome", entra("sala-de-outra-coisa", uuidAnaCamera, anaID, false)},
		{"nome com maiúsculas", entra(strings.ToUpper(salaA), uuidAnaCamera, anaID, false)},
		{"nome comprido", entra(salaA+"00", uuidAnaCamera, anaID, false)},
		{"sem participante", entra(salaA, uuidAnaCamera, "", false)},
		{"participante que não é hexadecimal", entra(salaA, uuidAnaCamera, "../../etc/passwd", false)},
		{"sem uuid", entra(salaA, "", anaID, false)},
		{"uuid com espaço", entra(salaA, "x y", anaID, false)},
		{"subclasse de outra coisa", func() esl.Evento {
			e := entra(salaA, uuidAnaCamera, anaID, false)
			e["Event-Subclass"] = "sofia::register"
			return e
		}()},
		{"outra ação", func() esl.Evento {
			e := entra(salaA, uuidAnaCamera, anaID, false)
			e["Action"] = "mute-member"
			return e
		}()},
		{"saída de quem não se conhece", sai(salaA, uuidAnaCamera)},
		{"fim de outra conferência", acaba("sala-de-outra-coisa")},
		{"evento vazio", esl.Evento{}},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			s, a, v := novo(t)
			s.Evento(ctx(), c.evento)
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("Estado = %+v, want vazio", got)
			}
			if got := v.Lista(); len(got) != 0 {
				t.Errorf("avisos = %+v, want nenhum", got)
			}
			if got := a.Comandos(); len(got) != 0 {
				t.Errorf("comandos = %q, want nenhum", got)
			}
		})
	}
}

func TestSalas_EntradaRepetida(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	want := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}
	if got := v.Lista(); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v, want %+v", got, want)
	}
	if got := a.Comandos(); len(got) != 1 {
		t.Errorf("comandos = %q, want só a célula da Ana", got)
	}
	if n := len(s.Estado()[0].Participantes); n != 1 {
		t.Errorf("ligações = %d, want 1", n)
	}
}

func TestSalas_Esvaziar(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	antes := len(v.Lista())
	s.Esvaziar()
	got := v.Lista()[antes:]
	want := []Aviso{{Tipo: "acabou", Sala: salaA}, {Tipo: "acabou", Sala: salaB}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("avisos do Esvaziar = %+v, want %+v", got, want)
	}
	if e := s.Estado(); len(e) != 0 {
		t.Errorf("Estado = %+v, want vazio", e)
	}
	s.Esvaziar() // de novo: nada a avisar
	if n := len(v.Lista()); n != antes+2 {
		t.Errorf("o segundo Esvaziar avisou de novo: %d avisos", n)
	}
}

// listaFS monta o conference json_list como o FreeSWITCH o escreve, com os campos que o agente não usa.
func listaFS(salas map[string][]string, ordem []string) string {
	var confs []map[string]any
	for _, nome := range ordem {
		var membros []map[string]any
		for _, u := range salas[nome] {
			id, _ := strconv.Atoi(membroDe(u))
			membros = append(membros, map[string]any{"id": id, "uuid": u, "caller_id_name": "Ana", "flags": map[string]any{"can_hear": true}})
		}
		confs = append(confs, map[string]any{"conference_name": nome, "member_count": len(membros), "running": true, "members": membros})
	}
	b, _ := json.MarshalIndent(confs, "", "    ")
	return string(b)
}

func TestSalas_Reconstruir(t *testing.T) {
	// O estado de antes do reinício do agente, montado pelos eventos.
	antes, _, _ := novo(t)
	antes.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	antes.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	antes.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	want := semOPalco(antes.Estado())
	if len(want) != 2 {
		t.Fatalf("o preparo falhou: %+v", want)
	}

	// O agente reinicia: o FreeSWITCH continua com as duas salas e as três ligações.
	s := Nova(nil)
	a := novaAPI()
	a.respostas["conference json_list"] = listaFS(map[string][]string{
		salaA: {uuidAnaCamera, uuidAnaTela},
		salaB: {uuidBiaCamera},
	}, []string{salaA, salaB})
	for uuid, p := range map[string][2]string{
		uuidAnaCamera: {anaID, "false"}, uuidAnaTela: {anaID, "true"}, uuidBiaCamera: {biaID, "false"},
	} {
		a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p[0]
		a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = p[1]
	}
	s.Ligar(a)
	if err := s.Reconstruir(ctx()); err != nil {
		t.Fatal(err)
	}
	if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado = %+v, want %+v", got, want)
	}
	// A leitura, e depois cada sala arrumada, em ordem: a A com a tela, e a B com a grade.
	cmds := a.Comandos()
	if cmds[0] != "conference json_list" || len(cmds) != 1+3*2+4+4 {
		t.Fatalf("comandos = %q", cmds)
	}
	salaBCmd := "conference " + salaB + " "
	wantArrumar := []string{
		salaACmd + "vid-res 1920x1620", salaACmd + "vid-layout starsonic-apresentacao-2", salaACmd + "vid-res-id 1 c1 force", salaACmd + "vid-bandwidth 4mb '' 1",
		salaBCmd + "vid-res 1920x1080", salaBCmd + "vid-layout starsonic-4", salaBCmd + "vid-res-id 3 c1 force", salaBCmd + "vid-bandwidth 3mb '' 1",
	}
	if got := cmds[7:]; !reflect.DeepEqual(got, wantArrumar) {
		t.Errorf("os comandos depois da leitura = %q\nwant %q", got, wantArrumar)
	}

	// E o Tirar acha os uuids.
	a.Limpar()
	if err := s.Tirar(ctx(), salaA, anaID); err != nil {
		t.Fatal(err)
	}
	got := a.Comandos()
	if len(got) != 2 {
		t.Fatalf("Tirar mandou %q", got)
	}
	vistos := map[string]bool{got[0]: true, got[1]: true}
	if !vistos["uuid_kill "+uuidAnaCamera] || !vistos["uuid_kill "+uuidAnaTela] {
		t.Errorf("Tirar mandou %q", got)
	}
	// E uma tela nova depois da volta toma o lugar da que já estava. A do Carlos entra depois da câmera dele: a tela
	// sem a ligação principal na sala cai (seção 6).
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
	if got := a.Comandos(); !reflect.DeepEqual(got, []string{"uuid_kill " + uuidAnaTela}) { // o mosaico não muda
		t.Errorf("tela nova depois da volta: comandos = %q", got)
	}
}

// A reconstrução refaz o que acha no FreeSWITCH e não derruba nada: nem a tela de quem não tem a câmera na sala, nem a
// segunda câmera do mesmo participante. Enquanto ela lê, o estado está pela metade, e as regras da ligação principal
// esperam: os eventos do meio da leitura também não derrubam ninguém.
func TestSalas_Reconstruir_NaoDerruba(t *testing.T) {
	s := Nova(nil)
	a := novaAPI()
	a.respostas["conference json_list"] = listaFS(map[string][]string{
		salaA: {uuidAnaTela, uuidCarlosCam, uuidCarlosCam2},
	}, []string{salaA})
	for uuid, p := range map[string][2]string{
		uuidAnaTela: {anaID, "true"}, uuidCarlosCam: {carlosID, "false"}, uuidCarlosCam2: {carlosID, "false"},
	} {
		a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p[0]
		a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = p[1]
	}
	// No último getvar, com tudo lido e nada juntado, a Bia entra na sala B com a câmera e a tela, troca a câmera por
	// outra e sai com as duas: fora da reconstrução, a câmera nova derrubaria a anterior e a saída da última derrubaria
	// a tela.
	ultimo := "uuid_getvar " + uuidCarlosCam2 + " starsonic_tela"
	a.durante = func() {
		if cmds := a.Comandos(); cmds[len(cmds)-1] == ultimo {
			a.durante = nil
			s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
			s.Evento(ctx(), entra(salaB, uuidBiaTela, biaID, true))
			s.Evento(ctx(), entra(salaB, uuidBiaCamera2, biaID, false))
			s.Evento(ctx(), sai(salaB, uuidBiaCamera))
			s.Evento(ctx(), sai(salaB, uuidBiaCamera2))
		}
	}
	s.Ligar(a)
	if err := s.Reconstruir(ctx()); err != nil {
		t.Fatal(err)
	}
	for _, c := range a.Comandos() {
		if strings.HasPrefix(c, "uuid_kill") {
			t.Errorf("a reconstrução derrubou uma ligação: %q", c)
		}
	}
	want := []Sala{
		{Sala: salaA, Participantes: []Participante{{anaID, true}, {carlosID, false}, {carlosID, false}}},
		{Sala: salaB, Participantes: []Participante{{biaID, true}}},
	}
	if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v\nwant %+v", got, want)
	}
}

func TestSalas_Reconstruir_SemConferencias(t *testing.T) {
	// O FreeSWITCH escreve o "[]" (o json_list, em mod_conference/conference_api.c) e, em outros caminhos de
	// listagem, o "+OK No active conferences.". As duas respostas são uma lista vazia.
	respostas := map[string]string{
		"array vazio":                  "[]",
		"array vazio formatado":        "[\n]\n",
		"array vazio com espaços":      "  [ ]  \n",
		"texto sem conferências":       "+OK No active conferences.\n",
		"texto sem conferências, cru":  "+OK No active conferences.",
		"resposta vazia":               "",
		"resposta só com quebra":       "\n",
		"salas de outro nome e vazias": `[{"conference_name":"outra","members":[{"uuid":"x"}]},{"conference_name":"` + salaA + `","members":[]}]`,
	}
	for nome, resp := range respostas {
		t.Run(nome, func(t *testing.T) {
			s := Nova(nil)
			a := novaAPI()
			a.respostas["conference json_list"] = resp
			s.Ligar(a)
			if err := s.Reconstruir(ctx()); err != nil {
				t.Fatalf("Reconstruir: %v", err)
			}
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("Estado = %+v, want vazio", got)
			}
			if cmds := a.Comandos(); len(cmds) != 1 {
				t.Errorf("comandos = %q, want só o json_list", cmds)
			}
		})
	}
}

func TestSalas_Reconstruir_Erros(t *testing.T) {
	t.Run("sem o Ligar", func(t *testing.T) {
		if err := Nova(nil).Reconstruir(ctx()); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("uma resposta que não é JSON nem a de sem conferências", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.respostas["conference json_list"] = "<html>outra coisa</html>"
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err == nil {
			t.Error("Reconstruir aceitou uma resposta ilegível")
		}
	})
	t.Run("o json_list com erro", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.erros["conference json_list"] = errors.New("esl: boom")
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err == nil || errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("o ESL desligado vira ErrSemFreeSWITCH", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.erros["conference json_list"] = esl.ErrDesligado
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("uma ligação que sumiu ou não é nossa fica de fora, as outras entram", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		const uuidSumiu, uuidDeFora = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaA: {uuidSumiu, uuidDeFora, uuidAnaCamera}}, []string{salaA})
		a.erros["uuid_getvar "+uuidSumiu+" starsonic_participante"] = errors.New("esl: no such channel")
		a.respostas["uuid_getvar "+uuidDeFora+" starsonic_participante"] = "_undef_"
		a.respostas["uuid_getvar "+uuidAnaCamera+" starsonic_participante"] = anaID
		a.respostas["uuid_getvar "+uuidAnaCamera+" starsonic_tela"] = "_undef_" // a câmera sem a variável da tela
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}}}}
		if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
	})
	t.Run("o contexto cancelado interrompe", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaA: {uuidAnaCamera}}, []string{salaA})
		a.erros["uuid_getvar "+uuidAnaCamera+" starsonic_participante"] = context.Canceled
		s.Ligar(a)
		c, cancel := context.WithCancel(ctx())
		cancel()
		if err := s.Reconstruir(c); !errors.Is(err, context.Canceled) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("não apaga o que os eventos já trouxeram", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
		a.respostas["conference json_list"] = "[]"
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		if got := s.Estado(); len(got) != 1 {
			t.Errorf("Estado = %+v", got)
		}
	})
}

// Nenhum comando ao FreeSWITCH, nem aviso, sai com o mutex das salas preso: a apiFalsa e o avisar chamam o
// Estado, que travaria.
func TestSalas_ComandosForaDoMutex(t *testing.T) {
	var s *Salas
	var a *apiFalsa
	chamadas := 0
	avisar := func(Aviso) { s.Estado() }
	s = Nova(avisar)
	a = novaAPI()
	a.durante = func() { chamadas++; s.Estado() }
	s.Ligar(a)

	feito := make(chan struct{})
	go func() {
		defer close(feito)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
		s.Evento(ctx(), sai(salaA, uuidAnaTela))
		s.Evento(ctx(), sai(salaA, uuidCarlosTela))
		// As regras da ligação principal (seção 6): a câmera nova derruba a anterior, e a saída da última derruba a tela.
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		s.Evento(ctx(), entra(salaA, uuidAnaCamera2, anaID, false))
		s.Evento(ctx(), sai(salaA, uuidAnaCamera))
		s.Evento(ctx(), sai(salaA, uuidAnaCamera2))
		_ = s.Tirar(ctx(), salaA, anaID)
		_ = s.Encerrar(ctx(), salaA)
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaB: {uuidBiaCamera}}, []string{salaB})
		a.respostas["uuid_getvar "+uuidBiaCamera+" starsonic_participante"] = biaID
		a.respostas["uuid_getvar "+uuidBiaCamera+" starsonic_tela"] = "false"
		_ = s.Reconstruir(ctx())
		s.Esvaziar()
		s.Evento(ctx(), acaba(salaA))
	}()
	select {
	case <-feito:
	case <-time.After(5 * time.Second):
		t.Fatal("travou: um comando ou um aviso saiu com o mutex preso")
	}
	if chamadas == 0 {
		t.Error("a apiFalsa não foi chamada")
	}
}

func TestSalas_Concorrencia(t *testing.T) {
	s, _, _ := novo(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			uuid := fmt.Sprintf("00000000-0000-4000-8000-%012d", i)
			part := fmt.Sprintf("%016x", i+1)
			for j := 0; j < 50; j++ {
				s.Evento(ctx(), entra(salaA, uuid, part, j%2 == 0))
				s.Estado()
				_ = s.Tirar(ctx(), salaA, part)
				s.Evento(ctx(), sai(salaA, uuid))
			}
		}()
	}
	wg.Wait()
	if e := s.Estado(); len(e) != 1 || len(e[0].Participantes) != 0 {
		t.Errorf("Estado = %+v", e)
	}
}

// montaReconstrucao prepara um FreeSWITCH com a sala A (Ana e Carlos) e a B (Bia), e devolve as salas e a API.
func montaReconstrucao(t *testing.T) (*Salas, *apiFalsa, *avisos) {
	t.Helper()
	v := &avisos{}
	s := Nova(v.Avisar)
	a := novaAPI()
	a.respostas["conference json_list"] = listaFS(map[string][]string{
		salaA: {uuidAnaCamera, uuidCarlosCam},
		salaB: {uuidBiaCamera},
	}, []string{salaA, salaB})
	for uuid, p := range map[string]string{uuidAnaCamera: anaID, uuidCarlosCam: carlosID, uuidBiaCamera: biaID} {
		a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p
		a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = "false"
	}
	s.Ligar(a)
	return s, a, v
}

func TestSalas_Reconstruir_EventosDuranteALeitura(t *testing.T) {
	// durante roda a cada comando da reconstrução; o evento sai no último getvar, depois de tudo lido. Durante a
	// leitura, o evento não manda nenhum comando do mosaico: o estado está pela metade.
	ultimo := "uuid_getvar " + uuidBiaCamera + " starsonic_tela"
	disparar := func(t *testing.T, a *apiFalsa, s *Salas, evento esl.Evento) {
		a.durante = func() {
			cmds := a.Comandos()
			if cmds[len(cmds)-1] == ultimo {
				a.durante = nil
				s.Evento(ctx(), evento)
				for _, c := range a.Comandos()[len(cmds):] {
					if strings.Contains(c, " vid-") {
						t.Errorf("durante a leitura, o comando do mosaico %q", c)
					}
				}
			}
		}
	}
	t.Run("quem saiu durante a leitura não volta", func(t *testing.T) {
		s, a, _ := montaReconstrucao(t)
		disparar(t, a, s, sai(salaA, uuidCarlosCam))
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{
			{Sala: salaA, Participantes: []Participante{{anaID, false}}},
			{Sala: salaB, Participantes: []Participante{{biaID, false}}},
		}
		if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
	})
	t.Run("a sala que acabou durante a leitura não volta, e o acabou vem uma vez", func(t *testing.T) {
		s, a, v := montaReconstrucao(t)
		disparar(t, a, s, acaba(salaB))
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {carlosID, false}}}}
		if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
		if got := v.Lista(); !reflect.DeepEqual(got, []Aviso{{Tipo: "acabou", Sala: salaB}}) {
			t.Errorf("avisos = %+v, want um só acabou", got)
		}
	})
	t.Run("quem entrou durante a leitura fica", func(t *testing.T) {
		s, a, _ := montaReconstrucao(t)
		disparar(t, a, s, entra(salaA, uuidAnaTela, anaID, true))
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{
			{Sala: salaA, Participantes: []Participante{{anaID, false}, {anaID, true}, {carlosID, false}}},
			{Sala: salaB, Participantes: []Participante{{biaID, false}}},
		}
		if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
	})
	t.Run("um Esvaziar durante a leitura deixa o estado vazio", func(t *testing.T) {
		s, a, _ := montaReconstrucao(t)
		a.durante = func() {
			cmds := a.Comandos()
			if cmds[len(cmds)-1] == ultimo {
				a.durante = nil
				s.Esvaziar()
			}
		}
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		if got := s.Estado(); len(got) != 0 {
			t.Errorf("Estado = %+v, want vazio", got)
		}
	})
	t.Run("o que acabou antes de uma reconstrução nova pode voltar nela", func(t *testing.T) {
		s, a, _ := montaReconstrucao(t)
		disparar(t, a, s, acaba(salaB))
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		if got := s.Estado(); len(got) != 2 {
			t.Errorf("Estado = %+v, want as duas salas da segunda leitura", got)
		}
	})
}

// Cada pessoa ganha a menor célula livre quando entra, e o agente a reserva para ela no FreeSWITCH. O palco sai
// depois do entrou.
func TestSalas_Celulas(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	if got, want := a.Comandos(), []string{salaACmd + "vid-res-id 1 c1 force"}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos da Ana = %q, want %q", got, want)
	}
	want := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}
	if got := v.Lista(); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos da Ana = %+v\nwant %+v", got, want)
	}

	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	if got, want := a.Comandos(), []string{salaACmd + "vid-res-id 2 c2 force"}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos do Carlos = %q, want %q", got, want)
	}
	want = append(want, Aviso{Tipo: "entrou", Sala: salaA, Participante: carlosID},
		avisoPalco(palco(1920, 1080, c4(anaID, 1), c4(carlosID, 2))))
	if got := v.Lista(); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos do Carlos = %+v\nwant %+v", got, want)
	}
}

// entramQuatro põe a Ana, o Carlos, a Bia e o Davi na sala A, nessa ordem: as células 1 a 4.
func entramQuatro(s *Salas) {
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), entra(salaA, uuidDaviCamera, daviID, false))
}

// A quinta pessoa não cabe na grade de 4: o tamanho e o layout mudam antes da reserva dela.
func TestSalas_CincoPessoas(t *testing.T) {
	s, a, v := novo(t)
	entramQuatro(s)
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidMariaCam, mariaID, false))
	want := []string{salaACmd + "vid-res 1920x1086", salaACmd + "vid-layout starsonic-9", salaACmd + "vid-res-id 5 c5 force"}
	if got := a.Comandos(); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
	lista := v.Lista()
	p := palco(1920, 1086, c9(anaID, 1), c9(carlosID, 2), c9(biaID, 3), c9(daviID, 4), c9(mariaID, 5))
	if got := lista[len(lista)-1]; !reflect.DeepEqual(got, avisoPalco(p)) {
		t.Errorf("o último aviso = %+v, want o palco %+v", got, p)
	}
}

// Quem sai solta a célula: o palco sai sem ele, sem comando nenhum (os outros ficam onde estão), e quem entra depois
// ganha a célula que vagou.
func TestSalas_QuemSaiSoltaACelula(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
	a.Limpar()
	antes := len(v.Lista())
	s.Evento(ctx(), sai(salaA, uuidCarlosCam))
	if got := a.Comandos(); len(got) != 0 {
		t.Errorf("a saída do Carlos mandou %q, want nada", got)
	}
	want := []Aviso{{Tipo: "saiu", Sala: salaA, Participante: carlosID}, avisoPalco(palco(1920, 1080, c4(anaID, 1), c4(biaID, 3)))}
	if got := v.Lista()[antes:]; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v\nwant %+v", got, want)
	}
	s.Evento(ctx(), entra(salaA, uuidDaviCamera, daviID, false))
	if got, want := a.Comandos(), []string{salaACmd + "vid-res-id 4 c2 force"}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos do Davi = %q, want %q", got, want)
	}
}

// P5: quando a última ligação sai, a sala não é arrumada: nenhum comando e nenhum palco, só o saiu de hoje. O acabou
// do FreeSWITCH vem depois.
func TestSalas_UltimaSaiSemPalco(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	a.Limpar()
	antes := len(v.Lista())
	s.Evento(ctx(), sai(salaA, uuidAnaCamera))
	if got := a.Comandos(); len(got) != 0 {
		t.Errorf("a saída da última mandou %q, want nada", got)
	}
	if got, want := v.Lista()[antes:], []Aviso{{Tipo: "saiu", Sala: salaA, Participante: anaID}}; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v, want %+v", got, want)
	}
}

// conferirRegistro confere que o registro tem uma linha só, com o nome do comando, e nada da sala, dos participantes,
// dos membros nem da resposta do FreeSWITCH.
func conferirRegistro(t *testing.T, buf *strings.Builder, comando string) {
	t.Helper()
	log := buf.String()
	linhas := strings.Split(strings.TrimSpace(log), "\n")
	if len(linhas) != 1 || !strings.Contains(linhas[0], comando) {
		t.Errorf("o registro = %q, want uma linha com %s", log, comando)
	}
	for _, proibido := range []string{salaA, anaID, carlosID, biaID, daviID, mariaID, "membro", "Bandwidth", "sofia/", "usage", "<member_id>"} {
		if strings.Contains(log, proibido) {
			t.Errorf("o registro tem %q: %q", proibido, log)
		}
	}
}

// O vid-layout recusado: o arrumar para ali, sem a reserva e sem o palco, e escreve uma linha no registro, só com o
// nome do comando. O layout fica desconhecido, e a entrada seguinte manda o tamanho e o layout de novo.
func TestSalas_ComandoRecusado(t *testing.T) {
	s, a, v := novo(t)
	entramQuatro(s)
	buf := registro(t)
	a.erros[salaACmd+"vid-layout starsonic-9"] = &esl.ErroFS{Motivo: "Conference " + salaA + " sem o layout"}
	a.Limpar()
	antes := len(v.Lista())
	s.Evento(ctx(), entra(salaA, uuidMariaCam, mariaID, false))
	if got, want := a.Comandos(), []string{salaACmd + "vid-res 1920x1086", salaACmd + "vid-layout starsonic-9"}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
	if got, want := v.Lista()[antes:], []Aviso{{Tipo: "entrou", Sala: salaA, Participante: mariaID}}; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v, want só o entrou (sem palco)", got)
	}
	conferirRegistro(t, buf, "vid-layout")

	// O FreeSWITCH volta a aceitar: a próxima entrada (a câmera nova da Ana) manda tudo o que faltou.
	delete(a.erros, salaACmd+"vid-layout starsonic-9")
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidAnaCamera2, anaID, false))
	want := []string{salaACmd + "vid-res 1920x1086", salaACmd + "vid-layout starsonic-9", salaACmd + "vid-res-id 5 c5 force",
		salaACmd + "vid-res-id 7 c1 force", "uuid_kill " + uuidAnaCamera}
	if got := a.Comandos(); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos da entrada seguinte = %q\nwant %q", got, want)
	}
	lista := v.Lista()
	p := palco(1920, 1086, c9(anaID, 1), c9(carlosID, 2), c9(biaID, 3), c9(daviID, 4), c9(mariaID, 5))
	if got := lista[len(lista)-1]; !reflect.DeepEqual(got, avisoPalco(p)) {
		t.Errorf("o último aviso = %+v, want o palco %+v", got, p)
	}
}

// O vid-res-id sem o +OK (a resposta vazia, a de um membro sem vídeo): o palco sai assim mesmo, e a entrada seguinte
// manda a reserva de novo.
func TestSalas_ReservaRecusada(t *testing.T) {
	s, a, v := novo(t)
	buf := registro(t)
	a.respostas[salaACmd+"vid-res-id 1 c1 force"] = ""
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	want := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}
	if got := v.Lista(); !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v\nwant %+v", got, want)
	}
	conferirRegistro(t, buf, "vid-res-id")

	delete(a.respostas, salaACmd+"vid-res-id 1 c1 force")
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	if got, want := a.Comandos(), []string{salaACmd + "vid-res-id 1 c1 force", salaACmd + "vid-res-id 2 c2 force"}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
}

// O vid-bandwidth que muda a banda dos membros mas não a do mosaico termina com o -ERR: ele não deu certo. O palco sai
// (o layout foi aceito), e a mudança seguinte da sala manda a banda de novo.
func TestSalas_BandaRecusada(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	buf := registro(t)
	a.respostas[salaACmd+"vid-bandwidth 4mb '' 1"] = "+OK Set Bandwidth 4096 kps for member x\n-ERR Bandwidth not set\n"
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	lista := v.Lista()
	p := palco(1920, 1620, telaAp2(anaID), ap2(anaID, 1), ap2(carlosID, 2))
	if got := lista[len(lista)-1]; !reflect.DeepEqual(got, avisoPalco(p)) {
		t.Errorf("o último aviso = %+v, want o palco %+v", got, p)
	}
	conferirRegistro(t, buf, "vid-bandwidth")

	delete(a.respostas, salaACmd+"vid-bandwidth 4mb '' 1")
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
	want := []string{salaACmd + "vid-res 1920x1350", salaACmd + "vid-layout starsonic-apresentacao-4",
		salaACmd + "vid-res-id 3 c3 force", salaACmd + "vid-bandwidth 4mb '' 1"}
	if got := a.Comandos(); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q\nwant %q", got, want)
	}
}

// O <membro> vai no vid-res-id: o add-member sem ele, ou com um que não é só de dígitos (de 1 a 10), fica fora da sala,
// como o de um uuid que não vale.
func TestSalas_MembroQueNaoVale(t *testing.T) {
	for _, membro := range []string{"", "1 2", "abc", "-1", "1.5", "12345678901", "1\n2", "০১"} {
		t.Run(fmt.Sprintf("%q", membro), func(t *testing.T) {
			s, a, v := novo(t)
			ev := entra(salaA, uuidAnaCamera, anaID, false)
			if membro == "" {
				delete(ev, "Member-ID")
			} else {
				ev["Member-ID"] = membro
			}
			s.Evento(ctx(), ev)
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("Estado = %+v, want vazio", got)
			}
			if got := v.Lista(); len(got) != 0 {
				t.Errorf("avisos = %+v, want nenhum", got)
			}
			if got := a.Comandos(); len(got) != 0 {
				t.Errorf("comandos = %q, want nenhum", got)
			}
		})
	}
	t.Run("o de dez dígitos vale", func(t *testing.T) {
		s, a, _ := novo(t)
		ev := entra(salaA, uuidAnaCamera, anaID, false)
		ev["Member-ID"] = "1234567890"
		s.Evento(ctx(), ev)
		if got, want := a.Comandos(), []string{salaACmd + "vid-res-id 1234567890 c1 force"}; !reflect.DeepEqual(got, want) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
	})
	t.Run("no json_list, o membro sem id fica de fora", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.respostas["conference json_list"] = `[{"conference_name":"` + salaA + `","members":[` +
			`{"uuid":"` + uuidAnaCamera + `"},{"id":"1 2","uuid":"` + uuidCarlosCam + `"},{"id":3,"uuid":"` + uuidBiaCamera + `"}]}]`
		for uuid, p := range map[string]string{uuidAnaCamera: anaID, uuidCarlosCam: carlosID, uuidBiaCamera: biaID} {
			a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p
			a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = "false"
		}
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{{Sala: salaA, Participantes: []Participante{{biaID, false}}}}
		if got := semOPalco(s.Estado()); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
	})
}

// O Estado leva o último palco avisado de cada sala. Nada do mosaico de uma sala sobrevive ao fim dela, nem ao
// Esvaziar: a sala que começa de novo avisa o palco de novo, mesmo igual ao de antes.
func TestSalas_Estado_ComOPalco(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	b, _ := json.Marshal(s.Estado())
	quadro := func(p string) string {
		return fmt.Sprintf(`{"largura":1920,"altura":1080,"quadros":[{"participante":%q,"tela":false,"x":0,"y":0,"l":960,"a":540}]}`, p)
	}
	want := fmt.Sprintf(`[{"sala":%q,"participantes":[{"participante":%q,"tela":false}],"palco":%s},{"sala":%q,"participantes":[{"participante":%q,"tela":false}],"palco":%s}]`,
		salaA, anaID, quadro(anaID), salaB, biaID, quadro(biaID))
	if string(b) != want {
		t.Errorf("JSON =\n%s\nwant\n%s", b, want)
	}

	s.Evento(ctx(), acaba(salaA))
	if got, want := s.Estado(), []Sala{{Sala: salaB, Participantes: []Participante{{biaID, false}}, Palco: palco(1920, 1080, c4(biaID, 1))}}; !reflect.DeepEqual(got, want) {
		t.Errorf("Estado depois do acabou = %+v, want %+v", got, want)
	}
	antes := len(v.Lista())
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	if got, want := v.Lista()[antes:], []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}; !reflect.DeepEqual(got, want) {
		t.Errorf("a sala que começou de novo: avisos = %+v\nwant %+v", got, want)
	}

	s.Esvaziar()
	if got := s.Estado(); len(got) != 0 {
		t.Errorf("Estado depois do Esvaziar = %+v, want vazio", got)
	}
	antes = len(v.Lista())
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	if got, want := v.Lista()[antes:], []Aviso{{Tipo: "entrou", Sala: salaA, Participante: anaID}, avisoPalco(palco(1920, 1080, c4(anaID, 1)))}; !reflect.DeepEqual(got, want) {
		t.Errorf("depois do Esvaziar: avisos = %+v\nwant %+v", got, want)
	}
}

// O Reconstruir, depois da leitura, arruma cada sala do começo, com os quatro tipos de comando: as células vão pelo
// menor <membro> de cada um. Ele não avisa nada, e o Estado leva o palco.
func TestSalas_Reconstruir_PoeTodosNoLugar(t *testing.T) {
	v := &avisos{}
	s := Nova(v.Avisar)
	a := novaAPI()
	a.respostas["conference json_list"] = `[{"conference_name":"` + salaA + `","members":[` +
		`{"id":4,"uuid":"` + uuidAnaCamera + `"},{"id":9,"uuid":"` + uuidCarlosCam + `"},{"id":2,"uuid":"` + uuidBiaCamera + `"}]}]`
	for uuid, p := range map[string]string{uuidAnaCamera: anaID, uuidCarlosCam: carlosID, uuidBiaCamera: biaID} {
		a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p
		a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = "false"
	}
	s.Ligar(a)
	if err := s.Reconstruir(ctx()); err != nil {
		t.Fatal(err)
	}
	cmds := a.Comandos()
	if len(cmds) < 7 {
		t.Fatalf("comandos = %q", cmds)
	}
	want := []string{salaACmd + "vid-res 1920x1080", salaACmd + "vid-layout starsonic-4", salaACmd + "vid-res-id 2 c1 force",
		salaACmd + "vid-res-id 4 c2 force", salaACmd + "vid-res-id 9 c3 force", salaACmd + "vid-bandwidth 3mb '' 1"}
	if got := cmds[7:]; !reflect.DeepEqual(got, want) {
		t.Errorf("os comandos depois da leitura = %q\nwant %q", got, want)
	}
	if got := v.Lista(); len(got) != 0 {
		t.Errorf("avisos = %+v, want nenhum", got)
	}
	wantEstado := []Sala{{Sala: salaA,
		Participantes: []Participante{{anaID, false}, {biaID, false}, {carlosID, false}},
		Palco:         palco(1920, 1080, c4(biaID, 1), c4(anaID, 2), c4(carlosID, 3))}}
	if got := s.Estado(); !reflect.DeepEqual(got, wantEstado) {
		t.Errorf("Estado = %+v\nwant %+v", got, wantEstado)
	}
}

// P24: quando a última principal de quem apresenta sai, a tela dela cai, e o mosaico vai direto para a grade de quem
// ficou: a tela sem a principal fica fora do arrumar, como no entrou. Os comandos saem com o uuid_kill primeiro, como
// hoje, e depois uma mudança só, com um palco só, sem a Ana e sem a tela. O del-member da tela não muda mais nada.
func TestSalas_ApresentadorSai(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	lista := v.Lista()
	ap4 := func(p string, celula int) mosaico.Quadro { return cam(p, (celula-1)*480, 1080, 480, 270) }
	if got, want := lista[len(lista)-1], avisoPalco(palco(1920, 1350, tela(anaID, 0, 0, 1920, 1080), ap4(anaID, 1), ap4(carlosID, 2), ap4(biaID, 3))); !reflect.DeepEqual(got, want) {
		t.Fatalf("o preparo: o último aviso = %+v, want %+v", got, want)
	}

	a.Limpar()
	antes := len(v.Lista())
	s.Evento(ctx(), sai(salaA, uuidAnaCamera))
	want := []string{"uuid_kill " + uuidAnaTela,
		salaACmd + "vid-res 1920x1080", salaACmd + "vid-layout starsonic-4", salaACmd + "vid-bandwidth 3mb '' 1"}
	if got := a.Comandos(); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q\nwant %q", got, want)
	}
	wantAvisos := []Aviso{{Tipo: "saiu", Sala: salaA, Participante: anaID},
		avisoPalco(palco(1920, 1080, c4(carlosID, 2), c4(biaID, 3)))}
	if got := v.Lista()[antes:]; !reflect.DeepEqual(got, wantAvisos) {
		t.Errorf("avisos = %+v\nwant %+v", got, wantAvisos)
	}

	// O FreeSWITCH avisa que a tela saiu: só o saiu dela, sem comando e sem palco.
	a.Limpar()
	antes = len(v.Lista())
	s.Evento(ctx(), sai(salaA, uuidAnaTela))
	if got := a.Comandos(); len(got) != 0 {
		t.Errorf("a saída da tela mandou %q, want nada", got)
	}
	if got, want := v.Lista()[antes:], []Aviso{{Tipo: "saiu", Sala: salaA, Participante: anaID, Tela: true}}; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos da saída da tela = %+v, want %+v", got, want)
	}
}

// P5 com P24: quem apresentava sozinha sai, e na sala fica só a tela dela, que cai. Sem ninguém para mostrar, a sala não
// é arrumada: só o uuid_kill da tela, e nenhum palco.
func TestSalas_ApresentadoraSozinhaSai(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	a.Limpar()
	antes := len(v.Lista())
	s.Evento(ctx(), sai(salaA, uuidAnaCamera))
	s.Evento(ctx(), sai(salaA, uuidAnaTela))
	if got, want := a.Comandos(), []string{"uuid_kill " + uuidAnaTela}; !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q, want %q", got, want)
	}
	want := []Aviso{{Tipo: "saiu", Sala: salaA, Participante: anaID}, {Tipo: "saiu", Sala: salaA, Participante: anaID, Tela: true}}
	if got := v.Lista()[antes:]; !reflect.DeepEqual(got, want) {
		t.Errorf("avisos = %+v, want %+v", got, want)
	}
}

// naoAchou é a resposta do FreeSWITCH a um comando de uma conferência que não existe mais (conference_api.c).
func naoAchou(sala string) error { return &esl.ErroFS{Motivo: "Conference " + sala + " not found"} }

// permutacoes são todas as ordens dos uuids.
func permutacoes(uuids []string) [][]string {
	if len(uuids) <= 1 {
		return [][]string{append([]string(nil), uuids...)}
	}
	var saida [][]string
	for i := range uuids {
		resto := append(append([]string(nil), uuids[:i]...), uuids[i+1:]...)
		for _, p := range permutacoes(resto) {
			saida = append(saida, append([]string{uuids[i]}, p...))
		}
	}
	return saida
}

// semAvisoDePalco confere que nenhum dos avisos é um palco.
func semAvisoDePalco(t *testing.T, lista []Aviso) {
	t.Helper()
	for _, a := range lista {
		if a.Tipo == "palco" {
			t.Errorf("um palco foi avisado com a sala acabando: %+v", a)
		}
	}
}

// rodarComPrazo roda f e falha se ela não termina em 5 s (um arrumar travado).
func rodarComPrazo(t *testing.T, f func()) {
	t.Helper()
	pronto := make(chan struct{})
	go func() {
		defer close(pronto)
		f()
	}()
	select {
	case <-pronto:
	case <-time.After(5 * time.Second):
		t.Fatal("as saídas não terminaram: o arrumar travou")
	}
}

// I1: a reunião acaba para todos de uma vez (o Encerrar com a tela no ar). A conferência some do FreeSWITCH antes dos
// del-member, e cada comando do mosaico responde que ela não existe: nada vai ao registro, nenhum palco sai depois, e
// as saídas terminam, em qualquer ordem.
func TestSalas_FimDaSalaSemAviso(t *testing.T) {
	saidas := []string{uuidAnaCamera, uuidCarlosCam, uuidBiaCamera, uuidAnaTela}
	for _, ordem := range permutacoes(saidas) {
		var nome []string
		for _, u := range ordem {
			nome = append(nome, u[len(u)-2:])
		}
		t.Run(strings.Join(nome, ","), func(t *testing.T) {
			s, a, v := novo(t)
			s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
			s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
			s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
			s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
			buf := registro(t)
			a.Limpar()
			a.responder = func(c string) (string, error, bool) {
				if strings.HasPrefix(c, salaACmd) {
					return "", naoAchou(salaA), true
				}
				return "", nil, false
			}
			antes := len(v.Lista())
			rodarComPrazo(t, func() {
				for _, u := range ordem {
					s.Evento(ctx(), sai(salaA, u))
				}
				s.Evento(ctx(), acaba(salaA))
			})
			if len(mosaicoDaSalaA(a.Comandos())) == 0 {
				t.Fatalf("nenhum comando do mosaico foi mandado: %q", a.Comandos())
			}
			if log := buf.String(); log != "" {
				t.Errorf("o registro = %q, want vazio", log)
			}
			semAvisoDePalco(t, v.Lista()[antes:])
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("o estado = %+v, want vazio", got)
			}
		})
	}

	// A conferência some no meio de um arrumar: o tamanho e o layout passaram antes, a reserva não. Nada vai ao
	// registro, e o palco não sai.
	t.Run("no meio do arrumar", func(t *testing.T) {
		s, a, v := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
		s.Evento(ctx(), entra(salaA, uuidBiaCamera, biaID, false))
		s.Evento(ctx(), entra(salaA, uuidDaviCamera, daviID, false))
		buf := registro(t)
		a.Limpar()
		a.erros[salaACmd+"vid-res-id 5 c5 force"] = naoAchou(salaA)
		antes := len(v.Lista())
		s.Evento(ctx(), entra(salaA, uuidMariaCam, mariaID, false))
		want := []string{salaACmd + "vid-res 1920x1086", salaACmd + "vid-layout starsonic-9", salaACmd + "vid-res-id 5 c5 force"}
		if got := a.Comandos(); !reflect.DeepEqual(got, want) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
		if log := buf.String(); log != "" {
			t.Errorf("o registro = %q, want vazio", log)
		}
		if got, want := v.Lista()[antes:], []Aviso{{Tipo: "entrou", Sala: salaA, Participante: mariaID}}; !reflect.DeepEqual(got, want) {
			t.Errorf("avisos = %+v, want só o entrou (sem palco)", got)
		}
	})
}

// O vid-res-id de um membro que já saiu do FreeSWITCH responde a linha de uso (o del-member dele já está na fila): nada
// vai ao registro. O resto do arrumar segue, e a reserva fica desconhecida, como numa recusa: a mudança seguinte a manda
// de novo.
func TestSalas_MembroQueJaSaiu(t *testing.T) {
	s, a, v := novo(t)
	entramQuatro(s)
	buf := registro(t)
	a.respostas[salaACmd+"vid-res-id 2 c2 force"] = "vid-res-id <member_id>|all <val>|clear [force]"
	a.Limpar()
	antes := len(v.Lista())
	s.arrumar(ctx(), salaA, true, true)
	want := []string{"vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 1 c1 force", "vid-res-id 2 c2 force",
		"vid-res-id 3 c3 force", "vid-res-id 4 c4 force", "vid-bandwidth 3mb '' 1"}
	if got := mosaicoDaSalaA(a.Comandos()); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos = %q\nwant %q", got, want)
	}
	if log := buf.String(); log != "" {
		t.Errorf("o registro = %q, want vazio", log)
	}
	if got := v.Lista()[antes:]; len(got) != 0 {
		t.Errorf("avisos = %+v, want nenhum (o palco não mudou)", got)
	}

	// A mudança seguinte manda a reserva do Carlos de novo, e o palco sai.
	delete(a.respostas, salaACmd+"vid-res-id 2 c2 force")
	a.Limpar()
	antes = len(v.Lista())
	s.Evento(ctx(), entra(salaA, uuidMariaCam, mariaID, false))
	want = []string{"vid-res 1920x1086", "vid-layout starsonic-9", "vid-res-id 2 c2 force", "vid-res-id 5 c5 force"}
	if got := mosaicoDaSalaA(a.Comandos()); !reflect.DeepEqual(got, want) {
		t.Errorf("comandos da entrada seguinte = %q\nwant %q", got, want)
	}
	p := palco(1920, 1086, c9(anaID, 1), c9(carlosID, 2), c9(biaID, 3), c9(daviID, 4), c9(mariaID, 5))
	wantAvisos := []Aviso{{Tipo: "entrou", Sala: salaA, Participante: mariaID}, avisoPalco(p)}
	if got := v.Lista()[antes:]; !reflect.DeepEqual(got, wantAvisos) {
		t.Errorf("avisos = %+v\nwant %+v", got, wantAvisos)
	}
	if log := buf.String(); log != "" {
		t.Errorf("o registro = %q, want vazio", log)
	}
}

// O ESL cai no meio de um arrumar, ou o contexto acaba: a ligação sumiu, não o FreeSWITCH recusou. Nada vai ao
// registro, o arrumar para ali, e o palco não sai (o Esvaziar ou a reconexão vêm depois).
func TestSalas_SemLigacaoNoMeio(t *testing.T) {
	casos := []struct {
		nome    string
		comando string // o que responde o erro
		err     error
		want    []string
	}{
		{"o ESL cai no vid-layout", "vid-layout starsonic-9", esl.ErrDesligado, []string{"vid-res 1920x1086", "vid-layout starsonic-9"}},
		{"o ESL cai no vid-res-id", "vid-res-id 5 c5 force", esl.ErrDesligado, []string{"vid-res 1920x1086", "vid-layout starsonic-9", "vid-res-id 5 c5 force"}},
		{"o contexto acaba", "vid-res 1920x1086", context.Canceled, []string{"vid-res 1920x1086"}},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			s, a, v := novo(t)
			entramQuatro(s)
			buf := registro(t)
			c := ctx()
			if caso.err == context.Canceled {
				var cancelar context.CancelFunc
				c, cancelar = context.WithCancel(ctx())
				cancelar()
			}
			a.erros[salaACmd+caso.comando] = caso.err
			a.Limpar()
			antes := len(v.Lista())
			s.Evento(c, entra(salaA, uuidMariaCam, mariaID, false))
			if got := mosaicoDaSalaA(a.Comandos()); !reflect.DeepEqual(got, caso.want) {
				t.Errorf("comandos = %q, want %q", got, caso.want)
			}
			if log := buf.String(); log != "" {
				t.Errorf("o registro = %q, want vazio", log)
			}
			if got, want := v.Lista()[antes:], []Aviso{{Tipo: "entrou", Sala: salaA, Participante: mariaID}}; !reflect.DeepEqual(got, want) {
				t.Errorf("avisos = %+v, want só o entrou (sem palco)", got)
			}
		})
	}
}

// Uma recusa de verdade, com a sala viva, continua no registro, numa linha só com o nome do comando: nem a sala, nem
// os participantes, nem os membros, nem a resposta do FreeSWITCH.
func TestSalas_RecusaDeVerdade(t *testing.T) {
	casos := []struct {
		nome, comando, texto string
		err                  error
	}{
		{"o vid-res com outro -ERR", "vid-res 1920x1086", "vid-res",
			&esl.ErroFS{Motivo: "Conference " + salaA + " membro 4 " + daviID + " sofia/x usage <member_id>"}},
		{"o vid-res-id sem mosaico", "vid-res-id 5 c5 force", "vid-res-id",
			&esl.ErroFS{Motivo: "conference is not in mixing mode"}},
		{"o vid-res-id de outra sala que não existe", "vid-res-id 5 c5 force", "vid-res-id",
			&esl.ErroFS{Motivo: "Conference " + salaB + " not found"}},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			s, a, _ := novo(t)
			entramQuatro(s)
			buf := registro(t)
			a.erros[salaACmd+caso.comando] = caso.err
			s.Evento(ctx(), entra(salaA, uuidMariaCam, mariaID, false))
			conferirRegistro(t, buf, "comando="+caso.texto)
			log := buf.String()
			if !strings.HasSuffix(strings.TrimSpace(log), "comando="+caso.texto) {
				t.Errorf("o registro = %q, want a linha do %s", log, caso.texto)
			}
			for _, proibido := range []string{caso.err.(*esl.ErroFS).Motivo, salaB, "mixing", "not found"} {
				if strings.Contains(log, proibido) {
					t.Errorf("o registro tem %q: %q", proibido, log)
				}
			}
		})
	}
}
