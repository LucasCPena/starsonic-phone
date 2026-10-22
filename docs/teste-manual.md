# Teste manual do Starsonic Phone (Windows)

Este roteiro é do app novo do Windows (a partir da `0.1.0`: a interface em WebView2 e o mesmo motor de ligações do Android; spec da W1, `docs/superpowers/specs/2026-10-21-starsonic-phone-windows-w1-design.md`, seção 11.3). Faça antes de cada versão estável, com a versão candidata (`vX.Y.Z-rc.N`), em PCs de verdade. As telas aprovadas estão no canvas "Starsonic Phone Windows — telas da W1" (Main, Recentes, Contatos, Entrar, Configurações, Sobre, Chamada, Consulta, Conferência, Recebida, Instalador e as versões escuras); tenha o canvas aberto para comparar.

**O que precisa:**

- **W10:** um PC (ou máquina virtual) com Windows 10 **sem o WebView2** (em Configurações → Aplicativos, nada de "Microsoft Edge WebView2 Runtime"; uma imagem antiga do Windows 10, sem as atualizações, costuma vir sem ele).
- **W11:** um PC com Windows 11.
- Um notebook de **1920×1080 com a escala de 150%** (pode ser um dos dois acima).
- Um headset **USB** e um fone **Bluetooth**, além do alto-falante do PC.
- Dois ramais de teste, um em cada servidor da Starsonic: `starcloud-starsonic.com.br` (porta 5060) e `starcloud1-starsonic.com.br` (porta 35060). Os dois atendem em UDP e em TCP. Ramais e senhas de teste ficam fora do repositório.
- Para as seções 5 e 8, mais dois ramais na mesma central, cada um num telefone à mão (outro PC, um ATA ou um celular com o Starsonic Phone): um faz de **cliente** e o outro de **colega**. Antes, confirme com a Starsonic que a central entrega uma segunda ligação a um ramal que já está numa ligação (o limite de chamadas do ramal precisa ser 2 ou mais).
- Para a seção 13, um PC com a **rc.7** (`v0.0.1-rc.7`) instalada, com **duas contas** (uma em cada servidor), **contatos** e **ligações no Recentes**.
- Para a seção 10, outro softphone que se registre para os links `tel:` (o MicroSIP oficial ou o Zoiper, por exemplo).

Marque cada linha nas colunas W10 e W11. Se algo não sair como o esperado, anote a versão, o PC, o passo e o que apareceu (de preferência com um print) e mande o diagnóstico (Menu → Sobre → Enviar diagnóstico). O log fica em `%APPDATA%\Starsonic Phone\diagnostico.log`; o do instalador, em `%LOCALAPPDATA%\Starsonic Phone\instalador.log`.

O X da barra de título só esconde o app na bandeja (ao lado do relógio). Para fechar de verdade, use **Menu → Sair** ou o **Sair** do menu da bandeja.

Versão testada: `__________`  Data: `__________`  Quem testou: `__________`

W10 (PC, Windows, escala): `__________`  W11: `__________`  Notebook de 150%: `__________`

## 1. Instalação

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 1.1 | No W10, confira em Configurações → Aplicativos que o "Microsoft Edge WebView2 Runtime" não está instalado. Baixe `StarsonicPhone-<versão>-setup.exe` da página do release no GitHub (num outro PC, se precisar) e deixe o arquivo no W10. | O WebView2 não aparece na lista (se aparecer, use outro PC para este item e o 1.2). | ☐ | — |
| 1.2 | No W10, **sem internet** (cabo e Wi-Fi desligados), abra o instalador e clique em Instalar. | O Windows avisa que o editor é desconhecido: "Mais informações" → "Executar assim mesmo". No fim: "O Starsonic Phone precisa do WebView2 da Microsoft. Conecte-se à internet e tente de novo." Nada fica instalado (sem atalho, sem item em Aplicativos instalados). No `instalador.log`, a linha "WebView2 ausente (bootstrapper: <código>)". | ☐ | — |
| 1.3 | No W10, **com internet**, abra o instalador de novo e clique em Instalar. | O progresso mostra "Instalando o WebView2 da Microsoft…" e depois "Instalando o Starsonic Phone…". Anote se o Windows pede a senha de administrador (UAC) para o WebView2: `____`. No fim, "O Starsonic Phone está instalado". O "Microsoft Edge WebView2 Runtime" passa a aparecer em Aplicativos; no `instalador.log`, "WebView2 <versão> instalado (bootstrapper: 0)". | ☐ | — |
| 1.4 | No W11, abra o instalador e clique em Instalar. | Sem a etapa do WebView2 (o Windows 11 já tem). Nenhuma senha de administrador. | — | ☐ |
| 1.5 | Olhe a primeira página do instalador e compare com a tela Instalador do canvas. | A lateral escura com o logo negativo e "Seu ramal no computador, em qualquer lugar."; à direita, "Instalar o Starsonic Phone", "Feche o Starsonic Phone, se ele estiver aberto. As suas contas e os seus contatos continuam no computador.", "Atalho na área de trabalho" e "Iniciar com o Windows", os dois marcados. O botão Instalar fica no cinza do Windows (limite do instalador; o ciano do canvas não dá). | ☐ | ☐ |
| 1.6 | Termine com "Abrir o Starsonic Phone" marcado. | O app abre na tela Entrar. Há atalho no menu Iniciar e na área de trabalho. Em Aplicativos instalados: "Starsonic Phone", editor "Starsonic", a versão testada. | ☐ | ☐ |
| 1.7 | Em Configurações → Aplicativos → Aplicativos padrão, procure o Starsonic Phone. | Ele aparece na lista (para os links `tel:`, `sip:` e `callto:`), com a descrição "Ligações pelo seu ramal". | ☐ | ☐ |

