# Starsonic Phone para Windows — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork do MicroSIP 3.22.16 com a marca Starsonic, tela Entrar com servidores embutidos, configurações travadas, atualizador e instalador por usuário, compilado e publicado pelo GitHub Actions.

**Architecture:** O ramo `upstream` guarda o MicroSIP intacto; o `main` soma edições de poucas linhas no código do MicroSIP (E1–E14), todas chamando `starsonic/`. A lógica nova fica em `starsonic/core` (C++14 puro, testado no Linux e no Windows); a integração MFC fica em `starsonic/win`. O build monta o pjproject 2.17 e as dependências do vcpkg numa pasta de trabalho e compila o projeto do MicroSIP dentro dela.

**Tech Stack:** C++14 (MSVC v143, MFC estático, `/MT`), PJSIP 2.17, vcpkg (OpenSSL 3.6.5, Opus 1.6.1, bcg729 1.1.2, SQLite 3.53.4, SQLiteCpp 3.3.3), doctest 2.4.11, nlohmann/json 3.11.3, CMake + Ninja/MSBuild, Python 3 (scripts e registrador SIP falso), Windows PowerShell 5.1 (build e UI Automation), NSIS 3.10, GitHub Actions (`windows-2022`, `ubuntu-latest`).

**Spec:** `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (revisão 1.1)

## Global Constraints

- Base: MicroSIP 3.22.16. No ramo `upstream`, `microsip/` é o pacote `MicroSIP-3.22.16-src.7z` sem alteração e `microsip-dist/` traz os sons (e a tradução pt-BR, se houver) do pacote `MicroSIP-Lite-3.22.16.zip`.
- Código do MicroSIP: só as edições E1–E14 da tabela abaixo. Qualquer outra edição em `microsip/` → pare e pergunte ao usuário (regra do projeto: nada fora do padrão sem aprovação).
- `.gitattributes`: `microsip/** -text` e `microsip-dist/** -text` — os arquivos do MicroSIP são CRLF e precisam ficar idênticos byte a byte.
- Nome visível `Starsonic Phone`; executável `StarsonicPhone.exe`; empresa `Starsonic`; classe de janela `Starsonic Phone`.
- Versão `X.Y.Z` ou `X.Y.Z-rc.N`, vinda da tag git (`vX.Y.Z`); build sem tag usa `0.0.0`.
- Build: Win32, Release, VS 2022 (v143), MFC estático, CRT `/MT`. pjproject tag `2.17`, commit `5a457451fa2712ba18e12b01738e8ff3af2b26fd`, configuração `Release-Static`. vcpkg commit `e456309491fd875487bf02b8a0dca76c1b1b00cc`, triplet `x86-windows-static`, portas `openssl opus bcg729 sqlite3 sqlitecpp`.
- Código novo em C++14 (padrão do projeto do MicroSIP; C++17 quebraria o cabeçalho pré-compilado e o `std::random_shuffle` do upstream). Namespace `starsonic`.
- `starsonic/core/` não inclui MFC, Windows, PJSIP nem código do MicroSIP; compila com g++ 13 e MSVC, com `PrecompiledHeader=NotUsing`. Arquivos de `starsonic/win/` começam com `#include "stdafx.h"`.
- Em literais C++, caractere fora do ASCII sempre como `\uXXXX`. O `starsonic.rc` é só ASCII; textos acentuados das janelas são definidos em tempo de execução.
- Textos ao usuário exatamente como na tabela 11.1 da spec e nas tasks abaixo.
- URLs (em `branding/branding.h`): site `https://starsonic.com.br/`; suporte `https://wa.me/551150603000`; repositório `https://github.com/{conta}/starsonic-phone`; manifesto estável `{repo}/releases/latest/download/versao.json`; de teste `{repo}/releases/download/canal-teste/versao.json`; prefixo permitido do instalador `{repo}/releases/download/`.
- O atualizador usa WinHTTP com a validação de certificado padrão; nunca usa o `URLGetAsync` do MicroSIP (que ignora erros de certificado).
- Bibliotecas vendorizadas: `starsonic/third_party/doctest/doctest.h` (v2.4.11, sha256 `44faa038e9c3f9728efbda143748d01124ea0a27f4bf78f35a15d8fab2e039fb`) e `starsonic/third_party/nlohmann/json.hpp` (v3.11.3, sha256 `9bea4c8066ef4a1c206b2be5a36302f8926f7fdc6087af5d20b417d0cf103ea6`).
- `LICENSE` = GPL v3 oficial (sha256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`).
- Scripts PowerShell compatíveis com Windows PowerShell 5.1 (`shell: powershell` no Actions).
- Nada de senha ou segredo no repositório.
- Todo commit termina com as linhas de atribuição exigidas pela sessão.

## Review Focus

1. Resultado do registro que chega depois do tempo esgotado (ou repetido) → ignorado; a conta anterior continua ativa. Teste `late result after timeout is ignored` (Task 4).
2. Ramal digitado como `2001@sip.x`, ` 2001 ` ou `20 01` → bordas aparadas; `@`, `:` e espaço interno recusados com "Digite só o número do ramal." Teste `ValidateRamal` (Task 3).
3. Configuração importada de outro MicroSIP ou INI editado à mão, sem `starsonicServer` → conta limpa e tela Entrar com aviso, sem travar o app. Teste `account without server id is unknown and cleared` (Task 3).
4. `servidores.ini` salvo pelo Bloco de Notas (UTF-8 com BOM, CRLF, comentários) → lido normalmente. Teste `parses BOM, CRLF and comments` (Task 2).
5. `versao.json` com notas acentuadas ou longas → acentos preservados; acima de 500 caracteres, corte com "…". Teste `notes keep UTF-8 and are truncated` (Task 5).

## Pré-requisitos e entradas

- Tasks 1–6 rodam só neste ambiente (Linux, g++, CMake, Python).
- A partir da Task 7: GitHub conectado à sessão e repositório público `{conta}/starsonic-phone` criado vazio pelo usuário.
- Entradas da Starsonic (spec §12). Enquanto faltarem, use o provisório e siga; a Task 17 bloqueia release estável enquanto houver provisório:

| Entrada | Provisório | Entra na |
|---------|------------|----------|
| Usuário do GitHub | `definir-conta` | Task 9 (`STARSONIC_GITHUB_ACCOUNT`) |
| Cores (hex) | `RGB(0x1F,0x4E,0x9C)` / branco | Task 9 |
| Ícones (`microsip.ico`, `tray_inactive.ico`, `tray_missed.ico`) | ícones do MicroSIP | Task 9 (`branding/overlay/`) |
| Logos `logo-faixa.png` e `logo-entrar.png`; `installer/boas-vindas.bmp` (164×314) | nome escrito em negrito | Tasks 11, 12, 16 |
| `servidores.ini` real | perfil `sp1` com `sip1.exemplo.invalid` | Task 2 |
| Tradução pt-BR | ausente (app em inglês) | Task 9 |

## Estrutura de arquivos

```
microsip/                 MicroSIP (upstream) + edições E1–E14
microsip-dist/            sons .wav e tradução do pacote Lite (upstream)
starsonic/
  branding_override.h     incluído no fim de microsip/const.h (E1): nome, versão, sem vídeo
  define_override.h       incluído no fim de microsip/define.h (E2): URLs, cor do Ligar, crash
  starsonic.targets       importado pelo microsip.vcxproj (E3): fontes, recursos, libs, nome do exe
  core/                   Text, ServerProfiles, AccountPolicy, RegistrationErrors, LoginFlow, UpdateManifest, LayoutCollapse
  win/                    Hooks, StarsonicIds.h, starsonic.rc, ProfilesStore, AccountAdapter, Logo, LoginDialog,
                          BrandBand, AboutDialog, SettingsFilter, Http, Sha256, Updater
  third_party/            doctest, nlohmann
  generated/              (ignorado pelo git) build_info.h, servidores.ini e logos copiados pelo build
branding/                 branding.h, servidores.ini, langpack_portuguesebr.txt, logos, overlay/, installer/
tests/                    CMakeLists.txt, test_*.cpp, win/test_sha256.cpp, fixtures/, python/, smoke/
installer/StarsonicPhone.nsi
build/                    deps.lock, config_site.h, VsEnv.ps1, Build-Deps.ps1, Build-App.ps1, Build-Installer.ps1,
                          Make-SourceBundle.ps1, check_branding.py, check_release_inputs.py, make_manifest.py
.github/workflows/        build.yml, importar-microsip.yml, release.yml
notas/                    notas de cada versão estável (vX.Y.Z.txt)
docs/                     spec, plano, build-notes.md, teste-manual.md
```

## Edições no código do MicroSIP

| Id | Arquivo | Onde | O quê | Task |
|----|---------|------|-------|------|
| E1 | `microsip/const.h` | fim do arquivo | `#include "..\starsonic\branding_override.h"` | 7 |
| E2 | `microsip/define.h` | fim do arquivo | `#include "..\starsonic\define_override.h"` | 9 |
| E3 | `microsip/microsip.vcxproj` | antes de `</Project>` | `<Import Project="..\starsonic\starsonic.targets" />` | 7 |
| E4 | `microsip/microsip.cpp` | após os includes; em `InitInstance`, logo após `accountSettings.Init();` | `#include "..\starsonic\win\Hooks.h"`; `starsonic::OnSettingsLoaded();` | 10 |
| E5 | `microsip/microsip.cpp` | `ExceptionFilter`: `if (!blockDump) {` | `if (!blockDump && STARSONIC_CRASH_UPLOAD) {` | 15 |
| E6 | `microsip/mainDlg.cpp` | `OnInitDialog`, logo após `CBaseDialog::OnInitDialog();` | `starsonic::InstallBrandBand(this);` | 12 |
| E7 | `microsip/mainDlg.cpp` | `OnCreated`, antes do `return 0;` final | `starsonic::OnMainWindowCreated(this);` | 11 |
| E8 | `microsip/mainDlg.cpp` | corpos de `OnMenuAccountAdd`, `OnMenuAccountEdit`, `OnAccount` | `ShowLogin(this, -1, false)`; mesma expressão de id de antes → `ShowLogin(this, id ? id : -1, false)`; `ShowLogin(this, accountSettings.accountId ? accountSettings.accountId : -1, wParam != 0); return 0;` | 11 |
| E9 | `microsip/mainDlg.cpp` | `onRegState2`, após o bloco `if (lParam) {…}` | `starsonic::OnRegistrationState(this, code);` | 11 |
| E10 | `microsip/mainDlg.cpp` | `UpdateWindowText`, após `m_bar.SetPaneText(0, str);` | `starsonic::OnStatusText(this, str);` | 12 |
| E11 | `microsip/mainDlg.cpp` | `MainPopupMenu`, antes de `str = Translate(_T("Help"));`; corpo de `OnMenuCustomRange` | `starsonic::AddMenuItems(tracker);`; `starsonic::OnCustomMenu(this, nID);` | 12 |
| E12 | `microsip/mainDlg.cpp` | corpos de `CheckUpdates` e `OnUpdateCheckerLoaded` | `starsonic::CheckUpdates(this);`; `starsonic::OnUpdateMessage(this, wParam, updateCheckerShow); updateCheckerShow = false; return 0;` | 14 |
| E13 | `microsip/SettingsDlg.cpp` | após os includes; fim de `OnInitDialog`, antes do `return` | `#include "..\starsonic\win\Hooks.h"`; `starsonic::FilterSettings(this);` | 13 |
| E14 | `microsip/mainDlg.cpp` | `PJAccountAdd`, logo depois de `if (!accountSettings.accountId) { return; }` | `starsonic::EnforceActiveAccount();` (aprovada pelo usuário em 12/10/2026, na revisão final) | Final |

A Task 11 também acrescenta `#include "..\starsonic\win\Hooks.h"` em `mainDlg.cpp`, após `#include "stdafx.h"`. Edições em arquivos CRLF mantêm CRLF.

---

### Task 1: Repositório, ramo `upstream` e esqueleto do `main`

**Files:**
- Create (ramo `upstream`): `microsip/**` (231 arquivos do pacote), `.gitattributes`
- Create (ramo `main`): `.gitignore`, `README.md`, `LICENSE`

**Interfaces:**
- Produces: tag `microsip-3.22.16`; ramo `upstream`; `main` = `upstream` + docs.

- [ ] **Step 1: Extrair o pacote anexado** — `MicroSIP-3.22.16-src.7z` (sha256 `9c1ff942ae1ae56bdfcdd04c3d6e242a056d7f0dd50bb19f6e13226e7c819b83`) já foi extraído e conferido por CRC em `<scratchpad>/microsip-3.22.16-src/MicroSIP-3.22.16-src/`. Confira: `find … -type f | wc -l` → `231`.
- [ ] **Step 2: Criar o ramo órfão** — em `/home/claude/starsonic-phone`: `git switch --orphan upstream`; copie o conteúdo extraído para `microsip/`; crie `.gitattributes` com `microsip/** -text` e `microsip-dist/** -text`; `git add -A`; commit `MicroSIP 3.22.16 (pacote oficial)`; `git tag microsip-3.22.16`.
- [ ] **Step 3: Verificar a cópia** — `diff -r <extraído> microsip/` não imprime nada.
- [ ] **Step 4: Juntar no `main`** — `git switch main && git merge --allow-unrelated-histories upstream -m "Merge MicroSIP 3.22.16"`. Esperado: `git diff --stat microsip-3.22.16 main -- microsip` vazio.
- [ ] **Step 5: LICENSE, .gitignore, README** — `cp /usr/share/common-licenses/GPL-3 LICENSE` e confira o sha256 das Global Constraints; `.gitignore`: `/work/`, `/build-tests/`, `/out*/`, `/dist/`, `starsonic/generated/`, `__pycache__/`; `README.md`: uma frase sobre o projeto + link da spec.
- [ ] **Step 6: Commit** — `chore: esqueleto do repositório e licença GPL v3`.

### Task 2: Harness de testes, utilitários de texto e `ServerProfiles`

**Files:**
- Create: `starsonic/third_party/doctest/doctest.h`, `tests/CMakeLists.txt`, `tests/main.cpp`, `starsonic/core/Text.h/.cpp`, `tests/test_text.cpp`, `starsonic/core/ServerProfiles.h/.cpp`, `tests/test_server_profiles.cpp`, `branding/servidores.ini`, `tests/fixtures/servidores-ci.ini`

**Interfaces:**
- Produces:
```cpp
std::string  StripUtf8Bom(const std::string& bytes);
std::wstring Utf8ToWide(const std::string& utf8);   // sequência inválida → U+FFFD; em Windows gera pares substitutos
std::wstring Trim(const std::wstring& text);        // espaços e tabs nas bordas

