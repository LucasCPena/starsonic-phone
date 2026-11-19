# O estado dos ramais na administração do chat: o servidor e as páginas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a página de administração do chat mostra, por pessoa e por empresa, se o ramal está online, sem registro, no chat ou offline, e o chat ganha a operação com que o app do Windows vai dizer o estado do ramal.

**Architecture:**
- **O hub dos eventos** já sabe quais computadores estão ligados ao chat. Ele passa a guardar, na ligação de cada um, o que o app disse do ramal, e a responder "quem está ligado, como qual pessoa, e com qual estado".
- **A operação nova,** `PUT /api/v1/computadores/eu/ramal`, escreve no hub. Nada vai para o banco.
- **As regras dos estados** ficam num pacote novo e puro (`internal/ramais`), sem banco e sem HTTP. As duas páginas juntam o que o banco já dá com o que o hub responde.
- **Um arquivo de JavaScript** busca a página de novo a cada 30 s e troca só as partes que mudam sozinhas.

Esta é a primeira das duas entregas da spec (seção 11). Com ela, os apps de hoje aparecem como "No chat" e "Offline". O "Online" e o "Sem registro" chegam com a segunda entrega, a do app do Windows, que tem um plano à parte.

**Tech Stack:**
- **Go** (o do `chat-servidor/go.mod`), `html/template`, o SQLite e o `coder/websocket` que o chat já usa. Nenhum módulo novo.
- **JavaScript** sem biblioteca, no estilo do `copiar.js` (ES5, um arquivo externo).
- **Os testes no navegador** do `chat-servidor/pagina`: Node 22, `@playwright/test` 1.56.1 e `typescript` 5.9.3, sem pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md`. Vale a spec inteira, menos a seção 7.3 (o app do Windows) e as partes dos testes e do roteiro que precisam dele.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-1`. Cada tarefa dá commit, por caminho, e push.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **O banco não ganha tabela nem coluna** (critério 7 da spec). A pasta `internal/banco/migracoes/` não muda.
- **Os registros do servidor não ganham nome, ramal nem estado de ninguém.** O registro de cada pedido continua com o método, a rota, o status e o tempo.
- **A regra de segurança das páginas não muda:** `default-src 'self'`. Nenhum `style="…"` e nenhum `<script>` sem `src` no HTML. Todo estilo novo vai no `estilo.css`, e o script novo é um arquivo de `internal/admin/estatico/`.
- **Os valores da spec (seção 8):**

  | O quê | Valor |
  |---|---|
  | A atualização da página | a cada 30 s |
  | O tempo sem registrar para virar "Sem registro" | 60 s |
  | O limite da operação | 30 por minuto, por computador, além dos 600 gerais |
  | Os segundos que o app pode mandar | de 0 a 31.536.000 |
  | As linhas do cartão "Sem registro agora" | até 50 |
  | O tempo para montar a primeira página, com 200 empresas e 5.000 pessoas | menos de 1 s, no teste |

- **Cada estado tem um desenho e um texto.** A cor nunca diz o estado sozinha. O desenho leva `aria-hidden="true"`, e o texto é o que o leitor de tela lê.
- **O repositório é público:** nenhum segredo, endereço de verdade ou nome de verdade em arquivo, teste ou registro. Os nomes dos testes são os inventados que o chat já usa (ACME Comércio Ltda, Clínica Vida, Ana Souza, Beatriz Ramos, Carlos Lima, João Pereira, Recepção), e o usuário e a senha da administração são os inventados do `admin_test.go`, nos testes do Go, e o usuário `teste` com uma senha sorteada a cada rodada, nos testes do navegador (como os outros testes de navegador do repositório já fazem, pelo `CHAT_ADMIN_SENHA`).
- **Ninguém publica versão:** o `chat-release` é rodado pelo responsável. Nenhuma tarefa roda o `instalar.sh`, cria tag ou release.
- **O que não muda:** o `video-servidor/`, o `windows/`, o `android/` e a página da reunião (`internal/pagina/`).

## A máquina de desenvolvimento

- Os comandos do `go` levam `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`.
- Ela tem 2 processadores. O `go test -race ./...` e o Playwright entram na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```

## Os textos

Os textos entre crases aparecem na página exatamente assim, com as aspas curvas e as reticências de um caractere só (`…`).

| Onde | Texto |
|---|---|
| Os quatro estados da pessoa | `Online`, `Sem registro`, `No chat`, `Offline` |
| A segunda linha do Online | `há 2 h` |
| A segunda linha do Sem registro | `há 12 min · o app diz “Conectando…”` |
| A segunda linha do No chat, com algum computador registrando | `registrando o ramal…` |
| A segunda linha do No chat, sem nenhum registrando | `o app é antigo e não diz o ramal` |
| A segunda linha do Offline | `última vez ontem, 18:02` (a hora como a página já escreve hoje) |
| A segunda linha do Offline, sem computador nenhum | `sem computador no chat` |
| O que o app diz | `conectando`: `Conectando…`; `erro`: `Erro no cadastro`; `semConexao`: `Sem conexão com a central` |
| Há quanto tempo | menos de 1 min: `há menos de 1 min`; até 59 min: `há 12 min`; até 23 h: `há 2 h`; depois: `há 1 dia`, `há 3 dias`. Sempre para baixo. Um tempo negativo conta como zero. |
| As contas | `21 online`, `1 sem registro`, `3 no chat`, `12 offline`, nessa ordem. O `sem registro` e o `no chat` só aparecem quando não são zero. |
| O estado de um computador, para o leitor de tela, depois do nome | `, online`, `, sem registro`, `, no chat`, `, offline` |
| O cabeçalho da tabela das pessoas | `NOME`, `RAMAL`, `ESTADO`, `COMPUTADORES` e a coluna do `Tirar` |
| A legenda, nesta ordem | **Online:** `o app está aberto e o ramal está registrado na central.` **Sem registro:** `o app está aberto, mas o ramal não registra há 1 minuto ou mais. É o caso para olhar.` **Offline:** `o chat perdeu o computador. O app foi fechado, o PC desligou ou a internet caiu.` **No chat:** `o app acabou de abrir e está registrando o ramal, ou é um app antigo, que ainda não diz como está o ramal.` |
| A nota da página da empresa | `Esta página se atualiza sozinha a cada 30 segundos.` `Um PC que perde a rede pode levar até 2 minutos para aparecer offline. O celular e os aparelhos de mesa não aparecem aqui.` |
| A nota da primeira página | `Esta página se atualiza sozinha a cada 30 segundos.` `Só aparecem os computadores com o app do Windows ligado ao chat: o celular e os aparelhos de mesa não entram na conta.` |
| O cartão de número a mais | o número e `ramais sem registro agora` (com 1: `ramal sem registro agora`). Com zero, o cartão não existe. |
| O cartão da lista | o título `SEM REGISTRO AGORA`; ao lado, `O app está aberto, mas o ramal não registra na central.`; as colunas `EMPRESA`, `NOME`, `RAMAL`, `HÁ QUANTO TEMPO`, `O APP DIZ` e a do `Abrir` |
| A lista vazia | `Nenhum ramal sem registro agora.` |
| A lista com mais de 50 | embaixo da tabela: `Mais 12 ramais sem registro não cabem nesta lista. Abra a empresa para ver todos.` (com 1: `Mais 1 ramal sem registro não cabe nesta lista. Abra a empresa para ver.`) |
| A coluna nova da tabela das empresas | `RAMAIS AGORA`, depois da `EMPRESA` |
| O aviso da busca que falhou | `Sem atualizar desde as 14:32. A página tenta de novo sozinha.` |
| O aviso do foco | `Sem atualizar desde as 14:32: a página espera você sair do campo ou do botão em que está.` |

A primeira frase de cada nota (`Esta página se atualiza sozinha a cada 30 segundos.`) fica num elemento com `hidden`, que o script mostra. Sem o JavaScript ela não aparece, e o resto da nota fica.

## Os desenhos

O quadro "Starsonic Phone — telas do chat" tem as duas telas (linha "O estado dos ramais"). Ele não está no repositório; os valores dele são estes. As cores novas viram variáveis no `:root` do `estilo.css`.

| Peça | Como é |
|---|---|
| A conta (pílula) | altura 28 px; 0 e 11 px por dentro; cantos 999 px; letra 12,5 px, peso 700; não quebra a linha; 7 px entre o desenho e o texto; 6 px entre as pílulas |
| A conta `online` | fundo `#f5f7fb`, borda 1 px `#e7eaf2`; uma bolinha cheia de 9 px, `#22c55e` |
| A conta `sem registro` | fundo `#fff6f6`, borda 1 px `#d64545`, texto `#8f1d1d`; um triângulo de 13 px só com o contorno (traço 2,6), na cor do texto |
| A conta `no chat` | como a `online`, com a bolinha `#00a5ad` |
| A conta `offline` | fundo branco, borda 1 px `#e7eaf2`, texto `#5b6478`; um anel de 9 px, borda 2 px `#8a93a8` |
| O estado da pessoa | o desenho à esquerda, e duas linhas: o nome do estado (peso 800) e a segunda linha (12,5 px, `#5b6478`); 10 px entre o desenho e o texto |
| O desenho do `Online` | bolinha cheia de 10 px, `#22c55e`, com um halo de 4 px `rgba(34, 197, 94, 0.2)` |
| O desenho do `Sem registro` | triângulo de 18 px com a exclamação, traço 2,4, `#b3261e` |
| O desenho do `No chat` | bolinha cheia de 10 px, `#00a5ad`, com um halo de 4 px `rgba(0, 194, 203, 0.18)` |
| O desenho do `Offline` | anel de 10 px, borda 2 px `#8a93a8` |
| A bolinha de um computador | 7 px, borda 2 px, antes do nome: cheia `#22c55e` (online), cheia `#b3261e` (sem registro), cheia `#00a5ad` (no chat), só o anel `#8a93a8` (offline) |
| A legenda | embaixo da tabela, com uma linha de 1 px `#e7eaf2` em cima; uma grade `repeat(auto-fit, minmax(230px, 1fr))`, 12 e 24 px entre os itens; 13 px, `#5b6478`; o nome de cada estado em negrito, `#0a0e1a` |
| O cartão de número a mais | como os outros números, com fundo `#fff6f6`, borda 1,5 px `#d64545` e texto `#8f1d1d`; o triângulo com a exclamação, de 24 px, antes do número |
| Os triângulos | o contorno: `M12 4l9 16H3z`; a exclamação: `M12 10v4.5M12 17.4v.1`; num `viewBox` de 24, sem preenchimento, pontas arredondadas |
| Os avisos de "sem atualizar" | uma faixa no alto do conteúdo, com as cores de erro que o `estilo.css` já tem (`--erro` e `--erro-fundo`) |

