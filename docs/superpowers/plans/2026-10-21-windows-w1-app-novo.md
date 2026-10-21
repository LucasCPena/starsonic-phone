# Starsonic Phone para Windows W1 (app novo) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versão de teste `0.1.0-rc.1` do Starsonic Phone para Windows: um app novo (Win32 + WebView2) com as telas do canvas aprovado, sobre o motor do Android, com várias contas, Não perturbe, Atender automático, as ligações da 0.2 e a migração da rc.7, instalado e atualizado pelo mesmo canal de hoje.

**Architecture:** O que não depende do Windows fica em C++ portável e é testado no Linux: o motor (`starsonic/phone/SipEngine`, só ganha a escolha de dispositivos de áudio), o controlador de ligações novo (`starsonic/phone/CallController`, tradução do `CallManager.kt` da 0.2) e o núcleo do app de PC (`starsonic/desktop`: lojas em JSON, migração da rc.7, o protocolo da ponte e o orquestrador `DesktopApp`). A interface é um projeto TypeScript + Preact (`windows/ui`) que só desenha o estado e manda comandos, testado com Playwright no Chromium do Linux. O executável Win32 (`windows/app`) junta tudo: a janela com o WebView2, o aviso de ligação, a bandeja, a instância única, os links `tel:`, o DPAPI e o atualizador de hoje.

**Tech Stack:** C++17 (MSVC v143 no Windows, GCC no Linux), doctest, PJSIP 2.17 (pjsua2), nlohmann/json 3.11.3 (cabeçalho único, MIT), SQLite 3 (leitura da rc.7), WebView2 SDK (NuGet `Microsoft.Web.WebView2`, versão fixa), CMake ≥ 3.24, TypeScript 5, Preact 10, esbuild, Playwright (Chromium), axe-core, NSIS 3, Python 3 (registrador falso), GitHub Actions (`ubuntu-24.04` e `windows-2022`).

**Spec:** `docs/superpowers/specs/2026-10-21-starsonic-phone-windows-w1-design.md` (aprovada em 21/10/2026). Vale em tudo o que ela não muda: `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (revisão 1.5) e, para as regras das ligações, `docs/superpowers/specs/2026-10-16-starsonic-phone-android-0.2-design.md`. Visual: o canvas "Starsonic Phone Windows — telas da W1" (claude.ai) e o design system "Starsonic".

## Global Constraints

- **Regras do repositório:** literais C/C++ só em ASCII (`python3 build/check_source_text.py`); nada muda em `microsip/` nem em `android/` (o Android continua verde no CI: o motor é compartilhado); nenhum "MicroSIP" no app novo, no instalador novo nem nos textos; commits direto no `main`, em português, com as duas linhas de atribuição da sessão; nunca branch remota, force push, tag ou release fora da Task 14; `$SCRATCH` = o scratchpad da sessão; nunca ler nem imprimir `$SCRATCH/t11/chave/` ou `$SCRATCH/t11/entrega/`.
- **Onde roda:** C++ portável, Python, Node e Playwright aqui (o Chromium está em `/opt/pw-browsers`; não rodar `playwright install`). O que só compila no Windows (MSVC, WebView2, DPAPI, NSIS) roda no GitHub Actions: o RED é um commit enviado cujo CI falha no teste novo (anotar o id do run no ledger) e o GREEN, o commit seguinte.
- **Plataforma do executável:** Win32 (x86), como hoje: o pjproject e o vcpkg (`x86-windows-static`) do `build/deps.lock` são os mesmos, e o `windows-2022` compila. O `StarsonicPhone.exe`, a pasta `%LOCALAPPDATA%\Starsonic Phone`, as chaves `HKCU\Software\Starsonic Phone` e `...\Uninstall\StarsonicPhone`, a classe de janela `Starsonic Phone` e o `versao.json` não mudam de nome.
- **Versão:** `0.1.0-rc.1` (canal de teste). O `versionText` e o canal vêm do `Build-App`/workflow, como hoje.
- **Pasta de dados:** `%APPDATA%\Starsonic Phone\` com `contas.json`, `contatos.json`, `recentes.json`, `config.json` e `diagnostico.log` (spec 6.6). Gravação atômica (temporário + rename). Senha só cifrada (DPAPI no Windows; nos testes, um cifrador de teste).
- **Perfil:** o `branding/perfil.ini` embutido, lido pelo `ParseProfile` (com `[portas]`); a porta por servidor e o domínio com porta fora da 5060 vêm do `BuildAccount` (revisão 1.5).
- **Ponte (versão 1):** interface → C++ `{"v":1,"cmd":...}`; C++ → interface `{"v":1,"type":"state"|"toast"|"ring",...}`; os comandos e o formato do estado são os da Task 8 (e da spec 6.1). Estado inteiro a cada mudança; a interface pede `{"v":1,"cmd":"ready"}` ao carregar e recebe o estado atual.
- **Visual:** os tokens do design system "Starsonic" com os valores exatos (spec seção 8); Plus Jakarta Sans embutida (o `PlusJakartaSans-Variable.woff2` do design system, OFL); logos oficiais (PNG 2560×777, negativo no cabeçalho e no escuro, principal no Sobre claro); janela de 400×720 (em 100% de escala); telas de ligação e aviso sempre escuros; Ligar/Atender em `cyan` com rótulo `on-cyan`; Desligar/Recusar em `danger` (#d64545) com o rótulo fora do botão; ícones SVG de linha 24×24, traço 2, `currentColor`.
- **Textos exatos (pt-BR):** os da spec do Windows (11.1) e da 0.2 do Android (Global Constraints e 11.1) onde a função já existia — `Servidor (endereço ou IP)`, `Protocolo`, `Ramal`, `Senha`, `Nome da conta (opcional)`, `Entrar`, `Precisa de ajuda? (11) 5060-3000`, `Conectado · <servidor>`, `Ligação de <nome ou número>`, `Em espera`, `Em espera · transferência`, `Consultar`, `Transferir agora`, `Concluir transferência`, `Cancelar`, `Alternar`, `Juntar`, `Separar`, `Conferência`, `<nome ou número> desligou`, `<nome ou número>: <CallEndMessage>`, `O servidor não aceitou a transferência.` — e os novos: `Não perturbe`, `Atender automático`, `Atender automaticamente`, `Depois de <n> segundos tocando`, `Ligação recebida · <conta>`, `Desligar para todos`, `Nova ligação`, `Teclado`, `Recentes`, `Contatos`, `Todas`, `Perdidas · <n>`, `Hoje`, `Ontem`, `Buscar contato`, `Novo contato`, `Salvar contato`, `Editar`, `Remover`, `Adicionar conta`, `Configurações`, `Contas`, `Áudio`, `Microfone`, `Alto-falante`, `Toque`, `Ligações`, `Iniciar com o Windows`, `Sobre`, `Enviar diagnóstico`, `Sair`, `Digite a senha de novo para continuar.`, `A troca de conta fica para o fim da ligação.`, `(desconectado)`.
- **Toque:** gerado na interface por WebAudio, no dispositivo de Toque (`AudioContext.setSinkId`): toque completo = 425 Hz, 1 s ligado e 4 s desligado; bipe de espera = 425 Hz por 0,2 s a cada 3 s. Sem arquivos de som.
- **Dependências novas com versão fixa:** `third_party/nlohmann/json.hpp` 3.11.3 (com o `LICENSE.MIT`); o WebView2 SDK com versão e SHA-256 do `.nupkg` no `build/deps.lock`; o `windows/ui/package-lock.json` com versões exatas (sem `^`), todas publicadas há mais de duas semanas.

## Review Focus

1. **A rc.7 aberta durante a atualização** (o instalador roda com o `StarsonicPhone.exe` antigo ainda aberto, ou o `call_log.db` travado) → o instalador fecha o app antigo como hoje e a migração lê o banco em modo somente leitura; se não conseguir, pula e tenta de novo na próxima abertura, sem perder as contas. Teste `migration retries contacts and calls that could not be read` (Task 7).
2. **O estado chega antes da interface carregar** (uma ligação recebida no instante em que o WebView2 ainda carrega, ou a interface recarrega) → a interface pede `ready` e recebe o estado atual, inclusive a ligação tocando. Teste `ready replays the current state with the ringing call` (Task 8) e `the call screen shows a call that was ringing before the page loaded` (Task 10).
3. **Um link `tel:` com o app já aberto e uma ligação em andamento** → a segunda instância passa o número para a primeira e sai; o número vai para o Teclado (a ligação em andamento não é tocada). Teste `a dial link during a call only fills the keypad` (Task 8).
4. **Dispositivo de áudio escolhido que some** (o headset USB desconectado) → o motor usa o padrão do Windows e as Configurações mostram `(desconectado)`; a escolha fica gravada para quando ele voltar. Teste `a missing audio device falls back to the default and keeps the choice` (Task 8).
5. **Escala de tela de 125% e 150% e troca de tema com o app aberto** → a janela fica com 400×720 em pixels lógicos e a interface troca de tema na hora. Teste `the main screen follows a theme change without reloading` (Task 9) e o item de DPI do teste de fumaça (Task 13).

---

### Task 1: Motor — escolha dos dispositivos de áudio

**Files:**
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`
- Test: `tests/phone/test_engine_register.cpp` (ou um `tests/phone/test_engine_audio.cpp` novo, listado no `tests/phone/CMakeLists.txt`)

