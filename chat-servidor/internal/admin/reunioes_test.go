package admin_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
)

// As chaves dos testes: a do agente falso da API (os bytes 0 a 31) e outra, para o 401.
const (
	chaveDoAgente = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	outraChave    = "ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4CBgoM"
)

// Os textos da página (task 14).
const (
	tNaoConfigurado  = "O servidor de vídeo ainda não foi configurado."
	tVersao          = "O servidor de vídeo respondeu: versão 0.1.0, FreeSWITCH no ar."
	tUso             = "Uso agora: CPU 34% · memória 41%."
	tChaveNaoConfere = "A chave não confere. Copie de novo a chave mostrada na instalação."
	tSemResposta     = "O servidor de vídeo não respondeu. Confira o endereço e se a porta dele está aberta (a 443, ou a que vem depois do endereço)."
	tFSFora          = "O servidor de vídeo respondeu, mas o FreeSWITCH está fora do ar. Veja os registros na VM de vídeo."
	tEndereco        = "Escreva só o endereço do servidor de vídeo (e a porta, se tiver), sem https://."
	tChave43         = "A chave tem 43 caracteres. Copie de novo a chave mostrada na instalação."
	tLimite          = "O número de reuniões ao mesmo tempo vai de 1 a 20."
	// tLinkAindaNaoAbre é a frase que o cartão da reunião de teste teve até a página das reuniões chegar. A etapa 1b a
	// tirou: o link abre a página, e o cartão não pode mais dizer o contrário.
	tLinkAindaNaoAbre = "O link só abre no navegador a partir da próxima versão do chat"
)

// agenteDeVideo é o agente do servidor de vídeo de verdade, num httptest: o estado e os eventos da seção 5.
type agenteDeVideo struct {
	*httptest.Server
	conexoes chan struct{} // uma entrada por conexão dos eventos
	fim      chan struct{}

	mu         sync.Mutex
	freeswitch bool
	adiantado  time.Duration // quanto o relógio do agente está na frente do do chat
}

