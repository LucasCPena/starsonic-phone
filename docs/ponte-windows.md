# Ponte do app de PC — protocolo v1

O contrato entre a interface (TypeScript + Preact, no WebView2: `windows/ui`) e o C++ do app de PC
(`starsonic/desktop/DesktopApp`). O C++ lê e escreve as mensagens em `starsonic/desktop/Protocol.cpp`; os testes
estão em `tests/desktop/test_protocol.cpp` e `tests/desktop/test_desktop_app.cpp`. Uma mudança no formato muda este
documento, o `Protocol.cpp` e os testes juntos.

A interface só desenha: todas as regras (ligações, contas, Recentes, validações da tela Entrar) ficam no C++. A
interface recebe o estado pronto e manda comandos. Uma interface que discorde do C++ é um erro da interface.

## Visão geral

- Interface → C++: `window.chrome.webview.postMessage({v: 1, cmd: "<comando>", ...campos})`. Os campos ficam no
  mesmo objeto do `cmd`.
- C++ → interface: quatro mensagens, sempre com `v: 1`:
  - `{"v":1,"type":"state","state":{...}}` — o estado inteiro, a cada mudança (só quando muda);
  - `{"v":1,"type":"toast","texto":"..."}` — um aviso de 2 s;
  - `{"v":1,"type":"ring","tipo":"completo"|"espera"|"parar"|"fim"}` — o toque (`fim`, rc.3: o bipe do fim da
    ligação, uma vez);
  - `{"v":1,"type":"update","versao":"...","notas":"..."}` — a pergunta da atualização (ver "Atualização").
- Ao carregar (e a cada recarga), a interface manda `{"v":1,"cmd":"ready"}` e recebe o estado atual e o toque atual
  (nesta ordem), também com uma ligação que já tocava antes de a página carregar, e depois a pergunta da atualização,
  se há uma aberta.
- Os textos são UTF-8. Os tempos são milissegundos desde 1970 (como o `Date.now()` do JavaScript).

## Versão

- `v` é a versão do formato: hoje `1`. Ela muda quando o formato deixa de ser compatível (um campo some, muda de tipo
  ou de sentido). Acrescentar um campo novo ao estado ou um comando novo não muda a versão.
- O C++ ignora qualquer comando com `v` diferente de `1` (com uma linha no diagnóstico). A interface ignora mensagens
  com `v` diferente de `1` e mostra "Reinstale o Starsonic Phone." (não deve acontecer: as duas vão no mesmo
  executável).

## Comandos (interface → C++)

Regras para todos:

- Comando desconhecido, campo obrigatório que falta ou campo com o tipo errado: o comando é ignorado inteiro, com uma
  linha no diagnóstico (`comando ignorado: ...`). Campos a mais são ignorados.
- Os comandos rodam na ordem em que foram mandados, um por vez, numa thread do C++ (nunca na da interface): um
  comando nunca trava a janela.
- Depois de `quit`, todo comando (menos `ready`) é ignorado.
- "texto" é string JSON; "booleano" é `true`/`false` (não `0`/`1`, nem `"true"`); "inteiro" é número sem fração.

### Interface e janela

| Comando | Campos | O que faz |
|---|---|---|
| `ready` | — | A interface carregou: o C++ manda o estado e o toque de agora. Vai ao diagnóstico como `interface pronta`. |
| `minimize` | — | Minimiza a janela. |
| `closeToTray` | — | O "fechar" da barra de título: a janela se esconde na bandeja (o app continua recebendo ligações: a interface continua rodando e toca; com uma ligação tocando, o aviso do canto aparece). |
| `resize` | `borda` (texto: `cima`, `cima-esquerda`, `cima-direita` ou `baixo-direita`) | (rc.2) O botão esquerdo apertado numa zona de redimensionar da interface: a faixa de cima (5 px, sem passar por cima de Minimizar e Fechar), os cantos de cima e o canto de baixo à direita (16×16, em cima do desenho do canto). O WebView2 cobre essas bordas (as dos lados e a de baixo são do Windows, fora da área da interface): o executável começa o redimensionar do Windows por aquela borda, como se a pessoa tivesse pegado a borda da janela. Outra `borda` é recusada. Com o botão já solto quando o comando chega (um clique rápido), ou com a janela maximizada ou minimizada, nada acontece. Vai ao diagnóstico como `redimensionar: <borda>`. |
| `quit` | — | Sair: as ligações de agora acabam (e vão aos Recentes) e o app fecha. Uma troca de conta que esperava o fim da ligação não registra, mas a conta escolhida fica em uso na próxima abertura (menos uma conta sem a senha: a em uso continua); um Entrar que esperava é descartado. |
| `sendDiagnostics` | — | "Enviar diagnóstico": o app copia o `diagnostico.log` (com o `.1` antes, se houver) para `%TEMP%\Starsonic Phone diagnostico <data e hora>.log` e abre o Explorer com a cópia selecionada, para a pessoa anexar no e-mail ou no WhatsApp. O `diagnostico.log` nunca tem senhas nem o valor dos cabeçalhos `Authorization` e `Proxy-Authorization` das mensagens SIP (`Authorization: <oculto>`). |
| `updateNow` | — | A resposta "Atualizar agora" à pergunta da atualização aberta. Sem pergunta aberta: ignorado (linha no diagnóstico). |
| `updateLater` | — | A resposta "Depois" (o botão ou o Esc). Sem pergunta aberta: ignorado. |
| `openExternal` | `url` (texto) | Abre no navegador padrão. Só valem exatamente: `https://starsonic.com.br`, `https://starsonic.com.br/`, `https://wa.me/551150603000` e `https://github.com/LucasCPena/starsonic-phone` (o código-fonte). Qualquer outro é recusado (linha no diagnóstico), também um `tel:`: o app é o tratador dele (o instalador o registra), e o link só encheria o Teclado. |

```json
{"v":1,"cmd":"openExternal","url":"https://wa.me/551150603000"}
```

### Entrar e contas

