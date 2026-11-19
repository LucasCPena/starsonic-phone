package servidor

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/api"
)

// Config é a configuração do servidor, lida de um JSON (veja LerConfig).
type Config struct {
	Endereco string   // o nome do servidor na internet, o único que o certificado cobre
	Dados    string   // a pasta de dados, com o caminho inteiro
	Origens  []string // as origens do CORS; sem nenhuma, vale a do WebView do app
	// Porta é a porta do HTTPS que se usa de fora. O servidor escuta sempre na 443 da
	// máquina; quando um roteador traduz outra porta pública para essa 443 (NAT), por exemplo
	// a 8443 porque a 443 pública é de outro servidor, é essa porta que vai aqui. A porta 80
	// leva quem chega para ela. 0 ou 443 é o normal, sem porta no endereço.
	Porta int
	// CertificadoDoVideo, quando existe, faz o chat repassar à VM do vídeo a verificação do Let's Encrypt
	// do nome do vídeo, que chega na porta 80 do chat (o chat e o vídeo dividem um IP público só).
	CertificadoDoVideo *CertificadoDoVideo
}

// CertificadoDoVideo é o "certificadoDoVideo" do config.json.
type CertificadoDoVideo struct {
	Endereco string `json:"endereco"` // o nome do servidor de vídeo no DNS, o do certificado dele
	IP       string `json:"ip"`       // o IP da VM do vídeo na rede interna
}

// portaPadrao é a porta do HTTPS quando a configuração não diz outra.
const portaPadrao = 443

// arquivoConfig é o JSON como ele é escrito no disco.
type arquivoConfig struct {
	Endereco string   `json:"endereco"`
	Dados    string   `json:"dados"`
	Origens  []string `json:"origens"`
	Porta    *int     `json:"porta"`
	// O certificadoDoVideo fica cru para o null não passar por "ausente" e para uma chave a mais dentro dele
	// também ser erro.
	CertificadoDoVideo json.RawMessage `json:"certificadoDoVideo"`
}

// LerConfig lê o JSON em caminho, com "endereco", "dados" e, se quiser, "origens", "porta" e
// "certificadoDoVideo" (o "endereco" do vídeo e o "ip" da VM dele, que tem de ser da rede interna).
// O endereço é obrigatório, e a pasta de dados tem de ser um caminho inteiro (o serviço roda em
// outra pasta que a de quem o instalou). Sem "origens", vale ["https://app.starsonic.local"];
// sem "porta", vale 443. A porta vai de 1 a 65535 e não pode ser a 80, que é a do desafio do
// certificado e do desvio para o HTTPS.
func LerConfig(caminho string) (Config, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return Config{}, fmt.Errorf("configuração: %w", err)
	}
	// Uma chave que não existe é erro (um "origem" no lugar de "origens" não pode passar em
	// silêncio), e nada pode vir depois do objeto.
	var a arquivoConfig
	dec := json.NewDecoder(bytes.NewReader(dados))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&a); err != nil {
		return Config{}, fmt.Errorf("configuração %s: o JSON não vale: %w", caminho, err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return Config{}, fmt.Errorf("configuração %s: tem coisa depois do objeto JSON", caminho)
	}
	c := Config{Endereco: strings.TrimSpace(a.Endereco), Dados: a.Dados, Origens: a.Origens, Porta: portaPadrao}
	if a.Porta != nil {
		c.Porta = *a.Porta
	}
	switch {
	case c.Endereco == "":
		return Config{}, errors.New(`configuração: falta o "endereco"`)
	case strings.ContainsAny(c.Endereco, "/:@? \t"):
		return Config{}, errors.New(`configuração: o "endereco" é só o nome do servidor, sem https://, porta nem caminho`)
	case c.Dados == "":
		return Config{}, errors.New(`configuração: falta o "dados"`)
	case !filepath.IsAbs(c.Dados):
		return Config{}, errors.New(`configuração: o "dados" tem de ser um caminho inteiro (começa com /)`)
	case c.Porta < 1 || c.Porta > 65535 || c.Porta == 80:
		return Config{}, errors.New(`configuração: a "porta" é um número de 1 a 65535, e não pode ser a 80 (a 80 é a do certificado e do desvio para o HTTPS)`)
	}
	if a.CertificadoDoVideo != nil {
		cv, err := lerCertificadoDoVideo(a.CertificadoDoVideo, c.Endereco)
		if err != nil {
			return Config{}, err
		}
		c.CertificadoDoVideo = cv
	}
	for _, o := range c.Origens {
		if strings.TrimSpace(o) == "" {
			return Config{}, errors.New(`configuração: uma das "origens" está vazia`)
		}
	}
	if len(c.Origens) == 0 {
		c.Origens = []string{api.OrigemPadrao}
	}
	return c, nil
}

// nomeDNS são as partes de um nome no DNS separadas por pontos, pelo menos duas (a regra do conferir_endereco do
// instalador).
var nomeDNS = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

// nomeValido diz se s é um nome no DNS, com letras minúsculas, números, pontos e hífens. A última parte de um
// nome nunca é só número: assim fica de fora um IP.
func nomeValido(s string) bool {
	if len(s) > 253 || !nomeDNS.MatchString(s) {
		return false
	}
	ultima := s[strings.LastIndexByte(s, '.')+1:]
	return strings.Trim(ultima, "0123456789") != ""
}

// lerCertificadoDoVideo lê e confere o "certificadoDoVideo": o endereco é um nome no DNS que não é o do chat, e o ip é
// um IP da rede interna (privado, e nem de loopback nem 0.0.0.0). Os dois são obrigatórios.
func lerCertificadoDoVideo(cru json.RawMessage, enderecoDoChat string) (*CertificadoDoVideo, error) {
	dec := json.NewDecoder(bytes.NewReader(cru))
	dec.DisallowUnknownFields()
	var cv *CertificadoDoVideo
	if err := dec.Decode(&cv); err != nil {
		return nil, fmt.Errorf(`configuração: o "certificadoDoVideo" não vale: %w`, err)
	}
	if cv == nil {
		return nil, errors.New(`configuração: o "certificadoDoVideo" é um objeto com o "endereco" e o "ip" do servidor de vídeo`)
	}
	if !nomeValido(cv.Endereco) {
		return nil, errors.New(`configuração: o "endereco" do "certificadoDoVideo" é o nome do servidor de vídeo no DNS, só com letras minúsculas, números, pontos e hífens, sem https://, porta nem caminho`)
	}
	if strings.EqualFold(cv.Endereco, enderecoDoChat) {
		return nil, errors.New(`configuração: o "endereco" do "certificadoDoVideo" não pode ser o do chat`)
	}
	ip, err := netip.ParseAddr(cv.IP)
	if err != nil || ip.Is4In6() || !ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return nil, errors.New(`configuração: o "ip" do "certificadoDoVideo" é o IP da VM do vídeo na rede interna (10.x.x.x, 172.16 a 31.x.x ou 192.168.x.x)`)
	}
	return cv, nil
}
