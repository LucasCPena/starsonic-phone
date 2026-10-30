# Etapa 2, parte 1: o modo iPhone da interface e do núcleo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A interface do Windows (`windows/ui`) e o núcleo (`starsonic/desktop`) ganham o modo iPhone da spec (seções 4.1, 6.1 itens 1 e 2, 7 e 8), testados no Linux, com as fotos das telas nos tamanhos do iPhone; o app em Swift (a parte 2) só liga os ganchos.

**Architecture:** O modo iPhone é um valor novo do `DesktopConfig` (a plataforma). Com ele, o núcleo põe `plataforma: "ios"` e os campos do iPhone no estado, recusa os comandos do PC e chama os ganchos novos do hospedeiro (a agenda, a rota de áudio, os bipes e a perdida). A interface lê o `plataforma` do estado e entra no modo iPhone: sem a barra de título, sem o que está fora da 1.0, com a área segura, a aba Contatos da agenda e a escolha de áudio do iPhone. Sem a plataforma (o Windows), o estado, os comandos e as telas ficam exatamente como hoje.

**Tech Stack:** TypeScript 5.9 e Preact 10.29 (esbuild), Playwright 1.56.1 com o axe; C++17 do núcleo com doctest e as falsificações de `tests/desktop`.

**Spec:** `docs/superpowers/specs/2026-10-29-starsonic-phone-iphone-design.md` — as seções 4.1, 4.2, 6.1 (itens 1 e 2), 7.1, 7.7 a 7.9, 8, 10 e 11.2 ("Núcleo no modo iPhone" e "Interface no modo iPhone").

## Global Constraints

- **Escopo:** só o modo iPhone da `windows/ui` e do `starsonic/desktop`, no Linux. Ficam para a parte 2 (o app em Swift): o Xcode, o `ios/`, o `build/ios/build-deps.sh`, o workflow `ios`, o CallKit, a sessão de áudio, o User-Agent `Starsonic Phone iOS/<versão>` e o `teste-manual-ios.md`. Ficam para a etapa 3: o push (o token, o registro com e sem os dados de push) e a ligação com o app fechado.
- **O Windows e o Android não mudam de comportamento** (spec 5, "As partes compartilhadas mudam só atrás do modo iPhone"):
  - sem `plataforma` no estado, a interface faz o que faz hoje;
  - com `Platform::Windows`, o JSON do estado não ganha nenhum campo, e cada comando de hoje faz o que faz hoje;
  - todos os testes de hoje passam sem mudança: os do Playwright, o `desktop_tests`, o `phone_tests` e o `call_controller_tests`.
- **O protocolo continua na versão 1** (`PROTOCOL_VERSION = 1`, `kBridgeVersion = 1`): campos e comandos novos não mudam a versão (`docs/ponte-windows.md`, "Versão").
- **Os tamanhos do iPhone** (spec 11.2), em pixels de CSS, com a área segura de cada um:
  - 375×667: em cima 20, embaixo 0;
  - 390×844: em cima 47, embaixo 34;
  - 430×932: em cima 59, embaixo 34.
  As fotos saem nos temas claro e escuro.
- **Os textos, exatos** (os da spec 8, mais os do Android 0.2.0-rc.3 adaptados ao iPhone, para o responsável aprovar no plano):
  - aba Contatos: "Buscar contato", "Permita o acesso aos contatos para ligar pelo nome.", "Permitir", "Nenhum contato com número no iPhone.", "Nenhum contato encontrado.", e "Cancelar" na escolha do número;
  - Menu: "Configurações", "Editar conta", "Sobre" e "Sair";
  - a confirmação do Sair: o título "Sair da conta?", o texto "Este iPhone deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha." e os botões "Cancelar" e "Sair";
  - Configurações: "Bipe ao digitar", com a ajuda "Vem ligado. Cada tecla faz o bipe de telefone.";
  - Sobre: "Usa o baresip e a libre (BSD), a libg722 e o Opus (BSD)", a linha "Avisos de licença" e, na linha do telefone, os botões "Ligar" e "WhatsApp";
  - a perdida: "Ligação perdida de <nome ou número>" (o texto que o `CallController` já monta).
- **O número do suporte no iPhone:** `tel:+551150603000`. Ele é aceito pelo `openExternal` só no modo iPhone; no Windows o app é o tratador do `tel:` e continua recusando.
- **Os avisos de licença do iPhone** (spec 10): baresip e libre (BSD de 3 cláusulas), libg722, Opus (BSD), Plus Jakarta Sans (OFL), Preact (MIT), nlohmann/json (MIT) e miniz (MIT). Os textos vêm dos arquivos de licença das versões fixas: o `build/deps.lock` e o `package-lock.json`.
- **Privacidade da agenda** (spec 6.4): os contatos ficam só na memória do núcleo, e o diagnóstico nunca leva nomes nem números da agenda (só a contagem e a permissão).
- **Texto do código:** C++17 sem avisos com `-Wall -Wextra`; literais em ASCII (o `python3 build/check_source_text.py` confere); linhas de log em português sem acento; comentários em português; TypeScript sem erros no `npm run typecheck`.
- **Commits:**
  - no `main`, sem forçar push e sem ramo remoto novo, em português;
  - terminam com `Co-Authored-By: <o modelo que escreveu> <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`;
  - CI verde nos workflows `build` e `android`.