| Comando | Campos | O que faz |
|---|---|---|
| `login` | `servidor` (texto), `protocolo` (`"udp"` \| `"tcp"`), `ramal` (texto), `senha` (texto), `nome` (texto, opcional), `contaId` (texto, opcional) | O botão Entrar (também em Adicionar conta e Editar). Ver "O Entrar", abaixo. |
| `selectAccount` | `contaId` (texto) | Troca a conta em uso (o cabeçalho). Com uma ligação, a troca fica para o fim dela, com o toast `A troca de conta fica para o fim da ligação.`; uma nova escolha toma o lugar da que esperava; escolher a conta em uso cancela a que esperava. Para uma conta sem a senha (`pedeSenha`), nada muda ainda: a conta em uso continua registrada e gravada, e `tela` vira `entrar` pedindo a senha da escolhida, com `entrar.podeCancelar` `true`; o `login` dela (com o `contaId`) faz a troca quando registra, e com a senha errada a conta em uso volta a registrar e a tela continua pedindo a senha. |
| `cancelLogin` | — | O Cancelar da tela Entrar com `entrar.podeCancelar`: a troca sai e a conta em uso continua (`tela` `principal`). Sem uma troca pedindo a senha, ou com o Entrar dela esperando o resultado: ignorado (linha no diagnóstico). |
| `removeAccount` | `contaId` (texto) | Remove a conta (a interface pede a confirmação antes). Não vale para a conta em uso com uma ligação (ignorado). A em uso removida dá a vez para a primeira das outras; sem nenhuma, a tela Entrar. |

O Entrar (spec do Windows, 7.1 e 11.1):

1. Os campos são conferidos nesta ordem; o primeiro problema vai em `entrar.erro` e nada registra:
   - servidor vazio → `Digite o endereço do servidor.`;
   - servidor fora da regra (espaço, porta, `@`, `/`, acento etc.) → `Digite só o endereço do servidor, como starcloud1-starsonic.com.br.`;
   - ramal vazio ou com espaço, `@` ou `:` → `Digite só o número do ramal.`;
   - senha vazia → `Digite a senha.` — menos ao editar (`contaId` de uma conta com senha gravada): vazia, a senha
     continua a gravada.
2. Passou: `entrar.ocupado` fica `true` (a interface mostra "Conectando…" e trava os campos) e a conta registra. Com
   uma ligação, o registro espera o fim dela (com o mesmo toast da troca de conta).
3. Registrou (em até 15 s): a conta é gravada e fica em uso; `entrar` volta ao vazio (`ocupado` `false`, `erro` `""`)
   e `tela` é `principal`. A interface fecha o formulário quando vê `ocupado` passar de `true` para `false` com
   `erro` vazio.
4. Falhou ou o tempo acabou: nada é gravado, a conta de antes volta a registrar (se havia), `ocupado` volta a
   `false` e `erro` traz a mensagem do registro: `Ramal ou senha incorretos.` (401, 403, 407), `Ramal não
   encontrado neste servidor.` (404), `Não foi possível falar com o servidor. Confira o endereço e a sua internet.`
   (sem resposta, 408, 5xx, tempo esgotado) ou `Não foi possível entrar (código <n>). Fale com o suporte da
   Starsonic.`. Os campos digitados continuam em `entrar` (menos a senha, que nunca vem no estado).
5. Sem `contaId` (ou com um que não existe mais) é uma conta nova. Um `login` com outro Entrar esperando é ignorado.

```json
{"v":1,"cmd":"login","servidor":"starcloud1-starsonic.com.br","protocolo":"udp","ramal":"2001","senha":"...","nome":"Recepção"}
{"v":1,"cmd":"login","servidor":"starcloud1-starsonic.com.br","protocolo":"tcp","ramal":"2001","senha":"","nome":"Recepção","contaId":"9f3c2a71b0d84e55"}
{"v":1,"cmd":"selectAccount","contaId":"9f3c2a71b0d84e55"}
{"v":1,"cmd":"removeAccount","contaId":"9f3c2a71b0d84e55"}
{"v":1,"cmd":"cancelLogin"}
```

### Ligações

| Comando | Campos | O que faz |
|---|---|---|
| `dial` | `numero` (texto), `contato` (booleano, opcional) | Liga (o Teclado, os Recentes, os contatos). Sem ligação, ou com uma em andamento (a Nova ligação: a outra vai para a espera). Com `contato: true`, o número de um contato passa antes pela regra dos contatos do perfil (o `+55` sai e o prefixo de saída entra nos números longos). Sem registro, o toast `Sem conexão com o servidor. Tente de novo em instantes.` e nada é discado. |
| `answer` | — | Atende a recebida que toca (a outra vai para a espera). |
| `reject` | — | Recusa a recebida que toca (ocupado; vai aos Recentes como perdida). |
| `hangup` | `id` (inteiro ≥ 0, opcional) | O Desligar de um cartão. **A interface manda sempre o `id` do cartão quando ele tem um** (`top.id` ou `second.id` maior que 0); `id: 0` só para o cartão de uma feita que ainda não tem id (o C++ entende `0` como "a feita mais nova"). Sem `id`: a ligação ativa. Na conferência, qualquer id desliga as duas ("Desligar para todos"). |
| `hold` | `on` (booleano, opcional) | Espera: `true` põe, `false` retoma, sem `on` troca. Com duas em andamento, pôr a ativa em espera é o Alternar. Na conferência, nada. |
| `mute` | `on` (booleano, opcional) | Mudo do microfone (vale para as duas ligações); sem `on`, troca. |
| `dtmf` | `digitos` (texto) | Manda os dígitos (`0-9`, `*`, `#`) na ligação ativa. |
| `transfer` | `numero` (texto) | "Transferir agora" (sem consulta). Se a central recusa, o toast `O servidor não aceitou a transferência.`. |
| `consult` | `numero` (texto) | "Consultar": liga para o colega como a Nova ligação, marcada como consulta. |
| `completeTransfer` | — | "Concluir transferência" (com o colega atendido). |
| `cancelConsult` | — | "Cancelar" a consulta: o colega sai e o cliente volta. |
| `swap` | — | "Alternar" entre as duas ligações (também entre o cliente e o colega na consulta). |
| `join` | — | "Juntar": as duas em conferência. |
| `split` | — | "Separar": a última que entrou vai para a espera. |

```json
{"v":1,"cmd":"dial","numero":"2003"}
{"v":1,"cmd":"dial","numero":"+55 11 5060-3000","contato":true}
{"v":1,"cmd":"hangup","id":12}
{"v":1,"cmd":"hangup","id":0}
{"v":1,"cmd":"hold","on":true}
{"v":1,"cmd":"mute"}
{"v":1,"cmd":"dtmf","digitos":"1#"}
{"v":1,"cmd":"transfer","numero":"2004"}
{"v":1,"cmd":"consult","numero":"2004"}
{"v":1,"cmd":"completeTransfer"}
```

### Não perturbe, Atender automático, configurações

