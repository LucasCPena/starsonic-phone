# Reuniões com link, etapa 1a — os dois servidores — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o servidor de vídeo 0.1.0 (o FreeSWITCH do nosso build, o agente de vídeo, o coturn, a configuração, o instalador e o guia) e a parte das reuniões do servidor do chat 0.2.0 (as regras, a API do app, a API e o canal da página, o cartão "Reuniões" e a reunião de teste), provados de ponta a ponta por dois navegadores com câmera falsa num cliente mínimo de teste. A página de verdade é a etapa 1b.

**Architecture:**
- **O servidor de vídeo** (`video-servidor/`), uma VM só para ele:
  - o FreeSWITCH 1.11.3, montado pelo nosso GitHub a partir do código oficial, com o sofia-sip e o spandsp que ele pede, para o Ubuntu 24.04 e o Debian 12, em `/opt/starsonic-freeswitch`;
  - a reunião é uma conferência do `mod_conference` com o mosaico montado no servidor (spec 6.2);
  - o agente (`starsonic-video`, Go, só a biblioteca padrão):
    - escuta a 443 com o certificado do Let's Encrypt: o `/sip` do navegador vai ao WebSocket do FreeSWITCH, e a API do chat fica em `/agente/v1/`;
    - responde ao FreeSWITCH pelo `mod_xml_curl` quem entra em qual reunião, conferindo a senha de uso único;
    - acompanha as conferências pelo ESL e manda ao chat quem entrou e quem saiu;
  - o coturn da distribuição, com a nossa configuração;
  - o certbot, que tira e renova o certificado dos três.
- **O servidor do chat** (`chat-servidor/`, 0.2.0) ganha as reuniões:
  - o banco (a migração 0002) e um gerente na memória: a sala de espera, as senhas, os limites e quem está em cada reunião;
  - a API do app, a API e o canal da página (sem a página), o cartão "Reuniões" da administração e a reunião de teste;
  - um cliente do agente, com os eventos sempre abertos.
- **Os contratos** são `docs/chat-protocolo.md` (as seções 9 a 12, novas) e `docs/video-agente.md`. Os dois foram escritos junto com este plano.
- **O teste de ponta a ponta** (`video-servidor/e2e/`) sobe o FreeSWITCH do nosso build com a nossa configuração, o agente e o chat. Dois a quatro Chromium com câmera e som falsos entram por um cliente mínimo (o JsSIP), e o teste confere o mosaico, o som, a sala de espera, a tela compartilhada, o tirar e o Encerrar para todos.

**Tech Stack:**
- Go: `go 1.26.0` e `toolchain go1.27.3` nos dois módulos; o chat sem dependência nova, e o agente só com a biblioteca padrão.
- FreeSWITCH v1.11.3, sofia-sip v1.13.18 e spandsp v3.1.1, do código oficial; o coturn e o certbot do apt.
- systemd, GitHub Actions (com contêineres `ubuntu:24.04` e `debian:12`).
- Node 22, `@playwright/test` 1.56.1 (o Chromium) e `jssip` 3.13.8 (MIT), só nos testes de ponta a ponta.

**Spec:** `docs/superpowers/specs/2026-11-12-starsonic-phone-reunioes-link-design.md`, aprovada pelo responsável em 12/11/2026.
- **Valem nesta etapa:**
  - 4.2 (as regras que o servidor guarda) e 4.3 (o cartão "Reuniões", sem a parte do app);
  - 6.1 a 6.3 e 6.4 (o que a página usa do servidor);
  - 7, 8 (a parte dos servidores), 9, 11.1 (os itens 1, 3, 4 e 6, no servidor) e 11.2 (o chat, o agente e o de ponta a ponta);
  - 12, a etapa 1, menos a página.
- **Ficam para a 1b, depois do quadro "Starsonic — reunião no navegador" aprovado:** 4.1 (a página), 10 (os textos da página), 11.1 item 2 (o navegador sem câmera, na tela), 11.3 (o roteiro manual), o teste da página de ponta a ponta e a reunião de teste pelo navegador no guia.
- **Os contratos:**
  - `docs/chat-protocolo.md`, seções 9 a 12, e as linhas novas da seção 2;
  - `docs/video-agente.md`.

  Os nomes, os campos, os erros, os vetores de teste e os limites exatos estão lá. Cada tarefa segue a seção dela.

## Global Constraints
- **Lugar e versão:**
  - o agente é o módulo `github.com/LucasCPena/starsonic-phone/video-servidor`, na pasta `video-servidor/`;
  - o binário é `starsonic-video`, para `linux/amd64`, compilado com `CGO_ENABLED=0`;
  - a versão entra por `-ldflags "-X main.versao=<versão>"`, e vale `0.0.0-dev` sem ela;
  - as reuniões do chat entram no módulo de hoje, em `chat-servidor/`.
- **As dependências:**
  - o agente usa só a biblioteca padrão, também nos testes;
  - o chat não ganha dependência;
  - o e2e usa só o `@playwright/test` 1.56.1, o `@types/node` 22.20.5, o `typescript` 5.9.3 e o `jssip` 3.13.8, com o `package-lock.json`.

  Uma dependência a mais precisa de uma ruling.
- **O FreeSWITCH** (o `video-servidor/deps.lock`):
  - o `signalwire/freeswitch` na tag `v1.11.3`, commit `ef32e205295e29f034f1453ad245ba5efb07b94a` (28/08/2026, a mais nova em 12/11/2026);
  - o `freeswitch/sofia-sip` na tag `v1.13.18`, commit `ad36ac8f755308e8b87f98a505e83d4e408e5cc3`, a versão mínima que o `configure` da 1.11.3 pede (`sofia-sip-ua >= 1.13.18`);
  - o `freeswitch/spandsp` na tag `v3.1.1`, commit `8f1e1646bdec99eac5fd2cd92c35563f736b9b89`, a que ele pede (`spandsp >= 3.1.1`).

  O nosso build não usa os pacotes prontos da empresa que mantém o FreeSWITCH (spec 6.2).
- **Só o VP8 no vídeo e o Opus no som do navegador** (spec 6.2). O H.264 fica fora (spec 13, o risco 2): o `mod_av` e o `mod_openh264` não entram.
- **Os valores da spec 7, exatos:**
  - até 10 pessoas por reunião;
  - 2 reuniões ao mesmo tempo por padrão, ajustável na administração;
  - o mosaico de 1280×720, a 15 imagens por segundo, em VP8;
  - a banda de cada pessoa: cerca de 1,5 Mbit/s para baixo e até 1 Mbit/s para cima;
  - o código do link com 10 letras, sem letras parecidas;
  - a senha de uso único: 30 segundos, uma vez só;
  - até 20 tentativas de abrir links por minuto por endereço;
  - a espera de quem é de fora: até 10 minutos;
  - a validade padrão da marcada: até o fim do dia marcado;
  - a limpeza: 30 dias depois do fim da validade;
  - a VM de vídeo: 6 vCPU, 8 GB de memória, 40 GB de SSD e 100 Mbit/s;
  - as portas da VM de vídeo: TCP 80 e 443, TCP 5061, UDP 3478, TCP 5349 e duas faixas UDP de 300 portas.
- **As portas exatas** são as da seção 1 do `docs/video-agente.md`:
  - a mídia é a UDP 16384–16683, e o relay do TURN, a UDP 49152–49451;
  - o ESL (8021), o WebSocket do FreeSWITCH (5066), o SIP do perfil do navegador (5070) e a discagem do agente (8091) escutam só em `127.0.0.1`.
- **Os sistemas da VM de vídeo:** o Ubuntu 24.04 e o Debian 12 (amd64), os mesmos do guia do chat, cada um com o seu pacote do FreeSWITCH.
- **A segurança** (spec 9):
  - o servidor de vídeo só aceita ligações com a senha de uso único do chat, que vale uma vez só;
  - o `/sip` só aceita a origem da página do chat;
  - o TURN só faz relay para a própria VM;
  - o FreeSWITCH não aceita REGISTER e não tem usuários;
  - nada é gravado: sem os módulos de gravação e de CDR, e o banco interno do FreeSWITCH fica em `/run`;
  - o texto de uma pessoa (o nome) nunca chega à expansão de variáveis do FreeSWITCH: ele vai ao quadro limpo, pela regra da seção 7 do `docs/video-agente.md`.
- **Os registros** (spec 9):
  - nos dois servidores, nunca a chave, uma senha, um bilhete, um nome, um número de telefone, o código de um link, uma sala ou um participante;
  - ficam o método, a rota (o padrão), o status, o tempo, as contagens e os códigos de erro;
  - o FreeSWITCH registra só do nível `warning` para cima, no console (o journal), sem arquivo de log.
- **Neste ambiente:**
  - os comandos `go` rodam com `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`;
  - o Playwright roda com `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
  - os testes do Go são `go test -race ./...`, que pede `CGO_ENABLED=1`. Os builds de publicação continuam com `CGO_ENABLED=0`.
- **O repositório é público:**
  - os nomes de teste são inventados: "ACME Comércio Ltda", "Ana Souza", "Carlos Lima", "Maria Lima", "Bia Ramos", ramais 2001 a 2004, e os endereços `chat.exemplo.com.br` e `video.exemplo.com.br`;
  - nada de nome de parceiro, fornecedor ou cliente, em arquivo, teste ou documento;
  - nada de segredo em arquivo, no CI ou num log. Os workflows não pedem segredo do GitHub, e nenhum é criado.
- **Os textos:** o código, os comentários, os documentos, os nomes dos testes e as mensagens de commit ficam em português, no estilo do `chat-servidor/`.
- **O app não muda:** nada em `windows/`, `starsonic/`, `android/` e `tests/`. A exceção é o `paths-ignore` do `.github/workflows/build.yml` (Task 1).
- **A branch e o GitHub:**
  - o trabalho vai na branch nova `reunioes-etapa-1`, a partir de `main`;
  - o push vai só para ela, sem force, e sem tags, releases nem segredos;
  - quem publica é o responsável, pelos workflows `video-release` e `chat-release`. Este plano nunca publica, nunca roda um instalador numa VM e nunca dispara um workflow de publicação;
  - o `gh` só no REST (`gh api`): o GraphQL está bloqueado;
  - cada Task termina com o CI verde (o `video`, o `chat` e o `build` quando o commit os dispara), conferido pelo `gh api`.
- **Os commits** levam os trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.

## Review Focus
1. **Os relógios das duas VMs diferentes,** por exemplo o chat dois minutos atrás do vídeo. Toda entrada continua funcionando, porque o chat assina o `vence` no relógio do agente, e o cartão "Reuniões" mostra a diferença. Testes: a Task 10 (`TestCliente_RelogioDoAgente`), a Task 11 (`TestSenha_NoRelogioDoAgente`) e a Task 14 (`TestReunioes_Relogio`).
2. **Quem fecha a aba ou perde a rede sem sair.** A ligação cai sozinha pelos 60 segundos sem mídia, o mosaico se arruma, e a vaga volta. Testes: a Task 3 (`TestFreeSWITCH_TempoSemMidia`) e a Task 15 (`quem fecha a aba sai da reunião em até 75 segundos`).
3. **A ligação entre o chat e o vídeo cai, ou o chat reinicia, com reuniões acontecendo.** Na volta, o primeiro `estado` acerta quem está em cada reunião, as contagens e os limites, e ninguém fica "dentro" de uma reunião que acabou. Testes: a Task 10 (`TestCliente_Acompanhar`) e a Task 11 (`TestVideo_Reconciliacao`).
4. **O FreeSWITCH ou o agente reiniciam com reuniões no ar.**
   - Com o FreeSWITCH: cada sala recebe o `acabou`, o chat solta as vagas, e uma reunião nova funciona quando ele volta.
   - Com o agente: ele refaz as salas a partir do FreeSWITCH, e o tirar e o encerrar continuam funcionando.

   Testes: a Task 4 (`TestSalas_Esvaziar` e `TestSalas_Reconstruir`), a Task 7 (`TestESL_Reconecta`) e a Task 11 (`TestVideo_FreeSWITCHCaiu`).
5. **Um nome esquisito digitado por quem é de fora:** `${system(...)}`, chaves, aspas, emoji, 200 letras ou só espaços. O quadro mostra um nome limpo e curto, o FreeSWITCH nunca expande nada, e um nome que não vale responde `invalido`. Testes: a Task 5 (`TestDiscagem_NomeLimpo`) e a Task 13 (`TestCanal_NomeInvalido`).

## O desenho (as decisões desta etapa)
A spec deixa estas escolhas abertas. Cada uma tem a escolha deste plano, e o relatório final as leva ao responsável.
1. **A etapa 1 tem dois planos.**
   - Este (1a) entrega os dois servidores, provados por um cliente mínimo de teste.
   - A 1b entrega a página, que espera o quadro "Starsonic — reunião no navegador" (spec 4.1 e 12).

   Assim, a parte mais longa (o build do FreeSWITCH, o agente e as regras) anda sem esperar o quadro, e o guia sai já. O responsável instala as duas VMs depois da 1a e confere tudo pelo cartão "Reuniões". A reunião de teste pelo navegador chega com a página.
2. **O agente fica na 443.**
   - A spec não dá outra porta para ele, e a 443 é a do WSS do navegador. Então o agente tira o TLS, leva o `/sip` ao WebSocket local do FreeSWITCH, sem mexer nos bytes, e serve a API do chat em `/agente/v1/`.
   - A 80 é só do certbot.
3. **Quem chama é o chat.**
   - O cartão "Reuniões" guarda o endereço do vídeo e a chave, e o chat deixa sempre aberta a conexão dos eventos do agente (Server-Sent Events). É por ela que o agente "avisa o chat" (spec 6.2).
   - O vídeo não precisa do endereço do chat para falar com ele. Precisa só da origem da página, para o `/sip`, que o instalador recebe (`--chat`).
4. **A "chamada de teste" do cartão** (spec 4.3) é um pedido ao agente (`estado`). Ele confere o endereço, a chave, o agente, o FreeSWITCH, a versão, o uso e o relógio. O teste da mídia é a reunião de teste, pela página (1b).
5. **O certificado vem do certbot** (apt), pela 80, porque três programas usam o mesmo: o agente, o FreeSWITCH (a 5061) e o coturn (a 5349).
   - Um gancho do certbot copia o certificado para os três e recarrega cada um sem derrubar ninguém.
   - O agente recarrega pelo `SIGHUP`, e então manda ao FreeSWITCH o `reloadcert`, a API da 1.11.1 que troca o certificado sem desligar as sessões.
   - O coturn recarrega pelo `SIGUSR2`.

   O chat continua com o autocert.
6. **O coturn é o do apt** (Ubuntu e Debian), com as correções de segurança da distribuição. A nossa configuração fecha o relay em toda parte, menos na própria VM.
7. **O FreeSWITCH sai para dois sistemas,** o Ubuntu 24.04 e o Debian 12, os do guia do chat.
   - Os dois têm bibliotecas de nomes diferentes (a libjpeg, por exemplo), então são dois pacotes, e o instalador escolhe o certo.
   - Cada pacote leva a lista dos pacotes do apt de que precisa (`pacotes.txt`), tirada pelo build com o `ldd` e o `dpkg -S`. Um contêiner limpo de cada sistema confere a lista.
8. **A sala no FreeSWITCH** é um id sorteado pelo chat (32 hexadecimais), nunca o código do link. A ligação vai sempre ao usuário `reuniao`, e a senha diz a sala.
9. **Os papéis no FreeSWITCH:**
   - o colega começa a conferência;
   - quem é de fora entra com o `join-only`, sem começar uma reunião sozinho;
   - a tela entra com o `mute|deaf` e o quadro grande reservado (`reservation_id` `tela`).

   A reunião de teste dá senhas de colega a todos, porque ela não tem colega e qualquer um a começa.
10. **O mosaico:**
    - os layouts são os da seção 7 do `docs/video-agente.md`, de 1 a 12 quadros, sem "floor", para cada pessoa ficar no seu lugar;
    - a apresentação tem a tela em 1067×600 e até 10 pessoas em quadros de 213×120;
    - um codificador serve todos os que usam o mesmo codec (`minimize-video-encoding`), o que dá a folga das 10 pessoas na VM de 6 vCPU.
11. **Quem está sem câmera** ganha o quadro liso de `#1B2333` com o nome (o `video-no-video-avatar`). Toda ligação manda som, também a da tela: o microfone ou um silêncio gerado. O `rtp-timeout-sec` do FreeSWITCH olha o som que chega, então os 60 segundos sem mídia tiram só quem fechou a aba ou perdeu a rede.
12. **A vida de uma reunião no chat:**
    - ela pode estar parada, começando (a senha de um colega emitida, por até 30 segundos) ou acontecendo (alguém com a câmera nela). As duas últimas contam no limite de reuniões ao mesmo tempo;
    - o pedido de quem chega antes de a marcada começar espera sem limite (`naoComecou`). Os 10 minutos contam de quando ele chega aos colegas;
    - a naHora acaba quando fica vazia, com o Encerrar para todos, ou 10 minutos depois de criada se ninguém entrou;
    - a marcada para quando fica vazia, e o link continua valendo;
    - uma reunião que passa do `valeAte` com gente dentro continua, mas não entra mais ninguém.