- **O repositório é público:** nenhum nome do fornecedor da plataforma do PABX, nenhum segredo, nenhum token de verdade nos testes. Os nomes e números da agenda de exemplo são inventados.
- **Comandos de teste** (`$S` = `/tmp/claude-0/-home-claude/62d54bdc-24b1-5e22-a5c0-39fd7d73e742/scratchpad`):
  - **interface:**
    - uma vez, `cd windows/ui && npm ci`;
    - depois, `cd windows/ui && npm run build && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test`;
    - um arquivo só: `... npx playwright test tests/ios.spec.ts`;
  - **núcleo:** `cmake -S tests/desktop -B $S/build-desktop-tests && cmake --build $S/build-desktop-tests -j 4 && ctest --test-dir $S/build-desktop-tests --output-on-failure`;
  - **os literais:** `python3 build/check_source_text.py`.

## Review Focus

1. **Uma agenda grande e bagunçada:** milhares de contatos, nomes com acento ou vazios, números repetidos num contato. A aba Contatos abre e busca sem travar, na ordem do português. Um contato sem número não aparece, e um número repetido aparece uma vez. Os testes ficam na Task 2 (a tela, com 5.000 contatos) e na Task 5 (o núcleo).
2. **O número da agenda num formato diferente do que a central manda** (com +55, o DDD, o 0 de saída ou espaços): o nome aparece na recebida, nos Recentes e na perdida. Um ramal curto só bate com o mesmo número. Os testes ficam na Task 5.
3. **A permissão dos contatos negada e depois dada nos Ajustes do iPhone,** com a volta ao app: a aba mostra o aviso e depois a lista, sem abrir o app de novo. Os testes ficam na Task 2 e na Task 5.
4. **A área segura em cada tamanho,** também na tela da ligação, no teclado da ligação, nos diálogos e no aviso de 2 s: nada fica embaixo do entalhe ou da barra de baixo. Os testes ficam na Task 1 e na Task 3, conferindo a caixa de cada elemento contra a área segura.
5. **Um comando do PC que chega no modo iPhone** (de um toque perdido ou de uma interface de outra versão): é recusado sem mudar nada, com uma linha no diagnóstico. O mesmo vale para um comando do iPhone que chega no Windows. Os testes ficam na Task 4.

---

### Task 1: O contrato do modo iPhone e a interface sem as partes do PC

**Files:**
- Modify:
  - `docs/ponte-windows.md`: a seção nova "## O modo iPhone (etapa 2)", no fim;
  - `windows/ui/src/state.ts`, `windows/ui/src/fake.ts`, `windows/ui/src/fake-scenarios.ts` (o `bridge.ts` não muda, spec 6.1);
  - `windows/ui/src/main.tsx`, `windows/ui/src/components/Header.tsx`, `windows/ui/src/components/Nav.tsx`;
  - `windows/ui/src/screens/Entrar.tsx`, `windows/ui/src/screens/Recentes.tsx`, `windows/ui/src/app.css`.
- Create: `windows/ui/src/plataforma.ts`, `windows/ui/tests/ios.spec.ts`, `windows/ui/tests/ios-helpers.ts`.

**Interfaces:**
- Consumes: nada de outra task.
- Produces:
  - **Os tipos** (`state.ts`; os nomes valem também no JSON):
    ```ts
    export type Platform = 'ios';
    export type AgendaPermission = 'pendente' | 'negada' | 'concedida';
    export interface AgendaSummary { permissao: AgendaPermission; vez: number; quantos: number }
    export interface AgendaContact { nome: string; numeros: string[] }
    // AppState: plataforma?: Platform; agenda?: AgendaSummary; rotaAudio?: string;
    //           config: { bipeFim: boolean; bipeTecla?: boolean }
    // IncomingMessage: | { v: number; type: 'agenda'; vez: number; contatos: AgendaContact[] }
    //                  | { v: number; type: 'abrir'; tela: 'recentes' }
    // Command: | { cmd: 'contactsOpened' } | { cmd: 'allowContacts' } | { cmd: 'audioRoute' }
    //          | { cmd: 'keyTone'; tecla: string }
    //          e setSetting com chave: 'iniciarComWindows' | 'bipeFim' | 'bipeTecla'
    // EXTERNAL_URLS.suporte = 'tel:+551150603000'
    ```
  - `export function isIos(state: Pick<AppState, 'plataforma'> | null): boolean`, em `plataforma.ts`.
  - **A ponte falsa:**
    - o `createFakeWebview(name)` de sempre lê também, ele mesmo, os parâmetros da URL `plataforma=ios` e `agenda=pendente|negada|concedida` (sem `agenda`: concedida): `?fake=<cenario>&plataforma=ios&agenda=negada`;
    - `export const AGENDA_DE_EXEMPLO: AgendaContact[]`, em `fake-scenarios.ts`.
  - **Para os testes,** em `tests/ios-helpers.ts`:
    - `TAMANHOS_IPHONE`: os três tamanhos com a área segura de cada um (Global Constraints);
    - `abrirIos(page, cenario, tamanho, opcoes?: { agenda?: AgendaPermission })`: o viewport do tamanho, com `hasTouch` e `isMobile`, e as variáveis `--safe-*` do tamanho no `style` do `:root`;
    - `dentroDaAreaSegura(page, seletores: string[])`: a caixa de cada elemento entre `--safe-top` e a altura menos `--safe-bottom`;
    - `capturarIos(page, nome, tamanho, tema)`: em `test-results/capturas/ios-<nome>-<largura>x<altura>-<tema>.png`;
    - o `semViolacoesSerias` é o de `tests/helpers.ts`.

