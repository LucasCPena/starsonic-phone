# As reuniões no app do PC, etapa 2a — entrega 2, plano 1: a prova no WebView2 de verdade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** provar, no Windows do GitHub e com o WebView2 de verdade, que a página da reunião funciona dentro de um `iframe` da janela principal do app instalado (ela carrega de um endereço privado; a câmera, o microfone, a captura de tela e a escolha do alto-falante funcionam; mais nada ganha acesso), ou parar com os fatos na mão.

**Architecture:**
- **O executável** ganha três regras fechadas, escritas em C++ portátil e testadas fora do Windows: qual endereço um `iframe` pode abrir, qual quadro pode pedir a câmera e o microfone, e qual quadro pode capturar a tela. O WebView2 da janela principal as obedece. A janela do aviso continua sem nenhuma delas.
- **A fumaça do Windows** ganha um servidor do chat de verdade na máquina do teste: o programa do chat em modo de teste, atrás de uma frente TLS pequena, alcançado pelo nome de sempre do chat, que a máquina do teste leva ao endereço privado dela. O app não ganha gancho de teste nenhum.
- **A interface do app não muda** (só a regra de segurança da página dela, que passa a deixar o quadro do chat). Quem põe o `iframe` na página do app é a fumaça, como o app de mentira dos testes de ponta a ponta da página já faz. A aba Reuniões e a vista da reunião são do plano seguinte.

**Tech Stack:** C++17 com o doctest (o `tests/desktop`), o SDK do WebView2 `1.0.4258.31` (o do `build/deps.lock`), Python 3.12 com o Playwright para Python `1.56.0` (a fumaça de hoje) e o `cryptography` `50.0.2` (novo, só nos testes), o programa do chat em Go compilado também para o Windows, e o workflow `build` do GitHub.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`: as seções 7.4 e 7.7 (as regras), 10 (o que o executável passa a deixar, e o diagnóstico), 12.2 (o último item: a fumaça do Windows), 13 (a prova vem antes) e 14 (os riscos 1, 9, 10 e 11).

**O método:** um agente novo constrói cada tarefa, e outro a revisa antes da próxima; no fim, uma revisão de tudo (superpowers:subagent-driven-development). O responsável aprovou este método em 23/11/2026, às 11:32, para a entrega 1; este plano espera a conferência dele.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-2`, que já existe no GitHub. Cada tarefa dá commit, por caminho. Quem dá push é o coordenador.
- **Os commits** são em português, com o assunto de até 72 caracteres, e terminam com a linha `Co-Authored-By:` do modelo que escreveu e com a linha `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- **O código do Windows só compila no GitHub.** A máquina de desenvolvimento é Linux: nela rodam os testes portáteis do C++, os testes em Python e os testes da interface. O `windows/app/src/WebViewHost.cpp` e a fumaça do Windows só rodam no workflow `build` (o job "Windows (Win32, Release)", uns 25 minutos). Quem escreve código do Windows diz no relatório "não compilado no Windows", e nunca afirma um resultado do Windows que não viu: o coordenador dá o push e lê a rodada.
- **As regras do executável** (a spec, 7.7 e 10), letra por letra:
  - a câmera e o microfone passam a valer "só na janela principal e só para a origem do chat";
  - a captura de tela: o executável "só deixa a captura pedida pela página da reunião, na janela principal. Em qualquer outro caso, cancela";
  - a navegação: uma exceção só, "num `iframe` da janela principal, o endereço do chat seguido de `/r/` e de um código de 10 caracteres do alfabeto dos códigos, sem mais nada. A navegação da janela e as janelas novas continuam bloqueadas";
  - o alfabeto dos códigos é `abcdefghjkmnpqrstvwxyz23456789`;
  - a janela do aviso não muda.
- **O endereço do chat** é o de hoje, num lugar só de cada lado: o `kChatOrigin` do `windows/app/src/ChatFiles.h` e o `ENDERECO_DO_CHAT` do `windows/ui/src/chat/endereco.ts` (`https://chat.starcloud-starsonic.com.br:8443`). Nenhuma variável de ambiente nova lida pelo app, nenhum gancho de teste novo: o `build/check_test_hooks.py` passa como hoje.
- **O diagnóstico** (`diagnostico.log`) nunca leva o código de uma reunião, um passe, uma chave, um nome nem um assunto. Um endereço vai só com o esquema e o servidor (o `RedactUrl` do `starsonic/desktop/LogRedaction.h`). As linhas são em ASCII, sem acento, como as de hoje (o `build/check_source_text.py` confere).
- **Os testes nunca falam com o servidor do chat de verdade.** A fumaça confere que o nome do chat leva à frente TLS dela antes de abrir o app, e reprova se não levar.
- **O que a fumaça muda na máquina do teste volta ao que era,** também quando ela falha: o arquivo `hosts` e o certificado posto na lista de autoridades do Windows. A chave do certificado nasce na máquina do teste, na memória e numa pasta temporária, e nunca sai dela.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados de sempre (Ana Souza, `exemplo.com.br`, "Empresa Fumaça").
- **O que não muda:** o `chat-servidor/` (nem a página da reunião), o `video-servidor/`, o `android/`, o núcleo (`starsonic/`), o instalador e os workflows que não são o `build.yml`. Ninguém roda workflow de versão.

## Review Focus

O que a spec pede e os testes das tarefas poderiam deixar passar, do mais provável ao menos. Cada linha tem o teste que a prende, na tarefa dona do código:

1. **Um endereço parecido com o de uma reunião ganha o quadro, a câmera ou a tela:** o chat com outra coisa depois da porta (`…:8443.outro.com`, `…:84430`), o código com 9 ou 11 caracteres, em maiúsculas ou com uma letra fora do alfabeto, com `/`, `?` ou `#` depois, e outro caminho do chat (a administração, a API). *(Task 1: os cinco testes do `test_web_permissions.cpp`. Task 4: os quadros recusados da fumaça.)*
2. **A janela do aviso, ou a própria página do app, ganha a câmera ou a tela.** *(Task 1: os casos com o `WebWindow::Notice` e "the app origin never gets the camera". Task 4: a câmera e a tela pedidas pela página do app são recusadas, com a linha no diagnóstico.)*
3. **O código, o passe ou o nome de alguém vai ao `diagnostico.log`.** *(Task 4: `leaks`, com o código, o passe, a chave, o nome da pessoa, o da empresa e o assunto. Task 2: toda linha nova usa o `RedactUrl`, e a linha `permissao negada`, que hoje leva até 160 caracteres do endereço, passa a usá-lo.)*
4. **A prova passa pelo motivo errado:** o quadro falou com o servidor de verdade; a câmera foi liberada pelo argumento de teste do navegador, e não pela regra do app; o chat ficou no `127.0.0.1` e foi contado como privado. *(Task 4: a conferência do nome antes de abrir o app; a abertura da câmera vai sem o `--use-fake-ui-for-media-stream`; o `endereco` do resultado tem de ser `privado`; as linhas `permissao permitida (quadro)` têm de estar no diagnóstico.)*
5. **O teste deixa rastro, ou muda o app que vai para as pessoas:** o certificado fica na lista do Windows, o `hosts` fica mudado, ou o app ganha um gancho. *(Task 4: "o que mudou volta" no `finally`, conferido no fim do item. Task 2: nenhum `STARSONIC_` novo; o passo "Sem os ganchos de teste no app novo" do workflow continua verde.)*

## A máquina de desenvolvimento

- O `go` pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. O Playwright do Node pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`; o Playwright para Python daqui é o `1.63.0` e pede `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Nunca rode `playwright install`.
- Ela tem 2 processadores. O que é pesado (uma compilação inteira do `tests/desktop`, o Playwright) entra na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- **As variáveis de proxy do ambiente atrapalham um navegador que fala `https` com um nome:** o teste que abre um navegador o abre com um ambiente sem nenhuma variável cujo nome tenha `proxy` (em maiúsculas ou minúsculas).
- **Os comandos das provas:**

  | A prova | O comando | Hoje |
  |---|---|---|
  | O C++ portátil | `cmake -S tests/desktop -B work/build-desktop -DCMAKE_BUILD_TYPE=Release && cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests` | 485 casos; uns 2 minutos e meio da primeira vez |
  | Um caso só do C++ | `work/build-desktop/desktop_tests -tc="*meeting*"` | — |
  | Os textos do código | `python3 build/check_source_text.py` | `ok` |
  | O programa do chat daqui | `cd chat-servidor && CGO_ENABLED=0 go build -trimpath -o ../work/starsonic-chat ./cmd/starsonic-chat` | — |
  | Os testes da fumaça | `STARSONIC_CHAT_BIN=$PWD/work/starsonic-chat PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -m unittest -v tests/smoke/test_reuniao_local.py tests/smoke/test_reuniao_fumaca.py` | arquivos novos |
  | Os scripts | `env -u GITHUB_ACTIONS python3 -m unittest discover -s tests/python` | passam |
  | A interface | `cd windows/ui && npm run build && npx playwright test tests/chat/lista.spec.ts -g "CSP"`, com as duas variáveis de cima (o teste sobe o chat com o `go`) | 1 teste |
  | O Windows | o workflow `build` do GitHub, depois do push do coordenador | verde no `3ba6550` |

## O desenho

### As regras, num arquivo só