13. **No app** (as rotas da etapa 2 já existem):
    - a lista mostra só as reuniões marcadas que a própria pessoa criou;
    - só quem criou cancela;
    - o "Gerar link" convida os colegas da chamada pelos ramais;
    - um colega de outra empresa recebe `403 outraEmpresa` no `entrar`, e o app abre o link no navegador, onde ele passa pela sala de espera (spec 9).
14. **A reunião de teste** é uma só por vez, vale 2 horas, não tem empresa nem sala de espera e conta nos limites. A administração a cria, e uma nova cancela a anterior.
15. **O estado das reuniões fica na memória do chat:**
    - os nomes de quem é de fora nunca vão ao banco (spec 6.3);
    - depois de um reinício do chat, o `estado` do agente devolve quem está em cada reunião, sem os nomes.
16. **O código do link fica em minúsculas,** do alfabeto do código da empresa (30 caracteres, cerca de 49 bits).
17. **Os endereços de mídia vêm do endereço do vídeo** que o cartão guarda: `wss://<endereço>/sip`, `sip:reuniao@<host>` e `sips:reuniao@<host>:5061;transport=tls`. No modo de teste, o chat aceita `http://127.0.0.1:<porta>` e dá `ws://`.

## As pastas e as responsabilidades
```
video-servidor/
  go.mod                              o módulo do agente (sem go.sum: nenhuma dependência)
  deps.lock                           o FreeSWITCH, o sofia-sip e o spandsp fixados (repo, tag, commit)
  cmd/starsonic-video/main.go         os subcomandos versao, chave, mostrar-chave, configurar, servir e reunioes
  internal/senha/                     a senha de uso único: assinar, conferir e o uso único
  internal/turn/                      o segredo do coturn
  internal/config/                    o /etc/starsonic-video/config.json
  internal/gerar/                     o freeswitch.xml, o turnserver.conf e o quadro sem câmera, gerados
  internal/esl/ (e esltest/)          o cliente do ESL, e um FreeSWITCH falso para os testes
  internal/salas/                     as reuniões no FreeSWITCH: quem está, os layouts, tirar e encerrar
  internal/discagem/                  a resposta ao mod_xml_curl: quem entra em qual reunião
  internal/api/                       a API do chat (/agente/v1/) e os eventos
  internal/uso/                       a CPU e a memória da VM
  internal/proxy/                     o /sip do navegador
  internal/servidor/                  a 443, a discagem, o ESL, o certificado e o modo de teste
  freeswitch/                         construir.sh, modules.conf, pacotes-de-build.txt, conferir-pacote.sh,
                                      conferir-configuracao.sh e LEIA-ME-FONTES.txt
  deploy/                             instalar.sh, instalar-teste.sh, certificado.sh e as duas unidades do systemd
  e2e/                                o teste de ponta a ponta (Playwright) e o cliente mínimo
chat-servidor/internal/
  banco/migracoes/0002_reunioes.sql   as reuniões, a configuração e a coluna reunioes das empresas
  banco/reunioes.go, configuracao.go  as consultas
  segredo/                            o código do link e os ids em hexadecimal
  video/ (e videotest/)               o cliente do agente, a senha, o TURN, e um agente falso para os testes
  reunioes/                           o gerente: as regras, a sala de espera, os limites e quem está em cada reunião
  api/reunioes.go, pagina.go          a API do app e a da página
  admin/reunioes.go, paginas/reunioes.html   o cartão "Reuniões" e a reunião de teste
  tarefas/                            a limpeza dos 30 dias, na rodada das 04:00
.github/workflows/video.yml, video-release.yml
docs/video-servidor.md (o guia), docs/video-agente.md e docs/chat-protocolo.md (os contratos), docs/build-notes.md
```

## Como rodar os testes
- **O agente:** `cd video-servidor && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 go test -race ./... && go vet ./... && test -z "$(gofmt -l .)"`.
- **O chat:** o mesmo, em `chat-servidor`.
- **Os scripts:** `shellcheck video-servidor/deploy/*.sh video-servidor/freeswitch/*.sh` e `bash video-servidor/deploy/instalar-teste.sh`. Sem o `shellcheck` aqui, o CI confere.
- **O FreeSWITCH, uma vez neste ambiente** (com 2 CPUs leva cerca de 40 minutos; rode em segundo plano):
  ```bash
  xargs -a video-servidor/freeswitch/pacotes-de-build.txt apt-get install -y --no-install-recommends
  bash video-servidor/freeswitch/construir.sh ubuntu-24.04 work/freeswitch-fontes work/freeswitch-saida
  tar -xzf work/freeswitch-saida/starsonic-freeswitch-ubuntu-24.04-amd64.tar.gz -C /
  xargs -a /opt/starsonic-freeswitch/pacotes.txt apt-get install -y --no-install-recommends
  ```
  Se o apt deste ambiente não alcançar a rede, o FreeSWITCH e o e2e ficam só no CI, e o relatório da Task diz isso.
- **De ponta a ponta:**
  ```bash
  cd video-servidor/e2e && npm ci
  NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test
  ```
- **O CI:** `gh api "repos/LucasCPena/starsonic-phone/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'`.

---

## Antes da Task 1: a branch
A etapa 1a roda depois da 3b (spec, decisão 12). Quando ela começar, a `video-etapa-3` provavelmente já entrou no `main`; se não entrou, o plano funciona do mesmo jeito, porque o servidor do chat no `main` é o mesmo da `video-etapa-3`, e nada desta etapa depende do app.
- [ ] O controlador pede ao responsável a aprovação para criar a branch remota `reunioes-etapa-1`. Sem a aprovação, nada é empurrado.
- [ ] Com ela, crie a branch a partir do `origin/main` (num worktree, pelo `superpowers:using-git-worktrees`) e empurre-a: `git push -u origin reunioes-etapa-1`.
- [ ] Confira que a branch tem, num commit de documentos feito pelo controlador:
  - a spec, que hoje só está na `video-etapa-3` (os commits `ce368c2` e `4f11e0e`, que só mexem nela);
  - este plano, em `docs/superpowers/plans/`;
  - os dois contratos: o `docs/video-agente.md` e as seções 9 a 12 do `docs/chat-protocolo.md`.

  Se faltar algum, pare e peça ao controlador.

### Task 1: A fundação do agente: a senha de uso único, o segredo do TURN e o CI

**Files:**
- Create: `video-servidor/go.mod`, `video-servidor/cmd/starsonic-video/main.go` e `main_test.go`
- Create: `video-servidor/internal/senha/senha.go` e `senha_test.go`
- Create: `video-servidor/internal/turn/turn.go` e `turn_test.go`
- Create: `.github/workflows/video.yml`
- Modify: `.github/workflows/build.yml` (o `paths-ignore` do `push`)

**Interfaces:**
- **Produces** (`senha`):
  - `type Papel string`, com `Colega Papel = "colega"` e `Fora Papel = "fora"`;
  - `type Senha struct { V int; Sala, Participante string; Papel Papel; Tela bool; Nome string; Vence int64; ID string }`, com as tags JSON `v`, `sala`, `participante`, `papel`, `tela`, `nome`, `vence` e `id`, nessa ordem;
  - `const Duracao = 30 * time.Second` e `const MaximoAdiante = 60 * time.Second`;
  - os erros `ErrInvalida`, `ErrVencida` e `ErrUsada`;
  - `func Assinar(chave []byte, s Senha) (string, error)` e `func Verificar(chave []byte, texto string, agora time.Time) (Senha, error)`;
  - `func NovoUsoUnico() *UsoUnico`, e `func (u *UsoUnico) Usar(s Senha, agora time.Time) error`, seguro entre goroutines;
  - `func LerChave(texto string) ([]byte, error)` e `func NovaChave() string`.
- **Produces** (`turn`): `func Segredo(chave []byte) string`.
- **Produces** (`main`): `func run(args []string, saida, erros io.Writer) int`, com o `versao` e o `chave`.

- [ ] **Step 1: Os testes da senha** (os vetores são os das seções 3 e 4 do `docs/video-agente.md`).
  - `TestAssinar_Vetor`: com a chave e o JSON do vetor, `Assinar` dá exatamente a senha do vetor.
  - `TestVerificar_Vetor`:
    - às 15:00:29,999 UTC de 12/11/2026, devolve a `Senha` com os oito campos do vetor;
    - às 15:00:30 em ponto, dá `ErrVencida`.
  - `TestVerificar_Recusa`: estes casos dão `ErrInvalida`:
    - um caractere trocado na carga e um na assinatura;
    - a assinatura com outra chave;
    - `""`, `"abc"` e `"a.b.c"`;
    - uma carga bem assinada que não é JSON;
    - um campo a mais;
    - o `v` igual a 2 e o `papel` igual a `chefe`;
    - a `sala` com 31 caracteres ou com letras maiúsculas, o `participante` com 15 e o `id` com 33;
    - o `nome` vazio;
    - o `vence` 61 segundos depois de agora (`MaximoAdiante`).
  - `TestUsoUnico`:
    - a mesma senha duas vezes dá `nil` e depois `ErrUsada`, e outra senha, com outro `id`, passa;
    - com 100 goroutines usando a mesma senha ao mesmo tempo, só uma recebe `nil`;
    - uma senha vencida há mais de 1 minuto sai da memória na próxima chamada (`Tamanho()` volta a 0; o `Tamanho` fica só para o teste, num arquivo `_test.go` do pacote).
  - `TestLerChave`: a chave do vetor dá os bytes 0 a 31. Não valem 42 e 44 caracteres, um `+` ou uma `/`, nem um `=` no fim.
  - `TestNovaChave`: tem 43 caracteres, o `LerChave` aceita, e duas chaves são diferentes.
- [ ] **Step 2: Os testes do TURN e do `main`.**
  - `TestSegredo_Vetor`: o segredo da chave do vetor é `jUpgW2vhPJjDAZkfQQmsj9VP0SF5WNQkmvOFuqmbVt4`.
  - `TestVersao`: o `run([]string{"versao"}, …)` escreve `0.0.0-dev\n` e volta 0. Um subcomando desconhecido volta 2 e escreve o uso em português.
  - `TestChave`: o `chave` escreve uma linha de 43 caracteres que o `LerChave` aceita.
- [ ] **Step 3: Rode o agente** (Como rodar os testes). Esperado: falha, porque nada existe.
- [ ] **Step 4: Escreva o código.**
  - Rode `go mod init github.com/LucasCPena/starsonic-phone/video-servidor`, com `go 1.26.0` e `toolchain go1.27.3`.
  - **O `Verificar`:**
    - corta no único `.`;
    - confere o HMAC com o `hmac.Equal`;
    - lê o JSON com o `DisallowUnknownFields`;
    - confere os campos e as horas.
  - **O `UsoUnico`** guarda os `id` até o `vence` mais 1 minuto.
- [ ] **Step 5: Rode o agente.** Esperado: tudo passa, e o `gofmt -l` não lista nada.
- [ ] **Step 6: O CI.**
  - **O `.github/workflows/video.yml`:**
    - roda num `push` e num `pull_request` com os `paths` `video-servidor/**`, `docs/video-*.md` e `.github/workflows/video*.yml`, e também por `workflow_dispatch`;
    - tem `permissions: contents: read`;
    - o job `agente` roda no `ubuntu-24.04`, com `working-directory: video-servidor`, e usa o `actions/setup-go@v5` com `go-version-file: video-servidor/go.mod`;
    - os passos são o `gofmt -l` (que falha se listar algo), o `go vet ./...`, o `go test -race ./...` e o `go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...`;
    - por último, faz o build com `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o starsonic-video ./cmd/starsonic-video` e sobe o artefato `starsonic-video-linux-amd64`.
  - **No `build.yml`,** o `paths-ignore` do `push` ganha `video-servidor/**`, `docs/video-*.md` e `.github/workflows/video*.yml`, com o comentário `# O servidor de vídeo (o agente e o FreeSWITCH) tem o próprio workflow (video); não compila o Windows.`
- [ ] **Step 7: Faça o commit, o push e confira o CI.** O `video` fica verde. O `build` roda esta vez, porque o próprio `build.yml` mudou, e também fica verde. Depois disso, um push só do `video-servidor/` não dispara mais o `build`.
  ```bash
  git add video-servidor .github/workflows/video.yml .github/workflows/build.yml
  git commit -m "feat(reunioes): a fundação do agente de vídeo, com a senha de uso único, o segredo do TURN e o CI"
  git push origin reunioes-etapa-1
  ```

### Task 2: O FreeSWITCH: o build fixo, os dois pacotes e as fontes

**Files:**
- Create: `video-servidor/deps.lock`, com as três entradas das Global Constraints (`repo`, `tag` e `commit`), no formato do `build/deps.lock`
- Create: `video-servidor/freeswitch/construir.sh`, `modules.conf`, `pacotes-de-build.txt`, `conferir-pacote.sh` e `LEIA-ME-FONTES.txt`
- Modify: `.github/workflows/video.yml` (os jobs `freeswitch` e `freeswitch-conferir`)
- Modify: `docs/build-notes.md` (a seção nova "O FreeSWITCH do servidor de vídeo")

**Interfaces:**
- **Produces:** em `<saída>`, o `starsonic-freeswitch-<sistema>-amd64.tar.gz` e o `.sha256` dele, e o `starsonic-freeswitch-fontes.tar.gz`.
  - O tarball tem `opt/starsonic-freeswitch/` com `bin/freeswitch`, `bin/fs_cli`, `lib/`, `mod/`, `fonts/`, o `pacotes.txt` (os pacotes do apt de que ele precisa, um por linha) e o `VERSOES.txt` (as três tags e os commits).
  - O `<sistema>` é `ubuntu-24.04` ou `debian-12`.
- **Produces:** o artefato `starsonic-freeswitch-<sistema>` (o tarball e o `.sha256`) e o `starsonic-freeswitch-fontes`.

O `modules.conf` tem exatamente estes nove módulos:
```
applications/mod_commands
applications/mod_conference
applications/mod_dptools
codecs/mod_opus
dialplans/mod_dialplan_xml
endpoints/mod_sofia
event_handlers/mod_event_socket
loggers/mod_console
xml_int/mod_xml_curl
```
Sem o `mod_verto` e o `mod_signalwire`, o `configure` não pede a libks (o `configure.ac` da 1.11.3 só a exige para eles).

- [ ] **Step 1: O `construir.sh <sistema> <trabalho> <saída>`**, com `set -euo pipefail`, no jeito do `build/linux/build-pjproject.sh`:
  1. Confere o `<sistema>` pelo `/etc/os-release` (`ubuntu` 24.04 ou `debian` 12). Se não for, para com o nome do sistema achado.
  2. Lê o `video-servidor/deps.lock` com o `lock_value` em `python3 -I`, como no `build-pjproject.sh`.
  3. **As fontes:** para cada projeto (o sofia-sip, o spandsp e o freeswitch), em `<trabalho>/<projeto>`:
     - busca só o commit fixado (`git fetch --depth 1 <repo> <commit>`), ou reaproveita a pasta se o HEAD já for ele;
     - confere o HEAD;
     - roda o `git reset --hard` e aplica, pelo `git apply` e na ordem dos nomes, os `video-servidor/freeswitch/patches/<projeto>/*.patch`. Um patch que não aplica para o build com o nome dele e o commit. A pasta não existe hoje: o laço aceita a falta dela, e o `docs/build-notes.md` diz a regra.
  4. **O sofia-sip e o spandsp:** `./bootstrap.sh`, o `./configure --prefix=/opt/starsonic-freeswitch`, o `make -j"$(nproc)"` e o `make install`. O sofia-sip vai com `--with-glib=no --without-doxygen`.
  5. **O FreeSWITCH:**
     - copia o `modules.conf` para a raiz da árvore, antes do `./bootstrap.sh -j`;
     - roda o `./configure --prefix=/opt/starsonic-freeswitch`, com o `PKG_CONFIG_PATH=/opt/starsonic-freeswitch/lib/pkgconfig` e o `LDFLAGS=-Wl,-rpath,/opt/starsonic-freeswitch/lib`, sem o `--enable-optimization` (assim o pacote roda em qualquer amd64);
     - roda o `make -j"$(nproc)"` e o `make install`.
  6. **A limpeza:**
     - tira de `/opt/starsonic-freeswitch` o `include/`, o `lib/pkgconfig/`, os `*.a` e `*.la`, o `conf/`, o `htdocs/`, o `sounds/`, o `grammar/` e o `scripts/`;
     - roda o `strip --strip-unneeded` nos binários e nos `.so`.
  7. **O `pacotes.txt`:** para cada ELF da pasta, o `ldd`. Cada biblioteca fora de `/opt/starsonic-freeswitch` vira o pacote dela pelo `dpkg -S`, sem o `:amd64`, sem repetir, em ordem.
  8. **O `VERSOES.txt`** e o tarball de `/opt/starsonic-freeswitch`, com o `.sha256`.
  9. **As fontes:**
     - o `git archive --prefix=<projeto>/` de cada um dos três;
     - o `deps.lock`, o `construir.sh`, o `modules.conf`, a pasta `patches/`, se houver, e o `LEIA-ME-FONTES.txt`, que diz como montar com eles (a MPL do FreeSWITCH e a LGPL do sofia-sip e do spandsp pedem as fontes junto com os binários);
     - tudo no `starsonic-freeswitch-fontes.tar.gz`.

  O `pacotes-de-build.txt` tem os pacotes do apt do build, iguais nos dois sistemas:
  - `build-essential`, `autoconf`, `automake`, `libtool`, `libtool-bin`, `pkg-config`, `git`, `python3`, `ca-certificates`, `file`, `yasm` e `nasm`;
  - `libssl-dev`, `libcurl4-openssl-dev`, `libpcre2-dev`, `libspeex-dev`, `libspeexdsp-dev`, `libedit-dev`, `libsqlite3-dev`, `uuid-dev`, `zlib1g-dev`, `libjpeg-dev`, `libldns-dev`, `libopus-dev`, `libpng-dev`, `libfreetype-dev` e `libtiff-dev`.

  Um `configure` que pedir outro pacote mostra o nome dele: o pacote entra na lista, e o commit diz qual foi.
