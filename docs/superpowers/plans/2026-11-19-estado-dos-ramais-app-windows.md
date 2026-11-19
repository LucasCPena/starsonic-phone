# O estado dos ramais na administração do chat: o app do Windows — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o app do Windows conta ao chat o estado do ramal da conta em uso, e com isso a página de administração passa a mostrar "Online" e "Sem registro".

**Architecture:**
- **Uma peça nova e pequena** (`windows/ui/src/chat/ramal.ts`) decide quando mandar e o que mandar: ela recebe a conta em uso com o estado dela, sabe quando o canal dos eventos do chat abriu, conta o tempo e cuida da espera e das tentativas. Ela não conhece a tela nem a ponte com o C++.
- **O cliente do chat** (`cliente.ts`) só liga as pontas: avisa a peça quando o canal abre e cai, e lhe passa a conta a cada mudança. O pedido é um método novo do `api.ts`.
- **Nada aparece para a pessoa:** nem tela, nem texto, nem aviso. O C++ e o Android não mudam.

Esta é a segunda das duas entregas da spec (seção 11). Ela precisa da primeira (o plano `2026-11-19-estado-dos-ramais-servidor.md`) já na branch: os testes daqui sobem o chat de verdade e leem o resultado na página de administração dele.

**Tech Stack:** o que a interface do Windows já usa: TypeScript 5.9.3, Preact 10.29.8, e os testes com o `@playwright/test` 1.56.1 contra o chat de teste (`tests/chat/`). Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md`: as seções 4.3 (o que o app faz), 7.1 (a operação), 7.3 (o app do Windows), 8 (os valores) e, na 10, os testes do app.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-1`, depois das oito tarefas do plano do servidor. Cada tarefa dá commit, por caminho, e push.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **A operação:** `PUT /api/v1/computadores/eu/ramal`, com `{"estado": …, "segundos": …}` (seção 5 do `docs/chat-protocolo.md`). O `estado` é `conectado`, `conectando`, `erro` ou `semConexao`. O `segundos` é um inteiro de 0 a 31.536.000.
- **Os valores:** uma mudança espera 2 s antes de ir, e só a última vai. As tentativas depois de uma falha usam as esperas que o chat do app já tem (`esperaDaVez` e `esperaDoLimite`, do `eventos.ts`).
- **O tempo** é contado pelo `performance.now()`, que não anda para trás, e nunca pelo relógio da parede.
- **Uma falha nunca aparece para a pessoa:** nenhum toast, nenhuma faixa, nada no console além do que o app já escreve.
- **O que não muda:** o `windows/host/` (o C++), a ponte (`bridge.ts`), o `android/`, o `chat-servidor/`, o diagnóstico do app e os textos das telas. Nenhuma tela ganha ou perde nada. O iPhone e o Android não têm o chat na interface, e continuam sem mandar nada.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados que os testes do chat já usam (ACME Comércio Ltda, Recepção, Ana Souza, Caixa 2).
- **Ninguém publica versão:** a versão do app é publicada pelo responsável.

## A máquina de desenvolvimento

- O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`, e o `go build` do chat de teste pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- Ela tem 2 processadores. O Playwright entra na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```

## Review Focus

1. **Duas contas com o mesmo ramal.** Trocar de uma para a outra não troca a pessoa no chat, e o canal dos eventos não abre de novo. Mesmo assim, o estado que vale é o da conta nova, e o tempo recomeça (tarefa 2, teste "a outra conta, com o mesmo ramal").
2. **Uma mudança com um pedido no ar.** O ramal muda enquanto o pedido anterior ainda não voltou. O valor novo vai depois, e os dois pedidos nunca andam juntos: senão o mais velho pode chegar por último e ficar valendo (tarefa 2, teste "um pedido de cada vez").
3. **O canal que abre no meio da espera de 2 s.** A abertura manda o valor de agora, e a espera que estava correndo não manda o mesmo valor de novo (tarefa 2, teste "a abertura no meio da espera").
4. **O chat antigo.** Com um chat que ainda não tem a operação, o app recebe `404`. Ele tenta uma vez a cada abertura do canal, e nada mais: nenhuma tentativa em laço, nenhum aviso (tarefa 3).
5. **O app sem o chat.** Com o chat desligado, sem a conta conectada ou fora do chat, nada é mandado, e nenhum pedido sai para o endereço do chat por causa do ramal (tarefa 1, teste "sem o chat, nada vai").

