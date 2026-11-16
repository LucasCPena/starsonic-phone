package api_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// ---------- Os apoios ----------

// canal abre o canal da página: o abrir (tem de dar 200) e o WebSocket, com a origem do chat (tem de dar 101).
func (c *cenaR) canal(t *testing.T, codigo string) *websocket.Conn {
	t.Helper()
	status, bilhete := c.a.AbrirPagina(codigo)
	if status != http.StatusOK {
		t.Fatalf("abrir respondeu %d", status)
	}
	conn, resp, err := c.a.CanalDaPagina(bilhete, c.a.Base)
	if err != nil {
		s := 0
		if resp != nil {
			s = resp.StatusCode
		}
		t.Fatalf("canal (status %d): %v", s, err)
	}
	return conn
}

// daPagina manda uma mensagem da página.
func daPagina(t *testing.T, conn *websocket.Conn, msg map[string]any) {
	t.Helper()
	b, _ := json.Marshal(msg)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("mandar %s: %v", b, err)
	}
}

// aPagina lê a próxima mensagem que a página recebe.
func aPagina(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	return apitest.LerEvento[map[string]any](t, conn)
}

// aPaginaTipo lê a próxima mensagem e confere o tipo.
func aPaginaTipo(t *testing.T, conn *websocket.Conn, tipo string) map[string]any {
	t.Helper()
	m := aPagina(t, conn)
	if m["tipo"] != tipo {
		t.Fatalf("a página recebeu %v; queria o tipo %q", m, tipo)
	}
	return m
}

// aPaginaErro lê a próxima mensagem e confere que é o erro.
func aPaginaErro(t *testing.T, conn *websocket.Conn, erro string) {
	t.Helper()
	m := aPagina(t, conn)
	if len(m) != 2 || m["tipo"] != "erro" || m["erro"] != erro {
		t.Fatalf("a página recebeu %v; queria {tipo: erro, erro: %s}", m, erro)
	}
}

