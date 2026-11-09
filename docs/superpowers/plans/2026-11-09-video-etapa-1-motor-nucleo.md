# Videochamada, etapa 1 — o motor e o núcleo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Starsonic Phone para Windows ganha a videochamada por dentro, sem nenhuma tela nova. Entram:
- a PJSIP com vídeo;
- as ligações com vídeo;
- a imagem até a memória que a página vai ler;
- as câmeras;
- o módulo H.264 da Cisco;
- o grande e a tela cheia;
- a pausa na tela bloqueada;
- a ponte nova.

As telas são da etapa 2, depois do quadro aprovado.

**Architecture:**
- **O motor** (`starsonic/phone`, PJSIP 2.17 com o pjsua2) liga o vídeo:
  - a câmera é o DirectShow no Windows e a câmera de teste da PJSIP no Linux dos testes;
  - o VP8 e o VP9 vêm da libvpx;
  - o H.264 vem do OpenH264: no Windows, o módulo da Cisco, por um adaptador; no Linux dos testes, o do sistema.
  - Um dispositivo de saída nosso entrega cada quadro a um `FrameSink`.
- **O núcleo portátil** (`starsonic/desktop`):
  - guarda as escolhas do cartão Vídeo, a câmera e a chave da pessoa;
  - cuida do módulo da Cisco (`H264Module`);
  - fala a ponte nova.
- **O executável** (`windows/app/src`):
  - escreve os quadros na memória dividida do WebView2 (`FrameBuffer`, `VideoSink`);
  - cresce a janela e põe a tela cheia;
  - pausa a câmera na tela bloqueada;
  - roda o download da Cisco.
- **Os testes:**
  - os do motor rodam no Linux, com o registrador falso em Python, que ganha o vídeo;
  - o código só do Windows é conferido pela compilação, pelos testes do desktop no Windows e pela fumaça do CI do Windows.

**Tech Stack:**
- C++17 com doctest e nlohmann/json.
- PJSIP 2.17 (pjsua2 e a API C da pjmedia).
- A libvpx: a porta do vcpkg no Windows e a `libvpx-dev` no Linux.
- A API do OpenH264 2.6.0. O binário vem da Cisco no Windows, e o `libopenh264-dev` é usado só nos testes do Linux.
- O bzip2.
- O WebView2 SDK 1.0.4258.31, com o `ICoreWebView2Environment12::CreateSharedBuffer` e o `ICoreWebView2_17::PostSharedBufferToScript`.
- No Win32: o DirectShow, pela PJSIP; o WTS; o WinHTTP; o registro.
- O Python 3 do registrador falso.

**Spec:** `docs/superpowers/specs/2026-11-09-starsonic-phone-video-design.md`.
- Para esta etapa valem estas seções:
  - 4.2;
  - 4.3, no lado do núcleo;
  - 6, 7, 9 e 11.1;
  - 11.2, no motor, no núcleo e no Windows;
  - 12, a etapa 1.
- As telas (4.1, 4.4 e os textos da 10 que não são avisos) são da etapa 2.
- O contrato da ponte é o `docs/ponte-windows.md`. As Tasks 4, 6 e 7 escrevem nele a seção nova, "A videochamada (0.3.0)".

## Global Constraints
- **Nenhuma tela nova.** O `windows/ui` não muda nesta etapa. Os avisos aparecem pelo toast que já existe.
- **O Android continua sem vídeo.**
  - O `build/android/config_site.h` não muda.
  - Todo código de vídeo do `SipEngine` fica atrás de `#if PJMEDIA_HAS_VIDEO`.
  - Sem o vídeo, os métodos de vídeo devolvem -1, `false` ou vazio, e o `OnCallVideo` nunca sai.
- **O motor do iPhone (baresip) também não tem vídeo.** Os métodos novos devolvem -1, `false` ou vazio, e na plataforma iPhone o núcleo põe `video.ligado` em `false` e ignora os pedidos de vídeo.
- **A qualidade:**

  | Qualidade | Imagem | Quadros por segundo | Taxa |
  | --- | --- | --- | --- |
  | Baixa (`Low`) | 320×240 | 15 | 300 kbit/s |
  | Média (`Medium`, padrão) | 640×480 | 25 | 800 kbit/s |
  | Alta (`High`) | 1280×720 | 30 | 1500 kbit/s |

- **O H.264:** Constrained Baseline, `profile-level-id=42e01f`, `packetization-mode=1`.
- **Os codecs de fábrica:** o H.264 e o VP8 ligados, o VP9 desligado, e o H.264 primeiro.
- **Os Porteiros:** até 20 ramais, cada um com 1 a 15 dígitos, só dígitos e sem repetir.
- **O OpenH264:**
  - a versão é a 2.6.0;
  - o binário da Cisco fica em `http://ciscobinary.openh264.org/openh264-2.6.0-win32.dll.bz2`;
  - o arquivo é gravado em `%LOCALAPPDATA%\Starsonic Phone\codecs\openh264-2.6.0-win32.dll`;
  - o download desiste em 60 s, aceita até 4 MiB comprimidos e até 8 MiB descomprimidos;
  - o instalador e o `.exe` nunca levam o código do H.264, e o vcpkg nunca tem a porta `openh264`.
- **O HTTP sem TLS** só vale para o endereço exato do binário da Cisco, sem redirecionamento. O arquivo só é usado depois de conferido pelas duas impressões digitais (SHA-256) fixadas no `deps.lock` e no `OpenH264Pin.h`. O módulo é carregado pelo caminho completo, e a impressão é conferida a cada abertura do app.
- **A câmera nunca liga sozinha.** Só ligam a câmera:
  - o `dial` ou o `answer` com `"video": true`;
  - o `camera` com `"on": true`;
  - o `cameraTest` com `"on": true`.
- **Antes do atender, nada sai de quem atende:** nenhum pacote de vídeo, e o microfone fora da ligação (o `AudioLinks` vazio). Vale também no 183 dos Porteiros.
- **O diagnóstico** nunca leva imagem, mensagem, nome de arquivo nem nome de pessoa. As linhas novas são exatamente estas:
  - `video: <codec> <largura>x<altura> <qps> qps, envio ligado|desligado`;
  - `camera: falhou (<código>)`;
  - `h264: instalado <versão>`;
  - `h264: download falhou (<código>)`;
  - `h264: arquivo nao confere, apagado`.

  As duas primeiras saem do motor pelo `OnLog` e chegam ao diagnóstico com o prefixo de hoje (`motor 3: video: ...`). As do `h264:` vão direto.
- **Os avisos (toasts), com o texto exato:** estão em "Os textos desta etapa", mais abaixo.
- **O grande:** 1280×800 pontos lógicos, ou a área de trabalho do monitor se ela for menor, no centro do monitor da janela.
- **A página recebe** até 1920×1080 por quadro (um maior é reduzido antes) e no máximo 30 quadros por segundo por vista (o crédito da Task 8).
- **Os testes:**
  - os testes novos do motor rodam no Linux (`tests/phone`, no job do Linux do `android.yml`);
  - o código só do Windows é conferido pela compilação, pelos testes do desktop no Windows e pela fumaça do `build.yml`;
  - os nomes dos testes ficam em inglês, como os de hoje;
  - os comentários e os documentos ficam em português, no estilo de cada arquivo. O `starsonic/desktop` e o `windows/app/src` são escritos sem acento.
