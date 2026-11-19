# Reuniões com link, etapa 1b — a página no navegador — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a página da reunião no navegador, servida pelo chat em `/r/<código>`, do jeito do quadro aprovado "Starsonic — reunião no navegador". Com ela, quem é de fora entra numa reunião pelo PC ou pelo celular, e o responsável entra pelo navegador na reunião de teste (spec 12, etapa 1).

**Architecture:**
- **O chat** (`chat-servidor/`, ainda a 0.2.0) ganha um pacote `internal/pagina`. Ele serve a página e os arquivos dela, embutidos no binário, com os cabeçalhos de segurança.
- **A página** é HTML, CSS e JavaScript em módulos, sem passo de build:
  - um **cérebro puro**, o `estado.js`: os eventos entram, e saem o estado novo e os efeitos. Ele é testado com o `node --test`;
  - uma **camada da tela**, o `pagina.js`, que desenha o estado e roda os efeitos;
  - três **adaptadores**: a rede (`rede.js`), a câmera e o microfone (`midia.js`), e as ligações com o JsSIP (`ligacao.js`).
- **O JsSIP 3.13.8** vai junto, num arquivo só, montado a partir do pacote oficial. Um passo do CI confere que ele é o do pacote.
- **Os testes:**
  - o cérebro, no `node --test`;
  - as telas, no Playwright, com o chat de verdade no modo de teste servindo a página, e a rede da página trocada por respostas prontas;
  - de ponta a ponta, a página de verdade numa reunião de verdade (o `video-servidor/e2e`).

**Tech Stack:**
- **O Go de hoje** (`go 1.26.0`, `toolchain go1.27.4`), sem dependência nova no chat.
- **A página:** JavaScript ES2020 em módulos, CSS e HTML, e o `jssip` 3.13.8 (MIT), embutido.
- **Os testes da página:** Node 22, `@playwright/test` 1.56.1 (o Chromium), `typescript` 5.9.3, `@types/node` 22.20.5 e o `jssip` 3.13.8 (só para conferir o arquivo embutido), com o `package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`, aprovada pelo responsável em 12/11/2026.
- **Valem nesta etapa:**
  - 4.1 (a página);
  - 4.2 (entrar pelo link e estar na reunião, pelo lado da página);
  - 6.4;
  - 9 (a câmera, o microfone e a tela; o que fica guardado);
  - 10 (os textos da página);
  - 11.1 (os itens 1, 2 e 4, na página);
  - 11.2 (de ponta a ponta);
  - 11.3 (o roteiro manual da etapa 1);
  - 12 (a etapa 1).
- **O quadro "Starsonic — reunião no navegador"** foi aprovado pelo responsável em 17/11/2026 ("pode seguir o quadro"). O código-fonte das telas dele está na pasta de trabalho deste plano, em `quadro/`: 11 arquivos `.dc.html`, que são a referência visual. Os textos e as medidas que contam estão neste plano.
- **Os contratos:**
  - `docs/chat-protocolo.md`: a seção 10, a página e o canal; a 12, os limites;
  - `docs/video-agente.md`: a seção 6, o SIP; a 7, o quadro de quem está sem câmera.

## Global Constraints

- **O lugar:**
  - a página fica em `chat-servidor/internal/pagina/`, com os arquivos estáticos em `estatico/`;
  - os testes dela ficam em `chat-servidor/pagina/` (o `package.json` próprio);
  - nada novo no `go.mod` do chat.
- **Sem passo de build:**
  - a página carrega módulos ES (`<script type="module">`) e o JsSIP num `<script defer>`;
  - os arquivos servidos são os mesmos que estão no repositório.
- **O CSP manda:**
  - sem `<script>` nem `<style>` dentro do HTML, e sem atributo `style=`;
  - o JavaScript muda a aparência pelas classes, pelo `hidden` e, quando precisa, pelo `elemento.style`, que o CSP deixa.
- **Nada de fora:**
  - a página só pede ao próprio chat (o HTML, os scripts, o CSS, a fonte e o logo), ao servidor de vídeo (o WSS) e ao TURN;
  - sem CDN, sem Google Fonts e sem telemetria;
  - a fonte (Plus Jakarta Sans) e o logo (`logo-negativo.png`) vêm de `/admin/estatico/`, a rota pública que a administração já tem.
- **Nada guardado no navegador:** sem cookie, sem `localStorage` e sem `sessionStorage` ("Nada é gravado").
  - O console da página nunca mostra o bilhete, a senha nem as credenciais do TURN.
- **Os registros do servidor** seguem a regra de hoje: sem nomes, sem números de telefone e sem códigos de link, senhas ou bilhetes.
  - A rota `/r/<código>` não escreve o código em registro nenhum.
- **Os navegadores** (spec 6.4): Chrome, Edge, Firefox e Safari, no PC e no celular.
  - Os testes automáticos rodam no Chromium. O Safari do iPhone entra no roteiro manual (spec 13, risco 3).
- **O endereço do vídeo pode ter porta** (por exemplo `video.exemplo.com.br:7443`). O WSS que a página abre é o `video.wss` do Acesso, com a porta. O CSP também leva a porta.
- **Ruling do quadro:**
  - a tela "app ou navegador" do PC fica para a etapa 2 (a 0.5.0, quando o app abrir o link). Até lá, a página vai direto à entrada, no PC e no celular;
  - o "Entrar de novo", depois do Sair, volta direto à reunião pelo `senha` do canal, sem a espera;
  - o "Não foi possível entrar" não tem botão.
- **Os textos** são os da seção "Os textos", letra por letra. Um texto novo precisa de uma ruling.
- **O visual** é o da seção "O visual", com as medidas do quadro.
- **A acessibilidade:**
  - todo botão é um `<button>`, e todo campo tem `<label>`;
  - o Microfone e a Câmera usam `aria-pressed`;
  - a mudança de tela vai para uma região `aria-live="polite"`, e o foco vai para o título da tela nova;
  - os alvos de toque têm 44 px ou mais;
  - o contraste do texto é de 4,5:1 ou mais.