enum class Transport { Udp, Tcp, Tls };
enum class SrtpMode { Disabled, Optional, Mandatory };
enum class DtmfMethod { Auto = 0, Inband = 1, Rfc2833 = 2, SipInfo = 3 };   // valores = DTMFMethod do MicroSIP
struct ServerProfile { std::wstring id, name, host, domain; int port; Transport transport;
                       std::wstring proxy; SrtpMode srtp; int keepAliveSeconds; };
struct GlobalProfile { std::wstring stun; std::vector<std::wstring> codecs; DtmfMethod dtmf; };
struct Profiles { GlobalProfile global; std::vector<ServerProfile> servers; };
struct ParseResult { bool ok; int errorLine; std::wstring errorMessage; };
ParseResult ParseProfiles(const std::wstring& text, Profiles* out);
const ServerProfile* FindServer(const Profiles& profiles, const std::wstring& id);
std::wstring CodecsToMicrosip(const std::vector<std::wstring>& codecs);
```

- [ ] **Step 1: Vendorizar o doctest** — `git clone --depth 1 --branch v2.4.11 https://github.com/doctest/doctest`; copie `doctest/doctest.h`; confira o sha256.
- [ ] **Step 2: `tests/CMakeLists.txt`** — projeto `starsonic_tests`, `CMAKE_CXX_STANDARD 14`, executável com `main.cpp` (`#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN`), `test_*.cpp` e `../starsonic/core/*.cpp`; includes `../starsonic/core` e `../starsonic/third_party`; `target_compile_definitions(... STARSONIC_REPO_DIR="${CMAKE_CURRENT_SOURCE_DIR}/..")`; `add_test`. Bloco `if(WIN32)` vazio por enquanto (Task 14).
- [ ] **Step 3: Testes de texto (falhando)**
```cpp
TEST_CASE("StripUtf8Bom removes only a leading BOM") {
  CHECK(StripUtf8Bom("\xEF\xBB\xBF" "a") == "a");
  CHECK(StripUtf8Bom("a\xEF\xBB\xBF") == "a\xEF\xBB\xBF"); }
TEST_CASE("Utf8ToWide decodes accents and replaces invalid bytes") {
  CHECK(Utf8ToWide("Conex\xC3\xA3o") == L"Conexão");
  CHECK(Utf8ToWide("a\xFF" "b") == L"a�b"); }
TEST_CASE("Trim removes spaces and tabs at both ends") { CHECK(Trim(L" \t2001 ") == L"2001"); }
```
- [ ] **Step 4: Rodar e ver falhar** — `cmake -S tests -B build-tests -G Ninja && cmake --build build-tests` → erro de compilação (funções inexistentes).
- [ ] **Step 5: Implementar `Text.h/.cpp`** e rodar `ctest --test-dir build-tests --output-on-failure` → PASS.
- [ ] **Step 6: Testes de `ServerProfiles` (falhando)** — em `test_server_profiles.cpp`, com `const std::wstring base = L"[sp1]\nnome=Servidor 1\nendereco=sip1.exemplo.invalid\nporta=5060\ntransporte=udp\n";`:
  - `parses geral and one server with defaults`: `L"[geral]\nstun=stun.exemplo.invalid:3478\ncodecs=G722,PCMA\ndtmf=rfc2833\n" + base` → `ok`; 1 servidor; `id == L"sp1"`, `domain == L"sip1.exemplo.invalid"`, `proxy == L""`, `srtp == SrtpMode::Disabled`, `keepAliveSeconds == 15`; `global.codecs == {L"G722", L"PCMA"}`; `global.dtmf == DtmfMethod::Rfc2833`.
  - `missing geral uses MicroSIP defaults`: só `base` → `codecs == {L"PCMA", L"PCMU"}`, `stun == L""`, `dtmf == DtmfMethod::Auto`.
  - `parses BOM, CRLF and comments`: `Utf8ToWide(StripUtf8Bom("\xEF\xBB\xBF; comentario\r\n[sp1] ; servidor\r\nnome=S1\r\nendereco=h\r\nporta=5061 ; padrao\r\ntransporte=TLS\r\n"))` → `ok`, `port == 5061`, `transport == Transport::Tls`.
  - `reports line of unknown key`: `L"[sp1]\nnome=a\nendreco=h\nporta=5060\ntransporte=udp\n"` → `!ok`, `errorLine == 3`, mensagem contém `L"endreco"`.
  - `rejects missing required field`: `base` sem a linha `porta` → `!ok`, mensagem contém `L"porta"`.
  - Recusas (`!ok`): id repetido; `[Sp 1]`; `codecs=G711`; `codecs=`; `porta=70000`; `keepalive=0`; `srtp=sim`; chave antes de qualquer seção; arquivo só com `[geral]`.
  - `FindServer returns null for unknown id` e acha `L"sp1"`.
  - `CodecsToMicrosip maps names in order`: `{L"opus", L"G722", L"PCMA", L"PCMU", L"G729"}` → `L"opus/48000/2 G722/16000/1 PCMA/8000/1 PCMU/8000/1 G729/8000/1"`.
  - `real branding file is valid`: lê `STARSONIC_REPO_DIR "/branding/servidores.ini"` (bytes → `StripUtf8Bom` → `Utf8ToWide`) → `ok` e pelo menos 1 servidor.