## Review Focus

1. **A sessão que vence com a página aberta.** A sessão da administração dura 12 horas, e uma página de monitorar fica aberta o dia inteiro. A busca automática recebe a entrada no lugar da página. Quem olha tem de ver a entrada, e nunca a entrada desenhada dentro da tabela, nem um estado velho com cara de novo (tarefa 7, teste "a sessão que venceu leva à entrada").
2. **A empresa apagada, ou a pessoa tirada, em outra aba.** A busca automática de uma empresa que não existe mais responde 404. A página se recarrega e mostra "Não encontrada" (tarefa 7, teste "a empresa apagada").
3. **Os botões depois de uma troca.** As partes trocadas têm formulários (`Tirar do chat`, o `×` de cada computador). Depois de uma atualização automática, o `Tirar do chat` continua funcionando, e o `Copiar o código`, que fica fora das partes trocadas, continua na tela (tarefa 7, teste "os botões continuam valendo depois de uma atualização").
4. **Nomes com sinais do HTML.** O nome da empresa, da pessoa e do computador aparecem em lugares novos (o cartão "Sem registro agora", o texto escondido do computador). Um nome como `<b>&"Zé"` aparece escrito, e não vira marcação, nas duas páginas e depois de uma troca (tarefas 5 e 6).
5. **Tempos estranhos.** Um app pode mandar 0 segundos, um ano inteiro, e o relógio do servidor pode andar para trás entre o pedido e a página. A página escreve `há menos de 1 min`, `há 365 dias` e nunca um tempo negativo (tarefas 1 e 5).

---

### Task 1: As regras dos estados

**Files:**
- Create: `chat-servidor/internal/ramais/ramais.go`
- Test: `chat-servidor/internal/ramais/ramais_test.go`

**Interfaces:**
- Produces:
  ```go
  // Package ramais são as regras do estado dos ramais (spec, seção 4.2): sem banco e sem HTTP.
  package ramais

  // Estado é o que o app diz do ramal.
  type Estado string

  const (
      Conectado  Estado = "conectado"
      Conectando Estado = "conectando"
      Erro       Estado = "erro"
      SemConexao Estado = "semConexao"
  )

  // Valido diz se o texto é um dos quatro estados.
  func Valido(e string) bool

  const (
      MaxSegundos       = 31_536_000        // o maior tempo que o app pode mandar: um ano
      EsperaSemRegistro = 60 * time.Second  // sem registrar há tanto, o computador é "sem registro"
  )

  // Dito é o que o app disse do ramal: o estado, e desde quando ele vale.
  type Dito struct {
      Estado Estado
      Desde  time.Time
  }

  // DoComputador é o estado de um computador na página.
  type DoComputador int

  const (
      PCFora        DoComputador = iota // o chat não tem o computador ligado como esta pessoa
      PCSemDado                         // ligado, e o app não disse nada (um app antigo)
      PCRegistrando                     // ligado, sem registrar há menos de 1 minuto
      PCSemRegistro                     // ligado, sem registrar há 1 minuto ou mais
      PCRegistrado                      // ligado, e o ramal está registrado
  )

  // Visto é um computador de uma pessoa: se está ligado ao chat como ela agora, e o que o app disse.
  type Visto struct {
      Ligado bool
      Dito   *Dito // nil: o app não disse nada
  }

  // Computador calcula o estado de um computador.
  func Computador(v Visto, agora time.Time) DoComputador

  // DaPessoa é o estado de uma pessoa na página.
  type DaPessoa int

  const (
      Offline DaPessoa = iota
      NoChat
      SemRegistro
      Online
  )

  // Pessoa é o estado de uma pessoa, com o que a segunda linha da página precisa.
  type Pessoa struct {
      Estado      DaPessoa
      Desde       time.Time // Online e SemRegistro: desde quando está assim o computador que está assim há mais tempo
      Diz         Estado    // SemRegistro: o que diz esse computador
      Registrando bool      // NoChat: algum computador está registrando (senão, é um app antigo)
  }

  // DaPessoaCom calcula o estado da pessoa pelos computadores dela. Vale a primeira linha que bate, na ordem
  // da spec: algum registrado, algum sem registro, algum registrando ou sem dado, e senão offline.
  func DaPessoaCom(computadores []Visto, agora time.Time) Pessoa
  ```

