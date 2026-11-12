# Chat do Starsonic Phone — o protocolo da API (v1)

O contrato entre o app e o servidor do chat (`chat-servidor/`). A spec é `docs/superpowers/specs/2026-11-04-starsonic-phone-chat-design.md`. Este arquivo diz os nomes, os campos e os erros exatos. O servidor (etapa 1) e o app (etapa 2) seguem este arquivo, e uma mudança aqui muda os dois.

## 1. O básico
- **O endereço:** `https://<endereço do chat>/api/v1`, por exemplo `https://chat.starsonic.com.br/api/v1`. No modo de teste: `http://127.0.0.1:<porta>/api/v1`.
  - As origens do CORS, no modo de teste, são as do `--origem`; sem nenhuma, vale a do app.
  - Quando o servidor fica atrás de um roteador que traduz outra porta pública para a 443 dele (NAT), o endereço leva essa porta, por exemplo `https://chat.exemplo.com.br:8443/api/v1`. O app aceita o endereço com porta e usa a mesma porta no WebSocket (`wss://chat.exemplo.com.br:8443/api/v1/eventos`).
- **O formato:** JSON em UTF-8 (`Content-Type: application/json; charset=utf-8`), menos no envio e no download de arquivos (seção 6).
- **As horas:** milissegundos desde 1970 (UTC), num número inteiro.
- **Os ids:**
  - empresa, pessoa, conversa e mensagem são números inteiros;
  - o id de um arquivo é um texto de 32 caracteres hexadecimais.
- **A chave do computador** vai no cabeçalho `Authorization: Bearer <chave>`. Só o `POST /api/v1/computadores` e o WebSocket (seção 7) não usam o cabeçalho.
- **A empresa vem sempre da chave.** Nenhuma operação recebe o id de uma empresa. Um id de outra empresa responde igual a um id que não existe: `404 naoEncontrado`.
- **A pessoa da vez:** cada computador age como a última pessoa que entrou nele (`POST /api/v1/pessoas/eu`). Uma operação que precisa da pessoa, num computador onde ninguém entrou ainda, responde `409 pessoa`.
- **O CORS:**
  - a API aceita pedidos do navegador só da origem do app (`https://app.starsonic.local`, ou as `origens` da configuração);
  - os métodos aceitos são `GET`, `POST`, `PUT` e `DELETE`;
  - os cabeçalhos aceitos são `Authorization`, `Content-Type` e `X-Arquivo-Nome`;
  - a resposta ao `OPTIONS` vem com o `Access-Control-Max-Age: 600`.
- **O tamanho do pedido:** o corpo em JSON tem até 64 KiB. Um corpo maior responde `413 grande`.

## 2. Os erros
Um erro vem com o status HTTP e um corpo `{"erro": "<código>"}`, às vezes com mais campos.

| Status | `erro` | Quando |
|---|---|---|
| 400 | `invalido` | Um campo faltou ou veio fora da regra. Vem com `"campo": "<nome>"`. Só um JSON que não dá para ler vem sem campo. |
| 401 | `chave` | Sem chave, chave desconhecida, ou o computador saiu do chat (foi tirado, a pessoa foi tirada, a empresa foi apagada ou ele desligou). O app mostra "Este computador saiu do chat…". |
| 403 | `proibido` | Só quem cuida do grupo pode fazer isso, ou a origem do WebSocket não está na lista. |
| 403 | `outraEmpresa` | O link da reunião é de outra empresa (seção 9). |
| 403 | `semReunioes` | A empresa está sem as reuniões liberadas. |
| 404 | `codigo` | O código da empresa não existe (só no `POST /api/v1/computadores`). |
| 404 | `naoEncontrado` | O id não existe, é de outra empresa, ou a pessoa não está na conversa. |
| 409 | `pessoa` | Ninguém entrou neste computador ainda (seção 4). |
| 409 | `grupoCheio` | O grupo passaria de 200 pessoas. |
| 409 | `cheia` | A reunião já tem 10 pessoas. |
| 409 | `servidorCheio` | O servidor de vídeo está no limite de reuniões ao mesmo tempo. |
| 409 | `jaRespondido` | O pedido para entrar já foi respondido, retirado ou venceu. |
| 409 | `foraDaReuniao` | A pessoa não está na reunião. |
| 409 | `muitasReunioes` | A pessoa já tem 100 reuniões marcadas que ainda valem. |
| 410 | `expirado` | O arquivo passou de 365 dias e saiu do servidor. |
| 413 | `grande` | O arquivo passa de 25 MB, a miniatura passa de 200 KiB, ou o JSON passa de 64 KiB. |
| 429 | `tentativas` | Muitos códigos errados deste endereço. Vem com `"esperarSegundos": <n>`. |
| 429 | `limite` | Pedidos, mensagens ou arquivos demais deste computador. Vem com `"esperarSegundos": <n>`. |
| 500 | `servidor` | Um erro do servidor. O pedido pode ser tentado de novo. |
| 503 | `servidorVideo` | O servidor de vídeo não foi configurado ou não respondeu. O app e a página mostram "O servidor de reuniões não respondeu". |

