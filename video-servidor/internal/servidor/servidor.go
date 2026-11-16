// Package servidor põe o agente de vídeo no ar: a 443 (TLS) com o /sip do navegador e a API do chat, a discagem
// do FreeSWITCH, a ligação com o ESL (que cai e volta sozinha), a leitura do uso da VM e o certificado, que o
// SIGHUP relê. O modo de teste faz o mesmo em HTTP, só no 127.0.0.1 ou no [::1].
//
// Nos registros ficam só o que a seção 8 do docs/video-agente.md permite: nunca a chave, a senha do ESL, uma
// sala, um participante, uma ligação nem nada do caminho de um pedido.
package servidor

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/api"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/discagem"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/proxy"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/salas"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/uso"
)

// ErroModoTeste é o erro do modo de teste com um endereço que não é local.
var ErroModoTeste = errors.New("o modo de teste só escuta em 127.0.0.1 ou [::1]")

// Os endereços e os prazos são variáveis do pacote para os testes usarem outras portas e esperas curtas.
var (
	enderecoESL      = "127.0.0.1:8021"
	enderecoDiscagem = "127.0.0.1:8091"
	destinoSIP       = "http://127.0.0.1:5066/" // o WebSocket do perfil navegador do FreeSWITCH
	procDir          = "/proc"
	intervaloUso     = 60 * time.Second
	esperaESLMinima  = 2 * time.Second  // a espera depois que o ESL cai
	esperaESLMaxima  = 10 * time.Second // até onde ela sobe, quando o ESL não volta

	arquivoCertificado = "/etc/starsonic-video/tls/certificado.pem"
	arquivoChave       = "/etc/starsonic-video/tls/chave.pem"
)

const (
	enderecoHTTPS   = ":443"
	prazoCabecalhos = 10 * time.Second
	prazoOcioso     = 120 * time.Second
	prazoDesligar   = 10 * time.Second
	prazoReloadcert = 5 * time.Second
	maxPorEndereco  = 30 // conexões do /sip ao mesmo tempo, por endereço IP
	hsts            = "max-age=31536000"
)

// certificado é o par que a 443 mostra. O GetCertificate lê o par de agora, e o Recarregar o troca sem parar nada.
type certificado struct {
	arquivoCert, arquivoChave string
	atual                     atomic.Pointer[tls.Certificate]
}

// carregarCertificado lê o par. Sem um par que valha, devolve o erro.
func carregarCertificado(arquivoCert, arquivoChave string) (*certificado, error) {
	c := &certificado{arquivoCert: arquivoCert, arquivoChave: arquivoChave}
	if err := c.Recarregar(); err != nil {
		return nil, err
	}
	return c, nil
}

// Recarregar relê o par dos arquivos. Se o par não vale (o arquivo sumiu, ou o certificado e a chave não
// combinam), devolve o erro e fica o par de antes.
func (c *certificado) Recarregar() error {
	par, err := tls.LoadX509KeyPair(c.arquivoCert, c.arquivoChave)
	if err != nil {
		return fmt.Errorf("certificado: %w", err)
	}
	c.atual.Store(&par)
	return nil
}

func (c *certificado) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	return c.atual.Load(), nil
}

// producao põe o Strict-Transport-Security em toda resposta por HTTPS.
func producao(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", hsts)
		next.ServeHTTP(w, r)
	})
}

// novoServidor monta o http.Server da porta principal. Sem certificado é o do modo de teste: HTTP. Com ele, é a
// 443: TLS 1.2 ou mais e só HTTP/1.1 (o TLSNextProto vazio e o ALPN sem o h2), porque o WebSocket do
// navegador não pode cair no HTTP/2, que o proxy não leva; e o HSTS em toda resposta. Não tem ReadTimeout nem
// WriteTimeout: os eventos e o WebSocket ficam abertos.
func novoServidor(h http.Handler, cert *certificado) *http.Server {
	srv := &http.Server{ReadHeaderTimeout: prazoCabecalhos, IdleTimeout: prazoOcioso, Handler: h}
	if cert != nil {
		srv.Handler = producao(h)
		srv.TLSNextProto = map[string]func(*http.Server, *tls.Conn, http.Handler){}
		srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: cert.GetCertificate, NextProtos: []string{"http/1.1"}}
	}
	return srv
}

