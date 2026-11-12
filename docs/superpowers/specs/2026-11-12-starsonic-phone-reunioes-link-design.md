# Starsonic Phone — reuniões com link — especificação de design

- **Data:** 12/11/2026
- **Status:** o desenho foi aprovado pelo responsável no chat, em 12/11/2026, em cinco partes:
  1. as peças;
  2. como montar cada servidor;
  3. os caminhos de cada pessoa;
  4. a segurança e a privacidade;
  5. as etapas, os testes e o que fica de fora.

  As telas de verdade (a página do navegador e as do app) vão para quadros que o responsável aprova antes do código das telas (seção 12). Esta spec escrita foi aprovada pelo responsável em 12/11/2026, às 14:14.
- **Versões alvo:**
  - o servidor do chat 0.2.0;
  - o servidor de vídeo 0.1.0 (novo);
  - o app do Windows 0.5.0 (a 0.4.0 é a da sala de vídeo no PC).
- **Base:**
  - o servidor do chat 0.1.0 (`chat-servidor/`, com o `docs/chat-protocolo.md` e o `docs/chat-servidor.md`): as empresas, as pessoas, os computadores ligados ao chat e o canal de eventos;
  - a sala de vídeo no PC (spec `docs/superpowers/specs/2026-11-11-starsonic-phone-video-grupo-design.md`), que continua para as chamadas rápidas de até 6 pessoas;
  - o motor com o vídeo da PJSIP (`starsonic/phone`) e o núcleo (`starsonic/desktop`).

> **Decisões do responsável** (12/11/2026):
> 1. O link serve para os dois públicos: os colegas entram pelo app do PC, e as pessoas de fora pelo navegador.
> 2. O link nasce de dois jeitos: no meio de uma chamada, ou antes, para uma reunião marcada.
> 3. Os colegas entram direto. Quem é de fora digita o nome e espera ser aceito.
> 4. As reuniões com link ficam num servidor de vídeo novo, com o FreeSWITCH, e o servidor do chat cuida delas. A sala de vídeo no PC, de até 6 pessoas, continua.
> 5. Até 10 pessoas por reunião.
> 6. A primeira versão tem vídeo, som e tela compartilhada, sem gravação.
> 7. Quando o link nasce no meio de uma chamada, todos que estão nela vão para a reunião, sem desligar.
> 8. O cadastro do chat diz quem é colega.
> 9. No celular, todos entram pelo navegador. O app do celular fica para depois.
> 10. Os telefones da central dependem de um tronco SIP, que o responsável vai verificar. Sem o tronco, o PC de quem gerou o link faz a ponte.
> 11. Qualquer colega da empresa que esteja na reunião pode aceitar quem pede para entrar, tirar alguém e encerrar a reunião para todos.
> 12. A ordem: primeiro as telas da sala de vídeo (a 0.4.0); depois, as reuniões.

## 1. Contexto

- A sala de vídeo da 0.4.0 é montada no PC de quem a criou: o PC liga para cada pessoa pela central, junta as imagens e mistura o som. Ela vai até 6 pessoas, porque o PC monta a imagem de cada convidado, e depende do PC e da internet de quem montou.
- O pedido do responsável: gerar um link para a chamada em grupo, para colegas e pessoas de fora entrarem, também numa reunião marcada.
- Uma pessoa de fora, num navegador, não tem um aparelho SIP nem passa pela central. Para ela entrar, é preciso uma página, uma conexão do navegador (o WebRTC) e um servidor alcançável pela internet.
- Um servidor que junta as imagens (um MCU) resolve as duas coisas: recebe o navegador e o app, monta um mosaico único e passa de 6 pessoas.
- O FreeSWITCH é um servidor de voz e vídeo de código aberto, muito usado, que faz o MCU (`mod_conference`), fala SIP com o app e com as centrais e fala WebRTC com o navegador. Num teste público, uma reunião de 10 pessoas em 720p a 15 imagens por segundo usou pouco mais de 2 dos 8 núcleos de um processador de 4 GHz.
- O servidor do chat já sabe quais empresas, pessoas e computadores existem, e já tem um canal de eventos com o app. Ele é o lugar natural das regras das reuniões.

## 2. Objetivos

