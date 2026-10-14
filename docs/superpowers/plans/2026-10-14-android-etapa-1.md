# Starsonic Phone para Android, etapa 1 — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um APK de teste do Starsonic Phone para Android (0.1.0-rc.1): tela Entrar igual à do Windows, conectado em segundo plano com notificação fixa, ligações feitas e recebidas com o app fechado, marca da Starsonic, atualização pelo app e publicação pelo GitHub.

**Architecture:** O motor de ligações é C++ sobre o PJSIP 2.17 (pjsua2) em `starsonic/phone`, sem nada de Android, testado no Linux contra o registrador SIP falso. O núcleo `starsonic/core` (já usado no Windows) dá as regras da tela Entrar, do perfil, das mensagens e do arquivo de versão. O app Android (`android/`, Kotlin + Jetpack Compose) chama os dois por uma ponte JNI, mantém o registro num serviço em primeiro plano e integra as ligações ao Android (Telecom, modo self-managed). Tudo que é Android compila e roda no GitHub Actions, com um emulador para os testes de fumaça.

**Tech Stack:** C++14 (g++ no Linux, clang do NDK), doctest, PJSIP 2.17 (pjsua2), Opus, Oboe, Kotlin, Jetpack Compose (Material 3), Android Gradle Plugin, Python 3, GitHub Actions (emulador com KVM).

**Spec:** `docs/superpowers/specs/2026-10-14-starsonic-phone-android-design.md` (aprovada em 14/10/2026). Regras herdadas: `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (seções 7.1, 7.4 e 11.1).

## Global Constraints

- **Versões fixas** (em `build/deps.lock`, chave `android`): pjproject 2.17, commit `5a457451fa2712ba18e12b01738e8ff3af2b26fd` (o mesmo do Windows); Opus `v1.6.1`; Oboe `1.11.0` (AAR `com.google.oboe:oboe:1.11.0`); NDK `30.0.16248370`; Android Gradle Plugin `9.4.0`; Gradle `9.6.0`; plugin do compilador do Compose `org.jetbrains.kotlin.plugin.compose` `2.4.21`; Compose BOM `2026.09.00`; JDK 17. Uma versão que não resolver no CI → usar a disponível mais próxima e registrar um `Ruling` no ledger.
- **Android:** `minSdk 28`, `targetSdk 36`, `compileSdk 36`; ABIs `arm64-v8a`, `armeabi-v7a` e `x86_64`; STL `c++_shared`; bibliotecas nativas alinhadas a 16 KB (segmentos `LOAD` com alinhamento ≥ 16384). Emulador dos testes: API 34, `google_apis`, `x86_64`.
- **Identidade:** `applicationId` e `namespace` = `br.com.starsonic.phone`; nome do app (`application android:label`) = `Starsonic Phone`; nome no ícone (label da activity de entrada) = `Starsonic`; User-Agent = `Starsonic Phone Android/<versionName>`.
- **Marca:** azul `#383881`, ciano `#3DB1CC`; Ligar e Atender em verde, Recusar e Desligar em vermelho; faixa com `branding/logo-faixa.png`; Entrar com `branding/logo-entrar.png`; ícone a partir da geometria de `branding/fontes/gerar_marca.py`.
- **Links:** site `https://starsonic.com.br/`; WhatsApp `https://wa.me/551150603000`; suporte `(11) 5060-3000` (discar `tel:+551150603000`); código-fonte `https://github.com/LucasCPena/starsonic-phone`.
- **Textos exatos (pt-BR):**
  - Entrar: `Servidor (endereço ou IP)`, `Protocolo`, `UDP`, `TCP`, `Ramal`, `Senha`, `Entrar`, `Precisa de ajuda? (11) 5060-3000`; mensagens de validação e de registro vêm do núcleo (`ValidateServerAddress`, `ValidateRamal`, `RegistrationMessage`) com os textos da tabela 11.1 do Windows; senha vazia → `Digite a senha.`
  - Status: `Conectado · <ramal>`, `Conectando…`, `Sem internet`, ou a mensagem do núcleo para o código da falha.
  - Notificação fixa: título `Conectado (ramal <ramal>)` (ou `Conectando…`, `Sem internet`, a mensagem da falha); o cabeçalho mostra `Starsonic Phone`.
  - Ligação: `Atender`, `Recusar`, `Mudo`, `Teclado`, `Viva-voz`, `Celular`, `Bluetooth`, `Espera`, `Retomar`, `Transferir`, `Desligar`, `Ligar`; abas `Teclado` e `Recentes`; menu `Editar conta`, `Sair da conta`, `Sobre`.
  - Ligação não completada (`CallEndMessage`): 486 e 600 → `Ocupado`; 404, 484 e 604 → `Número não encontrado`; 408 e 480 → `Não atendeu`; outros 4xx–6xx → `Não foi possível completar a ligação (código <n>).`; 0, 200 e 487 → nada.
  - `Sem conexão com o servidor. Tente de novo em instantes.`; `Ligação perdida de <número>`.
  - Faixa: `Permita as notificações para receber ligações.`, `Permita o microfone para fazer e receber ligações.`, `Permita a tela cheia para ver as ligações com o celular bloqueado.`, `Libere o uso de bateria para receber ligações com o app fechado.` (nessa ordem de prioridade; um aviso por vez, com botão `Abrir ajustes`).
  - Atualização: `Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?`, `Termine a chamada para atualizar.`, `Não foi possível baixar a atualização. Tentaremos de novo mais tarde.`
  - Sobre: `Starsonic Phone <versionName>`, `Licença GPL v3`, `Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD).`, `Enviar diagnóstico`.
- **Valores do motor:** espera do Entrar 15 s (`LoginFlow`); renovação do registro 300 s; keep-alive UDP = `keepalive` do perfil; `srtpSecureSignaling = 0`, ICE desligado, sem reescrita de Contact/Via/SDP (como o MicroSIP); cancelador de eco do PJSIP desligado (`ecTailLen = 0`) — o eco fica com o do aparelho (Oboe com `VoiceCommunication`); uma ligação por vez (a segunda recebe 486).
- **Dados:** Recentes até 200; log de diagnóstico até 1 MB, sem senha.
- **Atualização:** canais `https://github.com/LucasCPena/starsonic-phone/releases/download/canal-android/versao-android.json` (estável) e `.../canal-teste-android/versao-android.json` (versões `-rc`); o `instalador` precisa começar com `https://github.com/LucasCPena/starsonic-phone/releases/download/android-v`. `versionCode` = maior·1.000.000 + menor·10.000 + correção·100 + rc (final = 99).
- **Publicação:** tags `android-v*`; releases do Android sempre com `--latest=false`; pre-release fixo `canal-teste-android` e release fixo `canal-android`.
- **Regras do repositório:** literais C/C++ só em ASCII (`python3 build/check_source_text.py`; acentos com `\uXXXX`); nada muda em `microsip/`; nenhum "MicroSIP" no APK; licença GPL v3 com o código-fonte completo em cada release.
- **Onde roda:** o sandbox não alcança o Google, o Gradle nem o Maven Central (403). C++ e Python rodam aqui; tudo que é Gradle, NDK e emulador roda no GitHub Actions. Para os testes Kotlin, o RED é um commit enviado cujo CI falha nos testes novos (anotar o id do run no ledger), e o GREEN é o commit seguinte.
- **Commits** direto no `main`, em português, com as linhas de atribuição da sessão.
- `$SCRATCH` nos comandos = o scratchpad da sessão (builds locais ficam lá, nunca no repositório).

## Review Focus

1. Celular parado por horas, Doze ou fabricante que fecha apps → o registro some sem aviso. O esperado: o status sai de "Conectado", e o registro volta na troca de rede ou ao renovar. Teste `SipEngine registers again after HandleIpChange` (Task 1) e `NetworkMonitor re-registers on network change` (Task 7).
2. Segunda ligação chegando enquanto outra toca ou está em andamento, ou eventos do motor chegando depois de Sair → ocupado (486) e perdida no Recentes, sem travar. Testes `a second call gets busy while one is active` (Task 3) e `CallManager ignores engine events after logout` (Task 8).
3. Número com formatação no Teclado ou no Recentes (`+55 (11) 5060-3000`, espaços, traços, pontos) → disca só o que importa. Teste `NormalizeDialString removes separators` (Task 3).
4. Senha e servidor com acento, símbolo ou espaço nas pontas passando pelo JNI (UTF-16 → wchar_t de 32 bits → UTF-8) → o login funciona. Testes `SipEngine registers with a UTF-8 password` (Task 1) e `login with an accented password` (Task 6).
5. Canal de atualização com versão igual ou menor, JSON inválido, URL fora do prefixo, SHA-256 diferente ou download cortado → nenhum aviso, ou a mensagem de falha, e o app segue funcionando. Testes `UpdateDecider*` (Task 10).

