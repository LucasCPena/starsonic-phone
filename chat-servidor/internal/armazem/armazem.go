// Package armazem guarda no disco os bytes dos arquivos do chat e das miniaturas.
//
// O caminho é <pasta>/<id[0:2]>/<id>, e <id>.mini para a miniatura. Toda gravação vai para
// um temporário na mesma subpasta, é sincronizada com o disco (fsync) e só então renomeada:
// quem lê nunca vê um arquivo pela metade, e um envio que falha não deixa nada.
package armazem

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// ErrGrande diz que o conteúdo passou do máximo; nada fica no disco.
var ErrGrande = errors.New("armazem: o conteúdo passa do máximo")

// ErrID diz que o id não é um id de arquivo (32 hexadecimais minúsculos). Ele vira parte de
// um caminho, então nada além disso entra.
var ErrID = errors.New("armazem: id de arquivo inválido")

const (
	permArquivo = 0o600
	permPasta   = 0o700
	prefixoTmp  = ".tmp-"
	sufixoMini  = ".mini"
)

// Armazem é a pasta onde os arquivos ficam.
type Armazem struct {
	pasta string
}

// Novo abre o armazém na pasta (<dados>/arquivos), criando-a se faltar.
func Novo(pasta string) (*Armazem, error) {
	if err := os.MkdirAll(pasta, permPasta); err != nil {
		return nil, fmt.Errorf("armazem: criar %s: %w", pasta, err)
	}
	return &Armazem{pasta: pasta}, nil
}

func idValido(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// caminho devolve a subpasta e o caminho do arquivo do id.
func (a *Armazem) caminho(id string) (pasta, arquivo string, err error) {
	if !idValido(id) {
		return "", "", ErrID
	}
	pasta = filepath.Join(a.pasta, id[:2])
	return pasta, filepath.Join(pasta, id), nil
}

// gravar copia até max bytes de r para destino, passando por um temporário na mesma pasta.
func gravar(pasta, destino string, r io.Reader, max int64) (n int64, err error) {
	if err := os.MkdirAll(pasta, permPasta); err != nil {
		return 0, err
	}
	tmp, err := os.CreateTemp(pasta, prefixoTmp+"*")
	if err != nil {
		return 0, err
	}
	nome := tmp.Name()
	pronto := false
	defer func() {
		if !pronto {
			tmp.Close()
			os.Remove(nome)
		}
	}()
	if err := tmp.Chmod(permArquivo); err != nil {
		return 0, err
	}
	// Lê um byte a mais que o máximo: é o que mostra que passou.
	n, err = io.Copy(tmp, io.LimitReader(r, max+1))
	if err != nil {
		return 0, err
	}
	if n > max {
		return 0, ErrGrande
	}
	if err := tmp.Sync(); err != nil {
		return 0, err
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if err := os.Rename(nome, destino); err != nil {
		return 0, err
	}
	pronto = true
	if d, err := os.Open(pasta); err == nil { // grava o rename no disco; se não der, o arquivo já está lá
		d.Sync()
		d.Close()
	}
	return n, nil
}

// Gravar guarda os bytes de r como o arquivo id. Passando de max bytes, dá ErrGrande; com um
// erro de leitura, dá esse erro. Nos dois casos não fica nem o arquivo nem o temporário.
func (a *Armazem) Gravar(id string, r io.Reader, max int64) (n int64, err error) {
	pasta, arquivo, err := a.caminho(id)
	if err != nil {
		return 0, err
	}
	return gravar(pasta, arquivo, r, max)
}

// GravarMiniatura guarda a miniatura do arquivo id, no lugar da que houver. As regras são as
// do Gravar.
func (a *Armazem) GravarMiniatura(id string, r io.Reader, max int64) (n int64, err error) {
	pasta, arquivo, err := a.caminho(id)
	if err != nil {
		return 0, err
	}
	return gravar(pasta, arquivo+sufixoMini, r, max)
}

// Abrir abre o arquivo id para leitura. Se faltar, o erro satisfaz os.ErrNotExist.
func (a *Armazem) Abrir(id string) (*os.File, error) {
	_, arquivo, err := a.caminho(id)
	if err != nil {
		return nil, err
	}
	return os.Open(arquivo)
}

// AbrirMiniatura abre a miniatura do arquivo id. Se faltar, o erro satisfaz os.ErrNotExist.
func (a *Armazem) AbrirMiniatura(id string) (*os.File, error) {
	_, arquivo, err := a.caminho(id)
	if err != nil {
		return nil, err
	}
	return os.Open(arquivo + sufixoMini)
}

// ApagarMiniatura apaga só a miniatura. Se ela faltar, não dá erro.
func (a *Armazem) ApagarMiniatura(id string) error {
	_, arquivo, err := a.caminho(id)
	if err != nil {
		return err
	}
	if err := os.Remove(arquivo + sufixoMini); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Apagar apaga o arquivo e a miniatura. Se faltarem, não dá erro.
func (a *Armazem) Apagar(id string) error {
	_, arquivo, err := a.caminho(id)
	if err != nil {
		return err
	}
	var primeiro error
	for _, c := range []string{arquivo, arquivo + sufixoMini} {
		if err := os.Remove(c); err != nil && !errors.Is(err, os.ErrNotExist) && primeiro == nil {
			primeiro = err
		}
	}
	return primeiro
}