## 2. Entrar e os dois servidores

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 2.1 | Olhe a tela Entrar e compare com a Entrar do canvas. | O cabeçalho azul-marinho com o logo negativo, "RAMAL NO COMPUTADOR" e "Entre com o seu ramal". Os campos "Servidor (endereço ou IP)" com o Protocolo ao lado (UDP marcado), "Ramal", "Senha" (com o mostrar), "Nome da conta (opcional)", o botão Entrar e "Precisa de ajuda? (11) 5060-3000". Nenhum campo técnico (porta, proxy, codecs). | ☐ | ☐ |
| 2.2 | Clique no "(11) 5060-3000". Depois, selecione o número com o mouse e copie (Ctrl+C). | É só texto: nada abre e nada muda no app. O número copia. | ☐ | ☐ |
| 2.3 | Clique em Entrar: com o Servidor vazio; com o endereço e a porta (ex.: `starcloud1-starsonic.com.br:5060`); com o ramal com espaço no meio (ex.: `20 01`); com a senha vazia. | "Digite o endereço do servidor."; "Digite só o endereço do servidor, como starcloud1-starsonic.com.br."; "Digite só o número do ramal."; "Digite a senha." | ☐ | ☐ |
| 2.4 | Ramal certo com a senha errada; depois, um endereço que não existe (ex.: `starcloud9-starsonic.com.br`); depois, sem internet. | "Ramal ou senha incorretos."; "Não foi possível falar com o servidor. Confira o endereço e a sua internet." nos outros dois. A tela continua aberta, com os campos preenchidos. | ☐ | ☐ |
| 2.5 | Cole o endereço no campo Servidor com Ctrl+V. Tente também o botão direito do mouse. | O Ctrl+V cola. O botão direito não abre menu (conhecido; anote se incomodar). | ☐ | ☐ |
| 2.6 | Entre no ramal do **starcloud1** em **UDP**, com espaços nas pontas e maiúsculas no endereço (ex.: ` Starcloud1-Starsonic.com.br `) e um nome da conta (ex.: `Recepção`). | O Teclado, com "Recepção · <ramal>" e "Conectado · starcloud1-starsonic.com.br" no cabeçalho (o endereço em minúsculas, sem os espaços). | ☐ | ☐ |
| 2.7 | Com essa conta, ligue para outro ramal e para um número externo; receba uma ligação. Se der, confira na central (ou no sngrep) a porta do REGISTER e do INVITE. | As ligações completam, com áudio nos dois sentidos. O REGISTER e o INVITE vão para `starcloud1-starsonic.com.br:35060`. | ☐ | ☐ |
| 2.8 | Configurações → Contas → Editar a conta: troque o Protocolo para **TCP** e Entrar (a senha vazia mantém a gravada). Ligue e receba. | "Conectado · starcloud1-starsonic.com.br"; em Configurações, a conta com "starcloud1-starsonic.com.br · TCP · em uso". As ligações completam pela 35060 em TCP. | ☐ | ☐ |
| 2.9 | Configurações → Adicionar conta: entre no ramal do **starcloud** em **UDP**. Ligue e receba. | A conta nova fica em uso, "Conectado · starcloud-starsonic.com.br". O REGISTER e o INVITE vão para a 5060. | ☐ | ☐ |
| 2.10 | Edite a conta do starcloud para **TCP**. Ligue e receba. | "Conectado"; as ligações completam pela 5060 em TCP. | ☐ | ☐ |
| 2.11 | No PABX (ou com o fornecedor), confira o User-Agent do registro. | `Starsonic Phone/<versão>`, e o servidor aceita o registro. | ☐ | ☐ |