**O contrato** (a seção nova da `docs/ponte-windows.md`, com um exemplo de cada mensagem e comando). Tudo nela existe só com `plataforma: "ios"`:
- **Os campos do estado:**
  - `plataforma`;
  - `agenda` (`permissao`, `vez` e `quantos`: a contagem da última lista);
  - `rotaAudio` (o nome da saída de agora: "iPhone", "Viva-voz" ou o nome do fone; "" sem saber);
  - `config.bipeTecla`.
- **Os campos do PC que ficam com o valor neutro:**
  - `contas` com no máximo a conta em uso;
  - `contatos: []`, `atalhos: []` e `iniciarComWindows: false`;
  - `admin` fechado, com `naoPerturbe` e `atenderAuto` true e `blf` e `puxa` false;
  - `empresa` com `situacao: "nenhuma"`;
  - `audio` com as listas vazias.
- **A mensagem `agenda`:** `{"v":1,"type":"agenda","vez":N,"contatos":[{"nome":"...","numeros":["..."]}]}`. Ela vai no `ready` (com `vez` > 0) e a cada lista nova. Vale a de `vez` mais alta, como na `contatosEmpresa`.
- **A mensagem `abrir`:** `{"v":1,"type":"abrir","tela":"recentes"}`, quando a pessoa toca no aviso da perdida (spec 7.9). A interface vai para os Recentes, como a última ligação que acaba volta ao Teclado.
- **Os comandos novos:**
  - `contactsOpened`: a aba Contatos abriu; o hospedeiro lê a agenda de novo e, na primeira vez, pede a permissão;
  - `allowContacts`: o Permitir; o hospedeiro pede a permissão ou abre os Ajustes;
  - `audioRoute`: o botão Áudio da ligação; o hospedeiro mostra a escolha do iPhone;
  - `keyTone` com `tecla` de `0-9`, `*` ou `#`, mandado só com `config.bipeTecla`;
  - `setSetting` com `bipeTecla`;
  - `openExternal` com `tel:+551150603000`.
- **O que muda nos comandos de sempre:**
  - o Sair é o `removeAccount` da conta em uso;
  - o `ring` e o `update` não vêm: quem toca é a tela de chamada do iPhone, e o bipe do fim é do hospedeiro.
- **Os comandos do PC, recusados no iPhone** (com uma linha no diagnóstico):
  - `minimize`, `closeToTray`, `resize` e `quit`;
  - `selectAccount`, `setAudio` e `setSetting iniciarComWindows`;
  - `saveContact` e `removeContact`;
  - `saveShortcut`, `removeShortcut` e `useShortcut`;
  - `adminLogin`, `adminLogout` e `adminSet`;
  - `importContacts`, `exportContacts`, `setCompanyList` e `refreshCompanyList`;
  - `updateNow` e `updateLater`.
- **No Windows,** os comandos novos são recusados do mesmo jeito.

**A interface no modo iPhone** (`isIos(state)`):
- **O que sai:**
  - a `TitleBar`, e com ela as zonas de redimensionar;
  - os atalhos de teclado (o Ctrl+1 a 4 e o Ctrl + P);
  - a `Atualizacao` e o `AdminLogin`;
  - o toque (as mensagens `ring` são ignoradas);
  - a aba Atalhos (a `Nav` recebe `tabs: Tab[]`: no iPhone, Teclado, Recentes e Contatos, em três colunas);
  - o "Salvar contato" dos Recentes.
- **O cabeçalho:** a conta aparece sem a troca de conta (sem o menu Contas e sem a seta). O Menu tem "Configurações", "Editar conta" (a tela `conta` com o `contaId` da conta em uso), "Sobre", a linha de separar e "Sair". O Sair abre o `Confirm` com os textos das Global Constraints; o "Sair" dele manda `removeAccount` com o id da conta em uso.
- **A tela Entrar:** o "(11) 5060-3000" do "Precisa de ajuda?" vira um botão com o `aria-label` "Ligar para (11) 5060-3000", que manda `openExternal` com `EXTERNAL_URLS.suporte`.
- **A tela e o toque:**
  - o `.win` leva `data-plataforma="ios"`;
  - o `app.css` põe a área segura só debaixo de `[data-plataforma="ios"]`, pelas variáveis `--safe-top`, `--safe-bottom`, `--safe-left` e `--safe-right`, definidas no `:root` como `env(safe-area-inset-*, 0px)`, para os testes poderem trocá-las no `style` do `:root`;
  - no primeiro estado com `plataforma: "ios"`, a interface põe no `<meta name="viewport">` `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1`;
  - sem o menu do toque longo nem a seleção de texto (fora dos campos), sem o realce do toque e sem o zoom de dois toques.
