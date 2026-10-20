# Teste manual do Starsonic Phone (Windows)

Faça este roteiro antes de cada versão estável (spec §11.3), com a versão candidata (`vX.Y.Z-rc.N`). Use um PC com **Windows 10** e outro com **Windows 11**, e um ramal de teste em cada servidor da Starsonic (`starcloud-starsonic.com.br` e `starcloud1-starsonic.com.br`). Ramais e senhas de teste ficam fora do repositório.

Marque cada linha nas colunas W10 e W11. Se algo não sair como o esperado, anote a versão, o passo e o que apareceu (de preferência com print).

Versão testada: `__________`  Data: `__________`  Quem testou: `__________`

## 1. Instalação pelo navegador

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 1.1 | No Edge ou no Chrome, baixe `StarsonicPhone-<versão>-setup.exe` da página do release no GitHub e abra. | O Windows avisa que o editor é desconhecido (o instalador ainda não é assinado). Em "Mais informações", aparece "Executar assim mesmo". | ☐ | ☐ |
| 1.2 | Siga o instalador. | Tudo em português, **sem pedir senha de administrador**. As telas de boas-vindas e final têm a faixa azul com o logo da Starsonic. A tela de componentes traz "Atalho na área de trabalho" e "Iniciar com o Windows", os dois marcados. A tela final tem "Abrir o Starsonic Phone". | ☐ | ☐ |
| 1.3 | Termine com "Abrir o Starsonic Phone" marcado. | O app abre na tela Entrar. Há atalho no menu Iniciar e na área de trabalho. | ☐ | ☐ |
| 1.4 | Abra Configurações do Windows → Aplicativos instalados. | "Starsonic Phone", editor "Starsonic", com a versão testada. | ☐ | ☐ |

## 2. Entrar

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 2.1 | Olhe a tela Entrar. | Logo, campo "Servidor (endereço ou IP)" vazio com o "Protocolo" ao lado (UDP marcado), Ramal, Senha, "Nome da conta (opcional)" e "Precisa de ajuda? (11) 5060-3000". Nenhum outro campo técnico (porta, proxy, codecs etc.). | ☐ | ☐ |
| 2.2 | Clique em Entrar com o campo Servidor vazio; depois digite o endereço com a porta (ex.: `starcloud1-starsonic.com.br:5060`). | Primeiro "Digite o endereço do servidor."; com a porta, "Digite só o endereço do servidor, como starcloud1-starsonic.com.br." | ☐ | ☐ |
| 2.3 | Digite o ramal com `@`, `:` ou espaço no meio (ex.: `20 01`). | "Digite só o número do ramal." | ☐ | ☐ |
| 2.4 | Ramal certo com a senha errada. | "Ramal ou senha incorretos." e a tela continua aberta. | ☐ | ☐ |
| 2.5 | Ramal de um servidor com o endereço do outro servidor. | Uma mensagem de erro da tabela 11.1 da spec (em geral "Ramal ou senha incorretos." ou "Ramal não encontrado neste servidor."). Nada de código técnico além do "(código n)" previsto. | ☐ | ☐ |
| 2.6 | Endereço que não existe (ex.: `starcloud9-starsonic.com.br`). | "Não foi possível falar com o servidor. Confira o endereço e a sua internet." | ☐ | ☐ |
| 2.7 | Com o Wi-Fi/cabo desligado, tente entrar. | "Não foi possível falar com o servidor. Confira o endereço e a sua internet." | ☐ | ☐ |
| 2.8 | Internet de volta: endereço certo, mas com espaços nas pontas e letras maiúsculas (ex.: ` Starcloud1-Starsonic.com.br `), ramal e senha certos. | A tela fecha. A faixa no topo mostra "Conectado" e "<ramal> · <endereço>", com o endereço em minúsculas e sem os espaços. | ☐ | ☐ |
| 2.8b | Entre com um ramal do `starcloud1-starsonic.com.br` e, depois (Menu → Adicionar conta ou num PC limpo), com um do `starcloud-starsonic.com.br`, digitando só o endereço, em UDP e em TCP. | As duas contas ficam "Conectado" nos dois protocolos. No `%APPDATA%\Starsonic Phone\StarsonicPhone.ini`, o `server` do starcloud1 termina em `:35060` e o do starcloud em `:5060` (perfil, seção `[portas]`). | ☐ | ☐ |
| 2.9 | Num cliente que usa TCP, escolha "TCP" no Protocolo e entre com um ramal desse cliente. Depois, Menu → Editar Conta. | A tela fecha e a faixa mostra "Conectado". No Editar, o Protocolo aparece como TCP. | ☐ | ☐ |

