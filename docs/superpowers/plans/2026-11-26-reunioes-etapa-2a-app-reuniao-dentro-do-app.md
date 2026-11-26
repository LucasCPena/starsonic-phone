# As reuniões no app do PC, etapa 2a — entrega 2, plano 3b: a reunião dentro da janela do app — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o colega entra numa reunião pelo app (o "Entrar" da lista, o campo do link, o "Abrir no app" da página e um link numa conversa do chat), a reunião aparece dentro da janela grande, e ela convive com o telefone: o "Telefone", as ligações da central, o fechar, a queda, a troca de conta e o bloqueio do Windows. No fim, o app chega à versão `0.5.0`, com o roteiro de testes e as notas.

**Architecture:**
- **A interface** ganha, em `windows/ui/src/reunioes/`, o controlador da reunião dentro do app (`vista.ts`: a conversa com a página, pela seção 10 do protocolo) e as telas dela (a vista com a barra do app, as faixas das telas 13 e 14, o cartão da ligação da tela 12, a ligação em espera e o "Sair da reunião?"). **O `iframe` da reunião é montado uma vez só, fora da raiz de cada tela:** ele continua vivo atrás do "Telefone" e da tela de uma ligação, e só sai quando a reunião acaba para a pessoa.
- **O núcleo em C++ continua sem conhecer reunião.** Ele ganha o link `starsonic://reuniao/<código>` (a mensagem `abrir` com a tela `reuniao`), o comando `reuniaoLink` (um link do chat da reunião, no navegador padrão) e a mensagem `sessao` (o Windows bloqueado, para o `bloqueio` da página).
- **O executável** registra o `starsonic:` pelo instalador, passa o link à instância que já roda, leva o bloqueio da sessão ao núcleo, e fecha os pontos que a prova no WebView2 deixou (o microfone, as mensagens de um quadro e o quadro mexendo na janela), com a fumaça do Windows usando a vista de verdade.
- **O servidor do chat e a página da reunião não mudam.** A página já fala com o app (a entrega 1 e o plano 2); este plano constrói o lado do app.

