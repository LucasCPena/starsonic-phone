# Teste manual do Starsonic Phone (Windows)

Faça este roteiro antes de cada versão estável (spec §11.3), com a versão candidata (`vX.Y.Z-rc.N`). Use um PC com **Windows 10** e outro com **Windows 11**, e um ramal de teste em cada servidor do perfil. Ramais e senhas de teste ficam fora do repositório.

Marque cada linha nas colunas W10 e W11. Se algo não sair como o esperado, anote a versão, o passo e o que apareceu (de preferência com print).

Versão testada: `__________`  Data: `__________`  Quem testou: `__________`

## 1. Instalação pelo navegador

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 1.1 | No Edge ou no Chrome, baixe `StarsonicPhone-<versão>-setup.exe` da página do release no GitHub e abra. | O Windows avisa que o editor é desconhecido (o instalador ainda não é assinado). Em "Mais informações", aparece "Executar assim mesmo". | ☐ | ☐ |
| 1.2 | Siga o instalador. | Tudo em português, **sem pedir senha de administrador**. A tela de componentes traz "Atalho na área de trabalho" e "Iniciar com o Windows", os dois marcados. A tela final tem "Abrir o Starsonic Phone". | ☐ | ☐ |
| 1.3 | Termine com "Abrir o Starsonic Phone" marcado. | O app abre na tela Entrar. Há atalho no menu Iniciar e na área de trabalho. | ☐ | ☐ |
| 1.4 | Abra Configurações do Windows → Aplicativos instalados. | "Starsonic Phone", editor "Starsonic", com a versão testada. | ☐ | ☐ |

## 2. Entrar

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 2.1 | Olhe a tela Entrar. | Logo, lista de servidores do perfil, Ramal, Senha e "Precisa de ajuda? (11) 5060-3000". Nenhum campo técnico (porta, proxy, transporte etc.). | ☐ | ☐ |
| 2.2 | Digite o ramal com `@`, `:` ou espaço no meio (ex.: `20 01`). | "Digite só o número do ramal." | ☐ | ☐ |
| 2.3 | Ramal certo com a senha errada. | "Ramal ou senha incorretos." e a tela continua aberta. | ☐ | ☐ |
| 2.4 | Ramal de um servidor escolhendo outro servidor da lista. | Uma mensagem de erro da tabela 11.1 da spec (em geral "Ramal ou senha incorretos." ou "Ramal não encontrado neste servidor."). Nada de código técnico além do "(código n)" previsto. | ☐ | ☐ |
| 2.5 | Com o Wi-Fi/cabo desligado, tente entrar. | "Não foi possível falar com o servidor. Verifique sua internet." | ☐ | ☐ |
| 2.6 | Internet de volta, ramal e senha certos. | A tela fecha. A faixa no topo mostra "Conectado" e "<ramal> · <servidor>". | ☐ | ☐ |

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
| 4.1 | Menu → Contas → Adicionar Conta… e entre com um ramal de outro servidor. | Abre a tela Entrar; a conta nova fica ativa depois de conectar. | ☐ | ☐ |
| 4.2 | Troque a conta ativa pelo menu. | A faixa mostra o ramal e o servidor da conta escolhida, "Conectado". | ☐ | ☐ |
| 4.3 | Edite uma conta e use "Remover conta" até não sobrar nenhuma. | Depois da última, volta a tela Entrar. | ☐ | ☐ |
| 4.4 | Com o app fechado, edite `%APPDATA%\Starsonic Phone\StarsonicPhone.ini` e troque o `server` ou o `transport` de uma conta; abra o app. | O app desfaz a mudança (volta ao que o perfil manda) ou, se o servidor da conta não existir mais, pede para entrar de novo: "O servidor desta conta mudou. Entre novamente." | ☐ | ☐ |

## 5. Marca, Configurações e suporte

| # | Passo | Resultado esperado | W10 | W11 |
|---|-------|--------------------|-----|-----|
| 5.1 | Passe por todas as janelas e menus (incluindo bandeja do relógio e mensagens). | "MicroSIP" não aparece em lugar nenhum, a não ser na tela Sobre e nas propriedades do arquivo (copyright). | ☐ | ☐ |
| 5.2 | Menu → Sobre o Starsonic Phone. | "Starsonic Phone <versão> (baseado no MicroSIP 3.22.16)", links do site e do WhatsApp, o telefone de suporte e a linha da licença GPL v3 com o link do código-fonte. | ☐ | ☐ |
| 5.3 | Menu → Configurações. | Não aparecem codecs, portas, rport, STUN, DTMF nem a frequência de verificação de atualizações, e não sobram buracos na tela. | ☐ | ☐ |
| 5.4 | No PABX (ou com o fornecedor), confira o User-Agent do registro. | `Starsonic Phone/<versão>`, e o servidor aceita o registro. | ☐ | ☐ |

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
| Instalar, escolher o servidor, digitar ramal e senha e ligar sem ver campo técnico | `Test-Installer.ps1`, `Test-Login.ps1` (registrador SIP falso), `Test-Settings.ps1` | 1, 2, 3 |
| "MicroSIP" só na atribuição da tela Sobre e nos avisos de copyright e licença | `check_branding.py` (recursos, tradução, instalador, código novo e o próprio exe), `Test-BrandUi.ps1` | 5.1, 5.2 |
| Configurações de conta e rede travadas, pela interface e pelo arquivo | testes do núcleo (`AccountPolicy`), `Test-Policy.ps1` (INI adulterado), `Test-Settings.ps1` | 4.4, 5.3 |
| Versão nova chega como aviso e instala com um clique, sem senha de administrador | testes do núcleo (`UpdateManifest`), SHA-256 no Windows, `Test-Installer.ps1` (atualização silenciosa reabre o app) | 7 |
| Suporte identifica app e versão pela tela Sobre e pelo User-Agent | `Test-BrandUi.ps1` (versão), `Test-Login.ps1` (User-Agent recebido pelo servidor) | 5.2, 5.4 |
| Código-fonte completo junto do instalador | workflow `release` (instalador, `versao.json` e código-fonte completo em cada release) | 7.2 |
