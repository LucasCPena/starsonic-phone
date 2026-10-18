# Starsonic Phone para Android 0.2 (ramal completo) — especificação de design

- **Data:** 16/10/2026
- **Status:** implementada em 18/10/2026 (`android-v0.2.0-rc.1`; o que saiu diferente do texto está na seção 15). Aprovada pelo responsável em 16/10/2026, em quatro partes apresentadas no chat (segunda ligação, transferência com consulta, conferência a três e contatos do celular)
- **Subprojeto:** 2 de 2 (app de celular), **versão 0.2: Android, "ramal completo"**. Vem do mapa da próxima versão (documento "Starsonic Phone: mapa da próxima versão do app", 16/10/2026): a 0.2 faz o que depende só do app; a 0.3 (QR code e Google Play), a 0.4 (push) e a 1.0 (iPhone) têm especificações próprias.
- **Base:** a especificação da etapa 1 (`2026-10-14-starsonic-phone-android-design.md`), que continua valendo em tudo o que esta não muda.

> **Decisões do responsável** (16/10/2026):
> 1. A ordem das versões é "ramal completo primeiro" (opção A do mapa): a 0.2 entra antes do push.
> 2. A 0.2 entra com os quatro itens: segunda ligação, transferência com consulta, conferência a três e contatos do celular.
> 3. Ao desligar a ligação ativa, a que estava em espera volta sozinha.
> 4. Na conferência, Desligar encerra para todos; para tirar só um, Separar e depois Desligar aquele.
> 5. Números externos dos contatos: o "+55" sai e fica DDD + número; um prefixo de linha externa, se a central exigir, entra no perfil. Pendente de confirmação pela Starsonic (seção 12); até lá vale o padrão sem prefixo.

## 1. Contexto

A 0.1.0-rc.1 (etapa 1) é um telefone de ramal enxuto: uma ligação por vez, transferência direta, só números. Comparado a sete softphones conhecidos (mapa da próxima versão, seção "Comparação de funções"), o que mais falta no dia a dia de recepção e atendimento é falar com o colega antes de passar a ligação, atender uma segunda ligação e ligar pelo nome.

A central da Starsonic aceita a transferência com consulta: numa captura de 16/10/2026, o INVITE que ela manda ao ramal traz `Supported: timer, replaces, norefersub, histinfo` e `Allow: ... REFER`, e o fluxo de um telefone de mesa foi re-INVITE (espera), REFER, `202 Accepted`, NOTIFY e, no fim, o BYE da central. A mesma captura mostra que a central só oferece PCMA e PCMU, e `Session-Expires: 1800` (o pjsua já renova a sessão).

## 2. Objetivos

1. **Ramal de verdade no celular** — segunda ligação, consulta, conferência e contatos, como num telefone de mesa.
2. **Sem servidor novo** — tudo desta versão depende só do app e do que a central já faz.
3. **A mesma base para o iPhone** — as funções novas entram no motor em C++ (`starsonic/phone`), sem nada de Android.

## 3. Critérios de sucesso (0.2)

- Numa ligação, uma segunda ligação para o ramal toca na tela de chamada, é atendida (a primeira vai para a espera) e a pessoa alterna entre as duas; ao desligar a ativa, a outra volta sozinha.
- A pessoa transfere com consulta: fala com o colega, conclui, e as duas ligações saem do celular; se o colega não atende, volta ao cliente sem fazer nada.
- A pessoa junta duas ligações numa conferência, separa e desliga; se um dos dois sai, continua falando com o outro.
- A aba Contatos lista os contatos do celular, liga pelo nome, e o nome aparece na ligação recebida, na tela de chamada, na notificação e nos Recentes. Sem a permissão, o app continua funcionando só com números.
- Tudo acima passa no emulador (contra o registrador falso) e nos dois celulares do teste manual, com um segundo ramal de teste.
- A terceira ligação continua recebendo ocupado; uma ligação da operadora em andamento continua bloqueando as do ramal (como na etapa 1).

## 4. O que a 0.2 entrega

### 4.1 Telas