- **O toque longo** (spec 8, "tocar e segurar faz o que o botão direito faz no PC"): o único menu do botão direito é o dos atalhos, que não existe no iPhone. Nada a fazer além de tirar o menu do toque longo do iOS.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/ios.spec.ts`. Para cada tamanho de `TAMANHOS_IPHONE` e cada tema:
  ```ts
  test('the main screen has no title bar, no Atalhos tab and keeps the safe area', async ({ page }) => {
    await abrirIos(page, 'principal', tamanho);
    await expect(page.locator('.titlebar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Atalhos' })).toHaveCount(0);
    await expect(page.locator('.nav button')).toHaveCount(3);
    await dentroDaAreaSegura(page, ['.brand', '.nav']);   // a caixa de cada um entre --safe-top e altura - --safe-bottom
    await semViolacoesSerias(page);
    await capturarIos(page, 'teclado', tamanho, tema);
  });
  test('the menu has Configurações, Editar conta, Sobre and Sair, and Sair asks before removeAccount', ...);
  //   espera os quatro itens, nessa ordem; o "Sair" do Confirm manda { cmd: 'removeAccount', contaId: <a em uso> }
  //   e o "Cancelar" não manda nada
  test('the account in the header does not switch accounts', ...);   // sem menu Contas, sem "Adicionar conta"
  test('Entrar calls the support number and keeps the safe area', ...);
  //   o botão "Ligar para (11) 5060-3000" manda { cmd: 'openExternal', url: 'tel:+551150603000' }; captura 'entrar'
  test('Recentes has no Salvar contato', ...);   // captura 'recentes'
  test('ring and update messages do nothing, and Ctrl+P and Ctrl+2 do nothing', ...);
  test('the abrir message opens Recentes', ...);   // de Configurações e do Teclado, a mensagem leva aos Recentes
  ```
  Em `tests/screens.spec.ts`, um caso só, no Windows: o mesmo `principal` sem `plataforma` continua com a barra de título, as quatro abas e o menu de sempre ("Configurações", "Sobre", "Sair" com `quit`).
- [ ] **Step 2: Rode e veja falhar.** `... npx playwright test tests/ios.spec.ts`. Esperado: FAIL; a barra de título e a aba Atalhos aparecem.
- [ ] **Step 3: Implemente o contrato e a interface do modo iPhone** como descrito acima. A ponte falsa no modo iPhone:
  - **o estado:** troca o estado do cenário pelo do contrato (os campos do iPhone e os do PC neutros). A `rotaAudio` é "iPhone" e o `config.bipeTecla` é true;
  - **a agenda:** com a permissão `concedida`, manda a `agenda` do `AGENDA_DE_EXEMPLO` depois do estado no `ready`. São 8 contatos inventados: um com dois números, nomes com acento e um ramal;
  - **os comandos:**
    - guarda todos;
    - `allowContacts` passa a permissão para `concedida` e manda a lista;
    - `removeAccount` da conta em uso volta à tela Entrar.
- [ ] **Step 4: Rode e veja passar,** e rode a suíte inteira: `... npx playwright test`. Esperado: 0 failed, com as specs do Windows sem mudança.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(ui): o modo iPhone da interface, sem as partes do PC`. As capturas `test-results/capturas/ios-*.png` (Teclado, Recentes e Entrar, nos três tamanhos e nos dois temas) são as fotos que vão ao responsável depois da revisão desta task.

### Task 2: A aba Contatos com a agenda do iPhone

**Files:**
- Create: `windows/ui/src/screens/Agenda.tsx`, `windows/ui/tests/ios-contatos.spec.ts`.
- Modify:
  - `windows/ui/src/main.tsx`: a lista da `agenda` guardada, a de `vez` mais alta, e a aba Contatos do iPhone;
  - `windows/ui/src/screens/Teclado.tsx` e `windows/ui/src/screens/Ligacao.tsx`: as sugestões;
  - `windows/ui/src/format.ts`, `windows/ui/src/fake.ts`, `windows/ui/src/fake-scenarios.ts`.

**Interfaces:**
- Consumes: os tipos, a ponte falsa e os ajudantes de teste da Task 1.
- Produces:
  - `export function Agenda(props: { agenda: AgendaSummary; contatos: AgendaContact[]; send: Send }): VNode`;
  - em `format.ts`:
    - `export function searchAgenda(contatos: AgendaContact[], texto: string): AgendaContact[]`;
    - `export function agendaSuggestions(contatos: AgendaContact[]): Contact[]`, um `Contact` por número, com `id` `agenda-<i>-<j>` e `observacao` "", para as sugestões do Teclado e do Transferir.

**As regras** (as do Android 0.2.0-rc.3, `android/.../contacts/ContactsScreen.kt` e `ContactsSource.kt`):
- **A lista:**
  - só os contatos com algum número, em ordem alfabética do português (`Intl.Collator('pt-BR', { sensitivity: 'accent' })`);
  - em grupos pela letra (`groupLetter`), com o avatar das iniciais (`initials`), o nome (ou o primeiro número, sem nome) e os números juntos por " · " (cada um pelo `contactNumberLine`);
  - o botão redondo de ligar, como na aba Contatos do Windows;
  - sem o "+" e sem o "⋯".
- **A busca** ("Buscar contato"): o texto sem os espaços das pontas. Com letras, vale o nome sem acento e sem caixa (`fold`). Sem letras, valem os dígitos dentro de algum número. Vazia, vale todo mundo.
- **Ligar:**
  - um número só: `dial` com `{ numero, contato: true }`;
  - mais de um: o diálogo com o nome no título, um botão por número e o "Cancelar".
