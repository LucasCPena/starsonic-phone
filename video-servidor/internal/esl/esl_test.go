package esl_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl/esltest"
)

const senhaTeste = "senha-de-teste"

func ctxTeste(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func conectar(t *testing.T, fs *esltest.Servidor) *esl.Conexao {
	t.Helper()
	c, err := esl.Conectar(ctxTeste(t), fs.Endereco(), senhaTeste)
	if err != nil {
		t.Fatalf("Conectar: %v", err)
	}
	t.Cleanup(func() { c.Fechar() })
	return c
}

func esperarFechar(t *testing.T, ch <-chan esl.Evento) {
	t.Helper()
	limite := time.After(5 * time.Second)
	for {
		select {
		case _, ok := <-ch:
			if !ok {
				return
			}
		case <-limite:
			t.Fatal("o canal dos eventos não fechou")
		}
	}
}

func receber(t *testing.T, ch <-chan esl.Evento) esl.Evento {
	t.Helper()
	select {
	case ev, ok := <-ch:
		if !ok {
			t.Fatal("o canal dos eventos fechou")
		}
		return ev
	case <-time.After(5 * time.Second):
		t.Fatal("nenhum evento chegou")
	}
	return nil
}

func esperarComando(t *testing.T, fs *esltest.Servidor, comando string) {
	t.Helper()
	fim := time.Now().Add(5 * time.Second)
	for time.Now().Before(fim) {
		for _, c := range fs.Comandos() {
			if c == comando {
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("o comando %q não chegou; chegaram %q", comando, fs.Comandos())
}

func TestConectar(t *testing.T) {
	t.Run("senha certa autentica e assina os eventos", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		conectar(t, fs)
		want := []string{"auth " + senhaTeste, "event json CUSTOM conference::maintenance"}
		got := fs.Comandos()
		if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Errorf("Comandos = %q, want %q", got, want)
		}
	})
	t.Run("senha errada dá erro, sem a senha no texto", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		_, err := esl.Conectar(ctxTeste(t), fs.Endereco(), "outra-senha")
		if err == nil {
			t.Fatal("Conectar com a senha errada não deu erro")
		}
		if strings.Contains(err.Error(), "outra-senha") || strings.Contains(err.Error(), senhaTeste) {
			t.Errorf("o erro traz a senha: %v", err)
		}
	})
	t.Run("sem ninguém escutando dá erro", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		endereco := fs.Endereco()
		fs.Fechar()
		if _, err := esl.Conectar(ctxTeste(t), endereco, senhaTeste); err == nil {
			t.Fatal("Conectar sem servidor não deu erro")
		}
	})
	t.Run("o contexto cancelado interrompe", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := esl.Conectar(ctx, fs.Endereco(), senhaTeste); err == nil {
			t.Fatal("Conectar com o contexto cancelado não deu erro")
		}
	})
}

