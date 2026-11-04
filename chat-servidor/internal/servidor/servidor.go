// Package servidor põe o chat no ar: monta a API e a página de administração, abre o banco e
// os arquivos, tranca tudo com o certificado do Let's Encrypt (autocert) e desliga com calma.
// O modo de teste faz o mesmo em HTTP, só no 127.0.0.1 ou no [::1].
package servidor

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/acme/autocert"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/admin"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/eventos"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tarefas"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// ErroModoTeste é o erro do RodarTeste com um endereço que não é local.
var ErroModoTeste = errors.New("o modo de teste só escuta em 127.0.0.1 ou [::1]")

// Os prazos de leitura e de escrita de cada pedido (R32). Não há WriteTimeout no http.Server,
// por causa do WebSocket e dos downloads: o tempo fica nas rotas. São variáveis para os
// testes poderem encurtar.
var (
	prazoArquivos = 5 * time.Minute // o envio, o download e a miniatura
	prazoGeral    = time.Minute     // o resto da API, a página e a raiz
)

const (
	prazoCabecalhos = 10 * time.Second
	prazoOcioso     = 120 * time.Second
	prazoDesligar   = 10 * time.Second

	hsts = "max-age=31536000"
)

// Deps é o que a montagem usa. O Hub é um só, da API e da página.
type Deps struct {
	Banco   *banco.Banco
	Hub     *eventos.Hub
	Armazem *armazem.Armazem
	Origens []string
	Teste   bool // o modo de teste é HTTP: os cookies da página vão sem o Secure
}

// Montar monta o servidor: a API em /api/v1/, a página de administração em /admin/, e a raiz
// que leva para ela. Cada pedido recebe os prazos de leitura e de escrita da sua rota.
func Montar(d Deps) http.Handler {
	h, _ := montar(d)
	return h
}

// montar também devolve a contagem dos WebSockets abertos: o desligamento espera por eles,
// porque o http.Server.Shutdown não espera uma conexão sequestrada.
func montar(d Deps) (http.Handler, *sync.WaitGroup) {
	mux := http.NewServeMux()
	mux.Handle("/api/v1/", api.Novo(api.Deps{Banco: d.Banco, Hub: d.Hub, Armazem: d.Armazem, Origens: d.Origens}))
	mux.Handle("/admin/", registrarAdmin(admin.Novo(admin.Deps{Banco: d.Banco, Hub: d.Hub, Armazem: d.Armazem, Teste: d.Teste})))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})
	sockets := &sync.WaitGroup{}
	return comPrazos(contarSockets(mux, sockets)), sockets
}

// ehEventos diz se o pedido é o WebSocket dos eventos.
func ehEventos(r *http.Request) bool {
	return r.Method == http.MethodGet && r.URL.Path == "/api/v1/eventos"
}

// comPrazos põe os prazos do pedido antes do manipulador (R32): 5 min em /api/v1/arquivos,
// 1 min no resto, e nenhum no WebSocket, que mantém na conexão sequestrada os prazos que
// tinha.
func comPrazos(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ehEventos(r) {
			prazo := prazoGeral
			if r.URL.Path == "/api/v1/arquivos" || strings.HasPrefix(r.URL.Path, "/api/v1/arquivos/") {
				prazo = prazoArquivos
			}
			rc := http.NewResponseController(w)
			fim := time.Now().Add(prazo)
			rc.SetReadDeadline(fim)  // sem suporte (um gravador de teste): fica sem prazo
			rc.SetWriteDeadline(fim) // idem
		}
		next.ServeHTTP(w, r)
	})
}

// contarSockets conta os pedidos do WebSocket até o manipulador voltar.
func contarSockets(next http.Handler, n *sync.WaitGroup) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ehEventos(r) {
			n.Add(1)
			defer n.Done()
		}
		next.ServeHTTP(w, r)
	})
}

// registrarAdmin anota o pedido da página no log, no mesmo formato do log da API: o método,
// o padrão da rota, o status e o tempo. Nunca o caminho, a query string, um campo de
// formulário nem o corpo (a entrada leva a senha).
func registrarAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		g := &gravador{ResponseWriter: w}
		next.ServeHTTP(g, r)
		padrao := r.Pattern // o ServeMux da página preenche no próprio r
		if padrao == "" {
			padrao = "-"
		}
		status := g.status
		if status == 0 {
			status = http.StatusOK
		}
		slog.Info("pedido", "metodo", r.Method, "rota", padrao, "status", status,
			"ms", time.Since(inicio).Milliseconds())
	})
}

type gravador struct {
	http.ResponseWriter
	status int
}

func (g *gravador) WriteHeader(status int) {
	if g.status == 0 {
		g.status = status
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gravador) Write(b []byte) (int, error) {
	if g.status == 0 {
		g.status = http.StatusOK
	}
	return g.ResponseWriter.Write(b)
}

func (g *gravador) Unwrap() http.ResponseWriter { return g.ResponseWriter }

// producao põe o Strict-Transport-Security em toda resposta por HTTPS.
func producao(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", hsts)
		next.ServeHTTP(w, r)
	})
}

// gerenciador é o autocert: só o Endereco recebe certificado, e o cache fica em
// <dados>/certificados.
func gerenciador(c Config) *autocert.Manager {
	return &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(filepath.Join(c.Dados, "certificados")),
		HostPolicy: autocert.HostWhitelist(c.Endereco),
	}
}

// redirecionador é o manipulador da porta 80: atende ao desafio do certificado
// (/.well-known/acme-challenge/) e manda o resto, com o caminho e a query, para o HTTPS do
// Endereco com 301. O Host do pedido não conta: o destino é sempre o da configuração.
func redirecionador(m *autocert.Manager, endereco string) http.Handler {
	return m.HTTPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://"+endereco+r.URL.RequestURI(), http.StatusMovedPermanently)
	}))
}