// novoAgenteDeVideo sobe o agente, que só atende a chave dada. No fim do teste, o gerente solta o cliente antes de
// o servidor fechar (os Cleanup correm do último para o primeiro).
func (p *painel) novoAgenteDeVideo(t *testing.T, chave string) *agenteDeVideo {
	t.Helper()
	ag := &agenteDeVideo{conexoes: make(chan struct{}, 32), fim: make(chan struct{}), freeswitch: true}
	ag.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chave {
			http.Error(w, `{"erro":"chave"}`, http.StatusUnauthorized)
			return
		}
		ag.mu.Lock()
		fs, agora := ag.freeswitch, p.a.Relogio.Agora().Add(ag.adiantado).UnixMilli()
		ag.mu.Unlock()
		switch r.URL.Path {
		case "/agente/v1/estado":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"versao":"0.1.0","freeswitch":%t,"agora":%d,"salas":[],"uso":{"cpu":34,"memoria":41}}`, fs, agora)
		case "/agente/v1/eventos":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "data: {\"tipo\":\"estado\",\"agora\":%d,\"freeswitch\":%t,\"salas\":[]}\n\n", agora, fs)
			w.(http.Flusher).Flush()
			select {
			case ag.conexoes <- struct{}{}:
			default:
			}
			select {
			case <-r.Context().Done():
			case <-ag.fim:
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(func() {
		close(ag.fim)
		p.a.Gerente.Ligar(nil)
		ag.Server.Close()
	})
	return ag
}

func (ag *agenteDeVideo) definir(freeswitch bool, adiantado time.Duration) {
	ag.mu.Lock()
	ag.freeswitch, ag.adiantado = freeswitch, adiantado
	ag.mu.Unlock()
}

// esperarConexao confere que o agente recebeu a conexão dos eventos.
func (ag *agenteDeVideo) esperarConexao(t *testing.T) {
	t.Helper()
	select {
	case <-ag.conexoes:
	case <-time.After(5 * time.Second):
		t.Fatal("o agente de teste não recebeu a conexão dos eventos")
	}
}

// guardarETestar manda o formulário do cartão SERVIDOR DE VÍDEO.
func (n *navegador) guardarETestar(endereco, chave string) (*http.Response, string) {
	return n.acao("/admin/reunioes/servidor", url.Values{"endereco": {endereco}, "chave": {chave}})
}

func (n *navegador) tem(t *testing.T, caminho, texto string) {
	t.Helper()
	if _, corpo := n.get(caminho); !strings.Contains(corpo, texto) {
		t.Fatalf("GET %s não tem %q:\n%s", caminho, texto, corpo)
	}
}

func esperarTexto(t *testing.T, corpo string, quer ...string) {
	t.Helper()
	for _, q := range quer {
		if !strings.Contains(corpo, q) {
			t.Errorf("a página não tem %q:\n%s", q, corpo)
		}
	}
}

func esperarSem(t *testing.T, corpo string, nao ...string) {
	t.Helper()
	for _, q := range nao {
		if strings.Contains(corpo, q) {
			t.Errorf("a página não devia ter %q:\n%s", q, corpo)
		}
	}
}

func TestReunioes_SemConfig(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	resp, corpo := n.get("/admin/reunioes")
	esperarStatus(t, resp, corpo, http.StatusOK)
	esperarTexto(t, corpo, tNaoConfigurado, "Reuniões", "SERVIDOR DE VÍDEO", "Endereço do servidor de vídeo",
		"Chave do servidor de vídeo", "Guardar e testar", "Testar o servidor de vídeo", "AO MESMO TEMPO",
		"Reuniões ao mesmo tempo", "O padrão é 2, para a VM de 6 vCPU.", "AGORA", "0 reuniões acontecendo · 0 pessoas",
		"EMPRESAS", "REUNIÃO DE TESTE", "Criar a reunião de teste",
		"A chave aparece no fim da instalação do servidor de vídeo. Para ver de novo, rode na VM de vídeo: sudo starsonic-video mostrar-chave",
		"Abra o link em dois aparelhos, um deles um celular, para conferir a instalação. A reunião de teste não tem sala de espera e vale por 2 horas.")
	esperarSem(t, corpo, "Chave guardada", "Vale até", "Copiar o link", tLinkAindaNaoAbre)

	resp, corpo = n.get("/admin/")
	esperarStatus(t, resp, corpo, http.StatusOK)
	esperarTexto(t, corpo, "REUNIÕES", tNaoConfigurado, "Configurar as reuniões", `href="/admin/reunioes"`)

	// Sem a sessão, a página não existe para quem não entrou.
	resp, _ = p.navegador(t).get("/admin/reunioes")
	esperarIr(t, resp, "/admin/entrar")
}

func TestReunioes_GuardarETestar(t *testing.T) {
	t.Run("o agente responde", func(t *testing.T) {
		p := novoPainel(t)
		ag := p.novoAgenteDeVideo(t, chaveDoAgente)
		n := p.logado(t)
		resp, corpo := n.guardarETestar(ag.URL, chaveDoAgente)
		esperarStatus(t, resp, corpo, http.StatusOK)
		// A resposta do "Guardar e testar" já diz que o servidor responde, sem esperar a página de novo.
		esperarTexto(t, corpo, tVersao, tUso, "Chave guardada. Deixe em branco para manter.",
			"Servidor de vídeo: "+ag.URL+" · respondendo")
		esperarSem(t, corpo, "relógio do servidor de vídeo", chaveDoAgente)

		cfg, err := p.a.Banco.ConfigReunioes(t.Context())
		if err != nil || cfg.Endereco != ag.URL || cfg.Chave != chaveDoAgente {
			t.Fatalf("config = %+v, %v", cfg, err)
		}
		// O gerente passa a usar o cliente novo: ele abre a conexão dos eventos no agente.
		ag.esperarConexao(t)
		if v := p.a.Gerente.Video(); v == nil || v.Endereco() != strings.TrimPrefix(ag.URL, "http://") {
			t.Fatalf("o gerente usa %v", v)
		}
		// Com o agente ligado e o FreeSWITCH no ar, a página diz que ele responde.
		fim := time.Now().Add(5 * time.Second)
		for {
			_, corpo = n.get("/admin/reunioes")
			if strings.Contains(corpo, "Servidor de vídeo: "+ag.URL+" · respondendo") || time.Now().After(fim) {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		esperarTexto(t, corpo, "Servidor de vídeo: "+ag.URL+" · respondendo", "Chave guardada. Deixe em branco para manter.")
		n.tem(t, "/admin/", ag.URL+" · respondendo")

		// A chave em branco mantém a guardada, e o "Testar" usa o servidor guardado.
		resp, corpo = n.guardarETestar(ag.URL, "")
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tVersao)
		resp, corpo = n.acao("/admin/reunioes/testar", nil)
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tVersao, tUso)
		if cfg, _ := p.a.Banco.ConfigReunioes(t.Context()); cfg.Chave != chaveDoAgente {
			t.Fatalf("a chave em branco trocou a guardada: %q", cfg.Chave)
		}
	})

	t.Run("a chave não confere", func(t *testing.T) {
		p := novoPainel(t)
		ag := p.novoAgenteDeVideo(t, chaveDoAgente)
		n := p.logado(t)
		resp, corpo := n.guardarETestar(ag.URL, outraChave)
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tChaveNaoConfere)
		esperarSem(t, corpo, tVersao)
	})

	t.Run("o agente está fora", func(t *testing.T) {
		p := novoPainel(t)
		ag := p.novoAgenteDeVideo(t, chaveDoAgente)
		endereco := ag.URL
		n := p.logado(t)
		p.a.Gerente.Ligar(nil)
		ag.Server.CloseClientConnections()
		ag.Server.Listener.Close()
		resp, corpo := n.guardarETestar(endereco, chaveDoAgente)
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tSemResposta, "· sem resposta")
		esperarSem(t, corpo, tVersao)
	})

	t.Run("o FreeSWITCH está fora", func(t *testing.T) {
		p := novoPainel(t)
		ag := p.novoAgenteDeVideo(t, chaveDoAgente)
		ag.definir(false, 0)
		n := p.logado(t)
		resp, corpo := n.guardarETestar(ag.URL, chaveDoAgente)
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tFSFora)
		esperarSem(t, corpo, tVersao)
	})

	t.Run("o testar sem servidor guardado", func(t *testing.T) {
		p := novoPainel(t)
		n := p.logado(t)
		resp, corpo := n.acao("/admin/reunioes/testar", nil)
		esperarStatus(t, resp, corpo, http.StatusOK)
		esperarTexto(t, corpo, tNaoConfigurado)
	})
}

// TestReunioes_Relogio é o Review Focus 1: o aviso do relógio vem com a diferença de 5 s ou mais.
func TestReunioes_Relogio(t *testing.T) {
	for _, c := range []struct {
		nome   string
		desvio time.Duration
		quer   string // vazio: nenhum aviso
	}{
		{"45 s adiantado", 45 * time.Second, "O relógio do servidor de vídeo está 45 s adiantado em relação ao do chat. As reuniões funcionam assim mesmo, mas ligue o horário automático nas duas VMs."},
		{"45 s atrasado", -45 * time.Second, "O relógio do servidor de vídeo está 45 s atrasado em relação ao do chat."},
		{"5 s", 5 * time.Second, "está 5 s adiantado"},
		{"3 s", 3 * time.Second, ""},
		{"-4 s", -4 * time.Second, ""},
	} {
		t.Run(c.nome, func(t *testing.T) {
			p := novoPainel(t)
			ag := p.novoAgenteDeVideo(t, chaveDoAgente)
			ag.definir(true, c.desvio)
			n := p.logado(t)
			resp, corpo := n.guardarETestar(ag.URL, chaveDoAgente)
			esperarStatus(t, resp, corpo, http.StatusOK)
			esperarTexto(t, corpo, tVersao)
			if c.quer == "" {
				esperarSem(t, corpo, "relógio do servidor de vídeo", "adiantado", "atrasado")
			} else {
				esperarTexto(t, corpo, c.quer)
			}
		})
	}
}

func TestReunioes_Validacao(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	semMudar := func() {
		t.Helper()
		cfg, err := p.a.Banco.ConfigReunioes(t.Context())
		if err != nil || cfg.Endereco != "" || cfg.Chave != "" || cfg.Limite != 2 {
			t.Fatalf("a configuração mudou: %+v, %v", cfg, err)
		}
	}
	chave42 := chaveDoAgente[:42]
	for _, c := range []struct{ nome, endereco, chave, quer string }{
		{"https://", "https://video.exemplo.com.br", chaveDoAgente, tEndereco},
		{"caminho", "video.exemplo.com.br/sala", chaveDoAgente, tEndereco},
		{"vazio", "", chaveDoAgente, tEndereco},
		{"chave de 42", "video.exemplo.com.br", chave42, tChave43},
		{"chave de 44", "video.exemplo.com.br", chaveDoAgente + "A", tChave43},
		{"chave com sinal inválido", "video.exemplo.com.br", chaveDoAgente[:42] + "=", tChave43},
		{"sem chave guardada nem escrita", "video.exemplo.com.br", "", tChave43},
	} {
		resp, corpo := n.guardarETestar(c.endereco, c.chave)
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		esperarTexto(t, corpo, c.quer)
		if c.chave != "" {
			esperarSem(t, corpo, c.chave) // a chave nunca volta na página
		}
		semMudar()
		if v := p.a.Gerente.Video(); v != p.a.Video {
			t.Fatalf("o gerente trocou de servidor de vídeo com um formulário inválido: %v", v)
		}
	}
	for _, v := range []string{"0", "21", "x", "", "-1", "2,5"} {
		resp, corpo := n.acao("/admin/reunioes/limite", url.Values{"limite": {v}})
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		esperarTexto(t, corpo, tLimite)
		semMudar()
	}
	// Os limites de dentro valem.
	for _, v := range []string{"1", "20"} {
		resp, _ := n.acao("/admin/reunioes/limite", url.Values{"limite": {v}})
		esperarIr(t, resp, "/admin/reunioes")
	}
}

func TestReunioes_Limite(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	resp, _ := n.acao("/admin/reunioes/limite", url.Values{"limite": {"3"}})
	esperarIr(t, resp, "/admin/reunioes")
	if cfg, _ := p.a.Banco.ConfigReunioes(t.Context()); cfg.Limite != 3 {
		t.Fatalf("limite guardado = %d", cfg.Limite)
	}
	n.tem(t, "/admin/reunioes", `value="3"`)

	// O gerente lê o 3 sem reiniciar: três reuniões ao mesmo tempo, e a quarta dá servidorCheio.
	e := p.a.Empresa("ACME Comércio Ltda")
	p.a.LiberarReunioes(e.ID)
	var chaves []string
	for i := range 4 {
		k, _ := p.a.LigarComPessoa(e, fmt.Sprintf("200%d", i+1), fmt.Sprintf("Pessoa %d", i+1))
		chaves = append(chaves, k)
	}
	entrar := func(k string) *http.Response {
		resp := p.a.Pedir(k, "POST", "/api/v1/reunioes/agora", nil)
		esperarAPI(t, resp, http.StatusCreated)
		r := apitest.LerJSON[struct{ Reuniao struct{ Codigo string } }](t, resp).Reuniao
		resp = p.a.Pedir(k, "POST", "/api/v1/reunioes/"+r.Codigo+"/entrar", nil)
		if resp.StatusCode == http.StatusOK {
			ac := apitest.LerJSON[struct{ Participante string }](t, resp)
			rr, err := p.a.Banco.ReuniaoPorCodigo(t.Context(), r.Codigo)
			if err != nil {
				t.Fatal(err)
			}
			p.a.Gerente.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: rr.Sala, Participante: ac.Participante})
			return nil
		}
		return resp
	}
	for i := range 3 {
		if resp := entrar(chaves[i]); resp != nil {
			t.Fatalf("a reunião %d não entrou: %d", i+1, resp.StatusCode)
		}
	}
	if resp := entrar(chaves[3]); resp == nil {
		t.Fatal("a quarta reunião entrou, com o limite em 3")
	} else {
		esperarErroAPI(t, resp, http.StatusConflict, "servidorCheio")
	}
}

func TestReunioes_Empresas(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	k, _ := p.a.LigarComPessoa(e, "2001", "Ana Souza")
	n := p.logado(t)
	criar := func() *http.Response {
		return p.a.Pedir(k, "POST", "/api/v1/reunioes", map[string]any{"assunto": "Planejamento",
			"inicio": p.a.Relogio.Agora().Add(time.Hour).UnixMilli()})
	}
	_, corpo := n.get("/admin/reunioes")
	esperarTexto(t, corpo, "ACME Comércio Ltda", "Bloqueadas", "Liberar")
	esperarSem(t, corpo, "Liberadas")
	esperarErroAPI(t, criar(), http.StatusForbidden, "semReunioes")

	alvo := fmt.Sprintf("/admin/reunioes/empresas/%d", e.ID)
	resp, _ := n.acao(alvo, url.Values{"liberar": {"1"}})
	esperarIr(t, resp, "/admin/reunioes")
	esperarAPI(t, criar(), http.StatusCreated)
	_, corpo = n.get("/admin/reunioes")
	esperarTexto(t, corpo, "Liberadas", "Bloquear")
	esperarSem(t, corpo, "Bloqueadas")

	resp, _ = n.acao(alvo, url.Values{"liberar": {"0"}})
	esperarIr(t, resp, "/admin/reunioes")
	esperarErroAPI(t, criar(), http.StatusForbidden, "semReunioes")

	// O que não vale: o liberar que não é 1 nem 0, e a empresa que não existe.
	resp, corpo = n.acao(alvo, url.Values{"liberar": {"sim"}})
	esperarStatus(t, resp, corpo, http.StatusBadRequest)
	resp, corpo = n.acao("/admin/reunioes/empresas/9999", url.Values{"liberar": {"1"}})
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	resp, corpo = n.acao("/admin/reunioes/empresas/x", url.Values{"liberar": {"1"}})
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	esperarErroAPI(t, criar(), http.StatusForbidden, "semReunioes")
}

func TestReunioes_Teste(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	_, corpo := n.get("/admin/reunioes")
	esperarSem(t, corpo, "Vale até", "Copiar o link")

	resp, _ := n.acao("/admin/reunioes/teste", nil)
	esperarIr(t, resp, "/admin/reunioes")
	velha, err := p.a.Banco.ReuniaoDeTeste(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if quer := p.a.Relogio.Agora().Add(2 * time.Hour).UnixMilli(); velha.ValeAte != quer {
		t.Fatalf("valeAte = %d; queria agora + 2 h (%d)", velha.ValeAte, quer)
	}
	_, corpo = n.get("/admin/reunioes")
	// O relógio dos testes é 2026-11-04 12:00 UTC, 09:00 em Brasília: o teste vale até as 11:00.
	esperarTexto(t, corpo, p.a.Base+"/r/"+velha.Codigo, "Copiar o link", "Vale até 11:00", `id="copiar"`, "/admin/estatico/copiar.js",
		"Abra o link em dois aparelhos, um deles um celular, para conferir a instalação.")
	esperarSem(t, corpo, tLinkAindaNaoAbre)
	if status, bilhete := p.a.AbrirPagina(velha.Codigo); status != http.StatusOK || bilhete == "" {
		t.Fatalf("o abrir do código novo deu %d", status)
	}

	// Um segundo "Criar" troca o link, e a reunião velha acaba também no servidor de vídeo (M-19).
	p.a.Relogio.Avancar(10 * time.Minute)
	resp, _ = n.acao("/admin/reunioes/teste", nil)
	esperarIr(t, resp, "/admin/reunioes")
	nova, err := p.a.Banco.ReuniaoDeTeste(t.Context())
	if err != nil || nova.Codigo == velha.Codigo {
		t.Fatalf("a reunião de teste não trocou: %+v, %v", nova, err)
	}
	_, corpo = n.get("/admin/reunioes")
	esperarTexto(t, corpo, p.a.Base+"/r/"+nova.Codigo, "Vale até 11:10")
	esperarSem(t, corpo, velha.Codigo)
	if status, _ := p.a.AbrirPagina(velha.Codigo); status != http.StatusNotFound {
		t.Fatalf("o abrir do código antigo deu %d; queria 404", status)
	}
	if status, _ := p.a.AbrirPagina(nova.Codigo); status != http.StatusOK {
		t.Fatalf("o abrir do código novo deu %d; queria 200", status)
	}
	if cmds := p.a.Video.Comandos(); len(cmds) != 1 || cmds[0] != "encerrar "+velha.Sala {
		t.Fatalf("comandos do agente = %v; queria só encerrar da sala antiga", cmds)
	}
}

// O copiar.js serve ao código da empresa e ao link da reunião de teste (a revisão da Task 14, Minor 1): o botão pode
// dar os textos dele (data-copiado e data-erro), e o cartão da reunião de teste diz "Link copiado.". Sem eles, valem os
// do código, e a página da empresa continua como era. Sem um navegador nos testes, o script é conferido pelo texto.
func TestReunioes_CopiarOLink(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	resp, _ := n.acao("/admin/reunioes/teste", nil)
	esperarIr(t, resp, "/admin/reunioes")
	_, corpo := n.get("/admin/reunioes")
	esperarTexto(t, corpo, `id="copiar" data-copiado="Link copiado." data-erro="Não deu para copiar. Selecione o link e copie." hidden>Copiar o link</button>`)

	e := p.a.Empresa("ACME Comércio Ltda")
	_, corpo = n.get(fmt.Sprintf("/admin/empresas/%d", e.ID))
	esperarTexto(t, corpo, `id="copiar" hidden>Copiar o código</button>`)
	esperarSem(t, corpo, "data-copiado", "data-erro")

	_, script := n.get("/admin/estatico/copiar.js")
	esperarTexto(t, script, `botao.getAttribute("data-copiado") || "Código copiado."`,
		`botao.getAttribute("data-erro") || "Não deu para copiar. Selecione o código e copie."`)
}

func TestReunioes_SemNomes(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	p.a.LiberarReunioes(e.ID)
	kAna, _ := p.a.LigarComPessoa(e, "2001", "Ana Souza")

	// A Ana está numa reunião acontecendo, e a Maria Lima, de fora, espera na sala de espera.
	resp := p.a.Pedir(kAna, "POST", "/api/v1/reunioes/agora", nil)
	esperarAPI(t, resp, http.StatusCreated)
	codigo := apitest.LerJSON[struct{ Reuniao struct{ Codigo string } }](t, resp).Reuniao.Codigo
	resp = p.a.Pedir(kAna, "POST", "/api/v1/reunioes/"+codigo+"/entrar", nil)
	esperarAPI(t, resp, http.StatusOK)
	ac := apitest.LerJSON[struct{ Participante string }](t, resp)
	reuniao, err := p.a.Banco.ReuniaoPorCodigo(t.Context(), codigo)
	if err != nil {
		t.Fatal(err)
	}
	p.a.Gerente.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: reuniao.Sala, Participante: ac.Participante})
	status, bilhete := p.a.AbrirPagina(codigo)
	if status != http.StatusOK {
		t.Fatalf("abrir deu %d", status)
	}
	canal, _, err := p.a.CanalDaPagina(bilhete, p.a.Base)
	if err != nil {
		t.Fatal(err)
	}
	if err := canal.Write(t.Context(), 1, []byte(`{"tipo":"pedir","nome":"Maria Lima"}`)); err != nil {
		t.Fatal(err)
	}
	fim := time.Now().Add(5 * time.Second)
	for { // espera o pedido entrar na sala de espera
		if time.Now().After(fim) {
			t.Fatal("o pedido da Maria Lima não entrou na sala de espera")
		}
		if reunioes, pessoas := p.a.Gerente.Resumo(); reunioes != 1 || pessoas != 1 {
			t.Fatalf("resumo = %d, %d", reunioes, pessoas)
		}
		l, err := p.a.Gerente.Lista(reuniao, mustPessoa(t, p, e.ID))
		if err == nil && len(l.Pedidos) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	n := p.logado(t)
	lista := "/admin/"
	paginaDaEmpresa := fmt.Sprintf("/admin/empresas/%d", e.ID)
	for _, c := range []struct {
		caminho  string
		temAna   bool // a página da empresa lista os colegas, por desenho
		contagem string
	}{
		{lista, false, ""},
		{"/admin/reunioes", false, "1 reunião acontecendo · 1 pessoa"},
		{paginaDaEmpresa, true, ""},
		{"/admin/empresas/nova", false, ""},
		{paginaDaEmpresa + "/apagar", false, ""},
		{"/admin/nada", false, ""},
	} {
		resp, corpo := n.get(c.caminho)
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
			t.Fatalf("GET %s = %d", c.caminho, resp.StatusCode)
		}
		if c.contagem != "" {
			esperarTexto(t, corpo, c.contagem)
		}
		esperarSem(t, corpo, "Maria Lima", codigo, strings.ToUpper(codigo))
		if !c.temAna {
			esperarSem(t, corpo, "Ana Souza")
		}
	}
	n.tem(t, paginaDaEmpresa, "Ana Souza")
}

// A empresa que perde as reuniões, pelo Bloquear da página "Reuniões" ou pelo Apagar a empresa, tem as reuniões
// dela que estão acontecendo encerradas pelo gerente (a revisão final, M3): o agente recebe o encerrar de cada sala,
// a página de quem é de fora e está numa delas recebe o encerrada, e a reunião de outra empresa continua.
func TestReunioes_EmpresaPerdeAsReunioes(t *testing.T) {
	for _, caso := range []struct {
		nome    string
		destino string
		acao    func(n *navegador, e banco.Empresa) *http.Response
	}{
		{"o Bloquear", "/admin/reunioes", func(n *navegador, e banco.Empresa) *http.Response {
			resp, _ := n.acao(fmt.Sprintf("/admin/reunioes/empresas/%d", e.ID), url.Values{"liberar": {"0"}})
			return resp
		}},
		{"o Apagar a empresa", "/admin/", func(n *navegador, e banco.Empresa) *http.Response {
			resp, _ := n.acao(fmt.Sprintf("/admin/empresas/%d/apagar", e.ID), url.Values{"nome": {e.Nome}})
			return resp
		}},
	} {
		t.Run(caso.nome, func(t *testing.T) {
			p := novoPainel(t)
			if err := p.a.Banco.GuardarLimiteReunioes(t.Context(), 5); err != nil {
				t.Fatal(err)
			}
			acme, outra := p.a.Empresa("ACME Comércio Ltda"), p.a.Empresa("Outra Ltda")
			p.a.LiberarReunioes(acme.ID)
			p.a.LiberarReunioes(outra.ID)
			kAna, ana := p.a.LigarComPessoa(acme, "2001", "Ana Souza")
			kCarlos, _ := p.a.LigarComPessoa(acme, "2002", "Carlos Lima")
			kBia, _ := p.a.LigarComPessoa(outra, "2003", "Bia Ramos")
			// dentro: o colega cria a reunião (pela rota e o corpo dados), entra, e a câmera dele entra.
			dentro := func(chave, rota string, corpo any) banco.Reuniao {
				t.Helper()
				resp := p.a.Pedir(chave, "POST", rota, corpo)
				esperarAPI(t, resp, http.StatusCreated)
				codigo := apitest.LerJSON[struct{ Reuniao struct{ Codigo string } }](t, resp).Reuniao.Codigo
				resp = p.a.Pedir(chave, "POST", "/api/v1/reunioes/"+codigo+"/entrar", nil)
				esperarAPI(t, resp, http.StatusOK)
				ac := apitest.LerJSON[struct{ Participante string }](t, resp)
				r, err := p.a.Banco.ReuniaoPorCodigo(t.Context(), codigo)
				if err != nil {
					t.Fatal(err)
				}
				p.a.Gerente.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: ac.Participante})
				return r
			}
			marcada := dentro(kAna, "/api/v1/reunioes", map[string]any{"assunto": "Planejamento",
				"inicio": p.a.Relogio.Agora().UnixMilli()})
			naHora := dentro(kCarlos, "/api/v1/reunioes/agora", nil)
			daOutra := dentro(kBia, "/api/v1/reunioes/agora", nil)

			// A Maria Lima, de fora, entra na marcada pela página.
			status, bilhete := p.a.AbrirPagina(marcada.Codigo)
			if status != http.StatusOK {
				t.Fatalf("abrir deu %d", status)
			}
			canal, _, err := p.a.CanalDaPagina(bilhete, p.a.Base)
			if err != nil {
				t.Fatal(err)
			}
			lerTipo := func(quer string) map[string]any {
				t.Helper()
				m := apitest.LerEvento[map[string]any](t, canal)
				if m["tipo"] != quer {
					t.Fatalf("a página recebeu %v; queria %q", m, quer)
				}
				return m
			}
			if err := canal.Write(t.Context(), websocket.MessageText, []byte(`{"tipo":"pedir","nome":"Maria Lima"}`)); err != nil {
				t.Fatal(err)
			}
			lerTipo("aguardando")
			l, err := p.a.Gerente.Lista(marcada, ana.ID)
			if err != nil || len(l.Pedidos) != 1 {
				t.Fatalf("Lista = %+v, %v", l, err)
			}
			if err := p.a.Gerente.Aceitar(t.Context(), marcada, ana.ID, l.Pedidos[0].ID); err != nil {
				t.Fatal(err)
			}
			maria, _ := lerTipo("aceito")["participante"].(string)
			p.a.Gerente.EventoDoVideo(video.Evento{Tipo: "entrou", Sala: marcada.Sala, Participante: maria})
			if reunioes, pessoas := p.a.Gerente.Resumo(); reunioes != 3 || pessoas != 4 {
				t.Fatalf("antes: Resumo = %d, %d; queria 3, 4", reunioes, pessoas)
			}

			esperarIr(t, caso.acao(p.logado(t), acme), caso.destino)

			cmds := p.a.Video.Comandos()
			slices.Sort(cmds)
			quer := []string{"encerrar " + marcada.Sala, "encerrar " + naHora.Sala}
			slices.Sort(quer)
			if !slices.Equal(cmds, quer) {
				t.Fatalf("o agente recebeu %q; queria %q", cmds, quer)
			}
			lerTipo("encerrada")
			for _, r := range []banco.Reuniao{marcada, naHora} {
				if acontecendo, n := p.a.Gerente.Contagem(r.Sala); acontecendo || n != 0 {
					t.Fatalf("a reunião da ACME continua: %v, %d", acontecendo, n)
				}
			}
			if acontecendo, n := p.a.Gerente.Contagem(daOutra.Sala); !acontecendo || n != 1 {
				t.Fatalf("a reunião da outra empresa: %v, %d; queria true, 1", acontecendo, n)
			}
		})
	}
}

func mustPessoa(t *testing.T, p *painel, empresa int64) int64 {
	t.Helper()
	return int64(p.a.Contar(`SELECT id FROM pessoas WHERE empresa_id = ? AND nome = 'Ana Souza'`, empresa))
}

func TestReunioes_CSRF(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	n := p.logado(t)
	antes, _ := p.a.Banco.ConfigReunioes(t.Context())
	for caminho, campos := range map[string]url.Values{
		"/admin/reunioes/servidor":                       {"endereco": {"video.exemplo.com.br"}, "chave": {chaveDoAgente}},
		"/admin/reunioes/testar":                         {},
		"/admin/reunioes/limite":                         {"limite": {"7"}},
		fmt.Sprintf("/admin/reunioes/empresas/%d", e.ID): {"liberar": {"1"}},
		"/admin/reunioes/teste":                          {},
	} {
		resp, corpo := n.post(caminho, campos)
		esperarStatus(t, resp, corpo, http.StatusForbidden)
		conferirCabecalhos(t, "POST "+caminho+" sem o csrf", resp, corpo)
		// Com o CSRF de outro lugar, também.
		c := url.Values{"csrf": {strings.Repeat("A", 43)}}
		for k, v := range campos {
			c[k] = v
		}
		resp, corpo = n.post(caminho, c)
		esperarStatus(t, resp, corpo, http.StatusForbidden)
	}
	depois, _ := p.a.Banco.ConfigReunioes(t.Context())
	if depois != antes {
		t.Fatalf("a configuração mudou sem o CSRF: %+v", depois)
	}
	if _, err := p.a.Banco.ReuniaoDeTeste(t.Context()); err == nil {
		t.Fatal("a reunião de teste foi criada sem o CSRF")
	}
	if r, _ := p.a.Banco.ResumoDaEmpresa(t.Context(), e.ID); r.Reunioes {
		t.Fatal("a empresa foi liberada sem o CSRF")
	}
	// Sem a sessão, os POST vão para a entrada.
	anonimo := p.navegador(t)
	for _, c := range []string{"/admin/reunioes/servidor", "/admin/reunioes/testar", "/admin/reunioes/limite",
		"/admin/reunioes/empresas/1", "/admin/reunioes/teste"} {
		resp, _ := anonimo.post(c, nil)
		esperarIr(t, resp, "/admin/entrar")
	}
}
