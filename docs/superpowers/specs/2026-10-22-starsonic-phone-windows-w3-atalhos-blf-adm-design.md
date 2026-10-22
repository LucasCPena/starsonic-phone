# Starsonic Phone para Windows: atalhos com BLF, área do administrador, bipe e status (especificação de design)

- **Data:** 22/10/2026
- **Status:** desenho aprovado pelo responsável em 22/10/2026, no chat e no canvas "Starsonic Phone Windows — atalhos, administrador e status" (claude.ai, 7 quadros). Esta spec aguarda a revisão escrita.
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
