# As reuniões, etapa 2a — o aviso do link que deixou de valer, e dois acertos do leitor de tela — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o colega que perde o chat porque o link da reunião venceu com a reunião acontecendo vê um aviso que diz a verdade (ele continua na reunião, e não consegue voltar se sair); o leitor de tela ouve por que as respostas do colega desligaram; e dois avisos seguidos são lidos os dois.

**Architecture:** só a página da reunião (`chat-servidor/internal/pagina`). O cérebro (`estado.js`) passa a guardar que o motivo do "deixou de cuidar" é o link, e diz o aviso certo; o cartão e o painel "Participantes" mostram o texto do motivo; e a região que o leitor de tela anuncia (`pagina.js`) passa a guardar os avisos mais novos como trechos próprios. O servidor em Go, o canal e o protocolo das mensagens não mudam.

**Tech Stack:** o que a página já usa: JavaScript puro servido pelo chat, `node --test` para o cérebro, `@playwright/test` 1.56.1 para as telas. Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`, a nota de 25/11 do item 3 da seção 12.1 (aprovada pelo responsável em 25/11/2026, às 08:49), com as notas de 24/11 do mesmo item. O texto do aviso de sempre e as regras dele são os do plano `docs/superpowers/plans/2026-11-24-reunioes-etapa-2a-acertos-da-pagina.md`.

**Aprovado pelo responsável em 25/11/2026, às 08:49 ("segue"):** o texto do aviso e os dois acertos do leitor de tela. O método é o dos outros planos desta etapa: um agente novo constrói cada tarefa, e outro a revisa antes da próxima; no fim, uma revisão de tudo (superpowers:subagent-driven-development).

## Global Constraints

- **O texto aprovado, letra por letra:**
  - o título: `O link desta reunião deixou de valer`
  - o texto: `Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.`
  - o que o leitor de tela ouve e o que o painel "Participantes" mostra: o título, um ponto, um espaço e o texto: `O link desta reunião deixou de valer. Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.`
- **O aviso de sempre não muda:** `Você deixou de cuidar desta reunião` e `Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.` continuam valendo para o chat que reiniciou, para a chave de volta recusada e para a entrada de novo dentro do app que não dá certo.
- **A frase das respostas desligadas** é a que o painel já mostra: `Os pedidos voltam quando a conexão voltar.` Nenhum texto novo além do aviso aprovado.
- **Quem é de fora não vê nem ouve nada novo.**
- **Nada mais muda na tela:** o lugar do aviso (no lugar do cartão do pedido, e no painel no lugar das listas e do pé), as medidas, as cores e as regras de quando ele aparece e some são as de hoje.
- **Nada do nome das pessoas, do código, do passe ou da chave vai ao console.** Nenhum texto vira HTML: os textos entram como texto.
- **O servidor em Go, o protocolo do canal e os testes de ponta a ponta não mudam.**
- **Linhas com até 120 colunas** nos arquivos mexidos. Os assuntos dos commits em português, com até 72 caracteres.
- **Cada commit leva o nome do modelo que o escreveu,** nas duas linhas do fim: `Co-Authored-By: <o modelo> <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`. Commit por caminho (`git add <arquivos>`), nunca `git add -A`; nunca `git stash`; nunca `--amend` num commit enviado. Quem envia ao GitHub é quem conduz.

## Review Focus

1. **O aviso errado para o motivo:** o do link para o chat que reiniciou ou a chave recusada, ou o de sempre para o link. *(Task 1: "o link que deixou de valer, no religar do colega, mostra o aviso do link" e "os outros motivos continuam com o aviso de sempre".)*
2. **O aviso do link que volta a ser o de sempre** com a pessoa ainda na reunião, ou que sobra para a entrada seguinte. *(Task 1: "o aviso do link não volta a ser o de sempre" e "o aviso do link acaba onde o deixou de cuidar acaba".)*
3. **Quem é de fora** com o link vencido: nada novo. *(Task 1: o caso de quem é de fora, nos dois testes do cérebro.)*
4. **Um aviso perdido, repetido, ou uma região que cresce sem fim.** *(Task 2: "dois avisos no mesmo passo ficam os dois na região" e "a região guarda só os quatro avisos mais novos".)*
5. **A frase das respostas desligadas dita a cada desenho, sem nada à vista, ou junto com o aviso da queda.** *(Task 2: "sem o canal, o leitor de tela ouve por que as respostas desligaram, uma vez".)*

## A máquina de desenvolvimento

- Os comandos rodam a partir de `/home/claude/starsonic-reunioes`.
- **O cérebro:** `cd chat-servidor/pagina && npm test` (309 testes hoje) e `npm run typecheck`.
- **As telas:** `cd chat-servidor/pagina && npx playwright test` (255 testes hoje, uns 5 minutos), com `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw` e `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. Nunca rode `playwright install`. Um arquivo só: `npx playwright test testes/colega.spec.ts`.
- **O Go** (a página vai embutida no servidor): `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...`, com `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- **A fila da máquina.** Toda rodada do Playwright e do `go test` vai dentro da trava, com este comando, exatamente assim: `until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <o comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites`. Se o comando for negado, pare e conte no relatório; não tente de outro jeito.
- **Os testes de tela rodam com o relógio da página parado** (o `page.clock.install` e o `pauseAt` do `reuniao-falsa.ts`): um timer só anda com o `page.clock.runFor`.
- **O teste de ponta a ponta** (`video-servidor/e2e`, 57 testes, uns 17 minutos) é rodado por quem conduz, antes de cada envio ao GitHub.

---

### Task 1: O aviso do link que deixou de valer

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/colega.js` (os textos), `chat-servidor/internal/pagina/estatico/estado.js` (o motivo no estado), `chat-servidor/internal/pagina/estatico/pagina.js` (o cartão), `chat-servidor/internal/pagina/estatico/participantes.js` (o painel), `chat-servidor/internal/pagina/pagina.html` (só o comentário do aviso, se ele deixar de ser verdade)
- Test: `chat-servidor/pagina/testes/colega.test.mjs`, `chat-servidor/pagina/testes/estado.test.mjs`, `chat-servidor/pagina/testes/colega.spec.ts`, `chat-servidor/pagina/testes/participantes.spec.ts`
- Modify: `docs/chat-protocolo.md` (a seção 10: "O chat que reinicia" e "O aviso de quem deixou de cuidar"), `docs/chat-servidor.md` (o parágrafo "O colega na reunião quando o chat reinicia"), `docs/teste-manual.md` (uma linha nova, a 30.8)

