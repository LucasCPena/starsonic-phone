package banco

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// As senhas dos testes são inventadas e valem só aqui.
const (
	senhaTeste  = "senha-inventada-de-teste-1"
	senhaErrada = "senha-errada-de-teste-1"
)

// O relógio do abrirTeste começa em 1_700_000_000_000 ms.
const inicioTeste = int64(1_700_000_000_000)

func criarAdmin(t *testing.T, b *Banco, usuario, senha string) {
	t.Helper()
	if err := b.CriarAdmin(context.Background(), usuario, senha); err != nil {
		t.Fatalf("CriarAdmin(%q): %v", usuario, err)
	}
}

// adminRapido grava o usuário direto na tabela, com um hash argon2id de parâmetros mínimos
// (m=8, t=1, p=1). O ConferirSenha lê os parâmetros do próprio hash; assim, os testes da trava
// não esperam o argon2id de 64 MiB a cada tentativa.
func adminRapido(t *testing.T, b *Banco, usuario, senha string) {
	t.Helper()
	sal := []byte("sal-de-teste-123")
	chave := argon2.IDKey([]byte(senha), sal, 1, 8, 1, 32)
	hash := "$argon2id$v=19$m=8,t=1,p=1$" + base64.RawStdEncoding.EncodeToString(sal) + "$" +
		base64.RawStdEncoding.EncodeToString(chave)
	exec(t, b, `INSERT INTO admins (usuario, senha_hash, criado_em) VALUES (?, ?, 1)`, usuario, hash)
}

// conferir chama o ConferirSenha e falha o teste num erro.
func conferir(t *testing.T, b *Banco, usuario, senha string) (bool, int64) {
	t.Helper()
	ok, travado, err := b.ConferirSenha(context.Background(), usuario, senha)
	if err != nil {
		t.Fatalf("ConferirSenha(%q): %v", usuario, err)
	}
	return ok, travado
}

// hashFalsoBarato troca o hash falso por um de parâmetros mínimos até o fim do teste: os nomes
// que não existem passam a custar o mesmo que os do adminRapido. A chave são zeros, sem senha
// por trás.
func hashFalsoBarato(t *testing.T) {
	t.Helper()
	antes := hashFalso
	hashFalso = "$argon2id$v=19$m=8,t=1,p=1$" + base64.RawStdEncoding.EncodeToString([]byte("sal-falso-barato")) + "$" +
		base64.RawStdEncoding.EncodeToString(make([]byte, 32))
	t.Cleanup(func() { hashFalso = antes })
}

// semVagas toma as duas vagas do argon2id até soltar (ou até o fim do teste): com elas tomadas,
// um ConferirSenha que fosse calcular o argon2id ficaria esperando.
func semVagas(t *testing.T) (soltar func()) {
	t.Helper()
	for i := 0; i < cap(vagasArgon); i++ {
		vagasArgon <- struct{}{}
	}
	var uma sync.Once
	soltar = func() {
		uma.Do(func() {
			for i := 0; i < cap(vagasArgon); i++ {
				<-vagasArgon
			}
		})
	}
	t.Cleanup(soltar)
	return soltar
}

// conferirSemEsperar chama o ConferirSenha com um prazo de 5 s e falha o teste se ele esperou
// uma vaga do argon2id (veja semVagas).
func conferirSemEsperar(t *testing.T, b *Banco, usuario, senha string) (bool, int64) {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	ok, travado, err := b.ConferirSenha(ctx, usuario, senha)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ConferirSenha(%q) esperou uma vaga do argon2id", usuario)
	}
	if err != nil {
		t.Fatalf("ConferirSenha(%q): %v", usuario, err)
	}
	return ok, travado
}

// milOutros faz 1.000 nomes que não existem errarem a senha uma vez cada (com o hashFalsoBarato).
func milOutros(t *testing.T, b *Banco) {
	t.Helper()
	for i := 0; i < 1000; i++ {
		if ok, trav := conferir(t, b, fmt.Sprintf("outro-%d", i), senhaErrada); ok || trav != 0 {
			t.Fatalf("o outro %d = %v, %d", i, ok, trav)
		}
	}
}

