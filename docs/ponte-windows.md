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
- C++ → interface: oito mensagens, sempre com `v: 1`:
  - `{"v":1,"type":"state","state":{...}}` — o estado inteiro, a cada mudança (só quando muda);
  - `{"v":1,"type":"toast","texto":"..."}` — um aviso de 2 s;
  - `{"v":1,"type":"ring","tipo":"completo"|"espera"|"parar"|"fim"}` — o toque (`fim`, rc.3: o bipe do fim da
    ligação, uma vez);
  - `{"v":1,"type":"update","versao":"...","notas":"..."}` — a pergunta da atualização (ver "Atualização");
  - `{"v":1,"type":"contatosEmpresa","vez":N,"contatos":[...]}` — (rc.4) a lista de contatos da empresa (ver "A lista
    da empresa");
  - `{"v":1,"type":"chatChave","chave":"...","empresa":"..."}` — (0.2.0) a resposta ao `chatKey` (ver "O chat");
  - `{"v":1,"type":"janela","frente":true|false}` — (0.2.0) a janela principal está na frente (ver "O chat");
  - `{"v":1,"type":"abrir","tela":"chat","conversa":N}` — (0.2.0) a pessoa clicou no aviso do chat (ver "O chat").
- Ao carregar (e a cada recarga), a interface manda `{"v":1,"cmd":"ready"}` e recebe o estado atual e o toque atual
  (nesta ordem), também com uma ligação que já tocava antes de a página carregar, depois a lista da empresa (rc.4, se
  houve uma desde a abertura do app), a pergunta da atualização, se há uma aberta, e (0.2.0) no fim a `janela` e o
  `abrir` do chat pedido antes do primeiro `ready`.
- Os textos são UTF-8. Os tempos são milissegundos desde 1970 (como o `Date.now()` do JavaScript).

## Versão

- `v` é a versão do formato: hoje `1`. Ela muda quando o formato deixa de ser compatível (um campo some, muda de tipo
  ou de sentido). Acrescentar um campo novo ao estado ou um comando novo não muda a versão.
- O C++ ignora qualquer comando com `v` diferente de `1` (com uma linha no diagnóstico). A interface ignora mensagens
  com `v` diferente de `1` e mostra "Reinstale o Starsonic Phone." (não deve acontecer: as duas vão no mesmo
  executável).

## Comandos (interface → C++)

Regras para todos:

- Comando desconhecido, campo obrigatório que falta ou campo com o tipo errado (nos do chat, também o campo fora da
  regra): o comando é ignorado inteiro, com uma linha no diagnóstico (`comando ignorado: ...`). Campos a mais são
  ignorados.
- Os comandos rodam na ordem em que foram mandados, um por vez, numa thread do C++ (nunca na da interface): um
  comando nunca trava a janela.
- Depois de `quit`, todo comando (menos `ready`) é ignorado.
- "texto" é string JSON; "booleano" é `true`/`false` (não `0`/`1`, nem `"true"`); "inteiro" é número sem fração.

### Interface e janela

| Comando | Campos | O que faz |
|---|---|---|
| `ready` | — | A interface carregou: o C++ manda o estado e o toque de agora. Vai ao diagnóstico como `interface pronta`. (0.3.0) O da janela principal também desliga o teste da câmera que estava ligado (ver `cameraTest`). |
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
| `dial` | `numero` (texto), `contato` (booleano, opcional), (0.3.0) `video` (booleano, opcional) | Liga (o Teclado, os Recentes, os contatos). Sem ligação, ou com uma em andamento (a Nova ligação: a outra vai para a espera). Com `contato: true`, o número de um contato passa antes pela regra dos contatos do perfil (o `+55` sai e o prefixo de saída entra nos números longos). Sem registro, o toast `Sem conexão com o servidor. Tente de novo em instantes.` e nada é discado. (0.3.0) Com `video: true`, a ligação oferece vídeo (a câmera liga junto); sem o campo, vale `false`. O `video` só chega ao motor com `video.ligado` `true`; senão (e no iPhone, sempre) a ligação é só de voz. Ver "O vídeo na ligação". |
| `answer` | (0.3.0) `video` (booleano, opcional) | Atende a recebida que toca (a outra vai para a espera). (0.3.0) Com `video: true`, aceita o vídeo da oferta (a câmera liga junto); sem o campo, vale `false`, e a ligação é atendida só com a voz. Passa ao motor nas mesmas regras do `dial`. |
| `reject` | — | Recusa a recebida que toca (ocupado; vai aos Recentes como perdida). |
| `hangup` | `id` (inteiro ≥ 0, opcional) | O Desligar de um cartão. **A interface manda sempre o `id` do cartão quando ele tem um** (`top.id` ou `second.id` maior que 0); `id: 0` só para o cartão de uma feita que ainda não tem id (o C++ entende `0` como "a feita mais nova"). Sem `id`: a ligação ativa. Na conferência, qualquer id desliga as duas ("Desligar para todos"). (0.4.0) O da sala de vídeo (sem `id` com ela em cima, ou com o `id` dela) é o `salaEncerrar`, e o `id` de um convidado não faz nada (ver "A sala de vídeo (0.4.0)"). |
| `hold` | `on` (booleano, opcional) | Espera: `true` põe, `false` retoma, sem `on` troca. Com duas em andamento, pôr a ativa em espera é o Alternar. Na conferência, nada. |
| `mute` | `on` (booleano, opcional) | Mudo do microfone (vale para as duas ligações); sem `on`, troca. |
| `dtmf` | `digitos` (texto) | Manda os dígitos (`0-9`, `*`, `#`) na ligação ativa. |
| `transfer` | `numero` (texto), `contato` (booleano, opcional) | "Transferir agora" (sem consulta). (rc.5) Com `contato: true`, o número de um contato passa antes pela regra dos contatos, como no `dial`; a interface o manda quando o número do campo veio de uma sugestão e não mudou depois. (rc.6) No Windows, a sugestão é um contato escolhido na lista do painel, dos meus ou da lista da empresa. Se a central recusa, o toast `O servidor não aceitou a transferência.`. |
| `consult` | `numero` (texto), `contato` (booleano, opcional) | "Consultar": liga para o colega como a Nova ligação, marcada como consulta. (rc.5) O `contato`, como no `transfer`. |
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
{"v":1,"cmd":"transfer","numero":"+55 11 98888-7777","contato":true}
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
| `saveShortcut` | `id` (texto, opcional), `nome` (texto), `numero` (texto), `acao` (`"ligar"` \| `"transferir"` \| `"consulta"` \| `"teclas"`), `blf` (booleano) | Novo atalho (sem `id`) ou a edição de um. `blf` é a chave "Mostrar se o ramal está livre" (fica gravada mesmo com o BLF do administrador desligado; só vale com ele ligado). Recusado pela loja (o 9º atalho, nome vazio ou com mais de 24 caracteres, número vazio, com mais de 32 caracteres ou com algo além de dígitos, `*`, `#` e `+`, um `id` que não existe mais): nada é gravado e o motivo vem num toast (`Digite o nome do atalho.`, `Você já tem 8 atalhos. Remova um para adicionar outro.`, `Esse atalho não existe mais.` etc.). A interface reconhece esses toasts pelo texto exato (`windows/ui/src/recusas.ts`: destrava o Salvar e põe o foco no campo da recusa), então um texto novo ou mudado em `starsonic/desktop/Atalhos.cpp` (`kErr*`) pede a mesma mudança lá; o teste de deriva do `atalhos.spec.ts` avisa. Outra `acao`: o comando é ignorado. |
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
| `adminSet` | `naoPerturbe` (booleano, opcional), `atenderAuto` (booleano, opcional), `blf` (booleano, opcional), `puxar` (booleano, opcional), `codigoPuxar` (texto, opcional), `servidores` (lista de `{endereco: texto, porta: inteiro}`, opcional), `canal` (`"teste"` \| `"estavel"` \| `""`, opcional), (0.3.0) `videoH264`, `videoVp8` e `videoVp9` (booleanos, opcionais), `videoPrimeiro` (`"h264"` \| `"vp8"` \| `"vp9"`, opcional), `videoQualidade` (`"baixa"` \| `"media"` \| `"alta"`, opcional), `porteiros` (lista de textos, opcional) | Muda só os campos que vieram (`servidores` troca a lista inteira) e grava o `admin.json`. Com a área fechada: ignorado (linha no diagnóstico: `adminSet recusado`). Recusado pela loja (um `canal` diferente desses, um código com algo além de dígitos, `*`, `#`, `+` e `{ramal}`, um servidor com o endereço fora da regra da tela Entrar, repetido ou com a porta fora de 1 a 65535): nada muda e o motivo vem num toast (`Escolha o canal Teste ou Estável.`, `Esse servidor já está na lista.`, `A porta deve ficar entre 1 e 65535.` etc.). Um `videoPrimeiro` ou `videoQualidade` fora dos valores acima, ou um `porteiros` que não é uma lista de textos, é recusado já na leitura do comando (linha no diagnóstico). |

- A área fecha sozinha depois de 10 minutos sem nenhum comando da interface (qualquer comando, menos o `ready` e (0.2.0)
  o `chatKey`, o `chatNotify` e o `chatBadge`, que vêm do chat sem a pessoa, recomeça a contagem), no `closeToTray` (a
  janela fechou para a bandeja) e no `quit`.
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
- (0.3.0) O cartão Vídeo, gravado no `admin.json` (`videoH264`, `videoVp8`, `videoVp9`, `videoPrimeiro`,
  `videoQualidade` e `porteiros`; uma chave que falta vale o padrão, e um valor que não serve volta ao padrão, como o
  `canal`). De fábrica: H.264 e VP8 ligados, VP9 desligado, H.264 primeiro, qualidade `media` e nenhum Porteiro. Cada
  mudança vai ao motor (`SetVideoSettings`). A qualidade é a imagem do codificador: `baixa` 320×240, 15 qps e
  300 kbit/s; `media` 640×480, 25 qps e 800 kbit/s; `alta` 1280×720, 30 qps e 1500 kbit/s.
- (0.3.0) Os `porteiros` são os ramais cujo vídeo chega sozinho: até 20, cada um com 1 a 15 dígitos, só dígitos e sem
  repetir. A lista vai inteira, e os espaços das pontas de cada item saem. A loja recusa (nada muda, e o motivo vem num
  toast) mais de 20 (`No máximo 20 porteiros.`), um item com algo que não é dígito (`Cada porteiro só pode ter
  dígitos.`), um item vazio ou com mais de 15 dígitos (`Cada porteiro precisa ter de 1 a 15 dígitos.`) e um repetido
  (`Esse porteiro já está na lista.`).

```json
{"v":1,"cmd":"adminLogin","senha":"..."}
{"v":1,"cmd":"adminSet","naoPerturbe":false,"blf":true,"puxar":true,"codigoPuxar":"**{ramal}"}
{"v":1,"cmd":"adminSet","servidores":[{"endereco":"starcloud1-starsonic.com.br","porta":35060}],"canal":"teste"}
{"v":1,"cmd":"adminSet","videoVp9":true,"videoPrimeiro":"vp8","videoQualidade":"alta","porteiros":["9001","9002"]}
{"v":1,"cmd":"adminLogout"}
```

### Vídeo (0.3.0)

As escolhas do vídeo e a ponte das telas de vídeo, só no Windows (o motor do iPhone não tem vídeo: ver "O modo
iPhone"). Os pedidos da ligação com vídeo (`dial`, `answer` e `camera`) têm a sua parte própria, "O vídeo na ligação", abaixo.
A câmera nunca liga sozinha: só ligam a câmera o `dial` e o `answer` com `video: true`, o `camera` com `on: true` e o
`cameraTest` com `on: true` (o teste da câmera é o único jeito de ligá-la fora de uma ligação).

| Comando | Campos | O que faz |
|---|---|---|
| `setVideo` | `camera` (texto, opcional), `h264` (booleano, opcional) | `camera`: o nome da câmera (um de `video.cameras`); `""` quer dizer a primeira. Grava no `config.json` (chave `camera`) e manda ao motor (`SetCaptureDevice`); vale na próxima vez que a câmera abre. Um nome que não está na lista fica gravado, e `video.cameraDesconectada` vira `true`. `h264`: a chave da pessoa para o H.264 (chave `h264` do `config.json`, ligada de fábrica). Desligar põe `video.h264.situacao` em `desligado`; ligar de novo, se o módulo não está instalado, em `baixando` (o gancho `h264Ensure`), só no build com o download liberado (abaixo). O que não veio fica como está. A `camera` tem até 200 caracteres (mais que isso é recusado na leitura: `setVideo: camera invalida`). Só o que ficou gravado vai ao motor: se o disco recusa, nada muda. |
| `cameraTest` | `on` (booleano) | `true`: liga o teste da câmera (`StartCameraTest`), e a imagem vai na vista `local`; `video.teste` segue o resultado (`false` se o motor não abriu a câmera, e então o aviso da câmera vem num toast). `false`: desliga (`StopCameraTest`). Ligar com o teste já ligado não faz nada. O `ready` da janela principal (uma recarga da página, ou o navegador refeito) desliga o teste que estava ligado (`video.teste` `false`, já no estado desse `ready`): sem a página que o ligou, a luz da câmera ficaria acesa sem controle à vista. O `ready` do aviso não mexe nele. Com a tela bloqueada, a câmera do teste fecha e volta sozinha no desbloqueio; o `video.teste` segue `true`. |
| `videoViews` | `pagina` (`"principal"` \| `"aviso"`), `vistas` (lista de textos) | As vistas de vídeo que a página mostra agora (o gancho `videoViews`, com `pagina == "aviso"`). A página `principal` só tem `remoto` e `local` (o teste da câmera também usa a `local`, porque é a mesma imagem), e a página `aviso`, só `porteiro`. Uma vista que não é da página é ignorada, e a lista vai inteira a cada vez (uma lista vazia tira todas). Outra `pagina` é recusada na leitura, e também mais de 8 vistas ou uma vista com mais de 32 caracteres (`videoViews: vistas invalidas`). |
| `videoWindow` | `modo` (`"normal"` \| `"grande"` \| `"telaCheia"`) | O modo da janela do vídeo: o `DesktopApp` grava em `video.janela` e chama o gancho `videoWindow`. Outro `modo` é ignorado (linha no diagnóstico). Quando a última ligação acaba, se a `janela` não é `normal`, ela volta a `normal` (o gancho `videoWindow("normal")`). |
| `noticeHeight` | `altura` (inteiro de 168 a 480) | A altura do aviso de ligação recebida, em pixels lógicos: 222 quando a ligação oferece vídeo (sem outra ligação em andamento: com outra, 168), 430 com a imagem do porteiro. Só vale vindo da página do aviso (o gancho `noticeHeight`); da página principal é só uma linha no diagnóstico (`noticeHeight recusado: pagina principal`). Sem a `altura`, fora do intervalo ou não inteira, é recusado na leitura (`noticeHeight: altura invalida`). Exemplo: `{"v":1,"cmd":"noticeHeight","altura":222}`. Recusado no modo iPhone. |
| `h264Retry` | — | Tenta de novo baixar o módulo H.264, só depois de uma falha (`video.h264.situacao` `falhou`): vira `baixando` e chama o gancho `h264Ensure`. Em outra situação, é ignorado. |

```json
{"v":1,"cmd":"setVideo","camera":"Integrated Camera","h264":true}
{"v":1,"cmd":"cameraTest","on":true}
{"v":1,"cmd":"videoViews","pagina":"principal","vistas":["remoto","local"]}
{"v":1,"cmd":"videoViews","pagina":"aviso","vistas":["porteiro"]}
{"v":1,"cmd":"videoWindow","modo":"grande"}
{"v":1,"cmd":"h264Retry"}
```

Os avisos da câmera vêm num toast, quando o motor avisa o problema (o diagnóstico leva só a frase, nunca o nome da
câmera): `Nenhuma câmera encontrada.`, `A câmera está sendo usada por outro programa.`, `A câmera foi desconectada.` e,
no lugar do segundo quando a privacidade do Windows nega a câmera aos apps da área de trabalho (o gancho
`cameraBlocked`), `O Windows bloqueou a câmera para este app. Libere em Configurações do Windows → Privacidade e
segurança → Câmera.`. Uma câmera que some ou que não abre de novo também desliga o teste (`video.teste` `false`).

**A etapa 2 ligou o download do H.264.** O app só baixa e carrega o módulo da Cisco no build com a opção
`STARSONIC_H264_DOWNLOAD` do `windows/app/CMakeLists.txt` (o `DesktopConfig::h264Download` do núcleo), que a etapa 2
liga em todo build junto com as condições da licença do binário (a chave "H.264 da Cisco" da pessoa, o aviso "OpenH264
Video Codec provided by Cisco Systems, Inc." e o texto da licença na tela de Licenças). Sem a opção, `video.h264.situacao` fica `desligado`, o gancho `h264Ensure` nunca é chamado, o `h264Retry` é
ignorado e o motor nunca recebe o H.264.

#### O vídeo na ligação

| Comando | Campos | O que faz |
|---|---|---|
| `dial` | `video` (booleano, opcional) | Também no `dial` com `contato: true`. Ausente, vale `false`. |
| `answer` | `video` (booleano, opcional) | Ausente, vale `false`. |
| `camera` | `on` (booleano) | Liga (`true`) ou desliga (`false`) a nossa câmera na ligação de cima (`ligacao.top`). Sem ligação, ou antes de a feita ter o id do motor, não faz nada. Obrigatório o `on`: sem ele, ou com outro tipo, é recusado na leitura. |

```json
{"v":1,"cmd":"dial","numero":"2003","video":true}
{"v":1,"cmd":"answer","video":true}
{"v":1,"cmd":"camera","on":false}
```

- **O `video.ligado` decide.** O núcleo só repassa o `video: true` do `dial` e do `answer` ao motor com o `video.ligado`
  `true` (algum codec que vale: o VP8 ou o VP9 do cartão, ou o H.264 do cartão com a chave da pessoa ligada e o download
  liberado no build); senão a ligação é só de voz. Como o `ligado` conta o H.264 mesmo sem o módulo instalado (ainda
  baixando, ou com a falha), o pedido pode seguir com o motor sem codec que sirva: ele atende com uma ligação só de voz e
  avisa a recusa (abaixo).
- **O 488 e o 415.** Uma ligação discada com vídeo que acaba antes de confirmada com o código 488 ou 415 (a outra ponta
  não aceita o vídeo) é discada de novo pelo controlador, uma vez, para o mesmo número e só com a voz. A tela segue
  contínua: o cartão fica `dialing` (com o `id` da nova ligação, e `0` até o motor dar o dele), o fim da primeira
  tentativa não deixa aviso nem entra nos Recentes, e o toast da recusa sai uma vez. A ligação nova que acaba com 488 ou
  415 termina como qualquer outra (nenhuma terceira discagem), e o 486 e os outros códigos terminam como sempre. A nova
  é só de voz: a câmera não liga.
- **A recusa do vídeo.** Cada recusa (a de um 488/415 que virou voz, e o aviso `refused` do motor) vira um toast, uma
  vez: `Este vídeo precisa do H.264, que ainda não foi baixado.` quando o cartão e a pessoa ligam o H.264 (com o download
  liberado no build) e a `video.h264.situacao` não é `instalado`; nos outros casos, `A outra ponta não aceitou o vídeo.`.
- **No iPhone**, o `dial` e o `answer` passam sempre `false` ao motor (a ligação segue, só de voz), e o `camera` é
  recusado como os outros pedidos de vídeo.

### Contatos e Recentes

| Comando | Campos | O que faz |
|---|---|---|
| `saveContact` | `id` (texto, opcional), `nome` (texto), `numero` (texto), `observacao` (texto, opcional) | Novo contato (sem `id`) ou a edição de um. Nome e número são obrigatórios (depois de tirar os espaços e os separadores); sem eles, nada é gravado. |
| `removeContact` | `id` (texto) | Remove o contato (a interface pede a confirmação antes). |
| `viewRecents` | — | A pessoa abriu a tela Recentes: `perdidas` volta a 0. |
| `importContacts` | — | (rc.4) "Importar planilha…": o executável abre a janela de abrir arquivo do Windows (gancho `pickImportFile`). O arquivo escolhido é lido como a planilha da empresa (`.xlsx` ou CSV, pelo conteúdo) e os contatos novos entram nos meus (`contatos.json`), cada um com um id novo, numa gravação só. Ficam de fora a linha sem nome ou sem número, o contato igual a um meu (o mesmo nome, sem acento e sem caixa, e o mesmo número pelo `NormalizeDialString`) e o repetido dentro da planilha. O resultado vem num toast: `<n> contatos importados.`, `<n> contatos importados (<m> já existiam).` (`<m>`: os meus que a planilha trouxe de novo; o número 1 vai no singular: `1 contato importado.`, `(1 já existia)`), `Nenhum contato novo na planilha.`, `Não consegui ler a planilha. Ela precisa das colunas Nome e Número.`, `A planilha é grande demais (o máximo é 10.000 contatos).`, `Não consegui abrir o arquivo.` ou `Não consegui salvar o arquivo.` (o disco recusou o `contatos.json`). A janela cancelada: nada, sem toast. |
| `exportContacts` | — | (rc.4) "Exportar planilha…": o executável abre a janela de salvar (gancho `pickExportFile`), e o tipo escolhido decide o formato. Vão só os meus contatos, em ordem alfabética, com o cabeçalho Nome, Número e Observação: o `.xlsx` (uma aba, "Contatos", todas as células como texto) ou o CSV (UTF-8 com BOM, ponto e vírgula). O resultado vem num toast: `<n> contatos exportados.` (`1 contato exportado.`) ou `Não consegui salvar o arquivo.`. A janela cancelada: nada. |
| `setCompanyList` | `link` (texto; pode ser `""`) | (rc.4) O "Salvar" da "Planilha da empresa" (Configurações → Contatos): o link (Google Planilhas; (rc.5) um arquivo CSV ou `.xlsx` do Google Drive, também o `.xlsx` do Drive aberto no Planilhas, o link com `rtpof=true`; OneDrive/SharePoint; Dropbox; outro `https://`) ou o caminho do arquivo (`\\servidor\pasta\arquivo`, `C:\…`, `file:///…`), sem os espaços das pontas (também os invisíveis que o texto copiado traz: U+00A0, que o Outlook clássico e o Word põem, U+2000 a U+200B, U+202F, U+205F, U+3000 e U+FEFF), vai ao `config.json` (`planilha_empresa`) e é lido (ver "A lista da empresa"). O mesmo link de novo é o `refreshCompanyList`. `""` tira a lista: `empresa.situacao` `nenhuma`, a lista vazia na `contatosEmpresa`, e o `contatos-empresa.json` com a lista vazia. Um texto que não é `https://` nem caminho (também o `http://`) fica salvo, com o erro `Use um link https:// ou o caminho de um arquivo.`, e não é lido. |
| `refreshCompanyList` | — | (rc.4) "Atualizar agora": lê a planilha da empresa de novo. Sem link: nada. |

```json
{"v":1,"cmd":"saveContact","nome":"Ana Souza","numero":"(11) 98888-7777","observacao":"cliente"}
{"v":1,"cmd":"saveContact","id":"c1d2e3f4a5b60718","nome":"Ana Souza","numero":"2005","observacao":""}
{"v":1,"cmd":"removeContact","id":"c1d2e3f4a5b60718"}
{"v":1,"cmd":"viewRecents"}
{"v":1,"cmd":"importContacts"}
{"v":1,"cmd":"exportContacts"}
{"v":1,"cmd":"setCompanyList","link":"https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456"}
{"v":1,"cmd":"setCompanyList","link":""}
{"v":1,"cmd":"refreshCompanyList"}
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
    "consulting":false,"colleagueActive":false,"sala":null},
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
  "config":{"bipeFim":true},
  "empresa":{"link":"https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456","situacao":"ok","erro":"",
             "atualizadaEm":1761062400000,"quantos":230,"vez":1},
  "video":{"ligado":true,"cameras":["Integrated Camera"],"camera":"","cameraDesconectada":false,"teste":false,
           "h264":{"cartao":true,"pessoa":true,"situacao":"instalado"},"janela":"normal"},
  "chat":{"ligado":true,"empresa":"ACME Comércio Ltda","computador":"RECEPCAO-01","contaConectada":true}
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
| `recentes[].nome` | texto | Já resolvido: o do contato com o número, senão (rc.4) o da lista da empresa com o número, senão o que a central mandou, senão `""` (a interface mostra o número). |
| `recentes[].tipo` | `"feita"` \| `"recebida"` \| `"perdida"` | Perdida em vermelho. |
| `recentes[].inicio` | inteiro | Quando a ligação começou (ms desde 1970): os grupos Hoje, Ontem e a data, e a hora. |
| `recentes[].duracao` | inteiro | Quanto durou desde o atendimento, em **milissegundos** (0 na perdida e na feita que não completou). |
| `recentes[].contatoId` | texto | O contato com esse número (`""`: nenhum; a linha oferece "Salvar contato"). Só os meus contatos: com o nome da lista da empresa, `""` (o "Salvar contato" continua). |
| `perdidas` | inteiro | Quantas perdidas desde a última visita aos Recentes (`viewRecents`; na abertura do app, conta do zero). O filtro "Perdidas · <n>". |
| `contatos` | lista | A agenda em ordem alfabética (sem acento e sem caixa): `{id, nome, numero, observacao}` (texto). Só os meus contatos: os da empresa vêm na mensagem `contatosEmpresa` (rc.4). |
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
| `admin` | objeto | (rc.3) A área do administrador. Fechada (`aberto` `false`), só `{aberto, naoPerturbe, atenderAuto, blf, puxa}`, o que a interface precisa para esconder os botões, desativar a chave do BLF e mostrar a ajuda do puxar; aberta, também `puxar`, `codigoPuxar`, `servidores`, `canal` e (0.3.0) os campos do cartão Vídeo. |
| `admin.aberto` | booleano | A área está aberta (a senha certa, há menos de 10 min sem comando). |
| `admin.naoPerturbe`, `admin.atenderAuto` | booleano | Os botões Não perturbe e Atender automático aparecem (`false`: escondidos, e desligados; o Atender automático também some de Configurações e o atalho do Não perturbe some da bandeja). |
| `admin.blf` | booleano | O BLF nos atalhos. `false`: a chave "Mostrar se o ramal está livre" fica desativada, com a ajuda `O administrador não ligou o BLF`. |
| `admin.puxa` | booleano | (rc.3, com a área fechada e aberta) O clique num atalho com o BLF `tocando` puxa a ligação: `true` só com `admin.blf`, `admin.puxar` e um `admin.codigoPuxar` não vazio (o que o `useShortcut` confere, fora o `estado` do atalho). A interface só acrescenta "Num ramal tocando, o clique puxa a ligação." à ajuda da aba Atalhos com ele `true`. Não é sensível: o código continua só com a área aberta. |
| `admin.puxar`, `admin.codigoPuxar` | booleano, texto | "Puxar ligação pelo atalho" e o "Código para puxar a ligação" (com `{ramal}`). Só com `aberto`. |
| `admin.servidores` | lista | `{endereco: texto, porta: inteiro}`: a tabela de portas (ver `adminSet`). Só com `aberto`. |
| `admin.canal` | `"teste"` \| `"estavel"` \| `""` | O canal de atualização (`""`: o do build). Só com `aberto`. |
| `admin.videoH264`, `admin.videoVp8`, `admin.videoVp9` | booleano | (0.3.0) O cartão Vídeo: os codecs ligados (ver `adminSet`). De fábrica `true`, `true` e `false`. Só com `aberto`. |
| `admin.videoPrimeiro` | `"h264"` \| `"vp8"` \| `"vp9"` | O codec que vai primeiro (`"h264"` de fábrica). Só com `aberto`. |
| `admin.videoQualidade` | `"baixa"` \| `"media"` \| `"alta"` | A qualidade do vídeo (`"media"` de fábrica). Só com `aberto`. |
| `admin.porteiros` | lista de textos | Os Porteiros (`[]` de fábrica). Só com `aberto`. |
| `entrarAdmin` | objeto | (rc.3) O resultado do último `adminLogin`: `{erro, esperaAte, vez}`. `erro`: `Senha incorreta.` ou `""` (o da última tentativa). `esperaAte`: até quando (ms desde 1970) o `adminLogin` é recusado depois de 5 senhas erradas seguidas (o diálogo espera até `Date.now() >= esperaAte`); `0` sem espera. `vez`: sobe a cada `adminLogin` respondido (a senha certa, a errada e a recusada na espera; começa em 0), como o `tecladoVez`: duas erradas seguidas têm o mesmo `erro`, e só a `vez` diz que a segunda foi respondida. **Quando a `vez` muda**, a interface limpa o campo Senha e mostra o `erro` (nenhum: a área abriu); fora disso, o `erro` que está no estado é de uma tentativa velha e não aparece (por exemplo, ao abrir o diálogo de novo). |
| `config` | objeto | (rc.3) Configurações novas: `{bipeFim}`. |
| `config.bipeFim` | booleano | "Bipe quando a ligação cai ou termina" (`setSetting` `bipeFim`; ligado de fábrica). |
| `empresa` | objeto | (rc.4) A lista da empresa (Configurações → Contatos): `{link, situacao, erro, atualizadaEm, quantos, vez}`. Os contatos vêm na mensagem `contatosEmpresa` (ver "A lista da empresa"). |
| `empresa.link` | texto | O texto salvo (`setCompanyList`), como foi digitado, sem os espaços das pontas (também os invisíveis); `""` sem a lista da empresa. |
| `empresa.situacao` | `"nenhuma"` \| `"lendo"` \| `"ok"` \| `"erro"` | `nenhuma`: sem link. `lendo`: uma leitura do link de agora está aberta ou espera a que está aberta ("Lendo a planilha…"). `ok`: a última leitura foi boa ("Atualizada às 14:32 · 230 contatos"). `erro`: a última falhou, ou o link não vale (o texto em `erro`; com `atualizadaEm` maior que 0, a lista de antes continua: "Última lista: às 14:32 · 230 contatos"). |
| `empresa.erro` | texto | Com `situacao` `erro`, o texto da situação: `Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link.` (401, 403, 404, ou uma página de entrar no lugar da planilha), `Sem conexão com a planilha. Fica a última lista.` (sem rede, servidor fora do ar, tempo esgotado), `Não achei o arquivo. Confira o caminho e se este computador tem acesso à pasta.`, `Use um link https:// ou o caminho de um arquivo.`, `Não consegui ler a planilha. Ela precisa das colunas Nome e Número.`, `A planilha é grande demais (o máximo é 10.000 contatos).` ou `Não consegui salvar o arquivo.` (a leitura foi boa, mas o disco recusou o `contatos-empresa.json`: a lista de antes continua). `""` fora do `erro`. |
| `empresa.atualizadaEm` | inteiro | A hora da última leitura boa (ms desde 1970), também de uma abertura anterior (o `contatos-empresa.json`); `0` sem nenhuma. A interface escreve a hora local ("às 14:32", ou "em 26/10 às 14:32" se não for de hoje). |
| `empresa.quantos` | inteiro | Os contatos da lista de agora (a da última leitura boa). |
| `empresa.vez` | inteiro | Sobe a cada lista nova (a guardada, na abertura; uma leitura boa; a lista vazia quando o link sai); `0` sem nenhuma lista desde a abertura do app. É a `vez` da última `contatosEmpresa`. |
| `video` | objeto | (0.3.0) As escolhas do vídeo, a câmera e o módulo H.264: `{ligado, cameras, camera, cameraDesconectada, teste, h264, janela}`. Vem sempre, também no iPhone (neutro, com `ligado` `false`). Vem antes do `chat`. |
| `video.ligado` | booleano | Há vídeo nas escolhas: algum codec que vale, o VP8 ou o VP9 ligado no cartão, ou o H.264 ligado no cartão e pela pessoa, com o download liberado no build (o H.264 conta mesmo sem o módulo instalado, para o botão não sumir enquanto ele baixa). `false` sem nenhum: os três codecs desligados, ou só o H.264 com a chave da pessoa desligada. Sempre `false` no iPhone. |
| `video.cameras` | lista de textos | Os nomes das câmeras do motor, na ordem dele; relida junto com os dispositivos de som (o aviso do `WM_DEVICECHANGE`: `RefreshAudioDevices`). |
| `video.camera` | texto | A câmera escolhida (`setVideo`); `""` é a primeira. |
| `video.cameraDesconectada` | booleano | `video.camera` não está vazio e não está em `video.cameras`. |
| `video.teste` | booleano | O teste da câmera está ligado (`cameraTest`). Segue `true` com a tela bloqueada (a câmera dele fecha e volta no desbloqueio); o `ready` da janela principal o desliga. |
| `video.h264` | objeto | `{cartao, pessoa, situacao}`: o H.264 ligado no cartão do administrador (`cartao`), a chave da pessoa (`pessoa`) e o módulo da Cisco. |
| `video.h264.situacao` | `"desligado"` \| `"baixando"` \| `"instalado"` \| `"falhou"` | `desligado`: o cartão ou a pessoa desliga o H.264, ou o build não baixa o módulo (a opção `STARSONIC_H264_DOWNLOAD` desligada; o app a liga desde a etapa 2). Na abertura, ou quando o H.264 volta a ser ligado, e se ainda não está instalado, vira `baixando` (o gancho `h264Ensure`); `instalado` ou `falhou` chegam pelo `DesktopApp::SetH264State`. Um `SetH264State` com o H.264 desligado não muda nada. O motor só recebe o H.264 (`h264Available`) com o download liberado, o cartão ligado, a pessoa ligada e a situação `instalado`. |
| `video.janela` | `"normal"` \| `"grande"` \| `"telaCheia"` | O modo da janela do vídeo (`videoWindow`); volta a `normal` quando a última ligação acaba. |
| `chat` | objeto | (0.2.0, só no Windows: o estado do iPhone não tem o campo) O chat deste computador: `{ligado, empresa, computador, contaConectada}` (ver "O chat (0.2.0)"). A chave nunca vem no estado. |

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
| `sala` | objeto \| `null` | (0.4.0) A sala de vídeo em grupo, em cima ou em espera (ver "A sala de vídeo (0.4.0)"); `null` sem sala. |

Cada cartão (`top`, `second`):

| Campo | Tipo | Sentido |
|---|---|---|
| `id` | inteiro | O id da ligação no motor; `0` numa feita que ainda não tem id (ver `hangup`). |
| `number` | texto | O número. |
| `name` | texto | Já resolvido: o do contato com o número, senão (rc.4) o da lista da empresa com o número, senão o que a central mandou; `""` sem nenhum (a interface mostra o número). O mesmo nome vai no aviso de perdida (`Ligação perdida de <nome>`). |
| `incoming` | booleano | Recebida (`true`) ou feita. |
| `phase` | `"ringing"` \| `"dialing"` \| `"active"` | Tocando (recebida), chamando (feita) ou em andamento. Uma recebida atendida aqui fica `active` com `activeSinceMs` 0 até o motor confirmar. |
| `activeSinceMs` | inteiro | Quando os dois lados atenderam (ms desde 1970; 0: ainda não). O tempo da ligação é `Date.now() - activeSinceMs`. |
| `held` | booleano | Em espera. |
| `video` | objeto | (0.3.0) O vídeo da ligação: `{oferece, ativo, imagem, camera, cedo, porteiro}`, os campos `offered`, `active`, `remote`, `camera`, `early` e `doorphone` do `CallVideo`, nessa ordem. `oferece`: a recebida oferece vídeo com um codec em comum. `ativo`: o vídeo negociado e a ligação sem pausa. `imagem`: a imagem da outra ponta está chegando. `camera`: a nossa câmera está mandando. `cedo`: o 183 com imagem de um Porteiro, até o atender ou o fim. (0.3.0-rc.2) `porteiro`: a recebida de um número dos Porteiros que oferece vídeo com um codec em comum, do toque ao fim, também depois de atender (o `cedo` acaba no atender). Com outra ligação, a imagem de um Porteiro não pausa (decisão do responsável de 11/11/2026): o `ativo` e o `imagem` seguem, com ele tocando (o aviso a mostra pelo `cedo`) ou atendido (a tela da ligação e o grande a mostram quando ele é a de cima, fora da conferência); a nossa câmera não manda para ele enquanto houver outra ligação (o `camera` fica `false`). A espera, a conferência e a transferência pausam o porteiro como qualquer ligação. Tudo `false` numa ligação só de voz. Vem em `top` e em `second`. |

O aviso de 2 s que o controlador tem (o `endMessage`: `Ocupado`, `Não atendeu`, `<nome ou número> desligou`,
`<nome ou número>: <motivo>` do colega e (0.4.0) do convidado da sala que não entra, `O servidor não aceitou a
transferência.`, `Sem conexão com o servidor. Tente de novo em instantes.`) não vem no estado: ele chega como um
`toast`, uma vez, quando aparece.

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

## A lista da empresa (rc.4)

A planilha da empresa (spec da rc.4, seção 5): um link ou um caminho em Configurações → Contatos (`setCompanyList`),
lido pelo executável fora da thread de comandos (o gancho `fetchCompanyList`), em CSV ou `.xlsx`, com a mesma leitura
do `importContacts`. A última lista boa fica no `contatos-empresa.json`, na pasta de dados.

- **Quando o C++ lê:** ao abrir o app, com o link salvo (a lista guardada já aparece antes da leitura, com `situacao`
  `lendo`); a cada 15 minutos, contados da última leitura que começou (um "Atualizar agora" recomeça a conta); no
  `setCompanyList` e no `refreshCompanyList`.
- **Uma leitura por vez:** um pedido no meio de uma leitura espera ela voltar e roda uma vez só depois, com o link
  salvo de agora.
- **Uma leitura boa** troca a lista inteira, também por uma vazia (a planilha só com o cabeçalho), grava o
  `contatos-empresa.json` e manda a `contatosEmpresa` com a `vez` nova. **Uma que falha** deixa a lista de antes (na
  memória e no arquivo) e põe o motivo em `empresa.erro`.
- **O link trocado:** a lista de antes fica até a primeira leitura boa do link novo. Uma leitura que volta depois de o
  link mudar (ou sair) é descartada: nada muda por ela.
- **O link tirado** (`setCompanyList` com `""`): a lista sai (a `contatosEmpresa` com a lista vazia) e nada mais é
  lido. Na abertura sem o link, a lista é vazia (e o `contatos-empresa.json` fica com a lista vazia).
- **Os nomes nas ligações** (a recebida, o aviso do canto, os Recentes e o toast da perdida): o meu contato com o
  número, senão o da lista da empresa, senão o nome que a central mandou (os números comparados pelo
  `NormalizeDialString`).
- **O diagnóstico** nunca leva o link (ele pode ser uma chave de acesso) nem os nomes e os números dos contatos: só o
  tipo da fonte (`lista da empresa: lendo (Google)`, e `Google (publicado)`, (rc.5) `Google Drive`, `OneDrive`,
  `SharePoint`, `Dropbox`, `link` ou `caminho`) e as contagens.

A mensagem:

- `{"v":1,"type":"contatosEmpresa","vez":N,"contatos":[{"nome","numero","observacao"}]}` (texto), na ordem da
  planilha: a interface ordena e junta com os meus. Ela fica fora do `state` porque a lista pode ter 10.000 contatos, e
  o `state` vai inteiro a cada mudança.
- Vem a cada lista nova, com a `vez` que o `empresa.vez` também passa a ter (ela pode chegar antes do `state` com essa
  `vez`), e no `ready`, depois do estado e do toque, quando já houve uma lista desde a abertura (`empresa.vez` maior
  que 0). Com `vez` 0 não há lista: a interface começa vazia.
- A lista vazia vem quando o link sai.

```json
{"v":1,"type":"contatosEmpresa","vez":2,"contatos":[{"nome":"Recepção","numero":"3001","observacao":"Térreo"},{"nome":"Ana Souza","numero":"(11) 3002-0000","observacao":""}]}
{"v":1,"type":"contatosEmpresa","vez":3,"contatos":[]}
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

## O chat (0.2.0)

O chat da empresa, só no Windows: o servidor e a API estão no `docs/chat-protocolo.md`. A interface fala com o servidor
do chat sozinha (a API e os eventos). O C++ guarda a chave do computador, sabe quais ramais já se conectaram à central
neste computador e faz o que só o executável faz: o aviso do Windows, o número no ícone da barra de tarefas e o
download dos arquivos.

- **O `chat.json`**, na pasta de dados, guarda a chave do computador, o nome da empresa dela e os ramais conectados:
  `{"v":1,"chave":"…","empresa":"…","ramais":["servidor|ramal"]}`. Ele passa inteiro pelo DPAPI do usuário, como o
  `admin.json`. Fora do chat, ele vai sem a chave e a empresa.
- **Um `chat.json` que não se lê** (não decifra, não é JSON ou é de outra versão) deixa o computador fora do chat, com a
  linha `chat.json ilegivel: o computador fica desligado do chat`. O arquivo fica no disco como está nessa abertura:
  um registro não o troca (o ramal fica só na memória), e só o `chatLink` ou o `chatUnlink` gravam um arquivo novo.
  Depois de um deles, tudo volta ao de sempre. Assim, um DPAPI que ainda não respondeu logo depois de entrar no Windows
  (o app abre com o Windows) não apaga a chave do computador no primeiro registro.
- **Os ramais conectados:** a cada registro (2xx) da conta do motor, também o do Entrar, o par `servidor|ramal` dela
  entra no `chat.json`, se ainda não estava (com o `chat.json` que não se lê, só na memória: ver acima). O servidor vai
  em minúsculas, e os dois sem os espaços das pontas. O `chatUnlink` não tira os ramais.
- **A chave nunca vai no estado nem no diagnóstico.** Ela só vem na `chatChave`, a resposta ao `chatKey`, que o
  executável manda só para a janela principal (nunca para o `aviso.html`).
  - O diagnóstico também nunca leva a empresa, o texto de uma mensagem, o título e o texto do aviso, o nome ou o
    caminho de um arquivo, nem o nome de uma pessoa. As linhas do chat são só estas:
    - cada comando, pelo nome: `chat: chatKey`, `chat: chatLink`, `chat: chatUnlink`, `chat: chatNotify` e
      `chat: chatDownload`; o `chatBadge`, só quando o número muda, com ele: `chat: chatBadge 3`. No lugar da linha do
      comando, o `chatNotify` com o Não perturbe ligado deixa `chat: aviso calado (nao perturbe)`, e o `chatDownload`
      sem a chave, `chat: chatDownload ignorado (sem a chave)`;
    - o `chat.json`: `chat.json ilegivel: o computador fica desligado do chat` (na abertura),
      `chat.json: a chave do chat nao foi gravada` (o `chatLink`), `chat.json: a chave do chat nao foi apagada` (o
      `chatUnlink`) e `chat.json: o ramal conectado nao foi gravado` (um registro);
    - o download: `chat: download <status> <bytes>` (a resposta do servidor: o status HTTP, 0 sem resposta, e o
      tamanho) e `chat: download recusado (o id do arquivo)`. O arquivo que veio (o 200) e não foi gravado na pasta
      Downloads (a pasta que o Windows não deu, o disco sem o fluxo `Zone.Identifier`, o caminho comprido demais, o
      disco cheio) deixa `chat: download nao gravado (<código>)`, no lugar do `chat: download 200 <bytes>`, com o código
      de erro do Windows da chamada que falhou, em decimal (`chat: download nao gravado (112)`); a pasta Downloads que
      falhou sem um código da Win32 leva o HRESULT, em hexadecimal (`chat: download nao gravado (0x80004005)`);
    - o aviso e o número que o Windows recusou, com o nome da operação e o HRESULT em hexadecimal:
      `aviso: Shell_NotifyIconW falhou (0x80004005)` e `numero no icone: <operação> falhou (0x…)`, com a operação
      `CoCreateInstance`, `HrInit` ou `SetOverlayIcon`;
    - `chat: sem o aviso de bloqueio da sessao (<código>)`: o Windows não avisa o executável quando a sessão bloqueia,
      e a janela conta como na frente só por ela (visível, sem minimizar e ativa).
  - A navegação para fora do app, nas duas janelas, é bloqueada, e a linha leva só o esquema do endereço, com o host
    no `http`, `https`, `ws` e `wss`: nunca o caminho, a consulta, o fragmento, a porta, nem o usuário e a senha. Por
    exemplo: `navegacao bloqueada: file:` (um arquivo solto na janela), `navegacao bloqueada: https://exemplo.com` e
    `janela nova bloqueada: blob:`. Um endereço sem esquema vai como `(sem esquema)`. Na janela do aviso de ligação, a
    linha começa com `aviso: ` (`aviso: navegacao bloqueada: file:`).
  - Um comando recusado deixa `comando ignorado: <comando>: <motivo>`, e o motivo diz o campo, nunca o valor:
    `chatLink: chave invalida`, `chatNotify: titulo invalido`, `chatBadge: falta o campo n`. No iPhone, os comandos do
    chat são recusados com `comando recusado no modo iPhone: <comando>` (ver "O modo iPhone").

### O campo do estado

`"chat":{"ligado":true,"empresa":"ACME Comércio Ltda","computador":"RECEPCAO-01","contaConectada":true}`, depois do
`empresa`. O campo vem sempre no Windows e nunca no iPhone.

| Campo | Tipo | Sentido |
|---|---|---|
| `chat.ligado` | booleano | Há uma chave guardada: o computador está ligado ao chat. |
| `chat.empresa` | texto | O nome da empresa guardado com a chave; `""` sem ela. |
| `chat.computador` | texto | O nome do computador no Windows. |
| `chat.contaConectada` | booleano | A conta em uso já se conectou à central neste computador, pelo par `servidor\|ramal` (ver acima). `false` sem conta em uso, e numa conta que ainda não registrou neste computador (também uma da migração). |

### Os comandos do chat

| Comando | Campos | O que faz |
|---|---|---|
| `chatKey` | — | Pede a chave. O C++ responde com a mensagem `chatChave`. |
| `chatLink` | `chave` (texto: 43 de `[A-Za-z0-9_-]`), `empresa` (texto: 1 a 80 caracteres, sem caractere de controle) | Guarda a chave e a empresa, no lugar das de antes, e o `chat.ligado` passa a `true`. Se não conseguir gravar, nada muda e vem o toast `Não foi possível ligar este computador ao chat.`. |
| `chatUnlink` | — | Apaga a chave e a empresa (os ramais ficam), e o `chat.ligado` passa a `false`. |
| `chatNotify` | `conversa` (inteiro ≥ 0), `titulo` (texto: 1 a 200 caracteres), `texto` (texto: 0 a 500 caracteres) | Mostra o aviso do Windows (o gancho `chatNotice`). Com o Não perturbe ligado (`naoPerturbe`), não mostra nada, e o diagnóstico ganha só `chat: aviso calado (nao perturbe)`. O clique no aviso volta como o `abrir` do chat, com a mesma `conversa`. `conversa` 0 faz o aviso abrir a aba Chat. |
| `chatBadge` | `n` (inteiro ≥ 0) | Põe o número no ícone da barra de tarefas (o gancho `chatBadge`; 0 tira o número). O C++ só repassa quando o número muda. Na abertura, o número é 0. |
| `chatDownload` | `arquivo` (texto: 32 de `[0-9a-f]`), `nome` (texto: 1 a 255 caracteres) | Baixa o arquivo com a chave guardada (o gancho `chatDownload`), para a pasta Downloads, marca como vindo da internet e abre. Sem a chave, o comando é ignorado (linha no diagnóstico). |

- Os caracteres são pontos de código: um acento ou um emoji conta um.
- Um campo fora da regra faz o comando ser ignorado inteiro, como um campo do tipo errado: por exemplo, a chave de 42
  caracteres, a empresa vazia, a `conversa` -1, o `titulo` vazio ou de 201 caracteres, o `texto` de 501, o `n` -1 ou
  `"3"`, o `arquivo` em maiúsculas e o `nome` vazio.
- O `chatKey`, o `chatNotify` e o `chatBadge` vêm do chat, sem a pessoa: com a área do administrador aberta, eles não
  recomeçam os 10 minutos.
- No iPhone, os seis são recusados como os outros comandos do PC (ver "O modo iPhone").

```json
{"v":1,"cmd":"chatKey"}
{"v":1,"cmd":"chatLink","chave":"Exemplo_de-chave-inventada-0123456789abcdef","empresa":"ACME Comércio Ltda"}
{"v":1,"cmd":"chatUnlink"}
{"v":1,"cmd":"chatNotify","conversa":7,"titulo":"Ana Souza","texto":"Bom dia! O pedido chegou."}
{"v":1,"cmd":"chatBadge","n":3}
{"v":1,"cmd":"chatDownload","arquivo":"0123456789abcdef0123456789abcdef","nome":"Pedido 123.pdf"}
```

### As mensagens do chat

- `{"v":1,"type":"chatChave","chave":"…","empresa":"…"}`: a resposta ao `chatKey`, com `""` e `""` quando o computador
  não está ligado ao chat. A chave nunca vem no estado.
- `{"v":1,"type":"janela","frente":true}`: diz se a janela principal está na frente, isto é, visível, sem minimizar e
  ativa, com a sessão do Windows desbloqueada e conectada (na tela bloqueada a pessoa não vê nada). Vem depois do
  estado a cada `ready` (no fim das mensagens dele) e de novo a cada mudança. Antes da primeira, a interface considera
  `false`.
- `{"v":1,"type":"abrir","tela":"chat","conversa":7}`: a pessoa clicou no aviso do chat. Com `conversa` 0, a interface
  vai para a aba Chat. Um pedido antes do primeiro `ready` fica para ele, depois do estado (no fim das mensagens dele);
  dois antes dele dão um `abrir` só, o do último clique. Depois, ele vem na hora, uma vez por clique.

```json
{"v":1,"type":"chatChave","chave":"Exemplo_de-chave-inventada-0123456789abcdef","empresa":"ACME Comércio Ltda"}
{"v":1,"type":"chatChave","chave":"","empresa":""}
{"v":1,"type":"janela","frente":true}
{"v":1,"type":"abrir","tela":"chat","conversa":7}
```

### Os toasts do chat

- `Arquivo expirado`: o download respondeu 410 (o executável manda pelo `DesktopApp::Notify`).
- `Não foi possível baixar o arquivo.`: qualquer outro erro do download (também pelo `Notify`).
- `Não foi possível ligar este computador ao chat.`: o `chatLink` não gravou.

## A sala de vídeo (0.4.0)

A videochamada em grupo, só no Windows (spec do vídeo em grupo): quem monta a sala (este app) liga para os convidados,
e todos se ouvem e se veem. A sala tem até 6 pessoas: quem monta e mais 5 convidados, contando os que ainda são
chamados. Cada convidado é uma ligação, com o id e os eventos de sempre; a sala é uma linha da tela, com um id próprio
(do mesmo contador das ligações), que nasce no lugar da ligação de onde ela vem. As telas da sala e a ponte falsa delas
(`windows/ui/src/fake.ts`) seguem na etapa 3b: até lá, a interface não usa os comandos nem o `ligacao.sala` abaixo.

### Os comandos da sala

| Comando | Campos | O que faz |
|---|---|---|
| `salaAdicionar` | `numero` (texto), `contato` (booleano, opcional) | "Adicionar à sala": o app liga para o número e o põe na sala, onde ele aparece chamando. Sem sala, ela nasce da ligação de agora, que precisa ser a única, em andamento, fora da espera, sem consulta, conferência ou transferência esperando o resultado, e com o vídeo ativo (`top.video.ativo`). Com sala, ela precisa estar em cima, com você nela (`sala.fora` `false`) e sem a `sala.cheia`. Um convidado por vez: outro `salaAdicionar` antes de o primeiro aparecer em `sala.participantes` não faz nada. Com `contato: true`, o número passa antes pela regra dos contatos do perfil, como no `dial`. Sem registro, o toast `Sem conexão com o servidor. Tente de novo em instantes.` e ninguém é chamado, como no `dial`. Fora desses casos, nada acontece (sem toast). |
| `salaTirar` | `id` (inteiro ≥ 1) | "Tirar da sala": o convidado com esse `id` (o de `sala.participantes`) sai, sem aviso: o app desliga a ligação dele. Sem um convidado com o `id`, ou com ele já saindo, nada. Sem o `id`, com `0`, negativo, com fração ou em texto, o comando é recusado na leitura (linha no diagnóstico). |
| `salaEncerrar` | — | "Encerrar a sala": o app desliga todos os convidados, sem aviso, e a sala sai da tela na hora (`ligacao.sala` `null`; sem outra ligação, `ligacao` `null`). Vale com a sala em cima ou em espera; sem sala, nada. A interface pergunta antes. Com a ligação de fora em espera, ela fica sozinha na tela e volta sozinha quando a sala acaba, como a outra de duas ligações. |
| `salaVoltar` | — | "Voltar para a sala": com você fora dela (`sala.fora` `true`, ou a sala em espera), a ligação de fora vai para a espera e a sala volta para cima, com a nossa voz e a nossa câmera de volta nela. Já na sala, nada. |

```json
{"v":1,"cmd":"salaAdicionar","numero":"2004"}
{"v":1,"cmd":"salaAdicionar","numero":"+55 11 98888-7777","contato":true}
{"v":1,"cmd":"salaTirar","id":31}
{"v":1,"cmd":"salaEncerrar"}
{"v":1,"cmd":"salaVoltar"}
```

Os comandos de sempre com a sala:

- **O `hangup` com a sala em cima** (sem `id`, ou com o `id` da sala, também com ela em espera) é o `salaEncerrar`: a
  interface pergunta antes, como no Encerrar. O `id` de um convidado não faz nada: um convidado não é uma linha (o
  Tirar da sala é o `salaTirar`).
- Com a sala em cima, `hold`, `transfer`, `consult` e `dtmf` não fazem nada; com a sala de pé (em cima ou em espera),
  nem `join` nem `split`. O `camera` com a sala em cima liga ou desliga a nossa câmera para os convidados.
- **A ligação de fora:** com a sala de pé, cabe uma ligação de fora, só com a voz. A recebida toca como a segunda
  (`secondKind` `ringing`, o toque `espera`); o `answer` a atende só com a voz (também com `video: true`), e o `dial` é
  a Nova ligação, também só com a voz. Atendida ou feita, ela fica em cima e tira você da sala: a sala vai para a
  espera, como o `second` (`secondKind` `held`, `sala.fora` `true`), e os convidados seguem se vendo e se ouvindo, sem
  você. Quando a de fora acaba, a sala volta sozinha. Uma terceira ligação que chega leva ocupado (486) e vai aos
  Recentes como perdida, com o aviso de perdida, como hoje.

### O `ligacao.sala`

O campo vem depois do `colleagueActive`: `null` sem sala (como o `second`), e a sala de pé, em cima ou em espera. A
sala de cima, com um convidado na sala e um chamando:

```json
"ligacao":{
  "top":{"id":30,"number":"","name":"","incoming":false,"phase":"active","activeSinceMs":1762873200000,"held":false,
         "video":{"oferece":false,"ativo":true,"imagem":true,"camera":true,"cedo":false,"porteiro":false}},
  "second":null,"secondKind":"none","muted":false,"conference":false,"conferenceSinceMs":0,
  "consulting":false,"colleagueActive":false,
  "sala":{"id":30,"fora":false,"cheia":false,"participantes":[
    {"id":11,"numero":"2002","nome":"Ana Souza","estado":"naSala","imagem":true,
     "quadro":{"x":0,"y":0,"largura":0.5,"altura":1}},
    {"id":31,"numero":"2004","nome":"","estado":"chamando","imagem":false,
     "quadro":{"x":0.5,"y":0,"largura":0.5,"altura":1}}]}}
```

Sem sala, `ligacao.sala` é `null`. Fora da sala, a de cima é a ligação de fora, e a sala é a `second` (`secondKind`
`held`, `sala.fora` `true`).

**A linha da sala** (o cartão em `top`, ou em `second` com você fora): o `id` da sala, `number` e `name` vazios,
`incoming` `false`, `phase` `active`, o `activeSinceMs` da ligação de onde ela nasceu (o tempo segue o dela) e o `held`
da espera. O `video` é o da sala: `ativo` com ela de pé, `imagem` com o mosaico chegando ao `remoto` (abaixo) e `camera`
com a nossa câmera chegando aos convidados; `oferece`, `cedo` e `porteiro` são `false`. Quando a sala nasce, o cartão da
ligação sai e o da sala entra no lugar dele, com o mesmo tempo, e a ligação vai para dentro da sala, como o primeiro
convidado. Os convidados não são linhas: eles vêm só em `sala.participantes`.

| Campo | Tipo | Sentido |
|---|---|---|
| `sala.id` | inteiro | O id da sala: o `id` da linha dela (`top.id`, ou `second.id` com você fora). |
| `sala.fora` | booleano | Você está fora da sala: a nossa voz e a nossa câmera saíram dela (a ligação de fora). Os convidados seguem se vendo e se ouvindo. |
| `sala.cheia` | booleano | A sala tem 5 convidados, contando os chamados: o `salaAdicionar` não faz nada. |
| `sala.participantes` | lista | Os convidados, na ordem em que entraram: `{id, numero, nome, estado, imagem, quadro}`. O primeiro é a ligação de onde a sala nasceu. Quem monta a sala não está na lista. |
| `sala.participantes[].id` | inteiro | O id da ligação do convidado no motor (o do `salaTirar`). |
| `sala.participantes[].numero` | texto | O número. |
| `sala.participantes[].nome` | texto | Já resolvido, como nos cartões: o do contato com o número, senão o da lista da empresa, senão o que a central mandou; `""` sem nenhum (a interface mostra o número). |
| `sala.participantes[].estado` | `"chamando"` \| `"naSala"` \| `"emEspera"` | `chamando`: o app ainda chama; `naSala`: atendeu e está na sala; `emEspera`: ele pôs a ligação em espera (o quadro dele fica com o fundo até ele voltar). |
| `sala.participantes[].imagem` | booleano | A imagem dele está chegando. Um convidado sem câmera, ou que atendeu sem o vídeo, fica com o fundo no quadro e segue ouvindo e sendo ouvido. |
| `sala.participantes[].quadro` | objeto | `{x, y, largura, altura}`: o quadro dele no mosaico do `remoto` (abaixo), em frações de 0 a 1 da imagem, com `x` e `y` do canto de cima à esquerda. A interface põe o nome e o estado de cada um sobre o quadro dele. |

### Os avisos, os Recentes e o fim da sala

- **O convidado que não entra** (não atendeu, estava ocupado ou recusou): ele sai da lista, e o toast
  `<nome ou número>: <motivo>` aparece por 2 s, como o do colega da consulta (por exemplo, `Carlos Lima: Ocupado`). O
  toast não vem quando o núcleo não tem um motivo para o código, nem quando a ligação nem saiu. O convidado tirado pelo
  `salaTirar`, ou com o `salaEncerrar`, sai sem aviso.
- **Os Recentes:** cada convidado entra nos Recentes no fim da ligação dele, como uma feita (o primeiro, como a ligação
  de onde a sala nasceu), com a duração desde que ele atendeu. A sala não entra.
- **O fim da sala:** com um convidado só (contando os chamados), a sala acaba. Ele volta a ser uma ligação comum, no
  lugar da sala, com o `id` dele e o Desligar de sempre, e o `ligacao.sala` volta a `null`. Sem ninguém, a linha da sala
  sai, e a ligação de fora, se a sala era a de cima, volta sozinha.

### O mosaico no `remoto`

Com a sala em cima, a vista `remoto` mostra o mosaico de quem montou: uma imagem de 1280×720, a 25 quadros por segundo,
com todos os convidados (também os chamados), cada um no `quadro` dele, e o fundo da página (`#04060e`) onde não há
imagem. Ele chega na memória do `remoto` (ver "A memória do vídeo") como a imagem de uma ligação, com o id da sala, que
é o `top.id`: a página o desenha como desenha a ligação de cima. Como em toda troca da ligação de cima, a memória
esvazia (o `seq` volta a 0) quando a sala nasce (o `top.id` passa do id da ligação para o da sala) e quando ela acaba
(o `top.id` passa para o de quem ficou, ou para nenhum): o mosaico nunca começa com o último quadro da ligação de antes,
nem a ligação que fica com o último mosaico. A imagem de cada convidado não vai a nenhuma vista: ela já está no
mosaico.

### O diagnóstico da sala

Cada aviso da sala deixa uma linha no diagnóstico, exatamente uma destas. Elas nunca levam um nome ou um número de
telefone: só a contagem e o código SIP.

- `sala: comecou`: a sala nasceu;
- `sala: entrou (<n> na sala)`: um convidado atendeu; `<n>` são os convidados que atenderam e seguem na sala;
- `sala: saiu (<n> na sala)`: um convidado saiu (do outro lado, ou tirado daqui pelo `salaTirar` ou pelo `salaEncerrar`,
  também ainda chamando), com o mesmo `<n>`;
- `sala: falhou (<codigo>)`: um convidado não entrou, com o código SIP do fim, ou `0` quando a ligação nem saiu;
- `sala: fora` e `sala: voltou`: você saiu da sala (a ligação de fora) e voltou para ela;
- `sala: acabou`: a sala acabou, também no `quit` com a sala de pé (cada `sala: comecou` tem a sua `sala: acabou`).

### No iPhone

O motor do iPhone não tem vídeo nem sala: os quatro comandos são recusados como os do PC, com a linha
`comando recusado no modo iPhone: <nome>` (ver "O modo iPhone"), e o `ligacao.sala` é sempre `null`.

### Para o executável

- O `EngineHost` é o `CallEngine` da sala: o `RoomAdd(numero)` (desde a Task 7 da etapa 3a) vai ao `SipEngine::RoomAdd`,
  na thread de comandos, esperando o motor ficar pronto, como o `MakeCall`.
- O `OnRoom` do motor (a sala inteira, a cada mudança) passa do `EngineHost` ao `DesktopApp`, que o entrega direto ao
  controlador, na thread de eventos do motor, como o `OnCallState` e o `OnCallVideo`.
- O mosaico de quem montou chega ao sink do vídeo como a imagem de uma ligação (`OnRemoteFrame`), com o id da sala: a
  rota do vídeo o leva ao `remoto` porque a sala é a de cima (o `ligacao.top.id` do estado), sem nada novo no
  executável. A imagem de cada convidado chega com o id da ligação dele e não vai a nenhuma vista.
- Nenhum gancho novo.

## Para o executável (Tasks 11 e 12)

- O `DesktopApp` roda tudo numa thread de comandos própria; `post` é chamado só nela, uma mensagem por vez, na
  ordem: o executável repassa cada uma ao `PostWebMessageAsJson` (na thread da janela), nas duas páginas: a janela
  principal (`index.html`) e o aviso de ligação recebida (`aviso.html`, um segundo WebView2 com o mesmo ambiente). A
  `chatChave` (0.2.0) vai só para a janela principal.
  Os comandos das duas vão ao mesmo `DesktopApp`; o `answer` do aviso também traz a janela principal para a frente.
  (0.3.0) Os do aviso vão com `HandleCommand(json, true)`: o `ready` dele não desliga o teste da câmera.
  `HandleCommand` pode ser chamado da thread da janela (ele só lê o JSON e põe na fila).
- O executável lê o `state` que passa (sem perguntar ao `DesktopApp`): com uma recebida tocando (`top.phase`
  `ringing`, ou `secondKind` `ringing` fora da conferência) e a janela fora da frente, o aviso aparece. (0.3.0-rc.2)
  Com a janela na frente, ele aparece só com um Porteiro tocando como a segunda ligação, com a imagem dele chegando
  antes do atender: o `secondKind` `ringing`, fora da conferência, com a de cima sem tocar, e o `second.video.cedo`
  `true` (decisão do responsável de 11/11/2026). Ele abre sem tomar o foco da janela; a tela da ligação segue com o
  cartão da segunda (`Ligação de …`, com Recusar e Atender). Uma segunda comum (ou um porteiro sem a imagem) e uma de
  cima tocando seguem sem o aviso com a janela na frente. O ícone da bandeja segue a tabela da bolinha (rc.3; vale a
  primeira que bate, Ruling 17): sem internet (`conta.internet` `false`), conectando, erro, sem conexão ou sem conta →
  sem conexão; depois a ligação (também tocando) → em ligação; a perdida que a pessoa ainda não viu (`perdidas`) →
  perdida; o Não perturbe (`naoPerturbe`) → não perturbe; e conectado (`conta.status` `conectado`) → conectado. Ele
  pisca enquanto toca. O menu da bandeja manda `setDnd` e `quit` como a interface.
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
- (rc.4) O arquivo novo: `DesktopPaths.companyList` (`contatos-empresa.json`, na pasta de dados).
- (rc.4) Os três ganchos novos são chamados na thread de comandos e nunca esperam; cada um responde uma vez, por um
  callback que pode vir de qualquer thread e só põe o resto na fila de comandos (um que chega depois do `Shutdown()` é
  descartado, com uma linha no diagnóstico). Sem o gancho, o comando só deixa uma linha no diagnóstico.
  - `pickImportFile(callback)`: a janela de abrir arquivo do Windows, na thread da janela (`RunOnWindow`), com os tipos
    "Planilhas (*.xlsx, *.csv)" e "Todos os arquivos"; o callback leva o caminho (UTF-8), ou `""` se a pessoa cancelou.
  - `pickExportFile(callback)`: a janela de salvar, com "Planilha do Excel (*.xlsx)" (a padrão) e "CSV (*.csv)" e o
    nome "Contatos Starsonic.xlsx"; o callback leva o caminho e o formato do tipo escolhido (`"xlsx"` ou `"csv"`), ou
    `""` se cancelou. Outro formato é um erro do executável: nada é gravado, e o toast é `Não consegui salvar o
    arquivo.`.
  - `fetchCompanyList(fonte, callback)`: lê a fonte (`CompanySource`: uma URL `https://` já convertida, pelo WinHTTP,
    até 10 MB; ou um caminho, pelo disco) numa thread do executável, e o callback leva o resultado (`CompanyFetch`: os
    bytes, ou o tipo do erro). O `DesktopApp` pede uma leitura por vez. Ao fechar, o executável para essa thread antes
    do `Shutdown()`: nenhum callback chega a um `DesktopApp` destruído.
- (0.2.0) O chat (ver "O chat (0.2.0)"):
  - O arquivo novo `DesktopPaths.chat` (`chat.json`, na pasta de dados, pelo mesmo cifrador das senhas: o DPAPI). Sem o
    caminho, o computador nunca fica ligado ao chat: o `chatLink` responde com o toast.
  - O `DesktopConfig.computerName`: o nome do computador no Windows, que vai no `chat.computador`.
  - Os três ganchos novos são chamados na thread de comandos e nunca esperam: só põem o trabalho na fila do executável.
    - `chatNotice(conversa, titulo, texto)`: o aviso do Windows de uma mensagem. O clique nele chama
      `DesktopApp::OpenChat(conversa)`.
    - `chatBadge(n)`: o número no ícone da barra de tarefas (0: sem número).
    - `chatDownload(arquivo, nome, chave)`: baixa o arquivo com a chave, para a pasta Downloads, marca como vindo da
      internet e abre. O 410 vira o toast `Arquivo expirado`, e qualquer outro erro o `Não foi possível baixar o
      arquivo.`, os dois pelo `DesktopApp::Notify`.
  - `DesktopApp::SetWindowInFront(frente)`: a janela principal ficou na frente (visível, sem minimizar e ativa, com a
    sessão do Windows desbloqueada e conectada) ou saiu dela. Só põe na fila, e a `janela` vai à interface quando muda.
  - `DesktopApp::OpenChat(conversa)`: a pessoa clicou no aviso do chat. Só põe na fila; antes do primeiro `ready`, o
    `abrir` espera por ele. Esse `ready` é o de qualquer página, também o do `aviso.html`: isso vale porque o executável
    só abre o aviso depois da primeira mensagem da janela principal, e assim o primeiro `ready` é sempre o dela.
  - (0.3.0) Os ganchos do vídeo, também chamados na thread de comandos e sem esperar; um vazio não faz nada. O
    executável os liga nas tarefas do vídeo.
    - `videoViews(vistas, paginaDoAviso)`: as vistas que a página mostra agora (`videoViews`, já sem as que não são da
      página), e se é a página do aviso. O executável troca só as vistas dessa página na rota do vídeo (ver "A memória do
      vídeo").
    - `videoWindow(modo)`: o modo da janela do vídeo (`"normal"`, `"grande"` ou `"telaCheia"`), do `videoWindow` e do fim
      da última ligação.
    - `noticeHeight(altura)`: a altura do aviso de ligação recebida, em pixels lógicos (de 168 a 480), só do `noticeHeight` da
      página do aviso. O executável a repassa ao `NoticeWindow::SetHeight`, que refaz o tamanho e o lugar no monitor onde
      o aviso está (escondido, vale no próximo `Show`).
    - `h264Ensure()`: roda o `H264Module::Ensure` fora da fila de comandos e responde pelo `DesktopApp::SetH264State`
      (`Installed` ou `Failed`, de qualquer thread: só põe na fila). Só é chamado com o `DesktopConfig::h264Download`
      (a opção `STARSONIC_H264_DOWNLOAD` do build, ligada na etapa 2). Vazio: a situação fica `baixando`. No
      executável, o `Ensure` roda numa thread própria, na pasta `%LOCALAPPDATA%\Starsonic Phone\codecs` (criada se
      falta), e um pedido no meio de outro é ignorado. Com o `Installed`, o módulo é conferido de novo (`Verify`) e
      carregado pelo caminho completo, e só então a resposta é `Installed`; o módulo que não carrega dá `Failed`,
      com a linha `h264: download falhou (carregar <código>)`. O fechamento do app não espera um download em
      andamento: depois dele, nenhuma resposta e nenhuma linha.
    - `cameraBlocked()`: a privacidade do Windows nega a câmera aos apps da área de trabalho. Só escolhe o texto do aviso
      de `OpenFailed`. Vazio: `false`. No executável, é `true` quando um dos três valores `Value` do
      `CapabilityAccessManager\ConsentStore\webcam` é `Deny`: o do computador (`HKLM`), o do usuário (`HKCU`) e o dos
      apps da área de trabalho do usuário (`HKCU`, `...\webcam\NonPackaged`).
  - (0.3.0) O `EngineHost` repassa ao `SipEngine` os seis métodos do vídeo do `RegistrationPort` (`VideoDevices`,
    `SetCaptureDevice`, `RefreshVideoDevices`, `StartCameraTest`, `StopCameraTest` e `SetVideoSettings`), na thread de
    comandos (que não é STA, como as câmeras pedem), e passa o `OnCameraProblem` ao `DesktopApp`, que o põe na fila.
    Na ligação, o `EngineHost` é também o `CallEngine` do vídeo (`MakeCall(numero, video)`, `Answer(id, video)` e
    `SetCamera(id, ligada)`) e passa o `OnCallVideo` ao `DesktopApp`, que o entrega direto ao controlador, na thread de
    eventos do motor, como o `OnCallState`.
- (0.4.0) A sala de vídeo: o `RoomAdd` e o `OnRoom` passam pelo `EngineHost` (ver "Para o executável" em "A sala de
  vídeo (0.4.0)").
- Ao fechar: `Shutdown()`, o `Stop()` do agendador, o motor destruído, o `DesktopApp` destruído (detalhes no
  `DesktopApp.h`). Depois de a janela fechar, isso tem 5 s: passou, `fechamento forcado` no diagnóstico e o processo
  sai com o código 0.

### A memória do vídeo

Cada vista de vídeo (a imagem da outra ponta de uma ligação, ou a nossa câmera) é uma memória compartilhada com a
página: um cabeçalho de 64 bytes e dois lugares, cada um com um quadro I420 de até 1920×1080 (um quadro maior é
reduzido antes, mantendo a proporção). O tamanho total é `64 + 2 × 3110400 = 6220864` bytes; cada lugar tem
`1920*1080 + 2*(960*540)` = 3110400 bytes. Quem grava é o executável (`windows/app/src/FrameBuffer.h`).

Todos os campos do cabeçalho são u32 little-endian, nestes deslocamentos:

| Desloc. | Campo | Valor |
| --- | --- | --- |
| 0 | marca | `0x31565353` (os bytes `S`, `S`, `V`, `1`) |
| 4 | `seq` | 0: nenhum quadro; ímpar: o cabeçalho está mudando; par: o quadro está completo |
| 8 | lugar | 0 ou 1: o lugar do último quadro completo |
| 12 | largura | em pixels |
| 16 | altura | em pixels |
| 20 | `yStride` | igual à largura |
| 24 | `uvStride` | `(largura+1)/2` |
| 28 | tamanho do lugar | `1920*1080 + 2*(960*540)` |
| 32 a 63 | | zero |

O lugar 0 começa no byte 64 e o lugar 1 em `64 + tamanho do lugar`. Cada lugar tem o plano Y (`yStride × altura`), depois o
U e depois o V (cada um com `uvStride × ((altura+1)/2)`), sem sobra nas linhas.

O escritor alterna os lugares: grava o quadro novo no lugar que não é o do `lugar` do cabeçalho, soma 1 ao `seq`
(ímpar), grava `lugar`, largura, altura e os passos, e soma 1 de novo (par). O `seq` só cresce, menos quando a vista
esvazia (volta a 0, ver "A entrega"): o quadro seguinte continua a contagem de antes, e um `seq` já usado nunca volta.

A leitura, para quem escreve a página (o `seq` é lido de forma atômica, com `Atomics.load` num `Int32Array` da
memória):

1. Leia `s1 = seq`. Se for 0 ou ímpar, não há quadro: tente no próximo ciclo.
2. Copie o cabeçalho e os planos do lugar indicado (copie de uma vez, para fora da memória).
3. Leia `s2 = seq`. Se `s1 == s2`, a cópia é um quadro inteiro; se não, descarte-a, porque o escritor virou o lugar no meio
   da cópia.

A entrega (`windows/app/src/VideoSink.h` e `WebViewSharedBuffers.h`):

- Cada memória é uma memória dividida do WebView2 e chega à página dela pelo evento `sharedbufferreceived` do
  `window.chrome.webview` (o `PostSharedBufferToScript`), **só para leitura**: a página nunca escreve nela. O
  `additionalData` diz a vista e o tamanho: `{"v":1,"type":"videoBuffer","vista":"remoto","bytes":6220864}`, com a
  `vista` `remoto`, `local` ou `porteiro`. A do `porteiro` vai à página `aviso`, e a do `remoto` e a do `local`, à
  `principal`.
- A página recebe a memória de uma vista quando ela fica à vista pela primeira vez (o `videoViews`), e de novo depois de
  cada recarregar da página e de cada navegador refeito. Uma memória nova da mesma vista troca a velha. A vista
  escondida fica com a memória, sem quadros novos.
- Os quadros vão só às vistas à vista, e no máximo 30 por segundo a cada uma: o `remoto` mostra a ligação de cima, com a
  janela principal sem minimizar e fora da bandeja; o `porteiro`, a recebida tocando (a de cima ou a segunda), também
  com a janela minimizada; o `local`, a nossa câmera (a da ligação ou a do teste da câmera), sem minimizar. Um quadro de
  uma ligação que não é nenhuma dessas não vai a nenhuma vista.
- A página desenha uma vista só para a ligação a que ela pertence (o `remoto`, a de cima; o `porteiro`, a recebida
  tocando) e trata o `seq` 0 como vazio, sem imagem: o cabeçalho não diz a ligação. A memória de uma vista esvazia (o
  `seq` volta a 0) quando a ligação dela muda ou acaba, e a do `local` quando ele deixa de receber quadros (escondido ou
  com a janela minimizada): a próxima ligação, ou o próximo mostrar, começa vazia, nunca com o último quadro de antes.

## O modo iPhone (etapa 2)

A mesma interface e o mesmo `DesktopApp` no app do iPhone (spec do iPhone, seções 4.1, 6.1 e 8): o hospedeiro em Swift
mostra a `windows/ui` num WKWebView, com um objeto da mesma forma do `window.chrome.webview` (o `postMessage` e o evento
`message`; o `bridge.ts` não muda), e o `DesktopConfig` leva a plataforma iPhone. **Tudo nesta seção existe só com
`plataforma: "ios"` no estado.** No Windows, o estado não ganha nenhum campo desta seção e cada comando faz o que faz
hoje. O formato continua na versão 1 (ver "Versão").

- A interface entra no modo iPhone no primeiro estado com `plataforma: "ios"`: antes de desenhar a primeira tela dele,
  põe `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1` no `<meta name="viewport">` (a página
  vai até as bordas da tela e cuida sozinha da área segura, pelo `env(safe-area-inset-*)`), e tira a barra de título, os
  atalhos de teclado (Ctrl+1 a 4 e Ctrl + P), a aba Atalhos, a pergunta da atualização, a área do administrador e o
  toque.
- Antes do primeiro estado, a interface não sabe a plataforma e desenha a janela do Windows. Por isso, no iPhone, o
  hospedeiro deixa o WKWebView escondido, com o logo da abertura por cima, até a interface ficar pronta (o primeiro
  `state` desenhado: o `body[data-pronto]`).
- O `ready` responde com o estado, com a `agenda` quando já houve uma lista desde a abertura do app (`agenda.vez` maior
  que 0) e com o `abrir` pedido antes dele (abaixo), nesta ordem. Nada de toque, de lista da empresa ou de pergunta da
  atualização.

### O estado no iPhone

Os campos novos:

| Campo | Tipo | Sentido |
|---|---|---|
| `plataforma` | `"ios"` | O modo iPhone. Sem o campo, é o Windows. |
| `agenda` | objeto | A agenda do iPhone: `{permissao, vez, quantos}`. Os contatos vêm na mensagem `agenda`. |
| `agenda.permissao` | `"pendente"` \| `"negada"` \| `"concedida"` | O acesso aos contatos: `pendente` (o iPhone ainda não perguntou), `negada` (a pessoa negou; só os Ajustes do iPhone mudam isso) ou `concedida`. Fora da `concedida`, a lista é vazia, e a aba Contatos mostra o aviso "Permita o acesso aos contatos para ligar pelo nome." com o Permitir (`allowContacts`). |
| `agenda.vez` | inteiro | Sobe a cada lista nova; `0` sem nenhuma desde a abertura do app. É a `vez` da última `agenda`. |
| `agenda.quantos` | inteiro | A contagem da última lista (os contatos com algum número). |
| `rotaAudio` | texto | A saída de som de agora, com o nome que o iPhone dá: `iPhone` (o alto-falante do ouvido), `Viva-voz` ou o nome do fone; `""` sem saber. O botão Áudio da ligação a mostra. |
| `config.bipeTecla` | booleano | "Bipe ao digitar" (Configurações → Ligações; `setSetting` com `bipeTecla`; ligado de fábrica, gravado no `config.json`). |

Os campos do PC continuam todos no estado (todas as chaves sempre presentes), com o valor neutro:

- `contas`: no máximo a conta em uso (uma conta por iPhone);
- `contatos` e `atalhos`: `[]`; `iniciarComWindows`: `false`;
- `admin`: fechado, com `naoPerturbe` e `atenderAuto` `true` (os dois botões aparecem) e `blf` e `puxa` `false`;
- `empresa`: com `situacao` `"nenhuma"` (`link` e `erro` `""`; `atualizadaEm`, `quantos` e `vez` `0`);
- `video`: neutro, com `ligado` `false`, `cameras` `[]`, `camera` `""`, `cameraDesconectada` e `teste` `false`, `h264`
  com `cartao` e `pessoa` `false` e `situacao` `desligado`, e `janela` `normal` (o motor do iPhone não tem vídeo: o
  `DesktopApp` não chama o porto nem os ganchos do vídeo);
- `audio`: com as listas vazias (`microfones`, `altoFalantes` e `desconectados`) e `microfone`, `altoFalante` e `toque`
  `""`: quem escolhe o caminho do som é o iPhone (`rotaAudio`).

A exceção é o `chat` (0.2.0): o iPhone não tem o chat, e o estado dele vem sem o campo.

Os nomes (a recebida, os Recentes e o aviso da perdida) vêm da agenda: o do contato com o número, senão o que a central
mandou. O `recentes[].contatoId` é sempre `""` (os contatos da agenda não têm id, e a interface não oferece o "Salvar
contato").

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
  "ligacao":null,
  "recentes":[{"numero":"+5511988887777","nome":"Ana Souza","tipo":"perdida","inicio":1761061000000,"duracao":0,
               "contatoId":""}],
  "perdidas":1,
  "contatos":[],
  "audio":{"microfones":[],"altoFalantes":[],"microfone":"","altoFalante":"","toque":"","desconectados":[]},
  "iniciarComWindows":false,
  "versao":"1.0.0",
  "teclado":"",
  "tecladoVez":0,
  "atalhos":[],
  "admin":{"aberto":false,"naoPerturbe":true,"atenderAuto":true,"blf":false,"puxa":false},
  "entrarAdmin":{"erro":"","esperaAte":0,"vez":0},
  "config":{"bipeFim":true,"bipeTecla":true},
  "empresa":{"link":"","situacao":"nenhuma","erro":"","atualizadaEm":0,"quantos":0,"vez":0},
  "plataforma":"ios",
  "agenda":{"permissao":"concedida","vez":2,"quantos":312},
  "rotaAudio":"iPhone"
}}
```

### As mensagens do iPhone

Duas a mais (C++ → interface), também com `v: 1`:

- `{"v":1,"type":"agenda","vez":N,"contatos":[{"nome":"...","numeros":["..."]}]}`: a agenda do iPhone inteira. Ela fica
  fora do `state`, como a `contatosEmpresa`: a agenda pode ter milhares de contatos, e o `state` vai inteiro a cada
  mudança.
  - Cada contato: `nome` (texto; `""` num contato sem nome, e a interface mostra o primeiro número) e `numeros` (lista de
    texto, como estão na agenda e na ordem dela, cada número uma vez: os mesmos dígitos são o mesmo número). O contato
    sem nenhum número fica de fora. Os contatos vêm na ordem da agenda: a interface ordena.
  - Vem a cada lista nova, com a `vez` que o `agenda.vez` também passa a ter (ela pode chegar antes do `state` com essa
    `vez`), e no `ready`, depois do estado, quando já houve uma lista desde a abertura (`agenda.vez` maior que 0). Vale a
    de `vez` mais alta: uma mais velha que chega atrasada não vale, como na `contatosEmpresa`.
  - Fora da permissão `concedida`, a lista é vazia.
  - **A privacidade** (spec do iPhone, 6.4): os contatos ficam só na memória do núcleo, e o diagnóstico nunca leva os
    nomes nem os números da agenda, só a contagem e a permissão.
- `{"v":1,"type":"abrir","tela":"recentes"}`: a pessoa tocou no aviso da perdida ("Ligação perdida de <nome ou
  número>", spec do iPhone, 7.9). A interface vai para os Recentes, como a última ligação que acaba volta ao Teclado (com
  uma ligação, a tela da ligação continua na frente). Outra `tela` não existe nesta versão: a interface a ignora.
  Um `abrir` pedido antes do `ready` vai no `ready`, depois do estado e da agenda (o app que o iOS tinha fechado abre
  pelo aviso, e a página ainda carregava).

```json
{"v":1,"type":"agenda","vez":2,"contatos":[{"nome":"Ana Souza","numeros":["+55 11 98888-7777","2003"]},{"nome":"","numeros":["(21) 97777-6666"]}]}
{"v":1,"type":"abrir","tela":"recentes"}
```

### Os comandos do iPhone

| Comando | Campos | O que faz |
|---|---|---|
| `contactsOpened` | — | A aba Contatos abriu (a cada vez). O hospedeiro lê a agenda de novo (a lista vem na `agenda`) e, na primeira vez (`agenda.permissao` `pendente`), pede a permissão com a janela do iPhone ("Para ligar pelo nome e mostrar quem está ligando."). |
| `allowContacts` | — | O Permitir do aviso da aba Contatos. Com a permissão `pendente`, o hospedeiro a pede; com a `negada`, abre os Ajustes do app (o iPhone não pergunta de novo). A resposta vem no `agenda.permissao` e, com a permissão dada, na `agenda`. |
| `audioRoute` | — | O botão Áudio da ligação: o hospedeiro mostra a escolha do iPhone (iPhone, Viva-voz ou o fone). A saída escolhida vem na `rotaAudio`, também a trocada fora do app (na tela de chamada do iPhone, ou um fone que liga). |
| `keyTone` | `tecla` (texto: `0` a `9`, `*` ou `#`) | Uma tecla do Teclado ou do teclado da ligação, a da tela ou a do teclado físico (o `+` do teclado físico vai como `0`; a tecla 0 da tela só mostra o "+", como no Windows e no Android): o hospedeiro toca o bipe de telefone dela. A interface só manda com `config.bipeTecla` ligado, e o núcleo confere de novo. Na ligação, vai junto do `dtmf` de sempre. Outra `tecla` é recusada (linha no diagnóstico). |
| `setSetting` | `chave: "bipeTecla"`, `valor` (booleano) | "Bipe ao digitar" (Configurações → Ligações). |
| `openExternal` | `url` (texto) | No iPhone vale também `tel:+551150603000`: o hospedeiro abre o discador do iPhone com o número do suporte (o "Precisa de ajuda?" da tela Entrar e o "Ligar" do Sobre). O site e o WhatsApp valem como sempre; o código-fonte é recusado (o Sobre do iPhone não tem a linha). |

```json
{"v":1,"cmd":"contactsOpened"}
{"v":1,"cmd":"allowContacts"}
{"v":1,"cmd":"audioRoute"}
{"v":1,"cmd":"keyTone","tecla":"5"}
{"v":1,"cmd":"setSetting","chave":"bipeTecla","valor":false}
{"v":1,"cmd":"openExternal","url":"tel:+551150603000"}
```

### Os comandos de sempre no iPhone

- **O Sair** (no Menu, depois da confirmação "Sair da conta?") é o `removeAccount` da conta em uso, como hoje: recusado
  com uma ligação; sem ligação, a conta desregistra e sai, e a tela volta ao Entrar. Os Recentes ficam (spec do iPhone,
  7.1).
- **Uma conta só:** o `login` que registra uma conta nova (sem `contaId`) deixa só ela em `contas` (ela toma o lugar da
  que estava em uso). O Editar (o `login` com o `contaId` da conta em uso) é o de hoje.
- **O Transferir e o Consultar de um contato:** o `contato` do `transfer` e do `consult`, como no Windows (a tabela das
  Ligações); no iPhone, a sugestão vem da agenda.
- **O `ring` e o `update` não vêm:** quem toca é a tela de chamada do iPhone, e o bipe do fim da ligação (a regra do
  `ring` `fim`, com o `config.bipeFim`) é do hospedeiro. A interface ignora os dois no modo iPhone. A atualização é a da
  App Store.

### Os comandos do PC, recusados no iPhone

Recusados inteiros: nada muda, nenhum gancho é chamado, e o diagnóstico ganha a linha
`comando recusado no modo iPhone: <nome>` (no `setSetting`, o nome leva a chave: `setSetting iniciarComWindows`):

- a janela: `minimize`, `closeToTray`, `resize` e `quit` (um app do iPhone não se fecha sozinho, e o Sair do iPhone é o
  da conta);
- as contas e o som: `selectAccount`, `setAudio` e o `setSetting` com `iniciarComWindows`;
- os meus contatos: `saveContact` e `removeContact`;
- os atalhos: `saveShortcut`, `removeShortcut` e `useShortcut`;
- a área do administrador: `adminLogin`, `adminLogout` e `adminSet`;
- as planilhas e a lista da empresa: `importContacts`, `exportContacts`, `setCompanyList` e `refreshCompanyList`;
- a atualização: `updateNow` e `updateLater`;
- (0.3.0) o vídeo: `setVideo`, `cameraTest`, `videoViews`, `videoWindow`, `h264Retry` e `camera`. O `video` do `dial` e do
  `answer` não é recusado: o comando vale, e o `DesktopApp` passa `false` ao motor;
- (0.4.0) a sala de vídeo: `salaAdicionar`, `salaTirar`, `salaEncerrar` e `salaVoltar`. O `ligacao.sala` do iPhone é
  sempre `null`;
- (0.2.0) o chat: `chatKey`, `chatLink`, `chatUnlink`, `chatNotify`, `chatBadge` e `chatDownload`. O estado do iPhone
  não tem o `chat`, e o `DesktopApp::SetWindowInFront` e o `DesktopApp::OpenChat` só deixam uma linha no diagnóstico
  (`janela na frente: recusada no modo iPhone`, `abrir o chat: recusado no modo iPhone`): o `ready` do iPhone nunca leva
  a `janela` nem o `abrir` do chat.

**No Windows,** os comandos do iPhone (`contactsOpened`, `allowContacts`, `audioRoute`, `keyTone` e o `setSetting` com
`bipeTecla`) são recusados do mesmo jeito, com a linha `comando recusado no modo Windows: <nome>`, e o `openExternal`
continua recusando o `tel:`.
