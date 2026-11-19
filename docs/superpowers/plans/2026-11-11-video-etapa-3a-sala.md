# Vídeo em grupo, etapa 3a — a sala por dentro — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Starsonic Phone para Windows ganha a sala de vídeo por dentro, até 6 pessoas (quem monta e mais 5), sem nenhuma tela nova. O motor liga para os convidados, mistura o som de todos com todos e monta os mosaicos. O núcleo publica a sala, recebe os comandos dela e leva o mosaico de quem montou à memória do `remoto`.

**Architecture:**
- **O motor** (`starsonic/phone`, PJSIP 2.17):
  - a sala é mais uma "linha" da tabela das ligações (`CallTable`), com um id próprio, tirado do mesmo contador das ligações: até 5 convidados e uma ligação de fora;
  - o som: a mesa de áudio da PJSIP liga cada convidado na sala a cada outro e ao nosso som. Fora da sala, o nosso som vai só para a ligação de fora;
  - o mosaico: um módulo puro (`RoomMosaic`: a arrumação, o encaixe e a montagem com o `I420Scale` da libyuv) e um dispositivo de vídeo nosso, "Starsonic sala", com um lugar por convidado e um para quem montou. A PJSIP pede o quadro, e o dispositivo monta o mosaico na hora com a última imagem de cada um, que o desenhista nosso guarda numa loja com trava e cópia;
  - a qualidade da sala (spec 7) vai aos codecs, e um re-INVITE refaz o vídeo de quem já está na sala.
- **O núcleo:**
  - o controlador (`CallController`, portátil) trata a sala como uma linha. A ligação de fora é a segunda linha, com as regras de hoje: ela toca, atender tira você da sala, você volta sozinho quando ela acaba, e o "Voltar para a sala" é o Alternar;
  - o `DesktopApp` publica `ligacao.sala`, recebe `salaAdicionar`, `salaTirar`, `salaEncerrar` e `salaVoltar`, e escreve as linhas `sala:` do diagnóstico;
  - o mosaico de quem montou viaja pelo `FrameSink` com o id da sala, que é o `ligacao.top.id` enquanto você está na sala: o `FrameRouter` do executável o leva ao `remoto` sem mudança.
- **Os testes:** os do motor rodam no Linux, contra o registrador falso. Ele aprende a ter vários convidados com vídeo ao mesmo tempo, cada um com uma imagem de uma cor: um H.264 montado no Python, só com macroblocos I_PCM. Os testes do controlador e do núcleo usam o motor falso.

**Tech Stack:**
- C++17 com doctest e nlohmann/json.
- PJSIP 2.17: o pjsua2, e a API C da pjsua e da pjmedia (a `vid_conf`, os dispositivos de vídeo).
- A libyuv 1678 do próprio pjproject (o `I420Scale`).
- O OpenH264 e a libvpx, que já estão no build.
- O Python 3 do registrador falso.

**Spec:** `docs/superpowers/specs/2026-11-11-starsonic-phone-video-grupo-design.md`, aprovada pelo responsável em 11/11/2026.
- Valem nesta etapa:
  - 4.2;
  - 6.1, 6.2, 6.3 e 6.5 (a ponte; a ponte falsa é da 3b);
  - 7, 9 e 11.1;
  - 11.2, itens 1 a 3;
  - 12, item 3.
- Ficam para a etapa 3b, depois do quadro aprovado:
  - 4.1, 6.4 e os textos da 10 (as falhas usam os textos de hoje);
  - 11.2, itens 4 e 5, e 11.3;
  - as fotos, o roteiro e as notas.

## Global Constraints
- **O tamanho da sala:** até 6 pessoas, quem monta e mais 5 (`kRoomMaxGuests = 5`). Os convidados que estão sendo chamados contam.
- **`PJSUA_MAX_CALLS` 8:**
  - no `build/config_site.h` (o Windows) e no `build/linux/config_site.h` (os testes);
  - o `build/android/config_site.h` fica com 4: o Android não tem vídeo, nem sala.
- **A qualidade** (spec 7), pelo número de convidados da sala, contando os chamados. Os valores de cada linha são o mínimo, campo a campo, entre a qualidade escolhida e o teto da linha:

  | Convidados | Imagem | Quadros por segundo | Taxa |
  | --- | --- | --- | --- |
  | 1 (sem sala) | a escolhida | a escolhida | a escolhida |
  | 2 ou 3 | até 640×480 | até 25 | até 800 kbit/s |
  | 4 ou 5 ("Média da sala") | até 640×480 | até 15 | até 600 kbit/s |

  Assim, a Baixa (320×240, 15 qps, 300 kbit/s) nunca sobe.
- **O mosaico de quem montou:** 1280×720, a 25 qps, na memória do `remoto`, com o id da sala.
- **A arrumação:**
  - uma imagem ocupa tudo;
  - duas ficam lado a lado;
  - três e quatro ficam numa grade de 2×2;
  - cinco ficam em duas linhas, de 3 e 2.

  As células são iguais, em pixels pares, e a linha incompleta fica no centro. Cada imagem encaixa na sua célula sem deformar, com faixas onde sobra, escalada pelo `I420Scale` da libyuv (bilinear).
- **O fundo** (as faixas, e o quadro sem imagem): o `#04060e` da página, em I420 BT.601 de faixa limitada, Y 21, U 132, V 127.
- **A ligação de fora:**
  - só uma de cada vez, e só com voz: sem o `offered`, sem o 183 de um Porteiro e sem o `refused`;
  - outra que chega leva 486, como hoje.
- **O iPhone e o Android não montam sala:**
  - o motor do baresip e o do PJSIP sem vídeo devolvem -1 no `RoomAdd` e o `RoomInfo{}` no `Room()`, e nunca avisam o `OnRoom`;
  - no modo iPhone, o núcleo recusa os quatro comandos, e o `ligacao.sala` é sempre `null`.
- **A câmera segue as regras da 0.3.0:** ela só liga num clique da pessoa. Desligada, pausada (a tela bloqueada) ou com você fora da sala, o seu quadro fica com o fundo para os convidados, e a câmera fecha se nada mais a usa.
- **Nada muda numa ligação comum nem na videochamada de duas pessoas** (spec 2). As suítes de hoje (o `test_engine_video.cpp`, o controlador e o desktop) seguem verdes sem mudar uma asserção.
- **O diagnóstico** tem uma linha por evento da sala, exatamente estas, sem nome nem número de telefone:
  - `sala: comecou`;
  - `sala: entrou (<n> na sala)` e `sala: saiu (<n> na sala)`, com `<n>` os convidados que atenderam e seguem na sala;
  - `sala: falhou (<codigo>)`, com o código SIP do fim, ou 0;
  - `sala: fora` e `sala: voltou`;
  - `sala: acabou`.
- **Nenhuma tela:** o `windows/ui` não muda. A ponte falsa, as fotos, a fumaça, o roteiro e as notas são da 3b, e o núcleo publica tudo o que as telas da 3b vão ler (spec 6.3).
- **Os testes do motor numa máquina de 2 CPUs:**
  - a sala nos testes usa a qualidade Baixa, menos na Task 6;
  - um convidado cuja imagem não importa atende sem vídeo;
  - a imagem de cada convidado tem 64×48, a 10 qps;
  - cada caso leva até cerca de 20 s, e o `test_engine_room.cpp` inteiro, menos de 3 min.
- **O texto:**
  - os nomes dos testes em inglês;
  - os comentários e os documentos em português, no estilo de cada arquivo. O `starsonic/desktop` e o `windows/app/src` são escritos sem acento;
  - os literais em ASCII (o `build/check_source_text.py`), e o `build/*.h` inteiro em ASCII;
  - nenhum nome de produto ou de fabricante além de Starsonic nos arquivos. O MicroSIP só aparece nos documentos, como aparelho de teste.
- **Os commits** levam os trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
  - O push vai só para a branch `video-etapa-3`, sem force e sem tags, releases ou segredos.
  - Cada Task termina com o CI verde (o `build` e o `android`), conferido pelo `gh api` REST. O GraphQL está bloqueado.

## Review Focus
1. **Um convidado que põe a sala em espera,** com a música da central tocando. A música não chega à sala, o quadro dele fica "Em espera", com o fundo, e ele não recebe o mosaico até voltar. Teste: a Task 5 (`a guest who puts the room on hold is held, out of the mix and gets no mosaic until it comes back`).
2. **Um convidado sem vídeo:** um telefone sem câmera, o Android ou o iPhone. O quadro dele fica com o fundo, ele ouve e é ouvido por todos, e conta no limite. Testes: a Task 4 (`a guest without video is a background tile and still hears and is heard`) e a Task 3 (`the room holds five guests counting the ones being called`, com os convidados sem vídeo).
3. **A ligação de onde a sala nasceu sai primeiro,** e os outros ficam. A sala continua com o mesmo id, e o som e o mosaico se arrumam. Testes: a Task 3 (`the room outlives the call it was born from`) e a Task 4 (`the host's mosaic rearranges when a guest leaves`).
4. **Uma câmera que sai e volta no meio da sala:** os ids da lista de vídeo da PJSIP mudam, também os dos lugares da sala. Os mosaicos dos convidados continuam, cada um no seu lugar. Teste: a Task 4 (`a camera that leaves and comes back during the room keeps every guest's mosaic`).
5. **O app fechando com a sala de pé.** Todas as ligações da sala desligam, nenhum quadro chega ao sink depois do `SetFrameSink(nullptr)`, e nada cai. Teste: a Task 4 (`destroying the engine during a room hangs up every guest and no frame arrives after SetFrameSink(nullptr)`).

## O desenho (as decisões desta etapa)
1. **A API do motor** (`SipEngine.h`; os tipos em `Video.h`):
   - entram só o `int RoomAdd(const std::string& number)`, o `RoomInfo Room() const` e o evento `OnRoom(const RoomInfo&)`;
   - o id da sala vale nos métodos de sempre:
     - o `Hangup(idDaSala)` encerra a sala;
     - o `Activate(idDaSala)` e o `SetHold(idDaSala, false)` são o "Voltar para a sala";
     - o `SetCamera(idDaSala, on)` é a nossa câmera na sala;
     - o `Video(idDaSala)` e o `OnCallVideo(idDaSala, ...)` são o vídeo da sala;
   - o "Tirar da sala" é o `Hangup` do convidado.

   Assim, o controlador trata a sala como uma linha sem regra nova para o som e a espera.
2. **As ligações:**
   - a tabela tem 6 vagas: 5 convidados e uma ligação de fora;
   - sem sala, valem as regras de hoje: até duas ligações, e a segunda só com a primeira confirmada;
   - o `PJSUA_MAX_CALLS` vai a 8 (5 + a de fora + a que chega e leva 486 + folga) no Windows e no Linux dos testes. O Android fica com 4, porque não monta sala, e mudar o `build/android/config_site.h` refaria o cache das dependências do Android por nada.
3. **A ligação de fora** (spec 4.2):
   - **chegando:** com a sala de pé e nenhuma ligação de fora, ela toca só com a voz, com o 180 sem vídeo (nem o 183 de um Porteiro) e sem o `offered`. Com uma ligação de fora, outra que chega leva 486;
   - **feita:** um `MakeCall` com a sala de pé também é a ligação de fora, só com a voz;
   - **atender ou ligar:** tira o nosso som e a nossa câmera da sala (o `out`), sem re-INVITE para os convidados;
   - **voltar:** o `Activate(idDaSala)` traz você de volta e põe a de fora em espera (re-INVITE sendonly), se ela está em andamento;
   - **o fim da de fora:** o motor não volta sozinho para a sala, como hoje com duas ligações. Quem volta é o controlador, como na volta sozinha.