- Uma reunião de até 10 pessoas, com vídeo, som e tela compartilhada, aberta por um link.
- Colegas entram pelo app do PC, e qualquer pessoa entra pelo navegador do PC ou do celular, sem instalar nada.
- Nada muda numa ligação comum, na videochamada de duas pessoas nem na sala de vídeo no PC.

## 3. Critérios de sucesso

1. Uma reunião marcada gera um link que abre no navegador do PC e no do celular. A pessoa de fora entra depois de aceita, com vídeo e som nos dois sentidos.
2. Um colega, num PC com o app ligado ao chat, entra direto pelo link.
3. O "Gerar link" no meio de uma chamada leva todos para a reunião sem desligar: o colega com o app, e um telefone da central pela ponte do PC.
4. Dez pessoas numa reunião veem o mesmo mosaico, com o nome de cada uma, em 720p a 15 imagens por segundo, numa VM de 6 vCPU, com folga.
5. A tela compartilhada aparece no quadro grande para todos.
6. Sem a senha de uso único do chat, ninguém entra no servidor de vídeo. Um link cancelado ou vencido não abre a reunião.
7. Nada é gravado. O diagnóstico do app e os registros dos servidores não têm nomes, números nem códigos de link.

## 4. O que a versão entrega

### 4.1 Telas (quadros novos, aprovados antes do código)
- **A página do navegador** (o quadro "Starsonic — reunião no navegador"):
  - a entrada: o nome (para quem é de fora), a imagem da câmera para conferir, os botões do microfone e da câmera, e o "Pedir para entrar";
  - para um colega no PC, o "Abrir no app", com o "Entrar pelo navegador" ao lado;
  - a espera: "Aguardando ser aceito…" e o "Desistir";
  - a reunião: o mosaico, e os botões Microfone, Câmera, Compartilhar a tela (só no navegador do PC) e Sair;
  - os avisos da seção 10.
- **No app do PC** (o quadro "Starsonic Phone — reuniões"):
  - o item "Reuniões": a lista das próximas reuniões, cada uma com "Copiar link", "Abrir" e "Cancelar", e o botão "Nova reunião" (o assunto, o dia e a hora, e até quando o link vale);
  - na tela de uma chamada, o "Gerar link";
  - a reunião, na tela da ligação: o mosaico, os botões Mudo, Câmera, Compartilhar a tela, Participantes e Sair;
  - o painel Participantes: a lista, com o "Tirar"; quem espera, com "Aceitar" e "Recusar"; e o "Encerrar para todos";
  - o aviso "<Nome> quer entrar", com "Aceitar" e "Recusar", também com o app em segundo plano.

### 4.2 Comportamento
- **A reunião marcada:**
  - quem cria escolhe o assunto (opcional), o dia e a hora, e até quando o link vale (o padrão é o fim do dia marcado);
  - a reunião começa quando um colega da empresa a abre no app. Antes disso, quem chega vê "A reunião ainda não começou" e espera;
  - quando todos saem, ela para. O link continua valendo até a data dele, e a reunião recomeça quando um colega a abrir de novo;
  - quem criou pode cancelar: o link para de valer na hora, e quem estiver na reunião sai.
- **O link no meio de uma chamada:**
  - o "Gerar link" cria a reunião na hora, copia o link e leva todos para ela:
    - o seu app entra na reunião;
    - o app de um colega com o Starsonic recebe o aviso pelo chat, entra sozinho na reunião e larga a chamada antiga;
    - um telefone da central (um aparelho sem o Starsonic) fica com o seu PC, que faz a ponte entre ele e a reunião (seção 6.5). Com o tronco da etapa 3, o app transfere a ligação para o número da reunião, e o PC sai do meio;
  - se a chamada era a sala de vídeo no PC, a sala acaba quando todos foram para a reunião;
  - esse link vale até a reunião acabar.
- **Entrar pelo link:**
  - um colega no PC com o app ligado ao chat: a página oferece o "Abrir no app"; o app entra direto;
  - uma pessoa de fora, ou qualquer pessoa no celular: a página pede o nome, mostra a câmera e o microfone, e a pessoa toca em "Pedir para entrar". Ela espera até ser aceita ou recusada. Recusada, vê "Não foi possível entrar";
  - quem aceita: qualquer colega da empresa que esteja na reunião. O pedido aparece para todos eles, e o primeiro que responde decide.