---

### Task 1: O estado vai a cada abertura do canal

**Files:**
- Create: `windows/ui/src/chat/ramal.ts`
- Modify: `windows/ui/src/chat/api.ts` (o método novo)
- Modify: `windows/ui/src/chat/cliente.ts` (o `atualizar`, o `ligarEventos` e o `parar`)
- Modify: `windows/ui/src/main.tsx` (o que o `atualizar` recebe, e as dependências do efeito)
- Modify: `windows/ui/tests/chat/servidor.ts` (ler o estado na página de administração)
- Test: `windows/ui/tests/chat/ramal.spec.ts`

**Interfaces:**
- Produces, no `api.ts`:
  ```ts
  export interface ApiChat {
    // …os de hoje
    /** O PUT /api/v1/computadores/eu/ramal. O 204 resolve; o resto rejeita com o ErroChat. */
    dizerRamal(estado: EstadoDoRamal, segundos: number): Promise<void>;
  }
  ```
- Produces, no `ramal.ts`:
  ```ts
  /** O estado do ramal como o protocolo o leva. */
  export type EstadoDoRamal = 'conectado' | 'conectando' | 'erro' | 'semConexao';

  /** `conectado`, `conectando` e `erro` vão como estão; `sem_conexao` vira `semConexao`. */
  export function estadoDoRamal(status: AccountStatus): EstadoDoRamal;

  export const ESPERA_DA_MUDANCA_MS = 2000;
  export const MAX_SEGUNDOS = 31_536_000;

  /** A conta em uso, para o estado do ramal. */
  export interface ContaDoRamal {
    id: string;
    ramal: string;
    estado: AccountStatus;
  }

  export interface AvisoDoRamal {
    /** A conta em uso, ou o estado dela, mudou (null: sem conta em uso). */
    conta(c: ContaDoRamal | null): void;
    /** O canal dos eventos abriu (a primeira vez e cada volta), como a pessoa do `ramal`. O `mandar` é o pedido dessa sessão. */
    canalAbriu(ramal: string, mandar: (estado: EstadoDoRamal, segundos: number) => Promise<void>): void;
    /** O canal caiu, ou a sessão do chat parou: nada vai até o próximo `canalAbriu`. */
    canalFechou(): void;
  }

  /** `agora` é um relógio em milissegundos que não anda para trás. */
  export function criarAvisoDoRamal(o: { agora(): number; aleatorio(): number }): AvisoDoRamal;
  ```
- O `ChatCliente.atualizar` passa a receber `conta: { id: string; ramal: string; nome: string; estado: AccountStatus } | null`.
- Produces, no `tests/chat/servidor.ts`:
  ```ts
  /** O estado de uma pessoa na página de administração do chat de teste: o nome do estado e a segunda linha. */
  export function estadoNaAdministracao(empresaId: number, nome: string): Promise<{ estado: string; detalhe: string }>;
  ```
  Ela lê a página da empresa com a sessão que o arquivo já guarda, acha a linha pelo nome e devolve o texto do `estado-nome` e o do `estado-detalhe`.

**As regras desta tarefa (spec, seções 4.3 e 7.3):**
- **O tempo:** a peça guarda o instante da última passagem entre "registrado" (`conectado`) e "sem registrar" (os outros três). Ele começa no instante em que a peça é criada (o app abriu). Muda quando o estado passa de um lado para o outro, e quando a conta em uso passa a ser outra (outro `id`, ou de nenhuma para alguma). Uma troca entre `conectando`, `erro` e `sem_conexao` não muda o instante.
- **Os segundos** são os do instante até agora, para baixo, entre 0 e `MAX_SEGUNDOS`, calculados na hora de mandar.
- **Na abertura do canal,** a peça manda o estado de agora, na hora, se a conta em uso tem o `ramal` da sessão.
- **Sem o canal aberto,** nada vai.
- **O `internet` da conta não entra:** sem internet, o app não alcança o chat, e a pessoa aparece offline (spec, seção 7.3).

