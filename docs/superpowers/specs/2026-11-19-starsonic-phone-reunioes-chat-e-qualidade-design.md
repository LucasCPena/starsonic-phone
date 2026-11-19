# Starsonic Phone — reuniões com link — o chat da reunião e o sinalizador de qualidade — especificação de design

- **Data:** 19/11/2026
- **Status:** aprovada em 19/11, às 03:50, com o "Continue" do responsável, e construída no mesmo dia, para sair como a `0.2.0-rc.6` do chat (quem publica a versão é o responsável). O pedido é de 18/11, às 17:48: "colocar o chat na reunião também e sinalizador de qualidade de chamada". Em 18/11, às 17:53, ele disse que o sinalizador é o da reunião no navegador. Em 19/11, às 00:24, ele mandou fazer os dois sem responder às outras perguntas: as escolhas da seção 14 são deste desenho, do plano (`docs/superpowers/plans/2026-11-19-reunioes-chat-e-qualidade.md`) e da construção, para ele corrigir. A construção mudou uma regra da conta do sinalizador (seção 7.4). Um revisor de fora leu tudo no fim, e as correções que ele pediu entraram no mesmo dia: elas estão marcadas "Corrigido na revisão final" nas seções 4.2, 7.1 e 7.4, e juntas na seção 14, itens 39 a 47.
- **Telas:** o quadro "Starsonic — reunião no navegador", telas 20 a 24.
- **Base:** a spec de 12/11 (`2026-11-12-starsonic-phone-reunioes-link-design.md`), que deixou "o chat dentro da reunião" fora do escopo, e a de 18/11 (o palco). Esta spec traz o chat para dentro e acrescenta o sinalizador. O resto daquelas continua valendo.

## 1. Contexto

Na reunião pelo navegador, as pessoas se veem e se ouvem, e uma delas pode compartilhar a tela. Falta o que todo mundo usa numa reunião para passar um link, um número ou um recado sem interromper quem fala: o chat. E falta um jeito de a pessoa saber, quando a imagem trava, se o problema é a internet dela.

Hoje só a página do navegador entra numa reunião. O app do PC entra na etapa 2 da spec de 12/11. Por isso as duas coisas nascem na página.

## 2. Objetivos

1. Quem está na reunião manda um texto para todos os outros, e lê o que os outros mandam.
2. Cada pessoa vê, o tempo todo, como está a conexão dela com a reunião: boa, instável ou ruim.
3. Nada novo é guardado: o "Nada é gravado" do alto da tela continua verdadeiro.

## 3. Critérios de sucesso

1. Com três pessoas na reunião, uma mensagem de uma aparece para as outras duas em até 1 s, com o nome de quem mandou e a hora.
2. Com o chat fechado, a mensagem nova mostra o número no botão `Chat` e um aviso curto, com o nome e o começo do texto.
3. Abrir o chat no PC não esconde ninguém: os quadros se arrumam no espaço que sobra.
4. Um endereço da internet numa mensagem vira um link que abre em outra aba. Um texto com sinais de HTML aparece como texto.
5. Quando a reunião acaba, as mensagens somem de todas as páginas, e não ficam em nenhum servidor.
6. Com a rede da pessoa perdendo 10% dos pacotes, o sinalizador dela passa a "Conexão ruim" em até 10 s, e volta a "Conexão boa" em até 20 s depois de a rede voltar ao normal.
7. Os registros do servidor não ganham o texto, o nome nem o ramal de ninguém.

## 4. O que a versão entrega

### 4.1 As telas

- **20 · O chat aberto, no PC:** o painel de 360 pontos à direita, com o título, o aviso de que as mensagens somem, as mensagens e o campo de escrever. Os quadros ocupam o resto.
- **21 · A mensagem nova com o chat fechado, no PC:** o número no botão `Chat` e o aviso curto em cima dos controles, com o `Abrir o chat`.
- **22 · O sinalizador:** o botão no alto da tela nos quatro estados, e o cartão que cada um abre.
- **23 · O celular:** o `Chat` entra nos controles (quatro botões), e o sinalizador vai para o alto, só com o desenho.
- **24 · O chat aberto, no celular:** ele cobre a tela, com o `Voltar para a reunião`. A reunião continua.

O quadro vale para o desenho: as medidas, as cores e os lugares. Os textos de todas as telas estão na seção 4.4, para quem constrói sem o quadro aberto. O plano leva o arquivo de cada tela junto.

### 4.2 O chat

- **Quem:** todos os que estão na reunião leem e escrevem, os colegas e quem é de fora. Não há mensagem só para uma pessoa.
- **O quê:** só texto, de 1 a 1.000 caracteres. Sem arquivo, sem foto, sem apagar e sem editar.
- **Quanto tempo:** as mensagens vivem só na página de cada pessoa, enquanto ela está na reunião. O servidor não guarda nenhuma: ele recebe e repassa.
  - Quem entra depois não vê as mensagens de antes.
  - A regra é uma só: as mensagens vivem enquanto a página está na tela da reunião. Elas somem quando a página sai dessa tela, por qualquer motivo.
  - Quem clica em `Sair`, ou é tirado, perde as que tinha. Quem entra de novo começa vazio.
  - Quem perde a conexão continua com as que tinha enquanto a página tenta voltar sozinha (o cartão "A conexão caiu. Entrando de novo…"), e depois de voltar. As que foram mandadas enquanto ele estava fora, ele não recebe. Se a página desiste de voltar e mostra "Você saiu da reunião", as mensagens somem, como em qualquer saída.
  - Quando a reunião acaba, somem para todos.
