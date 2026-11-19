# Videochamada, etapa 2 — as telas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a videochamada aparece no Starsonic Phone para Windows, como no quadro aprovado. Entram:
- o Ligar com vídeo;
- a ligação com vídeo nos três tamanhos, e a voz com a sua câmera;
- o grande e a tela cheia;
- o Atender com vídeo e o porteiro;
- o chat na ligação;
- as Configurações e o cartão Vídeo;
- a tela de Licenças, com o download do H.264 ligado;
- as fotos, a fumaça, o roteiro e as notas da 0.3.0-rc.1.

**Architecture:**
- **A interface** (`windows/ui`, Preact) ganha a pasta `src/video/`:
  - a leitura da memória dividida (`memoria.ts`);
  - o desenho, com o WebGL ou, sem ele, o canvas 2D (`desenho.ts`);
  - as vistas da página e o `videoViews` (`vistas.ts`);
  - os textos e as telas novas.

  Um componente só, o `VistaDeVideo`, desenha toda imagem de vídeo.
- **A ponte falsa** (`?fake=`) faz o papel do núcleo em tudo que é novo: o estado `video`, os comandos e as memórias. Os testes gravam quadros de mentira nas memórias dela.
- **O núcleo e o executável** ganham só o `noticeHeight` (a altura do aviso, que passa a mudar) e o download do H.264 ligado. O resto da ponte veio na etapa 1.

**Tech Stack:**
- Preact 10.29.8, TypeScript 5.9.3 e esbuild 0.28.2.
- O WebGL 1, com três texturas de luminância, e o canvas 2D.
- O Playwright 1.56.1, com o @axe-core/playwright 4.11.3.
- O servidor do chat em Go, nos testes do chat.
- C++17 com doctest, no núcleo e no `WindowFit`.
- Python 3, na fumaça e nos testes dos scripts.

