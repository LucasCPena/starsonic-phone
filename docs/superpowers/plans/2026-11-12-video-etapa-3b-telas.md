# Vídeo em grupo, etapa 3b — as telas da sala — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a sala de vídeo aparece no Starsonic Phone para Windows, como no quadro aprovado. Entram:
- o Adicionar pessoa na videochamada, com o teclado e os contatos;
- a sala na tela da ligação: o mosaico com o nome de cada um, os estados dos convidados, o Tirar da sala e a pergunta do Desligar;
- a ligação de fora, com a faixa "Você está fora da sala" e o "Voltar para a sala";
- o grande e a tela cheia com o mosaico;
- a ponte falsa da sala, os testes, as fotos, a fumaça, o roteiro e as notas da 0.4.0-rc.1;
- a causa dos testes instáveis conhecidos.

**Architecture:**
- **A interface** (`windows/ui`, Preact) ganha a pasta `src/sala/`:
  - as regras lidas do estado (`estado.ts`), os textos (`textos.ts`) e a arrumação do núcleo em frações (`mosaico.ts`);
  - o mosaico (`MosaicoDaSala.tsx`): a vista `remoto` desenha o mosaico de quem montou (1280×720, da etapa 3a), e a página põe por cima, no `quadro` de cada convidado, o nome, o estado e o Tirar da sala;
  - a sala na tela da ligação (`TelaDaSala.tsx`), o painel de adicionar (`PainelDeAdicionar.tsx`), a pergunta do Desligar (`EncerrarSala.tsx`) e a faixa de fora da sala (`FaixaForaDaSala.tsx`).

  O `PainelPorNome` e os controles da tela da ligação saem do `Ligacao.tsx` sem mudar, para a sala usar também. O `main.tsx` leva a sala em cima à `TelaDaSala`, e a ligação de fora à tela de hoje, com a faixa em cima. O `Grande` aprende a sala.
- **A ponte falsa** (`?fake=`) faz o papel do núcleo da 3a na sala (`src/fake-sala.ts`): os quatro comandos, o `ligacao.sala` com a arrumação do `RoomMosaic.cpp`, a ligação de fora e o fim da sala.
- **O motor, o núcleo e o executável não mudam:** a ponte é a da etapa 3a. A fumaça do Windows monta uma sala de verdade com o registrador falso.

**Tech Stack:**
- Preact 10.29.8, TypeScript 5.9.3 e esbuild 0.28.2; as container queries do CSS (o WebView2 é o Chromium atual).
- O Playwright 1.56.1, com o @axe-core/playwright 4.11.3; o servidor do chat em Go, nos testes do chat.
- Python 3 e o Playwright para Python pelo CDP, na fumaça.
- Kotlin e o Compose, no `LoginScreenTest` do Android (Task 1).

