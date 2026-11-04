# Starsonic Phone — chat interno, 1ª versão — especificação de design

- **Data:** 04/11/2026
- **Status:** o desenho foi aprovado pelo responsável no chat em 04/11/2026, em cinco partes:
  - como o chat é montado;
  - o que ele guarda;
  - como funciona para quem usa, com as telas;
  - a segurança e os erros;
  - os testes, a entrega e as etapas.

  As telas estão no quadro "Starsonic Phone — telas do chat" (claude.ai, 13 telas). Esta spec aguarda a revisão escrita.
- **Versão alvo:**
  - o servidor do chat 0.1.0, com tag `chat-v0.1.0`;
  - o app do Windows 0.2.0-rc.1.
- **Base:**
  - o app do Windows na 0.1.0-rc.6, com as telas (`windows/ui`), o núcleo (`starsonic/desktop`) e o contrato da ponte (`docs/ponte-windows.md`);
  - a identidade visual da Starsonic, pelo design system "Starsonic" e pelo visual do app.

> **Decisões do responsável** (04/11/2026):
> 1. O chat é para a equipe da Starsonic e para as empresas clientes. Cada empresa conversa só entre as suas pessoas, separada das outras e da Starsonic.
> 2. As conversas ficam num servidor da Starsonic, com um programa de chat feito para o Starsonic Phone (o caminho 1 de três). Ficaram de fora um servidor Matrix com módulos nossos e um chat pronto (Mattermost ou Rocket.Chat) aberto dentro do app.
> 3. A 1ª versão tem a conversa de texto entre duas pessoas, os arquivos e as fotos, e os grupos. Os áudios gravados e o chat no celular ficam para depois.
> 4. O chat não depende da central de telefonia e nunca fala com ela. A central que a Starsonic usa hoje é de um fornecedor; várias empresas usam o mesmo endereço, e o mesmo número de ramal pode existir em duas empresas.
> 5. Os arquivos ficam 1 ano no servidor. O texto das conversas fica para sempre.
> 6. Para entrar no chat, o técnico liga o computador à empresa com um código. Um computador novo não espera aprovação (seção 9.1).
> 7. As telas são as do quadro.

## 1. Contexto
O Starsonic Phone é o softphone da Starsonic para os clientes dela. A lista de conversas do 3CX, que o responsável mostrou em 04/11/2026, é a referência: conversar com os colegas, mandar arquivos e fotos, e montar grupos, sem sair do app de telefone.

Hoje o app não tem chat. O núcleo novo só faz ligações. A W1 deixou de fora, de propósito, as mensagens SIP do softphone antigo (spec da W1, seção de fora do escopo).

## 2. Objetivos
- Um chat dentro do Starsonic Phone para Windows, com a cara e a marca do app.
- Cada empresa separada: nada de uma aparece para outra.
- O servidor fica com a Starsonic, num programa pequeno, que um técnico instala e atualiza com um comando.
- A tela do chat é feita na interface do app (Preact), para o iPhone usar a mesma tela depois.

## 3. Critérios de sucesso
- Duas pessoas da mesma empresa, em dois PCs, conversam por texto, mandam um PDF e uma foto, e montam um grupo com uma terceira.
- Uma pessoa de outra empresa não vê, não acha e não alcança nada da primeira. Os testes do servidor provam isso para cada operação.
- A mensagem para quem está com o computador desligado chega quando o app abre. Num computador novo, as conversas antigas aparecem.
- Com a conversa fechada, ou o app na bandeja, a mensagem nova mostra o aviso no canto da tela e o número na aba e no ícone.
- A queda da central de telefonia não derruba o chat. A queda do chat não derruba as ligações.
- O servidor instala num Linux com um comando, e a página de administração cadastra uma empresa e mostra o código dela.

## 4. O que a 1ª versão entrega

### 4.1 Telas (o quadro "Starsonic Phone — telas do chat")
- **A aba Chat** (`Main`): a lista de conversas, com a mais recente em cima.
  - Cada conversa mostra as iniciais (um ícone de grupo, no grupo), o nome, o começo da última mensagem, a hora e o número de não lidas.
  - Em cima ficam a busca "Procurar conversa" e o botão "+".
  - A aba ganha o número de não lidas.
