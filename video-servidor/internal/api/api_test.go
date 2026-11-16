package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/salas"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/uso"
)

const (
	chaveTeste = "chave-de-teste-ana"
	salaA      = "0123456789abcdef0123456789abcdef"
	partA      = "fedcba9876543210"
)

type salasFalsas struct {
	mu       sync.Mutex
	estado   []salas.Sala
	err      error
	tirou    []string
	encerrou []string
}

func (s *salasFalsas) Estado() []salas.Sala {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.estado
}

func (s *salasFalsas) Tirar(_ context.Context, sala, participante string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tirou = append(s.tirou, sala+"/"+participante)
	return s.err
}

func (s *salasFalsas) Encerrar(_ context.Context, sala string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.encerrou = append(s.encerrou, sala)
	return s.err
}

func (s *salasFalsas) definirErro(err error) {
	s.mu.Lock()
	s.err = err
	s.mu.Unlock()
}

func novaAPI(t *testing.T, s Salas, noAr func() bool, mudar func(*Deps)) *API {
	t.Helper()
	if noAr == nil {
		noAr = func() bool { return true }
	}
	d := Deps{
		Chave:  chaveTeste,
		Salas:  s,
		NoAr:   noAr,
		Uso:    func() uso.Uso { return uso.Uso{CPU: 34, Memoria: 41} },
		Versao: "0.1.0",
		Agora:  func() time.Time { return time.UnixMilli(1794495600000) },
		Pulso:  time.Hour,
	}
	if mudar != nil {
		mudar(&d)
	}
	a := Novo(d)
	t.Cleanup(a.Fechar)
	return a
}

func pedir(a *API, metodo, caminho, chave string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, caminho, nil)
	if chave != "" {
		r.Header.Set("Authorization", "Bearer "+chave)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}

func erroDe(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var v map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("o corpo %q não é JSON: %v", w.Body.String(), err)
	}
	return v["erro"]
}

func TestSaude(t *testing.T) {
	a := novaAPI(t, &salasFalsas{}, nil, nil)
	w := pedir(a, "GET", "/agente/v1/saude", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"ok":true}` {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
}

func TestChave(t *testing.T) {
	a := novaAPI(t, &salasFalsas{}, nil, nil)
	rotas := [][2]string{
		{"GET", "/agente/v1/estado"},
		{"GET", "/agente/v1/eventos"},
		{"POST", "/agente/v1/salas/" + salaA + "/participantes/" + partA + "/tirar"},
		{"POST", "/agente/v1/salas/" + salaA + "/encerrar"},
	}
	for _, rota := range rotas {
		for _, chave := range []string{"", "outra-chave", chaveTeste + "x", chaveTeste[:5]} {
			w := pedir(a, rota[0], rota[1], chave)
			if w.Code != 401 || erroDe(t, w) != "chave" {
				t.Errorf("%s %s com %q: %d %s", rota[0], rota[1], chave, w.Code, w.Body)
			}
		}
	}
	// Sem o esquema Bearer também não vale.
	r := httptest.NewRequest("GET", "/agente/v1/estado", nil)
	r.Header.Set("Authorization", chaveTeste)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Errorf("a chave sem o Bearer deu %d", w.Code)
	}
	// Uma chave vazia na configuração não abre nada.
	vazia := novaAPI(t, &salasFalsas{}, nil, func(d *Deps) { d.Chave = "" })
	if w := pedir(vazia, "GET", "/agente/v1/estado", ""); w.Code != 401 {
		t.Errorf("com a chave vazia, %d", w.Code)
	}
	// E a chave certa passa.
	if w := pedir(a, "GET", "/agente/v1/estado", chaveTeste); w.Code != 200 {
		t.Errorf("a chave certa deu %d", w.Code)
	}
}

func TestEstado(t *testing.T) {
	s := &salasFalsas{estado: []salas.Sala{{Sala: salaA, Participantes: []salas.Participante{
		{Participante: partA, Tela: false}, {Participante: "1111111111111111", Tela: true}}}}}
	var no atomic.Bool
	no.Store(true)
	a := novaAPI(t, s, no.Load, nil)

	w := pedir(a, "GET", "/agente/v1/estado", chaveTeste)
	if w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("%d %s", w.Code, w.Header().Get("Content-Type"))
	}
	var v struct {
		Versao     string       `json:"versao"`
		FreeSWITCH bool         `json:"freeswitch"`
		Agora      int64        `json:"agora"`
		Salas      []salas.Sala `json:"salas"`
		Uso        uso.Uso      `json:"uso"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	if v.Versao != "0.1.0" || !v.FreeSWITCH || v.Agora != 1794495600000 || v.Uso != (uso.Uso{CPU: 34, Memoria: 41}) {
		t.Fatalf("%+v", v)
	}
	if len(v.Salas) != 1 || v.Salas[0].Sala != salaA || len(v.Salas[0].Participantes) != 2 || !v.Salas[0].Participantes[1].Tela {
		t.Fatalf("salas: %+v", v.Salas)
	}

	no.Store(false)
	s.mu.Lock()
	s.estado = nil
	s.mu.Unlock()
	w = pedir(a, "GET", "/agente/v1/estado", chaveTeste)
	if !strings.Contains(w.Body.String(), `"freeswitch":false`) || !strings.Contains(w.Body.String(), `"salas":[]`) {
		t.Fatalf("sem o FreeSWITCH: %s", w.Body)
	}
}