**Spec:** `docs/superpowers/specs/2026-11-09-starsonic-phone-video-design.md`.
- Valem as seções 4.1 a 4.4, 6.4, 6.6, 7, 8, 10, 11.1, 11.2 (a interface), 11.3 e 12 (a etapa 2).
- O quadro aprovado é o "Starsonic Phone — telas da videochamada" (https://claude.ai/artifact/H85gy1XCcYWgMqPQyMRkfP), com 27 telas em 7 linhas. Os tamanhos e as cores das Tasks vêm dele.
- A ponte é a do `docs/ponte-windows.md`: "Vídeo (0.3.0)", "O vídeo na ligação", os campos `video` e "A memória do vídeo". A Task 5 acrescenta o `noticeHeight`.
- A etapa 1 deixou para esta etapa:
  - o contrato da página com as memórias (Global Constraints);
  - os textos BSD da libvpx e da libyuv na tela de Licenças;
  - o download do H.264 ligado junto com a chave, o aviso e a licença da Cisco;
  - a fumaça das memórias nas duas páginas, também depois de matar o navegador.

## Global Constraints
- **Só o Windows tem vídeo.** No modo iPhone nada de vídeo aparece: nem os botões, nem as vistas, nem o campo Câmera, nem a chave do H.264. Isso vale mesmo que o estado traga `video.ligado` ou um cartão com vídeo: a interface lê o vídeo só pelo `videoDoApp` e pelo `videoDe` da Task 1, que são neutros no iPhone.
- **Os botões de vídeo** só aparecem com `video.ligado`. São o Ligar com vídeo, o Atender com vídeo, a Câmera, o campo Câmera e o Testar a câmera.
  - A chave "H.264 da Cisco" aparece com `video.h264.cartao`, mesmo com o `video.ligado` desligado.
  - O Rediscar, os Atalhos e o Ligar do painel Nova ligação continuam só com voz.
- **Os comandos** são os de "A ponte desta etapa", com os campos exatos. O "Ligar" e o "Atender" de sempre continuam sem o campo `video`, nunca com `"video": false`: os testes de hoje comparam o comando inteiro.
- **A câmera nunca liga sozinha.** A interface só manda `"video": true`, o `camera` com `"on": true` e o `cameraTest` com `"on": true` no clique da pessoa: no Ligar com vídeo, no Atender com vídeo, na Câmera e no Testar a câmera.
- **Com a câmera ligada, a sua imagem está à vista.** Com o `ligacao.top.video.camera` (ou o `video.teste` nas Configurações), a vista "Sua imagem" aparece em toda tela que a pessoa vê:
  - a ligação, com ou sem um painel aberto;
  - o grande e a tela cheia;
  - a faixa da conversa.
- **O contrato da página com as memórias** (o "A memória do vídeo" da ponte):
  - cada vista desenha só a ligação dela: o `remoto` leva o `key` do id da ligação de cima, e o `porteiro`, o da que toca;
  - o `seq` 0 é vazio. Uma vista que monta, ou que ganha uma memória nova, só desenha um quadro com o `seq` maior que o da memória naquele instante;
  - o `remoto` desenha só com o `video.imagem` da ligação de cima, ou, tocando, com o `video.cedo` dela;
  - o `porteiro` desenha só com o `video.cedo` da que toca;
  - o `local` desenha só com o `video.camera` da ligação de cima, ou com o `video.teste`;
  - a página diz as vistas à vista pelo `videoViews`: a lista inteira, em ordem alfabética, uma vez a cada mudança;
  - a página nunca escreve numa memória.
- **O teste da câmera para** (`cameraTest` com `"on": false`) quando a tela Configurações sai, por qualquer caminho.
- **Os avisos do vídeo** (os seis toasts de "Os textos") ficam 5 s na tela. Os outros toasts continuam com os 2 s de hoje.
- **O quadro aprovado decide o desenho.**
  - As cores são as variáveis do `app.css` de hoje.
  - O fundo da área do vídeo e das faixas da imagem encaixada é `#04060e`.
  - Os nomes das vistas para o leitor de tela são os de "Os textos".
- **Os três tamanhos e os dois temas** são os do `layout.ts`: Normal, Compacto e Mínimo, no tema claro e no escuro. A tela da ligação nunca rola, e nenhum botão sai da janela.
- **A ponte falsa vem com o vídeo ligado no cenário `principal`,** como o app de fábrica (o H.264 e o VP8 ligados). A suíte inteira continua verde. Um teste de antes que quebra por causa de um botão novo é conferido, e um layout que não cabe mais é consertado no CSS, não no teste.
- **Os testes da interface** rodam na pasta `windows/ui`, contra o `dist`, com o `npm run build` antes.
  - Localmente, com `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.
  - Os testes do chat sobem o servidor em Go pelo `global-setup`. O `go` precisa de `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`.
- **Os nomes dos testes** ficam em inglês, como os de hoje. Os comentários e os documentos ficam em português, no estilo de cada arquivo; o `starsonic/desktop` e o `windows/app/src` são escritos sem acento.
- **Nenhum "MicroSIP" visível.** O `build/check_branding.py` continua passando.
- **Os commits** levam os trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
  - O push vai para a branch `video-etapa-2`, sem force e sem tags, releases ou segredos. Ela só entra no `main` depois que a 0.2.0 final sair, com o OK do Lucas. O repositório é público.
  - Cada Task termina com o CI verde (o `build` e o `android`), conferido pelo `gh api` REST. O GraphQL está bloqueado.
- **A 0.3.0-rc.1 é publicada pelo Lucas,** pelo workflow `release`, depois de ele aprovar as fotos e os textos. Este plano não publica nada.

## A ponte desta etapa
**Os comandos que a interface manda.** Todos já existem no núcleo, menos o `noticeHeight`, da Task 5:
```json
{"v":1,"cmd":"dial","numero":"2003","video":true}
{"v":1,"cmd":"dial","numero":"2007","contato":true,"video":true}
{"v":1,"cmd":"answer","video":true}
{"v":1,"cmd":"camera","on":false}
{"v":1,"cmd":"setVideo","camera":"Câmera USB"}
{"v":1,"cmd":"setVideo","h264":false}
{"v":1,"cmd":"cameraTest","on":true}
{"v":1,"cmd":"videoViews","pagina":"principal","vistas":["local","remoto"]}
{"v":1,"cmd":"videoViews","pagina":"aviso","vistas":["porteiro"]}
{"v":1,"cmd":"videoWindow","modo":"grande"}
{"v":1,"cmd":"h264Retry"}
{"v":1,"cmd":"adminSet","videoVp9":true}
{"v":1,"cmd":"adminSet","videoPrimeiro":"vp8"}
{"v":1,"cmd":"adminSet","videoQualidade":"alta"}
{"v":1,"cmd":"adminSet","porteiros":["1050","1051"]}
{"v":1,"cmd":"noticeHeight","altura":222}
```

**O que a interface lê:**
- o bloco `video`: `ligado`, `cameras`, `camera`, `cameraDesconectada`, `teste`, `h264.cartao`, `h264.pessoa`, `h264.situacao` e `janela`;
- o `video` de cada cartão da ligação: `oferece`, `ativo`, `imagem`, `camera` e `cedo`;
- com a área do administrador aberta: `admin.videoH264`, `videoVp8`, `videoVp9`, `videoPrimeiro`, `videoQualidade` e `porteiros`.

**As memórias:**
- Cada uma chega pelo evento `sharedbufferreceived` do `window.chrome.webview`, com o `getBuffer()` e o `additionalData` `{"v":1,"type":"videoBuffer","vista":"remoto","bytes":6220864}`.
- Quando chega uma memória nova da mesma vista, a página solta a velha com o `window.chrome.webview.releaseBuffer(buffer)`. Uma memória que não confere é solta na hora.

## Os textos (o texto exato)
- **Os botões:** `Ligar com vídeo`, `Atender com vídeo`, `Câmera`, `Abrir grande`, `Diminuir`, `Tela cheia`, `Sair da tela cheia`, `Chat`, `Voltar para a ligação`, `Testar a câmera`, `Parar o teste` e `Tentar de novo`.
- **Os nomes para o leitor de tela:**
  - `Ligar a câmera` e `Desligar a câmera`: a Câmera, conforme ela está desligada ou ligada;
  - `Ligar com vídeo para <nome>`, nos Contatos;
  - `Ligar com vídeo para <nome>, ramal <ramal>`, na conversa, como o `Ligar para <nome>, ramal <ramal>` de hoje;
  - `Vídeo de <nome>`: a imagem da outra ponta e a do porteiro;
  - `Sua imagem`.
- **As Configurações:** `Áudio e vídeo`, `Câmera`, `Nenhuma câmera encontrada.`, `<nome> (desconectada)`, e `H.264 da Cisco` com `OpenH264 Video Codec provided by Cisco Systems, Inc.` embaixo.
- **O cartão Vídeo:**
  - `Vídeo`, `Codecs`, `H.264`, `VP8`, `VP9`, `Primeiro`, `Qualidade`, `Baixa`, `Média`, `Alta` e `Porteiros`;
  - a ajuda dos Porteiros: `Ramais dos porteiros, separados por vírgula: o app mostra a imagem deles antes de atender.`;
  - a situação: `H.264 da Cisco: instalado`, `H.264 da Cisco: baixando…` ou `H.264 da Cisco: não foi possível baixar`.
- **A faixa da conversa:** `Em ligação · <tempo>` com a imagem pequena, ou `<nome> · <tempo>` sem ela.
- **A tela de Licenças:** o título `Avisos de licença`, e o destaque `OpenH264 Video Codec provided by Cisco Systems, Inc.` embaixo do `OpenH264 2.6.0`.
- **Os avisos de 5 s** (os toasts do núcleo):
  - `A outra ponta não aceitou o vídeo.`
  - `A câmera está sendo usada por outro programa.`
  - `A câmera foi desconectada.`
  - `O Windows bloqueou a câmera para este app. Libere em Configurações do Windows → Privacidade e segurança → Câmera.`
  - `Este vídeo precisa do H.264, que ainda não foi baixado.`
  - `Nenhuma câmera encontrada.`
- **Os avisos dos Porteiros** (do núcleo, e iguais na ponte falsa): `No máximo 20 porteiros.`, `Cada porteiro só pode ter dígitos.`, `Cada porteiro precisa ter de 1 a 15 dígitos.` e `Esse porteiro já está na lista.`.
- **As notas da versão:** o texto da Task 11.

## Review Focus
1. **A troca da ligação com a imagem na tela:** o Alternar, a segunda atendida, uma ligação nova logo depois de outra. A área do vídeo nunca mostra, nem por um instante, a imagem da ligação de antes. Teste: a Task 4 (`the remote view never shows a frame of the previous call`).
2. **A câmera ligada com a sua imagem fora da vista:** um painel aberto na ligação, o grande sem a imagem da outra ponta, a conversa aberta pela ligação. A "Sua imagem" continua à vista. Testes: a Task 4 (`your image stays in sight with every panel`), a Task 7 (`the big window always shows your image with the camera on`) e a Task 8 (`the call strip shows your image with the camera on`).
3. **A tela Configurações que sai com o teste da câmera ligado:** o Voltar, uma ligação que chega, o Ctrl + 1. O teste para, e a luz da câmera apaga. Teste: a Task 2 (`leaving Configurações by any way stops the camera test`).
4. **Uma imagem ou uma área que muda de tamanho no meio:** o porteiro que troca de resolução, um tamanho ímpar, a janela redimensionada. A imagem encaixa sem deformar, com faixas onde sobra. Testes: a Task 1 (`odd sizes round the chroma planes up`), a Task 2 (`a size change in the middle letterboxes the new size`) e a Task 4 (`resizing the window keeps the video fitted`).
5. **O chat fora, ou a busca do colega que falha, durante a ligação.** O botão "Chat" não aparece, não sai aviso nenhum e a tela da ligação segue normal. Teste: a Task 8 (`the Chat button stays away while the chat is not ready or the lookup fails, without a toast`).

## As pastas e as responsabilidades
- **`windows/ui/src/video/estado.ts`:** o vídeo do estado, lido com segurança (`SEM_VIDEO`, `VIDEO_DESLIGADO`, `videoDoApp` e `videoDe`).
- **`windows/ui/src/video/memoria.ts`:** a memória SSV1. A leitura é da página; a escrita, só da ponte falsa e dos testes.
- **`windows/ui/src/video/desenho.ts`:** o encaixe sem deformar, a conversão BT.601 e o desenhista (WebGL, ou 2D).
- **`windows/ui/src/video/vistas.ts`:** as vistas de uma página: as memórias que chegam e o `videoViews`.
- **`windows/ui/src/video/textos.ts`:** os textos do vídeo.
- **`windows/ui/src/components/VistaDeVideo.tsx`:** a vista, para toda imagem de vídeo.
- **`windows/ui/src/components/Select.tsx`:** o `Select` das Configurações, que sai do `Configuracoes.tsx` para o campo Câmera usar também.
- **`windows/ui/src/video/ConfigDoVideo.tsx`:** o campo Câmera, o teste e a chave do H.264, no cartão "Áudio e vídeo".
- **`windows/ui/src/screens/tempoDaLigacao.ts`:** o `useNow` e o `statusLine`, que saem do `Ligacao.tsx` para a faixa e o grande usarem.
- **`windows/ui/src/video/CaixaDoVideo.tsx`:** a área do vídeo da tela da ligação, com a sua imagem e o Abrir grande, e a sua imagem flutuante.
- **`windows/ui/src/video/alturaDoAviso.ts`:** as três alturas do aviso.
- **`windows/ui/src/video/Grande.tsx`:** o grande e a tela cheia.
- **`windows/ui/src/video/chatDaLigacao.ts` e `FaixaDaLigacao.tsx`:** o colega da ligação no chat e a faixa em cima da conversa.
- **`windows/ui/src/screens/AdminVideo.tsx`:** o cartão Vídeo.
- **`windows/ui/assets/licencas-windows.txt`, `starsonic/third_party/libvpx/` e `starsonic/third_party/libyuv/`:** os textos das licenças.
- **`starsonic/desktop/Protocol.*`, `DesktopApp.*`, `windows/app/src/WindowFit.*`, `NoticeWindow.*`, `MainWindow.*` e `main.cpp`:** o `noticeHeight`.
- **`windows/ui/tests/video/`:** os testes novos, com o ajudante `video.ts`. Os testes que precisam do servidor do chat ficam em `windows/ui/tests/chat/`.

## Como rodar os testes
- **A interface:**
  ```bash
  cd windows/ui && npm ci && npm run build
  NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test tests/video
  ```
  A suíte inteira é o `npx playwright test`, com as mesmas variáveis.
- **O núcleo do desktop:**
  ```bash
  cmake -S tests/desktop -B build-desktop -G Ninja && cmake --build build-desktop -j 8 && build-desktop/desktop_tests
  ```
- **Os scripts:** `python3 -m unittest discover -s tests/python`.
- **O código só do Windows** (o executável e a fumaça) é conferido pelo `build.yml`.
- **O CI** é conferido com `gh api "repos/LucasCPena/starsonic-phone/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'`. O `build` e o `android` precisam ficar verdes.
- **Os testes instáveis já conhecidos** rodam de novo uma vez, pelo REST, e o caso fica anotado: o `windows/ui/tests/chat/lista.spec.ts:286`, o `windows/ui/tests/chat/fotos.spec.ts:584`, o `LoginScreenTest` do emulador do Android e a fumaça de abrir e fechar do app antigo.

---

### Task 1: Os tipos, a memória e a ponte falsa

**Files:**
- Modify: `windows/ui/src/state.ts`
- Create: `windows/ui/src/video/estado.ts`, `windows/ui/src/video/memoria.ts`, `windows/ui/src/video/textos.ts`
- Modify: `windows/ui/src/icons.tsx`, `windows/ui/src/fake.ts`, `windows/ui/src/fake-scenarios.ts`
- Create: `windows/ui/tests/video/memoria.spec.ts`, `windows/ui/tests/video/ponte-falsa.spec.ts`

**Interfaces:**
- Produces (`state.ts`):
  ```ts
  export interface CallVideo { oferece: boolean; ativo: boolean; imagem: boolean; camera: boolean; cedo: boolean }
  export type H264Situacao = 'desligado' | 'baixando' | 'instalado' | 'falhou';
  export type VideoJanela = 'normal' | 'grande' | 'telaCheia';
  export type CodecDeVideo = 'h264' | 'vp8' | 'vp9';
  export type QualidadeDeVideo = 'baixa' | 'media' | 'alta';
  export type VistaDeVideoNome = 'remoto' | 'local' | 'porteiro';
  export type PaginaDeVideo = 'principal' | 'aviso';
  export interface VideoSettings {
    ligado: boolean; cameras: string[]; camera: string; cameraDesconectada: boolean; teste: boolean;
    h264: { cartao: boolean; pessoa: boolean; situacao: H264Situacao }; janela: VideoJanela;
  }
  // CallCard ganha `video?: CallVideo`; AppState ganha `video?: VideoSettings` (os dois sempre vêm do núcleo; o `?`
  // protege o estado montado à mão nos testes de antes).
  // A variante `aberto: true` do AdminState ganha: videoH264, videoVp8, videoVp9 (boolean), videoPrimeiro: CodecDeVideo,
  // videoQualidade: QualidadeDeVideo, porteiros: string[].
  export type AdminAberto = Extract<AdminState, { aberto: true }>;
  // Command: o `dial` ganha `video?: boolean`; o `answer` vira `{ cmd: 'answer'; video?: boolean }`; o `adminSet` ganha
  // os seis campos do cartão (opcionais); entram:
  | { cmd: 'camera'; on: boolean }
  | { cmd: 'setVideo'; camera?: string; h264?: boolean }
  | { cmd: 'cameraTest'; on: boolean }
  | { cmd: 'videoViews'; pagina: PaginaDeVideo; vistas: VistaDeVideoNome[] }
  | { cmd: 'videoWindow'; modo: VideoJanela }
  | { cmd: 'h264Retry' }
  | { cmd: 'noticeHeight'; altura: number }
  ```
- Produces (`video/estado.ts`):
  ```ts
  export const SEM_VIDEO: CallVideo;            // os cinco campos false
  export const VIDEO_DESLIGADO: VideoSettings;  // ligado false, cameras [], camera '', cameraDesconectada false, teste false,
                                                // h264 { cartao: false, pessoa: false, situacao: 'desligado' }, janela 'normal'
  export function videoDoApp(state: AppState): VideoSettings;           // VIDEO_DESLIGADO no iPhone ou sem o campo
  export function videoDe(state: AppState, card: CallCard): CallVideo;  // SEM_VIDEO no iPhone ou sem o campo
  ```
- Produces (`video/memoria.ts`), com os valores do "A memória do vídeo" da ponte:
  ```ts
  export const MARCA = 0x31565353;
  export const CABECALHO = 64;
  export const TAMANHO_DO_LUGAR = 3_110_400;    // 1920*1080 + 2*(960*540)
  export const TAMANHO_DA_MEMORIA = 6_220_864;  // 64 + 2 * TAMANHO_DO_LUGAR
  export interface QuadroI420 { seq: number; largura: number; altura: number; y: Uint8Array; u: Uint8Array; v: Uint8Array }
  export type Plano = number | Uint8Array;      // um valor só (a cor lisa) ou o plano inteiro
  export function seqDe(memoria: ArrayBuffer): number;   // o seq de agora (Atomics.load num Int32Array)
  export function copiarQuadro(memoria: ArrayBuffer, jaVisto: number): QuadroI420 | null;
  export function aindaVale(memoria: ArrayBuffer, quadro: QuadroI420): boolean;   // o seq não mudou desde a cópia
  export function lerQuadro(memoria: ArrayBuffer, jaVisto: number): QuadroI420 | null;   // copiarQuadro + aindaVale
  export function escreverQuadro(memoria: ArrayBuffer, largura: number, altura: number, y: Plano, u: Plano, v: Plano): void;
  export function esvaziar(memoria: ArrayBuffer): void;
  ```
- Produces (`video/textos.ts`), um nome por texto de "Os textos":
  - as constantes `LIGAR_COM_VIDEO`, `ATENDER_COM_VIDEO`, `CAMERA`, `LIGAR_A_CAMERA`, `DESLIGAR_A_CAMERA`, `ABRIR_GRANDE`, `DIMINUIR`, `TELA_CHEIA`, `SAIR_DA_TELA_CHEIA`, `CHAT`, `VOLTAR_PARA_A_LIGACAO`, `TESTAR_A_CAMERA`, `PARAR_O_TESTE`, `TENTAR_DE_NOVO`, `SUA_IMAGEM`, `AUDIO_E_VIDEO`, `NENHUMA_CAMERA`, `H264_DA_CISCO`, `AVISO_DA_CISCO`, `EM_LIGACAO` e `AJUDA_DOS_PORTEIROS`;
  - `AVISOS_DE_5_S: ReadonlySet<string>`, com os seis avisos;
  - as funções `rotuloDoVideo(nome: string)` (`Vídeo de <nome>`), `ligarComVideoPara(nome: string, ramal?: string)`, `cameraDesconectada(nome: string)` e `situacaoDoH264(s: H264Situacao): string | null` (`null` para `desligado`).
- Produces (`icons.tsx`), com o `svg()` de hoje e os caminhos do quadro:
  - `IconVideo`: `<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/>` e `<path d="M15.5 10.5L21 7.5v9l-5.5-3"/>`;
  - `IconVideoOff`: os dois do `IconVideo` e `<path d="M3 3l18 18"/>`;
  - `IconExpand`: `M15 3h6v6`, `M9 21H3v-6`, `M21 3l-7 7` e `M3 21l7-7`;
  - `IconShrink`: `M4 14h6v6`, `M20 10h-6V4`, `M14 10l7-7` e `M3 21l7-7`;
  - `IconFullscreen`: `M8 3H5a2 2 0 0 0-2 2v3`, `M21 8V5a2 2 0 0 0-2-2h-3`, `M3 16v3a2 2 0 0 0 2 2h3` e `M16 21h3a2 2 0 0 0 2-2v-3`;
  - `IconExitFullscreen`: `M8 3v3a2 2 0 0 1-2 2H3`, `M21 8h-3a2 2 0 0 1-2-2V3`, `M3 16h3a2 2 0 0 1 2 2v3` e `M16 21v-3a2 2 0 0 1 2-2h3`;
  - `IconStop`: `<rect x="6" y="6" width="12" height="12" rx="2"/>`.
- Produces (a ponte falsa):
  - os cenários `video`, `video-voz-camera`, `video-tocando`, `video-porteiro`, `video-grande`, `sem-video` e `sem-camera` (o Step 3), também no `SCENARIO_NAMES`;
  - o gancho `window.__fake.mandar(comando)`: o comando como se a página o mandasse. É só dos testes da ponte falsa.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `memoria.spec.ts` (roda no Node e importa `../../src/video/memoria`):
    - `a written frame reads back with its size and planes`: um quadro 4×2 com o Y `[16,17,18,19,20,21,22,23]`, o U `[100,101]` e o V `[200,201]` volta no `lerQuadro(m, 0)` com a largura 4, a altura 2, o `seq` 2 e os três planos iguais.
    - `an empty memory, a frame already seen or a header being written gives nothing`: a memória nova dá `null`. O `lerQuadro(m, q.seq)` do quadro já lido dá `null`. Um `seq` ímpar no byte 4 (o `DataView.setUint32(4, 3, true)`) dá `null`.
    - `the writer alternates the slots and keeps counting after esvaziar`:
      - três quadros seguidos dão o `seq` 2, 4 e 6, com o lugar (o u32 do byte 8) 0, 1 e 0;
      - o `esvaziar` põe o `seq` em 0, e o `lerQuadro` dá `null`;
      - o quadro seguinte dá o `seq` 8, no lugar 1.
    - `a header that does not fit gives nothing`. Depois de um quadro bom, cada um destes dá `null`:
      - a marca trocada;
      - a largura 1921, e a altura 0 ou 1081;
      - o `yStride` diferente da largura;
      - o `uvStride` diferente de `(largura+1)>>1`;
      - o lugar 2;
      - o tamanho do lugar diferente de 3110400;
      - uma memória de 6220863 bytes.
    - `a copy torn by the writer is dropped`: o `copiarQuadro(m, 0)`, um `escreverQuadro` e o `aindaVale(m, copia)` dá `false`. O `lerQuadro(m, 0)` dá o quadro novo.
    - `odd sizes round the chroma planes up` (Review Focus 4): no 175×143, o Y tem 25025 bytes, e o U e o V têm 6336 cada (88 × 72). Os valores voltam iguais.
    - `the biggest frame fills the slot`: no 1920×1080, o Y tem 2073600 bytes, e o U e o V têm 518400 cada.
  - No `ponte-falsa.spec.ts` (a página, com o `__fake.mandar` e o `estado` do `tests/helpers.ts`):
    - `the fake core carries the video state of the core`:
      - no `?fake=principal`, o `video` é `{ligado: true, cameras: ['Integrated Camera', 'Câmera USB'], camera: '', cameraDesconectada: false, teste: false, h264: {cartao: true, pessoa: true, situacao: 'instalado'}, janela: 'normal'}`;
      - no `?fake=video`, o `ligacao.top.video` é `{oferece: false, ativo: true, imagem: true, camera: true, cedo: false}`.
    - `the fake core answers the video commands like the core`:
      - o `setVideo` com `camera: 'Logitech C920'` põe o `cameraDesconectada` em `true`, e com `'Câmera USB'`, em `false`;
      - o `setVideo` com `h264: false` põe o `h264.pessoa` em `false` e a situação em `desligado`, e o `ligado` continua `true` (o VP8). Com `h264: true`, a situação vira `baixando` e depois `instalado`;
      - o `cameraTest` ligado põe o `teste` em `true`, e o `ready` o desliga. No `?fake=sem-camera`, o `teste` fica `false` e aparece o toast `Nenhuma câmera encontrada.`;
      - o `videoWindow` com `grande` põe a `janela` em `grande`, e um modo desconhecido não muda nada. No `?fake=video-grande`, o `hangup` acaba a ligação e põe a `janela` em `normal`;
      - no `?fake=video`, o `camera` com `on: false` põe o `top.video.camera` em `false`;
      - no `?fake=video-tocando`, o `answer` com `video: true` deixa a ligação `active`, com o vídeo `{oferece: true, ativo: true, imagem: true, camera: true, cedo: false}`. Sem o `video`, a `camera` fica `false`;
      - o `h264Retry` com a situação `instalado` não muda nada. Com `falhou` (pelo `mudarEstado`), ela vira `baixando`.
    - `the fake core refuses the doorphones like the core`. Com a área aberta (o `entrarNaAdmin`), pelo `adminSet`:
      - 21 ramais dão o toast `No máximo 20 porteiros.`, e a lista não muda;
      - `['10a']` dá `Cada porteiro só pode ter dígitos.`;
      - `['']` e `['1234567890123456']` dão `Cada porteiro precisa ter de 1 a 15 dígitos.`;
      - `['1050', '1050']` dá `Esse porteiro já está na lista.`;
      - `[' 1050 ', '1051']` grava `['1050', '1051']`;
      - o `videoH264: false` com o `videoVp8: false` (e o VP9 desligado de fábrica) põe o `video.ligado` e o `video.h264.cartao` em `false`;
      - o `videoPrimeiro: 'av1'` é ignorado.
    - `the iPhone fake has no video`: no `?fake=video&plataforma=ios`, o `video.ligado` é `false` e o `ligacao.top.video` tem os cinco campos `false`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/memoria.spec.ts tests/video/ponte-falsa.spec.ts` falha: o módulo `memoria` não existe e os cenários são desconhecidos.
- [ ] **Step 3: Implemente.**
  - **`memoria.ts`:**
    - A leitura segue os três passos do "A memória do vídeo" da ponte. O `copiarQuadro` lê o `s1`, confere o cabeçalho e copia os planos para fora da memória (o `slice`); o `aindaVale` lê o `s2`.
    - O cabeçalho que serve tem a marca, o `seq` par e maior que 0 (e diferente do `jaVisto`), o lugar 0 ou 1, a largura de 1 a 1920, a altura de 1 a 1080, os dois passos certos, o tamanho do lugar certo e a memória com pelo menos 6220864 bytes.
    - O escritor imita o `FrameBufferWriter` do executável. O primeiro quadro vai para o lugar 0, e os seguintes alternam. A conta é: `seq+1`, o cabeçalho, `seq+1`.
    - O contador e o lugar ficam num `WeakMap` da memória e nunca são lidos de volta dela. O `esvaziar` põe o `seq` do cabeçalho em 0 sem zerar o contador.
  - **`estado.ts`** usa o `isIos` do `plataforma.ts`.
  - **A ponte falsa:**
    - O `principal()` ganha o `video` do primeiro teste, e o `admin` guardado ganha os padrões do cartão: o H.264 e o VP8 ligados, o VP9 desligado, o H.264 primeiro, a qualidade `media` e nenhum porteiro.
    - O `cartao()` vem com o `video: SEM_VIDEO`.
    - O `estadoDoIphone` põe o `video: VIDEO_DESLIGADO` e o `SEM_VIDEO` em cada cartão.
    - Os comandos seguem o "Vídeo (0.3.0)" e o "O vídeo na ligação" da ponte:
      - o `ligado` é o VP8 ou o VP9 do cartão, ou o H.264 do cartão com a chave da pessoa;
      - o `h264` ligado de novo vira `baixando` e, 1 s depois, `instalado`;
      - o `h264Retry` só vale depois de `falhou`: vira `baixando` e, 1 s depois, `instalado`;
      - o `cameraTest` sem câmeras manda o toast;
      - o `ready` da página principal desliga o `teste`;
      - o fim da última ligação volta a `janela` a `normal`;
      - o `answer` com `video` liga o `camera`; o `ativo` e o `imagem` seguem o `oferece`, e o `cedo` vira `false`;
      - o `camera` liga ou desliga o `camera` da de cima, quando ela tem o id maior que 0 e não está tocando, e o `ativo` fica `true` quando ela liga;
      - o `adminSet` confere os porteiros na ordem do núcleo: a quantidade, os dígitos, o tamanho (de 1 a 15) e a repetição, cada item sem os espaços das pontas;
      - o `noticeHeight` e o `videoViews` só ficam no `__comandos`. As memórias são da Task 2.
    - **Os cenários:**
      - `video`: a Ana (id 11, ramal 2003) em ligação há 3 min 12 s, com o vídeo `{ativo: true, imagem: true, camera: true}`;
      - `video-voz-camera`: a mesma ligação, com `{ativo: true, imagem: false, camera: true}`;
      - `video-tocando`: a Ana tocando (id 21), com `{oferece: true}` e o toque `completo`;
      - `video-porteiro`: a Portaria tocando (id 31, número `1050`, nome `Portaria`), com `{oferece: true, imagem: true, cedo: true}` e o toque `completo`;
      - `video-grande`: o `video`, com a `janela` em `grande`;
      - `sem-video`: o `principal`, com `ligado: false` e o `h264` `{cartao: false, pessoa: true, situacao: 'desligado'}`;
      - `sem-camera`: o `principal`, com `cameras: []`, abrindo nas Configurações.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos passam, e depois a suíte inteira (`npx playwright test`).
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): os tipos, a memória e a ponte falsa do vídeo`. O CI fica verde.

### Task 2: A vista de vídeo e as Configurações

**Files:**
- Modify: `windows/ui/src/bridge.ts`, `windows/ui/src/fake.ts`
- Create: `windows/ui/src/video/desenho.ts`, `windows/ui/src/video/vistas.ts`, `windows/ui/src/components/VistaDeVideo.tsx`, `windows/ui/src/components/Select.tsx`, `windows/ui/src/video/ConfigDoVideo.tsx`
- Modify: `windows/ui/src/main.tsx` (o `criarVideoDaPagina` e o provedor), `windows/ui/src/screens/Configuracoes.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/video.ts`, `windows/ui/tests/video/desenho.spec.ts`, `windows/ui/tests/video/configuracoes.spec.ts`

**Interfaces:**
- Consumes (Task 1): os tipos, o `memoria.ts`, o `estado.ts`, o `textos.ts`, os ícones e o `__fake.mandar`.
- Produces (`bridge.ts`):
  ```ts
  export interface SharedBufferEventLike { additionalData: unknown; getBuffer(): ArrayBuffer }
  // WebviewLike ganha addEventListener/removeEventListener('sharedbufferreceived', ...) e releaseBuffer?(buffer: ArrayBuffer).
  // Bridge ganha:
  subscribeBuffers(listener: (vista: VistaDeVideoNome, buffer: ArrayBuffer) => void): () => void;
  releaseBuffer(buffer: ArrayBuffer): void;
  ```
  Só passa uma memória com o `additionalData` (o objeto, ou o texto JSON dele) igual a `{v: 1, type: 'videoBuffer', vista, bytes: 6220864}`, uma vista conhecida e o `byteLength` de pelo menos 6220864. As outras são soltas na hora.
- Produces (a ponte falsa):
  - a memória de cada vista da página nasce no primeiro `videoViews` que a mostra e chega pelo `sharedbufferreceived`, de forma assíncrona. As vistas da outra página são ignoradas;
  - o evento leva o mesmo `ArrayBuffer` da ponte falsa, sem o `structuredClone` das mensagens: os quadros gravados depois aparecem na página;
  - os ganchos:
    - `__fake.quadro(vista, largura, altura, y, u, v): boolean`, o `escreverQuadro` na memória da vista (`false` enquanto ela não tem memória);
    - `__fake.esvaziar(vista)`;
    - `__fake.memoriaCrua(dados: unknown, bytes: number)`, que entrega uma memória qualquer;
    - `__fake.liberadas(): number`, quantas a página soltou.
- Produces (`desenho.ts`):
  ```ts
  export const COR_DO_FUNDO: readonly [number, number, number];   // [4, 6, 14], o #04060e
  export interface Retangulo { x: number; y: number; largura: number; altura: number }
  export function encaixar(largura: number, altura: number, areaLargura: number, areaAltura: number): Retangulo;   // Math.round
  export function i420ParaRgb(y: number, u: number, v: number): [number, number, number];
  export interface Desenhista { readonly tipo: 'webgl' | '2d'; desenhar(q: QuadroI420): void; limpar(): void; liberar(): void }
  export function criarDesenhista(canvas: HTMLCanvasElement): Desenhista;
  ```
- Produces (`vistas.ts`):
  ```ts
  export interface VideoDaPagina {
    memoria(vista: VistaDeVideoNome): ArrayBuffer | null;
    aoMudar(ouvinte: (vista: VistaDeVideoNome) => void): () => void;   // uma memória chegou ou trocou
    mostrar(vista: VistaDeVideoNome): () => void;   // conta a vista à vista; devolve o tirar
  }
  export function criarVideoDaPagina(bridge: Bridge, pagina: PaginaDeVideo): VideoDaPagina;
  export const VideoContexto: preact.Context<VideoDaPagina | null>;
  ```
  As vistas contam por referência, e o `videoViews` sai na microtarefa seguinte, só quando a lista mudou. A memória nova de uma vista solta a velha pelo `bridge.releaseBuffer`.
- Produces (`components/VistaDeVideo.tsx`):
  ```tsx
  export function VistaDeVideo(props: { vista: VistaDeVideoNome; desenhar: boolean; rotulo: string; espelhar?: boolean; class?: string }): VNode;
  ```
  Ela desenha um `div` com o `role="img"`, o `aria-label={rotulo}`, o `data-vista={vista}` e, quando já tem a memória, o `data-memoria`. Dentro fica um `canvas` com o `data-desenho="webgl"` ou `"2d"`.
- Produces (`components/Select.tsx`): o `Select` e o tipo `Opcao`, movidos do `Configuracoes.tsx` sem mudar o desenho, com um `disabled?: boolean` novo.
- Produces (`tests/video/video.ts`):
  ```ts
  export const VERMELHO: [number, number, number] = [82, 90, 240];    // vira [255, 1, 0]
  export const BRANCO: [number, number, number] = [235, 128, 128];    // vira [255, 255, 255]
  export const PRETO: [number, number, number] = [16, 128, 128];      // vira [0, 0, 0]
  export const FUNDO: [number, number, number] = [4, 6, 14];
  export async function quadro(page: Page, vista: VistaDeVideoNome, yuv: [number, number, number], largura = 640, altura = 480): Promise<void>;
  export async function corNoPonto(page: Page, x: number, y: number): Promise<[number, number, number]>;
  export async function corNoMeio(page: Page, alvo: Locator): Promise<[number, number, number]>;
  export async function semWebGL(page: Page): Promise<void>;
  export function perto(cor: number[], esperada: number[], tolerancia = 2): boolean;
  ```
  - O `quadro` espera uma vista da página com o `data-vista` dela e o `data-memoria`, e depois grava pelo `__fake.quadro`.
  - O `corNoPonto` é uma captura de 1×1 lida na página: um PNG `data:`, desenhado num canvas e lido pelo `getImageData`.
  - O `semWebGL` é um `addInitScript` em que o `getContext` devolve `null` para `webgl`, `webgl2` e `experimental-webgl`.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `desenho.spec.ts` (Node):
    - `encaixar fits without distortion and centers`:
      - `(640, 480, 356, 300)` dá `{x: 0, y: 17, largura: 356, altura: 267}`;
      - `(1280, 720, 308, 195)` dá `{x: 0, y: 11, largura: 308, altura: 173}`;
      - `(640, 480, 308, 195)` dá `{x: 24, y: 0, largura: 260, altura: 195}`;
      - `(640, 480, 640, 480)` dá `{x: 0, y: 0, largura: 640, altura: 480}`.
    - `i420ParaRgb uses BT.601 limited range`: `(235, 128, 128)` dá `[255, 255, 255]`, `(16, 128, 128)` dá `[0, 0, 0]` e `(82, 90, 240)` dá `[255, 1, 0]`.
  - No `configuracoes.spec.ts` (`?fake=configuracoes`):
    - `Áudio e vídeo has the Câmera field with the computer's cameras`:
      - o título `Áudio e vídeo` e o campo `Câmera`, com as opções `Integrated Camera` e `Câmera USB`, e a primeira escolhida;
      - escolher `Câmera USB` manda `{cmd: 'setVideo', camera: 'Câmera USB'}`.
    - `a chosen camera that is not connected shows (desconectada)`: com `camera: 'Logitech C920'` e `cameraDesconectada: true` (pelo `mudarEstado`), a escolhida é `Logitech C920 (desconectada)`.
    - `without cameras the field says Nenhuma câmera encontrada. and the test is off`: no `?fake=sem-camera`, o campo fica desativado com `Nenhuma câmera encontrada.`, e o `Testar a câmera` fica desativado.
    - `Testar a câmera shows your image until Parar o teste`:
      - o `Testar a câmera` manda `{cmd: 'cameraTest', on: true}`;
      - a prévia `Sua imagem` aparece, e sai `{cmd: 'videoViews', pagina: 'principal', vistas: ['local']}`;
      - o `quadro(page, 'local', VERMELHO)` deixa o meio da prévia `perto` de `[255, 1, 0]`, com o `data-desenho="webgl"` quando a página tem o WebGL;
      - o `Parar o teste` manda `{cmd: 'cameraTest', on: false}`. A prévia sai, e sai `{cmd: 'videoViews', pagina: 'principal', vistas: []}`.
    - `without WebGL the preview draws with the 2D canvas`: com o `semWebGL`, a prévia tem o `data-desenho="2d"` e o meio `perto` de `[255, 1, 0]`.
    - `a size change in the middle letterboxes the new size` (Review Focus 4):
      - um quadro 640×480 `VERMELHO` deixa o ponto a 3 px da borda esquerda da prévia (a prévia é 16:9) `perto` do `FUNDO`;
      - depois, um 1280×720 `BRANCO` deixa o mesmo ponto `perto` de `[255, 255, 255]`.
    - `leaving Configurações by any way stops the camera test` (Review Focus 3). Com o teste ligado, cada um destes manda `{cmd: 'cameraTest', on: false}` (conte pelo `vezes`):
      - o Voltar;
      - uma ligação que chega (o `mudarEstado` com a `ligacao` do cenário `aviso`);
      - o Ctrl + 1.
    - `the H.264 switch shows the Cisco notice and follows the person's choice`:
      - a chave `H.264 da Cisco` está ligada (`aria-checked="true"`), descrita por `OpenH264 Video Codec provided by Cisco Systems, Inc.`;
      - o clique manda `{cmd: 'setVideo', h264: false}`, e a chave desliga.
    - `the H.264 switch stays while the person turned video off, and goes with the admin card`:
      - com `ligado: false` e `h264: {cartao: true, pessoa: false}`, a chave aparece, o campo Câmera some e o título continua `Áudio e vídeo`;
      - com `cartao: false`, o título é `Áudio`, e não há chave nem campo Câmera.
    - `a buffer with wrong data is released and never drawn`:
      - o `memoriaCrua` com `bytes: 100` e o com a `vista: 'outra'` sobem o `liberadas()` para 2;
      - o teste da câmera com um quadro `VERMELHO` continua desenhando certo.
    - `on the iPhone the settings have no video`: no `?fake=configuracoes&plataforma=ios`, não há o campo `Câmera`, nem o `Testar a câmera`, nem o `H.264 da Cisco`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/desenho.spec.ts tests/video/configuracoes.spec.ts` falha: o módulo `desenho` não existe, e as Configurações não têm o campo Câmera.
- [ ] **Step 3: Implemente.**
  - **O `desenho.ts`:**
    - O WebGL usa três texturas `LUMINANCE`, com o `UNPACK_ALIGNMENT` 1 e o `texSubImage2D` enquanto o tamanho não muda.
    - O shader faz a conversão BT.601 de faixa limitada: `R = 1.164(Y−16) + 1.596(V−128)`; `G = 1.164(Y−16) − 0.392(U−128) − 0.813(V−128)`; `B = 1.164(Y−16) + 2.017(U−128)`. O `i420ParaRgb` faz a mesma conta, com o `Math.round` e o corte em 0 e 255.
    - O `viewport` é o retângulo do `encaixar`, em pixels do canvas, e o `clearColor` é o `COR_DO_FUNDO`.
    - Sem o WebGL, o 2D converte para um `ImageData` do tamanho do quadro, num canvas de fora da tela, e desenha encaixado.
  - **O `VistaDeVideo`:**
    - O canvas tem o tamanho da caixa vezes o `devicePixelRatio`, pelo `ResizeObserver`, e desenha de novo o último quadro quando o tamanho muda.
    - Ele lê pelo `requestAnimationFrame`. Quando monta, ou quando a memória troca, o `visto` começa no `seqDe` da memória (o contrato da página).
    - Com o `desenhar` desligado, ele limpa com o fundo e não lê.
    - Ele chama o `mostrar(vista)` ao montar e o tirar ao desmontar.
    - O `espelhar` é um `transform: scaleX(-1)` no canvas: a sua imagem aparece como num espelho.
  - **O `main.tsx`** cria o `criarVideoDaPagina(bridge, 'principal')` no módulo, como o `chatCliente`, e envolve o `<App />` no `VideoContexto.Provider`.
  - **O `ConfigDoVideo`** fica no cartão do Áudio de hoje, que só existe no Windows. O título do cartão é `Áudio e vídeo` com o `video.ligado` ou o `video.h264.cartao`, e `Áudio` sem os dois. Ele segue os quadros `Configuracoes` e `ConfiguracoesEscuro`:
    - a linha `Câmera`, depois do Toque, com o `Select`, só com o `video.ligado`. As opções são as `video.cameras`, e mais a escolhida desconectada, com `(desconectada)`. O valor é `video.camera`, ou a primeira câmera. Sem câmeras, o campo fica desativado, com a opção única `Nenhuma câmera encontrada.`;
    - o `Testar a câmera`, só com o `video.ligado`: um botão outline pequeno, com o `IconVideo`. Com o `video.teste`, a prévia 16:9 na largura do cartão (raio 12), com o `Parar o teste` (`IconStop`) embaixo;
    - a linha `H.264 da Cisco`, só com o `video.h264.cartao`, com o `AVISO_DA_CISCO` embaixo e a chave (`role="switch"`, como as de hoje), ligada com o `video.h264.pessoa`.
  - O teste para ao desmontar o `ConfigDoVideo`, com o `video.teste` ligado.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos passam, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a vista de vídeo e o Áudio e vídeo das Configurações`. O CI fica verde.

### Task 3: O Ligar com vídeo

**Files:**
- Modify: `windows/ui/src/screens/Teclado.tsx`, `windows/ui/src/screens/Contatos.tsx`, `windows/ui/src/screens/Recentes.tsx`, `windows/ui/src/chat/telas/Conversa.tsx`, `windows/ui/src/main.tsx` (o `comVideo` para as telas), `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/ligar.spec.ts`, `windows/ui/tests/chat/ligar-com-video.spec.ts`

**Interfaces:**
- Consumes (Tasks 1 e 2): o `videoDoApp`, o `textos.ts` e o `IconVideo`.
- Produces: as quatro telas ganham uma prop `video: boolean` (`videoDoApp(state).ligado`), que o `main.tsx` passa. O `Conversa` ganha o `video` pelo mesmo caminho.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `ligar.spec.ts`:
    - `the keypad has Ligar com vídeo next to Ligar`:
      - com `2003` digitado, o `Ligar com vídeo` manda `{cmd: 'dial', numero: '2003', video: true}`;
      - o `Ligar` manda `{cmd: 'dial', numero: '2003'}` exatamente uma vez (o `vezes`), sem o campo `video`.
    - `a name typed on the keypad calls the first suggestion with video`: `carl` e o `Ligar com vídeo` mandam `{cmd: 'dial', numero: '2007', contato: true, video: true}`.
    - `each contact has Ligar com vídeo before Ligar`: o `Ligar com vídeo para Atendimento Starsonic` manda `{cmd: 'dial', numero: '(11) 5060-3000', contato: true, video: true}`. No `?fake=contatos-empresa`, a primeira linha da empresa (do `PLANILHA_DA_EMPRESA`) também tem o botão, com o `contato: true`.
    - `the open recent call has Ligar com vídeo`: na primeira linha dos Recentes aberta, o `Ligar com vídeo` manda `{cmd: 'dial', numero: '2003', video: true}`.
    - `without video the buttons are not there`: no `?fake=sem-video`, e no `?fake=principal&plataforma=ios`, não há nenhum botão com o nome que começa com `Ligar com vídeo` no Teclado, nos Contatos e nos Recentes.
    - `the video buttons fit the three sizes`. Em 400×720, 360×600 e 300×440:
      - o Rediscar, o `Ligar com vídeo` e o `Ligar` do Teclado ficam inteiros na janela;
      - com um contato `Coordenação de Logística e Transportes` (pelo `mudarEstado`, como no `screens.spec.ts`), os três botões da linha dele ficam inteiros na largura da tela.
  - No `tests/chat/ligar-com-video.spec.ts` (o servidor do chat, como o `conversa.spec.ts`):
    - `the conversation has Ligar com vídeo next to Ligar`: na conversa com a Ana, o `Ligar com vídeo para Ana Souza, ramal 2003` manda `{cmd: 'dial', numero: '2003', contato: true, video: true}`. Com a Ana fora do chat (o `tirarPessoa`), os dois botões somem.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/ligar.spec.ts tests/chat/ligar-com-video.spec.ts` falha: não há o `Ligar com vídeo`.
- [ ] **Step 3: Implemente, como nos quadros `Main`, `Contatos`, `Recentes`, `Conversa`, `TecladoCompacto`, `TecladoMinimo` e `ContatosMinimo`.**
  - **O Teclado:** a linha fica `[Rediscar] [Ligar com vídeo] [Ligar]`.
    - O botão de vídeo é redondo, com contorno e o `IconVideo`, do tamanho do Rediscar: 56 no Normal, 46 no Compacto e 42 no Mínimo.
    - O `ligar(video)` é o de hoje, com o `video: true` só quando vem do botão novo. Ele fica desativado nas mesmas condições do Ligar, com o `semSegundoClique`.
  - **Os Contatos** (os meus e os da empresa): a linha fica `[vídeo] [ligar] [mais]`, com o `aria-label` `Ligar com vídeo para <nome>`. No Mínimo, as linhas com o vídeo usam os botões de 34 e o espaço de 8.
  - **Os Recentes:** a linha aberta fica `[Ligar] [Ligar com vídeo] [Salvar contato]`. O botão novo é outline e pequeno.
  - **A conversa:** o botão de vídeo vem antes do Ligar, outline, com 40.
  - Nenhum deles aparece sem o `video`.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o Ligar com vídeo no Teclado, nos Contatos, nos Recentes e no chat`. O CI fica verde.

### Task 4: A ligação com vídeo

**Files:**
- Create: `windows/ui/src/screens/tempoDaLigacao.ts`, `windows/ui/src/video/CaixaDoVideo.tsx`
- Modify: `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/main.tsx` (os avisos de 5 s), `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/ligacao.spec.ts`

**Interfaces:**
- Consumes (Tasks 1 a 3): o `videoDe`, o `videoDoApp`, o `VistaDeVideo`, o `textos.ts` e os ícones.
- Produces:
  ```ts
  // tempoDaLigacao.ts: os dois que saem do Ligacao.tsx sem mudar
  export function useNow(): number;
  export function statusLine(card: CallCard, now: number): string;
  // CaixaDoVideo.tsx
  export function CaixaDoVideo(props: { state: AppState; card: CallCard; now: number; send: Send }): VNode;   // a área e o quem
  export function SuaImagemFlutuante(): VNode;   // a sua imagem fora da área do vídeo
  // Ligacao.tsx
  export function CartaoDaOutra(props: { state: AppState; ligacao: CallState; send: Send; now: number }): VNode | null;
  ```
  - O `CartaoDaOutra` é o bloco `alto` de hoje (a segunda que toca, ou a outra em espera), sem mudar o desenho. A Task 6 e a Task 7 também o usam.
  - O `Ctrl` ganha o `aceso?: boolean`: só a classe `ctrl-on`, sem o `aria-pressed`.
  - O `video/estado.ts` ganha a regra da Câmera, que a Task 7 e a Task 8 também usam:
    ```ts
    // A câmera desligada só liga numa ligação atendida (activeSinceMs > 0) e fora da espera; ligada, ela sempre desliga.
    export function cameraDesativada(card: CallCard, video: CallVideo): boolean;
    ```

- [ ] **Step 1: Escreva os testes que falham.** No `ligacao.spec.ts`:
  - `the video call shows the other side big, your image in the corner and Abrir grande` (`?fake=video`):
    - aparecem a vista `Vídeo de Ana Souza` e, dentro do retângulo dela, a `Sua imagem`;
    - sai `{cmd: 'videoViews', pagina: 'principal', vistas: ['local', 'remoto']}`;
    - o `quadro(page, 'remoto', VERMELHO)` deixa o meio da vista `perto` de `[255, 1, 0]`;
    - aparecem `Ana Souza` e um texto como `/^Ramal 2003 · 03:1\d$/`;
    - o `Abrir grande` manda `{cmd: 'videoWindow', modo: 'grande'}`.
  - `the Câmera button turns your camera off and on`:
    - o controle com o rótulo `Câmera` tem o nome `Desligar a câmera` e manda `{cmd: 'camera', on: false}`;
    - depois, o nome é `Ligar a câmera`, e o clique manda `{cmd: 'camera', on: true}`.
  - `the Câmera button waits for the call to be answered, but can always turn the camera off` (pelo `mudarEstado`):
    - chamando, com a câmera desligada, o `Ligar a câmera` fica desativado;
    - chamando, com a câmera ligada, o `Desligar a câmera` fica ativo;
    - na espera, com a câmera desligada, ele fica desativado.
  - `a voice call keeps today's screen, with your image when the camera is on`:
    - no `?fake=video-voz-camera`, não há o `Vídeo de Ana Souza`. Há o avatar e o nome de hoje, e a `Sua imagem` no canto de cima à direita da tela da ligação;
    - no `?fake=ligacao`, não há a `Sua imagem`, e há o `Ligar a câmera`.
  - `with two calls there is no video and no Câmera`: no `?fake=duas-ligacoes` e no `?fake=conferencia`, não há o controle `Câmera`.
  - `the remote view never shows a frame of the previous call` (Review Focus 1):
    - no `?fake=video`, grave um quadro `VERMELHO` no `remoto`;
    - pelo `mudarEstado`, a de cima vira o Carlos (id 12, ativo), com `{ativo: true, imagem: false}`: a área do vídeo some;
    - com o `imagem: true`, a área volta, e o meio dela fica `perto` do `FUNDO`, mesmo com o vermelho ainda na memória;
    - um quadro `BRANCO` deixa o meio `perto` de `[255, 255, 255]`.
  - `your image stays in sight with every panel` (Review Focus 2): no `?fake=video`, com o Teclado, o Transferir, a Nova ligação e os Atalhos abertos, um de cada vez, a `Sua imagem` fica visível e inteira dentro da janela.
  - `the video problem notices stay 5 seconds, the others 2`. Com o `page.clock`, cada um dos `AVISOS_DE_5_S` empurrado como `toast` está na tela em +4,5 s e saiu em +5,5 s. O `Ocupado` saiu em +2,5 s.
  - `resizing the window keeps the video fitted` (Review Focus 4): no `?fake=video` com um quadro 640×480, depois do `setViewportSize` de 400×720 para 300×440:
    - o canvas do `remoto` tem a largura e a altura da caixa (o `devicePixelRatio` é 1);
    - o meio dele continua com a cor do quadro;
    - os controles e o Desligar ficam inteiros na janela.
  - `the video screen fits the three sizes`: em 400×720, 360×600 e 300×440, a página não rola (o `scrollHeight` não passa do `innerHeight`), e todo controle fica inteiro na janela. No 300×440, o quem é uma linha só (`/^Ana Souza · 03:1\d$/`).
  - `the second call ringing pauses the video layout`: no `?fake=video`, com a segunda tocando (o `mudarEstado`), a área do vídeo sai e o cartão `Ligação de Carlos Lima` aparece.
  - `on the iPhone a call never shows video`: no `?fake=video&plataforma=ios`, não há o `Vídeo de`, nem a `Sua imagem`, nem o controle `Câmera`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/ligacao.spec.ts` falha: não há a área do vídeo nem a Câmera.
- [ ] **Step 3: Implemente, como nos quadros `Video`, `VideoCompacto`, `VideoMinimo`, `VozComCamera` e `Avisos`.**
  - **O desenho com vídeo** vale numa ligação só (sem a segunda e sem a conferência), sem painel aberto e com o `video.imagem` da de cima.
    - Ele troca o `quem` pela `CaixaDoVideo`.
    - A área do vídeo é o `VistaDeVideo` do `remoto`, com o `key` do id da ligação.
    - A sua imagem fica dentro da área, embaixo à direita.
    - O `Abrir grande` fica em cima à direita. Ele é irmão das vistas, nunca filho de um `role="img"`.
  - **Os tamanhos** (o resto, como hoje):

    | | Normal | Compacto | Mínimo |
    | --- | --- | --- | --- |
    | `.call-body` (padding, gap) | 16 22 22, 12 | 14 16 16, 10 | 10 12 12, 8 |
    | Área do vídeo | flex 1, raio 18, borda 1px rgba(255,255,255,.1), fundo #04060e | igual | raio 14 |
    | Sua imagem (na área) | 96×72, a 10 da borda, raio 10, borda 1,5px rgba(255,255,255,.55) | 80×60 | 64×48, a 8, raio 8 |
    | Abrir grande | altura 32, a 10, fundo rgba(7,11,24,.62), 700 12,5px | igual | altura 28 |
    | Quem | nome 20/800; `Ramal 2003 · 03:12` em 13px, o tempo ciano 700 | nome 18 | uma linha, `Ana Souza · 03:12` |
    | Controles | 5 colunas, gap 12px 6px, círculo 54, rótulo 600 12px | gap 10px 4px, círculo 46, rótulo 11px | gap 8px 4px, círculo 40, rótulo 11px |
    | Desligar | 66 | 60 | 54 |

  - **A sua imagem flutuante:** fora do desenho com vídeo, com o `video.camera` da de cima, o `SuaImagemFlutuante` fica a 16 do canto de cima à direita da tela da ligação. Ela tem 96×72 (80×60 no Compacto e 64×48 no Mínimo), e fica também com um painel aberto.
  - **Os controles de uma ligação,** com o vídeo ligado: Mudo, Câmera, Teclado, Áudio, Espera, Transferir, Nova ligação e Atalhos. A Task 8 põe o Chat depois da Câmera. Sem o `video.ligado`, eles são os de hoje.
    - Com 9 controles, a grade é a `ctrls-5`; com 8, a `ctrls-4` de hoje.
    - A Câmera tem o rótulo `Câmera`, o nome `Ligar a câmera` ou `Desligar a câmera`, o `IconVideoOff` ou o `IconVideo`, e o `aceso` com a câmera ligada.
    - Ela fica desativada pelo `cameraDesativada`, e o clique manda `{cmd: 'camera', on: !video.camera}`.
  - **Os avisos de 5 s:** o toast fica 5000 ms quando o texto está no `AVISOS_DE_5_S`, e os `TOAST_MS` de hoje nos outros.
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a tela da ligação com vídeo e a Câmera`. O CI fica verde.

### Task 5: A altura do aviso no núcleo e no executável

**Files:**
- Modify: `starsonic/desktop/Protocol.h`, `starsonic/desktop/Protocol.cpp`, `starsonic/desktop/DesktopApp.h`, `starsonic/desktop/DesktopApp.cpp` (ou o `DesktopAppVideo.cpp`)
- Modify: `windows/app/src/WindowFit.h`, `windows/app/src/WindowFit.cpp`, `windows/app/src/NoticeWindow.h`, `windows/app/src/NoticeWindow.cpp`, `windows/app/src/MainWindow.h`, `windows/app/src/MainWindow.cpp`, `windows/app/src/main.cpp`
- Modify: `tests/desktop/desktop_fixture.h`, `tests/desktop/test_protocol.cpp`, `tests/desktop/test_desktop_video.cpp`, `tests/desktop/test_window_fit.cpp`
- Modify: `docs/ponte-windows.md`

**Interfaces:**
- Produces:
  ```cpp
  // Protocol: CommandKind::NoticeHeight, "noticeHeight", CommandPlatform::Windows; Command ganha `int noticeHeight = 0;`
  constexpr int kMinNoticeHeight = 168;   // pixels logicos
  constexpr int kMaxNoticeHeight = 480;
  // DesktopHooks
  std::function<void(int height)> noticeHeight;
  // WindowFit
  constexpr int kNoticeWidth = 380;   // pixels logicos
  constexpr int kNoticeHeight = 168;
  constexpr int kNoticeMargin = 12;
  FitBox NoticeBox(const FitArea& work, unsigned dpi, int logicalHeight);
  // NoticeWindow
  void SetHeight(int logicalHeight);
  // MainWindow
  void SetNoticeHeight(int logicalHeight);
  ```
- Consumed by: a Task 6, que manda o `noticeHeight` da página do aviso.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `test_protocol.cpp`, `noticeHeight takes a whole height between 168 and 480`:
    - `{"v":1,"cmd":"noticeHeight","altura":222}` dá o `NoticeHeight` com 222;
    - são recusados: sem a `altura`, 167, 481, `"222"` e `222.5`.
  - No `test_desktop_video.cpp`:
    - `noticeHeight from the notice page goes to the hook`: o `SendFromNotice` com 430 dá o `noticeHeights == {430}`;
    - `noticeHeight from the main page is ignored`: o `Send` com 430 não chama o gancho, e o diagnóstico tem `noticeHeight recusado: pagina principal`;
    - `noticeHeight is refused on the iPhone`, como os outros pedidos só do PC.
  - No `test_window_fit.cpp`, numa área de trabalho `{0, 0, 1920, 1040}`:
    - `the notice box is 380 wide at the bottom right`: em 96 dpi, com 168, dá `{1528, 860, 380, 168}`, e com 430, `{1528, 598, 380, 430}`;
    - `the notice box follows the scale`: em 144 dpi, com 430, dá `{1332, 377, 570, 645}`;
    - `the notice box is on its own monitor`: em `{1920, 0, 3840, 1040}`, 96 dpi, com 222, dá `{3448, 806, 380, 222}`;
    - `a short work area cuts the notice height`: em `{0, 0, 800, 400}`, 96 dpi, com 430, dá `{408, 12, 380, 376}`.
- [ ] **Step 2: Rode e veja falhar.** A compilação do `tests/desktop` falha sem o `NoticeBox` e o `NoticeHeight`.
- [ ] **Step 3: Implemente.**
  - O `Protocol` lê a `altura` pelo `f.Whole("altura", kMaxNoticeHeight, ...)` e recusa abaixo de 168 com `altura invalida`.
  - O `DesktopApp` só chama o gancho com o comando da página do aviso (o `noticePage` do `HandleCommand`). Da principal, ele só escreve a linha no diagnóstico.
  - O `NoticeBox` usa o `ScaleToDpi` na largura, na altura e na margem, corta a altura na área de trabalho menos duas margens e encosta embaixo à direita.
  - O `NoticeWindow`:
    - guarda a altura (168 de fábrica);
    - o `Show` usa o `NoticeBox`;
    - o `SetHeight`, com o aviso à vista, refaz a posição no monitor onde ele está, pelo `MonitorFromWindow` da janela do aviso.
  - O `main.cpp` liga o gancho como o `videoWindow`: `window.RunOnWindow([&window, h] { window.SetNoticeHeight(h); })`.
  - O `docs/ponte-windows.md` ganha a linha do `noticeHeight` na tabela do "Vídeo (0.3.0)" e o gancho na lista do executável. O comentário dos 380×168 do `NoticeWindow.h` passa a dizer que a altura muda.
- [ ] **Step 4: Rode e veja passar.** `build-desktop/desktop_tests` passa inteiro. A compilação do Windows fica para o CI.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a altura do aviso pedida pela página (noticeHeight)`. O CI fica verde, com a compilação do Windows.

### Task 6: O Atender com vídeo e o porteiro

**Files:**
- Create: `windows/ui/src/video/alturaDoAviso.ts`
- Modify: `windows/ui/src/screens/Ligacao.tsx` (a ligação que toca e o `CartaoDaOutra`), `windows/ui/src/aviso.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/atender.spec.ts`, `windows/ui/tests/video/aviso.spec.ts`

**Interfaces:**
- Consumes (Tasks 1, 2, 4 e 5): o `videoDe`, o `VistaDeVideo`, o `criarVideoDaPagina`, o `CartaoDaOutra` e o `noticeHeight`.
- Produces:
  ```ts
  export const ALTURA_DO_AVISO = { voz: 168, video: 222, porteiro: 430 } as const;
  // sem cartão: 168; o cedo: 430; o oferece, com o video.ligado: 222; os outros: 168
  export function alturaDoAviso(state: AppState, card: CallCard | null): number;
  ```
  As três alturas são as do CSS de hoje: o aviso de voz tem 150 px de conteúdo na janela de 168. A segunda linha soma 10 + 44, e a imagem 194 + 14.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `atender.spec.ts`:
    - `a call that offers video can be answered with or without your camera` (`?fake=video-tocando`):
      - aparecem os três botões redondos: `Recusar`, `Atender` e `Atender com vídeo`;
      - o `Atender` manda `{cmd: 'answer'}` exatamente uma vez, sem o `video`;
      - numa página nova, o `Atender com vídeo` manda `{cmd: 'answer', video: true}`.
    - `a call without the video offer keeps two buttons`: no `?fake=tocando-antes-de-carregar`, não há o `Atender com vídeo`.
    - `the second call ringing with video has Atender com vídeo in its card`: no `?fake=ligacao-segunda`, com o `second.video.oferece` (o `mudarEstado`), o cartão `Ligação de Carlos Lima` tem o `Atender com vídeo`, que manda `{cmd: 'answer', video: true}`.
    - `the doorphone shows its image before answering, without your camera` (`?fake=video-porteiro`):
      - aparece a vista `Vídeo de Portaria`, e sai `{cmd: 'videoViews', pagina: 'principal', vistas: ['remoto']}`;
      - um quadro `VERMELHO` aparece nela;
      - não há a `Sua imagem`.
    - `the doorphone ringing screen fits the three sizes`: no `?fake=video-porteiro`, em 400×720, 360×600 e 300×440, a imagem e os três botões redondos ficam inteiros na janela, e a página não rola.
    - `on the iPhone there is no Atender com vídeo`: `?fake=video-tocando&plataforma=ios`.
  - No `aviso.spec.ts` (`aviso.html`):
    - `the notice offers Atender com vídeo and asks for its height` (`?fake=video-tocando`): o `Atender com vídeo` manda `{cmd: 'answer', video: true}`, e sai `{cmd: 'noticeHeight', altura: 222}`.
    - `a voice notice keeps 168`: no `?fake=aviso`, sai `{cmd: 'noticeHeight', altura: 168}`, e não há o `Atender com vídeo`.
    - `the doorphone notice shows the image and grows to 430` (`?fake=video-porteiro`):
      - aparece a vista `Vídeo de Portaria`, e saem `{cmd: 'videoViews', pagina: 'aviso', vistas: ['porteiro']}` e `{cmd: 'noticeHeight', altura: 430}`;
      - o `quadro(page, 'porteiro', VERMELHO)` aparece nela;
      - com o `cedo: false` (o `mudarEstado`), a imagem sai, e saem `vistas: []` e `{cmd: 'noticeHeight', altura: 222}`.
    - `each notice height fits its content`. Em 380 × cada altura da `ALTURA_DO_AVISO`, com o cenário dela:
      - o `scrollHeight` do `.aviso` não passa da altura;
      - entre o fim do `.aviso-quem` e o começo do `.aviso-botoes` ficam 32 px (± 1): os 14 do gap e os 18 de folga de hoje.
    - `the empty notice goes back to 168`: no `?fake=video-porteiro`, depois do `Recusar` (o estado sem ninguém tocando), o último `noticeHeight` é 168.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/atender.spec.ts tests/video/aviso.spec.ts` falha: não há o `Atender com vídeo`, a imagem do porteiro nem o `noticeHeight`.
- [ ] **Step 3: Implemente, como nos quadros `Aviso`, `AvisoPorteiro`, `Tocando` e `TocandoPorteiro`.**
  - **A tela do app tocando:** três ações redondas de 66, em três colunas com o espaço 12: Recusar (vermelho), Atender (ciano) e Atender com vídeo.
    - O Atender com vídeo tem a borda de 2px ciano, o fundo rgba(0,194,203,.09) e o `IconVideo`.
    - O `RoundAction` ganha o tipo `video`.
    - O Atender com vídeo só aparece com o `video.ligado` e o `oferece` da que toca.
  - **O porteiro (`cedo`) no app:**
    - em cima fica a área 4:3, na largura da tela, com o `VistaDeVideo` do `remoto` (o `key` do id e o `desenhar` do `cedo`);
    - ela tem 267 de altura no Normal e encolhe nos tamanhos menores (`flex: 1` e `min-height: 0`), para os três botões caberem inteiros;
    - o quem fica sem o avatar.
  - **O `CartaoDaOutra`** da segunda tocando com o `oferece` ganha um terceiro `round-sm`, o `Atender com vídeo`.
  - **O `aviso.tsx`:**
    - ele cria o `criarVideoDaPagina(bridge, 'aviso')` com o provedor;
    - o porteiro fica primeiro, 344×194, raio 12, com o `VistaDeVideo` do `porteiro` (o `key` do id da que toca e o `desenhar` do `cedo`);
    - o `Atender com vídeo` é a segunda linha da grade, na largura toda: 44 de altura, 700 15px, a borda de 1,5px ciano, o fundo rgba(0,194,203,.09), o texto branco e o ícone ciano;
    - o `noticeHeight` sai no primeiro desenho e a cada vez que o `alturaDoAviso` muda;
    - o comentário do topo deixa de dizer 380×168.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o Atender com vídeo e a imagem do porteiro, no aviso e no app`. O CI fica verde.

### Task 7: O grande e a tela cheia

**Files:**
- Create: `windows/ui/src/video/Grande.tsx`
- Modify: `windows/ui/src/main.tsx`, `windows/ui/src/components/TitleBar.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/grande.spec.ts`

**Interfaces:**
- Consumes (Tasks 2 e 4): o `VistaDeVideo`, o `CartaoDaOutra`, o `useNow`, o `statusLine` e o `cameraDesativada`.
- Produces:
  ```ts
  export interface ChatDoGrande { aberto: boolean; alternar(): void; painel: ComponentChildren }
  export function Grande(props: { state: AppState; ligacao: CallState; send: Send; chat?: ChatDoGrande | null }): VNode;
  // TitleBar ganha `semRedimensionar?: boolean` (sem as ResizeZones)
  ```
  A Task 8 passa o `chat`.

- [ ] **Step 1: Escreva os testes que falham.** No `grande.spec.ts`, com a janela de 1280×800:
  - `the big window shows only the video, your image and the bottom bar` (`?fake=video-grande`):
    - a barra de título (o `Minimizar`) está lá, sem as zonas de redimensionar;
    - a vista `Vídeo de Ana Souza` tem a largura da janela;
    - aparece a etiqueta `/^Ana Souza · Ramal 2003 · 03:1\d$/`;
    - a `Sua imagem` tem 224×168 e fica a 24 da direita e a 128 de baixo (± 1);
    - a barra de baixo tem, nesta ordem, `Mudo`, `Desligar a câmera`, `Tela cheia`, `Diminuir` e `Desligar` (o Chat só com um colega no chat, a Task 8).
  - `Diminuir and Tela cheia ask the window`:
    - o `Diminuir` manda `{cmd: 'videoWindow', modo: 'normal'}`;
    - o `Tela cheia` manda `{cmd: 'videoWindow', modo: 'telaCheia'}`;
    - na tela cheia, não há barra de título, e o `Sair da tela cheia` manda `{cmd: 'videoWindow', modo: 'grande'}`.
  - `double click on the video goes in and out of the full screen, and Esc goes out`:
    - o duplo clique na vista manda o `telaCheia` (no grande) e o `grande` (na tela cheia);
    - o Esc na tela cheia manda o `grande`.
  - `Abrir grande opens the big window`: no `?fake=video`, o `Abrir grande` e o `setViewportSize(1280, 800)` mostram o grande.
  - `the call screen comes back when the call ends`: o `Desligar` acaba a ligação na ponte falsa, e o Teclado volta.
  - `a second call in the big window shows its card`: com a segunda tocando (o `mudarEstado`), o cartão `Ligação de Carlos Lima` fica em cima, no meio, com o `Recusar` e o `Atender`.
  - `the big window always shows your image with the camera on` (Review Focus 2): com `{imagem: false, camera: true}`, a `Sua imagem` continua visível.
  - `the full screen keeps the sizes of the board`: em 1920×1080, na tela cheia, a `Sua imagem` tem 288×216 e fica a 32 da direita e a 156 de baixo, e os círculos dos botões têm 60.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/grande.spec.ts` falha: com a `janela` em `grande`, a tela ainda é a da ligação.
- [ ] **Step 3: Implemente, como nos quadros `Grande` e `TelaCheia`.**
  - O `main.tsx` mostra o `Grande` no lugar da tela da ligação com a ligação, no Windows, e o `video.janela` diferente de `normal`.
    - No grande, a barra de título é a da ligação, com o `semRedimensionar`. Na tela cheia, não há barra.
    - Os toasts continuam.
  - **A área do vídeo:**
    - ela ocupa o resto da janela, encaixada;
    - a etiqueta fica em top 40 e left 24 (top 24 e left 24 na tela cheia), com 40 de altura;
    - embaixo fica uma sombra de 220px.
  - **A sua imagem:** 224×168 a 24 e 128 no grande; 288×216 a 32 e 156 na tela cheia.
  - **A barra de baixo:**
    - no grande: a 22 de baixo, itens de 92 com o espaço 12, círculos de 56 com o fundo rgba(255,255,255,.1) e a borda rgba(255,255,255,.18), e rótulos de 12px;
    - na tela cheia: a 32 de baixo, itens de 112, círculos de 60 e rótulos de 13px;
    - os botões: Mudo, Câmera, Chat, Tela cheia ou Sair da tela cheia (`IconFullscreen` e `IconExitFullscreen`), Diminuir (`IconShrink`) e Desligar (vermelho).
  - O duplo clique na vista alterna o grande e a tela cheia, e o Esc só vale na tela cheia.
  - O `CartaoDaOutra` fica flutuando em cima, no meio.
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o grande e a tela cheia`. O CI fica verde.

### Task 8: O chat na ligação

**Files:**
- Create: `windows/ui/src/video/chatDaLigacao.ts`, `windows/ui/src/video/FaixaDaLigacao.tsx`
- Modify: `windows/ui/src/main.tsx`, `windows/ui/src/screens/Ligacao.tsx`, `windows/ui/src/video/Grande.tsx`, `windows/ui/src/chat/telas/Conversa.tsx`, `windows/ui/src/app.css`
- Create: `windows/ui/tests/chat/ligacao.spec.ts`

**Interfaces:**
- Consumes (Tasks 4 e 7, e o chat da 0.2.0): o `ChatCliente` (`colegas()`, `criarDupla(com)`), o `useVistaChat`, o `useAcao`, o `digitsOnly` do `format.ts`, o `Grande` com o `chat` e o `CartaoDaOutra`.
- Produces:
  ```ts
  export function useColegaDaLigacao(cliente: ChatCliente, vista: VistaChat, state: AppState): Pessoa | null;
  export function FaixaDaLigacao(props: { state: AppState; ligacao: CallState; send: Send; onVoltar(): void }): VNode;
  // Ligacao ganha `chat?: { abrir(): void } | null`; Conversa ganha `naLigacao?: boolean`
  ```
  - O `useColegaDaLigacao` dá `null` fora da situação `pronto`, no iPhone e sem ligação.
  - Senão, ele procura primeiro uma dupla da lista (`vista.conversas`) com o `com.ramal` de mesmos dígitos do número da ligação de cima e o `com.saiu` falso.
  - Sem ela, ele chama o `cliente.colegas()` uma vez por ligação (o id da de cima) e procura do mesmo jeito.
  - Uma falha dá `null`, sem aviso.

- [ ] **Step 1: Escreva os testes que falham.** No `tests/chat/ligacao.spec.ts`, com o servidor do chat:
  - Preparação: uma empresa com a Recepção (2001) e a Ana (2003), como no `conversa.spec.ts`, e o app aberto pelo `abrirNoChat`. A ligação chega pelo `mudarEstado`, com a Ana (número `2003`), atendida.
  - `the Chat button opens the conversation with the colleague under the call strip`:
    - o controle `Chat` abre a conversa com a Ana;
    - em cima fica a faixa, com `/^Em ligação · 00:\d\d$/`, o `Voltar para a ligação` e os botões Mudo, `Desligar a câmera` e Desligar;
    - o alto da conversa não tem o `Ligar para Ana Souza, ramal 2003` nem o `Ligar com vídeo para Ana Souza, ramal 2003`;
    - o Voltar da conversa (`Voltar para a ligação`) volta para a tela da ligação, e o servidor tem uma dupla só.
  - `a message goes in the conversation during the call`: um texto com Enter chega ao servidor (pela `ApiDeTeste` da Ana).
  - `the call strip shows your image with the camera on` (Review Focus 2):
    - com `{imagem: true, camera: true}`, a faixa tem a vista `Vídeo de Ana Souza` (64×48) e a `Sua imagem` dentro dela;
    - com `{imagem: false, camera: true}`, a faixa tem só a `Sua imagem`.
  - `a voice call also has the Chat button, and the strip shows the name and the time`: sem vídeo, aparece o `Chat`, e a faixa mostra `/^Ana Souza · 00:\d\d$/`.
  - `no Chat button for a number outside the chat or a colleague who left`: numa ligação com o `1050`, não há o `Chat`. Com a Ana fora (o `tirarPessoa`), também não.
  - `the Chat button stays away while the chat is not ready or the lookup fails, without a toast` (Review Focus 5):
    - no `cenario: 'chat-desligado'`, a ligação com o 2003 não tem o `Chat`;
    - com o chat pronto, sem dupla, e o `page.route` do `**/api/v1/pessoas` abortado, também não;
    - nos dois, nenhum toast aparece, e o `Mudo` manda `{cmd: 'mute', on: true}`.
  - `at the end of the call the conversation stays; from the call screen it goes to the keypad`:
    - com a conversa aberta pela faixa, o `Desligar` da faixa acaba a ligação, e a conversa continua na tela, sem a faixa e com o Voltar `Voltar para as conversas`;
    - sem a conversa aberta, o fim volta para o Teclado.
  - `in the big window the conversation opens at the right, 360 wide`: com a `janela` em `grande` e a janela em 1280×800, o `Chat` (com o `aria-pressed`) abre o painel de 360, e a vista `Vídeo de Ana Souza` fica com 920 (± 1).
- [ ] **Step 2: Rode e veja falhar.** `npm run build && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npx playwright test tests/chat/ligacao.spec.ts` falha: não há o `Chat` na ligação.
- [ ] **Step 3: Implemente, como nos quadros `ConversaNaLigacao`, `ConversaNaLigacaoEscura` e `GrandeChat`.**
  - **O `main.tsx`:**
    - guarda o `chatDaLigacao` (`{conversa, ligacao}`, com o id da de cima). Ele só vale enquanto essa é a de cima;
    - o `Chat` faz o `criarDupla(colega.id)` pelo `useAcao`, com o `avisarNaTela` nas falhas, e abre;
    - na janela normal, com o `chatDaLigacao` e a conversa na lista, a tela é a barra da ligação, a `FaixaDaLigacao` e a `Conversa` com o `naLigacao`;
    - no grande, o `chat` do `Grande`: o painel da conversa, com 360, à direita, no tema do app;
    - no fim da ligação, com a conversa na tela, a vista vira a `chatConversa` dela (o Voltar vai para a aba Chat). Sem ela, o Teclado, como hoje.
  - **O `Ligacao`:** o `Chat` (o `IconMessage`) vem depois da Câmera, nos controles de uma ligação. Com ele, a grade é a `ctrls-5`.
  - **A `FaixaDaLigacao`:**
    - é uma faixa navy-950, com o padding 10 14;
    - a miniatura de 64×48 é o `remoto`, com a sua imagem pequena dentro com a câmera ligada; sem a imagem da outra ponta, é a sua imagem; sem nenhuma das duas, não há miniatura;
    - a coluna tem `Em ligação · <tempo>` (ou `<nome> · <tempo>`) e o link sublinhado `Voltar para a ligação`;
    - os botões são de 36: Mudo, Câmera (as regras da Task 4) e Desligar (o `hangup` com o id).
  - **O `Conversa` com o `naLigacao`:** sem os botões de ligar do alto, e o Voltar com o nome e o título `Voltar para a ligação`.
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o chat durante a ligação`. O CI fica verde.

### Task 9: O cartão Vídeo da área do administrador

**Files:**
- Create: `windows/ui/src/screens/AdminVideo.tsx`
- Modify: `windows/ui/src/screens/Admin.tsx`, `windows/ui/src/main.tsx` (o `video` para a área), `windows/ui/src/app.css`
- Create: `windows/ui/tests/video/admin.spec.ts`

**Interfaces:**
- Consumes (Task 1): o `AdminAberto`, o `VideoSettings`, o `situacaoDoH264`, o `AJUDA_DOS_PORTEIROS` e o `TENTAR_DE_NOVO`.
- Produces:
  ```tsx
  export function CartaoVideo(props: { admin: AdminAberto; video: VideoSettings; send: Send }): VNode;
  ```

- [ ] **Step 1: Escreva os testes que falham.** No `admin.spec.ts`, com a área aberta pelo `entrarNaAdmin`:
  - `the Vídeo card shows the codecs, the first one, the quality and the doorphones`:
    - o título `Vídeo` vem antes do `Atualizações`;
    - as chaves `H.264` e `VP8` estão ligadas, e a `VP9`, desligada;
    - o `Primeiro` está em `H.264`, com as opções `H.264`, `VP8` e `VP9`;
    - a `Média` está marcada no grupo `Qualidade`;
    - o campo `Porteiros` está vazio e é descrito pela ajuda;
    - a situação é `H.264 da Cisco: instalado`.
  - `each change goes to the core`: a `VP9` manda `{cmd: 'adminSet', videoVp9: true}`, o `Primeiro` em `VP8` manda `{cmd: 'adminSet', videoPrimeiro: 'vp8'}`, e a `Alta` manda `{cmd: 'adminSet', videoQualidade: 'alta'}`.
  - `the doorphones go on blur or Enter, once per value`:
    - `1050, 1051` e o Tab mandam `{cmd: 'adminSet', porteiros: ['1050', '1051']}` uma vez;
    - outro Tab, ou o Enter com o mesmo texto, não mandam de novo;
    - o campo vazio manda `porteiros: []`.
  - `a doorphone list the core refuses shows the reason`: `10a` mostra `Cada porteiro só pode ter dígitos.`, e `1050, 1050` mostra `Esse porteiro já está na lista.`.
  - `the H.264 status follows the download, with Tentar de novo after a failure` (pelo `mudarEstado`):
    - `baixando` mostra `H.264 da Cisco: baixando…`;
    - `falhou` mostra `H.264 da Cisco: não foi possível baixar` e o `Tentar de novo`, que manda `{cmd: 'h264Retry'}`;
    - `desligado` não mostra a linha.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/admin.spec.ts` falha: a área não tem o cartão Vídeo.
- [ ] **Step 3: Implemente, como nos quadros `AdmVideo` e `AdmVideoEscuro`, e no lembrete do quadro sobre o `baixando…`.**
  - O cartão fica antes do `Atualizações`.
  - As três chaves são como as de hoje.
  - O `Primeiro` usa o `Select`.
  - A `Qualidade` é o `.seg` de três (`.seg-3`). A marcada é azul (`#0c2671`) no claro e ciano no escuro.
  - O `Porteiros` segue o `CodigoPuxar`: manda no blur e no Enter, uma vez por valor, separando por vírgula, sem os espaços das pontas e sem os itens vazios.
  - A situação é um `role="status"`: o `IconCheck` no `instalado`, e o triângulo de aviso em `#ffb703` no `falhou`, com o `Tentar de novo` (outline, com o `IconRedial`).
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): o cartão Vídeo da área do administrador`. O CI fica verde.

### Task 10: A tela de Licenças e o download do H.264

**Files:**
- Create: `starsonic/third_party/libvpx/LICENSE`, `PATENTS` e `README.md`; `starsonic/third_party/libyuv/LICENSE`, `PATENTS` e `README.md`
- Create: `windows/ui/assets/licencas-windows.txt`
- Modify: `windows/ui/build.mjs`, `windows/ui/src/screens/Licencas.tsx`, `windows/ui/src/screens/Sobre.tsx`, `windows/ui/src/main.tsx`, `windows/ui/src/app.css`
- Modify: `windows/app/CMakeLists.txt`, `docs/build-notes.md`, `docs/ponte-windows.md`, e os comentários do "desligado até a etapa 2" em `starsonic/desktop/DesktopApp.h`, `windows/app/src/main.cpp`, `tests/desktop/desktop_fixture.h` e `tests/desktop/test_desktop_video.cpp`
- Create: `windows/ui/tests/video/licencas.spec.ts`, `tests/python/test_h264_download_option.py`

**Interfaces:**
- Consumes (Task 1): o `AVISO_DA_CISCO`.
- Produces: o `Licencas` ganha a prop `ios: boolean` e lê o `assets/licencas-ios.txt` no iPhone e o `assets/licencas-windows.txt` no Windows.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `licencas.spec.ts` (Windows):
    - `the Windows notices list OpenH264, libvpx and libyuv, with the Cisco notice`:
      - no Sobre, a linha `Avisos de licença` abre a tela;
      - os títulos são `OpenH264 2.6.0`, `libvpx 1.16.0` e `libyuv 1678`;
      - logo embaixo do `OpenH264 2.6.0` fica o destaque `OpenH264 Video Codec provided by Cisco Systems, Inc.`;
      - não há violações sérias do axe.
    - `the Windows notices file carries each license byte for byte`, como o teste do `licencas-ios.txt` no `ios.spec.ts`. O texto de cada parte do `dist/assets/licencas-windows.txt` é igual (com o `\r\n` trocado por `\n`) a:
      - `starsonic/third_party/openh264/BINARY_LICENSE.txt`;
      - o `LICENSE`, uma linha em branco e o `PATENTS` da libvpx;
      - o `LICENSE`, uma linha em branco e o `PATENTS` da libyuv.
    - `the notices screen asks to reinstall when its text does not load`, no Windows, como o do iPhone.
  - No `test_h264_download_option.py`:
    - `test_the_download_option_is_on`: o `windows/app/CMakeLists.txt` tem o `option(STARSONIC_H264_DOWNLOAD ... ON)`;
    - `test_no_build_script_turns_it_off`: nenhum script do `build/` nem do `.github/workflows/` passa o `STARSONIC_H264_DOWNLOAD`;
    - `test_the_bsd_texts_are_in_the_repo`: os quatro arquivos da libvpx e da libyuv existem, e cada `README.md` diz de onde vieram.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/video/licencas.spec.ts` falha: o Sobre do Windows não tem a linha. O `python3 -m unittest tests.python.test_h264_download_option` falha: a opção ainda está `OFF`.
