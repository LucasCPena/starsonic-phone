# Starsonic Phone

Softphone da Starsonic para os clientes do PABX em Nuvem. Licença GNU GPL v3.

- **Windows (a partir da 0.1.0):** um app próprio, com a cara da Starsonic. A interface é feita em HTML e CSS e roda no WebView2 da Microsoft; por baixo, o mesmo motor de ligações do Android (PJSIP). Tem várias contas no mesmo PC, Não perturbe, Atender automático, a segunda ligação, a transferência com consulta, a conferência, o aviso de ligação no canto da tela e o tema claro e escuro do Windows. O instalador é por usuário (sem senha de administrador) e a atualização é com um clique. Quem usa a rc.7 atualiza sem perceber a troca: as contas, os contatos e os recentes vêm junto.
- **Windows, série 0.0.1 (até a rc.7):** um fork do [MicroSIP](https://www.microsip.org) 3.22.16 com a marca Starsonic. O código dele continua em `microsip/` até o app novo ficar estável, para dar para publicar uma correção da 0.0.1 até lá.
- **Android** (APK de teste): um app próprio com o mesmo motor e as mesmas regras. Veja a seção [Android](#android).

O app novo do Windows está na [especificação da W1](docs/superpowers/specs/2026-10-21-starsonic-phone-windows-w1-design.md) (com a seção "Como ficou", o que mudou durante a construção) e no [plano da W1](docs/superpowers/plans/2026-10-21-windows-w1-app-novo.md). A marca, o perfil, o atualizador e a publicação vêm da [especificação do Windows](docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md), que a W1 substitui onde as duas divergem. As seções até "Como trazer uma versão nova do MicroSIP" são do Windows.

## Organização

| Pasta | Conteúdo |
|-------|----------|
| `windows/app/` | O executável do app novo (`StarsonicPhone.exe`, Win32 em C++17, sem MFC): a janela com o WebView2, o aviso de ligação, a bandeja, a instância única, os links `tel:`/`sip:`/`callto:`, o Iniciar com o Windows, o diagnóstico e o atualizador. Compila com o CMake |
| `windows/ui/` | A interface do app novo (TypeScript e Preact, empacotada com o esbuild): as telas, os ícones, o toque e os testes do Playwright (`tests/`). A saída (`dist/`) vai na pasta `ui\` do app |
| `starsonic/desktop/` | O app de PC em C++ portátil (testado no Linux): o `DesktopApp` (o estado e os comandos da interface), o protocolo da ponte, as lojas (contas, contatos, recentes e configurações em JSON) e a migração da rc.7 |
| `starsonic/phone/` | O motor de ligações (`SipEngine`, sobre o pjsua2) e o controlador das ligações (`CallController`, as regras da 0.2 do Android), os mesmos do Android, sem nada de Windows nem de Android |
| `starsonic/core/` | O núcleo em C++14 dos dois apps (perfil, portas por servidor, regras de conta, tela Entrar, mensagens, números, arquivo de versão) |
| `starsonic/win/` | O que é do Windows e serve aos dois apps de PC: o atualizador, o HTTP, o SHA-256 e a decifra das senhas da rc.7; e a integração com o MicroSIP (MFC) do app antigo |
| `microsip/` | O app antigo (série 0.0.1): o MicroSIP 3.22.16, idêntico ao oficial exceto pelas edições E1–E14 (tabela no plano de 11/10) |
| `microsip-dist/` | Sons do pacote oficial MicroSIP Lite (só do app antigo) |
| `branding/` | Nome, URLs, cores, perfil das contas (`perfil.ini`: porta, portas por servidor, protocolo padrão, SRTP, codecs e DTMF), logos, ícones, imagens do instalador (`installer/`) e, em `fontes/`, o logo original e o script que gera os ícones e logos |
| `installer/` | O instalador (NSIS) do app novo |
| `build/` | Scripts de build, verificação e publicação |
| `tests/` | Testes do núcleo (doctest), do app de PC (`desktop/`, portáteis), do Windows (`win/`), do motor e do controlador (`phone/`), dos scripts (`python/`) e de fumaça no Windows (`smoke/`) |
| `notas/` | Notas de cada versão (`vX.Y.Z.txt` e `vX.Y.Z-rc.N.txt`), mostradas no aviso de atualização e na página do release |
| `docs/` | Specs, planos, [a ponte do app de PC](docs/ponte-windows.md), [notas do build](docs/build-notes.md) e o [teste manual](docs/teste-manual.md) |

## Como compilar

O GitHub Actions compila e testa cada push (`.github/workflows/build.yml`) e guarda o executável, a interface, o instalador e as capturas de tela como artefatos do workflow. Para compilar num PC com Windows:

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++" (e "MFC para v143", só para o app antigo), Git, Node.js 22, NSIS 3 e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work      # pjproject 2.17, vcpkg e o SDK do WebView2 (uma vez; demora)

cd windows\ui
npm ci
npm run build                             # tsc e esbuild: windows\ui\dist
cd ..\..

.\build\Build-Windows.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -OutDir out-novo
.\build\Build-Installer.ps1 -Version 0.0.0 -AppDir out-novo -OutDir dist -WorkDir work
```

- O `Build-Deps.ps1` monta `work\pjproject`, `work\vcpkg` e `work\webview2` nas versões do `build/deps.lock`.
- O `Build-Windows.ps1` compila o `windows/app` com o CMake e copia a interface (`windows\ui\dist`, ou outra pasta com `-UiDir`) para `out-novo\ui\`. Com `-TestHooks`, sai o build de teste, que a fumaça usa (veja as [notas do build](docs/build-notes.md)).
- O `Build-Installer.ps1` gera `dist\StarsonicPhone-<versão>-setup.exe`, com o bootstrapper do WebView2 dentro (baixado do endereço do `deps.lock` e guardado em `work\webview2-bootstrapper`).
- O app antigo ainda compila com `.\build\Build-App.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -ProfileFile branding\perfil.ini -OutDir out`, mas o instalador dele não é mais gerado.

Detalhes e ajustes do build: [docs/build-notes.md](docs/build-notes.md).

## Testes

No Linux (ou no Windows), com CMake, Python 3 e Node.js 22:

```bash
# o núcleo
cmake -S tests -B build-tests && cmake --build build-tests && ctest --test-dir build-tests
# o app de PC (portátil; precisa do libsqlite3-dev)
cmake -S tests/desktop -B build-desktop && cmake --build build-desktop && ctest --test-dir build-desktop
# o motor e o controlador (o pjproject do Linux: bash build/linux/build-pjproject.sh work/pjproject-linux pj-linux)
cmake -S tests/phone -B build-phone -DPJPROJECT_PREFIX="$PWD/pj-linux" && cmake --build build-phone && ctest --test-dir build-phone
# a interface (Playwright no Chromium, com uma ponte falsa; cada tela nos temas claro e escuro, mais o axe)
(cd windows/ui && npm ci && npm run build && npx playwright install chromium && npx playwright test)
# os scripts e as conferências
python3 -m unittest discover -s tests/python
python3 build/check_source_text.py
python3 build/check_branding.py --repo .
```

- **`desktop_tests`** (`tests/desktop`) roda no Linux e no Windows. No Windows, também compila `tests/win` (DPAPI, os links, o Iniciar com o Windows, a instância única, o diagnóstico). A senha cifrada pelo `CCrypto` original da rc.7 é conferida num executável à parte, com MFC (`tests/win/legacy_crypto`, nos testes do núcleo no Windows).
- **`call_controller_tests`** e **`phone_tests`** (`tests/phone`) são os testes do controlador (os casos do `CallManagerTest.kt` da 0.2 portados, mais Não perturbe, Atender automático e troca de conta) e do motor contra o registrador SIP falso (`tests/smoke/fake_registrar.py`, UDP e TCP). Rodam no workflow `android` a cada push que mexe em `starsonic/`.
- **Fumaça no Windows** (job `windows` do `build.yml`): `Test-WindowsApp.ps1` (a janela abre, a interface fica pronta, `--sair`); `Test-InstalledApp.ps1` com o `windows_smoke.py` (o app instalado do build de teste, dirigido pelo DevTools do WebView2: entra no registrador falso, liga, recebe pelo aviso, a janela numa área de trabalho baixa, o WebView2 que cai e volta, o fechamento com limite); `Test-Installer.ps1` (instalar, atualizar por cima, os links, a desinstalação); `Test-SourceBundle.ps1` (o pacote de fontes); e a conferência de marca do exe, da pasta `ui\` e do instalador.
- **O ensaio da atualização da rc.7** só roda à mão: Actions → build → Run workflow, com "Ensaio da atualização" marcado (ou `gh workflow run build.yml --ref main -f ensaio-atualizacao=true`). Ele instala a `v0.0.1-rc.7` do release, entra numa conta e grava um contato pela própria rc.7, instala o app novo por cima em silêncio e confere que ele abre "Conectado" com a conta e o contato (`Test-UpdateFromRc7.ps1`; apaga `%APPDATA%\Starsonic Phone`, por isso só roda no CI).
- O que só um PC de verdade mostra (o som, a escala real, o Windows 10 sem WebView2, duas contas da rc.7) está no [teste manual](docs/teste-manual.md).

## A ponte entre a interface e o C++

A interface só desenha: as regras ficam no C++ (`starsonic/desktop/DesktopApp`). As duas conversam por mensagens JSON (`chrome.webview.postMessage`): a interface manda comandos (`dial`, `answer`, `login`, `selectAccount`…) e recebe o estado inteiro a cada mudança, os avisos de 2 s, o toque e a pergunta da atualização. O contrato é o [docs/ponte-windows.md](docs/ponte-windows.md): uma mudança no formato muda esse documento, o `starsonic/desktop/Protocol.cpp` e os testes juntos.

## Como lançar uma versão

As versões seguem `X.Y.Z` (estável) e `X.Y.Z-rc.N` (candidata, para teste). Quem publica é o workflow `release`:

1. **Candidata:** no GitHub, Actions → release → Run workflow, com a versão (ou `gh workflow run release.yml --ref main -f versao=X.Y.Z-rc.N`); a tag `vX.Y.Z-rc.N` também dispara o workflow. Ele compila com o canal de teste, publica o pre-release `vX.Y.Z-rc.N` e atualiza o pre-release fixo `canal-teste`, de onde as rc instaladas recebem a atualização. Se houver `notas/vX.Y.Z-rc.N.txt`, o texto vai no aviso de atualização e na página do release.
2. **Teste manual:** siga o [roteiro](docs/teste-manual.md), inclusive a atualização de uma rc para a seguinte.
3. **Estável:** escreva `notas/vX.Y.Z.txt` (texto curto mostrado no aviso de atualização; o app corta o que passar de 500 caracteres) e publique a versão `X.Y.Z` do mesmo jeito. O workflow só publica se o portão de entradas passar: `python3 build/check_release_inputs.py --repo .` lista o que ainda é provisório (cores, ícones, logos, tradução, imagem do instalador).

Cada release traz `StarsonicPhone-<versão>-setup.exe` (o instalador do app novo), `versao.json` (com o SHA-256 do instalador, conferido pelo app antes de instalar) e `StarsonicPhone-<versão>-codigo-fonte-completo.zip`, que cumpre a GPL: o repositório, o pjproject, o código-fonte das bibliotecas do vcpkg e os pacotes do npm que vão dentro da interface (`npm-packages/`).

O app procura atualizações em `github.com/<STARSONIC_GITHUB_ACCOUNT>/starsonic-phone` (em `branding/branding.h`) e só aceita instaladores que comecem com esse mesmo endereço, letra por letra; o workflow recusa publicar em outro repositório.

**Não transfira o repositório para outra conta sem preparar a mudança.** O GitHub redireciona o endereço antigo, então as versões já instaladas ainda acham o `versao.json` novo. Mas o instalador dele aponta para a conta nova, e essas versões recusam o instalador para sempre. Antes da transferência, é preciso publicar uma versão-ponte que aceite os dois endereços e esperar os clientes atualizarem; isso exige uma mudança no código (`starsonic/win/Updater.cpp`).

## Como mudar o logo ou os ícones

Ícones, logos e imagem do instalador saem de `branding/fontes/gerar_marca.py`, a partir do logo original (`branding/fontes/logo-starsonic.png`). O desenho do ícone e as cores (azul `#383881` e ciano `#3DB1CC`) estão no próprio script.

1. Troque o logo ou ajuste o script.
2. Rode `python3 branding/fontes/gerar_marca.py`. Ele precisa de Python 3 com Pillow, numpy, scipy e Playwright (com o Chromium), que não fazem parte do build.
3. Faça o commit dos arquivos gerados. Se a cor principal mudar, mude também `STARSONIC_BRAND_COLOR` em `branding/branding.h` e as cores conferidas em `tests/smoke/Test-BrandUi.ps1`.

## Como trazer uma versão nova do MicroSIP

Só vale para o app antigo (série 0.0.1, em `microsip/`), enquanto ele existir.

1. No GitHub, Actions → importar-microsip → Run workflow, com a versão (ex.: `3.22.17`). O workflow baixa os pacotes oficiais, atualiza `microsip/` e `microsip-dist/` no ramo `upstream`, cria a tag `microsip-<versão>` e abre um PR de `upstream` para `main`.
2. Resolva os conflitos só nas edições E1–E14 (tabela no plano), mantendo cada uma como está descrita, e confira o build verde no PR.
3. Faça o merge com merge commit (não squash): é assim que o workflow sabe, na próxima importação, que a versão já entrou.

## Android

O app para Android (etapa 1: APK de teste, baixado do GitHub) é escrito do zero em Kotlin com Jetpack Compose, sobre o mesmo PJSIP 2.17 e o mesmo núcleo (`starsonic/core`) do Windows. O que ele faz e por quê está na [especificação](docs/superpowers/specs/2026-10-14-starsonic-phone-android-design.md); como foi construído, no [plano](docs/superpowers/plans/2026-10-14-android-etapa-1.md).

A 0.2 ("ramal completo") acrescenta a segunda ligação (atender, alternar, a em espera volta sozinha ao desligar a ativa), a transferência com consulta, a conferência a três (feita no celular, na mesa de áudio do PJSIP) e os contatos do celular (a aba Contatos, as sugestões ao digitar e o nome do contato nas ligações; os contatos são lidos na hora e nunca saem do aparelho — [o que mudou para a LGPD](docs/privacidade-android-0.2.md)). Está na [especificação da 0.2](docs/superpowers/specs/2026-10-16-starsonic-phone-android-0.2-design.md) e no [plano](docs/superpowers/plans/2026-10-16-android-0-2-ramal-completo.md). O perfil (`branding/perfil.ini`) ganhou `ddi` e `prefixo_externo` na `[conta]`, para os números dos contatos (o `+55` sai; um prefixo de linha externa, se a central exigir, entra na frente dos números com mais de 6 dígitos).

### Organização

| Pasta | Conteúdo |
|-------|----------|
| `android/` | Projeto Gradle: o app (Kotlin e Compose), a ponte JNI (`app/src/main/cpp`), os testes na JVM (`app/src/test`) e no emulador (`app/src/androidTest`) |
| `starsonic/phone/` | Motor de ligações em C++ sobre o pjsua2, sem nada de Android (para o iPhone reaproveitar) |
| `tests/phone/` | Testes do motor no Linux, contra o registrador SIP falso (`tests/smoke/fake_registrar.py`) |
| `build/android/` | PJSIP, Opus e Oboe para o Android (`build-deps.sh`), `versionCode` (`version_code.py`), conferência do APK (`check_apk.py`), código-fonte completo (`make_source_bundle.sh`), os scripts dos testes no emulador e o SHA-256 do certificado da chave (`signing-cert.sha256`) |
| `build/linux/` | pjproject para o Linux (os testes do motor) |
| `docs/teste-manual-android.md` | Roteiro do teste manual (as seções 11 a 15 são da 0.2) |
| `docs/privacidade-android-0.2.md` | O que mudou para a LGPD na 0.2 (os contatos do celular) |

### Como compilar

O GitHub Actions (`.github/workflows/android.yml`) compila e testa cada push que mexe no Android: os testes do motor no Linux e dos scripts; o PJSIP, o Opus e o Oboe para o Android (em cache); o APK de debug (só a ABI do emulador), com os testes na JVM e num emulador; e o APK de publicação, com as três ABIs (`arm64-v8a`, `armeabi-v7a` e `x86_64`), assinado e conferido pelo `check_apk.py` (16 KB, nenhum "MicroSIP", nomes, versão, certificado e o que o R8 precisa manter). O APK de debug fica como artefato do workflow. Um push só do Android não roda o build do Windows (`paths-ignore` no `build.yml`).

Fora do GitHub (Linux, com o JDK 17, o Android SDK, o NDK e o Gradle das versões de `build/deps.lock`; o projeto não tem Gradle wrapper):

```bash
ANDROID_NDK_ROOT="$ANDROID_HOME/ndk/30.0.16248370" bash build/android/build-deps.sh android-deps   # uma vez; demora
gradle -p android assembleDebug -Pstarsonic.deps="$PWD/android-deps"
```

Propriedades do Gradle: `-Pstarsonic.version=X.Y.Z` ou `X.Y.Z-rc.N` (padrão `0.0.0`), `-Pstarsonic.versionCode=N` (`python3 build/android/version_code.py X.Y.Z` dá o de cada versão) e `-Pstarsonic.abis=x86_64` (padrão: as três). O `assembleRelease` sai assinado com as variáveis de ambiente `STARSONIC_KEYSTORE_FILE`, `STARSONIC_KEYSTORE_PASSWORD`, `STARSONIC_KEY_ALIAS` e `STARSONIC_KEY_PASSWORD`; sem elas, sai sem assinatura.

Testes do motor no Linux:

```bash
bash build/linux/build-pjproject.sh work/pjproject-linux pj-linux   # uma vez
cmake -S tests/phone -B build-phone -DPJPROJECT_PREFIX="$PWD/pj-linux" && cmake --build build-phone && ctest --test-dir build-phone
```

### Como lançar uma versão

O Android tem numeração própria, começando em `0.1.0-rc.1`: `X.Y.Z` (estável) e `X.Y.Z-rc.N` (candidata). O `versionCode` sai da versão (spec 9.4), para que toda versão nova instale por cima da anterior. Quem publica é o workflow `android-release`:

1. **Ensaio (opcional):** no GitHub, Actions → android → Run workflow, com a versão. Roda tudo, inclusive o APK de publicação e o código-fonte completo, sem publicar nada.
2. **Candidata:** crie a tag `android-vX.Y.Z-rc.N` no commit desejado (ou Actions → android-release → Run workflow, com a versão). O workflow compila e testa (o mesmo `android.yml`), publica o pre-release `android-vX.Y.Z-rc.N` e atualiza o pre-release fixo `canal-teste-android`, de onde as rc instaladas recebem a atualização.
3. **Teste manual:** siga o [roteiro](docs/teste-manual-android.md), inclusive a atualização de uma rc para a seguinte.
4. **Estável:** escreva `notas/android-vX.Y.Z.txt` (texto curto mostrado no aviso de atualização) e crie a tag `android-vX.Y.Z`. O workflow publica o release e atualiza o release fixo `canal-android`, de onde as versões estáveis recebem a atualização.

Cada release traz `StarsonicPhone-android-<versão>.apk`, `versao-android.json` (com o SHA-256 do APK, conferido pelo app antes de instalar) e `StarsonicPhone-android-<versão>-codigo-fonte-completo.zip`, que cumpre a GPL: o repositório, o pjproject, o Opus e o Oboe. As notas dos canais apontam para o release da versão, onde está o código-fonte.

Uma publicação roda por vez. O canal só troca por uma versão igual ou mais nova que a dele. Se o job `publicar` falhar no meio (por exemplo, no canal, depois de criar o release), use **Re-run failed jobs** no run: o release que já existe recebe os arquivos de novo, desde que a tag seja do mesmo commit. Um disparo à mão com uma versão cuja tag já existe em outro commit para logo no começo.

**O "latest" do GitHub é do Windows.** O Windows acha o `versao.json` dele pelo release marcado como latest. Os releases do Android saem sempre com `--latest=false`, e no fim o workflow confere que o latest continua sendo uma tag `v…` do Windows (ou que ainda não há latest, enquanto o Windows não tiver versão estável). Não marque um release do Android, nem o `canal-android`, como latest.

O app procura atualizações em `github.com/LucasCPena/starsonic-phone` (fixo em `android/app/src/main/java/br/com/starsonic/phone/update/UpdateDecider.kt`) e só aceita APKs cujo endereço comece com `…/releases/download/android-v`; o workflow recusa publicar em outro repositório.

### Chave de assinatura

Todo APK publicado sai assinado com a mesma chave (spec 9.5). Com outra chave, a versão nova não instala por cima da anterior (cada pessoa teria de desinstalar e instalar de novo), e a mesma chave serve depois para o cadastro no Google e para a Play Store.

- A chave (`starsonic-android.jks`) e a senha **nunca vão para o repositório** (o `.gitignore` recusa `*.jks`, `*.keystore` e `*.p12`). Ficam com o responsável, numa cópia de segurança fora do GitHub, e em dois segredos do repositório (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (o `.jks` em base64, numa linha só: `base64 -w 0 starsonic-android.jks`) e `ANDROID_KEYSTORE_PASSWORD` (a senha do arquivo).
- O alias da chave (`starsonic`) não é segredo e fica fixo no workflow; a senha da chave é a do arquivo (o `.jks` é PKCS12).
- A chave de verdade só é usada nos builds do `main` e das tags `android-v*`. Depois do build, passe ou falhe, um passo apaga a chave decodificada e para o daemon do Gradle.
- No repositório fica só o SHA-256 do certificado, em `build/android/signing-cert.sha256`. O workflow confere que a chave dos segredos é essa e que o APK saiu assinado com ela.
- Sem os segredos, ou em outro branch, o `android.yml` assina o APK de publicação com uma chave de ensaio, criada na hora só para as conferências (esse APK não é guardado), e o `android-release` não publica.
- Se a chave vazar ou se perder, não publique e fale com o responsável: trocar a chave obriga quem já instalou a desinstalar e instalar de novo.

## Segurança

O instalador ainda não é assinado; a integridade das atualizações depende da conta do GitHub (o `versao.json` e o instalador ficam no mesmo lugar). Por isso a conta dona do repositório **precisa ter verificação em duas etapas**, e o acesso de escrita ao repositório deve ficar restrito a quem publica versões.

## Licença

GNU GPL v3 ([LICENSE](LICENSE)). O app novo do Windows (a partir da 0.1.0) usa o PJSIP (GPL v2 ou posterior), o Opus (BSD), a fonte Plus Jakarta Sans (OFL), o Preact (MIT, com o aviso em `ui\assets\preact-LICENSE.txt`) e o WebView2 (licença da Microsoft para o runtime); a tela Sobre traz a licença, esses créditos e o link do código-fonte. A rotina que decifra as senhas da rc.7 na migração vem do MicroSIP, com o aviso de copyright dela. O app antigo (série 0.0.1) é baseado no MicroSIP (© MicroSIP, GPL) e no PJSIP; os avisos de copyright originais ficam no código e no recurso de versão do executável, e a tela Sobre dele traz a atribuição e o link do código-fonte. O app para Android usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD), sai sob a GPL v3, como o Windows, e cada APK publicado vem com o código-fonte completo; a tela Sobre dele traz a licença, o link do código-fonte e os créditos.