func TestTirarEncerrar(t *testing.T) {
	tirar := "/agente/v1/salas/" + salaA + "/participantes/" + partA + "/tirar"
	encerrar := "/agente/v1/salas/" + salaA + "/encerrar"

	t.Run("chegaAsSalas", func(t *testing.T) {
		s := &salasFalsas{}
		a := novaAPI(t, s, nil, nil)
		if w := pedir(a, "POST", tirar, chaveTeste); w.Code != 204 || w.Body.Len() != 0 {
			t.Fatalf("tirar: %d %q", w.Code, w.Body)
		}
		if w := pedir(a, "POST", encerrar, chaveTeste); w.Code != 204 {
			t.Fatalf("encerrar: %d", w.Code)
		}
		if len(s.tirou) != 1 || s.tirou[0] != salaA+"/"+partA || len(s.encerrou) != 1 || s.encerrou[0] != salaA {
			t.Fatalf("tirou %v, encerrou %v", s.tirou, s.encerrou)
		}
	})

	t.Run("erros", func(t *testing.T) {
		casos := []struct {
			err    error
			status int
			codigo string
		}{
			{salas.ErrNaoEncontrado, 404, "naoEncontrado"},
			{fmt.Errorf("ruim: %w", salas.ErrNaoEncontrado), 404, "naoEncontrado"},
			{salas.ErrSemFreeSWITCH, 503, "freeswitch"},
			{&esl.ErroFS{Motivo: "algo deu errado"}, 500, "interno"},
			{errors.New("qualquer outro"), 500, "interno"},
		}
		for _, c := range casos {
			s := &salasFalsas{err: c.err}
			a := novaAPI(t, s, nil, nil)
			for _, caminho := range []string{tirar, encerrar} {
				w := pedir(a, "POST", caminho, chaveTeste)
				if w.Code != c.status || erroDe(t, w) != c.codigo {
					t.Errorf("%v em %s: %d %s", c.err, caminho, w.Code, w.Body)
				}
			}
		}
	})

	t.Run("invalido", func(t *testing.T) {
		s := &salasFalsas{}
		a := novaAPI(t, s, nil, nil)
		maus := []string{
			"/agente/v1/salas/" + salaA + "0/participantes/" + partA + "/tirar", // 33
			"/agente/v1/salas/" + salaA[:31] + "/participantes/" + partA + "/tirar",
			"/agente/v1/salas/" + strings.ToUpper(salaA) + "/participantes/" + partA + "/tirar",
			"/agente/v1/salas/" + salaA + "/participantes/" + strings.ToUpper(partA) + "/tirar",
			"/agente/v1/salas/" + salaA + "/participantes/" + partA + "0/tirar",
			"/agente/v1/salas/" + salaA + "/participantes/fedcba987654321g/tirar",
			"/agente/v1/salas/" + salaA + "0/encerrar",
			"/agente/v1/salas/" + strings.ToUpper(salaA) + "/encerrar",
			"/agente/v1/salas/zzzz/encerrar",
		}
		for _, caminho := range maus {
			w := pedir(a, "POST", caminho, chaveTeste)
			if w.Code != 400 || erroDe(t, w) != "invalido" {
				t.Errorf("%s: %d %s", caminho, w.Code, w.Body)
			}
		}
		if len(s.tirou)+len(s.encerrou) != 0 {
			t.Fatalf("um pedido inválido chegou às salas: %v %v", s.tirou, s.encerrou)
		}
	})

	t.Run("chaveAntesDoInvalido", func(t *testing.T) {
		a := novaAPI(t, &salasFalsas{}, nil, nil)
		if w := pedir(a, "POST", "/agente/v1/salas/zzzz/encerrar", ""); w.Code != 401 {
			t.Fatalf("%d", w.Code)
		}
	})
}