- [ ] **Step 1: Escrever os testes**

  `TestValido`: os quatro valores valem; `""`, `"Conectado"`, `"sem_conexao"` e `"ok"` não.

  `TestComputador`, uma tabela, com `agora` fixo:

  | O computador | Espera |
  |---|---|
  | não ligado, sem dito | `PCFora` |
  | não ligado, com um dito `conectado` | `PCFora` |
  | ligado, sem dito | `PCSemDado` |
  | ligado, `conectado` desde agora | `PCRegistrado` |
  | ligado, `conectado` há 2 h | `PCRegistrado` |
  | ligado, `conectando` há 59 s | `PCRegistrando` |
  | ligado, `conectando` há 60 s | `PCSemRegistro` |
  | ligado, `erro` há 59 s e há 60 s | `PCRegistrando` e `PCSemRegistro` |
  | ligado, `semConexao` há 59 s e há 60 s | `PCRegistrando` e `PCSemRegistro` |
  | ligado, `erro` com o `Desde` 5 s depois do `agora` | `PCRegistrando` |

  `TestDaPessoaCom`, outra tabela:

  | Os computadores | Espera |
  |---|---|
  | nenhum | `Offline` |
  | dois fora | `Offline` |
  | um registrado há 35 min e um fora | `Online`, `Desde` de 35 min atrás |
  | dois registrados, há 2 h e há 10 min | `Online`, `Desde` de 2 h atrás |
  | um registrado e um sem registro | `Online` |
  | dois sem registro: `conectando` há 12 min e `erro` há 3 min | `SemRegistro`, `Desde` de 12 min atrás, `Diz` igual a `Conectando` |
  | um sem registro (`erro` há 3 min) e um registrando | `SemRegistro`, `Diz` igual a `Erro` |
  | um registrando e um sem dado | `NoChat`, `Registrando` verdadeiro |
  | só um sem dado | `NoChat`, `Registrando` falso |
  | um sem dado e um fora | `NoChat`, `Registrando` falso |

  Nos casos que não são `Online` nem `SemRegistro`, o `Desde` é o zero do `time.Time` e o `Diz` é vazio.

- [ ] **Step 2: Ver os testes falharem**

  Run, em `chat-servidor`: `go test ./internal/ramais/`
  Expected: FAIL na compilação, com `undefined: Valido` (e os outros nomes).

- [ ] **Step 3: Escrever o `ramais.go`**

  As assinaturas do bloco acima. O tempo sem registrar é `agora.Sub(dito.Desde)`.

- [ ] **Step 4: Ver os testes passarem**

  Run: `go test ./internal/ramais/` e `gofmt -l internal/ramais`
  Expected: `ok`, e o `gofmt` sem nenhuma linha.

- [ ] **Step 5: Commit**

  ```bash
  git add chat-servidor/internal/ramais
  git commit -m "feat(chat): as regras do estado dos ramais" -- chat-servidor/internal/ramais
  git push origin reunioes-etapa-1
  ```

---

### Task 2: O hub diz quem está ligado e guarda o que o app disse

**Files:**
- Modify: `chat-servidor/internal/eventos/eventos.go`
- Test: `chat-servidor/internal/eventos/eventos_test.go`

**Interfaces:**
- Consumes: `ramais.Dito` (tarefa 1).
- Produces:
  ```go
  // Ligado é um computador que está no hub agora: com o canal aberto, ou abrindo (do Reservar em diante).
  type Ligado struct {
      Pessoa int64        // a pessoa da vez (0: ninguém ainda)
      Ramal  *ramais.Dito // o que o app disse do ramal dessa pessoa; nil: nada
  }

  // Ligados devolve os computadores que estão no hub agora. O mapa e os ditos são cópias.
  func (h *Hub) Ligados() map[int64]Ligado

  // DefinirRamal guarda, na ligação do computador, o que o app disse do ramal da pessoa. Devolve false, sem
  // guardar nada, se o computador não está no hub.
  func (h *Hub) DefinirRamal(computadorID, pessoaID int64, d ramais.Dito) bool
  ```

**As três regras (spec, seção 7.2):**
- O `Ligado.Ramal` só vem enquanto a pessoa da vez da ligação é a pessoa do `DefinirRamal` (e não é 0). O dito fica guardado na ligação com a pessoa dele: o `DefinirPessoa` não apaga nada, e a volta para a mesma pessoa mostra o dito de novo.
- No `Reservar`, quando o computador já tem uma ligação no hub, a nova herda o dito e a pessoa do dito. A antiga fecha com 4000, como hoje.
- O dito mora na `conexao`. Quando ela sai do hub sem outra no lugar, ele vai junto, sem mais nada.

- [ ] **Step 1: Escrever os testes**

  Com os ajudantes que o `eventos_test.go` já tem (`par`, `servir`, `esperar`, `fechamento`):

  - `TestLigados`: um hub vazio devolve um mapa vazio. Depois do `Reservar(5)`, o mapa tem o 5 com `Pessoa` 0. Depois do `DefinirPessoa(7)` da reserva, `Pessoa` 7. Com o `Servir` rodando, continua lá. Quando o cliente fecha e o `Servir` volta, o 5 sai do mapa.
  - `TestDefinirRamal`: sem o computador no hub, devolve `false`. Com a reserva e a pessoa 7, devolve `true`, e o `Ligados()[5].Ramal` tem o mesmo estado e o mesmo instante. Mudar o valor que o `Ligados` devolveu não muda o que o hub guarda. Depois do `DefinirPessoa(5, 8)`, o `Ramal` é `nil`; de volta à 7, ele aparece de novo. Um `DefinirRamal(5, 8, …)` com a pessoa da vez ainda na 7 devolve `true` e deixa o `Ramal` em `nil`: a ligação guarda um dito só, e ele agora é o da 8.
  - `TestRamal_OutraLigacao`: a ligação A do computador 5, com a pessoa 7 e um dito, servindo. Uma ligação B do mesmo computador (`Reservar` e `DefinirPessoa(7)`): a A fecha com 4000, e, depois de o `Servir` da A voltar, o `Ligados()[5].Ramal` continua com o dito.
  - `TestRamal_SomeComALigacao`, um subteste para cada saída: o cliente fecha; o `Fora`; o `Desistir` de uma reserva; a fila cheia (o 4002, como no `TestComputadorLento`); o `Encerrar`. Em todos, o computador sai do `Ligados()`, e uma reserva nova dele, com a mesma pessoa, vem com o `Ramal` `nil`.

- [ ] **Step 2: Ver os testes falharem**

  Run: `go test ./internal/eventos/`
  Expected: FAIL na compilação, com `h.Ligados undefined` e `h.DefinirRamal undefined`.

- [ ] **Step 3: Implementar**

  Dois campos novos na `conexao`, guardados pelo `Hub.mu`: o dito (`*ramais.Dito`) e a pessoa dele. Os dois métodos, e a herança no `Reservar`.

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `go test -race ./internal/eventos/`
  Expected: `ok`. Os testes que já existiam continuam passando.

- [ ] **Step 5: Commit**

  ```bash
  git commit -m "feat(chat): o hub diz quem está ligado e guarda o estado do ramal" -- chat-servidor/internal/eventos
  git push origin reunioes-etapa-1
  ```

---

### Task 3: A operação que diz o estado do ramal

**Files:**
- Create: `chat-servidor/internal/api/ramal.go`
- Modify: `chat-servidor/internal/api/api.go` (a rota e o limite novo no `servidor`)
- Test: `chat-servidor/internal/api/ramal_test.go`

