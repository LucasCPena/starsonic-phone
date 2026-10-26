# Starsonic Phone para Android: o visual do Windows, Não perturbe, Atender automático, Rediscar, bolinha e bipe (especificação de design)

- **Data:** 26/10/2026
- **Status:** desenho aprovado pelo responsável em 26/10/2026 ("pode continuar"), no chat e no canvas "Starsonic Phone Android — visual do Windows e funções novas" (claude.ai, 19 quadros). Esta spec aguarda a revisão escrita.
- **Versão alvo:** `android-v0.2.0-rc.2` (canal de teste do Android).
- **Base:** o Android 0.2.0-rc.1 (`2026-10-16-starsonic-phone-android-0.2-design.md`) e o app do Windows na 0.1.0-rc.3 (`2026-10-21-starsonic-phone-windows-w1-design.md` e `2026-10-22-starsonic-phone-windows-w3-atalhos-blf-adm-design.md`), que é a referência do visual e das funções.

## 1. Objetivo

O responsável pediu:

> agora oq vc fez no PC/windows, faça para o Android, porem não adicione a parte de atalhos e nem a parte de administrador, deixe as funções liberadas

> mude também o visual do androide deixe igual ao windows

Isso dá seis mudanças:

1. O visual do app do Windows em todas as telas do Android, nos temas claro e escuro.
2. Não perturbe, no cabeçalho.
3. Atender automático, no cabeçalho, com o tempo em Configurações.
4. Rediscar, à esquerda do Ligar.
5. A bolinha de status colorida, com a notificação fixa acompanhando.
6. O bipe no fim da ligação, com a chave em Configurações.

## 2. Decisões do responsável (26/10/2026)

- **As funções que vêm do Windows:** Não perturbe, Atender automático, Rediscar, a bolinha de status e o bipe no fim da ligação. Ele escolheu as quatro opções que mostrei.
- **Não vêm:**
  - os atalhos e, com eles, o BLF e o puxar ligação, que moram nos atalhos;
  - a área do administrador.
- **"Funções liberadas":** o que no Windows o administrador controla fica sempre disponível no Android.
  - Os botões Não perturbe e Atender automático ficam sempre à mostra.
  - Os servidores e as portas seguem o perfil da Starsonic (`perfil.ini`).
  - O canal de atualização é o da versão instalada.
- **O visual:** "igual ao Windows", como no canvas aprovado.

## 3. O visual

### 3.1 A base

- **Tokens:** os mesmos do app do Windows (`windows/ui/src/app.css`), que são os do design system Starsonic, com valores exatos:
  - `cyan` `#00c2cb` (ação), `on-cyan` `#03222a`, `blue` `#0c2671`;
  - `ink`, `muted`, `line`, `soft`;
  - `navy-950` a `navy-800`, o `gradient-hero` e `danger` `#d64545`;
  - o verde da bolinha, `#22c55e` (o mesmo do Windows, pedido do responsável na rc.2).
- **Temas:**
  - Claro e escuro seguem o modo do celular, com os mesmos papéis do Windows: `surface`, `card`, `border`, `text-strong`, `text`, `text-muted`, `icon`, `key` e `field`.
  - A ligação e a recebida são sempre escuras.
- **Fonte:** Plus Jakarta Sans, a mesma do Windows (licença OFL), embutida no app nos pesos 400 a 800.
- **Logo:**
  - o negativo no cabeçalho e nas barras escuras;
  - o principal no Sobre do tema claro.
- **Ícones:** os de linha do Windows, com traço de 2 px e as pontas redondas.

### 3.2 Os componentes (os do Windows)

- **Cabeçalho da marca:** o gradiente escuro com o brilho ciano no canto, o logo e o botão de menu à direita. Embaixo:
  - o cartão da conta: a bolinha, o ramal e a linha de status;
  - as duas pílulas, "Não perturbe" e "Atender automático". Ligadas, ficam em ciano com o texto escuro.
- **Teclado:**
  - O número fica em 30 px, com o Apagar.
  - A sugestão de contato aparece no fundo ciano claro.
  - As 12 teclas são quadradas com cantos de 18 px e as letras embaixo.
  - Na última linha ficam o Rediscar, redondo e com contorno, e o Ligar, uma pílula ciano.
