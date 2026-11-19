# O chat da reunião e o sinalizador de qualidade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** na reunião pelo navegador, quem está nela manda um texto para todos e lê o que os outros mandam, e cada pessoa vê o tempo todo como está a conexão dela (boa, instável ou ruim).

**Architecture:**
- **O chat da reunião passa pelo canal que a página já tem com o chat.** A página manda a mensagem, e o servidor a repassa às páginas da mesma reunião, pela regra que já vale para o palco (o `recebePalco`). O servidor não guarda nada: nem na memória depois de repassar, nem no banco, nem nos registros.
- **Na página, o cérebro (`estado.js`) guarda a lista, as não lidas, o painel, o aviso curto e o estado do sinalizador.** Ele continua uma função pura. Três peças novas ficam ao lado dele: o `mensagens.js` (as contas e os textos do chat, puro), o `painel.js` (a tela do painel) e o `qualidade.js` (a conta do sinalizador, pura, e o medidor que pede os números ao navegador a cada 2 s).
- **O sinalizador não manda nada a servidor nenhum.** O servidor de vídeo não muda, e o app também não.

**Tech Stack:** o que o chat e a página já usam: Go (o `chat-servidor`), JavaScript em módulos, sem montagem (a página), `node --test` e o `@playwright/test` 1.56.1. Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-19-starsonic-phone-reunioes-chat-e-qualidade-design.md`. As telas são as 20 a 24 do quadro "Starsonic — reunião no navegador". O código delas está na pasta de trabalho deste plano, em `quadro/` (5 arquivos `.dc.html`), e as medidas estão na seção "Os desenhos".

**O método:** o responsável respondeu "Continue" em 19/11, às 03:50, aos três desenhos e ao método: eu mesmo construo, tarefa por tarefa, e um revisor de fora lê tudo no fim.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-1`. Cada tarefa dá commit, por caminho, e push.
- **Os commits** são em português, como os da branch, e terminam com as duas linhas:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW
  ```
- **A versão** é a `0.2.0-rc.6` do chat. Os guias e o roteiro a chamam assim. Ninguém publica versão: quem publica é o responsável.
- **Os valores** (seção 8 da spec):

  | O quê | Valor |
  |---|---|
  | O tamanho de uma mensagem | de 1 a 1.000 caracteres, sem os espaços das pontas |
  | O `id` de uma mensagem | de 1 a 16 letras ou números |
  | O limite de mensagens | 20 por minuto por canal, numa janela só do chat da reunião |
  | A resposta que não chega | 10 s, e a mensagem fica "Não enviada" |
  | As mensagens que a página guarda | as últimas 500 |
  | O número no botão | até 9, depois "9+" |
  | A largura do painel no PC | 360 px, com a janela a partir de 900 px |
  | A medida do sinalizador | a cada 2 s |
  | O relatório do servidor de vídeo que ainda vale | o dos últimos 10 s |
  | Os limites da conta | perda de 2% (instável) e 8% (ruim); atraso de 250 ms (instável) e 500 ms (ruim) |
  | Piorar e melhorar | 2 medidas para piorar, 5 para melhorar |
  | O aviso curto | 5 s, um por vez |
  | O aviso de conexão ruim | no máximo 1 a cada 2 minutos |

- **O texto nunca vira HTML.** Todo texto que vem de uma pessoa (a mensagem e o nome) entra na página pelo `textContent` ou por um nó de texto. Nenhum `innerHTML`.
- **Os links** só nascem de trechos que começam com `http://` ou `https://`, mostram o endereço inteiro e levam `target="_blank"` e `rel="noopener noreferrer"`.
- **A regra de segurança da página (a CSP) não muda:** nenhum script nem estilo dentro da página, e nenhum `style="…"` no HTML. O JavaScript muda medidas pelo `elemento.style`, que a CSP deixa. Todo teste de tela confere que não houve violação.
- **Nada do chat da reunião vai aos registros nem ao console:** nem o texto, nem o nome, nem o `id`. O sinalizador também não escreve nada.
- **Quem recebe e quem manda** é quem recebe o palco (o `recebePalco`): a página aceita, com o canal aberto, que está na reunião ou entrando nela. Não há outra regra.
- **Os textos das telas** são os da seção "Os textos", letra por letra.
- **O que não muda:** o `video-servidor/` (o agente e o FreeSWITCH), o `windows/`, o `android/`, o banco do chat e os eventos dos apps. Os quadros da reunião (`palco.js`) não mudam: eles já se arrumam pela medida da área.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados de sempre (Ana Souza, Carlos Lima, Maria Lima, Bia Ramos, Roberto Alves, `exemplo.com.br`).

## A máquina de desenvolvimento