## 3. Janela, escala e tema

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 3.1 | Com a escala do Windows em **100%** (Configurações → Sistema → Tela), olhe a janela e compare com a tela Main do canvas. | Janela de 400×720, com a barra de título própria ("Starsonic Phone", minimizar e fechar). O cabeçalho em azul-marinho com o logo, o Menu, a conta, "Não perturbe" e "Atender automático". O Teclado 3×4 com as letras, o Ligar em ciano e a navegação Teclado, Recentes e Contatos. Arrastar pela barra de título move a janela. | ☐ | ☐ |
| 3.2 | Mude a escala para **125%** com o app aberto. Depois, feche (Menu → Sair) e abra de novo. | A janela acompanha a escala (fica maior), sem cortes e sem texto borrado. Os ícones da bandeja podem ficar borrados até o app abrir de novo (conhecido; anote como ficaram). | ☐ | ☐ |
| 3.3 | Repita em **150%**. | Igual ao 3.2. | ☐ | ☐ |
| 3.4 | No **notebook de 1920×1080 a 150%**, com a barra de tarefas embaixo, abra o app. | A janela cabe inteira na área de trabalho: nada fica atrás da barra de tarefas. As 12 teclas aparecem inteiras, com o Ligar e a navegação à vista. | ☐ | ☐ |
| 3.5 | No notebook a 150%, digite os primeiros dígitos de um número que combine com dois ou três contatos (seção 9). | As sugestões aparecem acima das teclas e ficam só com a sobra de altura (uma lista com rolagem, ou uma linha compacta). As teclas nunca rolam e nunca ficam escondidas. | ☐ | ☐ |
| 3.6 | No notebook a 150%, numa ligação com a segunda tocando (ou com uma em espera), abra Transferir e digite um número que combine com dois contatos. | "Transferir para", o campo, as sugestões, Consultar, Transferir agora e Cancelar cabem; nada encosta no Desligar nem no tempo. | ☐ | ☐ |
| 3.7 | Mova a janela, feche (Menu → Sair) e abra. Depois, com dois monitores, deixe a janela no segundo, feche, desconecte o segundo monitor e abra. | A janela volta onde estava. Sem o monitor, ela abre inteira na tela principal. | ☐ | ☐ |
| 3.8 | Com o app aberto, troque o modo do Windows entre **claro** e **escuro** (Personalização → Cores → modo do aplicativo). Passe pelo Teclado, Recentes, Contatos, Configurações, Sobre e Entrar e compare com o canvas (as telas e as escuras). | O app troca de tema na hora, sem abrir de novo. O cabeçalho continua azul-marinho com o logo negativo nos dois temas; a ligação, a consulta, a conferência e o aviso são sempre escuros. No tema claro, os rótulos em maiúsculas e os links ficam em azul (não em ciano: contraste). No Sobre, o logo principal no claro e o negativo no escuro. | ☐ | ☐ |
| 3.9 | No Teclado, use o teclado do PC: dígitos, `*`, `#`, Enter, Esc; depois Ctrl+1, Ctrl+2 e Ctrl+3. | Os dígitos entram no número; Enter liga; Esc limpa. Ctrl+1, 2 e 3 trocam para Teclado, Recentes e Contatos. | ☐ | ☐ |
| 3.10 | Passe por todas as telas, menus, avisos, o menu da bandeja, o instalador e as propriedades do `StarsonicPhone.exe` (botão direito → Propriedades → Detalhes). | "MicroSIP" não aparece em lugar nenhum. | ☐ | ☐ |

## 4. Uma ligação

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 4.1 | Ligue pelo Teclado para outro ramal. Compare com a tela Chamada do canvas. | "Chamando…" e depois a tela da ligação, escura, com o nome ou o número, o tempo, Mudo, Teclado, Áudio, Espera, Transferir, Nova ligação e o Desligar em vermelho (com o rótulo fora do botão). Áudio nos dois sentidos. | ☐ | ☐ |
| 4.2 | Com a janela na frente, receba uma ligação. | A tela da ligação mostra a recebida, com Recusar (vermelho) e Atender (ciano), sem o aviso do canto. Atender: áudio nos dois sentidos. | ☐ | ☐ |
| 4.3 | Mudo e tire o mudo; Espera e tire a espera. | O outro lado deixa de ouvir e volta a ouvir; na espera, ouve a espera, e o áudio volta. | ☐ | ☐ |
| 4.4 | Ligue para uma URA e use o botão Teclado da ligação; depois, com o teclado da ligação aberto, use as teclas do PC. | A URA reconhece as teclas. Os dígitos mandados aparecem embaixo do tempo. Com o teclado da ligação fechado, as teclas do PC não mandam nada. | ☐ | ☐ |
| 4.5 | Transferir → digite outro ramal → Transferir agora. Depois, para um ramal que a central recuse. | A ligação passa para o outro ramal e sai do app. A recusada: "O servidor não aceitou a transferência." por 2 s, e a ligação continua. | ☐ | ☐ |
| 4.6 | Ligue para um ramal ocupado, para um número que não existe e para um que não atende. | Por 2 s: "Ocupado", "Número não encontrado" ou "Não atendeu". | ☐ | ☐ |
| 4.7 | Desligue. Deixe outra ligação tocar até o outro lado desistir. | A tela volta ao Teclado. As duas entram no Recentes: a feita com a duração, a perdida em vermelho; aviso "Ligação perdida de <contato ou número>". | ☐ | ☐ |
| 4.8 | Sem nenhuma ligação, olhe a área do relógio do Windows 11 (o ícone de microfone em uso) e, no W10, Configurações → Privacidade → Microfone. | O microfone só fica em uso durante uma ligação. Anote se ele aparece em uso sem ligação (ao abrir o app ou depois de trocar o microfone nas Configurações). | ☐ | ☐ |
| 4.9 | (Opcional) Desative todos os dispositivos de som em Som → Reprodução e Gravação e tente ligar. | Anote a mensagem: `____`. Ative de novo. | ☐ | ☐ |

## 5. Duas ligações, consulta e conferência

