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
- Para as seções 16 a 18 (rc.3): o canvas "Starsonic Phone Windows — atalhos, administrador e status" aberto; os três ramais da seção 8 na mesma central, com o BLF ligado nela (a Starsonic já ligou nos dois servidores): o do app (**A**), o **colega** (**B**, o que o atalho vigia) e o **cliente** (**C**, o que liga para o B); o código de puxar ligação da central (pergunte à Starsonic, por exemplo `**{ramal}`); a senha da área do administrador (com o responsável, fora do repositório); e o headset USB para o bipe.
- Para a seção 19 (rc.4): o **Excel** (Microsoft 365 ou 2016 em diante, em português) num dos PCs; uma **conta Google** de teste; uma **conta Microsoft pessoal** (outlook.com ou hotmail.com, com o OneDrive); uma conta do **Microsoft 365 de uma empresa** (com o SharePoint ou o OneDrive do trabalho); uma **pasta da rede** que os dois PCs abrem no Explorer (a pasta compartilhada de outro PC ou de um servidor); um **CSV exportado pelo MicroSIP** com uns três contatos, um com acento e um com comentário (na rc.7 ou no MicroSIP oficial: na lista de contatos, botão direito → Exportar, tipo CSV); o headset USB; e os ramais do **cliente** e do **colega** da seção 5. As duas planilhas de teste estão no começo da seção 19.

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
| 3.9 | No Teclado, use o teclado do PC: dígitos, `*`, `#`, Enter, Esc; depois Ctrl+1, Ctrl+2, Ctrl+3 e Ctrl+4. | Os dígitos entram no número; Enter liga; Esc limpa. Ctrl+1 a 4 trocam para Teclado, Atalhos, Recentes e Contatos, a ordem das abas. | ☐ | ☐ |
| 3.10 | Passe por todas as telas, menus, avisos, o menu da bandeja, o instalador e as propriedades do `StarsonicPhone.exe` (botão direito → Propriedades → Detalhes). | "MicroSIP" não aparece em lugar nenhum. | ☐ | ☐ |
| 3.11 | (rc.2) Com o canvas "Starsonic Phone Windows — tamanho, rediscar e status" aberto, passe o mouse nas bordas da janela (esquerda, direita, embaixo e em cima) e nos cantos de baixo; arraste cada uma. | O cursor vira a seta dupla na borda e a diagonal nos cantos; a janela muda de tamanho pelos quatro lados e pelos cantos, e a interface acompanha sem piscar nem ficar com sobra preta. A sombra e os cantos arredondados do Windows 11 continuam. | ☐ | ☐ |
| 3.12 | Arraste o canto de baixo à direita, onde fica o desenho do canto (as duas linhas diagonais). | A janela muda de tamanho pelo canto (o desenho só indica o lugar; quem pega é a borda do Windows, logo ali). | ☐ | ☐ |
| 3.13 | Diminua a janela o quanto der. Depois aumente até passar da tela. | Ela para em 300×440 (a 100%) e não diminui mais; e não passa da área de trabalho do monitor. | ☐ | ☐ |
| 3.14 | Passe pelos três layouts: 400×720 (Normal), uns 340×560 (Compacto) e o mínimo (Mínimo). Compare com Main, Compacto e Mínimo do canvas. | Normal: o de sempre, com o Rediscar à esquerda do Ligar. Compacto: o logo menor, Não perturbe e Atender automático em botões redondos ao lado do Menu, a conta numa linha (bolinha, ramal e estado com reticências), teclas menores. Mínimo: sem o logo, uma faixa com a bolinha, o ramal, o estado, o Não perturbe e o Menu; as teclas só com os números; a navegação só com os ícones. Em todos, as 12 teclas, o Rediscar, o Ligar e a navegação aparecem inteiros, sem rolar. | ☐ | ☐ |
| 3.15 | No Compacto e no Mínimo, abra Recentes, Contatos, Configurações, Sobre, um contato novo e, numa ligação, Teclado, Transferir e Nova ligação; com duas ligações, a consulta e a conferência. | Nada sai da janela nem fica cortado; o meio da tela rola quando precisa. O Desligar, o Atender e o Recusar ficam inteiros, sem nada por cima. No Mínimo, o Atender automático fica nas Configurações. | ☐ | ☐ |
| 3.16 | Deixe a janela num tamanho diferente (ex.: 340×560), feche (Menu → Sair) e abra. | Ela abre no mesmo tamanho e no mesmo lugar. | ☐ | ☐ |
| 3.17 | Repita o 3.13 e o 3.14 em **125%** e em **150%**, e passe a janela de um monitor de 100% para um de 150% (se tiver dois). | Os mesmos limites em tamanho lógico (300×440 é o mínimo em qualquer escala); ao trocar de monitor, a janela fica com o mesmo tamanho lógico. | ☐ | ☐ |
| 3.18 | Numa janela bem larga (ex.: 600×900). | O cabeçalho vai de ponta a ponta; o teclado e o resto ficam no meio, com no máximo uns 480 de largura (as teclas não esticam). | ☐ | ☐ |
| 3.19 | (rc.2) Sem nenhuma ligação feita ainda (uma conta nova), olhe o Rediscar. Depois ligue para um contato e para um número sem contato, e passe o mouse no Rediscar a cada vez. | Sem ligação feita, o Rediscar fica apagado e diz "Rediscar". Depois, o balão "Rediscar <número> · <nome>" (só o número, sem contato), e o clique liga para a última feita, como o Ligar da linha nos Recentes. | ☐ | ☐ |
| 3.20 | Numa ligação, abra Nova ligação e use o Rediscar do painel; abra também o Teclado da ligação. | O Rediscar do painel liga para a última feita (a outra vai para a espera). O teclado da ligação (o dos tons) não tem o Rediscar. | ☐ | ☐ |
| 3.21 | (rc.2) Olhe a bolinha da conta no cabeçalho e em Configurações → Contas: conectado; ao abrir ou trocar de conta; com a senha errada; e, numa ligação (tocando e falando), a barra de título. (Sem internet e Não perturbe: 18.5 e 18.6.) | Verde com "Conectado · <servidor>"; ciano com "Conectando…"; cinza com o triângulo amarelo e a mensagem do erro; na ligação, a bolinha vermelha com "Ocupado · em ligação" na barra de título. O texto fica sempre ao lado da bolinha. | ☐ | ☐ |

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
| 7.2 | Com o app na bandeja, deixe uma ligação tocar uns 30 s e marque o tempo. | Desde a rc.4, o toque de telefone, o "trrim-trrim" e o silêncio, numa volta a cada 3 s (umas 10 em 30 s; 19.1); até a rc.3, 1 s ligado e 4 s desligado (uns 6 toques em 30 s). Anote se ele atrasa ou falha com a janela escondida: `____`. | ☐ | ☐ |
| 7.3 | Repita com a janela minimizada e com a janela atrás de outra (ex.: o navegador na frente). | O aviso aparece nos dois casos. | ☐ | ☐ |
| 7.4 | Abra o Bloco de Notas e fique digitando. Peça para ligarem no meio. | O aviso aparece sem tirar o foco: o texto continua entrando no Bloco de Notas. | ☐ | ☐ |
| 7.5 | Com o aviso na tela, clique numa área do aviso fora dos botões e continue digitando no Bloco de Notas. | Anote se o aviso tomou o foco: `____`. | ☐ | ☐ |
| 7.6 | Clique em Atender no aviso. | O aviso some, a janela principal vem para a frente na tela da ligação, com áudio. | ☐ | ☐ |
| 7.7 | Com o app na bandeja, recuse pelo aviso. Depois, deixe uma tocar até perder. | Recusar: quem liga ouve ocupado, e o aviso some. Perdida: o aviso some quando o outro lado desiste, e a ligação vai ao Recentes como perdida. | ☐ | ☐ |
| 7.8 | Olhe o ícone da bandeja: conectado; numa ligação (chamando, falando); com Não perturbe; com uma ligação tocando; depois de uma perdida (e depois de abrir o Recentes); sem internet e ao conectar. | Conectado com o ponto verde; em ligação com o ponto vermelho (também com uma perdida); depois de uma perdida, o de perdida; com Não perturbe, o vermelho do Não perturbe. Sem internet, conectando, no erro do cadastro ou sem conexão, o cinza de sem conexão, que vence a perdida e o Não perturbe (a perdida volta com a conexão). Tocando, o ícone pisca entre o vermelho e o de tocando. A perdida fica marcada até a pessoa abrir o Recentes (ou abrir o app de novo). | ☐ | ☐ |
| 7.9 | Clique no ícone da bandeja; depois, clique com o botão direito. | O clique mostra a janela. O menu tem "Abrir", "Não perturbe" (marcado quando ligado) e "Sair". "Não perturbe" liga e desliga o mesmo botão do cabeçalho; "Sair" fecha o app. Com o Não perturbe escondido pelo administrador (17.6), o item some do menu. | ☐ | ☐ |
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
| 14.6 | (rc.3) Com a rc.2 instalada e usada (contas, contatos, Recentes), atualize pela pergunta da rc.2 (14.1 a 14.4) para a rc.3. | Abre "Conectado" na conta em uso, com tudo de antes. A aba Atalhos aparece vazia ("0 de 8"); a área do administrador está com os valores de fábrica (17.13); o bipe vem ligado (18.4). | ☐ | ☐ |
| 14.7 | (rc.4) Com a rc.3 instalada e usada (contas, contatos, atalhos, Recentes), atualize pela pergunta da rc.3 (14.1 a 14.4) para a rc.4. | As notas da pergunta falam do toque novo, do importar e do exportar e da lista da empresa, sem "MicroSIP". Abre "Conectado" na conta em uso, com tudo de antes: os atalhos, a área do administrador e o bipe também. Em Configurações, a parte "Contatos" com o campo vazio e sem situação; nos Contatos, o "⋯" ao lado do "+" e nenhum filtro. A recebida toca o toque novo (19.1). | ☐ | ☐ |

