# Starsonic Phone para Windows W1 (app novo) — especificação de design

- **Data:** 21/10/2026
- **Status:** implementada na 0.1.0-rc.1 (22/10/2026). O que mudou durante a construção está na seção "Como ficou", antes dos próximos passos. O desenho foi aprovado pelo responsável em 21/10/2026, no chat, em quatro partes (montagem, dados e migração, comportamento, testes e entrega), com o visual aprovado no canvas "Starsonic Phone Windows — telas da W1" (claude.ai, 17 telas).
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
- Nada mais muda no motor. O build do Windows compila o mesmo código, com o pjproject para Windows do `Build-Deps.ps1` (com o Opus e o áudio WMME, o padrão do pjproject no Win32: o `wasapi_dev` do pjproject 2.17 é só para WinRT/Windows Phone e lista um único dispositivo "default"). Revisão 1.6: o WMME corta o nome do dispositivo em 31 caracteres; a interface casa o nome com o rótulo do WebView2 também por prefixo.

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

1. Sem nenhuma conta no `contas.json` e com `StarsonicPhone.ini` (o arquivo do MicroSIP) na pasta, o app migra:
   - As contas `[Account1]` a `[AccountN]` viram contas: servidor (o endereço do `server`, sem a porta), protocolo, ramal, nome e a senha. A senha é decifrada pela rotina do MicroSIP (`IniDecrypt`, copiada com o aviso da GPL) e cifrada de novo com DPAPI. A conta em uso (`accountId`) continua em uso.
   - O `Contacts.xml` vira `contatos.json` (nome e número; a observação, quando houver). É nele que o MicroSIP 3.22 guarda a agenda: o `contacts.db` que ele também cria fica sem tabela nenhuma e não é lido.
   - O histórico de ligações do MicroSIP, no `call_log.db` (SQLite, aberto somente para leitura), vira `recentes.json`: as 500 mais novas, com o tipo (feita, recebida, perdida; a atendida em outro aparelho entra como recebida), a data e a duração.
2. Os arquivos antigos ficam, renomeados com `.migrado` no fim. Voltar para a rc.7 é renomear de volta.
3. Uma conta cuja senha não decifra entra sem a senha. Ao abrir, a tela Entrar vem preenchida, pedindo só a senha, com o aviso "Digite a senha de novo para continuar.".
4. Um arquivo ilegível é pulado, e a linha vai ao diagnóstico. A migração nunca impede o app de abrir. Os contatos e o histórico que não deu para ler (o `call_log.db` travado pela rc.7 ainda aberta, o `Contacts.xml` estragado) ficam com o nome de antes e anotados no `contas.json` (`migracao_pendente`): a próxima abertura tenta de novo, sem mexer nas contas já migradas.
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
- **Lojas e migração (Linux, onde não dependem do Windows; Windows no CI, onde dependem):** um `StarsonicPhone.ini` (UTF-16LE), um `Contacts.xml` e um `call_log.db` (SQLite) no formato do MicroSIP 3.22 viram contas, contatos e recentes; o arquivo corrompido ou o banco travado fica para a próxima abertura; a senha cifrada pelo `IniEncrypt` original (com o `CCrypto` do MicroSIP, só no Windows) decifra certa; o DPAPI cifra e decifra (só no Windows).
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
| Comportamento de áudio do WMME diferente do Android (eco, dispositivo trocado no meio da ligação; nomes cortados em 31 caracteres) | O teste manual com headset USB e alto-falante, conferindo no `diagnostico.log` os nomes do motor e os rótulos do WebView2. O cancelamento de eco do PJSIP fica ligado, como no MicroSIP. |
| O aviso do canto não aparecer por cima em tela cheia (apresentação, jogo) | Aceito na W1: a ligação toca e o ícone da bandeja pisca. Anotado para depois se incomodar. |
| A rc.7 instalada não aceitar o instalador novo (mudança grande de tamanho ou de nome) | Mesmo nome de arquivo e mesmas regras do `versao.json`. O ensaio da atualização de uma rc.7 para a 0.1.0-rc.1 faz parte do teste manual. |