**Interfaces:**
- Produces:
  - `struct AudioDevice { int id; std::string name; bool capture; bool playback; };`
  - `std::vector<AudioDevice> SipEngine::AudioDevices() const` — a lista do `AudDevManager` (com o dispositivo nulo nos testes).
  - `bool SipEngine::SetAudioDevices(int captureId, int playbackId)` — `-1` = o padrão do Windows (`PJMEDIA_AUD_DEFAULT_CAPTURE_DEV`/`..._PLAYBACK_DEV`); id que não existe → usa o padrão e devolve false. Com `nullAudio` vale também (fica no dispositivo nulo e devolve true para `-1`).

- [ ] **Step 1: Testes que falham** — `AudioDevices lists at least one device` (com `nullAudio`, a lista não está vazia e todo item tem nome); `SetAudioDevices accepts the defaults and refuses an unknown device` (`SetAudioDevices(-1, -1) == true`; `SetAudioDevices(9999, 9999) == false` e uma ligação depois disso ainda completa contra o registrador falso: `RING 2001`, `Answer`, `Confirmed`).
- [ ] **Step 2:** `cmake --build $SCRATCH/bp && $SCRATCH/bp/phone_tests -tc="*AudioDevices*"` → FAIL (não compila: função não existe).
- [ ] **Step 3: Implementar** pelo `endpoint_->audDevManager()` (`enumDev2`, `setCaptureDev`, `setPlaybackDev`), na thread da API (`apiMutex_` + `RegisterThread`, como as outras funções).
- [ ] **Step 4:** a suíte do motor inteira → PASS (72+ casos); `python3 build/check_source_text.py` → ok.
- [ ] **Step 5: Commit** `feat(phone): escolha do microfone e do alto-falante no motor`.

### Task 2: Controlador de ligações — uma ligação

**Files:**
- Create: `starsonic/phone/CallController.h`, `starsonic/phone/CallController.cpp`, `starsonic/phone/CallEngine.h` (a interface do motor que o controlador usa)
- Create: `tests/phone/test_call_controller.cpp`, `tests/phone/fake_call_engine.h`
- Modify: `tests/phone/CMakeLists.txt` (o controlador e os testes novos, sem pjproject no alvo de teste do controlador: um executável `call_controller_tests` que linka só o núcleo e o controlador)

