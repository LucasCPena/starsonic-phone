# Starsonic Phone — reuniões com link — o chat da reunião e o sinalizador de qualidade — especificação de design

- **Data:** 19/11/2026
- **Status:** para o responsável aprovar. O pedido é de 18/11, às 17:48: "colocar o chat na reunião também e sinalizador de qualidade de chamada". Em 18/11, às 17:53, ele disse que o sinalizador é o da reunião no navegador. Em 19/11, às 00:24, ele mandou fazer os dois sem responder às outras perguntas: as escolhas da seção 14 são deste desenho, para ele corrigir.
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
- **Os endereços:** um trecho que começa com `http://` ou `https://` vira um link, com o endereço inteiro à vista, que abre em outra aba. O resto do texto é sempre texto.
- **Escrever:** o Enter manda, e o Shift+Enter pula linha, como no chat do app. No celular, o Enter pula linha, e o botão manda.
- **A mensagem que não foi:** fica marcada "Não enviada", com o motivo em poucas palavras e o `Tentar de novo`.
- **Com o chat fechado:** o botão `Chat` mostra quantas mensagens novas há (até 9, depois "9+"), e um aviso curto aparece por 5 s com o nome e o começo da última. Um leitor de tela ouve "<nome> escreveu: <texto>".
- **O aviso curto** fica logo acima dos controles, no meio, e não cobre o Você. Só um aparece por vez: um aviso novo toma o lugar do anterior. O aviso de conexão ruim (seção 4.3) usa o mesmo lugar e o mesmo tempo.
- **No PC,** com a janela a partir de 900 pontos de largura, o chat é um painel ao lado, e os quadros se arrumam no resto. Em janelas mais estreitas e no celular, o chat cobre a área da reunião.
- **O teclado:** abrir o chat leva o foco ao campo de escrever. O Esc fecha o chat quando o foco está nele, e devolve o foco ao botão `Chat`.
- **Sem o canal com o chat** (ele caiu e a página está ligando de novo, ou ela desistiu de ligar e a reunião segue só com a imagem e o som), o campo fica desligado, com "O chat volta quando a conexão voltar.". As mensagens que a pessoa já tinha continuam à vista.

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
- **Quem pode mandar** é quem recebe: a mesma regra, sem outra. Assim, a página que acabou de ser aceita não tem a primeira mensagem recusada por ter mandado um segundo cedo demais. Antes de ser aceita e depois de sair, a resposta é `foraDaReuniao`.
- **O nome** que vai na mensagem é o do palco para aquele participante.
- **O limite** é de 20 mensagens por minuto por canal, numa janela só do chat, como a do `camera`: as mensagens do chat não gastam as 20 das outras, e as outras não gastam as do chat.

### 7.2 O servidor do chat

- O pacote das reuniões (`internal/reunioes`) ganha o repasse: confere quem manda, o texto e o limite, e põe a mensagem na fila de cada página que recebe o palco, na mesma seção que já protege a sala.
- Nenhum campo novo na sala guarda mensagens. Depois de repassar, o servidor não tem mais o texto.
- Os registros não levam o texto, o nome nem o `id`.

### 7.3 A página

- **O cérebro** (`estado.js`) ganha a lista das mensagens da reunião, a conta das não lidas e o estado do painel. Ela esvazia a lista quando a página sai da tela da reunião, por qualquer fim (a pessoa saiu, foi tirada, a reunião acabou, ou a página desistiu de voltar), e não mexe nela enquanto a página tenta voltar ou ligar o canal de novo. Continua uma função pura, com os testes dela.
- **A tela** (`pagina.js`, `pagina.html`, `pagina.css`) ganha o painel, o botão, o número, o aviso e o sinalizador. Os quadros não mudam: eles já se arrumam pela medida da área, e a área encolhe quando o painel abre.
- **O texto de cada mensagem** é escrito como texto, nunca como HTML. Os links são criados um a um, só para trechos que começam com `http://` ou `https://`, com `target="_blank"` e `rel="noopener noreferrer"`.
- **O sinalizador** é uma peça nova (`qualidade.js`), em duas partes: uma função pura, que recebe as últimas medidas e devolve o estado, e a parte que pede os números ao navegador a cada 2 s, na ligação principal da reunião. Ela para de medir com a aba escondida.

