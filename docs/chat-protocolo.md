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
| 400 | `invalido` | Um campo faltou ou veio fora da regra. Vem com `"campo": "<nome>"`. Só um JSON que não dá para ler vem sem campo, menos no abrir da página (seção 10), que responde com o `"campo": "corpo"`. |
| 401 | `chave` | Sem chave, chave desconhecida, ou o computador saiu do chat (foi tirado, a pessoa foi tirada, a empresa foi apagada ou ele desligou). O app mostra "Este computador saiu do chat…". |
| 401 | `passe` | O passe ou a chave do colega, no abrir da página, não vale (seção 10). |
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
| 409 | `semLigacao` | O computador não está com o canal dos eventos (seção 7) aberto agora. Só no `PUT /api/v1/computadores/eu/ramal`. |
| 410 | `expirado` | O arquivo passou de 365 dias e saiu do servidor. |
| 413 | `grande` | O arquivo passa de 25 MB, a miniatura passa de 200 KiB, ou o JSON passa de 64 KiB. |
| 429 | `tentativas` | Muitos códigos errados deste endereço, ou passes demais deste computador (seção 9). Vem com `"esperarSegundos": <n>`. |
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
- **O texto de uma mensagem da reunião** (o chat da reunião, seção 10): segue a regra do texto de uma mensagem, com duas diferenças:
  - o servidor tira os espaços e as quebras de linha das pontas antes de conferir, e é o texto sem eles que os outros recebem;
  - ele tem de 1 a 1.000 caracteres, contados do mesmo jeito.
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

**Dizer o estado do ramal** — `PUT /api/v1/computadores/eu/ramal`.
- Corpo: `{"estado": "erro", "segundos": 734}`.
  - `estado`: `conectado`, `conectando`, `erro` ou `semConexao`. É o estado do ramal da conta em uso, o mesmo que o app mostra.
  - `segundos`: há quantos segundos o ramal está registrado (com o `conectado`) ou sem registrar (com os outros três). Um inteiro de 0 a 31.536.000 (um ano). Quem conta o tempo é o app.
- `204`, sem corpo.
- **O que o servidor guarda:** o último estado de cada computador ligado a ele, com o instante "agora menos os segundos". Fica só na memória, para a página de administração: não vai para o banco nem para os registros, e some quando o canal dos eventos do computador fecha sem outro no lugar (seção 7).
- Erros. Quando mais de um cabe, vale o primeiro desta ordem:
  - `401 chave`;
  - `429 limite`: além do limite geral, esta operação tem um só dela, de 30 por minuto por computador (seção 8);
  - `409 pessoa`: ninguém entrou neste computador ainda;
  - `400 invalido`: o `estado` faltou ou está fora da lista (`campo: "estado"`), ou os `segundos` faltaram ou estão fora da faixa (`campo: "segundos"`). Um corpo que o servidor não consegue ler nesse formato (não é JSON, ou um campo veio com outro tipo) vem sem campo;
  - `409 semLigacao`: o computador não está com o canal dos eventos (seção 7) aberto, nem abrindo, agora. O servidor só guarda o estado de quem está ligado nele. O app manda de novo quando o canal abrir.
- **A pessoa da vez:** o estado vale para a pessoa da vez do computador. Depois de outra pessoa entrar nele (`POST /api/v1/pessoas/eu`), o estado guardado deixa de valer, e o app manda de novo.
- **A ordem do app:** abrir o canal dos eventos, e só então dizer o estado. O servidor já conta o computador como ligado antes de aceitar a conexão do WebSocket: um estado mandado logo depois de o canal abrir nunca chega cedo demais.
- **O app com um servidor antigo:** um `404` nesta operação quer dizer que o servidor ainda não a conhece. O app para de mandar até a próxima vez em que se ligar ao chat, e não mostra erro nenhum.

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
| O estado do ramal, por computador | 30 por minuto, no `PUT /api/v1/computadores/eu/ramal`, além dos 600 |
| Mensagens por computador | 60 por minuto |
| Arquivos por computador | 200 MB por hora |
| Códigos errados por endereço | 10 por hora; depois, 1 hora de espera |
| Mensagens por pedido | 50 |
| Arquivo guardado | 365 dias |
| Corpo JSON | 64 KiB |

**Os pedidos por computador.**
- Todo pedido que leva a chave do computador conta nos 600 por minuto, seja qual for a rota (o `GET /api/v1/eventos`, que entra com o bilhete, não leva a chave e não conta).
- O `POST /api/v1/pessoas/eu` conta também nos 20 por minuto.
- O `PUT /api/v1/computadores/eu/ramal` conta também nos 30 por minuto. Todo pedido com a chave boa conta, mesmo o que responde um erro.
- Acima de um limite, a resposta é `429` com `{"erro": "limite", "esperarSegundos": <n>}`. O app espera esse tempo e tenta de novo.
- Esses limites valem junto com os de mensagens e de arquivos.

## 9. As reuniões (o app)
As reuniões com link moram no servidor do chat; o vídeo e o som vão direto para o servidor de vídeo (`docs/video-agente.md`). A spec é `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`; o passe, o canal do colega, a página dentro do app e a pausa são da `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`.

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
- **Cada pessoa tem até 10 reuniões na hora abertas** (o "Gerar link"; `409 muitasReunioes`, como nas marcadas). A naHora que acabou ou foi cancelada não conta.
- **A empresa precisa ter as reuniões liberadas** na administração. Sem isso, as rotas desta seção respondem `403 semReunioes`, e a página não abre os links dela (`404 naoEncontrado`). Quando a administração bloqueia as reuniões da empresa, ou a apaga, as reuniões dela que estão acontecendo acabam: todos saem, como no cancelar.
- **Quem está na reunião:** é a pessoa cujo computador chamou o `entrar` e cuja ligação com a câmera o servidor de vídeo diz que entrou e ainda não saiu. O colega que entra pela página, com um passe (seção 10), conta do mesmo jeito: para o chat, o computador do passe chamou o `entrar`.
- **Depois de o servidor do chat reiniciar,** ninguém conta como "na reunião" até entrar de novo: o chat guarda as reuniões só na memória. A reunião continua no servidor de vídeo, com as ligações de antes, mas para o chat ninguém está nela: as rotas de "Com a pessoa na reunião" respondem `409 foraDaReuniao`, nenhum evento da seção 11 chega, e o pedido de quem é de fora espera como numa reunião que não começou. Quem chama o `entrar` de novo volta a contar, com um participante novo, e vê na lista os que já estavam, sem o nome (abaixo). O que o app faz está na seção 11, e o que a página da reunião faz (a partida, o aviso, a entrada de novo dentro do app) está na seção 10, em "O chat que reinicia".

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
- Vale para a marcada e para a naHora: quem gerou o link de uma naHora também a cancela, e ela acaba.

**Gerar link (a reunião na hora)** — `POST /api/v1/reunioes/agora`.
- Corpo: `{"ramais": ["2003", "2004"]}`: os colegas que estão na chamada. É opcional, com até 9 ramais.
- `201`: `{"reuniao": <Reunião>}`, com o `tipo` igual a `naHora`.
- Os computadores conectados das pessoas ativas da mesma empresa com esses ramais recebem o evento `reuniaoAgora` (seção 11). Um ramal que não é de ninguém é ignorado, e quem gerou o link não recebe o próprio convite.
- A naHora acaba quando fica vazia, com o Encerrar para todos, com o Cancelar de quem a gerou, ou 10 minutos depois de criada se ninguém entrou nela.

**Entrar** — `POST /api/v1/reunioes/{codigo}/entrar`.
- `200`: o Acesso, abaixo, com a `reuniao`.
- **Um colega da mesma empresa** entra direto. Uma reunião parada começa.
- **Os erros:**
  - `404 naoEncontrado`: o código não existe ou a reunião não vale (cancelada, vencida ou acabada), de qualquer empresa;
  - `403 outraEmpresa`: o link é de outra empresa. O app abre o link no navegador, onde a pessoa passa pela sala de espera;
  - `403 semReunioes`;
  - `409 cheia`: a reunião já tem 10 pessoas;
  - `409 servidorCheio`: a reunião está parada e o servidor de vídeo já está no limite de reuniões ao mesmo tempo;
  - `503 servidorVideo`: o servidor de vídeo não foi configurado ou não respondeu;
  - `429 tentativas`, com `esperarSegundos`: já são 20 tentativas no último minuto deste endereço (seção 12). O servidor confere isso primeiro, e responde assim até com um código certo. Contam só as tentativas que não levam a uma reunião em que a pessoa possa entrar: o `404 naoEncontrado`, o `403 outraEmpresa` e o `403 semReunioes`, do `entrar` e do `passe` (abaixo), junto com o abrir da página que falha (seção 10). Não contam o `entrar` que dá certo (um escritório atrás de um endereço só entra de uma vez na hora marcada) nem, num código bom, o `409 cheia`, o `409 servidorCheio` e o `503 servidorVideo`.