**Interfaces:**
- Consumes: `ramais.Valido`, `ramais.MaxSegundos`, `ramais.Dito` (tarefa 1); `Hub.DefinirRamal`, `Hub.Ligados` (tarefa 2); o `proteger`, o `precisaPessoa`, o `lerJSON`, o `erroCampo` e o `escreverErro` que a API já tem.
- Produces: a rota `PUT /api/v1/computadores/eu/ramal` (spec, seção 7.1).
  - Corpo: `{"estado": "erro", "segundos": 734}`.
  - `204`, sem corpo: o hub guardou o estado, com o `Desde` igual ao relógio do banco menos os segundos.
  - Os erros, na ordem em que valem: `401 chave`; `429 limite` (os 600 gerais, e os 30 por minuto desta rota, por computador); `409 pessoa`; `400 invalido`; `409 semLigacao`.
  - O `400 invalido` vem com `"campo": "estado"` (faltou, é `null` ou está fora da lista) ou `"campo": "segundos"` (faltou, é `null` ou está fora de 0 a 31.536.000). Um corpo que o servidor não consegue ler nesse formato (não é JSON, um texto nos segundos, um número quebrado) vem sem campo, como nas outras operações.
  - Todo pedido com a chave boa conta nos 30 por minuto, também o que acaba em erro.

- [ ] **Step 1: Escrever os testes**

  Com o `apitest` (a empresa, o `LigarComPessoa`, o `Conectar` e o `Pedir`):

  - `TestRamal_Guarda`: para cada um dos quatro estados, com os segundos 0, 734 e 31536000: a resposta é `204`, sem corpo, e o `a.Hub.Ligados()` do computador tem esse estado, com o `Desde` igual a `a.Relogio.Agora()` menos os segundos.
  - `TestRamal_Invalido`, uma tabela. Em todas as linhas o status é `400`, o `erro` é `invalido`, e o hub continua sem estado para o computador:

    | O corpo | O `campo` |
    |---|---|
    | `{"estado":"ok","segundos":1}` | `estado` |
    | `{"segundos":1}` | `estado` |
    | `{"estado":null,"segundos":1}` | `estado` |
    | `{"estado":"erro"}` | `segundos` |
    | `{"estado":"erro","segundos":null}` | `segundos` |
    | `{"estado":"erro","segundos":-1}` | `segundos` |
    | `{"estado":"erro","segundos":31536001}` | `segundos` |
    | `{"estado":"erro","segundos":"7"}` | sem campo |
    | `{"estado":"erro","segundos":1.5}` | sem campo |
    | `isto não é JSON` | sem campo |

  - `TestRamal_SemChave`: sem o `Authorization`, `401 chave`.
  - `TestRamal_SemPessoa`: um computador ligado à empresa, com o canal aberto, em que ninguém entrou: `409 pessoa`.
  - `TestRamal_SemLigacao`: um computador com pessoa e sem o canal aberto: `409 semLigacao`, e ele não aparece no `Ligados()`. Com só a reserva (`a.Hub.Reservar` do id dele, sem o `Servir`): `204`.
  - `TestRamal_Limite`: 30 pedidos bons seguidos respondem `204`. O 31º responde `429`, com o `erro` `limite` e o `esperarSegundos` entre 1 e 60. Outro computador, no mesmo minuto, responde `204`. Com o relógio 1 minuto adiante, o primeiro volta a responder `204`.
  - `TestRamal_TrocaDePessoa`: o computador diz `erro` como a pessoa do ramal 2001. O mesmo computador entra como a do 2002 (`a.Entrar`): o `Ligados()` dele tem a pessoa nova e o `Ramal` `nil`. Ele diz `conectado`: o `Ramal` volta, com `conectado`.
  - `TestRamal_Registros`: com o `slog` desviado para um buffer (como o `servidor_test.go` faz, com o de antes de volta no `Cleanup`), um pedido bom com o estado `semConexao`, da pessoa "Carlos Lima", ramal 2011. O registro tem a linha do pedido com a rota `PUT /api/v1/computadores/eu/ramal` e o status 204, e não tem `semConexao`, `Carlos` nem `2011`.

- [ ] **Step 2: Ver os testes falharem**

  Run: `go test ./internal/api/ -run TestRamal`
  Expected: FAIL. O `TestRamal_Guarda` recebe `404` (a rota não existe) no lugar do `204`.

- [ ] **Step 3: Implementar**

  A rota entra no `Novo`, ao lado das dos computadores:
  ```go
  mux.HandleFunc("PUT /api/v1/computadores/eu/ramal",
      s.proteger(precisaPessoa(s.dizerRamal), s.banco.ComputadorPorChave, s.ramalLimite))
  ```
  O `s.ramalLimite` é uma `limites.Janela` de `maxRamal = 30` por `periodoPedidos`, com o relógio do banco. O `dizerRamal` lê o corpo para um `struct` com os dois campos como ponteiros (`*string` e `*int64`), confere os dois, e chama o `DefinirRamal` com o `PessoaID` do computador do pedido. O `false` dele vira o `409 semLigacao`.

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `go test -race ./internal/api/`
  Expected: `ok`, com os testes de antes.

- [ ] **Step 5: Commit**

  ```bash
  git add chat-servidor/internal/api/ramal.go chat-servidor/internal/api/ramal_test.go
  git commit -m "feat(chat): a operação que diz o estado do ramal" -- chat-servidor/internal/api
  git push origin reunioes-etapa-1
  ```

---

### Task 4: As pessoas de todas as empresas, em duas consultas

**Files:**
- Modify: `chat-servidor/internal/banco/pessoas.go`
- Test: `chat-servidor/internal/banco/pessoas_test.go`

**Interfaces:**
- Produces:
  ```go
  // PessoasDeTodas são as pessoas ativas de todas as empresas, cada uma com os computadores dela, como o
  // PessoasDaEmpresa as devolve, e com o EmpresaID de cada uma. A ordem é a do nome sem acento e sem caixa
  // (no empate, a do id), sem separar por empresa. São duas consultas, seja qual for o número de empresas.
  func (b *Banco) PessoasDeTodas(ctx context.Context) ([]PessoaComComputadores, error)
  ```
  O `PessoasDaEmpresa` continua com a mesma assinatura e o mesmo resultado.

- [ ] **Step 1: Escrever o teste**

  `TestPessoasDeTodas`, no jeito do `TestPessoasDaEmpresa`: duas empresas; na primeira, duas pessoas, uma com dois computadores e um computador usado pelas duas; na segunda, uma pessoa, e uma pessoa tirada do chat. O resultado tem as três pessoas ativas, cada uma com o `EmpresaID` certo. Para cada empresa, as pessoas dela no resultado, na ordem em que vêm, são iguais (`reflect.DeepEqual`) ao que o `PessoasDaEmpresa` devolve. Sem empresa nenhuma, a lista vem vazia, e não `nil`.

- [ ] **Step 2: Ver o teste falhar**

  Run: `go test ./internal/banco/ -run TestPessoasDeTodas`
  Expected: FAIL na compilação, com `b.PessoasDeTodas undefined`.

- [ ] **Step 3: Implementar**

  Uma função interna só, com as duas consultas de hoje e o filtro `(?1 = 0 OR empresa_id = ?1)`, como o `resumosEmpresas` já faz. As duas funções públicas a chamam.

- [ ] **Step 4: Ver os testes passarem**

  Run: `go test ./internal/banco/`
  Expected: `ok`, com o `TestPessoasDaEmpresa` de antes.

