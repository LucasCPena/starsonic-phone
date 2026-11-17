package servidor

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// O repasse do desafio do Let's Encrypt do nome do vídeo. O chat e o vídeo dividem um IP público só: a
// verificação do nome do vídeo chega na porta 80 do chat, e o chat a leva à porta 80 da VM do vídeo, onde o certbot
// do instalador dele espera durante o pedido ou a renovação.
var (
	// portaDoDesafioDoVideo é a porta da VM do vídeo, a 80. É variável para os testes usarem outra.
	portaDoDesafioDoVideo = "80"
	// prazoDoRepasse é quanto o chat espera a VM do vídeo.
	prazoDoRepasse = 10 * time.Second
)

const (
	prefixoDesafio    = "/.well-known/acme-challenge/"
	limiteDoRepasse   = 4096
	textoRepasseFalha = "Não consegui falar com o servidor de vídeo.\n"
)

// tokenDoDesafio é o que o Let's Encrypt manda depois do prefixo: letras, números, _ e -.
var tokenDoDesafio = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// clienteDoRepasse não segue redirecionamentos e não usa proxy: a VM do vídeo está na rede interna.
var clienteDoRepasse = &http.Client{
	Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true, DisableCompression: true},
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// repassarDesafioDoVideo atende ao desafio do nome do vídeo e deixa todo o resto para o proximo. Só repassa um GET ou
// HEAD para o nome do vídeo (sem a porta, sem diferença de maiúsculas) em /.well-known/acme-challenge/<token>, com o
// token no padrão. O pedido novo vai a http://<ip>:80 com o Host do vídeo, sem corpo, sem cookie e sem nenhum outro
// cabeçalho (só o Host e o Connection: close do cliente). A resposta volta como texto, com o status do vídeo e no
// máximo 4096 bytes. Um erro ou o prazo viram 502.
// O log tem uma linha por pedido repassado, só com o status: nunca o token, o caminho nem o endereço de quem pediu.
func repassarDesafioDoVideo(cv *CertificadoDoVideo, proximo http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.URL.Path, prefixoDesafio)
		if !ok || !tokenDoDesafio.MatchString(token) ||
			(r.Method != http.MethodGet && r.Method != http.MethodHead) ||
			!strings.EqualFold(hostSemPorta(r.Host), cv.Endereco) {
			proximo.ServeHTTP(w, r)
			return
		}
		status, corpo := buscarDesafio(r, cv, token)
		slog.Info("desafio do certificado do vídeo repassado", "status", status)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			w.Write(corpo)
		}
	})
}

// hostSemPorta tira a porta do Host do pedido, se ela tem uma.
func hostSemPorta(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

// buscarDesafio faz o pedido novo à VM do vídeo e devolve o status e o corpo para o chat escrever. Qualquer falha é o
// 502 com um texto curto.
func buscarDesafio(r *http.Request, cv *CertificadoDoVideo, token string) (int, []byte) {
	ctx, cancelar := context.WithTimeout(r.Context(), prazoDoRepasse)
	defer cancelar()
	alvo := "http://" + net.JoinHostPort(cv.IP, portaDoDesafioDoVideo) + prefixoDesafio + token
	pedido, err := http.NewRequestWithContext(ctx, r.Method, alvo, nil)
	if err != nil {
		return http.StatusBadGateway, []byte(textoRepasseFalha)
	}
	pedido.Host = cv.Endereco
	pedido.Header.Set("User-Agent", "") // sem o User-Agent do Go: só o Host (e o Connection: close)
	resposta, err := clienteDoRepasse.Do(pedido)
	if err != nil {
		return http.StatusBadGateway, []byte(textoRepasseFalha)
	}
	defer resposta.Body.Close()
	corpo, err := io.ReadAll(io.LimitReader(resposta.Body, limiteDoRepasse))
	if err != nil || resposta.StatusCode < 200 || resposta.StatusCode > 599 {
		return http.StatusBadGateway, []byte(textoRepasseFalha)
	}
	return resposta.StatusCode, corpo
}