- **Navegação de baixo:** Teclado, Recentes e Contatos. A aba ativa fica numa pílula ciano clara.
- **Listas:**
  - as linhas com o ícone num quadrado (a perdida em vermelho claro), o nome, a linha de baixo e o botão de ligar redondo;
  - os grupos ("Hoje", "Ontem", as letras);
  - os filtros em pílula.
- **Telas de dentro** (Configurações, Sobre, Permissões):
  - a barra escura com o Voltar e o título;
  - o rótulo da seção em maiúsculas com o traço ciano;
  - cartões com linhas e as chaves ciano.
- **Ligação:**
  - o fundo escuro;
  - o avatar com as iniciais, o nome, a linha de baixo e o tempo em ciano;
  - os controles redondos em grade de 3 (o ligado em ciano) e o Desligar vermelho.
- **Recebida:** o mesmo fundo, com o Recusar vermelho e o Atender ciano.

### 3.3 O que é do Android

- **De ponta a ponta:** o cabeçalho e as barras escuras começam por baixo da barra de status do Android. O respiro de cima é o tamanho dela. A navegação de baixo deixa o respiro da barra de gestos.
- **Toque:** todo controle tem pelo menos 48 dp de área de toque. As pílulas do cabeçalho podem parecer menores, mas a área de toque é de 48 dp.
- **Continua igual:**
  - a tecla Voltar do celular;
  - a ligação em tela cheia com o celular bloqueado;
  - as notificações do Android;
  - a tela de Permissões e o passo a passo dos fabricantes, agora no visual novo;
  - o tamanho da letra do celular, com as telas rolando onde não cabem.
- **O menu do cabeçalho** abre com Configurações e Sobre. "Editar conta" e "Sair da conta" passam para Configurações → Conta.

### 3.4 As telas (os quadros do canvas)

| Tela | O que muda |
|---|---|
| Teclado | O cabeçalho novo, Rediscar e Ligar em ciano. |
| Recentes | O cabeçalho novo, os filtros "Todas" e "Perdidas · <n>", e as linhas com o ícone do tipo. |
| Contatos | O cabeçalho novo, a busca em pílula e as linhas com o avatar. |
| Configurações | Tela nova (seção 8). |
| Sobre | A barra escura, o logo (principal no claro e negativo no escuro), a versão, a licença, os contatos da Starsonic e "Enviar diagnóstico". |
| Entrar | O cabeçalho escuro com "Ramal no celular" e "Entre com o seu ramal", e os campos de hoje (Servidor, Protocolo, Ramal, Senha) no visual novo. |
| Permissões | A barra escura, os quatro avisos com "Permitir" (ou o sinal de feito) e o cartão do fabricante com "Abrir ajustes". |
| Ligação, duas ligações, consulta, conferência | O fundo escuro e os controles redondos. No alto, a linha de status (seção 7). |
| Recebida (tela cheia) | O fundo escuro, Recusar e Atender. Com o Atender automático ligado, a linha "Atender automático · em <n> s". |

## 4. Não perturbe

- **O botão:** a pílula "Não perturbe" no cabeçalho liga e desliga. Ligado, fica em ciano.
- **Ligado:**
  - Quem liga ouve ocupado (486). O app não toca e não abre a tela cheia.
  - A ligação vai ao Recentes como perdida.
  - O aviso "Ligação perdida de …" aparece sem som e sem vibrar, num canal de notificação próprio.
  - As ligações feitas funcionam normalmente.
- **Uma ligação que já toca** continua tocando: o Não perturbe vale para as próximas.
- **Fica gravado:** fechar o app ou reiniciar o celular não desliga o Não perturbe.
- **A bolinha e a notificação fixa** mudam (seção 7).

## 5. Atender automático

