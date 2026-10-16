# Starsonic Phone para Android 0.2 (ramal completo) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versão de teste 0.2.0-rc.1 do Starsonic Phone para Android: segunda ligação (atender outra e alternar), transferência com consulta, conferência a três e contatos do celular, sem nenhum servidor novo.

**Architecture:** As funções novas entram primeiro no motor C++ (`starsonic/phone`, pjsua2), que passa a guardar até duas ligações com uma ativa, faz o REFER com Replaces e junta as duas na mesa de áudio do PJSIP; os testes do motor rodam no Linux contra o registrador falso, que aprende o REFER com Replaces. A ponte JNI expõe o que entrou. No app, o `CallManager` passa a cuidar de duas ligações, da consulta e da conferência, o Telecom ganha espera e conferência, e a tela de chamada ganha os dois cartões. Os contatos ficam atrás de uma interface (`ContactsSource`) com a implementação do Android e uma de teste; a regra dos números dos contatos fica no núcleo C++ com o perfil.

**Tech Stack:** o mesmo da etapa 1: C++14, doctest, PJSIP 2.17 (pjsua2), Kotlin, Jetpack Compose (Material 3), Python 3 (registrador falso), GitHub Actions com o emulador.

**Spec:** `docs/superpowers/specs/2026-10-16-starsonic-phone-android-0.2-design.md` (aprovada em 16/10/2026). Vale em tudo o que ela não muda: `docs/superpowers/specs/2026-10-14-starsonic-phone-android-design.md`.

## Global Constraints

- **Herdadas da etapa 1** (`docs/superpowers/plans/2026-10-14-android-etapa-1.md`, Global Constraints): versões fixas, identidade, marca, links, textos da etapa 1, valores do motor, dados, atualização, publicação, regras do repositório (literais C/C++ só em ASCII, `python3 build/check_source_text.py`; nada em `microsip/`; nenhum "MicroSIP"), commits direto no `main` em português com as linhas de atribuição da sessão, e `$SCRATCH` = o scratchpad da sessão.
- **Muda:** "uma ligação por vez" vira **até duas ligações, uma ativa**: a segunda que chega com uma ligação confirmada (ativa ou em espera) toca; com uma ligação ainda não confirmada (tocando, chamando, atendendo) ou com duas, 486 e `OnRejectedBusy`. Uma ligação da operadora em andamento continua bloqueando (`incomingPermitted` false → 486).
- **Áudio:** só a ligação ativa fica ligada ao dispositivo de som; a em espera fica em `sendonly` sem mídia; na conferência, as duas ficam `sendrecv`, ligadas ao dispositivo e entre si. Mudo = o dispositivo de captura (vale para tudo).
- **Textos exatos (pt-BR), além dos da etapa 1:**
  - Tela de chamada: faixa `Ligação de <nome ou número>` com `Atender` e `Recusar`; cartão `Em espera`, ou `Em espera · transferência` (o cliente, durante a consulta com o colega ativo); `Chamando…` na feita; botões `Alternar`, `Nova ligação`, `Juntar`, `Separar`, `Consultar`, `Transferir agora`, `Concluir transferência`, `Cancelar`; título `Conferência`.
  - Avisos (2 s, pelo `endMessage`): `<nome ou número>: <CallEndMessage>` (o colega da consulta não atendeu; ex.: `2002: Não atendeu`); `<nome ou número> desligou` (a em espera ou um dos dois da conferência caiu); `O servidor não aceitou a transferência.` (REFER ou NOTIFY recusados).
  - Contatos: aba `Contatos`; busca `Buscar contato`; aviso `Permita o acesso aos contatos para ligar pelo nome.` com o botão `Permitir`; escolha do número com os números do contato.
  - Nome mostrado = o contato do celular (`lookup`) → senão o nome que a central mandou → senão o número.
- **Números dos contatos** (`ContactDialString(raw, ddi, prefixo)`, núcleo): `NormalizeDialString` primeiro; `+<ddi>` na frente sai; outro número que começa com `+` é discado como está, sem prefixo; o `prefixo` entra na frente só do que sobrou com mais de 6 dígitos. Perfil `[conta]`: `ddi=55` e `prefixo_externo=` (vazio = nenhum); `branding/perfil.ini` ganha as duas linhas com os padrões.
- **Permissão nova:** só `android.permission.READ_CONTACTS`, pedida na aba Contatos; nenhuma outra.
- **Ids no motor:** o id 0 em `AudioLinks` é o dispositivo de som.
- **Onde roda:** como na etapa 1 — C++ e Python aqui; Gradle, NDK e emulador só no GitHub Actions. Para os testes Kotlin, o RED é um commit enviado cujo CI falha nos testes novos (anotar o id do run no ledger) e o GREEN é o commit seguinte.

## Review Focus

1. Segunda ligação chegando com a primeira ainda tocando ou chamando (não confirmada) → ocupado, sem duas tocando ao mesmo tempo. Teste `a second call gets busy while the first is still ringing` (Task 1) e `a second incoming call while dialing is rejected busy` (Task 7).
2. O cliente desliga no instante em que o colega da consulta atende (ou vice-versa) → a consulta vira uma ligação normal com quem ficou, sem botão de Concluir perdido e sem REFER para uma ligação que acabou. Teste `the client hanging up during the consult leaves a normal call with the colleague` (Task 9).
3. Sair (logout) com duas ligações ou em conferência → as duas desligam, o Telecom recebe os dois `disconnect` e a conferência some. Teste `logout during a conference ends both calls` (Task 10).
4. O Telecom desliga só a ligação em espera (o fone Bluetooth, ou o Android) → só ela acaba; a ativa continua. Teste `disconnecting the held call from Telecom ends only that call` (Task 7).
5. Contato com `+55` e DDD, outro com `+1`, um ramal curto e um número já com o prefixo → só o externo longo ganha o prefixo, e o `+1` segue como está. Teste `ContactDialString strips the DDI and adds the prefix to long numbers` (Task 5).

---

### Task 1: Motor — duas ligações e a ativa

