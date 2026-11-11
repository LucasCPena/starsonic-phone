# Starsonic Phone — videochamada no Windows — especificação de design

- **Data:** 09/11/2026
- **Status:** o desenho foi aprovado pelo responsável no chat em 09/11/2026, em três partes, com um acréscimo:
  - o que a pessoa vê;
  - o acréscimo do responsável: o chat durante a ligação;
  - como funciona por dentro;
  - os problemas, os testes e o que fica fora.

  Os esboços das telas foram mostrados no chat. As telas de verdade vão para um quadro, "Starsonic Phone — telas da videochamada", que o responsável aprova antes do código das telas (seção 12). A spec escrita foi aprovada pelo responsável em 09/11/2026. A decisão 12 entrou depois, na leitura da licença do binário da Cisco, também aprovada por ele.
- **Versão alvo:** o app do Windows 0.3.0-rc.1.
- **Base:**
  - o app do Windows na 0.2.0-rc.1, com as telas (`windows/ui`), o núcleo (`starsonic/desktop`), o motor de ligações (`starsonic/phone`) e o contrato da ponte (`docs/ponte-windows.md`);
  - o chat da 0.2.0-rc.1 (spec `docs/superpowers/specs/2026-11-04-starsonic-phone-chat-design.md`);
  - o código do MicroSIP 3.22.16 em `microsip/`, como referência do que a videochamada dele faz.

> **Decisões do responsável** (09/11/2026):
> 1. A videochamada é só do app do Windows e segue a do MicroSIP. O Android e o iPhone ficam sem vídeo.
> 2. O vídeo vale com os colegas no Starsonic Phone, com o MicroSIP e outros programas, e com telefones e porteiros com câmera. Por isso o H.264 é obrigatório, e o VP8 entra para os programas.
> 3. As centrais dos clientes são de várias marcas, entre elas a 3CX. O app segue o padrão do SIP, sem nada próprio de uma central.
> 4. O vídeo aparece dentro da janela do app, com um "Abrir grande" que aumenta a própria janela e leva à tela cheia. Ficaram de fora a janela de vídeo à parte (o jeito do MicroSIP) e o vídeo só dentro do app, sem o grande.
> 5. Entram: o "Ligar com vídeo" e o "Atender com vídeo"; ligar e desligar a câmera na ligação, com o jeito de ver a outra pessoa sem mostrar a sua imagem; escolher e testar a câmera nas Configurações; e a imagem do porteiro no aviso, enquanto toca.
> 6. Os botões de vídeo já vêm ligados em todo computador. Os codecs e a qualidade ficam na área do administrador.
> 7. A imagem entra na página do app, e a página desenha (o caminho 1 de três). Ficaram de fora as janelinhas do Windows por cima da página e o misto.
> 8. O H.264 é o módulo da Cisco (o OpenH264), que o app baixa do site da Cisco; a Cisco paga a licença das patentes. O app nunca leva o código do H.264 dentro.
> 9. Durante uma ligação com um colega no chat, o botão "Chat" abre a conversa com ele, também nas ligações só de voz. No "Abrir grande", a conversa fica ao lado do vídeo.
> 10. O cartão Vídeo da área do administrador tem a lista "Porteiros": só para esses ramais o app pede a imagem antes de atender.
> 11. Com a tela do Windows bloqueada no meio da ligação, a câmera para de mandar a imagem e volta no desbloqueio.
> 12. A própria pessoa liga e desliga o H.264 da Cisco nas Configurações, numa chave que já vem ligada, com o aviso da Cisco ao lado, como pede a licença do binário (seção 6.3). A área do administrador continua podendo desligar o H.264 para o computador todo.
>
> O responsável aceitou também estas regras, que vieram como suposições:
> - uma ligação com vídeo por vez;
> - a câmera nunca liga sozinha;
> - o "Atender" de sempre não manda a sua imagem, mas mostra o vídeo da outra ponta;
> - o "Ligar com vídeo" para quem não tem vídeo vira uma ligação só de voz, com um aviso.

## 1. Contexto
O Starsonic Phone de hoje não tem vídeo. O motor de ligações é a PJSIP 2.17, compilada com o vídeo desligado (`PJMEDIA_HAS_VIDEO 0` no `build/config_site.h`).

O MicroSIP tem videochamada. No código dele (`microsip/`), a videochamada tem estas partes:
- o botão "Video Call", ao lado do ligar;
- o "Video", no aviso da ligação que chega, para atender com vídeo;
- nas configurações:
  - desligar o vídeo;
  - escolher a câmera e o codec preferido;
  - ligar ou desligar o H.264, o H.263+, o VP8 e o VP9;
  - a taxa do vídeo;
- uma janela de prévia da câmera.