**Interfaces:**
- Consumes: `CallEndMessage`, `NormalizeDialString`, `ContactDialString` (núcleo); a regra de mensagens e Recentes da 0.2 (`CallManager.kt`, `CallManagerTest.kt`).
- Produces:
  - `class CallEngine` (abstrata) com exatamente: `MakeCall(number) -> int`, `Answer(id)`, `Reject(id)`, `Hangup(id)`, `Activate(id)`, `Join(id, other)`, `Split(id, other)`, `SetHold(id, bool)`, `SetMute(bool)`, `SendDtmf(id, digits)`, `Transfer(id, number)`, `TransferAttended(id, target)`, `CallCount()`; um `SipCallEngine` (em `CallEngine.h`/`.cpp`) que repassa para o `SipEngine`.
  - `struct CallView { int id; std::string number; std::string name; bool incoming; enum Phase {Ringing, Dialing, Active} phase; int64_t activeSinceMs; bool held; };`
  - `struct CallSnapshot { std::optional<CallView> top; std::optional<CallView> second; enum SecondKind {None, Ringing, Held} secondKind; bool muted; bool conference; int64_t conferenceSinceMs; bool consulting; bool colleagueActive; std::string endMessage; };`
  - `struct Recent { std::string number; std::string name; enum Kind {Outgoing, Incoming, Missed} kind; int64_t startMs; int64_t durationMs; };`
  - `class CallControllerListener { OnSnapshot(const CallSnapshot&); OnRecent(const Recent&); OnMissed(const std::string& text); OnRing(RingKind) /* Full, Waiting, Stop */; };`
  - `class Clock { NowMs(); }` e `class Scheduler { Schedule(delayMs, std::function<void()>) -> int; Cancel(int); }` — os dois com versões falsas nos testes (relógio avançado à mão).
  - `class ContactNames { virtual std::optional<std::string> NameFor(const std::string& number) = 0; }`.
  - `CallController(CallEngine&, CallControllerListener&, Clock&, Scheduler&, ContactNames&, std::function<std::string(std::string)> dialRule)`, com os eventos do motor (`OnIncomingCall`, `OnRejectedBusy`, `OnCallState`, `OnTransfer`) e os comandos `Dial(raw) -> bool`, `Answer()`, `Reject()`, `Hangup()`, `Hold(std::optional<bool>)`, `Mute(std::optional<bool>)`, `Dtmf(digits)`, `Transfer(raw) -> bool`, `OnLogout()`. Thread-safe (uma trava, efeitos fora da trava, publicações em ordem — o mesmo modelo do Kotlin).

- [ ] **Step 1: Portar os testes de uma ligação** do `CallManagerTest.kt` para `test_call_controller.cpp`, com o mesmo nome em inglês e as mesmas asserções (Recentes com duração, ordem dos pedidos ao motor, mensagens de 2 s, o "Ligação perdida de <contato ou número>"): toda a parte "uma ligação" — receber/atender/recusar/desistir, fazer/ocupado/não atendeu/falhou, desligar antes do id, espera e retomar, mudo, DTMF, transferência direta (2xx e recusa), logout com uma ligação, o nome do contato no lugar do número. Exclua o que é só do Telecom (operadora, `holdFromTelecom`, `onTelecomFailed`, `incomingPermitted`): anote cada teste excluído e o porquê no relatório.
- [ ] **Step 2:** `cmake --build $SCRATCH/bp --target call_controller_tests && $SCRATCH/bp/call_controller_tests` → FAIL (não compila).
- [ ] **Step 3: Implementar** a tabela de estado e as transições de uma ligação (a classe `Call` interna, `end()`, `record()`, `missed()`, as mensagens de fim pelo `Scheduler`).
- [ ] **Step 4:** a suíte do controlador → PASS; a do motor continua PASS; `check_source_text` ok.
- [ ] **Step 5: Commit** `feat(phone): controlador de ligações em C++ — uma ligação`.

### Task 3: Controlador — duas ligações

**Files:** Modify `starsonic/phone/CallController.{h,cpp}`; Test `tests/phone/test_call_controller.cpp`.

**Interfaces:**
- Produces: `Swap()` (Alternar), `Hangup(int callId)`, a segunda recebida (`SecondKind::Ringing` com `OnRing(Waiting)`), a segunda atendida (a primeira em espera), a volta sozinha ao desligar a ativa, a em espera que cai (`<nome ou número> desligou`), a terceira com 486, `Dial` com uma ligação em andamento (a ativa em espera, `top` = a nova com `Dialing`).

- [ ] **Step 1: Portar os testes de duas ligações** do `CallManagerTest.kt` (a segunda tocando, atendida, recusada, desistindo; Alternar; Desligar com a volta sozinha; a em espera que cai; Nova ligação; a terceira ocupada; a segunda tocando quando a primeira acaba → `OnRing(Full)`; logout com duas) e mais: `the second call rings the waiting beep, not the full ring` (`OnRing(Waiting)` na segunda, `OnRing(Full)` na primeira, `OnRing(Stop)` quando nenhuma toca).
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS (suítes do controlador e do motor).
- [ ] **Step 5: Commit** `feat(phone): controlador — duas ligações, Alternar e a volta sozinha`.

### Task 4: Controlador — consulta e conferência

**Files:** Modify `starsonic/phone/CallController.{h,cpp}`; Test `tests/phone/test_call_controller.cpp`.

**Interfaces:**
- Produces: `Consult(raw) -> bool`, `CompleteTransfer()`, `CancelConsult()`, `Join()`, `Split()`, e no `CallSnapshot` `consulting`, `colleagueActive`, `conference`, `conferenceSinceMs`. Regras da 0.2 (spec 0.2 seções 7.3 e 7.4), com as correções da revisão final da 0.2: Desligar na conferência encerra as duas (`Hangup()` e `Hangup(id)`), e o fim do colega limpa a transferência com consulta pendente.

