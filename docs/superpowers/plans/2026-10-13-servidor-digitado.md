# Servidor digitado na tela Entrar — Plano de implementação (revisão 1.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a lista de servidores da tela Entrar por um campo de endereço digitado, com um perfil único (`branding/perfil.ini`) que continua travando porta, transporte, proxy, SRTP, keepalive, STUN, codecs e DTMF.

**Architecture:** No núcleo, `ServerProfiles` vira `Profile` (seções `[geral]` e `[conta]`), e o `AccountPolicy` ganha a validação do endereço e passa a montar e reaplicar as contas a partir do endereço guardado no campo `server` da própria conta. Na integração, a tela Entrar troca o combo por um campo de texto e a chave `starsonicServer` deixa de existir. O build embute `perfil.ini`; os testes de fumaça passam a rodar no build normal, digitando `127.0.0.1`.

**Tech Stack:** C++14 (MSVC v143 e g++), doctest, MFC (MicroSIP 3.22.16), Windows PowerShell 5.1, Python 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (revisão 1.2)

## Global Constraints

- Nenhuma edição nova em `microsip/`: E1–E14 (tabela do plano anterior, `docs/superpowers/plans/2026-10-11-starsonic-phone-windows.md`) continuam as únicas. Se precisar de outra → parar e perguntar ao usuário.
- Literais C++ com acento: escrever o caractere e rodar `python3 build/check_source_text.py --fix` (vira escape `\uXXXX`). `.rc`, `build/*.ps1`, `build/*.h` e `tests/smoke/*.ps1` só em ASCII: textos acentuados da janela são definidos em tempo de execução e, nos `.ps1`, montados com `Get-Text`.
- Textos exatos (spec 7.1 e 11.1):
  - rótulo do campo: `Servidor (endereço ou IP)`;
  - servidor vazio: `Digite o endereço do servidor.`;
  - servidor fora da regra: `Digite só o endereço do servidor, como starcloud1-starsonic.com.br.`;
  - ramal e senha, sem mudança: `Digite só o número do ramal.` e `Digite a senha.`;
  - rede: `Não foi possível falar com o servidor. Confira o endereço e a sua internet.`
- Regra do endereço: apara espaços e tabs das pontas; `A–Z` → `a–z`; até 253 caracteres; partes separadas por `.`, cada uma com 1 a 63 caracteres `a–z`, `0–9` ou `-`, sem `-` na primeira nem na última posição; IPv6 não é aceito.
- Conta: `server = <endereço>:<porta>`, `domain = <endereço>`, `label = <ramal> · <endereço>` (U+00B7 entre espaços).
- `branding/perfil.ini` (valores da Starsonic, 13/10/2026): `[geral]` com `stun=`, `codecs=G722,PCMA,PCMU`, `dtmf=rfc2833`; `[conta]` com `porta=5060`, `transporte=udp`, `proxy=`, `srtp=opcional`, `keepalive=15`.
- A tela Entrar confere os campos na ordem servidor, ramal, senha.
- Commits direto no `main`, em português, com as linhas de atribuição da sessão.

## Review Focus

1. Conta no INI com `server` em formato inesperado (sem porta, `:porta` não numérica, IPv6 entre colchetes, maiúsculas, vazio) → só um endereço válido fica, normalizado e com a porta do perfil; o resto esvazia a conta, sem travar o app. Testes `AddressFromServer drops only a numeric port` e `EnforceAccount empties accounts with an empty or invalid address` (Task 3).
2. Conta gravada pela rc.1 (`starsonicServer=sp1`, `server=sip1.exemplo.invalid:5060`) → continua valendo com o endereço que tem, e a chave antiga é ignorada. `Test-Policy`, conta `[Account4]` (Task 1).
3. Contas → Editar de uma conta existente → o campo Servidor vem com o endereço da conta, sem a porta. `Test-Login`, fase Editar (Task 1).
4. Perfil no formato antigo (`[sp1]` com `nome` e `endereco`) embutido por engano → recusado com mensagem que cita a seção, e o build falha. Teste `rejects the old server-list format` (Task 3).
5. Endereço digitado com espaços nas pontas e maiúsculas → conta gravada sem espaços e em minúsculas. Testes `ValidateServerAddress trims and lowercases` (Task 2) e `Test-Login` com ` 127.0.0.1 ` (Task 1).

