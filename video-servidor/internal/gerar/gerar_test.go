package gerar

import (
	"bufio"
	"bytes"
	"encoding/xml"
	"fmt"
	"image/png"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
)

// A chave do vetor de teste da seção 3 do docs/video-agente.md, e o segredo do TURN que sai dela
// (seção 4).
const (
	chaveVetor   = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	segredoVetor = "jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4"
)

// pastaFS é a pasta do FreeSWITCH nos testes, como a do servidor.
const pastaFS = "/etc/starsonic-video/freeswitch"

func configDeTeste() config.Config {
	return config.Config{
		Endereco:  "video.exemplo.com.br",
		Chat:      "chat.exemplo.com.br",
		Chave:     chaveVetor,
		SenhaESL:  "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56",
		IPPrivado: "10.0.0.5",
		IPPublico: "203.0.113.10",
	}
}

// no é um elemento do XML, lido sem esquema.
type no struct {
	XMLName   xml.Name
	Atributos []xml.Attr `xml:",any,attr"`
	Filhos    []no       `xml:",any"`
	Texto     string     `xml:",chardata"`
}

func (n no) atributo(nome string) (string, bool) {
	for _, a := range n.Atributos {
		if a.Name.Local == nome {
			return a.Value, true
		}
	}
	return "", false
}

func (n no) filhos(tag string) []no {
	var achados []no
	for _, f := range n.Filhos {
		if f.XMLName.Local == tag {
			achados = append(achados, f)
		}
	}
	return achados
}

// filho devolve o único filho com a tag e, se nome não for vazio, com o atributo name igual a ele.
func (n no) filho(t *testing.T, tag, nome string) no {
	t.Helper()
	var achados []no
	for _, f := range n.filhos(tag) {
		if v, _ := f.atributo("name"); nome == "" || v == nome {
			achados = append(achados, f)
		}
	}
	if len(achados) != 1 {
		t.Fatalf("<%s> tem %d <%s name=%q>, want 1", n.XMLName.Local, len(achados), tag, nome)
	}
	return achados[0]
}

// parametros devolve os <param> de n como "nome=valor", na ordem.
func (n no) parametros() []string {
	var lista []string
	for _, p := range n.filhos("param") {
		nome, _ := p.atributo("name")
		valor, _ := p.atributo("value")
		lista = append(lista, nome+"="+valor)
	}
	return lista
}

// valores devolve os valores do parâmetro nome, na ordem.
func valores(parametros []string, nome string) []string {
	var lista []string
	for _, p := range parametros {
		if n, v, _ := strings.Cut(p, "="); n == nome {
			lista = append(lista, v)
		}
	}
	return lista
}

// valor devolve o valor do parâmetro nome, que tem de aparecer uma vez só.
func valor(t *testing.T, parametros []string, nome string) string {
	t.Helper()
	v := valores(parametros, nome)
	if len(v) != 1 {
		t.Fatalf("o parâmetro %s aparece %d vezes (%v), want 1", nome, len(v), v)
	}
	return v[0]
}

// documento gera o freeswitch.xml e o lê.
func documento(t *testing.T, c config.Config, teste bool) no {
	t.Helper()
	dados, err := FreeSWITCH(c, pastaFS, teste)
	if err != nil {
		t.Fatalf("FreeSWITCH: %v", err)
	}
	return ler(t, dados)
}

func ler(t *testing.T, dados []byte) no {
	t.Helper()
	var doc no
	if err := xml.Unmarshal(dados, &doc); err != nil {
		t.Fatalf("o XML não vale: %v\n%s", err, dados)
	}
	if doc.XMLName.Local != "document" {
		t.Fatalf("a raiz é <%s>, want <document>", doc.XMLName.Local)
	}
	return doc
}

func configuracao(t *testing.T, doc no, nome string) no {
	t.Helper()
	return doc.filho(t, "section", "configuration").filho(t, "configuration", nome)
}

// perfil devolve os parâmetros de um perfil do sofia.
func perfil(t *testing.T, doc no, nome string) []string {
	t.Helper()
	return configuracao(t, doc, "sofia.conf").filho(t, "profiles", "").filho(t, "profile", nome).filho(t, "settings", "").parametros()
}

