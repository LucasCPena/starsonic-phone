# As reuniões no app do PC, etapa 2a — entrega 2, plano 3a: a aba Reuniões e a reunião no navegador — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um colega marca uma reunião no app, copia o link, cancela, e abre a reunião no navegador do PC já reconhecido; o aviso do Windows mostra quem quer entrar numa reunião aberta no navegador; e essa reunião entra em pausa numa ligação da central. A reunião dentro da janela do app é o plano seguinte (o 3b).

**Architecture:**
- **A interface do app** ganha a pasta `windows/ui/src/reunioes/`, pelo molde da `chat/`: os tipos, os textos, as contas puras, o cliente das reuniões e as telas. O cliente das reuniões não tem chave nem conexão própria: ele usa a sessão do `ChatCliente` (a pessoa da vez, os pedidos à API e os eventos, que chegam pelo mesmo WebSocket).
- **O núcleo em C++ não conhece reunião.** Ele ganha quatro comandos da ponte, uma mensagem e um campo do estado, tudo só na memória: abrir a reunião no navegador, o pedido que o aviso do canto mostra, a resposta do aviso e o clique fora dos botões.
- **O executável** monta o endereço do navegador a partir do endereço do chat que ele já traz, e passa a mostrar o aviso do canto também com um pedido de quem quer entrar.
- **O servidor do chat e a página da reunião não mudam:** as rotas, os eventos e a página são os da entrega 1 e do plano 2.

**Tech Stack:** o que o app já usa: TypeScript e Preact (`windows/ui`), com o `@playwright/test` 1.56.1; C++17 portátil (o núcleo e as regras do executável), com os testes de `tests/desktop` e `tests/win`; o Win32 do executável, que só compila no GitHub. Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`: as seções 4.2, 4.3 e 4.5 (o que é da aba, do navegador e do aviso), 7.6, 7.7 e 7.9, 8, 10, 11, 12 e 15, com as notas datadas. O protocolo é o `docs/chat-protocolo.md`, seções 9, 11 e 12. A ponte é o `docs/ponte-windows.md`. A lista de onde este plano saiu são as seções 2, 5, 8 e 9 do `reunioes-etapa-2-entrega-2-entradas.md` (no Project; a cópia de trabalho fica em `work/projeto/`, fora do git).

**Aprovado pelo responsável em 25/11/2026, às 08:49 ("segue"):** o plano, as escolhas da seção "As escolhas deste plano" e o método, o mesmo dos outros planos desta etapa: um agente novo constrói cada tarefa, e outro a revisa antes da próxima; no fim, uma revisão de tudo (superpowers:subagent-driven-development). Antes da Task 1 vem o acerto pequeno da página que ele aprovou na mesma resposta (`docs/superpowers/plans/2026-11-25-reunioes-etapa-2a-aviso-do-link-vencido.md`).

**Emenda de 25/11/2026, depois da aprovação (não muda o que o app faz):** a Task 1 ganhou um terceiro acerto de teste. O `build` do GitHub no commit `5d563c0`, só de documentos, falhou uma vez num teste de tela do chat: o "+" da lista clicado antes de o chat acabar de entrar. A causa e o acerto estão na Task 1; só arquivos de `windows/ui/tests` mudam. O detalhe do app que o teste mostrou (o menu do "+" aberto no primeiro instante fecha sozinho) fica como está, e vai ao responsável como um ponto pequeno, para o plano 3b.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-2`. Cada tarefa dá commit, por caminho. Quem envia ao GitHub é quem conduz o plano.
- **Os commits** são em português, com o assunto de até 72 caracteres, e terminam com a linha `Co-Authored-By:` do modelo que escreveu o commit e com a linha `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- **A versão do app não muda neste plano.** O `0.5.0`, as notas dele e o roteiro de testes do app são do plano 3b. Ninguém publica versão: quem publica é o responsável.
- **Só no Windows.** No modo iPhone, os comandos novos são recusados como os do chat (uma linha por comando, sem os campos), e a aba não existe.
- **Nada da reunião vai ao diagnóstico nem ao console:** o código, o link, o passe, o nome de quem pede para entrar, o assunto e o id do pedido. O diagnóstico leva só o nome do comando; numa recusa, o motivo sem o valor. No console, a regra é do que a página escreve: as linhas do próprio navegador para um pedido que falhou (`Failed to load resource`, com o endereço do pedido) não são do app, e os testes as deixam de fora, como o `errosDaPagina` do `tests/chat/ramal.spec.ts`.
- **O passe** sai da resposta do servidor direto para o comando `reuniaoNavegador`. Ele nunca fica num estado da interface, num atributo da tela, no `console` nem num endereço dentro do app.
- **O endereço do chat é o fixo de hoje:** o `ENDERECO_DO_CHAT` na interface e o `kChatOrigin` no executável. O app não ganha gancho de teste.
- **Os textos são os aprovados, letra por letra** (a spec, seção 11, e o quadro "Starsonic Phone — reuniões", telas 1 a 5 e 11). Todos ficam no `windows/ui/src/reunioes/textos.ts`:

  | Onde | Os textos |
  |---|---|
  | A aba | "Reuniões"; "As que você marcou"; "Nova reunião"; "Reunião sem assunto"; "Copiar link"; "Link copiado"; "Acontecendo · 1 pessoa"; "Acontecendo · N pessoas"; "Cole aqui o link de uma reunião"; "Abrir no navegador" |
  | A primeira vez | "Nenhuma reunião marcada"; "Marque uma no **Nova reunião** e mande o link para quem vai participar. Os colegas entram direto, e quem é de fora pede para entrar." |
  | O menu | "O link vale até hoje, 23:59"; "O link vale até amanhã, 23:59"; "O link vale até 26/11, 23:59"; "Abrir no navegador"; "Cancelar a reunião" |
  | A Nova reunião | "REUNIÕES"; "Nova reunião"; "Assunto"; "Opcional"; "Aparece no alto da reunião, para todos que entram."; "Dia"; "Hora"; "O link vale até"; "O fim do dia da reunião"; "Outro dia e hora"; "Hoje, às 23:59. Depois dessa hora, ninguém novo entra pelo link."; "Os colegas da empresa entram direto. Quem é de fora digita o nome e espera um colega aceitar."; "Criar a reunião"; "O link é copiado assim que a reunião é criada."; "O dia da reunião já passou."; "O link pode valer até 31 dias depois da reunião."; "Você já tem 100 reuniões marcadas. Cancele uma para marcar outra." |
  | O cancelar | "Cancelar a reunião?"; "O link para de valer na hora."; "Como a reunião está acontecendo, as N pessoas saem."; "Como a reunião está acontecendo, a pessoa que está nela sai."; "Voltar"; "Cancelar a reunião" |
  | Os erros da aba | "Este link não vale mais"; "Este não é um link de reunião do Starsonic."; "Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado."; "Muitas tentativas. Espere um pouco para tentar de novo."; "O servidor do chat não respondeu. Tente de novo."; "Sem conexão com o chat. As reuniões voltam quando a conexão voltar."; "O servidor do chat precisa ser atualizado para abrir reuniões pelo app." |
  | O aviso do Windows | "Starsonic Phone · Reuniões"; "<Nome> quer entrar"; "Recusar"; "Aceitar"; e, para o leitor de tela, "<Nome> quer entrar na reunião <assunto>" e "Fechar o aviso" |
  | Para o leitor de tela (os rótulos do quadro) | o campo do link: "Entrar com o link de uma reunião"; cada linha: "Planejamento de dezembro, hoje às 14:00, acontecendo agora com 3 pessoas", "Reunião com a contabilidade, amanhã às 09:30", "Reunião sem assunto, quinta-feira, 26 de novembro, às 16:00"; o botão do menu: "Mais opções de <assunto>"; o menu aberto: "Opções de <assunto>"; na Nova reunião: "Voltar para as reuniões" |
  | Avisos curtos | "A reunião está cheia: ninguém mais entra agora." (o texto da página) |
  | Na tela da ligação | "A reunião no navegador continua ouvindo você. Desligue o microfone lá." |

- **Os valores:**

  | O quê | Valor |
  |---|---|
  | O código de uma reunião | 10 caracteres de `abcdefghjkmnpqrstvwxyz23456789`, em minúsculas |
  | O passe | 43 caracteres de `[A-Za-z0-9_-]` |
  | O id de um pedido | 16 caracteres hexadecimais, em minúsculas |
  | A lista das reuniões | lida de novo a cada 30 s com a aba à vista |
  | A aba escondida pelo `semReunioes` | o app pergunta de novo a cada 5 minutos e a cada conexão dos eventos |
  | O "Link copiado" | 2 s |
  | O assunto | até 120 caracteres |
  | Até quando o link vale | no máximo 31 dias depois do início |
  | A pausa do navegador | repetida a cada 10 s enquanto a ligação dura |
  | A conferência de uma reunião aberta no navegador | o `participantes`, a cada 10 s, e a cada volta da conexão dos eventos |
  | A dúvida depois de um reinício do chat | acaba em 12 horas, ou quando o link vence |
  | O `vez` de uma pausa | 12 caracteres de `[A-Za-z0-9]`, sorteados a cada pausa |

- **A acessibilidade segue as regras de hoje:** nenhuma violação séria do axe, nos temas claro e escuro; tudo pelo teclado; os três tamanhos da janela (Normal, Compacto e Mínimo), com seis abas.
- **Todo teste que dirige o relógio o pausa antes** (o `pararORelogio` do `tests/chat/abrir.ts`, a Task 1 diz por quê). A hora da página vem do `page.clock.setFixedTime` (a hora fica parada, e os timers andam com o `runFor`) ou, quando a hora tem de andar, do `page.clock.install({ time })`.
- **O relógio da página não é o de quem roda os testes:** o `playwright.config.ts` fixa o fuso da página em `America/Sao_Paulo` (sempre −03:00), e o Node dos testes pode estar em outro. Um teste de tela monta as horas pelo `noRelogioDaPagina` do `tests/reunioes/abrir.ts` (Task 7), e nunca pelo `new Date(ano, mês, dia…)` do Node.
- **O que não muda:** o `chat-servidor/`, o `video-servidor/`, o `android/` e a página da reunião. O que o modo iPhone do app faz também não muda.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados de sempre (a Recepção, a Ana Souza, a Maria Lima, o Planejamento de dezembro).

## Review Focus

O que a spec pede e os testes das tarefas poderiam deixar passar, do mais provável ao menos. Cada linha tem o teste que a prende:

1. **O passe, o código ou um nome no diagnóstico, no console ou na tela.** *(Task 2: "nothing of the meeting is ever logged". Task 10: "o passe não aparece no console, na tela nem em outro comando". Task 11: "nada do pedido vai ao console".)*
2. **Uma pessoa agindo como outra depois da troca de conta:** o passe pedido como a pessoa A e usado depois da troca; o "Aceitar" do aviso respondido como a pessoa B; a lista da A à vista da B. *(Task 7: "a troca de pessoa esquece a lista". Task 10: "a troca de pessoa no meio do pedido não abre nada". Task 11: "a troca de conta limpa o aviso, e a resposta que chega depois não sai".)*
3. **A pausa que não chega, sem ninguém avisar:** a ligação que começa antes de a página do navegador entrar; o `409` tomado por definitivo; o chat que reiniciou com a reunião aberta no navegador. E o contrário: o aviso que aparece sem precisar, para quem só saiu da reunião, ficou sem rede ou fechou o notebook. *(Task 12: "a pausa vai na hora em que um evento mostra que o computador entrou", "o 409 não é para sempre", "depois de um reinício do chat, a tela da ligação avisa…" e "quem saiu da reunião, ou ficou sem rede, não deixa dúvida".)*
4. **O aviso do pedido que não some, ou que toma o lugar de uma ligação tocando.** O servidor não avisa o computador que saiu da reunião: sem a conferência, o pedido ficaria no canto da tela depois de a pessoa sair. *(Task 3: "a ringing call still shows as before". Task 4: "a ligação tocando toma o aviso". Task 11: "o pedido respondido por outro colega sai do aviso", "a reunião que acabou limpa o aviso" e "o pedido sai do aviso quando o computador sai da reunião, que o servidor não avisa".)*
5. **O relógio do PC, que não é o do servidor nem o de quem roda os testes:** "Hoje" e "Amanhã" na virada do dia, do mês e do ano, e o `valeAte` do fim do dia. *(Task 6: "o dia vira pelo calendário, e não por 24 horas". Task 7: "à meia-noite, o Amanhã vira Hoje sem recarregar". Task 8: "o valeAte mandado é o fim do dia no relógio do PC".)*

## A máquina de desenvolvimento

- O `go` pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1` (os testes da interface sobem o chat com ele). O Playwright pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`. Nunca rode `playwright install`.
- Ela tem 2 processadores. O que é pesado (o Playwright, uma compilação inteira do `tests/desktop`) entra na fila da máquina, num comando só, escrito exatamente assim; se a checagem do ambiente negar um pedaço, pare e conte:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- **Os comandos das provas:**

  | A prova | O comando | Hoje |
  |---|---|---|
  | O C++ portátil | `cmake -S tests/desktop -B work/build-desktop -DCMAKE_BUILD_TYPE=Release && cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests` | 500 casos (510 depois da Task 3, que traz para cá os 10 do `tests/win/test_shell_state.cpp`) |
  | Um caso só do C++ | `work/build-desktop/desktop_tests -tc="*meeting*"` | — |
  | Os tipos da interface | `cd windows/ui && npm run typecheck` | sem erro |
  | A interface | `cd windows/ui && npm run build && npx playwright test` | 1413 testes hoje (1414 depois da Task 1), uns 9 minutos |
  | Um arquivo da interface | `cd windows/ui && npm run build && npx playwright test tests/reunioes/<arquivo>` | — |
  | Os textos do código | `python3 build/check_source_text.py` | `ok` |
  | O Windows | o workflow `build` do GitHub, depois do push de quem conduz | verde no `4bca909` (na segunda tentativa) |

- **Antes de dar o commit, cada tarefa roda todas as provas que os arquivos dela tocam,** e não só o teste novo. As tarefas da interface rodam a suíte inteira da interface.
- **O navegador daqui é o Chrome 153, e o do GitHub, o Chromium 141.** Um teste de tela tem de passar nos dois.
- **Sem servidor de vídeo nos testes da interface.** O chat de teste cria, lista e cancela reuniões e dá o passe, mas ninguém consegue "estar na reunião". Por isso os eventos das reuniões (a seção 11 do protocolo) são injetados pelo `page.routeWebSocket`, entre a página e o chat de verdade (o molde é o `tests/chat/sem-conexao.spec.ts`), e as rotas `participantes`, `aceitar`, `recusar` e `pausa` são respondidas pelo `page.route` (o `comEventos` da Task 11 responde ao `participantes` com as listas do último evento mandado). Conferido em 24/11 com uma sonda, apagada depois: o chat de teste cria uma reunião (também com o início no passado), lista, cancela e dá o passe, que o abrir da página aceita; recusa um Tab no assunto (`400 invalido`, com o `campo` `assunto`); e responde `409 foraDaReuniao` ao `participantes`, ao `aceitar` e à `pausa`. O `chat/api.ts` carrega no Node.
- **As specs de tela das reuniões usam o `test.use({ bypassCSP: true })`,** como as do chat: a regra de segurança da página só deixa o endereço do chat de verdade.

## As escolhas deste plano

O que a spec deixa para quem constrói e este plano decide. O responsável as confere ao ler. **As catorze primeiras aparecem na tela.**

1. **Nesta metade, a lista ainda não tem o "Entrar".** Ele abre a reunião dentro da janela do app, que é o plano 3b. Até lá, cada linha tem o "Copiar link" e o menu, e o campo do link tem só o "Abrir no navegador". Nada é publicado entre as duas metades.
2. **No tamanho Mínimo da janela, o "Copiar link" vai para o menu** (a spec deixa, seção 16).
3. **A Nova reunião abre com o dia de hoje e a próxima meia hora cheia** (às 14:07, "14:30").
4. **O dia na lista:** "Hoje", "Amanhã", "Ontem" (uma reunião de ontem cujo link ainda vale), ou o dia da semana com a data ("Qui, 26/11, 16:00"); num outro ano, a data leva o ano ("Sex, 26/11/2027, 16:00").
5. **Depois de criar, a linha nova mostra "Link copiado" por 2 s,** como o botão.
6. **O aviso do Windows de um pedido aparece também com a janela do app na frente,** quando a reunião está aberta no navegador (o app não vê a reunião do navegador). O clique fora dos botões traz o app para a frente, na aba Reuniões.
7. **A segunda linha do aviso** é o assunto, ou "Reunião sem assunto". Quando o app não sabe o assunto (ele foi reaberto com a reunião do navegador em andamento, e ela é de outro colega), a linha não aparece. **O "×" do aviso** (o "Fechar o aviso" do quadro) tira aquele pedido do aviso do Windows sem responder: ele continua no painel da página.
8. **A aba Reuniões aparece depois que o chat responde que a empresa tem as reuniões liberadas.** Ao abrir o app sem conexão, ela aparece quando a conexão volta. Depois de aparecer, ela fica (uma queda mostra a frase da falta de conexão), até o chat dizer que a empresa não tem mais as reuniões.
9. **Depois de o servidor do chat reiniciar, a pausa não alcança a reunião aberta no navegador:** a página "deixa de cuidar" da reunião e continua na ligação. O app sabe que o chat reiniciou porque o servidor avisa antes de desligar. Se, na volta, o chat não conhece mais o computador numa reunião em que ele estava, o app fica na dúvida (a pessoa também pode ter saído bem nessa hora), e as ligações seguintes mostram, na tela da ligação, "A reunião no navegador continua ouvindo você. Desligue o microfone lá.", até o app ver o computador de novo naquela reunião, o link dela vencer ou passarem 12 horas. O custo: quem saiu da reunião bem na hora do reinício vê a frase sem precisar, por até 12 horas. O que fica de fora: o servidor que cai sem avisar (a máquina desligada à força); aí, como hoje, a reunião do navegador ouve a ligação. Uma queda da rede, ou o PC que dormiu, não deixa dúvida nenhuma.
10. **O "Aceitar" do aviso com a reunião cheia** mostra o aviso curto "A reunião está cheia: ninguém mais entra agora." (o texto da página), e aquele pedido sai do aviso do Windows; ele continua no painel da página.
11. **"O link pode valer até 31 dias depois da reunião."** vale também quando o "Outro dia e hora" escolhido é antes da reunião, ou já passou: a spec só tem essa frase para a validade.
12. **Fora do chat pronto** (sem a conta conectada, entrando, ou com o computador fora do chat), a aba mostra a mesma frase da falta de conexão: "Sem conexão com o chat. As reuniões voltam quando a conexão voltar.".
13. **A frase na tela da ligação** ("A reunião no navegador continua ouvindo você…") aparece enquanto a ligação dura e a última tentativa de pausar uma reunião em que o computador está falhou (sem rede, ou com o servidor do chat fora do ar), e na dúvida da escolha 9.
14. **O "Abrir no navegador" funciona também com uma ligação em andamento.** A reunião do navegador entra em pausa assim que a pessoa entra nela (a página mostra "Você está numa ligação no Starsonic Phone…"). O "desligue antes" da spec (4.3) é da reunião dentro do app, do plano 3b.
15. **Copiar o link é da página do app** (o `navigator.clipboard.writeText`), e não um comando novo do executável. Se a cópia falhar, o botão não muda para "Link copiado", e a pessoa clica de novo. O que só o Windows responde (a cópia dentro do WebView2 de verdade) entra na fumaça do plano 3b.
16. **Os nomes novos da ponte** (a seção seguinte): a spec os deixa para quem constrói.
17. **Uma resposta do aviso só vale para o pedido que ele mostra:** uma resposta atrasada, de um pedido que já saiu, é ignorada.
18. **O servidor não avisa o computador que saiu da reunião** (os eventos vão só a quem ficou nela). Por isso o app confere, a cada 10 s, cada reunião aberta no navegador em que o computador está (o `participantes`): o pedido que ficou no aviso do Windows sai em até 10 s depois de a pessoa sair da reunião, e o app fica sabendo que ela saiu.
19. **O app fechado e aberto de novo com a reunião aberta no navegador** só volta a cuidar dela (o aviso e a pausa) quando algo muda nela (alguém entra, sai ou pede para entrar). É o que a spec diz (7.9): o app não guarda no disco as reuniões que abriu.
20. **Os dois testes do app que falharam uma vez no GitHub em 24/11** são acertados na Task 1, antes de qualquer teste novo (a seção 5 das entradas tem a causa de cada um). O terceiro teste intermitente de lá (a contagem das não lidas na lista do chat) pode ser do app, e não do teste: fica para o plano 3b, antes do `0.5.0`. Um quarto teste intermitente, achado em 25/11 depois da aprovação (o "+" da lista do chat clicado antes de o chat entrar), é acertado na mesma Task 1, só nos testes.
21. **O que fica para o plano 3b:** o "Entrar" e a reunião dentro da janela do app, com o que a prova no WebView2 deixou para decidir (a seção 7.2 das entradas); o `starsonic://` e o instalador; o link de reunião numa conversa do chat; as faixas, o cartão da ligação e o "Telefone"; o aviso com a reunião do app escondida; a fumaça do Windows com a aba; a versão `0.5.0`, o roteiro de testes e as notas.