- **O botão:** a pílula "Atender automático" no cabeçalho liga e desliga. A mesma chave aparece em Configurações → Ligações ("Atender automaticamente").
- **Ligado:** depois do tempo escolhido tocando, o app atende sozinho, no caminho de áudio de sempre (fone, headset ou Bluetooth).
- **O tempo:** "Tempo para atender", com as opções do Windows: Na hora, 1, 2, 3, 5, 8, 10, 15, 20 e 30 s. O de fábrica é 3 s.
- **Na recebida:** com o Atender automático ligado, a tela cheia e a notificação mostram "Atender automático · em <n> s".
- **Não atende sozinho:**
  - uma segunda ligação enquanto há outra: ela toca normalmente;
  - com o Não perturbe ligado: vale o Não perturbe;
  - com uma ligação da operadora em andamento.
- **Fica gravado.**

## 6. Rediscar

- **O botão:** redondo, à esquerda do Ligar.
- **O que faz:** liga para a ligação feita mais nova do Recentes, pelo mesmo caminho do botão de ligar da linha do Recentes.
- **O nome dele:** "Rediscar <número> · <nome>" para o leitor de tela e no aperto longo (a dica do Android). Sem contato, só "Rediscar <número>".
- **Sem nenhuma ligação feita:** fica apagado e diz "Rediscar".
- **Durante a ligação:** também no painel Nova ligação, como no Windows. Não aparece no teclado dos tons.

## 7. A bolinha e a notificação fixa

A tabela é a mesma do Windows. A ordem é a prioridade: vale a primeira linha que bate.

| Situação | Bolinha | Texto no cartão da conta | Título da notificação fixa |
|---|---|---|---|
| Sem internet | cinza | `Sem internet · tentando de novo` | `Sem internet · tentando de novo` |
| Conectando | ciano | `Conectando…` | `Conectando…` |
| Erro no cadastro | cinza + triângulo de aviso | o texto de erro de hoje (o do núcleo) | o mesmo texto |
| Em ligação (inclusive tocando) | vermelha | `Ocupado · em ligação` | `Ocupado · em ligação` |
| Não perturbe ligado | vermelha | `Não perturbe · as ligações não tocam` | `Não perturbe (ramal <ramal>)` |
| Conectado | verde | `Conectado · <servidor>` | `Conectado (ramal <ramal>)` |

- **"Sem conexão"** (a central não responde) fica na linha do erro, cinza e sem o triângulo, como no Windows.
- **Em ligação:** a linha de status aparece no alto da tela da ligação ("● Ocupado · em ligação" e o ramal), porque o cabeçalho fica escondido.
- **A internet:** "Sem internet" continua sendo "o celular sem rede nenhuma", como no Android 0.2, que já acompanha a rede padrão do celular.
  - O app não usa a verificação de internet do Android (a "rede validada"). Ela diz "sem internet" atrás de proxy, firewall e portal, mesmo com o SIP funcionando, o mesmo motivo do Ruling 16 do Windows.
  - O Android não ganha o teste de DNS do Windows.
  - Quando a rede volta, o registro é refeito na hora, como hoje.

## 8. Configurações (tela nova)

Ela abre pelo menu do cabeçalho e tem três partes:

1. **Conta:**
   - a bolinha, o ramal e "servidor · protocolo";
   - o botão de editar, que abre o Entrar preenchido, como o "Editar conta" de hoje;
   - "Sair da conta", com a confirmação de hoje e a ajuda "O celular deixa de receber as ligações do ramal.".
2. **Ligações:**
   - "Bipe quando a ligação cai ou termina", ligado de fábrica;
   - "Atender automaticamente", com a linha de baixo "Depois de <n> segundos tocando";
   - "Tempo para atender".
3. **Celular:** "Permissões e bateria", que abre a tela de Permissões de hoje.

Tudo é gravado no celular, no armazenamento privado do app, separado do armazenamento da conta, que o "Sair da conta" apaga.

## 9. O bipe no fim da ligação

- **Quando toca:** quando uma ligação atendida termina, por qualquer motivo:
  - a outra pessoa desligou;
  - a ligação caiu;
  - a própria pessoa desligou.
