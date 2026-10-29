# iPhone, etapa 1: o motor de ligações com o baresip — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uma segunda implementação do `SipEngine` (o contrato de `starsonic/phone/SipEngine.h`), sobre o baresip e a libre, que passa no Linux nos mesmos testes do motor do PJSIP e nos testes novos do push, para depois ir para o iPhone.

**Architecture:**
- O motor novo mora em `starsonic/phone/baresip/`. O Android e o Windows só compilam `starsonic/phone/*.cpp`, então não o enxergam.
- Uma thread do motor roda o laço da libre (`re_main`). As outras threads só usam o baresip e a libre dentro de `BaresipLoop::Run` (`re_thread_enter` e `re_thread_leave`), e nunca esperam a rede lá dentro.
- Os avisos ao listener saem pela `EventQueue` que o motor do PJSIP já usa (`EngineEvents.h`).
- **O registro** é um cliente de REGISTER do próprio motor, sobre a pilha SIP da libre (`sip_dialog_alloc`, `sip_auth_alloc`, `sip_drequestf` e `sip_send`).
  - O `sipreg` da libre não serve: ele não deixa saber se há um REGISTER a caminho, não para as novas tentativas sem tirar o registro do servidor, e manda a saída sozinho quando é destruído. O contrato pede o contrário nos três casos.
  - O `re/src/sipreg/reg.c` da libre serve de referência para o Contact, a autenticação e a leitura do tempo concedido.
  - O registro do baresip fica desligado (`regint=0`), e a conta do baresip serve só às ligações.
- **Os testes do contrato** são os mesmos arquivos para os dois motores, separados por assunto. Cada tarefa põe no executável do baresip o arquivo do assunto dela.

**Tech Stack:**
- C++17 (doctest);
- libre e baresip 4.12.0 e libg722 1.2.8 (BSD), compilados estáticos;
- OpenSSL e Opus do sistema (no Linux);
- Python 3 (o registrador falso);
- CMake;
- GitHub Actions (ubuntu-24.04, o job `core-tests` do workflow `build`).

**Spec:** `docs/superpowers/specs/2026-10-29-starsonic-phone-iphone-design.md` (seções 6.1, 6.2, 7.3, 9.3, 11.2 e 14, etapa 1)

## Global Constraints

- **Escopo:** só a etapa 1 da spec. Nada de Swift, Xcode, build do iPhone, workflow `ios`, `RegistrationPort` ou modo iPhone no núcleo (`starsonic/desktop`); isso é das etapas 2 e 3.
- **Contrato do motor:** o do `SipEngine.h`, com o método novo `SetPushData` (Task 1). O motor com o baresip se comporta como o do PJSIP em tudo o que os testes do contrato conferem: os eventos, a ordem e os códigos.
- **Windows e Android não mudam de comportamento.** No motor do PJSIP, o `SetPushData` só confere os dados, sem mandar nada. Depois da separação dos arquivos (Task 1), o `phone_tests` do PJSIP passa com o mesmo número de casos de teste de antes.
- **Versões fixas, com o commit no `build/deps.lock`** (spec 6.1):
  - libre `v4.12.0`, commit `65555dad439de9d6a81b3ee6092b9c096585249b` (`https://github.com/baresip/re`);
  - baresip `v4.12.0`, commit `9cfab81550acc4bd38d6580d79b45cc6eea65cd6` (`https://github.com/baresip/baresip`);
  - libg722 `v1.2.8`, commit `4c2e79c5cbcb5ee12a97a16002a073ac83396480` (`https://github.com/sippy/libg722`).

  A seção nova muda as chaves dos caches de dependências do Windows e do Android, que leem o `deps.lock` inteiro: o primeiro CI depois do commit refaz essas dependências uma vez (uns 13 minutos no Windows). É esperado; não mexa nas chaves.
- **Módulos do baresip,** nesta ordem e só eles: `g711`, `libg722`, `opus`, `srtp`, `stun` e `mixminus`. O módulo `g722` (usa a spandsp, sob LGPL) nunca entra. Nenhum código de terceiros sob GPL ou LGPL entra no motor do baresip: nem o PJSIP, nem o bcg729, nem a spandsp.
- **Arquivos do motor novo:** só em `starsonic/phone/baresip/`. O que for puro e servir aos dois motores fica em `starsonic/phone/` (o `PushDataCheck`).
- **Texto do código:**
  - C++17 sem avisos com `-Wall -Wextra`;
  - os literais em ASCII (o `build/check_source_text.py` confere no CI), e as linhas de log em português sem acento, como as do motor do PJSIP;
  - comentários em português.
- **O log nunca leva a senha** (`AccountInput::senha`).
- **Commits:** vão para o `main`, sem forçar push e sem ramo remoto novo, em português, com as duas linhas do fim: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- **O repositório é público.** Nenhum nome do fornecedor da plataforma do PABX, nenhum segredo, nenhum token de verdade nos testes.
- **Pacotes do sistema:** `libssl-dev`, `libopus-dev`, `zlib1g-dev`, `uuid-dev` (o PJSIP), `cmake` e `python3`. Nesta máquina falta o `libopus-dev` (`apt-get install -y libopus-dev`).
- **Comandos de teste** (`$S` = `/tmp/claude-0/-home-claude/62d54bdc-24b1-5e22-a5c0-39fd7d73e742/scratchpad`):
  - **PJSIP:**
    - uma vez, `bash build/linux/build-pjproject.sh $S/pjproject-linux $S/pj-linux`;
    - depois, `cmake -S tests/phone -B $S/build-phone -DPJPROJECT_PREFIX=$S/pj-linux && cmake --build $S/build-phone -j 4 && ctest --test-dir $S/build-phone --output-on-failure`.
  - **baresip:**
    - uma vez por versão do `deps.lock`, `bash build/baresip/build-linux.sh $S/baresip-src $S/baresip-linux`;
    - depois, `cmake -S tests/phone -B $S/build-phone-baresip -DBARESIP_PREFIX=$S/baresip-linux && cmake --build $S/build-phone-baresip -j 4 && ctest --test-dir $S/build-phone-baresip --output-on-failure`.
  - **O registrador falso:** `python3 -m unittest tests/smoke/test_fake_registrar.py`.
  - **Os literais:** `python3 build/check_source_text.py`.

## Review Focus

1. **Dados de push que quebrariam o REGISTER** (um `;`, `>`, `<`, `"`, espaço, CR ou LF num valor, ou um cabeçalho reservado como `Contact`): o `SetPushData` recusa (devolve false) e os dados de antes continuam valendo. O teste fica na Task 1 e vale para os dois motores.
2. **O motor destruído com um REGISTER a caminho e sem resposta do servidor:** o destrutor volta em até ~5 s e nenhum evento chega depois. O teste fica na Task 3.
3. **Duas ligações e um microfone só (o iPhone):** só a ligação ativa tem o áudio aberto, e as duas o têm na conferência. Os testes ficam na Task 5 e na Task 7, por `SipEngineTestAccess`.
4. **O motor criado e destruído várias vezes no mesmo processo** (o estado global da libre e do baresip): cada vez sobe, registra e sai do servidor. O teste fica na Task 3.
5. **Os dados de push com a rede fora e com o iPhone trocando de rede:** trocados sem rede, ficam guardados, nenhum REGISTER sai, e o primeiro REGISTER depois que a rede volta já os leva. O `Reregister` e o `HandleIpChange` também os levam. Os testes ficam na Task 3.

---

### Task 1: Os testes para dois motores, o registrador falso e o `SetPushData`