| Tela | O que muda |
|------|-----------|
| Chamada | Com uma segunda ligação chegando, a faixa "Ligação de <nome ou número>" em cima, com Atender e Recusar. Com duas ligações, dois cartões: a ativa (nome ou número e o tempo) e a outra, marcada "Em espera" (ou "Em espera · transferência" durante a consulta), e os botões Espera, Transferir, Alternar e Juntar (Nova ligação só com uma ligação: não há uma terceira). Na conferência, o título "Conferência" com os dois nomes ou números e o tempo, e os botões Mudo, Teclado, Viva-voz (ou a escolha de áudio), Separar e Desligar. |
| Transferir | Abre o campo do número (com a busca nos contatos) e dois botões: Consultar e Transferir agora (a transferência direta da etapa 1). |
| Consulta | A tela de chamada com o colega ativo e o cliente "Em espera · transferência", e os botões Concluir transferência, Alternar e Cancelar. |
| Contatos | Aba nova, ao lado de Teclado e Recentes: campo de busca em cima e a lista dos contatos do celular (nome e números). Sem a permissão: o aviso "Permita o acesso aos contatos para ligar pelo nome." com o botão Permitir. |
| Teclado | Ao digitar, abaixo do número, até três contatos cujo número contém o digitado (nome e número); um toque preenche o número. Nos Recentes e na ligação recebida, o nome do contato no lugar do número quando ele bate. |

### 4.2 Decisões

- **Duas ligações por celular, uma ativa.** O motor guarda até duas; a terceira que chega recebe ocupado (486) e vai para o Recentes como perdida, como na etapa 1. Com uma ligação da operadora em andamento, o ramal continua dando ocupado (o Android não deixa as duas ao mesmo tempo).
- **Só a ativa tem áudio.** A em espera fica sem mídia (re-INVITE sendonly, como a espera da etapa 1). Na conferência, as duas têm áudio e estão ligadas entre si.
- **Ao desligar a ativa, a em espera volta sozinha** (decisão 3), com o re-INVITE de retomada.
- **A consulta é a segunda ligação** com um rótulo; cancelar a consulta é desligar o colega e retomar o cliente. Concluir é o REFER com Replaces; quando a central confirma (NOTIFY com 2xx), o motor desliga as duas, como já faz na transferência direta.
- **A conferência é feita no celular**, na mesa de áudio do PJSIP: a central não fica sabendo e nada depende dela. Desligar encerra as duas (decisão 4). Se um dos dois desliga, vira uma ligação normal com o outro.
- **Contatos ficam no celular.** O app não guarda cópia nem manda os contatos a lugar nenhum: o nome é procurado na hora de mostrar (pelo número) e a lista é lida da agenda do Android a cada abertura da aba. Os Recentes continuam guardando só o número e o nome que a central mandou.
- **A permissão de contatos é pedida na aba Contatos**, na primeira abertura, não no Entrar. Negada, o app segue só com números; a aba mostra o aviso e o botão.
- **Números dos contatos:** separadores fora (como no `NormalizeDialString`), "+55" fora (decisão 5), e o `prefixo_externo` do perfil (seção 6.3) na frente de todo número que veio de um contato e tem mais de 6 dígitos (os ramais internos, curtos, não levam prefixo). Um número com "+" de outro país é discado como está, sem prefixo, e a central decide.
- **Windows:** não muda nada nesta versão.
- **Mudo** continua valendo para o microfone, ou seja, para as duas ligações da conferência.

## 5. Fora do escopo da 0.2

- Push, QR code, Google Play, iPhone (versões 0.3, 0.4 e 1.0).
- Editar contatos no app, contatos da empresa (agenda da central), presença e BLF, correio de voz, TLS.
- Conferência com mais de três participantes; conferência na central.
- Transferência com consulta na versão de Windows.
- Gravação, vídeo e mensagens.

## 6. Arquitetura

### 6.1 Motor (`starsonic/phone`)

A regra "uma ligação por vez" sai do `SipEngine`: a `CallTable` guarda até duas ligações, e a segunda que chega durante outra toca (180) em vez de receber 486; a terceira recebe 486 com o `OnRejectedBusy` de hoje. Entram:

| Método | O que faz |
|--------|-----------|
| `MakeCall(number)` | Passa a aceitar uma ligação nova com uma em andamento (a ativa vai para a espera antes, pelo `Activate`); com duas, devolve -1. |
| `Activate(callId)` | Põe a outra ligação em espera (sendonly) e retoma esta (sendrecv), ligando só ela ao dispositivo de som. É o Alternar, o Atender da segunda (a primeira vai para a espera) e a volta sozinha depois de um Hangup. |
| `TransferAttended(callId, targetCallId)` | REFER com Replaces (pjsua2 `Call::xferReplaces`) da ligação do cliente (`callId`) para a do colega (`targetCallId`). O resultado chega por `OnTransfer(callId, sipCode)`: 2xx no NOTIFY → o motor desliga as duas; recusa do REFER (4xx a 6xx) ou NOTIFY com erro → o aviso, e as duas continuam como estavam. |
| `Join(callId, otherId)` | Retoma a em espera e liga as duas à mesa de áudio entre si e ao dispositivo de som (`AudioMedia::startTransmit` nos dois sentidos). |
| `Split(callId, otherId)` | Desfaz as ligações entre as duas na mesa e põe `otherId` em espera; `callId` fica ativa. |
| `Transfer(callId, number)` | Igual à etapa 1 (a transferência direta). Com duas ligações, transfere a ativa. |

Eventos: `OnIncomingCall` passa a chegar também com uma ligação em andamento; `OnCallState` continua por ligação; `OnTransfer` é novo e vale para as duas transferências (a direta passa a avisar o resultado por ele também, em vez de só desligar). `HasCall` continua; entra `CallCount`.

Áudio: a mesa de áudio do pjsua liga ao dispositivo de som só a ligação ativa; `Activate` troca; `Join` liga as duas e as duas entre si. O mudo (`SetMute`) continua no dispositivo de captura, valendo para tudo.

### 6.2 App Android

| Componente | O que muda |
|------------|-----------|
| Ponte JNI | Expõe `Activate`, `TransferAttended`, `Join`, `Split`, `CallCount` e o evento `OnTransfer`. |
| `CallManager` | Guarda até duas `Call` e o estado da conferência; a segunda recebida vai ao Telecom como uma segunda Connection; Atender da segunda = `Activate`; `hangup` da ativa com outra em espera = `Hangup` + `Activate` da outra; `dial` com uma ligação em andamento = `Activate`-espera + `MakeCall`; a consulta é um `dial` marcado como transferência (guarda o id do cliente); `complete` = `TransferAttended`; `cancel` = `Hangup` do colega + `Activate` do cliente; `join`/`split`; quando o colega da consulta termina sem atender (`Disconnected` com código de recusa ou 487 por desistência), o cliente é retomado e o aviso da seção 11.1 aparece por 2 s. |
| `TelecomAdapter` e `CallConnection` | As Connections ganham `CAPABILITY_HOLD` e `CAPABILITY_SUPPORT_HOLD`; `setOnHold`/`setActive` acompanham o motor; a segunda recebida passa por `isIncomingCallPermitted`; a conferência vira uma `Conference` do Telecom (`CallConference`) com as duas Connections como filhas, para o áudio, o Bluetooth e a notificação ("Conferência") continuarem com o sistema; `Split` desfaz a `Conference`. |
| `IncomingCallNotifier` | A segunda ligação recebida com o app na frente é a faixa da tela de chamada; com o app fora da tela, a notificação de ligação de sempre (o Android mostra no alto, porque já há uma ligação). |
| `ContactsSource` (interface) e `AndroidContactsSource` | `lookup(number) → name?` (pelo `PhoneLookup` do Android, que normaliza o número) e `search(text) → lista de (nome, números)`; a lista completa com `search("")`. A implementação de teste é uma lista em memória. |
| `ContactsScreen` | A aba Contatos: busca, lista e a escolha do número quando há mais de um; pede a permissão `READ_CONTACTS` na primeira abertura. |
| `CallScreen` | Os dois cartões, a faixa da segunda ligação, Alternar, Nova ligação, Juntar, Separar, a tela de Transferir com Consultar e Transferir agora, e os botões da consulta. |
| `RecentsScreen` e `Keypad` | Nome do contato pelo `lookup` na hora de mostrar; as sugestões ao digitar pelo `search`. |
| `ContactDialString` (núcleo, `CallMessages`) | A regra dos números dos contatos (seção 4.2): `ContactDialString(raw, ddi, prefixo)`, no núcleo para o iPhone reaproveitar. |