// cargaDaSenha é a carga da senha de uso único ("<carga>.<assinatura>").
func cargaDaSenha(t *testing.T, senha string) map[string]any {
	t.Helper()
	i := strings.Index(senha, ".")
	if i < 1 {
		t.Fatalf("a senha %q não tem a forma <carga>.<assinatura>", senha)
	}
	b, err := base64.RawURLEncoding.DecodeString(senha[:i])
	if err != nil {
		t.Fatalf("a carga da senha: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// colegaNaReuniao põe o Carlos na reunião (o entrar e o entrou do agente) e liga o app dele, para ver os eventos.
func (c *cenaR) colegaNaReuniao(t *testing.T, codigo string) *websocket.Conn {
	t.Helper()
	conn := c.a.Conectar(c.kCarlos)
	c.entrouNaReuniao(t, c.kCarlos, codigo)
	return conn
}

// pedidoDe espera o reuniaoPedido no app e devolve o id do pedido.
func pedidoDe(t *testing.T, app *websocket.Conn, nome string) string {
	t.Helper()
	ev := esperarEvento(t, app, "reuniaoPedido")
	p, _ := ev["pedido"].(map[string]any)
	if p["nome"] != nome {
		t.Fatalf("reuniaoPedido = %v; queria o nome %q", ev, nome)
	}
	id, _ := p["id"].(string)
	return id
}

func (c *cenaR) aceitar(t *testing.T, chave, codigo, pedido string) {
	t.Helper()
	resp := c.a.Pedir(chave, "POST", "/api/v1/reunioes/"+codigo+"/aceitar", map[string]string{"pedido": pedido})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("aceitar respondeu %d", resp.StatusCode)
	}
}

// aceita faz a página pedir, o Carlos aceitar, e devolve o aceito. O Carlos já está na reunião, com o app em
// carlos.
func (c *cenaR) aceita(t *testing.T, codigo string, carlos, pagina *websocket.Conn, nome string) map[string]any {
	t.Helper()
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": nome})
	aPaginaTipo(t, pagina, "aguardando")
	c.aceitar(t, c.kCarlos, codigo, pedidoDe(t, carlos, nome))
	return aPaginaTipo(t, pagina, "aceito")
}

// ---------- O abrir ----------

func TestAbrir(t *testing.T) {
	t.Run("responde 200, com a reunião e um bilhete de 43 caracteres", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		resp := c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+r.Codigo, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		corpo := apitest.LerJSON[map[string]json.RawMessage](t, resp)
		if len(corpo) != 2 {
			t.Fatalf("corpo = %v; queria só reuniao e bilhete", corpo)
		}
		var bilhete string
		json.Unmarshal(corpo["bilhete"], &bilhete)
		if len(bilhete) != 43 {
			t.Fatalf("o bilhete tem %d caracteres; queria 43", len(bilhete))
		}
		var reuniao map[string]any
		json.Unmarshal(corpo["reuniao"], &reuniao)
		if len(reuniao) != 3 || reuniao["tipo"] != "marcada" || reuniao["assunto"] != "Planejamento" ||
			reuniao["inicio"] != float64(c.inicioPadrao) {
			t.Fatalf("reuniao = %v", reuniao)
		}
		// O código em maiúsculas e com espaços vale, como no entrar.
		if status, _ := c.a.AbrirPagina(strings.ToUpper(r.Codigo)); status != http.StatusOK {
			t.Fatalf("o código em maiúsculas deu %d", status)
		}
	})

	t.Run("a reunião de teste e a naHora", func(t *testing.T) {
		c := novaCenaR(t)
		teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
		resp := c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+teste.Codigo, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("teste: status = %d", resp.StatusCode)
		}
		corpo := apitest.LerJSON[struct {
			Reuniao map[string]any `json:"reuniao"`
		}](t, resp)
		if corpo.Reuniao["tipo"] != "teste" || corpo.Reuniao["assunto"] != nil || corpo.Reuniao["inicio"] != nil {
			t.Fatalf("reuniao = %v", corpo.Reuniao)
		}

		resp = c.a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", nil)
		agora := apitest.LerJSON[struct {
			Reuniao reuniaoResp `json:"reuniao"`
		}](t, resp).Reuniao
		resp = c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+agora.Codigo, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("naHora: status = %d", resp.StatusCode)
		}
		if tipo := apitest.LerJSON[struct {
			Reuniao map[string]any `json:"reuniao"`
		}](t, resp).Reuniao["tipo"]; tipo != "naHora" {
			t.Fatalf("tipo = %v", tipo)
		}
	})

	t.Run("o que não vale dá 404", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		cancelada := c.marcada(t, c.kAna)
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+cancelada.Codigo, nil); resp.StatusCode != 204 {
			t.Fatalf("cancelar respondeu %d", resp.StatusCode)
		}
		for _, codigo := range []string{codigoQueNaoExiste(1), "curto", cancelada.Codigo} {
			esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+codigo, nil), 404, "naoEncontrado")
		}
		// Uma marcada que já passou do valeAte.
		c.a.Relogio.Avancar(72 * time.Hour)
		esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+r.Codigo, nil), 404, "naoEncontrado")

		// A empresa sem as reuniões liberadas.
		c = novaCenaR(t)
		r = c.marcada(t, c.kAna)
		if err := c.a.Banco.LiberarReunioes(t.Context(), c.acme.ID, false); err != nil {
			t.Fatal(err)
		}
		esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+r.Codigo, nil), 404, "naoEncontrado")
		// E volta quando ela é liberada de novo.
		c.a.LiberarReunioes(c.acme.ID)
		if status, _ := c.a.AbrirPagina(r.Codigo); status != http.StatusOK {
			t.Fatalf("depois de liberar, abrir deu %d", status)
		}
	})

	t.Run("o 21º no minuto dá 429, contando junto com o entrar do app", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		// Um entrar e um abrir que dão certo não contam.
		c.entrar(t, c.kCarlos, r.Codigo)
		if status, _ := c.a.AbrirPagina(r.Codigo); status != http.StatusOK {
			t.Fatalf("o abrir deu %d", status)
		}
		// Do mesmo endereço: 10 abrir da página e 10 entrar do app com um código errado.
		for i := range 10 {
			esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+codigoQueNaoExiste(i), nil), 404, "naoEncontrado")
			esperarErro(t, c.entrarEm(c.kCarlos, codigoQueNaoExiste(10+i)), 404, "naoEncontrado")
		}
		e := esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+r.Codigo, nil), 429, "tentativas")
		if e.EsperarSegundos < 1 || e.EsperarSegundos > 60 {
			t.Fatalf("esperarSegundos = %d; queria de 1 a 60", e.EsperarSegundos)
		}
		// O app também espera, e passado o minuto volta.
		esperarErro(t, c.entrarEm(c.kCarlos, r.Codigo), 429, "tentativas")
		c.a.Relogio.Avancar(61 * time.Second)
		if status, _ := c.a.AbrirPagina(r.Codigo); status != http.StatusOK {
			t.Fatalf("passado o minuto, abrir deu %d", status)
		}
	})

	// Conta só o abrir que não leva a uma reunião em que a pessoa possa entrar (seções 9, 10 e 12 do protocolo): a
	// página pode abrir de novo à vontade, e um escritório atrás de um endereço só abre o link de uma vez.
	t.Run("o abrir que dá certo não conta", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for i := range 25 {
			if status, _ := c.a.AbrirPagina(r.Codigo); status != http.StatusOK {
				t.Fatalf("o abrir %d deu %d", i, status)
			}
		}
		// E a janela continua com as 20 tentativas erradas inteiras.
		for i := range 20 {
			esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+codigoQueNaoExiste(i), nil), 404, "naoEncontrado")
		}
		esperarErro(t, c.a.Pedir("", "POST", "/api/v1/pagina/reunioes/"+r.Codigo, nil), 429, "tentativas")
	})
}