| Comando | Campos | O que faz |
|---|---|---|
| `setDnd` | `on` (booleano) | Não perturbe (gravado no `config.json`: continua depois de fechar o app). Toda recebida leva ocupado, não toca e vai aos Recentes como perdida. (rc.3) Com o botão escondido pelo administrador (`admin.naoPerturbe` `false`), `on: true` é recusado (linha no diagnóstico: `setDnd recusado`). |
| `setAutoAnswer` | `on` (booleano), `segundos` (inteiro ≥ 0, opcional) | Atender automático e o tempo (de 0 a 30; acima de 30 vale 30; sem `segundos`, fica o de agora). Gravado no `config.json`. (rc.3) Com ele escondido pelo administrador (`admin.atenderAuto` `false`), `on: true` é recusado inteiro (linha no diagnóstico: `setAutoAnswer recusado`). |
| `setAudio` | `microfone` (texto, opcional), `altoFalante` (texto, opcional), `toque` (texto, opcional) | A escolha de som. `microfone` e `altoFalante` são o **nome** do dispositivo (o `nome` de `audio.microfones`/`audio.altoFalantes`; `""` = o padrão do Windows). `toque` é o `deviceId` do dispositivo de saída da própria interface (o `setSinkId`; `""` = o padrão). O campo ausente fica como está. |
| `setSetting` | `chave` (texto), `valor` | `chave: "iniciarComWindows"` ou (rc.3) `chave: "bipeFim"` ("Bipe quando a ligação cai ou termina", em Configurações → Ligações; gravado no `config.json` como `bipe_fim`, ligado de fábrica), com `valor` booleano. Outra chave: ignorado. |

```json
{"v":1,"cmd":"setDnd","on":true}
{"v":1,"cmd":"setAutoAnswer","on":true,"segundos":5}
{"v":1,"cmd":"setAudio","microfone":"Headset USB","altoFalante":"","toque":"default"}
{"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false}
{"v":1,"cmd":"setSetting","chave":"bipeFim","valor":false}
```

### Atalhos (rc.3)

Até 8 atalhos, gravados no `atalhos.json` (por computador, os mesmos para todas as contas). Qualquer pessoa configura
os atalhos (não precisa da área do administrador).

| Comando | Campos | O que faz |
|---|---|---|
| `saveShortcut` | `id` (texto, opcional), `nome` (texto), `numero` (texto), `acao` (`"ligar"` \| `"transferir"` \| `"consulta"` \| `"teclas"`), `blf` (booleano) | Novo atalho (sem `id`) ou a edição de um. `blf` é a chave "Mostrar se o ramal está livre" (fica gravada mesmo com o BLF do administrador desligado; só vale com ele ligado). Recusado pela loja (o 9º atalho, nome vazio ou com mais de 24 caracteres, número vazio, com mais de 32 caracteres ou com algo além de dígitos, `*`, `#` e `+`, um `id` que não existe mais): nada é gravado e o motivo vem num toast (`Digite o nome do atalho.`, `Você já tem 8 atalhos. Remova um para adicionar outro.`, `Esse atalho não existe mais.` etc.). Outra `acao`: o comando é ignorado. |
| `removeShortcut` | `id` (texto) | Remove o atalho (um que não existe: linha no diagnóstico). |
| `useShortcut` | `id` (texto) | O clique no cartão (na aba Atalhos ou no painel da ligação). Ver abaixo. |

O `useShortcut` (spec 3.2 e 4), com os comandos de sempre:

| `acao` | Sem ligação | Com ligação |
|---|---|---|
| `ligar` | liga para o número | a Nova ligação (a atual vai para a espera), como o `dial` |
| `transferir` | liga para o número | transfere direto, como o `transfer` |
| `consulta` | liga para o número | consulta o número, como o `consult` |
| `teclas` | recusado (linha no diagnóstico; a interface desativa o botão) | manda os dígitos DTMF do número (`0-9`, `*` e `#`; o `+` fica de fora), como o `dtmf`; sem nenhum, recusado (linha no diagnóstico) |

- O número passa pela regra dos contatos (como `dial` com `contato: true`: o `+55` sai e o prefixo de saída entra
  nos números longos), menos no `teclas`, que não passa pela regra: vão só os dígitos DTMF (ver a tabela).
- "Com ligação" é qualquer ligação de pé (também uma recebida que ainda toca: aí o controlador recusa como recusaria o
  comando de sempre). Sem registro, o toast `Sem conexão com o servidor. Tente de novo em instantes.`, como no `dial`.
- **Puxar ligação:** com `estado` `tocando`, o puxar ligado (`admin.puxar`) e um código (`admin.codigoPuxar` não
  vazio), o atalho liga para o código, com cada `{ramal}` trocado pelo número do atalho (`**{ramal}` vira `**2007`;
  `*8` vai como está), em vez da ação, pelo mesmo caminho do `dial` e sem a regra dos contatos. Com o código vazio,
  ou fora de `tocando`, vale a ação.

```json
{"v":1,"cmd":"saveShortcut","nome":"Recepção","numero":"2007","acao":"transferir","blf":true}
{"v":1,"cmd":"saveShortcut","id":"5a1c0e9b2f3d4c67","nome":"Menu","numero":"12#","acao":"teclas","blf":false}
{"v":1,"cmd":"removeShortcut","id":"5a1c0e9b2f3d4c67"}
{"v":1,"cmd":"useShortcut","id":"5a1c0e9b2f3d4c67"}
```

### Área do administrador (rc.3)

A configuração fica no `admin.json`, protegido pelo DPAPI do usuário (como as senhas). A interface abre o diálogo
"Área do administrador" com Ctrl + P; o C++ confere a senha (só um resumo PBKDF2-SHA256 fica no programa).

| Comando | Campos | O que faz |
|---|---|---|
| `adminLogin` | `senha` (texto) | Toda tentativa tem resposta: `entrarAdmin.vez` sobe. A senha certa abre a área (`admin.aberto` `true`, `entrarAdmin.erro` `""`, `esperaAte` `0`). A errada: `entrarAdmin.erro` `Senha incorreta.` (a interface limpa o campo). Na 5ª errada seguida, `entrarAdmin.esperaAte` traz até quando (agora + 30 s) todo `adminLogin` é recusado, também com a senha certa (o `erro` continua `Senha incorreta.`). Uma certa zera a conta. A conta das erradas fica só na memória (abrir o app de novo zera). A senha digitada nunca vai ao diagnóstico nem ao estado. Com a área já aberta, a senha certa só recomeça os 10 min. |
| `adminLogout` | — | "Sair da área do administrador": `admin.aberto` `false`. |
| `adminSet` | `naoPerturbe` (booleano, opcional), `atenderAuto` (booleano, opcional), `blf` (booleano, opcional), `puxar` (booleano, opcional), `codigoPuxar` (texto, opcional), `servidores` (lista de `{endereco: texto, porta: inteiro}`, opcional), `canal` (`"teste"` \| `"estavel"` \| `""`, opcional) | Muda só os campos que vieram (`servidores` troca a lista inteira) e grava o `admin.json`. Com a área fechada: ignorado (linha no diagnóstico: `adminSet recusado`). Recusado pela loja (um `canal` diferente desses, um código com algo além de dígitos, `*`, `#`, `+` e `{ramal}`, um servidor com o endereço fora da regra da tela Entrar, repetido ou com a porta fora de 1 a 65535): nada muda e o motivo vem num toast (`Escolha o canal Teste ou Estável.`, `Esse servidor já está na lista.`, `A porta deve ficar entre 1 e 65535.` etc.). |