- **Cada mensagem** mostra o nome de quem mandou, como está no quadro dela, e a hora, no relógio de quem lê. As da própria pessoa ficam à direita, com "Você".
- **Os endereços:** um trecho que começa com `http://` ou `https://` vira um link, com o endereço inteiro à vista, que abre em outra aba. O resto do texto é sempre texto. O que aparece é o endereço para onde o link leva: um sinal que muda a direção do texto (os de escritas como o árabe e o hebraico) acaba o endereço, e o link é sempre escrito da esquerda para a direita, à parte do resto da frase. (Corrigido na revisão final: com um sinal desses no meio, as letras do endereço apareciam em outra ordem.)
- **Escrever:** o Enter manda, e o Shift+Enter pula linha, como no chat do app. No celular, o Enter pula linha, e o botão manda.
- **A mensagem que não foi:** fica marcada "Não enviada", com o motivo em poucas palavras e o `Tentar de novo`. Um leitor de tela ouve esse mesmo texto, uma vez, com o chat aberto ou fechado: quem não vê a tela não pode achar que a mensagem saiu. (Corrigido na revisão final.)
- **Com o chat fechado:** o botão `Chat` mostra quantas mensagens novas há (até 9, depois "9+"), e um aviso curto aparece por 5 s com o nome e o começo da última. Um leitor de tela ouve "<nome> escreveu: <texto>".
- **O aviso curto** fica logo acima dos controles, no meio, e não cobre o Você. Só um aparece por vez: um aviso novo toma o lugar do anterior. O aviso de conexão ruim (seção 4.3) usa o mesmo lugar e o mesmo tempo.
- **No PC,** com a janela a partir de 900 pontos de largura, o chat é um painel ao lado, e os quadros se arrumam no resto. Em janelas mais estreitas e no celular, o chat cobre a área da reunião. Cobrindo a tela, ele parece outra tela: por isso o Voltar do aparelho (o botão ou o gesto do Android, o gesto do iPhone, o Voltar do navegador) fecha o chat, e a pessoa continua na reunião. (Corrigido na revisão final: antes, o Voltar saía da página, que é sair da reunião.)
- **O teclado:** abrir o chat leva o foco ao campo de escrever. O Esc fecha o chat quando o foco está nele, e devolve o foco ao botão `Chat`.
- **Sem o canal com o chat** (ele caiu e a página está ligando de novo, ou ela desistiu de ligar e a reunião segue só com a imagem e o som), o campo fica desligado, com "O chat volta quando a conexão voltar.". As mensagens que a pessoa já tinha continuam à vista. Um leitor de tela ouve essa frase quando isso começa com o chat aberto, e quando a pessoa abre o chat assim. Com a conexão da reunião caída, quem fala é o aviso da queda.

### 4.3 O sinalizador

- **O que mede:** a conexão de quem vê a tela com o servidor de vídeo. Ninguém vê a conexão dos outros.
- **Onde fica:** no alto da tela, ao lado do "Nada é gravado". No celular, só o desenho, com o nome para o leitor de tela.
- **Os estados:** "Conexão boa" (três barras), "Conexão instável" (duas barras, âmbar), "Conexão ruim" (uma barra, vermelho) e "Medindo a conexão…" (as barras apagadas). O desenho e o texto mudam junto com a cor.
- **O cartão:** um clique abre a explicação do estado, o que a pessoa pode fazer, e dois números: a perda e o atraso. São os números que ela lê para o suporte ao telefone. Um número que o navegador não dá aparece como "—".
- **O aviso:** quando o estado vira "ruim", um aviso curto diz "Sua conexão está ruim", com o `Ver os detalhes`. No máximo um a cada 2 minutos.
- **Com a conexão caída,** vale o cartão "A conexão caiu" que a página já tem, e o sinalizador mostra "Medindo a conexão…" até voltar.

### 4.4 Os textos das telas

**O chat:**

| Onde | Texto |
|---|---|
| O botão, nos controles | `Chat` |
| O botão, para o leitor de tela, com mensagens novas | "Chat, 1 mensagem nova", "Chat, 2 mensagens novas" |
| O título do painel | "Chat da reunião" |
| O botão de fechar, no PC (só o desenho) | para o leitor de tela: "Fechar o chat" |
| No celular, embaixo do título | "Você continua na reunião" |
| O botão de voltar, no celular (só o desenho) | para o leitor de tela: "Voltar para a reunião" |
| O aviso do alto do painel | "As mensagens são para todos da reunião e somem quando ela acaba." |
| O painel sem mensagem nenhuma | "Nenhuma mensagem ainda." |
| O cabeçalho de cada mensagem | "Ana Souza · 14:02"; nas da própria pessoa, "Você · 14:04" |
| Quem escreveu sem nome conhecido | "Participante" |
| O campo de escrever | "Mensagem para todos da reunião" |
| O botão de mandar (só o desenho) | para o leitor de tela: "Enviar a mensagem" |
| A mensagem que não foi | "Não enviada", o motivo quando há (seção 10) e o `Tentar de novo` |
| O campo desligado, sem o canal | "O chat volta quando a conexão voltar." |
| O aviso curto da mensagem nova | "Carlos Lima escreveu", o começo do texto numa linha só, e o `Abrir o chat` |

**O sinalizador:**