4. **As pausas:**
   - o `SendPaused` e o `ReceivePaused` nunca pausam um convidado por causa de outra ligação, da sala ou de fora;
   - um convidado que nos põe em espera (o áudio em `REMOTE_HOLD`) fica "em espera": sai da mesa de áudio, a música da central não chega a ninguém, e o envio para ele para, porque a direção negociada não deixa mandar (o `STOP_TRANSMIT` de hoje). O quadro dele fica com o fundo, e ele volta sozinho quando retoma.
5. **O som** (o `Route` e o `AudioLinks`, para N vagas):
   - cada convidado na sala é ligado a cada outro convidado na sala, nos dois sentidos;
   - o nosso som (a porta 0) é ligado a cada convidado na sala enquanto você está nela;
   - fora da sala, o nosso som vai só para a ligação de fora;
   - quem está sendo chamado e quem está em espera não é ligado a nada;
   - o `AudioLinks(convidado)` lista o 0 e os ids dos outros convidados ligados a ele, e o `AudioLinks(idDaSala)` é vazio.
6. **O mosaico** (`RoomMosaic`): as Global Constraints dão a arrumação, o encaixe, o fundo e os tamanhos. O algoritmo exato das células e do encaixe está na Task 1. Quem entra em cada um:
   - **no de quem montou:** todos os convidados, na ordem em que entraram, também os que estão sendo chamados (o quadro do "Chamando…");
   - **no de um convidado:** a nossa câmera primeiro, depois os outros convidados que já atenderam (também os em espera, com o fundo), na ordem em que entraram, sem ele mesmo;
   - **com o fundo:** quem está sendo chamado ou em espera, quem não manda imagem (sem quadro há 2 s), e a nossa câmera desligada, pausada, fora da sala ou que caiu.
7. **A porta de cada convidado — aqui o plano muda a sugestão do briefing e o detalhe da spec 6.2:**
   - **O problema:** o `pjsua_vid_conf_add_port` com o `pjsua_vid_conf_connect` à porta `PJMEDIA_DIR_ENCODING` da ligação mandaria nada. A pjsua cria todo stream de vídeo com a codificação pausada (`pjsua_vid.c`, "Temporarily pause the encoding"). Com o `autoTransmitOutgoing` desligado (a conta do motor), só o `START_TRANSMIT` a retoma, e ele sempre liga à codificação o dispositivo de captura da ligação. A porta ligada à mão cairia num codificador pausado, ou dividiria a imagem com a câmera, que o `START_TRANSMIT` liga junto.
   - **A decisão:** o mosaico de cada convidado é um dispositivo de captura nosso, "Starsonic sala 1" a "Starsonic sala 5", um por lugar da sala. A ligação troca de dispositivo pelo `PJSUA_CALL_VID_STRM_CHANGE_CAP_DEV` e manda pelo `START_TRANSMIT` de hoje, que já são o caminho da câmera.
   - **O que não muda da spec:** continua sendo uma porta nossa na `vid_conf` da PJSIP (a pjsua põe lá a porta passiva da captura), ligada à codificação da ligação no lugar da câmera. Ela monta o mosaico quando a PJSIP pede um quadro.
   - **De graça:** a pausa da direção (um convidado em espera), o re-INVITE que refaz o stream e a volta à câmera (um convidado só) seguem o caminho da 0.3.0.
   - **As vagas da PJSIP:** os lugares dizem ter a prévia nativa (`PJMEDIA_VID_DEV_CAP_INPUT_PREVIEW`), para a janela deles não ganhar uma porta do desenhista. Numa sala cheia, isso dá 24 das 32 vagas da `vid_conf` e 12 das 16 janelas da pjsua (`PJSUA_MAX_VID_WINS`). Os 7 dispositivos nossos (o desenhista e os 6 da sala) deixam 9 dos 16 da lista de vídeo para as câmeras.
8. **A loja das imagens e as threads** (spec 13, o terceiro risco):
   - O desenhista nosso entrega cada quadro, de cada ligação e da prévia da câmera, a um `FrameTap`, depois do portão e antes do sink. A loja da sala copia ali a última imagem das fontes do plano: os convidados e a nossa câmera (`kHostTile`).
   - A loja tem um mutex só dela, a última trava de todas. O desenhista a pega com a trava dele presa, a tabela troca o plano com o `mutex_` dela preso, e a montagem a pega sozinha.
   - A thread do relógio da `vid_conf` da PJSIP monta os mosaicos dos convidados e o de quem montou: é ela que chama o `get_frame` das portas de captura. Na prática, é a mesma thread que entrega ao desenhista as imagens decodificadas e a prévia (os dispositivos passivos). A trava existe para o resto: a câmera ativa, a tabela e o fim.
   - Uma fonte que deixa de valer perde a imagem guardada: uma imagem velha nunca aparece.
9. **O mosaico de quem montou:**
   - é a prévia do dispositivo "Starsonic sala" (o lugar 0) no desenhista nosso, em 1280×720 a 25 qps, ligada ao id da sala pelo `BindRendererStream`;
   - chega ao `FrameSink` como `OnRemoteFrame(idDaSala, quadro)`. As imagens de cada convidado continuam chegando com o id de cada ligação, que o executável descarta;
   - o núcleo publica a sala como a `ligacao.top`, com `id` igual ao id da sala, e o `ShellState.topCallId` passa a ser esse id. Assim, o `FrameRouter` e o `VideoSink` de hoje levam o mosaico ao `remoto` sem mudança;
   - a memória do `remoto` esvazia quando a sala nasce e quando ela acaba (a regra de hoje: a ligação da vista mudou).
10. **A qualidade** (spec 7):
    - o alvo é o `RoomQuality(escolhida, convidados)`, contando os chamados. Assim, a imagem do 4º convidado já nasce na "Média da sala";
    - a mudança vai aos parâmetros de fábrica dos codecs: o tamanho, os quadros por segundo e a taxa;
    - cada convidado que já atendeu, com o codificador diferente do alvo, recebe um re-INVITE (o `vid_cnt` 1). A "atualização esperta" da pjsua refaz o stream porque o `enc_fmt` mudou, e um re-INVITE sai por convidado por mudança de alvo, mesmo que o aparelho dele não chegue ao alvo;
    - no `RoomAdd` e no `SetVideoSettings`, ela vale na hora, na thread de quem chama; na saída de um convidado, ela vale no temporizador da tabela;
    - quando a sala acaba, volta a escolhida, com o mesmo re-INVITE para quem ficou;
    - a taxa da conta (o `rateControlBandwidth`) fica a da escolhida: é um teto, e a da sala nunca passa dela.
11. **Um convidado só:**
    - com um convidado na sala e outros sendo chamados, ele recebe a nossa câmera direto, como na 0.3.0;
    - com dois ou mais que já atenderam, também os em espera, cada um recebe o seu mosaico;
    - quando sobra um convidado, sem ninguém sendo chamado, a sala acaba: o `OnRoom` com o `ended`, e ele vira uma ligação comum, com o desejo da câmera da sala.
12. **O núcleo:**
    - o `CallController` guarda a sala como uma linha: o id da sala, a fase ativa e o `activeSinceMs` da ligação de onde ela nasceu, com os convidados dentro. As regras de duas linhas dão a ligação de fora;
    - o `ligacao.sala` publica os convidados, cada um com o id, o número, o nome, o estado (`chamando`, `naSala` ou `emEspera`), a `imagem` e o `quadro` (de 0 a 1), o `fora` e a `cheia`;
    - cada convidado vai aos Recentes no fim da ligação dele, e um que não entra mostra `<nome ou número>: <motivo>` por 2 s, como o colega da consulta;
    - o `hangup` com a sala de cima é o `salaEncerrar`: a página pergunta antes.
13. **O registrador falso** aprende, por número chamado:
    - uma imagem própria: a cor, num H.264 de 64×48 com macroblocos I_PCM. O OpenH264 dos testes decodifica esse quadro com a cor exata, o que foi conferido ao escrever este plano;
    - o eco só daquele convidado, ou nenhum vídeo;
    - as contagens por convidado;
    - um número que só toca (`180`);
    - o BYE e a espera vindos do convidado.

## As pastas e as responsabilidades
- **`starsonic/phone/Video.h` e `Video.cpp`:** os tipos portáteis da sala (`RoomTile`, `RoomMember`, `RoomInfo` e os `operator==`). O `Video.cpp` já entra em todo lugar que compila o controlador, também no app do iPhone, que fica fora deste repositório: nenhum `.cpp` novo entra nesses lugares.
- **`starsonic/phone/RoomMosaic.h` e `RoomMosaic.cpp`:** a arrumação, o encaixe, a qualidade da sala, os quadros de cada convidado e a montagem. É C++ puro; o `.cpp` só compila com o `PJMEDIA_HAS_VIDEO`, porque usa a libyuv.
- **`starsonic/phone/RoomVideo.h` e `RoomVideo.cpp`** (internos, só com o vídeo): a fábrica "Starsonic sala", com o lugar 0 (de quem montou) e os lugares 1 a 5, e a loja das imagens com o plano.
- **`starsonic/phone/VideoRenderer.*`:** o `FrameTap`.
- **`starsonic/phone/EngineCall.h`, `EngineCall.cpp`, `EngineCallVideo.cpp` e `EngineRoom.cpp`** (novo): a sala na tabela. As funções da sala ficam no `EngineRoom.cpp`, e os ganchos nos métodos de sempre.
- **`starsonic/phone/SipEngine.h` e `SipEngine.cpp`, e o `baresip/SipEngineBaresip.cpp`:** a API e o "sem sala".
- **`starsonic/phone/CallEngine.*` e `CallController.*`:** o `RoomAdd` no porto, e a sala como uma linha.
- **`starsonic/desktop/Protocol.*` e `DesktopApp.*`:** os comandos, o `ligacao.sala` e as linhas `sala:`.
- **`windows/app/src/EngineHost.*`:** repassa o `RoomAdd` e o `OnRoom`. Só o Windows compila esse código, e quem o confere é o CI.
- **`tests/smoke/fake_registrar.py` e `tests/python/test_fake_registrar.py`:** o registrador da sala.
- **`tests/phone/registrar_fixture.h` e `call_fixture.h`:** os comandos novos, as cores no `TestSink` e o `OnRoom` no `RecordingListener`.
- **`build/`, `windows/app/CMakeLists.txt` e `docs/`:** os cabeçalhos da libyuv, as 8 ligações, as notas do build e a ponte.

## A ponte nova (o resumo; o texto completo vai para o `docs/ponte-windows.md` na Task 8)
**Os pedidos:**
```json
{"v":1,"cmd":"salaAdicionar","numero":"2004"}
{"v":1,"cmd":"salaAdicionar","numero":"+55 11 98888-7777","contato":true}
{"v":1,"cmd":"salaTirar","id":31}
{"v":1,"cmd":"salaEncerrar"}
{"v":1,"cmd":"salaVoltar"}
```
**O estado** (a sala de cima, com um convidado na sala e um chamando):
```json
"ligacao":{
  "top":{"id":30,"number":"","name":"","incoming":false,"phase":"active","activeSinceMs":1762873200000,"held":false,
         "video":{"oferece":false,"ativo":true,"imagem":true,"camera":true,"cedo":false,"porteiro":false}},
  "second":null,"secondKind":"none","muted":false,"conference":false,"conferenceSinceMs":0,
  "consulting":false,"colleagueActive":false,
  "sala":{"id":30,"fora":false,"cheia":false,"participantes":[
    {"id":11,"numero":"2002","nome":"Ana Souza","estado":"naSala","imagem":true,
     "quadro":{"x":0,"y":0,"largura":0.5,"altura":1}},
    {"id":31,"numero":"2004","nome":"","estado":"chamando","imagem":false,
     "quadro":{"x":0.5,"y":0,"largura":0.5,"altura":1}}]}}
```
Sem sala, `ligacao.sala` é `null`. Fora da sala, a de cima é a ligação de fora, e a sala é a `second` (`secondKind` `held`, `sala.fora` `true`).

