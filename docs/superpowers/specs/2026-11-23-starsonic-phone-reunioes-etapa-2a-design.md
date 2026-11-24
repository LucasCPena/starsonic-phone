# Starsonic Phone — reuniões com link — etapa 2a: as reuniões no app do PC — especificação de design

- **Data:** 23/11/2026
- **Status:** aprovada pelo responsável em 23/11/2026, às 10:54 ("segue"), depois de lida por um revisor de fora, que voltou com cinco perguntas, respondidas aqui (as escolhas 16 a 20 da seção 15). O caminho e as telas tinham sido aprovados antes, no chat (as decisões abaixo). **A entrega 1 (o servidor do chat e a página, seção 13) foi construída em 23/11,** na branch `reunioes-etapa-2`, para a `0.2.0-rc.7` do chat (quem publica é o responsável). O plano é o `docs/superpowers/plans/2026-11-23-reunioes-etapa-2a-servidor-e-pagina.md`. O que a construção decidiu e esta spec não dizia está nas notas datadas das seções 7.2, 7.5, 7.9 e 14, e na seção 17. A entrega 2 (o app `0.5.0`) tem um plano próprio, depois. **Em 24/11/2026, às 08:24, o responsável respondeu "pode seguir" à entrega 1:** a branch fica como está, e a entrega 2 segue nela; as quatro escolhas que lhe foram mostradas (os itens 1, 2, 3 e 6 da seção 17) ficam confirmadas; e o que a página faz quando o chat reinicia com um colega na reunião fica como a nota de 24/11 do item 3 da seção 12.1 diz.
- **Telas:** o quadro "Starsonic Phone — reuniões", telas 1 a 14, aprovado em 23/11, às 10:13. As telas 6 a 10 são da página da reunião; as outras, do app.
- **Versões alvo:**
  - o app do Windows `0.5.0`;
  - o servidor do chat: a próxima versão da série `0.2.0` (quem escolhe o número e publica é o responsável);
  - o servidor de vídeo: sem mudança.
- **Base:**
  - a spec de 12/11 (`2026-11-12-starsonic-phone-reunioes-link-design.md`), que desenhou a etapa 2 com o motor de ligações do app entrando na reunião. **Esta spec troca esse caminho** (seção 6) e corta a etapa 2 em duas: a **2a** (esta) e a **2b** (o "Gerar link" no meio de uma chamada, com quadro e spec próprios);
  - a spec de 18/11 (o palco) e a de 19/11 (o chat da reunião e o sinalizador), que deram à página o que o app agora reaproveita;
  - o `docs/chat-protocolo.md`, seções 9 a 12, e o `docs/ponte-windows.md`.

> **Decisões do responsável** (23/11/2026):
> 1. As centrais dos clientes aceitam o tronco SIP (09:08). A ponte do telefone pelo PC, da spec de 12/11, sai da etapa 2: o telefone da central entra na reunião pelo tronco, na etapa 3.
> 2. A reunião no app é a página da reunião mostrada dentro da janela do app, e ela tem de funcionar nos dois: dentro do app e no navegador do PC, com o colega reconhecido nos dois (09:28: "quero que a reunião funcione nos dois, pode seguir a opção 1").
> 3. As 14 telas do quadro, e a ordem: primeiro tudo que está no quadro (a etapa 2a); depois, o "Gerar link" (a etapa 2b) (10:13).

## 1. Contexto

- Hoje só a página do navegador entra numa reunião, e ela trata todo mundo como "de fora". O servidor do chat já sabe marcar, listar, cancelar e abrir uma reunião para um colega (as rotas do app, `docs/chat-protocolo.md`, seção 9), mas nenhum app as usa. Na prática, só a reunião de teste da administração funciona: uma reunião marcada não tem quem a comece.
- A etapa 2a é o que põe as reuniões em uso: um colega marca, manda o link, entra direto e deixa entrar quem é de fora.
- Desde a spec de 12/11, a página ganhou o palco (um quadro por pessoa), o chat da reunião e o sinalizador de qualidade. Nada disso existe para um app que entrasse pelo motor de ligações.
- A janela do app é uma página da web por dentro (o WebView2, com o motor do Edge). Ela consegue mostrar a página da reunião como um navegador mostraria.

## 2. Objetivos

1. Um colega marca uma reunião no app, e o link sai copiado.
2. Um colega entra numa reunião pelo app, direto, com o nome do cadastro do chat. A reunião aparece dentro da janela do app, igual à do navegador: os quadros, a tela compartilhada, o chat da reunião e o sinalizador.
3. O mesmo colega pode abrir a mesma reunião no navegador do PC, já reconhecido.
4. Qualquer colega que está na reunião aceita ou recusa quem é de fora, tira alguém e encerra para todos, no app e no navegador.
5. O telefone continua funcionando durante a reunião.
6. Nada muda para quem é de fora, e nada novo é guardado.

**O que seria um fracasso, mesmo funcionando:** a reunião do app ficar diferente da do navegador; uma ligação da central vazar para a reunião (ou a reunião para a ligação); um link ou um passe reconhecer como colega quem não é; o app entrar numa reunião sem a pessoa clicar em "Entrar".

## 3. Critérios de sucesso

1. Uma reunião criada na aba Reuniões aparece na lista em até 1 s, com o link copiado. O link abre a página no navegador de outra máquina.
2. No "Entrar" do app, o colega entra sem sala de espera, e o quadro dele leva o nome do cadastro do chat.
3. O pedido de uma pessoa de fora aparece para cada colega que está na reunião em até 2 s, no app e no navegador: o cartão e o número no botão "Participantes". O "Aceitar" a põe na reunião; o "Recusar" mostra a ela "Não foi possível entrar".
4. O "Tirar" e o "Encerrar para todos" funcionam do painel, no app e no navegador.
5. O "Abrir no navegador" abre a reunião no navegador padrão com o colega reconhecido, sem digitar o nome e sem esperar.
6. O "Abrir no app" da página traz o app para a frente, na entrada daquela reunião. O app nunca entra sozinho.
7. Com a reunião escondida, o pedido aparece no aviso do Windows, e o "Aceitar" dali põe a pessoa na reunião.
8. Numa ligação da central atendida no meio da reunião, os outros não ouvem a ligação e a pessoa não ouve a reunião. Quando a ligação acaba, a reunião volta como estava em até 2 s. Vale com a reunião dentro do app e, com o app e a página conectados ao chat, com a reunião aberta no navegador pelo app (em até 3 s).
9. O "Compartilhar a tela" funciona de dentro do app.
10. Sem um passe que valha, a página trata a pessoa como de fora. Um passe usado, vencido, de outra reunião ou de outra empresa não reconhece ninguém.
11. Os registros dos servidores e o diagnóstico do app não ganham nomes, assuntos, códigos de link, passes nem chaves.

## 4. O que a versão entrega

### 4.1 Telas

| Telas do quadro | Onde é construída |
|---|---|
| 1 a 5: a aba Reuniões (a lista, o menu, a Nova reunião, a primeira vez, o cancelar) | a interface do app |
| 6 a 10: a entrada do colega, a reunião, o pedido de quem é de fora, os participantes, o encerrar para todos | a página da reunião, no modo do colega. No app, ela aparece dentro da janela, com a barra do app em cima |
| 11: o aviso do Windows de quem quer entrar | a janela do aviso do app |
| 12 a 14: a ligação que chega, fora da reunião, o telefone durante a reunião | a interface do app |
| A tela 1 do quadro "Starsonic — reunião no navegador" (o app ou o navegador) | a página, que ainda não a tem |

O quadro mostra a janela no tamanho Normal e no grande, no tema claro. A aba Reuniões segue as regras de hoje para os três tamanhos da janela (Normal, Compacto e Mínimo) e para o tema escuro, com as cores do app.

### 4.2 A aba Reuniões

- **A aba** é a sexta do app (Ctrl+6), só no Windows. Ela aparece quando o computador está ligado ao chat e a empresa tem as reuniões liberadas (seção 7.6).
- **A lista** mostra as reuniões que a pessoa marcou e que ainda valem, da mais cedo para a mais tarde. Cada uma tem:
  - o assunto, ou "Reunião sem assunto";
  - o dia e a hora ("Hoje, 14:00", "Amanhã, 09:30", "Qui, 26/11, 16:00");
  - "Acontecendo · N pessoas", quando alguém está nela;
  - o "Entrar", o "Copiar link" e o menu.