- [ ] **Step 5: Commit**

  ```bash
  git commit -m "feat(chat): as pessoas de todas as empresas em duas consultas" -- chat-servidor/internal/banco
  git push origin reunioes-etapa-1
  ```

---

### Task 5: A página de uma empresa

**Files:**
- Create: `chat-servidor/internal/admin/ramais.go` (o que as duas páginas usam para montar os estados e os textos)
- Modify: `chat-servidor/internal/admin/admin.go` (o `empresa` e os tipos da tela dela)
- Modify: `chat-servidor/internal/admin/paginas/empresa.html`, `chat-servidor/internal/admin/paginas/base.html` (os desenhos novos, como `define`)
- Modify: `chat-servidor/internal/admin/estatico/estilo.css`
- Test: `chat-servidor/internal/admin/ramais_test.go`; ajustar `chat-servidor/internal/admin/pessoas_test.go`

**Interfaces:**
- Consumes: `ramais.Computador`, `ramais.DaPessoaCom` e os tipos deles (tarefa 1); `Hub.Ligados` (tarefa 2); `banco.PessoaComComputadores`.
- Produces, no `ramais.go` do `admin`, para a tarefa 6 usar também:
  ```go
  // contas são as pessoas de uma empresa em cada estado. A soma é o número de pessoas.
  type contas struct{ Online, SemRegistro, NoChat, Offline int }

  // pessoaVista é uma pessoa com o estado dela e o de cada computador (na ordem do Computadores).
  type pessoaVista struct {
      banco.PessoaComComputadores
      Estado ramais.Pessoa
      PCs    []ramais.DoComputador
  }

  // verPessoas calcula o estado de cada pessoa. Um computador só conta para a pessoa quando o hub o tem
  // ligado como ela.
  func verPessoas(pessoas []banco.PessoaComComputadores, ligados map[int64]eventos.Ligado, agora time.Time) []pessoaVista

  func contar(v []pessoaVista) contas

  // ha escreve há quanto tempo: "há menos de 1 min", "há 12 min", "há 2 h", "há 3 dias".
  func ha(d time.Duration) string

  // oQueDiz escreve o que o app diz: "Conectando…", "Erro no cadastro", "Sem conexão com a central".
  func oQueDiz(e ramais.Estado) string

  // estadoNaTela é o estado de uma pessoa como a página o mostra.
  type estadoNaTela struct {
      Classe  string // online, sem-registro, no-chat ou offline: a classe do desenho
      Nome    string // Online, Sem registro, No chat ou Offline
      Detalhe string // a segunda linha
  }

  func naTela(p pessoaVista, agora time.Time) estadoNaTela
  ```
- O HTML que a tarefa 7 e os testes procuram:
  - a seção das pessoas inteira (o título, as contas, a tabela e a legenda) leva `data-ao-vivo="pessoas"`;
  - cada conta é um `<span class="conta conta-online">` (ou `conta-sem-registro`, `conta-no-chat`, `conta-offline`), dentro de um `<div class="contas">`;
  - a célula do estado é `<td class="estado estado-online">` (ou as outras três classes), com o nome num `<span class="estado-nome">` e a segunda linha num `<span class="estado-detalhe">`;
  - cada computador tem, antes do nome, `<span class="pc pc-online" aria-hidden="true">` (ou as outras três) e, depois do nome, o texto do estado num `<span class="so-leitor">`;
  - a coluna `ÚLTIMA VEZ` sai. O `title` de cada computador (`Última vez: …`) continua;
  - a nota fica embaixo da seção das pessoas, fora dela, com a primeira frase num `<span data-so-com-script hidden>` (a tarefa 7 é que a mostra).

- [ ] **Step 1: Escrever os testes**

  No `ramais_test.go`, com o `novoPainel` e o `logado` que os testes da página já têm. Para pôr um computador num estado: o `Conectar` do `apitest` abre o canal, e o `Pedir` com o `PUT` da tarefa 3 diz o estado.

  - `TestHa` (teste de dentro do pacote, num arquivo `ramais_interno_test.go`): -5 s e 0 s dão `há menos de 1 min`; 59 s, o mesmo; 60 s, `há 1 min`; 59 min 59 s, `há 59 min`; 1 h, `há 1 h`; 23 h 59 min, `há 23 h`; 24 h, `há 1 dia`; 3 dias e 5 h, `há 3 dias`; 31.536.000 s, `há 365 dias`.
  - `TestEmpresa_Estados`: a ACME, com o relógio parado, e cinco pessoas:

    | A pessoa | Como fica | A linha dela mostra |
    |---|---|---|
    | Ana Souza | o NOTE-ANA ligado, `conectado` com 7200 s; o RECEPCAO-02, que ela usou antes, hoje com outra pessoa | `Online`, `há 2 h`; o NOTE-ANA com `pc-online` e `, online`; o RECEPCAO-02 com `pc-offline` e `, offline` |
    | Carlos Lima | o COMERCIAL-03 ligado, `conectando` com 720 s | `Sem registro`, `há 12 min · o app diz “Conectando…”`; `pc-sem-registro` |
    | Beatriz Ramos | o FIN-01 ligado, `erro` com 20 s | `No chat`, `registrando o ramal…`; `pc-no-chat` |
    | João Pereira | o COMERCIAL-01 ligado, sem dizer nada | `No chat`, `o app é antigo e não diz o ramal`; `pc-no-chat` |
    | Recepção | o RECEPCAO-02 sem o canal aberto, usado ontem às 18:02 | `Offline`, `última vez ontem, 18:02`; `pc-offline` |

    O teste lê cada linha pela célula do nome e confere a classe da célula do estado, o `estado-nome` e o `estado-detalhe`. As contas da página são `1 online`, `1 sem registro`, `2 no chat` e `1 offline`, nessa ordem. A página tem as quatro frases da legenda e a nota da tabela "Os textos", com a primeira frase dentro do `<span data-so-com-script hidden>`.
  - `TestEmpresa_ContasSemAlerta`: com uma pessoa online e uma offline, a página não tem `conta-sem-registro` nem `conta-no-chat`.
  - `TestEmpresa_ComputadorCompartilhado`: a Ana e a Recepção usaram o RECEPCAO-02, e a pessoa da vez dele é a Recepção, ligada e `conectado`. A Recepção aparece `Online`; a Ana, `Offline`, com o RECEPCAO-02 em `pc-offline`.
  - `TestEmpresa_DoisComputadores`: a Ana com dois computadores registrados, há 2 h e há 10 min: `Online`, `há 2 h`. Com um registrado e o outro fechado: `Online`.
  - `TestEmpresa_SemComputador`: uma pessoa cujo único computador foi tirado do chat: `Offline`, `sem computador no chat`.
  - `TestEmpresa_UmAno`: um computador `erro` com 31536000 s: `há 365 dias · o app diz “Erro no cadastro”`.
  - `TestEmpresa_NomesComSinais`: a pessoa `<b>&"Zé"` no computador `<i>PC</i>`: o HTML tem `&lt;b&gt;&amp;&#34;Zé&#34;` e `&lt;i&gt;PC&lt;/i&gt;`, e não tem `<b>&` nem `<i>PC`.
  - `TestEmpresa_SemEstiloNaPagina`: o HTML da página não tem `style="` nem um `<script` sem `src=`.

  No `pessoas_test.go`, o `ultimaVezNaLinha` passa a ler a "última vez" da segunda linha do estado (`última vez ontem, 18:02`, sem o prefixo) e continua lendo o `title` do computador. O `TestUltimaVezDaPessoa` e o `TestHorasDeBrasilia` continuam conferindo o mesmo, com as pessoas offline.

