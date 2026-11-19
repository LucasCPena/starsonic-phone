# Reuniões com link, etapa 1c — o palco da reunião no navegador — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** na reunião do navegador, os quadros das pessoas ocupam a área toda (no PC e no celular), um clique aumenta o quadro de alguém (também durante o compartilhamento), e a tela compartilhada e as câmeras chegam mais nítidas, do jeito das telas 12 a 19 do quadro aprovado.

**Architecture:**
- **O servidor de vídeo** (`video-servidor/`) continua montando um mosaico só, agora com 1920 pontos de largura e 25 imagens por segundo.
  - Cada layout tem um tamanho de mosaico só dele, e toda célula tem uma reserva.
  - O agente escolhe a célula de cada pessoa, o layout, o tamanho e a banda, e manda o FreeSWITCH obedecer. A decisão é uma função pura (`internal/mosaico`), e o `internal/salas` manda os comandos.
  - O agente conta ao chat o "palco" de cada sala: o tamanho do mosaico e a célula de cada pessoa e da tela.
- **O chat** (`chat-servidor/`) repassa o palco a cada página aceita, com o nome de cada pessoa, e ouve da página se a câmera dela está ligada.
- **A página** recebe o mesmo vídeo, que fica fora da vista, e desenha um quadro por pessoa:
  - um módulo puro novo, o `palco.js`, arruma os quadros na área e junta o palco com o vídeo pelo tamanho da imagem;
  - uma camada nova da tela, o `quadros.js`, cria os quadros e pinta cada um com a célula da pessoa;
  - o cérebro (`estado.js`) guarda o palco e manda o aviso da câmera.
- **Os testes:** o Go do agente e do chat; o `node --test` do `palco.js` e do cérebro; o Playwright da página, com um mosaico de mentira; e de ponta a ponta, com o FreeSWITCH de verdade.

**Tech Stack:**
- **O Go de hoje** nos dois servidores, sem dependência nova.
- **A página:** JavaScript ES2020 em módulos, CSS e HTML, sem passo de build e sem pacote novo.
- **Os testes da página e os de ponta a ponta:** Node 22, `@playwright/test` 1.56.1 (o Chromium) e `typescript` 5.9.3, os de hoje.
- **O FreeSWITCH 1.11.3** do pacote de hoje, sem compilar de novo.

