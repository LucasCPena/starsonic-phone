package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/tempo"
)

func TestVersao(t *testing.T) {
	var saida bytes.Buffer
	if cod := run([]string{"versao"}, strings.NewReader(""), &saida, io.Discard); cod != 0 {
		t.Fatalf("código %d", cod)
	}
	if saida.String() != "0.0.0-dev\n" {
		t.Fatalf("saída %q", saida.String())
	}
}

func TestSubcomandoDesconhecido(t *testing.T) {
	for _, args := range [][]string{{"xis"}, {}} {
		var saida bytes.Buffer
		if cod := run(args, strings.NewReader(""), &saida, io.Discard); cod != 2 {
			t.Fatalf("%v: código %d, esperava 2", args, cod)
		}
		if !strings.Contains(saida.String(), "uso:") {
			t.Fatalf("%v: o uso não foi escrito: %q", args, saida.String())
		}
	}
}

// As senhas dos testes são inventadas e valem só aqui.
const (
	senha12 = "senha-teste1" // 12 caracteres
	senha11 = "senha-de-11"  // 11
)

// rodar roda o subcomando com a entrada dada e devolve o código e a saída.
func rodar(t *testing.T, entrada string, args ...string) (int, string) {
	t.Helper()
	cod, saida, _ := rodarComErros(t, entrada, args...)
	return cod, saida
}

// rodarComErros roda o subcomando e devolve o código, a saída e a saída de erros.
func rodarComErros(t *testing.T, entrada string, args ...string) (cod int, saida, erros string) {
	t.Helper()
	var s, e bytes.Buffer
	cod = run(args, strings.NewReader(entrada), &s, &e)
	return cod, s.String(), e.String()
}

// TestAdmin_PerguntasNoErro: as perguntas da senha vão para a saída de erros, e a saída padrão
// fica só com o resultado: redirecionar a saída não esconde as perguntas.
func TestAdmin_PerguntasNoErro(t *testing.T) {
	dados := t.TempDir()
	cod, saida, erros := rodarComErros(t, senha12+"\n"+senha12+"\n", "admin-criar", "suporte", "--dados", dados)
	if cod != 0 {
		t.Fatalf("código %d, saída %q, erros %q", cod, saida, erros)
	}
	for _, p := range []string{"Senha: ", "Repita a senha: "} {
		if strings.Contains(saida, p) {
			t.Errorf("a pergunta %q foi para a saída padrão: %q", p, saida)
		}
		if !strings.Contains(erros, p) {
			t.Errorf("a pergunta %q não foi para a saída de erros: %q", p, erros)
		}
	}
	if !strings.Contains(saida, "Usuário suporte criado.") {
		t.Errorf("o resultado não ficou na saída padrão: %q", saida)
	}
	if strings.Contains(saida+erros, senha12) {
		t.Error("a senha apareceu numa das saídas")
	}
}

// abrir abre o banco da pasta de dados, como o servidor abre.
func abrir(t *testing.T, dados string) *banco.Banco {
	t.Helper()
	b, err := banco.Abrir(filepath.Join(dados, "chat.db"), tempo.Real())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Fechar() })
	return b
}