- **O "Copiar link"** vira "Link copiado" por 2 s.
- **O menu** mostra até quando o link vale e tem o "Abrir no navegador" e o "Cancelar a reunião".
- **O campo "Cole aqui o link de uma reunião"** serve para quem recebeu o link de outra pessoa. Ele aceita o link inteiro deste servidor do chat, ou só o código. Com um texto no campo, aparecem o "Entrar" e, menor, o "Abrir no navegador": é por ali que o colega que não marcou a reunião chega ao navegador reconhecido.
- **A "Nova reunião":** o assunto (opcional), o dia, a hora e até quando o link vale: "O fim do dia da reunião" (o padrão) ou "Outro dia e hora", no máximo 31 dias depois. Ao criar, a pessoa volta à lista, com a reunião nova e o link já copiado.
- **Não existe editar.** Para trocar o dia ou a hora, a pessoa cancela e marca outra.
- **Cancelar** pergunta antes (tela 5). O link para de valer na hora, e quem está na reunião sai.
- **Sem conexão com o chat,** a aba diz isso no lugar da lista, como a aba Chat.

### 4.3 Entrar numa reunião

- **Pelo app** (o "Entrar" da lista, o campo do link, ou o "Abrir no app" da página): a janela vai para o tamanho grande e mostra a entrada da reunião (tela 6). A pessoa escolhe se entra com a câmera e o microfone ligados e clica em "Entrar". Ela entra direto, e uma reunião parada começa.
- **Pelo navegador** (o "Abrir no navegador" do menu, ou o do campo do link): o navegador padrão abre a mesma entrada, com o colega reconhecido.
- **Sem o app naquele aparelho** (em casa, no celular), o colega entra como quem é de fora: digita o nome e espera.
- **O link de outra empresa:** o app diz que a reunião é de outra empresa e oferece abrir no navegador, onde a pessoa passa pela sala de espera.
- **No PC com Windows, a página pergunta primeiro** (a tela 1 do quadro da página): "Abrir no app" ou "Entrar pelo navegador". A reunião de teste da administração não pergunta.
- **Um link de reunião deste servidor numa conversa do chat do app** vira um link, e o clique leva à entrada da reunião no app. Nenhum outro endereço vira link ali.
- **Com uma ligação em andamento, ou com a sala de vídeo aberta,** o app não abre uma reunião: ele diz para desligar antes. Numa reunião, ele não abre outra.
- **Os avisos da página** (a reunião cheia, o servidor de reuniões cheio ou sem resposta, o link que não vale mais) aparecem dentro da janela do app, como no navegador. O "Telefone" da barra de cima leva de volta ao app.

### 4.4 Na reunião, o colega

- A reunião é a de quem é de fora (os quadros, a tela compartilhada, o chat, o sinalizador), mais:
  - o botão **"Participantes"**, com o número de quem espera;
  - **o cartão "<Nome> quer entrar"**, com "Recusar" e "Aceitar". Com mais de um pedido, o cartão diz "<Nome> e mais N querem entrar" e leva ao painel;
  - **o painel "Participantes"**, no lugar do chat (um ou outro): quem espera, com "Recusar" e "Aceitar"; quem está na reunião, com "você" e "de fora", e o "Tirar" em cada um, menos na própria pessoa; e o "Encerrar para todos";
  - **o "Tirar"** pede um segundo clique na mesma linha ("Tirar <Nome>?"), para um clique sem querer não tirar ninguém;
  - **o "Encerrar para todos"** pergunta antes (tela 10).
- O primeiro colega que responde decide o pedido, venha a resposta do app, do navegador ou do aviso do Windows.
- Na janela estreita, o painel cobre a tela, como o chat da reunião.

### 4.5 O app durante a reunião

- **A barra de cima** mostra "Ocupado · em reunião" e ganha dois botões: "Telefone" e "Tela cheia".
- **O "Telefone"** mostra o app de sempre, no tamanho de sempre, sem sair da reunião: os outros continuam ouvindo e vendo a pessoa. Uma faixa no alto diz "Você está na reunião", o estado do microfone, e tem o "Voltar para a reunião" (tela 14). Antes de a pessoa entrar, o "Telefone" só fecha a entrada.
- **Uma ligação da central** toca num cartão por cima da reunião (tela 12). Atender tira a pessoa da reunião enquanto a ligação durar: o microfone, a câmera e o som da reunião desligam, e a tela compartilhada para. A janela volta ao tamanho de sempre, com a tela da ligação e a faixa "Você está fora da reunião" (tela 13).
- **Quando a ligação acaba,** o microfone, a câmera e o som voltam como estavam, e a janela volta para a reunião. A tela compartilhada não volta sozinha.
- **O "Voltar para a reunião"** da faixa põe a ligação em espera e volta para a reunião. Um cartão por cima da reunião mostra "<Nome> em espera", com "Voltar à ligação" e "Desligar". O botão só aparece com uma ligação só, já atendida: chamando, com duas ligações, na consulta ou na conferência, a faixa fica sem ele, e a pessoa volta quando as ligações acabam.
- **Com a reunião aberta no navegador pelo app,** o app também a põe em pausa numa ligação, pelo servidor do chat (7.9). A página mostra "Você está numa ligação no Starsonic Phone", com o "Voltar para a reunião".
- **Ligar para alguém do "Telefone"** também tira a pessoa da reunião enquanto a ligação durar.
- **Numa reunião, as ligações da central são só de voz:** sem o "Atender com vídeo" e sem a câmera (ela está com a reunião).
- **Com a reunião escondida** (outra janela na frente, a janela minimizada ou a pessoa no "Telefone"), o pedido de quem quer entrar aparece no aviso do Windows (tela 11), um de cada vez, com "Recusar" e "Aceitar". O clique fora dos botões traz a reunião para a frente. O Não perturbe não cala esse aviso: ele é da reunião em que a pessoa está.
- **Fechar a janela** durante a reunião pergunta antes: "Sair da reunião?". Minimizar não pergunta, e a reunião continua.
- **Quando a reunião acaba para a pessoa** (o "Sair", o "Encerrar para todos", o "Tirar", o cancelamento), a janela volta ao tamanho de sempre, na aba Reuniões. Menos no "Sair", um aviso diz o que aconteceu. Se ela está no "Telefone" ou numa ligação, fica onde está: a faixa some, e o aviso aparece como os avisos curtos do app.
- **Se a reunião cai para a pessoa sem ela pedir** (a página desistiu de voltar depois de uma queda), a página mostra o "Você saiu da reunião" dela, com o "Entrar de novo", dentro da janela, e o app deixa de tratar a pessoa como "em reunião". Com a reunião escondida nessa hora, o app fecha a vista e diz, num aviso curto, que a conexão caiu.
- **Com a sessão do Windows bloqueada,** a câmera da reunião desliga, e volta ao desbloquear, como a da videochamada. Só vale para a reunião dentro do app.
- **Sair do app** (a bandeja, o Alt+F4, o Windows desligando) com uma reunião aberta é como fechar a aba do navegador: não há pergunta, e a página desliga a ligação ao ir embora, como já faz. O "Atualizar agora" do app pergunta antes, como o fechar.
- **Trocar de conta, ou desligar o computador do chat,** com uma reunião aberta no app: a página sai da reunião antes, e um aviso curto diz por quê. O app também esquece as reuniões abertas no navegador: não mostra mais os avisos delas nem as põe em pausa. Elas continuam no navegador, com a pessoa que entrou.

## 5. Fora do escopo

- O "Gerar link" no meio de uma chamada: é a etapa 2b.
- O tronco SIP das centrais: é a etapa 3. A ponte do telefone pelo PC não será feita.
- O motor de ligações do app entrando na reunião (o SIP sobre TLS da spec de 12/11). A rota `entrar` do app continua no servidor, sem uso nesta etapa.
- Editar uma reunião marcada, ver as reuniões marcadas por outros colegas, convidar pessoas pelo app, lembretes e a ligação com uma agenda.
- Um botão para mandar o link pelo chat: o link é copiado.
- A reunião e o telefone lado a lado, em duas janelas.
- Escolher o microfone, o alto-falante e a câmera de dentro da reunião: no app valem os das Configurações; no navegador, os do navegador, como hoje.
- Um som quando alguém pede para entrar.
- O colega reconhecido no navegador do celular, e o app do celular.
- Gravar.

## 6. Os caminhos considerados

**Como a reunião entra no app:**

| Caminho | O que ganha | O que custa |
|---|---|---|
| **1. A página dentro da janela do app (o escolhido)** | Tudo que a página já tem vem pronto e igual. Uma melhoria na página chega ao app sem atualizar o app | O som e a câmera da reunião passam pela janela, e não pelo motor: o app precisa silenciar a reunião numa ligação. A câmera, o microfone e a tela dentro da janela têm de ser provados num Windows de verdade |
| 2. O motor de ligações entra na reunião (a spec de 12/11) | A reunião se comporta como mais uma ligação | O maior dos três: o palco, o chat e o sinalizador refeitos no app e mantidos em dois lugares |
| 3. O app só cuida, e a reunião abre no navegador | O menor | A reunião fica fora do app, e o app não consegue silenciá-la numa ligação |