### 6.3 Perfil

Entram em `[conta]` do `branding/perfil.ini`, lidos pelo `ParseProfile` do núcleo:

```ini
ddi=55                    ; o "+<ddi>" de um contato sai antes de discar
prefixo_externo=          ; discado antes de um número externo vindo dos contatos (ex.: 0); vazio = nenhum
```

### 6.4 Dados no celular

Nada novo é guardado: os contatos são lidos da agenda do Android quando a aba abre ou quando um número precisa de nome; os Recentes continuam com número e nome da central. A política de privacidade e os formulários das lojas (documento das lojas) passam a dizer que o app lê os contatos no aparelho e não os envia.

## 7. Fluxos

### 7.1 Segunda ligação recebida

1. Com uma ligação em andamento (ativa ou em espera, uma só), chega um INVITE: o motor avisa `OnIncomingCall` e responde 180. O app registra a segunda ligação no Telecom e mostra a faixa "Ligação de <nome ou número>" na tela de chamada (ou a notificação de ligação, com o app fora da tela). Em vez do toque de chamada, o app toca um bipe curto de chamada em espera, repetido, e vibra, para não cobrir a conversa.
2. Atender: `Activate` da nova (a atual vai para a espera); a tela mostra os dois cartões. Recusar: 486 e perdida no Recentes, sem notificação. Quem ligou desiste: perdida com a notificação, como na etapa 1.
3. Com duas ligações já no celular (ou uma ligação da operadora), a que chega recebe 486 e vai para o Recentes como perdida, como na etapa 1.

### 7.2 Nova ligação e Alternar

1. Nova ligação (com uma ligação em andamento): a ativa vai para a espera, abre o teclado com a busca nos contatos; Ligar faz a segunda ligação pelo Telecom e pelo motor. Enquanto chama, o cartão de cima mostra "Chamando…" e o de baixo "Em espera".
2. Alternar: `Activate` da outra. Os cartões trocam de lugar.
3. Desligar: desliga a ativa; a em espera volta sozinha (`Activate`), e a tela volta a mostrar uma ligação só.
4. A em espera cai (o outro lado desligou): o cartão some, com "<nome ou número> desligou" por 2 s; a ativa continua.

### 7.3 Transferência com consulta

1. Transferir abre o campo do número com a busca nos contatos e os botões Consultar e Transferir agora.
2. Transferir agora: a transferência direta da etapa 1 (REFER). O resultado chega por `OnTransfer`: sucesso → as ligações saem; recusa → "O servidor não aceitou a transferência." por 2 s e a ligação continua.
3. Consultar: o cliente vai para a espera, marcado "Em espera · transferência", e o app liga para o colega (7.2, item 1). Enquanto chama, os botões são Cancelar e Alternar.
4. O colega atendeu: os botões são Concluir transferência, Alternar e Cancelar. Alternar fala com o cliente de novo (o colega fica em espera); Concluir vale de qualquer um dos dois lados ativo.
5. Concluir: `TransferAttended(cliente, colega)`. A central junta os dois; no NOTIFY de sucesso, o motor desliga as duas e a tela de chamada fecha. Recusa → "O servidor não aceitou a transferência." por 2 s, as duas ligações continuam, e a pessoa alterna, cancela ou tenta de novo.
6. Cancelar: desliga o colega e retoma o cliente.
7. O colega não atende, está ocupado ou recusa (`Disconnected` com código de 400 a 699): o app retoma o cliente sozinho e mostra "<nome ou número do colega>: <mensagem da 11.1>" por 2 s (ex.: "2002: Não atendeu").
8. O cliente desliga durante a consulta: a consulta vira uma ligação normal com o colega (o rótulo sai), com "<nome ou número> desligou" por 2 s.