// mesmos confere que as duas listas têm os mesmos itens, em qualquer ordem.
func mesmos(t *testing.T, onde string, got, want []string) {
	t.Helper()
	g, w := slices.Clone(got), slices.Clone(want)
	sort.Strings(g)
	sort.Strings(w)
	if !slices.Equal(g, w) {
		t.Errorf("%s:\n got %q\nwant %q", onde, g, w)
	}
}

func TestFreeSWITCH_Secoes(t *testing.T) {
	doc := documento(t, configDeTeste(), false)

	// Um arquivo só, com as seções configuration e dialplan.
	var secoes []string
	for _, s := range doc.filhos("section") {
		nome, _ := s.atributo("name")
		secoes = append(secoes, nome)
	}
	mesmos(t, "as seções", secoes, []string{"configuration", "dialplan"})
	if len(doc.Filhos) != 2 {
		t.Errorf("o documento tem %d elementos, want as 2 seções", len(doc.Filhos))
	}

	var configuracoes []string
	for _, c := range doc.filho(t, "section", "configuration").filhos("configuration") {
		nome, _ := c.atributo("name")
		configuracoes = append(configuracoes, nome)
	}
	// O opus.conf vai vazio: sem ele, o mod_opus escreve um [ERR] ao carregar e fica sem os padrões dele.
	mesmos(t, "as configurações", configuracoes, []string{"switch.conf", "modules.conf", "console.conf",
		"event_socket.conf", "xml_curl.conf", "sofia.conf", "conference.conf", "conference_layouts.conf", "opus.conf"})

	mesmos(t, "switch.conf", configuracao(t, doc, "switch.conf").filho(t, "settings", "").parametros(), []string{
		"rtp-start-port=16384", "rtp-end-port=16683", "max-sessions=100", "sessions-per-second=20",
		"loglevel=warning", "colorize-console=false", "dump-cores=no",
	})

	console := configuracao(t, doc, "console.conf")
	mesmos(t, "console.conf", console.filho(t, "settings", "").parametros(), []string{"loglevel=warning", "colorize=false"})
	// Sem um mapa "all", o mod_console não escreve nada: o journal ficaria vazio.
	mapa := console.filho(t, "mappings", "").filho(t, "map", "all")
	if v, _ := mapa.atributo("value"); v != "console,alert,crit,err,warning" {
		t.Errorf("console.conf: o mapa all é %q, want console,alert,crit,err,warning", v)
	}

	mesmos(t, "event_socket.conf", configuracao(t, doc, "event_socket.conf").filho(t, "settings", "").parametros(), []string{
		"listen-ip=127.0.0.1", "listen-port=8021", "password=Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56", "apply-inbound-acl=loopback.auto",
	})

	opus := configuracao(t, doc, "opus.conf")
	if len(opus.Filhos) != 0 {
		t.Errorf("o opus.conf tem %d elementos, want vazio (os padrões do mod_opus)", len(opus.Filhos))
	}
}

func TestFreeSWITCH_Modulos(t *testing.T) {
	dados, err := FreeSWITCH(configDeTeste(), pastaFS, false)
	if err != nil {
		t.Fatal(err)
	}
	doc := ler(t, dados)
	var modulos []string
	for _, l := range configuracao(t, doc, "modules.conf").filho(t, "modules", "").filhos("load") {
		m, _ := l.atributo("module")
		modulos = append(modulos, m)
	}
	ordem := []string{"mod_console", "mod_event_socket", "mod_xml_curl", "mod_sofia", "mod_commands",
		"mod_dptools", "mod_conference", "mod_dialplan_xml", "mod_opus"}
	if !slices.Equal(modulos, ordem) {
		t.Errorf("os módulos:\n got %q\nwant %q", modulos, ordem)
	}
	for _, fora := range []string{"mod_cdr_csv", "mod_xml_cdr", "mod_logfile", "mod_sndfile", "mod_verto", "mod_signalwire", "mod_av"} {
		if bytes.Contains(dados, []byte(fora)) {
			t.Errorf("o freeswitch.xml fala do %s", fora)
		}
	}
}