// opcoes é o que muda entre a produção e o modo de teste.
type opcoes struct {
	principal net.Listener     // a porta principal, já aberta
	cert      *certificado     // nil: o modo de teste, em HTTP
	origens   []string         // as origens que o /sip aceita
	recarga   <-chan os.Signal // cada valor é um SIGHUP; nil: não há
}

// Rodar põe o agente no ar em produção: HTTPS na 443 e a discagem em 127.0.0.1:8091. O certificado vem de
// /etc/starsonic-video/tls, e o SIGHUP o relê e manda o reloadcert ao FreeSWITCH. Volta quando o ctx acaba (sem
// erro) ou quando um dos servidores falha.
func Rodar(ctx context.Context, c config.Config, versao string) error {
	cert, err := carregarCertificado(arquivoCertificado, arquivoChave)
	if err != nil {
		return err
	}
	l, err := net.Listen("tcp", enderecoHTTPS)
	if err != nil {
		return fmt.Errorf("servidor: escutar em %s: %w", enderecoHTTPS, err)
	}
	hup := make(chan os.Signal, 1)
	notificarSIGHUP(hup)
	defer pararSIGHUP(hup)
	return rodar(ctx, c, versao, opcoes{principal: l, cert: cert, origens: []string{c.OrigemDoChat()}, recarga: hup})
}

// ValidarEscutar confere o endereço do modo de teste: o host tem de ser exatamente 127.0.0.1 ou ::1. Senão,
// devolve o ErroModoTeste.
func ValidarEscutar(escutar string) error {
	host, _, err := net.SplitHostPort(escutar)
	if err != nil || (host != "127.0.0.1" && host != "::1") {
		return ErroModoTeste
	}
	return nil
}

// RodarTeste põe o agente no ar em HTTP, só no 127.0.0.1 ou no [::1]. As origens do /sip são a do chat e as
// que vierem aqui. A discagem e o ESL são os mesmos da produção.
func RodarTeste(ctx context.Context, c config.Config, versao, escutar string, origens []string) error {
	if err := ValidarEscutar(escutar); err != nil {
		return err
	}
	l, err := net.Listen("tcp", escutar)
	if err != nil {
		return fmt.Errorf("servidor: escutar em %s: %w", escutar, err)
	}
	return rodar(ctx, c, versao, opcoes{principal: l, origens: append([]string{c.OrigemDoChat()}, origens...)})
}

// agente é o estado de uma execução: as salas, a API, a ligação com o ESL e a última leitura do uso.
type agente struct {
	c      config.Config
	salas  *salas.Salas
	api    *api.API
	cert   *certificado
	minimo time.Duration
	maximo time.Duration

	medidor *uso.Medidor
	conn    atomic.Pointer[esl.Conexao] // a conexão pronta (com as salas lidas); nil quando o ESL está fora
	noAr    atomic.Bool
	uso     atomic.Pointer[uso.Uso]
}

func novoAgente(c config.Config, versao string, cert *certificado) *agente {
	a := &agente{c: c, cert: cert, medidor: uso.NovoMedidor(procDir), minimo: esperaESLMinima, maximo: esperaESLMaxima}
	a.salas = salas.Nova(func(av salas.Aviso) { a.api.Avisar(av) })
	a.api = api.Novo(api.Deps{
		Chave: c.Chave, Salas: a.salas, NoAr: a.noAr.Load, Versao: versao,
		Uso: func() uso.Uso { // a última leitura: nenhum pedido mede de novo
			if u := a.uso.Load(); u != nil {
				return *u
			}
			return uso.Uso{}
		},
	})
	return a
}

