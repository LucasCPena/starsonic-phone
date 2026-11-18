package video_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video/videotest"
)

const (
	chave        = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	sala         = "0123456789abcdef0123456789abcdef"
	participante = "0011223344556677"
)

func TestValidarEndereco(t *testing.T) {
	for _, e := range []string{"video.exemplo.com.br", "video.exemplo.com.br:8443"} {
		if err := video.ValidarEndereco(e, false); err != nil {
			t.Errorf("%q deveria valer: %v", e, err)
		}
	}
	for _, e := range []string{
		"https://video.exemplo.com.br", "video.exemplo.com.br/x", "video", "", "video.exemplo.com.br:",
		"video.exemplo.com.br:99999", "video .exemplo.com.br", "http://video.exemplo.com.br", "127.0.0.1:8095",
	} {
		if err := video.ValidarEndereco(e, false); err == nil {
			t.Errorf("%q não deveria valer", e)
		}
	}
	const local = "http://127.0.0.1:8095"
	if err := video.ValidarEndereco(local, false); err == nil {
		t.Errorf("%q só vale no modo de teste", local)
	}
	if err := video.ValidarEndereco(local, true); err != nil {
		t.Errorf("%q deveria valer no modo de teste: %v", local, err)
	}
	for _, e := range []string{"http://127.0.0.1", "http://127.0.0.1:8095/x", "http://exemplo.com:8095", "https://127.0.0.1:8095"} {
		if err := video.ValidarEndereco(e, true); err == nil {
			t.Errorf("%q não deveria valer, nem no modo de teste", e)
		}
	}
}

func TestNovoCliente_EnderecoEWSS(t *testing.T) {
	c, err := video.NovoCliente("video.exemplo.com.br:8443", chave, false)
	if err != nil {
		t.Fatal(err)
	}
	if c.Endereco() != "video.exemplo.com.br:8443" || c.WSS() != "wss://video.exemplo.com.br:8443/sip" {
		t.Fatalf("Endereco = %q, WSS = %q", c.Endereco(), c.WSS())
	}
	if len(c.Chave()) != 32 {
		t.Fatalf("Chave tem %d bytes", len(c.Chave()))
	}
	c, err = video.NovoCliente("http://127.0.0.1:8095", chave, true)
	if err != nil {
		t.Fatal(err)
	}
	if c.Endereco() != "127.0.0.1:8095" || c.WSS() != "ws://127.0.0.1:8095/sip" {
		t.Fatalf("no modo de teste: Endereco = %q, WSS = %q", c.Endereco(), c.WSS())
	}
	if _, err := video.NovoCliente("video", chave, false); err == nil {
		t.Error("NovoCliente aceitou um endereço inválido")
	}
	if _, err := video.NovoCliente("video.exemplo.com.br", "curta", false); err == nil {
		t.Error("NovoCliente aceitou uma chave inválida")
	}
}

// ajustar troca uma variável do pacote durante o teste.
func ajustar[T any](t *testing.T, v *T, novo T) {
	t.Helper()
	antigo := *v
	*v = novo
	t.Cleanup(func() { *v = antigo })
}

// agente é o servidor de vídeo falso do teste, um httptest com a API da seção 5 do contrato.
type agente struct {
	*httptest.Server
	agora   func() time.Time
	eventos func(w http.ResponseWriter, r *http.Request) // o handler dos eventos, depois da conferência da chave

	mu       sync.Mutex
	pedidos  []string // "<método> <caminho>"
	conexoes int
	tempos   []time.Time // quando cada conexão dos eventos chegou
}

