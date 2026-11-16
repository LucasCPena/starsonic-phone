// Package discagem responde ao mod_xml_curl do FreeSWITCH: a senha de uso único que vem no INVITE decide
// quem entra em qual reunião, e como (a seção 7 do docs/video-agente.md). Nada daqui vai a um registro:
// nem a senha, nem o nome, nem a sala, nem o participante.
package discagem

import (
	"encoding/xml"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

const (
	contextoReunioes = "reunioes"
	destinoReuniao   = "reuniao"
	perfilTLS        = "tls"

	campoSenha  = "variable_sip_h_X-Starsonic-Senha"
	campoPerfil = "variable_sofia_profile_name"

	estiloQuadro = "{font_scale=0.25,min_font_size=8,max_font_size=20,fg=#FFFFFF,bg=#04060E}"

	maximoNome    = 40
	nomePadrao    = "Convidado"
	nomeDaTelaFmt = "Tela de "
)

// Os tipos do documento freeswitch/xml. O encoding/xml escreve os textos, então nada do que vem de uma
// pessoa precisa de escape à mão.
type documento struct {
	XMLName xml.Name `xml:"document"`
	Tipo    string   `xml:"type,attr"`
	Secao   secao    `xml:"section"`
}

type secao struct {
	Nome      string     `xml:"name,attr"`
	Resultado *resultado `xml:"result,omitempty"`
	Contexto  *contexto  `xml:"context,omitempty"`
}

type resultado struct {
	Status string `xml:"status,attr"`
}

type contexto struct {
	Nome     string   `xml:"name,attr"`
	Extensao extensao `xml:"extension"`
}

type extensao struct {
	Nome     string   `xml:"name,attr"`
	Condicao condicao `xml:"condition"`
}

type condicao struct {
	Acoes []acao `xml:"action"`
}

type acao struct {
	Aplicacao string `xml:"application,attr"`
	Dados     string `xml:"data,attr,omitempty"`
}

func naoEncontrado() documento {
	return documento{Tipo: "freeswitch/xml", Secao: secao{Nome: "result", Resultado: &resultado{Status: "not found"}}}
}

func extensaoDe(nome string, acoes ...acao) documento {
	return documento{Tipo: "freeswitch/xml", Secao: secao{Nome: "dialplan", Contexto: &contexto{
		Nome:     contextoReunioes,
		Extensao: extensao{Nome: nome, Condicao: condicao{Acoes: acoes}},
	}}}
}

func recusa(codigoETexto string) documento {
	return extensaoDe("recusa", acao{"respond", codigoETexto})
}

// LimparNome é a regra da seção 7: ficam só as letras, as marcas de acento, os números, o espaço e os sinais
// . - ' ( ); os espaços seguidos viram um e as pontas saem; no máximo 40 caracteres; vazio vira "Convidado".
func LimparNome(nome string) string {
	var b strings.Builder
	n := 0
	espaco := false
	for _, r := range nome {
		switch {
		case r == ' ':
			espaco = true
			continue
		case unicode.IsLetter(r), unicode.IsMark(r), unicode.IsNumber(r),
			r == '.', r == '-', r == '\'', r == '(', r == ')':
		default:
			continue
		}
		// um espaço só vale entre dois caracteres que ficam
		if espaco && n > 0 {
			if n >= maximoNome {
				break
			}
			b.WriteByte(' ')
			n++
		}
		espaco = false
		if n >= maximoNome {
			break
		}
		b.WriteRune(r)
		n++
	}
	if limpo := strings.TrimSpace(b.String()); limpo != "" {
		return limpo
	}
	return nomePadrao
}

// Nova devolve o handler do POST /freeswitch/discagem. Uma senha assinada antes de o agente começar é
// recusada: a memória do uso único some quando ele reinicia, e a senha ainda valeria.
func Nova(chave []byte, uso *senha.UsoUnico, agora func() time.Time) http.Handler {
	comeco := agora()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
			return
		}
		// O ParseForm já limita o corpo a 10 MB; o MaxBytesReader fica fora porque o govulncheck acusa o
		// GO-2026-6859 (net/http 1.27.3) por ele.
		if err := r.ParseForm(); err != nil {
			http.Error(w, "pedido inválido", http.StatusBadRequest)
			return
		}
		responder(w, decidir(r.PostForm, chave, uso, agora, comeco))
	})
}

func decidir(f map[string][]string, chave []byte, uso *senha.UsoUnico, agora func() time.Time, comeco time.Time) documento {
	campo := func(nome string) string {
		if v := f[nome]; len(v) > 0 {
			return v[0]
		}
		return ""
	}
	if campo("section") != "dialplan" || campo("Hunt-Context") != contextoReunioes {
		return naoEncontrado()
	}
	if campo("Hunt-Destination-Number") != destinoReuniao {
		return recusa("404 Not Found")
	}
	proibido := recusa("403 Forbidden")
	texto := campo(campoSenha)
	if texto == "" {
		return proibido
	}
	t := agora()
	s, err := senha.Verificar(chave, texto, t)
	if err != nil {
		return proibido
	}
	// Assinada antes de o agente começar: a memória do uso único não a conhece.
	if time.UnixMilli(s.Vence).Add(-senha.Duracao).Before(comeco) {
		return proibido
	}
	if err := uso.Usar(s, t); err != nil {
		return proibido
	}

	nome := LimparNome(s.Nome)
	if s.Tela {
		nome = nomeDaTelaFmt + nome
	}
	acoes := []acao{
		{"set", "starsonic_participante=" + s.Participante},
		{"set", "starsonic_tela=" + boolTexto(s.Tela)},
		{"set", "video_banner_text=" + estiloQuadro + nome},
		{"set", "rtp_video_max_bandwidth_in=1000kb"},
	}
	if campo(campoPerfil) == perfilTLS {
		acoes = append(acoes, acao{"set", "rtp_secure_media=mandatory:AES_CM_128_HMAC_SHA1_80"})
	}
	if s.Tela {
		acoes = append(acoes, acao{"set", "video_reservation_id=tela"})
	}
	var bandeiras []string
	if s.Papel == senha.Fora {
		bandeiras = append(bandeiras, "join-only")
	}
	if s.Tela {
		bandeiras = append(bandeiras, "mute", "deaf")
	}
	conferencia := s.Sala + "@starsonic"
	if len(bandeiras) > 0 {
		conferencia += "+flags{" + strings.Join(bandeiras, "|") + "}"
	}
	acoes = append(acoes, acao{"answer", ""}, acao{"conference", conferencia})
	return extensaoDe("reuniao", acoes...)
}

func boolTexto(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func responder(w http.ResponseWriter, d documento) {
	corpo, err := xml.MarshalIndent(d, "", "  ")
	if err != nil {
		http.Error(w, "erro interno", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(append([]byte(xml.Header), corpo...))
}
