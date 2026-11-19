# A correção do FreeSWITCH na troca de tamanho do mosaico — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o FreeSWITCH do servidor de vídeo deixa de congelar a imagem e de cair quando o mosaico muda de tamanho, e um teste que fica no repositório prova isso a cada mudança.

**Architecture:**
- **A correção** é um arquivo em `video-servidor/freeswitch/patches/freeswitch/`. O `construir.sh` já aplica essa pasta sobre o código oficial, e o pacote das fontes já a leva junto. Nenhum outro programa muda: nem o agente, nem o chat, nem a página.
- **A prova** é um teste novo de ponta a ponta: mil trocas de tamanho seguidas, direto no FreeSWITCH, com uma pessoa entrando e saindo no meio. No GitHub ele roda com 4 processadores de verdade, que é onde a imagem congela sem a correção.
- **O pacote** passa a dizer quais correções leva (no `VERSOES.txt`), e o `conferir-pacote.sh` recusa um pacote que não leve exatamente as da pasta.

**Tech Stack:**
- **O FreeSWITCH 1.11.3** do `video-servidor/deps.lock`, com a correção em C por cima.
- **Bash**, nos dois scripts do pacote.
- **Os testes de ponta a ponta de hoje:** Node 22, `@playwright/test` 1.56.1 e `typescript` 5.9.3, sem pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md`. Vale a spec inteira. A correção, linha por linha, é o apêndice dela.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-1`. Cada tarefa dá commit, por caminho, e push.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **O que não muda:** o `video-servidor/internal/`, o `chat-servidor/`, o `windows/`, o `android/` e o `video-servidor/deps.lock`. Nenhum pacote novo no `video-servidor/e2e/package.json`.
- **A correção é a do apêndice da spec,** sem uma linha a mais. Ela aplica com o `git apply` no commit `ef32e205295e29f034f1453ad245ba5efb07b94a` do FreeSWITCH.
- **O repositório é público:** nenhum segredo, endereço de verdade ou nome de verdade em arquivo, teste ou registro. A senha do ESL do teste é lida do `test-results/privado/config.json` dentro do processo e nunca vai a uma mensagem, ao console ou a um arquivo. O arquivo da correção leva o autor `Starsonic Phone <starsonic-phone@example.invalid>`.
- **Os nomes dos testes** são os inventados de hoje: Carlos Lima, Bia Ramos e Maria Lima.
- **Ninguém publica versão:** o `video-release` é rodado pelo responsável, com a versão `0.1.0-rc.4`. Nenhuma tarefa roda o `instalar.sh`, cria tag ou release.
- **Nenhum contato com o projeto do FreeSWITCH** (spec, seção 7).
- **Os dois workflows andam juntos:** os jobs `freeswitch` e `freeswitch-conferir` do `video.yml` estão copiados no `video-release.yml`. Um passo novo que é só teste fica só no `video.yml`, com um comentário nos dois dizendo isso.

## A máquina de desenvolvimento

- Ela tem 2 processadores. Uma rodada pesada (o Playwright de ponta a ponta) entra na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw` e `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- **O FreeSWITCH só liga as threads das pessoas com mais de 2 processadores.** Para ele enxergar 4 nesta máquina, há a bancada da pasta `work/fs-teste/`, fora do git. O apêndice deste plano diz como refazê-la.
  - `STARSONIC_FREESWITCH_DIR=/home/claude/starsonic-reunioes/work/fs-teste/original` é o FreeSWITCH do pacote de hoje; `…/corrigido`, o mesmo com o `mod_conference` corrigido.
  - `NCPU_FALSO=4` faz qualquer um dos dois enxergar 4 processadores.
- A árvore `work/freeswitch-fontes/freeswitch` está no commit do `deps.lock`, com a correção aplicada à mão: o `git diff` dela é o apêndice da spec.

## Review Focus