- [ ] **Step 1: Portar os testes de consulta e conferência** do `CallManagerTest.kt` (concluir 2xx nas duas ordens de BYE, recusa 4xx/6xx, cancelar, o colega não atende, o cliente desliga durante a consulta, Alternar na consulta, Consultar recusado com duas ligações; Juntar, Separar, um sai da conferência, Desligar para todos, `Hangup(id)` de qualquer uma na conferência encerra as duas, Juntar recusado durante a consulta, logout na conferência).
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(phone): controlador — consulta e conferência`.

### Task 5: Controlador — Não perturbe, Atender automático e a troca de conta

**Files:** Modify `starsonic/phone/CallController.{h,cpp}`; Test `tests/phone/test_call_controller.cpp`.

**Interfaces:**
- Produces: `SetDoNotDisturb(bool)`, `SetAutoAnswer(bool enabled, int delayMs)`, `bool HasCalls() const`, `void WhenIdle(std::function<void()>)` (roda já se não há ligação; senão, depois que a última acaba — a troca de conta usa).

- [ ] **Step 1: Testes que falham:**
  - `do not disturb rejects busy and records a missed call without ringing` — com Não perturbe, `OnIncomingCall(1, "3001", "Cliente Teste")` → `Reject(1)` no motor, nenhum `OnRing(Full)`, um `Recent` `Missed` e nenhum `OnMissed` (não há notificação de perdida no Não perturbe; ela só entra nos Recentes).
  - `outgoing calls work with do not disturb on` — `Dial("2003")` → `MakeCall("2003")`.
  - `auto answer answers after the delay` — `SetAutoAnswer(true, 3000)`; recebida → nada até 2 999 ms; em 3 000 ms → `Answer(1)`.
  - `auto answer does not answer a second call` — uma ativa; segunda recebida → nenhum `Answer` depois do tempo; ela toca com `OnRing(Waiting)`.
  - `auto answer is cancelled when the caller gives up` — recebida, desiste em 1 s → o `Scheduler` não chama `Answer`.
  - `do not disturb wins over auto answer` — os dois ligados → `Reject`, nenhum `Answer`.
  - `WhenIdle runs after the last call ends` — com uma ligação, `WhenIdle(f)` não roda; depois do `Disconnected` dela, roda uma vez.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS (todas as suítes do controlador).
- [ ] **Step 5: Commit** `feat(phone): controlador — Não perturbe, Atender automático e a espera da troca de conta`.

### Task 6: Lojas do app de PC (portáveis)

**Files:**
- Create: `third_party/nlohmann/json.hpp` (3.11.3) e `third_party/nlohmann/LICENSE.MIT`
- Create: `starsonic/desktop/Files.h` (`class FileSystem { Read(path) -> optional<string>; WriteAtomic(path, bytes) -> bool; Exists; Rename; }` e uma implementação em memória para testes), `starsonic/desktop/Cipher.h` (`class SecretCipher { Protect(utf8) -> optional<string base64>; Unprotect(base64) -> optional<utf8>; }`)
- Create: `starsonic/desktop/Stores.h`, `starsonic/desktop/Stores.cpp` — `AccountsStore`, `ContactsStore`, `RecentsStore`, `SettingsStore`
- Create: `tests/desktop/CMakeLists.txt`, `tests/desktop/main.cpp`, `tests/desktop/test_stores.cpp`
- Modify: `.github/workflows/build.yml` (o job `core-tests` também compila e roda `tests/desktop`)

**Interfaces:**
- Produces:
  - `struct SavedAccount { std::string id; std::wstring address; Transport transport; std::wstring ramal; std::wstring senha; std::wstring name; };` (`id` estável, gerado na criação)
  - `AccountsStore(FileSystem&, SecretCipher&, path)`: `Load() -> bool`, `All()`, `Active() -> optional<SavedAccount>`, `Save(SavedAccount) -> bool` (inclui e substitui), `Remove(id)`, `SetActive(id)`; no disco a senha só como `senha_protegida` (base64 do cifrador). Senha que não decifra → `senha` vazia e `needsPassword = true` na conta.
  - `struct Contact { std::string id; std::wstring name; std::string number; std::wstring note; };` — `ContactsStore`: `All()` (ordem alfabética sem acento e sem caixa), `Save`, `Remove`, `Search(text)` (nome ou número contém), `NameFor(number)` (pelo número normalizado).
  - `RecentsStore`: `Add(Recent)` (as 500 mais novas), `All()` (mais nova primeiro), `MissedCount(sinceMs)`.
  - `struct Settings { int captureDevice = -1; int playbackDevice = -1; std::string ringDeviceId; bool doNotDisturb = false; bool autoAnswer = false; int autoAnswerSeconds = 3; bool startWithWindows = true; int windowX = INT_MIN, windowY = INT_MIN; std::string captureName, playbackName; };` — `SettingsStore` `Load`/`Save`; `autoAnswerSeconds` limitado a 0–30.
  - Formatos JSON: um objeto com `"versao": 1` e a lista; UTF-8; chaves em português como no disco do Android (`servidor`, `protocolo`, `ramal`, `senha_protegida`, `nome`, `em_uso`; `nome`, `numero`, `observacao`; `numero`, `nome`, `tipo` (`feita`|`recebida`|`perdida`), `inicio`, `duracao`).

- [ ] **Step 1: Testes que falham** (`tests/desktop/test_stores.cpp`, com o `FileSystem` em memória e um cifrador de teste que inverte os bytes e põe um prefixo): `accounts keep the password only protected on disk` (o JSON gravado não contém a senha); `an account whose password does not decrypt asks for it` (`needsPassword`); `the active account survives a reload`; `removing the active account leaves none active`; `contacts are sorted ignoring accents and case` (`Álvaro`, `ana`, `Bruno`); `contacts search by name and number`; `recents keep the newest 500`; `settings clamp auto answer seconds to 0..30`; `a corrupt file loads as empty and is not overwritten until the next save` (`Load` devolve false; o arquivo continua igual até um `Save`).
- [ ] **Step 2:** `cmake -S tests/desktop -B $SCRATCH/bd && cmake --build $SCRATCH/bd && $SCRATCH/bd/desktop_tests` → FAIL.
- [ ] **Step 3: Implementar** com o nlohmann/json; `WriteAtomic` grava `<path>.tmp` e renomeia.
- [ ] **Step 4:** → PASS; `check_source_text` ok.
- [ ] **Step 5: Commit** `feat(desktop): lojas de contas, contatos, recentes e configurações`.

### Task 7: Migração da rc.7

**Files:**
- Create: `starsonic/desktop/LegacyImport.h`, `starsonic/desktop/LegacyImport.cpp` (portável: o `.ini`, os bancos SQLite e a regra), `starsonic/win/LegacyCrypto.h`, `starsonic/win/LegacyCrypto.cpp` (Windows: a rotina `IniDecrypt` do MicroSIP reescrita sobre a CryptoAPI pura, sem MFC, com o aviso de copyright do MicroSIP)
- Test: `tests/desktop/test_legacy_import.cpp`; `tests/win/test_legacy_crypto.cpp` (Windows, no job `windows`: cifra com o `MFC::CCrypto` original de `microsip/lib/Crypto.cpp` e decifra com o novo; e o inverso não é preciso)
- Modify: `tests/desktop/CMakeLists.txt` (linka o SQLite 3: no Linux `libsqlite3-dev`, instalado no job; no Windows, o do vcpkg)
- Modify: `docs/superpowers/specs/2026-10-21-starsonic-phone-windows-w1-design.md` (7.1 e 11.2: os contatos e o histórico da rc.7 estão em `contacts.db` e `call_log.db`, SQLite, não em `Contacts.xml`)

**Interfaces:**
- Consumes: `AccountsStore`, `ContactsStore`, `RecentsStore` (Task 6); `AddressFromServer`, `ValidateServerAddress`, `TransportFromName` (núcleo).
- Produces:
  - `struct LegacyImportResult { int accounts; int accountsWithoutPassword; bool contactsDone; bool callsDone; };`
  - `LegacyImportResult ImportLegacy(const LegacyPaths& paths, std::function<std::optional<std::wstring>(const std::wstring& encrypted)> decrypt, AccountsStore&, ContactsStore&, RecentsStore&, FileSystem&)` — `LegacyPaths { ini; contactsDb; callsDb; }`. Lê `[Account1]`…`[AccountN]` (`server`, `transport`, `username`, `password`, `label`) e `[Settings] accountId` (a em uso); os bancos em modo somente leitura (`SQLITE_OPEN_READONLY`); renomeia cada arquivo lido com sucesso para `<nome>.migrado`; o que falhou fica para a próxima abertura (o `contas.json` grava `migracao_pendente` com o que falta).
  - `std::optional<std::wstring> LegacyDecrypt(const std::wstring& encrypted)` (Windows).

- [ ] **Step 1: Testes que falham** (portáveis, com um `decrypt` de teste e os bancos criados no teste com o esquema do MicroSIP 3.22 — `call_log(id, callId, number, name, type, time, duration, info)` e a tabela `contacts` que o `Data/ContactsRepository.cpp` cria; o implementador lê o esquema exato lá): `two accounts migrate with the active one in use` (servidor sem a porta, protocolo, ramal, nome do `label` quando não é o rótulo automático, a senha decifrada); `an account whose password does not decrypt migrates without it`; `contacts and calls migrate from the databases` (tipos do `call_log` mapeados para feita/recebida/perdida); `migrated files are renamed and not read again`; `migration retries contacts and calls that could not be read` (banco travado/ilegível → contas migradas, `migracao_pendente` com o resto; numa segunda chamada com o banco legível, termina); `a missing ini means nothing to migrate`.
- [ ] **Step 2:** → FAIL (Linux). **Step 3:** implementar o portável. **Step 4:** → PASS.
- [ ] **Step 5 (Windows, RED → GREEN no CI):** `tests/win/test_legacy_crypto.cpp` — `LegacyDecrypt reads what MicroSIP encrypted` (cifra `"senha-123 çã"` com o `IniEncrypt` original e decifra com o novo) — no job `windows` do `build.yml`, num executável de teste com MFC só para o lado original. Commit RED com o teste, GREEN com o `LegacyCrypto.cpp`.
- [ ] **Step 6: Commits** `feat(desktop): migração das contas, dos contatos e dos recentes da rc.7` e `feat(win): decifra a senha gravada pela rc.7`.

### Task 8: Núcleo do app de PC — orquestrador e protocolo da ponte

**Files:**
- Create: `starsonic/desktop/Protocol.h`, `starsonic/desktop/Protocol.cpp` (comandos ↔ JSON, estado → JSON), `starsonic/desktop/DesktopApp.h`, `starsonic/desktop/DesktopApp.cpp`
- Create: `docs/ponte-windows.md` (o protocolo v1: cada comando e cada campo do estado, com exemplo)
- Test: `tests/desktop/test_protocol.cpp`, `tests/desktop/test_desktop_app.cpp` (com o `FakeCallEngine` da Task 2 e um motor de registro falso)

**Interfaces:**
- Consumes: `CallController` (Tasks 2–5), as lojas (Task 6), `ImportLegacy` (Task 7), `ParseProfile`/`BuildAccount`/`ValidateServerAddress`/`ValidateRamal`/`RegistrationErrorMessage` (núcleo).
- Produces:
  - `class RegistrationPort` (abstrata): `SetAccount(AccountInput) -> int`, `RemoveAccount()`, `AudioDevices()`, `SetAudioDevices(c, p)` — o `SipEngine` real a implementa por um adaptador.
  - `class DesktopApp` com `HandleCommand(const std::string& json)`, os eventos do motor (`OnRegistration`, `OnIncomingCall`…) e um `std::function<void(const std::string& json)> post` para a interface. Responsável por: estado de registro e mensagens de Entrar (as da spec do Windows 7.1/11.1); contas (salvar a partir da tela Entrar com as validações do núcleo, trocar com `WhenIdle` e o aviso `A troca de conta fica para o fim da ligação.`, remover); repassar ligações ao `CallController`; Recentes, contatos e configurações; Não perturbe e Atender automático gravados no `config.json`; `dialLink(number)` (o link `tel:`) que só preenche o Teclado.
  - Comandos (todos com `"v":1`): `ready`, `login {servidor, protocolo, ramal, senha, nome, contaId?}`, `selectAccount {contaId}`, `removeAccount {contaId}`, `dial {numero}`, `answer`, `reject`, `hangup {id?}`, `hold {on?}`, `mute {on?}`, `dtmf {digitos}`, `transfer {numero}`, `consult {numero}`, `completeTransfer`, `cancelConsult`, `swap`, `join`, `split`, `setDnd {on}`, `setAutoAnswer {on, segundos?}`, `saveContact {id?, nome, numero, observacao}`, `removeContact {id}`, `setAudio {microfone, altoFalante, toque}`, `setSetting {chave, valor}` (só `iniciarComWindows`), `openExternal {url}` (só `https://starsonic.com.br`, `https://wa.me/551150603000`, `tel:+551150603000` e o link do código-fonte), `sendDiagnostics`, `minimize`, `closeToTray`, `quit`. Comando desconhecido ou com campo errado → ignorado, com uma linha no diagnóstico.
  - Estado (`{"v":1,"type":"state","state":{...}}`): `tela` (`entrar` | `principal`), `entrar {servidor, protocolo, ramal, nome, erro, ocupado, pedeSenha}`, `conta {id, nome, ramal, servidor, protocolo, status ("conectado"|"conectando"|"sem_conexao"|"erro"), texto}`, `contas [{id, nome, ramal, servidor, protocolo, emUso}]`, `naoPerturbe`, `atenderAutomatico {on, segundos}`, `ligacao` (o `CallSnapshot` em JSON, com nomes já resolvidos e `null` sem ligação), `recentes [...]`, `perdidas` (a contagem desde a última visita aos Recentes), `contatos [...]`, `audio {microfones [{id, nome}], altoFalantes [...], microfone, altoFalante, toque, desconectados [...]}`, `iniciarComWindows`, `versao`, `teclado` (o número posto por um link). Avisos: `{"type":"toast","texto"}`; toque: `{"type":"ring","tipo":"completo"|"espera"|"parar"}`.