- [ ] **Step 1: Escrever os testes**

  No `ramal.spec.ts`, com o que os testes do chat já têm (`novaEmpresa`, `ligarComputador`, `abrirNoChat`, `esperarOsEventos`, `mudarEstado`, `pararORelogio`). Os pedidos do ramal que a página faz são contados com o `page.on('request')` (o método `PUT` e o caminho `/api/v1/computadores/eu/ramal`), com o corpo de cada um guardado.

  - `'o estado do ramal vai quando o canal abre'`, uma vez para cada estado da conta:

    | O `status` da conta na ponte falsa | O corpo do pedido | A página de administração mostra |
    |---|---|---|
    | `conectado` | `{"estado":"conectado","segundos":0}` | `Online` |
    | `conectando` | `{"estado":"conectando","segundos":0}` | `No chat`, `registrando o ramal…` |
    | `erro` | `{"estado":"erro","segundos":0}` | `No chat`, `registrando o ramal…` |
    | `sem_conexao` | `{"estado":"semConexao","segundos":0}` | `No chat`, `registrando o ramal…` |

    Em cada uma, um pedido só, com a resposta `204`.
  - `'o tempo conta desde que o app abriu'`: com o relógio da página do Playwright parado, a página abre no cenário `chat-sem-conta`, com a conta em `erro`: o chat ainda não começa. O relógio anda 90 s, e a ponte falsa passa a dizer que a conta já conectou neste computador (o `contaConectada`). Quando o canal abre, o pedido leva `{"estado":"erro","segundos":90}`, e a página de administração mostra `Sem registro` e `o app diz “Erro no cadastro”`.
  - `'a cada volta do canal, o estado vai de novo'`: com o canal aberto e um pedido já feito, o mesmo computador abre outro canal por fora (a `ApiDeTeste`, que fecha o da página com 4000). Quando o canal da página volta, há um segundo pedido, com o mesmo estado.
  - `'sem o chat, nada vai'`: nos cenários `chat-desligado` e `chat-sem-conta`, e com um computador que foi tirado do chat (a página mostra a tela de fora do chat), a conta muda de estado três vezes: nenhum pedido do ramal sai.

- [ ] **Step 2: Ver os testes falharem**

  Run, em `windows/ui`, na fila da máquina: `npx playwright test tests/chat/ramal.spec.ts`
  Expected: FAIL. O primeiro teste espera um pedido do ramal e conta zero.

- [ ] **Step 3: Implementar**

  O `ramal.ts` com as regras acima; o `dizerRamal` no `api.ts`, pelo `pedir` de hoje; no `cliente.ts`, uma peça criada no construtor (com o `performance.now` e o `Math.random`), o `canalAbriu` no `conectou` do `ligarEventos` (com o `ramalDaVez` e o `api` da sessão), o `canalFechou` no `caiu` e no `parar`, e o `conta` no `atualizar`; no `main.tsx`, o `id` e o `status` da conta em uso entram no objeto e nas dependências do efeito.

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `npx playwright test tests/chat/` e `npm run typecheck`
  Expected: PASS, com os testes do chat de antes.

- [ ] **Step 5: Commit**

  ```bash
  git add windows/ui/src/chat/ramal.ts windows/ui/tests/chat/ramal.spec.ts
  git commit -m "feat(windows): o app diz ao chat o estado do ramal quando o canal abre" -- windows/ui
  git push origin reunioes-etapa-1
  ```

---

### Task 2: As mudanças, com a espera de 2 s

**Files:**
- Modify: `windows/ui/src/chat/ramal.ts`
- Test: `windows/ui/tests/chat/ramal.spec.ts`

**As regras desta tarefa:**
- **Uma mudança** do estado (do valor do protocolo) ou da conta em uso, com o canal aberto, começa uma espera de 2 s. Outra mudança dentro dela recomeça a espera. No fim, vai o valor daquela hora.
- **Só o que mudou vai:** se o valor do fim da espera é o último que o chat confirmou nesta abertura do canal, para a mesma conta, nenhum pedido sai.
- **Um pedido de cada vez.** Enquanto um está no ar, o próximo espera a resposta dele. Quando ela chega, se o valor de agora é outro, ele vai.
- **A abertura do canal** cancela a espera que estiver correndo: ela já manda o valor de agora.

