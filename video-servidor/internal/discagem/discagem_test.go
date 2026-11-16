package discagem

import (
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

var (
	chaveTeste = []byte("0123456789abcdef0123456789abcdef")
	inicio     = time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)
)

const (
	salaTeste  = "00112233445566778899aabbccddeeff"
	partTeste  = "0123456789abcdef"
	quadroBase = "{font_scale=0.25,min_font_size=8,max_font_size=20,fg=#FFFFFF,bg=#04060E}"
)

// Os tipos que leem a resposta com o encoding/xml.
type lidoDoc struct {
	Tipo   string      `xml:"type,attr"`
	Secoes []lidoSecao `xml:"section"`
}

type lidoSecao struct {
	Nome      string         `xml:"name,attr"`
	Resultado *lidoResultado `xml:"result"`
	Contextos []lidoContexto `xml:"context"`
}

type lidoResultado struct {
	Status string `xml:"status,attr"`
}

type lidoContexto struct {
	Nome      string         `xml:"name,attr"`
	Extensoes []lidoExtensao `xml:"extension"`
}

type lidoExtensao struct {
	Nome      string         `xml:"name,attr"`
	Condicoes []lidoCondicao `xml:"condition"`
}

type lidoCondicao struct {
	Acoes []lidoAcao `xml:"action"`
}

type lidoAcao struct {
	Aplicacao string `xml:"application,attr"`
	Dados     string `xml:"data,attr"`
}

func (a lidoAcao) String() string { return a.Aplicacao + " " + a.Dados }

// ligar assina a senha (quando não vazia), faz o POST e devolve a resposta lida.
type pedido struct {
	secao, contexto, destino, perfil, senha string
}

func padrao() pedido {
	return pedido{secao: "dialplan", contexto: "reunioes", destino: "reuniao", perfil: "tls"}
}

func senhaDe(t *testing.T, mudar func(*senha.Senha)) string {
	t.Helper()
	s := senha.Senha{V: 1, Sala: salaTeste, Participante: partTeste, Papel: senha.Colega, Nome: "Ana Souza",
		Vence: inicio.Add(senha.Duracao).UnixMilli(), ID: "ffeeddccbbaa99887766554433221100"}
	if mudar != nil {
		mudar(&s)
	}
	texto, err := senha.Assinar(chaveTeste, s)
	if err != nil {
		t.Fatal(err)
	}
	return texto
}