1. **Gente entrando e saindo no meio das trocas.** As provas da spec começaram com duas pessoas paradas. O teste novo põe uma terceira pessoa para entrar e sair duas vezes (tarefa 1).
2. **O comando que não responde.** Sem a correção, o teste tem de falhar dizendo em qual troca parou e se o FreeSWITCH continua de pé, sem mostrar segredo nenhum. O passo "vermelho" da tarefa 1 guarda essa mensagem no relatório.
3. **Um pacote montado sem a correção** (pasta com o nome errado, cache antigo). O `construir.sh` passa a parar numa pasta de `patches/` que não é de nenhum projeto, e o `conferir-pacote.sh` compara o nome e o SHA-256 de cada correção (tarefa 2, com o passo que prova a recusa).
4. **Os três sistemas.** O FreeSWITCH compila com o `-Werror`, e cada sistema tem um compilador. A correção só está provada quando os três jobs `FreeSWITCH (…)` do GitHub ficam verdes (tarefa 1).
5. **O `VPX encode error` que não é do defeito.** A linha `[8:Invalid parameter:(null)]` pode aparecer numa troca de tamanho normal, e o guia já a explica. O teste novo só falha com as duas do defeito: `Image size must match encoder init configuration size` e `Invalid image format` (tarefa 1).

---

### Task 1: A correção e o teste que a prova

**Files:**
- Create: `video-servidor/freeswitch/patches/freeswitch/0001-mod_conference-tamanho-na-thread-do-mosaico.patch`
- Create: `video-servidor/e2e/esl.ts`
- Create: `video-servidor/e2e/esforco.spec.ts`
- Modify: `video-servidor/e2e/servidores.ts` (uma função nova, ao lado do `segredosDoAmbiente`)

**Interfaces:**
- Consumes (já existem): `Navegador.abrir`, `entrarPelaPagina`, `esperarMensagem`, `esperarTamanho`, `esperarCores` e `fechar` (`navegador.ts`); `A`, `B`, `C`, `MOSAICO_2`, `VERMELHO`, `AZUL` (`midia.ts`); `novaReuniaoDeTeste`, `PRIVADO`, `REGISTROS`, `avisosDoMosaico` (`servidores.ts`).
- Produces:
  ```ts
  // servidores.ts
  /** A senha do ESL do ambiente. Só para abrir o ESL: nunca numa mensagem, no console ou num arquivo. */
  export function senhaDoEsl(): string;

  // esl.ts — um cliente pequeno do ESL do FreeSWITCH, em 127.0.0.1:8021
  export class Esl {
    /** Entra com a senha. Rejeita com "o ESL não pediu a senha" ou "o ESL recusou a entrada", sem a senha no texto. */
    static abrir(senha: string): Promise<Esl>;
    /** Manda "api <comando>" e devolve o corpo da resposta; null se ela não veio em prazoMs ou a ligação fechou. */
    api(comando: string, prazoMs?: number): Promise<string | null>; // o padrão é 5000
    fechar(): void;
  }
  ```

- [ ] **Step 1: Escrever o `esl.ts` e o `senhaDoEsl`**

  O `Esl` fala o protocolo de texto do ESL: cada recado são cabeçalhos, uma linha vazia e, com o `Content-Length`, um corpo desse tamanho. A entrada: esperar o `auth/request`, mandar `auth <senha>`, e a resposta tem o `Reply-Text` começando por `+OK`. A resposta de um `api` é o recado com `Content-Type: api/response`. Um comando de cada vez.