### 7.4 Conferência

1. Com duas ligações (uma ativa e uma em espera, sem consulta em andamento), o botão Juntar: `Join`. A tela vira "Conferência" com os dois nomes ou números e o tempo desde o Juntar.
2. Separar: `Split`; a última que entrou vai para a espera e a tela volta aos dois cartões.
3. Desligar: desliga as duas (decisão 4).
4. Um dos dois desliga: a conferência vira uma ligação normal com o outro, com "<nome ou número> desligou" por 2 s.
5. Durante a consulta (7.3), Juntar não aparece: primeiro Cancelar ou Concluir.

### 7.5 Contatos

1. A aba Contatos, na primeira abertura, pede a permissão de contatos pela janela do Android. Negada: o aviso e o botão Permitir (que abre a janela de novo, ou os ajustes do app se o Android não deixar mais perguntar).
2. Com a permissão: a lista em ordem alfabética, com a busca por nome ou número. Tocar num contato com um número liga (como no Teclado); com mais de um, a escolha do número.
3. O número vai pela regra da seção 4.2 (separadores, DDI, prefixo).
4. Ligação recebida, tela de chamada, notificação, Recentes e a faixa da segunda ligação mostram o nome do contato quando o `lookup` do número acha um; senão, o nome que a central mandou; senão, o número.
5. Sem a permissão, nada muda no resto do app.

## 8. Interface e marca

- Tela de chamada com duas ligações: dois cartões, o ativo em cima com o tempo, o outro abaixo com "Em espera" em cinza; a faixa da segunda ligação em cima, com Atender em verde e Recusar em vermelho, como a notificação.
- Botões novos com os ícones padrão do Material: Alternar (swap), Nova ligação (add call), Juntar (call merge), Separar (call split), Consultar (phone forwarded), Transferir agora (arrow forward), Concluir transferência (check).
- Aba Contatos com o ícone de agenda; a busca com o campo padrão do Material.
- Cores, fontes e textos como na etapa 1; pt-BR em tudo.

## 9. Build e publicação

Sem mudança nos workflows. A versão sai como `android-v0.2.0-rc.1` pelo `android-release`, no canal de teste, com o teste manual antes da estável. O `versao-android.json` e o atualizador seguem iguais.

## 10. Licença

Sem mudança (GPL v3, código-fonte junto do APK). A tela Sobre não muda nesta versão.

## 11. Erros e testes

### 11.1 Mensagens

Além das da etapa 1:

| Situação | O que o usuário vê |
|----------|--------------------|
| Segunda ligação chegando | Faixa "Ligação de <nome ou número>" com Atender e Recusar |
| Ligação em espera | "Em espera" no cartão; "Em espera · transferência" durante a consulta |
| Colega da consulta não atendeu, ocupado ou recusou | "<nome ou número>: <mensagem da 11.1 da etapa 1>" por 2 s (ex.: "2002: Não atendeu") |
| O outro lado da ligação em espera ou da conferência desligou | "<nome ou número> desligou" por 2 s |
| REFER recusado (direta ou consulta) | O servidor não aceitou a transferência. (por 2 s) |
| Nova ligação sem registro | Sem conexão com o servidor. Tente de novo em instantes. (a da etapa 1) |
| Permissão de contatos negada | Na aba Contatos: "Permita o acesso aos contatos para ligar pelo nome." com o botão Permitir |
| Contato sem número | O contato não aparece na lista |

### 11.2 Testes automáticos (a cada build)