- **A primeira vez** (`Vazio`): "Nenhuma conversa ainda", com "Começar uma conversa". O menu do "+" tem "Nova conversa" e "Novo grupo".
- **Nova conversa** (`NovaConversa`): a busca "Procurar pelo nome ou pelo ramal", o atalho "Novo grupo" e os colegas da empresa que já usam o chat, com o nome e o ramal.
- **Novo grupo** (`NovoGrupo`): o "Nome do grupo", a escolha das pessoas com a busca, e "Criar grupo com N pessoas".
- **A conversa com uma pessoa** (`Conversa`):
  - no alto, o nome, "Ramal N" e o botão Ligar, que liga para o ramal;
  - as mensagens em balões: as suas à direita, em azul, e as dos outros à esquerda, em branco, com a hora e o separador do dia;
  - a foto aparece pequena, e o arquivo aparece com o nome, o tamanho e o tipo;
  - embaixo ficam o clipe, o campo "Escreva uma mensagem" e o Enviar;
  - as abas de baixo somem, e a seta volta para a lista.
- **A conversa de grupo** (`Grupo`): o nome de quem mandou em cima do balão. No alto, o nome do grupo e "N pessoas · ver os membros". A entrada e a saída de alguém aparecem na conversa, por exemplo "Beatriz Ramos pôs Carlos Lima no grupo".
- **Os membros** (`Membros`):
  - a lista, com o ramal de cada pessoa e quem cuida do grupo;
  - "Tirar" e "Pôr pessoas no grupo", só para quem cuida do grupo;
  - "Sair do grupo", para todos.
- **Sem internet** (`SemConexao`): a faixa "Sem conexão com o chat. Tentando de novo…" e a mensagem marcada "Não enviada", com "Tentar de novo".
- **O tema escuro** (`ConversaEscura`): o app segue o tema do Windows. No escuro, as suas mensagens ficam em ciano, com o texto `on-cyan`.
- **O aviso do Windows** (`Aviso`): o nome, o começo da mensagem e o número no ícone da barra de tarefas.
- **O cartão Chat na área do administrador** (`AdmChat`): o "Código da empresa", "Ligar ao chat" e, depois de ligado, "Ligado ao chat da <empresa>." e "Desligar do chat".
- **A página de administração** (`Painel`, `PainelEmpresa`):
  - **as empresas:** o número de pessoas e o espaço de cada uma, e "Nova empresa";
  - **uma empresa:**
    - o código de entrada, com "Copiar o código" e "Trocar o código";
    - as pessoas, com o ramal, os computadores (cada um com o seu "×") e a última vez;
    - "Tirar do chat" e "Apagar a empresa".

### 4.2 Comportamento
- **Enviar.** O Enter envia, e o Shift+Enter pula linha. Um texto tem até 4.000 caracteres. Perto do limite, o campo mostra quantos faltam, e no limite para de aceitar.
- **Arquivos.** O clipe escolhe arquivos e fotos; arrastar para a conversa ou colar (Ctrl+V) também vale.
  - Antes de sair, os arquivos aparecem em cima do campo, cada um com um "×", e só saem no Enviar. Assim, um print colado por engano não vai.
  - Cada arquivo vira uma mensagem, até 10 de uma vez, cada um com até 25 MB.
  - O envio mostra o progresso no balão.
- **A foto** (jpg, png, gif ou webp) ganha uma miniatura de até 480 px, feita pelo app de quem manda. Um clique abre a foto grande dentro do app.
- **O arquivo:** um clique baixa o arquivo para a pasta Downloads e abre. Se o nome já existe lá, ganha "(2)". O Windows trata o arquivo como vindo da internet (seção 6.4).
- **Lida.** Uma conversa aberta, com a janela do app na frente, marca as mensagens como lidas. Ler num computador zera o número nos outros computadores da mesma pessoa.
- **As mais antigas:** rolando para cima, chegam as mensagens mais antigas, de 50 em 50.
- **A busca da lista** acha a conversa pelo nome da pessoa ou do grupo. A da nova conversa acha pelo nome (sem acento e sem caixa) ou pelo ramal.
- **Quem aparece:** só os colegas da mesma empresa que já entraram no chat e não foram tirados.
- **O grupo:**
  - tem até 200 pessoas e um nome de até 60 caracteres;
  - quem criou cuida dele: põe e tira pessoas;
  - qualquer um sai;
  - se quem cuida sair, a pessoa mais antiga no grupo passa a cuidar.
