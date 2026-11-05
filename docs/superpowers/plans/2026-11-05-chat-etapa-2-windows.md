# Chat, etapa 2 — o chat no app do Windows (0.2.0-rc.1) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a versão de teste 0.2.0-rc.1 do Starsonic Phone para Windows, com o chat dentro do app. Ela traz a aba Chat, as conversas a dois e os grupos, os arquivos e as fotos, o aviso do Windows, o número no ícone e o cartão Chat na área do administrador, tudo falando com o servidor da etapa 1.

**Architecture:**
- O cliente do chat fica na interface (Preact), numa pasta nova, `windows/ui/src/chat/`. Ele fala direto com o servidor: HTTPS para as operações e um WebSocket para as novidades, seguindo o `docs/chat-protocolo.md`.
- O cliente é criado uma vez, no `main.tsx`, e não dentro da aba. Assim, com a aba fechada ou o app na bandeja, as mensagens chegam, o número sobe e o aviso aparece.
- O núcleo portátil (`starsonic/desktop`) cuida de três coisas: guarda a chave do computador (pelo cifrador, que no Windows é a DPAPI), guarda os ramais que já se conectaram e decide os comandos novos da ponte.
- O executável (`windows/app/src`) mostra o aviso (`Shell_NotifyIcon`), põe o número no ícone da barra de tarefas (`ITaskbarList3`) e baixa os arquivos (WinHTTP). Cada uma dessas coisas é um gancho novo do `DesktopHooks`.
- Os testes da interface rodam contra o servidor de verdade, no modo de teste, compilado do próprio repositório.

**Tech Stack:**
- Na interface: TypeScript 5.9.3, Preact 10.29.8 e esbuild 0.28.2, com Playwright 1.56.1 e `@axe-core/playwright` 4.11.3 nos testes.
- No núcleo e no executável: C++17 com doctest, nlohmann/json e Win32/COM (`Shell_NotifyIcon`, `ITaskbarList3`, WinHTTP, `SHGetKnownFolderPath`, `ShellExecuteW`).
- O servidor da etapa 1 (Go) entra só nos testes, com uma mudança no modo de teste (Task 1).

**Spec:** `docs/superpowers/specs/2026-11-04-starsonic-phone-chat-design.md`. Para esta etapa valem as seções 4, 6.3, 6.4, 8, 9.3, 10, 11, 13 e 15.
- **Os contratos:** o da API é o `docs/chat-protocolo.md`, e o da ponte é o `docs/ponte-windows.md`, que a Task 2 aumenta.
- **O visual:** o quadro "Starsonic Phone — telas do chat" (artifact `RBeDUskf47gUff4FCzPxwV`). As telas do app estão em `$SCRATCH/canvas-chat/project/*.dc.html`, com `$SCRATCH=/tmp/claude-0/-home-claude/62d54bdc-24b1-5e22-a5c0-39fd7d73e742/scratchpad`.
- **O que veio da etapa 1:** está no fim do documento "chat-servidor-0.1.0-decisoes" do projeto. São cinco pontos: espalhar a reconexão, o `idLocal` aleatório, as mensagens em ordem de id, a caixa de escrever desligada na conversa com quem saiu e o `429` com espera.

## Global Constraints
- **O endereço do servidor** é `https://chat.starcloud-starsonic.com.br:8443`, o que o responsável instalou em 05/11/2026.
  - A API fica em `/api/v1`, e o WebSocket em `wss://chat.starcloud-starsonic.com.br:8443/api/v1/eventos`.
  - Na interface, o endereço fica num lugar só (`ENDERECO_DO_CHAT`, em `windows/ui/src/chat/endereco.ts`). No executável, também num só (`kChatOrigin`, em `windows/app/src/ChatFiles.h`).
- **O gancho de teste:** o parâmetro `chat=<endereço>` troca o endereço, mas só com a ponte falsa (`?fake=<cenário>` e sem o `window.chrome.webview`). No app de verdade, ele nunca vale.
- **A versão é 0.2.0-rc.1,** com as notas em `notas/v0.2.0-rc.1.txt`. Quem publica é o responsável, pelo workflow `release`. O agente nunca cria tag nem release.
- **A ponte continua na versão 1:** ela só ganha comandos, campos e mensagens. Uma mudança na ponte muda, no mesmo commit, o `docs/ponte-windows.md`, o `starsonic/desktop/Protocol.cpp` e o `windows/ui/src/state.ts`.
- **O CSP** da `windows/ui/index.html` fica exatamente assim:
  `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self' https://chat.starcloud-starsonic.com.br:8443 wss://chat.starcloud-starsonic.com.br:8443; media-src 'self'`.
  Os testes que usam o servidor de teste rodam com `test.use({ bypassCSP: true })`.
- **Os limites,** iguais aos da seção 8 do protocolo:
  - o texto tem até 4.000 caracteres, contados como `[...texto].length`;
  - um envio leva até 10 arquivos, cada um com até 26.214.400 bytes;
  - a miniatura é um JPEG de até 204.800 bytes, com até 480 px no lado maior;
  - o grupo tem até 200 pessoas, e o nome dele até 60 caracteres;
  - as mensagens vêm em páginas de 50.
- **Os tempos:**
  - sem resposta em 15 s, a mensagem fica "Não enviada";
  - a reconexão espera 1, 2, 5, 10 e 30 s, e depois 30 s a cada vez, cada espera vezes um fator aleatório entre 0,5 e 1,5;
  - um `429 limite` espera o `esperarSegundos` e tenta de novo.
- **A ordem das mensagens:** elas ficam sempre em ordem de id, nunca na ordem em que chegaram. Uma mensagem que já está na tela (o mesmo `id`, ou o mesmo `idLocal`) não entra de novo. O `idLocal` é um `crypto.randomUUID()`.
- **A segurança:**
  - A chave do computador fica só na memória da interface. Ela nunca vai para o estado da ponte, o DOM, uma URL, o `localStorage` ou o diagnóstico.
  - A interface e o executável mandam a chave só para o `ENDERECO_DO_CHAT`. O download do executável nunca segue um redirecionamento.
  - O texto das mensagens e os nomes aparecem sempre como texto, nunca como HTML (nada de `dangerouslySetInnerHTML`).
  - O diagnóstico nunca leva a chave, o código da empresa, o texto de uma mensagem, o nome de um arquivo, nem o título ou o texto de um aviso. Fica só o nome do comando e as contagens.
  - O arquivo baixado leva o `Zone.Identifier` com `ZoneId=3`.
  - Os `blob:` das fotos saem com o `URL.revokeObjectURL` quando a tela deles fecha.
- **Os textos** são os da seção 10 da spec e os da lista "Os textos novos", abaixo, letra por letra. Em C++, os literais são ASCII: um caractere fora do ASCII vai como escape UTF-8 (`"N\xc3\xa3o"`), e o `build/check_source_text.py` confere isso.
- **O visual:**
  - as telas seguem o quadro e os tokens do `windows/ui/src/app.css`;
  - as suas mensagens ficam em `blue` no tema claro e em `cyan` no escuro, com o texto `on-cyan`;
  - a fonte é a Plus Jakarta Sans, que o app já tem;
  - nenhum "MicroSIP" aparece em lugar nenhum.
- **O modo iPhone:** o estado não traz o `chat`, a aba Chat não aparece, e os comandos do chat são recusados.
- **O C++:** `starsonic/desktop` continua portátil, sem cabeçalho do Windows. Uma regra que dá para testar no Linux fica num arquivo portátil, como o `windows/app/src/ChatFiles.cpp` (Task 3).
- **Os testes que rodam aqui:**
  - os do app de PC: `cmake -S tests/desktop -B <build> -G Ninja && cmake --build <build> -j 8 && <build>/desktop_tests`;
  - os da interface: `cd windows/ui && npm run typecheck && npm run build && npx playwright test`. Aqui eles rodam com `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
  - os do servidor: `cd chat-servidor && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 go test -race ./...`.

  O build do Windows e a fumaça rodam só no CI (workflow `build`, job "Windows (Win32, Release)"). Por isso, a tarefa que mexe no executável termina com o push e o CI verde.
- **O repositório é público:**
  - nada de segredo nem de dado de cliente;
  - os nomes de teste são inventados ("ACME Comércio Ltda", "Ana Souza", ramal "2003");
  - a senha do administrador do servidor de teste é sorteada a cada rodada, e nunca fica em arquivo;
  - nada do nome do fornecedor da central.
- **Os commits** vão para o `main`, sem forçar push e sem ramo remoto novo. Eles terminam com as duas linhas: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- **O servidor** só muda no modo de teste (Task 1). A API e a produção ficam como estão, e nenhuma versão nova do servidor é publicada.

## Review Focus
1. **A troca de conta com o chat aberto.** As conversas da primeira pessoa não podem aparecer para a segunda: a lista, a conversa aberta e o número saem antes de a segunda entrar. O teste fica na Task 4.
2. **A conexão que cai e volta várias vezes enquanto chegam mensagens.** Nenhuma mensagem pode ficar repetida nem faltar, e a ordem é a dos ids. A sua mensagem, que volta pela resposta e pelo WebSocket, aparece uma vez só. Os testes ficam na Task 6.
3. **Ler as mensagens antigas enquanto chegam novas.** A tela não pode pular para baixo. Lá embaixo, ela acompanha a mensagem nova. O teste fica na Task 6.
4. **Os textos compridos sem espaço:** uma palavra de 4.000 caracteres, um nome de arquivo de 120 caracteres e um nome de grupo de 60. Nada pode fazer a janela rolar para o lado, nem com 400 px nem com 300 px de largura. Os testes ficam nas Tasks 6 e 7.
5. **Os caracteres que trocam a direção do texto num nome** (por exemplo, `Proposta‮fdp.exe`, que aparece como "Propostaexe.pdf"). A tela mostra o nome sem eles, e o arquivo é salvo sem eles. Os testes ficam nas Tasks 3 e 7.

---

## As pastas e as responsabilidades
```
chat-servidor/cmd/starsonic-chat/      o --origem do servir --teste (Task 1)
starsonic/desktop/Chat.h, Chat.cpp     a ChatStore (chat.json pelo cifrador) e as validações (Task 2)
starsonic/desktop/Protocol.*           os comandos, as mensagens e o campo chat do estado (Task 2)
starsonic/desktop/DesktopApp.*         os comandos do chat, os ganchos, a janela na frente, o abrir (Task 2)
starsonic/win/Http.*                   o GET com o Authorization, sem redirecionamento (Task 3)
windows/app/src/ChatFiles.*            portátil: o número, o nome para salvar, o "(2)", o Zone.Identifier, o corte do aviso (Task 3)
windows/app/src/TaskbarBadge.*         o número no ícone da barra de tarefas (Task 3)
windows/app/src/ChatDownloader.*       baixar para a pasta Downloads e abrir (Task 3)
windows/app/src/Tray.*, MainWindow.*, main.cpp   o aviso, o clique nele, a janela na frente e os ganchos (Task 3)
windows/ui/src/chat/                   o cliente e as telas do chat (Tasks 4 a 7)
  tipos.ts        os objetos do protocolo (seção 4)
  endereco.ts     o ENDERECO_DO_CHAT e o gancho de teste
  api.ts          as operações (seções 5 e 6) e os erros (seção 2)
  eventos.ts      o bilhete, o WebSocket e a reconexão
  cliente.ts      o ChatCliente: o estado do chat e as ações
  usarChat.ts     o useVistaChat (o Preact redesenha quando a vista muda)
  textos.ts       todos os textos do chat
  formato.ts      as horas, os tamanhos, os tipos, as prévias e os textos do aviso
  miniatura.ts    a miniatura da foto (Task 7)
  CartaoChat.tsx  o cartão Chat da área do administrador
  telas/          Lista, NovaConversa, Escolher, NovoGrupo, PorPessoas, Membros, Conversa
  componentes/    Avatar, Faixa, Balao, Escrever, Anexos, FotoGrande