| Estado | O botão | O título do cartão | A explicação | O que fazer |
|---|---|---|---|---|
| Boa | "Conexão boa" | "Sua conexão está boa" | "A imagem e o som estão chegando bem." | nada |
| Instável | "Conexão instável" | "Sua conexão está instável" | "A imagem ou o som podem falhar de vez em quando." | as duas primeiras dicas |
| Ruim | "Conexão ruim" | "Sua conexão está ruim" | "Os outros podem não ver ou ouvir você direito, e a imagem deles pode travar para você." | as três dicas |
| Medindo | "Medindo a conexão…" | "Medindo a conexão…" | "Os números aparecem aqui em alguns segundos." | nada |

- As dicas, nesta ordem: "Chegue mais perto do Wi-Fi, ou use o cabo de rede."; "Feche downloads e vídeos em outros programas."; "Se continuar, desligue a câmera: só o som precisa de bem menos internet."
- Os números, no pé do cartão: "Perda: 4% · Atraso: 210 ms".
- Para o leitor de tela, o botão diz o estado e o que o clique faz: "Conexão boa. Ver os detalhes". No "Medindo", só "Medindo a conexão".
- O aviso curto: "Sua conexão está ruim", com o `Ver os detalhes`, que abre o cartão.

Dois textos desta lista não estão no quadro, e são escolha deste desenho: o do painel sem mensagem nenhuma e a explicação do "Medindo".

## 5. Fora do escopo

- O chat da reunião no app do PC. Ele vem com a etapa 2 da spec de 12/11, quando o app entrar nas reuniões.
- Guardar as mensagens depois da reunião, ou mostrá-las a quem entra depois.
- Arquivos, fotos, reações, respostas e mensagens só para uma pessoa.
- Apagar a mensagem de outra pessoa. Quem atrapalha é tirado da reunião, como hoje.
- Mostrar a conexão de cada participante para os outros, ou para a administração.
- Mudar a qualidade do vídeo sozinho quando a conexão está ruim (o "mosaico mais leve" da spec de 18/11 continua para depois).

## 6. Os caminhos

### 6.1 O chat

**A. Pelo canal que a página já tem com o chat (o escolhido).** A página manda a mensagem pelo canal dela, e o servidor do chat a repassa aos canais das outras pessoas da reunião. Nada é guardado.

- A favor: usa o que já existe e já sabe quem está na reunião, com os nomes. É o mesmo caminho do palco.
- O custo: sem histórico. Quem recarrega a página perde as mensagens.

**B. Pelo FreeSWITCH.** A conferência dele tem um chat próprio. Não serve: ele não conhece os nomes, passaria por fora do servidor que cuida de quem pode o quê, e pediria mudar o agente.

**C. Como uma conversa do chat do app, guardada no banco.** Os colegas veriam a conversa depois, na aba Chat. Não agora: quem é de fora não é uma pessoa do chat, e guardar o que um convidado escreveu é um dado a mais para cuidar. Pode vir depois, se o histórico fizer falta.

### 6.2 O sinalizador

**A. A página mede a própria conexão, com os números que o navegador dá (o escolhido).** Nada vai para o servidor.

- A favor: pequeno, fica só na página, e responde à pergunta de quem vê a imagem travar.
- O custo: ninguém vê a conexão dos outros.

**B. O servidor de vídeo mede cada pessoa e avisa as páginas.** Cada quadro ganharia um desenho de conexão ruim. Fica para depois: pede o agente perguntar ao FreeSWITCH o tempo todo, e uma parte nova no protocolo.

## 7. Arquitetura

### 7.1 O protocolo da página (seção 10 do `docs/chat-protocolo.md`)

**A página manda:**

```
{"tipo": "mensagem", "id": "k3f9a2", "texto": "O link é https://exemplo.com.br"}
```

- O `id` é da página: de 1 a 16 letras ou números. Serve para ela saber de qual mensagem é a resposta.
- O `texto` segue a regra dos textos do protocolo (seção 3), com 1 a 1.000 caracteres depois de tirados os espaços das pontas. A quebra de linha vale.

**O chat manda, a cada página da reunião, também à de quem escreveu:**

```
{"tipo": "mensagem", "id": "k3f9a2", "de": "<participante>", "nome": "Carlos Lima", "voce": true, "texto": "…"}
```

- O `id` só vai para quem escreveu, junto com o `voce: true`. Para os outros, a mensagem vai sem `id` e com `voce: false`.
- O `nome` é o do palco: o do colega no chat, ou o que a pessoa de fora digitou. Sem nome conhecido, vai `""`, e a página escreve "Participante".
- A hora não vai: cada página usa a hora em que a mensagem chegou.

**O chat recusa, só para quem escreveu:**

```
{"tipo": "mensagemRecusada", "id": "k3f9a2", "motivo": "limite" | "grande" | "foraDaReuniao" | "invalida"}
```

- **Quem recebe** é quem recebe o palco: a página aceita, com o canal aberto, que está na reunião ou entrando nela. É a regra que o servidor já usa para o palco (o `recebePalco`).
- **Entrando tem fim** (corrigido na revisão final). Entrando é ter uma senha da câmera ainda não usada, e vale nas 3 primeiras senhas seguidas sem a pessoa entrar, a do aceito contando. A página de verdade gasta uma no aceito ou no `Entrar de novo`, e até três nas tentativas de voltar depois de uma queda. Da quarta em diante, a senha ainda serve para entrar, mas a página só volta a receber o palco e o chat quando a câmera dela entra na reunião, e a conta recomeça. Antes, quem saía (ou nunca entrava) podia pedir uma senha a cada 30 s, sem entrar, e continuar lendo o chat e vendo quem estava na reunião sem aparecer para ninguém. A regra é uma só, do palco e do chat: o palco passou a segui-la também.
- **Quem pode mandar** é quem recebe: a mesma regra, sem outra. Assim, a página que acabou de ser aceita não tem a primeira mensagem recusada por ter mandado um segundo cedo demais. Antes de ser aceita e depois de sair, a resposta é `foraDaReuniao`.
- **O nome** que vai na mensagem é o do palco para aquele participante.
- **O limite** é de 20 mensagens por minuto por participante, numa conta só do chat: as mensagens do chat não gastam as 20 das outras, e as outras não gastam as do chat. A conta é da pessoa, e não do canal dela: o canal novo de uma página que volta continua com a mesma conta. O canal tem também a janela dele, de 20 por minuto, como a do `camera`, que conta toda mensagem do chat que chega por ele, também a recusada. (Corrigido na revisão final: a primeira versão tinha só a janela do canal, e uma página que abrisse um canal novo a cada 20 mensagens mandava sem limite.)