- O `go` pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`.
- Ela tem 2 processadores. O Playwright e o `go test -race` entram na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- **A prova inteira do chat**, no fim de cada tarefa que mexe nele:
  - em `chat-servidor/`: `gofmt -l .` (sem saída), `go vet ./...` e `go test -race ./...`;
  - em `chat-servidor/pagina/`: `node --test testes/*.test.mjs`, `npm run typecheck` e `npx playwright test`.
- **O teste de ponta a ponta** roda aqui com o FreeSWITCH desta máquina: `STARSONIC_FREESWITCH_DIR=/home/claude/starsonic-reunioes/work/fs-teste/corrigido`, em `video-servidor/e2e/`. No GitHub, é o workflow `video`.

## Review Focus

O que a spec deixa implícito e que mais pode pegar uma pessoa. Cada linha tem o teste dela na tarefa dita.

1. **O teclado do celular com o chat aberto.** No iPhone e no Android, o teclado da tela cobre a parte de baixo da janela. A pessoa espera ver o campo de escrever e as últimas mensagens acima do teclado (tarefa 3, teste "o teclado do celular"; e o roteiro, na tarefa 8).
2. **A lista rolada para cima.** Quem está lendo as mensagens antigas não pode ser puxado para o fim a cada mensagem nova. Quem está no fim acompanha, e a mensagem que a própria pessoa manda leva ao fim (tarefa 3, teste "a lista rolada").
3. **O texto fora do comum.** Um endereço de 900 letras, uma palavra de 1.000, emojis, texto da direita para a esquerda, só quebras de linha, sinais de HTML. A pessoa espera ver o texto como foi escrito, sem o painel alargar e sem nada virar página (tarefa 1, "o maior texto"; tarefa 3, "o texto fora do comum" e "o texto com sinais de HTML").
4. **A janela que cruza os 900 px com o chat aberto, o celular deitado e o tablet.** O painel passa de ao lado para cobrindo a tela, e volta, sem perder o que a pessoa escrevia nem o foco (tarefa 3, testes "a janela que cruza os 900" e "o celular deitado e o tablet").
5. **Duas abas, o mesmo nome, e a resposta atrasada.** Duas abas da mesma pessoa são dois participantes: a mensagem de uma chega à outra como de outra pessoa, com o mesmo nome. O `id` e o `voce` vão só ao canal de quem escreveu. Uma resposta que chega depois do `Tentar de novo` vira uma segunda mensagem, como os outros a viram (tarefa 1, "dois com o mesmo nome"; tarefa 2, "a resposta de um id que a página não espera mais").
6. **O dia da atualização.** A página antiga, aberta numa reunião quando o chat é atualizado, recebe um tipo de mensagem que não conhece e o ignora (é o que o cérebro de hoje faz com tipo desconhecido). Os arquivos novos nunca vêm do cache: eles saem com `Cache-Control: no-cache` (tarefa 3, o `TestPagina_Estaticos` com os arquivos novos; e o guia, na tarefa 8, diz para atualizar fora do horário das reuniões).
7. **A rajada.** Nove pessoas mandando 20 mensagens cada. A página fica com as últimas 500, o botão mostra "9+", e os avisos curtos não se empilham (tarefa 2, "a página guarda as últimas 500"; tarefa 4, "um aviso por vez").

## As escolhas deste plano

A spec não diz, e este plano decide. Elas vão para o responsável no fim, na lista das decisões.

1. **A mensagem que ainda está indo** aparece já na lista, com a hora, mais apagada (opacidade 0,6). Nenhum texto novo.
2. **O `Tentar de novo`** manda o texto de novo como uma mensagem nova: ela sai do lugar antigo e vai para o fim da lista, com a hora de agora.
3. **A resposta que chega depois dos 10 s** ainda confirma a mensagem, se ela continua "Não enviada". Se a pessoa já clicou em `Tentar de novo`, a resposta atrasada vira outra mensagem dela na lista: foi o que os outros viram.
4. **A lista acompanha o fim** quando está a até 80 px dele (o mesmo número do chat do app), quando a pessoa manda uma mensagem e quando o painel abre.
5. **O painel ao lado é do PC:** a janela de 900 px ou mais, com ponteiro de mouse (`(min-width: 900px) and (pointer: fine)`). Numa tela de toque ele cobre a tela, também deitada e no tablet: o teclado da tela tomaria o campo do painel ao lado.
6. **Na tela de toque, abrir o chat leva o foco ao título do painel,** e não ao campo: o teclado só sobe quando a pessoa toca no campo. No PC, o foco vai ao campo, como a spec diz.
7. **O Enter pula linha onde o ponteiro é o dedo** (`(pointer: coarse)`), e manda nos outros. Depois do botão de mandar, o foco volta ao campo, para o teclado do celular não descer.
8. **O campo cresce** com o texto até 120 px de altura, e depois rola. O `maxlength` é 1.000: ele conta unidades do JavaScript, e um emoji conta 2. O servidor conta pontos de código, e nunca recusa o que o campo deixa passar.
9. **No link, a pontuação do fim fica de fora:** `. , ; : ! ?` e os fechamentos `) ] }` e aspas. Os sinais `<`, `>` e `"` terminam o endereço.
10. **O aviso curto sobe para cima do Você** quando a área tem até 760 px de largura (o celular, a janela estreita, e a janela média com o chat aberto): ali, no meio, ele cobriria o Você.
11. **O leitor de tela ouve toda mensagem dos outros,** com o chat aberto ou fechado, pela região que a página já tem. O aviso que aparece não é uma região falada, para a mensagem não ser dita duas vezes.
12. **O `mensagem` com o `id` que não vale** (vazio, com mais de 16, com outro sinal, ou que não é texto) recebe o erro de sempre, `{"tipo": "erro", "erro": "invalido"}`: não há de qual mensagem dizer. A página nunca manda um assim.
13. **"O chat volta quando a conexão voltar."** é uma linha acima do campo, com o campo e o botão desligados. O `Tentar de novo` das mensagens também fica desligado sem o canal.
14. **O campo mostra "Escreva uma mensagem"** (o texto do quadro), e o nome dele, para o leitor de tela, é "Mensagem para todos da reunião" (o da spec).
15. **As mensagens que chegam com a página ainda entrando** (aceita, com a ligação subindo) ficam guardadas e aparecem quando a reunião aparece, contando como não lidas.
16. **O sinalizador sai do "Medindo"** na segunda medida com número, pela regra de piorar: ele mostra a menos ruim das duas. Quando volta ao "Medindo" (2 medidas seguidas sem número), a conta recomeça.
17. **Com o cartão do sinalizador aberto, o aviso de conexão ruim não aparece,** e não gasta o um-a-cada-2-minutos: a pessoa já está olhando os detalhes.
18. **O "nome do colega" da lista de testes da spec** não tem como ser exercitado nesta versão: só a página manda, e quem manda pela página é sempre quem é de fora. Os testes cobrem o nome de quem é de fora, e que os apps dos colegas não recebem nada.
19. **Na tela de toque, o botão do sinalizador tem 44 px de altura** (o mínimo do toque), e no celular deitado o alto da reunião perde o espaço de cima e de baixo, para a área dos quadros não encolher. O quadro só desenha o PC e o celular em pé.

## Os textos

**O chat** (seção 4.4 da spec):

| Onde | Texto |
|---|---|
| O botão, nos controles | `Chat` |
| O botão, para o leitor de tela, com mensagens novas | `Chat, 1 mensagem nova`, `Chat, 2 mensagens novas` (o número de verdade, também depois de 9) |
| O número no botão | `1` a `9`, e `9+` |
| O título do painel | `Chat da reunião` |
| O botão de fechar, no painel ao lado (só o desenho) | `Fechar o chat` |
| Embaixo do título, no painel que cobre a tela | `Você continua na reunião` |
| O botão de voltar, no painel que cobre a tela (só o desenho) | `Voltar para a reunião` |
| O aviso do alto do painel | `As mensagens são para todos da reunião e somem quando ela acaba.` |
| O painel sem mensagem nenhuma | `Nenhuma mensagem ainda.` |
| O cabeçalho de cada mensagem | `Ana Souza · 14:02`; nas da própria pessoa, `Você · 14:04` |
| Quem escreveu sem nome conhecido | `Participante` |
| O campo de escrever: o nome | `Mensagem para todos da reunião` |
| O campo de escrever: o texto de dentro | `Escreva uma mensagem` |
| O botão de mandar (só o desenho) | `Enviar a mensagem` |
| A mensagem recusada pelo limite | `Não enviada: muitas mensagens seguidas. Espere um pouco.` e o `Tentar de novo` |
| A mensagem que não foi, nos outros casos | `Não enviada` e o `Tentar de novo` |
| Acima do campo, sem o canal | `O chat volta quando a conexão voltar.` |
| O aviso curto da mensagem nova | `Carlos Lima escreveu`, o texto numa linha só, e o `Abrir o chat` |
| O que o leitor de tela ouve | `Carlos Lima escreveu: <o texto, numa linha>` |

**O sinalizador:**

| Estado | O botão | Para o leitor de tela | O título do cartão | A explicação | As dicas |
|---|---|---|---|---|---|
| Boa | `Conexão boa` | `Conexão boa. Ver os detalhes` | `Sua conexão está boa` | `A imagem e o som estão chegando bem.` | nenhuma |
| Instável | `Conexão instável` | `Conexão instável. Ver os detalhes` | `Sua conexão está instável` | `A imagem ou o som podem falhar de vez em quando.` | as duas primeiras |
| Ruim | `Conexão ruim` | `Conexão ruim. Ver os detalhes` | `Sua conexão está ruim` | `Os outros podem não ver ou ouvir você direito, e a imagem deles pode travar para você.` | as três |
| Medindo | `Medindo a conexão…` | `Medindo a conexão` | `Medindo a conexão…` | `Os números aparecem aqui em alguns segundos.` | nenhuma |

- **As dicas,** nesta ordem: `Chegue mais perto do Wi-Fi, ou use o cabo de rede.`; `Feche downloads e vídeos em outros programas.`; `Se continuar, desligue a câmera: só o som precisa de bem menos internet.`
- **Os números,** no pé do cartão, menos no "Medindo": `Perda: 4% · Atraso: 210 ms`. O número que o navegador não dá aparece como `—`: `Perda: 4% · Atraso: —`. A perda é arredondada para o inteiro, e o atraso também.
- **O aviso curto:** `Sua conexão está ruim`, com o `Ver os detalhes`. O leitor de tela ouve `Sua conexão está ruim`.

## Os desenhos

As cores e as letras são as do quadro, no tema escuro que a reunião já usa. Onde a página já tem a variável da cor, vale a variável.

- **O botão `Chat`** entra nos controles antes do `Sair`: `Microfone`, `Câmera`, `Compartilhar a tela` (ou `Parar de compartilhar`), `Chat`, `Sair`.
  - Fechado: igual aos outros controles. Aberto (`aria-pressed="true"`): a borda `#00c2cb` e o fundo `#0b3d47`.
  - O ícone novo `#i-chat`: `<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z">`.
  - O número, no PC: depois do texto, com 22 px de altura e de largura mínima, 0 6 px por dentro, os cantos de 999 px, o fundo `#00c2cb` e a letra `#03222a` de 12,5 px e peso 800.
  - No celular (até 600 px): os controles viram quatro colunas (`repeat(4, minmax(0, 1fr))`), com 8 px entre elas e `14px 12px 26px` por dentro; cada controle tem `10px 2px` por dentro e a letra de 12,5 px. O número fica no canto do botão: a 8 px de cima e 14 px da direita, com 20 px e a letra de 12 px.
- **O painel ao lado** (tela 20): 360 px, a 12 px da área dos quadros e a 24 px da direita da janela, com 12 px em cima e embaixo.
  - A caixa: os cantos de 12 px, o fundo `#111830` e a borda de 1 px `#2c3757`.
  - O alto: `12px 12px 12px 16px` por dentro, a linha de baixo `#2c3757`, o título de 15 px e peso 800, e o botão de fechar de 44×44 px, sem borda, com o ícone de 18 px em `#b9c4e6` (`<path d="M6 6l12 12M18 6L6 18">`, traço 2,2).
  - A lista: `14px 16px` por dentro, 14 px entre as mensagens, e rola para baixo.
  - O aviso do alto da lista: `8px 12px` por dentro, os cantos de 8 px, o fundo `#0a0e1a`, a letra de 12,5 px (linha 1,45) em `#b9c4e6`.
  - `Nenhuma mensagem ainda.`: no meio, 13,5 px, `#9aa6c9`.
  - O cabeçalho da mensagem: 12,5 px, peso 700, `#dfe5f5`; a hora com peso 500, em `#9aa6c9`.
  - O balão dos outros: à esquerda, `9px 12px` por dentro, os cantos `4px 12px 12px 12px`, o fundo `#1c2540`, a letra de 14 px (linha 1,45). O da própria pessoa: à direita, os cantos `12px 4px 12px 12px`, o fundo `#0b5c63`. O texto quebra em qualquer ponto (`overflow-wrap: anywhere`) e guarda as quebras de linha (`white-space: pre-wrap`).
  - O link: `#7fe3e8`, peso 600, sublinhado; com o mouse em cima, `#b3f0f2`.
  - A mensagem indo: opacidade 0,6. A que não foi: embaixo do balão, o texto de 12,5 px em `#ffb3b3` e o `Tentar de novo`, um botão sem caixa, sublinhado, em `#7fe3e8`, com peso 700 e 44 px de altura mínima.
  - O campo: a faixa de baixo com 12 px por dentro, 8 px entre o campo e o botão, e a linha de cima `#2c3757`. O campo tem 44 px de altura mínima, `11px 14px` por dentro, os cantos de 12 px, a borda de 1 px `#2c3757`, o fundo `#0a0e1a`, a letra branca de 14 px (linha 1,4), e não tem a alça de esticar. O botão de mandar: 44×44 px, redondo, o fundo `#00c2cb`, o ícone de 18 px em `#03222a` (`<path d="M4 12l16-8-6 16-3-7z">`, traço 2,2). Desligado: opacidade 0,5.
  - `O chat volta quando a conexão voltar.`: acima do campo, 12,5 px, `#b9c4e6`.
- **O painel que cobre a tela** (tela 24): a janela inteira, por cima de tudo, com o fundo `#0a0e1a`, sem cantos e sem borda.
  - O alto: o fundo `#070b18`, a linha de baixo `#161d33`, `6px 8px` por dentro; o botão de voltar de 44×44 px, com a seta de 22 px, branca (`<path d="M19 12H5M11 6l-6 6 6 6">`, traço 2,2); o título de 15 px e peso 800; embaixo dele, `Você continua na reunião`, com 12 px, em `#b9c4e6`. O botão de fechar não aparece.
  - A lista: 14 px por dentro. O aviso do alto tem o fundo `#111830`. O balão tem a letra de 15 px e até 86% da largura.
  - O campo: a faixa com `10px 12px 22px` por dentro, o fundo `#070b18` e a linha de cima `#161d33`. O campo tem 46 px de altura mínima, os cantos de 14 px e a letra de 16 px (com menos, o iPhone aproxima a tela). O botão de mandar tem 46×46 px, com o ícone de 20 px.
- **O aviso curto** (tela 21): dentro da área dos quadros, por cima deles, no meio, a 8 px de baixo da área.
  - A caixa: a largura `min(440px, 100% − 96px)`, `12px 12px 12px 16px` por dentro, 14 px entre o texto e o botão, os cantos de 14 px, o fundo `#111830`, a borda de 1 px `#2c3757` e a sombra `0 24px 50px -20px rgba(0, 0, 0, 0.7)`.
  - O texto: a primeira linha de 12,5 px, peso 700, `#dfe5f5`; a segunda de 14 px (linha 1,4), branca, numa linha só, cortada com reticências.
  - O `Abrir o chat`: 44 px de altura mínima, `0 16px` por dentro, os cantos de 999 px, o fundo `#00c2cb`, a letra `#03222a` de 13,5 px e peso 700.
  - O da conexão ruim: a borda `#ff8a8a`; uma linha só de texto, de 14 px e peso 700; o `Ver os detalhes` com a borda de 1 px `#2c3757`, o fundo `#1c2540` e a letra branca.
  - Com a área de até 760 px de largura: a largura `min(440px, 100% − 20px)`, e ele sobe para 8 px acima do Você do canto (escolha 10).
- **O sinalizador** (tela 22) fica no alto, antes do `Nada é gravado`, com 14 px entre os dois.
  - O botão: 36 px de altura mínima, `6px 12px` por dentro, 8 px entre o desenho e o texto, os cantos de 999 px, a letra de 13 px. O desenho tem 16 px e três barras: `<rect x="3" y="14" width="4" height="7" rx="1">`, `<rect x="10" y="9" width="4" height="12" rx="1">` e `<rect x="17" y="4" width="4" height="17" rx="1">`.

    | Estado | A borda | O fundo | A letra | As barras acesas (na cor da letra) | As apagadas |
    |---|---|---|---|---|---|
    | Boa | `#2c3757` | sem | `#b9c4e6`, peso 600 | as três | — |
    | Instável | `#ffb703` | sem | `#ffd166`, peso 700 | as duas primeiras | `#3a4466` |
    | Ruim | `#ff8a8a` | `#2a1016` | `#ffb3b3`, peso 700 | a primeira | `#4a3040` |
    | Medindo | `#2c3757` | sem | `#9aa6c9`, peso 600 | nenhuma | `#3a4466` |

  - O cartão: abre embaixo do botão, alinhado à direita dele, a 8 px, por cima da área dos quadros, com a largura `min(340px, 100vw − 32px)`. A caixa: `16px 18px` por dentro, os cantos de 14 px, o fundo `#111830`, a borda de 1 px na cor da borda do estado, e a sombra do aviso curto. O título de 15 px e peso 800; a explicação de 14 px (linha 1,5) em `#dfe5f5`; as dicas numa lista com marcadores, 20 px de recuo e 4 px entre elas; os números de 12,5 px em `#9aa6c9`. Entre as partes, 8 px.
  - No celular (até 600 px, tela 23): o alto da reunião fica com `6px 8px 6px 18px` por dentro, e o botão vira só o desenho, de 20 px, num botão de 44×44 px, sem borda e sem fundo, na cor da letra do estado. O texto fica só para o leitor de tela. O cartão ocupa a largura da janela, com 8 px de cada lado.
  - Na tela de toque fora do celular em pé (o celular deitado, o tablet): o botão tem 44 px de altura mínima. No celular deitado, o alto da reunião fica sem espaço em cima e embaixo, para a área dos quadros não encolher.

## Os arquivos

| Arquivo | O que ele faz neste plano |
|---|---|
| `chat-servidor/internal/regras/regras.go` | a regra do texto de uma mensagem da reunião |
| `chat-servidor/internal/reunioes/mensagens.go` (novo) | o repasse: quem manda, o texto, e a fila de cada página que recebe |
| `chat-servidor/internal/api/pagina.go` | o `mensagem` do canal, a janela do limite e a recusa |
| `chat-servidor/internal/pagina/estatico/mensagens.js` (novo) | puro: o texto que vale, os links, a hora, o número e os textos do chat |
| `chat-servidor/internal/pagina/estatico/estado.js` | o cérebro: a lista, as não lidas, o painel, o aviso curto, o sinalizador e o cartão |
| `chat-servidor/internal/pagina/estatico/painel.js` (novo) | a tela do painel: a lista, o campo, o teclado, a rolagem, ao lado ou cobrindo |
| `chat-servidor/internal/pagina/estatico/qualidade.js` (novo) | a conta do sinalizador (pura) e o medidor |
| `chat-servidor/internal/pagina/estatico/ligacao.js` | os números da ligação principal (o `getStats`) |
| `chat-servidor/internal/pagina/estatico/quadros.js` | diz à área a altura que o aviso curto precisa para não cobrir o Você |
| `chat-servidor/internal/pagina/estatico/pagina.js`, `pagina.html`, `pagina.css` | o botão, o número, o aviso curto, o sinalizador, o cartão e as ligações entre as peças |
| `chat-servidor/pagina/reuniao-falsa.ts` (novo) | os ajudantes dos testes de tela da reunião, tirados do `palco.spec.ts` |
| `chat-servidor/pagina/testes/` | `mensagens.test.mjs`, `qualidade.test.mjs`, `painel.spec.ts` e `qualidade.spec.ts` (novos); `estado.test.mjs`, `palco.spec.ts` e `telas.spec.ts` (mudam) |
| `video-servidor/e2e/mensagens.spec.ts` (novo) | o teste de ponta a ponta |
| `docs/` | o protocolo, os dois guias, o roteiro e as specs |

---

### Task 1: O protocolo e o repasse no servidor

**Files:**
- Modify: `chat-servidor/internal/regras/regras.go`, `chat-servidor/internal/regras/regras_test.go`
- Create: `chat-servidor/internal/reunioes/mensagens.go`, `chat-servidor/internal/reunioes/mensagens_test.go`
- Modify: `chat-servidor/internal/api/pagina.go`, `chat-servidor/internal/api/pagina_test.go`
- Modify: `docs/chat-protocolo.md` (as seções 3, 10 e 12)

**Interfaces:**
- Consumes: o `recebePalco`, o `paginasAceitas`, o `aceitoDe`, o `mandar` e o `despachar` do pacote `reunioes`; a `limites.Nova` e o `tipoDaMensagem` do `pagina.go`.
- Produces:

```go
// regras: o texto de uma mensagem da reunião. Troca \r\n e \r por \n, tira os espaços das pontas e confere: de 1 a
// 1.000 pontos de código, e só a quebra de linha entre os caracteres de controle. Com mais de 1.000, ErrTextoGrande;
// o resto que não vale, *Erro{Campo: "texto"}.
var ErrTextoGrande = errors.New("regras: o texto passa do tamanho")
func TextoDaReuniao(s string) (string, error)

// reunioes: repassa o texto a cada página que recebe o palco, também à de quem escreveu. Devolve nil,
// ErrForaDaReuniao (quem manda não recebe o palco), regras.ErrTextoGrande ou *regras.Erro. Quem manda vem primeiro:
// fora da reunião, o erro é ErrForaDaReuniao, qualquer que seja o texto. Não guarda nada e não registra nada.
func (g *Gerente) Mensagem(p *Pedido, id, texto string) error
```

  - **As mensagens do canal** (seção 10 do protocolo):

```
da página:   {"tipo": "mensagem", "id": "m12", "texto": "…"}
a quem escreveu:  {"tipo": "mensagem", "id": "m12", "de": "<participante>", "nome": "Maria Lima", "voce": true, "texto": "…"}
aos outros:       {"tipo": "mensagem", "de": "<participante>", "nome": "Maria Lima", "voce": false, "texto": "…"}
a recusa:    {"tipo": "mensagemRecusada", "id": "m12", "motivo": "limite" | "grande" | "foraDaReuniao" | "invalida"}
```

  - O `texto` que sai é o que o `TextoDaReuniao` devolve. O `nome` é o do participante na sala, o mesmo do palco.

- [ ] **Step 1: O teste da regra** (`regras_test.go`).

```go
// TestTextoDaReuniao, em tabela:
//   "  Bom dia  " → "Bom dia"; "a\r\nb\rc" → "a\nb\nc"; "\n\noi\n\n" → "oi"
//   1.000 × "a" vale; 1.000 × "😀" vale (pontos de código, e não bytes); 1.001 × "a" → ErrTextoGrande
//   " " + 1.000 × "a" + " " vale (os espaços das pontas saem antes da conta)
//   "", "   ", "\n\t " → *Erro com o Campo "texto"; "a\x00b", "a\x1bb", "a\u0085b" → *Erro; "\xff" → *Erro
//   1.001 × "a" com "\x00" no meio → ErrTextoGrande (o tamanho vem primeiro)
```

- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/regras/`. Esperado: FAIL (a função não existe).
- [ ] **Step 3: O `TextoDaReuniao`,** ao lado do `Texto`.
- [ ] **Step 4: Os testes do repasse** (`mensagens_test.go`), com a cena do palco (`novaCenaPalco`: a Ana, colega, pelo app; a Maria e a Bia, de fora, na reunião; o Davi, que espera). Todo texto e todo `id` dos testes passa pelo `anotar`, para o `conferirLog` do `TestMain` os procurar nos registros.

```go
// TestMensagem_VaiAsPaginasDaReuniao: a Maria manda "Bom dia" com o id "m1" →
//   o canal dela recebe {"tipo":"mensagem","id":"m1","de":"<maria>","nome":"Maria Lima","voce":true,"texto":"Bom dia"}
//   o da Bia recebe {"tipo":"mensagem","de":"<maria>","nome":"Maria Lima","voce":false,"texto":"Bom dia"} (sem o id)
//   o Davi, que espera, não recebe nada; os apps não recebem evento nenhum (p.avisos.total() == 0)
// TestMensagem_QuemEntraDepoisNaoVe: depois da mensagem, o Davi é aceito → ele recebe o aceito (e o palco, se houver),
//   e nenhum "mensagem"
// TestMensagem_QuemSaiu: a Bia sai (o saiu do vídeo) → a mensagem da Maria não chega a ela, e a dela dá ErrForaDaReuniao;
//   com uma senha nova (o NovaSenha), ela volta a receber e a mandar
// TestMensagem_QuemAcabouDeSerAceita: o Davi, aceito e ainda sem entrar, manda e recebe
// TestMensagem_SenhaQueVenceu: aceito, a senha vence sem ele entrar (o relógio e o Varrer) → ErrForaDaReuniao, e não recebe
// TestMensagem_TiradoEsperandoEOutraReuniao: quem foi tirado, quem espera e a página de outra reunião não recebem;
//   o pedido de quem espera e o de quem foi tirado dão ErrForaDaReuniao; o Mensagem(nil, …) também
// TestMensagem_SoComATela: quem saiu com a câmera e continua com a tela recebe e manda (a regra do palco)
// TestMensagem_DoisComOMesmoNome (Review Focus 5): outra página aceita com o nome "Maria Lima" → a mensagem da primeira
//   chega à segunda com "voce":false e sem o id, com o "de" da primeira
// TestMensagem_Texto: "  oi\r\ntudo bem?  " sai como "oi\ntudo bem?"; 1.001 letras → regras.ErrTextoGrande, e ninguém
//   recebe nada; só espaços → *regras.Erro, e ninguém recebe nada; fora da reunião com o texto ruim → ErrForaDaReuniao
// TestMensagem_SemNadaNoLog: manda, recusa pelos três motivos, e o conferirLog não acha os textos, os ids nem os nomes
```

- [ ] **Step 5: Rodar e ver falhar.** `go test ./internal/reunioes/ -run Mensagem`. Esperado: FAIL (o método não existe).
- [ ] **Step 6: O `mensagens.go`.** O texto é conferido antes da trava; a sala e quem manda, com ela. O repasse entra na saída do gerente (o `mandar`) dentro da mesma trava que conferiu quem manda, e o `despachar` vem depois dela. Nenhum `slog`.
- [ ] **Step 7: Os testes do canal** (`pagina_test.go`), com a `novaCenaR` e o `aceitaMaria`.

```go
// TestCanal_Mensagem: a Maria, aceita, manda {"tipo":"mensagem","id":"m1","texto":"Bom dia"} → ela recebe a mensagem
//   com o id, o "voce":true, o "de" dela e o nome "Maria Lima"; uma segunda página aceita recebe sem o id, com "voce":false
// TestCanal_Mensagem_Recusas:
//   antes do pedir, e esperando → {"tipo":"mensagemRecusada","id":"m1","motivo":"foraDaReuniao"}
//   aceita, com 1.001 letras → motivo "grande"; com "   " → motivo "invalida"; o canal continua aberto
//   o id "", o de 17 letras, o "a-b", o id que é número, e o texto que é número ou que falta → {"tipo":"erro","erro":"invalido"}
// TestCanal_Mensagem_Limite: 20 passam; a 21ª → {"tipo":"mensagemRecusada","id":"m21","motivo":"limite"}, e ninguém a
//   recebe; depois de 61 s do relógio, passa de novo
// TestCanal_Mensagem_JanelaAParte: com as 20 do chat gastas, o {"tipo":"tela"} ainda tem resposta, e o camera também;
//   com as 20 das outras gastas (o tela, até o erro limite), a mensagem do chat ainda passa
// TestCanal_Mensagem_OMaiorTexto (Review Focus 3): o id de 16 letras e 1.000 × "😀" (um quadro de 4.055 bytes, dentro
//   dos 4.096 do canal) → a mensagem volta inteira
// TestCanal_Mensagem_SemNadaNoLog: como o TestPagina_SemNomesNoLog, com os textos e os ids
```

- [ ] **Step 8: Rodar e ver falhar.** `go test ./internal/api/ -run Canal_Mensagem`. Esperado: FAIL (o `mensagem` responde `erro` `invalido`).
- [ ] **Step 9: O `pagina.go`.**
  - `maxMensagensChat = 20`, com a janela `limiteChat` ao lado da `limiteCamera`, no `servirCanal`. O `mensagem` usa só ela: não gasta a janela das 20, e as outras mensagens não gastam a dele. Toda mensagem com o tipo `mensagem` conta nela, valha ou não.
  - Passou do limite: com o `id` que vale, a recusa `limite`; sem ele, `{"tipo": "erro", "erro": "limite"}`. A mensagem não chega ao gerente.
  - No `mensagemDaPagina`, o caso `mensagem`: o `id` tem de casar com `^[A-Za-z0-9]{1,16}$` e o `texto` tem de ser um texto; se não, `erro` `invalido`. Depois, o `gerente.Mensagem`: o `ErrForaDaReuniao` vira a recusa `foraDaReuniao`; o `regras.ErrTextoGrande`, `grande`; o `*regras.Erro`, `invalida`. Quando vale, não há outra resposta: a página recebe a própria mensagem de volta.
- [ ] **Step 10: O protocolo** (`docs/chat-protocolo.md`).
  - Seção 3: a regra nova, "O texto de uma mensagem da reunião".
  - Seção 10: o `mensagem` na lista do que a página manda; o `mensagem` e o `mensagemRecusada` na lista do que o servidor manda; a linha das 20 mensagens passa a dizer "sem contar o `camera` nem o `mensagem`"; e um item novo, "O chat da reunião (`mensagem`)", com: quem recebe e quem manda (a regra do palco); o `id` e o `voce`; o `nome`; a hora que não vai; os quatro motivos; o `id` que não vale; que o servidor não guarda nada e que quem entra depois não vê as de antes; e que o maior quadro do canal continua de 4.096 bytes (passando disso, o canal fecha com o código 1009).
  - Seção 12: a linha "Mensagens da página" ganha "e sem o `mensagem`"; e duas linhas novas, a do limite do chat da reunião e a do tamanho do texto.
- [ ] **Step 11: Rodar tudo.** Em `chat-servidor/`: `gofmt -l .`, `go vet ./...` e `go test -race ./...`. Esperado: nenhuma saída do `gofmt`, e PASS.
- [ ] **Step 12: Commit e push.** `feat(chat): o chat da reunião passa pelo canal da página, sem guardar nada`

### Task 2: O cérebro da página

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/mensagens.js`, `chat-servidor/pagina/testes/mensagens.test.mjs`
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`, `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Consumes: as mensagens do canal da tarefa 1.
- Produces, no `mensagens.js` (tudo puro):

```js
export const MAX_TEXTO = 1000;
export const MAX_MENSAGENS = 500;
/** O texto sem os espaços das pontas, ou null se ficar vazio ou passar de 1.000 pontos de código. */
export function textoLimpo(s)
/** O texto em partes, na ordem: {texto} ou {link}. O link é o endereço como foi escrito. */
export function partes(texto)
/** "14:02", na hora local. */
export function hora(ms)
/** O número do botão: "" (nenhuma), "1" a "9", ou "9+". */
export function contagem(n)
/** "Chat", "Chat, 1 mensagem nova" ou "Chat, <n> mensagens novas". */
export function nomeDoBotao(n)
/** "Você", o nome, ou "Participante" sem ele. */
export function quem(m)
/** "<nome> escreveu: <texto numa linha>". */
export function dito(m)
/** O texto da mensagem que não foi, pelo motivo. */
export function falha(motivo)
```

- Produces, no `estado.js`:

```js
export const PRAZO_DA_MENSAGEM_MS = 10000;
export const AVISO_CURTO_MS = 5000;
/** A página pode escrever: a tela da reunião, com o canal da pessoa aberto. */
export function podeEscrever(estado)
// O estado ganha:
//   chat: { mensagens: [], naoLidas: 0, aberto: false, seq: 0 }
//   avisoCurto: null   // ou { n, tipo: 'mensagem', nome, texto }; a tarefa 6 acrescenta o { n, tipo: 'conexao' }
//   avisos: 0          // o número do último aviso curto
// Cada mensagem da lista:
//   { n, voce, nome, texto, hora, situacao: 'enviando' | 'enviada' | 'naoEnviada', id, motivo }
//   o n é o seq da hora em que ela entrou; o id (o "m" mais o n) existe enquanto a página espera a resposta dele;
//   o motivo é null, 'limite', 'grande', 'foraDaReuniao', 'invalida', 'prazo' ou 'semCanal'
// Os eventos novos:
//   { tipo: 'escrever', texto, agora }     { tipo: 'reenviar', n, agora }
//   { tipo: 'clique', botao: 'chat' | 'abrirChat' | 'fecharChat' }
//   as mensagens 'mensagem' e 'mensagemRecusada' do canal, no evento de sempre, que passa a trazer o agora
//   { tipo: 'tempo', chave: 'mensagem:<id>' | 'avisoCurto:<n>' }
// Os efeitos novos: { tipo: 'focarOCampo' } e { tipo: 'focarOChat' }
```

  - **O `agora`** é a hora do relógio da página, em ms. A partir da tarefa 3, o `pagina.js` o põe em todo evento.
  - **O `seq` nunca volta a zero,** nem quando a lista esvazia: o mesmo canal pode servir a duas entradas, e um `id` não se repete nele.

- [ ] **Step 1: Os testes do `mensagens.js`** (`mensagens.test.mjs`).

```js
// 'o texto que vale': textoLimpo('  Bom dia  ') === 'Bom dia'; '' e ' \n ' → null; 1.000 × 'a' vale; 1.000 × '😀' vale;
//   1.001 × 'a' → null; o que não é texto → null
// 'os links': partes('O link é https://exemplo.com.br/relatorio') →
//     [{ texto: 'O link é ' }, { link: 'https://exemplo.com.br/relatorio' }]
//   'veja https://exemplo.com.br/a. Depois' → [{ texto: 'veja ' }, { link: 'https://exemplo.com.br/a' }, { texto: '. Depois' }]
//   '(http://exemplo.com.br/a)' → [{ texto: '(' }, { link: 'http://exemplo.com.br/a' }, { texto: ')' }]
//   'HTTPS://EXEMPLO.COM.BR' vira link; dois links na mesma mensagem; o link no fim de uma linha, com outra depois
//   '<b>https://exemplo.com.br</b>' → o link acaba antes do '<'
//   sem link: 'javascript:alert(1)', 'ftp://exemplo.com.br', 'www.exemplo.com.br', 'http://', 'https:// espaço'
//   juntar as partes dá sempre o texto de volta (nenhuma letra some)
// 'a hora': hora(new Date(2026, 10, 17, 14, 2).getTime()) === '14:02'; às 9h05, '09:05'
// 'o número': contagem(0) === ''; 1 → '1'; 9 → '9'; 10 → '9+'; 500 → '9+'
// 'o nome do botão': 0 → 'Chat'; 1 → 'Chat, 1 mensagem nova'; 2 → 'Chat, 2 mensagens novas'; 12 → 'Chat, 12 mensagens novas'
// 'quem': { voce: true } → 'Você'; { nome: 'Ana Souza' } → 'Ana Souza'; { nome: '' } e sem o nome → 'Participante'
// 'o dito': { nome: 'Carlos Lima', texto: 'linha 1\nlinha 2' } → 'Carlos Lima escreveu: linha 1 linha 2';
//   sem o nome → 'Participante escreveu: …'
// 'a falha': falha('limite') === 'Não enviada: muitas mensagens seguidas. Espere um pouco.';
//   'prazo', 'semCanal', 'foraDaReuniao', 'grande', 'invalida' e null → 'Não enviada'
```

- [ ] **Step 2: Rodar e ver falhar.** `node --test testes/mensagens.test.mjs`. Esperado: FAIL (o módulo não existe).
- [ ] **Step 3: O `mensagens.js`.** O link é o trecho `https?://` seguido do que não é espaço nem `<`, `>` ou `"`, sem a pontuação do fim (escolha 9), e só vale se o `new URL` o aceita com `http:` ou `https:` e um nome de servidor.
- [ ] **Step 4: Os testes do cérebro** (`estado.test.mjs`). Os ajudantes novos: `escrever(texto, agora)`, `reenviar(n, agora)`, `doChat(m, agora)` (o evento `mensagem` com `{tipo: 'mensagem', …m}`) e `recusada(id, motivo)`. O teste `o carregar abre` ganha os três campos novos do estado.