- [ ] **Step 2: Ver os testes falharem**

  Run: `go test ./internal/admin/ -run 'TestHa|TestEmpresa_|TestUltimaVezDaPessoa|TestHorasDeBrasilia'`
  Expected: FAIL na compilação (`undefined: ha`). Com o `ha` posto, os `TestEmpresa_` falham porque a página não tem a célula `estado`.

- [ ] **Step 3: Implementar**

  O `empresa` do `admin.go` chama o `p.hub.Ligados()` uma vez, o `verPessoas` e o `contar`, e monta a tela. O `empresa.html` ganha a coluna e as peças da lista acima; o `base.html`, os dois triângulos (`icone-alerta`, com a exclamação, e `icone-triangulo`, sem ela); o `estilo.css`, as peças da tabela "Os desenhos".

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `go test -race ./internal/admin/`
  Expected: `ok`, com todos os testes de antes da página.

- [ ] **Step 5: Olhar a página**

  Subir o chat no modo de teste numa pasta temporária, criar o usuário inventado, entrar, criar a ACME com as cinco pessoas do `TestEmpresa_Estados` (pela API, como o teste) e tirar um retrato da página a 1280 px e a 390 px de largura. Comparar com a tela do quadro: as contas, a coluna do estado, as bolinhas dos computadores e a legenda. A 390 px a tabela rola para o lado dentro do cartão, e a página não.

- [ ] **Step 6: Commit**

  ```bash
  git add chat-servidor/internal/admin/ramais.go chat-servidor/internal/admin/ramais_test.go chat-servidor/internal/admin/ramais_interno_test.go
  git commit -m "feat(chat): a página da empresa mostra o estado de cada ramal" -- chat-servidor/internal/admin
  git push origin reunioes-etapa-1
  ```

---

### Task 6: A primeira página

**Files:**
- Modify: `chat-servidor/internal/admin/admin.go` (o `empresas` e os tipos da tela dele), `chat-servidor/internal/admin/ramais.go`
- Modify: `chat-servidor/internal/admin/paginas/empresas.html`, `chat-servidor/internal/admin/estatico/estilo.css`
- Test: `chat-servidor/internal/admin/ramais_test.go`; ajustar o `TestListaDeEmpresas` do `empresas_test.go` só se uma frase que ele procura mudar de lugar

**Interfaces:**
- Consumes: `Banco.PessoasDeTodas` (tarefa 4); `verPessoas`, `contar`, `ha`, `oQueDiz` (tarefa 5); `Hub.Ligados`.
- Produces, no HTML:
  - a grade dos números leva `data-ao-vivo="numeros"`; o cartão a mais é um `<div class="numero numero-alerta">`, e só existe com um ramal sem registro ou mais;
  - o cartão das reuniões leva `data-ao-vivo="reunioes"`;
  - o cartão da lista leva `data-ao-vivo="sem-registro"` e existe sempre. Cada linha tem a empresa, o nome, o ramal, o `há …`, o que o app diz e o `Abrir` para a página da empresa;
  - o cartão da tabela das empresas leva `data-ao-vivo="empresas"`. A coluna `RAMAIS AGORA` tem o mesmo `<div class="contas">` da tarefa 5;
  - a nota nova vem antes da nota dos arquivos, que já existe, com a primeira frase num `<span data-so-com-script hidden>`.
- A ordem da lista: o que está sem registro há mais tempo vem primeiro. No empate, a ordem do nome da empresa e depois a do nome da pessoa. As 50 primeiras aparecem; o número do cartão e a frase "Mais N…" contam todas.
- O `empresas` lê o banco com um número fixo de consultas: as do resumo, as duas do `PessoasDeTodas` e as do cartão das reuniões. O `Hub.Ligados()` é chamado uma vez.

- [ ] **Step 1: Escrever os testes**

  - `TestPrimeiraPagina_Contas`: a ACME com uma pessoa online, uma sem registro e uma offline; a Clínica Vida com uma pessoa no chat e uma offline; uma empresa sem ninguém. A linha de cada empresa tem as contas dela, nessa ordem: `1 online`, `1 sem registro`, `1 offline`; `0 online`, `1 no chat`, `1 offline`; `0 online`, `0 offline`. O cartão a mais mostra `1` e `ramal sem registro agora`. A lista tem uma linha, com `ACME Comércio Ltda`, o nome, o ramal, `há 12 min`, `Conectando…` e o link da página da ACME.
  - `TestPrimeiraPagina_SemNinguem`: sem ramal sem registro, a página não tem `numero-alerta`, e o cartão da lista diz `Nenhum ramal sem registro agora.` A página tem a nota da tabela "Os textos", com a primeira frase dentro do `<span data-so-com-script hidden>`, e continua com a nota dos arquivos.
  - `TestPrimeiraPagina_Ordem`: três ramais sem registro, de duas empresas, há 3 min, há 12 min e há 2 h: as linhas vêm na ordem 2 h, 12 min, 3 min.
  - `TestPrimeiraPagina_Corte`: 51 ramais sem registro: a lista tem 50 linhas, o cartão a mais mostra `51`, e embaixo vem `Mais 1 ramal sem registro não cabe nesta lista. Abra a empresa para ver.` Com 62: `Mais 12 ramais sem registro não cabem nesta lista. Abra a empresa para ver todos.`
  - `TestPrimeiraPagina_NomesComSinais`: a empresa `A&B <Matriz>` com a pessoa `<b>&"Zé"` sem registro: os dois nomes aparecem escritos na lista e na tabela, e o HTML não tem `<b>&` nem `<Matriz>`.
  - `TestPrimeiraPagina_SemEstiloNaPagina`: como o da tarefa 5.
  - `TestPrimeiraPagina_Tempo`: 200 empresas e 5.000 pessoas (25 por empresa), cada pessoa com um computador. As linhas entram direto no banco, com um `INSERT … SELECT` sobre uma série (`WITH RECURSIVE`) para cada tabela: `empresas (nome, codigo, criada_em)`, `pessoas (empresa_id, ramal, nome, nome_busca, entrou_em)`, `computadores (empresa_id, chave_hash, nome, pessoa_id, ligado_em, ultima_vez)` e `computador_pessoas (computador_id, pessoa_id, primeira_vez, ultima_vez)`. Os 5.000 computadores entram no hub pelo `Reservar`, com a pessoa de cada um; um em cada dez diz `erro` há 300 s, um em cada dez não diz nada, e os outros dizem `conectado`. O teste pede a primeira página três vezes e confere que a mais rápida levou menos de 1 s, que a resposta é `200`, que o cartão a mais mostra `500` e que a lista tem 50 linhas.

- [ ] **Step 2: Ver os testes falharem**

  Run: `go test ./internal/admin/ -run TestPrimeiraPagina`
  Expected: FAIL: a página não tem a coluna `RAMAIS AGORA` nem o cartão da lista.

- [ ] **Step 3: Implementar**

  O `empresas` chama o `PessoasDeTodas` e o `Ligados` uma vez cada, separa as pessoas por empresa e usa o `verPessoas` e o `contar`. A lista sai das pessoas com o estado `SemRegistro`.

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `go test -race ./internal/admin/`
  Expected: `ok`. O `TestPrimeiraPagina_Tempo` passa também com o `-race`.

- [ ] **Step 5: Olhar a página**

  Como o passo 5 da tarefa 5, com a primeira página: o cartão a mais, o cartão da lista (com duas linhas, e vazio) e a coluna nova, a 1280 px e a 390 px.