- [ ] **Step 2: Escrever o teste `esforco.spec.ts`**

  Um teste só, `'mil trocas de tamanho do mosaico, com uma pessoa entrando e saindo'`, com `test.setTimeout(180_000)`:

  1. A (`'Carlos Lima'`) e B (`'Bia Ramos'`) entram na reunião de teste pelo `Navegador`; esperar o `aceito` dos dois, o tamanho 1920×1080 nos dois e as cores `[VERMELHO, AZUL]` no `MOSAICO_2` de A.
  2. Abrir o `Esl`. A sala é a única conferência do `conference list` (a expressão `/Conference (\S+) \(/`); com outra contagem, falhar dizendo quantas.
  3. Mil trocas, a `i` de 0 a 999: `conference <sala> vid-res 1920x1620` nas pares e `1920x1080` nas ímpares, com 20 ms entre uma e outra.
     - A resposta `null` falha com `a troca <i> ficou 5 s sem resposta; o FreeSWITCH <continua de pé|não responde mais>`. Ele "continua de pé" se um `Esl` novo abre.
     - Uma resposta que não começa por `+OK` falha com `a troca <i> respondeu: <os 60 primeiros caracteres>`.
     - Nas trocas 200 e 650, C (`'Maria Lima'`) começa a entrar, sem a fila das trocas esperar por ela. Nas trocas 450 e 900, depois de a entrada terminar, ela sai (o `fechar`), também sem a fila esperar.
  4. Depois das mil: esperar as entradas e as saídas de C; mandar `1920x1620` e esperar esse tamanho em A e em B; mandar `1920x1080`, esperar o tamanho e as cores `[VERMELHO, AZUL]` no `MOSAICO_2` dos dois.
  5. O registro do FreeSWITCH, do começo do teste em diante, não tem linha com `VPX encode error` junto de `Image size must match` nem de `Invalid image format`. A falha diz quantas de cada, e não as linhas.
  6. O `avisosDoMosaico()` tem no fim o mesmo número de avisos do começo.
  7. No `finally`: fechar o `Esl` e os três navegadores. Com o FreeSWITCH congelado, é a saída das pessoas que o destrava para os testes seguintes.

- [ ] **Step 3: Ver o teste falhar sem a correção (vermelho)**

  Run, na fila da máquina, em `video-servidor/e2e`: `STARSONIC_FREESWITCH_DIR=/home/claude/starsonic-reunioes/work/fs-teste/original NCPU_FALSO=4 npx playwright test esforco.spec.ts`

  Expected: FAIL com `a troca <i> ficou 5 s sem resposta; o FreeSWITCH continua de pé`. Nas três rodadas da spec, nesse ritmo, o `i` foi 323, 479 e 179. Se uma rodada passar, rodar de novo, até três vezes. Guardar a mensagem no relatório.

- [ ] **Step 4: Criar o arquivo da correção**

  Na árvore `work/freeswitch-fontes/freeswitch`, um commit de passagem com o autor do Global Constraints e a data `2026-11-19T00:00:00Z`, o `git format-patch -1 --zero-commit --no-signature` para o arquivo, e a árvore de volta ao estado de antes (`git reset --soft HEAD~1`). O assunto do commit: `mod_conference: o vid-res anota o tamanho, e a thread do mosaico o aplica`. O corpo, em três frases: o que o defeito faz (as duas formas da seção 1 da spec), o que a correção faz, e que é o mesmo caminho do `vid-layout`.

  Conferir: numa cópia limpa do commit do `deps.lock`, `git apply --check <arquivo>` não diz nada; a parte do arquivo a partir do primeiro `diff --git` é igual ao apêndice da spec; e o `mod_conference.so` da pasta `corrigido/mod`, o das provas, é o mesmo arquivo que a árvore corrigida monta (o `.libs/mod_conference.so` dela, pelo `md5sum`).

- [ ] **Step 5: Ver o teste passar com a correção (verde), com 4 e com 2 processadores**

  Run, na fila da máquina: o mesmo comando do passo 3 com `…/work/fs-teste/corrigido`, uma vez com `NCPU_FALSO=4` e outra sem ele.

  Expected: PASS nas duas, em menos de 1 minuto cada.

- [ ] **Step 6: A suíte inteira com a correção, e os tipos**

  Run: `npx playwright test`, com `…/corrigido` e `NCPU_FALSO=4`, na fila da máquina; e `npm run typecheck`.

  Expected: 34 passaram (os 33 de hoje e o novo), e o `tsc` sem erro.