- [ ] **Step 2: O `conferir-pacote.sh <tarball>`.** Ele roda num contêiner limpo do mesmo sistema:
  - extrai o tarball em `/`;
  - instala só os pacotes do `pacotes.txt`;
  - falha se o `ldd` de algum ELF disser `not found`;
  - falha se o `freeswitch -version` não mostrar `1.11.3`;
  - falha se a pasta `mod/` não tiver exatamente os nove `.so` do `modules.conf`.
- [ ] **Step 3: O CI** (o `video.yml`).
  - **O job `freeswitch`:**
    - tem a matriz `sistema: [ubuntu-24.04, debian-12]`, com o contêiner `ubuntu:24.04` ou `debian:12`;
    - instala o `git`, o `ca-certificates` e o `python3` antes do checkout, e o `pacotes-de-build.txt` depois;
    - o cache (`actions/cache`) guarda a saída em `work/freeswitch-saida`, com a chave `freeswitch-${{ matrix.sistema }}-${{ hashFiles('video-servidor/deps.lock', 'video-servidor/freeswitch/**') }}`;
    - sem o cache, roda o `construir.sh`;
    - sobe o artefato `starsonic-freeswitch-<sistema>` e, só no Ubuntu, o `starsonic-freeswitch-fontes`.
  - **O job `freeswitch-conferir`:** precisa do `freeswitch` e tem a mesma matriz, num contêiner limpo. Baixa o artefato e roda o `conferir-pacote.sh`.
- [ ] **Step 4: Rode aqui** o `shellcheck` dos dois scripts e, uma vez, o build local (Como rodar os testes). Esperado: o `freeswitch -version` mostra 1.11.3, e o `conferir-pacote.sh` passa neste Ubuntu 24.04.
- [ ] **Step 5: O `docs/build-notes.md`,** a seção "O FreeSWITCH do servidor de vídeo":
  - onde ficam as versões (`video-servidor/deps.lock`), e por que fora do `build/deps.lock` (a chave do cache do Windows e o filtro do `android.yml` leem aquele arquivo);
  - os nove módulos e por que só eles;
  - os dois sistemas, o `pacotes.txt` e a conferência no contêiner limpo;
  - os patches: a pasta `video-servidor/freeswitch/patches/<projeto>/`, com os `*.patch` do `git format-patch` contra o commit fixado, aplicados pelo `git apply` na ordem dos nomes depois de um `git reset --hard` (nenhum hoje; sem patch, a pasta não existe);
  - o pacote das fontes;
  - como trocar de versão: as três tags e os commits, e o `configure` que diz as versões mínimas.
- [ ] **Step 6: Faça o commit, o push e confira o CI.** Os quatro jobs do FreeSWITCH (o build e a conferência, nos dois sistemas) ficam verdes. O primeiro build leva uns 30 minutos; os seguintes vêm do cache.
  ```bash
  git commit -m "feat(reunioes): o FreeSWITCH 1.11.3 montado do código oficial, para o Ubuntu 24.04 e o Debian 12"
  ```

### Task 3: A configuração gerada: o `configurar`

**Files:**
- Create: `video-servidor/internal/config/config.go` e `config_test.go`
- Create: `video-servidor/internal/gerar/gerar.go`, `freeswitch.go`, `camadas.go`, `turn.go` e `gerar_test.go`
- Create: `video-servidor/freeswitch/conferir-configuracao.sh`
- Modify: `video-servidor/cmd/starsonic-video/main.go` (o `configurar` e o `mostrar-chave`)
- Modify: `.github/workflows/video.yml` (o job `freeswitch-configuracao`)

**Interfaces:**
- **Consumes:** `senha.LerChave` e `turn.Segredo` (Task 1).
- **Produces** (`config`):
  - `type Config struct { Endereco, Chat, Chave, SenhaESL, IPPrivado, IPPublico string }`, com o JSON `endereco`, `chat`, `chave`, `senhaEsl`, `ipPrivado` e `ipPublico`;
  - `func Ler(caminho string) (Config, error)`;
  - `func (c Config) OrigemDoChat() string`, que dá `https://` mais o `Chat`;
  - `func (c Config) ChaveCrua() []byte`.
- **Produces** (`gerar`):
  - `func Tudo(c config.Config, saida string, teste bool) error`, que escreve:
    - `<saida>/freeswitch/freeswitch.xml` (0640);
    - `<saida>/freeswitch/sem-camera.png` (0644);
    - a pasta `<saida>/freeswitch/tls/` (0750);
    - `<saida>/turnserver.conf` (0640);
  - `func FreeSWITCH(c config.Config, pastaFS string, teste bool) ([]byte, error)`, `func Turn(c config.Config) []byte` e `func SemCamera() []byte`;
  - as constantes `PortaWS = 5066`, `PortaSIPNavegador = 5070`, `PortaTLS = 5061`, `PortaESL = 8021`, `PortaDiscagem = 8091`, `MidiaInicio = 16384`, `MidiaFim = 16683`, `TurnInicio = 49152` e `TurnFim = 49451`.
- **Produces** (`main`):
  - `configurar --config <arquivo> --saida <pasta> [--teste]`;
  - `mostrar-chave [--config /etc/starsonic-video/config.json]`, que escreve só a chave.

**O `freeswitch.xml`** é um arquivo só, com as seções `configuration` e `dialplan`, sem `vars.xml`. Os valores:
- **`switch.conf`:** `rtp-start-port` 16384, `rtp-end-port` 16683, `max-sessions` 100, `sessions-per-second` 20, `loglevel` `warning`, `colorize-console` `false` e `dump-cores` `no`.
- **`modules.conf`:** os nove módulos da Task 2, nesta ordem de carga: `mod_console`, `mod_event_socket`, `mod_xml_curl`, `mod_sofia`, `mod_commands`, `mod_dptools`, `mod_conference`, `mod_dialplan_xml` e `mod_opus`.
- **`console.conf`:** `loglevel` `warning` e `colorize` `false`.
- **`event_socket.conf`:** `listen-ip` `127.0.0.1`, `listen-port` 8021, a `password` do `SenhaESL` e o `apply-inbound-acl` `loopback.auto`.
- **`xml_curl.conf`:**
  - o binding `starsonic`, com o `gateway-url` `http://127.0.0.1:8091/freeswitch/discagem` e o `bindings="dialplan"`, e o `timeout` 5;
  - os `enable-post-var` `Unique-ID`, `Hunt-Context`, `Hunt-Destination-Number`, `variable_sip_h_X-Starsonic-Senha` e `variable_sofia_profile_name`, e nada mais.
- **`sofia.conf`, o perfil `navegador`:**
  - `sip-ip` `127.0.0.1`, `sip-port` 5070 e `ws-binding` `127.0.0.1:5066`;
  - `rtp-ip` do `IPPrivado`, e `ext-rtp-ip` e `ext-sip-ip` do `IPPublico`;
  - `context` `reunioes`, `dialplan` `XML`, `auth-calls` `false` e `disable-register` `true`;
  - `inbound-codec-prefs` e `outbound-codec-prefs` `OPUS,VP8`, e `inbound-late-negotiation` `true`;
  - `rtp-timeout-sec` 60 e `rtp-hold-timeout-sec` 600;
  - o `apply-candidate-acl` `wan.auto`; no modo de teste, `rfc1918.auto` e `localnet.auto`.
- **`sofia.conf`, o perfil `tls`:** os mesmos valores, menos estes:
  - `sip-ip` do `IPPrivado`, `sip-port` 5080, `tls` `true`, `tls-only` `true` e `tls-sip-port` 5061;
  - `tls-cert-dir` `<pastaFS>/tls` e `tls-version` `tlsv1.2`;
  - os codecs `OPUS,PCMU,PCMA,VP8`;
  - sem o `ws-binding`.
- **`conference.conf`, o perfil `starsonic`:**
  - `rate` 48000, `interval` 20 e `channels` 1;
  - `video-mode` `mux`, `video-layout-name` `group:starsonic-grade`, `video-canvas-size` `1280x720`, `video-fps` 15 e `video-codec-bandwidth` `1.5mb`;
  - `video-canvas-bgcolor` e `video-letterbox-bgcolor` `#04060E`, e `video-no-video-avatar` `<pastaFS>/sem-camera.png`;
  - `max-members` 12, `conference-flags` `minimize-video-encoding`, `verbose-events` `true` e `caller-controls` `none`;
  - nenhum parâmetro `*-sound`, `auto-record` ou `cdr-log-dir`.
- **`conference_layouts.conf`:** os sete layouts e o grupo da seção 7 do `docs/video-agente.md`. Nenhuma `image` tem `floor`, e só a tela da apresentação tem `reservation_id`.
- **O dialplan:** o contexto `reunioes`, com uma extensão só, que responde `503` (`respond` `503 Service Unavailable`). É o que vale quando o agente não responde ao `mod_xml_curl`.

**O `turnserver.conf`:**
- `listening-port=3478`, `tls-listening-port=5349`, `listening-ip` e `relay-ip` do `IPPrivado`;
- `external-ip=<IPPublico>/<IPPrivado>`, só quando os dois são diferentes;
- `min-port=49152` e `max-port=49451`;
- `fingerprint`, `use-auth-secret`, `static-auth-secret=<turn.Segredo>` e `realm=<Endereco>`;
- `cert=/etc/starsonic-video/tls/turn-certificado.pem` e `pkey=/etc/starsonic-video/tls/turn-chave.pem`;
- `no-tcp`, `no-dtls`, `no-tlsv1`, `no-tlsv1_1`, `no-multicast-peers`, `no-cli` e `no-tcp-relay`;
- `denied-peer-ip=0.0.0.0-255.255.255.255` e `denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff`;
- `allowed-peer-ip` do `IPPrivado` e do `IPPublico` (uma linha só, se são iguais);
- `user-quota=12`, `total-quota=1200` e `syslog`.

O `no-cli` vale nos coturn do apt (4.6); a 4.18 o tirou, e o comentário no gerador diz isso.

- [ ] **Step 1: Os testes** (`gerar_test.go` lê o XML com o `encoding/xml`; `config_test.go`).
  - `TestConfig_Ler`:
    - um arquivo certo é lido;
    - estes não valem, e cada um dá um erro que diz o campo:
      - o `endereco` com `https://`, com porta ou sem ponto;
      - o `chat` com caminho ou com `https://`. O `chat` aceita um nome com porta ou um IPv4 com porta;
      - a `chave` que o `LerChave` recusa;
      - a `senhaEsl` com menos de 24 caracteres;
      - um IP que não é IPv4;
      - uma chave a mais no JSON.
  - `TestFreeSWITCH_Modulos`: são exatamente os nove, na ordem de carga. Não aparece nenhum `mod_cdr_csv`, `mod_xml_cdr`, `mod_logfile`, `mod_sndfile`, `mod_verto`, `mod_signalwire` nem `mod_av`.
  - `TestFreeSWITCH_Portas`: a mídia, o ESL com a senha, o `ws-binding`, o `tls-only` com a 5061, o 5070 em `127.0.0.1` e o `gateway-url`, com os valores acima.
  - `TestFreeSWITCH_Conferencia`: cada parâmetro do perfil `starsonic` acima, e nenhum `*-sound`, `auto-record` ou `cdr-log-dir`.
  - `TestFreeSWITCH_Camadas`: os quadros de cada layout lidos do XML são os da tabela, o grupo tem os seis na ordem, nenhum quadro tem `floor`, e o `reservation_id` `tela` só aparece na tela da apresentação.
  - `TestFreeSWITCH_TempoSemMidia` (Review Focus 2): os dois perfis têm o `rtp-timeout-sec` 60.
  - `TestFreeSWITCH_ModoDeTeste`: com `teste`, o `apply-candidate-acl` é `rfc1918.auto` e `localnet.auto`; sem ele, só `wan.auto`.
  - `TestFreeSWITCH_IPs` e `TestFreeSWITCH_Codecs`: os valores acima.
  - `TestTurn`:
    - cada linha acima;
    - o `static-auth-secret` igual ao vetor da seção 4 com a chave do vetor;
    - com os dois IPs iguais, sem o `external-ip` e com um `allowed-peer-ip` só.
  - `TestSemCamera`: o PNG lido pelo `image/png` tem 640×360, e todos os pixels são `#1B2333`.
  - `TestConfigurar` (no `main`): o `configurar` escreve os quatro itens, com as permissões acima, e volta 0. O `mostrar-chave` escreve a chave.
- [ ] **Step 2: Rode o agente.** Esperado: falha.
- [ ] **Step 3: Escreva o código.** Os modelos ficam no Go, com o `text/template` e o `embed`. Todo valor que vai num atributo passa pelo escape do XML.
- [ ] **Step 4: O `conferir-configuracao.sh <starsonic-video> <tarball>` e o job `freeswitch-configuracao`.**
  - **O script, num contêiner limpo do sistema:**
    - instala o pacote como no `conferir-pacote.sh`;
    - escreve um `config.json` de teste, com o IP do contêiner, e roda o `configurar --teste`;
    - sobe o `freeswitch -c -nonat -conf … -log … -db … -run … -temp … -certs …`, com a saída num arquivo;
    - espera o ESL, por até 30 segundos;
    - confere, pelo `fs_cli -p <senha> -x`:
      - o `sofia status` mostra os perfis `navegador` e `tls` como `RUNNING`;
      - o `module_exists mod_conference` dá `true`;
    - confere que o arquivo não tem nenhuma linha `[ERR]` nem `[CRIT]`. Uma linha assim que não venha da nossa configuração vai ao controlador, com o texto dela, antes de qualquer exceção no script;
    - desliga.
  - **O job:** precisa do `agente` e do `freeswitch`, com a mesma matriz de sistemas, e roda o script.
