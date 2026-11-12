// Package config lê a configuração do agente, o /etc/starsonic-video/config.json que o instalador
// escreve.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/senha"
)

// Config é a configuração do agente.
type Config struct {
	Endereco  string `json:"endereco"`  // o nome do servidor de vídeo no DNS, como video.exemplo.com.br
	Chat      string `json:"chat"`      // o endereço do chat: um nome ou um IPv4, com a porta quando ele usa uma
	Chave     string `json:"chave"`     // a chave da seção 2 do docs/video-agente.md, em base64url
	SenhaESL  string `json:"senhaEsl"`  // a senha do ESL do FreeSWITCH
	IPPrivado string `json:"ipPrivado"` // o IPv4 da VM na rede dela
	IPPublico string `json:"ipPublico"` // o IPv4 público da VM, o que o endereço dá no DNS
}

// minimoSenhaESL é o tamanho mínimo da senha do ESL. O instalador sorteia 32 letras e números.
const minimoSenhaESL = 24

// Ler lê o JSON em caminho, só com os seis campos e todos certos:
//   - o endereco é um nome no DNS, com letras minúsculas, números, pontos e hífens, pelo menos um ponto
//     e a última parte que não é só número (a regra do conferir_endereco do instalador do chat);
//   - o chat é um nome assim ou um IPv4, com a porta quando o chat usa uma, sem https:// nem caminho.
//     A 443 não vale: o Origin do navegador nunca leva a porta padrão do https, e a OrigemDoChat não
//     bateria com ele;
//   - a chave é uma que o senha.LerChave aceita;
//   - a senhaEsl tem pelo menos 24 caracteres, só letras sem acento e números. O FreeSWITCH lê a
//     configuração por um pré-processador que expande o $${...} antes do XML, e a senha vai também na
//     linha do auth do ESL;
//   - os dois IPs são IPv4.
//
// O erro diz o campo, e nunca mostra a chave nem a senha.
func Ler(caminho string) (Config, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return Config{}, fmt.Errorf("configuração: %w", err)
	}
	// Uma chave que não existe é erro (um "ipPublic" no lugar de "ipPublico" não pode passar em
	// silêncio), e nada pode vir depois do objeto.
	var c Config
	dec := json.NewDecoder(bytes.NewReader(dados))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return Config{}, fmt.Errorf("configuração %s: o JSON não vale: %w", caminho, err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return Config{}, fmt.Errorf("configuração %s: tem coisa depois do objeto JSON", caminho)
	}
	if err := c.conferir(); err != nil {
		return Config{}, fmt.Errorf("configuração %s: %w", caminho, err)
	}
	return c, nil
}

func (c Config) conferir() error {
	if !nomeValido(c.Endereco) {
		return errors.New(`o "endereco" é o nome do servidor de vídeo no DNS, só com letras minúsculas, números, pontos e hífens, sem https://, porta nem caminho (por exemplo, video.exemplo.com.br)`)
	}
	if !chatValido(c.Chat) {
		return errors.New(`o "chat" é o endereço do chat, um nome ou um IPv4, com a porta quando ele usa uma que não é a 443, sem https:// nem caminho (por exemplo, chat.exemplo.com.br ou chat.exemplo.com.br:8443)`)
	}
	if _, err := senha.LerChave(c.Chave); err != nil {
		return fmt.Errorf(`a "chave" não vale: %w`, err)
	}
	if len(c.SenhaESL) < minimoSenhaESL || !letrasENumeros(c.SenhaESL) {
		return fmt.Errorf(`a "senhaEsl" tem de ter pelo menos %d caracteres, só letras sem acento e números`, minimoSenhaESL)
	}
	if !ipv4(c.IPPrivado) {
		return errors.New(`o "ipPrivado" é o IPv4 da VM na rede dela, como 10.0.0.5`)
	}
	if !ipv4(c.IPPublico) {
		return errors.New(`o "ipPublico" é o IPv4 público da VM, como 203.0.113.10`)
	}
	return nil
}

// OrigemDoChat é a origem da página do chat, a única que o /sip aceita em produção.
func (c Config) OrigemDoChat() string {
	return "https://" + c.Chat
}

// ChaveCrua devolve os 32 bytes da chave. Ela só vale para uma Config com uma chave que o
// senha.LerChave aceita, como a do Ler: com outra, é um erro do programa, e ela entra em pânico.
func (c Config) ChaveCrua() []byte {
	chave, err := senha.LerChave(c.Chave)
	if err != nil {
		panic("config: a chave não vale (a Config não veio do Ler): " + err.Error())
	}
	return chave
}

// nomeDNS são as partes de um nome no DNS separadas por pontos, pelo menos duas.
var nomeDNS = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

// nomeValido diz se s é um nome no DNS. A última parte de um nome nunca é só número: assim fica de
// fora um IP, como 203.0.113.10.
func nomeValido(s string) bool {
	if len(s) > 253 || !nomeDNS.MatchString(s) {
		return false
	}
	ultima := s[strings.LastIndexByte(s, '.')+1:]
	return strings.Trim(ultima, "0123456789") != ""
}

// chatValido diz se s é um nome ou um IPv4, com uma porta de 1 a 65535 que não é a 443, se tiver.
func chatValido(s string) bool {
	host, porta, temPorta := strings.Cut(s, ":")
	if temPorta {
		n, err := strconv.Atoi(porta)
		if err != nil || n < 1 || n > 65535 || n == 443 || strconv.Itoa(n) != porta {
			return false
		}
	}
	return nomeValido(host) || ipv4(host)
}

func ipv4(s string) bool {
	ip, err := netip.ParseAddr(s)
	return err == nil && ip.Is4()
}

func letrasENumeros(s string) bool {
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}