## Os nomes novos da ponte

Valem para todas as tarefas. O `docs/ponte-windows.md` os ganha na Task 13.

**Da interface para o núcleo** (só no Windows; o `v: 1` é da ponte):

```json
{"cmd": "reuniaoNavegador", "codigo": "k7q49xwpht", "passe": "<43 caracteres>"}   // o passe é opcional
{"cmd": "reuniaoPedido", "pedido": {"id": "8899aabbccddeeff", "nome": "Maria Lima", "assunto": "Planejamento de dezembro"}, "escondida": true}
{"cmd": "reuniaoPedido"}                                                            // nenhum pedido para mostrar
{"cmd": "reuniaoResposta", "pedido": "8899aabbccddeeff", "resposta": "aceitar"}   // da página do aviso: "aceitar", "recusar" ou "fechar"
{"cmd": "reuniaoMostrar"}                                                           // o clique fora dos botões do aviso
```

- O `nome` tem de 1 a 120 caracteres, sem caracteres de controle. O `assunto` é um texto de 0 a 120 caracteres, sem caracteres de controle, ou `null`: o texto é o assunto da reunião; o vazio quer dizer que ela não tem assunto (o aviso mostra "Reunião sem assunto"); o `null`, que o app não sabe (o aviso fica sem a segunda linha).
- O `escondida` é obrigatório com o `pedido`. Neste plano ele vai sempre verdadeiro (a reunião está no navegador); o plano 3b o usa com a reunião do app.

**Do núcleo para a interface:**

```json
{"v": 1, "type": "reuniaoResposta", "pedido": "8899aabbccddeeff", "resposta": "aceitar"}
{"v": 1, "type": "abrir", "tela": "reunioes"}
```

**No estado,** só enquanto há um pedido para mostrar:

```json
"reuniao": {"pedido": {"id": "8899aabbccddeeff", "nome": "Maria Lima", "assunto": "Planejamento de dezembro"}, "escondida": true}
```

**No diagnóstico:** `reunioes: reuniaoNavegador`, `reunioes: reuniaoPedido`, `reunioes: reuniaoResposta`, `reunioes: reuniaoResposta ignorada (outro pedido)` e `reunioes: reuniaoMostrar`. Nunca um campo.

## Os arquivos

| Arquivo | O que é dele |
|---|---|
| `starsonic/desktop/Reunioes.{h,cpp}` (novo) | Os formatos: o código, o passe e o id de um pedido |
| `starsonic/desktop/Protocol.{h,cpp}`, `DesktopApp.{h,cpp}` | Os quatro comandos, a mensagem, o gancho `openMeeting` e o `reuniao` do estado |
| `windows/app/src/MeetingLinks.{h,cpp}` (novo) | O endereço do navegador de uma reunião |
| `windows/app/src/ShellState.{h,cpp}`, `MainWindow.cpp`, `main.cpp` | O aviso do canto com um pedido, o clique que traz a janela e o gancho |
| `windows/ui/src/reunioes/tipos.ts` (novo) | A `Reuniao`, o `Pedido`, o `Participante` e os eventos |
| `windows/ui/src/reunioes/textos.ts` (novo) | Todos os textos deste plano |
| `windows/ui/src/reunioes/formato.ts` (novo) | As contas puras: o dia e a hora, a validade, o código de um texto colado, a Nova reunião |
| `windows/ui/src/reunioes/pausa.ts` (novo) | A regra de quando uma ligação pausa a reunião |
| `windows/ui/src/reunioes/cliente.ts` (novo) | O cliente das reuniões: a lista, criar, cancelar, copiar, o navegador, os pedidos e a pausa |
| `windows/ui/src/reunioes/usarReunioes.ts` (novo) | O gancho do Preact para a vista do cliente |
| `windows/ui/src/reunioes/telas/{Aba,Nova,Cancelar}.tsx` (novos) | As telas 1 a 5 |
| `windows/ui/src/chat/{api,tipos,eventos,cliente}.ts` | As rotas das reuniões, os eventos e a sessão para o cliente das reuniões |
| `windows/ui/src/{state,types,main,aviso,fake,fake-scenarios,icons}.ts(x)`, `components/Nav.tsx`, `screens/Ligacao.tsx`, `app.css` | A ponte, a sexta aba, o aviso com um pedido, a frase na ligação |
| `windows/ui/tests/reunioes/*.spec.ts` e `tests/reunioes/abrir.ts` (novos), `tests/chat/servidor.ts` | Os testes deste plano, os ajudantes deles e o que libera as reuniões da empresa |
| `tests/desktop/test_reunioes.cpp`, `tests/win/test_meeting_links.cpp` (novos), `tests/desktop/CMakeLists.txt` | Os testes portáteis; a regra do aviso (`tests/win/test_shell_state.cpp`) passa a rodar também fora do Windows |

---

### Task 1: Os testes do app que dirigem o relógio o pausam antes, o teste da planilha espera o eco, e o "+" do chat espera o chat entrar

Três testes de tela do app falharam uma vez cada no GitHub, em commits que não mexem no app: dois em 24/11/2026 e um em 25/11. As causas (as duas primeiras estão na seção 5 das entradas):

- **O relógio de mentira do Playwright `1.56.1`, com o tempo correndo, pode voltar para trás.** Depois do `page.clock.install()`, o tique de tempo real do próprio Playwright roda ao mesmo tempo que o `runFor` do teste, e cada rodada termina pondo o relógio na hora-alvo dela, sem conferir se isso é voltar (o `_runTo` e o `_advanceNow` do `node_modules/playwright-core/lib/generated/clockSource.js`). Um timer de 1,5 s armado depois de um `runFor(20000)` fica a 20 s de distância. Reproduzido fora do repositório: 202 de 300 rodadas com o relógio correndo, nenhuma de 200 com ele pausado antes.
- **O teste da planilha da empresa digita dentro da janela do eco de um Salvar:** o `fill('')` seleciona o texto e aperta Delete em dois passos, e o eco do Salvar anterior (entregue por um `setTimeout(0)` e aplicado num `useEffect`) reescreve o campo entre os dois.
- **A lista do chat é recriada quando o chat acaba de entrar, e um menu do "+" aberto antes disso fecha** (achado em 25/11, depois de o plano aprovado). O `windows/ui/src/main.tsx` desenha a lista com `key={vistaChat.eu?.id ?? 0}`: a chave vai de 0 para o id da pessoa quando o entrar termina, e o `useState` do menu, que mora no `src/chat/telas/Lista.tsx`, se perde. O "+" é o único controle da lista que já existe com o chat entrando. No `tests/chat/fotos.spec.ts` ("chat-nova-conversa", em 400×720, no escuro), o clique no "+" saiu 38 ms depois do `body[data-pronto]`, e o item "Nova conversa" não veio em 60 s. Lido no rastro e no código, não reproduzido. O acerto é dos testes: eles esperam o chat entrar antes de clicar no "+". O app fica como está (mudar o que a tela mostra é do responsável; o plano 3b leva a pergunta).

**Files:**
- Modify: `windows/ui/tests/chat/lista.spec.ts` (os três testes que chamam o `page.clock.install()`; o teste novo do `chatDentro`; os cliques no "+")
- Modify: `windows/ui/tests/chat/admin.spec.ts` (o teste que chama o `page.clock.install()`)
- Modify: `windows/ui/tests/chat/conversa.spec.ts` (o teste que instala o relógio e não chama o `pararORelogio`)
- Modify: `windows/ui/tests/contatos.spec.ts` (o teste "the company sheet field saves the link")
- Modify: `windows/ui/tests/chat/abrir.ts` (o `chatDentro` e o `abrirOMais`, novos)
- Modify: `windows/ui/tests/chat/fotos.spec.ts`, `windows/ui/tests/chat/grupo.spec.ts`, `windows/ui/tests/chat/nova-conversa.spec.ts`, `windows/ui/tests/chat/ponta-a-ponta.spec.ts` (os cliques no "+" da lista do chat)

**Interfaces:**
- Consumes: o `pararORelogio(page)` do `tests/chat/abrir.ts` (o `page.clock.pauseAt` um segundo adiante) e o `depoisDoQueChegou(page)` do `tests/helpers.ts`.
- Produces: duas regras para todas as tarefas seguintes. Um teste que usa o `page.clock` chama o `pararORelogio(page)` depois de a página carregar e antes do primeiro `runFor` ou `fastForward`. E um teste abre o menu do "+" da lista do chat pelo `abrirOMais(page)`. No `tests/chat/abrir.ts`: `chatDentro(page: Page): Promise<void>` e `abrirOMais(page: Page): Promise<void>`.

Nenhum arquivo de `windows/ui/src` muda nesta tarefa.

- [ ] **Step 1: Ache os testes expostos**

Run: `cd windows/ui && grep -n "clock\.install\|pararORelogio(\|clock\.pauseAt\|clock\.runFor\|clock\.fastForward" tests/chat/lista.spec.ts tests/chat/admin.spec.ts tests/chat/conversa.spec.ts`
Expected: em cada teste desses três arquivos com um `clock.install` e um `runFor`, veja se há um `pararORelogio` ou um `pauseAt` antes do primeiro `runFor`. Os que não têm são os desta tarefa (cinco, na contagem de 24/11).

- [ ] **Step 2: Pause o relógio em cada um**

Em cada teste achado: `await pararORelogio(page);` depois de a página carregar e de o que o teste espera antes do tempo andar (o primeiro pedido preso, a lista na tela), e antes do primeiro `runFor`. Com o relógio pausado, nada que depende de um timer anda sozinho (as entregas da ponte falsa, os efeitos do Preact, os prazos da API): onde o teste contava com isso entre dois `runFor`, acrescente o `runFor` que falta, como fazem os vizinhos que já pausam (`tests/chat/sem-conexao.spec.ts`). As conferências do teste não mudam.

