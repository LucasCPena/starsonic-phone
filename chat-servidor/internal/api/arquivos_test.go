package api_test

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

const (
	maxArquivoTeste   = 26214400
	maxMiniaturaTeste = 204800
	cabecalhoJPEG     = "\xff\xd8\xff\xe0"
)

// enviarArquivo faz o POST /api/v1/arquivos. O nome vai como está, sem percent-encoding
// nenhum: quem chama decide.
func enviarArquivo(a *apitest.Ambiente, chave, nomeCodificado, tipo string, corpo io.Reader, tamanho int64) *http.Response {
	a.T.Helper()
	req, err := http.NewRequestWithContext(a.T.Context(), "POST", a.Servidor.URL+"/api/v1/arquivos", corpo)
	if err != nil {
		a.T.Fatal(err)
	}
	if tamanho >= 0 {
		req.ContentLength = tamanho
	} else {
		req.ContentLength = -1 // sem Content-Length: vai em pedaços
	}
	req.Header.Set("Authorization", "Bearer "+chave)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	if nomeCodificado != "" {
		req.Header.Set("X-Arquivo-Nome", nomeCodificado)
	}
	resp, err := a.Servidor.Client().Do(req)
	if err != nil {
		a.T.Fatalf("POST arquivos: %v", err)
	}
	a.T.Cleanup(func() { resp.Body.Close() })
	return resp
}

// zeros é um leitor de n bytes zero, sem guardar nada na memória.
type zeros struct{ restam int64 }

func (z *zeros) Read(p []byte) (int, error) {
	if z.restam <= 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > z.restam {
		n = z.restam
	}
	clear(p[:n])
	z.restam -= n
	return int(n), nil
}

// arquivosNoDisco lista os arquivos (não as pastas) de baixo da pasta dos arquivos,
// também os temporários.
func arquivosNoDisco(t *testing.T, a *apitest.Ambiente) []string {
	t.Helper()
	var lista []string
	err := filepath.WalkDir(a.Arquivos, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			lista = append(lista, p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return lista
}

func linhasDeArquivos(t *testing.T, c *cena) int {
	t.Helper()
	return c.a.Contar(`SELECT COUNT(*) FROM arquivos`)
}

func baixar(c *cena, chave, id string) *http.Response {
	return c.a.Pedir(chave, "GET", "/api/v1/arquivos/"+id, nil)
}

func enviarMensagemArquivo(c *cena, chave string, conversa int64, idLocal, arquivo string) *http.Response {
	return c.a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conversa),
		map[string]string{"idLocal": idLocal, "arquivo": arquivo})
}

func TestArquivo_EnviarEBaixar(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	dados := bytes.Repeat([]byte("%PDF-1.4 ACME\n"), 72)[:1000]

	resp := enviarArquivo(c.a, c.kAna, "Proposta%20ACME.pdf", "application/pdf", bytes.NewReader(dados), int64(len(dados)))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("enviar respondeu %d", resp.StatusCode)
	}
	arq := apitest.LerJSON[struct{ Arquivo apitest.Arquivo }](t, resp).Arquivo
	quer := apitest.Arquivo{ID: arq.ID, Nome: "Proposta ACME.pdf", Tipo: "application/pdf", Tamanho: 1000}
	if arq != quer || len(arq.ID) != 32 {
		t.Fatalf("arquivo = %+v; queria %+v", arq, quer)
	}

	resp = enviarMensagemArquivo(c, c.kAna, conv, "a1", arq.ID)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("a mensagem com arquivo respondeu %d", resp.StatusCode)
	}
	m := apitest.LerJSON[struct{ Mensagem mensagemResp }](t, resp).Mensagem
	if m.Tipo != "arquivo" || m.Arquivo == nil || *m.Arquivo != arq || m.Texto != nil {
		t.Fatalf("mensagem = %+v", m)
	}

	resp = baixar(c, c.kBia, arq.ID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("baixar respondeu %d", resp.StatusCode)
	}
	got, _ := io.ReadAll(resp.Body)
	if !bytes.Equal(got, dados) {
		t.Fatalf("os bytes baixados são outros (%d bytes)", len(got))
	}
	h := resp.Header
	if h.Get("Content-Type") != "application/octet-stream" ||
		h.Get("Content-Disposition") != `attachment; filename="Proposta ACME.pdf"; filename*=UTF-8''Proposta%20ACME.pdf` ||
		h.Get("X-Content-Type-Options") != "nosniff" ||
		h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cabeçalhos = %v", h)
	}
	// A mensagem aparece nas páginas da Beatriz, com o arquivo.
	p := c.pagina(t, c.kBia, conv, "")
	if len(p.Mensagens) != 1 || p.Mensagens[0].Arquivo == nil || p.Mensagens[0].Arquivo.ID != arq.ID {
		t.Fatalf("página = %+v", p)
	}
}

func TestArquivo_MensagemChegaPorEvento(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	ws := c.a.Conectar(c.kBia)
	arq := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	enviarMensagemArquivo(c, c.kAna, conv, "a1", arq.ID)
	ev := apitest.LerEvento[eventoMensagem](t, ws)
	if ev.Tipo != "mensagem" || ev.Mensagem.Arquivo == nil || ev.Mensagem.Arquivo.ID != arq.ID {
		t.Fatalf("evento = %+v", ev)
	}
}

