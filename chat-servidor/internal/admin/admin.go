// Package admin é a página de administração do chat, só da Starsonic, em /admin/ (seção 4.3
// da spec): entrar com usuário e senha, as empresas, o código de entrada, as pessoas e os
// computadores, e apagar uma empresa. A página nunca mostra as conversas.
//
// É HTML feito no servidor (html/template), com as páginas e os estáticos embutidos. Nada é
// inline: a CSP default-src 'self' vale para tudo, e o único script, o "Copiar o código", é um
// arquivo. Toda resposta leva Cache-Control: no-store, porque a página da empresa mostra o
// código, que é segredo.
package admin

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

//go:embed paginas/*.html
var paginasFS embed.FS

//go:embed estatico/*
var estaticosFS embed.FS

// Os tipos dos estáticos, sem depender da tabela de tipos do sistema.
var tiposEstaticos = map[string]string{
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".woff2": "font/woff2",
	".png":   "image/png",
	".txt":   "text/plain; charset=utf-8",
}

// Os textos das mensagens da página.
const (
	textoSenhaErrada = "Usuário ou senha incorretos."
	textoTrava       = "Muitas tentativas. Tente de novo daqui a 15 minutos."
	textoNomeEmpresa = "Escreva o nome da empresa, com até 80 caracteres."
	textoNomeErrado  = "O nome não confere. Digite o nome da empresa exatamente como ele aparece acima."
)

// Deps é o que a página usa: o mesmo banco, o mesmo hub e o mesmo armazém da API. O Fora
// daqui só alcança os WebSockets do hub da API, e os eventos dos grupos saem pelo avisador da
// API, feito com o mesmo banco e o mesmo hub.
type Deps struct {
	Banco   *banco.Banco
	Hub     *eventos.Hub
	Armazem *armazem.Armazem
	Teste   bool // o modo de teste é HTTP: os cookies vão sem o Secure
}

type painel struct {
	banco   *banco.Banco
	hub     *eventos.Hub
	armazem *armazem.Armazem
	avisos  *api.Avisador
	teste   bool
	telas   map[string]*template.Template
}

