# As reuniões no app do PC, etapa 2a — entrega 1: o servidor do chat e a página — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a página da reunião reconhece um colega da empresa por um passe que o app pede ao chat, deixa-o entrar direto, aceitar, recusar, tirar e encerrar, pode ser mostrada dentro da janela do app, conversa com ele por mensagens e entra em pausa quando o app pede.

**Architecture:**
- **No servidor do chat,** uma guarda nova na memória (o `passes`, na camada da API) dá o passe, a chave do colega e o bilhete de colega. O gerente das reuniões ganha a entrada do colega pela página (o `EntrarPelaPagina`, pelo molde do que a reunião de teste já faz: o `aceito` na hora), a lista para as páginas de colega e o repasse da pausa. Nada novo vai ao banco nem aos registros.
- **Na página,** o cérebro (`estado.js`) continua uma função pura e ganha o colega, o modo do app e a pausa. Ao lado dele nascem o `colega.js` (as contas e os textos, puro), o `participantes.js` (a tela do painel) e o `app.js` (a conversa com a janela de cima, por `postMessage`).
- **O servidor de vídeo e o app não mudam nesta entrega.** O app `0.5.0` é a entrega 2, com o plano dela.

**Tech Stack:** o que o chat e a página já usam: Go (o `chat-servidor`), JavaScript em módulos, sem montagem (a página), `node --test` e o `@playwright/test` 1.56.1. Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md` (as seções 4.3, 4.4, 7.2 a 7.5, 7.8, 7.9, 10, 11 e 12). As telas são as 6 a 10 do quadro "Starsonic Phone — reuniões" e a tela 1 do quadro "Starsonic — reunião no navegador". O código delas está na pasta de trabalho, fora do git: `work/quadro-reunioes/` (as telas 6 a 10) e `work/quadro-pagina/Main.dc.html` (a tela "o app ou o navegador"). Os textos e as medidas que valem estão nas seções "Os textos" e "Os desenhos" deste plano.

**O método:** a escolher pelo responsável, na entrega do plano.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-2`, que já existe no GitHub. Cada tarefa dá commit, por caminho, e push.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **A versão** é a `0.2.0-rc.7` do chat. Os guias e o roteiro a chamam assim. Ninguém publica versão: quem publica é o responsável.
- **Os valores** (a seção 8 da spec, o protocolo e as escolhas deste plano):

  | O quê | Valor |
  |---|---|
  | O passe | 43 caracteres base64url (32 bytes); 120 s; uma vez; para uma reunião, uma pessoa e um computador |
  | Passes por computador | 10 por minuto; o 11º recebe `429 tentativas`, com `esperarSegundos` |
  | A chave do colega | 43 caracteres base64url; 12 horas; só na memória; até 50 por computador (a 51ª apaga a mais velha) |
  | O bilhete de colega | o bilhete de hoje (30 s, uma vez), preso ao colega |
  | O corpo do abrir | até 256 bytes |
  | O `vez` da pausa | de 1 a 32 letras ou números (`[A-Za-z0-9]`) |
  | As mensagens novas do canal | contam nas 20 por minuto do canal |
  | O cartão do pedido | 400 px de largura, no alto à direita dos quadros |
  | O painel "Participantes" | 360 px, no lugar do painel do chat, com a janela a partir de 900 px e o mouse; nos outros casos, cobre a tela |
  | O passe que o app não manda | a página espera 15 s depois do `pronta`; sem o passe, abre como quem é de fora |
  | As vezes de pausa desfeitas que a página lembra | as últimas 8 |

- **O texto nunca vira HTML.** O nome de uma pessoa entra na página pelo `textContent` ou por um nó de texto. Nenhum `innerHTML`.
- **A regra de segurança da página (a CSP) só muda no `frame-ancestors`.** Nenhum script nem estilo dentro da página, e nenhum `style="…"` no HTML. Todo teste de tela confere que não houve violação.
- **Nada disto vai aos registros nem ao console:** o passe, a chave do colega, o bilhete, o nome, o assunto e o código. Os testes de ponta a ponta anotam cada passe e cada chave como segredo (o `anotarSegredos`), e o ambiente confere os registros no fim.
- **Quem é de fora não muda:** sem um passe que valha, a página se comporta como hoje, tela por tela, menos pela tela "o app ou o navegador" no Windows.
- **Os textos das telas** são os da seção "Os textos", letra por letra.
- **O que não muda:** o `video-servidor/` (o agente e o FreeSWITCH), o `windows/`, o `android/`, o banco do chat, as rotas de hoje do app e os eventos da seção 11 do protocolo.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados de sempre (Ana Souza, Carlos Lima, Maria Lima, Bia Ramos, Roberto Alves, Júlia Martins, Pedro Nunes, `exemplo.com.br`).

## Review Focus

O que a spec pede e os testes das tarefas poderiam deixar passar, do mais provável ao menos. Cada linha tem o teste que a prende, na tarefa dona do código:

1. **Um passe que reconhece quem não devia:** o de uma reunião usado em outra, o de uma pessoa tirada da empresa, o de um computador desligado do chat, e o mesmo passe gasto por duas páginas na mesma hora. Só uma entra como colega. *(Task 1: `TestPasses_DoisAoMesmoTempo`. Task 3: `TestAbrirColega_DoisAoMesmoTempo`, `TestAbrirColega_PasseDeOutraReuniao`, `TestAbrirColega_PessoaTirada` e `TestAbrirColega_ComputadorDesligado`.)*
2. **O colega que cai e volta perde o que é de colega, ou alguém de fora o ganha:** depois do `voltar`, depois de o chat reiniciar e depois do "Entrar de novo". *(Task 5: `TestCanalDeColega_DepoisDoVoltar` e `TestCanalComum_DepoisDoVoltar`. Task 8: "o Entrar de novo do colega". Task 12: "o Entrar de novo com a chave vencida, dentro do app".)*
3. **A pausa que não desfaz, ou desfaz errado:** quem estava com o microfone desligado volta com ele ligado; a pausa chega com a página ainda entrando; chega um `retomar` sem `pausar`; a pessoa está na mesma reunião no app e no navegador. *(Task 13: "a volta devolve o que era", "pausa em cima de pausa", "o retomar sem pausa", "a pausa com a página entrando" e "dentro do app, a pausa do canal não vale".)*
4. **Uma mensagem de fora do app aceita como se fosse dele:** de outra origem, de outra janela, de um `iframe` dentro da própria página. *(Task 12: os casos do `app.test.mjs` e "uma mensagem de outra origem é ignorada".)*
5. **Quem é de fora vê uma mudança:** uma tela a mais, um botão a mais, um pedido de rede a mais, uma frase diferente. *(Tasks 9 e 10: "quem é de fora não vê nada disso". E os testes de hoje (os do Go, os 201 de unidade, os 204 de tela e os 41 de ponta a ponta) passam sem mudar de expectativa, menos a do `frame-ancestors`, na Task 7. Outra expectativa de hoje que precise mudar é um achado, e vai ao registro das decisões.)*

## A máquina de desenvolvimento

- O `go` pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`. O teste de ponta a ponta pede também `STARSONIC_FREESWITCH_DIR=/home/claude/starsonic-reunioes/work/fs-teste/corrigido`.
- Ela tem 2 processadores. O Playwright, o teste de ponta a ponta e o `go test -race` entram na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- **Os comandos das provas:**

  | A prova | O comando | Hoje |
  |---|---|---|
  | O Go | `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...` | 18 pacotes com testes |
  | A unidade da página | `cd chat-servidor/pagina && npm test` | 201 testes |
  | Os tipos | `cd chat-servidor/pagina && npm run typecheck` | sem erro |
  | As telas | `cd chat-servidor/pagina && npx playwright test` | 204 testes |
  | De ponta a ponta | `cd video-servidor/e2e && npx playwright test` | 41 testes, uns 13 minutos |

- Um comando que passa de 10 minutos roda em segundo plano. O `git push` nunca vai encadeado depois de um teste com `|`.
- **As tarefas 7 a 13 mexem na página:** antes do push de cada uma, o teste de ponta a ponta inteiro roda aqui.

## As escolhas deste plano

O que a spec deixa para quem constrói (a seção 16 dela) e este plano decide. O responsável as confere ao ler:

1. **A resposta do abrir de um colega leva também até quando o link vale** (`colega.valeAte`). A tela 10 aprovada diz "O link continua valendo até hoje, 23:59", e a página de hoje não sabe isso.
2. **Todo abrir que falha conta nas tentativas do endereço:** o `404` de hoje, o `401 passe` e o `400 invalido`.
3. **Um computador guarda até 50 chaves do colega** no servidor: a 51ª apaga a mais velha. É o teto da memória; uma pessoa usa uma por reunião aberta.
4. **Dentro do app, se o passe não chega em 15 s, ou se dois passes seguidos não valem,** a página mostra a entrada de quem é de fora, com a faixa "Não foi possível reconhecer você como colega…". É melhor que uma tela parada.
5. **A pausa pedida por mensagem** (a página dentro do app) **não mostra o cartão** "Você está numa ligação…": ali quem mostra a ligação é o app. O cartão é o da pausa que chega pelo chat, no navegador. E a página dentro do app ignora a pausa do chat: assim, a pessoa que está na mesma reunião no app e no navegador não recebe duas pausas diferentes na mesma página.
6. **A página fica sabendo a origem do app por um `meta`** no HTML que o servidor entrega (`<meta name="starsonic-app">`).
7. **A tela "o app ou o navegador" aparece em qualquer Windows,** pelo que o navegador diz de si. Não aparece no celular, no Mac nem no Linux.
8. **Os textos que nem o quadro nem a spec dizem:** o encerrar com uma pessoa só e com o link que não vale depois; e o que o leitor de tela ouve no resultado de cada resposta (a seção "Os textos").
9. **O `vez` da pausa** tem de 1 a 32 letras ou números, e o corpo do abrir, até 256 bytes.

## Os textos

**A entrada do colega (tela 6):** "Você entra como" · o nome · "É o seu nome no chat da empresa. Os colegas entram direto, sem esperar ser aceitos." · o botão "Entrar". O resto da entrada é o de hoje ("A sua imagem", "Microfone", "Câmera", "Você escolhe aqui se entra com a câmera e o microfone ligados.", "Nada é gravado.").

**Na reunião (telas 7 a 10):**
- o botão "Participantes"; para o leitor de tela, com pedidos: "Participantes, 1 pessoa quer entrar" e "Participantes, N pessoas querem entrar";
- o cartão: "<Nome> quer entrar" · "É de fora da empresa, e espera até um colega responder." · "Recusar" · "Aceitar";
- o cartão com dois pedidos ou mais: "<Nome> e mais N querem entrar" (o <Nome> é o do primeiro da lista, e o N, o número dos outros: com dois pedidos, "Maria Lima e mais 1 querem entrar") · o botão "Ver os pedidos", no lugar do "Recusar" e do "Aceitar";
- o painel: o título "Participantes" · "Fechar os participantes" (leitor de tela) · "ESPERANDO PARA ENTRAR · N" · "NA REUNIÃO · N" · as marcas "você", "de fora" e "compartilhando a tela" · o botão "Tirar" (leitor de tela: "Tirar <Nome> da reunião") · a pergunta "Tirar <Nome>?", com "Tirar" e "Voltar" · o botão "Encerrar para todos" · "Todos saem da reunião na hora.";
- sem ninguém esperando, a parte "ESPERANDO PARA ENTRAR" não aparece;
- o encerrar (tela 10): "Encerrar a reunião para todos?" · duas frases · "Voltar" · "Encerrar para todos". As frases:
  - a primeira: "As N pessoas saem agora."; com uma pessoa só na reunião, "Você sai agora.";
  - a segunda, na reunião marcada com o link ainda valendo: "O link continua valendo até <quando>: a reunião recomeça se um colega entrar de novo.", com o <quando> igual a "hoje, 23:59", "amanhã, 23:59" ou "26/11, 23:59";
  - a segunda, nos outros casos (a reunião `naHora`, ou a marcada com o `valeAte` já passado): "Depois disso, o link não vale mais.";
- o aceitar com a reunião cheia, no cartão e no painel: "A reunião está cheia: ninguém mais entra agora.";
- o leitor de tela ouve: "<Nome> quer entrar" quando um pedido chega; "O pedido de <Nome> foi aceito" e "O pedido de <Nome> foi recusado" depois de uma resposta daquela página que deu certo; "<Nome> saiu da reunião" depois de um tirar que deu certo.

**O passe que não vale** (uma faixa no alto da entrada de quem é de fora, ou da tela "o app ou o navegador"): "Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado."

**A pausa pedida pelo app, no navegador** (um cartão por cima da reunião): "Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você." · o botão "Voltar para a reunião".

**A tela "o app ou o navegador"** (a tela 1 do quadro da página): o cabeçalho "Reunião" · a linha "Reunião marcada" · o assunto · o dia e a hora · "Tem o Starsonic Phone neste computador?" · "Colegas da empresa entram direto pelo app, sem passar pela espera." · "Abrir no app" · "Se o app não abrir, entre pelo navegador." · "Vai entrar pelo navegador?" · "Para quem é de fora, ou para quem não tem o app aqui. Você digita o seu nome e espera um colega aceitar o pedido." · "Entrar pelo navegador" · "Funciona no navegador do PC e do celular, sem instalar nada." · "Nada é gravado. O seu nome só aparece para quem está na reunião."

## Os desenhos

As cores e as formas são as da página de hoje (`pagina.css`): os painéis `#111830` com a borda `#2c3757`, os botões da barra, o ciano `#00c2cb` com o texto `#03222a`, e o vermelho `#c23b3b`.