Use os ramais do **cliente** e do **colega** (veja "O que precisa").

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 5.1 | Numa ligação com o cliente, receba a ligação do colega. | A faixa "Ligação de <nome ou número>" no alto, com Recusar e Atender, e um bipe curto repetido (não o toque completo). A conversa com o cliente continua. Nova ligação fica desabilitada enquanto a segunda toca. | ☐ | ☐ |
| 5.2 | Atenda pela faixa. | O colega fica em cima; o cliente vai para o cartão "Em espera" e ouve a espera. Os controles: Mudo, Teclado, Áudio, Espera, Transferir, Alternar e Juntar; o cartão de baixo tem um Desligar pequeno. | ☐ | ☐ |
| 5.3 | Alternar, duas vezes. | Os cartões trocam de lugar; quem está em cima tem o som. | ☐ | ☐ |
| 5.4 | Desligue a de cima. | A outra volta sozinha, com o áudio, sem tocar em nada. | ☐ | ☐ |
| 5.5 | Numa ligação, recuse a segunda pela faixa; depois, deixe outra segunda desistir. | O colega ouve ocupado; a ligação entra no Recentes como perdida. A do cliente continua sem mudança. | ☐ | ☐ |
| 5.6 | Numa ligação, receba a segunda e, com ela tocando, o cliente desliga. | A segunda passa a tocar com o toque completo, como uma ligação normal. | ☐ | ☐ |
| 5.7 | Com duas em andamento, ligue para o ramal de um terceiro telefone. | O terceiro ouve ocupado; as duas continuam. | ☐ | ☐ |
| 5.8 | Numa ligação, Nova ligação → o ramal do colega → Ligar. | O cliente vai para "Em espera"; o cartão de cima mostra "Chamando…" até o colega atender; Alternar fica desabilitado enquanto chama. | ☐ | ☐ |
| 5.9 | Numa ligação com o cliente, Transferir → o ramal do colega → Consultar. Compare com a tela Consulta do canvas. | O cliente no cartão de cima com "Em espera · transferência"; o colega em destaque ("Consultando"); Mudo, Alternar e Cancelar, e "Concluir transferência" em ciano. | ☐ | ☐ |
| 5.10 | Com o colega atendendo, Concluir transferência. | As duas ligações saem do app e a tela volta ao Teclado; o cliente e o colega ficam falando entre si. | ☐ | ☐ |
| 5.11 | Repita a consulta e: Alternar e Concluir com o cliente em cima; Cancelar com o colega em linha; o colega não atende; o cliente desliga durante a consulta. | Concluir funciona dos dois lados. Cancelar: o colega sai e o cliente volta sozinho. Sem atender: o cliente volta e "<colega>: Não atendeu" por 2 s. O cliente desligou: "<cliente> desligou" e a conversa com o colega continua. | ☐ | ☐ |
| 5.12 | Com o cliente e o colega em andamento, Juntar. Compare com a tela Conferência do canvas. | "Conferência" com os dois e o tempo desde o Juntar; Mudo, Teclado, Separar e "Desligar para todos". Os três se ouvem. | ☐ | ☐ |
| 5.13 | Na conferência: Mudo; Separar e Juntar de novo; o colega desliga; por fim, outra conferência e "Desligar para todos". | Mudo: ninguém ouve o PC. Separar: volta aos dois cartões, um em espera. O colega saiu: "<colega> desligou" e a ligação com o cliente continua. Desligar para todos: as duas acabam e entram no Recentes. | ☐ | ☐ |
| 5.14 | Numa ligação, troque a conta pelo cabeçalho (a outra conta gravada). | "A troca de conta fica para o fim da ligação." por 2 s; a ligação continua. Ao desligar, o app troca sozinho e fica "Conectado" na conta escolhida. | ☐ | ☐ |

## 6. Áudio: headset USB, Bluetooth e o toque

Para conferir os nomes, abra o `diagnostico.log` e procure as linhas **"motor dispositivos de som:"** (os nomes que o motor vê, que podem vir cortados em 31 caracteres) e **"webview saidas de som:"** (os nomes que a interface vê, para o toque e o bipe).

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 6.1 | Com o headset USB ligado, abra Configurações → Áudio e compare com a tela Configurações do canvas. | Microfone, Alto-falante e Toque, cada um com "Padrão do Windows" e os dispositivos do PC. Anote os nomes do headset nas duas linhas do log: motor `____`, webview `____`. | ☐ | ☐ |
| 6.2 | Escolha o headset em Microfone e em Alto-falante, e os alto-falantes do PC em Toque. Receba uma ligação. | O toque completo sai nos alto-falantes do PC; a conversa, no headset. | ☐ | ☐ |
| 6.3 | Numa ligação pelo headset, receba a segunda. | O bipe da segunda ligação sai **no headset** (onde a pessoa está ouvindo), não nos alto-falantes. Se sair nos alto-falantes, anote os nomes das duas linhas do log. | ☐ | ☐ |
| 6.4 | Com o app aberto e sem ligação, **desconecte** o headset USB. Espere uns 2 s e abra Configurações → Áudio. | Microfone e Alto-falante mostram "<nome do headset> (desconectado)". Ligue: a ligação sai pelo padrão do Windows, com áudio. No log, "som: os dispositivos foram relidos". | ☐ | ☐ |
| 6.5 | **Conecte** o headset de novo, sem fechar o app. Espere uns 2 s. | O "(desconectado)" some e a escolha volta sozinha: a próxima ligação sai no headset, sem abrir o app de novo. | ☐ | ☐ |
| 6.6 | Numa ligação pelo headset, desconecte o headset; conecte de novo e faça outra ligação. | Anote o que acontece com a ligação em andamento (ela pode ficar sem som). A ligação seguinte usa o padrão com o headset fora e o headset quando ele volta. | ☐ | ☐ |
| 6.7 | Na ligação, use o botão Áudio. | O menu com Alto-falante e Microfone, "Padrão do Windows" e os dispositivos; a troca vale na hora. | ☐ | ☐ |
| 6.8 | Repita 6.2 a 6.5 com um fone **Bluetooth** (conectar e desconectar pelo Bluetooth do Windows, ou desligando o fone). | Anote se o app percebe a saída e a volta sozinho. O Bluetooth pode não avisar o app: se o "(desconectado)" não aparecer, anote o fone e o Windows. | ☐ | ☐ |
| 6.9 | Repita 5.1 a 5.4 só com o alto-falante e o microfone do PC (sem fone). | Anote se há eco do outro lado: `____`. | ☐ | ☐ |
| 6.10 | Numa ligação, conecte e tire um pendrive (ou outro aparelho USB que não seja de som). | A ligação continua. Anote se o som falha por um instante (o app relê os dispositivos a cada aparelho que entra ou sai): `____`. | ☐ | ☐ |