**Spec:** `docs/superpowers/specs/2026-11-18-starsonic-phone-reunioes-palco-design.md`. O responsável a aprovou em 18/11/2026, às 10:45. A seção 6 foi corrigida no mesmo dia, depois de dois testes com o FreeSWITCH de verdade (a seção 13 dela diz o que mudou), e a correção vale com o "sim" dele a este plano.
- **Vale a spec inteira.** Ela completa a de 12/11 (`2026-11-12-starsonic-phone-reunioes-link-design.md`).
- **O quadro "Starsonic — reunião no navegador"**, telas 12 a 19, foi aprovado em 18/11/2026. O código-fonte dessas telas está na pasta de trabalho deste plano, em `quadro/`: 8 arquivos `.dc.html`, que são a referência visual. Os textos e as medidas que contam estão neste plano.
- **Os contratos:**
  - `docs/video-agente.md`: a seção 5 (a API do agente) e a 7 (a reunião no FreeSWITCH);
  - `docs/chat-protocolo.md`: a seção 10 (a página e o canal) e a 12 (os limites).

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-1`. Cada tarefa dá commit e push a cada passo verde.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **Nada novo de fora:** nenhum módulo novo no `go.mod` de nenhum dos dois servidores, nenhum pacote novo nos `package.json`, e o pacote do FreeSWITCH não muda.
- **A página continua sem passo de build:** os arquivos servidos são os do repositório.
- **O CSP manda, e não muda:**
  - sem `<script>` nem `<style>` dentro do HTML, e sem atributo `style=`;
  - o JavaScript muda o lugar e o tamanho dos quadros pelo `elemento.style`, que o CSP deixa.
- **Nada guardado no navegador:** sem cookie, sem `localStorage` e sem `sessionStorage`.
- **O console da página** nunca mostra o bilhete, a senha, as credenciais do TURN, a chave de volta nem o palco (ele leva nomes).
- **Os registros dos servidores** não levam nomes, números, códigos de link, salas, participantes nem ids de ligação. Um comando que o FreeSWITCH recusa vai ao registro só com o nome do comando (`vid-res`, `vid-layout`, `vid-res-id` ou `vid-bandwidth`).
- **O repositório é público:** nenhum segredo, endereço de verdade ou nome de verdade em arquivo, teste ou registro. Os nomes dos testes são os inventados de hoje: Ana Souza, Carlos Lima, Maria Lima e Bia Ramos.
- **Os valores** são os da seção "O desenho", copiados da spec. Os principais:
  - o mosaico a 25 imagens por segundo, com `3mb` na grade e `4mb` com a tela;
  - `rtp_video_max_bandwidth_in` de `1500kb` na câmera e `2500kb` na tela;
  - a câmera pedida com 1280×720 a 30, e a tela com até 1920×1080 a 15;
  - as esperas da página: 600 ms, 1000 ms e 3000 ms;
  - o aviso da câmera: até 30 por minuto por canal.
- **Os textos** são os da seção "Os textos", letra por letra. Um texto novo precisa de uma ruling.
- **O visual** é o da seção "O visual", com as medidas do quadro.
- **A acessibilidade:**
  - todo quadro que se pode aumentar é um `<button>` de verdade, com o nome dito;
  - o foco do teclado é o anel ciano de 3 px, afastado 2 px;
  - o botão de voltar tem 44 px ou mais de altura;
  - o mouse em cima nunca depende só da cor.
- **A compatibilidade:**
  - a página nova com um servidor de vídeo antigo (sem o palco) mostra o mosaico inteiro, como hoje;
  - a senha de uso único não muda de formato: ela continua levando o nome, que o agente deixa de usar.
- **Os navegadores** (spec de 12/11, 6.4): Chrome, Edge, Firefox e Safari, no PC e no celular. Os testes automáticos rodam no Chromium. O Safari do iPhone entra no roteiro manual.
- **As versões** não ficam no código: quem escolhe o `rc` é a release (o chat `0.2.0-rc.4` e o vídeo `0.1.0-rc.3`).
- **Como rodar os testes:**
  - o Go, em `video-servidor/` e em `chat-servidor/`: `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 go test -race ./...`, com o `gofmt -l .` vazio e o `go vet ./...` limpo;
  - a página, em `chat-servidor/pagina/`: `node --test testes/*.test.mjs`, `npm run typecheck` e `npx playwright test`;
  - de ponta a ponta, em `video-servidor/e2e/`: `npm run typecheck` e `npx playwright test` (uns 8 minutos);
  - o Playwright roda com o `PLAYWRIGHT_BROWSERS_PATH` do ambiente.

## Review Focus

1. **A rede lenta: o palco chega bem antes da imagem.** Numa troca de layout, a imagem nova pode levar 1 segundo ou mais, e travar no meio. A pessoa espera nunca ver alguém no quadro de outro nome. A página só desenha os quadros quando o tamanho da imagem é o do palco. Testes na Task 4 (o `sincronizar`) e na Task 6 (o mosaico de mentira que muda de tamanho atrasado).
2. **Quem entra de novo** (a página recarregada, ou a rede que caiu e voltou). A pessoa espera voltar ao mesmo lugar, sem ninguém mudar de quadro. A ligação nova da mesma pessoa fica com a célula da anterior, e a ligação anterior que sai não solta a célula. Testes na Task 1 (o `Planejar`), na Task 2 (o `salas`) e na Task 7 (de ponta a ponta).
3. **Alguém sai e outro entra logo depois, na mesma célula.** Por até 1 segundo, a imagem que chega ainda é a de quem saiu. A pessoa espera nunca ver um rosto com o nome de outro: o quadro de quem acabou de entrar mostra o fundo escuro com o nome por 1 s. Testes na Task 4 e na Task 6.
4. **O celular que gira e a janela que muda de tamanho no meio da reunião.** A pessoa espera os quadros se arrumarem de novo, sem esticar a imagem e sem perder quem estava aumentado. Teste na Task 6.
5. **Os nomes fora do comum:** vazio (o chat reiniciou e não conhece quem já estava na reunião), com 80 caracteres, ou com sinais de HTML (`<b>Ana</b>`). A pessoa espera ver `Participante` no lugar do vazio, o nome comprido cortado com reticências dentro do quadro, e os sinais como texto. Testes na Task 3 (o chat repassa o vazio) e na Task 6.

## O visual

As medidas são as das telas 12 a 19 do quadro. As cores e as letras são as do design system da Starsonic no tema escuro, que a página já usa.

- **A área dos quadros** fica entre a faixa de cima e os controles da reunião, com o fundo `#0a0e1a`.
  - No PC e no celular deitado: a margem de 12 px em cima e embaixo e de 24 px dos lados, e 8 px entre os quadros.
  - No celular em pé (até 600 px de largura, com a altura maior que a largura): a margem de 8 px, e 6 px entre os quadros.
- **O quadro:**
  - os cantos de 12 px no PC (o grande e os da grade), e de 10 px na faixa e no celular;
  - o fundo `#1b2333` enquanto não há imagem;
  - **a etiqueta do nome**, embaixo, à esquerda, com o fundo `rgba(0, 0, 0, 0.55)`, a letra branca de peso 600 e uma linha só, cortada com reticências:

    | Onde | Do canto | Por dentro | Os cantos | A letra |
    |---|---|---|---|---|
    | O quadro grande, no PC | 14 px | 5 px 11 px | 6 px | 15 px |
    | A grade, no PC | 12 px | 4 px 9 px | 6 px | 14 px |
    | A faixa | 6 px | 2 px 7 px | 5 px | 12 px |
    | O quadro grande, no celular | 10 px | 4 px 9 px | 6 px | 13 px |
    | A grade, no celular | 6 px | 2 px 7 px | 5 px | 11,5 px |

  - **com o mouse em cima, ou com o foco do teclado,** num quadro que é botão: a borda `#00c2cb` de 3 px por dentro (`outline-offset: -3px`) e a pílula `Aumentar`, em cima, à direita. A pílula tem o fundo `#00c2cb`, a letra `#03222a` de peso 700 e o ícone de aumentar:

    | Onde | Do canto | Por dentro | A letra | O ícone |
    |---|---|---|---|---|
    | A grade | 12 px | 6 px 12 px | 13 px | 14 px |
    | A faixa | 6 px | 4 px 9 px | 11,5 px | 12 px |

  - **sem câmera:** o fundo `#1b2333` e o nome no centro, em `#dfe5f5`, com peso 700: 22 px na grade do PC e no quadro grande, e 14 px na faixa e no celular. Sem a etiqueta de baixo.
  - **esperando a imagem:** o fundo `#1b2333` e a etiqueta do nome.
- **A tela compartilhada:**
  - grande, ela aparece inteira, no centro de uma área de fundo `#070b18`;
  - a etiqueta dela tem o fundo `rgba(0, 0, 0, 0.72)` e o ícone do monitor (o `#i-tela`) antes do texto.
- **O Você:**
  - **flutuante no canto,** no PC: 208 px de largura, na proporção 16:9, a 16 px de baixo e da direita da área, com os cantos de 10 px, a borda de 2 px `#070b18` e a sombra `0 20px 46px -18px rgba(0, 0, 0, 0.52)`. A etiqueta fica a 8 px do canto, com 3 px 8 px por dentro e a letra de 12,5 px;
  - **flutuante no canto,** no celular em pé: 92 px de largura com uma pessoa na grade e 84 px com mais, na proporção 3:4, a 10 px de baixo e da direita. A etiqueta fica a 6 px do canto, com 2 px 6 px por dentro e a letra de 11 px;
  - **na faixa,** ele é o último quadro, igual aos outros;
  - a imagem dele é espelhada, e preenche o quadro.
- **A faixa:**
  - no PC: uma coluna de 228 px à direita, a 10 px do quadro grande, com os quadros de 228×128 e 8 px entre eles. Ela rola para baixo quando os quadros não cabem;
  - no celular em pé: uma linha embaixo, de 72 px de altura, com os quadros de 128×72 e 6 px entre eles. Ela rola para o lado.
- **O botão de voltar** fica sobre o quadro grande, a 14 px de cima e da esquerda: uma pílula de 44 px de altura mínima, com 8 px 16 px por dentro, a borda de 1 px `rgba(255, 255, 255, 0.28)`, o fundo `rgba(7, 11, 24, 0.78)` e a letra branca de 14 px e peso 700.
- **O aviso de girar,** no celular em pé com a tela compartilhada grande: uma linha no centro, com o ícone `#i-girar` de 16 px e a letra de 13 px em `#b9c4e6`.
- **O cartão "A conexão caiu"** continua por cima da área inteira.

## Os textos

- **As etiquetas:**
  - de uma pessoa: o nome dela. Com o nome vazio, `Participante`;
  - a sua: `Você`;
  - da tela: `Tela de <nome>`, e `A sua tela` para quem compartilha.
- **Os botões:** `Aumentar` (a pílula), `Ver todos` e `Voltar para a tela`.
- **O aviso do celular em pé com a tela grande:** `Gire o celular para ver a tela maior.` O aviso `Gire o celular para ver a reunião maior.` sai da página.
- **Os nomes ditos** (`aria-label`):

  | O quê | O texto |
  |---|---|
  | O quadro que é botão, com a câmera | `Aumentar a câmera de <nome>` |
  | O quadro que é botão, sem câmera | `Aumentar o quadro de <nome>, que está com a câmera desligada` |
  | A tela, na faixa | `Aumentar a tela de <nome>`, e `Aumentar a sua tela` para quem compartilha |
  | O quadro que não é botão, com a câmera | `A câmera de <nome>` |
  | O quadro que não é botão, sem câmera | `<nome>, com a câmera desligada` |
  | A tela grande | `A tela de <nome>`, e `A sua tela` para quem compartilha |
  | O Você | `A sua câmera` |
  | A faixa | `As outras pessoas`; com a tela grande, `As pessoas`; com uma câmera aumentada durante o compartilhamento, `A tela e as outras pessoas` |

- Os textos dos controles, do selo `Você está compartilhando a tela` e do `Parar de compartilhar` não mudam.

## O desenho

### O mosaico

As medidas dos layouts são as do FreeSWITCH, num quadro de 360×360 esticado sobre o mosaico: `(x, y, scale[, hscale])`. O `hscale` falta quando é igual ao `scale`. Em pontos: `x·L/360`, `y·A/360`, `scale·L/360` e `hscale·A/360`, com `L` e `A` do mosaico. Todos dão números inteiros.

| Layout | Pessoas | O mosaico | As imagens, na ordem (a reserva de cada uma) |
|---|---|---|---|
| `starsonic-4` | 1 a 4 | 1920×1080 | `c1` (0,0,180), `c2` (180,0,180), `c3` (0,180,180), `c4` (180,180,180) |
| `starsonic-9` | 5 a 9 | 1920×1086 | `c1` a `c9`: (x,y,120), com y em 0, 120 e 240 e, em cada linha, x em 0, 120 e 240 |
| `starsonic-12` | 10 a 12 | 1920×810 | `c1` a `c12`: (x,y,90,120), com y em 0, 120 e 240 e, em cada linha, x em 0, 90, 180 e 270 |
| `starsonic-apresentacao-2` | a tela e 0 a 2 | 1920×1620 | `tela` (0,0,360,240), `c1` (0,240,180,120), `c2` (180,240,180,120) |
| `starsonic-apresentacao-4` | a tela e 3 ou 4 | 1920×1350 | `tela` (0,0,360,288), `c1` a `c4`: (x,288,90,72), com x em 0, 90, 180 e 270 |
| `starsonic-apresentacao-12` | a tela e 5 a 12 | 1920×1440 | `tela` (0,0,360,270), `c1` a `c6`: (x,270,60,45), e `c7` a `c12`: (x,315,60,45), com x em 0, 60, 120, 180, 240 e 300 |

- **O perfil `starsonic`** da conferência: `video-canvas-size` `1920x1080`, `video-fps` `25`, `video-codec-bandwidth` `3mb` e `video-layout-name` `starsonic-4`. Não há mais grupo de layouts.
- **A banda:** `3mb` nos layouts da grade e `4mb` nos da apresentação.
- **Os comandos do agente,** todos com `conference <sala> ` na frente, e nesta ordem numa troca:
  1. `vid-res 1920x1086` (só quando o tamanho muda);
  2. `vid-layout starsonic-9` (só quando o layout muda);
  3. `vid-res-id <membro> c5 force` (para cada ligação de câmera que ganhou ou mudou de célula). O `force` é preciso: sem ele, repetir a mesma reserva a apaga;
  4. `vid-bandwidth 4mb '' 1` (só quando a banda muda). As aspas vazias e o `1` são precisos: sem o número do mosaico, o comando não muda a banda dele.
- **O `<membro>`** é o `Member-ID` do evento `add-member` (o `id` do `conference json_list`): só dígitos, de 1 a 10.
- **Um comando deu certo** quando a resposta começa com `+OK` e nenhuma linha dela começa com `-ERR`.
- **A tela** continua entrando com `video_reservation_id=tela`, posto pela discagem.

### As regras das células

1. Uma célula é de um participante, de `1` a `12`. Ele a ganha quando a primeira ligação de câmera dele entra: a menor célula livre.
2. Ele fica com ela enquanto tiver uma ligação de câmera na sala. A ligação nova do mesmo participante recebe a mesma célula.
3. O layout é o da tabela, pelo número de participantes com câmera e por haver ou não uma ligação de tela.
4. Quem está numa célula maior que o número de células do layout passa para a menor célula livre dele, na ordem das células.
5. Vários participantes sem célula ao mesmo tempo (depois do `Reconstruir`) a ganham na ordem do menor `<membro>` de cada um.
6. Com duas ligações de tela por um instante (uma tela nova toma o lugar da anterior), a tela do palco é a de maior `<membro>`.

### O palco, do agente para o chat

```json
{"tipo": "palco", "sala": "<32 hex>", "largura": 1920, "altura": 1080,
 "quadros": [{"participante": "<16 hex>", "tela": false, "x": 0, "y": 0, "l": 960, "a": 540}]}
```

- Os quadros vão nesta ordem: a tela, se houver, e depois as pessoas pela célula.
- O `estado` (o do `GET` e o dos eventos) leva o último palco de cada sala, no campo `palco` dela: `{"largura", "altura", "quadros"}`. A sala sem palco vai sem o campo.
- O agente manda o evento só quando o palco muda, e só depois de o FreeSWITCH aceitar o tamanho e o layout.

### O palco, do chat para a página, e o aviso da câmera

```json
{"tipo": "palco", "largura": 1920, "altura": 1080,
 "quadros": [{"quem": "<16 hex>", "nome": "Ana Souza", "voce": false, "tela": false, "semCamera": false,
              "x": 0, "y": 0, "l": 960, "a": 540}]}
```

```json
{"tipo": "camera", "ligada": false}
```

- O `voce` é verdadeiro nos quadros do participante que recebe a mensagem (a câmera e a tela dele).
- O `semCamera` é o último aviso da câmera daquele participante. Sem aviso, e na tela, é falso.
- O `nome` de quem o chat não conhece é `""`.

### O `palco.js`

```js
export const ESPERA_DO_TAMANHO_MS = 600;
export const ESPERA_DO_QUADRO_NOVO_MS = 1000;
export const PRAZO_SEM_PALCO_MS = 3000;
export const MARGEM_DO_RECORTE = 2;

/** A mensagem do canal vira o palco {largura, altura, quadros}, ou null se ela não vale. */
export function lerPalco(m)
/** A chave de um quadro do palco: 'tela:<quem>' ou 'cam:<quem>'. A do Você é 'voce'. */
export function chaveDe(quadro)
/** A memória da sincronia, no começo da ligação. */
export function sincroniaInicial(agora)
/** Junta o palco com o vídeo. O video é {l, a}, ou null sem imagem ainda. */
export function sincronizar(mem, { palco, video, agora })
// → { mem, modo: 'espera' | 'quadros' | 'mosaico', palco, esperando: [chaves], proximo: ms | null }
/** Quem fica aumentado depois de o palco mudar. */
export function aoMudarOPalco(aumentado, antes, depois)
/** Onde fica cada quadro. A area é {l, a}, em px. */
export function arrumar({ palco, area, emPe, aumentado })
// → { modo: 'grade' | 'grande', grande: chave | null, voltar: null | 'verTodos' | 'voltarParaATela',
//     gire: null | {x, y, l, a}, faixa: null | {eixo: 'x' | 'y', x, y, l, a, rotulo},
//     quadros: [{ chave, tipo: 'camera' | 'tela' | 'voce', quem, nome, semCamera, papel: 'grade' | 'grande' | 'faixa' | 'canto',
//                 botao, x, y, l, a, recorte: {x, y, l, a} | null, corte: 'cobrir' | 'inteiro' }] }
/** O pedaço do mosaico que vai ao quadro, e onde ele cai dentro do quadro. */
export function recortar(recorte, tamanho, corte)
// → { sx, sy, sl, sa, dx, dy, dl, da }
```

**As regras do `sincronizar`** (o "visto" é o palco que a página usa):

1. Sem palco, o modo é `espera` e, 3000 ms depois de a sincronia começar (ou de o palco sumir), `mosaico`.
2. Um palco novo com o tamanho do visto toma o lugar dele na hora.
3. Um palco novo de outro tamanho espera enquanto o vídeo tem o tamanho do visto. Quando o vídeo deixa de ter esse tamanho (ou não há visto, ou não há vídeo), o novo vira o visto.
4. Com o vídeo no tamanho do visto há 600 ms ou mais, o modo é `quadros`. Antes disso, `espera`.
5. Com o vídeo num tamanho que não é o do visto há 3000 ms ou mais, `mosaico`.
6. Sem vídeo e com palco, o modo é `espera`, sem prazo.
7. O `esperando` são as chaves dos quadros que mostram o fundo escuro com o nome: todas no modo `espera`, e, no modo `quadros`, as que entraram no visto há menos de 1000 ms.
8. O `proximo` é quanto falta para o resultado mudar só pelo tempo, ou `null`.

**As regras do `aoMudarOPalco`:** o aumentado volta a `null` quando uma tela aparece, quando a tela some, e quando o quadro aumentado não está mais no palco. No resto, fica como estava.

**As regras do `arrumar`** (as da spec, 4.2, com estas medidas):

- **Quem entra:** os "outros" são os quadros de câmera sem o `voce`, na ordem do palco. A tela é o quadro com `tela`. O Você entra sempre, também sem palco e sem quadro dele no palco.
- **O grande:** a tela, quando há uma e nenhuma câmera aumentada; ou a câmera aumentada. Sem os dois, o modo é `grade`.
- **O `voltar`:** `verTodos` com uma câmera aumentada sem tela; `voltarParaATela` com uma câmera aumentada com tela.
- **O `botao`:** os quadros da faixa, menos o Você; e os da grade, quando há 2 outros ou mais, ou quando estão embaixo da tela no celular em pé. O grande e o Você nunca.
- **O `recorte`** da câmera é a célula menos 2 pontos de cada lado, com o corte `cobrir`. O da tela é a célula inteira, com o corte `inteiro`. O do Você é `null`.
- **Os números** saem inteiros, pelo `Math.round` de cada `x`, `y`, `l` e `a`.
- **No PC e no celular deitado** (`emPe` falso), com o espaço de 8 px:
  - **a grade:** para cada número de colunas `c` de 1 a `n`, as linhas são `ceil(n / c)`, e a célula tem `(L − 8·(c−1)) / c` por `(A − 8·(linhas−1)) / linhas`. O quadro é o maior que cabe na célula com a proporção entre 4:3 e 2:1. Vale o `c` que dá o quadro de maior área (no empate, o menor `c`). Cada linha fica no centro da largura, e o bloco, no centro da altura;
  - sozinho, o Você ocupa o lugar de um quadro da grade;
  - **o canto:** o Você com `l = min(208, max(96, round(0,17·L)))`, na proporção 16:9, a 16 px de baixo e da direita;
  - **a faixa:** a coluna da direita, com `l = min(228, max(132, round(0,185·L)))` e os quadros 16:9, um embaixo do outro, com 8 px entre eles. O grande ocupa o que sobra à esquerda, menos 10 px, com a mesma regra da proporção para a câmera, no centro;
  - **a ordem da faixa:** a tela (quando uma câmera está aumentada durante o compartilhamento), os outros que não estão grandes, e o Você por último.
- **No celular em pé** (`emPe` verdadeiro), com o espaço de 6 px:
  - **a grade:** uma coluna até 3 outros, e duas com mais. Cada quadro ocupa a célula inteira. Com duas colunas e um número ímpar, o último ocupa a linha inteira;
  - **o canto:** o Você com 92 px de largura com 1 outro e 84 px com mais, na proporção 3:4, a 10 px de baixo e da direita;
  - **uma câmera aumentada:** o grande em cima, com `A − 72 − 6` de altura, e a faixa embaixo, uma linha de 72 px com os quadros de 128×72;
  - **a tela grande:** a tela em cima, com a largura toda e `round(L·9/16)` de altura; 6 px abaixo, o aviso de girar, com 28 px de altura; 6 px abaixo dele, os outros e o Você por último, em duas colunas que ocupam o resto da altura.

### A página, por dentro

- **O vídeo do mosaico** (`#mosaico`) continua no HTML e tocando. Nos modos `espera` e `quadros`, a moldura dele fica fora da vista (1 px, cortada, sem `display: none`). No modo `mosaico`, ela aparece como hoje, e os quadros somem.
- **Cada quadro** leva no elemento: `data-quadro` (a chave), `data-papel` (o papel) e `data-mostra` (`video`, `espera` ou `sem-camera`). Os testes os leem.
- **O tempo** vem sempre do `relogio` da página (`agora()` e `depois()`), nunca do `performance.now()`: os testes param o relógio.
- **O tamanho da imagem** é o `width` e o `height` que o `requestVideoFrameCallback` dá. Sem ele, o `videoWidth` e o `videoHeight` do elemento, lidos a cada `requestAnimationFrame`.