- **O botão "Participantes"** fica na barra dos controles, entre o "Chat" e o "Sair", com o desenho dos outros. Aberto, tem a borda ciano e o fundo `#0b3d47`, como o "Chat" aberto. O número de quem espera usa a `.contagem` de hoje.
- **O cartão do pedido:** 400 px de largura (ou a largura dos quadros menos 32 px, se menor), a 28 px do alto e a 40 px da direita da área dos quadros; fundo `#111830`, borda de 1 px `#00c2cb`, raio 14 px, 16 px por dentro; o título com 16 px e peso 800; o texto com 13 px, `#b9c4e6`; os dois botões lado a lado, com 44 px de altura: o "Recusar" com o fundo `#1c2540` e a borda `#2c3757`, o "Aceitar" ciano.
- **O painel "Participantes"** usa a moldura do painel do chat (o `.painel`): o alto com o título e o fechar, a lista no meio, o pé embaixo. Quem espera fica num cartão de fundo `#0a0e1a` com a borda ciano, o nome com 15 px e peso 700, e os botões com 40 px. Cada linha de quem está na reunião tem 46 px no mínimo, o nome com 14,5 px e peso 600, as marcas em pílulas de borda `#2c3757` e texto `#b9c4e6` de 11,5 px, e o "Tirar" com 34 px, borda `#2c3757` e fundo transparente. O pé tem o "Encerrar para todos" com 44 px, a borda de 1,5 px `#e06a6a`, o fundo transparente e o texto branco, e a frase embaixo com 12 px, `#9aa6c9`.
- **O encerrar:** um diálogo de 480 px no meio, sobre um véu `rgba(4, 6, 14, 0.74)`; fundo `#111830`, borda `#2c3757`, raio 16 px, 24 px por dentro; o título com 20 px e peso 800; os botões à direita, com 46 px: o "Voltar" como o "Recusar", o "Encerrar para todos" com o fundo `#c23b3b`.
- **A pausa:** o mesmo véu e um cartão como o do encerrar, com a frase e o botão ciano "Voltar para a reunião".
- **A entrada do colega:** no lugar do campo "Seu nome", um cartão branco com a borda `#e7eaf2` e o raio 14 px: um círculo de 46 px com as iniciais (o degradê `#00c2cb` → `#0c2671`, texto branco de 15 px e peso 800), "Você entra como" com 13 px, `#5b6478`, e o nome com 17 px e peso 800. A frase de ajuda embaixo, com 13,5 px. O botão "Entrar" tem o desenho do "Pedir para entrar" de hoje.
- **A tela "o app ou o navegador":** clara, como a entrada; dois cartões brancos lado a lado (um embaixo do outro na janela estreita), cada um com o título, a frase, o botão e a linha de ajuda. O "Abrir no app" é ciano; o "Entrar pelo navegador", branco com a borda `#cfd5e3` e o texto `#0c2671`.
- **Com a janela estreita ou o dedo** (a regra do painel do chat), o painel "Participantes" cobre a tela, com o "Voltar" do aparelho fechando, e o cartão do pedido ocupa a largura menos 24 px.

## Os arquivos

| Arquivo | O que é |
|---|---|
| `chat-servidor/internal/api/passes.go` (novo) | A guarda dos passes, das chaves do colega e dos bilhetes de colega, na memória |
| `chat-servidor/internal/api/reunioes.go`, `api.go` | As rotas `passe` e `pausa` do app |
| `chat-servidor/internal/api/pagina.go` | O abrir com o passe ou a chave; o canal de colega e as mensagens novas |
| `chat-servidor/internal/reunioes/colega.go` (novo) | O `EntrarPelaPagina`, a lista para as páginas de colega, o `ColegaDoPedido` e a `Pausa` |
| `chat-servidor/internal/reunioes/gerente.go`, `pedidos.go` | O `depois` e o `Voltar` mandam a lista às páginas de colega |
| `chat-servidor/internal/pagina/pagina.go`, `pagina.html` | O `frame-ancestors`, e a origem do app dita à página |
| `chat-servidor/internal/servidor/servidor.go` | As origens de teste chegam à página |
| `chat-servidor/internal/pagina/estatico/estado.js` | O cérebro: o colega, o app, a pausa, a escolha |
| `…/estatico/colega.js` (novo) | As contas e os textos do colega: puro |
| `…/estatico/participantes.js` (novo) | A tela do painel "Participantes" |
| `…/estatico/app.js` (novo) | A conversa com a janela de cima |
| `…/estatico/rede.js`, `midia.js`, `pagina.js`, `inicio.js`, `pagina.css` | O corpo do abrir; os aparelhos pelo nome e o som calado; as telas novas; o passe do endereço |
| `chat-servidor/pagina/` (`rede-falsa.ts`, `reuniao-falsa.ts`, `chat.ts`, `testes/`) | Os testes de unidade e de tela |
| `video-servidor/e2e/` (`servidores.ts`, `navegador.ts`, `estatico.mjs`, `cliente/app-falso.html`, `cliente/app-falso.js`, `colega.spec.ts`) | O teste de ponta a ponta |
| `docs/chat-protocolo.md`, `docs/chat-servidor.md`, `docs/teste-manual.md`, as specs de 12/11 e de 23/11 | Os documentos |

---

### Task 1: A guarda dos passes

**Files:**
- Create: `chat-servidor/internal/api/passes.go`
- Test: `chat-servidor/internal/api/passes_test.go`

**Interfaces:**
- Consumes: `tempo.Relogio`, `segredo.NovoToken()` (43 caracteres), `duracaoBilhete` (os 30 s do `eventos.go`) e o jeito do `bilhetes` (`internal/api/eventos.go`): guardar só o SHA-256, e varrer os vencidos a cada chamada.
- Produces:
  ```go
  const validadeDoPasse = 120 * time.Second
  const validadeDaChave = 12 * time.Hour
  const maxChavesPorComputador = 50

  // colegaDaPagina é quem um passe, uma chave ou um bilhete de colega reconhece.
  type colegaDaPagina struct{ reuniaoID, empresaID, pessoaID, computadorID int64 }

  func novosPasses(r tempo.Relogio) *passes
  func (p *passes) novoPasse(c colegaDaPagina) string
  // gastarPasse tira o passe da guarda e devolve o colega dele. Com outro reuniaoID, não devolve nem tira.
  func (p *passes) gastarPasse(passe string, reuniaoID int64) (colegaDaPagina, bool)
  func (p *passes) novaChave(c colegaDaPagina) string
  func (p *passes) conferirChave(chave string, reuniaoID int64) (colegaDaPagina, bool)
  func (p *passes) esquecerChave(chave string)
  func (p *passes) prenderBilhete(bilhete string, c colegaDaPagina)
  func (p *passes) colegaDoBilhete(bilhete string) (colegaDaPagina, bool)
  ```

