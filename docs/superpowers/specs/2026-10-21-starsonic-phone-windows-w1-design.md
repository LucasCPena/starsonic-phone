# Starsonic Phone para Windows W1 (app novo) — especificação de design

- **Data:** 21/10/2026
- **Status:** desenho aprovado pelo responsável em 21/10/2026, no chat, em quatro partes (montagem, dados e migração, comportamento, testes e entrega), com o visual aprovado no canvas "Starsonic Phone Windows — telas da W1" (claude.ai, 17 telas). Esta spec aguarda a revisão escrita.
- **Subprojeto:** Windows, etapa **W1** de três: W1 o app novo no lugar do atual, W2 a gravação de chamadas e W3 os contatos com presença (BLF). W2 e W3 terão specs próprias.
- **Base:** a spec do Windows (`2026-10-11-starsonic-phone-windows-design.md`, revisão 1.5) para a marca, o perfil, o atualizador e a publicação; a spec da 0.2 do Android (`2026-10-16-starsonic-phone-android-0.2-design.md`) para as regras das ligações. Esta spec substitui a do Windows onde as duas divergem.
- **Identidade visual:** o design system "Starsonic" (claude.ai, criado a partir de starsonic.com.br) e o "Manual de identidade visual" v1.0 (outubro de 2026), com os mesmos valores.

> **Decisões do responsável** (21/10/2026):
> 1. A versão do Windows é modernizada com base no manual de identidade, numa interface nova em **WebView2** (HTML/CSS), não pintando as janelas do MicroSIP.
> 2. O motor é o do Android (`SipEngine`, `starsonic/phone`), não o MicroSIP: o app deixa de ser baseado no MicroSIP (caminho B).
> 3. Entram todas as telas: principal (Teclado, Recentes, Contatos), ligação e aviso de ligação, Entrar, Sobre, Configurações e o instalador.
> 4. O tema claro ou escuro segue o Windows.
> 5. Do MicroSIP, os clientes precisam de: várias contas no mesmo PC, Não perturbe e Atender automático (W1), gravação de chamadas (W2) e contatos com presença (W3).
> 6. A ordem é W1, depois W2, depois W3.
> 7. O visual do canvas está aprovado, com: janela compacta com barra de título própria; cabeçalho sempre azul-marinho com o logo negativo; telas de ligação sempre escuras; Ligar e Atender em ciano; Desligar e Recusar em vermelho (exceção ao manual, que reserva o vermelho para erro de formulário); ícones do manual e, onde faltam, desenhados no mesmo traço.

## 1. Contexto

O Starsonic Phone para Windows (série `0.0.1-rc.N`) é o MicroSIP 3.22.16 com a marca: a faixa azul, o logo, a tela Entrar, a tela Sobre, as travas das configurações e o atualizador (`starsonic/win`). Todo o resto é a interface padrão do Windows: botões cinza, abas clássicas e o teclado em grade. O botão Chamar usa o índigo, que pelo manual é exclusivo do logo. A lógica das ligações está misturada com as janelas: só `mainDlg.cpp` tem 6 mil linhas e 271 chamadas diretas ao PJSIP.

O app Android (0.2) tem um motor próprio em C++ sobre o pjsua2 (`SipEngine`), sem interface e testado no Linux contra o registrador falso. Ele já faz duas ligações, transferência com consulta e conferência. O núcleo (`starsonic/core`: perfil com `[portas]`, regras de conta, mensagens, números) é o mesmo nos dois.

## 2. Objetivos

- Um app de Windows com a cara da Starsonic, moderno e coerente com o site e com o app de celular.
- Um motor só para Windows e Android: o mesmo comportamento, os mesmos testes e as correções valendo para os dois.
- As funções da 0.2 do Android no Windows (segunda ligação, consulta, conferência) e as que os clientes usam no MicroSIP (várias contas, Não perturbe, Atender automático).
- Quem usa a rc.7 atualiza sem perceber a troca: as contas, os contatos e os recentes passam para o app novo, e a conta entra sem pedir a senha.

