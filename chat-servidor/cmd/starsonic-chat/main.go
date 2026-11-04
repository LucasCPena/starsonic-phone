// O starsonic-chat é o servidor do chat interno do Starsonic Phone.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"golang.org/x/term"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// versao entra na compilação, com -ldflags "-X main.versao=<versão>".
var versao = "0.0.0-dev"

const uso = `uso: starsonic-chat <subcomando>

subcomandos:
  versao                                    mostra a versão
  admin-criar <usuario> --dados <pasta>     cria um usuário da página de administração
  admin-senha <usuario> --dados <pasta>     troca a senha de um usuário (e encerra as sessões dele)
  admin-remover <usuario> --dados <pasta>   remove um usuário

  O admin-criar e o admin-senha pedem a senha duas vezes, sem mostrar. Rode com o usuário
  do serviço, para o banco continuar dele.
`

// run executa o subcomando e devolve o código de saída: 0 deu certo, 1 deu errado e 2 é um
// uso errado. Lê as senhas de entrada, pergunta por elas em erros e escreve o resto em saida.
func run(args []string, entrada io.Reader, saida, erros io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(saida, uso)
		return 2
	}
	switch args[0] {
	case "versao":
		fmt.Fprintln(saida, versao)
		return 0
	case "admin-criar", "admin-senha", "admin-remover":
		return administrar(args[0], args[1:], entrada, saida, erros)
	default:
		fmt.Fprintf(saida, "subcomando desconhecido: %s\n\n%s", args[0], uso)
		return 2
	}
}

// argumentosAdmin lê o <usuario> e o --dados de um subcomando admin-*, em qualquer ordem. O
// --dados tem de ser uma pasta que existe: um caminho errado não cria um banco novo.
func argumentosAdmin(cmd string, args []string, saida io.Writer) (usuario, dados string, ok bool) {
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(saida)
	fs.StringVar(&dados, "dados", "", "a pasta de dados do servidor, onde fica o "+banco.NomeArquivo)
	fs.Usage = func() { fmt.Fprintf(saida, "uso: starsonic-chat %s <usuario> --dados <pasta>\n", cmd) }
	if fs.Parse(args) != nil {
		return "", "", false
	}
	resto := fs.Args()
	if len(resto) > 0 {
		usuario = resto[0]
		if fs.Parse(resto[1:]) != nil {
			return "", "", false
		}
		resto = fs.Args()
	}
	if usuario == "" || dados == "" || len(resto) != 0 {
		fs.Usage()
		return "", "", false
	}
	if info, err := os.Stat(dados); err != nil || !info.IsDir() {
		fmt.Fprintf(saida, "A pasta de dados não existe: %s\n", dados)
		return "", "", false
	}
	return usuario, dados, true
}

// administrar roda o admin-criar, o admin-senha ou o admin-remover. A senha nunca vai para a
// saída: no terminal, não aparece nem quando é digitada.
func administrar(cmd string, args []string, entrada io.Reader, saida, erros io.Writer) int {
	usuario, dados, ok := argumentosAdmin(cmd, args, saida)
	if !ok {
		return 2
	}
	u, ok := banco.NormalizarUsuario(usuario)
	if !ok {
		fmt.Fprintln(saida, "O usuário tem de ter de 1 a 64 caracteres: letras sem acento, números, ponto, hífen, sublinhado ou arroba.")
		return 2
	}
	var senha string
	if cmd != "admin-remover" { // remover não pede senha: quem roda é o operador do servidor
		var problema string
		if senha, problema = pedirSenha(entrada, erros); problema != "" {
			fmt.Fprintln(saida, problema)
			return 1
		}
	}

	b, err := banco.Abrir(filepath.Join(dados, banco.NomeArquivo), tempo.Real())
	if err != nil {
		fmt.Fprintln(saida, "Não abri o banco:", err)
		return 1
	}
	defer b.Fechar()
	ctx := context.Background()
	var feito string
	switch cmd {
	case "admin-criar":
		err, feito = b.CriarAdmin(ctx, u, senha), "Usuário "+u+" criado."
	case "admin-senha":
		err, feito = b.TrocarSenha(ctx, u, senha), "A senha de "+u+" foi trocada, e as sessões dele foram encerradas."
	default:
		err, feito = b.RemoverAdmin(ctx, u), "Usuário "+u+" removido."
	}
	switch {
	case err == nil:
		fmt.Fprintln(saida, feito)
		return 0
	case errors.Is(err, banco.ErrJaExiste):
		fmt.Fprintf(saida, "O usuário %s já existe. Para trocar a senha, use o admin-senha.\n", u)
	case errors.Is(err, banco.ErrNaoEncontrado):
		fmt.Fprintf(saida, "O usuário %s não existe.\n", u)
	default:
		fmt.Fprintln(saida, "Erro:", err)
	}
	return 1
}