## Como rodar os testes
- **O pjproject do Linux** (a Task 1 muda o script; rode de novo uma vez): `bash build/linux/build-pjproject.sh work/pjproject-linux work/pj-linux`.
- **O motor:**
  ```bash
  cmake -S tests/phone -B work/build-phone -DPJPROJECT_PREFIX="$PWD/work/pj-linux"
  cmake --build work/build-phone -j 2
  work/build-phone/phone_tests -sf='*room*'             # a sala: test_room_mosaic.cpp e test_engine_room.cpp
  ctest --test-dir work/build-phone --output-on-failure  # a suíte inteira, no fim de cada Task do motor
  ```
- **O controlador:** `work/build-phone/call_controller_tests`.
- **O registrador:** `python3 -m unittest discover -s tests/python` e `python3 -m unittest tests/smoke/test_fake_registrar.py`.
- **O núcleo:** `cmake -S tests/desktop -B work/build-desktop -G Ninja && cmake --build work/build-desktop -j 2 && work/build-desktop/desktop_tests`.
- **O motor do baresip e o Windows:** o CI (o job "Testes do núcleo (Linux)" do `build.yml`, e o job do Windows).
- **O CI:** `gh api "repos/LucasCPena/starsonic-phone/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'`. O `build` e o `android` precisam ficar verdes.

---

### Task 1: O mosaico, puro, e a compilação da sala

**Files:**
- Create: `starsonic/phone/RoomMosaic.h` e `RoomMosaic.cpp`. O `.cpp` fica inteiro dentro de `#if PJMEDIA_HAS_VIDEO`, com o `#include <libyuv/scale.h>` dentro; o Android compila o arquivo vazio.
- Create: `tests/phone/test_room_mosaic.cpp`, também dentro de `#if PJMEDIA_HAS_VIDEO`.
- Modify: `starsonic/phone/Video.h` e `Video.cpp` (o `RoomTile` e o `operator==` dele).
- Modify: `build/linux/build-pjproject.sh`. Depois do `make install`, ele copia `third_party/yuv/include/libyuv.h` e `third_party/yuv/include/libyuv/` para `$PREFIX/include/`. O `make install` não os instala, e a biblioteca já entra no link pelo `Libs.private` do `libpjproject.pc` (`-lyuv-...`), que o `tests/phone/CMakeLists.txt` usa (`PJ_STATIC_LDFLAGS`).
- Modify: `build/linux/config_site.h` (o `PJSUA_MAX_CALLS` de 4 para 8) e `build/config_site.h` (`#define PJSUA_MAX_CALLS 8`, com um comentário ASCII: 5 convidados, a ligação de fora e folga).
- Modify: `windows/app/CMakeLists.txt`. Os includes ganham `${PJPROJECT_DIR}/third_party/yuv/include`. A libyuv já está dentro da `libpjproject` do Windows: o conversor da PJSIP a usa hoje.
- Modify: `docs/build-notes.md`, com a subseção "A sala de vídeo": os cabeçalhos da libyuv, as 8 ligações e por que o Android fica com 4.

**Interfaces:**
- Produces (`Video.h`, com o `operator==` no `Video.cpp`): `struct RoomTile { double x = 0; double y = 0; double width = 0; double height = 0; };`, um quadro de 0 a 1 (o x e o y do canto de cima à esquerda).
- Produces (`RoomMosaic.h`):

```cpp
struct PixelRect { int x = 0; int y = 0; int width = 0; int height = 0; };
bool operator==(const PixelRect& a, const PixelRect& b);
std::vector<PixelRect> MosaicCells(int count, int width, int height);   // vazio fora de 1 a 5
PixelRect FitInside(int sourceWidth, int sourceHeight, const PixelRect& cell);   // {} sem imagem
RoomTile UnitTile(const PixelRect& cell, int width, int height);         // de 0 a 1
QualityValues RoomQuality(VideoQuality chosen, int guests);
constexpr int kHostTile = -1;   // a nossa câmera num mosaico de convidado (o mesmo valor do kLocalFrames)
std::vector<int> GuestTiles(const std::vector<int>& inRoom, int guest);
constexpr int kHostMosaicWidth = 1280;
constexpr int kHostMosaicHeight = 720;
constexpr int kHostMosaicFps = 25;
constexpr uint8_t kMosaicBackgroundY = 21, kMosaicBackgroundU = 132, kMosaicBackgroundV = 127;
struct I420Target {   // a imagem que o mosaico escreve (os planos e os passos)
    int width = 0; int height = 0;
    uint8_t* y = nullptr; int yStride = 0;
    uint8_t* u = nullptr; int uStride = 0;
    uint8_t* v = nullptr; int vStride = 0;
};
// O fundo em toda a imagem, e cada quadro (nullptr: sem imagem) encaixado na sua célula de MosaicCells(tiles.size(),
// out.width, out.height), pelo libyuv::I420Scale com o kFilterBilinear. Fora de 1 a 5 quadros, só o fundo.
void ComposeMosaic(const std::vector<const I420Frame*>& tiles, const I420Target& out);
```

**O algoritmo** (os testes dependem dele exatamente). `Even(v)` é o maior par que não passa de `v`. As contas são inteiras, em 64 bits:

```
MosaicCells(count, W, H):
  porLinha = count == 1 ? 1 : (count <= 4 ? 2 : 3);   linhas = teto(count / porLinha)
  cw = Even(W / porLinha);   ch = Even(H / linhas);   y0 = Even((H - linhas * ch) / 2)
  linha r: n = min(porLinha, count - r * porLinha);   x0 = Even((W - n * cw) / 2)
           células {x0 + i * cw, y0 + r * ch, cw, ch}, i = 0..n-1
FitInside(sw, sh, c):
  sem imagem (sw ou sh <= 0): {}
  se sw * c.height >= sh * c.width:  w = c.width;  h = max(2, Even(sh * c.width / sw))
  senão:                             h = c.height; w = max(2, Even(sw * c.height / sh))
  {c.x + Even((c.width - w) / 2), c.y + Even((c.height - h) / 2), w, h}
RoomQuality(escolhida, n): v = ValuesOf(escolhida); n <= 1: v
  n <= 3: {min(v.width,640), min(v.height,480), min(v.fps,25), min(v.kbps,800)}
  senão:  {min(v.width,640), min(v.height,480), min(v.fps,15), min(v.kbps,600)}
GuestTiles(naSala, convidado) = [kHostTile] + naSala sem o convidado, na mesma ordem
```

- [ ] **Step 1: Escreva os testes que falham** (`test_room_mosaic.cpp`):
  - `"the cells follow the room's layout for 1 to 5 images at each output size"`:
    - `MosaicCells(1,1280,720) == {{0,0,1280,720}}`;
    - `MosaicCells(2,1280,720) == {{0,0,640,720},{640,0,640,720}}`;
    - `MosaicCells(3,1280,720) == {{0,0,640,360},{640,0,640,360},{320,360,640,360}}`;
    - `MosaicCells(4,1280,720)`: os quatro quartos de 640×360;
    - `MosaicCells(5,1280,720) == {{0,0,426,360},{426,0,426,360},{852,0,426,360},{214,360,426,360},{640,360,426,360}}`;
    - `MosaicCells(5,640,480) == {{2,0,212,240},{214,0,212,240},{426,0,212,240},{108,240,212,240},{320,240,212,240}}`;
    - `MosaicCells(5,320,240) == {{0,0,106,120},{106,0,106,120},{212,0,106,120},{54,120,106,120},{160,120,106,120}}`;
    - `MosaicCells(0,...)` e `MosaicCells(6,...)` vazios.
  - `"an image fits its cell without distortion, centered on even pixels"`:
    - `FitInside(640,480,{0,0,640,360}) == {80,0,480,360}`;
    - `FitInside(1280,720,{0,0,640,720}) == {0,180,640,360}`;
    - `FitInside(175,143,{0,0,320,240}) == {14,0,292,240}`;
    - `FitInside(0,0,{0,0,320,240}) == PixelRect{}`;
    - `FitInside(1,1,{0,0,2,2}) == {0,0,2,2}`.
  - `"the unit tiles of the host's mosaic go from 0 to 1"`: `UnitTile({640,0,640,720},1280,720) == RoomTile{0.5,0,0.5,1}` e `UnitTile({426,0,426,360},1280,720) == RoomTile{426.0/1280,0,426.0/1280,0.5}`.
  - `"the room's quality follows spec 7 and never raises the chosen one"`:
    - `RoomQuality(High,1) == {1280,720,30,1500}`;
    - `RoomQuality(High,2) == {640,480,25,800}` e `RoomQuality(Medium,3) == {640,480,25,800}`;
    - `RoomQuality(High,4) == {640,480,15,600}` e `RoomQuality(Medium,5) == {640,480,15,600}`;
    - `RoomQuality(Low,3)` e `RoomQuality(Low,5) == {320,240,15,300}`.
  - `"a guest's mosaic has us first and the others in order, never the guest"`: `GuestTiles({11,13,14},13) == {kHostTile,11,14}`, `GuestTiles({11,13},11) == {kHostTile,13}` e `GuestTiles({11},11) == {kHostTile}`.
  - `"the mosaic puts each color in its cell with the background in the bars and in the empty cells"`. Monte em 320×240 os quadros {laranja 64×48 (150,44,200), roxo 175×143 (60,200,180), nullptr}:
    - o centro de cada célula, nos três planos, é a cor da imagem dela;
    - a terceira célula, (80,120,160,120), é o fundo;
    - os cantos da linha de baixo são o fundo;
    - as faixas do roxo (175×143 numa célula de 160×120 dá `{166,0,146,120}`) são o fundo nos pixels 160 a 165 da linha 60.
  - `"odd image sizes keep the chroma under the luma"`: um quadro 175×143 de U e V conhecidos dá, em cada pixel par do retângulo encaixado, o U e o V dele no plano de cor (`(x/2, y/2)`).
  - `"an odd output size leaves the last row and column as background"`: montado em 321×241, a coluna 320 e a linha 240 são o fundo.
- [ ] **Step 2: Rode o motor e veja os testes falharem.** Esperado: a compilação falha, porque o `RoomMosaic.h` não existe.
- [ ] **Step 3: Implemente** o `RoomMosaic`, o script, os dois `config_site.h`, o include do Windows e as notas. Rode o `build-pjproject.sh` de novo.
- [ ] **Step 4: Rode `phone_tests -sf='*room*'` e depois a suíte inteira do motor e os scripts.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `android` refaz o pjproject do Linux uma vez (a chave do cache leva o `build/linux/**`), e o `build` compila o Windows com o include novo.

```bash
git add starsonic/phone/RoomMosaic.* starsonic/phone/Video.h starsonic/phone/Video.cpp tests/phone/test_room_mosaic.cpp build windows/app/CMakeLists.txt docs/build-notes.md
git commit -m "feat(video): o mosaico da sala, puro, e a compilação com a libyuv e 8 ligações"
git push origin video-etapa-3
```

### Task 2: O registrador falso aprende a sala