- [ ] **Step 6: Commit**

  ```bash
  git commit -m "feat(chat): a primeira página mostra os ramais sem registro e as contas de cada empresa" -- chat-servidor/internal/admin
  git push origin reunioes-etapa-1
  ```

---

### Task 7: A página que se atualiza sozinha

**Files:**
- Create: `chat-servidor/internal/admin/estatico/atualizar.js`
- Modify: `chat-servidor/internal/admin/paginas/empresa.html`, `chat-servidor/internal/admin/paginas/empresas.html` (o `<script>` no bloco `scripts`, e o aviso), `chat-servidor/internal/admin/estatico/estilo.css` (o aviso)
- Modify: `chat-servidor/internal/admin/admin.go` (só o comentário do pacote, que diz que o único script é o do "Copiar o código")
- Test: `chat-servidor/internal/admin/estaticos_test.go` (o arquivo novo é servido, e as duas páginas o pedem)
- Create: `chat-servidor/pagina/admin.ts` (o que os testes do navegador usam: entrar, criar a empresa, e um computador de mentira que fala com a API)
- Modify: `chat-servidor/pagina/chat.ts` (o usuário da administração do chat de teste)
- Test: `chat-servidor/pagina/testes/admin.spec.ts`

**Interfaces:**
- Consumes: os `data-ao-vivo` e os `data-so-com-script` das tarefas 5 e 6; a operação da tarefa 3.
- Produces, no HTML das duas páginas:
  - `<script src="/admin/estatico/atualizar.js" defer></script>`, no bloco `scripts` (na da empresa, junto com o `copiar.js`);
  - o aviso, como primeiro filho do `<main>` de cada uma das duas páginas: `<p class="aviso-parado" id="sem-atualizar" role="status" hidden></p>`.
- O que o `atualizar.js` faz:
  1. Mostra os elementos com `data-so-com-script`.
  2. A cada 30 s depois do fim da rodada anterior, faz uma rodada.
  3. **A rodada espera** se o foco (`document.activeElement`) está num `input`, `select` ou `textarea`, dentro de um `form`, ou dentro de um elemento com `data-ao-vivo`. Ela não busca nada. Da segunda rodada seguida que espera em diante, o aviso mostra o texto do foco.
  4. **A busca** é um `fetch` do endereço da própria página, com os cookies, sem cache, e com 20 s de prazo.
     - Se a resposta foi redirecionada, ou é um `404`: `location.reload()`.
     - Se a resposta não é `200`, se a busca falha ou passa do prazo, ou se o HTML que veio não tem todas as partes `data-ao-vivo` que a página tem: o aviso mostra o texto da busca que falhou.
     - Senão, cada elemento com `data-ao-vivo` da página dá lugar ao de mesmo valor que veio, e o aviso some.
  5. A hora dos dois avisos é a da última vez em que a página ficou em dia (a carga, ou a última troca), no formato `14:32`, no fuso do navegador.
  O arquivo não usa `innerHTML` com texto montado por ele: o HTML que chega é lido com o `DOMParser`, e os elementos entram com o `importNode`.
- Produces, no `chat-servidor/pagina/admin.ts`:
  ```ts
  /** Entra na administração pela página de entrada, com o usuário `teste` e a senha da rodada (o `CHAT_ADMIN_SENHA`). */
  export function entrar(page: Page): Promise<void>;
  /** Cria uma empresa pela página, com um nome que nenhum outro teste usa. Devolve o nome, o código e o caminho da página dela. */
  export function criarEmpresa(page: Page, prefixo: string): Promise<{ nome: string; codigo: string; caminho: string }>;
  /** Um computador de mentira: fala com a API do chat como o app. */
  export class Computador {
    static ligar(codigo: string, nome: string, ramal: string, pessoa: string): Promise<Computador>;
    /** Abre o canal dos eventos (o bilhete e o WebSocket) e espera abrir. */
    abrirCanal(): Promise<void>;
    fecharCanal(): Promise<void>;
    /** O PUT do estado do ramal. Devolve o status. */
    dizerRamal(estado: string, segundos: number): Promise<number>;
  }
  ```

- [ ] **Step 1: Preparar o chat de teste**

  O `chat.ts` cria o usuário `teste` antes de subir o chat, com o `admin-criar` do próprio binário e uma senha sorteada na hora (ela entra duas vezes pela entrada padrão e vai para os testes pelo `process.env.CHAT_ADMIN_SENHA`, como no `video-servidor/e2e/ambiente.ts`). A senha nunca vai a uma mensagem de erro nem ao console. O `Computador` usa o `fetch` e o `WebSocket` do Node 22. Esse `WebSocket` não manda o cabeçalho `Origin` (medido em 19/11, no Node 22.23), e sem ele o chat aceita o bilhete sozinho.

- [ ] **Step 2: Escrever os testes do navegador**

  No `admin.spec.ts`. Cada teste entra, cria a empresa dele e liga os computadores dele: os testes rodam ao mesmo tempo, no mesmo chat, e só conferem o que é da empresa deles. O relógio da página é o do Playwright (`page.clock.install()` antes de abrir a página), e uma rodada é um `page.clock.fastForward(30_000)`.

  - `'a página da empresa mostra o estado e se atualiza sozinha'`: com o computador sem o canal, a linha da pessoa mostra `Offline`. Ele abre o canal; depois de uma rodada, `No chat` e `o app é antigo e não diz o ramal`. Ele diz `conectado` com 7200 s; uma rodada, `Online` e `há 2 h`. Ele diz `erro` com 720 s; uma rodada, `Sem registro` e `há 12 min · o app diz “Erro no cadastro”`, e a conta `1 sem registro`. Ele fecha o canal; uma rodada, `Offline`. Em nenhum momento a página recarrega (um valor posto no `window` no começo continua lá no fim).
  - `'a primeira página mostra a empresa e o ramal sem registro'`: com o computador em `erro` há 720 s, a linha da empresa do teste na tabela tem `1 sem registro`, e o cartão da lista tem a linha com o nome da empresa, o da pessoa, o ramal, `há 12 min` e `Erro no cadastro`. Ele diz `conectado`; uma rodada, a linha some da lista, e a da empresa passa a ter `1 online`.
  - `'o foco num botão de formulário segura a troca'`: com o foco no `Tirar do chat` da pessoa (pelo teclado, sem apertar), o estado muda na API; uma rodada, a página continua com o estado de antes e sem aviso; mais uma rodada, o aviso mostra o texto do foco. O foco sai (`blur`); uma rodada, o estado novo aparece e o aviso some.
  - `'o aviso quando a busca falha'`: com as buscas da página cortadas (`page.route`, com `abort`), uma rodada: o aviso aparece, com `Sem atualizar desde as` e a hora. Com as buscas de volta e o estado mudado, uma rodada: o estado novo aparece e o aviso some.
  - `'a sessão que venceu leva à entrada'`: com a página da empresa aberta, a sessão acaba (o `Sair`, mandado por fora da página, com o `csrf` e os cookies dela). Uma rodada: a página é a da entrada.
  - `'a empresa apagada'`: com a página da empresa aberta, a empresa é apagada por outra página do mesmo navegador. Uma rodada: a página mostra `Não encontrada`.
  - `'os botões continuam valendo depois de uma atualização'`: depois de duas rodadas com o estado mudando, o `Copiar o código` continua visível, e um clique no `Tirar do chat` da pessoa a tira: a página volta sem a linha dela.
  - `'nomes com sinais do HTML'`: a pessoa `<b>&"Zé"` fica sem registro; depois de uma rodada, a linha dela mostra o nome escrito assim, e a página não tem nenhum elemento `b` dentro da tabela.
  - `'sem o JavaScript'` (com `javaScriptEnabled: false`): as duas páginas mostram os estados e as contas certos; a frase `Esta página se atualiza sozinha a cada 30 segundos.` não está visível, e o resto da nota está; o aviso não está visível.

  E, no `estaticos_test.go`, o `TestEstatico_Atualizar`: o `GET /admin/estatico/atualizar.js` responde `200`, com `text/javascript`; o HTML das duas páginas pede o arquivo com `defer` e tem o aviso com `hidden`; o cabeçalho `Content-Security-Policy` continua `default-src 'self'; frame-ancestors 'none'`.

