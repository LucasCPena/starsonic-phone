# Starsonic Phone para Windows: atalhos com BLF, área do administrador, bipe e status (especificação de design)

- **Data:** 22/10/2026
- **Status:** implementada na 0.1.0-rc.3 (25/10/2026). O que mudou durante a construção está na seção "Como ficou", no fim. O desenho foi aprovado pelo responsável em 22/10/2026, no chat e no canvas "Starsonic Phone Windows — atalhos, administrador e status" (claude.ai, 7 quadros), e esta spec, na revisão escrita do mesmo dia.
- **Versão alvo:** 0.1.0-rc.3 (canal de teste).
- **Base:** a W1 (`2026-10-21-starsonic-phone-windows-w1-design.md`) com a rc.2. Esta etapa traz a W3 (BLF) para dentro dos atalhos. A W2 (gravação) continua depois.

## 1. Objetivo

Seis mudanças pedidas pelo responsável:

1. Atalhos configuráveis, como os do MicroSIP, até 8.
2. BLF nos atalhos, ligado pelo administrador.
3. Bipe quando a ligação cai ou termina.
4. Área do administrador com Ctrl + P e senha.
5. A bolinha da conta segue o Não perturbe.
6. A bolinha segue a internet.

## 2. Decisões do responsável (22/10/2026)

- Qualquer pessoa configura os atalhos. Não há trava de administrador para isso.
- O bipe vem ligado de fábrica, e a pessoa pode desligar em Configurações.
- O BLF dos atalhos é ligado ou desligado na área do administrador.
- Os servidores starcloud-starsonic.com.br e starcloud1-starsonic.com.br já têm o BLF ligado.
- O código para puxar a ligação depende do cliente, então é um campo da área do administrador.
- A área do administrador abre com Ctrl + P e a senha (a senha combinada com o responsável, que não fica no repositório). Ela não tem mais itens além dos do canvas.

## 3. Atalhos

### 3.1 Onde ficam
- Ficam numa aba nova, **Atalhos**, entre Teclado e Recentes. Nos layouts Compacto e Mínimo a aba aparece só com o ícone.
- A grade tem duas colunas e até 8 cartões. Cada cartão mostra:
  - o ícone da ação;
  - o nome;
  - a ação e o número;
  - o BLF, quando ligado.
- Os espaços vazios mostram "Adicionar atalho". O contador fica no alto: "<n> de 8".
- Clicar usa o atalho. O botão direito, ou o menu "Editar" do cartão pelo teclado, abre a edição.
- Durante a ligação, um botão **Atalhos** na tela da ligação abre um painel com os mesmos atalhos.

### 3.2 Ações
| Ação | Fora de ligação | Durante a ligação |
|---|---|---|
| Ligar | liga para o número | faz uma nova ligação (a atual fica em espera, como "Nova ligação") |
| Transferir | liga para o número | transfere direto (como "Transferir agora") |
| Transferir com consulta | liga para o número | consulta o número (como "Consultar") |
| Enviar teclas | desativado | envia os dígitos como DTMF |

Os atalhos usam os mesmos comandos de hoje, com a regra de discagem: `dial`, transferência direta, `consult` e `dtmf`.

### 3.3 Edição
- **Campos:**
  - Nome: obrigatório, até 24 caracteres.
  - Número: obrigatório. São aceitos dígitos, `*`, `#` e `+`.
  - Ação: uma das quatro.
  - "Mostrar se o ramal está livre", que liga o BLF deste atalho. Vem ligada quando o número parece um ramal (só dígitos, de 2 a 6) e o administrador ligou o BLF. Sem o BLF do administrador, a chave aparece desativada, com a ajuda "O administrador não ligou o BLF".
- **Botões:** Salvar atalho, Remover e Voltar.
- **Onde ficam:** os atalhos são gravados em `atalhos.json` na pasta de dados, com gravação atômica. Ficam por computador e são os mesmos para todas as contas.

## 4. BLF

- **Assinatura no servidor.**
  - O motor assina o estado de cada ramal pelo SIP `SUBSCRIBE` com o evento `dialog` (RFC 4235). O pjsua2 faz isso com `BuddyConfig.subscribe_dlg_event` e a resposta chega em `onBuddyDlgEventState`.
  - É uma função nova e aditiva do `SipEngine`. O Android não usa e continua igual.