- **`SipEngine` no Linux**, contra o registrador falso (que passa a fazer uma segunda ligação e a responder a REFER com Replaces, com NOTIFY de 200 ou de 603 conforme o teste pedir): a segunda ligação toca (180) e a terceira recebe 486; `Activate` manda sendonly à que sai e sendrecv à que entra, e só ela fica ligada ao dispositivo de som (áudio nulo nos testes: conferido pelas portas da mesa); `TransferAttended` manda o REFER com `Replaces` com o Call-ID e as tags da ligação do colega; NOTIFY 200 → as duas desligam e `OnTransfer(…, 200)`; REFER 603 → as duas continuam e `OnTransfer(…, 603)`; `Join` retoma a em espera e liga as duas entre si na mesa; `Split` desfaz e põe a outra em espera; `Hangup` da ativa com outra em espera não retoma sozinho (isso é o app).
- **Kotlin (JVM):** o `CallManager` com duas ligações (segunda recebida atendida e recusada; Nova ligação; Alternar; Desligar com a volta sozinha; a em espera que cai), a consulta (concluir, cancelar, o colega não atende, o cliente desliga antes), a conferência (juntar, separar, um sai, Desligar), a regra dos números dos contatos (`ContactDialString`: separadores, "+55", outro "+", prefixo só com mais de 6 dígitos) e o `lookup` nos Recentes e na ligação recebida, com a `ContactsSource` de teste.
- **Emulador Android no GitHub**, com o registrador falso: um contato inserido antes do teste (`content insert`); a aba Contatos pede e recebe a permissão, lista o contato e liga por ele; o nome do contato aparece na ligação recebida; a segunda ligação do registrador aparece como faixa com o app na frente e como notificação com o app fora da tela, é atendida e a primeira fica em espera; Alternar; Desligar e a volta sozinha; Juntar e Separar; a consulta concluída (o registrador responde ao REFER com NOTIFY 200 e desliga as duas).
- **APK:** os mesmos de hoje, mais a permissão `READ_CONTACTS` presente e nenhuma outra permissão nova.

### 11.3 Teste manual (`docs/teste-manual-android.md`)

Entram, com dois ramais de teste além do do celular (seção 12):

10. Segunda ligação: recebida durante uma ligação (atender, recusar, deixar desistir), Nova ligação, Alternar, Desligar com a volta sozinha, a em espera que cai; a terceira recebe ocupado.
11. Consulta: concluir (conferir na central que o cliente ficou com o colega), cancelar, o colega não atende, o cliente desliga durante a consulta.
12. Conferência: juntar, falar os três, separar, um sai, Desligar.
13. Contatos: permissão negada e concedida; ligar por um contato com DDD e com "+55"; nome na ligação recebida, na notificação e nos Recentes; sugestões ao digitar.
14. Tudo acima com fone Bluetooth e viva-voz; bateria e dados numa conferência de 10 minutos, anotados.

## 12. Entradas necessárias da Starsonic

- Confirmar como a central espera um número externo discado pelo ramal (direto, com prefixo de linha, ou "+55"): define `prefixo_externo` e `ddi` no perfil. Até lá, sem prefixo e `ddi=55`.
- Dois ramais de teste além do do celular, para o teste manual (um faz de cliente, outro de colega).
- Confirmar se a central tem Opus para ligar (a captura mostrou só G.711); não bloqueia a 0.2.

## 13. Riscos

| Risco | O que fazemos |
|-------|---------------|
| O Telecom do Android não aceitar a `Conference` num serviço self-managed em alguma marca | A conferência continua no motor (o áudio é da mesa do PJSIP); no Telecom ficam as duas Connections, uma ativa e a outra marcada em espera só para o sistema. A notificação mostra "Conferência" pela do app. Conferido no emulador e nos dois celulares. |
| A central aceitar o REFER com Replaces mas não juntar as ligações (variações entre centrais) | O NOTIFY com erro chega como recusa: as duas ligações continuam e a pessoa cancela ou tenta de novo. O teste manual confere na central. |
| Duas ligações (e a conferência) gastarem mais bateria e dados no 4G | Medido no teste manual (item 14); a conferência é curta por natureza. |
| A permissão de contatos negada de vez ("não perguntar de novo") | O botão Permitir abre os ajustes do app; o resto do app não depende dela. |
| O `PhoneLookup` não achar um contato gravado sem DDD quando a central manda o número com DDD (ou o contrário) | Aceito na 0.2: o nome não aparece nesses casos; o número sim. Anotado para a 0.3 se incomodar no teste. |
| A segunda ligação chegar com a tela de chamada em primeiro plano e a faixa passar despercebida | A faixa toca o toque de chamada em espera e vibra; conferido no teste manual. |

