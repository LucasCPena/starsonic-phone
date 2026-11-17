package reunioes

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/video/videotest"
)

// ---------- O log de todo o pacote (TestSemNomesNoLog) ----------

// bufferSeguro recebe o slog de todo o pacote: o gerente escreve nele de várias goroutines.
type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *bufferSeguro) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *bufferSeguro) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

var (
	// registro guarda o log de todos os testes do pacote: o TestMain o põe no slog.
	registro = &bufferSeguro{}

	segredosMu sync.Mutex
	// segredos é o que os testes usaram e que nunca pode chegar ao log: os nomes, os ramais (o EntrarColega recebe
	// o da pessoa), o código da empresa, os códigos e as salas das reuniões, os participantes, os pedidos e as
	// senhas. Para os ramais valerem aqui, o registro não leva a hora, onde quatro algarismos aparecem por acaso.
	segredos = map[string]bool{}
	// exigirLog: o TestSemNomesNoLog passou pelas linhas de log do gerente, então no fim o log não pode estar vazio.
	exigirLog bool
)

// anotar guarda os textos que nunca podem aparecer no log.
func anotar(textos ...string) {
	segredosMu.Lock()
	defer segredosMu.Unlock()
	for _, s := range textos {
		if s != "" {
			segredos[s] = true
		}
	}
}

// semHora tira a hora de cada linha do registro.
func semHora(grupos []string, a slog.Attr) slog.Attr {
	if a.Key == slog.TimeKey && len(grupos) == 0 {
		return slog.Attr{}
	}
	return a
}

// TestMain põe o log de todos os testes do pacote no registro e, depois de todos, confere que nele não há nenhum
// nome, ramal, código, sala, participante ou senha (TestSemNomesNoLog).
func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(registro, &slog.HandlerOptions{Level: slog.LevelDebug,
		ReplaceAttr: semHora})))
	codigo := m.Run()
	if codigo == 0 {
		if err := conferirLog(registro.String()); err != nil {
			fmt.Fprintln(os.Stderr, "--- FAIL: TestSemNomesNoLog (o log de todos os testes do pacote):", err)
			fmt.Fprintln(os.Stderr, "FAIL")
			codigo = 1
		}
	}
	os.Exit(codigo)
}

// conferirLog diz se o log tem algum segredo, ou se devia ter as linhas do gerente e está sem elas.
func conferirLog(texto string) error {
	segredosMu.Lock()
	defer segredosMu.Unlock()
	if exigirLog && !strings.Contains(texto, "reunioes:") {
		return errors.New("o gerente não registrou nada, e a conferência não valeria")
	}
	var achados []string
	for s := range segredos {
		if strings.Contains(texto, s) {
			achados = append(achados, s)
		}
	}
	if len(achados) > 0 {
		sort.Strings(achados)
		return fmt.Errorf("o log tem %d segredo(s) dos testes: %q", len(achados), achados)
	}
	return nil
}

// ---------- Os falsos ----------

// avisosFalsos guarda os eventos mandados aos apps, já em JSON.
type avisosFalsos struct {
	mu    sync.Mutex
	lista []avisoVisto
}

type avisoVisto struct {
	para []int64
	ev   map[string]any
}

func emJSON(v any) map[string]any {
	b, err := json.Marshal(v)
	if err != nil {
		return map[string]any{"tipo": "sem JSON: " + err.Error()}
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return map[string]any{"tipo": "não é um objeto: " + string(b)}
	}
	return m
}

func (a *avisosFalsos) ParaComputadores(ids []int64, ev any) {
	m := emJSON(ev)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lista = append(a.lista, avisoVisto{para: slices.Clone(ids), ev: m})
}

// de são os eventos que o computador recebeu, em ordem.
func (a *avisosFalsos) de(computador int64) []map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	var l []map[string]any
	for _, v := range a.lista {
		if slices.Contains(v.para, computador) {
			l = append(l, v.ev)
		}
	}
	return l
}

func (a *avisosFalsos) tiposDe(computador int64) []string {
	var l []string
	for _, ev := range a.de(computador) {
		s, _ := ev["tipo"].(string)
		l = append(l, s)
	}
	return l
}

// ultimo é o último evento do tipo que o computador recebeu (nil sem nenhum).
func (a *avisosFalsos) ultimo(computador int64, tipo string) map[string]any {
	var achado map[string]any
	for _, ev := range a.de(computador) {
		if ev["tipo"] == tipo {
			achado = ev
		}
	}
	return achado
}

func (a *avisosFalsos) total() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.lista)
}

// repetidos diz se algum aviso foi mandado duas vezes ao mesmo computador.
func (a *avisosFalsos) repetidos() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, v := range a.lista {
		ids := slices.Clone(v.para)
		slices.Sort(ids)
		if len(slices.Compact(ids)) != len(v.para) {
			return true
		}
	}
	return false
}

func (a *avisosFalsos) limpar() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lista = nil
}

// canalFalso é a página de quem é de fora: guarda as mensagens, já em JSON, e se foi fechada.
type canalFalso struct {
	mu      sync.Mutex
	msgs    []map[string]any
	fechado bool
	tarde   int // mensagens que chegaram depois do Fechar
}

func (c *canalFalso) Mandar(msg any) {
	m := emJSON(msg)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fechado {
		c.tarde++
	}
	c.msgs = append(c.msgs, m)
}

func (c *canalFalso) Fechar() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fechado = true
}

func (c *canalFalso) mensagens() []map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.msgs)
}

func (c *canalFalso) tipos() []string {
	var l []string
	for _, m := range c.mensagens() {
		s, _ := m["tipo"].(string)
		l = append(l, s)
	}
	return l
}

// conferir confere as mensagens do canal, pelo tipo, e se ele foi fechado (sem nada depois do Fechar).
func (c *canalFalso) conferir(t *testing.T, quem string, tipos []string, fechado bool) {
	t.Helper()
	c.mu.Lock()
	f, tarde := c.fechado, c.tarde
	c.mu.Unlock()
	if got := c.tipos(); !slices.Equal(got, tipos) || f != fechado || tarde != 0 {
		t.Fatalf("o canal de %s recebeu %q (fechado %v, depois do Fechar %d); queria %q (fechado %v)",
			quem, got, f, tarde, tipos, fechado)
	}
}

// videoComErro é o agente falso cujo Tirar e Encerrar anotam o comando e devolvem err.
type videoComErro struct {
	*videotest.Falso
	err error
}

func (v *videoComErro) Tirar(ctx context.Context, sala, participante string) error {
	v.Falso.Tirar(ctx, sala, participante)
	return v.err
}

func (v *videoComErro) Encerrar(ctx context.Context, sala string) error {
	v.Falso.Encerrar(ctx, sala)
	return v.err
}

// videoComPorta é o agente falso num endereço com porta.
type videoComPorta struct{ *videotest.Falso }

func (*videoComPorta) Endereco() string { return "video.exemplo.com.br:8443" }
func (*videoComPorta) WSS() string      { return "wss://video.exemplo.com.br:8443/sip" }

// videoContado é o agente falso que conta os Acompanhar rodando e guarda o f de cada um.
type videoContado struct {
	*videotest.Falso
	mu              sync.Mutex
	rodando, maximo int
	fs              []func(video.Evento)
}

func (v *videoContado) Acompanhar(ctx context.Context, f func(video.Evento)) {
	v.mu.Lock()
	v.rodando++
	v.maximo = max(v.maximo, v.rodando)
	v.fs = append(v.fs, f)
	v.mu.Unlock()
	defer func() {
		v.mu.Lock()
		v.rodando--
		v.mu.Unlock()
	}()
	v.Falso.Acompanhar(ctx, f)
}

func (v *videoContado) contar() (rodando, maximo int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.rodando, v.maximo
}

func (v *videoContado) funcao(i int) func(video.Evento) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.fs[i]
}

// ---------- A cena ----------

var (
	inicioTeste = time.Date(2026, 11, 12, 13, 0, 0, 0, time.UTC) // 1794488400000
	// chaveTeste é a chave do vetor do contrato (os bytes 0 a 31).
	chaveTeste = func() []byte {
		b := make([]byte, 32)
		for i := range b {
			b[i] = byte(i)
		}
		return b
	}()
	hex16 = regexp.MustCompile(`^[0-9a-f]{16}$`)
	hex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// segredoTurnTeste é o segredo do TURN da chaveTeste (o vetor da seção 4 do docs/video-agente.md).
const segredoTurnTeste = "jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4"

type colega struct {
	p          banco.Pessoa
	computador int64
}

type cena struct {
	t                *testing.T
	ctx              context.Context
	b                *banco.Banco
	chat             *tempo.Teste // o relógio do chat
	agente           *tempo.Teste // o relógio do servidor de vídeo (o do falso)
	video            *videotest.Falso
	avisos           *avisosFalsos
	g                *Gerente
	acme             banco.Empresa
	ana, carlos, bia colega
}

// cenaSemVideo é o chat com a ACME e três colegas (a Ana, o Carlos e a Bia), cada um no seu computador, e o
// gerente sem servidor de vídeo.
func cenaSemVideo(t *testing.T) *cena {
	t.Helper()
	chat := tempo.NovoTeste(inicioTeste)
	b, err := banco.Abrir(filepath.Join(t.TempDir(), "chat.db"), chat)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Fechar() })
	c := &cena{t: t, ctx: context.Background(), b: b, chat: chat, agente: tempo.NovoTeste(inicioTeste),
		avisos: &avisosFalsos{}}
	if c.acme, err = b.CriarEmpresa(c.ctx, "ACME Comércio Ltda"); err != nil {
		t.Fatal(err)
	}
	anotar(c.acme.Nome, c.acme.Codigo)
	c.ana = c.colega("2001", "Ana Souza")
	c.carlos = c.colega("2002", "Carlos Lima")
	c.bia = c.colega("2003", "Bia Ramos")
	c.g = Novo(Deps{Banco: b, Avisos: c.avisos, Relogio: chat})
	t.Cleanup(func() { c.g.Ligar(nil) })
	return c
}

// novaCena é a cenaSemVideo com o agente falso ligado e no ar.
func novaCena(t *testing.T) *cena {
	t.Helper()
	c := cenaSemVideo(t)
	c.video = videotest.NovoFalso(chaveTeste, c.agente.Agora)
	c.g.Ligar(c.video)
	return c
}

func (c *cena) colega(ramal, nome string) colega {
	c.t.Helper()
	pc, err := c.b.LigarComputador(c.ctx, c.acme.ID, "PC-"+ramal, segredo.Hash("a chave do "+ramal))
	if err != nil {
		c.t.Fatal(err)
	}
	p, _, err := c.b.EntrarComoPessoa(c.ctx, pc.ID, c.acme.ID, ramal, nome)
	if err != nil {
		c.t.Fatal(err)
	}
	anotar(nome, ramal)
	return colega{p: p, computador: pc.ID}
}

