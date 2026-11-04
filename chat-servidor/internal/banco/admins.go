package banco

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// As regras da página de administração (as Global Constraints do plano e o R29).
const (
	minSenha      = 12               // caracteres (pontos de código), não bytes
	maxErros      = 5                // senhas erradas em duracaoTrava que travam o nome
	duracaoTrava  = 15 * time.Minute // a janela delas: a trava vai até a mais velha fazer 15 minutos
	duracaoSessao = 12 * time.Hour
)

// O argon2id da senha, no formato PHC: $argon2id$v=19$m=65536,t=3,p=2$<sal>$<hash>, com o sal
// e o hash em base64 sem o "=".
const (
	argonTempo   = 3
	argonMemoria = 64 * 1024 // KiB
	argonThreads = 2
	argonChave   = 32 // bytes
	argonSal     = 16 // bytes
)

// hashFalso é conferido quando o usuário não existe, para essa resposta demorar o mesmo que a
// de uma senha errada. O sal e o hash são bytes sorteados uma vez, sem senha nenhuma por trás,
// e o resultado é jogado fora: com ele, ninguém entra. É uma variável só para os testes do
// pacote trocarem por um hash barato quando precisam de muitas tentativas.
var hashFalso = "$argon2id$v=19$m=65536,t=3,p=2$dSSza1Q6riOsoBKCFuzZ3Q$NgW3KnOJ9L8d2UPPxtn4O2dLSxdsnJqU6XIWcaCOM0w"

// vagasArgon deixa só 2 cálculos do argon2id por vez no processo. Cada um usa 64 MiB: uma
// enxurrada de tentativas de entrar fica na fila, sem esgotar a memória do servidor.
var vagasArgon = make(chan struct{}, 2)

var (
	// ErrUsuario diz que o nome do usuário está fora da regra (veja NormalizarUsuario).
	ErrUsuario = errors.New("banco: usuário fora da regra")
	// ErrSenhaCurta diz que a senha tem menos de 12 caracteres.
	ErrSenhaCurta = errors.New("banco: a senha precisa ter pelo menos 12 caracteres")
	// ErrJaExiste diz que já há um usuário com esse nome.
	ErrJaExiste = errors.New("banco: o usuário já existe")
)

// SessaoAdmin é uma sessão da página de administração. O banco guarda só o SHA-256 do token;
// o CSRF vai nos formulários da sessão.
type SessaoAdmin struct {
	Usuario, CSRF string
	ExpiraEm      int64 // ms UTC
}

// NormalizarUsuario confere o nome de um usuário da administração e o devolve sem os espaços
// das pontas e em minúsculas: de 1 a 64 caracteres entre letras sem acento, números, ponto,
// hífen, sublinhado e arroba.
func NormalizarUsuario(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 1 || len(s) > 64 {
		return "", false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		letra := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
		if !letra && (c < '0' || c > '9') && !strings.ContainsRune(".-_@", rune(c)) {
			return "", false
		}
	}
	return strings.ToLower(s), true
}