**O Acesso.**
```json
{"participante": "0011223344556677",
 "senha": "<a senha de uso único: 30 segundos, uma vez só>",
 "turn": {"urls": ["turn:video.exemplo.com.br:3478?transport=udp", "turns:video.exemplo.com.br:5349?transport=tcp"],
          "usuario": "1794538800:0011223344556677", "senha": "lTe50TxrbuhEaWJVPhFLOGOJYRI="},
 "video": {"wss": "wss://video.exemplo.com.br/sip",   // com a porta quando o vídeo usa uma: "wss://video.exemplo.com.br:7443/sip"
           "uri": "sip:reuniao@video.exemplo.com.br",
           "sip": "sips:reuniao@video.exemplo.com.br:5061;transport=tls"},
 "reuniao": <Reunião>}
```
- O `participante` é um id de 16 caracteres hexadecimais, novo a cada entrada.
- A `senha` e o `turn` seguem o `docs/video-agente.md`. As credenciais do TURN valem 12 horas.
- O navegador usa o `wss` e a `uri`, e o app usa o `sip`.
- O `wss` leva a porta do servidor de vídeo quando ele usa uma que não é a 443 (o endereço que a administração guardou leva a porta, como `video.exemplo.com.br:7443`), por exemplo `wss://video.exemplo.com.br:7443/sip`. O `turn` e o `sip` ficam sem essa porta: o TURN é na 3478 e na 5349, e o SIP, na 5061.
- Uma senha que venceu antes da ligação (a pessoa demorou) se resolve com outro `entrar`, que dá um participante novo.

**O passe** — `POST /api/v1/reunioes/{codigo}/passe`, sem corpo. É como o colega entra pela página da reunião, no app ou no navegador, sem a chave do computador (seção 10).
- `200`: `{"passe": "<43 caracteres base64url>", "reuniao": <Reunião>}`, com o `Cache-Control: no-store`.
- **O passe** são 32 bytes aleatórios, em base64url, sem preenchimento (43 caracteres). Vale **uma vez**, por **120 segundos**, e só para aquela reunião, aquela pessoa e aquele computador: o abrir da página o gasta e o troca pela chave do colega. Fica só na memória do servidor (um reinício o perde) e nunca vai ao log.
- **Nada começa:** nem a reunião nem o servidor de vídeo. A reunião cheia não barra o passe: quem diz `cheia`, `servidorCheio` ou `semServidor` é o canal, na hora de entrar.
- **Os erros** são os do `entrar` que não dependem de lugar, na mesma ordem e com a mesma conta nas tentativas:
  - `401 chave` e `409 pessoa`, como em toda operação desta seção;
  - `429 tentativas`, com `esperarSegundos`: a janela das 20 tentativas deste endereço está cheia (como no `entrar`, conferida antes da reunião);
  - `403 semReunioes`, `404 naoEncontrado` (o código não existe, ou a reunião não vale, de qualquer empresa) e `403 outraEmpresa` (também a reunião de teste, que não é de empresa nenhuma). Os três contam nas 20 tentativas;
  - `429 tentativas`, com `esperarSegundos`: já são 10 passes neste minuto, deste computador. Só o pedido que ganharia o passe conta nessa janela, e ela não conta nas 20 tentativas do endereço.

**Com a pessoa na reunião.** Estas rotas pedem que a pessoa da vez esteja na reunião (seção 9, "Quem está na reunião"). Se ela não está, respondem `409 foraDaReuniao` (a `pausa` tem a regra dela, abaixo). Um código de outra empresa responde `404 naoEncontrado`.
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
  - ele não volta: uma ligação que ele faça depois, com uma senha que ainda valia, também sai, e ele não aparece na lista;
  - um participante que não está na reunião responde `404 naoEncontrado`.
- **`POST /api/v1/reunioes/{codigo}/encerrar`:**
  - responde `204`;
  - todos saem, e a página de cada um recebe `encerrada`;
  - a naHora acaba, e o link dela para de valer. A marcada para, e o link continua valendo até o `valeAte`.
- **`POST /api/v1/reunioes/{codigo}/tela`:** `200` `{"senha": "<senha>"}`, para a ligação da tela compartilhada (a segunda ligação, docs/video-agente.md seção 6).
- **`POST /api/v1/reunioes/{codigo}/pausa`,** com `{"pausada": true, "vez": "p7Kq2"}`: o app atendeu uma ligação da central (ou ela acabou), e a reunião que este computador abriu no navegador entra em pausa (ou sai dela). O chat repassa o `pausa` (seção 10) à página:
  - o `pausada` é um booleano, e o `vez`, um id que o app escolhe para cada pausa, de 1 a 32 letras ou números (`[A-Za-z0-9]`). Fora disso, `400 invalido`, com o `campo` igual a `pausada` ou `vez`;
  - responde `204` só enquanto um participante **daquela pessoa e daquele computador, que entrou por uma página** (o canal do colega, seção 10), está na reunião ou entrando nela (com uma senha da câmera ainda não usada). O participante do `entrar` do app não conta;
  - responde `409 foraDaReuniao` no resto: a página que ainda não passou do "Entrar", a que foi fechada, e também a de quem clicou em "Sair" e a deixou aberta no "Você saiu da reunião". Depois do "Entrar de novo" (uma senha nova), ela volta a contar. Por isso um `409` não quer dizer que a página não vai entrar (de novo) durante a mesma ligação;
  - o `pausa` vai ao canal aberto de cada página que conta; a que está sem o canal nessa hora não recebe nada, e a resposta é `204` do mesmo jeito. O participante que não conta não recebe nada;
  - **o servidor só repassa:** ele não guarda pausa nenhuma, e nada dela vai ao log. Quem repete a pausa enquanto a ligação dura é o app (a cada 10 segundos, para a página que estava sem o canal, ou que carregou de novo).

```json
// Participante
{"id": "0011223344556677", "nome": "Ana Souza", "deFora": false, "tela": false}
// Pedido
{"id": "8899aabbccddeeff", "nome": "Maria Lima"}
```
- O `tela` diz se o participante está compartilhando a tela agora.
- Depois de o servidor do chat reiniciar, um participante que já estava na reunião aparece com o `nome` vazio e o `deFora` falso.

## 10. A página da reunião (no navegador e dentro do app)
A página é servida pelo chat em `https://<endereço do chat>/r/<código>`. Quem entra por ela nunca tem a chave do computador. Sem um passe (seção 9) nem uma chave do colega, ela é "de fora" e passa pela sala de espera, menos na reunião de teste. Com um deles, ela é a página de um colega, que entra direto pelo canal do colega (abaixo).

**Abrir** — `POST /api/v1/pagina/reunioes/{codigo}`, sem chave. O corpo é opcional:
- **sem corpo,** quem abre é de fora, como sempre;
- `{"passe": "<passe>"}`: o servidor gasta o passe e reconhece o colega dele;
- `{"colega": "<chave do colega>"}`: o servidor confere a chave, que continua valendo, e reconhece o colega dela.