- [ ] **Step 1: Escrever os testes que falham**

  Em `passes_test.go`, com o relógio dos testes do `bilhetes` (o `tempo.NovoTeste`, do `bilhetes_test.go`):

  | Teste | O que confere |
  |---|---|
  | `TestPasses_UmaVezSo` | o `gastarPasse` devolve o colega; o segundo `gastarPasse` do mesmo passe dá `ok` falso |
  | `TestPasses_DoisAoMesmoTempo` | 50 goroutines gastam o mesmo passe: uma só recebe `ok` verdadeiro (sob o `-race`) |
  | `TestPasses_Vence` | 119 s depois o passe vale; outro passe, 121 s depois, não |
  | `TestPasses_SoDaReuniaoDele` | o `gastarPasse` com outro `reuniaoID` dá `ok` falso, e o passe **continua valendo** para a reunião certa |
  | `TestPasses_ChaveVale12Horas` | a chave confere 11 h 59 min depois, e não confere 12 h 1 min depois; ela vale muitas vezes |
  | `TestPasses_ChaveSoDaReuniaoDela` | o `conferirChave` com outro `reuniaoID` dá falso |
  | `TestPasses_EsquecerChave` | depois do `esquecerChave`, ela não confere |
  | `TestPasses_AteCinquentaChaves` | a 51ª chave do mesmo computador apaga a primeira; as de outro computador ficam |
  | `TestPasses_BilheteDeColega` | o `colegaDoBilhete` devolve o colega uma vez; a segunda dá falso; 31 s depois do `prenderBilhete`, dá falso |
  | `TestPasses_NadaEmClaro` | depois de criar um passe e uma chave, nenhum campo da guarda tem o texto deles (os mapas, com o `fmt.Sprintf("%v")`) |
  | `TestPasses_TextoQualquer` | o `gastarPasse("")`, o de um texto de 10.000 caracteres, e o `conferirChave` de um passe (e o `gastarPasse` de uma chave) dão `ok` falso, sem pânico |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/api -run TestPasses_`
  Expected: FAIL (não compila: `novosPasses` não existe).

- [ ] **Step 3: Escrever o `passes.go`**

  Três mapas pelo SHA-256 (os passes, as chaves e os bilhetes de colega), um mutex, e a varredura dos vencidos no começo de cada chamada. A comparação é a do mapa pelo hash: nada compara o texto em claro.

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/api -run TestPasses_`
  Expected: PASS.

- [ ] **Step 5: Commit e push**

  `feat(chat): a guarda dos passes e das chaves do colega`, com `passes.go` e `passes_test.go`.

### Task 2: A rota do passe

**Files:**
- Modify: `chat-servidor/internal/api/reunioes.go` (a rota e o `passeDaReuniao`), `chat-servidor/internal/api/api.go` (os campos `passes` e `passesDoMinuto` do `servidor`)
- Test: `chat-servidor/internal/api/reunioes_passe_test.go` (novo)

**Interfaces:**
- Consumes: o `passes` da Task 1; o `entrarNaReuniao` de hoje, que é o molde (as mesmas conferências, na mesma ordem, até a pessoa da vez); o `limites.Nova`, o `Usar` da janela e o `erroEspera`.
- Produces: `POST /api/v1/reunioes/{codigo}/passe` → `200 {"passe": "<43>", "reuniao": <Reunião>}`, com `Cache-Control: no-store`. No `servidor`: `passes *passes` e `passesDoMinuto *limites.Janela` (10 por minuto, pela identidade do computador).

- [ ] **Step 1: Escrever os testes que falham** (com o `novaCenaR` dos testes das reuniões)

  | Teste | O que confere |
  |---|---|
  | `TestPasse_DaCerto` | `200`; o passe tem 43 caracteres do base64url; a `reuniao` é a que o `entrar` devolve; o `Cache-Control` é `no-store` |
  | `TestPasse_NaoComecaNada` | depois do passe, a reunião não está "acontecendo", o servidor de vídeo falso não emitiu senha, e nenhum evento foi a nenhum computador |
  | `TestPasse_OsErrosDoEntrar` | `404 naoEncontrado` (o código que não existe, a reunião vencida, a cancelada); `403 outraEmpresa` (a de outra empresa e a reunião de teste); `403 semReunioes`; `409 pessoa` sem a pessoa da vez; `401 chave` sem a chave do computador |
  | `TestPasse_ContaNasTentativas` | 20 passes pedidos com um código que não existe; o 21º, com um código bom, recebe `429 tentativas` |
  | `TestPasse_DezPorMinuto` | o 11º passe do mesmo computador no minuto recebe `429 tentativas`, com `esperarSegundos`; o de outro computador passa; um minuto depois, passa de novo |
  | `TestPasse_ComAReuniaoCheia` | com 10 pessoas na reunião, o passe ainda sai (`200`): quem diz `cheia` é o canal |
  | `TestPasse_NaoVaiAoLog` | o registro do servidor, depois de um passe, não tem o passe nem o código (pelo molde do `TestPagina_SemNomesNoLog`) |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/api -run TestPasse_`
  Expected: FAIL (as respostas são `404`: a rota não existe).

- [ ] **Step 3: Escrever a rota**

  `func (s *servidor) passeDaReuniao(w http.ResponseWriter, r *http.Request)`, registrada como o `entrar` (`s.autenticar(precisaPessoa(...))`). A ordem: a janela das tentativas (sem contar), o `semReunioes`, o código, a reunião, o `Vale`, a empresa, a pessoa da vez, a janela dos 10 por minuto, o passe. Os erros que o `entrar` conta nas tentativas contam aqui do mesmo jeito. O gerente não é chamado.

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/api -run 'TestPasse_|TestPasses_'`
  Expected: PASS.

- [ ] **Step 5: Commit e push**

  `feat(chat): a rota do passe do colega`.

### Task 3: O abrir da página com o passe ou com a chave

**Files:**
- Modify: `chat-servidor/internal/api/pagina.go` (o `abrirPagina`)
- Test: `chat-servidor/internal/api/pagina_colega_test.go` (novo)

**Interfaces:**
- Consumes: o `passes` (Task 1); a rota do passe (Task 2), para os testes; `s.banco.PessoaPorID(ctx, empresaID, pessoaID)` (que acha também quem saiu: o campo `Saiu`) e `s.banco.ComputadorAtivo(ctx, id)`.
- Produces:
  - o corpo opcional do abrir: `{"passe": "<43>"}` ou `{"colega": "<43>"}`;
  - a resposta com o colega: `{"reuniao": …, "bilhete": …, "colega": {"nome": "Júlia Martins", "chave": "<43>", "valeAte": 1795478399999}}`. A `chave` só vem na troca do passe. O `valeAte` é o da reunião, em milissegundos, ou `null` na `naHora`;
  - o erro `401 passe`;
  - o bilhete de um abrir que reconhece fica preso ao colega (`s.passes.prenderBilhete`).

- [ ] **Step 1: Escrever os testes que falham**

  | Teste | O que confere |
  |---|---|
  | `TestAbrirColega_SemCorpoComoHoje` | sem corpo, a resposta não tem o campo `colega`, e o resto é o de hoje |
  | `TestAbrirColega_ComOPasse` | `200`; `colega.nome` é o do cadastro; `colega.chave` tem 43 caracteres; `colega.valeAte` é o da reunião; o `bilhete` vem |
  | `TestAbrirColega_OPasseValeUmaVez` | o segundo abrir com o mesmo passe responde `401 passe`, sem bilhete |
  | `TestAbrirColega_DoisAoMesmoTempo` | dois abrir com o mesmo passe, em goroutines: um `200` e um `401 passe` (sob o `-race`) |
  | `TestAbrirColega_ComAChave` | `200`, com `colega.nome` e `colega.valeAte`, e **sem** `colega.chave`; vale várias vezes |
  | `TestAbrirColega_PasseDeOutraReuniao` | o passe da reunião A no abrir da B responde `401 passe`, e ainda vale na A |
  | `TestAbrirColega_PessoaTirada` | com a pessoa tirada da empresa depois do passe: o abrir com o passe e o abrir com a chave respondem `401 passe`, e a chave é esquecida |
  | `TestAbrirColega_ComputadorDesligado` | com o computador desligado do chat (o `DELETE /api/v1/computadores/eu`) depois da chave: `401 passe` |
  | `TestAbrirColega_ReuniaoCancelada` | com a reunião cancelada: `404 naoEncontrado`, como hoje (o `404` vem antes do passe) |
  | `TestAbrirColega_CorpoQueNaoVale` | os dois campos juntos, um campo a mais, o `{}`, um passe de 42 caracteres, um número no lugar do texto, um corpo de 300 bytes, um JSON quebrado: `400 invalido` |
  | `TestAbrirColega_AsFalhasContam` | 20 abrir com um passe inventado: o 21º abrir, sem corpo e com o código bom, recebe `429 tentativas`; o mesmo com 20 corpos que não valem |
  | `TestAbrirColega_ReuniaoDeTeste` | na reunião de teste, um corpo com um passe inventado responde `401 passe` |
  | `TestAbrirColega_NaoVaiAoLog` | o registro não tem o passe, a chave nem o nome |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/api -run TestAbrirColega_`
  Expected: FAIL (o corpo é ignorado: o `TestAbrirColega_ComOPasse` não acha o `colega`).

- [ ] **Step 3: Escrever**

  No `abrirPagina`, depois das conferências de hoje (as duas janelas, o código, a reunião, o `Vale`, a empresa) e antes do bilhete:
  - ler o corpo com o limite de 256 bytes. Com 0 bytes, segue como hoje. Qualquer outro corpo tem de ser um objeto JSON com exatamente um dos dois campos, um texto de 43 caracteres do base64url; senão, `400 invalido`, com o `campo` igual a `passe` ou `colega` quando é esse campo que está fora da regra, e a `corpo` nos outros casos;
  - com o passe, o `gastarPasse`; com a chave, o `conferirChave`;
  - nos dois: a pessoa existe na empresa do colega e não saiu, e o computador está ativo e é da mesma empresa;
  - qualquer falha destas é `401 passe`, e uma chave que veio é esquecida;
  - deu certo: na troca do passe, a `novaChave`; o bilhete novo fica preso ao colega;
  - o `400` e o `401` contam na janela das tentativas, como o `404`.

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/api -run 'TestAbrir|TestPagina'`
  Expected: PASS, com os testes de hoje do abrir.

- [ ] **Step 5: Commit e push**

  `feat(chat): a página abre a reunião com o passe ou com a chave do colega`.

### Task 4: O colega entra pela página

**Files:**
- Create: `chat-servidor/internal/reunioes/colega.go`
- Modify: `chat-servidor/internal/api/pagina.go` (o `canalDaPagina`, o `estadoDaPagina` e o `mensagemDaPagina`)
- Test: `chat-servidor/internal/reunioes/colega_test.go` (novo), `chat-servidor/internal/api/pagina_colega_test.go`

**Interfaces:**
- Consumes: `s.passes.colegaDoBilhete` (Task 1); no gerente, o que o `Pedir` faz na reunião de teste (o `aceito` na hora, com o `Pedido` já aceito e a chave de volta) e o que o `EntrarColega` confere.
- Produces:
  ```go
  // EntrarPelaPagina: o colega entra pela página. As conferências são as do EntrarColega, na mesma ordem
  // (ErrLinkInvalido, ErrSemServidor, ErrCheia, ErrServidorCheio); uma reunião parada começa. O participante nasce
  // com a pessoa, o computador, o nome do cadastro, o deFora falso e o papel de colega, preso a um Pedido já aceito,
  // com o canal c e a chave de volta. A página recebe o aceito e o palco, na mesma trava.
  func (g *Gerente) EntrarPelaPagina(ctx context.Context, r banco.Reuniao, p banco.Pessoa, computadorID int64, c Canal) (*Pedido, error)
  ```
  No canal: a mensagem `{"tipo": "entrar"}`, e o campo `colega *colegaDaPagina` do `estadoDaPagina`.