func conferir(t *testing.T, dados, usuario, senha string) bool {
	t.Helper()
	ok, _, err := abrir(t, dados).ConferirSenha(context.Background(), usuario, senha)
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestAdminCriar(t *testing.T) {
	dados := t.TempDir()
	cod, saida := rodar(t, senha11+"\n"+senha11+"\n", "admin-criar", "suporte", "--dados", dados)
	if cod == 0 || !strings.Contains(saida, "A senha precisa ter pelo menos 12 caracteres.") {
		t.Fatalf("11 caracteres: código %d, saída %q", cod, saida)
	}
	if _, err := os.Stat(filepath.Join(dados, "chat.db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a senha curta abriu o banco: %v", err)
	}

	cod, saida = rodar(t, senha12+"\n"+senha12+"\n", "admin-criar", "suporte", "--dados", dados)
	if cod != 0 || strings.Contains(saida, senha12) {
		t.Fatalf("12 caracteres: código %d, saída %q", cod, saida)
	}
	db, err := sql.Open("sqlite", filepath.Join(dados, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var hash string
	if err := db.QueryRow(`SELECT senha_hash FROM admins WHERE usuario = 'suporte'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatalf("senha_hash = %q", hash)
	}
	if !conferir(t, dados, "suporte", senha12) {
		t.Fatal("a senha criada não entra")
	}

	// De novo, o mesmo usuário: erro, e a senha continua a primeira.
	cod, saida = rodar(t, "outra-senha-2\noutra-senha-2\n", "admin-criar", "suporte", "--dados", dados)
	if cod != 1 || !strings.Contains(saida, "já existe") {
		t.Fatalf("de novo: código %d, saída %q", cod, saida)
	}
	if !conferir(t, dados, "suporte", senha12) {
		t.Fatal("o admin-criar repetido trocou a senha")
	}
}

func TestAdminCriar_SenhasDiferentes(t *testing.T) {
	dados := t.TempDir()
	cod, saida := rodar(t, senha12+"\nsenha-teste2\n", "admin-criar", "suporte", "--dados", dados)
	if cod != 1 || !strings.Contains(saida, "As senhas não são iguais.") {
		t.Fatalf("código %d, saída %q", cod, saida)
	}
	// Sem a segunda senha, também não cria.
	cod, saida = rodar(t, senha12+"\n", "admin-criar", "suporte", "--dados", dados)
	if cod != 1 {
		t.Fatalf("sem a segunda senha: código %d, saída %q", cod, saida)
	}
	if _, err := os.Stat(filepath.Join(dados, "chat.db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("o banco foi aberto sem senha certa: %v", err)
	}
}

func TestAdminSenha(t *testing.T) {
	dados := t.TempDir()
	if cod, saida := rodar(t, senha12+"\r\n"+senha12+"\r\n", "admin-criar", "--dados", dados, "suporte"); cod != 0 {
		t.Fatalf("criar: código %d, saída %q", cod, saida)
	}
	const nova = "outra-senha-de-teste"
	cod, saida := rodar(t, nova+"\n"+nova+"\n", "admin-senha", "suporte", "--dados", dados)
	if cod != 0 || strings.Contains(saida, nova) {
		t.Fatalf("trocar: código %d, saída %q", cod, saida)
	}
	if conferir(t, dados, "suporte", senha12) || !conferir(t, dados, "suporte", nova) {
		t.Fatal("a senha não mudou")
	}
	if cod, saida := rodar(t, nova+"\n"+nova+"\n", "admin-senha", "ninguem", "--dados", dados); cod != 1 || !strings.Contains(saida, "não existe") {
		t.Fatalf("usuário que não existe: código %d, saída %q", cod, saida)
	}
	if cod, saida := rodar(t, senha11+"\n"+senha11+"\n", "admin-senha", "suporte", "--dados", dados); cod != 1 ||
		!strings.Contains(saida, "A senha precisa ter pelo menos 12 caracteres.") {
		t.Fatalf("senha curta: código %d, saída %q", cod, saida)
	}
}

func TestAdminRemover(t *testing.T) {
	dados := t.TempDir()
	rodar(t, senha12+"\n"+senha12+"\n", "admin-criar", "suporte", "--dados", dados)
	// Remover não pede senha: é o operador do servidor quem roda.
	if cod, saida := rodar(t, "", "admin-remover", "suporte", "--dados", dados); cod != 0 {
		t.Fatalf("remover: código %d, saída %q", cod, saida)
	}
	if conferir(t, dados, "suporte", senha12) {
		t.Fatal("o usuário removido ainda entra")
	}
	if cod, saida := rodar(t, "", "admin-remover", "suporte", "--dados", dados); cod != 1 || !strings.Contains(saida, "não existe") {
		t.Fatalf("de novo: código %d, saída %q", cod, saida)
	}
}

func TestAdmin_Uso(t *testing.T) {
	dados := t.TempDir()
	for _, args := range [][]string{
		{"admin-criar"},
		{"admin-criar", "suporte"},
		{"admin-criar", "suporte", "--dados"},
		{"admin-criar", "suporte", "outro", "--dados", dados},
		{"admin-senha", "--dados", dados},
		{"admin-remover", "suporte", "--dados", filepath.Join(dados, "nao-existe")},
		{"admin-criar", "com espaço", "--dados", dados},
	} {
		cod, saida := rodar(t, senha12+"\n"+senha12+"\n", args...)
		if cod != 2 || saida == "" || strings.Contains(saida, "desconhecido") || strings.Contains(saida, senha12) {
			t.Fatalf("%q: código %d, saída %q; queria 2 e a explicação", args, cod, saida)
		}
	}
	if _, err := os.Stat(filepath.Join(dados, "chat.db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("um uso errado abriu o banco: %v", err)
	}
	// O uso geral cita os subcomandos novos.
	_, saida := rodar(t, "")
	for _, s := range []string{"admin-criar", "admin-senha", "admin-remover"} {
		if !strings.Contains(saida, s) {
			t.Fatalf("o uso não cita %s: %q", s, saida)
		}
	}
}

func TestServir_ModoTesteSoLocal(t *testing.T) {
	for _, escutar := range []string{"0.0.0.0:8090", "192.168.0.5:80"} {
		var saida bytes.Buffer
		args := []string{"servir", "--teste", "--escutar", escutar, "--dados", t.TempDir()}
		if cod := run(args, strings.NewReader(""), &saida, io.Discard); cod != 2 {
			t.Fatalf("%s: código %d, esperava 2", escutar, cod)
		}
		if !strings.Contains(saida.String(), "o modo de teste só escuta em 127.0.0.1 ou [::1]") {
			t.Fatalf("%s: saída %q", escutar, saida.String())
		}
	}
}

func TestServir_Uso(t *testing.T) {
	pasta := t.TempDir()
	casos := map[string][]string{
		"teste sem dados":            {"servir", "--teste"},
		"dados sem teste":            {"servir", "--dados", pasta},
		"escutar sem teste":          {"servir", "--escutar", "127.0.0.1:8090"},
		"teste com config":           {"servir", "--teste", "--dados", pasta, "--config", "/x.json"},
		"argumento a mais":           {"servir", "--teste", "--dados", pasta, "sobra"},
		"flag que não existe":        {"servir", "--xis"},
		"teste com pasta que não há": {"servir", "--teste", "--dados", filepath.Join(pasta, "nada")},
	}
	for nome, args := range casos {
		var saida bytes.Buffer
		if cod := run(args, strings.NewReader(""), &saida, io.Discard); cod != 2 {
			t.Fatalf("%s: código %d, esperava 2 (%q)", nome, cod, saida.String())
		}
	}
}

func TestServir_ConfigRuim(t *testing.T) {
	var saida bytes.Buffer
	args := []string{"servir", "--config", filepath.Join(t.TempDir(), "nada.json")}
	if cod := run(args, strings.NewReader(""), &saida, io.Discard); cod != 1 {
		t.Fatalf("código %d, esperava 1", cod)
	}
	if !strings.Contains(saida.String(), "configuração") {
		t.Fatalf("saída %q", saida.String())
	}
}

// Um flag errado imprime o uso uma vez só.
func TestServir_UsoUmaVez(t *testing.T) {
	for _, args := range [][]string{{"servir", "--xis"}, {"servir", "-h"}, {"servir", "sobra"}} {
		var saida bytes.Buffer
		run(args, strings.NewReader(""), &saida, io.Discard)
		if n := strings.Count(saida.String(), "uso: starsonic-chat servir"); n != 1 {
			t.Fatalf("%v: o uso saiu %d vezes:\n%s", args, n, saida.String())
		}
	}
}

// O endereço de teste é conferido antes da pasta de dados.
func TestServir_EnderecoAntesDaPasta(t *testing.T) {
	var saida bytes.Buffer
	args := []string{"servir", "--teste", "--escutar", "0.0.0.0:8090", "--dados", "/nada/que/existe"}
	if cod := run(args, strings.NewReader(""), &saida, io.Discard); cod != 2 {
		t.Fatalf("código %d, esperava 2", cod)
	}
	if !strings.Contains(saida.String(), "o modo de teste só escuta em 127.0.0.1 ou [::1]") {
		t.Fatalf("saída %q", saida.String())
	}
}

func TestCopia(t *testing.T) {
	dados, destino := t.TempDir(), filepath.Join(t.TempDir(), "copias")
	b, err := banco.Abrir(filepath.Join(dados, banco.NomeArquivo), tempo.Real())
	if err != nil {
		t.Fatal(err)
	}
	defer b.Fechar()
	cod, saida := rodar(t, "", "copia", "--destino", destino, "--dados", dados)
	if cod != 0 || !strings.Contains(saida, "chat-") {
		t.Fatalf("código %d, saída %q", cod, saida)
	}
	itens, err := filepath.Glob(filepath.Join(destino, "chat-*.db"))
	if err != nil || len(itens) != 1 {
		t.Fatalf("cópias = %v, %v", itens, err)
	}
}

func TestCopia_Uso(t *testing.T) {
	dados := t.TempDir()
	for _, args := range [][]string{
		{"copia"},
		{"copia", "--dados", dados},
		{"copia", "--destino", dados},
		{"copia", "--dados", dados, "--destino", dados, "sobra"},
		{"copia", "--dados", filepath.Join(dados, "nao-existe"), "--destino", dados},
	} {
		cod, saida := rodar(t, "", args...)
		if cod != 2 || saida == "" || strings.Contains(saida, "desconhecido") {
			t.Fatalf("%q: código %d, saída %q; queria 2 e a explicação", args, cod, saida)
		}
	}
	_, saida := rodar(t, "")
	if !strings.Contains(saida, "copia --dados") {
		t.Fatalf("o uso não cita a cópia: %q", saida)
	}
}