O responsável escolheu o 1, e pediu que o navegador também funcione para o colega: o 3 deixou de ser reserva e virou o "Abrir no navegador".

**Como a página fica dentro do app:**

- **Num `iframe` da interface do app (o escolhido).** A interface continua dona da janela: a barra de cima, o cartão da ligação e as faixas ficam por cima ou no lugar da página. O que muda fica quase todo em TypeScript e na página, que os testes daqui exercitam no Chromium.
- **Numa segunda janela do app, com a página sozinha.** Fica como a primeira reserva (seção 14): não depende das regras do `iframe`, mas pede uma janela nova no executável, que só o Windows de verdade prova.

**Como o colega é reconhecido na página:**

- **Um passe de uso único, que o app pede ao chat (o escolhido).** O computador já tem a chave do chat; a página nunca a vê.
- Um login na página (um usuário e uma senha): o chat não tem senha por pessoa, e criar uma é outro projeto.
- A página conversar com o app por uma porta do próprio PC: os navegadores bloqueiam ou perguntam, e um firewall quebra.

## 7. Arquitetura

### 7.1 As partes

| Parte | O que muda |
|---|---|
| O servidor do chat | O passe, a chave do colega e o canal do colega na página (7.2 e 7.3). A página pode ser mostrada dentro do app (7.4). O repasse da pausa (7.9) |
| A página da reunião | O modo do colega (as telas 6 a 10), a conversa com o app (7.5), a pausa, e a escolha entre o app e o navegador |
| A interface do app | A aba Reuniões, a vista da reunião, as faixas, o cartão da ligação, o aviso (7.6) |
| O núcleo e o executável | As permissões, a navegação do `iframe`, os comandos novos, o link `starsonic://`, o aviso do canto (7.7) |
| O instalador | Registra o `starsonic:` |
| O servidor de vídeo | Nada. A página dentro do app fala com ele como a do navegador, pela mesma origem |

### 7.2 O passe e a chave do colega

- **O passe** — `POST /api/v1/reunioes/{codigo}/passe`, com a chave do computador e a pessoa da vez, como as outras rotas da seção 9 do protocolo.
  - `200`: `{"passe": "<43 caracteres base64url>", "reuniao": <Reunião>}`.
  - Os erros são os do `entrar` que não dependem de lugar: `404 naoEncontrado`, `403 outraEmpresa`, `403 semReunioes` e `429 tentativas`, contando nas tentativas como o `entrar` conta. O `cheia`, o `servidorCheio` e o `servidorVideo` não vêm aqui: quem os diz é o canal, na hora de entrar.
  - O passe são 32 bytes aleatórios. Vale **uma vez**, por **120 s**, e só para aquela reunião, aquela pessoa e aquele computador. Fica só na memória do servidor, e nunca vai ao log.
  - Até 10 passes por minuto por computador; passando disso, `429 tentativas`, com `esperarSegundos`.
- **O abrir da página** (`POST /api/v1/pagina/reunioes/{codigo}`, hoje sem corpo) passa a aceitar um corpo JSON com **um** destes campos:
  - `{"passe": "…"}`: o servidor gasta o passe e responde `{"reuniao": …, "bilhete": "…", "colega": {"nome": "Júlia Martins", "chave": "<43 caracteres>", "valeAte": 1794538799999}}`;
  - `{"colega": "<chave>"}`: responde `{"reuniao": …, "bilhete": "…", "colega": {"nome": "…", "valeAte": 1794538799999}}`.
  - **Nota de 23/11 (a construção):** o `colega` leva também o `valeAte`, até quando o link vale (o da Reunião, em milissegundos), ou `null` na naHora, que vale até acabar. A tela 10 diz "O link continua valendo até hoje, 23:59: a reunião recomeça se um colega entrar de novo.", e a página não tinha como saber isso. O corpo do abrir tem até 256 bytes.
  - Um passe ou uma chave que não vale responde `401 passe` (um erro novo), sem bilhete, e conta como uma tentativa que falhou. Um corpo com os dois campos, ou com outra coisa, responde `400 invalido`. Sem corpo, tudo fica como hoje.
- **A chave do colega** deixa a página abrir de novo sem outro passe (o segundo abrir, o "Entrar de novo", uma volta que a chave de volta não resolve):
  - 32 bytes aleatórios, só na memória do servidor e só na memória da página;
  - vale 12 horas, e só enquanto a reunião vale, a pessoa está ativa na mesma empresa e o computador continua ligado ao chat. Cada uso confere tudo de novo;
  - depois de o servidor do chat reiniciar, ela não vale mais: a página pede outro passe ao app, ou, no navegador, diz para abrir de novo pelo app (o item 3 da seção 12.1, com a nota de 24/11, diz o que acontece com quem já está na reunião).
- **O bilhete de um abrir com o passe ou a chave** abre um **canal de colega**, preso à reunião, à pessoa e ao computador do passe.

### 7.3 O canal do colega

É o canal de hoje (`GET /api/v1/pagina/canal`), com estas diferenças:

- **Da página para o servidor:**
```json
{"tipo": "entrar"}                               // no lugar do pedir: o colega entra direto
{"tipo": "aceitar", "pedido": "<id>"}
{"tipo": "recusar", "pedido": "<id>"}
{"tipo": "tirar", "participante": "<id>"}
{"tipo": "encerrar"}
```
- **Do servidor para a página:**
```json
{"tipo": "participantes",
 "participantes": [{"id": "<16 hex>", "nome": "Ana Souza", "deFora": false, "tela": false, "voce": false}],
 "pedidos": [{"id": "<16 hex>", "nome": "Maria Lima"}]}
{"tipo": "recusa", "de": "aceitar" | "recusar" | "tirar" | "encerrar",
 "motivo": "jaRespondido" | "naoEncontrado" | "cheia" | "foraDaReuniao" | "servidorVideo"}
{"tipo": "pausa", "pausada": true, "vez": "<id>"}   // o app pôs a reunião em pausa, ou a tirou dela (7.9)
```
- **O `entrar`** responde o `aceito` de hoje (o Acesso e a chave de volta), ou `cheia`, `servidorCheio`, `semServidor` ou `linkInvalido`, com as regras que o `pedir` tem para cada um. Nunca `naoComecou`, `aguardando` nem `recusado`: uma reunião parada começa. Vale uma vez por canal, e o prazo de 2 minutos do primeiro `pedir` vale para ele.
- **O participante do colega** nasce como o do `entrar` do app: `deFora` falso, com o nome do cadastro na hora, da pessoa e do computador do passe. Para o resto do protocolo, **aquele computador chamou o `entrar`**: ele recebe os eventos da seção 11 (`reuniaoPedido`, `reuniaoPedidoFim`, `reuniaoParticipantes`, `reuniaoAcabou`), e as rotas "Com a pessoa na reunião" valem para a pessoa. É assim que o aviso do Windows aceita e recusa.
- **Depois do `aceito`,** o canal é o de uma página aceita: o `senha`, o `tela`, o `camera`, o `mensagem`, o `palco` e o `voltar` valem como hoje. O canal que volta pelo `voltar` continua de colega: quem diz isso é o participante, não o bilhete.
- **O `participantes`** vai às páginas de colega cujo participante está na reunião: quando ele entra, logo depois de um `voltou` e a cada mudança de uma das duas listas. É sempre a lista inteira. O `voce` marca o participante daquele canal.
- **O `aceitar`, o `recusar`, o `tirar` e o `encerrar`** seguem as regras das rotas do app de mesmo nome, e pedem o colega na reunião. Quando dão certo, não têm resposta: a página vê o `participantes` novo, ou o `encerrada`. Quando falham, vem o `recusa`. Eles contam nas 20 mensagens por minuto do canal.
- **Num canal que não é de colega,** as cinco mensagens novas respondem `{"tipo": "erro", "erro": "invalido"}`, como hoje responde uma mensagem fora de ordem. Num canal de colega, o `pedir` e o `desistir` respondem o mesmo.

### 7.4 A página dentro do app