windows/ui/tests/chat/                 o servidor de teste (servidor.ts), a abertura (abrir.ts) e as specs
```

## A ponte nova (o resumo; o texto completo vai para o `docs/ponte-windows.md` na Task 2)
- **No estado, só no Windows:** `"chat": {"ligado": true, "empresa": "ACME Comércio Ltda", "computador": "RECEPCAO-01", "contaConectada": true}`.
  - `ligado`: há uma chave guardada.
  - `empresa`: o nome da empresa guardado com a chave, ou `""`.
  - `computador`: o nome do computador no Windows.
  - `contaConectada`: a conta em uso já se conectou à central neste computador, pelo par `servidor|ramal`.
- **Os comandos (interface → C++):**

  | Comando | Campos | O que faz |
  |---|---|---|
  | `chatKey` | — | Pede a chave. O C++ responde com a mensagem `chatChave`. |
  | `chatLink` | `chave` (43 de `[A-Za-z0-9_-]`), `empresa` (1 a 80 caracteres, sem controle) | Guarda a chave e a empresa, e o `chat.ligado` passa a `true`. Se não conseguir gravar, vem um toast. |
  | `chatUnlink` | — | Apaga a chave e a empresa (os ramais ficam), e o `chat.ligado` passa a `false`. |
  | `chatNotify` | `conversa` (inteiro ≥ 0), `titulo` (1 a 200 caracteres), `texto` (0 a 500) | Mostra o aviso do Windows. Com o Não perturbe ligado, não mostra nada. `conversa` 0 faz o aviso abrir a aba Chat. |
  | `chatBadge` | `n` (inteiro ≥ 0) | Põe o número no ícone da barra de tarefas. O C++ só repassa quando o número muda. |
  | `chatDownload` | `arquivo` (32 de `[0-9a-f]`), `nome` (1 a 255 caracteres) | Baixa o arquivo com a chave guardada, para a pasta Downloads, marca como vindo da internet e abre. Sem a chave, o comando é ignorado. |

- **As mensagens (C++ → interface):**
  - `{"v":1,"type":"chatChave","chave":"…","empresa":"…"}`: a resposta ao `chatKey`, com `""` e `""` quando o computador não está ligado. A chave nunca vem no estado.
  - `{"v":1,"type":"janela","frente":true}`: diz se a janela está na frente, isto é, visível, sem minimizar e ativa. Vem depois do estado a cada `ready` e de novo a cada mudança. Antes da primeira, a interface considera `false`.
  - `{"v":1,"type":"abrir","tela":"chat","conversa":7}`: a pessoa clicou no aviso do chat. Com `conversa` 0, vai para a aba Chat. Um pedido antes do primeiro `ready` fica para ele, depois do estado.
- **Os toasts novos do C++:**
  - "Arquivo expirado" (o download respondeu 410);
  - "Não foi possível baixar o arquivo." (qualquer outro erro do download);
  - "Não foi possível ligar este computador ao chat." (o `chatLink` não gravou).

## Os textos novos (vão nas fotos para a aprovação do responsável)
- **A aba:** o rótulo de leitor de tela é "Chat, 1 mensagem não lida" ou "Chat, <n> mensagens não lidas". Sem nenhuma, só "Chat".
- **A lista:**
  - a busca sem resultado: "Nenhuma conversa encontrada.";
  - a prévia: "Você: <texto>" para a sua; num grupo, "<primeiro nome>: <texto>" para a dos outros; uma foto é "Foto", um arquivo é o nome dele, e um aviso de grupo é o texto do aviso;
  - a hora: "09:41" para hoje, "Ontem", o dia da semana dos últimos 6 dias ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"), depois "dd/mm", e "dd/mm/aaaa" para outro ano.
- **O separador do dia na conversa:** o `dayGroup` do `format.ts`, que dá "Hoje", "Ontem" e "2 de novembro" (com o ano, se for de outro ano).
- **Os avisos de grupo:**
  - "<Quem> criou o grupo";
  - "<Quem> pôs <Alvo> no grupo";
  - "<Quem> tirou <Alvo> do grupo";
  - "<Quem> saiu do grupo".

  Quando quem fez é você, o texto começa com "Você". Quando o alvo é você, ele vira "você", como em "Beatriz Ramos pôs você no grupo".
- **Quem saiu:** o nome ganha " (saiu)". Na conversa a dois com quem saiu, o lugar de escrever vira "<Nome> saiu do chat.", e o Ligar some.
- **Nova conversa:** "Nenhum colega no chat ainda." quando a lista está vazia, e "Ninguém encontrado." quando a busca não acha.
- **Novo grupo e Pôr pessoas no grupo:**
  - "Criar grupo" fica desligado sem nenhuma pessoa escolhida;
  - o botão de pôr diz "Pôr 1 pessoa no grupo" ou "Pôr <n> pessoas no grupo", e fica desligado, com "Pôr pessoas no grupo", sem ninguém escolhido.
- **Membros:**
  - o título da lista: "1 pessoa" ou "<n> pessoas";
  - o seu nome ganha " (você)";
  - a linha de baixo: "Ramal <n> · criou o grupo", "Ramal <n> · cuida do grupo" ou "Ramal <n>".
- **As confirmações** (o `components/Confirm.tsx` de sempre):
  - Tirar: o título "Tirar <nome> do grupo?", o texto "<nome> deixa de ver as mensagens novas do grupo." e os botões "Tirar" e "Cancelar";
  - Sair: o título "Sair do grupo?", o texto "Para voltar, quem cuida do grupo precisa pôr você de novo." e os botões "Sair do grupo" e "Cancelar".
- **A conversa:**
  - "Enviando…" no lugar da hora, enquanto a mensagem não chegou ao servidor;
  - "Faltam <n>" quando faltam 200 caracteres ou menos.
- **Os arquivos:**
  - o toast "Mande até 10 arquivos de uma vez.";
  - os tipos: "PDF", "Planilha", "Documento", "Apresentação", "Foto", "Áudio", "Vídeo", "Arquivo compactado" e "Arquivo";
  - o tamanho: "<n> bytes", "<n> KB" ou "<n,n> MB", na base 1.024, como no quadro ("1,2 MB · PDF");
  - os nomes de leitor de tela: "Tirar <nome>" no "×" de um anexo, "Abrir <nome>, <tamanho>" no balão, "Abrir a foto <nome>" na foto e "Baixar <nome>" na foto grande;
  - a foto grande tem os botões "Baixar" e "Fechar".
- **O cartão Chat:**
  - "Muitas tentativas. Tente de novo daqui a 1 minuto." ou "Muitas tentativas. Tente de novo daqui a <n> minutos.", com o `esperarSegundos` arredondado para cima em minutos;
  - "Sem conexão com o chat. Tente de novo.".
- **O aviso de computador novo:** a faixa da lista tem o "×" com o nome "Fechar o aviso". O aviso do Windows tem o título "Chat" e o texto "Seu chat entrou em outro computador: <nome>".
- **O número no ícone da barra de tarefas:** o nome de leitor de tela é "1 mensagem não lida" ou "<n> mensagens não lidas".

---

### Task 1: O servidor do chat nos testes da interface

**Files:**
- Modify: `chat-servidor/cmd/starsonic-chat/main.go` (o `--origem`), `chat-servidor/cmd/starsonic-chat/main_test.go`, `chat-servidor/internal/servidor/servidor_test.go`
- Modify: `docs/chat-protocolo.md` (a seção 1, o modo de teste)
- Create: `windows/ui/tests/chat/servidor.ts`, `windows/ui/tests/chat/global-setup.ts`, `windows/ui/tests/chat/servidor.spec.ts`
- Modify: `windows/ui/playwright.config.ts`, `.github/workflows/build.yml`

**Interfaces:**
- Produces:
  - `starsonic-chat servir --teste --escutar 127.0.0.1:<porta> --dados <pasta> [--origem <url>]...`. Cada `--origem` é uma origem do CORS e do WebSocket. Com pelo menos uma, a padrão não entra.
  - Em `windows/ui/tests/chat/servidor.ts`:
    ```ts
    export const CHAT_PORTA = 4180;
    export function baseDoChat(): string;                     // 'http://127.0.0.1:4180'
    export interface Pessoa { id: number; ramal: string; nome: string; saiu: boolean }
    export async function novaEmpresa(nome: string): Promise<{ id: number; codigo: string }>;
    export async function ligarComputador(codigo: string, computador: string): Promise<{ chave: string; empresa: string }>;
    export async function tirarPessoa(empresaId: number, pessoaId: number): Promise<void>;   // pela página de administração
    export class ApiDeTeste {
      constructor(chave: string);
      pedir(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: any }>;
      entrar(ramal: string, nome: string): Promise<Pessoa>;
      criarDupla(com: number): Promise<number>;                 // o id da conversa
      criarGrupo(nome: string, pessoas: number[]): Promise<number>;
      enviarTexto(conversa: number, texto: string, idLocal?: string): Promise<number>;   // o id da mensagem
      enviarArquivo(conversa: number, bytes: Buffer, nome: string, tipo: string): Promise<number>;   // o POST /arquivos e o POST da mensagem
      mensagens(conversa: number): Promise<any[]>;              // todas, em ordem de id
      marcarLida(conversa: number, ate: number): Promise<void>;
      desligar(): Promise<void>;
    }
    export async function empresaComPessoas(nome: string, pessoas: Array<{ ramal: string; nome: string }>):
      Promise<{ empresaId: number; codigo: string; pessoas: Array<{ chave: string; pessoa: Pessoa; api: ApiDeTeste }> }>;
    ```

- [ ] **Step 1: Escreva os testes do `--origem` que falham.**
  - `TestServir_OrigemSoComTeste` (`main_test.go`): `servir --config <arquivo> --origem http://127.0.0.1:4178` sai com o código 2 e escreve `--origem só vale com --teste`.
  - `TestServir_OrigemInvalida`: com `--teste`, cada um destes sai com o código 2 e escreve `--origem inválida`: `127.0.0.1:4178`, `http://127.0.0.1:4178/x`, `ftp://a.b`, `http://`, `http://a.b?x=1`.
  - `TestModoTeste_Origens` (`servidor_test.go`): o `servirTeste` com `Config{Dados, Origens: []string{"http://127.0.0.1:4178"}}`.
    - Um `OPTIONS /api/v1/conversas` com `Origin: http://127.0.0.1:4178` responde 204, com `Access-Control-Allow-Origin: http://127.0.0.1:4178`.
    - Com `Origin: https://app.starsonic.local`, a resposta vem sem `Access-Control-Allow-Origin`.