**Files:**
- Create:
  - `starsonic/phone/PushDataCheck.h`, `starsonic/phone/PushDataCheck.cpp`;
  - `tests/phone/call_fixture.h`;
  - `tests/phone/test_engine_setup.cpp`, `test_engine_hold.cpp`, `test_engine_transfer.cpp`, `test_engine_conference.cpp`, `test_engine_network.cpp`, `test_engine_pjsip.cpp` e `test_push_data.cpp`.
- Modify:
  - `starsonic/phone/SipEngine.h` (o `PushData` e o `SetPushData`) e `starsonic/phone/SipEngine.cpp` (o `SetPushData` do PJSIP);
  - `tests/phone/engine_fixture.h` (os auxiliares que hoje estão no `test_engine_blf.cpp`);
  - `tests/phone/test_engine_register.cpp`, `test_engine_calls.cpp` e `test_engine_blf.cpp` (saem os testes que mudam de arquivo);
  - `tests/smoke/fake_registrar.py` e `tests/smoke/test_fake_registrar.py`.

**Interfaces:**
- Produces:
  - Em `SipEngine.h`:
    ```cpp
    struct PushData {
        std::vector<std::pair<std::string, std::string>> contactParams;   // vão na URI do Contact: ;nome=valor
        std::vector<std::pair<std::string, std::string>> headers;         // Nome: valor
    };
    // na classe SipEngine:
    bool SetPushData(const std::optional<PushData>& data);
    ```
    O comentário do contrato, no estilo dos vizinhos, diz:
    - são os dados de push que vão em cada REGISTER, ou nenhum (`nullopt`), nos dois formatos da spec 7.3 (parâmetros no Contact, como na RFC 8599, ou cabeçalhos próprios);
    - com uma conta registrada e a rede disponível, o motor registra de novo na hora (o resultado chega por `OnRegistration`), sem mexer nas ligações;
    - sem conta ou sem rede, só guarda os dados para o próximo REGISTER;
    - false: `PushDataProblem` achou um problema, e nada muda;
    - no motor do PJSIP (Windows e Android), só confere: não guarda nem manda nada.
  - Em `PushDataCheck.h`: `std::string PushDataProblem(const PushData& data);`. Devolve vazio quando os dados servem; senão, o motivo em português sem acento, para o log.
  - Em `call_fixture.h` (`namespace phone_test`), movidos sem mudança do `test_engine_calls.cpp`: `Lines`, `Last`, `History`, `Transfers`, `Sorted` e `struct Phone`. As funções livres viram `inline`.
  - Em `engine_fixture.h`, movidos do `test_engine_blf.cpp` para `namespace phone_test`, como `inline`: `LogCount(const FakeRegistrar&, const std::string&)`, `Registers`, `WaitUntil`, `CountActive`, `RegistrationsText` e `kOk`.
  - Comandos novos na porta de controle do registrador falso:
    - `CONTACT <ramal>`: o cabeçalho Contact inteiro do último REGISTER aceito com Expires > 0, como chegou, ou `ERR no-contact`;
    - `HEADER <ramal> <nome>`: o último valor do cabeçalho `<nome>` (sem diferença de maiúsculas) nesse mesmo REGISTER, ou `ERR no-header`; `ERR no-contact` sem REGISTER;
    - `KEEPALIVES`: quantos keep-alives chegaram desde que o registrador subiu. Conta um datagrama UDP só com CR e LF, e cada `\r\n\r\n` entre mensagens no TCP.

**As regras do `PushDataProblem`:**
- **Nome de parâmetro e de cabeçalho:**
  - de 1 a 64 caracteres;
  - só letras ASCII, dígitos e `` -.!%*_+`'~ ``.
- **Nome de parâmetro recusado:** `transport` (sem diferença de maiúsculas), porque o motor já o escreve no TCP.
- **Valor de parâmetro:**
  - até 512 caracteres, e pode ser vazio (aí vai `;nome`, sem `=`);
  - só letras ASCII, dígitos e `-_.!~*'()[]/:&+$`, e `%` só seguido de dois dígitos hexadecimais.
- **Valor de cabeçalho:**
  - de 1 a 512 caracteres;
  - sem caractere de controle (nem CR, nem LF), só ASCII visível e espaço.
- **Nomes de cabeçalho recusados** (sem diferença de maiúsculas), porque o motor ou a libre já os escrevem: `Via`, `From`, `To`, `Call-ID`, `CSeq`, `Contact`, `Expires`, `Max-Forwards`, `Route`, `Authorization`, `User-Agent` e `Content-Length`.

- [ ] **Step 1: Separe os testes, sem mudar nenhum deles** (o nome e o corpo ficam iguais; só muda o arquivo):
  - **Para `test_engine_setup.cpp`**, vindos de `test_engine_register.cpp`:
    - "SipEngine uses the profile codecs in order";
    - "SipEngine skips the profile codecs that the build lacks";
    - "SipEngine uses no STUN when the profile leaves stun empty";
    - "SipEngine allows one instance per process";
    - "SipEngine needs a listener".
  - **Para `test_engine_pjsip.cpp`** (só o PJSIP):
    - "SipEngine uses the STUN server of the profile" e "SipEngine sends the start-up lines of the PJSIP to OnLog", de `test_engine_register.cpp`;
    - "SetMute silences the microphone", de `test_engine_calls.cpp`, junto com o `#include <pjsua-lib/pjsua.h>`, que sai do `test_engine_calls.cpp`.
  - **Para `test_engine_hold.cpp`:**
    - "a second incoming call rings while one is active";
    - "a third call gets busy";
    - "Activate switches the active call";
    - "MakeCall during a confirmed call holds it";
    - "hanging up the active call leaves the other on hold";
    - "SetHold right after another SetHold waits for the first re-INVITE";
    - "destroying the engine with two calls is safe";
    - "call methods refuse calls that do not exist and a third call".
  - **Para `test_engine_transfer.cpp`:**
    - "outgoing call is held, resumed, sends DTMF and is transferred";
    - "attended transfer sends REFER with Replaces and ends both calls";
    - "attended transfer refused by the server keeps both calls";
    - "attended transfer that fails in the NOTIFY keeps both calls";
    - "direct transfer reports its result";
    - "TransferAttended with one call is refused";
    - "SendDtmf uses the DTMF method of the profile".
  - **Para `test_engine_conference.cpp`:**
    - "Join resumes the held call and links the two";
    - "Split holds the second call again";
    - "when one party leaves the conference the other stays active";
    - "Activate during a conference splits it";
    - "Join with a ringing call is refused".
  - **Para `test_engine_network.cpp`**, vindos de `test_engine_blf.cpp`:
    - "SetNetworkAvailable false keeps the binding, stops retries after a failure, and true re-registers";
    - "SetNetworkAvailable false returns at once and true registers again after a refresh still on the way".
  - **Ficam em `test_engine_calls.cpp`:** os outros 14, das ligações simples.

  Antes de mexer, rode o `phone_tests` e anote a linha `[doctest] test cases: N | ...`. Depois da separação, o N tem de ser o mesmo.