O corpo é um objeto JSON com **um** desses campos, e nada mais, de até 256 bytes. O passe e a chave têm 43 caracteres base64url.
- `200`:
```json
{"reuniao": {"tipo": "marcada" | "naHora" | "teste", "assunto": "Planejamento" | null, "inicio": 1794495600000 | null},
 "bilhete": "<43 caracteres base64url>",
 "partida": "<43 caracteres base64url>",
 "colega": {"nome": "Júlia Martins", "chave": "<43 caracteres base64url>", "valeAte": 1794538799999 | null}}
```
- O bilhete vale uma vez, por 30 segundos, e só para o canal desta reunião.
- **A `partida`** diz de qual "subida" do servidor do chat é a resposta: 43 caracteres base64url, sorteados quando o servidor sobe, e iguais em todo `200` do abrir até ele reiniciar. Não é segredo, e não identifica ninguém. A página guarda a do último abrir que não foi o de um `voltar`. Se o abrir de um `voltar` traz outra, o chat reiniciou e esqueceu a pessoa (abaixo, "O chat que reinicia"); a página que não conhece a partida de antes (um servidor mais velho) não tira conclusão nenhuma dela.
- **O `colega`** só vem com o passe ou com a chave. O `nome` é o do cadastro do chat, na hora. O `valeAte` é até quando o link vale (o da Reunião, seção 9), ou `null` na naHora, que vale até acabar. A `chave` só vem no abrir com o passe.
- **A chave do colega** deixa a página abrir de novo sem outro passe (o segundo abrir, o "Entrar de novo", o "Tentar de novo"). São 32 bytes aleatórios em base64url (43 caracteres), só na memória do servidor e só na memória da página, nunca no banco nem no log. Ela vale 12 horas, só para aquela reunião, e cada uso confere de novo que a reunião vale, que a pessoa continua ativa na empresa e que o computador do passe continua ligado ao chat. Um computador tem até 50 chaves: a 51ª apaga a mais velha dele. Depois de o servidor do chat reiniciar, nenhuma chave vale, e a página nem a tenta com quem já estava na reunião (abaixo, "O chat que reinicia"). Quem abre a página depois, com uma chave de antes, recebe `401 passe`: dentro do app, a página pede outro passe ao app; no navegador, onde não há app para mandar outro, ela abre como quem é de fora, com a faixa (abaixo, "A página no navegador, com o passe").
- **O bilhete de um abrir com o passe ou com a chave** fica preso ao colega e abre um canal do colega. O de um abrir sem corpo abre o canal de quem é de fora, como sempre.
- **Os erros:**
  - `404 naoEncontrado`: o código não existe, a reunião não vale, foi cancelada, ou a empresa está sem as reuniões liberadas. O servidor confere isso antes de ler o corpo;
  - `400 invalido`, com o `campo`: o corpo não é um objeto com um campo só, `passe` ou `colega` (o `campo` é `corpo`, também para um corpo de mais de 256 bytes), ou o valor dele não é um texto de 43 caracteres base64url (o `campo` é `passe` ou `colega`);
  - `401 passe`: o passe não existe, venceu, já foi gasto ou é de outra reunião; a chave do colega não vale (venceu, é de outra reunião, ou o servidor reiniciou); ou a pessoa saiu do chat, ou o computador do passe foi desligado dele. Uma chave que dá `401 passe` é esquecida, e não vale mais. A reunião de teste não reconhece colega nenhum: com um corpo, ela responde `401 passe`;
  - `429 tentativas`, com `esperarSegundos`: já são 20 tentativas que falharam no último minuto deste endereço, o abrir que deu `404 naoEncontrado`, `400 invalido` ou `401 passe` contando junto com o `entrar` e o `passe` do app que falham (o `404 naoEncontrado`, o `403 outraEmpresa` e o `403 semReunioes`; seção 9, `entrar`). O servidor confere isso primeiro, e responde assim até com um código certo. O abrir que dá certo não conta nessas 20: a página pode abrir de novo. Ele tem a janela dele, à parte: o mesmo `429 tentativas`, com `esperarSegundos`, também vem quando já são 60 aberturas que deram certo no último minuto deste endereço. As duas janelas são conferidas antes de o servidor ler a reunião, e uma não gasta a outra. Gastas as 60 aberturas boas do último minuto, todo abrir daquele endereço, com um código bom ou ruim, responde `429 tentativas` até a janela andar.

**O canal** — `GET /api/v1/pagina/canal?bilhete=<bilhete>`, como WebSocket.
- **A origem** tem de ser a do próprio chat (`https://<endereço do chat>`, com a porta quando ele usa uma) ou, no modo de teste, uma das origens do `--origem`. Sem a origem, ou com outra, responde `403 proibido`, e o bilhete continua valendo.
- **Um bilhete** inválido, vencido ou já usado responde `401 chave`.
- **O servidor manda um ping a cada 25 segundos.** Sem resposta em 60 segundos, ele fecha.
- Sem um `pedir` (ou um `entrar`, no canal do colega) em 2 minutos depois de abrir, o servidor fecha o canal (1000).
- **Até 20 mensagens por minuto** da página, sem contar o `camera` nem o `mensagem`. As mensagens do canal do colega (abaixo) contam nessas 20. Passando disso, o servidor responde `{"tipo": "erro", "erro": "limite"}` e ignora a mensagem. O `camera` tem a janela dele, de 30 por minuto por canal, e o `mensagem` (o chat da reunião), as dele: 20 por minuto por participante e 20 por minuto por canal (seção 12).
- **O maior quadro** que a página manda tem 4.096 bytes. Passando disso, o servidor fecha o canal com o código `1009`, sem resposta.
- **Fechar o canal** enquanto espera retira o pedido. Depois de aceito, fechar o canal não tira ninguém da reunião.
- **A página abre duas vezes.** Ela chama o abrir ao carregar, para saber qual é a reunião e mostrar a entrada, e de novo ao pedir. O bilhete do segundo abrir é o que abre o canal; o do primeiro não é guardado, e valeria só 30 segundos, muito pouco para a pessoa escrever o nome. Depois de uma queda, a página entra de novo pelo `senha`, que renova só a ligação de vídeo. Se os dois canais caem (este e o da ligação), ela abre outro canal (o abrir dá um bilhete novo) e vai pelo `voltar` primeiro; o `senha` vem depois dele, como a chave de volta explica abaixo.

As mensagens são JSON em texto, sempre com o `tipo`. Da página para o servidor:
```json
{"tipo": "pedir", "nome": "Maria Lima"}   // o nome segue a regra do nome de uma pessoa (seção 3)
{"tipo": "desistir"}
{"tipo": "senha"}                          // uma senha nova para o mesmo participante, depois do aceito
{"tipo": "tela"}                           // a senha da tela compartilhada, com a pessoa na reunião
{"tipo": "voltar", "participante": "…", "volta": "…"}   // só como a primeira mensagem do canal, no lugar do pedir
{"tipo": "camera", "ligada": false}        // a câmera da pessoa foi desligada (true: ligada), depois do aceito
{"tipo": "mensagem", "id": "m12", "texto": "O link é https://exemplo.com.br"}   // o chat da reunião, de quem está nela ou entrando
```
Do servidor para a página:
```json
{"tipo": "naoComecou"}       // nenhum colega está na reunião: o pedido espera ela começar, sem limite de tempo
{"tipo": "aguardando"}       // o pedido chegou aos colegas na reunião: espera até 10 minutos
{"tipo": "aceito", "participante": "…", "senha": "…", "turn": {…}, "video": {…}, "volta": "…"}   // o Acesso, sem a reuniao, e a chave de volta
{"tipo": "voltou", "volta": "…"}   // a resposta ao voltar: o canal é de novo o do participante, com a chave nova
{"tipo": "recusado"}         // um colega recusou, ou 10 minutos sem resposta
{"tipo": "cheia"}            // a reunião tem 10 pessoas
{"tipo": "esperaCheia"}      // muita gente esperando para entrar: a sala de espera tem 50 pedidos
{"tipo": "servidorCheio"}    // o servidor de vídeo está no limite de reuniões ao mesmo tempo
{"tipo": "semServidor"}      // o servidor de vídeo não respondeu
{"tipo": "linkInvalido"}     // a reunião foi cancelada, deixou de valer, ou a naHora acabou: na espera, em resposta ao senha, ou em resposta ao voltar
{"tipo": "senha", "senha": "…"}
{"tipo": "tela", "senha": "…"}
{"tipo": "palco", "largura": 1920, "altura": 1080,
 "quadros": [{"quem": "<16 hex>", "nome": "Ana Souza", "voce": false, "tela": false, "semCamera": false,
              "x": 0, "y": 0, "l": 960, "a": 540}]}   // o palco do mosaico, só a quem está na reunião ou entrando
{"tipo": "mensagem", "id": "m12", "de": "<16 hex>", "nome": "Carlos Lima", "voce": true, "texto": "…"}   // o chat da reunião: a quem escreveu (aos outros, sem o id e com o voce falso)
{"tipo": "mensagemRecusada", "id": "m12", "motivo": "limite" | "grande" | "foraDaReuniao" | "invalida"}   // só a quem escreveu
{"tipo": "tirado"}           // um colega tirou a pessoa da reunião
{"tipo": "encerrada"}        // um colega encerrou a reunião para todos, ela foi cancelada, a empresa perdeu as reuniões, ou a reunião acabou no servidor de vídeo
{"tipo": "erro", "erro": "invalido" | "limite" | "foraDaReuniao"}
```
- **O `pedir` vale uma vez por canal.** Depois de `cheia`, `esperaCheia`, `servidorCheio` ou `semServidor`, a página pode mandar outro `pedir`.
- **Depois de `recusado`, `linkInvalido`, `tirado` ou `encerrada`, e depois de um `desistir` que retirou o pedido,** o servidor fecha o canal (código 1000); o `desistir` não recebe resposta.
- **Um erro inesperado do servidor** (o banco, por exemplo) fecha o canal com o código `1011`, sem mensagem antes. A página pode chamar o abrir de novo depois de alguns segundos.
- **Uma mensagem fora de ordem**, como `senha` antes do `aceito`, `tela` fora da reunião, um segundo `pedir` ou um `desistir` sem pedido que espere (nenhum, ou já aceito), responde `erro`, com `invalido` ou `foraDaReuniao`.
- **O `senha`:** até 5 por minuto por participante. Ele vale também com a pessoa ainda na reunião (a conexão caiu, ou ela saiu e quer voltar): a ligação principal nova toma o lugar da anterior no servidor de vídeo, sem a pessoa sair da reunião (a seção 6 do `docs/video-agente.md`). Ele é uma entrada nova, com as conferências do `pedir`, e além do `senha` pode responder:
  - `linkInvalido`: a reunião foi cancelada, deixou de valer, ou a naHora acabou. O servidor fecha o canal (código 1000), como depois das outras respostas finais;
  - `cheia`, `semServidor` e, só na reunião de teste, `servidorCheio`: o canal continua aberto, e a página pode mandar outro `senha`, dentro dos 5 por minuto.