## 3. Critérios de sucesso (W1)

- Num Windows 10 e num Windows 11 limpos, a pessoa instala pelo link, entra com servidor, protocolo, ramal e senha, e faz e recebe ligações nos dois servidores (`starcloud-starsonic.com.br` na 5060 e `starcloud1-starsonic.com.br` na 35060).
- Numa ligação, a segunda toca na faixa e é atendida; a pessoa alterna, transfere com consulta, junta em conferência e separa; ao desligar a ativa, a outra volta sozinha.
- Com o app minimizado ou na bandeja, a ligação recebida aparece no aviso do canto da tela e toca no dispositivo escolhido.
- Não perturbe e Atender automático funcionam como na seção 7.3, e a pessoa troca entre duas contas gravadas pelo cabeçalho.
- Um PC com a rc.7, com duas contas e contatos, recebe a atualização e abre o app novo já "Conectado" na conta que estava em uso, com as duas contas, os contatos e os recentes.
- As telas seguem o canvas aprovado, no tema claro e no escuro, e nenhum "MicroSIP" aparece em lugar nenhum.
- Tudo acima passa nos testes automáticos da seção 11.2 e no roteiro manual da seção 11.3.

## 4. O que a W1 entrega

### 4.1 Telas (canvas "Starsonic Phone Windows — telas da W1")

| Tela | O que tem |
|------|-----------|
| Janela principal | Barra de título própria ("Starsonic Phone", minimizar, fechar para a bandeja). Cabeçalho em `gradient-hero` com o logo negativo (160 px de largura, a área de proteção do manual), o botão do menu, a conta (nome e ramal, "Conectado · <servidor>" ou o estado, a troca de conta) e os botões em pílula Não perturbe e Atender automático. Navegação de baixo: Teclado, Recentes e Contatos. |
| Teclado | O número grande (`text-strong`, 800), o botão Apagar, até três sugestões de contatos ao digitar, o teclado 3×4 com as letras e Ligar em ciano, de largura inteira. |
| Recentes | Filtros Todas e Perdidas (com a contagem), grupos por dia (Hoje, Ontem, a data), e em cada linha o tipo (feita, recebida, perdida em vermelho), o nome ou número, a hora e a duração, mais o botão de ligar. Tocar na linha abre "Ligar" e "Salvar contato". |
| Contatos | A busca por nome ou número, o botão "+" (Novo contato), a lista em ordem alfabética com as iniciais em `gradient-brand`, e por contato o ramal ou número e uma observação. Tocar no contato liga; o menu dele tem Editar e Remover. |
| Ligação | Sempre na seção escura (`gradient-hero` com a esfera de luz). Mostra o nome, o número, o tempo, os controles redondos (Mudo, Teclado, Áudio, Espera, Transferir, Nova ligação) e Desligar em vermelho, com o rótulo fora do botão. A segunda ligação aparece numa faixa no alto ("Ligação de …", Recusar e Atender) e, depois de atendida, num cartão com "Em espera". |
| Consulta | O cliente no cartão de cima com o selo "Em espera · transferência", o colega em destaque ("Consultando"), Mudo, Alternar e Cancelar, e "Concluir transferência" em ciano, de largura inteira. |
| Conferência | "Conferência" com os participantes e o tempo desde o Juntar, Mudo, Teclado, Separar e "Desligar para todos". |
| Aviso de ligação recebida | Janela de 380×168 no canto inferior direito, sempre por cima, na seção escura: "Ligação recebida · <conta>", o nome, o número, Recusar e Atender. Tocar em Atender abre a janela principal na ligação. |
| Entrar | Cabeçalho com o logo negativo, "RAMAL NO COMPUTADOR" e "Entre com o seu ramal". Campos: "Servidor (endereço ou IP)" com Protocolo (UDP/TCP) ao lado, "Ramal", "Senha" (com mostrar), "Nome da conta (opcional)", o botão Entrar e "Precisa de ajuda? (11) 5060-3000". Valem as validações e mensagens de hoje (spec do Windows, 7.1 e 11.1). |
| Configurações | Contas (a lista, a em uso marcada, Editar e "Adicionar conta"), Áudio (Microfone, Alto-falante e Toque), Ligações (Atender automaticamente e o tempo) e Geral (Iniciar com o Windows). |
| Sobre | O logo (principal no claro, negativo no escuro), "Starsonic Phone <versão>", a licença ("Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)"), o site, o telefone e o WhatsApp, o código-fonte e "Enviar diagnóstico". |
| Instalador | O NSIS com as páginas redesenhadas: a lateral escura com o logo negativo e a frase, e à direita o título, as opções (Atalho na área de trabalho, Iniciar com o Windows), o progresso (inclusive a instalação do WebView2) e Instalar em ciano. |

