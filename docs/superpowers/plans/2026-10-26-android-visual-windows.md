# Android 0.2.0-rc.2: the Windows look, Não perturbe, Atender automático, Rediscar, status dot and end beep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `android-v0.2.0-rc.2`, which gives the Android app:
- the Windows app's look on every screen, in light and dark;
- Não perturbe and Atender automático in the header;
- Rediscar next to Ligar;
- the six-row status dot, mirrored in the persistent notification;
- the end-of-call beep;
- a new Configurações screen.

**Architecture:**
- **Pure Kotlin first:** a call-settings store and the status table, then the CallManager rules (DND, auto-answer, beep decision) with JVM tests against the existing fakes.
- **One visual system:** a theme module (`ui/`) with the Windows tokens, the Plus Jakarta Sans font and shared composables.
- **Screens rebuilt on it:** main and lists, the inner screens and Configurações, then the call screens.
- **The engine (`starsonic/`) does not change.**

**Tech Stack:** Kotlin, Jetpack Compose (BOM 2026.09.00, Material3 underneath), AGP 9.4, SharedPreferences, Android Telecom (self-managed ConnectionService), AudioTrack, JUnit 4 (JVM), Compose UI tests on the API 34 emulator (android.yml).

**Spec:** `docs/superpowers/specs/2026-10-26-starsonic-phone-android-visual-windows-design.md`. The approved canvas is "Starsonic Phone Android — visual do Windows e funções novas" (artifact APDbPtUv1JwiC6hi3LTpuk). Its boards and the shared stylesheet are in `$SCRATCH/canvas-android/project/` (`app.css` and `*.dc.html`), where `$SCRATCH=/tmp/claude-0/-home-claude/62d54bdc-24b1-5e22-a5c0-39fd7d73e742/scratchpad`. The Windows reference is `windows/ui/src/app.css`.

## Global Constraints

### Repo rules
- **Scope:** only `android/`, `docs/`, `notas/`, `.github/workflows/android.yml` (to list new emulator test classes) and `branding/` assets may change.
- **Off limits:**
  - Nothing in `microsip/`, `windows/` or `starsonic/`. The engine is shared with Windows; a needed native change is a ruling first.
  - Never read or print `$SCRATCH/t11/chave/` or `$SCRATCH/t11/entrega/`.
- **Git:**
  - Commit straight to `main`, in Portuguese, with the two session trailer lines.
  - Run `git pull --rebase` before every push.
  - Never force push, and never create a remote branch, tag or release outside Task 7.
- **The repo is PUBLIC:** no secrets anywhere.

### Where things run
- **CI:**
  - Android code is built and tested on GitHub Actions, `android.yml`: JVM tests, then the APK, then the emulator tests on API 34, about 10 min per run.
  - RED is a pushed commit whose CI fails on the new test (note the run id). GREEN is the next commit.
  - A new emulator test class must be added to the `script:` list of the emulator step in `android.yml`.
- **Locally:** the controller may provide an Android SDK at `/opt/android-sdk` and Gradle 9.6.0 at `/opt/gradle-9.6.0`. When `android/local.properties` points at the SDK, run the JVM tests locally with `/opt/gradle-9.6.0/bin/gradle -p android testDebugUnitTest`. A local RED/GREEN on JVM tests is valid evidence; CI still has to be green at the end of each task.

### Existing tests and texts
- **Existing test tags stay.** For example `status`, `menu`, `ligar`, `apagar`, `numero`, `tecla-<d>`, `aba-teclado`, `aba-recentes`, `aba-contatos` and `sair-confirmar`. If a tag must move, update every emulator test that uses it in the same commit.
- **Version:** `android-v0.2.0-rc.2`, on Android's test channel.
- **Texts:**
  - Spec section 10, verbatim, plus every existing text unchanged.
  - Kotlin strings may hold UTF-8, as today.

### The look (spec 3)
Tokens, exact values from `windows/ui/src/app.css`.

**Fixed values:**