- [ ] **Step 7: Commit e push**

  ```bash
  git add video-servidor/freeswitch/patches/freeswitch/0001-mod_conference-tamanho-na-thread-do-mosaico.patch video-servidor/e2e/esl.ts video-servidor/e2e/esforco.spec.ts
  git commit -m "fix(video): o FreeSWITCH troca o tamanho do mosaico na thread do mosaico" -- video-servidor/freeswitch/patches video-servidor/e2e/esl.ts video-servidor/e2e/esforco.spec.ts video-servidor/e2e/servidores.ts
  git push origin reunioes-etapa-1
  ```

- [ ] **Step 8: Esperar o GitHub**

  O workflow `video` desse commit: os três `FreeSWITCH (…)` montam com a correção (o cache não vale, porque a pasta `patches/` mudou), os três `FreeSWITCH conferido (…)` passam, e o `De ponta a ponta` passa com 34 testes. É a prova em 4 processadores de verdade. Um job vermelho volta para esta tarefa.

---

### Task 2: O pacote diz as correções que leva

**Files:**
- Modify: `video-servidor/freeswitch/construir.sh` (o `preparar_fontes` e o passo 6, do `VERSOES.txt`)
- Modify: `video-servidor/freeswitch/conferir-pacote.sh` (um passo novo, depois do da versão, e o comentário do começo)
- Modify: `video-servidor/freeswitch/LEIA-ME-FONTES.txt`
- Modify: `.github/workflows/video.yml` (um passo novo no `freeswitch-conferir`) e `.github/workflows/video-release.yml` (só o comentário)

**Interfaces:**
- Produces: o `VERSOES.txt` do pacote, depois das três linhas dos projetos, com uma linha para cada correção, na ordem do `sort` com `LC_ALL=C`:
  ```
  patch <projeto> <arquivo> <sha256 do arquivo>
  ```
  Hoje: `patch freeswitch 0001-mod_conference-tamanho-na-thread-do-mosaico.patch <64 letras e números>`.

- [ ] **Step 1: O `construir.sh` escreve as linhas e recusa a pasta que não é de um projeto**

  - Antes de buscar as fontes: toda pasta de `patches/` tem de ter o nome de um dos três projetos. Outra pasta para o build com `construir: a pasta patches/<nome> não é de nenhum projeto`.
  - Uma função nova, `linhas_das_correcoes`, sem argumento: escreve na saída uma linha `patch` para cada `patches/<projeto>/*.patch` ao lado do script, com o `sha256sum` do arquivo, ordenadas. Sem a pasta, ou sem nenhum `.patch`, não escreve nada.
  - No passo 6, depois das três linhas de hoje, o `VERSOES.txt` recebe a saída dela.

- [ ] **Step 2: O `conferir-pacote.sh` compara**

  Uma função nova, `conferir_correcoes <VERSOES.txt> <pasta patches>`, chamada num passo novo, depois do da versão. Ela monta as linhas esperadas a partir da pasta (com o `sha256sum`, que o contêiner limpo tem) e as compara com as linhas `patch ` do `VERSOES.txt`. Diferentes: mostra as duas listas (`esperadas:` e `no pacote:`) e falha com `as correções do pacote não são as da pasta patches/`. Iguais: `conferir: as <n> correções da pasta patches/`. Sem o `git` e sem o `python3`, como o resto do script.

  As duas contas são escritas duas vezes de propósito, uma em cada script: se uma mudar e a outra não, o "Conferir o pacote" do GitHub falha em todo build.

- [ ] **Step 3: O passo do GitHub que prova a recusa**

  No job `freeswitch-conferir` do `video.yml`, só no `ubuntu-24.04` e só quando a pasta `patches/` tem algum `.patch`: depois do "Conferir o pacote", refazer o pacote sem as linhas `patch ` do `VERSOES.txt`, rodar o `conferir-pacote.sh` nele e exigir as duas coisas: a saída diferente de zero e o texto `as correções do pacote não são as da pasta patches/`. O `video-release.yml` ganha só o comentário de que esse passo é teste e fica no `video.yml`.

- [ ] **Step 4: O `LEIA-ME-FONTES.txt`**

  A linha do `patches/<projeto>/` deixa de dizer "só quando houver" e passa a dizer a correção de hoje e para que serve, em uma frase. A frase do `VERSOES.txt` passa a dizer que ele lista também as correções.

