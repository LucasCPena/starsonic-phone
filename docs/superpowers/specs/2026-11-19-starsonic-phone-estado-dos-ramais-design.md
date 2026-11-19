# Starsonic Phone — o estado dos ramais na administração do chat — especificação de design

- **Data:** 19/11/2026
- **Status:** aprovada em 19/11. O pedido é de 18/11, às 17:48. Em 19/11 o responsável disse para que serve ("consigo monitorar os clientes"), confirmou que esses clientes usam o app do Windows com o chat ligado, aceitou a proposta dos três estados, só com a página, sem aviso por e-mail ("pode fazer", 00:24), e, às 03:50, com este desenho na mão, respondeu "Continue". O plano da primeira entrega (o servidor do chat e as páginas) é o `docs/superpowers/plans/2026-11-19-estado-dos-ramais-servidor.md`. O que o plano mudou neste desenho está no fim da seção 13. **A primeira entrega foi construída em 19/11:** a operação nova do protocolo, a memória dos estados no servidor do chat e as duas páginas, para a versão `0.2.0-rc.5` do chat (quem publica é o responsável). Com os apps de hoje, as páginas mostram "No chat" e "Offline". A segunda entrega, a do app do Windows (`docs/superpowers/plans/2026-11-19-estado-dos-ramais-app-windows.md`), é a que traz o "Online" e o "Sem registro". **A revisão final da primeira entrega, também em 19/11,** achou quatro pontos importantes e catorze pequenos, nenhum crítico. Sete foram corrigidos: o que isso mudou neste desenho está nas escolhas 18 a 23, no fim da seção 13. O que ficou para depois está na seção 14. **A segunda entrega foi construída em 19/11:** o app do Windows diz ao chat o estado do ramal da conta em uso (a peça `windows/ui/src/chat/ramal.ts`), a cada abertura do canal, a cada mudança (com a espera de 2 s) e de novo depois de uma falha, sem nada aparecer para a pessoa. É para a versão do app seguinte à `0.4.0-rc.1` (quem publica é o responsável). O plano é o `docs/superpowers/plans/2026-11-19-estado-dos-ramais-app-windows.md`. Antes dela, em 19/11, a `main` recebeu esta branch e a das videochamadas do app (`video-etapa-3`), e a segunda entrega foi feita em cima do app com vídeo.
- **Telas:** o quadro "Starsonic Phone — telas do chat", na linha "O estado dos ramais": as duas telas novas da página de administração.
- **Base:** a spec do chat (`2026-11-04-starsonic-phone-chat-design.md`), que deixou "quem está online" fora da 1ª versão. Esta spec traz isso só para a página de administração.

## 1. Contexto

A página de administração do chat mostra, em cada empresa, as pessoas, o ramal de cada uma, os computadores e a "última vez". O responsável quer usar essa página para monitorar os clientes: ver, sem ninguém ligar reclamando, quais ramais estão fora do ar.

Hoje o servidor do chat já sabe, a cada instante, quais computadores estão com o app aberto e ligados nele. Ele não sabe se o ramal está registrado na central: o chat e as ligações não dependem um do outro. Quem sabe é o app, que já mostra isso na bolinha dele.

## 2. Objetivos

1. Mostrar, na página de cada empresa, o estado de cada ramal: online, sem registro ou offline.
2. Mostrar, na primeira página, quantos ramais estão em cada estado em cada empresa, e a lista dos que estão sem registro agora, de todas as empresas juntas.
3. Não guardar nada novo no banco, e não mostrar nada das ligações.

## 3. Critérios de sucesso

1. O app é fechado: em até 30 s a página mostra a pessoa offline.
2. O PC perde a rede: em até 2 minutos a página mostra a pessoa offline.
3. O app está aberto e o ramal fica mais de 1 minuto sem registrar: a página da empresa mostra "Sem registro", com o que o app diz, e a primeira página põe o ramal na lista "Sem registro agora".
4. O ramal volta a registrar: em até 30 s a página mostra "Online".
5. Uma pessoa com dois computadores, um aberto e registrado e outro fechado, aparece online.
6. Com o JavaScript desligado no navegador, as duas páginas continuam certas: só não se atualizam sozinhas.
7. O banco não ganha tabela nem coluna. Os registros do servidor não ganham nome, ramal nem estado de ninguém.

## 4. O que a versão entrega

### 4.1 As telas