### 4.2 Decisões

- **A interface só desenha.** Todas as regras ficam no C++ (o controlador de ligações, as contas, os recentes). A interface recebe o estado pronto e manda comandos. Uma interface que discorde do C++ é um erro da interface.
- **Uma conta registrada por vez.** A pessoa grava quantas contas quiser; a em uso é a única registrada, e a troca é pelo cabeçalho (como no MicroSIP hoje). O motor continua com uma conta.
- **O toque é da interface.** O toque de chamada e o bipe de espera tocam no WebView2 (`<audio>` com `setSinkId`), no dispositivo de Toque das Configurações. Microfone e alto-falante da ligação são escolhidos no motor.
- **Temas:** os tokens Claro e Escuro do design system, trocados pelo `prefers-color-scheme` do Windows. As telas de ligação e o aviso são sempre escuros.
- **Marca:** Plus Jakarta Sans embutida no app (o arquivo variável do design system, OFL); o logo nas versões oficiais (PNG 2560×777), nunca recriado; ciano só nas ações; vermelho em Desligar e Recusar e nas ligações perdidas.
- **Sem internet na interface:** HTML, CSS, JavaScript, fonte e imagens vão dentro do app. O WebView2 só abre o conteúdo do próprio app; links externos (site, WhatsApp, código-fonte) vão para o navegador padrão.
- **Mesma instalação:** mesma pasta, mesmo `StarsonicPhone.exe`, mesmas chaves de registro e o mesmo canal de atualização. O atualizador da rc.7 instala o app novo como uma versão qualquer.

## 5. Fora do escopo da W1

- A gravação de chamadas (W2) e os contatos com presença/BLF (W3).
- Vídeo, mensagens SIP (chat), encaminhamento de chamadas pelo app, várias contas registradas ao mesmo tempo, os atalhos globais do MicroSIP, a lista de "códigos de recursos" e o modo de linha de comando, além do `/exit`.
- Unificar o CallManager do Android com o controlador novo: o Android continua com o Kotlin dele.
- A remoção da pasta `microsip/` do repositório. Ela sai quando a W1 for estável, para dar para publicar uma correção da série 0.0.1 até lá.
- A assinatura de código do instalador (continua como na spec do Windows, seção de Segurança).

## 6. Arquitetura

```
StarsonicPhone.exe (Win32 em C++17, sem MFC)
 ├─ Janela principal: WebView2 sem moldura (região de arrastar pela barra de título da interface)
 │    └─ Interface: TypeScript + Preact, empacotada com esbuild, embutida (https://app.starsonic.local/)
 ├─ Janela do aviso: um segundo WebView2 (380×168), sem foco, sempre por cima
 ├─ Bandeja (Shell_NotifyIcon), instância única (mutex + WM_COPYDATA), tel:/sip:/callto:
 ├─ Ponte (starsonic/win/Bridge): JSON entre a interface e o C++
 ├─ Controlador de ligações (starsonic/phone/CallController): as regras da 0.2
 ├─ Lojas (starsonic/win): contas (DPAPI), contatos, recentes, configurações, migração da rc.7
 ├─ SipEngine + núcleo (starsonic/phone, starsonic/core)
 └─ Atualizador e diagnóstico (starsonic/win/Updater, Http, Sha256, TlsWatch — os de hoje)
```