### 7.4 A conta do sinalizador

A cada 2 s, a página pede os números ao navegador (o `getStats` da ligação principal) e os compara com os da medida anterior:

- **A perda do que chega:** os pacotes perdidos sobre os esperados, desde a medida anterior, no som e no vídeo (o `inbound-rtp`). Vale a maior das duas.
- **A perda do que sai:** a que o servidor de vídeo informa de volta, no som e no vídeo (o `fractionLost` do `remote-inbound-rtp`). Um relatório com mais de 10 s não conta: com a câmera desligada, o do vídeo para de chegar.
- **A perda** da medida é a maior entre a do que chega e a do que sai.
- **O atraso:** o tempo de ida e volta até o servidor de vídeo (o `currentRoundTripTime` do par de endereços em uso; sem ele, o `roundTripTime` do `remote-inbound-rtp` do som).
- **Nada chegou:** nenhum pacote de som e nenhuma imagem nova desde a medida anterior.

Esses números foram conferidos em 19/11, no Chromium, contra o FreeSWITCH de verdade:

- O servidor de vídeo manda os relatórios de volta: há `remote-inbound-rtp` para o som e para o vídeo, com a perda e o atraso. E o par de endereços em uso dá o atraso.
- O mosaico e o som chegam sempre, a 25 imagens e 50 pacotes de som por segundo. Foi assim com duas pessoas com câmera, com uma pessoa sozinha sem câmera e sem microfone, e com duas pessoas sem câmera e sem microfone. Por isso o "nada chegou" não acontece numa reunião parada ou vazia.

O estado de cada medida:

| Estado | Quando |
|---|---|
| Ruim | perda de 8% ou mais, ou atraso de 500 ms ou mais, ou nada chegou |
| Instável | perda de 2% ou mais, ou atraso de 250 ms ou mais |
| Boa | o resto |
| Sem número | o navegador não deu a perda nem o atraso, e alguma coisa chegou |

Com um número só (a perda sem o atraso, ou o contrário), a medida é decidida por ele.

O estado mostrado não acompanha cada medida, para não piscar:

- **Piora** quando as 2 últimas medidas são piores que o estado mostrado (4 s). Ele passa para a menos ruim das duas.
- **Melhora** quando as 5 últimas medidas são melhores que o estado mostrado (10 s). Ele passa para a pior das cinco. De "ruim", cinco medidas boas levam direto a "boa".
- **É "Medindo a conexão…"** nas 2 primeiras medidas da ligação, depois de 2 medidas seguidas sem número, e enquanto a conexão está caída.
- Uma medida sem número não conta para piorar nem para melhorar.

**A imagem que para com o som chegando não entra na conta.** Quando só a imagem para, e a perda e o atraso estão bons, o mais provável é que a causa esteja no servidor, e não na internet de quem vê. Dizer "sua conexão está ruim" seria culpar a pessoa errada. Quando a imagem para por causa da rede, a perda aparece nos números.

**A aba escondida:** a página para de medir. Quando a aba volta, a primeira medida serve só de base para a seguinte, e o estado mostrado fica como estava.

Um número que o navegador não dá não conta contra a pessoa.

## 8. Os valores

| O quê | Valor |
|---|---|
| O tamanho de uma mensagem | de 1 a 1.000 caracteres |
| O limite de mensagens | 20 por minuto por canal, à parte dos outros |
| As mensagens que a página guarda | as últimas 500 da reunião |
| O número no botão | até 9, depois "9+" |
| A largura do painel no PC | 360 pontos, com a janela a partir de 900 |
| A medida do sinalizador | a cada 2 s |
| O relatório do servidor de vídeo que ainda vale para a perda do que sai | o dos últimos 10 s |
| O aviso curto (da mensagem nova e da conexão ruim) | 5 s, um por vez |
| O aviso de conexão ruim | no máximo 1 a cada 2 minutos |