func enviar(t *testing.T, h http.Handler, metodo string, p pedido) (*httptest.ResponseRecorder, lidoDoc) {
	t.Helper()
	v := url.Values{}
	v.Set("section", p.secao)
	v.Set("Hunt-Context", p.contexto)
	v.Set("Hunt-Destination-Number", p.destino)
	v.Set("variable_sofia_profile_name", p.perfil)
	if p.senha != "" {
		v.Set("variable_sip_h_X-Starsonic-Senha", p.senha)
	}
	r := httptest.NewRequest(metodo, "/freeswitch/discagem", strings.NewReader(v.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var d lidoDoc
	if w.Code == http.StatusOK {
		if err := xml.Unmarshal(w.Body.Bytes(), &d); err != nil {
			t.Fatalf("XML inválido: %v\n%s", err, w.Body.String())
		}
	}
	return w, d
}

func novo(agora time.Time) (http.Handler, *time.Time) {
	relogio := agora
	return Nova(chaveTeste, senha.NovoUsoUnico(), func() time.Time { return relogio }), &relogio
}

// acoesDe devolve as ações da única extensão do contexto reunioes.
func acoesDe(t *testing.T, d lidoDoc) []string {
	t.Helper()
	if d.Tipo != "freeswitch/xml" || len(d.Secoes) != 1 || d.Secoes[0].Nome != "dialplan" ||
		len(d.Secoes[0].Contextos) != 1 || d.Secoes[0].Contextos[0].Nome != "reunioes" ||
		len(d.Secoes[0].Contextos[0].Extensoes) != 1 || len(d.Secoes[0].Contextos[0].Extensoes[0].Condicoes) != 1 {
		t.Fatalf("estrutura inesperada: %+v", d)
	}
	var out []string
	for _, a := range d.Secoes[0].Contextos[0].Extensoes[0].Condicoes[0].Acoes {
		out = append(out, a.String())
	}
	return out
}

func igual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestDiscagem_Colega(t *testing.T) {
	h, _ := novo(inicio)
	p := padrao()
	p.senha = senhaDe(t, nil)
	w, d := enviar(t, h, http.MethodPost, p)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	esperado := []string{
		"set starsonic_participante=" + partTeste,
		"set starsonic_tela=false",
		"set video_banner_text=" + quadroBase + "Ana Souza",
		"set rtp_video_max_bandwidth_in=1000kb",
		"set media_timeout_audio=60000",
		"set media_hold_timeout_audio=600000",
		"set jb_av_sync_msec=disabled",
		"set rtp_secure_media=mandatory:AES_CM_128_HMAC_SHA1_80",
		"answer ",
		"conference " + salaTeste + "@starsonic",
	}
	if got := acoesDe(t, d); !igual(got, esperado) {
		t.Fatalf("ações:\n%q\nesperado:\n%q", got, esperado)
	}
}

func TestDiscagem_Fora(t *testing.T) {
	h, _ := novo(inicio)
	p := padrao()
	p.perfil = "navegador"
	p.senha = senhaDe(t, func(s *senha.Senha) { s.Papel = senha.Fora })
	_, d := enviar(t, h, http.MethodPost, p)
	esperado := []string{
		"set starsonic_participante=" + partTeste,
		"set starsonic_tela=false",
		"set video_banner_text=" + quadroBase + "Ana Souza",
		"set rtp_video_max_bandwidth_in=1000kb",
		"set media_timeout_audio=60000",
		"set media_hold_timeout_audio=600000",
		"set jb_av_sync_msec=disabled",
		"answer ",
		"conference " + salaTeste + "@starsonic+flags{join-only}",
	}
	if got := acoesDe(t, d); !igual(got, esperado) {
		t.Fatalf("ações:\n%q\nesperado:\n%q", got, esperado)
	}
}

func TestDiscagem_Tela(t *testing.T) {
	h, _ := novo(inicio)
	p := padrao()
	p.senha = senhaDe(t, func(s *senha.Senha) { s.Tela = true; s.Nome = "Maria Lima" })
	_, d := enviar(t, h, http.MethodPost, p)
	esperado := []string{
		"set starsonic_participante=" + partTeste,
		"set starsonic_tela=true",
		"set video_banner_text=" + quadroBase + "Tela de Maria Lima",
		"set rtp_video_max_bandwidth_in=1000kb",
		"set media_timeout_audio=60000",
		"set media_hold_timeout_audio=600000",
		"set jb_av_sync_msec=disabled",
		"set rtp_secure_media=mandatory:AES_CM_128_HMAC_SHA1_80",
		"set video_reservation_id=tela",
		"answer ",
		"conference " + salaTeste + "@starsonic+flags{mute|deaf}",
	}
	if got := acoesDe(t, d); !igual(got, esperado) {
		t.Fatalf("ações:\n%q\nesperado:\n%q", got, esperado)
	}
}

// ligacaoDiscada é uma das quatro ligações da discagem e as ações que ela recebe.
type ligacaoDiscada struct {
	nome  string
	acoes []string
}

// quatroLigacoes são as ações da discagem para as quatro ligações: o colega, quem é de fora e a tela, pelo
// navegador, e o app, pelo tls.
func quatroLigacoes(t *testing.T) []ligacaoDiscada {
	t.Helper()
	var ligacoes []ligacaoDiscada
	for _, caso := range []struct {
		nome, perfil string
		mudar        func(*senha.Senha)
	}{
		{"colega", "navegador", nil},
		{"fora", "navegador", func(s *senha.Senha) { s.Papel = senha.Fora }},
		{"tela", "navegador", func(s *senha.Senha) { s.Tela = true }},
		{"app", "tls", nil},
	} {
		h, _ := novo(inicio)
		p := padrao()
		p.perfil = caso.perfil
		p.senha = senhaDe(t, caso.mudar)
		_, d := enviar(t, h, http.MethodPost, p)
		ligacoes = append(ligacoes, ligacaoDiscada{caso.nome, acoesDe(t, d)})
	}
	return ligacoes
}

// antesDoAnswer confere que, nas quatro ligações, a ação vem antes do answer: o FreeSWITCH lê essas variáveis quando a
// mídia sobe, no answer.
func antesDoAnswer(t *testing.T, acao string) {
	t.Helper()
	for _, l := range quatroLigacoes(t) {
		posicao, answer := -1, -1
		for i, a := range l.acoes {
			switch a {
			case acao:
				posicao = i
			case "answer ":
				answer = i
			}
		}
		if posicao < 0 || answer < 0 || posicao > answer {
			t.Errorf("%s: o %q não vem antes do answer: %q", l.nome, acao, l.acoes)
		}
	}
}

// Quem fecha a aba sai pelos 60 s sem mídia (a seção 6 do contrato), e é o som que decide: o media_timeout_audio só
// vale para o caminho do som, e um caminho do vídeo quieto não derruba ninguém. Na espera (o hold), são 10 minutos. O
// media_timeout e o media_hold_timeout sem o _audio valeriam também para o vídeo (src/switch_core_media.c do
// FreeSWITCH 1.11.3, check_media_timeout_params), e nenhuma ligação os leva.
func TestDiscagem_TempoSemMidia(t *testing.T) {
	antesDoAnswer(t, "set media_timeout_audio=60000")
	antesDoAnswer(t, "set media_hold_timeout_audio=600000")
	for _, l := range quatroLigacoes(t) {
		for _, a := range l.acoes {
			for _, proibida := range []string{"set media_timeout=", "set media_hold_timeout=", "set media_timeout_video=",
				"set media_hold_timeout_video=", "set rtp_timeout_sec=", "set rtp_hold_timeout_sec="} {
				if strings.HasPrefix(a, proibida) {
					t.Errorf("%s: a ligação leva o %q", l.nome, a)
				}
			}
		}
	}
}

// O e2e (Task 15): a cada 300 quadros de vídeo de uma ligação, o FreeSWITCH acerta o som dela com o vídeo
// (o check_jb_sync), e na primeira vez a thread que lê o vídeo cria o jitter buffer do som com a trava da leitura do
// som. A thread do som segura essa trava enquanto espera o próximo pacote, e com a máquina ocupada a do vídeo não a
// pega mais: a ligação para de ler o próprio vídeo e de responder ao ICE dele, e a imagem dela congela para todos.
// O jb_av_sync_msec=disabled desliga esse acerto, e a thread do vídeo não toca mais no som.
func TestDiscagem_SemAcertoDoSomComOVideo(t *testing.T) {
	antesDoAnswer(t, "set jb_av_sync_msec=disabled")
}

func TestDiscagem_TelaDeFora(t *testing.T) {
	h, _ := novo(inicio)
	p := padrao()
	p.perfil = "navegador"
	p.senha = senhaDe(t, func(s *senha.Senha) { s.Tela = true; s.Papel = senha.Fora })
	_, d := enviar(t, h, http.MethodPost, p)
	got := acoesDe(t, d)
	if ultima := got[len(got)-1]; ultima != "conference "+salaTeste+"@starsonic+flags{join-only|mute|deaf}" {
		t.Fatalf("última ação: %q", ultima)
	}
}

func apenasRespond(t *testing.T, d lidoDoc, resposta string) {
	t.Helper()
	got := acoesDe(t, d)
	if len(got) != 1 || got[0] != "respond "+resposta {
		t.Fatalf("ações %q, esperado só respond %s", got, resposta)
	}
}

func TestDiscagem_Recusa(t *testing.T) {
	outraChave, err := senha.Assinar([]byte("ffffffffffffffffffffffffffffffff"), senha.Senha{V: 1, Sala: salaTeste,
		Participante: partTeste, Papel: senha.Colega, Nome: "Ana Souza", Vence: inicio.Add(senha.Duracao).UnixMilli(),
		ID: "ffeeddccbbaa99887766554433221100"})
	if err != nil {
		t.Fatal(err)
	}
	casos := []struct {
		nome   string
		agente time.Time // quando o agente começou
		senha  func(t *testing.T) string
		agora  time.Duration // o quanto o relógio anda antes do pedido
	}{
		{"sem o cabeçalho", inicio, func(*testing.T) string { return "" }, 0},
		{"senha de outra chave", inicio, func(*testing.T) string { return outraChave }, 0},
		{"senha vencida", inicio, func(t *testing.T) string { return senhaDe(t, nil) }, 31 * time.Second},
		{"senha vencida há mais de um minuto", inicio, func(t *testing.T) string { return senhaDe(t, nil) }, 2 * time.Minute},
		// assinada em inicio (vence em inicio+30s), o agente começou um segundo depois
		{"assinada antes de o agente começar", inicio.Add(time.Second), func(t *testing.T) string {
			return senhaDe(t, func(s *senha.Senha) { s.Vence = inicio.Add(senha.Duracao).UnixMilli() })
		}, 0},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			h, relogio := novo(c.agente)
			*relogio = relogio.Add(c.agora)
			p := padrao()
			p.senha = c.senha(t)
			w, d := enviar(t, h, http.MethodPost, p)
			if w.Code != 200 {
				t.Fatalf("status %d", w.Code)
			}
			apenasRespond(t, d, "403 Forbidden")
			if strings.Contains(w.Body.String(), salaTeste) {
				t.Fatal("o XML tem a sala")
			}
		})
	}

	t.Run("a mesma senha pela segunda vez", func(t *testing.T) {
		h, _ := novo(inicio)
		p := padrao()
		p.senha = senhaDe(t, nil)
		_, d := enviar(t, h, http.MethodPost, p)
		if got := acoesDe(t, d); !strings.HasPrefix(got[len(got)-1], "conference ") {
			t.Fatalf("a primeira vez devia entrar: %q", got)
		}
		w, d := enviar(t, h, http.MethodPost, p)
		apenasRespond(t, d, "403 Forbidden")
		if strings.Contains(w.Body.String(), salaTeste) {
			t.Fatal("o XML tem a sala")
		}
	})

	// Uma senha recusada por ser anterior ao agente não fica guardada, e a assinada depois dele entra.
	t.Run("assinada depois de o agente começar entra", func(t *testing.T) {
		h, _ := novo(inicio.Add(time.Second))
		p := padrao()
		p.senha = senhaDe(t, func(s *senha.Senha) { s.Vence = inicio.Add(time.Second + senha.Duracao).UnixMilli() })
		_, d := enviar(t, h, http.MethodPost, p)
		if got := acoesDe(t, d); !strings.HasPrefix(got[len(got)-1], "conference ") {
			t.Fatalf("devia entrar: %q", got)
		}
	})
}