- **Quando assina:** só com o BLF do administrador ligado, só para os atalhos com BLF ligado, e na conta em uso. Trocar de conta, sair ou perder a conexão cancela as assinaturas, e elas voltam quando a conta registra de novo.
- **Estados:**

  | Estado | Bolinha | Quando |
  |---|---|---|
  | Livre | verde `#22c55e` | `terminated` ou nenhum diálogo |
  | Tocando | ciano `#00c2cb`, piscando devagar | `early` / `proceeding` |
  | Ocupado | vermelho `#d64545` | `confirmed` |
  | Desconectado | cinza `#b9c4e6` | assinatura recusada, vencida ou sem resposta |

  A palavra do estado sempre aparece ao lado da bolinha. A bolinha nunca aparece sozinha.
- **Puxar ligação.**
  - Com a chave "Puxar ligação pelo atalho" do administrador ligada, clicar num atalho de ramal **tocando** liga para o código de puxar, em vez de fazer a ação normal.
  - O código vem do campo do administrador, com `{ramal}` trocado pelo número do atalho (por exemplo, `**{ramal}` vira `**2007`, e `*8` não leva ramal).
  - Com o campo vazio, o atalho tocando faz a ação normal.

## 5. Bipe no fim da ligação

- Toca um bipe curto quando uma ligação atendida termina, por qualquer motivo: a outra pessoa desligou, a ligação caiu ou a própria pessoa desligou.
  - O som é 425 Hz por 0,25 s, duas vezes com 0,15 s de intervalo, gerado por WebAudio.
  - Ele toca no dispositivo **Alto-falante** da ligação (Ruling 13), não no de Toque.
- Não toca para ligação recusada, perdida ou que não completou.
- **Configuração:** "Bipe quando a ligação cai ou termina", em Configurações → Ligações. Vem ligada e fica gravada em `config.json`.

## 6. Área do administrador

### 6.1 Entrada
- Ctrl + P em qualquer tela da janela principal abre o diálogo "Área do administrador" com o campo Senha. O app não usa Ctrl + P para imprimir.
- **Senha:**
  - O programa não guarda a senha em texto. Guarda só um resumo PBKDF2-SHA256 com sal (100 000 iterações) e compara com ele.
  - A senha errada mostra "Senha incorreta." e o campo é limpo.
  - Depois de 5 erros seguidos, o diálogo espera 30 s antes de aceitar outra tentativa.
- A área fica aberta até "Sair da área do administrador", até fechar a janela ou até 10 minutos sem uso.
- **Limite:** uma senha gravada dentro do programa pode ser descoberta por quem souber analisar o executável. O resumo impede só a leitura direta. Isso fica registrado em "Riscos".

### 6.2 O que se configura
- **Botões da tela principal.**
  - Não perturbe: mostrar ou esconder. Escondido, o Não perturbe fica desligado à força e o atalho da bandeja some.
  - Atender automático: mostrar ou esconder. Escondido, ele fica desligado à força. A opção também some de Configurações.
- **Atalhos.**
  - BLF nos atalhos (liga ou desliga para todos).
  - Puxar ligação pelo atalho (liga ou desliga).
  - Código para puxar a ligação (texto com `{ramal}`).
- **Servidores.**
  - A lista de servidores e portas (UDP e TCP), que começa com a do `perfil.ini` embutido (starcloud 5060, starcloud1 35060).
  - Dá para adicionar, editar e remover. O resultado vale para o `BuildAccount`, que monta a porta no registrador e no domínio, como na revisão 1.5.
- **Atualizações.**
  - O canal pode ser Teste (`canal-teste`) ou Estável (o release estável). O canal escolhido vale a partir da próxima verificação.
  - O build continua dizendo qual é o canal de fábrica.

### 6.3 Onde fica
- Tudo vai para `admin.json` na pasta de dados, com gravação atômica.
- O arquivo é protegido pelo DPAPI do usuário, como as senhas. Isso evita a troca por um editor de texto, mas não protege contra o próprio usuário com conhecimento técnico.
- Sem `admin.json`, valem os valores de fábrica:
  - os dois botões aparecem;
  - BLF desligado;
  - puxar ligação desligado e código vazio;
  - servidores do perfil;
  - canal de fábrica.

## 7. Bolinha da conta