- **A permissão:**
  - `pendente` ou `negada`: só o aviso "Permita o acesso aos contatos para ligar pelo nome." e o botão "Permitir", que manda `allowContacts`;
  - `concedida`, sem nenhum contato com número: "Nenhum contato com número no iPhone.";
  - uma busca sem resultado: "Nenhum contato encontrado.".
- **Ao abrir a aba:** a cada vez que ela abre, manda `contactsOpened`.
- **As sugestões:** no iPhone, as do Teclado e do número do Transferir e da Nova ligação vêm de `agendaSuggestions(lista da agenda)`, no lugar dos `contatos`.
- **A lista grande:** cada linha é montada uma vez e reaproveitada, como na aba Contatos do Windows (`Contatos.tsx`, o comentário do topo).

- [ ] **Step 1: Escreva os testes que falham**, em `tests/ios-contatos.spec.ts`, em cada tamanho e tema:
  ```ts
  test('Contatos lists the agenda, searches by name and digits, and calls', ...);
  //   a ordem do AGENDA_DE_EXEMPLO pelo pt-BR; "élcio" acha "Élcio Matos"; "2000" acha o ramal;
  //   tocar num contato de um número manda { cmd: 'dial', numero, contato: true }; captura 'contatos'
  test('a contact with two numbers asks which one', ...);   // o diálogo, "Cancelar" não manda nada; captura 'contatos-escolha'
  test('opening the tab sends contactsOpened each time', ...);
  test('without permission shows the notice and Permitir sends allowContacts', ...);
  //   ?agenda=negada; captura 'contatos-sem-permissao'
  test('the permission given later shows the list without reopening', ...);   // Review Focus 3: estado concedida + agenda
  test('an empty agenda and an empty search show their texts', ...);
  test('the keypad suggests numbers from the agenda', ...);   // "988" sugere o celular da Ana Souza
  ```
  Cada caso com captura roda também o `semViolacoesSerias`. E um caso da Review Focus 1, como o `tests/contatos-lista-grande.spec.ts`. São 5.000 contatos, com acentos, nomes vazios e números repetidos; a aba abre e a busca responde em até 1 s cada, e cada número repetido aparece uma vez.