// novoHTTP é um http.Server com os tempos do servidor. Não tem WriteTimeout nem ReadTimeout:
// eles valem por rota (comPrazos).
func novoHTTP(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: prazoCabecalhos,
		IdleTimeout:       prazoOcioso,
	}
}

// servico é um http.Server e a função que o serve até ele fechar.
type servico struct {
	srv    *http.Server
	servir func() error
}

// Rodar põe o servidor no ar em produção: HTTPS na 443, com o certificado do Let's Encrypt, e
// a porta 80 só para o desafio e o redirecionamento. Volta quando o ctx acaba (sem erro) ou
// quando um dos servidores falha.
func Rodar(ctx context.Context, c Config) error {
	if c.Endereco == "" || c.Dados == "" {
		return errors.New("servidor: faltam o endereço e a pasta de dados")
	}
	m := gerenciador(c)
	return rodar(ctx, c, false, func(h http.Handler) []servico {
		https := novoHTTP(":443", producao(h))
		https.TLSConfig = m.TLSConfig()
		https.TLSConfig.MinVersion = tls.VersionTLS12
		http80 := novoHTTP(":80", redirecionador(m, c.Endereco))
		return []servico{
			{https, func() error { return https.ListenAndServeTLS("", "") }},
			{http80, func() error { return http80.ListenAndServe() }},
		}
	})
}

// RodarTeste põe o servidor no ar em HTTP, só no 127.0.0.1 ou no [::1], com a pasta
// c.Dados. Não usa o certificado.
func RodarTeste(ctx context.Context, c Config, escutar string) error {
	host, _, err := net.SplitHostPort(escutar)
	if err != nil || (host != "127.0.0.1" && host != "::1") {
		return ErroModoTeste
	}
	if c.Dados == "" {
		return errors.New("servidor: falta a pasta de dados")
	}
	l, err := net.Listen("tcp", escutar)
	if err != nil {
		return fmt.Errorf("servidor: escutar em %s: %w", escutar, err)
	}
	return servirTeste(ctx, c, l)
}

// servirTeste é o RodarTeste sobre um listener que já existe.
func servirTeste(ctx context.Context, c Config, l net.Listener) error {
	return rodar(ctx, c, true, func(h http.Handler) []servico {
		srv := novoHTTP(l.Addr().String(), h)
		return []servico{{srv, func() error { return srv.Serve(l) }}}
	})
}

// rodar abre o banco e os arquivos, monta o servidor, sobe os servicos e espera o ctx acabar
// ou um deles falhar. Depois desliga com calma, nesta ordem: os servidores (Shutdown, até
// 10 s), os WebSockets (1001), as tarefas, e só então o banco. Um desligamento pelo ctx não é
// erro.
func rodar(ctx context.Context, c Config, teste bool, servicos func(http.Handler) []servico) (erro error) {
	b, err := banco.Abrir(filepath.Join(c.Dados, banco.NomeArquivo), tempo.Real())
	if err != nil {
		return err
	}
	// O banco fecha por último, depois dos servidores e das tarefas (veja o fim).
	defer func() {
		if err := b.Fechar(); err != nil && erro == nil {
			erro = fmt.Errorf("servidor: fechar o banco: %w", err)
		}
	}()
	a, err := armazem.Novo(filepath.Join(c.Dados, "arquivos"))
	if err != nil {
		return err
	}
	hub := eventos.NovoHub(eventos.Config{})
	h, sockets := montar(Deps{Banco: b, Hub: hub, Armazem: a, Origens: c.Origens, Teste: teste})

	ctxTarefas, pararTarefas := context.WithCancel(ctx)
	defer pararTarefas()
	tarefasFeitas := make(chan struct{})
	go func() {
		defer close(tarefasFeitas)
		tarefas.Rodar(ctxTarefas, b, a)
	}()
	defer func() { // roda antes de o banco fechar
		pararTarefas()
		<-tarefasFeitas
	}()

	lista := servicos(h)
	falhas := make(chan error, len(lista))
	var servidores sync.WaitGroup
	for _, s := range lista {
		s.srv.RegisterOnShutdown(hub.Encerrar)
		servidores.Go(func() {
			if err := s.servir(); !errors.Is(err, http.ErrServerClosed) {
				falhas <- fmt.Errorf("servidor: %s: %w", s.srv.Addr, err)
			}
		})
	}
	slog.Info("servidor no ar", "teste", teste)

	select {
	case <-ctx.Done():
	case erro = <-falhas:
	}

	// Desliga: Shutdown espera os pedidos em andamento (até 10 s), e o Encerrar fecha os
	// WebSockets com 1001. Os WebSockets não contam para o Shutdown: espera por eles aqui.
	slog.Info("servidor desligando")
	limite, cancelar := context.WithTimeout(context.Background(), prazoDesligar)
	defer cancelar()
	var desligando sync.WaitGroup
	for _, s := range lista {
		desligando.Go(func() {
			if err := s.srv.Shutdown(limite); err != nil {
				s.srv.Close()
			}
		})
	}
	desligando.Wait()
	hub.Encerrar() // também sem nenhum Shutdown que o chame
	esperar(limite, sockets)
	servidores.Wait()
	return erro
}

// esperar espera o grupo até o ctx acabar.
func esperar(ctx context.Context, g *sync.WaitGroup) {
	feito := make(chan struct{})
	go func() { g.Wait(); close(feito) }()
	select {
	case <-feito:
	case <-ctx.Done():
	}
}
