// Package copia faz a cópia de segurança do banco: uma cópia consistente por dia, inteira ou
// nenhuma, guardada por 30 dias.
package copia

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite" // o driver, sem cgo

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

const (
	prefixoTmp = ".tmp-"
	// diasGuardados é quantos dias para trás a cópia fica: as de até 30 dias ficam.
	diasGuardados = 30
)

// nomeDeCopia é o nome de uma cópia: chat-AAAA-MM-DD.db, e só ele.
var nomeDeCopia = regexp.MustCompile(`^chat-(\d{4}-\d{2}-\d{2})\.db$`)

// Fazer copia <dados>/chat.db para <destino>/chat-AAAA-MM-DD.db, com a data de Brasília, e
// apaga do destino as cópias de mais de 30 dias. Devolve o caminho da cópia nova.
//
// A origem é aberta só para leitura, numa conexão própria: não roda migração e não grava no
// banco. A cópia (VACUUM INTO) sai primeiro com um nome .tmp-, vai para o disco e só então
// ganha o nome final: quem olha o destino vê uma cópia inteira ou nenhuma. Uma cópia do mesmo
// dia é trocada pela nova. Em qualquer erro, o arquivo temporário é apagado.
func Fazer(ctx context.Context, dados, destino string, r tempo.Relogio) (arquivo string, err error) {
	origem := filepath.Join(dados, banco.NomeArquivo)
	if _, err := os.Stat(origem); err != nil {
		return "", fmt.Errorf("copia: o banco: %w", err)
	}
	if err := os.MkdirAll(destino, 0o700); err != nil {
		return "", fmt.Errorf("copia: criar %s: %w", destino, err)
	}
	limparTemporarios(destino)

	agora := r.Agora().In(tempo.Fuso())
	final := filepath.Join(destino, "chat-"+agora.Format("2006-01-02")+".db")

	tmp, err := os.CreateTemp(destino, prefixoTmp+"chat-*.db") // vazio e 0600: o VACUUM INTO aceita
	if err != nil {
		return "", fmt.Errorf("copia: arquivo temporário: %w", err)
	}
	nomeTmp := tmp.Name()
	tmp.Close()
	defer func() {
		if err != nil {
			os.Remove(nomeTmp)
		}
	}()

	if err = vacuoPara(ctx, origem, nomeTmp); err != nil {
		return "", err
	}
	if err = sincronizar(nomeTmp); err != nil {
		return "", err
	}
	if err = os.Rename(nomeTmp, final); err != nil {
		return "", fmt.Errorf("copia: dar o nome final: %w", err)
	}
	if d, e := os.Open(destino); e == nil { // o nome novo também tem de chegar ao disco
		d.Sync()
		d.Close()
	}

	if err = apagarAntigas(destino, agora); err != nil {
		return final, err // a cópia nova está pronta; só a limpeza falhou
	}
	return final, nil
}

// vacuoPara copia o banco de origem, aberto só para leitura, para o arquivo vazio de destino.
func vacuoPara(ctx context.Context, origem, destino string) error {
	dsn := (&url.URL{Scheme: "file", Opaque: (&url.URL{Path: origem}).EscapedPath(),
		RawQuery: "mode=ro&_pragma=busy_timeout(10000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("copia: abrir o banco: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	aspas := strings.ReplaceAll(destino, "'", "''")
	if _, err := db.ExecContext(ctx, "VACUUM INTO '"+aspas+"'"); err != nil {
		return fmt.Errorf("copia: copiar o banco: %w", err)
	}
	return nil
}

// sincronizar manda o arquivo para o disco.
func sincronizar(caminho string) error {
	f, err := os.OpenFile(caminho, os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("copia: abrir a cópia: %w", err)
	}
	defer f.Close()
	if err := f.Sync(); err != nil {
		return fmt.Errorf("copia: gravar a cópia no disco: %w", err)
	}
	return nil
}

// limparTemporarios apaga os .tmp- que uma cópia que caiu deixou.
func limparTemporarios(destino string) {
	itens, err := os.ReadDir(destino)
	if err != nil {
		return
	}
	for _, i := range itens {
		if strings.HasPrefix(i.Name(), prefixoTmp) && !i.IsDir() {
			if err := os.Remove(filepath.Join(destino, i.Name())); err != nil {
				slog.Warn("não apaguei um temporário da cópia", "arquivo", i.Name(), "erro", err)
			}
		}
	}
}

// apagarAntigas apaga os chat-AAAA-MM-DD.db de mais de 30 dias. A idade vem da data do nome;
// qualquer outro nome fica.
func apagarAntigas(destino string, agora time.Time) error {
	itens, err := os.ReadDir(destino)
	if err != nil {
		return fmt.Errorf("copia: ler %s: %w", destino, err)
	}
	hoje := diaCivil(agora)
	limite := hoje.AddDate(0, 0, -diasGuardados)
	var primeiro error
	for _, i := range itens {
		m := nomeDeCopia.FindStringSubmatch(i.Name())
		if m == nil || i.IsDir() {
			continue
		}
		dia, err := time.Parse("2006-01-02", m[1])
		if err != nil || !dia.Before(limite) {
			continue
		}
		if err := os.Remove(filepath.Join(destino, i.Name())); err != nil && primeiro == nil {
			primeiro = fmt.Errorf("copia: apagar %s: %w", i.Name(), err)
		}
	}
	return primeiro
}

// diaCivil é o dia de t à meia-noite em UTC, para contar dias sem se perder em fusos.
func diaCivil(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