// reiniciar troca o gerente por um novo, com o mesmo banco e o mesmo agente: o chat reiniciou.
func (c *cena) reiniciar() {
	c.g.Ligar(nil)
	c.g = Novo(Deps{Banco: c.b, Avisos: c.avisos, Relogio: c.chat})
	if c.video != nil {
		c.g.Ligar(c.video)
	}
}

// andar anda os dois relógios, o do chat e o do agente.
func (c *cena) andar(d time.Duration) {
	c.chat.Avancar(d)
	c.agente.Avancar(d)
}

func (c *cena) reuniao(r banco.Reuniao) banco.Reuniao {
	c.t.Helper()
	r, err := c.b.CriarReuniao(c.ctx, r)
	if err != nil {
		c.t.Fatal(err)
	}
	anotar(r.Codigo, r.Sala, r.Assunto)
	return r
}

// marcada é uma reunião marcada pela Ana, que começa agora e vale por um dia.
func (c *cena) marcada() banco.Reuniao {
	agora := c.chat.Agora().UnixMilli()
	return c.reuniao(banco.Reuniao{EmpresaID: c.acme.ID, Tipo: banco.TipoMarcada, Assunto: "Planejamento",
		Inicio: agora, ValeAte: agora + (24 * time.Hour).Milliseconds(), CriouID: c.ana.p.ID})
}

// naHora é o "Gerar link" da Ana.
func (c *cena) naHora() banco.Reuniao {
	return c.reuniao(banco.Reuniao{EmpresaID: c.acme.ID, Tipo: banco.TipoNaHora, CriouID: c.ana.p.ID})
}

// deTeste é a reunião de teste da administração, por 2 horas.
func (c *cena) deTeste() banco.Reuniao {
	c.t.Helper()
	r, err := c.b.CriarReuniaoDeTeste(c.ctx, c.chat.Agora().Add(2*time.Hour).UnixMilli())
	if err != nil {
		c.t.Fatal(err)
	}
	anotar(r.Codigo, r.Sala)
	return r
}

// recarregar lê a reunião de novo do banco.
func (c *cena) recarregar(r banco.Reuniao) banco.Reuniao {
	c.t.Helper()
	r, err := c.b.ReuniaoPorCodigo(c.ctx, r.Codigo)
	if err != nil {
		c.t.Fatal(err)
	}
	return r
}

// cancelar é o DELETE de quem criou: o banco cancela, e o gerente fica sabendo.
func (c *cena) cancelar(r banco.Reuniao) {
	c.t.Helper()
	r, err := c.b.CancelarReuniao(c.ctx, c.acme.ID, r.CriouID, r.Codigo)
	if err != nil {
		c.t.Fatal(err)
	}
	c.g.Cancelada(c.ctx, r)
}

func (c *cena) evento(ev video.Evento) {
	anotar(ev.Participante)
	c.g.EventoDoVideo(ev)
}

func (c *cena) entrou(r banco.Reuniao, participante string) {
	c.evento(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: participante})
}

func (c *cena) saiu(r banco.Reuniao, participante string) {
	c.evento(video.Evento{Tipo: "saiu", Sala: r.Sala, Participante: participante})
}

func (c *cena) entrouTela(r banco.Reuniao, participante string) {
	c.evento(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: participante, Tela: true})
}

func (c *cena) acabou(r banco.Reuniao) {
	c.evento(video.Evento{Tipo: "acabou", Sala: r.Sala})
}

// estado é o estado do agente, com o FreeSWITCH no ar.
func (c *cena) estado(salas ...video.Sala) {
	for _, s := range salas {
		for _, p := range s.Participantes {
			anotar(p.Participante)
		}
	}
	if salas == nil {
		salas = []video.Sala{}
	}
	c.g.EventoDoVideo(video.Evento{Tipo: "estado", Agora: c.agente.Agora().UnixMilli(), FreeSWITCH: true, Salas: salas})
}

// salaDoEstado é a sala da reunião no estado, com a câmera de cada participante.
func salaDoEstado(r banco.Reuniao, participantes ...string) video.Sala {
	s := video.Sala{Sala: r.Sala, Participantes: []video.Participante{}}
	for _, p := range participantes {
		s.Participantes = append(s.Participantes, video.Participante{Participante: p})
	}
	return s
}

// entrar é o EntrarColega que tem de dar certo.
func (c *cena) entrar(r banco.Reuniao, k colega) Acesso {
	c.t.Helper()
	a, err := c.g.EntrarColega(c.ctx, r, k.p, k.computador)
	if err != nil {
		c.t.Fatalf("EntrarColega de %s: %v", k.p.Nome, err)
	}
	anotar(a.Participante, a.Senha, a.Turn.Usuario, a.Turn.Senha)
	return a
}

// dentro: o colega pede para entrar e a câmera dele entra (o entrou do agente). Devolve o participante.
func (c *cena) dentro(r banco.Reuniao, k colega) string {
	c.t.Helper()
	a := c.entrar(r, k)
	c.entrou(r, a.Participante)
	return a.Participante
}

// pedir é o Pedir que tem de dar certo, com um canal novo.
func (c *cena) pedir(r banco.Reuniao, nome string) (*Pedido, *canalFalso) {
	c.t.Helper()
	anotar(nome)
	can := &canalFalso{}
	p, err := c.g.Pedir(c.ctx, r, nome, can)
	if err != nil {
		c.t.Fatalf("Pedir de %s: %v", nome, err)
	}
	return p, can
}

// pedidoDe é o id do pedido de nome, na lista que o colega vê.
func (c *cena) pedidoDe(r banco.Reuniao, k colega, nome string) string {
	c.t.Helper()
	l, err := c.g.Lista(r, k.p.ID)
	if err != nil {
		c.t.Fatalf("Lista de %s: %v", k.p.Nome, err)
	}
	for _, p := range l.Pedidos {
		if p.Nome == nome {
			anotar(p.ID)
			return p.ID
		}
	}
	c.t.Fatalf("o pedido de %s não está na lista: %+v", nome, l.Pedidos)
	return ""
}

// aceito: o pedido de nome, aceito pelo colega k (que está na reunião). Devolve o participante de quem foi aceito.
func (c *cena) aceito(r banco.Reuniao, k colega, nome string) (string, *Pedido, *canalFalso) {
	c.t.Helper()
	p, can := c.pedir(r, nome)
	if err := c.g.Aceitar(c.ctx, r, k.p.ID, c.pedidoDe(r, k, nome)); err != nil {
		c.t.Fatalf("Aceitar o pedido de %s: %v", nome, err)
	}
	part, _ := aceitoDe(c.t, can)
	return part, p, can
}

// aceitoDe é o participante e a senha do aceito que o canal recebeu.
func aceitoDe(t *testing.T, can *canalFalso) (participante, senha string) {
	t.Helper()
	for _, m := range can.mensagens() {
		if m["tipo"] == "aceito" {
			participante, _ = m["participante"].(string)
			senha, _ = m["senha"].(string)
			anotar(participante, senha)
			return participante, senha
		}
	}
	t.Fatalf("o canal não recebeu o aceito: %q", can.tipos())
	return "", ""
}

// lerSenha abre a senha de uso único e confere a assinatura com a chave: a carga, assinada de novo, dá a mesma
// senha. É a que o agente aceita (os vetores do contrato valem nos dois lados).
func lerSenha(t *testing.T, texto string) video.Senha {
	t.Helper()
	carga, _, ok := strings.Cut(texto, ".")
	if !ok {
		t.Fatal("a senha não tem a assinatura")
	}
	bs, err := base64.RawURLEncoding.DecodeString(carga)
	if err != nil {
		t.Fatalf("a carga não é base64url: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(bs))
	dec.DisallowUnknownFields()
	var s video.Senha
	if err := dec.Decode(&s); err != nil {
		t.Fatalf("a carga não é a Senha do contrato: %v", err)
	}
	if outra, err := video.AssinarSenha(chaveTeste, s); err != nil || outra != texto {
		t.Fatal("a assinatura da senha não confere com a chave")
	}
	anotar(texto, s.Participante, s.ID)
	return s
}

// nomesNaMemoria são os nomes que o gerente guarda: os dos participantes e os dos pedidos.
func nomesNaMemoria(g *Gerente) []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	var nomes []string
	for _, s := range g.salas {
		for _, p := range s.participantes {
			if p.nome != "" {
				nomes = append(nomes, p.nome)
			}
		}
		for _, p := range s.pedidos {
			nomes = append(nomes, p.nome)
		}
	}
	sort.Strings(nomes)
	return nomes
}

// nomeDoPedido é o nome que o Pedido ainda leva: a página o guarda até o canal fechar, fora da memória do gerente.
func nomeDoPedido(g *Gerente, p *Pedido) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return p.nome
}