No MicroSIP, a imagem sai em janelas próprias, desenhadas pela PJSIP com o SDL.

A tela do Starsonic Phone é uma página (Preact) dentro do WebView2, e quem recebe o vídeo é o motor, em C++. Esta spec diz como a imagem chega à página, e o que muda nas telas, no núcleo e no motor.

## 2. Objetivos
- Videochamada no Starsonic Phone do Windows, com a cara do app e o que o MicroSIP oferece.
- Funcionar com as centrais dos clientes, pelo padrão do SIP, e com os aparelhos mais comuns: o MicroSIP, os telefones e os porteiros com H.264.
- Ver o porteiro antes de atender, sem mandar nada de quem atende.
- Conversar pelo chat durante a ligação, para mandar um arquivo ou uma foto.
- Nenhum risco novo de patente para a Starsonic, e nenhuma imagem no diagnóstico.

## 3. Critérios de sucesso
- Dois PCs com o Starsonic Phone ligam com vídeo e se veem e se ouvem. Na ligação:
  - a câmera liga e desliga;
  - o "Abrir grande" e a tela cheia funcionam;
  - o "Diminuir" volta a janela ao tamanho de antes.
- Com o MicroSIP, o vídeo vai e volta no H.264 e no VP8.
- Um porteiro com H.264, cujo ramal está na lista "Porteiros", mostra a imagem dele no aviso enquanto toca. O "Atender" mostra o porteiro sem mandar a câmera de quem atende.
- Numa ligação com um colega no chat, o botão "Chat" abre a conversa, e um arquivo vai e chega durante a ligação.
- A ligação continua com voz, e o app diz o porquê, nestes casos:
  - sem câmera;
  - com a câmera bloqueada pelo Windows ou em uso por outro programa;
  - com a outra ponta, ou a central, sem vídeo.
- O instalador não leva o H.264. O app baixa o módulo da Cisco, confere a impressão digital (SHA-256) e só então usa. Sem o módulo, o resto funciona.
- O diagnóstico nunca leva uma imagem.

## 4. O que a versão entrega

### 4.1 Telas (o quadro "Starsonic Phone — telas da videochamada")
As telas abaixo vão para o quadro, nos três tamanhos de janela (Normal, Compacto e Mínimo) e nos dois temas.

- **Ligar com vídeo:**
  - no Teclado, ao lado do Ligar;
  - em cada linha da aba Contatos, ao lado do botão de ligar;
  - no menu de cada ligação dos Recentes;
  - no alto de uma conversa do chat, ao lado do Ligar.

  Os Atalhos e o Rediscar continuam só com voz.
- **A ligação com vídeo:**
  - o vídeo da outra ponta ocupa o alto da tela da ligação, com a sua imagem pequena num canto e o "Abrir grande" no outro;
  - os botões de hoje continuam, e entram a "Câmera" (liga e desliga a sua) e o "Chat" (seção 4.4);
  - sem vídeo da outra ponta, a tela é a de hoje, com o nome e o número; com a sua câmera ligada, a sua imagem pequena aparece.
- **O grande:**
  - a janela do app cresce e mostra só o vídeo, com a sua imagem no canto;
  - embaixo ficam o Mudo, a Câmera, o Chat, a Tela cheia, o Diminuir e o Desligar;
  - o "Chat" abre a conversa à direita do vídeo;
  - a tela cheia cobre o monitor; o duplo clique no vídeo entra e sai dela, e o Esc sai.
- **A ligação que chega:** no aviso da ligação e na tela do app, o "Atender com vídeo" aparece ao lado do "Atender" quando a ligação oferece vídeo. A imagem do porteiro, quando vem, aparece no aviso e na tela do app, antes de atender.
- **As Configurações:**
  - a parte "Áudio" passa a se chamar "Áudio e vídeo" e ganha o campo "Câmera", com as câmeras do computador, como o Microfone e o Alto-falante;
  - o "Testar a câmera" mostra a imagem ali mesmo, até "Parar o teste" ou até sair da tela;
  - a chave "H.264 da Cisco", que já vem ligada, com o aviso "OpenH264 Video Codec provided by Cisco Systems, Inc." embaixo. Ela só aparece com o H.264 ligado no cartão Vídeo da área do administrador. Desligada, o motor não usa o H.264, e o app não baixa o módulo.
- **A área do administrador:** o cartão "Vídeo" (seção 4.3).
- **A tela de Licenças:** o aviso da Cisco (seção 6.3).

### 4.2 Comportamento
- **Uma ligação com vídeo por vez.** Nestes casos o vídeo pausa: nada é mandado nem desenhado, e a voz continua:
  - com duas ligações;
  - na espera;
  - na conferência, onde as duas ligações ficam só com voz;
  - na transferência.

  O vídeo volta quando a ligação volta a ser a única ativa e sai da espera.