func TestCriarAdmin(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	criarAdmin(t, b, " Suporte@Starsonic ", senhaTeste)

	// O usuário fica sem as pontas e em minúsculas; a senha, só no hash argon2id do formato
	// PHC: sal de 16 bytes e hash de 32, em base64 sem o "=".
	var hash string
	var criado int64
	if err := b.db.QueryRow(`SELECT senha_hash, criado_em FROM admins WHERE usuario = 'suporte@starsonic'`).
		Scan(&hash, &criado); err != nil {
		t.Fatalf("o usuário não ficou como suporte@starsonic: %v", err)
	}
	re := regexp.MustCompile(`^\$argon2id\$v=19\$m=65536,t=3,p=2\$([A-Za-z0-9+/]{22})\$[A-Za-z0-9+/]{43}$`)
	m := re.FindStringSubmatch(hash)
	if m == nil {
		t.Fatalf("senha_hash = %q, fora do formato", hash)
	}
	if strings.Contains(hash, senhaTeste) || criado != inicioTeste {
		t.Fatalf("senha_hash = %q, criado_em = %d", hash, criado)
	}

	// A mesma senha em outro usuário tem outro sal.
	criarAdmin(t, b, "outro", senhaTeste)
	var hash2 string
	b.db.QueryRow(`SELECT senha_hash FROM admins WHERE usuario = 'outro'`).Scan(&hash2)
	if m2 := re.FindStringSubmatch(hash2); m2 == nil || m2[1] == m[1] {
		t.Fatalf("o sal se repetiu: %q e %q", hash, hash2)
	}

	if err := b.CriarAdmin(ctx, "SUPORTE@starsonic", senhaTeste); !errors.Is(err, ErrJaExiste) {
		t.Fatalf("de novo: %v; queria ErrJaExiste", err)
	}
	// A senha conta caracteres, não bytes: 11 letras acentuadas são 22 bytes e não bastam.
	for _, s := range []string{"abcdefghijk", strings.Repeat("á", 11), ""} {
		if err := b.CriarAdmin(ctx, "curta", s); !errors.Is(err, ErrSenhaCurta) {
			t.Fatalf("senha %q: %v; queria ErrSenhaCurta", s, err)
		}
	}
	criarAdmin(t, b, "acentos", strings.Repeat("á", 12))
	for _, u := range []string{"", "   ", "com espaço", "joão", "a/b", strings.Repeat("a", 65)} {
		if err := b.CriarAdmin(ctx, u, senhaTeste); !errors.Is(err, ErrUsuario) {
			t.Fatalf("usuário %q: %v; queria ErrUsuario", u, err)
		}
	}
	criarAdmin(t, b, strings.Repeat("a", 64), senhaTeste)
	if n := contar(t, b, `SELECT COUNT(*) FROM admins`); n != 4 {
		t.Fatalf("%d usuários; queria 4", n)
	}
}

// phcCom monta um hash argon2id no formato PHC com os parâmetros dados (o sal e a chave não
// importam aqui).
func phcCom(m, tempo, p int) string {
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", m, tempo, p,
		base64.RawStdEncoding.EncodeToString([]byte("sal-de-teste-123")), base64.RawStdEncoding.EncodeToString(make([]byte, 32)))
}