func novoAgente(t *testing.T) *agente {
	t.Helper()
	a := &agente{agora: time.Now}
	a.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chave {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"erro":"chave"}`)
			return
		}
		a.mu.Lock()
		a.pedidos = append(a.pedidos, r.Method+" "+r.URL.Path)
		a.mu.Unlock()
		switch {
		case r.URL.Path == "/agente/v1/estado" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"versao":"0.1.0","freeswitch":true,"agora":%d,"salas":[{"sala":%q,"participantes":[{"participante":%q,"tela":false},{"participante":%q,"tela":true}]}],"uso":{"cpu":34,"memoria":41}}`,
				a.agora().UnixMilli(), sala, participante, participante)
		case r.URL.Path == "/agente/v1/eventos" && r.Method == http.MethodGet:
			a.mu.Lock()
			a.conexoes++
			a.tempos = append(a.tempos, time.Now())
			a.mu.Unlock()
			if a.eventos == nil {
				http.Error(w, "sem eventos", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			a.eventos(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/tirar"),
			r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/encerrar"):
			if strings.Contains(r.URL.Path, "00000000000000000000000000000000") {
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, `{"erro":"naoEncontrado"}`)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(a.Server.Close)
	return a
}

func (a *agente) cliente(t *testing.T) *video.Cliente {
	t.Helper()
	c, err := video.NovoCliente(a.URL, chave, true)
	if err != nil {
		t.Fatalf("NovoCliente: %v", err)
	}
	return c
}

func (a *agente) total() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conexoes
}

func (a *agente) pedidosFeitos() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.pedidos)
}

// sse escreve um evento dos eventos e o envia na hora.
func sse(w http.ResponseWriter, ev string) {
	fmt.Fprintf(w, "data: %s\n\n", ev)
	w.(http.Flusher).Flush()
}

func estadoSSE(a *agente, freeswitch bool) string {
	return fmt.Sprintf(`{"tipo":"estado","agora":%d,"freeswitch":%t,"salas":[]}`, a.agora().UnixMilli(), freeswitch)
}

func TestCliente_Estado(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	ctx := context.Background()

	est, err := c.Estado(ctx)
	if err != nil {
		t.Fatalf("Estado: %v", err)
	}
	if est.Versao != "0.1.0" || !est.FreeSWITCH || est.Uso != (video.Uso{CPU: 34, Memoria: 41}) {
		t.Fatalf("estado lido errado: %+v", est)
	}
	if len(est.Salas) != 1 || est.Salas[0].Sala != sala ||
		!slices.Equal(est.Salas[0].Participantes, []video.Participante{{Participante: participante}, {Participante: participante, Tela: true}}) {
		t.Fatalf("salas lidas erradas: %+v", est.Salas)
	}
	if d := time.Until(time.UnixMilli(est.Agora)); d < -time.Second || d > time.Second {
		t.Fatalf("agora = %d", est.Agora)
	}

	// o 401: outra chave
	outra, err := video.NovoCliente(a.URL, "AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := outra.Estado(ctx); err != video.ErrChave {
		t.Fatalf("com a chave errada: %v; queria ErrChave", err)
	}
}