O `windows/app/src/WebPermissions.h` já tem a regra de hoje (`AllowWebPermission`: o microfone e a reprodução automática, só para a origem do app). Ela **fica como está** e continua valendo para o que a página do app pede. O que vem de um quadro nunca passa por ela: tem as regras novas, que olham **o endereço do documento do quadro**, e não a origem que o WebView2 diz no pedido (a documentação não garante qual origem vem ali quando quem pede é um `iframe`).

```cpp
enum class WebPermission { Microphone, Camera, Autoplay, Other };   // a Camera é nova
// Qual WebView2 pergunta: o da janela principal ou o do aviso de ligação.
enum class WebWindow { Main, Notice };

// O endereço de uma reunião: exatamente kChatOrigin (ChatFiles.h) + "/r/" + 10 caracteres do alfabeto dos códigos.
bool IsMeetingUrl(const std::string& url);
// Um quadro só navega dentro do app ou, na janela principal, para uma reunião.
bool AllowFrameNavigation(WebWindow window, const std::string& url);
// O que um quadro pede: só o quadro de uma reunião, na janela principal, e só a câmera, o microfone e a reprodução
// automática. frameUrl é o endereço do documento do quadro ("" quando não se sabe).
bool AllowFramePermission(WebWindow window, WebPermission kind, const std::string& frameUrl);
// A captura de tela: só o quadro de uma reunião, na janela principal.
bool AllowFrameScreenCapture(WebWindow window, const std::string& frameUrl);
```

### O que o WebView2 faz com elas

O `WebViewHost` ganha o `Options::window` (o padrão é o `WebWindow::Notice`, o mais fechado; a `MainWindow` põe o `WebWindow::Main`). Para cada quadro que nasce (o `FrameCreated`), ele guarda o endereço do documento do quadro: o da última navegação do quadro que o `AllowFrameNavigation` deixa. Com esse endereço ele responde aos pedidos do quadro. O que chega ao nível da janela é da página do app.

| O evento | O que o executável faz | A linha no diagnóstico |
|---|---|---|
| a navegação de um quadro, no nível da janela (`FrameNavigationStarting`) | cancela se o `AllowFrameNavigation` não deixa | `navegacao bloqueada: <RedactUrl>` (a de hoje); deixada e fora do app: `navegacao do quadro permitida: <RedactUrl>` |
| a navegação de um quadro, no quadro (`NavigationStarting` do quadro) | guarda o endereço, se o `AllowFrameNavigation` deixa; não cancela nada | — |
| um quadro que não carregou (`FrameNavigationCompleted` sem sucesso) | — | `o quadro nao carregou (erro <n>)` |
| a permissão pedida por um quadro (`PermissionRequested` do quadro) | responde pelo `AllowFramePermission`, marca como tratada (o evento da janela não vem) e não guarda a resposta no perfil | `permissao permitida (quadro): <n> <RedactUrl da origem do pedido>` ou `permissao negada (quadro): <n> <RedactUrl>` |
| a permissão pedida pela página do app (`PermissionRequested` da janela) | a regra de hoje; uma resposta negada não fica guardada no perfil | `permissao negada: <n> <RedactUrl>` (hoje a linha leva o endereço cortado em 160 caracteres) |
| a captura de tela pedida por um quadro (`ScreenCaptureStarting` do quadro) | cancela se o `AllowFrameScreenCapture` não deixa, e marca como tratada | `captura de tela permitida (quadro)` ou `captura de tela cancelada (quadro)` |
| a captura de tela que chega ao nível da janela (`ScreenCaptureStarting` da janela) | cancela sempre | `captura de tela cancelada` |

O `<n>` é o número do tipo da permissão, como hoje (`1` o microfone, `2` a câmera, `9` a reprodução automática). O perfil do WebView2 (a pasta `…\Starsonic Phone\WebView2`) é o mesmo em todas as aberturas: por isso nada do que é novo fica guardado nele, e toda resposta passa pela regra.

### As interfaces do WebView2 que este plano usa

Do `WebView2.h` do SDK `1.0.4258.31`. O que falta num WebView2 antigo deixa uma linha no diagnóstico (`WebView2 sem <o quê> (<interface>)`) e fica no lado fechado: sem o evento do quadro, o quadro não ganha nada.

| A interface | O método | O tratador (`Invoke`) |
|---|---|---|
| `ICoreWebView2_4` | `add_FrameCreated(ICoreWebView2FrameCreatedEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2* sender, ICoreWebView2FrameCreatedEventArgs* args)`; `args->get_Frame(ICoreWebView2Frame** value)` |
| `ICoreWebView2Frame` | `add_Destroyed(ICoreWebView2FrameDestroyedEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2Frame* sender, IUnknown* args)` |
| `ICoreWebView2Frame2` | `add_NavigationStarting(ICoreWebView2FrameNavigationStartingEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2Frame* sender, ICoreWebView2NavigationStartingEventArgs* args)`; `args->get_Uri(LPWSTR*)` |
| `ICoreWebView2Frame3` | `add_PermissionRequested(ICoreWebView2FramePermissionRequestedEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2Frame* sender, ICoreWebView2PermissionRequestedEventArgs2* args)`; `get_Uri`, `get_PermissionKind`, `put_State`, `put_Handled(BOOL)` |
| `ICoreWebView2PermissionRequestedEventArgs3` | `put_SavesInProfile(BOOL)` | — |
| `ICoreWebView2Frame6` | `add_ScreenCaptureStarting(ICoreWebView2FrameScreenCaptureStartingEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2Frame* sender, ICoreWebView2ScreenCaptureStartingEventArgs* args)`; `put_Cancel(BOOL)`, `put_Handled(BOOL)` |
| `ICoreWebView2_27` | `add_ScreenCaptureStarting(ICoreWebView2ScreenCaptureStartingEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2* sender, ICoreWebView2ScreenCaptureStartingEventArgs* args)` |
| `ICoreWebView2` | `add_FrameNavigationCompleted(ICoreWebView2NavigationCompletedEventHandler*, EventRegistrationToken*)` | `(ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args)`; `get_IsSuccess(BOOL*)`, `get_WebErrorStatus(COREWEBVIEW2_WEB_ERROR_STATUS*)` |

O que a documentação do WebView2 diz e este plano usa: o evento de permissão de um quadro vem antes do da janela, e com o `Handled` verdadeiro o da janela não vem; na captura de tela é igual, o `Cancel` verdadeiro faz o `getDisplayMedia` da página falhar com `NotAllowedError`, e sem ele o WebView2 mostra a janela de escolha da tela.

### O chat na máquina do teste

- O programa do chat roda em modo de teste (`servir --teste`, em HTTP, no `127.0.0.1`), com as origens `https://app.starsonic.local` e `https://chat.starcloud-starsonic.com.br:8443` (os `--origem`).
- **A frente TLS** escuta na porta `8443` do endereço privado da máquina e repassa os bytes para o chat. O certificado dela é de uma autoridade feita na hora, que a fumaça põe na lista de autoridades do Windows (`certutil -addstore -f Root`) e tira no fim (`certutil -delstore Root <impressão>`).
- **O nome** `chat.starcloud-starsonic.com.br` vai para o arquivo `hosts` da máquina, apontando para esse endereço, como o item 10 da fumaça já faz com outro nome.
- **O endereço privado** é o IPv4 da máquina numa das três faixas privadas (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). Sem um, vale o `127.0.0.1`, e o resultado diz `loopback`: a prova do endereço privado então não foi feita.

### Os argumentos do WebView2 na fumaça

A variável `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` é do WebView2, e a fumaça já a usa. Além dos de hoje (`--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required`):

| A abertura | Os argumentos a mais | Para quê |
|---|---|---|
| a principal | `--use-fake-device-for-media-stream --auto-select-desktop-capture-source=Entire` | a câmera e o microfone de mentira, com a permissão passando pela regra do app; a tela escolhida sozinha, se o WebView2 aceitar um pedaço do nome ("Entire screen") |
| a segunda tentativa da tela | `--use-fake-device-for-media-stream --auto-select-desktop-capture-source="Entire screen"` | o nome inteiro, entre aspas |
| a terceira tentativa da tela | `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` | o que os testes de ponta a ponta da página usam; aqui a permissão pode não passar pelo app, e por isso só a tela é olhada nesta abertura |
| a do endereço privado com a proteção ligada | os da principal, mais `--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks` | ver o que acontece quando a Microsoft ligar a proteção "Local Network Access", hoje desligada no WebView2; só registra |
| a das recusas, por último | os da principal | o que a página do app pede e não leva, e os quadros que não entram |

A segunda e a terceira só acontecem se a anterior não capturou.

## O portão

**A prova passa** quando, numa rodada do `build` no GitHub, o item 13 da fumaça passa com o `endereco` `privado`: a página carrega no quadro e chega à entrada do colega; a câmera e o microfone funcionam pela regra do app; a captura de tela começa; o alto-falante troca; e cada recusa esperada acontece.

**O que a prova pode mostrar, e o que o coordenador faz** (cada correção é uma rodada do laço de correção da tarefa dona do código, com um commit novo):