**Interfaces:**
- Consumes: o `AVISO_SEM_CUIDAR` do `colega.js`; no `estado.js`, o `deixarDeCuidar(e)`, o `linkInvalidoDoVoltar(e)` e os três lugares que põem o `semCuidar` em falso (a saída da tela da reunião, o `voltou` e o `reentrar`); no `pagina.js`, o `desenharOColega(e)` e o `.sem-cuidar` do HTML; no `participantes.js`, o `.gente-sem-cuidar`. Os moldes dos testes: no `estado.test.mjs`, "a chave recusada e o link que deixou de valer, no religar do colega, são o deixou de cuidar", com o `LINK_DO_RELIGAR`, o `VOLTA_DA_LIGACAO`, o `REINICIOU` e o `RECUSADA_NO_RELIGAR`; no `colega.spec.ts`, "sem o canal o Aceitar desliga, e a chave recusada mostra o aviso de quem deixou de cuidar".
- Produces:

```js
// colega.js
/** O aviso do colega cujo link deixou de valer com a reunião acontecendo (o texto aprovado em 25/11/2026). */
export const TITULO_DO_LINK_VENCIDO = 'O link desta reunião deixou de valer';
export const TEXTO_DO_LINK_VENCIDO =
  'Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.';
/** O título, um ponto, um espaço e o texto: o que o leitor de tela ouve e o que o painel mostra. */
export const AVISO_DO_LINK_VENCIDO = `${TITULO_DO_LINK_VENCIDO}. ${TEXTO_DO_LINK_VENCIDO}`;

// estado.js: o estado ganha um campo, ao lado do semCuidar
linkVenceu: false, // o motivo do semCuidar é o link que deixou de valer: o aviso é o do link
```