### 6.1 Ponte

- Interface → C++: `window.chrome.webview.postMessage({v: 1, cmd: "<comando>", ...})`. Os comandos são: `dial`, `answer`, `reject`, `hangup`, `hold`, `mute`, `dtmf`, `transfer`, `consult`, `completeTransfer`, `cancelConsult`, `swap`, `join`, `split`, `setDnd`, `setAutoAnswer`, `selectAccount`, `saveAccount`, `removeAccount`, `saveContact`, `removeContact`, `setAudio`, `setSetting`, `openExternal`, `sendDiagnostics`, `minimize`, `closeToTray`, `quit`.
- C++ → interface: `{v: 1, type: "state", state: {...}}` com o estado inteiro a cada mudança (conta e registro, ligações, recentes, contatos, configurações, dispositivos de áudio, versão). Avisos de 2 s vêm como `{type: "toast", text}`, e `{type: "ring", kind: "full"|"waiting"|"stop"}` liga e desliga o toque.
- A versão `v` muda quando o formato muda. Uma interface e um C++ de versões diferentes não se conversam: o app mostra "Reinstale o Starsonic Phone." (não deve acontecer, porque vão juntos no mesmo executável).
- A interface aceita mensagens só do próprio C++ (`chrome.webview`), e o C++ só da origem do app.

### 6.2 Controlador de ligações (`starsonic/phone/CallController`)

- C++ puro, sem Windows, para o iPhone reaproveitar. Fica sobre a interface do `SipEngine` (um `EngineListener`) e um relógio, ambos substituíveis nos testes.
- É uma tradução do `CallManager.kt` da 0.2 do Android, com as mesmas regras (seções 7.1 a 7.4 desta spec e da spec da 0.2) e a mesma tabela de estado. O que o Android faz pelo Telecom (a espera pela ligação da operadora) não existe no Windows.
- Os testes do `CallManagerTest.kt` são portados um a um para `tests/phone/test_call_controller.cpp`, contra um motor falso.
- Novas regras: Não perturbe, Atender automático e troca de conta (seção 7.3).

### 6.3 Motor (`starsonic/phone/SipEngine`)

- Uma função nova: `SetAudioDevices(captureId, playbackId)` e `AudioDevices()` (a lista com id e nome), pelo `AudDevManager` do pjsua2. Sem ela, usa os padrões do Windows.
- Nada mais muda no motor. O build do Windows compila o mesmo código, com o pjproject para Windows do `Build-Deps.ps1` (com o Opus e o dispositivo de áudio WASAPI).

### 6.4 Interface (`starsonic/win/ui`)

- TypeScript + Preact, sem framework de CSS. O `app.css` usa os tokens do design system como variáveis CSS, nos temas claro e escuro, e os componentes seguem as telas do canvas.
- Os ícones são SVG de linha (24×24, traço de 2 px, pontas arredondadas, `currentColor`): os do design system e os de telefone desenhados no mesmo traço.
- O build usa esbuild (no `npm`, versões fixas no `package-lock.json`). A saída vai como recurso do executável e é servida pelo `SetVirtualHostNameToFolderMapping` a partir de uma pasta do app.
- Atalhos de teclado: números, `*` e `#` no Teclado; Enter liga; Esc limpa; Ctrl+1, 2 e 3 trocam a aba.
- Acessibilidade: botões de verdade (`<button>`), rótulos em todo ícone, foco visível (contorno de 3 px em `focus`), contraste de 4,5:1 nos dois temas e animações desligadas com `prefers-reduced-motion`.

### 6.5 Perfil

O mesmo `branding/perfil.ini`, embutido, lido pelo `ParseProfile` do núcleo (com `[geral]`, `[conta]` e `[portas]`). O que a pessoa escolhe fica no `config.json` (seção 6.6), nunca no perfil.

### 6.6 Dados no PC (`%APPDATA%\Starsonic Phone\`)