func TestArquivo_SemChaveESemPessoa(t *testing.T) {
	c := novaCena(t)
	esperarErro(t, c.a.Pedir("", "POST", "/api/v1/arquivos", []byte("x")), 401, "chave")
	esperarErro(t, c.a.Pedir("", "GET", "/api/v1/arquivos/"+strings.Repeat("a", 32), nil), 401, "chave")
	acme := c.a.Empresa("Sem Pessoa Ltda")
	k := c.a.Ligar(acme.Codigo, "PC-VAZIO")
	esperarErro(t, c.a.Pedir(k, "POST", "/api/v1/arquivos", []byte("x")), 409, "pessoa")
	esperarErro(t, c.a.Pedir(k, "GET", "/api/v1/arquivos/"+strings.Repeat("a", 32), nil), 409, "pessoa")
}

func TestArquivo_Grande(t *testing.T) {
	c := novaCena(t)
	// Com o Content-Length: responde logo, sem guardar nada.
	resp := enviarArquivo(c.a, c.kAna, "", "application/pdf", &zeros{maxArquivoTeste + 1}, maxArquivoTeste+1)
	esperarErro(t, resp, 413, "grande")
	// Sem o Content-Length: lê até o limite e conta o que chegou.
	resp = enviarArquivo(c.a, c.kAna, "", "application/pdf", &zeros{maxArquivoTeste + 1}, -1)
	esperarErro(t, resp, 413, "grande")
	if l := arquivosNoDisco(t, c.a); len(l) != 0 {
		t.Fatalf("sobrou no disco: %v", l)
	}
	if n := linhasDeArquivos(t, c); n != 0 {
		t.Fatalf("arquivos no banco = %d", n)
	}
	// Depois dos dois recusados, um envio do tamanho máximo exato entra (o limite de tamanho
	// é de "mais de 25 MB", não de "25 MB"). Que a recusa não gasta a cota da hora fica para
	// o TestArquivo_CotaSemTamanho e o TestArquivo_CortadoDevolveACota.
	resp = enviarArquivo(c.a, c.kAna, "", "application/pdf", &zeros{maxArquivoTeste}, -1)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("25 MB exatos respondeu %d", resp.StatusCode)
	}
}

// TestArquivo_Cortado é o Review Focus 5: o cliente diz que manda 1 MB, manda 100 KB e fecha.
func TestArquivo_Cortado(t *testing.T) {
	c := novaCena(t)
	cortar(t, c, c.kAna, 1<<20, 100<<10)
	time.Sleep(500 * time.Millisecond)
	if l := arquivosNoDisco(t, c.a); len(l) != 0 {
		t.Fatalf("sobrou no disco: %v", l)
	}
	if n := linhasDeArquivos(t, c); n != 0 {
		t.Fatalf("arquivos no banco = %d", n)
	}
}