func TestFreeSWITCH_Portas(t *testing.T) {
	doc := documento(t, configDeTeste(), false)

	nucleo := configuracao(t, doc, "switch.conf").filho(t, "settings", "").parametros()
	if valor(t, nucleo, "rtp-start-port") != "16384" || valor(t, nucleo, "rtp-end-port") != "16683" {
		t.Errorf("a mídia: %v", nucleo)
	}

	esl := configuracao(t, doc, "event_socket.conf").filho(t, "settings", "").parametros()
	if valor(t, esl, "listen-ip") != "127.0.0.1" || valor(t, esl, "listen-port") != "8021" ||
		valor(t, esl, "password") != "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56" {
		t.Errorf("o ESL: %v", esl)
	}

	navegador := perfil(t, doc, "navegador")
	if valor(t, navegador, "ws-binding") != "127.0.0.1:5066" {
		t.Errorf("o ws-binding: %v", navegador)
	}
	if valor(t, navegador, "sip-ip") != "127.0.0.1" || valor(t, navegador, "sip-port") != "5070" {
		t.Errorf("o SIP do navegador: %v", navegador)
	}

	tls := perfil(t, doc, "tls")
	if valor(t, tls, "tls") != "true" || valor(t, tls, "tls-only") != "true" || valor(t, tls, "tls-sip-port") != "5061" {
		t.Errorf("o tls-only com a 5061: %v", tls)
	}

	binding := configuracao(t, doc, "xml_curl.conf").filho(t, "bindings", "").filho(t, "binding", "starsonic")
	url := binding.filho(t, "param", "gateway-url")
	if v, _ := url.atributo("value"); v != "http://127.0.0.1:8091/freeswitch/discagem" {
		t.Errorf("o gateway-url é %q", v)
	}
	if v, _ := url.atributo("bindings"); v != "dialplan" {
		t.Errorf("o bindings do gateway-url é %q, want dialplan", v)
	}

	// As constantes são as mesmas portas.
	if PortaWS != 5066 || PortaSIPNavegador != 5070 || PortaTLS != 5061 || PortaESL != 8021 || PortaDiscagem != 8091 ||
		MidiaInicio != 16384 || MidiaFim != 16683 || TurnInicio != 49152 || TurnFim != 49451 {
		t.Error("as constantes das portas não são as da seção 1 do contrato")
	}
}

// A discagem fica com o agente, pelo mod_xml_curl. Quando ele não responde, vale o dialplan do arquivo:
// uma extensão só, que responde 503.
func TestFreeSWITCH_Discagem(t *testing.T) {
	doc := documento(t, configDeTeste(), false)

	binding := configuracao(t, doc, "xml_curl.conf").filho(t, "bindings", "").filho(t, "binding", "starsonic")
	mesmos(t, "o binding starsonic", binding.parametros(), []string{
		"gateway-url=http://127.0.0.1:8091/freeswitch/discagem", "timeout=5",
		"enable-post-var=Unique-ID", "enable-post-var=Hunt-Context", "enable-post-var=Hunt-Destination-Number",
		"enable-post-var=variable_sip_h_X-Starsonic-Senha", "enable-post-var=variable_sofia_profile_name",
	})

	contexto := doc.filho(t, "section", "dialplan").filho(t, "context", "reunioes")
	extensao := contexto.filho(t, "extension", "")
	acoes := extensao.filho(t, "condition", "").filhos("action")
	if len(acoes) != 1 {
		t.Fatalf("a extensão tem %d ações, want 1", len(acoes))
	}
	app, _ := acoes[0].atributo("application")
	data, _ := acoes[0].atributo("data")
	if app != "respond" || data != "503 Service Unavailable" {
		t.Errorf("a ação é %s %q, want respond \"503 Service Unavailable\"", app, data)
	}
}

func TestFreeSWITCH_Perfis(t *testing.T) {
	doc := documento(t, configDeTeste(), false)
	comuns := []string{
		"rtp-ip=10.0.0.5", "ext-rtp-ip=203.0.113.10", "ext-sip-ip=203.0.113.10",
		"context=reunioes", "dialplan=XML", "auth-calls=false", "disable-register=true",
		"inbound-late-negotiation=true", "rtp-timeout-sec=60", "rtp-hold-timeout-sec=600",
		"apply-candidate-acl=wan.auto",
	}
	mesmos(t, "o perfil navegador", perfil(t, doc, "navegador"), append(slices.Clone(comuns),
		"sip-ip=127.0.0.1", "sip-port=5070", "ws-binding=127.0.0.1:5066",
		"inbound-codec-prefs=OPUS,VP8", "outbound-codec-prefs=OPUS,VP8",
	))
	mesmos(t, "o perfil tls", perfil(t, doc, "tls"), append(slices.Clone(comuns),
		"sip-ip=10.0.0.5", "sip-port=5080", "tls=true", "tls-only=true", "tls-sip-port=5061",
		"tls-cert-dir=/etc/starsonic-video/freeswitch/tls", "tls-version=tlsv1.2",
		"inbound-codec-prefs=OPUS,PCMU,PCMA,VP8", "outbound-codec-prefs=OPUS,PCMU,PCMA,VP8",
	))
}

