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
  - `{"v":1,"type":"ring","tipo":"completo"|"espera"|"parar"}` — o toque;
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
| `quit` | — | Sair: as ligações de agora acabam (e vão aos Recentes) e o app fecha. Uma troca de conta que esperava o fim da ligação não registra, mas a conta escolhida fica em uso na próxima abertura; um Entrar que esperava é descartado. |
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
| `setDnd` | `on` (booleano) | Não perturbe (gravado no `config.json`: continua depois de fechar o app). Toda recebida leva ocupado, não toca e vai aos Recentes como perdida. |
| `setAutoAnswer` | `on` (booleano), `segundos` (inteiro ≥ 0, opcional) | Atender automático e o tempo (de 0 a 30; acima de 30 vale 30; sem `segundos`, fica o de agora). Gravado no `config.json`. |
| `setAudio` | `microfone` (texto, opcional), `altoFalante` (texto, opcional), `toque` (texto, opcional) | A escolha de som. `microfone` e `altoFalante` são o **nome** do dispositivo (o `nome` de `audio.microfones`/`audio.altoFalantes`; `""` = o padrão do Windows). `toque` é o `deviceId` do dispositivo de saída da própria interface (o `setSinkId`; `""` = o padrão). O campo ausente fica como está. |
| `setSetting` | `chave` (texto), `valor` | Só `chave: "iniciarComWindows"` com `valor` booleano. Outra chave: ignorado. |

```json
{"v":1,"cmd":"setDnd","on":true}
{"v":1,"cmd":"setAutoAnswer","on":true,"segundos":5}
{"v":1,"cmd":"setAudio","microfone":"Headset USB","altoFalante":"","toque":"default"}
{"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false}
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
           "protocolo":"udp","status":"conectado","texto":"Conectado · starcloud1-starsonic.com.br"},
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
  "tecladoVez":0
}}
```

### Campos

| Campo | Tipo | Sentido |
|---|---|---|
| `tela` | `"entrar"` \| `"principal"` | `entrar` sem conta em uso, com a conta em uso sem senha (`entrar.pedeSenha`), ou na troca para uma conta sem senha (`entrar.podeCancelar`; a conta em uso continua em `conta`). Adicionar e Editar conta com o app em `principal` são uma navegação da interface: ela mostra o formulário e lê `entrar` do mesmo jeito. |
| `entrar` | objeto | A tela Entrar. |
| `entrar.servidor`, `entrar.ramal`, `entrar.nome` | texto | O que preencher nos campos: o que a pessoa digitou no último `login` (depois de uma mensagem), ou a conta que pede a senha. A senha nunca vem. |
| `entrar.protocolo` | `"udp"` \| `"tcp"` | O protocolo do campo (sem nada digitado, o padrão do perfil). |
| `entrar.erro` | texto | A mensagem embaixo da senha, em vermelho (`""`: nenhuma). Ver "O Entrar". Com `pedeSenha`: `Digite a senha de novo para continuar.`. |
| `entrar.ocupado` | booleano | Esperando o registro (ou o fim da ligação): "Conectando…", campos e Entrar travados. |
| `entrar.pedeSenha` | booleano | A conta veio sem a senha (a migração da rc.7, ou ela não decifra mais): os campos vêm preenchidos e só falta a senha. |
| `entrar.podeCancelar` | booleano | A tela pede a senha de uma troca de conta (`selectAccount` de uma conta sem senha): a interface mostra o botão `Cancelar`, que manda `cancelLogin` e volta para a conta em uso. |
| `entrar.contaId` | texto | A conta que a tela edita (vai de volta no `login`); `""` = conta nova. |
| `conta` | objeto \| `null` | A conta em uso (o cabeçalho); `null` sem nenhuma. |
| `conta.id`, `conta.nome`, `conta.ramal`, `conta.servidor` | texto | `nome` pode ser `""` (sem nome: a interface mostra o ramal). |
| `conta.protocolo` | `"udp"` \| `"tcp"` | |
| `conta.status` | `"conectado"` \| `"conectando"` \| `"sem_conexao"` \| `"erro"` | O registro: `conectando` (esperando a resposta, ou trocando de conta), `conectado`, `sem_conexao` (o servidor não responde, ou a conta não está registrada) e `erro` (o servidor recusou: senha, ramal). |
| `conta.texto` | texto | A linha do cabeçalho: `Conectado · <servidor>`, `Conectando…`, ou a mensagem do registro (as de `entrar.erro`); pode ser `""` com `sem_conexao`. |
| `contas` | lista | As contas gravadas, na ordem em que foram incluídas: `{id, nome, ramal, servidor, protocolo, emUso}` (`emUso`: booleano, a em uso). |
| `naoPerturbe` | booleano | O botão Não perturbe. |
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

```json
{"v":1,"type":"toast","texto":"A troca de conta fica para o fim da ligação."}
{"v":1,"type":"ring","tipo":"completo"}
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
  `ringing`, ou `secondKind` `ringing` fora da conferência) e a janela fora da frente, o aviso aparece; o ícone da
  bandeja segue `perdidas` (a perdida), `naoPerturbe` e `conta.status`, e pisca enquanto toca. O menu da bandeja
  manda `setDnd` e `quit` como a interface.
- Os links `tel:`/`sip:`/`callto:` (já lidos: `ParseLinkArgument`) vão a `DesktopApp::DialLink(numero)`, que só
  preenche `teclado` (e escreve `link recebido` no diagnóstico). Com o app aberto, a segunda abertura entrega os
  argumentos à primeira (instância única: o mutex `Local\StarsonicPhone` e `WM_COPYDATA`) e sai com o código 0; o
  `--sair` vai pelo mesmo caminho.
- A atualização: `DesktopApp::OfferUpdate(versao, notas)` manda a pergunta e guarda até a resposta; a resposta vai
  ao gancho `updateAnswer(agora)`. `DesktopApp::Notify(texto)` manda um toast do executável.
- O logoff ou o desligamento do Windows (`WM_ENDSESSION`) faz o mesmo `quit`, espera até 3 s pelo gancho `quit` e
  roda o `Shutdown()` (os Recentes das ligações encerradas ficam gravados).
- A posição da janela: depois de a pessoa mover a janela, o executável chama `DesktopApp::SaveWindowPosition(x, y)`
  (o canto de cima, em pixels da tela), que grava `janela_x`/`janela_y` no `config.json` (só se mudou, e só depois
  do `Start`). Na abertura, o executável lê a posição do `config.json` antes de criar a janela.
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
- Ao fechar: `Shutdown()`, o `Stop()` do agendador, o motor destruído, o `DesktopApp` destruído (detalhes no
  `DesktopApp.h`). Depois de a janela fechar, isso tem 5 s: passou, `fechamento forcado` no diagnóstico e o processo
  sai com o código 0.