## 3. As regras dos campos
- **O código da empresa:**
  - o formato é `STAR-XXXX-XXXX`, em que cada X é um destes 30 caracteres: `ABCDEFGHJKMNPQRSTVWXYZ23456789`. Ficam de fora o I, o L, o O, o U, o 0 e o 1;
  - ao receber, o servidor passa o código para maiúsculas e tira os espaços e os hífens. Depois disso, ele tem de ser `STAR` seguido de 8 desses caracteres. Assim, `star 7kq4 9xwp` vale o mesmo que `STAR-7KQ4-9XWP`;
  - um código fora desse formato conta como errado (`404 codigo`).
- **O ramal:** sem os espaços das pontas, tem de 1 a 32 caracteres, sem espaço, tab, `@`, `:` nem caracteres de controle.
- **O nome de uma pessoa:** sem os espaços das pontas, tem de 1 a 80 caracteres, sem caracteres de controle.
- **O nome do computador:** sem os espaços das pontas, tem de 1 a 64 caracteres, sem caracteres de controle.
- **O nome de um grupo:** sem os espaços das pontas, tem de 1 a 60 caracteres, sem caracteres de controle.
- **O texto de uma mensagem:**
  - tem de 1 a 4.000 caracteres, contados como pontos de código Unicode, como o `[...texto].length` do JavaScript;
  - não pode ser só de espaços;
  - as quebras de linha valem. O servidor troca `\r\n` e `\r` por `\n`;
  - os outros caracteres de controle não valem.
- **O `idLocal`:** um texto de 1 a 64 caracteres (`[A-Za-z0-9-]`), gerado pelo app para cada mensagem.
  - Ele é único por pessoa, em todas as conversas dela, e não por conversa: o mesmo `idLocal` mandado de novo, mesmo para outra conversa, devolve a mensagem que já foi gravada com ele.
  - O app o gera ao acaso, por exemplo um UUID. Nunca use um contador por computador: dois computadores da mesma pessoa repetiriam os mesmos números, e um engoliria as mensagens do outro.
- **O nome de um arquivo**, ao ser guardado:
  - fica só a parte depois da última `/` ou `\`;
  - saem os caracteres de controle e `: * ? " < > |`, e os pontos e espaços das pontas;
  - fica com até 120 caracteres, mantendo a extensão;
  - se ficar vazio, vira `arquivo`.
- **O tipo de um arquivo:** é o `Content-Type` do envio, se for um tipo MIME bem formado; se não, `application/octet-stream`. Os tipos `image/jpeg`, `image/png`, `image/gif` e `image/webp` são as fotos.

## 4. Os objetos
```json
// Pessoa
{"id": 12, "ramal": "2003", "nome": "Ana Souza", "saiu": false}

// Arquivo
{"id": "9f1c…(32 hex)", "nome": "Proposta ACME.pdf", "tipo": "application/pdf", "tamanho": 1258291,
 "foto": false, "miniatura": false, "expirado": false}

// Mensagem
{"id": 123, "conversa": 7, "autor": <Pessoa ou null>, "tipo": "texto" | "arquivo" | "aviso",
 "texto": "…",                                  // só no tipo texto
 "arquivo": <Arquivo>,                           // só no tipo arquivo
 "aviso": {"acao": "criou" | "pos" | "tirou" | "saiu", "quem": <Pessoa>, "alvo": <Pessoa ou null>},  // só no tipo aviso
 "idLocal": "…" ou null, "criadaEm": 1793790000000}

// Conversa
{"id": 7, "tipo": "dupla" | "grupo",
 "com": <Pessoa>,                                // só na dupla: a outra pessoa
 "nome": "Comercial", "pessoas": 5, "cuida": true,  // só no grupo; cuida: se eu cuido do grupo
 "ultima": <Mensagem ou null>, "naoLidas": 2, "atualizadaEm": 1793790000000}
```
- No aviso, `quem` é quem fez:
  - `criou`: criou o grupo;
  - `pos`: pôs o `alvo` no grupo;
  - `tirou`: tirou o `alvo` do grupo;
  - `saiu`: saiu do grupo, e o `alvo` é `null`.
