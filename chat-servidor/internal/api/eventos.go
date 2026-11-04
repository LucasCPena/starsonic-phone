package api

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

// duracaoBilhete é quanto um bilhete vale (seção 7 do protocolo).
const duracaoBilhete = 30 * time.Second

// bilhetes guarda os bilhetes do WebSocket na memória, só pelo SHA-256 (ruling R1). Cada um
// vale uma vez, por 30 s do relógio. Um reinício perde os que esperavam: o app pede outro.
type bilhetes struct {
	relogio tempo.Relogio

	mu       sync.Mutex
	porHash  map[string]bilhete // a chave é o SHA-256 do bilhete
	varreuEm time.Time
}

type bilhete struct {
	computador int64
	vence      time.Time
}

func novosBilhetes(r tempo.Relogio) *bilhetes {
	return &bilhetes{relogio: r, porHash: map[string]bilhete{}, varreuEm: r.Agora()}
}

// novo cria um bilhete para o computador.
func (b *bilhetes) novo(computadorID int64) string {
	s := segredo.NovoBilhete()
	agora := b.relogio.Agora()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.varrer(agora)
	b.porHash[string(segredo.Hash(s))] = bilhete{computador: computadorID, vence: agora.Add(duracaoBilhete)}
	return s
}

// usar gasta o bilhete e devolve o computador dele. O bilhete sai na primeira tentativa,
// mesmo vencido.
func (b *bilhetes) usar(s string) (computadorID int64, ok bool) {
	h := string(segredo.Hash(s))
	agora := b.relogio.Agora()
	b.mu.Lock()
	defer b.mu.Unlock()
	x, ok := b.porHash[h]
	delete(b.porHash, h)
	if !ok || !agora.Before(x.vence) {
		return 0, false
	}
	return x.computador, true
}

// varrer tira da memória os bilhetes vencidos, no máximo uma vez a cada 30 s. Com b.mu
// travado.
func (b *bilhetes) varrer(agora time.Time) {
	if agora.Sub(b.varreuEm) < duracaoBilhete {
		return
	}
	b.varreuEm = agora
	for h, x := range b.porHash {
		if !agora.Before(x.vence) {
			delete(b.porHash, h)
		}
	}
}

// POST /api/v1/eventos/bilhete: um bilhete para abrir o WebSocket.
func (s *servidor) novoBilhete(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	escreverJSON(w, http.StatusOK, map[string]any{"bilhete": s.bilhetes.novo(c.ID)})
}

// GET /api/v1/eventos?bilhete=…: o WebSocket dos eventos.
func (s *servidor) eventos(w http.ResponseWriter, r *http.Request) {
	// Com Origin (o navegador sempre manda), só uma das origens do CORS, exatamente, e antes
	// de gastar o bilhete. Sem Origin (o núcleo do app, os testes), o bilhete basta.
	if o := r.Header.Get("Origin"); o != "" && !s.origens[o] {
		escreverErro(w, http.StatusForbidden, "proibido", nil)
		return
	}
	id, ok := s.bilhetes.usar(r.URL.Query().Get("bilhete"))
	if !ok {
		escreverErro(w, http.StatusUnauthorized, "chave", nil)
		return
	}

	// O computador entra no hub antes de o banco ser lido. Um Fora daqui em diante fecha
	// esta conexão; um de antes veio depois da saída marcada no banco, e a leitura abaixo
	// recusa o computador.
	res := s.hub.Reservar(id)
	defer res.Desistir() // depois do Servir, não faz nada
	soltar := s.travar(id)
	c, err := s.banco.ComputadorAtivo(r.Context(), id)
	if err == nil {
		res.DefinirPessoa(c.PessoaID)
	}
	soltar()
	if errors.Is(err, banco.ErrNaoEncontrado) {
		escreverErro(w, http.StatusUnauthorized, "chave", nil) // saiu depois do bilhete
		return
	}
	if err != nil {
		erroServidor(w)
		return
	}

	// A origem já foi conferida acima. Os padrões são as mesmas origens, escapadas, e
	// casam só com elas; assim o Accept não recusa o que já passou.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.padroes})
	if err != nil {
		return // o Accept já respondeu
	}
	res.Servir(r.Context(), conn)
}

// padraoExato faz da origem um padrão do path.Match (as OriginPatterns do coder/websocket)
// que casa só com ela: escapa o *, o ?, o [ e a \ (os colchetes de um IPv6 seriam uma
// classe). Com "://" no padrão, o coder/websocket compara com o "esquema://host" do Origin,
// que é a própria origem.
func padraoExato(origem string) string {
	var b strings.Builder
	for _, r := range origem {
		if strings.ContainsRune(`*?[\`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}