- [ ] **Step 1: Escrever os testes que falham**

  No gerente (`colega_test.go`, com o `novaCena`):

  | Teste | O que confere |
  |---|---|
  | `TestEntrarPelaPagina_Aceito` | o canal recebe o `aceito`, com o participante, a senha de colega (a carga dela diz o papel), o `turn`, o `video` e a `volta` de 43 caracteres |
  | `TestEntrarPelaPagina_ComecaAReuniao` | numa reunião parada com um pedido de fora em `naoComecou`, o `EntrarPelaPagina` e o `entrou` do vídeo levam o pedido a `aguardando`, como hoje faz o `EntrarColega` |
  | `TestEntrarPelaPagina_NaLista` | depois do `entrou`, o `Lista` mostra o participante com o nome do cadastro e o `deFora` falso |
  | `TestEntrarPelaPagina_OComputadorRecebeOsEventos` | um `Pedir` de fora, depois, manda o `reuniaoPedido` ao computador do passe |
  | `TestEntrarPelaPagina_AsRotasDoAppValem` | o `Aceitar(ctx, r, pessoaID, pedido)` com a pessoa do passe dá certo, sem `ErrForaDaReuniao` |
  | `TestEntrarPelaPagina_OsErros` | `ErrLinkInvalido`, `ErrSemServidor`, `ErrCheia` (com 10) e `ErrServidorCheio` (no limite), cada um sem deixar participante na memória |
  | `TestEntrarPelaPagina_Volta` | o `Voltar` com a chave do `aceito` dá certo, e o canal novo é o do participante |
  | `TestEntrarPelaPagina_SenhaETela` | o `NovaSenha` e o `TelaDeFora` valem para o pedido do colega; a senha nova continua de colega |
  | `TestEntrarPelaPagina_PalcoEChat` | a página do colega recebe o `palco` e o `mensagem`, e pode mandar o `mensagem`, pela regra de hoje |
  | `TestEntrarPelaPagina_Tirado` | um colega tirado por outro recebe o `tirado`, e o canal fecha |

  Na API (`pagina_colega_test.go`):

  | Teste | O que confere |
  |---|---|
  | `TestCanalDeColega_Entrar` | o abrir com o passe, o canal com o bilhete, o `{"tipo":"entrar"}` → `aceito` |
  | `TestCanalDeColega_PedirNaoVale` | no canal de colega, o `pedir` e o `desistir` respondem `erro` `invalido`, e o canal continua |
  | `TestCanalComum_EntrarNaoVale` | no canal de quem é de fora, o `entrar` responde `erro` `invalido` |
  | `TestCanalDeColega_EntrarUmaVez` | depois do `aceito`, outro `entrar` responde `erro` `invalido` |
  | `TestCanalDeColega_DoisMinutos` | sem o `entrar` no prazo do `pedir`, o canal fecha com 1000 (com o `AjustarPedirEspera`, como o `TestCanal_SemPedirFecha`) |
  | `TestCanalDeColega_Cheia` | com 10 pessoas, o `entrar` responde `cheia`, o canal continua, e um `entrar` depois de alguém sair dá o `aceito` |
  | `TestCanalDeColega_OutrasRespostas` | o `servidorCheio`, o `semServidor` e o `linkInvalido` no `entrar`, cada um com a regra que o `pedir` tem para ele (o canal continua, ou fecha), como no `TestCanal_SemServidorEOutrasRespostasQueMantemOCanal` |
  | `TestCanalDeColega_PessoaSumiu` | com a pessoa tirada da empresa entre o abrir e o `entrar`: `erro` `invalido`, e o canal fecha |
  | `TestCanalDeColega_BilheteComum` | o bilhete de um abrir sem passe abre um canal comum, mesmo logo depois de um abrir com passe |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/reunioes ./internal/api -run 'TestEntrarPelaPagina|TestCanalDeColega|TestCanalComum'`
  Expected: FAIL (não compila: `EntrarPelaPagina` não existe).

- [ ] **Step 3: Escrever o `EntrarPelaPagina`** em `colega.go`, pelo molde do `Pedir` na reunião de teste, com o participante do `EntrarColega`.

- [ ] **Step 4: Escrever o canal de colega** em `pagina.go`: o `canalDaPagina` pergunta ao `passes` pelo bilhete (o colega tem de ser da reunião do bilhete); o `mensagemDaPagina` ganha o `case "entrar"`, que lê a pessoa no banco, chama o `EntrarPelaPagina` e responde os erros pelo `erroDoGerente`, como o `pedir`; o `entrar` cumpre o prazo dos 2 minutos, como o `pedir`.

- [ ] **Step 5: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/reunioes ./internal/api`
  Expected: PASS, os dois pacotes inteiros.

- [ ] **Step 6: Commit e push**

  `feat(chat): o colega entra na reunião pela página, sem sala de espera`.

### Task 5: A lista e as respostas do colega, pelo canal

**Files:**
- Modify: `chat-servidor/internal/reunioes/colega.go`, `gerente.go` (o `depois`), `pedidos.go` (o `Voltar`), `chat-servidor/internal/api/pagina.go`
- Test: `chat-servidor/internal/reunioes/colega_test.go`, `chat-servidor/internal/api/pagina_colega_test.go`

**Interfaces:**
- Consumes: o `Aceitar`, o `Recusar`, o `Tirar` e o `Encerrar` de hoje, pela pessoa; o `EntrarPelaPagina` (Task 4).
- Produces:
  ```go
  // ColegaDoPedido diz se o pedido é o de um colega que entrou pela página, e quem ele é.
  func (g *Gerente) ColegaDoPedido(p *Pedido) (pessoaID int64, ok bool)
  ```
  No canal, do servidor: `{"tipo": "participantes", "participantes": [{"id","nome","deFora","tela","voce"}], "pedidos": [{"id","nome"}]}` e `{"tipo": "recusa", "de": …, "motivo": …}`. Da página: `aceitar` e `recusar` (com `pedido`), `tirar` (com `participante`) e `encerrar`.

- [ ] **Step 1: Escrever os testes que falham**

  No gerente:

  | Teste | O que confere |
  |---|---|
  | `TestListaDaPagina_AoEntrar` | quando a câmera do colega entra, a página dele recebe o `participantes`, com ele mesmo com o `voce` verdadeiro |
  | `TestListaDaPagina_ACadaMudanca` | um `Pedir`, um `Aceitar`, a entrada, a tela compartilhada e a saída de alguém mandam, cada um, um `participantes` novo; duas páginas de colega recebem o mesmo, cada uma com o seu `voce` |
  | `TestListaDaPagina_SoAColegaNaReuniao` | a página de quem é de fora nunca recebe; a do colega que ainda não entrou (só a senha) não recebe; a do colega que saiu deixa de receber |
  | `TestListaDaPagina_NoVoltou` | o `Voltar` de um colega na reunião manda o `participantes` logo depois do `voltou` |
  | `TestListaDaPagina_IgualNaoRepete` | um evento que não muda as duas listas não manda nada |
  | `TestListaDaPagina_NuncaNula` | sem pedidos, o campo `pedidos` é `[]`, e não `null` |
  | `TestColegaDoPedido` | verdadeiro para o pedido do `EntrarPelaPagina`, também depois do `Voltar`; falso para o pedido de fora aceito, para o da reunião de teste e para `nil` |

  Na API:

  | Teste | O que confere |
  |---|---|
  | `TestCanalDeColega_Aceitar` | a página do colega manda o `aceitar`; a de fora recebe o `aceito`; a do colega recebe o `participantes` sem o pedido; nenhuma `recusa` |
  | `TestCanalDeColega_Recusar` | a de fora recebe o `recusado` |
  | `TestCanalDeColega_Tirar` | o participante sai; a página dele recebe o `tirado` |
  | `TestCanalDeColega_Encerrar` | todas as páginas recebem o `encerrada` |
  | `TestCanalDeColega_PrimeiraResposta` | a página aceita e a rota do app recusa o mesmo pedido: vale a primeira; a segunda recebe o `recusa` com `jaRespondido` (na página) ou o `409 jaRespondido` (na rota) |
  | `TestCanalDeColega_Recusas` | `naoEncontrado` (um id inventado), `cheia` (o aceitar com 10 pessoas; o pedido continua), `foraDaReuniao` (o colega aceito que ainda não entrou) |
  | `TestCanalDeColega_CamposRuins` | sem o `pedido`, com um número, ou com um texto de 100 caracteres: `erro` `invalido` |
  | `TestCanalComum_RespostasNaoValem` | na página de quem é de fora, aceita, as quatro mensagens respondem `erro` `invalido` |
  | `TestCanalComum_DepoisDoVoltar` | o mesmo, no canal de quem é de fora que voltou pelo `voltar` |
  | `TestCanalDeColega_ContaNoLimite` | a 21ª mensagem do minuto recebe `erro` `limite` |
  | `TestCanalDeColega_DepoisDoVoltar` | o canal de um colega que voltou pelo `voltar`, aberto com um bilhete comum, aceita um pedido |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/reunioes ./internal/api -run 'TestListaDaPagina|TestColegaDoPedido|TestCanalDeColega|TestCanalComum'`
  Expected: FAIL.

- [ ] **Step 3: Escrever a lista no gerente:** o `depois`, quando a lista mudou, manda também o `participantes` a cada página de colega cujo participante está na reunião (a pessoa diferente de 0, o pedido com canal, o `naReuniao`); o `Voltar` manda ao canal que voltou. A mensagem sai pela fila do gerente (o `g.mandar`), como o palco.

- [ ] **Step 4: Escrever as quatro mensagens no canal:** valem quando o pedido do canal é o de um colega (o `ColegaDoPedido`). Os erros do gerente viram o `recusa`: `ErrJaRespondido` → `jaRespondido`; `ErrPedidoNaoEncontrado` e `ErrParticipanteNaoEncontrado` → `naoEncontrado`; `ErrCheia` → `cheia`; `ErrForaDaReuniao` → `foraDaReuniao`; qualquer outro → `servidorVideo`.

- [ ] **Step 5: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/reunioes ./internal/api`
  Expected: PASS.

- [ ] **Step 6: Commit e push**

  `feat(chat): o colega vê quem está na reunião e responde aos pedidos pela página`.

### Task 6: A pausa pelo chat

**Files:**
- Modify: `chat-servidor/internal/reunioes/colega.go`, `chat-servidor/internal/api/reunioes.go`
- Test: `chat-servidor/internal/reunioes/colega_test.go`, `chat-servidor/internal/api/reunioes_pausa_test.go` (novo)