---

### Task 1: Testes de fumaça e CI do servidor digitado (vermelho no CI)

**Files:**
- Modify: `tests/smoke/Common.ps1` (`Invoke-MainMenuItem`), `tests/smoke/Test-Login.ps1`, `tests/smoke/Test-Policy.ps1`, `tests/smoke/fake_registrar.py`, `.github/workflows/build.yml`

**Interfaces:**
- Consumes: ids `IDC_SS_SERVER` 41012, `IDC_SS_SERVER_LABEL` 41019 (novo, Task 4), `IDC_SS_RAMAL` 41013, `IDC_SS_SENHA` 41014, `IDC_SS_MESSAGE` 41015, `IDC_SS_ENTRAR` 41016, `IDC_STARSONIC_BAND` 41200, `ID_ACCOUNT_CHANGE_RANGE` 40000, `ID_ACCOUNT_EDIT_RANGE` 40100.
- Produces: `Test-Login.ps1 -AppDir out -Version <versão>`; `Test-Policy.ps1 -AppDir out`.

- [ ] **Step 1: `Invoke-MainMenuItem` com nova tentativa.** O run do commit a700391 (só documentação) falhou no `Test-Settings` com "Itens: " vazio: o menu não apareceu, porque a tela Entrar aberta na inicialização rouba o foco e fecha o menu. Fazer até 3 cliques; cada um espera até `ceil(TimeoutSeconds / 3)` s por um menu com itens; entre um e outro, `CancelMode` e espera o menu sumir.
- [ ] **Step 2: `Test-Login.ps1` no build normal (perfil real).** Parâmetro novo `-Version` (padrão `0.0.0`); registrador sem `--not-tls-port` (`--user 2001,2002 --password senha-certa`). Fases, nesta ordem:
  1. no primeiro acesso, campo Servidor vazio e rótulo `Servidor (endereço ou IP)`;
  2. servidor vazio, ramal `2001`, senha `qualquer` → `Digite o endereço do servidor.`;
  3. servidor `127.0.0.1:5060` → `Digite só o endereço do servidor, como starcloud1-starsonic.com.br.`;
  4. servidor ` 127.0.0.1 `, ramal `2001@x` → `Digite só o número do ramal.`;
  5. ramal `2001`, senha `errada` → `Ramal ou senha incorretos.`;
  6. senha `senha-certa` → a tela fecha. No INI, `[Account1]` com `username=2001`, `server=127.0.0.1:5060`, `domain=127.0.0.1`, `transport=udp` e sem `starsonicServer`. A faixa mostra `2001` e `127.0.0.1`, e o User-Agent é `Starsonic Phone/<Version>`;
  7. Editar (menu, id 40100) → a tela abre com servidor `127.0.0.1` e ramal `2001`; Cancelar fecha a tela;
  8. conta adulterada `[Account2]` (`server=127.0.0.1:5999`, `domain=evil.example`, `transport=tcp`, `username=2002`, a senha gravada da conta 1, `rememberPassword=1`, `label=adulterada`), ativada pelo menu (id 40001) → `accountId=2` no INI e faixa com `Conectado`, `2002` e `127.0.0.1` (registrou pelo perfil: UDP 5060).

  As fases 7 e 8 rodam mesmo se uma delas falhar; as falhas são somadas no fim, como hoje. A fase de TLS sai.
