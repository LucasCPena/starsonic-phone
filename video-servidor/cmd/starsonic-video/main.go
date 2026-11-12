// O starsonic-video é o agente do servidor de vídeo das reuniões do Starsonic Phone.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/gerar"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
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

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