- **A conversa a dois** é uma só para cada par de pessoas.
- **O botão Ligar** da conversa liga para o ramal da pessoa, como o Ligar de um contato.
- **O aviso:**
  - ele aparece quando chega uma mensagem e a conversa dela não está aberta com a janela na frente: o app pode estar na bandeja, minimizado, em outra aba ou em outra conversa;
  - ele mostra o nome (no grupo, "Nome no Grupo") e o começo da mensagem; um arquivo aparece como "Arquivo: <nome>" e uma foto como "Foto";
  - um clique abre o app nessa conversa;
  - no "Não perturbe", o aviso não aparece, mas o número continua;
  - o "Não incomodar" do Windows também cala o aviso;
  - o som é o do aviso do Windows.
- **O número no ícone:** a soma das não lidas, de 1 a 9, e "9+" acima disso.
- **O app fechado:** com o app fechado ("Sair"), nada chega. As mensagens esperam no servidor e aparecem quando o app abre.
- **Dois computadores:** quem usa o chat em dois computadores recebe as mensagens nos dois.
- **Um computador novo** para a mesma pessoa faz os outros computadores dela mostrarem "Seu chat entrou em outro computador: <nome do computador>".
- **A conta em uso:**
  - o chat é o da conta em uso: trocar de conta no app troca a pessoa no chat;
  - uma conta que nunca se conectou à central naquele computador não entra no chat: a aba mostra "Conecte a sua conta para usar o chat.".

### 4.3 A página de administração
- Ela é só da Starsonic: abre com usuário e senha, no endereço do servidor, em `/admin`.
- **As empresas:** a lista, com o número de pessoas, o espaço dos arquivos e a data de entrada, mais os totais (empresas, pessoas, espaço).
- **"Nova empresa":** pede o nome e mostra o código de entrada.
- **Numa empresa:**
  - o código, com "Copiar o código" e "Trocar o código". Trocar o código não tira ninguém do chat: o código novo vale para os computadores que entrarem depois;
  - as pessoas, com o ramal, os computadores (o nome de cada um e a última vez que entrou) e "Tirar do chat";
  - tirar um computador, pelo "×" dele;
  - "Apagar a empresa", que pede o nome da empresa digitado e apaga tudo dela.
- A página **não mostra as conversas**.

## 5. Fora do escopo da 1ª versão
- Os áudios gravados.
- O chat no Android e no iPhone, com o aviso no celular. A tela do iPhone vai reusar a interface; no modo iPhone, a aba Chat fica escondida até lá.
- Apagar ou editar uma mensagem, o "visto" (lida pelo outro), quem está online, responder citando, as reações e procurar dentro das mensagens.
- Responder pelo aviso do Windows.
- Conversar com quem é de outra empresa, também entre a Starsonic e um cliente.
- Reuniões, conferências e webinars.
- Aprovar cada computador novo na página de administração (seção 9.1).
- Mensagens cifradas de ponta a ponta: o servidor consegue ler as conversas (seção 9.5).

## 6. Arquitetura

### 6.1 As partes
```
App do Windows                                     Servidor do chat (Linux)
┌────────────────────────────────────┐   HTTPS    ┌───────────────────────────────┐
│ interface (Preact): telas e cliente│◄─────────►│ starsonic-chat (um programa)  │
│ do chat (HTTP + WebSocket)         │ WebSocket  │  - a API do app e o WebSocket │
│        ▲ ponte (JSON)              │            │  - a página de administração  │
│ núcleo (C++): a chave do computador│            │  - chat.db (SQLite) e a pasta │
│ o aviso, o número no ícone, baixar │            │    dos arquivos               │
└────────────────────────────────────┘            └───────────────────────────────┘
       (a central de telefonia não entra: o chat nunca fala com ela)
```