// esperar espera ok ficar verdadeiro, por até 5 s (os eventos que o agente falso entrega numa goroutine).
func esperar(t *testing.T, oque string, ok func() bool) {
	t.Helper()
	fim := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(fim) {
			t.Fatalf("esperei 5 s, e não aconteceu: %s", oque)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// pv e pd são o Participante e o Pedido da seção 9 do protocolo, em JSON.
func pv(id, nome string, deFora, tela bool) map[string]any {
	return map[string]any{"id": id, "nome": nome, "deFora": deFora, "tela": tela}
}

func pd(id, nome string) map[string]any { return map[string]any{"id": id, "nome": nome} }

func lista(itens ...map[string]any) []any {
	l := []any{}
	for _, i := range itens {
		l = append(l, i)
	}
	return l
}

func conferirErro(t *testing.T, oque string, err, quer error) {
	t.Helper()
	if !errors.Is(err, quer) {
		t.Fatalf("%s: %v; queria %v", oque, err, quer)
	}
}

// ---------- Os colegas e a senha ----------

func TestColega_Entra(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	a := c.entrar(r, c.ana)

	if !hex16.MatchString(a.Participante) {
		t.Fatalf("participante = %q; queria 16 hexadecimais", a.Participante)
	}
	s := lerSenha(t, a.Senha)
	quer := video.Senha{V: 1, Sala: r.Sala, Participante: a.Participante, Papel: video.Colega, Nome: "Ana Souza",
		Vence: 1794488430000, ID: s.ID} // 13:00:30 UTC: o relógio do agente mais 30 s
	if s != quer || !hex32.MatchString(s.ID) {
		t.Fatalf("a senha é %+v\nqueria %+v, com o id de 32 hexadecimais", s, quer)
	}

	// O TURN vence em 12 h no relógio do agente (13/11, 01:00 UTC), com o segredo que o agente tira da chave.
	usuario := "1794531600:" + a.Participante
	m := hmac.New(sha1.New, []byte(segredoTurnTeste))
	m.Write([]byte(usuario))
	quero := map[string]any{
		"participante": a.Participante,
		"senha":        a.Senha,
		"turn": map[string]any{
			"urls":    []any{"turn:video.exemplo.com.br:3478?transport=udp", "turns:video.exemplo.com.br:5349?transport=tcp"},
			"usuario": usuario,
			"senha":   base64.StdEncoding.EncodeToString(m.Sum(nil)),
		},
		"video": map[string]any{
			"wss": "wss://video.exemplo.com.br/sip",
			"uri": "sip:reuniao@video.exemplo.com.br",
			"sip": "sips:reuniao@video.exemplo.com.br:5061;transport=tls",
		},
	}
	if got := emJSON(a); !reflect.DeepEqual(got, quero) {
		t.Fatalf("o Acesso em JSON é\n%v\nqueria\n%v", got, quero)
	}

	// Cada entrada é um participante novo, com uma senha nova.
	b := c.entrar(r, c.ana)
	if b.Participante == a.Participante || lerSenha(t, b.Senha).ID == s.ID {
		t.Fatal("a segunda entrada repetiu o participante ou o id da senha")
	}

	// O <host> dos endereços é o Endereco sem a porta, e o wss é o do agente, como veio.
	c.g.Ligar(&videoComPorta{Falso: c.video})
	p := c.entrar(r, c.carlos)
	enderecos := Enderecos{WSS: "wss://video.exemplo.com.br:8443/sip", URI: "sip:reuniao@video.exemplo.com.br",
		SIP: "sips:reuniao@video.exemplo.com.br:5061;transport=tls"}
	urls := []string{"turn:video.exemplo.com.br:3478?transport=udp", "turns:video.exemplo.com.br:5349?transport=tcp"}
	if p.Video != enderecos || !slices.Equal(p.Turn.URLs, urls) {
		t.Fatalf("com a porta: %+v, %q", p.Video, p.Turn.URLs)
	}
}

func TestSenha_NoRelogioDoAgente(t *testing.T) {
	c := novaCena(t)
	c.agente.Avancar(2 * time.Minute) // o relógio do vídeo, 2 minutos adiante do do chat
	r := c.marcada()
	a := c.entrar(r, c.ana)
	// 13:02:30 UTC: o relógio do agente mais 30 s. No do chat, seriam 13:00:30, e a senha chegaria vencida.
	if v := lerSenha(t, a.Senha).Vence; v != 1794488550000 {
		t.Fatalf("vence = %d; queria 1794488550000", v)
	}
	if !strings.HasPrefix(a.Turn.Usuario, "1794531720:") { // 13/11, 01:02 UTC
		t.Fatalf("o usuário do TURN é %q", a.Turn.Usuario)
	}
	// Com o relógio do agente 2 minutos atrás do do chat, também.
	c.agente.Avancar(-4 * time.Minute)
	if v := lerSenha(t, c.entrar(r, c.carlos).Senha).Vence; v != 1794488310000 { // 12:58:30 UTC
		t.Fatalf("com o agente atrás, vence = %d; queria 1794488310000", v)
	}
}

func TestColega_SemServidor(t *testing.T) {
	semServidor := func(t *testing.T, c *cena, r banco.Reuniao) {
		t.Helper()
		_, err := c.g.EntrarColega(c.ctx, r, c.ana.p, c.ana.computador)
		conferirErro(t, "EntrarColega", err, ErrSemServidor)
		_, err = c.g.Pedir(c.ctx, r, "Maria Lima", &canalFalso{})
		conferirErro(t, "Pedir", err, ErrSemServidor)
	}
	t.Run("sem o Ligar", func(t *testing.T) {
		c := cenaSemVideo(t)
		semServidor(t, c, c.marcada())
		if c.g.Video() != nil {
			t.Fatal("o Video() devia ser nil")
		}
	})
	t.Run("o agente no ar e o FreeSWITCH fora", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.video.DefinirNoAr(false)
		semServidor(t, c, r)
		c.video.DefinirNoAr(true)
		c.entrar(r, c.ana)
	})
	t.Run("o Ligar(nil) desliga", func(t *testing.T) {
		c := novaCena(t)
		c.g.Ligar(nil)
		semServidor(t, c, c.marcada())
		if c.g.Video() != nil {
			t.Fatal("o Video() devia ser nil depois do Ligar(nil)")
		}
	})
	t.Run("a reunião que não vale vem antes do servidor", func(t *testing.T) {
		c := cenaSemVideo(t)
		r := c.marcada()
		c.cancelar(r)
		r = c.recarregar(r)
		_, err := c.g.EntrarColega(c.ctx, r, c.ana.p, c.ana.computador)
		conferirErro(t, "EntrarColega", err, ErrLinkInvalido)
		_, err = c.g.Pedir(c.ctx, r, "Maria Lima", &canalFalso{})
		conferirErro(t, "Pedir", err, ErrLinkInvalido)
	})
}

// ---------- Os limites ----------

func TestLimite_ServidorCheio(t *testing.T) {
	c := novaCena(t)
	a, b, d, e := c.marcada(), c.marcada(), c.marcada(), c.marcada()
	c.dentro(a, c.ana)
	c.dentro(b, c.carlos)

	// O limite é 2 (o padrão), e duas acontecem: a terceira não começa.
	_, err := c.g.EntrarColega(c.ctx, d, c.bia.p, c.bia.computador)
	conferirErro(t, "a terceira", err, ErrServidorCheio)
	_, err = c.g.Pedir(c.ctx, d, "Maria Lima", &canalFalso{})
	conferirErro(t, "o Pedir na terceira", err, ErrServidorCheio)
	// Entrar numa que já acontece não conta de novo.
	c.entrar(b, c.bia)

	// Uma acaba: a terceira passa.
	c.acabou(a)
	c.entrar(d, c.ana)
	_, err = c.g.EntrarColega(c.ctx, e, c.ana.p, c.ana.computador)
	conferirErro(t, "a quarta, com duas", err, ErrServidorCheio)

	// O limite vem do banco a cada vez: com 3, a quarta passa, sem reiniciar nada.
	if err := c.b.GuardarLimiteReunioes(c.ctx, 3); err != nil {
		t.Fatal(err)
	}
	c.entrar(e, c.ana)
}

func TestLimite_ComecandoSemUsoLibera(t *testing.T) {
	c := novaCena(t)
	if err := c.b.GuardarLimiteReunioes(c.ctx, 1); err != nil {
		t.Fatal(err)
	}
	a, b := c.marcada(), c.marcada()
	c.entrar(a, c.ana) // a senha de um colega, nunca usada: a reunião está "começando"
	cheio := func(oque string) {
		t.Helper()
		_, err := c.g.EntrarColega(c.ctx, b, c.carlos.p, c.carlos.computador)
		conferirErro(t, oque, err, ErrServidorCheio)
	}
	cheio("com a senha nova")

	// A senha vence no relógio do agente, o do vence dela: o do chat não a vence.
	c.chat.Avancar(time.Minute)
	c.g.Varrer()
	cheio("com o relógio do chat 1 minuto adiante")
	c.agente.Avancar(29 * time.Second)
	c.g.Varrer()
	cheio("com 29 s")

	c.agente.Avancar(2 * time.Second)
	c.g.Varrer()
	c.entrar(b, c.carlos) // com 31 s e o Varrer, a vaga volta
}

func TestLimite_Cheia(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	var colegas []colega
	for i := 1; i <= 11; i++ {
		colegas = append(colegas, c.colega(fmt.Sprint(2100+i), fmt.Sprintf("Colega %d", i)))
	}
	cheia := func(oque string) {
		t.Helper()
		_, err := c.g.EntrarColega(c.ctx, r, colegas[10].p, colegas[10].computador)
		conferirErro(t, oque, err, ErrCheia)
		_, err = c.g.Pedir(c.ctx, r, "Maria Lima", &canalFalso{})
		conferirErro(t, oque+", o Pedir", err, ErrCheia)
	}
	var parts []string
	for i := 0; i < 9; i++ {
		parts = append(parts, c.dentro(r, colegas[i]))
	}
	// A tela não conta: com 9 pessoas e uma tela, o 10º ainda entra.
	c.entrouTela(r, parts[0])
	decimo := c.entrar(r, colegas[9])
	// A senha pendente conta: com 9 dentro e a do 10º, o 11º não entra.
	cheia("com a senha do 10º pendente")
	c.entrou(r, decimo.Participante)
	cheia("com 10 na reunião")
	if ac, n := c.g.Contagem(r.Sala); !ac || n != 10 {
		t.Fatalf("Contagem = %v, %d; queria true, 10", ac, n)
	}
	// A câmera do primeiro sai e a tela dele fica: a tela sozinha não segura a vaga, e o 11º entra.
	c.saiu(r, parts[0])
	c.entrar(r, colegas[10])
}

// ---------- Tirar, encerrar e cancelar ----------

func TestTirar(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	maria, pm, canMaria := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)

	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
		t.Fatalf("Tirar: %v", err)
	}
	if cmds := c.video.Comandos(); !slices.Equal(cmds, []string{"tirar " + r.Sala + " " + maria}) {
		t.Fatalf("o agente recebeu %q", cmds)
	}
	canMaria.conferir(t, "Maria", []string{"aguardando", "aceito", "tirado"}, true)
	quer := map[string]any{"tipo": "reuniaoParticipantes", "reuniao": r.Codigo,
		"participantes": lista(pv(ana, "Ana Souza", false, false)), "pedidos": lista()}
	if got := c.avisos.ultimo(c.ana.computador, "reuniaoParticipantes"); !reflect.DeepEqual(got, quer) {
		t.Fatalf("a Ana recebeu %v; queria %v", got, quer)
	}
	// Quem foi tirada não volta pela senha nova, e o pedido que a página guarda não leva mais o nome.
	_, err := c.g.NovaSenha(pm)
	conferirErro(t, "a senha nova de quem foi tirada", err, ErrForaDeOrdem)
	if nome := nomeDoPedido(c.g, pm); nome != "" {
		t.Fatalf("o pedido de quem foi tirada ainda leva o nome %q", nome)
	}

	// Um participante que não está na reunião: 404.
	err = c.g.Tirar(c.ctx, r, c.ana.p.ID, maria)
	conferirErro(t, "tirar de novo", err, ErrParticipanteNaoEncontrado)
	conferirErro(t, "tirar quem não existe", c.g.Tirar(c.ctx, r, c.ana.p.ID, "0011223344556677"),
		ErrParticipanteNaoEncontrado)
	// Quem não está na reunião não tira ninguém.
	conferirErro(t, "o Carlos, fora", c.g.Tirar(c.ctx, r, c.carlos.p.ID, ana), ErrForaDaReuniao)

	// O 404 do agente vale como feito: o participante já tinha saído.
	carlos := c.dentro(r, c.carlos)
	c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrNaoEncontrado})
	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, carlos); err != nil {
		t.Fatalf("com o 404: %v", err)
	}
	if _, n := c.g.Contagem(r.Sala); n != 1 {
		t.Fatalf("com o 404, a reunião tem %d pessoas; queria 1", n)
	}

	// Outro erro volta, e nada muda.
	bia := c.dentro(r, c.bia)
	c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrSemResposta})
	conferirErro(t, "com o agente sem responder", c.g.Tirar(c.ctx, r, c.ana.p.ID, bia), video.ErrSemResposta)
	if _, n := c.g.Contagem(r.Sala); n != 2 {
		t.Fatalf("depois do erro, a reunião tem %d pessoas; queria 2", n)
	}
}