- **Na reunião:**
  - todos veem o mesmo mosaico, montado pelo servidor, com até 10 pessoas e o nome de cada uma no quadro dela. Cada um vê a si mesmo no mosaico, como os outros o veem;
  - quem compartilha a tela ganha o quadro grande, e as pessoas vão para os quadros pequenos. Uma tela por vez: uma nova tela toma o lugar da anterior;
  - os colegas da empresa têm a lista de participantes, com o "Tirar", e o "Encerrar para todos".
- **Sair e acabar:** quem sai, sai sozinho. A reunião acaba quando o último sai, ou quando um colega usa o "Encerrar para todos".
- **Os limites:** com 10 pessoas, quem chega vê "A reunião está cheia". Com o servidor de vídeo no limite de reuniões ao mesmo tempo (seção 7), quem abre uma reunião parada vê "O servidor de reuniões está cheio agora".
- **A sala de vídeo no PC continua igual:** até 6 pessoas, montada no PC, sem link.

### 4.3 A área do administrador
- **No servidor do chat,** o cartão novo "Reuniões" da administração:
  - o endereço do servidor de vídeo e a chave que o instalador dele mostra, com uma chamada de teste;
  - o número de reuniões ao mesmo tempo (o padrão é 2, para a VM de 6 vCPU);
  - liberar as reuniões em cada empresa, um botão por empresa;
  - quantas reuniões estão acontecendo e quanto do servidor de vídeo está em uso, sem quem está nelas;
  - a "reunião de teste": um link que entra numa reunião só de teste, pelo navegador, para conferir a instalação antes do app.
- **No app,** nada novo na área do administrador: as reuniões usam o chat já ligado.

## 5. Fora do escopo

- Gravar a reunião.
- O app do celular nas reuniões (no celular, só o navegador).
- Mais de 10 pessoas.
- O chat dentro da reunião.
- O fundo desfocado, as legendas e o levantar a mão.
- A ligação com a agenda do Outlook ou do Google.
- Mandar o link direto pelo chat ou por e-mail: na primeira versão, o link é copiado.
- Um mosaico diferente para cada pessoa (sem ela mesma), como na sala do PC: no servidor, o mosaico é um só.

## 6. Arquitetura

### 6.1 As partes
| Parte | Onde | O que faz |
|---|---|---|
| O servidor de vídeo | uma VM nova | o FreeSWITCH (o mosaico, o som, o SIP e o WebRTC), o TURN (o coturn) e o nosso agente de vídeo |
| O servidor do chat | a VM do chat | as reuniões: o link, as marcadas, a sala de espera, quem é colega, as senhas de uso único, a página |
| A página | servida pelo chat | a entrada, a espera e a reunião, no navegador |
| O app do PC | o Windows | criar, gerar o link, entrar, aceitar, tirar, encerrar, a tela, a ponte dos telefones |
| A central | a do cliente | só na etapa 3: o tronco para o servidor de vídeo |

O app e a página perguntam ao chat tudo que é "quem, quando e se pode". O vídeo e o som vão direto para o servidor de vídeo. Um servidor do chat e um servidor de vídeo atendem todas as empresas, cada uma separada.

### 6.2 O servidor de vídeo
- **O FreeSWITCH** numa versão fixa (a 1.11, a mais nova em 12/11/2026), montado pelo nosso GitHub a partir do código oficial e publicado como os outros pacotes. Os pacotes prontos da empresa que mantém o FreeSWITCH pedem uma conta e um token: o nosso build não depende deles.
- **A reunião** é uma conferência do `mod_conference` com o vídeo montado no servidor:
  - o quadro de 1280×720 a 15 imagens por segundo, com os layouts em grade de 1 a 10 pessoas e um layout de apresentação para a tela compartilhada;
  - o nome de cada pessoa no quadro dela;
  - o VP8 para o navegador e para o app, e o Opus para o som do navegador;
  - o limite de 10 pessoas por reunião, e o de reuniões ao mesmo tempo, que vem do chat.
