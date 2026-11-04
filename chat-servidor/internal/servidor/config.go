package servidor

import (
	"encoding/json"
	"errors"
	"fmt"
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
}

// arquivoConfig é o JSON como ele é escrito no disco.
type arquivoConfig struct {
	Endereco string   `json:"endereco"`
	Dados    string   `json:"dados"`
	Origens  []string `json:"origens"`
}

// LerConfig lê o JSON em caminho, com "endereco", "dados" e, se quiser, "origens". O endereço
// é obrigatório, e a pasta de dados tem de ser um caminho inteiro (o serviço roda em outra
// pasta que a de quem o instalou). Sem "origens", vale ["https://app.starsonic.local"].
func LerConfig(caminho string) (Config, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return Config{}, fmt.Errorf("configuração: %w", err)
	}
	var a arquivoConfig
	if err := json.Unmarshal(dados, &a); err != nil {
		return Config{}, fmt.Errorf("configuração %s: o JSON não vale: %w", caminho, err)
	}
	c := Config{Endereco: strings.TrimSpace(a.Endereco), Dados: a.Dados, Origens: a.Origens}
	switch {
	case c.Endereco == "":
		return Config{}, errors.New(`configuração: falta o "endereco"`)
	case strings.ContainsAny(c.Endereco, "/:@? \t"):
		return Config{}, errors.New(`configuração: o "endereco" é só o nome do servidor, sem https://, porta nem caminho`)
	case c.Dados == "":
		return Config{}, errors.New(`configuração: falta o "dados"`)
	case !filepath.IsAbs(c.Dados):
		return Config{}, errors.New(`configuração: o "dados" tem de ser um caminho inteiro (começa com /)`)
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