### 7.2 O servidor do chat

- O pacote das reuniões (`internal/reunioes`) ganha o repasse: confere quem manda, o texto e o limite, e põe a mensagem na fila de cada página que recebe o palco, na mesma seção que já protege a sala.
- Nenhum campo novo na sala guarda mensagens. Depois de repassar, o servidor não tem mais o texto.
- Os registros não levam o texto, o nome nem o `id`.

### 7.3 A página

- **O cérebro** (`estado.js`) ganha a lista das mensagens da reunião, a conta das não lidas e o estado do painel. Ela esvazia a lista quando a página sai da tela da reunião, por qualquer fim (a pessoa saiu, foi tirada, a reunião acabou, ou a página desistiu de voltar), e não mexe nela enquanto a página tenta voltar ou ligar o canal de novo. Continua uma função pura, com os testes dela.
- **A tela** (`pagina.js`, `pagina.html`, `pagina.css`) ganha o painel, o botão, o número, o aviso e o sinalizador. Os quadros não mudam: eles já se arrumam pela medida da área, e a área encolhe quando o painel abre. O chat que cobre a tela põe uma entrada no histórico do navegador ao abrir, e a tira ao fechar: é o que faz o Voltar do aparelho fechar o chat. Ao lado dos quadros, ele não mexe no histórico.
- **O texto de cada mensagem** é escrito como texto, nunca como HTML. Os links são criados um a um, só para trechos que começam com `http://` ou `https://`, com `target="_blank"` e `rel="noopener noreferrer"`.
- **O sinalizador** é uma peça nova (`qualidade.js`), em duas partes: uma função pura, que recebe as últimas medidas e devolve o estado, e a parte que pede os números ao navegador a cada 2 s, na ligação principal da reunião. Ela para de medir com a aba escondida.

### 7.4 A conta do sinalizador

A cada 2 s, a página pede os números ao navegador (o `getStats` da ligação principal) e os compara com os da medida anterior:

- **A perda do que chega:** os pacotes perdidos sobre os esperados, desde a medida anterior, no som e no vídeo (o `inbound-rtp`). Vale a maior das duas.
- **A perda do que sai:** a que o servidor de vídeo informa de volta, no som e no vídeo (o `fractionLost` do `remote-inbound-rtp`). Ela só conta para o que a página mandou: a do som, só se a página mandou pacotes de som desde a medida anterior, e a do vídeo, só se mandou pacotes de vídeo (o `packetsSent` do `outbound-rtp`). Sem esse contador, a página não tem como saber, e a perda não conta contra a pessoa. Um relatório com mais de 10 s também não conta. E um relatório só conta quando (as duas regras são da revisão final, logo abaixo):
  - **chegou depois de a página ser vista mandando** aquele tipo de pacote: o relatório de antes de a câmera ligar fala de um tempo em que não havia nada para perder;
  - **traz pacotes perdidos novos** desde o relatório anterior do mesmo fluxo (o `packetsLost` do `remote-inbound-rtp` aumentou). Sem pacotes perdidos novos, a perda dele é zero, qualquer que seja o `fractionLost`. O primeiro relatório que a página vê de cada fluxo é só a base dessa comparação. No navegador que não dá o `packetsLost`, vale o `fractionLost`, como antes.
- **A perda** da medida é a maior entre a do que chega e a do que sai.
- **O atraso:** o tempo de ida e volta até o servidor de vídeo (o `currentRoundTripTime` do par de endereços em uso; sem ele, o `roundTripTime` do `remote-inbound-rtp` do som). O navegador não mede esse tempo a cada leitura: ele guarda a última amostra, que muda a cada 2,5 s, mais ou menos (medido no Chromium). Por isso o atraso que conta, e que o cartão mostra, é **o menor das duas últimas amostras diferentes** (a amostra é reconhecida pelo `responsesReceived` do par, ou pela hora do relatório do som). Com uma amostra só, ainda não há atraso. No navegador que não dá como reconhecer a amostra, cada leitura vale como uma.
- **Nada chegou:** nenhum pacote de som e nenhuma imagem nova desde a medida anterior.

Esses números foram conferidos em 19/11, no Chromium, contra o FreeSWITCH de verdade:

- O servidor de vídeo manda os relatórios de volta: há `remote-inbound-rtp` para o som e para o vídeo, com a perda e o atraso. E o par de endereços em uso dá o atraso.
- O mosaico e o som chegam sempre, a 25 imagens e 50 pacotes de som por segundo. Foi assim com duas pessoas com câmera, com uma pessoa sozinha sem câmera e sem microfone, e com duas pessoas sem câmera e sem microfone. Por isso o "nada chegou" não acontece numa reunião parada ou vazia.
- **Corrigido na construção, em 19/11.** A primeira versão desta seção dizia que, com a câmera desligada, o relatório do vídeo parava de chegar. Não para: o FreeSWITCH manda relatórios também do que a página não manda. Com a câmera desligada, o primeiro relatório do vídeo chega uns 3 s depois da entrada e diz uma perda de 255 em 256; o seguinte, uns 4 s depois, diz zero. Com a conta da primeira versão, quem entrava sem câmera via "Conexão ruim", com "Perda: 100%", por uns 10 s. Por isso a perda do que sai passou a contar só para o que a página manda. O microfone desligado continua mandando 50 pacotes por segundo: a perda do som conta sempre que há som saindo. O teste de ponta a ponta achou o defeito antes de a versão sair, e passou a provar a regra, com todos sem câmera e sem microfone.
- **Corrigido na revisão final, em 19/11.** O revisor de fora mostrou que a correção acima não bastava, e um teste de ponta a ponta novo confirmou com o FreeSWITCH de verdade: quem entrava sem câmera e a ligava nos primeiros segundos via "Conexão ruim", com "Perda: 100%", 7 s depois de entrar. O relatório dos 255 em 256 continuava sendo o mais novo quando a câmera começava a mandar. Daí a primeira regra: o relatório tem de chegar depois de a página ser vista mandando. Com ela, sobrou um "Conexão instável", com "Perda: 3%". A causa, medida: o FreeSWITCH conta **um** pacote perdido que não existe num fluxo que começa depois do primeiro relatório dele, e o relatório seguinte divide esse pacote pelos poucos que a câmera mandou até ali (7 em 256, com 37 pacotes). O `packetsLost` fica em 1 do primeiro relatório em diante: nenhum pacote novo se perdeu. Daí a segunda regra: a perda de um relatório só conta com pacotes perdidos novos.
- **O atraso, também da revisão final.** Com uma leitura a cada 2 s e uma amostra a cada 2,5 s, duas leituras seguidas viam a mesma amostra em 1 de cada 5 vezes. Uma resposta lenta sozinha, de 500 ms ou mais, contava como duas medidas ruins: o bastante para o "Conexão ruim" e o aviso. Com o menor das duas últimas amostras, uma resposta lenta não muda nada, e o atraso alto de verdade aparece na amostra seguinte.

O estado de cada medida:

| Estado | Quando |
|---|---|
| Ruim | perda de 8% ou mais, ou atraso de 500 ms ou mais, ou nada chegou |
| Instável | perda de 2% ou mais, ou atraso de 250 ms ou mais |
| Boa | o resto |
| Sem número | o navegador não deu a perda nem o atraso, e alguma coisa chegou |

Com um número só (a perda sem o atraso, ou o contrário), a medida é decidida por ele.

O estado mostrado não acompanha cada medida, para não piscar:

- **Piora** quando as 2 últimas medidas são piores que o estado mostrado (4 s). Ele passa para a menos ruim das duas. Só pelo atraso, a piora leva de 5 a 9 s no Chromium: são precisas duas amostras altas seguidas, e depois as duas medidas. Pela perda, continua nos 4 s.
- **Melhora** quando as 5 últimas medidas são melhores que o estado mostrado (10 s). Ele passa para a pior das cinco. De "ruim", cinco medidas boas levam direto a "boa".
- **É "Medindo a conexão…"** nas 2 primeiras medidas da ligação, depois de 2 medidas seguidas sem número, e enquanto a conexão está caída.
- Uma medida sem número não conta para piorar nem para melhorar.

**A imagem que para com o som chegando não entra na conta.** Quando só a imagem para, e a perda e o atraso estão bons, o mais provável é que a causa esteja no servidor, e não na internet de quem vê. Dizer "sua conexão está ruim" seria culpar a pessoa errada. Quando a imagem para por causa da rede, a perda aparece nos números.

**A aba escondida:** a página para de medir. Quando a aba volta, a primeira medida serve só de base para a seguinte, e o estado mostrado fica como estava.

**A pausa** (da revisão final). O celular que foi para outro app, ou o navegador que travou, também para de medir sem a aba "esconder". Por isso uma leitura que chega mais de 6 s depois da anterior é tratada como a volta da aba: ela é só a base da seguinte, e o estado mostrado fica como estava. Depois de uma pausa (essa, ou a da aba escondida), as medidas de antes dela não contam mais para piorar nem para melhorar, e os relatórios e as amostras de antes também não. Sem isso, os números acumulados durante a pausa viravam uma medida só, e uma medida ruim de antes somada a uma de depois mostrava "Conexão ruim" a quem acabava de voltar.

Um número que o navegador não dá não conta contra a pessoa.

## 8. Os valores

| O quê | Valor |
|---|---|
| O tamanho de uma mensagem | de 1 a 1.000 caracteres |
| O limite de mensagens | 20 por minuto por participante, e 20 por minuto por canal, à parte dos outros |
| Entrando sem entrar | as 3 primeiras senhas da câmera seguidas valem para o palco e o chat |
| As mensagens que a página guarda | as últimas 500 da reunião |
| O número no botão | até 9, depois "9+" |
| A largura do painel no PC | 360 pontos, com a janela a partir de 900 |
| A medida do sinalizador | a cada 2 s |
| O relatório do servidor de vídeo que ainda vale para a perda do que sai | o dos últimos 10 s, só do que a página mandou desde a medida anterior, chegado depois de ela começar a mandar e com pacotes perdidos novos |
| O atraso que conta | o menor das 2 últimas amostras diferentes |
| A pausa do medidor | mais de 6 s entre duas leituras: a leitura seguinte é só a base |
| O aviso curto (da mensagem nova e da conexão ruim) | 5 s, um por vez |
| O aviso de conexão ruim | no máximo 1 a cada 2 minutos |