// cortar manda um POST /api/v1/arquivos por uma conexão TCP crua, com o Content-Length
// declarado, escreve só enviar bytes do corpo e fecha. Espera o servidor começar a guardar o
// que chegou antes de fechar, para o teste não passar sem o envio ter começado.
func cortar(t *testing.T, c *cena, chave string, declarado, enviar int) {
	t.Helper()
	conn, err := net.Dial("tcp", c.a.Servidor.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	cab := fmt.Sprintf("POST /api/v1/arquivos HTTP/1.1\r\nHost: chat\r\nAuthorization: Bearer %s\r\n"+
		"Content-Type: application/pdf\r\nX-Arquivo-Nome: cortado.pdf\r\nContent-Length: %d\r\n\r\n", chave, declarado)
	if _, err := conn.Write([]byte(cab)); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write(make([]byte, enviar)); err != nil {
		t.Fatal(err)
	}
	// O servidor tem de ter começado a guardar (um temporário no disco) antes de a conexão cair.
	limite := time.Now().Add(3 * time.Second)
	for len(arquivosNoDisco(t, c.a)) == 0 {
		if time.Now().After(limite) {
			t.Fatal("o servidor não começou a guardar o envio")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestArquivo_CortadoDevolveACota(t *testing.T) {
	c := novaCena(t)
	// Oito envios de 25 MB declarados enchem a cota da hora (8 x 25 MB = 200 MB). Todos são
	// cortados; depois disso a cota tem de estar livre.
	for i := 0; i < 8; i++ {
		cortar(t, c, c.kAna, maxArquivoTeste, 10<<10)
		esperarSemArquivos(t, c)
	}
	arq := c.a.Enviar(c.kAna, "ok.pdf", "application/pdf", []byte("depois dos cortes"))
	if arq.Tamanho != 17 {
		t.Fatalf("arquivo = %+v", arq)
	}
}

func esperarSemArquivos(t *testing.T, c *cena) {
	t.Helper()
	limite := time.Now().Add(5 * time.Second)
	for len(arquivosNoDisco(t, c.a)) != 0 {
		if time.Now().After(limite) {
			t.Fatalf("o envio cortado deixou %v", arquivosNoDisco(t, c.a))
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond) // o servidor devolve a cota logo depois de apagar
}

// TestArquivo_Nomes é o Review Focus 1.
func TestArquivo_Nomes(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)

	nome := func(t *testing.T, codificado string) (apitest.Arquivo, string) {
		t.Helper()
		c := &cena{a: c.a.Com(t), kAna: c.kAna, kBia: c.kBia}
		resp := enviarArquivo(c.a, c.kAna, codificado, "application/pdf", strings.NewReader("conteúdo"), -1)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("enviar %q respondeu %d", codificado, resp.StatusCode)
		}
		a := apitest.LerJSON[struct{ Arquivo apitest.Arquivo }](t, resp).Arquivo
		enviarMensagemArquivo(c, c.kAna, conv, "n"+a.ID[:8], a.ID)
		r := baixar(c, c.kBia, a.ID)
		if r.StatusCode != 200 {
			t.Fatalf("baixar respondeu %d", r.StatusCode)
		}
		return a, r.Header.Get("Content-Disposition")
	}

	t.Run("barraAspasEAcentos", func(t *testing.T) {
		a, cd := nome(t, url.PathEscape(`../Proposta "ACME" ção.pdf`))
		if a.Nome != "Proposta ACME ção.pdf" {
			t.Fatalf("nome = %q", a.Nome)
		}
		quer := `attachment; filename="Proposta ACME __o.pdf"; filename*=UTF-8''Proposta%20ACME%20%C3%A7%C3%A3o.pdf`
		if cd != quer {
			t.Fatalf("Content-Disposition = %q\nqueria             %q", cd, quer)
		}
	})
	t.Run("barraInvertida", func(t *testing.T) {
		a, cd := nome(t, url.PathEscape(`C:\Users\ana\relatório final.docx`))
		if a.Nome != "relatório final.docx" || !strings.HasPrefix(cd, `attachment; filename="relat_rio final.docx"; filename*=UTF-8''relat%C3%B3rio%20final.docx`) {
			t.Fatalf("nome = %q, cd = %q", a.Nome, cd)
		}
	})
	t.Run("quebraDeLinha", func(t *testing.T) {
		a, cd := nome(t, "ano%0D%0AX-Injetado%3A%20sim.pdf")
		if a.Nome != "anoX-Injetado sim.pdf" {
			t.Fatalf("nome = %q", a.Nome)
		}
		if strings.ContainsAny(cd, "\r\n") || cd != `attachment; filename="anoX-Injetado sim.pdf"; filename*=UTF-8''anoX-Injetado%20sim.pdf` {
			t.Fatalf("Content-Disposition = %q", cd)
		}
	})
	t.Run("trezentosCaracteres", func(t *testing.T) {
		a, _ := nome(t, url.PathEscape(strings.Repeat("a", 296)+".pdf"))
		if n := len([]rune(a.Nome)); n != 120 || !strings.HasSuffix(a.Nome, ".pdf") {
			t.Fatalf("nome com %d caracteres: %q", n, a.Nome)
		}
	})
	t.Run("soPontos", func(t *testing.T) {
		a, cd := nome(t, "...")
		if a.Nome != "arquivo" || cd != `attachment; filename="arquivo"; filename*=UTF-8''arquivo` {
			t.Fatalf("nome = %q, cd = %q", a.Nome, cd)
		}
	})
	t.Run("semOCabecalho", func(t *testing.T) {
		a, _ := nome(t, "")
		if a.Nome != "arquivo" {
			t.Fatalf("nome = %q", a.Nome)
		}
	})
	t.Run("percentInvalido", func(t *testing.T) {
		a, _ := nome(t, "%zz.pdf")
		if a.Nome != "arquivo" {
			t.Fatalf("nome = %q", a.Nome)
		}
	})
	t.Run("caracteresDeCabecalho", func(t *testing.T) {
		// Aspas e barra invertida nunca chegam ao nome (a regra os tira ou corta); o ';' e o '%' ficam
		// e têm de sair certos nos dois campos.
		a, cd := nome(t, url.PathEscape("a;b%c'd.txt"))
		if a.Nome != "a;b%c'd.txt" || cd != `attachment; filename="a;b%c'd.txt"; filename*=UTF-8''a%3Bb%25c%27d.txt` {
			t.Fatalf("nome = %q, cd = %q", a.Nome, cd)
		}
	})
}

func TestArquivo_Tipo(t *testing.T) {
	c := novaCena(t)
	if a := c.a.Enviar(c.kAna, "f.png", "image/PNG", []byte("x")); a.Tipo != "image/png" || !a.Foto {
		t.Fatalf("png = %+v", a)
	}
	if a := c.a.Enviar(c.kAna, "f.bin", "isto não é tipo", []byte("x")); a.Tipo != "application/octet-stream" || a.Foto {
		t.Fatalf("tipo ruim = %+v", a)
	}
	resp := enviarArquivo(c.a, c.kAna, "f", "", strings.NewReader("x"), -1)
	if a := apitest.LerJSON[struct{ Arquivo apitest.Arquivo }](t, resp).Arquivo; a.Tipo != "application/octet-stream" {
		t.Fatalf("sem tipo = %+v", a)
	}
}

func TestArquivo_QuemBaixa(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	arq := c.a.Enviar(c.kAna, "Proposta ACME.pdf", "application/pdf", []byte("conteudo"))

	// Quem enviou baixa antes de mandar a mensagem; os outros não.
	if r := baixar(c, c.kAna, arq.ID); r.StatusCode != 200 {
		t.Fatalf("a autora respondeu %d", r.StatusCode)
	}
	esperarErro(t, baixar(c, c.kBia, arq.ID), 404, "naoEncontrado")

	if r := enviarMensagemArquivo(c, c.kAna, conv, "q1", arq.ID); r.StatusCode != 201 {
		t.Fatalf("mensagem respondeu %d", r.StatusCode)
	}
	if r := baixar(c, c.kBia, arq.ID); r.StatusCode != 200 {
		t.Fatalf("a Beatriz respondeu %d", r.StatusCode)
	}
	// O Carlos é da mesma empresa e não está na conversa; o Abel é de outra empresa.
	esperarErro(t, baixar(c, c.kCarlos, arq.ID), 404, "naoEncontrado")
	esperarErro(t, baixar(c, c.kAbel, arq.ID), 404, "naoEncontrado")
	// Um id que não existe, ou que não é um id, dá o mesmo.
	esperarErro(t, baixar(c, c.kAna, strings.Repeat("0", 32)), 404, "naoEncontrado")
	esperarErro(t, baixar(c, c.kAna, "..%2F..%2Fetc%2Fpasswd"), 404, "naoEncontrado")
	esperarErro(t, baixar(c, c.kAna, strings.ToUpper(arq.ID)), 404, "naoEncontrado")
}

func TestArquivo_QuemBaixa_Grupo(t *testing.T) {
	c := novaCena(t)
	g := c.criarGrupo(t, c.kAna, "Comercial", c.bia.ID)
	arq := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	c.a.Relogio.Avancar(time.Minute)
	enviarMensagemArquivo(c, c.kAna, g.ID, "g1", arq.ID)
	c.a.Relogio.Avancar(time.Minute)
	if r := c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/membros", g.ID), map[string]any{"pessoas": []int64{c.carlos.ID}}); r.StatusCode != 204 {
		t.Fatalf("pôr o Carlos: %d", r.StatusCode)
	}
	if r := baixar(c, c.kBia, arq.ID); r.StatusCode != 200 {
		t.Fatalf("membro de antes: %d", r.StatusCode)
	}
	// O Carlos entrou depois da mensagem: ela não é visível para ele.
	esperarErro(t, baixar(c, c.kCarlos, arq.ID), 404, "naoEncontrado")
	esperarErro(t, baixar(c, c.kDani, arq.ID), 404, "naoEncontrado")
}

func TestArquivo_Expirado(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	arq := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	enviarMensagemArquivo(c, c.kAna, conv, "e1", arq.ID)
	c.a.Exec(`UPDATE arquivos SET expirado_em = ?`, time.Now().UnixMilli())
	esperarErro(t, baixar(c, c.kBia, arq.ID), 410, "expirado")
	// Quem não podia baixar segue vendo 404.
	esperarErro(t, baixar(c, c.kCarlos, arq.ID), 404, "naoEncontrado")
}

func TestArquivo_UsoUnico(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	arq := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	if r := enviarMensagemArquivo(c, c.kAna, conv, "u1", arq.ID); r.StatusCode != 201 {
		t.Fatalf("a primeira respondeu %d", r.StatusCode)
	}
	// O mesmo idLocal devolve a mesma mensagem (200) sem usar o arquivo de novo.
	if r := enviarMensagemArquivo(c, c.kAna, conv, "u1", arq.ID); r.StatusCode != 200 {
		t.Fatalf("a repetida respondeu %d", r.StatusCode)
	}
	e := esperarErro(t, enviarMensagemArquivo(c, c.kAna, conv, "u2", arq.ID), 400, "invalido")
	if e.Campo != "arquivo" {
		t.Fatalf("campo = %q", e.Campo)
	}
	// O arquivo de outra pessoa também não vale.
	deBia := c.a.Enviar(c.kBia, "b.pdf", "application/pdf", []byte("y"))
	e = esperarErro(t, enviarMensagemArquivo(c, c.kAna, conv, "u3", deBia.ID), 400, "invalido")
	if e.Campo != "arquivo" {
		t.Fatalf("campo = %q", e.Campo)
	}
	// Um id que não existe, e um que não tem o formato de um id.
	for i, id := range []string{strings.Repeat("0", 32), "xyz", "../../x"} {
		e = esperarErro(t, enviarMensagemArquivo(c, c.kAna, conv, fmt.Sprintf("u4%d", i), id), 400, "invalido")
		if e.Campo != "arquivo" {
			t.Fatalf("%q: campo = %q", id, e.Campo)
		}
	}
	// Texto e arquivo juntos, ou nenhum dos dois.
	nenhum := map[string]any{"idLocal": "u5"}
	esperarErro(t, c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv), nenhum), 400, "invalido")
	ambos := map[string]any{"idLocal": "u6", "texto": "oi", "arquivo": arq.ID}
	esperarErro(t, c.a.Pedir(c.kAna, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conv), ambos), 400, "invalido")
	// Outra empresa não usa o arquivo da ACME, nem o encontra.
	esperarErro(t, enviarMensagemArquivo(c, c.kAbel, conv, "u7", arq.ID), 404, "naoEncontrado")
	if p := c.pagina(t, c.kAna, conv, ""); len(p.Mensagens) != 1 || p.Mensagens[0].Arquivo == nil || p.Mensagens[0].Arquivo.ID != arq.ID {
		t.Fatalf("a conversa tem outras mensagens além da primeira: %+v", p.Mensagens)
	}
}