As regras do cérebro:

- **O `linkInvalidoDoVoltar`** (a resposta `linkInvalido` do `voltar`, ou o `404` do abrir dele), para o colega com a ligação no ar: o `semCuidar` de hoje, com o `linkVenceu` verdadeiro, e o `dizer(AVISO_DO_LINK_VENCIDO)` no lugar do `dizer(AVISO_SEM_CUIDAR)`. Vale igual dentro do app (hoje esse caminho já não tenta a entrada de novo).
- **Os outros caminhos do `deixarDeCuidar`** (o chat que reiniciou, a chave recusada, a entrada de novo que falha) ficam com o `linkVenceu` falso e o aviso de sempre. **Menos quando o `semCuidar` já é o do link:** aí o `linkVenceu` continua verdadeiro, e o que é dito é o aviso do link (o link continua vencido).
- **O `linkVenceu` volta a falso em todo lugar em que o `semCuidar` volta a falso** (a saída da tela da reunião, o `voltou`, o `reentrar`).
- **Quem é de fora** continua como hoje: sem o `semCuidar`, sem o `linkVenceu`, sem aviso.

As regras da tela:

- **O cartão** (o `.sem-cuidar`, no lugar do cartão do pedido): com o `linkVenceu`, o título é o `TITULO_DO_LINK_VENCIDO` e o texto é o `TEXTO_DO_LINK_VENCIDO`; sem ele, os de sempre. O nome da região (`aria-labelledby`) acompanha o título. Os textos entram como texto, a partir do `colega.js`.
- **O painel "Participantes"** (o `.gente-sem-cuidar`): com o `linkVenceu`, o `AVISO_DO_LINK_VENCIDO`; sem ele, o `AVISO_SEM_CUIDAR`.
- Quando aparece, o que esconde e o que desliga: como hoje.

- [ ] **Step 1: Escreva os testes que falham**

`chat-servidor/pagina/testes/colega.test.mjs`:

```js
test('o aviso do link que deixou de valer é o texto aprovado', () => {
  assert.equal(TITULO_DO_LINK_VENCIDO, 'O link desta reunião deixou de valer');
  assert.equal(
    TEXTO_DO_LINK_VENCIDO,
    'Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.',
  );
  assert.equal(
    AVISO_DO_LINK_VENCIDO,
    'O link desta reunião deixou de valer. Você continua na reunião, mas não pode mais aceitar pedidos nem ' +
      'encerrar. Se sair, não consegue voltar.',
  );
});
```

`chat-servidor/pagina/testes/estado.test.mjs` (ao lado dos testes do `semCuidar`; o estado inicial esperado do arquivo ganha o `linkVenceu: false`):