## Os arquivos

- **O servidor de vídeo:**
  - `video-servidor/internal/mosaico/` (novo): `layouts.go` (a tabela e as medidas), `arranjo.go` (as células, os comandos e o palco) e os testes. Puro: sem rede e sem relógio;
  - `video-servidor/internal/gerar/`: o `camadas.go` sai; o `freeswitch.go` e o `modelos/freeswitch.xml` passam a usar a tabela do `mosaico`;
  - `video-servidor/internal/salas/salas.go`: a ligação ganha o `<membro>` e a célula, e a sala manda os comandos e avisa o palco;
  - `video-servidor/internal/api/`: o evento `palco` e o `palco` do `estado`;
  - `video-servidor/internal/discagem/discagem.go`: sem o nome no quadro, e com as bandas novas;
  - `video-servidor/e2e/`: os pontos do mosaico novo (Task 2) e os testes do palco (Task 7).
- **O chat:**
  - `chat-servidor/internal/video/cliente.go`: o palco nos eventos e no estado;
  - `chat-servidor/internal/reunioes/palco.go` (novo): o palco de cada sala, o repasse e o aviso da câmera;
  - `chat-servidor/internal/reunioes/eventos.go` e `pedidos.go`: os pontos em que o palco chega e sai;
  - `chat-servidor/internal/api/pagina.go`: a mensagem `camera` e o limite dela.
- **A página** (`chat-servidor/internal/pagina/`):
  - `estatico/palco.js` (novo, puro) e `estatico/quadros.js` (novo, a tela);
  - `estatico/estado.js`, `estatico/pagina.js`, `estatico/midia.js` e `estatico/ligacao.js`;
  - `pagina.html` e `estatico/pagina.css`.
- **Os testes da página** (`chat-servidor/pagina/`): `testes/palco.test.mjs` e `testes/palco.spec.ts` (novos), `testes/estado.test.mjs`, `testes/telas.spec.ts` e `testes/tela.spec.ts`.
- **Os guias:** `docs/video-agente.md`, `docs/chat-protocolo.md`, `docs/video-servidor.md`, `docs/chat-servidor.md`, `docs/build-notes.md` e `docs/teste-manual.md`.

---

### Task 1: O mosaico puro: os layouts, as células e o palco

**Files:**
- Create: `video-servidor/internal/mosaico/layouts.go`, `video-servidor/internal/mosaico/arranjo.go`
- Test: `video-servidor/internal/mosaico/layouts_test.go`, `video-servidor/internal/mosaico/arranjo_test.go`

**Interfaces:**
- Consumes: nada.
- Produces (o que as Tasks 2 e 3 usam):

```go
package mosaico

const (
	ReservaDaTela = "tela"
	BandaDaGrade  = "3mb"
	BandaDaTela   = "4mb"
	LayoutInicial = "starsonic-4" // o do perfil da conferência
	ImagensPorSegundo = 25
)

type Imagem struct {
	X, Y, Scale, HScale int // HScale 0: igual ao Scale
	Reserva             string
}
type Layout struct {
	Nome            string
	Largura, Altura int
	Imagens         []Imagem
}

func Layouts() []Layout                 // os seis, na ordem da tabela; uma cópia
func Grade(pessoas int) Layout          // starsonic-4, -9 ou -12
func Apresentacao(pessoas int) Layout   // starsonic-apresentacao-2, -4 ou -12
func Reserva(celula int) string         // 3 → "c3"
func (l Layout) Celulas() int           // as imagens que não são a tela
func (l Layout) Retangulo(reserva string) (x, y, largura, altura int, ok bool) // em pontos do mosaico

type Quadro struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	L            int    `json:"l"`
	A            int    `json:"a"`
}
type Palco struct {
	Largura int      `json:"largura"`
	Altura  int      `json:"altura"`
	Quadros []Quadro `json:"quadros"`
}

type Chamada struct {
	UUID, Membro, Participante string
	Tela                       bool
	Celula                     int // a célula já dita ao FreeSWITCH para esta ligação; 0: nenhuma
}
type Estado struct {
	Layout, Banda string         // os aplicados; "": desconhecidos
	Celulas       map[string]int // participante → célula
}
type Comando struct {
	Tipo   string // "res", "layout", "celula" ou "banda"
	Texto  string // o comando, sem o "conference <sala> " da frente
	UUID   string // no "celula": a ligação que recebe a reserva
	Celula int    // no "celula": a célula
}
type Plano struct {
	Layout, Banda string
	Celulas       map[string]int
	Comandos      []Comando
	Palco         Palco
}

func EstadoInicial() Estado // o de uma conferência nova: LayoutInicial, BandaDaGrade, sem células
func Planejar(antes Estado, chamadas []Chamada, tudo bool) Plano
```

