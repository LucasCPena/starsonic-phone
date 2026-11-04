// Package bancotest conta as linhas de cada empresa em todas as tabelas do banco, para os
// testes do "Apagar a empresa" (no banco e na página). A lista das tabelas vem do
// sqlite_master: uma tabela que não tem regra aqui falha o teste, e um dado de empresa novo não
// escapa deles. Só os testes usam. Não importa o banco, para os testes de dentro dele também
// poderem usar.
package bancotest

import (
	"database/sql"
	"fmt"
	"slices"
	"testing"
)

// semEmpresa são as únicas tabelas sem dados de empresa: os usuários e as sessões da página de
// administração, e a sequência dos ids do SQLite (a do AUTOINCREMENT).
var semEmpresa = []string{"admins", "sessoes_admin", "sqlite_sequence"}

// daEmpresa diz, para cada tabela com dados de empresa, como contar as linhas que são da
// empresa do ?.
var daEmpresa = map[string]string{
	"empresas":           `SELECT COUNT(*) FROM empresas WHERE id = ?`,
	"pessoas":            `SELECT COUNT(*) FROM pessoas WHERE empresa_id = ?`,
	"computadores":       `SELECT COUNT(*) FROM computadores WHERE empresa_id = ?`,
	"computador_pessoas": `SELECT COUNT(*) FROM computador_pessoas x JOIN computadores c ON c.id = x.computador_id WHERE c.empresa_id = ?`,
	"conversas":          `SELECT COUNT(*) FROM conversas WHERE empresa_id = ?`,
	"membros":            `SELECT COUNT(*) FROM membros x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
	"mensagens":          `SELECT COUNT(*) FROM mensagens x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
	"arquivos":           `SELECT COUNT(*) FROM arquivos WHERE empresa_id = ?`,
	"leituras":           `SELECT COUNT(*) FROM leituras x JOIN conversas c ON c.id = x.conversa_id WHERE c.empresa_id = ?`,
}

// Tabelas são as tabelas do banco com dados de empresa, lidas do sqlite_master, em ordem de
// nome. Uma tabela que não está nem em daEmpresa nem em semEmpresa é um erro, e uma regra para
// uma tabela que não existe também.
func Tabelas(db *sql.DB) ([]string, error) {
	linhas, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	var tabelas []string
	for linhas.Next() {
		var nome string
		if err := linhas.Scan(&nome); err != nil {
			return nil, err
		}
		if slices.Contains(semEmpresa, nome) {
			continue
		}
		if _, ok := daEmpresa[nome]; !ok {
			return nil, fmt.Errorf("bancotest: a tabela %s não tem regra: diga em daEmpresa como contar as linhas de uma empresa nela", nome)
		}
		tabelas = append(tabelas, nome)
	}
	if err := linhas.Err(); err != nil {
		return nil, err
	}
	if len(tabelas) != len(daEmpresa) {
		return nil, fmt.Errorf("bancotest: há regra para uma tabela que não existe: as tabelas são %v", tabelas)
	}
	return tabelas, nil
}

// DaEmpresa conta as linhas de cada tabela com dados de empresa que são da empresa.
func DaEmpresa(t testing.TB, db *sql.DB, empresaID int64) map[string]int {
	t.Helper()
	n := map[string]int{}
	for _, tabela := range tabelas(t, db) {
		n[tabela] = contar(t, db, daEmpresa[tabela], empresaID)
	}
	return n
}

// Total conta as linhas de cada tabela com dados de empresa, de todas as empresas.
func Total(t testing.TB, db *sql.DB) map[string]int {
	t.Helper()
	n := map[string]int{}
	for _, tabela := range tabelas(t, db) {
		n[tabela] = contar(t, db, `SELECT COUNT(*) FROM `+tabela)
	}
	return n
}

func tabelas(t testing.TB, db *sql.DB) []string {
	t.Helper()
	l, err := Tabelas(db)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func contar(t testing.TB, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}