- **A exceção do porteiro** (decisão do responsável em 11/11/2026): a imagem do porteiro fica sempre à vista, também com outra ligação, antes de atender (no aviso) e depois (na tela da ligação e no grande), só recebendo. O aviso mostra a imagem dele antes de atender também com a janela do app na frente (0.3.0-rc.2), sem tomar o foco dela; a tela da ligação segue com o cartão da segunda.
  - Porteiro é a recebida de um número dos Porteiros que oferece vídeo com um codec em comum, do toque ao fim.
  - A sua câmera nunca manda para o porteiro por causa da exceção: o envio segue a regra das duas ligações.
  - A espera, a transferência e a conferência pausam o porteiro como qualquer ligação.
  - A outra ligação segue a regra de sempre: com o porteiro, ela fica só com a voz.
- **O "Ligar"** continua só com voz, como hoje, sem oferecer vídeo.
- **O "Ligar com vídeo"** oferece o vídeo, com a sua câmera ligada. Sem câmera, a ligação só recebe o vídeo (seção 11.1).
  - Se a outra ponta, ou a central, recusa o vídeo, a ligação segue com voz e aparece "A outra ponta não aceitou o vídeo.".
  - Se a ligação inteira é recusada por causa do vídeo (o código 488 ou 415), o app liga de novo, uma vez, só com voz, e mostra o mesmo aviso.
- **A "Câmera"** no meio da ligação:
  - numa ligação só de voz, ela pede o vídeo à outra ponta (uma nova oferta, o re-INVITE) e liga a sua câmera;
  - numa ligação com vídeo, ela só liga ou desliga a sua imagem, sem nova oferta.
- **O "Atender"** de uma ligação que oferece vídeo aceita o vídeo da outra ponta e não manda o seu. O "Atender com vídeo" manda o seu também.
- **A câmera nunca liga sozinha.** Ela só liga no "Ligar com vídeo", no "Atender com vídeo", no botão "Câmera" ou no "Testar a câmera". Com ela ligada, a sua imagem pequena está sempre à vista.
- **A tela bloqueada** (a sessão do Windows travada ou desconectada, pela mesma regra que o chat usa para a janela atrás): a câmera para de mandar a imagem e volta no desbloqueio, se estava ligada.
- **O porteiro antes de atender:**
  - quando chega uma ligação que oferece vídeo, de um ramal da lista "Porteiros", o app responde "183 Session Progress" com o SDP, e o porteiro pode mandar a imagem enquanto toca;
  - antes do atender, o app não liga o microfone nem a câmera na ligação, e também não toca o som do porteiro;
  - o toque de sempre continua.
- **A câmera escolhida desconectada:** o app usa a primeira câmera da lista do Windows, como faz com o microfone, e guarda a escolha para quando ela voltar.
- **A imagem da outra ponta** encaixa na área do vídeo sem deformar, com faixas onde sobrar.
- **O "Abrir grande"** aumenta a janela do app para 1280×800 pontos, ou para a área de trabalho do monitor se ela for menor, e centraliza a janela no monitor dela.
  - O app guarda o tamanho e o lugar de antes. O "Diminuir" volta para eles.
  - Quando a ligação acaba, a janela volta sozinha.
- **O fim da ligação:** com a conversa do chat aberta pela ligação (seção 4.4), o app fica na conversa. Sem ela, o app volta para o Teclado, como hoje.

### 4.3 A área do administrador: o cartão "Vídeo"
- **Os codecs:** o H.264 e o VP8 vêm ligados, e o VP9 vem desligado. Um campo diz qual codec vem primeiro, com o H.264 como padrão. Com todos desligados, os botões de vídeo e o campo "Câmera" somem.
- **A qualidade:** Baixa, Média (o padrão) ou Alta, com os valores da seção 7.
- **Os "Porteiros":** os ramais, separados por vírgula. Valem só dígitos, até 20 ramais, sem repetir.
- **O H.264 da Cisco:** a situação dele, com um destes três estados:
  - "Instalado";
  - "Baixando…";
  - "Não foi possível baixar", com o "Tentar de novo".

  Com o H.264 desligado no cartão, o app não baixa o módulo, e a chave "H.264 da Cisco" some das Configurações.
- Os valores do cartão valem para todas as contas do computador e ficam gravados como as outras escolhas da área.

### 4.4 O chat durante a ligação
- **O botão "Chat"** aparece na tela da ligação quando estas três coisas valem:
  - o computador está ligado ao chat, com a pessoa da conta em uso dentro dele (a situação "pronto" do cliente do chat);
  - o número da ligação, comparado só pelos dígitos, é o ramal de um colega no chat;
  - esse colega não saiu do chat.