// ---------- O canal: a origem e o bilhete ----------

func TestCanal_Origem(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	_, bilhete := c.a.AbrirPagina(r.Codigo)

	for nome, origem := range map[string]string{"outra origem": "https://mal.example", "sem origem": ""} {
		conn, resp, err := c.a.CanalDaPagina(bilhete, origem)
		if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s: conn = %v, resp = %v, err = %v; queria 403", nome, conn, resp, err)
		}
		corpo, _ := io.ReadAll(resp.Body)
		var e erroResp
		json.Unmarshal(corpo, &e)
		if e.Erro != "proibido" {
			t.Fatalf("%s: corpo = %s; queria proibido", nome, corpo)
		}
	}
	// O bilhete ainda vale.
	conn, resp, err := c.a.CanalDaPagina(bilhete, c.a.Base)
	if err != nil {
		t.Fatalf("a origem do chat não abriu o canal: %v (resp %v)", err, resp)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d; queria 101", resp.StatusCode)
	}
	conn.CloseNow()
}

func TestCanal_Bilhete(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)

	_, bilhete := c.a.AbrirPagina(r.Codigo)
	conn, _, err := c.a.CanalDaPagina(bilhete, c.a.Base)
	if err != nil {
		t.Fatal(err)
	}
	conn.CloseNow()
	esperarCanal401 := func(nome, bilhete string) {
		t.Helper()
		conn, resp, err := c.a.CanalDaPagina(bilhete, c.a.Base)
		if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: conn = %v, resp = %v, err = %v; queria 401", nome, conn, resp, err)
		}
		corpo, _ := io.ReadAll(resp.Body)
		var e erroResp
		json.Unmarshal(corpo, &e)
		if e.Erro != "chave" {
			t.Fatalf("%s: corpo = %s; queria chave", nome, corpo)
		}
	}
	esperarCanal401("o bilhete usado de novo", bilhete)

	_, velho := c.a.AbrirPagina(r.Codigo)
	c.a.Relogio.Avancar(31 * time.Second)
	esperarCanal401("o bilhete de 31 s atrás", velho)
	esperarCanal401("um bilhete que não existe", "x")
	esperarCanal401("sem bilhete", "")
}

// ---------- O canal: pedir e a sala de espera ----------