// Quem foi tirado não volta por uma senha que ainda vale no agente (a revisão final, I1 e M1): a da tela, ou uma
// segunda da câmera, pedida antes de entrar. O entrou de um participante que a sala não conhece, numa reunião
// conhecida, não põe ninguém na lista, e o gerente pede ao agente que o tire.
func TestTirar_QuemVoltaComOutraSenha(t *testing.T) {
	for _, caso := range []struct {
		nome string
		tela bool // a senha que ela guarda é a da tela; senão, uma segunda da câmera
	}{
		{"pela senha da tela", true},
		{"por uma senha da câmera de antes do tirar", false},
	} {
		t.Run(caso.nome, func(t *testing.T) {
			c := novaCena(t)
			r := c.marcada()
			ana := c.dentro(r, c.ana)
			maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
			if !caso.tela {
				senha, err := c.g.NovaSenha(pm) // as duas senhas da câmera valem no agente por 30 s
				if err != nil {
					t.Fatalf("NovaSenha: %v", err)
				}
				anotar(senha)
			}
			c.entrou(r, maria)
			if caso.tela {
				senha, err := c.g.TelaDeFora(pm)
				if err != nil {
					t.Fatalf("TelaDeFora: %v", err)
				}
				anotar(senha)
			}
			if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
				t.Fatalf("Tirar: %v", err)
			}
			c.avisos.limpar()

			// Ela liga de novo, com a senha que guardou.
			c.evento(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: maria, Tela: caso.tela})

			tirar := "tirar " + r.Sala + " " + maria
			if cmds := c.video.Comandos(); !slices.Equal(cmds, []string{tirar, tirar}) {
				t.Fatalf("o agente recebeu %q; queria o tirar da Ana e o do gerente", cmds)
			}
			l, err := c.g.Lista(r, c.ana.p.ID)
			if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(ana, "Ana Souza", false, false))) {
				t.Fatalf("Lista = %+v, %v; queria só a Ana", l, err)
			}
			if got := c.avisos.tiposDe(c.ana.computador); len(got) != 0 {
				t.Fatalf("a Ana recebeu %q; a lista não mudou", got)
			}
			if _, n := c.g.Contagem(r.Sala); n != 1 {
				t.Fatalf("a reunião tem %d pessoas; queria 1", n)
			}
		})
	}
}

func TestEncerrar(t *testing.T) {
	t.Run("a marcada para, e o link continua", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, canMaria := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		_, _, canBia := c.aceito(r, c.ana, "Bia Ramos") // aceita, e ainda fora
		_, canCarlos := c.pedir(r, "Carlos Lima")       // esperando

		if err := c.g.Encerrar(c.ctx, r, c.ana.p.ID); err != nil {
			t.Fatalf("Encerrar: %v", err)
		}
		if cmds := c.video.Comandos(); !slices.Equal(cmds, []string{"encerrar " + r.Sala}) {
			t.Fatalf("o agente recebeu %q", cmds)
		}
		canMaria.conferir(t, "Maria", []string{"aguardando", "aceito", "encerrada"}, true)
		canBia.conferir(t, "Bia", []string{"aguardando", "aceito", "encerrada"}, true)
		canCarlos.conferir(t, "quem espera", []string{"aguardando", "naoComecou"}, false)
		if got := c.avisos.ultimo(c.ana.computador, "reuniaoAcabou"); !reflect.DeepEqual(got,
			map[string]any{"tipo": "reuniaoAcabou", "reuniao": r.Codigo}) {
			t.Fatalf("a Ana recebeu %v", got)
		}
		if ac, n := c.g.Contagem(r.Sala); ac || n != 0 {
			t.Fatalf("Contagem = %v, %d", ac, n)
		}
		// A marcada continua valendo: ela recomeça.
		if !c.recarregar(r).Vale(c.chat.Agora().UnixMilli()) {
			t.Fatal("a marcada deixou de valer")
		}
		c.dentro(r, c.ana)
		canCarlos.conferir(t, "quem espera", []string{"aguardando", "naoComecou", "aguardando"}, false)
	})
	t.Run("a naHora acaba", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.dentro(n, c.ana)
		_, can := c.pedir(n, "Maria Lima")
		if err := c.g.Encerrar(c.ctx, n, c.ana.p.ID); err != nil {
			t.Fatalf("Encerrar: %v", err)
		}
		if got := c.recarregar(n); got.AcabouEm != c.chat.Agora().UnixMilli() {
			t.Fatalf("acabou_em = %d", got.AcabouEm)
		}
		can.conferir(t, "quem espera", []string{"aguardando", "linkInvalido"}, true)
		_, err := c.g.EntrarColega(c.ctx, n, c.ana.p, c.ana.computador)
		conferirErro(t, "entrar de novo", err, ErrLinkInvalido)
	})
	t.Run("o próprio servidor encerra", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.entrar(r, c.ana) // só começando: ninguém dentro
		if err := c.g.Encerrar(c.ctx, r, 0); err != nil {
			t.Fatalf("Encerrar pelo servidor: %v", err)
		}
		if cmds := c.video.Comandos(); !slices.Equal(cmds, []string{"encerrar " + r.Sala}) {
			t.Fatalf("o agente recebeu %q", cmds)
		}
	})
	t.Run("o 404 vale como feito", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, can := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrNaoEncontrado})
		if err := c.g.Encerrar(c.ctx, r, c.ana.p.ID); err != nil {
			t.Fatalf("com o 404: %v", err)
		}
		can.conferir(t, "Maria", []string{"aguardando", "aceito", "encerrada"}, true)
	})
	t.Run("outro erro volta, e nada muda", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.dentro(n, c.ana)
		maria, _, can := c.aceito(n, c.ana, "Maria Lima")
		c.entrou(n, maria)
		c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrSemResposta})
		conferirErro(t, "Encerrar", c.g.Encerrar(c.ctx, n, c.ana.p.ID), video.ErrSemResposta)
		can.conferir(t, "Maria", []string{"aguardando", "aceito"}, false)
		if ac, p := c.g.Contagem(n.Sala); !ac || p != 2 {
			t.Fatalf("Contagem = %v, %d", ac, p)
		}
		if c.recarregar(n).AcabouEm != 0 {
			t.Fatal("a naHora acabou, e o agente não encerrou")
		}
	})
}

func TestCancelada(t *testing.T) {
	montar := func(t *testing.T) (*cena, banco.Reuniao, []*canalFalso) {
		c := novaCena(t)
		r := c.marcada()
		c.dentro(r, c.ana)
		maria, _, canMaria := c.aceito(r, c.ana, "Maria Lima")
		c.entrou(r, maria)
		_, _, canBia := c.aceito(r, c.ana, "Bia Ramos") // aceita, e ainda fora
		_, canCarlos := c.pedir(r, "Carlos Lima")       // esperando
		return c, r, []*canalFalso{canMaria, canBia, canCarlos}
	}
	conferir := func(t *testing.T, c *cena, r banco.Reuniao, canais []*canalFalso) {
		t.Helper()
		canais[0].conferir(t, "Maria, na reunião", []string{"aguardando", "aceito", "encerrada"}, true)
		canais[1].conferir(t, "Bia, aceita", []string{"aguardando", "aceito", "encerrada"}, true)
		canais[2].conferir(t, "Carlos, esperando", []string{"aguardando", "linkInvalido"}, true)
		if ac, n := c.g.Contagem(r.Sala); ac || n != 0 {
			t.Fatalf("Contagem = %v, %d", ac, n)
		}
		if nomes := nomesNaMemoria(c.g); len(nomes) != 0 {
			t.Fatalf("o gerente ainda guarda %q", nomes)
		}
		// Nem com a reunião lida antes do cancelamento alguém entra.
		_, err := c.g.EntrarColega(c.ctx, r, c.ana.p, c.ana.computador)
		conferirErro(t, "entrar na cancelada", err, ErrLinkInvalido)
	}
	t.Run("o agente encerra e quem espera sabe", func(t *testing.T) {
		c, r, canais := montar(t)
		c.cancelar(r)
		if cmds := c.video.Comandos(); !slices.Equal(cmds, []string{"encerrar " + r.Sala}) {
			t.Fatalf("o agente recebeu %q", cmds)
		}
		if got := c.avisos.ultimo(c.ana.computador, "reuniaoAcabou"); got == nil {
			t.Fatal("a Ana não recebeu o reuniaoAcabou")
		}
		conferir(t, c, r, canais)
	})
	t.Run("o agente não responde, e as páginas sabem assim mesmo", func(t *testing.T) {
		c, r, canais := montar(t)
		c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrSemResposta})
		c.cancelar(r)
		conferir(t, c, r, canais)
	})
	t.Run("sem o servidor de vídeo", func(t *testing.T) {
		c, r, canais := montar(t)
		c.g.Ligar(nil)
		c.cancelar(r)
		conferir(t, c, r, canais)
	})
}

// ---------- A naHora e a validade ----------