- [ ] **Step 1: Testes que falham:**
  - `test_protocol.cpp`: cada comando acima com um JSON válido vira o comando certo; `"v":2`, comando desconhecido e campo de tipo errado → nada; o estado vazio serializa com todas as chaves.
  - `test_desktop_app.cpp`: `ready replays the current state with the ringing call`; `login with a port in the address shows the address message` (`Digite só o endereço do servidor, como starcloud1-starsonic.com.br.`); `a successful login saves the account and shows the main screen`; `switching accounts during a call waits for the end and shows the notice`; `do not disturb survives a restart` (gravado no `config.json`, lido por um `DesktopApp` novo); `a dial link during a call only fills the keypad`; `a missing audio device falls back to the default and keeps the choice`; `openExternal refuses other urls`; `the first start migrates the rc.7 and logs in the active account`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS (suítes desktop e controlador).
- [ ] **Step 5: Commit** `feat(desktop): o orquestrador do app de PC e o protocolo da ponte`.

### Task 9: Interface — projeto, marca e telas fora da ligação

**Files:**
- Create: `windows/ui/package.json`, `windows/ui/package-lock.json`, `windows/ui/tsconfig.json`, `windows/ui/build.mjs` (esbuild: `src/main.tsx` → `dist/app.js`, `src/aviso.tsx` → `dist/aviso.js`; copia `index.html`, `aviso.html`, `app.css`, fontes e imagens para `dist/`)
- Create: `windows/ui/src/` — `bridge.ts` (envia comandos; recebe `state`/`toast`/`ring`; com `window.chrome?.webview` ausente usa a ponte falsa de `?fake=<cenario>`), `state.ts` (os tipos do estado da Task 8), `icons.tsx` (os ícones do canvas), `app.css` (os tokens e os componentes do canvas `project/app.css`, com `prefers-color-scheme`), `main.tsx`, `screens/Entrar.tsx`, `screens/Teclado.tsx`, `screens/Recentes.tsx`, `screens/Contatos.tsx`, `screens/Configuracoes.tsx`, `screens/Sobre.tsx`, `components/` (barra de título com `app-region: drag`, cabeçalho, navegação)
- Create: `windows/ui/assets/` — `PlusJakartaSans-Variable.woff2` + `OFL.txt` (do design system), `starsonic-logo-negativo.png`, `starsonic-logo-principal.png` (os oficiais, do design system)
- Create: `windows/ui/tests/fake-scenarios.ts`, `windows/ui/tests/screens.spec.ts`, `windows/ui/playwright.config.ts`
- Modify: `.github/workflows/build.yml` (job `ui` em `ubuntu-24.04`: `npm ci`, `npm run build`, `npx playwright install chromium --with-deps`, `npx playwright test`, as capturas como artefato `capturas-interface`); `build/check_source_text.py` só se precisar ignorar `windows/ui/node_modules`