- [ ] **Step 3: Implemente.**
  - **Os textos BSD:**
    - O `LICENSE` e o `PATENTS` da libvpx vêm byte a byte da tag `v1.16.0` de `webmproject/libvpx` (a versão da porta do vcpkg no `deps.lock`).
    - Os da libyuv vêm do `third_party/yuv` do pjproject, no commit `5a457451fa2712ba18e12b01738e8ff3af2b26fd` do `deps.lock`. A versão é a do `include/libyuv/version.h` dali: 1678.
    - Cada `README.md` diz o endereço, a tag ou o commit, e quem usa: o motor do Windows, compilado na PJSIP.
  - **O `licencas-windows.txt`** tem o formato do `licencas-ios.txt` (o título sublinhado com `=`, uma linha em branco, o texto, e duas linhas em branco entre as partes), na ordem do teste.
  - O `build.mjs` copia o arquivo novo.
  - **A tela de Licenças:**
    - O `Licencas` mostra o destaque (o `AVISO_DA_CISCO`, como no quadro `Licencas`) logo depois do título da parte que começa com `OpenH264 `.
    - O Sobre do Windows ganha a linha `Avisos de licença` (a mesma do iPhone) depois do `Código-fonte`. O `main.tsx` passa o `onLicencas` e o `ios`.
  - **O download:** o `option(STARSONIC_H264_DOWNLOAD ...)` passa a `ON`. Os comentários, o `docs/build-notes.md` e o `docs/ponte-windows.md` passam a dizer que a etapa 2 ligou o download junto com a chave, o aviso e a licença.
