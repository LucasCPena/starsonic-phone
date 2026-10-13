# Protocolo e nome em cada conta — Plano de implementação (revisão 1.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Entrar ganha o campo Protocolo (UDP ou TCP) e o Nome da conta opcional; as travas guardam o protocolo e o nome de cada conta, e o TLS sai do perfil.

**Architecture:** As regras ficam no núcleo (`starsonic/core`): o perfil só aceita `udp` e `tcp`; `AccountPolicy` ganha a normalização do nome, a leitura do nome a partir do rótulo e a leitura do protocolo a partir do campo de transporte, e `BuildAccount` passa a receber o protocolo e o nome. A tela Entrar (`starsonic/win`) só mostra os campos e chama o núcleo. O registrador SIP falso dos testes passa a falar TCP, para o teste de fumaça fazer um login por TCP.

**Tech Stack:** C++14 (MSVC v143 e g++), doctest, MFC (MicroSIP 3.22.16), Windows PowerShell 5.1, Python 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (revisão 1.4: bloco no topo e seções 3, 4, 6.3, 6.4, 7.1, 7.2, 8.1, 8.2, 11.2, 11.3 e 13)

## Global Constraints

- Nenhuma edição nova em `microsip/`: E1–E14 continuam as únicas. Se precisar de outra → parar e perguntar ao usuário.
- Literais C++ com acento: escrever o caractere e rodar `python3 build/check_source_text.py --fix`. `.rc`, `branding/branding.h` e `tests/smoke/*.ps1` só em ASCII (nos `.ps1`, textos acentuados com `Get-Text`).
- Protocolos: só `udp` e `tcp`. Padrão = `transporte` do `perfil.ini` (hoje `udp`). A `porta` do perfil (5060) vale para os dois.
- Nome da conta: opcional; espaços e tabs das pontas saem; até 40 caracteres (`kMaxAccountNameLength = 40`); sem mensagem de erro. Vai só no rótulo (menu de contas e faixa); o nome de exibição SIP continua sendo o ramal.
- Rótulo sem nome: `<ramal> · <endereço>` (U+00B7 entre espaços). Um rótulo `<X> · <Y>` com X ramal válido e Y endereço válido conta como sem nome.
- Textos da tela: `Protocolo`, `UDP`, `TCP`, `Nome da conta (opcional)`.
- Commits direto no `main`, em português, com as linhas de atribuição da sessão.

## Review Focus

1. Nome com acento ou emoji perto do limite de 40 → corta sem partir o caractere (par substituto do UTF-16). Teste `NormalizeAccountName never splits a surrogate pair` (Task 1).
2. Conta gravada antes da 1.4 (rótulo `2001 · h`, `transport=udp`) → depois da atualização continua igual, sem nome inventado nem protocolo trocado. Teste `EnforceAccount keeps accounts saved before revision 1.4` (Task 1).
3. Nome só com espaços → conta sem nome, com o rótulo automático. Teste `NormalizeAccountName trims and keeps up to 40 characters` (Task 1).
4. Editar uma conta com nome e TCP → a tela vem com o nome e o TCP, e Entrar sem mexer mantém os dois. `Test-Login`, fase 9 (Task 3).
5. Trocar de UDP para TCP uma conta já conectada → registra de novo, por TCP. `Test-Login`, fase 9 (Task 3).

---

### Task 1: Núcleo — protocolo e nome da conta

**Files:**
- Modify: `starsonic/core/Profile.h`, `starsonic/core/Profile.cpp` (leitura de `transporte`, linhas ~205–212)
- Modify: `starsonic/core/AccountPolicy.h`, `starsonic/core/AccountPolicy.cpp`
- Modify: `starsonic/win/LoginDialog.cpp` (só a chamada de `BuildAccount`, para o build continuar)
- Modify: `branding/perfil.ini` (comentário do `transporte`)
- Test: `tests/test_profile.cpp`, `tests/test_account_policy.cpp`, `tests/smoke/Test-Policy.ps1`, `tests/smoke/Test-Login.ps1` (fase 8)