- **O repositório é público:** nenhum segredo em arquivo, teste ou registro.
- **Os commits** são em português, como os da branch, e terminam com o `Co-Authored-By` do agente e a linha `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
  - Cada tarefa dá commit e push a cada passo verde, na `reunioes-etapa-1`.
- **As versões:** o chat continua `0.2.0` (quem escolhe o rc é a release), e o vídeo continua `0.1.0`.

## Review Focus

1. **O som no Safari do iPhone.** O som que chega só toca depois de um gesto. A pessoa espera ouvir a reunião sem tocar em mais nada depois do "Pedir para entrar". O clique nesse botão dá o primeiro `play()` no elemento de som, dentro do próprio clique. Teste na Task 6.
2. **A rede que cai no meio da reunião** (o celular que troca do Wi-Fi para o 4G). A página entra de novo sozinha, com "A conexão caiu. Entrando de novo…", até 3 vezes. Depois, ela mostra "Você saiu da reunião", com o "Entrar de novo". Testes na Task 5 (o cérebro) e na Task 7 (de ponta a ponta).
3. **A ligação que o servidor termina sem aviso no canal** (o celular dormiu e caiu pelo tempo sem mídia). A página nunca fica com o mosaico parado: ela mostra "Você saiu da reunião", com o "Entrar de novo". Teste na Task 5.
4. **O nome que o servidor recusaria:**
   - só espaços, mais de 80 caracteres, ou caracteres de controle colados;
   - o botão fica desligado, e o campo não aceita mais de 80;
   - um `erro invalido` do servidor volta à entrada com "Confira o seu nome.".
   - Testes na Task 5 e na Task 6.
5. **A câmera ocupada por outro programa ou sem aparelho,** e o pedido de permissão fechado sem resposta (o `NotReadableError`, o `NotFoundError` e o `NotAllowedError`). A pessoa vê o aviso de acesso, com o "Tentar de novo", e entra com o que funciona. Teste na Task 6.

## O visual

- **As cores**, da folha da administração e do quadro:
  - o fundo `#f5f7fb`, o texto `#0a0e1a` e o texto apagado `#5b6478`;
  - o azul-marinho `#0c2671`, a faixa de cima `#070b18` com o rótulo `#b9c4e6`, o ciano `#00c2cb` e o texto sobre o ciano `#03222a`;
  - as bordas `#e7eaf2` e `#cfd5e3`;
  - o erro `#a1251c` sobre `#fdecea`, o aviso `#8a4b00` sobre `#fff1dc`;
  - o Sair `#c23b3b`;
  - na reunião, o fundo `#0a0e1a`, as barras `#070b18`, os botões `#1c2540` com a borda `#2c3757`, e o botão desligado `#a1251c`.
- **A letra** é a Plus Jakarta Sans, de `/admin/estatico/`, com o `system-ui` de reserva. Os títulos têm peso 800, os botões 700, e os rótulos em maiúsculas 12,5 px com espaçamento de 0,08em.
- **As formas:**
  - os botões são pílulas (`border-radius: 999px`) com 48 px de altura, ou 52 px na reunião;
  - os cartões têm raio de 18 px e borda de 1 px;
  - a imagem da câmera e o mosaico são 16:9, com raio de 18 px e 12 px.
- **O PC e o celular:**
  - acima de 600 px de largura, a entrada tem duas colunas: a imagem com os botões, e o formulário;
  - abaixo, uma coluna só, com os dois botões lado a lado e o "Pedir para entrar" na largura toda;
  - na reunião do celular, os controles são três botões numa grade, com o ícone sobre o rótulo, e "Gire o celular para ver a reunião maior." aparece em retrato.
- **Os ícones** são SVG de traço (a família do quadro), com `aria-hidden="true"` ao lado de um texto.

## Os textos

Os textos de cada tela, letra por letra, vêm do quadro aprovado e da spec 10.

- **A página:** o `lang="pt-BR"`, e o título da aba "Reunião — Starsonic".
- **A faixa de cima:** o logo (`alt` "Starsonic soluções de voz e dados") e "Reunião".
- **O cabeçalho da reunião:**
  - o sobretítulo depende do `tipo`:
    - `marcada`: "Reunião marcada · <quando>";
    - `naHora`: "Reunião agora";
    - `teste`: "Reunião de teste".
  - O título é o `assunto`, ou "Reunião" sem ele.
  - O `<quando>` é "Hoje, 14:00", "Amanhã, 09:30" ou "18/11, 14:00", na hora local do navegador.
- **A entrada:**
  - na imagem: "A sua imagem", ou "A câmera está desligada";
  - os botões: "Microfone" e "Câmera";
  - "Você escolhe aqui se entra com a câmera e o microfone ligados.";
  - o campo "Seu nome", com a ajuda "O seu nome aparece para quem vai aceitar o pedido, e no seu quadro da reunião.";
  - o botão "Pedir para entrar". Sem nome, ele fica desligado e aparece "Digite o seu nome para pedir.";
  - "Nada é gravado.";
  - o nome recusado: "Confira o seu nome." (texto novo).
- **Sem acesso:**
  - o aviso "Sem acesso à câmera ou ao microfone: libere no navegador", com "Clique no cadeado ao lado do endereço da página, permita a câmera e o microfone, e depois em Tentar de novo. Você também pode entrar só para ver e ouvir.";
  - o botão "Tentar de novo";
  - na imagem, sem câmera: "O navegador não deixou usar a câmera";
  - com os dois sem acesso: "Sem a permissão, os dois ficam desligados.";
  - sem câmera: "Entrando assim, você vê e ouve a reunião, e o seu quadro mostra só o seu nome.".
- **A espera:**
  - "Aguardando ser aceito…", com "Os colegas que estão na reunião receberam o seu pedido. Se ninguém responder em 10 minutos, o pedido acaba.";
  - a linha "<título> · <quando>", só com o título fora da marcada;
  - o nome, os botões Microfone e Câmera, e o "Desistir".
- **A reunião não começou:**
  - "A reunião ainda não começou", com "Ela começa quando um colega da empresa a abrir. Aí o seu pedido chega aos colegas, e você espera ser aceito. Pode deixar esta página aberta.";
  - "Você vai entrar como <nome>";
  - o "Desistir".
- **Entrando:** "Entrando na reunião…" (texto novo).
- **Na reunião:**
  - o selo "Nada é gravado";
  - os botões "Microfone", "Câmera", "Compartilhar a tela" (só onde o navegador tem a captura de tela) e "Sair";
  - compartilhando: o selo "Você está compartilhando a tela" e o botão "Parar de compartilhar";
  - no celular em retrato: "Gire o celular para ver a reunião maior.";
  - a conexão caída: "A conexão caiu. Entrando de novo…", com "Espere um instante: a página volta sozinha para a reunião.".
- **Os avisos** (título; texto; botão):

  | O aviso | O título | O texto | O botão |
  |---|---|---|---|
  | `naoFoiPossivel` | Não foi possível entrar | O seu pedido não foi aceito. Se achar que foi engano, fale com quem mandou o link. | — |
  | `cheia` | A reunião está cheia | Ela já tem 10 pessoas. Tente de novo quando alguém sair. | Tentar de novo |
  | `esperaCheia` | Muita gente esperando para entrar | A sala de espera está cheia. Tente de novo daqui a pouco. | Tentar de novo |
  | `servidorCheio` | O servidor de reuniões está cheio agora | Há muitas reuniões ao mesmo tempo. Tente de novo daqui a alguns minutos. | Tentar de novo |
  | `semServidor` | O servidor de reuniões não respondeu | Tente de novo daqui a pouco. Se continuar, avise quem mandou o link. | Tentar de novo |
  | `linkInvalido` | Este link não vale mais | A reunião foi cancelada, passou da data ou já acabou. Peça um link novo a quem convidou você. | — |
  | `tentativas` | Muitas tentativas | Este endereço tentou abrir links demais. Espere um pouco para tentar de novo. | "Tentar de novo em <n> s", desligado e contando; depois "Tentar de novo" |
  | `tirado` | Você foi tirado da reunião | Um colega da empresa tirou você da reunião. | — |
  | `encerrada` | A reunião acabou | Um colega encerrou a reunião para todos, ou ela foi cancelada. | — |
  | `saiu` | Você saiu da reunião | Para voltar, clique em Entrar de novo. | Entrar de novo |