- Uma pessoa tirada do chat aparece com `"saiu": true`, e o app mostra o nome dela com "(saiu)".
- **`naoLidas`:** conta as mensagens da conversa depois da última lida pela pessoa. Não entram as mensagens dela mesma, os avisos nem as mensagens de antes de ela entrar.
- **A ordem da lista:** a conversa com o `atualizadaEm` mais novo vem primeiro. Esse é o `criadaEm` da última mensagem, ou a criação da conversa.

## 5. As operações
**Ligar o computador** — `POST /api/v1/computadores`, sem chave.
- Corpo: `{"codigo": "STAR-7KQ4-9XWP", "computador": "RECEPCAO-01"}`.
- `201`: `{"chave": "<43 caracteres base64url>", "empresa": {"nome": "ACME Comércio Ltda"}}`. A chave aparece só aqui.
- Erros:
  - `404 codigo`, que conta uma tentativa errada;
  - `429 tentativas`: depois de 10 erradas na mesma hora, deste endereço, ele espera 1 hora;
  - `400 invalido`.

**Desligar o computador** — `DELETE /api/v1/computadores/eu`.
- `204`. A chave deixa de valer, e o WebSocket do computador fecha.

**Entrar como pessoa** — `POST /api/v1/pessoas/eu`.
- Corpo: `{"ramal": "2001", "nome": "Recepção"}`.
- `200`: `{"pessoa": <Pessoa>}`.
- O que muda no servidor:
  - a pessoa ativa da empresa com esse ramal é atualizada, com o nome novo. Se não houver, uma pessoa nova é criada;
  - uma pessoa tirada nunca volta: o mesmo ramal vira uma pessoa nova;
  - o computador passa a agir como essa pessoa.
- **O computador novo:** se for a primeira vez dessa pessoa neste computador e ela já tiver outro computador ativo, os outros recebem o evento `computadorNovo` (seção 7).

**Os colegas** — `GET /api/v1/pessoas`.
- `200`: `{"pessoas": [<Pessoa>…]}`. São as pessoas ativas da empresa, menos a da vez, em ordem de nome, sem acento e sem caixa.

**As conversas** — `GET /api/v1/conversas`.
- `200`: `{"conversas": [<Conversa>…]}`. São as conversas a dois da pessoa e os grupos em que ela está, na ordem da seção 4.

**Criar uma conversa** — `POST /api/v1/conversas`.
- **A dupla:** `{"tipo": "dupla", "com": <id da pessoa>}`.
  - Responde `200` com a dupla que já existe, ou `201` com uma nova: `{"conversa": <Conversa>}`.
  - Ela é uma só por par de pessoas.
  - Com a própria pessoa, ou com uma que saiu, responde `400 invalido` (`campo: "com"`).
- **O grupo:** `{"tipo": "grupo", "nome": "Financeiro", "pessoas": [<ids>]}`.
  - Responde `201` com `{"conversa": <Conversa>}`.
  - Quem cria cuida do grupo e entra nele.
  - A conversa ganha o aviso `criou` e um aviso `pos` para cada pessoa posta.
  - Com mais de 199 pessoas na lista (mais quem cria), responde `409 grupoCheio`.
  - Sem nenhuma outra pessoa na lista, responde `400 invalido` (`campo: "pessoas"`).
  - Um id que não é de uma pessoa ativa da empresa responde `404 naoEncontrado`.

**Os membros** — `GET /api/v1/conversas/{id}/membros`, só para um grupo.
- `200`: `{"membros": [{"pessoa": <Pessoa>, "cuida": true, "criou": true}…]}`. Quem cuida vem primeiro, e o resto em ordem de nome.

**Pôr pessoas** — `POST /api/v1/conversas/{id}/membros`, com o corpo `{"pessoas": [<ids>]}`.
- Responde `204`.
- Só quem cuida do grupo pode pôr (`403 proibido`).
- Cada pessoa posta gera um aviso `pos`. Quem já estava no grupo é ignorado.
- O limite é o do grupo (`409 grupoCheio`).

**Tirar uma pessoa ou sair** — `DELETE /api/v1/conversas/{id}/membros/{idPessoa}`.
- Responde `204`.
- Para tirar outra pessoa, só quem cuida do grupo (`403 proibido`). Para sair, cada um tira a si mesmo.
- A conversa ganha o aviso `tirou` ou `saiu`.
- Se quem cuida sair, passa a cuidar a pessoa que está no grupo há mais tempo; num empate, a de menor id.