- **Quem pode mostrar a página.** A resposta de `/r/<código>` troca o `frame-ancestors 'none'` por `frame-ancestors https://app.starsonic.local`, a origem da interface do app. Só o app tem essa origem: ela não existe na internet. No modo de teste do servidor, entram também as origens de teste.
- **A interface do app** mostra a página num `iframe` com o endereço `<chat>/r/<código>`, sem nada mais no endereço, e entrega a ele a câmera, o microfone, a captura de tela, a reprodução automática e a escolha do alto-falante (o atributo `allow`, só para a origem do chat). O CSP da interface ganha o `frame-src` com a origem do chat.
- **O passe nunca vai no endereço do `iframe`:** ele vai por mensagem (7.5).
- **Para o leitor de tela,** o `iframe` tem o nome "Reunião", e o foco vai para ele quando a vista abre. Os botões da barra do app vêm antes dele na ordem do Tab.
- **No navegador,** o passe vai no fim do endereço, depois do `#` (`/r/<código>#p=<passe>`): essa parte não é mandada ao servidor nem entra no log dele. A página lê o passe ao carregar, tira-o do endereço na hora e o troca pela chave do colega.

### 7.5 A conversa entre a página e o app

Mensagens `postMessage`, sempre um objeto com `"starsonic": 1` e o `tipo`. A página só fala com a janela de cima e só aceita o que vem dela, com a origem do app; o app só aceita o que vem do `iframe` dele, com a origem do chat. Um `tipo` desconhecido é ignorado, dos dois lados: o protocolo só cresce.

| De quem | `tipo` | O que leva | Para quê |
|---|---|---|---|
| página | `pronta` | — | A página carregou e quer um passe. Ela manda ao carregar, e de novo se a chave do colega deixar de valer |
| app | `passe` | `passe`, `aparelhos` | O passe, e os nomes do microfone, do alto-falante e da câmera das Configurações |
| app | `aparelhos` | os mesmos nomes | A pessoa trocou um aparelho nas Configurações |
| página | `estado` | `fase` (`entrada`, `naReuniao`, `fora`), `microfone` | A cada mudança: é o que a barra, as faixas e a pausa do app usam. O `fora` é a página no "Você saiu da reunião" depois de uma queda: para o app, a pessoa não está mais em reunião, e a vista se comporta como na entrada |
| página | `fim` | `motivo` (`saiu`, `tirado`, `acabou`, `linkInvalido`) | A reunião acabou para a pessoa depois de ela entrar: o app fecha a vista. O `saiu` é só o do botão "Sair" e o da resposta ao `sair` do app; a queda é o `fora` do `estado` |
| página | `link` | `url` | A pessoa clicou num link do chat da reunião: o app abre no navegador padrão |
| app | `pausar` e `retomar` | — | Uma ligação da central começou ou acabou (7.8) |
| app | `bloqueio` | `ligado` | A sessão do Windows bloqueou ou voltou: a página desliga a câmera, ou a devolve ao que era |
| app | `sair` | — | A pessoa confirmou o fechar: a página sai da reunião e responde `fim` |

- **Sem o `pronta` em 15 s,** o app mostra "A reunião não abriu", com "Tentar de novo" e "Fechar".
- **Sem o `fim` em 2 s depois do `sair`,** o app fecha a vista assim mesmo.
- **Os aparelhos:** a página procura cada nome entre os aparelhos do navegador. Sem achar, usa o padrão do sistema.
- **Nota de 24/11 (antes do plano da entrega 2): um nome de aparelho que não serve nunca joga o passe fora.** A entrega 1 construiu a regra mais dura: com os `aparelhos` faltando, ou com um nome que não é texto ou que passa de 200 caracteres, a página ignora a mensagem inteira, também o `passe`, e 15 s depois a pessoa vira "de fora" por causa do nome de um aparelho. Passa a valer, no `passe` e no `aparelhos`: um nome que não serve conta como um nome que falta (o padrão do sistema para aquele aparelho), e os `aparelhos` que faltam ou não são um objeto contam como `{}`. O `passe` só é recusado pelo que é dele (o formato do passe). O app continua mandando sempre os `aparelhos`. É uma escolha de quem constrói, e o plano da entrega 2 a leva para a página antes de existir código do app.
- **Nota de 23/11 (a construção): o app repete a pausa e o bloqueio quando a pessoa entra.** A página só obedece ao `pausar` e ao `bloqueio` com a pessoa na reunião (a `fase` `naReuniao`) ou, no caso do `pausar`, entrando nela; fora disso, eles não fazem nada, e nada fica guardado. Por isso o app manda de novo o `pausar` (enquanto a pausa da 7.8 dura) e o `bloqueio` com o `ligado` verdadeiro (enquanto a sessão do Windows está bloqueada) a cada `estado` em que a `fase` passa a `naReuniao`. Sem isso, uma ligação ou um bloqueio que começou antes do "Entrar" deixaria a reunião ouvindo e vendo a pessoa. No navegador vale o mesmo (7.9): o app manda o `pausada` verdadeiro assim que um evento da seção 11 do protocolo mostra que o computador entrou numa reunião pelo navegador com uma pausa em curso, sem esperar a repetição dos 10 s. O plano da entrega 2 leva esta regra, com um teste.

### 7.6 A interface do app

- **A lista** vem do `GET /api/v1/reunioes`: ao conectar ao chat, ao abrir a aba, a cada 30 s com a aba à vista, depois de criar e de cancelar, e quando a vista da reunião fecha. O servidor não manda evento da lista.
- **A aba some com o `403 semReunioes`.** Escondida por isso, o app pergunta de novo a cada 5 minutos e a cada vez que conecta ao chat.
- **A Nova reunião** manda sempre o `valeAte`, calculado no relógio do PC: assim o que a tela diz ("Hoje, às 23:59") é o que vale, em qualquer fuso.
- **Entrar:** o app pede o passe **antes** de mostrar a página. Os erros do passe aparecem na aba (seção 11). Com o passe na mão, ele abre a vista, pede o tamanho grande (o `videoWindow` de hoje) e entrega o passe quando a página diz `pronta`.
- **A vista da reunião** fica viva enquanto a pessoa está na reunião, também escondida atrás do "Telefone" e da tela de uma ligação. Antes de a pessoa entrar, esconder a vista a fecha (a câmera apaga).
- **O estado das reuniões mora na interface,** como o do chat: o núcleo em C++ não conhece reunião. Ele só ganha o que o executável precisa (7.7).
- **Os pedidos** chegam ao app pelos eventos do chat (seção 11 do protocolo), com a pessoa na reunião pelo app ou pelo navegador. O app os usa só para o aviso do Windows; dentro da reunião, quem mostra o pedido é a página.
- **A resposta do aviso** (o "Aceitar" e o "Recusar") é a rota `aceitar` ou `recusar` do app. Um `409 jaRespondido` não é erro: outro colega respondeu antes.
- **O link numa conversa do chat:** só o texto que é exatamente o endereço deste servidor, seguido de `/r/` e de um código de 10 caracteres, vira link.

### 7.7 O núcleo e o executável

- **As permissões.** Hoje só a origem do app tem permissão, e só a do microfone (para ler os nomes) e a da reprodução automática. Passa a valer também, **só na janela principal e só para a origem do chat:** a câmera e o microfone. A janela do aviso não muda.
- **A captura de tela.** O executável responde ao evento `ScreenCaptureStarting` do WebView2 (existe a partir do SDK `1.0.2903.40`; o app usa um mais novo): só deixa a captura pedida pela página da reunião, na janela principal. Em qualquer outro caso, cancela.
- **A navegação.** Hoje toda navegação fora do app é bloqueada, também dentro de um `iframe`. Passa a valer **uma** exceção: num `iframe` da janela principal, o endereço do chat seguido de `/r/` e de um código de 10 caracteres do alfabeto dos códigos, sem mais nada. A navegação da janela e as janelas novas continuam bloqueadas.
- **Os comandos novos da ponte** (os nomes são sugestões; o que eles fazem não é):
  - **abrir a reunião no navegador,** com o código e, quando há, o passe. O executável monta o endereço ele mesmo, a partir do endereço do chat que ele já traz. Ele confere o formato do código e do passe, e nunca os escreve no diagnóstico;
  - **abrir um link do chat da reunião:** só `http` e `https`, com até 2.048 caracteres, sem espaços nem caracteres de controle. No diagnóstico vai só o esquema e o servidor, como hoje nas navegações bloqueadas;
  - **o pedido que o aviso mostra:** a interface diz ao núcleo qual pedido mostrar (o id, o nome e o assunto) e se a reunião está escondida, ou que não há pedido. O núcleo guarda isso só na memória, repassa ao aviso e nunca escreve o nome nem o assunto no diagnóstico;
  - **a resposta do aviso,** que o núcleo repassa à interface da janela principal, e o clique fora dos botões, que traz a janela para a frente.