**Files:**
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`, `starsonic/phone/EngineCall.h`, `starsonic/phone/EngineCall.cpp`
- Modify: `tests/phone/engine_fixture.h` (o listener de teste recebe `OnTransfer` vazio, para compilar; o evento é da Task 3)
- Test: `tests/phone/test_engine_calls.cpp`

**Interfaces:**
- Consumes: `SipEngine`, `CallTable`, `EngineListener` (etapa 1); comandos `RING`, `HANGUP` e `LOG` do registrador falso.
- Produces:
  - `CallTable` guarda até duas ligações (`struct Slot { EngineCall* call; int callId; int pjsuaId; bool held; }`, duas vagas) e uma `activeId_`.
  - `int SipEngine::MakeCall(const std::string& number)` — com uma ligação confirmada em andamento, ela vai para a espera (sendonly, mídia fora do dispositivo) e a nova sai; com uma não confirmada, ou duas, -1.
  - `bool SipEngine::Answer(int callId)` — atendendo a segunda, a outra vai para a espera e a atendida vira a ativa.
  - `bool SipEngine::Activate(int callId)` — `callId` vira a ativa: a outra (confirmada, não em espera) vai para a espera; `callId` é retomada se estava em espera; só ela fica ligada ao dispositivo de som. false: id desconhecido ou não confirmada.
  - `bool SipEngine::SetHold(int callId, bool hold)` — igual; `hold=false` numa ligação com outra ativa põe a outra em espera (é um `Activate`).
  - `int SipEngine::CallCount() const`; `bool HasCall() const` continua (`CallCount() > 0`).
  - `std::vector<int> SipEngine::AudioLinks(int callId) const` — os ids para onde a mídia de `callId` transmite: `0` = o dispositivo de som; vazio em espera ou sem mídia.
  - Regra da ligação que chega (`CallTable::Incoming`): sem ligação, ou com uma confirmada → `OnIncomingCall` e 180; com uma não confirmada, ou duas → 486 e `OnRejectedBusy`; fechando → 480.
  - `Hangup` da ativa não retoma a outra (isso é o app, pelo `Activate`).

- [ ] **Step 1: Testes que falham** em `tests/phone/test_engine_calls.cpp` (registrado por UDP, registrador com `--control-port`):
  - `a second incoming call rings while one is active` — `RING 2001`, `Answer`, `Confirmed`; outro `RING 2001` → `OnIncomingCall(id2, "3001", "Cliente Teste")` (não `OnRejectedBusy`), `CallCount() == 2`; `Answer(id2)` → o registrador anota `inv-out 2001 200` duas vezes e `reinv-in 2001 sendonly` (o re-INVITE de espera da primeira; as ligações do RING são com o ramal 2001, por isso o alvo é 2001); `AudioLinks(id1)` vazio e `AudioLinks(id2) == {0}`.
  - `a second call gets busy while the first is still ringing` — `RING 2001` sem atender; outro `RING 2001` → `inv-out 2001 486` e `OnRejectedBusy`; `CallCount() == 1`.
  - `a third call gets busy` — duas atendidas; `RING 2001` → `inv-out 2001 486` e `OnRejectedBusy`.
  - `Activate switches the active call` — duas atendidas (id2 ativa); `Activate(id1)` → `reinv-in 2001 sendrecv` (id1) e `reinv-in 2001 sendonly` (id2), `AudioLinks(id1) == {0}`, `AudioLinks(id2)` vazio; `Activate(id1)` de novo → true e nada muda.
  - `MakeCall during a confirmed call holds it` — `RING 2001`, `Answer`, `Confirmed`; `MakeCall("2002")` → id > 0, `reinv-in 2001 sendonly`, a nova `Confirmed` com `AudioLinks == {0}`; `CallCount() == 2`.
  - `MakeCall during a ringing call is refused` — `RING 2001` sem atender; `MakeCall("2002") == -1`.
  - `hanging up the active call leaves the other on hold` — duas; `Hangup(id2)` → `Disconnected` de id2, `CallCount() == 1`, `AudioLinks(id1)` vazio (segue em espera até `Activate(id1)` → `{0}`).
  - `destroying the engine with two calls is safe` — destrói com duas; nenhum evento depois.
  - Os testes antigos `a second call gets busy while one is active` (etapa 1) passa a ser o caso "ainda tocando" acima: ajustar o nome e o cenário.

- [ ] **Step 2: Rodar e ver falhar** — Run: `cmake --build $SCRATCH/bp -j 8 2>&1 | tail -3`. Expected: erros de compilação (`Activate`, `CallCount`, `AudioLinks` não existem).

- [ ] **Step 3: Implementar** — `CallTable` com duas vagas e a ativa; `Incoming` com a regra nova; a mídia (`onCallMediaState`) liga ao dispositivo só a ativa (`AudioMedia::startTransmit` com o `audDevManager().getCaptureDevMedia()`/`getPlaybackDevMedia()`), e `Activate`/`SetHold` fazem `setHold` + `reinvite(PJSUA_CALL_UNHOLD)` como na etapa 1, agora por vaga; `AudioLinks` lê `getAudioMedia` e os `confPortInfo().listeners` da porta da ligação (0 → o dispositivo). Toda chamada à API continua serializada no motor.

- [ ] **Step 4: Rodar e ver passar** — Run: `$SCRATCH/bp/phone_tests | tail -2 && python3 build/check_source_text.py`. Expected: `SUCCESS` e `ok`.

- [ ] **Step 5: Commit e CI**

```bash
git add starsonic/phone tests/phone
git commit -m "feat(phone): duas ligações no motor, com uma ativa (Activate, CallCount, AudioLinks)"
git push origin HEAD:main
```
Expected: `android` (`Motor de ligações (Linux)`) verde; o job do emulador também (o app ainda recusa a segunda com 486 pelo CallManager, e o teste `secondCallDuringACallGetsBusy` continua valendo até a Task 7).

---

### Task 2: Registrador falso — REFER com Replaces e o resultado configurável

**Files:**
- Modify: `tests/smoke/fake_registrar.py`
- Modify: `tests/phone/registrar_fixture.h` (nada novo além de `Control` já existir; conferir)
- Test: `tests/smoke/test_fake_registrar.py` (novo, `python3 -m unittest`), com o registrador em processo (sem rede: as funções `_on_refer`, `command` e `_notify` chamadas direto com mensagens montadas)

**Interfaces:**
- Consumes: o registrador da etapa 1 (`_on_refer`, `_notify`, `command`).
- Produces:
  - `LOG`: `refer-in <alvo> <destino>` (como hoje) ganha ` replaces=known` ou ` replaces=unknown` quando o `Refer-To` traz `Replaces=`: `known` se o Call-ID do Replaces é de um diálogo que o registrador conhece (uma ligação do telefone para ele, ou uma do RING); senão `unknown`.
  - Comandos de controle: `REFER_REPLY <código>` (a resposta ao REFER; padrão 202; com código ≥ 300, nenhum NOTIFY) e `REFER_NOTIFY <código>` (o sipfrag do NOTIFY; padrão 200). Os dois devolvem `OK` e valem até o próximo comando ou o próximo `RESET` (novo: volta aos padrões).
  - Com `refer-in … replaces=known` e NOTIFY 200, o registrador não faz mais nada: quem desliga as duas é o telefone (BYE das duas, `bye-in` duas vezes).

- [ ] **Step 1: Testes que falham** em `tests/smoke/test_fake_registrar.py`:
  - `test_refer_with_replaces_logs_known_dialog` — um INVITE do telefone para `2003` aceito, depois um REFER para `2002` com `Refer-To: <sip:2003@ci?Replaces=<call-id do INVITE>%3Bto-tag%3D…%3Bfrom-tag%3D…>` → o LOG tem `refer-in 2002 2003 replaces=known`.
  - `test_refer_with_unknown_replaces_logs_unknown` — Call-ID inventado → `replaces=unknown`.
  - `test_refer_reply_command_changes_the_response` — `REFER_REPLY 603` → a resposta ao REFER é 603 e não há NOTIFY; `RESET` → 202 de novo.
  - `test_refer_notify_command_changes_the_sipfrag` — `REFER_NOTIFY 486` → o NOTIFY traz `SIP/2.0 486 Busy Here` no corpo.
- [ ] **Step 2: Rodar e ver falhar** — Run: `python3 -m unittest tests/smoke/test_fake_registrar.py 2>&1 | tail -3`. Expected: `FAIL`/`ERROR` (sem `replaces=` no log, comandos desconhecidos).
- [ ] **Step 3: Implementar** — em `_on_refer`, decodificar o `Replaces` do `Refer-To` (`urllib.parse.unquote`), procurar o Call-ID em `self.answers` e `self.calls`; `self.refer_reply`/`self.refer_notify` em `command`; o `_notify` monta o sipfrag com o código e a frase (`200 OK`, `486 Busy Here`, `603 Decline`; outros: `<código> Error`).
- [ ] **Step 4: Rodar e ver passar** — Run: `python3 -m unittest tests/smoke/test_fake_registrar.py 2>&1 | tail -3 && $SCRATCH/bp/phone_tests | tail -2`. Expected: `OK` e `SUCCESS` (os testes do motor da etapa 1 continuam passando).
- [ ] **Step 5: Commit e CI** — `git add tests/smoke && git commit -m "test(smoke): registrador falso com REFER com Replaces, REFER_REPLY e REFER_NOTIFY" && git push origin HEAD:main`. Expected: `android` verde. Acrescentar o `unittest` ao job `phone-linux` de `.github/workflows/android.yml` (uma linha) no mesmo commit.

---

### Task 3: Motor — transferência com consulta e o resultado das transferências

**Files:**
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`, `starsonic/phone/EngineCall.h`, `starsonic/phone/EngineCall.cpp`
- Modify: `tests/phone/engine_fixture.h` (o listener de teste grava `OnTransfer`)
- Test: `tests/phone/test_engine_calls.cpp`