- [ ] **Step 7: Rodar e ver falhar.**
- [ ] **Step 8: Implementar `ServerProfiles`** — regras: linhas aparadas; vazias e iniciadas por `;` ou `#` ignoradas; em `chave=valor`, tudo após o primeiro `;` é comentário; seção `[geral]` aceita `stun`, `codecs`, `dtmf`; qualquer outra seção é um servidor com id `[a-z0-9_-]+` e chaves `nome`, `endereco`, `dominio`, `porta`, `transporte`, `proxy`, `srtp`, `keepalive` (obrigatórias: `nome`, `endereco`, `porta`, `transporte`); valores de enumeração sem diferenciar maiúsculas (`udp|tcp|tls`, `desativado|opcional|obrigatorio`, `auto|inband|rfc2833|info`); codecs aceitos `opus|G722|PCMA|PCMU|G729`, normalizados para essa grafia; `porta` 1–65535; `keepalive` 1–3600 (padrão 15); `dominio` vazio = `endereco`; mensagens de erro em pt-BR citando a chave ou o valor.
- [ ] **Step 9: Perfis de exemplo e de CI** — `branding/servidores.ini` = exemplo da spec §6.3 (`[geral]` + `[sp1]` com `.invalid`); `tests/fixtures/servidores-ci.ini` = `[geral]` `codecs=PCMA,PCMU`, `dtmf=rfc2833` + `[local]` `nome=Servidor local (CI)`, `endereco=127.0.0.1`, `porta=5060`, `transporte=udp`.
- [ ] **Step 10: Rodar e ver passar** (inclui `real branding file is valid`).
- [ ] **Step 11: Commit** — `feat(core): leitura dos perfis de servidor`.

### Task 3: `AccountPolicy`

**Files:**
- Create: `starsonic/core/AccountPolicy.h/.cpp`, `tests/test_account_policy.cpp`

**Interfaces:**
- Consumes: `ServerProfile`, `GlobalProfile`, `Profiles`, `FindServer`, `CodecsToMicrosip`, `Trim` (Task 2).
- Produces:
```cpp
struct AccountFields {   // espelha os campos de Account (microsip/global.h) que a política toca
  std::wstring serverId, label, server, proxy, domain, username, authId, password, displayName,
               transport, srtp, publicAddr, dialingPrefix, dialPlan, hideCid, voicemailNumber;
  int registerRefresh = 300, keepAlive = 15;
  bool publish = false, ice = false, allowRewrite = false, disableSessionTimer = false; };
struct GlobalFields {    // espelha campos de AccountSettings (microsip/settings.h)
  std::wstring audioCodecs, stun, updatesInterval; bool enableStun = false, rport = true;
  int dtmfMethod = 0, sourcePort = 0, rtpPortMin = 0, rtpPortMax = 0; };
enum class RamalCheck { Ok, Empty, Invalid };
RamalCheck    ValidateRamal(const std::wstring& raw, std::wstring* normalized);
AccountFields BuildAccount(const ServerProfile& server, const std::wstring& ramal, const std::wstring& senha);
bool EnforceAccount(AccountFields* account, const Profiles& profiles);  // false = servidor desconhecido
void EnforceGlobal(GlobalFields* globals, const GlobalProfile& profile);
```

- [ ] **Step 1: Testes (falhando)** — perfil de teste `sp1`: `name L"Servidor 1"`, `host L"h"`, `domain L"h"`, `port 5080`, `Tls`, `proxy L""`, `Optional`, `keepAlive 30`.
  - `ValidateRamal`: `L" 2001 "` → `Ok` e `normalized == L"2001"`; `L""` e `L"   "` → `Empty`; `L"2001@sip.x"`, `L"20 01"`, `L"sip:2001"` → `Invalid`; `L"1001-cliente"` → `Ok`.
  - `BuildAccount fills locked fields from profile`: `server == L"h:5080"`, `domain == L"h"`, `transport == L"tls"`, `srtp == L"optional"`, `keepAlive == 30`, `registerRefresh == 300`, `username == L"2001"`, `displayName == L"2001"`, `authId == L""`, `password == L"x"`, `serverId == L"sp1"`, `label == L"2001 · Servidor 1"`, `publicAddr`, `dialPlan`, `voicemailNumber` vazios, flags falsas.
  - `EnforceAccount restores tampered fields`: a conta acima com `server = L"evil:1"`, `transport = L"udp"`, `publicAddr = L"1.2.3.4"`, `dialPlan = L"x"`, `ice = true` → retorna `true` e volta tudo ao do perfil; `username` e `password` intactos.
  - `EnforceAccount relabels after profile rename`: perfil com `name = L"Novo"` → `label == L"2001 · Novo"`.
  - `account without server id is unknown and cleared`: `serverId = L""` (ou `L"sumiu"`) → `false`; `username`, `password`, `server`, `domain`, `proxy` vazios; `serverId` inalterado.
  - `EnforceGlobal writes locked globals`: codecs `{G722, PCMA}`, stun `L"stun.x:3478"`, dtmf `Rfc2833` → `audioCodecs == L"G722/16000/1 PCMA/8000/1"`, `stun == L"stun.x:3478"`, `enableStun`, `dtmfMethod == 2`, portas `0`, `rport`, `updatesInterval == L"daily"`; com stun vazio → `!enableStun`.
- [ ] **Step 2: Rodar e ver falhar** — `cmake --build build-tests && ctest --test-dir build-tests` → FAIL.
- [ ] **Step 3: Implementar** — `transport`: `udp|tcp|tls`; `srtp`: `""|optional|mandatory`; `server = host + L":" + porta`; label `ramal + L" · " + nome`; travados = tudo exceto `username`, `authId`, `password`, `displayName`; `ValidateRamal` recusa `@`, `:`, espaço, tab e caracteres de controle.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(core): política de contas e configurações travadas`.

### Task 4: `RegistrationErrors` e `LoginFlow`

**Files:**
- Create: `starsonic/core/RegistrationErrors.h/.cpp`, `starsonic/core/LoginFlow.h/.cpp`, `tests/test_registration_errors.cpp`, `tests/test_login_flow.cpp`

**Interfaces:**
- Produces:
```cpp
std::wstring RegistrationMessage(int sipCode, bool tlsFailure);   // L"" para 100–299 sem falha de TLS
enum class LoginState { Idle, Pending, Done };
struct LoginOutcome { bool commit = false; bool rollback = false; std::wstring message; };
class LoginFlow {
 public:
  LoginState State() const;
  void Start();                                              // Idle → Pending; nos outros estados, nada
  LoginOutcome OnRegistration(int sipCode, bool tlsFailure);
  LoginOutcome OnTimeout();
};
```

- [ ] **Step 1: Testes (falhando)** — mensagens exatas (spec 11.1):
  - `(200,false)` → `L""`; `(401|403|407,false)` → `L"Ramal ou senha incorretos."`; `(404,false)` → `L"Ramal não encontrado neste servidor."`; `(0|408|500|503|599,false)` → `L"Não foi possível falar com o servidor. Verifique sua internet."`; `(480,false)` → `L"Não foi possível entrar (código 480). Fale com o suporte da Starsonic."`; `(503,true)` → `L"Não foi possível estabelecer uma conexão segura com o servidor."`.
  - `LoginFlow`: `Start` → `Pending`; `200` → `commit`, estado `Done`; `403` → `rollback` + mensagem de senha, estado `Idle`; `100` e `180` → saída vazia, segue `Pending`; `OnTimeout` → `rollback` + mensagem de servidor; **`late result after timeout is ignored`**: `Start`, `OnTimeout`, `OnRegistration(200,false)` → sem `commit`, sem `rollback`, estado `Idle`; resultado depois do `commit` é ignorado; `Start` durante `Pending` mantém `Pending`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — final com falha = código ≥ 300, ≤ 0 ou `tlsFailure`; 100–199 = provisório.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(core): mensagens de registro e fluxo da tela Entrar`.

### Task 5: `UpdateManifest`

**Files:**
- Create: `starsonic/third_party/nlohmann/json.hpp`, `starsonic/core/UpdateManifest.h/.cpp`, `tests/test_update_manifest.cpp`

**Interfaces:**
- Consumes: `Utf8ToWide` (Task 2).
- Produces:
```cpp
struct Version { int major = 0, minor = 0, patch = 0, rc = 0; };   // rc == 0 → versão final
bool ParseVersion(const std::string& text, Version* out);
int  CompareVersions(const Version& a, const Version& b);          // <0, 0, >0
struct Manifest { Version version; std::string versionText, installerUrl, sha256; std::wstring notes; };
bool ParseManifest(const std::string& utf8Json, const std::string& allowedUrlPrefix,
                   Manifest* out, std::string* error);
```