// pedirSenha pede a senha duas vezes e confere a regra (12 caracteres) e se as duas são iguais,
// antes de abrir o banco. As perguntas vão para perguntas (a saída de erros): com a saída
// padrão redirecionada, elas continuam aparecendo. Se algo não vale, problema é o texto que
// explica.
func pedirSenha(entrada io.Reader, perguntas io.Writer) (senha, problema string) {
	l := novoLeitorDeSenha(entrada)
	s1, ok1 := l.ler(perguntas, "Senha: ")
	s2, ok2 := l.ler(perguntas, "Repita a senha: ")
	switch {
	case !ok1 || !ok2:
		return "", "Não li a senha."
	case banco.SenhaValida(s1) != nil:
		return "", "A senha precisa ter pelo menos 12 caracteres."
	case s1 != s2:
		return "", "As senhas não são iguais."
	}
	return s1, ""
}

// leitorDeSenha lê as senhas: num terminal, sem mostrar o que é digitado (golang.org/x/term);
// fora dele (um pipe, os testes), uma linha de cada vez.
type leitorDeSenha struct {
	terminal *os.File
	linhas   *bufio.Reader
}

func novoLeitorDeSenha(entrada io.Reader) *leitorDeSenha {
	if f, ok := entrada.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		return &leitorDeSenha{terminal: f}
	}
	return &leitorDeSenha{linhas: bufio.NewReader(entrada)}
}

// ler mostra a pergunta e lê uma senha, sem a quebra de linha do fim. ok é false se nada
// chegou.
func (l *leitorDeSenha) ler(perguntas io.Writer, pergunta string) (senha string, ok bool) {
	fmt.Fprint(perguntas, pergunta)
	defer fmt.Fprintln(perguntas) // o Enter digitado não aparece no terminal
	if l.terminal != nil {
		fd := int(l.terminal.Fd())
		parar := restaurarNoCtrlC(fd, perguntas)
		b, err := term.ReadPassword(fd)
		parar()
		return string(b), err == nil
	}
	s, err := l.linhas.ReadString('\n')
	if err != nil && (!errors.Is(err, io.EOF) || s == "") {
		return "", false
	}
	return strings.TrimSuffix(strings.TrimSuffix(s, "\n"), "\r"), true
}

// restaurarNoCtrlC guarda o estado do terminal e, se um Ctrl+C chegar enquanto a senha é lida
// (o term.ReadPassword desliga o eco), devolve esse estado antes de o processo acabar, com o
// código 130, o de quem saiu pelo Ctrl+C. Sem isso, o eco do terminal ficaria desligado. parar
// desfaz a escuta. Não tem teste: precisaria de um terminal de verdade (um pty).
func restaurarNoCtrlC(fd int, perguntas io.Writer) (parar func()) {
	estado, err := term.GetState(fd)
	if err != nil {
		return func() {}
	}
	sinais := make(chan os.Signal, 1)
	signal.Notify(sinais, os.Interrupt)
	feito := make(chan struct{})
	go func() {
		select {
		case <-sinais:
			term.Restore(fd, estado)
			fmt.Fprintln(perguntas)
			os.Exit(130)
		case <-feito:
		}
	}()
	return func() {
		signal.Stop(sinais)
		close(feito)
	}
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
