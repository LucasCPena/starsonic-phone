package reunioes

import (
	"net"
	"slices"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// Os tempos das senhas (docs/chat-protocolo.md, seção 12), todos no relógio do servidor de vídeo.
const (
	duracaoSenha = 30 * time.Second // a senha de uso único
	duracaoTurn  = 12 * time.Hour   // as credenciais do TURN
	// graca é quanto o nome e o computador de quem recebeu uma senha e ainda não entrou ficam depois de ela vencer:
	// uma ligação que o agente aceitou no último segundo leva um tempo para entrar na sala (o ICE e o DTLS), e o
	// entrou dela ainda acha o nome.
	graca = time.Minute
)

// Turn são as credenciais do TURN (docs/video-agente.md, seção 4).
type Turn struct {
	URLs    []string `json:"urls"`
	Usuario string   `json:"usuario"`
	Senha   string   `json:"senha"`
}

// Enderecos são os do servidor de vídeo: o wss e a uri, que o navegador usa, e o sip, que o app usa.
type Enderecos struct {
	WSS string `json:"wss"`
	URI string `json:"uri"`
	SIP string `json:"sip"`
}

// Acesso é o que quem entra recebe (seção 9 do protocolo): o participante, a senha de uso único, o TURN e os
// endereços. A API do app põe a reuniao junto; a página o recebe no aceito, sem ela.
type Acesso struct {
	Participante string    `json:"participante"`
	Senha        string    `json:"senha"`
	Turn         Turn      `json:"turn"`
	Video        Enderecos `json:"video"`
}

// pendente é uma senha emitida e ainda não usada: a da câmera ou a da tela.
type pendente struct {
	vence time.Time // no relógio do servidor de vídeo
	tela  bool
}

// doVideo é o que o gerente lê do servidor de vídeo antes de travar o mutex: nenhuma chamada ao Video acontece
// com ele travado.
type doVideo struct {
	v        Video
	geracao  uint64 // a do Ligar que o ligou
	noAr     bool
	agora    time.Time // o relógio do servidor de vídeo
	chave    []byte
	endereco string
	wss      string
}

// lerVideo lê o servidor de vídeo ligado. Sem nenhum, o v vem nil.
func (g *Gerente) lerVideo() doVideo {
	g.mu.Lock()
	v, geracao := g.video, g.geracao
	g.mu.Unlock()
	if v == nil {
		return doVideo{}
	}
	return doVideo{v: v, geracao: geracao, noAr: v.NoAr(), agora: v.Agora(), chave: v.Chave(),
		endereco: v.Endereco(), wss: v.WSS()}
}

// serve diz se o servidor lido está no ar e ainda é o ligado: nenhum Ligar veio depois da leitura. Com g.mu.
func (g *Gerente) serve(d doVideo) bool { return d.v != nil && d.noAr && d.geracao == g.geracao }

// emitir assina uma senha de uso único para o participante, com o vence 30 s depois no relógio do servidor de
// vídeo e um id novo, e a guarda como pendente. Com g.mu (é só o HMAC: nada chama o Video).
func emitir(d doVideo, s *sala, p *participante, tela bool) (string, error) {
	vence := d.agora.Add(duracaoSenha)
	texto, err := video.AssinarSenha(d.chave, video.Senha{V: 1, Sala: s.id, Participante: p.id, Papel: p.papel,
		Tela: tela, Nome: p.nome, Vence: vence.UnixMilli(), ID: segredo.NovoHex(16)})
	if err != nil {
		return "", err
	}
	p.pendentes = append(p.pendentes, pendente{vence: vence, tela: tela})
	if !p.naReuniao {
		p.esquecerEm = maisTarde(p.esquecerEm, vence.Add(graca))
	}
	return texto, nil
}

// acesso monta o Acesso do participante: o TURN vence em 12 h, e o <host> dos endereços é o do servidor de vídeo
// sem a porta.
func (d doVideo) acesso(participante, senha string) Acesso {
	host := d.endereco
	if h, _, err := net.SplitHostPort(d.endereco); err == nil {
		host = h
	}
	usuario, senhaTurn := video.CredencialTurn(video.SegredoTurn(d.chave), participante, d.agora.Add(duracaoTurn))
	return Acesso{
		Participante: participante,
		Senha:        senha,
		Turn: Turn{
			URLs:    []string{"turn:" + host + ":3478?transport=udp", "turns:" + host + ":5349?transport=tcp"},
			Usuario: usuario,
			Senha:   senhaTurn,
		},
		Video: Enderecos{WSS: d.wss, URI: "sip:reuniao@" + host, SIP: "sips:reuniao@" + host + ":5061;transport=tls"},
	}
}

// temSenha diz se o participante tem uma senha pendente da tela (tela verdadeiro) ou da câmera.
func (p *participante) temSenha(tela bool) bool {
	return slices.ContainsFunc(p.pendentes, func(s pendente) bool { return s.tela == tela })
}

// usouSenha: a ligação da tela (ou da câmera) entrou, e as senhas pendentes dela não servem mais.
func (p *participante) usouSenha(tela bool) {
	p.pendentes = slices.DeleteFunc(p.pendentes, func(s pendente) bool { return s.tela == tela })
}

// vencerSenhas tira as senhas pendentes vencidas: agora, no relógio do servidor de vídeo, já não é antes do vence.
func (p *participante) vencerSenhas(agoraVideo time.Time) {
	p.pendentes = slices.DeleteFunc(p.pendentes, func(s pendente) bool { return !agoraVideo.Before(s.vence) })
}

func maisTarde(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