func TestCliente_Estado_SemResposta(t *testing.T) {
	ajustar(t, &video.EsperaPedido, 200*time.Millisecond)
	ctx := context.Background()

	t.Run("500", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"erro":"interno"}`, http.StatusInternalServerError)
		}))
		defer s.Close()
		c, _ := video.NovoCliente(s.URL, chave, true)
		if _, err := c.Estado(ctx); err != video.ErrSemResposta {
			t.Fatalf("500: %v; queria ErrSemResposta", err)
		}
	})
	t.Run("503 freeswitch", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"erro":"freeswitch"}`, http.StatusServiceUnavailable)
		}))
		defer s.Close()
		c, _ := video.NovoCliente(s.URL, chave, true)
		if _, err := c.Estado(ctx); err != video.ErrSemResposta {
			t.Fatalf("503: %v; queria ErrSemResposta", err)
		}
	})
	t.Run("não responde no prazo", func(t *testing.T) {
		solta := make(chan struct{})
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-solta:
			case <-r.Context().Done():
			}
		}))
		defer s.Close()
		defer close(solta)
		c, _ := video.NovoCliente(s.URL, chave, true)
		ini := time.Now()
		_, err := c.Estado(ctx)
		if err != video.ErrSemResposta {
			t.Fatalf("sem resposta: %v; queria ErrSemResposta", err)
		}
		if d := time.Since(ini); d < 150*time.Millisecond || d > 2*time.Second {
			t.Fatalf("esperou %v; queria cerca de 200ms", d)
		}
	})
	t.Run("rede", func(t *testing.T) {
		s := httptest.NewServer(http.NotFoundHandler())
		url := s.URL
		s.Close() // ninguém escuta mais
		c, _ := video.NovoCliente(url, chave, true)
		_, err := c.Estado(ctx)
		if err != video.ErrSemResposta {
			t.Fatalf("rede: %v; queria ErrSemResposta", err)
		}
		if strings.Contains(err.Error(), chave) {
			t.Fatal("o erro leva a chave")
		}
	})
	t.Run("o ctx do chamador", func(t *testing.T) {
		ctx, cancela := context.WithCancel(ctx)
		cancela()
		a := novoAgente(t)
		if _, err := a.cliente(t).Estado(ctx); err == nil || err == video.ErrSemResposta {
			t.Fatalf("com o ctx cancelado: %v; queria o erro do ctx", err)
		}
	})
}

func TestCliente_TirarEncerrar(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	ctx := context.Background()

	if err := c.Tirar(ctx, sala, participante); err != nil {
		t.Fatalf("Tirar: %v", err)
	}
	if err := c.Encerrar(ctx, sala); err != nil {
		t.Fatalf("Encerrar: %v", err)
	}
	want := []string{
		"POST /agente/v1/salas/" + sala + "/participantes/" + participante + "/tirar",
		"POST /agente/v1/salas/" + sala + "/encerrar",
	}
	if got := a.pedidosFeitos(); !slices.Equal(got, want) {
		t.Fatalf("pedidos = %v; queria %v", got, want)
	}

	zeros := strings.Repeat("0", 32)
	if err := c.Tirar(ctx, zeros, participante); err != video.ErrNaoEncontrado {
		t.Fatalf("Tirar com sala que não existe: %v; queria ErrNaoEncontrado", err)
	}
	if err := c.Encerrar(ctx, zeros); err != video.ErrNaoEncontrado {
		t.Fatalf("Encerrar com sala que não existe: %v; queria ErrNaoEncontrado", err)
	}
	outra, _ := video.NovoCliente(a.URL, "AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", true)
	if err := outra.Encerrar(ctx, sala); err != video.ErrChave {
		t.Fatalf("Encerrar com a chave errada: %v; queria ErrChave", err)
	}
}

// eventosEm devolve um canal com cada evento que o f recebeu, e a função do Acompanhar rodando.
func acompanhar(t *testing.T, c *video.Cliente) (evs <-chan video.Evento, para func()) {
	t.Helper()
	ch := make(chan video.Evento, 64)
	ctx, cancela := context.WithCancel(context.Background())
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		c.Acompanhar(ctx, func(ev video.Evento) { ch <- ev })
	}()
	var uma sync.Once
	para = func() {
		uma.Do(func() {
			cancela()
			select {
			case <-feito:
			case <-time.After(5 * time.Second):
				t.Error("o Acompanhar não voltou depois que o ctx acabou")
			}
		})
	}
	t.Cleanup(para)
	return ch, para
}

func esperar(t *testing.T, evs <-chan video.Evento) video.Evento {
	t.Helper()
	select {
	case ev := <-evs:
		return ev
	case <-time.After(5 * time.Second):
		t.Fatal("o evento não chegou")
		return video.Evento{}
	}
}