**As mensagens** — `GET /api/v1/conversas/{id}/mensagens?antes=<id>&depois=<id>&limite=<n>`.
- Responde `200`: `{"mensagens": [<Mensagem>…], "temMais": true}`. As mensagens vêm da mais antiga para a mais nova.
- O `limite` tem de 1 a 50, e 50 se faltar.
- **Sem `antes` nem `depois`:** vêm as mais novas.
- **Com `antes`:** vêm as anteriores a essa mensagem, e `temMais` diz se há mais antigas.
- **Com `depois`:** vêm as seguintes, e `temMais` diz se há mais novas.
- A pessoa só vê as mensagens a partir da última vez que entrou na conversa.

**Enviar** — `POST /api/v1/conversas/{id}/mensagens`.
- Corpo: `{"idLocal": "…", "texto": "…"}` ou `{"idLocal": "…", "arquivo": "<id do arquivo>"}`.
- Responde `201` com `{"mensagem": <Mensagem>}`.
- **O mesmo `idLocal`** da mesma pessoa responde `200` com a mesma mensagem, sem criar outra.
- **O arquivo** tem de ter sido enviado por essa pessoa, não pode ter expirado e não pode estar em outra mensagem. Se não, responde `400 invalido` (`campo: "arquivo"`).
- **O limite:** 60 mensagens por minuto por computador (`429 limite`).

**Marcar como lida** — `POST /api/v1/conversas/{id}/lida`, com o corpo `{"ate": <id da mensagem>}`.
- Responde `204`.
- A leitura só avança: um `ate` menor que o já lido não muda nada.
- Os outros computadores da mesma pessoa recebem o evento `lida`.

## 6. Os arquivos
**Enviar** — `POST /api/v1/arquivos`.
- O corpo são os bytes do arquivo.
- O `Content-Type` diz o tipo, e o `X-Arquivo-Nome` diz o nome, em UTF-8 com percent-encoding.
- Responde `201` com `{"arquivo": <Arquivo>}`.
- **Os limites:**
  - até 25 MB (26.214.400 bytes): um arquivo maior responde `413 grande`, sem guardar nada;
  - 200 MB por hora por computador (`429 limite`);
  - cada arquivo conta pelo menos 64 KiB (65.536 bytes) nos 200 MB da hora;
  - um envio sem Content-Length conta 25 MB até terminar e depois só o que chegou (o app manda sempre o Content-Length).
- Um envio cortado no meio não deixa nada, nem no disco nem no banco.
- Um arquivo que não entrou numa mensagem em 24 horas sai do servidor.

**A miniatura** — `PUT /api/v1/arquivos/{id}/miniatura`.
- O corpo é um JPEG de até 200 KiB (`413 grande`).
- Só quem enviou o arquivo pode mandar, e só se o arquivo for uma foto (`400 invalido`).
- Um arquivo expirado responde `410 expirado`.
- Responde `204`.

**Baixar** — `GET /api/v1/arquivos/{id}`.
- Responde `200` com os bytes e estes cabeçalhos:
  - `Content-Type: application/octet-stream`;
  - `Content-Disposition: attachment; filename="<nome em ASCII>"; filename*=UTF-8''<nome em percent-encoding>`;
  - `X-Content-Type-Options: nosniff`;
  - `Cache-Control: private, no-store`.
- Só baixa quem enviou o arquivo ou quem está numa conversa em que ele foi enviado (`404 naoEncontrado`).
- Um arquivo expirado responde `410 expirado`.

**Baixar a miniatura** — `GET /api/v1/arquivos/{id}/miniatura`.
- Responde `200` com `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff` e `Cache-Control: private, max-age=86400`.
- As regras de quem baixa são as mesmas. Sem miniatura, responde `404 naoEncontrado`.

## 7. Os eventos (WebSocket)
1. **O bilhete:** `POST /api/v1/eventos/bilhete`, com a chave.
   - Responde `200`: `{"bilhete": "<43 caracteres base64url>"}`.
   - O bilhete vale uma vez só, por 30 segundos.
2. **A conexão:** `GET /api/v1/eventos?bilhete=<bilhete>`, como WebSocket. A origem tem de ser uma das origens do CORS. Um bilhete inválido responde `401 chave`, sem WebSocket. Uma origem fora da lista responde `403 proibido`, sem WebSocket, e o bilhete continua valendo.
3. **Um computador tem uma conexão só.** Uma nova fecha a anterior, com o código `4000`.
4. **O servidor manda um ping a cada 25 segundos.** Sem resposta em 60 segundos, ele fecha a conexão.
5. **Um computador lento é desligado.** Se 512 eventos estiverem esperando para um computador, o servidor fecha a conexão dele com o código `4002`. Com a rede cheia, o código `4002` pode não chegar, e o app vê a conexão cair; nos dois casos, ele reconecta e busca o que perdeu com o `depois`.
6. **Quando o servidor desliga,** ele fecha a conexão com o código `1001`; o app reconecta e busca o que perdeu com o `depois`.