---

### Task 1: Motor de ligações no Linux — registro

**Files:**
- Create: `build/linux/build-pjproject.sh`, `build/linux/config_site.h`
- Create: `starsonic/phone/AccountConfig.h`, `starsonic/phone/AccountConfig.cpp`, `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`
- Modify: `starsonic/core/Text.h`, `starsonic/core/Text.cpp` (`WideToUtf8`)
- Create: `tests/phone/CMakeLists.txt`, `tests/phone/main.cpp`, `tests/phone/registrar_fixture.h`, `tests/phone/test_account_config.cpp`, `tests/phone/test_engine_register.cpp`
- Modify: `tests/test_text.cpp`
- Create: `.github/workflows/android.yml` (job `phone-linux`)

**Interfaces:**
- Produces:
  - `std::string WideToUtf8(const std::wstring& text);` — UTF-8; aceita `wchar_t` de 16 bits (pares substitutos) e de 32 bits; unidade inválida (substituto solto, acima de U+10FFFF) vira U+FFFD.
  - `struct PjAccountSettings { std::string idUri, registrarUri, proxyUri, authUser, authPassword, transport; int srtpUse; int udpKeepAliveSec; int regTimeoutSec; };` e `PjAccountSettings ToPjAccount(const AccountFields& account);` — `idUri = sip:<username>@<domain>`; `registrarUri = sip:<server>;transport=<transport>`; `proxyUri = ""` ou `sip:<proxy>;lr;transport=<transport>`; `srtpUse` 0 (vazio), 1 (`optional`), 2 (`mandatory`); `udpKeepAliveSec = keepAlive`; `regTimeoutSec = registerRefresh`.
  - `std::vector<std::string> CodecIds(const std::vector<std::wstring>& profileCodecs);` — os nomes do pjsua na ordem do perfil (a mesma tabela de `CodecsToMicrosip`).
  - `enum class CallState { Incoming = 0, Calling = 1, Early = 2, Connecting = 3, Confirmed = 4, Disconnected = 5 };`
  - `class EngineListener { virtual void OnRegistration(int sipCode, bool active) = 0; virtual void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) = 0; virtual void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) = 0; virtual void OnCallState(int callId, CallState state, int sipCode) = 0; virtual void OnLog(int level, const std::string& line) = 0; };` (destrutor virtual)
  - `struct EngineConfig { std::string userAgent; Profile profile; bool nullAudio = false; int logLevel = 4; };`
  - `struct AccountInput { std::wstring address; Transport transport; std::wstring ramal; std::wstring senha; };`
  - `class SipEngine` com `static std::unique_ptr<SipEngine> Create(const EngineConfig&, EngineListener*, std::string* error)`, `~SipEngine()` (desregistra e destrói o pjsua), `bool SetAccount(const AccountInput&)` (troca a conta e registra; resultado por `OnRegistration`), `void RemoveAccount()`, `void Reregister()`, `void HandleIpChange()`, `std::vector<std::string> ActiveCodecs() const`. Todo método público registra a thread que chama no PJLIB antes de usar o PJSIP.

- [ ] **Step 1: Infra do pjproject e testes que falham**

Primeiro o `build/linux/build-pjproject.sh` e o `build/linux/config_site.h` (descritos no Step 3), porque os testes do motor precisam do pjproject compilado. Depois os testes:

`tests/test_text.cpp`: `WideToUtf8 encodes ASCII, accents and invalid units` — `"abc"`; `L"ç"` → `"\xc3\xa7"`; U+1F600 (par substituto com `wchar_t` de 16 bits, código direto com 32 bits) → `"\xf0\x9f\x98\x80"`; substituto solto → `"\xef\xbf\xbd"`.

`tests/phone/test_account_config.cpp` (perfil com porta 5060, SRTP opcional, keep-alive 15):
- `ToPjAccount maps the account built from the profile` — `BuildAccount(p, L"h.example", L"2001", L"senha", Transport::Tcp, L"")` → `idUri == "sip:2001@h.example"`, `registrarUri == "sip:h.example:5060;transport=tcp"`, `proxyUri == ""`, `authUser == "2001"`, `authPassword == "senha"`, `transport == "tcp"`, `srtpUse == 1`, `udpKeepAliveSec == 15`, `regTimeoutSec == 300`.
- `ToPjAccount adds the profile proxy with the transport` — proxy `proxy.example:5070`, UDP → `"sip:proxy.example:5070;lr;transport=udp"`.
- `ToPjAccount keeps UTF-8 credentials` — senha `L"Senha#ç"` → `"Senha#\xc3\xa7"`.
- `CodecIds follows the profile order` — `{G722, PCMA, PCMU}` → `{"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"}`; `{opus, G729}` → `{"opus/48000/2", "G729/8000/1"}`.

`tests/phone/registrar_fixture.h`: `FakeRegistrar` sobe `python3 tests/smoke/fake_registrar.py` numa porta livre (`--host 127.0.0.1 --user 2001,2002 --password <senha> --log <tmp>/ua.txt --transport-log <tmp>/transport.txt`), espera a porta TCP aceitar conexão (até 10 s) e mata o processo no destrutor; `RecordingListener` guarda os eventos com mutex e `WaitFor(pred, segundos)`.

`tests/phone/test_engine_register.cpp` (motor com `nullAudio = true`, User-Agent `Starsonic Phone Android/0.0.0-test`, perfil = `branding/perfil.ini` lido com `ParseProfile`):
- `SipEngine registers over UDP and sends the User-Agent` — `OnRegistration(200, true)` em até 10 s; `ua.txt` = o User-Agent.
- `SipEngine registers over TCP` — `transport.txt` = `tcp`.
- `SipEngine reports a wrong password` — `OnRegistration(403, false)`; `RegistrationMessage(403, false) == L"Ramal ou senha incorretos."`.
- `SipEngine registers with a UTF-8 password` — registrador com a senha `Senha#ç` (UTF-8) → 200.
- `SipEngine reports an unreachable server` — TCP para uma porta fechada → código 503 ou 408 em até 10 s, e `RegistrationMessage` dá `Não foi possível falar com o servidor. Confira o endereço e a sua internet.`
- `SipEngine uses the profile codecs in order` — `ActiveCodecs() == {"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"}`.
- `SipEngine registers again after HandleIpChange` — depois do primeiro 200, `HandleIpChange()` → um segundo `OnRegistration(200, true)`.
- `RemoveAccount unregisters` — `OnRegistration(200, false)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash build/linux/build-pjproject.sh $SCRATCH/pjw $SCRATCH/pj-linux && cmake -S tests -B $SCRATCH/bt && cmake --build $SCRATCH/bt -j 8 2>&1 | tail -3 && cmake -S tests/phone -B $SCRATCH/bp -DPJPROJECT_PREFIX=$SCRATCH/pj-linux 2>&1 | tail -3`
Expected: o build do núcleo falha em `WideToUtf8`; o CMake de `tests/phone` falha porque `starsonic/phone` não existe.

- [ ] **Step 3: Implementar**