- **O som:** 425 Hz por 0,25 s, duas vezes, com 0,15 s de intervalo.
- **Onde toca:** no caminho de áudio da ligação (fone do celular, headset ou Bluetooth), antes de o Android fechar o áudio dela. Não toca no alto-falante de toque.
- **Não toca:**
  - para uma ligação recusada, perdida ou que não completou;
  - quando sobra outra ligação: só toca quando a última atendida termina;
  - com a chave desligada.

## 10. Textos novos (para aprovar)

- **Cabeçalho e bolinha:** "Não perturbe", "Atender automático", "Não perturbe · as ligações não tocam", "Sem internet · tentando de novo", "Ocupado · em ligação", "Não perturbe (ramal <ramal>)".
- **Teclado:** "Rediscar", "Rediscar <número> · <nome>".
- **Menu e Configurações:**
  - "Configurações", "Conta", "Ligações", "Celular";
  - "O celular deixa de receber as ligações do ramal.";
  - "Bipe quando a ligação cai ou termina", "Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai.";
  - "Atender automaticamente", "Depois de <n> segundos tocando", "Tempo para atender", "Na hora", "<n> s";
  - "Permissões e bateria", "Notificações, microfone e o uso da bateria, para as ligações chegarem com a tela apagada".
- **Entrar:** "Ramal no celular", "Entre com o seu ramal".
- **Permissões:** "Para as ligações chegarem".
- **Ligação e recebida:**
  - "Ligação recebida · <ramal>", "Atender automático · em <n> s";
  - "Duas ligações", "Ativa", "Em espera".

Os textos que já existem ficam como estão.

## 11. Testes

- **Automáticos, JVM** (os de hoje, em `android/app/src/test`):
  - a tabela da bolinha, nas seis linhas e nos empates;
  - o Não perturbe: ocupado, perdida sem som, a que já toca continua, e a gravação;
  - o Atender automático: o tempo, a segunda ligação, o Não perturbe vencendo, a ligação da operadora e a gravação;
  - o Rediscar: a feita mais nova, sem nenhuma, e o número como foi discado;
  - o bipe: atendida, recusada, perdida, outra que sobra e a chave;
  - as Configurações gravadas, e que continuam depois do "Sair da conta".
- **Automáticos, emulador** (os testes de tela de hoje, em `android/app/src/androidTest`):
  - cada tela nos dois temas;
  - as pílulas do cabeçalho;
  - o Rediscar;
  - Configurações;
  - a bolinha nos seis estados;
  - a recebida com o Atender automático.
- **Manual** (`docs/teste-manual-android.md`, linhas novas):
  - o visual comparado ao canvas, nos dois temas e com a letra grande;
  - o Não perturbe e o Atender automático com ligações de verdade, com a tela apagada e o app fechado;
  - o bipe no fone, no headset e no Bluetooth;
  - o Rediscar;
  - a bolinha e a notificação fixa.

## 12. Riscos

| Risco | Tratamento |
|---|---|
| O Android 14 ou mais novo limita o microfone de um serviço que começa sem toque da pessoa, e isso pode afetar o Atender automático com o app fechado. | O app já é um serviço de ligações (Telecom, `phoneCall`). Testar no emulador e no manual com a tela apagada. Se o Android não deixar, o Atender automático vale só com o app aberto, e a spec ganha a nota. |
| O bipe tocar depois que o Android já fechou o áudio da ligação e sair no alto-falante. | Tocar antes de encerrar a ligação no Telecom, e conferir no manual (fone, headset, Bluetooth). |
| A fonte embutida aumentar o APK. | Um arquivo só, de pesos variáveis (uns 100 KB). |
| As pessoas estranharem o Ligar em ciano em vez de verde. | É a cor do Windows e da marca para a ação, pedida pelo responsável ("igual ao Windows"). |
| O tema escuro de algum fabricante forçar cores. | O app desliga o escurecimento forçado e usa os seus dois temas. |

## 13. Fora do escopo

- Os atalhos, o BLF, o puxar ligação e a área do administrador.
- A troca de canal de atualização no app.
- Duas contas: o Android continua com uma conta.
- O teste de DNS do Windows.
- O que é só do PC: a janela que muda de tamanho, os três layouts do Windows e o ícone da bandeja.