- [ ] **Step 3: O teste da planilha espera o eco de cada Salvar**

No `tests/contatos.spec.ts`, em "the company sheet field saves the link": depois de cada `esperarComando(page, { cmd: 'setCompanyList', … })` que é seguido de outro `fill`, chame `await depoisDoQueChegou(page);`. As conferências não mudam.

- [ ] **Step 4: Escreva o teste do `chatDentro` e veja falhar**

No `tests/chat/lista.spec.ts`, ao lado de "a request with no answer gives up after 20 s and tries again" (o mesmo jeito de segurar o entrar), com o `chatDentro` e o `abrirOMais` importados do `./abrir`:

```ts
test('chatDentro waits for the chat to finish entering, and then the + menu stays open', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  // O entrar fica preso: o chat está entrando, e o "+" já está na tela.
  const presos: Route[] = [];
  await page.route(`${baseDoChat()}/api/v1/pessoas/eu`, (rota) => {
    presos.push(rota);
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect.poll(() => presos.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Nova conversa ou novo grupo' })).toBeVisible();

  let dentro = false;
  const espera = chatDentro(page).then(() => {
    dentro = true;
  });
  await depoisDoQueChegou(page);
  expect(dentro).toBe(false);

  await presos[0].continue();
  await espera;
  await expect(page.getByRole('heading', { name: 'Nenhuma conversa ainda' })).toBeVisible();
  // Com o chat dentro, a lista não é mais recriada: o menu aberto fica aberto.
  await abrirOMais(page);
  await depoisDoQueChegou(page);
  await expect(page.getByRole('menu', { name: 'Nova conversa ou novo grupo' }).getByRole('menuitem')).toHaveCount(2);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
```

Run: `cd windows/ui && npm run build && npx playwright test tests/chat/lista.spec.ts -g "chatDentro"`
Expected: FAIL (o `chatDentro` e o `abrirOMais` não existem no `abrir.ts`).

- [ ] **Step 5: Os dois ajudantes, e os cliques no "+" por eles**

No `tests/chat/abrir.ts`:

- `export async function chatDentro(page: Page): Promise<void>`: espera à vista o título "Nenhuma conversa ainda" ou a busca "Procurar conversa" (um `locator.or`). Um dos dois só existe com o chat dentro (a situação `pronto` do `src/chat/telas/Lista.tsx`).
- `export async function abrirOMais(page: Page): Promise<void>`: o `chatDentro` e o clique no botão "Nova conversa ou novo grupo".

O comentário de cada um diz por quê (a lista é recriada quando o chat entra, e o menu aberto antes fecha).

Os cliques no "+" passam pelo `abrirOMais`: o `peloMais` do `fotos.spec.ts`, o `irParaONovoGrupo` do `grupo.spec.ts`, o `irParaANovaConversa` do `nova-conversa.spec.ts` e os cliques diretos (`grep -n "Nova conversa ou novo grupo' })" tests/chat/*.spec.ts`: no `lista.spec.ts`, no `ponta-a-ponta.spec.ts` e no `fotos.spec.ts`). No teste do `lista.spec.ts` que confere o `aria-expanded` do "+" antes de clicar, o `chatDentro(page)` vem antes dessa conferência, e o clique continua sendo o do teste. As conferências dos testes não mudam.

Run: `cd windows/ui && npx playwright test tests/chat/lista.spec.ts -g "chatDentro"`
Expected: PASS.

- [ ] **Step 6: Rode os arquivos mexidos quinze vezes cada**

Run: `cd windows/ui && npm run build && npx playwright test tests/chat/lista.spec.ts tests/chat/admin.spec.ts tests/chat/conversa.spec.ts tests/contatos.spec.ts tests/chat/grupo.spec.ts tests/chat/nova-conversa.spec.ts tests/chat/ponta-a-ponta.spec.ts --repeat-each=15`
Expected: todos passam, nas quinze vezes.

Run: `cd windows/ui && npx playwright test tests/chat/fotos.spec.ts -g "chat-vazio-menu|chat-nova-conversa|chat-novo-grupo" --repeat-each=15`
Expected: todos passam, nas quinze vezes (as três telas do livro de fotos que abrem o "+").

- [ ] **Step 7: Rode a suíte inteira da interface e dê o commit**

Run: `cd windows/ui && npm run typecheck && npx playwright test`
Expected: 1414 passam (os 1413 de antes e o teste do `chatDentro`).

```bash
git add windows/ui/tests/chat/lista.spec.ts windows/ui/tests/chat/admin.spec.ts windows/ui/tests/chat/conversa.spec.ts windows/ui/tests/contatos.spec.ts windows/ui/tests/chat/abrir.ts windows/ui/tests/chat/fotos.spec.ts windows/ui/tests/chat/grupo.spec.ts windows/ui/tests/chat/nova-conversa.spec.ts windows/ui/tests/chat/ponta-a-ponta.spec.ts
git commit -m "test(ui): relógio pausado, eco do Salvar e o \"+\" com o chat dentro"
```

---

### Task 2: O núcleo: os quatro comandos das reuniões, a mensagem da resposta e o pedido no estado

**Files:**
- Create: `starsonic/desktop/Reunioes.h`, `starsonic/desktop/Reunioes.cpp`
- Modify: `starsonic/desktop/Protocol.h`, `starsonic/desktop/Protocol.cpp` (o `CommandKind`, a tabela dos nomes, o `ParseCommand`, as mensagens, e o `reuniao` do `BridgeState` e do `StateMessage`)
- Modify: `starsonic/desktop/DesktopApp.h`, `starsonic/desktop/DesktopApp.cpp` (o gancho, o `PlatformOf`, os quatro `case`, o `reuniao` do `BuildState`)
- Modify: `tests/desktop/desktop_fixture.h` (o gancho novo no `Harness`)
- Test: `tests/desktop/test_reunioes.cpp` (novo), `tests/desktop/test_protocol.cpp`, `tests/desktop/test_iphone_mode.cpp`

**Interfaces:**
- Consumes: os moldes do chat: os `case CommandKind::Chat…` do `Protocol.cpp` e do `DesktopApp.cpp`, o `ChatFields`, o `OpenChatMessage`, e os testes "chatNotify goes to the hook…" (`test_desktop_app.cpp`), `Parsed`/`RefusalOf` (`test_protocol.cpp`) e a tabela dos comandos do chat recusados no iPhone (`test_iphone_mode.cpp`, em "the iPhone state has no chat and the chat commands are refused"). As duas regras de todo comando do PC, no começo do `DesktopApp::Execute`: depois do Sair, a linha `comando ignorado depois do Sair: <comando>`; no modo iPhone, `comando recusado no modo iPhone: <comando>`.
- Produces (os nomes são os da seção "Os nomes novos da ponte"):

```cpp
// starsonic/desktop/Reunioes.h
bool ValidMeetingCode(const std::string& code);        // 10 caracteres de "abcdefghjkmnpqrstvwxyz23456789"
bool ValidMeetingPass(const std::string& pass);        // 43 caracteres de [A-Za-z0-9_-]
bool ValidMeetingRequestId(const std::string& id);     // 16 caracteres de [0-9a-f]

// starsonic/desktop/Protocol.h
enum class CommandKind { /* … */ MeetingBrowser, MeetingRequest, MeetingAnswer, MeetingShow };
struct MeetingFields {
    std::string code;            // reuniaoNavegador: codigo
    std::string pass;            // reuniaoNavegador: passe ("" sem ele)
    bool hasRequest = false;     // reuniaoPedido: veio o pedido
    std::string requestId;       // reuniaoPedido: pedido.id; reuniaoResposta: pedido
    std::string requestName;     // reuniaoPedido: pedido.nome (1 a 120 caracteres, sem controle)
    std::optional<std::string> requestSubject;   // reuniaoPedido: pedido.assunto (0 a 120 caracteres, sem controle), ou null
    bool hidden = false;         // reuniaoPedido: escondida
    std::string answer;          // reuniaoResposta: resposta ("aceitar", "recusar" ou "fechar")
};
// Command ganha: MeetingFields meeting;
std::string MeetingAnswerMessage(const std::string& requestId, const std::string& answer);   // {"v":1,"type":"reuniaoResposta",…}
std::string OpenMeetingsMessage();                                             // {"v":1,"type":"abrir","tela":"reunioes"}

// starsonic/desktop/DesktopApp.h, no DesktopHooks
// Abre a reuniao no navegador padrao (reuniaoNavegador). pass: "" sem o passe. Nunca espera.
std::function<void(const std::string& code, const std::string& pass)> openMeeting;
```

O que o núcleo faz com cada comando (depois do Sair e no modo iPhone, nada: os quatro entram no `PlatformOf` como do Windows):

| Comando | O que faz | A linha |
|---|---|---|
| `reuniaoNavegador` | chama o `hooks.openMeeting(code, pass)` | `reunioes: reuniaoNavegador` |
| `reuniaoPedido` com o `pedido` | guarda o pedido (o id, o nome, o assunto, o `escondida`) só na memória e publica o estado, se mudou | `reunioes: reuniaoPedido` |
| `reuniaoPedido` sem o `pedido` | esquece o pedido e publica o estado, se mudou | `reunioes: reuniaoPedido` |
| `reuniaoResposta` do pedido guardado | manda o `MeetingAnswerMessage`, esquece o pedido e publica o estado | `reunioes: reuniaoResposta` |
| `reuniaoResposta` de outro pedido, ou sem pedido guardado | nada | `reunioes: reuniaoResposta ignorada (outro pedido)` |
| `reuniaoMostrar` | manda o `OpenMeetingsMessage` | `reunioes: reuniaoMostrar` |

O Não perturbe não muda nada aqui (a spec, 4.5). O estado só leva o `reuniao` com um pedido guardado.

**O `ready` da janela principal esquece o pedido guardado,** antes de publicar o estado: a interface que recarregou não o conhece mais, e o aviso ficaria no canto da tela sem ninguém para tirá-lo (o molde é o teste da câmera, no `case CommandKind::Ready`). O `ready` da página do aviso não mexe nele.

- [ ] **Step 1: Escreva os testes que falham**

`tests/desktop/test_protocol.cpp`:

```cpp
TEST_CASE("the meeting commands are read with their fields") {
    // reuniaoNavegador com e sem o passe; reuniaoPedido com o pedido (o nome com acento; o assunto com texto, vazio e
    // null) e sem ele; reuniaoResposta com as tres respostas; reuniaoMostrar. Em cada um: o kind, o CommandName e cada
    // campo do MeetingFields.
}
TEST_CASE("the meeting commands with bad fields are refused without the values") {
    // O codigo de 9 e de 11 caracteres, em maiusculas, com "i", "l", "o", "u", "0" ou "1": "reuniaoNavegador: codigo invalido".
    // O passe de 42 caracteres, ou com "+": "reuniaoNavegador: passe invalido".
    // O pedido que nao e objeto; o id de 15 caracteres, ou em maiusculas; o nome vazio, de 121 caracteres ou com um
    // "\n"; o assunto de 121 caracteres, ou um numero: "reuniaoPedido: pedido invalido". O pedido sem o escondida, e o
    // escondida que nao e booleano: recusados. O reuniaoResposta sem a resposta, com outra palavra ("sim"), ou com o
    // pedido que nao e um id: recusados.
    // Em TODAS as recusas: o texto nao contem nenhum dos valores mandados.
}
```

`tests/desktop/test_reunioes.cpp` (os valores são os inventados: o código `k7q49xwpht`, o passe `Passe_de-teste-inventado-0123456789-ABCDxyz`, o id `8899aabbccddeeff`, "Maria Lima", "Planejamento de dezembro"):

```cpp
TEST_CASE("the meeting formats are checked") { /* ValidMeetingCode, ValidMeetingPass, ValidMeetingRequestId: os bons e os ruins */ }
TEST_CASE("reuniaoNavegador goes to the hook with the code and the pass") {
    // h.host == {"openMeeting k7q49xwpht <passe>"}; sem o passe: {"openMeeting k7q49xwpht "}; h.Logged("reunioes: reuniaoNavegador").
}
TEST_CASE("the request goes to the state and leaves it") {
    // Com o pedido: o ultimo estado tem state["reuniao"] == {"pedido": {"id","nome","assunto"}, "escondida": true}
    // (o assunto null continua null no estado).
    // O mesmo pedido de novo: nenhum estado novo. Sem o pedido: o estado seguinte nao tem a chave "reuniao".
}
TEST_CASE("the answer of the notice reaches the interface only for the request on show") {
    // h.SendFromNotice(resposta do pedido guardado): uma mensagem {"type":"reuniaoResposta","pedido":…,"resposta":"aceitar"},
    // e o estado seguinte sem o "reuniao". A mesma resposta de novo, e a de outro id: nenhuma mensagem, e a linha
    // "reunioes: reuniaoResposta ignorada (outro pedido)".
}
TEST_CASE("reuniaoMostrar asks the interface for the Reunioes tab") { /* uma mensagem {"type":"abrir","tela":"reunioes"} */ }
TEST_CASE("the request shows with Nao perturbe on") { /* setDnd on; o pedido vai ao estado do mesmo jeito */ }
TEST_CASE("the ready of the main page forgets the request, and the ready of the notice keeps it") {
    // Com um pedido guardado: h.SendFromNotice(ready): o estado seguinte ainda tem o "reuniao"; h.Send(ready): não tem.
}
TEST_CASE("nothing of the meeting is ever logged") {
    // Depois de todos os comandos acima, bons e recusados: nenhuma linha de h.logs contem o codigo, o passe, o id, o
    // nome nem o assunto.
}
TEST_CASE("the meeting commands do nothing after quit") {
    // Depois do quit: nenhum gancho, nenhuma mensagem, e a linha "comando ignorado depois do Sair: reuniaoNavegador",
    // sem os campos.
}
```

`tests/desktop/test_iphone_mode.cpp`: os quatro comandos entram numa tabela como a dos comandos do chat recusados no iPhone, com campos que valem: cada um deixa a linha `comando recusado no modo iPhone: <comando>`, sem os campos, e não chama gancho nenhum.

- [ ] **Step 2: Rode e veja falhar**

Run: `cmake -S tests/desktop -B work/build-desktop -DCMAKE_BUILD_TYPE=Release && cmake --build work/build-desktop -j2`
Expected: não compila (o `Reunioes.h` e os nomes novos não existem).

- [ ] **Step 3: Implemente**

O `Reunioes.{h,cpp}`, as quatro entradas do `CommandKind` e da tabela dos nomes, os quatro `case` do `ParseCommand` (o `pedido` é um objeto: leia os três campos dele com as mesmas regras de texto dos outros comandos), o `MeetingFields` no `Command`, as duas mensagens, o gancho no `DesktopHooks` e no `Harness` (`host.push_back("openMeeting " + code + " " + pass)`), os quatro no `PlatformOf` e os quatro `case` do `DesktopApp` (com os outros que só valem no Windows), e o `reuniao` no `BridgeState`, no `BuildState` e no `StateMessage`.

- [ ] **Step 4: Rode e veja passar**

Run: `cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests`
Expected: todos passam (os 500 de antes e os novos).

- [ ] **Step 5: Commit**

Run: `python3 build/check_source_text.py`
Expected: `ok`.

```bash
git add starsonic/desktop/Reunioes.h starsonic/desktop/Reunioes.cpp starsonic/desktop/Protocol.h starsonic/desktop/Protocol.cpp starsonic/desktop/DesktopApp.h starsonic/desktop/DesktopApp.cpp tests/desktop/desktop_fixture.h tests/desktop/test_reunioes.cpp tests/desktop/test_protocol.cpp tests/desktop/test_iphone_mode.cpp
git commit -m "feat(nucleo): os comandos das reuniões e o pedido que o aviso mostra"
```