- (feito no Step 1) `build/linux/build-pjproject.sh WORKDIR PREFIX`: clona o pjproject no commit de `build/deps.lock` (se ainda não estiver lá), copia `build/linux/config_site.h` para `pjlib/include/pj/config_site.h` (`PJMEDIA_HAS_VIDEO 0`, `PJMEDIA_HAS_SRTP 1`, `PJSUA_MAX_CALLS 4`) e roda `./configure --prefix=PREFIX --disable-video --disable-sound --disable-ssl --disable-opencore-amr --disable-silk --disable-libwebrtc --disable-libyuv --disable-bcg729 --disable-ilbc-codec --disable-gsm-codec --disable-g7221-codec --disable-l16-codec CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC"`, `make dep`, `make -j`, `make install` (precisa de `uuid-dev`). Não desligar o codec Speex: sem ele, o link dos testes do pjmedia falha.
- `tests/phone/CMakeLists.txt`: C++14; `PJPROJECT_PREFIX` obrigatório; `pkg_check_modules(PJ REQUIRED IMPORTED_TARGET libpjproject)` com `PKG_CONFIG_PATH=${PJPROJECT_PREFIX}/lib/pkgconfig`; executável `phone_tests` com `tests/phone/*.cpp`, `starsonic/core/*.cpp` e `starsonic/phone/*.cpp`; `STARSONIC_REPO_DIR` como em `tests/CMakeLists.txt`; `add_test`.
- `SipEngine`: um `pj::Endpoint` por processo (`libCreate`, `libInit` com `uaConfig.userAgent`, `uaConfig.threadCnt = 1`, `uaConfig.srtpSecureSignaling = 0`, `medConfig.ecTailLen = 0`, log pelo `LogWriter` que chama `OnLog`), transportes UDP e TCP em porta automática, `libStart`; com `nullAudio`, `audDevManager().setNullDev()`; codecs: todos com prioridade 0 e os de `CodecIds(profile.global.codecs)` com 255, 254…, pulando (com uma linha de log) os que o build não tem. A conta vem de `BuildAccount(profile.account, address, ramal, senha, transport, L"")` → `ToPjAccount` → `AccountConfig` (`idUri`, `regConfig.registrarUri`, `regConfig.timeoutSec`, `sipConfig.proxies`, `sipConfig.authCreds` com realm `*`, `sipConfig.transportId` do protocolo, `natConfig.udpKaIntervalSec`, `natConfig.contactRewriteUse = 0`, `natConfig.viaRewriteUse = 0`, `natConfig.sdpNatRewriteUse = 0`, `natConfig.iceEnabled = false`, `mediaConfig.srtpUse`, `mediaConfig.srtpSecureSignaling = 0`). `onRegState` → `OnRegistration(code, regIsActive)`. `HandleIpChange` → `Endpoint::handleIpChange` com os parâmetros padrão.
- Job `phone-linux` ("Motor de ligações (Linux)") em `.github/workflows/android.yml`: `apt-get install uuid-dev`, cache do `pj-linux` pela chave `hashFiles('build/deps.lock', 'build/linux/**')`, o script, o build e `ctest --output-on-failure`. Gatilhos do workflow: push e pull request nos caminhos `android/**`, `starsonic/**`, `tests/phone/**`, `tests/smoke/fake_registrar.py`, `tests/python/**`, `build/android/**`, `build/linux/**`, `branding/**`, `.github/workflows/android*.yml`; também `workflow_dispatch` e `workflow_call` (entrada `version`, padrão vazio).

- [ ] **Step 4: Rodar e ver passar**

Run: `cmake --build $SCRATCH/bt -j 8 && $SCRATCH/bt/starsonic_tests | tail -2 && cmake -S tests/phone -B $SCRATCH/bp -DPJPROJECT_PREFIX=$SCRATCH/pj-linux && cmake --build $SCRATCH/bp -j 8 && $SCRATCH/bp/phone_tests | tail -3 && python3 build/check_source_text.py`
Expected: `Status: SUCCESS!` nos dois e `ok: literais em ASCII`.

- [ ] **Step 5: Commit e CI**

```bash
git add build/linux starsonic/core/Text.* starsonic/phone tests/test_text.cpp tests/phone .github/workflows/android.yml
git commit -m "feat(phone): motor de ligações sobre o PJSIP, com registro testado no Linux"
git push origin HEAD:main
```
Expected: workflow `android`, job `Motor de ligações (Linux)` verde; o `build` do Windows também verde (o núcleo mudou).

---

### Task 2: Registrador falso que liga e atende

**Files:**
- Modify: `tests/smoke/fake_registrar.py`
- Test: `tests/python/test_fake_registrar.py`

**Interfaces:**
- Consumes: o registrador da revisão 1.4 (REGISTER com Digest, UDP e TCP, `--log`, `--transport-log`).
- Produces:
  - `--control-port N` (TCP no mesmo `--host`), um comando por linha, resposta numa linha:
    - `RING <ramal>` → INVITE (From `"Cliente Teste" <sip:3001@ci>`, SDP com PCMU, PCMA e telephone-event) para o contato do último REGISTER aceito do ramal, pelo mesmo transporte (UDP: o endereço de origem do REGISTER; TCP: a mesma conexão) → `OK` ou `ERR no-contact`.
    - `HANGUP <ramal>` → BYE na ligação atendida (ou CANCEL se ainda tocando) → `OK` ou `ERR no-call`.
    - `PASSWORD <senha>` → troca a senha aceita → `OK`.
    - `REGISTERS <ramal>` → quantos REGISTER com `Expires` > 0 foram aceitos → `<n>`.
    - `LOG` → as linhas do registro de ligações, uma por linha, e `END`.
  - Registro de ligações (só em memória): `inv-out <ramal> <código final>`, `ack-sent <ramal>`, `bye-out <ramal> <código>`, `bye-in <alvo>`, `cancel-in <alvo>`, `inv-in <alvo> <código>`, `reinv-in <alvo> <sendonly|sendrecv|inactive|recvonly>`, `refer-in <alvo> <ramal de destino>`.
  - INVITE vindo do app: o usuário da Request-URI decide — `486` → 486; `404` → 404; `480` → 480; outro → 100, 180 e 200 com SDP; sem autenticação para INVITE, re-INVITE, REFER, BYE e CANCEL. re-INVITE → 200 com a direção espelhada; REFER → 202 e um NOTIFY com `SIP/2.0 200 OK` (sipfrag).

- [ ] **Step 1: Testes que falham** (cliente SIP mínimo em socket, dentro do próprio teste)

- `test_ring_sends_invite_to_registered_udp_contact` — registra 2001 por UDP; `RING 2001` → o cliente recebe INVITE com `From: "Cliente Teste" <sip:3001@ci>`; responde 200 com SDP → recebe ACK; `LOG` tem `inv-out 2001 200` e `ack-sent 2001`.
- `test_ring_over_tcp_uses_the_registration_connection` — o INVITE chega pela conexão TCP do REGISTER.
- `test_ring_without_registration_errors` — `RING 9999` → `ERR no-contact`.
- `test_hangup_sends_bye` — depois de atendida, `HANGUP 2001` → BYE; o cliente responde 200 → `bye-out 2001 200`.
- `test_hangup_while_ringing_sends_cancel` — sem atender, `HANGUP 2001` → CANCEL.
- `test_invite_to_486_is_busy` — INVITE `sip:486@ci` → 486; `inv-in 486 486`.
- `test_invite_answered_with_sdp` — INVITE `sip:2002@ci` → 100, 180 e 200 com `m=audio`; ACK; BYE do cliente → 200; `inv-in 2002 200` e `bye-in 2002`.
- `test_reinvite_logs_direction` — re-INVITE com `a=sendonly` → 200 com `a=recvonly`; `reinv-in 2002 sendonly`.
- `test_refer_is_accepted_and_notified` — REFER com `Refer-To: <sip:2003@ci>` → 202 e NOTIFY com `SIP/2.0 200 OK`; `refer-in 2002 2003`.
- `test_password_command_changes_the_accepted_password` — `PASSWORD nova` → REGISTER com a senha antiga recebe 403, com a nova 200.
- `test_registers_counts_accepted_registrations` — `REGISTERS 2001` → `1` depois de um registro.

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -3`
Expected: FAILED (os testes novos; `--control-port` não existe).

- [ ] **Step 3: Implementar**

O `Registrar` passa a guardar, por ramal, o contato do último REGISTER (transporte, endereço, conexão TCP) e as ligações em andamento (Call-ID, tags, CSeq, estado); o laço UDP e as conexões TCP entregam respostas e pedidos ao mesmo `Registrar`, que também manda pedidos (INVITE, ACK, BYE, CANCEL, NOTIFY). O servidor de controle é um `ThreadingTCPServer`. O comportamento atual (401, 200, 403, `--log`, `--transport-log`, OPTIONS) não muda.

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -3`
Expected: `OK`.

- [ ] **Step 5: Commit e CI**

```bash
git add tests/smoke/fake_registrar.py tests/python/test_fake_registrar.py
git commit -m "test: registrador SIP falso liga, atende, transfere e tem porta de controle"
git push origin HEAD:main
```
Expected: `android` e `build` (Windows) verdes — os testes de fumaça do Windows usam o registrador sem `--control-port`.