```js
// 'escrever manda a mensagem e a mostra indo': na reunião, escrever('  Bom dia  ', 5000) →
//   efeitos [mandar({ tipo: 'mensagem', id: 'm1', texto: 'Bom dia' }), esperar(10000, 'mensagem:m1')]
//   chat.mensagens: [{ n: 1, voce: true, nome: '', texto: 'Bom dia', hora: 5000, situacao: 'enviando', id: 'm1', motivo: null }]
// 'o texto vazio e o de mais de 1.000 não saem': nada muda
// 'a resposta com o id confirma': doChat({ id: 'm1', voce: true, nome: 'Maria Lima', texto: 'Bom dia' }, 9000) →
//   a mesma mensagem, com situacao 'enviada' e id null, e a hora ainda 5000; nenhuma não lida, nenhum aviso
// 'a mensagem de outra pessoa, com o chat fechado': doChat({ de: '…', nome: 'Carlos Lima', voce: false, texto: 'Oi' }, 1000) →
//   a lista ganha { n: 1, voce: false, nome: 'Carlos Lima', texto: 'Oi', hora: 1000, situacao: 'enviada', id: null, motivo: null }
//   naoLidas 1; avisoCurto { n: 1, tipo: 'mensagem', nome: 'Carlos Lima', texto: 'Oi' }; efeitos [esperar(5000, 'avisoCurto:1')]
//   outra mensagem → naoLidas 2, e o avisoCurto é o dela, com o n 2
//   tempo('avisoCurto:1') não muda nada (é de um aviso que passou); tempo('avisoCurto:2') tira o aviso
// 'com o chat aberto, a mensagem não conta nem avisa'
// 'abrir zera as não lidas, tira o aviso e leva o foco ao campo': clique('chat') e clique('abrirChat') →
//   chat.aberto true, naoLidas 0, avisoCurto null, efeitos [{ tipo: 'focarOCampo' }]
// 'fechar devolve o foco ao botão': clique('fecharChat') → aberto false, efeitos [{ tipo: 'focarOChat' }];
//   o clique('chat') com ele aberto fecha, sem efeito (o foco já está no botão)
// 'fora da tela da reunião, os cliques do chat, o escrever e o reenviar não fazem nada'
// 'a recusa marca Não enviada, com o motivo': recusada('m1', 'limite') → situacao 'naoEnviada', motivo 'limite', id null
// 'sem resposta em 10 s': tempo('mensagem:m1') → 'naoEnviada', motivo 'prazo', e o id continua 'm1';
//   a resposta atrasada (o doChat com o id 'm1') ainda a confirma; o tempo de uma já confirmada não muda nada
// 'o Tentar de novo manda de novo, no fim da lista': com [a minha, que não foi (n 1), a do Carlos (n 2)], reenviar(1, 7000) →
//   efeitos [mandar({ tipo: 'mensagem', id: 'm3', texto }), esperar(10000, 'mensagem:m3')];
//   a lista fica [n 2, n 3], e a n 3 está 'enviando', com a hora 7000
//   reenviar de uma que não está 'naoEnviada', de um n que não existe, ou sem o canal: nada muda
// 'a resposta de um id que a página não espera mais vira outra mensagem' (Review Focus 5): depois do prazo e do
//   reenviar, o doChat com o id 'm1' e voce true → a lista ganha outra mensagem minha, 'enviada'; a 'm2' continua 'enviando'
// 'sem o canal, o escrever guarda a mensagem como Não enviada': situacao 'naoEnviada', motivo 'semCanal', id null, sem efeitos
// 'a lista esvazia quando a página sai da tela da reunião': depois do clique('sair'), do tirado, do encerrada e da
//   página que desiste de voltar (as 3 tentativas da conexão caída) → chat igual a { mensagens: [], naoLidas: 0,
//   aberto: false, seq: <o de antes> }, e avisoCurto null
// 'a lista fica enquanto a página tenta voltar': com mensagens, o SEM_CONEXAO, as tentativas e a volta (o confirmada)
//   não mexem na lista, nas não lidas nem no painel aberto; o canal que cai e religa também não
// 'as mensagens que chegam com a página entrando ficam para a reunião' (escolha 15): no entrando, o doChat entra na
//   lista e conta como não lida, sem aviso curto; depois do confirmada, ela continua lá
// 'antes do aceito e depois do fim, a mensagem do chat fica de fora': no aguardando e no saiu, nada muda
// 'a mensagem sem texto, ou com o texto que não é texto, fica de fora'
// 'a página guarda as últimas 500' (Review Focus 7): com 501, a lista tem 500, e a primeira é a n 2
// 'o Entrar de novo começa vazio, e os ids não se repetem': sair, entrar de novo, escrever → o id é 'm2'
```