// TestLerPHC_Teto: o que se lê de um hash guardado tem um teto, perto do padrão. Acima dele, o
// hash vale como malformado: m até 4 vezes o argonMemoria, t até 3 vezes o argonTempo e p até
// 4 vezes o argonThreads.
func TestLerPHC_Teto(t *testing.T) {
	for _, c := range []struct {
		nome     string
		m, tp, p int
		ok       bool
	}{
		{"o padrão", argonMemoria, argonTempo, argonThreads, true},
		{"no teto", 4 * argonMemoria, 3 * argonTempo, 4 * argonThreads, true},
		{"memória acima", 4*argonMemoria + 1, 1, 1, false},
		{"tempo acima", 8, 3*argonTempo + 1, 1, false},
		{"threads acima", 8 * (4*argonThreads + 1), 1, 4*argonThreads + 1, false},
		{"o teto de antes da memória", 1 << 20, 1, 1, false},
	} {
		if _, ok := lerPHC(phcCom(c.m, c.tp, c.p)); ok != c.ok {
			t.Errorf("%s (m=%d, t=%d, p=%d): lerPHC = %v; queria %v", c.nome, c.m, c.tp, c.p, ok, c.ok)
		}
	}
}

// TestConferirSenha_HashAcimaDoTeto: um hash guardado acima do teto é recusado como um
// malformado: sem pânico e sem argon2id daquele tamanho (a conferência não aloca os 256 MiB).
func TestConferirSenha_HashAcimaDoTeto(t *testing.T) {
	b := abrirTeste(t)
	m := 4*argonMemoria + 8 // KiB
	exec(t, b, `INSERT INTO admins (usuario, senha_hash, criado_em) VALUES ('suporte', ?, 1)`, phcCom(m, 1, 1))
	var antes, depois runtime.MemStats
	runtime.ReadMemStats(&antes)
	ok, trav, err := b.ConferirSenha(context.Background(), "suporte", senhaTeste)
	runtime.ReadMemStats(&depois)
	if ok || trav != 0 || err != nil {
		t.Fatalf("ConferirSenha = %v, %d, %v; queria false, 0, nil", ok, trav, err)
	}
	if alocou := depois.TotalAlloc - antes.TotalAlloc; alocou >= uint64(m)*1024/4 {
		t.Fatalf("a conferência alocou %d MiB: o argon2id rodou com o hash acima do teto", alocou>>20)
	}
}

func TestConferirSenha_Trava(t *testing.T) {
	b := abrirTeste(t)
	adminRapido(t, b, "suporte", senhaTeste)
	adminRapido(t, b, "outro", senhaTeste)

	if ok, trav := conferir(t, b, " SUPORTE ", senhaTeste); !ok || trav != 0 {
		t.Fatalf("a senha certa = %v, %d", ok, trav)
	}
	// Quatro erradas e a certa: a conta volta a zero.
	for i := 0; i < 4; i++ {
		if ok, trav := conferir(t, b, "suporte", senhaErrada); ok || trav != 0 {
			t.Fatalf("errada %d = %v, %d", i+1, ok, trav)
		}
	}
	if ok, _ := conferir(t, b, "suporte", senhaTeste); !ok {
		t.Fatal("a certa depois de 4 erradas não entrou")
	}
	// Cinco erradas seguidas: a quinta ainda responde como errada, e trava.
	for i := 0; i < 5; i++ {
		if ok, trav := conferir(t, b, "suporte", senhaErrada); ok || trav != 0 {
			t.Fatalf("errada %d = %v, %d", i+1, ok, trav)
		}
	}
	trava := inicioTeste + 15*60*1000
	if ok, trav := conferir(t, b, "suporte", senhaTeste); ok || trav != trava {
		t.Fatalf("a 6ª, certa = %v, %d; queria a trava até %d", ok, trav, trava)
	}
	// A trava é do usuário: o outro entra.
	if ok, _ := conferir(t, b, "outro", senhaTeste); !ok {
		t.Fatal("o outro usuário ficou travado")
	}
	// Uma tentativa durante a trava não a estica.
	avancar(b, 15*time.Minute-time.Millisecond)
	if ok, trav := conferir(t, b, "suporte", senhaTeste); ok || trav != trava {
		t.Fatalf("1 ms antes do fim = %v, %d", ok, trav)
	}
	avancar(b, time.Millisecond)
	if ok, trav := conferir(t, b, "suporte", senhaTeste); !ok || trav != 0 {
		t.Fatalf("no fim da trava = %v, %d; queria entrar", ok, trav)
	}
	// Destravado, a conta recomeça: mais quatro erradas não travam.
	for i := 0; i < 4; i++ {
		conferir(t, b, "suporte", senhaErrada)
	}
	if ok, _ := conferir(t, b, "suporte", senhaTeste); !ok {
		t.Fatal("a conta não recomeçou depois da trava")
	}
}