**Files:**
- Modify: `tests/smoke/fake_registrar.py` (a docstring dos comandos, e o código).
- Modify: `tests/python/test_fake_registrar.py`.
- Modify: `tests/phone/registrar_fixture.h` (o `FakeRegistrar`, e o `OnRoom` no `RecordingListener` fica para a Task 3).
- Modify: `tests/phone/call_fixture.h` (as cores no `TestSink`).
- Create: `tests/phone/test_engine_room.cpp`. Os testes da sala ficam dentro de `#if PJMEDIA_HAS_VIDEO`; o outro ramo ganha o "sem sala" na Task 3.

**O registrador** (por `<alvo>`: o usuário da Request-URI do INVITE do telefone; a ligação de um alvo é a última atendida do telefone para ele):
- **`VIDEO SOURCE <alvo> echo|none|color <Y> <U> <V>|default`.** Vale para a ligação de agora do alvo e para as próximas, e o `default` tira a escolha:
  - `echo`: devolve, só desse alvo, cada datagrama que chega do endereço de vídeo da ligação dele (o `c=` e a porta do `m=video` da oferta do telefone, atualizados a cada re-INVITE), com o SSRC trocado, como o `VIDEO ECHO`;
  - `none`: a resposta a um INVITE ou re-INVITE desse alvo leva o `m=video` com a porta 0 (um convidado sem vídeo);
  - `color Y U V`, cada valor de 16 a 235: depois do 200 com vídeo, a PORTA manda ao endereço de vídeo dessa ligação, até o fim dela, uma imagem dessa cor (as regras abaixo);
  - um nome desconhecido, ou uma cor fora da faixa: `ERR bad-command`.
- **A imagem da cor:** um H.264 Constrained Baseline de 64×48, a 10 quadros por segundo. Cada quadro tem três NAL: o SPS, o PPS e o IDR, todos com o `nal_ref_idc` 3 e a prevenção de emulação.
  - **O SPS:** `profile_idc` 66; `constraint_set0` e `constraint_set1` em 1 e os outros em 0 (o `42e0`); `level_idc` 31; `seq_parameter_set_id` 0; `log2_max_frame_num_minus4` 0; `pic_order_cnt_type` 2; `max_num_ref_frames` 1; sem lacunas; 4×3 macroblocos; `frame_mbs_only` 1; `direct_8x8_inference` 1; sem corte e sem VUI.
  - **O PPS:** ids 0; CAVLC; uma fatia por imagem; os `num_ref_idx` 0; sem predição ponderada; QP e deslocamentos 0; `deblocking_filter_control_present` 1; os outros em 0.
  - **O IDR:**
    - o cabeçalho da fatia: `first_mb` 0; `slice_type` 7; o PPS 0; `frame_num` 0 (4 bits); o `idr_pic_id` alternando 0 e 1; as duas marcas de referência em 0; o `slice_qp_delta` 0; o `disable_deblocking_filter_idc` 1;
    - os 12 macroblocos: cada um com o `mb_type` 25 (I_PCM), o alinhamento e 256 bytes de Y, 64 de U e 64 de V da cor;
    - o fim da fatia.
  - **O RTP:**
    - o SPS e o PPS vão em pacotes de uma NAL só, e o IDR em fragmentos FU-A, com até 1200 bytes de carga cada;
    - o bit M só no último pacote do quadro, o mesmo timestamp no quadro todo, e +9000 de um quadro ao próximo;
    - o `seq` sobe 1 por pacote, e cada fluxo tem um SSRC sorteado;
    - o payload type é o do H.264 que a resposta escolheu; se ela não escolheu o H.264, nada sai.
  - **Conferido ao escrever este plano:** o decodificador do OpenH264 do sistema devolve esse quadro com a cor exata, também com dois IDR seguidos.
- **`VIDEO PACKETS <alvo>` e `VIDEO KEYFRAMES <alvo>`:** as contagens de hoje, só dos datagramas que chegam do endereço de vídeo da ligação desse alvo. O `VIDEO PACKETS reset` zera também essas.
- **O alvo `180`:** o INVITE leva o 100 e o 180, sem resposta final, e o registro ganha `inv-in 180 180`. O CANCEL do telefone leva o 200 e o 487 do INVITE, e o registro ganha o `cancel-in 180` de hoje.
- **`BYE <alvo>`:** o BYE na ligação do telefone para o alvo (o convidado desliga). O registro ganha `bye-out <alvo> <código>`, e a resposta é `OK` ou `ERR no-call`.
- **`HOLD <alvo> on|off`:** o re-INVITE na ligação do telefone para o alvo (o convidado põe em espera, ou retoma).
  - O SDP é o da nossa última resposta, com o `o=` subindo e cada `m=` com porta em `a=sendonly` (com o `on`) ou em `a=sendrecv` (com o `off`).
  - O 2xx leva o ACK. O registro ganha `hold-out <alvo> <on|off> <código>`, e a resposta é `OK` ou `ERR no-call`.
  - A imagem da cor desse alvo continua saindo durante a espera: quem põe em espera com `sendonly` ainda manda.
  - Os pedidos no diálogo do telefone usam o From e o To dele, trocados, como o NOTIFY de hoje (`_notify`), e o CSeq de `self.cseqs`.

**O fixture:**
- O `FakeRegistrar` ganha:
  - `void VideoSource(const std::string& alvo, const std::string& source)`;
  - `int PacketsOf(const std::string& alvo) const`;
  - `int KeyframesOf(const std::string& alvo) const`;
  - `bool WaitForPacketsOf(const std::string& alvo, int atLeast, int seconds) const`;
  - `bool PacketsStayOf(const std::string& alvo, int seconds) const`.
- O `TestSink` guarda uma cópia da última imagem de cada id e ganha:

```cpp
struct Yuv { int y; int u; int v; };
std::optional<Yuv> PixelAt(int callId, double fx, double fy) const;   // na fração da largura e da altura do último quadro
bool WaitForColor(int callId, double fx, double fy, Yuv color, int tolerance, int seconds) const;   // cada plano
int RowSpanY(int callId, double fy, double fromX, double toX) const;   // o maior Y menos o menor, na linha
```

- [ ] **Step 1: Escreva os testes que falham.**
  - No `test_fake_registrar.py`, com o `Phone` mínimo dos testes:
    - `test_the_color_frame_is_an_sps_a_pps_and_an_idr_of_i_pcm_macroblocks`: um leitor de Exp-Golomb no teste lê 64×48 no SPS e o `mb_type` 25 no primeiro macrobloco, e os 256 bytes seguintes são o Y da cor;
    - `test_the_color_frame_travels_in_fu_a_fragments_with_the_marker_on_the_last`: os pacotes de um quadro têm o mesmo timestamp; o SPS e o PPS vêm sozinhos; os FU-A têm o S no primeiro e o E no último; o M só no último;
    - `test_video_source_color_streams_that_color_to_the_phone_video_address`: com uma oferta H.264 numa porta do teste, chegam ali pacotes no payload type da resposta, e 10 quadros em cerca de 1 s;
    - `test_video_source_echo_returns_only_the_datagrams_of_that_callee`: com 2003 em `echo` e 2004 sem escolha, só os datagramas da ligação para 2003 voltam;
    - `test_video_source_none_answers_that_callee_with_video_port_zero`: o 2004 continua com o vídeo na PORTA;
    - `test_video_packets_and_keyframes_count_each_callee`;
    - `test_video_source_refuses_a_bad_color_or_name`: `color 15 128 128`, `color 1 2` e `blue` dão `ERR bad-command`;
    - `test_a_call_to_180_rings_until_the_phone_cancels_it`: o 180 sem o 200; o CANCEL leva o 200 e o 487; o registro tem `inv-in 180 180` e `cancel-in 180`;
    - `test_bye_hangs_up_the_phone_call_to_the_callee`;
    - `test_hold_sends_a_sendonly_reinvite_and_off_a_sendrecv_one`: os dois SDP, os dois ACK e as duas linhas `hold-out`.
  - No `test_engine_room.cpp`, `"the registrar's color source arrives as a solid image"`:
    1. Faça `VideoSource("2003", "color 150 44 200")` e `MakeCall("2003", true)`, e espere o `Confirmed`.
    2. Confira: os quadros com o id da ligação têm 64×48, e o `WaitForColor(id, 0.5, 0.5, {150,44,200}, 2, 5)`.
    3. Confira: o `PacketsOf("2003")` passa de 0 (a nossa câmera para ele).
- [ ] **Step 2: Rode os scripts e o motor, e veja os testes falharem.**
- [ ] **Step 3: Implemente** o registrador, os testes Python e o fixture.
- [ ] **Step 4: Rode os scripts, o `phone_tests -sf='*room*'` e o `tests/smoke/test_fake_registrar.py`.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `android` e os scripts do `build`).

```bash
git commit -m "test(video): o registrador falso com a imagem de cada convidado, as contagens por convidado, o 180, o BYE e a espera"
```

### Task 3: O motor: as ligações e o som da sala

**Files:**
- Modify: `starsonic/phone/Video.h` e `Video.cpp` (os tipos), `SipEngine.h` e `SipEngine.cpp`, `EngineCall.h` e `EngineCall.cpp`, `EngineCallVideo.cpp` e o `baresip/SipEngineBaresip.cpp`.
- Create: `starsonic/phone/EngineRoom.cpp`.
- Modify: `tests/phone/registrar_fixture.h` (o `OnRoom` no `RecordingListener`) e `tests/phone/call_fixture.h` (o `CheckNoRoom`).
- Test: `tests/phone/test_engine_room.cpp` e `tests/phone/test_engine_baresip.cpp`.

**Interfaces:**
- Consumes: o `RoomTile`, o `MosaicCells` e o `UnitTile` (Task 1); o `VideoSource`, o alvo `180` e o `BYE` do registrador (Task 2).
- Produces (`Video.h`):

```cpp
constexpr int kRoomMaxGuests = 5;
struct RoomMember {
    enum class State { Calling, In, Held };   // chamando; na sala; em espera (ele pôs a ligação em espera)
    int callId = 0;
    State state = State::Calling;
    bool image = false;   // a imagem dele chegando (o remote da ligação)
    RoomTile tile;        // o quadro dele no mosaico de quem montou (UnitTile das MosaicCells de 1280x720)
};
struct RoomInfo {
    int id = 0;                        // o id da sala; 0: nenhuma
    std::vector<RoomMember> members;   // os convidados, na ordem em que entraram
    bool out = false;                  // a nossa voz e a nossa câmera fora da sala
    bool full = false;                 // 5 convidados, contando os chamados
    bool ended = false;                // o último evento da sala: members tem quem ficou (agora uma ligação comum) ou nada
};
bool operator==(const RoomMember&, const RoomMember&);   // e o de RoomInfo, no Video.cpp
```