- [ ] **Step 5: Rodar e ver falhar.** `node --test testes/estado.test.mjs`. Esperado: FAIL nos testes novos.
- [ ] **Step 6: O cérebro.**
  - A regra da tela da reunião fica num lugar só, no fim da `transicao`, como o aviso da câmera: fora do `entrando` e do `reuniao`, o chat é o vazio (com o `seq` de antes); fora do `reuniao`, o `avisoCurto` é `null`.
  - O aviso curto de uma mensagem só nasce na tela `reuniao`, com o chat fechado.
  - Nenhum efeito novo sai das transições que já existem: os testes de hoje, que conferem a lista inteira dos efeitos, continuam valendo sem mudar.
- [ ] **Step 7: Rodar.** Em `chat-servidor/pagina/`: `node --test testes/*.test.mjs`. Esperado: PASS, com os testes de antes.
- [ ] **Step 8: Commit e push.** `feat(chat): o cérebro da página guarda as mensagens da reunião`

### Task 3: O painel, no PC e no celular

**Files:**
- Create: `chat-servidor/pagina/reuniao-falsa.ts`, `chat-servidor/internal/pagina/estatico/painel.js`, `chat-servidor/pagina/testes/painel.spec.ts`
- Modify: `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/pagina.css`, `chat-servidor/internal/pagina/estatico/pagina.js`
- Modify: `chat-servidor/pagina/testes/palco.spec.ts` (passa a importar os ajudantes), `chat-servidor/pagina/testes/telas.spec.ts` (as duas listas dos controles), `chat-servidor/internal/pagina/pagina_test.go` (os arquivos novos no `TestPagina_Estaticos`)