Esta tabela substitui a da rc.2. A ordem é a prioridade: vale a primeira linha que bate.

| Situação | Bolinha | Texto |
|---|---|---|
| Sem internet | cinza | `Sem internet · tentando de novo` |
| Conectando | ciano | `Conectando…` |
| Erro no cadastro | cinza + triângulo de aviso | o texto de erro de hoje |
| Em ligação (inclusive tocando) | vermelha | `Ocupado · em ligação` |
| Não perturbe ligado | vermelha | `Não perturbe · as ligações não tocam` |
| Conectado | verde | `Conectado · <servidor>` |

- O ícone perto do relógio segue a mesma tabela. O Não perturbe usa o ícone vermelho de hoje, e "sem internet" usa o de sem conexão.

## 8. Verificação de internet

- **Como verifica:** o host acompanha a conexão do Windows pelo `INetworkListManager` e seus eventos de conectividade (`NLM_CONNECTIVITY_IPV4_INTERNET`/`IPV6_INTERNET`). Um teste DNS do servidor da conta, a cada 30 s, confirma quando o Windows diz que há internet mas o servidor não responde.
- **Quando a internet cai:** a bolinha fica cinza e o motor para de tentar registrar a cada poucos segundos.
- **Quando a internet volta:**
  - O motor registra de novo na hora: Conectando, depois verde.
  - As assinaturas de BLF voltam.
  - Uma ligação que caiu não é refeita.
- O estado vai para a ponte como `conta.internet: true|false`.

## 9. Ponte (acréscimos à versão 1, em `docs/ponte-windows.md`)

- **Estado:**
  - `atalhos: [{id, nome, numero, acao: "ligar"|"transferir"|"consulta"|"teclas", blf: bool, estado: "livre"|"tocando"|"ocupado"|"desconectado"|null}]`
  - `admin: {aberto: bool, naoPerturbe: bool, atenderAuto: bool, blf: bool, puxar: bool, codigoPuxar, servidores: [{endereco, porta}], canal: "teste"|"estavel"}`. Só vem completo com `aberto: true`; fora disso vem só o que a interface precisa para esconder botões.
  - `conta.internet`
  - `config.bipeFim`
- **Comandos:**
  - Atalhos: `saveShortcut {id?, nome, numero, acao, blf}`, `removeShortcut {id}`, `useShortcut {id}`.
  - Administrador: `adminLogin {senha}`, `adminLogout`, `adminSet {...}`.
  - Configurações: `setSetting bipeFim`.
- **Sinal:** `{"type":"ring","tipo":"fim"}`, que é o bipe e toca no alto-falante.

## 10. Testes

- **Portáteis (C++):**
  - O `AtalhosStore`: 8 no máximo, validação e gravação atômica.
  - O `AdminStore` com DPAPI de teste.
  - O resumo da senha: a certa entra, a errada não, e há a espera depois de 5 erros.
  - A tabela de prioridade da bolinha.
  - O código de puxar com `{ramal}`.
  - O `useShortcut` em cada ação, dentro e fora de ligação.
  - Os comandos da ponte.
- **Motor:** contra o registrador falso, que ganha o `SUBSCRIBE dialog`, com `NOTIFY` de livre, tocando, ocupado e recusado. O fim da assinatura acontece na troca de conta.
- **Interface (Playwright):**
  - A aba Atalhos nos três layouts.
  - A edição.
  - O BLF com palavra e cor.
  - O painel na ligação.
  - Ctrl + P e o diálogo.
  - A área do administrador, incluindo esconder o Não perturbe.
  - A chave do bipe.
  - A bolinha nos seis estados.
  - O axe nos dois temas.
  - As teclas inteiras (Ruling 19) com a aba nova.
- **Windows (CI):**
  - Fumaça: um atalho de ramal mostra Livre e depois Ocupado com o registrador falso.
  - Ctrl + P abre o diálogo.
  - Desligar a rede do runner, se der, ou um gancho de teste para a conectividade, deixa a bolinha cinza, e ela volta verde.
- **Manual:** BLF e puxar ligação nos dois servidores reais, com três ramais.

## 11. Textos novos (para aprovar)