**Tech Stack:** o que o app já usa: TypeScript e Preact (`windows/ui`), com o `@playwright/test` 1.56.1; C++17 portátil (o núcleo e as regras do executável), com os testes de `tests/desktop` e `tests/win`; o Win32 e o WebView2 do executável, que só compilam no GitHub; o NSIS do instalador; o Python da fumaça do Windows (`tests/smoke`). Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`: as seções 4.3, 4.4 e 4.5 (entrar, o colega na reunião, o app durante a reunião), 7.4 a 7.8 (a página dentro do app, a conversa, a interface, o núcleo e o executável, o som e as ligações), 8, 9, 10, 11, 12 e 15, com as notas datadas. O protocolo é o `docs/chat-protocolo.md`, seção 10 (a página dentro do app). A ponte é o `docs/ponte-windows.md`. A lista de onde este plano saiu são as seções 2, 7, 9 e 10.3 do `reunioes-etapa-2-entrega-2-entradas.md` (no Project), e o que a revisão geral do plano 3a mandou para cá (`reunioes-etapa-2-plano-3a-entrega.md`, no Project).

**O plano 3a está construído** (a branch `reunioes-etapa-2`, de `7715b29` a `e2ef14a`): a aba Reuniões, o "Abrir no navegador", o aviso do canto com um pedido e a pausa da reunião aberta no navegador. Este plano usa o que ele produziu (o `ReunioesCliente`, o `pausa.ts`, os textos, os ajudantes dos testes) e não o refaz.

**Aprovado pelo responsável em 26/11/2026, às 08:52 ("segue"):** o plano, as escolhas da seção "As escolhas deste plano" e o método, o mesmo dos outros planos desta etapa: um agente novo constrói cada tarefa, e outro a revisa antes da próxima; no fim, uma revisão de tudo (superpowers:subagent-driven-development).

**Respondido pelo responsável em 26/11/2026, às 08:35 ("pode sim"), antes do plano escrito:** as duas propostas que aparecem na tela (as escolhas 1 e 2 abaixo): o WebView2 mínimo `131`, com o navegador e o aviso abaixo dele, e o "Abrir no navegador" em "A reunião não abriu.".

## O que este plano não faz

- **Não publica nada.** Quem publica a versão é o responsável, pelo GitHub (o workflow `release`). O plano deixa a `0.5.0` pronta para ele.
- **Os itens 1 a 12 da fumaça do Windows** continuam rodando só no WebView2 da máquina do GitHub; só a reunião (o item 13) roda de novo no WebView2 atualizado, como hoje.
- **Não mexe no servidor do chat nem na página.** Se um teste deste plano mostrar um defeito do lado deles, a tarefa para e o achado vai ao controlador.
- **As trocas de aparelho no meio de uma queda** (uma troca durante a volta de uma queda, com outra troca pendente, ou um aparelho "indisponível" que não volta) são da página: a troca no caminho de sempre já está provada de ponta a ponta (o teste "a troca do microfone e da câmera no meio da reunião" do `video-servidor/e2e/colega.spec.ts`), e esses casos ficam como estão, na lista para o responsável.

## Global Constraints

- **Os textos** são os aprovados, letra por letra: os das telas 6, 7 e 12 a 14 do quadro "Starsonic Phone — reuniões" (`work/quadro-reunioes/*.dc.html`, fora do git) e os da seção 11 da spec. Todos ficam em `windows/ui/src/reunioes/textos.ts`. Os desta metade:

| Onde | Texto |
|---|---|
| A barra da reunião (telas 6 e 7) | `Telefone` · `Tela cheia` · `Sair da tela cheia` · o estado `Ocupado · em reunião` (só com a pessoa na reunião) |
| A página que não abriu | `A reunião não abriu.` · `Tentar de novo` · `Fechar` · `Abrir no navegador` |
| O WebView2 antigo (aviso curto) | `Este Windows não abre a reunião dentro do app. Ela abriu no navegador.` |
| Os erros do "Entrar" | `Desligue a ligação para entrar na reunião.` · `Saia da reunião de agora para entrar em outra.` · `Este computador não está ligado ao chat da empresa. Entre pelo navegador.` |
| O cartão da ligação (tela 12) | `Ligação de <Nome>` · `<Ramal ou número> · tocando` · `Atender tira você da reunião enquanto a ligação durar.` |
| A faixa da ligação (tela 13) | `Você está fora da reunião` · o assunto (ou `Reunião sem assunto`) · `Voltar para a reunião` · o estado `Ocupado · em ligação` |
| A faixa do "Telefone" (tela 14) | `Você está na reunião` · `O microfone está ligado` ou `O microfone está desligado` · `Voltar para a reunião` |
| A ligação em espera | `<Nome> em espera` · `Voltar à ligação` · `Desligar` |
| O fechar | `Sair da reunião?` · `Fechar a janela tira você da reunião.` · `Continuar na reunião` · `Sair da reunião` |
| Depois do fim, na aba | `Você foi tirado da reunião` · `A reunião acabou` · `Este link não vale mais` |
| Os avisos curtos | `A conexão com a reunião caiu. Entre de novo pela aba Reuniões.` · `Você saiu da reunião porque a conta mudou.` · `Você saiu da reunião porque o computador saiu do chat.` (a escolha 14) |
| O iframe, para o leitor de tela | `Reunião` |

- **A conversa com a página** é a da seção 10 do protocolo e da 7.5 da spec: mensagens `postMessage`, sempre um objeto com `"starsonic": 1` e o `tipo`. **O app só aceita a mensagem que vem do `contentWindow` do `iframe` dele e da origem do chat** (o `enderecoDoChat()`); um `tipo` desconhecido é ignorado. A página manda `pronta`, `estado` (`fase`: `entrada`, `naReuniao` ou `fora`; `microfone`), `fim` (`motivo`: `saiu`, `tirado`, `acabou` ou `linkInvalido`) e `link` (`url`). O app manda `passe` (`passe`, `aparelhos`), `aparelhos`, `pausar`, `retomar`, `bloqueio` (`ligado`) e `sair`, sempre com o `targetOrigin` da origem do chat.
- **Os `aparelhos`** são `{"microfone": <audio.microfone>, "altoFalante": <audio.altoFalante>, "camera": <video.camera>}`, os nomes das Configurações do app (`""` é o padrão do sistema), e vão em todo `passe` e a cada troca deles.
- **O app responde a todo `pronta` com um passe novo,** pedido na hora pela rota do passe (também no meio da reunião, quando o chat reiniciou). Os valores: sem `pronta` em **15 s**, "A reunião não abriu."; sem `fim` **2 s** depois do `sair`, a vista fecha assim mesmo; o tamanho grande é o `videoWindow` `grande` de hoje (1280×800), e a tela cheia, o `telaCheia`.
- **O `iframe`** nasce com o `src` e o `allow` juntos (nunca vazio, com o endereço depois): o `src` é `<chat>/r/<código>`, sem nada mais (**o passe nunca vai no endereço**); o `allow` é `camera <chat>; microphone <chat>; display-capture <chat>; autoplay <chat>; speaker-selection <chat>`, com a origem do chat; o `title` é `Reunião`; o foco vai para ele quando a vista abre, e os botões da barra do app vêm antes dele na ordem do Tab.
- **A pausa da reunião dentro do app** é o `pausar` e o `retomar`. Ela dura enquanto existe uma ligação que **não** está em espera pelo "Voltar para a reunião": do começo de uma ligação feita, ou do atender de uma recebida, até a última ligação acabar; só tocando não pausa; a sala de vídeo de pé conta como uma ligação (a regra de hoje do `haPausa`). O app manda de novo o `pausar` (enquanto a pausa dura) e o `bloqueio` com o `ligado` verdadeiro (enquanto o Windows está bloqueado) a cada `estado` em que a `fase` **passa** a `naReuniao`.
- **Os nomes da ponte** (o núcleo, a interface e o `docs/ponte-windows.md` mudam juntos):
  - o link `starsonic://reuniao/<código>` (o esquema sem diferenciar maiúsculas; o código com 10 caracteres de `abcdefghjkmnpqrstvwxyz23456789`, depois de passar a minúsculas e tirar os espaços; mais nada depois dele) vira a mensagem `{"v":1,"type":"abrir","tela":"reuniao","codigo":"<código>"}`, só para a janela principal;
  - o comando `{"v":1,"cmd":"reuniaoLink","url":"<url>"}`: só `http` e `https`, até 2.048 caracteres, sem espaços nem caracteres de controle; abre no navegador padrão;
  - a mensagem `{"v":1,"type":"sessao","bloqueada":true|false}`: a sessão do Windows bloqueada ou desconectada, quando muda, e no `ready`.
- **O diagnóstico e o console** seguem a regra de hoje: sem códigos, passes, links, nomes, assuntos nem chaves. Do `reuniaoLink` vão só o esquema e o servidor (`reunioes: link aberto: https://exemplo.com`), como nas navegações bloqueadas. Nada da conversa com a página vai ao `console`.
- **A acessibilidade segue as regras de hoje:** nenhuma violação séria do axe, nos temas claro e escuro; tudo pelo teclado; as faixas e o cartão nos três tamanhos da janela (Normal, Compacto e Mínimo). A vista da reunião vive no tamanho grande e na tela cheia. Uma região que avisa (`role="status"` ou `alert`) fica montada e só troca o texto. Um botão ocupado com o foco não fica `disabled` (o foco cairia no fundo): ele fica `aria-disabled="true"` e ignora o clique.
- **O navegador daqui é o Chrome 153, e o do GitHub, o Chromium 141.** Um teste de tela tem de passar nos dois. Seis testes de foto do chat (`tests/chat/fotos.spec.ts:444`, "chat-anexos") falham só aqui.
- **As regras dos testes do plano 3a continuam:** no máximo duas falhas de verdade do passe por arquivo de teste (a janela de 20 por minuto do endereço é de toda a rodada); nunca andar o relógio de mentira (`runFor`, `fastForward`) logo depois de um pedido que o app ainda não tratou; o teste que dirige o `page.clock` chama o `pararORelogio(page)` antes do primeiro `runFor`; as specs de tela das reuniões usam o `test.use({ bypassCSP: true })`; o `test.afterEach` com `page.unrouteAll({ behavior: 'ignoreErrors' })` onde um `page.route` atrasa uma resposta.
- **O que só o Windows faz** (o WebView2 de verdade, o instalador, a linha de comando, o bloqueio da sessão) é provado pela fumaça e pelos testes de `tests/win`, no `build` do GitHub: a tarefa termina com o commit, e o controlador manda a branch e lê o resultado.
- **O repositório é público.** Nenhum nome de pessoa de verdade, nenhum endereço de verdade da rede do cliente, nenhuma senha; os nomes dos testes são os inventados de sempre.
- **As notas da versão** (`notas/v0.5.0-rc.1.txt`) só entram na Task 12. O número da versão vem do tag que o responsável publica (o `STARSONIC_VERSION` do build); nada no código muda por causa dele.

## Review Focus

1. **A reunião que cai porque a tela mudou.** O "Telefone", o cartão de uma ligação, a tela da ligação, a volta, a tela cheia e a troca de tamanho da janela não podem recriar o `iframe`: a pessoa sairia da reunião. As Tasks 3, 5 e 6 provam que é o mesmo `contentWindow` antes e depois de cada troca.
2. **A pausa que não chega à página de dentro do app.** Uma ligação atendida enquanto a página carrega, na entrada, ou no meio de uma volta da página, tem de deixar a reunião em pausa assim que a pessoa entra. A Task 6 prova o `pausar` repetido a cada `fase` que passa a `naReuniao`.
3. **Uma mensagem de outro lugar tomada como da página.** Um `fim`, um `link` ou um `pronta` mandado por outra janela, por outro `iframe` ou de outra origem não pode fechar a vista, abrir um endereço nem receber um passe. A Task 3 prova com um segundo `iframe` e com outra origem.
4. **O app num estado pela metade.** Depois de cada fim (o "Sair", o tirado, o encerrado, o link que deixou de valer, a queda, a troca de conta, o fechar), a barra não pode continuar dizendo "Ocupado · em reunião", o aviso do canto não pode continuar tratando a reunião como escondida, e a pausa não pode continuar mandando `pausar`. A Task 7 confere os três depois de cada caminho.
5. **O passe que vaza.** O passe não vai no `src` do `iframe`, não vai ao `console`, não fica numa mensagem a outra origem e não vai ao diagnóstico. A Task 3 confere o endereço do `iframe`, o `targetOrigin` de cada mensagem e o console.

## As escolhas deste plano

O que a spec deixa para quem constrói e este plano decide. O responsável as confere ao ler. **As dezesseis primeiras aparecem na tela.**

1. **O WebView2 mínimo para a reunião dentro do app é o `131`,** o mais antigo em que a prova passou. Abaixo dele, o "Entrar" abre a reunião no navegador, já reconhecendo a pessoa, e um aviso curto diz "Este Windows não abre a reunião dentro do app. Ela abriu no navegador." *(Aprovada pelo responsável em 26/11, às 08:35.)*
2. **"A reunião não abriu." ganha um terceiro botão, "Abrir no navegador",** além do "Tentar de novo" e do "Fechar": em algumas redes, o Windows pode barrar a página dentro do app, e o navegador é a saída. Ele faz o "Abrir no navegador" da reunião e fecha a vista. *(Aprovada pelo responsável em 26/11, às 08:35.)*
3. **O "Ocupado · em reunião"** aparece na barra só com a pessoa na reunião (a `fase` `naReuniao`), como no quadro: na entrada (tela 6), a barra mostra só o nome do app e a conta.
4. **A faixa da tela 13 mostra o assunto da reunião** (ou "Reunião sem assunto"), e a da tela 14, o microfone que a página disse no último `estado`.
5. **O cartão da ligação (tela 12) e o da ligação em espera** ficam no alto, no meio, por cima da página, como no quadro. Os dois botões do cartão da ligação têm os nomes "Recusar" e "Atender" para o leitor de tela (o quadro desenha só os ícones). Com duas ligações tocando, o cartão é o da de cima.
6. **Depois de uma ligação, a janela volta ao tamanho em que a reunião estava** (o grande ou a tela cheia).
7. **Numa reunião, a tela da ligação fica sem a câmera:** o botão "Câmera" aparece desligado (como na tela 13), e o "Atender com vídeo" não aparece. A sala de vídeo não se monta numa reunião: ela precisa da câmera, que está com a reunião.
8. **O que a pessoa vê depois do fim** (o tirado, a reunião que acabou, o link que deixou de valer) é um aviso curto do app, na aba Reuniões, com o texto da seção 11 da spec. O "Sair" volta à aba sem aviso.
9. **O "Atualizar agora" com uma reunião aberta** pergunta antes com o mesmo "Sair da reunião?" do fechar; no "Sair da reunião", a página sai e o app segue com a atualização.
10. **O link de reunião numa conversa do chat** é uma palavra que é exatamente o endereço deste chat, `/r/` e um código: uma pontuação colada no fim (`.`, `,`) faz a palavra não ser o link. O clique segue o "Entrar", com as mesmas regras.
11. **O `starsonic://` com o app escondido na bandeja ou minimizado** traz a janela para a frente e mostra a entrada da reunião, como o clique num aviso do chat.
12. **A entrada pelo `starsonic://` de uma reunião de outra empresa** diz "Esta reunião é de outra empresa…" e oferece o "Abrir no navegador", como o campo do link.
13. **O Windows bloqueado** desliga a câmera da reunião e a devolve ao desbloquear, sem texto: a página já mostra a câmera desligada.
14. **Com o chat desligado** (ou o computador tirado do chat) e a reunião aberta no app, a página sai da reunião e o aviso curto é "Você saiu da reunião porque o computador saiu do chat." *(texto novo: a seção 11 da spec só tem o da troca de conta.)*
15. **No tamanho Mínimo, o "Entrar" de uma linha** é o primeiro item do menu, antes do "Copiar link" (no Mínimo a linha só tem o botão do menu, como no plano 3a).
16. **A tela de uma ligação por cima da reunião** conta como a reunião escondida para o aviso do canto, como o "Telefone": a pessoa não vê o cartão do pedido dentro da página.
17. **O `iframe` escondido** (atrás do "Telefone" ou de uma ligação) fica no documento, sem tamanho e sem receber cliques (`visibility: hidden`, fora do fluxo), e não sai do DOM. A página decide sozinha o que deixa de desenhar.
18. **O WebView2 se reconhece pelo `Edg/<versão>` do `navigator.userAgent`.** Sem esse pedaço (o Chromium dos testes, por exemplo), a regra do mínimo não vale.
19. **O microfone do quadro no WebView2 `158`** (o item 1 da seção 7.2 das entradas): a Task 11 primeiro mostra, na fumaça, por onde o pedido passa, e só então fecha a regra, com uma das duas correções descritas lá. A escolha entre as duas é do controlador, com o resultado da fumaça na mão, registrada no ledger.
20. **A releitura da lista com a aba escondida desacelera** depois de falhas seguidas (30 s, 60 s, 120 s e depois a cada 5 minutos), e volta aos 30 s na primeira que dá certo (um dos acertos do plano 3a, na Task 9).
21. **A fila da pausa do navegador** não guarda mais de um pedido esperando por reunião (outro acerto do plano 3a, na Task 9).

## A estrutura dos arquivos

| Arquivo | O que é |
|---|---|
| `windows/app/src/Links.{h,cpp}` | o `ParseMeetingLink` e o `CommandLine.meeting` (Task 1) |
| `installer/StarsonicPhone.nsi` | o `starsonic:` registrado e tirado (Task 1) |
| `starsonic/desktop/DesktopApp.{h,cpp}`, `Protocol.cpp` | o `OpenMeeting`, o `reuniaoLink`, o `SetSessionLocked` (Tasks 1 e 2) |
| `windows/app/src/main.cpp`, `MainWindow.cpp`, `SingleInstance.cpp` | o link à instância que roda, o gancho `openMeetingLink`, o bloqueio ao núcleo (Tasks 1 e 2) |
| `windows/ui/src/reunioes/vista.ts` (novo) | o controlador da reunião dentro do app: a conversa com a página, a fase, a pausa, o bloqueio, o fechar (Tasks 3 a 7) |
| `windows/ui/src/reunioes/telas/Reuniao.tsx` (novo) | a vista: a barra do app, o `iframe`, "A reunião não abriu." (Task 3) |
| `windows/ui/src/reunioes/telas/Faixas.tsx` (novo) | as faixas das telas 13 e 14 (Tasks 5 e 6) |
| `windows/ui/src/reunioes/telas/CartaoDaLigacao.tsx` (novo) | o cartão da tela 12 e o da ligação em espera (Task 6) |
| `windows/ui/src/reunioes/telas/Fechar.tsx` (novo) | o "Sair da reunião?" (Task 7) |
| `windows/ui/src/main.tsx`, `state.ts`, `format.ts`, `fake.ts` | a vista fora da raiz de cada tela, as mensagens novas, o "Ocupado · em reunião", a ponte falsa |
| `windows/ui/src/chat/componentes/Balao.tsx` | o link de reunião numa conversa (Task 8) |
| `windows/ui/tests/reunioes/*.spec.ts` (novos) | `vista`, `entrar`, `telefone`, `ligacao`, `fim`, `link-no-chat` |
| `windows/ui/src/main.tsx` (a chave da lista do chat), `windows/ui/src/chat/` | o menu do "+" e a contagem das não lidas (Task 10) |
| `tests/smoke/reuniao_fumaca.py`, `tests/smoke/test_reuniao_fumaca.py` | a fumaça com a vista de verdade e as sondas da prova (Task 11) |
| `docs/…`, `notas/v0.5.0-rc.1.txt` | os documentos, o roteiro e as notas (Task 12) |

---

### Task 1: O link `starsonic://reuniao/<código>` (o núcleo, o executável e o instalador)

**Files:**
- Modify: `windows/app/src/Links.{h,cpp}` (o `ParseMeetingLink` e o `CommandLine.meeting`)
- Modify: `starsonic/desktop/DesktopApp.{h,cpp}`, `starsonic/desktop/Reunioes.{h,cpp}` (o `OpenMeeting` e a mensagem)
- Modify: `windows/app/src/main.cpp` (a abertura com o link e o link da segunda abertura)
- Modify: `installer/StarsonicPhone.nsi` (o `RegisterLink "starsonic"` e o `UnregisterLink "starsonic"`)
- Modify: `windows/ui/src/state.ts` (o tipo da mensagem nova; quem a usa é a Task 5)
- Test: `tests/win/test_links.cpp`, `tests/desktop/test_reunioes.cpp`

**Interfaces:**
- Consumes: o `ValidMeetingCode` (`starsonic/desktop/Reunioes.h`, do plano 3a); o caminho do `tel:` (o `ParseLinkArgument`, o `CommandLine.link`, o `DialLink` e o `BringToFront` da segunda abertura no `main.cpp`); o `OpenChat` (o molde do que espera o primeiro `ready`).
- Produces:

```cpp
// windows/app/src/Links.h
// O código de um argumento que é o link starsonic://reuniao/<código>: o esquema sem diferenciar maiúsculas, o código
// passado a minúsculas e sem espaços, e mais nada (nem barra, nem ?, nem #). Qualquer outra coisa: nada.
std::optional<std::string> ParseMeetingLink(const std::wstring& argument);
// CommandLine ganha:
std::optional<std::string> meeting;   // o código de um starsonic://reuniao/<código>

// starsonic/desktop/DesktopApp.h
// O link starsonic://reuniao/<código> (já conferido). Só põe na fila; antes do primeiro ready, espera por ele (dois
// links antes dele dão um abrir só, o do último). No modo iPhone, recusado com uma linha no diagnóstico.
void OpenMeeting(const std::string& code);

// starsonic/desktop/Reunioes.h
std::string OpenMeetingMessage(const std::string& code);   // {"v":1,"type":"abrir","tela":"reuniao","codigo":…}
```

```ts
// windows/ui/src/state.ts: a IncomingMessage ganha
| { v: number; type: 'abrir'; tela: 'reuniao'; codigo: string }
```

As regras:
- **O `ParseMeetingLink`** aceita `starsonic://reuniao/<código>` com o esquema em qualquer caixa (`STARSONIC://reuniao/…`) e os `%XX` decodificados, como o `ParseLinkArgument`. O código passa a minúsculas e perde os espaços, como o servidor faz, e só vale com o `ValidMeetingCode`. Recusa: outro caminho (`starsonic://outra/…`), `reuniao` em outra caixa, uma barra, um `?` ou um `#` depois do código, um código de 9 ou de 11 caracteres, uma letra fora do alfabeto.
- **A linha de comando:** um `starsonic:` é um link como o `tel:` (o `--link "%1"` do registro, ou o argumento sozinho do registro antigo) e desliga as opções do mesmo jeito; um argumento é um `tel:` ou um `starsonic:`, nunca os dois.
- **O `OpenMeeting`** manda a mensagem só à janela principal (a página do aviso não a recebe) e deixa no diagnóstico `reunioes: link do app`, sem o código.
- **O `main.cpp`:** na abertura, `if (arguments.meeting) app.OpenMeeting(*arguments.meeting);`, como o `DialLink`; na segunda abertura, o mesmo, e a janela vem para a frente (o `BringToFront` de hoje), também com o `--bandeja` junto.
- **O instalador** registra o `starsonic` pelo mesmo macro dos outros três links e o tira na desinstalação.

- [ ] **Step 1: Escreva os testes que falham**

```cpp
// tests/win/test_links.cpp
TEST(MeetingLink_AcceptsTheExactForm)          // "starsonic://reuniao/abcdefghjk" -> "abcdefghjk";
                                               // "STARSONIC://reuniao/ABCDEFGHJK" -> "abcdefghjk";
                                               // "starsonic://reuniao/abcde%20fghjk" -> "abcdefghjk"
TEST(MeetingLink_RefusesEverythingElse)        // ".../abcdefghjk/", "...?x=1", "...#p=x", "starsonic://outra/abcdefghjk",
                                               // "starsonic://REUNIAO/abcdefghjk", 9 e 11 caracteres, um 'i', um '0',
                                               // "tel:2003", "" -> nullopt
TEST(CommandLine_MeetingLinkIsALink)           // {L"--link", L"starsonic://reuniao/abcdefghjk", L"--sair"} -> meeting
                                               // "abcdefghjk", quit false, link nullopt; {L"starsonic://reuniao/abcdefghjk"}
                                               // (o registro antigo) -> o mesmo
// tests/desktop/test_reunioes.cpp
TEST(OpenMeeting_WaitsForTheFirstReady)        // OpenMeeting("abcdefghjk") antes do ready: nada postado; no ready, depois
                                               // do state: {"v":1,"type":"abrir","tela":"reuniao","codigo":"abcdefghjk"}
TEST(OpenMeeting_LastOneWins_AndOnlyMainWindow) // dois antes do ready: um abrir só, o do último; o ready da página do aviso
                                               // (noticePage) não o solta
TEST(OpenMeeting_LogHasNoCode)                 // o diagnóstico tem "reunioes: link do app" e nenhuma linha com o código
TEST(OpenMeeting_RefusedOnIPhone)
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cmake -S tests/desktop -B work/build-desktop -DCMAKE_BUILD_TYPE=Release && cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests`
Expected: FAIL (não compila: `ParseMeetingLink` e `OpenMeeting` não existem).

- [ ] **Step 3: Implemente** o que os Produces e as regras dizem, e o registro no instalador.

- [ ] **Step 4: Rode e veja passar**

Run: o comando do Step 2.
Expected: PASS, todos. O executável e o instalador compilam no `build` do GitHub (o controlador manda a branch).

- [ ] **Step 5: Commit**

```bash
git add windows/app/src/Links.h windows/app/src/Links.cpp starsonic/desktop/DesktopApp.h starsonic/desktop/DesktopApp.cpp starsonic/desktop/Reunioes.h starsonic/desktop/Reunioes.cpp windows/app/src/main.cpp installer/StarsonicPhone.nsi windows/ui/src/state.ts tests/win/test_links.cpp tests/desktop/test_reunioes.cpp
git commit -m "feat(app): o link starsonic://reuniao/<código> abre a entrada da reunião"
```

---

### Task 2: O `reuniaoLink` e a sessão bloqueada (o núcleo e o executável)

**Files:**
- Modify: `starsonic/desktop/Protocol.{h,cpp}`, `starsonic/desktop/DesktopApp.{h,cpp}`, `starsonic/desktop/Reunioes.{h,cpp}`
- Modify: `windows/app/src/main.cpp` (o gancho `openMeetingLink` e o bloqueio da sessão ao núcleo)
- Modify: `windows/ui/src/state.ts` (o comando e a mensagem), `windows/ui/src/fake.ts` (a ponte falsa: guarda o `reuniaoLink`; um ajudante dos testes empurra a `sessao`)
- Test: `tests/desktop/test_protocol.cpp`, `tests/desktop/test_reunioes.cpp`

**Interfaces:**
- Consumes: o `openUrl` de hoje (o `ShellExecute` no `main.cpp`, que não escreve nada); o `callbacks.cameraPaused` do `MainWindow` (o `locked_ || disconnected_`, só quando muda); o `RedactUrl` do executável (o esquema e o servidor).
- Produces:

```cpp
// Protocol: o CommandKind::MeetingLink ("reuniaoLink", só no Windows), com o campo url.
// DesktopHooks ganha:
std::function<void(const std::string& url)> openMeetingLink;   // no navegador padrão, sem escrever nada
// DesktopApp ganha:
// A sessão do Windows bloqueada ou desconectada (o mesmo valor que pausa a câmera do motor). Só põe na fila; manda a
// mensagem quando muda, e o valor de agora em todo ready da janela principal.
void SetSessionLocked(bool locked);
// Reunioes.h
bool ValidMeetingLinkUrl(const std::string& url);              // http ou https, até 2048, sem espaços nem controle
std::string SessionMessage(bool locked);                        // {"v":1,"type":"sessao","bloqueada":…}
```

```ts
// windows/ui/src/state.ts
// Command ganha:
| { cmd: 'reuniaoLink'; url: string }
// IncomingMessage ganha:
| { v: number; type: 'sessao'; bloqueada: boolean }
```

As regras:
- **O `ValidMeetingLinkUrl`:** o esquema `http://` ou `https://` (sem diferenciar maiúsculas), com um servidor depois; até 2.048 caracteres; nenhum espaço e nenhum caractere de controle (de U+0000 a U+001F e de U+007F a U+009F). O comando que não vale deixa `comando ignorado: reuniaoLink: endereco invalido`, sem o endereço; o que vale deixa `reunioes: link aberto: <esquema>://<servidor>` (sem o caminho, como o `RedactUrl`) e chama o gancho.
- **A `sessao`:** o `main.cpp` passa o mesmo valor do `callbacks.cameraPaused` ao `app.SetSessionLocked`. A mensagem vai às duas janelas, como as outras; nada vai ao diagnóstico.
- **O modo iPhone** recusa o `reuniaoLink` como os outros comandos das reuniões.

- [ ] **Step 1: Escreva os testes que falham**

```cpp
// tests/desktop/test_protocol.cpp
TEST(Protocol_MeetingLink)               // {"v":1,"cmd":"reuniaoLink","url":"https://exemplo.com/a?b=1"} vale; sem url, url
                                         // não-texto, "ftp://x", "https://", "https://a b", 2049 caracteres, um \u0007,
                                         // "javascript:alert(1)" -> recusado com "endereco invalido"
// tests/desktop/test_reunioes.cpp
TEST(MeetingLink_OpensAndLogsOnlyTheHost) // o gancho recebe o url inteiro; o diagnóstico tem
                                          // "reunioes: link aberto: https://exemplo.com" e nada do caminho
TEST(MeetingLink_RefusedOnIPhone)
TEST(SessionLocked_PostsWhenItChanges)    // SetSessionLocked(true) duas vezes: uma mensagem; false: outra
TEST(SessionLocked_SentOnReady)           // o valor de agora vai no ready da janela principal, depois do state
TEST(ValidMeetingLinkUrl_Limits)          // 2048 vale, 2049 não
```

- [ ] **Step 2: Rode e veja falhar** — Run: o comando do Step 2 da Task 1. Expected: FAIL (não compila).

- [ ] **Step 3: Implemente** o que os Produces e as regras dizem; no `fake.ts`, o `reuniaoLink` só fica guardado em `window.__comandos`.

- [ ] **Step 4: Rode e veja passar** — Run: o mesmo, e `cd windows/ui && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add starsonic/desktop/Protocol.h starsonic/desktop/Protocol.cpp starsonic/desktop/DesktopApp.h starsonic/desktop/DesktopApp.cpp starsonic/desktop/Reunioes.h starsonic/desktop/Reunioes.cpp windows/app/src/main.cpp windows/ui/src/state.ts windows/ui/src/fake.ts tests/desktop/test_protocol.cpp tests/desktop/test_reunioes.cpp
git commit -m "feat(app): o link do chat da reunião no navegador e a sessão bloqueada"
```

---

### Task 3: A vista da reunião e a conversa com a página (o "Entrar" da lista)

**Files:**
- Create: `windows/ui/src/reunioes/vista.ts` (o `ReuniaoNoApp`), `windows/ui/src/reunioes/telas/Reuniao.tsx` (a vista)
- Modify: `windows/ui/src/reunioes/cliente.ts` (o `pedirPasse`, que o `abrirNoNavegador` passa a usar), `windows/ui/src/reunioes/textos.ts`, `windows/ui/src/reunioes/telas/Aba.tsx` (o "Entrar" de cada linha), `windows/ui/src/main.tsx` (a vista fora da raiz de cada tela), `windows/ui/src/format.ts` (o "Ocupado · em reunião"), `windows/ui/src/app.css`
- Modify: `windows/ui/tests/reunioes/abrir.ts` (a página falsa)
- Test: `windows/ui/tests/reunioes/vista.spec.ts` (novo)

**Interfaces:**
- Consumes: o `ReunioesCliente` (o `pedirPasse` novo, o `avisar`, a `vista().lista`); o `Bridge` (`videoWindow`); o `enderecoDoChat()`; o `accountDot` de `format.ts`; o `barra(…)` do `main.tsx` e o `components/TitleBar.tsx`; o `abrirNasReunioes`, o `marcar`, o `noRelogioDaPagina` e o `meioDiaDeHoje` (`tests/reunioes/abrir.ts`); o `pararORelogio` (`tests/chat/abrir.ts`); o `comandos`, o `esperarComando`, o `mudarEstado` e o `semViolacoesSerias` (`tests/helpers.ts`).
- Produces:

```ts
// reunioes/cliente.ts — o ReunioesCliente ganha (o abrirNoNavegador passa a usá-lo, sem mudar o que faz):
/** Pede o passe como a pessoa da vez. Os erros são os do abrirNoNavegador (o erroDoPasse de hoje). */
pedirPasse(codigo: string): Promise<{ ok: true; passe: string; reuniao: Reuniao } | ResultadoSemPasse>;
export type ResultadoSemPasse = { ok: false; erro: string | null; outraEmpresa: boolean };