## 9. Segurança e privacidade

- **O texto nunca vira HTML.** A regra de segurança da página (CSP) continua a mesma, sem script nem estilo dentro da página.
- **Os links** só nascem de `http://` e `https://`, mostram o endereço inteiro e abrem em outra aba, sem dar à outra página acesso a esta.
- **Só quem foi aceito e está na reunião, ou entrando nela, manda e recebe.** Quem saiu ou foi tirado não recebe mais nada, como no palco.
- **O servidor não guarda mensagem nenhuma,** nem na memória depois de repassar, nem no banco, nem nos registros.
- **O sinalizador não manda nada** a servidor nenhum.
- **O limite por canal** segura quem tenta encher o chat. Quem insiste é tirado por um colega, como hoje.

## 10. Erros e testes

**Os erros que a pessoa vê:**

| O que houve | O que a página mostra |
|---|---|
| Mais de 20 mensagens num minuto | "Não enviada: muitas mensagens seguidas. Espere um pouco.", com o `Tentar de novo` |
| A resposta não chegou em 10 s | "Não enviada", com o `Tentar de novo` |
| O canal com o chat caiu | o campo desligado, com "O chat volta quando a conexão voltar." |

O campo de escrever não deixa passar de 1.000 caracteres: o `grande` do protocolo é para um cliente que não seja a página.

**Testes automáticos:**

- **O servidor:** quem recebe e quem não recebe (quem saiu, quem foi tirado, quem está na espera, outra reunião); quem acabou de ser aceita e ainda está entrando, que manda e recebe; o `id` e o `voce` só para quem escreveu; o nome do colega e o de quem é de fora; os quatro motivos da recusa; a janela do limite à parte das outras; nada do texto nos registros.
- **O cérebro da página:** a lista, as não lidas, o painel aberto e fechado, a lista que esvazia ao sair, a que fica quando a conexão cai e volta, a mensagem que não foi.
- **A tela da página:** o painel no PC e os quadros no espaço que sobra; o celular; o número e o aviso; o texto com sinais de HTML; o link; o foco e o Esc; o leitor de tela.
- **O sinalizador:** a função pura, com a tabela da seção 7.4, as regras de piorar e melhorar, a medida sem número e a medida com um número só; o critério 6 inteiro, com medidas falsas (a perda de 10% vira "ruim" em até 10 s, e a rede boa de novo vira "boa" em até 20 s); a aba escondida; e a tela, com medidas falsas.
- **De ponta a ponta:** três pessoas, com o chat, o FreeSWITCH e o agente de verdade: a mensagem chega aos outros; quem saiu não recebe; o sinalizador sai do "Medindo" para "Conexão boa"; e ele continua em "Conexão boa" por 20 s com todos sem câmera e sem microfone.

**Teste manual:** uma seção nova no `docs/teste-manual.md`, no PC e no celular, com o Chrome, o Firefox e o Safari do iPhone. Para o sinalizador, o roteiro confere o "Conexão boa" e os dois números no uso normal, e pede um celular que se afasta do Wi-Fi até a imagem falhar. O limitador de rede das ferramentas do navegador não serve: ele não mexe na imagem nem no som da reunião. Por isso a perda de 10% do critério 6 é provada nos testes automáticos, com medidas falsas.

## 11. Entrega e etapas

É uma versão nova do chat (a página vem dele). O servidor de vídeo não muda. O número da versão sai no plano, pela ordem das entregas: a ordem proposta ao responsável em 19/11 é a correção do FreeSWITCH, depois o estado dos ramais, depois esta.

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