func ate(t *testing.T, o string, cond func() bool) {
	t.Helper()
	limite := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(limite) {
			t.Fatalf("não chegou a: %s", o)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCliente_Acompanhar(t *testing.T) {
	ajustar(t, &video.EsperaReconexao, 10*time.Millisecond)
	ajustar(t, &video.EsperaReconexaoMaxima, 40*time.Millisecond)

	a := novoAgente(t)
	c := a.cliente(t)
	if c.NoAr() {
		t.Fatal("NoAr antes de conectar")
	}
	derruba := make(chan struct{}) // fecha para o agente soltar a conexão atual
	var rodada atomic.Int32
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		n := rodada.Add(1)
		sse(w, fmt.Sprintf(`{"tipo":"estado","agora":%d,"freeswitch":true,"salas":[{"sala":%q,"participantes":[]}]}`, a.agora().UnixMilli(), sala))
		if n == 1 {
			sse(w, fmt.Sprintf(`{"tipo":"entrou","sala":%q,"participante":%q,"tela":true}`, sala, participante))
			select {
			case <-derruba: // o servidor fecha
			case <-r.Context().Done():
			}
			return
		}
		<-r.Context().Done()
	}

	evs, para := acompanhar(t, c)

	ev := esperar(t, evs)
	if ev.Tipo != "estado" || !ev.FreeSWITCH || len(ev.Salas) != 1 || ev.Salas[0].Sala != sala {
		t.Fatalf("o primeiro evento deveria ser o estado: %+v", ev)
	}
	ev = esperar(t, evs)
	if ev.Tipo != "entrou" || ev.Sala != sala || ev.Participante != participante || !ev.Tela {
		t.Fatalf("o segundo evento deveria ser o entrou: %+v", ev)
	}
	if !c.NoAr() {
		t.Fatal("NoAr deveria ser verdadeiro com a conexão aberta e o FreeSWITCH no ar")
	}

	close(derruba) // o servidor fecha a conexão
	ate(t, "o NoAr falso depois que o servidor fechou", func() bool { return !c.NoAr() })

	ev = esperar(t, evs) // a reconexão traz um estado novo
	if ev.Tipo != "estado" {
		t.Fatalf("depois da reconexão deveria vir um estado: %+v", ev)
	}
	if !c.NoAr() {
		t.Fatal("NoAr deveria voltar com a reconexão")
	}
	if a.total() != 2 {
		t.Fatalf("conexões = %d; queria 2", a.total())
	}

	para() // o ctx acaba, e o Acompanhar volta (o para confere)
	if c.NoAr() {
		t.Fatal("NoAr deveria ser falso depois que o Acompanhar voltou")
	}
}

func TestCliente_Acompanhar_FreeSWITCHFora(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	fim := make(chan struct{})
	t.Cleanup(func() { close(fim) })
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, estadoSSE(a, true))
		sse(w, `{"tipo":"acabou","sala":"`+sala+`"}`)
		sse(w, estadoSSE(a, false)) // o FreeSWITCH caiu
		sse(w, `{"tipo":"relogio","agora":1}`)
		select {
		case <-fim:
		case <-r.Context().Done():
		}
	}
	evs, _ := acompanhar(t, c)
	if ev := esperar(t, evs); ev.Tipo != "estado" || !ev.FreeSWITCH {
		t.Fatalf("1: %+v", ev)
	}
	if ev := esperar(t, evs); ev.Tipo != "acabou" || ev.Sala != sala {
		t.Fatalf("2: %+v", ev)
	}
	if ev := esperar(t, evs); ev.Tipo != "estado" || ev.FreeSWITCH {
		t.Fatalf("3: %+v", ev)
	}
	if c.NoAr() {
		t.Fatal("com o estado dizendo freeswitch falso, NoAr deveria ser falso, com a conexão aberta")
	}
	// o relogio ainda chega, e não muda o NoAr
	if ev := esperar(t, evs); ev.Tipo != "relogio" || ev.Agora != 1 {
		t.Fatalf("4: %+v", ev)
	}
	if c.NoAr() {
		t.Fatal("o relógio não deveria religar o NoAr")
	}
}