Os eventos são mensagens de texto com JSON, sempre com o campo `tipo`:
```json
{"tipo": "mensagem", "mensagem": <Mensagem>}          // a quem está na conversa, também a quem enviou
{"tipo": "lida", "conversa": 7, "ate": 123}            // aos outros computadores da mesma pessoa
{"tipo": "conversa", "conversa": <Conversa>}           // conversa nova ou membros mudados, a cada membro (com o naoLidas dele)
{"tipo": "conversaSaiu", "conversa": 7}                // a quem foi tirado ou saiu do grupo
{"tipo": "computadorNovo", "computador": "RECEPCAO-02"} // aos outros computadores da mesma pessoa
{"tipo": "fora"}                                        // este computador saiu do chat; depois o servidor fecha com 4001
```
- Os eventos de uma pessoa vão para os computadores que agem como ela na hora.
- O servidor nunca manda um evento de uma empresa para um computador de outra.

## 8. Os limites, juntos
| O quê | Quanto |
|---|---|
| Texto de uma mensagem | 4.000 caracteres |
| Arquivo | 25 MB (26.214.400 bytes) |
| Miniatura | 200 KiB, JPEG |
| Pessoas num grupo | 200, com quem cuida |
| Nome de um grupo | 60 caracteres |
| Pedidos por computador | 600 por minuto, em todo pedido com chave |
| Entradas de pessoa por computador | 20 por minuto, no `POST /api/v1/pessoas/eu`, além dos 600 |
| Mensagens por computador | 60 por minuto |
| Arquivos por computador | 200 MB por hora |
| Códigos errados por endereço | 10 por hora; depois, 1 hora de espera |
| Mensagens por pedido | 50 |
| Arquivo guardado | 365 dias |
| Corpo JSON | 64 KiB |

**Os pedidos por computador.**
- Todo pedido que leva a chave do computador conta nos 600 por minuto, seja qual for a rota (o `GET /api/v1/eventos`, que entra com o bilhete, não leva a chave e não conta).
- O `POST /api/v1/pessoas/eu` conta também nos 20 por minuto.
- Acima de um limite, a resposta é `429` com `{"erro": "limite", "esperarSegundos": <n>}`. O app espera esse tempo e tenta de novo.
- Esses limites valem junto com os de mensagens e de arquivos.

## 9. As reuniões (o app)
As reuniões com link moram no servidor do chat; o vídeo e o som vão direto para o servidor de vídeo (`docs/video-agente.md`). A spec é `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`.

**O código e o link.**
- O código tem 10 caracteres do alfabeto `abcdefghjkmnpqrstvwxyz23456789`: o mesmo do código da empresa, em minúsculas (30 caracteres, cerca de 49 bits).
- O link é `https://<endereço do chat>/r/<código>`, com a porta quando o chat usa uma: `https://chat.exemplo.com.br:8443/r/k7q49xwpht`.
- Ao receber, o servidor passa o código para minúsculas e tira os espaços. Depois disso, ele tem de ter exatamente 10 caracteres do alfabeto. Fora disso, é um código que não existe (`404 naoEncontrado`), e o pedido conta nas tentativas.

**A Reunião.**
```json
{"codigo": "k7q49xwpht", "link": "https://chat.exemplo.com.br/r/k7q49xwpht",
 "tipo": "marcada" | "naHora",
 "assunto": "Planejamento" | null,
 "inicio": 1794495600000 | null,      // só na marcada
 "valeAte": 1794538799999 | null,     // na marcada; a naHora vale até acabar
 "criouEu": true,
 "acontecendo": false,                 // alguém está nela agora
 "pessoas": 0}                         // quantas pessoas estão nela agora, sem contar a tela compartilhada
```

**As regras.**
- **O `assunto`:** opcional. Sem os espaços das pontas, tem de 1 a 120 caracteres, sem caracteres de controle. Vazio vale `null`.
- **O `inicio`:** obrigatório na marcada, em milissegundos UTC.
- **O `valeAte`:**
  - opcional. Sem ele, a reunião vale até 23:59:59,999 do dia do `inicio`, no horário de Brasília (`America/Sao_Paulo`);
  - tem de ser depois do `inicio` e depois de agora, e no máximo 31 dias depois do `inicio`.