| Token | Value |
|---|---|
| `cyan` | `#00c2cb` |
| `cyan-d` | `#00a5ad` |
| `blue` | `#0c2671` |
| `blue-2` | `#0a1e57` |
| `ink` | `#0a0e1a` |
| `muted` | `#5b6478` |
| `line` | `#e7eaf2` |
| `soft` | `#f5f7fb` |
| `white` | `#ffffff` |
| `navy-950` | `#070b18` |
| `navy-900` | `#0a1330` |
| `navy-850` | `#07143d` |
| `navy-800` | `#0a1a4d` |
| `on-cyan` | `#03222a` |
| `danger` | `#d64545` |
| status online | `#22c55e` |
| status off | `#b9c4e6` |
| warning triangle | `#ffb703` |

- **`gradient-hero`:** `linear-gradient(150deg, #070b18 0%, #0a1330 48%, #0c2671 100%)`, with the cyan glow `rgba(0,194,203,0.22)` in the top-right corner.

**Theme roles:**

| Role | Light | Dark |
|---|---|---|
| surface | white | navy-900 |
| card | white | white at 4.5% |
| border | line | white at 10% |
| text-strong | blue | white |
| text | ink | white |
| text-muted | muted | `#b9c4e6` |
| accent-text | blue | cyan |
| icon | blue | cyan |
| icon-tile | cyan at 14% | cyan at 14% |
| key | soft | white at 4.5% |
| key-border | line | white at 10% |
| field | soft | white at 6% |
| popover | white | navy-800 |
| pill-on (background / text) | blue / white | cyan / on-cyan |
| switch-off | `#c9cfdd` | white at 22% |

- **Call screens** are always dark.
- **Font:** Plus Jakarta Sans, weights 400–800, from `windows/ui/assets/PlusJakartaSans-Variable.woff2` converted to TTF. Its OFL text (`windows/ui/assets/OFL.txt`) ships in the app's assets.
- **Logos:** `windows/ui/assets/starsonic-logo-negativo.png` goes on the dark header and bars; `starsonic-logo-principal.png` goes on the light Sobre.
- **Touch targets:** at least 48 dp. The visual sizes follow the canvas.
- **Edge to edge:** the header and dark bars draw under the status bar, with its inset as padding. The bottom nav pads the gesture bar inset.
- **Forced dark:** the app opts out of OEM forced dark (`android:forceDarkAllowed="false"` on the theme).

### Settings (spec 4, 5, 8, 9)
- **Store:** SharedPreferences file `configuracoes`, separate from `conta`. "Sair da conta" never clears it.
- **Keys and defaults:**
  - `nao_perturbe` = false;
  - `atender_auto` = false;
  - `atender_segundos` = 3;
  - `bipe_fim` = true.
- **Auto-answer options:** 0 ("Na hora"), 1, 2, 3, 5, 8, 10, 15, 20 and 30 s.

### Status table (spec 7)
The first row that matches wins.

| # | Condition | Dot | Line | Notification title |
|---|---|---|---|---|
| 1 | no network | gray | `Sem internet · tentando de novo` | `Sem internet · tentando de novo` |
| 2 | connecting | cyan | `Conectando…` | `Conectando…` |
| 3 | error | gray + triangle | the core message | the core message |
| 3b | unreachable (code ≤ 0, 408 or 5xx) | gray, no triangle | the core message | the core message |
| 4 | in a call, ringing included | red | `Ocupado · em ligação` | `Ocupado · em ligação` |
| 5 | Não perturbe on | red | `Não perturbe · as ligações não tocam` | `Não perturbe (ramal <ramal>)` |
| 6 | registered | green | `Conectado · <servidor>` | `Conectado (ramal <ramal>)` |

### Beep (spec 9)
- **The sound:** 425 Hz, 0.25 s, twice with a 0.15 s gap.
- **When:** it plays when an answered call ends and no other call remains, and only when `bipe_fim` is on.
- **Where:** on the call's audio route, before the Telecom Connection is destroyed. The disconnect waits for the beep, at most 1.5 s.

## Review Focus

1. **Auto-answer racing the person or the network.**
   - The case: the call stops ringing during the countdown (answered by hand, rejected, caller gave up), or a second call arrives, or Não perturbe is turned on.
   - Expected: auto-answer never answers anything but the same, still-ringing, only call.
   - Test: `auto answer never answers a call that stopped ringing` (Task 2).