- [ ] **Step 2: Escreva os testes que falham.**
  - **Em `tests/smoke/test_fake_registrar.py`**, no estilo dos vizinhos (o `Registrar` no próprio processo):
    - `test_contact_reports_the_contact_of_the_last_register`: depois de um REGISTER aceito com `Contact: <sip:2001@127.0.0.1:5070;pn-provider=apns;pn-prid=abc>`, o `CONTACT 2001` devolve essa linha. Antes de qualquer REGISTER, devolve `ERR no-contact`.
    - `test_header_reports_a_header_of_the_last_register`: com `X-Push-Token: abc` no REGISTER aceito, o `HEADER 2001 x-push-token` devolve `abc`. O `HEADER 2001 X-Outro` devolve `ERR no-header`.
    - `test_keepalives_counts_crlf_pings_over_udp_and_tcp`: um `\r\n` pelo `process` (o caminho do UDP) e, pelo `start_tcp_server` do registrador numa porta livre, uma conexão que manda `\r\n\r\n` e um OPTIONS (espere o 200). Depois deles, `KEEPALIVES` devolve `2`.
  - **Em `tests/phone/test_push_data.cpp`** (puro):
    ```cpp
    TEST_CASE("PushDataProblem accepts the RFC 8599 parameters and a token header") {
        PushData data;
        data.contactParams = {{"pn-provider", "apns"}, {"pn-param", "ABCDE12345.br.com.starsonic.phone.voip"},
                              {"pn-prid", "00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0"}};
        data.headers = {{"X-Push-Token", "00fc13adff78512"}};
        CHECK(PushDataProblem(data).empty());
    }
    TEST_CASE("PushDataProblem refuses what would break the REGISTER") {
        // um SUBCASE por caso: valor de parametro com ';', com '>', com '"', com espaco, com '%' sem os dois
        // digitos; parametro "Transport"; cabecalho com "\r\n" no valor; nome vazio; nome com espaco; valor de
        // cabecalho vazio; nome de 65 caracteres; valor de 513; cabecalhos "contact" e "User-Agent"
        // -> CHECK_FALSE(PushDataProblem(data).empty()) em cada um
    }
    TEST_CASE("PushDataProblem accepts a flag parameter without value") { /* {"ob", ""} -> vazio */ }
    ```
  - **Em `tests/phone/test_engine_setup.cpp`**, para os dois motores: `SetPushData refuses data that would break the REGISTER and accepts nullopt`.
    - Com o motor sem conta: `SetPushData` com um valor de parâmetro `a;b` devolve false.
    - Com os dados válidos do primeiro teste acima: true.
    - Com `std::nullopt`: true.
    - Nenhum `OnRegistration` chega (`listener.Registrations().empty()`).
  - **Em `tests/phone/test_engine_pjsip.cpp`:** `the PJSIP engine checks push data and sends nothing`.
    - Com a conta registrada (`Reached(200, true, 1)`), `SetPushData` com os dados válidos devolve true.
    - 1 s depois, `listener.Registrations().size() == 1`, o `CONTACT 2001` não tem `pn-`, e o `HEADER 2001 X-Push-Token` devolve `ERR no-header`.
- [ ] **Step 3: Rode e veja falhar.**
  - Os testes do Python falham com `ERR bad-command`.
  - O C++ não compila: `PushData`, `SetPushData` e `PushDataProblem` ainda não existem.
- [ ] **Step 4: Implemente.**
  - Os três comandos e a contagem no `fake_registrar.py`. Guarde o Contact e os cabeçalhos do REGISTER aceito no `_bind`, e conte os keep-alives no caminho do UDP e no do TCP, sem mudar o que o registrador responde hoje.
  - O `PushDataProblem`, com as regras acima.
  - O `SetPushData` do motor do PJSIP: confere com o `PushDataProblem`. Recusado, escreve no log `push: dados recusados: <motivo>` e devolve false. Aceito, escreve no log `push: o motor do PJSIP nao usa os dados de push` e devolve true.
  - O `PushDataCheck.cpp` entra sozinho nos builds do Android e do Windows (eles compilam `starsonic/phone/*.cpp`). Confira que nada mais nesses builds precisa mudar.
- [ ] **Step 5: Rode e veja passar.** Rode o `test_fake_registrar.py` (OK) e o `phone_tests` do PJSIP: 0 failed, com o N do Step 1 mais os casos novos.
- [ ] **Step 6: Commit e push.**
  - Mensagem: `test(phone): os testes do motor por assunto, o SetPushData no contrato e o registrador falso com Contact, cabeçalhos e keep-alives`.
  - Confira o CI: os workflows `android` (os jobs "Motor de ligações (Linux)" e "Testes dos scripts") e `build` ficam verdes.

### Task 2: O baresip no Linux e o esqueleto do motor

**Files:**
- Create:
  - `build/baresip/build-linux.sh`;
  - `starsonic/phone/baresip/BaresipLoop.h` e `.cpp`, `NullAudio.h` e `.cpp`, `SipEngineBaresip.cpp` e `SipEngineTestAccess.h`;
  - `tests/phone/test_engine_baresip.cpp`.
- Modify:
  - `build/deps.lock` (a seção `baresip`);
  - `tests/phone/CMakeLists.txt`;
  - `.github/workflows/build.yml` (o job `core-tests`, spec 6.2 e 9.3);
  - `starsonic/phone/SipEngine.h` (o `friend struct SipEngineTestAccess;` e a declaração antecipada);
  - `docs/build-notes.md` (a seção "Motor com o baresip (Linux)": as versões, os módulos, o script e os comandos de teste).