- [ ] **Step 3: Ver os testes falharem**

  Run, em `chat-servidor/pagina`, na fila da máquina: `npx playwright test admin.spec.ts`
  Expected: FAIL. O primeiro teste para em "depois de uma rodada": a página continua mostrando `Offline`. O `'sem o JavaScript'` passa já agora: é ele que guarda o que as tarefas 5 e 6 fizeram.

  Run, em `chat-servidor`: `go test ./internal/admin/ -run TestEstatico_Atualizar`
  Expected: FAIL com `404` no `atualizar.js`.

- [ ] **Step 4: Escrever o `atualizar.js` e pôr o `<script>` e o aviso nas duas páginas**

- [ ] **Step 5: Ver os testes passarem**

  Run, na fila da máquina: em `chat-servidor/pagina`, `npx playwright test` (a suíte inteira da pasta, com os testes da página da reunião), `npm run typecheck` e `node --test testes/*.test.mjs`; em `chat-servidor`, `go test -race ./...`, `go vet ./...` e `gofmt -l .`.
  Expected: tudo passa; o `gofmt` não lista nada.

- [ ] **Step 6: Commit e o GitHub**

  ```bash
  git add chat-servidor/internal/admin/estatico/atualizar.js chat-servidor/pagina/admin.ts chat-servidor/pagina/testes/admin.spec.ts
  git commit -m "feat(chat): as páginas dos ramais se atualizam sozinhas" -- chat-servidor/internal/admin chat-servidor/pagina
  git push origin reunioes-etapa-1
  ```
  O workflow `chat` desse commit fica verde nos dois jobs (`servidor` e `pagina`). Um job vermelho volta para esta tarefa.

---

### Task 8: O protocolo, o guia, o roteiro e a spec

**Files:**
- Modify: `docs/chat-protocolo.md` (as seções 2, 5 e 8)
- Modify: `docs/chat-servidor.md` (o passo 7, "Atualizar", e uma seção nova no fim)
- Modify: `docs/teste-manual.md` (uma seção nova e a tabela "Onde cada critério")
- Modify: `docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md` (o status)

- [ ] **Step 1: O protocolo**

  - **Seção 2:** a linha `409 semLigacao`: o computador não está com o canal dos eventos aberto; só no `PUT /api/v1/computadores/eu/ramal`.
  - **Seção 5,** depois de "Desligar o computador": a operação "Dizer o estado do ramal", com o corpo, o `204`, cada erro e a ordem deles, como na tarefa 3; a regra da troca de pessoa (o estado é da pessoa da vez; depois de trocar, o app manda de novo); a ordem do app (abrir o canal, e só então dizer o estado); e o que o app faz com um `404` (para de mandar até a próxima vez em que se ligar ao chat).
  - **Seção 8:** a linha "O estado do ramal, por computador: 30 por minuto, no `PUT /api/v1/computadores/eu/ramal`, além dos 600", e a frase correspondente em "Os pedidos por computador".

- [ ] **Step 2: O guia do chat**

  - **Passo 7:** um parágrafo para a versão que leva esta entrega (a `0.2.0-rc.5`): a administração passa a mostrar o estado dos ramais; não há nada para configurar; os apps de hoje aparecem como "No chat" ou "Offline", e o "Online" e o "Sem registro" chegam com a próxima versão do app do Windows, em cada PC que aceitar a atualização.
  - **Uma seção nova no fim** (a 13, para o número das outras não mudar), "Acompanhar os ramais dos clientes": onde olhar (a primeira página e a de cada empresa); os quatro estados, com as frases da legenda; o cartão "Sem registro agora"; que a página se atualiza a cada 30 s e que um PC sem rede leva até 2 minutos para aparecer offline; que o celular e os aparelhos de mesa não aparecem; que, depois de o chat reiniciar, todos aparecem offline por alguns segundos; que a sessão dura 12 horas, e a página volta para a entrada quando ela vence; e os dois avisos de "sem atualizar".

- [ ] **Step 3: O roteiro manual**

  Uma seção nova, a seguinte à última do arquivo, "O estado dos ramais (chat `0.2.0-rc.5`)", com as colunas das outras seções. Ela confere o que os apps de hoje já mostram:

  | Passo | Resultado esperado |
  |---|---|
  | Atualize o chat e abra a administração. | A primeira página tem a coluna `RAMAIS AGORA` e o cartão `SEM REGISTRO AGORA`, com `Nenhum ramal sem registro agora.` |
  | Com o app aberto num PC que está no chat, abra a página da empresa dele. | A pessoa aparece `No chat`, com `o app é antigo e não diz o ramal`. O computador dela tem a bolinha ciano. |
  | Feche o app nesse PC e espere 30 segundos, sem mexer na página. | A pessoa passa a `Offline`, com `última vez hoje,` e a hora. A página trocou sozinha. |
  | Abra o app de novo e espere 30 segundos. | A pessoa volta a `No chat`. |
  | Tire o cabo de rede do PC (ou desligue o Wi-Fi) e espere 2 minutos. | A pessoa passa a `Offline`. |
  | Num PC que duas pessoas usam, entre no app com a conta de uma e depois com a da outra. | O PC conta só para a pessoa que está nele agora. Na linha da outra, ele aparece com o anel cinza. |
  | Deixe a página aberta e clique no `Tirar do chat` de uma pessoa de teste. | A pessoa sai da lista, como antes. |

  As linhas do "Online" e do "Sem registro" entram com a entrega do app do Windows. Na tabela "Onde cada critério", uma linha para cada critério da seção 3 da spec que esta entrega cobre (o 1, o 2, o 5, o 6 e o 7), com o teste automático e a linha do roteiro.

- [ ] **Step 4: A spec**

  O status ganha a frase da entrega: o que ficou pronto, em qual versão do chat, e que a segunda entrega (o app do Windows) é a que traz o "Online" e o "Sem registro".

- [ ] **Step 5: Conferir e dar commit**

  Conferir: os comandos para o responsável ficam cada um num bloco, numa linha só e sem sublinhado; nenhum endereço ou nome de verdade; as tabelas do roteiro continuam com o mesmo número de colunas em todas as linhas; os números das seções do guia que outros textos citam não mudaram.

  ```bash
  git commit -m "docs: o estado dos ramais no protocolo, no guia e no roteiro" -- docs/chat-protocolo.md docs/chat-servidor.md docs/teste-manual.md docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md
  git push origin reunioes-etapa-1
  ```
  O workflow `chat` desse commit fica verde (ele roda também com mudança em `docs/chat-*.md`).

---

## Depois das oito tarefas

O responsável publica a versão do chat (a `0.2.0-rc.5`) pelo `chat-release`, atualiza a VM do chat com o comando do guia e roda a seção nova do roteiro. Com os apps de hoje, as páginas mostram "No chat" e "Offline". A segunda entrega, a do app do Windows, tem o plano dela.
