# Chat, etapa 1 — o servidor e a página de administração — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** construir o servidor do chat (`starsonic-chat`): a API do app, o WebSocket, a página de administração, as tarefas de expiração, a cópia de segurança, a instalação na VM e os workflows `chat` e `chat-release`. O app não muda.

**Architecture:**
- É um programa só, em Go, com o SQLite em Go puro e os arquivos numa pasta.
- A API e o WebSocket seguem `docs/chat-protocolo.md`.
- A página de administração é HTML feito no servidor (`html/template`), sem JavaScript.
- Em produção, o próprio programa tira o certificado (autocert) nas portas 443 e 80. No modo de teste, ele usa HTTP em `127.0.0.1`.

**Tech Stack:**
- Go: `go 1.26.0` e `toolchain go1.27.3` no `go.mod`;
- `github.com/coder/websocket` v1.8.15, `modernc.org/sqlite` v1.61.1 e `golang.org/x/crypto` v0.58.0 (`acme/autocert` e `argon2`);
- systemd, rclone e GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-04-starsonic-phone-chat-design.md`. O contrato da API é `docs/chat-protocolo.md`, escrito junto com este plano: os nomes, os campos, os erros e os limites exatos estão lá, e cada tarefa da API segue a seção dela.

## Global Constraints
- **Lugar e versão:**
  - o módulo é `github.com/LucasCPena/starsonic-phone/chat-servidor`, na pasta `chat-servidor/`;
  - o binário é `starsonic-chat`, para `linux/amd64`, compilado com `CGO_ENABLED=0`;
  - a versão entra por `-ldflags "-X main.versao=<versão>"`, e vale `0.0.0-dev` sem ela.
- **Dependências:** só as três do Tech Stack, com as dependências delas. Uma dependência a mais precisa de uma ruling.
- **Neste ambiente:** os comandos `go` rodam com `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. Sem isso, o `proxy.golang.org` não é alcançado. No GitHub não precisa.
- **Os testes:** `go test -race ./...`, que pede `CGO_ENABLED=1`. O build de publicação continua com `CGO_ENABLED=0`.
- **As empresas separadas:**
  - a empresa vem sempre da chave do computador;
  - nenhuma rota aceita o id de uma empresa vindo do app;
  - um id de outra empresa responde `404 naoEncontrado`.
- **Os limites**, iguais à seção 8 do protocolo:
  - texto de 4.000 caracteres;
  - arquivo de 26.214.400 bytes, e miniatura JPEG de 204.800 bytes;
  - grupo de 200 pessoas, com nome de 60 caracteres;
  - 60 mensagens por minuto e 209.715.200 bytes de arquivos por hora, por computador;
  - 10 códigos errados por hora por endereço, e depois 3.600 s de espera;
  - corpo JSON de 65.536 bytes e páginas de 50 mensagens;
  - arquivos guardados por 365 dias, e sem mensagem por 24 h.
- **A página de administração:**
  - 5 senhas erradas travam o usuário por 15 minutos;
  - a sessão dura 12 horas;
  - a senha tem no mínimo 12 caracteres e fica guardada com argon2id (`time=3`, `memory=65536` KiB, `threads=2`, `keyLen=32`, sal de 16 bytes, no formato PHC `$argon2id$v=19$m=65536,t=3,p=2$<sal>$<hash>`).
- **As horas:**
  - no banco e na API, ficam em milissegundos UTC;
  - na página de administração, aparecem em `America/Sao_Paulo`, com `time/tzdata` embutido;
  - as tarefas diárias usam esse fuso: a cópia às 03:00 e a expiração às 04:00.
- **Os segredos:**
  - a chave do computador e o bilhete são 32 bytes aleatórios (`crypto/rand`), em base64url sem `=` (43 caracteres);
  - o id de um arquivo são 16 bytes em hexadecimal;
  - o banco guarda só o SHA-256 da chave, do bilhete e do token de sessão.
- **Os logs:** nunca registram chave, código, bilhete, token, senha, texto de mensagem, nome de arquivo nem a query string. Ficam o método, a rota (o padrão, sem ids), o status e o tempo.
- **O cadeado:**
  - o autocert aceita só o `endereco` da configuração, com o cache em `<dados>/certificados`;
  - toda resposta por HTTPS leva `Strict-Transport-Security: max-age=31536000`;
  - a porta 80 só atende ao desafio do certificado e manda o resto para o HTTPS.
- **O modo de teste** (`servir --teste --escutar <endereço:porta>`) aceita só `127.0.0.1` ou `[::1]`. Com qualquer outro endereço, o programa sai com o código 2 e a mensagem `o modo de teste só escuta em 127.0.0.1 ou [::1]`.
- **O CORS:** a origem padrão é `https://app.starsonic.local`, a do WebView do app (`windows/app/src/WebViewHost.cpp`).
- **A publicação:**
  - a tag é `chat-v<versão>`, sempre como pre-release, com `make_latest: false`;
  - o `releases/latest` do repositório tem de continuar 404, porque o canal Estável do app lê esse endereço;
  - quem publica é o responsável, pelo workflow, e o agente nunca cria tag nem release.
- **O repositório é público:**
  - nada de segredo, de senha, nem de dado real de cliente nos testes;
  - nada do nome do fornecedor da central;
  - os nomes de teste são inventados ("ACME Comércio Ltda", "Ana Souza", ramal "2003").