- **Os commits** levam os trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`. O push vai para o `main`, sem force e sem tags, releases ou segredos. O repositório é público.
- **No CI, use só o `gh api` REST.** O GraphQL está bloqueado.

## Review Focus
1. **Uma imagem que muda de tamanho no meio,** como o porteiro que troca de resolução ou o telefone que gira. A vista continua com o tamanho novo, sem travar nem cair. Testes: a Task 3 ("the renderer follows a size change") e a Task 4 ("a size change keeps working").
2. **A imagem de uma ligação na vista de outra:** com duas ligações com vídeo, e com um quadro atrasado de uma ligação que já acabou. A imagem só vai para a vista da sua ligação, e a pausada não manda nem mostra nada. Testes: a Task 3 ("two video calls keep their frames apart and the paused one shows nothing") e a Task 8 ("a frame of an unknown or ended call goes nowhere").
3. **O app fechando no meio de uma ligação com vídeo.** Nenhum quadro chega ao `FrameSink` depois que o `SetFrameSink(nullptr)` volta, nenhum é escrito depois do `VideoSink::Close()`, e nada cai. Testes: a Task 3 ("no frame reaches the sink after SetFrameSink(nullptr)") e a Task 8 ("after Close no frame is written").
4. **Um download da Cisco errado ou hostil:** a impressão errada, o arquivo cortado, grande demais, a resposta 3xx ou o tempo esgotado. O módulo nunca é carregado, o arquivo é apagado, e a situação fica "falhou". Testes: a Task 5.
5. **O navegador refeito, ou a página recarregada, com a imagem chegando.** A memória velha nunca é escrita depois de largada, e cada vista à vista ganha a sua de novo. Testes: a Task 8 ("a browser restart drops the memories and creates new ones" e "a page reload posts the memories again").

## As pastas e as responsabilidades
- **`starsonic/phone/Video.h` e `Video.cpp`:** os tipos portáteis do vídeo. São a qualidade, as escolhas, a ordem dos codecs, os Porteiros, o vídeo de uma ligação, as câmeras, os problemas da câmera, o quadro I420 e o `FrameSink`. Nada de PJSIP aqui.
- **`starsonic/phone/SipEngine.*`, `EngineCall.*`, `EngineEvents.h`:** o vídeo no motor, com a sinalização, o envio, as pausas, o 183 dos Porteiros, as câmeras e a prévia.
- **`starsonic/phone/VideoRenderer.*`:** o dispositivo de saída nosso, uma `pjmedia_vid_dev_factory` chamada "Starsonic". Fica vazio sem o `PJMEDIA_HAS_VIDEO`.
- **`starsonic/phone/CallEngine.*` e `CallController.*`:** as ligações com vídeo para a ponte, o 488 e o 415 que viram voz, e a recusa do vídeo.
- **`starsonic/desktop/Admin.*`, `Stores.*`, `Protocol.*`, `DesktopApp.*`:** o cartão Vídeo, a câmera e a chave da pessoa, os pedidos e o estado novos, e os avisos.
- **`starsonic/desktop/H264Module.*` e `OpenH264Pin.h`:** o módulo da Cisco, com a conferência, o download, a descompressão e a gravação. É portátil.
- **`windows/app/src/FrameBuffer.*`:** a memória de uma vista, com o cabeçalho e os dois lugares, e a redução de um quadro grande. É portátil.
- **`windows/app/src/FrameRouter.*` e `VideoSink.*`:** quem recebe cada quadro, a criação das memórias na thread da janela e a escrita nelas. São portáteis, e a parte do WebView2 fica atrás de uma interface.
- **`windows/app/src/WebViewSharedBuffers.*`, `CameraPrivacy.*`, `OpenH264Shim.*`, `Bunzip.*`:**
  - a memória dividida do WebView2;
  - a privacidade da câmera no registro;
  - o adaptador do módulo da Cisco;
  - o bzip2.

  O `Bunzip` e a decisão da `CameraPrivacy` são portáteis.
- **`windows/app/src/ShellState.*`:** o estado da ponte que o executável lê ganha os ids da ligação de cima e da que toca.
- **`windows/app/src/EngineHost.*`:** o motor para o núcleo, com os pedidos e os eventos novos.
- **`windows/app/src/MainWindow.*`, `WindowFit.*`, `main.cpp`:** o grande, a tela cheia, a tela bloqueada, as câmeras que entram e saem, e a ligação de tudo.
- **`starsonic/win/Http.*`:** o `HttpGetPinned`, o GET sem TLS só para o binário da Cisco.
- **`starsonic/third_party/openh264/`:** a API do OpenH264 2.6.0 (os quatro cabeçalhos), a licença BSD e o texto da licença do binário da Cisco.
- **`tests/smoke/fake_registrar.py`:** o vídeo no registrador falso, com a contagem, o eco, a gravação e a reprodução dos pacotes.
- **`build/`, `.github/workflows/`, `docs/`:** a compilação com vídeo, a conferência da Cisco no CI, as notas e a ponte.

## A ponte nova (o resumo; o texto completo vai para o `docs/ponte-windows.md`)
**Pedidos (da interface para o núcleo):**
- `{"v":1,"cmd":"dial","numero":"2003","video":true}`. O `"video"` é opcional e vale `false` se faltar. Ele também vale no `dial` com `"contato":true`.
- `{"v":1,"cmd":"answer","video":true}`, com o `"video"` opcional.
- `{"v":1,"cmd":"camera","on":true}`: a câmera da ligação de cima.
- `{"v":1,"cmd":"setVideo","camera":"<nome>","h264":true}`, com os dois campos opcionais. A `"camera"` vazia quer dizer a primeira câmera.
- `{"v":1,"cmd":"cameraTest","on":true}`. A imagem do teste vai na vista `local`.
- `{"v":1,"cmd":"videoViews","pagina":"principal","vistas":["remoto","local"]}`. A página `"principal"` só tem `remoto` e `local`: o teste da câmera também usa a `local`, porque é a mesma imagem. A página `"aviso"` só tem `porteiro`.
- `{"v":1,"cmd":"videoWindow","modo":"grande"}`, com o modo `normal`, `grande` ou `telaCheia`.
- `{"v":1,"cmd":"h264Retry"}`.
- O `adminSet` ganha estes campos:
  - `videoH264`, `videoVp8` e `videoVp9`, booleanos;
  - `videoPrimeiro`: `h264`, `vp8` ou `vp9`;
  - `videoQualidade`: `baixa`, `media` ou `alta`;
  - `porteiros`: uma lista de textos.

**Estado (do núcleo para a interface):**
- **Na ligação:** `ligacao.top.video` e `ligacao.second.video` são `{"oferece":b,"ativo":b,"imagem":b,"camera":b,"cedo":b}`, os campos do `CallVideo` na ordem `offered`, `active`, `remote`, `camera` e `early`.
- **O bloco `video`:**
  ```json
  {"ligado":true,"cameras":["Integrated Camera"],"camera":"","cameraDesconectada":false,"teste":false,
   "h264":{"cartao":true,"pessoa":true,"situacao":"instalado"},"janela":"normal"}
  ```
  A `situacao` é `desligado`, `baixando`, `instalado` ou `falhou`.
- **A área do administrador aberta** ganha os campos do `adminSet` acima.

**A memória do vídeo:**
- Cada vista é uma memória dividida do WebView2, só de leitura para a página, que chega com o `additionalDataAsJson` `{"v":1,"type":"videoBuffer","vista":"remoto","bytes":<n>}`.
- A página recebe a memória de uma vista quando ela fica à vista pela primeira vez, e de novo depois de cada recarregar da página e de cada navegador refeito. Uma memória nova da mesma vista troca a velha.
- O formato está na Task 4.

## Os textos desta etapa (os avisos; o texto exato)
- `Nenhuma câmera encontrada.`
- `A câmera está sendo usada por outro programa.`
- `A câmera foi desconectada.`
- `O Windows bloqueou a câmera para este app. Libere em Configurações do Windows → Privacidade e segurança → Câmera.`
- `A outra ponta não aceitou o vídeo.`
- `Este vídeo precisa do H.264, que ainda não foi baixado.`

## Como rodar os testes
- **O motor, no Linux:**
  ```bash
  sudo apt-get install -y libvpx-dev libopenh264-dev
  bash build/linux/build-pjproject.sh work/pjproject-linux pj-linux
  cmake -S tests/phone -B build-phone -DPJPROJECT_PREFIX="$PWD/pj-linux" && cmake --build build-phone -j 8 && ctest --test-dir build-phone --output-on-failure
  ```
- **O registrador e os scripts:** `python3 -m unittest discover -s tests/python` e `python3 -m unittest tests/smoke/test_fake_registrar.py`.
- **O núcleo do desktop:**
  ```bash
  sudo apt-get install -y libbz2-dev
  cmake -S tests/desktop -B build-desktop -G Ninja && cmake --build build-desktop -j 8 && build-desktop/desktop_tests
  ```
- **A suíte do núcleo** (`tests`) e o motor baresip rodam como no job "Testes do núcleo (Linux)" do `build.yml`.
- **O CI** é conferido com `gh api "repos/LucasCPena/starsonic-phone/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'`. O `build` e o `android` precisam ficar verdes.

---

### Task 1: O vídeo compilado (o Linux dos testes e o Windows)

**Files:**
- Modify: `build/linux/config_site.h`. O `PJMEDIA_HAS_VIDEO` passa a 1. A câmera de teste da PJSIP, que vem ligada por padrão, é a câmera dos testes.
- Modify: `build/linux/build-pjproject.sh`.
  - O `configure` deixa de ter o `--disable-video` e o `--disable-libyuv`.
  - Ele ganha `--enable-video --with-vpx=/usr --with-openh264=/usr --disable-sdl --disable-ffmpeg --disable-v4l2`.
  - O comentário do topo também muda.
- Modify: `.github/workflows/android.yml`. O passo que instala os pacotes do job do Linux ganha `libvpx-dev libopenh264-dev`.
- Modify: `build/config_site.h` (o Windows), com estes valores:
  - `PJMEDIA_HAS_VIDEO 1`;
  - `PJMEDIA_VIDEO_DEV_HAS_DSHOW 1`;
  - `PJMEDIA_VIDEO_DEV_HAS_SDL 0`;
  - `PJMEDIA_VIDEO_DEV_HAS_CBAR_SRC 0`: sem a câmera de teste, que apareceria na lista das câmeras;
  - `PJMEDIA_HAS_FFMPEG 0`;
  - `PJMEDIA_HAS_VPX_CODEC 1`;
  - `PJMEDIA_HAS_VPX_CODEC_VP9 1`;
  - `PJMEDIA_HAS_OPENH264_CODEC 1`;
  - `PJMEDIA_HAS_LIBYUV 1`.
- Modify: `build/deps.lock` (a porta `libvpx` no vcpkg e o bloco `"openh264": {"version": "2.6.0"}`) e `tests/python/test_deps_lock.py`.
- Modify: `build/Build-Deps.ps1`. O `CL` da PJSIP ganha o `/I` de `starsonic/third_party/openh264/include`.
- Modify: `windows/app/CMakeLists.txt`.
  - O link ganha a libvpx do vcpkg (a PJSIP pede o `vpx.lib` por `#pragma comment`), o `strmiids`, o `ole32` e o `oleaut32`, ou o que a DirectShow da PJSIP pedir.
  - O link ganha o `/NODEFAULTLIB:openh264.lib`. O `openh264.cpp` da PJSIP pede o `openh264.lib` por `#pragma comment`, mas as quatro funções vêm do adaptador.
  - Entra o `src/OpenH264Shim.cpp`.
- Create: `starsonic/third_party/openh264/include/wels/codec_api.h`, `codec_app_def.h`, `codec_def.h` e `codec_ver.h`, copiados sem mudança da tag `v2.6.0` de `cisco/openh264`.
- Create: `starsonic/third_party/openh264/LICENSE` (o BSD-2 do OpenH264).
- Create: `starsonic/third_party/openh264/README.md`. Ele diz de onde vieram os cabeçalhos e que só a API entra no repositório.
- Create: `windows/app/src/OpenH264Shim.h` e `OpenH264Shim.cpp`, só do Windows.
- Modify: `starsonic/phone/SipEngine.h`, `SipEngine.cpp` e `starsonic/phone/baresip/SipEngineBaresip.cpp`.
- Create: `tests/phone/test_engine_video.cpp`, que entra no `tests/phone/CMakeLists.txt`.
- Modify: `docs/build-notes.md`, com uma seção "O vídeo" que diz:
  - o que cada opção faz;
  - por que não entram o SDL e o FFmpeg;
  - que o Android segue sem vídeo;
  - de onde vêm os cabeçalhos do OpenH264.

**Interfaces:**
- Produces: `std::vector<std::string> SipEngine::VideoCodecs() const;`
  - Devolve os ids dos codecs de vídeo ligados (com prioridade maior que zero), na ordem de prioridade, como o `ActiveCodecs` da voz. Exemplos: `"H264/97"`, `"VP8/100"`.
  - Fica vazio sem o `PJMEDIA_HAS_VIDEO` e no motor baresip.
- Produces (só no Windows, em `OpenH264Shim.h`): `bool LoadOpenH264(const std::wstring& dllPath, std::string* error);` e `bool OpenH264Loaded();`.
  - O `LoadOpenH264` carrega o módulo com o `LoadLibraryExW`, pelo caminho completo, e pega com o `GetProcAddress` as quatro funções que a PJSIP chama: `WelsCreateSVCEncoder`, `WelsDestroySVCEncoder`, `WelsCreateDecoder` e `WelsDestroyDecoder`.
  - Uma segunda chamada com o módulo já carregado devolve `true` sem carregar de novo.
  - O adaptador exporta essas quatro funções, com as assinaturas e o `extern "C"` do `codec_api.h` 2.6.0, e repassa as chamadas ao módulo.
  - Sem o módulo carregado, as duas `Create` devolvem 1 e deixam o ponteiro nulo, e as duas `Destroy` não fazem nada.
  - O adaptador não confere a impressão do arquivo: quem chama confere antes (Task 8).

- [ ] **Step 1: Escreva o teste que falha.** Use em `tests/phone/test_engine_video.cpp` o mesmo jeito de criar o motor que os outros testes do `tests/phone` usam (o `Phone` do `call_fixture.h`).

```cpp
TEST_CASE("the video build offers H264 and VP8") {
    const std::vector<std::string> codecs = engine.VideoCodecs();
    auto has = [&](const std::string& prefix) {
        return std::any_of(codecs.begin(), codecs.end(), [&](const std::string& id) { return id.rfind(prefix, 0) == 0; });
    };
    CHECK(has("H264/"));
    CHECK(has("VP8/"));
}
```

- [ ] **Step 2: Rode o teste e veja ele falhar.** Rode o motor no Linux ("Como rodar os testes"). Esperado: a compilação falha, porque o `VideoCodecs` não existe.
- [ ] **Step 3: Implemente.** Faça a compilação com vídeo no Linux e o `VideoCodecs` (pelo `pjsua_vid_enum_codecs`), com o stub no baresip.
- [ ] **Step 4: Rode a suíte inteira do motor e os scripts.** Esperado: tudo passa, inclusive o teste novo.
- [ ] **Step 5: Faça o Windows com vídeo.** Entram o `config_site.h`, o `deps.lock`, o `Build-Deps.ps1`, os cabeçalhos, o adaptador e o link do app.
  - O `test_deps_lock.py` ganha estes testes:
    - `test_vcpkg_has_libvpx_and_never_openh264`;
    - `test_openh264_version_is_2_6_0`.
  - Rode `python3 -m unittest discover -s tests/python`. Esperado: passa.
- [ ] **Step 6: Faça o commit e o push.**

```bash
git add build .github/workflows/android.yml starsonic/third_party/openh264 windows/app starsonic/phone tests/phone tests/python docs/build-notes.md
git commit -m "build(video): a PJSIP com o vídeo no Windows e no Linux dos testes, e o adaptador do OpenH264"
git push origin main
```