**Interfaces:**
- Consumes: Task 1 (duas ligações), Task 2 (`replaces=`, `REFER_REPLY`, `REFER_NOTIFY`).
- Produces:
  - `virtual void EngineListener::OnTransfer(int callId, int sipCode) = 0;` — o resultado de `Transfer` e de `TransferAttended` da ligação `callId`: o código do NOTIFY (sipfrag) quando o REFER foi aceito (202), senão o código da resposta ao REFER. Chega uma vez por pedido. Com 2xx, o motor desliga `callId` (e, na consulta, também `targetCallId`) logo depois de avisar.
  - `bool SipEngine::TransferAttended(int callId, int targetCallId)` — `pj::Call::xferReplaces(target, prm)` na ligação `callId` (o cliente, em espera) apontando a `targetCallId` (o colega, ativa). false: ids desconhecidos, não confirmadas, ou iguais.
  - `bool SipEngine::Transfer(int callId, const std::string& number)` — igual, mas o resultado passa a chegar por `OnTransfer` (continua desligando com 2xx).

- [ ] **Step 1: Testes que falham** em `tests/phone/test_engine_calls.cpp`:
  - `attended transfer sends REFER with Replaces and ends both calls` — `MakeCall("2002")` (cliente) `Confirmed`; `MakeCall("2003")` (colega) `Confirmed` (o cliente foi para a espera: `reinv-in 2002 sendonly`); `TransferAttended(cliente, colega)` → `LOG` tem `refer-in 2002 2003 replaces=known`, `OnTransfer(cliente, 200)`, `Disconnected` dos dois, `bye-in 2002` e `bye-in 2003`, `CallCount() == 0`.
  - `attended transfer refused by the server keeps both calls` — `REFER_REPLY 603` → `OnTransfer(cliente, 603)`, nenhum `Disconnected`, `CallCount() == 2`, `AudioLinks(colega) == {0}`.
  - `attended transfer that fails in the NOTIFY keeps both calls` — `REFER_NOTIFY 486` → `OnTransfer(cliente, 486)`, `CallCount() == 2`.
  - `direct transfer reports its result` — `MakeCall("2002")`, `Transfer(id, "2003")` → `refer-in 2002 2003` (sem `replaces=`), `OnTransfer(id, 200)` e `Disconnected`; com `REFER_REPLY 603` → `OnTransfer(id, 603)` e a ligação continua.
  - `TransferAttended with one call is refused` — `TransferAttended(id, id) == false`; com um id inexistente, false.