- A área fecha sozinha depois de 10 minutos sem nenhum comando da interface (qualquer comando, menos o `ready`,
  recomeça a contagem), no `closeToTray` (a janela fechou para a bandeja) e no `quit`.
- `naoPerturbe: false` esconde o botão Não perturbe e o desliga na hora (gravado no `config.json`; as ligações voltam
  a tocar); `atenderAuto: false` faz o mesmo com o Atender automático. Mostrar de novo não liga de volta. A abertura
  do app também desliga o que está escondido.
- `blf` liga ou desliga o BLF de todos os atalhos (ver `atalhos[].estado`).
- `servidores` é a tabela de portas da conta (UDP e TCP), no lugar da seção `[portas]` do `perfil.ini`; um servidor
  fora dela usa a porta da `[conta]` (5060). Sem `admin.json`, a lista é a do perfil. Se a porta do servidor da conta
  em uso muda, a conta registra de novo com a porta nova (com uma ligação, no fim dela, sem aviso; escolher a mesma
  conta no meio não tira esse registro, e uma troca de conta no meio já registra com a lista nova); as próximas
  contas (Entrar, troca de conta) já usam a lista.
- `canal` é o canal de atualização: `"teste"` (o `canal-teste`), `"estavel"` (o release estável) ou `""` (o de
  fábrica, o do build). Vale a partir da próxima verificação.

```json
{"v":1,"cmd":"adminLogin","senha":"..."}
{"v":1,"cmd":"adminSet","naoPerturbe":false,"blf":true,"puxar":true,"codigoPuxar":"**{ramal}"}
{"v":1,"cmd":"adminSet","servidores":[{"endereco":"starcloud1-starsonic.com.br","porta":35060}],"canal":"teste"}
{"v":1,"cmd":"adminLogout"}
```

### Contatos e Recentes

| Comando | Campos | O que faz |
|---|---|---|
| `saveContact` | `id` (texto, opcional), `nome` (texto), `numero` (texto), `observacao` (texto, opcional) | Novo contato (sem `id`) ou a edição de um. Nome e número são obrigatórios (depois de tirar os espaços e os separadores); sem eles, nada é gravado. |
| `removeContact` | `id` (texto) | Remove o contato (a interface pede a confirmação antes). |
| `viewRecents` | — | A pessoa abriu a tela Recentes: `perdidas` volta a 0. |

```json
{"v":1,"cmd":"saveContact","nome":"Ana Souza","numero":"(11) 98888-7777","observacao":"cliente"}
{"v":1,"cmd":"saveContact","id":"c1d2e3f4a5b60718","nome":"Ana Souza","numero":"2005","observacao":""}
{"v":1,"cmd":"removeContact","id":"c1d2e3f4a5b60718"}
{"v":1,"cmd":"viewRecents"}
```

## O estado (C++ → interface)

`{"v":1,"type":"state","state":{...}}`, com todas as chaves sempre presentes (o que não há vem `null`, `""`, `0`,
`false` ou `[]`). Exemplo (com uma ligação e uma segunda tocando):

```json
{"v":1,"type":"state","state":{
  "tela":"principal",
  "entrar":{"servidor":"","protocolo":"udp","ramal":"","nome":"","erro":"","ocupado":false,"pedeSenha":false,
            "podeCancelar":false,"contaId":""},
  "conta":{"id":"9f3c2a71b0d84e55","nome":"Recepção","ramal":"2001","servidor":"starcloud1-starsonic.com.br",
           "protocolo":"udp","status":"conectado","texto":"Conectado · starcloud1-starsonic.com.br","internet":true},
  "contas":[{"id":"9f3c2a71b0d84e55","nome":"Recepção","ramal":"2001","servidor":"starcloud1-starsonic.com.br",
             "protocolo":"udp","emUso":true}],
  "naoPerturbe":false,
  "atenderAutomatico":{"on":false,"segundos":3},
  "ligacao":{
    "top":{"id":11,"number":"2002","name":"Ana Souza","incoming":false,"phase":"active",
           "activeSinceMs":1761062400000,"held":false},
    "second":{"id":12,"number":"2003","name":"","incoming":true,"phase":"ringing","activeSinceMs":0,"held":false},
    "secondKind":"ringing","muted":false,"conference":false,"conferenceSinceMs":0,
    "consulting":false,"colleagueActive":false},
  "recentes":[{"numero":"2005","nome":"Bruno","tipo":"perdida","inicio":1761061000000,"duracao":0,"contatoId":""}],
  "perdidas":1,
  "contatos":[{"id":"c1d2e3f4a5b60718","nome":"Ana Souza","numero":"2002","observacao":"cliente"}],
  "audio":{"microfones":[{"id":0,"nome":"Microfone (Realtek)"}],"altoFalantes":[{"id":1,"nome":"Alto-falantes (Realtek)"}],
           "microfone":"Headset USB","altoFalante":"","toque":"","desconectados":["Headset USB"]},
  "iniciarComWindows":true,
  "versao":"0.1.0-rc.1",
  "teclado":"",
  "tecladoVez":0,
  "atalhos":[{"id":"5a1c0e9b2f3d4c67","nome":"Recepção","numero":"2007","acao":"transferir","blf":true,
              "estado":"tocando"},
             {"id":"0b2e7d4c1a9f3e58","nome":"Menu","numero":"12#","acao":"teclas","blf":false,"estado":null}],
  "admin":{"aberto":false,"naoPerturbe":true,"atenderAuto":true,"blf":true,"puxa":false},
  "entrarAdmin":{"erro":"","esperaAte":0,"vez":0},
  "config":{"bipeFim":true}
}}
```

### Campos