func TestCliente_Acompanhar_SilencioDerruba(t *testing.T) {
	ajustar(t, &video.SilencioMaximo, 150*time.Millisecond)
	ajustar(t, &video.EsperaReconexao, 10*time.Millisecond)
	ajustar(t, &video.EsperaReconexaoMaxima, 40*time.Millisecond)

	a := novoAgente(t)
	c := a.cliente(t)
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, estadoSSE(a, true))
		<-r.Context().Done() // aberta e muda
	}
	evs, _ := acompanhar(t, c)
	if ev := esperar(t, evs); ev.Tipo != "estado" {
		t.Fatal(ev)
	}
	ate(t, "o NoAr falso depois do silêncio", func() bool { return !c.NoAr() })
	if ev := esperar(t, evs); ev.Tipo != "estado" { // reconectou
		t.Fatalf("depois do silêncio deveria reconectar e vir um estado: %+v", ev)
	}
	if a.total() < 2 {
		t.Fatalf("conexões = %d", a.total())
	}
}

func TestCliente_Acompanhar_SinalDeVidaSegura(t *testing.T) {
	ajustar(t, &video.SilencioMaximo, 200*time.Millisecond)
	a := novoAgente(t)
	c := a.cliente(t)
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, estadoSSE(a, true))
		for range 8 { // um relógio a cada 50 ms: nunca passa 200 ms sem nada
			select {
			case <-time.After(50 * time.Millisecond):
				sse(w, fmt.Sprintf(`{"tipo":"relogio","agora":%d}`, a.agora().UnixMilli()))
			case <-r.Context().Done():
				return
			}
		}
		<-r.Context().Done()
	}
	evs, _ := acompanhar(t, c)
	for range 9 {
		esperar(t, evs)
	}
	if a.total() != 1 {
		t.Fatalf("conexões = %d; com o relógio chegando a conexão não devia cair", a.total())
	}
}

func TestCliente_Acompanhar_EsperaDobra(t *testing.T) {
	ajustar(t, &video.EsperaReconexao, 40*time.Millisecond)
	ajustar(t, &video.EsperaReconexaoMaxima, 160*time.Millisecond)

	a := novoAgente(t) // sem eventos: cada conexão leva um 500
	c := a.cliente(t)
	_, _ = acompanhar(t, c)
	ate(t, "6 tentativas", func() bool { return a.total() >= 6 })
	a.mu.Lock()
	instantes := slices.Clone(a.tempos)
	a.mu.Unlock()
	// as esperas: 40, 80, 160, 160, 160 ms
	want := []time.Duration{40, 80, 160, 160, 160}
	for i, w := range want {
		w *= time.Millisecond
		got := instantes[i+1].Sub(instantes[i])
		if got < w-5*time.Millisecond {
			t.Errorf("a espera %d foi de %v; queria pelo menos %v", i+1, got, w)
		}
	}
}

func TestCliente_Acompanhar_CtxAcabaSolta(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	solta := make(chan struct{})
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		defer close(solta)
		sse(w, estadoSSE(a, true))
		<-r.Context().Done()
	}
	evs, para := acompanhar(t, c)
	esperar(t, evs)
	para()
	select {
	case <-solta:
	case <-time.After(5 * time.Second):
		t.Fatal("o cliente não fechou a conexão dos eventos quando o ctx acabou")
	}
}

func TestCliente_Acompanhar_LeBemOsEventos(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	fim := make(chan struct{})
	t.Cleanup(func() { close(fim) })
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, ": um comentário\n\n")
		fmt.Fprint(w, "data: isto não é JSON\n\n")
		sse(w, estadoSSE(a, true))
		fmt.Fprintf(w, "data: {\"tipo\":\"saiu\",\r\ndata: \"sala\":%q}\r\n\r\n", sala) // dois data: e CRLF
		w.(http.Flusher).Flush()
		<-fim
	}
	evs, _ := acompanhar(t, c)
	if ev := esperar(t, evs); ev.Tipo != "estado" {
		t.Fatalf("o primeiro deveria ser o estado (o lixo se ignora): %+v", ev)
	}
	if ev := esperar(t, evs); ev.Tipo != "saiu" || ev.Sala != sala {
		t.Fatalf("o segundo deveria ser o saiu, de dois data: %+v", ev)
	}
}

