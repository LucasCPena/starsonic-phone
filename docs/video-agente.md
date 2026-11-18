# O servidor de vídeo das reuniões: o contrato do agente

O servidor de vídeo é uma VM com o FreeSWITCH (o mosaico, o som, o SIP e o WebRTC), o coturn (o TURN) e o nosso agente de vídeo (`starsonic-video`, em Go). O servidor do chat cuida das reuniões (`docs/chat-protocolo.md`, seções 9 a 12) e fala com o agente. A spec é `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`.

## 1. As portas
| Porta | Quem escuta | Para quê |
|---|---|---|
| TCP 443 (ou a `porta` do config.json), em toda a VM | o agente (TLS do Let's Encrypt) | o `/sip` do navegador (seção 6) e a API do chat em `/agente/v1/` (seção 5) |
| TCP 80, em toda a VM | o certbot, só na hora de tirar ou renovar o certificado | o desafio do Let's Encrypt (se o chat e o vídeo dividem um IP público só, o chat leva o desafio até esta porta, pela rede interna) |
| TCP 5061, no IP da VM | o FreeSWITCH (o perfil `tls`) | o SIP sobre TLS do app |
| UDP 3478, no IP da VM | o coturn | o TURN |
| TCP 5349, no IP da VM | o coturn | o TURN sobre TLS |
| UDP 16384 a 16683 | o FreeSWITCH | a mídia (300 portas) |
| UDP 49152 a 49451 | o coturn | o relay do TURN (300 portas) |
| TCP 127.0.0.1:5066 | o FreeSWITCH (o perfil `navegador`) | o WebSocket do SIP, que só o agente alcança |
| TCP 127.0.0.1:5070 | o FreeSWITCH (o perfil `navegador`) | o SIP comum do perfil, sem uso de fora |
| TCP 127.0.0.1:8021 | o FreeSWITCH | o ESL (o `mod_event_socket`), com a senha do ESL |
| TCP 127.0.0.1:8091 | o agente | a discagem (o `mod_xml_curl`) |

A porta do HTTPS do agente é a 443, ou a `porta` do config.json (opcional, um número inteiro; sem ela, ou com 0, vale a 443). Valem a 443 e os números de 1024 a 65535, menos as portas do próprio servidor de vídeo: 3478, 5061, 5066, 5070, 5080, 5349, 8021 e 8091. Com a `porta`, o endereço do servidor de vídeo que o chat guarda leva a porta (`video.exemplo.com.br:7443`), e o `/sip` e a API do chat usam essa porta. As portas de TURN e de SIP não mudam (o chat as monta sem a porta do HTTPS).

## 2. A chave
- São 32 bytes aleatórios, escritos em base64url sem `=` (43 caracteres). O instalador do servidor de vídeo a cria e a mostra no fim. O administrador a cola no cartão "Reuniões" da administração do chat.
- Ela é usada de três jeitos, cada um com o seu rótulo:
  - como a credencial da API do agente: `Authorization: Bearer <chave>`, comparada em tempo constante;
  - para assinar a senha de uso único (seção 3);
  - para tirar o segredo do TURN (seção 4).

## 3. A senha de uso único
- **O formato:** `<carga>.<assinatura>`.
  - A `carga` é o JSON abaixo, em base64url sem `=`.
  - A `assinatura` é o HMAC-SHA256, com a chave (os 32 bytes), do texto `starsonic-senha-v1.` seguido da `carga`, em base64url sem `=`.
- **O JSON**, com os campos nesta ordem (a do `json.Marshal` do Go):
```json
{"v": 1, "sala": "<32 hex>", "participante": "<16 hex>", "papel": "colega" | "fora", "tela": false,
 "nome": "Maria Lima", "vence": 1794495630000, "id": "<32 hex>"}
```
- **Os campos:**
  - `sala`: o id da reunião no servidor de vídeo, sorteado pelo chat. Nunca é o código do link;
  - `participante`: quem entra, também sorteado pelo chat a cada entrada;
  - `papel`: o colega pode começar a reunião; quem é de fora só entra numa que já começou;
  - `tela`: a ligação da tela compartilhada;
  - `nome`: o nome que aparece no quadro (seção 7);
  - `vence`: em milissegundos UTC, no relógio do servidor de vídeo. O chat mede a diferença dos relógios pelos eventos (seção 5) e põe `vence` = a hora do agente + 30 segundos;
  - `id`: sorteado a cada senha.
- **O agente aceita a senha quando:**
  - a assinatura confere, e a carga é um JSON só com esses campos, com o `v` igual a 1, a `sala` com 32 caracteres hexadecimais minúsculos, o `participante` com 16, o `id` com 32, o `papel` válido e o `nome` não vazio;
  - agora é antes do `vence`, e o `vence` está a no máximo 60 segundos de agora;
  - o `id` ainda não foi usado. Cada senha vale uma vez só.
- **O vetor de teste** (o agente e o chat conferem os dois):
  - a chave `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` (os bytes 0 a 31);
  - o JSON `{"v":1,"sala":"0123456789abcdef0123456789abcdef","participante":"0011223344556677","papel":"fora","tela":false,"nome":"Maria Lima","vence":1794495630000,"id":"ffeeddccbbaa99887766554433221100"}` (o `vence` é 12/11/2026, 15:00:30 UTC);
  - a senha:
```
eyJ2IjoxLCJzYWxhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJwYXJ0aWNpcGFudGUiOiIwMDExMjIzMzQ0NTU2Njc3IiwicGFwZWwiOiJmb3JhIiwidGVsYSI6ZmFsc2UsIm5vbWUiOiJNYXJpYSBMaW1hIiwidmVuY2UiOjE3OTQ0OTU2MzAwMDAsImlkIjoiZmZlZWRkY2NiYmFhOTk4ODc3NjY1NTQ0MzMyMjExMDAifQ.uytClxmyRbyRIdxNiofeKfNt5unNa7TsnEPn1rjtwq4
```

## 4. O TURN
- **O segredo do coturn** (o `static-auth-secret`) é o HMAC-SHA256, com a chave, do texto `starsonic-turn-v1`, em base64url sem `=` (43 caracteres). O agente o escreve no `turnserver.conf`, e o chat tira o mesmo da chave.
- **As credenciais** seguem a "TURN REST API" do coturn:
  - o usuário é `<vence, em segundos UTC>:<participante>`;
  - a senha é o HMAC-SHA1, com o segredo (o texto de 43 caracteres), do usuário, em base64 comum com `=`;
  - o chat dá credenciais que vencem em 12 horas.
- **Os endereços:** `turn:<endereço>:3478?transport=udp` e `turns:<endereço>:5349?transport=tcp`.
- **O vetor de teste:** com a chave da seção 3, o segredo é `jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4`. Para o participante `0011223344556677`, com o vencimento 13/11/2026 03:00:00 UTC, o usuário é `1794538800:0011223344556677` e a senha é `lTe50TxrbuhEaWJVPhFLOGOJYRI=`.
- **O coturn só faz relay para a própria VM:** o `denied-peer-ip` cobre todos os endereços IPv4 e IPv6, e o `allowed-peer-ip` abre só o IP privado e o IP público da VM.

## 5. A API do agente (para o chat)
Tudo vai em HTTPS, na porta do agente (seção 1: a 443, ou a `porta` do config.json), com `Authorization: Bearer <chave>`, menos o `saude`. As respostas são JSON. Um erro vem como `{"erro": "<código>"}`.

| Status | `erro` | Quando |
|---|---|---|
| 400 | `invalido` | A `sala` não tem 32 caracteres hexadecimais minúsculos, ou o `participante` não tem 16. |
| 401 | `chave` | Sem a chave, ou com outra. |
| 404 | `naoEncontrado` | A sala ou o participante não estão no FreeSWITCH. |
| 500 | `interno` | O FreeSWITCH recusou o comando, ou ele falhou de outro jeito. O agente anota só o texto do erro do FreeSWITCH, sem ids. |
| 503 | `freeswitch` | O agente está sem a ligação com o FreeSWITCH (o ESL). |

**A saúde** — `GET /agente/v1/saude`, sem chave: `200` `{"ok": true}`.

**O estado** — `GET /agente/v1/estado`:
```json
{"versao": "0.1.0", "freeswitch": true, "agora": 1794495600000,
 "salas": [{"sala": "<32 hex>", "participantes": [{"participante": "<16 hex>", "tela": false}],
            "palco": {"largura": 1920, "altura": 1080,
                      "quadros": [{"participante": "<16 hex>", "tela": false, "x": 0, "y": 0, "l": 960, "a": 540}]}}],
 "uso": {"cpu": 34, "memoria": 41}}
```
- Cada ligação aparece uma vez em `participantes`: a da câmera, com `tela` falso, e a da tela, com `tela` verdadeiro.
- O `palco` de cada sala é o último que o agente mandou (veja o evento `palco`, abaixo). A sala que ainda não tem palco vai sem o campo.
- O `uso` vem em porcentagem inteira. A CPU é a do último minuto, e a memória é a de agora. No primeiro minuto do agente, a CPU é a dos seus dois primeiros segundos, e 0 antes deles.
- O `agora` é o relógio do agente, em milissegundos UTC.

**Os eventos** — `GET /agente/v1/eventos`, como `text/event-stream` (Server-Sent Events). Cada evento é uma linha `data: <JSON>` seguida de uma linha vazia:
```json
{"tipo": "estado", "agora": 1794495600000, "freeswitch": true, "salas": [ … como no estado … ]}   // o primeiro, e de novo quando o FreeSWITCH cai ou volta
{"tipo": "entrou", "sala": "…", "participante": "…", "tela": false}
{"tipo": "saiu", "sala": "…", "participante": "…", "tela": false}
{"tipo": "acabou", "sala": "…"}                                               // a reunião acabou no FreeSWITCH
{"tipo": "palco", "sala": "<32 hex>", "largura": 1920, "altura": 1080,
 "quadros": [{"participante": "<16 hex>", "tela": false, "x": 0, "y": 0, "l": 960, "a": 540}]}   // o mosaico mudou
{"tipo": "relogio", "agora": 1794495625000}                                   // a cada 25 segundos
```
- O `freeswitch` do `estado` diz se o agente está ligado ao FreeSWITCH. Com ele `false` e sem salas, o chat sabe que o vídeo está fora do ar, e não que ninguém tem reunião.
- O chat deixa essa conexão sempre aberta e, quando ela cai, conecta de novo. O primeiro evento de cada conexão é um `estado`.
- Quando o FreeSWITCH cai, o agente manda um `acabou` para cada sala e depois um `estado` vazio. Quando ele volta, o agente lê as salas que existem e manda um `estado`.
- Um cliente que conecta no meio de uma mudança pode receber o `estado` novo e depois um aviso (`entrou`, `saiu` ou `acabou`) que o `estado` já mostra. O chat trata os avisos como idempotentes.
- O `saiu` vem quando sai a última ligação daquele tipo do participante na sala, a principal ou a tela. A ligação que outra do mesmo participante substituiu (seção 6) sai sem o `saiu`: ele continua na sala.
- Um cliente que não lê é desligado, sem atrasar os outros.
- **O palco** é o desenho do mosaico da sala: o tamanho dele (`largura` e `altura`, em pontos) e o retângulo de cada quadro (`x`, `y`, `l` de largura e `a` de altura, em pontos do mosaico).
  - Os quadros vão nesta ordem: a tela, se houver (com `tela` verdadeiro), e depois as pessoas, pela célula.
  - O agente manda o `palco` só quando ele muda, e só depois de o FreeSWITCH aceitar o tamanho e o layout. Numa entrada, o `entrou` vem antes do `palco`.
  - Ele não leva nomes: só os ids.
  - Quando a última ligação sai, não vem palco: o `acabou` basta. A reconstrução (o agente reiniciou, ou o ESL voltou) não manda o `palco`: o `estado` que vem depois o leva.

**Tirar** — `POST /agente/v1/salas/{sala}/participantes/{participante}/tirar`: `204`. As ligações do participante, a da câmera e a da tela, acabam.

**Encerrar** — `POST /agente/v1/salas/{sala}/encerrar`: `204`. Todas as ligações da sala acabam (`conference <sala> hup all`).

## 6. O SIP
- **O navegador:** `wss://<endereço do vídeo>/sip`, com o subprotocolo `sip`. O endereço leva a porta do agente quando ela não é a 443, como em `wss://video.exemplo.com.br:7443/sip`.
  - O agente só aceita a origem da página: `https://<endereço do chat>`, com a porta quando o chat usa uma. No modo de teste, aceita também as do `--origem`.
  - São até 30 conexões ao mesmo tempo por endereço IP.
  - O agente leva os bytes, sem mexer, ao WebSocket do FreeSWITCH (`127.0.0.1:5066`).
  - A página manda o `Via: SIP/2.0/WS`, também pelo `wss`. O FreeSWITCH lê esse WebSocket sem TLS e não responde, nem com o `100 Trying`, a um `Via` com `WSS`.
  - A mídia é WebRTC (DTLS-SRTP), com o Opus e o VP8.
- **O app (etapa 2):** `sips:reuniao@<endereço do vídeo>:5061;transport=tls`.
  - O SRTP é obrigatório (`AES_CM_128_HMAC_SHA1_80`).
  - Os codecs são o Opus, o PCMU e o PCMA, e o VP8.
- **Toda ligação:**
  - vai para o usuário `reuniao`. A sala vem da senha, e não da URI;
  - leva o cabeçalho `X-Starsonic-Senha: <senha>`;
  - não faz REGISTER: os perfis não aceitam registro.
- **As respostas:**
  - `200`: a ligação entra na reunião;
  - `403`: sem senha, ou com uma senha que não vale;
  - `404`: outro usuário que não o `reuniao`;
  - `503`: o agente não respondeu ao FreeSWITCH.
- **A imagem que chega ao servidor e o mosaico que sai:** as bandas da seção 7.
- **Toda ligação manda som,** também a da tela: o microfone, ou um silêncio gerado quando a pessoa está sem microfone ou com ele desligado.
- **Uma ligação de que nada chega cai sozinha.** O FreeSWITCH olha o que chega no caminho do som e no do vídeo (o `media_timeout` de 60 segundos, que a discagem põe para os dois), e uma ligação em que nada chega a um deles por 60 segundos, nem o RTP, nem o RTCP, nem as verificações do ICE, cai. É assim que sai quem fechou a aba ou perdeu a rede. Um navegador aberto que parou só o som, e continua mandando o RTCP e o ICE, não cai por isso: o FreeSWITCH conta tudo o que chega. O tempo só no caminho do som (o `media_timeout_audio`) não basta: com ele, a ligação de uma aba fechada não caiu em 75 segundos (o e2e mostrou), e é o relógio do caminho do vídeo que chega ao fim. Com a ligação em espera, o prazo é de 10 minutos (o `media_hold_timeout`).
- **Os perfis não têm o timer de sessão:** uma ligação sai pelo BYE, ou pelo tempo sem mídia de cima.
- **A ligação da tela compartilhada** é uma segunda ligação da mesma pessoa, com a senha de `tela` verdadeiro. Ela manda um silêncio gerado no som e a tela no vídeo, os dois só para mandar. Uma tela nova toma o lugar da anterior: o agente derruba a ligação da tela anterior.
- **Cada participante tem uma ligação principal na sala:** a da câmera, que leva o som. O agente segue três regras nos eventos do FreeSWITCH:
  - a ligação da tela de um participante sem a principal na sala cai na hora, sem nenhum comando do mosaico e sem o `entrou`: o quadro grande nunca é dela, e o chat não a vê;
  - quando a última principal de um participante sai da sala, as telas dele caem com ela;
  - uma principal nova toma o lugar da anterior do mesmo participante: o agente derruba a anterior.

  A reconstrução, quando o agente reinicia ou o ESL volta, refaz as salas como estão no FreeSWITCH e não derruba nada. Enquanto ela lê, as três regras esperam.

## 7. A reunião no FreeSWITCH
- **O nome da conferência** é a `sala`, e o perfil é o `starsonic`:
  - o vídeo montado no servidor (`video-mode` `mux`), em VP8, a 25 imagens por segundo (`video-fps` `25`). A conferência começa no layout `starsonic-4`, com o quadro de 1920×1080 e 3 Mbit/s (`video-layout-name` `starsonic-4`, `video-canvas-size` `1920x1080`, `video-codec-bandwidth` `3mb`); depois, quem muda o layout, o tamanho e a banda é o agente;
  - um codificador para todos que usam o mesmo codec (`minimize-video-encoding`);
  - o som a 48 kHz, em pacotes de 20 ms, mono;
  - até 12 ligações: 10 pessoas e duas telas, por um instante, quando uma tela toma o lugar da outra. O limite das 10 pessoas é do chat;
  - sem sons de entrada, de saída ou de espera, e sem os controles por DTMF.
- **Os papéis:**
  - o colega entra sem nada a mais;
  - quem é de fora entra com o `join-only`, e não começa uma reunião sozinho;
  - a tela entra com o `mute|deaf`: não é ouvida e não ouve.
- **A imagem que chega ao servidor:** até 1500 kbit/s na câmera e 2500 kbit/s na tela (o `rtp_video_max_bandwidth_in` que a discagem põe: `1500kb` e `2500kb`).
- **O quadro não leva o nome:** o nome de cada pessoa é da página, que o recebe do chat. A discagem não manda nome nenhum ao FreeSWITCH.
- **Quem está sem câmera** tem o vídeo nos dois sentidos, mas não manda imagem: depois de 5 s sem imagem, o FreeSWITCH põe na célula dela o quadro de `#1B2333`, sem texto, e a imagem que volta o tira. O navegador que só recebe o vídeo (o `recvonly`) fica sem quadro no mosaico. A cor do fundo é `#04060E`.
- **Os layouts:** as medidas são as do FreeSWITCH, num quadro de 360×360 esticado sobre o mosaico: `(x, y, scale[, hscale])`. O `scale` é a largura, e o `hscale`, a altura (o `hscale` falta quando é igual ao `scale`). Em pontos: `x·L/360`, `y·A/360`, `scale·L/360` e `hscale·A/360`, com `L` e `A` do mosaico. Cada imagem tem um `reservation_id`: `c1` a `c12` para as pessoas, e `tela` para a tela. Nenhuma imagem é o "floor", e não há grupo de layouts: o FreeSWITCH não escolhe o layout sozinho.

  | Layout | Pessoas | O mosaico | As imagens, na ordem (a reserva de cada uma) |
  |---|---|---|---|
  | `starsonic-4` | 1 a 4 | 1920×1080 | `c1` (0,0,180), `c2` (180,0,180), `c3` (0,180,180), `c4` (180,180,180) |
  | `starsonic-9` | 5 a 9 | 1920×1086 | `c1` a `c9`: (x,y,120), com y em 0, 120 e 240 e, em cada linha, x em 0, 120 e 240 |
  | `starsonic-12` | 10 a 12 | 1920×810 | `c1` a `c12`: (x,y,90,120), com y em 0, 120 e 240 e, em cada linha, x em 0, 90, 180 e 270 |
  | `starsonic-apresentacao-2` | a tela e 0 a 2 | 1920×1620 | `tela` (0,0,360,240), `c1` (0,240,180,120), `c2` (180,240,180,120) |
  | `starsonic-apresentacao-4` | a tela e 3 ou 4 | 1920×1350 | `tela` (0,0,360,288), `c1` a `c4`: (x,288,90,72), com x em 0, 90, 180 e 270 |
  | `starsonic-apresentacao-12` | a tela e 5 a 12 | 1920×1440 | `tela` (0,0,360,270), `c1` a `c6`: (x,270,60,45), e `c7` a `c12`: (x,315,60,45), com x em 0, 60, 120, 180, 240 e 300 |

- **As células:**
  1. Uma célula é de um participante, de `1` a `12`. Ele a ganha quando a primeira ligação de câmera dele entra: a menor célula livre.
  2. Ele fica com ela enquanto tiver uma ligação de câmera na sala. A ligação nova do mesmo participante recebe a mesma célula, antes de o agente derrubar a anterior.
  3. O layout é o da tabela, pelo número de participantes com câmera e por haver ou não uma ligação de tela.
  4. Quem está numa célula maior que o número de células do layout passa para a menor célula livre dele, na ordem das células.
  5. Vários participantes sem célula ao mesmo tempo (depois da reconstrução) a ganham na ordem do menor `<membro>` de cada um.
  6. Com duas ligações de tela por um instante (uma tela nova toma o lugar da anterior), a tela do palco é a de maior `<membro>`.
- **Os comandos do agente,** a cada entrada e saída, todos com `conference <sala> ` na frente, e nesta ordem:
  1. `vid-res 1920x1086` (só quando o tamanho muda);
  2. `vid-layout starsonic-9` (só quando o layout muda);
  3. `vid-res-id <membro> c5 force`, para cada ligação de câmera que ganhou ou mudou de célula. O `<membro>` é o `Member-ID` do `add-member` (o `id` do `conference json_list`): só dígitos, de 1 a 10. O `force` é preciso: sem ele, repetir a mesma reserva a apaga;
  4. `vid-bandwidth 4mb '' 1` (só quando a banda muda). As aspas vazias e o `1` são precisos: sem o número do mosaico, o comando não muda a banda dele.

  A tela não recebe comando: ela entra com a reserva `tela`, que a discagem põe (`video_reservation_id=tela`).
- **As bandas do mosaico:** `3mb` nos layouts da grade e `4mb` nos da apresentação.
- **Quando um comando falha.** Um comando deu certo quando a resposta começa com `+OK` e nenhuma linha dela começa com `-ERR`. O que deu certo fica guardado. Com o `vid-res` ou o `vid-layout` recusado, o agente para ali, e nenhum palco sai; com o `vid-res-id` ou o `vid-bandwidth` recusado, ele segue. O que um comando recusado deixaria fica desconhecido, e a próxima entrada ou saída o manda de novo. Cada recusa vai ao registro numa linha, só com o nome do comando.
- **A reconstrução,** quando o agente reinicia ou o ESL volta, arruma cada sala do começo, com os quatro comandos, depois de ler o que existe. Enquanto ela lê, o agente não manda nenhum comando do mosaico.

## 8. O que fica guardado e os registros
- **O servidor de vídeo não guarda nada:**
  - sem gravação e sem os módulos de CDR;
  - o banco interno do FreeSWITCH fica em `/run`, e some quando ele reinicia;
  - o agente guarda só na memória quem está em cada sala, pelos ids.
- **Os registros:**
  - do agente: só o método, a rota (o padrão, sem ids), o status, o tempo, as contagens e os códigos de erro;
  - do FreeSWITCH: o console no nível `warning`, para o journal, sem arquivo de log;
  - do coturn: o syslog (o journal), a única exceção à regra de baixo, porque ele pode levar o usuário do TURN (`<vence>:<participante>`), que é só um vencimento e o id sorteado do participante, nunca um nome, um número de telefone ou o código de um link;
  - nunca a chave, uma senha, um nome, um número de telefone, o código de um link, uma sala ou um participante.