- [ ] **Step 2: Rode e veja falhar.** Rode `cd chat-servidor && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 go test ./cmd/... ./internal/servidor/...`. O esperado é FAIL, com `flag provided but not defined: -origem`.
- [ ] **Step 3: Implemente o `--origem` no `servir`.**
  - Ele é um `flag.Func` que pode repetir.
  - Cada valor passa pelo `url.Parse`. Ele precisa ter o esquema `http` ou `https` e um host, e não pode ter caminho (só `""` ou `/`), query, fragmento nem usuário. O valor guardado é `esquema://host[:porta]`, sem a barra do fim.
  - Os valores vão para o `servidor.Config.Origens` do `RodarTeste`.
- [ ] **Step 4: Rode e veja passar.** `go test -race ./...`, `go vet ./...` e `gofmt -l .` (vazio).
- [ ] **Step 5: Documente.** Na seção 1 do `docs/chat-protocolo.md`, depois de "No modo de teste: `http://127.0.0.1:<porta>/api/v1`", entra: "As origens do CORS, no modo de teste, são as do `--origem`; sem nenhum, vale a do app."
- [ ] **Step 6: Escreva o teste do servidor de teste que falha.** `tests/chat/servidor.spec.ts`, com o teste `the test chat server links two computers of one company and delivers a message`:
  - o `empresaComPessoas('ACME Comércio Ltda', [{ ramal: '2001', nome: 'Recepção' }, { ramal: '2003', nome: 'Ana Souza' }])`;
  - A cria a dupla com B e manda "Bom dia";
  - `B.api.mensagens(id)` tem uma mensagem com `texto` "Bom dia";
  - uma pessoa de outra empresa recebe 404 no `GET /api/v1/conversas/<id>/mensagens`.
- [ ] **Step 7: Rode e veja falhar.** `npx playwright test tests/chat/servidor.spec.ts`. O esperado é FAIL, porque o módulo `./servidor` não existe.
- [ ] **Step 8: Implemente o servidor de teste.**
  - **O `global-setup.ts`:**
    - Ele acha o programa pelo `STARSONIC_CHAT_BIN`. Sem essa variável, compila com `go build -o test-results/chat/starsonic-chat ./cmd/starsonic-chat`, a partir de `chat-servidor/`.
    - Ele apaga e recria `test-results/chat/dados`.
    - Ele cria o administrador `teste` com `admin-criar teste --dados <pasta>`, com uma senha sorteada de 24 caracteres digitada duas vezes na entrada.
    - Ele sobe o `servir --teste --escutar 127.0.0.1:4180 --dados <pasta> --origem http://127.0.0.1:4178`, espera o `GET /admin/entrar` responder 200 (até 10 s) e devolve a função que para o servidor.
    - A senha vai para o `process.env.CHAT_ADMIN_SENHA`.
  - **O `servidor.ts`:**
    - Ele guarda os cookies da página de administração na memória, uma sessão por processo.
    - O `novaEmpresa` faz este caminho: `GET /admin/entrar`, pega o `csrf` do HTML; `POST /admin/entrar` com `usuario`, `senha` e `csrf`; `GET /admin/empresas/nova`; `POST /admin/empresas` com `nome` e `csrf`; segue o `Location` até `/admin/empresas/<id>` e lê o código com `/STAR-[A-Z0-9]{4}-[A-Z0-9]{4}/`.
    - O `tirarPessoa` faz o `POST /admin/empresas/<id>/pessoas/<pid>/tirar` com o `csrf`.
    - A `ApiDeTeste` segue o protocolo e põe o `Authorization: Bearer`.
  - **O `playwright.config.ts`:** ganha o `globalSetup: './tests/chat/global-setup.ts'`.
  - **Dois cuidados:**
    - só códigos certos passam pelo `POST /api/v1/computadores` do servidor de teste. Os testes de código errado usam o `page.route`, para não gastar os 10 erros por hora do `127.0.0.1`;
    - aqui, o `go build` do `global-setup` roda com o `NO_PROXY` das Global Constraints.
- [ ] **Step 9: Rode e veja passar.** Rode `npx playwright test tests/chat/servidor.spec.ts` e depois a suíte inteira (`npm run typecheck && npm run build && npx playwright test`). Os testes de antes continuam verdes.
- [ ] **Step 10: Ponha o servidor no CI.** No `.github/workflows/build.yml`:
  - sai o `chat-servidor/**` do `paths-ignore`, com o comentário "os testes da interface usam o servidor do chat";
  - no job da interface, antes dos testes, entra o `actions/setup-go@v5`, com `go-version-file: chat-servidor/go.mod` e `cache-dependency-path: chat-servidor/go.sum`;
  - entra o passo "Servidor do chat para os testes": `CGO_ENABLED=0 go build -trimpath -o "$RUNNER_TEMP/starsonic-chat" ./cmd/starsonic-chat`, com `working-directory: chat-servidor`;
  - o passo do Playwright ganha `STARSONIC_CHAT_BIN: ${{ runner.temp }}/starsonic-chat`.
- [ ] **Step 11: Faça o commit e o push.** `git add` dos arquivos acima. A mensagem é `test(chat): o servidor do chat nos testes da interface, com o --origem do modo de teste`. Os workflows `build` e `chat` ficam verdes.

### Task 2: A ponte do chat no núcleo

**Files:**
- Create: `starsonic/desktop/Chat.h`, `starsonic/desktop/Chat.cpp`, `tests/desktop/test_chat.cpp`
- Modify: `starsonic/desktop/Protocol.h`, `starsonic/desktop/Protocol.cpp`, `starsonic/desktop/DesktopApp.h`, `starsonic/desktop/DesktopApp.cpp`
- Modify: `tests/desktop/test_protocol.cpp`, `tests/desktop/test_desktop_app.cpp`, `tests/desktop/test_iphone_mode.cpp`
- Modify: `docs/ponte-windows.md` (a seção nova "O chat (0.2.0)", e o `chatChave`, o `janela` e o `abrir` do chat na lista das mensagens), `windows/ui/src/state.ts`

**Interfaces:**
- Produces:
  ```cpp
  // Chat.h
  struct ChatLink { std::string chave; std::string empresa; };
  bool ValidChatKey(const std::string& chave);          // 43 de [A-Za-z0-9_-]
  bool ValidChatCompany(const std::string& empresa);    // 1 a 80 pontos de código UTF-8 válidos, sem controle
  bool ValidFileId(const std::string& id);              // 32 de [0-9a-f]
  class ChatStore {   // o chat.json, inteiro pelo cifrador (como o admin.json): {"v":1,"chave":"…","empresa":"…","ramais":["servidor|ramal"]}
  public:
      ChatStore(FileSystem& files, SecretCipher& cipher, std::string path);
      bool Load();     // sem arquivo: vazio e true; não decifra, não é JSON ou é de outra versão: vazio e false (o arquivo fica até o próximo Save)
      const std::optional<ChatLink>& Link() const;
      bool HasRamal(const std::string& servidor, const std::string& ramal) const;
      bool SetLink(const ChatLink& link);   // grava
      bool ClearLink();                     // grava sem a chave e a empresa; os ramais ficam
      bool AddRamal(const std::string& servidor, const std::string& ramal);   // grava só quando é novo
  };
  // A chave do par: o servidor sem espaços nas pontas e em minúsculas, "|", e o ramal sem espaços nas pontas.

  // DesktopApp.h
  struct DesktopPaths { ...; std::string chat; };           // chat.json (0.2.0; pelo cifrador)
  struct DesktopConfig { ...; std::string computerName; };  // o nome do computador ("" no iPhone)
  struct DesktopHooks {
      ...
      std::function<void(int64_t conversa, const std::string& titulo, const std::string& texto)> chatNotice;
      std::function<void(int n)> chatBadge;
      std::function<void(const std::string& arquivo, const std::string& nome, const std::string& chave)> chatDownload;
  };
  void DesktopApp::SetWindowInFront(bool inFront);   // só põe na fila; manda o janela quando muda
  void DesktopApp::OpenChat(int64_t conversa);       // só põe na fila; manda o abrir do chat
  enum class CommandKind { ..., ChatKey, ChatLink, ChatUnlink, ChatNotify, ChatBadge, ChatDownload };
  ```
- Produces (`windows/ui/src/state.ts`):
  ```ts
  export interface ChatSummary { ligado: boolean; empresa: string; computador: string; contaConectada: boolean }
  // AppState: chat?: ChatSummary   (só no Windows)
  // IncomingMessage: | { v: number; type: 'chatChave'; chave: string; empresa: string }
  //                  | { v: number; type: 'janela'; frente: boolean }
  //                  | { v: number; type: 'abrir'; tela: 'chat'; conversa: number }   (além do abrir dos recentes)
  // Command: | { cmd: 'chatKey' } | { cmd: 'chatLink'; chave: string; empresa: string } | { cmd: 'chatUnlink' }
  //          | { cmd: 'chatNotify'; conversa: number; titulo: string; texto: string }
  //          | { cmd: 'chatBadge'; n: number } | { cmd: 'chatDownload'; arquivo: string; nome: string }
  ```

- [ ] **Step 1: Escreva os testes da ChatStore que falham.** No `test_chat.cpp`:
  - `the chat store without a file starts empty`: o `Load()` dá `true`, o `Link()` vem vazio e o `HasRamal` dá `false`.
  - `the chat store saves the key through the cipher and reads it back`: o arquivo gravado não contém a chave em claro, e uma ChatStore nova lê a mesma chave e a mesma empresa.
  - `a chat file that does not decrypt loads empty and stays on disk`: o `Load()` dá `false`, e o arquivo continua com os mesmos bytes.
  - `clearing the link keeps the connected ramais`.
  - `a ramal is added once, with the server in any case`: `AddRamal(" PBX.Exemplo.com ", "2001")` e depois `HasRamal("pbx.exemplo.com", "2001")` dão `true`. O segundo `AddRamal` igual não grava de novo, e o `FileSystem` falso conta as gravações.
  - `the key, the company and the file id are checked`:
    - `ValidChatKey` aceita 43 de `[A-Za-z0-9_-]` e recusa 42, 44, um `+`, um `=` e um `/`;
    - `ValidChatCompany` recusa `""`, 81 pontos de código, um `\n` e UTF-8 quebrado, e aceita 80 pontos de código com acentos;
    - `ValidFileId` recusa as maiúsculas, 31 caracteres e um `g`.
