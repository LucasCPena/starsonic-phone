// Package esl é o cliente do Event Socket do FreeSWITCH (o ESL, na 127.0.0.1:8021): autentica, assina os eventos
// das conferências e manda comandos api, um a um.
//
// Uma goroutine lê a conexão. Ela entrega cada api/response a quem espera, na ordem em que os comandos saíram, e
// põe cada evento numa fila, de onde outra goroutine os passa a quem lê o Eventos(). Assim a leitura nunca
// espera um consumidor lento: quem trata um evento pode chamar o API sem travar a resposta que ele espera.
package esl

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrDesligado é o erro de uma conexão que caiu ou foi fechada.
var ErrDesligado = errors.New("esl: desligado")

// Evento são os cabeçalhos de um evento, todos em texto.
type Evento map[string]string

const (
	assinatura   = "event json CUSTOM conference::maintenance"
	tempoInicial = 10 * time.Second // a autenticação, quando o contexto não tem prazo
	tempoEscrita = 10 * time.Second
	maxCorpo     = 8 << 20 // o maior corpo aceito, de uma resposta ou de um evento
	maxFila      = 10000   // os eventos esperando um consumidor; passou disso, a conexão cai e o chamador reconecta
)

// ErroFS é uma resposta -ERR do FreeSWITCH a um comando api. O Motivo é o texto depois do -ERR, sem o comando.
type ErroFS struct{ Motivo string }

func (e *ErroFS) Error() string { return "esl: erro do FreeSWITCH: " + e.Motivo }

type resposta struct {
	corpo string
	err   error
}

// Conexao é uma conexão autenticada com o ESL.
type Conexao struct {
	conn net.Conn

	envio sync.Mutex // um comando por vez: o registro na fila e a escrita andam juntos

	mu      sync.Mutex // protege o que segue
	espera  []chan resposta
	fila    []Evento
	fechada bool // a leitura acabou

	sinal   chan struct{} // avisa a entrega que a fila mudou
	eventos chan Evento
	leitura chan struct{} // fecha quando a leitura acaba
	entrega chan struct{} // fecha quando a entrega acaba
	parar   chan struct{} // fecha no Fechar: a entrega larga o que sobrou
	umaVez  sync.Once
}

// Conectar abre a conexão, responde ao auth/request com a senha e assina os eventos das conferências.
func Conectar(ctx context.Context, endereco, senha string) (*Conexao, error) {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", endereco)
	if err != nil {
		return nil, fmt.Errorf("esl: conectar: %w", err)
	}
	// Um contexto cancelado no meio da conversa fecha a conexão e solta a leitura.
	desarmar := context.AfterFunc(ctx, func() { conn.Close() })
	prazo := time.Now().Add(tempoInicial)
	if p, ok := ctx.Deadline(); ok {
		prazo = p
	}
	conn.SetDeadline(prazo)

	leitor := bufio.NewReader(conn)
	err = conversaInicial(conn, leitor, senha)
	if !desarmar() || err != nil {
		conn.Close()
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		return nil, err
	}
	conn.SetDeadline(time.Time{})

	c := &Conexao{
		conn:    conn,
		sinal:   make(chan struct{}, 1),
		eventos: make(chan Evento),
		leitura: make(chan struct{}),
		entrega: make(chan struct{}),
		parar:   make(chan struct{}),
	}
	go c.ler(leitor)
	go c.entregar()
	return c, nil
}

func conversaInicial(conn net.Conn, leitor *bufio.Reader, senha string) error {
	cab, _, err := lerMensagem(leitor)
	if err != nil {
		return fmt.Errorf("esl: auth/request: %w", err)
	}
	if cab["Content-Type"] != "auth/request" {
		return errors.New("esl: o servidor não pediu a autenticação")
	}
	if err := comando(conn, leitor, "auth "+senha); err != nil {
		return fmt.Errorf("esl: autenticação recusada: %w", err)
	}
	if err := comando(conn, leitor, assinatura); err != nil {
		return fmt.Errorf("esl: assinatura recusada: %w", err)
	}
	return nil
}

// comando manda uma linha e espera o command/reply, que tem de começar com +OK. O erro leva só o motivo.
func comando(conn net.Conn, leitor *bufio.Reader, linha string) error {
	if _, err := io.WriteString(conn, linha+"\n\n"); err != nil {
		return err
	}
	cab, _, err := lerMensagem(leitor)
	if err != nil {
		return err
	}
	if cab["Content-Type"] != "command/reply" {
		return errors.New("resposta inesperada")
	}
	texto := strings.TrimSpace(cab["Reply-Text"])
	if !strings.HasPrefix(texto, "+OK") {
		return fmt.Errorf("%s", strings.TrimSpace(strings.TrimPrefix(texto, "-ERR")))
	}
	return nil
}

// lerMensagem lê os cabeçalhos até a linha vazia e, havendo Content-Length, o corpo.
func lerMensagem(leitor *bufio.Reader) (map[string]string, []byte, error) {
	cab := map[string]string{}
	for {
		linha, err := leitor.ReadString('\n')
		if err != nil {
			return nil, nil, err
		}
		linha = strings.TrimRight(linha, "\r\n")
		if linha == "" {
			if len(cab) == 0 {
				continue // linhas de sobra entre as mensagens
			}
			break
		}
		nome, valor, ok := strings.Cut(linha, ":")
		if !ok {
			return nil, nil, errors.New("esl: cabeçalho ilegível")
		}
		cab[strings.TrimSpace(nome)] = strings.TrimSpace(valor)
	}
	var corpo []byte
	if v, ok := cab["Content-Length"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > maxCorpo {
			return nil, nil, errors.New("esl: Content-Length inválido")
		}
		corpo = make([]byte, n)
		if _, err := io.ReadFull(leitor, corpo); err != nil {
			return nil, nil, err
		}
	}
	return cab, corpo, nil
}