func TestNaHora_AcabaVazia(t *testing.T) {
	t.Run("o último sai", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		ana := c.dentro(n, c.ana)
		c.saiu(n, ana)
		c.acabou(n)
		if got := c.recarregar(n); got.AcabouEm != c.chat.Agora().UnixMilli() || got.Vale(c.chat.Agora().UnixMilli()) {
			t.Fatalf("a naHora no banco: %+v", got)
		}
		_, err := c.g.Pedir(c.ctx, c.recarregar(n), "Maria Lima", &canalFalso{})
		conferirErro(t, "Pedir", err, ErrLinkInvalido)
		// Nem com a reunião lida antes do fim.
		_, err = c.g.Pedir(c.ctx, n, "Maria Lima", &canalFalso{})
		conferirErro(t, "Pedir com a reunião de antes", err, ErrLinkInvalido)
		_, err = c.g.EntrarColega(c.ctx, n, c.ana.p, c.ana.computador)
		conferirErro(t, "EntrarColega com a reunião de antes", err, ErrLinkInvalido)
	})
	t.Run("um colega entrando segura a naHora", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.dentro(n, c.ana)
		carlos := c.entrar(n, c.carlos) // a senha do Carlos, ainda não usada
		c.acabou(n)
		if c.recarregar(n).AcabouEm != 0 {
			t.Fatal("a naHora acabou com um colega entrando")
		}
		c.entrou(n, carlos.Participante)
		l, err := c.g.Lista(n, c.carlos.p.ID)
		if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(carlos.Participante, "Carlos Lima", false, false))) {
			t.Fatalf("Lista = %+v, %v", l, err)
		}
	})
	t.Run("a senha do colega vence", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.dentro(n, c.ana)
		c.entrar(n, c.carlos)
		c.acabou(n)
		c.agente.Avancar(31 * time.Second)
		c.g.Varrer()
		if c.recarregar(n).AcabouEm == 0 {
			t.Fatal("a naHora vazia continua depois da senha vencer")
		}
	})
}

func TestNaHora_NinguemEntrou(t *testing.T) {
	c := novaCena(t)
	n := c.naHora()
	c.entrar(n, c.ana) // a Ana pediu a senha e nunca entrou
	m := c.naHora()    // e esta ninguém abriu: o Varrer a acha no banco
	c.andar(10*time.Minute - time.Millisecond)
	c.g.Varrer()
	for _, r := range []banco.Reuniao{n, m} {
		if c.recarregar(r).AcabouEm != 0 {
			t.Fatal("a naHora acabou antes dos 10 minutos")
		}
	}
	c.andar(time.Millisecond)
	c.g.Varrer()
	for _, r := range []banco.Reuniao{n, m} {
		if got := c.recarregar(r); got.AcabouEm != inicioTeste.Add(10*time.Minute).UnixMilli() {
			t.Fatalf("acabou_em = %d; queria os 10 minutos", got.AcabouEm)
		}
	}
	_, err := c.g.Pedir(c.ctx, c.recarregar(n), "Maria Lima", &canalFalso{})
	conferirErro(t, "Pedir", err, ErrLinkInvalido)

	t.Run("uma senha de colega no fim dos 10 minutos espera", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.andar(9*time.Minute + 50*time.Second)
		c.entrar(n, c.ana) // vence às 10:20 no relógio do agente
		c.andar(10 * time.Second)
		c.g.Varrer()
		if c.recarregar(n).AcabouEm != 0 {
			t.Fatal("a naHora acabou com a senha de um colega valendo")
		}
		c.andar(21 * time.Second)
		c.g.Varrer()
		if c.recarregar(n).AcabouEm == 0 {
			t.Fatal("a naHora continua depois de a senha vencer")
		}
	})
}

func TestNaHora_AbertaDeAntes(t *testing.T) {
	c := novaCena(t)
	vazia, cheia := c.naHora(), c.naHora()
	c.andar(time.Hour)
	// O chat reinicia uma hora depois: as duas estão abertas no banco, e o gerente não sabe de nada.
	c.reiniciar()
	c.g.Varrer() // a primeira rodada do Rodar
	alguem := "0011223344556677"
	c.estado(salaDoEstado(cheia, alguem)) // o agente diz que alguém está na segunda
	if ac, n := c.g.Contagem(cheia.Sala); !ac || n != 1 {
		t.Fatalf("Contagem = %v, %d", ac, n)
	}
	// Os 10 minutos contam do começo do gerente.
	c.andar(10*time.Minute - time.Millisecond)
	c.g.Varrer()
	if c.recarregar(vazia).AcabouEm != 0 {
		t.Fatal("acabou antes dos 10 minutos do começo do gerente")
	}
	c.andar(time.Millisecond)
	c.g.Varrer()
	if c.recarregar(vazia).AcabouEm != inicioTeste.Add(time.Hour+10*time.Minute).UnixMilli() {
		t.Fatal("a naHora que ninguém abriu continua aberta")
	}
	if c.recarregar(cheia).AcabouEm != 0 {
		t.Fatal("a naHora com gente acabou")
	}
	// Ela acaba quando fica vazia.
	c.saiu(cheia, alguem)
	c.acabou(cheia)
	if c.recarregar(cheia).AcabouEm == 0 {
		t.Fatal("a naHora vazia continua aberta")
	}
}

func TestValidade_EmAndamentoContinua(t *testing.T) {
	c := novaCena(t)
	agora := c.chat.Agora().UnixMilli()
	r := c.reuniao(banco.Reuniao{EmpresaID: c.acme.ID, Tipo: banco.TipoMarcada, Inicio: agora,
		ValeAte: agora + time.Hour.Milliseconds(), CriouID: c.ana.p.ID})
	ana := c.dentro(r, c.ana)
	maria, _, _ := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	_, pb, _ := c.aceito(r, c.ana, "Bia Ramos") // aceita, e a senha dela vence antes de ela entrar
	_, can := c.pedir(r, "Carlos Lima")

	c.andar(time.Hour)
	c.g.Varrer()
	// Ninguém é tirado...
	if cmds := c.video.Comandos(); len(cmds) != 0 {
		t.Fatalf("o agente recebeu %q", cmds)
	}
	l, err := c.g.Lista(r, c.ana.p.ID)
	if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"],
		lista(pv(ana, "Ana Souza", false, false), pv(maria, "Maria Lima", true, false))) {
		t.Fatalf("Lista = %+v, %v", l, err)
	}
	if _, err := c.g.Tela(c.ctx, r, c.ana.p.ID); err != nil {
		t.Fatalf("a tela de quem está dentro: %v", err)
	}
	// ...mas ninguém novo entra, e quem esperava sabe que o link não vale mais.
	can.conferir(t, "quem esperava", []string{"aguardando", "linkInvalido"}, true)
	_, err = c.g.Pedir(c.ctx, r, "Bia Ramos", &canalFalso{})
	conferirErro(t, "Pedir", err, ErrLinkInvalido)
	_, err = c.g.EntrarColega(c.ctx, r, c.carlos.p, c.carlos.computador)
	conferirErro(t, "EntrarColega", err, ErrLinkInvalido)
	_, err = c.g.NovaSenha(pb)
	conferirErro(t, "a senha nova de quem ainda não entrou", err, ErrLinkInvalido)
}

// ---------- O servidor de vídeo ----------

func TestVideo_Reconciliacao(t *testing.T) {
	t.Run("quem não veio sai, e quem veio sem ser conhecido entra sem nome", func(t *testing.T) {
		c := novaCena(t)
		a, n := c.marcada(), c.naHora()
		ana := c.dentro(a, c.ana)
		c.dentro(a, c.carlos)
		maria, _, _ := c.aceito(a, c.ana, "Maria Lima")
		c.entrou(a, maria)
		c.dentro(n, c.bia)
		if r, p := c.g.Resumo(); r != 2 || p != 4 {
			t.Fatalf("Resumo = %d, %d; queria 2, 4", r, p)
		}
		c.avisos.limpar()

		// A ligação com o agente caiu e voltou: o Carlos saiu nesse meio, a naHora acabou, e alguém que o chat não
		// conhece entrou.
		desconhecido := "00112233aabbccdd"
		c.estado(salaDoEstado(a, ana, maria, desconhecido))

		quer := map[string]any{"tipo": "reuniaoParticipantes", "reuniao": a.Codigo, "participantes": lista(
			pv(ana, "Ana Souza", false, false), pv(maria, "Maria Lima", true, false), pv(desconhecido, "", false, false)),
			"pedidos": lista()}
		if got := c.avisos.de(c.ana.computador); len(got) != 1 || !reflect.DeepEqual(got[0], quer) {
			t.Fatalf("a Ana recebeu %v\nqueria só %v", got, quer)
		}
		if got := c.avisos.tiposDe(c.carlos.computador); len(got) != 0 {
			t.Fatalf("o Carlos, que saiu, recebeu %q", got)
		}
		_, err := c.g.Lista(a, c.carlos.p.ID)
		conferirErro(t, "a Lista do Carlos", err, ErrForaDaReuniao)
		// A sala que não veio acaba: a naHora fecha, e quem estava nela fica sabendo.
		if got := c.avisos.tiposDe(c.bia.computador); !slices.Equal(got, []string{"reuniaoAcabou"}) {
			t.Fatalf("a Bia recebeu %q", got)
		}
		if c.recarregar(n).AcabouEm == 0 {
			t.Fatal("a naHora que não veio no estado continua aberta")
		}
		if r, p := c.g.Resumo(); r != 1 || p != 3 {
			t.Fatalf("Resumo = %d, %d; queria 1, 3", r, p)
		}
	})
	t.Run("um estado no meio do começo não acaba a reunião", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		a := c.entrar(n, c.ana) // só começando: a senha, e ninguém dentro
		c.estado()              // a sala ainda não existe no FreeSWITCH
		if c.recarregar(n).AcabouEm != 0 {
			t.Fatal("o estado acabou a naHora que estava começando")
		}
		c.entrou(n, a.Participante) // a senha foi usada depois do estado
		l, err := c.g.Lista(n, c.ana.p.ID)
		if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(a.Participante, "Ana Souza", false, false))) {
			t.Fatalf("Lista = %+v, %v", l, err)
		}
	})
	t.Run("a naHora em que ninguém entrou acaba só pelos 10 minutos", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		c.entrar(n, c.ana) // a senha da Ana venceu sem uso
		m := c.naHora()    // e esta ninguém abriu: o Varrer a acha no banco
		c.andar(31 * time.Second)
		c.g.Varrer()
		c.estado() // a ligação com o agente caiu e voltou: nenhuma sala
		for _, r := range []banco.Reuniao{n, m} {
			if c.recarregar(r).AcabouEm != 0 {
				t.Fatal("o estado acabou uma naHora em que ninguém estava")
			}
		}
		c.dentro(n, c.ana)
		c.andar(10 * time.Minute)
		c.g.Varrer()
		if c.recarregar(n).AcabouEm != 0 || c.recarregar(m).AcabouEm == 0 {
			t.Fatal("aos 10 minutos, a naHora vazia devia acabar, e a com a Ana, não")
		}
	})
	t.Run("um pendente que aparece no estado entra com o nome", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		a := c.entrar(r, c.ana)
		c.estado(salaDoEstado(r, a.Participante)) // o entrou dela se perdeu na queda
		l, err := c.g.Lista(r, c.ana.p.ID)
		if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(a.Participante, "Ana Souza", false, false))) {
			t.Fatalf("Lista = %+v, %v", l, err)
		}
	})
	// O tirar de quem entra sem ser conhecido (TestTirar_QuemVoltaComOutraSenha) é só do entrou. O estado depois de um
	// reinício do chat traz todos sem nome, e eles ficam, também numa reunião que já é conhecida quando ele chega: a
	// naHora, que o primeiro Varrer lê no banco.
	t.Run("depois de um reinício, o estado não tira quem ele traz", func(t *testing.T) {
		c := novaCena(t)
		n := c.naHora()
		ana := c.dentro(n, c.ana)
		maria, _, _ := c.aceito(n, c.ana, "Maria Lima")
		c.entrou(n, maria)
		c.reiniciar()
		c.g.Varrer()
		c.estado(salaDoEstado(n, ana, maria))
		ana2 := c.dentro(n, c.ana)
		if cmds := c.video.Comandos(); len(cmds) != 0 {
			t.Fatalf("o agente recebeu %q", cmds)
		}
		l, err := c.g.Lista(n, c.ana.p.ID)
		quer := lista(pv(ana, "", false, false), pv(maria, "", false, false), pv(ana2, "Ana Souza", false, false))
		if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], quer) {
			t.Fatalf("Lista = %+v, %v; queria %v", l, err, quer)
		}
	})
	// Numa sala que só o estado trouxe, o chat ainda não conhece a reunião, nem as senhas de antes do reinício: o
	// Carlos, que recebeu a dele antes, entra depois do estado e fica.
	t.Run("depois de um reinício, quem entra com uma senha de antes fica", func(t *testing.T) {
		c := novaCena(t)
		r := c.marcada()
		ana := c.dentro(r, c.ana)
		carlos := c.entrar(r, c.carlos).Participante
		c.reiniciar()
		c.estado(salaDoEstado(r, ana))
		c.entrou(r, carlos)
		if cmds := c.video.Comandos(); len(cmds) != 0 {
			t.Fatalf("o agente recebeu %q", cmds)
		}
		if _, n := c.g.Contagem(r.Sala); n != 2 {
			t.Fatalf("a reunião tem %d pessoas; queria 2", n)
		}
	})
}