## 9. Segurança e privacidade

- **O texto nunca vira HTML.** A regra de segurança da página (CSP) continua a mesma, sem script nem estilo dentro da página.
- **Os links** só nascem de `http://` e `https://`, mostram o endereço inteiro e abrem em outra aba, sem dar à outra página acesso a esta. O endereço à vista é o do link: um sinal de direção do texto o acaba, e o link é escrito da esquerda para a direita.
- **Só quem foi aceito e está na reunião, ou entrando nela, manda e recebe.** Quem saiu ou foi tirado não recebe mais nada, como no palco. Entrando tem fim (seção 7.1): quem só pede senhas, sem entrar, deixa de receber. Quem lê o chat é só quem a lista da reunião mostra, ou quem vai aparecer nela em segundos.
- **O servidor não guarda mensagem nenhuma,** nem na memória depois de repassar, nem no banco, nem nos registros.
- **O sinalizador não manda nada** a servidor nenhum.
- **O limite por participante** segura quem tenta encher o chat, com um canal ou com vários. Quem insiste é tirado por um colega, como hoje.

## 10. Erros e testes

**Os erros que a pessoa vê:**

| O que houve | O que a página mostra |
|---|---|
| Mais de 20 mensagens num minuto | "Não enviada: muitas mensagens seguidas. Espere um pouco.", com o `Tentar de novo` |
| A resposta não chegou em 10 s | "Não enviada", com o `Tentar de novo` |
| O canal com o chat caiu | o campo desligado, com "O chat volta quando a conexão voltar." |

O campo de escrever não deixa passar de 1.000 caracteres: o `grande` do protocolo é para um cliente que não seja a página.

**Testes automáticos:**

- **O servidor:** quem recebe e quem não recebe (quem saiu, quem foi tirado, quem está na espera, outra reunião); quem acabou de ser aceita e ainda está entrando, que manda e recebe; o `id` e o `voce` só para quem escreveu; o nome do colega e o de quem é de fora; os quatro motivos da recusa; a janela do limite à parte das outras; o limite do participante, que o canal novo de um voltar não zera; quem só pede senhas, sem entrar, que deixa de receber o chat e o palco na quarta; nada do texto nos registros.
- **O cérebro da página:** a lista, as não lidas, o painel aberto e fechado, a lista que esvazia ao sair, a que fica quando a conexão cai e volta, a mensagem que não foi.
- **A tela da página:** o painel no PC e os quadros no espaço que sobra; o celular; o número e o aviso; o texto com sinais de HTML; o link, também com sinais de direção na mensagem; o foco e o Esc; o Voltar do aparelho, que fecha o chat que cobre a tela; o leitor de tela, também para a mensagem que não foi e para o chat sem o canal.
- **O sinalizador:** a função pura, com a tabela da seção 7.4, as regras de piorar e melhorar, a medida sem número e a medida com um número só; o critério 6 inteiro, com medidas falsas (a perda de 10% vira "ruim" em até 10 s, e a rede boa de novo vira "boa" em até 20 s); a aba escondida e a pausa; o relatório de antes de a página mandar, e o que não traz pacotes perdidos novos; o menor das duas últimas amostras do atraso; e a tela, com medidas falsas.
- **De ponta a ponta:** três pessoas, com o chat, o FreeSWITCH e o agente de verdade: a mensagem chega aos outros; quem saiu não recebe; o sinalizador sai do "Medindo" para "Conexão boa"; ele continua em "Conexão boa" por 20 s com todos sem câmera e sem microfone; e quem entra sem câmera e a liga 3, 4,5 ou 6 s depois não vê "Conexão instável" nem "Conexão ruim".

**Teste manual:** uma seção nova no `docs/teste-manual.md` (a 29), no PC e no celular, com o Chrome e o Firefox no PC, o Safari do iPhone e o Chrome do Android. Para o sinalizador, o roteiro confere o "Conexão boa" e os dois números no uso normal, e pede um celular que se afasta do Wi-Fi até a imagem falhar. O limitador de rede das ferramentas do navegador não serve: ele não mexe na imagem nem no som da reunião. Por isso a perda de 10% do critério 6 é provada nos testes automáticos, com medidas falsas.

## 11. Entrega e etapas

É uma versão nova do chat (a página vem dele). O servidor de vídeo não muda. O número da versão sai no plano, pela ordem das entregas: a ordem proposta ao responsável em 19/11 é a correção do FreeSWITCH, depois o estado dos ramais, depois esta. Ficou sendo a `0.2.0-rc.6` do chat.

A ordem das partes, para o plano:

1. o protocolo e o repasse no servidor;
2. o cérebro da página;
3. o painel no PC e no celular;
4. o número, o aviso e o leitor de tela;
5. a função do sinalizador;
6. a tela do sinalizador;
7. o teste de ponta a ponta;
8. os guias e o roteiro.

## 12. Riscos

1. **Um link malicioso** mandado por alguém da reunião. O endereço fica inteiro à vista, e quem é de fora só entra aceito por um colega. A alternativa é não criar link nenhum, e a pessoa copiar o endereço à mão.
2. **A mensagem perdida** para quem estava reconectando. A página não tem como saber que perdeu uma. O aviso do painel diz que as mensagens somem, mas não cobre este caso.
3. **Os números do navegador** mudam de um navegador para outro, e só o Chromium foi conferido (seção 7.4). No Safari do iPhone, o atraso pode não vir. O sinalizador então decide só pela perda e pelo "nada chegou", e o teste manual confere os três navegadores.
4. **Os limites do sinalizador** (2% e 8% de perda, 250 e 500 ms de atraso) são um ponto de partida. Eles ficam num lugar só do código, para ajustar depois do uso.
5. **O painel no PC encolhe os quadros.** Com 10 pessoas e o chat aberto numa janela pequena, os quadros ficam pequenos. O clique que aumenta uma pessoa continua valendo.