- [ ] **Step 7: Confira o CI.**
  - O `build` precisa ficar verde, e o job do Windows precisa compilar o app com o vídeo.
  - A fumaça do app instalado precisa passar.
  - O `android` precisa ficar verde: o NDK sem vídeo, e o job do Linux com os testes do motor.
  - Se o Windows não compilar a DirectShow da PJSIP (a `third_party/BaseClasses`) ou não achar o `vpx.lib`, corrija o projeto ou o link até ficar verde. Registre no relatório o que foi preciso.

### Task 2: O motor: as ligações com vídeo (a sinalização e o envio)

**Files:**
- Create: `starsonic/phone/Video.h` e `Video.cpp`. O `Video.cpp` entra em todo lugar que compila um `SipEngine` (o da PJSIP e o do baresip) e também nos testes do desktop.
- Modify: `starsonic/phone/SipEngine.h`, `SipEngine.cpp`, `EngineCall.h`, `EngineCall.cpp`, `EngineEvents.h` e o motor baresip.
- Modify: `tests/smoke/fake_registrar.py` e `tests/python/test_fake_registrar.py`.
- Modify: `tests/phone/registrar_fixture.h` (o registrador e o `RecordingListener`) e `tests/phone/call_fixture.h` (o `Phone`).
- Test: `tests/phone/test_engine_video.cpp` e `tests/phone/test_video_types.cpp`, para o `Video.cpp`.

**Interfaces:**
- Produces (`Video.h`):

```cpp
enum class VideoCodec { H264, Vp8, Vp9 };
enum class VideoQuality { Low, Medium, High };
struct QualityValues { int width; int height; int fps; int kbps; };
QualityValues ValuesOf(VideoQuality quality);              // os valores das Global Constraints
struct VideoSettings {
    bool h264 = true;
    bool vp8 = true;
    bool vp9 = false;
    VideoCodec first = VideoCodec::H264;
    VideoQuality quality = VideoQuality::Medium;
    bool h264Available = false;                // o módulo carregado (Windows) ou o OpenH264 do sistema (testes)
    std::vector<std::string> doorphones;       // os Porteiros, só dígitos
};
std::vector<VideoCodec> CodecOrder(const VideoSettings& settings);
bool VideoEnabled(const VideoSettings& settings);          // !CodecOrder(settings).empty()
bool IsDoorphone(const VideoSettings& settings, const std::string& user);   // compara só os dígitos
struct CallVideo {
    bool offered = false;   // a recebida oferece vídeo com um codec em comum
    bool active = false;    // o vídeo negociado e a ligação sem pausa
    bool remote = false;    // a imagem da outra ponta chegando (Task 3; sempre false nesta task)
    bool camera = false;    // a nossa câmera mandando agora
    bool early = false;     // o 183 com SDP de um Porteiro, até o atender ou o fim
    bool refused = false;   // só no evento de uma recusa do vídeo (as regras abaixo)
};
bool operator==(const CallVideo& a, const CallVideo& b);
```

- `CodecOrder` devolve os codecs ligados e disponíveis. O H.264 só entra com `h264Available`. O `first` vem na frente, se estiver ligado e disponível; os outros seguem a ordem H.264, VP8, VP9.
- Produces (`SipEngine`). As formas antigas `MakeCall(number)` e `Answer(callId)` continuam (o Android as usa) e chamam as novas com `false`.

```cpp
int MakeCall(const std::string& number, bool video);
bool Answer(int callId, bool video);
bool SetCamera(int callId, bool on);          // o desejo da pessoa para essa ligação
void SetCameraPaused(bool paused);            // a tela bloqueada
void SetVideoSettings(const VideoSettings& settings);
CallVideo Video(int callId) const;            // CallVideo{} para um id desconhecido
```

- Produces: o `EngineConfig` ganha `bool h264Available = false;`, o valor inicial do `VideoSettings::h264Available`.
- Produces: o `EngineListener` ganha `virtual void OnCallVideo(int callId, const CallVideo& video) {}`.
  - Ele sai na thread de eventos do motor, a cada mudança de um campo.
  - O `refused` sai uma vez por recusa.
  - Numa recebida com vídeo, ele sai logo depois do `OnIncomingCall`, com o `offered` ou com o `refused` (as regras abaixo).

**As regras** (a spec 4.2 e 6.2):
- **As escolhas no começo:** no Create, antes de qualquer ligação, o motor aplica o `VideoSettings` de fábrica, com o `h264Available` do `EngineConfig`. Um codec fora do `CodecOrder` fica com a prioridade 0 na PJSIP, e ela nunca o oferece nem o aceita. É assim que o H.264 fica de fora sem o módulo, embora a PJSIP registre o codec no início.
- **O `MakeCall(n, false)`** não oferece `m=video`, como hoje.
- **O `MakeCall(n, true)`:**
  - Com o `VideoEnabled`, a oferta usa `vid_cnt=1` e liga o desejo da câmera.
  - Depois da confirmação, com o `m=video` aceito, a câmera começa a mandar: o `START_TRANSMIT`, com `camera=true`.
  - Se a resposta recusa o vídeo (a porta 0), a ligação segue, e sai um evento com `refused=true` e `active=false`.
  - Sem o `VideoEnabled`, ele é igual ao `MakeCall(n, false)`, e sai logo um evento com `refused=true`.
- **Na recebida que oferece vídeo** (um `m=video` com a porta diferente de zero):
  - **Com um codec em comum:** sai o evento com `offered=true`. Se, além disso, o `IsDoorphone(usuário do From)` vale, o motor responde 183 com o SDP (`vid_cnt=1`, sem mandar nada) no lugar do 180, e sai o evento com `early=true`.
  - **Sem nenhum codec em comum** (por exemplo, só o H.264, sem o módulo): o `offered` fica `false`, sai o evento com `refused=true`, e o atender responde sem o vídeo.
- **O `Answer(id, false)`** responde 200 com `vid_cnt` igual a 1 se a ligação oferece vídeo e o `VideoEnabled` vale, e 0 se não. Ele não manda imagem.
- **O `Answer(id, true)`** é igual, mas liga o desejo da câmera e começa a mandar.
- **O `SetCamera(id, on)`:**
  - grava o desejo da pessoa;
  - numa ligação sem vídeo ativo, com `on`, ele faz um re-INVITE que acrescenta o vídeo (`PJSUA_CALL_VID_STRM_ADD`), e uma recusa sai como `refused`;
  - numa ligação com vídeo, ele faz `START_TRANSMIT` ou `STOP_TRANSMIT`, sem re-INVITE;
  - devolve `false` para um id desconhecido;
  - sem o `VideoEnabled`, ele devolve `false` e, com o `on`, sai um evento com `refused=true`.
- **A pausa (uma ligação com vídeo por vez):** uma ligação fica pausada nestes casos:
  - na nossa espera;
  - quando há duas ligações e ela não é a ativa, também a segunda ainda tocando, mesmo de um Porteiro;
  - na conferência;
  - com uma transferência pedida ainda sem resultado (do `Transfer` até o `OnTransfer`).

  Na pausa: `STOP_TRANSMIT`, `camera=false` e `active=false`. Ao sair da pausa, o `active` volta, e a câmera segue o desejo.
- **Os re-INVITE de hoje** (a espera e a retomada) mantêm o vídeo da ligação: a oferta nova leva o mesmo número de vídeos.
- **O `SetCameraPaused(true)`** faz `STOP_TRANSMIT` em todas as ligações. O `false` devolve a cada ligação sem pausa o seu desejo.
- **O `SetVideoSettings`:**
  - aplica as prioridades: na ordem do `CodecOrder`, 255, 254 e 253, e 0 nos outros;
  - aplica a qualidade: o tamanho, os quadros por segundo e a taxa do codificador de cada codec, e o `rateControlBandwidth` da conta igual a `kbps × 1000`;
  - aplica o fmtp do H.264 (`profile-level-id=42e01f`, `packetization-mode=1`);
  - aplica os Porteiros.

  Tudo isso vale para as próximas ofertas e respostas.
- **A conta** fica com `autoShowIncoming=true` e `autoTransmitOutgoing=false`.
- **O log:** a cada vídeo que começa e a cada mudança de envio, o motor manda pelo `OnLog` (nível 3) a linha `video: <H264|VP8|VP9> <largura>x<altura> <qps> qps, envio ligado|desligado`, com o tamanho e os quadros por segundo do codificador da ligação (os da qualidade).

**O registrador falso** (`tests/smoke/fake_registrar.py`):
- **O `--video-port PORTA`:** um socket UDP em `127.0.0.1:PORTA`. Ele conta os datagramas com carga (mais de 12 bytes, o cabeçalho do RTP), de qualquer ligação. O fixture passa uma porta livre.
- **A resposta a um INVITE do telefone com um `m=video` de porta diferente de zero:**
  - o `m=video` vai na PORTA, com a primeira carga da oferta cujo nome no `a=rtpmap` é H264, VP8 ou VP9, copiando o `a=rtpmap` e o `a=fmtp` dela, e com `a=sendrecv`;
  - o log ganha `video-in <alvo> <nomes>`, com os nomes da oferta na ordem e sem repetir, separados por vírgula (`H264,VP8`);
  - um INVITE sem vídeo, ou com a porta 0, gera `video-in <alvo> nao`.
- **Um re-INVITE do telefone** gera `video-reinv <alvo> <nomes|nao>` e segue as mesmas regras da resposta.
- **As respostas do telefone com SDP** a um `RING` ou a um `RINGVIDEO` geram `sdp-out <ramal> <código> video=<sim|nao>`. O `sim` quer dizer um `m=video` com porta diferente de zero.
- **Os comandos de controle novos:**
  - `VIDEO REJECT on|off`: o `m=video` da resposta vai com a porta 0;
  - `VIDEO 488 on|off`: um INVITE com vídeo leva 488, e um sem vídeo segue como hoje;
  - `VIDEO ECHO on|off`: cada datagrama que chega na PORTA volta na hora para o endereço de onde veio, com o SSRC trocado (o bit mais baixo do último byte do SSRC invertido). A contagem continua;
  - `VIDEO PACKETS`: responde uma linha com a contagem;
  - `VIDEO PACKETS reset`: zera a contagem e responde `OK`;
  - `VIDEO SDP`: responde as linhas do último SDP que o telefone mandou, terminadas em `END`;
  - `RINGVIDEO <ramal> <de> [<codecs>]`: igual ao `RING`, mas com `<de>` como o usuário do From. O INVITE também oferece um `m=video` na PORTA, com `a=sendrecv` e os codecs da lista (separados por vírgula; o padrão é `H264,VP8`):
    - o `H264/90000` vai na carga 97, com `a=fmtp:97 profile-level-id=42e01f;packetization-mode=1`;
    - o `VP8/90000` vai na carga 100.
- **Os testes Python** cobrem cada comando novo e cada linha nova do log.
- **O fixture:**
  - o registrador (`registrar_fixture.h`) ganha:
    - `int VideoPackets() const`;
    - `void ResetVideoPackets()`;
    - `bool WaitForVideoPackets(int atLeast, int seconds)`;
    - `bool VideoPacketsStay(int seconds)`: a contagem não muda na janela;
    - `std::string VideoSdp()`.
  - o `RecordingListener` guarda cada `OnCallVideo` (o id e o `CallVideo`, em ordem), com:
    - `CallVideo LastVideo(int callId) const`, que dá o `CallVideo{}` sem evento;
    - `int RefusedCount(int callId) const`;
    - `bool WaitForVideo(int callId, std::function<bool(const CallVideo&)> condition, int seconds)`.
  - o `Phone` (`call_fixture.h`) ganha `int RingVideo(const std::string& from, const std::string& codecs = "H264,VP8")`. Como o `Ring()`, ele manda o `RINGVIDEO 2001 <from> <codecs>` e devolve o id que o motor deu à ligação.