- [ ] **Step 3: `Test-Policy.ps1` no build normal.**
  - INI inicial:
    - `[Settings]`: `accountId=1`, `audioCodecs=G729/8000/1`, `STUN=evil.example`, `enableSTUN=1`;
    - `[Account1]`: `label=adulterada`, `server=EVIL.example:5999`, `domain=other.example`, `username=2001`, `transport=tcp`;
    - `[Account2]`: `server=bad host:5060`, `domain=x`, `username=2002`;
    - sem `[Account3]`;
    - `[Account4]`: `server=sip1.exemplo.invalid:5060`, `domain=sip1.exemplo.invalid`, `username=2004`, `transport=tcp`, `starsonicServer=sp1`.
  - Esperado depois de abrir e fechar:
    - `[Account1]`: `server=evil.example:5060`, `domain=evil.example`, `transport=udp`, `username=2001`, `label=2001 · evil.example`;
    - `[Account2]`: `username` e `server` vazios;
    - `[Account4]`: `server=sip1.exemplo.invalid:5060`, `transport=udp`, `username=2004`;
    - `[Settings]`: `audioCodecs=G722/16000/1 PCMA/8000/1 PCMU/8000/1` (codecs do `perfil.ini`), `enableSTUN=0`, `updatesInterval=daily`.
  - A fase do `/reset` continua igual, com o `audioCodecs` novo.
- [ ] **Step 4: `fake_registrar.py`.** Tirar `--not-tls-port`, `not_tls_listener`, `serve_not_tls` e `NOT_TLS_REPLY`, que ficam sem uso.
- [ ] **Step 5: `build.yml`.**
  - Sai o passo "Compilar a versão de teste (perfil de CI)".
  - "Teste das travas na inicialização" e "Teste da tela Entrar" passam a depender de `steps.app` e a rodar em `out` (`Test-Login.ps1 -AppDir out -Version $env:STARSONIC_VERSION`).
  - O `Build-App` continua com `-ProfilesFile branding\servidores.ini` até a Task 4.
- [ ] **Step 6: Verificar.** `python3 build/check_source_text.py` → `ok: literais em ASCII`; `python3 -m unittest discover -s tests/python` → `OK`.
- [ ] **Step 7: Commit, push e ver o vermelho.** Commit: `test: fumaça do servidor digitado na tela Entrar`. Esperado no CI:
  - `Test-Login` falha na fase 1 (o campo Servidor ainda é o combo, com `Servidor 1`);
  - `Test-Policy` falha nas contas (servidor vazio: a conta não tem `starsonicServer` válido);
  - `Test-StartStop`, `Test-BrandUi`, `Test-Settings` e o teste do instalador passam.

### Task 2: Endereço do servidor e mensagem de rede (núcleo)

**Files:**
- Modify: `starsonic/core/AccountPolicy.h/.cpp`, `starsonic/core/RegistrationErrors.cpp`, `tests/test_account_policy.cpp`, `tests/test_registration_errors.cpp`, `tests/test_login_flow.cpp`

**Interfaces:**
- Produces:
```cpp
enum class ServerCheck { Ok, Empty, Invalid };
// Regra da spec 7.1; *normalized só é escrito quando o resultado é Ok.
ServerCheck ValidateServerAddress(const std::wstring& raw, std::wstring* normalized);
```
  e `RegistrationMessage(408, false)` com o texto de rede novo.

- [ ] **Step 1: Testes (falhando).**
  - `ValidateServerAddress accepts host names and IPv4`: `starcloud1-starsonic.com.br`, `200.100.50.10`, `localhost`, `a` e `x-1.b2` → `Ok`, com o texto normalizado igual à entrada.
  - `ValidateServerAddress trims and lowercases`: `L" Starcloud-Starsonic.COM.br\t"` → `Ok` e `L"starcloud-starsonic.com.br"`.
  - `ValidateServerAddress reports empty input`: `L""`, `L"   "` e `L"\t"` → `Empty`.
  - `ValidateServerAddress rejects ports, users, schemes and other characters`: `host:5060`, `2001@host`, `sip:host`, `http://host`, `host/x`, `star cloud.com`, `star_cloud.com`, `starsônic.com.br`, `[::1]` e `fe80::1` → `Invalid`, com `normalized` intacto (pré-carregado com `L"antes"`).
  - `ValidateServerAddress rejects malformed labels and lengths`:
    - `-host.com`, `host-.com`, `host..com`, `.host.com`, `host.com.` → `Invalid`;
    - uma parte de 64 caracteres ou um total de 254 → `Invalid`;
    - uma parte de 63 e um total de 253 → `Ok`.
  - `kNoServer` em `test_registration_errors.cpp` e o teste de tempo esgotado do `LoginFlow` com o texto novo.