## 15. Desinstalação

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 15.1 | Com o app aberto, desinstale por Configurações → Aplicativos instalados. | Sem senha de administrador; o app fecha; somem os atalhos e o item da lista. A pasta `%LOCALAPPDATA%\Starsonic Phone` some inteira, **com a pasta `WebView2`** de dentro. O app sai de Aplicativos padrão e de Aplicativos de inicialização. | ☐ | ☐ |
| 15.2 | Abra um link `tel:`. | Não abre mais o Starsonic Phone. | ☐ | ☐ |
| 15.3 | Confira `%APPDATA%\Starsonic Phone`. | Continua lá: as contas, os contatos, os Recentes e as configurações ficam. | ☐ | ☐ |
| 15.4 | Instale de novo. | O app abre "Conectado" na conta que estava em uso, com os contatos e os Recentes. | ☐ | ☐ |

## 16. Atalhos, BLF e puxar ligação (rc.3)

Compare com os quadros Main, AtalhoEditar e AtalhosLigacao do canvas "Starsonic Phone Windows — atalhos, administrador e status". Os atalhos são do computador: os mesmos em todas as contas. Faça do 16.11 ao 16.17 nos dois servidores, com os ramais A, B e C (veja "O que precisa").

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 16.1 | Abra a aba Atalhos, a segunda (Teclado, Atalhos, Recentes, Contatos). | "Atalhos" e "0 de 8" no alto, os oito espaços com "Adicionar atalho" em duas colunas e a ajuda "Clique para usar. Clique com o botão direito para editar." (a frase "Num ramal tocando, o clique puxa a ligação." só aparece com o puxar ligado, 16.15) | ☐ | ☐ |
| 16.2 | "Adicionar atalho": nome "Portaria", o número do ramal B, "Ligar"; "Salvar atalho". Clique no cartão. | O cartão com o ícone, "Portaria" e "Ligar · <número>"; o contador "1 de 8". O clique liga para o B, com a regra de discagem, como o Ligar do Teclado. | ☐ | ☐ |
| 16.3 | Na edição, digite um nome com mais de 24 letras e um número com letras e espaços; depois apague o nome e o número e aperte "Salvar atalho". | O nome para em 24 letras; o número só aceita dígitos, `*`, `#` e `+` (até 32). Em branco: "Digite o nome do atalho." e "Digite o número do atalho."; nada é gravado e o que foi digitado continua lá. | ☐ | ☐ |
| 16.4 | Crie atalhos até 8, um de cada ação ("Ligar", "Transferir", "Transferir com consulta", "Enviar teclas"). | "8 de 8"; não sobra "Adicionar atalho". Cada cartão diz a ação e o número ("Transferir · <n>", "Consulta · <n>", "Enviar teclas · <n>"). | ☐ | ☐ |
| 16.5 | Clique com o botão direito num cartão. Depois, pelo teclado, vá com o Tab até o "Mais opções" (⋯) do cartão e aperte Enter: "Editar"; mude o nome e salve. Depois, "Remover". | O botão direito abre "Editar atalho". O ⋯ abre o menu com "Editar" e "Remover". Remover pergunta "Remover atalho": "<nome> sai da lista de atalhos.", com "Remover" em azul; confirmado, o cartão sai. | ☐ | ☐ |
| 16.6 | No Compacto e no Mínimo (3.14), abra a aba com os 8 e o menu ⋯ de um cartão de cada coluna. | Duas colunas, os cartões sem o ícone da ação, com o nome e a ação inteiros; a grade rola dentro do corpo, e a navegação fica inteira. O menu dos cartões das duas colunas abre inteiro, sem cortar na borda da janela. | ☐ | ☐ |
| 16.7 | Fora de ligação, olhe o atalho "Enviar teclas" e clique nele. | Ele fica apagado e não faz nada. | ☐ | ☐ |
| 16.8 | Numa ligação com o C, aperte "Atalhos" na tela da ligação e use um de cada vez: "Ligar", "Transferir", "Transferir com consulta" e "Enviar teclas" (para uma URA ou um telefone onde dê para ouvir os tons). | O painel escuro abre com os mesmos atalhos ("Nova ligação para <n>", "Transferir para <n>", "Consulta com <n>", "Enviar as teclas <n>") e o foco no "Fechar atalhos". Ligar: a do C vai para a espera e liga para o número. Transferir: passa o C direto. Consulta: fala antes com o número, com Transferir e Conferência como no Consultar. Enviar teclas: o outro lado ouve os tons. O painel fecha depois de usar; "Fechar atalhos" e Esc fecham. | ☐ | ☐ |
| 16.9 | Ligue para alguém e, ainda chamando, olhe o "Atalhos". Depois, com duas ligações, abra o painel. | Chamando, o botão fica travado. Com duas ligações, "Ligar" e "Transferir com consulta" ficam desativados no painel. | ☐ | ☐ |
| 16.10 | Menu → Sair e abra; depois troque de conta pelo cabeçalho. | Os atalhos continuam, na mesma ordem, e são os mesmos nas duas contas. | ☐ | ☐ |
| 16.11 | Sem o BLF do administrador (o de fábrica), edite o atalho do ramal B. | A chave "Mostrar se o ramal está livre" fica desativada, com "O administrador não ligou o BLF"; os cartões não mostram estado. | ☐ | ☐ |
| 16.12 | Na área do administrador (seção 17), ligue "BLF nos atalhos". Crie um atalho novo para o ramal B. | Na edição, a chave já vem ligada (só dígitos, de 2 a 6, parece ramal). O cartão mostra a bolinha verde e "Livre" em poucos segundos. Um número externo (ex.: um celular) vem com a chave desligada. | ☐ | ☐ |
| 16.13 | Do C, ligue para o B; o B atende; depois desliga. | Tocando: ciano, piscando devagar, "Tocando". Atendida: vermelha, "Ocupado". Desligada: verde, "Livre". A palavra fica sempre ao lado da bolinha, e o cartão muda em poucos segundos. O painel da ligação (16.8) mostra o mesmo. | ☐ | ☐ |
| 16.14 | Com o B numa ligação, o C liga para o B (a segunda tocando no B). | "Tocando": a que toca vence a que fala. | ☐ | ☐ |
| 16.15 | Na área, ligue "Puxar ligação pelo atalho" e preencha o "Código para puxar a ligação" da central (ex.: `**{ramal}`). Do C, ligue para o B e, com o cartão em "Tocando", clique nele. | A ajuda da aba ganha "Num ramal tocando, o clique puxa a ligação.". O app liga para o código com o ramal (ex.: `**2007`), e a ligação do C vem para o app: o B para de tocar e o A fala com o C. | ☐ | ☐ |
| 16.16 | Repita o 16.15 com o código vazio. Se a central tiver um código sem ramal (ex.: `*8`), repita com ele. | Vazio: a frase do puxar some da ajuda, e o clique faz a ação do atalho (liga para o B). Sem `{ramal}`: liga para o código como está. | ☐ | ☐ |
| 16.17 | Com os cartões mostrando o estado, troque de conta pelo cabeçalho e volte. Desligue o "BLF nos atalhos". Crie um atalho com BLF para um ramal que não existe. | Na troca, os estados passam por "Desconectado" e voltam com os da conta em uso. Sem o BLF do administrador, os cartões ficam sem estado. O ramal que não existe fica "Desconectado", em cinza. | ☐ | ☐ |