## 13. O que muda nas outras specs

- A spec de 12/11, seção 5: "O chat dentro da reunião" sai da lista do que fica de fora, para a página. Para o app, continua fora até a etapa 2.
- A spec de 18/11: a lista dos controles ganha o `Chat`, e o alto da tela ganha o sinalizador.

## 14. As escolhas que o responsável não fez

Ele pediu "o chat na reunião" e o "sinalizador de qualidade", na reunião do navegador. O resto é escolha deste desenho:

1. **As mensagens somem quando a reunião acaba,** e quem entra depois não vê as de antes. A outra opção era guardar a conversa.
2. **Todos escrevem,** também quem é de fora.
3. **Só texto,** com até 1.000 caracteres.
4. **Os endereços viram links.** No chat do app eles ficam como texto. Aqui o chat da reunião serve, antes de tudo, para passar links.
5. **O chat ao lado no PC e cobrindo a tela no celular.**
6. **O sinalizador mostra só a conexão da própria pessoa,** com três estados e os dois números no cartão.
7. **Os limites da conta** do sinalizador (seção 7.4).
8. **O chat da reunião no app fica para a etapa 2.**

Um revisor que não participou deste desenho o leu como quem vai construir, e fez seis perguntas. Nenhuma precisou do responsável: duas foram respondidas medindo o navegador contra o FreeSWITCH de verdade (seção 7.4), duas pelo que já existe (os textos do quadro, que entraram na seção 4.4, e o que a página já faz quando a conexão cai), e duas por escolha deste desenho. As escolhas que saíram dali:

9. **A imagem parada saiu da conta do sinalizador,** e entrou o "nada chegou". Uma imagem que para com o som chegando é, quase sempre, problema do servidor, e não da internet de quem vê.
10. **Quem pode mandar é quem recebe** (seção 7.1), com uma regra só.
11. **O estado mostrado melhora direto para o que as cinco últimas medidas dizem,** sem passar um tempo em "instável" no caminho de "ruim" para "boa".

**As escolhas do plano.** O plano (`docs/superpowers/plans/2026-11-19-reunioes-chat-e-qualidade.md`) decidiu o que esta spec não dizia:

12. **A mensagem que ainda está indo** já aparece na lista, com a hora, mais apagada.
13. **O `Tentar de novo`** manda o texto como uma mensagem nova: ela vai para o fim da lista, com a hora de agora.
14. **A resposta que chega depois dos 10 s** ainda confirma a mensagem "Não enviada". Se a pessoa já clicou em `Tentar de novo`, a resposta atrasada vira outra mensagem dela na lista: foi o que os outros viram.
15. **A lista acompanha o fim** quando está a até 80 pontos dele, quando a pessoa manda uma mensagem e quando o painel abre. Quem está lendo as mensagens antigas não é puxado para o fim.
16. **O painel ao lado é do PC:** a janela de 900 pontos ou mais, com mouse. Numa tela de toque ele cobre a tela, também deitada e no tablet: o teclado da tela tomaria o campo do painel ao lado.
17. **Na tela de toque, abrir o chat leva o foco ao título do painel,** e não ao campo, como a seção 4.2 dizia: o teclado só sobe quando a pessoa toca no campo. No PC, o foco vai ao campo.
18. **O Enter pula linha onde o ponteiro é o dedo,** e manda nos outros. Depois do botão de mandar, o foco volta ao campo, para o teclado do celular não descer.
19. **O campo cresce** com o texto até 120 pontos de altura, e depois rola. Ele não deixa passar de 1.000.
20. **No link, a pontuação do fim fica de fora:** `. , ; : ! ?`, as aspas e os fechamentos `) ] }` que não fecham um par aberto dentro do endereço.
21. **O aviso curto sobe para cima do Você** quando a área tem até 760 pontos de largura (o celular, a janela estreita, e a janela média com o chat aberto): ali, no meio, ele cobriria o Você.
22. **O leitor de tela ouve toda mensagem dos outros,** com o chat aberto ou fechado.
23. **A mensagem com o `id` que não vale** recebe o erro de sempre do protocolo: não há de qual mensagem dizer. A página nunca manda uma assim.
24. **"O chat volta quando a conexão voltar."** é uma linha acima do campo, com o campo, o botão de mandar e os `Tentar de novo` desligados.
25. **O campo mostra "Escreva uma mensagem"** (o texto do quadro). O nome dele, para o leitor de tela, é "Mensagem para todos da reunião" (o da seção 4.4).
26. **As mensagens que chegam com a página ainda entrando** ficam guardadas e aparecem com a reunião, contando como não lidas.
27. **O sinalizador sai do "Medindo"** na segunda medida com número: ele mostra a menos ruim das duas.
28. **Com o cartão do sinalizador aberto, o aviso de conexão ruim não aparece,** e não gasta o um-a-cada-2-minutos: a pessoa já está olhando os detalhes.
29. **O "nome do colega" da lista de testes** (seção 10) não tem como ser exercitado nesta versão: só a página manda, e quem manda pela página é sempre quem é de fora. Os testes cobrem o nome de quem é de fora, e que os apps dos colegas não recebem nada.
30. **Na tela de toque, o botão do sinalizador tem 44 pontos de altura,** e no celular deitado o alto da reunião perde o espaço de cima e de baixo, para a área dos quadros não encolher.

