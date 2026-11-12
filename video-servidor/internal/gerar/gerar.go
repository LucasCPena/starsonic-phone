// Package gerar escreve, a partir da configuração do agente, a do FreeSWITCH (o freeswitch.xml, um
// arquivo só, e o quadro de quem está sem câmera) e a do coturn (o turnserver.conf), com os valores das
// seções 1, 4, 6 e 7 do docs/video-agente.md. Os modelos ficam embutidos no programa.
package gerar

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
)

// As portas da seção 1 do docs/video-agente.md.
const (
	PortaWS           = 5066 // o WebSocket do SIP do perfil navegador, em 127.0.0.1: só o agente o alcança
	PortaSIPNavegador = 5070 // o SIP comum do perfil navegador, em 127.0.0.1
	PortaTLS          = 5061 // o SIP sobre TLS do perfil tls, no IP da VM
	PortaESL          = 8021 // o ESL, em 127.0.0.1
	PortaDiscagem     = 8091 // a discagem do agente (o mod_xml_curl), em 127.0.0.1

	MidiaInicio = 16384 // a mídia do FreeSWITCH: 300 portas UDP
	MidiaFim    = 16683
	TurnInicio  = 49152 // o relay do coturn: 300 portas UDP
	TurnFim     = 49451
)

// Tudo escreve em saida:
//   - freeswitch/freeswitch.xml (0640), que tem a senha do ESL;
//   - freeswitch/sem-camera.png (0644);
//   - a pasta freeswitch/tls/ (0750), a do certificado da 5061;
//   - turnserver.conf (0640), que tem o segredo do TURN.
//
// Com teste, escreve também o certificado de teste do perfil tls (freeswitch/tls/agent.pem, 0600, e
// cafile.pem, 0644). Sem teste, nunca: em produção, eles são do certificado.sh. As permissões não
// dependem da umask. Os donos são do instalador.
func Tudo(c config.Config, saida string, teste bool) error {
	saida, err := filepath.Abs(saida)
	if err != nil {
		return err
	}
	pastaFS := filepath.Join(saida, "freeswitch")
	pastaTLS := filepath.Join(pastaFS, "tls")

	documento, err := FreeSWITCH(c, pastaFS, teste)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(pastaTLS, 0o750); err != nil {
		return err
	}
	for _, pasta := range []string{pastaFS, pastaTLS} {
		if err := os.Chmod(pasta, 0o750); err != nil {
			return err
		}
	}
	type arquivo struct {
		caminho string
		dados   []byte
		modo    os.FileMode
	}
	arquivos := []arquivo{
		{filepath.Join(pastaFS, "freeswitch.xml"), documento, 0o640},
		{filepath.Join(pastaFS, "sem-camera.png"), SemCamera(), 0o644},
		{filepath.Join(saida, "turnserver.conf"), Turn(c), 0o640},
	}
	if teste {
		agent, cafile, err := certificadoDeTeste(c.Endereco)
		if err != nil {
			return fmt.Errorf("o certificado de teste: %w", err)
		}
		arquivos = append(arquivos,
			arquivo{filepath.Join(pastaTLS, "agent.pem"), agent, 0o600},
			arquivo{filepath.Join(pastaTLS, "cafile.pem"), cafile, 0o644},
		)
	}
	for _, a := range arquivos {
		if err := escrever(a.caminho, a.dados, a.modo); err != nil {
			return err
		}
	}
	return nil
}

// escrever grava dados em caminho, com o modo dado: num arquivo temporário da mesma pasta, que depois
// toma o lugar do antigo de uma vez. Quem lê nunca vê um arquivo pela metade, e um erro no meio deixa o
// antigo como estava.
func escrever(caminho string, dados []byte, modo os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(caminho), "."+filepath.Base(caminho)+".*")
	if err != nil {
		return fmt.Errorf("escrevendo %s: %w", caminho, err)
	}
	defer os.Remove(tmp.Name()) // depois do Rename, não há mais o que tirar
	_, err = tmp.Write(dados)
	if err == nil {
		err = tmp.Chmod(modo)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if errFechar := tmp.Close(); err == nil {
		err = errFechar
	}
	if err == nil {
		err = os.Rename(tmp.Name(), caminho)
	}
	if err != nil {
		return fmt.Errorf("escrevendo %s: %w", caminho, err)
	}
	return nil
}