- [ ] **Step 2: Rodar e ver falhar.** `cmake --build build-tests && ./build-tests/starsonic_tests` → falha (não compila sem `ValidateServerAddress`; depois, as mensagens diferem).
- [ ] **Step 3: Implementar.** `ValidateServerAddress` no `AccountPolicy.cpp` (usa `Trim`); texto novo no `RegistrationErrors.cpp`; depois, `check_source_text.py --fix`.
- [ ] **Step 4: Rodar e ver passar.** Núcleo todo verde; `check_source_text.py` ok.
- [ ] **Step 5: Commit.** `feat(core): validação do endereço do servidor`.

### Task 3: Perfil único e contas pelo endereço (núcleo)

**Files:**
- Rename: `starsonic/core/ServerProfiles.h/.cpp` → `starsonic/core/Profile.h/.cpp`; `tests/test_server_profiles.cpp` → `tests/test_profile.cpp`
- Modify: `starsonic/core/AccountPolicy.h/.cpp`, `tests/test_account_policy.cpp`
- Create: `branding/perfil.ini`
- Delete: `branding/servidores.ini`, `tests/fixtures/servidores-ci.ini`

**Interfaces:**
- Consumes: `ValidateServerAddress` (Task 2).
- Produces:
```cpp
struct AccountProfile {
    int port = 0;
    Transport transport = Transport::Udp;
    std::wstring proxy;
    SrtpMode srtp = SrtpMode::Disabled;
    int keepAliveSeconds = 15;
};
struct Profile { GlobalProfile global; AccountProfile account; };
ParseResult ParseProfile(const std::wstring& text, Profile* out);   // em erro, *out fica intacto
// AccountFields perde serverId.
std::wstring AddressFromServer(const std::wstring& server);   // tira ":<1 a 5 dígitos>" do fim
AccountFields BuildAccount(const AccountProfile& profile, const std::wstring& address,
                           const std::wstring& ramal, const std::wstring& senha);
bool EnforceAccount(AccountFields* account, const AccountProfile& profile);   // false = endereço vazio ou inválido
```
  `GlobalProfile`, os enums, `CodecsToMicrosip` e `EnforceGlobal` não mudam.

- [ ] **Step 1: Testes do perfil (falhando).** Em `test_profile.cpp`, com `base = L"[conta]\nporta=5060\ntransporte=udp\n"`:
  - leitura:
    - `parses geral and conta with defaults`;
    - `missing geral uses MicroSIP defaults`;
    - `parses BOM, CRLF and comments`;
    - `parses every optional conta key` (`proxy`, `srtp=Obrigatorio`, `keepalive=30`, `transporte=Tcp`);
    - `srtp opcional and dtmf names map to MicroSIP values`;
    - `codecs are trimmed and normalized`;
    - `empty optional values keep their defaults`;
  - erros:
    - `reports line of unknown key`: `endereco=h` em `[conta]` → linha certa e mensagem que cita `endereco`;
    - `rejects the old server-list format`: o arquivo antigo (`[sp1]` com `nome`, `endereco`, `porta` e `transporte`) → recusado, com mensagem que cita `[sp1]`;
    - `rejects missing required field`: sem `porta`; sem `transporte`;
    - `rejects invalid files`:
      - seções: `[conta]` repetida, `[geral]` repetida, seção desconhecida, `[conta]` ausente (só `[geral]`; texto vazio);
      - `[geral]`: codec desconhecido, lista de codecs vazia, item vazio na lista, dtmf fora das opções, `porta` dentro de `[geral]`;
      - `[conta]`: `porta` 70000, 0 ou `50a`; `transporte=sctp`; `keepalive` 0 ou 3601; `srtp=sim`;
      - formato: linha sem `=`; chave antes de qualquer seção;
    - `failed parse leaves output untouched`;
  - outros:
    - `CodecsToMicrosip maps names in order`;
    - `real branding file is valid` (lê `branding/perfil.ini`).