// reunioes/vista.ts
export type FaseNoApp = 'nenhuma' | 'carregando' | 'naoAbriu' | 'entrada' | 'naReuniao' | 'fora';
export interface VistaNoApp {
  fase: FaseNoApp;
  /** A reunião da vista; null com a fase 'nenhuma'. O assunto é o da resposta do passe ('' sem assunto). */
  reuniao: { codigo: string; assunto: string } | null;
  /** O src do iframe (`<chat>/r/<código>`); null sem iframe. */
  endereco: string | null;
  /** Muda a cada abertura e a cada "Tentar de novo": a chave do iframe (um documento novo). */
  quadro: number;
  /** O microfone do último `estado` da página (false antes do primeiro). */
  microfone: boolean;
  /** O tamanho da janela da reunião. */
  janela: 'grande' | 'telaCheia';
}
export interface Aparelhos { microfone: string; altoFalante: string; camera: string }
export const PRONTA_MS = 15_000;
export const SAIR_MS = 2_000;
export type ResultadoDoEntrar = { ok: true } | ResultadoSemPasse;
export class ReuniaoNoApp {
  constructor(o: { reunioes: ReunioesCliente; bridge: Bridge; base: string });
  vista(): VistaNoApp;
  assinar(f: () => void): () => void;
  /** O "Entrar": confere se pode, pede o passe e, com ele, abre a vista e pede o tamanho grande. */
  entrar(codigo: string): Promise<ResultadoDoEntrar>;
  /** O iframe da vista entrou no documento (o elemento) ou saiu (null). */
  quadroMontado(el: HTMLIFrameElement | null): void;
  tentarDeNovo(): void;
  /** Fecha a vista sem o `sair` (o "Fechar" de "A reunião não abriu."). A janela volta ao normal. */
  fechar(): void;
  telaCheia(ligada: boolean): void;
  /** Os aparelhos das Configurações, a cada estado do app: o `aparelhos` vai à página quando eles mudam. */
  aparelhos(a: Aparelhos): void;
  /** As ligações de agora (o CallState): o "Entrar" usa para recusar; as Tasks 5 e 6 acrescentam o resto. */
  ligacoes(l: CallState | null): void;
}