| O que aparece | O que quer dizer | O que fazer |
|---|---|---|
| `permissao negada (quadro): 2 …` para o quadro da reunião | o evento de navegação do quadro não veio antes do pedido, e o endereço do quadro ficou vazio | a regra B: a navegação de reunião deixada no nível da janela marca "há um quadro de reunião", e o pedido de um quadro vale com essa marca |
| nenhuma linha `(quadro)`, e uma `permissao negada: 2 <origem>` | o evento do quadro não veio | a regra C: no nível da janela, a câmera e o microfone valem para a origem do chat (ou, se a origem vier como a do app, com a marca da regra B) |
| `captura de tela cancelada`, sem o `(quadro)`, para o pedido do quadro | o evento da captura não veio pelo quadro | no nível da janela, decidir pelo `get_OriginalSourceFrameInfo` (`ICoreWebView2FrameInfo::get_Source`) |
| a linha `captura de tela permitida (quadro)` aparece, mas nenhuma das três tentativas captura | a máquina do GitHub não captura a tela, ou a escolha não foi feita sozinha | a regra está provada, a captura não: o coordenador leva isso ao responsável junto com o resultado, com a proposta de o plano seguinte começar pela vista da reunião e a captura ser provada no PC dele assim que a vista existir |
| `o quadro nao carregou (erro <n>)` ou nada no quadro, com a conferência do nome certa | o WebView2 barrou a página do chat no quadro | **parar** (abaixo) |
| o `setSinkId` falha no quadro | o alto-falante escolhido não vale dentro do quadro | registrar; o plano seguinte decide (o som da reunião ficaria no alto-falante padrão) |
| a abertura com a proteção ligada não carrega o quadro, ou pede uma permissão de número novo | o que virá quando a Microsoft ligar a proteção | registrar; o plano seguinte traz a resposta |

**A prova falha, e a construção para,** se depois dessas correções: o quadro não carrega a página com as opções de sempre do WebView2; ou a câmera e o microfone não chegam ao quadro por nenhuma das regras; ou o WebView2 recusa a captura que a regra deixou (`NotAllowedError` com a linha `permitida`). O coordenador escreve os fatos e leva ao responsável as reservas da spec (seção 14, risco 1), nesta ordem: a página numa segunda janela do app, sozinha; e o navegador, que a etapa já entrega.

---

### Task 1: As regras do executável

**Files:**
- Modify: `windows/app/src/WebPermissions.h`, `windows/app/src/WebPermissions.cpp`
- Create: `tests/desktop/test_web_permissions.cpp`
- Modify: `tests/desktop/CMakeLists.txt` (o `WebPermissions.cpp` sai da lista do `if(WIN32)` e entra na lista portátil, ao lado do `ChatFiles.cpp`)

**Interfaces:**
- Consumes: `kChatOrigin` (`windows/app/src/ChatFiles.h`), `IsAppUrl` e `AllowWebPermission` (os de hoje, sem mudança de regra).
- Produces: o `WebPermission::Camera`, o `WebWindow`, e as quatro funções da seção "As regras, num arquivo só", com essas assinaturas.

- [ ] **Step 1: Escrever os testes** (`tests/desktop/test_web_permissions.cpp`, com o `test_support.h` e o `using namespace starsonic;`, como o `test_chat_files.cpp`)

```cpp
namespace {
const std::string kChat = "https://chat.starcloud-starsonic.com.br:8443";
const std::string kMeeting = kChat + "/r/k7q49xwpht";
const std::string kApp = "https://app.starsonic.local/index.html";
}  // namespace

TEST_CASE("the meeting address is the chat origin, /r/ and a ten-character code, and nothing else") {
    CHECK(IsMeetingUrl(kMeeting));
    CHECK(IsMeetingUrl(kChat + "/r/abcdefghjk"));
    CHECK(IsMeetingUrl(kChat + "/r/mnpqrstvwx"));
    CHECK(IsMeetingUrl(kChat + "/r/yz23456789"));
    for (const char* bad : {"/r/k7q49xwph", "/r/k7q49xwphtt", "/r/K7Q49XWPHT", "/r/k7q49xwphi", "/r/k7q49xwphl",
                            "/r/k7q49xwpho", "/r/k7q49xwphu", "/r/k7q49xwph0", "/r/k7q49xwph1", "/r/k7q49xwph-",
                            "/r/k7q49xwpht/", "/r/k7q49xwpht?x=1", "/r/k7q49xwpht#p=abc", "/r/k7q49xwpht ",
                            "/r/", "/r", "/", "", "/admin/entrar", "/api/v1/r/k7q49xwpht", "//r/k7q49xwpht",
                            "/R/k7q49xwpht"}) {
        CAPTURE(bad);
        CHECK_FALSE(IsMeetingUrl(kChat + bad));
    }
    CHECK_FALSE(IsMeetingUrl("http://chat.starcloud-starsonic.com.br:8443/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br:84430/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br:8443.outro.com/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://outro.com/https://chat.starcloud-starsonic.com.br:8443/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://app.starsonic.local/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl(" " + kMeeting));
}

TEST_CASE("a frame navigates only inside the app, or to a meeting in the main window") {
    CHECK(AllowFrameNavigation(WebWindow::Main, kApp));
    CHECK(AllowFrameNavigation(WebWindow::Notice, "https://app.starsonic.local/aviso.html"));
    CHECK(AllowFrameNavigation(WebWindow::Main, kMeeting));
    CHECK_FALSE(AllowFrameNavigation(WebWindow::Notice, kMeeting));
    for (const std::string& bad : {kChat + "/", kChat + "/admin/entrar", kMeeting + "?x=1", kMeeting + "/",
                                   std::string("https://exemplo.com.br/"), std::string("about:blank"),
                                   std::string("about:srcdoc"), std::string("data:text/html,x"),
                                   std::string("blob:https://app.starsonic.local/0b6f6c1e"), std::string("")}) {
        CAPTURE(bad);
        CHECK_FALSE(AllowFrameNavigation(WebWindow::Main, bad));
    }
}

TEST_CASE("only a meeting frame of the main window gets the camera, the microphone and the autoplay") {
    for (WebPermission kind : {WebPermission::Camera, WebPermission::Microphone, WebPermission::Autoplay}) {
        CHECK(AllowFramePermission(WebWindow::Main, kind, kMeeting));
        CHECK_FALSE(AllowFramePermission(WebWindow::Notice, kind, kMeeting));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, ""));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kApp));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kChat + "/admin/entrar"));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kMeeting + "?x=1"));
    }
    CHECK_FALSE(AllowFramePermission(WebWindow::Main, WebPermission::Other, kMeeting));
}

TEST_CASE("only a meeting frame of the main window captures the screen") {
    CHECK(AllowFrameScreenCapture(WebWindow::Main, kMeeting));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Notice, kMeeting));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, kApp));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, kChat + "/admin/entrar"));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, ""));
}

TEST_CASE("the app origin never gets the camera") {
    CHECK_FALSE(AllowWebPermission(WebPermission::Camera, kApp));
    CHECK(AllowWebPermission(WebPermission::Microphone, kApp));
    CHECK(AllowWebPermission(WebPermission::Autoplay, kApp));
}
```

- [ ] **Step 2: Mudar o `tests/desktop/CMakeLists.txt`** (o `${STARSONIC_DIR}/../windows/app/src/WebPermissions.cpp` na lista portátil do `target_sources`, e fora da lista do `if(WIN32)`) **e ver os testes falharem**

Run: o comando "O C++ portátil" da tabela, dentro da fila da máquina.
Expected: não compila, com `'IsMeetingUrl' was not declared` (e as outras três), ou `'Camera' is not a member of 'starsonic::WebPermission'`.

- [ ] **Step 3: Escrever as regras** no `WebPermissions.h` e no `WebPermissions.cpp`, com as assinaturas da seção "As regras, num arquivo só". O `AllowWebPermission` e o `IsAppUrl` não mudam. O comentário do cabeçalho passa a dizer as regras novas e onde a spec as pede (7.7).

- [ ] **Step 4: Ver os testes passarem**

Run: `cmake --build work/build-desktop -j2 && work/build-desktop/desktop_tests` e `python3 build/check_source_text.py`.
Expected: `490 passed | 0 failed` nos casos (os 485 de hoje e os 5 novos) e `ok`.

- [ ] **Step 5: Commit**

```bash
git add -- windows/app/src/WebPermissions.h windows/app/src/WebPermissions.cpp tests/desktop/test_web_permissions.cpp tests/desktop/CMakeLists.txt
git commit -m "feat(windows): as regras do quadro da reunião no executável" -- windows/app/src/WebPermissions.h windows/app/src/WebPermissions.cpp tests/desktop/test_web_permissions.cpp tests/desktop/CMakeLists.txt
```

### Task 2: O WebView2 da janela principal obedece às regras

**Files:**
- Modify: `windows/app/src/WebViewHost.h`, `windows/app/src/WebViewHost.cpp`, `windows/app/src/MainWindow.cpp` (uma linha: o `webOptions_.window`)
- Modify: `windows/ui/index.html` (a regra de segurança da página), `windows/ui/tests/chat/lista.spec.ts` (o teste que a prende)
- Modify: `docs/ponte-windows.md`

**Interfaces:**
- Consumes: as quatro funções e o `WebWindow` da Task 1; o `RedactUrl`.
- Produces: o `WebViewHost::Options::window` (`WebWindow`, com o padrão `WebWindow::Notice`); as linhas do diagnóstico da tabela "O que o WebView2 faz com elas", letra por letra (a Task 4 as procura).

