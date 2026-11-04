// O starsonic-chat é o servidor do chat interno do Starsonic Phone.
package main

import (
	"fmt"
	"io"
	"os"
)

// versao entra na compilação, com -ldflags "-X main.versao=<versão>".
var versao = "0.0.0-dev"

const uso = `uso: starsonic-chat <subcomando>

subcomandos:
  versao    mostra a versão
`

// run executa o subcomando e devolve o código de saída. Lê de entrada (as senhas, nas tarefas
// seguintes) e escreve em saida.
func run(args []string, entrada io.Reader, saida io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(saida, uso)
		return 2
	}
	switch args[0] {
	case "versao":
		fmt.Fprintln(saida, versao)
		return 0
	default:
		fmt.Fprintf(saida, "subcomando desconhecido: %s\n\n%s", args[0], uso)
		return 2
	}
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout))
}
