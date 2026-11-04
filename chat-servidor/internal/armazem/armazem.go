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
	"log/slog"
	"os"
	"path/filepath"
	"strings"
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

// IDValido diz se id tem a forma de um id de arquivo: 32 hexadecimais minúsculos. É o único
// validador do servidor: a API e o armazém usam este.
func IDValido(id string) bool {
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
	if !IDValido(id) {
		return "", "", ErrID
	}
	pasta = filepath.Join(a.pasta, id[:2])
	return pasta, filepath.Join(pasta, id), nil
}

// gravar copia até max bytes de r para destino, passando por um temporário na mesma pasta. O
// id só serve ao log: o nome do arquivo do cliente nunca chega aqui.
func gravar(id, pasta, destino string, r io.Reader, max int64) (n int64, err error) {
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
			if err := os.Remove(nome); err != nil && !errors.Is(err, os.ErrNotExist) {
				slog.Error("armazem: não tirou o temporário", "id", id, "erro", err)
			}
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
	// Grava o rename no disco. Se não der, o arquivo já está lá: só vai para o log.
	d, err := os.Open(pasta)
	if err != nil {
		slog.Error("armazem: não abriu a pasta para o fsync", "id", id, "erro", err)
		return n, nil
	}
	if err := d.Sync(); err != nil {
		slog.Error("armazem: o fsync da pasta falhou", "id", id, "erro", err)
	}
	d.Close()
	return n, nil
}

// Gravar guarda os bytes de r como o arquivo id. Passando de max bytes, dá ErrGrande; com um
// erro de leitura, dá esse erro. Nos dois casos não fica nem o arquivo nem o temporário.
func (a *Armazem) Gravar(id string, r io.Reader, max int64) (n int64, err error) {
	pasta, arquivo, err := a.caminho(id)
	if err != nil {
		return 0, err
	}
	return gravar(id, pasta, arquivo, r, max)
}

// GravarMiniatura guarda a miniatura do arquivo id, no lugar da que houver. As regras são as
// do Gravar.
func (a *Armazem) GravarMiniatura(id string, r io.Reader, max int64) (n int64, err error) {
	pasta, arquivo, err := a.caminho(id)
	if err != nil {
		return 0, err
	}
	return gravar(id, pasta, arquivo+sufixoMini, r, max)
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

// Pasta devolve a pasta raiz do armazém, para a varredura da limpeza.
func (a *Armazem) Pasta() string { return a.pasta }

// Tipo diz o que é um nome de arquivo dentro de uma subpasta do armazém.
type Tipo int

const (
	TipoEstranho   Tipo = iota // não é nada que o armazém grave
	TipoTemporario             // .tmp-*, uma gravação em andamento (ou que morreu)
	TipoArquivo                // <id>
	TipoMiniatura              // <id>.mini
)

// SubpastaValida diz se nome é o nome de uma subpasta do armazém: os 2 primeiros caracteres de
// um id (hexadecimais minúsculos).
func SubpastaValida(nome string) bool {
	return len(nome) == 2 && IDValido(nome+strings.Repeat("0", 30))
}

// Classificar diz o que é o arquivo nome dentro da subpasta. Para TipoArquivo e TipoMiniatura
// devolve também o id. O nome de um id tem de começar pelo nome da subpasta. É o único lugar,
// fora do armazém, que conhece o desenho do disco: quem varre usa este.
func Classificar(subpasta, nome string) (Tipo, string) {
	if !SubpastaValida(subpasta) {
		return TipoEstranho, ""
	}
	if strings.HasPrefix(nome, prefixoTmp) {
		return TipoTemporario, ""
	}
	id, mini := strings.CutSuffix(nome, sufixoMini)
	if !IDValido(id) || id[:2] != subpasta {
		return TipoEstranho, ""
	}
	if mini {
		return TipoMiniatura, id
	}
	return TipoArquivo, id
}