As duas estão no quadro, e valem como referência do que aparece e de onde.

- **A primeira página (as empresas):**
  - um cartão de número a mais: quantos ramais estão sem registro agora (ele some quando são zero);
  - o cartão "Sem registro agora": uma linha para cada ramal nesse estado, de todas as empresas, com a empresa, o nome, o ramal, há quanto tempo e o que o app diz. O mais antigo vem primeiro. Com mais de 50, mostra os 50 e diz quantos faltam. Sem nenhum, o cartão diz "Nenhum ramal sem registro agora.";
  - na tabela das empresas, a coluna "Ramais agora", com as contas da empresa: online, sem registro (só quando há), no chat (só quando há) e offline. As contas somam o número de pessoas da empresa.
- **A página de uma empresa:**
  - as mesmas contas, ao lado do título da tabela;
  - a coluna "Estado" no lugar da "Última vez": o desenho, o nome do estado e uma segunda linha com o tempo;
  - uma bolinha em cada computador, com o estado daquele computador;
  - a legenda dos estados, embaixo da tabela.
- **Nas duas:** a frase que diz que a página se atualiza sozinha a cada 30 segundos, e que o celular e os aparelhos de mesa não aparecem. Sem o JavaScript, a parte do "se atualiza sozinha" não aparece.

### 4.2 Os estados

Cada computador ligado ao chat está num destes estados:

| Estado do computador | Quando |
|---|---|
| Registrado | O app está ligado ao chat e disse que o ramal está registrado. |
| Sem registro | O app está ligado ao chat e diz que o ramal está sem registrar há 1 minuto ou mais. |
| Registrando | O app está ligado ao chat e diz que o ramal está sem registrar há menos de 1 minuto. É o que acontece toda vez que o app abre. |
| Sem dado | O app está ligado ao chat e não disse nada sobre o ramal. É um app antigo. |
| Fora | O chat não tem o computador ligado nele agora. |

**O tempo é o do app, e não o do chat.** Junto com o estado, o app diz há quantos segundos o ramal está assim: registrado, ou sem registrar. É esse tempo que a página mostra, e é por ele que o minuto do "Sem registro" é contado. Duas coisas saem daí:

- Um ramal que fica trocando entre "Conectando…" e "Erro no cadastro" não zera o tempo: ele continua sem registrar desde a primeira falha. Só registrar de novo zera.
- Depois de o chat reiniciar, ou de a rede do PC piscar, o app se liga de novo e manda o estado com o tempo certo. Um ramal fora há 3 horas volta à lista como "há 3 h", e não como "há 0 min".

O estado da pessoa vem dos computadores em que ela é a pessoa da vez, nesta ordem. Vale a primeira linha que bate:

| A pessoa aparece como | Quando | A segunda linha |
|---|---|---|
| **Online** (bolinha verde) | Algum computador dela está registrado. | "há 2 h": desde quando está assim. |
| **Sem registro** (triângulo vermelho) | Algum computador dela está sem registro. | "há 12 min · o app diz “Conectando…”". |
| **No chat** (bolinha ciano) | Algum computador dela está registrando ou sem dado. | "registrando o ramal…", ou "o app é antigo e não diz o ramal". |
| **Offline** (anel cinza) | Todos os computadores dela estão fora. | "última vez ontem, 18:02", como hoje. |

Com mais de um computador no mesmo estado, a segunda linha é a do que está assim há mais tempo: o registrado há mais tempo, no "Online"; o sem registro há mais tempo, com o que ele diz, no "Sem registro". No "No chat", vale "registrando o ramal…" se algum computador está registrando.

O que o app diz, na segunda linha do "Sem registro":

| O app manda | A página escreve |
|---|---|
| `conectando` | Conectando… |
| `erro` | Erro no cadastro |
| `semConexao` | Sem conexão com a central |

Cada estado tem um desenho e um texto diferentes. A cor nunca diz o estado sozinha.

**Quem entra na conta.** As linhas e as contas são as das pessoas que a página da empresa já lista hoje, as que entraram no chat e não foram tiradas dele. Cada pessoa é um ramal. Uma pessoa sem computador nenhum (todos foram tirados) aparece offline, com "sem computador no chat" na segunda linha: a "última vez" de uma pessoa é a dela nos computadores, e ela não tem nenhum.