// ocupar espera uma das vagas do argon2id, até o ctx acabar; soltar a devolve.
func ocupar(ctx context.Context) error {
	select {
	case vagasArgon <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func soltar() { <-vagasArgon }

// hashSenha faz o hash argon2id da senha, com um sal novo, no formato PHC. Toma uma vaga do
// argon2id: nunca chame dentro de uma Tx, porque quem tem a vaga também espera pela conexão.
func hashSenha(ctx context.Context, senha string) (string, error) {
	sal := make([]byte, argonSal)
	if _, err := rand.Read(sal); err != nil {
		return "", err
	}
	if err := ocupar(ctx); err != nil {
		return "", err
	}
	chave := argon2.IDKey([]byte(senha), sal, argonTempo, argonMemoria, argonThreads, argonChave)
	soltar()
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemoria, argonTempo, argonThreads,
		base64.RawStdEncoding.EncodeToString(sal), base64.RawStdEncoding.EncodeToString(chave)), nil
}

// phc são as partes de um hash argon2id no formato PHC.
type phc struct {
	m, t       uint32
	p          uint8
	sal, chave []byte
}

// lerPHC lê um $argon2id$v=19$m=…,t=…,p=…$<sal>$<hash>. Fora desse formato, ou com parâmetros
// fora do razoável (um banco estragado não aloca memória sem fim), não lê.
func lerPHC(s string) (phc, bool) {
	partes := strings.Split(s, "$")
	if len(partes) != 6 || partes[0] != "" || partes[1] != "argon2id" || partes[2] != "v=19" {
		return phc{}, false
	}
	var h phc
	for i, kv := range strings.Split(partes[3], ",") {
		k, v, ok := strings.Cut(kv, "=")
		n, err := strconv.ParseUint(v, 10, 32)
		switch {
		case !ok || err != nil:
			return phc{}, false
		case i == 0 && k == "m":
			h.m = uint32(n)
		case i == 1 && k == "t":
			h.t = uint32(n)
		case i == 2 && k == "p" && n <= 255:
			h.p = uint8(n)
		default:
			return phc{}, false
		}
	}
	var err1, err2 error
	h.sal, err1 = base64.RawStdEncoding.DecodeString(partes[4])
	h.chave, err2 = base64.RawStdEncoding.DecodeString(partes[5])
	if err1 != nil || err2 != nil || h.t < 1 || h.t > 10 || h.p < 1 || h.m < 8*uint32(h.p) || h.m > 1<<20 ||
		len(h.sal) < 8 || len(h.chave) < 16 || len(h.chave) > 64 {
		return phc{}, false
	}
	return h, true
}

// confere diz se a senha bate com o hash guardado, comparando em tempo constante. Um hash que
// não dá para ler não bate. Quem chama já tem a vaga do argon2id.
func confere(guardado, senha string) bool {
	h, ok := lerPHC(guardado)
	if !ok {
		return false
	}
	chave := argon2.IDKey([]byte(senha), h.sal, h.t, h.m, h.p, uint32(len(h.chave)))
	return subtle.ConstantTimeCompare(chave, h.chave) == 1
}

// SenhaValida confere a regra da senha: pelo menos 12 caracteres (pontos de código, não
// bytes). Fora dela, dá ErrSenhaCurta.
func SenhaValida(s string) error {
	if utf8.RuneCountInString(s) < minSenha {
		return ErrSenhaCurta
	}
	return nil
}

// CriarAdmin cria um usuário da página de administração, com a senha guardada só no hash
// argon2id. Um nome fora da regra dá ErrUsuario; uma senha de menos de 12 caracteres,
// ErrSenhaCurta; um nome que já existe, ErrJaExiste.
func (b *Banco) CriarAdmin(ctx context.Context, usuario, senha string) error {
	u, ok := NormalizarUsuario(usuario)
	if !ok {
		return ErrUsuario
	}
	if err := SenhaValida(senha); err != nil {
		return err
	}
	hash, err := hashSenha(ctx, senha)
	if err != nil {
		return err
	}
	r, err := b.db.ExecContext(ctx,
		`INSERT INTO admins (usuario, senha_hash, criado_em) VALUES (?, ?, ?) ON CONFLICT (usuario) DO NOTHING`,
		u, hash, b.agoraMs())
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrJaExiste
	}
	return nil
}