func TestDiscagem_OutroDestino(t *testing.T) {
	h, _ := novo(inicio)
	p := padrao()
	p.destino = "9999"
	p.senha = senhaDe(t, nil)
	w, d := enviar(t, h, http.MethodPost, p)
	apenasRespond(t, d, "404 Not Found")
	if strings.Contains(w.Body.String(), salaTeste) {
		t.Fatal("o XML tem a sala")
	}
}

func TestDiscagem_OutraSecao(t *testing.T) {
	h, _ := novo(inicio)
	for _, mudar := range []func(*pedido){
		func(p *pedido) { p.secao = "directory" },
		func(p *pedido) { p.contexto = "default" },
	} {
		p := padrao()
		p.senha = senhaDe(t, nil)
		mudar(&p)
		_, d := enviar(t, h, http.MethodPost, p)
		if d.Tipo != "freeswitch/xml" || len(d.Secoes) != 1 || d.Secoes[0].Nome != "result" ||
			d.Secoes[0].Resultado == nil || d.Secoes[0].Resultado.Status != "not found" {
			t.Fatalf("esperado o lidoDoc não encontrado: %+v", d)
		}
	}
}

func TestDiscagem_NomeLimpo(t *testing.T) {
	casos := []struct{ entra, sai string }{
		{"${system(touch /tmp/x)}", "system(touch tmpx)"},
		{"Ana {Souza}", "Ana Souza"},
		{`"Bia" <b>Ramos</b>`, "Bia bRamosb"},
		{"José Ñoño", "José Ñoño"},
		{"😀 Davi", "Davi"},
		{strings.Repeat("a", 200), strings.Repeat("a", 40)},
		{"   ", "Convidado"},
		{"Maria.  Lima-D'Ávila (2)", "Maria. Lima-D'Ávila (2)"},
		{"élan", "élan"},
	}
	for _, c := range casos {
		if got := LimparNome(c.entra); got != c.sai {
			t.Errorf("LimparNome(%q) = %q, esperado %q", c.entra, got, c.sai)
		}
	}

	// Nos XMLs, o texto depois do "}" do quadro não tem "$", "{" nem "}".
	h, _ := novo(inicio)
	for i, nome := range []string{"${system(touch /tmp/x)}", "Ana {Souza}", `"Bia" <b>Ramos</b>`, "😀 Davi", "   "} {
		p := padrao()
		p.senha = senhaDe(t, func(s *senha.Senha) {
			s.Nome = nome
			s.ID = strings.Repeat("0", 31) + string(rune('1'+i))
		})
		_, d := enviar(t, h, http.MethodPost, p)
		achou := false
		for _, a := range acoesDe(t, d) {
			if dados, ok := strings.CutPrefix(a, "set video_banner_text="); ok {
				achou = true
				_, texto, ok := strings.Cut(dados, "}")
				if !ok || strings.ContainsAny(texto, "${}") {
					t.Errorf("o texto do quadro de %q: %q", nome, texto)
				}
			}
		}
		if !achou {
			t.Errorf("sem o quadro para %q", nome)
		}
	}
}

func TestDiscagem_Metodo(t *testing.T) {
	h, _ := novo(inicio)
	w, _ := enviar(t, h, http.MethodGet, padrao())
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET deu %d", w.Code)
	}
}