## 17. Área do administrador (rc.3)

Compare com os quadros AdmSenha e Adm do canvas.

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 17.1 | Aperte Ctrl+P no Teclado, nos Atalhos, nos Recentes, nos Contatos, nas Configurações, no Sobre e na tela Entrar. Com o diálogo aberto, Ctrl+P de novo. | Abre o diálogo "Área do administrador" com o campo Senha. Nada é impresso e nenhuma janela de impressão aparece. O segundo Ctrl+P não abre outro diálogo. | ☐ | ☐ |
| 17.2 | Numa ligação, aperte Ctrl+P. Com o app na bandeja e o aviso de uma ligação na tela, clique no aviso e aperte Ctrl+P. | Na ligação, nada aparece e nada é impresso. No aviso, nada acontece. | ☐ | ☐ |
| 17.3 | Com o diálogo aberto, receba uma ligação. | O diálogo fecha e a ligação aparece. | ☐ | ☐ |
| 17.4 | Digite uma senha errada e aperte Entrar. Repita até a quinta errada seguida. | "Senha incorreta." e o campo limpo. Na quinta, "Muitas tentativas. Tente de novo em <n> s.", com o Entrar travado e a contagem descendo; depois de 30 s ele aceita de novo. | ☐ | ☐ |
| 17.5 | Digite a senha certa. | A área: "Área do administrador" e "Configurações da Starsonic para este computador.", com Botões da tela principal (Não perturbe e Atender automático), Atalhos ("BLF nos atalhos", "Puxar ligação pelo atalho", "Código para puxar a ligação"), Servidores e Atualizações ("Canal": Teste ou Estável). | ☐ | ☐ |
| 17.6 | Com o Não perturbe ligado, esconda o Não perturbe na área. Receba uma ligação. Depois, mostre de novo. | Na hora o Não perturbe desliga: a bolinha volta para verde, o botão some do cabeçalho e o item some do menu da bandeja, e a ligação toca. Mostrado de novo, o botão volta desligado. | ☐ | ☐ |
| 17.7 | Com o Atender automático ligado, esconda o Atender automático. | Ele desliga na hora; o botão some, e "Atender automaticamente" e "Tempo para atender" somem de Configurações → Ligações. | ☐ | ☐ |
| 17.8 | Em Servidores, adicione um servidor de teste (ex.: `teste-starsonic.com.br`, porta 5070), edite a porta e remova. Tente também um endereço com espaço e um repetido. | A lista começa com o starcloud1 ("Porta 35060 · UDP e TCP") e a linha "Outros servidores · porta 5060". Adicionar e editar funcionam; Remover pergunta antes ("Remover servidor": "<endereço> sai da lista de servidores."). O endereço com espaço ou repetido é recusado com um aviso, e o que foi digitado continua no campo. | ☐ | ☐ |
| 17.9 | Na conta do starcloud1, mude a porta dele para 35061; depois volte para 35060. | Com a 35061, a conta sai do ar e mostra o erro. De volta à 35060: "Conectando…" e "Conectado". | ☐ | ☐ |
| 17.10 | Em Atualizações, escolha Estável. Menu → Sair, abra e espere 1 minuto. Depois volte para Teste. | Com Estável, nenhuma pergunta e nenhum erro (ainda não há versão estável). Com Teste, o app volta a procurar no canal de teste. | ☐ | ☐ |
| 17.11 | "Sair da área do administrador" e Ctrl+P. Entre de novo e deixe 10 minutos sem mexer. Entre de novo e feche a janela no X; abra pela bandeja. | Sair volta ao Teclado e o Ctrl+P pede a senha de novo. Depois de 10 min sem uso, a área fecha sozinha. Fechar no X também fecha a área. | ☐ | ☐ |
| 17.12 | Menu → Sair e abra. Depois, com o app fechado, abra o `admin.json` (em `%APPDATA%\Starsonic Phone`) no Bloco de Notas, sem gravar. | As escolhas da área continuam. O `admin.json` não é texto legível (ele é protegido pelo Windows). | ☐ | ☐ |
| 17.13 | Com o app fechado, apague o `admin.json` e abra. | Os valores de fábrica: os dois botões aparecem, BLF e puxar ligação desligados, código vazio, os servidores do perfil e o canal de teste. | ☐ | ☐ |