- [ ] **Step 1: Os testes da tabela** (`layouts_test.go`).

```go
// TestLayouts_Tabela: os seis nomes, na ordem, com (Largura, Altura, nº de imagens):
//   starsonic-4 (1920,1080,4), starsonic-9 (1920,1086,9), starsonic-12 (1920,810,12),
//   starsonic-apresentacao-2 (1920,1620,3), -4 (1920,1350,5), -12 (1920,1440,13)
// e as reservas, na ordem: c1..cN; nas apresentações, "tela" primeiro.
// TestLayouts_PontosInteiros: em toda imagem, Largura*X, Largura*Scale, Altura*Y e Altura*hscale dividem por 360 sem resto.
// TestLayouts_TamanhosDiferentes: os seis pares (Largura, Altura) são diferentes entre si.
// TestLayouts_SemSobrepor: em cada layout, nenhum retângulo passa do mosaico nem cruza outro.
// TestLayouts_Retangulo:
//   starsonic-4 c4 → (960,540,960,540)          starsonic-9 c5 → (640,362,640,362)
//   starsonic-12 c12 → (1440,540,480,270)       apresentacao-2 c2 → (960,1080,960,540)
//   apresentacao-4 c4 → (1440,1080,480,270)     apresentacao-12 c7 → (0,1260,320,180)
//   "tela" nas três apresentações → (0,0,1920,1080); "c5" no starsonic-4 → ok falso
// TestLayouts_Escolha: Grade(0..4)=starsonic-4, (5..9)=-9, (10..12)=-12;
//   Apresentacao(0..2)=-2, (3..4)=-4, (5..12)=-12
// TestLayouts_Copia: mudar o que o Layouts() devolve não muda a chamada seguinte.
```

- [ ] **Step 2: Os testes do arranjo** (`arranjo_test.go`). Os participantes: `ana`, `carlos`, `bia`, `davi`, `eva` (16 hex cada um), com os membros `1` a `5` na ordem de entrada. O `Texto` de cada comando, na ordem, e o palco:

```go
// TestPlanejar_QuemEntraPegaAMenorLivre: de EstadoInicial, um por vez:
//   ana → ["vid-res-id 1 c1 force"], palco 1920x1080 [ana 0,0,960,540]
//   carlos → ["vid-res-id 2 c2 force"], quadros ana (0,0), carlos (960,0)
//   bia → c3 (0,540); davi → c4 (960,540)
// TestPlanejar_QuemSaiDoMeioNaoMexeNosOutros: ana, carlos e bia; carlos sai → nenhum comando,
//   palco [ana 0,0,960,540; bia 0,540,960,540]; davi entra → ["vid-res-id 4 c2 force"]
// TestPlanejar_DeQuatroParaCinco: com as 4, eva entra →
//   ["vid-res 1920x1086", "vid-layout starsonic-9", "vid-res-id 5 c5 force"]; palco 1920x1086; eva (640,362,640,362)
// TestPlanejar_DeCincoParaQuatro: carlos sai →
//   ["vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 5 c2 force"]; eva (960,0,960,540)
// TestPlanejar_Dez: a décima pessoa → "vid-res 1920x810", "vid-layout starsonic-12", e a reserva dela, c10
// TestPlanejar_ATelaEntra: ana e carlos, e a tela da ana (membro 3) →
//   ["vid-res 1920x1620", "vid-layout starsonic-apresentacao-2", "vid-bandwidth 4mb '' 1"];
//   palco 1920x1620 [ana tela 0,0,1920,1080; ana 0,1080,960,540; carlos 960,1080,960,540]
// TestPlanejar_ATelaAperta: ana na c1 e bia na c3, e a tela →
//   [..., "vid-layout starsonic-apresentacao-2", "vid-res-id 3 c2 force", "vid-bandwidth 4mb '' 1"]
// TestPlanejar_ATelaComTres: 3 pessoas → 1920x1350, starsonic-apresentacao-4; com 5 → 1920x1440, -12
// TestPlanejar_ATelaSai: → ["vid-res 1920x1080", "vid-layout starsonic-4", "vid-bandwidth 3mb '' 1"]
// TestPlanejar_AMesmaPessoaDeNovo: ana com a ligação do membro 1 (Celula 1) e a do membro 7 (Celula 0) →
//   ["vid-res-id 7 c1 force"], e o palco tem um quadro só da ana
// TestPlanejar_AAnteriorSai: depois, a ligação do membro 1 some da lista → nenhum comando, o mesmo palco
// TestPlanejar_DuasTelas: a tela da ana (membro 3) e a do carlos (membro 6) → o quadro da tela é do carlos
// TestPlanejar_Tudo: Estado{} e tudo verdadeiro, com os membros 4 (bia), 9 (ana) e 2 (carlos) →
//   ["vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 2 c1 force", "vid-res-id 4 c2 force",
//    "vid-res-id 9 c3 force", "vid-bandwidth 3mb '' 1"]
// TestPlanejar_SemMudanca: o plano de novo, com o estado e as células dele → nenhum comando e o mesmo palco
// TestPlanejar_NaoMudaAEntrada: o mapa Celulas do Estado recebido fica como estava
// TestPlanejar_SemNinguem: sem chamadas → nenhum comando e o palco sem quadros
```

- [ ] **Step 3: Rodar e ver falhar.** `go test ./internal/mosaico/`. Esperado: FAIL (o pacote não existe).
- [ ] **Step 4: O `layouts.go`,** com a tabela da seção "O mosaico" e as funções do bloco de cima.
- [ ] **Step 5: O `arranjo.go`,** com as regras das células e os comandos da seção "O desenho". Os comandos de `celula` saem na ordem do `<membro>`, como número. O `tudo` manda os quatro tipos de comando, mesmo sem mudança.
- [ ] **Step 6: Rodar.** `go test -race ./internal/mosaico/`, o `gofmt` e o `go vet`. Esperado: PASS.
- [ ] **Step 7: Commit e push.**

### Task 2: O agente põe cada pessoa na célula dela e conta o palco

**Files:**
- Modify: `video-servidor/internal/gerar/freeswitch.go`, `video-servidor/internal/gerar/modelos/freeswitch.xml`, `video-servidor/internal/gerar/gerar_test.go`
- Delete: `video-servidor/internal/gerar/camadas.go`
- Modify: `video-servidor/internal/salas/salas.go`, `video-servidor/internal/salas/salas_test.go`
- Modify: `video-servidor/internal/api/api.go`, `video-servidor/internal/api/eventos.go`, `video-servidor/internal/api/api_test.go`
- Modify: `video-servidor/internal/discagem/discagem.go`, `video-servidor/internal/discagem/discagem_test.go`
- Modify: `video-servidor/e2e/midia.ts`, `video-servidor/e2e/navegador.ts`, `video-servidor/e2e/reuniao.spec.ts`, `video-servidor/e2e/pagina.spec.ts`
- Modify: `docs/video-agente.md` (seções 5 e 7)

**Interfaces:**
- Consumes: o `mosaico` da Task 1.
- Produces:
  - o `freeswitch.xml` com os seis layouts, cada imagem com o `reservation_id`, e o perfil da seção "O mosaico";
  - `salas.Aviso` com o `Tipo` `"palco"` e o campo `Palco *mosaico.Palco`; `salas.Sala` com `Palco *mosaico.Palco` (`json:"palco,omitempty"`);
  - o evento `palco` e o `palco` do `estado`, como na seção "O palco, do agente para o chat";
  - no e2e: `MOSAICO_1`, `MOSAICO_2`, `MOSAICO_4`, `FUNDO_DO_MOSAICO_2`, `TELA_2`, `PESSOAS_2`, `TELA_4` e `PESSOAS_4` (os pontos, em frações do vídeo), e `tamanho()` no `Navegador` e na `Pagina` (o `videoWidth` e o `videoHeight` do vídeo recebido).

- [ ] **Step 1: Os testes do `gerar`.**

```go
// TestFreeSWITCH_Perfil: video-mode=mux, video-layout-name=starsonic-4, video-canvas-size=1920x1080,
//   video-fps=25, video-codec-bandwidth=3mb; os outros parâmetros como hoje.
// TestFreeSWITCH_Layouts: os <layout> são os de mosaico.Layouts(), na ordem; cada <image> tem o x, o y, o scale,
//   o hscale (só quando não é 0) e o reservation_id da tabela. Nenhuma <image> sem reservation_id.
// TestFreeSWITCH_SemGrupo: o XML não tem <groups>, "starsonic-grade", "starsonic-1", "starsonic-2" nem "starsonic-6".
```

- [ ] **Step 2: Os testes da discagem.** As ações da câmera, na ordem de hoje, sem a `video_banner_text` e com `set rtp_video_max_bandwidth_in=1500kb`. As da tela, com `2500kb` e a `video_reservation_id=tela`. Nenhuma ação leva o nome da pessoa.
- [ ] **Step 3: Os testes do `salas`.** O `entra` dos testes ganha o `Member-ID`. Os comandos, na ordem, com `conference <salaA> ` na frente:

```go
// TestSalas_Celulas: ana (membro 1) entra → comandos ["vid-res-id 1 c1 force"];
//   avisos [entrou ana, palco {1920,1080,[ana 0,0,960,540]}]. carlos (2) → "vid-res-id 2 c2 force" e outro palco.
// TestSalas_CincoPessoas: a quinta → ["vid-res 1920x1086", "vid-layout starsonic-9", "vid-res-id 5 c5 force"], palco 1920x1086.
// TestSalas_Tela: ana e carlos; a tela da ana entra →
//   ["vid-res 1920x1620", "vid-layout starsonic-apresentacao-2", "vid-bandwidth 4mb '' 1"], e o palco com a tela primeiro;
//   ela sai → ["vid-res 1920x1080", "vid-layout starsonic-4", "vid-bandwidth 3mb '' 1"], e o palco sem a tela.
// TestSalas_TelaSemAPrincipal: como hoje: só o uuid_kill dela. Nenhum comando do mosaico e nenhum palco.
// TestSalas_TelaNova: a tela do carlos com a da ana no ar → o palco passa a ter a tela do carlos, e o uuid_kill da tela da ana sai depois.
// TestSalas_PrincipalNovaTomaOLugar: a ligação nova da ana (membro 7) → ["vid-res-id 7 c1 force", "uuid_kill <a anterior>"],
//   sem palco novo. O del-member da anterior: nenhum comando, nenhum saiu e nenhum palco.
// TestSalas_QuemSaiSoltaACelula: ana, carlos e bia; carlos sai → o palco sem ele e nenhum comando; davi entra → "vid-res-id 4 c2 force".
// TestSalas_ComandoRecusado: o "vid-layout starsonic-9" responde -ERR → nenhum palco novo, e uma linha no registro
//   que tem "vid-layout" e não tem a sala nem o participante. A entrada seguinte manda de novo o vid-res e o vid-layout.
// TestSalas_ReservaRecusada: o vid-res-id responde sem o +OK → o palco sai assim mesmo, e a entrada seguinte manda a reserva de novo.
// TestSalas_BandaRecusada: o vid-bandwidth responde "+OK Set Bandwidth 4096 kps for member x\n-ERR Bandwidth not set" →
//   o palco sai, e a mudança seguinte da sala manda a banda de novo.
// TestSalas_MembroQueNaoVale: o add-member sem Member-ID, ou com "1 2" → a ligação fica fora da sala, como a de uuid que não vale.
// TestSalas_Estado_ComOPalco: o Estado() leva o último palco de cada sala; depois do acabou e do Esvaziar, não.
// TestSalas_Reconstruir_PoeTodosNoLugar: o json_list com os ids 4, 9 e 2 → depois da leitura, os comandos
//   ["vid-res 1920x1080", "vid-layout starsonic-4", "vid-res-id 2 c1 force", "vid-res-id 4 c2 force",
//    "vid-res-id 9 c3 force", "vid-bandwidth 3mb '' 1"]; nenhum aviso; o Estado() com o palco.
// TestSalas_Reconstruir_EventosDuranteALeitura: o de hoje, e mais: durante a leitura, nenhum comando do mosaico.
// TestSalas_ComandosForaDoMutex e TestSalas_Concorrencia: continuam passando, com o -race.
```

- [ ] **Step 4: Os testes da API.**

```go
// TestAPI_Eventos_Palco: o aviso palco sai como
//   {"tipo":"palco","sala":"<salaA>","largura":1920,"altura":1080,
//    "quadros":[{"participante":"<ana>","tela":false,"x":0,"y":0,"l":960,"a":540}]}
// TestAPI_Estado_Palco: no GET estado e no evento estado, a sala com palco tem "palco":{...}; a sala sem palco não tem o campo.
```

- [ ] **Step 5: Rodar e ver falhar.** `go test ./internal/gerar/ ./internal/salas/ ./internal/api/ ./internal/discagem/`. Esperado: FAIL.
- [ ] **Step 6: O `gerar`.** A tabela vem do `mosaico.Layouts()`. O modelo perde o grupo e escreve o `reservation_id` em toda imagem. O `camadas.go` sai.
- [ ] **Step 7: A discagem.** Sai a ação `video_banner_text`, e o que só ela usava (o estilo do quadro, o `Tela de ` e a limpeza do nome, se nada mais os usa). A banda de entrada vira `1500kb`, ou `2500kb` na tela.
- [ ] **Step 8: O `salas`.**
  - A ligação guarda o `<membro>` e a célula já dita ao FreeSWITCH. O `<membro>` vem do `Member-ID` do `add-member` e do `id` do `json_list`.
  - Cada sala guarda um `mosaico.Estado` e o último palco avisado. Eles nascem com o `EstadoInicial()` na primeira ligação e saem no `acabou` e no `Esvaziar`.
  - Um método novo, o arrumar, chama o `mosaico.Planejar` e manda os comandos, na ordem, fora do mutex do estado. Só um arrumar roda por vez (um mutex só para isso).
  - **Quando ele roda:** no fim do `entrou` e do `saiu`. No `entrou` de uma ligação que toma o lugar de outra, ele roda antes dos `uuid_kill`. Na tela sem a principal, ele não roda. Enquanto um `Reconstruir` lê, ele não faz nada.
  - **O que dá certo fica:** a célula de uma ligação é guardada quando o `vid-res-id` dela dá certo; o layout, quando o `vid-res` e o `vid-layout` dão certo; a banda, quando o `vid-bandwidth` dá certo. As células do plano ficam sempre.
  - **O que falha:** com o `vid-res` ou o `vid-layout` recusado, o arrumar para ali, e nenhum palco sai. Com o `vid-res-id` ou o `vid-bandwidth` recusado, ele segue. Cada recusa escreve uma linha de aviso, só com o nome do comando.
  - **O palco** sai como um aviso quando é diferente do último, depois dos comandos, e só com o layout aplicado.
  - **O `Reconstruir`,** depois de juntar o que leu e de a leitura acabar, arruma cada sala com o `tudo`, a partir de um `Estado` vazio. Ele continua sem avisar nada.
- [ ] **Step 9: A API.** O `Avisar` ganha o `palco`, e o `estado` leva o `Palco` de cada sala.
- [ ] **Step 10: Rodar.** `go test -race ./...` em `video-servidor/`, o `gofmt` e o `go vet`. Esperado: PASS.
- [ ] **Step 11: O e2e acompanha o mosaico novo.**
  - No `midia.ts`, os pontos, em frações do vídeo:
    - `MOSAICO_1` `[[0.25, 0.25]]`; `MOSAICO_2` `[[0.25, 0.25], [0.75, 0.25]]`; `MOSAICO_4` como hoje;
    - `FUNDO_DO_MOSAICO_2` `[[0.25, 0.75], [0.75, 0.75]]`;
    - `TELA_2` `[0.5, 1/3]` e `PESSOAS_2` `[[0.25, 5/6], [0.75, 5/6]]`;
    - `TELA_4` `[0.5, 0.4]` e `PESSOAS_4` `[[1/8, 0.9], [3/8, 0.9], [5/8, 0.9], [7/8, 0.9]]`;
    - saem o `TELA`, o `QUADROS_PEQUENOS` e o `FAIXAS_DO_MOSAICO_2`.
  - No `navegador.ts`: sai o `esperarNomesNoMosaicoDe2`; entram o `tamanho()` e o `esperarTamanho(largura, altura)`.
  - Nos testes de hoje:
    - o de duas câmeras confere `1920×1080` e, no lugar dos nomes, que o pé de cada quadro (`[0.25, 0.49]` e `[0.75, 0.49]`) tem a cor da câmera;
    - os da tela, com 2 pessoas, conferem `1920×1620`, o `TELA_2` verde e as duas cores no `PESSOAS_2`, e a volta a `1920×1080`;
    - o da tela de quem foi tirado olha o `MOSAICO_1` e o tamanho, que não mudam. O comentário dele passa a dizer que o layout só muda por um comando do agente;
    - os que esperam o mosaico de 1, de 2 e de 4 usam os pontos novos, também o do `seguranca.spec.ts`.
- [ ] **Step 12: Rodar o e2e.** `npm run typecheck` e `npx playwright test`, em `video-servidor/e2e/`. Esperado: os 24 testes passam.
- [ ] **Step 13: O guia do agente** (`docs/video-agente.md`).
  - Na seção 5: o evento `palco` e o `palco` do `estado`, com o exemplo e as regras da seção "O palco, do agente para o chat".
  - Na seção 7: o perfil novo, a tabela dos seis layouts com o tamanho de cada um, as regras das células, os quatro comandos e a ordem deles, as bandas, e o fim do nome no quadro. O quadro de quem está sem câmera continua, sem o nome.
- [ ] **Step 14: Commit e push.**

### Task 3: O chat repassa o palco e ouve a câmera

**Files:**
- Modify: `chat-servidor/internal/video/cliente.go`, `chat-servidor/internal/video/cliente_test.go`
- Create: `chat-servidor/internal/reunioes/palco.go`, `chat-servidor/internal/reunioes/palco_test.go`
- Modify: `chat-servidor/internal/reunioes/gerente.go` (a sala e o participante), `eventos.go`, `pedidos.go`
- Modify: `chat-servidor/internal/api/pagina.go`, `chat-servidor/internal/api/pagina_test.go`
- Modify: `docs/chat-protocolo.md` (seções 10 e 12)

**Interfaces:**
- Consumes: o evento `palco` e o `palco` do `estado`, do agente (Task 2).
- Produces:

```go
// internal/video
type Quadro struct {
	Participante string `json:"participante"`
	Tela         bool   `json:"tela"`
	X, Y, L, A   int    // json: "x", "y", "l", "a"
}
type Palco struct {
	Largura int      `json:"largura"`
	Altura  int      `json:"altura"`
	Quadros []Quadro `json:"quadros"`
}
// Sala ganha Palco *Palco `json:"palco"`; Evento ganha Largura, Altura e Quadros, para o tipo "palco".

// internal/reunioes
func (g *Gerente) Camera(p *Pedido, ligada bool) error // ErrForaDeOrdem antes do aceito e depois do fim
```

  - a mensagem `palco` para a página e a mensagem `camera` da página, como na seção "O palco, do chat para a página, e o aviso da câmera".

- [ ] **Step 1: Os testes do cliente do vídeo.** `TestAcompanhar_Palco`: a linha do evento `palco` vira o `Evento` com a sala, o tamanho e os quadros. `TestEstado_Palco`: o `estado` com e sem o `palco` numa sala.
- [ ] **Step 2: Os testes do gerente** (`palco_test.go`, com a cena de hoje). A reunião marcada, com a Ana (colega, pelo app), a Maria e a Bia (de fora, aceitas, cada uma com o canal dela):