- [ ] **Step 2: Escreva os testes da ponte que falham.**
  - No `test_protocol.cpp`:
    - `every chat command parses`: os seis comandos, com os campos certos.
    - `a chat command with a bad field parses into nothing`, um caso para cada regra da tabela "A ponte nova": `chatLink` com uma chave de 42 caracteres ou a empresa vazia; `chatNotify` com `conversa` -1, `titulo` vazio, `titulo` de 201 ou `texto` de 501; `chatBadge` com `n` -1 ou `"3"`; `chatDownload` com o `arquivo` em maiúsculas ou o `nome` vazio.
    - `the state serializes the chat field`, e as mensagens `chatChave`, `janela` e `abrir` do chat, letra por letra como na seção "A ponte nova".
  - No `test_desktop_app.cpp`:
    - `chatLink saves the key and the state says linked with the company, the computer and the connected account`.
    - `chatKey answers the saved key and the state never carries it`: nenhum `state` mandado contém a chave.
    - `chatUnlink clears the link and the state says not linked`.
    - `an account that registers joins the connected ramais`: o `OnRegistration(200, true, id)` da conta em uso deixa o `contaConectada` em `true`. Uma conta da migração que ainda não registrou fica com `false`.
    - `chatNotify goes to the hook, and not with Não perturbe on`.
    - `chatBadge goes to the hook only when the number changes`.
    - `chatDownload goes to the hook with the saved key, and is ignored without one`.
    - `the window in front is sent when it changes and again after each ready`.
    - `OpenChat before the first ready comes after the state in the first ready`.
    - `the diagnostics never carry the key, the title, the text or the file name`: passa todos os comandos do chat, também os recusados, e confere cada linha do `hooks.log`.
  - No `test_iphone_mode.cpp`: `the iPhone state has no chat and the chat commands are refused`.
- [ ] **Step 3: Rode e veja falhar.** `desktop_tests`. O esperado é FAIL, porque o `Chat.h` e os `CommandKind` novos não existem.
- [ ] **Step 4: Implemente.**
  - A `ChatStore` segue o `AdminStore`, com o `FileSystem` e o `SecretCipher`.
  - O `Protocol` ganha os seis `CommandKind`, os campos e os construtores das três mensagens.
  - O `DesktopApp`:
    - abre a `ChatStore` no `Start()`. Um arquivo ilegível deixa uma linha `chat.json ilegivel: o computador fica desligado do chat`;
    - faz o `AddRamal` quando a conta em uso registra (`OnRegistration` ativo, com 200);
    - monta o `chat` do estado, só no Windows;
    - trata os seis comandos como na tabela;
    - ganha o `SetWindowInFront` e o `OpenChat`, que guardam o pedido feito antes do `ready`, como o `OpenRecents` do iPhone;
    - escreve no diagnóstico só `chat: <comando>`, mais o `n` no `chatBadge`. Um comando recusado vira `comando ignorado: <comando>`, sem os campos.
  - No `docs/ponte-windows.md`, entra a seção "O chat (0.2.0)", com a tabela dos comandos, as três mensagens, o campo do estado, os toasts e a regra "a chave nunca vai no estado nem no diagnóstico". A seção "Para o executável" ganha os três ganchos, o `SetWindowInFront` e o `OpenChat`, e a do modo iPhone diz que os comandos do chat são recusados. O cabeçalho do `Protocol.h` ganha `"chatChave"` e `"janela"` na lista dos tipos.
  - O `state.ts` ganha os tipos.
- [ ] **Step 5: Rode e veja passar.** `desktop_tests` inteiro e `cd windows/ui && npm run typecheck`.
- [ ] **Step 6: Faça o commit e o push.** A mensagem é `feat(chat): a ponte do chat no núcleo (a chave, os ramais conectados, o aviso, o número e o download)`. O CI fica verde.

### Task 3: O executável: o aviso, o número no ícone, baixar e a janela na frente

**Files:**
- Create: `windows/app/src/ChatFiles.h`, `windows/app/src/ChatFiles.cpp` (portátil), `tests/desktop/test_chat_files.cpp`
- Create: `windows/app/src/ChatSave.h`, `ChatSave.cpp` (só Windows: gravar o arquivo baixado), `tests/desktop/test_chat_windows.cpp` (só Windows, inteiro dentro de `#ifdef _WIN32`)
- Create: `windows/app/src/TaskbarBadge.h`, `TaskbarBadge.cpp`, `ChatDownloader.h`, `ChatDownloader.cpp`
- Modify: `starsonic/win/Http.h`, `starsonic/win/Http.cpp`, `windows/app/src/Tray.h`, `Tray.cpp`, `MainWindow.h`, `MainWindow.cpp`, `main.cpp`, `windows/app/CMakeLists.txt`
- Modify: `tests/desktop/CMakeLists.txt`. O `ChatFiles.cpp` entra no `target_sources`, como o `WindowFit.cpp`. Com `if(WIN32)`, também entram o `ChatSave.cpp` e o `DpapiCipher.cpp`, com o `crypt32`.

**Interfaces:**
- Consumes (Task 2): `DesktopHooks::chatNotice`, `chatBadge` e `chatDownload`; `DesktopConfig::computerName`; `DesktopPaths::chat`; `DesktopApp::SetWindowInFront`, `OpenChat` e `Notify`.
- Produces:
  ```cpp
  // ChatFiles.h (portátil, UTF-8)
  constexpr char kChatOrigin[] = "https://chat.starcloud-starsonic.com.br:8443";
  constexpr size_t kChatMaxFileBytes = 26214400;
  std::string BadgeText(int n);          // n <= 0: ""; 1 a 9: "1".."9"; 10 ou mais: "9+"
  std::string BadgeDescription(int n);   // "1 mensagem não lida", "<n> mensagens não lidas"
  std::string SafeDownloadName(const std::string& nome);
  std::string FreeName(const std::string& nome, const std::function<bool(const std::string&)>& exists);
  std::string ZoneIdentifier();          // "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://chat.starcloud-starsonic.com.br:8443/\r\n"
  std::string FitNoticeText(const std::string& utf8, size_t maxUtf16Units);
  // ChatSave.h (só Windows)
  // Grava os bytes na pasta, com o FreeName(SafeDownloadName(nome)) e o CREATE_NEW (se outro arquivo chegou antes com o
  // mesmo nome, tenta o próximo), e o <caminho>:Zone.Identifier com o ZoneIdentifier(). Devolve o caminho, ou "" se falhou.
  std::wstring SaveChatFile(const std::wstring& pasta, const std::string& nome, const std::string& bytes);
  // Http.h
  HttpResponse HttpsGetBearer(const std::wstring& url, size_t maxBytes, const std::wstring& userAgent, const std::string& bearer);
  // Tray.h: void ShowChatNotice(const std::wstring& titulo, const std::wstring& texto, int64_t conversa);
  //         enum class Choice { None, Open, ToggleDoNotDisturb, Quit, OpenChat };  int64_t NoticeConversation() const;
  // TaskbarBadge.h: void Attach(HWND window); void OnButtonCreated(); void Set(int n);
  // ChatDownloader.h: void Download(std::string arquivo, std::string nome, std::string chave,
  //                                 std::function<void(const std::string& toast)> done);   // toast "" quando deu certo
  //                   void Stop();
  // MainWindow::Callbacks ganha: std::function<void(bool inFront)> inFront; std::function<void(int64_t conversa)> openChat;
  ```

- [ ] **Step 1: Escreva os testes das regras portáteis que falham.** No `test_chat_files.cpp`:
  - `the badge text`: os números 0, -1, 1, 9, 10 e 250 dão `""`, `""`, `"1"`, `"9"`, `"9+"` e `"9+"`. A descrição do 1 é "1 mensagem não lida", e a do 12 é "12 mensagens não lidas".
  - `the name to save`:
    - `Proposta ACME.pdf` não muda;
    - `../a.pdf` vira `a.pdf`;
    - `Proposta‮fdp.exe` vira `Propostafdp.exe`, e também saem o U+200E, o U+200F, o U+202A a U+202E e o U+2066 a U+2069;
    - `a:b*c?.txt` vira `abc.txt`;
    - `CON.txt` vira `_CON.txt`, e `nul` vira `_nul`;
    - `a.pdf. ` vira `a.pdf`;
    - um nome vazio ou só de espaços vira `arquivo`;
    - 300 caracteres terminando em `.xlsx` viram 120 pontos de código terminando em `.xlsx`;
    - `Relatório de produção.pdf` não muda.
  - `a free name gets (2), (3) and keeps the extension`: com `a.pdf` ocupado, o nome livre é `a (2).pdf`; com `a.pdf` e `a (2).pdf` ocupados, é `a (3).pdf`; `LEIAME` vira `LEIAME (2)`.
  - `the zone identifier`: o texto exato do `ZoneIdentifier()`.
  - `the notice text is cut in UTF-16 without splitting a pair`:
    - um texto curto não muda;
    - um texto comprido termina em `…` (U+2026), com no máximo o limite;
    - um emoji na fronteira sai inteiro, nunca pela metade.
- [ ] **Step 2: Escreva os testes do Windows.** No `test_chat_windows.cpp`, que roda só no job do Windows do CI:
  - `the chat store keeps the key with the real DPAPI`: a `ChatStore` com o `DpapiCipher` grava e lê a chave, e o arquivo gravado não tem a chave em claro.
  - `a saved download gets (2) the second time and the Zone.Identifier stream`: numa pasta nova dentro do `%TEMP%`, o `SaveChatFile` com `a.pdf` duas vezes dá `a.pdf` e `a (2).pdf`. O `a.pdf:Zone.Identifier` lido de volta é o `ZoneIdentifier()`.
