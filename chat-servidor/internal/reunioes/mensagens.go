package reunioes

import "github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"

// O chat da reunião (docs/chat-protocolo.md, seção 10): a página manda um texto, e o chat o repassa às páginas da
// mesma reunião, também à de quem escreveu. Quem recebe é quem recebe o palco (recebePalco), e quem pode mandar é quem
// recebe: a regra é uma só. Nada fica guardado: a sala não tem campo para mensagens, e depois de repassar o servidor
// não tem mais o texto. Nada daqui vai ao registro: nem o texto, nem o nome, nem o id.

// mensagemDaReuniao é uma mensagem do chat da reunião, como a página a recebe. O id só vai para quem escreveu, junto
// com o voce: é com ele que a página sabe de qual mensagem dela é a resposta.
type mensagemDaReuniao struct {
	Tipo  string `json:"tipo"`
	ID    string `json:"id,omitempty"`
	De    string `json:"de"`
	Nome  string `json:"nome"`
	Voce  bool   `json:"voce"`
	Texto string `json:"texto"`
}

// Mensagem repassa o texto de quem está na reunião, ou entrando nela, a cada página que recebe o palco, também à de
// quem escreveu, que a recebe com o id. O nome que vai é o do participante na sala, o mesmo do palco, e o texto, o que
// o regras.TextoDaReuniao devolve. Quem manda vem primeiro: sem o pedido aceito, ou com a página fora da reunião
// (recebePalco), o erro é ErrForaDaReuniao, qualquer que seja o texto. O texto que não vale dá o erro do
// regras.TextoDaReuniao (o regras.ErrTextoGrande ou o *regras.Erro), e ninguém recebe nada.
func (g *Gerente) Mensagem(p *Pedido, id, texto string) error {
	if p == nil {
		return ErrForaDaReuniao
	}
	limpo, errTexto := regras.TextoDaReuniao(texto) // fora da trava: é só uma conta
	g.mu.Lock()
	s, part := g.aceitoDe(p)
	if part == nil || !part.recebePalco() {
		g.mu.Unlock()
		return ErrForaDaReuniao
	}
	if errTexto != nil {
		g.mu.Unlock()
		return errTexto
	}
	// O repasse entra na saída na mesma trava que conferiu quem manda e quem recebe: uma página que sai agora não
	// recebe a mensagem depois de ter saído.
	for _, d := range s.paginasAceitas() {
		m := mensagemDaReuniao{Tipo: "mensagem", De: part.id, Nome: part.nome, Voce: d == part, Texto: limpo}
		if d == part {
			m.ID = id
		}
		g.mandar(d.pedido.canal, m)
	}
	g.mu.Unlock()
	g.despachar()
	return nil
}