func TestArquivo_NaoGastaLimiteDeMensagens(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	arq := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	enviarMensagemArquivo(c, c.kAna, conv, "l1", arq.ID)
	// 100 envios recusados do mesmo arquivo não podem gastar os 60 por minuto.
	for i := 0; i < 100; i++ {
		enviarMensagemArquivo(c, c.kAna, conv, fmt.Sprintf("l-%d", i), arq.ID)
	}
	if r := c.enviar(c.kAna, conv, "texto-1", "oi"); r.StatusCode != 201 {
		t.Fatalf("o texto depois respondeu %d", r.StatusCode)
	}
}

func miniatura(c *cena, chave, id string, corpo any) *http.Response {
	return c.a.Pedir(chave, "PUT", "/api/v1/arquivos/"+id+"/miniatura", corpo)
}

func TestMiniatura(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	png := c.a.Enviar(c.kAna, "foto.png", "image/png", []byte("\x89PNG...."))
	pdf := c.a.Enviar(c.kAna, "a.pdf", "application/pdf", []byte("x"))
	jpeg := []byte(cabecalhoJPEG + "JFIF-pequeno")

	// Antes de ter, a miniatura não existe (nem para quem a pode ver).
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil), 404, "naoEncontrado")

	if r := miniatura(c, c.kAna, png.ID, jpeg); r.StatusCode != 204 {
		t.Fatalf("PUT respondeu %d", r.StatusCode)
	}
	enviarMensagemArquivo(c, c.kAna, conv, "m1", png.ID)

	// Baixar a miniatura: a autora e a Beatriz; o Carlos não.
	for _, k := range []string{c.kAna, c.kBia} {
		r := c.a.Pedir(k, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil)
		if r.StatusCode != 200 {
			t.Fatalf("GET miniatura respondeu %d", r.StatusCode)
		}
		got, _ := io.ReadAll(r.Body)
		if !bytes.Equal(got, jpeg) || r.Header.Get("Content-Type") != "image/jpeg" ||
			r.Header.Get("X-Content-Type-Options") != "nosniff" || r.Header.Get("Cache-Control") != "private, max-age=86400" {
			t.Fatalf("miniatura: %q %v", got, r.Header)
		}
	}
	esperarErro(t, c.a.Pedir(c.kCarlos, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil), 404, "naoEncontrado")
	esperarErro(t, c.a.Pedir(c.kAbel, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil), 404, "naoEncontrado")

	// O Arquivo agora diz miniatura: true, na mensagem.
	if m := c.pagina(t, c.kBia, conv, "").Mensagens[0]; m.Arquivo == nil || !m.Arquivo.Miniatura {
		t.Fatalf("mensagem = %+v", m)
	}

	// Mandar de novo substitui.
	outra := []byte(cabecalhoJPEG + "segunda")
	if r := miniatura(c, c.kAna, png.ID, outra); r.StatusCode != 204 {
		t.Fatalf("PUT de novo respondeu %d", r.StatusCode)
	}
	r := c.a.Pedir(c.kBia, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil)
	if got, _ := io.ReadAll(r.Body); !bytes.Equal(got, outra) {
		t.Fatalf("a miniatura não foi substituída: %q", got)
	}

	// Num PDF não vale.
	if e := esperarErro(t, miniatura(c, c.kAna, pdf.ID, jpeg), 400, "invalido"); e.Campo != "miniatura" {
		t.Fatalf("PDF: campo = %q", e.Campo)
	}
	// A Beatriz não é a autora: 404, mesmo vendo o arquivo.
	esperarErro(t, miniatura(c, c.kBia, png.ID, jpeg), 404, "naoEncontrado")
	// Outra empresa também.
	esperarErro(t, miniatura(c, c.kAbel, png.ID, jpeg), 404, "naoEncontrado")
	// 204.801 bytes: grande. Exatamente 204.800: vale.
	grande := append([]byte(cabecalhoJPEG), make([]byte, maxMiniaturaTeste+1-len(cabecalhoJPEG))...)
	esperarErro(t, miniatura(c, c.kAna, png.ID, grande), 413, "grande")
	limite := append([]byte(cabecalhoJPEG), make([]byte, maxMiniaturaTeste-len(cabecalhoJPEG))...)
	if r := miniatura(c, c.kAna, png.ID, limite); r.StatusCode != 204 {
		t.Fatalf("204.800 bytes respondeu %d", r.StatusCode)
	}
	// 204.801 bytes sem Content-Length também.
	req, _ := http.NewRequestWithContext(t.Context(), "PUT", c.a.Servidor.URL+"/api/v1/arquivos/"+png.ID+"/miniatura", io.NopCloser(bytes.NewReader(grande)))
	req.Header.Set("Authorization", "Bearer "+c.kAna)
	resp, err := c.a.Servidor.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	esperarErro(t, resp, 413, "grande")
	// A que valia ficou no lugar.
	r = c.a.Pedir(c.kAna, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil)
	if got, _ := io.ReadAll(r.Body); len(got) != maxMiniaturaTeste {
		t.Fatalf("a miniatura tem %d bytes", len(got))
	}
}