## 14. Próximos passos

1. Plano de implementação desta spec (`writing-plans`), com as tarefas na ordem: motor (segunda ligação e `Activate`), app (dois cartões e Alternar), consulta no motor e no app, conferência no motor e no app, contatos, testes no emulador, roteiro manual e a `android-v0.2.0-rc.1`.
2. Depois da 0.2: a spec da 0.3 (QR code e Google Play), com as entradas do documento das lojas.

## 15. Como ficou (divergências da implementação, 18/10/2026)

O plano `2026-10-16-android-0-2-ramal-completo.md` implementou esta spec em 12 tarefas (`android-v0.2.0-rc.1`). O que saiu diferente do texto acima, com o motivo, na ordem em que foi decidido:

1. **Conferência no Telecom pelo plano B (6.2 e 13).** A `Conference` self-managed funciona no emulador, mas o Telecom tira dela o `PROPERTY_SELF_MANAGED` e o app Telefone do sistema posta uma notificação durante a conferência (fere a marca própria). Ficaram as duas Connections, a ativa `ACTIVE` e a outra `HOLDING` só para o Telecom, com o motor juntando as duas na mesa. A notificação "Conferência" do sistema não existe; a tela mostra "Conferência" e a notificação fixa continua "Conectado…".
2. **Desligar pelo fone Bluetooth (ou kit do carro) na conferência encerra as duas** (7.4, decisão 4): com o plano B o pedido chega pela Connection de uma das duas, e o app desliga as duas, como o Desligar da tela.
3. **Ligação da operadora com uma ou duas ligações do ramal (4.2):** em vez de a ligação do ramal terminar (etapa 1), as Connections têm `CAPABILITY_HOLD` e o Telecom a põe em espera; com duas, as duas ficam em espera e nenhuma volta sozinha até a pessoa (Alternar, Retomar) ou o Telecom retomar uma. Juntar fica recusado enquanto o Telecom protege a ligação da operadora.
4. **Alternar desabilitado enquanto o colega chama (7.3, item 3):** o motor só alterna entre ligações confirmadas; Cancelar cobre o caso. O mesmo vale para a segunda ligação feita por Nova ligação enquanto chama.
5. **Consultar desabilitado com duas ligações (7.3, item 1):** a consulta é a segunda ligação, e não há uma terceira.
6. **A segunda ligação fora da tela (6.2, `IncomingCallNotifier`):** notificação simples, sem tela cheia, com o bipe de chamada em espera; se a primeira acaba com a segunda ainda tocando, a segunda passa a tocar como uma ligação normal (toque e tela cheia).
7. **O toque numa sugestão de contato preenche o número já pela regra da 4.2** (sem o "+55", com o prefixo), não o número como está na agenda.
8. **A notificação "Ligação perdida de …" mostra o contato do celular ou o número (7.5, item 4),** sem o nome que a central mandou no meio da cadeia, como na etapa 1. Alinhar à cadeia nome do contato → nome da central → número antes da estável.
9. **4.1, tela Chamada:** com duas ligações os botões são Espera, Transferir, Alternar e Juntar; Nova ligação só aparece com uma ligação (não há uma terceira). O texto da tabela foi corrigido.
10. **Perfil (6.3):** `ddi=55` e `prefixo_externo=` (vazio) em `branding/perfil.ini`, como a decisão 5; a confirmação do prefixo continua pendente com a Starsonic (seção 12).

Pendências anotadas para a estável (0.2.0), fora as acima: a extração de parte do `CallManager` (1100 linhas) em unidades puras; um `NOTIFY 100 Trying` no registrador falso; os casos de "número já com o prefixo" e da fronteira de 6 dígitos no teste do `ContactDialString`; a notificação de espera que duplica a faixa com a tela de chamada na frente; a leitura da agenda a cada tecla na busca.