**Interfaces:**
- Consumes: o `PushDataProblem` e o `SetPushData` da Task 1.
- Produces:
  - **`build/deps.lock`:** ganha `"baresip": { "re": {repo, tag, commit}, "baresip": {repo, tag, commit}, "libg722": {repo, tag, commit}, "modules": ["g711", "libg722", "opus", "srtp", "stun", "mixminus"] }`, com os valores das Global Constraints.
  - **`build/baresip/build-linux.sh WORKDIR PREFIX`:**
    - lê o `deps.lock` como o `build/linux/build-pjproject.sh` (a função `lock_value`) e busca cada commit fixado, conferindo o hash;
    - compila a libg722 (só a estática, sem os programas de teste), a libre (só a estática, com `USE_BFCP`, `USE_PCP` e `USE_RTMP` desligados) e o baresip (`STATIC=ON`, `MODULES` = a lista do `deps.lock`, achando a libre e a libg722 no PREFIX);
    - junta o `libbaresip.a` e o `.a` de cada módulo num arquivo só, `PREFIX/lib/libstarsonic-baresip.a`, com o `ar -M`, porque o `install` do baresip estático não instala os módulos;
    - deixa os cabeçalhos em `PREFIX/include` (o `re/` da libre e o `baresip.h`) e escreve `PREFIX/lib/starsonic-baresip-libs.txt`, com as bibliotecas do sistema para ligar (`ssl crypto opus z pthread m dl`);
    - sai com erro se faltar um módulo da lista no `libstarsonic-baresip.a`: procura `exports_<módulo>` com o `nm`.
  - **`tests/phone/CMakeLists.txt`:**
    - pede `PJPROJECT_PREFIX` ou `BARESIP_PREFIX` (ou os dois); sem nenhum, `FATAL_ERROR`;
    - o `call_controller_tests` sai sempre (não depende de motor nenhum);
    - com `PJPROJECT_PREFIX`, o `phone_tests` de hoje, com o glob dos testes deixando de fora `test_engine_baresip.cpp`;
    - com `BARESIP_PREFIX`, o alvo `phone_tests_baresip`, feito de:
      - a lista explícita `BARESIP_TEST_SOURCES` (nesta tarefa: `main.cpp`, `test_engine_setup.cpp`, `test_engine_baresip.cpp`, `test_push_data.cpp` e `test_account_config.cpp`);
      - os fontes de `starsonic/core/*.cpp`;
      - de `starsonic/phone`: `CallController.cpp`, `CallEngine.cpp`, `EngineEvents.cpp`, `AccountConfig.cpp` e `PushDataCheck.cpp`;
      - `starsonic/phone/baresip/*.cpp`;
      - os mesmos includes e o mesmo `STARSONIC_REPO_DIR` do `phone_tests`, mais `starsonic/phone/baresip`, `BARESIP_PREFIX/include` e `BARESIP_PREFIX/include/re`;
      - o link: `libstarsonic-baresip.a`, `libre.a` e `libg722.a` entre `-Wl,--start-group` e `-Wl,--end-group`, mais as bibliotecas do `starsonic-baresip-libs.txt`;
    - `add_test(NAME phone_tests_baresip ...)`.
  - **`.github/workflows/build.yml`, no job `core-tests`** ("Testes do núcleo (Linux)"), depois dos testes C++ de hoje:
    - instala `libssl-dev libopus-dev zlib1g-dev`;
    - restaura o cache `baresip-linux-v1-${{ hashFiles('build/deps.lock', 'build/baresip/**') }}` (caminho `baresip-linux`);
    - sem o cache, roda `bash build/baresip/build-linux.sh work/baresip-src baresip-linux` e guarda o cache;
    - o passo "Testes do motor com o baresip": `cmake -S tests/phone -B build-phone-baresip -DBARESIP_PREFIX="$PWD/baresip-linux"`, o build com `-j 4` e o `ctest --output-on-failure`.

    O `paths-ignore` do `build.yml` não pega `build/baresip/`, então uma mudança só no script também roda o job.
  - **`BaresipLoop`** (`starsonic/phone/baresip/BaresipLoop.h`):
    ```cpp
    struct LoopConfig {
        std::string userAgent;
        int logLevel = 4;        // 1 erro .. 4 detalhe, como o EngineConfig
        bool nullAudio = false;
    };
    class BaresipLoop {
    public:
        using LogSink = std::function<void(int level, const std::string& line)>;
        // Sobe a thread do laco e volta quando tudo subiu e o re_main ja esta rodando (true), ou quando falhou
        // (false, com o motivo em *error). Uma por processo.
        static std::unique_ptr<BaresipLoop> Start(const LoopConfig& config, LogSink log, std::string* error);
        ~BaresipLoop();
        // De qualquer thread menos a do laco: re_thread_enter, work, re_thread_leave. O work e curto e nunca
        // espera a rede: quem espera uma resposta sai do Run, espera numa condition_variable que o handler (na
        // thread do laco) avisa, e volta com outro Run.
        void Run(const std::function<void()>& work);
    };
    ```
    O que a thread do laço faz, nesta ordem:
    1. `libre_init`, os desvios do log (abaixo, antes de qualquer módulo) e `re_thread_async_init(4)`, como o `main.c` do baresip. Sem o async, o `re_thread_leave` não acorda o laço, e um temporizador criado fora dele (a retransmissão de um pedido, por exemplo) atrasa.
    2. `conf_configure_buf` com a configuração abaixo, `baresip_init(conf_config())` e `ua_init(userAgent, true, true, false)` (UDP e TCP, sem TLS).
    3. `module_preload` de cada módulo do `deps.lock` e, com `nullAudio`, o `RegisterNullAudio()`.
    4. Um temporizador de 0 ms avisa o `Start` de que o laço rodou (o `re_thread_enter` não trava nada antes de o `re_main` rodar), e então o `re_main`.
    5. Depois do `re_main`, ainda nela: `ua_close`, `conf_close`, `baresip_close`, `mod_close`, `re_thread_async_close` e `libre_close`.

    O destrutor pede o fim pelo `re_thread_async_main`, cujo retorno roda na thread do laço e chama `re_cancel`. Depois, espera a thread acabar.
  - **A configuração do baresip, em texto:**
    - `sip_listen 0.0.0.0:0` (a porta escolhida pelo sistema, como no PJSIP);
    - `call_max_calls 4` (as regras de duas ligações são do motor);
    - `audio_player` e `audio_source` iguais a `nullaudio,nil` com `nullAudio`;
    - nenhum módulo de interface (`menu`, `account`, `contact`).
  - **O log:**
    - `dbg_handler_set` (libre), `log_register_handler` (baresip) e `sip_set_trace_handler(uag_sip(), ...)` (cada mensagem SIP inteira que sai e que chega, numa linha de log, no nível 4) vão para o `LogSink`, direto da thread que escreveu;
    - níveis: o erro do baresip vira 1, o aviso 2, a informação 3 e a depuração 4;
    - linhas acima do `logLevel` não saem.
  - **`NullAudio`:** `int RegisterNullAudio(); void UnregisterNullAudio();` registram uma fonte e uma saída de som chamadas `nullaudio` (`ausrc_register` e `auplay_register`), que abrem sempre, nunca mandam amostras e nunca pedem amostras.
  - **`SipEngineTestAccess`** (`starsonic/phone/baresip/SipEngineTestAccess.h`): `struct SipEngineTestAccess` (em `namespace starsonic`) com métodos estáticos que as Tasks 5 e 6 acrescentam. Ela é amiga do `SipEngine` (o `friend` em `SipEngine.h`), e o motor do PJSIP nunca a define.
  - **`SipEngineBaresip.cpp`:** `SipEngine::Create`, o destrutor e todos os métodos públicos. Nesta tarefa:
    - **`Create`:**
      - sem listener, nullptr com um erro;
      - um segundo motor vivo, nullptr com o erro `ja ha um motor neste processo`;
      - uma falha ao subir, nullptr com `nao foi possivel iniciar o baresip: <motivo>`.
    - **`ActiveCodecs`:** o `CodecIds(config.profile.global.codecs)` (de `AccountConfig.h`), filtrado pelo que o baresip registrou (`aucodec_find` com o nome, a taxa e os canais do id). Cada um que falta gera a linha de log `codec sem suporte neste build: <id>`, como `G729/8000/1`.
    - **Dispositivos de som** (spec 6.1: o iPhone escolhe o caminho do som; o padrão, -1, não entra na lista, como no motor do PJSIP):
      - `AudioDevices` devolve vazio; com `nullAudio`, só o dispositivo nulo (`{-2, "Null Audio", true, true}`, como o contrato);
      - `SetAudioDevices` devolve true quando cada id é -1 ou um da lista; senão, false. Nada muda no som;
      - `RefreshAudioDevices` não faz nada.
    - **`WatchBlf`:** não faz nada e não avisa; com uma lista não vazia, escreve no log `BLF: sem suporte neste motor`.
    - **`SetPushData`:** confere com o `PushDataProblem` (recusado: false e a linha de log do PJSIP) e guarda. O envio vem na Task 3.
    - **O resto:** devolve o "não deu" do contrato (-1, false, 0 ou nada) até a tarefa dele.
  - A trava `apiMutex_` põe um método público por vez, como no motor do PJSIP, e nunca é presa num handler do laço.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/phone/test_engine_baresip.cpp`:
  ```cpp
  TEST_CASE("the baresip engine sends the start-up lines of baresip to OnLog") {
      RecordingListener listener;
      INFO(listener.LogTail());
      std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());
      // escrita pelo proprio baresip ao registrar o codec do modulo g711
      CHECK(Contains(listener.LogTail(), "aucodec: PCMU/8000/1"));
  }
  TEST_CASE("the baresip engine can be created and destroyed three times in a row") {
      for (int round = 0; round < 3; ++round) {
          CAPTURE(round);
          RecordingListener listener;
          std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());
          CHECK(engine->ActiveCodecs() == std::vector<std::string>{"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"});
      }
  }
  TEST_CASE("the baresip engine lists only the null device and ignores BLF") {
      // com o nullAudio dos testes: AudioDevices() == {um item: id -2, "Null Audio", capture e playback};
      // SetAudioDevices(-1, -1) e SetAudioDevices(-2, -2) true; SetAudioDevices(0, 0) false;
      // WatchBlf({"2002"}) sem conta e sem nenhum OnBlf em 300 ms (listener.Blfs().empty())
  }
  ```
  Os testes de `test_engine_setup.cpp`, de `test_push_data.cpp` e de `test_account_config.cpp` também entram no `phone_tests_baresip`.
- [ ] **Step 2: Rode e veja falhar.** Rode `build-linux.sh` (sai com o PREFIX completo), configure e compile o `phone_tests_baresip`: o link falha, porque `SipEngine::Create` não existe sem o `SipEngineBaresip.cpp`. Esse é o vermelho desta tarefa.
- [ ] **Step 3: Implemente** o `BaresipLoop`, o `NullAudio` e o esqueleto do `SipEngineBaresip.cpp` (as interfaces acima). As notas do `docs/build-notes.md` entram neste passo.
- [ ] **Step 4: Rode e veja passar.**
  - O `phone_tests_baresip`: 0 failed.
  - O `phone_tests` do PJSIP continua com 0 failed.
  - O `nm -C PREFIX/lib/libstarsonic-baresip.a | grep -c 'exports_'` mostra os 6 módulos e nenhum `exports_g722`.
  - O `python3 build/check_source_text.py`: `ok`.
- [ ] **Step 5: Commit e push.**
  - Mensagem: `feat(phone): o baresip no Linux e o esqueleto do motor com o baresip`.
  - Confira que o job "Testes do núcleo (Linux)" do `build` roda o `phone_tests_baresip` e fica verde, e que o `android` continua verde.

### Task 3: O registro, a rede, o keep-alive e o push

**Files:**
- Create: `starsonic/phone/baresip/BaresipAccount.h` e `.cpp`.
- Modify:
  - `starsonic/phone/baresip/SipEngineBaresip.cpp`: `SetAccount`, `RemoveAccount`, `Reregister`, `HandleIpChange`, `SetNetworkAvailable` e `SetPushData`, e o destrutor, que tira a conta;
  - `tests/phone/CMakeLists.txt`: entram em `BARESIP_TEST_SOURCES` o `test_engine_register.cpp` e o `test_engine_network.cpp`;
  - `tests/phone/test_engine_network.cpp` (um teste novo, para os dois motores);
  - `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: `BaresipLoop::Run`, a `EventQueue`, o `PushDataProblem`, o `BuildAccount` (`AccountPolicy.h`) e o `ToPjAccount` (`AccountConfig.h`).