// tests/reunioes/abrir.ts
/** Troca a página /r/<código> do chat por uma página da mesma origem, sem o servidor de vídeo, que guarda o que o app
 *  manda e manda o que o teste quer. Chame antes do "Entrar". */
export async function paginaFalsa(page: Page, codigo: string, o?: { semPronta?: boolean }): Promise<{
  mandar(m: object): Promise<void>;          // da página para o app (com o "starsonic": 1 já posto)
  recebidas(): Promise<object[]>;            // o que o app mandou à página, na ordem
  marcar(): Promise<void>;                   // põe uma marca no documento de agora
  marcada(): Promise<boolean>;               // o documento de agora tem a marca (é o mesmo documento)
}>;
```

As regras:
- **O "Entrar" da linha** (tela 1: o botão principal, antes do "Copiar link"; no Mínimo, o primeiro item do menu, antes do "Copiar link") chama o `entrar(codigo)`. Os erros do passe aparecem na aba como os do "Abrir no navegador" do plano 3a (o mesmo `erro`; o `outraEmpresa` com o "Abrir no navegador" de convidado).
- **O `entrar` recusa antes de pedir o passe:** com uma ligação no `CallState` (também tocando) ou a sala de vídeo de pé, "Desligue a ligação para entrar na reunião."; com outra reunião na vista, "Saia da reunião de agora para entrar em outra." (o aviso curto do app). Com a mesma reunião na vista, ele só a mostra (sem outro passe).
- **Com o passe:** a fase vai a `carregando`, a vista monta o `iframe` (as regras do iframe nos Global Constraints), o `videoWindow` `grande` sai, e o relógio dos 15 s começa. O passe guardado é o primeiro a ir, no primeiro `pronta`; cada `pronta` seguinte pede um passe novo (o `pedirPasse`) e o manda. Um passe que falha nesse momento não vai (a página espera os 15 s dela).
- **As mensagens da página** só valem com o `event.source` igual ao `contentWindow` do iframe montado e o `event.origin` igual à origem do chat, e com o `"starsonic": 1`. O `estado` muda a fase (`entrada`, `naReuniao`, `fora`) e o `microfone`. O `pronta` desliga o relógio dos 15 s; um `pronta` no meio da reunião (o chat que reiniciou: a página entra de novo sozinha) só ganha o passe novo, e nada mais muda no app. O `link` (`url`) vai ao comando `reuniaoLink` (Task 2) só com `http` ou `https` e até 2.048 caracteres (o núcleo confere de novo); outro endereço não vai. As do app vão com o `postMessage(m, <origem do chat>)`.
- **"A reunião não abriu."** (sem o primeiro `pronta` em 15 s): no lugar do iframe, o título, o "Tentar de novo" (outro passe, `quadro` novo, os 15 s de novo), o "Fechar" (a vista fecha, o `videoWindow` `normal`, a aba Reuniões, e a lista lida de novo, como a cada vista que fecha) e o "Abrir no navegador" (o `abrirNoNavegador` da reunião; dando certo, a vista fecha como no "Fechar"; os erros, como os do menu).
- **A barra da vista** (telas 6 e 7): à esquerda, o estado e a conta como nas outras barras (com o `accountDot` ganhando o "Ocupado · em reunião" quando a fase é `naReuniao`); à direita, o "Tela cheia" (o `videoWindow` `telaCheia`; o botão vira "Sair da tela cheia", que volta ao `grande`), o minimizar e o fechar de sempre. O "Telefone" entra na Task 5; o fechar com a pessoa na reunião pergunta antes na Task 7 (até lá, o fechar de sempre).
- **A vista fica fora da raiz de cada tela do `main.tsx`:** ela é montada uma vez, junto da tela de agora, e as Tasks 5 e 6 só a escondem (a escolha 17). Nesta tarefa ela está sempre à vista enquanto a fase não é `nenhuma`.
- **Os `aparelhos`** vão no `passe` e, depois, a cada mudança do `audio.microfone`, do `audio.altoFalante` ou do `video.camera`.
- **Nada da conversa vai ao `console`.**

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/vista.spec.ts`; a reunião marcada pela `ApiDeTeste`; a hora da página fixada no `meioDiaDeHoje()`)

```ts
test('o Entrar abre a reunião dentro do app, com a página de verdade até a entrada', …);
// O videoWindow 'grande'; o iframe com o src exato `${baseDoChat()}/r/${codigo}` (sem '#' nem passe), o allow com as cinco
// permissões e a origem do chat, o title 'Reunião' e o foco nele; dentro dele, a entrada do colega da página de verdade;
// a barra sem o 'Ocupado · em reunião', com o 'Tela cheia'.
test('o passe vai na mensagem, e cada pronta ganha um passe novo', …);
// paginaFalsa: o pronta → { starsonic: 1, tipo: 'passe', passe: <43 caracteres>, aparelhos: { microfone, altoFalante,
// camera } } (os nomes do estado da ponte falsa); outro pronta → outro passe, diferente; dois POST …/passe ao chat.
test('os aparelhos trocados nas Configurações vão à página', …);   // mudarEstado no audio.microfone → { tipo: 'aparelhos', … }
test('o pronta no meio da reunião ganha um passe novo e não tira a pessoa da reunião', …);
// estado naReuniao; depois um pronta: outro passe; a barra continua com o 'Ocupado · em reunião'.
test('o link do chat da reunião abre no navegador', …);
// { tipo: 'link', url: 'https://exemplo.com/a' } → { cmd: 'reuniaoLink', url }; 'javascript:alert(1)' e 2.049 caracteres → nada.
test('a mensagem de outra janela ou de outra origem não vale', …);
// Um segundo iframe (da origem do chat, pela mesma rota) e a própria janela do app mandam { starsonic: 1, tipo: 'estado',
// fase: 'naReuniao' }: a barra continua sem o 'Ocupado · em reunião'; um tipo desconhecido da página não muda nada.
test('o Ocupado · em reunião só com a pessoa na reunião', …);   // estado naReuniao → aparece; estado entrada → some
test('sem o pronta em 15 s, A reunião não abriu', …);
// paginaFalsa com semPronta; pararORelogio; runFor(15_000) (depois de o iframe carregar): o título, 'Tentar de novo',
// 'Fechar' e 'Abrir no navegador'. O Tentar de novo: outro POST …/passe e um documento novo (marcada() falso). O Fechar:
// o videoWindow 'normal' e a aba Reuniões. O Abrir no navegador: o reuniaoNavegador com o código e o passe, e a vista fecha.
test('a tela cheia e a volta não recriam a reunião', …);
// marcar(); 'Tela cheia' → videoWindow 'telaCheia' e o botão 'Sair da tela cheia'; a volta → 'grande'; marcada() verdadeiro.
test('a ligação em andamento e a sala impedem o Entrar', …);   // nenhum POST …/passe; o aviso curto com a frase
test('o erro do passe aparece na aba, e a reunião de outra empresa oferece o navegador', …);  // page.route no …/passe
test('nada da reunião vai ao console', …);   // nenhum código, passe ou endereço da reunião
for (const tema of ['light', 'dark'] as const) test(`a vista não tem violações sérias (${tema})`, …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/vista.spec.ts`
Expected: FAIL (a linha não tem o "Entrar").