## Como ficou

O que mudou em relação ao texto acima durante a construção da 0.1.0-rc.1 (plano `docs/superpowers/plans/2026-10-21-windows-w1-app-novo.md`), uma linha por item, com o motivo. As seções 6.3 (o WMME, revisão 1.6), 7.1 (o `Contacts.xml` e o `call_log.db`) e 13 (o risco do áudio) já foram corrigidas no texto. O contrato da ponte é o `docs/ponte-windows.md`, e o roteiro manual é o `docs/teste-manual.md`.

### Decisões tomadas durante a construção

1. Os testes do controlador entram como `call_controller_tests` no `tests/phone` e rodam no workflow `android`: o job do motor já roda o ctest dessa pasta.
2. O `tests/desktop` usa o motor falso de `tests/phone` e compila o `CallController.cpp` sem o pjproject: assim o app de PC é testado no Linux sem o PJSIP.
3. O `build.yml` deixou de ignorar `starsonic/phone/**` e `tests/phone/**`: o app de PC passou a depender do motor e do controlador.
4. A pergunta da atualização entrou na ponte (`update`, `updateNow`, `updateLater`): no app novo, ela é da interface.
5. O CMake nativo do Android passou para C++17, e nada mais mudou no Android: o controlador compartilhado usa `std::optional`.
6. Os comandos da interface rodam numa thread de comandos própria, nunca na da janela: o controlador chama o motor na thread de quem chama (o Dial espera o MakeCall, a Espera leva até ~2 s), e a janela não pode congelar.
7. Na conferência, a segunda ligação vem como `secondKind: "active"` na ponte, e a interface olha `conference` antes: o controlador guarda só {None, Ringing, Held}, como no plano.
8. O nlohmann/json 3.11.3 que já estava em `starsonic/third_party` foi reaproveitado: é a mesma versão, com o mesmo SHA-256.
9. Os contatos da rc.7 vêm do `Contacts.xml` e o histórico do `call_log.db`: o MicroSIP 3.22 não grava nenhuma tabela no `contacts.db`.
10. O `starsonic.targets` tira o `LegacyCrypto.cpp` do build do app antigo: sem isso, o build da série 0.0.1 quebra em C++14.
11. O `docs/ponte-windows.md` é o contrato da ponte, e a seção 6.1 fica como resumo: o comando é `login` (não `saveAccount`), o aviso traz `texto`, o toque traz `tipo: completo|espera|parar`, o estado usa nomes em português e a ligação usa os nomes do `CallSnapshot`.
12. No tema claro, os rótulos em maiúsculas e os links ficam em `blue` (não em `cyan-d`), e o erro da tela Entrar fica em `ink`, com o ícone e a borda vermelhos: é o contraste de 4,5:1 da seção 6.4 (o axe reprova o `cyan-d` a 12 px).
13. O bipe da segunda ligação sai no dispositivo de **Alto-falante** da ligação, e o toque completo continua no de Toque (seção 4.2): com headset, a pessoa está ouvindo no headset. A interface acha a saída do WebView2 pelo nome do motor, também por prefixo.
14. O áudio do Windows é o WMME, não o WASAPI (revisão 1.6): o `wasapi_dev` do pjproject 2.17 é só para WinRT e lista um único "default". O WMME corta os nomes em 31 caracteres, e o casamento por prefixo cobre isso.
15. Quatro achados da Task 11 foram corrigidos na Task 12, pelo efeito para a pessoa: o WebView2 não nega o autoplay (senão o toque podia sair mudo); um teste instável que pulava o job do Windows; o `Authorization` do REGISTER, que ia ao `diagnostico.log` e agora sai como `Authorization: <oculto>`; e a saída da sessão do Windows, que agora passa pelo Sair.
16. Se o Sair não termina, a janela fecha 10 s depois do pedido: um Sair travado não pode prender o app aberto. Perde só os Recentes do instante. A correção final completou isso (veja "Correção final", item 8).
17. O ensaio da rc.7 só roda no CI, porque apaga `%APPDATA%\Starsonic Phone`. O instalador não mexe no "Desabilitado" do Gerenciador de Tarefas, para não religar o que a pessoa desligou. O bootstrapper do WebView2 tem cache próprio, para um endereço da Microsoft que muda não derrubar o build e o release.
18. A revisão final foi dividida em três revisores, um por área (núcleo, host e instalador, interface), porque um só não lê o diff inteiro. Isso é do processo e não muda o produto.
19. As teclas nunca rolam. As sugestões de contato ficam só com a altura que sobra: numa lista com rolagem, ou numa linha compacta. O teclado é a função principal da tela, e a sugestão é um atalho.