- Produces:
  ```cpp
  class BaresipAccount {   // a conta: a ua do baresip (as ligacoes) e o cliente de REGISTER; so na thread do laco
  public:
      BaresipAccount(EventQueue& events, BaresipLoop::LogSink log);
      // BuildAccount (o perfil com os serverPorts da entrada, como o SetAccount do SipEngine.cpp) e ToPjAccount;
      // cria a ua e o cliente de REGISTER, e registra se a rede esta disponivel.
      int Start(const Profile& profile, const AccountInput& input, int accountId, bool networkAvailable);
      void Retire(bool reportExit);   // tira a conta do servidor (as regras abaixo)
      void Refresh();                 // REGISTER agora
      void SetNetworkAvailable(bool available);
      void SetPushData(const std::optional<PushData>& data);   // ja conferido
      void OnIpChange();              // depois do uag_reset_transp
      struct ua* Ua() const;
      std::string CallHost() const;   // <dominio>[:porta], como o callHost_ do PJSIP (fields.domain)
      bool Tcp() const;
  };
  ```
  - **A ua do baresip:**
    - AOR `<sip:<ramal>@<domínio>[;transport=tcp]>`, com `regint=0`;
    - `account_set_auth_user` e `account_set_auth_pass` com o `authUser` e o `authPassword` do `ToPjAccount`. A senha nunca entra no texto do `ua_alloc`, porque o baresip pode escrever esse texto no log;
    - o outbound do `proxyUri`, quando há;
    - o `dtmfmode` (Task 6), o `mediaenc` (`srtp` para optional, `srtp-mand` para mandatory, nenhum para off), o `audio_codecs` (o `CodecIds` juntado por vírgula) e, quando o perfil tem STUN, o `medianat` `stun` com o `stunserver`.

**As regras** (as do `SipEngine.h`; onde ele não diz, como o motor do PJSIP faz):
- **O REGISTER** (um por vez):
  - a Request-URI é o `registrarUri`; From e To, o `idUri`; a rota, o `proxyUri`, quando há;
  - os cabeçalhos: `Expires: <n>` (o `regTimeoutSec`; 0 na saída), porque o registrador falso e muitas centrais só leem ele; o Contact `<sip:<ramal>@<endereço local>[;transport=tcp][;<parâmetros de push>]>`, com o endereço local que o `send_handler` do `sip_drequestf` recebe, como no `sipreg`; os cabeçalhos de push; `Content-Length: 0`;
  - o `User-Agent` sai sozinho: a libre põe o do `ua_init` em todo pedido.
- **Autenticação:** um 401 ou 407 leva a resposta do Digest (`sip_auth_authenticate`) e o mesmo REGISTER sai de novo, uma vez; outro 401 ou 407 em seguida é a resposta final. Um 423 sai de novo uma vez, com o `Min-Expires` da resposta.
- **O tempo concedido:** o `expires` do nosso Contact no 2xx; sem ele, o `Expires` do 2xx; sem os dois, o pedido.
- **A renovação, como o PJSIP:** `concedido - 5` s depois do 2xx; com 5 s ou menos concedidos, `concedido - 1` s (com 1 s, meio segundo); nunca depois do tempo pedido.
- **Respostas e eventos:**
  - 2xx com tempo concedido: `OnRegistration(<código>, true, id)`;
  - de 300 a 699: `(código, false, id)`;
  - erro de transporte (conexão recusada, rede ou endereço inalcançável): `(503, false, id)`;
  - tempo esgotado, sem resposta: `(408, false, id)`.
- **Novas tentativas, como o PJSIP** (com a rede disponível): depois de 408, 480, 500, 502, 503, 504, 6xx ou erro de transporte, a primeira em 0 a 10 s (ao acaso), as seguintes a cada 290 a 310 s, até um 2xx. Depois de outro código (403, 404...), nenhuma.
- **Um pedido a caminho:** um REGISTER pedido (`Refresh`, `SetPushData`, a rede que volta, a troca de rede) com outro a caminho sai logo depois da resposta dele, e essa resposta não vira evento.
- **`SetAccount`:**
  - endereço ou ramal vazio: devolve 0 e escreve `conta recusada: endereco ou ramal vazio`;
  - a conta anterior sai sem aviso: as ligações dela acabam com o `Disconnected` de sempre, e o motor espera até ~5 s;
  - os ids das contas começam em 1 e crescem;
  - sem rede, a conta nasce parada e só registra no `SetNetworkAvailable(true)`.
- **`RemoveAccount`:**
  1. desliga as ligações e espera até 2 s;
  2. com um REGISTER a caminho, escreve `REGISTER em andamento: a saida espera a resposta dele` e espera a resposta;
  3. manda o REGISTER com Expires 0 e espera a resposta; os passos 2 e 3 juntos esperam até 3 s. Sem resposta, escreve `sem resposta do servidor: a conta sai assim mesmo`;
  4. no fim, `OnRegistration(200, false, id)`, uma vez.
- **`SetNetworkAvailable`:**
  - **false:**
    - as renovações seguem no relógio delas: com a central alcançável, o registro continua valendo e as ligações continuam chegando (o "sem rede" errado);
    - nenhuma resposta de registro vira evento;
    - depois de uma falha, nenhuma nova tentativa;
    - o keep-alive para;
    - não espera nada.
  - **true:** registra de novo na hora (com a regra do pedido a caminho). Repetir true registra de novo; repetir false não faz nada. Sem conta, só guarda o estado.
- **`HandleIpChange`:**
  - `uag_reset_transp(false, false)`;
  - com conta e rede, um REGISTER na hora;
  - sem conta, volta na hora (menos de 1,5 s).