**O que a construção decidiu e achou,** em 19/11:

31. **A perda do que sai só conta para o que a página manda** (seção 7.4). O FreeSWITCH manda relatórios também do vídeo de quem está sem câmera, e o primeiro deles diz uma perda quase total. Sem essa regra, quem entrava sem câmera via "Conexão ruim" por uns 10 s. O teste de ponta a ponta achou o defeito antes de a versão sair.
32. **A página limpa o texto antes de mandar:** a tabulação vira espaço, e os outros sinais de controle saem. O servidor recusa esses sinais, e a tabulação vem em todo texto colado de uma planilha.
33. **A fila do servidor para cada página** passou de 32 para 256 mensagens: uma rajada dentro dos limites (10 páginas com 20 mensagens por minuto cada) não derruba o canal de ninguém.
34. **No celular, com o chat aberto,** o cartão "A conexão caiu. Entrando de novo…" e o aviso "Sua conexão está ruim" ficam atrás do chat, que cobre a tela. O leitor de tela diz os dois. Fica assim nesta versão.
35. **O aviso de conexão ruim sai antes dos 5 s** quando o sinalizador deixa de dizer "ruim". O um-a-cada-2-minutos vale também para quem sai e entra de novo. E o primeiro estado depois do "Medindo", se for "ruim", também avisa.
36. **A lista das mensagens é uma parada do teclado,** com o nome "Mensagens" para o leitor de tela: quem só usa o teclado consegue rolar a lista.
37. **O texto que a pessoa escrevia e não mandou some** quando ela sai da reunião.
38. **O cartão do sinalizador** abre embaixo do botão e não toma o foco. O Esc e o clique fora o fecham.

**O que a revisão final mudou,** em 19/11. Um revisor de fora, que não participou do desenho nem da construção, leu o desenho, o plano e todo o código no fim. Ele não achou nada grave, e pediu correções. As que entraram, cada uma com um teste que falhava antes dela e passa depois:

39. **O relatório do servidor de vídeo só conta depois de a página começar a mandar, e só com pacotes perdidos novos** (seção 7.4). Quem entrava sem câmera e a ligava logo depois via "Conexão ruim" por alguns segundos. O custo: a perda do que sai começa a contar um relatório mais tarde em cada fluxo (no segundo, e não no primeiro): no vídeo, uns 8 s depois de a ligação começar, ou de uma pausa. A perda do que chega conta desde o começo.
40. **O atraso que conta é o menor das duas últimas amostras** (seção 7.4). Uma resposta lenta sozinha não é uma conexão ruim. O custo: só pelo atraso, o "Conexão ruim" leva de 5 a 9 s, e não 4; e o atraso do cartão mostra um salto de verdade uma amostra depois.
41. **Uma leitura que chega mais de 6 s depois da anterior é só a base** (seção 7.4, a pausa). O celular que volta de outro app não vê um "Conexão ruim" que não existe.
42. **O Voltar do aparelho fecha o chat que cobre a tela** (seções 4.2 e 7.3). Antes, ele saía da página, que é sair da reunião. Uma sobra conhecida: recarregar a página com o chat aberto (ou avançar depois de voltar) deixa a entrada do chat no histórico, e o primeiro Voltar depois disso não faz nada. O seguinte sai da página, como sempre.
43. **Entrando tem fim:** as 3 primeiras senhas da câmera seguidas sem entrar (seção 7.1), para o chat e para o palco. O custo: quem tentou voltar três vezes sem conseguir e entra pelo `Entrar de novo` recebe os quadros com os nomes logo depois de entrar, e não antes da imagem; e não recebe as mensagens mandadas enquanto a ligação dele sobe.
44. **O limite das 20 mensagens por minuto é de cada pessoa,** e não só do canal dela (seção 7.1).
45. **O leitor de tela ouve a mensagem da própria pessoa que não foi,** e o chat sem o canal (seção 4.2).
46. **Um sinal de direção do texto acaba o endereço do link,** e o link é escrito da esquerda para a direita (seção 4.2).
47. **O que a revisão apontou e ficou como está nesta versão,** para o responsável decidir:
    - no celular, com o chat aberto, o painel continua dizendo "Você continua na reunião" enquanto a página tenta voltar de uma queda (até uns 45 s), com o cartão da queda atrás dele (o item 34);
    - o aviso "Sua conexão está ruim" que aparece atrás do chat aberto, no celular, gasta o um-a-cada-2-minutos sem a pessoa o ver;
    - "O chat volta quando a conexão voltar." aparece também quando o chat não vai voltar sozinho (a página desistiu de ligar o canal de novo, ou o chat reiniciou): esse caso pede uma frase própria, que é do responsável escolher;
    - o aviso curto, depois de sumir, continua guardando na página o nome e o texto da última mensagem, sem mostrar, também depois de a reunião acabar (até outro aviso tomar o lugar, ou a página fechar). Ninguém vê, mas o critério 5 diz que as mensagens somem da página;
    - o Esc que cancela uma escrita com teclado de composição (o japonês, o chinês, o coreano) no campo do chat também devolve à grade um quadro aumentado;
    - colar mais de 1.000 caracteres corta o texto sem avisar, e uma mensagem só com sinais invisíveis é aceita e aparece vazia;
    - a perda de 10% do critério 6 continua provada com números de mentira nos testes automáticos, e com uma rede ruim de verdade só no roteiro (a linha 29.12).