## 18. Bipe, bolinha e internet (rc.3)

Compare com os quadros Status e ConfigBipe do canvas. Para o bipe, deixe o headset USB como Alto-falante e o alto-falante do PC como Toque.

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 18.1 | Numa ligação atendida, deixe a outra pessoa desligar. Em outra, desligue você. | Nas duas, dois bipes curtos no headset (o Alto-falante), não no alto-falante do PC. | ☐ | ☐ |
| 18.2 | Recuse uma ligação; deixe uma tocar até perder; ligue para um número que não atende e desista. | Nenhum bipe. | ☐ | ☐ |
| 18.3 | Com duas ligações, desligue uma e continue na outra; depois desligue a outra. | Ao desligar a primeira, nenhum bipe; ao desligar a última, o bipe. | ☐ | ☐ |
| 18.4 | Configurações → Ligações: "Bipe quando a ligação cai ou termina". Desligue e repita o 18.1; Menu → Sair e abra. Ligue de novo. | Numa instalação nova, ela vem ligada. Desligada, nenhum bipe, e continua desligada depois de abrir o app. | ☐ | ☐ |
| 18.5 | Olhe a bolinha no cabeçalho, em Configurações → Contas e no ícone da bandeja: ligue e desligue o Não perturbe; numa ligação, tocando e falando. | Não perturbe ligado: vermelha com "Não perturbe · as ligações não tocam", e o ícone vermelho do Não perturbe na bandeja. Desligado: verde com "Conectado · <servidor>". Na ligação, vermelha com "Ocupado · em ligação" (na barra de título). | ☐ | ☐ |
| 18.6 | Tire o cabo de rede (ou desligue o Wi-Fi). Depois, ponha de volta. | Na hora: cinza com "Sem internet · tentando de novo", o ícone de sem conexão na bandeja e os atalhos com BLF em "Desconectado" (com o Não perturbe ligado, cinza também). De volta: "Conectando…" e verde em poucos segundos, e o BLF volta. | ☐ | ☐ |
| 18.7 | Numa ligação atendida, tire o cabo de rede. Desligue a ligação e ponha o cabo de volta. | A bolinha fica cinza na hora e a ligação fica sem som (o app não percebe sozinho que a outra ponta sumiu, e não refaz nada). Ao desligar, um bipe. De volta, o app conecta sozinho. | ☐ | ☐ |
| 18.8 | Com o roteador ligado, tire a internet dele (o cabo do provedor). Depois, ponha de volta. | A bolinha pode ficar verde até o registro vencer (uns 5 minutos); depois, cinza com "Sem internet · tentando de novo". Anote o tempo: `____`. De volta, "Conectando…" e verde em poucos segundos. | ☐ | ☐ |
| 18.9 | Num cliente com proxy ou firewall, onde o ícone de rede do Windows diz "Sem internet" mas o ramal funciona, abra o app e faça e receba uma ligação. | A bolinha fica verde e as ligações funcionam: o "Sem internet" do Windows, sozinho, não tira o app do ar. Anote o cliente: `____`. | ☐ | ☐ |
| 18.10 | Com o app conectado, troque o DNS do PC para um endereço que não responde (Configurações de rede → Editar DNS → manual, ex.: `10.255.255.1`). Espere 2 minutos, faça e receba uma ligação. Depois, volte o DNS para automático. | A bolinha continua verde e as ligações funcionam: uma falha só do DNS não tira o ramal do ar. | ☐ | ☐ |

