# rc.3: atalhos com BLF, administrador, bipe e status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 0.1.0-rc.3 of the Windows app with:
- up to 8 shortcuts, with BLF and call pickup;
- an admin area behind Ctrl + P;
- the end-of-call beep;
- the new status-dot priorities (Não perturbe and internet).

**Architecture:**
- The engine gains dialog-event subscriptions (BLF), plus a "network available" switch. Both are additive, so Android is unchanged.
- The portable desktop core gains:
  - stores: `AtalhosStore` and `AdminStore`;
  - the admin password check (PBKDF2-SHA256);
  - the new commands and state, wired in `DesktopApp`/`Protocol`.
- The Windows host adds the network monitor, the BLF events from `EngineHost`, the tray mapping and the runtime update channel.
- The Preact UI adds the Atalhos tab, the editor, the in-call panel, the admin dialog and screen, the beep, and the dot table.

**Tech Stack:** C++17 (pjsua2 2.17, Win32, WebView2), TypeScript + Preact + esbuild, Playwright, Python fake registrar, GitHub Actions windows-2022.

**Spec:** `docs/superpowers/specs/2026-10-22-starsonic-phone-windows-w3-atalhos-blf-adm-design.md`. The approved canvas is "Starsonic Phone Windows — atalhos, administrador e status" (artifact Pn7fMhq5aGBTXWAgHAZA4e); its files are in `$SCRATCH/canvas-atalhos/project/*.dc.html`.

## Global Constraints

- **Repo rules.**
  - C/C++ literals are ASCII only (`python3 build/check_source_text.py`).
  - Nothing changes in `microsip/` or `android/`; android.yml stays green, since the engine is shared.
  - No "MicroSIP" in the new app.
  - Commits go straight to `main`, in Portuguese, with the two session attribution lines.
  - Never create a remote branch, force push, tag or release outside Task 6.
  - Never read or print `$SCRATCH/t11/chave/` or `$SCRATCH/t11/entrega/`.
- **Where things run.**
  - Portable C++, Python, Node and Playwright run here. Chromium is in `/opt/pw-browsers`; never run `playwright install`.
  - Windows-only code runs on GitHub Actions. RED is a pushed commit whose CI fails on the new test (note the run id); GREEN is the next commit.
- **Version:** `0.1.0-rc.3`, test channel.
- **Limits:** at most 8 shortcuts. Name 1–24 characters. Number is digits, `*`, `#` and `+`, 1–32 characters. Actions: `ligar`, `transferir`, `consulta`, `teclas`.
- **BLF states and colors:**
  - livre `#22c55e`
  - tocando `#00c2cb`, blinking slowly
  - ocupado `#d64545`
  - desconectado `#b9c4e6`
  - The word always appears next to the dot.
- **Beep:** 425 Hz, 0.25 s, twice with a 0.15 s gap. It plays on the call's Alto-falante device, only when an answered call ends and no other call is active. Setting `bipeFim`, default `true`.
- **Admin password:**
  - `01422@Star`, stored only as PBKDF2-SHA256 (100 000 iterations, 16-byte salt, 32-byte key).
  - After 5 wrong tries in a row, wait 30 s.
  - The session closes after 10 min idle, on "Sair da área do administrador", or when the window closes.
- **Admin defaults:**
  - The Não perturbe and Atender automático buttons are shown.
  - BLF off.
  - Pickup off, with an empty code.
  - Servers from `perfil.ini` (starcloud-starsonic.com.br 5060, starcloud1-starsonic.com.br 35060).
  - The update channel is the build's.
- **Dot priority** (first match wins):

  | Condition | Dot | Text |
  |---|---|---|
  | sem internet | gray | `Sem internet · tentando de novo` |
  | conectando | cyan | `Conectando…` |
  | erro | gray + warning | the existing error text |
  | em ligação | red | `Ocupado · em ligação` |
  | Não perturbe | red | `Não perturbe · as ligações não tocam` |
  | conectado | green | `Conectado · <servidor>` |

  The tray follows the same table.