- [ ] **Step 3: Rode e veja falhar.** `desktop_tests`. O esperado é FAIL, porque o `ChatFiles.h` não existe. Os testes do Windows falham só no CI.
- [ ] **Step 4: Implemente o `ChatFiles.cpp`,** sem cabeçalho do Windows, **e o `ChatSave.cpp`.**
- [ ] **Step 5: Rode e veja passar.** `desktop_tests` inteiro, aqui no Linux. Os testes do Windows passam no push (Step 8).
- [ ] **Step 6: Implemente o resto do que é do Windows.**
  - **`HttpsGetBearer`:**
    - manda o `Authorization: Bearer <chave>` e o user agent de sempre;
    - não segue redirecionamento (`WINHTTP_OPTION_REDIRECT_POLICY` em `WINHTTP_OPTION_REDIRECT_POLICY_NEVER`);
    - aceita até `maxBytes`, que é `kChatMaxFileBytes`.
  - **`Tray::ShowChatNotice`:**
    - faz um `NIM_MODIFY` com `NIF_INFO`, o título no `FitNoticeText(titulo, 63)` e o texto no `FitNoticeText(texto, 255)`;
    - usa o `NIIF_USER | NIIF_LARGE_ICON` com o ícone do app e o som padrão (sem `NIIF_NOSOUND`);
    - guarda a `conversa`. O `NIN_BALLOONUSERCLICK` vira o `Choice::OpenChat`.
  - **`MainWindow`:**
    - no `Choice::OpenChat`, faz o `BringToFront()` e chama o `callbacks_.openChat(tray_.NoticeConversation())`;
    - o `RefreshNotice` já calcula o `inFront`. Quando ele muda, chama o `callbacks_.inFront(inFront)`;
    - a mensagem registrada `TaskbarButtonCreated` chama o `badge_.OnButtonCreated()`.
  - **`TaskbarBadge`:**
    - usa o `ITaskbarList3`, com o `CLSID_TaskbarList` e o `HrInit`;
    - o `Set(n)` desenha, com GDI, um círculo `#00C2CB` com o `BadgeText(n)` em `#03222A` e negrito, no tamanho `SM_CXSMICON` do DPI da janela;
    - chama o `SetOverlayIcon` com o `BadgeDescription(n)`. Com 0, o ícone sai (`SetOverlayIcon(window, nullptr, nullptr)`);
    - o `OnButtonCreated` põe de novo o número de agora.
  - **`ChatDownloader`:** uma thread com fila, como o `CompanyFetcher`, e com o `CoInitializeEx`.
    - Ele chama o `HttpsGetBearer(kChatOrigin + "/api/v1/arquivos/" + arquivo)`.
    - Com 200, grava com o `SaveChatFile` na pasta do `SHGetKnownFolderPath(FOLDERID_Downloads)`, abre com o `ShellExecuteW(nullptr, L"open", …)` e chama o `done("")`.
    - Com 410, chama o `done("Arquivo expirado")`. Com qualquer outra coisa, `done("Não foi possível baixar o arquivo.")`.
    - O diagnóstico leva só `chat: download <status> <bytes>`.
  - **`main.cpp`:**
    - o `computerName` vem do `GetComputerNameW`, e o `paths.chat` é o `chat.json`, na pasta do `admin.json`;
    - o `chatNotice` e o `chatBadge` vão pelo `RunOnWindow` ao `Tray` e ao `TaskbarBadge`;
    - o `chatDownload` vai ao `ChatDownloader`, com o `done` chamando o `app.Notify(toast)` quando o toast não é vazio;
    - o `inFront` vai ao `app.SetWindowInFront`, e o `openChat` ao `app.OpenChat`;
    - no fechamento, o `ChatDownloader::Stop()` roda junto com o `CompanyFetcher`.
- [ ] **Step 7: Confira os textos.** Rode `python3 build/check_source_text.py`.
- [ ] **Step 8: Faça o commit e o push.** A mensagem é `feat(chat): o aviso, o número no ícone, baixar e a janela na frente no executável`. O CI fica verde, com o Windows compilando e os `desktop_tests` no Linux e no Windows, também os do `test_chat_windows.cpp`. O que só se vê no Windows de verdade fica no roteiro (Task 8).

### Task 4: O cliente do chat, a aba Chat e o cartão do administrador

**Files:**
- Create: `windows/ui/src/chat/tipos.ts`, `endereco.ts`, `api.ts`, `eventos.ts`, `cliente.ts`, `usarChat.ts`, `textos.ts`, `formato.ts`, `CartaoChat.tsx`, `telas/Lista.tsx`, `componentes/Avatar.tsx`, `componentes/Faixa.tsx`
- Modify: `windows/ui/src/types.ts`, `components/Nav.tsx`, `main.tsx`, `screens/Admin.tsx`, `icons.tsx`, `app.css`, `index.html`, `fake.ts`, `fake-scenarios.ts`
- Create: `windows/ui/tests/chat/abrir.ts`, `windows/ui/tests/chat/lista.spec.ts`, `windows/ui/tests/chat/admin.spec.ts`

**Interfaces:**
- Consumes: o servidor de teste (Task 1); os tipos da ponte (Task 2).
- Produces:
  ```ts
  // tipos.ts: os objetos da seção 4 do protocolo
  export interface Pessoa { id: number; ramal: string; nome: string; saiu: boolean }
  export interface Arquivo { id: string; nome: string; tipo: string; tamanho: number; foto: boolean; miniatura: boolean; expirado: boolean }
  export interface AvisoDeGrupo { acao: 'criou' | 'pos' | 'tirou' | 'saiu'; quem: Pessoa; alvo: Pessoa | null }
  export interface Mensagem { id: number; conversa: number; autor: Pessoa | null; tipo: 'texto' | 'arquivo' | 'aviso';
    texto?: string; arquivo?: Arquivo; aviso?: AvisoDeGrupo; idLocal: string | null; criadaEm: number }
  export type Conversa =
    | { id: number; tipo: 'dupla'; com: Pessoa; ultima: Mensagem | null; naoLidas: number; atualizadaEm: number }
    | { id: number; tipo: 'grupo'; nome: string; pessoas: number; cuida: boolean; ultima: Mensagem | null; naoLidas: number; atualizadaEm: number };
  export interface Membro { pessoa: Pessoa; cuida: boolean; criou: boolean }
  export type Evento =
    | { tipo: 'mensagem'; mensagem: Mensagem } | { tipo: 'lida'; conversa: number; ate: number }
    | { tipo: 'conversa'; conversa: Conversa } | { tipo: 'conversaSaiu'; conversa: number }
    | { tipo: 'computadorNovo'; computador: string } | { tipo: 'fora' };

  // endereco.ts
  export const ENDERECO_DO_CHAT = 'https://chat.starcloud-starsonic.com.br:8443';
  export function enderecoDoChat(): string;   // o chat= da URL só com a ponte falsa; senão, o ENDERECO_DO_CHAT

  // api.ts: um método para cada operação das seções 5 e 6 do protocolo
  export class ErroChat extends Error { status: number; erro: string; campo?: string; esperarSegundos?: number }
  // status 0 com erro 'rede': o pedido não teve resposta
  export async function ligarComputador(base: string, codigo: string, computador: string): Promise<{ chave: string; empresa: string }>;
  export function criarApi(base: string, chave: string): ApiChat;
  export interface ApiChat {
    desligar(): Promise<void>; entrar(ramal: string, nome: string): Promise<Pessoa>; colegas(): Promise<Pessoa[]>;
    conversas(): Promise<Conversa[]>; criarDupla(com: number): Promise<Conversa>; criarGrupo(nome: string, pessoas: number[]): Promise<Conversa>;
    membros(conversa: number): Promise<Membro[]>; porMembros(conversa: number, pessoas: number[]): Promise<void>;
    tirarMembro(conversa: number, pessoa: number): Promise<void>;
    mensagens(conversa: number, q: { antes?: number; depois?: number }): Promise<{ mensagens: Mensagem[]; temMais: boolean }>;
    enviar(conversa: number, corpo: { idLocal: string; texto: string } | { idLocal: string; arquivo: string }): Promise<Mensagem>;
    marcarLida(conversa: number, ate: number): Promise<void>;
    enviarArquivo(dados: Blob, nome: string, tipo: string, progresso?: (fracao: number) => void): Promise<Arquivo>;   // Task 7
    enviarMiniatura(id: string, jpeg: Blob): Promise<void>;                                                            // Task 7
    baixarMiniatura(id: string): Promise<Blob>; baixarArquivo(id: string): Promise<Blob>;                              // Task 7
    bilhete(): Promise<string>;
  }

  // eventos.ts
  export const ESPERAS_MS = [1000, 2000, 5000, 10000, 30000];
  export function esperaDaVez(tentativa: number, aleatorio: number): number;   // ESPERAS_MS[min(tentativa, 4)] * (0.5 + aleatorio)
  export function conectarEventos(base: string, api: Pick<ApiChat, 'bilhete'>,
    ao: { evento(e: Evento): void; conectou(): void; caiu(): void; fora(): void }): { parar(): void };

  // cliente.ts
  export type SituacaoChat = 'desligado' | 'precisaConta' | 'entrando' | 'pronto' | 'fora';
  export interface Pendente { idLocal: string; conversa: number; tipo: 'texto' | 'arquivo'; texto?: string;
    arquivo?: { nome: string; tamanho: number; tipo: string; foto: boolean }; estado: 'enviando' | 'naoEnviada'; progresso?: number }
  export interface ConversaAberta { id: number; mensagens: Mensagem[]; temMaisAntigas: boolean; pendentes: Pendente[] }
  export interface VistaChat { situacao: SituacaoChat; conectado: boolean; eu: Pessoa | null; conversas: Conversa[];
    naoLidas: number; aberta: ConversaAberta | null; computadorNovo: string | null }
  export class ChatCliente {
    constructor(o: { bridge: Bridge; base: string });
    vista(): VistaChat; assinar(f: () => void): () => void;
    atualizar(p: { chat: ChatSummary | undefined; conta: { ramal: string; nome: string } | null }): void;
    ligarComputador(codigo: string): Promise<{ empresa: string }>;   // o POST /computadores e o chatLink
    desligarComputador(): Promise<void>;                             // o DELETE /computadores/eu (mesmo sem resposta) e o chatUnlink
    dispensarComputadorNovo(): void;
    // As Tasks 5 a 7 acrescentam: colegas, criarDupla, criarGrupo, membros, por, tirar, sair, abrir, fechar, anteriores,
    // enviarTexto, tentarDeNovo e enviarArquivos.
  }
  // usarChat.ts
  export function useVistaChat(c: ChatCliente): VistaChat;
  // types.ts: Tab ganha 'chat'. View ganha:
  //   { kind: 'chatConversa'; conversa: number; back: View } | { kind: 'chatNova'; back: View } | { kind: 'chatNovoGrupo'; back: View }
  //   | { kind: 'chatMembros'; conversa: number; back: View } | { kind: 'chatPor'; conversa: number; back: View }
  // tests/chat/abrir.ts
  export async function abrirNoChat(page: Page, o: { chave: string; ramal: string; nome: string; empresa?: string;
    cenario?: 'chat' | 'chat-desligado' | 'chat-sem-conta' | 'chat-duas-contas'; extra?: Record<string, string> }): Promise<void>;
  ```