```js
const LINK_VENCIDO =
  'O link desta reunião deixou de valer. Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. ' +
  'Se sair, não consegue voltar.';

test('o link que deixou de valer, no religar do colega, mostra o aviso do link', () => {
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  // A resposta linkInvalido do voltar.
  const r = rodar(colegaComLista(), ...voltando, mensagem({ tipo: 'linkInvalido' }));
  assert.deepEqual(r.efeitos, [FECHAR_CANAL, dizer(LINK_VENCIDO)]);
  assert.equal(r.estado.semCuidar, true);
  assert.equal(r.estado.linkVenceu, true);
  assert.deepEqual(r.estado.lista, { participantes: [], pedidos: [] });
  // O 404 do abrir do voltar é o mesmo link que deixou de valer.
  const semLink = rodar(colegaComLista(), canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 404));
  assert.deepEqual(semLink.efeitos, [dizer(LINK_VENCIDO)]);
  assert.equal(semLink.estado.linkVenceu, true);
  // Dentro do app é igual: a página não tenta a entrada de novo.
  const noApp = rodar(noAppComPartida(), canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 404));
  assert.deepEqual(noApp.efeitos, [dizer(LINK_VENCIDO)]);
  assert.equal(noApp.estado.linkVenceu, true);
  assert.equal(noApp.estado.reentrando, null);
  // Quem é de fora segue como hoje.
  const fora = rodar(naReuniaoComChave(), ...voltando, mensagem({ tipo: 'linkInvalido' }));
  assert.deepEqual(fora.efeitos, [FECHAR_CANAL]);
  assert.equal(fora.estado.semCuidar, false);
  assert.equal(fora.estado.linkVenceu, false);
});

test('os outros motivos continuam com o aviso de sempre', () => {
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  const recusada = rodar(colegaComLista(), ...voltando, RECUSADA_NO_RELIGAR);
  assert.deepEqual(recusada.efeitos, [FECHAR_CANAL, dizer(SEM_CUIDAR)]);
  assert.equal(recusada.estado.linkVenceu, false);
  const reiniciou = rodar(colegaComPartida(), ...REINICIOU);
  assert.deepEqual(reiniciou.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(reiniciou.estado.linkVenceu, false);
});

test('o aviso do link acaba onde o deixou de cuidar acaba', () => {
  const sem = rodar(colegaComLista(), ...LINK_DO_RELIGAR).estado;
  assert.equal(sem.linkVenceu, true);
  // O voltou da volta das duas.
  assert.equal(rodar(sem, ...VOLTA_DA_LIGACAO).estado.linkVenceu, false);
  // A saída da reunião.
  assert.equal(passo(sem, clique('sair')).estado.linkVenceu, false);
  // A ligação que cai: a volta das duas sai com a chave guardada, e o 404 do abrir dela é o fim.
  const fim = rodar(sem, SEM_CONEXAO, tempo('reconectar:2'), abrirFalhou(4, 404)).estado;
  assert.equal(fim.aviso, 'linkInvalido');
  assert.equal(fim.semCuidar, false);
  assert.equal(fim.linkVenceu, false);
});

test('o aviso do link não volta a ser o de sempre', () => {
  // Um deixarDeCuidar por outro motivo, com o do link já em vigor: o estado montado à mão, porque nenhuma sequência
  // de hoje chega aqui (o canal de quem deixou de cuidar não volta).
  const sem = rodar(colegaComLista(), ...LINK_DO_RELIGAR).estado;
  const r = passo({ ...sem, reentrando: 'entrando', canal: 'aberto' }, canalFechou(1006));
  assert.equal(r.estado.semCuidar, true);
  assert.equal(r.estado.linkVenceu, true);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'dizer'), [dizer(LINK_VENCIDO)]);
});
```

O último teste monta um estado à mão para chegar a um `deixarDeCuidar` de outro motivo. Se o `canalFechou` com esses campos não chegar lá no código de hoje, use outro evento que chegue (leia os chamadores do `deixarDeCuidar`) e diga qual no relatório; o que o teste prende é a regra, e não o caminho.

`chat-servidor/pagina/testes/colega.spec.ts` (ao lado de "sem o canal o Aceitar desliga, e a chave recusada mostra o aviso de quem deixou de cuidar", com os mesmos ajudantes):

```ts
test('o link que deixou de valer mostra o aviso do link, e não o de sempre', async ({ page }) => {
  // Como o teste da chave recusada, até o voltar sair pelo canal novo. A resposta dele é o linkInvalido:
  //   volta.mandar({ tipo: 'linkInvalido' });
  // No lugar do cartão: a região com o nome 'O link desta reunião deixou de valer', o título (um heading de nível 2)
  // e o texto 'Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue
  // voltar.' (exact). O leitor de tela ouve o título, um ponto, um espaço e o texto. O cartão do pedido some.
  // Nada do aviso de sempre está à vista: getByText('saia e abra a reunião de novo pelo app') tem 0.
});
```