- **Uma reunião vale quando** não foi cancelada e:
  - a marcada (e a de teste, seção 10): até o `valeAte`;
  - a naHora: até acabar.
- **Uma reunião que está acontecendo continua depois do `valeAte`:** quem está nela fica, mas ninguém novo entra.
- **Cada pessoa tem até 100 reuniões marcadas que ainda valem** (`409 muitasReunioes`).
- **A empresa precisa ter as reuniões liberadas** na administração. Sem isso, as rotas desta seção respondem `403 semReunioes`, e a página não abre os links dela (`404 naoEncontrado`).
- **Quem está na reunião:** é a pessoa cujo computador chamou o `entrar` e cuja ligação com a câmera o servidor de vídeo diz que entrou e ainda não saiu.

**As operações.** Todas levam a chave do computador e precisam da pessoa da vez (`409 pessoa`).

**Criar uma reunião marcada** — `POST /api/v1/reunioes`.
- Corpo: `{"assunto": "Planejamento", "inicio": 1794495600000, "valeAte": 1794538799999}`, com o `assunto` e o `valeAte` opcionais.
- `201`: `{"reuniao": <Reunião>}`.
- Erros: `400 invalido` (`campo` igual a `assunto`, `inicio` ou `valeAte`), `403 semReunioes` e `409 muitasReunioes`.

**As minhas reuniões** — `GET /api/v1/reunioes`.
- `200`: `{"reunioes": [<Reunião>…]}`: as marcadas que a pessoa criou e que ainda valem, pelo `inicio`, da mais cedo para a mais tarde.

**Cancelar** — `DELETE /api/v1/reunioes/{codigo}`.
- `204`. Só quem criou cancela (`403 proibido`). Um código de outra empresa, ou que não existe, responde `404 naoEncontrado`.
- O link para de valer na hora. Se a reunião está acontecendo, o servidor a encerra no servidor de vídeo, e todos saem. Quem espera na página recebe `linkInvalido`.

**Gerar link (a reunião na hora)** — `POST /api/v1/reunioes/agora`.
- Corpo: `{"ramais": ["2003", "2004"]}`: os colegas que estão na chamada. É opcional, com até 9 ramais.
- `201`: `{"reuniao": <Reunião>}`, com o `tipo` igual a `naHora`.
- Os computadores conectados das pessoas ativas da mesma empresa com esses ramais recebem o evento `reuniaoAgora` (seção 11). Um ramal que não é de ninguém é ignorado.
- A naHora acaba quando fica vazia, com o Encerrar para todos, ou 10 minutos depois de criada se ninguém entrou nela.

**Entrar** — `POST /api/v1/reunioes/{codigo}/entrar`.
- `200`: o Acesso, abaixo, com a `reuniao`.
- **Um colega da mesma empresa** entra direto. Uma reunião parada começa.
- **Os erros:**
  - `404 naoEncontrado`: o código não existe ou a reunião não vale;
  - `403 outraEmpresa`: o link é de outra empresa. O app abre o link no navegador, onde a pessoa passa pela sala de espera;
  - `403 semReunioes`;
  - `409 cheia`: a reunião já tem 10 pessoas;
  - `409 servidorCheio`: a reunião está parada e o servidor de vídeo já está no limite de reuniões ao mesmo tempo;
  - `503 servidorVideo`: o servidor de vídeo não foi configurado ou não respondeu;
  - `429 tentativas`, com `esperarSegundos`: passou de 20 por minuto deste endereço, contando todo `entrar` e todo abrir da página (seção 10).

**O Acesso.**
```json
{"participante": "0011223344556677",
 "senha": "<a senha de uso único: 30 segundos, uma vez só>",
 "turn": {"urls": ["turn:video.exemplo.com.br:3478?transport=udp", "turns:video.exemplo.com.br:5349?transport=tcp"],
          "usuario": "1794538800:0011223344556677", "senha": "lTe50TxrbuhEaWJVPhFLOGOJYRI="},
 "video": {"wss": "wss://video.exemplo.com.br/sip",
           "uri": "sip:reuniao@video.exemplo.com.br",
           "sip": "sips:reuniao@video.exemplo.com.br:5061;transport=tls"},
 "reuniao": <Reunião>}
```
- O `participante` é um id de 16 caracteres hexadecimais, novo a cada entrada.
- A `senha` e o `turn` seguem o `docs/video-agente.md`. As credenciais do TURN valem 12 horas.
- O navegador usa o `wss` e a `uri`, e o app usa o `sip`.
- Uma senha que venceu antes da ligação (a pessoa demorou) se resolve com outro `entrar`, que dá um participante novo.