- [ ] **Step 2: Testes das contas (falhando).** Perfil de teste: `port` 5080, `Tls`, `proxy L""`, `Optional`, `keepAlive` 30.
  - `AddressFromServer drops only a numeric port`: `h:5060` → `h`; `h` → `h`; `h:abc` → `h:abc`; `h:` → `h:`; `[::1]:5060` → `[::1]`; `h:123456` → `h:123456`.
  - `BuildAccount fills locked fields from profile and address`: `server == L"h:5080"`, `domain == L"h"`, `label == L"2001 · h"`, `transport == L"tls"`, `srtp == L"optional"`, `keepAlive` 30, `registerRefresh` 300; os outros campos como hoje.
  - `BuildAccount maps every transport, srtp mode and the proxy` (adaptado).
  - `EnforceAccount restores tampered fields`: conta de `h` adulterada (`server=h:1`, `domain=evil`, `proxy`, `transport`, `srtp`, `publicAddr`, `dialPlan` etc.) → `true` e igual a `BuildAccount(perfil, L"h", ...)`.
  - `EnforceAccount keeps the account address, normalized`: `server = L"Novo.Host:5999"` → `server == L"novo.host:5080"`, `domain == L"novo.host"`, `label == L"2001 · novo.host"`.
  - `EnforceAccount keeps the fields the user owns` (adaptado; `label == L"2002 · h"`).
  - `EnforceAccount empties accounts with an empty or invalid address`: `L""`, `L":5060"`, `L"bad host:5060"`, `L"[::1]:5060"` e `L"h:abc"` → `false`, com `username`, `password`, `server`, `domain` e `proxy` vazios.
- [ ] **Step 3: Rodar e ver falhar.**
- [ ] **Step 4: Implementar.**
  - Renomear os arquivos.
  - O leitor aceita só `[geral]` e `[conta]`, e `[conta]` é obrigatória. Seção desconhecida → `seção desconhecida [x] (use [geral] e [conta])`. `porta` e `transporte` são obrigatórias em `[conta]`, e a mensagem cita a chave e `[conta]`. As outras regras de valor continuam como hoje.
  - Criar `branding/perfil.ini` com os valores das Global Constraints e os comentários do formato da spec 6.3.
  - Apagar `servidores.ini` e a fixture de CI.
- [ ] **Step 5: Rodar e ver passar.** Núcleo todo verde; `check_source_text.py` ok.
- [ ] **Step 6: Commit.** `feat(core): perfil único e contas pelo endereço do servidor`.

### Task 4: Tela Entrar com servidor digitado e build com `perfil.ini` (Windows)

**Files:**
- Rename: `starsonic/win/ProfilesStore.h/.cpp` → `starsonic/win/ProfileStore.h/.cpp`
- Modify: `starsonic/win/LoginDialog.h/.cpp`, `starsonic/win/AccountAdapter.h/.cpp`, `starsonic/win/Hooks.h/.cpp`, `starsonic/win/starsonic.rc`, `starsonic/win/StarsonicIds.h`, `build/Build-App.ps1`, `.github/workflows/build.yml`, `README.md` e `docs/build-notes.md` (comando do build)

**Interfaces:**
- Consumes: Tasks 2 e 3.
- Produces:
  - `const starsonic::Profile& LoadedProfile();`, lendo o recurso `IDR_STARSONIC_PROFILE` (41000). Perfil inválido → `Perfil inválido (linha %d): %s` e o app encerra;
  - `IDC_SS_SERVER_LABEL` 41019;
  - `ToFields(const Account&)`;
  - `Build-App.ps1 -ProfileFile <arquivo>`, que gera `starsonic\generated\perfil.ini` e `STARSONIC_PROFILE_FILE`.

- [ ] **Step 1: Recursos.**
  - `starsonic.rc`: `IDR_STARSONIC_PROFILE RCDATA STARSONIC_PROFILE_FILE`; `LTEXT "Servidor", IDC_SS_SERVER_LABEL, 10, 44, 160, 8`; `EDITTEXT IDC_SS_SERVER, 10, 54, 160, 14, ES_AUTOHSCROLL`.
  - `StarsonicIds.h`: renomear o id do recurso e criar `IDC_SS_SERVER_LABEL`.