func TestMiniatura_PrecisaSerJPEG(t *testing.T) {
	c := novaCena(t)
	png := c.a.Enviar(c.kAna, "foto.png", "image/png", []byte("x"))
	for nome, corpo := range map[string][]byte{
		"vazio":        {},
		"png":          []byte("\x89PNG\r\n\x1a\n"),
		"doisBytes":    {0xff, 0xd8},
		"quaseJPEG":    {0xff, 0xd8, 0xfe, 0x00},
		"textoComJPEG": []byte("x\xff\xd8\xff"),
	} {
		t.Run(nome, func(t *testing.T) {
			c := &cena{a: c.a.Com(t), kAna: c.kAna}
			r := miniatura(c, c.kAna, png.ID, corpo)
			if e := esperarErro(t, r, 400, "invalido"); e.Campo != "miniatura" {
				t.Fatalf("campo = %q", e.Campo)
			}
		})
	}
	// Nada ficou no disco nem no banco como miniatura.
	for _, f := range arquivosNoDisco(t, c.a) {
		if strings.HasSuffix(f, ".mini") || strings.Contains(filepath.Base(f), ".tmp-") {
			t.Fatalf("sobrou %s", f)
		}
	}
	// O arquivo dos PUTs recusados segue sem miniatura: nem a linha foi marcada, nem o GET acha.
	if n := c.a.Contar(`SELECT miniatura FROM arquivos WHERE id = ?`, png.ID); n != 0 {
		t.Fatalf("miniatura = %d na linha do arquivo; queria 0", n)
	}
	esperarErro(t, c.a.Pedir(c.kAna, "GET", "/api/v1/arquivos/"+png.ID+"/miniatura", nil), 404, "naoEncontrado")
}