// Novo monta a página. O manipulador responde a tudo em /admin/.
func Novo(d Deps) http.Handler {
	if d.Banco == nil {
		panic("admin.Novo: Deps.Banco é obrigatório")
	}
	if d.Hub == nil {
		panic("admin.Novo: Deps.Hub é obrigatório, e tem de ser o mesmo da API")
	}
	if d.Armazem == nil {
		panic("admin.Novo: Deps.Armazem é obrigatório")
	}
	p := &painel{banco: d.Banco, hub: d.Hub, armazem: d.Armazem, avisos: api.NovoAvisador(d.Banco, d.Hub),
		teste: d.Teste, telas: map[string]*template.Template{}}
	for _, nome := range []string{"entrar", "empresas", "nova", "empresa", "apagar", "erro"} {
		p.telas[nome] = template.Must(template.ParseFS(paginasFS, "paginas/base.html", "paginas/"+nome+".html"))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/entrar", p.paginaEntrar)
	mux.HandleFunc("POST /admin/entrar", p.entrar)
	mux.HandleFunc("POST /admin/sair", p.comSessao(p.sair))
	mux.HandleFunc("GET /admin/{$}", p.comSessao(p.empresas))
	mux.HandleFunc("GET /admin/empresas/nova", p.comSessao(p.paginaNova))
	mux.HandleFunc("POST /admin/empresas", p.comSessao(p.criarEmpresa))
	mux.HandleFunc("GET /admin/empresas/{id}", p.comSessao(p.empresa))
	mux.HandleFunc("POST /admin/empresas/{id}/codigo", p.comSessao(p.trocarCodigo))
	mux.HandleFunc("POST /admin/empresas/{id}/pessoas/{pid}/tirar", p.comSessao(p.tirarPessoa))
	mux.HandleFunc("POST /admin/empresas/{id}/computadores/{cid}/tirar", p.comSessao(p.tirarComputador))
	mux.HandleFunc("GET /admin/empresas/{id}/apagar", p.comSessao(p.paginaApagar))
	mux.HandleFunc("POST /admin/empresas/{id}/apagar", p.comSessao(p.apagarEmpresa))
	mux.HandleFunc("GET /admin/estatico/{arquivo}", p.estatico) // sem sessão: a entrada usa
	// O resto: sem sessão, a entrada; com ela, "não encontrada". Assim, quem não entrou não
	// descobre nem que rotas existem.
	mux.HandleFunc("/admin/", p.comSessao(p.naoEncontrada))
	return cabecalhos(mux)
}

// cabecalhos põe em toda resposta da página, também nos redirecionamentos e nos erros, a CSP
// e os cabeçalhos que a guardam: sem moldura de outro site, sem Referer e sem cache.
func cabecalhos(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// tela é o que toda página recebe: o título, o usuário e o CSRF da sessão (na entrada, o CSRF
// é o da entrada), e os dados da página.
type tela struct {
	Titulo  string
	Usuario string
	CSRF    string
	Pagina  any
}

// mostrar monta a página inteira antes de escrever: um erro no meio não deixa meia página.
func (p *painel) mostrar(w http.ResponseWriter, status int, nome string, t tela) {
	var b bytes.Buffer
	if err := p.telas[nome].ExecuteTemplate(&b, "base", t); err != nil {
		slog.Error("admin: montar a página", "pagina", nome, "erro", err)
		http.Error(w, "Algo deu errado no servidor. Tente de novo daqui a pouco.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	w.Write(b.Bytes())
}

// mostrarComSessao mostra a página com o topo da sessão.
func (p *painel) mostrarComSessao(w http.ResponseWriter, s sessao, status int, nome, titulo string, pagina any) {
	p.mostrar(w, status, nome, tela{Titulo: "Chat · administração · " + titulo, Usuario: s.Usuario, CSRF: s.CSRF, Pagina: pagina})
}

// telaErro é a página de erro.
type telaErro struct {
	Titulo, Texto       string
	Voltar, VoltarTexto string
}

// erro mostra a página de erro. Sem sessão, ela leva de volta à entrada.
func (p *painel) erro(w http.ResponseWriter, s sessao, status int, titulo, texto string) {
	e := telaErro{Titulo: titulo, Texto: texto, Voltar: "/admin/", VoltarTexto: "Voltar para as empresas"}
	if s.Usuario == "" {
		e.Voltar, e.VoltarTexto = "/admin/entrar", "Voltar para a entrada"
	}
	p.mostrarComSessao(w, s, status, "erro", strings.ToLower(titulo), e)
}

func (p *painel) naoEncontrada(w http.ResponseWriter, _ *http.Request, s sessao) {
	p.erro(w, s, http.StatusNotFound, "Não encontrada", "Esta página não existe, ou a empresa já foi apagada.")
}

// erroServidor anota o erro no log (sem dados do pedido) e mostra a página de erro.
func (p *painel) erroServidor(w http.ResponseWriter, s sessao, err error) {
	slog.Error("admin: erro do servidor", "erro", err)
	p.erro(w, s, http.StatusInternalServerError, "Algo deu errado",
		"O servidor não conseguiu terminar o pedido. Tente de novo daqui a pouco.")
}

// erroDoBanco mostra 404 para o que não existe (ou é de outra empresa) e 500 para o resto.
func (p *painel) erroDoBanco(w http.ResponseWriter, r *http.Request, s sessao, err error) {
	if errors.Is(err, banco.ErrNaoEncontrado) {
		p.naoEncontrada(w, r, s)
		return
	}
	p.erroServidor(w, s, err)
}

// idDe lê o número do segmento {nome} da rota. Um texto que não é um número positivo é um id
// que não existe.
func idDe(r *http.Request, nome string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(nome), 10, 64)
	return id, err == nil && id > 0
}

func enderecoEmpresa(id int64) string { return fmt.Sprintf("/admin/empresas/%d", id) }

// empresaDoCaminho acha a empresa do {id} da rota. Se ela não existe, já respondeu 404.
func (p *painel) empresaDoCaminho(w http.ResponseWriter, r *http.Request, s sessao) (banco.ResumoEmpresa, bool) {
	id, ok := idDe(r, "id")
	if !ok {
		p.naoEncontrada(w, r, s)
		return banco.ResumoEmpresa{}, false
	}
	e, err := p.banco.ResumoDaEmpresa(r.Context(), id)
	if err != nil {
		p.erroDoBanco(w, r, s, err)
		return banco.ResumoEmpresa{}, false
	}
	return e, true
}

// GET /admin/estatico/{arquivo}: a folha de estilo, o script, a fonte, a licença dela e o logo.
// Só sai o que está embutido na pasta estatico: o embed.FS recusa os caminhos com "..", e o
// embed não leva os arquivos com ponto na frente.
func (p *painel) estatico(w http.ResponseWriter, r *http.Request) {
	nome := r.PathValue("arquivo")
	tipo, ok := tiposEstaticos[path.Ext(nome)]
	dados, err := estaticosFS.ReadFile("estatico/" + nome)
	if !ok || err != nil {
		p.naoEncontrada(w, r, sessao{})
		return
	}
	w.Header().Set("Content-Type", tipo)
	w.Write(dados)
}

// numero é um dos números do alto da lista.
type numero struct{ Valor, Legenda string }

type linhaEmpresa struct {
	Nome, Espaco, Desde, Endereco string
	Pessoas                       int
}

type telaEmpresas struct {
	Numeros  []numero
	Empresas []linhaEmpresa
}

// GET /admin/: a lista das empresas, com os totais.
func (p *painel) empresas(w http.ResponseWriter, r *http.Request, s sessao) {
	lista, err := p.banco.Empresas(r.Context())
	if err != nil {
		p.erroServidor(w, s, err)
		return
	}
	var t telaEmpresas
	pessoas, bytes := 0, int64(0)
	for _, e := range lista {
		t.Empresas = append(t.Empresas, linhaEmpresa{Nome: e.Nome, Pessoas: e.Pessoas, Espaco: espaco(e.Bytes),
			Desde: data(e.CriadaEm), Endereco: enderecoEmpresa(e.ID)})
		pessoas += e.Pessoas
		bytes += e.Bytes
	}
	t.Numeros = []numero{
		{strconv.Itoa(len(lista)), plural(len(lista), "empresa no chat", "empresas no chat")},
		{strconv.Itoa(pessoas), plural(pessoas, "pessoa no chat", "pessoas no chat")},
		{espaco(bytes), "de arquivos guardados"},
	}
	p.mostrarComSessao(w, s, http.StatusOK, "empresas", "empresas", t)
}

type telaNova struct{ Nome, Erro string }

// GET /admin/empresas/nova: pede o nome da empresa.
func (p *painel) paginaNova(w http.ResponseWriter, _ *http.Request, s sessao) {
	p.mostrarComSessao(w, s, http.StatusOK, "nova", "nova empresa", telaNova{})
}

// POST /admin/empresas: cria a empresa e vai para a página dela, que mostra o código.
func (p *painel) criarEmpresa(w http.ResponseWriter, r *http.Request, s sessao) {
	nome, err := regras.NomeEmpresa(r.PostForm.Get("nome"))
	if err != nil {
		p.mostrarComSessao(w, s, http.StatusBadRequest, "nova", "nova empresa",
			telaNova{Nome: r.PostForm.Get("nome"), Erro: textoNomeEmpresa})
		return
	}
	e, err := p.banco.CriarEmpresa(r.Context(), nome)
	if err != nil {
		p.erroServidor(w, s, err)
		return
	}
	slog.Info("admin: empresa criada", "usuario", s.Usuario, "empresa", e.ID)
	http.Redirect(w, r, enderecoEmpresa(e.ID), http.StatusSeeOther)
}

type linhaComputador struct{ Nome, UltimaVez, Tirar string }

type linhaPessoa struct {
	Nome, Ramal, UltimaVez, Tirar string
	Computadores                  []linhaComputador
}

type telaEmpresa struct {
	Nome, Codigo, Resumo, Endereco string
	Pessoas                        []linhaPessoa
}

// GET /admin/empresas/{id}: a empresa, com o código, as pessoas e os computadores.
func (p *painel) empresa(w http.ResponseWriter, r *http.Request, s sessao) {
	e, ok := p.empresaDoCaminho(w, r, s)
	if !ok {
		return
	}
	pessoas, err := p.banco.PessoasDaEmpresa(r.Context(), e.ID)
	if err != nil {
		p.erroServidor(w, s, err)
		return
	}
	agora := p.banco.Relogio().Agora()
	t := telaEmpresa{Nome: e.Nome, Codigo: e.Codigo, Endereco: enderecoEmpresa(e.ID),
		Resumo: fmt.Sprintf("%d %s · %s de arquivos", e.Pessoas, plural(e.Pessoas, "pessoa", "pessoas"), espaco(e.Bytes))}
	for _, x := range pessoas {
		lp := linhaPessoa{Nome: x.Nome, Ramal: x.Ramal, UltimaVez: quando(x.UltimaVez, agora),
			Tirar: fmt.Sprintf("%s/pessoas/%d/tirar", t.Endereco, x.ID)}
		for _, c := range x.Computadores {
			lp.Computadores = append(lp.Computadores, linhaComputador{Nome: c.Nome, UltimaVez: quando(c.UltimaVez, agora),
				Tirar: fmt.Sprintf("%s/computadores/%d/tirar", t.Endereco, c.ID)})
		}
		t.Pessoas = append(t.Pessoas, lp)
	}
	p.mostrarComSessao(w, s, http.StatusOK, "empresa", e.Nome, t)
}

// POST /admin/empresas/{id}/codigo: troca o código. Ninguém sai do chat: o novo vale para os
// próximos computadores.
func (p *painel) trocarCodigo(w http.ResponseWriter, r *http.Request, s sessao) {
	id, ok := idDe(r, "id")
	if !ok {
		p.naoEncontrada(w, r, s)
		return
	}
	if _, err := p.banco.TrocarCodigo(r.Context(), id); err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	slog.Info("admin: código trocado", "usuario", s.Usuario, "empresa", id)
	http.Redirect(w, r, enderecoEmpresa(id), http.StatusSeeOther)
}

// POST /admin/empresas/{id}/pessoas/{pid}/tirar: tira a pessoa do chat. Depois do commit, os
// computadores dela recebem o fora, e quem fica em cada grupo dela recebe o grupo mudado e o
// aviso saiu.
func (p *painel) tirarPessoa(w http.ResponseWriter, r *http.Request, s sessao) {
	id, ok1 := idDe(r, "id")
	pid, ok2 := idDe(r, "pid")
	if !ok1 || !ok2 {
		p.naoEncontrada(w, r, s)
		return
	}
	computadores, avisos, err := p.banco.TirarPessoa(r.Context(), id, pid)
	if err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	p.hub.Fora(computadores)
	for _, a := range avisos {
		p.avisos.Grupo(r.Context(), id, a.ConversaID, []int64{a.MensagemID})
	}
	slog.Info("admin: pessoa tirada do chat", "usuario", s.Usuario, "empresa", id, "pessoa", pid,
		"computadores", len(computadores), "grupos", len(avisos))
	http.Redirect(w, r, enderecoEmpresa(id), http.StatusSeeOther)
}

// POST /admin/empresas/{id}/computadores/{cid}/tirar: a chave do computador deixa de valer, e
// ele recebe o fora.
func (p *painel) tirarComputador(w http.ResponseWriter, r *http.Request, s sessao) {
	id, ok1 := idDe(r, "id")
	cid, ok2 := idDe(r, "cid")
	if !ok1 || !ok2 {
		p.naoEncontrada(w, r, s)
		return
	}
	if err := p.banco.TirarComputador(r.Context(), id, cid); err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	p.hub.Fora([]int64{cid}) // depois do banco: quem conectar daqui em diante já é recusado
	slog.Info("admin: computador tirado do chat", "usuario", s.Usuario, "empresa", id, "computador", cid)
	http.Redirect(w, r, enderecoEmpresa(id), http.StatusSeeOther)
}

type telaApagar struct{ Nome, Endereco, Erro string }

// GET /admin/empresas/{id}/apagar: pede o nome da empresa digitado.
func (p *painel) paginaApagar(w http.ResponseWriter, r *http.Request, s sessao) {
	e, ok := p.empresaDoCaminho(w, r, s)
	if !ok {
		return
	}
	p.mostrarComSessao(w, s, http.StatusOK, "apagar", "apagar "+e.Nome, telaApagar{Nome: e.Nome, Endereco: enderecoEmpresa(e.ID)})
}

// POST /admin/empresas/{id}/apagar: com o nome exato da empresa, apaga tudo dela, no banco e
// no disco, e os computadores dela recebem o fora. Com outro nome, nada muda.
func (p *painel) apagarEmpresa(w http.ResponseWriter, r *http.Request, s sessao) {
	e, ok := p.empresaDoCaminho(w, r, s)
	if !ok {
		return
	}
	if strings.TrimSpace(r.PostForm.Get("nome")) != e.Nome {
		p.mostrarComSessao(w, s, http.StatusBadRequest, "apagar", "apagar "+e.Nome,
			telaApagar{Nome: e.Nome, Endereco: enderecoEmpresa(e.ID), Erro: textoNomeErrado})
		return
	}
	arquivos, computadores, err := p.banco.ApagarEmpresa(r.Context(), e.ID)
	if err != nil {
		p.erroDoBanco(w, r, s, err)
		return
	}
	p.hub.Fora(computadores)
	falhas := 0
	for _, id := range arquivos {
		if err := p.armazem.Apagar(id); err != nil {
			// A linha já saiu; a varredura diária (tarefas) tira do disco o que ficou.
			falhas++
			slog.Error("admin: não apagou do disco um arquivo da empresa apagada", "id", id, "erro", err)
		}
	}
	slog.Info("admin: empresa apagada", "usuario", s.Usuario, "empresa", e.ID, "arquivos", len(arquivos),
		"falhasNoDisco", falhas, "computadores", len(computadores))
	http.Redirect(w, r, "/admin/", http.StatusSeeOther)
}

// espaco escreve os bytes em português, em múltiplos de 1.024 (como os 25 MB da spec): "0 B",
// "512 B", "1,5 KB", "6,2 GB".
func espaco(n int64) string {
	if n < 1024 {
		return strconv.FormatInt(n, 10) + " B"
	}
	unidades := []string{"KB", "MB", "GB", "TB"}
	v, i := float64(n)/1024, 0
	for v >= 1023.95 && i < len(unidades)-1 { // 1023,95 KB já seria "1024,0 KB": passa a MB
		v, i = v/1024, i+1
	}
	return strings.Replace(strconv.FormatFloat(v, 'f', 1, 64), ".", ",", 1) + " " + unidades[i]
}

// quando escreve a hora (ms UTC) no horário de Brasília, mesmo num servidor em UTC: "hoje,
// 09:43", "ontem, 18:02" ou a data, "01/11/2026". O 0 é "—".
func quando(ms int64, agora time.Time) string {
	if ms == 0 {
		return "—"
	}
	fuso := tempo.Fuso()
	t := time.UnixMilli(ms).In(fuso)
	h := agora.In(fuso)
	switch {
	case mesmoDia(t, h):
		return "hoje, " + t.Format("15:04")
	case mesmoDia(t, time.Date(h.Year(), h.Month(), h.Day()-1, 12, 0, 0, 0, fuso)):
		return "ontem, " + t.Format("15:04")
	}
	return t.Format("02/01/2006")
}

func mesmoDia(a, b time.Time) bool {
	a1, a2, a3 := a.Date()
	b1, b2, b3 := b.Date()
	return a1 == b1 && a2 == b2 && a3 == b3
}

// data escreve o dia (ms UTC) no horário de Brasília: "04/11/2026".
func data(ms int64) string { return time.UnixMilli(ms).In(tempo.Fuso()).Format("02/01/2006") }

func plural(n int, um, varios string) string {
	if n == 1 {
		return um
	}
	return varios
}
