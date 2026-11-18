// Package discagem responde ao mod_xml_curl do FreeSWITCH: a senha de uso único que vem no INVITE decide
// quem entra em qual reunião, e como (a seção 7 do docs/video-agente.md). O nome que a senha leva não vai ao
// FreeSWITCH. Nada daqui vai a um registro: nem a senha, nem o nome, nem a sala, nem o participante.
package discagem

import (
	"encoding/xml"
	"net/http"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/mosaico"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

const (
	contextoReunioes = "reunioes"
	destinoReuniao   = "reuniao"
	perfilTLS        = "tls"

	campoSenha  = "variable_sip_h_X-Starsonic-Senha"
	campoPerfil = "variable_sofia_profile_name"

	// A imagem que chega ao servidor, no máximo (o rtp_video_max_bandwidth_in): a da câmera e a da tela.
	bandaDaCamera = "1500kb"
	bandaDaTela   = "2500kb"

	maximoCorpo = 64 << 10
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
		r.Body = http.MaxBytesReader(w, r.Body, maximoCorpo)
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

	banda := bandaDaCamera
	if s.Tela {
		banda = bandaDaTela
	}
	acoes := []acao{
		{"set", "starsonic_participante=" + s.Participante},
		{"set", "starsonic_tela=" + boolTexto(s.Tela)},
		{"set", "rtp_video_max_bandwidth_in=" + banda},
		// O tempo sem mídia da seção 6, lido quando a mídia sobe, no answer, para o caminho do som e o do vídeo: a
		// ligação em que nada chega a um deles (nem o RTP, nem o RTCP, nem o ICE) por 60 s cai, e, na espera (o hold),
		// por 10 minutos. Só no som (o media_timeout_audio) não basta: a ligação de uma aba fechada não caía em 75 s (o
		// e2e mostrou), e é o relógio do caminho do vídeo que chega ao fim.
		{"set", "media_timeout=60000"},
		{"set", "media_hold_timeout=600000"},
		// Sem o acerto do som com o vídeo (o check_jb_sync do FreeSWITCH): a cada 300 quadros, a thread que lê o
		// vídeo cria o jitter buffer do som com a trava que a thread do som segura enquanto espera o próximo
		// pacote. Com a máquina ocupada, a do vídeo não a pega mais, para de ler o vídeo e de responder ao ICE
		// dele, e a imagem da pessoa congela (o e2e mostrou).
		{"set", "jb_av_sync_msec=disabled"},
	}
	if campo(campoPerfil) == perfilTLS {
		acoes = append(acoes, acao{"set", "rtp_secure_media=mandatory:AES_CM_128_HMAC_SHA1_80"})
	}
	if s.Tela {
		acoes = append(acoes, acao{"set", "video_reservation_id=" + mosaico.ReservaDaTela})
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