### Correção final (antes da rc.1)

1. Trocar para uma conta sem a senha não larga a que funciona. A tela Entrar pede a senha com um "Cancelar" que volta para a conta em uso (o comando `cancelLogin` e o campo `entrar.podeCancelar` na ponte). Antes, a pessoa ficava sem conseguir ligar.
2. Na migração, se a conta em uso da rc.7 não migrou (servidor ou ramal inválido, ou a conta local), fica em uso a primeira conta migrada. Antes, o app abria no Entrar com contas válidas.
3. Na tela Entrar, "Precisa de ajuda? (11) 5060-3000" é texto, não link, e o `tel:` saiu da lista do `openExternal`. O app é o tratador do `tel:`, então o link só enchia o Teclado escondido.
4. A pergunta da atualização começa com o foco no "Depois", como o Cancelar das confirmações. Antes, um Enter de quem ia discar fechava o app para instalar.
5. Numa janela baixa, com um cartão em cima, os painéis Transferir e Nova ligação escondem o bloco de quem fala. Antes, o painel passava do espaço e encostava no Desligar.
6. O aviso MIT do Preact vai junto, em `ui\assets\preact-LICENSE.txt`: é uma obrigação da licença.
7. Os links registram `"<exe>" --link "%1"`, e tudo depois do `--link` é o link. Um link nunca carrega opções, e o `--dados <pasta>` só vale no começo da linha de comando, nunca junto de um link: um lançador que não escapa as aspas poderia injetar opções. A atualização troca o registro antigo pelo novo.
8. O fechamento inteiro tem limite: 5 s depois de a janela fechar, o app sai com `ExitProcess`, também pelo Sair da interface (no log, `fechamento forçado`). Antes, um processo sem janela segurava a instância única, e o app não abria mais.
9. A atualização esvazia a pasta `ui\` antes de copiar. As páginas abrem com `?v=<versão>`, e o `app.js`, o `aviso.js` e o `app.css` com o hash do conteúdo na URL. Sem isso, um arquivo velho ou o cache do WebView2 podia servir a interface de outra versão.
10. A atualização e a desinstalação apagam o `StarsonicPhone_log.txt` e os `crash-dump_*` da rc.7, que podem ter traços SIP.
11. Os dispositivos de som são relidos com o app aberto (spec 11.1). O executável trata o `WM_DEVICECHANGE` (`DBT_DEVNODES_CHANGED` e as interfaces de áudio) e espera 1 s sem outro aviso. O motor relê a lista e volta pelo nome aos que estavam em uso, e o app reaplica a escolha gravada. Não há `IMMNotificationClient`, então um fone Bluetooth que só muda de estado pode não avisar (fica no teste manual).
12. Quando o processo do navegador do WebView2 sai, o app refaz o WebView2 dentro do próprio processo, em 1 s, com até 5 tentativas, e escreve `navegador reiniciado` no log. O motor, o registro e as ligações continuam. Uma página que não responde é recarregada 5 s depois.
13. O botão de confirmar dos diálogos Remover é azul: o vermelho tinha contraste de 4,37:1 e ficava fora dos usos do vermelho da seção 4.2.
14. O pacote de fontes do release leva os pacotes do npm que vão no `ui\app.js` (`npm-packages/`, conferidos pelo `integrity` do `package-lock.json`): é a GPL, seção 9.
15. Na correção de acompanhamento, a ligação vence a tela Entrar sempre que existe: na troca para uma conta sem senha, a conta antiga continua registrada e pode receber. Também: o Sair não grava uma troca adiada para uma conta sem senha; o reinício do WebView2 antes de a interface ficar pronta tem limite; e o instalador só apaga a `ui\` de uma pasta que tem o app. A correção da troca tinha trazido essa regressão, e os outros três eram vizinhos baratos.

### Outras diferenças do texto

**Montagem**
- As pastas mudaram: o executável está em `windows/app` e a interface em `windows/ui` (não em `starsonic/win/ui`). A ponte, as lojas e a migração estão em `starsonic/desktop` (não em `starsonic/win`), em C++ portátil: assim, tudo o que não é do Windows é testado no Linux.
- A interface vai numa pasta `ui\` ao lado do exe, servida pelo `SetVirtualHostNameToFolderMapping`, e não como recurso do executável. O instalador troca a pasta inteira.
- A pasta de dados do WebView2 é `%LOCALAPPDATA%\Starsonic Phone\WebView2`, dentro da pasta da instalação, e sai na desinstalação.
- O WebView2 abre com `--autoplay-policy=no-user-gesture-required` e nunca é suspenso, porque o toque tem de sair antes de qualquer clique e com a janela escondida. Só a janela principal toca (o aviso não).
- Sem o runtime do WebView2, o app mostra "O Starsonic Phone precisa do WebView2 da Microsoft. Reinstale o Starsonic Phone.". A spec não tinha esse texto.

**Ponte**
- Além dos comandos da seção 6.1, há `ready`, `cancelLogin` e `viewRecents` (que zera as perdidas). Há também os campos `dial.contato` (a regra de discagem dos contatos), `entrar.contaId`, `teclado`/`tecladoVez` (os links) e `recentes[].contatoId`.
- As mensagens do fim da ligação ("Ocupado", "<nome> desligou"…) e "Ligação perdida de …" chegam como `toast` de 2 s, e não dentro do estado.

**Ligações e contas**
- O Atender automático se decide quando a ligação chega: ligá-lo com uma recebida tocando não atende essa ligação.
- Ligar o Não perturbe com uma ligação tocando não derruba essa ligação (vale para as próximas) e cancela o Atender automático dela.
- Uma transferência que o motor recusa na hora mostra "O servidor não aceitou a transferência." por 2 s, como uma recusa da central.
- O Entrar durante uma ligação também espera o fim dela, como a troca de conta, porque registrar a conta nova derrubaria a ligação.
- O Sair com uma troca de conta esperando grava a conta escolhida para a próxima abertura (exceto uma conta sem senha). Remover a conta em uso passa para a primeira das outras. A contagem de perdidas fica só na memória e zera ao abrir o app.
- A tela da ligação segue a 0.2 onde o canvas não desenha. Nova ligação fica desabilitada com a segunda tocando. Com duas ligações, os sete controles ficam numa grade de 4 colunas, e o cartão "Em espera" tem um Desligar próprio. A consulta não tem Desligar, como no canvas. A Espera fica pressionada, em vez de virar "Retomar".

**Som**
- A escolha dos dispositivos vale pelo nome, porque o número que o PJSIP dá a cada dispositivo muda. Um escolhido que sumiu aparece como "(desconectado)", e o Toque como "Dispositivo escolhido (desconectado)".
- Nos testes do Linux, que não têm som, o motor acrescenta um dispositivo "Null Audio".
- O toque é gerado no WebView2, sem arquivo de som, em 425 Hz. O completo fica 1 s ligado a cada 5 s. O bipe de espera dura 0,2 s a cada 3 s.

**Janela, aviso, bandeja e links**
- A janela tem 400×720, mas a altura é cortada na da área de trabalho do monitor: num notebook de 1920×1080 a 150%, sobram uns 688 pixels lógicos. A interface cabe inteira até 400×640, porque as sugestões encolhem primeiro (decisão 19).
- O aviso não desenha cantos arredondados na página: o Windows 11 arredonda a janela, e no Windows 10 ela é quadrada. Ele fica a 12 px da borda da área de trabalho, não tem dono e abre o WebView2 dele depois do da janela principal.
- A bandeja tem um quinto ícone, "tocando", que pisca, para o caso da tela cheia (seção 13). A ordem é: perdida, depois Não perturbe, depois a conexão. O menu tem Abrir, Não perturbe e Sair.
- A instância única usa uma janela só de mensagens. Se o app aberto não responde em 5 s, a segunda abertura sai. O `/minimized` que a rc.7 gravava vale como `--bandeja`.
- Os links `tel:`, `sip:` e `callto:` são novos, porque o instalador da rc.7 não registrava nenhum (a seção 7.4 dizia "como hoje"). O app aparece em Aplicativos padrão, e a chave do esquema no HKCU só é gravada quando nenhum outro programa tem o link.
- No "Iniciar com o Windows", o registro vale mais que o `config.json` ao abrir: o valor do Run e o "Desabilitado" do Gerenciador de Tarefas. Ligar no app apaga só o "Desabilitado" do próprio app.
- Nas Configurações, "Iniciar com o Windows" fica no cartão Ligações, sem uma seção "Geral". O tempo do Atender automático é escolhido numa lista ("Na hora" e os segundos).

**Instalador e build**
- A página do canvas virou a primeira página do MUI2 (a lateral, o título, o aviso e as duas opções), e o progresso fica na página seguinte. A lateral diz "STARSONIC PHONE", sem o "1.0". O botão Instalar fica no cinza do Windows, porque o MUI2 não pinta o botão.
- O instalador tem quatro textos novos: "O Starsonic Phone está instalado", "O Starsonic Phone foi instalado neste computador.", "Instalando o Starsonic Phone…" e "Ligações pelo seu ramal" (a descrição em Aplicativos padrão).
- O bootstrapper do WebView2 vem do endereço fixo do arquivo, e não do `fwlink`, que muda de arquivo. O SHA-256 e a assinatura da Microsoft são conferidos. Qualquer falha dele dá a mensagem da seção 11.1.
- O "Iniciar com o Windows" do instalador grava só o valor do Run (o `RunAtSystemStartup` do MicroSIP saiu). Desmarcar o atalho numa instalação por cima apaga o atalho.
- O instalador do app antigo deixou de ser gerado, e o release confere que o instalador é o do app novo.
- A fumaça roda no build de teste (`STARSONIC_TEST_HOOKS`), com o perfil de teste (`STARSONIC_PERFIL`) e o som nulo (`STARSONIC_SOM_NULO`), porque o runner não tem placa de som. O instalador de publicação passa pela conferência de marca, pelo `Test-Installer.ps1` e pelo ensaio.

**Atualização e diagnóstico**
- O app novo procura atualização 60 s depois de abrir e a cada 24 h. Ele não tem as regras de intervalo do MicroSIP.
- A pergunta é um diálogo da interface ("Atualização", "Depois", "Atualizar agora") e nunca cobre a tela da ligação: aparece quando a ligação acaba. "Baixando atualização…" e os avisos do atualizador chegam como `toast`.
- "Enviar diagnóstico" faz uma cópia do log em `%TEMP%`, com a data e a hora no nome e o `.1` da rotação junto, e abre o Explorer com ela selecionada.

### A confirmar com o responsável

- As regras de produto das listas acima que a spec não decidia: o Não perturbe e o Atender automático com uma ligação já tocando; o Entrar e a troca de conta que esperam o fim da ligação; o Sair com uma troca esperando; a conta que fica em uso depois de remover a em uso; e as perdidas que zeram ao abrir o app.
- Os textos novos fora da spec e do canvas (os do instalador acima, o diálogo da atualização, os estados vazios, os formulários e os rótulos de leitor de tela) e as notas da versão (`notas/v0.1.0-rc.1.txt`).

### Critérios de sucesso (seção 3)

| Critério | Conferido a cada build | Fica para o teste manual |
|----------|------------------------|--------------------------|
| Instalar pelo link num Windows 10 e num Windows 11 limpos, entrar e fazer e receber ligações nos dois servidores | O instalador (silencioso e pela tela), a fumaça do app instalado (entra no registrador falso por UDP, liga, recebe e atende pelo aviso), a porta por servidor no núcleo | Os dois servidores de verdade, em UDP e TCP; o Windows 10 sem WebView2, com e sem internet; o Windows 11; o áudio |
| A segunda ligação, alternar, transferir com consulta, conferência, separar, e a outra volta sozinha | `call_controller_tests` (os casos da 0.2 portados), `phone_tests` (o motor contra o registrador falso), o Playwright das telas de ligação | As ligações de verdade, com áudio, na central da Starsonic |
| Minimizado ou na bandeja, a recebida aparece no aviso e toca no dispositivo escolhido | A fumaça (o aviso com a janela minimizada, sem roubar o primeiro plano, e o Atender dele), o Playwright do toque (o ritmo e o `setSinkId`), a bandeja e o aviso no `desktop_tests` | O som de verdade no dispositivo de Toque, o bipe no headset, o ritmo com a janela escondida, o foco com outro programa em uso |
| Não perturbe, Atender automático e a troca entre duas contas | `call_controller_tests`, `desktop_tests` (a troca, a troca esperando, a conta sem senha com Cancelar), o Playwright | Com a central de verdade |
| A rc.7 com duas contas e contatos atualiza e abre "Conectado" na conta em uso, com as contas, os contatos e os recentes | `desktop_tests` (o `.ini` UTF-16LE, o `Contacts.xml` e o `call_log.db`; a senha do `CCrypto` original no Windows); o ensaio pelo `workflow_dispatch` (a rc.7 de verdade com uma conta e um contato, o instalador por cima em silêncio, "Conectado", e o `.migrado` do `.ini` e do `Contacts.xml`) | As duas contas e a conta em uso; o `call_log.db` e os recentes; o atualizador da própria rc.7; a instalação por cima pela tela |
| As telas seguem o canvas nos dois temas, e nenhum "MicroSIP" | O Playwright (cada tela nos dois temas, as capturas e o axe), o `check_branding.py` (o exe, a pasta `ui\` e o instalador aberto por dentro) | A comparação com o canvas no WebView2 de verdade, a troca de tema com o app aberto, as escalas de 100%, 125% e 150% |
| Tudo passa nos testes automáticos e no roteiro manual | Os workflows `build` e `android` verdes | O roteiro `docs/teste-manual.md` inteiro, pela Starsonic |

### rc.2 (0.1.0-rc.2)

O que entrou depois da rc.1, aprovado pelo responsável em 22/10/2026 no canvas "Starsonic Phone Windows — tamanho, rediscar e status" (a opção A do Rediscar e os três tamanhos).

- **A janela muda de tamanho** pela borda e pelo canto (seção 7.4 deixa de ser "tamanho fixo"): o `WS_THICKFRAME`, um `WM_NCCALCSIZE` que tira só a barra do Windows e deixa as bordas invisíveis dos lados e de baixo fora da área cliente (o WebView2 não as cobre), e o `WM_GETMINMAXINFO` com o mínimo de 300×440 lógicos e o máximo da área de trabalho. O tamanho é o da área da interface, em pixels lógicos: 400×720 por padrão, o escolhido gravado no `config.json` (`janela_largura` e `janela_altura`, ao lado de `janela_x` e `janela_y`, que passam a ser o canto da área da interface), cortado na área de trabalho pelo `WindowFit` sem passar do mínimo; o `WM_DPICHANGED` mantém o tamanho lógico.
- **Três layouts** na interface: Normal a partir de 380×640, Compacto a partir de 330×540 e Mínimo até 300×440 (os limites ficam onde cada um cabe com as 12 teclas, o Rediscar, o Ligar e a navegação inteiros, sem rolar, e uma sugestão de contato à vista: o Normal precisa de 640 de altura e o Compacto de uns 531). Numa janela larga, o corpo fica com no máximo 480 de largura, no meio. A regra do teclado sem rolar (antes, só de 720 até 640) vale agora em todo tamanho permitido.
- **Rediscar** à esquerda do Ligar: liga para a feita mais nova dos Recentes pelo mesmo `dial` do botão da linha dos Recentes (sem mudança na ponte); também no painel Nova ligação, e não no teclado dos tons.
- **A bolinha da conta**: verde conectado, vermelho "Ocupado · em ligação" com uma ligação (tocando também; durante a ligação, na barra de título, porque a tela da ligação esconde o cabeçalho), ciano conectando, cinza sem conexão e no erro do cadastro (este com o triângulo de atenção). O verde é o token novo `--status-online: #22c55e`: a marca não tem verde (o único é o do WhatsApp, reservado a ele), e este é um pedido explícito do responsável, decisão dele. A bandeja segue as mesmas cores: o conectado com o ponto verde e o ícone novo "em ligação" com o ponto vermelho enquanto existe uma ligação da conta conectada.