2. **Não perturbe turned on while a call rings.**
   - Expected: that call keeps ringing, and the next one gets busy and a silent missed notification.
   - Test: `do not disturb spares the call already ringing` (Task 2).
3. **A new call during the end beep's delayed disconnect.**
   - The case: a new incoming or outgoing call starts while the last Connection waits for the beep.
   - Expected: the new call works normally; the old Connection is gone within 1.5 s.
   - Test: `a call during the end beep is not delayed or blocked` (Task 2).
4. **Sair da conta, then Entrar again.**
   - Expected: the call settings survive, and they apply again after the new Entrar. While logged out nothing rings anyway.
   - Test: `call settings survive sign out` (Task 1).
5. **The largest font scale on a small screen (360×640 dp).**
   - Expected: the header, the 12 keys, Rediscar, Ligar and the nav stay reachable, by scrolling where needed, and nothing overlaps.
   - Test: `main screen stays usable at the largest font scale` (Task 4).

---

### Task 1: Call settings store and the status table

**Files:**
- Create: `android/app/src/main/java/br/com/starsonic/phone/data/CallSettings.kt`
- Modify: `service/StatusModel.kt`, `service/Connection.kt`, `App.kt`, `service/SipService.kt`, `main/MainActivity.kt` (uses `app.status`)
- Test: `android/app/src/test/java/br/com/starsonic/phone/data/CallSettingsStoreTest.kt` and `service/StatusModelTest.kt` (rewritten)

**Interfaces:**
- **Produces:**
  - `data class CallSettings(val doNotDisturb: Boolean = false, val autoAnswer: Boolean = false, val autoAnswerSeconds: Int = 3, val endBeep: Boolean = true)`;
  - `val AUTO_ANSWER_SECONDS: List<Int> = listOf(0, 1, 2, 3, 5, 8, 10, 15, 20, 30)`;
  - `interface CallSettingsStore { val settings: StateFlow<CallSettings>; fun update(change: (CallSettings) -> CallSettings) }`;
  - `class PreferencesCallSettingsStore(preferences: SharedPreferences) : CallSettingsStore`, with keys as in Global Constraints. An `autoAnswerSeconds` outside the list is read as 3;
  - `enum class Dot { OFFLINE, CONNECTING, ERROR, NO_CONNECTION, BUSY, ONLINE }`;
  - `data class Status(val dot: Dot, val line: String, val notificationTitle: String)`;
  - `object StatusModel { fun account(code: Int?, active: Boolean, online: Boolean, ramal: String, server: String, core: CoreRules): Status; fun shown(account: Status, ramal: String, inCall: Boolean, doNotDisturb: Boolean): Status }`;
  - `App.callSettings: CallSettingsStore`;
  - `App.status: StateFlow<Status>`, which combines `connection.status`, `calls.state` and `callSettings.settings` through `StatusModel.shown`.
- **Consumes:** `Connection` already knows the account. It now also passes the server address into `StatusModel.account`.

- [ ] **Step 1: Write the failing tests.**
  - `StatusModelTest`:
    - `offline wins over every other state`;
    - `connecting shows cyan`;
    - `a refused password shows the error with the warning` (Dot.ERROR, "Ramal ou senha incorretos.");
    - `an unreachable server shows no warning` (codes 0, 408, 503 → NO_CONNECTION);
    - `a call turns the registered dot red` ("Ocupado · em ligação" in line and title);
    - `do not disturb turns the registered dot red` (line "Não perturbe · as ligações não tocam", title "Não perturbe (ramal 2001)");
    - `a call wins over do not disturb`;
    - `registered shows the server and the ramal` (line "Conectado · starcloud1-starsonic.com.br", title "Conectado (ramal 2001)");
    - `errors and offline ignore calls and do not disturb`.
  - `CallSettingsStoreTest`, on the in-memory SharedPreferences the existing `PreferencesAccountStoreTest` uses (reuse its helper):
    - `defaults are off, three seconds and the beep on`;
    - `changes are saved and read back`;
    - `an unknown auto answer time reads as three seconds`;
    - `call settings survive sign out` (clearing the `conta` store leaves `configuracoes`).