- [ ] **Step 5: Rode o agente e, com o FreeSWITCH local, o `conferir-configuracao.sh`.** Esperado: tudo passa.
- [ ] **Step 6: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): a configuração do FreeSWITCH e do coturn, gerada pelo agente"
  ```

### Task 4: O ESL e as salas

**Files:**
- Create: `video-servidor/internal/esl/esl.go`, `esl_test.go` e `esltest/esltest.go`
- Create: `video-servidor/internal/salas/salas.go` e `salas_test.go`

**Interfaces:**
- **Produces** (`esl`):
  - `type Evento map[string]string` e `var ErrDesligado`;
  - `func Conectar(ctx context.Context, endereco, senha string) (*Conexao, error)`;
  - `func (c *Conexao) API(ctx context.Context, comando string) (string, error)`;
  - `func (c *Conexao) Eventos() <-chan Evento`;
  - `func (c *Conexao) Fechar() error`.
- **Produces** (`esltest`), um FreeSWITCH falso:
  - `func Novo(t testing.TB, senha string) *Servidor`, em `127.0.0.1:0`;
  - `Endereco() string`, `Mandar(ev esl.Evento)`, `Responder(prefixo, resposta string)`, `Comandos() []string` e `Derrubar()`.
- **Produces** (`salas`):
  - `type API interface { API(ctx context.Context, comando string) (string, error) }`;
  - `type Aviso struct { Tipo, Sala, Participante string; Tela bool }`, com o `Tipo` igual a `entrou`, `saiu` ou `acabou`;
  - `type Participante struct { Participante string; Tela bool }` e `type Sala struct { Sala string; Participantes []Participante }`, com o JSON da seção 5 do contrato;
  - os erros `ErrNaoEncontrado` e `ErrSemFreeSWITCH`;
  - `func Nova(avisar func(Aviso)) *Salas`;
  - os métodos `Ligar(api API)` (com `nil` quando o ESL cai), `Evento(ctx context.Context, ev esl.Evento)`, `Estado() []Sala` (pela `sala`), `Tirar(ctx, sala, participante string) error`, `Encerrar(ctx, sala string) error`, `Reconstruir(ctx) error` e `Esvaziar()`.

**As regras:**
- **O ESL:**
  - responde ao `auth/request` com `auth <senha>`;
  - assina `event json CUSTOM conference::maintenance`;
  - lê as mensagens pelos cabeçalhos e pelo `Content-Length`;
  - o `API` manda `api <comando>` e espera a `api/response` seguinte, uma de cada vez. Uma resposta que começa com `-ERR` vira um erro, sem o comando no texto;
  - quando a conexão cai, o canal dos eventos fecha, e os `API` esperando recebem `ErrDesligado`.
- **As salas:**
  - **o `add-member`** lê a `Conference-Name` (32 hexadecimais; outro nome é ignorado), o `Unique-ID`, o `variable_starsonic_participante` e o `variable_starsonic_tela`, que a discagem põe e que o `verbose-events` traz;
  - **a ligação da tela:** quando ela entra, o agente manda `conference <sala> vid-layout starsonic-apresentacao` e, se já havia outra tela na sala, `uuid_kill <uuid da anterior>`. Quando a última tela sai, manda `conference <sala> vid-layout group starsonic-grade`;
  - **os avisos:** o `del-member` avisa `saiu`, e o `conference-destroy` avisa `acabou` e esquece a sala;
  - **o `Tirar`** manda `uuid_kill <uuid>` para cada ligação do participante na sala;
  - **o `Encerrar`** manda `conference <sala> hup all`;
  - **o `Reconstruir`** (quando o ESL conecta) lê o `conference json_list` (os campos `conference_name`, `members`, `uuid`) e, para cada ligação, o `uuid_getvar <uuid> starsonic_participante` e o `uuid_getvar <uuid> starsonic_tela`;
  - **o `Esvaziar`** (quando o ESL cai) avisa `acabou` para cada sala e esquece todas.

- [ ] **Step 1: Os testes** (com o `esltest`).
  - `TestConectar`: a senha certa conecta e assina os eventos (o `esltest` registra os dois comandos). Com a senha errada (`-ERR invalid`), dá erro.
  - `TestAPI`:
    - a resposta volta inteira, também com 70 KB;
    - duas chamadas em goroutines recebem cada uma a sua resposta;
    - um `-ERR no such channel` vira erro;
    - o `Derrubar` no meio de uma chamada devolve `ErrDesligado`, e o canal dos eventos fecha.
  - `TestEventos`: um evento JSON chega como `Evento`, com os valores em texto.
  - `TestSalas_EntrouSaiu`: duas ligações de câmera entram e uma sai. Os avisos são `entrou`, `entrou` e `saiu`, com os participantes, e o `Estado` acompanha.
  - `TestSalas_Tela`:
    - a tela de A entra: o comando é o `vid-layout starsonic-apresentacao`;
    - a tela de B entra: o comando é o `uuid_kill` da de A;
    - a de A sai: nenhum comando;
    - a de B sai: o comando é o `vid-layout group starsonic-grade`.
  - `TestSalas_TirarEncerrar`:
    - o `Tirar` de quem tem câmera e tela manda os dois `uuid_kill`;
    - um participante desconhecido dá `ErrNaoEncontrado`;
    - o `Encerrar` manda `conference <sala> hup all`;
    - sem o `Ligar`, os dois dão `ErrSemFreeSWITCH`.
  - `TestSalas_Acabou`: o `conference-destroy` avisa `acabou` e tira a sala do `Estado`.
  - `TestSalas_Reconstruir` (Review Focus 4): com o `json_list` de duas salas e três ligações, e os `uuid_getvar` respondidos, o `Estado` sai igual ao de antes do reinício do agente, e o `Tirar` acha os uuids.
  - `TestSalas_Esvaziar` (Review Focus 4): com duas salas, saem dois `acabou`, e o `Estado` fica vazio.
  - `TestSalas_IgnoraOutras`: uma conferência com outro nome não muda nada.
- [ ] **Step 2: Rode o agente.** Esperado: falha.
- [ ] **Step 3: Escreva o código.** Uma goroutine lê a conexão e separa a `api/response` (para quem espera, em fila) dos eventos. As salas usam um mutex, e os comandos ao FreeSWITCH saem fora dele.
- [ ] **Step 4: Rode o agente.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): o ESL e as salas do agente, com a tela compartilhada e a volta depois de um reinício"
  ```

### Task 5: A discagem: quem entra em qual reunião

**Files:**
- Create: `video-servidor/internal/discagem/discagem.go` e `discagem_test.go`

**Interfaces:**
- **Consumes:** `senha.Verificar` e `senha.UsoUnico` (Task 1).
- **Produces:**
  - `func Nova(chave []byte, uso *senha.UsoUnico, agora func() time.Time) http.Handler`, para o `POST /freeswitch/discagem` (Task 7);
  - `func LimparNome(nome string) string`, a regra da seção 7 do contrato.

**A resposta** (um `document type="freeswitch/xml"`):
- **Um pedido que não é da discagem:** a `section` diferente de `dialplan`, ou o `Hunt-Context` diferente de `reunioes`. Responde o documento "não encontrado" (`<section name="result"><result status="not found"/></section>`).
- **O `Hunt-Destination-Number` diferente de `reuniao`:** a extensão só com `respond` `404 Not Found`.
- **Uma senha que falta ou não vale** (`Verificar` ou `Usar` com erro): a extensão só com `respond` `403 Forbidden`.
- **Uma senha que vale:** a extensão no contexto `reunioes`, com estas ações, nesta ordem:
  1. `set` `starsonic_participante=<participante>`;
  2. `set` `starsonic_tela=<true|false>`;
  3. `set` `video_banner_text={font_scale=0.25,min_font_size=8,max_font_size=20,fg=#FFFFFF,bg=#04060E}<LimparNome(nome)>`. Na tela, o texto é `Tela de <LimparNome(nome)>`;
  4. `set` `rtp_video_max_bandwidth_in=1mb`;
  5. só no perfil `tls` (`variable_sofia_profile_name`): `set` `rtp_secure_media=mandatory:AES_CM_128_HMAC_SHA1_80`;
  6. só na tela: `set` `video_reservation_id=tela`;
  7. `answer`;
  8. `conference` `<sala>@starsonic`, mais as bandeiras: `+flags{join-only}` para quem é de fora, `+flags{mute|deaf}` na tela, e as duas juntas (`+flags{join-only|mute|deaf}`) para a tela de quem é de fora.
- **Outro método que não o `POST`:** responde `405`.

- [ ] **Step 1: Os testes** (o XML lido com o `encoding/xml`; as senhas feitas com o `senha.Assinar`).
  - `TestDiscagem_Colega`: uma senha de colega pelo perfil `tls` dá as ações 1 a 5, a 7 e a 8, nessa ordem, sem bandeiras.
  - `TestDiscagem_Fora`: pelo perfil `navegador`, dá o `join-only` e não tem o `rtp_secure_media`.
  - `TestDiscagem_Tela`: dá o `mute|deaf`, o `video_reservation_id=tela` e o quadro `Tela de Maria Lima`.
  - `TestDiscagem_Recusa`: estes casos dão só o `respond 403 Forbidden`, e o XML não tem a sala:
    - sem o cabeçalho;
    - com uma senha de outra chave;
    - com uma senha vencida;
    - a mesma senha pela segunda vez.
  - `TestDiscagem_OutroDestino` e `TestDiscagem_OutraSecao`: as respostas acima.
  - `TestDiscagem_NomeLimpo` (Review Focus 5). O `LimparNome` dá:
    - `${system(touch /tmp/x)}` → `system(touch tmpx)`;
    - `Ana {Souza}` → `Ana Souza`;
    - `"Bia" <b>Ramos</b>` → `Bia bRamosb`;
    - `José Ñoño` → igual;
    - `😀 Davi` → `Davi`;
    - 200 vezes `a` → 40 vezes `a`;
    - `"   "` → `Convidado`.

    Em cada XML, o texto depois do `}` do quadro não tem `$`, `{` nem `}`.
  - `TestDiscagem_Metodo`: o `GET` dá 405.
- [ ] **Step 2: Rode o agente.** Esperado: falha.
- [ ] **Step 3: Escreva o código.** O `LimparNome` usa o `unicode` (`IsLetter`, `IsMark` e `IsNumber`). O XML sai do `encoding/xml`.
- [ ] **Step 4: Rode o agente.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): a discagem do agente: a senha de uso único decide quem entra em qual reunião"
  ```

### Task 6: A API do agente para o chat, os eventos e o uso da VM

**Files:**
- Create: `video-servidor/internal/uso/uso.go` e `uso_test.go`
- Create: `video-servidor/internal/api/api.go`, `eventos.go` e `api_test.go`

**Interfaces:**
- **Consumes:** `salas.Sala`, `salas.Aviso`, `salas.ErrNaoEncontrado` e `salas.ErrSemFreeSWITCH` (Task 4).
- **Produces** (`uso`):
  - `type Uso struct { CPU, Memoria int }`, com o JSON `cpu` e `memoria`;
  - `func NovoMedidor(proc string) *Medidor`, com o `proc` igual a `/proc`;
  - `func (m *Medidor) Medir() (Uso, error)`:
    - a CPU é a fração ocupada entre duas leituras do `stat` (a primeira dá 0);
    - a memória é `(MemTotal − MemAvailable) / MemTotal`, do `meminfo`;
    - as duas em porcentagem inteira, arredondada.
- **Produces** (`api`):
  - `type Salas interface { Estado() []salas.Sala; Tirar(ctx context.Context, sala, participante string) error; Encerrar(ctx context.Context, sala string) error }`;
  - `type Deps struct { Chave string; Salas Salas; NoAr func() bool; Uso func() uso.Uso; Versao string; Agora func() time.Time; Pulso time.Duration }`, com o `Pulso` padrão de 25 segundos;
  - `func Novo(d Deps) *API`, que serve `/agente/v1/` (seção 5 do contrato);
  - `func (a *API) Avisar(av salas.Aviso)`, que não espera ninguém;
  - `func (a *API) Retrato()`, que manda um `estado` novo a cada cliente dos eventos.

- [ ] **Step 1: Os testes.**
  - `TestUso`: com um `/proc` de mentira numa pasta temporária, duas leituras de `stat` dão a CPU certa. Por exemplo, 300 de 1.000 ocupados entre elas dá 30. A memória com `MemTotal: 8000000 kB` e `MemAvailable: 6000000 kB` dá 25.
  - `TestSaude`: o `GET /agente/v1/saude` sem chave dá 200 `{"ok":true}`.
  - `TestChave`: sem o `Authorization`, ou com outra chave, o `estado`, os `eventos`, o `tirar` e o `encerrar` dão `401 chave`.
  - `TestEstado`: os campos da seção 5. O `freeswitch` é falso quando o `NoAr` é falso.
  - `TestTirarEncerrar`:
    - as duas rotas chegam às `Salas` falsas com a sala e o participante, e dão 204;
    - o `ErrNaoEncontrado` dá `404 naoEncontrado`;
    - o `ErrSemFreeSWITCH` dá `503 freeswitch`;
    - uma sala com 31 caracteres, ou um participante com letras maiúsculas, dá `400 invalido`.
  - `TestEventos_EstadoDepoisAvisos`: com o `Pulso` de 50 ms, o cliente lê, nesta ordem, um `estado`, o `entrou` dado ao `Avisar` e um `relogio`. Cada um vem como uma linha `data:` com o JSON, seguida de uma linha vazia, com o `Content-Type: text/event-stream`.
  - `TestEventos_ClienteLento`: um cliente que não lê, e 2.000 `Avisar` seguidos. Os 2.000 voltam em menos de 1 s, o cliente lento é desligado, e um segundo cliente, que lê, recebe todos.
  - `TestEventos_Retrato`: o `Retrato` manda um `estado` novo aos dois clientes conectados.
- [ ] **Step 2: Rode o agente.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
  - **A chave** é comparada com o `subtle.ConstantTimeCompare`.
  - **Cada cliente dos eventos** tem uma fila de 1.024. Com a fila cheia, ele sai, sem esperar.
  - **O log** é o do chat: o método, o padrão da rota, o status e o tempo.
- [ ] **Step 4: Rode o agente.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): a API do agente para o chat, os eventos e o uso da VM"
  ```

### Task 7: Servir: a 443, o `/sip`, a discagem, o ESL e o modo de teste

**Files:**
- Create: `video-servidor/internal/proxy/proxy.go` e `proxy_test.go`
- Create: `video-servidor/internal/servidor/servidor.go` e `servidor_test.go`
- Modify: `video-servidor/cmd/starsonic-video/main.go` (o `servir`)

**Interfaces:**
- **Consumes:** as Tasks 1 a 6.
- **Produces:**
  - `func proxy.Novo(destino string, origens []string, maxPorEndereco int) http.Handler`;
  - `var servidor.ErroModoTeste`, com o texto `o modo de teste só escuta em 127.0.0.1 ou [::1]`, e `func servidor.ValidarEscutar(escutar string) error`;
  - `func servidor.Rodar(ctx context.Context, c config.Config, versao string) error`;
  - `func servidor.RodarTeste(ctx context.Context, c config.Config, versao, escutar string, origens []string) error`;
  - o subcomando `starsonic-video servir [--config /etc/starsonic-video/config.json] [--teste --escutar 127.0.0.1:<porta> --origem <url>…]`.

**As regras:**
- **O proxy:**
  - só aceita o `GET` com o `Upgrade: websocket` (senão, 400);
  - a origem tem de ser exatamente uma das `origens` (senão, 403);
  - aceita até `maxPorEndereco` (30) conexões ao mesmo tempo por endereço IP (senão, 429);
  - leva a conexão ao `http://127.0.0.1:5066/` pelo `httputil.ReverseProxy`.
- **A produção:**
  - **a 443:** TLS 1.2 ou mais, com o certificado de `/etc/starsonic-video/tls/certificado.pem` e a chave de `/etc/starsonic-video/tls/chave.pem`, pelo `GetCertificate`. Ela só fala HTTP/1.1 (o `TLSNextProto` vazio), para o WebSocket do navegador nunca tentar o HTTP/2, que o proxy não leva;
  - **as rotas da 443:** `/sip` vai ao proxy, com as origens `[c.OrigemDoChat()]`, e `/agente/v1/` vai à API. O resto dá 404. Toda resposta leva `Strict-Transport-Security: max-age=31536000`;
  - **a discagem:** `127.0.0.1:8091`, com só o `POST /freeswitch/discagem`;
  - **o `SIGHUP`** relê o certificado e, se o ESL está ligado, manda `api reloadcert`;
  - **o ESL:** `127.0.0.1:8021`, com o `SenhaESL`.
    - Ao conectar, roda o `Salas.Ligar`, o `Reconstruir` e o `API.Retrato`, e passa os eventos às salas.
    - Quando cai, roda o `Salas.Ligar(nil)`, o `Esvaziar` e o `Retrato`, e tenta de novo depois de 2 s, subindo até 10 s.
  - **o uso:** um `uso.Medidor` lido a cada 60 s, e a API dá a última leitura (a CPU do último minuto);
  - **o `http.Server`:** `ReadHeaderTimeout` de 10 s e `IdleTimeout` de 120 s, sem `WriteTimeout` (os eventos e o WebSocket ficam abertos);
  - **o desligamento:** o `SIGTERM` e o `SIGINT` fecham com calma, em até 10 s;
  - **os endereços do ESL e da discagem** são variáveis do pacote (`enderecoESL` e `enderecoDiscagem`), como os prazos do servidor do chat, para os testes usarem outras portas.
- **O modo de teste:**
  - HTTP sem TLS, no `escutar`, que só aceita `127.0.0.1` ou `[::1]`;
  - as origens do `/sip` são a `OrigemDoChat()` mais as do `--origem`;
  - a discagem e o ESL são os mesmos;
  - um `--teste` com outro endereço sai com o código 2 e a mensagem do `ErroModoTeste`.

- [ ] **Step 1: Os testes.**
  - `TestProxy_Origem`. O destino é um servidor de mentira que responde o 101 e devolve cada byte que recebe:
    - sem `Origin`, ou com `https://mal.example`, dá 403;
    - com a origem certa, dá 101, e os bytes escritos voltam iguais.
  - `TestProxy_LimitePorEndereco`: com o máximo de 3, a 4ª conexão aberta ao mesmo tempo dá 429. Depois de fechar uma, outra passa.
  - `TestProxy_SoWebSocket`: um `GET` comum dá 400.
  - `TestModoTeste_SoLocal`: o `RodarTeste` com `0.0.0.0:8095` e com `192.168.0.5:80` dá o `ErroModoTeste`, e o `run` volta 2.
  - `TestModoTeste_Responde`: com `127.0.0.1:0`, o `saude` responde, e a discagem responde em `127.0.0.1:8091`.
  - `TestCertificado_Recarrega`:
    - com o certificado A num `httptest` TLS montado pela função que o servidor usa, um aperto de mão vê A;
    - depois de gravar o B e chamar a recarga do `SIGHUP`, o seguinte vê B;
    - o `esltest` recebeu o `api reloadcert`.
  - `TestESL_Reconecta` (Review Focus 4), com o `esltest`:
    - o `Derrubar` faz sair um `acabou` por sala no cliente dos eventos e um `estado` vazio;
    - na reconexão, o servidor manda o `json_list`, e um `estado` com as salas chega ao cliente.
  - `TestSoHTTP1`: um cliente TLS que oferece o `h2` no ALPN fica com o `http/1.1`.
  - `TestHSTS` e `TestDesligarComCalma`: como no `chat-servidor/internal/servidor/servidor_test.go`.