- [ ] **Step 1: A regra de segurança da página do app.** No `windows/ui/tests/chat/lista.spec.ts`, o teste `the page CSP lets the app reach only the chat server` passa a esperar exatamente:

```ts
  expect(csp).toBe(
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; " +
      "connect-src 'self' https://chat.starcloud-starsonic.com.br:8443 wss://chat.starcloud-starsonic.com.br:8443; " +
      "frame-src https://chat.starcloud-starsonic.com.br:8443; media-src 'self'",
  );
  // A página do aviso não mostra quadro nenhum de fora.
  const aviso = readFileSync(fileURLToPath(new URL('../../dist/aviso.html', import.meta.url)), 'utf8');
  expect(aviso).not.toContain('frame-src');
  expect(aviso).not.toContain('chat.starcloud-starsonic.com.br');
```

Run: o comando "A interface" da tabela, dentro da fila. Expected: FAIL, com a regra de hoje no lugar da esperada.

- [ ] **Step 2: Pôr o `frame-src`** no `windows/ui/index.html` (só nele) e ver o teste passar. Expected: `1 passed`.

- [ ] **Step 3: O `Options::window`.** No `WebViewHost.h`, o campo `WebWindow window = WebWindow::Notice;` nas `Options`, com o comentário do que ele decide, e o comentário do alto do arquivo atualizado (o que a janela principal passa a deixar). Na `MainWindow::Create`, `webOptions_.window = WebWindow::Main;` junto dos outros campos do `webOptions_`. O aviso não muda.

- [ ] **Step 4: Os eventos,** no `WebViewHost::Configure`, pela tabela "O que o WebView2 faz com elas" e pelas interfaces da tabela seguinte, no molde dos tratadores que o arquivo já tem (`Callback<…>`, `ComPtr::As`, `TakeString`, `Log`):
  - o `PermissionOf` conhece a `COREWEBVIEW2_PERMISSION_KIND_CAMERA`;
  - o tratador de permissão da janela continua com o `AllowWebPermission`; a linha da recusa troca o `Short(url)` pelo `RedactUrl(url)`, e a recusa não fica no perfil (`put_SavesInProfile(FALSE)`, quando o `ICoreWebView2PermissionRequestedEventArgs3` existe);
  - o `FrameNavigationStarting` da janela usa o `AllowFrameNavigation(options_.window, url)`; a navegação da janela continua só com o `IsAppUrl`;
  - o `FrameNavigationCompleted` e o `ScreenCaptureStarting` da janela, novos;
  - o `FrameCreated`: para cada quadro, um endereço guardado (um `std::shared_ptr<std::string>` dividido entre os tratadores daquele quadro), os três tratadores do quadro e o `Destroyed`. O `WebViewHost` segura cada quadro vivo num `std::vector<Microsoft::WRL::ComPtr<ICoreWebView2Frame>>` até o `Destroyed` dele, e o `Close` esvazia a lista.
  Nenhuma linha leva um endereço sem o `RedactUrl`.

- [ ] **Step 5: O `docs/ponte-windows.md`.** Uma seção nova, `## As reuniões (0.5.0)`, antes de `## O modo iPhone (etapa 2)`, com a subseção `### Para o executável: o que a janela principal deixa`: as três regras (com o formato exato do endereço de uma reunião), a tabela dos eventos e das linhas, e a frase de que o perfil não guarda nada disso. O item da seção do chat que diz "A navegação para fora do app, nas duas janelas, é bloqueada" ganha a exceção, com a remissão à seção nova.

- [ ] **Step 6: Conferir o que dá para conferir aqui**

Run: o "C++ portátil" (o `WebPermissions` continua compilando e passando), `python3 build/check_source_text.py`, e `git grep -n "STARSONIC_" -- windows/app/src/WebViewHost.cpp windows/app/src/WebViewHost.h` (nenhum gancho novo).
Expected: `490 passed`, `ok`, e nenhuma linha nova com `STARSONIC_`.

- [ ] **Step 7: Commit** (o relatório diz "não compilado no Windows")

```bash
git add -- windows/app/src/WebViewHost.h windows/app/src/WebViewHost.cpp windows/app/src/MainWindow.cpp windows/ui/index.html windows/ui/tests/chat/lista.spec.ts docs/ponte-windows.md
git commit -m "feat(windows): a janela principal deixa o quadro da reunião" -- windows/app/src/WebViewHost.h windows/app/src/WebViewHost.cpp windows/app/src/MainWindow.cpp windows/ui/index.html windows/ui/tests/chat/lista.spec.ts docs/ponte-windows.md
```

- [ ] **Step 8 (o coordenador): o push e a rodada do `build`.** Expected: o app compila, os testes do `desktop_tests` do Windows passam e a fumaça de hoje (os itens 1 a 12) continua verde. Um erro de compilação volta ao construtor desta tarefa, com o trecho do registro.

### Task 3: O servidor do chat da fumaça

**Files:**
- Create: `tests/smoke/reuniao_local.py`, `tests/smoke/test_reuniao_local.py`
- Modify: `tests/smoke/requirements-windows.txt` (três linhas: `cryptography==50.0.2`, `cffi==2.1.1`, `pycparser==3.12`)
- Modify: `.github/workflows/build.yml` (o job `ui`)

**Interfaces:**
- Consumes: o programa do chat (`starsonic-chat admin-criar` e `servir --teste`), a página de administração e a API do `docs/chat-protocolo.md` (as seções 5, 9 e 10).
- Produces (o `tests/smoke/reuniao_local.py`, que importa no Linux e no Windows; o `cryptography` só é importado dentro do `make_certificates`):

```python
CHAT_NAME = "chat.starcloud-starsonic.com.br"
CHAT_PORT = 8443
CHAT_ORIGIN = "https://chat.starcloud-starsonic.com.br:8443"
APP_ORIGIN = "https://app.starsonic.local"
CODE_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789"

def is_private(address: str) -> bool: ...            # 10/8, 172.16/12 e 192.168/16
def private_address() -> tuple[str, str]: ...        # ("<IPv4 da máquina>", "privado") ou ("127.0.0.1", "loopback")
def make_certificates(name: str) -> tuple[bytes, bytes, bytes]: ...   # (a autoridade, o certificado do nome, a chave dele), em PEM
def thumbprint(cert_pem: bytes) -> str: ...          # o SHA-1 do certificado, 40 hexadecimais maiúsculos (o do certutil)

class TlsFront:                                       # TLS em (host, port) -> TCP no 127.0.0.1:target_port
    def __init__(self, host: str, port: int, target_port: int, cert_pem: bytes, key_pem: bytes): ...
    port: int                                         # a porta de verdade (com port=0, uma livre)
    connections: int                                  # quantos apertos de mão TLS terminaram bem
    def start(self) -> None: ...
    def stop(self) -> None: ...

class LocalChat:                                      # o chat em modo de teste, numa porta livre do 127.0.0.1
    def __init__(self, binary, data_dir, origins: list[str]): ...
    port: int
    def start(self) -> None: ...                      # o admin-criar (a senha sorteada, pelo stdin) e o servir --teste
    def stop(self) -> None: ...
    def company_with_meetings(self, name: str) -> str: ...            # o código da empresa (STAR-XXXX-XXXX), com as reuniões liberadas
    def link_computer(self, code: str, computer: str) -> str: ...      # a chave do computador
    def enter_person(self, key: str, ramal: str, name: str) -> None: ...
    def schedule_meeting(self, key: str, subject: str) -> str: ...     # o código da reunião; começa daqui a 1 h e vale 2 h depois
    def meeting_pass(self, key: str, code: str) -> str: ...            # o passe
    def open_as_colleague(self, code: str, meeting_pass: str) -> dict: ...   # a resposta do abrir da página com o passe
    log_file: str                                     # o registro do servidor (a saída dele)
```

O que o plano decide e o código não mostra:
- os certificados: uma autoridade (`CA:TRUE`) e um certificado do nome assinado por ela, com o nome no `subjectAltName`, o uso `serverAuth`, e os identificadores de chave (o `SubjectKeyIdentifier` nos dois e o `AuthorityKeyIdentifier` no do nome: o Python 3.13 recusa um certificado sem eles); os dois valem 2 dias;
- os pedidos do `LocalChat` vão direto ao `http://127.0.0.1:<porta>`, sem proxy nenhum (um `ProxyHandler({})`), sem seguir redirecionamento, com os cookies da sessão da administração, e com o `csrf` de cada formulário lido da página dele;
- o caminho da administração é o dos testes de hoje (`video-servidor/e2e/servidores.ts`): entrar em `/admin/entrar` com o usuário `teste`; criar a empresa em `/admin/empresas` (o `303` leva a `/admin/empresas/<id>`); liberar as reuniões em `/admin/reunioes/empresas/<id>` com `liberar=1`; ler o código na página da empresa;
- **nenhum teste resolve o nome do chat:** quem fala com a frente liga no endereço dela (`127.0.0.1` nos testes daqui) e diz o nome só no aperto de mão TLS (o `server_hostname`) e no `Host`. Um cliente aberto com o nome iria ao servidor de verdade;
- nada disto imprime a senha, a chave nem o passe.

- [ ] **Step 1: Escrever os testes** (`tests/smoke/test_reuniao_local.py`; os da classe `LocalChatTest` pedem o `STARSONIC_CHAT_BIN` e, sem ele, são pulados com a mensagem "falta o STARSONIC_CHAT_BIN"):