## 19. Contatos por planilha e o toque (rc.4)

Antes, monte as duas planilhas de teste no Excel e guarde-as fora do repositório (nada de planilha de cliente aqui):

- **`importar-teste.xlsx`**, para o importar: na linha 1, `Nome`, `Telefone` e `Setor`; um nome com acento (ex.: "Conceição Araújo"); um número com o DDI digitado como número (`551150603000`: o Excel o mostra em notação científica, como `5,5115E+11`); um número só com dígitos e zero na frente digitado como texto (com o apóstrofo: `'01150603000`); uma linha com espaços antes e depois do nome e do número; uma linha em branco no meio; e uma segunda aba com outro contato.
- **`empresa-teste.xlsx`**, a lista da empresa: na linha 1, `Nome`, `Número` e `Observação`; o ramal do **colega** como "Colega Empresa", com "Suporte"; mais dois ou três contatos, com observação; e um igual a um contato seu (o mesmo nome e número de um da seção 9). O colega não pode estar nos seus contatos (19.24).

O link de compartilhamento abre a planilha para quem o tiver: não o cole em mensagens nem no repositório. Para contar um problema, diga só a forma do link (ex.: `https://1drv.ms/x/c/…`). O diagnóstico mostra só o tipo da fonte (`lista da empresa: lendo (OneDrive)`) e as contagens, nunca o link.

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 19.1 | Configurações → Áudio: o headset USB em Microfone e em Alto-falante, e os alto-falantes do PC em Toque. Receba uma ligação com a janela na frente e outra com o app na bandeja; atenda uma, recuse a outra e deixe uma terceira tocar até quem liga desistir. | O toque de telefone novo, o "trrim-trrim" com o silêncio depois, numa volta a cada 3 s, nos alto-falantes do PC e nada no headset. Não é mais o "tuuu" de 425 Hz da rc.3, o do "chamando". Ele para na hora no Atender, no Recusar e quando quem liga desiste. | ☐ | ☐ |
| 19.2 | Troque o Toque para o headset e receba outra ligação; depois, para "Padrão do Windows" e receba mais uma. | O toque novo sai no headset e depois no padrão do Windows. Se sair em outro lugar, anote os nomes das linhas "webview saidas de som:" do `diagnostico.log`. Se em algum momento tocar o "tuuu" de 425 Hz no lugar do toque novo, anote o PC e mande o diagnóstico: a interface não leu o arquivo do toque e fica nos 425 Hz até o app abrir de novo. | ☐ | ☐ |
| 19.3 | Numa ligação pelo headset, receba a segunda (5.1); com ela tocando, o cliente desliga (5.6). | Na segunda, o bipe curto de 425 Hz no headset, como na rc.3, e não o toque novo por cima da conversa. Quando o cliente desliga, a segunda passa a tocar o toque novo, nos alto-falantes do PC (o Toque). | ☐ | ☐ |
| 19.4 | Contatos: clique no "⋯", ao lado do "+", e em "Importar planilha…". Olhe a janela e cancele. Depois, importe o CSV exportado pelo MicroSIP. | O "⋯" (o balão "Mais opções") abre o menu com "Importar planilha…" e "Exportar planilha…". A janela de abrir do Windows aparece na frente do app, com os tipos "Planilhas (*.xlsx, *.csv)" (escolhido) e "Todos os arquivos". Cancelar: nada acontece, sem aviso. Com o CSV: "<n> contatos importados." ("1 contato importado." se for um), e os contatos na lista, em ordem alfabética, com o nome, o número, o comentário do MicroSIP como observação e os acentos certos. | ☐ | ☐ |
| 19.5 | Importe o mesmo CSV de novo. Depois, remova um dos contatos que ele trouxe e importe mais uma vez. | "Nenhum contato novo na planilha.", e nada muda. Depois, "1 contato importado (<m> já existiam)." (com dois contatos no CSV, "(1 já existia)"): só o removido volta, e nenhum fica repetido. | ☐ | ☐ |
| 19.6 | Abra o `importar-teste.xlsx` no Excel e, com ele aberto, importe-o. | Os contatos da primeira aba, sem os da segunda e sem a linha em branco: o nome com o acento certo; o número com o DDI inteiro (`551150603000`, sem o `E+11`); o com zero na frente como foi escrito (`01150603000`); os espaços das pontas tirados; o setor como observação. O arquivo aberto no Excel também é lido. | ☐ | ☐ |
| 19.7 | No Excel, formate a célula do número com DDI como Número, sem casas decimais. Depois, com a primeira aba ativa (clique nela antes: o CSV leva só a aba ativa; se o Excel avisar disso, "OK"), "Salvar como" → "CSV (separado por vírgulas)" e importe esse CSV. | "Nenhum contato novo na planilha.": o CSV do Excel (ponto e vírgula, em Windows-1252) dá os mesmos contatos, com os acentos certos (um acento lido errado viria como um contato novo). **Conhecido:** sem o formato Número, o Excel grava no CSV o número longo como o mostra (`5,5115E+11`), e o contato viria com esse número; o .xlsx guarda o número inteiro. | ☐ | ☐ |
| 19.8 | Importe um arquivo que não é planilha (em "Todos os arquivos", um `.docx` ou uma foto) e uma planilha sem as colunas Nome e Número (ex.: só `Cidade` e `Estado`). | "Não consegui ler a planilha. Ela precisa das colunas Nome e Número." nos dois, e a lista não muda. | ☐ | ☐ |
| 19.9 | "⋯" → "Exportar planilha…". Olhe a janela e salve com o nome e o tipo sugeridos. Abra o arquivo no Excel (duplo clique). | A janela de salvar do Windows, com o nome "Contatos Starsonic" ("Contatos Starsonic.xlsx" se o Windows mostra as extensões) e os tipos "Planilha do Excel (*.xlsx)" (escolhido) e "CSV (*.csv)". Depois, "<n> contatos exportados.". O Excel abre sem pedir reparo: uma aba "Contatos", com Nome, Número e Observação na linha 1 e os seus contatos em ordem alfabética; os números como foram escritos (o `01150603000` com o zero, nada em notação científica) e os acentos certos. As colunas abrem na largura padrão (conhecido: alargue para ler). | ☐ | ☐ |
| 19.10 | Exporte de novo, agora com "CSV (*.csv)" no tipo. Abra o arquivo no Excel (duplo clique) e no Bloco de Notas. | O arquivo sai como `Contatos Starsonic.csv` (confira no Explorer). No Excel, as três colunas separadas e os acentos certos. **Conhecido:** aberto pelo duplo clique, o Excel lê como fórmula o texto que começa com `=`, `+`, `-` ou `@` (um número `+55 …` pode virar fórmula ou erro) e tira o zero da frente de um número só com dígitos (o `01150603000` vira `1150603000`). Por isso o .xlsx é o tipo padrão (spec da rc.4, 4.3). No Bloco de Notas, o texto está inteiro, como no app. | ☐ | ☐ |
| 19.11 | Exporte com "Planilha do Excel (*.xlsx)" escolhido e o nome `teste.csv` digitado; depois, com "CSV (*.csv)" e o nome `teste2.xlsx`. Exporte de novo com um nome que já existe. | O tipo decide o formato, e a extensão segue o tipo: saem `teste.csv.xlsx` (uma planilha do Excel) e `teste2.xlsx.csv` (um CSV). Anote os nomes que saíram: `____`. Com um nome que já existe, o Windows pergunta se pode substituir. Anote se ele não perguntou ao trocar um `teste.csv.xlsx` que já existia (o mesmo export duas vezes): `____`. | ☐ | ☐ |
| 19.12 | Abra o `Contatos Starsonic.xlsx` no Excel e, com ele aberto, exporte por cima dele (o mesmo nome, confirmando a troca). | "Não consegui salvar o arquivo.", e o arquivo continua o de antes. | ☐ | ☐ |
| 19.13 | Configurações: olhe a parte nova "Contatos", depois de "Ligações". | "Planilha da empresa", com o campo e o "Salvar"; embaixo, "Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede."; e "Atualizar agora" apagado (sem link), sem nenhuma situação. Nos Contatos, ainda sem os filtros. | ☐ | ☐ |
| 19.14 | No Google Planilhas, numa planilha nova, importe o `empresa-teste.xlsx` (Arquivo → Importar → "Substituir planilha") e Compartilhar → "Qualquer pessoa com o link" (Leitor). Copie o link (o "Copiar link" do Compartilhar, ou o endereço da barra, com o `#gid=` da aba), cole no campo e "Salvar". | "Lendo a planilha…" e, em poucos segundos, "Atualizada às <hora> · <n> contatos". Nos Contatos: os filtros "Todos" (escolhido), "Meus" e "Empresa"; os da planilha na lista, em ordem com os seus, com a etiqueta "EMPRESA" ao lado do nome e sem o "⋯" (eles mudam só na planilha). O da planilha igual a um seu aparece uma vez só, o seu, sem a etiqueta. | ☐ | ☐ |
| 19.15 | Use os filtros e a busca. Toque no "Colega Empresa" e desligue. Exporte os contatos de novo (19.9). | "Meus": só os seus. "Empresa": a planilha inteira, também o igual a um seu, com a etiqueta. A busca acha os da empresa pelo nome, pela observação e pelo número. O toque liga para o colega, como um contato seu. O arquivo exportado tem só os seus contatos, nenhum da empresa. | ☐ | ☐ |
| 19.16 | No Google, tire o compartilhamento (Compartilhar → "Restrito") e aperte "Atualizar agora" (se ainda ler, espere um minuto e aperte de novo). Depois, volte para "Qualquer pessoa com o link" e "Atualizar agora". | "Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link." e, embaixo, "Última lista: às <hora> · <n> contatos"; os contatos da empresa continuam nos Contatos. Aberta de novo: "Atualizada às <hora> · <n> contatos". | ☐ | ☐ |
| 19.17 | No OneDrive pessoal, suba o `empresa-teste.xlsx` e Compartilhar → "Qualquer pessoa com o link pode ver" → Copiar link (`https://1drv.ms/…`). Cole no campo e "Salvar". Se der, repita com o endereço da barra do arquivo aberto no Excel para a Web (`https://onedrive.live.com/…`). | "Atualizada às <hora> · <n> contatos", com os contatos nos Contatos. É a primeira conferência de verdade do jeito de ler o OneDrive pessoal, o link com `download=1` (a spec da rc.4, "Como ficou"). Se aparecer "Não consegui abrir o link…" ou "Não consegui ler a planilha…" com a planilha aberta para qualquer pessoa, anote a forma do link, sem a chave (ex.: `https://1drv.ms/x/c/…` ou `https://onedrive.live.com/:x:/g/personal/…`), o texto que apareceu e as linhas "lista da empresa:" do diagnóstico (ex.: "o link respondeu HTTP 403"), e mande ao responsável. Até a correção, use o Google ou a pasta da rede. | ☐ | ☐ |
| 19.18 | Num SharePoint ou OneDrive do trabalho, suba o `empresa-teste.xlsx`, compartilhe para "Qualquer pessoa com o link" e copie o link (`https://<empresa>.sharepoint.com/…` ou `https://<empresa>-my.sharepoint.com/…`). Cole e "Salvar". | "Atualizada às <hora> · <n> contatos". Se a empresa não deixar o "Qualquer pessoa" (só as pessoas da empresa), o esperado é "Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link.": entrar com a conta da Microsoft fica para depois, e a pasta da rede é a alternativa. Anote qual dos dois: `____`. | ☐ | ☐ |
| 19.19 | Ponha o `empresa-teste.xlsx` na pasta da rede. No Explorer, Shift + botão direito no arquivo → "Copiar como caminho" (vem entre aspas), cole no campo e "Salvar". Depois, abra a planilha no Excel (neste PC ou em outro), mude um nome, salve no Excel sem fechar e aperte "Atualizar agora". Se o PC tiver a pasta numa letra de unidade (ex.: `Z:`), repita com ela. | "Atualizada às <hora> · <n> contatos": as aspas não atrapalham. Com a planilha aberta no Excel, a leitura funciona (o Excel trava a gravação, não a leitura), e o nome novo aparece nos Contatos. | ☐ | ☐ |
| 19.20 | (Opcional) Publique a planilha do Google na web (Arquivo → Compartilhar → Publicar na Web, a aba, como CSV) e cole esse link; depois, um link do Dropbox ("Copiar link"). | "Atualizada às <hora> · <n> contatos" nos dois. Anote o que falhou: `____`. | ☐ | ☐ |
| 19.21 | Com o link do Google de volta no campo (19.14), mude a planilha (um contato a mais e um número trocado) sem mexer no app e marque o tempo; repita com o app na bandeja. Depois, mude de novo e aperte "Atualizar agora". | A lista nova chega sozinha em até 15 minutos (a hora do "Atualizada às" muda, e os Contatos mostram a mudança), também com o app na bandeja. Anote o tempo: `____`. No "Atualizar agora", na hora. Os 15 minutos contam da última leitura: depois de um "Atualizar agora", a próxima sozinha vem 15 minutos depois dele. | ☐ | ☐ |
| 19.22 | Com a lista do Google, tire o cabo de rede (ou desligue o Wi-Fi) e aperte "Atualizar agora". Feche (Menu → Sair) e abra o app ainda sem internet. Ponha a rede de volta e espere (ou "Atualizar agora"). | Sem internet: "Sem conexão com a planilha. Fica a última lista." com "Última lista: às <hora> · <n> contatos", e os contatos da empresa continuam nos Contatos. Aberto sem internet: a lista guardada aparece na hora, e a situação mostra o mesmo erro. Com a rede de volta, em até 15 minutos (ou no "Atualizar agora"): "Atualizada às <hora> · <n> contatos". | ☐ | ☐ |
| 19.23 | Com o caminho da pasta da rede de volta no campo (19.19), desconecte a pasta (a VPN, o cabo do servidor, ou pare o compartilhamento no outro PC) e feche e abra o app. Depois, conecte a pasta de novo e espere até 15 minutos, sem mexer no app. | Aberto sem a pasta: os contatos da empresa aparecem na hora (a lista guardada); em Configurações, depois de um tempo em "Lendo a planilha…", "Não achei o arquivo. Confira o caminho e se este computador tem acesso à pasta." com "Última lista: …". Com a pasta de volta, a leitura dos 15 minutos traz "Atualizada às …" sozinha. | ☐ | ☐ |
| 19.24 | Com o colega na lista da empresa e fora dos seus contatos, receba uma ligação do colega com a janela na frente e outra com o app na bandeja; deixe uma tocar até perder. Depois, grave o colega nos seus contatos com outro nome (ex.: "Colega Meu"), receba de novo e remova o "Colega Meu". | O nome da planilha, "Colega Empresa": na ligação, no aviso do canto, no "Ligação perdida de Colega Empresa" e no Recentes, onde a linha ainda oferece "Salvar contato" (não é um contato seu). Gravado nos seus, vale o seu nome ("Colega Meu"). Um número que não está em nenhuma das duas listas (o do cliente) mostra o nome que a central manda, ou o número. | ☐ | ☐ |
| 19.25 | Cole `http://intranet/contatos.csv` (sem o "s") e "Salvar". | "Use um link https:// ou o caminho de um arquivo." com a "Última lista: …" embaixo. Nada é lido, e a lista de antes continua nos Contatos. | ☐ | ☐ |
| 19.26 | No notebook de 150% (3.4), passe pelos três tamanhos da janela (3.14) com os Contatos com a lista da empresa e o menu "⋯" aberto, e com Configurações → Contatos no erro do 19.25. | Nada cortado, nada por cima e nada rolando para o lado: a etiqueta "EMPRESA" inteira (o nome encolhe com reticências); o "+" e o "⋯" lado a lado; o menu dentro da janela; o campo e o "Salvar" na mesma linha; a ajuda, o erro e a "Última lista" quebram dentro do cartão; e o "Atualizar agora" inteiro. | ☐ | ☐ |
| 19.27 | Apague o campo e "Salvar". Feche (Menu → Sair) e abra o app. | A lista da empresa sai dos Contatos, os filtros somem, a situação fica vazia e "Atualizar agora" fica apagado. Aberto de novo, nada da empresa; uma recebida do colega volta a mostrar o nome que a central manda (ou o número). | ☐ | ☐ |
| 19.28 | Abra a janela de importar (ou a de exportar) e, com ela aberta, use o "Sair" do menu da bandeja. Abra o app logo depois. | A janela de arquivo fecha junto, nada é importado, e o app fecha em poucos segundos (12.4); ele abre de novo na primeira tentativa. No log, nada de "fechamento forcado". | ☐ | ☐ |
| 19.29 | Com a janela de importar aberta, saia da conta do Windows (Iniciar → a sua conta → Sair) e entre de novo. | O Windows não fica esperando o app para sair (10.9). Na volta, com "Iniciar com o Windows" ligado, o app abre na bandeja, e nada foi importado. | ☐ | ☐ |
| 19.30 | Cole o caminho de um servidor que não responde (ex.: `\\10.255.255.1\contatos\empresa.xlsx`) e "Salvar". Com "Lendo a planilha…" na tela, Menu → Sair. Abra o app de novo e espere. No fim, apague o campo e "Salvar". | O Sair não espera a pasta: o app fecha em poucos segundos e abre de novo na primeira tentativa (no log, nada de "fechamento forcado"). Aberto, "Lendo a planilha…" e, depois de um tempo, "Não achei o arquivo. Confira o caminho e se este computador tem acesso à pasta.". Anote quanto tempo o "Lendo a planilha…" ficou: `____`. | ☐ | ☐ |
| 19.31 | No Outlook clássico, mande para você mesmo um e-mail com o link do Google do 19.14 numa linha e o caminho da pasta da rede do 19.19 em outra, cada um com um espaço depois. No e-mail recebido, selecione a linha do link com um clique triplo (o espaço do fim vai junto), copie, cole no campo e "Salvar"; depois, o mesmo com o caminho. Sem o Outlook clássico, faça o mesmo num documento do Word. | "Atualizada às <hora> · <n> contatos" nos dois, como no 19.14 e no 19.19, e nunca "Não consegui abrir o link…" ou "Não achei o arquivo…": o Outlook clássico e o Word põem um espaço que não quebra (invisível) no texto copiado, e o app o tira das pontas. O "Atualizar agora" também lê. | ☐ | ☐ |
| 19.32 | Abra a janela de importar e deixe-a aberta. Peça ao cliente para ligar, atenda pelo "Atender" do aviso do canto, fale e peça ao cliente para desligar; depois, cancele a janela. Repita com a janela de exportar. | Com a janela de arquivo aberta, o aviso do canto aparece com a recebida, e o "Atender" dele atende: a conversa sai no headset. Depois, o Cancelar da janela não importa nem grava nada, sem aviso. | ☐ | ☐ |
| 19.33 | No Teams, nos Arquivos de um canal (ou de um chat), suba o `empresa-teste.xlsx` e use o "⋯" dele → "Copiar link" (se o Teams deixar escolher, "Qualquer pessoa com o link"). O link vem como `https://<empresa>.sharepoint.com/:x:/r/…?…&web=1…`. Cole no campo e "Salvar". | Anote se leu ("Atualizada às <hora> · <n> contatos") ou o texto que apareceu, com a forma do link, sem a chave: `____`. Se não leu, o link do "Compartilhar" do SharePoint (19.18) é a alternativa. | ☐ | ☐ |
| 19.34 | No Google Drive, suba o `empresa-teste.xlsx` sem converter (em Configurações do Drive, "Converter uploads" desligado) e abra-o: no Planilhas, ele fica como .xlsx, com a etiqueta "XLSX" ao lado do nome. Compartilhe para "Qualquer pessoa com o link" (Leitor) e copie o link (vem com `rtpof=true`: `https://docs.google.com/spreadsheets/d/<id>/edit?usp=sharing&ouid=…&rtpof=true&sd=true`). Cole no campo e "Salvar". No fim, apague o campo e "Salvar". | Anote se leu ("Atualizada às <hora> · <n> contatos") ou o texto que apareceu: `____`. Se não leu, salve uma cópia como planilha do Google (Arquivo → "Salvar como Planilhas Google") e use o link da cópia (19.14). | ☐ | ☐ |