## O desenho

1. **A rota.**
   - `GET /r/{codigo}` devolve sempre a mesma página, para qualquer código. Quem diz se o link vale é o abrir, que tem o limite de tentativas. A rota não revela nada.
   - Os arquivos ficam em `GET /r/estatico/{arquivo}`.
2. **Abrir duas vezes.**
   - A página abre a reunião ao carregar, só para o cabeçalho e para saber cedo que um link não vale.
   - Ela abre de novo ao "Pedir para entrar", para ter um bilhete novo (ele vale 30 segundos) e abrir o canal na hora. O canal fecha sozinho sem um `pedir` em 2 minutos.
3. **O cérebro é puro.**
   - O `transicao(estado, evento)` devolve `{estado, efeitos}`, sem tocar no DOM, na rede ou no relógio.
   - A camada da tela roda os efeitos e devolve os resultados como eventos.
   - Assim, toda regra da página tem teste no `node --test`.
4. **A captura da tela nasce no clique.**
   - O Safari e o Firefox só deixam pedir a tela dentro do gesto. Por isso, o clique em "Compartilhar a tela" chama o `getDisplayMedia` na hora, e só depois o cérebro recebe o `telaCapturada`.
   - O primeiro `play()` do som também nasce no clique do "Pedir para entrar" (Review Focus 1).
5. **A câmera desligada é o vídeo só para receber.**
   - A seção 7 do contrato diz que, com o navegador só recebendo o vídeo, o FreeSWITCH mostra o quadro `#1B2333` com o nome. O `mod_conference` testa o fluxo `SENDONLY`/`INACTIVE` do lado dele (`conference_video.c`, linhas 2465-2510 na 1.11.3).
   - Desligar a câmera é:
     - pôr o transceiver do vídeo em `recvonly`;
     - fazer o `replaceTrack(null)`;
     - parar a faixa da câmera, para a luz apagar;
     - renegociar (`sessao.renegotiate()`).
   - Ligar a câmera é o caminho de volta: um `getUserMedia` só de vídeo, o `replaceTrack`, o `sendrecv` e a renegociação.
   - Entrar com a câmera desligada já faz a oferta com o vídeo em `recvonly`.
   - O navegador continua mandando o RTCP e o ICE no caminho do vídeo, então a ligação não cai pelo tempo sem mídia (seção 6 do contrato). A Task 7 prova isso com 70 segundos.
6. **O microfone desligado é o `track.enabled = false`:** o RTP continua.
   - Sem microfone nenhum, a ligação manda um silêncio gerado: um oscilador ligado num ganho zero, num `MediaStreamAudioDestination`. Um destino vazio não manda RTP, e a ligação cairia em 60 segundos.
7. **O canal fica aberto depois do Sair.**
   - O "Entrar de novo" manda `senha`, que dá uma senha nova para o mesmo participante.
   - Se o canal já fechou, o "Entrar de novo" abre de novo e passa pela espera.
8. **A conexão do vídeo que cai** é o evento `semConexao` da ligação (o UA do JsSIP desconectou com a ligação de pé). A página:
   - desliga as ligações;
   - pede `senha`;
   - liga de novo.
   - A ligação principal nova toma o lugar da anterior no agente (seção 6 do contrato).
   - São até 3 tentativas, depois de 2, 4 e 8 segundos, dentro do limite de 5 `senha` por minuto.
9. **O canal que cai depois do aceito** não tira ninguém da reunião (seção 10 do protocolo).
   - A ligação continua, e a página marca o canal como fechado.
   - O "Compartilhar a tela" fica desligado.
   - Uma queda da ligação, a partir daí, leva ao aviso `saiu`.
10. **O limite do abrir que dá certo** (a decisão D54 da 1a). O abrir que dá certo ganha uma janela própria: 60 por minuto por endereço.
    - Ela fica acima dos 10 de uma reunião e dos recarregamentos deles, e abaixo da fila de 100 bilhetes de uma reunião.
    - Um endereço não consegue mais empurrar para fora os bilhetes dos outros.
    - O 61º abrir recebe o `429 tentativas` de hoje.
11. **A sala que acabou não volta** (T11 M6(a) da 1a). Quando chega um `entrou`, ou um `estado`, de uma sala que o gerente lembra como acabada (a memória do fim, de 10 minutos), o gerente não a recria. Ele pede ao agente o `Encerrar` dela, fora do mutex e uma vez só.

## Os arquivos

- **Criar, no chat:**
  - `chat-servidor/internal/pagina/pagina.go`: a rota, os arquivos e os cabeçalhos;
  - `pagina_test.go`;
  - `pagina.html`: o esqueleto, com todas as telas.
- **Criar, em `chat-servidor/internal/pagina/estatico/`:**
  - `inicio.js`: liga os adaptadores e começa;
  - `estado.js`: o cérebro;
  - `pagina.js`: o desenho e os efeitos;
  - `rede.js`: o abrir e o canal;
  - `midia.js`: a câmera, o microfone, o silêncio e a captura da tela;
  - `ligacao.js`: as ligações do JsSIP;
  - `pagina.css`;
  - `jssip.js` (gerado);
  - `jssip-licenca.txt`.
- **Criar, nos testes da página (`chat-servidor/pagina/`):**
  - `package.json` e `package-lock.json`;
  - `tsconfig.json` e `playwright.config.ts`;
  - `montar-jssip.mjs`;
  - `chat.ts`: sobe o chat no modo de teste;
  - `rede-falsa.ts`: as respostas prontas do abrir e do canal;
  - `testes/estado.test.mjs`, `testes/montar-jssip.test.mjs` e `testes/*.spec.ts`.
- **Mudar:**
  - `chat-servidor/internal/servidor/servidor.go`, que monta `/r/`;
  - `chat-servidor/internal/api/pagina.go` e o limite;
  - `chat-servidor/internal/reunioes/eventos.go`, para a sala que acabou;
  - `chat-servidor/internal/admin/paginas/reunioes.html`, o texto do cartão;
  - `video-servidor/e2e/estatico.mjs`, o `servidores.ts`, o `package.json` e o lock;
  - `video-servidor/e2e/pagina.spec.ts`, novo;
  - `.github/workflows/chat.yml`, com o job `pagina`;
  - os documentos: `docs/chat-protocolo.md`, `docs/chat-servidor.md`, `docs/video-servidor.md` e `docs/teste-manual.md`.

---

### Task 1: O JsSIP da página

**Files:**
- Create: `chat-servidor/pagina/package.json`, `chat-servidor/pagina/package-lock.json`, `chat-servidor/pagina/montar-jssip.mjs`, `chat-servidor/pagina/testes/montar-jssip.test.mjs`
- Create (gerados): `chat-servidor/internal/pagina/estatico/jssip.js`, `chat-servidor/internal/pagina/estatico/jssip-licenca.txt`
- Modify: `video-servidor/e2e/estatico.mjs`, `video-servidor/e2e/package.json`, `video-servidor/e2e/package-lock.json`, `.github/workflows/chat.yml`

