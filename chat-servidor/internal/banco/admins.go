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
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// As regras da página de administração (as Global Constraints do plano).
const (
	minSenha      = 12               // caracteres (pontos de código), não bytes
	maxErros      = 5                // senhas erradas seguidas que travam o usuário
	duracaoTrava  = 15 * time.Minute // e por quanto tempo
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
// e o resultado é jogado fora: com ele, ninguém entra.
const hashFalso = "$argon2id$v=19$m=65536,t=3,p=2$dSSza1Q6riOsoBKCFuzZ3Q$NgW3KnOJ9L8d2UPPxtn4O2dLSxdsnJqU6XIWcaCOM0w"

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

// TrocarSenha troca a senha do usuário, destrava e zera as senhas erradas dele, e encerra as
// sessões dele. Um usuário que não existe dá ErrNaoEncontrado.
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
		r, err := tx.ExecContext(ctx,
			`UPDATE admins SET senha_hash = ?, erros = 0, travado_ate = 0 WHERE usuario = ?`, hash, u)
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

// ConferirSenha confere a senha do usuário. ok diz se ela confere. Com o usuário travado, a
// senha nem é conferida: ok é false e travadoAte (ms UTC) diz até quando a trava vai; fora
// isso, travadoAte é 0. A 5ª senha errada seguida trava o usuário por 15 minutos, e ainda
// responde como errada; a certa zera a conta.
//
// O usuário que não existe (ou fora da regra) responde como a senha errada, e demora o mesmo:
// a senha é conferida contra um hash falso. As tentativas com um nome que não existe também
// travam, na memória, pela mesma regra. Assim, nem a resposta, nem a demora, nem a trava dizem
// quem existe.
//
// Tudo corre dentro de uma das vagas do argon2id: a trava é lida já com a vaga, então as
// tentativas que esperavam na fila encontram a trava, sem calcular o hash.
func (b *Banco) ConferirSenha(ctx context.Context, usuario, senha string) (ok bool, travadoAte int64, err error) {
	if err := ocupar(ctx); err != nil {
		return false, 0, err
	}
	defer soltar()
	agora := b.agoraMs()
	u, valido := NormalizarUsuario(usuario)
	if !valido {
		confere(hashFalso, senha)
		return false, 0, nil
	}
	var guardado string
	var travado int64
	err = b.db.QueryRowContext(ctx, `SELECT senha_hash, travado_ate FROM admins WHERE usuario = ?`, u).
		Scan(&guardado, &travado)
	if errors.Is(err, sql.ErrNoRows) {
		if t := b.falsas.tentar(u, agora); t != 0 {
			return false, t, nil
		}
		confere(hashFalso, senha)
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	if travado > agora {
		return false, travado, nil
	}
	certa := confere(guardado, senha)

	// Grava o resultado conferindo de novo: a outra vaga pode ter travado o usuário, ou
	// alguém trocado a senha, enquanto o hash era calculado. Aí este resultado não vale.
	err = b.Tx(ctx, func(tx *sql.Tx) error {
		var hashAgora string
		var erros int
		err := tx.QueryRowContext(ctx, `SELECT senha_hash, erros, travado_ate FROM admins WHERE usuario = ?`, u).
			Scan(&hashAgora, &erros, &travado)
		switch {
		case errors.Is(err, sql.ErrNoRows): // removido no meio
			return nil
		case err != nil:
			return err
		case travado > agora:
			travadoAte = travado
			return nil
		case hashAgora != guardado:
			return nil
		case certa:
			ok = true
			_, err = tx.ExecContext(ctx, `UPDATE admins SET erros = 0, travado_ate = 0 WHERE usuario = ?`, u)
			return err
		case erros+1 >= maxErros:
			_, err = tx.ExecContext(ctx, `UPDATE admins SET erros = 0, travado_ate = ? WHERE usuario = ?`,
				agora+duracaoTrava.Milliseconds(), u)
			return err
		default:
			_, err = tx.ExecContext(ctx, `UPDATE admins SET erros = ? WHERE usuario = ?`, erros+1, u)
			return err
		}
	})
	if err != nil {
		return false, 0, err
	}
	return ok, travadoAte, nil
}

// maxFalsas é quantos nomes que não existem a memória guarda. Passando disso, a lista
// recomeça: só um ataque chega lá, e recomeçar não lhe diz nada sobre quem existe.
const maxFalsas = 1000

// tentativasFalsas são as tentativas com nomes que não existem, só na memória.
type tentativasFalsas struct {
	mu    sync.Mutex
	nomes map[string]*tentativaFalsa
}

type tentativaFalsa struct {
	erros      int
	travadoAte int64
}

// tentar devolve a trava do nome, se ele está travado; se não, conta mais uma tentativa
// errada, que na 5ª trava, e devolve 0. É a regra do ConferirSenha.
func (f *tentativasFalsas) tentar(nome string, agora int64) (travadoAte int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := f.nomes[nome]
	if t == nil {
		if f.nomes == nil || len(f.nomes) >= maxFalsas {
			f.nomes = map[string]*tentativaFalsa{}
		}
		t = &tentativaFalsa{}
		f.nomes[nome] = t
	}
	if t.travadoAte > agora {
		return t.travadoAte
	}
	if t.erros++; t.erros >= maxErros {
		t.erros, t.travadoAte = 0, agora+duracaoTrava.Milliseconds()
	}
	return 0
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