func TestArquivo_LimiteHora(t *testing.T) {
	if testing.Short() {
		t.Skip("grava 200 MB")
	}
	c := novaCena(t)
	// Quatro envios com Content-Length e quatro sem: juntos são 8 x 25 MB = 209.715.200 bytes.
	for i := 0; i < 8; i++ {
		tam := int64(maxArquivoTeste)
		if i%2 == 1 {
			tam = -1
		}
		resp := enviarArquivo(c.a, c.kAna, "", "application/octet-stream", &zeros{maxArquivoTeste}, tam)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("o envio %d respondeu %d", i+1, resp.StatusCode)
		}
	}
	// O nono é recusado, com a espera. Com Content-Length e sem.
	e := esperarErro(t, enviarArquivo(c.a, c.kAna, "", "text/plain", strings.NewReader("1"), 1), 429, "limite")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 3600 {
		t.Fatalf("esperarSegundos = %d", e.EsperarSegundos)
	}
	esperarErro(t, enviarArquivo(c.a, c.kAna, "", "text/plain", strings.NewReader("1"), -1), 429, "limite")
	// Outro computador não é afetado.
	if r := enviarArquivo(c.a, c.kBia, "", "text/plain", strings.NewReader("1"), 1); r.StatusCode != 201 {
		t.Fatalf("outro computador respondeu %d", r.StatusCode)
	}
	// Uma hora depois, volta.
	c.a.Relogio.Avancar(time.Hour + time.Second)
	if r := enviarArquivo(c.a, c.kAna, "", "text/plain", strings.NewReader("1"), 1); r.StatusCode != 201 {
		t.Fatalf("uma hora depois respondeu %d", r.StatusCode)
	}
	// Só um arquivo de cada 25 MB que entrou deixou os bytes no disco.
	var total int64
	for _, f := range arquivosNoDisco(t, c.a) {
		fi, err := os.Stat(f)
		if err != nil {
			t.Fatal(err)
		}
		total += fi.Size()
	}
	if total != 8*maxArquivoTeste+2 {
		t.Fatalf("no disco: %d bytes", total)
	}
}

// esperarTemporario espera um .tmp-* aparecer na pasta dos arquivos: o servidor já está lendo
// o corpo e gravando.
func esperarTemporario(t *testing.T, a *apitest.Ambiente) {
	t.Helper()
	limite := time.Now().Add(5 * time.Second)
	for {
		for _, f := range arquivosNoDisco(t, a) {
			if strings.Contains(filepath.Base(f), ".tmp-") {
				return
			}
		}
		if time.Now().After(limite) {
			t.Fatal("o servidor não começou a guardar o envio")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// resultado é a resposta (ou o erro) de um pedido que roda em outra goroutine.
type resultado struct {
	resp *http.Response
	err  error
}

// pedirEmSegundoPlano faz o pedido com um corpo que o teste escreve aos poucos (um io.Pipe),
// sem Content-Length.
func pedirEmSegundoPlano(t *testing.T, a *apitest.Ambiente, chave, metodo, caminho, tipo string, corpo io.Reader) <-chan resultado {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), metodo, a.Servidor.URL+caminho, corpo)
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = -1
	req.Header.Set("Authorization", "Bearer "+chave)
	req.Header.Set("Content-Type", tipo)
	ch := make(chan resultado, 1)
	go func() {
		resp, err := a.Servidor.Client().Do(req)
		ch <- resultado{resp, err}
	}()
	return ch
}

func esperarResposta(t *testing.T, ch <-chan resultado) *http.Response {
	t.Helper()
	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatal(r.err)
		}
		t.Cleanup(func() { r.resp.Body.Close() })
		return r.resp
	case <-time.After(10 * time.Second):
		t.Fatal("o servidor não respondeu em 10 s")
		return nil
	}
}