- **Atalhos:** "Atalhos", "Adicionar atalho", "<n> de 8", "Editar atalho", "Salvar atalho", "O que o atalho faz", "Ligar", "Transferir", "Transferir com consulta", "Enviar teclas", "Mostrar se o ramal está livre", "Livre", "Ocupado", "Tocando", "Desconectado", "O administrador não ligou o BLF", e as ajudas do canvas.
- **Administrador:** "Área do administrador", "Configurações da Starsonic para este computador.", "Senha incorreta.", "Sair da área do administrador", "BLF nos atalhos", "Puxar ligação pelo atalho", "Código para puxar a ligação", "Adicionar servidor", "Canal", "Teste", "Estável", e as ajudas do canvas.
- **Status:** "Sem internet · tentando de novo", "Não perturbe · as ligações não tocam".
- **Bipe:** "Bipe quando a ligação cai ou termina".

## 12. Riscos

| Risco | Tratamento |
|---|---|
| A senha do administrador ser descoberta no executável | Só o resumo fica no programa. O responsável sabe que é uma trava contra o uso comum, não contra quem analisa o programa. Depois pode virar uma senha por cliente, trocada na própria área. |
| Uma central sem o evento `dialog` | O atalho mostra "Desconectado". O resto funciona. |
| Muitas assinaturas | São 8 no máximo, só na conta em uso. |
| O Ctrl + P esperado para imprimir | O app não imprime nada. |
| O bipe atrapalhar uma ligação seguinte | Ele só toca quando não há outra ligação ativa. Com outra ligação ativa (a segunda que continua), não toca. |

## 13. Fora do escopo
- A gravação de chamadas (W2).
- BLF fora dos atalhos, como Contatos com presença, a não ser que o responsável peça.
- Atalhos por conta.
- Senha por cliente.

## Como ficou

O que mudou em relação ao texto acima durante a construção da 0.1.0-rc.3 (plano `docs/superpowers/plans/2026-10-22-windows-rc3-atalhos-blf-adm.md`), uma linha por item, com o motivo. O contrato da ponte é o `docs/ponte-windows.md`, e o roteiro manual são as seções 16 a 18 do `docs/teste-manual.md`.

### Decisões tomadas durante a construção

- **As abas no Compacto (3.1).** No Compacto, as quatro abas mostram o ícone e o rótulo, porque cabem. Só o Mínimo fica só com os ícones, como as outras abas já ficavam. A frase "a aba aparece só com o ícone" pensava no Mínimo, e uma aba diferente das outras confundia.
- **Os cartões (3.1).**
  - No Compacto e no Mínimo, o cartão fica sem o ícone da ação: a ação já está escrita na linha de baixo, e o nome precisa do espaço.
  - No Normal, a linha do BLF começa embaixo do ícone: a 380 px, "Desconectado" com o botão ⋯ não cabe na coluna do texto.
  - O teclado chega à edição pelo botão "Mais opções" (⋯) do cartão, com "Editar" e "Remover".
- **O painel da ligação (3.1 e 3.2).**
  - O botão Atalhos é mais um controle na grade da ligação. Ele fica travado enquanto chama e não aparece na consulta nem na conferência.
  - Com duas ligações, "Ligar" e "Transferir com consulta" ficam desativados no painel, porque fechavam o painel sem fazer nada.
  - Com só uma ligação tocando, sem atender, os cartões ficam desativados.
  - Fora da ligação, "Enviar teclas" fica desativado. Por isso, um atalho "Enviar teclas" de um ramal tocando (raro) não puxa a ligação fora dela.
- **A edição (3.3).**
  - A edição só fecha quando o programa confirma a gravação, para não perder o que foi digitado se a gravação for recusada.
  - O nome não aceita caractere de controle.
  - "Enviar teclas" manda só os dígitos de tom (`0-9`, `*` e `#`) e tira o `+`.
- **O BLF (4).**
  - **Vários diálogos.** O estado de um ramal junta todos os diálogos que a central manda: tocando se algum toca, senão ocupado se algum fala, senão livre. Com só o primeiro, um ramal ocupado com uma segunda ligação tocando aparecia ocupado, e o puxar não funcionava.
  - **Fora do padrão.** Um estado de diálogo fora da RFC conta como livre.
  - **Sem registro.** Enquanto a conta não está registrada, todo atalho com BLF mostra "Desconectado". O último estado que a central mandou fica guardado e volta com o registro, porque a central só avisa quando muda.
  - **A volta.** As assinaturas voltam no primeiro registro depois da volta da internet, e não só uma vez.