- [ ] **Step 2: Rodar e ver falhar** — Run: `cmake --build $SCRATCH/bp -j 8 2>&1 | tail -3`. Expected: erros de compilação (`OnTransfer`, `TransferAttended`).
- [ ] **Step 3: Implementar** — `onCallTransferStatus` passa a emitir `OnTransfer` com `statusCode` e, com `finalNotify` e 2xx, desliga a ligação (e a `targetCallId` guardada na vaga); a resposta ao REFER fora de 2xx chega no mesmo callback (`statusCode` da resposta) → `OnTransfer` e nada mais.
- [ ] **Step 4: Rodar e ver passar** — Run: `$SCRATCH/bp/phone_tests | tail -2 && python3 build/check_source_text.py`. Expected: `SUCCESS` e `ok`.
- [ ] **Step 5: Commit e CI** — `git add starsonic/phone tests/phone && git commit -m "feat(phone): transferência com consulta (REFER com Replaces) e o resultado das transferências" && git push origin HEAD:main`. Expected: `android` verde.

---

### Task 4: Motor — conferência (juntar e separar)

**Files:**
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`, `starsonic/phone/EngineCall.cpp`
- Test: `tests/phone/test_engine_calls.cpp`

**Interfaces:**
- Consumes: Task 1 (`AudioLinks`, vagas, `Activate`).
- Produces:
  - `bool SipEngine::Join(int callId, int otherId)` — retoma a que estava em espera (sendrecv) e liga as duas ao dispositivo de som e entre si (`startTransmit` nos dois sentidos). A tabela fica em conferência: nenhuma é "a ativa"; `Activate` de uma das duas desfaz a conferência (é um `Split`).
  - `bool SipEngine::Split(int callId, int otherId)` — desfaz as ligações entre as duas na mesa; `otherId` vai para a espera; `callId` fica ativa.
  - Uma das duas acabando na conferência: a outra continua ligada ao dispositivo (vira uma ligação normal ativa).
  - `AudioLinks` na conferência: `{0, outro}` para cada uma.

- [ ] **Step 1: Testes que falham**:
  - `Join resumes the held call and links the two` — duas (`MakeCall("2002")`, `MakeCall("2003")`); `Join(a, b)` → `reinv-in 2002 sendrecv`, `AudioLinks(a) == {0, b}` e `AudioLinks(b) == {0, a}` (ordem não importa).
  - `Split holds the second call again` — depois do Join, `Split(a, b)` → `reinv-in 2003 sendonly`, `AudioLinks(a) == {0}`, `AudioLinks(b)` vazio.
  - `when one party leaves the conference the other stays active` — Join; `Hangup(b)` → `Disconnected` de b, `AudioLinks(a) == {0}`, `CallCount() == 1`.
  - `Activate during a conference splits it` — Join; `Activate(b)` → `reinv-in 2002 sendonly`, `AudioLinks(b) == {0}`, `AudioLinks(a)` vazio.
  - `Join with a ringing call is refused` — `RING 2001` sem atender e uma feita: `Join == false`.
- [ ] **Step 2: Rodar e ver falhar** — Run: `cmake --build $SCRATCH/bp -j 8 2>&1 | tail -3`. Expected: erros de compilação (`Join`, `Split`).
- [ ] **Step 3: Implementar** — a flag `conference_` na tabela; `onCallMediaState` religa conforme o estado (a mídia de uma ligação pode ser recriada no re-INVITE: a tabela refaz as ligações da mesa a cada `onCallMediaState`).
- [ ] **Step 4: Rodar e ver passar** — Run: `$SCRATCH/bp/phone_tests | tail -2 && python3 build/check_source_text.py`. Expected: `SUCCESS` e `ok`.
- [ ] **Step 5: Commit e CI** — `git add starsonic/phone tests/phone && git commit -m "feat(phone): conferência a três na mesa de áudio (Join e Split)" && git push origin HEAD:main`. Expected: `android` verde.

---

### Task 5: Núcleo — números dos contatos e as chaves do perfil

**Files:**
- Modify: `starsonic/core/CallMessages.h`, `starsonic/core/CallMessages.cpp`, `starsonic/core/Profile.h`, `starsonic/core/Profile.cpp`, `branding/perfil.ini`
- Test: `tests/test_call_messages.cpp`, `tests/test_profile.cpp`

**Interfaces:**
- Consumes: `NormalizeDialString`, `ParseProfile`, `AccountProfile`.
- Produces:
  - `std::wstring ContactDialString(const std::wstring& raw, const std::wstring& ddi, const std::wstring& prefix);` — regra de Global Constraints.
  - `AccountProfile::ddi` (`std::wstring`, padrão `L"55"`) e `AccountProfile::externalPrefix` (`std::wstring`, padrão vazio), das chaves `ddi` e `prefixo_externo` de `[conta]`; `ddi` só com dígitos (1 a 3), senão erro na linha; `prefixo_externo` com dígitos, `*` e `#`, ou vazio.
  - `branding/perfil.ini`: `ddi=55` e `prefixo_externo=` em `[conta]`, comentadas como no resto do arquivo.

- [ ] **Step 1: Testes que falham**:
  - `tests/test_call_messages.cpp`: `ContactDialString strips the DDI and adds the prefix to long numbers` — (`L"+55 (11) 5060-3000"`, `L"55"`, `L"0"`) → `L"01150603000"`; (`L"(11) 5060-3000"`, `L"55"`, `L"0"`) → `L"01150603000"`; (`L"2001"`, `L"55"`, `L"0"`) → `L"2001"`; (`L"+1 650 555 0100"`, `L"55"`, `L"0"`) → `L"+16505550100"`; (`L"+55 11 5060-3000"`, `L"55"`, `L""`) → `L"1150603000"`; (`L"+551150603000"`, `L"1"`, `L"0"`) → `L"+551150603000"` (o DDI não bate: fica como está, sem prefixo).
  - `tests/test_profile.cpp`: `ParseProfile reads ddi and prefixo_externo` — com as duas chaves → `ddi == L"55"`, `externalPrefix == L"0"`; sem elas → `L"55"` e vazio; `ddi=abc` → `ok == false` com a linha; `prefixo_externo=0*` → ok.