func TestCanal_PedirEAceito(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "aguardando")
	id := pedidoDe(t, carlos, "Maria Lima")

	c.aceitar(t, c.kCarlos, r.Codigo, id)
	m := aPaginaTipo(t, pagina, "aceito")
	part, _ := m["participante"].(string)
	senha, _ := m["senha"].(string)
	if !hex16.MatchString(part) || senha == "" {
		t.Fatalf("aceito = %v", m)
	}
	if m["turn"] == nil || m["video"] == nil || m["reuniao"] != nil {
		t.Fatalf("o aceito é o Acesso, sem a reuniao: %v", m)
	}
	carga := cargaDaSenha(t, senha)
	if carga["papel"] != "fora" || carga["participante"] != part || carga["nome"] != "Maria Lima" || carga["tela"] != false {
		t.Fatalf("carga da senha = %v", carga)
	}
}

func TestCanal_NaoComecou(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canal(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "naoComecou")

	carlos := c.colegaNaReuniao(t, r.Codigo)
	aPaginaTipo(t, pagina, "aguardando")
	pedidoDe(t, carlos, "Maria Lima")
}

func TestCanal_Recusado(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)

	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "aguardando")
	id := pedidoDe(t, carlos, "Maria Lima")
	resp := c.a.Pedir(c.kCarlos, "POST", "/api/v1/reunioes/"+r.Codigo+"/recusar", map[string]string{"pedido": id})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("recusar respondeu %d", resp.StatusCode)
	}
	aPaginaTipo(t, pagina, "recusado")
	if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
		t.Fatalf("o canal fechou com %d; queria 1000", cod)
	}
	// Os colegas viram o pedido sair.
	esperarEvento(t, carlos, "reuniaoPedidoFim")
}

func TestCanal_NomeInvalido(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)

	for _, nome := range []string{"", "   ", strings.Repeat("a", 81), "Ana\u0007"} {
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": nome})
		aPaginaErro(t, pagina, "invalido")
	}
	// Sem nome, ou com o nome que não é texto.
	daPagina(t, pagina, map[string]any{"tipo": "pedir"})
	aPaginaErro(t, pagina, "invalido")
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": 7})
	aPaginaErro(t, pagina, "invalido")
	semEventoDe(t, carlos, []string{"reuniaoPedido"}, 300*time.Millisecond)

	// Um nome bom ainda vale: o canal continua aberto e o pedido não foi gasto.
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	aPaginaTipo(t, pagina, "aguardando")
}

func TestCanal_Teste(t *testing.T) {
	c := novaCenaR(t)
	teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	pagina := c.canal(t, teste.Codigo)
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	m := aPaginaTipo(t, pagina, "aceito")
	senha, _ := m["senha"].(string)
	if carga := cargaDaSenha(t, senha); carga["papel"] != "colega" || carga["nome"] != "Maria Lima" {
		t.Fatalf("carga da senha = %v; queria a de colega", carga)
	}
}