func TestConferirSenha_Desconhecido(t *testing.T) {
	b := abrirTeste(t)
	criarAdmin(t, b, "suporte", senhaTeste)

	// O usuário que não existe responde como a senha errada, e demora o mesmo: confere a
	// senha contra um hash falso.
	inicio := time.Now()
	if ok, trav := conferir(t, b, "suporte", senhaErrada); ok || trav != 0 {
		t.Fatalf("errada = %v, %d", ok, trav)
	}
	errada := time.Since(inicio)
	inicio = time.Now()
	if ok, trav := conferir(t, b, "ninguem", senhaTeste); ok || trav != 0 {
		t.Fatalf("desconhecido = %v, %d", ok, trav)
	}
	if d := time.Since(inicio); d < errada/10 {
		t.Fatalf("o desconhecido levou %v e a senha errada %v: dá para saber quem existe", d, errada)
	}
	// Um nome fora da regra também só responde que não.
	if ok, trav := conferir(t, b, strings.Repeat("x", 300), senhaTeste); ok || trav != 0 {
		t.Fatalf("nome fora da regra = %v, %d", ok, trav)
	}

	// A trava vale igual para quem não existe: a 6ª tentativa recebe a trava.
	for i := 0; i < 4; i++ {
		if ok, trav := conferir(t, b, "Ninguem", senhaErrada); ok || trav != 0 {
			t.Fatalf("tentativa %d = %v, %d", i+2, ok, trav)
		}
	}
	trava := inicioTeste + 15*60*1000
	if ok, trav := conferir(t, b, "ninguem", senhaTeste); ok || trav != trava {
		t.Fatalf("a 6ª do desconhecido = %v, %d; queria a trava até %d", ok, trav, trava)
	}
	avancar(b, 15*time.Minute)
	if ok, trav := conferir(t, b, "ninguem", senhaTeste); ok || trav != 0 {
		t.Fatalf("depois da trava = %v, %d", ok, trav)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM admins`); n != 1 {
		t.Fatalf("%d usuários: o desconhecido não pode entrar na tabela", n)
	}
}

// TestConferirSenha_MilNomes é o R29: a trava de um nome que não existe não sai da memória
// porque outros 1.000 nomes erraram depois dela; ela só sai quando vence. Se saísse, tentar o
// nome de novo diria que ele não existe (quem existe continuaria travado).
func TestConferirSenha_MilNomes(t *testing.T) {
	b := abrirTeste(t)
	hashFalsoBarato(t)
	for i := 0; i < 5; i++ {
		conferir(t, b, "ninguem", senhaErrada)
	}
	trava := inicioTeste + 15*60*1000
	if ok, trav := conferir(t, b, "ninguem", senhaTeste); ok || trav != trava {
		t.Fatalf("a 6ª = %v, %d; queria a trava até %d", ok, trav, trava)
	}
	milOutros(t, b)
	if ok, trav := conferir(t, b, "ninguem", senhaTeste); ok || trav != trava {
		t.Fatalf("depois de 1.000 outros nomes = %v, %d; queria a trava até %d", ok, trav, trava)
	}
	// A recusa não calcula o argon2id: com as duas vagas tomadas, ela volta na hora.
	soltar := semVagas(t)
	if ok, trav := conferirSemEsperar(t, b, "ninguem", senhaTeste); ok || trav != trava {
		t.Fatalf("com as vagas tomadas = %v, %d; queria a trava até %d", ok, trav, trava)
	}
	soltar()
}

// TestConferirSenha_IgualParaTodos é o R29: o nome que existe e o que não existe travam pela
// mesma regra e na mesma memória. Os dois travam com 5 erradas, continuam travados depois de
// 1.000 outros nomes, destravam 15 minutos depois e destravam num reinício (um Abrir novo).
func TestConferirSenha_IgualParaTodos(t *testing.T) {
	b := abrirTeste(t)
	hashFalsoBarato(t)
	adminRapido(t, b, "suporte", senhaTeste)
	nomes := []string{"suporte", "ninguem"}
	travar := func() {
		t.Helper()
		ate := b.agoraMs() + 15*60*1000
		for _, u := range nomes {
			for i := 0; i < 5; i++ {
				if ok, trav := conferir(t, b, u, senhaErrada); ok || trav != 0 {
					t.Fatalf("%s: a errada %d = %v, %d", u, i+1, ok, trav)
				}
			}
			if ok, trav := conferir(t, b, u, senhaTeste); ok || trav != ate {
				t.Fatalf("%s: a 6ª = %v, %d; queria a trava até %d", u, ok, trav, ate)
			}
		}
	}
	// livres confere que nenhum dos dois está travado no banco b: quem existe entra com a
	// senha certa, e quem não existe só ouve que não.
	livres := func(b *Banco, quando string) {
		t.Helper()
		for _, u := range nomes {
			if ok, trav := conferir(t, b, u, senhaTeste); trav != 0 || ok != (u == "suporte") {
				t.Fatalf("%s, %s = %v, %d; queria sem trava", quando, u, ok, trav)
			}
		}
	}

	travar()
	milOutros(t, b)
	for _, u := range nomes {
		if ok, trav := conferir(t, b, u, senhaTeste); ok || trav == 0 {
			t.Fatalf("depois de 1.000 outros nomes, %s = %v, %d; queria a trava", u, ok, trav)
		}
	}
	avancar(b, 15*time.Minute)
	livres(b, "15 minutos depois")

	// Travados de novo (depois de mais 15 minutos, para a conferência acima sair da conta), e
	// um reinício: o banco aberto de novo no mesmo arquivo começa sem trava nenhuma.
	avancar(b, 15*time.Minute)
	travar()
	b2, err := Abrir(b.caminho, b.relogio)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b2.Fechar() })
	livres(b2, "depois do reinício")
}

// TestConferirSenha_SemEscrita é o R29 (e o Minor 1 da revisão): a senha errada faz o mesmo
// trabalho para quem existe e para quem não existe (uma leitura, um argon2id e uma conta na
// memória), sem transação de escrita. Com outra conexão segurando a escrita do banco, as duas
// respondem na hora, e a certa também.
func TestConferirSenha_SemEscrita(t *testing.T) {
	b := abrirTeste(t)
	hashFalsoBarato(t)
	adminRapido(t, b, "suporte", senhaTeste)
	outra, err := sql.Open("sqlite", "file:"+b.caminho+"?_pragma=busy_timeout(5000)&_txlock=immediate")
	if err != nil {
		t.Fatal(err)
	}
	defer outra.Close()
	tx, err := outra.Begin() // BEGIN IMMEDIATE: a escrita fica com a outra conexão
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, c := range []struct {
		usuario, senha string
		ok             bool
	}{{"suporte", senhaErrada, false}, {"ninguem", senhaErrada, false}, {"suporte", senhaTeste, true}} {
		ok, trav, err := b.ConferirSenha(context.Background(), c.usuario, c.senha)
		if err != nil || ok != c.ok || trav != 0 {
			t.Fatalf("%s com a escrita presa = %v, %d, %v; queria %v sem erro", c.usuario, ok, trav, err, c.ok)
		}
	}
}

// TestConferirSenha_Juntos: tentativas juntas no mesmo nome não passam de 5 argon2id. A que
// esperava na fila reserva o seu lugar já com a vaga, e encontra a trava que as da frente
// fizeram.
func TestConferirSenha_Juntos(t *testing.T) {
	b := abrirTeste(t)
	hashFalsoBarato(t)
	var mu sync.Mutex
	var wg sync.WaitGroup
	calculadas, travadas := 0, 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, trav, err := b.ConferirSenha(context.Background(), "ninguem", senhaErrada)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil || ok:
				t.Errorf("= %v, %d, %v", ok, trav, err)
			case trav == 0:
				calculadas++
			default:
				travadas++
			}
		}()
	}
	wg.Wait()
	if calculadas != 5 || travadas != 15 {
		t.Fatalf("%d calcularam o hash e %d encontraram a trava; queria 5 e 15", calculadas, travadas)
	}
}

// TestConferirSenha_JanelaAnda: a regra é 5 erradas em 15 minutos (R29), e a trava vai até a
// mais velha delas fazer 15 minutos.
func TestConferirSenha_JanelaAnda(t *testing.T) {
	b := abrirTeste(t)
	adminRapido(t, b, "suporte", senhaTeste)
	errar := func(n int) {
		t.Helper()
		for i := 0; i < n; i++ {
			if ok, trav := conferir(t, b, "suporte", senhaErrada); ok || trav != 0 {
				t.Fatalf("errada = %v, %d", ok, trav)
			}
		}
	}
	// 4 erradas, e a 5ª só 15 minutos depois: as 4 já saíram da conta, e nada trava.
	errar(4)
	avancar(b, 15*time.Minute)
	errar(1)
	if ok, trav := conferir(t, b, "suporte", senhaTeste); !ok || trav != 0 {
		t.Fatalf("4 erradas e 1 depois de 15 minutos = %v, %d; queria entrar", ok, trav)
	}
	// 4 erradas agora e 1 daqui a 10 minutos: trava até as 4 fazerem 15 minutos, não 15
	// minutos depois da última.
	inicio := b.agoraMs()
	errar(4)
	avancar(b, 10*time.Minute)
	errar(1)
	if ok, trav := conferir(t, b, "suporte", senhaTeste); ok || trav != inicio+15*60*1000 {
		t.Fatalf("a trava = %v, %d; queria até %d", ok, trav, inicio+15*60*1000)
	}
	avancar(b, 5*time.Minute)
	if ok, trav := conferir(t, b, "suporte", senhaTeste); !ok || trav != 0 {
		t.Fatalf("quando as 4 fizeram 15 minutos = %v, %d; queria entrar", ok, trav)
	}
}

func TestTrocarSenha(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	adminRapido(t, b, "suporte", senhaTeste)
	adminRapido(t, b, "outro", senhaTeste)
	token, _, err := b.CriarSessao(ctx, "suporte")
	if err != nil {
		t.Fatal(err)
	}
	tokenOutro, _, err := b.CriarSessao(ctx, "outro")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		conferir(t, b, "suporte", senhaErrada) // travado
	}

	const nova = "outra-senha-inventada-2"
	if err := b.TrocarSenha(ctx, " Suporte ", nova); err != nil {
		t.Fatal(err)
	}
	// A troca não destrava (R29): a trava fica na memória do servidor, e o admin-senha roda em
	// outro processo. Ela acaba sozinha em 15 minutos; aí a nova entra, e a antiga não.
	if ok, trav := conferir(t, b, "suporte", nova); ok || trav != inicioTeste+15*60*1000 {
		t.Fatalf("logo depois da troca = %v, %d; queria a trava, que a troca não solta", ok, trav)
	}
	avancar(b, 15*time.Minute)
	if ok, _ := conferir(t, b, "suporte", nova); !ok {
		t.Fatal("a senha nova não entrou")
	}
	if ok, _ := conferir(t, b, "suporte", senhaTeste); ok {
		t.Fatal("a senha antiga ainda entra")
	}
	// As sessões do usuário saem; as do outro ficam.
	if _, err := b.Sessao(ctx, token); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("a sessão de antes da troca: %v; queria ErrNaoEncontrado", err)
	}
	if _, err := b.Sessao(ctx, tokenOutro); err != nil {
		t.Fatalf("a sessão do outro: %v", err)
	}

	if err := b.TrocarSenha(ctx, "ninguem", nova); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("usuário que não existe: %v", err)
	}
	if err := b.TrocarSenha(ctx, "suporte", "curta"); !errors.Is(err, ErrSenhaCurta) {
		t.Fatalf("senha curta: %v", err)
	}
	if ok, _ := conferir(t, b, "suporte", nova); !ok {
		t.Fatal("a senha curta recusada mudou a senha")
	}
}

func TestRemoverAdmin(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	adminRapido(t, b, "suporte", senhaTeste)
	adminRapido(t, b, "outro", senhaTeste)
	token, _, _ := b.CriarSessao(ctx, "suporte")
	tokenOutro, _, _ := b.CriarSessao(ctx, "outro")

	if err := b.RemoverAdmin(ctx, "SUPORTE"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Sessao(ctx, token); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("a sessão de quem saiu: %v", err)
	}
	if _, err := b.Sessao(ctx, tokenOutro); err != nil {
		t.Fatalf("a sessão do outro: %v", err)
	}
	if ok, _ := conferir(t, b, "suporte", senhaTeste); ok {
		t.Fatal("o usuário removido entrou")
	}
	if err := b.RemoverAdmin(ctx, "suporte"); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("de novo: %v", err)
	}
}

func TestSessao(t *testing.T) {
	b := abrirTeste(t)
	ctx := context.Background()
	adminRapido(t, b, "suporte", senhaTeste)

	token, s, err := b.CriarSessao(ctx, " Suporte ")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	if !re.MatchString(token) || !re.MatchString(s.CSRF) || token == s.CSRF {
		t.Fatalf("token %q, csrf %q", token, s.CSRF)
	}
	if s.Usuario != "suporte" || s.ExpiraEm != inicioTeste+12*60*60*1000 {
		t.Fatalf("sessão = %+v", s)
	}
	// O banco guarda só o SHA-256 do token.
	if n := contar(t, b, `SELECT COUNT(*) FROM sessoes_admin WHERE token_hash = ?`, segredo.Hash(token)); n != 1 {
		t.Fatalf("%d sessões com o hash do token", n)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM sessoes_admin WHERE token_hash = ? OR CAST(token_hash AS TEXT) = ? OR csrf = ?`,
		[]byte(token), token, token); n != 0 {
		t.Fatal("o token ficou no banco")
	}

	got, err := b.Sessao(ctx, token)
	if err != nil || got != s {
		t.Fatalf("Sessao = %+v, %v; queria %+v", got, err, s)
	}
	if _, err := b.Sessao(ctx, segredo.NovoToken()); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("token desconhecido: %v", err)
	}
	// Duas sessões do mesmo usuário são independentes.
	token2, s2, _ := b.CriarSessao(ctx, "suporte")
	if token2 == token || s2.CSRF == s.CSRF {
		t.Fatal("a segunda sessão repetiu o token ou o csrf")
	}
	if err := b.ApagarSessao(ctx, token2); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Sessao(ctx, token2); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("depois de apagar: %v", err)
	}

	// A sessão dura 12 horas, nem 1 ms a mais.
	avancar(b, 12*time.Hour-time.Millisecond)
	if _, err := b.Sessao(ctx, token); err != nil {
		t.Fatalf("1 ms antes de vencer: %v", err)
	}
	avancar(b, time.Millisecond)
	if _, err := b.Sessao(ctx, token); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("vencida: %v", err)
	}
	// A próxima sessão criada leva as vencidas embora.
	if _, _, err := b.CriarSessao(ctx, "suporte"); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, b, `SELECT COUNT(*) FROM sessoes_admin`); n != 1 {
		t.Fatalf("%d sessões; a vencida devia sair", n)
	}
	if _, _, err := b.CriarSessao(ctx, "ninguem"); err == nil {
		t.Fatal("sessão de um usuário que não existe")
	}
}