- [ ] **Step 2: Rodar e ver falhar** — Run: `cmake --build $SCRATCH/bt -j 8 2>&1 | tail -3`. Expected: erro de compilação (`ContactDialString`, `ddi`).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** — Run: `$SCRATCH/bt/starsonic_tests | tail -2 && python3 build/check_source_text.py`. Expected: `SUCCESS` e `ok`. O Windows compila o mesmo núcleo: nada mais muda lá.
- [ ] **Step 5: Commit e CI** — `git add starsonic/core tests branding/perfil.ini && git commit -m "feat(core): números dos contatos (ContactDialString) e as chaves ddi e prefixo_externo do perfil" && git push origin HEAD:main`. Expected: `android` e `build` (Windows) verdes.

---

### Task 6: Ponte JNI e o gateway com o que entrou no motor e no núcleo

**Files:**
- Modify: `android/app/src/main/cpp/jni_bridge.cpp`, `android/app/src/main/java/br/com/starsonic/phone/Native.kt`, `android/app/src/main/java/br/com/starsonic/phone/engine/SipGateway.kt`, `android/app/src/main/java/br/com/starsonic/phone/engine/NativeSipGateway.kt`, `android/app/src/main/java/br/com/starsonic/phone/core/CoreRules.kt` (e a implementação nativa dele)
- Modify: `android/app/src/test/java/br/com/starsonic/phone/call/CallFakes.kt` (`CallGateway` e `CallCore` com os métodos novos; `CallGateway` grava `activated`, `joined`, `split`, `attended` e simula `callCount`)
- Test: `android/app/src/androidTest/java/br/com/starsonic/phone/NativeLoadTest.kt` (a ponte responde)

**Interfaces:**
- Consumes: Tasks 1, 3, 4 e 5.
- Produces:
  - `SipGateway`: `fun activate(id: Int)`, `fun transferAttended(id: Int, targetId: Int)`, `fun join(id: Int, otherId: Int)`, `fun split(id: Int, otherId: Int)`, `fun callCount(): Int` (espera o motor, fora da thread principal).
  - `EngineEvents.onTransfer(callId: Int, code: Int)`.
  - `Native.contactDialString(raw: String, ddi: String, prefix: String): String`, `Native.profileDial(profileText: String): Array<String>` (`[ddi, prefixo_externo]`).
  - `CoreRules.contactDialString(raw: String, ddi: String, prefix: String): String`; `CoreRules.profileDial(profileText: String): Pair<String, String>`.

- [ ] **Step 1: Teste que falha** em `NativeLoadTest.kt`: `contactDialStringComesFromTheCore` — `Native.contactDialString("+55 (11) 5060-3000", "55", "0") == "01150603000"`; `Native.profileDial(perfil do APK)` → `("55", "")`. (A ponte do motor é conferida pelos testes do CallManager das Tasks 7 a 10 e pelo emulador.)
- [ ] **Step 2: Enviar e ver falhar** — commit + push; Expected: o job do emulador falha em `contactDialStringComesFromTheCore` (anotar o run).
- [ ] **Step 3: Implementar** — as funções JNI com a mesma conversão UTF-16 → wchar_t → UTF-8 da etapa 1; o gateway nativo serializa as chamadas novas na thread do motor como as outras; `onTransfer` entra na thread dos eventos.
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde (emulador inclusive).
- [ ] **Step 5: Commit** — mensagens: `feat(android): ponte JNI e gateway com Activate, TransferAttended, Join, Split, OnTransfer e ContactDialString`.

---

### Task 7: CallManager e Telecom com duas ligações

**Files:**
- Modify: `android/app/src/main/java/br/com/starsonic/phone/call/CallManager.kt`, `TelecomAdapter.kt`, `CallConnection.kt`, `CallConnectionService.kt` (`AndroidTelecom`)
- Modify: `android/app/src/test/java/br/com/starsonic/phone/call/CallFakes.kt` (`FakeTelecom` com `held`, `active`, `disconnected` por id)
- Test: `android/app/src/test/java/br/com/starsonic/phone/call/CallManagerTest.kt`

**Interfaces:**
- Consumes: Task 6 (`SipGateway` novo).
- Produces:
  - `CallUi` ganha `val id: Int`, `val second: SecondUi? = null`, `val conference: Boolean = false`, `val consult: ConsultUi? = null`; `data class SecondUi(val id: Int, val number: String, val name: String, val kind: SecondKind)`; `enum class SecondKind { RINGING, DIALING, HELD, ACTIVE }` (`ACTIVE` só na conferência, Task 10); `data class ConsultUi(val colleagueId: Int, val colleagueActive: Boolean)` (usada na Task 9; aqui sempre null).
  - `CallManager`: até duas `Call`; `fun answer()` atende a que toca (a outra vai para a espera: `gateway.answer` + `telecom.setOnHold(outra)`); `fun reject()`; `fun hangup()` desliga a ativa (ou recusa a que toca se só ela existe) e, havendo outra em espera, pede `gateway.activate(outra)` e `telecom.setActive(outra)` quando o `Disconnected` da ativa chega; `fun hangup(callId: Int)` desliga aquela ligação (ativa ou em espera; a em espera acaba sem mexer na ativa); `fun activate()` alterna (`gateway.activate`, `telecom.setOnHold`/`setActive`); `fun dial(raw)` com uma ligação `ACTIVE` em andamento abre a segunda (a ativa vai para a espera via o motor, e `telecom.setOnHold(ativa)` + `placeOutgoing`); `fun hold()` continua para uma ligação só (com duas, `hold` da ativa = `activate` da outra).
  - `onIncoming` com uma ligação confirmada e `incomingPermitted` → `telecom.addIncoming` e `second = RINGING`; com uma não confirmada, duas, ou não permitida → 486 e perdida (como hoje).
  - A em espera que cai (`Disconnected` dela) → `endMessage` `"<nome ou número> desligou"` e a ativa continua.
  - `TelecomAdapter`: `fun setOnHold(callId: Int)` (novo); `setActive(callId)` também retoma.
  - `CallConnection`: `connectionCapabilities = CAPABILITY_HOLD or CAPABILITY_SUPPORT_HOLD`; `onHold()` → `app.calls.holdFromTelecom(callId)` (a ativa vai para a espera sem outra ativa: só com uma ligação) e `onUnhold()` → `app.calls.activateFromTelecom(callId)`; `onDisconnect()` → `app.calls.hangup(callId)` (desliga **aquela** ligação, ativa ou em espera).
  - `AndroidTelecom.addIncoming` com outra ligação → mesma Connection de sempre (o notificador decide o toque, Task 8).

