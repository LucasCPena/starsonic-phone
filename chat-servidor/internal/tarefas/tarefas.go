// Package tarefas faz o trabalho diário do servidor: expira os arquivos de mais de 365 dias,
// apaga os que nunca entraram numa mensagem e varre do disco o que sobrou.
//
// Aqui se apaga dado de cliente, então a ordem importa: um arquivo em uso nunca sai, e um
// vencido não fica. Nenhum log leva o nome do arquivo, só o id.
package tarefas

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

const (
	validade    = 365 * 24 * time.Hour // um arquivo vale por 365 dias
	semMensagem = 24 * time.Hour       // e um que não entrou numa mensagem, por 24 h
	horaRodada  = 4                    // a rodada diária é às 04:00 de America/Sao_Paulo
)

// Expirar faz uma rodada: expira os arquivos de mais de 365 dias (marca no banco e depois
// apaga do disco), apaga os que ficaram mais de 24 h sem mensagem e varre o disco. Devolve
// quantos expirou e quantos limpou. Um erro de disco num arquivo vai para o log e a rodada
// segue; um erro de banco é devolvido no fim, depois de tentar o resto.
func Expirar(ctx context.Context, b *banco.Banco, a *armazem.Armazem) (expirados, limpos int, err error) {
	agora := b.Relogio().Agora()
	var erros []error

	// 1. Os de mais de 365 dias: marca primeiro, depois tira do disco.
	ids, err := b.ArquivosParaExpirar(ctx, agora.Add(-validade).UnixMilli())
	if err != nil {
		return 0, 0, err
	}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return expirados, limpos, err
		}
		marcou, err := b.MarcarExpirado(ctx, id)
		if err != nil {
			slog.Error("tarefas: não marcou o arquivo como expirado", "id", id, "erro", err)
			erros = append(erros, err)
			continue
		}
		if !marcou {
			continue
		}
		expirados++
		if err := a.Apagar(id); err != nil {
			// Fica a linha expirada; a varredura tenta de novo na próxima rodada.
			slog.Error("tarefas: não apagou o arquivo expirado do disco", "id", id, "erro", err)
		}
	}

	// 2. Os que nunca entraram numa mensagem: apaga a linha primeiro, e só mexe no disco se
	// ela saiu (uma mensagem pode ter chegado no meio).
	ids, err = b.ArquivosSemMensagem(ctx, agora.Add(-semMensagem).UnixMilli())
	if err != nil {
		return expirados, limpos, errors.Join(append(erros, err)...)
	}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return expirados, limpos, err
		}
		apagou, err := b.ApagarArquivo(ctx, id)
		if err != nil {
			slog.Error("tarefas: não apagou a linha do arquivo sem mensagem", "id", id, "erro", err)
			erros = append(erros, err)
			continue
		}
		if !apagou {
			continue
		}
		limpos++
		if err := a.Apagar(id); err != nil {
			// Sem linha, o arquivo vira órfão; a varredura o pega depois das 24 h.
			slog.Error("tarefas: não apagou o arquivo sem mensagem do disco", "id", id, "erro", err)
		}
	}

	// 3. A varredura do disco.
	n, err := varrer(ctx, b, a)
	limpos += n
	if err != nil {
		erros = append(erros, err)
	}
	return expirados, limpos, errors.Join(erros...)
}