- [ ] **Step 1: Vendorizar** — `curl -L -o starsonic/third_party/nlohmann/json.hpp https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp`; confira o sha256.
- [ ] **Step 2: Testes (falhando)** — prefixo `P = "https://github.com/acme/starsonic-phone/releases/download/"`:
  - `ParseVersion`: `"1.0.1"` → `{1,0,1,0}`; `"1.0.1-rc.2"` → `rc == 2`; recusa `"1.0"`, `"v1.0.0"`, `"1.0.0-rc"`, `"1.0.0-beta.1"`, `"1.0.0-rc.0"`.
  - `CompareVersions`: `1.0.1 > 1.0.0`; `1.0.1 > 1.0.1-rc.9`; `1.0.1-rc.2 > 1.0.1-rc.1`; `1.1.0 > 1.0.9`; iguais → `0`.
  - `ParseManifest valid`: `{"versao":"1.0.1","instalador":P+"v1.0.1/StarsonicPhone-1.0.1-setup.exe","sha256":<64 hex maiúsculos>,"notas":"ok"}` → `true`, `sha256` em minúsculas, `notes == L"ok"`.
  - Recusas (`false` e `error` não vazio): instalador `https://evil.example/x.exe`; instalador `http://github.com/…`; sha com 63 caracteres; sha com `g`; sem `versao`; `versao` numérico; JSON inválido.
  - **`notes keep UTF-8 and are truncated`**: notas `"Corre\xC3\xA7\xC3\xA3o de \xC3\xA1udio"` → `L"Correção de áudio"`; notas com 600 `a` → `size() == 501` e termina em `L'…'`; sem `notas` → vazio.
- [ ] **Step 3: Rodar e ver falhar.**
- [ ] **Step 4: Implementar** — `nlohmann::json::parse(text, nullptr, false)` (sem exceções); prefixo exato; sha `[0-9a-fA-F]{64}`; notas cortadas em 500 unidades + `…`.
- [ ] **Step 5: Rodar e ver passar.**
- [ ] **Step 6: Commit** — `feat(core): leitura do arquivo de versão`.

### Task 6: `LayoutCollapse`

**Files:**
- Create: `starsonic/core/LayoutCollapse.h/.cpp`, `tests/test_layout_collapse.cpp`

**Interfaces:**
- Produces:
```cpp
struct LayoutBox { int id; int left, top, right, bottom; bool hidden; bool isStaticText; };
struct CollapseResult { std::vector<LayoutBox> boxes; int heightReduction; };
CollapseResult CollapseHidden(const std::vector<LayoutBox>& boxes, int columnSplitX);
```
Algoritmo (as posições de saída dependem dele):
1. Coluna de uma caixa = `left < columnSplitX ? 0 : 1`. Faixas verticais `[top, bottom)` se sobrepõem quando `t1 < b2 && t2 < b1`.
2. Rótulo órfão: um texto estático visível passa a escondido se, na mesma coluna, sobrepõe verticalmente alguma caixa escondida não estática e nenhuma caixa visível não estática.
3. Por coluna, de cima para baixo: uma banda é a união de caixas escondidas que não sobrepõem nenhuma caixa visível; com `a` = topo da banda e `next` = menor `top` de caixa visível com `top >= fim da banda`, todas as caixas visíveis da coluna com `top >= next` sobem `next - a`. Sem caixa visível abaixo da banda, nada se move. Repita até não haver bandas.
4. `heightReduction` = maior `bottom` entre todas as caixas de entrada (escondidas incluídas) − maior `bottom` entre as caixas visíveis da saída.

- [ ] **Step 1: Testes (falhando)** — linhas de 14 px de altura; coluna 0 com `left` 0, coluna 1 com `left` 300; `columnSplitX = 290`:
  - `moves rows below hidden row up`: coluna 0 em 0/18/36; esconder 18 → a linha 36 vai para `top` 18.
  - `other column does not move`: com uma linha da coluna 1 em 18, ela continua em 18.
  - `hides orphan label on hidden row`: rótulo estático em `top` 20 ao lado do campo escondido em 18 → escondido.
  - `keeps label on row with visible control`.
  - `hidden box overlapping visible row does not collapse`.
  - `two hidden rows collapse cumulatively`: coluna 0 em 0/18/36/54; esconder 18 e 36 → 54 vai para 18.
  - `height reduction compares all input boxes with visible output`: coluna 0 em 0/18/36; esconder 36 → `18`.
  - `taller column keeps dialog height`: coluna 0 em 0/18/36 e coluna 1 em 0/18/36/54; esconder 18 da coluna 0 → `0`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar o algoritmo acima.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(core): recálculo do layout ao esconder campos`.

### Task 7: Build do MicroSIP original no Windows e CI

**Files:**
- Create: `build/deps.lock`, `build/config_site.h`, `build/VsEnv.ps1`, `build/Build-Deps.ps1`, `build/Build-App.ps1`, `starsonic/branding_override.h`, `starsonic/starsonic.targets`, `tests/smoke/Common.ps1`, `tests/smoke/Test-StartStop.ps1`, `.github/workflows/build.yml`, `docs/build-notes.md`
- Modify: `microsip/const.h` (E1), `microsip/microsip.vcxproj` (E3)

**Interfaces:**
- Produces: `Build-Deps.ps1 -WorkDir <dir>`; `Build-App.ps1 -WorkDir <dir> -Version <v> -Channel estavel|teste -ProfilesFile <ini> -OutDir <dir>` → `<OutDir>\StarsonicPhone.exe` + `.wav` + tradução (se houver); `Common.ps1`: `Start-App`, `Stop-App`, `Wait-Until`, `Find-Window`, `Find-ById` (UI Automation; AutomationId = id do controle).

- [ ] **Step 1: `build/deps.lock`** (JSON) com os commits do pjproject e do vcpkg, o triplet e as portas das Global Constraints.
- [ ] **Step 2: `build/config_site.h`** inicial:
```c
#define PJMEDIA_HAS_VIDEO        0
#define PJ_HAS_SSL_SOCK          1
#define PJ_SSL_SOCK_IMP          PJ_SSL_SOCK_IMP_OPENSSL
#define PJMEDIA_HAS_SRTP         1
#define PJMEDIA_SRTP_HAS_DTLS    1
#define PJMEDIA_HAS_OPUS_CODEC   1
#define PJMEDIA_HAS_BCG729       1
#define PJMEDIA_HAS_WEBRTC_AEC   1
```
- [ ] **Step 3: `VsEnv.ps1`** — acha o VS 2022 com `vswhere` e entra no shell de desenvolvedor x86 (`Enter-VsDevShell … -DevCmdArguments "-arch=x86"`).
- [ ] **Step 4: `Build-Deps.ps1`** — (1) clona o pjproject e faz checkout do commit fixo, conferindo `git rev-parse HEAD`; (2) copia `config_site.h` para `pjlib\include\pj\`; (3) clona o vcpkg no commit fixo, roda `bootstrap-vcpkg.bat -disableMetrics` e `vcpkg install openssl opus bcg729 sqlite3 sqlitecpp --triplet x86-windows-static`; (4) com `$env:CL = "/I<vcpkg>\installed\x86-windows-static\include"`, compila `pjproject-vs14.sln /t:libpjproject /p:Configuration=Release-Static /p:Platform=Win32 /m`; (5) garante `pjproject\lib\libpjproject-i386-Win32-vc14-Release-Static.lib` (nome do `#pragma` em `mainDlg.h`); se saiu com outro `vcNN`, copia para esse nome e registra em `docs/build-notes.md`; (6) cria um `chkstk_ms.lib` vazio em `pjproject\third_party\lib\` (biblioteca do MinGW listada no projeto do MicroSIP e desnecessária com dependências MSVC).
- [ ] **Step 5: E1 e `branding_override.h` mínimo** — E1 no fim de `const.h`; `branding_override.h` só com `#undef _GLOBAL_VIDEO` (edição Lite).
- [ ] **Step 6: E3 e `starsonic.targets` mínimo** — `TargetName=StarsonicPhone`; propriedade `StarsonicVcpkgRoot` (padrão `$(MSBuildThisFileDirectory)..\..\vcpkg\installed\x86-windows-static`); acrescenta `$(StarsonicVcpkgRoot)\include` e `$(MSBuildThisFileDirectory)` aos includes, `$(StarsonicVcpkgRoot)\lib` aos diretórios de libs e `opus.lib;bcg729.lib;libssl.lib;libcrypto.lib;crypt32.lib;ws2_32.lib` às dependências, sempre preservando `%(…)`.
- [ ] **Step 7: `Build-App.ps1`** — espelha `microsip/`, `starsonic/` e `branding/` para dentro de `<WorkDir>\pjproject\`; copia o conteúdo de `branding/overlay/` por cima de `<WorkDir>\pjproject\` (ex.: `overlay/microsip/res/microsip.ico` → `pjproject\microsip\res\microsip.ico`); gera `starsonic\generated\build_info.h` (`STARSONIC_VERSION "<v>"`, `STARSONIC_VERSION_COMMA X,Y,Z,N` (N = número do rc ou 0), `STARSONIC_BUILD_TIMESTAMP <unix>`, `STARSONIC_UPDATE_CHANNEL_TEST 0|1`, `STARSONIC_HAS_LOGOS 0|1` = existem `branding/logo-faixa.png` e `logo-entrar.png`, copiados para `generated\`); copia `-ProfilesFile` para `generated\servidores.ini`; compila `microsip\microsip.vcxproj /p:Configuration=Release /p:Platform=Win32 /p:StarsonicVcpkgRoot=…`; copia para `-OutDir` o exe, `microsip-dist\*.wav` e `branding\langpack_portuguesebr.txt` (se existirem).
- [ ] **Step 8: Push inicial** — anexe `{conta}/starsonic-phone` à sessão com acesso de push (`add_repo`), configure `origin` e envie `main`, `upstream` e a tag `microsip-3.22.16`.
- [ ] **Step 9: `build.yml`** — gatilhos `push` e `pull_request`; job `core-tests` (`ubuntu-latest`): CMake + `ctest`, e `python3 -m unittest discover -s tests/python` quando a pasta existir; job `windows` (`windows-2022`): cache de `work\pjproject` e `work\vcpkg` com chave `hashFiles('build/deps.lock','build/config_site.h','build/Build-Deps.ps1')`, `Build-Deps.ps1` se o cache faltar, `Build-App.ps1` (versão da tag ou `0.0.0`, canal `estavel`, perfil `branding/servidores.ini`, saída `out`), `Test-StartStop.ps1`, upload de `out\`.
- [ ] **Step 10: `Test-StartStop.ps1`** — inicia o exe, espera 8 s e confere que segue vivo; roda `StarsonicPhone.exe /exit` e confere que o processo termina em até 15 s.
- [ ] **Step 11: Iterar até o workflow ficar verde.** Ajuste só `config_site.h`, scripts e `starsonic.targets`, registrando cada ajuste em `docs/build-notes.md`. **Se só uma mudança no código do MicroSIP resolver, pare, registre o erro e pergunte ao usuário** (spec §13).
- [ ] **Step 12: Commit e push** — `build: compilação do MicroSIP original no GitHub Actions`. Esperado: workflow verde e artefato com `StarsonicPhone.exe`.

### Task 8: Workflow de importação do MicroSIP

**Files:**
- Create: `.github/workflows/importar-microsip.yml`

**Interfaces:**
- Produces: commit no `upstream` com `microsip-dist/`; PR `upstream` → `main`.

- [ ] **Step 1: Escrever o workflow** — `workflow_dispatch` com entrada `versao`; `ubuntu-latest`; permissões `contents: write` e `pull-requests: write`; baixa `https://www.microsip.org/download/MicroSIP-<v>-src.7z` e `…/MicroSIP-Lite-<v>.zip` com `curl -fL`; extrai com `7z`; no ramo `upstream`, espelha o código em `microsip/` (apagando o que sumiu) e copia para `microsip-dist/` só `*.wav` e `langpack_portuguesebr.txt` (se existir); commit `MicroSIP <v>` se houver mudança; tag `microsip-<v>` se não existir; push; `gh pr create --base main --head upstream` se não houver PR aberto.
- [ ] **Step 2: Rodar para 3.22.16** — `gh workflow run importar-microsip.yml -f versao=3.22.16`. Esperado: `microsip/` sem diferença e `microsip-dist/` com `msgin.wav`, `msgout.wav`, `hangup.wav`, `ringtone.wav`, `ringing2.wav`, `ringing.wav`.
- [ ] **Step 3: Revisar e fazer merge do PR**; se `langpack_portuguesebr.txt` não veio, avise o usuário (entrada da spec §12).
- [ ] **Step 4: Commit** — `ci: importação de versões do MicroSIP`.

