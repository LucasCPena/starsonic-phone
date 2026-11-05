package servidor

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
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
}

// portaPadrao é a porta do HTTPS quando a configuração não diz outra.
const portaPadrao = 443

// arquivoConfig é o JSON como ele é escrito no disco.
type arquivoConfig struct {
	Endereco string   `json:"endereco"`
	Dados    string   `json:"dados"`
	Origens  []string `json:"origens"`
	Porta    *int     `json:"porta"`
}

// LerConfig lê o JSON em caminho, com "endereco", "dados" e, se quiser, "origens" e "porta".
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