- **O código de puxar (4 e 6.2).** Aceita só dígitos, `*`, `#`, `+` e `{ramal}`. Todo `{ramal}` é trocado, e um código sem ele é discado como está.
- **O bipe (5).**
  - Toca uma vez quando a última ligação atendida termina, inclusive quando a internet cai no meio dela. Se duas terminam juntas, toca um bipe só.
  - O volume é o do bipe de espera.
- **A senha (6.1).**
  - A contagem dos 5 erros fica só na memória: abrir o app de novo zera a contagem.
  - Os 10 minutos sem uso contam a partir do último comando da área.
  - Ctrl + P vale também na tela Entrar. Durante a ligação, ele não abre nada, e uma ligação que chega fecha o diálogo.
- **Esconder os botões (6.2).** Esconder o Não perturbe ou o Atender automático desliga o recurso na hora e grava a mudança. Depois disso, o comando que o ligaria é recusado. Mostrar de novo não liga de volta.
- **Os servidores (6.2).**
  - A lista da área é a tabela de portas do perfil: o starcloud1 na 35060.
  - Um servidor fora da lista usa a porta de fábrica. A área mostra a linha fixa "Outros servidores · porta 5060" em vez de cadastrar o starcloud.
  - O endereço não aceita espaço, `:porta` nem repetidos.
  - Mudar a porta do servidor da conta em uso vale na hora: a conta registra de novo.
- **O canal (6.2).** O canal é "teste", "estavel" ou vazio, e vazio quer dizer o do build. Na área, o vazio aparece como Teste, o canal destes builds. Enquanto não existe versão estável, o canal Estável não oferece nada e não mostra erro.
- **A bolinha (7).**
  - "Sem conexão" (a central não responde) fica na linha do erro, em cinza e sem o triângulo, acima de "em ligação" e do Não perturbe.
  - O ícone da bandeja segue a mesma tabela. Sem internet, conectando, no erro ou sem conexão, ele mostra o de sem conexão, que também vence a perdida e o Não perturbe. A perdida volta com a conexão.
- **A internet (8).**
  - **Por que mudou.** O "sem internet" do Windows, sozinho, não tira o app do ar. Atrás de proxy ou firewall de empresa, e em portais, o Windows diz "sem internet" com o SIP funcionando. Os usuários são as empresas clientes.
  - **Quando o Windows diz que não há rede nenhuma** (cabo fora, Wi-Fi desligado):
    - a bolinha fica cinza com "Sem internet · tentando de novo";
    - o motor para de tentar registrar;
    - o motor não manda mais o "sair" (REGISTER com Expires 0) para a central: se a rede estiver de fato fora, ele não chega, e, se o aviso for falso, tiraria o ramal do ar à toa. O registro fica na central e vence sozinho numa queda de verdade; com um aviso falso, o ramal continua recebendo.
  - **O DNS do servidor da conta** é testado a cada 30 s, sem o cache do Windows. Um "nome não existe" conta como resposta.
  - **Quando o DNS falha duas vezes seguidas:** só conta com a conta sem registro, e só muda a bolinha. O motor continua como estava.
  - **Com o ramal conectado,** o DNS nunca tira o app do ar. Numa queda só do DNS, a central e a internet continuam de pé, e o endereço da central fica em cache por até 4 h. Na rc.2 o ramal seguia tocando nesse caso, e continua seguindo.
  - **Quando o DNS volta a responder ou a conta conecta:** volta o verde. Se o ramal não estava registrado, ele registra na hora.
  - **O "sem internet" do Windows com rede local:** só faz o teste rodar na hora.
  - **Servidor dado por IP:** só vale o aviso do Windows.
  - **A conectividade do Windows:** é lida de novo a cada 30 s, além dos avisos dele, para o app nunca ficar preso em "Sem internet" com a rede de volta.
  - **Um teste de DNS que não responde:** depois de dois intervalos, conta como perdido.
  - **Na fumaça do CI:** um gancho que só existe no build de teste força a visão da internet, e uma sessão usa o servidor por nome (o arquivo hosts do runner).