- [ ] **Step 1: Escreva os testes da lista que falham.** No `tests/chat/lista.spec.ts`, com o `bypassCSP`. Cada teste cria a própria empresa.
  - `the Chat tab appears only with the computer linked, with the unread count`:
    - no `chat-desligado`, não há aba "Chat";
    - no `chat`, B manda 2 mensagens pela API, e a aba fica com o rótulo "Chat, 2 mensagens não lidas" e o número "2";
    - o comando `chatBadge` sai com `n` 2.
  - `the list shows initials or the group icon, the start of the last message, the time and the unread, newest first`:
    - a dupla com Ana, em que Ana manda "Pode me mandar a proposta da ACME?";
    - o grupo "Comercial", em que João manda "Fechamos o pedido de hoje.";
    - a dupla com João Pereira, em que A manda "Combinado, te ligo depois.";
    - as linhas vêm na ordem do `atualizadaEm`, com "João: Fechamos o pedido de hoje." e "Você: Combinado, te ligo depois.".
  - `a new message arrives live and moves its conversation to the top`, sem recarregar a página.
  - `Procurar conversa finds by the name without accent or case`: "joao" acha só a dupla com João Pereira, e "xyz" mostra "Nenhuma conversa encontrada.".
  - `the first time shows Nenhuma conversa ainda and the + menu`: os textos do quadro `Vazio`. O "+" abre o menu com "Nova conversa" e "Novo grupo", e o Esc fecha.
  - `an account never connected here shows Conecte a sua conta para usar o chat.`, no cenário `chat-sem-conta`.
  - `a computer taken out shows the message and stops trying`:
    - o teste faz o `DELETE /api/v1/computadores/eu` com a chave de A;
    - a aba mostra "Este computador saiu do chat. Fale com o suporte da Starsonic.";
    - com o `page.clock.runFor(120_000)`, nenhum `POST /api/v1/eventos/bilhete` sai.
  - `a new computer of the same person shows the notice`:
    - liga um segundo computador `RECEPCAO-02` e entra nele com o mesmo ramal;
    - a lista mostra "Seu chat entrou em outro computador: RECEPCAO-02", e sai o `chatNotify` com `{conversa: 0, titulo: 'Chat', texto: 'Seu chat entrou em outro computador: RECEPCAO-02'}`;
    - o "×" ("Fechar o aviso") tira a faixa.
  - `switching the account clears the first person's chat before the second one's arrives` (Review Focus 1):
    - no `chat-duas-contas`, as duas contas são da mesma empresa;
    - depois do `selectAccount`, nenhuma conversa da primeira pessoa aparece, nem por um instante. O teste confere a lista a cada mutação, com um `MutationObserver`;
    - o número da aba passa a ser o da segunda pessoa.
  - `Ctrl+5 opens the Chat tab only with the computer linked`.
  - `in iPhone mode there is no Chat tab` (`plataforma=ios`).
  - `the page CSP lets the app reach only the chat server`: o `content` do CSP da `dist/index.html` é o texto exato das Global Constraints.
  - `the list has no serious accessibility violations`, nos dois temas.
- [ ] **Step 2: Escreva os testes do cartão que falham.** No `tests/chat/admin.spec.ts`:
  - `Ligar ao chat links this computer with the company code and shows the company`:
    - no `chat-desligado`, depois do `entrarNaAdmin`, o cartão "Chat" vem primeiro e tem os textos da seção 10;
    - o código é digitado em minúsculas e com espaços;
    - sai o `chatLink`, com uma `chave` de 43 caracteres e a `empresa` 'ACME Comércio Ltda';
    - o cartão mostra "Ligado ao chat da ACME Comércio Ltda. A aba Chat já aparece no app.";
    - fora da área do administrador, a aba Chat aparece.
  - `a wrong code shows Código não encontrado`: com o `page.route` do `POST /api/v1/computadores` respondendo 404 `{"erro":"codigo"}`, aparece "Código não encontrado. Confira o código na página de administração.".
  - `too many tries shows the wait in minutes`: com o 429 `{"erro":"tentativas","esperarSegundos":3540}`, aparece "Muitas tentativas. Tente de novo daqui a 59 minutos.".
  - `no connection shows Sem conexão com o chat. Tente de novo.`, com o `route.abort()`.
  - `Desligar do chat unlinks here and on the server`: sai o `chatUnlink`, e a `ApiDeTeste` com a chave antiga recebe 401. O cartão volta a mostrar o campo do código.
- [ ] **Step 3: Rode e veja falhar.** `npm run build && npx playwright test tests/chat/lista.spec.ts tests/chat/admin.spec.ts`. O esperado é FAIL: não há aba Chat nem cartão.
- [ ] **Step 4: Implemente o cliente.**
  - **A partida, no `atualizar`:**
    - com `chat.ligado`, `contaConectada` e uma conta, manda o `chatKey` e espera o `chatChave`;
    - depois faz o `entrar(conta.ramal, conta.nome || conta.ramal)` e o `conversas()`, e liga os eventos;
    - sem `ligado`, a situação é `desligado`; sem `contaConectada`, é `precisaConta`.
  - **A troca de pessoa:** a conta mudou de ramal, ou o chat foi desligado. O cliente para os eventos e esvazia a vista (as conversas, a aberta, o número e a faixa) antes de entrar de novo. O `chatBadge` vai com 0 nessa hora.
  - **Os erros:**
    - um erro `rede` ou 500 deixa o `conectado` em `false` e tenta de novo com as `ESPERAS_MS`;
    - um `401 chave`, em qualquer pedido ou no bilhete, deixa a situação em `fora` e para tudo;
    - um `429 limite` espera o `esperarSegundos` (no máximo 60 s) e tenta de novo uma vez.
  - **Os eventos:**
    - o `fora` e o fechamento com o código 4001 viram a situação `fora`;
    - os códigos 4000, 4002 e 1001, e a queda sem código, reconectam com o `esperaDaVez`;
    - ao reconectar, o cliente relê as conversas (e, na Task 6, a conversa aberta).
  - **As mensagens da lista:**
    - a `mensagem` atualiza a `ultima` e o `atualizadaEm`, reordena e soma 1 no `naoLidas`. Não soma para as suas mensagens, para os avisos de grupo e para a conversa lida na hora (Task 6);
    - a `lida` zera o `naoLidas` quando o `ate` é pelo menos o id da `ultima`. Se não for, relê as conversas;
    - o `computadorNovo` mostra a faixa e manda o `chatNotify` de conversa 0.
  - **O número:** é a soma dos `naoLidas`. O `chatBadge` sai a cada mudança.
  - **O `main.tsx`:**
    - o `ChatCliente` é criado uma vez, junto com a `bridge`;
    - um efeito chama o `atualizar` quando o `state.chat` ou a conta mudam;
    - a aba `chat` entra nas abas do Windows só com o `state.chat?.ligado`, e o Ctrl+5 a abre só nesse caso;
    - o `abrir` com `tela: 'chat'` leva à aba (a conversa vem na Task 6).
  - **O `Nav`** ganha a aba Chat (o `IconMessage`, a tecla `Control+5`) e o número dela, com o rótulo de leitor de tela.
  - **A `Lista`** segue os quadros `Main` e `Vazio`: o cabeçalho de sempre, "Chat", o "+" com o menu, "Procurar conversa", as linhas e a `Faixa` (o `role="status"`) quando o `conectado` é `false`. As situações `precisaConta` e `fora` mostram o texto delas no lugar da lista.
  - **O `CartaoChat`** segue o quadro `AdmChat`.
    - Ele vem antes de "Botões da tela principal".
    - Desligado, mostra o texto, o "Código da empresa" e "Ligar ao chat". O botão fica desligado enquanto espera a resposta.
    - Ligado, mostra "Ligado ao chat da <empresa>. A aba Chat já aparece no app." e "Desligar do chat".
    - Na situação `fora`, mostra o campo do código de novo, junto com o "Desligar do chat".
  - **A ponte falsa:**
    - os parâmetros `chat`, `chave`, `empresa` (o padrão é 'ACME Comércio Ltda'), `computador` (o padrão é 'RECEPCAO-01'), `ramal` e `nome` (a conta em uso);
    - o `chatKey` responde o `chatChave`, o `chatLink` liga e guarda a chave, e o `chatUnlink` desliga;
    - depois do `ready`, vem o `janela` com `frente: true`;
    - os cenários `chat`, `chat-desligado`, `chat-sem-conta` e `chat-duas-contas`, e o `FakeView` `chat`.
  - **O `index.html`** ganha o CSP das Global Constraints.
- [ ] **Step 5: Rode e veja passar.** Os dois arquivos, e depois a suíte inteira (`npm run typecheck && npm run build && npx playwright test`).
- [ ] **Step 6: Faça o commit e o push.** A mensagem é `feat(chat): o cliente do chat, a aba Chat com a lista e o cartão Chat do administrador`. O CI fica verde.

### Task 5: Nova conversa, novo grupo e os membros

**Files:**
- Create: `windows/ui/src/chat/telas/NovaConversa.tsx`, `telas/Escolher.tsx` (a escolha de pessoas, com a busca, usada pelas duas telas abaixo), `telas/NovoGrupo.tsx`, `telas/PorPessoas.tsx`, `telas/Membros.tsx`
- Modify: `windows/ui/src/chat/cliente.ts`, `main.tsx` (as vistas `chatNova`, `chatNovoGrupo`, `chatMembros` e `chatPor`), `app.css`
- Create: `windows/ui/tests/chat/nova-conversa.spec.ts`, `windows/ui/tests/chat/grupo.spec.ts`

**Interfaces:**
- Consumes (Task 4): `ChatCliente`, `ApiChat`, `useVistaChat`, as `View` do chat.
- Produces (`ChatCliente`):
  ```ts
  colegas(): Promise<Pessoa[]>;
  criarDupla(com: number): Promise<number>;                       // o id da conversa (a que já existe ou a nova)
  criarGrupo(nome: string, pessoas: number[]): Promise<number>;
  membros(conversa: number): Promise<Membro[]>;
  por(conversa: number, pessoas: number[]): Promise<void>;
  tirar(conversa: number, pessoa: number): Promise<void>;
  sair(conversa: number): Promise<void>;
  ```
  Os eventos `conversa` e `conversaSaiu` atualizam a lista: a conversa entra, troca ou sai. Se a que saiu está aberta, a tela volta para a lista.

- [ ] **Step 1: Escreva os testes que falham.**
  - No `nova-conversa.spec.ts`:
    - `Nova conversa lists the colleagues already in the chat with the name and the ramal`. A lista tem Ana Souza (Ramal 2003) e João Pereira (Ramal 3002), mas não a própria pessoa, e vem com a nota "Aparecem só os colegas da sua empresa que já usam o chat.".
    - `it finds by the name without accent or case, or by the ramal`: "joao" acha João Pereira, "300" também, e "xyz" mostra "Ninguém encontrado.".
    - `a company with nobody else shows Nenhum colega no chat ainda.`.
    - `a colleague opens the one conversation of the pair`. A conversa abre com "Ana Souza" e "Ramal 2003". Voltar e escolher Ana de novo dá o mesmo id, e o servidor tem uma dupla só.
  - No `grupo.spec.ts`:
    - `Novo grupo creates the group with the name and the chosen people`:
      - o nome é "Financeiro", e as escolhidas são Ana e João;
      - aparecem "Pessoas · 2 escolhidas" e "Criar grupo com 3 pessoas";
      - a conversa abre com "Financeiro" e "3 pessoas · ver os membros", e mostra "Você criou o grupo", "Você pôs Ana Souza no grupo" e "Você pôs João Pereira no grupo".
    - `the create button waits for a name and one person`: o botão fica desligado sem nome e sem pessoa, e diz "Criar grupo" sem ninguém.
    - `the group name stops at 60 characters`: depois de digitar 70, ficam 60.
    - `the choice stops at 199 people and says the group is full`. Com o `page.route` do `GET /api/v1/pessoas` respondendo 250 pessoas inventadas, depois de 199 escolhidas as outras ficam desligadas e aparece "O grupo já tem 200 pessoas.". Um `409 grupoCheio`, pelo `page.route`, mostra o mesmo texto.
    - `Membros shows who takes care, with Tirar and Pôr pessoas only for the caretaker and Sair for all`:
      - quem cuida vê "Você cuida deste grupo: só você põe e tira pessoas. Quem está no grupo pode sair quando quiser.", "Recepção (você)", "Ramal 2001 · criou o grupo", um "Tirar" ao lado de cada outra pessoa e "Pôr pessoas no grupo";
      - quem não cuida (Ana, numa segunda página) vê só "Sair do grupo".
    - `Tirar asks first and takes the person out, with the notice in the conversation`: a confirmação tem os textos da lista, e a conversa mostra "Você tirou Ana Souza do grupo".
    - `Sair do grupo asks first and leaves, back to the list without the group`.
    - `Pôr pessoas no grupo lists only who is out of the group and puts the chosen ones`: aparece "Pôr 1 pessoa no grupo", e depois "Você pôs Carlos Lima no grupo".
    - `the conversa and conversaSaiu events change the list live`: Ana cria um grupo com A pela API, e ele aparece na lista de A. Ana tira A, e o grupo sai. Se o grupo estava aberto, a tela volta para a lista.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/chat/nova-conversa.spec.ts tests/chat/grupo.spec.ts`.
- [ ] **Step 3: Implemente.**
  - As telas seguem os quadros `NovaConversa`, `NovoGrupo` e `Membros`.
  - A busca usa o `fold` do `format.ts` no nome, e o ramal pelo `includes`.
  - O nome do grupo passa pelo `limitCharacters(texto, 60)`.
  - O "Tirar" e o "Sair do grupo" usam o `Confirm`.
  - O "Tirar" nunca aparece na própria pessoa.
  - O `PorPessoas` mostra os colegas que não estão no grupo, com o `Escolher`.
- [ ] **Step 4: Rode e veja passar.** Os dois arquivos, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(chat): nova conversa, novo grupo e os membros`. O CI fica verde.

