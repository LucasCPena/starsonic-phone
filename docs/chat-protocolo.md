# Chat do Starsonic Phone — o protocolo da API (v1)

O contrato entre o app e o servidor do chat (`chat-servidor/`). A spec é `docs/superpowers/specs/2026-11-04-starsonic-phone-chat-design.md`. Este arquivo diz os nomes, os campos e os erros exatos. O servidor (etapa 1) e o app (etapa 2) seguem este arquivo, e uma mudança aqui muda os dois.

## 1. O básico
- **O endereço:** `https://<endereço do chat>/api/v1`, por exemplo `https://chat.starsonic.com.br/api/v1`. No modo de teste: `http://127.0.0.1:<porta>/api/v1`.
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
| 404 | `codigo` | O código da empresa não existe (só no `POST /api/v1/computadores`). |
| 404 | `naoEncontrado` | O id não existe, é de outra empresa, ou a pessoa não está na conversa. |
| 409 | `pessoa` | Ninguém entrou neste computador ainda (seção 4). |
| 409 | `grupoCheio` | O grupo passaria de 200 pessoas. |
| 410 | `expirado` | O arquivo passou de 365 dias e saiu do servidor. |
| 413 | `grande` | O arquivo passa de 25 MB, a miniatura passa de 200 KiB, ou o JSON passa de 64 KiB. |
| 429 | `tentativas` | Muitos códigos errados deste endereço. Vem com `"esperarSegundos": <n>`. |
| 429 | `limite` | Pedidos, mensagens ou arquivos demais deste computador. Vem com `"esperarSegundos": <n>`. |
| 500 | `servidor` | Um erro do servidor. O pedido pode ser tentado de novo. |

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
- **O `idLocal`:** um texto de 1 a 64 caracteres (`[A-Za-z0-9-]`), gerado pelo app para cada mensagem. Ele é único por pessoa.
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