## 7. Aviso de ligação e bandeja

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 7.1 | Feche a janela no X (vai para a bandeja) e receba uma ligação. Compare com a tela Recebida do canvas. | O aviso no canto de baixo à direita, por cima de tudo: "Ligação recebida · <conta>", o nome, o número, Recusar e Atender. O toque sai no dispositivo de Toque. No W11, o aviso tem os cantos arredondados; no W10, quadrados. | ☐ | ☐ |
| 7.2 | Com o app na bandeja, deixe uma ligação tocar uns 30 s e marque o tempo. | O toque tem o ritmo de 1 s ligado e 4 s desligado (uns 6 toques em 30 s). Anote se ele atrasa ou falha com a janela escondida: `____`. | ☐ | ☐ |
| 7.3 | Repita com a janela minimizada e com a janela atrás de outra (ex.: o navegador na frente). | O aviso aparece nos dois casos. | ☐ | ☐ |
| 7.4 | Abra o Bloco de Notas e fique digitando. Peça para ligarem no meio. | O aviso aparece sem tirar o foco: o texto continua entrando no Bloco de Notas. | ☐ | ☐ |
| 7.5 | Com o aviso na tela, clique numa área do aviso fora dos botões e continue digitando no Bloco de Notas. | Anote se o aviso tomou o foco: `____`. | ☐ | ☐ |
| 7.6 | Clique em Atender no aviso. | O aviso some, a janela principal vem para a frente na tela da ligação, com áudio. | ☐ | ☐ |
| 7.7 | Com o app na bandeja, recuse pelo aviso. Depois, deixe uma tocar até perder. | Recusar: quem liga ouve ocupado, e o aviso some. Perdida: o aviso some quando o outro lado desiste, e a ligação vai ao Recentes como perdida. | ☐ | ☐ |
| 7.8 | Olhe o ícone da bandeja: conectado; sem internet; com Não perturbe; com uma ligação tocando; depois de uma perdida (e depois de abrir o Recentes). | Um ícone para cada estado. Tocando, o ícone pisca. A perdida fica marcada até a pessoa abrir o Recentes (ou abrir o app de novo). | ☐ | ☐ |
| 7.9 | Clique no ícone da bandeja; depois, clique com o botão direito. | O clique mostra a janela. O menu tem "Abrir", "Não perturbe" (marcado quando ligado) e "Sair". "Não perturbe" liga e desliga o mesmo botão do cabeçalho; "Sair" fecha o app. | ☐ | ☐ |
| 7.10 | Com uma apresentação do PowerPoint em tela cheia, receba uma ligação. | Anote se o aviso aparece por cima: `____`. Se não aparecer, a ligação toca e o ícone da bandeja pisca (aceito na W1). | ☐ | ☐ |

## 8. Não perturbe, Atender automático e contas

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 8.1 | Ligue "Não perturbe" no cabeçalho e receba uma ligação. | O botão fica marcado. Quem liga ouve ocupado; o app não toca e não mostra aviso; a ligação vai ao Recentes como perdida. As ligações feitas funcionam. | ☐ | ☐ |
| 8.2 | Com o Não perturbe ligado, Menu → Sair e abra o app. | O Não perturbe continua ligado. Desligue. | ☐ | ☐ |
| 8.3 | Com uma ligação tocando, ligue o Não perturbe. | A que já toca continua tocando (o Não perturbe vale para as próximas); a próxima leva ocupado. | ☐ | ☐ |
| 8.4 | Ligue "Atender automático" e receba uma ligação. | Depois de 3 s tocando, o app atende sozinho. | ☐ | ☐ |
| 8.5 | Em Configurações → Ligações, troque "Tempo para atender" para "Na hora" e depois para 10 s. Receba uma ligação em cada um. | Atende na hora e depois de 10 s. | ☐ | ☐ |
| 8.6 | Com o Atender automático ligado, numa ligação, receba a segunda. | A segunda toca normalmente (na faixa), sem ser atendida sozinha. | ☐ | ☐ |
| 8.7 | Com o Não perturbe e o Atender automático ligados, receba uma ligação. | Vale o Não perturbe: ocupado, sem atender. | ☐ | ☐ |
| 8.8 | Com duas contas gravadas, troque pelo cabeçalho (a conta → a outra). | O registro sai da atual e entra na escolhida: "Conectado · <servidor dela>". As ligações para o ramal antigo deixam de tocar no app. | ☐ | ☐ |
| 8.9 | Configurações → Contas → Editar uma conta e Remover; depois, Remover a conta em uso numa ligação. | Remover pede confirmação ("Cancelar" foca primeiro; o botão de remover em azul). Com a conta em uso numa ligação, não remove. Remover a em uso sem ligação passa para a primeira que sobrou; sem nenhuma, a tela Entrar. | ☐ | ☐ |
| 8.10 | Com duas contas, deixe uma sem a senha gravada: use uma que veio sem a senha na seção 13 ou, com o app fechado (Menu → Sair), troque o valor dela no `contas.json` para `"senha_protegida": ""`. Abra o app na outra e troque para essa pelo cabeçalho. | A tela Entrar preenchida pede só a senha, com "Digite a senha de novo para continuar." e um botão "Cancelar". "Cancelar" volta para a conta que funcionava, "Conectado". Depois de Menu → Sair e abrir de novo, a conta em uso continua a que funcionava. | ☐ | ☐ |
| 8.11 | Repita o 8.10 e, com a tela Entrar pedindo a senha (antes do Cancelar), receba uma ligação no ramal da conta que funcionava. | A tela da ligação aparece por cima do Entrar, com Recusar e Atender; atendida, Mudo, Espera e Desligar funcionam. Ao desligar, o app volta para a tela Entrar pedindo a senha. | ☐ | ☐ |
| 8.12 | Com uma ligação em andamento, Configurações → Adicionar conta e Entrar com um ramal certo. | O Entrar espera o fim da ligação; ao desligar, a conta nova entra. | ☐ | ☐ |