- [ ] **Step 2: Run the JVM tests; expect FAIL** (compile errors on the new API). Locally, or push for RED on CI.
- [ ] **Step 3: Implement.**
  - `StatusModel.account` keeps today's rules (offline, connecting, success, core message) and adds `NO_CONNECTION` for the unreachable codes.
  - `StatusModel.shown` applies rows 4–6 only when `account.dot == Dot.ONLINE`.
  - Wire `App.status`; `SipService` takes its notification title from `app.status`; the screens read `app.status`.
  - **The registered line changes** from "Conectado · 2001" to "Conectado · <servidor>". The emulator tests that wait for "Conectado · 2001" (`LoginScreenTest`, `CallFlowTest`, `AboutAndAccountTest`) move to the new text in the same commit: the fake registrar's server is `10.0.2.2`. The notification title "Conectado (ramal 2001)" stays.
- [ ] **Step 4: Run the tests; expect PASS.** CI is green, emulator included.
- [ ] **Step 5: Commit** `feat(android): configurações de ligação e a tabela da bolinha`.

### Task 2: CallManager — Não perturbe, Atender automático and the end beep

**Files:**
- Create: `call/EndBeep.kt`. It holds `fun interface EndBeep { fun play(done: () -> Unit) }`, a `NoBeep`, and `class AudioTrackEndBeep(context)`.
- Modify: `call/CallManager.kt`, `call/IncomingCallNotifier.kt` (a silent missed channel), `App.kt`
- Test: `call/CallManagerTest.kt` (new cases), `call/CallFakes.kt` (a `FakeBeep` that records plays and lets the test call `done`), `call/EndBeepToneTest.kt`

**Interfaces:**
- **Consumes:** `CallSettings` (Task 1).
- **Produces:**
  - The `CallManager` constructor gains `settings: () -> CallSettings` and `beep: EndBeep`. Defaults keep the existing tests compiling: `{ CallSettings() }`, and `NoBeep`, which calls `done` at once.
  - `CallNotifier.showMissed(text: String, silent: Boolean = false)`.
  - `fun endBeepPcm(sampleRate: Int): ShortArray` (pure: 425 Hz, 0.25 s, 0.15 s of silence, 0.25 s, with 5 ms fades).

- [ ] **Step 1: Write the failing tests** in `CallManagerTest`, with the existing `CallClock`, `FakeTelecom`, `FakeNotifier` and `CallGateway`.
  - **Não perturbe:**
    - `do not disturb answers busy and logs a silent missed call`: the gateway rejects the call; the Recentes get a PERDIDA; `showMissed(…, silent = true)`; nothing goes to Telecom.
    - `do not disturb spares the call already ringing`.
  - **Atender automático:**
    - `auto answer answers the only ringing call after the chosen seconds`: 3 s; advance 2999 ms, no answer; advance 1 ms, `gateway.answer`.
    - `auto answer na hora answers at once`: 0 s, answers on the next clock run.
    - `auto answer skips a second call`.
    - `do not disturb wins over auto answer`.
    - `auto answer never answers a call that stopped ringing`: answered by hand, rejected, caller gave up, or a second call arrived before the timer. In every case, no extra `answer`.
  - **The end beep:**
    - `an answered call that ends beeps once and then disconnects`: `telecom.disconnect` only after `FakeBeep.done`.
    - `a rejected, missed or unanswered call never beeps`.
    - `no beep while another call remains, one when the last answered call ends`.
    - `no beep with the setting off`, which disconnects at once.
    - `no beep after Sair`.
    - `a call during the end beep is not delayed or blocked`: a new `dial` or incoming during a pending beep proceeds; the old disconnect still runs when the beep ends.
  - **`EndBeepToneTest`:**
    - `the beep is 650 ms long at the given rate`;
    - `the tone parts are 425 Hz` (count zero crossings in each 250 ms part, ±2 %);
    - `the gap is silent`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
  - **Não perturbe:** in `onIncoming`, `settings().doNotDisturb` takes the busy path (like `!permitted`), with the silent missed notification.
  - **Atender automático:**
    - After a call is added as the only one, with `autoAnswer` on and `doNotDisturb` off, `clock.schedule(seconds * 1000L)`.
    - On fire, under the lock: answer only if the same `Call` object is still in `calls`, still `RINGING`, not `answered` or `rejected`, and `calls.size == 1`.
    - Cancel the timer on answer, reject, end, a second call or Sair.
  - **The end beep:** in `end`, for an answered call (`activeSince > 0`) with no remaining call not `ending`, `endBeep` on, not logged out: the effect is `beep.play { telecom.disconnect(id, endCause) }` instead of the direct disconnect.
  - **`AudioTrackEndBeep`:**
    - Static mode, 16 kHz mono PCM from `endBeepPcm`, `AudioAttributes` with `USAGE_VOICE_COMMUNICATION` and `CONTENT_TYPE_SPEECH`.
    - Calls `done` when playback ends, or after 1.5 s at most, on any error too.
    - Never blocks the calling thread.
  - **The silent channel:** `IncomingCallNotifier` gains `CHANNEL_MISSED_SILENT`, "Ligações perdidas no Não perturbe", `IMPORTANCE_LOW`, used when `silent`.
  - **Wiring:** `App` passes `callSettings.settings.value` and `AudioTrackEndBeep(this)`.