- **Keep-alive:**
  - depois de cada 2xx, enquanto a conta está registrada e com rede, a cada `udpKeepAliveSec` segundos (o `keepalive=` do perfil), manda `\r\n` (UDP) ou `\r\n\r\n` (TCP) pelo `sip_send`, ao endereço de onde veio o 2xx;
  - no TCP, pela mesma conexão: o `sock` do 2xx, guardado com `mem_ref`;
  - para com a conta, com a rede fora e no destrutor.
- **Dados de push:**
  - vão em cada REGISTER: os parâmetros dentro dos `<>` do Contact (`;nome=valor`, ou `;nome` sem valor) e os cabeçalhos entre os outros;
  - um `SetPushData` com conta e rede registra de novo na hora; sem conta ou sem rede, só guarda.
- **Destrutor:**
  - o `EventQueue::Stop()` vem primeiro: nada é avisado depois;
  - depois, a conta sai como no `Retire`, mas sem o evento;
  - o tempo total fica limitado a ~5 s, com ou sem resposta.
- **Fica para depois:** uma conexão TCP que o servidor fecha só é refeita na próxima renovação, porque a libre não avisa o fim da conexão sem o keep-alive da RFC 5626, que pede resposta do servidor. O PJSIP percebe na hora. A seção "Como ficou" da spec (Task 7) registra isso.

- [ ] **Step 1: Escreva os testes que falham.** Os de `test_engine_register.cpp` e de `test_engine_network.cpp` entram no `phone_tests_baresip` sem mudança.
  - **Em `tests/phone/test_engine_network.cpp`**, para os dois motores:
    ```cpp
    TEST_CASE("a refused renewal is tried again within 10 s while the network is available") {
        // EXPIRES 3; SetAccount(UDP); Reached(200, true, 1); FAIL REGISTER on;
        // REQUIRE(registrar.WaitForLog("register-503 2001", kWaitSeconds));   // a renovacao leva 503
        // CHECK(listener.WaitFor(RecordingListener::Reached(503, false, 1), kWaitSeconds));
        // CHECK(WaitUntil([&] { return LogCount(registrar, "register-503 2001") >= 2; }, 12));   // a nova tentativa
    }
    ```
  - **Em `tests/phone/test_engine_baresip.cpp`:**
    ```cpp
    const PushData kPush = { {{"pn-provider", "apns"}, {"pn-param", "ABCDE12345.br.com.starsonic.phone.voip"},
                              {"pn-prid", "00fc13adff78512"}},
                             {{"X-Push-Token", "00fc13adff78512"}} };

    TEST_CASE("SetPushData before SetAccount puts the push data in the REGISTER, in each format") {
        // PushData push; SUBCASE("parameters in the Contact") { push.contactParams = kPush.contactParams; }
        //                SUBCASE("headers") { push.headers = kPush.headers; }
        // SetPushData(push) true; SetAccount(UDP); Reached(200, true, 1);
        // contact = registrar.Control("CONTACT 2001").at(0); header = registrar.Control("HEADER 2001 X-Push-Token")
        // parametros: Contains(contact, ";pn-provider=apns;pn-param=ABCDE12345.br.com.starsonic.phone.voip;pn-prid=00fc13adff78512>")
        //             e header == Lines{"ERR no-header"}
        // cabecalhos: !Contains(contact, "pn-") e header == Lines{"00fc13adff78512"}
    }
    TEST_CASE("SetPushData with a registered account registers again, the next REGISTERs keep the data, and nullopt takes them out") {
        // SetAccount; Reached(200,true,1); SetPushData(kPush) -> Reached(200,true,2), CONTACT com ";pn-prid=";
        // Reregister() -> Reached(200,true,3), ainda com ";pn-prid="; HandleIpChange() -> Reached(200,true,4), ainda com ele;
        // SetPushData(std::nullopt) -> Reached(200,true,5), CONTACT sem "pn-" e HEADER ... -> Lines{"ERR no-header"}
    }
    TEST_CASE("SetPushData without network only stores the data, and the REGISTER after the network comes back carries it") {
        // SetAccount; Reached(200,true,1); SetNetworkAvailable(false); const int before = Registers(registrar);
        // SetPushData(kPush) true; 1 s depois CHECK(Registers(registrar) == before);
        // SetNetworkAvailable(true); Reached(200,true,2); CONTACT com ";pn-prid=00fc13adff78512"
    }
    TEST_CASE("keep-alives go to the server every keepalive seconds") {
        // SUBCASE UDP e TCP; Phone phone(transport, [](Profile& p) { p.account.keepAliveSeconds = 1; });
        // const int start = stoi(Control("KEEPALIVES")[0]); CHECK(WaitUntil(KEEPALIVES >= start + 2, 4))
    }
    TEST_CASE("destroying the engine with a REGISTER on the way returns within 5 s and reports nothing") {
        // DelayedUdpRelay relay(registrar.port(), 60000) (relay_fixture.h); motor em LoadProfile(relay.port());
        // SetAccount(UDP); const size_t events = listener.EventCount(); medir engine.reset() < 5 s;
        // 300 ms depois CHECK(listener.EventCount() == events)
    }
    TEST_CASE("the engine registers each time it is created again in the same process") {
        // um registrador; tres rodadas: listener novo, StartEngine, SetAccount(UDP), Reached(200,true,1),
        // engine.reset(), e o RING 2001 devolve Lines{"ERR no-contact"} (a conta saiu do servidor)
    }
    ```
- [ ] **Step 2: Rode e veja falhar.**
  - No `phone_tests_baresip`, os de registro falham: `SetAccount` devolve 0 e nenhum `OnRegistration` chega.
  - No `phone_tests` do PJSIP, o teste novo de `test_engine_network.cpp` já passa: ele confere o que o PJSIP faz hoje. Se falhar, pare e registre uma ruling antes de seguir.
- [ ] **Step 3: Implemente** o `BaresipAccount` e os métodos do motor (as regras acima).
- [ ] **Step 4: Rode e veja passar.**
  - O `phone_tests_baresip` completo: 0 failed, com os 16 casos do `test_engine_register.cpp`, os 3 do `test_engine_network.cpp` e os novos.
  - O `phone_tests` do PJSIP continua com 0 failed.
  - Rode o `phone_tests_baresip` mais duas vezes seguidas: os tempos de rede não podem falhar ao acaso.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(phone): o registro, a rede, o keep-alive e os dados de push no motor com o baresip`. CI verde (`build` e `android`).

### Task 4: As ligações simples

**Files:**
- Create: `starsonic/phone/baresip/BaresipCalls.h` e `.cpp`.
- Modify:
  - `starsonic/phone/baresip/SipEngineBaresip.cpp`: `MakeCall`, `Answer`, `Reject`, `Hangup`, `CallCount`, `HasCall` e `AudioLinks`, e o destrutor, o `SetAccount` e o `RemoveAccount`, que desligam as ligações;
  - `tests/phone/CMakeLists.txt`: entra o `test_engine_calls.cpp`;
  - `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: `BaresipAccount::Ua()`, `CallHost()` e `Tcp()`, a `EventQueue` e o `bevent_register` do baresip.
- Produces:
  ```cpp
  class BaresipCalls {   // estado na thread do laco; Count() e lido de qualquer thread (atomico)
  public:
      BaresipCalls(EventQueue& events, BaresipLoop::LogSink log, DtmfMethod dtmf);
      void OnEvent(enum bevent_ev ev, struct bevent* event);   // o handler do bevent repassa aqui
      int Make(struct ua* ua, const std::string& uri);         // -1: recusada (regras abaixo)
      bool Answer(int id);
      bool Reject(int id);
      bool Hangup(int id);
      int Count() const;
      std::vector<int> AudioLinks(int id) const;
      void EndAll();   // os pedidos do Hangup (BYE, CANCEL ou 603), sem eventos: o destrutor e a troca de conta
  };
  ```
  - **Ids das ligações:** começam em 1, crescem e nunca se repetem no mesmo motor.
  - **URI da ligação:** `sip:<numero>@<CallHost()>`. Numa conta TCP, a URI ganha `;transport=tcp`. Na UDP, nada.