func TestFreeSWITCH_Conferencia(t *testing.T) {
	doc := documento(t, configDeTeste(), false)
	starsonic := configuracao(t, doc, "conference.conf").filho(t, "profiles", "").filho(t, "profile", "starsonic").parametros()
	mesmos(t, "o perfil starsonic", starsonic, []string{
		"rate=48000", "interval=20", "channels=1",
		"video-mode=mux", "video-layout-name=group:starsonic-grade", "video-canvas-size=1280x720",
		"video-fps=15", "video-codec-bandwidth=1.5mb",
		"video-canvas-bgcolor=#04060E", "video-letterbox-bgcolor=#04060E",
		"video-no-video-avatar=/etc/starsonic-video/freeswitch/sem-camera.png",
		"max-members=12", "conference-flags=minimize-video-encoding", "verbose-events=true", "caller-controls=none",
	})
	for _, p := range starsonic {
		nome, _, _ := strings.Cut(p, "=")
		if strings.HasSuffix(nome, "-sound") || nome == "auto-record" || nome == "cdr-log-dir" {
			t.Errorf("o perfil starsonic tem o %s", nome)
		}
	}
}

// imagem é um quadro de um layout, como o teste o lê: x, y, scale, hscale (igual ao scale quando
// falta) e reservation_id.
type imagem struct {
	x, y, scale, hscale int
	reserva             string
}

func (i imagem) String() string {
	return fmt.Sprintf("(%d,%d,%d,%d %q)", i.x, i.y, i.scale, i.hscale, i.reserva)
}

// A tabela da seção 7 do docs/video-agente.md.
func layoutsDoContrato() map[string][]imagem {
	q := func(x, y, scale int) imagem { return imagem{x, y, scale, scale, ""} }
	layouts := map[string][]imagem{
		"starsonic-1": {q(0, 0, 360)},
		"starsonic-2": {q(0, 90, 180), q(180, 90, 180)},
		"starsonic-4": {q(0, 0, 180), q(180, 0, 180), q(0, 180, 180), q(180, 180, 180)},
		"starsonic-6": {q(0, 60, 120), q(120, 60, 120), q(240, 60, 120), q(0, 180, 120), q(120, 180, 120), q(240, 180, 120)},
		"starsonic-apresentacao": {
			{0, 0, 300, 300, "tela"},
			q(300, 0, 60), q(300, 60, 60), q(300, 120, 60), q(300, 180, 60), q(300, 240, 60), q(300, 300, 60),
			q(60, 300, 60), q(120, 300, 60), q(180, 300, 60), q(240, 300, 60),
		},
	}
	for _, y := range []int{0, 120, 240} { // linha por linha
		for _, x := range []int{0, 120, 240} {
			layouts["starsonic-9"] = append(layouts["starsonic-9"], q(x, y, 120))
		}
		for _, x := range []int{0, 90, 180, 270} {
			layouts["starsonic-12"] = append(layouts["starsonic-12"], imagem{x, y, 90, 120, ""})
		}
	}
	return layouts
}