- **O aviso do canto** aparece com um pedido para mostrar e a janela principal fora da frente, ou com a reunião escondida. Uma ligação tocando tem a vez: o pedido espera.
- **O link `starsonic://reuniao/<código>`.** O instalador registra o `starsonic:` como já registra o `tel:`, o `sip:` e o `callto:`, e o desinstalador o tira. O Windows abre o app com o link, a instância que já roda o recebe, e o app mostra a entrada daquela reunião. Só esse formato exato vale: qualquer outra coisa depois de `starsonic:` é ignorada.
- **Os tamanhos da janela** são os de hoje: o normal, o grande e a tela cheia. Na tela cheia da reunião, a barra do app continua à vista, com o "Sair da tela cheia".

### 7.8 O som, a câmera e as ligações da central

- **A reunião usa o som e a câmera da janela;** as ligações da central, os do motor. Os dois podem abrir o mesmo microfone, mas a câmera é de um só: por isso, numa reunião, as ligações são só de voz.
- **A pausa** (o `pausar`): a página desliga a faixa do microfone e a da câmera, avisa a câmera desligada ao chat (os outros veem o quadro sem imagem), cala o som da reunião e para a tela compartilhada. O `retomar` devolve o microfone, a câmera e o som ao que eram antes da pausa. A pessoa continua na reunião o tempo todo.
- **A reunião fica em pausa** enquanto existe uma ligação que não está em espera pelo "Voltar para a reunião": do começo de uma ligação feita, ou do atender de uma recebida, até a última ligação acabar. Uma ligação só tocando não pausa nada.
- **O atender automático** continua valendo numa reunião: a ligação é atendida, e a reunião entra em pausa.
- **O toque** de uma ligação toca por cima do som da reunião, como hoje toca por cima de tudo.

### 7.9 A pausa da reunião aberta no navegador

Dentro do app, a pausa vai por mensagem ao `iframe`: é na hora, e não depende do chat. No navegador, quem leva a pausa é o servidor do chat.

- **O app sabe em quais reuniões o computador entrou pelo navegador:** as do "Abrir no navegador" para as quais os eventos da seção 11 do protocolo chegam.
- **A rota** — `POST /api/v1/reunioes/{codigo}/pausa`, com `{"pausada": true | false, "vez": "<id>"}`. É da família "Com a pessoa na reunião": responde `204`, ou `409 foraDaReuniao` quando a pessoa da vez não está naquela reunião por uma página deste computador (o app então esquece a reunião). O `vez` é um id que o app escolhe para cada pausa.
- **O servidor só repassa:** ele manda o `pausa` (7.3) aos canais abertos das páginas daquele computador naquela reunião, e não guarda nada.
- **O app manda** o `pausada` verdadeiro quando a pausa começa (a regra da 7.8) e de novo a cada 10 s enquanto ela dura, para a página que estava sem o canal, ou que carregou de novo, entrar na pausa. No fim, manda o falso.
- **A página** faz a pausa da 7.8 e mostra, por cima da reunião, "Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.", com o "Voltar para a reunião". O botão desfaz a pausa ali mesmo (a ligação no app continua: a pessoa decide), e a página ignora as repetições daquela mesma `vez`. O `pausada` falso desfaz a pausa.
- **Se o app fecha no meio da ligação,** a página fica em pausa até a pessoa clicar em "Voltar para a reunião".
- **Sem o chat no ar** naquele momento, a pausa do navegador não chega. O app então diz, na tela da ligação, que a reunião do navegador continua ouvindo a pessoa.
- **Nota de 23/11 (a construção): quem conta para a rota, e o `409`.** A rota responde `204` só enquanto um participante daquela pessoa e daquele computador, que entrou por uma página, está na reunião ou entrando nela (com uma senha da câmera ainda não usada), como as outras rotas da família. Responde `409 foraDaReuniao` no resto: a página que ainda não passou do "Entrar", a que foi fechada, e também a de quem clicou em "Sair" e a deixou aberta no "Você saiu da reunião"; depois do "Entrar de novo", ela volta a contar. O participante que não conta não recebe nada. **Para o app, um `409` não é para sempre:** a página na tela de entrada, a que carregou de novo, a que está voltando de uma queda e a de quem clicou em "Sair" respondem `409` e podem entrar (de novo) durante a mesma ligação. O "o app então esquece a reunião" desta seção fica para o plano da entrega 2 acertar, com essa regra na mão; um evento da seção 11 daquela reunião a traz de volta (7.5).
- **Nota de 23/11 (a construção): quem sai durante uma pausa** (o "Sair", o tirado, a reunião encerrada, uma queda) fica sem a pausa, com o som de volta, e o microfone e a câmera continuam desligados: no "Entrar de novo", a pessoa volta com os dois desligados, e não como estavam antes da pausa. É o lado seguro: a pessoa liga de novo o que quiser.

## 8. Os valores

| Valor | Quanto |
|---|---|
| O passe | 120 s, uma vez só, para uma reunião, uma pessoa e um computador |
| Passes por computador | até 10 por minuto |
| A chave do colega | 12 horas, na memória |
| A lista das reuniões | lida de novo a cada 30 s com a aba à vista |
| A aba escondida pelo `semReunioes` | o app pergunta de novo a cada 5 minutos |
| A página sem dizer `pronta` | 15 s até "A reunião não abriu" |
| O `sair` sem resposta | 2 s |
| A pausa do navegador | repetida a cada 10 s enquanto a ligação dura |
| O "Link copiado" | 2 s |
| Um link do chat da reunião | `http` ou `https`, até 2.048 caracteres |
| A janela da reunião | o grande de hoje (1280×800) e a tela cheia |

Os limites da reunião (10 pessoas, 50 pedidos, 20 mensagens por minuto) são os de hoje.

## 9. Fluxos

1. **Marcar:** a aba Reuniões → "Nova reunião" → "Criar a reunião" → o chat guarda e devolve o link → o app copia o link e volta à lista.
2. **Entrar pelo app:** "Entrar" → o app pede o passe → a janela fica grande, com a página no `iframe` → a página diz `pronta` → o app manda o passe → a página troca o passe pela chave do colega e mostra a entrada → "Entrar" → a página abre o canal de colega e manda o `entrar` → o `aceito` → a página liga para o servidor de vídeo → `estado` com `naReuniao`.
3. **Entrar pelo navegador:** o menu → "Abrir no navegador" → o app pede o passe → o executável abre o navegador padrão em `/r/<código>#p=<passe>` → a página tira o passe do endereço e segue como no fluxo 2, sem o app.
4. **O "Abrir no app":** o link no navegador → a tela "o app ou o navegador" → "Abrir no app" → o Windows chama o app com `starsonic://reuniao/<código>` → o app vem para a frente e segue o fluxo 2 a partir do passe.
5. **Quem é de fora pede para entrar:** o `pedir` dela → o chat avisa as páginas dos colegas (o `participantes`) e os computadores deles (o `reuniaoPedido`) → o cartão na página, e o aviso do Windows se a reunião está escondida → o primeiro "Aceitar" ou "Recusar" decide → o pedido some de todos.
6. **Uma ligação da central:** toca → o cartão por cima da reunião → "Atender" → o `pausar` → a janela normal, com a tela da ligação e a faixa → a ligação acaba → o `retomar` → a janela grande, com a reunião.
7. **Fechar a janela:** o fechar → "Sair da reunião?" → "Sair da reunião" → o `sair` → a página sai e diz `fim` → a vista fecha → a janela vai para a bandeja.

## 10. Segurança e privacidade

- **O passe** só sai para um computador ligado ao chat, com a pessoa da vez, da empresa da reunião. Ele vale uma vez e 120 s. No app, vai por mensagem entre a interface e o `iframe`. No navegador, vai depois do `#`, que o servidor não recebe; ele aparece na linha de comando do navegador e pode ser visto por outro programa da mesma pessoa naqueles segundos, e por isso é de uso único e a página o gasta ao carregar.
- **A chave do colega** fica só na memória da página e na do servidor, como a chave de volta.
- **A chave do computador nunca chega à página.**
- **A página só aparece dentro do app:** o `frame-ancestors` deixa só a origem da interface. Outro site não consegue mostrar a reunião por baixo de um botão dele.
- **O que o executável passa a deixar** é pouco e fechado: a câmera e o microfone só para a origem do chat, a captura de tela só para a página da reunião, um `iframe` só no endereço de uma reunião, e abrir no navegador só `http` e `https`.
- **O `starsonic:`** só leva à entrada de uma reunião: a pessoa ainda clica em "Entrar". Um link montado por outra pessoa não faz mais do que isso.
- **Um link do chat da reunião** vem de qualquer pessoa da reunião, também de fora. Ele abre no navegador padrão, nunca dentro do app.
- **Os registros e o diagnóstico** seguem a regra de hoje: sem nomes, sem assuntos, sem códigos, sem passes e sem chaves; só contagens, nomes de comandos e códigos de erro. O nome de quem pede para entrar passa pelo núcleo só na memória, a caminho do aviso.
- **Nada novo é guardado** no banco: o passe e a chave do colega são da memória.

