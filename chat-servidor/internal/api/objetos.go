package api

import (
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/reunioes"
)

// Os objetos JSON da seção 4 do protocolo, definidos uma vez para todas as rotas e
// eventos. A Pessoa fica em pessoas.go.

// arquivoJSON é o Arquivo.
type arquivoJSON struct {
	ID        string `json:"id"`
	Nome      string `json:"nome"`
	Tipo      string `json:"tipo"`
	Tamanho   int64  `json:"tamanho"`
	Foto      bool   `json:"foto"`
	Miniatura bool   `json:"miniatura"`
	Expirado  bool   `json:"expirado"`
}

func novoArquivoJSON(a banco.Arquivo) arquivoJSON {
	return arquivoJSON{ID: a.ID, Nome: a.Nome, Tipo: a.Tipo, Tamanho: a.Tamanho,
		Foto: a.Foto, Miniatura: a.Miniatura, Expirado: a.Expirado}
}

// avisoJSON é o aviso de uma mensagem do tipo aviso. O alvo é null no criou e no saiu.
type avisoJSON struct {
	Acao string      `json:"acao"`
	Quem pessoaJSON  `json:"quem"`
	Alvo *pessoaJSON `json:"alvo"`
}

// mensagemJSON é a Mensagem. O texto só vem no tipo texto, o arquivo no tipo arquivo e o
// aviso no tipo aviso; o idLocal é null se a mensagem não tem.
type mensagemJSON struct {
	ID       int64        `json:"id"`
	Conversa int64        `json:"conversa"`
	Autor    *pessoaJSON  `json:"autor"`
	Tipo     string       `json:"tipo"`
	Texto    *string      `json:"texto,omitempty"`
	Arquivo  *arquivoJSON `json:"arquivo,omitempty"`
	Aviso    *avisoJSON   `json:"aviso,omitempty"`
	IDLocal  *string      `json:"idLocal"`
	CriadaEm int64        `json:"criadaEm"`
}

func pessoaOuNil(p *banco.Pessoa) *pessoaJSON {
	if p == nil {
		return nil
	}
	j := novaPessoaJSON(*p)
	return &j
}

func novaMensagemJSON(m banco.Mensagem) mensagemJSON {
	j := mensagemJSON{ID: m.ID, Conversa: m.ConversaID, Autor: pessoaOuNil(m.Autor), Tipo: m.Tipo, CriadaEm: m.CriadaEm}
	if m.IDLocal != "" {
		id := m.IDLocal
		j.IDLocal = &id
	}
	switch m.Tipo {
	case "texto":
		t := m.Texto
		j.Texto = &t
	case "arquivo":
		if m.Arquivo != nil {
			a := novoArquivoJSON(*m.Arquivo)
			j.Arquivo = &a
		}
	case "aviso":
		av := avisoJSON{Acao: m.AvisoAcao, Alvo: pessoaOuNil(m.AvisoAlvo)}
		if m.Autor != nil {
			av.Quem = novaPessoaJSON(*m.Autor)
		}
		j.Aviso = &av
	}
	return j
}

// conversaJSON é a Conversa. Os campos com, e nome/pessoas/cuida, são de um tipo só; os
// ponteiros deixam o cuida false (e as pessoas) aparecerem no grupo.
type conversaJSON struct {
	ID           int64         `json:"id"`
	Tipo         string        `json:"tipo"`
	Com          *pessoaJSON   `json:"com,omitempty"`
	Nome         *string       `json:"nome,omitempty"`
	Pessoas      *int          `json:"pessoas,omitempty"`
	Cuida        *bool         `json:"cuida,omitempty"`
	Ultima       *mensagemJSON `json:"ultima"`
	NaoLidas     int           `json:"naoLidas"`
	AtualizadaEm int64         `json:"atualizadaEm"`
}

func novaConversaJSON(c banco.ResumoConversa) conversaJSON {
	j := conversaJSON{ID: c.ID, Tipo: c.Tipo, NaoLidas: c.NaoLidas, AtualizadaEm: c.AtualizadaEm}
	if c.Tipo == "dupla" {
		j.Com = pessoaOuNil(c.Com)
	} else {
		nome, pessoas, cuida := c.Nome, c.Pessoas, c.Cuida
		j.Nome, j.Pessoas, j.Cuida = &nome, &pessoas, &cuida
	}
	if c.Ultima != nil {
		u := novaMensagemJSON(*c.Ultima)
		j.Ultima = &u
	}
	return j
}

// reuniaoJSON é a Reunião da seção 9 do protocolo. O assunto, o inicio e o valeAte são null quando a reunião não
// os tem (a naHora não tem inicio nem valeAte).
type reuniaoJSON struct {
	Codigo      string  `json:"codigo"`
	Link        string  `json:"link"`
	Tipo        string  `json:"tipo"`
	Assunto     *string `json:"assunto"`
	Inicio      *int64  `json:"inicio"`
	ValeAte     *int64  `json:"valeAte"`
	CriouEu     bool    `json:"criouEu"`
	Acontecendo bool    `json:"acontecendo"`
	Pessoas     int     `json:"pessoas"`
}

// novaReuniaoJSON monta a Reunião como a pessoa eu a vê (eu 0 é ninguém: o criouEu fica falso). O acontecendo e o
// pessoas vêm do gerente, e o link é base + "/r/" + código.
func novaReuniaoJSON(r banco.Reuniao, base string, eu int64, g *reunioes.Gerente) reuniaoJSON {
	j := reuniaoJSON{Codigo: r.Codigo, Link: base + "/r/" + r.Codigo, Tipo: r.Tipo,
		CriouEu: eu != 0 && r.CriouID == eu}
	if r.Assunto != "" {
		a := r.Assunto
		j.Assunto = &a
	}
	if r.Tipo == banco.TipoMarcada {
		inicio, valeAte := r.Inicio, r.ValeAte
		j.Inicio, j.ValeAte = &inicio, &valeAte
	}
	j.Acontecendo, j.Pessoas = g.Contagem(r.Sala)
	return j
}