## 9. Contatos e Recentes

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 9.1 | Contatos → "+": grave um contato com um ramal de teste, um com um número externo com DDD (ex.: `(11) 5060-3000`) e um com o mesmo número com "+55" (ex.: `+55 11 5060-3000`), cada um com uma observação. Compare com a tela Contatos do canvas. | A lista em ordem alfabética, com as iniciais, o número e a observação. Nome e número são obrigatórios. | ☐ | ☐ |
| 9.2 | Busque por parte do nome (sem acento) e por parte do número. | A lista filtra nos dois casos. | ☐ | ☐ |
| 9.3 | Toque num contato; depois, use o menu dele: Editar e Remover. | Tocar liga. Editar abre o formulário preenchido; Remover pede confirmação. | ☐ | ☐ |
| 9.4 | Receba uma ligação do ramal gravado como contato, com a janela na frente e com o app na bandeja; deixe uma tocar até perder. | O nome do contato no lugar do número: na ligação, no aviso, no "Ligação perdida de <contato>" e no Recentes. | ☐ | ☐ |
| 9.5 | Receba uma ligação do número externo gravado só com "+55" (se a central mandar o número sem o "+55"). | Anote se o nome aparece: `____` (um número que só difere pelo "+55" pode não casar; conhecido). | ☐ | ☐ |
| 9.6 | Abra o Recentes e compare com a tela Recentes do canvas. Use os filtros Todas e Perdidas. | Os grupos Hoje, Ontem e a data; em cada linha o tipo (feita, recebida, perdida em vermelho), o nome ou número, a hora e a duração, e o botão de ligar. "Perdidas" com a contagem. | ☐ | ☐ |
| 9.7 | Toque numa linha do Recentes de um número sem contato: "Salvar contato". Depois, "Ligar". | "Salvar contato" abre o formulário com o número; "Ligar" liga. | ☐ | ☐ |

## 10. Links, instância única e Iniciar com o Windows

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 10.1 | Com o app aberto, abra o atalho do Starsonic Phone de novo. | Nenhum segundo app: a janela do que já estava aberto vem para a frente. | ☐ | ☐ |
| 10.2 | Num PC **sem outro programa para os links** (antes de instalar o outro softphone), digite `tel:2003` na barra de endereço do Edge e do Chrome. | O navegador pergunta se pode abrir o Starsonic Phone; o app abre com `2003` no Teclado, pronto para Ligar, sem ligar sozinho. Com o app fechado, ele abre e mostra o número. | ☐ | ☐ |
| 10.3 | Abra um link `tel:` de outro programa (ex.: um número com link num documento do Word, num e-mail do Outlook ou no Executar, Win+R → `tel:2003`). Teste também `sip:2003` e `callto:2003`. | O app abre com o número no Teclado, sem ligar. | ☐ | ☐ |
| 10.4 | Num PC com **outro softphone registrado para os links** antes de instalar o Starsonic Phone, instale o Starsonic Phone e abra um link `tel:`. | O link continua abrindo o outro softphone (o instalador não toma o link de outro programa). Em Aplicativos padrão → Starsonic Phone, escolha-o para TEL: daí em diante, o link abre o Starsonic Phone. | ☐ | ☐ |
| 10.5 | Com "Iniciar com o Windows" marcado no instalador, reinicie o PC. | O app abre sozinho na bandeja, sem mostrar a janela, e fica "Conectado". Em Configurações, "Iniciar com o Windows" ligado. | ☐ | ☐ |
| 10.6 | Desligue "Iniciar com o Windows" nas Configurações e reinicie; depois, ligue de novo e reinicie. | Desligado: o app não abre com o Windows. Ligado: abre na bandeja. | ☐ | ☐ |
| 10.7 | No Gerenciador de Tarefas → Aplicativos de inicialização, **desabilite** o Starsonic Phone. Abra o app. | Em Configurações, "Iniciar com o Windows" aparece desligado. Ligue nas Configurações e reinicie: o app abre com o Windows (o Gerenciador de Tarefas passa a mostrar habilitado). | ☐ | ☐ |
| 10.8 | Desabilite de novo no Gerenciador de Tarefas e instale a mesma versão por cima (o instalador, marcando "Iniciar com o Windows"). Reinicie. | O que a pessoa desabilitou no Gerenciador de Tarefas continua desabilitado. | ☐ | ☐ |
| 10.9 | Com o app aberto (e depois numa ligação), saia da conta do Windows (Sair) e entre de novo. | O Windows não fica esperando o app para sair. Na volta, com "Iniciar com o Windows" ligado, o app abre na bandeja. | ☐ | ☐ |