// TrocarSenha troca a senha do usuário e encerra as sessões dele. Ela não destrava o nome: a
// trava das senhas erradas fica só na memória do servidor (veja ConferirSenha), e o admin-senha
// roda em outro processo. A trava acaba sozinha, em até 15 minutos. Um usuário que não existe
// dá ErrNaoEncontrado.
func (b *Banco) TrocarSenha(ctx context.Context, usuario, senha string) error {
	u, ok := NormalizarUsuario(usuario)
	if !ok {
		return ErrUsuario
	}
	if err := SenhaValida(senha); err != nil {
		return err
	}
	hash, err := hashSenha(ctx, senha) // fora da Tx: veja hashSenha
	if err != nil {
		return err
	}
	return b.Tx(ctx, func(tx *sql.Tx) error {
		r, err := tx.ExecContext(ctx, `UPDATE admins SET senha_hash = ? WHERE usuario = ?`, hash, u)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNaoEncontrado
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM sessoes_admin WHERE usuario = ?`, u)
		return err
	})
}

// RemoverAdmin apaga o usuário; as sessões dele saem junto (ON DELETE CASCADE). Um usuário
// que não existe dá ErrNaoEncontrado.
func (b *Banco) RemoverAdmin(ctx context.Context, usuario string) error {
	u, ok := NormalizarUsuario(usuario)
	if !ok {
		return ErrUsuario
	}
	r, err := b.db.ExecContext(ctx, `DELETE FROM admins WHERE usuario = ?`, u)
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNaoEncontrado
	}
	return nil
}

// ConferirSenha confere a senha do usuário. ok diz se ela confere. Com o nome travado, a senha
// nem é conferida: ok é false e travadoAte (ms UTC) diz até quando a trava vai; fora isso,
// travadoAte é 0.
//
// A trava (R29) é uma memória só, a b.erradas, para todo nome válido já normalizado, exista ele
// ou não, com uma regra só: 5 senhas erradas em 15 minutos travam o nome até a mais velha delas
// fazer 15 minutos (a janela anda, como toda limites.Janela). A 5ª ainda responde como errada.
// Uma tentativa recusada pela trava não conta e não calcula o argon2id; a senha certa zera a
// conta do nome. Uma conta sai da memória só depois de vencer, nunca por um teto: quem limita o
// tamanho é o tempo, porque uma conta nova só nasce dentro de uma vaga do argon2id (e a página
// ainda limita cada endereço). Nada disso vai para o banco: um reinício solta todas as travas
// igual, e o admin-senha, que roda em outro processo, não destrava o servidor.
//
// O nome que não existe responde como a senha errada e faz o mesmo trabalho: uma leitura, um
// argon2id (contra um hash falso) e uma conta na memória, sem transação de escrita. Assim, nem
// a resposta, nem a demora, nem a trava dizem quem existe. O nome fora da regra não tem conta:
// vai direto ao hash falso.
//
// A ordem: a trava do nome, antes da vaga, para o nome travado nem esperar; a vaga do argon2id;
// a trava de novo, já reservando o lugar desta tentativa, para as que esperavam na fila
// encontrarem a trava que as da frente fizeram; e o hash, comparado em tempo constante.
func (b *Banco) ConferirSenha(ctx context.Context, usuario, senha string) (ok bool, travadoAte int64, err error) {
	u, valido := NormalizarUsuario(usuario)
	if valido {
		if livre, esperar := b.erradas.Cabe(u, 1); !livre {
			return false, b.agoraMs() + esperar.Milliseconds(), nil
		}
	}
	if err := ocupar(ctx); err != nil {
		return false, 0, err
	}
	defer soltar()
	if !valido {
		confere(hashFalso, senha)
		return false, 0, nil
	}
	if livre, esperar := b.erradas.Usar(u, 1); !livre {
		return false, b.agoraMs() + esperar.Milliseconds(), nil
	}
	guardado, existe := "", true
	err = b.db.QueryRowContext(ctx, `SELECT senha_hash FROM admins WHERE usuario = ?`, u).Scan(&guardado)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		guardado, existe = hashFalso, false // confere igual, e não entra
	case err != nil:
		b.erradas.Devolver(u, 1) // não houve tentativa
		return false, 0, err
	}
	if !confere(guardado, senha) || !existe {
		return false, 0, nil // a errada fica na conta do nome
	}
	// A senha confere com o hash lido antes do argon2id. Se alguém trocou a senha (ou removeu o
	// usuário) nesse meio-tempo, o resultado não vale, e a tentativa não conta.
	var agora string
	if err := b.db.QueryRowContext(ctx, `SELECT senha_hash FROM admins WHERE usuario = ?`, u).Scan(&agora); err != nil || agora != guardado {
		b.erradas.Devolver(u, 1)
		if errors.Is(err, sql.ErrNoRows) {
			err = nil
		}
		return false, 0, err
	}
	b.erradas.Zerar(u)
	return true, 0, nil
}

// CriarSessao abre uma sessão de 12 horas para o usuário e devolve o token, que vai no
// cookie e de que o banco guarda só o SHA-256. As sessões vencidas saem aqui. Um usuário que
// não existe dá ErrNaoEncontrado.
func (b *Banco) CriarSessao(ctx context.Context, usuario string) (token string, s SessaoAdmin, err error) {
	u, ok := NormalizarUsuario(usuario)
	if !ok {
		return "", SessaoAdmin{}, ErrUsuario
	}
	agora := b.agoraMs()
	token = segredo.NovoToken()
	s = SessaoAdmin{Usuario: u, CSRF: segredo.NovoToken(), ExpiraEm: agora + duracaoSessao.Milliseconds()}
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessoes_admin WHERE expira_em <= ?`, agora); err != nil {
			return err
		}
		r, err := tx.ExecContext(ctx,
			`INSERT INTO sessoes_admin (token_hash, usuario, csrf, expira_em)
			 SELECT ?, usuario, ?, ? FROM admins WHERE usuario = ?`, segredo.Hash(token), s.CSRF, s.ExpiraEm, u)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNaoEncontrado
		}
		return nil
	})
	if err != nil {
		return "", SessaoAdmin{}, err
	}
	return token, s, nil
}

// Sessao acha a sessão do token, se ela não venceu. Senão, dá ErrNaoEncontrado.
func (b *Banco) Sessao(ctx context.Context, token string) (SessaoAdmin, error) {
	var s SessaoAdmin
	err := b.db.QueryRowContext(ctx,
		`SELECT usuario, csrf, expira_em FROM sessoes_admin WHERE token_hash = ? AND expira_em > ?`,
		segredo.Hash(token), b.agoraMs()).Scan(&s.Usuario, &s.CSRF, &s.ExpiraEm)
	if errors.Is(err, sql.ErrNoRows) {
		return SessaoAdmin{}, ErrNaoEncontrado
	}
	if err != nil {
		return SessaoAdmin{}, err
	}
	return s, nil
}

// ApagarSessao encerra a sessão do token. Sem ela, não faz nada.
func (b *Banco) ApagarSessao(ctx context.Context, token string) error {
	_, err := b.db.ExecContext(ctx, `DELETE FROM sessoes_admin WHERE token_hash = ?`, segredo.Hash(token))
	return err
}