func TestVideo_FreeSWITCHCaiu(t *testing.T) {
	c := novaCena(t)
	a, b, d := c.marcada(), c.marcada(), c.marcada()
	c.dentro(a, c.ana)
	maria, _, canMaria := c.aceito(a, c.ana, "Maria Lima")
	c.entrou(a, maria)
	c.dentro(b, c.carlos)
	_, err := c.g.EntrarColega(c.ctx, d, c.bia.p, c.bia.computador)
	conferirErro(t, "a terceira", err, ErrServidorCheio)

	// O FreeSWITCH cai: o agente manda o acabou de cada sala e um estado vazio, com o freeswitch falso.
	c.video.DefinirNoAr(false)
	c.acabou(a)
	c.acabou(b)
	c.g.EventoDoVideo(video.Evento{Tipo: "estado", Agora: c.agente.Agora().UnixMilli(), FreeSWITCH: false, Salas: []video.Sala{}})
	if r, p := c.g.Resumo(); r != 0 || p != 0 {
		t.Fatalf("Resumo = %d, %d", r, p)
	}
	canMaria.conferir(t, "Maria", []string{"aguardando", "aceito", "encerrada"}, true)
	_, err = c.g.EntrarColega(c.ctx, d, c.bia.p, c.bia.computador)
	conferirErro(t, "com o FreeSWITCH fora", err, ErrSemServidor)

	// Ele volta: as vagas estão soltas, e duas reuniões novas começam.
	c.video.DefinirNoAr(true)
	c.estado()
	c.dentro(d, c.bia)
	c.dentro(a, c.ana)
	if r, p := c.g.Resumo(); r != 2 || p != 2 {
		t.Fatalf("Resumo = %d, %d", r, p)
	}
}

func TestVideo_EventosRepetidos(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	carlos := c.dentro(r, c.carlos)
	c.avisos.limpar()

	// O agente pode repetir num aviso o que o estado já mostrou: nada muda, e ninguém é avisado de novo.
	c.entrou(r, ana)
	c.estado(salaDoEstado(r, ana, carlos))
	c.saiu(r, "0123456789abcdef") // quem o chat não conhece
	if n := c.avisos.total(); n != 0 {
		t.Fatalf("os eventos repetidos mandaram %d avisos", n)
	}
	c.entrouTela(r, ana)
	c.entrouTela(r, ana)
	c.saiu(r, ana)
	c.saiu(r, ana)
	if got := c.avisos.tiposDe(c.carlos.computador); !slices.Equal(got, []string{"reuniaoParticipantes", "reuniaoParticipantes"}) {
		t.Fatalf("o Carlos recebeu %q; queria um aviso pela tela e um pela saída", got)
	}
	if c.avisos.repetidos() {
		t.Fatal("um aviso foi duas vezes ao mesmo computador")
	}
	c.saiu(r, carlos)
	c.acabou(r)
	c.acabou(r)
	if r, p := c.g.Resumo(); r != 0 || p != 0 {
		t.Fatalf("Resumo = %d, %d", r, p)
	}
}

func TestLigar_UmLacoPorVez(t *testing.T) {
	c := cenaSemVideo(t)
	v1 := &videoContado{Falso: videotest.NovoFalso(chaveTeste, c.agente.Agora)}
	v2 := &videoContado{Falso: videotest.NovoFalso(chaveTeste, c.agente.Agora)}
	r := c.marcada()

	// O Ligar antes do Rodar já acompanha os eventos, num laço do gerente.
	c.g.Ligar(v1)
	esperar(t, "o laço do v1", func() bool { n, _ := v1.contar(); return n == 1 })
	a := c.entrar(r, c.ana)
	v1.Mandar(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: a.Participante})
	esperar(t, "o entrou mandado ao v1", func() bool { ac, _ := c.g.Contagem(r.Sala); return ac })

	// O mesmo cliente de novo: o laço velho para antes de o novo começar.
	c.g.Ligar(v1)
	esperar(t, "o laço novo do v1", func() bool { n, _ := v1.contar(); return n == 1 })
	if _, maximo := v1.contar(); maximo != 1 {
		t.Fatalf("%d Acompanhar do mesmo cliente ao mesmo tempo", maximo)
	}

	// Outro cliente: quando o Ligar volta, o laço do anterior já parou.
	c.g.Ligar(v2)
	if n, _ := v1.contar(); n != 0 {
		t.Fatal("o laço do v1 continua depois do Ligar(v2)")
	}
	if c.g.Video() != Video(v2) {
		t.Fatal("o Video() não é o v2")
	}
	// Um evento que o laço velho ainda entregasse não muda nada, nem um mandado ao cliente velho.
	v1.funcao(1)(video.Evento{Tipo: "saiu", Sala: r.Sala, Participante: a.Participante})
	v1.Mandar(video.Evento{Tipo: "saiu", Sala: r.Sala, Participante: a.Participante})
	b := c.entrar(r, c.bia)
	v2.Mandar(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: b.Participante})
	esperar(t, "o entrou mandado ao v2", func() bool { _, n := c.g.Contagem(r.Sala); return n == 2 })

	// O fim do Rodar para o laço.
	ctx, cancela := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() {
		c.g.Rodar(ctx)
		close(fim)
	}()
	cancela()
	select {
	case <-fim:
	case <-time.After(5 * time.Second):
		t.Fatal("o Rodar não voltou")
	}
	if n, _ := v2.contar(); n != 0 {
		t.Fatal("o Rodar acabou, e o laço do v2 continua")
	}
}

// ---------- A tela e os nomes ----------

func TestTela(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	senha, err := c.g.Tela(c.ctx, r, c.ana.p.ID)
	if err != nil {
		t.Fatalf("Tela: %v", err)
	}
	s := lerSenha(t, senha)
	quer := video.Senha{V: 1, Sala: r.Sala, Participante: ana, Papel: video.Colega, Tela: true, Nome: "Ana Souza",
		Vence: 1794488430000, ID: s.ID}
	if s != quer {
		t.Fatalf("a senha da tela é %+v\nqueria %+v", s, quer)
	}
	// A senha da tela não conta como pessoa.
	if _, n := c.g.Contagem(r.Sala); n != 1 {
		t.Fatalf("a reunião tem %d pessoas; queria 1", n)
	}
	_, err = c.g.Tela(c.ctx, r, c.carlos.p.ID)
	conferirErro(t, "a tela do Carlos, fora", err, ErrForaDaReuniao)

	// A de quem é de fora: só com a pessoa na reunião.
	maria, pm, _ := c.aceito(r, c.ana, "Maria Lima")
	_, err = c.g.TelaDeFora(pm)
	conferirErro(t, "a tela da Maria antes de entrar", err, ErrForaDaReuniao)
	c.entrou(r, maria)
	senha, err = c.g.TelaDeFora(pm)
	if err != nil {
		t.Fatalf("TelaDeFora: %v", err)
	}
	s = lerSenha(t, senha)
	quer = video.Senha{V: 1, Sala: r.Sala, Participante: maria, Papel: video.Fora, Tela: true, Nome: "Maria Lima",
		Vence: 1794488430000, ID: s.ID}
	if s != quer {
		t.Fatalf("a senha da tela da Maria é %+v\nqueria %+v", s, quer)
	}

	// Com o FreeSWITCH fora, nenhuma senha.
	c.video.DefinirNoAr(false)
	_, err = c.g.Tela(c.ctx, r, c.ana.p.ID)
	conferirErro(t, "Tela", err, ErrSemServidor)
}

func TestAcabou_EsqueceOsNomes(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	maria, pm, canMaria := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	c.saiu(r, maria) // saiu, e a página continua aberta
	c.saiu(r, ana)
	c.acabou(r)

	if nomes := nomesNaMemoria(c.g); len(nomes) != 0 {
		t.Fatalf("depois do acabou, o gerente ainda guarda %q", nomes)
	}
	if nome := nomeDoPedido(c.g, pm); nome != "" {
		t.Fatalf("depois do acabou, o pedido que a página guarda ainda leva o nome %q", nome)
	}
	canMaria.conferir(t, "Maria", []string{"aguardando", "aceito", "encerrada"}, true)
	_, err := c.g.NovaSenha(pm)
	conferirErro(t, "a senha nova depois do fim", err, ErrForaDeOrdem)
	_, err = c.g.Lista(r, c.ana.p.ID)
	conferirErro(t, "Lista", err, ErrForaDaReuniao)
	// A reunião recomeça sem ninguém de antes.
	ana = c.dentro(r, c.ana)
	l, err := c.g.Lista(r, c.ana.p.ID)
	if err != nil || !reflect.DeepEqual(emJSON(l)["participantes"], lista(pv(ana, "Ana Souza", false, false))) {
		t.Fatalf("Lista = %+v, %v", l, err)
	}
}