- [ ] **Step 1: Escreva os testes que falham.** No `test_video_types.cpp`:
  - `"ValuesOf gives the spec's three qualities"`: `ValuesOf(VideoQuality::Medium)` dá `{640,480,25,800}`, e o mesmo para as outras duas.
  - `"CodecOrder puts the first codec ahead and drops the off and unavailable ones"`, com quatro casos:
    - o padrão com `h264Available` dá `{H264, Vp8}`;
    - `first=Vp8, vp9=true` dá `{Vp8, H264, Vp9}`;
    - `h264Available=false` dá `{Vp8}`;
    - tudo desligado dá vazio, e o `VideoEnabled` fica `false`.
  - `"IsDoorphone compares only the digits"`: com `{"9001"}`, o `"9001"` dá true e o `"9002"` dá false.

  No `test_engine_video.cpp`, com o motor de teste criado com `h264Available = true` e o `Phone` (ramal 2001):
  - `"a voice call offers no video"`: `MakeCall("2003")` gera `video-in 2003 nao`.
  - `"a video call offers H264 and VP8 and sends the image after the answer"`:
    - `MakeCall("2003", true)` gera `video-in 2003 H264,VP8`;
    - o estado chega a `Confirmed`;
    - `WaitForVideoPackets(20, 5)`;
    - o `Video(id)` fica com `active` e `camera`, e o `LastVideo(id)` também;
    - o log do motor tem `video: H264 640x480 25 qps, envio ligado`.
  - `"the codec settings order and filter the offer"`:
    - `first=Vp8, vp9=true` gera `video-in 2003 VP8,H264,VP9`;
    - `h264=false` gera `video-in 2003 VP8`;
    - `h264Available=false` tira o H264.
  - `"the H264 offer carries profile-level-id 42e01f and packetization-mode 1"`: o `VideoSdp()` contém `profile-level-id=42e01f` e `packetization-mode=1`.
  - `"the camera stops and starts without a re-INVITE"`:
    - `SetCamera(id,false)`: depois de 500 ms, `VideoPacketsStay(1)` e `!Video(id).camera`, e o log tem `video: H264 640x480 25 qps, envio desligado`;
    - `SetCamera(id,true)`: a contagem volta a subir;
    - o `LogCount("reinv-in")` não muda.
  - `"the camera on a voice call asks for video with a re-INVITE"`: numa ligação de voz confirmada, `SetCamera(id,true)` gera `video-reinv 2003 H264,VP8`; os pacotes sobem, e o `Video(id)` fica com `active` e `camera`.
  - `"the other side refusing the video keeps the voice"`: com `VIDEO REJECT on`, o `MakeCall("2003",true)` chega a `Confirmed`; um evento traz `refused=true` e `active=false`; `VideoPacketsStay(2)` com zero; e não sai `Disconnected`.
  - `"the camera re-INVITE refused keeps the voice"`: com `REJECT on`, numa ligação de voz, `SetCamera(id,true)` gera o evento `refused` e nenhum pacote.
  - `"a 488 to a video call ends it with the code 488"`: com `VIDEO 488 on`, o `MakeCall("2003",true)` chega a `Disconnected` com o código 488. Depois, o `MakeCall("2003")` chega a `Confirmed`.
  - `"a video call without any available codec is a voice call that reports refused"`: com `vp8=false` e `h264Available=false`, o `MakeCall("2003",true)` gera `video-in 2003 nao`, o `RefusedCount(id)` fica 1, e a ligação chega a `Confirmed`.
  - `"an incoming video call answered without the camera sends no image"`: com `phone.RingVideo("2003")`:
    - sai `offered=true`;
    - `Answer(id,false)` leva a `Confirmed`, com `active=true` e `camera=false`;
    - `VideoPacketsStay(2)` com zero.
  - `"an incoming video call answered with the camera sends the image"`: `Answer(id,true)` leva a `WaitForVideoPackets(20,5)`.
  - `"an incoming H264-only offer without H264 reports refused"`: com `h264Available=false` e `phone.RingVideo("2003","H264")`:
    - o `LastVideo(id)` tem `offered=false`, e o `RefusedCount(id)` fica 1;
    - `Answer(id,true)` leva a `Confirmed`, com `active=false` e nenhum pacote.
  - `"a doorphone in the list gets a 183 with SDP and nothing goes out before the answer"`, com `doorphones={"9001"}`, `ResetVideoPackets()` e `phone.RingVideo("9001")`:
    - o log ganha `sdp-out 2001 183 video=sim`;
    - sai `early=true`;
    - por 2 s, `VideoPackets()==0` e o `AudioLinks(id)` fica vazio;
    - `Answer(id,false)` leva a `Confirmed`, com `early=false`.
  - `"a number outside the list rings without early media"`: com `phone.RingVideo("9002")`, por 2 s nenhum `sdp-out 2001 183` aparece, e o `LastVideo(id)` tem `offered=true` e `early=false`. (O `inv-out` do registro só leva o código final.)
  - `"hold pauses the image and unhold brings it back"`: `SetHold(id,true)` deixa `camera=false` e `active=false`, e os pacotes param; `SetHold(id,false)` deixa `camera=true`, e os pacotes sobem.
  - `"a second call pauses the first call's image"`: numa ligação com vídeo para 2003:
    1. `phone.Ring()`: com a segunda tocando, os pacotes da primeira continuam subindo;
    2. `Answer` da segunda: a primeira fica com `camera=false`, e depois de 500 ms, `VideoPacketsStay(1)`;
    3. desligue a segunda e faça `SetHold(primeira,false)`: os pacotes sobem.
  - `"the conference has no image"`: com duas ligações com vídeo (2002 e 2003) e o `Join`, as duas ficam com `active=false` e `camera=false`, e os pacotes param.
  - `"a pending transfer pauses the image"`: com `REFER_NOTIFY none`, numa ligação com vídeo, o `Transfer(id,"2004")` deixa `camera=false`, e os pacotes param.
  - `"a refused transfer gives the image back"`: com `REFER_REPLY 403`, o `Transfer(id,"2004")` leva ao `OnTransfer` 403, e depois a ligação fica com `camera=true` e os pacotes sobem.
  - `"SetCameraPaused stops the image and gives back the wish"`:
    - o `SetCameraPaused(true)` deixa `camera=false`, e os pacotes param;
    - o `SetCameraPaused(false)` deixa `camera=true`;
    - uma ligação cujo desejo era `false` continua sem câmera.
  - `"video calls refuse unknown ids"`: `Video(999)==CallVideo{}` e `SetCamera(999,true)==false`.
- [ ] **Step 2: Rode os testes e veja eles falharem.** Esperado: a compilação falha, porque `Video.h` e os métodos novos não existem.
- [ ] **Step 3: Implemente.** Faça o `Video.cpp`, os métodos e o vídeo no `CallTable` (o desejo, a pausa, o 183 e os eventos), os stubs no baresip, e o registrador com o fixture e os testes Python.
- [ ] **Step 4: Rode o motor no Linux, os scripts e o motor baresip.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `android` precisa ficar verde (o Linux e o NDK), e o `build` também (o baresip e o Windows).

```bash
git commit -m "feat(video): as ligações com vídeo no motor: a oferta, o atender, a câmera, as pausas e o 183 dos Porteiros"
```

### Task 3: O motor: a imagem, a prévia e as câmeras

**Files:**
- Modify: `starsonic/phone/Video.h` (os tipos abaixo).
- Create: `starsonic/phone/VideoRenderer.h` e `VideoRenderer.cpp`. Entram nos mesmos lugares que o `SipEngine.cpp` e ficam vazios sem o `PJMEDIA_HAS_VIDEO`.
- Modify: `SipEngine.*`, `EngineCall.*`, `EngineEvents.h` e o motor baresip.
- Modify: `tests/smoke/fake_registrar.py`, `tests/python/test_fake_registrar.py`, `tests/phone/registrar_fixture.h` e `tests/phone/call_fixture.h` (a gravação e a reprodução dos pacotes).
- Test: `tests/phone/test_engine_video.cpp`.

**Interfaces:**
- Produces (`Video.h`):

```cpp
struct VideoDevice { std::string name; };   // só as câmeras; o nosso dispositivo de saída não entra
enum class CameraProblem { NoCamera, OpenFailed, Disconnected };
struct I420Frame {
    int width = 0;
    int height = 0;
    const uint8_t* y = nullptr; int yStride = 0;
    const uint8_t* u = nullptr; int uStride = 0;
    const uint8_t* v = nullptr; int vStride = 0;
};
class FrameSink {
public:
    virtual ~FrameSink() = default;
    // Na thread de mídia da PJSIP: copie e volte logo; o quadro só vale durante a chamada.
    virtual void OnRemoteFrame(int callId, const I420Frame& frame) = 0;
    virtual void OnLocalFrame(const I420Frame& frame) = 0;
};
```

- Produces (`SipEngine`):

```cpp
void SetFrameSink(FrameSink* sink);                 // nullptr descarta; ao voltar, nenhum quadro chega ao sink antigo
std::vector<VideoDevice> VideoDevices() const;
bool SetCaptureDevice(const std::string& name);     // "" = a primeira; false só sem vídeo no motor
void RefreshVideoDevices();
bool StartCameraTest();                             // a prévia da câmera escolhida, em OnLocalFrame
void StopCameraTest();
```

- Produces: o `EngineConfig` ganha `bool nullVideo = false;`. Nos testes, ele esconde as câmeras.
- Produces: o `EngineListener` ganha `virtual void OnCameraProblem(CameraProblem problem) {}`. O `RecordingListener` guarda os problemas, com `std::vector<CameraProblem> CameraProblems() const`.

**As regras:**
- **O dispositivo "Starsonic"** é registrado depois do `libInit` e vira o dispositivo de saída das vistas que chegam e da prévia.
  - Cada janela da pjsua é ligada à sua ligação, ou à prévia.
  - Para isso, o motor pega o `hwnd` da janela (o `pjsua_vid_win_get_info`). O nosso stream põe ali o próprio endereço, pela capacidade `OUTPUT_WINDOW`.
  - O `VideoRenderer` expõe `void BindRendererStream(void* handle, int callId)`. O id `kLocalFrames` (-1) é a prévia. Os testes usam essa mesma função.
  - Um stream ainda sem o `BindRendererStream` não entrega quadro. A visibilidade da janela da pjsua não conta: o desenhista entrega os quadros mesmo com ela escondida.
- **Os quadros da outra ponta:**
  - vão com o id da ligação e nunca saem de uma ligação pausada;
  - o `remote` vira `true` no primeiro quadro;
  - ele vira `false` depois de 2 s sem quadro, e na hora na pausa ou no fim. Cada mudança gera um `OnCallVideo`.
- **Os quadros da nossa câmera** saem da prévia da câmera escolhida. A prévia roda enquanto o teste da câmera estiver ligado ou enquanto alguma ligação estiver mandando a imagem.
- **Os problemas da câmera:**
  - `NoCamera`: quando a câmera é pedida (o teste, o `MakeCall` ou o `Answer` com vídeo, o `SetCamera` com `on`) e o `VideoDevices()` está vazio. A ligação ainda oferece ou aceita o vídeo para receber, mas fica com `camera=false`.
  - `OpenFailed`: quando a câmera não abre. O log ganha `camera: falhou (<pj_status_t>)`.
  - `Disconnected`: quando a câmera em uso some (na releitura da lista ou num erro da captura). As ligações ficam com `camera=false`, e a prévia para.