- **O `tela`** responde `tela`, com a senha da tela compartilhada, ou, sem ela, `{"tipo": "erro", "erro": "foraDaReuniao"}` (a pessoa não está na reunião) ou `semServidor` (o servidor de vídeo não está no ar para o chat), e a página então para a captura da tela.
- **A chave de volta (`volta`).** A página que perdeu a rede e, com ela, os dois canais (este e o da ligação de vídeo) volta à reunião sem passar pela sala de espera: ela abre outro canal (o abrir dá um bilhete novo), e a primeira mensagem dele, no lugar do `pedir`, é o `voltar`, com o `participante` e a `volta` do último `aceito` ou `voltou`. A chave são 32 bytes aleatórios em base64url, sem preenchimento (43 caracteres); a página a guarda só na memória dela, e o servidor a guarda só na memória dele, com o pedido aceito (nunca no banco, e nunca no log). Todo `aceito` e todo `voltou` traz uma chave nova, e a anterior deixa de valer, com uma exceção curta: a chave que a página mandou no último `voltar` que deu certo ainda vale até a primeira mensagem dela no canal que voltou (como o `senha` ou o `tela`), ou até 60 segundos depois do `voltou`, o que vier primeiro, para a página cujo `voltou` se perdeu voltar com a chave que tem. Dando certo, o servidor responde `voltou`, com a chave nova, e o canal passa a ser o do participante: o `senha` e o `tela` valem nele, e o `tirado`, o `encerrada` e o `linkInvalido` chegam a ele (o canal antigo, se o servidor ainda o via aberto, é fechado). Para voltar à ligação, a página pede o `senha`, como depois de uma ligação que caiu. O `voltar` não precisa do servidor de vídeo. Ele falha de dois jeitos, e nos dois o servidor fecha o canal (código 1000) e conta uma falha do endereço, na janela das 20 tentativas do abrir (seção 12), e nada mais que a página mande nele é tratado; o `voltar` que dá certo não conta:
  - `{"tipo": "erro", "erro": "invalido"}`: participante desconhecido, chave errada, pedido que não está (ou já não está) aceito, ou participante que já saiu da memória do servidor (foi tirado, ou ficou fora da reunião sem senha até o servidor o esquecer);
  - `{"tipo": "linkInvalido"}`: a reunião foi cancelada, deixou de valer, ou a naHora acabou.

  Um `voltar` depois de qualquer outra mensagem do canal (um `pedir`, um `senha`, um `desistir`, uma mensagem sem sentido), um segundo `voltar`, ou um `pedir` depois do `voltar` é fora de ordem: `{"tipo": "erro", "erro": "invalido"}`, e o canal continua aberto. O canal que voltou não precisa mandar o `pedir`: o prazo de 2 minutos para o primeiro `pedir` também vale para o `voltar`, que o cumpre.
- **O religar do canal.** Com a ligação de vídeo no ar e o canal fechado, a página abre outro e vai pelo `voltar`: três tentativas, com 2, 4 e 8 segundos de espera, e, depois delas, uma a cada 30 segundos, sem limite, enquanto a ligação está no ar. O palco sai da tela na terceira falha (a imagem de todos fica numa só), e volta com o canal. Vale também para quem é de fora: o chat da reunião dele volta quando o chat volta.
- **O chat que reinicia.** O chat guarda as reuniões só na memória, e, depois de reiniciar, a chave de volta de todo mundo é recusada. A página não precisa esperar essa recusa: ela abre o canal pelo abrir de sempre, e, se a `partida` da resposta é outra, sabe que o chat reiniciou. Nesse caso ela **não manda o `voltar`** (ele seria recusado e contaria uma falha do endereço, na janela das 20 tentativas do abrir; seção 12), descarta o bilhete e a chave de volta, e guarda a `partida` nova. Sem isso, ela não saberia distinguir um chat que reiniciou de um colega que foi tirado da reunião: o colega tirado voltaria sozinho. Daí:
  - **com a ligação de vídeo também caída,** é o `saiu` de uma queda, como o `voltar` recusado;
  - **com a ligação no ar, quem é de fora** segue na reunião sem o canal: sem o palco, sem o chat da reunião, com a imagem e o som;
  - **com a ligação no ar, o colega no navegador** continua na reunião e deixa de cuidar dela. A página limpa a lista e os pedidos, fecha as perguntas e mostra o aviso "Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app." (no lugar do cartão do pedido e no painel "Participantes", abaixo). O aviso fica até a pessoa sair da reunião. **O mesmo aviso** vale para o colega, com a ligação no ar, cuja chave de volta é recusada no religar (`erro invalido`). **O link que deixou de valer** (o `linkInvalido` do `voltar`, ou o `404` do abrir do `voltar`) tem o aviso dele, porque a pessoa continua na reunião e, se sair, não consegue voltar: o título "O link desta reunião deixou de valer" e o texto "Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.", no mesmo lugar e com as mesmas regras do aviso de sempre;
  - **com a ligação no ar, o colega dentro do app** entra de novo sozinho (abaixo, "A entrada de novo dentro do app"), sem aviso.
- **O palco (`palco`).** O servidor de vídeo monta um mosaico só por sala; o palco diz o tamanho dele e onde está cada quadro. O chat recebe o palco do agente (seção 5 do `docs/video-agente.md`, sem nomes), guarda o último que vale de cada sala e o manda à página, com o nome de cada quadro:
  - `largura` e `altura` são o tamanho do mosaico, em pixels dele; `x`, `y`, `l` e `a` são o retângulo do quadro dentro dele. A página recorta cada retângulo do vídeo, no tamanho do mosaico, e o mostra no tamanho dela;
  - `quem` é o participante do quadro, `nome` é o nome dele, ou `""` para quem o chat não conhece (o chat reiniciou depois de a pessoa entrar); `tela` é verdadeiro no quadro da tela compartilhada, que leva o `quem` e o `nome` de quem a compartilha;
  - `voce` é verdadeiro nos quadros do participante que recebe a mensagem (a câmera e a tela dele);
  - `semCamera` é o último aviso `camera` daquele participante: verdadeiro com a câmera desligada. Sem aviso, e no quadro da tela, é falso;
  - `quadros` nunca é `null`: o palco sem ninguém leva `[]`;
  - **o que o cliente pode supor.** O chat confere: a `largura` de 16 a 7680 e a `altura` de 16 a 4320; até 13 quadros (as 12 células do maior layout, mais a tela); cada quadro com `l` e `a` de 16 ou mais, inteiro dentro do mosaico. Um palco do agente fora disso não é mandado, e o anterior continua valendo. O servidor de vídeo monta o palco assim (o chat o repassa como veio): no máximo um quadro com `tela`, um quadro da câmera por `quem`, e os quadros em ordem, a tela primeiro e depois as câmeras, pela célula;
  - **quem recebe:** só a página aceita, com o canal aberto, daquela reunião, de quem está nela (a câmera ou a tela) ou entrando (com uma senha da câmera ainda não usada; a senha vencida sai na varredura do chat, a cada segundo). **Entrando tem fim:** vale nas 3 primeiras senhas da câmera seguidas sem a pessoa entrar, a do `aceito` contando (a página gasta uma no `aceito` ou no Entrar de novo, e até três nas tentativas de voltar depois de uma queda). Da quarta em diante, a senha ainda serve para entrar, mas a página só volta a receber o palco quando a câmera dela entra na reunião, e a conta recomeça. Sem isso, quem saiu, ou nunca entrou, e só pedisse senhas ficaria recebendo o palco sem aparecer para ninguém. Ele leva nomes: quem ainda espera, quem foi recusado ou tirado e quem é de outra reunião nunca recebe nada dele, e os eventos dos apps (seção 11) não mudam. Quem saiu (com a página aberta, para o Entrar de novo) e quem foi aceito e deixou a senha vencer sem entrar recebiam o palco antes e, enquanto estão assim, não recebem nada dele; com uma senha da câmera nova (o `senha`), voltam a recebê-lo, até a terceira seguida sem entrar;
  - **quando:** se a sala já tem palco, logo depois do `aceito` (que traz uma senha), logo depois do `voltou` (se a pessoa está na reunião, ou entrando) e com uma senha da câmera (o `senha`): o palco chega junto da resposta do `senha`, antes ou depois dela (o cliente não pode contar com uma ordem), para a página que entra de novo o ter antes da imagem. E de novo, às páginas que o recebem, **a cada vez que o palco da sala muda** e a cada aviso `camera` que muda o `semCamera` de alguém que tem um quadro da câmera no palco. Fora do `aceito`, do `voltou` e do `senha`, um palco igual ao último que a página recebeu não é mandado outra vez;
  - **o palco chega antes da imagem.** A imagem de um layout novo leva de 0,3 a 0,8 s para chegar depois do palco dele (mais, numa rede lenta). Por isso o cliente **só usa um palco enquanto o tamanho da imagem decodificada do vídeo é `largura`×`altura`**: com outro tamanho, ele continua com o palco anterior enquanto a imagem tem o tamanho dele. E um quadro novo, ou que mudou de célula, ainda não vale por um instante. A página espera 0,6 s depois de o tamanho da imagem ficar o do palco, 1 s para o quadro que entrou ou mudou de célula sem o tamanho mudar, e mostra o mosaico inteiro quando passam 3 s sem o tamanho da imagem ser o do palco;
  - a reunião que acaba esquece o palco.