```python
class AddressTest(unittest.TestCase):
    def test_only_the_three_private_ranges_count(self):
        for address in ("10.1.0.4", "172.16.0.1", "172.31.255.254", "192.168.1.20"):
            self.assertTrue(reuniao_local.is_private(address), address)
        for address in ("127.0.0.1", "172.15.0.1", "172.32.0.1", "169.254.1.1", "8.8.8.8", "192.169.1.1", "", "::1"):
            self.assertFalse(reuniao_local.is_private(address), address)

    def test_the_address_of_this_machine_says_what_it_is(self):
        address, kind = reuniao_local.private_address()
        self.assertEqual(kind, "privado" if reuniao_local.is_private(address) else "loopback")
        if kind == "loopback":
            self.assertEqual(address, "127.0.0.1")


class CertificateTest(unittest.TestCase):
    def test_the_certificate_names_the_chat_and_comes_from_the_authority(self):
        ca_pem, cert_pem, key_pem = reuniao_local.make_certificates(reuniao_local.CHAT_NAME)
        ca, cert = x509.load_pem_x509_certificate(ca_pem), x509.load_pem_x509_certificate(cert_pem)
        names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        self.assertEqual(names.get_values_for_type(x509.DNSName), [reuniao_local.CHAT_NAME])
        self.assertTrue(ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        self.assertFalse(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        cert.verify_directly_issued_by(ca)   # a assinatura, o emissor e os identificadores de chave conferem
        for one in (ca, cert):
            self.assertLessEqual(one.not_valid_after_utc - one.not_valid_before_utc, datetime.timedelta(days=3))
        self.assertIn(b"PRIVATE KEY", key_pem)
        self.assertRegex(reuniao_local.thumbprint(ca_pem), r"^[0-9A-F]{40}$")


class TlsFrontTest(unittest.TestCase):   # o setUp sobe um servidor TCP de eco numa porta livre (self.echo_port)
    def exchange(self, context):
        with socket.create_connection(("127.0.0.1", self.front.port), timeout=10) as raw:
            with context.wrap_socket(raw, server_hostname=reuniao_local.CHAT_NAME) as tls:
                tls.sendall(b"ola")
                return tls.recv(16)

    def test_a_client_that_trusts_the_authority_reaches_the_target(self):
        self.assertEqual(self.exchange(ssl.create_default_context(cadata=self.ca_pem.decode("ascii"))), b"ola")
        self.assertEqual(self.front.connections, 1)

    def test_a_client_that_does_not_trust_it_does_not_count(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.exchange(ssl.create_default_context())
        time.sleep(0.5)
        self.assertEqual(self.front.connections, 0)


@unittest.skipUnless(os.environ.get("STARSONIC_CHAT_BIN"), "falta o STARSONIC_CHAT_BIN")
class LocalChatTest(unittest.TestCase):   # o setUpClass sobe o LocalChat (as origens APP_ORIGIN e CHAT_ORIGIN) e a frente
    def test_a_company_a_computer_a_person_a_meeting_and_a_pass(self):
        code = self.chat.company_with_meetings("Empresa Fumaça")
        self.assertRegex(code, r"^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$")
        key = self.chat.link_computer(code, "FUMACA-01")
        self.assertRegex(key, r"^[A-Za-z0-9_-]{43}$")
        self.chat.enter_person(key, "2001", "Ana Souza")
        meeting = self.chat.schedule_meeting(key, "Planejamento")
        self.assertRegex(meeting, "^[%s]{10}$" % reuniao_local.CODE_ALPHABET)
        meeting_pass = self.chat.meeting_pass(key, meeting)
        self.assertRegex(meeting_pass, r"^[A-Za-z0-9_-]{43}$")
        opened = self.chat.open_as_colleague(meeting, meeting_pass)
        self.assertEqual(opened["colega"]["nome"], "Ana Souza")
        # O passe vale uma vez só: o segundo abrir com ele não reconhece ninguém.
        with self.assertRaises(RuntimeError):
            self.chat.open_as_colleague(meeting, meeting_pass)
        # Pela frente, com o nome do chat: a página vem, e só o app (e as origens de teste) pode mostrá-la num quadro.
        status, headers = self.get_through_the_front("/r/" + meeting)   # https, o Host CHAT_NAME:8443, a autoridade
        self.assertEqual(status, 200)
        self.assertIn("frame-ancestors https://app.starsonic.local", headers["Content-Security-Policy"])
        # Nada disso foi para o registro do chat.
        log = pathlib.Path(self.chat.log_file).read_text(encoding="utf-8", errors="replace")
        for secret in (meeting, meeting_pass, key, "Ana Souza", "Planejamento"):
            self.assertNotIn(secret, log)


class NamesTest(unittest.TestCase):
    def test_the_chat_address_is_the_one_of_the_app(self):
        for path in ("windows/app/src/ChatFiles.h", "windows/ui/src/chat/endereco.ts"):
            self.assertIn(reuniao_local.CHAT_ORIGIN, (ROOT / path).read_text(encoding="utf-8"), path)
```

O `LocalChat` ganha, para o teste, o `log_file` (o caminho do registro do servidor). Um pedido que o servidor recusa levanta `RuntimeError` com o status e o código do erro, e nunca com o corpo do pedido.

- [ ] **Step 2: Ver os testes falharem**

Run: o comando "Os testes da fumaça" da tabela, só com o `tests/smoke/test_reuniao_local.py`.
Expected: `ModuleNotFoundError: No module named 'reuniao_local'`.

- [ ] **Step 3: Escrever o `tests/smoke/reuniao_local.py`,** com as interfaces de cima.

- [ ] **Step 4: Ver os testes passarem**

Run: o mesmo comando, e `env -u GITHUB_ACTIONS python3 -m unittest discover -s tests/python`.
Expected: `OK`, sem teste pulado no primeiro; `OK` no segundo.

- [ ] **Step 5: O workflow** (`.github/workflows/build.yml`, o job `ui`), depois do passo "Servidor do chat para os testes" e antes do "Testes das telas (Playwright)":
  - o passo "Servidor do chat para a fumaça do Windows": `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$RUNNER_TEMP/chat-fumaca/starsonic-chat.exe" ./cmd/starsonic-chat`, na pasta `chat-servidor`;
  - o `actions/setup-python@v5`, com a `python-version: '3.12'`;
  - o passo "Testes das ferramentas da fumaça", na raiz do repositório: `python -m pip install --disable-pip-version-check --no-input -r tests/smoke/requirements-windows.txt` e `python -m unittest -v tests/smoke/test_reuniao_local.py`, com o `STARSONIC_CHAT_BIN: ${{ runner.temp }}/starsonic-chat`;
  - o passo "Publicar o servidor do chat da fumaça": `actions/upload-artifact@v4`, com o nome `chat-fumaca-windows`, o caminho `${{ runner.temp }}/chat-fumaca/starsonic-chat.exe` e o `if-no-files-found: error`.

- [ ] **Step 6: Commit**

```bash
git add -- tests/smoke/reuniao_local.py tests/smoke/test_reuniao_local.py tests/smoke/requirements-windows.txt .github/workflows/build.yml
git commit -m "test(windows): o servidor do chat da fumaça, com a frente TLS" -- tests/smoke/reuniao_local.py tests/smoke/test_reuniao_local.py tests/smoke/requirements-windows.txt .github/workflows/build.yml
```

- [ ] **Step 7 (o coordenador): o push e a rodada do `build`.** Expected: o job `ui` verde, com os testes novos rodando de verdade (nenhum pulado) e o artefato `chat-fumaca-windows` publicado.

### Task 4: O item 13 da fumaça — a reunião dentro da janela do app

**Files:**
- Create: `tests/smoke/reuniao_fumaca.py`, `tests/smoke/test_reuniao_fumaca.py`
- Modify: `tests/smoke/windows_smoke.py` (o argumento `--chat`, a chamada do item 13 no fim do `run_smoke` e o texto do alto do arquivo)
- Modify: `tests/smoke/Test-InstalledApp.ps1` (o parâmetro `-Chat`, obrigatório, repassado como `--chat`)
- Modify: `README.md` (a frase da fumaça do Windows ganha a reunião dentro da janela do app)
- Modify: `.github/workflows/build.yml` (o job `ui` roda também o `tests/smoke/test_reuniao_fumaca.py`; o job `windows` baixa o artefato `chat-fumaca-windows` e o passa à fumaça)

**Interfaces:**
- Consumes: o `tests/smoke/reuniao_local.py` inteiro (Task 3); as linhas do diagnóstico da Task 2; do `windows_smoke.py`, pelo módulo passado como `smoke`: `App`, `connect`, `find_page`, `wait_for`, `log`, `read_log`, `show_log`, `screenshot`, `webview_processes`, `browser_arguments`, `hosts_with`, `flush_dns`, `HOSTS_FILE` e `SmokeFailure`. O `reuniao_fumaca.py` não importa o `windows_smoke` (ele roda como o programa principal, e um `import` faria uma segunda cópia).
- Produces (o `tests/smoke/reuniao_fumaca.py`):

