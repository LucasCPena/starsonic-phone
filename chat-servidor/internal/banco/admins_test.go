package banco

import (
	"context"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
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
	// A troca destrava e zera a conta: a nova entra já, e uma errada não trava.
	if ok, _ := conferir(t, b, "suporte", nova); !ok {
		t.Fatal("a senha nova não entrou")
	}
	conferir(t, b, "suporte", senhaErrada)
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