- [ ] **Step 1: Testes que falham** em `CallManagerTest.kt` (nomes exatos):
  - `a second incoming call rings while one is active`
  - `answering the second call holds the first`
  - `a second incoming call while dialing is rejected busy`
  - `a second incoming call not permitted by Telecom is rejected busy`
  - `a third incoming call is rejected busy`
  - `Alternar swaps the active call`
  - `hanging up the active call resumes the held one`
  - `the held call dropping shows the message and keeps the active one`
  - `dialing during an active call holds it and places the second`
  - `disconnecting the held call from Telecom ends only that call`
  - `logout with two calls hangs up both`
  Cada um confere o estado (`state.value`), as chamadas ao `CallGateway` e ao `FakeTelecom` (`held`, `active`, `disconnected`) e os Recentes (duas entradas, cada uma com a sua duração).
- [ ] **Step 2: Enviar e ver falhar** — commit + push. Expected: `android` falha nesses testes (anotar o run).
- [ ] **Step 3: Implementar** — a lista `calls` no lugar de `call`; `active` = a ativa; `publish()` monta `CallUi` da ativa com `second` da outra; a adoção do id da feita (`adopt`, `onDialed`) vale por ligação (a feita é a que tem `id == NO_ID` e `dialRequested`).
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde; o teste do emulador `secondCallDuringACallGetsBusy` muda na Task 8 (até lá ele falha: anotar no ledger e mantê-lo como `@Ignore` com o motivo, só neste intervalo).
- [ ] **Step 5: Commit** — `feat(android): CallManager e Telecom com duas ligações: segunda recebida, Alternar, Nova ligação e a volta sozinha`.

---

### Task 8: Tela de chamada com duas ligações e o toque de chamada em espera

**Files:**
- Modify: `android/app/src/main/java/br/com/starsonic/phone/call/CallScreen.kt`, `CallActivity.kt`, `IncomingCallNotifier.kt`
- Modify: `android/app/src/main/res/drawable/` (ícones `ic_alternar`, `ic_nova_ligacao` a partir dos Material Symbols `swap_horiz` e `add_call`, como os da etapa 1)
- Test: `android/app/src/androidTest/java/br/com/starsonic/phone/CallFlowTest.kt`

**Interfaces:**
- Consumes: Task 7 (`CallUi.second`, `activate`, `dial` na ligação).
- Produces:
  - `CallActions` ganha `activate: () -> Unit` e `dial: (String) -> Boolean`.
  - Tags: faixa `segunda-ligacao` com `atender-segunda` e `recusar-segunda`; cartão da outra `cartao-espera`; `alternar`; `nova-ligacao`, campo `nova-numero`, `nova-ligar`, `nova-cancelar`.
  - `IncomingCallNotifier.showIncoming(...)` com outra ligação em andamento (`app.calls.state.value?.phase == ACTIVE`): a notificação sem `fullScreenIntent`, sem o toque e sem o canal `ligacoes` (usa `ligacoes-silenciadas`), e o `ToneGenerator(STREAM_VOICE_CALL)` toca `TONE_SUP_CALL_WAITING` a cada 3 s até `stopRinging`, com a vibração curta (`VIBRATION` da etapa 1, uma vez a cada bipe).

- [ ] **Step 1: Testes que falham** em `CallFlowTest.kt` (emulador, registrador falso; o registrador liga para 2001 duas vezes):
  - `secondCallRingsAsABarAndIsAnswered` — `RING 2001`, atender; `RING 2001` → `segunda-ligacao` com o texto `Ligação de 3001`; `atender-segunda` → `cartao-espera` com `Em espera`; `alternar` → o cartão de cima mostra o outro; `HANGUP 2001` (o registrador desliga a primeira que ele fez) → a tela volta a uma ligação.
  - `hangingUpTheActiveCallResumesTheHeldOne` — duas; `desligar` → a outra continua, `cartao-espera` some, o `LOG` tem `reinv-in 2001 sendrecv`.
  - `secondCallDuringACallGetsBusy` vira `thirdCallDuringTwoCallsGetsBusy` (duas, e um terceiro `RING 2001` → `inv-out 2001 486`).
  - `newCallFromTheCallScreenHoldsTheFirst` — uma recebida atendida; `nova-ligacao`, `nova-numero` = `2002`, `nova-ligar` → `LOG` com `reinv-in 2001 sendonly` e `inv-in 2002 200`.
- [ ] **Step 2: Enviar e ver falhar** — commit + push. Expected: o emulador falha nos novos (anotar o run).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde, inclusive `thirdCallDuringTwoCallsGetsBusy`.
- [ ] **Step 5: Commit** — `feat(android): tela de chamada com duas ligações, faixa da segunda, Alternar, Nova ligação e o bipe de chamada em espera`.

---

### Task 9: Transferência com consulta no app

**Files:**
- Modify: `android/app/src/main/java/br/com/starsonic/phone/call/CallManager.kt`, `CallScreen.kt`, `CallActivity.kt`
- Modify: `android/app/src/main/res/drawable/` (`ic_consultar` de `phone_forwarded`, `ic_transferir_agora` de `arrow_forward`, `ic_concluir` de `check`)
- Test: `android/app/src/test/java/br/com/starsonic/phone/call/CallManagerTest.kt`, `android/app/src/androidTest/java/br/com/starsonic/phone/CallFlowTest.kt`