### 6.2 O servidor
- **O programa:** um programa só, em Go, compilado para `linux/amd64`, chamado `starsonic-chat`. A versão do Go fica fixada no `go.mod`, e as dependências ficam no mínimo:
  - uma biblioteca de WebSocket;
  - o SQLite em Go puro, sem cgo;
  - o `golang.org/x/crypto`, para o certificado e para o argon2id.
- **Os dados:** um arquivo de banco SQLite, no modo WAL, e uma pasta de arquivos, nas pastas de dados do serviço.
- **A configuração:** um arquivo de configuração, com o endereço e a pasta de dados. Os usuários da página de administração são criados por um comando do programa, que pede a senha.
- **O cadeado (HTTPS):**
  - o próprio programa tira e renova o certificado do Let's Encrypt;
  - ele escuta na porta 443, e a 80 serve só para o desafio do certificado e para mandar para o HTTPS;
  - o endereço proposto é `chat.starsonic.com.br`.
- **O modo de teste:** um modo só para os testes automáticos, sem cadeado e preso ao `127.0.0.1`. O programa recusa esse modo em qualquer outro endereço.
- **No repositório:**
  - o código fica numa pasta nova, `chat-servidor/`, com os testes;
  - o contrato da API fica em `docs/chat-protocolo.md`, como o da ponte;
  - a instalação e a operação ficam em `docs/chat-servidor.md`.

### 6.3 A interface do app
- O cliente do chat fica numa pasta nova de `windows/ui/src`, em TypeScript, com as telas da seção 4.1.
- Ele fala direto com o servidor, por HTTPS para as operações e por um WebSocket para as novidades em tempo real.
- O endereço do servidor é fixo no app; os testes usam um gancho de teste, como os outros, que o build de publicação não tem.
- A aba Chat aparece só com o computador ligado a uma empresa. No modo iPhone, ela fica escondida (seção 5).
- **A mensagem nova:** a interface pede o aviso e o número ao núcleo, pela ponte.
- **Na bandeja:** a interface continua rodando com a janela escondida, e o WebSocket continua ligado. A etapa 2 confere se o WebView2 escondido demora a receber (seção 15).

### 6.4 O núcleo (C++, Windows)
- **A chave do computador:** guarda e lê a chave, protegida pelo Windows (DPAPI, do usuário do Windows), e o nome da empresa. A chave sai só para a interface, por um pedido dela, e nunca entra no estado geral da ponte.
- **Os ramais conectados:** guarda a lista dos ramais que já se conectaram à central naquele computador, para a regra da seção 4.2.
- **O aviso:** mostra o aviso pelo ícone da bandeja (`Shell_NotifyIcon`), que o Windows exibe como um aviso dele. Um clique abre a janela na conversa.
- **O número:** põe o número no ícone da barra de tarefas (`ITaskbarList3::SetOverlayIcon`).
- **Baixar:**
  - baixa o arquivo com a chave, para a pasta Downloads;
  - marca o arquivo como vindo da internet, com o `Zone.Identifier` e a zona 3 (o "Mark of the Web"), para o Windows avisar antes de abrir um programa;
  - abre o arquivo com o programa padrão.
- **A ponte** ganha os pedidos e os campos novos, descritos em `docs/ponte-windows.md`.

### 6.5 A API (resumo; os nomes e os campos exatos ficam em `docs/chat-protocolo.md`)
- **Ligar o computador:** com o código da empresa e o nome do computador. Volta a chave do computador (256 bits aleatórios, mostrada uma vez só) e o nome da empresa.
- **Desligar o computador:** a chave deixa de valer (o "Desligar do chat").
- **Todo o resto** leva a chave no cabeçalho `Authorization`. A empresa vem sempre da chave, e nenhuma operação aceita a empresa vinda do app.
- **Entrar como pessoa:** com o ramal e o nome da conta em uso. A pessoa é criada ou atualizada na empresa, e o par computador–ramal fica guardado. Um par novo, para uma pessoa que já tem outros computadores, manda o aviso de computador novo a eles.
- **As pessoas da empresa:** os colegas no chat, para a nova conversa.
- **As conversas:**
  - a lista, com a última mensagem e as não lidas;
  - criar a conversa a dois (volta a que já existe) ou o grupo;
  - pôr, tirar e sair;
  - as mensagens, de 50 em 50, antes de uma mensagem;
  - enviar (com um `idLocal` do app, para que o "Tentar de novo" não duplique);
  - marcar como lida até uma mensagem.