- Produces (`SipEngine.h`). O comentário de cada método diz o contrato abaixo no estilo do cabeçalho: as threads, os ids, os retornos e o que acontece sem o vídeo no motor e no baresip.
  - `int RoomAdd(const std::string& number);`:
    - liga para `number` como o `MakeCall` com vídeo, pela central da conta, e põe a ligação na sala;
    - **sem sala:** a sala nasce da ligação de agora, que precisa ser a única, confirmada, com o vídeo negociado, fora da espera, da conferência e de uma transferência. Ela é o primeiro convidado, e a sala ganha um id novo, do contador das ligações;
    - **com sala:** você precisa estar nela (o `out` falso), e ela precisa ter menos de 5 convidados;
    - a ligação nova não põe nada em espera;
    - devolve o id dela, ou -1: os casos acima, sem o `VideoEnabled`, o número vazio, sem conta, ou o PJSIP recusou. Com -1, nenhum evento dela chega, e a sala não nasce;
    - sem o vídeo no motor, sempre -1.
  - `RoomInfo Room() const;`: a sala de agora, sem esperar os outros métodos. Sem sala, o `RoomInfo{}`.
  - `EngineListener::OnRoom(const RoomInfo& room)`:
    - sai a cada mudança de um campo;
    - o evento que traz um convidado novo (também o do nascimento) chega antes do primeiro `OnCallState` da ligação dele;
    - os outros chegam depois do evento da ligação que os causou;
    - o último tem o `ended`;
    - nunca chega sem o vídeo no motor, nem no baresip.
  - O id da sala nos métodos de sempre:
    - o `Hangup(idDaSala)` desliga todos os convidados;
    - o `Activate(idDaSala)` dá `true` com a sala de pé (a volta da ligação de fora é da Task 5);
    - o `SetHold(idDaSala, true)`, o `SendDtmf`, o `Transfer`, o `TransferAttended`, o `Join`, o `Split`, o `Answer` e o `Reject` com ele dão `false`;
    - o `AudioLinks(idDaSala)` é vazio.
  - O `CallCount()` vai de 0 a 6.
- Produces (o baresip e o PJSIP sem vídeo): `RoomAdd` -1, `Room()` o `RoomInfo{}`, e nenhum `OnRoom`.
- Produces (os testes):
  - o `RecordingListener` guarda cada `OnRoom` em `Rooms()` e também na lista ordenada `Calls()`, como um `CallEvent` do tipo `Room` com o `callId` igual ao id da sala, e ganha `bool WaitForRoom(std::function<bool(const RoomInfo&)> condition, int seconds)`;
  - o `call_fixture.h` ganha `void CheckNoRoom(Phone& phone)`. Ele confere: o `RoomAdd("2003") == -1` sem ligação e numa ligação só de voz; o `Room() == RoomInfo{}`; e o `Rooms()` vazio.

**As regras** (o desenho, itens 1, 2, 4 e 5):
- **As vagas:** `Slot slots_[kRoomMaxGuests + 1]`. O `Slot` ganha:
  - `member`, convidado da sala;
  - `seat`, o lugar de 1 a 5, o menor livre;
  - `remoteHold`, o áudio em `REMOTE_HOLD`, lido no `MediaChanged`;
  - `joined`, a ordem de entrada.

  A tabela ganha `roomId_`, `roomWish_` (o desejo da câmera da sala, o da ligação de onde ela nasceu) e o último `RoomInfo` avisado.
- **O nascimento:** o `RoomAdd` tira o id da sala e depois o da ligação nova do `nextId_`.
  - O `OnRoom` que traz o convidado novo entra no `held_` com o id da ligação nova, antes do `makeCall`. Assim, ele sai antes do primeiro `OnCallState` dela e some com os eventos dela se o `makeCall` falha. Se a sala nascia, ela volta a não existir.
  - A oferta tem um vídeo, `sendrecv`, sem o `askingVideo`: um convidado que responde sem vídeo é um convidado sem vídeo, sem `refused`.
- **Os estados:** `Calling` até o `Confirmed`; `In`; e `Held` com o `remoteHold`.
- **O `Route` e o `AudioLinks`:** o desenho, item 5. O `usable` de um convidado é só o `PJSUA_CALL_MEDIA_ACTIVE`.
- **As pausas:** o `SendPaused` e o `ReceivePaused` de um convidado não olham outra ligação. Até a Task 4, um convidado manda a nossa câmera direto, com o `roomWish_`.
- **A saída:** o `Ended` de um convidado tira a vaga e o lugar.
  - Com 1 convidado ou nenhum, a sala acaba: o `OnRoom` com o `ended` e os `members` com quem ficou.
  - Quem ficou volta a ser uma ligação comum, com o `wish` igual ao `roomWish_`, e vira a ativa se a sala era a ativa.
  - Até a Task 5, uma ligação que chega com a sala de pé leva 486, e o `MakeCall` com a sala de pé dá -1.

- [ ] **Step 1: Escreva os testes que falham** (`test_engine_room.cpp`). Use estes ajudantes:
  - `RoomSettings()`: as escolhas dos testes, com a qualidade Baixa;
  - `int VideoCall(Phone&, const std::string& number)`: o `MakeCall` com vídeo, o `Confirmed` e o `active`;
  - `int Guest(Phone&, const std::string& number)`: o `RoomAdd`, o `Confirmed` e o `OnRoom` com ele `In`.

  Os convidados desta task atendem com `VideoSource(<alvo>, "none")`.
  - `"RoomAdd makes a room of the only video call and calls the guest without holding anyone"`:
    - com `base = VideoCall("2002")` e `g = RoomAdd("2003") > 0`, o primeiro `OnRoom` tem um id que não é o `base` nem o `g`, com os `members` `{base In, g Calling}`, sem o `out`, o `full` e o `ended`;
    - na `Calls()`, o primeiro `Room` vem antes do primeiro estado de `g`;
    - depois do `Confirmed` de `g`, os `members` são `{base In, g In}`, e os quadros são `{0,0,0.5,1}` e `{0.5,0,0.5,1}`;
    - o `Room()` é igual ao último `OnRoom`;
    - o registro tem `video-in 2003 H264,VP8`, e o `LogCount("reinv-in 2002 sendonly") == 0`.
  - `"everyone hears everyone in the room and the room id has no audio"`: com a base e os convidados 2003, 2004 e 2005, o `WaitLinks(base,{0,g1,g2,g3})`, o mesmo em cada convidado, e o `AudioLinks(idDaSala)` vazio.
  - `"RoomAdd needs a lone confirmed video call"`: dá -1, e nenhum `OnRoom` chega, nestes casos:
    - sem ligação;
    - numa ligação só de voz;
    - numa ligação com vídeo em espera;
    - com uma segunda tocando (`Ring()`);
    - com o número vazio;
    - com as escolhas sem codec, aplicadas depois da ligação.
  - `"the room holds five guests counting the ones being called"`:
    1. Faça a base, três convidados atendidos e o `RoomAdd("180")`. O `full` fica `true`.
    2. Confira: `RoomAdd("2006") == -1`.
    3. Faça o `Hangup` do `180`. O registro ganha `cancel-in 180`, e o `OnRoom` sai sem ele e sem o `full`.
    4. Confira: `RoomAdd("2006") > 0`.
  - `"a guest the PBX refuses fails with its code and the room goes on"`: com a base e o 2003, o `RoomAdd("486")` chega ao `Disconnected` com 486; o `OnRoom` volta a `{base, g1}`, sem o `ended`; e o `WaitLinks(base,{0,g1})`.
  - `"a room born with a refused guest ends at once and the call goes on"`: só com a base, o `RoomAdd("486")` dá o nascimento e depois o `ended` com `{base}`. O `Room()` volta ao `RoomInfo{}`, o `WaitLinks(base,{0})`, e o `Video(base).active` fica `true`.
  - `"the room outlives the call it was born from"` (o Review Focus 3):
    1. Faça a base e os convidados 2003 e 2004, e depois o `BYE 2002` no registrador.
    2. Confira: a base chega ao `Disconnected`.
    3. Confira: o `OnRoom` tem o mesmo id, `{g1, g2}`, lado a lado.
    4. Confira: o `WaitLinks(g1,{0,g2})`.
  - `"a guest leaving rearranges the room, and with one guest left it is a normal call again"`:
    1. Faça a base, o g1 e o g2, e o `Hangup(g1)`. O `OnRoom` tem `{base, g2}`, lado a lado.
    2. Faça o `BYE 2004`. Sai o `ended`, com `{base}`.
    3. Confira: o `Room()` é o `RoomInfo{}`, e o `WaitLinks(base,{0})`.
    4. Confira: o `SetHold(base,true)` gera `reinv-in 2002 sendonly`.
  - `"Hangup with the room id ends every guest"`: com a base e dois convidados, o registro ganha os três `bye-in`, o último `OnRoom` tem o `ended` sem `members`, e o `CallCount() == 0`.
  - `"the room id only works where a room makes sense"`: os `false` e o `AudioLinks` vazio da lista acima, e o `Activate(idDaSala) == true`.
  - No ramo sem vídeo do `test_engine_room.cpp` e num caso novo do `test_engine_baresip.cpp`, `"the engine without video has no room"`: o `CheckNoRoom(phone)`.