**Spec:** `docs/superpowers/specs/2026-11-11-starsonic-phone-video-grupo-design.md`, aprovada pelo responsável em 11/11/2026.
- Valem nesta etapa: 4.1, 4.2 (o que a tela mostra), 6.4, 6.5 (a ponte falsa igual), 9 (a câmera e a sua imagem), 10, 11.1 (como cada erro aparece), 11.2 itens 4 e 5, 11.3 e 12 itens 4 e 5.
- O quadro aprovado pelo responsável em 12/11/2026 é o "Starsonic Phone — sala de vídeo" (https://claude.ai/artifact/SQgJUCurzuBvnHaTuq4ghx), com 13 quadros: Main, Adicionar, Sala, SalaEstados, SalaCheia, SalaCompacto, SalaMinimo, Encerrar, LigacaoDeFora, ForaDaSala, Grande, TelaCheia e Convidado. As medidas das Tasks vêm dele.
- A ponte é a da etapa 3a: `docs/ponte-windows.md`, "A sala de vídeo (0.4.0)" (os comandos, o `ligacao.sala`, a linha da sala em `top` e em `second`, o mosaico no `remoto`, as linhas `sala:` e o iPhone). Os tipos do controlador estão em `starsonic/phone/CallController.h` (`RoomView` e `RoomMemberView`).
- O modelo desta etapa é o plano das telas da etapa 2 (`docs/superpowers/plans/2026-11-10-video-etapa-2-telas.md`): a ponte falsa, as fotos, a fumaça, o roteiro e as notas seguem o jeito de lá.
- A base é a branch `video-etapa-3`, depois da etapa 3a (com a Task 9 dela, o remendo da PJSIP) e da revisão final.

## Global Constraints
- **A ponte é a da etapa 3a, sem mudança.** Esta etapa não muda o motor, o núcleo nem o executável (`starsonic/`, `windows/app/`, `build/`). Ao escrever este plano nenhuma lacuna foi provada; uma que aparecer vai ao controlador antes, com a mudança e o teste dela.
- **Os comandos** são os de "A ponte desta etapa", com os campos exatos. O Desligar da sala manda o `salaEncerrar` depois da pergunta, nunca o `hangup`.
- **O `tests/phone/test_engine_room.cpp` está no limite de 3 minutos:** esta etapa não acrescenta nenhum caso a ele, nem a outro teste do motor.
- **A sala tem até 6 pessoas** (quem monta e mais 5). A interface não conta o limite: ela lê o `sala.cheia`.
- **Só quem montou vê a sala.** O `ligacao.sala` só existe no app de quem montou. Um convidado com o Starsonic Phone vê uma videochamada comum (o quadro Convidado: nada muda nela).
- **No iPhone, nada da sala aparece** (spec 6.4): o `salaDe` dá `null` no iPhone, mesmo com o `ligacao.sala` no estado.
- **Dentro da sala só ficam** o Mudo, a Câmera, o Adicionar pessoa, o Abrir grande e o Desligar, e o Alternar com a ligação de fora em espera. Nada de Espera, Transferir, Conferência, Teclado, Nova ligação, Atalhos e Chat (spec 4.2).
- **A câmera e a sua imagem seguem a 0.3.0** (spec 9): a câmera só liga num clique, e com o `video.camera` da linha de cima (também a da sala) a "Sua imagem" fica à vista em toda tela, também com o painel de adicionar aberto.
- **O contrato da página com as memórias** da etapa 2 vale para o mosaico: a vista `remoto` da sala leva o `key` do id da sala e desenha com o `video.imagem` da linha da sala, sem a regra das duas ligações (a ligação de fora tocando não pausa o mosaico).
- **O mosaico de quem montou é 1280×720** (spec 7): os quadros da página ficam no retângulo 16:9 encaixado na área do vídeo, cada um no `quadro` do convidado, em frações.
- **O clique duplo** (rc.6): todo botão novo ignora o segundo clique de um clique duplo (o `semSegundoClique`): o Adicionar pessoa, o Adicionar, o Tirar da sala, o Encerrar, o Cancelar, o Voltar para a sala, o Alternar e os do grande.
- **O quadro aprovado decide o desenho.** As cores são as variáveis do `app.css`, e o que o quadro não mostra segue a tela de hoje mais parecida, com a escolha escrita na Task. As exceções estão em "O desenho".
- **Os três tamanhos e os dois temas** do `layout.ts` (Normal 400×720, Compacto 360×600 e Mínimo 300×440; o claro e o escuro), o grande (1280×800) e a tela cheia (1920×1080). A tela da ligação nunca rola, e nenhum botão sai da janela.
- **Os textos** são os de "Os textos", exatos, em português simples como as telas de hoje.
- **O repositório é público:** nenhum nome de parceiro, fornecedor ou cliente em arquivo, teste ou foto. Só os nomes inventados das telas (Ana Souza, Carlos Lima, Bia Ramos, Davi Nunes, Elisa Prado, Roberto Lima, a Recepção e a Coordenação de Logística e Transportes do teste dos nomes longos) e a Starsonic. O MicroSIP só aparece no roteiro, como aparelho de teste.
- **Nenhum "MicroSIP" visível** no app ou no instalador: o `build/check_branding.py` continua passando.
- **A suíte inteira continua verde** a cada Task. Um teste de antes que quebra por um botão novo é conferido e atualizado na Task que pôs o botão; um layout que não cabe é consertado no CSS, não no teste.
- **Os testes da interface** rodam na pasta `windows/ui`, contra o `dist`, com o `npm run build` antes; localmente, com o `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` e, para os do chat, o `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- **Os nomes dos testes** ficam em inglês. Os comentários e os documentos ficam em português, no estilo de cada arquivo.
- **Os commits** levam os trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
  - O push vai só para a branch `video-etapa-3`, sem force e sem tags, releases ou segredos.
  - Cada Task termina com o CI verde (o `build`, e o `android` quando o commit o dispara), conferido pelo `gh api` REST. O GraphQL está bloqueado.
- **A 0.4.0-rc.1 é publicada pelo responsável,** pelo workflow `release`, depois de ele aprovar as fotos e os textos. Este plano não publica, não cria tags e não cria releases.

## Review Focus
1. **A sala que muda com a pergunta ou o painel aberto:** um convidado sai, a sala enche, acaba sozinha ou você sai dela com o "Encerrar a sala para todos?" ou o painel de adicionar na tela. A pergunta acompanha os nomes e some, sem mandar nada, quando a sala acaba; o painel fecha quando adicionar deixa de valer. Testes: a Task 4 (`the question follows the room and closes when it ends` e `the add panel closes when the room fills up or you leave it`).
2. **A troca entre a videochamada e a sala:** a sala que nasce do Adicionar e a que volta a ser uma videochamada com um convidado só. A área do vídeo nunca mostra, nem por um instante, o último quadro da ligação de antes nem o último mosaico. Teste: a Task 4 (`the room's view never shows a frame of the call before it, nor the call after it a frame of the room`).
3. **Cinco convidados com nomes longos, ou só com o número, no Mínimo:** cada nome, estado, as iniciais e o Tirar da sala ficam dentro do quadro (o nome com as reticências, o Tirar da sala só com o ícone num quadro estreito), e a tela não rola. Teste: a Task 5 (`five guests with long names or only numbers fit their tiles in the three sizes`).
4. **O clique duplo de quem vem de um softphone de mesa** nos botões que tiram ou encerram: o segundo clique do Tirar da sala cai no Tirar do convidado que tomou o lugar, e o do Encerrar, na tela que fica. Sai um `salaTirar` só, ou um `salaEncerrar` só, e nada mais. Testes: a Task 5 (`a double click on Tirar da sala takes out only one guest`) e a Task 4 (`a double click on Encerrar ends the room once and sends nothing else`).
5. **A ligação de fora atendida no grande ou na tela cheia:** você fica fora da sala, só com a voz. A tela da ligação de fora, com a faixa "Você está fora da sala", aparece na hora, e a página pede a janela normal uma vez, em vez de um grande escuro sem o "Voltar para a sala". Teste: a Task 7 (`answering the outside call in the big window brings the call screen with the strip`).

## A ponte desta etapa
**Os comandos que a interface manda** (todos já existem no núcleo, da etapa 3a):
```json
{"v":1,"cmd":"salaAdicionar","numero":"2005"}
{"v":1,"cmd":"salaAdicionar","numero":"2007","contato":true}
{"v":1,"cmd":"salaTirar","id":12}
{"v":1,"cmd":"salaEncerrar"}
{"v":1,"cmd":"salaVoltar"}
```
- O `contato: true` vai só com o número de um contato escolhido na lista do painel, sem mudança depois (a regra do Transferir).
- Os de sempre, com a sala: o `mute`, o `camera` (a nossa câmera na sala), o `videoWindow`, o `answer` e o `reject` da ligação de fora (o `answer` sem o campo `video`), o `hangup` com o `id` da ligação de fora e o `swap` (o Alternar).

**O que a interface lê:**
- o `ligacao.sala`: o `id`, o `fora`, o `cheia` e os `participantes` (`id`, `numero`, `nome`, `estado`, `imagem`, `quadro`);
- a linha da sala: em `top` (você na sala) ou em `second` (você fora, a ligação de fora em cima), com o `id` da sala, o número e o nome vazios, o `activeSinceMs` (o tempo da sala), o `held` e o `video` (o `imagem` é o mosaico chegando ao `remoto`; o `camera`, a nossa câmera chegando aos convidados);
- o mosaico de quem montou na memória do `remoto`, com o id da sala (só com a sala em cima);
- o toast `<nome ou número>: <motivo>` de quem não entra (2 s, como hoje).

## Os textos (o texto exato)
- **Os botões:** `Adicionar pessoa`, `Adicionar`, `Cancelar`, `Tirar da sala`, `Encerrar`, `Voltar para a sala`, e os de hoje `Mudo`, `Câmera`, `Abrir grande`, `Alternar`, `Tela cheia`, `Sair da tela cheia`, `Diminuir` e `Desligar`.
- **O painel:** o título e o nome do campo `Adicionar à sala`; a ajuda `O app liga para a pessoa com vídeo. Ela entra na sala quando atender.`; o alto do painel `Em videochamada` (o `.eyebrow` o põe em maiúsculas).
- **A sala:**
  - `Sala de vídeo` e `<n> pessoas` (`1 pessoa` no singular), com `<n>` os convidados que atenderam (`naSala` ou `emEspera`) mais você;
  - o grupo `Mosaico da sala`, cada quadro com o nome do convidado (`nome`, ou o `numero` sem ele) e a imagem `Vídeo de <nome>`;
  - os estados `Chamando…`, `Sem vídeo` e `Em espera`;
  - `A sala já tem 6 pessoas.`
- **A pergunta:** `Encerrar a sala para todos?` e `As ligações com <nomes> vão desligar.`, com `<nomes>` como `Ana Souza e Carlos Lima` ou `Ana Souza, Carlos Lima e Bia Ramos`.
- **Fora da sala:** a faixa `Você está fora da sala`, com `<nomes> · <tempo>` embaixo e o `Voltar para a sala`.
- **As notas da versão:** o texto da Task 8.

## O desenho (as decisões desta etapa)
O quadro e a spec deixam estas escolhas abertas. Cada uma tem a escolha deste plano, e o relatório final as leva ao responsável:
1. **O Adicionar pessoa sem o destaque ciano.** O quadro Main o mostra com o fundo ciano, mas o Convidado (a mesma tela) e os da sala, não. O plano o deixa como os outros controles.
2. **O Encerrar em `#c23b3b`.** O branco no `#d64545` do quadro dá 4,38:1, abaixo dos 4,5:1 do axe para um texto de 15px. O `#c23b3b`, o vermelho do hover de hoje, dá 5,27:1.
3. **A sua imagem com o painel de adicionar aberto.** O quadro Adicionar não a mostra, mas a regra da 0.3.0 (spec 9) vale: ela flutua no canto, como hoje com os outros painéis.
4. **O Adicionar pessoa no grande** abre o painel à direita, com 360 de largura, como a conversa do Chat no grande (o quadro GrandeChat da etapa 2). O grande da videochamada de duas pessoas fica como está, sem o Adicionar pessoa (como no quadro).
5. **De volta à sala com a ligação de fora em espera** (o quadro não mostra): o cartão "Em espera" dela em cima, como hoje com duas ligações, e o Alternar entra nos controles da sala (o `swap` volta para quem ligou).
6. **A miniatura da faixa de fora da sala é um desenho dos quadros**, não a imagem ao vivo: fora da sala, o mosaico não vai ao `remoto` (a rota da 3a segue o `top.id`). Mostrar a imagem ao vivo pediria uma mudança no núcleo.
7. **Fora da sala, a janela volta ao normal:** atender a ligação de fora no grande ou na tela cheia mostra a tela da ligação com a faixa, e a página pede o `videoWindow` `normal` uma vez.
8. **O "<n> pessoas" conta quem atendeu e você** (os quadros SalaEstados e Sala); quem ainda está sendo chamado entra no limite (o `cheia`), mas não na conta.
9. **O nome no quadro fica no canto da imagem 4:3 encaixada nele** (a qualidade Média dos convidados). A página não sabe a proporção da imagem de cada um: numa imagem de outra proporção, o nome pode ficar na faixa em volta dela.

## As pastas e as responsabilidades
- **`windows/ui/src/state.ts`:** os tipos da sala e os quatro comandos.
- **`windows/ui/src/sala/estado.ts`:** a sala lida do estado (nula no iPhone), onde a linha dela está, a conta das pessoas, os nomes e as regras do Adicionar pessoa e da Câmera da sala.
- **`windows/ui/src/sala/textos.ts`:** os textos da sala.
- **`windows/ui/src/sala/mosaico.ts`:** a arrumação do núcleo em frações (a ponte falsa e os testes a usam) e a linha de baixo.
- **`windows/ui/src/sala/MosaicoDaSala.tsx`:** o mosaico com os quadros por cima, na tela da ligação e no grande.
- **`windows/ui/src/sala/TelaDaSala.tsx`:** a sala na tela da ligação.
- **`windows/ui/src/sala/PainelDeAdicionar.tsx`**, **`EncerrarSala.tsx`** e **`FaixaForaDaSala.tsx`:** o painel de adicionar, a pergunta do Desligar e a faixa de fora da sala.
- **`windows/ui/src/screens/controlesDaLigacao.tsx`** e **`PainelPorNome.tsx`:** o que sai do `Ligacao.tsx` sem mudar (o `NoWindows`, o `Ctrl`, o `RoundAction`, o `Avatar`, o `confirmada`, e o painel pelo nome).
- **`windows/ui/src/screens/Ligacao.tsx`**, **`src/video/Grande.tsx`**, **`src/main.tsx`**, **`src/components/VistaDeVideo.tsx`**, **`src/icons.tsx`** e **`src/app.css`:** o Adicionar pessoa, a sala no grande, as rotas, a vista decorativa, o ícone e o desenho.
- **`windows/ui/src/fake-sala.ts`**, **`fake.ts`** e **`fake-scenarios.ts`:** a sala na ponte falsa e os cenários dela.
- **`windows/ui/tests/sala/`:** os testes novos, com o ajudante `sala.ts`.
- **`tests/smoke/windows_smoke.py`** e **`tests/python/test_windows_smoke.py`:** a fumaça da sala.
- **`docs/ponte-windows.md`**, **`docs/teste-manual.md`**, **`docs/build-notes.md`** e **`notas/v0.4.0-rc.1.txt`:** a frase das telas da sala, o roteiro, os testes instáveis que ficarem e as notas.

## Como rodar os testes
- **A interface:**
  ```bash
  cd windows/ui && npm ci && npm run build
  NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test tests/sala
  ```
  A suíte inteira é o `npx playwright test`, com as mesmas variáveis. Um teste só é o caminho com a linha (`tests/video/ligacao.spec.ts:454`), e a repetição é o `--repeat-each=<n> --workers=<n>`.
- **Os scripts:** `python3 -m unittest discover -s tests/python`.
- **O código só do Windows** (a fumaça) é conferido pelo `build.yml`, no job "Windows (Win32, Release)"; o Android, pelo `android.yml`, no job "APK e emulador".
- **O CI:** `gh api "repos/LucasCPena/starsonic-phone/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'`. O `build` e o `android` (quando roda) precisam ficar verdes.
- **Os testes instáveis:** depois da Task 1, uma falha é investigada, não rodada de novo. Um que a Task 1 deixar anotado em `docs/build-notes.md` roda de novo uma vez, pelo REST, e o caso fica no relatório.

---

### Task 1: Os testes instáveis conhecidos

Vem primeiro: um teste do Playwright que falha pula o job do Windows inteiro (`docs/build-notes.md`, "needs: ui"), e esta etapa acrescenta muitos testes de tela.

**Files:**
- Modify (o que a causa pedir): `windows/ui/tests/chat/ligacao.spec.ts`, `windows/ui/tests/video/ligacao.spec.ts`, `windows/ui/tests/screens.spec.ts`, `android/app/src/androidTest/java/br/com/starsonic/phone/LoginScreenTest.kt`, e o código da tela se a causa estiver nele
- Modify (só se algum ficar): `docs/build-notes.md`

**Interfaces:**
- Consumes: os ajudantes de hoje (`tests/helpers.ts`; no Android, o `emulator.editableText(tag)` e o `emulator.waitForTheKeyboard(tag)` do `EmulatorSupport.kt`).
- Produces: nada novo.

- [ ] **Step 1: Junte as provas do CI.** Para cada teste, a mensagem da falha e o trace da tentativa que falhou, lidos fora do checkout (numa pasta de rascunho):
  - as execuções conhecidas (anotadas na etapa 3a):
    - `build` 43174383186 e 43204892724, tentativa 1: `tests/video/ligacao.spec.ts:454` (`the video problem notices stay 5 seconds, the others 2`);
    - `build` 43204892724, tentativa 1: `tests/screens.spec.ts:386` (`tema dark › Contatos searches, dials, adds, edits and removes`: "um comando da página não apareceu em 5 s");
    - `android` 43204892566, tentativa 1: `LoginScreenTest.emptyFieldsShowTheMessagesInOrder` ("Digite a senha." não apareceu em 20 s);
    - `tests/chat/ligacao.spec.ts:410` (`a double click on Chat opens the conversation, and its second click opens no photo and no file`): procure nas execuções do `build` com `conclusion` `failure` das branches `video-etapa-2` e `video-etapa-3`, no log do job "Interface (Playwright, Linux)";
  - os comandos:
    ```bash
    gh api "repos/LucasCPena/starsonic-phone/actions/runs/<run>/attempts/1/jobs" --jq '.jobs[] | "\(.id) \(.name) \(.conclusion)"'
    gh api "repos/LucasCPena/starsonic-phone/actions/jobs/<job>/logs" > <rascunho>/<job>.log
    gh api "repos/LucasCPena/starsonic-phone/actions/runs/<run>/artifacts" --jq '.artifacts[] | "\(.id) \(.name) \(.expired)"'
    gh api "repos/LucasCPena/starsonic-phone/actions/artifacts/<id>/zip" > <rascunho>/relatorio.zip
    ```
    O `relatorio-playwright` (só nas execuções que falharam) traz o `test-results/saida/**/trace.zip` do teste; o `unzip -p trace.zip trace.trace` dá um JSON por linha, com as ações, o console e a rede. A lista de execuções é o `gh api "repos/LucasCPena/starsonic-phone/actions/workflows/build.yml/runs?branch=<branch>&status=failure&per_page=50"`.
  - O relatório da Task diz, para cada um, a linha que falhou, a espera que acabou e o que a página tinha.
- [ ] **Step 2: Reproduza.** `npx playwright test <arquivo>:<linha> --repeat-each=100 --workers=4`, e de novo com `--workers=8` (mais do que os CPUs: o runner ocupado). O do chat sobe o servidor do chat pelo `global-setup`. Anote a taxa de falha de cada um.
- [ ] **Step 3: Conserte a causa.** O teste passa a esperar o que ele usa: nunca uma espera maior, um `retries`, um `test.fixme` ou um `skip`. As hipóteses da leitura do código, para conferir primeiro:
  - **`tests/chat/ligacao.spec.ts:410`:** o `embaixo` é lido quando a conversa acaba de aparecer, com as mensagens e as miniaturas ainda chegando e a lista descendo até o fim (o `Conversa.tsx`: "a cada desenho que muda a lista ou uma miniatura … o fim à vista"). Antes de ler o ponto embaixo do Chat, espere as 8 fotos (ou os 8 arquivos) na conversa, cada `img` dela carregada (`complete` e `naturalWidth > 0`) e o `scrollTop` da lista igual em dois quadros de tela seguidos.
  - **`tests/video/ligacao.spec.ts:454`:** o tempo do toast é armado num `useEffect` do `main.tsx`, que o Preact roda depois da pintura (o `requestAnimationFrame`, ou os 100 ms de reserva, no relógio parado). Confira no trace qual `expect` falhou e em que hora do relógio; se o tempo do toast começa depois de o toast aparecer, o conserto é armá-lo junto com o `setToast`, quando a mensagem chega (os 5 s e os 2 s contam da chegada, como diz a etapa 2).
  - **`tests/screens.spec.ts:386`:** ache no log qual comando não saiu (o `dial` do clique na linha da Ana, o do "Ligar para Carlos Lima", um `saveContact` ou o `removeContact`) e o que o trace mostra embaixo do ponteiro nesse clique.
  - **`LoginScreenTest.emptyFieldsShowTheMessagesInOrder`:** o Entrar tocado enquanto o teclado do celular muda (o campo Ramal abre o teclado de números, de outra altura, e a tela anda com ele): o caso conhecido do `waitForTheKeyboard` (o run 40477577855). Antes de cada `clickEntrar()` que vem depois de um `type`, espere o campo com o texto (`emulator.editableText(tag) == texto`) e o `emulator.waitForTheKeyboard("entrar")`.
- [ ] **Step 4: Confira.** Cada teste da interface consertado passa no `--repeat-each=100 --workers=8`, e a suíte inteira passa. O do Android: o job "APK e emulador" verde três vezes seguidas (o push e duas novas tentativas do job: `gh api -X POST "repos/LucasCPena/starsonic-phone/actions/jobs/<job>/rerun"`).
- [ ] **Step 5: O que fica.** Um teste cuja causa as provas e 300 rodadas locais não mostram fica como está, com:
  - um comentário em cima dele: o que foi visto e o que foi descartado;
  - uma linha em `docs/build-notes.md`, numa seção nova "## Os testes instáveis conhecidos": o teste, as execuções em que falhou, a mensagem, o que foi tentado e a regra (uma nova tentativa pelo REST por falha, anotada no relatório).
- [ ] **Step 6: Faça o commit e o push.** A mensagem diz a causa de cada um, por exemplo `test: o Chat da ligação espera a conversa parar, e o Entrar do Android espera o teclado`. O CI fica verde.

### Task 2: Os tipos, as regras e a ponte falsa da sala

**Files:**
- Modify: `windows/ui/src/state.ts`
- Create: `windows/ui/src/sala/estado.ts`, `windows/ui/src/sala/textos.ts`, `windows/ui/src/sala/mosaico.ts`, `windows/ui/src/fake-sala.ts`
- Modify: `windows/ui/src/fake.ts`, `windows/ui/src/fake-scenarios.ts`, `docs/ponte-windows.md`
- Create: `windows/ui/tests/sala/sala.ts`, `windows/ui/tests/sala/regras.spec.ts`, `windows/ui/tests/sala/ponte-falsa.spec.ts`

**Interfaces:**
- Produces (`state.ts`):
  ```ts
  /** (0.4.0) O estado de um convidado na sala. */
  export type EstadoNaSala = 'chamando' | 'naSala' | 'emEspera';
  /** (0.4.0) O quadro do convidado no mosaico do `remoto`, em frações de 0 a 1 da imagem. */
  export interface QuadroDaSala { x: number; y: number; largura: number; altura: number }
  export interface ParticipanteDaSala { id: number; numero: string; nome: string; estado: EstadoNaSala; imagem: boolean; quadro: QuadroDaSala }
  /** (0.4.0) A sala de vídeo em grupo (docs/ponte-windows.md, "O ligacao.sala"). */
  export interface SalaDaLigacao { id: number; fora: boolean; cheia: boolean; participantes: ParticipanteDaSala[] }
  // CallState ganha `sala?: SalaDaLigacao | null` (sempre vem do núcleo; o `?` protege o estado montado à mão nos testes de antes).
  // Command ganha:
  | { cmd: 'salaAdicionar'; numero: string; contato?: boolean }
  | { cmd: 'salaTirar'; id: number }
  | { cmd: 'salaEncerrar' }
  | { cmd: 'salaVoltar' }
  ```
- Produces (`sala/estado.ts`):
  ```ts
  export function salaDe(state: AppState): SalaDaLigacao | null;              // null no iPhone, sem ligação ou sem sala
  export function salaEmCima(l: CallState, sala: SalaDaLigacao | null): boolean;   // l.top.id === sala.id
  export function salaEmbaixo(l: CallState, sala: SalaDaLigacao | null): boolean;  // l.second?.id === sala.id
  export function foraDaSala(l: CallState, sala: SalaDaLigacao | null): boolean;   // embaixo, ou em cima com o held
  export function pessoasNaSala(sala: SalaDaLigacao): number;                 // os naSala e os emEspera, mais você
  export function nomeNaSala(p: ParticipanteDaSala): string;                  // o nome, ou o número
  export function nomesDaSala(sala: SalaDaLigacao): string;                   // "A", "A e B", "A, B e C"
  export function mostraAdicionar(state: AppState, l: CallState): boolean;
  export function podeAdicionar(state: AppState, l: CallState): boolean;
  export function cameraDaSalaDesativada(linha: CallCard, video: CallVideo): boolean;   // !video.camera && linha.held
  ```
  - O `mostraAdicionar`: fora do iPhone, com a sala em cima, ou sem sala, com o `video.ligado` do app e o `video.ativo` da de cima.
  - O `podeAdicionar`, com a sala em cima: sem o `held` da linha dela, sem o `fora` e sem o `cheia`. Sem sala: o `mostraAdicionar`, sem a segunda, fora da conferência e da consulta, e a de cima em andamento (`phase` `active` e `activeSinceMs > 0`) e fora da espera. Com a sala embaixo, nunca.
- Produces (`sala/textos.ts`), um nome por texto de "Os textos": `ADICIONAR_PESSOA`, `ADICIONAR`, `ADICIONAR_A_SALA`, `AJUDA_DE_ADICIONAR`, `EM_VIDEOCHAMADA`, `SALA_DE_VIDEO`, `MOSAICO_DA_SALA`, `TIRAR_DA_SALA`, `CHAMANDO`, `SEM_VIDEO_NA_SALA`, `EM_ESPERA_NA_SALA`, `SALA_CHEIA`, `ENCERRAR_A_SALA`, `ENCERRAR`, `FORA_DA_SALA` e `VOLTAR_PARA_A_SALA`, e as funções `pessoas(n: number)` e `ligacoesVaoDesligar(nomes: string)`.
- Produces (`sala/mosaico.ts`):
  ```ts
  export const LARGURA_DO_MOSAICO = 1280;
  export const ALTURA_DO_MOSAICO = 720;
  /** Os quadros de n convidados (1 a 5), em frações: o MosaicCells(n, 1280, 720) e o UnitTile do RoomMosaic.cpp. [] fora de 1 a 5. */
  export function arrumacao(n: number): QuadroDaSala[];
  /** O quadro na linha de baixo de um mosaico de duas linhas (3 a 5 convidados). */
  export function naLinhaDeBaixo(q: QuadroDaSala): boolean;   // q.y > 0
  ```
  O `arrumacao` faz a conta do `MosaicCells` (`starsonic/phone/RoomMosaic.cpp`): 1 por linha com 1 convidado, 2 com 2 a 4 e 3 com 5, as células iguais em pixels pares (o `& ~1`), a linha incompleta no centro, e cada uma dividida por 1280 e 720.
- Produces (`fake-sala.ts`):
  ```ts
  export interface DependenciasDaSalaFalsa {
    estado(): AppState;
    mudarLigacao(l: CallState | null): void;   // o setCall do fake.ts
    toast(texto: string): void;
    novoId(): number;                           // o ++proximoId do fake.ts
  }
  /** Os comandos da sala e os de sempre com a sala de pé (hangup, answer, swap e hold); true quando tratou. */
  export function criarSalaFalsa(d: DependenciasDaSalaFalsa): { comando(command: Record<string, unknown>): boolean };
  /** O `fora` (a linha da sala embaixo, ou em cima com o held) e o `cheia` (5 convidados) de acordo com a ligação. */
  export function acertarSala(l: CallState): CallState;
  ```
- Produces (os cenários, também no `SCENARIO_NAMES`), com o `ID_DA_SALA` 30 e os convidados Ana Souza (11, `2003`), Carlos Lima (12, `2007`), Bia Ramos (13, `2005`), Davi Nunes (14, `2006`) e Elisa Prado (15, `2008`); a ligação de fora é o Roberto Lima (16, `2012`). A linha da sala tem o número e o nome vazios e o `video` `{oferece: false, ativo: true, imagem: true, camera: true, cedo: false, porteiro: false}`:
  - `sala`: a Ana e o Carlos `naSala`, com imagem, há 5 min 41 s;
  - `sala-estados`: a Ana `naSala` com imagem, o Carlos `chamando`, a Bia `naSala` sem imagem e o Davi `emEspera`, há 8 min 20 s;
  - `sala-cheia`: os cinco `naSala` com imagem, `cheia`, há 12 min 5 s;
  - `sala-ligacao-de-fora`: a `sala`, há 6 min 58 s, com o Roberto tocando como a `second` (`secondKind` `ringing`) e o toque `espera`;
  - `sala-fora`: o Roberto em cima, há 42 s, só com voz, e a linha da sala como a `second` (`held`, `secondKind` `held`), há 7 min 12 s, com o `fora`;
  - `sala-de-volta`: a sala em cima, há 7 min 30 s, com o Roberto em espera como a `second`, há 1 min 5 s;
  - `sala-grande`: a Ana, o Carlos e a Bia `naSala`, com imagem, há 9 min 12 s, com a `janela` `grande`;
  - `sala-convidado`: o que o convidado vê, a conta da Ana Souza (2003) numa videochamada com a Recepção (id 11, `2001`), há 5 min 41 s, com `{ativo: true, imagem: true, camera: true}`.

  O `ligacao()` dos cenários passa a pôr o `sala: null`, e o `estadoDoIphone` põe o `ligacao.sala` em `null`.
- Produces (`tests/sala/sala.ts`):
  ```ts
  export const VERDE: [number, number, number] = [145, 54, 34];    // vira [0, 255, 1]
  export const AZUL: [number, number, number] = [41, 240, 110];    // vira [0, 0, 255]
  export const AMARELO: [number, number, number] = [210, 16, 146]; // vira [255, 255, 0]
  /** O RGB de cada cor do video.ts e daqui (o i420ParaRgb). */
  export const RGB: Record<'VERMELHO' | 'BRANCO' | 'VERDE' | 'AZUL' | 'AMARELO', [number, number, number]>;
  /** Grava no `remoto` um mosaico: o fundo do núcleo (Y 21, U 132, V 127) e cada quadro inteiro numa cor. */
  export async function mosaico(page: Page, quadros: Array<{ quadro: QuadroDaSala; cor: [number, number, number] }>, largura = 1280, altura = 720): Promise<void>;
  /** O mosaico da sala de agora (o estado da ponte falsa): os convidados naSala com imagem nas cores BRANCO, VERDE, AZUL, AMARELO e VERMELHO, na ordem; os outros com o fundo. */
  export async function mosaicoDaSala(page: Page): Promise<void>;
  export const quadroDe = (page: Page, nome: string) => page.getByRole('group', { name: nome, exact: true });
  export const imagemDe = (page: Page, nome: string) => page.getByRole('img', { name: `Vídeo de ${nome}`, exact: true });
  ```
  O `mosaico` monta os planos dentro da página e grava pelo `__fake.quadro('remoto', …)`, como o `quadro` do `tests/video/video.ts` (espera a vista com o `data-memoria`). Os testes da sala usam também o `quadro`, o `corNoMeio`, o `corNoPonto`, o `perto`, o `VERMELHO`, o `BRANCO` e o `FUNDO` do `tests/video/video.ts`: o fundo do mosaico (Y 21, U 132, V 127) vira [4, 5, 14], a 1 do `FUNDO` (o #04060e).

- [ ] **Step 1: Escreva os testes que falham.**
  - No `regras.spec.ts` (roda no Node e importa `../../src/sala/estado` e `../../src/sala/mosaico`):
    - `arrumacao follows the core's MosaicCells`:
      - 1: `[{x: 0, y: 0, largura: 1, altura: 1}]`;
      - 2: `{0, 0, 0.5, 1}` e `{0.5, 0, 0.5, 1}`;
      - 3: `{0, 0, 0.5, 0.5}`, `{0.5, 0, 0.5, 0.5}` e `{0.25, 0.5, 0.5, 0.5}`;
      - 4: a grade de 2×2, com 0,5 cada;
      - 5: `{0, 0, 0.3328125, 0.5}`, `{0.3328125, 0, 0.3328125, 0.5}`, `{0.665625, 0, 0.3328125, 0.5}`, `{0.1671875, 0.5, 0.3328125, 0.5}` e `{0.5, 0.5, 0.3328125, 0.5}`;
      - 0 e 6 dão `[]`; o `naLinhaDeBaixo` só é verdadeiro nos de `y` 0,5.
    - `salaDe is null on the iPhone, without a call and without a room`.
    - `the room line on top, below and out`: o `salaEmCima`, o `salaEmbaixo` e o `foraDaSala` com a sala em cima, em cima com o `held`, embaixo e sem sala.
    - `pessoasNaSala counts who answered and you`: dois `naSala` dão 3; `naSala`, `chamando`, `naSala` sem imagem e `emEspera` dão 4. O `pessoas(1)` é `1 pessoa`, e o `pessoas(6)`, `6 pessoas`.
    - `nomesDaSala joins the names like the question`: `Ana Souza e Carlos Lima`; `Ana Souza, Carlos Lima e Bia Ramos`; um convidado sem nome entra com o número.
    - `Adicionar pessoa shows in a lone video call and in the room on top, and waits for what the core needs`: o `mostraAdicionar` e o `podeAdicionar` em cada caso do Interfaces (a de cima chamando, em espera, com a segunda, na conferência, na consulta, só de voz, com o `video.ligado` desligado, no iPhone; a sala em cima, em cima com o `held`, com o `fora`, com o `cheia` e embaixo).
    - `the room's Câmera only waits while the room is held`.
  - No `ponte-falsa.spec.ts` (a página, com o `__fake.mandar` e o `estado` do `tests/helpers.ts`):
    - `the fake core carries the room like the core`: no `?fake=sala`, o `ligacao.top` é a linha da sala (`id` 30, o número e o nome vazios, `phase` `active`, o `video` acima) e o `ligacao.sala` é `{id: 30, fora: false, cheia: false, participantes: [Ana {id: 11, numero: '2003', nome: 'Ana Souza', estado: 'naSala', imagem: true, quadro: arrumacao(2)[0]}, Carlos {…, quadro: arrumacao(2)[1]}]}`. No `?fake=video`, o `ligacao.sala` é `null`.
    - `salaAdicionar from a video call starts the room with the call inside`: no `?fake=video`, o `salaAdicionar` com `2007` e `contato: true` põe em cima a linha da sala (o id 41, com o `activeSinceMs` da ligação da Ana) e os participantes `[Ana (11, naSala, imagem), Carlos (42, '2007', 'Carlos Lima', chamando, sem imagem)]`, com a `arrumacao(2)`. Em até 3 s (o `expect.poll`), o Carlos fica `naSala`, com imagem.
    - `the room grows to five and fills up`: no `?fake=sala`, `2005`, `2006` e `2008` dão 5 participantes, na ordem, com a `arrumacao(5)` e o `cheia`. Um sexto `salaAdicionar` não muda nada.
    - `salaAdicionar does nothing out of the rules`: no `?fake=principal` (sem ligação), no `?fake=ligacao` (só voz), no `?fake=sala-fora` e no `?fake=sala-cheia`.
    - `salaTirar takes the guest out, and with one guest left the room is a call again`: no `?fake=sala`, o `salaTirar` com 12 deixa em cima a ligação da Ana (o id 11, `2003`, `Ana Souza`, `active`, com o `video.imagem` e o `camera` da sala) e o `ligacao.sala` em `null`.
    - `salaEncerrar and the hangup of the room line end the room`: no `?fake=sala`, o `salaEncerrar` deixa o `ligacao` em `null`. No `?fake=sala-de-volta`, o `hangup` com o id 30 deixa o Roberto sozinho em cima, fora da espera, sem sala.
    - `the outside call: answer takes you out, salaVoltar brings you back with it on hold, swap and its end`: no `?fake=sala-ligacao-de-fora`:
      - o `answer` põe o Roberto em cima, `active` e só com voz, a linha da sala como a `second` em espera e o `sala.fora` em `true`;
      - o `salaVoltar` põe a sala em cima e o Roberto em espera (`secondKind` `held`), com o `fora` em `false`;
      - o `swap` tira você de novo, e o `hangup` do Roberto (o id 16) traz a sala de volta, sozinha e sem o `fora`.
    - `a guest who only rings or is busy`: o `180` fica `chamando` depois de 3 s; o `486` sai da lista em até 3 s, com o toast `486: Ocupado`.
    - `the iPhone fake has no room`: no `?fake=sala&plataforma=ios`, o `ligacao.sala` é `null`, e os quatro comandos não mudam nada.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/regras.spec.ts tests/sala/ponte-falsa.spec.ts` falha: os módulos não existem e os cenários são desconhecidos.
- [ ] **Step 3: Implemente.**
  - **O `fake-sala.ts`** segue o "A sala de vídeo (0.4.0)" da ponte, no que a tela vê:
    - o `salaAdicionar` vale nas regras do `podeAdicionar` (a ligação de cima do estado). O nome é o do contato com esse número, ou `""`. Sem sala, a sala nasce no lugar da ligação de cima, com ela como o primeiro convidado. O convidado novo entra `chamando`, sem imagem, e a arrumação de todos (também os chamados) é refeita;
    - os números da ponte falsa: o `180` só toca; o `486` sai em 1,5 s, com o toast `<nome ou número>: Ocupado`; os outros atendem em 1,5 s, `naSala`, com imagem;
    - o `salaTirar` e o fim de um convidado refazem a arrumação. Com um convidado só (contando os chamados), a sala acaba: ele volta a ser a ligação, no lugar da linha da sala (em cima, ou em espera embaixo), com o id, o número, o nome e a imagem dele e a câmera da sala;
    - o `salaEncerrar`, e o `hangup` sem `id` ou com o `id` da sala, acabam a sala: a ligação de fora, se há, fica sozinha em cima, fora da espera; sem ela, o `ligacao` fica `null`;
    - a ligação de fora: o `answer` dela (a sala em cima e ela tocando) a põe em cima só com voz e a sala embaixo em espera; o `salaVoltar`, o `swap` e o `hold` (com ela em cima e a sala embaixo) trocam as duas; o `hangup` dela traz a sala de volta;
    - fora da sala, nada de `salaAdicionar`. No iPhone, nenhum dos quatro.
  - **O `fake.ts`:**
    - cria a sala falsa com o estado, o `setCall`, o `toast` e o `++proximoId`;
    - o `handleCall` passa cada comando antes por ela;
    - o `setCall` passa a ligação com sala pelo `acertarSala`.
  - **O `docs/ponte-windows.md`:** no começo da "A sala de vídeo (0.4.0)", a frase "As telas da sala e a ponte falsa delas … seguem na etapa 3b: até lá, a interface não usa os comandos nem o `ligacao.sala` abaixo." vira "A interface desenha a sala (`windows/ui/src/sala/`) com estes comandos e o `ligacao.sala`, e a ponte falsa dos testes (`windows/ui/src/fake-sala.ts`) os imita."
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos passam, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): os tipos, as regras e a ponte falsa da sala`. O CI fica verde.

### Task 3: O Adicionar pessoa na videochamada

**Files:**
- Create: `windows/ui/src/screens/controlesDaLigacao.tsx`, `windows/ui/src/screens/PainelPorNome.tsx`, `windows/ui/src/sala/PainelDeAdicionar.tsx`
- Modify: `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/icons.tsx`, `windows/ui/src/app.css`
- Modify: `windows/ui/tests/video/ligacao.spec.ts` (as linhas 179 e 180) e `windows/ui/tests/chat/ligacao.spec.ts` (as 135 e 136): as listas dos controles com o Adicionar pessoa
- Create: `windows/ui/tests/sala/adicionar.spec.ts`

**Interfaces:**
- Consumes (Task 2): o `mostraAdicionar`, o `podeAdicionar` e os textos.
- Produces (`controlesDaLigacao.tsx`): o `NoWindows`, o `Ctrl` (e o `CtrlProps`), o `RoundAction`, o `Avatar` e o `confirmada` saem do `Ligacao.tsx` sem mudar, exportados. O `Ctrl` ganha o `descritoPor?: string` (o `aria-describedby`).
- Produces (`PainelPorNome.tsx`): o `PainelProps` e o `PainelPorNome` (com a lista em pedaços, os ids das linhas e o `linhaDoPainel`) saem do `Ligacao.tsx`, com duas mudanças:
  ```ts
  // PainelProps:
  onEnter: ((numero: string, doContato: boolean) => void) | null;   // o doContato: o número é o de um contato escolhido, sem mudança depois
  ajuda?: string;   // um <p class="call-ajuda"> depois do status (13px, #b9c4e6, linha 1,5)
  ```
  A Nova ligação ignora o `doContato`, e o `NumberPanel` do iPhone passa o `daSugestao`.
- Produces (`sala/PainelDeAdicionar.tsx`):
  ```tsx
  export function PainelDeAdicionar(props: { lista: Linha[]; onAdicionar(numero: string, doContato: boolean): void; onCancel(): void }): VNode;
  ```
  É o `PainelPorNome` com o título e o nome do campo `Adicionar à sala`, o `onContact` nulo (o escolhido vai para o campo, com o "Para:", como no Transferir), a ajuda, o Enter que adiciona (o `onEnter`) e um botão só, o `Adicionar` (`btn btn-cyan`, desligado sem número).
- Produces (`icons.tsx`): o `IconAdicionarPessoa`, com `<circle cx="9" cy="8" r="3.5"/>`, `<path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>` e `<path d="M19 8v6M16 11h6"/>`.
- Produces (`Ligacao.tsx`): o `Painel` ganha o `'adicionar'`.

- [ ] **Step 1: Escreva os testes que falham.** No `adicionar.spec.ts`:
  - `a video call has Adicionar pessoa after Câmera`: no `?fake=video`, os `.ctrls > *` são `Mudo`, `Câmera`, `Adicionar pessoa`, `Teclado`, `Áudio`, `Espera`, `Transferir`, `Nova ligação` e `Atalhos`, na grade `ctrls-5`. O Adicionar pessoa não tem o `ctrl-on`.
  - `Adicionar pessoa opens the panel and Adicionar sends salaAdicionar once`:
    - o clique mostra o alto do painel, com `Em videochamada` no `.eyebrow`, `Ana Souza` e `Ramal 2003`, e o campo `Adicionar à sala` com o foco;
    - a ajuda está à vista, e o `Adicionar` fica desligado;
    - com `2010`, um clique duplo no `Adicionar` manda `{cmd: 'salaAdicionar', numero: '2010'}` uma vez só (o `vezes`), e o painel fecha.
  - `a chosen contact goes with contato, also by Enter`:
    - `car`, a seta para baixo e o Enter mostram `Para: Carlos Lima · 2007`, e outro Enter manda `{cmd: 'salaAdicionar', numero: '2007', contato: true}`;
    - num painel novo, o Carlos escolhido e um `8` digitado depois mandam `{cmd: 'salaAdicionar', numero: '20078'}`, sem o `contato`.
  - `letters without a choice add nobody, and Esc and Cancelar close the panel`: `xyz` mostra `Nenhum contato com esse nome`, o `Adicionar` fica desligado e o Enter não manda nada. O Esc fecha o painel, e o `Cancelar` também. Nenhum `salaAdicionar` sai.
  - `no Adicionar pessoa without video, with two calls, ringing or on the iPhone`: não há o botão no `?fake=ligacao`, no `?fake=video` com o `video.ativo` em `false` (o `mudarEstado`), no `?fake=duas-ligacoes`, no `?fake=conferencia`, no `?fake=video-tocando` e no `?fake=video&plataforma=ios`.
  - `Adicionar pessoa waits for the answered call out of hold`: com o `activeSinceMs` 0, e depois com o `held`, ele fica desativado.
  - `the panel closes when adding stops being possible`: com o painel aberto, a segunda ligação tocando fecha o painel (o cartão `Ligação de Carlos Lima` aparece), e o `video.ativo` em `false` também.
  - `your image stays in sight with the panel open`: com a câmera ligada, a `Sua imagem` fica visível e inteira na janela com o painel aberto.
  - `the panel fits the three sizes`: em 400×720, 360×600 e 300×440, o campo, o `Adicionar`, o `Cancelar` e o Desligar ficam inteiros na janela, a página não rola, e com `car` digitado pelo menos uma linha de contato fica à vista.
  - `the video call controls fit the three sizes with Adicionar pessoa`: no `?fake=video`, em 400×720, 360×600 e 300×440, cada `.ctrls button.ctrl` fica inteiro na janela, nenhum tem o `scrollWidth` maior que o `clientWidth` (o `Adicionar pessoa` quebra em duas linhas, como o `Nova ligação`), a área do vídeo passa de 100 de altura e a página não rola.
  - As listas de hoje: o `tests/video/ligacao.spec.ts` passa a esperar os nove controles acima em `ctrls-5`, e o `tests/chat/ligacao.spec.ts`, os dez com o `Chat` depois do Adicionar pessoa (`Mudo`, `Câmera`, `Adicionar pessoa`, `Chat`, `Teclado`, `Áudio`, `Espera`, `Transferir`, `Nova ligação` e `Atalhos`), em `ctrls-5`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/adicionar.spec.ts tests/video/ligacao.spec.ts` falha: não há o Adicionar pessoa.
- [ ] **Step 3: Implemente, como nos quadros Main e Adicionar.**
  - **A mudança de lugar:** os do `controlesDaLigacao.tsx` e do `PainelPorNome.tsx` saem do `Ligacao.tsx` sem mudar o desenho nem o comportamento; o `Ligacao.tsx` os importa. A suíte de hoje (o `busca-pelo-nome.spec.ts` e o `busca-pelo-nome-lista-grande.spec.ts`) continua verde sem mudança.
  - **O controle:** o `Adicionar pessoa` (o `IconAdicionarPessoa`) vem depois da Câmera nos controles de uma ligação, com o `mostraAdicionar`, desativado sem o `podeAdicionar`. O Chat vem depois dele.
  - **O painel:** o `painelPedido` `'adicionar'` vale enquanto o `podeAdicionar` vale. O meio é o `PainelDeAdicionar`, com a `listaDeContatos(contatos, daEmpresa).todas`. O `Adicionar` manda o `salaAdicionar` (com o `contato: true` do `doContato`) e fecha o painel.
  - **O alto do painel** (o `who-compact` de hoje) diz `Em videochamada` no `.eyebrow` com o painel de adicionar.
  - **A sua imagem** flutua no canto com o painel aberto, como hoje com os outros painéis.
- [ ] **Step 4: Rode e veja passar.** Os arquivos, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o Adicionar pessoa na videochamada`. O CI fica verde.

### Task 4: A sala na tela da ligação e a pergunta do Desligar

**Files:**
- Create: `windows/ui/src/sala/MosaicoDaSala.tsx`, `windows/ui/src/sala/TelaDaSala.tsx`, `windows/ui/src/sala/EncerrarSala.tsx`
- Modify: `windows/ui/src/main.tsx`, `windows/ui/src/components/VistaDeVideo.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/sala/sala.spec.ts`, `windows/ui/tests/sala/encerrar.spec.ts`

**Interfaces:**
- Consumes (Tasks 2 e 3): as regras, os textos, a `arrumacao`, o `PainelDeAdicionar`, o `Ctrl`, o `RoundAction`, o `NoWindows` e os ajudantes do `tests/sala/sala.ts`.
- Produces:
  ```tsx
  // VistaDeVideo: com `decorativa`, aria-hidden="true", sem o role e sem o aria-label (o data-vista e o data-memoria ficam).
  export function VistaDeVideo(props: { …; decorativa?: boolean }): VNode;
  // A linha da sala é a `linha` (o top ou o second de agora).
  export function MosaicoDaSala(props: { state: AppState; sala: SalaDaLigacao; linha: CallCard; send: Send; modo: 'ligacao' | 'grande' | 'telaCheia' }): VNode;
  export function TelaDaSala(props: { state: AppState; ligacao: CallState; sala: SalaDaLigacao; contatos: Contact[]; daEmpresa: CompanyContact[]; send: Send }): VNode;
  // O Encerrar manda o salaEncerrar; o Cancelar e o Esc fecham o diálogo (o close() antes, para o foco voltar ao Desligar).
  export function EncerrarSala(props: { sala: SalaDaLigacao; send: Send; onFechar(): void }): VNode;
  ```

- [ ] **Step 1: Escreva os testes que falham.**
  - No `sala.spec.ts`:
    - `the room shows the mosaic with each name on its tile, your image and the room's controls` (`?fake=sala`):
      - o `main` `Sala de vídeo`, o grupo `Mosaico da sala`, e dentro dele os grupos `Ana Souza` e `Carlos Lima`, cada um com a imagem `Vídeo de <nome>` e o nome à vista;
      - `Sala de vídeo` e um texto como `/^3 pessoas · 05:4\d$/`;
      - os controles `Mudo`, `Câmera`, `Adicionar pessoa` e `Abrir grande`, em `ctrls-4`, e o Desligar;
      - a `Sua imagem` dentro da área do vídeo, e sai `{cmd: 'videoViews', pagina: 'principal', vistas: ['local', 'remoto']}`.
    - `each name sits on its guest's image, in the three sizes`: com o `mosaicoDaSala`, o meio de cada `Vídeo de <nome>` fica `perto` do RGB da cor dele, e um ponto da área 5 px abaixo da borda de cima fica `perto` do `FUNDO`. Em 400×720, 360×600 e 300×440, nos dois temas (o `colorScheme`), e depois de mudar o tamanho da janela com a sala aberta.
    - `the tiles show Chamando…, Sem vídeo and Em espera with the initials` (`?fake=sala-estados`): o quadro do Carlos tem `CL` e `Chamando…`, o da Bia, `BR` e `Sem vídeo`, e o do Davi, `DN` e `Em espera`; o da Ana tem a imagem. A conta é `4 pessoas`. Um convidado sem nome mostra o número e o ícone do telefone no lugar das iniciais.
    - `a full room disables Adicionar pessoa and says why` (`?fake=sala-cheia`): o `Adicionar pessoa` fica desativado e descrito por `A sala já tem 6 pessoas.` (o `toHaveAccessibleDescription`); a conta é `6 pessoas`; os cinco quadros ficam nas posições da `arrumacao(5)`.
    - `Adicionar pessoa in the room opens the panel, and the new guest is called`: no `?fake=sala`, o alto do painel tem `Em videochamada`, `Sala de vídeo` e `3 pessoas`; o `2005` e o `Adicionar` mandam `{cmd: 'salaAdicionar', numero: '2005'}`; o painel fecha e o quadro `2005` aparece com `Chamando…`, e depois com a imagem e `4 pessoas`.
    - `the add panel closes when the room fills up or you leave it` (Review Focus 1): com o painel aberto, o `cheia` (o `mudarEstado`) fecha o painel; com ele aberto de novo, a sala embaixo (o Roberto em cima, a sala em espera com o `fora`) tira a tela da sala, e a sala de volta em cima vem sem o painel.
    - `a video call becomes the room after Adicionar, and back to the call with one guest left`: no `?fake=video`, o Adicionar pessoa com o Carlos (`car`, a seta, o Enter e o `Adicionar`) mostra a sala com a Ana e o Carlos (`Chamando…`, e depois a imagem). O `{cmd: 'salaTirar', id: 42}` (o `__fake.mandar`) volta à videochamada com a Ana: a `Vídeo de Ana Souza` grande e o `Ramal 2003`.
    - `the room's view never shows a frame of the call before it, nor the call after it a frame of the room` (Review Focus 2):
      - no `?fake=video`, um quadro `VERMELHO` no `remoto`;
      - o Adicionar pessoa com o `2007`: na sala, o meio da `Vídeo de Ana Souza` fica `perto` do `FUNDO`, mesmo com o vermelho ainda na memória; com o `mosaicoDaSala`, ele fica branco;
      - o `salaTirar` do Carlos: de volta à videochamada, o meio da `Vídeo de Ana Souza` fica `perto` do `FUNDO`; um quadro `VERDE` o deixa verde.
    - `the room's Câmera and Abrir grande`: a Câmera manda `{cmd: 'camera', on: false}`, e a `Sua imagem` sai; de novo, `{cmd: 'camera', on: true}`. O `Abrir grande` manda `{cmd: 'videoWindow', modo: 'grande'}`.
    - `a guest who does not answer leaves with the reason`: no `?fake=sala`, o `486` aparece com `Chamando…` e sai em até 3 s, com o toast `486: Ocupado`; os outros quadros voltam à `arrumacao(2)`.
    - `the room screen fits the three sizes`: em 400×720, 360×600 e 300×440, a página não rola, cada botão fica inteiro na janela, o grupo `Mosaico da sala` fica dentro da área do vídeo, com a largura 16/9 da altura (± 1). No 300×440, os quatro controles e o Desligar ficam numa fila (o meio de cada um na mesma altura, ± 1), e a conta é uma linha só (`/^Sala de vídeo · 3 pessoas · 05:4\d$/`).
    - `on the iPhone nothing of the room shows`: no `?fake=video&plataforma=ios`, um estado com o `ligacao.sala` e a linha da sala em cima (o `mudarEstado`) não mostra `Sala de vídeo`, `Mosaico da sala` nem `Adicionar pessoa`, e o Desligar manda o `hangup` de sempre.
  - No `encerrar.spec.ts`:
    - `Desligar asks Encerrar a sala para todos? with the names, and Encerrar ends the room` (`?fake=sala`): o Desligar abre o `alertdialog` `Encerrar a sala para todos?`, descrito por `As ligações com Ana Souza e Carlos Lima vão desligar.`; o `Encerrar` manda `{cmd: 'salaEncerrar'}` uma vez, nenhum `hangup` sai, e a tela volta ao Teclado.
    - `Cancelar and Esc keep the room and send nothing`: o `Cancelar` fecha, e o foco volta ao Desligar; o Esc também. Nenhum comando novo sai.
    - `the question follows the room and closes when it ends` (Review Focus 1): com a pergunta aberta, a Bia que entra (o `mudarEstado`) muda o texto para `As ligações com Ana Souza, Carlos Lima e Bia Ramos vão desligar.`; a sala que acaba sozinha (a Ana de volta como a ligação, o `sala` em `null`) fecha a pergunta, sem nenhum `salaEncerrar`.
    - `a double click on Encerrar ends the room once and sends nothing else` (Review Focus 4): o primeiro clique no `Encerrar` acaba a sala; o segundo par, com o `clickCount` 2, no mesmo ponto, cai na tela que ficou. Sai um `salaEncerrar` só, e nenhum `dial`, `dtmf` ou outro comando depois dele.
    - `the question fits the three sizes, in a red that reads`: em 400×720, 360×600 e 300×440, o diálogo fica inteiro na janela, com até 352 de largura; o fundo do `Encerrar` é `rgb(194, 59, 59)`, e o texto, branco; nenhuma violação séria do axe.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/sala.spec.ts tests/sala/encerrar.spec.ts` falha: a sala em cima ainda é desenhada como uma ligação comum.
- [ ] **Step 3: Implemente, como nos quadros Sala, SalaEstados, SalaCheia, SalaCompacto, SalaMinimo e Encerrar.**
  - **O `main.tsx`:** com o `salaDe(state)` e o `salaEmCima`, a janela normal mostra a barra da ligação, a `TelaDaSala` e os toasts, no lugar do `Ligacao`.
  - **A `TelaDaSala`** é o `main.call-body.call-com-video.call-sala` `Sala de vídeo`:
    - em cima, o `CartaoDaOutra` de hoje (a ligação de fora tocando ou em espera);
    - sem painel, a área do vídeo (`.sala-caixa`: `container-type: size`) com o `MosaicoDaSala` e, com o `video.camera` da linha, a `Sua imagem` (`.video-sua`) no canto de baixo à direita;
    - quem fala: `Sala de vídeo` e `<n> pessoas · <tempo>` (o `pessoasNaSala` e o `statusLine` da linha); no Mínimo, uma linha só;
    - os controles: o Mudo, a Câmera (a regra é o `cameraDaSalaDesativada`), o Adicionar pessoa (o `podeAdicionar`; com o `cheia`, o `descritoPor` do aviso) e o Abrir grande (o `IconExpand`; manda o `videoWindow` `grande`);
    - com o `cheia`, o `<p id="sala-cheia">` `A sala já tem 6 pessoas.` entre os controles e o Desligar;
    - o Desligar (o `RoundAction`) abre o `EncerrarSala`;
    - com o painel de adicionar, como na Task 3: o alto do painel com `Em videochamada`, `Sala de vídeo`, `<n> pessoas` e o tempo, e a sua imagem flutuando no canto. Ele vale enquanto o `podeAdicionar` vale.
  - **Os tamanhos** (o resto, como na videochamada de hoje):

    | | Normal | Compacto | Mínimo |
    | --- | --- | --- | --- |
    | `.call-body` (padding, gap) | 16 22 22, 12 | 12 16 16, 10 | 10 12 12, 8 |
    | Área do vídeo | flex 1, raio 18, borda 1px rgba(255,255,255,.1), fundo `--video-bg` | raio 16 | raio 14 |
    | Sua imagem | 96×72, a 10, raio 10, borda 1,5px rgba(255,255,255,.55) | 80×60, a 8, raio 9 | 64×48, a 6, raio 8 |
    | Quem | `Sala de vídeo` 20/800; `3 pessoas · 05:41` 14px #b9c4e6, o tempo ciano 700 | 17/800; 13px | uma linha de 13px #b9c4e6: `Sala de vídeo` branco 800 · `3 pessoas` · o tempo |
    | Controles | 4 colunas, gap 12px 6px, círculo 54, rótulo 600 12px | gap 10px 4px, círculo 46, rótulo 11px | uma fila com o Desligar, gap 10, círculos de 44; os rótulos fora da vista (o nome de cada botão fica) |
    | Desligar | 66, com o rótulo de 12px | 56, rótulo 11px | 48, sem o rótulo à vista |
    | A sala cheia | 600 13px #b9c4e6, margem de cima −2 | igual | embaixo da fila |

  - **O `MosaicoDaSala`:**
    - a `VistaDeVideo` do `remoto` (`key` do id da sala, `desenhar` com o `video.imagem` da linha, `decorativa`) ocupa a área;
    - o grupo `Mosaico da sala` fica no 16:9 encaixado: `inset: 0`, `margin: auto`, `width: min(100cqw, 177.78cqh)` e `height: min(100cqh, 56.25cqw)`;
    - cada convidado é um grupo com o `nomeNaSala` dele, em `left`, `top`, `width` e `height` do `quadro` (em %), com `container-type: size`.
  - **O quadro de um convidado `naSala` com `imagem`:** é transparente (o mosaico aparece). Dentro dele fica a imagem `Vídeo de <nome>` (um `role="img"` vazio, a caixa 4:3 encaixada: `width: min(100cqw, 133.33cqh)` e `height: min(100cqh, 75cqw)`, no meio) e, no canto de baixo à esquerda dela, o nome (`aria-hidden`, fundo rgba(7,11,24,.72), 700, raio 999, uma linha com as reticências):

    | | Normal | Compacto | Mínimo |
    | --- | --- | --- | --- |
    | 1 ou 2 convidados | 11px, padding 3px 8px, a 6 | 10,5px, 2px 7px, a 5 | 10px, 2px 6px, a 4 |
    | 3 a 5 | 9,5px, 2px 6px, a 4 | 9,5px, 2px 6px, a 4 | 9px, 1px 5px, a 3 |

  - **O quadro sem imagem** (`chamando`, `emEspera`, ou `naSala` sem `imagem`): um painel `#0b1226` com a borda de 1px `--video-bg`, no meio, em coluna, com o espaço 4:
    - as iniciais (`aria-hidden`): 34px, 800 12px, o fundo `--gradient-brand`. Chamando, com a borda de 2px rgba(0,194,203,.7); em espera, o fundo rgba(255,255,255,.12) e a letra #b9c4e6. Sem nome, o `IconPhone`;
    - o nome (`aria-hidden`, 700 11px, uma linha com as reticências);
    - o estado: `Chamando…` em ciano 700; `Sem vídeo` (o `IconVideoOff` de 11px) e `Em espera` (o `IconPause` de 11px) em #b9c4e6 600, 10,5px;
    - no Compacto, 30px (11px), 10,5px e 10px; no Mínimo, 28px (10,5px), 10px e 9,5px.
  - **O `EncerrarSala`** é um `<dialog role="alertdialog">` modal (o `showModal`, como o `Confirm`), com o foco no `Cancelar` e o Esc pelo evento `cancel`:
    - 100% − 48px de largura, até 352; padding 22, raio 24, fundo #0f1836, borda 1px rgba(255,255,255,.12), sombra 0 40px 100px −30px rgba(7,11,24,.6);
    - o título 19px 800, o texto 14px, linha 1,55, #b9c4e6, com o espaço 10;
    - os botões em uma linha, com o espaço 10 e a margem de cima 8, cada um com flex 1, 46 de altura, raio 999 e 700 15px: o `Cancelar` com a borda de 1,5px rgba(255,255,255,.28), e o `Encerrar` com o fundo #c23b3b (o hover #ad3333) e o texto branco;
    - o `::backdrop` rgba(4,6,14,.72), a partir de baixo da barra de título (o `top: 32px` com a barra; na tela cheia, desde o alto);
    - os nomes vêm da sala de agora (o `nomesDaSala`), e a `TelaDaSala` só o mostra com a sala na tela.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a sala na tela da ligação e a pergunta do Desligar`. O CI fica verde.

### Task 5: O Tirar da sala

**Files:**
- Modify: `windows/ui/src/sala/MosaicoDaSala.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/sala/tirar.spec.ts`

**Interfaces:**
- Consumes (Task 4): o `MosaicoDaSala` e os ajudantes do `tests/sala/sala.ts`.
- Produces: em cada quadro (com e sem imagem), o botão `Tirar da sala` (o `IconClose` e o texto), que manda `{cmd: 'salaTirar', id}` com o `semSegundoClique`.

- [ ] **Step 1: Escreva os testes que falham.** No `tirar.spec.ts`:
  - `Tirar da sala shows on hover and on Tab, and takes the guest out` (`?fake=sala-estados`):
    - com o ponteiro fora, o botão do Carlos tem a opacidade 0, e o `document.elementFromPoint` no meio dele não é ele (um botão invisível não pega o clique);
    - com o ponteiro no quadro do Carlos, o botão aparece, e o clique manda `{cmd: 'salaTirar', id: 12}`; o quadro dele sai, e os outros voltam à `arrumacao(3)`;
    - o Tab, a partir da barra de título, passa pelo Tirar da sala de cada quadro, na ordem dos convidados, e o quadro com o foco tem o contorno ciano.
  - `a guest being called can be taken out too`: o Tirar da sala do Carlos (`Chamando…`) manda o `salaTirar` dele, sem nenhum toast.
  - `a double click on Tirar da sala takes out only one guest` (Review Focus 4): no `?fake=sala-estados`, o primeiro clique no Tirar da sala do Carlos (o quadro de cima à direita) tira o Carlos; com a arrumação nova, o Tirar da sala da Bia fica embaixo do ponteiro (o teste confere); o segundo par, com o `clickCount` 2, não manda outro `salaTirar`, e a Bia continua.
  - `five guests with long names or only numbers fit their tiles in the three sizes` (Review Focus 3): no `?fake=sala-cheia`, pelo `mudarEstado`, a Ana passa a `Coordenação de Logística e Transportes`, o Carlos fica sem nome com o número `+55 11 98888-7777`, a Bia `chamando`, o Davi `emEspera` e a Elisa sem imagem. Em 400×720, 360×600 e 300×440, cada nome, estado, as iniciais e o Tirar da sala (com o foco) de cada quadro ficam dentro dele (± 0,5), e a página não rola.
  - `in a narrow tile Tirar da sala shows only the icon and keeps its name`: em 300×440, com os cinco, o texto do botão sai da vista (o `.sr-only`), o nome dele continua `Tirar da sala`, e ele fica inteiro dentro do quadro.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/tirar.spec.ts` falha: não há o Tirar da sala.
- [ ] **Step 3: Implemente, como no quadro SalaEstados e na nota dele** ("O Tirar da sala aparece no quadro ao passar o mouse ou ao chegar nele com o Tab").
  - **O botão:** a 6 do canto de cima à direita do quadro; 24 de altura, padding 0 9 0 7, espaço 4, raio 999, borda 1px rgba(255,255,255,.3), fundo rgba(7,11,24,.86), 700 10,5px branco, o ícone de 11px.
  - **Escondido** com a opacidade 0 e o `pointer-events: none`; com o `:hover` ou o `:focus-within` do quadro, a opacidade 1 e o `pointer-events: auto`.
  - **O contorno ciano** de 2px por dentro do quadro, com o `:hover` ou o `:focus-within`: um `::after` por cima de tudo, sem pegar o clique (o painel opaco cobriria um `box-shadow` do próprio quadro).
  - **Num quadro estreito** (o `@container`, abaixo de 112 px de largura), o texto vai para o `.sr-only`, e o botão fica com 24×24.
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o Tirar da sala`. O CI fica verde.

### Task 6: A ligação de fora e a faixa de fora da sala

**Files:**
- Create: `windows/ui/src/sala/FaixaForaDaSala.tsx`
- Modify: `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/sala/TelaDaSala.tsx`, `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/sala/fora.spec.ts`

**Interfaces:**
- Consumes (Tasks 2 e 4): o `salaEmbaixo`, o `foraDaSala`, o `nomesDaSala`, a `TelaDaSala` e o `CartaoDaOutra`.
- Produces:
  ```tsx
  export function FaixaForaDaSala(props: { state: AppState; ligacao: CallState; sala: SalaDaLigacao; send: Send }): VNode;
  ```
  - O `CartaoDaOutra` não mostra a linha da sala (ela tem a faixa).
  - No `Ligacao`, a sala embaixo não é a "outra": os controles são os de uma ligação, sem o Chat (o `main.tsx` passa `chat` nulo com a sala embaixo).
  - Na `TelaDaSala`, com a ligação de fora em espera, o `Alternar` (o `IconSwap`, o `swap`) entra antes do Abrir grande.

- [ ] **Step 1: Escreva os testes que falham.** No `fora.spec.ts`:
  - `an outside call rings over the room without Atender com vídeo, and the mosaic stays` (`?fake=sala-ligacao-de-fora`): o `alert` `Ligação de Roberto Lima`, com `Ramal 2012 · tocando`, o `Recusar` e o `Atender`, sem o `Atender com vídeo`. O `Mosaico da sala` continua, com a Ana e o Carlos.
  - `answering takes you out: the strip with Voltar para a sala over the outside call, voice only`:
    - o `Atender` manda `{cmd: 'answer'}`, sem o `video`;
    - aparece a região `Você está fora da sala`, com `Ana Souza e Carlos Lima` e o tempo da sala, e o `Voltar para a sala`;
    - embaixo, a tela da ligação `Ligação` com `Roberto Lima` e `Ramal 2012`; os controles são `Mudo`, `Câmera`, `Teclado`, `Áudio`, `Espera`, `Transferir`, `Nova ligação` e `Atalhos`, em `ctrls-4`, com a Câmera (`Ligar a câmera`) e a Nova ligação desativadas;
    - não há o cartão `Em espera`, nem o `Mosaico da sala`, nem a `Sua imagem`, e sai `{cmd: 'videoViews', pagina: 'principal', vistas: []}`.
  - `Voltar para a sala brings the room back with the outside call on hold, and Alternar goes out again` (`?fake=sala-fora`):
    - o `Voltar para a sala` manda `{cmd: 'salaVoltar'}`, e a tela da sala volta;
    - em cima, o cartão do `Roberto Lima` com `Em espera` e o `Desligar Roberto Lima`;
    - os controles são `Mudo`, `Câmera`, `Adicionar pessoa`, `Alternar` e `Abrir grande`, em `ctrls-5`;
    - o `Alternar` manda `{cmd: 'swap'}`, e a faixa volta.
  - `the end of the outside call brings the room back`: no `?fake=sala-fora`, o Desligar manda `{cmd: 'hangup', id: 16}`, e a tela da sala volta, sem a faixa e sem o cartão.
  - `the room ending while you are out leaves the outside call alone`: no `?fake=sala-fora`, o estado sem a sala e sem a `second` (o `mudarEstado`) tira a faixa; a ligação do Roberto fica sozinha, com a Nova ligação ativa.
  - `the strip's picture has one block per guest, in its place`: a miniatura é `aria-hidden` e tem um bloco por convidado, cada um no `quadro` dele (em frações dos 64×36, ± 1).
  - `the strip and the outside call fit the three sizes`: em 400×720, 360×600 e 300×440, o `Você está fora da sala` fica inteiro (sem reticências: o `scrollWidth` não passa do `clientWidth`), o `Voltar para a sala` e cada botão da tela da ligação ficam inteiros na janela, e a página não rola.
  - `the room with the outside call on hold fits the three sizes`: no `?fake=sala-de-volta`, em 400×720, 360×600 e 300×440, o cartão do Roberto e cada botão ficam inteiros na janela, o `Mosaico da sala` passa de 100 de altura e a página não rola. No 300×440, os cinco controles e o Desligar ficam numa fila (o meio de cada um na mesma altura, ± 1).
  - `a double click on Voltar para a sala sends it once`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/fora.spec.ts` falha: a linha da sala embaixo aparece como um cartão "Em espera" sem nome.
- [ ] **Step 3: Implemente, como nos quadros LigacaoDeFora e ForaDaSala.**
  - **O `main.tsx`:** com a sala embaixo (`salaEmbaixo`), ou em cima com o `held`, a `FaixaForaDaSala` fica entre a barra da ligação e a tela (o `Ligacao` da ligação de fora, ou a `TelaDaSala` em espera). Com a sala embaixo, o `chat` do `Ligacao` é nulo.
  - **A `FaixaForaDaSala`** (`<section aria-label="Você está fora da sala">`):
    - em linha, com o espaço 12, o padding 12 14, o fundo linear-gradient(90deg, #0c2671 0%, #0a1a4d 100%) e a borda de baixo de 1px rgba(255,255,255,.1);
    - a miniatura de 64×36 (`aria-hidden`, raio 8, fundo `--navy-950`): um bloco por convidado no `quadro` dele, com um espaço de 1px; com imagem, linear-gradient(160deg, #3d5079, #19244a), e sem ela, #0b1226;
    - os textos: `Você está fora da sala` (13,5px 800, numa linha) e, embaixo, `<nomes>` (12px #b9c4e6, com as reticências) e ` · <tempo>` (o tempo da linha da sala, ciano 700, inteiro);
    - o `Voltar para a sala` (34 de altura, padding 0 14, raio 999, ciano com o `--on-cyan`, 700 13px, numa linha) manda o `salaVoltar`;
    - no Mínimo: padding 8 10, espaço 8, sem a miniatura; o título com 12px (pode quebrar a linha), os nomes com 11px e o botão com 30 de altura, padding 0 10 e 12px.
  - **O `Ligacao`:** a `outra` e o `CartaoDaOutra` deixam de fora a linha da sala; os controles são os de uma ligação (a Nova ligação já fica desativada com a `second`, e a Câmera, pela regra de hoje).
  - **A `TelaDaSala`:** com a `second` em espera (a ligação de fora), o `Alternar` entra nos controles, e a grade é a `ctrls-5`. No Mínimo, a fila dos cinco e do Desligar fica com os círculos de 40, o Desligar de 44 e o espaço 6 (274 dos 276 da largura; com os 44, 48 e 10 de quatro controles, ela daria 318).
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a ligação de fora e a faixa de fora da sala`. O CI fica verde.

### Task 7: O grande e a tela cheia da sala

**Files:**
- Modify: `windows/ui/src/video/Grande.tsx`, `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/sala/grande.spec.ts`

**Interfaces:**
- Consumes (Tasks 3 a 6): o `MosaicoDaSala`, o `PainelDeAdicionar`, o `EncerrarSala`, o `NoWindows` e as regras.
- Produces: o `Grande` ganha `contatos: Contact[]` e `daEmpresa: CompanyContact[]`, e o `Botao` dele ganha o `descritoPor?: string` e o `titulo?: string`. Com a sala em cima (`salaEmCima(l, salaDe(state))`), ele mostra a sala.

- [ ] **Step 1: Escreva os testes que falham.** No `grande.spec.ts`, com a janela de 1280×800:
  - `the big window shows the room's mosaic with the names, the label and the room's bar` (`?fake=sala-grande`):
    - o `main` `Sala de vídeo, grande`, o grupo `Mosaico da sala` com a Ana, o Carlos e a Bia;
    - a etiqueta com `Sala de vídeo`, `4 pessoas` e um tempo como `/^09:1\d$/`;
    - a `Sua imagem` com 224×168, a 24 da direita e a 128 de baixo (± 1);
    - a barra de baixo, nesta ordem: `Mudo`, `Desligar a câmera`, `Adicionar pessoa`, `Tela cheia`, `Diminuir` e `Desligar`.
  - `the names of the bottom row sit at the top of their images`: o nome da Bia (a linha de baixo) fica acima do meio da imagem dela, e o da Ana, abaixo do meio da dela.
  - `each name sits on its guest's image in the big window and in the full screen`: com o `mosaicoDaSala`, o meio de cada `Vídeo de <nome>` fica `perto` da cor dele, no grande e na tela cheia (1920×1080).
  - `Adicionar pessoa opens the panel at the right and the mosaic makes room`: o painel tem 360 de largura, à direita; o `Mosaico da sala` fica nos 920 da esquerda, com os nomes ainda sobre as cores, e a `Sua imagem` continua inteira à vista, à esquerda do painel. O `2005` e o `Adicionar` mandam o `salaAdicionar` e fecham o painel; o `Cancelar` também fecha.
  - `Desligar asks Encerrar a sala para todos?`: o Desligar da barra abre a pergunta, e o `Encerrar` manda o `salaEncerrar`.
  - `a full room in the full screen disables Adicionar pessoa with the reason`: no `?fake=sala-cheia`, com o `Abrir grande` e o `Tela cheia` em 1920×1080, o `Adicionar pessoa` fica desativado, com o `title` e a descrição `A sala já tem 6 pessoas.`.
  - `the full screen keeps the board's sizes`: em 1920×1080, a `Sua imagem` tem 288×216, a 32 da direita e a 156 de baixo; os círculos da barra têm 60; os nomes, 16px.
  - `answering the outside call in the big window brings the call screen with the strip` (Review Focus 5): no `?fake=sala-grande`, com o Roberto tocando (o `mudarEstado`), o cartão `Ligação de Roberto Lima` fica em cima, no meio. O `Atender` mostra na hora a faixa `Você está fora da sala` e a tela da ligação do Roberto, e sai um `{cmd: 'videoWindow', modo: 'normal'}` só (o `vezes`).
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/sala/grande.spec.ts` falha: o grande da sala mostra a linha da sala como uma videochamada sem nome.
- [ ] **Step 3: Implemente, como nos quadros Grande e TelaCheia.**
  - **O `main.tsx`:**
    - passa os `contatos` e a `daEmpresa` ao `Grande`;
    - com a sala embaixo, a janela normal vale mesmo com a `janela` diferente de `normal`, e a página manda o `videoWindow` `normal` uma vez por ligação de fora (o id da de cima), como a regra do `toqueNoGrande`.
  - **O `Grande` com a sala** (o resto como hoje: o clique duplo, o Esc, o cartão da outra que flutua e a sua imagem):
    - o `role="main"` com `Sala de vídeo, grande` ou `Sala de vídeo, tela cheia`;
    - a área do vídeo com o `MosaicoDaSala` (`modo` `grande` ou `telaCheia`);
    - a etiqueta com três partes, com o espaço 10: `Sala de vídeo` 15px 800, `<n> pessoas` #b9c4e6 e o tempo ciano 700. Na tela cheia: 46 de altura, padding 0 18, espaço 12, 16px e 15px;
    - a barra: Mudo, Câmera (o `cameraDaSalaDesativada`), Adicionar pessoa (com o `cheia`, desativado, com o `title` e o `descritoPor` de um texto `.sr-only`), Tela cheia ou Sair da tela cheia, Diminuir e Desligar (abre o `EncerrarSala`);
    - o Adicionar pessoa abre o painel à direita: o `grande-com-chat` (a largura de 360) e um `div.grande-chat.grande-adicionar` (no tema escuro da ligação, padding 20 22 22) com o `PainelDeAdicionar` dentro de um `NoWindows.Provider` ligado. O `Adicionar` manda o `salaAdicionar` e fecha.
  - **Os quadros no grande:**

    | | Grande | Tela cheia |
    | --- | --- | --- |
    | O nome | 14px, padding 5px 12px, a 12 do canto da imagem | 16px, 6px 14px, a 16 |
    | A linha de baixo (3 a 5) | o nome no canto de cima à esquerda da imagem | igual |
    | Sem imagem | as iniciais de 64 (22px), o nome 16px, o estado 14px, o espaço 8 | 76 (26px), 18px, 15px |
    | Tirar da sala | 30 de altura, 12,5px, o ícone 13, a 10 | 32, 13px, 14, a 12 |

- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a sala no grande e na tela cheia`. O CI fica verde.

### Task 8: As fotos, a fumaça, o roteiro, as notas e a entrega

**Files:**
- Create: `windows/ui/tests/sala/fotos.spec.ts`
- Modify: `tests/smoke/windows_smoke.py`, `tests/python/test_windows_smoke.py`
- Modify: `docs/teste-manual.md`
- Create: `notas/v0.4.0-rc.1.txt`

**Interfaces:**
- Consumes: as telas das Tasks 3 a 7, os cenários e os ajudantes das Tasks 2 e 4, e o `tests/teclado.ts` (`daLargada` e `conferirOTeclado`).
- Produces (`windows_smoke.py`):
  ```python
  ROOM_GUESTS = ("2002", "2004")                          # a ligação com vídeo e o convidado que o Adicionar chama
  ROOM_COLORS = {"2002": (82, 90, 240), "2004": (235, 128, 128)}
  def room_buffer_problems(info): ...    # [] com info == {"dados": {"v": 1, "type": "videoBuffer", "vista": "remoto",
                                          #   "bytes": 6220864}, "bytes": >= 6220864, "marca": 0x31565353, "largura": 1280,
                                          #   "altura": 720, "seqs": [s1, s2]}, com s1 e s2 pares, maiores que 0, e s2 > s1
  def room_log_problems(log_text, numbers): ...   # [] com "sala: comecou", "sala: entrou (2 na sala)" e "sala: acabou",
                                                  #   e nenhuma linha "sala:" com um dos números
  def check_room(page, registrar, data_dir, capturas, result, record, problems): ...
  ```

- [ ] **Step 1: Escreva os testes que falham.**
  - No `test_windows_smoke.py`:
    - `room_buffer_problems` aceita o certo e acusa o `None` (o tempo acabou), a vista trocada, a marca errada, o tamanho diferente de 1280×720 e o `seq` parado;
    - `room_log_problems` aceita as três linhas e acusa uma que falta e uma linha `sala:` com o `2004`.
  - No `tests/sala/fotos.spec.ts`, como o `tests/video/fotos.spec.ts`: cada tela, em cada tamanho (400×720, 360×600 e 300×440) e em cada tema, tira a foto `sala-<tela>-<largura>x<altura>-<tema>.png` e passa pelo `semViolacoesSerias`, pelo `daLargada` e pelo `conferirOTeclado`. As telas:
    - `videochamada` (`?fake=video`, com um quadro no `remoto` e outro no `local`) e `adicionar` (o painel, com `car` e a seta para baixo);
    - `tres` (`?fake=sala`), `estados` (`?fake=sala-estados`, com o foco no Tirar da sala da Ana) e `cheia` (`?fake=sala-cheia`), cada uma com o `mosaicoDaSala` e um quadro no `local`;
    - `encerrar` (`?fake=sala`, com a pergunta aberta);
    - `ligacao-de-fora`, `fora` e `de-volta` (os cenários delas);
    - `convidado` (`?fake=sala-convidado`, com um mosaico de dois no `remoto`, de 640×480: a metade da esquerda `VERMELHO` e a da direita `AZUL`).

    Fora dos três tamanhos, nos dois temas: o `grande` e o `grande-adicionar` (1280×800, o `?fake=sala-grande`), e a `tela-cheia` (1920×1080, o `?fake=sala-cheia` com o Abrir grande e o Tela cheia).
- [ ] **Step 2: Rode e veja falhar.** O `python3 -m unittest tests.python.test_windows_smoke` falha sem as funções. As fotos (`npx playwright test tests/sala/fotos.spec.ts`) já rodam, porque as telas existem: o que o axe ou o Tab acusarem é consertado aqui.
- [ ] **Step 3: Implemente.**
  - **A fumaça** (`windows_smoke.py`, o item 12 da docstring; o `check_room` roda no `run_smoke`, depois do `check_h264_download`):
    1. o registrador falso manda a cor de cada convidado (`VIDEO SOURCE <número> color <Y> <U> <V>`, as `ROOM_COLORS`);
    2. pela interface: o Teclado com `2002` e o `Ligar com vídeo`; quando o `Adicionar pessoa` fica ativo, ele, `2004` e o `Adicionar`;
    3. a sala: o grupo `Mosaico da sala` com os quadros `2002` e `2004`, e o do `2004` sem o `Chamando…` em até 30 s; a captura `sala.png`;
    4. o mosaico no `remoto`: a fumaça põe um ouvinte do `sharedbufferreceived` pelo `page.add_init_script` e recarrega a página (o `ready` faz o executável entregar de novo as memórias, e a página recarregada volta à sala). O ouvinte guarda a memória do `remoto` e lê o cabeçalho (a marca no byte 0, o `seq` no 4, a largura no 12 e a altura no 16) duas vezes, com 1 s entre as duas. Com o H.264 `instalado`, o meio de cada `Vídeo de <número>` fica perto da cor dele (± 8) numa captura; sem ele, só o cabeçalho conta;
    5. o Desligar, a pergunta e o `Encerrar`: o `bye-in 2002` e o `bye-in 2004` chegam ao registrador em até 15 s;
    6. o `diagnostico.log`, pelo `room_log_problems`;
    7. no fim (`finally`), `VIDEO SOURCE <número> default`. O que foi visto vai para o `resultado.json` (a chave `sala`).
  - **O roteiro** (`docs/teste-manual.md`):
    - em "O que precisa", a linha da seção 24: os dois PCs (W10 e W11) com webcam e o app, um MicroSIP com câmera, um telefone com câmera (ou um porteiro, se a Starsonic tiver), o Android ou o iPhone com o Starsonic Phone, o colega da seção 5 para a ligação de fora, e mais um PC ou um MicroSIP para chegar a 6 pessoas;
    - a `## 24. Sala de vídeo (0.4.0-rc.1)`, antes do "Onde cada critério de sucesso é verificado", comparando com os quadros do "Starsonic Phone — sala de vídeo" e lembrando que os convidados se veem entre si e quem monta escolhe quem entra (spec 9). As linhas:
      - montar a sala de uma videochamada (o Adicionar pessoa pelo número e pelo nome), cada convidado vendo o mosaico dos outros, sem ele mesmo (o PC 2 como convidado vê uma videochamada comum: o quadro Convidado), todos ouvindo todos, ninguém ouvindo a si mesmo;
      - o MicroSIP no H.264 e no VP8, e o telefone com câmera;
      - 6 pessoas, com o "Adicionar pessoa" apagado e `A sala já tem 6 pessoas.`, anotando o uso do processador e o upload do PC 1 (perto de 3 Mbit/s);
      - os quadros: um convidado sem vídeo, um em espera (a música da central não toca na sala), e o Tirar da sala pelo mouse e pelo Tab;
      - um convidado que sai até sobrar um (a volta à videochamada comum);
      - o Encerrar, com o Cancelar antes;
      - a ligação de fora: o cartão sem o Atender com vídeo, a faixa, o Voltar para a sala com quem ligou em espera e o Alternar, o fim dela, uma terceira ligação ocupada, e um porteiro que liga durante a sala tocando só com a voz;
      - o grande e a tela cheia com a sala, o Adicionar pessoa no grande, e a ligação de fora atendida no grande;
      - a tela bloqueada (Win + L);
      - **a segunda câmera** (o pedido da revisão da etapa 3a): numa sala de 3 pessoas, plugar uma segunda câmera USB no PC de quem montou e depois tirá-la. Os convidados continuam vendo o mosaico certo, cada um os outros nos lugares de antes, a sua imagem continua e nada trava; tirar a câmera em uso dá `A câmera foi desconectada.`, e a sala continua;
      - o PC de quem montou que cai (a rede desligada, ou o Sair): todas as ligações da sala caem;
      - o limite de ligações do ramal em cada central de cliente, com o motivo no aviso, anotando o limite de cada uma;
      - o iPhone e o Android como convidados, só com a voz, e nada da sala nas telas deles;
      - o diagnóstico: as linhas `sala:`, sem nenhum nome nem número.
    - embaixo da tabela, a lista das fotos do artefato `capturas-interface` (os nomes do Step 1);
    - no "Onde cada critério de sucesso é verificado", uma linha por critério da seção 3 da spec do vídeo em grupo, com os testes automáticos (o Playwright de `tests/sala/`, o `phone_tests` com o `test_engine_room.cpp`, o `call_controller_tests` com o `test_call_controller_room.cpp`, o `desktop_tests` e a fumaça) e as linhas da seção 24.
  - **As notas** (`notas/v0.4.0-rc.1.txt`), em duas linhas:
    ```
    Sala de vídeo: na videochamada, o Adicionar pessoa chama mais gente, até 6 pessoas com você. Todos se veem e se ouvem; você vê o nome de cada um, tira alguém da sala e atende uma ligação de fora sem derrubar a sala.
    Esta é uma versão de teste.
    ```
- [ ] **Step 4: Rode e veja passar.** O `python3 -m unittest discover -s tests/python` e a suíte inteira da interface passam. No CI, a fumaça do Windows passa com a sala, e as fotos ficam no artefato `capturas-interface` (as do Windows, no `capturas-windows`).
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `test(video): as fotos, a fumaça da sala, o roteiro e as notas da 0.4.0-rc.1`. O CI fica verde.
- [ ] **Step 6: Peça a publicação ao responsável.** Com o CI verde no último commit da `video-etapa-3` (e a revisão final da branch feita), o relatório diz ao responsável:
  - onde estão as fotos: o artefato `capturas-interface` do build desse commit (e as do Windows, no `capturas-windows`), para comparar com o quadro;
  - o roteiro: a seção 24 do `docs/teste-manual.md`; e as notas: o `notas/v0.4.0-rc.1.txt`;
  - as escolhas de "O desenho", para ele confirmar ou mudar;
  - como publicar, depois de aprovar as fotos e os textos: no GitHub, Actions → release → Run workflow, na branch `video-etapa-3`, com a versão `0.4.0-rc.1` (ou `gh workflow run release.yml --ref video-etapa-3 -f versao=0.4.0-rc.1`).

  Quem publica é o responsável: este plano não dispara o `release`, não cria tags e não cria releases.