// rodar liga tudo e espera o ctx acabar ou um servidor falhar. Depois desliga com calma, em até 10 s: fecha os
// eventos (para não segurarem o Shutdown), para os laços, faz o Shutdown com o que resta do prazo e, no fim,
// o Close. Um desligamento pelo ctx não é erro. Fecha a porta principal em qualquer saída.
func rodar(ctx context.Context, c config.Config, versao string, opc opcoes) error {
	defer opc.principal.Close()
	ld, err := net.Listen("tcp", enderecoDiscagem)
	if err != nil {
		return fmt.Errorf("servidor: escutar em %s: %w", enderecoDiscagem, err)
	}
	defer ld.Close()

	a := novoAgente(c, versao, opc.cert)

	// O baseCtx acaba depois do Shutdown, e leva junto os túneis do /sip, que o Shutdown não espera.
	baseCtx, cancelarBase := context.WithCancel(context.Background())
	defer cancelarBase()
	var tuneis sync.WaitGroup
	mux := http.NewServeMux()
	mux.Handle("/sip", contando(proxy.Novo(destinoSIP, opc.origens, maxPorEndereco), &tuneis))
	mux.Handle("/agente/v1/", a.api)
	srv := novoServidor(mux, opc.cert)
	srv.BaseContext = func(net.Listener) context.Context { return baseCtx }

	dmux := http.NewServeMux()
	dmux.Handle("POST /freeswitch/discagem", discagem.Nova(c.ChaveCrua(), senha.NovoUsoUnico(), time.Now))
	disc := &http.Server{Handler: dmux, ReadHeaderTimeout: prazoCabecalhos, ReadTimeout: prazoCabecalhos, WriteTimeout: prazoCabecalhos, IdleTimeout: prazoOcioso}

	ctxLacos, pararLacos := context.WithCancel(ctx)
	defer pararLacos()
	a.medirUso() // a primeira leitura, antes de a API responder
	var lacos sync.WaitGroup
	lacos.Go(func() { a.repetirUso(ctxLacos) })
	lacos.Go(func() { a.manterESL(ctxLacos) })
	if opc.recarga != nil {
		lacos.Go(func() {
			for {
				select {
				case <-ctxLacos.Done():
					return
				case <-opc.recarga:
					a.recarregar(ctxLacos)
				}
			}
		})
	}

	falhas := make(chan error, 2)
	var servidores sync.WaitGroup
	servir := func(s *http.Server, l net.Listener, tlsLigado bool) {
		servidores.Go(func() {
			var err error
			if tlsLigado {
				err = s.ServeTLS(l, "", "")
			} else {
				err = s.Serve(l)
			}
			if !errors.Is(err, http.ErrServerClosed) {
				falhas <- fmt.Errorf("servidor: %w", err)
			}
		})
	}
	servir(srv, opc.principal, opc.cert != nil)
	servir(disc, ld, false)
	slog.Info("servidor no ar", "teste", opc.cert == nil, "versao", versao)

	var erro error
	select {
	case <-ctx.Done():
	case erro = <-falhas:
	}

	slog.Info("servidor desligando")
	limite, cancelar := context.WithTimeout(context.Background(), prazoDesligar)
	defer cancelar()
	a.api.Fechar() // os eventos abertos não seguram o Shutdown
	pararLacos()
	var desligando sync.WaitGroup
	for _, s := range []*http.Server{srv, disc} {
		desligando.Go(func() {
			if err := s.Shutdown(limite); err != nil {
				s.Close()
			}
		})
	}
	desligando.Wait()
	cancelarBase() // fecha os túneis do /sip
	esperar(limite, &tuneis)
	servidores.Wait()
	lacos.Wait()
	return erro
}

// contando conta os pedidos em andamento do handler, também os que viraram túnel.
func contando(next http.Handler, n *sync.WaitGroup) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		defer n.Done()
		next.ServeHTTP(w, r)
	})
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

// medirUso lê o uso da VM e guarda a leitura. Uma leitura que falha deixa a anterior.
func (a *agente) medirUso() {
	u, err := a.medidor.Medir()
	if err != nil {
		slog.Warn("uso: não consegui ler o /proc", "erro", err)
		return
	}
	a.uso.Store(&u)
}