// avisosQueVoltam chama o gerente de dentro do aviso: com o mutex travado, ele travaria.
type avisosQueVoltam struct {
	avisosFalsos
	g *Gerente
}

func (a *avisosQueVoltam) ParaComputadores(ids []int64, ev any) {
	a.g.Resumo()
	a.avisosFalsos.ParaComputadores(ids, ev)
}

// canalQueVolta chama o gerente de dentro do Mandar: o Contagem sempre, e o Desistir quando a página acaba.
type canalQueVolta struct {
	canalFalso
	g      *Gerente
	sala   string
	pedido atomic.Pointer[Pedido]
}

func (c *canalQueVolta) Mandar(msg any) {
	c.g.Contagem(c.sala)
	c.canalFalso.Mandar(msg)
	if emJSON(msg)["tipo"] == "recusado" {
		c.g.Desistir(c.pedido.Load(), c)
	}
}

func TestAvisos_DepoisDoMutex(t *testing.T) {
	// Os avisos e as mensagens saem depois de o gerente soltar o mutex: um aviso e uma página que o chamam de volta
	// não o travam. Se travassem, o vigia derruba o teste.
	vigia := time.AfterFunc(10*time.Second, func() {
		panic("o gerente travou: um aviso ou uma mensagem saiu com o mutex travado")
	})
	defer vigia.Stop()
	c := novaCena(t)
	volta := &avisosQueVoltam{}
	c.g.Ligar(nil)
	c.g = Novo(Deps{Banco: c.b, Avisos: volta, Relogio: c.chat})
	volta.g = c.g
	c.g.Ligar(c.video)
	r := c.marcada()
	c.dentro(r, c.ana)

	pedir := func(nome string) *canalQueVolta {
		t.Helper()
		anotar(nome)
		can := &canalQueVolta{g: c.g, sala: r.Sala}
		p, err := c.g.Pedir(c.ctx, r, nome, can)
		if err != nil {
			t.Fatalf("Pedir de %s: %v", nome, err)
		}
		can.pedido.Store(p)
		return can
	}
	canMaria := pedir("Maria Lima")
	if err := c.g.Aceitar(c.ctx, r, c.ana.p.ID, c.pedidoDe(r, c.ana, "Maria Lima")); err != nil {
		t.Fatal(err)
	}
	maria, _ := aceitoDe(t, &canMaria.canalFalso)
	c.entrou(r, maria)
	canBia := pedir("Bia Ramos")
	if err := c.g.Recusar(c.ctx, r, c.ana.p.ID, c.pedidoDe(r, c.ana, "Bia Ramos")); err != nil {
		t.Fatal(err)
	}
	if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
		t.Fatal(err)
	}
	c.cancelar(r)

	canMaria.conferir(t, "Maria", []string{"aguardando", "aceito", "tirado"}, true)
	canBia.conferir(t, "Bia", []string{"aguardando", "recusado"}, true)
	if got := volta.tiposDe(c.ana.computador); len(got) < 5 || got[len(got)-1] != "reuniaoAcabou" {
		t.Fatalf("a Ana recebeu %q", got)
	}
}

// videoQueVolta chama o gerente de dentro do Agora, do NoAr, do Tirar e do Encerrar: chamado com o mutex travado, o
// gerente travaria.
type videoQueVolta struct {
	*videotest.Falso
	g      *Gerente
	voltas atomic.Int64
}

func (v *videoQueVolta) voltar() {
	v.g.Resumo()
	v.voltas.Add(1)
}

func (v *videoQueVolta) Agora() time.Time {
	v.voltar()
	return v.Falso.Agora()
}

func (v *videoQueVolta) NoAr() bool {
	v.voltar()
	return v.Falso.NoAr()
}

func (v *videoQueVolta) Tirar(ctx context.Context, sala, participante string) error {
	v.voltar()
	return v.Falso.Tirar(ctx, sala, participante)
}

func (v *videoQueVolta) Encerrar(ctx context.Context, sala string) error {
	v.voltar()
	return v.Falso.Encerrar(ctx, sala)
}

// semTrava roda f com um vigia: se o gerente travar, o teste cai em 5 s, em vez de prender a suíte.
func semTrava(oque string, f func()) {
	vigia := time.AfterFunc(5*time.Second, func() {
		panic("o gerente travou em " + oque + ": uma chamada ao Video com o mutex travado")
	})
	defer vigia.Stop()
	f()
}

func TestVideo_SemChamadaComOMutex(t *testing.T) {
	// O gerente chama o servidor de vídeo sempre com o mutex solto: um Video que chama o gerente de volta não o trava.
	c := novaCena(t)
	v := &videoQueVolta{Falso: c.video, g: c.g}
	c.g.Ligar(v)
	r, n := c.marcada(), c.naHora()
	var maria string
	var pm *Pedido
	semTrava("a entrada de um colega e o entrou", func() { c.dentro(r, c.ana) })
	semTrava("o pedido e o aceito", func() { maria, pm, _ = c.aceito(r, c.ana, "Maria Lima") })
	semTrava("a senha nova", func() {
		if _, err := c.g.NovaSenha(pm); err != nil {
			t.Fatalf("NovaSenha: %v", err)
		}
	})
	semTrava("as telas", func() {
		c.entrou(r, maria)
		if _, err := c.g.Tela(c.ctx, r, c.ana.p.ID); err != nil {
			t.Fatalf("Tela: %v", err)
		}
		if _, err := c.g.TelaDeFora(pm); err != nil {
			t.Fatalf("TelaDeFora: %v", err)
		}
	})
	semTrava("o Tirar", func() {
		if err := c.g.Tirar(c.ctx, r, c.ana.p.ID, maria); err != nil {
			t.Fatalf("Tirar: %v", err)
		}
	})
	// A Maria volta com a senha nova, que ainda vale: o tirar do gerente também vai depois do mutex.
	semTrava("o entrou de quem foi tirado", func() { c.entrou(r, maria) })
	semTrava("o Varrer", func() {
		c.andar(31 * time.Second)
		c.g.Varrer()
	})
	semTrava("o Encerrar", func() {
		if err := c.g.Encerrar(c.ctx, r, c.ana.p.ID); err != nil {
			t.Fatalf("Encerrar: %v", err)
		}
	})
	semTrava("o Cancelada", func() {
		c.dentro(n, c.carlos)
		c.cancelar(n)
	})
	quer := []string{"tirar " + r.Sala + " " + maria, "tirar " + r.Sala + " " + maria, "encerrar " + r.Sala, "encerrar " + n.Sala}
	if cmds := c.video.Comandos(); !slices.Equal(cmds, quer) {
		t.Fatalf("o agente recebeu %q; queria %q", cmds, quer)
	}
	if v.voltas.Load() == 0 {
		t.Fatal("o gerente não chamou o Video")
	}
}

func TestSemNomesNoLog(t *testing.T) {
	// O TestMain põe o registro no slog de todo o pacote e, depois de todos os testes, confere que nele não há
	// nenhum segredo. Aqui: a captura está no lugar, e o gerente passa pelas linhas de log dele com nomes, códigos,
	// salas e participantes no meio. Daí em diante, o log do fim não pode estar vazio.
	slog.Info("teste: a captura do log")
	if !strings.Contains(registro.String(), "teste: a captura do log") {
		t.Fatal("o slog não vai para o registro")
	}
	segredosMu.Lock()
	exigirLog = true
	segredosMu.Unlock()

	c := novaCena(t)
	r := c.marcada()
	ana := c.dentro(r, c.ana)
	maria, _, _ := c.aceito(r, c.ana, "Maria Lima")
	c.entrou(r, maria)
	c.estado(salaDoEstado(r, ana, maria)) // as contagens do estado
	c.pedir(r, "Bia Ramos")
	c.naHora()
	c.andar(10 * time.Minute)
	c.g.Varrer() // um pedido vencido e uma naHora que ninguém abriu
	c.g.Ligar(&videoComErro{Falso: c.video, err: video.ErrSemResposta})
	c.cancelar(r) // o agente não encerrou a cancelada: o código do erro
	n := c.naHora()
	c.g.Ligar(c.video)
	c.dentro(n, c.carlos)
	c.b.Fechar()
	c.acabou(n) // o banco fora: o código do erro
	c.andar(time.Minute)
	c.g.Varrer()

	texto := registro.String()
	for _, quer := range []string{"erro=semResposta", "erro=outro", "salas=1"} {
		if !strings.Contains(texto, quer) {
			t.Errorf("o log não tem %q", quer)
		}
	}
	if err := conferirLog(texto); err != nil {
		t.Fatal(err)
	}

	// O ramal também é conferido (o EntrarColega o recebe, dentro da Pessoa). Para isso o registro não leva a hora,
	// onde quatro algarismos aparecem por acaso.
	if strings.Contains(texto, "time=") {
		t.Error("o registro leva a hora de cada linha")
	}
	if err := conferirLog("reunioes: teste ramal=" + c.ana.p.Ramal); err == nil || !strings.Contains(err.Error(), c.ana.p.Ramal) {
		t.Errorf("a conferência não acusa um ramal no log: %v", err)
	}
}

