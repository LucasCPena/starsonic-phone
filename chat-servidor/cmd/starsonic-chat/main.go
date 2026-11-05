// O starsonic-chat é o servidor do chat interno do Starsonic Phone.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/term"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/copia"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/servidor"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// versao entra na compilação, com -ldflags "-X main.versao=<versão>".
var versao = "0.0.0-dev"

const uso = `uso: starsonic-chat <subcomando>

subcomandos:
  versao                                    mostra a versão
  servir [--config <arquivo>]               põe o servidor no ar (HTTPS, com o certificado do Let's Encrypt)
         [--teste --escutar 127.0.0.1:8090 --dados <pasta> [--origem <url>]...]
                                            ou, no modo de teste, em HTTP e só neste computador
  admin-criar <usuario> --dados <pasta>     cria um usuário da página de administração
  admin-senha <usuario> --dados <pasta>     troca a senha de um usuário (e encerra as sessões dele)
  admin-remover <usuario> --dados <pasta>   remove um usuário
  copia --dados <pasta> --destino <pasta>   faz a cópia de segurança do banco (chat-AAAA-MM-DD.db)

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
	case "servir":
		return servir(args[1:], saida)
	case "admin-criar", "admin-senha", "admin-remover":
		return administrar(args[0], args[1:], entrada, saida, erros)
	case "copia":
		return copiar(args[1:], saida)
	default:
		fmt.Fprintf(saida, "subcomando desconhecido: %s\n\n%s", args[0], uso)
		return 2
	}
}

// configPadrao é onde o serviço do systemd guarda a configuração.
const configPadrao = "/etc/starsonic-chat/config.json"

// servir põe o servidor no ar até um SIGTERM ou um SIGINT, e desliga com calma. Um desligamento
// assim volta 0. Com os argumentos errados volta 2, e com um erro de configuração ou de
// execução, 1.
func servir(args []string, saida io.Writer) int {
	fs := flag.NewFlagSet("servir", flag.ContinueOnError)
	fs.SetOutput(saida)
	config := fs.String("config", configPadrao, "o arquivo de configuração (JSON)")
	teste := fs.Bool("teste", false, "o modo de teste: HTTP, só no 127.0.0.1 ou no [::1]")
	escutar := fs.String("escutar", "127.0.0.1:8090", "no modo de teste, o endereço e a porta")
	dados := fs.String("dados", "", "no modo de teste, a pasta de dados")
	var origens []string
	fs.Func("origem", "no modo de teste, uma origem do CORS e do WebSocket (pode repetir; com alguma, a do app não vale)", func(v string) error {
		origens = append(origens, v)
		return nil
	})
	fs.Usage = func() {
		fmt.Fprint(saida, "uso: starsonic-chat servir [--config <arquivo>] | --teste [--escutar 127.0.0.1:8090] --dados <pasta> [--origem <url>]...\n")
	}
	if fs.Parse(args) != nil { // o flag já imprimiu o erro e o uso
		return 2
	}
	if fs.NArg() != 0 {
		fs.Usage()
		return 2
	}
	deuDados, deuEscutar, deuConfig := false, false, false
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "dados":
			deuDados = true
		case "escutar":
			deuEscutar = true
		case "config":
			deuConfig = true
		}
	})
	if (*teste && (deuConfig || !deuDados)) || (!*teste && (deuDados || deuEscutar)) {
		fs.Usage()
		return 2
	}

	if len(origens) > 0 && !*teste {
		fmt.Fprintln(saida, "--origem só vale com --teste")
		return 2
	}
	for i, o := range origens {
		var ok bool
		if origens[i], ok = normalizarOrigem(o); !ok {
			fmt.Fprintf(saida, "--origem inválida: %q (o formato é http://host[:porta], sem caminho)\n", o)
			return 2
		}
	}

	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer parar()
	var err error
	if *teste {
		if err = servidor.ValidarEscutar(*escutar); err != nil { // antes da pasta
			fmt.Fprintln(saida, err)
			return 2
		}
		if info, e := os.Stat(*dados); e != nil || !info.IsDir() {
			fmt.Fprintf(saida, "A pasta de dados não existe: %s\n", *dados)
			return 2
		}
		err = servidor.RodarTeste(ctx, servidor.Config{Dados: *dados, Origens: origens}, *escutar)
	} else {
		var c servidor.Config
		if c, err = servidor.LerConfig(*config); err != nil {
			fmt.Fprintln(saida, "Erro:", err)
			return 1
		}
		err = servidor.Rodar(ctx, c)
	}
	if err != nil {
		fmt.Fprintln(saida, "Erro:", err)
		return 1
	}
	return 0
}

// normalizarOrigem confere uma origem do --origem (http ou https, com host, sem caminho, query,
// fragmento nem usuário) e a devolve como esquema://host[:porta], sem a barra do fim.
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

// copiar faz a cópia de segurança do banco (copia.Fazer). Com os argumentos errados volta 2, e
// com um erro na cópia, 1.
func copiar(args []string, saida io.Writer) int {
	fs := flag.NewFlagSet("copia", flag.ContinueOnError)
	fs.SetOutput(saida)
	dados := fs.String("dados", "", "a pasta de dados do servidor, onde fica o "+banco.NomeArquivo)
	destino := fs.String("destino", "", "a pasta onde a cópia é guardada")
	fs.Usage = func() { fmt.Fprint(saida, "uso: starsonic-chat copia --dados <pasta> --destino <pasta>\n") }
	if fs.Parse(args) != nil {
		return 2
	}
	if *dados == "" || *destino == "" || fs.NArg() != 0 {
		fs.Usage()
		return 2
	}
	if info, err := os.Stat(*dados); err != nil || !info.IsDir() {
		fmt.Fprintf(saida, "A pasta de dados não existe: %s\n", *dados)
		return 2
	}
	arquivo, err := copia.Fazer(context.Background(), *dados, *destino, tempo.Real())
	if arquivo != "" {
		fmt.Fprintln(saida, "Cópia feita:", arquivo)
	}
	if err != nil {
		fmt.Fprintln(saida, "Erro:", err)
		return 1
	}
	return 0
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
