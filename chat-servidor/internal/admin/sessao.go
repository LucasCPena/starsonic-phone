package admin

import (
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/limites"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// Os cookies da página. O da sessão leva o token (o banco guarda só o SHA-256 dele); o da
// entrada leva o token do formulário de entrada, que ainda não tem sessão. Os dois são
// HttpOnly, SameSite=Strict, presos a /admin e, fora do modo de teste, Secure. Sem Max-Age:
// fechar o navegador encerra o cookie; a sessão vence no servidor em 12 horas.
const (
	cookieSessao  = "sessao"
	cookieEntrada = "entrada"
)

// maxFormulario é o tamanho máximo do corpo de um formulário da página.
const maxFormulario = 64 * 1024

// sessao é a sessão do pedido, com o token do cookie. Vazia, é "sem sessão".
type sessao struct {
	banco.SessaoAdmin
	token string
}

func (p *painel) cookie(nome, valor string) *http.Cookie {
	return &http.Cookie{Name: nome, Value: valor, Path: "/admin", HttpOnly: true, Secure: !p.teste,
		SameSite: http.SameSiteStrictMode}
}

func (p *painel) limparCookie(w http.ResponseWriter, nome string) {
	c := p.cookie(nome, "")
	c.MaxAge = -1
	http.SetCookie(w, c)
}

// tokenValido diz se o texto tem a forma de um token: 43 caracteres base64url.
func tokenValido(s string) bool {
	if len(s) != 43 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

// mesmoToken compara os tokens em tempo constante. Um vazio nunca confere.
func mesmoToken(a, b string) bool {
	return a != "" && b != "" && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// sessaoDe acha a sessão do cookie do pedido. Sem cookie, ou com uma sessão vencida ou que não
// existe, ok é false; err é só um erro do banco.
func (p *painel) sessaoDe(r *http.Request) (s sessao, ok bool, err error) {
	c, err := r.Cookie(cookieSessao)
	if err != nil || !tokenValido(c.Value) {
		return sessao{}, false, nil
	}
	sa, err := p.banco.Sessao(r.Context(), c.Value)
	if errors.Is(err, banco.ErrNaoEncontrado) {
		return sessao{}, false, nil
	}
	if err != nil {
		return sessao{}, false, err
	}
	return sessao{SessaoAdmin: sa, token: c.Value}, true, nil
}

// lerFormulario lê o formulário do corpo, até 64 KiB. Se não der, responde 400 (ou 413) e
// devolve false. Só o corpo vale: a query string nunca entra nas ações.
func (p *painel) lerFormulario(w http.ResponseWriter, r *http.Request, s sessao) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxFormulario)
	if err := r.ParseForm(); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			p.erro(w, s, http.StatusRequestEntityTooLarge, "Pedido grande demais", "O formulário passou do tamanho que a página aceita.")
		} else {
			p.erro(w, s, http.StatusBadRequest, "Pedido inválido", "O formulário não chegou inteiro. Volte e tente de novo.")
		}
		return false
	}
	return true
}

// recusar responde 403 a um POST sem o token certo, sem fazer nada.
func (p *painel) recusar(w http.ResponseWriter, s sessao) {
	slog.Warn("admin: pedido recusado sem o token do formulário")
	p.erro(w, s, http.StatusForbidden, "Pedido recusado",
		"O pedido não veio desta página, ou a página ficou velha. Volte, recarregue a página e tente de novo.")
}

// comSessao protege uma rota: sem uma sessão válida, manda para a entrada (303). Num POST,
// confere antes o CSRF da sessão: sem ele, ou com o de outra sessão, responde 403 sem fazer
// nada.
func (p *painel) comSessao(f func(http.ResponseWriter, *http.Request, sessao)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, ok, err := p.sessaoDe(r)
		if err != nil {
			p.erroServidor(w, sessao{}, err)
			return
		}
		if !ok {
			http.Redirect(w, r, "/admin/entrar", http.StatusSeeOther)
			return
		}
		if r.Method == http.MethodPost {
			if !p.lerFormulario(w, r, s) {
				return
			}
			if !mesmoToken(r.PostForm.Get("csrf"), s.CSRF) {
				p.recusar(w, s)
				return
			}
		}
		f(w, r, s)
	}
}