### Task 6: A conversa: as mensagens, o envio, a leitura e o aviso

**Files:**
- Create: `windows/ui/src/chat/telas/Conversa.tsx`, `componentes/Balao.tsx`, `componentes/Escrever.tsx`
- Modify: `windows/ui/src/chat/cliente.ts`, `chat/formato.ts`, `main.tsx` (a vista `chatConversa`, o `abrir` com a conversa e o Esc), `app.css`
- Create: `windows/ui/tests/chat/conversa.spec.ts`, `windows/ui/tests/chat/sem-conexao.spec.ts`, `windows/ui/tests/chat/aviso.spec.ts`

**Interfaces:**
- Consumes (Tasks 4 e 5): `ChatCliente`, `VistaChat.aberta`, `Pendente`, `esperaDaVez`, as `View` do chat.
- Produces (`ChatCliente`):
  ```ts
  abrir(conversa: number): Promise<void>;   // as 50 mais novas; marca como lida se a janela está na frente
  fechar(): void;
  anteriores(): Promise<void>;              // mais 50, com antes = o menor id que está na tela
  enviarTexto(texto: string): void;         // um Pendente 'enviando', com idLocal = crypto.randomUUID()
  tentarDeNovo(idLocal: string): void;      // o mesmo idLocal
  ```
  E em `formato.ts`:
  ```ts
  tituloDoAviso(c: Conversa, m: Mensagem): string;   // dupla: o nome do autor; grupo: '<nome do autor> no <nome do grupo>'
  textoDoAviso(m: Mensagem): string;                 // texto: os 120 primeiros pontos de código, com '…' quando corta;
                                                     // foto: 'Foto'; arquivo: 'Arquivo: <nome>'
  ```

- [ ] **Step 1: Escreva os testes da conversa que falham.** No `conversa.spec.ts`:
  - `the conversation shows the bubbles with the time and the day, mine on the right`:
    - o `page.clock.install({ time: <amanhã> })` faz as mensagens do servidor aparecerem com o separador "Ontem";
    - as suas mensagens ficam à direita, com a cor `blue`;
    - a lista tem o `role="log"` com o nome "Mensagens com Ana Souza".
  - `Enter sends and Shift+Enter breaks the line`: o servidor recebe um texto só, com o `\n`, e o balão mostra as duas linhas.
  - `near the limit it shows how many are left and stops at 4,000`: com 3.850 caracteres, aparece "Faltam 150". Depois de digitar mais, o campo fica com 4.000 pontos de código, e um emoji conta como 1.
  - `a sent message shows Enviando… and then the time`: o `page.route` segura o `POST` da mensagem.
  - `no answer in 15 seconds is Não enviada, and Tentar de novo sends it with the same idLocal`:
    - o primeiro `POST` fica sem resposta, e o `page.clock.runFor(15_000)` mostra "Não enviada" e "Tentar de novo";
    - o "Tentar de novo" manda o mesmo `idLocal`, e o servidor tem uma mensagem só com ele.
  - `my message that also comes by the WebSocket shows once` (Review Focus 2).
  - `scrolling up brings 50 older at a time and keeps the place`: com 120 mensagens pela API, a conversa abre com 50. Ao rolar até em cima, ficam 100 e depois 120. A mensagem que estava no alto continua à vista.
  - `a new message does not pull the screen down while reading older ones, and follows at the bottom` (Review Focus 3): o `scrollTop` não muda lá em cima; lá embaixo, a mensagem nova fica à vista.
  - `the open conversation marks as read only with the window in front`:
    - com `janela` `frente: false`, uma mensagem de Ana não sai como lida, e sai o `chatNotify`;
    - com `frente: true`, sai o `POST .../lida` com o id dela, e o `chatBadge` vai a 0.
  - `reading on another computer of mine clears the count here`: o evento `lida`.
  - `Ligar calls the ramal like a contact`: sai o `dial` com `{numero: '2003', contato: true}`.
  - `a conversation with someone who left shows (saiu) and no field`: depois do `tirarPessoa`, aparecem "Ana Souza (saiu)" e "Ana Souza saiu do chat.", sem o campo de escrever e sem o Ligar.
  - `group bubbles show the author's name and the notices in the middle`, como no quadro `Grupo`.
  - `a 4,000-character word and a 60-character group name never scroll the window sideways` (Review Focus 4): com 400 e com 300 de largura, o `document.documentElement.scrollWidth` fica menor ou igual ao `innerWidth`.
  - `Esc goes back to the list`.
  - `the conversation has no serious accessibility violations`, nos dois temas.
- [ ] **Step 2: Escreva os testes sem conexão que falham.** No `sem-conexao.spec.ts`, com o `page.routeWebSocket` passando para o servidor de verdade e o `Math.random` fixo em 0,5 (pelo `addInitScript`):
  - `the WebSocket falls: the banner shows and it tries again at 1, 2, 5, 10 and 30 seconds`: a faixa diz "Sem conexão com o chat. Tentando de novo…". Os bilhetes saem em 1, 3, 8, 18 e 48 s, contados pelo `page.clock`, e depois a cada 30 s.
  - `when it comes back the banner leaves and the messages from meanwhile arrive once, in order` (Review Focus 2): Ana manda 3 mensagens com o WebSocket caído. Quando ele volta, aparecem as 3, em ordem de id, sem repetir. A volta lê com o `depois` até o `temMais` dar `false`.
  - `a message written without connection is Não enviada right away`: o `route.abort()` no `POST` dá o erro `rede`, sem esperar 15 s.
  - `a 429 limite waits the time asked and tries again`: o primeiro `POST` responde `{"erro":"limite","esperarSegundos":3}`. Depois de 3 s no relógio, a mensagem sai.
- [ ] **Step 3: Escreva os testes do aviso que falham.** No `aviso.spec.ts`:
  - `a message in a closed conversation asks the Windows notice with the name and the start`: A está no Teclado, e sai o `chatNotify` com `{conversa, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?'}`.
  - `in a group the title is Nome no Grupo, a photo is Foto and a file is Arquivo: <nome>`: 'João Pereira no Comercial', 'Foto' e 'Arquivo: Pedido 4471.xlsx', com os arquivos mandados pela `ApiDeTeste`.
  - `a long message is cut at 120 characters with …`.
  - `my own message from another computer and the group notices ask no notice`.
  - `the open conversation with the window in front asks no notice, and with the window out of front it does`.
  - `abrir from the core opens that conversation, and conversa 0 opens the Chat tab`.
  - `twelve unread send chatBadge 12 and the tab shows 9+`.
- [ ] **Step 4: Rode e veja falhar.** `npm run build && npx playwright test tests/chat/conversa.spec.ts tests/chat/sem-conexao.spec.ts tests/chat/aviso.spec.ts`.
- [ ] **Step 5: Implemente.**
  - **A tela** segue os quadros `Conversa`, `Grupo`, `SemConexao` e `ConversaEscura`.
    - O cabeçalho da dupla tem o avatar, o nome, "Ramal N" e o Ligar.
    - O do grupo tem o ícone, o nome e "N pessoas · ver os membros", que leva aos Membros.
    - As abas de baixo saem.
  - **As mensagens:**
    - ficam numa lista única, ordenada por id, e um id repetido não entra;
    - um `Pendente` some quando chega a mensagem com o mesmo `idLocal`, pela resposta ou pelo evento, o que vier primeiro;
    - o separador do dia é o `dayGroup`, e a hora é o `clockTime`;
    - num grupo, o nome do autor vai em cima do balão dos outros;
    - os avisos de grupo ficam no meio, com os textos da lista.
  - **A rolagem:** a conversa abre embaixo. Uma mensagem nova só puxa a tela quando ela está a até 80 px do fim. As anteriores chegam quando o alto da lista aparece (um `IntersectionObserver`), e a mensagem que estava à vista continua no mesmo lugar.
  - **O `Escrever`:**
    - é um `textarea` que cresce até 5 linhas;
    - o Enter envia, e o Shift+Enter pula linha;
    - o texto passa pelo `limitCharacters(texto, 4000)`, e o "Faltam <n>" aparece com 200 ou menos;
    - um texto só de espaços não sai.
  - **O envio:**
    - o `Pendente` mostra "Enviando…";
    - sem resposta em 15 s, ou com um erro, ele vira "Não enviada", com "Tentar de novo";
    - uma resposta que chega depois dos 15 s ainda vale, e o balão passa a enviado.
  - **A leitura:** o cliente guarda o `frente` do `janela`. Com a conversa aberta e a janela na frente, a mensagem que chega (ou a abertura, ou o `frente` que vira `true`) manda o `marcarLida` com o maior id, sem repetir um id já mandado. O `naoLidas` dessa conversa fica 0.
  - **O aviso:** a mensagem que chega pede o `chatNotify`, com o `tituloDoAviso` e o `textoDoAviso`, quando não é sua, não é um aviso de grupo e a conversa dela não está aberta com a janela na frente.
  - **A volta da conexão:** o cliente relê as conversas e busca a aberta com o `depois` do maior id, até o `temMais` dar `false`.
  - **O `main.tsx`:**
    - o `abrir` com `tela: 'chat'` leva à `chatConversa` daquela conversa, ou à aba quando a conversa é 0 ou não existe;
    - o Esc, sem diálogo aberto, volta da conversa para a lista;
    - uma ligação que acaba volta ao Teclado, como sempre (spec da W1, 7.2).