**Interfaces:**
- Produces:
  - `enum class Transport { Udp, Tcp };` (sai `Tls`)
  - `const size_t kMaxAccountNameLength = 40;`
  - `std::wstring NormalizeAccountName(const std::wstring& raw);` — apara espaços e tabs das pontas e guarda até 40 unidades; se a 40ª for o começo de um par substituto (0xD800–0xDBFF), corta antes dela.
  - `std::wstring AccountNameFromLabel(const std::wstring& label);` — `""` quando o rótulo aparado é vazio ou tem a forma `<X> · <Y>` (separado no primeiro `" · "`) com `ValidateRamal(X) == Ok` e `ValidateServerAddress(Y) == Ok`; senão, `NormalizeAccountName(label)`.
  - `Transport TransportFromName(const std::wstring& name, Transport fallback);` — `udp`/`tcp` sem diferenciar maiúsculas, depois de aparar; qualquer outro valor → `fallback`.
  - `AccountFields BuildAccount(const AccountProfile& profile, const std::wstring& address, const std::wstring& ramal, const std::wstring& senha, Transport transport, const std::wstring& accountName);` — `transport` = `"udp"`/`"tcp"`; `label` = `NormalizeAccountName(accountName)` ou, se vazio, `<ramal> · <endereço>`; o resto como hoje.
  - `EnforceAccount` (mesma assinatura): protocolo = `TransportFromName(account->transport, profile.transport)`, nome = `AccountNameFromLabel(account->label)`; continua mantendo `authId` e `displayName`.

- [ ] **Step 1: Testes do núcleo que falham**

`tests/test_profile.cpp`:
- `parses BOM, CRLF and comments`: `transporte=TLS` vira `transporte=TCP`; `CHECK(profile.account.transport == Transport::Tcp);`
- `rejects invalid files`: `CHECK(Rejects(L"[conta]\nporta=5061\ntransporte=tls\n"));`

`tests/test_account_policy.cpp`:
- `TestProfile()` usa `Transport::Tcp`; os `CHECK` que esperavam `L"tls"` passam a esperar `L"tcp"`; as chamadas de `BuildAccount` ganham `, Transport::Tcp, L""` (as de `maps every transport` usam `profile.transport`).
- `EnforceAccount restores tampered fields`: tira a linha `account.label = L"outro";` (o rótulo agora é da pessoa) e troca `account.transport = L"udp";` por `account.transport = L"tls";` — o esperado continua `CheckSameAccount(account, expected)`.
- Casos novos:

```cpp
TEST_CASE("NormalizeAccountName trims and keeps up to 40 characters") {
    CHECK(NormalizeAccountName(L"  PA 3 - Recepção\t") == L"PA 3 - Recepção");
    CHECK(NormalizeAccountName(L"   ") == L"");
    CHECK(NormalizeAccountName(std::wstring(45, L'a')) == std::wstring(40, L'a'));
}
TEST_CASE("NormalizeAccountName never splits a surrogate pair") {
    const std::wstring name = std::wstring(39, L'a') + std::wstring{wchar_t(0xD83D), wchar_t(0xDE00)};
    CHECK(NormalizeAccountName(name) == std::wstring(39, L'a'));
}
TEST_CASE("AccountNameFromLabel treats <ramal> · <endereco> as no name") {
    CHECK(AccountNameFromLabel(L"") == L"");
    CHECK(AccountNameFromLabel(L"2001 · h") == L"");
    CHECK(AccountNameFromLabel(L"2002 · novo.host") == L"");
    CHECK(AccountNameFromLabel(L"PA 3 - Recepção") == L"PA 3 - Recepção");
    CHECK(AccountNameFromLabel(L"PA 3 · sala 2") == L"PA 3 · sala 2");
    CHECK(AccountNameFromLabel(L"  Vendas  ") == L"Vendas");
}
TEST_CASE("TransportFromName accepts only udp and tcp") {
    CHECK(TransportFromName(L"udp", Transport::Tcp) == Transport::Udp);
    CHECK(TransportFromName(L" TCP ", Transport::Udp) == Transport::Tcp);
    CHECK(TransportFromName(L"tls", Transport::Udp) == Transport::Udp);
    CHECK(TransportFromName(L"", Transport::Tcp) == Transport::Tcp);
}
TEST_CASE("BuildAccount uses the chosen protocol and the account name") {
    const AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L" PA 3 ");
    CHECK(account.transport == L"udp");
    CHECK(account.label == L"PA 3");
    CHECK(account.displayName == L"2001");
}
TEST_CASE("EnforceAccount keeps the protocol and the name of each account") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L"PA 3 - Recepção");
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.transport == L"udp");
    CHECK(account.label == L"PA 3 - Recepção");
}
TEST_CASE("EnforceAccount resets unknown protocols to the profile default") {
    const std::wstring transports[] = {L"tls", L"sctp", L""};
    for (const std::wstring& transport : transports) {
        CAPTURE(transport);
        AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L"");
        account.transport = transport;
        CHECK(EnforceAccount(&account, TestProfile()));
        CHECK(account.transport == L"tcp");
    }
}
TEST_CASE("EnforceAccount cuts long names") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    account.label = std::wstring(50, L'n');
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.label == std::wstring(40, L'n'));
}
TEST_CASE("EnforceAccount keeps accounts saved before revision 1.4") {
    AccountProfile profile = TestProfile();
    profile.transport = Transport::Udp;
    AccountFields account = BuildAccount(profile, L"h", L"2001", L"x", Transport::Udp, L"");
    const AccountFields expected = account;
    CHECK(EnforceAccount(&account, profile));
    CheckSameAccount(account, expected);
    CHECK(account.label == L"2001 · h");
}
```