func TestCliente_RelogioDoAgente(t *testing.T) {
	a := novoAgente(t)
	adiante := 3 * time.Minute
	a.agora = func() time.Time { return time.Now().Add(adiante) }
	c := a.cliente(t)

	if d := c.Agora().Sub(time.Now()); d < -time.Second || d > time.Second {
		t.Fatalf("sem medida, Agora() deveria ser o relógio local: diferença %v", d)
	}
	if _, err := c.Estado(context.Background()); err != nil {
		t.Fatal(err)
	}
	if d := c.Agora().Sub(a.agora()); d < -time.Second || d > time.Second {
		t.Fatalf("depois do estado, Agora() deveria ficar a menos de 1 s do relógio do agente: diferença %v", d)
	}

	// pelos eventos também: o estado e o relógio medem de novo
	adiante = -2 * time.Minute
	fim := make(chan struct{})
	t.Cleanup(func() { close(fim) })
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, estadoSSE(a, true))
		<-fim
	}
	evs, _ := acompanhar(t, c)
	esperar(t, evs)
	if d := c.Agora().Sub(a.agora()); d < -time.Second || d > time.Second {
		t.Fatalf("depois do estado dos eventos: diferença %v", d)
	}
}

func TestCliente_RelogioPeloEventoRelogio(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	fim := make(chan struct{})
	t.Cleanup(func() { close(fim) })
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, estadoSSE(a, true))
		sse(w, fmt.Sprintf(`{"tipo":"relogio","agora":%d}`, time.Now().Add(10*time.Minute).UnixMilli()))
		<-fim
	}
	evs, _ := acompanhar(t, c)
	esperar(t, evs)
	esperar(t, evs)
	if d := c.Agora().Sub(time.Now().Add(10 * time.Minute)); d < -time.Second || d > time.Second {
		t.Fatalf("depois do relogio: diferença %v", d)
	}
}

// Os testes do agente falso que o gerente (Task 11) usa.

func TestFalso_MandarAntesDeAcompanharNaoSePerde(t *testing.T) {
	f := videotest.NovoFalso(nil, time.Now)
	f.Mandar(video.Evento{Tipo: "estado", FreeSWITCH: true})
	f.Mandar(video.Evento{Tipo: "entrou", Sala: sala, Participante: participante})

	var mu sync.Mutex
	var recebidos []string
	ctx, cancela := context.WithCancel(context.Background())
	feito := make(chan struct{})
	go func() {
		defer close(feito)
		f.Acompanhar(ctx, func(ev video.Evento) {
			mu.Lock()
			recebidos = append(recebidos, ev.Tipo)
			mu.Unlock()
		})
	}()
	ate(t, "os dois eventos", func() bool { mu.Lock(); defer mu.Unlock(); return len(recebidos) == 2 })
	f.Mandar(video.Evento{Tipo: "saiu"}) // e depois, com o f já posto, vai direto
	ate(t, "o terceiro", func() bool { mu.Lock(); defer mu.Unlock(); return len(recebidos) == 3 })
	mu.Lock()
	if !slices.Equal(recebidos, []string{"estado", "entrou", "saiu"}) {
		t.Fatalf("recebidos = %v", recebidos)
	}
	mu.Unlock()
	cancela()
	select {
	case <-feito:
	case <-time.After(5 * time.Second):
		t.Fatal("o Acompanhar do falso não voltou com o ctx")
	}
}