## 11. Interface e textos

Os textos saem das telas do quadro. Os que o quadro não mostra:

- **A lista:** "Acontecendo · 1 pessoa"; no menu, "O link vale até hoje, 23:59", "até amanhã, 23:59", "até 26/11, 23:59".
- **O cancelar:** "O link para de valer na hora." e, com a reunião acontecendo, mais "Como a reunião está acontecendo, as N pessoas saem." (com uma pessoa: "a pessoa que está nela sai.").
- **Os erros da aba:**
  - "Este link não vale mais";
  - "Este não é um link de reunião do Starsonic.";
  - "Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.", com "Abrir no navegador";
  - "Muitas tentativas. Espere um pouco para tentar de novo.";
  - "O servidor do chat não respondeu. Tente de novo.";
  - "Sem conexão com o chat. As reuniões voltam quando a conexão voltar.";
  - "O servidor do chat precisa ser atualizado para abrir reuniões pelo app.";
  - "Desligue a ligação para entrar na reunião.";
  - "Saia da reunião de agora para entrar em outra.";
  - "A reunião não abriu.", com "Tentar de novo" e "Fechar".
- **A Nova reunião:** "Outro dia e hora"; "O dia da reunião já passou."; "O link pode valer até 31 dias depois da reunião."; "Você já tem 100 reuniões marcadas. Cancele uma para marcar outra.".
- **A barra da reunião:** "Sair da tela cheia".
- **A faixa do "Telefone":** "O microfone está ligado" ou "O microfone está desligado".
- **A ligação em espera:** "<Nome> em espera", "Voltar à ligação" e "Desligar".
- **O fechar:** "Sair da reunião?"; "Fechar a janela tira você da reunião."; "Continuar na reunião"; "Sair da reunião".
- **Depois do fim, na aba:** "Você foi tirado da reunião"; "A reunião acabou"; "Este link não vale mais".
- **Os avisos curtos:** "A conexão com a reunião caiu. Entre de novo pela aba Reuniões."; "Você saiu da reunião porque a conta mudou.".
- **Na tela da ligação, com a reunião no navegador e o chat fora do ar:** "A reunião no navegador continua ouvindo você. Desligue o microfone lá.".
- **Na página, a pausa pedida pelo app:** "Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.", com "Voltar para a reunião".
- **O link do app sem o chat:** "Este computador não está ligado ao chat da empresa. Entre pelo navegador.".
- **Na página, o colega:**
  - o botão, para o leitor de tela: "Participantes, 1 pessoa quer entrar" e "Participantes, N pessoas querem entrar";
  - o cartão com vários pedidos: "<Nome> e mais N querem entrar", com "Ver os pedidos";
  - o "Tirar": "Tirar <Nome>?", com "Tirar" e "Voltar";
  - quem compartilha a tela, na lista: "compartilhando a tela";
  - o aceitar com a reunião cheia: "A reunião está cheia: ninguém mais entra agora.";
  - o passe que não vale, no navegador: "Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.".
- **A tela "o app ou o navegador"** usa os textos da tela 1 do quadro da página.

O leitor de tela ouve o pedido que chega ("<Nome> quer entrar") e o resultado de cada resposta.

## 12. Erros e testes

### 12.1 Erros

1. **O servidor do chat antigo com o app novo:** a aba funciona (marcar, listar, cancelar), mas o passe não existe, e o servidor responde `404`. O app lê a lista de novo: se a reunião continua nela, diz "O servidor do chat precisa ser atualizado…"; se sumiu, "Este link não vale mais".
2. **O passe vence antes de a página carregar** (um PC lento): a página recebe `401 passe` e diz `pronta` de novo, uma vez; o app manda outro passe.
3. **O servidor do chat reinicia com a pessoa na reunião:** vale o que o protocolo já diz (seção 9). A chave do colega deixa de valer: no app, a página pede outro passe sozinha; no navegador, ela diz para abrir de novo pelo app.
   - **Nota de 24/11 (aprovada pelo responsável às 08:24): o que acontece com o colega que já está na reunião.** A reunião continua no servidor de vídeo: todos continuam se ouvindo e se vendo. Mas o chat esqueceu quem está nela, e as chaves dos colegas deixaram de valer. Na entrega 1, a página do colega ficava com a lista parada, e cada clique respondia "O servidor de reuniões não respondeu": ninguém lhe dizia que era preciso sair e entrar de novo, e quem pedia para entrar esperava sem ninguém poder aceitar. Passa a valer:
     - **Dentro do app, a página entra de novo sozinha:** ela pede outro passe ao app (o `pronta`), abre um canal de colega novo, entra como um participante novo e troca a ligação com o servidor de vídeo pela dele. Para os outros, a pessoa some e volta em alguns segundos. O app não pergunta nada.
     - **No navegador, não há app para mandar outro passe.** A pessoa continua na reunião, mas deixa de cuidar dela: a página limpa a lista e os pedidos, que ela não tem mais como manter, e mostra o aviso "Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app."
     - **Fica com o plano da entrega 2,** que escreve os passos e os testes: como a página percebe que o chat reiniciou (e não que a rede falhou); os botões do colega desligados sempre que a página não pode responder; a tentativa de voltar mais devagar quando a falha é da rede; e o limite de tentativas do servidor logo depois de um reinício, quando um escritório inteiro entra de novo pelo mesmo endereço. São escolhas de quem constrói: a volta com o microfone e a câmera como estavam, e a tela compartilhada que não volta sozinha (como na pausa).
4. **O chat cai com a pessoa na reunião:** a reunião continua no servidor de vídeo, e a página volta sozinha pelo `voltar`, como hoje.
5. **A página trava ou não carrega dentro do app:** "A reunião não abriu", e o "Telefone" continua funcionando.
6. **A câmera ocupada por outro programa:** a página entra só com o que tem, como hoje.
7. **Dois colegas respondem ao mesmo pedido:** vale a primeira resposta, e a outra recebe `jaRespondido`, que não aparece como erro.
8. **A pessoa está na mesma reunião no app e no navegador:** são dois participantes. O app não impede.
9. **O app fecha, ou o chat cai, com a reunião do navegador em pausa:** a página continua em pausa, com o "Voltar para a reunião" à vista (7.9).
10. **A reunião cai para a pessoa** depois das tentativas de voltar: o `fora` do `estado` (4.5 e 7.5).

### 12.2 Testes automáticos

- **O chat, em Go, com o `-race`:**
  - o passe: uma vez só, os 120 s, preso à reunião, à pessoa e ao computador, a outra empresa, o limite por minuto, nada no log;
  - o abrir com o passe e com a chave, e cada erro;
  - o canal do colega: entra direto, começa a reunião parada, a reunião cheia, o `participantes` a cada mudança, o aceitar, o recusar, o tirar e o encerrar, a primeira resposta entre a página e a rota do app, e as mensagens novas recusadas num canal que não é de colega;
  - os eventos da seção 11 chegando ao computador do passe;
  - o `voltar` de um colega continua de colega;
  - a chave do colega deixa de valer com a pessoa desativada, o computador desligado do chat e a reunião cancelada;
  - a pausa: o repasse só às páginas daquele computador naquela reunião, e o `foraDaReuniao`.
- **A página, nos testes de unidade** (o cérebro continua puro): o modo do colega, a conversa com o app, a pausa e a volta, a escolha entre o app e o navegador.
- **A página, nos testes de tela:** as telas 6 a 10 e a tela "o app ou o navegador", com o teclado e o leitor de tela, e a conversa com uma janela de cima falsa.
- **De ponta a ponta, com o FreeSWITCH de verdade:**
  - um colega entra com um passe pedido pela rota do app, vê o pedido de quem é de fora, aceita, tira e encerra;
  - a página dentro de um `iframe` de uma origem de teste: a câmera e o microfone falsos funcionam nos dois sentidos, a tela compartilhada sai, o `pausar` cala os dois sentidos e o `retomar` os devolve;
  - a pausa pela rota do app, com a página fora de um `iframe`: cala os dois sentidos, o "Voltar para a reunião" a desfaz, e a repetição da mesma `vez` não pausa de novo.