**Interfaces:**
- Consumes: o `estado.chat`, o `podeEscrever` e os eventos da tarefa 2; o `partes`, a `hora`, o `quem` e a `falha` do `mensagens.js`.
- Produces:

```js
/**
 * O painel do chat. A raiz é o <aside class="painel">; o fundo, os elementos que ficam atrás dele quando ele cobre a
 * tela (o alto da reunião, a área dos quadros e os controles); o toque diz se o ponteiro é o dedo.
 */
export function criarPainel({ raiz, fundo, toque, aoEscrever, aoReenviar, aoFechar })
// → { desenhar({ aberto, mensagens, podeEscrever }), focar() }
//   aoEscrever(texto), aoReenviar(n) e aoFechar() viram os eventos 'escrever', 'reenviar' e o clique 'fecharChat'
//   focar(): o campo; na tela de toque, ou com o campo desligado, o título do painel
```

  - **No HTML,** a área dos quadros ganha um pai, `<div class="meio">`, e o painel é o irmão dela: `<aside class="painel" aria-label="Chat da reunião" hidden>`. O que os testes e as outras tarefas usam:
    - o botão dos controles: `button[data-botao="chat"]`, com o `aria-pressed`;
    - os dois botões de fechar: `button[data-botao="fecharChat"]`, o `.painel-fechar` (`Fechar o chat`) e o `.painel-voltar` (`Voltar para a reunião`); o estilo mostra um só;
    - o título: `<h2 tabindex="-1">Chat da reunião</h2>`;
    - a lista: `.painel-lista`, com o aviso do alto, o `Nenhuma mensagem ainda.` e a `<ul class="painel-mensagens">`;
    - cada mensagem: `<li class="mensagem" data-mensagem="<n>" data-de="voce|outro" data-situacao="…">`, com o `.mensagem-quem`, o `.mensagem-texto` e, na que não foi, o `.mensagem-falha` e o `button[data-reenviar="<n>"]`;
    - o campo: `<textarea id="mensagem" rows="1" maxlength="1000">`, com o `<label class="so-leitor">`; o botão `.painel-enviar`; e a linha `.painel-sem-canal`;
    - o campo e o botão ficam num `<div>`, e não num `<form>`: a CSP da página tem `form-action 'none'`.
  - **O modo** fica no `data-modo` do painel, `lado` ou `cobre`, que o `painel.js` põe pela regra da escolha 5. O CSS se guia por ele.

**Os ajudantes dos testes.** O `reuniao-falsa.ts` recebe, sem mudar, o que hoje está dentro do `palco.spec.ts` e que os testes novos também usam: o `ACEITO`, a `LIGACAO_FALSA`, o `titulo`, o `botao`, a `caixa`, as pessoas e os palcos (`DOIS`, `TRES`, `QUATRO`), o `mensagemDo`, o `mosaico`, o `outraImagem`, o `naReuniao`, o `comOPalco` e o `naReuniaoCom`. O `beforeEach` e o `afterEach` do `palco.spec.ts` (a CSP e o console) viram duas funções dele, `vigiar(page)` e `conferir(page)`, que cada arquivo de teste chama nos seus. O `palco.spec.ts` passa a importar tudo de lá, e os 50 testes dele continuam passando.

- [ ] **Step 1: Tirar os ajudantes do `palco.spec.ts`** para o `reuniao-falsa.ts`. Rodar `npm run typecheck` e `npx playwright test testes/palco.spec.ts`. Esperado: PASS, 50 testes, como antes.
- [ ] **Step 2: Os testes** (`painel.spec.ts`). O relógio da página está parado às 10:00 (o `AGORA`). O palco é o `TRES`, e quem entra é a Maria Lima.

```ts
// No PC (1280×800):
// 'o Chat abre o painel ao lado, e os quadros se arrumam no que sobra' (critério 3): antes, a área tem 1232 px de
//   largura; o clique no Chat → o painel aparece (a região "Chat da reunião"), com 360 px, a 24 px da direita; a área
//   fica com 860 px; todo quadro fica dentro da área, e nenhum encosta no painel; o Você continua no canto dela;
//   o Chat tem aria-pressed "true"; aparecem o título, o aviso do alto e "Nenhuma mensagem ainda.";
//   o "Fechar o chat" aparece, e o "Voltar para a reunião" não; o foco está no campo "Mensagem para todos da reunião"
// 'o Enter manda, e o Shift+Enter pula linha': "Bom dia", Shift+Enter, "tudo bem?", Enter → o canal recebe
//   { tipo: 'mensagem', id: 'm1', texto: 'Bom dia\ntudo bem?' }; o campo fica vazio; a mensagem aparece à direita, com
//   "Você · 10:00", em duas linhas, com data-situacao "enviando" e a opacidade 0,6; o canal responde com o id →
//   data-situacao "enviada" e a opacidade 1
// 'o botão de mandar': desligado com o campo vazio ou só com espaços; o clique manda, e o foco volta ao campo
// 'o Enter no meio de uma composição não manda' (o keydown com isComposing)
// 'a mensagem dos outros, com o nome e a hora': a do Carlos aparece à esquerda, com "Carlos Lima · 10:00"; o relógio
//   anda 1 minuto, e a seguinte tem "10:01"; a de nome "" aparece com "Participante"
// 'o texto com sinais de HTML aparece como texto' (critério 4): o texto '<img src=x onerror=alert(1)><b>oi</b>' →
//   o balão tem esse texto, letra por letra, e o painel não ganha <img> nem <b>
// 'o endereço vira um link que abre em outra aba' (critério 4): "O link do relatório é https://exemplo.com.br/relatorio." →
//   um <a> com o texto e o href "https://exemplo.com.br/relatorio", o target "_blank" e o rel "noopener noreferrer";
//   o ponto do fim fica fora do link; "javascript:alert(1)" e "www.exemplo.com.br" não viram link
// 'a mensagem recusada pelo limite': o canal responde { tipo: 'mensagemRecusada', id: 'm1', motivo: 'limite' } →
//   "Não enviada: muitas mensagens seguidas. Espere um pouco." e o "Tentar de novo"; o clique nele → o canal recebe o
//   mesmo texto com o id 'm2', e a mensagem vai para o fim da lista
// 'a resposta que não chega': o relógio anda 10 s → "Não enviada" e o "Tentar de novo"
// 'sem o canal, o campo fica desligado': o canal cai (o código 1006) → o campo e o botão de mandar desligados,
//   "O chat volta quando a conexão voltar." à vista, as mensagens ainda na lista, e o "Tentar de novo" desligado;
//   a página religa o canal (o voltar e o voltou) → o campo liga de novo, e a linha some
// 'o Esc fecha o chat e devolve o foco ao botão Chat': com o Carlos aumentado e o foco no campo, o Esc → o painel some,
//   o foco está no Chat, e o Carlos continua aumentado; outro Esc, com o foco no Chat, volta à grade
// 'a lista rolada' (Review Focus 2): com 40 mensagens e a lista no alto, chega uma do Carlos → o scrollTop não muda;
//   a pessoa manda uma → a lista vai ao fim; com a lista no fim, chega outra → ela continua no fim
// 'o texto fora do comum' (Review Focus 3): um endereço de 900 letras, uma palavra de 1.000, "😀" × 50 e um texto em
//   árabe → a lista não rola para o lado (scrollWidth ≤ clientWidth), e o painel continua com 360 px
// 'o campo cresce até 120 px e não passa de 1.000 letras': com 8 linhas, a altura dele é 120 px, e ele rola;
//   depois de mandar, ele volta a 44 px; 1.005 letras digitadas → o campo tem 1.000
// 'a janela que cruza os 900' (Review Focus 4): com o chat aberto e "rascunho" no campo, a janela vai a 880×800 →
//   o painel cobre a janela inteira, aparece o "Voltar para a reunião", e os controles ficam fora do teclado (inert);
//   de volta a 1280×800 → ao lado de novo, com "rascunho" ainda no campo e o foco nele
// 'o Sair com o chat aberto, e o Entrar de novo começa vazio'
// 'a conexão que cai e volta deixa as mensagens': o cartão "A conexão caiu" cobre a área, e o painel fica como estava
//
// No celular (390×844, com o toque):
// 'os quatro controles, e o painel que cobre a tela': os controles são Microfone, Câmera, Chat e Sair, numa linha só;
//   o toque no Chat → o painel ocupa a janela inteira (0, 0, 390, 844), com "Chat da reunião" e "Você continua na
//   reunião"; o "Voltar para a reunião" aparece, e o "Fechar o chat" não; o alto da reunião, a área e os controles
//   ficam inert; o foco está no título do painel, e não no campo (escolha 6);
//   o "Voltar para a reunião" → o painel some, o foco vai ao Chat, e os quadros estão lá
// 'no celular, o Enter pula linha e o botão manda' (escolha 7)
// 'o teclado do celular' (Review Focus 1): com o window.visualViewport de mentira (a altura 500, e o resize dele) →
//   o painel fica com 500 px de altura, e o campo inteiro acima dos 500; com o offsetTop 120 → o top do painel é 120 px;
//   fechado o painel, as duas medidas saem do style
// 'o celular deitado e o tablet' (Review Focus 4): em 844×390 e em 1180×820, com o toque, o painel cobre a tela
//
// Em todos: o conferir(page) no afterEach (nenhuma violação da CSP, nenhum erro e nenhum nome ou texto no console).
```