- [ ] **Step 2: Rode o agente.** Esperado: falha.
- [ ] **Step 3: Escreva o código.** O certificado fica num `atomic.Pointer[tls.Certificate]`.
- [ ] **Step 4: Rode o agente.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): o agente no ar: a 443 com o /sip e a API, a discagem, o ESL e o modo de teste"
  ```

### Task 8: A instalação, o certificado e o guia do servidor de vídeo

**Files:**
- Create: `video-servidor/deploy/instalar.sh`, `instalar-teste.sh`, `certificado.sh`, `starsonic-video.service` e `starsonic-freeswitch.service`
- Create: `docs/video-servidor.md`
- Modify: `video-servidor/cmd/starsonic-video/main.go` e `main_test.go` (o subcomando `reunioes`)
- Modify: `.github/workflows/video.yml` (no job `agente`: o `shellcheck`, o `instalar-teste.sh` e o `systemd-analyze verify`)

**Interfaces:**
- **Consumes:** os subcomandos `chave`, `configurar`, `mostrar-chave` e `servir` (Tasks 1, 3 e 7), e o tarball da Task 2.
- **Produces:**
  - o subcomando `starsonic-video reunioes [--config /etc/starsonic-video/config.json]`. Ele pede o `estado` ao próprio agente, em `https://127.0.0.1/agente/v1/estado`, com o `ServerName` igual ao `endereco` e a chave do `config.json`, e escreve só o número de salas. Sem resposta, sai com 1;
  - o que a release `video-v<versão>` leva (Task 16), e o `docs/video-servidor.md`.

**O `instalar.sh`** (`set -euo pipefail`, no jeito do `chat-servidor/deploy/instalar.sh`, com `VERSAO="@VERSAO@"` e `REPOSITORIO="LucasCPena/starsonic-phone"`):
- **`instalar <endereço> --chat <endereço do chat>`:**
  1. **As conferências:**
     - o endereço segue a regra do `conferir_endereco` do chat;
     - o do chat é um nome com porta opcional;
     - a máquina é root, com systemd, e o sistema é o Ubuntu 24.04 ou o Debian 12, o que dá o `<sistema>`. Outro sistema para com o nome dele;
     - as portas TCP 80, 443, 5061 e 5349 e a UDP 3478 estão livres;
     - o endereço resolve (`getent ahostsv4`). Esse é o IP público. Sem resposta, para com `o endereço <endereço> ainda não aponta para nenhum IP no DNS. Crie o registro A e espere alguns minutos.`;
     - o IP privado é o `src` do `ip -4 route get 1.1.1.1`.
  2. **Os arquivos da release:** baixa o `starsonic-video-linux-amd64`, o `starsonic-freeswitch-<sistema>-amd64.tar.gz` e os dois `.sha256`, as duas unidades e o `certificado.sh`, e confere os dois SHA-256 (`SHA-256 conferido.`).
  3. **O FreeSWITCH:** extrai o tarball em `/`. Depois, o `apt-get install` do `certbot`, do `coturn`, do `ca-certificates`, do `openssl` e dos pacotes do `/opt/starsonic-freeswitch/pacotes.txt`.
  4. **Os usuários de sistema** `starsonic-video` e `starsonic-freeswitch`, sem shell.
  5. **A configuração:**
     - a chave (`starsonic-video chave`) e a senha do ESL (32 caracteres de `[A-Za-z0-9]`, do `/dev/urandom`);
     - o `/etc/starsonic-video/config.json` (root:starsonic-video, 0640);
     - o `starsonic-video configurar --config /etc/starsonic-video/config.json --saida /etc/starsonic-video`. A pasta `freeswitch/` fica com root:starsonic-freeswitch (0750), e a `tls/` dela, de starsonic-freeswitch (0700);
     - o `turnserver.conf` vai para `/etc/turnserver.conf` (root:turnserver, 0640). O original fica uma vez em `/etc/turnserver.conf.original`;
     - o `dtls-srtp.pem` da `freeswitch/tls/`: o `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=starsonic-video`, com o certificado e a chave no mesmo arquivo.
  6. **O certificado:**
     - instala o `certificado.sh` como `/etc/letsencrypt/renewal-hooks/deploy/starsonic-video` (0755). O certbot roda os ganchos dessa pasta em cada renovação;
     - roda o `certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email --preferred-challenges http -d <endereço>`. Uma falha para com `o certificado não saiu: confira o DNS e a porta 80 (veja "O certificado não sai", no guia).`;
     - roda o gancho uma vez, à mão, com `RENEWED_LINEAGE=/etc/letsencrypt/live/<endereço>`. Assim, os arquivos dos três programas existem antes de eles subirem.
  7. **Os serviços:** instala as unidades, roda o `daemon-reload`, o `enable --now` do `starsonic-freeswitch` e do `starsonic-video`, e o `enable` e o `restart` do `coturn`.
  8. **O fim:**
     - `Pronto: o servidor de vídeo <versão> está no ar em https://<endereço>/.`;
     - a linha vazia, `A chave do servidor de vídeo (cole no cartão "Reuniões" da administração do chat):` e a chave numa linha só.
- **`atualizar [--agora]`:**
  - confere a máquina e baixa e confere os arquivos, como acima;
  - pergunta ao agente, pelo `starsonic-video reunioes`, quantas reuniões estão acontecendo. Com alguma e sem o `--agora`, para com `Há <n> reunião(ões) acontecendo agora. Atualize quando elas acabarem, ou rode de novo com --agora, que as encerra.`;
  - troca o FreeSWITCH (extrai em `/opt/starsonic-freeswitch.novo` e troca as pastas pelo `mv`), o programa e as unidades;
  - roda o `configurar` de novo e copia o `turnserver.conf` de novo;
  - reinicia os três serviços e confere que o agente ficou de pé (o `servico_firme` do chat);
  - termina com `Pronto: o servidor de vídeo agora está na versão <versão>.`
- **`chat <endereço do chat>`:** troca o `chat` do `config.json`, reinicia o agente e escreve `Pronto: o servidor de vídeo agora aceita a página de https://<endereço do chat>.`

**O `certificado.sh`** (o gancho do certbot, como root, com o `RENEWED_LINEAGE` do certbot; sem ele, para com erro). Cada caminho é relativo a uma `RAIZ`, vazia em produção, para o teste:
- **para o agente:** o `fullchain.pem` vai a `/etc/starsonic-video/tls/certificado.pem` (0644), e o `privkey.pem`, a `chave.pem` (root:starsonic-video, 0640);
- **para o coturn:** os mesmos dois, como `turn-certificado.pem` e `turn-chave.pem` (root:turnserver, 0640);
- **para o FreeSWITCH:**
  - o `/etc/starsonic-video/freeswitch/tls/agent.pem` é o `privkey.pem` seguido do `fullchain.pem` (starsonic-freeswitch, 0600);
  - o `cafile.pem` é o `chain.pem` (0644);
- **as recargas,** cada uma só com o serviço ativo: o `systemctl reload starsonic-video` e o `systemctl kill --signal=SIGUSR2 --kill-whom=main coturn`.

**As unidades:**
- **`starsonic-video.service`:**
  - `User=starsonic-video` e `ExecStart=/usr/local/bin/starsonic-video servir --config /etc/starsonic-video/config.json`;
  - `ExecReload=/bin/kill -HUP $MAINPID`, `Restart=on-failure` e `RestartSec=5`;
  - `After=` e `Wants=` com `network-online.target` e `starsonic-freeswitch.service`;
  - `AmbientCapabilities=CAP_NET_BIND_SERVICE` e `CapabilityBoundingSet=CAP_NET_BIND_SERVICE`;
  - as proteções do `starsonic-chat.service` (`NoNewPrivileges` até `LockPersonality`), sem pasta de escrita.
- **`starsonic-freeswitch.service`:**
  - `User=starsonic-freeswitch`, `RuntimeDirectory=starsonic-freeswitch` (0700) e `StandardInput=null`;
  - `ExecStart=/opt/starsonic-freeswitch/bin/freeswitch -c -nonat -conf /etc/starsonic-video/freeswitch -log /run/starsonic-freeswitch -db /run/starsonic-freeswitch -run /run/starsonic-freeswitch -temp /run/starsonic-freeswitch -certs /etc/starsonic-video/freeswitch/tls`;
  - `Restart=on-failure`, `RestartSec=5`, `LimitNOFILE=65536` e `TimeoutStopSec=20`;
  - as mesmas proteções, com `ReadWritePaths=/run/starsonic-freeswitch`.

**O `docs/video-servidor.md`,** no formato do `docs/chat-servidor.md` (comandos de uma linha, o que se deve ver depois de cada um, sem `_`):
1. **O que a VM precisa:**
   - a tabela da spec 7, com o Ubuntu 24.04 ou o Debian 12 e o IP público;
   - o nome no DNS (`video.<domínio>`), sem proxy nem CDN (a nuvem cinza da Cloudflare);
   - a tabela das portas;
   - a banda: 10 pessoas usam cerca de 25 Mbit/s em cada sentido (spec 13, o risco 4);
   - "Se a VM fica atrás de um roteador": as mesmas portas redirecionadas, com os mesmos números. Para quem está na mesma rede, o NAT loopback ou o DNS interno, como no guia do chat.
2. **Instalar:** o `curl` do instalador da release `video-v<versão>` e o `sudo bash instalar.sh instalar <endereço> --chat <endereço do chat>`, com as linhas que se deve ver e a chave do fim. Depois, o `systemctl status starsonic-video starsonic-freeswitch coturn`.
3. **Ligar ao chat,** pelo cartão "Reuniões" da administração do chat. Os textos são os da Task 14, e a Task 14 confere este passo.
4. **Conferir a instalação:**
   - `curl -s https://<endereço>/agente/v1/saude` dá `{"ok":true}`;
   - `openssl s_client -connect <endereço>:5061 -brief </dev/null` mostra `Verification: OK`;
   - o "Testar o servidor de vídeo" do cartão.

   A reunião de teste pelo navegador chega com a página, na próxima versão do chat.
5. **Atualizar,** com o `--agora`.
6. **Trocar o endereço do chat** (`chat`).
7. **O certificado:** o `sudo certbot certificates`, o `sudo certbot renew --dry-run`, a renovação sozinha e a porta 80 que fica aberta.
8. **Ver os registros:** o `journalctl` dos três serviços.
9. **Os problemas comuns:**
   - o certificado que não sai;
   - as portas fechadas;
   - "O servidor de reuniões não respondeu";
   - os relógios das VMs (o horário automático, `timedatectl`);
   - a rede que bloqueia o UDP (o TURN na 5349);
   - a rede que só deixa sair pela 443 (spec 13, o risco 6);
   - a CPU, pelo uso do cartão.
10. **Publicar uma versão:** a Task 16.

- [ ] **Step 1: O `instalar-teste.sh`,** como o do chat (`. instalar.sh` só traz as funções), com:
  - `conferir_endereco`, com os mesmos casos do chat;
  - `conferir_chat`, que aceita `chat.exemplo.com.br` e `chat.exemplo.com.br:8443` e recusa `https://chat.exemplo.com.br`, `chat` e `chat.exemplo.com.br/x`;
  - `sistema_da_maquina`, com arquivos `os-release` de mentira: o Ubuntu 24.04 dá `ubuntu-24.04`, o Debian 12 dá `debian-12`, e o Ubuntu 22.04, o Debian 13 e o Fedora param;
  - `ip_privado` e `ip_publico`, com o `ip` e o `getent` de mentira;
  - o `certificado.sh` numa `RAIZ` temporária, com um lineage de mentira: os cinco arquivos com o conteúdo e as permissões acima, e as duas recargas pedidas ao `systemctl` de mentira;
  - a recusa do `atualizar` com reuniões acontecendo, com o `starsonic-video reunioes` de mentira dizendo 1.

  E, no `main_test.go`, o `TestContarReunioes`: a função que o `reunioes` usa, com um `httptest.NewTLSServer` no lugar do agente e o cliente dele, manda o `Bearer` e conta as salas. Sem resposta, dá erro.