- **O navegador** entra por SIP sobre WebSocket seguro (WSS), na 443, com o WebRTC (DTLS-SRTP).
- **O app** entra por SIP sobre TLS, na 5061, com o SRTP.
- **O agente de vídeo**, um programa nosso em Go na mesma VM, fica entre o FreeSWITCH e o chat:
  - responde ao FreeSWITCH, pela própria máquina, quem pode entrar em qual reunião, conferindo a senha de uso único com a chave compartilhada com o chat;
  - avisa o chat, por HTTPS, de quem entrou e de quem saiu;
  - recebe do chat, por HTTPS e com a chave, os pedidos de tirar alguém e de encerrar uma reunião.
- **O TURN** (o coturn) deixa entrar quem está numa rede fechada: pela UDP 3478 e, sobre TLS, pela 5349, com senhas que vencem sozinhas. A 443 é do WSS do navegador.
- **Nada fica guardado** no servidor de vídeo: nem gravação, nem cadastro.
- **O instalador** (como o `instalar.sh` do chat) instala tudo, pega o cadeado do Let's Encrypt, aplica a nossa configuração, liga os serviços e mostra a chave no fim.

### 6.3 O servidor do chat
- **As reuniões** são uma parte nova do servidor (o `chat-servidor/`), com o banco de hoje:
  - uma reunião pertence a uma empresa e guarda o assunto, o dia, quem criou, a validade e o código do link;
  - o código tem 10 letras de um alfabeto sem letras parecidas (cerca de 50 bits);
  - o link é `https://<endereço do chat>/r/<código>`.
- **A API** (ampliando o `docs/chat-protocolo.md`):
  - o app cria, lista e cancela as reuniões, e gera a reunião na hora do "Gerar link";
  - o app e a página abrem uma reunião pelo código. O colega abre com a credencial do chat dele; quem é de fora, só com o nome;
  - quem é aceito recebe a senha de uso único para o servidor de vídeo e as credenciais do TURN;
  - o pedido de quem quer entrar, a resposta e a lista de participantes passam pelo canal de eventos (o mesmo WebSocket do chat, no app; um WebSocket próprio, na página).
- **A senha de uso único** é assinada com a chave compartilhada com o servidor de vídeo e vale para uma reunião, uma pessoa, um papel (colega ou de fora) e 30 segundos. O agente de vídeo aceita cada uma só uma vez.
- **A limpeza:** a reunião é apagada 30 dias depois do fim da validade dela, e os nomes de quem veio de fora somem quando a reunião acaba.

### 6.4 A página
- É servida pelo chat, no endereço do link, sem nada para instalar.
- Funciona no Chrome, no Edge, no Firefox e no Safari, no PC e no celular.
- Fala SIP sobre WSS com o servidor de vídeo, por uma biblioteca de código aberto, e fala com o chat pelo WebSocket da página.
- Recebe um único vídeo, o mosaico, e manda a câmera e, no PC, a tela.

### 6.5 O app do PC
- **As reuniões** usam o chat que o técnico já ligou no computador.
- **Entrar numa reunião** é uma ligação SIP sobre TLS, direto para o servidor de vídeo, com a senha de uso único num cabeçalho, sem passar pela central.
- **O link abre o app** por um endereço próprio (`starsonic://`), registrado pelo instalador do app.
- **A ponte de um telefone da central** (o "Gerar link" sem o tronco):
  - o PC fica com a ligação do telefone e abre, para ele, uma segunda ligação com o servidor de vídeo;
  - o PC passa o som e a imagem do telefone para a reunião, e o mosaico da reunião para o telefone;
  - você precisa ficar na reunião enquanto o telefone estiver nela. Ao sair, o app avisa que o telefone também sai.
- **A tela compartilhada** é uma segunda ligação de vídeo com o servidor, só com a tela.

### 6.6 A central (etapa 3)
- Um tronco SIP do cliente para o servidor de vídeo, na 5061.
- Uma regra de discagem: um prefixo (por exemplo, 88) seguido do código da reunião vai para o tronco.
- O app transfere um telefone para o número da reunião pelo SIP (REFER), e um ramal pode ligar para a reunião pelo prefixo.

## 7. Os valores