**Os eventos, na ordem** (é a régua do contrato; os testes conferem cada linha):

| O que aconteceu | Eventos |
|---|---|
| Chegou um INVITE sem ligação nenhuma, ou com uma só, já confirmada | `OnIncomingCall(id, usuário do From, nome de exibição em UTF-8)`, depois `OnCallState(id, Incoming, 100)`. O 180 sai e vem `OnCallState(id, Early, 180)`. |
| Chegou um INVITE com outra ligação ainda não confirmada, ou com duas em andamento | 486 para quem ligou e `OnRejectedBusy(usuário, nome)`, sem id e sem estados. |
| `Answer(id)` | O 200 sai e vem `OnCallState(Connecting, 200)`. Com o ACK, `OnCallState(Confirmed, 200)`. |
| `MakeCall` | `OnCallState(Calling, 0)`, antes de `MakeCall` voltar. Com 180 ou 183, `Early/<código>`. Com 200, `Connecting/200` e, depois do ACK que sai, `Confirmed/200` (os dois quando o baresip avisa `BEVENT_CALL_ESTABLISHED`). |
| Fim | `OnCallState(Disconnected, código)`, sempre o último evento da ligação. O código: `Reject` → 486; `Hangup` de recebida tocando → 603; `Hangup` de feita não atendida → 487 (CANCEL); BYE de qualquer lado → 200; recusa do outro lado → o código da resposta final (`call_scode`); CANCEL de quem ligou → 487. |

**As regras:**
- **`MakeCall`:** devolve -1 sem conta (a conta basta, mesmo sem registro), com o número vazio, com duas ligações ou com a outra ainda não confirmada. Com uma confirmada e ativa, ela vai para a espera antes (Task 5).
- **`Answer` e `Reject`:** só numa recebida que toca.
- **`Hangup`:** vale em qualquer estado.
- **`Count`:** cai antes de o `Disconnected` chegar ao listener.
- **`AudioLinks`:** `{0}` para a única ligação confirmada. Vazio para uma que toca, para um id desconhecido ou sem ligação.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/phone/test_engine_baresip.cpp` (com o `call_fixture.h`). O `test_engine_calls.cpp` entra sem mudança.
  ```cpp
  TEST_CASE("a TCP account dials over TCP") {
      Phone phone(Transport::Tcp);
      const int id = phone.Dial("2002");
      CHECK(Contains(phone.listener.LogTail(),
                     "INVITE sip:2002@127.0.0.1:" + std::to_string(phone.registrar.port()) + ";transport=tcp SIP/2.0"));
      CHECK(phone.engine->Hangup(id));
  }
  TEST_CASE("SetPushData during a call registers again and keeps the call") {
      Phone phone;
      const int id = phone.Dial("2002");
      REQUIRE(phone.engine->SetPushData(kPush));
      CHECK(phone.listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
      std::this_thread::sleep_for(std::chrono::milliseconds(300));
      CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
      CHECK(phone.engine->CallCount() == 1);
      CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});
  }
  ```
- [ ] **Step 2: Rode e veja falhar.** Os de `test_engine_calls.cpp` falham: `MakeCall` devolve -1 e nenhum `OnIncomingCall` chega.
- [ ] **Step 3: Implemente** o `BaresipCalls` e os métodos do motor (os eventos e as regras acima).
- [ ] **Step 4: Rode e veja passar.** O `phone_tests_baresip` completo: 0 failed. O `phone_tests` do PJSIP: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(phone): as ligações feitas e recebidas no motor com o baresip`. CI verde.

### Task 5: Duas ligações, a espera e um microfone só

**Files:**
- Modify:
  - `starsonic/phone/baresip/BaresipCalls.h` e `.cpp`;
  - `starsonic/phone/baresip/SipEngineBaresip.cpp`: `Activate` e `SetHold`;
  - `starsonic/phone/baresip/SipEngineTestAccess.h`;
  - `tests/phone/CMakeLists.txt`: entra o `test_engine_hold.cpp`;
  - `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: o `BaresipCalls` da Task 4.
- Produces:
  - `bool BaresipCalls::Activate(int id);`
  - `bool BaresipCalls::SetHold(int id, bool hold);`
  - `static std::vector<int> SipEngineTestAccess::CallsWithAudio(const SipEngine& engine);`: os ids das ligações com `audio_started(call_audio(call))`, em ordem crescente.

**As regras:**
- **`Answer` da segunda,** com a primeira confirmada e ativa: a primeira vai para a espera (`call_hold(call, true)`, um re-INVITE sendonly, um só) e a segunda é atendida.
- **`Activate(id)`:** só numa confirmada. Já ativa, nada muda e nenhum re-INVITE sai. Senão, a outra (confirmada e fora da espera) vai para a espera, e `id` é retomada (`call_hold(call, false)`, sendrecv) se estava em espera.
- **`SetHold(id, true)`:** só numa confirmada. Já em espera, nada muda. `SetHold(id, false)` é o `Activate(id)`.
- **Desligar a ativa:** a outra continua em espera, sem áudio, até um `Activate`.
- **`SetHold` logo depois de outro:** espera até ~2 s, fora do `Run`, que a renegociação anterior da mesma ligação acabe, antes de mandar o próximo re-INVITE. A libre recusa um re-INVITE com outra oferta no ar (`sipsess_modify` dá `EPROTO`). O fim da renegociação é o `BEVENT_CALL_REMOTE_SDP` com o texto `answer`.
- **Um microfone só:**
  - uma ligação em espera fica com o áudio parado (`audio_stop`), também depois de cada renegociação dela;
  - a ativa fica com o áudio aberto;
  - `AudioLinks`: `{0}` só para a ativa e vazio para a em espera.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/phone/test_engine_baresip.cpp`. O `test_engine_hold.cpp` entra sem mudança.
  ```cpp
  bool WaitAudio(const SipEngine& engine, const std::vector<int>& expected) {   // ate kWaitSeconds
      // repete SipEngineTestAccess::CallsWithAudio(engine) == expected a cada 20 ms
  }
  TEST_CASE("only the active call has the microphone and the speaker open") {
      Phone phone;
      int first = 0, second = 0;
      phone.TwoCalls(&first, &second);
      CHECK(WaitAudio(*phone.engine, {second}));
      REQUIRE(phone.engine->Activate(first));
      CHECK(WaitAudio(*phone.engine, {first}));
      REQUIRE(phone.engine->Hangup(first));
      REQUIRE(phone.WaitState(first, CallState::Disconnected));
      CHECK(WaitAudio(*phone.engine, {}));            // a outra segue em espera
      REQUIRE(phone.engine->Activate(second));
      CHECK(WaitAudio(*phone.engine, {second}));
  }
  ```
- [ ] **Step 2: Rode e veja falhar.** Os de `test_engine_hold.cpp` falham: `Activate` e `SetHold` devolvem false, e atender a segunda deixa a primeira fora da espera.
- [ ] **Step 3: Implemente** as regras acima.
- [ ] **Step 4: Rode e veja passar.** O `phone_tests_baresip` completo e o `phone_tests` do PJSIP: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(phone): duas ligações, a espera e o áudio só na ativa no motor com o baresip`. CI verde.

### Task 6: Teclas, mudo e transferências

**Files:**
- Modify:
  - `starsonic/phone/baresip/BaresipCalls.h` e `.cpp`;
  - `starsonic/phone/baresip/BaresipAccount.cpp` (o `dtmfmode` da ua);
  - `starsonic/phone/baresip/SipEngineBaresip.cpp`: `SendDtmf`, `SetMute`, `Transfer` e `TransferAttended`;
  - `starsonic/phone/baresip/SipEngineTestAccess.h`;
  - `tests/phone/CMakeLists.txt`: entra o `test_engine_transfer.cpp`;
  - `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: o `BaresipCalls` das Tasks 4 e 5.