```go
// TestPalco_VaiAsPaginasAceitas: o agente manda o palco [ana c1, maria c2] → o canal da Maria recebe
//   {"tipo":"palco","largura":1920,"altura":1080,"quadros":[
//     {"quem":"<ana>","nome":"Ana Souza","voce":false,"tela":false,"semCamera":false,"x":0,"y":0,"l":960,"a":540},
//     {"quem":"<maria>","nome":"Maria Lima","voce":true,"tela":false,"semCamera":false,"x":960,"y":0,"l":960,"a":540}]}
//   o da Bia recebe o mesmo, com o voce falso nos dois. Quem ainda espera não recebe nada, e os apps não recebem evento novo.
// TestPalco_DepoisDoAceito: com o palco já na sala, a página aceita recebe o aceito e, logo depois, o palco.
// TestPalco_DepoisDoVoltou: o voltou e, logo depois, o palco.
// TestPalco_Tela: o quadro da tela da Maria vai com o quem e o nome dela, tela verdadeiro, semCamera falso,
//   e voce verdadeiro só na mensagem dela.
// TestPalco_Desconhecido: o quadro de um participante que a sala não conhece vai com "nome":"".
// TestPalco_Repetido: o mesmo palco duas vezes → uma mensagem só.
// TestPalco_NoEstado: o estado com o palco de uma sala o manda; o estado sem ele faz o chat esquecê-lo, sem mensagem.
// TestPalco_QueNaoVale: a largura 0; a altura 9000; 14 quadros; um quadro que passa do mosaico; um l ou um a menor que 16;
//   um participante que não tem 16 hexadecimais → nada muda, nada sai, e uma linha no registro, sem ids.
// TestPalco_ReuniaoQueAcaba: depois do acabou, a sala não guarda mais o palco.
// TestCamera_Desligada: Camera(pedido da Maria, false) → as duas páginas recebem o palco com "semCamera":true no quadro dela;
//   de novo false → nada sai; true → o palco sai com false.
// TestCamera_SemPalco: sem palco na sala, o aviso fica guardado, e o primeiro palco já sai com ele.
// TestCamera_ForaDeOrdem: o pedido nulo, o que ainda espera e o que acabou → ErrForaDeOrdem.
// TestPalco_SemNomesNoLog: o registro da cena inteira passa pelo conferirLog.
```

- [ ] **Step 3: Os testes do canal** (`pagina_test.go`).

```go
// TestCanal_Camera: depois do aceito, {"tipo":"camera","ligada":false} não tem resposta, e o palco chega com o semCamera.
// TestCanal_Camera_AntesDoAceito: → {"tipo":"erro","erro":"invalido"}.
// TestCanal_Camera_QueNaoVale: {"tipo":"camera"} e {"tipo":"camera","ligada":"sim"} → erro invalido.
// TestCanal_Camera_Limite: 30 num minuto mudam o palco; a 31ª não muda nada e não tem resposta.
// TestCanal_Camera_NaoContaNasVinte: depois de 30 avisos da câmera, um senha ainda responde senha;
//   e depois de 20 outras mensagens, um aviso da câmera ainda vale.
// TestCanal_Camera_DepoisDoVoltou: o aviso da câmera é a primeira mensagem depois do voltou → a chave anterior para de valer.
```

- [ ] **Step 4: Rodar e ver falhar.** `go test ./internal/video/ ./internal/reunioes/ ./internal/api/`. Esperado: FAIL.
- [ ] **Step 5: O cliente do vídeo:** os tipos do bloco de cima.
- [ ] **Step 6: O gerente.**
  - A sala guarda o último palco que vale, e o participante, o `semCamera`.
  - O evento `palco` e o `estado` chegam pelo `evento()`, com o mutex, e as mensagens saem pela fila de saída, como as outras.
  - O palco vale com: a largura de 16 a 7680, a altura de 16 a 4320, até 13 quadros, cada um dentro do mosaico, com 16 ou mais de largura e de altura, e com o participante de 16 hexadecimais minúsculos.
  - Cada página aceita com o canal aberto recebe a mensagem montada para ela: depois do `aceito`, depois do `voltou`, e quando o palco ou um `semCamera` muda.
  - A sala que acaba esquece o palco.
- [ ] **Step 7: O canal.**
  - O canal lê o `tipo` antes dos limites. O `camera` tem a janela dele, de 30 por minuto (`maxCamerasCanal`), e não gasta a das 20. O que passa das 30 é ignorado, sem resposta.
  - O `ligada` tem de ser um booleano.
  - O `ErrForaDeOrdem` do `Camera` responde `erro invalido`.
  - O resto do caminho da mensagem é o de hoje: o `camera` também conta como mensagem tratada do canal.
- [ ] **Step 8: O protocolo** (`docs/chat-protocolo.md`).
  - Na seção 10: a mensagem `camera` (da página) e a `palco` (do servidor), com os exemplos; quando o palco chega; que o `camera` antes do `aceito` é fora de ordem; que o palco só vai às páginas aceitas.
  - Na seção 12: o limite dos 30 avisos da câmera por minuto por canal, à parte das 20 mensagens.
- [ ] **Step 9: Rodar.** `go test -race ./...` em `chat-servidor/`, o `gofmt` e o `go vet`. Esperado: PASS.
- [ ] **Step 10: Commit e push.**