- [ ] **Step 2: Rode e veja falhar.** Esperado: FAIL; a aba Contatos do Windows aparece no iPhone.
- [ ] **Step 3: Implemente** a aba e as sugestões pelas regras acima.
- [ ] **Step 4: Rode e veja passar,** com a suíte inteira. Esperado: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(ui): a aba Contatos com a agenda do iPhone`.

### Task 3: Configurações, Sobre e a tela da ligação no modo iPhone

**Files:**
- Create:
  - `windows/ui/src/screens/Licencas.tsx`;
  - `windows/ui/assets/licencas-ios.txt`, os avisos, com o nome, a versão e o texto inteiro da licença de cada peça, copiados de:
    - o baresip e a libre: o `LICENSE` de cada um, nos commits do `build/deps.lock` (a árvore que o `build/baresip/build-linux.sh` baixa);
    - a libg722: o arquivo de licença dela, no commit do `build/deps.lock`;
    - o Opus 1.6.1: o `COPYING` da tag `v1.6.1` de `github.com/xiph/opus`;
    - a Plus Jakarta Sans: `windows/ui/assets/OFL.txt`;
    - o Preact: `windows/ui/node_modules/preact/LICENSE`, na versão do `package-lock.json`;
    - o nlohmann/json: `starsonic/third_party/nlohmann/LICENSE.MIT`;
    - o miniz: `starsonic/third_party/miniz/LICENSE`;
  - `windows/ui/tests/ios-ligacao.spec.ts`.
- Modify:
  - `windows/ui/src/types.ts`: a `View` `{ kind: 'licencas'; back: View }`;
  - `windows/ui/src/main.tsx`, `windows/ui/src/screens/Configuracoes.tsx`, `windows/ui/src/screens/Sobre.tsx`;
  - `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/screens/Teclado.tsx`;
  - `windows/ui/build.mjs`, se o arquivo novo precisar entrar no `dist`;
  - `windows/ui/src/fake.ts`.

**Interfaces:**
- Consumes: as Tasks 1 e 2.
- Produces: `export function Licencas(props: { onBack(): void }): VNode`. O texto vem de `assets/licencas-ios.txt` pelo `fetch` do mesmo lugar, que a CSP já deixa (`connect-src 'self'`).

**As regras no modo iPhone:**
- **Configurações:**
  - só a seção Ligações: o bipe do fim (`bipeFim`), o "Bipe ao digitar" (`setSetting` `bipeTecla`, com a ajuda das Global Constraints) e o Atender automaticamente com o tempo;
  - sem as Contas, o Áudio, o Iniciar com o Windows e os Contatos (a planilha).
- **Sobre:**
  - a linha de licença "Usa o baresip e a libre (BSD), a libg722 e o Opus (BSD)", no lugar da do Windows;
  - o site;
  - a linha "(11) 5060-3000", com o "Ligar" (`openExternal` `tel:+551150603000`, `aria-label` "Ligar para o suporte") e o "WhatsApp";
  - a linha "Avisos de licença", que abre a tela `licencas`;
  - o "Enviar diagnóstico";
  - sem o "Código-fonte".
- **A tela da ligação:**
  - o botão Áudio mostra a `rotaAudio` ("Áudio" quando ela é ""), com o `aria-label` "Áudio: <rota>", e manda `audioRoute`, no lugar do menu de dispositivos;
  - sem o botão Atalhos;
  - cada tecla do teclado da ligação manda, além do `dtmf`, o `keyTone` com a tecla, quando `config.bipeTecla`.
- **O Teclado:** cada tecla do Teclado (e o `+` do 0 segurado, como tecla `0`) manda o `keyTone`, quando `config.bipeTecla`.
- **A área segura** (Review Focus 4): a tela da ligação, o teclado dela, os diálogos (`Confirm`, a escolha do número, as `dialog`) e o aviso de 2 s ficam dentro dela.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/ios-ligacao.spec.ts` (e casos novos em `tests/ios.spec.ts` para Configurações e Sobre), em cada tamanho e tema:
  ```ts
  test('Configurações shows only Ligações, with Bipe ao digitar', ...);   // setSetting bipeTecla false; captura 'configuracoes'
  test('Sobre shows the iPhone licenses, calls the support and opens the notices', ...);
  //   sem "Código-fonte"; "Ligar" manda tel:; "Avisos de licença" abre a tela com "baresip" e "Opus" no texto;
  //   capturas 'sobre' e 'licencas'
  test('the call screen shows the audio route and asks the iPhone to choose', ...);
  //   cenário ligacao: o botão "Áudio: iPhone"; o clique manda { cmd: 'audioRoute' }; sem o botão Atalhos;
  //   a rotaAudio "Viva-voz" num estado novo troca o texto; captura 'ligacao'
  test('the keys beep through keyTone only with bipeTecla', ...);   // no Teclado e no teclado da ligação, com e sem a chave
  test('two calls, the consult and the conference keep the safe area', ...);
  //   cenários duas-ligacoes, consulta, conferencia; capturas de cada um; dentroDaAreaSegura nos botões e cartões
  test('the dialogs and the toast stay inside the safe area', ...);
  ```
  Cada caso com captura roda também o `semViolacoesSerias`.
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente** pelas regras acima.
- [ ] **Step 4: Rode e veja passar,** com a suíte inteira. Esperado: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(ui): Configurações, Sobre e a ligação no modo iPhone`. Depois da revisão, as fotos de todas as telas vão ao responsável.

### Task 4: O núcleo no modo iPhone: a plataforma, a conta única e os comandos do PC recusados

**Files:**
- Create:
  - `tests/desktop/desktop_fixture.h`: o `Harness`, o `FakePort`, o `HexCipher` e o `QueueExecutor`, tirados de `tests/desktop/test_desktop_app.cpp` sem mudança, com `Harness::platform` (Windows por padrão) entrando no `DesktopConfig`;
  - `tests/desktop/test_iphone_mode.cpp`.
- Modify:
  - `starsonic/desktop/DesktopApp.h` e `.cpp`;
  - `starsonic/desktop/Protocol.h` e `.cpp`: os `CommandKind` novos, o `BridgeState` do iPhone e o `StateMessage`;
  - `tests/desktop/test_desktop_app.cpp`: passa a usar o `desktop_fixture.h`.

**Interfaces:**
- Consumes: o contrato da Task 1 (`docs/ponte-windows.md`, "O modo iPhone").
- Produces:
  - `enum class Platform { Windows, IPhone };` em `DesktopApp.h` e `Platform platform = Platform::Windows;` no `DesktopConfig`;
  - `CommandKind::ContactsOpened`, `AllowContacts`, `AudioRoute` e `KeyTone`, com `Command::key`, a tecla do `keyTone`;
  - a chave `bipeTecla` no `SetSetting`;
  - no `BridgeState`, `std::optional<IPhoneView> iphone;`, com `struct IPhoneView { AgendaPermission permission; int agendaSeq; int agendaCount; std::string audioRoute; bool keyBeep; };`. Sem ele, o JSON é o de hoje; com ele, os campos do contrato. O `AgendaPermission` fica em `starsonic/desktop/Agenda.h`; esta task cria o arquivo só com esse enum, e a Task 5 o completa.

**As regras:**
- **A abertura no iPhone** (`Start`):
  - sem a migração da rc.7, sem o `atalhos.json` e sem o `admin.json` (o administrador neutro do contrato);
  - sem a lista da empresa (nem leitura, nem o tempo de 15 min) e sem o BLF;
  - o `config.json` vale como no Windows.
- **A conta única:** um Entrar que registra uma conta nova (sem `contaId`) deixa só ela no `contas.json`. O Editar (com o `contaId` da em uso) segue como hoje.
- **O Sair:** é o `removeAccount` da conta em uso, como hoje: recusado com uma ligação; sem ligação, desregistra e volta à tela Entrar. Os Recentes ficam.
- **Os comandos recusados:**
  - no iPhone, os do PC listados no contrato: nada muda, nenhum gancho é chamado, e o log ganha `comando recusado no modo iPhone: <nome>`;
  - no Windows, os novos: `comando recusado no modo Windows: <nome>`.
  - O `quit` é recusado no iPhone. A spec 6.1 lista o gancho `quit` entre os do iPhone, mas um app do iPhone não se fecha sozinho (é regra da App Store), e o Sair do iPhone é o da conta (7.1).
- **O `openExternal`:**
  - no iPhone, aceita o site, o WhatsApp e `tel:+551150603000`, e recusa o código-fonte;
  - no Windows, nada muda.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/desktop/test_iphone_mode.cpp`:
  ```cpp
  TEST_CASE("the iPhone state carries the platform and the neutral PC fields") {
      Harness h(Platform::IPhone);
      // o JSON do state tem "plataforma":"ios", "agenda":{"permissao":"pendente","vez":0,"quantos":0},
      // "rotaAudio":"", "config":{"bipeFim":true,"bipeTecla":true}, "atalhos":[], "contatos":[],
      // "iniciarComWindows":false, o admin neutro do contrato e "empresa" com "situacao":"nenhuma"
  }
  TEST_CASE("the Windows state has none of the iPhone fields") { /* sem "plataforma", "agenda", "rotaAudio", "bipeTecla" */ }
  TEST_CASE("a new login on the iPhone keeps only that account") { /* dois Entrar seguidos: contas.json com uma */ }
  TEST_CASE("Sair on the iPhone is removeAccount: refused during a call, otherwise back to Entrar keeping the recents") {}
  TEST_CASE("every PC command is refused on the iPhone without changing anything") {
      // para cada nome do contrato: o mesmo estado, nenhum gancho, a linha "comando recusado no modo iPhone: <nome>"
  }
  TEST_CASE("the iPhone commands are refused on Windows") {}
  TEST_CASE("the iPhone start does not migrate, read the company list or watch BLF") {}
  TEST_CASE("openExternal on the iPhone opens the support number and refuses the source code") {}
  ```