func TestFreeSWITCH_Camadas(t *testing.T) {
	doc := documento(t, configDeTeste(), false)
	ajustes := configuracao(t, doc, "conference_layouts.conf").filho(t, "layout-settings", "")

	numero := func(img no, nome string) int {
		t.Helper()
		v, ok := img.atributo(nome)
		if !ok {
			return -1
		}
		var n int
		if _, err := fmt.Sscan(v, &n); err != nil || fmt.Sprint(n) != v {
			t.Fatalf("o %s %q não é um número", nome, v)
		}
		return n
	}

	lidos := map[string][]imagem{}
	reservas := 0
	for _, layout := range ajustes.filho(t, "layouts", "").filhos("layout") {
		nome, _ := layout.atributo("name")
		if _, repetido := lidos[nome]; repetido {
			t.Errorf("o layout %s aparece duas vezes", nome)
		}
		lidos[nome] = []imagem{}
		for _, img := range layout.filhos("image") {
			q := imagem{x: numero(img, "x"), y: numero(img, "y"), scale: numero(img, "scale"), hscale: numero(img, "hscale")}
			if q.hscale == -1 {
				q.hscale = q.scale
			} else if q.hscale == q.scale {
				t.Errorf("%s: um quadro com o hscale igual ao scale (%d), que devia faltar", nome, q.scale)
			}
			q.reserva, _ = img.atributo("reservation_id")
			if q.reserva != "" {
				reservas++
			}
			for _, a := range img.Atributos {
				switch a.Name.Local {
				case "x", "y", "scale", "hscale", "reservation_id":
				default:
					// Nenhum quadro é o "floor": cada pessoa fica no seu lugar enquanto fala.
					t.Errorf("%s: um quadro tem o atributo %s=%q", nome, a.Name.Local, a.Value)
				}
			}
			lidos[nome] = append(lidos[nome], q)
		}
	}

	contrato := layoutsDoContrato()
	if len(lidos) != len(contrato) {
		t.Errorf("há %d layouts, want %d", len(lidos), len(contrato))
	}
	for nome, quadros := range contrato {
		if !slices.Equal(lidos[nome], quadros) {
			t.Errorf("o layout %s:\n got %v\nwant %v", nome, lidos[nome], quadros)
		}
	}
	// O reservation_id tela só na tela da apresentação, que a tabela acima já confere.
	if reservas != 1 {
		t.Errorf("há %d quadros com reservation_id, want 1 (a tela da apresentação)", reservas)
	}

	var grupo []string
	for _, l := range ajustes.filho(t, "groups", "").filho(t, "group", "starsonic-grade").filhos("layout") {
		grupo = append(grupo, l.Texto)
	}
	seis := []string{"starsonic-1", "starsonic-2", "starsonic-4", "starsonic-6", "starsonic-9", "starsonic-12"}
	if !slices.Equal(grupo, seis) {
		t.Errorf("o grupo starsonic-grade:\n got %q\nwant %q", grupo, seis)
	}
}

// Review Focus 2: quem fecha a aba ou perde a rede sai pelos 60 segundos sem mídia.
func TestFreeSWITCH_TempoSemMidia(t *testing.T) {
	for _, teste := range []bool{false, true} {
		doc := documento(t, configDeTeste(), teste)
		for _, nome := range []string{"navegador", "tls"} {
			if v := valor(t, perfil(t, doc, nome), "rtp-timeout-sec"); v != "60" {
				t.Errorf("teste=%v: o perfil %s tem o rtp-timeout-sec %s, want 60", teste, nome, v)
			}
		}
	}
}

func TestFreeSWITCH_ModoDeTeste(t *testing.T) {
	for _, caso := range []struct {
		teste bool
		acl   []string
	}{
		{false, []string{"wan.auto"}},
		{true, []string{"rfc1918.auto", "localnet.auto"}},
	} {
		doc := documento(t, configDeTeste(), caso.teste)
		for _, nome := range []string{"navegador", "tls"} {
			mesmos(t, fmt.Sprintf("teste=%v: o apply-candidate-acl do perfil %s", caso.teste, nome),
				valores(perfil(t, doc, nome), "apply-candidate-acl"), caso.acl)
		}
	}
}

func TestFreeSWITCH_IPs(t *testing.T) {
	doc := documento(t, configDeTeste(), false)
	for nome, sipIP := range map[string]string{"navegador": "127.0.0.1", "tls": "10.0.0.5"} {
		p := perfil(t, doc, nome)
		for parametro, ip := range map[string]string{"sip-ip": sipIP, "rtp-ip": "10.0.0.5", "ext-rtp-ip": "203.0.113.10", "ext-sip-ip": "203.0.113.10"} {
			if v := valor(t, p, parametro); v != ip {
				t.Errorf("o perfil %s tem o %s %s, want %s", nome, parametro, v, ip)
			}
		}
	}
}

func TestFreeSWITCH_Codecs(t *testing.T) {
	doc := documento(t, configDeTeste(), false)
	for nome, codecs := range map[string]string{"navegador": "OPUS,VP8", "tls": "OPUS,PCMU,PCMA,VP8"} {
		p := perfil(t, doc, nome)
		if valor(t, p, "inbound-codec-prefs") != codecs || valor(t, p, "outbound-codec-prefs") != codecs {
			t.Errorf("os codecs do perfil %s: %v, want %s", nome, p, codecs)
		}
		if valor(t, p, "inbound-late-negotiation") != "true" {
			t.Errorf("o perfil %s sem o inbound-late-negotiation", nome)
		}
	}
	if valores(perfil(t, doc, "tls"), "ws-binding") != nil {
		t.Error("o perfil tls tem o ws-binding")
	}
}