## 3. Chamadas

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 3.1 | Ligue para outro ramal e para um número externo. | Chama, completa e o áudio passa nos dois sentidos. O botão Ligar está na cor da marca. | ☐ | ☐ |
| 3.2 | Receba uma chamada. | Toca e atende normalmente. | ☐ | ☐ |
| 3.3 | Coloque em espera e retome. | O outro lado ouve a espera; o áudio volta ao retomar. | ☐ | ☐ |
| 3.4 | Transfira uma chamada para outro ramal. | A chamada chega no outro ramal. | ☐ | ☐ |
| 3.5 | Ligue para uma URA e use o teclado (DTMF). | A URA reconhece as teclas. | ☐ | ☐ |

## 4. Contas

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 4.1 | Menu → Contas → Adicionar Conta… e entre com um ramal do outro servidor, digitando o endereço dele. | Abre a tela Entrar com o campo Servidor vazio; a conta nova fica ativa depois de conectar. | ☐ | ☐ |
| 4.2 | Troque a conta ativa pelo menu. | A faixa mostra o ramal e o endereço da conta escolhida, "Conectado". | ☐ | ☐ |
| 4.3 | Edite uma conta (Menu → Editar Conta) e use "Remover conta" até não sobrar nenhuma. | A tela Entrar abre com o endereço e o ramal da conta; depois da última remoção, volta a tela Entrar vazia. | ☐ | ☐ |
| 4.4 | Com duas contas, a primeira ativa, feche o app (Menu → Sair) e edite `%APPDATA%\Starsonic Phone\StarsonicPhone.ini`: na primeira conta, troque o `transport` para `tls` e a porta do `server` para `5999` (ex.: `server=starcloud1-starsonic.com.br:5999`); na segunda, ponha um espaço no meio do endereço do `server`. Abra o app. | A primeira conta conecta de novo pela porta do servidor (35060 no starcloud1, 5060 no starcloud) e por UDP, com o mesmo endereço. A segunda fica vazia e some do menu de contas. | ☐ | ☐ |
| 4.5 | Feche o app, ponha um espaço no meio do endereço do `server` da conta ativa e abra o app. | O app abre a tela Entrar, sem mensagem. | ☐ | ☐ |
| 4.6 | Dê nome a duas contas em Editar Conta (ex.: `PA 1 - Recepção` e `PA 2 - Vendas`) e troque a conta ativa pelo menu. Ligue de uma delas para outro ramal. | Os nomes aparecem no menu de contas e na faixa ("Conectado · PA 1 - Recepção"). Quem recebe a ligação continua vendo o ramal, não o nome. Uma conta sem nome continua como "<ramal> · <endereço>". | ☐ | ☐ |

## 5. Marca, Configurações e suporte

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 5.1 | Passe por todas as janelas e menus (incluindo bandeja do relógio e mensagens). | "MicroSIP" não aparece em lugar nenhum, a não ser na tela Sobre e nas propriedades do arquivo (copyright). | ☐ | ☐ |
| 5.2 | Menu → Sobre o Starsonic Phone. | "Starsonic Phone <versão> (baseado no MicroSIP 3.22.16)", links do site e do WhatsApp, o telefone de suporte e a linha da licença GPL v3 com o link do código-fonte. | ☐ | ☐ |
| 5.3 | Menu → Configurações. | Não aparecem codecs, portas, rport, STUN, DTMF nem a frequência de verificação de atualizações, e não sobram buracos na tela. | ☐ | ☐ |
| 5.4 | No PABX (ou com o fornecedor), confira o User-Agent do registro. | `Starsonic Phone/<versão>`, e o servidor aceita o registro. | ☐ | ☐ |
| 5.5 | Olhe o ícone na barra de tarefas, no menu Iniciar e na área do relógio. Depois desligue a internet; com ela de volta, deixe uma chamada tocar sem atender. | Círculo azul com um fone branco e um anel ciano. Na área do relógio, o ícone fica cinza sem conexão e ganha um selo vermelho depois da chamada perdida. | ☐ | ☐ |
| 5.6 | Olhe a faixa do topo e as telas Entrar e Sobre, com o Windows no modo claro e no escuro (Configurações → Personalização → Cores → modo do aplicativo). | Faixa azul com "starsonic" em branco e ciano, sem bordas serrilhadas. Nas telas Entrar e Sobre, o logo completo num cartão branco, legível nos dois modos. | ☐ | ☐ |