### Task 9: Marca

**Files:**
- Create: `branding/branding.h`, `starsonic/define_override.h`, `branding/overlay/microsip/res/.gitkeep`, `build/check_branding.py`, `tests/python/test_check_branding.py`, `branding/langpack_portuguesebr.txt` (quando houver)
- Modify: `starsonic/branding_override.h`, `microsip/define.h` (E2), `.github/workflows/build.yml`, `tests/smoke/Test-StartStop.ps1`

**Interfaces:**
- Produces (em `branding/branding.h`, só ASCII, compatível com o compilador de recursos): `STARSONIC_APP_NAME "Starsonic Phone"`, `STARSONIC_COMPANY "Starsonic"`, `STARSONIC_GITHUB_ACCOUNT "definir-conta"`, `STARSONIC_REPO_URL "https://github.com/" STARSONIC_GITHUB_ACCOUNT "/starsonic-phone"`, `STARSONIC_URL_SITE`, `STARSONIC_URL_SUPPORT`, `STARSONIC_PHONE_SUPPORT "(11) 5060-3000"`, `STARSONIC_UPSTREAM_VERSION "3.22.16"`, `STARSONIC_BRAND_COLOR RGB(0x1F,0x4E,0x9C)`, `STARSONIC_BRAND_TEXT_COLOR RGB(0xFF,0xFF,0xFF)`, `STARSONIC_BRAND_IS_PLACEHOLDER 1`.
- `check_branding.py --repo <dir> [--exe <arquivo>]` → código 0 ou 1 com a lista `arquivo:linha: trecho`.

- [ ] **Step 1: Testes do verificador (falhando)** — `unittest` com pastas temporárias:
  - `test_rc_literal_with_microsip_fails` (`CAPTION "MicroSIP"` em `.rc2`).
  - `test_legal_copyright_line_is_allowed`.
  - `test_langpack_translation_fails_but_key_is_ignored` (`[Visit MicroSIP]` passa; tradução `Visitar MicroSIP` falha).
  - `test_nsi_and_new_code_literals_are_checked` (`starsonic/**/*.cpp|.h`, `installer/*.nsi`).
  - `test_about_attribution_is_allowed` (linha com `kAttribution` em `starsonic/win/AboutDialog.cpp`).
  - `test_exe_allows_only_copyright_and_attribution` (binário sintético com `Copyright (c) 2011-2025, MicroSIP` e `Baseado no MicroSIP` em UTF-16LE passa; um `MicroSIP` solto falha). Diferencia maiúsculas: só `MicroSIP` exato.
- [ ] **Step 2: Rodar e ver falhar** — `python3 -m unittest discover -s tests/python -v`.
- [ ] **Step 3: Implementar `check_branding.py`** — escopo: `microsip/**/*.rc|*.rc2`, `starsonic/win/*.rc`, tradução (linhas após o cabeçalho que não começam com `[` nem `;`), `installer/*.nsi`, literais de `starsonic/**/*.cpp|*.h` e `branding/branding.h`; no exe, decodifica ASCII e UTF-16LE e só aceita ocorrências precedidas de `Copyright (c) 2011-2025, ` ou `Baseado no `.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Overrides** — `branding_override.h` passa a incluir `..\branding\branding.h` e `generated\build_info.h` e redefine (`#undef` + `#define`) `_GLOBAL_NAME`, `_GLOBAL_COMPANY`, `_GLOBAL_VERSION`, `_GLOBAL_VERSION_COMMA`, `_GLOBAL_TIMESTAMP` com as constantes `STARSONIC_*` (mantendo `#undef _GLOBAL_VIDEO`). E2 + `define_override.h` redefine `_GLOBAL_MENU_WEBSITE` (site), `_GLOBAL_MENU_DOWNLOADS` e `_GLOBAL_URL_CHECK_VERSION` (`STARSONIC_REPO_URL "/releases/latest"`), `_GLOBAL_MENU_ISSUES`, `_GLOBAL_MENU_HELP` e `_GLOBAL_HELP_WEBSITE` (suporte). Com isso, título, bandeja, pastas, INI (`StarsonicPhone.ini`), User-Agent (`Starsonic Phone/<versão>`), recurso de versão e prazo de validade passam a usar a marca e o build da Starsonic.
- [ ] **Step 6: Tradução** — copie `microsip-dist/langpack_portuguesebr.txt` (ou o arquivo exportado pelo usuário) para `branding/`, preservando a codificação; nas linhas de tradução, troque `MicroSIP` por `Starsonic Phone`; a tradução de `[Online]` passa a ser `Conectado`. Sem o arquivo, siga sem ele (entrada pendente).
- [ ] **Step 7: CI e fumaça** — `build.yml` roda `python build/check_branding.py --repo . --exe out\StarsonicPhone.exe`; `Test-StartStop.ps1` passa a conferir uma janela de nível superior com classe `Starsonic Phone` e título começando por `Starsonic Phone`.
- [ ] **Step 8: Push e conferir o workflow verde.**
- [ ] **Step 9: Commit** — `feat(marca): nome, URLs, versão e verificação de marca`.

### Task 10: Perfis embutidos e política na inicialização