func TestCanal_FecharDesiste(t *testing.T) {
	t.Run("enquanto espera, o pedido sai", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		id := pedidoDe(t, carlos, "Maria Lima")

		pagina.Close(websocket.StatusNormalClosure, "")
		fim := esperarEvento(t, carlos, "reuniaoPedidoFim")
		if fim["pedido"] != id || fim["reuniao"] != r.Codigo {
			t.Fatalf("reuniaoPedidoFim = %v", fim)
		}
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Pedidos) != 0 {
			t.Fatalf("o pedido continua na lista: %+v", l.Pedidos)
		}
	})

	t.Run("a mensagem desistir retira o pedido e fecha o canal com 1000, sem mandar nada", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		id := pedidoDe(t, carlos, "Maria Lima")

		daPagina(t, pagina, map[string]any{"tipo": "desistir"})
		// Nenhuma mensagem: a primeira coisa que a página vê é o fechamento.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, dados, err := pagina.Read(ctx); err == nil {
			t.Fatalf("a página recebeu %s; queria só o fechamento", dados)
		} else if cod := websocket.CloseStatus(err); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d (%v); queria 1000", cod, err)
		}
		if fim := esperarEvento(t, carlos, "reuniaoPedidoFim"); fim["pedido"] != id {
			t.Fatalf("reuniaoPedidoFim = %v", fim)
		}
		semEventoDe(t, carlos, []string{"reuniaoPedidoFim"}, 300*time.Millisecond) // um só
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Pedidos) != 0 {
			t.Fatalf("sobrou um pedido: %+v", l.Pedidos)
		}
	})

	t.Run("desistir depois do aceito é fora de ordem, e o canal continua aberto", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
		daPagina(t, pagina, map[string]any{"tipo": "desistir"})
		aPaginaErro(t, pagina, "invalido")
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		aPaginaTipo(t, pagina, "senha")
	})

	t.Run("desistir sem pedido é fora de ordem, e o pedir de depois sai com o canal", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)

		daPagina(t, pagina, map[string]any{"tipo": "desistir"})
		aPaginaErro(t, pagina, "invalido")
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		id := pedidoDe(t, carlos, "Maria Lima")
		pagina.Close(websocket.StatusNormalClosure, "")
		fim := esperarEvento(t, carlos, "reuniaoPedidoFim")
		if fim["pedido"] != id {
			t.Fatalf("reuniaoPedidoFim = %v", fim)
		}
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Pedidos) != 0 {
			t.Fatalf("sobrou um pedido: %+v", l.Pedidos)
		}
	})

	t.Run("depois do aceito, fechar não tira ninguém da reunião", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		m := c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
		part, _ := m["participante"].(string)
		esperarEvento(t, carlos, "reuniaoPedidoFim") // o aceito tira o pedido da espera
		c.entrou(t, r.Codigo, part)
		esperarEvento(t, carlos, "reuniaoParticipantes")

		pagina.Close(websocket.StatusNormalClosure, "")
		semEventoDe(t, carlos, []string{"reuniaoPedidoFim"}, 500*time.Millisecond)
		var achou bool
		for _, p := range c.lista(t, c.kCarlos, r.Codigo).Participantes {
			if p.ID == part {
				achou = true
			}
		}
		if !achou {
			t.Fatalf("o participante %s saiu da reunião quando a página fechou", part)
		}
	})
}

func TestCanal_SenhaETela(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)
	m := c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
	part, _ := m["participante"].(string)

	// A senha nova, antes de entrar: o mesmo participante.
	daPagina(t, pagina, map[string]any{"tipo": "senha"})
	s := aPaginaTipo(t, pagina, "senha")
	nova, _ := s["senha"].(string)
	if len(s) != 2 || nova == "" || nova == m["senha"] {
		t.Fatalf("senha = %v", s)
	}
	if carga := cargaDaSenha(t, nova); carga["participante"] != part || carga["papel"] != "fora" || carga["tela"] != false {
		t.Fatalf("carga da senha nova = %v", carga)
	}

	// A tela, antes do entrou: fora da reunião.
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	aPaginaErro(t, pagina, "foraDaReuniao")

	// Com a pessoa na reunião, a tela dá a senha da tela, e a senha nova é fora de ordem.
	c.entrou(t, r.Codigo, part)
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	tela := aPaginaTipo(t, pagina, "tela")
	senhaTela, _ := tela["senha"].(string)
	if len(tela) != 2 || senhaTela == "" {
		t.Fatalf("tela = %v", tela)
	}
	if carga := cargaDaSenha(t, senhaTela); carga["participante"] != part || carga["tela"] != true {
		t.Fatalf("carga da senha da tela = %v", carga)
	}
	daPagina(t, pagina, map[string]any{"tipo": "senha"})
	aPaginaErro(t, pagina, "invalido")
}

func TestCanal_TiradoEEncerrada(t *testing.T) {
	t.Run("tirado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		m := c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
		part, _ := m["participante"].(string)
		c.entrou(t, r.Codigo, part)

		resp := c.a.Pedir(c.kCarlos, "POST", "/api/v1/reunioes/"+r.Codigo+"/tirar", map[string]string{"participante": part})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("tirar respondeu %d", resp.StatusCode)
		}
		aPaginaTipo(t, pagina, "tirado")
		if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d; queria 1000", cod)
		}
	})

	t.Run("encerrada", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		m := c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
		part, _ := m["participante"].(string)
		c.entrou(t, r.Codigo, part)

		resp := c.a.Pedir(c.kCarlos, "POST", "/api/v1/reunioes/"+r.Codigo+"/encerrar", nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("encerrar respondeu %d", resp.StatusCode)
		}
		aPaginaTipo(t, pagina, "encerrada")
		if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d; queria 1000", cod)
		}
	})

	t.Run("encerrada na sala de espera, quando a reunião é cancelada", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		if resp := c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil); resp.StatusCode != 204 {
			t.Fatalf("cancelar respondeu %d", resp.StatusCode)
		}
		m := aPagina(t, pagina)
		if m["tipo"] != "linkInvalido" && m["tipo"] != "encerrada" {
			t.Fatalf("a página recebeu %v; queria linkInvalido ou encerrada", m)
		}
		if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d; queria 1000", cod)
		}
	})
}