- [ ] **Step 2: Rode o `instalar-teste.sh` e o agente.** Esperado: falham.
- [ ] **Step 3: Escreva os scripts, as unidades e o guia.**
- [ ] **Step 4: Rode o `instalar-teste.sh`, o `shellcheck`, o `systemd-analyze verify` das duas unidades (se o ambiente tiver) e o agente.** Esperado: tudo passa. No CI, o `systemd-analyze` roda como no `chat.yml`: instala o programa e cria os dois usuários antes, e qualquer linha na saída falha.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): a instalação do servidor de vídeo, o certificado e o guia"
  ```

### Task 9: O chat: o banco das reuniões, os códigos e a limpeza

**Files:**
- Create: `chat-servidor/internal/banco/migracoes/0002_reunioes.sql`, exatamente o SQL abaixo
- Create: `chat-servidor/internal/banco/reunioes.go`, `reunioes_test.go`, `configuracao.go` e `configuracao_test.go`
- Modify: `chat-servidor/internal/banco/empresas.go` e `computadores.go` (o `Empresa.Reunioes`), `banco_test.go` (o `user_version` 2)
- Modify: `chat-servidor/internal/segredo/segredo.go` e `segredo_test.go`
- Modify: `chat-servidor/internal/tarefas/tarefas.go` e `tarefas_test.go`

```sql
ALTER TABLE empresas ADD COLUMN reunioes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE reunioes (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  sala TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('marcada', 'naHora', 'teste')),
  assunto TEXT,
  inicio INTEGER,
  vale_ate INTEGER,
  criou_id INTEGER REFERENCES pessoas(id),
  criada_em INTEGER NOT NULL,
  cancelada_em INTEGER,
  acabou_em INTEGER,
  CHECK ((tipo = 'teste') = (empresa_id IS NULL)),
  CHECK (tipo <> 'marcada' OR (inicio IS NOT NULL AND vale_ate IS NOT NULL AND criou_id IS NOT NULL)),
  CHECK (tipo <> 'teste' OR vale_ate IS NOT NULL)
);
CREATE INDEX reunioes_criou ON reunioes(empresa_id, criou_id, inicio);
CREATE TABLE configuracao (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
```

**Interfaces:**
- **Produces** (`segredo`):
  - `func NovoCodigoReuniao() string`, com 10 caracteres de `abcdefghjkmnpqrstvwxyz23456789`;
  - `func NormalizarCodigoReuniao(s string) (string, bool)`, que passa para minúsculas, tira os espaços e confere;
  - `func NovoHex(n int) string`, com `n` bytes aleatórios em hexadecimal minúsculo.
- **Produces** (`banco`):
  - as constantes `TipoMarcada = "marcada"`, `TipoNaHora = "naHora"` e `TipoTeste = "teste"`;
  - `type Reuniao struct { ID, EmpresaID int64; Codigo, Sala, Tipo, Assunto string; Inicio, ValeAte, CriouID, CriadaEm, CanceladaEm, AcabouEm int64 }`, em que o 0 e o `""` são o vazio do banco;
  - `func (r Reuniao) Vale(agoraMs int64) bool`;
  - `func (b *Banco) CriarReuniao(ctx context.Context, r Reuniao) (Reuniao, error)`, que sorteia o `Codigo` e a `Sala` (`NovoHex(16)`) e tenta de novo se repetir; dá `ErrMuitasReunioes` na 101ª marcada que vale da mesma pessoa;
  - `func (b *Banco) ReuniaoPorCodigo(ctx context.Context, codigo string) (Reuniao, error)`, qualquer que seja o estado, e `ErrNaoEncontrado`;
  - `func (b *Banco) ReunioesMarcadas(ctx context.Context, empresaID, pessoaID int64) ([]Reuniao, error)`, as que valem, pelo `inicio`;
  - `func (b *Banco) CancelarReuniao(ctx context.Context, empresaID, pessoaID int64, codigo string) (Reuniao, error)`, com `ErrNaoEncontrado` (outra empresa ou não existe) e `ErrProibido` (não foi ela que criou);
  - `func (b *Banco) AcabarReuniao(ctx context.Context, id int64) error`, que marca o `acabou_em` de uma naHora;
  - `func (b *Banco) ReunioesNaHoraAbertas(ctx context.Context) ([]Reuniao, error)`;
  - `func (b *Banco) CriarReuniaoDeTeste(ctx context.Context, valeAte int64) (Reuniao, error)`, que cancela as de teste anteriores, e `func (b *Banco) ReuniaoDeTeste(ctx context.Context) (Reuniao, error)`, a que vale, ou `ErrNaoEncontrado`;
  - `func (b *Banco) ApagarReunioesVelhas(ctx context.Context, antesDe int64) (int, error)`;
  - `type ConfigReunioes struct { Endereco, Chave string; Limite int }` e `func (b *Banco) ConfigReunioes(ctx context.Context) (ConfigReunioes, error)`, com o `Limite` 2 quando não foi guardado;
  - `func (b *Banco) GuardarServidorVideo(ctx context.Context, endereco, chave string) error` e `func (b *Banco) GuardarLimiteReunioes(ctx context.Context, n int) error`;
  - `func (b *Banco) LiberarReunioes(ctx context.Context, empresaID int64, liberar bool) error`, com `ErrNaoEncontrado`;
  - o `Empresa` ganha o `Reunioes bool`, lido também pelo `ComputadorPorChave`;
  - `var ErrMuitasReunioes`.
- **Produces** (`tarefas`): `func LimparReunioes(ctx context.Context, b *banco.Banco) (int, error)`, que apaga as de antes de agora menos 30 dias. A rodada do `Rodar` a chama depois do `Expirar`.

**A regra do `Vale` e da limpeza:**
- **o `Vale`:** sem o `cancelada_em`, e com o `agora` antes do `vale_ate` (na marcada e na de teste) ou sem o `acabou_em` (na naHora);
- **a limpeza apaga** a que tem o `cancelada_em` antes do limite, a marcada ou a de teste com o `vale_ate` antes do limite, e a naHora com o `acabou_em` antes do limite.

- [ ] **Step 1: Os testes.**
  - `TestAbrir_Novo` (no `banco_test.go`): o `user_version` passa a 2.
  - `TestCodigoReuniao`:
    - 1.000 códigos casam com `^[abcdefghjkmnpqrstvwxyz23456789]{10}$`, sem repetir;
    - o `NormalizarCodigoReuniao(" K7Q4 9XWP HT ")` dá `k7q49xwpht`;
    - não valem 9 ou 11 caracteres, um `l`, um `0`, um `1`, nem `k7q4-9xwph`.
  - `TestNovoHex`: o `NovoHex(8)` casa com `^[0-9a-f]{16}$`.
  - `TestCriarReuniao`: a marcada ganha o código e a sala (`^[0-9a-f]{32}$`) e o `criada_em` do relógio, e duas reuniões têm códigos diferentes.
  - `TestReuniao_Vale`, uma tabela:
    - a marcada 1 ms antes e no `vale_ate`;
    - a cancelada;
    - a naHora aberta e a acabada;
    - a de teste.
  - `TestReunioesMarcadas`: só as da pessoa, que valem, pelo `inicio`. As de outra empresa nunca aparecem.
  - `TestCancelarReuniao`: quem criou cancela, outra pessoa da empresa recebe `ErrProibido`, e alguém de outra empresa recebe `ErrNaoEncontrado`.
  - `TestMuitasReunioes`: 100 passam, e a 101ª dá `ErrMuitasReunioes`. Depois de cancelar uma, cabe outra.
  - `TestReuniaoDeTeste`: criar duas vezes cancela a primeira, o `ReuniaoDeTeste` devolve a segunda, e ela fica sem empresa.
  - `TestApagarReunioesVelhas`:
    - a marcada com o `vale_ate` 30 dias e 1 ms antes sai, e com 29 dias fica;
    - a cancelada há 31 dias sai;
    - a naHora acabada há 31 dias sai, e a aberta fica.
  - `TestApagarEmpresa_LevaAsReunioes`: apagar a empresa apaga as reuniões dela.
  - `TestConfigReunioes`:
    - num banco novo, o endereço e a chave vazios e o limite 2;
    - o guardar e o ler;
    - o `LiberarReunioes` aparece no `Empresa.Reunioes` do `ComputadorPorChave`.
  - `TestRodada_LimpaReunioes` (no `tarefas`): a rodada apaga as reuniões velhas.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa, também os testes de hoje.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `chat` e o `build`, que roda os testes do chat da interface).
  ```bash
  git commit -m "feat(reunioes): o banco das reuniões no chat, o código do link e a limpeza dos 30 dias"
  ```

### Task 10: O chat: o cliente do servidor de vídeo

**Files:**
- Create: `chat-servidor/internal/video/senha.go`, `cliente.go`, `senha_test.go` e `cliente_test.go`
- Create: `chat-servidor/internal/video/videotest/videotest.go`

**Interfaces:**
- **Produces** (`video`):
  - `type Senha`, com os mesmos campos, tags e ordem do `senha.Senha` do agente (Task 1);
  - `func AssinarSenha(chave []byte, s Senha) (string, error)` e `func LerChave(texto string) ([]byte, error)`;
  - `func SegredoTurn(chave []byte) string` e `func CredencialTurn(segredo, participante string, vence time.Time) (usuario, senha string)`;
  - `type Participante struct { Participante string; Tela bool }` e `type Sala struct { Sala string; Participantes []Participante }`, com o JSON do contrato;
  - `type Uso struct { CPU, Memoria int }` e `type Estado struct { Versao string; FreeSWITCH bool; Agora int64; Salas []Sala; Uso Uso }`;
  - `type Evento struct { Tipo, Sala, Participante string; Tela bool; Agora int64; Salas []Sala }`;
  - os erros `ErrChave`, `ErrSemResposta` e `ErrNaoEncontrado`;
  - `func ValidarEndereco(endereco string, teste bool) error`;
  - `func NovoCliente(endereco, chave string, teste bool) (*Cliente, error)`;
  - os métodos do `*Cliente`:
    - `Endereco() string`, o host com a porta;
    - `WSS() string`, que dá `wss://<endereco>/sip` ou, no modo de teste, `ws://127.0.0.1:<porta>/sip`;
    - `Chave() []byte`;
    - `Estado(ctx) (Estado, error)`, `Tirar(ctx, sala, participante string) error` e `Encerrar(ctx, sala string) error`;
    - `Acompanhar(ctx context.Context, f func(Evento))`, que bloqueia até o `ctx` acabar;
    - `NoAr() bool` e `Agora() time.Time`.
- **Produces** (`videotest`), um agente falso com o mesmo conjunto de métodos:
  - `func NovoFalso(chave []byte, agora func() time.Time) *Falso`;
  - `Mandar(ev video.Evento)`, que entrega ao `f` de quem acompanha;
  - `Comandos() []string`, com `tirar <sala> <participante>` e `encerrar <sala>`;
  - `DefinirNoAr(bool)` e `DefinirEstado(video.Estado)`.

**As regras:**
- **O endereço** é um nome, com a porta opcional, sem `https://` e sem caminho. No modo de teste, aceita também `http://127.0.0.1:<porta>`.
- **Os pedidos** vão a `https://<endereço>/agente/v1/…`, com a `Authorization: Bearer <chave>`, e esperam até 10 s.
  - O 401 vira `ErrChave`, e o 404 vira `ErrNaoEncontrado`.
  - Uma falha de rede, um 5xx ou o tempo esgotado viram `ErrSemResposta`.
- **O `Acompanhar`:**
  - lê os eventos (seção 5 do contrato) e passa cada um ao `f`;
  - quando a conexão cai, ou fica 60 s sem nada, conecta de novo. A espera começa em 1 s e dobra até 30 s;
  - o `NoAr` é verdadeiro enquanto a conexão está aberta.
- **O `Agora`** é a hora local mais a diferença medida no último `estado` ou `relogio`.

- [ ] **Step 1: Os testes** (com um `httptest` no lugar do agente).
  - `TestSenha_Vetor` e `TestTurn_Vetor`: os vetores das seções 3 e 4 do contrato.
  - `TestValidarEndereco`:
    - valem `video.exemplo.com.br` e `video.exemplo.com.br:8443`;
    - não valem `https://video.exemplo.com.br`, `video.exemplo.com.br/x` e `video`;
    - `http://127.0.0.1:8095` só vale com o `teste`.
  - `TestCliente_Estado`: o pedido leva o `Bearer`, e a resposta é lida. O 401 dá `ErrChave`; o 500 e um servidor que não responde em 10 s dão `ErrSemResposta`.
  - `TestCliente_TirarEncerrar`: os caminhos da seção 5, e o 404 dá `ErrNaoEncontrado`.
  - `TestCliente_Acompanhar` (Review Focus 3):
    - o `f` recebe o `estado` e depois o `entrou`, e o `NoAr` é verdadeiro;
    - quando o servidor fecha, o `NoAr` fica falso;
    - na reconexão, chega um `estado` novo;
    - quando o `ctx` acaba, o `Acompanhar` volta.
  - `TestCliente_RelogioDoAgente` (Review Focus 1): com o `agora` do agente 3 minutos adiante, depois do `estado` o `Agora()` fica a menos de 1 s do relógio do agente.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): o cliente do servidor de vídeo no chat, com a senha, o TURN e os eventos"
  ```

### Task 11: O chat: as regras das reuniões (o gerente)

**Files:**
- Create: `chat-servidor/internal/reunioes/gerente.go`, `pedidos.go`, `senhas.go`, `gerente_test.go` e `pedidos_test.go`

**Interfaces:**
- **Consumes:** o `banco` (Task 9), o `video` e o `videotest` (Task 10), e o `regras.NomePessoa`.
- **Produces:**
  - `type Video interface`, com os métodos `Tirar(ctx context.Context, sala, participante string) error`, `Encerrar(ctx context.Context, sala string) error`, `Estado(ctx context.Context) (video.Estado, error)`, `Acompanhar(ctx context.Context, f func(video.Evento))`, `NoAr() bool`, `Endereco() string`, `WSS() string`, `Chave() []byte` e `Agora() time.Time`;
  - `type Avisos interface { ParaComputadores(ids []int64, ev any) }`, que o `eventos.Hub` cumpre;
  - `type Deps struct { Banco *banco.Banco; Avisos Avisos; Relogio tempo.Relogio }`;
  - `func Novo(d Deps) *Gerente`, `func (g *Gerente) Rodar(ctx context.Context)` (o `Varrer` a cada segundo), `func (g *Gerente) Ligar(v Video)` (com `nil` para nenhum servidor), `func (g *Gerente) Video() Video` e `func (g *Gerente) Varrer()`;
  - `type Acesso struct { Participante, Senha string; Turn Turn; Video Enderecos }`, `type Turn struct { URLs []string; Usuario, Senha string }` e `type Enderecos struct { WSS, URI, SIP string }`, com o JSON do Acesso da seção 9 do protocolo;
  - os erros `ErrLinkInvalido`, `ErrCheia`, `ErrServidorCheio`, `ErrSemServidor`, `ErrJaRespondido`, `ErrPedidoNaoEncontrado`, `ErrForaDaReuniao`, `ErrParticipanteNaoEncontrado` e `ErrLimite`;
  - para o app:
    - `EntrarColega(ctx, r banco.Reuniao, p banco.Pessoa, computadorID int64) (Acesso, error)`;
    - `Aceitar(ctx, r banco.Reuniao, pessoaID int64, pedido string) error` e `Recusar(…)`;
    - `Tirar(ctx, r banco.Reuniao, pessoaID int64, participante string) error`;
    - `Encerrar(ctx, r banco.Reuniao, pessoaID int64) error`, em que o `pessoaID` 0 é o próprio servidor;
    - `Lista(r banco.Reuniao, pessoaID int64) (Lista, error)` e `Tela(ctx, r banco.Reuniao, pessoaID int64) (string, error)`;
    - `Cancelada(ctx, r banco.Reuniao)`;
    - `Convidar(r banco.Reuniao, de banco.Pessoa, computadores []int64)`;
    - `Contagem(sala string) (acontecendo bool, pessoas int)` e `Resumo() (reunioes, pessoas int)`;
  - para a página:
    - `type Canal interface { Mandar(msg any); Fechar() }`;
    - `Pedir(ctx, r banco.Reuniao, nome string, c Canal) (*Pedido, error)`, `Desistir(p *Pedido)`, `NovaSenha(p *Pedido) (string, error)` e `TelaDeFora(p *Pedido) (string, error)`;
  - `EventoDoVideo(ev video.Evento)`;
  - `type Lista struct { Participantes []ParticipanteVisto; Pedidos []PedidoVisto }`, com o JSON da seção 9.

**As regras** (as seções 9 a 12 do protocolo e o desenho, item 12):
- **O estado,** por sala, na memória, com um mutex só:
  - os participantes: o id, a pessoa (0 para quem é de fora), o computador, o nome, o `deFora`, o "na reunião" (a câmera) e a tela;
  - as senhas pendentes: o participante, o papel e o vencimento;
  - os pedidos: o id, o nome, o canal, se estão visíveis e desde quando.
- **Cada senha** leva o `vence` = `Video.Agora()` + 30 s e o `id` = `NovoHex(16)`. O TURN vence em `Video.Agora()` + 12 h.
- **Os endereços do Acesso:** o `WSS()`, a `sip:reuniao@<host>`, a `sips:reuniao@<host>:5061;transport=tls`, e as do TURN, `turn:<host>:3478?transport=udp` e `turns:<host>:5349?transport=tcp`, em que o `<host>` é o `Endereco()` sem a porta.
- **A ordem das conferências** no `EntrarColega` e no `Pedir`:
  1. a reunião vale (`ErrLinkInvalido`);
  2. o servidor está ligado e no ar (`ErrSemServidor`);
  3. a reunião não está cheia (`ErrCheia`);
  4. uma reunião parada cabe no limite (`ErrServidorCheio`).

  O limite é o `ConfigReunioes.Limite`, lido do banco a cada vez.
- **A reunião de teste:** o `Pedir` dá o `aceito` na hora, com a senha de colega.
- **Os avisos aos apps** (a seção 11 do protocolo) vão aos computadores dos colegas na reunião, pelo `Avisos`, sempre depois de soltar o mutex.
- **O `Varrer`:**
  - tira as senhas pendentes vencidas;
  - recusa os pedidos visíveis há 10 minutos;
  - acaba a naHora que tem 10 minutos de criada e em que ninguém entrou.
- **O `EventoDoVideo`:**
  - o `estado` troca o "na reunião" de cada sala pelo que veio. Quem não veio sai, e quem veio sem ser conhecido entra sem nome. Uma sala que não veio acaba;
  - o `entrou` e o `saiu` (com a tela ou sem ela) mudam o participante. O primeiro colega que entra torna visíveis os pedidos guardados;
  - o `acabou`: a naHora acaba no banco, e a marcada para, com os pedidos visíveis de volta a `naoComecou`.
- **O log:** só as contagens e os códigos de erro.

- [ ] **Step 1: Os testes** (com o `videotest.Falso`, uns `Avisos` e um `Canal` de mentira que guardam o que recebem, e o relógio de teste).
  - `TestColega_Entra`:
    - o Acesso tem a senha que o `video` do agente aceita (decodificada no teste): a sala, o participante, o papel `colega` e o nome;
    - o TURN e os três endereços, para o `Endereco` `video.exemplo.com.br`.
  - `TestSenha_NoRelogioDoAgente` (Review Focus 1): com o `Agora` do falso 2 minutos adiante do relógio do chat, o `vence` é o do falso mais 30 s.
  - `TestColega_SemServidor`: sem o `Ligar`, e com o `NoAr` falso, dá `ErrSemServidor`.
  - `TestLimite_ServidorCheio`:
    - com o limite 2 e duas reuniões acontecendo, a terceira dá `ErrServidorCheio`;
    - depois do `acabou` de uma, ela passa;
    - com o limite 3 no banco, passa sem reiniciar.
  - `TestLimite_ComecandoSemUsoLibera`: a senha de um colega nunca usada segura a vaga por 30 s. Com 31 s e o `Varrer`, outra reunião começa.
  - `TestLimite_Cheia`:
    - com 10 pessoas na reunião (`entrou`), a 11ª dá `ErrCheia`;
    - as telas não contam;
    - as senhas pendentes contam.
  - `TestPedido_AntesDeComecar`:
    - o canal recebe `naoComecou`, e ninguém é avisado;
    - um colega entra (`entrou`): o canal recebe `aguardando`, e o computador do colega recebe `reuniaoPedido`, com o nome;
    - os 10 minutos contam daí.
  - `TestPedido_Aceito`:
    - o canal recebe o `aceito`, com a senha de papel `fora`;
    - os colegas recebem `reuniaoPedidoFim`;
    - depois do `entrou` dele, os colegas recebem `reuniaoParticipantes`, com ele de fora.
  - `TestPedido_PrimeiraRespostaVale` (spec 11.1, item 6): 200 rodadas, cada uma com um pedido novo e o `Aceitar` e o `Recusar` em duas goroutines ao mesmo tempo. Um dá `nil`, o outro dá `ErrJaRespondido`, e o canal recebe só um entre `aceito` e `recusado`.
  - `TestPedido_DezMinutos`: com 10 minutos menos 1 ms, ainda espera. Com 10 minutos, recusa, e os colegas recebem `reuniaoPedidoFim`.
  - `TestPedido_SoQuemEstaNaReuniao`: um colega da empresa fora da reunião recebe `ErrForaDaReuniao`.
  - `TestPedido_Desistir`: os colegas recebem `reuniaoPedidoFim`, e o canal não recebe nada.
  - `TestPedido_ReuniaoParaEVolta`: com um pedido visível, o `acabou` da marcada o devolve a `naoComecou`. Um colega entra de novo, e ele volta a `aguardando`.
  - `TestTeste_EntraDireto`: na reunião de teste, o `aceito` vem na hora, com papel `colega`, e ela conta no limite.
  - `TestTirar`: o falso recebe `tirar <sala> <participante>`, e o canal de quem é de fora recebe `tirado` e o `Fechar`.
  - `TestEncerrar`: o falso recebe `encerrar <sala>`, os canais recebem `encerrada`, e a naHora deixa de valer.
  - `TestNaHora_AcabaVazia` e `TestNaHora_NinguemEntrou`: o `acabou` ou os 10 minutos marcam o `acabou_em`, e um `Pedir` depois dá `ErrLinkInvalido`.
  - `TestValidade_EmAndamentoContinua`: uma marcada acontecendo depois do `valeAte` não tira ninguém, e um `Pedir` ou um `EntrarColega` novos dão `ErrLinkInvalido`.
  - `TestCancelada`: o falso recebe `encerrar`, e quem espera recebe `linkInvalido`.
  - `TestVideo_Reconciliacao` (Review Focus 3):
    - com três participantes e um `estado` que traz dois, o terceiro sai, e os colegas recebem `reuniaoParticipantes`;
    - uma sala que não veio acaba;
    - um participante desconhecido aparece sem nome;
    - o `Resumo` acompanha.
  - `TestVideo_FreeSWITCHCaiu` (Review Focus 4): o `acabou` de cada sala, e depois o `estado` vazio, zeram o `Resumo` e soltam o limite.
  - `TestNovaSenha`: quem é de fora, aceito e ainda fora da reunião, recebe uma senha nova com o mesmo participante. A 6ª no minuto dá `ErrLimite`.
  - `TestTela`: o colega na reunião recebe uma senha com a `tela` verdadeira. Fora dela, recebe `ErrForaDaReuniao`.
  - `TestConvidar`: os computadores recebem `reuniaoAgora`, com a reunião e quem convidou.
  - `TestSemNomesNoLog`: com o `slog` guardado num buffer durante todos os passos acima, o buffer não tem nomes, códigos, salas nem participantes.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): as regras das reuniões no chat: a sala de espera, as senhas, os limites e quem está nelas"
  ```