// cliente é um cliente dos eventos, por um servidor de verdade.
type leitor struct {
	resp *http.Response
	r    *bufio.Reader
}

// servidorDe sobe a API num servidor de verdade. No fim, o Fechar solta os eventos antes do Close esperar por eles.
func servidorDe(t *testing.T, a *API) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(a)
	t.Cleanup(func() { a.Fechar(); srv.Close() })
	return srv
}

func conectar(t *testing.T, url string) *leitor {
	t.Helper()
	req, _ := http.NewRequest("GET", url+"/agente/v1/eventos", nil)
	req.Header.Set("Authorization", "Bearer "+chaveTeste)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != 200 {
		t.Fatalf("eventos: %d", resp.StatusCode)
	}
	return &leitor{resp: resp, r: bufio.NewReader(resp.Body)}
}

// proximo lê um evento: a linha data: e a linha vazia depois.
func (c *leitor) proximo(t *testing.T) map[string]any {
	t.Helper()
	type r struct {
		v   map[string]any
		err error
	}
	ch := make(chan r, 1)
	go func() {
		linha, err := c.r.ReadString('\n')
		if err != nil {
			ch <- r{err: err}
			return
		}
		if !strings.HasPrefix(linha, "data: ") {
			ch <- r{err: fmt.Errorf("linha %q sem data:", linha)}
			return
		}
		vazia, err := c.r.ReadString('\n')
		if err != nil || vazia != "\n" {
			ch <- r{err: fmt.Errorf("depois do evento veio %q (%v); queria uma linha vazia", vazia, err)}
			return
		}
		var v map[string]any
		err = json.Unmarshal([]byte(strings.TrimPrefix(strings.TrimSuffix(linha, "\n"), "data: ")), &v)
		ch <- r{v: v, err: err}
	}()
	select {
	case x := <-ch:
		if x.err != nil {
			t.Fatalf("lendo o evento: %v", x.err)
		}
		return x.v
	case <-time.After(3 * time.Second):
		t.Fatal("o evento não chegou em 3 s")
		return nil
	}
}