| Arquivo | O que guarda |
|---------|--------------|
| `contas.json` | As contas: servidor, protocolo, ramal, nome e a senha cifrada com DPAPI (`CryptProtectData`, só aquele usuário naquele PC), mais qual está em uso. |
| `contatos.json` | A agenda local: nome, número e observação. |
| `recentes.json` | As últimas 500 ligações: número, nome (do contato ou da central), tipo, data e duração. |
| `config.json` | Microfone, alto-falante, toque, Não perturbe, Atender automático e o tempo dele, iniciar com o Windows e a posição da janela. |
| `diagnostico.log` | O log do app e do motor, sem senhas, com a rotação de hoje. |

Os arquivos são gravados de forma atômica (arquivo temporário + `MoveFileEx`), para não ficarem pela metade se o PC desligar.

## 7. Fluxos

### 7.1 Primeira abertura e migração da rc.7

1. Sem `contas.json` e com `StarsonicPhone.ini` (o arquivo do MicroSIP) na pasta, o app migra:
   - As contas `[Account1]` a `[AccountN]` viram contas: servidor (o endereço do `server`, sem a porta), protocolo, ramal, nome e a senha. A senha é decifrada pela rotina do MicroSIP (`IniDecrypt`, copiada com o aviso da GPL) e cifrada de novo com DPAPI. A conta em uso (`accountId`) continua em uso.
   - O `Contacts.xml` vira `contatos.json` (nome e número; a observação, quando houver).
   - Os registros de ligação do MicroSIP viram `recentes.json`.
2. Os arquivos antigos ficam, renomeados com `.migrado` no fim. Voltar para a rc.7 é renomear de volta.
3. Uma conta cuja senha não decifra entra sem a senha. Ao abrir, a tela Entrar vem preenchida, pedindo só a senha, com o aviso "Digite a senha de novo para continuar.".
4. Um arquivo ilegível é pulado, e a linha vai ao diagnóstico. A migração nunca impede o app de abrir.
5. Sem nenhuma conta, o app abre na tela Entrar.

### 7.2 Ligações

Iguais à 0.2 do Android (spec da 0.2, seções 7.1 a 7.4), com estas diferenças:
- A ligação recebida com a janela principal fechada, minimizada ou atrás de outra abre o aviso do canto (seção 4.1) e toca no dispositivo de Toque. Com a janela na frente, a tela da ligação mostra a recebida, sem o aviso.
- A segunda ligação toca o bipe de espera (não o toque completo), na faixa da tela da ligação ou no aviso, se a janela não estiver na frente.
- A janela principal vai para a frente quando a pessoa atende pelo aviso, e volta ao Teclado quando a última ligação acaba.
- Não há ligação da operadora: tudo o que a 0.2 faz pelo Telecom fica de fora.

### 7.3 Não perturbe, Atender automático e contas

- **Não perturbe**, ligado pelo botão do cabeçalho, continua ligado até a pessoa desligar, também depois de fechar o app. Toda ligação recebida leva ocupado (486), não toca, vai ao Recentes como perdida e não abre aviso. As feitas funcionam normalmente.
- **Atender automático**, ligado pelo botão do cabeçalho, atende a recebida depois do tempo das Configurações (padrão 3 s, de 0 a 30 s), se não houver outra ligação em andamento. Com uma ligação em curso, a segunda toca normalmente. Com Não perturbe também ligado, vale o Não perturbe.
- **Trocar de conta** pelo cabeçalho tira o registro da atual e registra a escolhida. Com uma ligação em andamento, a troca fica para quando a última ligação acabar, com o aviso "A troca de conta fica para o fim da ligação.".
- **Adicionar e editar** usam a tela Entrar (a de editar vem preenchida, com a senha vazia; vazia, a senha continua a mesma). Remover pede confirmação e não vale para a conta em uso com uma ligação em andamento.

### 7.4 Janela, bandeja e links

