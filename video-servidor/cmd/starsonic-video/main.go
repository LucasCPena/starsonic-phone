// O starsonic-video é o agente do servidor de vídeo das reuniões do Starsonic Phone.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

// versao entra na compilação, com -ldflags "-X main.versao=<versão>".
var versao = "0.0.0-dev"

const uso = `uso: starsonic-video <subcomando>

subcomandos:
  versao    mostra a versão
  chave     sorteia uma chave nova e a escreve (43 caracteres)
`

// run executa o subcomando e devolve o código de saída: 0 deu certo e 2 é um uso errado.
func run(args []string, saida, erros io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(saida, uso)
		return 2
	}
	switch args[0] {
	case "versao":
		fmt.Fprintln(saida, versao)
		return 0
	case "chave":
		fmt.Fprintln(saida, senha.NovaChave())
		return 0
	default:
		fmt.Fprintf(saida, "subcomando desconhecido: %s\n\n%s", args[0], uso)
		return 2
	}
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