**O computador compartilhado.** A página lista, em cada pessoa, todos os computadores em que ela já entrou. Um computador só conta para a pessoa quando está ligado ao chat como ela, agora. Na linha de quem já usou aquele PC e não é a pessoa da vez, ele aparece fora.

### 4.3 O comportamento

- **O app** manda o estado do ramal ao chat toda vez que o canal dos eventos dele com o chat abre (a primeira vez e cada volta), depois de cada troca de conta, e a cada mudança. Uma mudança espera 2 s antes de ir, e só a última vai: um ramal que pisca não vira dez pedidos.
- **O app conta o tempo.** Ele guarda o instante em que o ramal passou de registrado para sem registrar, ou o contrário, e manda os segundos desde então. Logo depois de abrir, o tempo conta desde que o app abriu.
- **O chat** guarda o último estado de cada computador ligado nele, na memória, com o instante que sai da conta "agora menos os segundos". Quando o computador se desliga do chat, o estado é esquecido.
- **A página** é montada no servidor, como hoje, com o que a memória tem naquela hora. Um arquivo pequeno de JavaScript busca a página de novo a cada 30 s e troca o conteúdo, sem mexer na rolagem: nem na da janela, nem na de uma tabela que rola para o lado numa tela estreita.
  - Ele troca só as partes que mudam sozinhas (os números, as listas e as tabelas). O cartão do código da empresa, com o `Copiar o código`, e o de apagar a empresa ficam como estão.
  - Ele não troca nada enquanto a pessoa está num campo, nem enquanto ela anda com o teclado por um botão ou um link de um formulário ou de uma parte que seria trocada (um link `Abrir` alcançado pelo teclado, por exemplo). O foco que um clique do mouse deixa num botão ou num link não segura a troca. Ele também não troca nada enquanto o ponteiro está em cima de um botão de formulário de uma dessas partes (o `Tirar do chat`, o `×` de um computador): a troca pode mudar as linhas de lugar, e esses botões não têm volta. Se a espera passar de uma rodada, a página avisa desde quando está sem atualizar, e por quê.
  - Se a busca falha, a página avisa desde quando está sem atualizar, e continua tentando a cada 30 s.
  - O aviso é uma faixa presa embaixo da janela: aparece também com a página rolada, e não empurra o conteúdo. Com ele na tela, o que recebe o foco do teclado fica acima dele.
  - Se a sessão da administração venceu (ela dura 12 horas) ou a empresa foi apagada, a página se recarrega: aparece a entrada, ou a página de "não encontrada". A atualização automática não estica a sessão. Com várias abas abertas, todas vão para a entrada, e a entrada vale em qualquer uma delas; quem entrou por uma e manda a entrada de outra vai para a lista.
  - O estilo, os scripts e o logo da administração levam no endereço uma marca do conteúdo deles (`?v=`, o começo do SHA-256). Depois de uma atualização do chat, o navegador pede os arquivos novos, e uma página que ficou aberta se recarrega inteira quando vê que a página que chegou pede outro estilo ou outro script. A página aberta de uma versão anterior à `0.2.0-rc.5` não tem esse script: nessa atualização, quem recarrega é a pessoa.
- **Depois de o chat reiniciar,** todos podem aparecer offline por até cerca de um minuto, e às vezes um pouco mais, até os apps se ligarem de novo e mandarem o estado, já com o tempo certo: cada app tenta de novo em esperas que crescem (1, 2, 5, 10 e 30 s, cada uma com metade a mais ou a menos), e a página busca a cada 30 s.

## 5. Fora do escopo

- Avisar por e-mail, por mensagem ou por som quando um ramal fica sem registro. Fica para depois, se a página não bastar.
- O histórico: quando caiu, quando voltou, quantas vezes.
- Mostrar quem está online para as pessoas, dentro do app.
- O celular e os aparelhos de mesa: eles não entram no chat.
- Se a pessoa está em ligação ou com o "Não perturbe" ligado. A página de administração não mostra nada das ligações.
- Perguntar o registro à central do cliente. O servidor do chat não tem acesso a ela.

## 6. Os caminhos

**A. O app conta ao chat o estado do ramal (o escolhido).** Uma operação nova no protocolo, a memória no servidor e as duas páginas.

- A favor: mostra o caso que mais interessa para monitorar, que é o app aberto com o ramal sem registrar.
- O custo: pede uma versão nova do app do Windows. Até o app ser atualizado em cada PC, a página mostra só "No chat" ou "Offline" para ele.