### Task 4: O `palco.js`

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/palco.js`
- Test: `chat-servidor/pagina/testes/palco.test.mjs`

**Interfaces:**
- Consumes: nada (o módulo é puro: sem DOM, sem rede e sem relógio).
- Produces: as funções e as constantes da seção "O `palco.js`".

Os palcos dos testes: o `P4`, de 1920×1080, com a Ana (`c1`), o Carlos (`c2`), a Maria (`c3`), o Roberto (`c4`, com `semCamera`) e o Você (num quinto quadro, com `voce`); os menores tiram pessoas dele. A área do PC é `{l: 1232, a: 608}`, e a do celular em pé, `{l: 374, a: 640}`.

- [ ] **Step 1: Os testes do `lerPalco` e do `recortar`.**

```js
// lerPalco: a mensagem da seção "O desenho" → {largura, altura, quadros}. Devolve null com: a largura 0, um quadro que passa
//   do mosaico, 14 quadros, um quem que não é texto, um nome com mais de 200 caracteres, ou os quadros que não são uma lista.
// recortar({x:2,y:2,l:956,a:536}, {l:600,a:300}, 'cobrir') → {sx:2, sy:31, sl:956, sa:478, dx:0, dy:0, dl:600, da:300}
// recortar({x:2,y:2,l:956,a:536}, {l:184,a:317}, 'cobrir') → sx≈324.44, sy:2, sl≈311.12, sa:536, e o destino é o quadro inteiro
// recortar({x:0,y:0,l:1920,a:1080}, {l:994,a:608}, 'inteiro') → a origem é a célula inteira; dx:0, dy≈24.44, dl:994, da≈559.13
```

- [ ] **Step 2: Os testes do `sincronizar`.** O `m0` é o `sincroniaInicial(0)`; o `V` é o vídeo de 1920×1080, e o `V2`, o de 1920×1620:

```js
// sem palco: agora 2999 → 'espera'; agora 3000 → 'mosaico'
// o primeiro palco (P4) com o V, agora 100 → 'espera', proximo 600; agora 700 → 'quadros'
// o palco novo do mesmo tamanho (mais a Bia), agora 5000 → 'quadros', com esse palco, esperando ['cam:<bia>'], proximo 1000;
//   agora 6000 → esperando []
// o palco de 1920x1620 com o vídeo ainda V, agora 7000 → 'quadros', com o palco anterior
// o vídeo vira V2, agora 7400 → 'espera', com o palco de 1920x1620, proximo 600; agora 8000 → 'quadros'
// o vídeo volta a V sem palco novo, agora 9000 → 'espera'; agora 12000 → 'mosaico'
// o palco de 1920x1080 chega, agora 12100 → 'quadros' (o vídeo tem esse tamanho desde 9000)
// com palco e sem vídeo (null), agora 60000 → 'espera'
// a memória recebida nunca muda (o resultado é um objeto novo)
```

- [ ] **Step 3: Os testes do `aoMudarOPalco`.** Com o Carlos aumentado: a tela aparece → `null`; a tela some → `null`; o Carlos sai → `null`; a Bia entra → fica o Carlos. Com `null`, fica `null`. Com o Carlos aumentado durante o compartilhamento, outro palco com a mesma tela → fica o Carlos.
- [ ] **Step 4: Os testes do `arrumar`, no PC.**

```js
// sozinho (palco null, ou só o Você): o Você na grade: x 8, y 0, l 1216, a 608
// 1 outro (Carlos): Carlos na grade, sem botão: 8, 0, 1216, 608; o Você no canto: 1008, 475, 208, 117
// 4 outros: (12,0), (620,0), (12,308), (620,308), todos 600×300 e botão; o recorte da Ana é {x:2, y:2, l:956, a:536}
// 3 outros: (12,0), (620,0), (316,308)
// 9 outros: três colunas, cada quadro com 395×197
// o Carlos aumentado (4 outros): modo 'grande', voltar 'verTodos'; o Carlos grande: 0, 0, 994, 608, sem botão;
//   a faixa {eixo:'y', x:1004, y:0, l:228, a:608, rotulo:'As outras pessoas'};
//   nela: Ana (0,0,228,128), Maria (0,136), Roberto (0,272), o Você (0,408), só o Você sem botão
// a tela da Ana e 3 pessoas: a tela grande: 0, 0, 994, 608, corte 'inteiro', recorte {x:0,y:0,l:1920,a:1080}; voltar null;
//   a faixa com o rótulo 'As pessoas': Ana, Carlos, Maria e o Você
// a tela e o Carlos aumentado: voltar 'voltarParaATela'; a faixa 'A tela e as outras pessoas': a tela (botão), Ana, Maria, o Você
// a área de 796×250 com 2 outros: (0,0,394,250) e (402,0,394,250); o Você no canto: 645, 158, 135, 76
```

- [ ] **Step 5: Os testes do `arrumar`, no celular em pé.**

```js
// 1 outro: (0,0,374,640), sem botão; o Você no canto: 272, 507, 92, 123
// 3 outros: uma coluna: (0,0,374,209), (0,215,374,209), (0,431,374,209)
// 4 outros: (0,0,184,317), (190,0), (0,323), (190,323); o Você no canto: 280, 518, 84, 112
// 5 outros: (0,0,184,209), (190,0), (0,215), (190,215), e o último na linha inteira: (0,431,374,209)
// o Carlos aumentado (4 outros): o grande (0,0,374,562); a faixa {eixo:'x', x:0, y:568, l:374, a:72};
//   nela: (0,0,128,72), (134,0), (268,0), e o Você (402,0)
// a tela da Ana e 3 pessoas: a tela (0,0,374,210); gire {x:0, y:216, l:374, a:28};
//   embaixo: Ana (0,250,184,192), Carlos (190,250), Maria (0,448), o Você (190,448); as três são botão, e o Você não
// a tela com uma câmera aumentada: como o Carlos aumentado, com a tela primeiro na faixa, e gire null
```

- [ ] **Step 6: Rodar e ver falhar.** `node --test testes/palco.test.mjs`. Esperado: FAIL (o módulo não existe).
- [ ] **Step 7: O `palco.js`,** com as regras da seção "O `palco.js`". Ele não importa nada e não muda o que recebe.
- [ ] **Step 8: Rodar.** `node --test testes/*.test.mjs`. Esperado: PASS.
- [ ] **Step 9: Commit e push.**

### Task 5: O cérebro guarda o palco e avisa a câmera, e a página pede mais imagem

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`, `chat-servidor/pagina/testes/estado.test.mjs`
- Modify: `chat-servidor/internal/pagina/estatico/midia.js`, `chat-servidor/internal/pagina/estatico/ligacao.js`
- Modify: `chat-servidor/pagina/testes/telas.spec.ts`, `chat-servidor/pagina/testes/tela.spec.ts`

**Interfaces:**
- Consumes: o `lerPalco` da Task 4.
- Produces:
  - `estado.palco`: o último palco que vale, ou `null`;
  - o efeito `mandar`, com `{tipo: 'camera', ligada}`;
  - no `midia.js`: `export const CAMERA`, as restrições da câmera, que o `ligacao.js` importa.

- [ ] **Step 1: Os testes do cérebro** (`estado.test.mjs`).

```js
// 'o aceito manda a câmera': os efeitos do aceito têm {tipo:'mandar', m:{tipo:'camera', ligada:true}};
//   com a Câmera desligada na entrada, ligada:false
// 'o voltou manda a câmera de novo', com o estado dela naquela hora
// 'a Câmera trocada na reunião manda na hora': o clique → ligada:false; o cameraTrocada com ok falso → ligada:true
// 'a câmera que passa a faltar manda desligada': o midia com cam 'indisponivel', na reunião → ligada:false
// 'sem o canal aberto, nada vai': com o canal fechado ou voltando, o clique na Câmera não manda nada
// 'antes do aceito, nada vai': o clique na Câmera da entrada e da espera não manda nada
// 'o palco fica no estado': a mensagem palco que vale, depois do aceito → estado.palco; antes do aceito → null;
//   a que não vale → fica o anterior; o saiu, o tirado e o encerrada → null; o aceito seguinte → null;
//   a conexão caída (o semConexao) → o palco fica
// 'o erro do servidor não é resposta ao aviso da câmera': depois do aviso, um erro limite com a tela pedindo a senha
//   continua parando o compartilhar, como hoje
```

- [ ] **Step 2: Os testes da câmera e da tela pedidas** (`telas.spec.ts` e `tela.spec.ts`). O registro dos pedidos de mídia dos testes passa a guardar as restrições.

```ts
// 'a câmera é pedida com 1280×720': o pedido da entrada é
//   {audio: true, video: {width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30}, aspectRatio:{ideal:16/9}, facingMode:{ideal:'user'}}}
//   e os três pedidos só da câmera (ligada de novo na entrada, depois da permissão negada, e ligada na reunião) levam o mesmo video
// 'a tela é pedida com até 1920×1080 a 15': o getDisplayMedia recebe
//   {video: {width:{max:1920}, height:{max:1080}, frameRate:{max:15}}, audio: false}
// 'a faixa da tela é marcada como detalhe': o contentHint da faixa de vídeo da captura é 'detail'
```

- [ ] **Step 3: Rodar e ver falhar.** `node --test testes/estado.test.mjs` e `npx playwright test`. Esperado: FAIL nos testes novos.
- [ ] **Step 4: O cérebro.**
  - O estado inicial ganha `palco: null`.
  - A mensagem `palco`, com o canal aberto e depois do aceito, guarda o `lerPalco(m)`, se ele vale.
  - O palco volta a `null` no aceito e em todo aviso (o fim da entrada e o da reunião).
  - **A regra da câmera fica num lugar só,** no fim do `transicao`: com o estado novo aceito e de canal aberto, sai o `mandar` da câmera quando o estado anterior não era assim, ou quando o `cam === 'ligado'` mudou.
- [ ] **Step 5: A mídia.**
  - O `midia.js` exporta o `CAMERA` e o usa nos três pedidos dele. O `ligacao.js` o usa no pedido da câmera ligada na reunião.
  - O `getDisplayMedia` leva as restrições do teste, e cada faixa de vídeo da captura ganha o `contentHint` `'detail'`.
- [ ] **Step 6: Rodar.** `node --test testes/*.test.mjs`, `npm run typecheck` e `npx playwright test`. Esperado: PASS.
- [ ] **Step 7: Commit e push.**

### Task 6: Os quadros na tela

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/quadros.js`
- Modify: `chat-servidor/internal/pagina/estatico/pagina.js`, `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/pagina.css`
- Create: `chat-servidor/pagina/testes/palco.spec.ts`
- Modify: `chat-servidor/pagina/testes/telas.spec.ts`, `chat-servidor/pagina/testes/tela.spec.ts` (os testes que olham a moldura do mosaico e o aviso de girar)

**Interfaces:**
- Consumes: o `palco.js` (Task 4), e o `estado.palco` e o `estado.cam` (Task 5).
- Produces:

```js
/** Os quadros da reunião. O relogio é o da página: {agora(), depois(ms, fn)}. */
export function criarQuadros({ raiz, relogio })
// → { desenhar({ naReuniao, noAr, palco, cam, fluxo }), parar() }
```

  - o `pagina.js` chama o `desenhar` a cada estado: `naReuniao` é a tela `reuniao`; `noAr`, a principal no ar; `palco` e `cam`, os do cérebro; `fluxo`, o `midia.fluxo()`.

**Os ajudantes dos testes** (`palco.spec.ts`), por cima do `naReuniao` de hoje:
- **o mosaico de mentira:** um `<canvas>` com o tamanho pedido e uma cor em cada célula, ligado ao `#mosaico` pelo `captureStream(0)`. Cada imagem sai quando o teste pede (o `requestFrame()` da faixa), e não por um relógio: o relógio da página está parado;
- **o palco de mentira:** a mensagem `palco` mandada pelo canal falso;
- **a cor de um quadro:** o ponto do meio do `<canvas>` do quadro com aquele `data-quadro`.

- [ ] **Step 1: Os testes** (`palco.spec.ts`). As cores: a Ana vermelha, o Carlos azul, a Maria amarela, e a tela verde.

```ts
// 'sem palco, o mosaico inteiro depois de 3 s': na reunião, sem palco: a moldura do mosaico não aparece; o relógio anda 3000 ms →
//   ela aparece, e não há quadro nenhum (critério 9 da spec)
// 'duas pessoas': o palco [Carlos, Você] e uma imagem: o quadro do Carlos ocupa a área (a altura da área, e 95% ou mais da
//   largura dela), tem o azul e a etiqueta "Carlos Lima", e não é botão; o Você fica no canto de baixo, à direita, com "Você",
//   e o vídeo dele toca o fluxo da câmera, espelhado
// 'a grade de quatro': cada quadro com a cor e o nome certos; o do Roberto, sem câmera, mostra o nome no centro
//   e data-mostra "sem-camera"
// 'o clique aumenta, e o Ver todos e o Esc voltam': o clique no Carlos → ele é o grande, os outros vão à faixa, o Você por último,
//   e o foco vai ao "Ver todos"; o clique na Ana da faixa → ela é o grande, e o Carlos vai à faixa;
//   o "Ver todos" volta à grade, com o foco no quadro de quem estava grande; de novo, e o Esc volta
// 'o teclado e os nomes ditos': o Tab chega a cada quadro da grade; o Enter aumenta; os aria-label são os da seção "Os textos"
// 'a tela compartilhada': o palco de 1920×1620 com a tela da Ana: a tela é o grande, com o verde e "Tela de Ana Souza";
//   o clique no Carlos da faixa → ele é o grande, a tela é a primeira da faixa, e aparece o "Voltar para a tela";
//   o "Voltar para a tela", o Esc e o clique na tela da faixa trazem a tela, cada um na sua vez
// 'quem compartilha vê A sua tela': o quadro da tela com o voce → "A sua tela"
// 'o compartilhamento começa com uma câmera aumentada': a tela fica grande; e quando ele acaba, volta a grade
// 'a pessoa aumentada sai': o palco sem ela → a grade
// 'o palco novo espera o tamanho do vídeo' (Review Focus 1): com o palco de 1920×1080 no ar, chega o de 1920×1620:
//   os quadros continuam com as cores de antes; o mosaico de mentira vira 1920×1620 → todos mostram data-mostra "espera";
//   o relógio anda 600 ms e sai outra imagem → o quadro da tela tem o verde, e os das pessoas, as cores delas
// 'quem acabou de entrar espera 1 s' (Review Focus 3): o palco ganha a Bia na célula que era do Carlos, ainda azul no mosaico:
//   o quadro dela mostra "espera" e nenhuma cor; o relógio anda 1000 ms → ele mostra o vídeo
// 'o tamanho que não confere vira o mosaico inteiro': o mosaico de mentira muda de tamanho sem palco novo →
//   "espera" em todos; 3000 ms depois, a moldura do mosaico; um palco desse tamanho traz os quadros de volta
// 'o celular em pé': 4 outros em duas colunas, que ocupam a área; o Você no canto; com a tela: a tela em cima,
//   "Gire o celular para ver a tela maior.", e as pessoas embaixo. O texto "Gire o celular para ver a reunião maior." não existe
// 'girar o celular e mudar a janela' (Review Focus 4): com o Carlos aumentado, a janela vai de 1280×800 para 844×390 e depois
//   para 390×844: ele continua o grande, os quadros cabem na área, e o <canvas> de cada um tem a proporção do quadro (sem esticar)
// 'os nomes fora do comum' (Review Focus 5): o nome "" aparece como "Participante"; o nome "<b>Ana</b>" aparece com os sinais,
//   e a página não ganha um <b>; o nome de 80 letras fica numa linha, dentro do quadro, cortado com reticências
// 'a conexão caída cobre o palco': o cartão "A conexão caiu. Entrando de novo…" fica por cima da área inteira
// 'a página não quebra o CSP': nenhum securitypolicyviolation durante os testes de cima
```