---

### Task 3: Ligações no motor

**Files:**
- Create: `starsonic/core/CallMessages.h`, `starsonic/core/CallMessages.cpp`
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`
- Modify: `tests/phone/registrar_fixture.h` (cliente da porta de controle)
- Test: `tests/test_call_messages.cpp`, `tests/phone/test_engine_calls.cpp`

**Interfaces:**
- Consumes: `SipEngine` e `EngineListener` (Task 1); comandos de controle do registrador (Task 2).
- Produces:
  - `std::wstring CallEndMessage(int sipCode);` — textos de Global Constraints.
  - `std::wstring NormalizeDialString(const std::wstring& raw);` — tira espaço, tab, `-`, `.`, `(` e `)`; mantém `+` só na primeira posição; o resto fica.
  - `SipEngine`: `int MakeCall(const std::string& number)` (Request-URI `sip:<número>@<domínio da conta>`; devolve o id ou -1), `bool Answer(int)`, `bool Reject(int)` (486), `bool Hangup(int)`, `bool SetHold(int, bool)`, `void SetMute(bool)`, `bool SendDtmf(int, const std::string&)` (método do perfil: RFC 2833; `info` → SIP INFO; `auto` e `inband` → RFC 2833), `bool Transfer(int, const std::string&)` (REFER para `sip:<número>@<domínio>`; com o NOTIFY 2xx, a ligação é desligada), `bool HasCall() const`. INVITE com outra ligação existente → 486 automático e `OnRejectedBusy`; senão 180 e `OnIncomingCall`.

- [ ] **Step 1: Testes que falham**

`tests/test_call_messages.cpp`:
- `CallEndMessage maps the codes the user sees` — 486 e 600 → `L"Ocupado"`; 404, 484 e 604 → `L"Número não encontrado"`; 408 e 480 → `L"Não atendeu"`; 403 → `L"Não foi possível completar a ligação (código 403)."`; 0, 200 e 487 → `L""`.
- `NormalizeDialString removes separators` — `L" +55 (11) 5060-3000 "` → `L"+551150603000"`; `L"20.01"` → `L"2001"`; `L"*21#"` → `L"*21#"`; `L"1+2"` → `L"12"`; `L"   "` → `L""`.

`tests/phone/test_engine_calls.cpp` (registrado por UDP; registrador com `--control-port`):
- `incoming call rings, is answered and ends when the caller hangs up` — `RING 2001` → `OnIncomingCall(id, "3001", "Cliente Teste")`; `Answer(id)` → `LOG` com `inv-out 2001 200`; `HANGUP 2001` → `OnCallState(id, Disconnected, …)`.
- `a second call gets busy while one is active` — com uma atendida, outro `RING 2001` → `inv-out 2001 486` e `OnRejectedBusy("3001", "Cliente Teste")`.
- `Reject answers busy` — `Reject(id)` → `inv-out 2001 486`.
- `outgoing call to a busy number ends with 486` — `MakeCall("486")` → `OnCallState(id, Disconnected, 486)`.
- `outgoing call is held, resumed, sends DTMF and is transferred` — `MakeCall("2002")` → `Confirmed`; `SetHold(true)` → `reinv-in 2002 sendonly`; `SetHold(false)` → `reinv-in 2002 sendrecv`; `SendDtmf(id, "12")` → true; `Transfer(id, "2003")` → `refer-in 2002 2003` e `Disconnected`.
- `Hangup ends an answered call` — `MakeCall("2002")`, `Confirmed`, `Hangup` → `bye-in 2002`; `HasCall()` falso depois.
- `destroying the engine during a call is safe` — destrói o motor com a ligação ativa; nenhum evento chega depois.

- [ ] **Step 2: Rodar e ver falhar** — Run: `cmake --build $SCRATCH/bt -j 8 2>&1 | tail -3; cmake --build $SCRATCH/bp -j 8 2>&1 | tail -3`. Expected: erros de compilação (`CallEndMessage`, `MakeCall` etc. não existem).

- [ ] **Step 3: Implementar** — `pj::Call` derivada com `onCallState`, `onCallMediaState` (liga a mídia da ligação ao dispositivo de áudio), `onCallTransferStatus`; mudo = `adjustTxLevel(0)` no dispositivo de captura; espera = `setHold`, retomar = `reinvite` com `PJSUA_CALL_UNHOLD`.

- [ ] **Step 4: Rodar e ver passar** — Run: `$SCRATCH/bt/starsonic_tests | tail -2 && $SCRATCH/bp/phone_tests | tail -2 && python3 build/check_source_text.py`. Expected: `SUCCESS` nos dois e `ok`.

- [ ] **Step 5: Commit e CI**

```bash
git add starsonic/core/CallMessages.* starsonic/phone tests/test_call_messages.cpp tests/phone
git commit -m "feat(phone): ligações feitas e recebidas, espera, DTMF e transferência no motor"
git push origin HEAD:main
```
Expected: `android` (`Motor de ligações (Linux)`) e `build` (Windows) verdes.

---

### Task 4: PJSIP, Opus e Oboe para Android

**Files:**
- Create: `build/android/build-deps.sh`, `build/android/config_site.h`, `build/android/elf_align.py`
- Modify: `build/deps.lock` (chave `android`)
- Test: `tests/python/test_elf_align.py`
- Modify: `.github/workflows/android.yml` (job `deps-android`)

**Interfaces:**
- Produces:
  - `elf_align.py`: `load_alignments(path) -> list[int]` (alinhamento de cada segmento `PT_LOAD`, ELF de 32 e 64 bits, little-endian) e `main(paths)` que sai com 1 e lista os arquivos com algum `PT_LOAD` < 16384.
  - Pasta `android-deps/<abi>/` com `include/`, `lib/` (pjproject e `libopus.a`) e `pjproject.cflags` (saída de `pkg-config --cflags libpjproject`); `android-deps/oboe/` com o AAR do Oboe aberto (`prefab/modules/oboe/...`). Artefato do CI `android-deps`.

- [ ] **Step 1: Testes que falham** — `tests/python/test_elf_align.py`: ELF64 sintético com um `PT_LOAD` de alinhamento 0x1000 → `[4096]` e `main` sai com 1; com 0x4000 → `[16384]` e `main` sai com 0; ELF32 também; arquivo que não é ELF → erro claro.

- [ ] **Step 2: Rodar e ver falhar** — Run: `python3 -m unittest tests/python/test_elf_align.py 2>&1 | tail -3`. Expected: erro de import.

- [ ] **Step 3: Implementar**

- `elf_align.py` com `struct` (cabeçalho ELF e tabela de programas).
- `build/android/config_site.h`: `PJ_CONFIG_ANDROID 1` + `#include <pj/config_site_sample.h>`; `PJMEDIA_HAS_VIDEO 0`; `PJMEDIA_HAS_SRTP 1`; `PJMEDIA_SRTP_HAS_DTLS 0`; `PJMEDIA_HAS_OPUS_CODEC 1`; `PJMEDIA_HAS_WEBRTC_AEC 1`; `PJMEDIA_AUDIO_DEV_HAS_ANDROID_JNI 0`; `PJ_JNI_HAS_JNI_ONLOAD 0` (o `JNI_OnLoad` é da ponte, que chama `pj_jni_set_jvm`); `PJSUA_MAX_CALLS 4`.
- `build-deps.sh OUT` (variável `ANDROID_NDK_ROOT` apontando para o NDK de `deps.lock`): baixa o AAR do Oboe (`https://dl.google.com/dl/android/maven2/com/google/oboe/oboe/1.11.0/oboe-1.11.0.aar`) e abre em `OUT/oboe`; para cada ABI, compila o Opus (`v1.6.1`, CMake com `android.toolchain.cmake`, `ANDROID_PLATFORM=android-28`, estático, PIC, sem programas e testes) e o pjproject (`APP_PLATFORM=android-28 TARGET_ABI=<abi> ./configure-android --use-ndk-cflags --prefix=OUT/<abi> --with-oboe=OUT/oboe --with-opus=<opus da ABI> --disable-video --disable-ssl --disable-opencore-amr --disable-silk --disable-bcg729 --disable-ilbc-codec --disable-gsm-codec --disable-g7221-codec --disable-l16-codec --disable-libyuv --disable-android-mediacodec`, `make dep`, `make`, `make install`; `make distclean` entre as ABIs); grava `pjproject.cflags`; no fim, confere `libpjsua2-*.a` e `libopus.a` em cada ABI e roda `elf_align.py` nos `liboboe.so`.
- Job `deps-android` ("Dependências (Android)"): instala o NDK com `sdkmanager "ndk;30.0.16248370"`, usa cache pela chave `hashFiles('build/deps.lock', 'build/android/build-deps.sh', 'build/android/config_site.h')` e publica o artefato `android-deps`.