**Files:**
- Create: `starsonic/win/StarsonicIds.h`, `starsonic/win/starsonic.rc`, `starsonic/win/ProfilesStore.h/.cpp`, `starsonic/win/AccountAdapter.h/.cpp`, `starsonic/win/Hooks.h/.cpp`, `tests/smoke/Test-Policy.ps1`
- Modify: `starsonic/starsonic.targets`, `microsip/microsip.cpp` (E4), `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `ParseProfiles`, `EnforceAccount`, `EnforceGlobal` (Tasks 2–3).
- Produces:
```cpp
// StarsonicIds.h (só #define; ids a partir de 41000): IDR_STARSONIC_SERVERS 41000
const starsonic::Profiles& LoadedProfiles();   // ProfilesStore: lê o recurso na 1ª chamada
starsonic::AccountFields ToFields(const Account& account, const CString& serverId);
void FromFields(const starsonic::AccountFields& fields, Account* account);
CString ReadServerId(int accountId);                   // chave starsonicServer de [Account<id>] em accountSettings.iniFile
void WriteServerId(int accountId, const CString& serverId);   // vazio apaga a chave
starsonic::GlobalFields GlobalsFrom(const AccountSettings& settings);
void GlobalsTo(const starsonic::GlobalFields& globals, AccountSettings* settings);
namespace starsonic { void OnSettingsLoaded(); }       // Hooks: E4
```

- [ ] **Step 1: Recursos e alvos** — `starsonic.rc` (ASCII, inclui `StarsonicIds.h`): `IDR_STARSONIC_SERVERS RCDATA "..\\generated\\servidores.ini"`; em `starsonic.targets`, `ClCompile` para `core\*.cpp` (sem PCH) e `win\*.cpp` (PCH `stdafx.h`), inclui `third_party`, e `ResourceCompile` para `win\starsonic.rc`.
- [ ] **Step 2: `ProfilesStore`** — `FindResource`/`LoadResource` → bytes → `StripUtf8Bom` → `Utf8ToWide` → `ParseProfiles`; se falhar, `AfxMessageBox(L"Arquivo de servidores inválido (linha N): <mensagem>")` e encerra.
- [ ] **Step 3: `AccountAdapter`** — conversão campo a campo entre `Account` (`microsip/global.h`) e `AccountFields`, e entre `AccountSettings` (`microsip/settings.h`: `audioCodecs`, `stun`, `enableSTUN`, `DTMFMethod`, `sourcePort`, `rtpPortMin`, `rtpPortMax`, `rport`, `updatesInterval`) e `GlobalFields`.
- [ ] **Step 4: `OnSettingsLoaded`** — para cada `i = 1, 2, …` enquanto `accountSettings.AccountLoad(i, &acc)` der certo: `ToFields` → `EnforceAccount` → `FromFields` → `accountSettings.AccountSave(i, &acc)`; depois `EnforceGlobal` nas globais e `accountSettings.SettingsSave()`; recarrega `accountSettings.account` se `accountId > 0`. Uma conta de servidor desconhecido fica com o ramal vazio; o próprio MicroSIP chama `OnAccount` ao ativá-la, e a tela Entrar (Task 11) mostra o aviso.
- [ ] **Step 5: E4.**
- [ ] **Step 6: `Test-Policy.ps1`** — com `out-ci` (build com `-ProfilesFile tests/fixtures/servidores-ci.ini`, que o `build.yml` passa a gerar), grava `StarsonicPhone.ini` (UTF-16LE com BOM; modo portátil) com `[Settings]` `accountId=1`, `audioCodecs=G729/8000/1`, `STUN=evil.example`, `enableSTUN=1`; `[Account1]` `server=evil.example:5060`, `domain=evil.example`, `username=2001`, `transport=tcp`, `starsonicServer=local`; `[Account2]` `server=x:5060`, `domain=x`, `username=2002`. Inicia o app, espera 5 s, roda `/exit` e confere: `Account1` `server=127.0.0.1:5060`, `transport=udp`, `username=2001`; `Account2` `username` vazio; `[Settings]` `audioCodecs=PCMA/8000/1 PCMU/8000/1`, `enableSTUN=0`, `updatesInterval=daily`.
- [ ] **Step 7: Push e conferir o workflow verde** (`Test-StartStop`, `Test-Policy`, marca).
- [ ] **Step 8: Commit** — `feat(win): perfis embutidos e travas na inicialização`.

### Task 11: Tela Entrar

**Files:**
- Create: `starsonic/win/Logo.h/.cpp`, `starsonic/win/LoginDialog.h/.cpp`, `tests/smoke/fake_registrar.py`, `tests/python/test_fake_registrar.py`, `tests/smoke/Test-Login.ps1`
- Modify: `starsonic/win/StarsonicIds.h`, `starsonic/win/starsonic.rc`, `starsonic/win/Hooks.h/.cpp`, `microsip/mainDlg.cpp` (include, E7, E8, E9), `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `ValidateRamal`, `BuildAccount`, `LoginFlow`, `RegistrationMessage`, `LoadedProfiles`, `ToFields`/`FromFields`, `ReadServerId`/`WriteServerId`.
- Produces:
```cpp
void DrawLogo(CDC* dc, const CRect& area, UINT pngResourceId, COLORREF textColor);  // PNG RCDATA; sem recurso, escreve "Starsonic" em negrito
class CStarsonicLoginDlg : public CThemeDialog {
 public:
  explicit CStarsonicLoginDlg(CmainDlg* main);   // modeless (Create(IDD_STARSONIC_LOGIN))
  void Load(int accountId, bool focusPassword);   // -1 = nova conta
  bool IsPending() const;
  void OnRegistrationState(int sipCode);
};
namespace starsonic {
void ShowLogin(CmainDlg* main, int accountId, bool focusPassword);   // E8
void OnRegistrationState(CmainDlg* main, int sipCode);               // E9
void OnMainWindowCreated(CmainDlg* main);                           // E7: accountId == 0 → ShowLogin(main, -1, false)
}
```
- Ids: `IDD_STARSONIC_LOGIN 41010`; `IDC_SS_LOGO 41011`, `IDC_SS_SERVER 41012`, `IDC_SS_RAMAL 41013`, `IDC_SS_SENHA 41014`, `IDC_SS_MESSAGE 41015`, `IDC_SS_ENTRAR 41016`, `IDC_SS_REMOVE 41017`, `IDC_SS_HELP 41018`; `IDR_STARSONIC_LOGO_LOGIN 41102` (só com `STARSONIC_HAS_LOGOS`); timer `41301` (15 000 ms).

- [ ] **Step 1: Testes do registrador falso (falhando)** — `test_digest_response_matches_rfc2617_example` (exemplo da RFC 2617 com `algorithm=MD5`, sem `qop`); `test_register_without_auth_gets_401_with_challenge`; `test_wrong_password_gets_403`; `test_right_password_gets_200_with_expires`.
- [ ] **Step 2: Rodar e ver falhar; implementar `fake_registrar.py`** — UDP `127.0.0.1:5060`; `REGISTER` sem `Authorization` → `401` com `WWW-Authenticate: Digest realm="ci", nonce="<hex>", algorithm=MD5`; com `Authorization` → confere o digest de `--user 2001 --password senha-certa` → `200 OK` (`Expires`, `Contact` ecoado) ou `403`; copia `Via`, `From`, `To` (+`;tag=ci`), `Call-ID`, `CSeq`; grava o último `User-Agent` recebido no arquivo de `--log`. Rodar e ver passar.
- [ ] **Step 3: Modelo da janela** em `starsonic.rc` (ASCII, DLU, fonte 8 "Microsoft Sans Serif", 180×190): logo `10,8,160,28`; rótulo e lista `IDC_SS_SERVER` (`CBS_DROPDOWNLIST`) `10,54,160,100`; `IDC_SS_RAMAL` `10,84,160,14`; `IDC_SS_SENHA` (`ES_PASSWORD`) `10,114,160,14`; `IDC_SS_MESSAGE` `10,132,160,16`; `IDC_SS_ENTRAR` `10,150,160,16`; `IDC_SS_REMOVE` (SysLink) `10,172,80,10`; `IDC_SS_HELP` `90,172,80,10`.
- [ ] **Step 4: `Logo` e `CStarsonicLoginDlg`** — em `OnInitDialog`: título `L"Starsonic Phone — Entrar"`, rótulos `Servidor`, `Ramal`, `Senha`, botão `Entrar` (`CButtonEx` com `m_FaceColor = STARSONIC_BRAND_COLOR`), link `<a>Remover conta</a>`, ajuda `L"Precisa de ajuda? " STARSONIC_PHONE_SUPPORT`; lista com os nomes de `LoadedProfiles().servers` (o 1º selecionado). `Load(id, focus)`: nova conta → campos limpos; edição → servidor e ramal da conta, link de remover visível; se `ReadServerId(id)` não existe no perfil → mensagem `L"O servidor desta conta mudou. Entre novamente."`. Mensagens de erro em vermelho (`OnCtlColor`), `L"Conectando…"` em cor neutra.
- [ ] **Step 5: Entrar** — `ValidateRamal` (`Empty`/`Invalid` → `L"Digite só o número do ramal."`); senha vazia → `L"Digite a senha."`; guarda `prevId`/`prevAccount`; alvo = id editado ou o 1º `i` livre; `flow.Start()`; `main->PJAccountDelete(true)`; `accountSettings.accountId = alvo`; `FromFields(BuildAccount(…), &accountSettings.account)`; `OnAccountChanged()`, `InitUI()`, `PJAccountAdd()`; desabilita os campos; liga o timer.
- [ ] **Step 6: Resultado** — `OnRegistrationState(code)`: TLS = `pjsua_acc_get_info(account)` com `reg_last_err` entre `PJ_SSL_ERRNO_START` e `PJ_SSL_ERRNO_START + PJ_ERRNO_SPACE_SIZE`; aplica `flow.OnRegistration`; `commit` → `AccountSave(alvo)`, `WriteServerId(alvo, id)`, `SettingsSave()`, fecha; `rollback` → `PJAccountDelete(true)`, restaura `prevId`/`prevAccount`, `OnAccountChanged()`, `InitUI()`, `PJAccountAdd()` se `prevId > 0`, mostra a mensagem e reabilita. Timer → `flow.OnTimeout()` com o mesmo tratamento.
- [ ] **Step 7: Remover conta** — confirmação `L"Remover esta conta?"`; mesma lógica de `AccountDlg::OnNMClickSyslinkDelete` (desloca as contas seguintes), deslocando também `starsonicServer`; sem contas, volta a `Load(-1, false)`.
- [ ] **Step 8: Ganchos e edições** — `Hooks.cpp` guarda `g_loginDlg` (zerado no `PostNcDestroy`); `ShowLogin` ignora chamadas com login pendente; `OnRegistrationState` repassa só com login pendente. Include + E7, E8, E9 em `mainDlg.cpp`. A janela de conta Local (`OnMenuAccountLocalEdit`) continua sendo a `AccountDlg` original.
- [ ] **Step 9: `Test-Login.ps1`** — sobe o registrador falso; apaga o INI do `out-ci`; inicia o app; espera a janela `Starsonic Phone — Entrar`; confere o servidor `Servidor local (CI)`; ramal `2001@x` → `Digite só o número do ramal.`; ramal `2001` + senha `errada` → `Ramal ou senha incorretos.` em até 20 s; senha `senha-certa` → janela fecha em até 20 s; INI com `[Account1]` `username=2001` e `starsonicServer=local`; o `--log` do registrador traz `Starsonic Phone/0.0.0` (M6); `/exit`; derruba o registrador.
- [ ] **Step 10: Push e conferir o workflow verde.**
- [ ] **Step 11: Commit** — `feat(win): tela Entrar`.