// TestArquivo_CotaSemTamanho é o R15: um envio sem Content-Length reserva 25 MB antes de ler,
// então vários juntos não passam da cota da hora.
func TestArquivo_CotaSemTamanho(t *testing.T) {
	if testing.Short() {
		t.Skip("grava 200 MB")
	}
	c := novaCena(t)
	// Sete envios de 25 MB com Content-Length: sobram exatamente 25 MB na hora.
	for i := 0; i < 7; i++ {
		resp := enviarArquivo(c.a, c.kAna, "", "application/octet-stream", &zeros{maxArquivoTeste}, maxArquivoTeste)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("o envio %d respondeu %d", i+1, resp.StatusCode)
		}
	}
	// O envio 1, sem tamanho, fica aberto: já tem 25 MB reservados.
	pr, pw := io.Pipe()
	defer pw.CloseWithError(io.ErrClosedPipe)
	um := pedirEmSegundoPlano(t, c.a, c.kAna, "POST", "/api/v1/arquivos", "application/octet-stream", pr)
	if _, err := pw.Write(make([]byte, 16)); err != nil {
		t.Fatal(err)
	}
	esperarTemporario(t, c.a)
	// O envio 2, também sem tamanho, é recusado na hora, antes de ler.
	e := esperarErro(t, enviarArquivo(c.a, c.kAna, "", "application/octet-stream", strings.NewReader("x"), -1), 429, "limite")
	if e.EsperarSegundos < 1 || e.EsperarSegundos > 3600 {
		t.Fatalf("esperarSegundos = %d", e.EsperarSegundos)
	}
	// O envio 1 termina com 1 MiB: ficam gastos 1 MiB, e os outros 24 MiB voltam.
	if _, err := io.Copy(pw, &zeros{1<<20 - 16}); err != nil {
		t.Fatal(err)
	}
	pw.Close()
	resp := esperarResposta(t, um)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("o envio 1 respondeu %d", resp.StatusCode)
	}
	if a := apitest.LerJSON[struct{ Arquivo apitest.Arquivo }](t, resp).Arquivo; a.Tamanho != 1<<20 {
		t.Fatalf("tamanho = %d", a.Tamanho)
	}
	// Agora cabem 25.000.000 bytes com Content-Length.
	resp = enviarArquivo(c.a, c.kAna, "", "application/octet-stream", &zeros{25000000}, 25000000)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("o de 25.000.000 bytes respondeu %d", resp.StatusCode)
	}
}

// tcpCru manda o pedido por uma conexão TCP crua e devolve a resposta, já lida.
func tcpCru(t *testing.T, a *apitest.Ambiente, pedido string) *http.Response {
	t.Helper()
	conn, err := net.Dial("tcp", a.Servidor.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write([]byte(pedido)); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("ler a resposta: %v", err)
	}
	corpo, _ := io.ReadAll(resp.Body)
	resp.Body = io.NopCloser(bytes.NewReader(corpo))
	return resp
}

// TestArquivo_CorpoIlegivel é o R17: um corpo que não dá para ler (aqui, o tamanho de um
// pedaço do chunked encoding é inválido) é 400 invalido com o campo do corpo.
func TestArquivo_CorpoIlegivel(t *testing.T) {
	c := novaCena(t)
	t.Run("envio", func(t *testing.T) {
		resp := tcpCru(t, c.a, "POST /api/v1/arquivos HTTP/1.1\r\nHost: chat\r\nAuthorization: Bearer "+c.kAna+"\r\n"+
			"Content-Type: application/pdf\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\nZZ\r\n")
		if e := esperarErro(t, resp, 400, "invalido"); e.Campo != "arquivo" {
			t.Fatalf("campo = %q", e.Campo)
		}
		if l := arquivosNoDisco(t, c.a); len(l) != 0 {
			t.Fatalf("sobrou no disco: %v", l)
		}
	})
	t.Run("miniatura", func(t *testing.T) {
		png := c.a.Enviar(c.kAna, "foto.png", "image/png", []byte("x"))
		resp := tcpCru(t, c.a, "PUT /api/v1/arquivos/"+png.ID+"/miniatura HTTP/1.1\r\nHost: chat\r\nAuthorization: Bearer "+c.kAna+"\r\n"+
			"Transfer-Encoding: chunked\r\n\r\n4\r\n"+cabecalhoJPEG+"\r\nZZ\r\n")
		if e := esperarErro(t, resp, 400, "invalido"); e.Campo != "miniatura" {
			t.Fatalf("campo = %q", e.Campo)
		}
	})
}

// TestArquivo_FalhaDoInsert: a linha falha depois do rename. Não sobra arquivo, temporário nem
// linha, e a cota que o envio reservou volta.
func TestArquivo_FalhaDoInsert(t *testing.T) {
	c := novaCena(t)
	c.a.Exec(`CREATE TRIGGER falha BEFORE INSERT ON arquivos BEGIN SELECT RAISE(ABORT,'teste'); END`)
	// Um envio sem tamanho reserva 25 MB. Nove deles passariam dos 200 MB da hora se algum
	// não devolvesse a reserva: o nono daria 429 em vez de 500.
	for i := 0; i < 9; i++ {
		esperarErro(t, enviarArquivo(c.a, c.kAna, "", "application/pdf", strings.NewReader("x"), -1), 500, "servidor")
		if l := arquivosNoDisco(t, c.a); len(l) != 0 {
			t.Fatalf("envio %d: sobrou no disco %v", i+1, l)
		}
	}
	if n := linhasDeArquivos(t, c); n != 0 {
		t.Fatalf("arquivos no banco = %d", n)
	}
	c.a.Exec(`DROP TRIGGER falha`)
	if r := enviarArquivo(c.a, c.kAna, "", "application/pdf", strings.NewReader("x"), -1); r.StatusCode != http.StatusCreated {
		t.Fatalf("depois de tirar o gatilho respondeu %d", r.StatusCode)
	}
}