| Campo | Tipo | Sentido |
|---|---|---|
| `tela` | `"entrar"` \| `"principal"` | `entrar` sem conta em uso, com a conta em uso sem senha (`entrar.pedeSenha`), ou na troca para uma conta sem senha (`entrar.podeCancelar`; a conta em uso continua em `conta`) — nesta, com uma ligação (`ligacao` não `null`, da conta que continua registrada) a `tela` é `principal`, e a Entrar volta quando a ligação acaba. A interface também desenha a ligação antes da Entrar. Adicionar e Editar conta com o app em `principal` são uma navegação da interface: ela mostra o formulário e lê `entrar` do mesmo jeito. |
| `entrar` | objeto | A tela Entrar. |
| `entrar.servidor`, `entrar.ramal`, `entrar.nome` | texto | O que preencher nos campos: o que a pessoa digitou no último `login` (depois de uma mensagem), ou a conta que pede a senha. A senha nunca vem. |
| `entrar.protocolo` | `"udp"` \| `"tcp"` | O protocolo do campo (sem nada digitado, o padrão do perfil). |
| `entrar.erro` | texto | A mensagem embaixo da senha, em vermelho (`""`: nenhuma). Ver "O Entrar". Com `pedeSenha`: `Digite a senha de novo para continuar.`. |
| `entrar.ocupado` | booleano | Esperando o registro (ou o fim da ligação): "Conectando…", campos e Entrar travados. |
| `entrar.pedeSenha` | booleano | A conta veio sem a senha (a migração da rc.7, ou ela não decifra mais): os campos vêm preenchidos e só falta a senha. |
| `entrar.podeCancelar` | booleano | A tela pede a senha de uma troca de conta (`selectAccount` de uma conta sem senha): a interface mostra o botão `Cancelar`, que manda `cancelLogin` e volta para a conta em uso. |
| `entrar.contaId` | texto | A conta que a tela edita (vai de volta no `login`); `""` = conta nova. |
| `conta` | objeto \| `null` | A conta em uso (o cabeçalho); `null` sem nenhuma. |
| `conta.id`, `conta.nome`, `conta.ramal`, `conta.servidor` | texto | `nome` pode ser `""` (sem nome: a interface mostra o ramal). `servidor` é o endereço como a tela Entrar o aceitou, sem a porta (a porta vem da lista do administrador, `admin.servidores`): o executável faz o teste DNS do monitor de rede com ele, e com um `host:porta` todo teste falharia. |
| `conta.protocolo` | `"udp"` \| `"tcp"` | |
| `conta.status` | `"conectado"` \| `"conectando"` \| `"sem_conexao"` \| `"erro"` | O registro: `conectando` (esperando a resposta, ou trocando de conta), `conectado`, `sem_conexao` (o servidor não responde, ou a conta não está registrada) e `erro` (o servidor recusou: senha, ramal). |
| `conta.texto` | texto | A linha do cabeçalho: `Conectado · <servidor>`, `Conectando…`, ou a mensagem do registro (as de `entrar.erro`); pode ser `""` com `sem_conexao`. |
| `conta.internet` | booleano | (rc.3) O executável vê a internet (`DesktopApp::SetInternet`, com os estados de `InternetState.h`; `true` até ele dizer o contrário). `false` sem rede (o Windows não vê nenhuma rede) e sem o DNS (duas falhas seguidas do teste DNS do servidor, com a conta fora do ar). `false` vem antes de tudo na bolinha (cinza, `Sem internet · tentando de novo`), e o `status`/`texto` ficam como estavam. Sem rede, o motor para de tentar registrar (o registro que a central tem fica até vencer) e a ligação não sai; quando a rede volta, o motor registra de novo: `status` `conectando` e depois `conectado`. Sem o DNS, o motor segue como está (um registro vivo continua: as ligações chegam e saem); quando o DNS volta, a conta sem registro registra de novo na hora (`conectando`, sem troca de conta). Uma ligação que caiu não é refeita. |
| `contas` | lista | As contas gravadas, na ordem em que foram incluídas: `{id, nome, ramal, servidor, protocolo, emUso}` (`emUso`: booleano, a em uso). |
| `naoPerturbe` | booleano | O botão Não perturbe (ligado ou não). Não confundir com `admin.naoPerturbe` (o botão aparece). |
| `atenderAutomatico` | objeto | `{on: booleano, segundos: inteiro de 0 a 30}`. |
| `ligacao` | objeto \| `null` | A tela da ligação (abaixo); `null` sem ligação. |
| `recentes` | lista | As últimas 500 ligações, a mais nova primeiro: `{numero, nome, tipo, inicio, duracao, contatoId}`. |
| `recentes[].numero` | texto | O número como veio (a interface o mostra sem o nome). |
| `recentes[].nome` | texto | Já resolvido: o do contato com o número, senão o que a central mandou, senão `""` (a interface mostra o número). |
| `recentes[].tipo` | `"feita"` \| `"recebida"` \| `"perdida"` | Perdida em vermelho. |
| `recentes[].inicio` | inteiro | Quando a ligação começou (ms desde 1970): os grupos Hoje, Ontem e a data, e a hora. |
| `recentes[].duracao` | inteiro | Quanto durou desde o atendimento, em **milissegundos** (0 na perdida e na feita que não completou). |
| `recentes[].contatoId` | texto | O contato com esse número (`""`: nenhum; a linha oferece "Salvar contato"). |
| `perdidas` | inteiro | Quantas perdidas desde a última visita aos Recentes (`viewRecents`; na abertura do app, conta do zero). O filtro "Perdidas · <n>". |
| `contatos` | lista | A agenda em ordem alfabética (sem acento e sem caixa): `{id, nome, numero, observacao}` (texto). |
| `audio` | objeto | Configurações → Áudio. |
| `audio.microfones`, `audio.altoFalantes` | lista | Os dispositivos que o motor vê agora: `{id: inteiro, nome: texto}`. O `id` é só da lista de agora (muda quando um dispositivo entra ou sai): a escolha vai pelo `nome`. |
| `audio.microfone`, `audio.altoFalante` | texto | O nome escolhido (`""`: o padrão do Windows). Pode não estar na lista (ver `desconectados`). |
| `audio.toque` | texto | O `deviceId` do toque, da interface (`""`: o padrão). |
| `audio.desconectados` | lista de texto | Os nomes escolhidos que não estão conectados agora: a ligação usa o padrão do Windows, e a interface mostra o nome com "(desconectado)" ao lado. A escolha fica gravada e volta a valer quando o dispositivo volta. |
| `iniciarComWindows` | booleano | Configurações → Geral. Na abertura vale o que o Windows tem (o valor `Starsonic Phone` no `HKCU\...\Run`, e não desligado no Gerenciador de Tarefas), não o `config.json`: o executável lê o registro e o `DesktopApp` grava o que viu, sem o gancho. |
| `versao` | texto | A versão do app (o Sobre). |
| `teclado` | texto | O número que um link `tel:`/`sip:`/`callto:` pôs no Teclado (o app nunca liga sozinho por um link). |
| `tecladoVez` | inteiro | Sobe a cada link (começa em 0). A interface põe `teclado` no Teclado (e vai para a aba Teclado) quando `tecladoVez` muda, também com o mesmo número de antes; com uma ligação em andamento, a ligação não muda. |
| `atalhos` | lista | (rc.3) Os atalhos, na ordem em que foram incluídos (até 8): `{id, nome, numero, acao, blf, estado}`. |
| `atalhos[].acao` | `"ligar"` \| `"transferir"` \| `"consulta"` \| `"teclas"` | Ligar, Transferir, Transferir com consulta, Enviar teclas. |
| `atalhos[].blf` | booleano | A chave "Mostrar se o ramal está livre" do atalho. |
| `atalhos[].estado` | `"livre"` \| `"tocando"` \| `"ocupado"` \| `"desconectado"` \| `null` | O BLF do ramal: `null` sem o `blf` do atalho ou com o BLF do administrador desligado (`admin.blf`); senão `desconectado` até o primeiro aviso do servidor, com a assinatura recusada, vencida ou sem resposta, e enquanto a conta não está registrada (o registro caiu, sem internet, conectando); quando a conta registra de novo, volta o último estado que o servidor deu, até o próximo aviso. Dois atalhos com o mesmo número têm o mesmo estado. O C++ assina só os atalhos com `blf`, com o `admin.blf` ligado, na conta em uso; de novo quando os atalhos, o administrador ou a conta mudam e quando a conta volta a registrar. |
| `admin` | objeto | (rc.3) A área do administrador. Fechada (`aberto` `false`), só `{aberto, naoPerturbe, atenderAuto, blf, puxa}`, o que a interface precisa para esconder os botões, desativar a chave do BLF e mostrar a ajuda do puxar; aberta, também `puxar`, `codigoPuxar`, `servidores` e `canal`. |
| `admin.aberto` | booleano | A área está aberta (a senha certa, há menos de 10 min sem comando). |
| `admin.naoPerturbe`, `admin.atenderAuto` | booleano | Os botões Não perturbe e Atender automático aparecem (`false`: escondidos, e desligados; o Atender automático também some de Configurações e o atalho do Não perturbe some da bandeja). |
| `admin.blf` | booleano | O BLF nos atalhos. `false`: a chave "Mostrar se o ramal está livre" fica desativada, com a ajuda `O administrador não ligou o BLF`. |
| `admin.puxa` | booleano | (rc.3, com a área fechada e aberta) O clique num atalho com o BLF `tocando` puxa a ligação: `true` só com `admin.blf`, `admin.puxar` e um `admin.codigoPuxar` não vazio (o que o `useShortcut` confere, fora o `estado` do atalho). A interface só acrescenta "Num ramal tocando, o clique puxa a ligação." à ajuda da aba Atalhos com ele `true`. Não é sensível: o código continua só com a área aberta. |
| `admin.puxar`, `admin.codigoPuxar` | booleano, texto | "Puxar ligação pelo atalho" e o "Código para puxar a ligação" (com `{ramal}`). Só com `aberto`. |
| `admin.servidores` | lista | `{endereco: texto, porta: inteiro}`: a tabela de portas (ver `adminSet`). Só com `aberto`. |
| `admin.canal` | `"teste"` \| `"estavel"` \| `""` | O canal de atualização (`""`: o do build). Só com `aberto`. |
| `entrarAdmin` | objeto | (rc.3) O resultado do último `adminLogin`: `{erro, esperaAte, vez}`. `erro`: `Senha incorreta.` ou `""` (o da última tentativa). `esperaAte`: até quando (ms desde 1970) o `adminLogin` é recusado depois de 5 senhas erradas seguidas (o diálogo espera até `Date.now() >= esperaAte`); `0` sem espera. `vez`: sobe a cada `adminLogin` respondido (a senha certa, a errada e a recusada na espera; começa em 0), como o `tecladoVez`: duas erradas seguidas têm o mesmo `erro`, e só a `vez` diz que a segunda foi respondida. **Quando a `vez` muda**, a interface limpa o campo Senha e mostra o `erro` (nenhum: a área abriu); fora disso, o `erro` que está no estado é de uma tentativa velha e não aparece (por exemplo, ao abrir o diálogo de novo). |
| `config` | objeto | (rc.3) Configurações novas: `{bipeFim}`. |
| `config.bipeFim` | booleano | "Bipe quando a ligação cai ou termina" (`setSetting` `bipeFim`; ligado de fábrica). |