**Interfaces:**
- Consumes: o protocolo da Task 8 (`docs/ponte-windows.md`); o canvas (as medidas, cores e textos de cada tela).
- Produces: `dist/index.html` + `dist/app.js` + `dist/app.css` + assets, sem nenhum recurso de rede (nenhum `http` no `dist/`, conferido no teste); cenários falsos `entrar`, `entrar-erro`, `principal`, `recentes`, `contatos`, `configuracoes`, `sobre`, `nao-perturbe`.

- [ ] **Step 1: Testes que falham** (`screens.spec.ts`, viewport 400×720, temas `light` e `dark` por `colorScheme`): cada tela do cenário mostra os textos exatos das Global Constraints e envia os comandos certos (Teclado: digitar `2003` pelos botões e por teclado físico, Enter → `dial {numero: "2003"}`; Ctrl+2 → Recentes; Entrar → `login` com os campos; Não perturbe → `setDnd {on: true}`; Contatos `+` → formulário → `saveContact`); `the main screen follows a theme change without reloading` (muda `colorScheme` e o fundo do corpo passa de `#ffffff` para `#0a1330`); `the bundle loads nothing from the network`; `axe finds no serious violations` em cada tela; uma captura por tela e tema em `test-results/capturas/`.
- [ ] **Step 2:** `cd windows/ui && npm ci && npm run build && npx playwright test` → FAIL.
- [ ] **Step 3: Implementar** as telas a partir do canvas (o `project/app.css` e as `.dc.html` do canvas são a referência; leia-os com a ferramenta Artifact `read` do canvas `https://claude.ai/artifact/WNj4P5pwgg8BCj8bLk1hBv`).
- [ ] **Step 4:** → PASS; compare as capturas com o canvas (anote no relatório o que diverge e por quê).
- [ ] **Step 5: Commit** `feat(windows): interface nova — Entrar, Teclado, Recentes, Contatos, Configurações e Sobre`.

### Task 10: Interface — telas de ligação, aviso e toque

**Files:** Create `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/aviso.tsx`, `windows/ui/aviso.html`, `windows/ui/src/ring.ts`; Modify `windows/ui/src/main.tsx`, `windows/ui/tests/fake-scenarios.ts`; Test `windows/ui/tests/call.spec.ts`.

**Interfaces:**
- Produces: a tela da ligação (uma, com a segunda tocando, duas, consulta, conferência) pelo `ligacao` do estado; o aviso (`aviso.html`, 380×168) com `answer`/`reject`; `ring.ts` (WebAudio 425 Hz nas cadências das Global Constraints, `setSinkId` com o `toque` das configurações; sem permissão de áudio, toca no padrão); cenários `ligacao`, `ligacao-segunda`, `consulta`, `conferencia`, `aviso`, `tocando-antes-de-carregar`.