- **As câmeras:**
  - o `SetCaptureDevice` vale na próxima vez que a câmera abre: o teste, uma ligação nova ou a Câmera ligada de novo;
  - um nome ausente usa a primeira câmera e guarda o pedido;
  - o `RefreshVideoDevices` relê a lista (o `pjmedia_vid_dev_refresh`), e a câmera pedida que voltou volta a ser a usada.
- **O `SetFrameSink`** é síncrono com o desenhista, por um mutex.
- **Uma mudança de tamanho** (o `set_cap(PJMEDIA_VID_DEV_CAP_FORMAT)` ou o `PJMEDIA_EVENT_FMT_CHANGED`) continua entregando os quadros, no tamanho novo.
- **O eco no lugar das "duas cópias do motor" da spec 11.2:** o motor é um só por processo (o `SipEngine.h`). Por isso os testes da imagem usam o `VIDEO ECHO on` do registrador, e a imagem passa pelo codificador e pelo decodificador do mesmo motor.

**O registrador falso, de novo:**
- A PORTA guarda os primeiros 300 datagramas com carga que chegam depois do último `VIDEO PACKETS reset`, ou da abertura.
- O `RINGVIDEO <ramal> <de> [<codecs>] [replay]` ganha o `replay`. Depois da resposta do telefone com SDP (o 183 ou o 200) com um `m=video` de porta diferente de zero, o registrador manda os datagramas guardados:
  - da PORTA para o endereço do vídeo do telefone, em ordem;
  - os de um mesmo quadro (o mesmo timestamp do RTP) juntos, um quadro a cada 40 ms;
  - com o PT trocado para o do primeiro codec da oferta, mantendo o bit M.

  Ele para no fim dos guardados ou no fim da ligação.
- Os testes Python cobrem a gravação e a reprodução.
- O `Phone::RingVideo` ganha o `bool replay = false` no fim.

- [ ] **Step 1: Escreva os testes que falham.** Use um `FrameSink` de teste que conta e guarda o tamanho e o id de cada quadro.
  - `"the test camera shows up and our renderer does not"`: o `VideoDevices()` tem `"Colorbar generator"` e nenhum nome com `"Starsonic"`.
  - `"nullVideo hides the cameras and the camera test reports NoCamera"`: o `VideoDevices()` fica vazio, `StartCameraTest()==false`, e sai `OnCameraProblem(NoCamera)`.
  - `"a video call without a camera still offers the video to receive it"`: com `nullVideo` e `MakeCall("2003",true)`:
    - sai o `NoCamera`;
    - o log tem `video-in 2003 H264,VP8`;
    - a ligação fica com `active=true` e `camera=false`.
  - `"the camera test delivers local frames and stops"`: em 3 s chegam pelo menos 5 quadros locais com largura e altura maiores que zero. Depois do `StopCameraTest()`, nenhum quadro chega após 500 ms.
  - `"a missing chosen camera falls back to the first"`: depois do `SetCaptureDevice("Nao existe")`, o teste da câmera ainda entrega quadros.
  - `"an echo video call shows its own image as the remote image"`: com `VIDEO ECHO on` e `MakeCall("2003",true)`, chegam pelo menos 10 quadros da outra ponta com o id da ligação em 5 s, em 640×480, e sai o `remote=true`.
  - `"remote goes false 2 seconds after the image stops"`: depois do `SetCamera(id,false)`, sai o `remote=false` em até 3,5 s.
  - `"VP8 alone and H264 alone both decode"`: com `h264=false`, chegam quadros; com `vp8=false`, só H.264, também chegam.
  - `"the low quality gives 320x240 frames"`.
  - `"two video calls keep their frames apart and the paused one shows nothing"`: com o eco, a ligação A com vídeo e depois a B com vídeo. A A fica em espera, chegam quadros só com o id da B, e nenhum com o id da A depois de 500 ms.
  - `"no frame reaches the sink after SetFrameSink(nullptr)"`: no eco, o sink marca quando o `SetFrameSink(nullptr)` voltou e conta os quadros depois disso. Em 1 s, a contagem é zero.
  - `"the renderer follows a size change"`: crie um stream do nosso dispositivo pela pjmedia, com 640×480 I420.
    - Pegue o endereço dele pelo `get_cap(OUTPUT_WINDOW)` e faça `BindRendererStream(endereço, 7)`.
    - Ponha um quadro, faça `set_cap(FORMAT)` com 320×240 e ponha outro.
    - O sink recebe 640×480 e depois 320×240, com o id 7.
  - `"a doorphone's image arrives before the answer and nothing goes out"`:
    1. Use as escolhas `h264=false` e `doorphones={"9001"}`, e faça `ResetVideoPackets()`.
    2. Faça uma ligação com vídeo para 2003, sem o eco, espere `WaitForVideoPackets(300, 10)` e desligue.
    3. Guarde `n = VideoPackets()` e faça `id = phone.RingVideo("9001", "VP8", true)`.
    4. Confira: em 5 s, chegam pelo menos 5 quadros da outra ponta com o `id`, e o `Video(id)` tem `remote` e `early`.
    5. Confira: o `VideoPacketsStay(2)`, com a contagem ainda `n`, e o `AudioLinks(id)` vazio.
    6. Faça `Answer(id,false)`: a ligação chega a `Confirmed`, com `early=false`.
- [ ] **Step 2: Rode os testes e veja eles falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente** o `VideoRenderer`, as câmeras, a prévia, o `remote`, os problemas da câmera, e a gravação e a reprodução do registrador.
- [ ] **Step 4: Rode o motor no Linux e os scripts.** Esperado: tudo passa. Rode o `test_engine_video` três vezes seguidas. Esperado: passa nas três, sem teste instável.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `android` e o `build`).

```bash
git commit -m "feat(video): a imagem no motor: o desenhista nosso, a prévia, as câmeras e os problemas da câmera"
```

### Task 4: As vistas de quadros (a memória de uma vista, portátil)

**Files:**
- Create: `windows/app/src/FrameBuffer.h` e `FrameBuffer.cpp`, em C++ portátil, que entram no `tests/desktop/CMakeLists.txt` e no `windows/app/CMakeLists.txt`.
- Test: `tests/desktop/test_frame_buffer.cpp`.
- Modify: `docs/ponte-windows.md`, com a subseção "A memória do vídeo".

**Interfaces:**
- Consumes: o `I420Frame` (Task 3).
- Produces:

```cpp
constexpr int kMaxFrameWidth = 1920;
constexpr int kMaxFrameHeight = 1080;
constexpr size_t kFrameHeaderBytes = 64;
size_t FrameSlotBytes();                       // 1920*1080 + 2*(960*540)
size_t FrameBufferBytes();                     // kFrameHeaderBytes + 2 * FrameSlotBytes()
struct FrameSize { int width; int height; };
FrameSize FitWithin(int width, int height);    // o maior tamanho que cabe em 1920x1080, com a mesma proporção e par
class FrameWriter {
public:
    FrameWriter(uint8_t* memory, size_t bytes);   // grava o cabeçalho de um buffer vazio (seq 0)
    bool Write(const I420Frame& frame);           // false: memória pequena ou quadro vazio
    uint32_t Seq() const;
};
struct ReadFrame { bool ok = false; uint32_t seq = 0; int width = 0; int height = 0; std::string y, u, v; };
ReadFrame ReadLatest(const uint8_t* memory, size_t bytes);   // o mesmo algoritmo que a página vai usar
```

**O formato:** todos os campos são u32 little-endian, nestes deslocamentos do cabeçalho:
- 0: a marca `0x31565353` ("SSV1");
- 4: o `seq`. O zero quer dizer nenhum quadro, e um valor ímpar quer dizer que o cabeçalho está mudando;
- 8: o lugar (0 ou 1) do último quadro completo;
- 12: a largura;
- 16: a altura;
- 20: o `yStride`, igual à largura;
- 24: o `uvStride`, igual a `(largura+1)/2`;
- 28: o `FrameSlotBytes()`;
- de 32 a 63: zero.

Os lugares começam em 64 e em `64 + FrameSlotBytes()`. Cada lugar tem o Y, depois o U, depois o V, sem sobra nas linhas. A escrita usa este algoritmo:

```
quadro maior que 1920x1080 → reduzido por vizinho mais próximo para FitWithin(largura, altura)
s = (seq == 0) ? 0 : 1 - lugar
copia Y, U e V para o lugar s
seq += 1   (ímpar; com memory_order_release)
grava lugar = s, largura, altura, yStride, uvStride
seq += 1   (par; com memory_order_release)
```

A leitura funciona assim:
1. Lê `s1 = seq`. Se ele é zero ou ímpar, devolve `ok=false`.
2. Copia o cabeçalho e o lugar.
3. Lê `s2 = seq`. O `ok` vale `s1 == s2`.

- [ ] **Step 1: Escreva os testes que falham:**
  - `"a fresh buffer has the mark and no frame"`: os 4 primeiros bytes são `S`, `S`, `V` e `1`, e o `ReadLatest(...).ok` é `false`.
  - `"a written frame reads back with its size and planes"`: um quadro 4×2 com bytes conhecidos volta igual.
  - `"frames alternate slots and the header follows the last one"`: escreva A, B e C. O `Seq()` fica 6, o lugar fica 0 e os dados são os de C.
  - `"a size change keeps working"`: 640×480, depois 1280×720, depois 320×240. Cada um volta com o seu tamanho.
  - `"a frame bigger than 1920x1080 is reduced keeping the proportion"`: `FitWithin(3840,2160)` dá `{1920,1080}`, `FitWithin(4000,1000)` dá `{1920,480}`, e o quadro escrito volta nesses tamanhos.
  - `"odd sizes keep the chroma planes right"`: um quadro 5×3 dá `uvStride` 3 e duas linhas de cor.
  - `"too small memory refuses the frame"`: com 100 bytes, o `Write` devolve `false`.
  - `"a reader never takes a frame while the header is changing"`: com o `seq` posto ímpar à mão, o `ok` é `false`.
- [ ] **Step 2: Rode os testes e veja eles falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente e escreva a subseção da ponte.**
- [ ] **Step 4: Rode o desktop.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit e o push.**

```bash
git commit -m "feat(video): a memória de uma vista de vídeo, com os dois lugares e o seq, e o formato na ponte"
```

### Task 5: O módulo H.264 da Cisco (o download e a conferência)

**Files:**
- Create: `starsonic/desktop/H264Module.h` e `H264Module.cpp`, portáteis.
- Create: `starsonic/desktop/OpenH264Pin.h`.
- Create: `windows/app/src/Bunzip.h` e `Bunzip.cpp`, portáteis com a libbz2. Nos testes do desktop, eles entram com o `find_package(BZip2)`. No Windows, a porta `bzip2` do vcpkg entra no `deps.lock`.
- Test: `tests/desktop/test_h264_module.cpp` e `tests/desktop/test_bunzip.cpp`.
- Modify: `starsonic/win/Http.h` e `Http.cpp`, com o `HttpGetPinned`.
- Modify: `build/deps.lock`, que ganha `"openh264": {"version","url","file","bz2Sha256","dllSha256"}`.
- Modify: `tests/python/test_deps_lock.py`.
- Modify: `build/Build-Deps.ps1`, se a porta precisar.
- Create: `build/Test-OpenH264.ps1`.
- Modify: `.github/workflows/build.yml`. O job do Windows ganha o passo da Cisco, e o job do Linux que roda os testes do desktop instala o `libbz2-dev`.
- Create: `starsonic/third_party/openh264/BINARY_LICENSE.txt`.
- Modify: `docs/build-notes.md`, explicando como trocar a versão fixada.

**Interfaces:**
- Produces (`H264Module.h`):