## 11. Sobre e diagnóstico

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 11.1 | Menu → Sobre. Compare com a tela Sobre do canvas. | O logo, "Starsonic Phone <versão>", "Licença GPL v3 · usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)", "Plus Jakarta Sans (OFL), Preact (MIT) e WebView2 (Microsoft)", o site, "(11) 5060-3000" com "Também no WhatsApp · seg. a sex., 8h às 18h", o código-fonte e "Enviar diagnóstico". | ☐ | ☐ |
| 11.2 | Clique em Abrir (site), WhatsApp e Abrir (código-fonte). | Abrem no navegador padrão: starsonic.com.br, o wa.me da Starsonic e o repositório no GitHub. Nada abre dentro do app. | ☐ | ☐ |
| 11.3 | Depois de entrar e fazer algumas ligações, Enviar diagnóstico. | O Explorer abre com o arquivo "Starsonic Phone diagnostico <data> <hora>.log" selecionado (na pasta temporária). | ☐ | ☐ |
| 11.4 | Abra esse arquivo no Bloco de Notas e procure (Ctrl+F) "Authorization" e a senha do ramal. | Toda linha de "Authorization" aparece como `Authorization: <oculto>`. A senha não aparece em lugar nenhum. | ☐ | ☐ |
| 11.5 | Mande o arquivo pelo WhatsApp Web e por e-mail. | O anexo chega e abre. | ☐ | ☐ |

## 12. Recuperação e fechamento

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 12.1 | Com o app aberto, no Gerenciador de Tarefas → Processos, expanda "Starsonic Phone" e finalize os processos "Microsoft Edge WebView2" dele (ou, na aba Detalhes, os `msedgewebview2.exe` do app). | A janela fica em branco por um instante e a interface volta sozinha, em poucos segundos, "Conectado". No log, "navegador reiniciado". | ☐ | ☐ |
| 12.2 | Receba uma ligação: com a janela escondida e na frente. | Toca e aparece normalmente (o aviso também voltou). | ☐ | ☐ |
| 12.3 | Repita o 12.1 durante uma ligação. | A ligação continua, com o áudio; a tela da ligação volta. | ☐ | ☐ |
| 12.4 | Menu → Sair; abra o app logo em seguida. Repita pelo Sair da bandeja. | O app fecha em poucos segundos (no máximo uns 5 s) e abre de novo na primeira tentativa. | ☐ | ☐ |

## 13. Atualização da rc.7 para o app novo

Faça esta seção num PC que ainda não recebeu o app novo. Prepare a rc.7 (`v0.0.1-rc.7`, instalada pela página do release dela) com: **duas contas**, uma em cada servidor (de preferência a em uso **não** sendo a primeira da lista); pelo menos **três contatos** (um com observação); e **ligações no Recentes** (uma feita, uma recebida, uma perdida). Anote qual conta está em uso: `__________`. Antes, copie a pasta `%APPDATA%\Starsonic Phone` para fora (para repetir o teste).

Faça o caminho A num PC e o B no outro (ou refaça a rc.7: desinstale o app novo, apague `contas.json`, `contatos.json`, `recentes.json` e `config.json`, tire o `.migrado` do fim dos arquivos e instale a rc.7 de novo).

**A. Pelo atualizador da própria rc.7** (a `0.1.0-rc.1` já publicada no `canal-teste`):

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 13.1 | Na rc.7, Menu → Sair e abra. | O aviso "Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?" com as notas da versão. | ☐ | ☐ |
| 13.2 | Com o aviso aberto (sem responder), receba uma ligação e atenda; com ela em andamento, responda "Sim". | "Termine a chamada para atualizar." e nada muda. | ☐ | ☐ |
| 13.3 | Desligue, Menu → Sair, abra e responda "Sim". | "Baixando atualização…"; a rc.7 fecha, a instalação roda sem perguntar nada e o app novo abre sozinho. | ☐ | ☐ |

**B. Instalando por cima:**

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 13.4 | Com a rc.7 aberta, baixe e abra `StarsonicPhone-<versão>-setup.exe` e clique em Instalar. | O instalador fecha a rc.7 sozinho e instala; no fim, "Abrir o Starsonic Phone" abre o app novo. As opções da primeira página vêm como a rc.7 estava (atalho e início com o Windows). | ☐ | ☐ |

**Nos dois caminhos, confira:**

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 13.5 | Olhe o cabeçalho logo que o app novo abre. | "Conectado" **na conta que estava em uso** na rc.7, sem pedir a senha. | ☐ | ☐ |
| 13.6 | Configurações → Contas; depois, troque para a outra conta pelo cabeçalho. | As duas contas, com o servidor, o protocolo e o nome. A outra entra "Conectado" sem pedir a senha (a senha veio junto). Volte para a que estava em uso. | ☐ | ☐ |
| 13.7 | Abra Contatos e Recentes. | Todos os contatos, com a observação. As ligações da rc.7 no Recentes, com o tipo (feita, recebida, perdida), a data e a duração. | ☐ | ☐ |
| 13.8 | Abra `%APPDATA%\Starsonic Phone`. | `StarsonicPhone.ini.migrado`, `Contacts.xml.migrado` e `call_log.db.migrado` no lugar dos antigos, e os arquivos novos `contas.json`, `contatos.json`, `recentes.json` e `config.json`. | ☐ | ☐ |
| 13.9 | Abra `%LOCALAPPDATA%\Starsonic Phone`. | Nada da rc.7: sem os sons `.wav`, sem `langpack_*.txt`, sem `StarsonicPhone_log.txt` e sem `crash-dump_*`. | ☐ | ☐ |
| 13.10 | Se a rc.7 iniciava com o Windows, reinicie o PC. | O app novo abre na bandeja; em Configurações, "Iniciar com o Windows" ligado. | ☐ | ☐ |
| 13.11 | Ligue e receba nas duas contas. | Tudo como nas seções 2 e 4. | ☐ | ☐ |
| 13.12 | Se alguma conta veio sem a senha (pode acontecer em algum PC), troque para ela. | A tela Entrar preenchida, pedindo só a senha, com "Digite a senha de novo para continuar.". Anote o PC e mande o diagnóstico (linha "migracao da rc.7: N conta(s), M sem a senha"). | ☐ | ☐ |
| 13.13 | (Opcional) Para voltar para a rc.7: desinstale o app novo, tire o `.migrado` do fim dos três arquivos e instale a rc.7. | A rc.7 abre com as contas e os contatos de antes. | ☐ | ☐ |

