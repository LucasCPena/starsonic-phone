// Package proxy leva o WebSocket do navegador (o /sip) ao WebSocket do FreeSWITCH, sem mexer nos bytes. Só
// passa o GET com o Upgrade: websocket, de uma origem conhecida e de um endereço que não passou do limite de
// conexões ao mesmo tempo.
//
// Nos registros ficam só o status e o motivo da recusa: nunca a origem, o endereço, o caminho nem a consulta.
package proxy

import (
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strings"
	"sync"
)

// Novo devolve o handler do /sip. O destino é o endereço do WebSocket do FreeSWITCH (http://127.0.0.1:5066/), as
// origens são as únicas que o Origin pode ter (comparação exata) e maxPorEndereco é quantas conexões abertas
// cada endereço IP pode ter ao mesmo tempo.
func Novo(destino string, origens []string, maxPorEndereco int) http.Handler {
	alvo, err := url.Parse(destino)
	if err != nil || alvo.Host == "" {
		panic("proxy: destino inválido: " + destino) // erro do programa: o destino é uma constante
	}
	p := &proxy{origens: map[string]bool{}, max: maxPorEndereco, abertas: map[netip.Addr]int{}}
	for _, o := range origens {
		p.origens[o] = true
	}
	p.rp = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(alvo)
			r.Out.Host = alvo.Host
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			slog.Warn("sip: o FreeSWITCH não respondeu", "status", http.StatusBadGateway)
			http.Error(w, "o servidor de vídeo não respondeu", http.StatusBadGateway)
		},
	}
	return p
}

type proxy struct {
	rp      *httputil.ReverseProxy
	origens map[string]bool
	max     int

	mu      sync.Mutex
	abertas map[netip.Addr]int // conexões em andamento, por endereço
}

func (p *proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || !temToken(r.Header, "Connection", "upgrade") {
		recusar(w, http.StatusBadRequest, "só o WebSocket")
		return
	}
	if o := r.Header.Values("Origin"); len(o) != 1 || !p.origens[o[0]] {
		recusar(w, http.StatusForbidden, "origem não permitida")
		return
	}
	ip := enderecoDe(r.RemoteAddr)
	if !p.pegar(ip) {
		recusar(w, http.StatusTooManyRequests, "conexões demais deste endereço")
		return
	}
	defer p.soltar(ip)
	// O ReverseProxy leva o túnel até um dos lados fechar: a vaga volta quando o ServeHTTP volta.
	p.rp.ServeHTTP(w, r)
}

func recusar(w http.ResponseWriter, status int, motivo string) {
	slog.Info("sip recusado", "status", status, "motivo", motivo)
	http.Error(w, http.StatusText(status), status)
}

// temToken diz se o cabeçalho, que pode vir em várias linhas e com vírgulas, tem o token (sem olhar maiúsculas).
func temToken(h http.Header, nome, token string) bool {
	for _, v := range h.Values(nome) {
		for _, parte := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(parte), token) {
				return true
			}
		}
	}
	return false
}

// enderecoDe é o IP de um RemoteAddr, com o IPv4 dentro de IPv6 contado como IPv4. Um endereço que não lê vira
// o endereço zero: todos eles dividem o mesmo limite.
func enderecoDe(remoto string) netip.Addr {
	host, _, err := net.SplitHostPort(remoto)
	if err != nil {
		host = remoto
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return ip.Unmap().WithZone("")
}

func (p *proxy) pegar(ip netip.Addr) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.abertas[ip] >= p.max {
		return false
	}
	p.abertas[ip]++
	return true
}

func (p *proxy) soltar(ip netip.Addr) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.abertas[ip] <= 1 {
		delete(p.abertas, ip)
		return
	}
	p.abertas[ip]--
}