`chat-servidor/pagina/testes/participantes.spec.ts` (ao lado do teste que mostra o aviso de sempre dentro do painel):

```ts
test('o painel mostra o aviso do link no lugar das listas', async ({ page }) => {
  // Com o painel aberto e o link que deixou de valer (como acima): o painel mostra o aviso inteiro do link (o
  // título, um ponto, um espaço e o texto), sem as listas e sem o Encerrar para todos; o cartão continua escondido
  // atrás do painel aberto.
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd chat-servidor/pagina && npm test`
Expected: FAIL nos testes novos (`TITULO_DO_LINK_VENCIDO` não existe; o `linkVenceu` é `undefined`; o que é dito é o aviso de sempre). Os testes de hoje que comparam o estado inteiro também falham até o campo novo entrar no estado inicial.

Run (dentro da trava): `cd chat-servidor/pagina && npx playwright test testes/colega.spec.ts testes/participantes.spec.ts`
Expected: FAIL nos dois testes novos (a região com o nome novo não existe).

- [ ] **Step 3: Implemente**

Os textos no `colega.js`; o campo e as regras no `estado.js` (o `deixarDeCuidar` recebe o motivo; o comentário do alto do arquivo, que hoje diz que o link que deixou de valer é "o mesmo" aviso, passa a dizer a verdade); o cartão no `pagina.js` e o painel no `participantes.js`. O teste "a chave recusada e o link que deixou de valer, no religar do colega, são o deixou de cuidar" do `estado.test.mjs` muda: o caso do link sai dele (os testes novos o cobrem), e o nome dele passa a falar só da chave recusada.

- [ ] **Step 4: Rode e veja passar**

Run: `cd chat-servidor/pagina && npm test && npm run typecheck`
Expected: PASS (os 309 de antes, com o que mudou, e os novos).

Run (dentro da trava): `cd chat-servidor/pagina && npx playwright test`
Expected: tudo passa (os 255 de antes e os dois novos).

Run (dentro da trava): `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...`
Expected: nada do `gofmt`, e os 18 pacotes passam.

- [ ] **Step 5: Os documentos**

- `docs/chat-protocolo.md`, seção 10: em "O chat que reinicia" e em "O aviso de quem deixou de cuidar", o link que deixou de valer passa a ter o aviso dele (o título e o texto aprovados, nos mesmos dois lugares), e o aviso de sempre fica para os outros motivos. Onde o texto de hoje diz que o link que deixou de valer mostra o mesmo aviso, acerte.
- `docs/chat-servidor.md`, o parágrafo "O colega na reunião quando o chat reinicia": uma frase para o link que vence com a reunião acontecendo (o servidor não encerra a reunião; o colega que perde o chat depois disso vê o aviso do link).
- `docs/teste-manual.md`, uma linha nova, a 30.8, no formato das outras da seção 30: a Ana Souza é colega numa reunião marcada com "O link vale até" poucos minutos adiante (pela linha 30.4, com o `valeAte` curto no pedido que cria a reunião); depois dessa hora, com a Ana ainda na reunião, reinicie o serviço do chat (`sudo systemctl restart starsonic-chat`). O esperado: a Ana continua vendo e ouvindo, e no lugar do cartão aparece "O link desta reunião deixou de valer", com o texto aprovado; se ela sair, o "Entrar de novo" diz que o link não vale mais. Confira os nomes das telas contra a página antes de escrever.

