# Starsonic Phone

Softphone da Starsonic para os clientes do PABX em Nuvem. No Windows, é um fork do [MicroSIP](https://www.microsip.org) 3.22.16 com a marca Starsonic, tela Entrar com o endereço do servidor digitado, configurações técnicas de conta e rede travadas, atualização com um clique e instalador por usuário (sem senha de administrador). No Android (etapa 1, APK de teste), é um app próprio com o mesmo motor de ligações (PJSIP) e as mesmas regras: veja a seção [Android](#android). Licença GNU GPL v3.

O que o projeto faz e por quê está na [especificação de design](docs/superpowers/specs/2026-10-11-starsonic-phone-windows-design.md); como foi construído, no [plano de implementação](docs/superpowers/plans/2026-10-11-starsonic-phone-windows.md) e no [plano da revisão 1.2](docs/superpowers/plans/2026-10-13-servidor-digitado.md) (servidor digitado). As seções até "Como trazer uma versão nova do MicroSIP" são do Windows.

## Organização

| Pasta | Conteúdo |
|-------|----------|
| `microsip/` | Código do MicroSIP 3.22.16, idêntico ao oficial exceto pelas edições E1–E14 (tabela no plano), todas de poucas linhas e chamando `starsonic/` |
| `microsip-dist/` | Sons do pacote oficial MicroSIP Lite |
| `starsonic/core/` | Lógica nova em C++14 puro (perfis, travas, tela Entrar, mensagens de erro, arquivo de versão), testada no Linux e no Windows |
| `starsonic/win/` | Integração com o MicroSIP (MFC): tela Entrar, faixa da marca, Sobre, Configurações enxutas, atualizador |
| `branding/` | Nome, URLs, cores, perfil das contas (`perfil.ini`: porta, protocolo padrão, SRTP, codecs e DTMF), tradução pt-BR, ícones (`overlay/`), logos, imagem do instalador (`installer/`) e, em `fontes/`, o logo original e o script que gera os ícones e logos |
| `installer/` | Script do instalador (NSIS) |
| `build/` | Scripts de build, verificação e publicação |
| `tests/` | Testes do núcleo (doctest), dos scripts (Python) e de fumaça no Windows (`smoke/`) |
| `notas/` | Notas de cada versão estável (`vX.Y.Z.txt`), mostradas no aviso de atualização |
| `docs/` | Spec, plano, [notas do build](docs/build-notes.md) e [teste manual](docs/teste-manual.md) |

## Como compilar

O GitHub Actions compila e testa cada push (`.github/workflows/build.yml`) e guarda o executável e o instalador como artefatos do workflow. Para compilar num PC com Windows:

Pré-requisitos: Visual Studio 2022 com "Desenvolvimento para desktop com C++" e "MFC para v143", Git, NSIS 3 e Windows PowerShell 5.1.

```powershell
.\build\Build-Deps.ps1 -WorkDir work      # pjproject 2.17 + vcpkg (uma vez; demora)
.\build\Build-App.ps1 -WorkDir work -Version 0.0.0 -Channel estavel -ProfileFile branding\perfil.ini -OutDir out
.\build\Build-Installer.ps1 -Version 0.0.0 -AppDir out -OutDir dist
```

Testes do núcleo e dos scripts (Linux ou Windows, com CMake e Python 3):

```bash
cmake -S tests -B build-tests && cmake --build build-tests && ctest --test-dir build-tests
python3 -m unittest discover -s tests/python
python3 build/check_source_text.py
python3 build/check_branding.py --repo .
```

Os testes de fumaça da tela Entrar e das travas (`tests/smoke/Test-Login.ps1` e `Test-Policy.ps1`) conferem os valores do `branding/perfil.ini` (porta 5060, UDP como protocolo padrão e codecs) contra um registrador SIP falso que fala UDP e TCP (`tests/smoke/fake_registrar.py`). Ao mudar a porta, o protocolo padrão ou os codecs do perfil, ajuste esses dois testes.

Detalhes e ajustes do build: [docs/build-notes.md](docs/build-notes.md).

## Como lançar uma versão

As versões seguem `X.Y.Z` (estável) e `X.Y.Z-rc.N` (candidata, para teste). Quem publica é o workflow `release`:

1. **Candidata:** crie a tag `vX.Y.Z-rc.N` no commit desejado (ou, no GitHub, Actions → release → Run workflow, com a versão). O workflow compila com o canal de teste, publica o pre-release `vX.Y.Z-rc.N` e atualiza o pre-release fixo `canal-teste`, de onde as rc instaladas recebem a atualização.
2. **Teste manual:** siga o [roteiro](docs/teste-manual.md), inclusive a atualização de uma rc para a seguinte.
3. **Estável:** escreva `notas/vX.Y.Z.txt` (texto curto mostrado no aviso de atualização) e crie a tag `vX.Y.Z`. O workflow só publica se o portão de entradas passar: `python3 build/check_release_inputs.py --repo .` lista o que ainda é provisório (cores, ícones, logos, tradução, imagem do instalador).

Cada release traz `StarsonicPhone-<versão>-setup.exe`, `versao.json` (com o SHA-256 do instalador, conferido pelo app antes de instalar) e `StarsonicPhone-<versão>-codigo-fonte-completo.zip`, que cumpre a GPL: o repositório, o pjproject e o código-fonte das bibliotecas do vcpkg.

O app procura atualizações em `github.com/<STARSONIC_GITHUB_ACCOUNT>/starsonic-phone` (em `branding/branding.h`) e só aceita instaladores que comecem com esse mesmo endereço, letra por letra; o workflow recusa publicar em outro repositório.

**Não transfira o repositório para outra conta sem preparar a mudança.** O GitHub redireciona o endereço antigo, então as versões já instaladas ainda acham o `versao.json` novo. Mas o instalador dele aponta para a conta nova, e essas versões recusam o instalador para sempre. Antes da transferência, é preciso publicar uma versão-ponte que aceite os dois endereços e esperar os clientes atualizarem; isso exige uma mudança no código (`starsonic/win/Updater.cpp`).

## Como mudar o logo ou os ícones

Ícones, logos e imagem do instalador saem de `branding/fontes/gerar_marca.py`, a partir do logo original (`branding/fontes/logo-starsonic.png`). O desenho do ícone e as cores (azul `#383881` e ciano `#3DB1CC`) estão no próprio script.

1. Troque o logo ou ajuste o script.
2. Rode `python3 branding/fontes/gerar_marca.py`. Ele precisa de Python 3 com Pillow, numpy, scipy e Playwright (com o Chromium), que não fazem parte do build.
3. Faça o commit dos arquivos gerados. Se a cor principal mudar, mude também `STARSONIC_BRAND_COLOR` em `branding/branding.h` e as cores conferidas em `tests/smoke/Test-BrandUi.ps1`.

## Como trazer uma versão nova do MicroSIP

1. No GitHub, Actions → importar-microsip → Run workflow, com a versão (ex.: `3.22.17`). O workflow baixa os pacotes oficiais, atualiza `microsip/` e `microsip-dist/` no ramo `upstream`, cria a tag `microsip-<versão>` e abre um PR de `upstream` para `main`.
2. Resolva os conflitos só nas edições E1–E14 (tabela no plano), mantendo cada uma como está descrita, e confira o build verde no PR.
3. Faça o merge com merge commit (não squash): é assim que o workflow sabe, na próxima importação, que a versão já entrou.

## Android

O app para Android (etapa 1: APK de teste, baixado do GitHub) é escrito do zero em Kotlin com Jetpack Compose, sobre o mesmo PJSIP 2.17 e o mesmo núcleo (`starsonic/core`) do Windows. O que ele faz e por quê está na [especificação](docs/superpowers/specs/2026-10-14-starsonic-phone-android-design.md); como foi construído, no [plano](docs/superpowers/plans/2026-10-14-android-etapa-1.md).

### Organização

| Pasta | Conteúdo |
|-------|----------|
| `android/` | Projeto Gradle: o app (Kotlin e Compose), a ponte JNI (`app/src/main/cpp`), os testes na JVM (`app/src/test`) e no emulador (`app/src/androidTest`) |
| `starsonic/phone/` | Motor de ligações em C++ sobre o pjsua2, sem nada de Android (para o iPhone reaproveitar) |
| `tests/phone/` | Testes do motor no Linux, contra o registrador SIP falso (`tests/smoke/fake_registrar.py`) |
| `build/android/` | PJSIP, Opus e Oboe para o Android (`build-deps.sh`), `versionCode` (`version_code.py`), conferência do APK (`check_apk.py`), código-fonte completo (`make_source_bundle.sh`), os scripts dos testes no emulador e o SHA-256 do certificado da chave (`signing-cert.sha256`) |
| `build/linux/` | pjproject para o Linux (os testes do motor) |
| `docs/teste-manual-android.md` | Roteiro do teste manual |

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

Cada release traz `StarsonicPhone-android-<versão>.apk`, `versao-android.json` (com o SHA-256 do APK, conferido pelo app antes de instalar) e `StarsonicPhone-android-<versão>-codigo-fonte-completo.zip`, que cumpre a GPL: o repositório, o pjproject, o Opus e o Oboe.

**O "latest" do GitHub é do Windows.** O Windows acha o `versao.json` dele pelo release marcado como latest. Os releases do Android saem sempre com `--latest=false`, e no fim o workflow confere que o latest continua sendo uma tag `v…` do Windows (ou que ainda não há latest, enquanto o Windows não tiver versão estável). Não marque um release do Android, nem o `canal-android`, como latest.

O app procura atualizações em `github.com/LucasCPena/starsonic-phone` (fixo em `android/app/src/main/java/br/com/starsonic/phone/update/UpdateDecider.kt`) e só aceita APKs cujo endereço comece com `…/releases/download/android-v`; o workflow recusa publicar em outro repositório.

### Chave de assinatura

Todo APK publicado sai assinado com a mesma chave (spec 9.5). Com outra chave, a versão nova não instala por cima da anterior (cada pessoa teria de desinstalar e instalar de novo), e a mesma chave serve depois para o cadastro no Google e para a Play Store.

- A chave (`starsonic-android.jks`, alias `starsonic`) e a senha **nunca vão para o repositório**. Ficam com o responsável, numa cópia de segurança fora do GitHub, e nos segredos do repositório (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (o `.jks` em base64, numa linha só: `base64 -w 0 starsonic-android.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`.
- No repositório fica só o SHA-256 do certificado, em `build/android/signing-cert.sha256`. O workflow confere que a chave dos segredos é essa e que o APK saiu assinado com ela.
- Sem os segredos, o `android.yml` assina o APK de publicação com uma chave de ensaio, criada na hora só para as conferências (esse APK não é guardado), e o `android-release` não publica.
- Se a chave vazar ou se perder, não publique e fale com o responsável: trocar a chave obriga quem já instalou a desinstalar e instalar de novo.

## Segurança

O instalador ainda não é assinado; a integridade das atualizações depende da conta do GitHub (o `versao.json` e o instalador ficam no mesmo lugar). Por isso a conta dona do repositório **precisa ter verificação em duas etapas**, e o acesso de escrita ao repositório deve ficar restrito a quem publica versões.

## Licença

GNU GPL v3 ([LICENSE](LICENSE)). O Starsonic Phone é baseado no MicroSIP (© MicroSIP, GPL) e no PJSIP; os avisos de copyright originais ficam no código e no recurso de versão do executável, e a tela Sobre traz a atribuição e o link do código-fonte. O app para Android usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD), sai sob a GPL v3, como o Windows, e cada APK publicado vem com o código-fonte completo; a tela Sobre dele traz a licença, o link do código-fonte e os créditos.