- [ ] **Step 4: Rodar e ver passar** — Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -2`; depois do push, `gh run view <id> --log | grep -E "liboboe|ok:"`. Expected: `OK` local; job `Dependências (Android)` verde, com as três ABIs e o `liboboe.so` alinhado a 16 KB.

- [ ] **Step 5: Commit e CI**

```bash
git add build/android build/deps.lock tests/python/test_elf_align.py .github/workflows/android.yml
git commit -m "build(android): PJSIP 2.17, Opus e Oboe compilados para Android no CI"
git push origin HEAD:main
```

---

### Task 5: Projeto Android, marca e a biblioteca nativa carregando

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`
- Create: `android/app/build.gradle.kts`, `android/app/proguard-rules.pro`, `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/cpp/CMakeLists.txt`, `android/app/src/main/cpp/jni_bridge.cpp` (só `JNI_OnLoad` e as funções do núcleo desta task)
- Create: `android/app/src/main/java/org/pjsip/PjAudioDevInfo.java` (cópia de `pjmedia/src/pjmedia-audiodev/android/PjAudioDevInfo.java` do pjproject 2.17, com o cabeçalho GPL)
- Create: `android/app/src/main/java/br/com/starsonic/phone/App.kt`, `.../Native.kt`, `.../main/MainActivity.kt` (tela provisória com a faixa)
- Create: `android/app/src/main/res/` (cores, tema com a tela de abertura, `strings.xml`, ícone adaptável, monocromático e da notificação)
- Modify: `branding/fontes/gerar_marca.py` (gera os vetores do Android) e `tests/python/test_branding_assets.py`
- Create: `build/android/version_code.py`, `tests/python/test_version_code.py`
- Create: `android/app/src/androidTest/java/br/com/starsonic/phone/NativeLoadTest.kt`
- Create: `build/android/run-emulator-tests.sh`
- Modify: `.github/workflows/android.yml` (job `apk`, com o emulador)

**Interfaces:**
- Consumes: `android-deps` (Task 4); núcleo (`ValidateServerAddress`, `ValidateRamal`, `RegistrationMessage`, `CallEndMessage`, `NormalizeDialString`).
- Produces:
  - `version_code.py VERSAO` → imprime o `versionCode` (fórmula de Global Constraints); versão fora de `X.Y.Z` ou `X.Y.Z-rc.N` (N de 1 a 98) → sai com 2.
  - Gradle: propriedades `starsonic.version` (padrão `0.0.0`), `starsonic.versionCode` (padrão 1), `starsonic.deps` (caminho de `android-deps`), `starsonic.abis` (padrão as três ABIs); `externalNativeBuild` com `-DANDROID_STL=c++_shared` e `-DSTARSONIC_ANDROID_DEPS=<starsonic.deps>`; `buildFeatures { compose = true; prefab = true; buildConfig = true }`; dependência `com.google.oboe:oboe:1.11.0`; `perfil.ini` copiado de `branding/` para os assets no build.
  - `libstarsonic.so`: núcleo + motor + ponte; liga os `.a` do pjproject e o `libopus.a` entre `-Wl,--start-group` e `-Wl,--end-group`, `oboe::oboe`, `OpenSLES`, `log`, `android`; usa os `cflags` de `pjproject.cflags`.
  - `object Native` (Kotlin): `validateServer(raw): Array<String>` (`[ok|empty|invalid, normalizado]`), `validateRamal(raw): Array<String>`, `registrationMessage(code): String`, `callEndMessage(code): String`, `normalizeDialString(raw): String`.
  - `run-emulator-tests.sh APK TEST_APK CLASSE [ARGS…]`: instala os dois APKs, concede as permissões (`pm grant` de microfone e notificações, `appops set … USE_FULL_SCREEN_INTENT allow`, `dumpsys deviceidle whitelist +br.com.starsonic.phone`) e roda `am instrument -w -e class <CLASSE> <args>`; sai com 1 se algum teste falhar.

- [ ] **Step 1: Testes que falham**

- `test_version_code.py`: `0.1.0-rc.1` → 10001; `0.1.0` → 10099; `1.2.3-rc.4` → 1020304; `0.1.0-rc.99` e `0.1` → erro.
- `test_branding_assets.py`: `android/app/src/main/res/drawable/ic_launcher_foreground.xml`, `ic_launcher_background.xml`, `ic_launcher_monochrome.xml` e `ic_stat_starsonic.xml` existem e são vetores (`<vector`); o fundo tem `#383881`, o primeiro plano tem `#3DB1CC` e branco; o da notificação só tem branco.
- `NativeLoadTest` (androidTest): `Native.validateServer(" Starcloud1-Starsonic.com.br ")` → `["ok", "starcloud1-starsonic.com.br"]`; `Native.registrationMessage(403)` → `Ramal ou senha incorretos.`; `Native.callEndMessage(486)` → `Ocupado`.

- [ ] **Step 2: Rodar e ver falhar** — Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -3`. Expected: FAILED nos dois testes Python. O `NativeLoadTest` vai junto com o código (é o primeiro build Android: o RED aqui é o CI não ter o job `apk`).

- [ ] **Step 3: Implementar** — os arquivos acima. O tema segue o modo claro ou escuro do celular (a faixa e o logo não mudam), com a tela de abertura azul com o ícone; as activities ficam em retrato. `gerar_marca.py` também copia `logo-faixa.png` e `logo-entrar.png` para `android/app/src/main/res/drawable-nodpi/` e escreve os vetores com a mesma geometria do ícone do Windows (círculo r=41 num quadro de 108 dp para o ícone adaptável, anel e fone). Job `apk` ("APK e emulador"): baixa `android-deps`; `actions/setup-java` 17; `gradle/actions/setup-gradle` com Gradle 9.6.0; `gradle -p android testDebugUnitTest assembleDebug assembleDebugAndroidTest -Pstarsonic.deps=… -Pstarsonic.abis=x86_64`; ativa o KVM (regra do udev do `reactivecircus/android-emulator-runner`); `reactivecircus/android-emulator-runner@v2` (API 34, `google_apis`, `x86_64`) rodando `run-emulator-tests.sh … br.com.starsonic.phone.NativeLoadTest`; `aapt2 dump badging` confere `package: name='br.com.starsonic.phone'`, `application-label:'Starsonic Phone'`, `launchable-activity:` com `label='Starsonic'`, `sdkVersion:'28'` e `targetSdkVersion:'36'`; envia o APK de debug como artefato.

- [ ] **Step 4: Rodar e ver passar** — Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -2`; push; acompanhar o run. Expected: `OK`; job `APK e emulador` verde com o `NativeLoadTest` passando.

- [ ] **Step 5: Commit e CI**

```bash
git add android branding/fontes/gerar_marca.py tests/python build/android .github/workflows/android.yml
git commit -m "feat(android): projeto do app com a marca, a biblioteca nativa e o emulador no CI"
git push origin HEAD:main
```

---

### Task 6: Ponte JNI do motor e a tela Entrar

**Files:**
- Modify: `android/app/src/main/cpp/jni_bridge.cpp`
- Create: `android/app/src/main/java/br/com/starsonic/phone/core/CoreRules.kt`, `core/NativeCoreRules.kt`, `engine/SipGateway.kt`, `engine/NativeSipGateway.kt`, `data/AccountStore.kt`, `data/PasswordCipher.kt`, `login/LoginViewModel.kt`, `login/LoginScreen.kt`, `main/Band.kt`
- Modify: `main/MainActivity.kt` (sem conta → Entrar; com conta → tela principal provisória com a faixa)
- Test: `android/app/src/test/java/br/com/starsonic/phone/login/LoginViewModelTest.kt`, `android/app/src/androidTest/java/br/com/starsonic/phone/LoginScreenTest.kt`
- Modify: `.github/workflows/android.yml` (registrador no runner; confere User-Agent e protocolo)