- **Os textos e os comentários:**
  - o código, os comentários e as mensagens de commit são em português, no estilo do repositório;
  - os commits terminam com as duas linhas de sempre (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`);
  - o push vai no `origin main`, sem force.
- **O app não muda:** nada em `windows/`, `starsonic/`, `android/` e `tests/`. A exceção é o `paths-ignore` do `.github/workflows/build.yml` (Task 1).
- **Os textos da página de administração** são os do quadro "Starsonic Phone — telas do chat" (telas `Painel` e `PainelEmpresa`) e os da seção 4.3 da spec.

## Review Focus
1. **Nomes de arquivo esquisitos** (`../`, aspas, acentos, 300 caracteres, só pontos): o nome guardado segue a seção 3 do protocolo, e o `Content-Disposition` nunca quebra o cabeçalho. O teste fica na Task 7.
2. **Vários computadores enviando juntos:** nenhum erro de banco ocupado (`SQLITE_BUSY`), e os ids crescem sempre. O teste fica na Task 6.
3. **As horas da página num servidor em UTC:** elas aparecem no horário de Brasília. O teste fica na Task 9.
4. **Um app que conecta e não lê o WebSocket:** o servidor fecha só ele (`4002`), sem atrasar os outros. O teste fica na Task 4.
5. **Um envio de arquivo cortado no meio** (a rede caiu): nada fica no disco nem no banco. O teste fica na Task 7.

---

## As pastas e as responsabilidades
```
chat-servidor/
  go.mod, go.sum
  cmd/starsonic-chat/main.go       os subcomandos servir, admin-criar, admin-senha, admin-remover, copia, versao
  internal/tempo/                  o relógio: o real e o de teste
  internal/segredo/                o código da empresa, a chave, o bilhete e o id de arquivo
  internal/regras/                 as regras dos campos (seção 3 do protocolo) e o "sem acento, sem caixa"
  internal/banco/                  o SQLite: abrir, as migrações (migracoes/*.sql, embutidas) e as consultas, um arquivo por assunto
  internal/limites/                as janelas de tempo dos limites
  internal/eventos/                o hub do WebSocket
  internal/armazem/                os arquivos no disco
  internal/api/                    as rotas da API do app, uma por arquivo de assunto
  internal/apitest/                o ambiente de teste da API (só para os testes)
  internal/admin/                  a página de administração (paginas/*.html, estatico/*)
  internal/tarefas/                a expiração e a limpeza
  internal/copia/                  a cópia de segurança do banco
  internal/servidor/               a configuração, o cadeado, o modo de teste e a montagem
  deploy/                          as unidades do systemd, o instalar.sh e o copia.sh
.github/workflows/chat.yml, chat-release.yml
docs/chat-protocolo.md (já escrito), docs/chat-servidor.md
```

## O banco (a migração 0001)
O arquivo `chat-servidor/internal/banco/migracoes/0001_inicio.sql` é este, exatamente. Os nomes das tabelas e das colunas valem para todas as tarefas.

```sql
CREATE TABLE empresas (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, codigo TEXT NOT NULL UNIQUE, criada_em INTEGER NOT NULL
);
CREATE TABLE pessoas (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ramal TEXT NOT NULL, nome TEXT NOT NULL, nome_busca TEXT NOT NULL,
  entrou_em INTEGER NOT NULL, saiu_em INTEGER
);
CREATE UNIQUE INDEX pessoas_ramal_ativo ON pessoas(empresa_id, ramal) WHERE saiu_em IS NULL;
CREATE TABLE computadores (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave_hash BLOB NOT NULL UNIQUE, nome TEXT NOT NULL,
  pessoa_id INTEGER REFERENCES pessoas(id),
  ligado_em INTEGER NOT NULL, ultima_vez INTEGER NOT NULL, saiu_em INTEGER
);
CREATE TABLE computador_pessoas (
  computador_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  primeira_vez INTEGER NOT NULL,
  PRIMARY KEY (computador_id, pessoa_id)
);
CREATE TABLE conversas (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('dupla', 'grupo')),
  nome TEXT, cuida_id INTEGER REFERENCES pessoas(id), criou_id INTEGER REFERENCES pessoas(id),
  dupla_a INTEGER REFERENCES pessoas(id), dupla_b INTEGER REFERENCES pessoas(id),
  criada_em INTEGER NOT NULL, atualizada_em INTEGER NOT NULL,
  CHECK ((tipo = 'dupla' AND dupla_a < dupla_b AND nome IS NULL)
      OR (tipo = 'grupo' AND dupla_a IS NULL AND dupla_b IS NULL AND nome IS NOT NULL))
);
CREATE UNIQUE INDEX conversas_dupla ON conversas(empresa_id, dupla_a, dupla_b) WHERE tipo = 'dupla';
CREATE TABLE membros (
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  entrou_em INTEGER NOT NULL, saiu_em INTEGER,
  PRIMARY KEY (conversa_id, pessoa_id)
);
CREATE TABLE arquivos (
  id TEXT PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES pessoas(id),
  nome TEXT NOT NULL, tipo TEXT NOT NULL, tamanho INTEGER NOT NULL,
  miniatura INTEGER NOT NULL DEFAULT 0, criado_em INTEGER NOT NULL, expirado_em INTEGER
);
CREATE TABLE mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  autor_id INTEGER REFERENCES pessoas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'arquivo', 'aviso')),
  texto TEXT, arquivo_id TEXT UNIQUE REFERENCES arquivos(id),
  aviso_acao TEXT CHECK (aviso_acao IN ('criou', 'pos', 'tirou', 'saiu')),
  aviso_alvo_id INTEGER REFERENCES pessoas(id),
  id_local TEXT, criada_em INTEGER NOT NULL
);
CREATE UNIQUE INDEX mensagens_id_local ON mensagens(autor_id, id_local) WHERE id_local IS NOT NULL;
CREATE INDEX mensagens_conversa ON mensagens(conversa_id, id);
CREATE TABLE leituras (
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  ate INTEGER NOT NULL,
  PRIMARY KEY (pessoa_id, conversa_id)
);
CREATE TABLE admins (
  usuario TEXT PRIMARY KEY, senha_hash TEXT NOT NULL,
  erros INTEGER NOT NULL DEFAULT 0, travado_ate INTEGER NOT NULL DEFAULT 0, criado_em INTEGER NOT NULL
);
CREATE TABLE sessoes_admin (
  token_hash BLOB PRIMARY KEY,
  usuario TEXT NOT NULL REFERENCES admins(usuario) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expira_em INTEGER NOT NULL
);
```

---

### Task 1: A fundação, o CI e o comando `versao`

**Files:**
- Create: `chat-servidor/go.mod`, `chat-servidor/go.sum`
- Create: `chat-servidor/cmd/starsonic-chat/main.go`, `chat-servidor/cmd/starsonic-chat/main_test.go`
- Create: `chat-servidor/internal/tempo/tempo.go`, `tempo_test.go`
- Create: `chat-servidor/internal/segredo/segredo.go`, `segredo_test.go`
- Create: `chat-servidor/internal/regras/regras.go`, `regras_test.go`
- Create: `.github/workflows/chat.yml`
- Modify: `.github/workflows/build.yml` (o `paths-ignore` do `push`)

**Interfaces:**
- **Produces:**
  - `tempo.Relogio` (interface `Agora() time.Time`), `tempo.Real() Relogio`, e `tempo.NovoTeste(inicio time.Time) *tempo.Teste`, com `Agora`, `Avancar(d time.Duration)` e `Definir(t time.Time)`, seguro entre goroutines;
  - `segredo.NovoCodigo() string`, no formato `STAR-XXXX-XXXX`;
  - `segredo.NormalizarCodigo(s string) (codigo string, ok bool)`, que devolve a forma `STAR-XXXX-XXXX`;
  - `segredo.NovaChave() (chave string, hash []byte)`, `segredo.Hash(s string) []byte` (SHA-256), `segredo.NovoBilhete() string` e `segredo.NovoIDArquivo() string`;
  - em `regras`:
    - `type Erro struct{ Campo string }`, que implementa `error`;
    - `Ramal`, `NomePessoa`, `NomeComputador` e `NomeGrupo`, todas `(s string) (string, error)`;
    - `Texto(s string) (string, error)`, `IDLocal(s string) error`, `NomeArquivo(s string) string` e `TipoArquivo(contentType string) (tipo string, foto bool)`;
    - `Dobrar(s string) string`, o "sem acento e sem caixa", para a busca e a ordem.

- [ ] **Step 1: Os testes de `segredo`**
  - `TestNovoCodigo_Formato`: 1.000 códigos casam com `^STAR-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$`, e nenhum se repete.
  - `TestNormalizarCodigo`:
    - `" star 7kq4 9xwp "` vira `STAR-7KQ4-9XWP`, com ok;
    - `STAR7KQ49XWP` também;
    - não valem `STAR-7KQ4-9XW` (curto), `STAR-7KQ4-9XWI` (um I), `XTAR-7KQ4-9XWP` nem `""`.
  - `TestNovaChave`: a chave tem 43 caracteres de base64url, `Hash(chave)` é igual ao hash devolvido, e duas chaves diferem.
  - `TestNovoIDArquivo`: casa com `^[0-9a-f]{32}$`.
- [ ] **Step 2: Os testes de `regras`.** São tabelas com as regras da seção 3 do protocolo:
  - **`Ramal`:**
    - `" 2003 "` vira `2003`;
    - 32 caracteres valem e 33 não;
    - não valem `"20 03"`, `"2003@x"`, `"a:b"`, `""` nem `"\t"`.
  - **`NomePessoa`:** 80 caracteres valem e 81 não; `"Ana\x00"` não vale.
  - **`NomeGrupo`:** 60 caracteres valem e 61 não.
  - **`Texto`:**
    - `"oi"` vale;
    - 4.000 runas valem, também com emoji, e 4.001 não;
    - `"   \n "` não vale;
    - `"linha1\nlinha2"` vale, e `"a\x07b"` não;
    - o `Erro.Campo` é `"texto"`.
  - **`IDLocal`:** `"a1-B2"` vale, 64 caracteres valem e 65 não, `"a b"` não vale.
  - **`NomeArquivo`:**
    - `"../../etc/passwd"` vira `passwd`;
    - `"C:\\x\\Proposta \"ACME\".pdf"` vira `Proposta ACME.pdf`;
    - `"...  "` vira `arquivo`;
    - um nome de 300 `a` com `.pdf` vira 120 caracteres que terminam em `.pdf`;
    - `"relatório: final?.xlsx"` vira `relatório final.xlsx`.
  - **`TipoArquivo`:**
    - `"image/png"` vira `("image/png", true)`;
    - `"application/pdf; charset=x"` vira `("application/pdf", false)`;
    - `"lixo"` vira `("application/octet-stream", false)`.
  - **`Dobrar`:** `"João Ção ÁÉÍÓÚ ü"` vira `"joao cao aeiou u"`.
- [ ] **Step 3: O teste de `main`.** `TestVersao`: rodar `run([]string{"versao"}, &saida)` escreve `0.0.0-dev\n` e volta 0. Um subcomando desconhecido volta 2 e escreve o uso em português.
- [ ] **Step 4: Rodar os testes.**
  - Rode `cd chat-servidor && go test ./...`.
  - Esperado: falham, porque as funções ainda não existem.
- [ ] **Step 5: Escrever o código.**
  - `go mod init github.com/LucasCPena/starsonic-phone/chat-servidor`, com `go 1.26.0` e `toolchain go1.27.3`.
  - `main.go` tem `func run(args []string, saida io.Writer) int` e o `main`, que chama `os.Exit(run(os.Args[1:], os.Stdout))`. Por enquanto só existe o `versao`; os outros subcomandos entram nas suas tarefas.
- [ ] **Step 6: Rodar os testes.**
  - Rode `go test -race ./...`, `go vet ./...` e `gofmt -l .`.
  - Esperado: os testes passam, e o `gofmt -l` não lista nada.
- [ ] **Step 7: O CI.** O `.github/workflows/chat.yml`:
  - roda num `push` e num `pull_request` com `paths` `chat-servidor/**`, `docs/chat-*.md` e `.github/workflows/chat*.yml`, e também por `workflow_dispatch`;
  - usa `ubuntu-24.04` e o `actions/setup-go@v5` com `go-version-file: chat-servidor/go.mod`;
  - os passos são o `gofmt -l` (que falha se listar algo), o `go vet ./...`, o `go test -race ./...` e o `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`;
  - por último, faz o build com `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` e sobe o artefato `starsonic-chat-linux-amd64`.

  No `build.yml`, o `paths-ignore` do `push` ganha `chat-servidor/**`, `docs/chat-*.md` e `.github/workflows/chat*.yml`, com um comentário de uma linha.
- [ ] **Step 8: O commit.** `feat(chat): a fundação do servidor do chat, com o relógio, os segredos, as regras e o CI`.

### Task 2: O banco

**Files:**
- Create: `chat-servidor/internal/banco/banco.go`, `banco_test.go`, `migracoes/0001_inicio.sql`, a migração acima, exatamente.

**Interfaces:**
- **Consumes:** `tempo.Relogio`.
- **Produces:**
  - `banco.Abrir(caminho string, r tempo.Relogio) (*Banco, error)`, `(*Banco).Fechar() error`, e `(*Banco).Relogio() tempo.Relogio`;
  - os erros `banco.ErrNaoEncontrado`, `banco.ErrProibido` e `banco.ErrGrupoCheio`;
  - `(*Banco).Tx(ctx, func(*sql.Tx) error) error`, uma transação com `BEGIN IMMEDIATE`;
  - `agoraMs()`, um ajudante interno para a hora do relógio em milissegundos.

- [ ] **Step 1: Os testes.**
  - `TestAbrir_Novo`: o `PRAGMA user_version` é 1, o `journal_mode` é `wal` e o `foreign_keys` é 1.
  - `TestAbrir_DeNovo`: abrir duas vezes o mesmo arquivo não dá erro, e o `user_version` continua 1.
  - `TestChavesEstrangeiras`: uma pessoa com `empresa_id` 999 dá erro.
  - `TestApagarEmpresa_EmCascata`: uma empresa com uma pessoa, um computador, um grupo, uma mensagem com arquivo e uma leitura. Depois de `DELETE FROM empresas WHERE id=?`, todas as tabelas ficam com 0 linhas.
  - `TestRamalAtivoUnico`: duas pessoas ativas com o mesmo ramal na mesma empresa dão erro. Com `saiu_em` na primeira, a segunda entra. Em empresas diferentes, o mesmo ramal entra.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./internal/banco/`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - O `Abrir` usa o `modernc.org/sqlite`, com `_pragma=foreign_keys(1)`, `_pragma=busy_timeout(5000)`, `_pragma=journal_mode(WAL)` e `_pragma=synchronous(NORMAL)`.
  - Ele tem um `*sql.DB` com `SetMaxOpenConns(1)`, para que todo acesso do servidor passe numa fila e o banco ocupado não aconteça. A cópia de segurança usa outra conexão (Task 11).
  - As migrações ficam embutidas com `embed` e são aplicadas em ordem pelo `user_version`.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./internal/banco/`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): o banco do servidor, com a primeira migração`.

### Task 3: A base da API e ligar o computador

**Files:**
- Create: `chat-servidor/internal/banco/empresas.go` e `computadores.go`, com os testes
- Create: `chat-servidor/internal/limites/limites.go`, `limites_test.go`
- Create: `chat-servidor/internal/api/api.go`, `erros.go`, `autenticacao.go`, `computadores.go`, `computadores_test.go`
- Create: `chat-servidor/internal/apitest/apitest.go`

**Interfaces:**
- **Consumes:** `banco`, `segredo`, `regras` e `tempo`.
- **Produces:**
  - **no banco:**
    - `type Empresa struct{ ID int64; Nome, Codigo string; CriadaEm int64 }`;
    - `CriarEmpresa(ctx, nome) (Empresa, error)`, que gera o código e tenta de novo se ele repetir;
    - `EmpresaPorCodigo(ctx, codigo) (Empresa, error)`;
    - `type Computador struct{ ID, EmpresaID int64; Nome string; PessoaID int64 }`, em que o 0 quer dizer "sem pessoa";
    - `LigarComputador(ctx, empresaID, nome, chaveHash) (Computador, error)` e `ComputadorPorChave(ctx, chaveHash) (Computador, Empresa, error)`. O `ComputadorPorChave` só acha computadores ativos e atualiza o `ultima_vez`, no máximo uma vez por minuto;
    - `DesligarComputador(ctx, id) error`.
  - **em `limites`:**
    - `type Janela`, com `Nova(max int, periodo time.Duration, r tempo.Relogio) *Janela`;
    - `(*Janela).Usar(chave string, quanto int) (ok bool, esperar time.Duration)`, que só conta quando cabe;
    - `(*Janela).Contar(chave string, quanto int)`, que conta sem conferir.
  - **na API:**
    - `api.Deps{Banco *banco.Banco; Origens []string}`. A Task 4 acrescenta `Hub *eventos.Hub` e a Task 7, `Armazem *armazem.Armazem`, porque esses pacotes ainda não existem;
    - `api.Novo(d Deps) http.Handler`, montado em `/api/v1/`;
    - os ajudantes `escreverJSON(w, status, v)`, `escreverErro(w, status, codigo string, extras map[string]any)` e `lerJSON(w, r, destino) bool` (64 KiB, `413 grande` e `400 invalido`);
    - o contexto `computadorDe(r) (banco.Computador, banco.Empresa)`.
  - **em `apitest`:**
    - `Novo(t) *Ambiente`, com uma pasta temporária, o banco, o relógio de teste e o `httptest.Server`. O `Hub` e o `Armazem` entram quando existirem;
    - `(*Ambiente).Empresa(nome) banco.Empresa`;
    - `(*Ambiente).Ligar(codigo, computador string) (chave string)`;
    - `(*Ambiente).Pedir(chave, metodo, caminho string, corpo any) *http.Response`;
    - `LerJSON[T](t, resp) T`.

- [ ] **Step 1: Os testes** (`computadores_test.go`, com o `apitest`).
  - `TestLigar_Certo`:
    - responde 201, com uma `chave` de 43 caracteres e `empresa.nome` `ACME Comércio Ltda`;
    - no banco, o `chave_hash` é o SHA-256 da chave, e a chave não aparece em nenhuma coluna.
  - `TestLigar_CodigoNormalizado`: com o código em minúsculas, com espaços e sem hífen, responde 201.
  - `TestLigar_CodigoErrado`:
    - um código errado responde `404 codigo`;
    - no 11º errado do mesmo endereço, responde `429 tentativas`, com `esperarSegundos` entre 3.590 e 3.600;
    - com o relógio 1 h adiante, um código certo responde 201.
  - `TestLigar_NomeComputadorInvalido`: responde `400 invalido`, com `campo` igual a `computador`.
  - `TestAutenticacao`: sem `Authorization`, com uma chave inventada e com a chave de um computador desligado, o `GET /api/v1/pessoas` responde `401 chave`.
  - `TestDesligar`:
    - `DELETE /api/v1/computadores/eu` responde 204;
    - depois disso, a mesma chave responde `401 chave`.
  - `TestCORS`:
    - um `OPTIONS` com `Origin: https://app.starsonic.local` responde com o `Access-Control-Allow-Origin` igual à origem, os métodos e os cabeçalhos da seção 1 do protocolo e `Max-Age: 600`;
    - com `Origin: https://mal.example`, nenhum `Access-Control-Allow-*`.
  - `TestJSONGrande`: um corpo de 65.537 bytes responde `413 grande`.
  - `TestRotaDesconhecida`: `GET /api/v1/nada` responde `404 naoEncontrado`.
  - `TestJanela` (em `limites`): 10 cabem numa hora, o 11º não, e o `esperar` cai conforme o relógio anda.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./internal/...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - **O roteador:** usa o `http.ServeMux` com os padrões de método (`POST /api/v1/computadores`).
  - **O endereço do pedido:** é o `r.RemoteAddr`, sem a porta. O servidor não fica atrás de proxy, então não lê o `X-Forwarded-For`.
  - **Os códigos errados:** usam uma `Janela` de 10 por hora, e o 11º espera 3.600 s, como manda o protocolo.
  - **Os logs:** um middleware registra o método, o padrão da rota, o status e o tempo, e nada mais (Global Constraints).
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): a base da API, ligar e desligar o computador`.

### Task 4: As pessoas e os eventos

**Files:**
- Create: `chat-servidor/internal/banco/pessoas.go`, com o teste
- Create: `chat-servidor/internal/eventos/eventos.go`, `eventos_test.go`
- Create: `chat-servidor/internal/api/pessoas.go`, `eventos.go`, `pessoas_test.go`, `eventos_test.go`
- Modify: `chat-servidor/internal/apitest/apitest.go`, que ganha o `Hub` e `(*Ambiente).Entrar(chave, ramal, nome string) Pessoa` e `(*Ambiente).Conectar(chave) *websocket.Conn`
- Modify: `docs/chat-protocolo.md`, só se a construção achar algo que o contrato não diz, com uma ruling

**Interfaces:**
- **Consumes:** a Task 3.
- **Produces:**
  - **no banco:**
    - `type Pessoa struct{ ID, EmpresaID int64; Ramal, Nome string; Saiu bool }`;
    - `EntrarComoPessoa(ctx, computadorID, empresaID int64, ramal, nome string) (p Pessoa, outros []int64, err error)`. O `outros` traz os computadores ativos dessa pessoa que devem receber o `computadorNovo`, e vem vazio se não for a primeira vez dela neste computador;
    - `Colegas(ctx, empresaID, excetoPessoaID int64) ([]Pessoa, error)`;
    - `PessoaPorID(ctx, empresaID, id) (Pessoa, error)`;
    - `ComputadoresDaPessoa(ctx, pessoaID) ([]int64, error)`.
  - **em `eventos`:**
    - `type Config struct{ Ping, Espera time.Duration; Fila int }`, com o padrão 25 s, 60 s e 64;
    - `NovoHub(c Config) *Hub`;
    - `(*Hub).Servir(ctx, conn *websocket.Conn, computadorID int64)`, que bloqueia até a conexão fechar;
    - `(*Hub).DefinirPessoa(computadorID, pessoaID int64)`;
    - `(*Hub).ParaPessoas(ids []int64, ev any)` e `(*Hub).ParaComputadores(ids []int64, ev any)`;
    - `(*Hub).Fora(computadorIDs []int64)`, que manda `{"tipo":"fora"}` e fecha com o código 4001.
  - **na API:**
    - `POST /api/v1/pessoas/eu` e `GET /api/v1/pessoas`;
    - `POST /api/v1/eventos/bilhete` e `GET /api/v1/eventos`. Os bilhetes ficam na memória, como hashes, por 30 s, e valem uma vez só.

- [ ] **Step 1: Os testes.**
  - `TestEntrar_CriaEAtualiza`:
    - a primeira entrada com `2001`/`Recepção` cria a pessoa;
    - a segunda, com o nome `Recepção 1`, mantém o id e muda o nome.
  - `TestEntrar_PessoaQueSaiuNaoVolta`: depois de marcar `saiu_em` na pessoa, o mesmo ramal entra com outro id.
  - `TestEntrar_Invalido`: o ramal `20 03` responde `400 invalido`, com `campo` igual a `ramal`.
  - `TestColegas`:
    - vêm só as pessoas ativas da mesma empresa, sem a da vez, na ordem do `Dobrar(nome)`: "Ana", "Álvaro" e "Beatriz" saem "Álvaro", "Ana", "Beatriz";
    - a pessoa de outra empresa nunca aparece.
  - `TestSemPessoa`: um computador ligado, onde ninguém entrou, responde `409 pessoa` no `GET /api/v1/pessoas`.
  - `TestBilhete`:
    - o bilhete conecta uma vez, e a segunda vez responde 401;
    - com o relógio 31 s adiante, um bilhete novo responde 401;
    - com `Origin: https://mal.example`, a conexão é recusada.
  - `TestComputadorNovo`:
    - a Ana entra no computador A, conectado;
    - a Ana entra no computador B;
    - o A recebe `{"tipo":"computadorNovo","computador":"B"}`;
    - um computador da Beatriz, também conectado, não recebe nada em 300 ms.
  - `TestUmaConexaoPorComputador`: a segunda conexão do mesmo computador fecha a primeira com o código 4000.
  - `TestDesligar_FechaWebSocket`: o `DELETE /api/v1/computadores/eu` fecha o WebSocket desse computador com o código 4001.
  - `TestComputadorLento` (Review Focus 4):
    - com `Fila: 4`, um computador conecta e não lê;
    - mandar 10 eventos para ele e para outro que lê;
    - o lento é fechado com o código 4002;
    - o outro recebe os 10, cada um em menos de 200 ms.
  - `TestPing`: com `Ping` de 50 ms e `Espera` de 150 ms, um cliente que responde aos pings fica ligado por 1 s.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - O WebSocket usa o `websocket.Accept` com as `OriginPatterns` das origens do CORS.
  - Cada conexão tem uma fila (um canal com o tamanho da `Fila`) e uma goroutine que escreve. Um envio com a fila cheia fecha a conexão com 4002 e não espera.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): as pessoas, o bilhete e os eventos pelo WebSocket`.

### Task 5: As conversas e os membros

**Files:**
- Create: `chat-servidor/internal/banco/conversas.go`, com o teste
- Create: `chat-servidor/internal/api/conversas.go`, `conversas_test.go`, com os objetos `Conversa`, `Mensagem`, `Pessoa` e `Arquivo` da seção 4 do protocolo, em `objetos.go`

**Interfaces:**
- **Consumes:** as Tasks 3 e 4.
- **Produces:**
  - **no banco:**
    - `CriarDupla(ctx, empresaID, eu, com int64) (conversaID int64, nova bool, err error)`;
    - `CriarGrupo(ctx, empresaID, eu int64, nome string, pessoas []int64) (int64, error)`;
    - `Conversas(ctx, pessoaID) ([]ResumoConversa, error)`;
    - `Conversa(ctx, empresaID, pessoaID, conversaID) (ResumoConversa, error)`, com `ErrNaoEncontrado` se a pessoa não estiver nela;
    - `Membros(ctx, conversaID) ([]Membro, error)`;
    - `PorNoGrupo(ctx, eu, conversaID int64, pessoas []int64) ([]int64, error)`, que devolve os ids das mensagens de aviso criadas;
    - `TirarMembro(ctx, eu, conversaID, alvo int64) ([]int64, error)`, que tira outra pessoa ou a própria e devolve os ids dos avisos;
    - `PessoasDaConversa(ctx, conversaID) ([]int64, error)`, com os membros ativos ou os dois da dupla.
  - Na API, as rotas da seção 5 do protocolo para as conversas e os membros, com os eventos `conversa` e `conversaSaiu`.

- [ ] **Step 1: Os testes.**
  - `TestDupla_UmaSoPorPar`:
    - Ana com Beatriz responde 201;
    - Beatriz com Ana responde 200, com o mesmo id;
    - Ana com Ana responde `400 invalido`, com `campo` igual a `com`.
  - `TestDupla_ComQuemSaiu`: responde `400 invalido`, com `campo` igual a `com`.
  - `TestGrupo_Criar`:
    - o grupo "Comercial", com Beatriz e Carlos, responde 201;
    - as mensagens são `criou` e depois `pos` para Beatriz e `pos` para Carlos, nessa ordem;
    - a Ana cuida do grupo, e na Conversa da Ana vem `cuida: true`;
    - cada um dos três recebe o evento `conversa`.
  - `TestGrupo_Cheio`: 199 pessoas, mais quem cria, respondem 201; 200 pessoas mais quem cria respondem `409 grupoCheio`; pôr 1 pessoa num grupo de 200 também responde `409 grupoCheio`.
  - `TestGrupo_SoQuemCuida`: a Beatriz pondo ou tirando o Carlos responde `403 proibido`; a Beatriz saindo responde 204, com o aviso `saiu`.
  - `TestGrupo_PassaParaOMaisAntigo`:
    - a Ana cuida e sai;
    - a Beatriz (que entrou antes) passa a cuidar, e não o Carlos;
    - com entradas no mesmo milissegundo, passa a de menor id;
    - quem saiu recebe `conversaSaiu`.
  - `TestConversas_Ordem`: a conversa com a mensagem mais nova vem primeiro, e um grupo novo sem mensagens entra pelo `criada_em`.
  - `TestConversas_NaoLidas`: o `naoLidas` não conta as mensagens da própria pessoa, os avisos nem as mensagens de antes de ela entrar no grupo.
  - `TestIsolamento_Conversas`: com uma pessoa da empresa B,
    - o `GET` dos membros de um grupo da A responde `404 naoEncontrado`;
    - o `POST` de uma dupla com uma pessoa da A responde `404 naoEncontrado`;
    - o `POST` de um grupo com uma pessoa da A responde `404 naoEncontrado`;
    - o `DELETE` de um membro da A responde `404 naoEncontrado`.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.** Toda consulta filtra pela `empresa_id` do computador. A dupla guarda o par com `dupla_a < dupla_b`.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): as conversas a dois, os grupos e os membros`.

### Task 6: As mensagens e a leitura

**Files:**
- Create: `chat-servidor/internal/banco/mensagens.go`, com o teste
- Create: `chat-servidor/internal/api/mensagens.go`, `mensagens_test.go`

**Interfaces:**
- **Consumes:** as Tasks 3 a 5.
- **Produces:**
  - **no banco:**
    - `EnviarTexto(ctx, eu, conversaID int64, idLocal, texto string) (m Mensagem, nova bool, err error)`;
    - `EnviarArquivo(ctx, eu, conversaID int64, idLocal, arquivoID string) (Mensagem, bool, error)`, que a Task 7 usa;
    - `Mensagens(ctx, eu, conversaID int64, antes, depois int64, limite int) ([]Mensagem, bool, error)`;
    - `MarcarLida(ctx, eu, conversaID, ate int64) (avancou bool, err error)`.
  - Na API, as rotas da seção 5 do protocolo para as mensagens e a leitura, com o evento `mensagem` para os computadores das pessoas da conversa e o evento `lida` para os outros computadores de quem leu.

- [ ] **Step 1: Os testes.**
  - `TestEnviar_Texto`:
    - responde 201, com `tipo` igual a `texto`, o `autor` e o `criadaEm` igual ao relógio;
    - os computadores dos dois da dupla recebem o evento `mensagem`, também o de quem enviou.
  - `TestEnviar_IdLocalNaoDuplica`: o mesmo `idLocal` duas vezes responde 201 e 200, com o mesmo id, e o banco tem 1 mensagem.
  - `TestEnviar_TextoInvalido`: 4.001 caracteres e `"  "` respondem `400 invalido`, com `campo` igual a `texto`.
  - `TestEnviar_Limite`: a 61ª mensagem do mesmo computador no mesmo minuto responde `429 limite`, com `esperarSegundos`; com o relógio 60 s adiante, passa.
  - `TestMensagens_Paginas`:
    - com 120 mensagens, sem parâmetros vêm as 50 mais novas, da 71 à 120, em ordem e com `temMais: true`;
    - `antes=71` traz da 21 à 70;
    - `depois=100` traz da 101 à 120, com `temMais: false`;
    - `limite=0` e `limite=51` respondem `400 invalido`.
  - `TestMensagens_DesdeQueEntrou`: quem foi posto no grupo depois de 3 mensagens não vê as 3, só os avisos e as mensagens a partir da entrada.
  - `TestLida`:
    - marcar `ate=5` responde 204, e o outro computador da mesma pessoa recebe `{"tipo":"lida","conversa":…,"ate":5}`;
    - depois de `ate=3`, a leitura continua em 5, e ninguém recebe evento;
    - o `naoLidas` da conversa cai.
  - `TestIsolamento_Mensagens`: com uma pessoa da empresa B, o `GET`, o `POST` e o `lida` numa conversa da A respondem `404 naoEncontrado`.
  - `TestEnviar_Simultaneo` (Review Focus 2):
    - 5 computadores, com 10 envios cada, em goroutines ao mesmo tempo, numa conversa de grupo;
    - os 50 respondem 201;
    - os ids são 50 números diferentes, e no `GET` aparecem crescendo;
    - nenhuma resposta é 500.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.** O envio, o `atualizada_em` da conversa e o evento acontecem depois da transação gravada. O evento leva a Mensagem como ela foi gravada.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): as mensagens, as páginas e a leitura`.

### Task 7: Os arquivos

**Files:**
- Create: `chat-servidor/internal/armazem/armazem.go`, `armazem_test.go`
- Create: `chat-servidor/internal/banco/arquivos.go`, com o teste
- Create: `chat-servidor/internal/api/arquivos.go`, `arquivos_test.go`
- Modify: `chat-servidor/internal/api/mensagens.go` (o envio com `arquivo`) e `chat-servidor/internal/apitest/apitest.go`, que ganha o `Armazem` e `(*Ambiente).Enviar(chave, nome, tipo string, dados []byte) Arquivo`

**Interfaces:**
- **Consumes:** as Tasks 3 a 6.
- **Produces:**
  - **em `armazem`:**
    - `Novo(pasta string) (*Armazem, error)`, numa pasta `<dados>/arquivos`;
    - `(*Armazem).Gravar(id string, r io.Reader, max int64) (n int64, err error)`. Ele grava num temporário na mesma pasta, faz `fsync` e `rename`; passando de `max`, dá `armazem.ErrGrande` e apaga o temporário; com um erro de leitura, apaga o temporário;
    - `Abrir(id) (*os.File, error)`, `GravarMiniatura(id, r, max)`, `AbrirMiniatura(id)` e `Apagar(id) error`, que apaga também a miniatura e não dá erro se o arquivo faltar;
    - no disco, o caminho é `<pasta>/<id[0:2]>/<id>`, com `<id>.mini` para a miniatura.
  - **no banco:**
    - `CriarArquivo(ctx, empresaID, autorID int64, nome, tipo string, tamanho int64) (Arquivo, error)`;
    - `ArquivoParaBaixar(ctx, empresaID, pessoaID int64, id string) (Arquivo, error)`, com `ErrNaoEncontrado` e `ErrExpirado`;
    - `MarcarMiniatura(ctx, autorID int64, id string) error`.
  - Na API, as rotas da seção 6 do protocolo, e o `{"arquivo": …}` no envio de mensagem.

- [ ] **Step 1: Os testes.**
  - `TestArquivo_EnviarEBaixar`:
    - um PDF de 1.000 bytes com `X-Arquivo-Nome: Proposta%20ACME.pdf` responde 201, com o nome, o tipo, o tamanho, `foto: false`, `miniatura: false` e `expirado: false`;
    - a mensagem com `arquivo` responde 201;
    - a Beatriz, na dupla, baixa os mesmos bytes, com os quatro cabeçalhos da seção 6 do protocolo.
  - `TestArquivo_Grande`: 26.214.401 bytes respondem `413 grande`, e a pasta e a tabela `arquivos` ficam vazias.
  - `TestArquivo_Cortado` (Review Focus 5):
    - o cliente manda o `Content-Length` de 1 MB, escreve 100 KB e fecha a conexão;
    - depois de 500 ms, a pasta de arquivos não tem nenhum arquivo, nem temporário, e a tabela `arquivos` está vazia.
  - `TestArquivo_Nomes` (Review Focus 1):
    - `../Proposta "ACME" ção.pdf`, em percent-encoding, fica guardado como `Proposta ACME ção.pdf`;
    - o `Content-Disposition` é exatamente `attachment; filename="Proposta ACME __o.pdf"; filename*=UTF-8''Proposta%20ACME%20%C3%A7%C3%A3o.pdf`. No `filename` em ASCII, cada caractere fora do ASCII vira `_`;
    - um nome com `\r\n` não quebra o cabeçalho e fica sem esses caracteres;
    - 300 caracteres viram 120;
    - um nome só de pontos vira `arquivo`.
  - `TestArquivo_QuemBaixa`:
    - quem enviou baixa antes de mandar a mensagem;
    - a Beatriz baixa só depois de a mensagem estar na dupla dela;
    - o Carlos, da mesma empresa e fora da conversa, recebe `404 naoEncontrado`;
    - uma pessoa da empresa B também recebe `404 naoEncontrado`.
  - `TestArquivo_UsoUnico`:
    - o mesmo arquivo numa segunda mensagem responde `400 invalido`, com `campo` igual a `arquivo`;
    - o arquivo de outra pessoa também.
  - `TestMiniatura`:
    - num PNG, quem enviou manda a miniatura (204);
    - o `GET` da miniatura responde `image/jpeg`, com `nosniff`;
    - num PDF, a miniatura responde `400 invalido`;
    - 204.801 bytes respondem `413 grande`;
    - a Beatriz mandando a miniatura do arquivo da Ana recebe `404 naoEncontrado`.
  - `TestArquivo_LimiteHora`: depois de 209.715.200 bytes na mesma hora, o próximo envio responde `429 limite`.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - O corpo é lido com `http.MaxBytesReader(max+1)`.
  - A linha no banco é criada só depois do arquivo gravado. Se o banco falhar, o arquivo é apagado.
  - O download usa o `http.ServeContent`, com os cabeçalhos fixados antes.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): os arquivos, a miniatura e o download`.

### Task 8: A expiração e a limpeza

**Files:**
- Create: `chat-servidor/internal/tarefas/tarefas.go`, `tarefas_test.go`
- Modify: `chat-servidor/internal/banco/arquivos.go`

**Interfaces:**
- **Consumes:** as Tasks 2 e 7.
- **Produces:**
  - `tarefas.Expirar(ctx, b *banco.Banco, a *armazem.Armazem) (expirados, limpos int, err error)`, que faz uma rodada;
  - `tarefas.Rodar(ctx, b, a)`, que faz uma rodada ao começar e depois todo dia às 04:00 de `America/Sao_Paulo`, até o `ctx` acabar;
  - no banco: `ArquivosParaExpirar(ctx, antesDe int64) ([]string, error)`, `MarcarExpirado(ctx, id)`, `ArquivosSemMensagem(ctx, antesDe int64) ([]string, error)` e `ApagarArquivo(ctx, id)`.

- [ ] **Step 1: Os testes.**
  - `TestExpirar_365Dias`:
    - um arquivo de 365 dias e 1 ms sai do disco, com a miniatura, e ganha o `expirado_em`;
    - o download responde `410 expirado`;
    - na lista de mensagens, ele vem com `expirado: true`;
    - um arquivo de 364 dias fica.
  - `TestLimpar_SemMensagem`: um arquivo de 24 h e 1 min sem mensagem sai do disco e do banco; um de 23 h fica; um com mensagem fica.
  - `TestProximaRodada`: às 23:00 de Brasília, a próxima rodada é às 04:00 do dia seguinte; às 03:00, é às 04:00 do mesmo dia. Os horários são calculados com o relógio de teste.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./internal/tarefas/`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): a expiração dos arquivos em 365 dias e a limpeza dos esquecidos`.

### Task 9: A página de administração

**Files:**
- Create: `chat-servidor/internal/banco/admins.go`, com o teste
- Create: `chat-servidor/internal/admin/admin.go`, `sessao.go`, `admin_test.go`
- Create: `chat-servidor/internal/admin/paginas/base.html`, `entrar.html`, `empresas.html`, `nova.html`, `empresa.html` e `apagar.html`
- Create: `chat-servidor/internal/admin/estatico/estilo.css`
- Create, como cópias destes arquivos:
  - `chat-servidor/internal/admin/estatico/PlusJakartaSans-Variable.woff2`, de `windows/ui/assets/PlusJakartaSans-Variable.woff2`;
  - `chat-servidor/internal/admin/estatico/OFL.txt`, de `windows/ui/assets/OFL.txt`;
  - `chat-servidor/internal/admin/estatico/logo-negativo.png`, de `windows/ui/assets/starsonic-logo-negativo.png`.
- Modify: `chat-servidor/cmd/starsonic-chat/main.go`, com os subcomandos `admin-criar <usuario>`, `admin-senha <usuario>` e `admin-remover <usuario>`, que pedem a senha duas vezes, sem mostrar, e recebem `--dados <pasta>`
- Modify: `chat-servidor/internal/banco/empresas.go`, `pessoas.go` e `computadores.go`

**Interfaces:**
- **Consumes:** as Tasks 2 a 8 (o `Hub.Fora` e o `Armazem.Apagar`).
- **Produces:**
  - `admin.Deps{Banco; Hub; Armazem; Teste bool}`, em que o `Teste` tira o `Secure` do cookie;
  - `admin.Novo(d Deps) http.Handler`, montado em `/admin/`;
  - **no banco:**
    - `CriarAdmin`, `TrocarSenha`, `RemoverAdmin`, `ConferirSenha(ctx, usuario, senha) (ok bool, travadoAte int64, err error)` e as sessões;
    - `Empresas(ctx) ([]ResumoEmpresa, error)`, com as pessoas, os bytes e a data;
    - `PessoasDaEmpresa(ctx, empresaID) ([]PessoaComComputadores, error)`;
    - `TrocarCodigo(ctx, empresaID) (string, error)`;
    - `TirarPessoa(ctx, empresaID, pessoaID) (computadores []int64, err error)`. Ela marca `saiu_em`, tira a pessoa dos grupos com o aviso `saiu` e passa o cuidado do grupo, como na Task 5. Ela também marca a saída dos computadores que agem como essa pessoa;
    - `TirarComputador(ctx, empresaID, computadorID) error`;
    - `ApagarEmpresa(ctx, empresaID) (arquivos []string, computadores []int64, err error)`.

As rotas:
- `GET /admin/entrar`, `POST /admin/entrar` e `POST /admin/sair`;
- `GET /admin/`, a lista de empresas;
- `GET /admin/empresas/nova` e `POST /admin/empresas`;
- `GET /admin/empresas/{id}`;
- `POST /admin/empresas/{id}/codigo`;
- `POST /admin/empresas/{id}/pessoas/{pid}/tirar`;
- `POST /admin/empresas/{id}/computadores/{cid}/tirar`;
- `GET /admin/empresas/{id}/apagar` e `POST /admin/empresas/{id}/apagar`;
- `GET /admin/estatico/{arquivo}`.

Os textos são os das telas `Painel` e `PainelEmpresa` do quadro. O "Apagar a empresa" pede o nome digitado.

- [ ] **Step 1: Os testes** (um cliente com um `cookiejar`, lendo o CSRF do HTML).
  - `TestEntrar_SenhaCerta` e `TestEntrar_SenhaErrada`:
    - a senha errada mostra "Usuário ou senha incorretos.";
    - a 6ª tentativa, mesmo com a senha certa, mostra "Muitas tentativas. Tente de novo daqui a 15 minutos.";
    - com o relógio 15 min adiante, a senha certa entra.
  - `TestSessao_Expira`: com o relógio 12 h e 1 s adiante, o `GET /admin/` manda para `/admin/entrar`.
  - `TestCookie`: o cookie se chama `sessao`, com `HttpOnly`, `SameSite=Strict`, `Path=/admin` e, fora do modo de teste, `Secure`.
  - `TestCSRF`: um `POST /admin/empresas` sem o token, ou com o token de outra sessão, responde 403, e nada é criado.
  - `TestCabecalhos`: toda página responde com `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`.
  - `TestNovaEmpresa`: "ACME Comércio Ltda" leva à página dela, com um código `STAR-XXXX-XXXX` que liga um computador pela API.
  - `TestTrocarCodigo`:
    - o código antigo responde `404 codigo` na API;
    - o computador já ligado continua com 200;
    - o código novo liga outro computador.
  - `TestTirarPessoa`:
    - os computadores dela respondem `401 chave` e recebem `{"tipo":"fora"}`, com o fechamento 4001;
    - nos grupos, entra o aviso `saiu`;
    - as mensagens dela vêm com `autor.saiu: true`;
    - o mesmo ramal, num computador novo, vira uma pessoa nova.
  - `TestTirarComputador`: só esse computador recebe 401 e `fora`, e o outro da mesma pessoa continua com 200.
  - `TestApagarEmpresa`:
    - com o nome errado, nada muda;
    - com o nome certo, as tabelas da empresa ficam vazias, os arquivos dela saem do disco e os computadores dela recebem 401;
    - a outra empresa continua intacta.
  - `TestSemConversas`:
    - com uma mensagem de texto "segredo-123" no banco, nenhuma página da administração tem "segredo-123";
    - um arquivo chamado "segredo-123.pdf" também não aparece pelo nome.
  - `TestHorasDeBrasilia` (Review Focus 3): com o relógio em `2026-11-04T12:43:00Z`, um computador que entrou às `12:43Z` aparece como "hoje, 09:43"; um de `2026-11-03T21:02:00Z` aparece como "ontem, 18:02"; um de `2026-11-01T15:00:00Z` aparece como "01/11/2026".
  - `TestAdminCriar` (em `main`):
    - com uma senha de 11 caracteres, dá erro e mostra "A senha precisa ter pelo menos 12 caracteres.";
    - com 12, volta 0;
    - o `senha_hash` começa com `$argon2id$v=19$m=65536,t=3,p=2$`.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - Os templates e os estáticos ficam embutidos com `embed`.
  - A comparação da senha é em tempo constante.
  - O token da sessão tem 32 bytes aleatórios, e o banco guarda só o hash dele.
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): a página de administração da Starsonic`.

### Task 10: Servir: o cadeado, o modo de teste e a configuração

**Files:**
- Create: `chat-servidor/internal/servidor/servidor.go`, `config.go`, `servidor_test.go`
- Modify: `chat-servidor/cmd/starsonic-chat/main.go` (o `servir`)

**Interfaces:**
- **Consumes:** `api.Novo`, `admin.Novo`, `eventos.NovoHub`, `armazem.Novo`, `tarefas.Rodar` e `banco.Abrir`.
- **Produces:**
  - `servidor.Config{Endereco, Dados string; Origens []string}`;
  - `servidor.LerConfig(caminho string) (Config, error)`, que lê um JSON com `endereco`, `dados` e `origens`, este opcional;
  - `servidor.Rodar(ctx, c Config) error`, em produção;
  - `servidor.RodarTeste(ctx, c Config, escutar string) error`;
  - `servidor.Montar(d Deps) http.Handler`, com `/api/v1/` e `/admin/`. Um `GET /` manda para `/admin/`.
  - O subcomando é `starsonic-chat servir [--config /etc/starsonic-chat/config.json] [--teste --escutar 127.0.0.1:8090 --dados <pasta>]`.

- [ ] **Step 1: Os testes.**
  - `TestModoTeste_SoLocal`: `RodarTeste` com `0.0.0.0:8090` e com `192.168.0.5:80` dá erro com a mensagem das Global Constraints; o `run` volta 2.
  - `TestModoTeste_Responde`: com `127.0.0.1:0`, o `POST /api/v1/computadores` e o `GET /admin/entrar` respondem.
  - `TestConfig`: sem `endereco`, ou com `dados` relativo, dá erro; sem `origens`, vale `["https://app.starsonic.local"]`.
  - `TestHostPolicy`: a política do autocert aceita o `endereco` e recusa `outro.example`.
  - `TestHSTS`: o handler de produção, testado com `httptest.NewTLSServer`, responde com `Strict-Transport-Security: max-age=31536000`.
  - `TestHTTPParaHTTPS`: o handler da porta 80 responde 301 para `https://<endereco>/…` e deixa passar `/.well-known/acme-challenge/`.
  - `TestDesligarComCalma`: depois de cancelar o `ctx`, o servidor fecha em menos de 10 s, e as conexões de WebSocket recebem o fechamento.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./...`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código.**
  - **O `http.Server`:** `ReadHeaderTimeout` de 10 s e `IdleTimeout` de 120 s. Não há `WriteTimeout` global, por causa do WebSocket e do download. O tempo fica nas rotas: 5 min no envio e no download.
  - **O cadeado:** o `autocert.Manager` tem o `Cache: autocert.DirCache(<dados>/certificados)` e a `HostPolicy: autocert.HostWhitelist(endereco)`, e o TLS tem no mínimo a versão 1.2.
  - **O desligamento:** `SIGTERM` e `SIGINT` fecham com calma (`Shutdown`, com até 10 s).
- [ ] **Step 4: Rodar os testes.**
  - Rode `go test -race ./...`.
  - Esperado: PASS.
- [ ] **Step 5: O commit.** `feat(chat): servir com o cadeado do Let's Encrypt e o modo de teste`.

### Task 11: A cópia de segurança, a instalação e o guia

**Files:**
- Create: `chat-servidor/internal/copia/copia.go`, `copia_test.go`
- Modify: `chat-servidor/cmd/starsonic-chat/main.go`, com `copia --dados <pasta> --destino <pasta>`
- Create:
  - `chat-servidor/deploy/starsonic-chat.service`;
  - `chat-servidor/deploy/starsonic-chat-copia.service` e `chat-servidor/deploy/starsonic-chat-copia.timer`;
  - `chat-servidor/deploy/instalar.sh` e `chat-servidor/deploy/copia.sh`.
- Create: `docs/chat-servidor.md`
- Modify: `.github/workflows/chat.yml`, que ganha o `shellcheck deploy/*.sh` e o `systemd-analyze verify deploy/*.service deploy/*.timer`

**Interfaces:**
- **Consumes:** `banco.Abrir` e `tempo`.
- **Produces:** `copia.Fazer(ctx, dados, destino string, r tempo.Relogio) (arquivo string, err error)`.
  - Ele abre uma conexão própria ao `<dados>/chat.db` e faz `VACUUM INTO '<destino>/chat-AAAA-MM-DD.db'`, com a data de Brasília.
  - Ele apaga, no `<destino>`, os `chat-*.db` de mais de 30 dias.

- [ ] **Step 1: Os testes.**
  - `TestCopia_Consistente`: com uma goroutine gravando mensagens o tempo todo, a cópia abre com `banco.Abrir`, o `PRAGMA integrity_check` dá `ok`, e as mensagens estão inteiras, de 1 até N, sem buraco.
  - `TestCopia_Guarda30Dias`: com 35 cópias com datas antigas no destino, depois de `Fazer` ficam as de até 30 dias e a nova.
- [ ] **Step 2: Rodar os testes.**
  - Rode `go test ./internal/copia/`.
  - Esperado: FAIL.
- [ ] **Step 3: Escrever o código e os arquivos de instalação.**
  - **`starsonic-chat.service`:**
    - roda com `User=starsonic-chat` e `ExecStart=/usr/local/bin/starsonic-chat servir --config /etc/starsonic-chat/config.json`;
    - tem `Restart=on-failure`, `AmbientCapabilities=CAP_NET_BIND_SERVICE` e `CapabilityBoundingSet=CAP_NET_BIND_SERVICE`;
    - tem `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, `ProtectKernelTunables=yes`, `ProtectControlGroups=yes`, `RestrictSUIDSGID=yes` e `LockPersonality=yes`;
    - tem `ReadWritePaths=/var/lib/starsonic-chat` e `StateDirectory=starsonic-chat`.
  - **O timer da cópia:** `OnCalendar=*-*-* 03:00:00 America/Sao_Paulo` e `Persistent=true`. O serviço dele roda o `copia.sh`, como root, com as mesmas proteções e acesso de leitura aos dados.
  - **O `copia.sh`:**
    - roda o `starsonic-chat copia --dados /var/lib/starsonic-chat --destino /var/lib/starsonic-chat/copias`;
    - depois, roda `rclone sync /var/lib/starsonic-chat/copias starsonic-chat-copia:copias` e `rclone sync /var/lib/starsonic-chat/arquivos starsonic-chat-copia:arquivos --backup-dir starsonic-chat-copia:apagados/<data>`;
    - por fim, roda `rclone delete --min-age 30d starsonic-chat-copia:apagados`;
    - sai com erro, com uma mensagem no journal, se o remoto `starsonic-chat-copia` não estiver configurado.
  - **O `instalar.sh`**, com `set -euo pipefail`, faz duas coisas:
    - **`instalar <endereço>`:**
      - confere se é root, se a máquina é Ubuntu ou Debian com systemd e se as portas 80 e 443 estão livres;
      - baixa da mesma release o binário e o `.sha256` e confere o SHA-256;
      - cria o usuário de sistema `starsonic-chat`, sem shell, e as pastas;
      - grava o `/etc/starsonic-chat/config.json` com o endereço e a pasta de dados;
      - instala as unidades, liga o serviço e o timer, e mostra o próximo passo (criar o usuário da administração);
    - **`atualizar`:** baixa, confere, troca o binário, reinicia o serviço e mostra a versão.
  - **`docs/chat-servidor.md`**, para o responsável, com comandos de uma linha e sem `_`:
    1. o que a VM precisa (seção 12 da spec), o DNS e as portas;
    2. instalar;
    3. criar o usuário da administração;
    4. conferir a instalação: o cadeado em `https://<endereço>/admin/`, criar a empresa de teste, ver o código e apagar a empresa;
    5. configurar o destino da cópia (`rclone config`, com o nome `starsonic-chat-copia`) e testar a cópia na hora;
    6. voltar uma cópia;
    7. atualizar;
    8. tirar uma pessoa antes de o ramal passar para outra;
    9. ver os registros (`journalctl -u starsonic-chat`);
    10. os problemas comuns: o certificado sem DNS, as portas fechadas e o disco cheio.
- [ ] **Step 4: Rodar as conferências.**
  - Rode `go test -race ./...`, `shellcheck chat-servidor/deploy/*.sh` e `systemd-analyze verify chat-servidor/deploy/*.service chat-servidor/deploy/*.timer`, se o ambiente tiver os dois.
  - Esperado: PASS. Sem o `shellcheck` ou o `systemd-analyze` aqui, o CI confere.
- [ ] **Step 5: O commit.** `feat(chat): a cópia de segurança, a instalação na VM e o guia do servidor`.

### Task 12: A publicação

**Files:**
- Create: `.github/workflows/chat-release.yml`
- Modify: `docs/chat-servidor.md` (a seção "Publicar uma versão")

**Interfaces:**
- **Consumes:** o build da Task 1, e o `instalar.sh` e o `copia.sh` da Task 11.
- **Produces:** a release `chat-v<versão>`, com estes arquivos:
  - `starsonic-chat-linux-amd64`;
  - `starsonic-chat-linux-amd64.sha256`;
  - `instalar.sh`, com a versão embutida;
  - `copia.sh`.

- [ ] **Step 1: O workflow.**
  - Ele é disparado só por `workflow_dispatch`, com a entrada `versao`.
  - Ele confere a `versao` com `^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$` e se a tag `chat-v<versao>` ainda não existe.
  - Ele roda os testes, faz o build com o `-ldflags` da versão e confere se `./starsonic-chat-linux-amd64 versao` mostra a `versao`.
  - Ele cria a release com `gh api`, como `prerelease: true` e `make_latest: "false"`.
  - Depois, ele confere se `gh api repos/{owner}/{repo}/releases/latest` ainda responde 404. Se não responder, ele falha com a mensagem `releases/latest deixou de ser 404: o canal Estável do app vai ler esta release`.
- [ ] **Step 2: Conferir o workflow.**
  - Rode o `actionlint` no `.github/workflows/chat*.yml`, se o ambiente tiver ou se ele puder ser baixado de uma release do GitHub dele.
  - Esperado: sem erros.
- [ ] **Step 3: O guia.** Em `docs/chat-servidor.md`, o caminho para publicar: Actions, depois chat-release, depois Run workflow, com a versão `0.1.0`. Depois, o que conferir: o SHA-256 e o `releases/latest` em 404.
- [ ] **Step 4: O commit.** `ci(chat): a publicação do servidor do chat, sem virar a latest`.

---

## Depois das tarefas
- **A revisão final** (no modelo mais capaz) olha a etapa inteira, pela seção 9 da spec, que é a revisão de segurança da seção 9.4. Ela confere o código contra o `docs/chat-protocolo.md`.
- **O CI** `chat` tem de estar verde no último commit.
- **A entrega:** o responsável publica a `chat-v0.1.0` e instala na VM pelo `docs/chat-servidor.md`. O resultado vira a `starsonic-phone/entrega-chat-servidor-0.1.0.md` no Project.