- [ ] **Step 3: Rodar e ver falhar.** `npx playwright test testes/painel.spec.ts`. Esperado: FAIL (o botão `Chat` não existe).
- [ ] **Step 4: O HTML e o CSS,** com as medidas de "Os desenhos". Os ícones novos entram na folha de símbolos: `#i-chat`, `#i-fechar`, `#i-voltar` e `#i-enviar`. Os controles do celular passam a quatro colunas.
- [ ] **Step 5: O `painel.js`.**
  - A lista é acertada pelo `n` de cada mensagem: a que entra é criada no fim, a que muda de situação é mudada no lugar, e a que saiu da lista é tirada. O texto entra pelas `partes`, cada uma num nó de texto ou num `<a>`.
  - A rolagem é a da escolha 4, medida antes de a lista mudar.
  - O teclado é o das escolhas 6 e 7. O Esc dentro do painel chama o `aoFechar` e marca o evento como tratado (`preventDefault`), para os quadros não voltarem à grade junto.
  - O modo é o da escolha 5, e muda sozinho quando a janela muda (o `change` do `matchMedia`). Aberto e cobrindo, o `fundo` fica `inert`; se o foco ficou atrás do painel, ele vai ao título do painel.
  - Cobrindo a tela, o painel segue a parte visível da janela (o `resize` e o `scroll` do `window.visualViewport`): a altura e o `top` vão pelo `style`. Ao lado, ou fechado, as duas medidas saem.
- [ ] **Step 6: O `pagina.js`.**
  - Todo evento chega ao cérebro com o `agora` (o `relogio.agora()`), posto no `despachar`.
  - Ele cria o painel, chama o `desenhar` dele a cada estado, e roda os dois efeitos novos: o `focarOCampo` (o `painel.focar()`) e o `focarOChat` (o foco no botão `Chat`).
  - O botão `Chat` ganha o `aria-pressed` do estado. O clique dele já vira evento pelo `data-botao`.
- [ ] **Step 7: Os testes de hoje que mudam.** No `telas.spec.ts`, as duas listas dos controles ganham o `Chat` antes do `Sair`: `['Microfone', 'Câmera', 'Chat', 'Sair']` e `['Microfone', 'Câmera', 'Compartilhar a tela', 'Chat', 'Sair']`. No `pagina_test.go`, o `TestPagina_Estaticos` ganha o `/r/estatico/painel.js` e o `/r/estatico/mensagens.js` (Review Focus 6: o `no-cache`). Nenhum outro teste muda.
- [ ] **Step 8: Rodar** a prova inteira do chat. Esperado: PASS.
- [ ] **Step 9: Commit e push.** `feat(chat): o painel do chat da reunião, ao lado no PC e cobrindo a tela no celular`

### Task 4: O número, o aviso curto e o leitor de tela

**Files:**
- Modify: `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/pagina.css`, `chat-servidor/internal/pagina/estatico/pagina.js`, `chat-servidor/internal/pagina/estatico/quadros.js`
- Modify: `chat-servidor/pagina/testes/painel.spec.ts`

**Interfaces:**
- Consumes: o `estado.chat.naoLidas` e o `estado.avisoCurto` (tarefa 2); a `contagem`, o `nomeDoBotao` e o `dito` do `mensagens.js`; o botão `Chat` da tarefa 3.
- Produces:
  - o número: `<span class="contagem" aria-hidden="true">` dentro do botão `Chat`, e o `aria-label` do botão quando há mensagens novas;
  - o aviso curto: `<div class="aviso-curto" data-tipo="mensagem" hidden>` dentro da área dos quadros (`.palco`), com o `.aviso-curto-quem`, o `.aviso-curto-linha` e o `button[data-botao="abrirChat"]`. A tarefa 6 usa o mesmo elemento, com o `data-tipo="conexao"` e o `button[data-botao="verDetalhes"]`;
  - **`dizer(texto)`,** no `pagina.js`: põe o texto na região que os leitores de tela anunciam (`[data-campo="anuncio"]`) trocando o nó de texto dela, para o mesmo texto ser dito duas vezes. A tarefa 6 a usa;
  - **`--acima-do-voce`,** que o `quadros.js` põe no `style` da área dos quadros: a distância, em px, do fundo da área até 8 px acima do Você do canto. Sem o Você no canto, a propriedade sai.

- [ ] **Step 1: Os testes** (no `painel.spec.ts`).

```ts
// 'com o chat fechado, o número no botão e o aviso curto' (critério 2): chega uma mensagem do Carlos →
//   o botão mostra "1" e se chama "Chat, 1 mensagem nova"; o aviso aparece, com "Carlos Lima escreveu", o texto numa
//   linha e o "Abrir o chat"; a região do leitor de tela tem "Carlos Lima escreveu: <texto>"; 5 s depois o aviso some,
//   e o número fica; com 10 mensagens, o botão mostra "9+" e se chama "Chat, 10 mensagens novas"
// 'um aviso por vez' (Review Focus 7): duas mensagens com 3 s entre elas → há um aviso só, com a segunda, e ele some
//   5 s depois dela; 30 mensagens seguidas → um aviso só na página
// 'o Abrir o chat do aviso': o clique → o painel abre, o número e o aviso somem, e o foco está no campo
// 'o aviso fica no meio, logo acima dos controles': em 1280×800, o meio dele fica a até 2 px do meio da área dos
//   quadros, e o fundo dele, a 8 px do fundo da área
// 'o aviso não cobre o Você' (escolha 10): em 1280×800, em 1000×700 e no celular (390×844, com o toque), com o TRES →
//   a caixa do aviso não encosta na do quadro com data-papel "canto", e fica dentro da área
// 'o texto do aviso é texto, numa linha': o texto '<b>oi</b>\nsegunda linha' aparece com os sinais, numa linha só,
//   e o aviso não ganha um <b>; um texto de 1.000 letras é cortado com reticências, sem alargar o aviso
// 'o leitor de tela ouve cada mensagem dos outros, também a repetida' (escolha 11): duas mensagens iguais do Carlos →
//   a região muda duas vezes (contadas por um MutationObserver); com o chat aberto, ela também muda;
//   a mensagem da própria pessoa não é dita; o aviso que aparece não tem role "status" nem aria-live
// 'no celular, o número fica no canto do botão': dentro do botão, em cima, à direita, sem cobrir o texto "Chat"
```

- [ ] **Step 2: Rodar e ver falhar.** `npx playwright test testes/painel.spec.ts`. Esperado: FAIL nos testes novos.
- [ ] **Step 3: O HTML, o CSS e o `quadros.js`.** O aviso com as medidas de "Os desenhos". A regra da área estreita usa a consulta de contêiner que a área dos quadros já permite (`container-type: size`): `@container (max-width: 760px)`, com o `bottom: var(--acima-do-voce, 8px)`.
- [ ] **Step 4: O `pagina.js`** desenha o número, o nome do botão e o aviso, e diz as mensagens dos outros: ele guarda o `n` da última que disse, e diz a mais nova que ainda não foi dita.
- [ ] **Step 5: Rodar** a prova inteira do chat. Esperado: PASS.
- [ ] **Step 6: Commit e push.** `feat(chat): a mensagem nova com o chat fechado mostra o número e um aviso curto`

### Task 5: A conta do sinalizador

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/qualidade.js`, `chat-servidor/pagina/testes/qualidade.test.mjs`

**Interfaces:**
- Consumes: nada das outras tarefas.
- Produces:

```js
export const INTERVALO_MS = 2000;
export const VALIDADE_DO_RELATORIO_MS = 10000;
/** Os limites da conta, num lugar só (risco 4 da spec). A perda é uma fração; o atraso, em ms. */
export const LIMITES = Object.freeze({ perda: { instavel: 0.02, ruim: 0.08 }, atraso: { instavel: 250, ruim: 500 } });

/**
 * O que uma leitura guarda do getStats (um RTCStatsReport, ou qualquer coisa com o forEach dele):
 * { agora, som, video, perdaQueSai, atraso }
 *   agora: o maior timestamp do relatório, em ms
 *   som: { recebidos, perdidos } do inbound-rtp de áudio, ou null; video: { recebidos, perdidos, imagens } do de vídeo
 *     (imagens: o framesDecoded), ou null; mais de um do mesmo tipo são somados
 *   perdaQueSai: a maior fractionLost dos remote-inbound-rtp com o timestamp a até 10 s do agora, ou null
 *   atraso: em ms, o currentRoundTripTime do par de endereços em uso; sem ele, o roundTripTime do remote-inbound-rtp
 *     do som com até 10 s; sem os dois, null
 * Sem relatório, null.
 */
export function leitura(relatorio)
/** A medida entre duas leituras: { perda, atraso, nadaChegou }. A perda é uma fração, ou null; o atraso, ms, ou null. */
export function medida(antes, depois)
/** 'ruim', 'instavel', 'boa' ou 'semNumero' (a tabela da seção 7.4 da spec). */
export function classificar(m)
/** A conta do estado mostrado: { mostrado: 'medindo', ultimas: [], semNumero: 0 } no começo. */
export function conta()
/** A conta depois de mais uma medida classificada. */
export function passo(c, classe)
/**
 * O medidor. ler() devolve a promessa do relatório da ligação principal (ou de null); o relogio é o da página;
 * visivel() diz se a aba está à vista; aoMedir({ estado, perda, atraso }) recebe o estado mostrado e os números da
 * última medida, a cada medida.
 */