- [ ] **Step 2: Rode o motor e veja os testes falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente** a sala na tabela, a API, o baresip e o fixture.
- [ ] **Step 4: Rode `phone_tests -sf='*room*'` três vezes seguidas, e depois a suíte inteira.** Esperado: tudo passa nas três, sem teste instável, e o `test_engine_video.cpp` passa sem mudança.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` precisa ficar verde: o baresip e o Windows compilam o `SipEngine.h` novo.

```bash
git commit -m "feat(video): a sala no motor: as ligações dos convidados, o som de todos com todos e o id da sala"
```

### Task 4: O motor: o mosaico de cada convidado e o de quem montou

**Files:**
- Create: `starsonic/phone/RoomVideo.h` e `RoomVideo.cpp` (só com o `PJMEDIA_HAS_VIDEO`).
- Modify: `starsonic/phone/VideoRenderer.h` e `VideoRenderer.cpp` (o tap), `EngineCall.h`, `EngineCallVideo.cpp`, `EngineRoom.cpp`, `SipEngine.h` e `SipEngine.cpp`.
- Modify: `tests/phone/call_fixture.h`. O `RemoveColorbar` e o `FindDevice` saem do `test_engine_video.cpp` para lá, com um `AddColorbar()` (o `pjmedia_vid_register_factory(&pjmedia_cbar_factory, nullptr)`).
- Test: `tests/phone/test_engine_room.cpp`.

**Interfaces:**
- Consumes: `MosaicCells`, `GuestTiles`, `ComposeMosaic`, `kHostTile` e as constantes do mosaico (Task 1); a sala na tabela (Task 3).
- Produces (`VideoRenderer.h`):

```cpp
class FrameTap {   // a loja da sala: na thread que entrega o quadro, com a trava do desenhista presa
public:
    virtual void OnFrame(int source, const I420Frame& frame) = 0;   // source: o id da ligação, ou kLocalFrames
protected:
    ~FrameTap() {}
};
void SetRendererTap(FrameTap* tap);   // nullptr: nenhum; síncrono como o SetRendererSink
```

- Produces (`RoomVideo.h`, internos):

```cpp
bool RegisterRoomDevices(std::string* error);   // depois do RegisterVideoRenderer, no Create
struct RoomDeviceIds {
    pjmedia_vid_dev_index host = PJMEDIA_VID_INVALID_DEV;                      // "Starsonic sala"
    std::array<pjmedia_vid_dev_index, kRoomMaxGuests> seats;                     // "Starsonic sala 1" a "5"
};
RoomDeviceIds FindRoomDevices();   // pelo nome: os ids mudam a cada releitura da lista
struct RoomPlan {
    std::vector<int> host;                                   // os convidados no mosaico de quem montou, em ordem
    std::array<std::vector<int>, kRoomMaxGuests> seats;      // o GuestTiles de cada lugar (vazio: livre)
    std::set<int> live;                                      // as fontes cuja imagem vale; as outras ficam com o fundo
};
void SetRoomPlan(const RoomPlan& plan);   // a loja esquece a imagem das fontes que saem do live
FrameTap* RoomFrameStore();
```

- Produces (`SipEngine.h`, o contrato):
  - o `SetCamera(idDaSala, on)` é o desejo da câmera na sala, com o `NoCamera` de hoje;
  - o `SetCamera(convidado, ...)` e o `SetCamera(ligaçãoDeFora, ...)` com a sala de pé dão `false`;
  - o `Video(idDaSala)` e o `OnCallVideo(idDaSala, ...)` são o vídeo da sala:
    - `active`: a sala de pé;
    - `remote`: o mosaico de quem montou chegando ao sink;
    - `camera`: a nossa câmera chegando aos convidados;
    - os outros campos ficam `false`;
  - o `camera` de um convidado é a ligação dele mandando a nossa câmera direto;
  - o `RoomMember::image` é o `remote` da ligação do convidado;
  - o `FrameSink` recebe o mosaico de quem montou como `OnRemoteFrame(idDaSala, ...)`, em 1280×720 a 25 qps, e as imagens dos convidados com o id de cada ligação;
  - o `VideoDevices()` não lista os dispositivos da sala.

**As regras** (o desenho, itens 6 a 9 e 11):
- **Os dispositivos:** a fábrica "Starsonic sala", com o driver "Starsonic", tem 6 dispositivos de captura passivos, só I420 e de qualquer tamanho (o `set_cap(FORMAT)`).
  - Os lugares 1 a 5 aceitam o `INPUT_PREVIEW`.
  - O `get_frame` de um stream monta, pelo `ComposeMosaic`, com a trava da loja, o plano do lugar dele (o lugar 0 é o `host`) no tamanho do formato de agora do stream. As fontes fora do `live` ficam com o fundo.
- **O `Cameras()`** pula todo dispositivo do driver "Starsonic".
- **A câmera da conta:** sem câmera, ela é o lugar 1. Assim, o stream `sendrecv` de um convidado monta, também num PC sem câmera. As ligações comuns continuam só recebendo sem câmera (o `camera_` inválido).
- **O envio no `SyncVideo`:** cada ligação tem uma fonte, e os ids vêm do `FindRoomDevices()` a cada passada:
  - **os convidados, no mosaico:** com 2 ou mais convidados que já atenderam, também os em espera, a fonte é o lugar do convidado, e manda com `confirmed`, `videoUp` e `canSend`, sem olhar a câmera;
  - **um convidado só:** a fonte é a câmera, com o `roomWish_`, sem a pausa da tela e fora do `out`;
  - **as outras ligações:** a 0.3.0.

  A troca de fonte é o `UseCamera` (o `CHANGE_CAP_DEV`, que troca a janela ao vivo) e depois o `START_TRANSMIT`, se ela ainda não manda.
- **A prévia da câmera** roda também com a sala no mosaico, o `roomWish_`, sem a pausa e fora do `out`. Nesse caso, o `kHostTile` entra no `live`.
- **O plano:** a tabela o refaz com o `mutex_` preso a cada mudança da sala e do `remote`. Um convidado entra no `live` estando `In` e com o `remote`.
- **O mosaico de quem montou:** enquanto a sala está de pé, o `SyncVideo` mantém o `pjsua_vid_preview_start(host)`, com o `rend_id` do desenhista, o `show`, I420 1280×720 a 25 qps, e o `BindRendererStream(janela, idDaSala)`.
  - O primeiro quadro dele, no portão, liga o `remote` da sala.
  - No fim da sala, a prévia para e sai o `UnbindRendererCall(idDaSala)`.
  - O destrutor do motor, o `End` e o `Stop` da tabela também tiram o tap.

- [ ] **Step 1: Escreva os testes que falham.** As cores são o laranja `{150,44,200}`, o roxo `{60,200,180}` e o verde-água `{180,100,60}`, e o fundo é `{21,132,127}`; nenhuma é uma das barras da câmera de teste. O lugar de cada quadro vem da Task 1: com 3 numa saída de 320×240, as células são `(0,0)`, `(160,0)` e `(80,120)`, de 160×120. Toda espera de cor é de até 8 s, com tolerância 16 nos quadros que passaram pelo codificador (o eco) e 2 no mosaico de quem montou; o fundo, com tolerância 10 e 2.
  - `"each guest receives the others and not itself"`:
    1. Faça a base 2002 em `color` laranja, o g1 2003 em `color` roxo e o g2 2004 em `echo`.
    2. Confira nos quadros do g2, que são o mosaico dele: em 8 s, `RowSpanY(g2,0.25,0.02,0.48) > 100` (a câmera de barras); `WaitForColor(g2,0.75,0.25,laranja,16)`; `WaitForColor(g2,0.5,0.75,roxo,16)`; e o fundo, com tolerância 10, em `(0.1,0.75)` e `(0.9,0.75)`, que provam que ele não é o quarto quadro.
    3. Troque: o 2003 em `echo` e o 2004 em `color` verde-água.
    4. Confira nos quadros do g1: o laranja em `(0.75,0.25)`, o verde-água em `(0.5,0.75)` e o fundo nos cantos de baixo.
    5. Confira no mosaico de quem montou, com o id da sala: os quadros são 1280×720 (pelo menos 30 em 2 s); o laranja, com tolerância 2, em `(0.25,0.25)`; o fundo nas faixas da base, em `(0.03,0.25)`, e nos cantos de baixo; o `Video(idDaSala).active` e o `.remote`; e o `image` dos convidados em cor.
  - `"a guest without video is a background tile and still hears and is heard"` (o Review Focus 2): com a base em laranja, o g1 em `none` e o g2 em roxo, o quadro do g1 no mosaico de quem montou é o fundo, o `image` dele é `false`, e o `WaitLinks(g1,{0,base,g2})`.
  - `"the host's mosaic rearranges when a guest leaves"`: com a base em laranja, o g1 em roxo e o g2 em verde-água, o `Hangup(g2)` deixa, em até 2 s, o laranja em `(0.25,0.5)` e o roxo em `(0.75,0.5)` do mosaico de quem montou.
  - `"a room in VP8 sends each guest its mosaic"` (a spec 3, critério 2): com as escolhas só com o VP8 (`h264=false`), a base 2002 e o g1 2003 em `echo`, os quadros de cada um têm 320×240 e as barras da câmera na metade da esquerda (`RowSpanY(...,0.5,0.02,0.48) > 100`), e o `KeyframesOf` dos dois passa de 0.
  - `"with one guest left the guest gets our camera directly again"`:
    1. Faça a base em `echo` e o g1 em roxo. O roxo aparece em `(0.75,0.5)` da base.
    2. Faça o `Hangup(g1)`.
    3. Confira: em 6 s, `RowSpanY(base,0.5,0.02,0.98) > 100`, e o `(0.75,0.5)` não é roxo.
    4. Confira: o `Video(base).camera`.
    5. Confira: nenhum quadro com o id da sala 500 ms depois do `ended`.
  - `"our camera off, or the screen locked, empties our tile and the room goes on"`:
    1. Faça a base em laranja e o g1 em `echo`.
    2. Faça o `SetCamera(idDaSala,false)`. Confira: o fundo em `(0.25,0.5)` do g1; o `Video(idDaSala).camera` `false`; e nenhum quadro local 500 ms depois (a câmera fechou).
    3. Faça o `SetCamera(idDaSala,true)`. Confira: as barras voltam.
    4. Faça o `SetCameraPaused(true)`. Confira: o fundo, com os quadros do g1 ainda chegando.
    5. Faça o `SetCameraPaused(false)`. Confira: as barras.
  - `"without a camera the guests still get the mosaic"`: com o `nullVideo`, a base em laranja e o g1 em `echo`, o `PacketsOf("2003")` sobe, e o laranja aparece em `(0.75,0.5)` do g1.
  - `"a camera that leaves and comes back during the room keeps every guest's mosaic"` (o Review Focus 4):
    1. Faça a base em `echo` e o g1 em roxo, e depois o `RemoveColorbar()` e o `RefreshVideoDevices()`.
    2. Confira: sai o `Disconnected`, o fundo em `(0.25,0.5)` da base, e o roxo segue em `(0.75,0.5)`.
    3. Faça o `AddColorbar()`, o `RefreshVideoDevices()` (os ids da sala mudam) e o `SetCamera(idDaSala,true)`.
    4. Confira: as barras voltam, o roxo segue, e o `PacketsOf("2002")` continua subindo.
  - `"destroying the engine during a room hangs up every guest and no frame arrives after SetFrameSink(nullptr)"` (o Review Focus 5): com três convidados em cor, o `SetFrameSink(nullptr)` (com a hora marcada) e o `engine.reset()`, o registro ganha os três `bye-in`, e nenhum quadro chega depois da marca.
  - `"the test camera shows up and no room device does"`: o `VideoDevices()` tem `"Colorbar generator"`, e nenhum nome contém `"Starsonic"`.
- [ ] **Step 2: Rode o motor e veja os testes falharem.**
- [ ] **Step 3: Implemente.**
- [ ] **Step 4: Rode `phone_tests -sf='*room*'` três vezes seguidas, e depois a suíte inteira.** Esperado: tudo passa, sem teste instável.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `android` e o `build`).

```bash
git commit -m "feat(video): os mosaicos da sala: um dispositivo nosso por convidado, a loja das imagens e o mosaico de quem montou"
```

### Task 5: O motor: a ligação de fora e o convidado em espera

**Files:**
- Modify: `starsonic/phone/EngineCall.cpp`, `EngineCallVideo.cpp`, `EngineRoom.cpp` e `SipEngine.h` (o contrato do `OnIncomingCall`, do `MakeCall`, do `Answer`, do `Activate` e do `SetHold` com a sala).
- Test: `tests/phone/test_engine_room.cpp`.

**Interfaces:**
- Consumes: a sala e o mosaico (Tasks 3 e 4).
- Produces: o `RoomInfo::out` e o `RoomMember::State::Held` passam a mudar; o `Activate(idDaSala)` e o `SetHold(idDaSala,false)` trazem você de volta.

**As regras** (o desenho, itens 3 a 5):
- **O `Incoming` com a sala de pé:**
  - sem ligação de fora, ela toca com o `videoCount` 0, sem o `offered`, sem o `early` e sem o `Refuse`, também de um Porteiro;
  - com uma ligação de fora, leva 486 e o `OnRejectedBusy`.
- **O `Make` com a sala de pé:** sem ligação de fora, ela sai só com a voz, sem o `refused`, e o `Focus(nova)` tira você da sala; com uma ligação de fora, -1.
- **O `Focus`:** ele recebe também o id da sala.
  - O `Focus(ligaçãoDeFora)` deixa o `activeId_` nela, sem re-INVITE para os convidados.
  - O `Focus(idDaSala)` põe a de fora em espera (o `Renegotiate`), se ela está confirmada e fora da espera.
  - O `out` é a sala de pé com o `activeId_` diferente do id dela.
  - O fim da de fora não traz você de volta.
- **O `RoomAdd`** com o `out` dá -1.
- **O convidado em espera:** com o `remoteHold`, ele passa a `Held`. Ele sai da mesa de áudio e do `live` (o fundo), e o envio para ele para pelo `canSend`. Na volta, ele volta a `In`.

- [ ] **Step 1: Escreva os testes que falham:**
  - `"a call from outside rings without video while the room goes on"`: com a sala `{base, g1}`, o `RingVideo("3005")` gera o `OnIncomingCall`, com o `LastVideo(fora).offered == false` e o `RefusedCount(fora) == 0`; nenhum `sdp-out 2001 183` sai, e o `WaitLinks(base,{0,g1})` segue.
  - `"answering the outside call takes us out of the room and returning puts it on hold"`:
    1. Faça a base em `echo` e o g1 em roxo, o `fora = RingVideo("3005")` e o `Answer(fora,true) == true`.
    2. Confira: o registro ganha `sdp-out 2001 200 video=nao`.
    3. Confira: o `OnRoom` com o `out`; `WaitLinks(base,{g1})`, `WaitLinks(g1,{base})` e `WaitLinks(fora,{0})`; e nenhum `reinv-in 2002 sendonly` nem `reinv-in 2003 sendonly`.
    4. Confira no mosaico da base: o fundo em `(0.25,0.5)`, e o roxo segue.
    5. Faça o `Activate(idDaSala)`. Confira: o `out` falso; o registro ganha `reinv-in 3005 sendonly`; `WaitLinks(base,{0,g1})` e `WaitLinks(fora,{})`; e as barras voltam.
  - `"the outside call ending leaves us out until we return"`: com a sala `{base, g1}` (o g1 em `none`) e a de fora (`RingVideo("3005")`) atendida, o `HANGUP 2001` a encerra, e o `Room().out` continua `true`. O `SetHold(idDaSala,false)` traz o `WaitLinks(base,{0,g1})`.
  - `"a second call from outside is busy, even with the room full"`:
    1. Faça uma sala cheia: a base e quatro convidados `none`.
    2. Faça o `Ring()`. Confira: ele toca.
    3. Faça outro `Ring()`. Confira: o `OnRejectedBusy`, e o registro ganha `inv-out 2001 486`.
  - `"a call made during the room is the outside call, voice only"`: o `MakeCall("2009",true)` gera `video-in 2009 nao` e o `out`; um segundo `MakeCall("2010") == -1`; e o `RoomAdd("2011") == -1` enquanto o `out` vale.
  - `"a guest who puts the room on hold is held, out of the mix and gets no mosaic until it comes back"` (o Review Focus 1):
    1. Faça a base em laranja, o g1 2003 em roxo e o g2 2004 em verde-água, e o `HOLD 2003 on`.
    2. Confira: o g1 fica `Held`; o `WaitLinks(g1,{})` e o `WaitLinks(base,{0,g2})`.
    3. Confira: `PacketsStayOf("2003",1)` depois de 500 ms, e o fundo em `(0.75,0.25)` do mosaico de quem montou, embora a imagem dele continue chegando.
    4. Guarde `n = PacketsOf("2003")` e faça o `HOLD 2003 off`. Confira: `In`; os links voltam; o `WaitForPacketsOf("2003", n + 20, 5)`; e o roxo volta.
- [ ] **Step 2: Rode o motor e veja os testes falharem.**
- [ ] **Step 3: Implemente.**
- [ ] **Step 4: Rode `phone_tests -sf='*room*'` três vezes, e depois a suíte inteira.** Esperado: tudo passa, também os testes de duas ligações do `test_engine_video.cpp` e do `test_engine_hold.cpp`.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**

```bash
git commit -m "feat(video): a ligação de fora no meio da sala, a volta para a sala e o convidado em espera"
```

### Task 6: O motor: a qualidade da sala e o quadro-chave de cada convidado

**Files:**
- Modify: `starsonic/phone/SipEngine.cpp`. O `ApplyVideoSettings` fica com as prioridades e o fmtp do H.264, e a qualidade sai dele.
- Modify: `EngineCall.h`, `EngineCallVideo.cpp` e `EngineRoom.cpp`.
- Test: `tests/phone/test_engine_room.cpp`.

**Interfaces:**
- Consumes: o `RoomQuality` (Task 1).
- Produces (interno, `EngineCallVideo.cpp`): `void ApplyCodecQuality(const QualityValues& quality);`. Ele põe, em cada codec de vídeo, o `enc_fmt` (o tamanho, os quadros por segundo, e o `avg_bps` e o `max_bps` iguais a `kbps × 1000`), sem mexer no fmtp nem na prioridade.

**As regras** (o desenho, item 10):
- **O alvo:** o `RoomQuality(settings_.quality, convidados)` com a sala de pé, e o `ValuesOf(settings_.quality)` sem.
  - Ele é aplicado, fora do `mutex_`, quando muda: na hora, no `SetVideoSettings` e no `RoomAdd` (antes do `makeCall`, para o convidado novo nascer no alvo); e no `SyncVideo`, nas saídas e no fim da sala.
  - Cada mudança sobe uma vez (`qualitySerial_`).
- **O re-INVITE:** no `SyncVideo`, cada ligação da sala (ou a que ficou, no fim), confirmada, com o vídeo e com o codificador (`width`, `height` e `fps` do `ReadVideoStream`) diferente do alvo, recebe um re-INVITE, uma vez por vez.
  - O re-INVITE é o `pjsua_call_reinvite2` com o `vid_cnt` 1.
  - O `PJ_EINVALIDOP` (outro re-INVITE em andamento) agenda uma passada daqui a 200 ms.
- **O quadro-chave periódico** vale para toda ligação que manda, da câmera ou de um lugar da sala. O comentário do `kKeyframeRetryMs` deixa de dizer "uma ligação por vez".

- [ ] **Step 1: Escreva os testes que falham:**
  - `"from four guests the room uses the room medium and the guests already in are rebuilt"`, com a qualidade Média:
    1. Faça a base 2002 e os convidados 2003 e 2004, todos em cor. O log tem pelo menos 3 `video: H264 640x480 25 qps, envio ligado`.
    2. Faça o `RoomAdd("2005")` em cor.
    3. Confira: o registro ganha uma linha que começa com `video-reinv 2002 `, uma com `video-reinv 2003 ` e uma com `video-reinv 2004 ` (a lista de codecs do re-INVITE é a da PJSIP), e o log, pelo menos 4 `video: H264 640x480 15 qps, envio ligado`.
    4. Faça o `Hangup` do 2005.
    5. Confira: as linhas `video: H264 640x480 25 qps, envio ligado` sobem em 3.
  - `"the chosen quality comes back when the room ends"`, com a qualidade Alta:
    1. Faça a base em cor. O log tem `video: H264 1280x720 30 qps, envio ligado`.
    2. Faça o `RoomAdd("2003")` em cor. A base passa a `640x480 25 qps`.
    3. Faça o `Hangup(g1)`. A base volta a `1280x720 30 qps`, com mais uma linha que começa com `video-reinv 2002 `.
  - `"every guest sending gets a keyframe every 3 seconds"`: com três convidados em cor e a qualidade Baixa, depois do `VIDEO PACKETS reset` e 7 s, o `KeyframesOf` de 2002, 2003 e 2004 dá pelo menos 2 cada.
- [ ] **Step 2: Rode e veja os testes falharem.**
- [ ] **Step 3: Implemente.**
- [ ] **Step 4: Rode `phone_tests -sf='*room*'` três vezes, e depois a suíte inteira.** Esperado: tudo passa, também o `"the low quality gives 320x240 frames"`. O `test_engine_room.cpp` inteiro leva menos de 3 min nesta máquina. Anote o tempo no relatório.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**

```bash
git commit -m "feat(video): a qualidade da sala nos codecs, o re-INVITE de quem já está nela e o quadro-chave de cada convidado"
```

### Task 7: O controlador: a sala como uma linha

**Files:**
- Modify: `starsonic/phone/CallEngine.h` e `CallEngine.cpp` (o `RoomAdd` no porto e no `SipCallEngine`).
- Modify: `windows/app/src/EngineHost.h` e `EngineHost.cpp`. O `RoomAdd` espera o motor e o repassa, como o `MakeCall`; sem ele, o Windows não compila o porto novo. O app do iPhone usa o `SipCallEngine`, que segue sozinho.
- Modify: `starsonic/phone/CallController.h` e `CallController.cpp`.
- Modify: `tests/phone/fake_call_engine.h`.
- Create: `tests/phone/test_call_controller_room.cpp`, que entra no `call_controller_tests` pelo glob de hoje.

**Interfaces:**
- Consumes: `RoomInfo`, `RoomMember` e `RoomTile` (Task 3).
- Produces (`CallEngine`): `virtual int RoomAdd(const std::string& number) = 0;`. O `SipCallEngine` repassa. O `FakeCallEngine` ganha `std::vector<std::string> roomAdds`, `bool refuseRoom` e `std::function<void(int)> duringRoomAdd`, e devolve o `nextCallId++`, ou -1 com o `refuseRoom`.
- Produces (`CallController.h`):

```cpp
struct RoomMemberView {
    int id = 0;                    // o id da ligação do convidado
    std::string number;
    std::string name;              // o do contato, senão o da central; "" sem os dois
    RoomMember::State state = RoomMember::State::Calling;
    bool image = false;
    RoomTile tile;
};
struct RoomView { int id = 0; std::vector<RoomMemberView> members; bool out = false; bool full = false; };
// CallSnapshot ganha: std::optional<RoomView> room;   // com a linha da sala de pé (em cima ou a outra)
enum class RoomEvent { Started, Entered, Left, Failed, Out, Back, Ended };
// CallControllerListener ganha: virtual void OnRoomEvent(RoomEvent event, int value) {}
//   value: os convidados que atenderam e seguem na sala (Entered, Left), o código SIP (Failed; 0 sem ligar), 0 nos outros
bool RoomAdd(const std::string& raw);
bool RoomAddContact(const std::string& number);   // depois da dialRule, como o DialContact
void RoomRemove(int callId);
void RoomEnd();
void RoomReturn();
void OnRoom(const RoomInfo& room);   // o evento do motor, na thread de eventos dele
```

**As regras** (o desenho, item 12):
- **A linha da sala:** é um `Call` com `room`, com o id da sala, a fase ativa e o `activeSince` e o `startMs` da ligação de onde ela nasceu.
  - O `CallView` dela vai com o número e o nome vazios, o `held` (fora da sala) e o `video` do `OnCallVideo(idDaSala)`.
  - Os convidados ficam dentro da linha, cada um com o seu `Call`, com o número, o contato, o `incoming`, o `startMs`, o `activeSince`, o `localHangup` e o vídeo, e com o estado, a `image` e o `tile` do último `OnRoom`.
- **O `RoomAdd`:**
  - ele confere o `IsBlank`, o registro (o aviso de sem conexão, como o `Dial`) e o número normalizado;
  - **sem sala:** precisa haver uma linha só, `Active`, sem espera nem saída, sem consulta, conferência ou transferência esperando, e com o `video.active`;
  - **com sala:** a linha da sala precisa estar em cima, fora da espera, e sem o `full`;
  - senão, `false`, sem chamar o motor;
  - o convidado pendente (o número e o contato) adota o primeiro id desconhecido de um `OnRoom`, ou o do `RoomAdd`, como o `OnDialed`. O -1 dá o Recente de uma feita e o `Failed` com 0, sem aviso.
- **O `OnRoom`:**
  - **o nascimento:** a linha cujo id está nos `members` vira a linha da sala, no mesmo lugar e com o mesmo `active_`. O `Call` dela vai para dentro, e sai o `Started`;
  - **a cada evento:** os estados, as imagens e os quadros. O `out` que muda dá o `Out` ou o `Back`. Os ids da sala e dos convidados sobem o `maxSeenId_`;
  - **o `ended`:** quem ficou volta a ser a linha, no lugar da sala, com o `held` da sala e a fase pelo `activeSince` dele. Sai o `Ended`. Sem ninguém, a linha da sala sai sem Recente próprio e sem o aviso "desligou" (o rótulo dela é vazio; os Recentes são dos convidados), e a outra volta sozinha se a sala era a ativa.
- **Os eventos de um convidado:** o `OwnerOf` procura nos convidados antes da regra da feita nova.
  - **O `Confirmed`:** o `activeSince` e o `Entered`.
  - **O `Disconnected`:** o Recente dele, o `Outgoing` ou o `Incoming`, com a duração.
    - Se ele nunca atendeu e não foi tirado aqui, sai o `ShowEndMessage(<Label>: <CallEndMessage(código)>)`, se o texto não é vazio, e o `Failed` com o código.
    - Senão, sai o `Left`.
  - **O `OnCallVideo`:** guarda o vídeo, sem o `OnVideoRefused`.
- **Os comandos:**
  - o `RoomRemove(id)` marca o `localHangup` e chama o `Hangup(id)`. O `Hangup(id)` com o id de um convidado não faz nada: ele não é uma linha;
  - o `RoomEnd()` e o `Hangup()` com a sala em cima chamam o `HangupCall` da linha da sala, que marca a saída, e o `localHangup` de cada convidado, e chama o `Hangup(idDaSala)`;
  - o `RoomReturn()`, com a sala fora, é o `SwapCalls(fora, sala)`, ou só o `Activate(idDaSala)` sem a outra;
  - o `Hold`, o `Transfer` e o `Consult` com a sala em cima, e o `Join` e o `Split` com a sala, não fazem nada;
  - o `Dtmf` com a sala em cima não faz nada;
  - o `Dial` e o `Answer` com a sala de pé passam `video` `false` ao motor;
  - o `OnLogout` encerra a sala: o `Hangup(idDaSala)` e os Recentes de cada convidado, quietos.
- **O snapshot:** o `room` vale com a linha da sala de pé e fora da saída. O `operator==` do `CallSnapshot` compara também o `room` (o `OnSnapshot` só sai quando muda), e há os do `RoomView` e do `RoomMemberView`.

- [ ] **Step 1: Escreva os testes que falham** (o `RoomFixture`: a ligação 1 tocada, atendida e com o `OnCallVideo(1,{active})`; a sala 30; os convidados a partir do 2):
  - `"RoomAdd asks the engine and the room line takes the call's place"`:
    - `RoomAdd("2003")` leva a `engine.roomAdds == {"2003"}`;
    - com o `OnRoom({30, {1 In, 2 Calling}})`, o `top` tem o id 30, a fase ativa e o `activeSinceMs` da ligação 1;
    - os dois convidados do `room` têm o número e o nome certos (o 2 com o do contato);
    - sai `OnRoomEvent(Started,0)`, e nenhum Recente.
  - `"RoomAdd needs a lone active video call or the room on top"`: dá `false` sem chamar o motor numa ligação só de voz, em espera, com duas, com a sala cheia, fora da sala e sem registro (o aviso).
  - `"a guest answering, leaving and failing"`:
    - o `Confirmed` do 2 dá `Entered`, com 2;
    - o `Disconnected` do 2 dá o Recente `Outgoing` com a duração e o `Left`, com 1;
    - o `Disconnected` do 3 com 486, antes de atender, dá o `endMessage` `"<nome do 3>: Ocupado"`, o Recente com duração 0 e o `Failed`, com 486.
  - `"removing a guest still being called shows no failure"`: o `RoomRemove(3)` leva a `engine.hangups` a ter o 3; o fim dele com 487 dá o `Left`, sem `endMessage`.
  - `"the room ending with one guest gives back a normal call"`: o `OnRoom({30,{3},ended})` deixa o `top` com o id 3, o número e o nome do 3 e o `activeSinceMs` dele, e o `room` vazio; sai o `Ended`.
  - `"salaEncerrar and the hang up of the room line end every guest"`: o `RoomEnd()` leva a `engine.hangups == {30}`; o fim de cada convidado não dá aviso; e os Recentes saem.
  - `"the outside call rings as the second line and answering takes us out"`:
    - o `OnIncomingCall(5)` dá o `second` tocando e o toque `Waiting`;
    - o `Answer(true)` leva a `engine.answers == {5}`, com o `answersVideo == {false}`;
    - o `second` passa a ser a sala, em espera, e o `OnRoom(out)` dá o `Out`.
  - `"returning to the room puts the outside call on hold"`: o `RoomReturn()` leva a `engine.activated == {30}`; o `top` é a sala, e o `second`, a 5 em espera; o `OnRoom(!out)` dá o `Back`.
  - `"the outside call ending brings us back to the room"`: o `Disconnected` da 5 ativa leva a `engine.activated` a ter o 30.
  - `"the room ending while we are out leaves the outside call alone and quiet"`: com a 5 ativa e a sala fora, os fins de todos os convidados e o `OnRoom` com o `ended` sem ninguém deixam a 5 sozinha em cima, sem `endMessage` e com os Recentes só dos convidados.
  - `"a third call is busy during the room"`: com a 5 tocando, o `OnIncomingCall(6)` leva a `engine.rejects == {6}` e à perdida.
  - `"Dial during the room is the outside call, voice only"`: o `Dial("2009",true)` leva a `engine.madeVideo == {false}`, e a sala fica em espera.
  - `"Hold, Transfer, Consult, Join and Dtmf do nothing on the room"`.
  - `"logging out ends the room with every guest in the Recents"`.
  - `"the room line carries the room video and the camera goes to the room"`: o `OnCallVideo(30, ...)` vai ao `top.video`, e o `Camera(false)` leva a `engine.cameras == {(30,false)}`.
- [ ] **Step 2: Rode o `call_controller_tests` e veja os testes falharem.**
- [ ] **Step 3: Implemente.**
- [ ] **Step 4: Rode o `call_controller_tests`, o motor (o `SipCallEngine`) e o desktop.** Esperado: tudo passa, e os testes de hoje do controlador seguem sem mudança.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` precisa ficar verde: o Windows compila o `EngineHost` com o `RoomAdd`, e o job do núcleo compila o baresip com o `SipCallEngine`.