// repetirUso lê o uso a cada intervalo, até o ctx acabar. A CPU de cada leitura é a do intervalo que passou.
func (a *agente) repetirUso(ctx context.Context) {
	t := time.NewTicker(intervaloUso)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.medirUso()
		}
	}
}

// proximaEspera dobra a espera, até o máximo.
func proximaEspera(atual, maximo time.Duration) time.Duration {
	return min(atual*2, maximo)
}

// manterESL liga ao ESL e, quando ele cai, tenta de novo: depois de 2 s, e a espera sobe até 10 s enquanto
// ele não volta. Só volta quando o ctx acaba.
func (a *agente) manterESL(ctx context.Context) {
	espera := a.minimo
	primeira := true
	for ctx.Err() == nil {
		conn, err := esl.Conectar(ctx, enderecoESL, a.c.SenhaESL)
		ligou := false
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if primeira {
				slog.Warn("esl: sem ligação com o FreeSWITCH, vou tentando", "erro", err)
			} else {
				slog.Debug("esl: ainda sem ligação", "erro", err)
			}
			primeira = false
		} else {
			ligou = a.sessao(ctx, conn)
			primeira = true // se caiu, o próximo erro volta a ser anotado
		}
		if ligou {
			espera = a.minimo
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(espera):
		}
		if !ligou {
			espera = proximaEspera(espera, a.maximo)
		}
	}
}

// sessao vive enquanto a conexão vive. Na ordem: liga as salas à conexão, começa a passar os eventos a elas (antes
// da reconstrução, para ela ver quem sai enquanto lê), reconstrói as salas e manda o estado. Quando a
// conexão cai, as salas dão o acabou de cada reunião e o estado vem vazio. Devolve se a conexão chegou a ficar
// pronta.
func (a *agente) sessao(ctx context.Context, conn *esl.Conexao) (pronta bool) {
	a.salas.Ligar(conn)
	passou := make(chan struct{})
	go func() {
		defer close(passou)
		for ev := range conn.Eventos() {
			a.salas.Evento(ctx, ev)
		}
	}()

	if err := a.salas.Reconstruir(ctx); err != nil {
		if ctx.Err() == nil {
			slog.Warn("esl: não consegui ler as reuniões do FreeSWITCH", "erro", err)
		}
		conn.Fechar()
	} else {
		pronta = true
		a.conn.Store(conn)
		a.noAr.Store(true)
		a.api.Retrato()
		slog.Info("esl: ligado ao FreeSWITCH")
	}

	select {
	case <-passou:
	case <-ctx.Done():
		conn.Fechar()
		<-passou
	}
	// A conexão acabou, e os eventos que ela já tinha foram todos tratados.
	a.noAr.Store(false)
	a.conn.Store(nil)
	a.salas.Ligar(nil)
	a.salas.Esvaziar()
	a.api.Retrato()
	conn.Fechar()
	if pronta && ctx.Err() == nil {
		slog.Warn("esl: a ligação com o FreeSWITCH caiu")
	}
	return pronta
}

// recarregar é o que o SIGHUP faz: relê o certificado (se há um) e, com o ESL ligado, manda o reloadcert ao
// FreeSWITCH. Um erro de qualquer das duas coisas vira só um aviso: o certificado de antes continua valendo, e
// um FreeSWITCH sem o comando não derruba nada.
func (a *agente) recarregar(ctx context.Context) {
	if a.cert != nil {
		if err := a.cert.Recarregar(); err != nil {
			slog.Warn("certificado: não recarreguei, continua o de antes", "erro", err)
		} else {
			slog.Info("certificado recarregado")
		}
	}
	conn := a.conn.Load()
	if conn == nil {
		return
	}
	ctx, cancelar := context.WithTimeout(ctx, prazoReloadcert)
	defer cancelar()
	if _, err := conn.API(ctx, "reloadcert"); err != nil {
		slog.Warn("esl: o FreeSWITCH não aceitou o reloadcert", "erro", err)
		return
	}
	slog.Info("esl: reloadcert feito")
}