func TestEventos_EstadoDepoisAvisos(t *testing.T) {
	s := &salasFalsas{estado: []salas.Sala{{Sala: salaA, Participantes: []salas.Participante{{Participante: partA}}}}}
	var no atomic.Bool
	no.Store(true)
	a := novaAPI(t, s, no.Load, func(d *Deps) { d.Pulso = 50 * time.Millisecond })
	srv := servidorDe(t, a)

	c := conectar(t, srv.URL)
	if ct := c.resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type %q", ct)
	}
	a.Avisar(salas.Aviso{Tipo: "entrou", Sala: salaA, Participante: "1111111111111111", Tela: true})

	ev := c.proximo(t)
	if ev["tipo"] != "estado" || ev["freeswitch"] != true || ev["agora"] != float64(1794495600000) {
		t.Fatalf("o primeiro: %v", ev)
	}
	salasJSON, _ := ev["salas"].([]any)
	if len(salasJSON) != 1 {
		t.Fatalf("salas: %v", ev["salas"])
	}
	ev = c.proximo(t)
	if ev["tipo"] != "entrou" || ev["sala"] != salaA || ev["participante"] != "1111111111111111" || ev["tela"] != true {
		t.Fatalf("o segundo: %v", ev)
	}
	ev = c.proximo(t)
	if ev["tipo"] != "relogio" || ev["agora"] != float64(1794495600000) {
		t.Fatalf("o terceiro: %v", ev)
	}

	// O acabou só leva a sala.
	a.Avisar(salas.Aviso{Tipo: "acabou", Sala: salaA})
	for {
		ev = c.proximo(t)
		if ev["tipo"] == "relogio" {
			continue
		}
		break
	}
	if ev["tipo"] != "acabou" || ev["sala"] != salaA || len(ev) != 2 {
		t.Fatalf("o acabou: %v", ev)
	}

	// Uma conexão nova, com o FreeSWITCH fora do ar: o primeiro estado diz isso.
	no.Store(false)
	c2 := conectar(t, srv.URL)
	if ev := c2.proximo(t); ev["tipo"] != "estado" || ev["freeswitch"] != false {
		t.Fatalf("sem o FreeSWITCH: %v", ev)
	}
}

// escritor é um ResponseWriter que entrega cada Write ao teste. Com bloqueia, o primeiro Write fica parado.
type escritor struct {
	h        http.Header
	escritas chan string
	libera   chan struct{} // fecha para soltar um escritor travado
	bloqueia bool
}

func novoEscritor(bloqueia bool) *escritor {
	return &escritor{h: http.Header{}, escritas: make(chan string), libera: make(chan struct{}), bloqueia: bloqueia}
}

func (e *escritor) Header() http.Header { return e.h }
func (e *escritor) WriteHeader(int)     {}
func (e *escritor) Flush()              {}
func (e *escritor) Write(b []byte) (int, error) {
	if e.bloqueia {
		<-e.libera
		return 0, io.ErrClosedPipe
	}
	select {
	case e.escritas <- string(b):
		return len(b), nil
	case <-e.libera:
		return 0, io.ErrClosedPipe
	}
}

func servirEscritor(a *API, e *escritor) (feito chan struct{}, cancelar func()) {
	ctx, cancel := context.WithCancel(context.Background())
	r := httptest.NewRequest("GET", "/agente/v1/eventos", nil).WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+chaveTeste)
	feito = make(chan struct{})
	go func() {
		defer close(feito)
		a.ServeHTTP(e, r)
	}()
	return feito, cancel
}

func (a *API) conectados() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.clientes)
}

func esperarAte(t *testing.T, o string, cond func() bool) {
	t.Helper()
	fim := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(fim) {
			t.Fatalf("não chegou: %s", o)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// Review Focus: um cliente que não lê é desligado, sem atrasar os outros. O lento tem o escritor parado (como um
// socket cheio), e a fila dele, de 16, enche. O rápido é lido a cada aviso.
func TestEventos_ClienteLento(t *testing.T) {
	a := novaAPI(t, &salasFalsas{}, nil, func(d *Deps) { d.Fila = 16 })

	lento := novoEscritor(true)
	feitoLento, _ := servirEscritor(a, lento)
	rapido := novoEscritor(false)
	feitoRapido, cancelarRapido := servirEscritor(a, rapido)
	esperarAte(t, "os dois conectados", func() bool { return a.conectados() == 2 })

	leu := func() map[string]any {
		select {
		case linha := <-rapido.escritas:
			var v map[string]any
			if err := json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(linha, "data: "), "\n\n")), &v); err != nil {
				t.Fatalf("%q: %v", linha, err)
			}
			if !strings.HasPrefix(linha, "data: ") || !strings.HasSuffix(linha, "\n\n") {
				t.Fatalf("o formato do evento: %q", linha)
			}
			return v
		case <-time.After(2 * time.Second):
			t.Fatal("o evento não chegou ao rápido em 2 s")
			return nil
		}
	}
	if ev := leu(); ev["tipo"] != "estado" {
		t.Fatalf("o primeiro: %v", ev)
	}

	const n = 2000
	var gasto time.Duration
	for i := 0; i < n; i++ {
		inicio := time.Now()
		a.Avisar(salas.Aviso{Tipo: "entrou", Sala: salaA, Participante: fmt.Sprintf("%016x", i)})
		gasto += time.Since(inicio)
		ev := leu()
		if quer := fmt.Sprintf("%016x", i); ev["tipo"] != "entrou" || ev["participante"] != quer {
			t.Fatalf("o evento %d: %v", i, ev)
		}
	}
	if gasto > time.Second {
		t.Fatalf("os %d Avisar levaram %v com um cliente lento; queria menos de 1 s", n, gasto)
	}
	if c := a.conectados(); c != 1 {
		t.Fatalf("há %d clientes; queria só o rápido", c)
	}
	// O lento, solto, termina sozinho.
	close(lento.libera)
	select {
	case <-feitoLento:
	case <-time.After(2 * time.Second):
		t.Fatal("o handler do lento não terminou")
	}
	cancelarRapido()
	close(rapido.libera)
	<-feitoRapido
	if c := a.conectados(); c != 0 {
		t.Fatalf("depois de tudo, há %d clientes", c)
	}
}