- [ ] **Step 6: Rode e veja passar.** Os três arquivos, e depois a suíte inteira.
- [ ] **Step 7: Faça o commit e o push.** A mensagem é `feat(chat): a conversa, com o envio, a leitura, o aviso e a volta da conexão`. O CI fica verde.

### Task 7: Arquivos e fotos

**Files:**
- Create: `windows/ui/src/chat/miniatura.ts`, `componentes/Anexos.tsx`, `componentes/FotoGrande.tsx`
- Modify: `windows/ui/src/chat/api.ts` (o envio com o `XMLHttpRequest`, para o progresso), `cliente.ts`, `formato.ts`, `componentes/Balao.tsx`, `componentes/Escrever.tsx`, `app.css`
- Create: `windows/ui/tests/chat/arquivos.spec.ts`

**Interfaces:**
- Consumes (Tasks 4 e 6): `ApiChat.enviarArquivo`, `enviarMiniatura`, `baixarMiniatura` e `baixarArquivo`; o `Pendente`; o `Balao` e o `Escrever`.
- Produces:
  ```ts
  // cliente.ts
  enviarArquivos(arquivos: File[], texto: string): void;   // os arquivos primeiro, na ordem, e o texto por último
  // miniatura.ts
  export async function fazerMiniatura(arquivo: Blob): Promise<Blob | null>;   // JPEG, lado maior <= 480 px, <= 204.800 bytes; null se não der
  // formato.ts
  export function tamanhoDoArquivo(bytes: number): string;   // '512 bytes', '48 KB', '1,2 MB'
  export function tipoDoArquivo(a: Pick<Arquivo, 'nome' | 'tipo' | 'foto'>): string;
  export function semDirecao(texto: string): string;          // tira U+200E, U+200F, U+202A–U+202E e U+2066–U+2069
  ```

- [ ] **Step 1: Escreva os testes que falham.** No `arquivos.spec.ts`:
  - `the clip picks files and photos, and they wait above the field with × until Enviar`: entram 2 arquivos, e o "×" ("Tirar <nome>") tira um. O Enviar manda só o que ficou.
  - `dragging into the conversation and Ctrl+V also attach`: um `drop` e um `paste` com um `DataTransfer` montado no `page.evaluateHandle`.
  - `more than 10 files keeps 10 and says so`: 12 arquivos dão 10 anexos e o toast "Mande até 10 arquivos de uma vez.".
  - `a file over 25 MB stays out with Este arquivo passa de 25 MB.`: um arquivo de 26.214.401 bytes.
  - `files go first, in order, and the text last`: o servidor tem a ordem `[a.pdf, b.xlsx, texto]`.
  - `the upload shows the progress in the bubble`: com o `Network.emulateNetworkConditions` do CDP (`uploadThroughput` de 200 KB/s), um arquivo de 2 MB mostra um `role="progressbar"` com o `aria-valuenow` entre 1 e 99.
  - `a photo goes with a thumbnail of at most 480 px and 204,800 bytes, and shows small`:
    - um PNG de 2000×1500, feito num canvas da página;
    - o `GET .../miniatura` da `ApiDeTeste` é um JPEG com o lado maior de no máximo 480 px (lido do SOF) e até 204.800 bytes;
    - o `img` do balão tem o `src` começando com `blob:`.
  - `a click on the photo opens it big, Esc closes, and Baixar asks the core to download it`:
    - sai o `chatDownload` com `{arquivo, nome}`;
    - depois de fechar, o `URL.revokeObjectURL` foi chamado para os `blob:` da foto, conferido por um espião no `addInitScript`.
  - `a click on a file asks the core to download it`: sai o `chatDownload` com `{arquivo: <id>, nome: 'Proposta ACME.pdf'}`.
  - `the file bubble shows the name, the size and the type`: "Proposta ACME.pdf" e "1,2 MB · PDF" para 1.258.291 bytes; "48 KB · Planilha" para um `.xlsx` de 49.152 bytes.
  - `an expired file shows Arquivo expirado and does nothing on a click`: o `page.route` do `GET` das mensagens põe `expirado: true`.
  - `names with direction marks show without them` (Review Focus 5): `Proposta‮fdp.exe` aparece como "Propostafdp.exe".
  - `a 120-character file name never scrolls the window sideways` (Review Focus 4), com 400 e com 300 de largura.
  - `Tentar de novo sends a file that failed again`: o primeiro `POST /api/v1/arquivos` tem o `route.abort()`.
- [ ] **Step 2: Rode e veja falhar.** `npm run build && npx playwright test tests/chat/arquivos.spec.ts`.
- [ ] **Step 3: Implemente.**
  - **Os anexos:**
    - o clipe é um `input type="file" multiple`;
    - o `drop` e o `paste` têm o `preventDefault`;
    - os anexos ficam em cima do campo, cada um com o "×", até o Enviar.
  - **O envio de cada arquivo:**
    - faz o `POST /arquivos` com o `XMLHttpRequest` (que manda o `Content-Length` e dá o progresso). Os 15 s do "Não enviada" contam só sem progresso;
    - numa foto (jpg, png, gif ou webp), faz o `fazerMiniatura` e o `PUT .../miniatura`. Uma miniatura que falha não segura a mensagem;
    - termina com o `POST` da mensagem, com o `arquivo`;
    - o "Tentar de novo" manda de novo só o que faltou, com o mesmo `idLocal`.
  - **A miniatura:**
    - o `createImageBitmap`, a escala para caber em 480×480 e o `toBlob('image/jpeg')`;
    - a qualidade começa em 0,8 e desce para 0,6 e 0,4 até caber nos 204.800 bytes; se não couber, `null`.
  - **Os balões:**
    - a foto aparece pela miniatura (`baixarMiniatura`, num `blob:` guardado por id enquanto a conversa está aberta). Sem miniatura, aparece um quadro com o ícone e o nome;
    - o arquivo mostra o nome, o tamanho e o tipo, e um clique manda o `chatDownload`;
    - um arquivo expirado mostra "Arquivo expirado" e não faz nada no clique;
    - todo nome passa pelo `semDirecao`.
  - **A `FotoGrande`** é um `dialog` com o `baixarArquivo` num `blob:` do tipo da foto. Ela tem "Baixar", que manda o `chatDownload`, e "Fechar", que também fecha com o Esc. Ao fechar, ela revoga o `blob:`.
- [ ] **Step 4: Rode e veja passar.** O arquivo, e depois a suíte inteira.
- [ ] **Step 5: Faça o commit e o push.** A mensagem é `feat(chat): os arquivos e as fotos, com a miniatura, o progresso e a foto grande`. O CI fica verde.

### Task 8: De ponta a ponta, as fotos para a aprovação, o roteiro e as notas

**Files:**
- Create: `windows/ui/tests/chat/ponta-a-ponta.spec.ts`, `windows/ui/tests/chat/fotos.spec.ts`, `notas/v0.2.0-rc.1.txt`
- Modify: `docs/teste-manual.md` (a seção "22. Chat (0.2.0-rc.1)" e a tabela "Onde cada critério de sucesso é verificado")

**Interfaces:**
- Consumes: tudo das Tasks 1 a 7.

- [ ] **Step 1: Escreva o teste de ponta a ponta.** `two apps talk through the real server with text, photo, file and group`. São duas páginas, em dois contextos: A ("Recepção", 2001) e B ("Ana Souza", 2003), da mesma empresa, e Carlos Lima (2011) entra pela `ApiDeTeste`.
  1. A abre a Nova conversa, escolhe Ana e manda "Bom dia".
  2. A lista de B mostra a conversa com 1 não lida. B abre, e o número some.
  3. B manda uma foto, e A vê a miniatura.
  4. A manda um PDF. B clica, e sai o `chatDownload` com o id certo.
  5. A cria o grupo "Comercial" com Ana e Carlos. B vê o grupo e os avisos.
  6. Carlos manda uma mensagem pela API, e as duas páginas a mostram.
- [ ] **Step 2: Escreva as fotos para a aprovação.** No `fotos.spec.ts`, para cada tema (claro e escuro) e cada tamanho da janela (400×720, 360×600 e 300×440), o `capturar` faz `chat-<tela>-<largura>x<altura>-<tema>`.
  - As telas: `lista`, `vazio-menu`, `nova-conversa`, `novo-grupo`, `conversa`, `grupo`, `membros`, `sem-conexao` (com uma "Não enviada"), `anexos`, `foto-grande`, `precisa-conta`, `fora`, `computador-novo`, `adm-chat` e `adm-chat-ligado`.
  - Cada tela também passa pelo `semViolacoesSerias` e pelo teclado: o Tab chega a todo botão, e nenhum foco some.
- [ ] **Step 3: Rode os dois e veja passar.** `npx playwright test tests/chat/ponta-a-ponta.spec.ts tests/chat/fotos.spec.ts`. As capturas ficam em `test-results/capturas/`, e o CI as publica no artefato `capturas-interface`.
- [ ] **Step 4: Escreva o roteiro.** A seção 22 do `docs/teste-manual.md` segue a seção 11.3 da spec. Ela é feita em dois PCs, com dois ramais da mesma empresa e um de outra empresa, e cobre:
  - a página de administração: a empresa nova e o código;
  - ligar e desligar o computador no cartão;
  - o texto, a foto, o arquivo (baixado na pasta Downloads, com "(2)" na segunda vez, e o Windows avisando antes de abrir um `.exe`), o grupo e os membros;
  - o aviso do Windows e o clique nele. Ali entra a foto do aviso e do número na barra de tarefas, para a aprovação;
  - o "Não perturbe" e o "Não incomodar" do Windows;
  - a bandeja, com a medida da seção 15 da spec: o app fica 10 minutos na bandeja, chega uma mensagem, e o aviso aparece em até 5 s;
  - sem internet;
  - dois computadores da mesma pessoa;
  - tirar a pessoa, tirar o computador e apagar a empresa;
  - a pessoa da outra empresa, que não vê nada;
  - o número no ícone, de 1 a 9 e depois "9+".

  A tabela dos critérios ganha uma linha para cada critério da seção 3 da spec, com o teste automático e o item do roteiro.
- [ ] **Step 5: Escreva as notas.** O `notas/v0.2.0-rc.1.txt`, curto e no estilo da `v0.1.0-rc.6.txt`: "Chat: converse com os colegas da sua empresa, mande arquivos e fotos, e monte grupos. O técnico liga o computador ao chat na área do administrador.", e por último "Esta é uma versão de teste.".
- [ ] **Step 6: Rode tudo.** A suíte da interface, os `desktop_tests` e o `go test -race ./...` do `chat-servidor`.
- [ ] **Step 7: Faça o commit e o push.** A mensagem é `test(chat): de ponta a ponta, as fotos para a aprovação, o roteiro e as notas da 0.2.0-rc.1`. O CI fica verde, com o `build` e o `chat`. O responsável publica a 0.2.0-rc.1 pelo `release` depois de aprovar as fotos.