**Interfaces:**
- Consumes: `SipEngine` (Tasks 1 e 3); `Native` (Task 5); `LoginFlow` do núcleo.
- Produces:
  - `interface CoreRules { fun validateServer(raw: String): Pair<Check, String>; fun validateRamal(raw: String): Pair<Check, String>; fun registrationMessage(code: Int): String; fun callEndMessage(code: Int): String; fun normalizeDialString(raw: String): String }` com `enum class Check { OK, EMPTY, INVALID }`.
  - `interface SipGateway` (Kotlin): `start(userAgent, profileText, events): Boolean`, `stop()`, `setAccount(address, transport: Transport, ramal, senha): Boolean`, `removeAccount()`, `reregister()`, `handleIpChange()`, `makeCall(number): Int`, `answer(id)`, `reject(id)`, `hangup(id)`, `setHold(id, hold)`, `setMute(mute)`, `sendDtmf(id, digits)`, `transfer(id, number)`, `hasCall(): Boolean`; `interface EngineEvents` com os cinco eventos do `EngineListener` (estado como `Int`, igual ao `CallState`). `NativeSipGateway` implementa pela ponte; a ponte guarda o `JavaVM` no `JNI_OnLoad`, chama `pj_jni_set_jvm` e anexa a thread do PJSIP à JVM antes de cada evento.
  - `class LoginFlowHandle` (ponte para o `LoginFlow` do núcleo): `start()`, `onRegistration(code): Outcome?`, `onTimeout(): Outcome?`, com `Outcome(commit, rollback, message)`.
  - `AccountStore`: `load(): Account?`, `save(Account)`, `clear()`; `Account(address, transport, ramal)`; a senha passa por `PasswordCipher` (AES-GCM com chave do Android Keystore, alias `starsonic-senha`).
  - `LoginViewModel(core, gateway, store, clock)`: `state` (campos, mensagem, carregando); `submit()` confere servidor, ramal e senha nessa ordem, com as mensagens do núcleo e `Digite a senha.`; registra e espera até 15 s.

- [ ] **Step 1: Testes que falham**

`LoginViewModelTest` (JVM, com `CoreRules`, `SipGateway`, `AccountStore` e relógio falsos):
- `empty server shows the core message first` — com tudo vazio, só a mensagem do servidor.
- `invalid ramal and empty password are checked in order`.
- `successful registration saves the account and leaves` — evento 200 → conta gravada com o endereço normalizado, `done = true`.
- `failed registration shows the message and saves nothing` — 403 → mensagem do núcleo; nada gravado.
- `no answer in 15 seconds times out` — avança o relógio 15 s → mensagem do código 0; evento que chega depois é ignorado.
- `edit keeps server, protocol and ramal and clears the password`.
- `edit that fails restores the previous account` — 403 em Editar → `setAccount` volta com a conta anterior.

`LoginScreenTest` (emulador; argumentos `registrar=10.0.2.2`, `porta`, `senha`):
- `empty fields show the messages in order`; `server with port shows the address message`; `ramal with a space shows the ramal message`.
- `wrong password shows the core message` — `Ramal ou senha incorretos.`
- `login over UDP shows Conectado` — faixa `Conectado · 2001`.
- `login over TCP shows Conectado` — escolhe TCP; faixa `Conectado · 2001`.
- `login with an accented password` — registrador com a senha `Senha#ç` → `Conectado · 2001`.

- [ ] **Step 2: Rodar e ver falhar** — commit dos testes com stubs mínimos que compilam; push. Expected: CI vermelho nos testes novos (anotar o run).

- [ ] **Step 3: Implementar** — ponte, gateway, store, cipher, ViewModel, tela (campos, menu do protocolo, olho da senha, telefone de suporte que abre o discador). O CI sobe o registrador no runner (`--host 0.0.0.0 --port 5060 --user 2001 --password senha-certa --log ua.txt --transport-log transporte.txt --control-port 5070`) antes do emulador e, depois do `LoginScreenTest`, confere `ua.txt` = `Starsonic Phone Android/0.0.0` e que `transporte.txt` já teve `tcp`. O teste da senha com acento usa o comando `PASSWORD` e volta a senha no fim.

- [ ] **Step 4: Rodar e ver passar** — push. Expected: `testDebugUnitTest` e `LoginScreenTest` verdes; as conferências do User-Agent e do protocolo passam.

- [ ] **Step 5: Commit e CI**

```bash
git add android .github/workflows/android.yml
git commit -m "feat(android): ponte JNI do motor e a tela Entrar"
git push origin HEAD:main
```

---

### Task 7: Conectado em segundo plano, permissões e reconexão

**Files:**
- Create: `service/SipService.kt`, `service/StatusModel.kt`, `service/BootReceiver.kt`, `service/NetworkMonitor.kt`, `permissions/PermissionsScreen.kt`, `permissions/Banners.kt`, `permissions/OemGuide.kt` (em `android/app/src/main/java/br/com/starsonic/phone/`)
- Modify: `AndroidManifest.xml` (permissões `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`, `MANAGE_OWN_CALLS`, `USE_FULL_SCREEN_INTENT`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `VIBRATE`; serviço com `foregroundServiceType="specialUse|phoneCall|microphone"` e a propriedade `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` = `Manter o ramal SIP registrado para receber ligações`; receptor de `BOOT_COMPLETED` e `MY_PACKAGE_REPLACED`)
- Modify: `login/LoginViewModel.kt` e `main/MainActivity.kt` (o motor passa a viver no serviço; Entrar fala com ele)
- Test: `src/test/.../service/StatusModelTest.kt`, `src/test/.../permissions/BannersTest.kt`, `src/test/.../permissions/OemGuideTest.kt`, `src/test/.../service/NetworkMonitorTest.kt`, `src/androidTest/.../ServiceTest.kt`
- Modify: `.github/workflows/android.yml` (teste do `BOOT_COMPLETED`)

**Interfaces:**
- Consumes: `SipGateway`, `AccountStore`, `CoreRules` (Task 6).
- Produces:
  - `StatusModel.from(registrationCode: Int?, active: Boolean, online: Boolean, ramal: String, core): Status` com `band` e `notificationTitle` (textos de Global Constraints).
  - `Banners.first(notificationsOk, microphoneOk, fullScreenOk, batteryOk): Banner?` na ordem da prioridade.
  - `OemGuide.forManufacturer(name): Guide` — `xiaomi`, `redmi` e `poco` → XIAOMI; `samsung` → SAMSUNG; outro → GENERIC (sem diferenciar maiúsculas).
  - `SipService` (start/stop pelo app; `ACTION_START` depois do Entrar, do boot e da atualização): sobe o motor, carrega a conta, registra, atualiza a notificação fixa (canal `conexao`, importância baixa) e expõe `status: StateFlow<Status>`; `NetworkMonitor` chama `handleIpChange()` quando a rede padrão muda e marca `online`.

- [ ] **Step 1: Testes que falham**

- `StatusModelTest`: 200 ativo → `Conectado · 2001` e `Conectado (ramal 2001)`; sem resposta ainda → `Conectando…`; offline → `Sem internet`; 403 → `Ramal ou senha incorretos.`
- `BannersTest`: tudo negado → o de notificações; só a bateria → o da bateria; tudo ok → nenhum.
- `OemGuideTest`: `Xiaomi`, `Redmi`, `POCO` → XIAOMI; `samsung` → SAMSUNG; `motorola` → GENERIC.
- `NetworkMonitor re-registers on network change` — troca de rede falsa → `handleIpChange()` uma vez; perda de rede → `online = false`.
- `ServiceTest` (emulador): depois do login, há uma notificação do app com o título `Conectado (ramal 2001)`; a tela mostra a faixa `Conectado · 2001`.

- [ ] **Step 2: Rodar e ver falhar** — push dos testes com stubs. Expected: CI vermelho nos testes novos.

