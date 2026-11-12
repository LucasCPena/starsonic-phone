# O servidor de vídeo das reuniões: o contrato do agente

O servidor de vídeo é uma VM com o FreeSWITCH (o mosaico, o som, o SIP e o WebRTC), o coturn (o TURN) e o nosso agente de vídeo (`starsonic-video`, em Go). O servidor do chat cuida das reuniões (`docs/chat-protocolo.md`, seções 9 a 12) e fala com o agente. A spec é `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`.

## 1. As portas
| Porta | Quem escuta | Para quê |
|---|---|---|
| TCP 443, em toda a VM | o agente (TLS do Let's Encrypt) | o `/sip` do navegador (seção 6) e a API do chat em `/agente/v1/` (seção 5) |
| TCP 80, em toda a VM | o certbot, só na hora de tirar ou renovar o certificado | o desafio do Let's Encrypt |
| TCP 5061, no IP da VM | o FreeSWITCH (o perfil `tls`) | o SIP sobre TLS do app |
| UDP 3478, no IP da VM | o coturn | o TURN |
| TCP 5349, no IP da VM | o coturn | o TURN sobre TLS |
| UDP 16384 a 16683 | o FreeSWITCH | a mídia (300 portas) |
| UDP 49152 a 49451 | o coturn | o relay do TURN (300 portas) |
| TCP 127.0.0.1:5066 | o FreeSWITCH (o perfil `navegador`) | o WebSocket do SIP, que só o agente alcança |
| TCP 127.0.0.1:5070 | o FreeSWITCH (o perfil `navegador`) | o SIP comum do perfil, sem uso de fora |
| TCP 127.0.0.1:8021 | o FreeSWITCH | o ESL (o `mod_event_socket`), com a senha do ESL |
| TCP 127.0.0.1:8091 | o agente | a discagem (o `mod_xml_curl`) |

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
Tudo vai em HTTPS, na 443 do servidor de vídeo, com `Authorization: Bearer <chave>`, menos o `saude`. As respostas são JSON. Um erro vem como `{"erro": "<código>"}`.

| Status | `erro` | Quando |
|---|---|---|
| 400 | `invalido` | A `sala` não tem 32 caracteres hexadecimais minúsculos, ou o `participante` não tem 16. |
| 401 | `chave` | Sem a chave, ou com outra. |
| 404 | `naoEncontrado` | A sala ou o participante não estão no FreeSWITCH. |
| 503 | `freeswitch` | O agente está sem a ligação com o FreeSWITCH (o ESL). |

**A saúde** — `GET /agente/v1/saude`, sem chave: `200` `{"ok": true}`.

**O estado** — `GET /agente/v1/estado`:
```json
{"versao": "0.1.0", "freeswitch": true, "agora": 1794495600000,
 "salas": [{"sala": "<32 hex>", "participantes": [{"participante": "<16 hex>", "tela": false}]}],
 "uso": {"cpu": 34, "memoria": 41}}
```
- Cada ligação aparece uma vez em `participantes`: a da câmera, com `tela` falso, e a da tela, com `tela` verdadeiro.
- O `uso` vem em porcentagem inteira. A CPU é a do último minuto, e a memória é a de agora.
- O `agora` é o relógio do agente, em milissegundos UTC.

**Os eventos** — `GET /agente/v1/eventos`, como `text/event-stream` (Server-Sent Events). Cada evento é uma linha `data: <JSON>` seguida de uma linha vazia:
```json
{"tipo": "estado", "agora": 1794495600000, "salas": [ … como no estado … ]}   // o primeiro, e de novo quando o FreeSWITCH cai ou volta
{"tipo": "entrou", "sala": "…", "participante": "…", "tela": false}
{"tipo": "saiu", "sala": "…", "participante": "…", "tela": false}
{"tipo": "acabou", "sala": "…"}                                               // a reunião acabou no FreeSWITCH
{"tipo": "relogio", "agora": 1794495625000}                                   // a cada 25 segundos
```
- O chat deixa essa conexão sempre aberta e, quando ela cai, conecta de novo. O primeiro evento de cada conexão é um `estado`.
- Quando o FreeSWITCH cai, o agente manda um `acabou` para cada sala e depois um `estado` vazio. Quando ele volta, o agente lê as salas que existem e manda um `estado`.
- Um cliente que não lê é desligado, sem atrasar os outros.

**Tirar** — `POST /agente/v1/salas/{sala}/participantes/{participante}/tirar`: `204`. As ligações do participante, a da câmera e a da tela, acabam.

**Encerrar** — `POST /agente/v1/salas/{sala}/encerrar`: `204`. Todas as ligações da sala acabam (`conference <sala> hup all`).

## 6. O SIP
- **O navegador:** `wss://<endereço do vídeo>/sip`, com o subprotocolo `sip`.
  - O agente só aceita a origem da página: `https://<endereço do chat>`, com a porta quando o chat usa uma. No modo de teste, aceita também as do `--origem`.
  - São até 30 conexões ao mesmo tempo por endereço IP.
  - O agente leva os bytes, sem mexer, ao WebSocket do FreeSWITCH (`127.0.0.1:5066`).
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
- **A imagem que chega ao servidor:** até 1 Mbit/s, pedido no SDP da resposta (`b=AS:1000`). O mosaico que sai é de cerca de 1,5 Mbit/s.
- **Toda ligação manda som,** também a da tela: o microfone, ou um silêncio gerado quando a pessoa está sem microfone ou com ele desligado. O FreeSWITCH olha o som que chega: uma ligação sem RTP de som por 60 segundos cai sozinha, e é assim que sai quem fechou a aba ou perdeu a rede.
- **A ligação da tela compartilhada** é uma segunda ligação da mesma pessoa, com a senha de `tela` verdadeiro. Ela manda um silêncio gerado no som e a tela no vídeo, os dois só para mandar. Uma tela nova toma o lugar da anterior: o agente derruba a ligação da tela anterior.

## 7. A reunião no FreeSWITCH
- **O nome da conferência** é a `sala`, e o perfil é o `starsonic`:
  - o vídeo montado no servidor (`video-mode` `mux`), com o quadro de 1280×720 a 15 imagens por segundo, em VP8, com 1,5 Mbit/s (`video-codec-bandwidth` `1.5mb`);
  - um codificador para todos que usam o mesmo codec (`minimize-video-encoding`);
  - o som a 48 kHz, em pacotes de 20 ms, mono;
  - até 12 ligações: 10 pessoas e duas telas, por um instante, quando uma tela toma o lugar da outra. O limite das 10 pessoas é do chat;
  - sem sons de entrada, de saída ou de espera, e sem os controles por DTMF.
- **Os papéis:**
  - o colega entra sem nada a mais;
  - quem é de fora entra com o `join-only`, e não começa uma reunião sozinho;
  - a tela entra com o `mute|deaf`: não é ouvida e não ouve.
- **O nome no quadro** é o `video_banner_text`: `{font_scale=0.25,min_font_size=8,max_font_size=20,fg=#FFFFFF,bg=#04060E}<nome>`, na faixa de baixo do quadro. O nome passa antes por uma limpeza:
  - ficam só as letras, as marcas de acento, os números, o espaço e os sinais `.`, `-`, `'`, `(` e `)`;
  - os espaços seguidos viram um, e as pontas saem;
  - ficam no máximo 40 caracteres;
  - um nome que fica vazio vira `Convidado`.

  A tela leva `Tela de <nome>`.
- **Quem está sem câmera** (o navegador só recebe o vídeo) ganha o quadro de `#1B2333`, com o nome. As cores do fundo e das faixas são `#04060E`.
- **Os layouts:** as medidas são as do FreeSWITCH, num quadro de 360×360 esticado sobre os 1280×720. O `scale` é a largura, e o `hscale`, a altura (o `hscale` falta quando é igual ao `scale`). Nenhum quadro é o "floor": cada pessoa fica no seu lugar enquanto fala.

  | Layout | Para | Os quadros (`x`,`y`,`scale`[,`hscale`]) |
  |---|---|---|
  | `starsonic-1` | 1 pessoa | (0,0,360) |
  | `starsonic-2` | 2 | (0,90,180), (180,90,180) |
  | `starsonic-4` | 3 e 4 | (0,0,180), (180,0,180), (0,180,180), (180,180,180) |
  | `starsonic-6` | 5 e 6 | (0,60,120), (120,60,120), (240,60,120), (0,180,120), (120,180,120), (240,180,120) |
  | `starsonic-9` | 7 a 9 | os 9 de (x,y,120), com x e y em 0, 120 e 240, linha por linha |
  | `starsonic-12` | 10 | os 12 de (x,y,90,120), com x em 0, 90, 180 e 270 e y em 0, 120 e 240, linha por linha |
  | `starsonic-apresentacao` | a tela compartilhada | a tela em (0,0,300), com o `reservation_id` `tela`; as pessoas em (300,0,60), (300,60,60), (300,120,60), (300,180,60), (300,240,60), (300,300,60), (60,300,60), (120,300,60), (180,300,60), (240,300,60) |

  O grupo `starsonic-grade` tem os seis primeiros, nessa ordem, e é o layout da reunião sem tela. Quando a ligação de uma tela entra, o agente põe o `starsonic-apresentacao`. Quando a última tela sai, ele volta ao grupo.

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
