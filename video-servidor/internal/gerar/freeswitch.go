package gerar

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	_ "embed"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/config"
)

//go:embed modelos/freeswitch.xml
var modeloFreeSWITCH string

var freeswitchXML = template.Must(template.New("freeswitch.xml").Funcs(template.FuncMap{"xml": escaparXML}).Parse(modeloFreeSWITCH))

// escaparXML escreve v como texto de XML, com as aspas, o apóstrofo, o <, o >, o & e as quebras de
// linha trocados por referências. Todo valor que vai num atributo passa por aqui.
func escaparXML(v any) (string, error) {
	var b strings.Builder
	if err := xml.EscapeText(&b, []byte(fmt.Sprint(v))); err != nil {
		return "", err
	}
	return b.String(), nil
}

type dadosFreeSWITCH struct {
	SenhaESL, IPPrivado, IPPublico        string
	MidiaInicio, MidiaFim                 int
	PortaESL, PortaSIPNavegador, PortaTLS int
	WSBinding, URLDiscagem                string
	PastaTLS, QuadroSemCamera             string
	ACLs                                  []string // o apply-candidate-acl dos dois perfis
	LayoutDaReuniao                       string
	Layouts                               []layout
	Grupo                                 grupo
}

// FreeSWITCH devolve o freeswitch.xml, um arquivo só, para a pasta pastaFS (a do -conf, com o
// sem-camera.png e a pasta tls/ dentro), que tem de ser um caminho inteiro.
//
// Com teste, os candidatos ICE de quem liga podem ser da rede local (rfc1918.auto e localnet.auto),
// como os dos navegadores do teste de ponta a ponta. Em produção, só os da internet (wan.auto).
func FreeSWITCH(c config.Config, pastaFS string, teste bool) ([]byte, error) {
	if !filepath.IsAbs(pastaFS) {
		return nil, fmt.Errorf("a pasta do FreeSWITCH tem de ser um caminho inteiro: %s", pastaFS)
	}
	acls := []string{"wan.auto"}
	if teste {
		acls = []string{"rfc1918.auto", "localnet.auto"}
	}
	var b bytes.Buffer
	err := freeswitchXML.Execute(&b, dadosFreeSWITCH{
		SenhaESL:          c.SenhaESL,
		IPPrivado:         c.IPPrivado,
		IPPublico:         c.IPPublico,
		MidiaInicio:       MidiaInicio,
		MidiaFim:          MidiaFim,
		PortaESL:          PortaESL,
		PortaSIPNavegador: PortaSIPNavegador,
		PortaTLS:          PortaTLS,
		WSBinding:         fmt.Sprintf("127.0.0.1:%d", PortaWS),
		URLDiscagem:       fmt.Sprintf("http://127.0.0.1:%d/freeswitch/discagem", PortaDiscagem),
		PastaTLS:          filepath.Join(pastaFS, "tls"),
		QuadroSemCamera:   filepath.Join(pastaFS, "sem-camera.png"),
		ACLs:              acls,
		LayoutDaReuniao:   "group:" + grade.Nome,
		Layouts:           layouts,
		Grupo:             grade,
	})
	if err != nil {
		return nil, fmt.Errorf("o modelo do freeswitch.xml: %w", err)
	}
	return b.Bytes(), nil
}

// SemCamera devolve o quadro de quem está sem câmera (o video-no-video-avatar): um PNG de 640×360,
// todo de #1B2333. O FreeSWITCH escreve o nome por cima, na faixa de baixo.
func SemCamera() []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 640, 360))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.NRGBA{R: 0x1B, G: 0x23, B: 0x33, A: 0xFF}), image.Point{}, draw.Src)
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		panic("gerar: o PNG do quadro sem câmera: " + err.Error()) // num bytes.Buffer, nunca acontece
	}
	return b.Bytes()
}

// validadeDeTeste é quanto vale o certificado do modo de teste.
const validadeDeTeste = 7 * 24 * time.Hour

// certificadoDeTeste devolve, para o perfil tls do modo de teste, o agent.pem (a chave privada e depois
// o certificado) e o cafile.pem (o mesmo certificado) de um certificado autoassinado do endereço:
// ECDSA P-256, o tipo de chave que o certbot faz por padrão, e válido por poucos dias. Em produção, os
// dois arquivos são do certificado.sh, com o certificado do Let's Encrypt.
func certificadoDeTeste(endereco string) (agent, cafile []byte, err error) {
	chave, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	agora := time.Now()
	modelo := &x509.Certificate{
		Subject:               pkix.Name{CommonName: endereco},
		DNSNames:              []string{endereco},
		NotBefore:             agora.Add(-time.Hour),
		NotAfter:              agora.Add(validadeDeTeste),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	// Sem o SerialNumber, o CreateCertificate sorteia um.
	der, err := x509.CreateCertificate(rand.Reader, modelo, modelo, &chave.PublicKey, chave)
	if err != nil {
		return nil, nil, err
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(chave)
	if err != nil {
		return nil, nil, err
	}
	certificado := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	agent = append(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8}), certificado...)
	return agent, certificado, nil
}
