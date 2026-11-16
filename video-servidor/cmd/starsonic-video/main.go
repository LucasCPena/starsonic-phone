// O starsonic-video é o agente do servidor de vídeo das reuniões do Starsonic Phone.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/gerar"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/servidor"
)

// versao entra na compilação, com -ldflags "-X main.versao=<versão>".
var versao = "0.0.0-dev"

const uso = `uso: starsonic-video <subcomando>

subcomandos:
  versao                               mostra a versão
  chave                                sorteia uma chave nova e a escreve (43 caracteres)
  mostrar-chave [--config <arquivo>]   escreve a chave do config.json
                                       (o padrão é /etc/starsonic-video/config.json)
  configurar --config <arquivo> --saida <pasta> [--teste]
                                       escreve na pasta a configuração do FreeSWITCH
                                       (freeswitch/) e a do coturn (turnserver.conf); com
                                       --teste, a do modo de teste, com um certificado de
                                       teste para o SIP sobre TLS
  servir [--config <arquivo>]          põe o agente no ar: a 443 com o /sip e a API, a discagem e o ESL
                                       (o padrão é /etc/starsonic-video/config.json)
  servir --teste --escutar 127.0.0.1:<porta> [--config <arquivo>] [--origem <url>]...
                                       o modo de teste: HTTP, só no 127.0.0.1 ou no [::1]; o /sip
                                       aceita também as origens do --origem
`

// configPadrao é onde o instalador guarda a configuração do agente.
const configPadrao = "/etc/starsonic-video/config.json"

// run executa o subcomando e devolve o código de saída: 0 deu certo, 1 deu errado e 2 é um uso
// errado. O que o subcomando produz vai para saida, e o uso e os erros, para erros.
func run(args []string, saida, erros io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(erros, uso)
		return 2
	}
	switch args[0] {
	case "versao":
		fmt.Fprintln(saida, versao)
		return 0
	case "chave":
		fmt.Fprintln(saida, senha.NovaChave())
		return 0
	case "mostrar-chave":
		return mostrarChave(args[1:], saida, erros)
	case "configurar":
		return configurar(args[1:], erros)
	case "servir":
		return servir(args[1:], erros)
	default:
		fmt.Fprintf(erros, "subcomando desconhecido: %s\n\n%s", args[0], uso)
		return 2
	}
}

// mostrarChave escreve só a chave do config.json, numa linha. O instalador a mostra no fim.
func mostrarChave(args []string, saida, erros io.Writer) int {
	fs := flag.NewFlagSet("mostrar-chave", flag.ContinueOnError)
	fs.SetOutput(erros)
	arquivo := fs.String("config", configPadrao, "o config.json do agente")
	fs.Usage = func() { fmt.Fprint(erros, "uso: starsonic-video mostrar-chave [--config <arquivo>]\n") }
	if fs.Parse(args) != nil { // o flag já escreveu o erro e o uso
		return 2
	}
	if fs.NArg() != 0 {
		fs.Usage()
		return 2
	}
	c, err := config.Ler(*arquivo)
	if err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}
	fmt.Fprintln(saida, c.Chave)
	return 0
}

// configurar escreve a configuração do FreeSWITCH e do coturn (gerar.Tudo) a partir do config.json.
// Não escreve nada quando o config.json não vale.
func configurar(args []string, erros io.Writer) int {
	fs := flag.NewFlagSet("configurar", flag.ContinueOnError)
	fs.SetOutput(erros)
	arquivo := fs.String("config", "", "o config.json do agente")
	pasta := fs.String("saida", "", "a pasta onde a configuração é escrita (no servidor, /etc/starsonic-video)")
	teste := fs.Bool("teste", false, "o modo de teste: os candidatos da rede local e um certificado de teste para o SIP sobre TLS")
	fs.Usage = func() {
		fmt.Fprint(erros, "uso: starsonic-video configurar --config <arquivo> --saida <pasta> [--teste]\n")
	}
	if fs.Parse(args) != nil {
		return 2
	}
	if *arquivo == "" || *pasta == "" || fs.NArg() != 0 {
		fs.Usage()
		return 2
	}
	c, err := config.Ler(*arquivo)
	if err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}
	if err := gerar.Tudo(c, *pasta, *teste); err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}
	return 0
}

// servir põe o agente no ar até um SIGTERM ou um SIGINT, e desliga com calma. Um desligamento assim volta 0.
// Com os argumentos errados volta 2, e com um erro de configuração ou de execução, 1.
func servir(args []string, erros io.Writer) int {
	fs := flag.NewFlagSet("servir", flag.ContinueOnError)
	fs.SetOutput(erros)
	arquivo := fs.String("config", configPadrao, "o config.json do agente")
	teste := fs.Bool("teste", false, "o modo de teste: HTTP, só no 127.0.0.1 ou no [::1]")
	escutar := fs.String("escutar", "127.0.0.1:8095", "no modo de teste, o endereço e a porta")
	var origens []string
	fs.Func("origem", "no modo de teste, uma origem a mais para o /sip (pode repetir)", func(v string) error {
		origens = append(origens, v)
		return nil
	})
	fs.Usage = func() {
		fmt.Fprint(erros, "uso: starsonic-video servir [--config <arquivo>] | --teste [--escutar 127.0.0.1:8095] [--config <arquivo>] [--origem <url>]...\n")
	}
	if fs.Parse(args) != nil { // o flag já escreveu o erro e o uso
		return 2
	}
	deuEscutar := false
	fs.Visit(func(f *flag.Flag) { deuEscutar = deuEscutar || f.Name == "escutar" })
	if fs.NArg() != 0 || (!*teste && deuEscutar) {
		fs.Usage()
		return 2
	}
	if len(origens) > 0 && !*teste {
		fmt.Fprintln(erros, "--origem só vale com --teste")
		return 2
	}
	for i, o := range origens {
		var ok bool
		if origens[i], ok = normalizarOrigem(o); !ok {
			fmt.Fprintf(erros, "--origem inválida: %q (o formato é http://host[:porta], sem caminho)\n", o)
			return 2
		}
	}
	if *teste {
		if err := servidor.ValidarEscutar(*escutar); err != nil { // antes de ler a configuração
			fmt.Fprintln(erros, err)
			return 2
		}
	}
	c, err := config.Ler(*arquivo)
	if err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}

	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer parar()
	if *teste {
		err = servidor.RodarTeste(ctx, c, versao, *escutar, origens)
	} else {
		err = servidor.Rodar(ctx, c, versao)
	}
	if err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}
	return 0
}

// normalizarOrigem confere uma origem do --origem (http ou https, com host, sem caminho, consulta, fragmento nem
// usuário) e a devolve como esquema://host[:porta], sem a barra do fim.
func normalizarOrigem(v string) (string, bool) {
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" {
		return "", false
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.User != nil || strings.Contains(v, "#") {
		return "", false
	}
	return u.Scheme + "://" + u.Host, true
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
