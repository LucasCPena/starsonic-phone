package api_test

import (
	"log/slog"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// passeResp é a resposta do POST /reunioes/{codigo}/passe.
type passeResp struct {
	Passe   string      `json:"passe"`
	Reuniao reuniaoResp `json:"reuniao"`
}

// formaDoPasse são os 43 caracteres base64url de 32 bytes.
var formaDoPasse = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func (c *cenaR) passeEm(chave, codigo string) *http.Response {
	return c.a.Pedir(chave, "POST", "/api/v1/reunioes/"+codigo+"/passe", nil)
}

// passe é o passe que tem de dar 200.
func (c *cenaR) passe(t *testing.T, chave, codigo string) passeResp {
	t.Helper()
	resp := c.passeEm(chave, codigo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("passe respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[passeResp](t, resp)
}

func TestPasse_DaCerto(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)

	resp := c.passeEm(c.kCarlos, r.Codigo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q; queria no-store", cc)
	}
	p := apitest.LerJSON[passeResp](t, resp)
	if !formaDoPasse.MatchString(p.Passe) {
		t.Fatalf("passe = %q; queria 43 caracteres base64url", p.Passe)
	}
	// A reunião é a mesma que o entrar devolve.
	if ac := c.entrar(t, c.kCarlos, r.Codigo); !reflect.DeepEqual(p.Reuniao, ac.Reuniao) {
		t.Fatalf("reuniao do passe = %+v; a do entrar = %+v", p.Reuniao, ac.Reuniao)
	}
	if p.Reuniao.Codigo != r.Codigo || p.Reuniao.CriouEu || p.Reuniao.Assunto == nil || *p.Reuniao.Assunto != "Planejamento" {
		t.Fatalf("reuniao = %+v", p.Reuniao)
	}

	// Cada pedido é um passe novo, e quem criou a reunião também pede, com o código em maiúsculas.
	outro := c.passe(t, c.kCarlos, r.Codigo)
	if outro.Passe == p.Passe {
		t.Fatal("o segundo pedido repetiu o passe")
	}
	if da := c.passe(t, c.kAna, strings.ToUpper(r.Codigo)); !da.Reuniao.CriouEu {
		t.Fatalf("a Ana criou: %+v", da.Reuniao)
	}
}

func TestPasse_NaoComecaNada(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	ana, carlos := c.a.Conectar(c.kAna), c.a.Conectar(c.kCarlos)

	p := c.passe(t, c.kCarlos, r.Codigo)
	if p.Reuniao.Acontecendo || p.Reuniao.Pessoas != 0 {
		t.Fatalf("reuniao = %+v", p.Reuniao)
	}
	if acontecendo, pessoas := c.a.Gerente.Contagem(c.sala(t, r.Codigo)); acontecendo || pessoas != 0 {
		t.Fatalf("contagem: acontecendo %v, pessoas %d", acontecendo, pessoas)
	}
	if reunioes, pessoas := c.a.Gerente.Resumo(); reunioes != 0 || pessoas != 0 {
		t.Fatalf("resumo: %d reuniões, %d pessoas", reunioes, pessoas)
	}
	// Nenhum evento foi a nenhum computador.
	apitest.SemEvento(t, ana, 200*time.Millisecond)
	apitest.SemEvento(t, carlos, 200*time.Millisecond)
	// O servidor de vídeo não recebeu comando, e nenhuma senha saiu: uma senha ainda não usada ocuparia uma das 10
	// vagas, e com 9 na reunião a décima ainda tem de caber.
	if cmds := c.a.Video.Comandos(); len(cmds) != 0 {
		t.Fatalf("comandos do vídeo = %v", cmds)
	}
	for range 9 {
		c.entrouNaReuniao(t, c.kBia, r.Codigo)
	}
	c.passe(t, c.kCarlos, r.Codigo)
	c.entrar(t, c.kAna, r.Codigo)
}

func TestPasse_OsErrosDoEntrar(t *testing.T) {
	c := novaCenaR(t)

	t.Run("o código que não existe, e o malformado", func(t *testing.T) {
		for _, codigo := range []string{"aaaaaaaaaa", "curto", "k7q49xwph0"} {
			esperarErro(t, c.passeEm(c.kCarlos, codigo), 404, "naoEncontrado")
		}
	})

	t.Run("a reunião cancelada", func(t *testing.T) {
		r := c.marcada(t, c.kAna)
		c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil)
		esperarErro(t, c.passeEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
	})

	t.Run("a reunião vencida", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Relogio.Avancar(48 * time.Hour)
		esperarErro(t, c.passeEm(c.kCarlos, r.Codigo), 404, "naoEncontrado")
		// De qualquer empresa: o 404 não revela que o código existiu.
		esperarErro(t, c.passeEm(c.kDavi, r.Codigo), 404, "naoEncontrado")
	})

	t.Run("a reunião de outra empresa, e a de teste", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		esperarErro(t, c.passeEm(c.kDavi, r.Codigo), 403, "outraEmpresa")
		teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
		esperarErro(t, c.passeEm(c.kAna, teste.Codigo), 403, "outraEmpresa")
	})

	t.Run("a empresa sem as reuniões", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.a.Banco.LiberarReunioes(t.Context(), c.acme.ID, false)
		esperarErro(t, c.passeEm(c.kCarlos, r.Codigo), 403, "semReunioes")
	})

	t.Run("sem a pessoa da vez e sem a chave", func(t *testing.T) {
		esperarErro(t, c.passeEm("", "aaaaaaaaaa"), 401, "chave")
		sem := c.a.Com(t).Ligar(c.acme.Codigo, "SEM-PESSOA")
		esperarErro(t, c.passeEm(sem, "aaaaaaaaaa"), 409, "pessoa")
	})
}