## 6. Convivência com o MicroSIP

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 6.1 | Instale o MicroSIP oficial no mesmo PC e abra os dois. | Os dois abrem ao mesmo tempo, cada um com as próprias configurações; fechar um não fecha o outro. | ☐ | ☐ |
| 6.2 | Conecte uma conta em cada um e faça uma chamada pelo Starsonic Phone. | Os dois continuam conectados e a chamada funciona. | ☐ | ☐ |

## 7. Atualização pelo canal de teste

Use duas versões candidatas seguidas, por exemplo `v0.0.1-rc.1` e `v0.0.1-rc.2` (ou `vX.Y.Z-rc.N` e `rc.N+1`). As rc procuram atualização no pre-release fixo `canal-teste`, que o workflow `release` sobrescreve a cada rc.

O app procura atualização quando abre (e a cada 24 h aberto). O X da janela só esconde o app na bandeja: para fechar e abrir de novo, use **Menu → Sair** e depois o atalho.

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 7.1 | Instale a rc anterior e entre com um ramal. | Sobre mostra a rc anterior. | ☐ | ☐ |
| 7.2 | Publique a rc seguinte (tag `v…-rc.N+1` ou Actions → release → Run workflow). Espere o workflow terminar. | O release da rc nova e o `canal-teste` têm o instalador e o `versao.json` novos. | ☐ | ☐ |
| 7.3 | Menu → Sair e abra o app. Com o aviso aberto (sem responder), receba uma chamada de outro telefone e atenda; com ela em andamento, responda "Sim". | Aviso "Nova versão do Starsonic Phone disponível (<rc nova>). Atualizar agora?" com as notas. Com a chamada em andamento: "Termine a chamada para atualizar." e nada muda. | ☐ | ☐ |
| 7.4 | Encerre a chamada, Menu → Sair, abra o app de novo e responda "Sim". | "Baixando atualização…" na barra de status; o app fecha, atualiza sem perguntar nada e abre sozinho. Sobre mostra a rc nova; a conta, as configurações e os atalhos continuam como estavam, e o app **conecta sem pedir a senha de novo**. | ☐ | ☐ |
| 7.5 | Sem internet, Menu → Sair e abra o app. | Nenhum aviso de atualização nem de erro. | ☐ | ☐ |

## 8. Desinstalação

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 8.1 | Com o app aberto, desinstale por Configurações do Windows → Aplicativos instalados. | Sem senha de administrador; o app fecha; somem os atalhos, a pasta `%LOCALAPPDATA%\Starsonic Phone` e o item da lista de aplicativos. | ☐ | ☐ |
| 8.2 | Confira `%APPDATA%\Starsonic Phone`. | Continua lá (configurações e contatos ficam, como no MicroSIP). | ☐ | ☐ |

## Onde cada critério de sucesso é verificado

| Critério (spec §3) | Automático (a cada build) | Neste roteiro |
|--------------------|---------------------------|---------------|
| Instalar, digitar o servidor, o ramal e a senha e ligar sem mexer em outro campo técnico (o Protocolo já vem marcado) | `Test-Installer.ps1`, `Test-Login.ps1` (registrador SIP falso), `Test-Settings.ps1` | 1, 2, 3 |
| "MicroSIP" só na atribuição da tela Sobre e nos avisos de copyright e licença | `check_branding.py` (recursos, tradução, instalador, código novo e o próprio exe), `Test-BrandUi.ps1` | 5.1, 5.2 |
| Configurações de conta e rede travadas (menos o endereço do servidor, o protocolo e o nome da conta), pela interface e pelo arquivo | testes do núcleo (`AccountPolicy`), `Test-Policy.ps1` (INI adulterado), `Test-Settings.ps1` | 4.4, 4.5, 5.3 |
| Versão nova chega como aviso e instala com um clique, sem senha de administrador | testes do núcleo (`UpdateManifest`), SHA-256 no Windows, `Test-Installer.ps1` (atualização silenciosa reabre o app) | 7 |
| Suporte identifica app e versão pela tela Sobre e pelo User-Agent | `Test-BrandUi.ps1` (versão), `Test-Login.ps1` (User-Agent recebido pelo servidor) | 5.2, 5.4 |
| Código-fonte completo junto do instalador | workflow `release` (instalador, `versao.json` e código-fonte completo em cada release) | 7.2 |