func TestAPI(t *testing.T) {
	t.Run("a resposta volta inteira, também com 70 KB", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		grande := strings.Repeat("0123456789abcdef\n", 70*1024/17)
		fs.Responder("grande", grande)
		c := conectar(t, fs)
		got, err := c.API(ctxTeste(t), "grande")
		if err != nil {
			t.Fatal(err)
		}
		if got != grande {
			t.Errorf("a resposta veio com %d bytes, want %d", len(got), len(grande))
		}
	})
	t.Run("duas chamadas ao mesmo tempo recebem cada uma a sua resposta", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		c := conectar(t, fs)
		var wg sync.WaitGroup
		for i := 0; i < 40; i++ {
			fs.Responder(fmt.Sprintf("eco %d", i), fmt.Sprintf("resposta-%d\n", i))
		}
		for i := 0; i < 40; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				got, err := c.API(ctxTeste(t), fmt.Sprintf("eco %d", i))
				if err != nil || got != fmt.Sprintf("resposta-%d\n", i) {
					t.Errorf("eco %d = %q, %v", i, got, err)
				}
			}()
		}
		wg.Wait()
	})
	t.Run("um -ERR vira erro, sem o comando no texto", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Responder("uuid_getvar", "-ERR no such channel\n")
		c := conectar(t, fs)
		_, err := c.API(ctxTeste(t), "uuid_getvar 5b9f0c5e-0000 segredo")
		if err == nil {
			t.Fatal("o -ERR não virou erro")
		}
		if !strings.Contains(err.Error(), "no such channel") {
			t.Errorf("o erro perdeu o motivo: %v", err)
		}
		if strings.Contains(err.Error(), "uuid_getvar") || strings.Contains(err.Error(), "5b9f0c5e") || strings.Contains(err.Error(), "segredo") {
			t.Errorf("o erro traz o comando: %v", err)
		}
		if errors.Is(err, esl.ErrDesligado) {
			t.Error("um -ERR não é um desligamento")
		}
	})
	t.Run("o Derrubar no meio de uma chamada dá ErrDesligado e fecha os eventos", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Segurar("preso")
		c := conectar(t, fs)
		resultado := make(chan error, 1)
		go func() {
			_, err := c.API(ctxTeste(t), "preso")
			resultado <- err
		}()
		esperarComando(t, fs, "api preso")
		fs.Derrubar()
		select {
		case err := <-resultado:
			if !errors.Is(err, esl.ErrDesligado) {
				t.Errorf("err = %v, want ErrDesligado", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("a chamada não voltou")
		}
		esperarFechar(t, c.Eventos())
		if _, err := c.API(ctxTeste(t), "outro"); !errors.Is(err, esl.ErrDesligado) {
			t.Errorf("API depois da queda: err = %v, want ErrDesligado", err)
		}
	})
	t.Run("o contexto cancelado solta quem espera, e a próxima resposta não se perde", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Atrasar("lento", 300*time.Millisecond, "resposta-lenta")
		fs.Responder("rapido", "resposta-rapida")
		c := conectar(t, fs)
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		if _, err := c.API(ctx, "lento"); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("err = %v, want DeadlineExceeded", err)
		}
		got, err := c.API(ctxTeste(t), "rapido")
		if err != nil || got != "resposta-rapida" {
			t.Errorf("a resposta seguinte = %q, %v; want a dela, sem a da chamada abandonada", got, err)
		}
	})
	t.Run("comando com quebra de linha é recusado", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		c := conectar(t, fs)
		if _, err := c.API(ctxTeste(t), "status\n\napi reload"); err == nil {
			t.Fatal("o comando com quebra de linha foi aceito")
		}
		for _, cmd := range fs.Comandos() {
			if strings.HasPrefix(cmd, "api") {
				t.Errorf("o comando saiu mesmo assim: %q", cmd)
			}
		}
	})
}

func TestEventos(t *testing.T) {
	t.Run("um evento JSON chega como Evento, com os valores em texto", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		c := conectar(t, fs)
		fs.MandarJSON(`{"Event-Name":"CUSTOM","Action":"add-member","Member-ID":12,"Energy":1.5,"Flag":true,"Vazio":null,"variable_starsonic_tela":"false"}`)
		got := receber(t, c.Eventos())
		want := esl.Evento{"Event-Name": "CUSTOM", "Action": "add-member", "Member-ID": "12", "Energy": "1.5", "Flag": "true", "Vazio": "", "variable_starsonic_tela": "false"}
		if len(got) != len(want) {
			t.Fatalf("Evento = %v, want %v", got, want)
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("%s = %q, want %q", k, got[k], v)
			}
		}
	})
	t.Run("os eventos chegam na ordem", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		c := conectar(t, fs)
		for i := 0; i < 5; i++ {
			fs.Mandar(esl.Evento{"n": fmt.Sprint(i)})
		}
		for i := 0; i < 5; i++ {
			if got := receber(t, c.Eventos())["n"]; got != fmt.Sprint(i) {
				t.Errorf("evento %d veio como %s", i, got)
			}
		}
	})
	t.Run("um JSON quebrado derruba a ligação, sem travar", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		c := conectar(t, fs)
		fs.MandarJSON(`{"Action":`)
		esperarFechar(t, c.Eventos())
	})
}