// Todo valor que vai num atributo passa pelo escape do XML: um valor com aspas, <, > e & volta igual.
func TestFreeSWITCH_Escape(t *testing.T) {
	c := configDeTeste()
	c.SenhaESL = `a"b'c<d>e&f` + strings.Repeat("x", 24)
	pasta := `/tmp/a&b"c'd<e>f`
	dados, err := FreeSWITCH(c, pasta, false)
	if err != nil {
		t.Fatal(err)
	}
	doc := ler(t, dados)
	esl := configuracao(t, doc, "event_socket.conf").filho(t, "settings", "").parametros()
	if v := valor(t, esl, "password"); v != c.SenhaESL {
		t.Errorf("a senha voltou %q, want %q", v, c.SenhaESL)
	}
	if v := valor(t, perfil(t, doc, "tls"), "tls-cert-dir"); v != pasta+"/tls" {
		t.Errorf("o tls-cert-dir voltou %q", v)
	}
	starsonic := configuracao(t, doc, "conference.conf").filho(t, "profiles", "").filho(t, "profile", "starsonic").parametros()
	if v := valor(t, starsonic, "video-no-video-avatar"); v != pasta+"/sem-camera.png" {
		t.Errorf("o video-no-video-avatar voltou %q", v)
	}
}

func TestFreeSWITCH_PastaRelativa(t *testing.T) {
	if _, err := FreeSWITCH(configDeTeste(), "etc/freeswitch", false); err == nil {
		t.Error("FreeSWITCH aceitou uma pasta relativa")
	}
}

// linhas devolve as linhas do turnserver.conf, sem os comentários e as linhas vazias.
func linhas(t *testing.T, dados []byte) []string {
	t.Helper()
	var lista []string
	s := bufio.NewScanner(bytes.NewReader(dados))
	for s.Scan() {
		l := s.Text()
		if l != strings.TrimSpace(l) {
			t.Errorf("a linha %q tem espaço nas pontas", l)
		}
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		lista = append(lista, l)
	}
	return lista
}

func TestTurn(t *testing.T) {
	comuns := []string{
		"listening-port=3478", "tls-listening-port=5349",
		"min-port=49152", "max-port=49451",
		"fingerprint", "use-auth-secret", "static-auth-secret=" + segredoVetor, "realm=video.exemplo.com.br",
		"cert=/etc/starsonic-video/tls/turn-certificado.pem", "pkey=/etc/starsonic-video/tls/turn-chave.pem",
		"no-tcp", "no-dtls", "no-tlsv1", "no-tlsv1_1", "no-multicast-peers", "no-cli", "no-tcp-relay",
		"denied-peer-ip=0.0.0.0-255.255.255.255", "denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
		"user-quota=12", "total-quota=1200", "syslog",
	}

	t.Run("IPs diferentes", func(t *testing.T) {
		mesmos(t, "turnserver.conf", linhas(t, Turn(configDeTeste())), append(slices.Clone(comuns),
			"listening-ip=10.0.0.5", "relay-ip=10.0.0.5", "external-ip=203.0.113.10/10.0.0.5",
			"allowed-peer-ip=10.0.0.5", "allowed-peer-ip=203.0.113.10",
		))
	})
	t.Run("IPs iguais", func(t *testing.T) {
		c := configDeTeste()
		c.IPPublico = c.IPPrivado
		mesmos(t, "turnserver.conf", linhas(t, Turn(c)), append(slices.Clone(comuns),
			"listening-ip=10.0.0.5", "relay-ip=10.0.0.5", "allowed-peer-ip=10.0.0.5",
		))
	})
}

func TestSemCamera(t *testing.T) {
	img, err := png.Decode(bytes.NewReader(SemCamera()))
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	if b.Dx() != 640 || b.Dy() != 360 {
		t.Fatalf("o quadro tem %dx%d, want 640x360", b.Dx(), b.Dy())
	}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			if r>>8 != 0x1B || g>>8 != 0x23 || bl>>8 != 0x33 || a>>8 != 0xFF {
				t.Fatalf("o pixel (%d,%d) é %02X%02X%02X/%02X, want #1B2333", x, y, r>>8, g>>8, bl>>8, a>>8)
			}
		}
	}
}