```python
PERSON = "Ana Souza"; COMPANY = "Empresa Fumaça"; COMPUTER = "FUMACA-01"; RAMAL = "2001"; SUBJECT = "Planejamento"
ALLOW = "camera <o>; microphone <o>; display-capture <o>; autoplay <o>; speaker-selection <o>"   # <o> = CHAT_ORIGIN

def meeting_arguments(base: str, capture: str | None = None, lna: bool = False) -> str: ...
#   base + " --use-fake-device-for-media-stream" + o argumento da tela (capture: None, "pedaco", "inteiro" ou "falsa",
#   pela tabela "Os argumentos do WebView2 na fumaça") + o do LNA
def open_meeting(page, origin: str, code: str, meeting_pass: str, pump, timeout: float = 30) -> dict: ...
#   põe o quadro (o endereço e o allow juntos, antes de entrar no documento; fixo, do tamanho da janela, por cima de
#   tudo), espera o "pronta", manda o passe com "aparelhos": {} e espera o primeiro estado da entrada. Só aceita mensagem
#   do quadro e da origem do chat, com o "starsonic": 1. Devolve o read_messages(page) mais o "quadro": o Frame do
#   Playwright cujo endereço começa com origin + "/r/", ou None
def read_messages(page) -> dict: ...
#   {"mensagens": [...], "microfone": bool | None, "csp": [...]}: o que a página do quadro mandou até agora, cada mensagem
#   como "pronta", "estado:entrada", "fim:saiu"..., sem repetir a mesma duas vezes seguidas; o microfone do último
#   estado; e as recusas da regra de segurança da página do app (o securitypolicyviolation)
def close_meeting(page) -> None: ...                       # tira o quadro da página
def probe_entry(frame, pump, timeout: float = 15) -> dict: ...   # {"nome", "largura", "imagem", "semAcesso", "entrar"}
def probe_media(target, audio: bool = True, video: bool = True) -> dict: ...
#   o getUserMedia direto, num quadro ou na página: {"faixas": ["audio:live", "video:live"]} (em ordem) ou {"erro": "<nome>: <texto>"}
def probe_speaker(frame) -> dict: ...      # o setSinkId numa saída que não é a padrão: {"saidas": n, "ok": bool, "trocou": bool} ou {"erro": ...}
def probe_screen(target, pump, timeout: float = 15) -> dict: ...
#   um botão posto no documento (fixo, no canto, por cima de tudo), um clique de verdade nele (o locator do Playwright: o
#   getDisplayMedia pede um gesto) e o getDisplayMedia no clique; o botão sai no fim. Devolve {"faixa": "live",
#   "superficie": ...}, {"erro": "<nome>: <texto>"} ou, sem resposta no prazo (a janela de escolha aberta), {"erro": "sem resposta"}
def probe_refused_frames(page, origin: str, code: str, pump) -> dict: ...
#   três quadros de 1 por 1, postos como o da reunião e sem o allow, um de cada vez; 3 s depois, "carregou" é haver um
#   quadro da página com aquele endereço; o quadro sai. Devolve {"administracao": bool, "consulta": bool, "de_fora": bool}
def log_lines(log_text: str) -> list[str]: ...
#   do diagnostico.log, sem a data e a hora do começo de cada linha ("AAAA-MM-DD HH:MM:SS.mmm "): as linhas que começam
#   com "permissao ", "captura de tela", "navegacao " ou "o quadro nao carregou"
def leaks(log_text: str, secrets: list[str]) -> list[str]: ...   # quais segredos (não vazios) aparecem no texto
def problems_of(record: dict) -> list[str]: ...            # o portão: [] quando a prova passa
def run_meeting(smoke, pw, win, exe, capturas, result, problems, chat_binary) -> None: ...   # o item 13; só no Windows
```

**O `record`** (vai inteiro ao `resultado-fumaca.json`, na chave `reuniao`; nunca leva o código, o passe nem a chave):

```python
{"endereco": "privado",                    # ou "loopback"
 "webview2": "<o Browser do /json/version>",
 "principal": {"argumentos": "...", "mensagens": ["pronta", "estado:entrada"], "microfone": True, "quadro": True,
               "entrada": {"nome": "Ana Souza", "largura": 1280, "imagem": "ligada", "semAcesso": False, "entrar": True},
               "midia": {"faixas": ["audio:live", "video:live"]},
               "alto_falante": {"saidas": 3, "ok": True, "trocou": True},
               "console": [...], "csp": [...], "diagnostico": [...]},
 "tela": {"tentativas": [{"captura": "pedaco", "resultado": {"faixa": "live", "superficie": "monitor"}, "diagnostico": [...]}],
          "ok": "pedaco"},                 # ou None
 "lna": {"argumentos": "...", "quadro": True, "mensagens": [...], "console": [...], "diagnostico": [...]},
 "recusas": {"argumentos": "...",
             "do_app": {"camera": {"erro": "NotAllowedError: ..."}, "tela": {"erro": "NotAllowedError: ..."}},
             "recusados": {"administracao": False, "consulta": False, "de_fora": False},
             "csp": [...], "diagnostico": [...]},
 "vazou": [],                              # de todos os diagnósticos juntos
 "desfeito": {"hosts": True, "certificado": True}}
```

**O `problems_of`** reprova, com uma frase para cada: o `endereco` diferente de `privado`; as `mensagens` da principal sem o `pronta` ou sem o `estado:entrada`; o `quadro` falso; o `nome` da entrada diferente do `PERSON`; a `largura` 0; o `semAcesso` verdadeiro; o `entrar` falso; as `faixas` diferentes de `["audio:live", "video:live"]`; o alto-falante sem o `ok`, ou sem o `trocou` com mais de uma saída; o `tela.ok` vazio; a câmera ou a tela pedidas pela página do app sem um erro que comece com `NotAllowedError`; um quadro recusado que carregou; o `vazou` com alguma coisa; o `desfeito` com um falso; e a falta de alguma destas linhas, procuradas em todos os `diagnostico` do `record`, juntos (o da principal, os das tentativas da tela e o das recusas):

| A linha | Como é procurada | O que ela prova |
|---|---|---|
| `navegacao do quadro permitida: https://chat.starcloud-starsonic.com.br` | a linha inteira | a exceção da navegação deixou a reunião |
| `permissao permitida (quadro): 2 ` | o começo da linha | a câmera chegou ao quadro pela regra do app |
| `permissao negada: 2 https://app.starsonic.local` | a linha inteira | a página do app pediu a câmera e não levou |
| `navegacao bloqueada: https://chat.starcloud-starsonic.com.br` | a linha inteira | outro endereço do chat não entra num quadro |
| `captura de tela cancelada` | a linha inteira (a do quadro tem o `(quadro)` no fim e não conta) | a página do app pediu a tela e não levou |
| `captura de tela permitida (quadro)` | a linha inteira | a tela chegou ao quadro pela regra do app |

O microfone do quadro é registrado e não é pedido como linha: a origem do app já tem o microfone guardado no perfil, e o WebView2 pode responder por ele sem perguntar. O `lna` não reprova nada.

**A ordem do item 13** (o `run_meeting`):
1. O chat (`LocalChat`, com as origens `APP_ORIGIN` e `CHAT_ORIGIN`), os certificados, a frente TLS no endereço privado e na porta `CHAT_PORT`, a autoridade na lista do Windows, e o nome no `hosts` (com o `flush_dns`).
2. **A conferência do nome:** um pedido `https` do próprio Python a `CHAT_ORIGIN + "/admin/entrar"`, sem proxy, com a confiança do Windows, responde `200`, e o `connections` da frente cresceu. Sem isso, `SmokeFailure`: o app não abre.
3. A empresa, o computador, a pessoa e a reunião. Um passe novo antes de cada abertura do quadro (o passe vale uma vez e 120 s).
4. **A abertura principal** (`meeting_arguments(base, "pedaco")`), numa pasta de dados nova: o quadro da reunião (`open_meeting`), a entrada, as mensagens lidas de novo (`read_messages`), a mídia, o alto-falante, a captura `reuniao-entrada.png` e, por último, a tela (uma janela de escolha que ficasse aberta não atrapalha o resto); o diagnóstico lido; o app fechado. No `record`, o `quadro` é só verdadeiro ou falso.
5. As outras tentativas da tela, só se a anterior não capturou: `"inteiro"` e depois `"falsa"`, cada uma numa abertura, com o quadro aberto de novo.
6. A abertura com a proteção ligada (`lna=True`): o quadro e as mensagens, só para registrar.
7. **A abertura das recusas,** por último (`meeting_arguments(base, "pedaco")`): o que a página do app pede e não leva (o `probe_media` só com o vídeo e o `probe_screen`, os dois na página do app) e os três quadros recusados. Ela vem depois de tudo porque o perfil do WebView2 é o mesmo em todas as aberturas: se uma recusa à página do app ficasse guardada nele apesar da regra, não poderia atrapalhar o quadro da reunião das aberturas de antes.
8. O `vazou`: o `leaks` em todos os diagnósticos, com o código, cada passe, a chave do computador, o `PERSON`, o `COMPANY` e o `SUBJECT`.
9. No `finally`: o app fechado, o `hosts` de volta, a autoridade fora da lista (`certutil -delstore Root <impressão>`), a frente e o chat parados; o `desfeito` confere os dois primeiros lendo o `hosts` e a lista (`certutil -store Root <impressão>` não acha).