// varrer anda pela pasta dos arquivos e tira o que não deve ficar: temporários e órfãos com
// mais de 24 h, miniaturas sem miniatura marcada com mais de 24 h, e tudo o que é de um
// arquivo expirado. Não segue links simbólicos nem sai da pasta; o que não tem cara de
// arquivo do armazém fica, com uma linha no log.
func varrer(ctx context.Context, b *banco.Banco, a *armazem.Armazem) (removidos int, err error) {
	raiz := a.Pasta()
	agora := b.Relogio().Agora()
	velho := func(info os.FileInfo) bool { return agora.Sub(info.ModTime()) > semMensagem }

	subs, err := os.ReadDir(raiz)
	if err != nil {
		return 0, err
	}
	var erros []error
	for _, sub := range subs {
		if err := ctx.Err(); err != nil {
			return removidos, err
		}
		if !sub.IsDir() || !prefixoValido(sub.Name()) { // IsDir é falso para link simbólico
			slog.Warn("tarefas: item estranho na pasta dos arquivos, deixado como está", "item", "raiz")
			continue
		}
		pasta := filepath.Join(raiz, sub.Name())
		itens, err := os.ReadDir(pasta)
		if err != nil {
			slog.Error("tarefas: não leu uma subpasta dos arquivos", "subpasta", sub.Name(), "erro", err)
			erros = append(erros, err)
			continue
		}
		for _, it := range itens {
			if err := ctx.Err(); err != nil {
				return removidos, err
			}
			nome := it.Name()
			if !it.Type().IsRegular() { // pasta, link simbólico, dispositivo...
				slog.Warn("tarefas: item estranho na subpasta dos arquivos, deixado como está", "subpasta", sub.Name())
				continue
			}
			info, err := it.Info()
			if err != nil {
				if !errors.Is(err, os.ErrNotExist) {
					slog.Error("tarefas: não leu um arquivo da pasta", "subpasta", sub.Name(), "erro", err)
				}
				continue
			}
			caminho := filepath.Join(pasta, nome)

			if strings.HasPrefix(nome, ".tmp-") {
				if velho(info) {
					remover(caminho, "", &removidos, &erros)
				}
				continue
			}
			id, mini := strings.CutSuffix(nome, ".mini")
			if !armazem.IDValido(id) || id[:2] != sub.Name() {
				slog.Warn("tarefas: nome estranho na subpasta dos arquivos, deixado como está", "subpasta", sub.Name())
				continue
			}
			existe, expirado, temMini, err := b.EstadoArquivo(ctx, id)
			if err != nil {
				slog.Error("tarefas: não consultou o arquivo", "id", id, "erro", err)
				erros = append(erros, err)
				continue
			}
			apagar := false
			switch {
			case !existe:
				apagar = velho(info) // órfão
			case expirado:
				apagar = true // o prazo acabou: a idade não conta
			case mini && !temMini:
				apagar = velho(info) // miniatura que a linha não conhece
			}
			if apagar {
				remover(caminho, id, &removidos, &erros)
			}
		}
	}
	return removidos, errors.Join(erros...)
}

// prefixoValido diz se o nome de uma subpasta é o começo (2 hexadecimais) de um id.
func prefixoValido(nome string) bool {
	return len(nome) == 2 && armazem.IDValido(nome+strings.Repeat("0", 30))
}

// remover apaga um arquivo da varredura. Um erro vai para o log (com o id, se houver) e a
// varredura segue.
func remover(caminho, id string, removidos *int, erros *[]error) {
	if err := os.Remove(caminho); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Error("tarefas: não removeu um arquivo da varredura", "id", id, "erro", err)
			*erros = append(*erros, err)
		}
		return
	}
	*removidos++
}

// proximaRodada devolve a primeira 04:00 de America/Sao_Paulo estritamente depois de agora:
// às 04:00 em ponto, é a do dia seguinte.
func proximaRodada(agora time.Time) time.Time {
	fuso := tempo.Fuso()
	l := agora.In(fuso)
	p := time.Date(l.Year(), l.Month(), l.Day(), horaRodada, 0, 0, 0, fuso)
	if !p.After(agora) {
		p = time.Date(l.Year(), l.Month(), l.Day()+1, horaRodada, 0, 0, 0, fuso)
	}
	return p
}

// Rodar faz uma rodada ao começar e depois uma todo dia às 04:00 de America/Sao_Paulo, até o
// ctx acabar. Volta logo que o ctx acaba, mesmo no meio da espera.
func Rodar(ctx context.Context, b *banco.Banco, a *armazem.Armazem) {
	for {
		expirados, limpos, err := Expirar(ctx, b, a)
		if err != nil {
			slog.Error("tarefas: a rodada teve erro", "expirados", expirados, "limpos", limpos, "erro", err)
		} else {
			slog.Info("tarefas: rodada feita", "expirados", expirados, "limpos", limpos)
		}
		agora := b.Relogio().Agora()
		espera := proximaRodada(agora).Sub(agora)
		t := time.NewTimer(espera)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}