**Interfaces:**
- Consumes: Tasks 7 e 8; `gateway.transferAttended`, `EngineEvents.onTransfer`.
- Produces:
  - `CallManager`: `fun consult(raw: String): Boolean` (como `dial` na ligação, marcando a feita como o colega e guardando o id do cliente), `fun completeTransfer()` (`gateway.transferAttended(cliente, colega)`; só com o colega confirmado), `fun cancelConsult()` (desliga o colega; o cliente volta pelo `activate` quando o `Disconnected` do colega chega), `onTransfer(callId, code)`: 2xx → nada (os `Disconnected` vêm do motor, sem aviso nem Recentes como perdida: os dois entram como feita/recebida normais); outro código → `endMessage` `O servidor não aceitou a transferência.`; `transfer(raw)` (direta) passa a tratar o `onTransfer` também.
  - O colega não atende (`Disconnected` do colega com código de 400 a 699 sem `activeSince`): o cliente volta (`activate`) e `endMessage` `"<nome ou número>: <callEndMessage>"`. O cliente desliga durante a consulta: `consult` vira null e o colega continua como ligação normal, com `"<nome ou número> desligou"`.
  - `CallUi.consult = ConsultUi(colleagueId, colleagueActive)`; `second.kind == HELD` com o rótulo `Em espera · transferência` quando `consult != null && consult.colleagueActive`.
  - `CallActions`: `consult: (String) -> Boolean`, `completeTransfer: () -> Unit`, `cancelConsult: () -> Unit`.
  - Tags: na tela de Transferir, `transferir-consultar` e `transferir-agora` (o `transferir-confirmar` de hoje vira `transferir-agora`; o teste `outgoingCallIsHeldAndTransferred` muda a tag); na consulta, `concluir-transferencia`, `cancelar-consulta`, `alternar`.

- [ ] **Step 1: Testes que falham**:
  - `CallManagerTest.kt`: `Consultar holds the client and dials the colleague`, `Concluir transferência sends the attended transfer and both calls end`, `a refused attended transfer shows the message and keeps both calls`, `Cancelar ends the colleague and resumes the client`, `the colleague not answering resumes the client with the message` (`CallCore.callEndMessage(480)` = `fim 480` → `"2002: fim 480"`), `the client hanging up during the consult leaves a normal call with the colleague`, `a refused direct transfer shows the message`.
  - `CallFlowTest.kt`: `attendedTransferCompletesAndEndsBothCalls` — `RING 2001` atendida (o cliente), `transferir`, `transferir-numero` = `2003`, `transferir-consultar` → `cartao-espera` com `Em espera · transferência` e `inv-in 2003 200`; `concluir-transferencia` → `LOG` com `refer-in 2001 2003 replaces=known`, a tela de chamada fecha, `bye-in` duas vezes; `attendedTransferRefusedKeepsBothCalls` — `REFER_REPLY 603` antes de concluir → `aviso-ligacao` com `O servidor não aceitou a transferência.` e as duas continuam (`RESET` no fim).
- [ ] **Step 2: Enviar e ver falhar** — commit + push. Expected: falha nos novos (anotar o run).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde.
- [ ] **Step 5: Commit** — `feat(android): transferência com consulta: Consultar, Concluir, Cancelar e o resultado do servidor`.

---

### Task 10: Conferência no app

**Files:**
- Modify: `android/app/src/main/java/br/com/starsonic/phone/call/CallManager.kt`, `CallScreen.kt`, `TelecomAdapter.kt`, `CallConnectionService.kt` (`AndroidTelecom`), `CallConnection.kt`
- Create: `android/app/src/main/java/br/com/starsonic/phone/call/CallConference.kt` (`android.telecom.Conference` self-managed com as duas Connections)
- Modify: `android/app/src/main/res/drawable/` (`ic_juntar` de `call_merge`, `ic_separar` de `call_split`)
- Test: `CallManagerTest.kt`, `CallFlowTest.kt`

**Interfaces:**
- Consumes: Tasks 7 a 9; `gateway.join`/`split`.
- Produces:
  - `CallManager`: `fun join()` (duas ligações confirmadas, sem consulta → `gateway.join(a, b)`, `telecom.joinConference(a, b)`, `conference = true`), `fun split()` (`gateway.split(ativa, outra)`, `telecom.splitConference()`; a última que entrou vai para a espera), `hangup()` na conferência desliga as duas; um dos dois caindo → `conference = false`, a outra continua ativa, `"<nome ou número> desligou"`; `onLogout` desliga as duas e desfaz a conferência.
  - `TelecomAdapter`: `fun joinConference(callIdA: Int, callIdB: Int)`, `fun splitConference()`; `AndroidTelecom` cria a `CallConference` (`PROPERTY_SELF_MANAGED`, `setActive`, `addConnection` das duas) e a destrói no `split`/fim; `CallConference.onDisconnect()` → `app.calls.hangup()`; `onSeparate(connection)` → `app.calls.split()`.
  - `CallUi.conference = true` → a tela mostra `Conferência`, os dois nomes ou números, o tempo desde o Juntar (`CallUi.conferenceSinceMillis`, novo campo), os botões Mudo, Teclado, Viva-voz (ou a escolha), `Separar` e `Desligar`; `second` traz a outra com `kind = SecondKind.ACTIVE`.
  - Tags: `juntar`, `separar`, título `conferencia`.

- [ ] **Step 1: Testes que falham**:
  - `CallManagerTest.kt`: `Juntar joins both calls into a conference`, `Separar holds the last call again`, `hanging up a conference ends both calls`, `a party leaving the conference leaves a normal call`, `logout during a conference ends both calls`, `Juntar during a consult is not offered` (`join()` não faz nada com `consult != null`).
  - `CallFlowTest.kt`: `conferenceJoinsTwoCallsAndSplits` — `RING 2001` atendida, `nova-ligacao` para `2002`, `juntar` → `conferencia` com `Conferência`, `LOG` com `reinv-in 2001 sendrecv`; `separar` → `cartao-espera` e `reinv-in 2002 sendonly`; `juntar` de novo e `desligar` → o LOG tem `bye-in 2001` e `bye-in 2002` (o telefone desliga as duas; o BYE da ligação do RING chega ao registrador como `bye-in 2001`).
- [ ] **Step 2: Enviar e ver falhar** — commit + push. Expected: falha nos novos (anotar o run).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde. Se a `Conference` self-managed falhar no emulador (risco 1 da spec), aplicar o plano B da spec (as duas Connections, uma ativa e a outra em espera só para o Telecom) e registrar um `Ruling`.
- [ ] **Step 5: Commit** — `feat(android): conferência a três: Juntar, Separar, Desligar para todos e a Conference do Telecom`.

---