**Com a pessoa na reunião.** Estas rotas pedem que a pessoa da vez esteja na reunião (seção 9, "Quem está na reunião"). Se ela não está, respondem `409 foraDaReuniao`. Um código de outra empresa responde `404 naoEncontrado`.
- **`GET /api/v1/reunioes/{codigo}/participantes`:** `200` `{"participantes": [<Participante>…], "pedidos": [<Pedido>…]}`.
- **`POST /api/v1/reunioes/{codigo}/aceitar`,** com `{"pedido": "<id>"}`:
  - responde `204`;
  - vale a primeira resposta que chega ao servidor: um pedido já aceito, recusado, retirado ou vencido responde `409 jaRespondido`;
  - um pedido que não existe responde `404 naoEncontrado`;
  - com a reunião cheia, responde `409 cheia`, e o pedido continua esperando.
- **`POST /api/v1/reunioes/{codigo}/recusar`,** com `{"pedido": "<id>"}`: `204`, ou `409 jaRespondido` e `404 naoEncontrado` como acima.
- **`POST /api/v1/reunioes/{codigo}/tirar`,** com `{"participante": "<id>"}`:
  - responde `204`;
  - o participante sai, com a câmera e com a tela, e a página dele recebe `tirado`;
  - um participante que não está na reunião responde `404 naoEncontrado`.
- **`POST /api/v1/reunioes/{codigo}/encerrar`:**
  - responde `204`;
  - todos saem, e a página de cada um recebe `encerrada`;
  - a naHora acaba, e o link dela para de valer. A marcada para, e o link continua valendo até o `valeAte`.
- **`POST /api/v1/reunioes/{codigo}/tela`:** `200` `{"senha": "<senha>"}`, para a ligação da tela compartilhada (a segunda ligação, docs/video-agente.md seção 6).

```json
// Participante
{"id": "0011223344556677", "nome": "Ana Souza", "deFora": false, "tela": false}
// Pedido
{"id": "8899aabbccddeeff", "nome": "Maria Lima"}
```
- O `tela` diz se o participante está compartilhando a tela agora.
- Depois de o servidor do chat reiniciar, um participante que já estava na reunião aparece com o `nome` vazio e o `deFora` falso.

## 10. A página (quem entra pelo navegador)
A página é servida pelo chat em `https://<endereço do chat>/r/<código>`. Quem entra por ela não tem chave: é sempre "de fora" e passa pela sala de espera, menos na reunião de teste.

**Abrir** — `POST /api/v1/pagina/reunioes/{codigo}`, sem chave e sem corpo.
- `200`:
```json
{"reuniao": {"tipo": "marcada" | "naHora" | "teste", "assunto": "Planejamento" | null, "inicio": 1794495600000 | null},
 "bilhete": "<43 caracteres base64url>"}
```
- O bilhete vale uma vez, por 30 segundos, e só para o canal desta reunião.
- **Os erros:**
  - `404 naoEncontrado`: o código não existe, a reunião não vale, foi cancelada, ou a empresa está sem as reuniões liberadas;
  - `429 tentativas`, com `esperarSegundos`: 20 por minuto por endereço, contando junto com o `entrar` do app.

**O canal** — `GET /api/v1/pagina/canal?bilhete=<bilhete>`, como WebSocket.
- **A origem** tem de ser a do próprio chat (`https://<endereço do chat>`, com a porta quando ele usa uma) ou, no modo de teste, uma das origens do `--origem`. Sem a origem, ou com outra, responde `403 proibido`, e o bilhete continua valendo.
- **Um bilhete** inválido, vencido ou já usado responde `401 chave`.
- **O servidor manda um ping a cada 25 segundos.** Sem resposta em 60 segundos, ele fecha.
- **Até 20 mensagens por minuto** da página. Passando disso, o servidor responde `{"tipo": "erro", "erro": "limite"}` e ignora a mensagem.
- **Fechar o canal** enquanto espera retira o pedido. Depois de aceito, fechar o canal não tira ninguém da reunião.

