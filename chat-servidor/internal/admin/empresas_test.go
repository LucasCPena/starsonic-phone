package admin_test

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/apitest"
)

var reCodigo = regexp.MustCompile(`STAR-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}`)

func enviarArquivo(t *testing.T, a *apitest.Ambiente, chave string, conversa int64, idLocal, arquivo string) {
	t.Helper()
	esperarAPI(t, a.Pedir(chave, "POST", fmt.Sprintf("/api/v1/conversas/%d/mensagens", conversa),
		map[string]string{"idLocal": idLocal, "arquivo": arquivo}), http.StatusCreated)
}

func TestNovaEmpresa(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	resp, corpo := n.get("/admin/empresas/nova")
	esperarStatus(t, resp, corpo, http.StatusOK)
	if !strings.Contains(corpo, `name="nome"`) || !strings.Contains(corpo, `action="/admin/empresas"`) {
		t.Fatalf("a página nova:\n%s", corpo)
	}

	resp, _ = n.acao("/admin/empresas", url.Values{"nome": {"  ACME Comércio Ltda  "}})
	m := regexp.MustCompile(`^/admin/empresas/(\d+)$`).FindStringSubmatch(resp.Header.Get("Location"))
	if resp.StatusCode != http.StatusSeeOther || m == nil {
		t.Fatalf("criar = %d, %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	pagina := m[0]
	resp, corpo = n.get(pagina)
	esperarStatus(t, resp, corpo, http.StatusOK)
	codigo := reCodigo.FindString(corpo)
	if !strings.Contains(corpo, "<h1 class=\"titulo\">ACME Comércio Ltda</h1>") || codigo == "" {
		t.Fatalf("a página da empresa nova:\n%s", corpo)
	}
	// O código liga um computador pela API, na empresa nova.
	k := p.a.Ligar(codigo, "RECEPCAO-01")
	p.a.Entrar(k, "2001", "Recepção")
	if c := p.a.Contar(`SELECT COUNT(*) FROM computadores WHERE nome = 'RECEPCAO-01' AND empresa_id = ?`, m[1]); c != 1 {
		t.Fatal("o computador não ficou na empresa nova")
	}
	// A lista mostra a empresa, com o link, mas não o código: ele fica só na página dela.
	_, corpo = n.get("/admin/")
	if !strings.Contains(corpo, "ACME Comércio Ltda") || !strings.Contains(corpo, `href="`+pagina+`"`) {
		t.Fatalf("a lista não mostra a empresa:\n%s", corpo)
	}
	if strings.Contains(corpo, codigo) {
		t.Fatal("a lista mostra o código da empresa")
	}

	// Um nome vazio, ou de mais de 80 caracteres, volta com o erro, sem criar nada.
	for _, nome := range []string{"   ", strings.Repeat("a", 81)} {
		resp, corpo := n.acao("/admin/empresas", url.Values{"nome": {nome}})
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		if !strings.Contains(corpo, "Escreva o nome da empresa") {
			t.Fatalf("nome %q:\n%s", nome, corpo)
		}
	}
	if c := p.a.Contar(`SELECT COUNT(*) FROM empresas`); c != 1 {
		t.Fatalf("%d empresas; queria 1", c)
	}
}

func TestTrocarCodigo(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	k := p.a.Ligar(e.Codigo, "RECEPCAO-01")
	p.a.Entrar(k, "2001", "Recepção")
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)

	resp, _ := n.acao(pagina+"/codigo", nil)
	esperarIr(t, resp, pagina)
	_, corpo := n.get(pagina)
	novo := reCodigo.FindString(corpo)
	if novo == "" || novo == e.Codigo || strings.Contains(corpo, e.Codigo) {
		t.Fatalf("o código era %s e a página mostra %q", e.Codigo, novo)
	}
	// O código antigo responde 404 codigo na API.
	esperarErroAPI(t, p.a.Pedir("", "POST", "/api/v1/computadores",
		map[string]string{"codigo": e.Codigo, "computador": "PC-2"}), http.StatusNotFound, "codigo")
	// O computador já ligado continua; o código novo liga outro; a outra empresa não mudou.
	esperarAPI(t, p.a.Pedir(k, "GET", "/api/v1/conversas", nil), http.StatusOK)
	p.a.Ligar(novo, "PC-3")
	p.a.Ligar(outra.Codigo, "PC-OUTRA")

	resp, corpo = n.acao("/admin/empresas/9999/codigo", nil)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
}

// linhas conta as linhas de cada tabela que são da empresa.
func linhas(p *painel, empresaID int64) map[string]int {
	n := map[string]int{}
	for tabela, q := range map[string]string{
		"empresas":           `SELECT COUNT(*) FROM empresas WHERE id = ?`,
		"pessoas":            `SELECT COUNT(*) FROM pessoas WHERE empresa_id = ?`,
		"computadores":       `SELECT COUNT(*) FROM computadores WHERE empresa_id = ?`,
		"computador_pessoas": `SELECT COUNT(*) FROM computador_pessoas x JOIN computadores c ON c.id = x.computador_id WHERE c.empresa_id = ?`,
		"conversas":          `SELECT COUNT(*) FROM conversas WHERE empresa_id = ?`,
		"membros":            `SELECT COUNT(*) FROM membros x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"mensagens":          `SELECT COUNT(*) FROM mensagens x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
		"arquivos":           `SELECT COUNT(*) FROM arquivos WHERE empresa_id = ?`,
		"leituras":           `SELECT COUNT(*) FROM leituras x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
	} {
		n[tabela] = p.a.Contar(q, empresaID)
	}
	return n
}

// total conta as linhas de cada tabela, de todas as empresas.
func total(p *painel) map[string]int {
	n := map[string]int{}
	for _, tabela := range []string{"empresas", "pessoas", "computadores", "computador_pessoas", "conversas", "membros",
		"mensagens", "arquivos", "leituras"} {
		n[tabela] = p.a.Contar(`SELECT COUNT(*) FROM ` + tabela)
	}
	return n
}

// noDisco diz se o arquivo e a miniatura dele estão no disco.
func noDisco(t *testing.T, p *painel, id string) (arquivo, miniatura bool) {
	t.Helper()
	existe := func(f *os.File, err error) bool {
		if err == nil {
			f.Close()
			return true
		}
		if !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
		return false
	}
	return existe(p.a.Armazem.Abrir(id)), existe(p.a.Armazem.AbrirMiniatura(id))
}

func TestApagarEmpresa(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	acme := p.a.Empresa("ACME Comércio Ltda")
	outra := p.a.Empresa("Outra Ltda")
	kAna, kBia := p.a.Ligar(acme.Codigo, "NOTE-ANA"), p.a.Ligar(acme.Codigo, "FIN-01")
	kAbel := p.a.Ligar(outra.Codigo, "PC-ABEL")
	p.a.Entrar(kAna, "2003", "Ana Souza")
	bia := p.a.Entrar(kBia, "3004", "Beatriz Ramos")
	p.a.Entrar(kAbel, "2003", "Abel")
	// Na ACME, uma conversa com texto e uma foto com miniatura, e um grupo; na outra, um
	// arquivo numa mensagem.
	dupla := criarConversa(t, p.a, kAna, map[string]any{"tipo": "dupla", "com": bia.ID})
	criarConversa(t, p.a, kAna, map[string]any{"tipo": "grupo", "nome": "Comercial", "pessoas": []int64{bia.ID}})
	enviarTexto(t, p.a, kAna, dupla, "m-1", "Bom dia")
	foto := p.a.Enviar(kAna, "foto.jpg", "image/jpeg", []byte("\xff\xd8\xff\xe0 uma foto de teste"))
	esperarAPI(t, p.a.Pedir(kAna, "PUT", "/api/v1/arquivos/"+foto.ID+"/miniatura", "\xff\xd8\xff\xe0 miniatura"), http.StatusNoContent)
	enviarArquivo(t, p.a, kAna, dupla, "m-2", foto.ID)
	esperarAPI(t, p.a.Pedir(kBia, "POST", fmt.Sprintf("/api/v1/conversas/%d/lida", dupla), map[string]int64{"ate": 1 << 40}),
		http.StatusNoContent)
	bruna := p.a.Entrar(p.a.Ligar(outra.Codigo, "PC-BRUNA"), "2004", "Bruna")
	doAbel := p.a.Enviar(kAbel, "proposta.pdf", "application/pdf", []byte("%PDF-1.4 de teste"))
	duplaOutra := criarConversa(t, p.a, kAbel, map[string]any{"tipo": "dupla", "com": bruna.ID})
	enviarArquivo(t, p.a, kAbel, duplaOutra, "o-1", doAbel.ID)
	cAna := p.a.Conectar(kAna)
	daOutra := linhas(p, outra.ID)
	for tabela, c := range linhas(p, acme.ID) {
		if c == 0 {
			t.Fatalf("a cena não pôs nada da ACME em %s", tabela)
		}
	}

	pagina := fmt.Sprintf("/admin/empresas/%d", acme.ID)
	resp, corpo := n.get(pagina + "/apagar")
	esperarStatus(t, resp, corpo, http.StatusOK)
	if !strings.Contains(corpo, `name="nome"`) || !strings.Contains(corpo, "ACME Comércio Ltda") {
		t.Fatalf("a página de apagar:\n%s", corpo)
	}
	// Com o nome errado, nada muda.
	antes := total(p)
	for _, nome := range []string{"", "ACME", "acme comércio ltda", "Outra Ltda"} {
		resp, corpo := n.acao(pagina+"/apagar", url.Values{"nome": {nome}})
		esperarStatus(t, resp, corpo, http.StatusBadRequest)
		if !strings.Contains(corpo, "O nome não confere.") {
			t.Fatalf("nome %q:\n%s", nome, corpo)
		}
	}
	if got := total(p); !maps.Equal(got, antes) {
		t.Fatalf("o nome errado mudou o banco: %v; era %v", got, antes)
	}
	if arq, mini := noDisco(t, p, foto.ID); !arq || !mini {
		t.Fatal("o nome errado tirou a foto do disco")
	}
	esperarAPI(t, p.a.Pedir(kAna, "GET", "/api/v1/conversas", nil), http.StatusOK)

	// Com o nome certo, tudo da ACME sai, no banco e no disco, e os computadores dela saem.
	resp, _ = n.acao(pagina+"/apagar", url.Values{"nome": {" ACME Comércio Ltda "}})
	esperarIr(t, resp, "/admin/")
	if got := total(p); !maps.Equal(got, daOutra) {
		t.Fatalf("depois de apagar = %v; queria só as linhas da outra empresa, %v", got, daOutra)
	}
	if arq, mini := noDisco(t, p, foto.ID); arq || mini {
		t.Fatalf("a foto ficou no disco: arquivo %v, miniatura %v", arq, mini)
	}
	esperarFora(t, cAna)
	for _, k := range []string{kAna, kBia} {
		esperarErroAPI(t, p.a.Pedir(k, "GET", "/api/v1/conversas", nil), http.StatusUnauthorized, "chave")
	}
	// A outra empresa continua intacta, também no disco.
	if got := linhas(p, outra.ID); !maps.Equal(got, daOutra) {
		t.Fatalf("a outra empresa mudou: %v; era %v", got, daOutra)
	}
	if arq, _ := noDisco(t, p, doAbel.ID); !arq {
		t.Fatal("o arquivo da outra empresa saiu do disco")
	}
	esperarAPI(t, p.a.Pedir(kAbel, "GET", "/api/v1/arquivos/"+doAbel.ID, nil), http.StatusOK)

	resp, corpo = n.get(pagina)
	esperarStatus(t, resp, corpo, http.StatusNotFound)
	if _, corpo := n.get("/admin/"); strings.Contains(corpo, "ACME Comércio Ltda") || !strings.Contains(corpo, "Outra Ltda") {
		t.Fatalf("a lista depois de apagar:\n%s", corpo)
	}
}

// TestApagarEmpresa_BilheteVelho é o R27 pela API e pela página: o bilhete que um computador
// da empresa apagada pediu antes não abre o WebSocket de um computador novo da outra empresa.
// Sem o AUTOINCREMENT, o computador novo ganharia o id do apagado, e o bilhete abriria o dele.
func TestApagarEmpresa_BilheteVelho(t *testing.T) {
	p := novoPainel(t)
	n := p.logado(t)
	outra := p.a.Empresa("Outra Ltda")
	acme := p.a.Empresa("ACME Comércio Ltda")
	kAbel := p.a.Ligar(outra.Codigo, "PC-ABEL")
	p.a.Entrar(kAbel, "2003", "Abel")
	p.a.Conectar(kAbel)
	// O computador X da ACME, ligado depois, tem o maior id.
	kX := p.a.Ligar(acme.Codigo, "NOTE-ANA")
	p.a.Entrar(kX, "2003", "Ana Souza")
	cX := p.a.Conectar(kX)
	x := idDoComputador(p, "NOTE-ANA")
	if maior := int64(p.a.Contar(`SELECT MAX(id) FROM computadores`)); x != maior {
		t.Fatalf("o X tem o id %d; o maior é %d", x, maior)
	}
	bilhete := p.a.Bilhete(kX) // pedido antes de a empresa sair

	resp, _ := n.acao(fmt.Sprintf("/admin/empresas/%d/apagar", acme.ID), url.Values{"nome": {"ACME Comércio Ltda"}})
	esperarIr(t, resp, "/admin/")
	esperarFora(t, cX)
	// Um computador novo liga na outra empresa.
	p.a.Entrar(p.a.Ligar(outra.Codigo, "PC-BRUNA"), "2004", "Bruna")
	if novo := idDoComputador(p, "PC-BRUNA"); novo <= x {
		t.Errorf("o computador novo da outra empresa ganhou o id %d; o do apagado era %d", novo, x)
	}
	// O bilhete do X responde 401 chave, e nenhum WebSocket abre.
	conn, resp, err := p.a.Discar(bilhete, "")
	if err == nil || conn != nil {
		t.Fatal("o bilhete do computador apagado abriu o WebSocket de um computador da outra empresa")
	}
	esperarErroAPI(t, resp, http.StatusUnauthorized, "chave")
}

func TestSemConversas(t *testing.T) {
	p := novoPainel(t)
	e := p.a.Empresa("ACME Comércio Ltda")
	kAna, kBia := p.a.Ligar(e.Codigo, "NOTE-ANA"), p.a.Ligar(e.Codigo, "FIN-01")
	ana := p.a.Entrar(kAna, "2003", "Ana Souza")
	bia := p.a.Entrar(kBia, "3004", "Beatriz Ramos")
	dupla := criarConversa(t, p.a, kAna, map[string]any{"tipo": "dupla", "com": bia.ID})
	enviarTexto(t, p.a, kAna, dupla, "m-1", "segredo-123")
	arq := p.a.Enviar(kAna, "segredo-123.pdf", "application/pdf", []byte("%PDF-1.4 de teste"))
	enviarArquivo(t, p.a, kAna, dupla, "m-2", arq.ID)
	criarConversa(t, p.a, kBia, map[string]any{"tipo": "grupo", "nome": "segredo-123", "pessoas": []int64{ana.ID}})

	n := p.logado(t)
	pagina := fmt.Sprintf("/admin/empresas/%d", e.ID)
	for _, c := range []string{"/admin/", "/admin/empresas/nova", pagina, pagina + "/apagar"} {
		resp, corpo := n.get(c)
		esperarStatus(t, resp, corpo, http.StatusOK)
		if strings.Contains(corpo, "segredo-123") {
			t.Fatalf("GET %s mostra a conversa:\n%s", c, corpo)
		}
		if c == pagina && (!strings.Contains(corpo, "Ana Souza") || !strings.Contains(corpo, "Beatriz Ramos")) {
			t.Fatalf("a página da empresa não mostra as pessoas:\n%s", corpo)
		}
	}
	if _, corpo := p.navegador(t).get("/admin/entrar"); strings.Contains(corpo, "segredo-123") {
		t.Fatal("a entrada mostra a conversa")
	}
}

func TestListaDeEmpresas(t *testing.T) {
	p := novoPainel(t)
	acme := p.a.Empresa("ACME Comércio Ltda")
	p.a.Empresa("Clínica Vida")
	k := p.a.Ligar(acme.Codigo, "NOTE-ANA")
	p.a.Entrar(k, "2003", "Ana Souza")
	p.a.Entrar(p.a.Ligar(acme.Codigo, "FIN-01"), "3004", "Beatriz Ramos")
	p.a.Enviar(k, "proposta.pdf", "application/pdf", make([]byte, 1536)) // 1,5 KB
	_, corpo := p.logado(t).get("/admin/")
	// Os totais e as linhas, com o espaço em português.
	for _, s := range []string{">2</", "empresas no chat", "pessoas no chat", "1,5 KB", "de arquivos guardados",
		"Clínica Vida", "0 B", "Nova empresa", `href="/admin/empresas/nova"`,
		"Os arquivos ficam 1 ano no servidor."} {
		if !strings.Contains(corpo, s) {
			t.Fatalf("a lista não tem %q:\n%s", s, corpo)
		}
	}
	// A ACME vem antes da Clínica: em ordem de nome.
	if strings.Index(corpo, "ACME Comércio Ltda") > strings.Index(corpo, "Clínica Vida") {
		t.Fatal("a lista não está em ordem de nome")
	}
}