```bash
git commit -m "feat(video): a sala no controlador: a linha da sala, os convidados, a ligação de fora e os avisos"
```

### Task 8: O núcleo e a ponte: os comandos, o estado, o diagnóstico e o executável

**Files:**
- Modify: `starsonic/desktop/Protocol.h` e `Protocol.cpp`.
- Modify: `starsonic/desktop/DesktopApp.h` e `DesktopApp.cpp`.
- Modify: `windows/app/src/EngineHost.h` e `EngineHost.cpp` (o `OnRoom`).
- Modify: `docs/ponte-windows.md`.
- Create: `tests/desktop/test_desktop_room.cpp`.
- Modify: `tests/desktop/test_protocol.cpp` e `tests/desktop/test_frame_router.cpp`.

**Interfaces:**
- Consumes: o controlador da Task 7.
- Produces:
  - os `CommandKind::RoomAdd` (`salaAdicionar`: o `numero`, texto obrigatório, e o `contato`, booleano opcional), `RoomRemove` (`salaTirar`: o `id`, inteiro ≥ 1, obrigatório), `RoomEnd` (`salaEncerrar`) e `RoomReturn` (`salaVoltar`). Eles usam os campos `number`, `contact` e `callId` do `Command`, e são do `CommandPlatform::Windows`;
  - `DesktopApp::OnRoom(const RoomInfo& room) override`, que vai direto ao controlador, como o `OnCallVideo`;
  - `EngineHost::OnRoom`, que repassa ao listener, como os outros eventos.