---

### Task 3: O executável: o endereço do navegador, o aviso do canto com um pedido e o clique que traz a janela

**Files:**
- Create: `windows/app/src/MeetingLinks.h`, `windows/app/src/MeetingLinks.cpp` (C++ portátil)
- Modify: `windows/app/src/ShellState.h`, `windows/app/src/ShellState.cpp`
- Modify: `windows/app/src/MainWindow.cpp` (o `noticeCallbacks.command`), `windows/app/src/main.cpp` (o gancho `openMeeting`)
- Modify: `tests/desktop/CMakeLists.txt`: o `MeetingLinks.cpp` e o `tests/win/test_meeting_links.cpp` entram na lista que vale em toda máquina (a do `ChatFiles.cpp` e do `tests/win/test_network_monitor.cpp`), e o `ShellState.cpp` e o `tests/win/test_shell_state.cpp` passam do bloco `if(WIN32)` para ela (os dois só usam a biblioteca padrão e o `nlohmann/json`, e compilam aqui: conferido em 24/11). O executável não tem lista para mudar: o `windows/app/CMakeLists.txt` pega todo `src/*.cpp`.
- Test: `tests/win/test_meeting_links.cpp` (novo), `tests/win/test_shell_state.cpp`

**Interfaces:**
- Consumes: o `ValidMeetingCode` e o `ValidMeetingPass` (Task 2); o `kChatOrigin` (`ChatFiles.h`); o `IsMeetingUrl` (`WebPermissions.h`); o `OpenUrl` e o `RunOnWindow` do `main.cpp`; o `IsCommand(json, "answer")` do `MainWindow.cpp`.
- Produces:

```cpp
// windows/app/src/MeetingLinks.h
// O endereco de uma reuniao para o navegador padrao: kChatOrigin + "/r/" + code e, com o passe, "#p=" + pass.
// "" quando o codigo, ou um passe que veio, nao tem o formato: nada abre.
std::string MeetingBrowserUrl(const std::string& code, const std::string& pass);

// windows/app/src/ShellState.h, no ShellStatus
bool meetingRequest = false;   // reuniao.pedido e um objeto: ha um pedido de quem quer entrar para mostrar
bool meetingHidden = false;    // reuniao.escondida
// ShowsNotice passa a ser: a regra de hoje, OU meetingRequest && (!inFront || meetingHidden).
```

- No `main.cpp`: `hooks.openMeeting` monta o endereço com o `MeetingBrowserUrl` e, se ele não é vazio, chama o `OpenUrl` na thread da janela. Nada vai ao diagnóstico.
- No `MainWindow.cpp`: o `reuniaoMostrar` do aviso traz a janela principal para a frente, como o `answer`. O `reuniaoResposta` (o Aceitar, o Recusar e o fechar) não traz.

- [ ] **Step 1: Escreva os testes que falham**

Antes, o `tests/desktop/CMakeLists.txt` (acima): sem ele, os dois arquivos de teste não entram na compilação daqui.

`tests/win/test_meeting_links.cpp`:

```cpp
TEST_CASE("the browser address of a meeting is the chat origin, the code and the pass after the #") {
    CHECK(MeetingBrowserUrl("k7q49xwpht", "") == std::string(kChatOrigin) + "/r/k7q49xwpht");
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass) == std::string(kChatOrigin) + "/r/k7q49xwpht#p=" + kPass);
    CHECK(IsMeetingUrl(MeetingBrowserUrl("k7q49xwpht", "")));   // o mesmo endereco que o quadro do app aceita
}
TEST_CASE("a code or a pass out of format opens nothing") {
    // "K7Q49XWPHT", "k7q49xwph", "k7q49xwpht/x", "k7q49xwpht#p=x" como codigo; um passe de 42 caracteres ou com "&": "".
}
```

`tests/win/test_shell_state.cpp`:

```cpp
TEST_CASE("a meeting request shows the notice out of front, or with the meeting hidden") {
    // O estado com "reuniao": {"pedido": {...}, "escondida": false}: meetingRequest, sem meetingHidden;
    // ShowsNotice(s, /*inFront=*/false) e true, ShowsNotice(s, true) e false. Com "escondida": true: true nos dois.
    // Sem o "reuniao", com o "reuniao" sem o "pedido", e com o "pedido" que nao e objeto: sem meetingRequest.
}
TEST_CASE("a ringing call still shows as before") {
    // Com uma ligacao tocando e sem pedido: como hoje (fora da frente, e na frente so com o porteiro como a segunda).
    // Com as duas coisas: o aviso aparece (quem escolhe o que desenhar e a pagina do aviso).
}
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cmake -S tests/desktop -B work/build-desktop -DCMAKE_BUILD_TYPE=Release && cmake --build work/build-desktop -j2`
Expected: não compila (o `MeetingLinks.h` e os campos novos não existem).

- [ ] **Step 3: Implemente** o `MeetingLinks.{h,cpp}`, os dois campos e a regra do `ShellState`, o gancho e o `reuniaoMostrar`.

- [ ] **Step 4: Rode e veja passar**

Run: `cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests`
Expected: todos passam, com os 10 casos do `test_shell_state.cpp`, que antes só rodavam no Windows.

- [ ] **Step 5: Commit**

O `main.cpp` e o `MainWindow.cpp` só compilam no Windows: quem conduz confere no workflow `build` depois do push.

```bash
git add windows/app/src/MeetingLinks.h windows/app/src/MeetingLinks.cpp windows/app/src/ShellState.h windows/app/src/ShellState.cpp windows/app/src/MainWindow.cpp windows/app/src/main.cpp tests/desktop/CMakeLists.txt tests/win/test_meeting_links.cpp tests/win/test_shell_state.cpp
git commit -m "feat(windows): o navegador da reunião e o aviso do canto com um pedido"
```

---

### Task 4: A página do aviso mostra quem quer entrar (a tela 11)

**Files:**
- Create: `windows/ui/src/reunioes/textos.ts` (só os textos do aviso, por enquanto)
- Modify: `windows/ui/src/state.ts` (o `reuniao` do `AppState`, os quatro comandos, as duas mensagens)
- Modify: `windows/ui/src/aviso.tsx`, `windows/ui/src/app.css` (os estilos do aviso estão com os outros)
- Modify: `windows/ui/src/fake.ts`, `windows/ui/src/fake-scenarios.ts` (o cenário `aviso-pedido`)
- Test: `windows/ui/tests/reunioes/aviso.spec.ts` (novo)

**Interfaces:**
- Consumes: os nomes da seção "Os nomes novos da ponte" (Task 2); a página do aviso de hoje (`aviso.tsx`: o `ringingCard`, o `noticeHeight`); o `abrir(page, cenario, 'aviso.html')`, o `empurrar`, o `esperarComando`, o `vezes` e o `semViolacoesSerias` do `tests/helpers.ts`.
- Produces:

```ts
// state.ts
/** O `assunto`: o texto; "" numa reunião sem assunto; null quando o app não sabe. */
export interface PedidoDoAviso { id: string; nome: string; assunto: string | null }
export type RespostaDoAviso = 'aceitar' | 'recusar' | 'fechar';
// AppState ganha: reuniao?: { pedido: PedidoDoAviso; escondida: boolean };
// Command ganha:
//   | { cmd: 'reuniaoNavegador'; codigo: string; passe?: string }
//   | { cmd: 'reuniaoPedido'; pedido?: PedidoDoAviso; escondida?: boolean }
//   | { cmd: 'reuniaoResposta'; pedido: string; resposta: RespostaDoAviso }
//   | { cmd: 'reuniaoMostrar' }
// IncomingMessage ganha:
//   | { v: number; type: 'reuniaoResposta'; pedido: string; resposta: RespostaDoAviso }
//   | { v: number; type: 'abrir'; tela: 'reunioes' }

// reunioes/textos.ts
export const AVISO_REUNIOES = 'Starsonic Phone · Reuniões';
export const querEntrar = (nome: string) => `${nome} quer entrar`;
/** O nome do aviso para o leitor de tela: com o assunto, "<Nome> quer entrar na reunião <assunto>". */
export const querEntrarNaReuniao = (nome: string, assunto: string | null) =>
  assunto ? `${nome} quer entrar na reunião ${assunto}` : `${nome} quer entrar na reunião`;
export const SEM_ASSUNTO = 'Reunião sem assunto';
export const RECUSAR = 'Recusar';
export const ACEITAR = 'Aceitar';
export const FECHAR_O_AVISO = 'Fechar o aviso';
```