**Interfaces:**
- Consumes: o `EntrarPelaPagina` (Task 4); o `liberada` e o `reuniaoDaEmpresa` das rotas "Com a pessoa na reunião".
- Produces:
  ```go
  // Pausa repassa a pausa às páginas de colega daquela pessoa e daquele computador naquela reunião: os participantes
  // que entraram pela página (com Pedido). Sem nenhum participante assim, ErrForaDaReuniao. Não guarda nada.
  func (g *Gerente) Pausa(r banco.Reuniao, pessoaID, computadorID int64, pausada bool, vez string) error
  ```
  A rota `POST /api/v1/reunioes/{codigo}/pausa`, com `{"pausada": true, "vez": "p1"}` → `204`. No canal: `{"tipo": "pausa", "pausada": true, "vez": "p1"}`.

- [ ] **Step 1: Escrever os testes que falham**

  No gerente:

  | Teste | O que confere |
  |---|---|
  | `TestPausa_ChegaAPagina` | a página do colega recebe o `pausa`, com o `pausada` e o `vez` |
  | `TestPausa_SoDaquelaPessoaEComputador` | a página de outro colega, a de quem é de fora e a do mesmo colega em outra reunião não recebem |
  | `TestPausa_ForaDaReuniao` | sem participante daquela pessoa e daquele computador: `ErrForaDaReuniao`; o participante que entrou pela rota `entrar` do app (sem página) não conta |
  | `TestPausa_SemCanal` | com o participante na reunião e o canal caído: `nil`, e nada é mandado |
  | `TestPausa_Entrando` | o colega que tem a senha e ainda não entrou recebe |
  | `TestPausa_NaoGuarda` | um canal que volta pelo `voltar` depois de uma pausa não recebe nada dela |

  Na API:

  | Teste | O que confere |
  |---|---|
  | `TestRotaDaPausa_DaCerto` | `204`, e o canal da página recebe o `pausa` |
  | `TestRotaDaPausa_ForaDaReuniao` | `409 foraDaReuniao` |
  | `TestRotaDaPausa_CamposRuins` | sem o `pausada`, com o `vez` vazio, com 33 caracteres ou com um hífen: `400 invalido` |
  | `TestRotaDaPausa_OutraEmpresa` | o código de outra empresa: `404 naoEncontrado` |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/reunioes ./internal/api -run 'TestPausa_|TestRotaDaPausa_'`
  Expected: FAIL.

- [ ] **Step 3: Escrever** a `Pausa` e a rota `pausarReuniao`, registrada com o `liberada`, como as outras de "Com a pessoa na reunião".

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...`
  Expected: PASS, os 18 pacotes; o `gofmt -l` sem saída.

- [ ] **Step 5: Commit e push**

  `feat(chat): o app põe em pausa a reunião aberta no navegador`.

### Task 7: A página pode aparecer dentro do app

**Files:**
- Modify: `chat-servidor/internal/pagina/pagina.go`, `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/servidor/servidor.go`, `chat-servidor/pagina/chat.ts`, `chat-servidor/pagina/testes/telas.spec.ts` (só a linha do `frame-ancestors`)
- Test: `chat-servidor/internal/pagina/pagina_test.go`, `chat-servidor/internal/servidor/servidor_test.go`

**Interfaces:**
- Produces:
  ```go
  // OrigemDoApp é a origem da interface do app do Windows.
  const OrigemDoApp = "https://app.starsonic.local"
  // Deps.OrigensDoApp: quem pode mostrar a página dentro de si. Vazio vale só a OrigemDoApp.
  ```
  - Na resposta de `/r/<código>`: `frame-ancestors https://app.starsonic.local`, mais as origens de teste, separadas por espaço.
  - No HTML servido: `<meta name="starsonic-app" content="https://app.starsonic.local">`, com as mesmas origens, separadas por espaço. A Task 12 lê esse `meta`.
  - O `servidor.go` passa a `OrigemDoApp` mais as origens do `--origem` (que só existe no modo de teste).
  - O chat dos testes de tela (`chat.ts`) passa a subir com `--origem http://127.0.0.1:4194`: é a origem da janela de cima de mentira da Task 12.

- [ ] **Step 1: Escrever os testes que falham**

  | Teste | O que confere |
  |---|---|
  | `TestCSP_FrameAncestorsDoApp` | o CSP tem `frame-ancestors https://app.starsonic.local` e não tem `frame-ancestors 'none'` |
  | `TestCSP_OrigensDeTeste` | com `OrigensDoApp` de duas origens, o CSP e o `meta` levam as duas, na ordem |
  | `TestCSP_OrigemQueNaoVale` | uma origem com espaço, com `;`, com caminho, com `*` ou sem esquema fica de fora do CSP e do `meta` (o molde é o `hostDoWSS`) |
  | `TestEsqueleto_MetaDoApp` | o HTML servido tem o `meta` com o conteúdo certo, e nenhum marcador por trocar |
  | `TestCSP_ORestoNaoMudou` | as outras diretivas são as de hoje, letra por letra |
  | `TestServidor_AsOrigensDeTesteNaPagina` (no `servidor_test.go`) | com uma origem de teste, a resposta de `/r/<código>` leva a do app e a de teste, nessa ordem; sem nenhuma, só a do app |

  Duas expectativas de hoje mudam, e só elas, nesta entrega: o fim do CSP no `pagina_test.go` (o `cspFim`, que passa a `frame-ancestors https://app.starsonic.local`) e o teste de tela "os cabeçalhos da página" (`telas.spec.ts`), que passa a esperar `frame-ancestors https://app.starsonic.local http://127.0.0.1:4194`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor && go test ./internal/pagina ./internal/servidor`
  Expected: FAIL.

- [ ] **Step 3: Escrever:** o `pagina.html` ganha o `meta` com um marcador, trocado uma vez no `Novo`; o `csp()` monta o `frame-ancestors`; o `servidor.go` passa as origens; o `chat.ts` ganha o `--origem`.

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor && go test -race ./internal/pagina ./internal/servidor && cd pagina && npx playwright test`
  Expected: PASS: os dois pacotes, e os 204 testes de tela.

- [ ] **Step 5: Commit e push**

  `feat(chat): a página da reunião pode ser mostrada dentro do app`.

### Task 8: O cérebro do colega

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/colega.js`
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`, `rede.js`, `pagina.js` (só o efeito `abrir`, que passa o `corpo` à rede)
- Test: `chat-servidor/pagina/testes/colega.test.mjs` (novo), `estado.test.mjs`, `rede.test.mjs`

**Interfaces:**
- Consumes: o protocolo das Tasks 3 a 5.
- Produces:
  - **`rede.js`:** o `abrir(abertura, corpo)`, com o `corpo` ausente, `{passe}` ou `{colega}`; o `abriu` leva o `colega` (`{nome, chave?, valeAte}`) só quando a resposta o traz; o `abrirFalhou` do `401` com o erro `passe` leva `passe: true`. Sem corpo e sem colega, os eventos são os de hoje, letra por letra.
  - **`colega.js`** (puro):
    ```js
    export const LISTA_VAZIA;                                 // {participantes: [], pedidos: []}
    export function lerLista(m);                              // a mensagem participantes → a lista, ou null se não vale
    export function iniciais(nome);                           // "Júlia Martins" → "JM"
    export function rotuloDoBotao(pedidos);                   // o nome do botão para o leitor de tela
    export function tituloDoCartao(pedidos);                  // "<Nome> quer entrar" | "<Nome> e mais N querem entrar"
    export function fraseDoEncerrar(n, tipo, valeAte, agora); // [a primeira frase, a segunda], pela seção "Os textos"
    export function ditoDaResposta(de, nome);                 // o que o leitor de tela ouve: de é aceitar, recusar ou tirar
    ```
  - **`estado.js`**, o estado: `colega` (`{nome, valeAte}` ou `null`), `chaveDoColega`, `passe`, `semColega` (o passe não valeu), `lista`, `gente` (o painel aberto), `tirando` (o id com a pergunta à vista), `encerrando`, `cheiaAoAceitar`.
  - **Os eventos:** o `comecar` leva o `passe` (ou `null`); os cliques `entrar`, `participantes`, `fecharParticipantes`, `verPedidos`, `aceitar` e `recusar` (com `id`), `tirar` e `tirarMesmo` (com `id`), `naoTirar`, `encerrar`, `encerrarMesmo` e `naoEncerrar`.
  - **Os efeitos:** o `abrir` leva o `corpo` só quando há um (sem ele, o efeito é o de hoje, letra por letra); o `mandar` leva as cinco mensagens novas; o `focar` ganha os alvos `participantes`, `cartao` e `encerrar`.

