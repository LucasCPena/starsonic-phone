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

// limiteSemLinha é o máximo de arquivos sem linha no banco que uma rodada apaga. Mais que isso,
// ou com a tabela vazia, é sinal de banco trocado ou perdido, e a varredura não apaga nada
// desse tipo. É variável só para o teste baixá-lo.
var limiteSemLinha = 1000

// Expirar faz uma rodada: expira os arquivos de mais de 365 dias (marca no banco e depois
// apaga do disco), apaga os que ficaram mais de 24 h sem mensagem e varre o disco. Devolve
// quantos expirou e quantos limpou. Um erro de disco ou de banco num arquivo, ou numa consulta,
// vai para o log e para o erro da rodada (juntos, no fim), e a rodada segue com o resto; só o
// cancelamento do ctx a interrompe, devolvendo o que já tinha.
func Expirar(ctx context.Context, b *banco.Banco, a *armazem.Armazem) (expirados, limpos int, err error) {
	agora := b.Relogio().Agora()
	var erros []error
	parou := func() (int, int, error) { return expirados, limpos, errors.Join(append(erros, ctx.Err())...) }

	// 1. Os de mais de 365 dias: marca primeiro, depois tira do disco.
	ids, err := b.ArquivosParaExpirar(ctx, agora.Add(-validade).UnixMilli())
	if err != nil {
		slog.Error("tarefas: não listou os arquivos para expirar", "erro", err)
		erros = append(erros, err)
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return parou()
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
			// A linha já está expirada; a varredura desta rodada tenta de novo.
			slog.Error("tarefas: não apagou o arquivo expirado do disco", "id", id, "erro", err)
			erros = append(erros, err)
		}
	}

	// 2. Os que nunca entraram numa mensagem.
	ids, err = b.ArquivosSemMensagem(ctx, agora.Add(-semMensagem).UnixMilli())
	if err != nil {
		slog.Error("tarefas: não listou os arquivos sem mensagem", "erro", err)
		erros = append(erros, err)
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return parou()
		}
		apagou, err := limparSemMensagem(ctx, b, a, id)
		if apagou {
			limpos++
		}
		if err != nil {
			erros = append(erros, err)
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

// limparSemMensagem apaga um arquivo que nenhuma mensagem usa: a linha primeiro, num comando
// que confere a mensagem, e só se a linha saiu mexe no disco (uma mensagem pode ter chegado
// depois da consulta). Devolve se a linha saiu; o erro, se houver, é de banco ou de disco.
func limparSemMensagem(ctx context.Context, b *banco.Banco, a *armazem.Armazem, id string) (bool, error) {
	apagou, err := b.ApagarArquivo(ctx, id)
	if err != nil {
		slog.Error("tarefas: não apagou a linha do arquivo sem mensagem", "id", id, "erro", err)
		return false, err
	}
	if !apagou {
		return false, nil
	}
	if err := a.Apagar(id); err != nil {
		// Sem linha, o arquivo vira órfão; a varredura o pega depois das 24 h.
		slog.Error("tarefas: não apagou o arquivo sem mensagem do disco", "id", id, "erro", err)
		return true, err
	}
	return true, nil
}

// candidato é um arquivo do disco que a varredura quer apagar.
type candidato struct {
	caminho, id string
	semLinha    bool // não há linha no banco para ele
}

// varrer anda pela pasta dos arquivos e tira o que não deve ficar: temporários e órfãos com
// mais de 24 h, miniaturas sem miniatura marcada com mais de 24 h, e tudo o que é de um
// arquivo expirado. Não segue links simbólicos nem sai da pasta; o que não tem cara de
// arquivo do armazém fica, com uma linha no log. Os que não têm linha no banco só saem com a
// tabela não vazia e até limiteSemLinha por rodada. Devolve quantos apagou.
func varrer(ctx context.Context, b *banco.Banco, a *armazem.Armazem) (removidos int, err error) {
	raiz := a.Pasta()
	agora := b.Relogio().Agora()
	velho := func(info os.FileInfo) bool { return agora.Sub(info.ModTime()) > semMensagem }

	subs, err := os.ReadDir(raiz)
	if err != nil {
		return 0, err
	}
	var erros []error
	var apagar []candidato
	for _, sub := range subs {
		if ctx.Err() != nil {
			return 0, errors.Join(append(erros, ctx.Err())...)
		}
		if !sub.IsDir() || !armazem.SubpastaValida(sub.Name()) { // IsDir é falso para link simbólico
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
			if ctx.Err() != nil {
				return 0, errors.Join(append(erros, ctx.Err())...)
			}
			if !it.Type().IsRegular() { // pasta, link simbólico, dispositivo...
				slog.Warn("tarefas: item estranho na subpasta dos arquivos, deixado como está", "subpasta", sub.Name())
				continue
			}
			tipo, id := armazem.Classificar(sub.Name(), it.Name())
			if tipo == armazem.TipoEstranho {
				slog.Warn("tarefas: nome estranho na subpasta dos arquivos, deixado como está", "subpasta", sub.Name())
				continue
			}
			info, err := it.Info()
			if err != nil {
				if !errors.Is(err, os.ErrNotExist) {
					slog.Error("tarefas: não leu um arquivo da pasta", "subpasta", sub.Name(), "erro", err)
					erros = append(erros, err)
				}
				continue
			}
			caminho := filepath.Join(pasta, it.Name())

			if tipo == armazem.TipoTemporario {
				if velho(info) {
					apagar = append(apagar, candidato{caminho: caminho})
				}
				continue
			}
			existe, expirado, temMini, err := b.EstadoArquivo(ctx, id)
			if err != nil {
				slog.Error("tarefas: não consultou o arquivo", "id", id, "erro", err)
				erros = append(erros, err)
				continue
			}
			switch {
			case !existe:
				if velho(info) { // órfão
					apagar = append(apagar, candidato{caminho, id, true})
				}
			case expirado: // o prazo acabou: a idade não conta
				apagar = append(apagar, candidato{caminho: caminho, id: id})
			case tipo == armazem.TipoMiniatura && !temMini && velho(info): // miniatura que a linha não conhece
				apagar = append(apagar, candidato{caminho: caminho, id: id})
			}
		}
	}

	// A guarda do banco vazio ou trocado: muitos arquivos sem linha não se apagam.
	semLinha := 0
	for _, c := range apagar {
		if c.semLinha {
			semLinha++
		}
	}
	segurar := false
	if semLinha > 0 {
		n, err := b.ContarArquivos(ctx)
		switch {
		case err != nil:
			slog.Error("tarefas: não contou os arquivos do banco; os sem linha ficam", "erro", err)
			erros = append(erros, err)
			segurar = true
		case n == 0 || semLinha > limiteSemLinha:
			slog.Error("tarefas: nenhum arquivo sem linha foi apagado; confira o banco de dados",
				"semLinha", semLinha, "linhasNoBanco", n)
			segurar = true
		}
	}
	for _, c := range apagar {
		if c.semLinha && segurar {
			continue
		}
		remover(c.caminho, c.id, &removidos, &erros)
	}
	return removidos, errors.Join(erros...)
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
		if errors.Is(err, context.Canceled) {
			slog.Info("tarefas: rodada interrompida", "expirados", expirados, "limpos", limpos)
		} else if err != nil {
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