type telaEntrar struct{ Usuario, Erro string }

// mostrarEntrada mostra a entrada com um token novo da entrada, no cookie e no formulário: o
// POST da entrada só vale com os dois iguais, e um site de fora não consegue ler nenhum deles.
func (p *painel) mostrarEntrada(w http.ResponseWriter, status int, usuario, erro string) {
	t := segredo.NovoToken()
	http.SetCookie(w, p.cookie(cookieEntrada, t))
	p.mostrar(w, status, "entrar", tela{Titulo: "Chat · administração · entrar", CSRF: t,
		Pagina: telaEntrar{Usuario: usuario, Erro: erro}})
}

// GET /admin/entrar: a entrada. Quem já tem sessão vai para a lista.
func (p *painel) paginaEntrar(w http.ResponseWriter, r *http.Request) {
	if _, ok, _ := p.sessaoDe(r); ok {
		http.Redirect(w, r, "/admin/", http.StatusSeeOther)
		return
	}
	p.mostrarEntrada(w, http.StatusOK, "", "")
}

// POST /admin/entrar: confere o usuário e a senha e abre a sessão. Nem o log nem a página
// dizem se foi o usuário ou a senha; a senha nunca volta na página nem entra no log.
//
// A ordem: o CSRF; o limite do endereço (R28), que vem antes de tudo e, passando dele, responde
// 429 sem ler a trava nem calcular o argon2id; e o ConferirSenha (a trava do nome, uma vaga do
// argon2id e o hash).
func (p *painel) entrar(w http.ResponseWriter, r *http.Request) {
	if !p.lerFormulario(w, r, sessao{}) {
		return
	}
	c, err := r.Cookie(cookieEntrada)
	if err != nil || !mesmoToken(r.PostForm.Get("csrf"), c.Value) {
		p.recusar(w, sessao{})
		return
	}
	usuario := r.PostForm.Get("usuario")
	endereco := limites.Endereco(r)
	if livre, _ := p.entradas.Usar(endereco, 1); !livre {
		slog.Warn("admin: entrada recusada pelo limite do endereço")
		p.mostrarEntrada(w, http.StatusTooManyRequests, usuario, textoTrava)
		return
	}
	ok, travado, err := p.banco.ConferirSenha(r.Context(), usuario, r.PostForm.Get("senha"))
	if err != nil {
		p.erroServidor(w, sessao{}, err)
		return
	}
	if travado != 0 {
		slog.Warn("admin: entrada recusada pela trava")
		p.mostrarEntrada(w, http.StatusTooManyRequests, usuario, textoTrava)
		return
	}
	if !ok {
		slog.Warn("admin: entrada recusada") // sem o usuário: pode ser uma senha digitada no lugar
		p.mostrarEntrada(w, http.StatusUnauthorized, usuario, textoSenhaErrada)
		return
	}
	p.entradas.Devolver(endereco, 1) // a entrada certa não conta, como o código certo na API
	token, s, err := p.banco.CriarSessao(r.Context(), usuario)
	if err != nil {
		p.erroServidor(w, sessao{}, err)
		return
	}
	// Cada entrada tem um token novo; a sessão de antes deste navegador, se havia, acaba.
	if velha, err := r.Cookie(cookieSessao); err == nil && tokenValido(velha.Value) {
		if err := p.banco.ApagarSessao(r.Context(), velha.Value); err != nil {
			slog.Error("admin: não encerrou a sessão anterior", "erro", err)
		}
	}
	http.SetCookie(w, p.cookie(cookieSessao, token))
	p.limparCookie(w, cookieEntrada)
	slog.Info("admin: entrou", "usuario", s.Usuario)
	http.Redirect(w, r, "/admin/", http.StatusSeeOther)
}

// POST /admin/sair: encerra a sessão, no banco e no cookie.
func (p *painel) sair(w http.ResponseWriter, r *http.Request, s sessao) {
	if err := p.banco.ApagarSessao(r.Context(), s.token); err != nil {
		p.erroServidor(w, s, err)
		return
	}
	p.limparCookie(w, cookieSessao)
	slog.Info("admin: saiu", "usuario", s.Usuario)
	http.Redirect(w, r, "/admin/entrar", http.StatusSeeOther)
}