### Task 11: Contatos do celular

**Files:**
- Create: `android/app/src/main/java/br/com/starsonic/phone/contacts/ContactsSource.kt` (`interface ContactsSource`, `data class Contact(val name: String, val numbers: List<String>)`), `AndroidContactsSource.kt`, `ContactsScreen.kt`
- Modify: `android/app/src/main/java/br/com/starsonic/phone/App.kt` (o `contacts: ContactsSource`), `main/MainActivity.kt` (a terceira aba), `main/DialerScreen.kt` (sugestões), `main/RecentsScreen.kt` (o nome), `call/CallManager.kt` (o `lookup` no nome: `displayName`), `call/CallScreen.kt` (nome e a busca nos campos de número), `call/IncomingCallNotifier.kt` (o nome), `AndroidManifest.xml` (`READ_CONTACTS`), `service/SipService.kt` ou onde o perfil é lido (o `ddi` e o `prefixo_externo` para o `CallManager`)
- Modify: `build/android/check_apk.py` (as permissões do APK = a lista esperada, com `READ_CONTACTS` e sem outra nova)
- Modify: `android/app/src/test/java/br/com/starsonic/phone/call/CallFakes.kt` (`FakeContactsSource`)
- Test: `android/app/src/test/java/br/com/starsonic/phone/contacts/ContactsTest.kt` (novo), `CallManagerTest.kt`, `android/app/src/androidTest/java/br/com/starsonic/phone/ContactsFlowTest.kt` (novo)

**Interfaces:**
- Consumes: Task 6 (`CoreRules.contactDialString`, `profileDial`).
- Produces:
  - `interface ContactsSource { fun available(): Boolean; fun lookup(number: String): String?; fun search(text: String): List<Contact> }` — `search("")` = todos, em ordem alfabética; `lookup` pelo `PhoneLookup` do Android; `available()` = a permissão concedida.
  - `CallManager(…, contacts: ContactsSource, dialRule: (String) -> String)`: `fun dialContact(number: String)` = `dial(dialRule(number))`; `CallUi.name` e os Recentes mostrados usam `contacts.lookup(number) ?: name`; a notificação idem (pelo `IncomingCallNotifier`, que recebe o nome já resolvido).
  - `ContactsScreen(source, onCall: (String) -> Unit)`: tags `aba-contatos`, `contatos-busca`, `contatos-permitir`, item `contato-<nome>`, escolha do número `numero-<n>`.
  - `DialerScreen(onDial, suggest: (String) -> List<Contact>)`: até 3 sugestões, tag `sugestao-<nome>`.
  - `check_apk.py`: falha se o conjunto de `uses-permission` do APK for diferente da lista esperada (a da etapa 1 mais `android.permission.READ_CONTACTS`).

- [ ] **Step 1: Testes que falham**:
  - `ContactsTest.kt` (JVM, com `FakeContactsSource`): `search filters by name and number`, `a contact without numbers is not listed`, `lookup prefers the phone contact over the server name` (via `CallManager`: `ring(number = "3001", name = "Cliente Teste")` com o contato `Maria Silva` em 3001 → `state.value?.name == "Maria Silva"`), `the dial rule is applied to contact numbers` (`dialContact("+55 (11) 5060-3000")` → `CallGateway.dialed == "01150603000"` com a regra de teste que devolve isso).
  - `ContactsFlowTest.kt` (emulador): antes do teste, `content insert` de um contato `Maria Silva` com o número `3001`, e `GrantPermissionRule(READ_CONTACTS)`; `contactsTabListsAndCalls` — `aba-contatos`, `contatos-busca` = `Mar`, `contato-Maria Silva` → o LOG tem `inv-in 3001 200`; `incomingCallShowsTheContactName` — `RING 2001` → a tela de chamada mostra `Maria Silva`; `withoutThePermissionTheTabAsksForIt` (um teste sem o `GrantPermissionRule`, com `pm revoke` no começo) → `contatos-permitir` visível.
  - `check_apk.py`: a conferência roda no workflow sobre o APK de verdade, sem teste próprio; o RED é o workflow falhando na lista de permissões quando `READ_CONTACTS` ainda não está no manifesto (ordem: primeiro o `check_apk` com a lista nova no commit RED, depois o manifesto no GREEN).
- [ ] **Step 2: Enviar e ver falhar** — commit + push. Expected: falha nos novos e no `check_apk` (anotar o run).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Enviar e ver passar** — commit + push. Expected: `android` verde.
- [ ] **Step 5: Commit** — `feat(android): contatos do celular: aba Contatos, nome nas ligações e nos Recentes, sugestões no Teclado e a regra dos números`.

---

### Task 12: Revisão final, documentação e a versão de teste 0.2.0-rc.1

**Files:**
- Modify: `docs/teste-manual-android.md` (itens 10 a 14 da spec 11.3), `README.md` (seção Android: o que a 0.2 faz), `docs/superpowers/specs/2026-10-16-starsonic-phone-android-0.2-design.md` (Status: implementada em <data>), a política de privacidade: só uma nota em `docs/` dizendo o que mudou para a LGPD (a página do site é da Starsonic)
- Test: os workflows `android` e `android-release`

- [ ] **Step 1: Revisão final** — `review-package` do `main` desde o commit anterior à Task 1 e o revisor na Fable (o mais capaz); uma rodada de correções com RED→GREEN; os menores no ledger.
- [ ] **Step 2: Documentação** — o roteiro manual com os itens 10 a 14 (dois ramais de teste), o README e o Status da spec. Commit: `docs(android): roteiro manual da 0.2, README e o status da spec`.
- [ ] **Step 3: A versão** — `git tag android-v0.2.0-rc.1 && git push origin android-v0.2.0-rc.1`; o `android-release` publica no `canal-teste-android`. Run: `bash $SCRATCH/verify-android-rc.sh 0.2.0-rc.1 <commit>` (o `verify-android-rc1.sh` da etapa 1 com a versão como argumento). Expected: `OK`.
- [ ] **Step 4: Entrega** — a lista de rulings e de menores deferidos, o link do APK, e o que fica com a Starsonic: o teste manual nos dois celulares com dois ramais de teste, e a confirmação do número externo (`prefixo_externo`).