- [ ] **Step 4: Rode e veja passar.** O `licencas.spec.ts`, o `ios.spec.ts`, o `python3 -m unittest discover -s tests/python` e a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(video): a tela de Licenças com a Cisco, a libvpx e a libyuv, e o download do H.264 ligado`. O CI fica verde, com o passo da Cisco.

### Task 11: As fotos, a fumaça, o roteiro e as notas

**Files:**
- Create: `windows/ui/tests/teclado.ts`. O `marcarOsControles`, o `paradaDeAgora` e o `conferirOTeclado` saem do `tests/chat/fotos.spec.ts` para cá, sem mudar.
- Modify: `windows/ui/tests/chat/fotos.spec.ts`, que passa a importar os três do `tests/teclado.ts`.
- Create: `windows/ui/tests/video/fotos.spec.ts`, `windows/ui/tests/chat/fotos-ligacao.spec.ts`
- Modify: `tests/smoke/windows_smoke.py`, `tests/python/test_windows_smoke.py`
- Modify: `docs/teste-manual.md`
- Create: `notas/v0.3.0-rc.1.txt`

**Interfaces:**
- Consumes: as telas das Tasks 2 a 10, e os cenários e ajudantes das Tasks 1 e 2.
- Produces (`windows_smoke.py`):
  ```python
  def video_buffer_problems(label, vista, info): ...   # [] com info == {"dados": {"v": 1, "type": "videoBuffer", "vista": vista, "bytes": 6220864}, "bytes": >= 6220864}
  def h264_download_result(log_text): ...               # "instalado", "falhou" ou None, pelas linhas "h264: instalado" e "h264: download falhou"
  def check_video_buffers(page, notice_page, label, record, problems): ...
  def check_video_notice(win, hwnd, browser, page, registrar, record, problems): ...
  def check_h264_download(data_dir, record, problems): ...
  ```

- [ ] **Step 1: Escreva os testes que falham.**
  - No `test_windows_smoke.py`:
    - `video_buffer_problems` aceita o certo e acusa o `None` (o tempo acabou), a vista trocada e os bytes menores;
    - `h264_download_result` acha o `instalado`, o `falhou` e o `None`.
  - No `tests/video/fotos.spec.ts`, como o `tests/chat/fotos.spec.ts`. Cada tela, em cada tamanho (400×720, 360×600 e 300×440) e em cada tema, tira a foto `video-<tela>-<largura>x<altura>-<tema>.png`, passa pelo `semViolacoesSerias` e pelo `conferirOTeclado`. As telas:
    - `teclado` (com `2003` digitado), `contatos` e `recentes` (com a primeira linha aberta);
    - `ligacao` (o `video`, com um quadro no `remoto` e outro no `local`), `voz-com-camera` e `aviso-da-camera` (o `video` com a câmera desligada e o toast `A câmera foi desconectada.`);
    - `tocando` e `tocando-porteiro` (com um quadro);
    - `configuracoes` (testando, com um quadro), `configuracoes-sem-camera`, `adm-video`, `adm-video-falhou` e `licencas`.

    Fora dos três tamanhos:
    - o `aviso` (380×222) e o `aviso-porteiro` (380×430), só no tema escuro (o aviso é sempre escuro);
    - o `grande` (1280×800) e a `tela-cheia` (1920×1080), nos dois temas.
  - No `tests/chat/fotos-ligacao.spec.ts` (o servidor do chat), nos três tamanhos e nos dois temas: `conversa` (com o `Ligar com vídeo`) e `conversa-na-ligacao`. E o `grande-chat` em 1280×800.
- [ ] **Step 2: Rode e veja falhar.** O `python3 -m unittest tests.python.test_windows_smoke` falha sem as funções. As fotos (`npx playwright test tests/video/fotos.spec.ts tests/chat/fotos-ligacao.spec.ts`) já rodam, porque as telas existem: o que o axe ou o Tab acusarem é consertado aqui.
- [ ] **Step 3: Implemente.**
  - **A fumaça** (`windows_smoke.py`):
    - O `check_video_buffers` roda na página principal e na do aviso, pelo CDP:
      1. ouve o `sharedbufferreceived` (até 15 s);
      2. manda pelo `window.chrome.webview.postMessage` o `videoViews` da vista (`local` na principal, `porteiro` no aviso);
      3. guarda o `additionalData` e o `byteLength`;
      4. tira a vista de novo (`vistas: []`).

      Ele roda no `run_recovery` duas vezes: antes do navegador refeito e depois de achar as páginas de novo.
    - O `check_video_notice`, no `run_smoke`, com a janela principal minimizada:
      - o `RINGVIDEO <RAMAL> 3001 VP8` do registrador falso mostra o aviso com o `Atender com vídeo`;
      - a área da janela do aviso tem 222 pixels lógicos de altura (± 1), medida como a da janela principal;
      - o `Recusar` encerra.
    - O `check_h264_download`, no `run_smoke`, espera até 90 s uma linha `h264:` no diagnóstico:
      - `instalado` vai para o registro;
      - `falhou` é só um aviso no log da fumaça (a Cisco fora do ar não derruba o CI);
      - nenhuma das duas é um problema: o download não ligou.
  - **O roteiro** (`docs/teste-manual.md`) ganha a `## 23. Videochamada (0.3.0-rc.1)`, antes do "Onde cada critério de sucesso é verificado". Ela tem os itens da seção 11.3 da spec, nos dois PCs (W10 e W11) com webcam, e estes:
    - fechar o app no meio de uma videochamada e no meio do teste da câmera;
    - uma ligação que acaba com a janela grande minimizada ou maximizada;
    - o endereço `ciscobinary.openh264.org` para quem cuida do firewall do cliente.
  - **As notas** (`notas/v0.3.0-rc.1.txt`), em duas linhas:
    ```
    Videochamada: ligue e atenda com vídeo, abra a imagem grande ou em tela cheia, converse pelo chat durante a ligação e veja quem é o porteiro antes de atender. O técnico escolhe os codecs, a qualidade e os porteiros na área do administrador.
    Esta é uma versão de teste.
    ```
- [ ] **Step 4: Rode e veja passar.** O `python3 -m unittest discover -s tests/python` e a suíte inteira da interface passam. No CI, a fumaça do Windows passa com as memórias nas duas páginas (antes e depois do navegador refeito), o aviso de 222 e o H.264. As fotos ficam no artefato `capturas-interface`.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `test(video): as fotos, a fumaça das memórias e do aviso, o roteiro e as notas da 0.3.0-rc.1`. O CI fica verde. As fotos e os textos vão para a aprovação do Lucas, que publica a 0.3.0-rc.1 pelo `release`.