### `ligacao`

Os campos têm os nomes do `CallSnapshot` do C++ (`starsonic/phone/CallController.h`), com os nomes das pessoas já
resolvidos. Sempre há `top` (sem ligação, `ligacao` é `null`).

| Campo | Tipo | Sentido |
|---|---|---|
| `top` | cartão | A ligação de cima: a ativa (a do som). |
| `second` | cartão \| `null` | A outra, com duas. |
| `secondKind` | `"none"` \| `"ringing"` \| `"held"` \| `"active"` | O que a outra é: `ringing` (a segunda tocando: a faixa "Ligação de …" com Recusar e Atender), `held` (em espera: o cartão "Em espera"), `active` (só na conferência: as duas falando), `none` (sem a outra). |
| `muted` | booleano | O mudo (vale para as duas). |
| `conference` | booleano | As duas em conferência. **A interface olha `conference` antes de `secondKind`**: na conferência a tela é "Conferência" (os participantes, o tempo desde `conferenceSinceMs`, Mudo, Teclado, Separar e "Desligar para todos"), e nenhuma das duas está em espera. |
| `conferenceSinceMs` | inteiro | Quando o Juntar foi pedido (ms desde 1970); 0 fora da conferência. |
| `consulting` | booleano | A transferência com consulta (as duas de pé). O cliente fica com o selo "Em espera · transferência" e o colega em destaque ("Consultando"). |
| `colleagueActive` | booleano | Na consulta, o colega é o `top` (senão, o cliente é o `top`). |

Cada cartão (`top`, `second`):