**B. Só o servidor: online ou offline pela ligação do app com o chat.** Não muda o app nem o protocolo.

- A favor: sai mais rápido.
- Contra: um app aberto com o ramal fora do ar apareceria "online". É o contrário do que o responsável quer ver.
- O caminho A já contém este: a parte do servidor fica pronta primeiro, e mostra "No chat" e "Offline" para os apps de hoje.

**C. O app mandar o estado pelo WebSocket dos eventos.** Hoje esse WebSocket só leva eventos do chat para o app. Passar a ler mensagens do app nele muda uma peça que está estável, para ganhar pouco. Fica a operação por HTTP, como todas as outras do protocolo.

**D. Guardar o estado no banco, com o histórico.** Não agora: o pedido é ver o estado de agora, e um histórico de presença das pessoas é um dado a mais para cuidar.

## 7. Arquitetura

### 7.1 O protocolo (a operação nova)

**Dizer o estado do ramal** — `PUT /api/v1/computadores/eu/ramal`, com a chave do computador.

- Corpo: `{"estado": "erro", "segundos": 734}`.
  - `estado`: `conectado`, `conectando`, `erro` ou `semConexao`.
  - `segundos`: há quantos segundos o ramal está registrado (com o `conectado`) ou sem registrar (com os outros três). Um inteiro de 0 a 31.536.000 (um ano).
- `204`, sem corpo.
- `400 invalido`: um valor fora da lista, os segundos fora da faixa, ou um corpo que não é esse JSON (`campo` igual a `estado` ou `segundos`).
- `409 pessoa`: ninguém entrou nesse computador ainda (como nas outras operações que precisam da pessoa).
- `409 semLigacao`: o computador não está com o canal dos eventos aberto (nem abrindo) agora. O chat só guarda o estado de quem está ligado nele. O app manda de novo quando o canal abrir.
- `429 limite`: mais de 30 por minuto, por computador. Esse limite é só desta operação, além do limite geral.

O estado é do computador, para a pessoa da vez dele. Uma troca de pessoa (`POST /api/v1/pessoas/eu`) apaga o estado guardado: o app manda de novo.

A ordem do app é sempre: abrir o canal dos eventos, e só então dizer o estado. O servidor põe o computador no hub antes de o canal abrir (o `Reservar`), então um estado mandado logo depois do "abriu" nunca chega cedo demais.

Um app que recebe `404` nessa operação está falando com um chat antigo. Ele para de mandar até a próxima vez em que se ligar ao chat, e não mostra erro nenhum.

### 7.2 O servidor do chat

- **O hub dos eventos** (`internal/eventos`) passa a dizer quais computadores estão ligados agora (com o canal aberto, ou abrindo: do `Reservar` em diante) e como qual pessoa.
- **A memória dos estados fica dentro do hub,** na ligação de cada computador: o último estado que o app disse, o instante desde quando ele vale (agora menos os segundos que o app mandou, pelo relógio do servidor que os testes já trocam) e a pessoa para quem ele foi dito. Assim, o estado some junto com a ligação, sem aviso nenhum entre duas peças e sem corrida entre o pedido do app e o desligamento. Três regras:
  - o estado só aparece enquanto a pessoa da vez do computador é a pessoa para quem ele foi dito (é assim que a troca de pessoa o apaga);
  - quando uma ligação nova do mesmo computador toma o lugar da antiga, ela herda o estado, e a antiga, que fecha depois, não apaga nada;
  - quando a ligação sai do hub sem outra no lugar (o app fechou, a rede caiu, o computador foi tirado do chat, o servidor vai desligar), o estado vai junto.
- **A operação** (`internal/api`) confere a chave, o limite, a pessoa e o corpo, e escreve no hub. Se o computador não está no hub, responde `409 semLigacao`. Quando mais de um erro cabe, vale o primeiro desta ordem: `401 chave`, `429 limite`, `409 pessoa`, `400 invalido`, `409 semLigacao`.
- **A página de administração** (`internal/admin`) junta o que o banco já dá (as empresas, as pessoas, os computadores, a última vez) com a memória, e calcula os estados e as contas da seção 4.2. A regra dos estados fica numa função só, sem banco e sem HTTP, para os testes. A primeira página lê as pessoas e os computadores de todas as empresas com um número fixo de consultas, e não com uma consulta por empresa.
- **O JavaScript da atualização** é um arquivo externo, como o `copiar.js`: a regra de segurança das páginas (CSP) não deixa script dentro da página.