- **Os arquivos:**
  - enviar, até 25 MB, com o nome e o tipo, e a miniatura de uma foto;
  - baixar o arquivo e a miniatura, só para quem está na conversa.
- **O WebSocket** traz:
  - a mensagem nova;
  - a leitura feita em outro computador da mesma pessoa;
  - a conversa criada ou mudada (membros);
  - o computador novo;
  - "este computador saiu do chat".
- **Ao voltar a conexão,** o app relê a lista e busca as mensagens depois da última que tem de cada conversa aberta.
- **A ordem:** cada mensagem ganha um número que só cresce, e a hora é a do servidor.

## 7. Dados (no servidor)
- **Empresas:**
  - o id e o nome;
  - o código de entrada, no formato `STAR-XXXX-XXXX`, com caracteres sem letras parecidas, gerado pelo servidor;
  - a data de entrada.
- **Pessoas:** a empresa, o ramal, o nome, a data de entrada e se saiu. Dentro de uma empresa, o ramal é único.
- **Computadores:**
  - a empresa;
  - o hash SHA-256 da chave, nunca a chave;
  - o nome do computador;
  - as pessoas que já usaram o chat nele;
  - a última vez que entrou.
- **Conversas:** o tipo (a dois ou grupo), o nome do grupo, quem cuida, os membros, com a data de entrada de cada um, e a data de criação.
- **Mensagens:**
  - o número, a conversa, quem mandou e a hora;
  - o texto (até 4.000 caracteres), ou o arquivo, ou o aviso de grupo ("pôs", "tirou", "saiu");
  - o `idLocal`.
- **Arquivos:**
  - o id (aleatório, de 128 bits), a empresa, o nome, o tipo, o tamanho e quem mandou;
  - a miniatura;
  - a data e se já expirou.

  No disco, o arquivo fica pelo id, nunca pelo nome.
- **Leitura:** para cada pessoa e conversa, até qual mensagem ela leu.
- **Quanto tempo fica:**
  - **os arquivos:** 365 dias. Uma tarefa diária apaga o arquivo e a miniatura, e a mensagem passa a mostrar "Arquivo expirado";
  - **o texto:** para sempre.
- **Tirar uma pessoa:**
  - ela sai de todos os grupos e não entra mais;
  - os computadores dela saem;
  - as mensagens dela continuam, com o nome e "(saiu)";
  - o mesmo ramal, depois, entra como uma pessoa nova, sem as conversas antigas. Por isso, quando alguém sai da empresa, a Starsonic tira a pessoa do chat antes de o ramal passar para outra pessoa (`docs/chat-servidor.md`).
- **Tirar um computador:** a chave dele deixa de valer.
- **Apagar a empresa:** apaga tudo dela, no banco e no disco.
- **No computador** ficam só a chave (protegida pelo Windows), o nome da empresa e a lista de ramais conectados. As conversas não ficam guardadas no computador: elas vêm do servidor.

## 8. Fluxos

### 8.1 Ligar o computador (o técnico)
1. Na área do administrador, no cartão Chat, o técnico cola o código e clica em "Ligar ao chat".
2. O app manda o código e o nome do computador ao servidor. O servidor confere o código e o limite de tentativas, e volta a chave e o nome da empresa.
3. O núcleo guarda a chave e a empresa. O cartão mostra "Ligado ao chat da <empresa>.", e a aba Chat aparece.
4. "Desligar do chat" apaga a chave do computador e tira a aba. A chave também deixa de valer no servidor.

### 8.2 Entrar e conversar
1. Com a aba Chat aberta e a conta em uso conectada pelo menos uma vez naquele computador, a interface entra como a pessoa (o ramal e o nome) e abre o WebSocket.
2. A lista vem do servidor. Uma mensagem enviada aparece no balão na hora, como "enviando", e passa a enviada quando o servidor responde.
3. Sem resposta em 15 segundos, ou com um erro, a mensagem fica "Não enviada". O "Tentar de novo" manda de novo com o mesmo `idLocal`.

