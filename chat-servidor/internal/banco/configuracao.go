package banco

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
)

// As chaves da tabela configuracao.
const (
	chaveVideoEndereco  = "video_endereco"
	chaveVideoChave     = "video_chave"
	chaveLimiteReunioes = "limite_reunioes"
)

// Os limites de reuniões ao mesmo tempo (docs/chat-protocolo.md, seção 12).
const (
	limitePadrao = 2
	limiteMinimo = 1
	limiteMaximo = 20
)

// ConfigReunioes é a configuração das reuniões: o servidor de vídeo (o endereço e a chave do
// agente) e quantas reuniões podem acontecer ao mesmo tempo.
type ConfigReunioes struct {
	Endereco, Chave string
	Limite          int
}

// ConfigReunioes lê a configuração. O que não foi guardado vem vazio, e o Limite vem 2.
func (b *Banco) ConfigReunioes(ctx context.Context) (ConfigReunioes, error) {
	linhas, err := b.db.QueryContext(ctx, `SELECT chave, valor FROM configuracao`)
	if err != nil {
		return ConfigReunioes{}, err
	}
	defer linhas.Close()
	c := ConfigReunioes{Limite: limitePadrao}
	for linhas.Next() {
		var chave, valor string
		if err := linhas.Scan(&chave, &valor); err != nil {
			return ConfigReunioes{}, err
		}
		switch chave {
		case chaveVideoEndereco:
			c.Endereco = valor
		case chaveVideoChave:
			c.Chave = valor
		case chaveLimiteReunioes:
			if n, err := strconv.Atoi(valor); err == nil && n >= limiteMinimo && n <= limiteMaximo {
				c.Limite = n
			}
		}
	}
	return c, linhas.Err()
}

func guardar(ctx context.Context, tx *sql.Tx, chave, valor string) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO configuracao (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`,
		chave, valor)
	return err
}

// GuardarServidorVideo guarda o endereço e a chave do servidor de vídeo, juntos. Vazios, o
// servidor deixa de estar configurado.
func (b *Banco) GuardarServidorVideo(ctx context.Context, endereco, chave string) error {
	return b.Tx(ctx, func(tx *sql.Tx) error {
		if err := guardar(ctx, tx, chaveVideoEndereco, endereco); err != nil {
			return err
		}
		return guardar(ctx, tx, chaveVideoChave, chave)
	})
}

// GuardarLimiteReunioes guarda quantas reuniões podem acontecer ao mesmo tempo, de 1 a 20.
func (b *Banco) GuardarLimiteReunioes(ctx context.Context, n int) error {
	if n < limiteMinimo || n > limiteMaximo {
		return fmt.Errorf("banco: o limite de reuniões é de %d a %d, não %d", limiteMinimo, limiteMaximo, n)
	}
	return b.Tx(ctx, func(tx *sql.Tx) error { return guardar(ctx, tx, chaveLimiteReunioes, strconv.Itoa(n)) })
}