## Onde cada critério de sucesso é verificado

| Critério (spec da W1, §3) | Automático (a cada build) | Neste roteiro |
|---------------------------|---------------------------|---------------|
| Num Windows 10 e num Windows 11 limpos, instalar pelo link, entrar com servidor, protocolo, ramal e senha, e fazer e receber ligações nos dois servidores | `Test-Installer.ps1` (silencioso e pela tela, os links, a desinstalação); a fumaça do app instalado (`windows_smoke.py` pelo CDP: entra no registrador falso, liga, recebe e atende pelo aviso); os testes do núcleo (a porta por servidor, as mensagens da tela Entrar) e do `desktop_tests` (o Entrar) | 1, 2 |
| A segunda ligação, alternar, transferir com consulta, conferência, separar, e a outra volta sozinha | `call_controller_tests` (os casos do `CallManagerTest.kt` da 0.2 portados), `phone_tests` (o motor contra o registrador falso), o Playwright (`call.spec.ts`) | 5 |
| Com o app minimizado ou na bandeja, a recebida aparece no aviso e toca no dispositivo escolhido | a fumaça (o aviso com a janela minimizada, sem roubar o primeiro plano, e o Atender dele); o Playwright do toque (o ritmo e o `setSinkId`); o `desktop_tests` (a bandeja e o aviso) | 6, 7 |
| Não perturbe, Atender automático e a troca entre duas contas | `call_controller_tests` (Não perturbe, Atender automático, troca de conta), `desktop_tests` (a troca, a troca pendente, a conta sem senha com Cancelar), o Playwright | 8 |
| A rc.7 com duas contas e contatos atualiza e abre "Conectado" na conta em uso, com as contas, os contatos e os recentes | `desktop_tests` (a migração do `.ini` UTF-16LE, do `Contacts.xml` e do `call_log.db`; a senha cifrada pelo `CCrypto` original, no Windows); o ensaio pelo `workflow_dispatch` (`ensaio-atualizacao`: a rc.7 de verdade com uma conta e um contato, o instalador novo em silêncio, "Conectado" e os `.migrado` do `.ini` e do `Contacts.xml`) | 13 |
| As telas seguem o canvas, no tema claro e no escuro, e nenhum "MicroSIP" | o Playwright (cada tela nos dois temas, as capturas e o axe); `check_branding.py` (o exe, a pasta `ui\` e o instalador aberto por dentro) | 3, 9, 11 |
| rc.3: os atalhos com BLF e puxar ligação, a área do administrador, o bipe, a bolinha e a internet (spec da rc.3) | `desktop_tests` (as lojas, a senha e a espera, os comandos da ponte, o puxar, o bipe, a decisão da internet), `phone_tests` (o BLF contra o registrador falso), o Playwright (`atalhos.spec.ts`, `admin.spec.ts`, a bolinha nos estados), a fumaça (o BLF Livre → Ocupado → Livre, o Ctrl+P, a internet desligada e de volta, o servidor por nome) | 16, 17, 18 |
| rc.4: a recebida com o toque do MicroSIP, o importar e o exportar dos contatos e a lista da empresa (spec da rc.4) | `desktop_tests` (a leitura das planilhas, CSV, .xlsx e o CSV do MicroSIP, com os limites; a escrita e a ida e volta; a conversão dos links e o `FromHttp`; a loja da lista; o importar, o exportar, a lista da empresa e os nomes no `DesktopApp`; os comandos e o estado da ponte), o Playwright (`ring.spec.ts`: o toque em loop no dispositivo de Toque e os 425 Hz sem o arquivo; `contatos.spec.ts` e `contatos-lista-grande.spec.ts`; as capturas, o axe e os avisos das licenças em `screens.spec.ts`), a fumaça (a lista da empresa de um caminho, também com o arquivo aberto como no Excel, os erros do caminho, o nome dela na recebida, as duas janelas de arquivo e o `--sair` com uma delas aberta) | 19, 14.7 |
| Tudo passa nos testes automáticos e neste roteiro | os workflows `build` e `android` | todo o roteiro |
