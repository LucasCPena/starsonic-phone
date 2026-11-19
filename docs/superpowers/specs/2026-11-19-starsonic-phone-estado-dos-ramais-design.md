# Starsonic Phone — o estado dos ramais na administração do chat — especificação de design

- **Data:** 19/11/2026
- **Status:** para o responsável aprovar. O pedido é de 18/11, às 17:48. Em 19/11 ele disse para que serve ("consigo monitorar os clientes"), confirmou que esses clientes usam o app do Windows com o chat ligado, e aceitou a proposta dos três estados, só com a página, sem aviso por e-mail ("pode fazer", 00:24).
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
  - na tabela das empresas, a coluna "Ramais agora", com as contas da empresa: online, sem registro (só quando há) e offline.
- **A página de uma empresa:**
  - as mesmas três contas, ao lado do título da tabela;
  - a coluna "Estado" no lugar da "Última vez": o desenho, o nome do estado e uma segunda linha com o tempo;
  - uma bolinha em cada computador, com o estado daquele computador;
  - a legenda dos estados, embaixo da tabela.
- **Nas duas:** a frase que diz que a página se atualiza sozinha a cada 30 segundos, e que o celular e os aparelhos de mesa não aparecem.

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

**Quem entra na conta.** As linhas e as contas são as das pessoas que a página da empresa já lista hoje, as que entraram no chat e não foram tiradas dele. Cada pessoa é um ramal. Uma pessoa sem computador nenhum (todos foram tirados) aparece offline, com a "última vez" dela.

**O computador compartilhado.** A página lista, em cada pessoa, todos os computadores em que ela já entrou. Um computador só conta para a pessoa quando está ligado ao chat como ela, agora. Na linha de quem já usou aquele PC e não é a pessoa da vez, ele aparece fora.

### 4.3 O comportamento

- **O app** manda o estado do ramal ao chat toda vez que o canal dos eventos dele com o chat abre (a primeira vez e cada volta), depois de cada troca de conta, e a cada mudança. Uma mudança espera 2 s antes de ir, e só a última vai: um ramal que pisca não vira dez pedidos.
- **O app conta o tempo.** Ele guarda o instante em que o ramal passou de registrado para sem registrar, ou o contrário, e manda os segundos desde então. Logo depois de abrir, o tempo conta desde que o app abriu.
- **O chat** guarda o último estado de cada computador ligado nele, na memória, com o instante que sai da conta "agora menos os segundos". Quando o computador se desliga do chat, o estado é esquecido.
- **A página** é montada no servidor, como hoje, com o que a memória tem naquela hora. Um arquivo pequeno de JavaScript busca a página de novo a cada 30 s e troca o conteúdo, sem mexer na rolagem. Ele não troca nada enquanto a pessoa está com o foco num campo ou num botão de formulário da página. Se a busca falha, a página avisa desde quando está sem atualizar.
- **Depois de o chat reiniciar,** todos aparecem offline por alguns segundos, até os apps se ligarem de novo e mandarem o estado, já com o tempo certo.

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

- **O hub dos eventos** (`internal/eventos`) passa a dizer quais computadores estão ligados agora (com o canal aberto, ou abrindo: do `Reservar` em diante) e como qual pessoa, e avisa quando um se desliga. O aviso sai quando a ligação fecha e quando uma reserva desiste, e só quando a ligação que saiu ainda era a do computador: uma ligação antiga, que fecha depois de a nova entrar, não avisa nada. O hub já trata assim a troca de uma ligação pela outra.
- **A memória dos estados** é uma peça pequena e nova: guarda, para cada computador ligado, o último estado e o instante desde quando ele vale (agora menos os segundos que o app mandou); esquece o computador quando o hub avisa que ele se desligou; responde, para uma lista de computadores, o estado de cada um. Ela usa o relógio do servidor que os testes já trocam.
- **A operação** (`internal/api`) confere a chave, a pessoa, o corpo, o limite e se o computador está ligado, e escreve na memória.
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

- **O servidor:** a operação (cada valor, o valor errado, os segundos fora da faixa, sem chave, sem pessoa, o computador que não está ligado, o limite, a troca de pessoa que apaga); o hub (quem está ligado, o aviso do desligamento, a ligação antiga que fecha depois da nova e não apaga nada); a função dos estados, com o relógio de teste (a tabela inteira da seção 4.2, o minuto do "Sem registro" contado pelos segundos do app, a pessoa com dois computadores e qual tempo ela mostra, o computador compartilhado, que só conta para a pessoa da vez, o app antigo); as duas páginas (os estados, as contas, a lista, a ordem, o corte nos 50, o cartão vazio, e o tempo da primeira página com 200 empresas e 5.000 pessoas).
- **O JavaScript da atualização:** que ele troca o conteúdo, que não troca com o foco num formulário, e o aviso quando a busca falha.
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