- [ ] **Step 3: Implemente** o que os Produces e as regras dizem.

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa (menos os seis de foto do chat, só aqui). Os testes da aba que contam os botões de uma linha passam a ver o "Entrar": acerte o que eles contam, sem mudar o que conferem, e diga no relatório quais mudaram.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/vista.ts windows/ui/src/reunioes/telas/Reuniao.tsx windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/textos.ts windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/main.tsx windows/ui/src/format.ts windows/ui/src/app.css windows/ui/tests/reunioes/abrir.ts windows/ui/tests/reunioes/vista.spec.ts
git commit -m "feat(ui): a reunião dentro da janela do app, pelo Entrar da lista"
```

---

### Task 4: As outras entradas: o campo do link, o link do app e o WebView2 antigo

**Files:**
- Modify: `windows/ui/src/reunioes/telas/Aba.tsx` (o "Entrar" do campo do link), `windows/ui/src/reunioes/vista.ts`, `windows/ui/src/reunioes/textos.ts`, `windows/ui/src/main.tsx` (a mensagem `abrir` com a tela `reuniao`)
- Test: `windows/ui/tests/reunioes/entrar.spec.ts` (novo)

**Interfaces:**
- Consumes: o `entrar` (Task 3); a mensagem `abrir` com a tela `reuniao` (Task 1); o campo do link do plano 3a (o `codigoDoTexto`, o estado "de outra empresa" com o "Abrir no navegador", o `abrirNoNavegador`); o `empurrar` dos testes.
- Produces:

```ts
// reunioes/vista.ts
/** A versão do WebView2 pelo `Edg/<n>` do userAgent; null sem ele (o Chromium dos testes, por exemplo). */
export function versaoDoWebView2(userAgent: string): number | null;
/** O mínimo para a reunião dentro do app (a escolha 1). */
export const WEBVIEW2_MINIMO = 131;
```

As regras:
- **O campo do link** ganha o "Entrar", como botão principal, ao lado do "Abrir no navegador" que já tem (a escolha 17 da spec). O Enter no campo passa a ser o "Entrar". O estado "de outra empresa" do plano 3a continua igual: só o "Abrir no navegador" de convidado.
- **O link do app** (a mensagem `abrir` com a tela `reuniao`) leva à aba Reuniões, põe o link da reunião (`<chat>/r/<código>`) no campo e faz o "Entrar" do campo: os erros aparecem ali, como os de quem colou o link. Sem o chat (o `state.chat.ligado` falso, ou a aba Reuniões sem aparecer), o aviso curto "Este computador não está ligado ao chat da empresa. Entre pelo navegador." e nada mais.
- **O WebView2 antigo** (o `versaoDoWebView2` abaixo de `WEBVIEW2_MINIMO`): o "Entrar" (da linha, do campo e do link do app) faz o `abrirNoNavegador` e, dando certo, mostra o aviso curto "Este Windows não abre a reunião dentro do app. Ela abriu no navegador." (a escolha 1).
- **O servidor do chat antigo** (o `404` do passe com a reunião ainda na lista) diz "O servidor do chat precisa ser atualizado para abrir reuniões pelo app.", como no plano 3a.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/entrar.spec.ts`)

```ts
test('o Entrar do campo abre a reunião colada, e o Enter é o Entrar', …);   // o link inteiro e só o código
test('o link do app abre a entrada da reunião', …);
// empurrar { type: 'abrir', tela: 'reuniao', codigo }: a aba Reuniões, o link no campo, o POST …/passe e a vista.
test('o link do app de uma reunião de outra empresa oferece o navegador', …);
test('o link do app sem o chat diz para entrar pelo navegador', …);          // nenhum pedido ao chat
test('o link do app com uma ligação diz para desligar', …);
test('o WebView2 antigo abre no navegador e diz por quê', …);
// O contexto com o userAgent '… Edg/130.0.2849.80': o Entrar manda o reuniaoNavegador com o código e o passe, e o aviso;
// com '… Edg/131.0.2903.86', a vista. O versaoDoWebView2 no Node: 'Edg/158.0' → 158; sem 'Edg/' → null.
test('o chat antigo diz que precisa ser atualizado', …);   // page.route: o …/passe responde 404; a reunião está na lista
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/entrar.spec.ts`. Expected: FAIL (o campo não tem o "Entrar").

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa. O teste do plano 3a que conferia "o Enter no campo é o Abrir no navegador" passa a conferir o "Entrar": diga no relatório.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/reunioes/vista.ts windows/ui/src/reunioes/textos.ts windows/ui/src/main.tsx windows/ui/tests/reunioes/entrar.spec.ts windows/ui/tests/reunioes/navegador.spec.ts
git commit -m "feat(ui): o Entrar do campo do link e o link do app"
```

---

### Task 5: O "Telefone", a faixa da tela 14 e o aviso com a reunião do app escondida

**Files:**
- Create: `windows/ui/src/reunioes/telas/Faixas.tsx` (a faixa da tela 14; a Task 6 acrescenta a da 13)
- Modify: `windows/ui/src/reunioes/vista.ts`, `windows/ui/src/reunioes/cliente.ts` (a reunião do app nos pedidos e fora da pausa do navegador), `windows/ui/src/reunioes/telas/Reuniao.tsx` (o botão "Telefone"), `windows/ui/src/reunioes/textos.ts`, `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/telefone.spec.ts` (novo)

**Interfaces:**
- Consumes: o `ReuniaoNoApp` (Task 3); o `ReunioesCliente` do plano 3a (os pedidos pelos eventos, o `reuniaoPedido` com o `escondida`, a pausa do navegador e o `ouvindoNoNavegador`); a mensagem `abrir` com a tela `reunioes` (o clique fora dos botões do aviso); o `comEventos` e a `paginaFalsa` dos testes.
- Produces:

```ts
// reunioes/vista.ts — VistaNoApp ganha:
/** A reunião está escondida dentro do app: o "Telefone", ou a tela de uma ligação por cima (Task 6). */
escondida: boolean;
// ReuniaoNoApp ganha:
/** O "Telefone": na reunião, mostra o app de sempre e esconde a vista; antes de entrar, fecha a vista. */
telefone(): void;
/** O "Voltar para a reunião" da faixa: a vista de novo, no tamanho em que ela estava. */
voltar(): void;

// reunioes/cliente.ts — o ReunioesCliente ganha:
/** A reunião da vista do app (o código e se ela está escondida), ou null. Os eventos dela continuam trazendo os pedidos
 *  ao aviso, com o `escondida` daqui; ela não entra na pausa do navegador nem no `ouvindoNoNavegador`. */
reuniaoNoApp(r: { codigo: string; escondida: boolean } | null): void;
```

As regras:
- **O "Telefone"** fica na barra da vista, antes do "Tela cheia". Com a `fase` `naReuniao`, ele manda o `videoWindow` `normal`, esconde a vista (a escolha 17) e mostra o app de sempre, na aba em que ele estava, com a faixa da tela 14 logo abaixo da barra: "Você está na reunião", "O microfone está ligado" ou "O microfone está desligado" (o `microfone` do último `estado`), e o "Voltar para a reunião". A barra diz "Ocupado · em reunião". Com outra `fase` (a entrada, a página carregando, "A reunião não abriu.", o `fora`), o "Telefone" fecha a vista (o `fechar`).
- **O "Voltar para a reunião"** da faixa mostra a vista de novo e manda o `videoWindow` do tamanho em que ela estava (o `grande` ou o `telaCheia`).
- **O aviso do canto:** a reunião da vista entra nos pedidos do `ReunioesCliente` pelo `reuniaoNoApp`, com o `escondida` verdadeiro no "Telefone" e com a tela de uma ligação por cima; com a vista à vista, falso (o núcleo ainda mostra o aviso com a janela fora da frente: a regra do `ShowsNotice`). A página de dentro do app mostra o pedido ela mesma.
- **O clique fora dos botões do aviso** (o `abrir` com a tela `reunioes`) com a reunião do app na `fase` `naReuniao` e sem ligação: volta para a reunião (o `voltar`); fora disso, a aba Reuniões, como no plano 3a.
- **No "Telefone", a aba Reuniões** continua: o "Entrar" de outra reunião diz "Saia da reunião de agora para entrar em outra."; o "Entrar" da mesma reunião volta para ela.
- **A reunião do app não vai à pausa do navegador** (a rota `pausa`) nem ao `ouvindoNoNavegador`: a pausa dela é a da Task 6.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/telefone.spec.ts`; a `paginaFalsa` na `fase` `naReuniao`)

```ts
test('o Telefone mostra o app de sempre, com a faixa, e a reunião continua', …);
// videoWindow 'normal'; a faixa com 'Você está na reunião', 'O microfone está ligado' e 'Voltar para a reunião'; as seis
// abas; a barra com 'Ocupado · em reunião'; marcada() verdadeiro. O Voltar: videoWindow 'grande', a vista, marcada().
test('a faixa diz o microfone da página', …);              // estado com microfone falso → 'O microfone está desligado'
test('o Telefone antes de entrar fecha a entrada', …);      // fase entrada → a vista some, videoWindow 'normal'
test('a volta vai ao tamanho em que a reunião estava', …);  // tela cheia → Telefone → Voltar → 'telaCheia'
test('no Telefone, o pedido da reunião vai ao aviso como escondido', …);
// comEventos: o reuniaoPedido da reunião do app → { cmd: 'reuniaoPedido', pedido: …, escondida: true }; de volta à vista →
// o mesmo pedido com escondida falso.
test('o clique fora dos botões do aviso volta para a reunião', …);   // empurrar { type: 'abrir', tela: 'reunioes' }
test('no Telefone, outra reunião não abre, e a mesma volta', …);
test('a reunião de dentro do app não entra na pausa do navegador', …);
// Com os eventos dela e uma ligação atendida (mudarEstado): nenhum POST …/pausa com o código dela.
for (const tema of ['light', 'dark'] as const) test(`a faixa do Telefone não tem violações sérias (${tema})`, …);
test('a faixa do Telefone cabe nos três tamanhos', …);    // 400×720, 360×600, 300×440: inteira, sem rolagem na horizontal
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/telefone.spec.ts`. Expected: FAIL (a barra não tem o "Telefone").

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/Faixas.tsx windows/ui/src/reunioes/vista.ts windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/telas/Reuniao.tsx windows/ui/src/reunioes/textos.ts windows/ui/src/main.tsx windows/ui/src/app.css windows/ui/tests/reunioes/telefone.spec.ts
git commit -m "feat(ui): o Telefone durante a reunião, com a faixa e o aviso do Windows"
```

---

### Task 6: A ligação no meio da reunião (as telas 12 e 13, a espera e a pausa)

**Files:**
- Create: `windows/ui/src/reunioes/telas/CartaoDaLigacao.tsx` (o cartão da tela 12 e o da ligação em espera)
- Modify: `windows/ui/src/reunioes/pausa.ts` (a espera pelo "Voltar para a reunião"), `windows/ui/src/reunioes/vista.ts`, `windows/ui/src/reunioes/cliente.ts` (a mesma regra na pausa do navegador), `windows/ui/src/reunioes/telas/Faixas.tsx` (a faixa da tela 13), `windows/ui/src/reunioes/textos.ts`, `windows/ui/src/main.tsx`, `windows/ui/src/screens/Ligacao.tsx` (a câmera e o vídeo numa reunião), `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/ligacao.spec.ts` (novo), `windows/ui/tests/reunioes/pausa.spec.ts` (o caso da espera)

**Interfaces:**
- Consumes: o `haPausa` (plano 3a); o `CallState` (`top.phase`, `top.held`, `top.id`, `second`, `conference`, `consulting`, `sala`); os comandos `answer`, `reject`, `hangup` e `hold`; o `contactNumberLine` de `format.ts` ("Ramal 2015"); o `ReuniaoNoApp` (Tasks 3 a 5).
- Produces:

```ts
// reunioes/pausa.ts — a regra ganha a espera:
/** Há pausa enquanto existe uma ligação que não está em espera pelo "Voltar para a reunião" (`emEspera`: o id da
 *  ligação que o Voltar pôs em espera, ou null): do começo de uma ligação feita, ou do atender de uma recebida, até a
 *  última acabar; só tocando não pausa; a sala de vídeo de pé conta como uma ligação. */