- [ ] **Step 1: Escrever os testes que falham**

  `colega.test.mjs`: uma tabela por função, com os textos da seção "Os textos" e estes casos:
  - as `iniciais`: o nome vazio ("?"), um nome só ("Ana" → "A"), três nomes (a primeira e a última: "Ana Maria Souza" → "AS");
  - o `rotuloDoBotao` e o `tituloDoCartao`: com 0, 1, 2 e 5 pedidos;
  - a `fraseDoEncerrar`, com as datas feitas no relógio local (`new Date(2026, 10, 23, 15, 0)`): 5 pessoas e 1 pessoa; a marcada com o `valeAte` hoje, amanhã, em 26/11 e em 05/12 às 18:30 ("05/12, 18:30"); a marcada com o `valeAte` já passado; a `naHora`; o `valeAte` que não é número (a segunda frase é a dos outros casos);
  - o `lerLista`: uma mensagem sem as listas (`null`), um item sem `id` (o item sai), 14 participantes (vale: quem limita é o servidor), um `nome` que não é texto (o item sai).

  `estado.test.mjs`, os casos novos:

  | Teste | O que confere |
  |---|---|
  | `o passe vai no primeiro abrir` | o `comecar` com o passe dá o efeito `abrir` com `{passe}` |
  | `o colega reconhecido vê a entrada dele` | o `abriu` com o `colega` guarda o nome, o `valeAte` e a chave, apaga o passe, e a tela é a `entrada` |
  | `o Entrar do colega abre de novo com a chave` | o clique `entrar` dá o `abrir` com `{colega: chave}`; o `abriu` seguinte abre o canal; o `canalAbriu` manda `{tipo: 'entrar'}`; a tela é a `entrando` |
  | `o colega nunca manda o pedir` | em nenhum caminho do colega sai o efeito `pedir` |
  | `o aceito do colega segue o de hoje` | depois do `aceito`, os efeitos são os do aceito de quem é de fora |
  | `cheia e servidor cheio no entrar` | os avisos de hoje; o `tentarDeNovo` manda o `entrar` de novo |
  | `o passe que não vale, no navegador` | o `abrirFalhou` com `passe` dá um `abrir` sem corpo, com o `semColega` verdadeiro, e a entrada é a de quem é de fora |
  | `a chave que deixou de valer, no navegador` | o `abrirFalhou` com `passe` no abrir do `entrar`: o `semColega`, e a entrada de quem é de fora |
  | `o voltar do colega abre sem corpo` | a volta depois de uma queda faz o `abrir` de hoje, sem corpo, e o `voltar` de hoje |
  | `a lista chega e o número aparece` | a mensagem `participantes` com 2 pedidos guarda a lista |
  | `o painel e o chat não ficam abertos juntos` | abrir um fecha o outro |
  | `aceitar e recusar` | os cliques mandam `{tipo, pedido}` |
  | `o Tirar pede o segundo clique` | o `tirar` só guarda o `tirando`; o `tirarMesmo` manda `{tipo: 'tirar', participante}`; o `naoTirar` desfaz; a lista nova sem aquela pessoa desfaz |
  | `o Encerrar pergunta` | o `encerrar` abre a pergunta; o `encerrarMesmo` manda `{tipo: 'encerrar'}`; o `naoEncerrar` fecha |
  | `a recusa cheia aparece, e a jaRespondido não` | o `recusa` com `cheia` liga o `cheiaAoAceitar`; com `jaRespondido`, nada muda |
  | `o resultado de cada resposta é dito` | depois de um `aceitar`, a lista nova sem aquele pedido põe no anúncio "O pedido de Maria Lima foi aceito"; o mesmo para o `recusar` e o `tirar`; com um `recusa` no meio, nada é dito |
  | `o pedido que chega é dito` | uma lista com um pedido que a anterior não tinha põe no anúncio "Maria Lima quer entrar" |
  | `quem é de fora ignora o que é do colega` | sem o `colega`, a mensagem `participantes` e os cliques novos não mudam nada |
  | `o Entrar de novo do colega` | depois do `saiu`, onde a página de quem é de fora faria um `pedir` novo, a do colega faz o `abrir` com a chave e o `entrar` |
  | `o estado nunca muda no lugar` | o teste de hoje, que congela o estado, passa com os eventos novos |

  `rede.test.mjs`: o `abrir` sem corpo não manda corpo nem `Content-Type`; com corpo, manda o JSON; o `401` com `{"erro": "passe"}` dá o `abrirFalhou` com `passe` verdadeiro; o `200` com o `colega` o repassa.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npm test`
  Expected: FAIL (o `colega.js` não existe).

- [ ] **Step 3: Escrever o `colega.js`,** e depois o `rede.js` e o `estado.js`.

- [ ] **Step 4: Rodar e ver passar**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS: os 201 de unidade de hoje mais os novos, e os 204 de tela.

- [ ] **Step 5: Commit e push**

  `feat(chat): o cérebro da página conhece o colega`.

### Task 9: A entrada do colega, o botão e o cartão do pedido

**Files:**
- Modify: `chat-servidor/internal/pagina/pagina.html`, `estatico/pagina.css`, `estatico/pagina.js`, `chat-servidor/pagina/rede-falsa.ts`, `reuniao-falsa.ts`
- Test: `chat-servidor/pagina/testes/colega.spec.ts` (novo)

**Interfaces:**
- Consumes: o estado e os cliques da Task 8; o `colega.js` (`iniciais`, `rotuloDoBotao`, `tituloDoCartao`).
- Produces:
  - no HTML, os botões com `data-botao` `entrar`, `participantes`, `aceitar`, `recusar` e `verPedidos`;
  - nos testes: o `rede-falsa.ts` responde o abrir com o `colega` (e o `401 passe`), e o `reuniao-falsa.ts` ganha o `entrarComoColega(page, rede)` e o `mandarLista(canal, lista)`, que as Tasks 10 a 13 usam.

- [ ] **Step 1: Escrever os testes que falham** (`colega.spec.ts`, sobre a reunião de mentira)

  | Teste | O que confere |
  |---|---|
  | `a entrada do colega` | "Você entra como", o nome, as iniciais, a frase e o botão "Entrar"; o campo "Seu nome" não existe; o resto é a entrada de hoje |
  | `o Entrar manda o entrar` | o canal falso recebe `{tipo: 'entrar'}`, e nenhum `pedir` |
  | `o botão Participantes` | está entre o "Chat" e o "Sair"; sem pedidos, sem número; com 2, mostra "2", e o nome para o leitor de tela é "Participantes, 2 pessoas querem entrar" |
  | `o cartão do pedido` | aparece com um pedido, no alto à direita, com 400 px; o "Aceitar" manda `{tipo: 'aceitar', pedido}`, e o "Recusar", `{tipo: 'recusar', pedido}`; o cartão some quando a lista nova não tem o pedido |
  | `o cartão com vários pedidos` | "Maria Lima e mais 2 querem entrar", com "Ver os pedidos", e sem "Aceitar" nem "Recusar" |
  | `a reunião cheia ao aceitar` | o `recusa` com `cheia` mostra a frase no cartão |
  | `o nome não vira HTML` | um pedido com `<img src=x onerror=alert(1)>` no nome aparece como texto, e a página não ganha um `img` |
  | `o teclado` | o Tab chega ao cartão na ordem da tela, e o Enter no "Aceitar" aceita |
  | `o leitor de tela` | a região viva diz "Maria Lima quer entrar" quando o pedido chega, e "O pedido de Maria Lima foi aceito" depois do aceitar |
  | `no celular` | 390×844: o cartão ocupa a largura menos 24 px |
  | `quem é de fora não vê nada disso` | sem o `colega`: nenhum botão "Participantes", nenhum cartão, mesmo com um `participantes` mandado pelo canal; a entrada tem o campo "Seu nome" |
  | `nenhuma violação da CSP` | em todos os testes do arquivo |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npx playwright test colega.spec.ts`
  Expected: FAIL.

- [ ] **Step 3: Escrever** o HTML, o CSS e a ligação no `pagina.js`, pelas medidas da seção "Os desenhos".

- [ ] **Step 4: Rodar tudo da página**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS: os de hoje e os novos.

- [ ] **Step 5: Commit e push**

  `feat(chat): a entrada do colega e o pedido de quem quer entrar, na página`.

### Task 10: O painel "Participantes" e o "Encerrar para todos"

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/participantes.js`
- Modify: `chat-servidor/internal/pagina/pagina.html`, `estatico/pagina.css`, `estatico/pagina.js`
- Test: `chat-servidor/pagina/testes/participantes.spec.ts` (novo)

**Interfaces:**
- Consumes: o estado e os cliques da Task 8; o `colega.js` (`fraseDoEncerrar`); o `entrarComoColega` e o `mandarLista` dos testes (Task 9); o jeito do `painel.js` (o painel ao lado ou cobrindo, o `data-modo`, o histórico do navegador no modo que cobre).
- Produces:
  ```js
  // participantes.js: a raiz é o <aside> do painel; o aoClique(tipo, id) leva ao cérebro o que a pessoa fez.
  export function criarParticipantes({ raiz, fundo, toque, aoClique }); // → { desenhar(estado), focar() }
  ```
  No HTML, os botões com `data-botao` `fecharParticipantes`, `encerrar`, `encerrarMesmo` e `naoEncerrar`; os de cada linha (`aceitar`, `recusar`, `tirar`, `tirarMesmo`, `naoTirar`) nascem no `participantes.js`, com o id no `data-id`.

- [ ] **Step 1: Escrever os testes que falham** (`participantes.spec.ts`)

  | Teste | O que confere |
  |---|---|
  | `o painel` | as duas partes, na ordem, com os números; "você" na própria pessoa, sem "Tirar"; "de fora" e "compartilhando a tela"; sem pedidos, a primeira parte não existe |
  | `o painel no lugar do chat` | abrir o painel fecha o chat, e vice-versa; os quadros se arrumam na largura que sobra |
  | `aceitar e recusar no painel` | cada botão manda a mensagem com o id da linha |
  | `o Ver os pedidos` | o botão do cartão abre o painel, com o foco na parte de quem espera |
  | `o Tirar em dois cliques` | o primeiro mostra "Tirar Pedro Nunes?"; o "Voltar" desfaz; o "Tirar" manda `{tipo: 'tirar', participante}` |
  | `o Encerrar para todos` | o diálogo com as frases de 5 pessoas e de 1; o "Voltar" fecha; o "Encerrar para todos" manda `{tipo: 'encerrar'}`; o Esc fecha; o foco fica preso no diálogo e volta ao botão |
  | `a reunião cheia ao aceitar` | o `recusa` com `cheia` mostra a frase no painel |
  | `o nome não vira HTML` | um participante com `<img src=x onerror=alert(1)>` no nome aparece como texto |
  | `no celular, o painel cobre a tela` | 390×844: o painel cobre, e o Voltar do aparelho fecha sem sair da página |
  | `o teclado` | o Tab passa pelo painel na ordem da tela; o Esc fecha o painel, e o foco volta ao botão "Participantes" |
  | `quem é de fora não vê nada disso` | sem o `colega`, o painel não existe para o leitor de tela nem para o Tab |
  | `nenhuma violação da CSP` | em todos os testes do arquivo |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npx playwright test participantes.spec.ts`
  Expected: FAIL.

- [ ] **Step 3: Escrever** o `participantes.js`, o HTML, o CSS e a ligação no `pagina.js`, pelas medidas da seção "Os desenhos".

- [ ] **Step 4: Rodar tudo da página**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS.

- [ ] **Step 5: Commit e push**

  `feat(chat): o painel dos participantes e o encerrar para todos, na página`.

### Task 11: O passe no endereço e a tela "o app ou o navegador"

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/inicio.js`, `estado.js`, `colega.js`, `pagina.js`, `pagina.html`, `pagina.css`
- Test: `chat-servidor/pagina/testes/colega.test.mjs`, `estado.test.mjs`, `chat-servidor/pagina/testes/escolha.spec.ts` (novo)

**Interfaces:**
- Consumes: o colega no cérebro (Task 8).
- Produces:
  ```js
  // colega.js
  export function passeDoEndereco(hash);  // "#p=<43 base64url>" → o passe; qualquer outra coisa → null
  export function ehWindows(navegador);   // {userAgent, userAgentData} → boolean
  ```
  - O `inicio.js` entrega ao `iniciar` o `servicos.passe` (o passe do endereço, ou `null`) e o `servicos.windows` (o `ehWindows` do navegador); o `comecar` os leva ao cérebro.
  - No estado: a tela `escolha`. O clique: `peloNavegador`. O "Abrir no app" é um link de verdade, com o `href` `starsonic://reuniao/<código>`, que o `pagina.js` preenche.