func TestCanal_Limite(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canal(t, r.Codigo)
	for range 20 {
		daPagina(t, pagina, map[string]any{"tipo": "tela"})
		aPaginaErro(t, pagina, "foraDaReuniao")
	}
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	aPaginaErro(t, pagina, "limite")
	// A mensagem foi ignorada, e o canal continua. Passado o minuto, volta.
	c.a.Relogio.Avancar(61 * time.Second)
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	aPaginaErro(t, pagina, "foraDaReuniao")
}

func TestCanal_ForaDeOrdem(t *testing.T) {
	t.Run("um segundo pedir e o senha antes do aceito", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		pedidoDe(t, carlos, "Maria Lima")

		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Outra Pessoa"})
		aPaginaErro(t, pagina, "invalido")
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		aPaginaErro(t, pagina, "invalido")
		semEventoDe(t, carlos, []string{"reuniaoPedido"}, 300*time.Millisecond)
	})

	t.Run("mensagem sem sentido", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canal(t, r.Codigo)
		for _, cru := range []string{`{"tipo":"nada"}`, `{}`, `[]`, `isto não é JSON`, `{"tipo":7}`} {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := pagina.Write(ctx, websocket.MessageText, []byte(cru))
			cancel()
			if err != nil {
				t.Fatal(err)
			}
			aPaginaErro(t, pagina, "invalido")
		}
		// Binário também.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := pagina.Write(ctx, websocket.MessageBinary, []byte(`{"tipo":"tela"}`)); err != nil {
			t.Fatal(err)
		}
		aPaginaErro(t, pagina, "invalido")
	})

	t.Run("depois de um cheia, um novo pedir vale", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		var partes []string
		for range 9 { // com o Carlos, são 10
			partes = append(partes, c.entrouNaReuniao(t, c.kBia, r.Codigo))
		}
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "cheia")

		// Uma pessoa sai, e o mesmo canal pede de novo.
		c.a.Gerente.EventoDoVideo(video.Evento{Tipo: "saiu", Sala: c.sala(t, r.Codigo), Participante: partes[0]})
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		pedidoDe(t, carlos, "Maria Lima")
		// Agora o pedir está gasto.
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaErro(t, pagina, "invalido")
	})

	t.Run("depois de um esperaCheia, um novo pedir vale", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		c.entrouNaReuniao(t, c.kCarlos, r.Codigo) // sem o app: os 50 reuniaoPedido não importam aqui
		var paginas []*websocket.Conn
		for i := range 50 {
			pagina := c.canal(t, r.Codigo)
			daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": fmt.Sprintf("Visitante %d", i)})
			aPaginaTipo(t, pagina, "aguardando")
			paginas = append(paginas, pagina)
		}
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		if m := aPagina(t, pagina); len(m) != 1 || m["tipo"] != "esperaCheia" {
			t.Fatalf("o 51º pedir recebeu %v; queria esperaCheia", m)
		}

		// Um pedido sai (a página desiste, e o canal dela fecha), e o mesmo canal pede de novo.
		daPagina(t, paginas[0], map[string]any{"tipo": "desistir"})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, _, err := paginas[0].Read(ctx); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
			t.Fatalf("o canal que desistiu: %v; queria o fechamento 1000", err)
		}
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		if l := c.lista(t, c.kCarlos, r.Codigo); len(l.Pedidos) != 50 {
			t.Fatalf("a lista tem %d pedidos; queria 50", len(l.Pedidos))
		}
	})
}