- **O aviso da câmera (`camera`).** A página o manda logo depois do `aceito`, logo depois do `voltou` e a cada vez que a pessoa liga ou desliga a câmera. O `ligada` tem de ser um booleano. Quando vale, **não tem resposta**: o chat guarda o valor sempre, e o que a página vê é o `palco` com o `semCamera` novo, se a pessoa tem um quadro da câmera no palco da sala (sem ele, ou sem palco, nada é mandado, e o primeiro palco com o quadro dela já sai com o valor). Antes do `aceito` (ou depois do fim do pedido), ou sem um `ligada` booleano, responde `{"tipo": "erro", "erro": "invalido"}`, e o canal continua aberto. Como as outras mensagens, o `camera` conta como mensagem tratada do canal (o `voltar` só vale como a primeira, e a primeira mensagem depois do `voltou` confirma a chave nova).
- **O chat da reunião (`mensagem`).** Quem está na reunião manda um texto para todos os que estão nela. O servidor só repassa: ele não guarda mensagem nenhuma, nem na memória depois de repassar, nem no banco, nem no log (que não leva o texto, o nome nem o `id`).
  - **A página manda** o `id` e o `texto`. O `id` é dela, de 1 a 16 letras ou números (`[A-Za-z0-9]`), e serve só para ela saber de qual mensagem é a resposta: ele não precisa ser único fora daquele canal. O `texto` segue a regra do texto de uma mensagem da reunião (seção 3). Antes de mandar, a página troca cada tab por um espaço e tira os outros caracteres de controle, que o servidor recusa: um texto colado de uma planilha vai, em vez de voltar como `invalida`.
  - **O servidor manda a mensagem a cada página da reunião,** também à de quem escreveu, que a recebe de volta: não há outra resposta. Só quem escreveu recebe o `id`, junto com o `voce` verdadeiro; os outros a recebem sem o `id`, com o `voce` falso. O `de` é o participante de quem escreveu, e o `nome`, o nome dele, como no palco (`""` para quem o chat não conhece). O `texto` é o que o servidor conferiu, sem os espaços das pontas. A hora não vai: cada página usa a hora em que a mensagem chegou.
  - **Quem recebe é quem recebe o palco:** a página aceita, com o canal aberto, daquela reunião, de quem está nela (a câmera ou a tela) ou entrando (com uma senha da câmera ainda não usada, até a terceira seguida sem entrar, como no palco). **Quem pode mandar é quem recebe,** sem outra regra. Quem ainda espera, quem foi recusado ou tirado, quem saiu (com a página aberta, para o Entrar de novo), quem deixou a senha vencer, quem só pede senhas sem entrar (da quarta seguida em diante) e quem é de outra reunião não recebe nada e não manda. Os apps (seção 11) não recebem evento nenhum.
  - **Quem entra depois não vê as mensagens de antes,** e quem perdeu o canal não recebe as que foram mandadas enquanto ele estava fora.
  - **A recusa** vai só a quem escreveu, com o `id` da mensagem e o `motivo`, e o canal continua aberto:
    - `foraDaReuniao`: quem mandou não recebe o palco (antes do aceito, ou depois de sair). Este motivo vem antes dos do texto;
    - `grande`: o texto tem mais de 1.000 caracteres;
    - `invalida`: o texto está vazio, é só de espaços, ou tem um caractere de controle que não é a quebra de linha;
    - `limite`: já são 20 mensagens do chat neste minuto. Há duas contas, e as duas valem. A **do participante** conta as mensagens dele que foram repassadas, por qualquer canal: o canal novo de um `voltar` continua a conta, e abrir outro canal não dá outras 20. A **do canal** conta toda mensagem do tipo `mensagem` que chega por ele, também a recusada. A mensagem não é repassada.
  - **Sem um `id` que valha** (vazio, com mais de 16, com outro sinal, ou que não é texto), ou sem um `texto` que seja texto, não há de qual mensagem dizer: a resposta é `{"tipo": "erro", "erro": "invalido"}` (ou `limite`, se o canal já passou das 20). Essas mensagens também contam nas 20 do canal.
  - **O `id` e o reenvio.** O servidor não confere se um `id` já foi usado: a página que manda o mesmo texto de novo manda outra mensagem, e os outros recebem as duas.
- **Na reunião de teste,** o `pedir` responde `aceito` na hora, sem sala de espera. A primeira pessoa a começa.
- **Quando o último colega sai da reunião,** mesmo com gente de fora ainda nela, **ou quando a reunião marcada para** (todos saíram), os pedidos que esperam voltam a `naoComecou`. Quando um colega volta a ela, eles voltam a `aguardando`, com 10 minutos de novo.

**O canal do colega.** É o canal de sempre, aberto com o bilhete de um abrir que reconheceu o colega (com o passe ou com a chave). Ele fica preso à reunião, à pessoa e ao computador do passe. As diferenças:

Da página para o servidor, cinco mensagens novas:
```json
{"tipo": "entrar"}                                     // no lugar do pedir: o colega entra direto
{"tipo": "aceitar", "pedido": "8899aabbccddeeff"}
{"tipo": "recusar", "pedido": "8899aabbccddeeff"}
{"tipo": "tirar", "participante": "0011223344556677"}
{"tipo": "encerrar"}
```
Do servidor para a página, quatro:
```json
{"tipo": "participantes",
 "participantes": [{"id": "<16 hex>", "nome": "Ana Souza", "deFora": false, "tela": false, "voce": true}],
 "pedidos": [{"id": "<16 hex>", "nome": "Maria Lima"}]}                       // a lista inteira, a cada mudança
{"tipo": "recusa", "de": "aceitar" | "recusar" | "tirar" | "encerrar",
 "motivo": "jaRespondido" | "naoEncontrado" | "cheia" | "foraDaReuniao" | "servidorVideo"}   // a resposta que falhou
{"tipo": "feito", "de": "aceitar" | "recusar" | "tirar", "id": "8899aabbccddeeff"}   // a resposta deu certo
{"tipo": "pausa", "pausada": true, "vez": "p7Kq2"}                             // o app pôs a reunião em pausa, ou a tirou dela
```
- **O `entrar`** responde o `aceito` de sempre (o Acesso, sem a `reuniao`, e a chave de volta), ou o `cheia`, o `servidorCheio`, o `semServidor` ou o `linkInvalido`, com as regras que o `pedir` tem para cada um: depois dos três primeiros, o canal continua aberto e a página pode mandar outro `entrar`; depois do `linkInvalido`, o canal fecha (1000). Ele nunca responde `naoComecou`, `aguardando` nem `recusado`: uma reunião parada começa. Um `entrar` depois do `aceito` responde `{"tipo": "erro", "erro": "invalido"}`, e o canal continua.
- **A pessoa e o computador são lidos de novo no `entrar`:** o nome que vai à reunião é o do cadastro naquela hora. A pessoa que saiu do chat depois do abrir, ou o computador do passe desligado do chat depois dele, não entra: o `entrar` responde `{"tipo": "erro", "erro": "invalido"}`, e o servidor fecha o canal (1000).
- **O participante do colega** nasce como o do `entrar` do app: `deFora` falso, o nome do cadastro, a pessoa e o computador do passe. Para o resto do protocolo, aquele computador chamou o `entrar`: ele recebe os eventos da seção 11, e as rotas "Com a pessoa na reunião" (seção 9) valem para a pessoa. Na lista, no palco e no chat da reunião, ele é um colega como o do app.
- **Depois do `aceito`,** o canal é o de uma página aceita: o `senha`, o `tela`, o `camera`, o `mensagem`, o `palco` e o `voltar` valem como acima.
- **O `voltar` de um colega continua de colega.** Quem diz isso é o participante, e não o bilhete: o canal novo, aberto com o bilhete de um abrir sem corpo, volta pelo `voltar` com a chave de volta do colega, e nele o `aceitar`, o `recusar`, o `tirar`, o `encerrar`, o `participantes` e o `pausa` valem como no canal de antes. O `entrar` e o `pedir` nele são fora de ordem, como depois de qualquer `voltou`.
- **O `participantes`** vai às páginas de colega aceitas, com o canal aberto e com a câmera do participante na reunião: quando ela entra, logo depois de um `voltou` (se a câmera está na reunião) e a cada mudança de uma das duas listas. Uma lista igual à anterior não é mandada de novo. É sempre a lista inteira, como a do `reuniaoParticipantes` (seção 11): quem está na reunião (o Participante da seção 9, com o `voce`) e os pedidos que esperam. O `voce` marca o participante daquele canal. As listas nunca são `null`: sem ninguém, `[]`. A página entrando (sem a câmera na reunião ainda), a de quem saiu e a de quem é de fora não recebem a lista.
- **O `aceitar`, o `recusar`, o `tirar` e o `encerrar`** são as rotas do app com o mesmo nome (seção 9), pelo canal, e seguem as regras delas. Eles valem **pela pessoa:** o colega tem de estar na reunião, por esta página ou por outra (o app, ou outra página da mesma pessoa). Isso vale para o canal que já entrou (o `aceito`) ou que voltou pelo `voltar`, enquanto o participante dele está na memória do servidor: antes do `entrar`, ou depois de o participante sair da memória (tirado, ou com a reunião acabada), eles respondem `{"tipo": "erro", "erro": "invalido"}`, e não o `recusa`. O `pedido` e o `participante` são ids de 16 caracteres hexadecimais minúsculos. Quando falham, vem o `recusa`, com o `de` (o tipo da mensagem que falhou) e o `motivo`, e o canal continua:
  - `jaRespondido`: o pedido já foi aceito, recusado, retirado ou venceu (outro colega respondeu antes, pelo app, pelo aviso ou por outra página);
  - `naoEncontrado`: o pedido, ou o participante, não existe;
  - `cheia`: a reunião já tem 10 pessoas, no `aceitar`; o pedido continua esperando;
  - `foraDaReuniao`: a pessoa não está na reunião;
  - `servidorVideo`: o servidor de vídeo não está no ar para o chat, ou falhou no `tirar` ou no `encerrar`.
- **O `feito`.** Quando o `aceitar`, o `recusar` ou o `tirar` dá certo, o servidor manda `{"tipo": "feito", "de": "<o tipo da resposta>", "id": "<o pedido, ou o participante>"}` ao canal que respondeu, e só a ele, logo depois de a resposta funcionar. O `encerrar` que dá certo não tem `feito`: o `encerrada` é o fim. A ordem entre o `feito` e o `participantes` novo não é garantida, e a página não conta com ela. A página diz o resultado ("O pedido de <Nome> foi aceito" ou "foi recusado", "<Nome> saiu da reunião") só quando o `feito` chega, e não o deduz da lista, que erra quando dois colegas respondem juntos. Ela também não manda outra vez uma resposta que já espera o `feito`, e esquece as que esperam quando o canal cai.
- **A pessoa e o computador são lidos de novo a cada resposta,** como as rotas do app fazem a cada pedido, também no canal que voltou pelo `voltar` (o computador é o do participante). O `aceitar`, o `recusar`, o `tirar` ou o `encerrar` de uma pessoa que saiu do chat depois de entrar, ou de um computador desligado do chat, responde `{"tipo": "erro", "erro": "invalido"}`, nada muda na reunião, e o servidor fecha o canal (1000).
- **A resposta que a página não consegue mandar** (o canal caiu e ela tenta voltar a ele: a página não desiste por conta própria, e o colega cujo canal não volta mais recebe o aviso de quem deixou de cuidar, abaixo, e não esta frase) não vai ao servidor: a página do colega mostra o aviso curto "O servidor de reuniões não respondeu", como para o `recusa` com o `servidorVideo`. Para ela não chegar a isso, enquanto a página não tem o canal (e tenta voltar a ele), os botões que respondem ficam desligados: o `Aceitar`, o `Recusar`, o `Tirar` (o da lista e o da pergunta) e o `Encerrar para todos` (no painel e na pergunta dele). O `Ver os pedidos` e o `Voltar` das perguntas continuam ligados, e o painel diz "Os pedidos voltam quando a conexão voltar.". O leitor de tela ouve essa frase uma vez a cada vez que as respostas desligam, na tela da reunião, com a conexão de pé e algo para responder à vista (o painel "Participantes" aberto, ou um pedido esperando); com a ligação caída, quem fala é o aviso da queda, e quem deixou de cuidar ouve o aviso dele. Antes de a primeira lista chegar, a parte "NA REUNIÃO" do painel não aparece, e o `Encerrar para todos` fica desligado.
- **O aviso de quem deixou de cuidar.** A página do colega que não tem mais como cuidar da reunião (acima, "O chat que reinicia") mostra, no lugar do cartão "<Nome> quer entrar", o título "Você deixou de cuidar desta reunião" e o texto "Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app."; no painel "Participantes" ele toma o lugar das listas e do `Encerrar para todos`. O leitor de tela o ouve uma vez. A ligação continua, e o aviso fica até a pessoa sair da reunião. **Quando o motivo é o link que deixou de valer** (a reunião acontecendo depois do `valeAte`, ou cancelada), o título é "O link desta reunião deixou de valer" e o texto é "Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar."; no painel "Participantes" e para o leitor de tela, o aviso é o título, um ponto, um espaço e o texto. O aviso de sempre fica para os outros motivos (o chat que reiniciou, a chave de volta recusada e a entrada de novo que não dá certo dentro do app). Com o aviso do link à vista, nenhum outro motivo o troca pelo de sempre: o link continua vencido.
- **O que o leitor de tela ouve.** A página tem uma região só para ele (`role="status"`, `aria-live="polite"`). Cada aviso entra nela como um trecho próprio, no fim, e o que estava nela fica: dois avisos seguidos são lidos os dois, e o mesmo aviso dito de novo é lido de novo. A região guarda os quatro avisos mais novos; ao entrar o quinto, o mais velho sai. Tudo o que a página diz passa por ela: os resultados e os pedidos novos do colega, a frase das respostas desligadas, o aviso de quem deixou de cuidar, as mensagens do chat, a mudança de tela e a conexão caída.
- **Os campos que não valem:** um `aceitar` ou um `recusar` sem o `pedido`, ou um `tirar` sem o `participante`, ou com um que não é um id assim, responde `{"tipo": "erro", "erro": "invalido"}`, e o canal continua.
- **Num canal que não é de colega** (o de quem é de fora, antes ou depois do aceito, e o que voltou pelo `voltar` dele), as cinco mensagens novas respondem `{"tipo": "erro", "erro": "invalido"}`, e nada muda. **Num canal de colega,** o `pedir` e o `desistir` respondem o mesmo: o colega não espera na sala de espera.
- **O `pausa`** é a pausa da rota do app (seção 9): ele chega às páginas de colega daquela pessoa e daquele computador naquela reunião, aceitas, com o canal aberto, na reunião ou entrando nela. O `pausada` verdadeiro põe a reunião em pausa, e o falso a tira dela, qualquer que seja o `vez`. O que a página faz com ele está em "A página dentro do app", abaixo.