- [ ] **Step 1: Escrever os testes que falham**

  Unidade:
  - o `passeDoEndereco`: o `#p=` com 43 caracteres vale; com 42, com 44, com `=`, com `+`, com outro nome, com dois parâmetros e vazio, `null`;
  - o `ehWindows`: o Chrome, o Edge e o Firefox no Windows, sim; o Chrome no Android, o Safari no iPhone, o Chrome no macOS e no Linux, não.

  Cérebro:

  | Teste | O que confere |
  |---|---|
  | `a escolha no Windows` | o `abriu` de uma marcada, sem colega, no Windows: a tela é a `escolha`, e a mídia não é pedida |
  | `sem escolha` | na reunião de teste, fora do Windows e com o colega reconhecido: a tela é a `entrada` |
  | `Entrar pelo navegador` | o clique `peloNavegador` leva à `entrada` de quem é de fora, e a mídia é pedida só aí |
  | `os avisos passam na frente` | um `abrirFalhou` mostra o aviso, e não a escolha |
  | `a escolha não volta` | depois do `peloNavegador`, um abrir novo (o "Tentar de novo", a volta) não mostra a escolha de novo |

  Tela (`escolha.spec.ts`):

  | Teste | O que confere |
  |---|---|
  | `a tela no Windows` | os textos da seção "Os textos"; o "Abrir no app" é um link com o `href` `starsonic://reuniao/k7q49xwpht`; a câmera não foi pedida |
  | `Entrar pelo navegador` | leva à entrada de hoje, com o campo "Seu nome" |
  | `fora do Windows` | com o agente de um Android e de um Mac, a página abre direto na entrada |
  | `a reunião de teste não pergunta` | no Windows, a reunião de teste abre direto na entrada |
  | `o passe sai do endereço` | abrir `/r/<código>#p=<passe>`: o `location.hash` fica vazio antes do primeiro pedido de rede; o abrir leva `{passe}`; o histórico tem uma entrada só |
  | `o passe não vai ao console nem a outro pedido` | nenhum pedido além do abrir tem o passe na URL ou no corpo; o console não o tem |
  | `o passe que não vale` | o abrir com `401 passe`: a faixa "Não foi possível reconhecer você como colega…"; no Windows, na tela da escolha; fora dele, na entrada de quem é de fora |
  | `o teclado e o leitor de tela` | o título da tela é o primeiro foco; os dois botões têm nome; a ordem do Tab é a da tela |
  | `nenhuma violação da CSP` | em todos |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npm test; npx playwright test escolha.spec.ts`
  Expected: FAIL.

- [ ] **Step 3: Escrever.** O `inicio.js` lê o passe e tira-o do endereço com o `history.replaceState` (o caminho e a busca ficam) antes de qualquer pedido. A mídia só é pedida ao chegar à `entrada`.

- [ ] **Step 4: Rodar tudo da página**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS. Os testes de hoje abrem a página com o agente do Linux: nenhum deles cai na escolha.

- [ ] **Step 5: Commit e push**

  `feat(chat): o passe no endereço da página e a tela "o app ou o navegador"`.

### Task 12: A conversa com o app

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/app.js`
- Modify: `estado.js`, `pagina.js`, `inicio.js`, `midia.js`
- Test: `chat-servidor/pagina/testes/app.test.mjs` (novo), `estado.test.mjs`, `chat-servidor/pagina/testes/app.spec.ts` (novo)

**Interfaces:**
- Consumes: o `meta` `starsonic-app` e a origem de teste `http://127.0.0.1:4194` (Task 7); a tabela da seção 7.5 da spec.
- Produces:
  ```js
  // app.js
  export function origensDoApp(documento);                  // o conteúdo do meta, em lista; [] sem ele
  export function criarApp(aoEvento, { janela, origens });  // → { dentro, mandar(tipo, campos) }
  // estado.js
  export function paraOApp(estado);                         // {fase, microfone}, ou null enquanto a página carrega
  ```
  - O `dentro` é verdadeiro com a página dentro de outra janela e ao menos uma origem na lista.
  - O `criarApp` entrega ao cérebro o evento `{tipo: 'app', m}` só de uma mensagem que vem da janela de cima, com uma origem da lista, com `starsonic` igual a 1 e um `tipo` conhecido (`passe`, `aparelhos`, `pausar`, `retomar`, `bloqueio`, `sair`).
  - O `mandar` manda `{starsonic: 1, tipo, …campos}` à janela de cima, uma vez para cada origem da lista (o navegador só entrega à que é a de verdade).
  - Os `aparelhos` são `{"microfone": "<nome>", "altoFalante": "<nome>", "camera": "<nome>"}`: o nome de cada aparelho nas Configurações do app, com até 200 caracteres; vazio, ou sem o campo, é o padrão do sistema.
  - A `fase` do `paraOApp`: `naReuniao` na reunião; `fora` no "Você saiu da reunião" depois de uma queda; `entrada` em qualquer outra tela depois de carregar. O `microfone` é o que os outros ouvem: falso com o microfone desligado, e falso na pausa.
  - O `inicio.js` entrega ao `iniciar` o `servicos.app`; o `comecar` leva o `noApp`. No estado: `noApp` e `aparelhos`. O efeito novo: `avisarApp`, com `tipo` e os campos.

- [ ] **Step 1: Escrever os testes que falham**

  Unidade do `app.js`, com uma janela de mentira: ignora a mensagem de outra origem, de outra janela (um `iframe` da própria página), sem o `starsonic`, com um `tipo` desconhecido, com o `data` nulo ou texto; manda a cada origem; `dentro` falso na janela de cima e sem origens.

  Cérebro:

  | Teste | O que confere |
  |---|---|
  | `dentro do app, a página pede o passe` | o `comecar` com o `noApp` dá o `avisarApp` com `pronta`, e nenhum `abrir` |
  | `o passe do app começa tudo` | o `app` com `passe` dá o `abrir` com `{passe}` e guarda os `aparelhos` |
  | `sem o passe em 15 s` | o `tempo` do prazo leva ao `abrir` sem corpo, com o `semColega` |
  | `o passe que não valeu, dentro do app` | o `abrirFalhou` com `passe`: o `avisarApp` com `pronta` de novo; se o passe seguinte também não vale, o `abrir` sem corpo, com o `semColega` |
  | `o Entrar de novo com a chave vencida, dentro do app` | o `abrirFalhou` com `passe` no abrir do `entrar`: o `pronta`; com o passe novo, a página chega ao `entrar` do canal sem outro clique |
  | `o estado vai ao app quando muda` | o `paraOApp` devolve `entrada` na entrada e nos avisos de antes de entrar, `naReuniao` na reunião e `fora` no aviso `saiu` de uma queda; `null` carregando |
  | `o fim de cada jeito` | o "Sair" dá o `avisarApp` com `fim` e `saiu`; o `tirado`, `tirado`; o `encerrada`, `acabou`; o `linkInvalido` depois de entrar, `linkInvalido`; a queda, nenhum `fim` |
  | `o sair do app` | o `app` com `sair` faz o que o clique "Sair" faz, e responde o `fim` com `saiu`, também antes de entrar |
  | `os aparelhos trocados no meio` | o `app` com `aparelhos`, na reunião, dá os efeitos de trocar o microfone e a câmera de hoje, com os nomes novos |
  | `um campo que não vale` | o `passe` que não é um texto de 43 caracteres, e o `bloqueio` sem o `ligado`, não mudam nada |
  | `dentro do app não há escolha` | a tela é a `entrada`, também no Windows |
  | `fora do app, nada do app vale` | o evento `app` não muda nada |

  Tela (`app.spec.ts`): uma página de cima de mentira, entregue pela rota do teste na origem `http://127.0.0.1:4194`, com a página da reunião num `iframe` com o `allow` da spec (a câmera, o microfone, a captura de tela, a reprodução automática e a escolha do alto-falante, só para a origem do chat).

  | Teste | O que confere |
  |---|---|
  | `a página aparece dentro da janela de teste` | o `iframe` carrega, e a de cima recebe o `pronta` |
  | `outra origem não mostra a página` | de `http://127.0.0.1:4195`, o quadro não carrega a página: o navegador recusa pelo `frame-ancestors` |
  | `o passe por mensagem` | a de cima manda o `passe`; o abrir leva `{passe}`; a entrada do colega aparece; a câmera de mentira aparece na prévia, dentro do `iframe` |
  | `o estado e o fim` | a de cima recebe `estado` com `entrada`, depois `naReuniao`; o "Sair" manda o `fim` com `saiu` |
  | `o link do chat da reunião` | o clique num link manda `link` com a `url`, e nenhuma janela nova abre |
  | `os aparelhos pelo nome` | a página pede ao navegador o microfone e a câmera cujo nome é o mandado; com um nome que não existe, os do padrão |
  | `uma mensagem de outra origem é ignorada` | uma terceira janela manda o `passe`: nada acontece |
  | `nenhuma violação da CSP` | em todos |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npm test; npx playwright test app.spec.ts`
  Expected: FAIL.

- [ ] **Step 3: Escrever** o `app.js`, o cérebro, a ligação no `pagina.js` (o `estado` vai ao app quando o `paraOApp` muda; o clique num link do chat da reunião, dentro do app, não abre nada e manda o `link`) e os aparelhos no `midia.js` (o microfone e a câmera pelo `deviceId` do aparelho com aquele nome; o alto-falante pelo `setSinkId` do `#som`; sem achar, o padrão).

- [ ] **Step 4: Rodar tudo da página**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS.

- [ ] **Step 5: Commit e push**

  `feat(chat): a página da reunião conversa com o app que a mostra`.