### 7.3 O app do Windows

- A parte do app que fala com o chat (`windows/ui/src/chat/`) já conhece a conta em uso. Ela passa a receber também o estado da conta (o mesmo que a bolinha usa) e a mandar a operação nova, com a regra da seção 4.3.
- O chat do app só se liga com uma conta em uso que já registrou neste computador. Por isso, um computador ligado ao chat sempre tem um ramal com um dos quatro estados: não existe o caso "ligado ao chat e sem conta".
- A conversão do estado da conta para o valor do protocolo: `conectado`, `conectando` e `erro` vão como estão, e `sem_conexao` vira `semConexao`. O aviso de "sem internet" do Windows não entra: sem internet, o app não alcança o chat, e a pessoa aparece offline.
- O tempo: a parte do chat guarda o instante da última passagem entre "registrado" e "sem registrar" da conta em uso, pelo relógio que não anda para trás, e zera esse instante quando a conta em uso muda.
- Uma falha ao mandar (sem rede, um `409 semLigacao`, um `429`, um `5xx`) é tentada de novo com a espera que o chat do app já usa. Ela nunca aparece para a pessoa.

## 8. Os valores

| O quê | Valor |
|---|---|
| A atualização da página | a cada 30 s |
| O tempo sem registrar para virar "Sem registro" | 60 s |
| A espera do app antes de mandar uma mudança | 2 s |
| O limite da operação | 30 por minuto, por computador |
| Os segundos que o app pode mandar | de 0 a 31.536.000 (um ano) |
| As linhas do cartão "Sem registro agora" | até 50 |
| O tempo para montar a primeira página, com 200 empresas e 5.000 pessoas | menos de 1 s, no teste |

O hub já fecha a ligação de um computador que não responde: ele manda um ping a cada 25 s e espera a resposta por até 60 s. Com a atualização da página a cada 30 s, um PC sem rede aparece offline em até 2 minutos, sem valor novo.

## 9. Segurança e privacidade

- A operação usa a chave do computador, como todas. Um computador só fala do próprio estado.
- O estado é um de quatro nomes fixos, e o tempo é um número. Nenhum texto livre vai do app para a página.
- Nada vai para o banco. Reiniciar o chat apaga tudo o que esta versão guarda.
- Os registros do servidor não ganham nome, ramal nem estado. O diagnóstico do app não muda.
- A página continua só para quem entra na administração, e continua sem mostrar conversa nenhuma.

## 10. Erros e testes

**Testes automáticos:**

- **O servidor:** a operação (cada valor, o valor errado, os segundos fora da faixa, sem chave, sem pessoa, o computador que não está ligado, o limite, a troca de pessoa que apaga); o hub (quem está ligado, o estado que some com a ligação, a ligação antiga que fecha depois da nova e não apaga nada); a função dos estados, com o relógio de teste (a tabela inteira da seção 4.2, o minuto do "Sem registro" contado pelos segundos do app, a pessoa com dois computadores e qual tempo ela mostra, o computador compartilhado, que só conta para a pessoa da vez, o app antigo); as duas páginas (os estados, as contas, a lista, a ordem, o corte nos 50, o cartão vazio, e o tempo da primeira página com 200 empresas e 5.000 pessoas).
- **O JavaScript da atualização,** no navegador, contra o chat de verdade: que ele troca o conteúdo, que não troca com o foco do teclado num formulário ou num `Abrir` (e troca com o foco de um clique com o Ctrl), que não troca com o ponteiro em cima de um botão de formulário, o aviso quando a busca falha (com a página rolada, sem empurrar o conteúdo, e sem esconder o que recebe o foco), a rolagem para o lado que fica onde estava, a sessão vencida (com uma aba e com duas), a empresa apagada, a página que se recarrega quando o chat muda de versão, e que o `Tirar do chat` e o `Copiar o código` continuam funcionando depois de uma troca.
- **O app:** a conversão dos estados; o envio a cada abertura do canal e depois da troca de conta; a espera de 2 s com só o último valor; o tempo que não zera quando o ramal troca de "Conectando…" para "Erro no cadastro", e que zera quando ele registra; o `404` que faz parar; a falha que tenta de novo.

**Teste manual:** uma seção nova no `docs/teste-manual.md`, com dois PCs: fechar o app, tirar o cabo de rede, errar a senha do ramal, corrigir, e a pessoa com dois computadores.