// TestMiniatura_ExpiraDuranteOEnvio: o arquivo expira enquanto o servidor lê o corpo da
// miniatura. Responde 410 e não deixa miniatura no disco, nem a nova nem a que ela trocou.
func TestMiniatura_ExpiraDuranteOEnvio(t *testing.T) {
	for _, substituicao := range []bool{false, true} {
		nome := "primeira"
		if substituicao {
			nome = "substituicao"
		}
		t.Run(nome, func(t *testing.T) {
			c := novaCena(t)
			png := c.a.Enviar(c.kAna, "foto.png", "image/png", []byte("x"))
			if substituicao {
				if r := miniatura(c, c.kAna, png.ID, []byte(cabecalhoJPEG+"antiga")); r.StatusCode != 204 {
					t.Fatalf("a primeira miniatura respondeu %d", r.StatusCode)
				}
			}
			pr, pw := io.Pipe()
			defer pw.CloseWithError(io.ErrClosedPipe)
			ch := pedirEmSegundoPlano(t, c.a, c.kAna, "PUT", "/api/v1/arquivos/"+png.ID+"/miniatura", "image/jpeg", pr)
			if _, err := pw.Write([]byte(cabecalhoJPEG)); err != nil {
				t.Fatal(err)
			}
			esperarTemporario(t, c.a) // o servidor está lendo o corpo
			c.a.Exec(`UPDATE arquivos SET expirado_em = ?`, time.Now().UnixMilli())
			if _, err := pw.Write([]byte("resto")); err != nil {
				t.Fatal(err)
			}
			pw.Close()
			esperarErro(t, esperarResposta(t, ch), 410, "expirado")
			for _, f := range arquivosNoDisco(t, c.a) {
				if strings.HasSuffix(f, ".mini") || strings.Contains(filepath.Base(f), ".tmp-") {
					t.Fatalf("sobrou %s", f)
				}
			}
		})
	}
}

// baixarComRange baixa o arquivo com o cabeçalho Range.
func baixarComRange(c *cena, chave, id, intervalo string) *http.Response {
	c.a.T.Helper()
	req, err := http.NewRequestWithContext(c.a.T.Context(), "GET", c.a.Servidor.URL+"/api/v1/arquivos/"+id, nil)
	if err != nil {
		c.a.T.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+chave)
	req.Header.Set("Range", intervalo)
	resp, err := c.a.Servidor.Client().Do(req)
	if err != nil {
		c.a.T.Fatal(err)
	}
	c.a.T.Cleanup(func() { resp.Body.Close() })
	return resp
}

func cabecalhosDoDownload(t *testing.T, h http.Header, nome string) {
	t.Helper()
	cd := `attachment; filename="` + nome + `"; filename*=UTF-8''` + nome
	if h.Get("Content-Type") != "application/octet-stream" || h.Get("Content-Disposition") != cd ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cabeçalhos = %v", h)
	}
}

func TestArquivo_Range(t *testing.T) {
	c := novaCena(t)
	conv := c.duplaAnaBia(t)
	arq := c.a.Enviar(c.kAna, "dados.bin", "application/pdf", []byte("0123456789"))
	enviarMensagemArquivo(c, c.kAna, conv, "r1", arq.ID)

	// Vários intervalos: a resposta multipart trocaria o Content-Type, então vem o arquivo inteiro.
	resp := baixarComRange(c, c.kBia, arq.ID, "bytes=0-1,3-4")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("vários intervalos respondeu %d; queria 200", resp.StatusCode)
	}
	if got, _ := io.ReadAll(resp.Body); string(got) != "0123456789" {
		t.Fatalf("corpo = %q; queria o arquivo inteiro", got)
	}
	cabecalhosDoDownload(t, resp.Header, "dados.bin")

	// Um intervalo só: 206 com os dois bytes e os mesmos cabeçalhos.
	resp = baixarComRange(c, c.kBia, arq.ID, "bytes=0-1")
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("um intervalo respondeu %d; queria 206", resp.StatusCode)
	}
	if got, _ := io.ReadAll(resp.Body); string(got) != "01" {
		t.Fatalf("corpo = %q; queria 01", got)
	}
	cabecalhosDoDownload(t, resp.Header, "dados.bin")
}

// TestArquivo_OutraEmpresa: o id de um arquivo da ACME não vale para a outra empresa, nem
// numa mensagem dela nem no download.
func TestArquivo_OutraEmpresa(t *testing.T) {
	a := apitest.Novo(t)
	acme := a.Empresa("ACME Comércio Ltda")
	outra := a.Empresa("Outra Ltda")
	kAna := a.Ligar(acme.Codigo, "PC-ANA")
	a.Entrar(kAna, "2003", "Ana Souza")
	kAbel := a.Ligar(outra.Codigo, "PC-ABEL")
	kBruno := a.Ligar(outra.Codigo, "PC-BRUNO")
	a.Entrar(kAbel, "2003", "Abel")
	bruno := a.Entrar(kBruno, "2004", "Bruno")
	c := &cena{a: a, kAna: kAna, kAbel: kAbel}
	arq := a.Enviar(kAna, "Proposta ACME.pdf", "application/pdf", []byte("segredo da ACME"))

	resp := c.dupla(t, kAbel, bruno.ID)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("criar a dupla da outra empresa respondeu %d", resp.StatusCode)
	}
	conv := apitest.LerJSON[struct{ Conversa conversaResp }](t, resp).Conversa.ID

	e := esperarErro(t, enviarMensagemArquivo(c, kAbel, conv, "o1", arq.ID), 400, "invalido")
	if e.Campo != "arquivo" {
		t.Fatalf("campo = %q", e.Campo)
	}
	esperarErro(t, baixar(c, kAbel, arq.ID), 404, "naoEncontrado")
	if p := c.pagina(t, kAbel, conv, ""); len(p.Mensagens) != 0 {
		t.Fatalf("a conversa da outra empresa tem %d mensagens", len(p.Mensagens))
	}
}