### rc.3 (0.1.0-rc.3)

O que entrou depois da rc.2 tem spec própria: `2026-10-22-starsonic-phone-windows-w3-atalhos-blf-adm-design.md`, aprovada pelo responsável em 22/10/2026 no canvas "Starsonic Phone Windows — atalhos, administrador e status". Ela traz os atalhos com BLF e puxar ligação, a área do administrador (Ctrl + P), o bipe do fim da ligação e a bolinha com o Não perturbe e a internet. O que ela muda no texto acima:

- **A navegação** ganha a aba Atalhos, entre Teclado e Recentes. Ctrl+1 a 4 seguem a ordem nova: Teclado, Atalhos, Recentes e Contatos.
- **A bolinha da conta e a bandeja** seguem a tabela da seção 7 da spec nova:
  - sem internet, cinza com "Sem internet · tentando de novo";
  - o Não perturbe, vermelho com "Não perturbe · as ligações não tocam".
  - Na bandeja, o ícone de sem conexão vence o de perdida.
- **O Ctrl + P** abre a área do administrador e nunca imprime.
- **Os botões Não perturbe e Atender automático** podem ser escondidos pela área. Escondido, o recurso fica desligado, e o Não perturbe sai também do menu da bandeja.
- **A porta por servidor** (revisão 1.5) passa a vir da lista da área do administrador, que começa com a do `perfil.ini`.
- **O canal de atualização** pode ser trocado na área. O do build continua sendo o de fábrica.

## 14. Próximos passos

1. O plano de implementação desta spec (`writing-plans`), na ordem: motor (dispositivos de áudio) e controlador com os testes portados; lojas e migração; ponte e janela Win32 com o WebView2; interface (telas do canvas) com os testes do Playwright; aviso, bandeja e links; instalador e build; roteiro manual e a `0.1.0-rc.1`.
2. Depois da W1: a spec da W2 (gravação de chamadas) e a da W3 (contatos com presença).