```cpp
struct H264Pin { std::string version, url, file, bz2Sha256, dllSha256; };   // sha em hex minúsculo
enum class H264State { Off, Downloading, Installed, Failed };
struct FetchResult { int status = 0; std::string body; std::string error; };   // error: "tempo", "rede", "grande"…
struct H264Io {
    std::function<std::optional<std::string>(const std::string& path)> read;
    std::function<bool(const std::string& path, const std::string& bytes)> write;   // atômico
    std::function<bool(const std::string& path)> remove;
    std::function<std::vector<std::string>(const std::string& folder)> list;         // os nomes
    std::function<FetchResult(const std::string& url, size_t maxBytes, int timeoutMs)> fetch;
    std::function<std::optional<std::string>(const std::string& compressed, size_t maxOut)> bunzip;
    std::function<void(const std::string& line)> log;
};
class H264Module {
public:
    H264Module(H264Pin pin, std::string folder, H264Io io);
    std::string ModulePath() const;   // folder + separador + pin.file
    H264State Ensure();               // bloqueante; roda fora da fila dos comandos
    bool Verify() const;              // só confere: o arquivo existe e a impressão bate
};
```

- Produces (`OpenH264Pin.h`): `inline const H264Pin kOpenH264Pin{...};`, com os valores do `deps.lock`. Um teste Python confere que os dois batem.
- Produces (`Bunzip.h`): `std::optional<std::string> Bunzip2(const std::string& compressed, size_t maxOut);`.
- Produces (`Http.h`): `HttpResponse HttpGetPinned(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent, int timeoutMs);`.
  - Usa o mesmo `HttpResponse` do `HttpsGet` (o `status`, o `body` e o `error`).
  - Recusa, com `ERROR_INVALID_PARAMETER`, todo endereço que não começa com `http://ciscobinary.openh264.org/`.
  - Não segue redirecionamento (`WINHTTP_OPTION_REDIRECT_POLICY_NEVER`): um 3xx volta como a resposta.
  - Usa o proxy do Windows, como o `HttpsGet`, e desiste em `timeoutMs` (os tempos do WinHTTP).

**As regras do `Ensure`:**
1. Apaga da pasta todo `openh264-*.dll` que não é o `pin.file`, e todo `*.part`.
2. Se o `ModulePath()` existe e o SHA-256 dele é o `dllSha256`, devolve `Installed` com o log `h264: instalado <versão>`. Se existe com outra impressão, apaga e loga `h264: arquivo nao confere, apagado`.
3. Chama `fetch(url, 4194304, 60000)`. Um `status` diferente de 200, ou um `error`, dá `Failed`, com o log `h264: download falhou (<status ou error>)`.
4. Se o SHA-256 do corpo é diferente do `bz2Sha256`, dá `Failed` com o log `h264: arquivo nao confere, apagado`, e nada é gravado.
5. Chama `bunzip(corpo, 8388608)`. Uma falha dá `Failed` com o log `h264: download falhou (bzip2)`.
6. Se o SHA-256 do `.dll` é diferente do `dllSha256`, dá `Failed` com o log `h264: arquivo nao confere, apagado`.
7. Chama `write(ModulePath(), dll)`. Uma falha dá `Failed` com o log `h264: download falhou (gravar)`.
8. Devolve `Installed`, com o log `h264: instalado <versão>`.

O SHA-256 é o `Sha256Digest` portátil do `starsonic/desktop/Pbkdf2.h`.

**A fixação** (as impressões vêm do binário verdadeiro, conferido pela assinatura da Cisco):
- O `Test-OpenH264.ps1`:
  1. baixa o `url` do `deps.lock`;
  2. mostra o SHA-256 do `.bz2`;
  3. descomprime e mostra o SHA-256 do `.dll`;
  4. confere o `Get-AuthenticodeSignature` do `.dll`. O `Status` precisa ser `Valid`, e o assinante precisa ter `Cisco Systems` no `Subject`; senão, o passo falha;
  5. compara as duas impressões com o `deps.lock`. Com elas vazias, ele só avisa (`::warning::`), com os valores. Com elas preenchidas, ele falha se forem diferentes;
  6. baixa `https://www.openh264.org/BINARY_LICENSE.txt` e o guarda como o artefato `openh264-licenca`. Uma diferença do arquivo do repositório gera um aviso, não uma falha;
  7. confere que a pasta do app instalado pela fumaça não tem nenhum `openh264*.dll`: o instalador nunca leva o H.264.

  Uma falha do site da Cisco nos downloads (o passo 1 ou o 6) gera só um aviso, para um site fora do ar não derrubar o build.
- O primeiro push vai com as impressões vazias, e o CI fica verde, com o aviso. Depois, o implementador:
  1. confere no log a linha do Authenticode (`Valid`, Cisco Systems);
  2. copia as duas impressões para o `deps.lock` e o `OpenH264Pin.h`;
  3. pega o artefato `openh264-licenca` pelo `gh api` e grava o `BINARY_LICENSE.txt`;
  4. troca o teste `test_openh264_pins_are_empty_or_sha256` pelo `test_openh264_pins_are_sha256`, que exige as duas com 64 dígitos hexadecimais minúsculos;
  5. faz o segundo push, que precisa ficar verde, agora conferindo as impressões.

- [ ] **Step 1: Escreva os testes que falham.** Use um `H264Io` falso. O `bunzip` falso troca `"BZ:"+x` por `x`, e o pino usa as impressões dos bytes falsos.
  - `"an installed module with the right print is used without downloading"`: o `fetch` não é chamado, e o resultado é `Installed`.
  - `"a missing module is downloaded, checked, unpacked and saved"`: o resultado é `Installed`, o `write` recebe o `.dll` no `ModulePath()`, e o log tem `h264: instalado 2.6.0`.
  - `"a download with the wrong print is refused and nothing is saved"`: o resultado é `Failed`, o `write` não é chamado, e o log tem `h264: arquivo nao confere, apagado`.
  - `"an unpacked module with the wrong print is refused"`.
  - `"a saved module with the wrong print is removed and downloaded again"`.
  - `"other versions and leftovers are removed"`: o `remove` é chamado para `openh264-2.4.1-win32.dll` e para `x.part`, e não para o `pin.file`.
  - `"a failed fetch gives Failed with the code"`: um 404 loga `h264: download falhou (404)`, um 301 dá `Failed`, e o erro `"tempo"` loga `h264: download falhou (tempo)`.
  - `"the download asks for at most 4 MiB within 60 s"`: o `fetch` recebe `4194304` e `60000`.
  - `"Verify checks the print without downloading"`.
  - No `test_bunzip.cpp`, com a libbz2 de verdade:
    - `"Bunzip2 unpacks a bzip2 buffer"`, comprimindo no próprio teste;
    - `"Bunzip2 refuses garbage"`;
    - `"Bunzip2 refuses an output bigger than the limit"`.
  - No `test_deps_lock.py`:
    - `test_openh264_pin_header_matches_deps_lock`;
    - `test_openh264_pins_are_empty_or_sha256`.
- [ ] **Step 2: Rode o desktop e os scripts, e veja os testes falharem.** Esperado: a compilação falha, e os testes Python falham.
- [ ] **Step 3: Implemente** o `H264Module`, o `Bunzip2`, o `HttpGetPinned`, o pino vazio, o `Test-OpenH264.ps1` e os passos do CI.
- [ ] **Step 4: Rode o desktop e os scripts.** Esperado: tudo passa. O teste do pino passa com os dois vazios e iguais.
- [ ] **Step 5: Faça o primeiro push e leia o passo do CI.** Esperado: o `build` fica verde, com o aviso das impressões vazias. Confira a assinatura e copie as impressões e o texto da licença, como descrito acima.
- [ ] **Step 6: Faça o segundo push.** Esperado: o `build` fica verde, com o passo da Cisco conferindo as duas impressões, e o `android` também fica verde.

```bash
git commit -m "feat(video): o módulo H.264 da Cisco: o download fixado, a conferência e a licença do binário"
```

### Task 6: O núcleo: as escolhas do vídeo e a ponte delas

**Files:**
- Modify: `starsonic/desktop/Admin.h` e `Admin.cpp`. O `AdminConfig` e o `AdminChanges` ganham:
  - `videoH264`, `videoVp8` e `videoVp9`;
  - `videoFirst`;
  - `videoQuality`;
  - `doorphones`.

  A validação e as chaves do `admin.json` também mudam. As chaves que faltam valem o padrão.
- Modify: `starsonic/desktop/Stores.h` e `Stores.cpp`. O `Settings` ganha `std::string cameraName;` e `bool h264Person = true;`, e o `config.json` ganha as chaves `"camera"` e `"h264"`.
- Modify: `starsonic/desktop/Protocol.h` e `Protocol.cpp`.
  - Entram os `CommandKind` `SetVideo`, `CameraTest`, `VideoViews`, `VideoWindow` e `H264Retry`.
  - O `Command` ganha os campos `video`, `cameraName`, `h264`, `page`, `views` e `mode`.
  - Entram os campos novos do `adminSet` e o bloco `video` no estado.
- Modify: `starsonic/desktop/DesktopApp.h` e `DesktopApp.cpp`.
- Modify: `windows/app/src/EngineHost.h` e `EngineHost.cpp`. O `EngineHost` repassa ao `SipEngine` os seis métodos novos do porto e passa o `OnCameraProblem` ao listener, como os outros eventos.
- Modify: `tests/desktop/desktop_fixture.h`. O `FakePort` ganha os métodos de vídeo e guarda as chamadas.
- Create: `tests/desktop/test_desktop_video.cpp`, que entra no `tests/desktop/CMakeLists.txt`.
- Modify: `docs/ponte-windows.md`, com os pedidos, o estado e os ganchos desta task.

**Interfaces:**
- Consumes: `VideoSettings`, `VideoDevice` e `CameraProblem` (Tasks 2 e 3), e `H264State` (Task 5).
- Produces: o `RegistrationPort` ganha estes métodos, todos virtuais puros:

```cpp
virtual std::vector<VideoDevice> VideoDevices() = 0;
virtual bool SetCaptureDevice(const std::string& name) = 0;
virtual void RefreshVideoDevices() = 0;
virtual bool StartCameraTest() = 0;
virtual void StopCameraTest() = 0;
virtual void SetVideoSettings(const VideoSettings& settings) = 0;
```

- Produces: o `DesktopHooks` ganha:

```cpp
std::function<void(const std::vector<std::string>& views, bool noticePage)> videoViews;
std::function<void(const std::string& mode)> videoWindow;    // "normal", "grande", "telaCheia"
std::function<void()> h264Ensure;      // roda H264Module::Ensure fora da fila e responde pelo SetH264State
std::function<bool()> cameraBlocked;   // a privacidade do Windows nega a câmera aos apps da área de trabalho
```

- Produces (`DesktopApp`):
  - `void OnCameraProblem(CameraProblem problem) override;`, do `EngineListener`. Ele chega na thread de eventos do motor e vai para a fila dos comandos.
  - `void SetH264State(H264State state);`, que pode ser chamado de qualquer thread e também vai para a fila.

**As regras:**
- **As escolhas que vão ao motor:**
  - os campos do cartão;
  - os `doorphones`;
  - o `h264Available`, que vale `videoH264 && h264Person && situação == instalado`.

  Elas vão no `Start` e a cada mudança, pelo `SetVideoSettings`.
- **A situação do H.264:**
  - é `desligado` quando o cartão ou a pessoa desliga o H.264;
  - no `Start`, ou quando o H.264 volta a ser ligado, se ela ainda não está `instalado`, vira `baixando` e chama o `h264Ensure`;
  - o `SetH264State` muda para `instalado` ou `falhou`. Um `SetH264State` que chega com o H.264 desligado (no cartão ou pela pessoa) não muda nada;
  - o `h264Retry` só chama de novo depois de uma falha.