export function criarMedidor({ ler, relogio, visivel, aoMedir })
// → { medir(ligado) }: ligar começa do zero (uma conta nova e a primeira leitura na hora); desligar para.
```

  - **O par em uso:** o `candidate-pair` cujo `id` é o `selectedCandidatePairId` do `transport`; sem ele, o que tem `selected` verdadeiro; sem ele, o `nominated` com o `state` `succeeded`.
  - **A perda do que chega,** de cada tipo: os perdidos sobre os perdidos mais os recebidos, desde a leitura anterior. Os perdidos que diminuem contam zero. Sem pacote novo nenhum, ou com um contador que andou para trás, aquele tipo não dá número.
  - **A perda** da medida é a maior entre a do som, a do vídeo e a `perdaQueSai` da leitura de agora.
  - **O `nadaChegou`:** nenhum pacote de som novo e nenhuma imagem nova, entre os tipos que as duas leituras têm. Sem nenhum tipo nas duas, é falso.

- [ ] **Step 1: Os testes** (`qualidade.test.mjs`). O relatório de mentira é um `Map` com os objetos do `getStats`, feito por um ajudante `relatorio({ agora, som, video, sai, par, … })`.

```js
// 'a leitura': tira os números de um relatório com o inbound-rtp de áudio e de vídeo, os dois remote-inbound-rtp, o
//   transport e o par em uso (o currentRoundTripTime 0.045 → o atraso 45)
//   o remote-inbound-rtp com o timestamp 10.001 ms atrás não conta, e o de 10.000 conta
//   sem o par em uso, o atraso é o roundTripTime do som (0.21 → 210); velho também, null
//   o par pelo selected, e pelo nominated com succeeded, quando falta o transport
//   o relatório vazio dá { som: null, video: null, perdaQueSai: null, atraso: null }; sem relatório, null
// 'a medida': entre duas leituras com 100 pacotes de som novos e 10 perdidos novos → a perda 10/110
//   vale a maior: o som com 1%, o vídeo com 5% e a que sai com 3% → 0.05
//   os perdidos que diminuem contam zero; o contador que andou para trás não dá número
//   nenhum pacote de som novo e nenhuma imagem nova → nadaChegou; com o som chegando e a imagem parada, não
// 'a tabela' (seção 7.4): a perda 0.0199 → 'boa'; 0.02 → 'instavel'; 0.0799 → 'instavel'; 0.08 → 'ruim';
//   o atraso 249.9 → 'boa'; 250 → 'instavel'; 499.9 → 'instavel'; 500 → 'ruim'; o nadaChegou → 'ruim'
//   um número só decide: { perda: 0.1, atraso: null } → 'ruim'; { perda: null, atraso: 300 } → 'instavel'
//   sem número nenhum, com alguma coisa chegando → 'semNumero'
// 'medindo nas 2 primeiras medidas': depois de uma 'boa', 'medindo'; depois da segunda, 'boa'
//   as duas primeiras 'boa' e 'ruim' → 'boa' (a menos ruim); 'ruim' e 'ruim' → 'ruim'
// 'piora com 2': de 'boa', uma 'ruim' não muda; a segunda → 'ruim'; 'instavel' e 'ruim' → 'instavel', e mais uma 'ruim' → 'ruim'
// 'melhora com 5': de 'ruim', quatro 'boa' não mudam, e a quinta → 'boa', direto;
//   com 'instavel' entre as cinco → 'instavel' (a pior das cinco); uma 'ruim' no meio recomeça a conta das cinco
// 'a medida sem número não conta': de 'boa', 'ruim', 'semNumero', 'ruim' → 'ruim'; uma 'semNumero' sozinha não muda nada;
//   duas seguidas → 'medindo', e depois são precisas duas medidas com número de novo
// 'o critério 6, com leituras falsas': a cada 2 s, 100 pacotes de som e 250 de vídeo; com 10% de perda nos dois →
//   'ruim' em até 5 leituras (10 s) a partir da primeira com perda; sem perda de novo → 'boa' em até 10 leituras (20 s)
// 'o medidor': com o ler, o relogio e o visivel de mentira: a primeira leitura sai na hora do medir(true), e as outras a
//   cada 2.000 ms; cada medida chama o aoMedir com o estado e os números; depois do medir(false), mais nenhuma leitura
//   e mais nenhum aoMedir, nem da leitura que estava no ar
// 'a aba escondida': escondida, o medidor não lê; quando ela volta, a primeira leitura não dá medida (é só a base), e o
//   estado mostrado continua o de antes
// 'o ler que falha': a promessa recusada, e o relatório null, não param o medidor nem viram medida
```

- [ ] **Step 2: Rodar e ver falhar.** `node --test testes/qualidade.test.mjs`. Esperado: FAIL (o módulo não existe).
- [ ] **Step 3: O `qualidade.js`.** O `passo`, na ordem:
  - a classe `semNumero` soma 1 às seguidas sem número; com 2, o mostrado vira `medindo` e as últimas esvaziam;
  - as outras zeram as seguidas sem número e entram nas últimas, que guardam 5;
  - piora quando as 2 últimas são piores que o mostrado (o `medindo` conta como melhor que todas): passa para a menos ruim das duas;
  - senão, melhora quando há 5 e as 5 são melhores que o mostrado: passa para a pior das cinco.
  - O medidor não escreve nada no console, e não guarda o relatório depois da leitura.
- [ ] **Step 4: Rodar.** `node --test testes/*.test.mjs`. Esperado: PASS.
- [ ] **Step 5: Commit e push.** `feat(chat): a conta do sinalizador de qualidade da reunião`

### Task 6: O sinalizador na tela

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`, `chat-servidor/pagina/testes/estado.test.mjs`
- Modify: `chat-servidor/internal/pagina/estatico/ligacao.js`, `chat-servidor/internal/pagina/estatico/pagina.js`, `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/pagina.css`
- Modify: `chat-servidor/pagina/reuniao-falsa.ts` (os números de mentira), `chat-servidor/internal/pagina/pagina_test.go` (o `qualidade.js` no `TestPagina_Estaticos`)
- Create: `chat-servidor/pagina/testes/qualidade.spec.ts`

**Interfaces:**
- Consumes: o `criarMedidor` (tarefa 5); o aviso curto e o `dizer` (tarefa 4).
- Produces:

```js
// ligacao.js: o criarLigacoes passa a devolver também
//   numeros(): a promessa do getStats da ligação principal, ou de null sem ela
// estado.js:
export const AVISO_DA_CONEXAO_MS = 120000;
// O estado ganha:
//   qualidade: { estado: 'medindo', perda: null, atraso: null }
//   cartao: false            // o cartão do sinalizador, aberto
//   conexaoAvisada: false    // o aviso de conexão ruim já saiu nos últimos 2 minutos
// Os eventos novos:
//   { tipo: 'qualidade', estado, perda, atraso }   // do medidor
//   { tipo: 'clique', botao: 'qualidade' | 'verDetalhes' | 'fecharCartao' }
//   { tipo: 'tempo', chave: 'conexaoAvisada' }
// O efeito novo: { tipo: 'focarOSinal' }
```

  - **No HTML,** no alto da reunião: `<div class="sinal">` com o `button.sinal-botao[data-botao="qualidade"][data-estado]` (o `aria-expanded`, o `aria-controls="sinal-cartao"`, as três `.barra` e o `.sinal-texto`) e o `<div id="sinal-cartao" class="sinal-cartao" hidden>` (o `.sinal-titulo`, a `.sinal-explicacao`, a `<ul class="sinal-dicas">` com as três dicas e o `.sinal-numeros`). O sinalizador e os dois selos ficam num pai novo, `.topo-direita`.
  - **Os números de mentira dos testes:** a `LIGACAO_FALSA` ganha o `numeros()`, que devolve o `window.numerosFalsos?.() ?? null`. O `reuniao-falsa.ts` ganha o `comARede(page, { perda, atraso })`, que põe na página um `numerosFalsos` com contadores que andam a cada chamada (100 pacotes de som e 250 de vídeo, com a perda pedida) e o atraso pedido no par em uso; a perda e o atraso podem ser mudados depois, e o atraso pode faltar.

- [ ] **Step 1: Os testes do cérebro** (`estado.test.mjs`). O `o carregar abre` ganha os três campos novos.

```js
// 'a medida guarda o estado e os números': na reunião, { tipo: 'qualidade', estado: 'boa', perda: 0, atraso: 45 } →
//   estado.qualidade igual a { estado: 'boa', perda: 0, atraso: 45 }, sem efeitos
// 'virar ruim avisa, no máximo uma vez a cada 2 minutos': de 'boa' a 'ruim' → avisoCurto { n, tipo: 'conexao' },
//   conexaoAvisada true, efeitos [esperar(5000, 'avisoCurto:<n>'), esperar(120000, 'conexaoAvisada')];
//   outra medida 'ruim' não avisa de novo; de volta a 'boa' e a 'ruim' dentro dos 2 minutos: nenhum aviso;
//   depois do tempo('conexaoAvisada'), a próxima virada a 'ruim' avisa
// 'o cartão': clique('qualidade') abre e fecha; abrir tira o aviso da conexão; clique('fecharCartao') fecha;
//   clique('verDetalhes') → cartao true, avisoCurto null, efeitos [{ tipo: 'focarOSinal' }]
// 'com o cartão aberto, virar ruim não avisa e não gasta o aviso' (escolha 17): conexaoAvisada continua false
// 'o aviso da mensagem toma o lugar do da conexão, e o contrário': um só por vez
// 'com a conexão caída, o sinalizador mede de novo': o SEM_CONEXAO → qualidade igual à do começo; a medida que chega
//   com a ligação fora do ar não muda nada; na volta (o confirmada), continua 'medindo' até a medida seguinte
// 'fora da tela da reunião, o cartão fecha e o sinalizador volta ao começo'
```

- [ ] **Step 2: Rodar e ver falhar.** `node --test testes/estado.test.mjs`. Esperado: FAIL nos testes novos.
- [ ] **Step 3: O cérebro.** A regra da tela da reunião (tarefa 2) ganha: fora do `reuniao`, o `cartao` é falso; sem a principal no ar na tela `reuniao`, a `qualidade` é a do começo. O aviso da conexão só nasce na virada para `ruim`, com o cartão fechado e sem aviso nos últimos 2 minutos. Rodar `node --test testes/estado.test.mjs`. Esperado: PASS.
- [ ] **Step 4: Os testes da tela** (`qualidade.spec.ts`), com o `naReuniaoCom(page, TRES)` e o `comARede`. O relógio anda de 2 em 2 s.

```ts
// 'o sinalizador começa medindo e passa a Conexão boa': na entrada, o botão tem "Medindo a conexão…", se chama
//   "Medindo a conexão", e tem data-estado "medindo"; com a rede boa, depois da segunda medida ele tem "Conexão boa" e se
//   chama "Conexão boa. Ver os detalhes"
// 'os quatro estados, com o desenho e o texto': para cada estado, o texto, o nome, a cor da borda e as barras acesas
//   (a cor de cada .barra): boa 3, instável 2 (a perda de 4%), ruim 1 (a perda de 12%), medindo 0
// 'o cartão de cada estado': o clique no botão → aria-expanded "true" e o cartão à vista, com o título, a explicação e
//   as dicas do estado (0, 2, 3 e 0) e, menos no medindo, os números: "Perda: 4% · Atraso: 210 ms";
//   sem o atraso, "Perda: 4% · Atraso: —"; os números mudam a cada medida com o cartão aberto;
//   o clique no botão, o Esc e o clique fora fecham o cartão; o Esc com o cartão aberto e um quadro aumentado fecha só o cartão
// 'a perda de 10% vira Conexão ruim em até 10 s, e a rede boa de novo vira Conexão boa em até 20 s' (critério 6):
//   com "Conexão boa" na tela, a perda vai a 10% → o relógio anda 10 s → "Conexão ruim"; a perda volta a 0 →
//   o relógio anda 20 s → "Conexão boa"
// 'o aviso de conexão ruim, no máximo um a cada 2 minutos': na virada → o aviso curto com "Sua conexão está ruim" e o
//   "Ver os detalhes", com a borda #ff8a8a, e a região do leitor de tela com "Sua conexão está ruim"; 5 s depois ele some;
//   boa e ruim de novo, 1 minuto depois: nenhum aviso; passados os 2 minutos, a virada seguinte avisa;
//   o "Ver os detalhes" → o cartão abre, o aviso some, e o foco está no botão do sinalizador
// 'o aviso de conexão ruim com o chat aberto não cobre o Você' (escolha 10): em 1000×700, com o painel ao lado, o
//   aviso fica dentro da área dos quadros e não encosta no quadro com data-papel "canto"
// 'com a conexão caída, Medindo a conexão…': o semConexao da ligação falsa → "Medindo a conexão…", com o cartão
//   "A conexão caiu" na área; na volta, medindo e depois "Conexão boa"
// 'no celular, só o desenho' (390×844, com o toque): o botão tem 44×44 px, o texto dele não aparece, o nome dele é
//   "Conexão boa. Ver os detalhes", o "Nada é gravado" não aparece, e o cartão aberto cabe na janela
// 'compartilhando a tela, o sinalizador continua no alto', ao lado do "Você está compartilhando a tela"
// 'o medidor para fora da reunião': depois do Sair, o numeros() da ligação falsa não é mais chamado
//
// Em todos: o conferir(page) no afterEach.
```

- [ ] **Step 5: Rodar e ver falhar.** `npx playwright test testes/qualidade.spec.ts`. Esperado: FAIL (o botão não existe).
- [ ] **Step 6: O `ligacao.js`,** o HTML e o CSS, com as medidas de "Os desenhos".
- [ ] **Step 7: O `pagina.js`.**
  - Ele cria o medidor, com o `ligacao.numeros`, o relógio da página e a aba à vista (`document.visibilityState`), e o liga e desliga no desenho, como já faz com a mídia: ligado na tela `reuniao` com a principal no ar.
  - Cada medida vira o evento `qualidade`.
  - Ele desenha o botão, o cartão e o aviso da conexão, e roda o efeito `focarOSinal`. A virada do aviso para a conexão é dita com o `dizer`.
  - O Esc com o cartão aberto fecha o cartão antes de tudo (um ouvinte na fase de captura, que marca o evento como tratado). O clique fora do sinalizador fecha o cartão.
- [ ] **Step 8: Rodar** a prova inteira do chat. Esperado: PASS.
- [ ] **Step 9: Commit e push.** `feat(chat): o sinalizador de qualidade no alto da reunião`

### Task 7: De ponta a ponta

**Files:**
- Create: `video-servidor/e2e/mensagens.spec.ts`
- Modify: `video-servidor/e2e/servidores.ts` (os textos das mensagens entre o que os registros não podem ter), `video-servidor/e2e/seguranca.spec.ts` (o teste dos registros confere que os textos foram anotados)

**Interfaces:**
- Consumes: a página inteira (tarefas 1 a 6), a `Pagina` do `navegador.ts` e a `novaReuniaoDeTeste`.
- Produces: no `servidores.ts`, o tipo novo `textos` do que os testes anotam: o campo `texto` das mensagens do canal, quando tem 12 letras ou mais. O `segredosNosRegistros` passa a procurá-los nas saídas do chat, do agente e do FreeSWITCH.

- [ ] **Step 1: Os testes** (`mensagens.spec.ts`), com três páginas na mesma reunião de teste: A (Carlos Lima), B (Bia Ramos) e C (Maria Lima). Os textos são únicos e compridos, para o teste dos registros os achar se vazarem.

```ts
// 'a mensagem chega aos outros' (critérios 1 e 2): A abre o chat e manda "Recado 7c41 do Carlos: https://exemplo.com.br/relatorio" →
//   em A, ela aparece à direita, com "Você" e a hora; em B e em C, com o chat fechado, o botão mostra "1" e o aviso
//   curto diz "Carlos Lima escreveu"; B abre o chat e vê "Carlos Lima", a hora e o link;
//   do quadro que A mandou até o que B e C receberam passa menos de 1 s (as horas dos quadros do canal, vistas pelo teste)
// 'cada um responde, e ninguém vê a conversa de outra reunião': B responde, e A e C recebem; uma quarta página, em
//   outra reunião de teste, não recebe nenhum "mensagem"
// 'quem saiu não recebe' (critério 5): C clica em Sair; A manda outra → B recebe; em 2 s, o canal de C não recebe
//   nenhum "mensagem"; C clica em "Entrar de novo", abre o chat e vê "Nenhuma mensagem ainda."
// 'o sinalizador sai do Medindo para Conexão boa': em cada página, o botão passa de "Medindo a conexão…" a
//   "Conexão boa" em até 15 s; o cartão mostra "Perda: <n>% · Atraso: <n> ms", com os dois números
// 'Conexão boa por 20 s com todos sem câmera e sem microfone': três páginas novas entram com a câmera desligada e
//   desligam o microfone; depois de "Conexão boa" em todas, o texto do botão é lido a cada segundo, por 20 s, e é
//   sempre "Conexão boa". Se não for, o erro leva o texto do cartão daquela hora (a perda e o atraso).
// No fim de cada um, o conferirOConsole de cada página.
```

- [ ] **Step 2: O `servidores.ts` e o `seguranca.spec.ts`.** O tipo `textos` entra no `anotarSegredos` e no `segredosUsados`, e o teste dos registros ganha `expect(usados.textos.length).toBeGreaterThan(0)` (critério 7).
- [ ] **Step 3: Rodar aqui.** Em `video-servidor/e2e/`, com o FreeSWITCH desta máquina: `npx playwright test mensagens.spec.ts seguranca.spec.ts`. Esperado: PASS. O `mensagens.spec.ts` roda mais 2 vezes sozinho, para ver se o teste dos 20 s é firme.
- [ ] **Step 4: Rodar os tipos:** `npx tsc --noEmit -p .` em `video-servidor/e2e/`. Esperado: sem erros.
- [ ] **Step 5: Commit e push,** e esperar o workflow `video` do GitHub ficar verde com o `mensagens.spec.ts` na lista. `test(video): o chat da reunião e o sinalizador de ponta a ponta`

### Task 8: Os guias, o roteiro e as specs

**Files:**
- Modify: `docs/chat-servidor.md` (o passo 9), `docs/video-servidor.md` (a reunião de teste do passo 4), `docs/teste-manual.md` (a seção 29, "O que precisa" e os critérios)
- Modify: `docs/superpowers/specs/2026-11-19-starsonic-phone-reunioes-chat-e-qualidade-design.md` (o status e as escolhas deste plano), `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md` e `docs/superpowers/specs/2026-11-18-starsonic-phone-reunioes-palco-design.md` (a seção 13 da spec)

**Interfaces:**
- Consumes: os textos das telas, como ficaram.
- Produces: nada para outra tarefa.

- [ ] **Step 1: O `docs/chat-servidor.md`, passo 9.**
  - Na lista do que a pessoa vê na reunião: o `Chat` entre os botões, e o sinalizador ao lado do `Nada é gravado`.
  - Um parágrafo novo, "O chat da reunião e o sinalizador de qualidade (a partir da `0.2.0-rc.6`)": o que cada um faz; que as mensagens somem quando a reunião acaba e não ficam em servidor nenhum; que o sinalizador mostra a cada pessoa só a conexão dela; os dois números do cartão, que a pessoa pode ler ao telefone para o suporte; e que só o chat muda nesta versão (o servidor de vídeo fica como está).
  - Que a atualização é a de sempre (passo 7), fora do horário das reuniões: quem estiver numa reunião na hora continua com a imagem e o som, e fica sem o chat da reunião até entrar de novo.
- [ ] **Step 2: O `docs/video-servidor.md`, passo 4.** A reunião de teste ganha dois passos, antes do `Sair`: mandar uma mensagem do PC e ver o número e o aviso no celular, e responder do celular; e olhar o sinalizador (`Conexão boa`) e abrir o cartão.
- [ ] **Step 3: O `docs/teste-manual.md`.**
  - Em "O que precisa": o chat na `0.2.0-rc.6`; um PC com o Chrome e o Firefox; um iPhone com o Safari e um celular Android com o Chrome; e, para o sinalizador, um celular que possa se afastar do Wi-Fi.
  - A seção 29, "O chat da reunião e o sinalizador (chat `0.2.0-rc.6`)", com a tabela de sempre e as colunas `Chrome`, `Firefox`, `iPhone` e `Android`:

    | # | O que a linha confere |
    |---|---|
    | 29.1 | Depois de atualizar o chat: o `Chat` nos controles e o sinalizador no alto, que sai de `Medindo a conexão…` para `Conexão boa` |
    | 29.2 | A mensagem do PC chega ao celular em menos de 1 segundo, com o nome e a hora; a própria aparece à direita, com `Você` |
    | 29.3 | Com o chat fechado: o número no botão e o aviso curto, que some sozinho; o `Abrir o chat` |
    | 29.4 | No PC, abrir o chat não esconde ninguém: os quadros se arrumam ao lado |
    | 29.5 | Um endereço vira link e abre em outra aba; um texto com `<b>` aparece com os sinais |
    | 29.6 | No celular, o chat cobre a tela e o som da reunião continua; o `Voltar para a reunião` |
    | 29.7 | O teclado do celular: com o teclado aberto, o campo e as últimas mensagens ficam à vista (iPhone e Android) |
    | 29.8 | O Enter manda no PC e pula linha no celular; o Shift+Enter pula linha no PC |
    | 29.9 | 21 mensagens seguidas: a 21ª fica `Não enviada: muitas mensagens seguidas. Espere um pouco.`, e o `Tentar de novo` a manda depois de um minuto |
    | 29.10 | Sair e entrar de novo: a lista começa vazia; quem entra depois não vê as mensagens de antes |
    | 29.11 | O cartão do sinalizador: `Sua conexão está boa` e os dois números, no uso normal |
    | 29.12 | O celular que se afasta do Wi-Fi até a imagem falhar: `Conexão instável` ou `Conexão ruim`, o aviso `Sua conexão está ruim`, e a volta a `Conexão boa` perto do Wi-Fi |
    | 29.13 | Com o leitor de tela do celular ligado (se houver quem saiba usar): ele diz `<nome> escreveu: <texto>` |

  - A linha 29.12 diz que o limitador de rede das ferramentas do navegador não serve: ele não mexe na imagem nem no som da reunião.
  - Em "Onde cada critério de sucesso é verificado": os 7 critérios da spec, cada um com o teste que o prova (os nomes dos testes das tarefas 1 a 7) e a linha da seção 29.
- [ ] **Step 4: As specs.** Na de 19/11: o status ("aprovada em 19/11, com o Continue; construída na `0.2.0-rc.6`") e, na seção 14, as escolhas deste plano. Na de 12/11, seção 5: "O chat dentro da reunião" sai da lista para a página, e fica para o app até a etapa 2. Na de 18/11: a lista dos controles ganha o `Chat`, e o alto da tela ganha o sinalizador.
- [ ] **Step 5: Conferir.** Os comandos dos guias numa linha e sem sublinhado; nenhum endereço ou nome de verdade; as tabelas com as mesmas colunas em todas as linhas; e os textos das telas iguais aos do código (uma busca de cada texto de "Os textos" no `pagina.html` e nos `.js`).
- [ ] **Step 6: Commit e push.** `docs: o chat da reunião e o sinalizador no guia, no roteiro e nas specs`

## Depois das tarefas

- **A revisão final:** um revisor de fora, no modelo mais capaz, lê tudo o que este plano mudou, com a spec, este plano, o "Review Focus" e as decisões anotadas. Os achados críticos e importantes ganham um teste que falha e a correção, numa passada só.
- **O GitHub:** os workflows `chat`, `video` e `build` verdes no último commit.
- **Para o responsável:** publicar o chat `0.2.0-rc.6` (o workflow `chat-release`), atualizar a VM do chat num horário sem reuniões, e fazer a seção 29 do roteiro. O servidor de vídeo e os apps ficam como estão.