## 14. Atualização do app novo para uma versão mais nova

Faça quando houver a rc seguinte (`vX.Y.Z-rc.N+1`), publicada no `canal-teste`. O app novo procura atualização 1 minuto depois de abrir e a cada 24 h aberto.

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 14.1 | Com a rc anterior instalada, Menu → Sair, abra e espere 1 minuto com o cursor no número do Teclado. | A pergunta "Atualização": "Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?", com as notas, "Depois" e "Atualizar agora". O foco fica no **"Depois"**. | ☐ | ☐ |
| 14.2 | Aperte Enter. | Vale o "Depois": a pergunta fecha e nada é instalado. | ☐ | ☐ |
| 14.3 | Menu → Sair e abra; com a pergunta na tela, receba uma ligação e atenda. | A pergunta não cobre a ligação: some enquanto ela dura e volta quando ela acaba. (Se o "Atualizar agora" for escolhido com uma ligação, aparece "Termine a chamada para atualizar." por 2 s e nada é baixado.) | ☐ | ☐ |
| 14.4 | Sem ligação, "Atualizar agora". | "Baixando atualização…"; o app fecha, atualiza sem perguntar nada e abre sozinho. Sobre mostra a versão nova; as contas, os contatos, os Recentes, o Não perturbe e o Atender automático continuam; conecta sem pedir a senha. | ☐ | ☐ |
| 14.5 | Sem internet, Menu → Sair e abra. Espere 1 minuto. | Nenhuma pergunta e nenhum erro. | ☐ | ☐ |

## 15. Desinstalação

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 15.1 | Com o app aberto, desinstale por Configurações → Aplicativos instalados. | Sem senha de administrador; o app fecha; somem os atalhos e o item da lista. A pasta `%LOCALAPPDATA%\Starsonic Phone` some inteira, **com a pasta `WebView2`** de dentro. O app sai de Aplicativos padrão e de Aplicativos de inicialização. | ☐ | ☐ |
| 15.2 | Abra um link `tel:`. | Não abre mais o Starsonic Phone. | ☐ | ☐ |
| 15.3 | Confira `%APPDATA%\Starsonic Phone`. | Continua lá: as contas, os contatos, os Recentes e as configurações ficam. | ☐ | ☐ |
| 15.4 | Instale de novo. | O app abre "Conectado" na conta que estava em uso, com os contatos e os Recentes. | ☐ | ☐ |

## Onde cada critério de sucesso é verificado

| Critério (spec da W1, §3) | Automático (a cada build) | Neste roteiro |
|---------------------------|---------------------------|---------------|
| Num Windows 10 e num Windows 11 limpos, instalar pelo link, entrar com servidor, protocolo, ramal e senha, e fazer e receber ligações nos dois servidores | `Test-Installer.ps1` (silencioso e pela tela, os links, a desinstalação); a fumaça do app instalado (`windows_smoke.py` pelo CDP: entra no registrador falso, liga, recebe e atende pelo aviso); os testes do núcleo (a porta por servidor, as mensagens da tela Entrar) e do `desktop_tests` (o Entrar) | 1, 2 |
| A segunda ligação, alternar, transferir com consulta, conferência, separar, e a outra volta sozinha | `call_controller_tests` (os casos do `CallManagerTest.kt` da 0.2 portados), `phone_tests` (o motor contra o registrador falso), o Playwright (`call.spec.ts`) | 5 |
| Com o app minimizado ou na bandeja, a recebida aparece no aviso e toca no dispositivo escolhido | a fumaça (o aviso com a janela minimizada, sem roubar o primeiro plano, e o Atender dele); o Playwright do toque (o ritmo e o `setSinkId`); o `desktop_tests` (a bandeja e o aviso) | 6, 7 |
| Não perturbe, Atender automático e a troca entre duas contas | `call_controller_tests` (Não perturbe, Atender automático, troca de conta), `desktop_tests` (a troca, a troca pendente, a conta sem senha com Cancelar), o Playwright | 8 |
| A rc.7 com duas contas e contatos atualiza e abre "Conectado" na conta em uso, com as contas, os contatos e os recentes | `desktop_tests` (a migração do `.ini` UTF-16LE, do `Contacts.xml` e do `call_log.db`; a senha cifrada pelo `CCrypto` original, no Windows); o ensaio pelo `workflow_dispatch` (`ensaio-atualizacao`: a rc.7 de verdade com uma conta e um contato, o instalador novo em silêncio, "Conectado" e os `.migrado` do `.ini` e do `Contacts.xml`) | 13 |
| As telas seguem o canvas, no tema claro e no escuro, e nenhum "MicroSIP" | o Playwright (cada tela nos dois temas, as capturas e o axe); `check_branding.py` (o exe, a pasta `ui\` e o instalador aberto por dentro) | 3, 9, 11 |
| Tudo passa nos testes automáticos e neste roteiro | os workflows `build` e `android` | todo o roteiro |