- **O `video.ligado`** vale o `VideoEnabled` das escolhas, sem olhar o `h264Available`. Na plataforma iPhone, ele é sempre `false`.
- **O `setVideo`:**
  - a `"camera"` grava o `cameraName` e chama `SetCaptureDevice(nome)`;
  - o `cameraDesconectada` vale `true` quando o nome não está em `VideoDevices()`;
  - o `"h264"` grava o `h264Person`.
- **O `cameraTest`:** o `on` chama `StartCameraTest()`, e o `teste` segue o resultado. O `off` chama `StopCameraTest()`.
- **O `videoViews`** chama o `hooks.videoViews(vistas, pagina == "aviso")`. Uma vista que não é da página é ignorada.
- **O `videoWindow`:** um `modo` fora dos três é ignorado. O núcleo grava o `janela` e chama o `hooks.videoWindow`. Quando a última ligação acaba, se o `janela` não é `normal`, ele chama o `hooks.videoWindow("normal")`.
- **O `OnCameraProblem`** gera os avisos:
  - `NoCamera`: "Nenhuma câmera encontrada.";
  - `OpenFailed`: o texto da privacidade se o `hooks.cameraBlocked()` vale `true`, e "A câmera está sendo usada por outro programa." se não;
  - `Disconnected`: "A câmera foi desconectada.".
- **As câmeras que entram e saem:** o `RefreshAudioDevices` do `DesktopApp`, o aviso do `WM_DEVICECHANGE` de hoje, também relê as câmeras. Ele chama o `RefreshVideoDevices` do porto, refaz a lista e o `cameraDesconectada` e manda o estado.
- **Os Porteiros:** mais de 20, um item com algo que não é dígito, com mais de 15 dígitos ou vazio, e um repetido são recusados, como os outros campos da área recusam.

- [ ] **Step 1: Escreva os testes que falham** (`test_desktop_video.cpp`, com o fixture do desktop):
  - `"the video block starts with the defaults"`. Depois do `Start`:
    - `video.ligado` é `true`, e o `h264` fica `{cartao:true, pessoa:true, situacao:"baixando"}`;
    - o `h264Ensure` foi chamado uma vez, e o `janela` é `"normal"`;
    - a área aberta mostra `videoH264` e `videoVp8` em `true`, `videoVp9` em `false`, `videoPrimeiro` igual a `"h264"`, `videoQualidade` igual a `"media"` e `porteiros` vazio.
  - `"the engine gets H264 only when installed"`: antes do `SetH264State(Installed)`, as últimas escolhas no porto têm `h264Available=false`; depois, `true`.
  - `"the person turning H264 off stops it, and on asks for the module"`.
  - `"a late H264 result with H264 off changes nothing"`: com a pessoa desligando o H.264, um `SetH264State(Installed)` deixa a situação `desligado` e o motor com `h264Available=false`.
  - `"the admin card turning every codec off turns video off"`: o `video.ligado` fica `false`, e o motor recebe tudo desligado.
  - `"the doorphones are validated"`: são recusados 21 itens, `"90a1"`, 16 dígitos e um repetido. `["9001","9002"]` é aceito e vai ao estado e ao motor.
  - `"choosing a camera saves it and tells the engine"`: o `config.json` tem o nome, e o `SetCaptureDevice` foi chamado. Um nome fora da lista dá `cameraDesconectada=true`.
  - `"the camera test starts and stops"`: um `StartCameraTest` que falha deixa `teste=false`.
  - `"camera problems become the right toasts"`: os três problemas dão os três textos exatos, e o `OpenFailed` dá os dois textos, um para cada `cameraBlocked`.
  - `"videoViews goes to the hook with its page"`: `{"pagina":"aviso","vistas":["porteiro"]}` chama o gancho com `(["porteiro"], true)`, e `"remoto"` na página `"aviso"` é ignorado.
  - `"videoWindow validates the mode and the window goes back to normal at the end of the call"`.
  - `"h264Retry asks again only after a failure"`.
  - `"the camera list refreshes with the device notice"`: o porto falso troca a lista, e depois do `RefreshAudioDevices()` o `RefreshVideoDevices` do porto foi chamado e o estado mostra a lista nova.
  - `"the choices survive a restart"`: a câmera, a chave da pessoa e o cartão voltam no novo `Start`.
  - `"the iPhone platform has no video"`: `video.ligado=false`, e o `cameraTest` não chama o porto.
- [ ] **Step 2: Rode o desktop e veja os testes falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente e atualize o `docs/ponte-windows.md`.**
- [ ] **Step 4: Rode o desktop e a suíte do núcleo.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` precisa ficar verde, com o Windows compilando o `EngineHost`.

```bash
git commit -m "feat(video): as escolhas do vídeo no núcleo: o cartão, a câmera, a chave do H.264 e a ponte"
```

### Task 7: O controlador: as ligações com vídeo na ponte

**Files:**
- Modify: `starsonic/phone/CallEngine.h` e `CallEngine.cpp` (o `SipCallEngine`), o `windows/app/src/EngineHost.h` e `EngineHost.cpp`, e o `tests/phone/fake_call_engine.h`.
- Modify: `starsonic/phone/CallController.h` e `CallController.cpp`.
- Modify: `starsonic/desktop/Protocol.h`, `Protocol.cpp`, `DesktopApp.h` e `DesktopApp.cpp`.
- Test: `tests/phone/test_call_controller_video.cpp`, no executável de testes do controlador do `tests/phone`, e `tests/desktop/test_desktop_video.cpp`.
- Modify: `docs/ponte-windows.md`.

**Interfaces:**
- Consumes: o `CallVideo` e o `EngineListener::OnCallVideo` (Task 2), e a situação do H.264 (Task 6).
- Produces (`CallEngine`). Estes dois trocam os de hoje: `virtual int MakeCall(const std::string& number, bool video) = 0;` e `virtual bool Answer(int callId, bool video) = 0;`. Entra também `virtual bool SetCamera(int callId, bool on) = 0;`. O `SipCallEngine`, o `EngineHost` e o motor falso seguem.
- Produces (os eventos):
  - o `CallEngine` continua só com os pedidos;
  - o `EngineHost` passa o `OnCallVideo` ao listener, o `DesktopApp`;
  - o `DesktopApp` (`OnCallVideo` override) põe o evento na fila e chama o `CallController::OnCallVideo(int callId, const CallVideo& video)`, um método novo, público, ao lado do `OnCallState`.
- Produces (`CallController`):
  - `CallView` ganha `CallVideo video;`;
  - `bool Dial(const std::string& raw, bool video = false);`;
  - `bool DialContact(const std::string& number, bool video = false);`;
  - `void Answer(bool video = false);`;
  - `void Camera(bool on);`, para a ligação de cima;
  - `CallControllerListener` ganha `virtual void OnVideoRefused() {}`.

**As regras:**
- **O 488 e o 415:**
  - Uma ligação discada com vídeo pode acabar antes de confirmada com 488 ou 415. Nesse caso, o controlador disca de novo o mesmo número, uma vez, sem vídeo, e chama o `OnVideoRefused()`.
  - O aviso do fim da primeira tentativa não aparece, ela não vai aos Recentes, e o cartão continua "Chamando".
  - Um 486, ou qualquer outro código, termina como hoje.
- **O `OnCallVideo`** atualiza o `CallView.video` da ligação. Com o `refused`, ele chama o `OnVideoRefused()` uma vez.
- **No núcleo:**
  - o `dial` e o `answer` repassam o `"video"` só com o `video.ligado`;
  - o `camera` chama o `Camera(on)`;
  - o `OnVideoRefused` mostra "Este vídeo precisa do H.264, que ainda não foi baixado." quando o cartão e a pessoa ligam o H.264 e a situação não é `instalado`. Nos outros casos, mostra "A outra ponta não aceitou o vídeo.";
  - a ligação no estado ganha o bloco `video`, com os nomes da ponte.

- [ ] **Step 1: Escreva os testes que falham.**
  - **No controlador, com o motor falso:**
    - `"Dial with video asks the engine for a video call"`;
    - `"Answer with video passes the flag"`;
    - `"Camera goes to the top call"`: com duas ligações, `Camera(false)` chama `SetCamera(idDeCima,false)`;
    - `"OnCallVideo fills the call view"`;
    - `"a 488 to a video call redials once without video and warns"`:
      1. o primeiro `MakeCall(n,true)` dá o id 1, e chega `Disconnected` com o código 488;
      2. sai `MakeCall(n,false)`, e o `OnVideoRefused` é chamado uma vez;
      3. a foto ainda mostra a ligação, e nenhum Recente foi criado;
      4. um 488 no id 2 termina sem uma terceira discagem.
    - `"a 415 redials the same way and a 486 does not"`;
    - `"a refused video event warns once"`.
  - **No desktop:**
    - `"dial and answer pass video only when video is on"`: com os codecs desligados no cartão, `{"cmd":"dial","numero":"2003","video":true}` chama `MakeCall("2003", false)`;
    - `"the refused video toast depends on the H264 situation"`: os dois textos;
    - `"the call state carries the video block"`: `ligacao.top.video` igual a `{"oferece":true,"ativo":true,"imagem":false,"camera":true,"cedo":false}` para o `CallVideo` correspondente.
- [ ] **Step 2: Rode os testes do controlador e do desktop e veja eles falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente e atualize a ponte.**
- [ ] **Step 4: Rode o controlador, o motor no Linux, o desktop e a suíte do núcleo.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `build` e o `android`).

```bash
git commit -m "feat(video): as ligações com vídeo na ponte: o dial, o answer, a câmera e o 488 que vira voz"
```

### Task 8: O executável: a imagem até a página e o módulo da Cisco ligado

**Files:**
- Create: `windows/app/src/FrameRouter.h`, `FrameRouter.cpp`, `VideoSink.h` e `VideoSink.cpp`, portáteis, que entram nos testes do desktop.
- Create: `windows/app/src/WebViewSharedBuffers.h` e `WebViewSharedBuffers.cpp`, só do Windows.
- Create: `windows/app/src/CameraPrivacy.h` e `CameraPrivacy.cpp`. A decisão é portátil, e a leitura do registro é só do Windows.
- Modify: `windows/app/src/ShellState.h` e `ShellState.cpp`. O `ShellStatus` ganha `int topCallId = 0;` (o `ligacao.top.id`) e `int ringingCallId = 0;`, que é o id da recebida tocando: a de cima ou a segunda, fora da conferência, pela mesma regra do `ringing`.
- Modify: `windows/app/src/MainWindow.h` e `MainWindow.cpp`, com o callback `videoRoute` e o `VideoSink` avisado do navegador refeito e da página pronta.
- Modify: `windows/app/src/WebViewHost.h` e `WebViewHost.cpp` (criar e entregar uma memória dividida), `EngineHost.*` (o `SetFrameSink`) e `main.cpp` (os ganchos `videoViews`, `h264Ensure` e `cameraBlocked`).
- Test: `tests/desktop/test_frame_router.cpp`, `tests/desktop/test_video_sink.cpp`, `tests/desktop/test_camera_privacy.cpp` e `tests/win/test_shell_state.cpp`.

**Interfaces:**
- Consumes:
  - `FrameSink` e `I420Frame` (Task 3);
  - `FrameWriter`, `FrameBufferBytes` e `ReadLatest` (Task 4);
  - `H264Module` e `kOpenH264Pin` (Task 5);
  - `LoadOpenH264` (Task 1);
  - os ganchos e os métodos do `DesktopApp` (Task 6).
- Produces:

```cpp
enum class ViewName { Remoto, Local, Porteiro };
struct RouteState {
    std::set<ViewName> visible;
    int topCallId = 0;        // a ligação de cima, na janela principal
    int noticeCallId = 0;     // a recebida tocando, que o aviso mostra
    bool minimized = false;   // a janela principal minimizada ou na bandeja
};
std::vector<ViewName> RouteRemote(const RouteState& state, int callId);
std::vector<ViewName> RouteLocal(const RouteState& state);