func TestCanal_SemServidorEOutrasRespostasQueMantemOCanal(t *testing.T) {
	t.Run("o senha com o vídeo fora do ar deixa o canal aberto", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		m := c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")

		c.a.Video.DefinirNoAr(false)
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		if m := aPagina(t, pagina); len(m) != 1 || m["tipo"] != "semServidor" {
			t.Fatalf("a página recebeu %v; queria semServidor", m)
		}
		c.a.Video.DefinirNoAr(true)
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		s := aPaginaTipo(t, pagina, "senha")
		if carga := cargaDaSenha(t, s["senha"].(string)); carga["participante"] != m["participante"] {
			t.Fatalf("carga = %v", carga)
		}
	})

	t.Run("o pedir com o vídeo fora do ar deixa o canal aberto", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		c.a.Video.DefinirNoAr(false)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "semServidor")
		c.a.Video.DefinirNoAr(true)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "aguardando")
		pedidoDe(t, carlos, "Maria Lima")
	})

	t.Run("o senha de uma reunião que deixou de valer dá linkInvalido e fecha", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")

		c.a.Relogio.Avancar(72 * time.Hour) // passou do valeAte
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		if m := aPagina(t, pagina); len(m) != 1 || m["tipo"] != "linkInvalido" {
			t.Fatalf("a página recebeu %v; queria linkInvalido", m)
		}
		if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d; queria 1000", cod)
		}
	})

	t.Run("o senha com a reunião cheia deixa o canal aberto", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		carlos := c.colegaNaReuniao(t, r.Codigo)
		pagina := c.canal(t, r.Codigo)
		c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
		var partes []string
		for range 8 { // com o Carlos e a Maria, são 10
			partes = append(partes, c.entrouNaReuniao(t, c.kBia, r.Codigo))
		}
		// A senha do aceito venceu: a entrada é nova, e agora a reunião está cheia.
		c.a.Relogio.Avancar(31 * time.Second)
		c.a.Gerente.Varrer()
		partes = append(partes, c.entrouNaReuniao(t, c.kBia, r.Codigo))
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		aPaginaTipo(t, pagina, "cheia")
		c.a.Gerente.EventoDoVideo(video.Evento{Tipo: "saiu", Sala: c.sala(t, r.Codigo), Participante: partes[0]})
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		aPaginaTipo(t, pagina, "senha")
	})
}

func TestCanal_SenhasPorMinuto(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)
	c.aceita(t, r.Codigo, carlos, pagina, "Maria Lima")
	for range 5 {
		daPagina(t, pagina, map[string]any{"tipo": "senha"})
		aPaginaTipo(t, pagina, "senha")
	}
	daPagina(t, pagina, map[string]any{"tipo": "senha"})
	aPaginaErro(t, pagina, "limite")
}

// ---------- O ping ----------

func TestCanal_PingSemResposta(t *testing.T) {
	// O cliente que não lê não responde ao ping: o servidor fecha o canal e retira o pedido.
	api.AjustarPing(t, 50*time.Millisecond, 150*time.Millisecond)
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	carlos := c.colegaNaReuniao(t, r.Codigo)
	pagina := c.canal(t, r.Codigo)
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
	pedidoDe(t, carlos, "Maria Lima")
	esperarEvento(t, carlos, "reuniaoPedidoFim")
}