Os quadros recusados são três, postos como o da reunião, sem o `allow`: `CHAT_ORIGIN + "/admin/entrar"`, `CHAT_ORIGIN + "/r/" + code + "?x=1"` e `https://exemplo.com.br/`.

- [ ] **Step 1: Escrever os testes** (`tests/smoke/test_reuniao_fumaca.py`):

```python
class ArgumentsTest(unittest.TestCase):
    def test_each_opening_has_its_arguments(self):
        base = "--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required"
        fake = base + " --use-fake-device-for-media-stream"
        self.assertEqual(reuniao_fumaca.meeting_arguments(base), fake)
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "pedaco"), fake + " --auto-select-desktop-capture-source=Entire")
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "inteiro"), fake + ' --auto-select-desktop-capture-source="Entire screen"')
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "falsa"), fake + " --use-fake-ui-for-media-stream")
        self.assertEqual(reuniao_fumaca.meeting_arguments(base, "pedaco", lna=True),
                         fake + " --auto-select-desktop-capture-source=Entire"
                         " --enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks")


LINES = ["navegacao do quadro permitida: https://chat.starcloud-starsonic.com.br",
         "permissao permitida (quadro): 2 https://chat.starcloud-starsonic.com.br",
         "permissao negada: 2 https://app.starsonic.local",
         "navegacao bloqueada: https://chat.starcloud-starsonic.com.br",
         "captura de tela cancelada", "captura de tela permitida (quadro)"]
# Como o problems_of chama cada uma (a da permissão do quadro é procurada pelo começo).
NEEDED = [LINES[0], "permissao permitida (quadro): 2 ", LINES[2], LINES[3], LINES[4], LINES[5]]


def complete():
    """O record de uma prova que passa (o exemplo do plano)."""
    return {"endereco": "privado", "webview2": "Edg/154.0.0.0",
            "principal": {"argumentos": "", "mensagens": ["pronta", "estado:entrada"], "microfone": True, "quadro": True,
                          "entrada": {"nome": "Ana Souza", "largura": 1280, "imagem": "ligada", "semAcesso": False,
                                      "entrar": True},
                          "midia": {"faixas": ["audio:live", "video:live"]},
                          "alto_falante": {"saidas": 3, "ok": True, "trocou": True},
                          "console": [], "csp": [], "diagnostico": list(LINES[:2]) + [LINES[5]]},
            "tela": {"tentativas": [{"captura": "pedaco", "resultado": {"faixa": "live", "superficie": "monitor"},
                                     "diagnostico": []}], "ok": "pedaco"},
            "lna": {"argumentos": "", "quadro": True, "mensagens": ["pronta"], "console": [], "diagnostico": []},
            "recusas": {"argumentos": "",
                        "do_app": {"camera": {"erro": "NotAllowedError: Permission denied"},
                                   "tela": {"erro": "NotAllowedError: Permission denied"}},
                        "recusados": {"administracao": False, "consulta": False, "de_fora": False},
                        "csp": [], "diagnostico": list(LINES[2:5])},
            "vazou": [],
            "desfeito": {"hosts": True, "certificado": True}}


class LogTest(unittest.TestCase):
    def test_only_the_lines_of_the_frame_rules_are_kept_without_the_time(self):
        log = "\r\n".join(["2026-11-24 10:00:00.001 interface pronta",
                           "2026-11-24 10:00:01.002 permissao negada: 2 https://app.starsonic.local",
                           "2026-11-24 10:00:02.003 captura de tela cancelada",
                           "2026-11-24 10:00:03.004 navegacao bloqueada: file:",
                           "2026-11-24 10:00:04.005 o quadro nao carregou (erro 7)",
                           "2026-11-24 10:00:05.006 chat: chatKey", ""])
        self.assertEqual(reuniao_fumaca.log_lines(log),
                         ["permissao negada: 2 https://app.starsonic.local", "captura de tela cancelada",
                          "navegacao bloqueada: file:", "o quadro nao carregou (erro 7)"])

    def test_a_secret_in_the_log_is_found(self):
        log = "2026-11-24 10:00:00.001 navegacao bloqueada: https://exemplo.com.br/r/k7q49xwpht"
        self.assertEqual(reuniao_fumaca.leaks(log, ["k7q49xwpht", "Ana Souza", ""]), ["k7q49xwpht"])
        self.assertEqual(reuniao_fumaca.leaks("", ["k7q49xwpht"]), [])


class VerdictTest(unittest.TestCase):
    def test_a_complete_record_passes(self):
        self.assertEqual(reuniao_fumaca.problems_of(complete()), [])

    def test_each_missing_fact_fails_and_the_problem_names_it(self):
        def changed(path, value):
            record = complete()
            node = record
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            return record

        cases = [
            (("endereco",), "loopback", "privado"),
            (("principal", "mensagens"), ["pronta"], "entrada"),
            (("principal", "quadro"), False, "quadro"),
            (("principal", "entrada", "nome"), "Outra Pessoa", "nome"),
            (("principal", "entrada", "largura"), 0, "imagem"),
            (("principal", "entrada", "semAcesso"), True, "acesso"),
            (("principal", "entrada", "entrar"), False, "Entrar"),
            (("principal", "midia"), {"faixas": ["audio:live"]}, "camera"),
            (("principal", "midia"), {"erro": "NotAllowedError: Permission denied"}, "camera"),
            (("principal", "alto_falante"), {"erro": "NotAllowedError: x"}, "alto-falante"),
            (("principal", "alto_falante"), {"saidas": 3, "ok": True, "trocou": False}, "alto-falante"),
            (("tela", "ok"), None, "tela"),
            (("recusas", "do_app", "camera"), {"faixas": ["video:live"]}, "pagina do app"),
            (("recusas", "do_app", "tela"), {"faixa": "live", "superficie": "monitor"}, "pagina do app"),
            (("recusas", "recusados", "administracao"), True, "administracao"),
            (("recusas", "recusados", "consulta"), True, "consulta"),
            (("recusas", "recusados", "de_fora"), True, "de_fora"),
            (("vazou",), ["k7q49xwpht"], "vazou"),
            (("desfeito", "hosts"), False, "hosts"),
            (("desfeito", "certificado"), False, "certificado"),
        ]
        for path, value, word in cases:
            problems = reuniao_fumaca.problems_of(changed(path, value))
            self.assertEqual(len(problems), 1, (path, problems))
            self.assertIn(word, problems[0], path)
        for line, needed in zip(LINES, NEEDED):
            record = complete()
            for part in (record["principal"], record["recusas"]):
                part["diagnostico"] = [l for l in part["diagnostico"] if l != line]
            self.assertEqual(reuniao_fumaca.problems_of(record), ["falta no diagnostico: " + needed])

    def test_the_line_of_the_frame_does_not_count_as_the_line_of_the_window(self):
        record = complete()
        record["recusas"]["diagnostico"] = [l for l in LINES[2:5] if l != "captura de tela cancelada"] + [
            "captura de tela cancelada (quadro)"]
        self.assertEqual(reuniao_fumaca.problems_of(record), ["falta no diagnostico: captura de tela cancelada"])

    def test_the_line_of_a_screen_attempt_counts(self):
        record = complete()
        record["principal"]["diagnostico"] = list(LINES[:2])
        record["tela"]["tentativas"][0]["diagnostico"] = ["captura de tela permitida (quadro)"]
        self.assertEqual(reuniao_fumaca.problems_of(record), [])

    def test_the_local_network_run_never_fails_the_proof(self):
        record = complete()
        record["lna"] = {"argumentos": "", "quadro": False, "mensagens": [], "console": ["x"], "diagnostico": ["y"]}
        self.assertEqual(reuniao_fumaca.problems_of(record), [])


@unittest.skipUnless(os.environ.get("STARSONIC_CHAT_BIN"), "falta o STARSONIC_CHAT_BIN")
class RehearsalTest(unittest.TestCase):
    def test_the_page_opens_in_a_frame_of_a_window_with_the_origin_of_the_app(self):
        # ... o setUp do ensaio (abaixo) deixa self.page, self.pump, self.code, self.meeting_pass e self.console
        opened = reuniao_fumaca.open_meeting(self.page, reuniao_local.CHAT_ORIGIN, self.code, self.meeting_pass, self.pump)
        frame = opened["quadro"]
        self.assertIsNotNone(frame)
        entry = reuniao_fumaca.probe_entry(frame, self.pump)
        self.assertEqual((entry["nome"], entry["imagem"], entry["semAcesso"], entry["entrar"]),
                         ("Ana Souza", "ligada", False, True))
        self.assertGreater(entry["largura"], 0)
        said = reuniao_fumaca.read_messages(self.page)
        self.assertEqual(said["mensagens"], ["pronta", "estado:entrada"])
        self.assertIs(said["microfone"], True)
        self.assertEqual(said["csp"], [])
        self.assertEqual(reuniao_fumaca.probe_media(frame), {"faixas": ["audio:live", "video:live"]})
        self.assertIs(reuniao_fumaca.probe_speaker(frame).get("ok"), True)
        self.assertEqual(reuniao_fumaca.probe_screen(frame, self.pump).get("faixa"), "live")
        reuniao_fumaca.close_meeting(self.page)
        self.assertEqual([f.url for f in self.page.frames if f.url.startswith(reuniao_local.CHAT_ORIGIN)], [])
        # O quadro de fora, quem recusa aqui é a regra de segurança da página do app (os dois do chat são do Windows).
        self.assertIs(reuniao_fumaca.probe_refused_frames(self.page, reuniao_local.CHAT_ORIGIN, self.code, self.pump)["de_fora"], False)
        errors = [text for kind, text in self.console if kind == "error" and "speaker-selection" not in text]
        self.assertEqual(errors, [])
        log = pathlib.Path(self.chat.log_file).read_text(encoding="utf-8", errors="replace")
        self.assertEqual(reuniao_fumaca.leaks(log, [self.code, self.meeting_pass, "Ana Souza"]), [])
```