| Campo | Tipo | Sentido |
|---|---|---|
| `id` | inteiro | O id da ligação no motor; `0` numa feita que ainda não tem id (ver `hangup`). |
| `number` | texto | O número. |
| `name` | texto | Já resolvido: o do contato com o número, senão o que a central mandou; `""` sem os dois (a interface mostra o número). |
| `incoming` | booleano | Recebida (`true`) ou feita. |
| `phase` | `"ringing"` \| `"dialing"` \| `"active"` | Tocando (recebida), chamando (feita) ou em andamento. Uma recebida atendida aqui fica `active` com `activeSinceMs` 0 até o motor confirmar. |
| `activeSinceMs` | inteiro | Quando os dois lados atenderam (ms desde 1970; 0: ainda não). O tempo da ligação é `Date.now() - activeSinceMs`. |
| `held` | booleano | Em espera. |

O aviso de 2 s que o controlador tem (o `endMessage`: `Ocupado`, `Não atendeu`, `<nome ou número> desligou`,
`<nome ou número>: <motivo>` do colega, `O servidor não aceitou a transferência.`, `Sem conexão com o servidor. Tente
de novo em instantes.`) não vem no estado: ele chega como um `toast`, uma vez, quando aparece.

## Avisos e toque

- `{"v":1,"type":"toast","texto":"..."}`: a interface mostra o texto por 2 s (um novo toma o lugar do que está na
  tela). Vêm como toast: o aviso das ligações (acima), `Ligação perdida de <contato ou número>` (a perdida que a
  pessoa não viu) e `A troca de conta fica para o fim da ligação.`. Um toast não se repete no `ready`.
- `{"v":1,"type":"ring","tipo":"completo"}`: o toque completo (uma recebida sem outra ligação), no dispositivo
  `audio.toque`; `"espera"`: o bipe da segunda ligação, no alto-falante da ligação — a saída do WebView2 cujo rótulo
  é o nome `audio.altoFalante` (igual, ou um começando com o outro: o motor corta os nomes longos); `"parar"`:
  nenhum. Sem o dispositivo (nome vazio, sem rótulos sem a permissão de mídia, nenhuma saída com esse nome, ou o
  `setSinkId` falhou), a interface toca no padrão. 425 Hz (spec da W1, Global Constraints). Só a janela principal
  toca (o aviso recebe as mesmas mensagens e não toca). Vem quando muda, e o atual vem de novo depois do estado, a
  cada `ready`.

- `{"v":1,"type":"ring","tipo":"fim"}` (rc.3): o bipe do fim da ligação, uma vez: 425 Hz por 0,25 s, duas vezes com
  0,15 s de intervalo, no alto-falante da ligação (como o `espera`, nunca no `audio.toque`). Vem quando uma ligação
  que foi atendida (teve `activeSinceMs`) acaba, por qualquer motivo (a outra pessoa desligou, a ligação caiu, também
  pela internet, ou a própria pessoa desligou, transferiu ou saiu da conferência), nenhuma outra ligação ficou e
  `config.bipeFim` está ligado. Duas que acabam juntas (a conferência) dão um bipe só. Não vem para a recusada, a
  perdida ou a que não completou, nem quando a outra ligação continua. Não muda o toque de agora e não volta no
  `ready`.

```json
{"v":1,"type":"toast","texto":"A troca de conta fica para o fim da ligação."}
{"v":1,"type":"ring","tipo":"completo"}
{"v":1,"type":"ring","tipo":"fim"}
```

## Atualização

O atualizador (o mesmo do app antigo: o `versao.json` do canal da build, o SHA-256 conferido) verifica um minuto
depois de abrir e a cada 24 h. Achou uma versão mais nova:

- `{"v":1,"type":"update","versao":"0.1.0-rc.2","notas":"..."}` — a interface mostra a pergunta "Nova versão do
  Starsonic Phone disponível (<versao>). Atualizar agora?", com as `notas` (texto do `versao.json`, pode ter quebras
  de linha; `""` sem notas) e os botões "Depois" e "Atualizar agora". Nunca por cima da tela da ligação: a pergunta
  aparece quando a ligação acaba. Uma `update` nova com outra aberta toma o lugar dela. Vem de novo a cada `ready`
  até a resposta. O aviso do canto ignora a mensagem.
- A resposta é `updateNow` ou `updateLater`, uma vez. Com `updateNow` e uma ligação em andamento, o toast
  `Termine a chamada para atualizar.` e nada é baixado (a próxima verificação pergunta de novo); sem ligação, o toast
  `Baixando atualização…`, o download, a conferência do SHA-256 e o instalador; o app sai sozinho (como o `quit`).
  Falhou o download: o toast `Não foi possível baixar a atualização. Tentaremos de novo mais tarde.`.
- O `quit` com a pergunta aberta vale `updateLater`.

```json
{"v":1,"type":"update","versao":"0.1.0-rc.2","notas":"Correções no aviso de ligação."}
{"v":1,"cmd":"updateNow"}
{"v":1,"cmd":"updateLater"}
```

## Para o executável (Tasks 11 e 12)

- O `DesktopApp` roda tudo numa thread de comandos própria; `post` é chamado só nela, uma mensagem por vez, na
  ordem: o executável repassa cada uma ao `PostWebMessageAsJson` (na thread da janela), nas duas páginas: a janela
  principal (`index.html`) e o aviso de ligação recebida (`aviso.html`, um segundo WebView2 com o mesmo ambiente).
  Os comandos das duas vão ao mesmo `DesktopApp`; o `answer` do aviso também traz a janela principal para a frente.
  `HandleCommand` pode ser chamado da thread da janela (ele só lê o JSON e põe na fila).
- O executável lê o `state` que passa (sem perguntar ao `DesktopApp`): com uma recebida tocando (`top.phase`
  `ringing`, ou `secondKind` `ringing` fora da conferência) e a janela fora da frente, o aviso aparece. O ícone da
  bandeja segue a tabela da bolinha (rc.3; vale a primeira que bate, Ruling 17): sem internet (`conta.internet`
  `false`), conectando, erro, sem conexão ou sem conta → sem conexão; depois a ligação (também tocando) → em
  ligação; a perdida que a pessoa ainda não viu (`perdidas`) → perdida; o Não perturbe (`naoPerturbe`) → não
  perturbe; e conectado (`conta.status` `conectado`) → conectado. Ele pisca enquanto toca. O menu da bandeja manda
  `setDnd` e `quit` como a interface.
- Os links `tel:`/`sip:`/`callto:` (já lidos: `ParseLinkArgument`) vão a `DesktopApp::DialLink(numero)`, que só
  preenche `teclado` (e escreve `link recebido` no diagnóstico). Com o app aberto, a segunda abertura entrega os
  argumentos à primeira (instância única: o mutex `Local\StarsonicPhone` e `WM_COPYDATA`) e sai com o código 0; o
  `--sair` vai pelo mesmo caminho.