- **O BLF depois de perder o registro (4).** Quando a conta perde o registro sem a internet cair (um 503 no refresh, uma central reiniciada), as assinaturas de antes são refeitas no registro seguinte. Sem isso, um atalho podia mostrar um estado velho por até 10 minutos.
- **O puxar na ajuda (4).** A frase "Num ramal tocando, o clique puxa a ligação." só aparece na aba quando o puxar está de fato ligado: o BLF e o puxar ligados, com o código preenchido. A ponte manda isso como `admin.puxa`, também com a área fechada. Sem isso, com o BLF ligado e o puxar desligado, a ajuda prometia puxar a ligação, e um clique num atalho Transferir de um ramal tocando transferia a ligação do cliente.
- **Remover servidor (6.2)** pergunta antes, como os contatos, as contas e os atalhos. Um deslize no starcloud1 fazia a conta registrar na porta 5060 e parar de receber.
- **O foco.** Ao abrir a edição, a área do administrador ou o formulário de servidor, o foco vai para o primeiro campo ou para o título. Ao fechar, ele volta para quem abriu.
- **A barra de título na ligação.** Com uma mensagem de cadastro longa, o texto encolhe com reticências, e Minimizar e Fechar continuam na janela.
- **Diferenças do canvas sem ruling próprio:**
  - a grade de uma ligação tem quatro colunas, com o controle Atalhos;
  - a edição e a área do administrador usam a barra escura do app, os títulos acima dos cartões e as chaves ciano das Configurações;
  - as Configurações mantêm as ajudas de hoje para Iniciar com o Windows e Atender automaticamente.
- **Os testes da senha (10).**
  - Os testes usam uma senha descartável, com sal e chave próprios.
  - Os testes que conferem o resumo embutido contra a senha de verdade só rodam com `STARSONIC_ADMIN_PASSWORD` no ambiente. Não há secret no CI, então lá eles ficam de fora.
  - A fumaça entra na área por um substituto que só existe no build de teste (`STARSONIC_SENHA_ADMIN_TESTE`). O exe de release não tem esse nome, e o build confere isso.

### Textos novos fora da seção 11 (para aprovar)

**Do canvas** (as ajudas que a seção 11 cita sem escrever):
- "Clique para usar. Clique com o botão direito para editar. Num ramal tocando, o clique puxa a ligação." (a última frase só com o puxar ligado)
- **A linha de baixo do cartão:** "Ligar · <n>", "Transferir · <n>", "Consulta · <n>", "Enviar teclas · <n>".
- **O painel da ligação:** "Nova ligação para <n>", "Transferir para <n>", "Consulta com <n>", "Enviar as teclas <n>", "Fechar atalhos".
- **As ajudas das ações:** "Liga para o número.", "Durante a ligação, passa direto para o número.", "Fala antes com o número e depois passa a ligação.", "Durante a ligação, digita o número (ex.: *88)."
- **A chave do BLF:** "Livre, ocupado ou tocando (BLF)."
- **A área do administrador:**
  - "Starsonic Phone · Administrador", "Starsonic", "Botões da tela principal", "Atalhos", "Servidores", "Atualizações".
  - "Desligado: o botão some e ninguém liga o Não perturbe.", "Desligado: o botão some da tela principal."
  - "Mostra se cada ramal está livre, ocupado ou tocando. O servidor precisa ter o BLF ligado."
  - "Clicar num ramal tocando atende a ligação dele."
  - "Depende da central do cliente. {ramal} vira o número do ramal que está tocando (ex.: **2007 ou *8)."
  - "Porta <p> · UDP e TCP", "Editar".
- **O bipe:** "Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai."

**Novos** (nem na seção 11 nem no canvas):
- "Muitas tentativas. Tente de novo em <n> s."
- "Outros servidores · porta 5060"
- **Remover:** "Remover atalho", "<nome> sai da lista de atalhos.", "Remover servidor", "<endereço> sai da lista de servidores.", "Remover".
- **O menu do cartão:** "Mais opções para <nome>", "Mais opções", "Opções de <nome>", "Editar", "Remover".
- **O servidor:** "Endereço", "Porta", "Salvar servidor", "Cancelar", "Editar o servidor <endereço>".
- **Os avisos da gravação:** "Digite o nome do atalho.", "Digite o número do atalho."
- **Palavras da seção 11 num lugar novo:** "Atalhos" no botão da tela da ligação, e "Adicionar atalho" como título da edição de um atalho novo.