- O "fechar" da barra de título manda a janela para a bandeja (o app continua recebendo). "Sair" fica no menu do app e no da bandeja. Um clique no ícone da bandeja mostra a janela.
- O ícone da bandeja mostra o estado: conectado, sem conexão, Não perturbe e ligação perdida (os ícones de hoje, refeitos no estilo novo).
- Uma segunda abertura do app traz a janela da primeira para a frente.
- Links `tel:`, `sip:` e `callto:` (registrados pelo instalador, como hoje) abrem o app com o número no Teclado, pronto para Ligar; não ligam sozinhos.
- "Iniciar com o Windows" abre o app na bandeja.
- A janela tem tamanho fixo (400×720 em 100% de escala, acompanhando a escala do Windows) e lembra a posição; volta para a tela principal se a posição gravada ficar fora dos monitores.

### 7.5 Contatos

- Novo contato pelo "+" da tela Contatos ou por "Salvar contato" nos Recentes: nome (obrigatório), número (obrigatório, com a regra de discagem de hoje) e observação.
- O nome do contato aparece no lugar do número na ligação, no aviso, nos Recentes e nas sugestões do Teclado; sem contato, o nome que a central mandou; sem os dois, o número.

## 8. Interface e marca

- Os valores são os do design system "Starsonic" (`tokens.json`), sem arredondar. Cores: `cyan`, `cyan-d`, `blue`, `blue-2`, `ink`, `muted`, `line`, `soft`, `white`, `navy-950` a `navy-800`, `on-cyan`, `danger`. Tokens semânticos `surface`, `card`, `border`, `text-strong`, `text`, `text-muted`, `text-accent`, `icon` e `focus` nos dois temas. Gradientes `gradient-hero` e `gradient-brand`; sombra `shadow-cyan` só no botão ciano. Raios `radius` (18 px) em cartões, `radius-field` (12 px) em campos, `radius-chip` (11 px) e `radius-pill` em toda ação.
- Tipografia: Plus Jakarta Sans de 300 a 800. Títulos em 800 com -0,02em; botões e rótulos em 700; textos em 400 e 300; rótulos em maiúsculas com 0,14em e o traço ciano de 26×2 px antes.
- Texto: pt-BR, caixa de frase, sem exclamação nem emoji, com os textos de hoje onde a tela já existia.
- O índigo e o ciano do logo ficam só no logo.

## 9. Build e publicação

- `build.yml` (Windows): compila o pjproject para Windows (em cache), o núcleo, o motor, o controlador e o app; empacota a interface (Node e esbuild); gera o instalador NSIS com o bootstrapper do WebView2 (Evergreen) dentro; roda o teste de fumaça (seção 11.2).
- O app sai como `0.1.0-rc.1` pelo workflow `release`, no `canal-teste`, como hoje. O `versao.json`, o SHA-256 conferido e as regras do atualizador não mudam.
- O código-fonte completo junto de cada release continua (o repositório, o pjproject, o Opus e as dependências do npm empacotadas).
- O WebView2 SDK (NuGet `Microsoft.Web.WebView2`) e o `WebView2LoaderStatic.lib` entram com versão fixa no `build/deps.lock`.

## 10. Licença

GPL v3, como hoje (o PJSIP é GPL). A rotina de decifrar do MicroSIP usada na migração vem com o aviso de copyright dela. O Sobre deixa de dizer "baseado no MicroSIP" e passa a listar o PJSIP, o Opus, a Plus Jakarta Sans (OFL), o Preact (MIT) e o WebView2 (licença da Microsoft para o runtime distribuído).

## 11. Erros e testes

### 11.1 Mensagens

As da spec do Windows (11.1) e da 0.2 do Android (11.1), mais:

| Situação | O que a pessoa vê |
|----------|-------------------|
| Senha que não veio na migração | "Digite a senha de novo para continuar." na tela Entrar, com o resto preenchido |
| Troca de conta durante uma ligação | "A troca de conta fica para o fim da ligação." por 2 s |
| WebView2 ausente e sem internet para instalar | No instalador: "O Starsonic Phone precisa do WebView2 da Microsoft. Conecte-se à internet e tente de novo." |
| Dispositivo de áudio escolhido desconectado | A ligação usa o padrão do Windows e as Configurações mostram "(desconectado)" ao lado do nome |