`EnforceAccount keeps the account address, normalized` e `keeps the fields the user owns` não mudam: o rótulo automático é refeito com o endereço e o ramal atuais.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cmake -S tests -B /tmp/b && cmake --build /tmp/b -j 4 2>&1 | tail -5`
Expected: erro de compilação (`NormalizeAccountName`, `AccountNameFromLabel`, `TransportFromName` e a nova assinatura de `BuildAccount` não existem; `Transport::Tls` ainda existe, mas os testes não o usam mais).

- [ ] **Step 3: Testes de fumaça das travas com as regras novas (no mesmo commit do Step 1)**

- `tests/smoke/Test-Policy.ps1`: `[Account1]` passa a ter `label=2001 · old.example` (montado com `Get-Text @('2001 ', 0x00B7, ' old.example')`) e `transport=tls`; `[Account4]` passa a ter `label=PA 4 - Vendas`. Esperado: `Account1 transport = udp`, `Account1 label = 2001 · evil.example`, `Account4 transport = tcp`, `Account4 label = PA 4 - Vendas`; o comentário do bloco diz que UDP e TCP ficam e outro protocolo volta ao padrão.
- `tests/smoke/Test-Login.ps1`, fase 8: a conta adulterada passa a ter `transport=tls` e `label=2002 · evil.example` (com `Get-Text`), e o comentário diz que o protocolo inválido volta a UDP; o resto da fase não muda.

- [ ] **Step 4: Implementar**

- `Profile.h`/`.cpp`: `Transport { Udp, Tcp }`; `transporte=tls` (ou outro) → `InvalidValue(key, value, L"udp ou tcp")`.
- `AccountPolicy.h`/`.cpp`: as funções e a constante de **Interfaces**; `TransportName` só com UDP e TCP; comentários de `BuildAccount` e `EnforceAccount` atualizados (rótulo = nome ou `<ramal> · <endereço>`; protocolo e nome são da pessoa).
- `LoginDialog.cpp`: `BuildAccount(LoadedProfile().account, address, ramal, Wide(senha), LoadedProfile().account.transport, L"")` (os campos novos chegam na Task 3).
- `branding/perfil.ini`: `transporte=udp            ; udp | tcp (padrão do campo Protocolo da tela Entrar)`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cmake --build /tmp/b -j 4 && ctest --test-dir /tmp/b --output-on-failure | tail -3 && python3 build/check_source_text.py`
Expected: `100% tests passed` e `ok: literais em ASCII`.

- [ ] **Step 6: Commit e CI**

```bash
git add starsonic/core starsonic/win/LoginDialog.cpp branding/perfil.ini tests/test_profile.cpp tests/test_account_policy.cpp tests/smoke/Test-Policy.ps1 tests/smoke/Test-Login.ps1
git commit -m "feat(core): protocolo e nome em cada conta; perfil sem TLS"
git push origin HEAD:main
```
Expected: `build.yml` verde nesse commit (os dois jobs).

---

### Task 2: Registrador SIP falso também em TCP

**Files:**
- Modify: `tests/smoke/fake_registrar.py`
- Test: `tests/python/test_fake_registrar.py`

**Interfaces:**
- Consumes: nada das outras tasks.
- Produces (usado pela Task 3):
  - `split_messages(buffer: bytes) -> tuple[list[bytes], bytes]` — separa as mensagens SIP completas de um fluxo TCP pelo `Content-Length` (ou `l:`), descartando `\r\n` soltos entre mensagens (pings de keepalive); devolve as completas e o resto.
  - `Registrar.handle(data, source, transport="udp")` — igual a hoje; quando responde 200 a um REGISTER e há `transport_log_path`, grava `udp` ou `tcp` nele.
  - Linha de comando: `fake_registrar.py ... [--transport-log ARQUIVO]`; escuta UDP e TCP no mesmo `--host`/`--port`, cada conexão TCP numa thread, a resposta volta na mesma conexão.

- [ ] **Step 1: Testes que falham**