- **Na janela do app,** o "Chat" abre a conversa com o colega e cria a dupla se ela ainda não existe. Em cima da conversa fica a faixa da ligação, com:
  - o vídeo pequeno, ou o nome, se a ligação não tem vídeo;
  - o tempo da ligação;
  - o Mudo, a Câmera e o Desligar;
  - o "Voltar para a ligação".
- **No grande,** a conversa abre à direita do vídeo, com 360 pontos de largura, e o vídeo encolhe para caber.
- **Durante a ligação,** o "Ligar" e o "Ligar com vídeo" do alto da conversa ficam escondidos. O "Voltar" da conversa volta para a ligação, e as outras conversas ficam para depois dela.
- **O resto da conversa** é o chat de sempre: as mensagens, os arquivos e as fotos.
- **O botão também aparece numa ligação só de voz.**
- **Numa ligação com quem não está no chat,** o botão não aparece: um porteiro, um número de fora, um ramal sem o chat.

## 5. Fora do escopo
- O vídeo no Android e no iPhone. O iPhone usa as mesmas telas: no modo iPhone, nada de vídeo aparece.
- O vídeo em conferência, com mais de duas pessoas.
- Compartilhar a tela, gravar a ligação, o fundo desfocado e outros efeitos.
- Um botão "Abrir a porta" para o porteiro.
- O H.263+, que pede o FFmpeg.
- O ajuste automático da qualidade pela internet.
- O Rediscar com vídeo e a marca de vídeo nos Recentes.

## 6. Arquitetura

### 6.1 As partes
```
App do Windows (um processo)
┌──────────────────────────────────────────────────────────────────────────┐
│ interface (Preact, WebView2): as telas, a vista do vídeo (WebGL), o chat │
│        ▲ ponte (JSON)               ▲ memória dividida (SharedBuffer)     │
│ núcleo (C++): os pedidos, a janela grande e a tela cheia, a câmera na    │
│   tela bloqueada, o download da Cisco, as vistas de quadros              │
│        ▲                                                                 │
│ motor (PJSIP 2.17 com vídeo): o DirectShow (câmera), o VP8 e o VP9       │
│   (libvpx), o H.264 (o adaptador do módulo da Cisco), o desenhista nosso │
└──────────────────────────────────────────────────────────────────────────┘
          ▲ SIP e RTP (voz e vídeo)                ▲ HTTP, uma vez
     a central do cliente                    o site da Cisco (o OpenH264)
```

### 6.2 O motor (PJSIP com vídeo)
- **A compilação no Windows** (`build/config_site.h` e o `build/Build-Deps.ps1`):
  - `PJMEDIA_HAS_VIDEO 1`;
  - a câmera pelo DirectShow (`PJMEDIA_VIDEO_DEV_HAS_DSHOW`);
  - o VP8 e o VP9 pela libvpx (a porta `libvpx` do vcpkg, no commit fixo do `build/deps.lock`);
  - o H.264 pelo adaptador da seção 6.3;
  - a libyuv da própria PJSIP, para converter e escalar as imagens;
  - sem o SDL e sem o FFmpeg.
- **A compilação no Linux, só para os testes** (`build/linux/build-pjproject.sh`):
  - o vídeo ligado, com a libvpx e o OpenH264 do sistema;
  - a câmera de teste da PJSIP, que gera barras coloridas, no lugar do DirectShow.

  O OpenH264 do Linux é só dos testes e nunca é publicado.
- **O desenhista nosso:** um dispositivo de vídeo de saída próprio (uma `pjmedia_vid_dev_factory`) recebe cada quadro decodificado e cada quadro da prévia da câmera, e entrega para as vistas de quadros (seção 6.4). É ele que substitui as janelas do SDL do MicroSIP.
- **As ofertas e as respostas:**
  - a conta tem o `vid_in_auto_show` ligado e o `vid_out_auto_transmit` desligado. Assim, aceitar o vídeo não liga a câmera: ela só manda a imagem depois de um pedido para começar a transmitir;
  - o "Ligar" usa `vid_cnt = 0`, e o "Ligar com vídeo" usa `vid_cnt = 1` e começa a transmitir;
  - a "Câmera" numa ligação sem vídeo pede `PJSUA_CALL_VID_STRM_ADD`, e numa ligação com vídeo pede `START_TRANSMIT` ou `STOP_TRANSMIT`.
- **A fronteira:** o motor ganha, na interface dele (`CallEngine`), os pedidos de vídeo e os eventos do vídeo de cada ligação, como já tem para a voz. O motor do iPhone (baresip) responde que não tem vídeo.