## 11. Entrega e etapas

1. **O servidor do chat e as páginas.** Já mostra "No chat" e "Offline" para os apps de hoje. É uma versão do chat.
2. **O app do Windows.** A partir dele aparecem o "Online" e o "Sem registro". É uma versão do app, que chega a cada PC quando a pessoa aceita a pergunta de atualização dele. Um PC em que ninguém aceita continua como "No chat".

O guia do chat (`docs/chat-servidor.md`) ganha a explicação dos estados, e o protocolo (`docs/chat-protocolo.md`) ganha a operação e o limite.

## 12. Riscos

1. **Um PC com o app antigo** aparece como "No chat", e nunca como "Sem registro". A página diz isso na segunda linha.
2. **O que a página mostra é o que o app diz.** Um app travado pode continuar dizendo "registrado". A central é que tem a verdade, e o chat não chega nela.
3. **Um PC que perde a rede** leva até 2 minutos para aparecer offline.
4. **A página pesa mais com muitas empresas:** a primeira página passa a olhar todas as pessoas de todas as empresas a cada 30 s. Com as dezenas de empresas de hoje, não é problema. O teste confere o tempo com 200 empresas e 5.000 pessoas (seção 8).
5. **O tempo vem do app.** Um app com defeito poderia mandar um tempo errado. Ele só fala do próprio ramal, e o servidor recusa um tempo fora da faixa.
6. **Um ramal que registra e cai de novo o tempo todo** nunca completa o minuto sem registrar, e não aparece em vermelho: ele alterna entre "Online" e "No chat". O histórico, que mostraria isso, está fora desta versão.

## 13. As escolhas que o responsável não fez

Ele pediu o estado "on ou offline" e disse para que serve. O resto abaixo é escolha deste desenho, para ele corrigir:

1. Os nomes dos estados: Online, Sem registro, No chat e Offline.
2. O minuto de espera antes de um ramal virar "Sem registro". Sem ele, todo app que abre apareceria em vermelho por alguns segundos.
3. O cartão "Sem registro agora" na primeira página, com todas as empresas juntas.
4. A coluna "Estado" no lugar da "Última vez". A última vez continua aparecendo, para quem está offline.
5. Nada de histórico e nada de aviso por e-mail nesta versão.
6. A página não mostra "em ligação" nem "Não perturbe".

Um revisor que não participou deste desenho o leu como quem vai construir, e fez oito perguntas. Nenhuma precisou do responsável. O que elas mudaram, por escolha deste desenho:

7. **O app conta o tempo, e não o chat** (seções 4.2 e 7.1). Sem isso, um ramal que fica tentando registrar nunca apareceria em vermelho, e todo reinício do chat zeraria os tempos.
8. **A pessoa com vários computadores** mostra o tempo do computador que está naquele estado há mais tempo (seção 4.2).
9. **O "Sem internet" saiu da lista do que o app diz.** Sem internet, o app não alcança o chat, e a pessoa aparece offline.
10. **O estado só é aceito de um computador ligado ao chat** (`409 semLigacao`), e o app manda de novo quando o canal abre.
11. **O limite de tempo da primeira página:** menos de 1 s com 200 empresas e 5.000 pessoas.

Duas respostas vieram do que já existe: o código do erro de "ninguém entrou neste computador" é o `409 pessoa` do protocolo, e as pessoas contadas são as que a página da empresa já lista.

Ao escrever o plano da primeira entrega, mais seis escolhas, também para ele corrigir:

12. **A conta "no chat".** As contas eram três (online, sem registro e offline), e quem está "No chat" não entrava em nenhuma. Com os apps de hoje, que não dizem o ramal, uma empresa inteira aberta apareceria como "0 online". As contas ganham a "no chat", que só aparece quando há alguém nesse estado (seção 4.1).
13. **A memória dos estados dentro do hub** (seção 7.2), no lugar de uma peça à parte avisada pelo hub. O que a página mostra é o mesmo.
14. **A página troca só as partes que mudam sozinhas** (seção 4.3). Trocando tudo, o `Copiar o código` sumiria na primeira atualização.
15. **A sessão vencida e a empresa apagada recarregam a página** (seção 4.3), em vez de a página ficar com um aviso de "sem atualizar" para sempre.
16. **O foco dentro de uma parte que seria trocada também segura a troca** (seção 4.3), e a página avisa quando isso passa de uma rodada. Sem isso, quem anda pela página com o teclado perderia o lugar a cada 30 segundos, ou a página pararia de se atualizar sem dizer nada.
17. **Os textos que o quadro não tem:** o "sem computador no chat" (seção 4.2); os dois avisos de "sem atualizar" e a frase dos ramais que não cabem na lista dos 50, que estão no plano.