func TestEventos_Retrato(t *testing.T) {
	s := &salasFalsas{}
	var no atomic.Bool
	no.Store(true)
	a := novaAPI(t, s, no.Load, nil)
	srv := servidorDe(t, a)

	c1, c2 := conectar(t, srv.URL), conectar(t, srv.URL)
	for _, c := range []*leitor{c1, c2} {
		if ev := c.proximo(t); ev["tipo"] != "estado" {
			t.Fatalf("o primeiro: %v", ev)
		}
	}
	s.mu.Lock()
	s.estado = []salas.Sala{{Sala: salaA, Participantes: []salas.Participante{{Participante: partA}}}}
	s.mu.Unlock()
	no.Store(false)
	a.Retrato()
	for i, c := range []*leitor{c1, c2} {
		ev := c.proximo(t)
		sl, _ := ev["salas"].([]any)
		if ev["tipo"] != "estado" || len(sl) != 1 || ev["freeswitch"] != false {
			t.Fatalf("o cliente %d: %v", i+1, ev)
		}
	}
}

func TestEventos_Fim(t *testing.T) {
	a := novaAPI(t, &salasFalsas{}, nil, nil)
	e := novoEscritor(false)
	feito, cancelar := servirEscritor(a, e)
	<-e.escritas // o estado
	cancelar()
	select {
	case <-feito:
	case <-time.After(2 * time.Second):
		t.Fatal("o handler não saiu quando o cliente foi embora")
	}
	if c := a.conectados(); c != 0 {
		t.Fatalf("%d clientes", c)
	}
	// O Fechar desliga quem sobrou, e depois dele ninguém entra.
	e2 := novoEscritor(false)
	feito2, _ := servirEscritor(a, e2)
	<-e2.escritas
	a.Fechar()
	select {
	case <-feito2:
	case <-time.After(2 * time.Second):
		t.Fatal("o Fechar não desligou o cliente")
	}
}

// O texto de um erro do FreeSWITCH pode trazer um id: o registro o cobre. A chave, a sala e o participante do
// pedido nunca vão ao registro.
func TestRegistro_SemIds(t *testing.T) {
	var buf strings.Builder
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(antes)

	s := &salasFalsas{err: &esl.ErroFS{Motivo: "Conference " + salaA + " e " + partA + " com 7c1f2e3a-1111-4222-8333-444455556666"}}
	a := novaAPI(t, s, nil, nil)
	pedir(a, "POST", "/agente/v1/salas/"+salaA+"/participantes/"+partA+"/tirar", chaveTeste)
	log := buf.String()
	for _, proibido := range []string{salaA, partA, chaveTeste, "7c1f2e3a"} {
		if strings.Contains(log, proibido) {
			t.Fatalf("o registro tem %q:\n%s", proibido, log)
		}
	}
	if !strings.Contains(log, "Conference") {
		t.Fatalf("o registro perdeu o texto do erro:\n%s", log)
	}
}