- [ ] **Step 5: Conferir aqui o que dá para conferir sem montar o FreeSWITCH**

  Run: `bash -n` nos dois scripts e, se a máquina tiver, o `shellcheck` neles. Depois, num shell à parte, carregar só as duas funções (`source <(sed -n '/^nome() {/,/^}/p' script)`, com o `AQUI` e o `falhar` de cada script) e chamá-las numa pasta temporária: o `VERSOES.txt` com as linhas do `linhas_das_correcoes` passa; sem a linha, com o SHA trocado e com uma linha a mais, falha com o texto do passo 2.

  Expected: os quatro casos como descrito, guardados no relatório. O build de verdade e o conferir de verdade rodam no GitHub (passo 6).

- [ ] **Step 6: Commit, push e o GitHub**

  ```bash
  git commit -m "feat(video): o pacote do FreeSWITCH lista as correções, e o conferir as confere" -- video-servidor/freeswitch/construir.sh video-servidor/freeswitch/conferir-pacote.sh video-servidor/freeswitch/LEIA-ME-FONTES.txt .github/workflows/video.yml .github/workflows/video-release.yml
  git push origin reunioes-etapa-1
  ```

  Expected no workflow `video`: os builds montam de novo (o `construir.sh` mudou), o "Conferir o pacote" mostra `conferir: as 1 correções da pasta patches/`, o passo da recusa passa, e o `De ponta a ponta` continua com 34.

---

### Task 3: Os guias, o roteiro e a spec de 18/11

**Files:**
- Modify: `docs/video-servidor.md` (o passo 5, "Atualizar", e a entrada "A imagem congelou para todos, ou todos caíram da reunião ao mesmo tempo" do passo 9)
- Modify: `docs/teste-manual.md` (o bloco "Um defeito conhecido" antes da tabela da seção 26, uma seção 27 nova e a tabela "Onde cada critério")
- Modify: `docs/superpowers/specs/2026-11-18-starsonic-phone-reunioes-palco-design.md` (o risco 11)
- Modify: `docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md` (o status e a seção 5, com o resultado do GitHub)

**Interfaces:**
- Consumes: o nome do arquivo da correção (tarefa 1), a linha do `VERSOES.txt` (tarefa 2) e os números das rodadas do GitHub das duas tarefas.

- [ ] **Step 1: O guia do servidor de vídeo**

  - **Passo 5:** um parágrafo para a `0.1.0-rc.4`. Ela troca o FreeSWITCH pelo corrigido; o chat não muda, e não há ordem entre os dois. Depois de atualizar, o comando abaixo mostra a linha `patch freeswitch 0001-mod_conference-tamanho-na-thread-do-mosaico.patch`:
    ```
    cat /opt/starsonic-freeswitch/VERSOES.txt
    ```
  - **A entrada do passo 9:** passa a começar dizendo que era um defeito da `0.1.0-rc.3`, corrigido na `0.1.0-rc.4`, e que a primeira coisa a conferir é a linha do `VERSOES.txt`. O que fazer se a imagem congelar ou todos caírem continua lá, para quem ainda está na `rc.3` e para um caso parecido no futuro.