Em `tests/python/test_fake_registrar.py`:
- `test_split_messages_keeps_partial_tail`: duas mensagens `register()` coladas + metade de uma terceira → devolve as duas inteiras e a metade como resto.
- `test_split_messages_skips_keepalive_pings`: `b"\r\n\r\n" + register()` → uma mensagem e resto `b""`.
- `test_split_messages_uses_compact_content_length`: mensagem com `l: 4` e corpo `abcd` → a mensagem inteira, com o corpo.
- `test_transport_log_records_tcp_registration`: `Registrar(..., transport_log_path=arquivo)` com o REGISTER autenticado via `handle(..., transport="tcp")` → 200 e o arquivo contém `tcp`.
- `test_tcp_server_answers_register_on_the_same_connection`: sobe o servidor do registrador numa porta livre (`127.0.0.1`, porta 0 escolhida pelo sistema), conecta por TCP, manda `register()` e recebe `SIP/2.0 401` na mesma conexão.

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest tests.python.test_fake_registrar 2>&1 | tail -3`
Expected: `FAILED` (`split_messages` e `--transport-log` não existem).

- [ ] **Step 3: Implementar** `split_messages`, o `transport` em `handle`, `--transport-log` e o servidor TCP (função que a linha de comando e o teste usam para subir UDP e TCP; `socketserver.ThreadingTCPServer` ou threads simples). O docstring do arquivo passa a dizer "UDP e TCP".

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest discover -s tests/python 2>&1 | tail -3`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/fake_registrar.py tests/python/test_fake_registrar.py
git commit -m "test: registrador SIP falso também em TCP"
git push origin HEAD:main
```

---

### Task 3: Tela Entrar com Protocolo e Nome da conta (Windows)

**Files:**
- Modify: `starsonic/win/StarsonicIds.h`, `starsonic/win/starsonic.rc`, `starsonic/win/LoginDialog.cpp`
- Test: `tests/smoke/Test-Login.ps1`

**Interfaces:**
- Consumes: `Transport`, `kMaxAccountNameLength`, `NormalizeAccountName`, `AccountNameFromLabel`, `TransportFromName`, `BuildAccount(..., Transport, name)` (Task 1); `--transport-log` (Task 2).
- Produces: ids `IDC_SS_PROTOCOL_LABEL 41030`, `IDC_SS_PROTOCOL 41031`, `IDC_SS_NAME_LABEL 41032`, `IDC_SS_NAME 41033`. Lista do protocolo: índice 0 = `UDP`, 1 = `TCP`.

- [ ] **Step 1: Teste de fumaça que falha**

`tests/smoke/Test-Login.ps1`:
- O registrador sobe com `--transport-log "<cópia>\transport.txt"`.
- Fase 1 (primeiro acesso): `[StarsonicWin32]::ControlText` do `IDC_SS_PROTOCOL` = `UDP` e do `IDC_SS_NAME` = `''`.
- Fase 7 (Editar a conta 1, sem nome): protocolo `UDP` e nome `''`.
- Fase 9 nova, depois da 8 (soma em `$problems`): Editar a conta ativa (2); `SelectComboItem` índice 1; nome `PA 2 - Recepção` (`Get-Text @('PA 2 - Recep', 0x00E7, 0x00E3, 'o')`); senha `senha-certa`; Entrar. Esperado em até 25 s: a tela fecha; `[Account2] transport = tcp` e `label = PA 2 - Recepção`; a faixa contém `Conectado` e `PA 2 - Recep`; `transport.txt` = `tcp`. Depois, Editar de novo: protocolo `TCP` e nome `PA 2 - Recepção`; Cancelar.
- Mensagem final do `Write-Host` cita o TCP e o nome.

- [ ] **Step 2: Ver falhar no CI**

Commit `test: login por TCP e nome da conta na tela Entrar (vermelho)` e push. Expected: `Teste da tela Entrar` vermelho no `build.yml` (o `IDC_SS_PROTOCOL` não existe).

- [ ] **Step 3: Implementar**

- `StarsonicIds.h`: os quatro ids, no bloco da tela Entrar.
- `starsonic.rc`, `IDD_STARSONIC_LOGIN DIALOGEX 0, 0, 180, 244` (só ASCII; os rótulos acentuados vêm do código):

```
CONTROL         "", IDC_SS_LOGO, "Static", SS_OWNERDRAW, 10, 8, 160, 40
LTEXT           "Servidor", IDC_SS_SERVER_LABEL, 10, 56, 112, 8
EDITTEXT        IDC_SS_SERVER, 10, 66, 112, 14, ES_AUTOHSCROLL
LTEXT           "Protocolo", IDC_SS_PROTOCOL_LABEL, 126, 56, 44, 8
COMBOBOX        IDC_SS_PROTOCOL, 126, 66, 44, 40, CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP
LTEXT           "Ramal", IDC_STATIC, 10, 86, 160, 8
EDITTEXT        IDC_SS_RAMAL, 10, 96, 160, 14, ES_AUTOHSCROLL
LTEXT           "Senha", IDC_STATIC, 10, 116, 160, 8
EDITTEXT        IDC_SS_SENHA, 10, 126, 160, 14, ES_PASSWORD | ES_AUTOHSCROLL
LTEXT           "Nome da conta (opcional)", IDC_SS_NAME_LABEL, 10, 146, 160, 8
EDITTEXT        IDC_SS_NAME, 10, 156, 160, 14, ES_AUTOHSCROLL
LTEXT           "", IDC_SS_MESSAGE, 10, 174, 160, 16
DEFPUSHBUTTON   "Entrar", IDC_SS_ENTRAR, 10, 194, 160, 16
CONTROL         "<a>Remover conta</a>", IDC_SS_REMOVE, "SysLink", WS_TABSTOP, 10, 214, 160, 10
CTEXT           "Precisa de ajuda?", IDC_SS_HELP, 10, 228, 160, 10
```

- `LoginDialog.cpp`:
  - `OnInitDialog`: lista `UDP`, `TCP`; `EM_LIMITTEXT` de `kMaxAccountNameLength` no `IDC_SS_NAME`.
  - `Load`: em Editar, protocolo = `TransportFromName(Wide(stored.transport), LoadedProfile().account.transport)` e nome = `AccountNameFromLabel(Wide(stored.label))`; em conta nova, o protocolo do perfil e nome vazio.
  - `OnClickedEntrar`: depois das conferências de hoje (servidor, ramal, senha), `BuildAccount(LoadedProfile().account, address, ramal, Wide(senha), <protocolo da lista>, Wide(<nome>))`.
  - `SetFieldsEnabled`: também o `IDC_SS_PROTOCOL` e o `IDC_SS_NAME`.

- [ ] **Step 4: Ver passar**

Run local: `python3 build/check_source_text.py && python3 build/check_branding.py --repo .` → `ok`. Commit `feat: Protocolo e Nome da conta na tela Entrar`, push. Expected: `build.yml` verde (inclusive `Teste da faixa e da tela Sobre`, que mede o logo e a linha de ajuda da tela Entrar, e `Teste da tela Entrar`).

---

### Task 4: Documentação, revisão final e versão de teste

**Files:**
- Modify: `README.md` (linhas 15 e 43), `docs/teste-manual.md`, `docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md` (status)

- [ ] **Step 1: Documentação**

- `README.md`: linha 15 — "perfil das contas (`perfil.ini`: porta, protocolo padrão, SRTP, codecs e DTMF)"; linha 43 — os testes conferem o perfil (porta 5060, UDP como padrão e codecs) contra um registrador falso que fala UDP e TCP; ao mudar a porta, o protocolo padrão ou os codecs, ajustar `Test-Login.ps1` e `Test-Policy.ps1`.
- `docs/teste-manual.md`:
  - 2.1: a tela tem o Protocolo (UDP marcado) ao lado do Servidor e o "Nome da conta (opcional)".
  - 2.9 nova: num cliente que usa TCP, escolha TCP e entre → "Conectado"; em Editar, o protocolo aparece como TCP.
  - 4.4: troque o `transport` da primeira conta para `tls` (em vez de `tcp`) → volta a UDP.
  - 4.6 nova: dê nome a duas contas (ex.: `PA 1 - Recepção` e `PA 2 - Vendas`) → os nomes aparecem no menu de contas e na faixa; quem recebe a ligação continua vendo o ramal.
  - Linha dos critérios: "travadas (menos o endereço do servidor, o protocolo e o nome da conta)".
- Spec: `- **Status:** aprovada — revisão 1.4 em 13/10/2026 (as revisões 1.3, 1.2 e 1.1 também foram aprovadas, em 13/10, 13/10 e 11/10/2026)`.

Commit `docs: protocolo e nome da conta no README e no roteiro manual` e push; `build.yml` verde.

- [ ] **Step 2: Revisão final** do diff da revisão 1.4 inteira (do commit da spec até o último), contra a spec; corrigir o que for encontrado, com o CI verde no fim.

- [ ] **Step 3: Versão de teste**

Run: `gh api -X POST repos/LucasCPena/starsonic-phone/actions/workflows/release.yml/dispatches -f ref=main -f 'inputs[versao]=0.0.1-rc.5'`
Expected: release `v0.0.1-rc.5` com o instalador, o `versao.json` e o código-fonte completo; o `canal-teste` com o instalador e o `versao.json` da rc.5.