- [ ] **Step 2: `ProfileStore`, `AccountAdapter` e `Hooks`.**
  - `LoadedProfile()` no lugar de `LoadedProfiles()`.
  - `ToFields` sem o id; saem `ReadServerId` e `WriteServerId`.
  - `OnSettingsLoaded` e `EnforceActiveAccount` chamam `EnforceAccount(&fields, profile.account)` e `EnforceGlobal(&globals, profile.global)`.
  - Os comentários de `Hooks.h` (E4 e E14) passam a falar do endereço.
- [ ] **Step 3: `LoginDialog`.**
  - `OnInitDialog`: rótulo `Servidor (endereço ou IP)` e nenhuma lista.
  - `Load`: em Editar, servidor = `AddressFromServer(stored.server)`, sem a mensagem "O servidor desta conta mudou". Foco: na senha se `focusPassword`; senão no primeiro campo vazio entre servidor e ramal; senão na senha.
  - `OnClickedEntrar`: confere servidor, ramal e senha, nessa ordem (mensagem e foco no campo com problema); monta a conta com `BuildAccount(LoadedProfile().account, endereço, ramal, senha)`.
  - Saem `targetServerId_` e as chamadas de `WriteServerId` (no commit e no Remover conta).
- [ ] **Step 4: Build.**
  - `Build-App.ps1`: `-ProfileFile`, `perfil.ini`, `STARSONIC_PROFILE_FILE` e mensagem `perfil <arquivo>`.
  - `build.yml`: `-ProfileFile branding\perfil.ini`.
  - README e `docs/build-notes.md`: o mesmo comando.
- [ ] **Step 5: Verificar localmente.** Núcleo, Python e `check_source_text.py` verdes. `git grep -n -i "servidores\|ServerProfile\|ServerId\|starsonicServer" -- starsonic build .github tests` só pode achar a conta antiga do `Test-Policy` (`starsonicServer=sp1`) e a checagem de ausência do `Test-Login`.
- [ ] **Step 6: Commit, push e ver o verde.** Commit: `feat: tela Entrar com o endereço do servidor digitado`. Esperado no CI: os dois jobs verdes, inclusive o `Test-Login` e o `Test-Policy` da Task 1.

### Task 5: Portão de entradas e documentação

**Files:**
- Modify: `build/check_release_inputs.py`, `tests/python/test_check_release_inputs.py`, `README.md`, `docs/teste-manual.md`

- [ ] **Step 1: Teste (falhando).** `test_profile_needs_no_starsonic_input`: sem `branding/servidores.ini` e com um `branding/perfil.ini` qualquer, `missing() == []`. Saem o `test_example_server_address_fails_but_comment_does_not` e o `servidores.ini` do `setUp`.
- [ ] **Step 2: Rodar e ver falhar.** `python3 -m unittest discover -s tests/python` → falha com `branding/servidores.ini: ausente`.
- [ ] **Step 3: Implementar.** Tirar a conferência do `servidores.ini` e a linha dela na docstring.
- [ ] **Step 4: Rodar e ver passar.** Python `OK`.
- [ ] **Step 5: Documentação.**
  - README: introdução (servidor digitado); tabela (`perfil.ini`); portão da versão estável sem "servidores de exemplo".
  - `docs/teste-manual.md`:
    - abertura: um ramal em cada servidor da Starsonic, `starcloud-starsonic.com.br` e `starcloud1-starsonic.com.br`;
    - seção 2: campo Servidor; servidor vazio e com porta; endereço do outro servidor; mensagem de rede nova; faixa `<ramal> · <endereço>`;
    - 4.1: entrar digitando o endereço do outro servidor;
    - 4.4: porta e transporte voltam ao perfil; um endereço trocado no arquivo passa a valer; um endereço inválido abre a tela Entrar;
    - tabela de critérios.
- [ ] **Step 6: Commit e push.** Commit: `docs: servidor digitado no roteiro manual e no README`. Esperado: CI verde.