O ensaio é o item 13 sem o app: o `LocalChat`, a frente TLS no `127.0.0.1` com a porta livre, e um Chromium do Playwright aberto sem as variáveis de proxy, com `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--disable-features=LocalNetworkAccessChecks` e `--host-resolver-rules=MAP chat.starcloud-starsonic.com.br 127.0.0.1:<a porta da frente>, MAP * ~NOTFOUND` (o nome do chat vai para a frente, e nenhum outro nome existe: o navegador do ensaio não tem como falar com um servidor de verdade), num contexto com o `ignore_https_errors`. Depois do `open_meeting`, o `connections` da frente é maior que 0. A janela de cima é uma página servida pela rota do teste em `https://app.starsonic.local/index.html`: um documento mínimo com a regra de segurança do `windows/ui/index.html` (a `meta` lida do arquivo). O `self.console` junta o tipo e o texto de cada mensagem do console da página e dos erros dela.

- [ ] **Step 2: Ver os testes falharem**

Run: o comando "Os testes da fumaça" da tabela, com o `tests/smoke/test_reuniao_fumaca.py`.
Expected: `ModuleNotFoundError: No module named 'reuniao_fumaca'`.

- [ ] **Step 3: Escrever o `tests/smoke/reuniao_fumaca.py`,** menos o `run_meeting`, e ver os testes passarem (dentro da fila da máquina). Expected: `OK`, sem teste pulado.

- [ ] **Step 4: Escrever o `run_meeting`** e ligá-lo: no `windows_smoke.py`, o `--chat` (sem ele, o `run_smoke` falha logo no começo com "falta o --chat: o programa do chat da fumaca"), a chamada depois do item 11 (`from reuniao_fumaca import run_meeting`, dentro do `run_smoke`, com o `sys.modules[__name__]` como o `smoke`) e o item 13 no texto do alto do arquivo; no `Test-InstalledApp.ps1`, o `-Chat`; no `build.yml`, o job `ui` roda os dois arquivos de teste no passo "Testes das ferramentas da fumaça", e o job `windows` ganha o passo "Baixar o servidor do chat da fumaça" (`actions/download-artifact@v4`, o nome `chat-fumaca-windows`, o caminho `${{ runner.temp }}/chat-fumaca`) e o `-Chat "$env:RUNNER_TEMP\chat-fumaca\starsonic-chat.exe"` no passo da fumaça, que só roda se o artefato veio.

- [ ] **Step 5: Conferir o que dá para conferir aqui**

Run: os testes da fumaça (os dois arquivos), `env -u GITHUB_ACTIONS python3 -m unittest discover -s tests/python`, e `python3 -c "import ast,sys; [ast.parse(open(f, encoding='utf-8').read(), f) for f in sys.argv[1:]]" tests/smoke/windows_smoke.py tests/smoke/reuniao_fumaca.py tests/smoke/reuniao_local.py`.
Expected: `OK` nos dois, e nenhuma saída no terceiro.

- [ ] **Step 6: Commit** (o relatório diz "o item 13 não rodou: só roda no Windows")

```bash
git add -- tests/smoke/reuniao_fumaca.py tests/smoke/test_reuniao_fumaca.py tests/smoke/windows_smoke.py tests/smoke/Test-InstalledApp.ps1 .github/workflows/build.yml README.md
git commit -m "test(windows): a reunião dentro da janela do app, na fumaça" -- tests/smoke/reuniao_fumaca.py tests/smoke/test_reuniao_fumaca.py tests/smoke/windows_smoke.py tests/smoke/Test-InstalledApp.ps1 .github/workflows/build.yml README.md
```

- [ ] **Step 7 (o coordenador): o push, a rodada do `build` e a leitura do resultado.** O `resultado-fumaca.json` (o artefato `capturas-windows` e o registro do job) e o `diagnostico.log` impresso. O que aparecer segue a tabela do portão.

### Task 5: O resultado da prova, e o que fica

O coordenador entrega a esta tarefa um arquivo com os fatos da última rodada (na pasta de trabalho do plano): o `record` inteiro, as linhas do diagnóstico e a decisão de cada linha da tabela do portão.

**Files:**
- Modify: `tests/smoke/reuniao_fumaca.py`, `tests/smoke/test_reuniao_fumaca.py` (a fumaça fica só com a tentativa da tela que capturou; as outras saem)
- Modify: `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md` (uma nota datada na seção 14)
- Modify: `docs/ponte-windows.md` (a seção da Task 2, se uma correção do portão mudou uma regra ou uma linha)

**Interfaces:**
- Consumes: os fatos do coordenador.
- Produces: a nota da spec, que o plano seguinte lê.

- [ ] **Step 1: A fumaça do dia a dia.** O teste `test_each_opening_has_its_arguments` e o `VerdictTest` passam a esperar só a tentativa que capturou; ver falhar; tirar as outras do `meeting_arguments` e do `run_meeting`; ver passar. Se nenhuma capturou (a linha 4 da tabela do portão), o `problems_of` deixa de pedir o `tela.ok` e passa a pedir só as duas linhas da captura no diagnóstico, e o texto do alto do `windows_smoke.py` diz que a captura de verdade é do teste manual.

- [ ] **Step 2: A nota da spec,** na seção 14, depois do item 11: `12. **Nota de <data> (a prova no WebView2 de verdade): o que ela mostrou.**` Uma frase para cada fato, com o número da versão do WebView2 da rodada: a página no quadro e de onde ela veio (privado ou não); como o pedido de permissão de um quadro chega ao aplicativo (qual origem vem no pedido) e qual regra ficou; a captura de tela (o evento, a tentativa que capturou, ou que a máquina não captura); o `setSinkId` e o `speaker-selection` no `allow` (o aviso do console, se houve); e a abertura com a proteção ligada. O item 1 da mesma seção ganha, no fim, "Provado em <data>: a nota 12." ou o que falhou.

- [ ] **Step 3: Conferir e dar commit**

Run: os testes da fumaça e `python3 build/check_source_text.py`. Expected: `OK` e `ok`.

```bash
git add -- tests/smoke/reuniao_fumaca.py tests/smoke/test_reuniao_fumaca.py docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md docs/ponte-windows.md
git commit -m "docs: o que a prova no WebView2 de verdade mostrou" -- tests/smoke/reuniao_fumaca.py tests/smoke/test_reuniao_fumaca.py docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md docs/ponte-windows.md
```

- [ ] **Step 4 (o coordenador): o push e a rodada do `build`,** verde de ponta a ponta. Depois, a revisão de tudo e a entrega do resultado ao responsável, com a captura `reuniao-entrada.png`.

---

## As escolhas deste plano

O que a spec deixou para quem constrói (a seção 16) ou não dizia, para o responsável conferir ao ler:

1. **O app da fumaça fala com o chat pelo nome de sempre.** A máquina do teste leva esse nome a um servidor do chat dela mesma. O app não ganha um gancho de teste para trocar o endereço do chat.
2. **Quem decide é o endereço do documento do quadro,** e não a origem que o WebView2 diz no pedido. Assim a página do app nunca ganha a câmera, mesmo que o WebView2 diga a origem dela num pedido que veio do quadro.
3. **A reprodução automática também vale para o quadro da reunião.** A seção 7.7 da spec fala da câmera e do microfone; a 7.4 entrega ao quadro também a reprodução automática. Negada, o som da reunião poderia ficar mudo, como o toque ficaria.
4. **O perfil do WebView2 não guarda nenhuma resposta nova.** Toda resposta sobre um quadro, e toda recusa, vale só para aquele pedido.
5. **Três linhas novas no diagnóstico para o que foi permitido** (a navegação do quadro, a permissão do quadro e a captura), além das recusas. Elas levam só o servidor, e servem para o suporte ver por que uma reunião não abriu ou ficou sem imagem.
6. **A fumaça põe o quadro na página do app ela mesma.** A vista da reunião de verdade é do plano seguinte, e a fumaça passa a usá-la lá.
7. **A proteção "Local Network Access" ligada é só registrada.** Hoje a Microsoft a mantém desligada no WebView2. O que ela fizer quando ligada entra no plano seguinte como um fato, e não reprova esta prova.

## Depois deste plano

Com o resultado da prova na mão, a entrega 2 segue em dois planos:

- **A página e o servidor do chat, o que ainda devem ao colega:** o chat que reinicia com um colega na reunião (a nota de 24/11 do item 3 da seção 12.1 da spec), os aparelhos (a nota de 24/11 da seção 7.5) e os reparos da entrega 1 que mudam o que a pessoa vê.
- **O app `0.5.0`:** o núcleo, o executável e o instalador; a aba Reuniões; a vista da reunião e a convivência com as ligações; o roteiro do teste manual.