func TestEventos_ConsumidorLentoNaoTravaALeitura(t *testing.T) {
	t.Run("a resposta chega com centenas de eventos sem ninguém ler", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Responder("status", "UP\n")
		c := conectar(t, fs)
		const n = 500
		for i := 0; i < n; i++ {
			fs.Mandar(esl.Evento{"n": fmt.Sprint(i)})
		}
		got, err := c.API(ctxTeste(t), "status")
		if err != nil || got != "UP\n" {
			t.Fatalf("API = %q, %v", got, err)
		}
		for i := 0; i < n; i++ {
			if got := receber(t, c.Eventos())["n"]; got != fmt.Sprint(i) {
				t.Fatalf("evento %d veio como %s", i, got)
			}
		}
	})
	t.Run("quem trata um evento chama o API e recebe a resposta", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Responder("status", "UP\n")
		c := conectar(t, fs)
		feito := make(chan error, 1)
		go func() {
			for ev := range c.Eventos() {
				got, err := c.API(ctxTeste(t), "status")
				if err != nil || got != "UP\n" {
					feito <- fmt.Errorf("evento %s: API = %q, %v", ev["n"], got, err)
					return
				}
				if ev["n"] == "299" {
					feito <- nil
					return
				}
			}
			feito <- errors.New("o canal fechou antes do último evento")
		}()
		for i := 0; i < 300; i++ {
			fs.Mandar(esl.Evento{"n": fmt.Sprint(i)})
		}
		select {
		case err := <-feito:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("o consumidor travou: a leitura ficou presa no evento")
		}
	})
}

func TestFechar(t *testing.T) {
	fs := esltest.Novo(t, senhaTeste)
	c, err := esl.Conectar(ctxTeste(t), fs.Endereco(), senhaTeste)
	if err != nil {
		t.Fatal(err)
	}
	// Eventos pendentes que ninguém lê não seguram o Fechar.
	for i := 0; i < 50; i++ {
		fs.Mandar(esl.Evento{"n": fmt.Sprint(i)})
	}
	if err := c.Fechar(); err != nil {
		t.Fatalf("Fechar: %v", err)
	}
	if err := c.Fechar(); err != nil {
		t.Fatalf("Fechar de novo: %v", err)
	}
	esperarFechar(t, c.Eventos())
	if _, err := c.API(ctxTeste(t), "status"); !errors.Is(err, esl.ErrDesligado) {
		t.Errorf("API depois do Fechar: err = %v, want ErrDesligado", err)
	}
}

func TestEnquadramentoHostil(t *testing.T) {
	// Cada caso é um corpo que o FreeSWITCH nunca mandaria: a conexão cai e quem espera recebe o ErrDesligado.
	casos := map[string]string{
		"Content-Length acima do máximo": "Content-Type: api/response\nContent-Length: 99999999999\n\n",
		"Content-Length não numérico":    "Content-Type: api/response\nContent-Length: muito\n\n",
		"Content-Length negativo":        "Content-Type: api/response\nContent-Length: -5\n\n",
	}
	for nome, bruto := range casos {
		t.Run(nome, func(t *testing.T) {
			fs := esltest.Novo(t, senhaTeste)
			fs.Segurar("preso")
			c := conectar(t, fs)
			resultado := make(chan error, 1)
			go func() {
				_, err := c.API(ctxTeste(t), "preso")
				resultado <- err
			}()
			esperarComando(t, fs, "api preso")
			fs.MandarBruto(bruto)
			select {
			case err := <-resultado:
				if !errors.Is(err, esl.ErrDesligado) {
					t.Errorf("err = %v, want ErrDesligado", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("a chamada não voltou")
			}
			esperarFechar(t, c.Eventos())
		})
	}
	t.Run("um corpo em várias escritas pequenas chega inteiro", func(t *testing.T) {
		fs := esltest.Novo(t, senhaTeste)
		fs.Segurar("picado")
		c := conectar(t, fs)
		corpo := strings.Repeat("0123456789", 300)
		resultado := make(chan string, 1)
		go func() {
			got, err := c.API(ctxTeste(t), "picado")
			if err != nil {
				got = "erro: " + err.Error()
			}
			resultado <- got
		}()
		esperarComando(t, fs, "api picado")
		msg := fmt.Sprintf("Content-Type: api/response\nContent-Length: %d\n\n%s", len(corpo), corpo)
		for i := 0; i < len(msg); i += 7 {
			fim := i + 7
			if fim > len(msg) {
				fim = len(msg)
			}
			fs.MandarBruto(msg[i:fim])
			time.Sleep(50 * time.Microsecond)
		}
		select {
		case got := <-resultado:
			if got != corpo {
				t.Errorf("resposta com %d bytes (%.30q), want %d", len(got), got, len(corpo))
			}
		case <-time.After(5 * time.Second):
			t.Fatal("a chamada não voltou")
		}
	})
}