### 8.3 Sem internet
1. O WebSocket caiu: aparece a faixa, e o app tenta de novo em 1, 2, 5, 10 e 30 segundos, e depois a cada 30.
2. A mensagem escrita sem conexão fica "Não enviada", com o "Tentar de novo".
3. Quando a conexão volta, a faixa some, e as novidades chegam (seção 6.5).

### 8.4 Fora do chat
Quando a chave não vale mais, a aba mostra "Este computador saiu do chat. Fale com o suporte da Starsonic." e para de tentar. Isso vale para um computador tirado, uma pessoa tirada e uma empresa apagada. Ligar de novo pede o código ao técnico.

## 9. Segurança

### 9.1 Quem entra
- **O código da empresa** é o segredo da entrada. O técnico cola o código na área do administrador, que já tem senha. Depois disso, o código não viaja mais: o app usa a chave do computador.
- **O ramal** vem da conta em uso, só se ela já se conectou à central naquele computador. Para entrar como outro ramal, a pessoa precisa saber a senha dele.
- **Para pegar um intruso:**
  - o aviso de computador novo;
  - a lista de computadores de cada pessoa, na página de administração;
  - "Tirar" e "Trocar o código".
- **Aceito na 1ª versão:**
  - o servidor confia no ramal que o app diz, porque não fala com a central;
  - um app adulterado, com o código da empresa, poderia dizer outro ramal da mesma empresa. O aviso de computador novo mostra isso para a pessoa.
- **A aprovação de cada computador novo** fica para uma versão seguinte, se um cliente pedir.