export function haPausa(l: CallState | null, emEspera?: number | null): boolean;

// reunioes/vista.ts — VistaNoApp ganha:
/** O id da ligação que o "Voltar para a reunião" pôs em espera, ou null. */
emEspera: number | null;
// ReuniaoNoApp ganha:
/** O "Voltar para a reunião" da faixa da tela 13: a ligação em espera e a reunião de volta. */
voltarDaLigacao(): void;
/** O "Voltar à ligação" do cartão da espera. */
voltarALigacao(): void;

// reunioes/cliente.ts — o ReunioesCliente.ligacoes ganha o segundo argumento:
ligacoes(l: CallState | null, emEspera?: number | null): void;
```

As regras:
- **A pausa da reunião do app** é o `haPausa(l, emEspera)`: quando ela começa, o `pausar`; quando acaba, o `retomar`. Enquanto ela dura, o `pausar` vai de novo a cada `estado` em que a `fase` passa a `naReuniao`. O atender automático pausa como o "Atender". A pausa do navegador do plano 3a passa a usar a mesma regra, com o mesmo `emEspera`.
- **Uma ligação tocando, com a vista à vista,** mostra o cartão da tela 12 por cima da página, no alto e no meio: o avatar, "Ligação de <nome ou número>", "<o `contactNumberLine` do número> · tocando", o "Recusar" (o `reject`) e o "Atender" (o `answer` sem vídeo), com esses nomes para o leitor de tela, e a linha "Atender tira você da reunião enquanto a ligação durar.". Com duas tocando, o cartão é o da de cima. No "Telefone", a ligação toca como sempre (a tela de chamada de hoje).
- **Com a pausa,** a janela vai ao `videoWindow` `normal`, a vista fica escondida (o `escondida` da Task 5) e a tela da ligação de sempre aparece, com a faixa da tela 13 logo abaixo da barra: "Você está fora da reunião", o assunto (ou "Reunião sem assunto"), e o "Voltar para a reunião" só com **uma** ligação, já atendida (sem `second`, sem `conference`, sem `consulting`, com a fase `active`). A barra diz "Ocupado · em ligação".
- **O "Voltar para a reunião"** da faixa manda o `hold` com o `on` verdadeiro e guarda o id da ligação no `emEspera`; a reunião volta (o `retomar` pela regra, o tamanho em que ela estava, a vista), com o cartão "<nome ou número> em espera", o "Voltar à ligação" (o `hold` com o `on` falso: a pausa volta, a janela normal, a tela da ligação) e o "Desligar" (o `hangup`). O `emEspera` some quando a ligação sai da espera por outro caminho ou acaba.
- **Quando a última ligação acaba,** o `retomar` (pela regra) e a vista de volta, no tamanho em que ela estava (o núcleo põe a janela no `normal` no fim da ligação; a vista manda o tamanho dela depois).
- **Numa reunião, as ligações são só de voz** (a escolha 7): a tela da ligação mostra a "Câmera" desligada e sem efeito, o "Atender com vídeo" não aparece, e a sala de vídeo não se monta.
- **Uma ligação feita do "Telefone"** pausa a reunião no começo (a fase `dialing`), com a mesma tela e a mesma faixa.
- **Antes de a pessoa entrar** (a página carregando, "A reunião não abriu.", a entrada ou o `fora`), uma ligação atendida ou feita fecha a vista (a 7.6 da spec: esconder a vista antes de entrar a fecha, e a câmera da prévia apaga), sem faixa e sem pausa.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/ligacao.spec.ts`; a `paginaFalsa` na `fase` `naReuniao`; as ligações pelo `mudarEstado`)

```ts
test('uma ligação que chega mostra o cartão por cima da reunião', …);
// 'Ligação de Marcos Teixeira', 'Ramal 2015 · tocando', 'Atender tira você da reunião enquanto a ligação durar.', os
// botões 'Recusar' e 'Atender'; nenhum pausar; marcada() verdadeiro.
test('o Atender tira a pessoa da reunião enquanto a ligação dura', …);
// O answer sem video; com a ligação active: o pausar à página, o videoWindow 'normal', a faixa ('Você está fora da reunião',
// o assunto, 'Voltar para a reunião') e 'Ocupado · em ligação'; marcada() verdadeiro.
test('quando a ligação acaba, a reunião volta como estava', …);   // o retomar; o videoWindow 'telaCheia' se estava nela
test('o Voltar para a reunião põe a ligação em espera', …);
// O hold on; com a ligação held: o retomar, a vista, o cartão 'Marcos Teixeira em espera'; o Voltar à ligação: hold off,
// o pausar, a tela da ligação; o Desligar: o hangup.
test('o Voltar para a reunião só com uma ligação já atendida', …);   // tocando, duas, conferência, consulta: sem o botão
test('numa reunião, a ligação é só de voz', …);   // sem 'Atender com vídeo'; a Câmera desligada; a sala não se monta
test('uma ligação feita do Telefone também tira da reunião', …);   // dialing → pausar e a faixa
test('a pausa vai de novo quando a pessoa entra', …);   // ligação active com a fase entrada; estado naReuniao → pausar
test('o atender automático também pausa', …);           // o estado vai direto a active
test('uma ligação atendida antes de entrar fecha a entrada', …);   // a fase entrada; o answer; a vista some, sem faixa
for (const tema of ['light', 'dark'] as const) test(`o cartão e a faixa da ligação não têm violações sérias (${tema})`, …);
test('a faixa da ligação cabe nos três tamanhos', …);
// tests/reunioes/pausa.spec.ts
test('a ligação em espera pelo Voltar não pausa a reunião do navegador', …);
// Uma reunião do navegador e a do app; o Voltar para a reunião: o POST …/pausa com o pausada falso para a do navegador.
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/ligacao.spec.ts tests/reunioes/pausa.spec.ts`. Expected: FAIL (nenhum cartão).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/CartaoDaLigacao.tsx windows/ui/src/reunioes/pausa.ts windows/ui/src/reunioes/vista.ts windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/telas/Faixas.tsx windows/ui/src/reunioes/textos.ts windows/ui/src/main.tsx windows/ui/src/screens/Ligacao.tsx windows/ui/src/app.css windows/ui/tests/reunioes/ligacao.spec.ts windows/ui/tests/reunioes/pausa.spec.ts
git commit -m "feat(ui): a ligação no meio da reunião, com o cartão, a faixa e a espera"
```

---

### Task 7: O fechar, os fins, a queda, a troca de conta, o Windows bloqueado e o "Atualizar agora"

**Files:**
- Create: `windows/ui/src/reunioes/telas/Fechar.tsx` (o "Sair da reunião?")
- Modify: `windows/ui/src/reunioes/vista.ts`, `windows/ui/src/reunioes/textos.ts`, `windows/ui/src/main.tsx` (o fechar da barra, a mensagem `sessao`, a pergunta da atualização), `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/fim.spec.ts` (novo)

**Interfaces:**
- Consumes: o `ReuniaoNoApp` (Tasks 3 a 6); a mensagem `sessao` (Task 2); o `closeToTray`, o `minimize` e o `updateNow` de hoje; o `parou` da sessão do chat (o `assinarSessao` do plano 3a) e o `state.chat.ligado`; o `sala/EncerrarSala.tsx` (o molde de uma pergunta num `<dialog>` com o `alertdialog`); o cenário `chat-duas-contas`.
- Produces:

```ts
// ReuniaoNoApp ganha:
/** Com a pessoa na reunião (a fase naReuniao): manda o `sair` e resolve no `fim`, ou em SAIR_MS. */
sair(): Promise<void>;
/** A sessão do Windows bloqueada (a mensagem `sessao`): o `bloqueio` vai à página quando muda, e de novo a cada fase
 *  que passa a naReuniao com ela bloqueada. */
sessao(bloqueada: boolean): void;
// VistaNoApp ganha:
/** O último fim que a tela tem de dizer (o texto do aviso curto), com uma vez nova a cada fim; null sem nenhum. */
fim: { texto: string | null; vez: number } | null;
```

As regras:
- **O fechar da barra** (o `closeToTray` de hoje) com a `fase` `naReuniao`, também no "Telefone" e com uma ligação: abre o `alertdialog` "Sair da reunião?", com "Fechar a janela tira você da reunião.", o "Continuar na reunião" (o foco começa nele; o Esc é ele) e o "Sair da reunião" (o vermelho `#c23b3b`). O "Sair da reunião" faz o `sair` e, depois dele, o `closeToTray`. Com outra `fase`, o fechar fecha a vista e manda o `closeToTray`, sem perguntar. O minimizar não pergunta, e a reunião continua.
- **O "Atualizar agora"** (a escolha 9) com a `fase` `naReuniao` abre a mesma pergunta; o "Sair da reunião" faz o `sair` e manda o `updateNow`. O "Depois" de hoje continua igual.
- **O `fim` da página** fecha a vista, manda o `videoWindow` `normal` (se a vista estava à vista) e lê a lista de novo. O `saiu` não diz nada; o `tirado` diz "Você foi tirado da reunião"; o `acabou`, "A reunião acabou"; o `linkInvalido`, "Este link não vale mais" (os avisos curtos do app). Com a vista à vista, o app vai à aba Reuniões; no "Telefone" ou numa ligação, a pessoa fica onde está, a faixa some, e o aviso aparece ali.
- **A queda** (o `estado` com a `fase` `fora`): para o app, a pessoa deixa de estar na reunião: a barra perde o "Ocupado · em reunião", a pausa e o bloqueio param de ir, e a reunião sai do aviso do canto. Com a vista à vista, a página mostra o "Você saiu da reunião" dela (com o "Entrar de novo"), e a vista se comporta como na entrada (o "Telefone" e o fechar a fecham). Com a vista escondida, o app fecha a vista e diz "A conexão com a reunião caiu. Entre de novo pela aba Reuniões.".
- **A troca de conta e o chat desligado** (o `parou` da sessão do chat) com uma vista aberta: o `sair` (se a pessoa está na reunião) e a vista fecha. Na troca de conta (o `state.chat.ligado` continua verdadeiro), o aviso "Você saiu da reunião porque a conta mudou."; com o chat desligado, o aviso da escolha 14.
- **O Windows bloqueado** (a `sessao`): o `bloqueio` com o `ligado` igual ao `bloqueada`, quando muda, com a página na entrada ou na reunião; e o `bloqueio` com o `ligado` verdadeiro de novo a cada `fase` que passa a `naReuniao` com a sessão bloqueada. Nada na tela do app.
- **Sair do app** (a bandeja, o Alt+F4, o Windows desligando) não pergunta: a página desliga a ligação ao ir embora. Nada muda no `quit`.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/fim.spec.ts`; a `paginaFalsa`)

```ts
test('fechar a janela na reunião pergunta antes', …);
// O fechar da barra: 'Sair da reunião?', 'Fechar a janela tira você da reunião.', o foco em 'Continuar na reunião'; o Esc
// fecha a pergunta sem comando; o 'Sair da reunião': o sair à página; a página responde o fim 'saiu': a vista fecha e
// sai o closeToTray.
test('sem o fim em 2 s, a vista fecha assim mesmo', …);    // pararORelogio; a página não responde; runFor(2_000)
test('fechar antes de entrar não pergunta', …);              // a fase entrada: o closeToTray na hora
test('o fim de cada motivo volta à aba, com o aviso', …);
// tirado, acabou e linkInvalido: o texto de cada um; o saiu sem aviso; a lista lida de novo; a barra sem o 'Ocupado · em
// reunião'; uma ligação depois não manda pausar; um reuniaoPedido daquela reunião (comEventos) não vai ao aviso como dela.
test('o fim com a pessoa no Telefone fica onde está', …);   // a faixa some, o aviso aparece, a aba continua a mesma
test('a queda deixa a vista, e a pessoa deixa de estar em reunião', …);
test('a queda com a reunião escondida fecha a vista e avisa', …);   // no Telefone: o aviso da conexão que caiu
test('a troca de conta tira a pessoa da reunião', …);
// chat-duas-contas: a troca → o sair à página → o fim → a vista fechada → 'Você saiu da reunião porque a conta mudou.'
test('o Windows bloqueado desliga a câmera da reunião', …);
// empurrar { type: 'sessao', bloqueada: true } → { tipo: 'bloqueio', ligado: true }; false → ligado falso; bloqueada com a
// fase entrada e depois o estado naReuniao → o bloqueio com ligado verdadeiro de novo.
test('o Atualizar agora pergunta antes', …);   // a pergunta da atualização; o Sair da reunião → o sair, o fim, o updateNow
for (const tema of ['light', 'dark'] as const) test(`a pergunta do fechar não tem violações sérias (${tema})`, …);
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/fim.spec.ts`. Expected: FAIL (o fechar não pergunta).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/Fechar.tsx windows/ui/src/reunioes/vista.ts windows/ui/src/reunioes/textos.ts windows/ui/src/main.tsx windows/ui/src/app.css windows/ui/tests/reunioes/fim.spec.ts
git commit -m "feat(ui): o fechar, os fins, a queda e a troca de conta com a reunião no app"
```