- **A interface do app** (a ponte falsa e o servidor do chat de verdade, como os testes do chat de hoje): a aba nos três tamanhos e com as seis abas; criar, copiar, cancelar e cada erro; a vista com a página de verdade no `iframe`, até a entrada; as faixas; o cartão da ligação; o fechar; a página do aviso com um pedido; o link numa conversa; o "Abrir no navegador" do menu e do campo; a pausa da reunião do navegador (a rota no começo e no fim de uma ligação, a repetição, e o esquecer no `foraDaReuniao`); a queda (o `fora`); a troca de conta.
- **O núcleo e o executável,** nos testes em C++ que rodam fora do Windows: o formato do `starsonic:`, a regra das permissões, a regra da navegação do `iframe`, a conferência de um link, a regra do aviso com um pedido, os comandos novos.
- **No Windows do GitHub, com o WebView2 de verdade** (a fumaça que já existe): a entrada de uma reunião dentro do app, com a câmera e o microfone falsos, e a captura de tela liberada para a página. Ela precisa de um servidor do chat na máquina do teste e de um jeito, só no build de teste, de apontar o app para ele.

### 12.3 Teste manual

Uma seção nova do `docs/teste-manual.md`, para o responsável rodar no Windows e nas VMs de verdade: marcar e entrar; uma pessoa de fora no celular, aceita pelo app e pelo aviso; o "Abrir no navegador"; o "Abrir no app"; o tirar e o encerrar; a tela compartilhada de dentro do app; uma ligação da central no meio da reunião, recebida e feita; o "Telefone"; o fechar; dois colegas respondendo ao mesmo pedido.

## 13. Entrega

A construção se corta em duas entregas, cada uma com o seu plano e a sua revisão final:

1. **O servidor do chat e a página:** o passe, a chave do colega, o canal do colega, o modo do colega na página, a página dentro de um `iframe`, a conversa com o app, a pausa (a do app e a do navegador) e a tela "o app ou o navegador". Sem o app novo, nada muda para ninguém: a página continua tratando todos como de fora. A tela "o app ou o navegador" pode ir junto porque, sem o app novo, só existe a reunião de teste, que não a mostra: uma reunião marcada só nasce de um app `0.5.0`.
2. **O app `0.5.0`:** o núcleo, o executável e o instalador; a aba Reuniões; a vista da reunião e a convivência com as ligações.

- **A prova no WebView2 de verdade vem antes da entrega 2 crescer:** a câmera, o microfone e a captura de tela dentro do `iframe`, na fumaça do Windows do GitHub. Se ela falhar, a construção para e volta ao responsável com as reservas da seção 14.
  - **Nota de 24/11: a entrega 2 em três planos.** O primeiro é só a prova (`docs/superpowers/plans/2026-11-24-reunioes-etapa-2a-prova-no-webview2.md`): as regras do executável e a fumaça do Windows com um servidor do chat de verdade na máquina do teste, sem interface nova. Os outros dois são escritos com o resultado dela na mão: o que a página e o servidor do chat ainda devem ao colega (o item 3 da seção 12.1 e a nota de 24/11 da seção 7.5), e o app (o núcleo, o executável, o instalador e a interface). Cada plano tem a revisão dele, e a do último olha a entrega 2 inteira.
  - **O jeito de apontar o app da fumaça para um servidor do chat** (a seção 16 o deixava para quem constrói): o app fala com o chat pelo nome de sempre, e a máquina do teste leva esse nome a um servidor do chat dela mesma. O app não ganha gancho de teste para isso.
- **A ordem de instalar:** o servidor do chat primeiro, o app depois. O guia (`docs/chat-servidor.md`) e as notas da versão dizem isso.
- **Os documentos que mudam:** o `docs/chat-protocolo.md` (as seções 2, 9, 10 e 12), o `docs/ponte-windows.md`, o `docs/chat-servidor.md`, o `docs/teste-manual.md`, e uma nota datada na spec de 12/11 dizendo o que esta troca.
- A branch é nova, a partir da `main`. Quem publica as versões é o responsável, pelo GitHub.

## 14. Riscos

1. **A câmera, o microfone e a tela dentro de um `iframe` do WebView2.** A documentação do WebView2 diz que o pedido de permissão de um `iframe` chega ao aplicativo, e que a captura de tela pode ser liberada por quadro; falta ver funcionando. Mitigação: a prova cedo (seção 13). Reservas, nesta ordem: a página numa segunda janela do app, sozinha; e o navegador, que esta etapa já entrega. Provado em 24/11/2026 no WebView2 131: a nota 12.
2. **O mesmo microfone na janela e no motor.** O Windows deixa dois programas ouvirem o mesmo microfone, e a pausa cala um dos dois. Fica para o teste manual: fones com fio, sem fio e o viva-voz.
3. **A página escondida.** O navegador economiza numa página fora da vista; uma página com uma ligação de vídeo aberta fica fora dessa economia. Fica para o teste manual: 20 minutos no "Telefone" e a volta.
4. **O passe no endereço, no navegador.** Mitigação: uso único, 120 s, tirado do endereço ao carregar.
5. **O `starsonic:` bloqueado** numa empresa que não deixa o navegador abrir programas. Mitigação: o campo do link na aba.
6. **O app novo com o servidor antigo.** Mitigação: a mensagem do erro 1 e a ordem de instalar.
7. **A página agora também é uma tela do app:** uma mudança nela pode quebrar a vista do app. Mitigação: o teste de ponta a ponta do `iframe` roda nos testes da página, a cada mudança.
8. **O teclado dentro do `iframe`:** com o foco na página, os atalhos do app (Ctrl+1 a 6) não valem. Fica assim nesta etapa.
9. **Nota de 23/11 (a construção): o endereço privado do chat.** Nos testes de tela, o Chromium (a proteção "Local Network Access") não deixou uma janela servida de um endereço público mostrar dentro de si uma página de um endereço local, e esse teste roda com a proteção desligada. No teste de ponta a ponta, com as duas origens na mesma máquina, o bloqueio não apareceu. No app, a interface (`https://app.starsonic.local`) mostra o chat pelo nome público dele: se, na rede do cliente, esse nome levar a um endereço privado, o WebView2 pode barrar do mesmo jeito. A prova no WebView2 de verdade (seção 13) tem de incluir um chat alcançado por um endereço privado. A nota 12 resolveu só uma parte: o quadro carregou vindo de um endereço privado, mas no WebView2 `131`, que é mais velho que essa proteção; para um WebView2 de hoje, o risco continua aberto.
10. **Nota de 23/11 (a construção): o `iframe` nasce com o endereço.** O `iframe` da reunião nasce com o endereço e o `allow` juntos: o app nunca o põe na tela vazio para dar o endereço depois. Com o `allow` só para a origem do chat e sem o endereço, o documento vazio do começo é da origem do app, nada do `allow` vale para ele, e o Chromium `141` escreve no console um erro "Potential permissions policy violation" para cada recurso.
11. **Nota de 23/11 (a construção): o `speaker-selection` não foi provado.** O Chromium dos testes não conhece esse nome no `allow` e o recusa, e o `iframe` dos testes vai sem ele. A prova no WebView2 de verdade tem de conferir que a página, dentro do `iframe`, consegue mandar o som para o alto-falante escolhido nas Configurações do app. A nota 12 resolveu: a escolha do alto-falante funciona dentro do quadro, e o `speaker-selection` só rende um aviso no console.
12. **Nota de 24/11/2026 (a prova no WebView2 de verdade): o que ela mostrou.** A prova passou na segunda rodada do `build` no GitHub (a primeira reprovou num fato só, o do item 6 abaixo). A máquina tinha o WebView2 `131.0.2903.86`; o app é compilado com o SDK `1.0.4258.31`. O nome do chat levou a um endereço privado da própria máquina, com o certificado de uma autoridade posta na lista do Windows.
    1. **A página da reunião carrega no `iframe` da janela do app,** vinda de um endereço privado, com as opções de sempre do WebView2: manda o `pronta`, recebe o passe e chega à entrada do colega, com o nome, a prévia da câmera (1280 de largura) e o botão Entrar.
    2. **O pedido de permissão de um quadro chega ao app pelo evento do quadro** (um evento é o aviso que o WebView2 dá ao app de que algo vai acontecer, para o app responder; este é o `PermissionRequested` do `ICoreWebView2Frame3`, o aviso de um pedido feito pelo quadro), antes do evento da janela (o aviso de um pedido feito pela página inteira), e a origem que vem nele é a da página de cima (a do app), não a do quadro. Por isso a regra decide pelo endereço do documento que o quadro mostra, e não pela origem do pedido.
    3. **A câmera e o microfone funcionam no quadro** pela regra do app, e a página do app, quando pede a câmera, leva `NotAllowedError` (o erro com que o navegador diz à página que o pedido foi negado).
    4. **A captura de tela chega pelo evento do quadro** (o `ScreenCaptureStarting` do `ICoreWebView2Frame6`, que o WebView2 `131` já tem), a regra a deixa e a captura começou na primeira tentativa, a do `--auto-select-desktop-capture-source=Entire` (faixa `live`, superfície `monitor`). A página do app, quando pede a tela, leva `NotAllowedError`. A fumaça fica só com essa tentativa.
    5. **O alto-falante:** o `setSinkId` trocou a saída dentro do quadro (3 saídas). O `speaker-selection` no `allow` só rende um aviso no console (`Unrecognized feature: 'speaker-selection'.`), e a troca funciona assim mesmo.
    6. **O cancelamento da navegação de um quadro foi o achado da prova.** Na primeira rodada, o app pedia o cancelamento só no evento da janela (o `FrameNavigationStarting`) e o quadro carregava mesmo assim: no WebView2 `131`, com um tratador (o código do app que responde a um evento) de `NavigationStarting` no quadro que não mexia no `Cancel` (a resposta que para a navegação), o pedido da janela se perdia. Duas correções entraram: o quadro vale pelo documento que ele mostra (e não por uma navegação que só começou), e o cancelamento é pedido também no evento do próprio quadro, que roda por último. Na segunda rodada o bloqueio valeu: cada quadro recusado deu `o quadro nao carregou (erro 14)` (o 14 é o número com que o WebView2 diz que a navegação foi cancelada), e o quadro que já estava na reunião e foi mandado para outro endereço do chat continuou na reunião. Por isso a regra "um quadro que não é de reunião não ganha a câmera nem a tela" só roda no Windows para um quadro do próprio app sem endereço, que a fumaça põe entre as recusas: o bloqueio valeu antes que um quadro pudesse sair da reunião.
    7. **O endereço de fora** (`https://exemplo.com.br/`) não entra: a regra de segurança da página do app o recusa (`frame-src`, a parte da regra que diz de onde um quadro pode vir), e o executável escreve a recusa dele.
    8. **A abertura com a proteção "Local Network Access" ligada** carregou igual à principal. O WebView2 `131` é anterior a essa proteção e ignora os argumentos dela: nesta máquina, essa abertura ainda não diz nada.
    9. **Nada do código da reunião, dos passes, da chave do computador, do nome da pessoa, da empresa nem do assunto** apareceu no `diagnostico.log` de nenhuma abertura.
    10. **O app fechou** com o `--sair` (código 0) em todas as aberturas, com o quadro aberto, e o `hosts` e a lista de autoridades do Windows voltaram ao que eram.

    A prova não mostra duas coisas, que ficam para o teste no PC de verdade e para o plano seguinte: o WebView2 dos PCs de hoje (os com o Windows atualizado têm um mais novo que o `131`, e entre os dois entra a proteção "Local Network Access"), e a vista da reunião de verdade (a fumaça põe o quadro na página do app ela mesma; a vista é do plano do app). Agora a fumaça atualiza o WebView2 da máquina antes de rodar, com o mesmo programa da Microsoft que o instalador do app usa num PC sem o WebView2; o resultado com o WebView2 de hoje tem uma nota própria.