- [ ] **Step 1: Escrever os testes**

  Com o relógio da página do Playwright parado depois de o canal abrir (`pararORelogio`), e andando só pelo `page.clock.runFor`:

  - `'uma mudança espera 2 segundos'`: a conta passa de `conectado` a `erro`. Com 1,9 s, nenhum pedido novo. Com 2 s, um pedido, com `erro`.
  - `'o ramal que pisca manda só o último valor'`: em 1 s, a conta passa por `conectando`, `erro`, `conectando`, `sem_conexao` e `erro`. Depois de 2 s da última mudança, um pedido só, com `erro`.
  - `'o que volta ao valor de antes não manda nada'`: de `conectado` a `conectando` e de volta a `conectado`, em 1 s. Depois de 5 s, nenhum pedido novo.
  - `'o tempo não zera entre o Conectando e o Erro no cadastro'`: a conta fica em `conectando`; o relógio anda 75 s; ela passa a `erro`. O pedido da mudança leva `{"estado":"erro","segundos":77}` (os 75 s e os 2 s da espera), e a página de administração mostra `Sem registro` e `o app diz “Erro no cadastro”`.
  - `'o tempo zera quando o ramal registra, e quando ele cai'`: com a conta em `conectando` há 75 s, como no teste acima, ela passa a `conectado`: o pedido leva `segundos` 2 (os da espera), e a página de administração mostra `Online`. O relógio anda 30 s e a conta passa a `conectando`: o pedido leva `segundos` 2.
  - `'a outra conta, com o mesmo ramal'`: no cenário `chat-duas-contas`, com a segunda conta posta com o mesmo ramal da primeira e o estado `erro`, a conta em uso troca. O canal dos eventos não abre de novo, e um pedido sai, com `erro` e `segundos` 2.
  - `'a troca para a conta de outro ramal'`: no `chat-duas-contas`, a conta em uso passa a ser a Caixa 2 (2015), em `conectando`. O chat entra como a pessoa nova, o canal abre de novo, e o pedido leva `conectando`. A página de administração mostra a Caixa 2 em `No chat`, e a Recepção em `Offline`.
  - `'um pedido de cada vez'`: a rota do ramal segura a primeira resposta. A conta muda duas vezes, com 3 s entre uma e outra. Enquanto a primeira resposta não vem, a rota recebeu um pedido só. Solta a resposta: o segundo pedido sai, com o valor de agora.
  - `'a abertura no meio da espera'`: a conta muda, e 1 s depois o canal cai e volta (como no teste da tarefa 1). O pedido da abertura leva o valor novo, e depois de mais 5 s não há outro pedido.

- [ ] **Step 2: Ver os testes falharem**

  Run: `npx playwright test tests/chat/ramal.spec.ts`
  Expected: FAIL nos testes novos: a mudança não manda pedido nenhum.

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Ver os testes passarem**

  Run, na fila da máquina: `npx playwright test tests/chat/` e `npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git commit -m "feat(windows): as mudanças do ramal vão ao chat, uma de cada vez e sem piscar" -- windows/ui
  git push origin reunioes-etapa-1
  ```

---

### Task 3: As falhas

**Files:**
- Modify: `windows/ui/src/chat/ramal.ts`
- Test: `windows/ui/tests/chat/ramal.spec.ts`

**As regras desta tarefa (spec, seções 7.1 e 7.3):**

| A resposta | O que a peça faz |
|---|---|
| `204` | Guarda o valor como confirmado. |
| `404` | O chat é antigo: para de mandar até o próximo `canalAbriu`. |
| `401`, `400` e `409 pessoa` | Para de mandar até o próximo `canalAbriu`. O `401` já tira o computador do chat por outro caminho. |
| `429` | Espera o `esperaDoLimite` e tenta de novo, com o valor e os segundos daquela hora. |
| `409 semLigacao`, um `5xx`, sem rede ou sem resposta no prazo | Espera o `esperaDaVez` da tentativa (a primeira, de 0,5 a 1,5 s) e tenta de novo, com o valor e os segundos daquela hora. A tentativa volta a zero num `204` e num `canalAbriu`. |

Uma falha não mostra nada na tela.

- [ ] **Step 1: Escrever os testes**

  As respostas são postas pelo `page.route` da rota do ramal.

  - `'o chat antigo: um 404 faz parar'`: a rota responde `404` com `{"erro":"naoEncontrado"}`. Um pedido sai na abertura do canal. A conta muda de estado três vezes, com 5 s entre uma e outra: nenhum pedido novo. O canal cai e volta: um pedido novo, e só um.
  - `'uma falha tenta de novo'`, uma vez para cada resposta: `500`; `409` com `{"erro":"semLigacao"}`; a rota que corta a conexão. A rota falha nas duas primeiras vezes e depois deixa passar. Com o relógio andando 1,5 s, sai a segunda tentativa; com mais 3 s, a terceira, que passa. Depois de mais 60 s, nenhum pedido novo. A página de administração mostra o estado.
  - `'o limite espera o que o chat pede'`: a rota responde `429` com `{"erro":"limite","esperarSegundos":7}` uma vez. Com 6,9 s, nenhum pedido novo; com 7 s, a segunda tentativa.
  - `'a tentativa leva o valor de agora'`: a rota falha uma vez com `500`. Antes da segunda tentativa, a conta passa de `erro` a `conectado`. A segunda tentativa leva `conectado`.
  - `'nada aparece para a pessoa'`: em cada um dos testes acima, no fim, a tela não tem toast nem faixa (`getByRole('status')` e `getByRole('alert')` sem texto novo), e o console da página não ganhou erro.