- Produces:
  - `bool BaresipCalls::SendDtmf(int id, const std::string& digits);`
  - `void BaresipCalls::SetMute(bool muted);`
  - `bool BaresipCalls::Transfer(int id, const std::string& uri);`
  - `bool BaresipCalls::TransferAttended(int id, int targetId);`
  - `static std::vector<int> SipEngineTestAccess::MutedCalls(const SipEngine& engine);`: os ids com `audio_ismuted(call_audio(call))`, em ordem crescente.

**As regras:**
- **`SendDtmf`:**
  - só numa ligação confirmada, com dígitos `0-9*#A-D` (vazio ou outro caractere: false);
  - o método do perfil vai no `dtmfmode` da ua: `DTMFMODE_SIP_INFO` para `info`, e `DTMFMODE_RTP_EVENT` para `rfc2833`, `auto` e `inband`. Nunca o `DTMFMODE_AUTO` do baresip, que cai no INFO quando o outro lado não oferece o telephone-event;
  - cada dígito vai pelo `call_send_digit`, seguido do `KEYCODE_REL`;
  - cada envio escreve no log `SendDtmf: <n> digito(s), using RFC2833 method` ou `SendDtmf: <n> digito(s), using SIP INFO method`, sem os dígitos;
  - o corpo do INFO (`Signal=1`) aparece no log pelas mensagens SIP inteiras da Task 2.
- **`SetMute`:** vale para todas as ligações de agora (`audio_mute`) e para as próximas (aplicado quando cada uma nasce).
- **`Transfer`:**
  - só numa confirmada, sem outra transferência dela no ar;
  - manda o REFER (`call_transfer`) para `sip:<número>@<CallHost()>`, sem o `;transport=tcp`, como o motor do PJSIP.
- **`TransferAttended(id, alvo)`:**
  - as duas confirmadas e diferentes, sem outra transferência no ar;
  - manda o REFER com Replaces: `call_replace_transfer(call de id, call do alvo)`. O REFER vai no diálogo de `id`, e o Refer-To leva o diálogo do alvo.
- **O resultado:**
  - um `OnTransfer(id, código)` por pedido aceito, antes de qualquer `Disconnected`;
  - recusa do REFER ou NOTIFY com falha: o baresip avisa `BEVENT_CALL_TRANSFER_FAILED` com o texto `"<código> <motivo>"`, o código vai no `OnTransfer`, e as duas ligações seguem como estavam;
  - NOTIFY 2xx: o baresip encerra a ligação com o texto `Call transfered` no `BEVENT_CALL_CLOSED`, e vem `OnTransfer(id, 200)` e depois o `Disconnected(id, 200)`;
  - na com consulta, o motor desliga também o alvo (BYE) depois disso;
  - a ligação que acaba antes do resultado não avisa `OnTransfer`.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/phone/test_engine_baresip.cpp`. O `test_engine_transfer.cpp` entra sem mudança.
  ```cpp
  TEST_CASE("SetMute mutes every call now and the next ones") {
      Phone phone;
      const int first = phone.Dial("2002");
      phone.engine->SetMute(true);
      CHECK(SipEngineTestAccess::MutedCalls(*phone.engine) == std::vector<int>{first});
      const int second = phone.Dial("2003");   // a primeira vai para a espera
      CHECK(SipEngineTestAccess::MutedCalls(*phone.engine) == std::vector<int>{first, second});
      phone.engine->SetMute(false);
      CHECK(SipEngineTestAccess::MutedCalls(*phone.engine).empty());
  }
  ```
- [ ] **Step 2: Rode e veja falhar.** Os de `test_engine_transfer.cpp` falham: `SendDtmf`, `Transfer` e `TransferAttended` devolvem false.
- [ ] **Step 3: Implemente** as regras acima.
- [ ] **Step 4: Rode e veja passar.** O `phone_tests_baresip` completo e o `phone_tests` do PJSIP: 0 failed.
- [ ] **Step 5: Commit e push.** Mensagem: `feat(phone): teclas, mudo e transferências no motor com o baresip`. CI verde.

### Task 7: A conferência a três

**Files:**
- Modify:
  - `starsonic/phone/baresip/BaresipCalls.h` e `.cpp`;
  - `starsonic/phone/baresip/SipEngineBaresip.cpp`: `Join` e `Split`;
  - `tests/phone/CMakeLists.txt`: entra o `test_engine_conference.cpp`;
  - `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: o `BaresipCalls` das Tasks 4 a 6 e `SipEngineTestAccess::CallsWithAudio`.
- Produces: `bool BaresipCalls::Join(int id, int otherId);` e `bool BaresipCalls::Split(int id, int otherId);`.

**As regras** (a mesa de áudio é o módulo `mixminus`, que mistura as ligações com `audio_set_conference` ligado):
- **`Join`:**
  - recusado (false) com ids iguais, um id desconhecido, uma ligação não confirmada ou uma transferência com consulta sem resultado ainda;
  - já em conferência, nada muda e nenhum re-INVITE sai;
  - senão: a em espera é retomada (`call_hold(call, false)`, sendrecv), as duas ficam com o áudio aberto e `audio_set_conference(au, true)` nas duas, e nenhuma das duas vai para a espera;
  - `AudioLinks`: `{0, a outra}` em cada uma.
- **`Split(id, outra)`:**
  - recusado nas mesmas condições do `Join`, menos a da transferência;
  - fora da conferência, é o `Activate(id)`;
  - na conferência: `audio_set_conference(au, false)` nas duas, `outra` vai para a espera (sendonly, com o áudio parado) e `id` fica a ativa, sem re-INVITE.
- **`Activate(b)` na conferência:** é o `Split(b, a)`.
- **Uma das duas acaba** (por qualquer lado): a outra vira a ativa, com o áudio, sem a conferência e sem re-INVITE.

- [ ] **Step 1: Escreva os testes que falham**, em `tests/phone/test_engine_baresip.cpp`. O `test_engine_conference.cpp` entra sem mudança.
  ```cpp
  TEST_CASE("both calls of the conference have audio, and Split leaves only the active one") {
      Phone phone;
      int a = 0, b = 0;
      phone.Conference(&a, &b);
      CHECK(WaitAudio(*phone.engine, Sorted({a, b})));
      REQUIRE(phone.engine->Split(a, b));
      CHECK(WaitAudio(*phone.engine, {a}));
  }
  ```
- [ ] **Step 2: Rode e veja falhar.** Os de `test_engine_conference.cpp` falham: `Join` devolve false.
- [ ] **Step 3: Implemente** as regras acima.
- [ ] **Step 4: Rode e veja passar.**
  - O `phone_tests_baresip` completo (setup, register, network, calls, hold, transfer, conference, baresip, push_data e account_config): 0 failed.
  - Rode mais duas vezes seguidas: nenhum caso pode falhar ao acaso.
  - O `phone_tests` do PJSIP: 0 failed.
  - O `python3 build/check_source_text.py`: `ok`.
- [ ] **Step 5: Commit e push.**
  - Mensagem: `feat(phone): a conferência a três no motor com o baresip`.
  - CI verde nos workflows `build` e `android`.
  - Depois da revisão final do ramo inteiro, a seção "Como ficou (etapa 1)" entra na spec, com as decisões tomadas na construção, a conexão TCP da Task 3 e o que ficou para a etapa 2.