### 9.2 O servidor
- **O cadeado:** só HTTPS, com o HSTS ligado. O WebSocket também vai pelo cadeado.
- **As chaves:** o servidor guarda só o hash de cada chave, então quem copiar o banco não consegue usar as chaves. Cada operação confere a chave e a empresa dela.
- **Os arquivos:**
  - um arquivo é entregue só para quem está na conversa dele, e o id dele não dá para adivinhar;
  - o servidor entrega o arquivo sempre como download (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`), nunca como página;
  - a miniatura sai só como imagem;
  - o servidor nunca abre nem executa um arquivo.
- **Os limites:**
  - 60 mensagens por minuto e 200 MB de arquivos por hora, por computador;
  - 10 códigos errados por hora, por endereço de internet. Depois disso, o endereço espera 1 hora;
  - o tamanho de cada pedido também tem limite.
- **A página de administração:**
  - abre com usuário e senha. A senha fica guardada com argon2id;
  - depois de 5 senhas erradas, o usuário trava por 15 minutos;
  - a sessão dura 12 horas, num cookie `HttpOnly`, `Secure` e `SameSite=Strict`, e todo formulário leva a proteção contra CSRF;
  - a página não mostra as conversas.
- **O app:** só o endereço do app pode chamar a API pelo navegador (o CORS).

### 9.3 O app
- A chave sai do núcleo só para a interface.
- A interface mostra o texto das mensagens sempre como texto, nunca como HTML.
- O arquivo baixado leva a marca de vindo da internet.

### 9.4 A revisão
Antes de o servidor ser instalado, um revisor que não participou da construção olha a segurança dele inteira, a partir desta seção.

### 9.5 Privacidade
- As conversas viajam cifradas, mas no servidor a Starsonic consegue ler. É assim também no Teams e no 3CX.
- A política de privacidade ganha uma parte sobre o chat:
  - o que fica guardado e por quanto tempo;
  - quem tem acesso;
  - como apagar.
- Quando um cliente sai e pede, "Apagar a empresa" apaga tudo dele.

## 10. Interface e textos
- **O visual:** o do app e do design system Starsonic, como no quadro:
  - a fonte é a Plus Jakarta Sans;
  - o cabeçalho é o azul-marinho do app;
  - o ciano fica na ação (Enviar, "+", Ligar, o número de não lidas, com o texto `on-cyan`);
  - as suas mensagens ficam em `blue` no tema claro e em `cyan` no escuro.
- **Os textos novos,** para a aprovação do responsável pelas fotos:
  - "Chat", "Procurar conversa", "Nova conversa ou novo grupo", "Nova conversa", "Novo grupo";
  - "Nenhuma conversa ainda", "Converse com os colegas da sua empresa, mande arquivos e fotos, e monte grupos.", "Começar uma conversa";
  - "Procurar pelo nome ou pelo ramal", "Colegas no chat", "Aparecem só os colegas da sua empresa que já usam o chat.";
  - "Nome do grupo", "Pessoas · N escolhidas", "Criar grupo com N pessoas";
  - "Membros do grupo", "Você cuida deste grupo: só você põe e tira pessoas. Quem está no grupo pode sair quando quiser.", "criou o grupo", "cuida do grupo", "Tirar", "Pôr pessoas no grupo", "Sair do grupo";
  - "Escreva uma mensagem", "Escreva para o grupo", "Hoje", "Ontem", "Ramal N", "N pessoas · ver os membros";
  - "Sem conexão com o chat. Tentando de novo…", "Não enviada", "Tentar de novo";
  - "Este arquivo passa de 25 MB.", "O grupo já tem 200 pessoas.", "Arquivo expirado";
  - "Conecte a sua conta para usar o chat.", "Este computador saiu do chat. Fale com o suporte da Starsonic.", "Seu chat entrou em outro computador: <nome>";
  - no cartão do administrador: "Chat", "Liga este computador ao chat de uma empresa. O código vem da página de administração do chat.", "Código da empresa", "Ligar ao chat", "Ligado ao chat da <empresa>. A aba Chat já aparece no app.", "Desligar do chat", "Código não encontrado. Confira o código na página de administração.".
- **O aviso:** o nome de quem mandou (no grupo, "<Nome> no <Grupo>") e o começo da mensagem, "Foto" ou "Arquivo: <nome>".
- **Os nomes para o leitor de tela:**
  - cada botão de ícone tem o seu nome, como "Ligar para <nome>, ramal N", "Anexar um arquivo ou uma foto" e "Enviar";
  - a lista de mensagens é um `log`;
  - a faixa sem internet é um `status`.

## 11. Erros e testes

### 11.1 Mensagens
As mensagens são as da seção 10, e cada caso da seção 8 tem a sua.

### 11.2 Testes automáticos (a cada mudança, no GitHub)
- **No servidor (Go):** cada operação da API e da página tem os seus testes, com o servidor de verdade num endereço local. Os testes cobrem:
  - a entrada com o código e com a chave, e o limite de códigos errados;
  - o isolamento: para cada operação, uma pessoa de outra empresa recebe "não encontrado" e não vê nada;
  - as mensagens, o `idLocal` sem duplicar, a ordem e as não lidas;
  - os grupos: quem cuida, sair e a passagem para o mais antigo;
  - os arquivos: o tamanho, quem pode baixar, o download com `attachment` e `nosniff`, e o arquivo que expira em 365 dias, com o relógio de teste;
  - os limites de mensagens e de megabytes;
  - tirar uma pessoa, tirar um computador e apagar a empresa;
  - a página: a senha, a trava, o CSRF, trocar o código e apagar com o nome digitado.
- **No app (Playwright):** as telas da seção 4.1, contra o servidor em modo de teste. Os testes cobrem:
  - o envio com o "Tentar de novo";
  - os arquivos: escolher, arrastar, colar e o "×";
  - a busca;
  - o grupo e os membros;
  - a faixa sem internet;
  - "saiu do chat" e "Conecte a sua conta";
  - o teclado e os nomes para o leitor de tela;
  - as fotos para a aprovação, nos dois temas e nos tamanhos de janela do app.
- **De ponta a ponta:** dois apps de teste conversam pelo servidor de verdade, com texto, foto, arquivo e grupo.
- **No núcleo (C++):** a chave com a DPAPI, os ramais conectados, o pedido do aviso e do número, e baixar com o nome "(2)" e com o `Zone.Identifier`.
- **O CI:** um workflow novo, `chat`, compila e testa o servidor. O workflow `build` do app passa a usar o servidor compilado nos testes do Playwright.

### 11.3 Teste manual
O `docs/teste-manual.md` ganha uma seção do chat, feita em dois PCs, com dois ramais da mesma empresa e um de outra empresa. Ela cobre:
- a página de administração;
- ligar e desligar o computador;
- texto, foto, arquivo, grupo e os membros;
- o aviso e o número;
- o "Não perturbe";
- a bandeja;
- sem internet;
- dois computadores;
- tirar e apagar.

## 12. Instalação e operação do servidor
- **O que precisa:**
  - um servidor Linux (Ubuntu 24.04), na internet, com 2 GB de memória e uns 100 GB de disco para começar;
  - o endereço (por exemplo, `chat.starsonic.com.br`) apontado para ele no DNS;
  - as portas 443 e 80 abertas.
- **A instalação:** o programa sai pronto numa release do GitHub (`chat-v<versão>`), com o SHA-256. Um comando de uma linha instala e liga o serviço (systemd), e outro atualiza. Os comandos ficam em `docs/chat-servidor.md`.
- **A atualização:** o servidor não se atualiza sozinho. A Starsonic roda o comando quando sai uma versão nova.
- **A cópia de segurança:**
  - uma vez por noite, às 03:00 (horário de Brasília), o programa faz uma cópia consistente do banco, com os arquivos novos;
  - a cópia vai para fora do servidor e fica 30 dias;
  - o destino é escolhido na instalação: outro servidor da Starsonic ou um armazenamento na nuvem.
  - `docs/chat-servidor.md` diz como voltar uma cópia.
- **O espaço:** a página de administração mostra o espaço de cada empresa e o total.

## 13. Entrega e etapas
1. **Etapa 1: o servidor e a página de administração.**
   - O código vai em `chat-servidor/`, com os testes, o `docs/chat-protocolo.md`, o `docs/chat-servidor.md` e os workflows `chat` e `chat-release`.
   - Antes da instalação, a revisão de segurança (seção 9.4).
   - O responsável publica a release `chat-v0.1.0` e instala o servidor.
   - O app não muda.
2. **Etapa 2: o chat no Windows.**
   - Entram a interface, o cartão do administrador, a ponte e o núcleo, os testes, as fotos para aprovar, a seção do roteiro e as notas.
   - Sai como 0.2.0-rc.1, que o responsável publica pelo workflow `release`, como sempre. O número muda para 0.2.0 para que a 0.1.0 possa virar versão estável sem esperar o chat.
3. **Depois, cada um com a sua spec:** os áudios gravados, e o chat no Android e no iPhone, com o aviso no celular.

Cada etapa tem um plano escrito em `docs/superpowers/plans/`, aprovado pelo responsável antes de começar.

## 14. Entradas necessárias da Starsonic
- **O servidor Linux:** vocês já têm um ou vão contratar? Foi perguntado em 04/11/2026 e ficou para a instalação. Precisa estar pronto no fim da etapa 1.
- **O endereço** e o DNS. A proposta é `chat.starsonic.com.br`.
- **O destino da cópia de segurança.**
- **Os usuários** da página de administração.
- **A aprovação** dos textos (pelas fotos da etapa 2) e da parte do chat na política de privacidade.

## 15. Riscos
- **O WebView2 escondido** (o app na bandeja) pode atrasar as mensagens ou o WebSocket. A etapa 2 mede isso. Se atrasar, o núcleo mantém a interface acordada, ou o servidor manda um "ping" a cada 25 segundos.
- **Um servidor nosso na internet,** com arquivos de clientes. Para isso:
  - a API é pequena;
  - há a revisão de segurança antes de instalar;
  - há os limites e as atualizações pelo comando;
  - há a cópia de segurança.
- **O disco enche.** Para isso, os arquivos expiram em 1 ano, e a página mostra o espaço.
- **O SQLite fica num servidor só.** Isso basta para milhares de pessoas. Crescer além disso pede outra spec.
- **O ramal dito pelo app** (seção 9.1). O aviso de computador novo e a página de administração ajudam a perceber um intruso.
- **O certificado** precisa das portas 80 e 443 abertas. Se o servidor ficar atrás de um firewall, essas portas precisam ser abertas.