func TestCanal_PingComResposta(t *testing.T) {
	// O cliente que lê responde ao ping (a biblioteca responde sozinha), e o canal continua.
	api.AjustarPing(t, 50*time.Millisecond, 2*time.Second)
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina := c.canal(t, r.Codigo)
	// A leitura responde aos pings, e a conexão vive 12 intervalos de ping sem nenhuma mensagem.
	lidas := make(chan map[string]any, 1)
	ctx, cancelar := context.WithCancel(t.Context())
	defer cancelar()
	go func() {
		_, dados, err := pagina.Read(ctx)
		var m map[string]any
		if err != nil {
			m = map[string]any{"erro de leitura": err.Error()}
		} else {
			json.Unmarshal(dados, &m)
		}
		lidas <- m
	}()
	time.Sleep(600 * time.Millisecond)
	daPagina(t, pagina, map[string]any{"tipo": "tela"})
	select {
	case m := <-lidas:
		if m["erro"] != "foraDaReuniao" {
			t.Fatalf("a página recebeu %v; queria o foraDaReuniao, de um canal que continua aberto", m)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("o canal não respondeu")
	}
}

// ---------- O canal parado ----------

func TestCanal_SemPedirFecha(t *testing.T) {
	api.AjustarPedirEspera(t, 400*time.Millisecond)

	t.Run("o canal que só responde ao ping fecha com 1000", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canal(t, r.Codigo)
		if cod := apitest.Fechamento(t, pagina); cod != websocket.StatusNormalClosure {
			t.Fatalf("o canal fechou com %d; queria 1000", cod)
		}
	})

	t.Run("o canal que mandou o pedir não fecha", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		pagina := c.canal(t, r.Codigo)
		daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "Maria Lima"})
		aPaginaTipo(t, pagina, "naoComecou")
		lidas := make(chan map[string]any, 1)
		go func() {
			_, dados, err := pagina.Read(t.Context())
			var m map[string]any
			if err != nil {
				m = map[string]any{"erro de leitura": err.Error()}
			} else {
				json.Unmarshal(dados, &m)
			}
			lidas <- m
		}()
		time.Sleep(1200 * time.Millisecond) // três vezes o limite
		daPagina(t, pagina, map[string]any{"tipo": "tela"})
		if m := <-lidas; m["erro"] != "foraDaReuniao" {
			t.Fatalf("a página recebeu %v; queria o foraDaReuniao, de um canal aberto", m)
		}
	})
}

// ---------- O log ----------

// registroSeguro é um destino de log seguro entre goroutines.
type registroSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (r *registroSeguro) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.b.Write(p)
}

func (r *registroSeguro) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.b.String()
}

func TestPagina_SemNomesNoLog(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	var log registroSeguro
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	const nome = "Zuleide Quasimodo"
	carlos := c.colegaNaReuniao(t, r.Codigo)
	status, bilhete := c.a.AbrirPagina(r.Codigo)
	if status != http.StatusOK {
		t.Fatalf("abrir respondeu %d", status)
	}
	pagina, _, err := c.a.CanalDaPagina(bilhete, c.a.Base)
	if err != nil {
		t.Fatal(err)
	}
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": nome})
	aPaginaTipo(t, pagina, "aguardando")
	c.aceitar(t, c.kCarlos, r.Codigo, pedidoDe(t, carlos, nome))
	aceito := aPaginaTipo(t, pagina, "aceito")
	daPagina(t, pagina, map[string]any{"tipo": "senha"})
	nova := aPaginaTipo(t, pagina, "senha")
	daPagina(t, pagina, map[string]any{"tipo": "pedir", "nome": "outro"}) // fora de ordem
	aPaginaErro(t, pagina, "invalido")
	// Mais um canal, com um bilhete ruim e uma origem ruim: os erros também não vazam.
	c.a.CanalDaPagina("bilhete-que-nao-vale", c.a.Base)
	c.a.CanalDaPagina(bilhete, "https://mal.example")
	pagina.Close(websocket.StatusNormalClosure, "")
	// O log do pedido do canal sai quando o manipulador volta, e é a linha que o teste quer ver.
	prazo := time.Now().Add(5 * time.Second)
	for !strings.Contains(log.String(), "status=101") {
		if time.Now().After(prazo) {
			t.Fatalf("o log do fechamento do canal não saiu:\n%s", log.String())
		}
		time.Sleep(10 * time.Millisecond)
	}

	texto := log.String()
	if !strings.Contains(texto, "pedido") {
		t.Fatalf("o log não tem os pedidos; o teste não prova nada: %q", texto)
	}
	segredos := map[string]string{
		"o nome":         nome,
		"o código":       r.Codigo,
		"o bilhete":      bilhete,
		"a senha":        aceito["senha"].(string),
		"a senha nova":   nova["senha"].(string),
		"o participante": aceito["participante"].(string),
	}
	for o, s := range segredos {
		if strings.Contains(texto, s) {
			t.Fatalf("o log tem %s (%q):\n%s", o, s, texto)
		}
	}
}