A revisão final da primeira entrega (19/11), feita por um revisor que não participou da construção, mudou mais seis coisas, também para ele corrigir:

18. **O aviso de "sem atualizar" é uma faixa presa embaixo da janela** (seção 4.3). No alto da página, quem tinha rolado uma tabela comprida não o via, e ele empurrava as linhas quando aparecia.
19. **Num botão ou num link, só o foco do teclado segura a troca** (seção 4.3; a escolha 16 dizia "o foco"). O clique com o Ctrl num `Abrir`, que abre a empresa em outra aba, deixava o foco no link, e a página parava de se atualizar.
20. **O ponteiro em cima de um botão de formulário segura a troca** (seção 4.3). A troca podia mudar as linhas de lugar bem na hora de um clique no `Tirar do chat`, que não tem volta e não pede confirmação.
21. **A marca do conteúdo no endereço dos arquivos, e a página aberta que se recarrega quando o chat muda de versão** (seção 4.3). Sem a marca, no dia de uma atualização o navegador desenhava as páginas novas com o estilo que tinha guardado, por até um dia.
22. **A entrada vale em todas as abas** (seção 4.3). Com duas abas abertas quando a sessão vencia, a aba que chegava primeiro à entrada era recusada.
23. **"Até cerca de um minuto, e às vezes um pouco mais"** no lugar de "alguns segundos", para o tempo em que todos podem aparecer offline depois de um reinício do chat (seção 4.3). No dia de uma atualização, "alguns segundos" faria o responsável achar que ela derrubou os clientes.

## 14. O que a revisão final anotou e ficou para depois

São pontos pequenos. Nenhum muda o que a página mostra no dia a dia.

1. **O texto selecionado dentro de uma parte que se atualiza** (um ramal, para copiar) perde a seleção a cada troca, de 30 em 30 s.
2. **A página não busca na hora em que a aba volta a aparecer, ou em que o PC acorda:** os estados podem ficar até 30 s velhos, e nada na página diz a hora da última busca que deu certo.
3. **O teste do tempo da primeira página não põe arquivos no banco,** e a conta do espaço dos arquivos é refeita a cada busca de cada aba aberta. Medido numa cópia da tabela: com 500.000 arquivos, 94 ms; com 50.000, 7 ms. Cada busca também traz a página inteira (24 KB com 30 empresas, 52 KB com 30 pessoas), sem compressão.
4. **Ramos do script sem teste:** a resposta que não é 200, a página que chega sem uma das partes, o prazo de 20 s da busca, e o foco que chega durante a busca.
5. **Não há um botão de pausar a atualização:** quem quer segurar a página deixa o foco num botão, pelo teclado, ou o ponteiro em cima de um `Tirar do chat`.
6. **A guarda do `PessoasDaEmpresa` para um número de empresa que não existe (zero ou negativo) não tem teste.** Sem ela, a página da empresa zero listaria as pessoas de todas.
7. **Navegadores muito antigos:** sem o `AbortController`, uma busca que não volta para as rodadas sem aviso; sem o `Response.redirected`, a página não percebe que a sessão venceu.
8. **Uma entrada nova em outra aba** deixa o `Sair` e o `Trocar o código` da primeira aba com o token antigo: eles respondem "Pedido recusado" até a página ser recarregada.
9. **Higiene dos testes:** os computadores de mentira não fecham os canais deles; o teste da primeira página conta com a empresa dele estar entre as 50 da lista; dois nomes inventados não estão na lista do plano ("Marcos Teles" e "Expedição").
10. **A senha de teste no trace:** quando um teste da administração falha no GitHub, a senha sorteada daquela rodada fica no trace enviado. É a senha de um servidor que acaba junto com a rodada.

E uma pergunta para o responsável, que é quem dá os nomes: o estado "No chat" aparece ao lado de textos mais antigos da página que também dizem "no chat" (`PESSOAS NO CHAT`, "8 pessoas no chat", `NO CHAT DESDE`). Se confundir, o nome do estado muda (seção 13, item 1).
