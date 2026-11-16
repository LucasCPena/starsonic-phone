// O starsonic-video é o agente do servidor de vídeo das reuniões do Starsonic Phone.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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
  reunioes [--config <arquivo>]        escreve quantas reuniões estão acontecendo, perguntando ao
                                       agente desta máquina; sem resposta, sai com 1
                                       (o padrão é /etc/starsonic-video/config.json)
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
	case "reunioes":
		return reunioes(args[1:], saida, erros)
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

// O reunioes pergunta ao agente desta máquina pela 443 do 127.0.0.1, e o certificado do agente é o do endereço, e
// não o do IP. As duas variáveis são do pacote só para os testes as trocarem: raizesDoAgente nil são as raízes do
// sistema.
var (
	urlEstado      = "https://127.0.0.1/agente/v1/estado"
	raizesDoAgente *x509.CertPool
)

// prazoReunioes é quanto o reunioes espera o agente.
const prazoReunioes = 10 * time.Second

// reunioes escreve quantas reuniões estão acontecendo: o número de salas do estado do agente desta máquina, pedido
// com a chave do config.json. O instalador pergunta antes de atualizar. Sem resposta do agente, sai com 1 e não
// escreve nada na saída.
func reunioes(args []string, saida, erros io.Writer) int {
	fs := flag.NewFlagSet("reunioes", flag.ContinueOnError)
	fs.SetOutput(erros)
	arquivo := fs.String("config", configPadrao, "o config.json do agente")
	fs.Usage = func() { fmt.Fprint(erros, "uso: starsonic-video reunioes [--config <arquivo>]\n") }
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
	ctx, cancelar := context.WithTimeout(context.Background(), prazoReunioes)
	defer cancelar()
	n, err := contarReunioes(ctx, clienteDoAgente(c.Endereco, raizesDoAgente), urlEstado, c.Chave)
	if err != nil {
		fmt.Fprintln(erros, "Erro:", err)
		return 1
	}
	fmt.Fprintln(saida, n)
	return 0
}

// clienteDoAgente é o cliente que fala com o agente desta máquina pelo 127.0.0.1: o certificado é conferido pelo
// endereço do servidor de vídeo (o ServerName), contra as raízes (nil: as do sistema). Sem proxy.
func clienteDoAgente(endereco string, raizes *x509.CertPool) *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:           nil,
		TLSClientConfig: &tls.Config{ServerName: endereco, RootCAs: raizes, MinVersion: tls.VersionTLS12},
	}}
}

// contarReunioes pede o estado ao agente, com a chave, e devolve o número de salas. A falta de resposta, um status
// que não é 200 e uma resposta sem a lista das salas são erros. O erro nunca leva a chave.
func contarReunioes(ctx context.Context, cliente *http.Client, destino, chave string) (int, error) {
	pedido, err := http.NewRequestWithContext(ctx, http.MethodGet, destino, nil)
	if err != nil {
		return 0, err
	}
	pedido.Header.Set("Authorization", "Bearer "+chave)
	resposta, err := cliente.Do(pedido)
	if err != nil {
		return 0, fmt.Errorf("o agente não respondeu: %w", err)
	}
	defer resposta.Body.Close()
	if resposta.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("o agente respondeu %s", resposta.Status)
	}
	var estado struct {
		Salas *[]json.RawMessage `json:"salas"`
	}
	if err := json.NewDecoder(io.LimitReader(resposta.Body, 1<<20)).Decode(&estado); err != nil || estado.Salas == nil {
		return 0, errors.New("o agente respondeu, mas sem a lista das reuniões")
	}
	return len(*estado.Salas), nil
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