Run: `python3 build/check_source_text.py`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add chat-servidor/internal/pagina/estatico/colega.js chat-servidor/internal/pagina/estatico/estado.js chat-servidor/internal/pagina/estatico/pagina.js chat-servidor/internal/pagina/estatico/participantes.js chat-servidor/internal/pagina/pagina.html chat-servidor/pagina/testes/colega.test.mjs chat-servidor/pagina/testes/estado.test.mjs chat-servidor/pagina/testes/colega.spec.ts chat-servidor/pagina/testes/participantes.spec.ts docs/chat-protocolo.md docs/chat-servidor.md docs/teste-manual.md
git commit -m "feat(chat): o link que venceu tem o aviso dele na reunião"
```

(O `pagina.html` só entra no `git add` se tiver mudado.)

---

### Task 2: O leitor de tela ouve as respostas desligadas, e dois avisos não se atropelam

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/pagina.js` (o `dizer`, o `anunciar` e o `desenharOColega`)
- Test: `chat-servidor/pagina/testes/colega.spec.ts`, `chat-servidor/pagina/testes/participantes.spec.ts`, e o ajudante `anuncio` dos seis arquivos que leem a região (`colega.spec.ts`, `escolha.spec.ts`, `painel.spec.ts`, `participantes.spec.ts`, `pausa.spec.ts`, `qualidade.spec.ts`)
- Modify: `docs/chat-protocolo.md` (a seção 10, onde ela diz o que o leitor de tela ouve)

**Interfaces:**
- Consumes: no `pagina.js`, a região `[data-campo="anuncio"]` (um `<p role="status" aria-live="polite">`), o `dizer(oQue)`, o `anunciar(secao, e)` e a regra da frase do chat (o `semCanalDito`, com o `textoSemCanal` lido do HTML); o `podeResponder(e)` do `estado.js`; a frase `.gente-sem-canal` do HTML. O molde do teste que vigia a região: "o leitor de tela ouve cada mensagem dos outros, também a repetida" (`painel.spec.ts`), com o `MutationObserver`.
- Produces: nenhuma função nova para fora do `pagina.js`.

As regras da região:

- **Cada aviso entra como um trecho próprio** (um `<span>` com o texto, como texto), no fim da região. O que estava nela fica: o leitor de tela anuncia o que entra. O mesmo texto dito de novo entra de novo.
- **A região guarda os quatro avisos mais novos:** ao entrar o quinto, o mais velho sai. Sem timer: os testes de tela rodam com o relógio parado.
- **Tudo o que a página diz passa pelo `dizer`:** também a mudança de tela, o aviso da tela e a conexão caída, que hoje trocam o texto da região inteira (o `anunciar`). Um texto vazio não é dito.
- A região continua a mesma (`role="status"`, `aria-live="polite"`, sem o `aria-atomic`).

A regra da frase das respostas:

- **Com as respostas do colega desligadas** (o colega na tela da reunião, o `podeResponder(e)` falso, sem o `semCuidar`), **a conexão de pé** (o `reconectando` em zero) **e algo para responder à vista** (o painel "Participantes" aberto, ou um pedido esperando), o leitor de tela ouve "Os pedidos voltam quando a conexão voltar.", lida do `.gente-sem-canal` do HTML: uma vez a cada vez que isso começa, como a frase do chat da reunião.
- Com a conexão caída, quem fala é o aviso da queda; quem deixou de cuidar ouve o aviso dele; fora da tela da reunião, a regra recomeça.

- [ ] **Step 1: Escreva os testes que falham**

O ajudante `anuncio` dos seis arquivos passa a ler o aviso mais novo, e a região inteira ganha um nome à parte, onde um teste precisa dela (o `aria-live` do `painel.spec.ts`):

```ts
/** O aviso mais novo da região que os leitores de tela anunciam. */
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"] > :last-child');
```

`chat-servidor/pagina/testes/colega.spec.ts`:

```ts
test('dois avisos no mesmo passo ficam os dois na região', async ({ page }) => {
  // O colega na reunião, com um pedido da Maria Lima respondido (o Aceitar clicado). Num passo só da página (um
  // page.evaluate, ou dois canal.mandar seguidos, sem esperar entre eles): o feito do aceitar e a lista com um pedido
  // novo, da Bia Ramos. A região tem, nesta ordem, um trecho com 'O pedido de Maria Lima foi aceito' e outro com
  // 'Bia Ramos quer entrar' (os filhos da região, pelo texto de cada um), e nenhum dos dois some sozinho.
});

test('a região guarda só os quatro avisos mais novos', async ({ page }) => {
  // Seis pedidos chegam um por vez (seis listas, cada uma com um pedido novo a mais): a região tem quatro trechos, os
  // dos quatro últimos avisos, na ordem.
});

test('o mesmo aviso dito de novo entra de novo', async ({ page }) => {
  // Com o MutationObserver do molde: o mesmo aviso curto do servidor ('O servidor de reuniões não respondeu') duas
  // vezes seguidas dá dois trechos novos, com o mesmo texto.
});
```