func TestPasse_ContaNasTentativas(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	for i := range 20 {
		esperarErro(t, c.passeEm(c.kCarlos, codigoQueNaoExiste(i)), 404, "naoEncontrado")
	}
	e := esperarErro(t, c.passeEm(c.kCarlos, r.Codigo), 429, "tentativas")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("esperarSegundos = %d; queria de 1 a 60", e.EsperarSegundos)
	}
	// A janela é a mesma do entrar: o endereço está cheio para os dois.
	esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 429, "tentativas")
	c.a.Relogio.Avancar(61 * time.Second)
	c.passe(t, c.kCarlos, r.Codigo)
}

func TestPasse_DezPorMinuto(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	for range 10 {
		c.passe(t, c.kCarlos, r.Codigo)
	}
	e := esperarErro(t, c.passeEm(c.kCarlos, r.Codigo), 429, "tentativas")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
		t.Fatalf("esperarSegundos = %d; queria de 1 a 60", e.EsperarSegundos)
	}
	// Outro computador passa; o que passou do limite não gastou as tentativas do endereço.
	c.passe(t, c.kBia, r.Codigo)
	esperarErro(t, c.passeEm(c.kBia, codigoQueNaoExiste(1)), 404, "naoEncontrado")
	// Um minuto depois, o primeiro passa de novo.
	c.a.Relogio.Avancar(61 * time.Second)
	c.passe(t, c.kCarlos, r.Codigo)
}

func TestPasse_ComAReuniaoCheia(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	for range 10 {
		c.entrouNaReuniao(t, c.kCarlos, r.Codigo)
	}
	esperarErro(t, c.entrarEm(c.kBia, r.Codigo), 409, "cheia")
	// Quem diz cheia é o canal: o passe sai.
	if p := c.passe(t, c.kBia, r.Codigo); p.Reuniao.Pessoas != 10 || !p.Reuniao.Acontecendo {
		t.Fatalf("reuniao = %+v", p.Reuniao)
	}
}

func TestPasse_NaoVaiAoLog(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	var log registroSeguro
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	p := c.passe(t, c.kCarlos, r.Codigo)
	esperarErro(t, c.passeEm(c.kCarlos, codigoQueNaoExiste(7)), 404, "naoEncontrado")
	esperarErro(t, c.passeEm(c.kDavi, r.Codigo), 403, "outraEmpresa")

	// O log do pedido sai quando o manipulador volta: o teste espera a linha do passe para provar algo.
	prazo := time.Now().Add(5 * time.Second)
	for !strings.Contains(log.String(), "status=403") {
		if time.Now().After(prazo) {
			t.Fatalf("o log dos pedidos não saiu:\n%s", log.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	texto := log.String()
	segredos := map[string]string{
		"o passe":         p.Passe,
		"o código":        r.Codigo,
		"o código do 404": codigoQueNaoExiste(7),
	}
	for o, s := range segredos {
		if strings.Contains(texto, s) {
			t.Fatalf("o log tem %s (%q):\n%s", o, s, texto)
		}
	}
}