- [ ] **Step 2: Ver os testes falharem**

  Run: `npx playwright test tests/chat/ramal.spec.ts`
  Expected: FAIL: depois do `500`, nenhuma segunda tentativa sai.

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Ver os testes passarem, e a suíte inteira**

  Run, na fila da máquina: `npx playwright test` (a suíte inteira da interface), `npm run typecheck` e `npm run build`
  Expected: PASS em tudo.

- [ ] **Step 5: Commit e o GitHub**

  ```bash
  git commit -m "feat(windows): as falhas ao dizer o estado do ramal tentam de novo, sem aparecer" -- windows/ui
  git push origin reunioes-etapa-1
  ```
  O workflow `build` desse commit fica verde. Um job vermelho volta para esta tarefa.

---

### Task 4: O roteiro, o guia e a spec

**Files:**
- Modify: `docs/teste-manual.md` (a seção do estado dos ramais e a tabela "Onde cada critério")
- Modify: `docs/chat-servidor.md` (a seção "Acompanhar os ramais dos clientes")
- Modify: `docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md` (o status)

- [ ] **Step 1: O roteiro manual**

  A seção do estado dos ramais ganha as linhas do app novo, com dois PCs:

  | Passo | Resultado esperado |
  |---|---|
  | Atualize o app num PC que está no chat e espere o ramal registrar. Olhe a página da empresa. | A pessoa aparece `Online`, com `há` e o tempo. O computador tem a bolinha verde. |
  | Na área do administrador do app, troque a senha do ramal por uma errada e salve. Espere 1 minuto e meio. | A pessoa passa a `Sem registro`, com o tempo e `o app diz “Erro no cadastro”`. A primeira página mostra o cartão vermelho com `1` e a linha dela no `SEM REGISTRO AGORA`. |
  | Corrija a senha. | Em até 30 segundos, a pessoa volta a `Online`, e a linha sai da lista. |
  | Com a mesma conta em dois PCs, feche o app num deles. | A pessoa continua `Online`. O PC fechado aparece com o anel cinza. |
  | Num PC com o app antigo, olhe a pessoa dele. | Ela continua `No chat`, com `o app é antigo e não diz o ramal`. |
  | Reinicie o serviço do chat num horário sem uso e olhe a primeira página. | Por alguns segundos, todos aparecem offline. Depois, cada um volta ao estado dele, com o tempo certo (um ramal fora há horas não volta como "há menos de 1 min"). |

  Na tabela "Onde cada critério", as linhas dos critérios 3 e 4 da spec, com os testes do `ramal.spec.ts` e as linhas do roteiro.

- [ ] **Step 2: O guia do chat**

  Na seção "Acompanhar os ramais dos clientes": a versão do app a partir da qual o "Online" e o "Sem registro" aparecem; que cada PC passa a mostrar isso quando a pessoa aceita a atualização do app; e que um PC em que ninguém aceita continua como "No chat".

- [ ] **Step 3: A spec**

  O status ganha a frase da segunda entrega.

- [ ] **Step 4: Conferir e dar commit**

  Conferir: nenhum endereço ou nome de verdade; as tabelas do roteiro com o mesmo número de colunas em todas as linhas.

  ```bash
  git commit -m "docs: o estado dos ramais com o app do Windows no roteiro e no guia" -- docs/teste-manual.md docs/chat-servidor.md docs/superpowers/specs/2026-11-19-starsonic-phone-estado-dos-ramais-design.md
  git push origin reunioes-etapa-1
  ```

---

## Depois das quatro tarefas

O responsável publica a versão do app do Windows e roda as linhas novas do roteiro. Cada PC passa a mostrar o "Online" e o "Sem registro" quando a pessoa aceita a atualização do app.