As mensagens são JSON em texto, sempre com o `tipo`. Da página para o servidor:
```json
{"tipo": "pedir", "nome": "Maria Lima"}   // o nome segue a regra do nome de uma pessoa (seção 3)
{"tipo": "desistir"}
{"tipo": "senha"}                          // uma senha nova para o mesmo participante, depois do aceito
{"tipo": "tela"}                           // a senha da tela compartilhada, com a pessoa na reunião
```
Do servidor para a página:
```json
{"tipo": "naoComecou"}       // nenhum colega está na reunião: o pedido espera ela começar, sem limite de tempo
{"tipo": "aguardando"}       // o pedido chegou aos colegas na reunião: espera até 10 minutos
{"tipo": "aceito", "participante": "…", "senha": "…", "turn": {…}, "video": {…}}   // o Acesso, sem a reuniao
{"tipo": "recusado"}         // um colega recusou, ou 10 minutos sem resposta
{"tipo": "cheia"}            // a reunião tem 10 pessoas
{"tipo": "servidorCheio"}    // o servidor de vídeo está no limite de reuniões ao mesmo tempo
{"tipo": "semServidor"}      // o servidor de vídeo não respondeu
{"tipo": "linkInvalido"}     // durante a espera, a reunião foi cancelada, deixou de valer, ou a naHora acabou
{"tipo": "senha", "senha": "…"}
{"tipo": "tela", "senha": "…"}
{"tipo": "tirado"}           // um colega tirou a pessoa da reunião
{"tipo": "encerrada"}        // um colega encerrou a reunião para todos, ou ela foi cancelada
{"tipo": "erro", "erro": "invalido" | "limite" | "foraDaReuniao"}
```
- **O `pedir` vale uma vez por canal.** Depois de `cheia`, `servidorCheio` ou `semServidor`, a página pode mandar outro `pedir`.
- **Depois de `recusado`, `linkInvalido`, `tirado` ou `encerrada`,** o servidor fecha o canal (código 1000).
- **Uma mensagem fora de ordem**, como `senha` antes do `aceito`, `tela` fora da reunião ou um segundo `pedir`, responde `erro`, com `invalido` ou `foraDaReuniao`.
- **O `senha`:** até 5 por minuto por participante.
- **Na reunião de teste,** o `pedir` responde `aceito` na hora, sem sala de espera. A primeira pessoa a começa.
- **Quando a reunião marcada para** (todos saíram) com pedidos esperando, eles voltam a `naoComecou`. Quando ela recomeça, voltam a `aguardando`, com 10 minutos de novo.

## 11. Os eventos das reuniões (no WebSocket do app, seção 7)
```json
{"tipo": "reuniaoAgora", "reuniao": <Reunião>, "de": <Pessoa>}             // o "Gerar link" de um colega: entre e largue a chamada com ele
{"tipo": "reuniaoPedido", "reuniao": "<codigo>", "pedido": <Pedido>}       // alguém pediu para entrar
{"tipo": "reuniaoPedidoFim", "reuniao": "<codigo>", "pedido": "<id>"}      // o pedido foi respondido, retirado ou venceu
{"tipo": "reuniaoParticipantes", "reuniao": "<codigo>", "participantes": [<Participante>…], "pedidos": [<Pedido>…]}
{"tipo": "reuniaoAcabou", "reuniao": "<codigo>"}                           // a reunião parou ou acabou
```
- Os quatro últimos vão só para os computadores que estão na reunião: os que chamaram o `entrar` e cujo participante está nela. O `reuniaoAcabou` vai para os que estavam nela.
- O `reuniaoParticipantes` sai a cada mudança das duas listas.
- O `reuniaoAgora` vai para os computadores conectados dos colegas convidados.

## 12. Os limites das reuniões
| O quê | Quanto |
|---|---|
| Pessoas por reunião | 10, sem contar a tela compartilhada |
| Reuniões ao mesmo tempo | 2 por padrão, de 1 a 20 na administração, em todo o servidor |
| Tentativas de abrir | 20 por minuto por endereço (o abrir da página e o `entrar` do app) |
| A senha de uso único | 30 segundos, uma vez só, no relógio do servidor de vídeo |
| A espera de quem é de fora | 10 minutos depois de o pedido chegar aos colegas |
| A naHora sem ninguém | acaba 10 minutos depois de criada |
| Reuniões marcadas por pessoa | 100 que ainda valem |
| As credenciais do TURN | 12 horas |
| O `assunto` | 120 caracteres |
| A reunião guardada | até 30 dias depois do fim da validade: o `valeAte`, o cancelamento ou o fim da naHora |
| Os nomes de quem é de fora | só na memória do servidor, e somem quando a reunião acaba |

- **Uma reunião "acontecendo"** tem ao menos uma pessoa com a câmera nela. Uma "começando" tem a senha de um colega emitida e ainda não usada. As duas contam no limite de reuniões ao mesmo tempo.
- **As pessoas de uma reunião** são as que estão nela, mais as senhas de pessoa emitidas e ainda não usadas.