- [ ] **Step 2: Rodar e ver falhar.** `npx playwright test testes/palco.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: O HTML e o CSS.**
  - Na seção da reunião, a área do palco ganha o lugar dos quadros (vazio no HTML), o botão de voltar e o aviso de girar novo. O cartão "A conexão caiu" passa a cobrir a área inteira. O aviso de girar antigo sai.
  - O CSS dos quadros, da faixa, das etiquetas, da pílula, do botão de voltar e do Você, com as medidas da seção "O visual". O lugar e o tamanho de cada quadro vêm do JavaScript. As regras do aviso de girar antigo saem.
  - A moldura do mosaico ganha o jeito "fora da vista".
- [ ] **Step 4: O `quadros.js`.**
  - Ele cria, muda e tira os elementos dos quadros pelo resultado do `arrumar`. Cada quadro de pessoa ou de tela tem um `<canvas>`; o Você tem um `<video>` mudo.
  - O quadro com `botao` é um `<button>`; sem ele, um elemento com `role="img"`. Quando isso muda, o elemento é trocado.
  - Ele guarda quem está aumentado, e o passa pelo `aoMudarOPalco` a cada palco novo.
  - A cada imagem do vídeo: o `sincronizar`, com o tamanho da imagem e o `relogio.agora()`; a tela é arrumada de novo quando o modo, o palco ou o `esperando` mudam; e cada quadro que mostra o vídeo é pintado com o `recortar`.
  - O `proximo` do `sincronizar` marca um `relogio.depois`, que avalia de novo.
  - A sincronia começa quando o `noAr` vira verdadeiro, e recomeça a cada vez.
  - O `<canvas>` de cada quadro tem o tamanho do quadro vezes o `devicePixelRatio`, até 2.
  - O `emPe` é a janela com até 600 px de largura e mais alta que larga.
  - A área que muda de tamanho (o `ResizeObserver`) e o celular que gira arrumam a tela de novo.
  - O `<video>` do Você recebe o `fluxo` de novo quando as faixas de câmera vivas dele mudam.
  - Os nomes entram pelo `textContent`.
  - O clique num quadro que é botão aumenta. O botão de voltar e o Esc voltam. O foco segue a regra dos testes.
- [ ] **Step 5: O `pagina.js`** cria os quadros e chama o `desenhar` deles em cada desenho. Na saída da página, o `parar`.
- [ ] **Step 6: Os testes de hoje que mudam.** Os que olham a moldura do mosaico na reunião e o aviso de girar passam a olhar a área do palco e o texto novo. Nenhum outro teste muda.
- [ ] **Step 7: Rodar.** `node --test testes/*.test.mjs`, `npm run typecheck` e `npx playwright test`, em `chat-servidor/pagina/`; e `go test -race ./internal/pagina/` em `chat-servidor/`. Esperado: PASS.
- [ ] **Step 8: Commit e push.**

### Task 7: De ponta a ponta

**Files:**
- Create: `video-servidor/e2e/palco.spec.ts`
- Modify: `video-servidor/e2e/navegador.ts` (a `Pagina` lê os quadros), `video-servidor/e2e/pagina.spec.ts` (o que muda com os quadros)

**Interfaces:**
- Consumes: o agente (Task 2), o chat (Task 3) e a página (Tasks 4 a 6), todos de verdade.
- Produces: na `Pagina`, `quadro(nome)` (o quadro com aquela etiqueta), `corDoQuadro(nome)` (a cor do meio do `<canvas>` dele) e `esperarQuadros(nomes)`.

- [ ] **Step 1: Os testes** (`palco.spec.ts`). As três páginas de verdade, na reunião de teste: A (Carlos Lima, vermelho), B (Bia Ramos, azul) e C (Maria Lima, amarelo).

```ts
// 'cada página mostra as outras duas, com os nomes certos': em A, o quadro "Bia Ramos" é azul e o "Maria Lima" é amarelo,
//   e há o "Você"; o mesmo em B e em C, com as cores das outras. O vídeo recebido tem 1920×1080. O console de cada uma está limpo.
// 'quem entra e quem sai não muda os outros de lugar': B sai → em A, o quadro "Maria Lima" continua amarelo, e no mosaico
//   o ponto de c3 ([0.25, 0.75]) continua amarelo, com o de c2 ([0.75, 0.25]) escuro; B entra de novo → o c2 fica azul,
//   e o c3 não mudou em nenhuma leitura
// 'quem entra de novo fica no mesmo lugar' (Review Focus 2): o WSS do vídeo de C cai e a página volta sozinha →
//   o ponto de c3 volta a ser amarelo, e os de c1 e c2 não mudam
// 'a tela compartilhada no palco, com 2 pessoas': A e C; C compartilha → o vídeo de A passa a 1920×1620; em A, o quadro
//   "Tela de Maria Lima" é o grande e é verde; o clique no "Maria Lima" da faixa → o grande é amarelo, e há o "Voltar para a tela";
//   o clique nele → o verde de novo; C para → o vídeo volta a 1920×1080, e a grade volta
// 'a tela com 3 pessoas': B entra durante o compartilhamento → o vídeo passa a 1920×1350, e os quadros continuam certos
// 'a câmera desligada escurece na hora': C desliga a Câmera → em até 2 s, em A, o quadro "Maria Lima" mostra o nome no centro
//   (data-mostra "sem-camera"); C liga → o amarelo volta
// 'o celular em pé na reunião de três': C no celular (390×844): os dois quadros ocupam a largura da área, um embaixo do outro
```

- [ ] **Step 2: Rodar e ver.** `npx playwright test palco.spec.ts`. Com as Tasks 2 a 6 prontas, os testes já devem passar. O que falhar mostra um defeito de uma delas: ele é corrigido aqui, com o teste que faltava na tarefa dona do código.
- [ ] **Step 3: O `pagina.spec.ts`.** Os testes que leem o `#mosaico` continuam valendo, porque o vídeo continua tocando. Entra, nos da tela pela página, a leitura do quadro da tela.
- [ ] **Step 4: Rodar tudo.** `npm run typecheck` e `npx playwright test`, em `video-servidor/e2e/`. Esperado: PASS, duas vezes seguidas.
- [ ] **Step 5: Commit e push.** Conferir o CI da branch: os workflows `chat` e `video` verdes.

### Task 8: Os guias e o roteiro

**Files:**
- Modify: `docs/teste-manual.md` (a seção nova e a tabela dos critérios)
- Modify: `docs/video-servidor.md` (a seção 5, Atualizar, e a 9, os problemas comuns), `docs/chat-servidor.md` (a seção 9, as reuniões com link)
- Modify: `docs/build-notes.md` e `video-servidor/freeswitch/conferir-pacote.sh` (o que dizem do nome no quadro)

**Interfaces:**
- Consumes: tudo o que as tarefas anteriores entregaram.
- Produces: o roteiro que o responsável segue na `chat-v0.2.0-rc.4` e na `video-v0.1.0-rc.3`.

- [ ] **Step 1: A seção nova do roteiro,** "26. O palco da reunião (reuniões com link, etapa 1c)", no jeito da 25: as colunas **PC** e **Celular**, os passos numerados e o resultado esperado, com os textos da página letra por letra. As linhas:
  1. A ordem de atualizar: primeiro o chat. Antes de atualizar o servidor de vídeo, abrir uma reunião: a página mostra o mosaico inteiro, como antes, e nada quebra.
  2. Depois de atualizar o servidor de vídeo: duas pessoas (a tela 12 do quadro, e a 17 no celular). A outra ocupa a área, e você fica pequeno no canto.
  3. Três ou mais pessoas (as telas 13 e 18). Alguém entra e alguém sai: os outros não trocam de lugar.
  4. Um quadro aumentado (a tela 14), o `Ver todos` e a tecla Esc. No celular, o toque, e a faixa embaixo.
  5. A tela compartilhada (as telas 15 e 19): uma planilha a 100%, com letra de tamanho 11, lida do outro lado. No celular em pé, `Gire o celular para ver a tela maior.`
  6. Uma câmera aumentada durante o compartilhamento (a tela 16) e o `Voltar para a tela`.
  7. A câmera desligada: o quadro escurece na hora, com o nome no centro.
  8. Cinco pessoas e dez pessoas: na passagem de 4 para 5 e de 9 para 10, os quadros ficam escuros por um instante e voltam certos. Com dez, o cartão `Reuniões` do chat mostra a CPU do servidor de vídeo abaixo de 50%.
  9. O Safari do iPhone: os quadros andam sem travar, com 3 pessoas.
  10. O celular que gira no meio da reunião, e a janela do PC que muda de tamanho.
  11. A rede que cai e volta (como no 25.9): a pessoa volta ao mesmo quadro, e ninguém troca de lugar.
- [ ] **Step 2: A tabela "Onde cada critério de sucesso é verificado"** ganha os 9 critérios da spec, cada um com os testes automáticos dele (os nomes dos testes deste plano) e as linhas da seção 26.
- [ ] **Step 3: Os guias dos servidores.**
  - No `docs/video-servidor.md`, seção 5: a ordem (o chat antes do servidor de vídeo) e por quê; a atualização troca a configuração do FreeSWITCH. Na seção 9: "a reunião aparece como uma imagem só, sem os quadros" (o chat ainda é o antigo, ou o servidor de vídeo ainda é o antigo) e o que conferir.
  - No `docs/chat-servidor.md`, seção 9: o palco, em duas frases, e a mesma ordem.
- [ ] **Step 4: O nome no quadro.** O `docs/build-notes.md` e o comentário do `conferir-pacote.sh` passam a dizer que a reunião não escreve mais o nome no mosaico, e que a fonte continua no pacote.
- [ ] **Step 5: Conferir.** Nenhum texto dos guias contradiz a seção "O desenho". O `shellcheck` do `conferir-pacote.sh` passa.
- [ ] **Step 6: Commit e push.**

## Depois das tarefas

- **A revisão da branch inteira,** e a correção do que ela achar.
- **O responsável publica** a `chat-v0.2.0-rc.4` e a `video-v0.1.0-rc.3` pelo GitHub, e atualiza primeiro o chat e depois o servidor de vídeo, num horário sem reuniões.
- **O roteiro:** a seção 26 do `docs/teste-manual.md`.
- **O que fica para depois** é o da seção 5 da spec.