func TestFalso_ComandosEEstado(t *testing.T) {
	agora := time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)
	f := videotest.NovoFalso([]byte("chave"), func() time.Time { return agora })
	ctx := context.Background()
	if string(f.Chave()) != "chave" || !f.Agora().Equal(agora) {
		t.Fatal("Chave ou Agora do falso")
	}
	if !f.NoAr() {
		t.Fatal("o falso começa no ar")
	}
	f.DefinirEstado(video.Estado{Versao: "0.1.0", FreeSWITCH: true, Salas: []video.Sala{{Sala: sala}}})
	est, err := f.Estado(ctx)
	if err != nil || len(est.Salas) != 1 || est.Agora != agora.UnixMilli() {
		t.Fatalf("Estado = %+v, %v", est, err)
	}
	if err := f.Tirar(ctx, sala, participante); err != nil {
		t.Fatal(err)
	}
	if err := f.Encerrar(ctx, sala); err != nil {
		t.Fatal(err)
	}
	want := []string{"tirar " + sala + " " + participante, "encerrar " + sala}
	if got := f.Comandos(); !slices.Equal(got, want) {
		t.Fatalf("Comandos = %v; queria %v", got, want)
	}
	f.DefinirNoAr(false)
	if f.NoAr() {
		t.Fatal("DefinirNoAr(false)")
	}
	if _, err := f.Estado(ctx); err != video.ErrSemResposta {
		t.Fatalf("Estado fora do ar: %v; queria ErrSemResposta", err)
	}
	if err := f.Tirar(ctx, sala, participante); err != video.ErrSemResposta {
		t.Fatalf("Tirar fora do ar: %v; queria ErrSemResposta", err)
	}
}

func TestAcompanhar_Palco(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, fmt.Sprintf(`{"tipo":"palco","sala":%q,"largura":1920,"altura":1080,"quadros":[{"participante":%q,"tela":false,"x":0,"y":0,"l":960,"a":540},{"participante":%q,"tela":true,"x":960,"y":0,"l":960,"a":540}]}`,
			sala, participante, participante))
		<-r.Context().Done()
	}
	evs, _ := acompanhar(t, c)
	ev := esperar(t, evs)
	quer := video.Evento{Tipo: "palco", Sala: sala, Largura: 1920, Altura: 1080, Quadros: []video.Quadro{
		{Participante: participante, X: 0, Y: 0, L: 960, A: 540},
		{Participante: participante, Tela: true, X: 960, Y: 0, L: 960, A: 540}}}
	if ev.Tipo != quer.Tipo || ev.Sala != quer.Sala || ev.Largura != quer.Largura || ev.Altura != quer.Altura ||
		!slices.Equal(ev.Quadros, quer.Quadros) {
		t.Fatalf("o evento palco lido é %+v; queria %+v", ev, quer)
	}
}

func TestEstado_Palco(t *testing.T) {
	a := novoAgente(t)
	c := a.cliente(t)
	a.eventos = func(w http.ResponseWriter, r *http.Request) {
		sse(w, fmt.Sprintf(`{"tipo":"estado","agora":%d,"freeswitch":true,"salas":[`+
			`{"sala":%q,"participantes":[],"palco":{"largura":1920,"altura":1080,"quadros":[{"participante":%q,"tela":false,"x":0,"y":0,"l":1920,"a":1080}]}},`+
			`{"sala":"outra","participantes":[]}]}`, a.agora().UnixMilli(), sala, participante))
		<-r.Context().Done()
	}
	evs, _ := acompanhar(t, c)
	ev := esperar(t, evs)
	if ev.Tipo != "estado" || len(ev.Salas) != 2 {
		t.Fatalf("o estado lido é %+v", ev)
	}
	quer := &video.Palco{Largura: 1920, Altura: 1080, Quadros: []video.Quadro{{Participante: participante, L: 1920, A: 1080}}}
	if p := ev.Salas[0].Palco; p == nil || p.Largura != quer.Largura || p.Altura != quer.Altura || !slices.Equal(p.Quadros, quer.Quadros) {
		t.Fatalf("o palco da primeira sala é %+v; queria %+v", p, quer)
	}
	if ev.Salas[1].Palco != nil {
		t.Fatalf("a sala sem palco leu o palco %+v", ev.Salas[1].Palco)
	}
}