### 11.2 Testes automáticos (a cada build)

- **Controlador (Linux):** os casos do `CallManagerTest.kt` da 0.2 portados, mais os de Não perturbe, Atender automático e troca de conta, contra um motor falso.
- **Motor (Linux):** os de hoje, mais `SetAudioDevices` e `AudioDevices` com o dispositivo nulo.
- **Lojas e migração (Linux, onde não dependem do Windows; Windows no CI, onde dependem):** um `StarsonicPhone.ini` e um `Contacts.xml` gerados pelo MicroSIP de verdade viram contas e contatos com a senha certa; o arquivo corrompido é pulado; o DPAPI cifra e decifra (só no Windows).
- **Interface (Playwright no Chromium, Linux):** cada tela do canvas com uma ponte falsa, nos temas claro e escuro. Confere que os comandos saem certos e que o estado aparece; as capturas de tela vão como artefato do build. Tem também uma checagem de acessibilidade (axe) sem erros sérios.
- **Windows (`windows-latest`):** o app compila, o instalador é gerado e o teste de fumaça roda: o app abre com o WebView2, entra no registrador falso, faz uma ligação e tira a captura da janela real.
- Continuam o `check_source_text.py`, os testes do núcleo e a conferência de "MicroSIP" no instalador e no executável.

### 11.3 Teste manual (`docs/teste-manual.md`, reescrito)

- Instalar num Windows 10 sem WebView2 e num Windows 11, entrar nos dois servidores, em UDP e TCP.
- Atualizar de uma rc.7 com duas contas e contatos: tudo migra e a conta em uso entra sem a senha.
- Ligações feitas e recebidas, segunda ligação, consulta, conferência, Não perturbe, Atender automático e troca de conta, com headset USB e com o alto-falante.
- Aviso de ligação com o app na bandeja, minimizado e atrás de outra janela; links `tel:` do navegador.
- As telas no tema claro e no escuro do Windows, comparadas com o canvas.

## 12. Entradas necessárias da Starsonic

- Um PC (ou máquina virtual) com Windows 10 sem WebView2 e outro com Windows 11, para o teste manual.
- Uma rc.7 instalada com duas contas e contatos, para o teste da migração.
- Dois ramais de teste, um em cada servidor.

## 13. Riscos

| Risco | O que fazemos |
|-------|---------------|
| Windows 10 sem WebView2 e sem internet na instalação | O instalador avisa (seção 11.1). O bootstrapper da Microsoft é pequeno e o instalador offline completo fica como alternativa, se o teste mostrar que é preciso. |
| Migração da senha falhar em algum PC (a chave do MicroSIP depende da `CryptoAPI`) | A conta vem sem a senha e a tela Entrar pede só ela (seção 7.1). |
| O controlador em C++ divergir do Kotlin do Android | Os mesmos testes portados um a um. Uma divergência achada depois vira teste nos dois. |
| Comportamento de áudio do WASAPI diferente do Android (eco, dispositivo trocado no meio da ligação) | O teste manual com headset USB e alto-falante. O cancelamento de eco do PJSIP fica ligado, como no MicroSIP. |
| O aviso do canto não aparecer por cima em tela cheia (apresentação, jogo) | Aceito na W1: a ligação toca e o ícone da bandeja pisca. Anotado para depois se incomodar. |
| A rc.7 instalada não aceitar o instalador novo (mudança grande de tamanho ou de nome) | Mesmo nome de arquivo e mesmas regras do `versao.json`. O ensaio da atualização de uma rc.7 para a 0.1.0-rc.1 faz parte do teste manual. |

## 14. Próximos passos

1. O plano de implementação desta spec (`writing-plans`), na ordem: motor (dispositivos de áudio) e controlador com os testes portados; lojas e migração; ponte e janela Win32 com o WebView2; interface (telas do canvas) com os testes do Playwright; aviso, bandeja e links; instalador e build; roteiro manual e a `0.1.0-rc.1`.
2. Depois da W1: a spec da W2 (gravação de chamadas) e a da W3 (contatos com presença).
