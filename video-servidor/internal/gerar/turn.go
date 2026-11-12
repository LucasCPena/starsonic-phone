package gerar

import (
	"bytes"
	_ "embed"
	"text/template"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/turn"
)

// O modelo do turnserver.conf.
//
// O no-cli desliga a CLI (o telnet de administração) no coturn 4.6, o do apt no Ubuntu 24.04 e no
// Debian 12. O ChangeLog do coturn diz que a 4.10.0 deixou a CLI desligada por padrão ("CLI interface
// is disabled by default").
//
//go:embed modelos/turnserver.conf
var modeloTurn string

var turnConf = template.Must(template.New("turnserver.conf").Parse(modeloTurn))

type dadosTurn struct {
	Endereco, IPPrivado, IPPublico string
	IPsDiferentes                  bool // a VM atrás de um NAT: o external-ip e o allowed-peer-ip do público
	Segredo                        string
	TurnInicio, TurnFim            int
}

// Turn devolve o turnserver.conf: o TURN da seção 4 do docs/video-agente.md, que só faz relay para os
// IPs da própria VM, com o segredo que o chat também tira da chave.
func Turn(c config.Config) []byte {
	var b bytes.Buffer
	err := turnConf.Execute(&b, dadosTurn{
		Endereco:      c.Endereco,
		IPPrivado:     c.IPPrivado,
		IPPublico:     c.IPPublico,
		IPsDiferentes: c.IPPublico != c.IPPrivado,
		Segredo:       turn.Segredo(c.ChaveCrua()),
		TurnInicio:    TurnInicio,
		TurnFim:       TurnFim,
	})
	if err != nil {
		panic("gerar: o modelo do turnserver.conf: " + err.Error()) // um erro do modelo, não dos dados
	}
	return b.Bytes()
}