- [ ] **Step 1: Testes que falham:** os textos e botões de cada cenário (Mudo → `mute`, Espera → `hold`, Transferir → número → `Transferir agora`/`Consultar`, `Concluir transferência` → `completeTransfer`, Alternar → `swap`, Juntar → `join`, Separar → `split`, Desligar → `hangup`, a faixa da segunda → `answer`/`reject`); `the call screen shows a call that was ringing before the page loaded` (o cenário só responde ao `ready`); `the ring follows the ring messages` (`completo` cria o oscilador de 425 Hz, `parar` o encerra; o relógio do teste é falso); o tempo da ligação conta a partir de `activeSinceMs`; o aviso cabe em 380×168 nos dois temas; axe sem violações sérias.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS (todas as specs do Playwright).
- [ ] **Step 5: Commit** `feat(windows): telas de ligação, aviso de ligação recebida e toque`.

### Task 11: Executável Win32 — janela, WebView2 e o motor

**Files:**
- Create: `windows/app/CMakeLists.txt`, `windows/app/src/main.cpp`, `windows/app/src/MainWindow.{h,cpp}` (janela sem moldura 400×720 lógicos, DPI por monitor v2, sombra e cantos do Windows 11, região de arrastar e botões da barra pela interface), `windows/app/src/WebViewHost.{h,cpp}` (cria o ambiente do WebView2 em `%LOCALAPPDATA%\Starsonic Phone\WebView2`, `SetVirtualHostNameToFolderMapping("app.starsonic.local", <pasta ui>)`, bloqueia navegação fora do host, liga `postMessage` ↔ `DesktopApp`), `windows/app/src/DpapiCipher.{h,cpp}` (o `SecretCipher` com `CryptProtectData`, escopo do usuário), `windows/app/src/WinFiles.{h,cpp}` (o `FileSystem` com `MoveFileExW(MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)`), `windows/app/src/EngineHost.{h,cpp}` (o `SipEngine` real como `CallEngine` + `RegistrationPort`, eventos para o `DesktopApp`, User-Agent `Starsonic Phone/<versão>`), `windows/app/src/DiagLog.{h,cpp}` (o `diagnostico.log`: linhas do app e do motor com data e hora, sem senhas, até 1 MB com uma cópia `.1`), `windows/app/res/app.rc` (ícone, versão, manifesto com DPI e Common Controls 6); a janela grava a posição no `config.json` e volta para o monitor principal se a posição ficar fora da tela
- Create: `build/Build-Windows.ps1` (CMake + MSBuild do app, copia `windows/ui/dist` para a pasta de saída `ui\`)
- Modify: `build/Build-Deps.ps1` (compila também o `pjsua2_lib` do `pjproject-vs14.sln`; baixa o `Microsoft.Web.WebView2.<versão>.nupkg` do nuget.org, confere o SHA-256 do `deps.lock` e extrai `build/native/include` e `build/native/x86/WebView2LoaderStatic.lib`), `build/deps.lock` (`webview2 {version, sha256}`), `.github/workflows/build.yml` (o job `windows` compila o app novo depois da interface — artefato `ui-dist` do job `ui` — e roda os testes do núcleo e do desktop no Windows)

**Interfaces:**
- Consumes: `DesktopApp` (Task 8), `SipEngine` (Task 1), `windows/ui/dist` (Tasks 9–10).
- Produces: `StarsonicPhone.exe` que abre a interface, registra, liga e atende; o argumento `--dados <pasta>` (pasta de dados alternativa, para testes) e a variável `STARSONIC_PERFIL` (texto de um perfil de teste, só em build de teste — `STARSONIC_TEST_HOOKS`) para apontar ao registrador falso.

- [ ] **Step 1 (RED no CI):** `tests/win/test_dpapi_cipher.cpp` (`DPAPI round trip and refusal of tampered data`) e `tests/win/test_win_files.cpp` (`WriteAtomic replaces the file and leaves no temporary`) no job `windows`; o app ainda não existe → o CMake do teste falha por falta dos arquivos. Anote o run.
- [ ] **Step 2 (GREEN no CI):** implementar; os dois testes passam; o app compila (`build/Build-Windows.ps1`); um passo do job abre o `StarsonicPhone.exe --dados <temp>` por 15 s, confere que a janela de classe `Starsonic Phone` existe e que o `diagnostico.log` tem a linha `interface pronta` (vinda do `ready`), e fecha com `quit` (pela linha de comando `--sair`, que manda a mensagem para a instância aberta).
- [ ] **Step 3: Commits** `test(win): DPAPI e gravação atômica` (RED) e `feat(windows): executável novo com o WebView2 e o motor` (GREEN).

### Task 12: Executável — aviso, bandeja, instância única, links, início com o Windows e atualizador

**Files:**
- Create: `windows/app/src/NoticeWindow.{h,cpp}` (o aviso 380×168 no canto inferior direito do monitor da janela principal, `WS_EX_TOPMOST|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW`, com o seu WebView2 em `aviso.html`; aparece quando há ligação tocando e a janela principal não está em primeiro plano), `windows/app/src/Tray.{h,cpp}` (ícones de estado: conectado, sem conexão, Não perturbe, perdida — refeitos no estilo novo em `windows/app/res/`; menu Abrir, Não perturbe, Sair), `windows/app/src/SingleInstance.{h,cpp}` (mutex `Local\StarsonicPhone`; a segunda instância manda os argumentos por `WM_COPYDATA` e sai), `windows/app/src/Links.{h,cpp}` (`tel:`, `sip:`, `callto:` → `DesktopApp::DialLink`), `windows/app/src/Autostart.{h,cpp}` (`HKCU\...\Run` valor `Starsonic Phone` = `"<exe>" --bandeja`), `windows/app/src/Diagnostics.{h,cpp}` (`sendDiagnostics`: copia o `diagnostico.log` para `%TEMP%\Starsonic Phone diagnostico <data>.log` e abre o Explorer com ele selecionado, para a pessoa anexar no e-mail ou no WhatsApp)
- Modify: `starsonic/win/Updater.{h,cpp}`, `starsonic/win/Http.cpp`, `starsonic/win/TlsWatch.cpp` (sem MFC: o `Updater` recebe uma interface `UpdateUi { Ask(versao, notas) -> bool; Busy() -> bool; Show(texto); }` no lugar do `CmainDlg*`; o MicroSIP antigo continua compilando com um adaptador em `starsonic/win/Hooks.cpp`), `windows/app/src/main.cpp`
- Test: `tests/win/test_single_instance.cpp`, `tests/win/test_links.cpp` (Windows CI); os testes do atualizador que já existem continuam passando no Linux e no Windows

**Interfaces:**
- Produces: `UpdateUi` (o app novo mostra a pergunta de atualização como um aviso dentro da interface: `{"type":"update","versao","notas"}` e os comandos `updateNow`/`updateLater` — acrescentar ao protocolo e ao `docs/ponte-windows.md`); a mensagem "Termine a chamada para atualizar." quando há ligação.

- [ ] **Step 1 (RED no CI):** `ParseLinkArgument maps tel, sip and callto to a number` (`tel:+55 11 5060-3000` → `+551150603000`, `sip:2003@starcloud1-starsonic.com.br` → `2003`, `callto:2003` → `2003`, o resto → nada); `a second instance hands its arguments to the first` (duas instâncias no teste: a segunda devolve "entregue" e a primeira recebe `tel:2003`).
- [ ] **Step 2 (GREEN):** implementar; o passo de fumaça da Task 11 ganha: abrir `StarsonicPhone.exe tel:2003` com a instância aberta → o `diagnostico.log` tem `link recebido` e a segunda sai com código 0.
- [ ] **Step 3: Commits** `test(win): links e instância única` e `feat(windows): aviso, bandeja, links, início com o Windows e atualizador no app novo`.

### Task 13: Instalador novo, teste de fumaça com ligação e conferência de marca

**Files:**
- Modify: `installer/StarsonicPhone.nsi` (páginas no visual do canvas: `branding/installer/lateral.bmp` 164×314 e a cabeçalho, desenhadas a partir do logo negativo e do `gradient-hero` por um script em `branding/fontes/`; o bootstrapper Evergreen do WebView2 — `MicrosoftEdgeWebview2Setup.exe`, com SHA-256 no `deps.lock` — roda em `/silent /install` quando a chave `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` (ou a de `HKCU`) não tem `pv`; sem internet, a mensagem da spec 11.1; a pasta `ui\` instalada junto; os mesmos `RunAtSystemStartup`/`Run`, links `tel:`/`sip:`/`callto:` como hoje; desinstala o MicroSIP antigo só no que o instalador novo não sobrescreve), `build/Build-Installer.ps1`, `build/check_branding.py` (confere o app novo: nenhum "MicroSIP" no `StarsonicPhone.exe`, na pasta `ui\` e no instalador)
- Create: `tests/smoke/windows_smoke.py` (abre o app com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, liga o Playwright pelo CDP, entra no registrador falso por UDP com o perfil de teste, liga para `2002`, confere `Em ligação`, desliga, recebe um `RING`, confere o aviso, atende pelo aviso, e tira as capturas `janela-principal.png` e `ligacao.png`; roda também com a escala de 150% via `--force-device-scale-factor=1.5` e confere que a janela tem 400×720 lógicos)
- Modify: `.github/workflows/build.yml` (o job `windows`: gera o instalador, instala em silêncio num diretório temporário, roda o `windows_smoke.py` e guarda as capturas como artefato `capturas-windows`), `.github/workflows/release.yml` (publica o instalador novo; o resto igual)

**Interfaces:**
- Consumes: tudo das Tasks 9–12; `tests/smoke/fake_registrar.py`.
- Produces: `StarsonicPhone-<versão>-setup.exe` novo e as capturas reais do Windows a cada build.

- [ ] **Step 1 (RED no CI):** o `windows_smoke.py` e o `check_branding.py` novos entram sem o instalador novo → o job `windows` falha no passo de fumaça. Anote o run.
- [ ] **Step 2 (GREEN):** o instalador novo; a fumaça passa; as capturas saem no artefato.
- [ ] **Step 3: Ensaio da atualização** (no CI, um passo só no `workflow_dispatch` com `ensaio-atualizacao=true`): instala a `v0.0.1-rc.7` do release, grava uma conta e um contato no `.ini`/bancos dela por linha de comando do MicroSIP (ou copiando um `StarsonicPhone.ini` de teste com a senha cifrada pela rotina original), instala o novo por cima e confere que o app novo abre `Conectado` no registrador falso e com o contato.
- [ ] **Step 4: Commits** `test(windows): fumaça com o app novo e o registrador falso` (RED) e `feat(windows): instalador novo com o WebView2` (GREEN).

### Task 14: Documentação, revisão final e a versão de teste 0.1.0-rc.1

**Files:**
- Modify: `docs/teste-manual.md` (reescrito para o app novo: spec 11.3, com as telas do canvas e os dois servidores), `README.md` (seção do Windows: o app novo, como compilar `windows/app` e `windows/ui`, a ponte), `docs/superpowers/specs/2026-10-21-starsonic-phone-windows-w1-design.md` (Status: implementada, e uma seção "Como ficou" com as divergências), `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (uma linha no topo: substituída pela W1 a partir da 0.1.0), `docs/build-notes.md` (o que precisou de ajuste no build novo)
- Test: os workflows `build` e `release`

- [ ] **Step 1: Revisão final** — pacote de revisão do `main` desde o commit anterior à Task 1 e o revisor no modelo mais capaz; uma rodada de correções com RED→GREEN; os menores no ledger.
- [ ] **Step 2: Documentação.** Commit `docs(windows): roteiro manual do app novo, README e o status da spec`.
- [ ] **Step 3: A versão** — `gh workflow run release.yml --ref main -f versao=0.1.0-rc.1` (o push de tag pelo proxy não funciona); o `release` publica a `v0.1.0-rc.1` e atualiza o `canal-teste`. Conferir como na rc.7: o release, o `versao.json` do canal e o SHA-256 do instalador baixado. Expected: tudo confere, e `releases/latest` continua sem nada que não seja estável.
- [ ] **Step 4: Entrega** — a lista de rulings e de menores deferidos, o link do instalador, as capturas reais do Windows, e o que fica com a Starsonic: o teste manual (Windows 10 sem WebView2 e Windows 11), o ensaio da atualização de uma rc.7 com duas contas e contatos, e os dois ramais de teste.