**As regras:**
- **O `ligacao.sala`:** `null` sem o `room`; senão, `{"id","fora","cheia","participantes":[{"id","numero","nome","estado","imagem","quadro":{"x","y","largura","altura"}}]}`. O `estado` é `chamando`, `naSala` ou `emEspera`. O nome já vem resolvido, como nos cartões.
- **O `OnRoomEvent`** vira uma linha do `Log`, exatamente as das Global Constraints.
- **O aviso de um convidado que não entra** sai como o toast de hoje, pelo `endMessage`.
- **No iPhone,** os quatro comandos levam `comando recusado no modo iPhone: <nome>`.
- **O `docs/ponte-windows.md`** ganha a parte "A sala de vídeo (0.4.0)":
  - os quatro comandos, com os exemplos de "A ponte nova";
  - o `ligacao.sala` e a linha da sala no `top` e no `second`;
  - o `hangup` com a sala em cima;
  - o `remoto` com o mosaico de quem montou: 1280×720, com o id da sala, e o esvaziar no nascimento e no fim;
  - as linhas `sala:`;
  - o iPhone;
  - a parte "Para o executável", com o `RoomAdd` (Task 7) e o `OnRoom`;
  - uma linha que diz que a ponte falsa das telas segue na etapa 3b.

- [ ] **Step 1: Escreva os testes que falham:**
  - No `test_protocol.cpp`, `"the room commands parse"`:
    - o `salaAdicionar` sem o `numero`, ou com outro tipo, é recusado, e o `contato` ausente vale `false`;
    - o `salaTirar` sem o `id`, com 0 ou com texto, é recusado;
    - o `salaEncerrar` e o `salaVoltar` sem campos;
    - o `CommandName` de cada um.
  - No `test_desktop_room.cpp`, com o `Harness` e os eventos pelo `h.app->On...` e o `h.Run()`:
    - `"the room commands reach the engine"`, com a ligação 11 em vídeo e, depois do primeiro comando, o `OnRoom({30,{11 In,31 Calling}})`:
      - o `salaAdicionar` `2003` leva a `engine.roomAdds == {"2003"}`;
      - com `"contato":true`, `+55 11 5060-3000` passa pela regra dos contatos do perfil;
      - o `salaTirar` `31` leva a `engine.hangups` a ter o 31;
      - o `salaEncerrar` leva o `hangups` a ter o 30;
      - o `salaVoltar`, com a sala fora, leva a `activated` a ter o 30;
    - `"the state carries the room"`: depois do `OnRoom`, o `ligacao.sala` é o JSON exato de "A ponte nova"; o `ligacao.top.id == 30`; e o `sala` é `null` antes e depois do `ended`;
    - `"each room event writes one sala line without names or numbers"`: a sala nasce da ligação 2002 com o 2003, o 2003 atende, o 2004 falha com 486, você vai para fora e volta, o 2003 sai, e a sala acaba. As linhas que começam com `sala:` são exatamente `sala: comecou`, `sala: entrou (2 na sala)`, `sala: falhou (486)`, `sala: fora`, `sala: voltou`, `sala: saiu (1 na sala)` e `sala: acabou`;
    - `"a guest that does not get in shows the reason"`: o toast `"Carlos Lima: Ocupado"`, com o contato do 2003;
    - `"the iPhone has no room"`: com `Harness h(Platform::IPhone)`, os quatro comandos são recusados com a linha certa, o `roomAdds` fica vazio, e o `ligacao.sala` é `null`.
  - No `test_frame_router.cpp`, `"the room's mosaic goes to the remote view while the room is the top line"`: com `topCallId` 30 e o `Remoto` à vista, o `RouteRemote(state,30) == {Remoto}` e o `RouteRemote(state,31)` é vazio (um convidado).
- [ ] **Step 2: Rode o desktop e veja os testes falharem.** Esperado: a compilação falha.
- [ ] **Step 3: Implemente** o protocolo, o `DesktopApp`, o `EngineHost` e a ponte.
- [ ] **Step 4: Rode o desktop, o `call_controller_tests`, a suíte do núcleo e os scripts** (o `build/check_source_text.py` e o `build/check_branding.py`). Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.** O `build` precisa ficar verde (o Windows compila o `EngineHost`, e os testes do desktop no Windows passam), e o `android` também. Este é o fim da etapa 3a. O relatório traz o tempo do `test_engine_room.cpp` no CI.

```bash
git commit -m "feat(video): a sala no núcleo e na ponte: os comandos, o ligacao.sala, as linhas sala: e o executável"
```