**A página dentro do app.** A interface do app do Windows mostra a página num `iframe`, com o endereço `/r/<código>` e nada mais (o passe nunca vai no endereço do `iframe`). A página e o app falam por mensagens (`postMessage`).
- **Quem pode mostrar a página dentro de si.** A resposta de `/r/<código>` leva, na regra de segurança (CSP), o `frame-ancestors https://app.starsonic.local`: a origem da interface do app, que não existe na internet. Em produção, é a única: nenhum outro site mostra a página dentro de si, e as origens do CORS da configuração (seção 1) não entram aqui. Só no modo de teste do servidor entram também as origens do `--origem`, depois da do app.
- **O `meta`.** A página fica sabendo dessas mesmas origens por um `<meta name="starsonic-app" content="https://app.starsonic.local">` no HTML que o servidor entrega, com as origens separadas por espaço.
- **As mensagens** são sempre um objeto com `"starsonic": 1` e o `tipo`. A página só fala com a janela de cima, e só aceita o que vem dela, com uma das origens do `meta`; quando o navegador diz qual é a origem de cima, ela manda só a ela. Fora de um `iframe` com uma dessas origens, a página não ouve nem manda nada. Um `tipo` desconhecido é ignorado, dos dois lados: o protocolo só cresce.

| De quem | `tipo` | O que leva | Para quê |
|---|---|---|---|
| página | `pronta` | — | A página carregou e quer um passe. Ela manda ao carregar; de novo, uma vez, quando o passe ou a chave do colega não vale (o `401 passe`); e no meio da reunião, quando o chat reiniciou (abaixo, "A entrada de novo dentro do app"). O app responde a todo `pronta` com um passe novo |
| app | `passe` | `passe`, `aparelhos` | O passe (43 caracteres base64url), e os nomes dos aparelhos das Configurações do app. A página só o aceita depois de um `pronta`, enquanto espera |
| app | `aparelhos` | `aparelhos` | A pessoa trocou um aparelho nas Configurações: na entrada, a prévia muda; na reunião, o microfone e a câmera da ligação mudam |
| página | `estado` | `fase` (`entrada`, `naReuniao` ou `fora`), `microfone` (verdadeiro ou falso) | A cada mudança de um dos dois, e nunca enquanto a página carrega. O `microfone` é o que os outros ouvem. O `fora` é a página no "Você saiu da reunião" depois de uma queda |
| página | `fim` | `motivo` (`saiu`, `tirado`, `acabou` ou `linkInvalido`) | A reunião acabou para a pessoa depois de ela entrar. O `saiu` é o do botão "Sair" e o da resposta ao `sair` |
| página | `link` | `url` | A pessoa clicou num link do chat da reunião: o app o abre no navegador padrão. A página não abre nada |
| app | `pausar` e `retomar` | — | Uma ligação da central começou ou acabou |
| app | `bloqueio` | `ligado` (verdadeiro ou falso) | A sessão do Windows bloqueou ou voltou: a página desliga a câmera, ou a devolve ao que era |
| app | `sair` | — | A pessoa confirmou o fechar: a página sai da reunião (ou desiste do pedido) e responde `fim`, com o `saiu`, sempre |

- **Os `aparelhos`** são um objeto `{"microfone": "<nome>", "altoFalante": "<nome>", "camera": "<nome>"}`, cada nome um texto de até 200 caracteres. Um campo que falta, ou vazio, é o padrão do sistema. Um nome que não é texto, ou que passa de 200 caracteres, conta como um nome que falta (o padrão do sistema para aquele aparelho), e `aparelhos` que faltam ou não são um objeto contam como `{}`: nem o `passe` nem o `aparelhos` são ignorados por isso. O `passe` só é recusado pelo que é dele, o formato (43 caracteres base64url). O app continua mandando sempre os `aparelhos`; para os do padrão, ele manda `"aparelhos": {}`. A página procura cada nome entre os aparelhos do navegador; sem achar, usa o padrão. O alto-falante é o do som da reunião.
- **O passe que não vem.** Sem o `passe` em 15 segundos depois do `pronta`, ou com dois passes seguidos que não valem, a página abre como quem é de fora, com a faixa "Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.". O primeiro que não vale (o passe que venceu antes de a página carregar, ou a chave do colega que deixou de valer porque o chat reiniciou) só pede outro, com um `pronta`.
- **A entrada de novo dentro do app.** O chat que reiniciou com o colega na reunião e a ligação no ar (acima, "O chat que reinicia") não vira o aviso: a página entra de novo sozinha, e a pessoa continua vendo e ouvindo.
  1. A página limpa o que só o canal servia (a lista, as perguntas, o palco) e manda o `pronta` no meio da reunião. O app responde com um passe novo (seção 10, a tabela), e a página espera até 15 segundos por ele.
  2. Com o passe, ela chama o abrir (que reconhece o colega e dá uma chave e um bilhete novos), abre o canal e manda o `entrar`: do abrir ao `aceito` há 10 segundos. Enquanto isso, a ligação de antes segue no ar, e o canal novo ainda não é o da pessoa.
  3. No `aceito`, a página troca a ligação pela volta de uma queda: a tela "A conexão caiu. Entrando de novo…" por alguns segundos, 2 segundos de espera, uma senha nova (a do `aceito` não é usada) e até 3 tentativas. O microfone e a câmera ficam como estavam; a tela compartilhada não volta sozinha. Para os outros, a pessoa some e volta em alguns segundos, como um participante novo.
  4. O primeiro `401 passe` do abrir pede outro passe. Tudo o mais que falha antes do `aceito` (o passe que não vem em 15 segundos, o segundo `401 passe` seguido, o abrir que falha ou que não reconhece o colega, o canal que fecha, o prazo dos 10 segundos, a recusa do `entrar`) termina no aviso "Você deixou de cuidar desta reunião…", com a ligação de antes ainda no ar.
  5. A volta precisa de um lugar livre na reunião: o `entrar` é uma pessoa a mais, e a ligação de antes ainda conta nas 10 até a nova subir. Numa reunião cheia, o `entrar` recebe o `cheia`, e esse colega vê o mesmo aviso do colega no navegador, como nas outras falhas do passo 4. Depois do `aceito`, a ligação nova que não sobe nas 3 tentativas é o fim de uma queda: "Você saiu da reunião".
- **A pausa dentro do app** é o `pausar` e o `retomar`, sem cartão: quem mostra a ligação é o app. Na pausa, a página desliga o microfone e a câmera (os outros veem o quadro sem imagem, pelo `camera`), cala o som da reunião e para a tela compartilhada; a pessoa continua na reunião. O `retomar` devolve o microfone, a câmera e o som ao que eram antes da pausa; a tela compartilhada não volta sozinha. Dentro do app, a página **ignora o `pausa` do canal**.
- **A pausa no navegador** é o `pausa` do canal do colega. A página faz a mesma pausa e mostra, por cima da reunião, o cartão "Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.", com o "Voltar para a reunião", que a desfaz ali mesmo. A página guarda as últimas 8 `vez` que a pessoa desfez assim, e ignora as repetições delas. O `pausada` falso desfaz a pausa, qualquer que seja a `vez`. A página de quem é de fora ignora o `pausa`.
- **Quando a página obedece.** O `pausar`, o `bloqueio` e o `pausa` do canal valem com a pessoa na reunião (a `fase` `naReuniao`) e também com a página entrando: eles têm efeito na hora, sem esperar a página entrar: o `pausar` e o `pausa` calam o som da reunião e desligam o microfone e a câmera, e o `bloqueio` desliga só a câmera. O `retomar` (ou o `pausa` com o `pausada` falso) devolve o microfone, a câmera e o som ao que eram, e o `bloqueio` com o `ligado` falso devolve a câmera; a câmera só volta quando nenhum dos dois a segura. Quando a ligação vai ao ar, a página acerta a câmera de novo, para ela não subir ligada contra a pausa ou o bloqueio. Fora da reunião e da entrada nela, nada acontece, e nada fica guardado. Por isso **o app repete a pausa e o bloqueio quando a pessoa entra:** a cada `estado` em que a `fase` passa a `naReuniao`, ele manda de novo o `pausar` (enquanto a pausa da ligação dura) e o `bloqueio` com o `ligado` verdadeiro (enquanto a sessão do Windows está bloqueada). No navegador vale o mesmo: o app manda o `pausa` com o `pausada` verdadeiro assim que um evento da seção 11 mostra que o computador entrou numa reunião pelo navegador com uma pausa em curso, sem esperar a repetição dos 10 segundos. E ele não esquece de vez uma reunião por causa de um `409 foraDaReuniao` da rota da pausa: um evento da seção 11 daquela reunião a traz de volta.
- **Quem sai da reunião durante uma pausa** (o "Sair", o tirado, a reunião encerrada, uma queda) fica sem a pausa, com o som de volta, e o microfone e a câmera continuam desligados: no "Entrar de novo", a pessoa volta com os dois desligados.

