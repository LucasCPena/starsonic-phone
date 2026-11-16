// Package esltest é um FreeSWITCH falso, só com o que o cliente do ESL usa: a autenticação, a assinatura dos
// eventos e o comando api. Serve aos testes do esl, das salas e do servidor.
package esltest

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
)

type resposta struct {
	prefixo string
	texto   string
	segurar bool
	atraso  time.Duration
}

type ligacao struct {
	conn     net.Conn
	escrita  sync.Mutex
	assinada bool
}

// Servidor é o FreeSWITCH falso. Cada ligação que ele aceita começa com o auth/request.
type Servidor struct {
	t     testing.TB
	senha string
	ln    net.Listener
	wg    sync.WaitGroup

	mu        sync.Mutex
	ligacoes  []*ligacao
	comandos  []string
	respostas []resposta
}

// Novo escuta em 127.0.0.1:0 e fecha tudo no fim do teste.
func Novo(t testing.TB, senha string) *Servidor {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("esltest: escutar: %v", err)
	}
	s := &Servidor{t: t, senha: senha, ln: ln}
	s.wg.Add(1)
	go s.aceitar()
	t.Cleanup(s.Fechar)
	return s
}

// Endereco é o host:porta onde o servidor escuta.
func (s *Servidor) Endereco() string { return s.ln.Addr().String() }

// Responder faz o comando api que começa com o prefixo (sem o "api ") receber esta resposta, inteira. Vale a
// última chamada que casa.
func (s *Servidor) Responder(prefixo, resposta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.respostas = append(s.respostas, novaResposta(prefixo, resposta, false))
}

// Segurar faz o comando api que começa com o prefixo nunca receber resposta.
func (s *Servidor) Segurar(prefixo string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.respostas = append(s.respostas, novaResposta(prefixo, "", true))
}

func novaResposta(prefixo, texto string, segurar bool) resposta {
	return resposta{prefixo: prefixo, texto: texto, segurar: segurar}
}

// Atrasar faz o comando api que começa com o prefixo ser respondido, com a resposta dada, só depois do atraso.
// Os comandos seguintes esperam, como no FreeSWITCH, que responde na ordem.
func (s *Servidor) Atrasar(prefixo string, atraso time.Duration, resposta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := novaResposta(prefixo, resposta, false)
	r.atraso = atraso
	s.respostas = append(s.respostas, r)
}

// Fechar para de escutar e derruba as ligações.
func (s *Servidor) Fechar() {
	s.ln.Close()
	s.Derrubar()
	s.wg.Wait()
}

// Comandos são as linhas recebidas, na ordem e como chegaram: "auth <senha>", "event json ..." e "api ...".
func (s *Servidor) Comandos() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.comandos...)
}

// Mandar manda um evento (text/event-json) a quem já assinou os eventos.
func (s *Servidor) Mandar(ev esl.Evento) {
	corpo, err := json.Marshal(map[string]string(ev))
	if err != nil {
		s.t.Errorf("esltest: evento: %v", err)
		return
	}
	s.MandarJSON(string(corpo))
}

// MandarJSON manda o corpo, como está, como um evento text/event-json.
func (s *Servidor) MandarJSON(corpo string) {
	msg := fmt.Sprintf("Content-Type: text/event-json\nContent-Length: %d\n\n%s", len(corpo), corpo)
	s.mu.Lock()
	alvo := append([]*ligacao(nil), s.ligacoes...)
	s.mu.Unlock()
	for _, l := range alvo {
		l.escrita.Lock()
		ok := l.assinada
		l.escrita.Unlock()
		if ok {
			l.escreve(msg)
		}
	}
}

// Derrubar fecha as ligações abertas. O servidor continua escutando.
func (s *Servidor) Derrubar() {
	s.mu.Lock()
	alvo := s.ligacoes
	s.ligacoes = nil
	s.mu.Unlock()
	for _, l := range alvo {
		l.conn.Close()
	}
}

func (l *ligacao) escreve(msg string) {
	l.escrita.Lock()
	defer l.escrita.Unlock()
	io.WriteString(l.conn, msg)
}

func (s *Servidor) aceitar() {
	defer s.wg.Done()
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		l := &ligacao{conn: conn}
		s.mu.Lock()
		s.ligacoes = append(s.ligacoes, l)
		s.mu.Unlock()
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			defer conn.Close()
			s.servir(l)
		}()
	}
}

func (s *Servidor) servir(l *ligacao) {
	l.escreve("Content-Type: auth/request\n\n")
	leitor := bufio.NewReader(l.conn)
	for {
		linha, err := leitor.ReadString('\n')
		if err != nil {
			return
		}
		linha = strings.TrimRight(linha, "\r\n")
		if linha == "" {
			continue
		}
		// Depois de cada comando vem uma linha vazia.
		if vazia, err := leitor.ReadString('\n'); err != nil || strings.TrimSpace(vazia) != "" {
			return
		}
		s.mu.Lock()
		s.comandos = append(s.comandos, linha)
		s.mu.Unlock()

		switch {
		case strings.HasPrefix(linha, "auth "):
			if linha == "auth "+s.senha {
				l.escreve("Content-Type: command/reply\nReply-Text: +OK accepted\n\n")
			} else {
				l.escreve("Content-Type: command/reply\nReply-Text: -ERR invalid\n\n")
				return
			}
		case strings.HasPrefix(linha, "event "):
			l.escrita.Lock()
			l.assinada = true
			l.escrita.Unlock()
			l.escreve("Content-Type: command/reply\nReply-Text: +OK event listener enabled json\n\n")
		case strings.HasPrefix(linha, "api "):
			s.responderAPI(l, strings.TrimPrefix(linha, "api "))
		default:
			l.escreve("Content-Type: command/reply\nReply-Text: -ERR command not found\n\n")
		}
	}
}

func (s *Servidor) responderAPI(l *ligacao, comando string) {
	s.mu.Lock()
	var achada *resposta
	for i := len(s.respostas) - 1; i >= 0; i-- {
		if strings.HasPrefix(comando, s.respostas[i].prefixo) {
			achada = &s.respostas[i]
			break
		}
	}
	s.mu.Unlock()
	texto := "-ERR no such command\n"
	if achada != nil {
		if achada.segurar {
			return
		}
		texto = achada.texto
		time.Sleep(achada.atraso)
	}
	l.escreve(fmt.Sprintf("Content-Type: api/response\nContent-Length: %d\n\n%s", len(texto), texto))
}