### Task 13: A pausa na página

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`, `pagina.js`, `midia.js`, `pagina.html`, `pagina.css`
- Test: `chat-servidor/pagina/testes/estado.test.mjs`, `chat-servidor/pagina/testes/pausa.spec.ts` (novo)

**Interfaces:**
- Consumes: o `app` com `pausar`, `retomar` e `bloqueio` (Task 12); a mensagem `pausa` do canal (Task 6).
- Produces: no estado, `pausa` (`null` ou `{origem: 'app' | 'canal', vez, mic, cam}`), `pausaPendente` (a que chegou com a página entrando), `vezesDesfeitas` (as últimas 8) e `bloqueio` (`null` ou `{cam}`). O clique `voltarDaPausa`. O efeito `calar`, com `calado`. O botão `data-botao="voltarDaPausa"`.

- [ ] **Step 1: Escrever os testes que falham**

  Cérebro:

  | Teste | O que confere |
  |---|---|
  | `a pausa desliga tudo` | na reunião, o `pausar`: o microfone e a câmera desligados (os efeitos de hoje do clique), o aviso `camera` com `ligada` falso ao canal, o `calar` com `calado` verdadeiro, e a tela compartilhada parada |
  | `a volta devolve o que era` | com o microfone desligado e a câmera ligada antes: depois do `retomar`, o microfone desligado, a câmera ligada, o `calar` falso |
  | `a tela compartilhada não volta` | depois do `retomar`, o `telaCompartilhada` é `nenhuma` |
  | `a pausa pelo canal` | o `pausa` com `pausada` verdadeiro pausa, com a origem `canal`; com falso, volta |
  | `o Voltar para a reunião` | o clique `voltarDaPausa` volta e guarda a `vez`; o mesmo `pausa` de novo não pausa; um `pausa` com outra `vez` pausa |
  | `pausa em cima de pausa` | um segundo `pausar`, ou a repetição do `pausa`, não perde o que era antes do primeiro |
  | `o retomar sem pausa` | um `retomar`, ou um `pausa` com `pausada` falso, sem pausa nenhuma, não muda nada |
  | `a pausa com a página entrando` | um `pausar` (ou um `pausa`) na tela `entrando` fica guardado, e vale assim que a página entra: ela já entra com tudo desligado e o som calado; um `retomar` antes disso o apaga |
  | `dentro do app, a pausa do canal não vale` | com o `noApp`, o `pausa` do canal não muda nada |
  | `os botões na pausa` | os cliques `microfone`, `camera` e o compartilhar não fazem nada durante a pausa |
  | `fora da reunião, a pausa não faz nada` | na entrada e nos avisos |
  | `a pausa não segura a saída` | o `tirado`, o `encerrada` e o "Sair" valem na pausa, e a pausa some |
  | `o bloqueio` | o `bloqueio` ligado desliga só a câmera; desligado, devolve; junto com a pausa, a volta de um não desfaz o outro |
  | `quem é de fora` | o `pausa` do canal numa página sem colega não muda nada |

  Tela (`pausa.spec.ts`):

  | Teste | O que confere |
  |---|---|
  | `a pausa do canal mostra o cartão` | a frase e o "Voltar para a reunião"; o `#som` está calado; as faixas do microfone e da câmera, desligadas |
  | `o Voltar para a reunião` | o cartão some, o som volta, e a repetição da mesma `vez` não o traz de volta |
  | `a pausa do app` | pela janela de cima (o `pausar`): o som calado e as faixas desligadas, **sem** o cartão; o `retomar` devolve |
  | `o foco e o leitor de tela` | o foco vai ao botão do cartão e fica preso nele; a região viva diz a frase |
  | `nenhuma violação da CSP` | em todos |

- [ ] **Step 2: Rodar e ver falhar**

  Run: `cd chat-servidor/pagina && npm test; npx playwright test pausa.spec.ts`
  Expected: FAIL.

- [ ] **Step 3: Escrever.** A pausa usa os caminhos de hoje do microfone, da câmera e do parar de compartilhar; o novo é o `calar` (o `muted` do `#som`) e o cartão.

- [ ] **Step 4: Rodar tudo da página**

  Run: `cd chat-servidor/pagina && npm test && npm run typecheck && npx playwright test`
  Expected: PASS.

- [ ] **Step 5: Commit e push**

  `feat(chat): a reunião entra em pausa quando o app pede`.

### Task 14: De ponta a ponta

**Files:**
- Modify: `video-servidor/e2e/servidores.ts` (o `Computador` ganha o `passe` e a `pausa`), `video-servidor/e2e/navegador.ts` (a `Pagina` entra como colega, também dentro do app de mentira), `video-servidor/e2e/estatico.mjs` (serve os dois arquivos novos)
- Create: `video-servidor/e2e/cliente/app-falso.html` e `cliente/app-falso.js`, `video-servidor/e2e/colega.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 13. O chat do teste já sobe com `--origem` igual à `PAGINA` (`http://127.0.0.1:4192`): é ela a origem do app de mentira.
- Produces:
  ```ts
  // servidores.ts
  class Computador {
    passe(codigo: string): Promise<string>;                                  // anota o passe como segredo
    pausa(codigo: string, pausada: boolean, vez: string): Promise<number>;   // o status da resposta
  }
  // navegador.ts
  class Pagina {
    entrarComoColega(codigo: string, passe: string, opcoes?: { noApp?: boolean; cameraDesligada?: boolean }): Promise<void>;
    doApp(tipo: string, campos?: object): Promise<void>;        // o app de mentira manda uma mensagem à página
    esperarDoApp(tipo: string, prazo?: number): Promise<any>;   // a mensagem que o app de mentira recebeu
  }
  ```
  - Fora do app de mentira, a `Pagina` abre `CHAT/r/<código>#p=<passe>`. Dentro dele, abre `PAGINA/app-falso.html#<código>` (o código vai depois do `#`, que o servidor não recebe) e entrega o passe pelo `doApp`, depois do `pronta`.
  - Com o `noApp`, os métodos da `Pagina` que olham a tela passam a olhar o quadro da reunião (o `iframe`).
  - Toda chave do colega que os testes veem numa resposta também é anotada como segredo.

- [ ] **Step 1: Escrever os testes** (`colega.spec.ts`; uma reunião marcada criada pela Ana, pela rota do app)

  | Teste | O que confere |
  |---|---|
  | `o colega entra direto pelo passe` | a Ana abre a página com o passe, clica em "Entrar" e está na reunião sem espera; o quadro dela leva "Ana Souza"; o agente vê uma ligação de colega |
  | `quem é de fora pede, e o colega aceita pela página` | a Maria pede; o cartão aparece para a Ana em até 2 s; "Aceitar"; as duas se veem (as cores) e se ouvem (os tons) |
  | `o app também fica sabendo` | os eventos do app da Ana recebem o `reuniaoPedido` e o `reuniaoPedidoFim` daquele pedido |
  | `o aceitar pelo app vale para a página` | o `aceitar` pela rota do app da Ana: o cartão some da página dela |
  | `tirar e encerrar pela página` | o "Tirar" em dois cliques tira a Maria (a página dela mostra "Você foi tirado da reunião"); o "Encerrar para todos" acaba a reunião para as duas |
  | `a página dentro do app de mentira` | no `iframe`: o `pronta`, o passe por mensagem, a entrada, o "Entrar"; a imagem e o som chegam nos dois sentidos |
  | `a tela compartilhada de dentro do iframe` | o "Compartilhar a tela" sai, e a Maria vê a tela verde |
  | `a pausa do app` | o `pausar`: a Maria deixa de ouvir o tom da Ana e vê o quadro dela sem imagem; a página da Ana não toca o tom da Maria; o `retomar` devolve os três em até 2 s |
  | `a pausa pelo chat, no navegador` | a rota `pausa` da Ana: o mesmo, com o cartão à vista; o `pausada` falso devolve em até 3 s; numa pausa nova, o "Voltar para a reunião" devolve, e a mesma `vez` não pausa de novo; `409 foraDaReuniao` depois de a Ana sair |
  | `o colega de outra empresa não tem passe` | a rota responde `403 outraEmpresa` |
  | `os registros não têm segredo nem nome` | a conferência do fim do ambiente passa com os passes e as chaves anotados |

- [ ] **Step 2: Rodar o arquivo novo**

  Run: `cd video-servidor/e2e && npx playwright test colega.spec.ts`
  Expected: PASS. Uma falha aqui é um defeito das Tasks 1 a 13: achar a causa (superpowers:systematic-debugging) e corrigir na tarefa dona, com um teste dela que falhava.

- [ ] **Step 3: Rodar tudo de ponta a ponta**

  Run: `cd video-servidor/e2e && npx playwright test`
  Expected: PASS: os 41 de hoje e os novos.

- [ ] **Step 4: Commit e push**

  `test(video): o colega pela página, o app de mentira e a pausa, de ponta a ponta`. Depois do push, conferir no GitHub as rodadas do commit (o `chat`, o `video` e o `build`).

### Task 15: Os documentos

**Files:**
- Modify: `docs/chat-protocolo.md`, `docs/chat-servidor.md`, `docs/teste-manual.md`, `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`, `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`

- [ ] **Step 1: O protocolo.**
  - A seção 2 ganha o `401 passe`, e o `429 tentativas` passa a dizer também os passes demais de um computador.
  - A seção 9 ganha o passe (a rota, os erros, o limite) e a pausa.
  - A seção 10 ganha: o corpo do abrir, o `colega` da resposta (com o `valeAte`) e as falhas que contam; o canal de colega (as cinco mensagens da página e as três do servidor); a regra do `voltar` de um colega; quem recebe a lista. A primeira frase dela ("é sempre de fora") muda.
  - A seção 10 ganha também "A página dentro do app": o `frame-ancestors`, o `meta` e a tabela das mensagens entre a página e o app, com o formato dos `aparelhos`.
  - A seção 11 diz que o computador do passe conta como o que chamou o `entrar`.
  - A seção 12 ganha as linhas da tabela dos valores deste plano.
- [ ] **Step 2: O guia do servidor** (`docs/chat-servidor.md`, a seção 9): o que a `0.2.0-rc.7` traz, e que nada muda para quem usa enquanto o app `0.5.0` não chega; a atualização é a de sempre.
- [ ] **Step 3: O roteiro** (`docs/teste-manual.md`): a seção 30, curta, para depois de atualizar a VM do chat: a reunião de teste abre e funciona como antes, e, num Windows, o link de uma reunião de teste **não** mostra a tela "o app ou o navegador". O roteiro do colega vem com o app, na entrega 2.
- [ ] **Step 4: As specs.** A de 12/11 ganha uma nota datada: a etapa 2 foi redesenhada em 23/11 (o caminho, o corte em 2a e 2b, a ponte fora). A de 23/11 ganha, na 7.2, o `valeAte` do `colega`, e, no status, a entrega 1 construída.
- [ ] **Step 5: Conferir:** cada tabela com o mesmo número de colunas em todas as linhas; nenhum endereço ou nome de verdade; cada texto de tela citado nos documentos igual ao da seção "Os textos"; cada rota, mensagem e erro do protocolo igual ao que os testes exercitam.
- [ ] **Step 6: Commit e push**

  `docs: o passe, o canal do colega e a pausa no protocolo, no guia e no roteiro`.

---

## A revisão final

No fim das 15 tarefas, um revisor de fora, no modelo mais capaz e sem o contexto desta conversa, lê a spec, este plano e os commits da entrega, com a seção "Review Focus" na mão. As correções vão numa passada só, cada uma com um teste que falhava antes dela.

## Depois da entrega

- **O GitHub:** os workflows `chat`, `video` e `build` verdes no último commit.
- **Para o responsável:** nada a instalar ainda. A `0.2.0-rc.7` do chat pode esperar o app `0.5.0`, ou ser publicada antes: sem o app novo, ela não muda nada para quem usa.
- **O que vem:** o plano da entrega 2 (o app `0.5.0`), que começa pela prova no WebView2 de verdade.