| Valor | Quanto |
|---|---|
| Pessoas por reunião | até 10 |
| Reuniões ao mesmo tempo | 2 por padrão, ajustável na administração |
| O mosaico | 1280×720, 15 imagens por segundo, VP8 |
| A banda de cada pessoa | cerca de 1,5 Mbit/s para baixo e até 1 Mbit/s para cima |
| O código do link | 10 letras, sem letras parecidas |
| A senha de uso único | 30 segundos, uma vez só |
| As tentativas de abrir links | até 20 por minuto por endereço |
| A espera de quem é de fora | até 10 minutos, depois "Não foi possível entrar" |
| A validade padrão da reunião marcada | até o fim do dia marcado |
| A limpeza | 30 dias depois do fim da validade |
| A VM de vídeo | 6 vCPU, 8 GB de memória, 40 GB de SSD e 100 Mbit/s |
| As portas da VM de vídeo | TCP 80 e 443, TCP 5061, UDP 3478, TCP 5349 e duas faixas UDP de 300 portas (a mídia e o TURN) |

## 8. Fluxos

1. **Reunião marcada:** o colega cria no app → o chat guarda e devolve o link → o colega copia e manda → no dia, um colega abre no app → a reunião começa → quem é de fora abre o link, pede para entrar e espera → um colega aceita → o chat dá a senha de uso único → a página entra no servidor de vídeo.
2. **No meio de uma chamada:** o "Gerar link" → o chat cria a reunião → o app entra → o chat avisa o app do colega, que entra e larga a chamada → o PC faz a ponte do telefone da central → o link é copiado.
3. **O colega pelo link:** a página → o "Abrir no app" → o app abre a reunião com a credencial do chat → entra direto.
4. **A tela:** o "Compartilhar a tela" → o navegador (ou o app) pede a tela ou a janela → uma segunda ligação com o servidor → o layout de apresentação para todos → o "Parar de compartilhar" volta à grade.
5. **O fim:** o último sai, ou o "Encerrar para todos" → o chat pede ao agente que encerre → todos saem → a reunião para.

## 9. Segurança e privacidade

- **O link** tem um código aleatório de 10 letras. O chat limita as tentativas por endereço. O link vale até a data dele, ou até a reunião acabar, e quem criou pode cancelar.
- **Quem entra:** o colega pelo cadastro do chat. Quem é de fora não tem conta: só o nome, que aparece para quem aceita. Um colega de outra empresa passa pela sala de espera.
- **O servidor de vídeo só aceita a senha de uso único do chat**, que vale para uma reunião, uma pessoa e 30 segundos, uma vez só. Sem ela, ninguém liga para ele.
- **Tudo vai cifrado:** o WebRTC (DTLS-SRTP) no navegador, o TLS e o SRTP no app, o HTTPS entre o agente e o chat, e o TURN com senhas que vencem.
- **O que fica guardado:**
  - o servidor de vídeo não guarda nada e não grava nada;
  - o chat guarda o assunto, o dia, quem criou, a validade e o código, e apaga a reunião 30 dias depois do fim da validade;
  - os nomes de quem veio de fora somem quando a reunião acaba.
- **O diagnóstico e os registros** seguem a regra de hoje: sem nomes, sem números e sem o código do link, só contagens e códigos de erro.
- **A administração** mostra quantas reuniões estão acontecendo e o uso do servidor de vídeo, não quem está nelas.
- **A câmera, o microfone e a tela:** cada pessoa escolhe antes de entrar se chega com a câmera e o microfone ligados, e a tela compartilhada é só a tela ou a janela que ela escolher.

## 10. Interface e textos

- Na página: "Seu nome", "Pedir para entrar", "Aguardando ser aceito…", "Desistir", "Não foi possível entrar", "Abrir no app", "Entrar pelo navegador", "Microfone", "Câmera", "Compartilhar a tela", "Parar de compartilhar", "Sair".
- Os avisos: "A reunião ainda não começou", "A reunião está cheia", "O servidor de reuniões está cheio agora", "Este link não vale mais", "Sem acesso à câmera ou ao microfone: libere no navegador".
- No app: "Reuniões", "Nova reunião", "Gerar link", "Copiar link", "Link copiado", "Abrir", "Cancelar", "Participantes", "Tirar", "Aceitar", "Recusar", "<Nome> quer entrar", "Encerrar para todos", "O telefone sai da reunião junto com você".
- Os textos finais saem dos quadros aprovados.

## 11. Erros e testes