`chat-servidor/pagina/testes/participantes.spec.ts` (no `describe` "sem o canal", com os ajudantes dele):

```ts
test('sem o canal, o leitor de tela ouve por que as respostas desligaram, uma vez', async ({ page }) => {
  // Com o MutationObserver do molde, o painel aberto e um pedido esperando. O canal cai (canal.fechar(1006)) e a
  // página tenta voltar: o aviso mais novo é 'Os pedidos voltam quando a conexão voltar.'. Outros desenhos (abrir e
  // fechar a pergunta do Tirar, uma mensagem do chat) não o repetem: ele entrou uma vez. O canal volta (o voltou) e
  // cai de novo: entrou duas vezes.
});

test('sem nada para responder à vista, a frase não é dita, e ao abrir o painel ela é', async ({ page }) => {
  // O colega na reunião, sem pedidos e com o painel fechado; o canal cai: nenhum trecho com a frase. O painel abre:
  // a frase é dita.
});

test('com a conexão caída, quem fala é o aviso da queda', async ({ page }) => {
  // O painel aberto; a ligação cai (o cartão 'A conexão caiu. Entrando de novo…'): a frase das respostas não é dita.
});
```

- [ ] **Step 2: Rode e veja falhar**

Run (dentro da trava): `cd chat-servidor/pagina && npx playwright test testes/colega.spec.ts testes/participantes.spec.ts`
Expected: FAIL nos testes novos (hoje a região tem um texto só, e a frase das respostas nunca é dita). Os testes de antes que leem a região também falham agora: hoje ela não tem filhos (o texto é dela), e o `> :last-child` não acha nada. Voltam a passar no Step 4.

- [ ] **Step 3: Implemente**

O `dizer` (o trecho novo e o limite de quatro), o `anunciar` pelo `dizer`, e a frase das respostas no `desenharOColega`, com uma marca própria ao lado do `semCanalDito`. O comentário do `dizer` diz a regra nova.

- [ ] **Step 4: Rode e veja passar**

Run: `cd chat-servidor/pagina && npm test && npm run typecheck`
Expected: PASS.

Run (dentro da trava): `cd chat-servidor/pagina && npx playwright test`
Expected: tudo passa. Um teste de antes que conferia a região de um jeito que a regra nova muda (um texto que hoje é apagado pelo aviso seguinte, por exemplo) é acertado para a regra nova, sem deixar de conferir o que conferia; diga no relatório quais mudaram e por quê.

Run (dentro da trava): `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...`
Expected: nada do `gofmt`, e os 18 pacotes passam.

- [ ] **Step 5: Os documentos e o commit**

No `docs/chat-protocolo.md`, seção 10, onde ela diz o que o leitor de tela ouve do colega: a frase das respostas desligadas (quando, e que é dita uma vez) e que dois avisos seguidos são lidos os dois. Confira cada frase contra o código.

```bash
python3 build/check_source_text.py
git add chat-servidor/internal/pagina/estatico/pagina.js chat-servidor/pagina/testes/colega.spec.ts chat-servidor/pagina/testes/escolha.spec.ts chat-servidor/pagina/testes/painel.spec.ts chat-servidor/pagina/testes/participantes.spec.ts chat-servidor/pagina/testes/pausa.spec.ts chat-servidor/pagina/testes/qualidade.spec.ts docs/chat-protocolo.md
git commit -m "feat(chat): os avisos falados da reunião não se atropelam"
```
