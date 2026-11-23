package api_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

// abrirResp é a resposta do abrir da página.
type abrirResp struct {
	Reuniao struct {
		Tipo string `json:"tipo"`
	} `json:"reuniao"`
	Bilhete string `json:"bilhete"`
	Colega  *struct {
		Nome    string  `json:"nome"`
		Chave   *string `json:"chave"`
		ValeAte *int64  `json:"valeAte"`
	} `json:"colega"`
}

// abrirCom faz o abrir da página com um corpo (nil é sem corpo). Não chama o Fatalf: roda em goroutines.
func (c *cenaR) abrirCom(codigo string, corpo any) *http.Response {
	var dados io.Reader
	switch b := corpo.(type) {
	case nil:
	case string:
		dados = strings.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		dados = strings.NewReader(string(j))
	}
	req, err := http.NewRequest("POST", c.a.Servidor.URL+"/api/v1/pagina/reunioes/"+codigo, dados)
	if err != nil {
		panic(err)
	}
	resp, err := c.a.Servidor.Client().Do(req)
	if err != nil {
		panic(err)
	}
	return resp
}

// abrirBom é o abrir que tem de dar 200.
func (c *cenaR) abrirBom(t *testing.T, codigo string, corpo any) abrirResp {
	t.Helper()
	resp := c.abrirCom(codigo, corpo)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("abrir respondeu %d", resp.StatusCode)
	}
	return apitest.LerJSON[abrirResp](t, resp)
}

func TestAbrirColega_SemCorpoComoHoje(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	resp := c.abrirCom(r.Codigo, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[map[string]json.RawMessage](t, resp)
	if _, tem := corpo["colega"]; tem || len(corpo) != 2 {
		t.Fatalf("corpo = %v; queria só reuniao e bilhete", corpo)
	}
}

func TestAbrirColega_ComOPasse(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)

	resp := c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q", cc)
	}
	a := apitest.LerJSON[abrirResp](t, resp)
	if len(a.Bilhete) != 43 || a.Reuniao.Tipo != "marcada" {
		t.Fatalf("resposta = %+v", a)
	}
	if a.Colega == nil || a.Colega.Nome != "Carlos Lima" {
		t.Fatalf("colega = %+v; queria o Carlos Lima", a.Colega)
	}
	if a.Colega.Chave == nil || !formaDoPasse.MatchString(*a.Colega.Chave) {
		t.Fatalf("a chave = %v; queria 43 caracteres base64url", a.Colega.Chave)
	}
	if a.Colega.ValeAte == nil || r.ValeAte == nil || *a.Colega.ValeAte != *r.ValeAte {
		t.Fatalf("valeAte = %v; queria o da reunião, %v", a.Colega.ValeAte, r.ValeAte)
	}
}

func TestAbrirColega_NaHoraNaoTemValeAte(t *testing.T) {
	c := novaCenaR(t)
	resp := c.a.Pedir(c.kAna, "POST", "/api/v1/reunioes/agora", map[string]any{"ramais": []string{"2003"}})
	r := apitest.LerJSON[struct {
		Reuniao reuniaoResp `json:"reuniao"`
	}](t, resp).Reuniao
	p := c.passe(t, c.kCarlos, r.Codigo)
	resp = c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	corpo := apitest.LerJSON[struct {
		Colega map[string]json.RawMessage `json:"colega"`
	}](t, resp)
	if v, tem := corpo.Colega["valeAte"]; !tem || string(v) != "null" {
		t.Fatalf("colega = %v; queria o valeAte null", corpo.Colega)
	}
}

func TestAbrirColega_OPasseValeUmaVez(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	c.abrirBom(t, r.Codigo, map[string]string{"passe": p.Passe})
	resp := c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
	if resp.StatusCode == http.StatusOK {
		t.Fatal("o passe gasto abriu de novo")
	}
	e := esperarErro(t, resp, 401, "passe")
	if e.Campo != "" {
		t.Fatalf("campo = %q", e.Campo)
	}
}