### 11.1 Erros
1. **O servidor de vídeo fora do ar:** o app e a página dizem "O servidor de reuniões não respondeu", e o chat continua funcionando.
2. **O navegador sem câmera ou sem microfone:** a pessoa entra só com o que tem, ou só para ver e ouvir.
3. **Uma rede que bloqueia o UDP:** o TURN sobre TLS, pela 5349. Uma rede que só deixa sair pela 443 não entra (seção 13).
4. **A senha de uso único vencida** (a pessoa demorou): a página pede outra ao chat sozinha, uma vez.
5. **O PC da ponte cai:** o telefone sai da reunião, e os outros continuam.
6. **O colega aceita e outro recusa ao mesmo tempo:** vale a primeira resposta que chega ao chat.

### 11.2 Testes automáticos (a cada mudança, no GitHub)
- **O chat:** os testes em Go das reuniões, com o `-race`, como hoje:
  - o código e a validade do link;
  - a sala de espera e o primeiro que responde;
  - as senhas de uso único;
  - os limites de tentativas e de reuniões;
  - a limpeza dos 30 dias;
  - uma empresa não vê nada de outra.
- **O agente de vídeo:** os testes em Go da conferência das senhas, do uso único e dos avisos ao chat.
- **De ponta a ponta:**
  - o FreeSWITCH do nosso build, com a nossa configuração, o agente e o chat rodam dentro do teste;
  - dois navegadores com câmera falsa (cores conhecidas) entram numa reunião de verdade;
  - o teste confere o mosaico com as duas cores, o som, a sala de espera, a tela compartilhada e o "Encerrar para todos".
- **O app (etapa 2):** o motor entra numa reunião do FreeSWITCH do teste por SIP sobre TLS; o núcleo e as telas com a ponte falsa, como hoje.

### 11.3 Teste manual
No fim de cada etapa, um roteiro para o responsável testar nas VMs de verdade: a instalação, uma reunião marcada com uma pessoa de fora no celular, o "Gerar link" no meio de uma chamada com um colega e com um telefone da central, a tela compartilhada e dez pessoas numa reunião.

## 12. Entrega e etapas

1. **Etapa 1, o servidor e a página** (o chat 0.2.0 e o servidor de vídeo 0.1.0):
   - as reuniões no chat, o cartão "Reuniões" e a reunião de teste;
   - o servidor de vídeo e o instalador;
   - a página, depois do quadro dela aprovado;
   - o guia de instalação, como o `docs/chat-servidor.md`.

   Com ela, o responsável já instala os dois servidores e entra pelo navegador na reunião de teste.
2. **Etapa 2, o app do PC** (0.5.0): as reuniões marcadas, o "Gerar link", entrar pelo link, aceitar, tirar, encerrar, a tela e a ponte dos telefones, depois do quadro das telas aprovado.
3. **Etapa 3, a central com tronco:** só depois de o responsável confirmar que as centrais dos clientes aceitam o tronco.

Cada etapa tem o seu plano, a sua branch e a sua revisão final. Quem publica as versões é o responsável, pelo GitHub.

## 13. Riscos

1. **Montar o FreeSWITCH pelo nosso GitHub:** o build do código oficial leva tempo e tem dependências (o sofia-sip e o spandsp em versões certas). Mitigação: um workflow próprio com cache, e uma versão fixa.
2. **O H.264:** os telefones da central costumam pedir o H.264, e o servidor teria de gerar o mosaico nele. Na etapa 1 e na 2, o servidor usa o VP8. O H.264 fica para a etapa 3, depois de conferir a licença.
3. **O Safari do iPhone** tem as suas diferenças no WebRTC. Mitigação: o teste manual no iPhone desde a etapa 1.
4. **A banda da VM de vídeo:** 10 pessoas usam cerca de 25 Mbit/s em cada sentido. Uma VM no escritório precisa de uma internet boa na subida; senão, uma VM na nuvem.
5. **A ponte do PC** soma ligações ao motor do PC: cada telefone na ponte é uma ligação a mais com o servidor de vídeo.
6. **Redes que só deixam sair pela 443:** o TURN fica na 5349, porque a 443 é do WSS. Se isso aparecer no teste manual, um segundo endereço público para o TURN na 443 resolve.