// ler é a única goroutine que lê a conexão.
func (c *Conexao) ler(leitor *bufio.Reader) {
	defer c.encerrarLeitura()
	for {
		cab, corpo, err := lerMensagem(leitor)
		if err != nil {
			return
		}
		switch cab["Content-Type"] {
		case "api/response":
			c.entregarResposta(string(corpo))
		case "text/event-json":
			ev, err := lerEvento(corpo)
			if err != nil {
				return // um evento ilegível quebra a sincronia: a conexão cai e o chamador reconecta
			}
			if !c.enfileirar(ev) {
				return
			}
		}
	}
}

func (c *Conexao) entregarResposta(corpo string) {
	c.mu.Lock()
	var ch chan resposta
	if len(c.espera) > 0 {
		ch = c.espera[0]
		c.espera[0] = nil
		c.espera = c.espera[1:]
	}
	c.mu.Unlock()
	if ch == nil {
		return // uma resposta que ninguém esperava
	}
	if strings.HasPrefix(corpo, "-ERR") {
		motivo := strings.TrimSpace(strings.TrimPrefix(corpo, "-ERR"))
		ch <- resposta{err: &ErroFS{Motivo: motivo}}
		return
	}
	ch <- resposta{corpo: corpo}
}

func (c *Conexao) enfileirar(ev Evento) bool {
	c.mu.Lock()
	if len(c.fila) >= maxFila {
		c.mu.Unlock()
		return false
	}
	c.fila = append(c.fila, ev)
	c.mu.Unlock()
	select {
	case c.sinal <- struct{}{}:
	default:
	}
	return true
}

// encerrarLeitura roda quando a leitura acaba, por erro, queda ou Fechar: quem esperava uma resposta recebe o
// ErrDesligado, e a entrega fecha o canal dos eventos depois de entregar o que já chegou.
func (c *Conexao) encerrarLeitura() {
	c.conn.Close()
	c.mu.Lock()
	c.fechada = true
	espera := c.espera
	c.espera = nil
	c.mu.Unlock()
	for _, ch := range espera {
		ch <- resposta{err: ErrDesligado}
	}
	close(c.leitura)
}

// entregar passa os eventos da fila ao canal, na ordem, e fecha o canal no fim.
func (c *Conexao) entregar() {
	defer close(c.entrega)
	defer close(c.eventos)
	for {
		c.mu.Lock()
		var ev Evento
		tem := len(c.fila) > 0
		if tem {
			ev = c.fila[0]
			c.fila[0] = nil
			c.fila = c.fila[1:]
			if len(c.fila) == 0 {
				c.fila = nil
			}
		}
		fechada := c.fechada
		c.mu.Unlock()
		if tem {
			select {
			case c.eventos <- ev:
			case <-c.parar:
				return
			}
			continue
		}
		if fechada {
			return
		}
		select {
		case <-c.sinal:
		case <-c.leitura:
		case <-c.parar:
			return
		}
	}
}

// lerEvento lê o JSON do evento. Os valores viram texto: os que já são texto ficam como estão, o null vira o
// texto vazio, e o resto (números, booleanos e o que for composto) vira o seu JSON.
func lerEvento(corpo []byte) (Evento, error) {
	dec := json.NewDecoder(bytes.NewReader(corpo))
	dec.UseNumber()
	var bruto map[string]json.RawMessage
	if err := dec.Decode(&bruto); err != nil {
		return nil, err
	}
	ev := make(Evento, len(bruto))
	for k, v := range bruto {
		var s string
		switch {
		case string(v) == "null":
			ev[k] = ""
		case json.Unmarshal(v, &s) == nil:
			ev[k] = s
		default:
			ev[k] = string(v)
		}
	}
	return ev, nil
}

// API manda "api <comando>" e devolve o corpo da resposta, inteiro. Uma resposta que começa com -ERR vira um
// erro só com o motivo, sem o comando. Várias chamadas ao mesmo tempo saem em fila, e cada uma recebe a sua
// resposta, na ordem. O ctx solta quem espera, mas não cancela o comando no FreeSWITCH.
func (c *Conexao) API(ctx context.Context, comando string) (string, error) {
	if strings.ContainsAny(comando, "\r\n") {
		return "", errors.New("esl: comando com quebra de linha")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ch := make(chan resposta, 1)

	c.envio.Lock()
	c.mu.Lock()
	if c.fechada {
		c.mu.Unlock()
		c.envio.Unlock()
		return "", ErrDesligado
	}
	c.espera = append(c.espera, ch)
	c.mu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(tempoEscrita))
	_, err := io.WriteString(c.conn, "api "+comando+"\n\n")
	c.envio.Unlock()
	if err != nil {
		c.conn.Close() // a leitura nota, e quem esperava recebe o ErrDesligado
		return "", ErrDesligado
	}

	select {
	case r := <-ch:
		return r.corpo, r.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Eventos é o canal dos eventos das conferências. Ele fecha quando a conexão cai ou é fechada.
func (c *Conexao) Eventos() <-chan Evento { return c.eventos }

// Fechar fecha a conexão, solta quem espera (com o ErrDesligado) e larga os eventos que ninguém leu. Pode ser
// chamado mais de uma vez.
func (c *Conexao) Fechar() error {
	c.umaVez.Do(func() { close(c.parar) })
	c.conn.Close()
	<-c.leitura
	<-c.entrega
	return nil
}