func TestAbrirColega_DoisAoMesmoTempo(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	var wg sync.WaitGroup
	respostas := make([]*http.Response, 2)
	for i := range respostas {
		wg.Add(1)
		go func() {
			defer wg.Done()
			respostas[i] = c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe})
		}()
	}
	wg.Wait()
	status := []int{respostas[0].StatusCode, respostas[1].StatusCode}
	if !(status[0] == 200 && status[1] == 401) && !(status[0] == 401 && status[1] == 200) {
		t.Fatalf("status = %v; queria um 200 e um 401", status)
	}
	for _, resp := range respostas {
		if resp.StatusCode == 401 {
			esperarErro(t, resp, 401, "passe")
		}
	}
}

func TestAbrirColega_ComAChave(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	troca := c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe})
	chave := *troca.Colega.Chave

	for i := range 3 {
		resp := c.abrirCom(r.Codigo, map[string]string{"colega": chave})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("o abrir %d com a chave deu %d", i+1, resp.StatusCode)
		}
		corpo := apitest.LerJSON[struct {
			Bilhete string                     `json:"bilhete"`
			Colega  map[string]json.RawMessage `json:"colega"`
		}](t, resp)
		if _, tem := corpo.Colega["chave"]; tem || len(corpo.Colega) != 2 {
			t.Fatalf("colega = %v; queria só nome e valeAte", corpo.Colega)
		}
		if string(corpo.Colega["nome"]) != `"Carlos Lima"` || len(corpo.Bilhete) != 43 {
			t.Fatalf("resposta = %+v", corpo)
		}
		var valeAte int64
		if json.Unmarshal(corpo.Colega["valeAte"], &valeAte) != nil || valeAte != *r.ValeAte {
			t.Fatalf("valeAte = %s; queria %d", corpo.Colega["valeAte"], *r.ValeAte)
		}
	}
}

func TestAbrirColega_PasseDeOutraReuniao(t *testing.T) {
	c := novaCenaR(t)
	a, b := c.marcada(t, c.kAna), c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, a.Codigo)
	esperarErro(t, c.abrirCom(b.Codigo, map[string]string{"passe": p.Passe}), 401, "passe")
	if x := c.abrirBom(t, a.Codigo, map[string]string{"passe": p.Passe}); x.Colega == nil {
		t.Fatal("o passe da A deixou de valer na A")
	}
}

func TestAbrirColega_PessoaTirada(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
	passe := c.passe(t, c.kCarlos, r.Codigo).Passe
	// A Bia também tem uma chave, que continua valendo.
	chaveBia := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kBia, r.Codigo).Passe}).Colega.Chave

	if _, _, err := c.a.Banco.TirarPessoa(t.Context(), c.acme.ID, c.carlos.ID); err != nil {
		t.Fatal(err)
	}
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": passe}), 401, "passe")
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	// A chave foi esquecida: o segundo 401 não depende só de a pessoa ter saído.
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	c.abrirBom(t, r.Codigo, map[string]string{"colega": chaveBia})
}

func TestAbrirColega_ComputadorDesligado(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
	passe := c.passe(t, c.kCarlos, r.Codigo).Passe
	if resp := c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil); resp.StatusCode != 204 {
		t.Fatalf("desligar deu %d", resp.StatusCode)
	}
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"colega": chave}), 401, "passe")
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": passe}), 401, "passe")
}

func TestAbrirColega_ReuniaoCancelada(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	p := c.passe(t, c.kCarlos, r.Codigo)
	c.a.Pedir(c.kAna, "DELETE", "/api/v1/reunioes/"+r.Codigo, nil)
	esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": p.Passe}), 404, "naoEncontrado")
	// Um corpo ruim também: o 404 vem antes de qualquer coisa do corpo.
	esperarErro(t, c.abrirCom(r.Codigo, "{quebrado"), 404, "naoEncontrado")
}