---

### Task 8: O link de reunião numa conversa do chat

**Files:**
- Modify: `windows/ui/src/chat/componentes/Balao.tsx` (o texto do balão), `windows/ui/src/reunioes/formato.ts` (achar o link)
- Modify: `windows/ui/src/main.tsx` (o clique leva ao "Entrar")
- Test: `windows/ui/tests/reunioes/formato.spec.ts` (o caso novo), `windows/ui/tests/reunioes/link-no-chat.spec.ts` (novo)

**Interfaces:**
- Consumes: o `codigoDoTexto` do plano 3a (o mesmo alfabeto e a mesma base); o "Entrar" do campo do link (Task 4: o link vai ao campo e o "Entrar" segue).
- Produces:

```ts
// reunioes/formato.ts
/** O texto de uma mensagem em pedaços: os links de reunião deste chat (cada palavra que é exatamente
 *  `<base>/r/<código>`, a base sem diferença de maiúsculas e o código com 10 caracteres do alfabeto) e o resto. */
export function pedacosComReuniao(texto: string, base: string): Array<{ texto: string; codigo?: string }>;
```

As regras:
- **Só a palavra que é exatamente o link** vira link (a escolha 10): separada por espaço, quebra de linha ou o começo e o fim do texto. `https://<outro>/r/<código>`, um código de 9 caracteres, o link com `?x=1` ou com um ponto colado, e qualquer outro endereço continuam texto.
- **O link** é um `<a href="#">` (um botão para o leitor de tela, com o texto do próprio link), que leva o link ao campo da aba Reuniões e faz o "Entrar" (Task 4). Ele nunca abre o navegador. Sem a aba Reuniões (a empresa sem as reuniões), o texto continua texto.
- **O resto do balão não muda** (as quebras de linha, o leitor de tela, o tema).

- [ ] **Step 1: Escreva os testes que falham**

```ts
// tests/reunioes/formato.spec.ts
test('o link de reunião numa mensagem', …);
// 'Reunião às 14h: <base>/r/abcdefghjk' → [{ texto: 'Reunião às 14h: ' }, { texto: '<base>/r/abcdefghjk', codigo: 'abcdefghjk' }];
// a base em maiúsculas → o link; '<base>/r/abcdefghjk.', '…?x=1', 'https://outro/r/abcdefghjk', 9 caracteres → um pedaço só,
// sem código; duas reuniões na mesma mensagem → dois links.
// tests/reunioes/link-no-chat.spec.ts
test('o link de reunião numa conversa leva à entrada no app', …);
// Uma mensagem com o link (a ApiDeTeste manda); o clique: a aba Reuniões, o link no campo, o POST …/passe e a vista.
test('outros endereços numa conversa continuam texto', …);
test('sem as reuniões na empresa, o link continua texto', …);
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npx playwright test tests/reunioes/formato.spec.ts && npm run build && npx playwright test tests/reunioes/link-no-chat.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/chat/componentes/Balao.tsx windows/ui/src/reunioes/formato.ts windows/ui/src/main.tsx windows/ui/tests/reunioes/formato.spec.ts windows/ui/tests/reunioes/link-no-chat.spec.ts
git commit -m "feat(ui): o link de reunião numa conversa do chat leva à entrada no app"
```

---

### Task 9: Os acertos das reuniões que o plano 3a deixou

**Files:**
- Modify: `windows/ui/src/reunioes/cliente.ts`, `windows/ui/src/reunioes/telas/Nova.tsx`, `windows/ui/src/reunioes/telas/Aba.tsx`, `windows/ui/src/reunioes/telas/Cancelar.tsx`, `windows/ui/src/fake.ts`
- Test: `windows/ui/tests/reunioes/aba.spec.ts`, `nova.spec.ts`, `navegador.spec.ts`, `menu.spec.ts`, `pausa.spec.ts`, `windows/ui/tests/screens.spec.ts` ou o teste da ponte falsa que conta o nome

**Interfaces:**
- Consumes: o `ReunioesCliente` e as telas do plano 3a; a lista do `reunioes-etapa-2-plano-3a-entrega.md` (no Project), seção 6 e o apêndice.
- Produces: nenhuma interface nova. As regras:

1. **A releitura com a aba escondida desacelera** (a escolha 20): depois de uma falha que não é o `403 semReunioes`, a próxima leitura sai em 30 s, depois em 60 s, em 120 s e, daí em diante, a cada 5 minutos; a primeira leitura que dá certo (ou a aba à vista, ou um `conectou`) volta aos 30 s.
2. **A fila da pausa do navegador** (a escolha 21) guarda no máximo um pedido esperando por reunião: um `pausada` verdadeiro novo, com outro do mesmo valor já esperando, não entra na fila.
3. **A Nova reunião:** o erro de um campo só some quando aquele campo muda (e todos no próximo "Criar a reunião"); o `403 semReunioes` ao criar não mostra "O servidor do chat não respondeu" (a aba some e o app vai ao Teclado, como já faz).
4. **O foco depois do campo do link:** depois de um "Abrir no navegador" que dá certo (o texto esvazia) e depois do clique de convidado, o foco volta ao campo do link.
5. **Um botão ocupado com o foco** fica com o `aria-disabled="true"` e ignora o clique, em vez do `disabled`: o "Cancelar a reunião" do cancelar e o "Criar a reunião" da Nova reunião (o foco não cai mais no fundo da página).
6. **A aba depois de desligar e ligar o chat:** com o `state.chat.ligado` falso, a aba volta a esconder (o `aba` falso), e só aparece de novo com a primeira leitura que dá certo (a escolha 8 do plano 3a: uma empresa sem as reuniões nunca a vê).
7. **A ponte falsa conta o nome do pedido em pontos de código,** como o núcleo (o `reuniaoPedido` recusa mais de 120).
8. **Os testes que faltam:** a linha do `403 semReunioes` do abrir e a releitura que falha depois de um `404` (`navegador.spec.ts`); a linha do `404` da pausa, a dúvida que acaba no `204` do começo, o falso a uma reunião de link vencido, o `409 foraDaReuniao` e o `204` do falso, e a região vazia da frase sem abrir espaço (`pausa.spec.ts`); o `test.afterEach` com o `page.unrouteAll({ behavior: 'ignoreErrors' })` em `aba.spec.ts`.

- [ ] **Step 1: Escreva os testes que falham**, um por regra (os do item 8 já descrevem o que conferem):

```ts
// aba.spec.ts
test('com a aba escondida, a releitura desacelera e volta aos 30 s', …);   // 30, 60, 120, 300, 300 s; depois de um 200, 30 s
test('desligar e ligar o chat esconde a aba até a primeira resposta', …);
// nova.spec.ts
test('o erro de um campo só some quando aquele campo muda', …);
test('o semReunioes ao criar não diz que o servidor não respondeu', …);
test('o Criar a reunião ocupado guarda o foco', …);              // aria-disabled; o foco continua no botão
// menu.spec.ts
test('o Cancelar a reunião ocupado guarda o foco', …);
// navegador.spec.ts
test('depois de abrir no navegador pelo campo, o foco volta ao campo', …);   // também depois do convidado
// pausa.spec.ts
test('a fila da pausa não guarda dois pedidos iguais', …);       // o pedido pendurado; três rodadas de 10 s; um só esperando
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes`. Expected: FAIL nos testes novos (os do item 8 que já passam dizem isso no relatório).

- [ ] **Step 3: Implemente** as regras 1 a 7.

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes windows/ui/src/fake.ts windows/ui/tests/reunioes
git commit -m "fix(ui): os acertos das reuniões que a revisão do plano 3a deixou"
```

---

### Task 10: Os dois achados do chat: o menu do "+" e a contagem das não lidas

**Files:**
- Modify: `windows/ui/src/main.tsx` (a chave da lista do chat), os arquivos do chat que a causa da contagem mostrar (`windows/ui/src/chat/cliente.ts` e vizinhos)
- Test: `windows/ui/tests/chat/lista.spec.ts`

**Interfaces:**
- Consumes: o `abrirOMais(page)` e o `chatDentro` (`tests/chat/abrir.ts`, do plano 3a); a seção 5 das entradas (o teste intermitente); a nota "a lista do chat é recriada quando o chat acaba de entrar" do plano 3a (no fim da seção dos fatos).
- Produces: nenhuma interface nova. As regras:

1. **O menu do "+" aberto no primeiro instante não fecha sozinho.** Hoje o `main.tsx` desenha a lista com a chave `vistaChat.eu?.id ?? 0`: quando o chat acaba de entrar, a chave muda de `0` para o id da pessoa e a lista nasce de novo, fechando o menu. A chave só muda quando a pessoa muda de um id para outro.
2. **A contagem das não lidas não conta a mesma mensagem duas vezes.** O teste "the list has no serious accessibility violations" (`tests/chat/lista.spec.ts`) viu 3 em vez de 2, uma vez, no GitHub. Ache a causa com um teste que a reproduza (a suspeita da seção 5 das entradas: a mesma mensagem contada pelo evento e pela releitura da lista) e corrija o app; se a causa for do teste, corrija o teste e diga no relatório por quê.

- [ ] **Step 1: Escreva os testes que falham**

```ts
test('o menu do + aberto antes de o chat terminar de entrar continua aberto', …);
test('a mesma mensagem, pelo evento e pela releitura, conta uma vez', …);   // ou o caso que a causa mostrar
```

- [ ] **Step 2: Rode e veja falhar** — Run: `cd windows/ui && npm run build && npx playwright test tests/chat/lista.spec.ts`. Expected: FAIL nos dois.

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira** — Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src windows/ui/tests/chat/lista.spec.ts
git commit -m "fix(ui): o menu do + do chat e a contagem das não lidas"
```