**A página no navegador, com o passe.** O "Abrir no navegador" do app abre o navegador padrão no endereço da reunião com o passe no fim, depois do `#`:
```
https://<endereço do chat>/r/<código>#p=<passe>
```
- **O formato** é exato: o fim do endereço é `#p=` seguido do passe, 43 caracteres base64url, e nada mais. Qualquer outra coisa depois do `#` não é um passe: a página abre como quem é de fora.
- **A parte depois do `#` nunca vai ao servidor,** nem ao log dele. A página a lê ao carregar e a tira do endereço na hora, antes de qualquer pedido, sem uma entrada nova no histórico (o caminho e a busca ficam). Depois, ela leva o passe no corpo do primeiro abrir, como dentro do app.
- **O passe que não vale** (o `401 passe`) não é pedido de novo: no navegador não há app para mandar outro. A página abre como quem é de fora, com a faixa "Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado." no alto da entrada; num Windows, ela vai antes à tela "o app ou o navegador", com a mesma faixa no alto. A chave do colega que deixa de valer depois (no "Entrar" ou no "Entrar de novo") leva à mesma entrada, com a faixa.
- **O "Abrir no app"** da tela "o app ou o navegador" é um link `starsonic://reuniao/<código>`, com o código do endereço da página escrito como o servidor o escreve: em minúsculas e sem espaços. O servidor abre a reunião também com o código do endereço em maiúsculas, e o link leva sempre o código exato. O app o recebe e mostra a entrada daquela reunião; a página fica na tela, e a pessoa ainda pode escolher o "Entrar pelo navegador".

## 11. Os eventos das reuniões (no WebSocket do app, seção 7)
```json
{"tipo": "reuniaoAgora", "reuniao": <Reunião>, "de": <Pessoa>}             // o "Gerar link" de um colega: entre e largue a chamada com ele
{"tipo": "reuniaoPedido", "reuniao": "<codigo>", "pedido": <Pedido>}       // alguém pediu para entrar
{"tipo": "reuniaoPedidoFim", "reuniao": "<codigo>", "pedido": "<id>"}      // o pedido foi respondido, retirado ou venceu
{"tipo": "reuniaoParticipantes", "reuniao": "<codigo>", "participantes": [<Participante>…], "pedidos": [<Pedido>…]}
{"tipo": "reuniaoAcabou", "reuniao": "<codigo>"}                           // a reunião parou ou acabou
```
- Os quatro últimos vão só para os computadores que estão na reunião: os que chamaram o `entrar` e cujo participante está nela. O `reuniaoAcabou` vai para os que estavam nela.
- **O computador do passe conta como o que chamou o `entrar`:** quando o colega entra pela página (o `entrar` do canal do colega, seção 10), no app ou no navegador, os eventos vão ao computador que pediu o passe, como se ele tivesse entrado pela rota do app. É assim que o app fica sabendo dos pedidos de uma reunião aberta no navegador, e que o "Aceitar" do aviso do Windows vale para ela.
- **Quando a conexão dos eventos volta** (seção 7) e o app está numa reunião, ele pede o `participantes` dela. Um `409 foraDaReuniao` quer dizer que o chat não sabe mais dele (o servidor do chat reiniciou, seção 9): o app sai da ligação e chama o `entrar` de novo, que dá um participante novo. **Nota de 23/11:** isso é do app que entraria pela reunião com o motor dele, o caminho que ficou para trás. O app `0.5.0` não entra pela rota `entrar`: quem entra é a página, no `iframe` ou no navegador (seção 10). O que a página faz quando o chat reinicia com um colega na reunião (a `partida`, o aviso e a entrada de novo dentro do app) está na seção 10, em "O chat que reinicia"; as rotas do app e os eventos desta seção não mudaram.
- O `reuniaoParticipantes` sai a cada mudança das duas listas.
- O `reuniaoAgora` vai para os computadores conectados dos colegas convidados.

## 12. Os limites das reuniões
| O quê | Quanto |
|---|---|
| Pessoas por reunião | 10, sem contar a tela compartilhada |
| Reuniões ao mesmo tempo | 2 por padrão, de 1 a 20 na administração, em todo o servidor |
| Tentativas de abrir | 20 por minuto por endereço, contando só as que não levam a uma reunião em que a pessoa possa entrar: o `entrar` e o `passe` do app que dão `404`, `outraEmpresa` ou `semReunioes`, junto com o abrir da página que falha (o `404`, o `400 invalido` e o `401 passe`) e o `voltar` da página que falha (seção 10). Passou disso, `429 tentativas`, até com um código certo. O `entrar` e o abrir que dão certo, e o `cheia`, o `servidorCheio` e o `servidorVideo` de um código bom, não contam nessas 20. O abrir da página que dá certo tem a janela dele: 60 por minuto por endereço, e o 61º recebe o mesmo `429 tentativas`. As duas janelas são separadas |
| Mensagens da página | 20 por minuto por canal, sem o `camera` e sem o `mensagem`. A 21ª recebe `erro` `limite` e é ignorada |
| As mensagens do chat da reunião (`mensagem`) | 20 por minuto por participante (as repassadas, por qualquer canal dele: o `voltar` não zera a conta) e 20 por minuto por canal (toda mensagem do tipo, também a recusada), à parte das outras: não gastam as 20 nem os avisos da câmera, e eles não as gastam. A 21ª recebe `mensagemRecusada` com o motivo `limite` e não é repassada |
| Entrando, para o palco e o chat da reunião | as 3 primeiras senhas da câmera seguidas sem a pessoa entrar, a do `aceito` contando. Da quarta em diante, a página só recebe (e só manda) de novo quando a câmera dela entra na reunião, e a conta recomeça |
| O texto de uma mensagem da reunião | de 1 a 1.000 caracteres, sem os espaços das pontas |
| O maior quadro que a página manda | 4.096 bytes. Passando disso, o canal fecha com o código `1009` |
| Os avisos da câmera (`camera`) | 30 por minuto por canal, à parte das 20 mensagens: não gastam as 20, e as 20 não os gastam. O 31º é ignorado, sem resposta. O `camera` que não vale (sem o `ligada`, ou com ele sem ser verdadeiro ou falso) também conta nos 30 e recebe `erro` `invalido` |
| A senha de uso único | 30 segundos, uma vez só, no relógio do servidor de vídeo |
| A espera de quem é de fora | 10 minutos depois de o pedido chegar aos colegas |
| A sala de espera | 50 pedidos esperando por reunião. O 51º `pedir` recebe `esperaCheia` |
| A naHora sem ninguém | acaba 10 minutos depois de criada |
| Reuniões marcadas por pessoa | 100 que ainda valem |
| Reuniões na hora por pessoa | 10 abertas |
| As credenciais do TURN | 12 horas |
| O `assunto` | 120 caracteres |
| A reunião guardada | até 30 dias depois do fim da validade: o `valeAte`, o cancelamento ou o fim da naHora |
| Os nomes de quem é de fora | só na memória do servidor, e somem quando a reunião acaba |
| O passe | 43 caracteres base64url (32 bytes); 120 segundos; uma vez; para uma reunião, uma pessoa e um computador; só na memória |
| Passes por computador | 10 por minuto; o 11º recebe `429 tentativas`, com `esperarSegundos` |
| A chave do colega | 43 caracteres base64url (32 bytes); 12 horas; só na memória; até 50 por computador (a 51ª apaga a mais velha) |
| O bilhete de um colega | o bilhete do abrir (30 segundos, uma vez), preso ao colega: abre o canal do colega |
| O corpo do abrir | até 256 bytes, com um campo só, `passe` ou `colega` |
| O `vez` da pausa | de 1 a 32 letras ou números (`[A-Za-z0-9]`) |
| As mensagens do canal do colega | o `entrar`, o `aceitar`, o `recusar`, o `tirar` e o `encerrar` contam nas 20 mensagens por minuto do canal |
| O passe que o app não manda | a página espera 15 segundos depois do `pronta`; sem o passe, abre como quem é de fora. No `pronta` do meio da reunião (o chat reiniciou), sem o passe, ela mostra o aviso "Você deixou de cuidar desta reunião…", com a ligação no ar |
| As vezes de pausa desfeitas que a página lembra | as últimas 8 |

- **Uma reunião "acontecendo"** tem ao menos uma pessoa com a câmera nela. Uma "começando" tem a senha de um colega emitida e ainda não usada. As duas contam no limite de reuniões ao mesmo tempo.
- **As pessoas de uma reunião** são as que estão nela, mais as senhas de pessoa emitidas e ainda não usadas.