- A atualização: `DesktopApp::OfferUpdate(versao, notas)` manda a pergunta e guarda até a resposta; a resposta vai
  ao gancho `updateAnswer(agora)`. `DesktopApp::Notify(texto)` manda um toast do executável.
- O logoff ou o desligamento do Windows (`WM_ENDSESSION`) faz o mesmo `quit`, espera até 3 s pelo gancho `quit`,
  para o monitor de rede (rc.3: depois do Sair, porque o `Unadvise` do Windows pode demorar e as ligações e os
  Recentes vêm antes; antes do `Shutdown`, para nenhum `SetInternet` chegar depois dele) e roda o `Shutdown()` (os
  Recentes das ligações encerradas ficam gravados).
- A posição e o tamanho da janela: depois de a pessoa mover a janela, o executável chama
  `DesktopApp::SaveWindowPosition(x, y)` (o canto de cima da área da interface, em pixels da tela), que grava
  `janela_x`/`janela_y` no `config.json`; depois de ela mudar o tamanho, `DesktopApp::SaveWindowSize(largura, altura)`
  (a área da interface, em pixels lógicos), que grava `janela_largura`/`janela_altura` (os dois só se mudou, e só
  depois do `Start`). Na abertura, o executável lê a posição e o tamanho do `config.json` antes de criar a janela.
- O `resize`: o `DesktopApp` chama o gancho `resize(borda)` na thread de comandos, e o executável só põe na fila da
  janela (`RunOnWindow`, Ruling 6: a thread de comandos nunca espera a janela). Na thread da janela, com o botão
  esquerdo ainda apertado e a janela nem maximizada nem minimizada, ele faz `ReleaseCapture()` e posta
  `WM_NCLBUTTONDOWN` com `HTTOP`, `HTTOPLEFT`, `HTTOPRIGHT` ou `HTBOTTOMRIGHT` e o ponto do cursor: o Windows roda o
  redimensionar de sempre (com o mínimo e o máximo do `WM_GETMINMAXINFO`), e a interface nunca espera.
- Os dispositivos de som: o `WM_DEVICECHANGE` (`DBT_DEVNODES_CHANGED`, e a chegada e a saída de uma interface de
  áudio) espera 1 s sem outro aviso e chama `DesktopApp::RefreshAudioDevices()`, que só põe na fila: o motor relê a
  lista do sistema e a escolha gravada vale de novo pelo nome (`audio.desconectados`).
- As páginas abrem com a versão do app na URL (`index.html?v=<versao>`, `aviso.html?v=<versao>`), e elas pedem o
  `app.js`, o `aviso.js` e o `app.css` com o conteúdo na URL (`?v=<12 do SHA-256>`, do `build.mjs`): o cache do
  WebView2 nunca serve a interface de outra versão.
- O navegador do WebView2 que sai (morto ou caído) é refeito com um ambiente novo, a janela e o aviso
  (`navegador reiniciado` no diagnóstico); a página que não responde recarrega depois de 5 s. As duas mandam o
  `ready` de novo.
- O `quit` da interface não vai direto ao `DesktopApp`: o executável o manda pelo mesmo caminho do Alt+F4, da
  bandeja e do `--sair` (o `WM_CLOSE`, que fecha a janela no máximo 10 s depois).
- (rc.3) Os arquivos novos: `DesktopPaths.atalhos` (`atalhos.json`) e `DesktopPaths.admin` (`admin.json`, pelo
  mesmo cifrador das senhas: o DPAPI), na pasta de dados.
- (rc.3) O BLF e a rede vão pelo `RegistrationPort` (o `EngineHost`): `WatchBlf(numeros)` e
  `SetNetworkAvailable(disponivel)`, os do `SipEngine`; o `OnBlf` do motor vai ao `DesktopApp::OnBlf` (que só põe na
  fila). A conta vai ao motor com `AccountInput::serverPorts` (a lista do administrador, no lugar do `[portas]`).
- (rc.3) A internet: o monitor de rede do executável chama `DesktopApp::SetInternet(estado)` (de qualquer thread;
  só põe na fila) com um dos três estados de `InternetState.h`. Repetir o mesmo valor não faz nada.
  - `Online`: com internet.
  - `NoNetwork` (sem rede): o Windows não vê nenhuma rede. O motor para (`SetNetworkAvailable(false)`: nenhuma nova
    tentativa de registro; o registro que a central tem não sai, e vive até vencer ou até a próxima renovação falhar),
    o `dial` é recusado com o aviso de sempre, e `conta.internet` fica `false`. Saindo dele (para `Online` ou
    `NoDns`), o motor volta e registra de novo (`SetNetworkAvailable(true)`; `conectando` até a resposta).
  - `NoDns` (sem o DNS): duas falhas seguidas do teste DNS do servidor, contadas só com a conta fora do ar (com
    `conta.status` `conectado`, o registro vivo prova que a central responde, e a falha não conta). Só
    `conta.internet` fica `false`: o motor segue como está (sem pausa e sem a saída do registro), a ligação sai e
    chega se a conta está registrada, e o motor continua tentando registrar se não está. Saindo dele para `Online`
    (o DNS respondeu, ou a conta conectou), a conta sem registro registra de novo na hora, sem troca de conta.
  O monitor lê do `state` que passa o `conta.servidor` (o teste DNS; um IP ou nenhuma conta: sem teste, só a falta de
  rede vale) e se `conta.status` é `conectado`. O Windows dizer "sem internet" (o NCSI) com uma rede local só faz um
  teste DNS sair na hora.
- (rc.3) O gancho `updateChannel(canal)`: o canal de atualização que vale (`"teste"`, `"estavel"` ou `""` = o do
  build), na abertura e quando o administrador muda o canal. Como os outros ganchos, roda na thread de comandos e
  nunca espera: só guarda o canal num atômico, que a próxima verificação do atualizador lê (não verifica na hora).
- (rc.3) A área do administrador fecha no `closeToTray` e no `quit`; a bandeja segue `admin.naoPerturbe` (o atalho
  do Não perturbe some quando ele está escondido) e `conta.internet`.
- Ao fechar: `Shutdown()`, o `Stop()` do agendador, o motor destruído, o `DesktopApp` destruído (detalhes no
  `DesktopApp.h`). Depois de a janela fechar, isso tem 5 s: passou, `fechamento forcado` no diagnóstico e o processo
  sai com o código 0.