// O desistir da página e o aceito de um colega, ao mesmo tempo: um só vence. Se o aceito vence, a página recebe o
// aceito; se o desistir vence, ela não recebe nada.
func TestDesistirEsperando_CruzaComOAceito(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	carlos := c.carlos
	c.dentro(r, carlos)
	var aceitos, retirados int
	for i := range 8 { // com o Carlos, até 9 pessoas: cabe nas 10
		nome := fmt.Sprintf("Maria %d", i)
		p, can := c.pedir(r, nome)
		id := c.pedidoDe(r, carlos, nome)
		var errAceitar error
		var retirou bool
		var feito sync.WaitGroup
		largada := make(chan struct{})
		feito.Add(2)
		go func() { defer feito.Done(); <-largada; errAceitar = c.g.Aceitar(c.ctx, r, carlos.p.ID, id) }()
		go func() { defer feito.Done(); <-largada; retirou = c.g.DesistirEsperando(p) }()
		close(largada)
		feito.Wait()
		if (errAceitar == nil) == retirou {
			t.Fatalf("rodada %d: Aceitar = %v, DesistirEsperando = %v; queria só um vencedor", i, errAceitar, retirou)
		}
		if retirou {
			retirados++
			if !errors.Is(errAceitar, ErrJaRespondido) {
				t.Fatalf("rodada %d: o Aceitar que perdeu deu %v; queria ErrJaRespondido", i, errAceitar)
			}
			if tipos := can.tipos(); slices.Contains(tipos, "aceito") {
				t.Fatalf("rodada %d: a página recebeu %q depois de desistir", i, tipos)
			}
			continue
		}
		aceitos++
		prazo := time.Now().Add(5 * time.Second)
		for !slices.Contains(can.tipos(), "aceito") {
			if time.Now().After(prazo) {
				t.Fatalf("rodada %d: o aceito venceu e a página não o recebeu: %q", i, can.tipos())
			}
			time.Sleep(time.Millisecond)
		}
		if c.g.DesistirEsperando(p) {
			t.Fatalf("rodada %d: DesistirEsperando retirou um pedido já aceito", i)
		}
	}
	t.Logf("aceitos %d, retirados %d", aceitos, retirados)
}

func TestDesistirEsperando_ForaDeOrdem(t *testing.T) {
	c := novaCena(t)
	if c.g.DesistirEsperando(nil) {
		t.Fatal("DesistirEsperando(nil) deu true")
	}
	r := c.marcada()
	c.dentro(r, c.carlos)
	p, _ := c.pedir(r, "Maria Lima")
	if !c.g.DesistirEsperando(p) {
		t.Fatal("o pedido que espera não foi retirado")
	}
	if c.g.DesistirEsperando(p) {
		t.Fatal("o pedido já retirado foi retirado de novo")
	}
}

// ---------- A sala que acabou não volta ----------

// encerrarDe conta os "encerrar <sala>" que o agente falso recebeu.
func encerrarDe(c *cena, sala string) int {
	n := 0
	for _, cmd := range c.video.Comandos() {
		if cmd == "encerrar "+sala {
			n++
		}
	}
	return n
}

// acabouNaHora devolve uma naHora que a Ana abriu e encerrou: a sala dela fica na memória do fim.
func acabouNaHora(t *testing.T, c *cena) banco.Reuniao {
	t.Helper()
	n := c.naHora()
	c.dentro(n, c.ana)
	if err := c.g.Encerrar(c.ctx, n, c.ana.p.ID); err != nil {
		t.Fatalf("Encerrar: %v", err)
	}
	c.avisos.limpar()
	return n
}

func TestGerente_EntrouNumaSalaQueAcabou(t *testing.T) {
	c := novaCena(t)
	n := acabouNaHora(t, c)
	antes := encerrarDe(c, n.Sala)
	c.entrou(n, "0011223344556677")
	esperar(t, "o encerrar da sala que acabou", func() bool { return encerrarDe(c, n.Sala) == antes+1 })
	if ac, p := c.g.Contagem(n.Sala); ac || p != 0 {
		t.Fatalf("a sala voltou: Contagem = %v, %d", ac, p)
	}
	if nomes := nomesNaMemoria(c.g); len(nomes) != 0 {
		t.Fatalf("o gerente guarda %q", nomes)
	}
	c.g.mu.Lock()
	_, tem := c.g.salas[n.Sala]
	c.g.mu.Unlock()
	if tem {
		t.Fatal("o gerente recriou a sala")
	}
	if got := c.avisos.total(); got != 0 {
		t.Fatalf("saíram %d avisos", got)
	}
}

func TestGerente_EstadoComSalaQueAcabou(t *testing.T) {
	c := novaCena(t)
	n := acabouNaHora(t, c)
	antes := encerrarDe(c, n.Sala)
	c.estado(salaDoEstado(n, "0011223344556677"))
	esperar(t, "o encerrar da sala que acabou", func() bool { return encerrarDe(c, n.Sala) == antes+1 })
	c.g.mu.Lock()
	_, tem := c.g.salas[n.Sala]
	c.g.mu.Unlock()
	if tem {
		t.Fatal("o gerente recriou a sala")
	}
	if got := c.avisos.total(); got != 0 {
		t.Fatalf("saíram %d avisos", got)
	}
}

// sentinela manda, pelo mesmo laço de eventos do agente, o entrou de uma sala que o chat não conhece nem lembra, e
// espera o efeito dele. O laço trata os eventos em ordem: quando o efeito aparece, os eventos mandados antes dele
// já foram tratados.
func (c *cena) sentinela() {
	c.t.Helper()
	r := c.marcada()
	c.video.Mandar(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: "5a5a5a5a5a5a5a5a"})
	esperar(c.t, "o efeito da sentinela", func() bool {
		ac, p := c.g.Contagem(r.Sala)
		return ac && p == 1
	})
}

// mandar manda os eventos pelo laço do agente, e a sentinela espera que todos tenham sido tratados.
func (c *cena) mandar(evs ...video.Evento) {
	c.t.Helper()
	for _, ev := range evs {
		c.video.Mandar(ev)
	}
	c.sentinela()
}

func TestGerente_EncerraUmaVezSo(t *testing.T) {
	c := novaCena(t)
	n := acabouNaHora(t, c)
	antes := encerrarDe(c, n.Sala)
	c.mandar(
		video.Evento{Tipo: "entrou", Sala: n.Sala, Participante: "0011223344556677"},
		video.Evento{Tipo: "entrou", Sala: n.Sala, Participante: "8899aabbccddeeff"},
		video.Evento{Tipo: "estado", Agora: c.agente.Agora().UnixMilli(), FreeSWITCH: true,
			Salas: []video.Sala{salaDoEstado(n, "0011223344556677")}},
	)
	if got := encerrarDe(c, n.Sala) - antes; got != 1 {
		t.Fatalf("o agente recebeu %d encerrar da sala, queria 1", got)
	}
}

func TestGerente_SalaNovaNaoEncerra(t *testing.T) {
	c := novaCena(t)
	r := c.marcada()
	c.mandar(video.Evento{Tipo: "entrou", Sala: r.Sala, Participante: "0011223344556677"})
	if cmds := c.video.Comandos(); len(cmds) != 0 {
		t.Fatalf("o agente recebeu %q", cmds)
	}
	if ac, p := c.g.Contagem(r.Sala); !ac || p != 1 {
		t.Fatalf("Contagem = %v, %d; o caminho de hoje põe a pessoa na sala", ac, p)
	}
}

// videoQueFalhaDepois é o agente falso cujo Encerrar anota o comando e devolve err nas primeiras falhas chamadas.
type videoQueFalhaDepois struct {
	*videotest.Falso
	mu     sync.Mutex
	falhas int
	err    error
}

func (v *videoQueFalhaDepois) Encerrar(ctx context.Context, sala string) error {
	v.Falso.Encerrar(ctx, sala)
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.falhas > 0 {
		v.falhas--
		return v.err
	}
	return nil
}

func TestGerente_EncerraDeNovoSeFalhou(t *testing.T) {
	c := novaCena(t)
	n := acabouNaHora(t, c)
	c.g.Ligar(&videoQueFalhaDepois{Falso: c.video, falhas: 1, err: video.ErrSemResposta})
	antes := encerrarDe(c, n.Sala)
	entrou := video.Evento{Tipo: "entrou", Sala: n.Sala, Participante: "0011223344556677"}
	c.mandar(entrou)
	if got := encerrarDe(c, n.Sala) - antes; got != 1 {
		t.Fatalf("o primeiro evento deu %d encerrar, queria 1", got)
	}
	c.mandar(entrou) // o primeiro falhou: o próximo evento pede de novo, e este dá certo
	if got := encerrarDe(c, n.Sala) - antes; got != 2 {
		t.Fatalf("o segundo evento deu %d encerrar no total, queria 2", got)
	}
	c.mandar(entrou) // deu certo: não pede mais
	if got := encerrarDe(c, n.Sala) - antes; got != 2 {
		t.Fatalf("o terceiro evento deu %d encerrar no total, queria 2", got)
	}
}

func TestGerente_NaoEncontradoValeComoFeito(t *testing.T) {
	c := novaCena(t)
	n := acabouNaHora(t, c)
	c.g.Ligar(&videoQueFalhaDepois{Falso: c.video, falhas: 100, err: video.ErrNaoEncontrado})
	antes := encerrarDe(c, n.Sala)
	entrou := video.Evento{Tipo: "entrou", Sala: n.Sala, Participante: "0011223344556677"}
	c.mandar(entrou)
	c.mandar(entrou)
	if got := encerrarDe(c, n.Sala) - antes; got != 1 {
		t.Fatalf("o agente recebeu %d encerrar, queria 1: o 404 vale como feito", got)
	}
}

// Os jeitos de uma sala acabar de vez (a ruling R2): cada um deixa a sala na memória do fim.
func TestGerente_TodoFimFicaNaMemoria(t *testing.T) {
	cada := map[string]func(c *cena) banco.Reuniao{
		"o Encerrar da naHora": func(c *cena) banco.Reuniao { return acabouNaHora(t, c) },
		"o Cancelar": func(c *cena) banco.Reuniao {
			r := c.marcada()
			c.dentro(r, c.ana)
			c.cancelar(r)
			return r
		},
		"o fim da naHora que ninguém abriu": func(c *cena) banco.Reuniao {
			n := c.naHora()
			c.andar(esperaNaHora + time.Second)
			c.g.Varrer()
			return n
		},
		"o fim da naHora quando o último sai": func(c *cena) banco.Reuniao {
			n := c.naHora()
			a := c.dentro(n, c.ana)
			c.saiu(n, a)
			c.g.Varrer()
			return n
		},
		"o Bloquear com a sala na memória": func(c *cena) banco.Reuniao {
			r := c.marcada()
			c.dentro(r, c.ana)
			c.g.Bloqueadas(c.ctx, []banco.Reuniao{r})
			return r
		},
		"o Bloquear com a sala fora da memória": func(c *cena) banco.Reuniao {
			r := c.marcada()
			c.g.Bloqueadas(c.ctx, []banco.Reuniao{r})
			return r
		},
	}
	for nome, fim := range cada {
		t.Run(nome, func(t *testing.T) {
			c := novaCena(t)
			r := fim(c)
			c.g.mu.Lock()
			lembra := c.g.fechada(r.Sala)
			c.g.mu.Unlock()
			if !lembra {
				t.Fatal("a sala não ficou na memória do fim")
			}
			c.entrou(r, "0011223344556677")
			c.g.mu.Lock()
			_, tem := c.g.salas[r.Sala]
			c.g.mu.Unlock()
			if tem {
				t.Fatal("o entrou recriou a sala")
			}
		})
	}
}