- [ ] **Step 2: Rode e veja falhar.** O comando do núcleo. Esperado: FAIL (não compila sem o `Platform`).
- [ ] **Step 3: Implemente** as regras acima. Primeiro mova o `Harness` para o `desktop_fixture.h` e confira que o `test_desktop_app.cpp` passa igual.
- [ ] **Step 4: Rode e veja passar.** Esperado: 0 failed no `desktop_tests`, com todos os casos de hoje.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(desktop): o modo iPhone do núcleo, com a conta única e os comandos do PC recusados`.

### Task 5: A agenda no núcleo

**Files:**
- Create: `starsonic/desktop/Agenda.cpp`, `tests/desktop/test_agenda.cpp`.
- Modify:
  - `starsonic/desktop/Agenda.h`;
  - `starsonic/desktop/DesktopApp.h` e `.cpp`;
  - `starsonic/desktop/Protocol.h` e `.cpp`: o `AgendaMessage`;
  - `tests/desktop/test_iphone_mode.cpp`.

**Interfaces:**
- Consumes: a Task 4.
- Produces (`Agenda.h`):
  - `enum class AgendaPermission { Pending, Denied, Granted };`;
  - `struct AgendaContact { std::string name; std::vector<std::string> numbers; };`, em UTF-8;
  - `bool SameAgendaNumber(const std::string& a, const std::string& b);`;
  - `class AgendaStore` com:
    - `void Replace(AgendaPermission permission, std::vector<AgendaContact> contacts);`;
    - `std::optional<std::string> NameFor(const std::string& number) const;`;
    - `AgendaPermission Permission() const;`, `int Count() const;` e `std::vector<AgendaContact> All() const;`;
    - a trava própria, porque o `NameFor` roda na thread do motor.
- Produces (`DesktopApp`):
  - `void SetAgenda(AgendaPermission permission, std::vector<AgendaContact> contacts);`, que só põe na fila;
  - os ganchos `std::function<void()> readAgenda;` (o `contactsOpened`) e `std::function<void()> allowContacts;`.
- Produces (`Protocol`): `std::string AgendaMessage(int seq, const std::vector<AgendaContact>& contacts);`.

**As regras:**
- **`SameAgendaNumber`:** só os dígitos dos dois. Valem iguais e não vazios. Ou, quando os dois têm 8 dígitos ou mais, os 8 últimos iguais. Assim:
  - "+55 (11) 98888-7777" bate com "011988887777", "11988887777" e "988887777";
  - "2001" bate com "2001", e não com "+55 11 3333-2001";
  - a colisão de dois números com os mesmos 8 últimos dígitos em DDDs diferentes fica como limite conhecido (vale o primeiro na ordem da agenda).
  O Android usa o PhoneLookup do sistema, com o mínimo de 7 dígitos; 8 cobre o número local do Brasil, com e sem o 9.
- **`Replace`:**
  - fica de fora o contato sem nenhum número;
  - os números repetidos (os mesmos dígitos) num contato ficam uma vez, na ordem;
  - os índices pelos dígitos inteiros e pelos 8 últimos são montados uma vez, para o `NameFor` não percorrer a lista;
  - sem a permissão `Granted`, a lista é vazia.
- **`SetAgenda`:** troca a lista, sobe o `vez`, manda a mensagem `agenda`, publica o estado e escreve no log `agenda: <n> contatos, permissao <pendente|negada|concedida>` (sem nomes e sem números).
- **No `ready`:** vai a `agenda`, com o `vez` > 0, depois do estado e antes do resto, como a `contatosEmpresa`.
- **Os nomes no iPhone** (a recebida, os Recentes e a perdida): o da agenda, e sem ele o da central. O `contatoId` dos Recentes fica "".
- **Os comandos:** o `contactsOpened` chama o `hooks.readAgenda` e o `allowContacts` chama o `hooks.allowContacts`, os dois só no iPhone.

- [ ] **Step 1: Escreva os testes que falham.**
  - Em `tests/desktop/test_agenda.cpp`, a Review Focus 2:
    ```cpp
    TEST_CASE("agenda numbers match the formats the PBX sends") { /* os casos da regra, com CHECK e CHECK_FALSE */ }
    TEST_CASE("Replace drops contacts without numbers and repeated numbers, and NameFor uses the first match") {}
    TEST_CASE("NameFor over 5000 contacts uses the index") { /* 10.000 NameFor em menos de 1 s */ }
    ```
  - Em `test_iphone_mode.cpp`:
    ```cpp
    TEST_CASE("SetAgenda sends the agenda message and the summary, and ready repeats it") {}
    TEST_CASE("the agenda names the incoming call, the recents and the missed call") {}
    TEST_CASE("denied then granted shows the list without restarting") { /* Review Focus 3 */ }
    TEST_CASE("contactsOpened and allowContacts call the host hooks") {}
    TEST_CASE("the diagnostics never carry agenda names or numbers") {}
    ```
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente** pelas regras acima.
- [ ] **Step 4: Rode e veja passar.** Esperado: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(desktop): a agenda do iPhone no núcleo`.