- [ ] **Step 2: O roteiro manual**

  - **O bloco antes da tabela da seção 26** encolhe: diz que o defeito é da `0.1.0-rc.3`, que a `0.1.0-rc.4` o corrige, e aponta para a entrada do guia.
  - **A seção 27, "A correção do FreeSWITCH (servidor de vídeo `0.1.0-rc.4`)"**, com as colunas das outras seções e estas linhas:

    | # | Passo | Resultado esperado |
    |---|---|---|
    | 27.1 | Atualize o servidor de vídeo para a `0.1.0-rc.4` (guia, passo 5) e rode o comando do `VERSOES.txt`. | A linha `patch freeswitch 0001-mod_conference-tamanho-na-thread-do-mosaico.patch`. |
    | 27.2 | Na reunião de teste, com o PC e o celular: compartilhe a tela e pare, 10 vezes seguidas. | A imagem nunca congela e ninguém cai. Os quadros voltam a cada vez. |
    | 27.3 | Com 4 aparelhos ou abas na reunião, entre e saia com um quinto, 5 vezes. | O mesmo: a passagem de 4 para 5 pessoas também muda o tamanho do mosaico. |
    | 27.4 | Na VM do vídeo, rode `sudo systemctl show starsonic-freeswitch -p NRestarts -p ActiveEnterTimestamp`. | `NRestarts=0`, e a hora é de antes do teste: o FreeSWITCH não reiniciou. |

  - **A tabela "Onde cada critério":** uma linha para a troca de tamanho que não congela nem derruba: o `esforco.spec.ts`, no GitHub com 4 processadores, e as linhas 27.2 e 27.3.

- [ ] **Step 3: As duas specs**

  - O risco 11 da spec de 18/11 ganha a frase final: resolvido na `0.1.0-rc.4` do servidor de vídeo, com o caminho da spec da correção.
  - A spec da correção: o status passa a dizer quando o responsável aprovou; a seção 5 ganha a linha do GitHub (4 processadores de verdade, os três sistemas, 34 testes); o risco 3 dela deixa de ser risco.

- [ ] **Step 4: Conferir e dar commit**

  Conferir: os comandos para o responsável ficam cada um num bloco, numa linha só e sem sublinhado; nenhum endereço ou nome de verdade; as tabelas do roteiro continuam com o mesmo número de colunas em todas as linhas.

  ```bash
  git commit -m "docs: a correção do FreeSWITCH na 0.1.0-rc.4 do servidor de vídeo" -- docs/video-servidor.md docs/teste-manual.md docs/superpowers/specs/2026-11-18-starsonic-phone-reunioes-palco-design.md docs/superpowers/specs/2026-11-19-starsonic-phone-freeswitch-troca-de-tamanho-design.md
  git push origin reunioes-etapa-1
  ```

---

## Depois das três tarefas

O responsável publica a `video-v0.1.0-rc.4` pelo `video-release`, atualiza a VM do vídeo com o comando do guia e roda a seção 27 do roteiro. O chat fica como está.

## Apêndice: a bancada dos 4 processadores

Só para a máquina de desenvolvimento, e fora do git (`work/fs-teste/`). Se a pasta não existir mais:

1. **O engano dos processadores**, compilado com `gcc -shared -fPIC -o fakecpu.so fakecpu.c -ldl`:
   ```c
   #define _GNU_SOURCE
   #include <dlfcn.h>
   #include <stdlib.h>
   #include <unistd.h>

   long sysconf(int name)
   {
   	static long (*real)(int) = 0;
   	if (!real) real = (long (*)(int)) dlsym(RTLD_NEXT, "sysconf");
   	if (name == _SC_NPROCESSORS_ONLN || name == _SC_NPROCESSORS_CONF) {
   		const char *e = getenv("FAKE_NCPU");
   		if (e && atol(e) > 0) return atol(e);
   	}
   	return real(name);
   }
   ```
2. **`original/bin/freeswitch`:** um script que, com o `NCPU_FALSO`, exporta `FAKE_NCPU` e o `LD_PRELOAD` com o `fakecpu.so`, e chama `/opt/starsonic-freeswitch/bin/freeswitch "$@"`.
3. **`corrigido/bin/freeswitch`:** o mesmo, com `-mod <pasta>/corrigido/mod` no fim. A pasta `corrigido/mod` tem os nove módulos de `/opt/starsonic-freeswitch/mod`, com o `mod_conference.so` trocado pelo da árvore corrigida (`make` em `src/mod/applications/mod_conference`; o arquivo sai em `.libs/`).

O retrato das threads (`gdb -p <pid> -batch -ex 'thread apply all bt 14'`) mostra `conference_video_layer_thread_run` quando o FreeSWITCH está mesmo usando as threads das pessoas.