## 15. As escolhas deste desenho

O responsável aprovou as telas e a ordem. Estas escolhas são do desenho, e ele as confere ao ler:

1. O passe de uso único e a chave do colega, para reconhecer o colega na página sem a chave do computador (7.2).
2. O painel "Participantes", o cartão do pedido e o "Encerrar para todos" moram na página, para valerem igual no app e no navegador.
3. O "Tirar" pede um segundo clique. O quadro mostra só o botão.
4. Com vários pedidos, o cartão leva ao painel, e o aviso do Windows mostra um de cada vez.
5. O Não perturbe não cala o aviso de quem quer entrar.
6. Um link de reunião deste servidor numa conversa do chat do app vira um link que abre a reunião no app. Não está no quadro.
7. A ligação da central pausa a reunião inteira, também a tela compartilhada, que não volta sozinha.
8. O "Voltar para a reunião" durante uma ligação mostra a ligação em espera num cartão por cima da reunião. O quadro diz a regra, mas não desenha o cartão.
9. Numa reunião, as ligações da central são só de voz, e o atender automático continua valendo.
10. Com uma ligação ou a sala de vídeo abertas, o app não abre uma reunião.
11. Com a sessão do Windows bloqueada, a câmera da reunião desliga.
12. O app manda sempre o `valeAte`, no relógio do PC.
13. No app, a reunião usa os aparelhos das Configurações do app.
14. O vermelho dos botões novos é o `#c23b3b` da página: o `#d64545` do app não dá o contraste mínimo com o texto branco de 15 px.
15. A tela "o app ou o navegador" aparece só no Windows, e não na reunião de teste.
16. **A pausa vale também para a reunião aberta no navegador,** levada pelo servidor do chat (7.9). É trabalho a mais no servidor, na página e no app. O caminho mais barato seria só avisar, na tela da ligação, que a reunião do navegador continua ouvindo: se o responsável preferir esse, a 7.9 sai e fica só o aviso.
17. O campo do link ganha o "Abrir no navegador" ao lado do "Entrar", para o colega que não marcou a reunião. Não está no quadro.
18. Quando a reunião cai sem a pessoa pedir, a tela "Você saiu da reunião" da página fica dentro da janela, com o "Entrar de novo".
19. Sair do app pela bandeja não pergunta; o "Atualizar agora" pergunta; trocar de conta tira a pessoa da reunião do app.
20. O "Voltar para a reunião" de uma ligação só aparece com uma ligação só, já atendida.

## 16. O que fica para quem constrói

- Os nomes das rotas, das mensagens e dos comandos novos, desde que o protocolo e a ponte escritos digam os mesmos.
- Como o servidor guarda o passe e a chave do colega na memória, e como o participante do colega nasce (a reunião de teste, que aceita na hora, é o precedente).
- Como a página fica sabendo a origem do app (no modo de teste há outras).
- A divisão da interface do app em arquivos, seguindo a do chat (`windows/ui/src/chat`).
- O desenho da aba no Compacto, no Mínimo e no tema escuro, pelas regras e pelas cores de hoje. No Mínimo, o "Copiar link" pode ir para o menu.
- O que a página deixa de desenhar enquanto está escondida, para gastar menos.
- O jeito de apontar o build de teste para um servidor do chat da fumaça.
- A ordem das partes dentro de cada entrega.

## 17. O que a construção da entrega 1 decidiu (23/11)

O que muda o que a pessoa vê ou ouve e esta spec não dizia. São escolhas de quem construiu, para o responsável confirmar ao ler.

**Em 24/11/2026, às 08:24, o responsável respondeu "pode seguir"** à entrega 1, que lhe mostrou, com as telas construídas, os itens 1, 2, 3 e 6: esses quatro ficam confirmados. Os itens 4 e 5 são regras entre o app, a página e o servidor: seguem como escolhas da construção, e o plano da entrega 2 traz cada uma com um teste.

1. **O servidor de vídeo que falha numa resposta.** O `recusa` com o `servidorVideo` (um "Aceitar", um "Tirar" ou um "Encerrar para todos" que o servidor de vídeo não deixou acontecer) mostra o aviso curto "O servidor de reuniões não respondeu" (o texto que a página já tinha), por 5 s, e o diz ao leitor de tela. Sem isso, o clique não faria nada à vista. Os outros motivos não mostram nada, porque a lista seguinte diz a verdade (outro colega respondeu antes, ou a pessoa já saiu), menos o `cheia`, que mostra a frase dele.
2. **O cartão com dois pedidos ou mais** mostra "<Nome> e mais N querem entrar" e o "Ver os pedidos", sem a frase "É de fora da empresa, e espera até um colega responder.". A frase fala de uma pessoa só.
3. **"A reunião está cheia: ninguém mais entra agora."** também é dita ao leitor de tela, quando aparece. Uma falha à vista depois do "Aceitar" não pode ser muda.
4. **A rota da pausa conta só quem está na reunião ou entrando** por uma página daquele computador, e um `409` dela não é para sempre (a nota da 7.9). É a regra da família "Com a pessoa na reunião", que diz a verdade ao app sobre a reunião do navegador.
5. **O app repete a pausa e o bloqueio quando a pessoa entra** (a nota da 7.5). A página não guarda um bloqueio que chega antes de ela entrar, e só guarda a pausa que chega com ela entrando: quem sabe que a ligação ou o bloqueio continuam é o app.
6. **Quem sai da reunião durante uma pausa** volta, no "Entrar de novo", com o microfone e a câmera desligados (a nota da 7.9). É o lado seguro: a pausa não liga nada sozinha depois de acabar.