- [ ] **Step 3: Implementar** — serviço, receptores, monitor, tela de permissões (notificações, microfone, tela cheia quando `canUseFullScreenIntent()` for falso, isenção de bateria com `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, passo a passo do fabricante) e a faixa de avisos com `Abrir ajustes`. No CI, depois do `ServiceTest`: `adb root`, `adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p br.com.starsonic.phone` e conferir que `REGISTERS 2001` na porta de controle aumentou em até 30 s.

- [ ] **Step 4: Rodar e ver passar** — push. Expected: testes JVM, `ServiceTest` e a conferência do boot verdes.

- [ ] **Step 5: Commit e CI**

```bash
git add android .github/workflows/android.yml
git commit -m "feat(android): serviço em primeiro plano, permissões e reconexão"
git push origin HEAD:main
```

---

### Task 8: Ligações com o Android, tela de chamada, Teclado e Recentes

**Files:**
- Create: `call/CallManager.kt`, `call/TelecomAdapter.kt`, `call/CallConnectionService.kt`, `call/CallConnection.kt`, `call/IncomingCallNotifier.kt`, `call/CallActivity.kt`, `call/CallScreen.kt`, `data/RecentsStore.kt`, `main/DialerScreen.kt`, `main/RecentsScreen.kt` (em `android/app/src/main/java/br/com/starsonic/phone/`)
- Modify: `AndroidManifest.xml` (`CallConnectionService` com `BIND_TELECOM_CONNECTION_SERVICE`; `CallActivity` com `showWhenLocked` e `turnScreenOn`), `App.kt` (registra a `PhoneAccount` self-managed `Starsonic Phone`), `service/SipService.kt` (eventos do motor → `CallManager`; tipos `phoneCall|microphone` durante a ligação), `main/MainActivity.kt` (abas Teclado e Recentes)
- Test: `src/test/.../call/CallManagerTest.kt`, `src/test/.../data/RecentsStoreTest.kt`, `src/androidTest/.../CallFlowTest.kt`

**Interfaces:**
- Consumes: `SipGateway`, `CoreRules`, `SipService` (Tasks 6 e 7); controle do registrador (Task 2).
- Produces:
  - `interface TelecomAdapter { fun incomingPermitted(): Boolean; fun addIncoming(callId: Int, number: String, name: String); fun placeOutgoing(number: String); fun setActive(callId: Int); fun disconnect(callId: Int, cause: Int) }`.
  - `CallManager(gateway, telecom, recents, notifier, core, clock)`: `onIncoming`, `onRejectedBusy`, `onCallState`, `dial(raw)`, `answer`, `reject`, `hangup`, `hold`, `mute`, `dtmf`, `transfer`, `onLogout()`; `endMessage: StateFlow<String>` (por 2 s); depois de `onLogout()`, eventos do motor são ignorados.
  - `RecentsStore`: `add(Recent)`, `list(): List<Recent>` (mais nova primeiro, até 200), `Recent(number, name, kind: FEITA|RECEBIDA|PERDIDA, startMillis, durationSec)`; arquivo JSON no armazenamento privado.

- [ ] **Step 1: Testes que falham**

`CallManagerTest`:
- `incoming call while idle goes to Telecom`.
- `incoming call during another call is rejected busy and missed` — `reject(id)` (486) e Recentes com PERDIDA.
- `incoming call not permitted by Telecom is rejected busy` (ligação da operadora em andamento).
- `caller giving up before answer is a missed call` — notificação `Ligação perdida de 3001`.
- `dial without registration shows the message` — `Sem conexão com o servidor. Tente de novo em instantes.`; nada é discado.
- `dial normalizes the number` — `+55 (11) 5060-3000` → `makeCall("+551150603000")`.
- `busy outgoing call shows Ocupado for 2 seconds`.
- `CallManager ignores engine events after logout`.

`RecentsStoreTest`: mais nova primeiro; 201 entradas → 200 e a mais antiga sai; tipos e durações gravados e relidos.

`CallFlowTest` (emulador; app em segundo plano com `UiDevice.pressHome()`):
- `incoming call shows Atender and is answered` — `RING 2001` → notificação com `Atender`; tocar → tela de chamada com `3001`; `HANGUP 2001` → volta; Recentes com a recebida.
- `Recusar sends busy and records a missed call` — `inv-out 2001 486` no `LOG`.
- `second call during a call gets busy` — `inv-out 2001 486` com uma ligação atendida.
- `outgoing call to 486 shows Ocupado`.
- `outgoing call is held and transferred` — Ligar `2002`; `Espera` → `reinv-in 2002 sendonly`; `Transferir` `2003` → `refer-in 2002 2003`.

- [ ] **Step 2: Rodar e ver falhar** — push dos testes com stubs. Expected: CI vermelho nos testes novos.

- [ ] **Step 3: Implementar** — Telecom self-managed (`addNewIncomingCall`, `placeCall` com a `PhoneAccountHandle`; `onShowIncomingCallUi` mostra a notificação `CallStyle.forIncomingCall` com `fullScreenIntent` para a `CallActivity`; toque com o `RingtoneManager.TYPE_RINGTONE` e vibração seguindo o modo do celular), tela de chamada (Atender/Recusar; Mudo, Teclado, Viva-voz ou a escolha de rota com Bluetooth, Espera/Retomar, Transferir, Desligar; sensor de proximidade), Teclado e Recentes.

- [ ] **Step 4: Rodar e ver passar** — push. Expected: testes JVM e `CallFlowTest` verdes.

- [ ] **Step 5: Commit e CI**

```bash
git add android
git commit -m "feat(android): ligações pelo Telecom, tela de chamada, Teclado e Recentes"
git push origin HEAD:main
```

---

### Task 9: Menu, Sobre, diagnóstico, Editar e Sair

**Files:**
- Create: `main/MenuSheet.kt`, `about/AboutScreen.kt`, `about/DiagnosticsLog.kt` (em `android/app/src/main/java/br/com/starsonic/phone/`), `android/app/src/main/res/xml/file_paths.xml`
- Modify: `AndroidManifest.xml` (`FileProvider`), `service/SipService.kt` (log do motor → `DiagnosticsLog`; 401, 403 ou 407 ao renovar → abre Entrar com a mensagem), `login/LoginViewModel.kt` (Editar), `main/MainActivity.kt`
- Test: `src/test/.../about/DiagnosticsLogTest.kt`, `src/androidTest/.../AboutAndAccountTest.kt`

**Interfaces:**
- Consumes: `SipService`, `AccountStore`, `RecentsStore`, `CallManager` (Tasks 6 a 8).
- Produces: `DiagnosticsLog(dir, maxBytes = 1_048_576)`: `append(line)`, `file(): File`, `shareIntent(context): Intent` (`ACTION_SEND`, `text/plain`, pelo `FileProvider`); Sair = `removeAccount()`, `AccountStore.clear()`, `CallManager.onLogout()` e volta ao Entrar (Recentes ficam).

- [ ] **Step 1: Testes que falham**

- `DiagnosticsLogTest`: passar de 1 MB → o arquivo fica com até 1 MB e guarda as linhas mais novas.
- `AboutAndAccountTest` (emulador):
  - `about shows version, license and credits` — `Starsonic Phone 0.0.0`, `Licença GPL v3`, `Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD).`
  - `send diagnostics opens the share sheet without the password` — `Enviar diagnóstico` dispara `ACTION_SEND`; o arquivo não contém a senha do teste.
  - `edit account keeps the fields and asks the password again`.
  - `sign out returns to Entrar and keeps the recents`.
  - `password changed on the server sends the user to Entrar` — `PASSWORD outra` e o teste pede a renovação com `SipService.reregister()` (mesmo processo) → Entrar com `Ramal ou senha incorretos.`; no fim, `PASSWORD senha-certa`.

- [ ] **Step 2: Rodar e ver falhar** — push dos testes com stubs. Expected: CI vermelho nos testes novos.

- [ ] **Step 3: Implementar** — menu (⋮ na faixa), Sobre com os links e o telefone, diagnóstico, Editar e Sair.

- [ ] **Step 4: Rodar e ver passar** — push. Expected: verde.

- [ ] **Step 5: Commit e CI**

```bash
git add android
git commit -m "feat(android): menu, tela Sobre, diagnóstico, editar e sair da conta"
git push origin HEAD:main
```

---

### Task 10: Atualização pelo app

**Files:**
- Create: `update/UpdateDecider.kt`, `update/Updater.kt`, `update/UpdateWorker.kt`, `update/UpdateDialog.kt` (em `android/app/src/main/java/br/com/starsonic/phone/`)
- Modify: `android/app/src/main/cpp/jni_bridge.cpp` (`parseManifest`, `compareVersions`), `Native.kt`, `CoreRules.kt`, `AndroidManifest.xml` (`REQUEST_INSTALL_PACKAGES`), `App.kt` (agenda a verificação de 24 h)
- Modify: `tests/test_update_manifest.cpp` (prefixo do Android)
- Test: `src/test/.../update/UpdateDeciderTest.kt`, `src/androidTest/.../UpdatePromptTest.kt`

**Interfaces:**
- Consumes: `ParseManifest` e `CompareVersions` do núcleo; `CallManager` (ligação em andamento).
- Produces:
  - `CoreRules.parseManifest(json, allowedPrefix): Manifest?` (`versionText`, `installerUrl`, `sha256`, `notes`) e `compareVersions(a, b): Int`.
  - `UpdateDecider.channelUrl(installedVersion)`: `-rc` → `canal-teste-android`; final → `canal-android`.
  - `UpdateDecider.decide(installed, manifest, lastCheckMillis, nowMillis, inCall): Decision` — `NONE`, `PROMPT(versão, notas)` ou `BLOCKED_BY_CALL`; menos de 24 h desde a última verificação → `NONE` sem buscar.
  - `Updater`: baixa para `cacheDir/update.apk`, confere o SHA-256, apaga e mostra a mensagem se falhar, e abre o instalador por uma sessão do `PackageInstaller`. URL do canal e prefixo injetáveis (os testes do emulador usam um servidor no runner).

- [ ] **Step 1: Testes que falham**

- `tests/test_update_manifest.cpp`: `ParseManifest accepts the Android installer prefix` (`…/releases/download/android-v0.1.0-rc.2/StarsonicPhone-android-0.1.0-rc.2.apk`) e `rejects a Windows installer for the Android prefix`.
- `UpdateDeciderTest`: mais nova → PROMPT; igual ou menor → NONE; JSON inválido ou fora do prefixo → NONE; em ligação → BLOCKED_BY_CALL (mensagem `Termine a chamada para atualizar.`); menos de 24 h → NONE; canal por versão.
- `Updater` com download falso: SHA-256 diferente → arquivo apagado e `Não foi possível baixar a atualização. Tentaremos de novo mais tarde.`; download cortado → a mesma mensagem.
- `UpdatePromptTest` (emulador): um `python3 -m http.server` no runner serve um `versao-android.json` com a versão `9.9.9` e um APK qualquer → aviso `Nova versão do Starsonic Phone disponível (9.9.9). Atualizar agora?`; `Atualizar` → mensagem de falha (o SHA não confere), e o app continua aberto.

- [ ] **Step 2: Rodar e ver falhar** — local: `cmake --build $SCRATCH/bt && $SCRATCH/bt/starsonic_tests | tail -2` (se os testes do núcleo já passarem, o RED do núcleo é só o do Kotlin); push dos testes Kotlin com stubs. Expected: CI vermelho nos testes novos.

- [ ] **Step 3: Implementar** — decisor, worker periódico de 24 h, verificação ao abrir, notificação e diálogo, download e instalador.

- [ ] **Step 4: Rodar e ver passar** — push. Expected: verde.

- [ ] **Step 5: Commit e CI**

```bash
git add android tests/test_update_manifest.cpp
git commit -m "feat(android): atualização pelo app"
git push origin HEAD:main
```

---

### Task 11: Publicação, conferência do APK, chave e documentação

**Files:**
- Create: `build/android/check_apk.py`, `tests/python/test_check_apk.py`, `build/android/make_source_bundle.sh`, `build/android/signing-cert.sha256`
- Create: `.github/workflows/android-release.yml`
- Modify: `.github/workflows/android.yml` (`workflow_call` com `version`; build de release assinado quando houver os segredos; `check_apk.py` no APK)
- Modify: `.github/workflows/build.yml` (`paths-ignore` só com o que é do Android: `android/**`, `starsonic/phone/**`, `tests/phone/**`, `build/android/**`, `build/linux/**`, `.github/workflows/android*.yml`; um push que mexa em mais alguma coisa continua rodando o build do Windows)
- Modify: `android/app/build.gradle.kts` (assinatura de release pelas variáveis `STARSONIC_KEYSTORE_FILE`, `STARSONIC_KEYSTORE_PASSWORD`, `STARSONIC_KEY_ALIAS`, `STARSONIC_KEY_PASSWORD`)
- Modify: `README.md` (seção Android); Create: `docs/teste-manual-android.md`

**Interfaces:**
- Consumes: `elf_align.py` (Task 4); `version_code.py` (Task 5); `build/make_manifest.py`.
- Produces:
  - `check_apk.py APK --aapt2 BIN --apksigner BIN --cert-sha256 ARQ [--abis …]`: confere `lib/<abi>/libstarsonic.so`, `liboboe.so` e `libc++_shared.so` nas ABIs pedidas; alinhamento de 16 KB em todo `.so`; nenhuma ocorrência de `MicroSIP` em nenhum arquivo do APK; `aapt2 dump badging` com o pacote, `application-label:'Starsonic Phone'`, a activity de entrada com `label='Starsonic'`, `sdkVersion:'28'`, `targetSdkVersion:'36'`, `versionName` e `versionCode` esperados; certificado (`apksigner verify --print-certs`) com o SHA-256 de `signing-cert.sha256`.
  - `make_source_bundle.sh VERSAO OUT`: `StarsonicPhone-android-<versão>-codigo-fonte-completo.zip` com o repositório (`git archive` do commit), o pjproject, o Opus e o Oboe nos commits de `deps.lock` e um `LEIA-ME.txt`.
  - `android-release.yml`: tags `android-v*` e `workflow_dispatch` (`versao`); chama `android.yml` com a versão e os segredos; publica `StarsonicPhone-android-<versão>.apk`, `versao-android.json` e o código-fonte, com `--latest=false` (e `--prerelease` para `-rc`); atualiza `canal-teste-android` ou `canal-android`; no fim, `gh api repos/LucasCPena/starsonic-phone/releases/latest --jq .tag_name` precisa começar com `v`.

- [ ] **Step 1: Testes que falham** — `test_check_apk.py` com APKs sintéticos (zip): falta `libstarsonic.so` numa ABI → erro; `.so` com `PT_LOAD` de 4 KB → erro; um arquivo com `MicroSIP` → erro; saídas de `aapt2` e `apksigner` de exemplo (texto) certas e erradas (label, `targetSdkVersion`, certificado). Run: `python3 -m unittest tests/python/test_check_apk.py`. Expected: erro de import.

- [ ] **Step 2: Implementar** — scripts e workflows. Chave: `keytool -genkeypair -keystore starsonic-android.jks -alias starsonic -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Starsonic Phone, O=Starsonic, L=Sao Paulo, ST=SP, C=BR"` com uma senha aleatória (no scratchpad, nunca no repositório); segredos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD` com `gh secret set` (sem permissão → pedir ao Lucas que crie os quatro, com o passo a passo); o SHA-256 do certificado vai para `signing-cert.sha256`. O arquivo da chave e a senha vão para o Lucas guardar fora do GitHub. `docs/teste-manual-android.md` segue a seção 11.3 da spec, no formato de `docs/teste-manual.md`.

- [ ] **Step 3: Rodar e ver passar** — Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -2`; push; ensaio sem publicar: `gh workflow run android.yml -f version=0.1.0-rc.1` (a publicação de verdade é a Task 12). Expected: `OK`; o build de release assinado passa no `check_apk.py` com as três ABIs.

- [ ] **Step 4: Commit e CI**

```bash
git add build/android tests/python .github/workflows android/app/build.gradle.kts README.md docs/teste-manual-android.md
git commit -m "build(android): publicação, conferência do APK e roteiro do teste manual"
git push origin HEAD:main
```
Expected: `android` verde; o `build` do Windows não roda num push só de Android.

---

### Task 12: Revisão final e a versão de teste 0.1.0-rc.1

- [ ] **Step 1: Revisão final** do intervalo inteiro (do commit do plano até o último), contra a spec, com o revisor do executing-plans; correções com o CI verde.
- [ ] **Step 2: Versão de teste**

Run: `gh api -X POST repos/LucasCPena/starsonic-phone/actions/workflows/android-release.yml/dispatches -f ref=main -f 'inputs[versao]=0.1.0-rc.1'`
Expected: pre-release `android-v0.1.0-rc.1` com `StarsonicPhone-android-0.1.0-rc.1.apk`, `versao-android.json` e o código-fonte completo; `canal-teste-android` com o APK e o `versao-android.json`; `releases/latest` continua `v0.0.1-rc.…` ou outra versão do Windows; o SHA-256 do `versao-android.json` confere com o APK.