- [ ] **Step 4: Run; expect PASS.** CI is green.
- [ ] **Step 5: Commit** `feat(android): não perturbe, atender automático e o bipe no fim da ligação`.

### Task 3: The theme and shared components

**Files:**
- Create:
  - `ui/StarsonicTheme.kt`: colors, typography and `StarsonicTheme`, replacing the one in `main/Band.kt`;
  - `ui/Components.kt`;
  - `ui/Icons.kt`: `ImageVector`s from the canvas SVG paths (stroke 2, round caps);
  - `res/font/plus_jakarta_sans.ttf`;
  - `assets/licencas/OFL-PlusJakartaSans.txt`;
  - `res/drawable-nodpi/logo_negativo.png` and `logo_principal.png`.
- Modify: `res/values/themes.xml` and `res/values-night/themes.xml` (`android:forceDarkAllowed`, window background per theme).
- Test: `ui/StarsonicColorsTest.kt` (JVM).

**Interfaces:**
- **Produces:**
  - **Colors:** `object Starsonic` with the fixed colors (`Cyan`, `OnCyan`, `Blue`, `Danger`, `StatusOnline`, `StatusOff`, `Warning`, `Navy950`…`Navy800`, `HeroGradient: Brush`), and `data class StarsonicColors(…)` with the roles from Global Constraints.
  - **Theme:** `val LocalStarsonicColors`; `@Composable fun StarsonicTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit)`; `val PlusJakartaSans: FontFamily`.
  - **Composables:**
    - `BrandHeader(menu, content)`;
    - `AccountCard(status: Status, ramal: String)`, with test tag `status` on the line;
    - `StatusDot(dot: Dot)`;
    - `HeaderChip(label, icon, on, tag, onClick)`;
    - `DialKey(digit, letters, tag, onClick)`;
    - `CyanButton`, `BlueButton`, `OutlineButton(text, icon?, tag, enabled, onClick)`;
    - `RedialButton(label: String, enabled: Boolean, onClick)`, tag `rediscar`;
    - `Eyebrow(text)`;
    - `SettingsCard(content)`;
    - `SettingRow(title, help?, tag, trailing)`;
    - `StarsonicSwitch(checked, label, tag, onChange)`;
    - `DarkBar(title, onBack)`, tag `voltar`;
    - `BottomNav(selected: Int, onSelect: (Int) -> Unit)`, keeping the tags `aba-teclado`, `aba-recentes` and `aba-contatos`.

- [ ] **Step 1: Write the failing test.** `StarsonicColorsTest`:
  - `fixed colors are the Windows tokens` (every hex above);
  - `light and dark roles match the Windows app`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
  - **The font:** convert it with `python3 -m pip install --break-system-packages fonttools brotli`, then `fontTools.ttLib.TTFont(woff2).save(ttf)` with `flavor = None`. Use it as a variable font (`FontVariation.weight`) for 400, 500, 600, 700 and 800.
  - **The composables:** build them to the canvas measures (`$SCRATCH/canvas-android/project/app.css`). Examples: header padding 18 dp sides; account card radius 14 dp; chips 36 dp; keys 60 dp high with 18 dp radius; Ligar 58 dp; nav pill 60×32 dp.