class SharedMemoryPages {     // a parte do WebView2, atrás de uma interface; tudo na thread da janela
public:
    virtual ~SharedMemoryPages() = default;
    virtual uint8_t* Create(ViewName view, size_t bytes) = 0;   // nullptr: não deu
    virtual void Post(ViewName view) = 0;                       // entrega a memória da vista à página dela
    virtual void ReleaseAll() = 0;                              // larga todas as memórias
};
class VideoSink : public FrameSink {
public:
    VideoSink(SharedMemoryPages& pages, std::function<int64_t()> nowMs);
    // Na thread da janela (a do WebView2).
    void SetRouteState(const RouteState& state);   // uma vista à vista sem memória ganha a sua aqui (Create e Post)
    void PageReady(bool noticePage);               // a página recarregou: entrega de novo as memórias dela
    void BrowserRestarted();                       // o ambiente novo: larga as memórias e cria as das vistas à vista
    void Close();                                  // antes de o WebView fechar: larga tudo; nenhum quadro depois
    // Na thread de mídia: só escrevem nas memórias que já existem.
    void OnRemoteFrame(int callId, const I420Frame& frame) override;
    void OnLocalFrame(const I420Frame& frame) override;
};
bool CameraConsentDenied(const std::string& deviceWide, const std::string& user, const std::string& userDesktopApps);
```

**As regras:**
- **O `RouteRemote`** dá:
  - o `Remoto`, quando o `callId` é o `topCallId`, a vista está à vista e a janela não está minimizada;
  - o `Porteiro`, quando o `callId` é o `noticeCallId` e a vista está à vista, também com a janela minimizada;
  - nenhuma vista para um `callId` que não é nenhum dos dois.
- **O `RouteLocal`** dá o `Local`, à vista e sem minimizar.
- **O `VideoSink`:**
  - as memórias só são criadas, entregues e largadas na thread da janela, porque o WebView2 só aceita essa thread;
  - um quadro nunca cria uma memória: um quadro de uma vista sem memória é descartado;
  - a escrita é pelo `FrameWriter`;
  - um mutex protege as memórias entre a thread de mídia e a da janela. O `BrowserRestarted` e o `Close` largam os ponteiros com o mutex preso, antes do `ReleaseAll`.
- **O limite de 30 quadros por segundo** usa um crédito inteiro por vista:
  - a vista começa com 2000 pontos;
  - ela ganha 30 pontos por milissegundo, até 2000;
  - um quadro escrito gasta 1000;
  - um quadro sem 1000 pontos é descartado.

  Assim, a variação de uma câmera de 30 qps não perde quadros.
- **O `CameraConsentDenied`** dá `true` se qualquer um dos três valores for `"Deny"`. A leitura do registro (`HKLM` e `HKCU` `...\CapabilityAccessManager\ConsentStore\webcam\Value` e `HKCU` `...\webcam\NonPackaged\Value`) é o gancho `cameraBlocked`.
- **A ligação no `main.cpp` e no `MainWindow`:**
  - o `EngineHost::SetFrameSink(&videoSink)` não espera o motor: ele guarda o sink e o passa ao motor quando ele fica pronto;
  - o `VideoSink` dura mais que o motor: ele é destruído depois do `EngineHost::Stop()`. Antes de o WebView fechar, o `MainWindow` chama o `VideoSink::Close()`;
  - o `RouteState` é montado na thread da janela:
    - as vistas vêm do gancho `videoViews`, pelo `RunOnWindow`, e trocam só as vistas daquela página;
    - as ligações vêm do callback novo `videoRoute(int topCallId, int ringingCallId, bool minimized)` do `MainWindow`, que sai quando um dos três muda;
    - o `noticeCallId` é o `ringingCallId`;
  - o `MainWindow` chama o `VideoSink::PageReady` no comando `ready` de cada página e o `VideoSink::BrowserRestarted` depois de refazer o navegador;
  - o `WebViewSharedBuffers` cria cada memória pelo `CreateSharedBuffer` e a entrega pelo `PostSharedBufferToScript`, só de leitura e com o JSON da ponte, só à página da vista: o `Porteiro` vai ao aviso, e as outras à janela principal.
- **O `h264Ensure`** roda numa thread o `H264Module`, com o `HttpGetPinned`, o `Bunzip2` e a pasta `%LOCALAPPDATA%\Starsonic Phone\codecs`, que é criada se não existe.
  - Um pedido no meio de outro é ignorado.
  - Com o resultado `Installed`, ele chama o `Verify()` e o `LoadOpenH264(caminho)` e só então o `SetH264State(Installed)`.
  - Uma falha do `LoadOpenH264` vira `Failed`, com o log `h264: download falhou (carregar <código>)`.

- [ ] **Step 1: Escreva os testes que falham.**
  - **No `test_frame_router.cpp`:**
    - `"a remote frame of the top call goes to the visible remote view"`;
    - `"a frame of an unknown or ended call goes nowhere"`: com o `callId` 42, sem `topCallId` nem `noticeCallId` igual, o resultado é vazio;
    - `"the ringing call in the notice feeds the doorphone view even minimized"`;
    - `"hidden views and a minimized window get no frames"`;
    - `"the local frame goes to the local view only when visible and not minimized"`.
  - **No `test_video_sink.cpp`,** com uma `SharedMemoryPages` falsa que conta os `Create`, os `Post` e os `ReleaseAll` e guarda cada memória:
    - `"a visible view gets its memory once"`: o `SetRouteState` com o `Remoto` à vista faz um `Create` e um `Post`, e um segundo `SetRouteState` igual não faz outro;
    - `"a frame never creates a memory"`: um `OnRemoteFrame` antes de qualquer `SetRouteState` não chama o `Create`;
    - `"a remote frame lands in the remote buffer and reads back"`: o `ReadLatest` da memória do `Remoto` devolve o quadro;
    - `"a page reload posts the memories again"`: o `PageReady(false)` entrega de novo só as memórias da janela principal;
    - `"a browser restart drops the memories and creates new ones"`: o `BrowserRestarted` chama o `ReleaseAll` uma vez e cria de novo a memória de cada vista à vista. Um quadro depois vai para a memória nova, e o `seq` da velha não muda;
    - `"after Close no frame is written"`: depois do `Close`, o `ReleaseAll` foi chamado, e um quadro não muda nenhuma memória;
    - `"a 30 fps source with jitter keeps every frame"`: quadros em 0, 32, 66, 99, 132, 168, 199 e 233 ms escrevem os oito, e o `seq` fica 16;
    - `"frames faster than 30 per second are thinned"`: um quadro a cada 10 ms, de 0 a 990 ms, escreve 31, e o `seq` fica 62.
  - **No `test_camera_privacy.cpp`:** `"CameraConsentDenied is true when any value is Deny"`.
  - **No `tests/win/test_shell_state.cpp`:** `"the state gives the top call id and the ringing call id"`:
    - a de cima tocando dá as duas com o id dela;
    - a de cima em andamento e a segunda tocando dão o `ringingCallId` da segunda;
    - sem ligação, os dois ficam 0.
- [ ] **Step 2: Rode o desktop e veja os testes falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente** a parte portátil e depois a do Windows: o `WebViewSharedBuffers`, o registro, o `ShellState`, o `MainWindow`, o `EngineHost` e o `main.cpp`.
- [ ] **Step 4: Rode o desktop e a suíte do núcleo.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` precisa ficar verde: o Windows compila, os testes do desktop no Windows passam (o `ShellState`), e a fumaça abre o app. O passo da Cisco também confere.

```bash
git commit -m "feat(video): a imagem até a página pela memória dividida do WebView2 e o módulo da Cisco ligado no app"
```

### Task 9: A janela grande, a tela cheia, a tela bloqueada e as câmeras que entram e saem

**Files:**
- Modify: `windows/app/src/WindowFit.h` e `WindowFit.cpp`, com o `BigVideoBox`, portátil.
- Modify: `windows/app/src/MainWindow.h` e `MainWindow.cpp`, `EngineHost.*` e `main.cpp`, com o gancho `videoWindow`, a sessão e o aviso das câmeras.
- Test: `tests/desktop/test_window_fit.cpp`.

**Interfaces:**
- Consumes: `SetCameraPaused` (Task 2), o `RefreshAudioDevices` do `DesktopApp`, que relê as câmeras (Task 6), e o `hooks.videoWindow` (Task 6).
- Produces: `FitBox BigVideoBox(const FitArea& work, unsigned dpi);`. Ele dá 1280×800 lógicos no DPI dado, cortados na área de trabalho e centrados nela.
- Produces (`MainWindow`): `enum class VideoMode { Normal, Big, Fullscreen };` e `void SetVideoMode(VideoMode mode);`.
- Produces (`EngineHost`): `void SetCameraPaused(bool paused);`. Ele não espera o motor: guarda o valor e o aplica quando o motor fica pronto. Por isso pode ser chamado da thread da janela.

**As regras:**
- **A caixa do `Normal`** é guardada uma vez, ao sair do `Normal` (para o `Big` ou para a tela cheia). A volta ao `Normal` a devolve.
- **O `Big`** aplica o `BigVideoBox` do monitor da janela, pelo `MonitorFromWindow`.
- **O `Fullscreen`** guarda o estilo da janela, tira a borda e cobre o `rcMonitor`. A saída da tela cheia (para o `Big` ou para o `Normal`) devolve o estilo. Na tela cheia, o `HitTest` não dá bordas de redimensionar.
- **Fora do `Normal`:**
  - a janela não grava o tamanho nem o lugar no `config.json`, e o tamanho grande nunca vira o tamanho da pessoa;
  - o encaixe da janela (o `Refit` e o `WM_DPICHANGED`) usa a caixa do modo no monitor de agora: o `BigVideoBox` ou o `rcMonitor`.
- **A sessão bloqueada ou desconectada** (o `locked_` e o `disconnected_` que já existem) chama `SetCameraPaused(true)`, e a volta chama `false`.
- **As câmeras que entram e saem:** o `MainWindow` também se registra para as interfaces de câmera (`KSCATEGORY_VIDEO_CAMERA`), como já faz com o `KSCATEGORY_AUDIO`. O aviso de sempre, o `devicesChanged`, 1 s depois do último, já relê as câmeras (Task 6). O comentário do topo do `MainWindow.h` passa a dizer isso.

- [ ] **Step 1: Escreva os testes que falham:**
  - `"the big box is 1280x800 at 100%"`: numa área `{0,0,1920,1040}` com DPI 96, dá `{320,120,1280,800}`.
  - `"the big box at 150% is capped by the work area"`: numa área `{0,0,1920,1040}` com DPI 144, dá `{0,0,1920,1040}`.
  - `"the big box is centered on a second monitor"`: numa área `{1920,0,3840,1080}` com DPI 96, dá `{2240,140,1280,800}`.
- [ ] **Step 2: Rode o desktop e veja os testes falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente** o `BigVideoBox` e a parte do Windows.
- [ ] **Step 4: Rode o desktop.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` e o `android` precisam ficar verdes. Este é o fim da etapa 1.

```bash
git commit -m "feat(video): a janela grande, a tela cheia, a câmera pausada na tela bloqueada e as câmeras que entram e saem"
```