### Task 6: Os bipes, a rota de áudio e a perdida no núcleo

**Files:**
- Modify:
  - `starsonic/desktop/DesktopApp.h` e `.cpp`;
  - `starsonic/desktop/Stores.h` e `.cpp`: o `bipeTecla` no `config.json`;
  - `tests/desktop/test_iphone_mode.cpp`.

**Interfaces:**
- Consumes: as Tasks 4 e 5.
- Produces:
  - `void SetAudioRoute(const std::string& name);` no `DesktopApp`, que só põe na fila;
  - `void OpenRecents();` no `DesktopApp`, que só põe na fila: o toque no aviso da perdida, que manda a mensagem `abrir` com `recentes` (e no Windows não faz nada, com a linha no log);
  - os ganchos:
    - `std::function<void()> chooseAudioRoute;` (o `audioRoute`);
    - `std::function<void(const std::string& key, bool inCall)> keyTone;`;
    - `std::function<void()> endBeep;`;
    - `std::function<void(const std::string& text)> missedCall;`.

**As regras (só no iPhone):**
- **O `bipeTecla`:** fica no `config.json` e vem ligado. O `setSetting` com `bipeTecla` o troca.
- **O `keyTone`:** só com uma tecla de `0-9`, `*` ou `#` (outra: recusada, com a linha no log). Com o `bipeTecla` ligado, chama `hooks.keyTone(tecla, emLigacao)`, com `emLigacao` verdadeiro quando há uma ligação.
- **O bipe do fim:** a mesma regra de hoje (`DesktopApp::Listener::OnSnapshot`), com o `hooks.endBeep()` no lugar da mensagem `ring fim`.
- **O toque:** nenhuma mensagem `ring`, nem no `OnRing` nem no `ready`.
- **A rota:** o `SetAudioRoute` troca a `rotaAudio` do estado, e o `audioRoute` chama o `hooks.chooseAudioRoute`. No Windows, o `SetAudioRoute` não faz nada e escreve no log.
- **A perdida:** o `OnMissed` faz o aviso de 2 s, como hoje, e também chama o `hooks.missedCall(texto)`, para o aviso do iPhone (spec 7.9). Com o Não perturbe ligado, a ligação recusada não chama o `missedCall` (spec 7.8: "sem tocar e sem aviso"); se o controlador avisa essa também, o núcleo a deixa de fora.

- [ ] **Step 1: Escreva os testes que falham**, em `test_iphone_mode.cpp`:
  ```cpp
  TEST_CASE("bipeTecla is on by default, survives a restart and setSetting changes it") {}
  TEST_CASE("keyTone calls the host only with bipeTecla, with inCall during a call") {}
  TEST_CASE("the end beep goes to the host hook, not to a ring message") {}
  TEST_CASE("no ring message reaches the interface on the iPhone") { /* recebida, segunda, ready */ }
  TEST_CASE("SetAudioRoute changes rotaAudio and audioRoute asks the host") {}
  TEST_CASE("a missed call calls missedCall with the text, but not with do not disturb") {}
  TEST_CASE("OpenRecents sends the abrir message on the iPhone and nothing on Windows") {}
  ```
- [ ] **Step 2: Rode e veja falhar.**
- [ ] **Step 3: Implemente** pelas regras acima.
- [ ] **Step 4: Rode e veja passar.** Rode também o `desktop_tests` inteiro, o `call_controller_tests`, o `phone_tests` e o `check_source_text`. Esperado: 0 failed e `ok`.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(desktop): os bipes, a rota de áudio e a perdida do iPhone no núcleo`.
- [ ] **Step 6: Depois da revisão final do ramo inteiro,** a spec ganha a seção "16. Como ficou (etapa 2, parte 1)". Ela leva:
  - as decisões tomadas na construção;
  - os textos aprovados;
  - o que a parte 2 (o app em Swift) precisa ligar: cada gancho novo, o `SetAgenda`, o `SetAudioRoute` e o `viewport` do WKWebView.