### Task 12: O chat: a API do app e o gerente no ar

**Files:**
- Create: `chat-servidor/internal/api/reunioes.go` e `reunioes_test.go`
- Modify: `chat-servidor/internal/api/api.go` (o `Deps`, as rotas e a janela das tentativas), `objetos.go` (a Reunião) e `chat-servidor/internal/apitest/apitest.go`
- Modify: `chat-servidor/internal/servidor/servidor.go` e `servidor_test.go`

**Interfaces:**
- **Consumes:** o `reunioes.Gerente` (Task 11), com o `Contagem`, que dá o `acontecendo` e o `pessoas` da Reunião, e o `banco` (Task 9).
- **Produces:**
  - o `api.Deps` ganha o `Gerente *reunioes.Gerente` e o `Base string`. O `Base` é o começo do link, como `https://chat.exemplo.com.br:8443`;
  - as rotas da seção 9 do protocolo, protegidas pelo `autenticar` e pelo `precisaPessoa`;
  - a janela `aberturas` (`limites.Nova(20, time.Minute, …)`), por `limites.Endereco(r)`, que a Task 13 também usa;
  - o `apitest.Ambiente` ganha:
    - o `Video *videotest.Falso` (ligado ao gerente) e o `Gerente`;
    - `LigarComPessoa(empresa banco.Empresa, ramal, nome string) (chave string, p Pessoa)` e `LiberarReunioes(empresaID int64)`;
    - o `Base` igual ao endereço do `httptest`;
  - o `servidor.Deps` ganha o `Gerente` e o `Base`:
    - em produção, o `Base` é `https://` mais o `hostPublico`; no modo de teste, `http://` mais o endereço que escuta;
    - o `rodar` cria o gerente, liga o `video.Cliente` da configuração guardada (se houver) e roda o `Gerente.Rodar` junto com as tarefas, até o desligamento.
- **O mapa dos erros:**
  - `ErrLinkInvalido` e um código que não existe dão `404 naoEncontrado`;
  - `ErrCheia` e `ErrServidorCheio` dão `409 cheia` e `409 servidorCheio`;
  - `ErrSemServidor` dá `503 servidorVideo`;
  - `ErrJaRespondido` e `ErrForaDaReuniao` dão `409 jaRespondido` e `409 foraDaReuniao`;
  - `ErrPedidoNaoEncontrado` e `ErrParticipanteNaoEncontrado` dão `404 naoEncontrado`;
  - `banco.ErrMuitasReunioes` dá `409 muitasReunioes`, e o `banco.ErrProibido` do cancelar dá `403 proibido`;
  - uma empresa sem as reuniões liberadas dá `403 semReunioes`;
  - o `entrar` de outra empresa dá `403 outraEmpresa`;
  - as outras rotas de outra empresa dão `404 naoEncontrado`.

- [ ] **Step 1: Os testes** (no `reunioes_test.go`, com o `apitest`).
  - `TestCriar_Marcada`:
    - responde 201, com o `link` igual a `Base + "/r/" + codigo`;
    - sem o `valeAte`, com o `inicio` 2026-11-12T13:00:00Z, o `valeAte` é 2026-11-13T02:59:59.999Z (23:59:59,999 de Brasília);
    - não valem o `assunto` com 121 caracteres, a falta do `inicio`, o `valeAte` antes do `inicio`, nem 31 dias e 1 ms depois dele (`400 invalido`, com o `campo` de cada um).
  - `TestCriar_SemReunioes`: responde `403 semReunioes`.
  - `TestMinhas`: só as dela, que valem, pelo `inicio`.
  - `TestCancelar`:
    - quem criou recebe 204, e o `entrar` depois dá 404;
    - outra pessoa da empresa recebe `403 proibido`;
    - alguém de outra empresa recebe 404.
  - `TestAgora`:
    - responde 201, com a naHora;
    - o computador conectado do ramal 2003 recebe `reuniaoAgora`, com o `de`;
    - o ramal 2003 de outra empresa não recebe nada em 300 ms.
  - `TestEntrar_Colega`: o Acesso tem todos os campos.
  - `TestEntrar_OutraEmpresa`: responde `403 outraEmpresa`.
  - `TestEntrar_Erros`:
    - um código que não existe, uma reunião cancelada e uma vencida dão 404;
    - sem o servidor de vídeo, dá `503 servidorVideo`;
    - com o gerente cheio, dá `409 cheia` e `409 servidorCheio`.
  - `TestTentativas`: o 21º `entrar` do mesmo endereço no mesmo minuto, com códigos certos ou errados, dá `429 tentativas`, com o `esperarSegundos` de 1 a 60.
  - `TestNaReuniao_Rotas`:
    - antes do `entrou` do falso, as seis rotas "com a pessoa na reunião" dão `409 foraDaReuniao`;
    - depois, funcionam;
    - aceitar o mesmo pedido duas vezes dá 204 e depois `409 jaRespondido`.
  - `TestEventos_Reunioes`: o WebSocket do colega na reunião recebe `reuniaoPedido`, `reuniaoPedidoFim`, `reuniaoParticipantes` e `reuniaoAcabou`.
  - `TestIsolamento_Reunioes`: um computador da empresa B não vê as reuniões da A, e o cancelar e as rotas da reunião da A dão 404.
  - `TestSemVideo_OChatSegue` (spec 11.1, item 1): com o falso fora do ar (`DefinirNoAr(false)`), o `entrar` dá `503 servidorVideo`, e enviar e ler mensagens, criar uma conversa e baixar um arquivo continuam respondendo como hoje.
  - `TestServidor_ReunioesNoAr` (no `servidor_test.go`): um banco com o endereço de um agente de teste e a chave. Depois do `RodarTeste`, o agente de teste recebe a conexão dos eventos, com o `Bearer` certo.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa, e os testes de hoje continuam sem mudar uma asserção.
- [ ] **Step 5: Faça o commit, o push e confira o CI** (o `chat` e o `build`).
  ```bash
  git commit -m "feat(reunioes): a API das reuniões para o app, com o gerente no ar"
  ```

### Task 13: O chat: a página — o abrir, o bilhete e o canal

**Files:**
- Create: `chat-servidor/internal/api/pagina.go` e `pagina_test.go`
- Modify: `chat-servidor/internal/api/api.go` (as rotas e as origens da página) e `eventos.go` (o `novosBilhetes` ganha o máximo por dono)
- Modify: `chat-servidor/internal/apitest/apitest.go`

**Interfaces:**
- **Consumes:** o `Gerente.Pedir`, o `Desistir`, o `NovaSenha` e o `TelaDeFora` (Task 11), e a janela `aberturas` (Task 12).
- **Produces:**
  - o `POST /api/v1/pagina/reunioes/{codigo}` e o `GET /api/v1/pagina/canal`, como na seção 10 do protocolo;
  - as origens da página são o `Base` mais as do `--origem`;
  - os bilhetes da página são uma instância própria do `bilhetes`, com até 50 por reunião (o dono é o id da reunião). Os do app continuam com 4 por computador;
  - o `apitest` ganha `AbrirPagina(codigo string) (status int, bilhete string)` e `CanalDaPagina(bilhete, origem string) (*websocket.Conn, *http.Response, error)`.

**O canal:**
- cada conexão tem uma fila de 32 mensagens e uma goroutine que escreve. Com a fila cheia, fecha;
- o ping é a cada 25 s, com 60 s de espera;
- cada mensagem da página passa pela janela de 20 por minuto;
- o `Canal` do gerente é essa conexão;
- fechar a conexão chama o `Desistir`, enquanto o pedido espera.

- [ ] **Step 1: Os testes.**
  - `TestAbrir`:
    - responde 200, com a reunião e um bilhete de 43 caracteres;
    - um código que não existe, uma reunião cancelada e uma empresa sem as reuniões liberadas dão 404;
    - o 21º no minuto dá 429, contando junto com o `entrar` do app.
  - `TestCanal_Origem`:
    - a origem do `Base` dá 101;
    - `https://mal.example` e a falta da origem dão `403 proibido`, e o bilhete ainda vale depois.
  - `TestCanal_Bilhete`: o bilhete usado de novo e o de 31 s atrás dão `401 chave`.
  - `TestCanal_PedirEAceito`:
    - com um colega na reunião (o `entrou` do falso), o `pedir` dá `aguardando`;
    - o colega aceita pelo app, e o canal recebe o `aceito`, com a senha de papel `fora`.
  - `TestCanal_NaoComecou`: dá `naoComecou` e, depois do colega entrar, `aguardando`.
  - `TestCanal_Recusado`: o canal recebe `recusado` e fecha com 1000.
  - `TestCanal_NomeInvalido` (Review Focus 5): `""`, `"   "`, 81 caracteres e `"Ana\u0007"` dão `{"tipo":"erro","erro":"invalido"}`, e nenhum colega recebe `reuniaoPedido`.
  - `TestCanal_Teste`: a reunião de teste dá o `aceito` na hora.
  - `TestCanal_FecharDesiste`: fechar o WebSocket enquanto espera faz os colegas receberem `reuniaoPedidoFim`.
  - `TestCanal_SenhaETela`:
    - depois do `aceito`, o `senha` dá uma senha nova com o mesmo participante;
    - o `tela` antes do `entrou` dá `erro` `foraDaReuniao`, e depois dá a senha com a `tela` verdadeira.
  - `TestCanal_TiradoEEncerrada`: o tirar do colega dá `tirado` e o fechamento; o encerrar dá `encerrada`.
  - `TestCanal_Limite`: a 21ª mensagem no minuto dá `erro` `limite`.
  - `TestCanal_ForaDeOrdem`:
    - um segundo `pedir` com o primeiro esperando, e o `senha` antes do `aceito`, dão `erro` `invalido`;
    - depois de um `cheia`, um novo `pedir` vale.
  - `TestPagina_SemNomesNoLog`: o log dos pedidos acima não tem o nome, o código, o bilhete nem a senha.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.**
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa.
- [ ] **Step 5: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): a API e o canal da página das reuniões, com a sala de espera"
  ```

### Task 14: O chat: o cartão "Reuniões" e a reunião de teste

**Files:**
- Create: `chat-servidor/internal/admin/reunioes.go`, `reunioes_test.go` e `paginas/reunioes.html`
- Modify: `chat-servidor/internal/admin/admin.go` (o `Deps`, as rotas e o cartão na lista das empresas), `paginas/empresas.html` e `estatico/estilo.css`, se preciso
- Modify: `chat-servidor/internal/servidor/servidor.go` (o `admin.Deps` com o gerente e o `Base`)
- Modify: `docs/video-servidor.md` (o passo 3, conferido com o cartão)

**Interfaces:**
- **Consumes:** o `Gerente` (`Ligar`, `Video`, `Resumo`), o `video.NovoCliente` e o `ValidarEndereco`, e o banco (Tasks 9 a 12).
- **Produces:**
  - o `admin.Deps` ganha o `Gerente *reunioes.Gerente` e o `Base string`;
  - as rotas:
    - `GET /admin/reunioes`;
    - `POST /admin/reunioes/servidor` (o `endereco` e a `chave`; a chave vazia mantém a guardada), que guarda, liga e testa;
    - `POST /admin/reunioes/testar`;
    - `POST /admin/reunioes/limite`;
    - `POST /admin/reunioes/empresas/{id}`, com o `liberar` igual a 1 ou 0;
    - `POST /admin/reunioes/teste`.

    Todas pedem a sessão e o CSRF, como as de hoje.

**A página, no estilo das telas `Painel` e `PainelEmpresa`** (os textos exatos). A spec não pede quadro para ela:
- **o título:** `Reuniões`, com o caminho `Empresas › Reuniões`;
- **o cartão `SERVIDOR DE VÍDEO`:**
  - os campos `Endereço do servidor de vídeo` (o exemplo `video.exemplo.com.br`) e `Chave do servidor de vídeo` (do tipo senha). Com uma chave guardada, o campo mostra `Chave guardada. Deixe em branco para manter.`;
  - os botões `Guardar e testar` e `Testar o servidor de vídeo`;
  - a ajuda: `A chave aparece no fim da instalação do servidor de vídeo. Para ver de novo, rode na VM de vídeo: sudo starsonic-video mostrar-chave`;
- **o resultado do teste:**
  - `O servidor de vídeo respondeu: versão <versão>, FreeSWITCH no ar.` e `Uso agora: CPU <n>% · memória <n>%.`;
  - com a diferença de 5 s ou mais: `O relógio do servidor de vídeo está <n> s <adiantado|atrasado> em relação ao do chat. As reuniões funcionam assim mesmo, mas ligue o horário automático nas duas VMs.`;
  - `A chave não confere. Copie de novo a chave mostrada na instalação.`;
  - `O servidor de vídeo não respondeu. Confira o endereço e se a porta 443 dele está aberta.`;
  - `O servidor de vídeo respondeu, mas o FreeSWITCH está fora do ar. Veja os registros na VM de vídeo.`;
- **o cartão `AO MESMO TEMPO`:** o campo `Reuniões ao mesmo tempo` (de 1 a 20) e o botão `Guardar`, com a ajuda `O padrão é 2, para a VM de 6 vCPU.`;
- **o cartão `AGORA`:** `<n> reuniões acontecendo · <n> pessoas`, com o singular em `1 reunião` e `1 pessoa`, e `Servidor de vídeo: <endereço> · respondendo` ou `· sem resposta`;
- **a tabela `EMPRESAS`,** com as colunas `EMPRESA` e `REUNIÕES` (`Liberadas` ou `Bloqueadas`), e os botões `Liberar` e `Bloquear`;
- **o cartão `REUNIÃO DE TESTE`:**
  - o botão `Criar a reunião de teste`;
  - com uma de teste valendo: o link, o botão `Copiar o link` (o `copiar.js` de hoje) e `Vale até <hh:mm>`, no horário de Brasília;
  - a ajuda: `Abra o link em dois aparelhos, um deles um celular, para conferir a instalação. A reunião de teste não tem sala de espera e vale por 2 horas.`;
- **os erros:**
  - `Escreva só o endereço do servidor de vídeo (e a porta, se tiver), sem https://.`;
  - `A chave tem 43 caracteres. Copie de novo a chave mostrada na instalação.`;
  - `O número de reuniões ao mesmo tempo vai de 1 a 20.`;