### Task 12: Faixa da marca, botão Ligar e tela Sobre

**Files:**
- Create: `starsonic/win/BrandBand.h/.cpp`, `starsonic/win/AboutDialog.h/.cpp`, `tests/smoke/Test-BrandUi.ps1`
- Modify: `starsonic/define_override.h`, `starsonic/win/StarsonicIds.h`, `starsonic/win/starsonic.rc`, `starsonic/win/Hooks.h/.cpp`, `microsip/mainDlg.cpp` (E6, E10, E11), `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `DrawLogo` (Task 11).
- Produces:
```cpp
class CStarsonicBrandBand : public CStatic { public: void SetStatus(const CString& text); };  // SetWindowText + repintura
class CStarsonicAboutDlg : public CThemeDialog { public: explicit CStarsonicAboutDlg(CWnd* parent); };  // modal
namespace starsonic {
void InstallBrandBand(CmainDlg* main);                 // E6
void OnStatusText(CmainDlg* main, const CString& text); // E10
void AddMenuItems(CMenu* menu);                        // E11: ID_CUSTOM_RANGE, L"Sobre o Starsonic Phone"
void OnCustomMenu(CmainDlg* main, UINT id);            // E11: ID_CUSTOM_RANGE → tela Sobre
}
```
- Ids: `IDC_STARSONIC_BAND 41200`; `IDD_STARSONIC_ABOUT 41020`, `IDC_SS_ABOUT_LOGO 41021`, `IDC_SS_ABOUT_VERSION 41022`, `IDC_SS_ABOUT_LINKS 41023`, `IDC_SS_ABOUT_LICENSE 41024`; `IDR_STARSONIC_LOGO_BAND 41101`.

- [ ] **Step 1: Botão Ligar** — em `define_override.h`, `#undef` + `#define _GLOBAL_DIALER_CALL_COLOR STARSONIC_BRAND_COLOR`.
- [ ] **Step 2: `InstallBrandBand`** — altura `22` DLU (`MapDialogRect`); desce `m_mainTab` e `m_ButtonMenu` por essa altura, aumenta a janela na mesma medida (`SWP_NOMOVE`), cria a faixa (`IDC_STARSONIC_BAND`, `SS_OWNERDRAW`) em `0,0,largura,altura` e chama `main->AutoMove(band, 0, 0, 100, 0)`. Roda antes do código de `OnInitDialog` que mede a aba, então as páginas descem sozinhas.
- [ ] **Step 3: Desenho da faixa** — fundo `STARSONIC_BRAND_COLOR`; `DrawLogo(IDR_STARSONIC_LOGO_BAND)` à esquerda (margem 8 px, altura da faixa − 12 px); status à direita em `STARSONIC_BRAND_TEXT_COLOR`, centralizado na vertical, com reticências.
- [ ] **Step 4: `OnStatusText`** — texto da faixa = `text` + (`accountSettings.accountId > 0` ? `L" · " + accountSettings.account.label` : vazio).
- [ ] **Step 5: Tela Sobre** — título `Sobre o Starsonic Phone`; versão `Starsonic Phone <STARSONIC_VERSION> (baseado no MicroSIP <STARSONIC_UPSTREAM_VERSION>)`; links `starsonic.com.br · WhatsApp · (11) 5060-3000`; licença `kAttribution` = `L"Baseado no MicroSIP — software livre sob a GNU GPL v3 — código-fonte: "` + link de `STARSONIC_REPO_URL`; botão `Fechar`. Cliques nos links abrem com `MSIP::OpenURL`.
- [ ] **Step 6: Ganchos e edições E6, E10, E11.**
- [ ] **Step 7: `Test-BrandUi.ps1`** — com o app aberto: o elemento `IDC_STARSONIC_BAND` existe e tem nome não vazio; aciona `IDC_MAIN_MENU`, invoca o item `Sobre o Starsonic Phone`; na tela Sobre, `IDC_SS_ABOUT_VERSION` = `Starsonic Phone 0.0.0 (baseado no MicroSIP 3.22.16)` e `IDC_SS_ABOUT_LICENSE` contém `GNU GPL v3`. O `Test-Login.ps1` passa a conferir que, após entrar, o nome da faixa contém `2001` e `Servidor local (CI)`.
- [ ] **Step 8: Push e conferir o workflow verde** (inclui `check_branding`).
- [ ] **Step 9: Commit** — `feat(win): faixa da marca, botão Ligar e tela Sobre`.

### Task 13: Filtro da tela de Configurações