**Interfaces:**
- Produces:
  - `/r/estatico/jssip.js` define o `window.JsSIP` (o mesmo objeto que o cliente mínimo usa hoje);
  - `node montar-jssip.mjs` escreve o arquivo;
  - `node montar-jssip.mjs --conferir` sai com 1 e diz a diferença quando o arquivo do repositório não é o do pacote.

- [ ] **Step 1: O teste do montador.**
  - `testes/montar-jssip.test.mjs` (`node:test`):
    - `montar duas vezes dá os mesmos bytes`;
    - `o arquivo começa com o cabeçalho` (a primeira linha é `// Gerado por chat-servidor/pagina/montar-jssip.mjs a partir do jssip 3.13.8 (MIT). Não edite.`);
    - `o --conferir acusa um byte trocado` (numa cópia numa pasta temporária, ele sai com 1).
  - O montador recebe a pasta do `node_modules` e o arquivo de saída por argumento, para o teste.
- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && npm ci && node --test testes/montar-jssip.test.mjs`. Esperado: FAIL, porque o montador não existe.
- [ ] **Step 3: O montador.**
  - Ele leva para `montar-jssip.mjs` a parte de juntar módulos do `video-servidor/e2e/estatico.mjs`: o `require` mínimo e a ordem determinística.
  - Ele escreve o `jssip.js` e copia o `LICENSE` do pacote para o `jssip-licenca.txt`.
- [ ] **Step 4: Gerar, e rodar os testes.** `node montar-jssip.mjs && node --test testes/` dá PASS.
- [ ] **Step 5: O e2e usa o arquivo embutido.**
  - O `estatico.mjs` passa a servir `chat-servidor/internal/pagina/estatico/jssip.js` em `/jssip.js` e perde o montador.
  - O `jssip` sai do `package.json` do e2e, e o lock é refeito.
- [ ] **Step 6: O CI.**
  - O `chat.yml` ganha o job `pagina`, no `ubuntu-24.04`, com o Node 22: `npm ci`, `node montar-jssip.mjs --conferir` e `node --test testes/`.
  - Os `paths` do `chat.yml` já cobrem o `chat-servidor/**`.
- [ ] **Step 7: Commit e push.** O `video` (com o "De ponta a ponta", que agora usa o arquivo embutido) e o `chat` ficam verdes.

### Task 2: A rota da página

**Files:**
- Create: `chat-servidor/internal/pagina/pagina.go`, `chat-servidor/internal/pagina/pagina_test.go`, `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/inicio.js`, `chat-servidor/internal/pagina/estatico/pagina.css`
- Modify: `chat-servidor/internal/servidor/servidor.go` e o teste dele

**Interfaces:**
- Consumes:
  - `reunioes.(*Gerente).Video() Video`, com o `WSS() string`;
  - o `Base` do servidor (`https://chat.exemplo.com.br`, ou `http://127.0.0.1:<porta>` no modo de teste).
- Produces:
  - `pagina.Novo(d pagina.Deps) http.Handler`, montado em `/r/`;
  - `pagina.Deps{Video func() string; OrigemCanal string}`:
    - o `Video` devolve o WSS de agora, ou `""`;
    - o `OrigemCanal` é o `ws(s)://` do próprio chat.
  - O esqueleto `pagina.html` carrega `/admin/estatico/` (a fonte e o logo), `/r/estatico/pagina.css`, `/r/estatico/jssip.js` (`defer`) e `/r/estatico/inicio.js` (`type="module"`), nessa ordem.

- [ ] **Step 1: Os testes.** Em `pagina_test.go`, com o `httptest`:
  - `TestPagina_QualquerCodigo`: o `GET /r/k7q49xwpht` e o `GET /r/qualquercoisa` dão `200`, `text/html; charset=utf-8`, e o corpo tem `/r/estatico/inicio.js`.
  - `TestPagina_Cabecalhos`: com o `OrigemCanal` `wss://chat.exemplo.com.br` e o `Video` `wss://video.exemplo.com.br:7443/sip`, os cabeçalhos são exatamente estes:
    - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self' wss://chat.exemplo.com.br wss://video.exemplo.com.br:7443; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
    - `Referrer-Policy: no-referrer`;
    - `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)`;
    - `X-Content-Type-Options: nosniff`;
    - `Cache-Control: no-store`.
  - `TestPagina_SemVideo`: com o `Video` dando `""`, o `connect-src` é `'self' wss://chat.exemplo.com.br`.
  - `TestPagina_Teste`: com o `OrigemCanal` `ws://127.0.0.1:8090` e o `Video` `ws://127.0.0.1:9443/sip`, o `connect-src` leva `ws://127.0.0.1:8090 ws://127.0.0.1:9443`.
  - `TestPagina_Estaticos`:
    - o `inicio.js` sai como `text/javascript; charset=utf-8`;
    - o `pagina.css` sai como `text/css; charset=utf-8`;
    - o `jssip-licenca.txt` sai como `text/plain; charset=utf-8`;
    - todos com `X-Content-Type-Options: nosniff` e `Cache-Control: no-cache`.
  - `TestPagina_NaoEncontrado`: o `/r/`, o `/r/a/b`, o `/r/estatico/nada.js` e o `/r/estatico/..%2fpagina.go` dão `404`.
  - `TestPagina_SoLeitura`: o `POST /r/k7q49xwpht` dá `405`.
  - `TestServidor_MontaAPagina`, no `servidor`: o `GET /r/k7q49xwpht` do handler montado dá `200`, e nada do que o servidor registrou durante o pedido tem `k7q49xwpht`.
- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 go test ./internal/pagina/ ./internal/servidor/`. Esperado: FAIL.
- [ ] **Step 3: O pacote.**
  - O `embed` leva `pagina.html` e `estatico/*`.
  - A origem do vídeo é o `esquema://host[:porta]` do WSS.
  - O `inicio.js` e o `pagina.css` ficam com uma linha de comentário só, que as Tasks 5 e 6 preenchem.
- [ ] **Step 4: Montar no servidor.**
  - É o `mux.Handle("/r/", pagina.Novo(...))` no `montar`.
  - O `Video` lê o `d.Gerente.Video()` a cada pedido, com o gerente `nil` dando `""`.
  - O `OrigemCanal` vem do `Base` (`https` vira `wss`, e `http` vira `ws`).
- [ ] **Step 5: Rodar.** Os testes dos dois pacotes, o `go vet` e o `gofmt -l` (vazio) passam.
- [ ] **Step 6: Commit e push.** O `chat` fica verde.

### Task 3: O limite do abrir que dá certo

**Files:**
- Modify: `chat-servidor/internal/api/pagina.go` (o abrir) e os testes dele, `docs/chat-protocolo.md` (seções 10 e 12)

**Interfaces:**
- Consumes: o mecanismo de janelas de hoje do `api` (o `Cabe` e o `Contar` das tentativas).
- Produces: a janela `abrirBom`, 60 por minuto por endereço.

- [ ] **Step 1: Os testes.**
  - `TestAbrirPagina_SessentaBonsPassam`: 60 abrir de um código bom, do mesmo endereço, dão `200`. O 61º dá `429` com `{"erro":"tentativas","esperarSegundos":N}`, com `N` de 1 a 60.
  - `TestAbrirPagina_OsBonsNaoGastamAsFalhas`: depois de 60 abrir bons, o mesmo endereço ainda tem as 20 falhas. Um código ruim dá `404`, e não `429`, até a 20ª falha.
  - `TestAbrirPagina_AsFalhasNaoGastamOsBons`: depois de 19 falhas, um código bom ainda dá `200`.
  - `TestAbrirPagina_OutroEndereco`: o 61º de outro endereço dá `200`.
- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/api/ -run 'TestAbrirPagina'`. Esperado: FAIL no 61º.
- [ ] **Step 3: A janela.**
  - Antes de ler o banco, o abrir confere as duas janelas: a das falhas, como hoje, e a `abrirBom`.
  - Ele conta na `abrirBom` só quando dá `200`.
  - Os valores são uma constante perto das outras: `maxAbrirBom = 60` por `periodoTentativas`.
- [ ] **Step 4: O protocolo.**
  - Na seção 10, o `429 tentativas` do abrir ganha: "ou já são 60 aberturas que deram certo no último minuto deste endereço".
  - Na seção 12, a linha "Tentativas de abrir" ganha a janela do abrir bom.
- [ ] **Step 5: Rodar.** Os testes do `api` passam com o `-race`, e o `go vet` também.
- [ ] **Step 6: Commit e push.**

### Task 4: A sala que acabou não volta

**Files:**
- Modify: `chat-servidor/internal/reunioes/eventos.go` (o `entrou` e o `estado`), os testes do pacote

**Interfaces:**
- Consumes:
  - a memória do fim do gerente (as salas acabadas, por 10 minutos, da 1a);
  - o `Video.Encerrar(ctx, sala)`;
  - o padrão do B1 da 1a: chamar o vídeo fora do mutex, pela goroutine dos eventos.
- Produces: nada de interface nova.

- [ ] **Step 1: Os testes,** com o vídeo falso do pacote:
  - `TestGerente_EntrouNumaSalaQueAcabou`: depois do `Encerrar` de uma naHora, chega um `entrou` dessa sala. O gerente não tem a sala, não sai nenhum `reuniaoParticipantes`, e o vídeo falso recebe um `Encerrar` dela em até 1 s.
  - `TestGerente_EstadoComSalaQueAcabou`: o mesmo, com um `estado` que mostra a sala.
  - `TestGerente_EncerraUmaVezSo`: dois `entrou` seguidos da mesma sala dão um `Encerrar` só.
  - `TestGerente_SalaNovaNaoEncerra`: o `entrou` de uma sala que o gerente não conhece e não lembra segue o caminho de hoje.
- [ ] **Step 2: Rodar e ver falhar.** `go test -race ./internal/reunioes/ -run 'TestGerente_(EntrouNumaSalaQueAcabou|EstadoComSalaQueAcabou|EncerraUmaVezSo|SalaNovaNaoEncerra)'`.
- [ ] **Step 3: A regra.**
  - Uma sala na memória do fim não é recriada.
  - O pedido de `Encerrar` sai depois do mutex, com um contexto próprio de 10 s, e uma vez por entrada da memória (uma marca na própria entrada).
  - A linha de registro não tem sala, código nem participante.
- [ ] **Step 4: Rodar** o pacote inteiro com o `-race`, mais o `go vet`.
- [ ] **Step 5: Commit e push.**

### Task 5: O cérebro da página

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/estado.js`, `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces, em `estado.js` (módulo ES, sem DOM e sem rede):
  - `inicial()`: o estado com a `tela` `carregando`.
  - `transicao(estado, evento)`: devolve `{estado, efeitos}`. Ela nunca muda o `estado` recebido.
  - `nomeValido(nome)`: devolve `boolean`. O nome, sem os espaços das pontas, tem de 1 a 80 pontos de código, sem caracteres de controle (C0, DEL e C1).
  - `quando(inicioMs, agoraMs)`: "Hoje, 14:00", "Amanhã, 09:30" ou "18/11, 14:00", na hora local.
  - `cabecalho(reuniao, agoraMs)`: devolve `{sobretitulo, titulo}`, como na seção "Os textos".
- **O estado:**
  - `tela`: `carregando`, `entrada`, `pedindo`, `aguardando`, `naoComecou`, `entrando`, `reuniao` ou `aviso`;
  - `aviso`: um dos 10 da tabela, ou `null`;
  - `esperarSegundos`;
  - `reuniao` (o do abrir);
  - `nome` e `nomeRecusado`;
  - `mic` e `cam`: `ligado`, `desligado` ou `indisponivel`;
  - `canal`: `fechado`, `abrindo` ou `aberto`;
  - `aceito`;
  - `acesso` (o `turn` e o `video` do aceito);
  - `tela`: `nenhuma`, `pedindo`, `ligando` ou `noAr`;
  - `reconectando` (as tentativas, de 0 a 3);
  - `senhaRepetida`;
  - `reabrindo` (as tentativas depois de um 1011, de 0 a 3).
- **Os eventos** (o `tipo`):
  - `abriu {reuniao, bilhete}`;
  - `abrirFalhou {status, esperarSegundos}`: o `status` é `0` quando a rede falhou;
  - `canalAbriu`;
  - `canalFechou {codigo}`;
  - `mensagem {m}`;
  - `clique {botao}`: `pedir`, `desistir`, `tentarDeNovo`, `tentarMidia`, `sair`, `entrarDeNovo`, `microfone`, `camera` ou `pararDeCompartilhar`;
  - `nome {valor}`;
  - `midia {mic, cam}`;
  - `ligacao {qual, o, codigo}`:
    - o `qual` é `principal` ou `tela`;
    - o `o` é `confirmada`, `falhou`, `terminou` ou `semConexao`;
  - `telaCapturada {ok}`;
  - `cameraTrocada {ok}`;
  - `tempo {chave}`: um prazo que o efeito `esperar` marcou.
- **Os efeitos** (o `tipo`):
  - `abrir`, `abrirCanal {bilhete}`, `mandar {m}` e `fecharCanal`;
  - `pedirMidia` e `pararMidia`;
  - `ligar {qual, senha}` e `desligar {qual}`;
  - `trocarCamera {ligada}` e `trocarMicrofone {ligado}`;
  - `pararCaptura`;
  - `esperar {ms, chave}`;
  - `focar`: a tela mudou.

- [ ] **Step 1: Os testes,** em `estado.test.mjs` (`node:test` e `node:assert/strict`). Cada um parte do estado de que precisa e confere o estado e os efeitos:
  - `o carregar abre`: `inicial()` mais o evento de começo dá o efeito `abrir`.
  - `o abriu vai à entrada e pede a mídia`: dá a `tela` `entrada` e os efeitos `pedirMidia` e `focar`.
  - `o 404 do abrir é o linkInvalido`.
  - `o 429 conta e libera`:
    - o `abrirFalhou {status:429, esperarSegundos:3}` dá o `aviso` `tentativas` e um `esperar` de 1000 ms;
    - cada `tempo` diminui o `esperarSegundos`;
    - no 0, o `tentarDeNovo` dá o `abrir`.
  - `a rede que falha no abrir é o semServidor`.
  - `pedir abre de novo, abre o canal e manda o nome`:
    - o `clique pedir` dá o `abrir`;
    - o `abriu` dá o `abrirCanal`;
    - o `canalAbriu` dá `mandar {tipo:'pedir', nome:'Maria Lima'}`, com o nome sem os espaços das pontas.
  - `pedir sem nome válido não faz nada`.
  - `naoComecou e aguardando vão e voltam`.
  - `o aceito liga a principal`: dá a `tela` `entrando`, o `acesso` guardado e `ligar {qual:'principal', senha}`.
  - `a principal confirmada é a reunião`.
  - `o 403 da principal pede outra senha uma vez`:
    - o primeiro `falhou` com `codigo:403` dá `mandar {tipo:'senha'}`;
    - o `senha` que chega dá outro `ligar`;
    - o segundo 403 dá o `aviso` `semServidor`.
  - `cada mensagem final é o seu aviso`:
    - o `recusado` dá o `naoFoiPossivel`;
    - o `linkInvalido` dá o `linkInvalido`;
    - o `tirado` e o `encerrada` dão o `desligar` das duas ligações e o aviso deles.
  - `cheia, esperaCheia, servidorCheio e semServidor deixam tentar de novo`:
    - o `tentarDeNovo`, com o canal aberto e antes do aceito, manda outro `pedir`;
    - depois do aceito, ele manda `senha`;
    - com o canal fechado, ele dá o `abrir`.
  - `desistir manda e volta à entrada`: dá `mandar {tipo:'desistir'}`, `fecharCanal` e a `tela` `entrada`, com o nome e a mídia de antes.
  - `o nome recusado volta à entrada`: o `mensagem {tipo:'erro', erro:'invalido'}` no `pedindo` dá a `entrada` com o `nomeRecusado` verdadeiro.
  - `sair desliga e para a mídia`: dá o `desligar` das duas, o `pararMidia` e o `aviso` `saiu`, com o canal aberto.
  - `entrar de novo com o canal aberto pede senha e mídia`:
    - dá `pedirMidia` e `mandar {tipo:'senha'}`;
    - o `ligar` só sai depois de chegarem os dois, o `midia` e o `senha`, em qualquer ordem.
  - `entrar de novo com o canal fechado passa pela espera`: dá o `abrir`, e o `pedir` vem depois.
  - `a conexão que cai entra de novo até 3 vezes`:
    - o `ligacao {qual:'principal', o:'semConexao'}` na reunião dá o `reconectando` 1, o `desligar` das duas e um `esperar` de 2000 ms;
    - o `tempo` dá `mandar {tipo:'senha'}`;
    - as falhas seguintes esperam 4000 e 8000 ms;
    - a terceira falha dá o `aviso` `saiu`;
    - um `confirmada` no meio zera o `reconectando`.
  - `a ligação que termina sem aviso vira saiu`:
    - o `terminou` da principal na reunião dá um `esperar` de 2000 ms;
    - sem `tirado` nem `encerrada` antes, o `tempo` dá o `aviso` `saiu`;
    - com o `encerrada` antes, fica o `encerrada`.
  - `o 1011 antes do aceito abre de novo`: o `canalFechou {codigo:1011}` no `aguardando` dá um `esperar` de 3000 ms, e o `tempo` dá o `abrir`. Na quarta vez, dá o `aviso` `semServidor`.
  - `o canal que cai na reunião não tira ninguém`:
    - o `canalFechou {codigo:1006}` na reunião deixa a `tela` `reuniao`, com o `canal` `fechado`;
    - um `semConexao` depois dá o `aviso` `saiu`, sem `senha`.
  - `a tela do começo ao fim`:
    - o `telaCapturada {ok:true}` na reunião, com o canal aberto, dá `mandar {tipo:'tela'}` e a `tela` `pedindo`;
    - o `mensagem {tipo:'tela', senha}` dá `ligar {qual:'tela', senha}`;
    - o `confirmada` dá o `noAr`;
    - o `clique pararDeCompartilhar` dá `desligar {qual:'tela'}`;
    - o `terminou` da tela dá a `nenhuma` e o `pararCaptura`;
    - o `telaCapturada {ok:false}` não faz nada;
    - com o canal fechado, o `telaCapturada {ok:true}` dá só o `pararCaptura`.
  - `a câmera e o microfone`:
    - na entrada, o clique só troca o estado;
    - na reunião, ele dá o `trocarCamera` ou o `trocarMicrofone`;
    - um `cameraTrocada {ok:false}` volta a câmera ao que era;
    - um `indisponivel` não troca.
  - `nomeValido`:
    - `'  Maria  '` vale;
    - `''`, `'   '`, `'a\tb'`, `'a\u0085b'` e 81 letras não valem;
    - 80 emojis valem: são 80 pontos de código.
  - `quando`: com `agora` em 17/11/2026, 10:00 local:
    - 17/11 14:00 é "Hoje, 14:00";
    - 18/11 09:30 é "Amanhã, 09:30";
    - 20/11 08:05 é "20/11, 08:05";
    - 16/11 14:00 é "16/11, 14:00".
  - `cabecalho`, para os três tipos, com e sem assunto.
- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && node --test testes/estado.test.mjs`. Esperado: FAIL, porque o módulo não existe.
- [ ] **Step 3: O `estado.js`.**
  - É uma função `transicao` com um `switch` no `tipo` do evento, e ajudantes pequenos.
  - Os prazos (1000, 2000, 4000, 8000 e 3000 ms) e os limites (3 e 3) ficam em constantes exportadas.
- [ ] **Step 4: Rodar.** O `node --test testes/` passa.
- [ ] **Step 5: Commit e push.**

### Task 6: As telas da página

**Files:**
- Create: `chat-servidor/internal/pagina/estatico/pagina.js`, `rede.js`, `midia.js`, `ligacao.js`, e os testes `chat-servidor/pagina/chat.ts`, `rede-falsa.ts`, `playwright.config.ts`, `tsconfig.json`, `testes/telas.spec.ts`
- Modify: `chat-servidor/internal/pagina/pagina.html`, `estatico/inicio.js`, `estatico/pagina.css`, `chat-servidor/pagina/package.json`, `.github/workflows/chat.yml`

**Interfaces:**
- Consumes:
  - o `estado.js` (Task 5);
  - a rota (Task 2);
  - o protocolo da seção 10 (o abrir e o canal).
- Produces:
  - `iniciar(raiz, servicos)` em `pagina.js`, com os serviços `{rede, midia, ligacao, relogio}`;
  - `inicio.js` liga os de verdade;
  - `ligacao.js` exporta `criarLigacoes(aoEvento)`, com os métodos `{ligar({qual, senha, acesso, fluxo}), desligar(qual), trocarCamera(ligada), trocarMicrofone(ligado)}`. Nesta tarefa, o `ligar` responde `aoEvento({tipo:'ligacao', qual, o:'falhou', codigo:0})`; a Task 7 liga o JsSIP;
  - na reunião, os elementos `<video id="mosaico" autoplay playsinline muted>` e `<audio id="som" autoplay>`. O e2e usa esses ids.

- [ ] **Step 1: O ambiente dos testes.**
  - O `chat.ts` compila o chat (`go build ./cmd/starsonic-chat`) e o sobe no modo de teste, numa pasta temporária, como o `video-servidor/e2e/servidores.ts` faz.
  - O `rede-falsa.ts` responde ao abrir pelo `page.route` e ao canal pelo `page.routeWebSocket`, com as mensagens que cada teste manda.
  - O Chromium sobe com a câmera e o microfone falsos e as permissões dadas.
  - Para os erros de mídia, um `addInitScript` troca o `getUserMedia`.
- [ ] **Step 2: Os testes,** em `telas.spec.ts`, com o relógio fixo (`page.clock.install` antes de abrir a página, por causa da 1.56.1; veja o `docs/build-notes.md`):
  - `a entrada mostra o cabeçalho da marcada`: aparecem "Reunião marcada · Hoje, 14:00" e "Planejamento de dezembro".
  - `o Pedir para entrar só liga com um nome`:
    - sem nome, o botão fica desligado e aparece "Digite o seu nome para pedir.";
    - com "Maria Lima", ele liga;
    - o campo tem `maxlength="80"`.
  - `o Microfone e a Câmera trocam`:
    - o `aria-pressed` troca;
    - com a câmera desligada, a imagem diz "A câmera está desligada".
  - `sem acesso a nada`: com o `NotAllowedError`, aparecem:
    - o aviso e o texto da seção "Os textos";
    - os dois botões desligados;
    - "Sem a permissão, os dois ficam desligados.";
    - o "Pedir para entrar", que continua ligado com um nome.
  - `só sem câmera`: com o `NotFoundError` só no vídeo, aparecem o aviso, o Microfone ligado, a Câmera desligada e "Entrando assim, você vê e ouve a reunião, e o seu quadro mostra só o seu nome.".
  - `a câmera ocupada`: com o `NotReadableError`, o mesmo aviso. O "Tentar de novo" pede a mídia outra vez.
  - `o primeiro play nasce no clique` (Review Focus 1): o `play` do `#som` é chamado dentro do clique do "Pedir para entrar", antes do primeiro pedido de rede depois dele.
  - `a espera`:
    - o `aguardando` mostra "Aguardando ser aceito…";
    - o `naoComecou` mostra "A reunião ainda não começou" e "Você vai entrar como Maria Lima";
    - o "Desistir" manda `{"tipo":"desistir"}` e volta à entrada.
  - `cada aviso`: para cada mensagem final e para o 404 e o 429 do abrir, o título e o texto da tabela, e o botão quando ele existe.
    - O "Tentar de novo" da `cheia` manda outro `pedir` no mesmo canal.
    - O do 429 conta "Tentar de novo em 3 s", "2 s" e "1 s" com o relógio fixo, e depois liga.
  - `o nome recusado`: o `{"tipo":"erro","erro":"invalido"}` volta à entrada com "Confira o seu nome.".
  - `o 1011 abre de novo sozinho`: 3 s depois do fechamento com 1011, sai um novo abrir.
  - `o aceito leva a Entrando`: o `aceito` mostra "Entrando na reunião…". Com o `ligacao.js` desta tarefa, depois mostra o aviso `semServidor`.
  - `no celular`: com 390×844, `isMobile` e `hasTouch`, a entrada é de uma coluna, e o "Pedir para entrar" tem a largura toda.
  - `os cabeçalhos da página`: a resposta do `/r/<código>` traz o CSP da Task 2, e o console não tem nenhum erro de CSP do começo ao fim da entrada.
- [ ] **Step 3: Rodar e ver falhar.** `cd chat-servidor/pagina && npx playwright install --with-deps chromium && npx playwright test`. Esperado: FAIL.
- [ ] **Step 4: As telas.**
  - O `pagina.html` tem todas as telas como seções com `hidden`. O texto delas é a seção "Os textos", literal, no HTML.
  - O `pagina.css` segue a seção "O visual" e os arquivos do quadro (`Entrada`, `SemCamera`, `Aguardando`, `NaoComecou`, `Avisos`, `Reuniao`, `ReuniaoTela` e os três `Celular*`).
  - Ruling: a espera do celular tem os botões Microfone e Câmera, como a do PC. Assim, quem espera também pode trocar. A linha de resumo do quadro do celular sai.
- [ ] **Step 5: A camada da tela,** no `pagina.js`:
  - `desenhar(estado)` mostra uma tela só e preenche o cabeçalho e os avisos;
  - os botões viram eventos;
  - os efeitos `abrir`, `abrirCanal`, `mandar`, `fecharCanal` e `esperar` vão para o `rede.js` e o relógio;
  - os efeitos de mídia vão para o `midia.js`:
    - ele pede o `getUserMedia` dos dois;
    - se falhar, pede cada um sozinho;
    - ele dá o `midia {mic, cam}`, e mostra a imagem no `<video>` da entrada, mudo;
  - o `focar` põe o foco no título da tela nova;
  - o clique do "Pedir para entrar" chama o `play()` do `#som` antes de tudo.
- [ ] **Step 6: Rodar.** O Playwright e o `node --test` passam.
- [ ] **Step 7: O CI.** O job `pagina` ganha o Go (o `setup-go`, com o `go.mod` do chat), o `npx playwright install --with-deps chromium`, o `npx playwright test`, e o relatório do Playwright como artefato numa falha.
- [ ] **Step 8: Commit e push.** O `chat` fica verde.

### Task 7: As ligações da página

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/ligacao.js`, `midia.js`, `pagina.js`; `video-servidor/e2e/servidores.ts`, `video-servidor/e2e/navegador.ts`
- Create: `video-servidor/e2e/pagina.spec.ts`

**Interfaces:**
- Consumes:
  - o `window.JsSIP` (Task 1);
  - o Acesso do `aceito` (`video.wss`, `video.uri` e `turn`);
  - a seção 6 do `docs/video-agente.md`.
- Produces: o `criarLigacoes` de verdade, com a mesma interface da Task 6.

- [ ] **Step 1: Os testes de ponta a ponta,** em `pagina.spec.ts`, com a página de verdade em `http://127.0.0.1:<porta do chat>/r/<código>`:
  - O `servidores.ts` põe a origem do chat entre as origens do `/sip` do agente (o `--origem`).
  - O mosaico e o som são lidos do `#mosaico` e do `#som` pelo `page.evaluate`, com os ajudantes do `midia.ts`, sem nada novo na página.
  - Os testes:
    - `a reunião de teste pela página`: duas páginas, com cores de câmera diferentes, entram com nomes. O mosaico tem as duas cores, e cada uma ouve a outra.
    - `a pessoa de fora entra pela página`:
      - a colega entra pelo cliente mínimo, pelo `entrar` do app;
      - Maria pede pela página e vê "Aguardando ser aceito…";
      - a colega aceita, e a cor de Maria aparece no mosaico.
    - `a câmera desligada por 70 segundos`:
      - Maria desliga a câmera;
      - em até 10 s, o quadro dela tem a cor `#1B2333` (com a tolerância do `midia.ts`);
      - 70 s depois, ela continua na reunião (o canal não recebeu nada e a ligação não terminou);
      - ela liga a câmera, e a cor dela volta.
    - `sair e entrar de novo`: Maria sai e vê "Você saiu da reunião". O "Entrar de novo" volta ao mosaico sem passar pela espera: nenhum `reuniaoPedido` chega à colega.
    - `a conexão do vídeo cai`:
      - o `page.routeWebSocket` do WSS do vídeo fecha a conexão;
      - a página mostra "A conexão caiu. Entrando de novo…" e volta ao mosaico;
      - a sala tem uma ligação principal só de Maria (o `estado` do agente).
    - `o celular na reunião`: com 390×844, os controles são Microfone, Câmera e Sair, sem "Compartilhar a tela".
- [ ] **Step 2: Rodar e ver falhar.** `cd video-servidor/e2e && npx playwright test pagina.spec.ts` (com o FreeSWITCH do `/opt/starsonic-freeswitch`, como o e2e roda hoje). Esperado: FAIL, porque o `ligacao.js` da Task 6 não liga.
- [ ] **Step 3: O `ligacao.js`.** Segue o cliente mínimo do e2e:
  - um UA do JsSIP por ligação, sem registro;
  - o `uri` `sip:pagina@<host do video.uri>` e o `display_name` `pagina`;
  - o cabeçalho `X-Starsonic-Senha`;
  - o `pcConfig.iceServers` com o `turn` do Acesso (`urls`, `username` = `usuario`, `credential` = `senha`).
  - A principal manda e recebe. O vídeo recebido vai para o `#mosaico`, e o som para o `#som`.
  - O `semConexao` é o `disconnected` do UA com a ligação confirmada.
  - O `desligar` é o `terminate()` da sessão, que manda o BYE, e depois o `stop()` do UA.
  - O `trocarCamera` e o `trocarMicrofone` seguem os itens 5 e 6 de "O desenho".
- [ ] **Step 4: O `midia.js` ganha o silêncio:** o oscilador, o ganho zero e o destino. Ele é a faixa de som de quem está sem microfone.
- [ ] **Step 5: Rodar.** O `pagina.spec.ts` e o e2e inteiro passam aqui, e os testes da página (Task 6) também.
  - O `o aceito leva a Entrando` passa a fechar o WSS falso na hora, pelo `page.routeWebSocket`.
  - Assim, o aviso `semServidor` aparece sem esperar os 10 s do JsSIP.
- [ ] **Step 6: Commit e push.** O `video` (com o "De ponta a ponta") e o `chat` ficam verdes.

### Task 8: A tela compartilhada pela página

**Files:**
- Modify: `chat-servidor/internal/pagina/pagina.html`, `estatico/pagina.js`, `estatico/midia.js`, `estatico/ligacao.js`; `video-servidor/e2e/pagina.spec.ts`, `video-servidor/e2e/reuniao.spec.ts`

**Interfaces:**
- Consumes: o `tela` do canal, a seção 6 do contrato (a segunda ligação, só para mandar, com o silêncio gerado) e o `estado.js`.
- Produces: nada novo.

- [ ] **Step 1: Os testes.**
  - Em `pagina.spec.ts`:
    - `compartilhar a tela pela página`:
      - um `addInitScript` troca o `getDisplayMedia` por um canvas verde a 15 quadros por segundo;
      - Maria clica em "Compartilhar a tela" e vê "Você está compartilhando a tela";
      - o quadro grande fica verde (o ponto da apresentação, como no `reuniao.spec.ts`);
      - o "Parar de compartilhar" volta à grade.
    - `a tela que o navegador para`: o `stop()` da faixa do canvas faz o mesmo que o "Parar de compartilhar".
    - `sem captura de tela, sem o botão`: com o `getDisplayMedia` apagado, o botão não aparece.
  - Em `reuniao.spec.ts`, junto de "a colega tira uma pessoa": `a tela de quem foi tirado não entra` (o I1 da 1a, de ponta a ponta):
    - pelo cliente mínimo, Maria pega uma senha de tela;
    - a colega tira Maria;
    - a ligação de tela com essa senha cai, e o quadro grande nunca é dela.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: A tela na página.**
  - O clique em "Compartilhar a tela" chama o `midia.capturarTela()`, que é o `getDisplayMedia({video: true, audio: false})`, dentro do próprio clique. Depois, ele dá o `telaCapturada`.
  - A ligação da tela leva o vídeo da captura e o silêncio gerado, só para mandar (`offerToReceiveAudio` e `offerToReceiveVideo` falsos).
  - O `ended` da faixa da captura dá o `clique pararDeCompartilhar`.
  - O botão só existe com `navigator.mediaDevices.getDisplayMedia`.
- [ ] **Step 4: Rodar** o e2e inteiro e os testes da página.
- [ ] **Step 5: Commit e push.**

### Task 9: Os textos do cartão e os guias

**Files:**
- Modify: `chat-servidor/internal/admin/paginas/reunioes.html` e o teste dele, `docs/video-servidor.md`, `docs/chat-servidor.md`, `docs/teste-manual.md`, `docs/chat-protocolo.md`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 8.
- Produces: nada.

- [ ] **Step 1: O cartão.**
  - A frase do 65baa27 ("o link abre no navegador só a partir da próxima versão do chat") sai.
  - O cartão da reunião de teste volta a pedir que o link seja aberto em dois aparelhos, o PC e o celular, com as palavras de antes do 65baa27.
  - O teste do cartão acompanha.
- [ ] **Step 2: O guia do vídeo.** As conferências ganham a reunião de teste pelo navegador:
  - abrir o link no PC e no celular;
  - o que aparece em cada tela;
  - o que fazer quando a imagem não chega (o TURN, a porta do vídeo).
- [ ] **Step 3: O guia do chat.** A seção das reuniões diz que o link abre a página, e o que a pessoa de fora vê.
- [ ] **Step 4: O roteiro manual,** a seção 25 do `docs/teste-manual.md` (a 23 e a 24 estão na branch `video-etapa-3`): "Reuniões com link, etapa 1". As linhas:
  - a reunião de teste no PC (Chrome e Edge) e no celular (Chrome no Android e Safari no iPhone);
  - o som sem tocar em mais nada depois do "Pedir para entrar";
  - a câmera e o microfone desligados e ligados, e a câmera negada no navegador;
  - a tela compartilhada do PC;
  - Sair e Entrar de novo;
  - o celular que troca do Wi-Fi para o 4G no meio da reunião;
  - a aba fechada, que sai em até 75 segundos;
  - dez pessoas, com o uso do servidor no cartão "Reuniões";
  - uma rede que só deixa sair pela 443, para anotar o que acontece.
- [ ] **Step 5: O protocolo,** na seção 10. Uma nota diz que a página abre duas vezes (ao carregar e ao pedir) e entra de novo pelo `senha` depois de uma queda.
- [ ] **Step 6: Commit e push.**

---

## Depois das tarefas

- **A revisão final da branch** olha:
  - a página contra a spec (4.1, 9, 10 e 11.1) e contra o quadro;
  - o CSP e os cabeçalhos;
  - os registros (a rota `/r/` não registra o código);
  - a seção 10 do protocolo, nos dois lados.
- **O responsável** publica o chat (o `chat-release`, a branch `reunioes-etapa-1`) e roda a seção 25 do roteiro nas VMs.