- **na lista das empresas (`/admin/`),** o cartão `REUNIÕES`, com:
  - `O servidor de vídeo ainda não foi configurado.`, ou o endereço com `respondendo` ou `sem resposta`;
  - a contagem do cartão `AGORA`;
  - o link `Configurar as reuniões`.

**A página nunca mostra quem está numa reunião** (spec 9): só as contagens, o uso e o link da reunião de teste.

- [ ] **Step 1: Os testes** (com o cliente do `cookiejar` de hoje e um agente de teste no `httptest`).
  - `TestReunioes_SemConfig`: a página e o cartão da lista mostram `O servidor de vídeo ainda não foi configurado.`
  - `TestReunioes_GuardarETestar`:
    - com o agente respondendo, aparecem o texto da versão e o do uso, e o gerente passa a usar o cliente novo (o agente de teste recebe a conexão dos eventos);
    - com o 401, o texto da chave;
    - com o agente fora, o texto do "não respondeu";
    - com o `freeswitch` falso, o texto do FreeSWITCH.
  - `TestReunioes_Relogio` (Review Focus 1): com o `agora` do agente 45 s adiante, aparece `está 45 s adiantado`. Com 3 s, nada.
  - `TestReunioes_Validacao`: o endereço com `https://` ou com caminho, a chave com 42 caracteres, e o limite 0, 21 e `x` mostram os erros, e nada é guardado.
  - `TestReunioes_Limite`: o 3 guardado vale para o gerente.
  - `TestReunioes_Empresas`: o `Liberar` deixa o app criar reuniões (`POST /api/v1/reunioes` dá 201), e o `Bloquear` volta ao 403.
  - `TestReunioes_Teste`:
    - o link aparece, com o `Vale até` 2 horas depois;
    - um segundo `Criar` troca o link;
    - o abrir da página com o código antigo dá 404, e com o novo dá 200.
  - `TestReunioes_SemNomes`: com "Ana Souza" e "Maria Lima" numa reunião acontecendo, nenhuma página da administração tem esses nomes, nem o código da reunião deles.
  - `TestReunioes_CSRF`: cada `POST` sem o CSRF dá 403, e nada muda.
- [ ] **Step 2: Rode o chat.** Esperado: falha.
- [ ] **Step 3: Escreva o código.** A reunião de teste vale `agora + 2 h`, e o `Base` dá o link.
- [ ] **Step 4: Rode o chat.** Esperado: tudo passa.
- [ ] **Step 5: O guia.** Confira o passo 3 do `docs/video-servidor.md` contra os textos do cartão, e acerte o que diferir:
  1. abrir a administração do chat e clicar em `Configurar as reuniões`;
  2. colar o endereço e a chave e clicar em `Guardar e testar`, com o que se deve ver;
  3. clicar em `Liberar` na empresa;
  4. o limite.
- [ ] **Step 6: Faça o commit, o push e confira o CI.**
  ```bash
  git commit -m "feat(reunioes): o cartão Reuniões da administração do chat e a reunião de teste"
  ```

### Task 15: De ponta a ponta: o FreeSWITCH, o agente e o chat, com os navegadores

**Files:**
- Create: `video-servidor/e2e/package.json`, `package-lock.json`, `tsconfig.json` e `playwright.config.ts`
- Create: `video-servidor/e2e/ambiente.ts` (o `globalSetup`), `servidores.ts` (a administração, a API como computador e o canal da página), `midia.ts` (a câmera e o som falsos) e `estatico.mjs` (o servidor do cliente)
- Create: `video-servidor/e2e/cliente/index.html` e `cliente.js`
- Create: `video-servidor/e2e/reuniao.spec.ts` e `seguranca.spec.ts`
- Modify: `.github/workflows/video.yml` (o job `ponta-a-ponta`, e os `paths` ganham `chat-servidor/**` e `docs/chat-protocolo.md`)
- Modify: o que o e2e provar errado nas Tasks 3 a 14, com o teste que pegou

**Interfaces:**
- **Consumes:** tudo das Tasks 1 a 14. O FreeSWITCH vem de `STARSONIC_FREESWITCH_DIR` (padrão `/opt/starsonic-freeswitch`), e os programas, de `STARSONIC_CHAT_BIN` e `STARSONIC_VIDEO_BIN`. Sem eles, o `ambiente.ts` compila, como o `windows/ui/tests/chat/global-setup.ts`.
- **Produces:** o cliente mínimo, em `window.cliente`:
  - `entrarPelaPagina({chat, codigo, nome})`: o abrir, o canal, o `pedir` e, com o `aceito`, o `ligar`;
  - `ligar(acesso)`: o `JsSIP.UA` com o `wss` do acesso e sem `register`, e o `call` para a `uri`, com o `extraHeaders` `X-Starsonic-Senha` e a câmera e o microfone falsos;
  - `mensagens()`, com as do canal;
  - `amostra(fx, fy)`, que dá o `[r, g, b]` do vídeo recebido, num canvas;
  - `frequencia()`, a frequência mais forte do som recebido, por um `AnalyserNode` (o stream também toca num `<audio muted>`, porque o Chrome só entrega o som remoto ao WebAudio assim);
  - `compartilhar(senha)`: a segunda ligação, com um `canvas.captureStream(15)` verde, redesenhado a cada quadro, e um silêncio gerado (um `MediaStreamAudioDestinationNode`) no som, os dois só para mandar;
  - em toda ligação, o som manda sempre: o microfone falso, ou o silêncio gerado (seção 6 do contrato);
  - `pararDeCompartilhar()`, `sair()` e `terminou()`, este com o código SIP do fim.

**O ambiente:**
- **A mídia falsa:** um Y4M de 320×180 a 15 qps para cada câmera e um WAV de 10 s para cada som, gerados no `midia.ts`. O Chromium os usa pelo `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=<y4m>`, `--use-file-for-fake-audio-capture=<wav>` e `--autoplay-policy=no-user-gesture-required`.
- **As cores, os sons e os nomes:**
  - A: o vermelho (220, 30, 30) e 440 Hz. Na reunião de teste, é o "Carlos Lima"; na marcada, liga com o acesso da Ana Souza;
  - B: o azul (30, 60, 220) e 880 Hz, a "Bia Ramos";
  - C: o amarelo (220, 200, 30) e 660 Hz, a "Maria Lima";
  - a tela: o verde (30, 180, 60).
- **Os servidores e as portas:**
  - o FreeSWITCH com o `configurar --teste`, no IP IPv4 da máquina que não é de loopback;
  - o agente no `servir --teste --escutar 127.0.0.1:8095 --origem http://127.0.0.1:4190`;
  - o chat no `servir --teste --escutar 127.0.0.1:4191 --dados <pasta> --origem http://127.0.0.1:4190`;
  - o cliente em `http://127.0.0.1:4190`, com o `jssip/dist/jssip.min.js` do `node_modules`;
  - a saída de cada servidor num arquivo de `test-results/`.
- **A preparação:**
  - o administrador de teste (o `admin-criar`, com uma senha sorteada);
  - o cartão "Reuniões" com `http://127.0.0.1:8095` e a chave do `config.json` de teste, e 20 reuniões ao mesmo tempo;
  - a empresa "ACME Comércio Ltda", liberada;
  - o computador da Ana Souza (2001), ligado pela API.
- **O `playwright.config.ts`:** `workers: 1`, sem o `fullyParallel` (os servidores são um só), 120 s por teste e o `retries: 0`. Cada teste fecha os seus navegadores no fim.
- **Os pontos do mosaico** (no vídeo recebido, em frações):
  - com 2 pessoas: (0,25; 0,5) e (0,75; 0,5);
  - com 3 ou 4: (0,25; 0,25), (0,75; 0,25), (0,25; 0,75) e (0,75; 0,75);
  - na apresentação: a tela em (0,4167; 0,4167), e as pessoas nos centros dos dez quadros pequenos da seção 7 do contrato.

  Uma cor confere com cada canal a até 60 da esperada, e o teste espera até 20 s por ela.

- [ ] **Step 1: Os testes** (`reuniao.spec.ts` e `seguranca.spec.ts`). Os três da reunião marcada formam um `test.describe.serial`, na mesma reunião. Os outros são independentes, e cada um usa a sua reunião.
  - `a reunião de teste mostra as duas câmeras no mosaico e cada um ouve o outro`:
    - A e B entram pela página na reunião de teste;
    - no vídeo de B, os dois pontos do mosaico de 2 têm o vermelho e o azul, em qualquer ordem. No de A também (cada um se vê);
    - B ouve 440 Hz e A ouve 880 Hz, a até 25 Hz.
  - `a pessoa de fora espera, é aceita pela colega e entra no mosaico`:
    - a Ana cria uma marcada pela API;
    - C abre antes e recebe `naoComecou`;
    - a Ana entra pelo `entrar`, e o navegador A liga com o acesso dela;
    - C recebe `aguardando`, e o WebSocket do app da Ana recebe `reuniaoPedido` com `Maria Lima`;
    - a Ana aceita, C entra, e o mosaico de 2 mostra o vermelho e o amarelo.

    Um segundo pedido (B, "Bia Ramos") recusado recebe `recusado`.
  - `a tela compartilhada ganha o quadro grande e a grade volta quando ela para`:
    - na mesma reunião, C pede a `tela` e compartilha;
    - no vídeo de A, o ponto da tela fica verde, e o vermelho e o amarelo estão em dois dos quadros pequenos;
    - 70 s depois, a tela continua verde (a ligação da tela manda o silêncio, e o tempo sem mídia não a derruba);
    - C para, e o mosaico de 2 volta.
  - `a colega tira uma pessoa e depois encerra para todos`:
    - o tirar de C termina a ligação dele em até 10 s, e o canal dele recebe `tirado`;
    - o encerrar termina a de A, e o `participantes` da Ana dá `409 foraDaReuniao`.
  - `quem fecha a aba sai da reunião em até 75 segundos` (Review Focus 2): numa reunião de teste com A, B e C, o navegador de C é fechado (`browser.close()`), sem o `sair()` e sem o BYE. Em até 75 s, o vídeo de A volta ao mosaico de 2, com o vermelho e o azul.
  - `a senha não vale duas vezes nem sem o cabeçalho`:
    - uma ligação sem o `X-Starsonic-Senha` termina com 403;
    - a senha de uma ligação que entrou, usada de novo por outro navegador, termina com 403.
  - `o SIP por TLS na 5061 responde ao OPTIONS e recusa o INVITE sem senha`. Um `tls.connect` do Node (sem conferir o certificado de teste) manda:
    - um `OPTIONS sip:reuniao@127.0.0.1:5061;transport=tls` e lê `SIP/2.0 200`;
    - um `INVITE` com um SDP de áudio PCMU em `RTP/SAVP`, com `a=crypto`, sem a senha, e lê `SIP/2.0 403`.
  - `o WebSocket do navegador recusa outra origem`: um `fetch` de upgrade ao `/sip` com `Origin: https://mal.example` dá 403.
  - `os registros não têm nomes, códigos nem senhas`, o último. Os arquivos de saída do FreeSWITCH, do agente e do chat não têm "Ana Souza", "Carlos Lima", "Maria Lima", "Bia Ramos", nenhum código de reunião, nenhuma sala e nenhuma senha usados nos testes.
- [ ] **Step 2: Rode o e2e** (Como rodar os testes), com o FreeSWITCH da Task 2. Esperado: os testes falham, porque o cliente e o ambiente ainda não existem.
- [ ] **Step 3: Escreva o ambiente, o cliente e os testes.** Acerte o que o e2e provar errado nas tarefas anteriores, cada mudança com o teste do Go que a pegaria.
- [ ] **Step 4: Rode o e2e aqui** (se o FreeSWITCH local existir) e o agente e o chat. Esperado: tudo passa, em menos de 10 minutos.
- [ ] **Step 5: O job `ponta-a-ponta`.**
  - Ele precisa do `agente` e do `freeswitch` e roda no `ubuntu-24.04`, sem contêiner.
  - Os passos:
    1. baixa o artefato `starsonic-freeswitch-ubuntu-24.04`, extrai com `sudo` em `/` e instala os pacotes do `pacotes.txt`;
    2. compila o chat e o agente;
    3. roda o `npm ci` em `video-servidor/e2e` e o `npx playwright install chromium --with-deps`;
    4. roda o `npx playwright test`, com as três variáveis de ambiente.
  - Numa falha, sobe os arquivos de saída e o relatório.
- [ ] **Step 6: Faça o commit, o push e confira o CI** (o `video` inteiro verde, e o `chat`).
  ```bash
  git commit -m "test(reunioes): de ponta a ponta, com o FreeSWITCH do nosso build, o agente, o chat e dois navegadores"
  ```

### Task 16: A publicação do servidor de vídeo

**Files:**
- Create: `.github/workflows/video-release.yml`
- Modify: `docs/video-servidor.md` (o passo "Publicar uma versão")

**Interfaces:**
- **Consumes:** os jobs do `video.yml` (o build do FreeSWITCH, pelo mesmo cache) e os arquivos da Task 8.
- **Produces:** a release `video-v<versão>`, como pre-release, com estes 11 arquivos:
  - `starsonic-video-linux-amd64` e `starsonic-video-linux-amd64.sha256`;
  - `starsonic-freeswitch-ubuntu-24.04-amd64.tar.gz` e o `.sha256` dele;
  - `starsonic-freeswitch-debian-12-amd64.tar.gz` e o `.sha256` dele;
  - `starsonic-freeswitch-fontes.tar.gz`;
  - `instalar.sh`, com a versão embutida;
  - `starsonic-video.service`, `starsonic-freeswitch.service` e `certificado.sh`.

- [ ] **Step 1: O workflow,** no jeito do `chat-release.yml`:
  - **o disparo:** só o `workflow_dispatch`, com a entrada `versao` (`Versão a publicar (ex.: 0.1.0 ou 0.1.0-rc.1)`), e o `concurrency` `video-release`;
  - **as conferências:**
    - a `versao` casa com `^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$`;
    - a tag `video-v<versão>` ainda não existe;
    - o `REPOSITORIO` do `instalar.sh` é o deste repositório;
  - **os jobs do FreeSWITCH:** os dois sistemas, com o mesmo cache e o mesmo script do `video.yml`, e o `conferir-pacote.sh` de cada um num contêiner limpo;
  - **o job `preparar`:**
    - roda os testes do agente e compila com o `-ldflags` da versão;
    - confere se o `versao` do programa mostra a `versao`;
    - roda o `shellcheck`, o `instalar-teste.sh` e o `systemd-analyze`;
    - monta os 11 arquivos. O `instalar.sh` passa pelo `sed` do `@VERSAO@`, conferido como no `chat-release.yml`;
  - **o job `publicar`,** o único com `contents: write`, sem rodar código do repositório:
    - confere a tag e um rascunho que tenha sobrado;
    - cria o rascunho com o `gh api`: o nome `Starsonic Vídeo <versão>`, o corpo `Servidor de vídeo das reuniões do Starsonic Phone <versão>. Para instalar, siga docs/video-servidor.md.`, `prerelease: true` e `make_latest: "false"`;
    - envia os arquivos e confere a lista dos 11 nomes;
    - publica;
    - confere o `releases/latest`, que tem de ser 404 ou uma versão do Windows (`v…`), com a mesma mensagem do `chat-release.yml`.
- [ ] **Step 2: Rode o `actionlint`** nos `.github/workflows/video*.yml`, se o ambiente tiver ou se ele puder ser baixado de uma release do GitHub dele. Esperado: sem erros.
- [ ] **Step 3: O guia,** o passo "Publicar uma versão", como o do chat:
  - o caminho: Actions, `video-release`, Run workflow, com a versão `0.1.0-rc.1`;
  - o que conferir depois: os 11 arquivos, o `sha256sum -c` na VM e o `releases/latest`.
- [ ] **Step 4: Faça o commit, o push e confira o CI** (o `video`). O workflow de publicação não roda: quem roda é o responsável.
  ```bash
  git commit -m "ci(reunioes): a publicação do servidor de vídeo, sem virar a latest"
  ```

---

## Depois das tarefas
- **A revisão final** (no modelo mais capaz) olha a etapa inteira:
  - pela seção 9 da spec (a segurança e a privacidade), pelas seções 6, 7 e 11;
  - pelos dois contratos, nos dois lados: os nomes, os campos, os erros e os vetores.
- **O CI** `video` e o `chat` têm de estar verdes no último commit, e o `build` também, quando ele rodar.
- **A entrega** é o relatório ao controlador, com:
  - os itens de "O desenho";
  - o tempo do build do FreeSWITCH e o do e2e no CI;
  - o que ficou só no CI (o build local, se o apt não alcançou a rede).
- **O responsável:**
  - publica a `video-v0.1.0-rc.1` e, se quiser o cartão antes da página, a `chat-v0.2.0-rc.1`;
  - instala a VM de vídeo pelo `docs/video-servidor.md`;
  - liga o servidor de vídeo no cartão.

  A reunião de teste pelo navegador chega com a etapa 1b.