**Files:**
- Create: `starsonic/win/SettingsFilter.h/.cpp`, `tests/smoke/Test-Settings.ps1`
- Modify: `starsonic/win/Hooks.h/.cpp`, `microsip/SettingsDlg.cpp` (E13), `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `CollapseHidden` (Task 6).
- Produces: `namespace starsonic { void FilterSettings(CDialog* settingsDlg); }` (E13).

- [ ] **Step 1: Implementar** — ids travados (de `microsip/resource.h`): `IDC_SETTINGS_AUDIO_CODECS_ALL`, `IDC_SETTINGS_AUDIO_CODECS`, `IDC_SETTINGS_SPIN_MODIFY`, `IDC_SETTINGS_SPIN_ORDER`, `IDC_SETTINGS_HELP_AUDIO_CODECS`, `IDC_SETTINGS_SOURCE_PORT`, `IDC_SETTINGS_RPORT`, `IDC_SETTINGS_RTP_PORT_MIN`, `IDC_SETTINGS_RTP_PORT_MAX`, `IDC_SETTINGS_HELP_PORTS`, `IDC_SETTINGS_STUN_CHECKBOX`, `IDC_SETTINGS_STUN`, `IDC_SETTINGS_HELP_STUN_SERVER`, `IDC_SETTINGS_DTMF_METHOD`, `IDC_SETTINGS_HELP_DTMF_METHOD`, `IDC_SETTINGS_UPDATES_INTERVAL`. Percorre os filhos diretos (estático = classe `Static` com id `0xFFFF`), monta `LayoutBox` em coordenadas do cliente, coluna em `MapDialogRect(290 DLU)` (`IDD_SETTINGS_OFFSET_COLUMN`), aplica `CollapseHidden`, esconde e move os controles e reduz a altura da janela em `heightReduction`.
- [ ] **Step 2: E13.**
- [ ] **Step 3: `Test-Settings.ps1`** — abre Configurações pelo menu (item com AutomationId `ID_SETTINGS`), localiza a janela pelo controle `IDC_SETTINGS_RINGTONE`; confere que cada id travado está ausente ou `IsOffscreen`; `IDC_SETTINGS_STARTUP` e `IDC_SETTINGS_DNS_SRV_CHECKBOX` visíveis; `IDOK` dentro da área da janela; fecha com `IDCANCEL`. Os números dos ids vêm de `microsip/resource.h`.
- [ ] **Step 4: Push e conferir o workflow verde.**
- [ ] **Step 5: Commit** — `feat(win): campos travados somem das Configurações`.

### Task 14: Atualizador

**Files:**
- Create: `starsonic/win/Http.h/.cpp`, `starsonic/win/Sha256.h/.cpp`, `tests/win/test_sha256.cpp`, `starsonic/win/Updater.h/.cpp`
- Modify: `tests/CMakeLists.txt` (bloco `WIN32`), `starsonic/win/Hooks.h/.cpp`, `microsip/mainDlg.cpp` (E12), `.github/workflows/build.yml` (testes do core também no Windows)

**Interfaces:**
- Consumes: `ParseManifest`, `ParseVersion`, `CompareVersions` (Task 5).
- Produces:
```cpp
struct HttpResponse { DWORD status = 0; std::string body; DWORD error = 0; };
HttpResponse HttpsGet(const std::wstring& url, size_t maxBytes);   // só https; WinHTTP; certificado validado
std::string Sha256Hex(const std::string& bytes);                    // BCrypt; hexadecimal minúsculo
std::wstring ManifestUrl();          // estável ou canal-teste, por STARSONIC_UPDATE_CHANNEL_TEST
std::string  InstallerUrlPrefix();   // STARSONIC_REPO_URL "/releases/download/"
namespace starsonic {
void CheckUpdates(CmainDlg* main);                                  // E12
void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool manual);   // E12
}
```

- [ ] **Step 1: Teste do SHA-256 (falhando, só Windows)** — `Sha256Hex("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; `Sha256Hex("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. `tests/CMakeLists.txt`: em `WIN32`, inclui `../starsonic/win/Sha256.cpp` e `win/test_sha256.cpp` e liga `bcrypt`; `build.yml` roda CMake + `ctest` também no job `windows`.
- [ ] **Step 2: Implementar `Sha256` e ver passar no CI.**
- [ ] **Step 3: `HttpsGet`** — `WinHttpOpen` com agente `Starsonic Phone/<versão>` e proxy automático; recusa URL que não começa com `https://`; não altera `WINHTTP_OPTION_SECURITY_FLAGS`; redirecionamentos na política padrão (não desce de HTTPS para HTTP); tempos de 10 s para conexão e 30 s para leitura; corta em `maxBytes` (1 MB para o manifesto, 150 MB para o instalador).
- [ ] **Step 4: Verificação** — `CheckUpdates(main)`: thread de trabalho → `HttpsGet(ManifestUrl())` → aloca um `URLGetAsyncData` (de `microsip/global.h`), preenche `statusCode`, `body` e `userData = &kManifestTag` e faz `PostMessage(main->m_hWnd, UM_UPDATE_CHECKER_LOADED, (WPARAM)data, 0)`, reaproveitando a mensagem que o MicroSIP já trata.
- [ ] **Step 5: `OnUpdateMessage`** — manifesto: `ParseManifest(body, InstallerUrlPrefix())`; inválido ou sem novidade → só log (`PJ_LOG`), e se `manual`, `L"Você já está na versão mais recente."`; versão maior que `STARSONIC_VERSION` → `MessageBox` (título `Starsonic Phone`, `MB_YESNO`): `L"Nova versão do Starsonic Phone disponível (<versão>). Atualizar agora?"` + notas; Sim com `pjsua_call_get_count() > 0` → `L"Termine a chamada para atualizar."`; senão, status `L"Baixando atualização…"` e thread que baixa para `%TEMP%\StarsonicPhone-<versão>-setup.exe`, confere `Sha256Hex` e posta o resultado com `userData = &kInstallerTag`. Instalador pronto: confere de novo as chamadas, `ShellExecuteW(…, L"/S", SW_HIDE)` e `main->PostMessage(WM_COMMAND, ID_EXIT)`; falha ou hash diferente → apaga o arquivo e `L"Não foi possível baixar a atualização. Tentaremos de novo mais tarde."`.
- [ ] **Step 6: Timer de 24 h** — `OnMainWindowCreated` liga `SetTimer(main->m_hWnd, 41302, 86400000, UpdateTimerProc)`; o callback chama `main->CheckUpdates()` e grava `accountSettings.checkUpdatesTime`.
- [ ] **Step 7: E12** — o canal já vem de `STARSONIC_UPDATE_CHANNEL_TEST`, gerado pelo `Build-App.ps1 -Channel` (Task 7).
- [ ] **Step 8: Push e conferir o workflow verde.** O fluxo completo é validado no checklist manual (Task 18) com o `canal-teste`.
- [ ] **Step 9: Commit** — `feat(win): atualizador com verificação de certificado e SHA-256`.

### Task 15: Relatórios de falha (M10)

> M10 aprovado pela Starsonic em 11/10/2026.

**Files:**
- Modify: `starsonic/define_override.h`, `microsip/microsip.cpp` (E5), `build/check_branding.py`, `tests/python/test_check_branding.py`

- [ ] **Step 1: E5** e `#define STARSONIC_CRASH_UPLOAD 0` em `define_override.h`. O dump local (`crash-dump_*.dmp/.txt` em `%LOCALAPPDATA%\Starsonic Phone\`) e a mensagem continuam; os links da mensagem já apontam para o suporte da Starsonic (Task 9).
- [ ] **Step 2: Teste (falhando)** — `test_exe_must_not_contact_microsip_hosts`: binário sintético com `crash-report2.microsip.org` ou `update.microsip.org` falha; `MicroSIP (www.microsip.org)` (copyright) passa. Implementar a regra (sem diferenciar maiúsculas, ASCII e UTF-16LE) e ver passar.
- [ ] **Step 3: Push e conferir o workflow verde** — o exe não pode mais conter hosts do MicroSIP além do copyright.
- [ ] **Step 4: Commit** — `feat: relatórios de falha ficam só no PC`.

### Task 16: Instalador

**Files:**
- Create: `installer/StarsonicPhone.nsi`, `build/Build-Installer.ps1`, `tests/smoke/Test-Installer.ps1`
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Produces: `Build-Installer.ps1 -Version <v> -AppDir out -OutDir dist` → `dist\StarsonicPhone-<v>-setup.exe`.

- [ ] **Step 1: Script NSIS** — `Unicode true`; MUI2 em `PortugueseBR`; `Name "Starsonic Phone"`; `RequestExecutionLevel user`; `InstallDir "$LOCALAPPDATA\Starsonic Phone"`; `MUI_ICON` = `branding\overlay\microsip\res\microsip.ico` se existir, senão o ícone do upstream; página de boas-vindas com `branding/installer/boas-vindas.bmp` quando existir; componentes `Atalho na área de trabalho` e `Iniciar com o Windows` (marcados); página final com `Abrir o Starsonic Phone`.
- [ ] **Step 2: Instalação** — se o app estiver aberto: `ExecWait '"$INSTDIR\StarsonicPhone.exe" /exit'` e espera até 15 s a janela de classe `Starsonic Phone` sumir; copia exe, `.wav` e tradução; `WriteUninstaller "$INSTDIR\Uninstall.exe"`; `HKCU\Software\Starsonic Phone` `(Padrão)=$INSTDIR` (o MicroSIP usa isso para entrar em modo instalado) e `RunAtSystemStartup` (DWORD do componente); atalho `$SMPROGRAMS\Starsonic Phone.lnk`; chave `HKCU\…\Uninstall\StarsonicPhone` com `DisplayName`, `DisplayVersion`, `Publisher "Starsonic"`, `DisplayIcon`, `UninstallString`, `QuietUninstallString`, `InstallLocation`, `URLInfoAbout`, `NoModify=1`, `NoRepair=1`. Em `/S`: não mexe em atalhos nem em `RunAtSystemStartup` e, ao terminar, abre o app.
- [ ] **Step 3: Desinstalação** — fecha o app (`/exit`), remove arquivos, atalhos, `HKCU\Software\Starsonic Phone`, o valor `Starsonic Phone` de `HKCU\…\Run` e a chave de desinstalação; mantém `%APPDATA%\Starsonic Phone`.
- [ ] **Step 4: `Test-Installer.ps1`** — `setup /S`; confere exe, `Uninstall.exe`, `.wav`, atalho do menu Iniciar, `(Padrão)` do registro = pasta e `DisplayVersion`; abre o app instalado; roda o mesmo `setup /S` de novo e confere que o app foi reaberto (PID novo, vivo); `Uninstall.exe /S`; confere arquivos e chaves removidos e `%APPDATA%\Starsonic Phone` mantido.
- [ ] **Step 5: CI** — `build.yml` gera o instalador, roda `Test-Installer.ps1` e publica `dist\` como artefato.
- [ ] **Step 6: Push, workflow verde e commit** — `feat: instalador por usuário`.

### Task 17: Release, pacote de código-fonte e portão de entradas

**Files:**
- Create: `.github/workflows/release.yml`, `build/make_manifest.py`, `build/check_release_inputs.py`, `build/Make-SourceBundle.ps1`, `tests/python/test_make_manifest.py`, `tests/python/test_check_release_inputs.py`, `notas/.gitkeep`
- Modify: `.github/workflows/build.yml` (`workflow_call` com entradas `version` e `channel`; artefato `fontes-dependencias` com o `git archive` do pjproject e `work\vcpkg\downloads`)

**Interfaces:**
- Produces: `make_manifest.py --version <v> --installer-url <url> --sha256 <hex> [--notes-file <txt>] --out versao.json`; `check_release_inputs.py --repo <dir>` → 0 ou 1 com a lista do que falta.

- [ ] **Step 1: Testes (falhando)** — `make_manifest`: gera exatamente as chaves `versao`, `instalador`, `sha256`, `notas` em UTF-8 sem escapar acentos; recusa versão fora de `X.Y.Z[-rc.N]`, sha inválido e URL não https. `check_release_inputs`: falha com `definir-conta`, com `STARSONIC_BRAND_IS_PLACEHOLDER 1`, com `.invalid` em `servidores.ini` e com qualquer item ausente entre os três ícones de `branding/overlay/microsip/res/`, `logo-faixa.png`, `logo-entrar.png`, `langpack_portuguesebr.txt` e `installer/boas-vindas.bmp`; passa com tudo presente.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: `Make-SourceBundle.ps1`** — zip `StarsonicPhone-<v>-codigo-fonte-completo.zip` com o `git archive` da tag, o pjproject no commit fixo, os pacotes de código baixados pelo vcpkg e um `LEIA-ME-FONTES.txt` com versões e commits.
- [ ] **Step 4: `release.yml`** — tags `v*`; canal = `teste` se houver `-rc.`, senão `estavel`; no estável, exige `check_release_inputs.py` verde e `notas/v<v>.txt`; chama `build.yml`; calcula o SHA-256 do instalador; gera `versao.json` com o instalador em `{repo}/releases/download/v<v>/…` e `notas/v<v>.txt` como `--notes-file` (no rc, só se existir); `gh release create` com os três arquivos (`--prerelease` no rc). No rc, cria o release `canal-teste` se faltar e envia instalador e `versao.json` com `--clobber`.
- [ ] **Step 5: Validar com `v0.0.1-rc.1`** — pre-release com três arquivos; `curl -L {repo}/releases/download/canal-teste/versao.json` traz o sha256 do instalador publicado.
- [ ] **Step 6: Commit** — `ci: publicação de versões e código-fonte completo`.

### Task 18: Checklist manual, README e revisão final

**Files:**
- Create: `docs/teste-manual.md`
- Modify: `README.md`

- [ ] **Step 1: `docs/teste-manual.md`** — os itens da spec §11.3 como passos com resultado esperado, incluindo a atualização `v0.0.1-rc.1` → `v0.0.1-rc.2` pelo `canal-teste` e o bloqueio com chamada em andamento.
- [ ] **Step 2: README** — o que é; como compilar (`Build-Deps.ps1`, `Build-App.ps1`); como lançar versão (tag, notas, portão de entradas); como trazer um MicroSIP novo (`importar-microsip` → PR → resolver conflitos só nas edições E1–E13); licença; aviso de que a conta do GitHub precisa de verificação em duas etapas (spec §13).
- [ ] **Step 3: Revisão final** — workflow verde no `main`; cada critério de sucesso da spec §3 apontado para o teste ou passo do checklist que o cobre; lista das entradas ainda pendentes.
- [ ] **Step 4: Commit** — `docs: checklist de teste manual e README`.