func TestAbrirColega_CorpoQueNaoVale(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	boa := strings.Repeat("a", 43)
	casos := []struct {
		nome, corpo, campo string
	}{
		{"os dois campos", `{"passe":"` + boa + `","colega":"` + boa + `"}`, "corpo"},
		{"um campo a mais", `{"passe":"` + boa + `","outro":1}`, "corpo"},
		{"só um campo desconhecido", `{"outro":"` + boa + `"}`, "corpo"},
		{"o objeto vazio", `{}`, "corpo"},
		{"um passe de 42 caracteres", `{"passe":"` + boa[:42] + `"}`, "passe"},
		{"uma chave de 44 caracteres", `{"colega":"` + boa + `a"}`, "colega"},
		{"fora do alfabeto", `{"passe":"` + boa[:42] + `+"}`, "passe"},
		{"um número no lugar do texto", `{"passe":12345}`, "passe"},
		{"o null no lugar do texto", `{"colega":null}`, "colega"},
		{"um corpo de 300 bytes", `{"passe":"` + strings.Repeat("a", 300) + `"}`, "corpo"},
		{"um JSON quebrado", `{"passe":`, "corpo"},
		{"lixo depois do objeto", `{"passe":"` + boa + `"} {}`, "corpo"},
		{"uma lista", `["` + boa + `"]`, "corpo"},
		{"só espaço", `   `, "corpo"},
	}
	for _, k := range casos {
		t.Run(k.nome, func(t *testing.T) {
			e := esperarErro(t, c.abrirCom(r.Codigo, k.corpo), 400, "invalido")
			if e.Campo != k.campo {
				t.Fatalf("campo = %q; queria %q", e.Campo, k.campo)
			}
		})
	}
}

func TestAbrirColega_AsFalhasContam(t *testing.T) {
	t.Run("com um passe inventado", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 20 {
			esperarErro(t, c.abrirCom(r.Codigo, map[string]string{"passe": strings.Repeat("b", 43)}), 401, "passe")
		}
		esperarErro(t, c.abrirCom(r.Codigo, nil), 429, "tentativas")
	})
	t.Run("com corpos que não valem", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		for range 20 {
			esperarErro(t, c.abrirCom(r.Codigo, `{}`), 400, "invalido")
		}
		esperarErro(t, c.abrirCom(r.Codigo, nil), 429, "tentativas")
	})
	t.Run("o abrir bom com a chave não gasta as falhas", func(t *testing.T) {
		c := novaCenaR(t)
		r := c.marcada(t, c.kAna)
		chave := *c.abrirBom(t, r.Codigo, map[string]string{"passe": c.passe(t, c.kCarlos, r.Codigo).Passe}).Colega.Chave
		for range 25 {
			c.abrirBom(t, r.Codigo, map[string]string{"colega": chave})
		}
		esperarErro(t, c.abrirCom(r.Codigo, `{}`), 400, "invalido")
	})
}

func TestAbrirColega_ReuniaoDeTeste(t *testing.T) {
	c := novaCenaR(t)
	teste, err := c.a.Banco.CriarReuniaoDeTeste(t.Context(), c.a.Relogio.Agora().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	esperarErro(t, c.abrirCom(teste.Codigo, map[string]string{"passe": strings.Repeat("c", 43)}), 401, "passe")
	// Sem corpo, abre como hoje.
	if x := c.abrirBom(t, teste.Codigo, nil); x.Colega != nil || x.Reuniao.Tipo != "teste" {
		t.Fatalf("resposta = %+v", x)
	}
}

func TestAbrirColega_NaoVaiAoLog(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	var log registroSeguro
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	p := c.passe(t, c.kCarlos, r.Codigo)
	a := c.abrirBom(t, r.Codigo, map[string]string{"passe": p.Passe})
	chave := *a.Colega.Chave
	c.abrirBom(t, r.Codigo, map[string]string{"colega": chave})
	inventada := strings.Repeat("d", 43)
	c.abrirCom(r.Codigo, map[string]string{"passe": inventada}).Body.Close()
	c.abrirCom(r.Codigo, `{"passe":"curto"}`).Body.Close()
	c.a.Pedir(c.kCarlos, "DELETE", "/api/v1/computadores/eu", nil)
	c.abrirCom(r.Codigo, map[string]string{"colega": chave}).Body.Close()

	texto := log.String()
	if !strings.Contains(texto, "pedido") {
		t.Fatalf("o log não tem os pedidos; o teste não prova nada: %q", texto)
	}
	for o, s := range map[string]string{
		"o passe": p.Passe, "a chave": chave, "o nome": "Carlos Lima", "o bilhete": a.Bilhete,
		"o passe inventado": inventada, "o código": r.Codigo,
	} {
		if strings.Contains(texto, s) {
			t.Fatalf("o log tem %s (%q):\n%s", o, s, texto)
		}
	}
}