- **Exact pt-BR texts:** spec section 11, verbatim.
- **Data files** (`%APPDATA%\Starsonic Phone\`, atomic writes): `atalhos.json`, and `admin.json` protected through `SecretCipher` (DPAPI in the app, the test cipher in tests).

## Review Focus

1. **The BLF NOTIFY arrives for a shortcut that was just removed or edited, or after an account switch.** The UI never shows a stale state. Subscriptions follow the current shortcut list and the account in use. Test: `blf follows the shortcut list and the account in use` (Task 3).
2. **Not perturbe is hidden by the admin while it is on.** It is forced off at once, the dot turns green, and incoming calls ring again. Test: `hiding Nao perturbe forces it off` (Task 3).
3. **The internet drops during a call.** The call is not redialed, the dot goes gray, and when the internet returns the account re-registers. The beep plays once if the dropped call was answered. Test: `internet loss mid-call drops to gray and beeps once` (Task 3).
4. **Ctrl + P is pressed with the admin dialog already open, or in the notice window.** Nothing happens twice, and the notice window never opens the admin dialog. Test: `ctrl p opens one admin dialog and only in the main window` (Task 4).
5. **The pickup code has no `{ramal}`** (`*8`), **or `{ramal}` appears twice.** Every `{ramal}` is replaced, and a code without it is dialed as is. Test: `pickup code replaces every ramal token` (Task 2).

---

### Task 1: Engine — BLF subscriptions and network switch

**Files:**
- Modify: `starsonic/phone/SipEngine.h`, `starsonic/phone/SipEngine.cpp`, `starsonic/phone/EngineEvents.h`, `starsonic/phone/EngineEvents.cpp` (and EngineAccount if a Buddy needs the account)
- Modify: `tests/smoke/fake_registrar.py`, which answers `SUBSCRIBE` with `Event: dialog` with 200, sends `NOTIFY application/dialog-info+xml`, and gets a control command `BLF <ramal> <terminated|early|confirmed|refuse>`; plus `tests/smoke/test_fake_registrar.py`
- Test: `tests/phone/test_engine_blf.cpp` (add it to `tests/phone/CMakeLists.txt`)

**Interfaces:**
- Produces:
  - `enum class BlfState { Free, Ringing, Busy, Unknown };`
  - `void SipEngine::WatchBlf(const std::vector<std::string>& numbers)`: replaces the watched set on the current account. Numbers that are added get a subscription and numbers that are removed are unsubscribed. An empty list means none.
  - `EngineListener::OnBlf(const std::string& number, BlfState state)`, called on the engine event thread.
  - `void SipEngine::SetNetworkAvailable(bool available)`:
    - `false`: stop the registration retries and mark the account offline, without destroying it.
    - `true`: re-register now (`Reregister()`) and resubscribe BLF.
- Map dialog-info as follows: `confirmed` → Busy; `early`/`proceeding`/`trying` → Ringing; `terminated` or no dialog → Free. A rejected or terminated subscription becomes Unknown.

- [ ] **Step 1: write the failing tests.**
  - `WatchBlf subscribes and reports each state`: watch `2007`, then the registrar goes `BLF 2007 early` → Ringing, `confirmed` → Busy, `terminated` → Free.
  - `WatchBlf with a refused subscription reports Unknown`.
  - `WatchBlf removes subscriptions for numbers no longer watched`: the registrar sees an un-SUBSCRIBE (Expires: 0).
  - `SetNetworkAvailable false stops retries and true re-registers`: the registrar's REGISTER count.
  - `python3 -m unittest tests/smoke/test_fake_registrar.py` covers the new BLF commands.
- [ ] **Step 2:** `cmake --build $SCRATCH/bp && $SCRATCH/bp/phone_tests -tc="*Blf*,*NetworkAvailable*"` → FAIL (does not compile).
- [ ] **Step 3: implement** with a pjsua2 `Buddy` per number. Set `BuddyConfig.uri = sip:<number>@<domain>` and `subscribe_dlg_event = true`, and handle `onBuddyDlgEventState` by parsing `BuddyDlgEventInfo`. Work on the API thread under `apiMutex_`, like the other functions.
- [ ] **Step 4:** run the whole engine suite → PASS, and `python3 build/check_source_text.py` → ok.
- [ ] **Step 5: commit** `feat(phone): BLF por evento de diálogo e a chave de rede no motor`.

### Task 2: Core — shortcuts store, admin store, password, pickup code

**Files:**
- Create: `starsonic/desktop/Atalhos.h/.cpp` (`Atalho`, `AtalhosStore`), `starsonic/desktop/Admin.h/.cpp` (`AdminConfig`, `AdminStore`, `CheckAdminPassword`, `PickupNumber`), `starsonic/desktop/Pbkdf2.h/.cpp` (portable SHA-256 + PBKDF2-HMAC-SHA256)
- Modify: `starsonic/desktop/Stores.h/.cpp` (`Settings.bipeFim = true`, `config.json` key `bipe_fim`), `tests/desktop/CMakeLists.txt`
- Test: `tests/desktop/test_atalhos.cpp`, `tests/desktop/test_admin.cpp`, `tests/desktop/test_pbkdf2.cpp`

**Interfaces:**
- Produces:
  - `struct Atalho { std::string id, nome, numero; enum Acao { Ligar, Transferir, Consulta, Teclas } acao; bool blf; };`
  - `class AtalhosStore { bool Load(); const std::vector<Atalho>& All() const; std::string Save(Atalho, std::string* error); bool Remove(const std::string& id); }`. `Save` with an empty id adds a new shortcut. It refuses a 9th and refuses invalid fields with pt-BR errors.
  - `struct AdminConfig { bool mostrarNaoPerturbe=true, mostrarAtenderAuto=true, blf=false, puxar=false; std::string codigoPuxar; std::vector<ServerPort> servidores; std::string canal; /* "" = build */ };`
  - `class AdminStore { AdminStore(FileSystem&, SecretCipher&, std::string path, const Profile&); bool Load(); const AdminConfig& Get() const; bool Save(const AdminConfig&); }`. The file content goes through `SecretCipher::Protect`/`Unprotect`. A missing or unreadable file gives the defaults, with servers from `profile.serverPorts`.
  - `bool CheckAdminPassword(const std::string& typed)` compares against the embedded salt and key, with constant-time comparison.
  - `std::string PickupNumber(const std::string& code, const std::string& ramal)`.
- Values: the salt and key in `Admin.cpp` are produced by a script `build/admin_hash.py` (check it in) from `01422@Star`. The plain password must not appear in the source; a branding or source check asserts that.

- [ ] **Step 1: write the failing tests.**
  - `pbkdf2 matches RFC 7914 / RFC 6070-style vectors for HMAC-SHA256`: use the published PBKDF2-HMAC-SHA256 vectors ("password"/"salt", c=1 and 4096, dkLen 32).
  - `admin password accepts 01422@Star and rejects others`.
  - `the source tree never contains the admin password in plain text`: a Python test in `tests/python`.
  - `atalhos store caps at 8 and validates fields`.
  - `atalhos store round trips through atalhos.json`.
  - `admin store defaults come from the profile`.
  - `admin store is unreadable without the cipher`: the file bytes are not JSON.
  - `pickup code replaces every ramal token`: `**{ramal}`+`2007` → `**2007`; `*8` → `*8`; `{ramal}#{ramal}` → `2007#2007`.
  - `settings bipeFim defaults to true and persists`.
- [ ] **Step 2:** run `desktop_tests` → FAIL (does not compile).
- [ ] **Step 3: implement.** The SHA-256 is a small, self-contained implementation (FIPS 180-4).
- [ ] **Step 4:** `desktop_tests` → PASS (with ASan/UBSan as the job does). Run `python3 build/check_source_text.py`.
- [ ] **Step 5: commit** `feat(desktop): atalhos, administrador e senha com PBKDF2`.

### Task 3: DesktopApp and the bridge

**Files:**
- Modify: `starsonic/desktop/DesktopApp.h/.cpp`, `starsonic/desktop/Protocol.h/.cpp`, `docs/ponte-windows.md`
- Test: `tests/desktop/test_desktop_app.cpp`, `tests/desktop/test_protocol.cpp`

**Interfaces:**
- Consumes: Task 1 (`WatchBlf`, `OnBlf`, `SetNetworkAvailable`) through `RegistrationPort`, by adding `WatchBlf` and `SetNetworkAvailable` to the port and the fake. Task 2 stores.
- Produces:
  - **Commands:**
    - `saveShortcut {id?, nome, numero, acao, blf}`
    - `removeShortcut {id}`
    - `useShortcut {id}`
    - `adminLogin {senha}`
    - `adminLogout`
    - `adminSet {naoPerturbe?, atenderAuto?, blf?, puxar?, codigoPuxar?, servidores?, canal?}`, refused unless the admin session is open
    - `setSetting {chave:"bipeFim", valor}`
  - **State:**
    - `atalhos[]` with `estado`
    - `admin` (full only while open; otherwise `{aberto:false, naoPerturbe, atenderAuto, blf}`)
    - `conta.internet`
    - `config.bipeFim`
    - `entrarAdmin {erro?, esperaAte?}`
  - **Ring:** `{"type":"ring","tipo":"fim"}`.
  - **Host hooks/methods:**
    - `DesktopApp::SetInternet(bool)`, called by the host network monitor.
    - `DesktopHooks.updateChannel(std::string)`, fire-and-forget like the other hooks.
- **Rules (spec 3–8):**
  - `useShortcut` maps the action as in spec 3.2, using the existing controller calls and the dial rule.
  - When BLF is on, pickup is on, the code is non-empty and the shortcut state is Tocando, `useShortcut` dials `PickupNumber(code, numero)` instead.
  - BLF watches the shortcuts with `blf && admin.blf`, on the account in use. Rewatch when the shortcuts change, the admin changes, the account changes or the account re-registers.
  - Hiding Não perturbe or Atender automático forces it off immediately and refuses `setDnd`/auto-answer commands.
  - Admin servers feed `BuildAccount` (ports).
  - Admin session: 10 min idle via the Scheduler. Lockout: after 5 fails in a row, refuse for 30 s and send `esperaAte`.
  - `SetInternet(false)` calls `SetNetworkAvailable(false)`, and the state shows `internet:false`. `true` re-registers.
  - The beep: when an answered call ends, `bipeFim` is on and no other call remains, send `ring fim` once.

- [ ] **Step 1: write the failing tests.**
  - `useShortcut runs each action outside and during a call`.
  - `useShortcut on a ringing BLF with pickup dials the pickup code`.
  - `blf follows the shortcut list and the account in use`.
  - `hiding Nao perturbe forces it off`.
  - `admin commands need an open session and lock after five wrong passwords`.
  - `admin session closes after ten idle minutes`.
  - `admin servers change the account port`.
  - `internet loss mid-call drops to gray and beeps once`.
  - `the end beep plays only for answered calls with no other call left`.
  - `bipeFim off silences the end beep`.
  - Protocol parse and serialize tests for every new command and field.
- [ ] **Step 2:** run `desktop_tests` → FAIL.
- [ ] **Step 3: implement** and update `docs/ponte-windows.md` with every new command, field, the ring type and the hooks.
- [ ] **Step 4:** run `desktop_tests` → PASS; android.yml stays green after push.
- [ ] **Step 5: commit** `feat(desktop): atalhos, BLF, administrador, internet e bipe na ponte`.

### Task 4: Interface

**Files:**
- Create: `windows/ui/src/screens/Atalhos.tsx`, `windows/ui/src/screens/AtalhoForm.tsx`, `windows/ui/src/screens/Admin.tsx`, `windows/ui/src/components/AdminLogin.tsx`, `windows/ui/src/components/AtalhosPainel.tsx`
- Modify: `windows/ui/src/state.ts`, `types.ts`, `main.tsx`, `components/Nav.tsx` (4 tabs), `components/Header.tsx`, `format.ts` (`accountDot` = the Global Constraints table), `ring.ts` (`fim`), `screens/Ligacao.tsx` (an "Atalhos" button that opens the panel), `screens/Configuracoes.tsx` (the beep switch; hide Atender automático when the admin hides it), `fake.ts`, `fake-scenarios.ts`, `app.css`
- Test: `windows/ui/tests/atalhos.spec.ts`, `windows/ui/tests/admin.spec.ts`, updates to `window.spec.ts`, `rediscar-status.spec.ts`, `ring.spec.ts`

**Interfaces:**
- Consumes: Task 3's bridge as documented in `docs/ponte-windows.md`.
- Visual: the canvas files, with the exact texts from spec section 11.
- Ctrl + P: a keydown handler in the main window only (`preventDefault`). It opens at most one dialog and never runs in `aviso`.

- [ ] **Step 1: write the failing specs.**
  - `the Atalhos tab shows up to eight shortcuts with BLF word and color`, in all three layouts.
  - `editing a shortcut saves name number action and blf`.
  - `the BLF switch is disabled when the admin has BLF off`.
  - `the call screen Atalhos panel runs transfer consult and keys`.
  - `ctrl p opens one admin dialog and only in the main window`.
  - `wrong admin password shows Senha incorreta and the wait`.
  - `admin screen hides Nao perturbe and Atender automatico`.
  - `the account dot follows the six-row priority table`.
  - `the end beep plays on the speaker device`.
  - `the bipeFim switch sends setSetting`.
  - Ruling 19: keys stay whole at every size with the four-tab nav.
  - axe in both themes on the new screens.
- [ ] **Step 2:** `npx playwright test` → the new specs FAIL.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** run the full UI suite → PASS. The `dist` has no new http URLs.
- [ ] **Step 5: commit** `feat(windows): aba de atalhos com BLF, área do administrador, bipe e bolinha nova`.

### Task 5: Windows host

**Files:**
- Create: `windows/app/src/NetworkMonitor.h/.cpp` (`INetworkListManager` events + a 30 s DNS check of the account's server; calls `app.SetInternet`)
- Modify:
  - `windows/app/src/EngineHost.cpp`: `WatchBlf`, `SetNetworkAvailable`, `OnBlf` → DesktopApp.
  - `windows/app/src/ShellState.cpp`, `Tray.cpp`: the dot priority table, including Não perturbe red and offline.
  - `windows/app/src/AppUpdater.*`, `main.cpp`: the runtime channel from `updateChannel`.
  - `windows/app/src/WebViewHost.cpp`: keep Ctrl + P from printing, if WebView2 handles it before the page.
  - `tests/smoke/windows_smoke.py`, `tests/win/*`.
- Test: `tests/win/test_network_monitor.cpp` (the debounce and decision logic as a pure part), smoke additions

- [ ] **Step 1 (RED in CI):**
  - Smoke:
    - a shortcut to `2002` with BLF on (admin.json written through the app's admin commands over CDP) shows `Livre` and then `Ocupado` while the fake registrar holds a call to 2002;
    - Ctrl + P opens the dialog;
    - a test hook (`STARSONIC_TEST_HOOKS`) that simulates connectivity loss turns the dot gray and back to green.
  - `ShellState` tests for the tray with DND and offline.
  - Note the run id.
- [ ] **Step 2 (GREEN):** implement until the Windows job is green, and capture `atalhos.png`, `admin.png` and `sem-internet.png`.
- [ ] **Step 3: commits** `test(windows): BLF, Ctrl+P e internet na fumaça`, then `feat(windows): monitor de rede, BLF e canal de atualização no app`.

### Task 6: Docs, final review and release rc.3

**Files:**
- Modify:
  - `docs/teste-manual.md`: rows for shortcuts, BLF and pickup on the real servers with three extensions, the admin area, the beep, the internet off/on test, and the DND dot.
  - The W1 spec "Como ficou": an "rc.3" line pointing to the new spec.
  - The new spec: Status set to implemented, plus a "Como ficou" section with any divergences.
  - `notas/v0.1.0-rc.3.txt`.

- [ ] **Step 1: final review.** Run the final review of `9b3babc..HEAD` on the most capable model, then one fix round from RED to GREEN, and put the minors in the ledger.
- [ ] **Step 2: docs commit** `docs(windows): rc.3 — roteiro, notas e status da spec`.
- [ ] **Step 3: release.** Run `gh workflow run release.yml --ref main -f versao=0.1.0-rc.3`, then verify the release, the channel's `versao.json`, the installer SHA-256, `check_branding --instalador`, and that `releases/latest` is still empty.
- [ ] **Step 4: delivery.** Write the delivery doc in the project, listing the rulings, the deferred minors, the new texts and the manual-test items for Lucas.