---

### Task 11: A fumaça do Windows com a vista de verdade, e as regras que a prova deixou

**Files:**
- Modify: `tests/smoke/reuniao_fumaca.py` (o item 13 pela vista de verdade e as sondas), `tests/smoke/test_reuniao_fumaca.py` (os testes do julgamento, que rodam em qualquer máquina)
- Modify: `windows/app/src/WebViewHost.cpp`, `windows/app/src/WebPermissions.{h,cpp}` (as regras, conforme o que as sondas mostrarem), `tests/desktop/test_web_permissions.cpp`
- Modify: `tests/smoke/Test-UpdateFromRc7.ps1` (os argumentos do WebView2 pela política da máquina, como a fumaça)
- Modify: `docs/ponte-windows.md` ("Para o executável: o que a janela principal deixa")

**Interfaces:**
- Consumes: o que já está na fumaça (`tests/smoke/reuniao_local.py`: o chat local com o nome de sempre, o `company_with_meetings`, o `link_computer`, o `enter_person`, o `schedule_meeting`; o `reuniao_fumaca.py`: as aberturas, o `LOG_PREFIXES`, o julgamento das linhas); o registro do `starsonic:` (Task 1); a vista (Tasks 3 a 7); a seção 7 das entradas (o que a prova deixou).
- Produces: nenhuma interface nova para as outras tarefas.

**Como esta tarefa roda:** a fumaça só roda no job do Windows do `build` do GitHub. A cada commit desta tarefa, o implementador para e devolve ao controlador, que manda a branch e devolve o resultado do job (as linhas do diagnóstico que a fumaça imprime). Os testes de `tests/smoke/test_reuniao_fumaca.py` e de `tests/desktop` rodam aqui.

As regras (o que a fumaça passa a fazer e a conferir, na abertura principal do item 13, no WebView2 da máquina e no atualizado):

1. **A vista de verdade.** O app instalado, ligado ao chat local (o código da empresa no "Ligar ao chat" da interface, ou o comando da ponte que ele usa) e com a pessoa da vez, recebe a reunião pelo link: `os.startfile("starsonic://reuniao/<código>")` (o registro do instalador, a instância que roda, a mensagem `abrir`, a aba e o "Entrar"). A fumaça não põe mais o quadro na página ela mesma.
2. **Além do "Entrar".** Dentro do quadro, a fumaça clica no "Entrar" da página e confere até onde a máquina deixa (sem o servidor de vídeo, a página não entra na ligação: a fumaça confere o canal do colega aberto e o que a página mostra depois).
3. **O microfone** (o item 1 da 7.2): duas linhas novas no diagnóstico, só com o tipo e a origem (`permissao deixada (janela): <tipo> <origem>` quando a regra da janela deixa um pedido) e uma sonda: um quadro do próprio app, que não é de reunião, pede o microfone. Com o resultado na mão, o controlador escolhe uma das duas correções da 7.2 (o app deixar de guardar a permissão no perfil e responder a cada pedido; ou a regra da janela decidir pelo documento que pede) e a registra no ledger; a tarefa a constrói, com o teste em `tests/desktop/test_web_permissions.cpp` para a regra. **O fato que precisa ficar verdadeiro:** no WebView2 da máquina e no atualizado, o microfone do quadro da reunião passa pela regra (uma linha `(quadro)`), e o do quadro que não é de reunião é negado com uma linha.
4. **As mensagens de um quadro** (o item 4 da 7.2): o quadro da reunião chama o `window.chrome?.webview?.postMessage({ v: 1, cmd: 'quit' })`: o app continua aberto, e a ponte não age. Se a mensagem chegar ao tratador da janela, ele a ignora pela origem do documento que a mandou (o `Source` do evento), com a linha `mensagem ignorada (quadro)`.
5. **O quadro mexendo na janela** (o item 5 da 7.2): o `window.open`, a navegação da janela de cima (`top.location`) e o `requestFullscreen` de dentro do quadro. O app bloqueia as duas primeiras (as linhas de hoje: `janela nova bloqueada`, `navegacao bloqueada`), e a janela não vai para a tela cheia (a tela cheia da reunião é o botão do app).
6. **O "Copiar link"** dentro do WebView2: a fumaça clica no "Copiar link" de uma linha da aba e lê a área de transferência do Windows: o link da reunião.
7. **O `Test-UpdateFromRc7.ps1`** passa a entregar os argumentos do WebView2 pela política da máquina, como a fumaça (a 7.4 das entradas).
8. **O julgamento** (`test_reuniao_fumaca.py`) ganha os fatos novos: a linha `reunioes: link do app`, a navegação e as permissões do quadro da vista, as sondas 3 a 6, e nenhuma linha com o código, o passe ou o link.

- [ ] **Step 1: Escreva os testes que falham** (`tests/smoke/test_reuniao_fumaca.py`, na máquina daqui):

```python
def test_the_view_opening_needs_the_link_line_and_the_frame_lines(self): ...
def test_a_frame_message_acted_on_by_the_bridge_fails(self): ...
def test_the_window_rule_line_for_the_microphone_is_judged(self): ...
def test_the_copied_link_must_be_the_meeting_link(self): ...
def test_no_line_has_the_code_or_the_pass(self): ...      # o que já existe, com o link do app
```

- [ ] **Step 2: Rode e veja falhar** — Run: `python3 -m unittest -v tests/smoke/test_reuniao_fumaca.py`. Expected: FAIL nos novos.

- [ ] **Step 3: Implemente** as regras 1, 2, 4 a 8 e as linhas e a sonda da regra 3; commit; o controlador manda e devolve o resultado do job do Windows; com ele, a correção da regra 3 escolhida pelo controlador, com o teste de `tests/desktop`; outro commit e outra rodada.

- [ ] **Step 4: Rode e veja passar** — Run: `python3 -m unittest -v tests/smoke/test_reuniao_local.py tests/smoke/test_reuniao_fumaca.py` e o comando dos testes do C++ (o Step 2 da Task 1). Expected: PASS aqui, e o job do Windows verde nas duas rodadas da reunião (no WebView2 da máquina e no atualizado).

- [ ] **Step 5: Commit** (um por rodada; as mensagens dizem o que cada uma traz)

```bash
git add tests/smoke windows/app/src tests/desktop docs/ponte-windows.md
git commit -m "test(windows): a fumaça com a reunião dentro do app de verdade"
```

---

### Task 12: Os documentos, o roteiro e as notas da `0.5.0-rc.1`

**Files:**
- Modify: `docs/ponte-windows.md`, `docs/chat-protocolo.md`, `docs/chat-servidor.md`, `docs/teste-manual.md`
- Modify: `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md` (uma nota datada), `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md` (notas datadas)
- Create: `notas/v0.5.0-rc.1.txt`
- Test: as fotos (`windows/ui/tests/reunioes/*.spec.ts`, o `capturar` nos testes de tema das Tasks 3 a 7)

**Interfaces:**
- Consumes: o que as Tasks 1 a 11 construíram (cada frase conferida contra o código antes de ser escrita); o formato das notas (`notas/v0.4.0-rc.2.txt`: uma linha do que a versão traz e "Esta é uma versão de teste."); a seção 12.3 da spec (o roteiro).
- Produces: nenhuma interface.

O que entra:
- **`docs/ponte-windows.md`:** o link `starsonic://`, o `reuniaoLink`, a `sessao`, a `abrir` com a tela `reuniao`, o `escondida` com a reunião do app, e o que a Task 11 decidiu nas regras do quadro.
- **`docs/chat-protocolo.md`:** confira as seções 2, 9, 10 e 12 contra o que o app faz agora (o passe a todo `pronta`, os 15 s, os 2 s, os `aparelhos`, a pausa e o bloqueio repetidos) e acerte só o que mudou; o passo 5 de "A entrada de novo dentro do app" ganha a frase certa ("até ser desligada, no `aceito`").
- **`docs/chat-servidor.md`:** a ordem de instalar (o servidor do chat primeiro, o app depois) e a mesma frase do `aceito`.
- **`docs/teste-manual.md`:** a seção nova da 12.3 da spec, com uma linha por item (marcar e entrar; uma pessoa de fora no celular, aceita pelo app e pelo aviso; o "Abrir no navegador"; o "Abrir no app"; o tirar e o encerrar; a tela compartilhada de dentro do app; uma ligação no meio, recebida e feita; o "Telefone"; o fechar; dois colegas respondendo ao mesmo pedido; o WebView2 antigo, se houver um PC assim; o link numa conversa do chat); a linha 30.5 com o app `0.5.0`; as linhas 30.4, 30.6 e 30.7 com o "Abrir no navegador" no lugar do passe pedido à mão; a frase do `aceito` da 30.5.
- **A spec de 12/11:** uma nota datada dizendo o que a etapa 2a troca nela.
- **A spec de 23/11:** notas datadas de cada escolha deste plano que aparece na tela (as escolhas 1 a 16), nos lugares delas.
- **As fotos:** o `capturar(page, '<nome>', tema)` nos testes de tema das Tasks 3 a 7: `reunioes-vista`, `reunioes-nao-abriu`, `reunioes-telefone`, `reunioes-ligacao-chega`, `reunioes-fora`, `reunioes-espera`, `reunioes-fechar`. Quem conduz o plano monta com elas a imagem para o responsável comparar com o quadro (as telas 6, 7, 12, 13 e 14).
- **`notas/v0.5.0-rc.1.txt`:** uma linha do que a versão traz (as reuniões com link no app do PC: marcar, mandar o link, entrar pelo app ou pelo navegador, aceitar quem é de fora, e a reunião em pausa nas ligações), a ordem de instalar, e "Esta é uma versão de teste.".

- [ ] **Step 1: Escreva** os documentos e as notas; ponha o `capturar` nos testes de tema.

- [ ] **Step 2: Confira**

Run: `python3 build/check_source_text.py && git diff 2>/dev/null --stat && cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa; as 14 fotos (7 nomes × 2 temas) em `windows/ui/test-results/capturas/`; nenhuma linha aprovada das specs mudou (`git diff <base da tarefa> HEAD -- docs/superpowers/specs/` só mostra linhas a mais).

- [ ] **Step 3: Commit**

```bash
git add docs notas windows/ui/tests/reunioes
git commit -m "docs: a reunião dentro do app, o roteiro e as notas da 0.5.0-rc.1"
```