- **A ponte falsa** faz o que o núcleo faz (Task 2): o `reuniaoPedido` põe ou tira o `reuniao` do estado; o `reuniaoResposta` do pedido do estado entrega a mensagem `reuniaoResposta` e tira o pedido; o de outro id não faz nada; o `reuniaoMostrar` entrega o `abrir` das reuniões; o `reuniaoNavegador` só fica guardado no `__comandos`. No modo iPhone, nada.
- **A página do aviso:** com uma ligação tocando, o aviso é o da ligação, como hoje. Sem ela e com o `state.reuniao`, é o do pedido, pelo desenho da tela 11 (`work/quadro-reunioes/AvisoWindows.dc.html`, fora do git): a linha de cima `AVISO_REUNIOES`, o título `querEntrar(nome)`, a segunda linha (o `assunto`; `SEM_ASSUNTO` quando ele é vazio; nenhuma quando é `null`), os botões "Recusar" e "Aceitar" e o "×" com o nome `FECHAR_O_AVISO`: os três mandam o `reuniaoResposta` com o id e a resposta deles. Um clique em qualquer outro ponto do aviso manda o `reuniaoMostrar`. O aviso é um `alertdialog` com o nome `querEntrarNaReuniao(nome, assunto)`. A altura pedida é a do aviso de voz (o `ALTURA_DO_AVISO.voz`, 168).

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/aviso.spec.ts`, na página `aviso.html`, com o cenário `aviso-pedido`: a Maria Lima, "Planejamento de dezembro")

```ts
test('o aviso mostra quem quer entrar, a reunião e os dois botões', …);
// 'Starsonic Phone · Reuniões', 'Maria Lima quer entrar', 'Planejamento de dezembro', 'Recusar', 'Aceitar';
// o alertdialog tem o nome 'Maria Lima quer entrar na reunião Planejamento de dezembro'; o botão 'Fechar o aviso';
// o comando noticeHeight com a altura 168.
test('a reunião sem assunto diz Reunião sem assunto, e a de assunto desconhecido fica sem a linha', …);
// assunto '': a linha 'Reunião sem assunto'; assunto null: nenhuma segunda linha; nos dois, o nome do alertdialog é
// 'Maria Lima quer entrar na reunião'.
test('o Aceitar, o Recusar e o fechar mandam a resposta com o id do pedido', …);
// { cmd: 'reuniaoResposta', pedido: '8899aabbccddeeff', resposta: 'aceitar' } e, em outras aberturas, 'recusar' e
// 'fechar'; nenhum reuniaoMostrar; depois da resposta, o aviso fica vazio (a ponte falsa tira o pedido).
test('o clique fora dos botões manda o reuniaoMostrar, e nenhuma resposta', …);
test('a ligação tocando toma o aviso, e o pedido volta quando ela para', …);
// empurre um estado com a ligação tocando e o reuniao: 'Ligação recebida', sem 'quer entrar'; sem a ligação: o pedido.
for (const tema of ['light', 'dark'] as const) test(`o aviso do pedido não tem violações sérias (${tema})`, …);
test('pelo teclado: o Tab passa pelo Recusar, pelo Aceitar e pelo fechar, e o Enter responde', …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/aviso.spec.ts`
Expected: FAIL (o cenário `aviso-pedido` não existe).

- [ ] **Step 3: Implemente** os tipos, os textos, a ponte falsa com o cenário, e o aviso do pedido.

- [ ] **Step 4: Rode e veja passar**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: os 1414 de antes e os novos passam.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/textos.ts windows/ui/src/state.ts windows/ui/src/aviso.tsx windows/ui/src/app.css windows/ui/src/fake.ts windows/ui/src/fake-scenarios.ts windows/ui/tests/reunioes/aviso.spec.ts
git commit -m "feat(ui): o aviso do canto mostra quem quer entrar na reunião"
```

---

### Task 5: As rotas e os tipos das reuniões na interface

**Files:**
- Create: `windows/ui/src/reunioes/tipos.ts`
- Modify: `windows/ui/src/chat/api.ts` (a interface `ApiChat` e o `criarApi`)
- Modify: `windows/ui/tests/chat/servidor.ts` (os ajudantes `liberarReunioes` e `empresaComReunioes`)
- Test: `windows/ui/tests/reunioes/api.spec.ts` (novo; roda no Node, sem página, contra o chat de teste do `global-setup`)

**Interfaces:**
- Consumes: o `pedir` e o `ErroChat` do `chat/api.ts`; o `admin`, o `csrfDe`, o `empresaComPessoas` e a `ApiDeTeste` do `tests/chat/servidor.ts`; o `docs/chat-protocolo.md`, seção 9.
- Produces:

```ts
// reunioes/tipos.ts (docs/chat-protocolo.md, seções 9 e 11)
export interface Reuniao {
  codigo: string;
  link: string;
  tipo: 'marcada' | 'naHora';
  assunto: string | null;
  inicio: number | null;
  valeAte: number | null;
  criouEu: boolean;
  acontecendo: boolean;
  pessoas: number;
}
export interface Pedido { id: string; nome: string }
export interface Participante { id: string; nome: string; deFora: boolean; tela: boolean }
export type EventoDaReuniao =
  | { tipo: 'reuniaoPedido'; reuniao: string; pedido: Pedido }
  | { tipo: 'reuniaoPedidoFim'; reuniao: string; pedido: string }
  | { tipo: 'reuniaoParticipantes'; reuniao: string; participantes: Participante[]; pedidos: Pedido[] }
  | { tipo: 'reuniaoAcabou'; reuniao: string };

// chat/api.ts: a ApiChat ganha
reunioes(): Promise<Reuniao[]>;                                                            // GET /reunioes
criarReuniao(corpo: { assunto?: string; inicio: number; valeAte: number }): Promise<Reuniao>;   // POST /reunioes
cancelarReuniao(codigo: string): Promise<void>;                                            // DELETE /reunioes/{codigo}
passeDaReuniao(codigo: string): Promise<{ passe: string; reuniao: Reuniao }>;             // POST /reunioes/{codigo}/passe
aceitarPedido(codigo: string, pedido: string): Promise<void>;                              // POST …/aceitar {pedido}
recusarPedido(codigo: string, pedido: string): Promise<void>;                              // POST …/recusar {pedido}
pausarReuniao(codigo: string, pausada: boolean, vez: string): Promise<void>;               // POST …/pausa {pausada, vez}
participantesDaReuniao(codigo: string): Promise<{ participantes: Participante[]; pedidos: Pedido[] }>;   // GET …/participantes

// tests/chat/servidor.ts
/** Libera, ou bloqueia, as reuniões da empresa na administração (o POST /admin/reunioes/empresas/{id}, com o
 *  `liberar` 1 ou 0). */
export async function liberarReunioes(empresaId: number, liberar = true): Promise<void>;
/** O empresaComPessoas, com as reuniões liberadas. */
export async function empresaComReunioes(nome: string, pessoas: Array<{ ramal: string; nome: string }>): ReturnType<typeof empresaComPessoas>;
```

O código vai no caminho com o `encodeURIComponent`. Uma resposta `200` do passe sem um `passe` de texto, ou sem a `reuniao`, é o `ErroChat(500, 'servidor')`, como no `ligarComputador`.

**As falhas do passe contam na janela de 20 tentativas por minuto do endereço,** que todos os testes da rodada dividem (a seção 12 do protocolo). Nos testes deste plano, cada arquivo provoca no máximo duas falhas de verdade do passe; as outras respostas de erro são dadas pelo `page.route`.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/api.spec.ts`)

```ts
test('as rotas das reuniões: criar, listar, o passe e cancelar', async () => {
  const { pessoas } = await empresaComReunioes('Reunioes da API', [RECEPCAO]);
  const api = criarApi(baseDoChat(), pessoas[0].chave);
  const inicio = Date.now() + 3_600_000;
  const r = await api.criarReuniao({ assunto: 'Planejamento de dezembro', inicio, valeAte: inicio + 3_600_000 });
  expect(r.codigo).toMatch(/^[abcdefghjkmnpqrstvwxyz23456789]{10}$/);
  expect(r.link.endsWith(`/r/${r.codigo}`)).toBe(true);
  expect(r).toMatchObject({ tipo: 'marcada', assunto: 'Planejamento de dezembro', inicio, criouEu: true, acontecendo: false, pessoas: 0 });
  expect(await api.reunioes()).toEqual([r]);
  const p = await api.passeDaReuniao(r.codigo);
  expect(p.passe).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(p.reuniao.codigo).toBe(r.codigo);
  await api.cancelarReuniao(r.codigo);
  expect(await api.reunioes()).toEqual([]);
});
test('os erros vêm como o ErroChat do protocolo', async () => {
  // Sem as reuniões liberadas (empresaComPessoas): api.reunioes() rejeita com { status: 403, erro: 'semReunioes' }.
  // Com elas: criarReuniao com o valeAte antes do inicio: { status: 400, erro: 'invalido', campo: 'valeAte' };
  // passeDaReuniao('aaaaaaaaaa'): { status: 404, erro: 'naoEncontrado' };
  // aceitarPedido, recusarPedido, pausarReuniao e participantesDaReuniao fora da reunião:
  // { status: 409, erro: 'foraDaReuniao' }.
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npx playwright test tests/reunioes/api.spec.ts`
Expected: FAIL (o `empresaComReunioes` e os métodos novos não existem).

- [ ] **Step 3: Implemente** o `tipos.ts`, os oito métodos e os dois ajudantes.

- [ ] **Step 4: Rode e veja passar**

Run: `cd windows/ui && npm run typecheck && npx playwright test tests/reunioes/api.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/tipos.ts windows/ui/src/chat/api.ts windows/ui/tests/chat/servidor.ts windows/ui/tests/reunioes/api.spec.ts
git commit -m "feat(ui): as rotas das reuniões na API do chat do app"
```

---

### Task 6: As contas puras das reuniões

**Files:**
- Create: `windows/ui/src/reunioes/formato.ts`
- Modify: `windows/ui/src/reunioes/textos.ts` (os textos da aba, do menu, da Nova reunião, do cancelar e dos erros: a tabela dos Global Constraints)
- Test: `windows/ui/tests/reunioes/formato.spec.ts` (novo; roda no Node)

**Interfaces:**
- Consumes: a `Reuniao` (Task 5); o molde do `chat/formato.ts` e do teste dele.
- Produces (tudo no relógio do PC; o `agora` e as horas são milissegundos desde 1970):

```ts
/** "Hoje, 14:00", "Amanhã, 09:30", "Ontem, 14:00", "Qui, 26/11, 16:00"; em outro ano, "Sex, 26/11/2027, 16:00". */
export function quando(inicio: number, agora: number): string;
/** O mesmo, para o leitor de tela: "hoje às 14:00", "amanhã às 09:30", "ontem às 14:00",
 *  "quinta-feira, 26 de novembro, às 16:00"; em outro ano, "sexta-feira, 26 de novembro de 2027, às 16:00". */
export function quandoPorExtenso(inicio: number, agora: number): string;
/** "Acontecendo · 1 pessoa", "Acontecendo · 3 pessoas"; "" quando ninguém está nela. */
export function acontecendo(r: Pick<Reuniao, 'acontecendo' | 'pessoas'>): string;
/** O nome da linha para o leitor de tela: "Planejamento de dezembro, hoje às 14:00, acontecendo agora com 3 pessoas". */
export function descricaoDaLinha(r: Reuniao, agora: number): string;
/** "O link vale até hoje, 23:59", "O link vale até amanhã, 23:59", "O link vale até 26/11, 23:59" (com o ano, em outro ano).
 *  A hora é a do `valeAte`, sem os segundos. */
export function valeAteTexto(valeAte: number, agora: number): string;
/** "Hoje, às 23:59", "Amanhã, às 23:59", "26/11, às 23:59": o começo da frase da validade na Nova reunião. */
export function ateQuando(valeAte: number, agora: number): string;
/** O código de um texto colado: o link inteiro deste servidor ou só o código; null fora disso. */
export function codigoDoTexto(texto: string, base: string): string | null;
/** 23:59:59,999 do dia de `inicio`. */
export function fimDoDia(inicio: number): number;
/** O dia e a hora com que a Nova reunião abre: a próxima meia hora cheia depois de `agora` ("2026-11-24", "14:30"). */
export function inicioPadrao(agora: number): { dia: string; hora: string };
export interface NovaReuniao { assunto: string; dia: string; hora: string; validade: 'fimDoDia' | 'outra'; ateDia: string; ateHora: string }
/** O corpo do POST, ou o erro do formulário (o texto pronto e o campo). */
export function conferirNova(f: NovaReuniao, agora: number):
  | { corpo: { assunto?: string; inicio: number; valeAte: number } }
  | { erro: string; campo: 'dia' | 'ate' };
/** "O link para de valer na hora." e, acontecendo, " Como a reunião está acontecendo, as N pessoas saem."
 *  (com uma pessoa: " Como a reunião está acontecendo, a pessoa que está nela sai."). */
export function textoDoCancelar(r: Pick<Reuniao, 'acontecendo' | 'pessoas'>): string;
```

As regras:

- **Os dias** se comparam pelo calendário do PC (ano, mês e dia), e não por 24 horas: às 23:59 de hoje, uma reunião à 00:10 é "Amanhã". Toda conta de dia é feita pelo calendário (o `new Date(ano, mês, dia, …)`), e nunca somando 24 horas: onde há horário de verão, um dia tem 23 ou 25 horas. Os dias da semana: `Dom`, `Seg`, `Ter`, `Qua`, `Qui`, `Sex`, `Sáb`, e por extenso `domingo`, `segunda-feira`… `sábado`; os meses por extenso, em minúsculas.
- **O `descricaoDaLinha`:** o assunto (ou "Reunião sem assunto"), o `quandoPorExtenso` e, acontecendo, "acontecendo agora com 1 pessoa" ou "…com N pessoas", separados por vírgula.
- **O `codigoDoTexto`:** tira os espaços das pontas; se o texto começa com a `base` seguida de `/r/` (a `base` sem diferença de maiúsculas), fica com o que vem depois, até o fim ou até uma `/`, um `?` ou um `#`; senão, fica com o texto inteiro. Depois, como o servidor, passa para minúsculas e tira os espaços. Só vale com exatamente 10 caracteres de `abcdefghjkmnpqrstvwxyz23456789`. O link de outro servidor é `null`.
- **O `conferirNova`:** no `assunto`, cada caractere de controle (um Tab colado) vira um espaço; ele vai sem os espaços das pontas, e só quando sobra algo (o servidor recusa um assunto com caracteres de controle). O `inicio` é o `dia` e a `hora` no relógio do PC. O dia antes de hoje: `{ erro: "O dia da reunião já passou.", campo: 'dia' }` (uma hora de hoje que já passou vale). Com a validade `fimDoDia`, o `valeAte` é o `fimDoDia(inicio)`. Com a `outra`, é o `ateDia` e o `ateHora`; antes do `inicio`, igual a ele, antes de `agora` ou mais de 31 dias depois do `inicio`: `{ erro: "O link pode valer até 31 dias depois da reunião.", campo: 'ate' }`.
- **O `inicioPadrao`:** às 14:07, `14:30`; às 14:30 em ponto, `15:00`; às 23:40, `00:00` do dia seguinte.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/formato.spec.ts`; cada hora do teste é montada com `new Date(ano, mês, dia, hora, minuto).getTime()`, para o teste valer em qualquer fuso)

```ts
test('o quando: hoje, amanhã, ontem, o dia da semana e o outro ano', …);
// agora = 24/11/2026 12:00: 14:00 de hoje → 'Hoje, 14:00'; 25/11 09:30 → 'Amanhã, 09:30'; 23/11 14:00 → 'Ontem, 14:00';
// 26/11 16:00 → 'Qui, 26/11, 16:00'; 26/11/2027 16:00 → 'Sex, 26/11/2027, 16:00'.
test('o dia vira pelo calendário, e não por 24 horas', …);
// agora = 24/11 23:59: 25/11 00:10 → 'Amanhã, 00:10'; agora = 25/11 00:00: a mesma → 'Hoje, 00:10';
// agora = 30/11 12:00: 01/12 09:00 → 'Amanhã, 09:00'; agora = 31/12/2026 12:00: 01/01/2027 09:00 → 'Amanhã, 09:00'.
test('o quando por extenso e a descrição da linha são os do quadro', …);
// 'Planejamento de dezembro, hoje às 14:00, acontecendo agora com 3 pessoas';
// 'Reunião com a contabilidade, amanhã às 09:30'; 'Reunião sem assunto, quinta-feira, 26 de novembro, às 16:00';
// com uma pessoa: '…, acontecendo agora com 1 pessoa'.
test('o acontecendo, a validade e o cancelar', …);
// 'Acontecendo · 1 pessoa', 'Acontecendo · 3 pessoas', ''; 'O link vale até hoje, 23:59', '…até amanhã, 23:59',
// '…até 26/11, 23:59'; 'Hoje, às 23:59'; os três textos do cancelar.
test('o código de um texto colado', …);
// O link inteiro, o link com espaços nas pontas, com a base em maiúsculas, com '?x=1' ou '#p=abc' no fim, só o código,
// o código em maiúsculas e com espaços: o código. Outro servidor, 9 e 11 caracteres, um 'i', um '0', '' → null.
test('a Nova reunião: o corpo e os dois erros', …);
// O fim do dia: valeAte === fimDoDia(inicio), o assunto sem os espaços das pontas e com um Tab do meio virado espaço,
// e sem a chave assunto quando ele é só espaços.
// O dia de ontem → 'O dia da reunião já passou.'; uma hora de hoje que já passou → vale.
// A outra validade: 31 dias depois → vale; 31 dias e 1 minuto, igual ao início, antes do início → o erro dos 31 dias.
test('o começo padrão é a próxima meia hora cheia', …);
// 14:07 → { dia: '2026-11-24', hora: '14:30' }; 14:30 → '15:00'; 23:40 → { dia: '2026-11-25', hora: '00:00' }.
test('o fim do dia é 23:59:59,999 do dia, no relógio do PC', …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npx playwright test tests/reunioes/formato.spec.ts`
Expected: FAIL (o `formato.ts` não existe).

- [ ] **Step 3: Implemente** o `formato.ts` e complete o `textos.ts`.

- [ ] **Step 4: Rode e veja passar**

Run: `cd windows/ui && npm run typecheck && npx playwright test tests/reunioes/formato.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/formato.ts windows/ui/src/reunioes/textos.ts windows/ui/tests/reunioes/formato.spec.ts
git commit -m "feat(ui): o dia, a validade e a Nova reunião, em contas puras"
```

---

### Task 7: O cliente das reuniões e a aba: a lista, a primeira vez, sem conexão e a aba que some

**Files:**
- Create: `windows/ui/src/reunioes/cliente.ts`, `windows/ui/src/reunioes/usarReunioes.ts`, `windows/ui/src/reunioes/telas/Aba.tsx`
- Modify: `windows/ui/src/chat/cliente.ts` (o `pedir`, o `assinarSessao` e o `ehParado`), `windows/ui/src/chat/tipos.ts` e `windows/ui/src/chat/eventos.ts` (os quatro eventos das reuniões)
- Modify: `windows/ui/src/types.ts` (a aba `reunioes`), `windows/ui/src/components/Nav.tsx`, `windows/ui/src/icons.tsx` (o ícone da aba, o do quadro), `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/aba.spec.ts` (novo), `windows/ui/tests/reunioes/abrir.ts` (novo: os ajudantes dos testes das reuniões)

**Interfaces:**
- Consumes: a `ApiChat` com as reuniões e o `empresaComReunioes` (Task 5); o `quando`, o `acontecendo` e o `descricaoDaLinha` (Task 6); o `ChatCliente` (a `vista()`, o `assinar`, o `sessao()` e o `daTela` privados, o `parar()`, o `conectou` do `ligarEventos`, o `aoEvento`); a aba Chat como molde (`chat/telas/Lista.tsx`, `chat/usarChat.ts`, o `ABAS_COM_CHAT` do `main.tsx`); o `abrirNoChat`, o `esperarOsEventos` e o `pararORelogio` do `tests/chat/abrir.ts`.
- Produces:

```ts
// chat/cliente.ts
/** O pedido de antes de uma parada (a pessoa trocou, o chat desligou): a resposta não vale. */
export const ehParado: (e: unknown) => boolean;
// na classe ChatCliente:
/** Um pedido como a pessoa da vez, uma vez só. Rejeita com o Parado se não há pessoa ou se ela trocou no meio; o 401
 *  tira o computador do chat. `lendo`: o 429 `limite` espera e tenta de novo uma vez. */
pedir<T>(f: (api: ApiChat) => Promise<T>, o?: { lendo?: boolean }): Promise<T>;
/** Os eventos das reuniões, cada conexão dos eventos (a primeira e as voltas) e cada parada da sessão. */
assinarSessao(o: { evento(e: EventoDaReuniao): void; conectou(): void; parou(): void }): () => void;

// reunioes/cliente.ts
export interface VistaReunioes {
  /** A aba aparece: false até a primeira leitura dar certo, e de novo depois de um 403 semReunioes. */
  aba: boolean;
  /** As reuniões da pessoa da vez; null antes da primeira leitura. */
  lista: Reuniao[] | null;
  /** false: a frase da falta de conexão no lugar da lista. */
  conectado: boolean;
}
export class ReunioesCliente {
  constructor(o: { chat: ChatCliente; bridge: Bridge; base: string });
  vista(): VistaReunioes;
  assinar(f: () => void): () => void;
  /** A aba Reuniões entrou na vista (lê a lista na hora, e de novo a cada 30 s) ou saiu dela. */
  abaAVista(aVista: boolean): void;
}

// reunioes/usarReunioes.ts
export function useVistaReunioes(cliente: ReunioesCliente): VistaReunioes;

// types.ts
export type Tab = 'teclado' | 'atalhos' | 'recentes' | 'contatos' | 'chat' | 'reunioes';

// tests/reunioes/abrir.ts
/** Abre o app no chat de verdade e vai para a aba Reuniões. */
export async function abrirNasReunioes(page: Page, o: Parameters<typeof abrirNoChat>[1]): Promise<void>;
/** Uma hora no relógio da página: o playwright.config.ts fixa o fuso dela em America/Sao_Paulo (sempre −03:00), e o
 *  Node dos testes pode estar em outro. `dias`: 0 é hoje naquele fuso, 1 é amanhã. */
export function noRelogioDaPagina(dias: number, hora: number, minuto: number): number;
/** O meio-dia de hoje no relógio da página: os testes da lista fixam a hora da página nele. */
export function meioDiaDeHoje(): number;
```

As regras do cliente:

- **O `pedir`** é o `daTela` de hoje com a `sessao()` de hoje, aberto para o cliente das reuniões. O `assinarSessao` entrega o `conectou` do `ligarEventos` e o `parou` a cada `parar()` do `ChatCliente`.
- **Os eventos:** o `chat/tipos.ts` põe os quatro eventos das reuniões no `Evento`, o `lerEvento` os confere (os textos e as listas no lugar; um evento torto é ignorado, como os outros), e o `aoEvento` os entrega só a quem assinou a sessão. O `reuniaoAgora` continua desconhecido (é da etapa 2b).
- **A leitura da lista** é o `chat.pedir((api) => api.reunioes(), { lendo: true })`: a cada `conectou`; quando a aba entra na vista; e a cada 30 s com ela à vista. Deu certo: `lista`, `aba: true`, `conectado: true`. O `403 semReunioes`: `aba: false` e `lista: null`, e a pergunta se repete a cada 5 minutos e a cada `conectou`. O `Parado`: nada. Qualquer outra falha: `conectado: false`, e a próxima leitura tenta de novo.
- **O `aba` começa falso** e só passa a verdadeiro com a primeira leitura que dá certo (a escolha 8): uma empresa sem as reuniões nunca vê a aba, nem por um instante.
- **O `conectado`** também é falso enquanto a `chat.vista()` não está no `pronto` com o `conectado` verdadeiro (o cliente assina a vista do chat).
- **O `parou`:** a lista é esquecida (`lista: null`) e os relógios param; o `aba` fica como estava (as reuniões são liberadas para a empresa, e o computador continua nela). A lista da pessoa seguinte vem da primeira leitura dela.
- **Nada do cliente vai ao `console`.**

A aba (`telas/Aba.tsx`, pelo desenho das telas 1 e 4: `work/quadro-reunioes/Main.dc.html` e `PrimeiraVez.dc.html`, fora do git):

- É a sexta aba, "Reuniões", com o `Control+6`. Ela aparece com o `state.chat.ligado` e o `vista.aba`. Se ela some com a pessoa nela, o app vai para o Teclado.
- O título "Reuniões" e a linha "As que você marcou". **O "Nova reunião", o campo do link, o "Copiar link" e o menu entram nas Tasks 8 a 10.**
- Cada reunião é uma linha, na ordem do servidor: o assunto (ou "Reunião sem assunto"), o `quando` e, quando há, o `acontecendo`; o nome da linha para o leitor de tela é o `descricaoDaLinha`.
- Com a lista vazia: "Nenhuma reunião marcada" e o texto da primeira vez (o "Nova reunião" dele em negrito).
- Com o `conectado` falso: "Sem conexão com o chat. As reuniões voltam quando a conexão voltar.", num `status`, no lugar da lista.
- A hora de "agora" é lida a cada desenho, e a aba é desenhada de novo a cada leitura da lista: à meia-noite, o "Amanhã" vira "Hoje" em até 30 s.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/aba.spec.ts`; as reuniões são criadas pela `ApiDeTeste`, com as horas do `noRelogioDaPagina`; a hora da página é fixada com `page.clock.setFixedTime(meioDiaDeHoje())` antes de abrir)

```ts
test('a aba Reuniões é a sexta, com o Ctrl+6, e só com as reuniões liberadas', …);
// Com as reuniões: as seis abas na ordem (Teclado, Atalhos, Recentes, Contatos, Chat, Reuniões), a sexta com o
// aria-keyshortcuts 'Control+6'; o Ctrl+6 a abre. Numa empresa sem as reuniões (empresaComPessoas): cinco abas.
test('a aba só aparece depois da primeira resposta do chat', …);
// O page.route segura o primeiro GET /api/v1/reunioes: cinco abas; solto: seis.
test('a lista mostra o assunto, o dia e a hora, da mais cedo para a mais tarde', …);
// Três reuniões: hoje 14:00 ('Planejamento de dezembro'), amanhã 09:30 ('Reunião com a contabilidade') e daqui a
// três dias 16:00, sem assunto: 'Hoje, 14:00', 'Amanhã, 09:30', '<Dia>, <dd/mm>, 16:00' daquele dia no relógio da
// página (com o ano, se ele cai no ano que vem) e 'Reunião sem assunto', nessa ordem; o nome de cada linha é o
// descricaoDaLinha.
test('o Acontecendo aparece com alguém na reunião', …);
// O page.route no GET /api/v1/reunioes troca a resposta (acontecendo: true, pessoas: 3, e outra com 1):
// 'Acontecendo · 3 pessoas' e 'Acontecendo · 1 pessoa'.
test('a primeira vez mostra Nenhuma reunião marcada', …);
test('sem conexão com o chat, a aba diz isso no lugar da lista, e a lista volta sozinha', …);
// O page.route aborta o GET /api/v1/reunioes: o status com a frase; com a rota solta e 30 s de relógio, a lista.
test('a lista é lida de novo a cada 30 s com a aba à vista, e não fora dela', …);
// pararORelogio; conte os GET /api/v1/reunioes; runFor(30_000) → mais um; no Teclado, runFor(60_000) → nenhum;
// de volta à aba → um na hora.
test('à meia-noite, o Amanhã vira Hoje sem recarregar', …);
// A hora da página anda: page.clock.install({ time }) às 23:59:50 de hoje, e o pararORelogio: 'Amanhã, 09:30';
// runFor(40_000): 'Hoje, 09:30'.
test('a aba some com o semReunioes e volta quando a empresa é liberada', …);
// Com as reuniões e a pessoa na aba: liberarReunioes(id, false) e runFor(30_000) (a leitura da lista): cinco abas, e
// a tela é a do Teclado. liberarReunioes(id) e runFor(300_000): seis abas de novo.
test('a troca de pessoa esquece a lista', …);
// O cenário 'chat-duas-contas': a lista da primeira pessoa; segure o GET /api/v1/reunioes da segunda e troque a
// conta: nenhuma linha da primeira fica na tela; solte: só as da segunda.
for (const tema of ['light', 'dark'] as const) test(`a aba não tem violações sérias (${tema})`, …);
test('a aba cabe nos três tamanhos, com as seis abas', …);
// 400×720, 360×600 e 300×440: nada rola na horizontal, e as seis abas ficam inteiras à vista.
test('nada das reuniões vai ao console', …);
// Nenhuma mensagem que a página escreve tem um código, um link ou um assunto (as linhas "Failed to load resource" do
// navegador ficam de fora).
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/aba.spec.ts`
Expected: FAIL (a aba não existe).

- [ ] **Step 3: Implemente** o que os Produces e as regras dizem.

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa. Os testes de hoje que contam as abas com o chat ligado continuam com cinco: as empresas deles não têm as reuniões, e a aba só aparece depois de uma leitura que dá certo. O app passa a pedir o `GET /api/v1/reunioes` a cada conexão dos eventos: se um teste de hoje contava todos os pedidos ao chat e passa a vê-lo, acerte o filtro do teste para as rotas dele, sem mudar o que ele confere, e diga no relatório quais mudaram.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/usarReunioes.ts windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/chat/cliente.ts windows/ui/src/chat/tipos.ts windows/ui/src/chat/eventos.ts windows/ui/src/types.ts windows/ui/src/components/Nav.tsx windows/ui/src/icons.tsx windows/ui/src/main.tsx windows/ui/src/app.css windows/ui/tests/reunioes/aba.spec.ts windows/ui/tests/reunioes/abrir.ts
git commit -m "feat(ui): a aba Reuniões com a lista das reuniões marcadas"
```

---

### Task 8: A Nova reunião (a tela 3) e o link copiado

**Files:**
- Create: `windows/ui/src/reunioes/telas/Nova.tsx`
- Modify: `windows/ui/src/reunioes/cliente.ts` (o `criar` e o `copiar`), `windows/ui/src/reunioes/telas/Aba.tsx` (o botão "Nova reunião" e o "Link copiado" da linha nova), `windows/ui/src/types.ts` (a vista `reuniaoNova`), `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/nova.spec.ts` (novo)

**Interfaces:**
- Consumes: o `conferirNova`, o `inicioPadrao`, o `ateQuando` e o `fimDoDia` (Task 6); o `ReunioesCliente` e o `noRelogioDaPagina` (Task 7); o molde das telas de formulário do chat (`chat/telas/NovoGrupo.tsx`, com o `components/BackBar.tsx`: o `eyebrow` e o nome do botão de voltar).
- Produces:

```ts
// reunioes/cliente.ts
// VistaReunioes ganha:
/** O código da reunião cuja linha diz "Link copiado" (por 2 s); null sem nenhuma. */
copiado: string | null;
// ReunioesCliente ganha:
/** Cria a reunião como a pessoa da vez, relê a lista e copia o link. Rejeita com o ErroChat (a tela diz a falha). */
criar(corpo: { assunto?: string; inicio: number; valeAte: number }): Promise<Reuniao>;
/** Copia o link da reunião (o `link` que o servidor deu) pelo navigator.clipboard.writeText. true: copiado, e a
 *  vista diz o `copiado` por 2 s. false: a cópia falhou, e nada muda. */
copiar(reuniao: Pick<Reuniao, 'codigo' | 'link'>): Promise<boolean>;

// types.ts: a View ganha
| { kind: 'reuniaoNova'; back: View }
```

A tela (pelo desenho da tela 3: `work/quadro-reunioes/NovaReuniao.dc.html`):

- O "Voltar para as reuniões" (o nome do botão de voltar), "REUNIÕES" e "Nova reunião".
- O "Assunto", com "Opcional" e a ajuda; no máximo 120 caracteres (o `maxlength`).
- O "Dia" (`<input type="date" required>`) e a "Hora" (`<input type="time" required>`), abrindo com o `inicioPadrao`.
- "O link vale até": "O fim do dia da reunião" (marcado) ou "Outro dia e hora", que mostra um dia e uma hora (abrindo no fim do dia da reunião). Embaixo, a frase com o `ateQuando`: "Hoje, às 23:59. Depois dessa hora, ninguém novo entra pelo link.".
- "Os colegas da empresa entram direto. Quem é de fora digita o nome e espera um colega aceitar."
- "Criar a reunião" e "O link é copiado assim que a reunião é criada.".
- **Os erros** aparecem num `alert`, junto do campo deles, e o formulário fica como estava: os dois do `conferirNova`; o `409 muitasReunioes`: "Você já tem 100 reuniões marcadas. Cancele uma para marcar outra."; o `400 invalido` com o `campo` `inicio`: "O dia da reunião já passou.", e com o `valeAte`: "O link pode valer até 31 dias depois da reunião."; o `429`: "Muitas tentativas. Espere um pouco para tentar de novo."; sem resposta, um `5xx` ou outro erro: "O servidor do chat não respondeu. Tente de novo.". O `403 semReunioes` esconde a aba (o cliente relê a lista).
- **Deu certo:** a pessoa volta à aba, com a reunião nova na lista. Se a cópia deu certo, a linha nova diz "Link copiado" por 2 s (um `status`).
- Enquanto o pedido está no ar, o "Criar a reunião" fica desligado: um segundo clique não cria outra.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/nova.spec.ts`; o contexto do navegador com as permissões `clipboard-read` e `clipboard-write`)

```ts
test('a Nova reunião abre com hoje e a próxima meia hora, e os textos da tela 3', …);
// A hora da página fixada às 14:07 (o noRelogioDaPagina(0, 14, 7)): o Dia de hoje e a Hora '14:30'; verTextos com
// os textos da tela, um por um.
test('o Criar a reunião cria, volta à lista e deixa o link copiado', …);
// Com o assunto 'Planejamento de dezembro': a linha nova na lista; navigator.clipboard.readText() é o `link` que a
// ApiDeTeste lê no GET /api/v1/reunioes; a linha diz 'Link copiado' e, depois de 2 s de relógio, não diz mais.
test('o valeAte mandado é o fim do dia no relógio do PC', …);
// O page.route deixa o POST /api/v1/reunioes passar e guarda o corpo: valeAte é 23:59:59,999 do dia escolhido no
// relógio da página (noRelogioDaPagina(dias, 23, 59) + 59_999), o inicio é o dia e a hora escolhidos, e o corpo não
// tem a chave assunto quando o campo ficou vazio.
test('o dia que já passou e a validade além dos 31 dias dizem o erro, e nada é mandado', …);
test('a centésima primeira diz Você já tem 100 reuniões marcadas', …);   // o page.route responde 409 muitasReunioes
test('o servidor que não responde diz O servidor do chat não respondeu, e o formulário fica', …);
test('um segundo clique enquanto o pedido está no ar não cria outra', …);  // o page.route segura o POST: um pedido só
test('a cópia que falha não diz Link copiado', …);
// Sem a permissão clipboard-write (ou com o writeText trocado por um que rejeita): a reunião aparece, sem o status.
for (const tema of ['light', 'dark'] as const) test(`a Nova reunião não tem violações sérias (${tema})`, …);
test('a Nova reunião cabe nos três tamanhos e anda pelo teclado', …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/nova.spec.ts`
Expected: FAIL (o "Nova reunião" não existe).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/Nova.tsx windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/types.ts windows/ui/src/main.tsx windows/ui/src/app.css windows/ui/tests/reunioes/nova.spec.ts
git commit -m "feat(ui): a Nova reunião, com o link copiado ao criar"
```

---

### Task 9: O "Copiar link", o menu de uma reunião e o cancelar (as telas 1, 2 e 5)

**Files:**
- Create: `windows/ui/src/reunioes/telas/Cancelar.tsx`
- Modify: `windows/ui/src/reunioes/cliente.ts` (o `cancelar`), `windows/ui/src/reunioes/telas/Aba.tsx` (o "Copiar link", o botão do menu e o menu), `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/menu.spec.ts` (novo)

**Interfaces:**
- Consumes: o `copiar` (Task 8); o `valeAteTexto`, o `quando` e o `textoDoCancelar` (Task 6); o `components/Menu.tsx` (o menu suspenso do app: o foco no primeiro item, as setas, o Esc e o foco de volta ao botão) e o `sala/EncerrarSala.tsx` (o molde de uma pergunta num `<dialog>` com o `alertdialog`).
- Produces:

```ts
// ReunioesCliente ganha:
/** Cancela a reunião como a pessoa da vez e relê a lista. O 404 (ela já não existe) também resolve, com a lista
 *  relida. Rejeita com o ErroChat nas outras falhas (o diálogo diz a falha). */
cancelar(codigo: string): Promise<void>;
```

A tela (pelo desenho das telas 1, 2 e 5: `Main.dc.html`, `Menu.dc.html` e `Cancelar.dc.html`):

- **Cada linha** ganha o "Copiar link" (que vira "Link copiado" por 2 s, pelo `vista.copiado`) e o botão do menu, com o nome "Mais opções de <assunto>" (ou "Mais opções de Reunião sem assunto"). **O "Entrar" não entra neste plano** (a escolha 1).
- **O menu** tem o nome "Opções de <assunto>": a linha do `valeAteTexto` (um texto, não um item) e o "Cancelar a reunião". **O "Abrir no navegador" entra na Task 10,** antes do "Cancelar a reunião". Na reunião sem o `valeAte` (não acontece com as marcadas), a linha não aparece.
- **No tamanho Mínimo,** a linha fica só com o botão do menu, e o "Copiar link" é o primeiro item do menu.
- **O cancelar** é um `alertdialog`: "Cancelar a reunião?", a linha "<assunto> · <o `quando`, com a primeira letra minúscula>" ("Planejamento de dezembro · hoje, 14:00"), o `textoDoCancelar`, o "Voltar" e o "Cancelar a reunião" (o vermelho `#c23b3b`, a escolha 14 da spec). O foco começa no "Voltar"; o Esc é o "Voltar"; o foco volta ao botão do menu.
- **A falha do cancelar** (sem resposta, um `5xx`, o `429`): "O servidor do chat não respondeu. Tente de novo.", num `alert` dentro do diálogo, que fica aberto. Enquanto o pedido está no ar, o "Cancelar a reunião" fica desligado.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/menu.spec.ts`)

```ts
test('o Copiar link copia o link e diz Link copiado por 2 s', …);
// navigator.clipboard.readText() é o link da reunião; o botão diz 'Link copiado' e, 2 s de relógio depois, 'Copiar link'.
test('o menu diz até quando o link vale e tem o Cancelar a reunião', …);
// O botão 'Mais opções de Planejamento de dezembro' abre o menu 'Opções de Planejamento de dezembro', com
// 'O link vale até hoje, 23:59'; o Esc fecha e devolve o foco ao botão; as setas e o Enter andam como nos outros menus do app.
test('no tamanho Mínimo, o Copiar link é do menu', …);   // 300×440: sem o botão na linha; o item do menu copia
test('o cancelar pergunta antes, com o assunto e a hora', …);
// 'Cancelar a reunião?', 'Planejamento de dezembro · hoje, 14:00', 'O link para de valer na hora.', 'Voltar' e
// 'Cancelar a reunião'; o foco no Voltar.
test('com a reunião acontecendo, o cancelar diz quantas pessoas saem', …);
// O page.route troca o GET /api/v1/reunioes: 3 pessoas → '…as 3 pessoas saem.'; 1 → '…a pessoa que está nela sai.'.
test('o Voltar deixa a reunião, e o Cancelar a reunião a tira da lista', …);
// Depois do Cancelar a reunião: a linha some, e o GET /api/v1/reunioes da ApiDeTeste não a tem mais.
test('o cancelar que falha fica aberto e diz O servidor do chat não respondeu', …);   // o page.route aborta o DELETE
test('a reunião que já não existe sai da lista sem erro', …);   // a ApiDeTeste a cancela antes; o clique fecha o diálogo
for (const tema of ['light', 'dark'] as const) test(`o menu e o cancelar não têm violações sérias (${tema})`, …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/menu.spec.ts`
Expected: FAIL (o "Copiar link" não existe).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/telas/Cancelar.tsx windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/app.css windows/ui/tests/reunioes/menu.spec.ts
git commit -m "feat(ui): o Copiar link, o menu da reunião e o cancelar"
```

---

### Task 10: O "Abrir no navegador", do menu e do campo do link

**Files:**
- Modify: `windows/ui/src/reunioes/cliente.ts` (o `abrirNoNavegador` e o `abrirComoConvidado`), `windows/ui/src/reunioes/telas/Aba.tsx` (o item do menu e o campo do link), `windows/ui/src/main.tsx` (o aviso curto), `windows/ui/src/app.css`
- Test: `windows/ui/tests/reunioes/navegador.spec.ts` (novo)

**Interfaces:**
- Consumes: o `passeDaReuniao` (Task 5); o `codigoDoTexto` (Task 6); o comando `reuniaoNavegador` (Tasks 2 e 4); o `ehParado` e o `pedir` (Task 7); o `avisarNaTela` do `main.tsx` (o aviso curto do app).
- Produces:

```ts
// reunioes/cliente.ts
/** `erro` null: nada a dizer (a pessoa trocou no meio, ou a aba sumiu). */
export type ResultadoDoNavegador = { ok: true } | { ok: false; erro: string | null; outraEmpresa: boolean };
// VistaReunioes ganha:
/** Um aviso curto para a tela (o toast do app); a `vez` sobe a cada aviso. */
avisoCurto: { texto: string; vez: number } | null;
// ReunioesCliente ganha:
/** Pede o passe como a pessoa da vez e manda o reuniaoNavegador com o código e o passe. Um pedido por código de
 *  cada vez. */
abrirNoNavegador(codigo: string): Promise<ResultadoDoNavegador>;
/** A reunião de outra empresa: o reuniaoNavegador sem o passe (a pessoa entra como convidada). */
abrirComoConvidado(codigo: string): void;
```

O que cada resposta do passe vira:

| A resposta | O que acontece |
|---|---|
| `200` | o `reuniaoNavegador` com o código e o passe; `{ ok: true }` |
| `404`, com a reunião na lista da pessoa | relê a lista: se ela continua lá, "O servidor do chat precisa ser atualizado para abrir reuniões pelo app."; se sumiu, "Este link não vale mais" |
| `404`, com um código que não é da lista | "Este link não vale mais" |
| `403 outraEmpresa` | "Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.", com o `outraEmpresa` verdadeiro |
| `403 semReunioes` | relê a lista (a aba some); `erro: null` |
| `429` | "Muitas tentativas. Espere um pouco para tentar de novo." |
| o `Parado` | nada é aberto; `erro: null` |
| sem resposta, um `5xx` ou outro erro | "O servidor do chat não respondeu. Tente de novo." |

A tela:

- **O menu** ganha o "Abrir no navegador", antes do "Cancelar a reunião". O erro dele sai no aviso curto do app (o `avisoCurto`).
- **O campo do link** fica no alto da lista (o desenho da tela 1): o nome "Entrar com o link de uma reunião" e, dentro dele, "Cole aqui o link de uma reunião". Com um texto no campo aparece o "Abrir no navegador"; o Enter no campo é o botão. O texto que o `codigoDoTexto` não aceita: "Este não é um link de reunião do Starsonic.", sem pedido nenhum. Os erros ficam num `alert` embaixo do campo; o da outra empresa vem com um "Abrir no navegador" que chama o `abrirComoConvidado`. Quando dá certo, o campo esvazia.
- **O passe** vai da resposta para o comando, e para mais lugar nenhum.
- **Com uma ligação em andamento,** o "Abrir no navegador" funciona do mesmo jeito (a escolha 14): quem põe a reunião em pausa é a Task 12.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/navegador.spec.ts`)

```ts
test('o Abrir no navegador do menu pede o passe e manda o reuniaoNavegador', …);
// O último comando é { cmd: 'reuniaoNavegador', codigo, passe } com o passe de 43 caracteres de [A-Za-z0-9_-].
// O passe é de verdade: o abrir da página (POST /api/v1/pagina/reunioes/<codigo> com {"passe": …}, como o
// video-servidor/e2e faz) responde 200 com o colega.nome da pessoa.
test('o campo aceita o link inteiro e só o código', …);
test('um texto que não é um link diz Este não é um link de reunião do Starsonic, sem pedir nada', …);
test('a reunião de outra empresa oferece o navegador sem o passe', …);
// Outra empresa cria a reunião: a frase da outra empresa e o botão; o clique manda { cmd: 'reuniaoNavegador', codigo },
// sem a chave passe.
test('o link que não vale mais diz Este link não vale mais', …);   // uma reunião cancelada
test('o servidor antigo diz que precisa ser atualizado', …);
// O page.route responde 404 ao passe de uma reunião que continua na lista.
test('as muitas tentativas e o servidor que não responde dizem cada um a sua frase', …);   // o page.route: 429 e abort
test('o passe não aparece no console, na tela nem em outro comando', …);
// Guarde as mensagens do console; depois de abrir: nenhuma tem o passe; o page.content() não tem o passe; no
// window.__comandos, só o reuniaoNavegador o tem.
test('a troca de pessoa no meio do pedido não abre nada', …);
// O page.route segura o POST do passe; troque a conta (o cenário chat-duas-contas); solte: nenhum reuniaoNavegador.
test('um segundo clique com o pedido no ar não pede outro passe', …);
for (const tema of ['light', 'dark'] as const) test(`o campo do link e os erros dele não têm violações sérias (${tema})`, …);
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/navegador.spec.ts`
Expected: FAIL (o "Abrir no navegador" não existe).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/cliente.ts windows/ui/src/reunioes/telas/Aba.tsx windows/ui/src/main.tsx windows/ui/src/app.css windows/ui/tests/reunioes/navegador.spec.ts
git commit -m "feat(ui): o Abrir no navegador, com o colega reconhecido pelo passe"
```

---

### Task 11: As reuniões abertas no navegador: o pedido no aviso do Windows e a resposta

**Files:**
- Modify: `windows/ui/src/reunioes/cliente.ts` (as reuniões abertas no navegador, os eventos, a conferência, o pedido que o aviso mostra e a resposta), `windows/ui/src/main.tsx` (o `abrir` das reuniões)
- Modify: `windows/ui/tests/reunioes/abrir.ts` (o ajudante que injeta eventos)
- Test: `windows/ui/tests/reunioes/pedidos.spec.ts` (novo)

**Interfaces:**
- Consumes: o `assinarSessao` (Task 7); o `abrirNoNavegador` e o `abrirComoConvidado` (Task 10); os comandos `reuniaoPedido` e a mensagem `reuniaoResposta` (Tasks 2 e 4); o `aceitarPedido`, o `recusarPedido` e o `participantesDaReuniao` (Task 5); o `page.routeWebSocket` com o `connectToServer`, como no `tests/chat/sem-conexao.spec.ts`.
- Produces:

```ts
// tests/reunioes/abrir.ts
/** Faz de conta que o computador está numa reunião aberta no navegador: o chat de teste não tem servidor de vídeo, e
 *  nele ninguém "está na reunião". Chame antes de abrir a página. Fica entre a página e o chat de verdade no WebSocket
 *  dos eventos (o molde é o do tests/chat/sem-conexao.spec.ts, com o Math.random em 0,5: a primeira nova tentativa sai
 *  1 s depois da queda) e responde ao GET …/participantes de cada reunião com as listas do último evento mandado (409
 *  foraDaReuniao antes do primeiro evento dela e depois do reuniaoAcabou). Um page.route do teste, posto depois dele,
 *  passa na frente. */
export async function comEventos(page: Page): Promise<{
  /** Entrega um evento à página, como se viesse do servidor. */
  mandar(evento: object): Promise<void>;
  /** Fecha a conexão dos eventos e recusa as próximas, até o `voltar`. */
  derrubar(): Promise<void>;
  voltar(): void;
}>;
```

O que o cliente guarda, só na memória, para cada reunião aberta no navegador (pelo "Abrir no navegador", ou conhecida por um evento): o assunto e o `valeAte` (ou que não são conhecidos); se o computador está nela, pelo que o app sabe; e os pedidos, na ordem em que chegaram, com os que já saíram do aviso.

As regras:

- **O `abrirNoNavegador` que dá certo** guarda a reunião entre as abertas no navegador, com o assunto e o `valeAte` da resposta do passe. O `abrirComoConvidado` não guarda nada: sem o passe, o computador não é reconhecido naquela reunião.
- **Os eventos** (todo evento das reuniões, neste plano, é de uma reunião aberta no navegador, e o servidor só os manda ao computador que está nela):
  - o `reuniaoParticipantes`: o computador está nela, e os `pedidos` do evento são os dela (os que já eram conhecidos ficam na ordem em que chegaram);
  - o `reuniaoPedido` põe um pedido, e o `reuniaoPedidoFim` o tira; os dois também dizem que o computador está nela;
  - o `reuniaoAcabou`: o computador não está mais nela, e os pedidos dela saem.
- **Um evento de uma reunião que o app não abriu** (o app foi reaberto com a reunião do navegador em andamento) a põe na lista: com o assunto e o `valeAte` da `vista.lista`, se ela é da pessoa; senão, com os dois desconhecidos.
- **A conferência.** O servidor não avisa o computador que saiu da reunião: o `reuniaoParticipantes` vai só a quem ficou nela (a escolha 18). Por isso o cliente pede o `participantesDaReuniao` de cada reunião em que o computador está: a cada 10 s, e na hora a cada `conectou` depois do primeiro (o protocolo, seção 11).

  | A resposta | O que acontece |
  |---|---|
  | `200` | o computador está nela, e os `pedidos` da resposta são os dela (os que acabaram saem do aviso) |
  | `409 foraDaReuniao` | a regra do "fora", abaixo |
  | `404` | a reunião sai da lista, com os pedidos dela |
  | o `Parado`, sem resposta ou outro erro | nada: a conferência seguinte tenta de novo |

- **A regra do "fora"** é a do `409 foraDaReuniao` de qualquer rota (a conferência, o aceitar, o recusar e a pausa da Task 12), numa reunião em que o computador estava: ele deixa de estar nela, e os pedidos dela saem. Numa reunião em que o computador não estava, o `409` não muda nada. A Task 12 acrescenta a esta regra a dúvida de depois de um reinício do chat.
- **O pedido que o aviso mostra** é o mais antigo que ainda não saiu do aviso, entre todas as reuniões. Quando ele muda, sai o `reuniaoPedido` (com o `escondida` verdadeiro; o `assunto`: o texto, o vazio na reunião sem assunto, ou `null` no desconhecido); sem nenhum, o `reuniaoPedido` sem o pedido. O mesmo pedido não é mandado duas vezes seguidas. O nome vai com até 120 caracteres e sem caracteres de controle.
- **A resposta** (a mensagem `reuniaoResposta`): o pedido sai do aviso na hora (o próximo aparece). O `fechar` não faz mais nada. O `aceitar` e o `recusar` chamam a rota, como a pessoa da vez:

  | A resposta da rota | O que acontece |
  |---|---|
  | `204`, `409 jaRespondido` ou `404` | nada (outro colega respondeu antes, ou o pedido acabou) |
  | `409 cheia` | o aviso curto "A reunião está cheia: ninguém mais entra agora."; o pedido continua fora do aviso |
  | `409 foraDaReuniao` | a regra do "fora" |
  | o `Parado` | nada |
  | sem resposta, um `5xx`, o `429` ou outro erro | o aviso curto "O servidor do chat não respondeu. Tente de novo.", e o pedido volta ao aviso |

- **A resposta de um pedido que o cliente não conhece** é ignorada.
- **O `abrir` com a `tela` `reunioes`** leva à aba Reuniões.
- **O `parou`** (a troca de conta, o chat desligado, o computador fora do chat): tudo isto é esquecido, a conferência para, e sai o `reuniaoPedido` sem pedido. As reuniões continuam no navegador, com a pessoa que entrou (a spec, 4.5).

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/pedidos.spec.ts`; a reunião é aberta pelo "Abrir no navegador" e os eventos entram pelo `comEventos`, depois do `esperarOsEventos`)

```ts
test('o pedido de uma reunião aberta no navegador vai ao aviso, com o nome e o assunto', …);
// O reuniaoParticipantes com um pedido da Maria Lima: o comando
// { cmd: 'reuniaoPedido', pedido: { id, nome: 'Maria Lima', assunto: 'Planejamento de dezembro' }, escondida: true }.
test('a reunião sem assunto manda o assunto vazio, e a que o app não abriu, null', …);
test('dois pedidos aparecem um de cada vez, o mais antigo primeiro', …);
// Depois da resposta ao primeiro (a mensagem reuniaoResposta empurrada), sai o reuniaoPedido do segundo.
test('o pedido respondido por outro colega sai do aviso', …);   // o reuniaoPedidoFim: o reuniaoPedido sem pedido
test('a reunião que acabou limpa o aviso', …);                   // o reuniaoAcabou
test('o pedido sai do aviso quando o computador sai da reunião, que o servidor não avisa', …);
// Com um pedido no aviso e o relógio pausado: o page.route passa a responder 409 foraDaReuniao ao GET …/participantes;
// runFor(10_000): o reuniaoPedido sem pedido. Noutro teste, o 200 sem aquele pedido: o mesmo.
test('o Aceitar do aviso chama a rota aceitar com o id, e o jaRespondido não é erro', …);
// O page.route guarda o POST …/aceitar (o corpo { pedido: id }) e responde 204; noutro teste, 409 jaRespondido:
// nenhum aviso curto. O Recusar chama a rota recusar.
test('o fechar tira o pedido do aviso sem chamar rota nenhuma', …);
test('a reunião cheia diz A reunião está cheia, e o pedido não volta ao aviso', …);
test('o servidor que não responde diz a frase, e o pedido volta ao aviso', …);
test('a troca de conta limpa o aviso, e a resposta que chega depois não sai', …);
// Com um pedido no aviso, troque a conta: o reuniaoPedido sem pedido; a mensagem reuniaoResposta empurrada depois
// não chama rota nenhuma.
test('o clique fora dos botões do aviso leva à aba Reuniões', …);   // a mensagem { type: 'abrir', tela: 'reunioes' }
test('na volta da conexão, a conferência sai na hora', …);
// O relógio pausado; o derrubar, o voltar e runFor(1_000) (a nova tentativa): um GET …/participantes da reunião em
// que o computador está, sem esperar os 10 s.
test('nada do pedido vai ao console', …);
// Nenhuma mensagem que a página escreve tem o id, o nome nem o assunto (as linhas "Failed to load resource" do
// navegador ficam de fora).
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/pedidos.spec.ts`
Expected: FAIL (nenhum `reuniaoPedido` sai).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/cliente.ts windows/ui/src/main.tsx windows/ui/tests/reunioes/abrir.ts windows/ui/tests/reunioes/pedidos.spec.ts
git commit -m "feat(ui): quem quer entrar na reunião do navegador, no aviso do Windows"
```

---

### Task 12: A pausa da reunião aberta no navegador numa ligação

**Files:**
- Create: `windows/ui/src/reunioes/pausa.ts`
- Modify: `windows/ui/src/reunioes/cliente.ts` (a pausa e a dúvida), `windows/ui/src/main.tsx` (as ligações do estado para o cliente), `windows/ui/src/screens/Ligacao.tsx` e `windows/ui/src/app.css` (a frase na tela da ligação)
- Modify: `windows/ui/src/chat/eventos.ts` e `windows/ui/src/chat/cliente.ts` (o aviso de que o servidor vai desligar), `windows/ui/tests/reunioes/abrir.ts` (o `derrubar` com o `desligando`)
- Test: `windows/ui/tests/reunioes/pausa.spec.ts` (novo; a regra pura roda no Node, o resto na tela)

**Interfaces:**
- Consumes: as reuniões abertas no navegador, a conferência, a regra do "fora" e o `comEventos` (Task 11); o `assinarSessao` (Task 7) e o `conectarEventos` do `chat/eventos.ts`; o `pausarReuniao` (Task 5); o `CallState` e o `CallCard` do `state.ts`; o `mudarEstado` do `tests/helpers.ts` e os estados de ligação dos testes de hoje (`tests/call.spec.ts`); a spec, 7.8 e 7.9, com as notas de 23/11.
- Produces:

```ts
// reunioes/pausa.ts
/** A reunião fica em pausa do começo de uma ligação feita, ou do atender de uma recebida, até a última acabar:
 *  existe um cartão (o de cima ou o segundo) que não é uma recebida ainda tocando. A sala de vídeo de pé conta como
 *  uma ligação. */
export function haPausa(l: CallState | null): boolean;
/** O `vez` de uma pausa: 12 caracteres de [A-Za-z0-9], sorteados pelo crypto.getRandomValues. */
export function novaVez(): string;

// ReunioesCliente ganha:
/** As ligações do estado da ponte, a cada estado. */
ligacoes(l: CallState | null): void;
// VistaReunioes ganha:
/** A frase na tela da ligação: a reunião do navegador continua ouvindo a pessoa. */
ouvindoNoNavegador: boolean;

// chat/eventos.ts: o conectarEventos ganha um aviso opcional
/** O servidor avisou que vai desligar: a conexão dos eventos fechou com o código 1001 (o protocolo, seção 7). Vem
 *  antes de a nova tentativa ser marcada; os outros fechamentos não avisam. */
desligando?(): void;
// chat/cliente.ts: o assinarSessao ganha o mesmo aviso
assinarSessao(o: { evento(e: EventoDaReuniao): void; conectou(): void; desligando?(): void; parou(): void }): () => void;

// tests/reunioes/abrir.ts: o derrubar do comEventos ganha
/** Com o `desligando`, fecha com o código 1001 e esquece as reuniões, como o servidor que reiniciou (o GET
 *  …/participantes volta a responder 409 foraDaReuniao até o próximo evento mandado); sem ele, é uma queda da rede. */
derrubar(o?: { desligando?: boolean }): Promise<void>;
```

As regras (a spec, 7.9):

- **Quem recebe a pausa:** cada reunião aberta no navegador cujo link ainda vale (o `valeAte` não conhecido, ou no futuro), esteja o computador nela ou não, e também as conhecidas só pelos eventos.
- **Quando a pausa começa** (o `haPausa` passa a verdadeiro): um `vez` novo, e o `pausarReuniao(codigo, true, vez)` para cada uma, na hora e de novo a cada 10 s enquanto a pausa dura:

  | A resposta | O que acontece |
  |---|---|
  | `204` | a pausa chegou àquela reunião, e a dúvida dela acaba |
  | `409 foraDaReuniao` | a regra do "fora" da Task 11, com a dúvida, abaixo. **Não é para sempre:** a página pode estar na entrada, voltando de uma queda ou no "Você saiu da reunião", e a rodada seguinte tenta de novo |
  | `404` | a reunião sai da lista (ela não existe mais) |
  | o `Parado` | nada |
  | sem resposta, um `5xx`, o `429` ou outro erro | a tentativa falhou (a frase, abaixo), e a rodada seguinte tenta de novo |

- **Na hora em que um evento mostra, durante uma pausa, que o computador entrou numa reunião,** a pausa dela sai sem esperar os 10 s. É assim que a reunião do "Abrir no navegador" com uma ligação em andamento (a escolha 14) entra em pausa.
- **Quando a pausa acaba:** o `pausarReuniao(codigo, false, vez)`, uma vez, para cada uma; as falhas não são repetidas (a página fica com o "Voltar para a reunião", a spec, 12.1, item 9).
- **A dúvida** (a escolha 9). O cliente guarda, para cada reunião em que o computador está, se o servidor avisou que ia desligar (o `desligando`) depois da última vez em que o app o viu nela (um evento dela, ou um `200` da conferência). Na regra do "fora" da Task 11: com esse aviso, fica a dúvida, com a hora em que ela começou (o chat reiniciou e esqueceu a reunião, e a página do navegador pode continuar nela, sem receber a pausa); sem ele, não há dúvida (a pessoa saiu, a rede caiu ou o PC dormiu). A dúvida acaba com um evento daquela reunião, com um `204` da pausa dela, quando o link dela vence, ou 12 horas depois de começar.
- **O `ouvindoNoNavegador`** é verdadeiro enquanto a pausa dura e, em alguma reunião cujo link ainda vale, uma destas vale: o computador está nela e a última tentativa de pausá-la que terminou falhou; ou ela está com a dúvida.
- **O `parou`:** as repetições param, e nada mais é mandado.
- **Na tela da ligação,** com o `ouvindoNoNavegador`: "A reunião no navegador continua ouvindo você. Desligue o microfone lá.", num `status`.

- [ ] **Step 1: Escreva os testes que falham** (`tests/reunioes/pausa.spec.ts`; os eventos e o `participantes` pelo `comEventos`; o `page.route` responde ao `POST …/pausa` e guarda os corpos; o relógio pausado pelo `pararORelogio`)

```ts
test('a regra da pausa: uma ligação só tocando não pausa nada', …);
// No Node: null → false; uma recebida tocando → false; uma feita chamando → true; uma atendida → true; uma atendida
// com outra recebida tocando → true; uma em espera → true; a sala de vídeo de pé → true.
test('o vez tem 12 caracteres de letras e números, e muda a cada pausa', …);
test('atender uma ligação pausa a reunião aberta no navegador, e de novo a cada 10 s', …);
// A ligação atendida: um POST com { pausada: true, vez }; runFor(10_000): outro, com o mesmo vez; runFor(10_000): outro.
test('o fim da ligação manda o pausada falso com o mesmo vez, e as repetições param', …);
test('uma ligação só tocando não manda nada', …);
test('o 409 não é para sempre: a rodada seguinte tenta de novo', …);
test('a pausa vai na hora em que um evento mostra que o computador entrou', …);
// Com a ligação em andamento e a rota respondendo 409: o reuniaoParticipantes daquela reunião → um POST na hora,
// sem avançar o relógio.
test('a reunião cujo link venceu não é tentada', …);   // o page.route troca o valeAte da resposta do passe
test('sem o chat, a tela da ligação diz que a reunião do navegador continua ouvindo', …);
// O computador na reunião, e a rota da pausa abortada: a frase aparece; com a rota respondendo 204 na rodada
// seguinte, some. Com o computador fora dela (nenhum evento), a rota abortada não mostra a frase.
test('depois de um reinício do chat, a tela da ligação avisa, até o computador voltar à reunião', …);
// O computador na reunião (o reuniaoParticipantes); o derrubar com o desligando; uma ligação atendida, com a pausa
// respondendo 409 foraDaReuniao (o chat esqueceu a reunião): a frase aparece, e fica depois do voltar e de
// runFor(1_000). O reuniaoParticipantes daquela reunião: a frase some.
test('quem saiu da reunião, ou ficou sem rede, não deixa dúvida', …);
// O computador na reunião; o GET …/participantes passa a responder 409 e runFor(10_000) (a conferência); uma ligação
// atendida, com a pausa respondendo 409: nenhuma frase. Noutro teste, o mesmo depois de um derrubar sem o desligando
// (uma queda da rede) e do voltar: nenhuma frase.
test('a dúvida acaba 12 horas depois', …);
// A reunião com o valeAte três dias adiante (senão quem acaba com a dúvida é o link vencido) e a hora da página pelo
// page.clock.install; a dúvida como no teste do reinício; a ligação acaba; page.clock.fastForward de 11 horas: outra
// ligação ainda mostra a frase; mais 2 horas: a ligação seguinte não mostra.
test('a troca de conta para a pausa', …);   // depois da troca: runFor(30_000) e nenhum POST
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd windows/ui && npm run build && npx playwright test tests/reunioes/pausa.spec.ts`
Expected: FAIL (o `pausa.ts` não existe).

- [ ] **Step 3: Implemente.**

- [ ] **Step 4: Rode e veja passar, com a suíte inteira**

Run: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add windows/ui/src/reunioes/pausa.ts windows/ui/src/reunioes/cliente.ts windows/ui/src/chat/eventos.ts windows/ui/src/chat/cliente.ts windows/ui/src/main.tsx windows/ui/src/screens/Ligacao.tsx windows/ui/src/app.css windows/ui/tests/reunioes/abrir.ts windows/ui/tests/reunioes/pausa.spec.ts
git commit -m "feat(ui): a ligação pausa a reunião aberta no navegador"
```

---

### Task 13: Os documentos

**Files:**
- Modify: `docs/ponte-windows.md` (a seção "As reuniões (0.5.0)" e a lista dos comandos do PC recusados no iPhone)
- Modify: `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md` (só notas datadas)
- Modify: `windows/ui/tests/reunioes/*.spec.ts` (as capturas das telas, pelo `capturar` do `tests/helpers.ts`)

**Interfaces:**
- Consumes: tudo o que as Tasks 2 a 12 construíram; o formato das seções "Os comandos do chat", "As mensagens do chat" e "O campo do estado" do `docs/ponte-windows.md`.
- Produces: nada para o código.

- [ ] **Step 1: A ponte.** Na seção "As reuniões (0.5.0)" do `docs/ponte-windows.md`, antes do "Para o executável: o que a janela principal deixa":
  - **"Os comandos das reuniões":** os quatro, com os campos, os limites e o que o núcleo faz (a tabela da Task 2), que só valem no Windows, e as linhas do diagnóstico.
  - **"As mensagens das reuniões":** o `reuniaoResposta` e o `abrir` com a `tela` `reunioes`.
  - **"O campo do estado":** o `reuniao`, só com um pedido para mostrar, e que ele vive só na memória do núcleo, até a resposta, o `reuniaoPedido` sem pedido ou o `ready` da janela principal.
  - **"O aviso do canto com um pedido":** a regra do `ShowsNotice` (a ligação tocando como hoje; o pedido com a janela fora da frente ou com a reunião escondida), que a página do aviso desenha a ligação quando as duas coisas valem, e que o `reuniaoMostrar` traz a janela para a frente.
  - **"O navegador":** o endereço que o executável monta (o endereço do chat, `/r/`, o código e, com o passe, `#p=` e o passe), e que nada dele vai ao diagnóstico.
  - Em "Os comandos do PC, recusados no iPhone": os quatro comandos novos.
  - Em "Avisos e toque": uma frase que leva à regra nova do aviso do canto.
  Confira cada frase contra o código antes de escrever.

- [ ] **Step 2: A spec, só com notas datadas** (nenhuma linha aprovada é tirada nem mudada: `git diff 4bca909 HEAD -- docs/superpowers/specs/` só pode mostrar linhas a mais):
  - na 13, depois da nota "a entrega 2 em três planos": o plano do app foi cortado em dois (este, o 3a, e o 3b), e o que cada um entrega;
  - na 4.2: nesta metade a lista não tem o "Entrar" (a escolha 1 deste plano), e, no Mínimo, o "Copiar link" é do menu;
  - na 4.3: o "Abrir no navegador" funciona com uma ligação em andamento (a escolha 14);
  - na 7.6: a aba que só aparece depois da primeira resposta do chat (a escolha 8), e a conferência de 10 s pelo `participantes`, porque o servidor não avisa o computador que saiu da reunião (a escolha 18);
  - na 7.7: os nomes que os comandos ganharam, que copiar o link ficou com a página do app, e a regra do aviso com a reunião do navegador (a escolha 6);
  - na 7.9: a regra do app para o `409` (cada rodada tenta de novo todas as reuniões abertas no navegador cujo link ainda vale), a pausa na hora do evento, a dúvida depois de um reinício do chat (a escolha 9) e o app reaberto com a reunião no navegador (a escolha 19).

- [ ] **Step 3: As capturas.** Em cada teste de tela dos temas claro e escuro das Tasks 4 e 7 a 10, chame o `capturar(page, '<nome>', tema)`, com os nomes `reunioes-aviso`, `reunioes-aba`, `reunioes-primeira-vez`, `reunioes-nova`, `reunioes-menu`, `reunioes-cancelar` e `reunioes-link`. Quem conduz o plano monta com elas a imagem para o responsável comparar com o quadro (as telas 1 a 5 e 11).

- [ ] **Step 4: Rode as provas**

Run: `python3 build/check_source_text.py && cd windows/ui && npm run typecheck && npm run build && npx playwright test`
Expected: `ok`, e tudo passa.

- [ ] **Step 5: Commit**

```bash
git add docs/ponte-windows.md docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md windows/ui/tests/reunioes
git commit -m "docs: os comandos das reuniões na ponte, e as notas da spec"
```