### 6.3 O H.264 da Cisco
- **A versão:** a versão do OpenH264 fica fixa no `build/deps.lock`, com o endereço do binário da Cisco para Windows de 32 bits (`openh264-<versão>-win32.dll.bz2`) e as impressões digitais (SHA-256) do arquivo comprimido e do `.dll`.
- **O adaptador:**
  - a PJSIP fala com o H.264 por um adaptador nosso, que só procura o módulo da Cisco quando ele está baixado e conferido;
  - a cada abertura do app, o adaptador confere a impressão do `.dll` e carrega o módulo pelo caminho completo, com o `LoadLibraryEx`;
  - só então o motor registra o codec H.264;
  - o `.exe` do app não depende do módulo para abrir.
- **O download:**
  - o núcleo baixa o módulo pelo cliente HTTP de hoje (WinHTTP, com o proxy do Windows), no endereço exato do `deps.lock`;
  - ele confere a impressão do arquivo comprimido, descomprime (bzip2), confere a do `.dll` e grava em `%LOCALAPPDATA%\Starsonic Phone\codecs\`;
  - um arquivo que não confere é apagado e não é usado;
  - o download roda em segundo plano, quando o app abre e o módulo da versão certa não está lá, e também no "Tentar de novo" do cartão Vídeo. Ele só roda com o H.264 ligado no cartão e na chave da pessoa;
  - uma falha espera a próxima abertura ou o "Tentar de novo";
  - um módulo de outra versão, que sobrou de uma atualização, é apagado.
- **A licença do binário** (lida em 09/11/2026) tem quatro condições, e o app cumpre as quatro:
  - o binário é baixado à parte no computador da pessoa, e não vem dentro do app;
  - a pessoa pode ligar, desligar e religar o uso dele: a chave "H.264 da Cisco" das Configurações (seção 4.1);
  - onde a pessoa liga e desliga, o app mostra "OpenH264 Video Codec provided by Cisco Systems, Inc.";
  - o texto inteiro da licença, com a nota da licença de patentes AVC, aparece na tela de Licenças.

  A etapa 1 guarda o texto da licença da versão fixada no repositório, para a tela de Licenças da etapa 2.

### 6.4 A imagem até a página
- **As vistas de quadros:** cada lugar onde aparece um vídeo é uma vista:
  - na janela principal: o vídeo da outra ponta, a sua imagem e o teste da câmera;
  - no aviso da ligação: o porteiro.
- **A memória dividida:**
  - o núcleo cria uma memória dividida do WebView2 para cada vista (`ICoreWebView2Environment12::CreateSharedBuffer`) e entrega à página certa (`PostSharedBufferToScript`), uma vez;
  - cada memória tem um cabeçalho (o número do quadro, a largura, a altura e o quadro da vez) e dois lugares de quadro, no formato I420;
  - o motor escreve num lugar enquanto a página lê o outro.
- **A página:**
  - a cada quadro de tela (`requestAnimationFrame`), a vista olha o número do quadro e, se mudou, sobe as três camadas da imagem para o WebGL e desenha;
  - sem o WebGL, a vista desenha com o canvas 2D, mais devagar.
- **Os limites:**
  - até 1920×1080 por quadro: um quadro maior é escalado antes, no núcleo;
  - até 30 quadros por segundo para a página;
  - a página diz ao núcleo quais vistas estão à vista, e o núcleo não copia quadro para as outras nem com a janela minimizada.

### 6.5 O núcleo e a janela
- **Os pedidos novos da ponte** (seção 6.7) chegam ao motor pelo DesktopApp, como os de hoje.
- **O grande e a tela cheia:**
  - o MainWindow ganha o "crescer" (seção 4.2) e o "voltar";
  - ele também ganha a tela cheia, sem a borda e cobrindo o monitor da janela;
  - os tamanhos seguem a escala de cada monitor (o DPI), como hoje.
- **A tela bloqueada:** o aviso da sessão que o chat já usa (`WTSRegisterSessionNotification`) também para a transmissão da câmera. O desbloqueio volta a transmissão, se a câmera estava ligada.
- **As câmeras:**
  - a lista vem do motor, como a dos dispositivos de áudio;
  - ela se atualiza quando uma câmera entra ou sai (o `WM_DEVICECHANGE`);
  - a escolha fica gravada por computador, como o Microfone.
- **O diagnóstico** ganha estas linhas, sem imagem e sem nome:
  - `video: <codec> <largura>x<altura> <qps> qps, envio ligado|desligado`;
  - `camera: falhou (<código>)`;
  - `h264: instalado <versão>`;
  - `h264: download falhou (<código>)`;
  - `h264: arquivo nao confere, apagado`.

### 6.6 A interface
- **Uma vista de vídeo** (um componente) para todas as telas, que lê a memória da seção 6.4.
- **As telas da seção 4.1:**
  - a ligação com o vídeo;
  - o grande, com a conversa ao lado;
  - a faixa da ligação em cima da conversa;
  - o aviso com o porteiro;
  - o campo "Câmera" e o teste;
  - o cartão "Vídeo".
- **O botão "Chat":** a interface procura o número da ligação entre os colegas do cliente do chat, pelo ramal. Ela abre a conversa pelo cliente que já roda na página, sem um segundo cliente.
- **No modo iPhone,** nada de vídeo aparece.
- **Os textos novos** (seção 10) ficam com os outros, nos arquivos de textos das telas.

### 6.7 A ponte (resumo; os nomes e os campos exatos ficam em `docs/ponte-windows.md`)
- **Pedidos:**
  - o `dial` com `"video": true`;
  - o `answer` com `"video": true`;
  - a câmera na ligação;
  - escolher a câmera e o teste da câmera;
  - o grande e a tela cheia;
  - as vistas à vista;
  - os campos do cartão Vídeo;
  - o "Tentar de novo" do H.264.
- **O estado:**
  - na ligação: se ela tem vídeo, se a outra ponta manda imagem e se a sua câmera está mandando, além da oferta de vídeo de uma ligação que chega;
  - as câmeras, a escolhida e a desconectada;
  - os valores do cartão Vídeo e a situação do H.264;
  - os avisos da seção 11.1.
- **A memória dividida** de cada vista, com o nome da vista no JSON que vai junto (`additionalDataAsJson`).

## 7. Os valores
| Qualidade | Imagem | Quadros por segundo | Taxa do vídeo |
| --- | --- | --- | --- |
| Baixa | 320×240 | 15 | 300 kbit/s |
| Média (padrão) | 640×480 | 25 | 800 kbit/s |
| Alta | 1280×720 | 30 | 1500 kbit/s |

- A câmera abre no tamanho mais perto do da qualidade, e a imagem é escalada para ele.
- **O H.264:** Constrained Baseline, `profile-level-id=42e01f`, `packetization-mode=1`.
- **O VP8 e o VP9:** os da libvpx, com os valores da tabela.
- **O aviso de um problema:** um toast de 5 segundos, como os de hoje.
- **Os "Porteiros":** até 20 ramais, só dígitos.
- **O grande:** 1280×800 pontos, ou a área de trabalho. A conversa do chat ocupa 360 pontos.
- **O download da Cisco:** desiste depois de 60 segundos sem resposta.

## 8. Fluxos
- **Ligar com vídeo:**
  1. A pessoa clica em "Ligar com vídeo".
  2. O app oferece a voz e o vídeo, com a câmera ligada.
  3. A outra ponta atende com vídeo, e os dois se veem.
  4. Se a outra ponta atende sem vídeo, a ligação segue com voz e aparece o aviso.
- **Receber com vídeo:**
  1. O aviso mostra o "Atender" e o "Atender com vídeo".
  2. O "Atender" mostra o vídeo da outra ponta, com a câmera de quem atende desligada.
  3. A "Câmera" liga a imagem de quem atende depois, quando ele quiser.
- **O porteiro:**
  1. O porteiro, que está na lista, liga com vídeo.
  2. O app responde 183 com o SDP, e a imagem aparece no aviso enquanto toca, sem som e sem nada nosso indo.
  3. O "Atender" liga a voz nos dois sentidos, com a câmera desligada.
- **A câmera no meio:**
  1. Numa ligação só de voz, a "Câmera" pede o vídeo (re-INVITE).
  2. Se a outra ponta aceita, os dois se veem. Se recusa, aparece o aviso.
- **O chat na ligação:**
  1. Numa ligação com um colega no chat, o "Chat" abre a conversa com a faixa da ligação.
  2. Ali dá para mandar um arquivo.
  3. O "Voltar para a ligação" volta. No fim da ligação, a conversa fica aberta.

## 9. Segurança e privacidade
- **A câmera:**
  - ela só liga por um gesto da pessoa (seção 4.2);
  - com ela ligada, a sua imagem está à vista;
  - ela para com a tela bloqueada.
- **O porteiro:** antes do atender, nada sai de quem atende, nem voz nem imagem, e o som do porteiro não toca.
- **O diagnóstico:** nunca leva uma imagem. Ele também continua sem mensagem, sem nome de arquivo e sem nome de pessoa, como já vale para o chat.
- **O módulo da Cisco:**
  - ele vem só do endereço fixo e só é usado depois de conferido pela impressão digital gravada no app, a cada abertura;
  - ele é carregado pelo caminho completo;
  - é o único endereço novo que o app procura na internet, e o roteiro registra isso para quem cuida do firewall do cliente.
- **A memória dividida:** só a página do app recebe as memórias. O aviso recebe só a do porteiro.

## 10. Interface e textos
Os textos abaixo são propostas e vão para a aprovação do responsável, com as fotos, como no chat.
- **Os botões:**
  - "Ligar com vídeo";
  - "Atender com vídeo";
  - "Câmera", com os nomes para o leitor de tela "Ligar a câmera" e "Desligar a câmera";
  - "Abrir grande" e "Diminuir";
  - "Tela cheia" e "Sair da tela cheia";
  - "Chat" e "Voltar para a ligação";
  - "Testar a câmera" e "Parar o teste";
  - "Tentar de novo".
- **Os nomes para o leitor de tela:**
  - "Ligar com vídeo para <nome>";
  - "Vídeo de <nome>";
  - "Sua imagem".
- **As Configurações:** "Áudio e vídeo", "Câmera", "Nenhuma câmera encontrada." e "H.264 da Cisco", com "OpenH264 Video Codec provided by Cisco Systems, Inc." embaixo.
- **Os avisos:**
  - "A outra ponta não aceitou o vídeo.";
  - "A câmera está sendo usada por outro programa.";
  - "A câmera foi desconectada.";
  - "O Windows bloqueou a câmera para este app. Libere em Configurações do Windows → Privacidade e segurança → Câmera.";
  - "Este vídeo precisa do H.264, que ainda não foi baixado.".
- **O cartão Vídeo:**
  - "Vídeo", "Codecs", "Primeiro", "Qualidade", "Baixa", "Média" e "Alta";
  - "Porteiros", com a ajuda "Ramais dos porteiros, separados por vírgula: o app mostra a imagem deles antes de atender.";
  - "H.264 da Cisco: instalado", "Baixando…" e "Não foi possível baixar".
- **A tela de Licenças:** "OpenH264 Video Codec provided by Cisco Systems, Inc.".

## 11. Erros e testes

### 11.1 Erros
A ligação nunca cai por causa do vídeo. A voz continua em todos estes casos:

| O que acontece | O que o app faz |
| --- | --- |
| Sem câmera | O "Ligar com vídeo" ainda oferece o vídeo, para ver a outra ponta, e mostra "Nenhuma câmera encontrada.". |
| A câmera sai no meio | A sua imagem some, e aparece "A câmera foi desconectada.". |
| A câmera bloqueada pelo Windows | O aviso diz onde liberar. |
| A câmera em uso | "A câmera está sendo usada por outro programa." |
| A outra ponta ou a central sem vídeo | "A outra ponta não aceitou o vídeo." |
| A ligação recusada pelo vídeo (488 ou 415) | O app liga de novo, uma vez, só com voz, e mostra o mesmo aviso. |
| Sem codec em comum, com o H.264 ainda não baixado | "Este vídeo precisa do H.264, que ainda não foi baixado." O cartão mostra a situação. |
| O módulo não confere | O app apaga o arquivo e não usa, e o diagnóstico registra. |
| O site da Cisco fora ou bloqueado | "Não foi possível baixar" no cartão, e o VP8 continua. |
| A internet fraca | O vídeo pode travar ou borrar. A voz segue, e o técnico pode baixar a qualidade. |
| Uma imagem de outro tamanho | A página encaixa a imagem sem deformar. |
| O chat fora | A conversa mostra o aviso de sempre do chat. |

### 11.2 Testes automáticos (a cada mudança, no GitHub)
- **O motor no Linux:**
  - duas cópias do motor ligam uma para a outra pelo registrador falso (`tests/phone`), com a câmera de teste;
  - os testes conferem:
    - o vídeo nos dois sentidos, no VP8 e no H.264 (com o OpenH264 de teste);
    - a câmera que para e volta;
    - o "Atender" sem a imagem de quem atende;
    - o pedido de vídeo no meio da ligação;
    - a outra ponta que recusa o vídeo (a porta 0);
    - o 488 que vira ligação de voz;
    - a espera e a conferência, que pausam o vídeo;
    - o porteiro: o 183 com o SDP, a imagem que chega antes do atender, e nenhum quadro nem som saindo de quem atende antes do 200;
    - a pausa da câmera pela tela bloqueada, pelo pedido do núcleo.
- **O núcleo no Linux:**
  - as vistas de quadros: o cabeçalho, os tamanhos do I420, a troca dos lugares e a escala de um quadro grande demais;
  - o download da Cisco, com um servidor de mentira: a impressão que confere, o arquivo errado apagado, a versão velha apagada, o bzip2 e a desistência em 60 s;
  - os valores do cartão Vídeo e a validação dos Porteiros;
  - as linhas do diagnóstico.
- **A interface (Playwright), com quadros de mentira:**
  - cada tela da seção 4.1;
  - o "Abrir grande", o "Diminuir" e a tela cheia;
  - o botão "Chat" e a faixa, com o servidor de teste do chat;
  - o aviso com o porteiro;
  - as Configurações e o cartão;
  - os avisos da seção 11.1;
  - o modo iPhone sem vídeo;
  - os dois temas e os três tamanhos;
  - o axe e a volta do Tab;
  - as fotos para a aprovação.
- **O Windows (CI):**
  - a compilação com o vídeo;
  - os testes do núcleo e do desktop no Windows;
  - o download de verdade do módulo da Cisco, conferindo a impressão do `deps.lock`;
  - a fumaça do app instalado, que abre sem o módulo e sem câmera.

### 11.3 Teste manual
O roteiro (`docs/teste-manual.md`) ganha a seção 23, nos dois PCs (W10 e W11) com webcam. Ela confere:
- Starsonic com Starsonic: o vídeo, a câmera, o grande, a tela cheia e o Diminuir;
- Starsonic com o MicroSIP, no H.264 e no VP8;
- um telefone com câmera e um porteiro, se a Starsonic tiver: o porteiro tocando, o "Atender" sem a imagem e o "Atender com vídeo";
- a central de cada cliente que vai usar vídeo;
- o download da Cisco e o "Tentar de novo" com a internet cortada;
- a câmera bloqueada nas configurações do Windows, a câmera em uso pelo Teams ou outro programa, duas câmeras e a câmera tirada no meio;
- o chat na ligação, com um arquivo, nos dois tamanhos (a janela do app e o grande);
- a espera, a segunda ligação, a conferência e a transferência;
- a tela bloqueada no meio;
- dois monitores com escalas diferentes;
- o diagnóstico, sem imagem.

## 12. Entrega e etapas
- **Etapa 1, o motor e o núcleo:**
  - a PJSIP com o vídeo, no Windows e no Linux dos testes;
  - o desenhista nosso e as vistas de quadros;
  - o adaptador e o download do H.264;
  - as câmeras;
  - os pedidos e o estado da ponte;
  - o grande e a tela cheia no executável;
  - a câmera na tela bloqueada.

  A etapa 1 tem os testes da seção 11.2 do motor, do núcleo e do Windows, mas nenhuma tela nova.
- **Antes da etapa 2:** o quadro "Starsonic Phone — telas da videochamada" vai para a aprovação do responsável.
- **Etapa 2, a interface:**
  - as telas e os botões;
  - o chat na ligação;
  - as Configurações e o cartão Vídeo;
  - o aviso com o porteiro;
  - a tela de Licenças;
  - os testes da interface e as fotos;
  - a seção 23 do roteiro e as notas da 0.3.0-rc.1.
- **A publicação:** o responsável publica a 0.3.0-rc.1 pelo workflow `release`, depois de aprovar as fotos e os textos.

## 13. Entradas necessárias da Starsonic
- Dois PCs, o W10 e o W11, com webcam e, se der, uma segunda câmera USB.
- Um PC com o MicroSIP com vídeo.
- Um telefone com câmera e um porteiro SIP com vídeo, se a Starsonic tiver, ligados à central de um cliente, com os ramais.
- A central de cada cliente com o H.264 e o VP8 liberados. A Starsonic confere com o fornecedor de cada central como liberar.
- A rede dos clientes deixando o app baixar uma vez do site da Cisco (`ciscobinary.openh264.org`).
- A aprovação do quadro, das fotos e dos textos.

## 14. Riscos
- **Uma central que não deixa o vídeo passar,** ou que tira a linha do vídeo: a voz continua (seção 11.1), e o roteiro confere cada central.
- **Um porteiro ou telefone com outro jeito de H.264** (o `packetization-mode=0` ou outro perfil): o roteiro mostra. Se aparecer, a etapa acrescenta uma segunda oferta de H.264.
- **Um porteiro que só manda a imagem depois do atender:** a imagem aparece só no atender, e o aviso mostra o nome, como hoje.
- **O site da Cisco bloqueado na rede do cliente:** o VP8 continua com os programas, e o cartão Vídeo mostra a falha.
- **Os termos do binário da Cisco:** lidos em 09/11/2026 (seção 6.3). Se a versão fixada mudar e os termos dela pedirem outra coisa, a etapa para e pergunta ao responsável.
- **O alcance da licença:** o texto da Cisco fala do "uso pessoal ou sem remuneração" do vídeo. É o aviso padrão do H.264, o mesmo do Windows e dos celulares. O responsável confere com quem cuida da parte legal, se quiser.
- **Uma câmera que o DirectShow não vê:** o roteiro testa duas câmeras. Se aparecer, uma etapa futura usa o Media Foundation.
- **Um PC fraco:** a qualidade Alta gasta processador, e por isso o padrão é a Média.
- **O app é de 32 bits:** cada vista usa perto de 6 MB de memória, o que cabe.