- [ ] **Step 4: Run; expect PASS.** CI is green; no screen uses the components yet.
- [ ] **Step 5: Commit** `feat(android): tema e componentes do visual do Windows`.

### Task 4: Main screen, Teclado with Rediscar, Recentes and Contatos

**Files:**
- Create: `data/Redial.kt` (`fun lastDialed(recents: List<Recent>): Recent?`, the newest FEITA).
- Modify:
  - `main/MainActivity.kt`: MainScreen uses `BrandHeader`, `AccountCard`, the two `HeaderChip`s (tags `nao-perturbe` and `atender-auto`) and `BottomNav`. The menu becomes Configurações and Sobre (tags `menu-configuracoes` and `menu-sobre`).
  - `main/DialerScreen.kt`: keys, Rediscar and Ligar.
  - `main/RecentsScreen.kt` and `contacts/ContactsScreen.kt`: the canvas rows and filters.
  - `main/MenuSheet.kt`.
  - `main/Band.kt`: removed once unused.
- Test:
  - `data/RedialTest.kt` (JVM);
  - `androidTest/.../MainScreenTest.kt` (new, added to `android.yml`);
  - existing emulator tests updated where the menu moved (`AboutAndAccountTest`: Editar conta and Sair da conta are now under Configurações; they become real in Task 5, so this task only moves the menu items' tags as needed).

**Interfaces:**
- **Consumes:** Tasks 1–3.
- **Produces:**
  - the tags `nao-perturbe`, `atender-auto`, `rediscar`, `menu-configuracoes` and `menu-sobre`;
  - `DialerScreen(onDial, suggest, contactNumber, redial: Recent?, redialName: String?)`.

- [ ] **Step 1: Write the failing tests.**
  - `RedialTest`:
    - `the newest dialed call is the redial`;
    - `received and missed calls are not redialed`;
    - `nothing to redial with no dialed call`.
  - `MainScreenTest` (emulator, fake registrar as in `CallFlowTest`):
    - `the chips toggle and change the dot` (Não perturbe on → status text "Não perturbe · as ligações não tocam"; off → "Conectado · <servidor>");
    - `rediscar is disabled until a call is made, then dials the last one`;
    - `the menu opens Configurações and Sobre`;
    - `main screen stays usable at the largest font scale` (set `font_scale` 2.0 via `settings put system font_scale`, restore after);
    - `the dark theme draws` (`cmd uimode night yes`, the screen renders and the tags exist; restore after).
- [ ] **Step 2: RED** on CI (run id).
- [ ] **Step 3: Implement** to the boards Main, Recentes, Contatos, TecladoEscuro, RecentesEscuro and ContatosEscuro.
  - Chips flip `callSettings`.
  - The Rediscar label is "Rediscar <número> · <nome>", "Rediscar <número>" without a contact, or "Rediscar" when disabled, as the content description and the long-press tooltip.
  - Keep `CallMessage`, `ReturnToCall` and the permission `WarningBanner` in the new style.
- [ ] **Step 4: GREEN** on CI (run id), with every existing emulator test still passing.
- [ ] **Step 5: Commit(s)** `feat(android): tela principal, teclado com Rediscar, Recentes e Contatos no visual do Windows`.

### Task 5: Configurações (new), Sobre, Entrar, Permissões and the dialogs

**Files:**
- Create: `settings/SettingsScreen.kt`.
- Modify:
  - `main/MainActivity.kt`: `Screen.SETTINGS`, `BackHandler` and navigation; Editar conta and Sair da conta come from Configurações.
  - `about/AboutScreen.kt`, `login/LoginScreen.kt`, `permissions/PermissionsScreen.kt`;
  - `update/UpdateDialog.kt` and the sign-out dialog.
- Test: `androidTest/.../SettingsFlowTest.kt` (new, added to `android.yml`); `AboutAndAccountTest` and `LoginScreenTest` updated.

**Interfaces:**
- **Consumes:** Tasks 1, 3 and 4.
- **Produces:** the tags:
  - `config-editar`, `config-sair`, `config-bipe`, `config-atender`, `config-tempo` and `config-permissoes`;
  - `tempo-<n>` for each option of the time picker.

- [ ] **Step 1: Write the failing tests.** `SettingsFlowTest`:
  - `the beep switch starts on and is remembered`, across an activity recreate;
  - `auto answer and its time are remembered` (pick 5 s, the help reads "Depois de 5 segundos tocando");
  - `sair da conta asks first and keeps the call settings`;
  - `editar conta opens Entrar filled in`;
  - `permissões e bateria opens the permissions screen`.

  Update `AboutAndAccountTest` for the new menu path.
- [ ] **Step 2: RED** on CI.
- [ ] **Step 3: Implement** to the boards Configuracoes, Sobre, Entrar, Permissoes and their dark versions.
  - Use the spec 8 layout and texts.
  - Show the time picker as a `DropdownMenu` styled as the popover, with "Na hora" for 0 and "<n> s".
  - The Sobre logo is the principal in light and the negativo in dark.
- [ ] **Step 4: GREEN** on CI.
- [ ] **Step 5: Commit(s)** `feat(android): Configurações, Sobre, Entrar e Permissões no visual do Windows`.

### Task 6: Call screens and the incoming call

**Files:**
- Modify:
  - `call/CallScreen.kt`: dark, the canvas controls, the top status line (`StatusDot(BUSY)`, "Ocupado · em ligação" and the ramal, tag `status-ligacao`), two calls, consult and conference;
  - the Nova ligação panel, which gains the Rediscar;
  - `call/CallActivity.kt`: the incoming full screen, with the line "Atender automático · em <n> s" (tag `atender-em`) when on;
  - `call/IncomingCallNotifier.kt`: the notification text gains the same line when on.
- Test: `androidTest/.../CallFlowTest.kt` gains:
  - `the call screen shows Ocupado em ligação`;
  - `auto answer answers by itself after the time` (fake registrar `RING`, 1 s setting, call becomes active without a tap);
  - `do not disturb makes the caller hear busy` (the fake registrar sees 486);
  - `rediscar in Nova ligação dials the last call`.

**Interfaces:**
- **Consumes:** Tasks 1–5.
- **Produces:** the tags `status-ligacao`, `atender-em` and `rediscar-nova`.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: RED** on CI.
- [ ] **Step 3: Implement** to the boards Chamada, DuasLigacoes and Recebida.
  - Every existing call-screen tag stays.
  - **Spec 12 risk:** if Android refuses the auto-answer microphone start with the app closed, log it, keep the call ringing, and report it. That makes it a ruling for the spec, not a silent failure.
- [ ] **Step 4: GREEN** on CI.
- [ ] **Step 5: Commit(s)** `feat(android): telas da ligação e da recebida no visual do Windows`.

### Task 7: Docs, final review and release `android-v0.2.0-rc.2`

**Files:**
- Modify:
  - `docs/teste-manual-android.md`: a new section for:
    - the look against the canvas, both themes and the largest letter;
    - Não perturbe and Atender automático with real calls, the screen off and the app closed;
    - the beep on earpiece, headset and Bluetooth;
    - Rediscar;
    - the dot and the persistent notification.
  - The Android 0.2 spec: a "Como ficou" line pointing to the new spec.
  - The new spec: Status set to implemented, plus "Como ficou".
- Create: `notas/android-v0.2.0-rc.2.txt`, short and user-facing.

- [ ] **Step 1: Final review** of `1201e41..HEAD` on the most capable model available, split by area if large. Then one fix pass, RED to GREEN. The minors go to the ledger.
- [ ] **Step 2: Docs commit** `docs(android): 0.2.0-rc.2 — roteiro, notas e status da spec`.
- [ ] **Step 3: Release.**
  - Run `gh workflow run android-release.yml --ref main -f versao=0.2.0-rc.2`.
  - Verify the GitHub pre-release `android-v0.2.0-rc.2`, the test channel's `versao-android.json` (version, APK URL and SHA-256), and the APK SHA-256.
  - Verify that `releases/latest` still belongs to Windows, or is 404.
- [ ] **Step 4: Delivery.** Write `starsonic-phone/entrega-android-0.2.0-rc.2.md` in the Project with the rulings, the deferred minors, the new texts and the manual-test items.
