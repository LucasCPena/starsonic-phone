# As reuniões no app do PC, etapa 2a — entrega 2, plano 2: os acertos da página e do servidor do chat — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** antes de o app existir, a página da reunião e o servidor do chat fazem o que o responsável aprovou quando o chat reinicia com um colega numa reunião, aceitam o passe com qualquer nome de aparelho, e deixam de ter quatro defeitos pequenos que as revisões da entrega 1 anotaram.

**Architecture:**
- **O servidor do chat** ganha duas coisas pequenas no protocolo: o abrir da página passa a dizer a **partida** (um número sorteado cada vez que o servidor sobe), e o canal do colega passa a confirmar cada resposta que deu certo (a mensagem **`feito`**).
- **O cérebro da página** (`estado.js`, uma função pura) aprende: que o chat reiniciou (o abrir de um `voltar` com outra partida); a não desistir de voltar ao chat (depois de três tentativas, uma a cada 30 s); o estado "deixou de cuidar"; e, dentro do app, a entrada de novo sozinha, que reaproveita a volta de hoje (o `reconectando`).
- **A tela** desenha o aviso aprovado e desliga o que não tem como responder. O servidor de vídeo e o app não mudam.

**Tech Stack:** o que o chat e a página já usam: Go (o `chat-servidor`), JavaScript em módulos, sem montagem (a página), `node --test` e o `@playwright/test` 1.56.1. Nenhum pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md`: o item 3 da seção 12.1 com a nota de 24/11 (aprovada pelo responsável às 08:24), a seção 7.5 com a nota de 24/11, as seções 7.3, 7.8 e 7.9, e a seção 17. O protocolo é o `docs/chat-protocolo.md`, seções 9 a 12. A lista de onde este plano saiu é a seção 4 do `reunioes-etapa-2-entrega-2-entradas.md` (no Project; a cópia de trabalho fica em `work/projeto/`, fora do git).

**O método:** o mesmo da entrega 1 e da prova (um agente novo por tarefa, um revisor de fora a cada uma, e a revisão geral no fim), se o responsável confirmar este plano.

## Global Constraints

- **O lugar:** a branch `reunioes-etapa-2`. Cada tarefa dá commit, por caminho. Quem envia ao GitHub é quem conduz o plano.
- **Os commits** são em português, com o assunto de até 72 caracteres, e terminam com a linha `Co-Authored-By:` do modelo que escreveu o commit e com a linha `Claude-Session: https://claude.ai/code/session_014A5kJDot8KVFeE91pBUqgW`.
- **A versão** continua a `0.2.0-rc.7` do chat (a da entrega 1, que ainda não foi publicada). Ninguém publica versão: quem publica é o responsável.
- **O aviso aprovado, letra por letra:** "Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app."
- **Os textos que já existem ficam como estão:** "O servidor de reuniões não respondeu"; "O pedido de <Nome> foi aceito"; "O pedido de <Nome> foi recusado"; "<Nome> saiu da reunião"; "A conexão caiu. Entrando de novo…"; "O chat volta quando a conexão voltar.".
- **Um texto novo** (escolha deste plano, a seção "As escolhas"): "Os pedidos voltam quando a conexão voltar."
- **Os valores:**

  | O quê | Valor |
  |---|---|
  | A partida | 43 caracteres base64url, sorteada quando o servidor sobe; vai em toda resposta `200` do abrir da página |
  | O religar do canal | as três tentativas de hoje (2 s, 4 s e 8 s) e, depois delas, uma a cada 30 s, sem limite, enquanto a ligação está no ar |
  | O prazo da entrada de novo | os 15 s de hoje para o passe do app, e os 10 s de hoje (o `PRAZO_VOLTA_MS`) do abrir até o `aceito` |
  | A troca da ligação | a volta de hoje: 2 s de espera, uma senha nova, até 3 tentativas |

- **O texto nunca vira HTML,** a regra de segurança da página (a CSP) não muda, e nenhum `style="…"` entra no HTML. Todo teste de tela confere que não houve violação.
- **Nada disto vai aos registros nem ao console:** o passe, a chave do colega, o bilhete, o nome, o assunto e o código. A partida não é segredo, mas também não vai ao log a cada pedido.
- **Quem é de fora não vê nada novo.** A única mudança para ele é por trás: a página não desiste de voltar ao chat.
- **O que não muda:** o `video-servidor/` (menos a pasta `e2e/`), o `windows/`, o `android/`, o banco do chat, as rotas do app e os eventos da seção 11 do protocolo.
- **O repositório é público:** nenhum segredo, endereço ou nome de verdade. Os nomes dos testes são os inventados de sempre.
- **As linhas** dos arquivos da página e dos testes têm até 120 colunas, como as vizinhas.

## Review Focus

O que a spec pede e os testes das tarefas poderiam deixar passar, do mais provável ao menos. Cada linha tem o teste que a prende:

1. **Um colega tirado da reunião volta sozinho.** A chave de volta recusada com a **mesma** partida (alguém o tirou, ou o servidor o esqueceu por outro motivo) nunca começa a entrada de novo. *(Task 5: "a chave recusada sem o chat ter reiniciado nunca entra de novo sozinha".)*
2. **A entrada de novo deixa a pessoa com duas ligações, ou com nenhuma.** Depois da troca há uma ligação principal só; se a nova não sobe, a pessoa cai na tela "Você saiu da reunião" de hoje, e não num limbo. *(Task 9: as ligações no agente, antes e depois. Task 5: "a volta sozinha que não dá certo…" e o caminho da volta de hoje, que já tem os testes dele.)*
3. **O aviso "Você deixou de cuidar…" aparece para quem é de fora, ou nunca sai.** *(Task 4: "quem é de fora segue como hoje" e "o deixou de cuidar acaba com a saída da reunião". Task 7: "quem é de fora não vê nada disso".)*
4. **Os botões desligados que não voltam.** Com o canal de volta, o painel responde de novo, com a lista nova. *(Task 7: "os botões voltam com o canal".)*
5. **O resultado falado duas vezes, ou da resposta errada.** *(Task 6: "o resultado de uma resposta é dito quando o servidor a confirma" e "o segundo clique na mesma resposta não manda de novo".)*

## A máquina de desenvolvimento

- O `go` pede `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`. O Playwright local pede `PLAYWRIGHT_BROWSERS_PATH=/home/claude/starsonic-reunioes/work/navegadores-pw`. O teste de ponta a ponta pede também `STARSONIC_FREESWITCH_DIR=/home/claude/starsonic-reunioes/work/fs-teste/corrigido`.
- Ela tem 2 processadores. O Playwright, o teste de ponta a ponta e o `go test -race` entram na fila da máquina, num comando só:
  ```
  until mkdir /home/claude/starsonic-reunioes/work/trava-suites 2>/dev/null; do sleep 5; done; <comando>; rmdir /home/claude/starsonic-reunioes/work/trava-suites
  ```
- **Os comandos das provas:**

  | A prova | O comando | Hoje |
  |---|---|---|
  | O Go | `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...` | 18 pacotes com testes |
  | A unidade da página | `cd chat-servidor/pagina && npm test` | 282 testes |
  | Os tipos | `cd chat-servidor/pagina && npm run typecheck` | sem erro |
  | As telas | `cd chat-servidor/pagina && npx playwright test` | 250 testes |
  | De ponta a ponta | `cd video-servidor/e2e && npx playwright test` | 55 testes, uns 14 minutos |

- Um comando que passa de 10 minutos roda em segundo plano. O `git push` nunca vai encadeado depois de um teste com `|`.
- **Antes de dar o commit, cada tarefa roda todas as provas que os arquivos dela tocam** (a tabela acima), e não só o teste novo. As tarefas 2 a 8 mexem na página: antes do push de cada uma, quem conduz roda o teste de ponta a ponta inteiro.
- **O navegador daqui é o Chrome 153, e o do GitHub, o Chromium 141.** Um teste de tela ou de ponta a ponta tem de passar nos dois.

## As escolhas deste plano

O que a spec deixa para quem constrói (a nota de 24/11 do item 3 da seção 12.1) e este plano decide. O responsável as confere ao ler. **As quatro primeiras aparecem na tela.**

1. **Onde o aviso aparece.** No lugar do cartão "<Nome> quer entrar" (no alto, à direita dos quadros) e dentro do painel "Participantes", no lugar das listas e do "Encerrar para todos". Ele fica até a pessoa sair da reunião. O leitor de tela o ouve uma vez.
2. **Enquanto a página tenta voltar ao chat,** os botões do colega (Aceitar, Recusar, Tirar e Encerrar para todos) ficam desligados, e o painel diz "Os pedidos voltam quando a conexão voltar.", como o chat da reunião já diz "O chat volta quando a conexão voltar.".
3. **Dentro do app, a troca da ligação mostra a tela de volta de hoje** ("A conexão caiu. Entrando de novo…") por alguns segundos. Não há texto novo.
4. **Antes de a primeira lista chegar,** o "Encerrar para todos" fica desligado e a parte "NA REUNIÃO" não aparece. Hoje aparecem "NA REUNIÃO · 0" e "As 0 pessoas saem agora.".
5. **Como a página percebe que o chat reiniciou:** o servidor passa a dizer a partida dele no abrir. A página que abre de novo para voltar e vê outra partida sabe que o chat esqueceu todo mundo, e nem tenta o `voltar`. Sem isso, a página só veria a chave recusada, e não saberia distinguir um reinício de um colega que a tirou da reunião: um colega tirado voltaria sozinho.
6. **Isso também resolve o limite de tentativas depois de um reinício** (a nota de 24/11): o `voltar` que ia falhar, e contar como tentativa ruim do endereço, não sai mais. Um escritório inteiro atrás de um endereço só não gasta as 20 tentativas do minuto. Ficam dois restos, anotados: quem caiu de vez e clica em "Entrar de novo" ainda gasta uma tentativa com a chave velha; e as aberturas que dão certo têm o limite delas (60 por minuto por endereço), que um escritório com mais de 30 colegas em reunião atrás de um endereço só alcançaria na volta (os que passassem veriam o aviso).
7. **O mesmo aviso vale em mais dois casos:** quando a página do colega perde o chat de vez por outro motivo (a chave de volta recusada, ou o link que deixou de valer), e quando a entrada de novo dentro do app não dá certo. Nos três, a pessoa continua na reunião e não tem mais como cuidar dela.
8. **A página não desiste mais de voltar ao chat.** Hoje ela tenta três vezes e para. Passa a tentar a cada 30 s enquanto a ligação está no ar. Vale também para quem é de fora (o chat da reunião dele volta).
9. **O leitor de tela só ouve "foi aceito" quando o servidor confirma.** Hoje a página deduz o resultado da lista, e erra quando dois colegas respondem juntos.
10. **O que fica fora deste plano,** e por quê:
    - os aparelhos trocados com a ligação em andamento (uma troca durante uma queda, ou com outra troca pendente; um aparelho "indisponível" que não volta): só existe quando o app manda os nomes, e vai com o plano do app, que tem de provar a troca de ponta a ponta;
    - o computador que troca de pessoa com uma página aberta no navegador: a spec já diz que essa página continua com a pessoa que entrou (a seção 4.5);
    - um arnês de testes de unidade para o `ligacao.js`, e um lugar só para o nome "Participante" e as frases: são arrumações, sem mudança para ninguém.

## Os estados novos do cérebro

Os campos novos do `inicial()` do `estado.js`, que as tarefas abaixo usam (o teste do estado inicial inteiro cresce com cada um):

| O campo | O que é | Nasce na |
|---|---|---|
| `partida: null` | a partida do servidor do último abrir que não foi o de um `voltar` | Task 1 |
| `semCuidar: false` | o colega continua na reunião, mas o canal dele não volta mais: o aviso está à vista | Task 4 |
| `reentrando: null` | a entrada de novo dentro do app: `'passe'` (o `pronta` saiu), `'abrindo'` (o abrir com o passe saiu, ou o canal abre) ou `'entrando'` (o `entrar` saiu) | Task 5 |
| `camDaLigacao: null` | a câmera (`ligado`, `desligado` ou `indisponivel`) na hora do último `ligar` da ligação principal | Task 8 |

O `religando` passa a ir de 0 a 4: a 4 é a tentativa devagar.

---

### Task 1: O servidor diz a partida, e a página a guarda

**Files:**
- Modify: `chat-servidor/internal/api/api.go` (o `servidor` e o construtor dele), `chat-servidor/internal/api/pagina.go` (`abrirPagina`)
- Modify: `chat-servidor/internal/pagina/estatico/rede.js`, `chat-servidor/internal/pagina/estatico/estado.js`
- Test: `chat-servidor/internal/api/pagina_colega_test.go`, `chat-servidor/pagina/testes/rede.test.mjs`, `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces: a resposta `200` do abrir com o campo `"partida": "<43 caracteres base64url>"`; o evento `abriu` do `rede.js` com o `partida` (só quando a resposta o traz, como texto); o campo `partida` do estado.

- [ ] **Step 1: O teste do Go, que falha.** No `abrirResp` do `pagina_colega_test.go`, o campo `Partida string` com o `json:"partida"`. E o teste:

```go
func TestAbrirPagina_Partida(t *testing.T) {
	forma := regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	a := c.abrirBom(t, r.Codigo, nil)
	b := c.abrirBom(t, r.Codigo, nil)
	if !forma.MatchString(a.Partida) || a.Partida != b.Partida {
		t.Fatalf("as partidas são %q e %q; queria a mesma, com 43 caracteres base64url", a.Partida, b.Partida)
	}
	outro := novaCenaR(t)
	ro := outro.marcada(t, outro.kAna)
	if o := outro.abrirBom(t, ro.Codigo, nil); o.Partida == a.Partida {
		t.Fatal("dois servidores deram a mesma partida")
	}
}
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor && go test ./internal/api -run TestAbrirPagina_Partida`. Esperado: FAIL, a partida vazia.
- [ ] **Step 3: O servidor.** Um campo `partida string` no `servidor`, sorteado uma vez no construtor com o `segredo.NovoToken()`. O `abrirPagina` põe `resposta["partida"] = s.partida` em toda resposta `200`, com ou sem colega. Nada dela vai ao log.
- [ ] **Step 4: Rodar e ver passar.** `cd chat-servidor && go test -race ./internal/api`.
- [ ] **Step 5: Os testes da página, que falham.** No `rede.test.mjs`, pelo molde dos casos do abrir que ele já tem: a resposta `200` com `partida: 'partida-1'` dá o `abriu` com `partida: 'partida-1'`; sem o campo, ou com um que não é texto, o `abriu` não tem `partida`. No `estado.test.mjs`, junto dos testes do colega:

```js
// A partida do servidor do chat (seção 10 do protocolo): muda quando ele reinicia.
const comPartida = (evento, partida = 'partida-1') => ({ ...evento, partida });

test('a partida do servidor fica no estado, e o abrir de uma entrada a troca', () => {
  assert.equal(inicial().partida, null);
  let r = rodar(inicial(), COMECAR, comPartida(abriu(1)), midia('ligado', 'ligado'));
  assert.equal(r.estado.partida, 'partida-1');
  r = rodar(r.estado, { tipo: 'nome', valor: 'Maria Lima' }, clique('pedir'), comPartida(abriu(2), 'partida-2'));
  assert.equal(r.estado.partida, 'partida-2');
  assert.deepEqual(r.efeitos, [abrirCanal(2)]);
  // Sem a partida na resposta (um servidor de antes dela), a que a página tem fica.
  assert.equal(rodar(naEntrada(), clique('pedir'), abriu(2)).estado.partida, null);
});
```

- [ ] **Step 6: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os dois testes novos falham.
- [ ] **Step 7: A página.** No `rede.js`, o `abriu` leva o `partida` quando `typeof dados.partida === 'string'`. No `estado.js`, o `partida: null` do `inicial()` e, no `abriu`, todo ramo que não é o do `e.esperandoBilhete` guarda a partida do evento quando ela é um texto (o ramo do `esperandoBilhete` é da Task 4).
- [ ] **Step 8: Rodar tudo que a tarefa toca.** O Go, a unidade da página, os tipos e as telas (a tabela). Esperado: tudo passa, com 2 testes de unidade e 1 do Go a mais.
- [ ] **Step 9: Commit.** `feat(chat): o abrir da página diz a partida do servidor`

### Task 2: Um nome de aparelho que não serve nunca joga o passe fora

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js` (`lerAparelhos`, `passeDoApp`, o caso `aparelhos` do `doApp`)
- Test: `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces: `lerAparelhos(a)` devolve sempre `{microfone, altoFalante, camera}` (nunca `null`).

A regra é a da nota de 24/11 da seção 7.5 da spec: um nome que não é texto, ou que passa de 200 caracteres, conta como o nome que falta (o padrão do sistema para aquele aparelho); os `aparelhos` que faltam, ou que não são um objeto, contam como `{}`. O `passe` só é recusado pelo que é dele.

- [ ] **Step 1: Os testes, que falham.**

```js
test('um nome de aparelho que não serve é o padrão do sistema, e o passe vale', () => {
  const esperando = rodar(inicial(), COMECAR_NO_APP).estado;
  const ruins = [undefined, null, 'texto', 7, [], { microfone: 7, altoFalante: 'x'.repeat(201), camera: 'Câmera HD' }];
  for (const aparelhos of ruins) {
    const r = passo(esperando, doApp({ tipo: 'passe', passe: PASSE, aparelhos }));
    assert.deepEqual(r.efeitos, [abrirCom(1, { passe: PASSE })], JSON.stringify(aparelhos));
  }
  const r = passo(esperando, doApp({ tipo: 'passe', passe: PASSE, aparelhos: ruins.at(-1) }));
  assert.deepEqual(r.estado.aparelhos, { microfone: '', altoFalante: '', camera: 'Câmera HD' });
  // O passe continua recusado pelo que é dele: a forma.
  semMudar(esperando, doApp({ tipo: 'passe', passe: 'curto', aparelhos: {} }));
});

test('a troca de aparelhos com um nome que não serve usa o padrão para ele', () => {
  const r = passo(noAppNaEntrada(), doApp({ tipo: 'aparelhos', aparelhos: { ...APARELHOS, microfone: 7 } }));
  assert.deepEqual(r.estado.aparelhos, { ...APARELHOS, microfone: '' });
  assert.deepEqual(r.efeitos, [PEDIR_MIDIA]);
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os dois falham (hoje a mensagem inteira é ignorada).
- [ ] **Step 3: O cérebro.** As três mudanças da lista de arquivos, com a regra acima.
- [ ] **Step 4: Os testes de hoje que prendiam a regra antiga** (os que esperam a mensagem ignorada por causa dos `aparelhos`, no `estado.test.mjs` e, se houver, no `app.test.mjs`) passam a esperar a regra nova. Cada um que mudar é dito no relatório, com o nome.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas.
- [ ] **Step 6: Commit.** `fix(pagina): um nome de aparelho que não serve não joga o passe fora`

### Task 3: O religar do canal não desiste

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js` (`RELIGAR_DEVAGAR_MS`, `religarFalhou`, o comentário do `religando`)
- Test: `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces: `export const RELIGAR_DEVAGAR_MS = 30000`; o `religando` de 0 a 4 (a 4 é a tentativa devagar, que se repete).

- [ ] **Step 1: O teste, que falha.** O `RELIGAR_DEVAGAR_MS` entra na lista de importações do arquivo de testes.

```js
test('o religar do canal não desiste: depois de três, tenta a cada 30 s', () => {
  const tres = [canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 0), tempo('religar:2'), abrirFalhou(4, 0)];
  let r = rodar(naReuniaoComChave(), ...tres, tempo('religar:3'), abrirFalhou(5, 0));
  // A terceira falha: a próxima tentativa espera 30 s, e o palco sai (sem o canal, nada o acerta).
  assert.deepEqual(r.efeitos, [esperar(RELIGAR_DEVAGAR_MS, 'religar:4')]);
  assert.equal(r.estado.religando, 4);
  assert.equal(r.estado.palco, null);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  // Daí em diante, uma tentativa de cada vez, sempre a 30 s.
  const voltando = seguir(r.estado, [
    [tempo('religar:4'), [abrir(6), prazo(4)]],
    [tempo('religar:4'), []], // a espera repetida, com a tentativa em curso: nunca dois canais
    [abrirFalhou(6, 503), [esperar(RELIGAR_DEVAGAR_MS, 'religar:5')]],
    [tempo('religar:5'), [abrir(7), prazo(5)]],
    [abriu(7), [abrirCanal(7)]],
    [CANAL_ABRIU, [voltar(VOLTA_1)]],
  ]);
  assert.equal(voltando.religando, 4);
  // O voltou acaba com o religar: o canal é de novo o da pessoa.
  const deVolta = passo(voltando, voltou(VOLTA_2)).estado;
  assert.equal(deVolta.religando, 0);
  assert.equal(deVolta.canal, 'aberto');
});
```

- [ ] **Step 2: Rodar e ver falhar.** Esperado: FAIL (hoje a terceira falha para o religar, sem efeito).
- [ ] **Step 3: O cérebro.** No `religarFalhou`, a falha da terceira tentativa em diante não chama mais o `pararDeReligar`: o canal do voltar fecha como hoje, o palco sai, o `religando` fica em 4 e a próxima espera é a `RELIGAR_DEVAGAR_MS`. O `pararDeReligar` continua sendo o fim das respostas que dizem que não adianta tentar (a chave recusada e o `linkInvalido`).
- [ ] **Step 4: Os dois testes de hoje que prendiam a desistência** ("o religar do canal desiste depois de três" e a parte "Três religares sem resposta" de "o religar sem resposta acaba no prazo") passam a dizer a regra nova, com o nome novo. O que eles conferiam além da desistência fica.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas (um teste de tela que espere a desistência muda junto, e é dito no relatório).
- [ ] **Step 6: Commit.** `feat(pagina): o religar do canal não desiste depois de três`

### Task 4: O colega que perde o chat deixa de cuidar da reunião (o cérebro)

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/colega.js` (`AVISO_SEM_CUIDAR`), `chat-servidor/internal/pagina/estatico/estado.js`
- Test: `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Consumes: o `partida` do estado e do `abriu` (Task 1).
- Produces: `export const AVISO_SEM_CUIDAR` no `colega.js`, com o aviso aprovado; o campo `semCuidar`; as funções de dentro `chatReiniciou(e, partida)` e `deixarDeCuidar(e)`, que a Task 5 usa.

**As regras:**
- **O chat reiniciou:** o `abriu` do abrir de um `voltar` (o `e.esperandoBilhete`) traz uma partida que é texto e é diferente da do estado, que não é `null`. O bilhete não é usado, nenhum canal abre, o `voltar` não sai, e a chave de volta sai do estado. A partida nova fica no estado. Depois:
  - com a ligação também caída (o `reconectando` maior que 0): é o `saiu` de uma queda, como hoje faz a chave recusada;
  - com a ligação no ar, quem é de fora: a reunião segue sem o canal, como hoje faz a chave recusada (o `pararDeReligar`);
  - com a ligação no ar, o colega no navegador: o `deixarDeCuidar`;
  - com a ligação no ar, o colega dentro do app: nesta tarefa, o `deixarDeCuidar`; a Task 5 troca este ramo pela entrada de novo.
- **O `deixarDeCuidar(e)`:** o canal do voltar, se houver, fecha; `semCuidar` verdadeiro; o `religando` 0; o palco `null`; a lista vazia (`LISTA_VAZIA`); o `respondendo` vazio; as perguntas fechadas (`tirando`, `encerrando`, `cheiaAoAceitar`); e o efeito `dizer(AVISO_SEM_CUIDAR)`, depois do fechar do canal. A ligação continua no ar, e o painel aberto continua aberto.
- **Também são o `deixarDeCuidar`, para o colega:** a chave recusada no religar (o `chaveRecusada` com a ligação no ar) e o `linkInvalido` do voltar com a ligação no ar. Para quem é de fora, os dois ficam como hoje.
- **Com o `semCuidar`,** o clique `encerrar` não faz nada.
- **Fora da tela da reunião, o `semCuidar` é falso** (a regra fica no `soNaReuniao`, com as outras da tela).

- [ ] **Step 1: Os testes, que falham.** Junto dos do colega, depois do `comPartida` da Task 1:

```js
const SEM_CUIDAR =
  'Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.';
// O colega na reunião, com a partida do servidor no estado e a lista: no navegador e dentro do app.
const colegaComPartida = () =>
  rodar(inicial(), COMECAR_COM_PASSE, comPartida(abriuColega(1, COLEGA)), midia('ligado', 'ligado'), clique('entrar'),
    comPartida(abriuColega(2)), CANAL_ABRIU, mensagem(ACEITO_COM_CHAVE), ligacao('principal', 'confirmada'),
    lista([EU, PEDRO], [MARIA, BIA])).estado;
const noAppComPartida = () =>
  rodar(inicial(), COMECAR_NO_APP, passeDoApp(), comPartida(abriuColega(1, COLEGA)), midia('ligado', 'ligado'),
    clique('entrar'), comPartida(abriuColega(2)), CANAL_ABRIU, mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada'), lista([EU, PEDRO], [MARIA, BIA])).estado;
const deForaComPartida = () =>
  rodar(inicial(), COMECAR, comPartida(abriu(1)), midia('ligado', 'ligado'), { tipo: 'nome', valor: 'Maria Lima' },
    clique('pedir'), comPartida(abriu(2)), CANAL_ABRIU, mensagem({ tipo: 'aguardando' }), mensagem(ACEITO_COM_CHAVE),
    ligacao('principal', 'confirmada')).estado;
// O canal caiu, o religar abriu de novo, e o abrir respondeu com outra partida: o chat reiniciou.
const REINICIOU = [canalFechou(1006), tempo('religar:1'), comPartida(abriu(3), 'partida-2')];

test('o chat reiniciou com o colega na reunião, no navegador: ele deixa de cuidar', () => {
  const r = rodar(colegaComPartida(), ...REINICIOU);
  // O voltar não sai e o canal não abre: o chat não conhece mais a pessoa.
  assert.deepEqual(r.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(r.estado.semCuidar, true);
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.canal, 'fechado');
  assert.equal(r.estado.religando, 0);
  assert.equal(r.estado.chave, null);
  assert.equal(r.estado.partida, 'partida-2');
  assert.deepEqual(r.estado.lista, { participantes: [], pedidos: [] });
  assert.deepEqual(r.estado.respondendo, []);
  assert.equal(r.estado.palco, null);
  // Nada mais tenta voltar, e o bilhete daquele abrir não é usado.
  semMudar(r.estado, CANAL_ABRIU);
  semMudar(r.estado, tempo('prazo:1'));
  semMudar(r.estado, tempo('religar:1'));
});

test('o abrir do voltar com a mesma partida, ou sem partida, segue como hoje', () => {
  const mesma = rodar(colegaComPartida(), canalFechou(1006), tempo('religar:1'), comPartida(abriu(3)));
  assert.deepEqual(mesma.efeitos, [abrirCanal(3)]);
  assert.equal(mesma.estado.semCuidar, false);
  // A resposta sem a partida, e o estado sem ela (um servidor de antes dela).
  const semNaResposta = rodar(colegaComPartida(), canalFechou(1006), tempo('religar:1'), abriu(3));
  assert.deepEqual(semNaResposta.efeitos, [abrirCanal(3)]);
  assert.deepEqual(rodar(colegaComLista(), ...REINICIOU).efeitos, [abrirCanal(3)]);
});

test('o chat reiniciou com quem é de fora na reunião: segue como hoje, sem o voltar e sem aviso', () => {
  const r = rodar(deForaComPartida(), ...REINICIOU);
  assert.deepEqual(r.efeitos, []);
  assert.equal(r.estado.semCuidar, false);
  assert.equal(r.estado.religando, 0);
  assert.equal(r.estado.chave, null);
  assert.equal(r.estado.principal, 'noAr');
  semMudar(r.estado, CANAL_ABRIU);
});

test('o chat reiniciou e a ligação também caiu: é o saiu, sem o voltar', () => {
  for (const partida of [colegaComPartida, noAppComPartida, deForaComPartida]) {
    const caiu = [canalFechou(1006), ligacao('principal', 'semConexao'), tempo('reconectar:2')];
    const r = rodar(partida(), ...caiu, comPartida(abriu(3), 'partida-2'));
    assert.equal(r.estado.aviso, 'saiu');
    assert.equal(r.estado.queda, true);
    assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'mandar' || x.tipo === 'abrirCanal'), []);
  }
});

test('a chave recusada e o link que deixou de valer, no religar do colega, são o deixou de cuidar', () => {
  const voltando = [canalFechou(1006), tempo('religar:1'), abriu(3), CANAL_ABRIU];
  for (const resposta of [RECUSADA_NO_RELIGAR, mensagem({ tipo: 'linkInvalido' })]) {
    const r = rodar(colegaComLista(), ...voltando, resposta);
    assert.deepEqual(r.efeitos, [FECHAR_CANAL, dizer(SEM_CUIDAR)]);
    assert.equal(r.estado.semCuidar, true);
    assert.deepEqual(r.estado.lista, { participantes: [], pedidos: [] });
    // Quem é de fora segue como hoje.
    const fora = rodar(naReuniaoComChave(), ...voltando, resposta);
    assert.deepEqual(fora.efeitos, [FECHAR_CANAL]);
    assert.equal(fora.estado.semCuidar, false);
  }
  // O 404 do abrir do voltar é o mesmo link que deixou de valer.
  const semLink = rodar(colegaComLista(), canalFechou(1006), tempo('religar:1'), abrirFalhou(3, 404));
  assert.deepEqual(semLink.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(semLink.estado.semCuidar, true);
});

test('o deixou de cuidar acaba com a saída da reunião', () => {
  const sem = rodar(colegaComPartida(), ...REINICIOU).estado;
  // Sem a lista não há o que responder, e o Encerrar para todos não abre a pergunta.
  semMudar(sem, cliqueEm('encerrar'));
  assert.equal(passo(sem, clique('sair')).estado.semCuidar, false);
  // A ligação que cai depois é o saiu: sem o canal e sem a chave, não há como voltar.
  const caiu = passo(sem, ligacao('principal', 'semConexao')).estado;
  assert.equal(caiu.aviso, 'saiu');
  assert.equal(caiu.semCuidar, false);
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os seis falham. O segundo ("o abrir do voltar com a mesma partida…") falha só porque o `semCuidar` ainda não existe: ele prende o que **não** pode mudar, e fica.
- [ ] **Step 3: O cérebro.** O `AVISO_SEM_CUIDAR` no `colega.js`; no `estado.js`, o `semCuidar: false` do `inicial()`, o `chatReiniciou`, o `deixarDeCuidar`, os dois desvios do colega (no `chaveRecusada` e no `linkInvalidoDoVoltar`), o `encerrar` com o `semCuidar`, e a regra do `soNaReuniao`. Uma seção nova no comentário do alto do arquivo ("O chat que reinicia"), no estilo das outras.
- [ ] **Step 4: Os testes de hoje que partem do colega que desistiu de religar** (o `colegaSemCanal().desistiu` e os que o usam) passam a esperar o `semCuidar` e a lista vazia. Cada um que mudar é dito no relatório.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas.
- [ ] **Step 6: Commit.** `feat(pagina): o colega que perde o chat deixa de cuidar da reunião`

### Task 5: Dentro do app, a página entra de novo sozinha (o cérebro)

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js`
- Test: `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Consumes: `chatReiniciou` e `deixarDeCuidar` (Task 4); `pedirOPasse`, `comAbrir`, `reconhecido`, `desligarAsDuas`, `esperaNova` e a volta de hoje (o `reconectando`), que já existem.
- Produces: o campo `reentrando` (`null`, `'passe'`, `'abrindo'` ou `'entrando'`).

**As regras** (a nota de 24/11 do item 3 da seção 12.1 da spec):
- **Começa** no ramo do `chatReiniciou` do colega dentro do app, com a ligação no ar: a lista, o `respondendo`, as perguntas e o palco saem como no `deixarDeCuidar`, mas sem o aviso; o `reentrando` vira `'passe'`, o `passeRecusado` volta a falso, e a página pede outro passe (o `pedirOPasse`: o `pronta` e o prazo de 15 s).
- **O `passe` do app** que chega com o `reentrando` em `'passe'`: o abrir com ele (o `comAbrir`), o `reentrando` em `'abrindo'`, e um prazo de 10 s numa vez nova (o `prazoDaVez`), que vale do abrir até o `aceito`.
- **O `abriu` desse abrir:** com o colega reconhecido (o `reconhecido`), a chave do colega nova, a partida nova e o canal abrindo; sem ele, o `deixarDeCuidar`.
- **O canal que abre** manda o `entrar`, e não o `voltar`. O canal fica `'voltando'` (ainda não é o da pessoa: nem o aviso da câmera nem o chat saem por ele), e o `reentrando`, `'entrando'`.
- **O `aceito`** nesse canal: o canal passa a `'aberto'`, o acesso e a chave de volta são os novos, o `reentrando` volta a `null`, e a ligação é trocada **pela volta de hoje**: as duas ligações descem (o `desligarAsDuas`, que também para a tela compartilhada), o `reconectando` vai a 1 e a espera de 2 s (`'reconectar:<vez>'`) leva à senha nova e ao `ligar`. O microfone e a câmera ficam como estavam; a tela compartilhada não volta sozinha. A senha que veio no `aceito` não é usada.
- **Tudo o que falha antes do `aceito` é o `deixarDeCuidar`,** com a ligação de antes no ar: o passe que não chega em 15 s; o abrir que falha (a rede, o `429`, o `404`); o segundo `401` seguido (o primeiro pede outro passe, com o `passeRecusado`, como na entrada); o canal que fecha; o prazo de 10 s; e o `cheia`, o `servidorCheio`, o `semServidor`, o `linkInvalido` e o `erro` em resposta ao `entrar`. O canal aberto para a entrada de novo fecha antes do aviso.
- **A pessoa que sai, ou a ligação que cai, no meio disso:** o `reentrando` volta a `null` e o passe esperado é esquecido (o `esperandoPasse` falso), para o prazo dele não levar ninguém à entrada de quem é de fora. A regra fica no `soNaReuniao`.

- [ ] **Step 1: Os testes, que falham.**

```js
test('o chat reiniciou com o colega na reunião, dentro do app: a página entra de novo sozinha', () => {
  const OUTRO_PASSE = 'q'.repeat(43);
  const OUTRA_CHAVE = 'd'.repeat(43);
  const ACEITO_2 = { ...ACEITO, participante: 'participante-2', senha: 'senha-2', volta: VOLTA_2 };
  let estado = seguir(
    noAppComPartida(),
    [
      [canalFechou(1006), [esperar(2000, 'religar:1')]],
      [tempo('religar:1'), [abrir(3), prazo(1)]],
      // Outra partida: o voltar não sai, e a página pede outro passe ao app. A ligação de antes segue no ar.
      [comPartida(abriu(3), 'partida-2'), [PRONTA, prazoDoPasse(2)]],
      [passeDoApp(OUTRO_PASSE), [abrirCom(4, { passe: OUTRO_PASSE }), prazo(2)]],
      [comPartida(abriuColega(4, { ...COLEGA, chave: OUTRA_CHAVE }), 'partida-2'), [abrirCanal(4)]],
      [CANAL_ABRIU, [ENTRAR]],
    ],
    (e) => {
      assert.equal(e.tela, 'reuniao');
      assert.equal(e.principal, 'noAr');
      assert.equal(e.semCuidar, false);
    },
  );
  assert.equal(estado.reentrando, 'entrando');
  assert.equal(estado.chaveDoColega, OUTRA_CHAVE);
  assert.equal(estado.partida, 'partida-2');
  assert.deepEqual(estado.lista, { participantes: [], pedidos: [] });
  // O aceito do canal novo: as duas ligações de antes descem, e a volta de hoje sobe a nova, com uma senha nova.
  let r = passo(estado, mensagem(ACEITO_2));
  assert.deepEqual(r.efeitos, [...DESLIGAR_AS_DUAS, esperar(2000, 'reconectar:3'), camera(true)]);
  assert.equal(r.estado.reentrando, null);
  assert.equal(r.estado.reconectando, 1);
  assert.equal(r.estado.canal, 'aberto');
  assert.deepEqual(r.estado.chave, { participante: 'participante-2', volta: VOLTA_2 });
  estado = seguir(r.estado, [
    [tempo('reconectar:3'), [SENHA, prazo(3)]],
    [mensagem({ tipo: 'senha', senha: 'senha-3' }), [ligar('principal', 'senha-3')]],
  ]);
  r = passo(estado, ligacao('principal', 'confirmada'));
  assert.equal(r.estado.tela, 'reuniao');
  assert.equal(r.estado.principal, 'noAr');
  assert.equal(r.estado.reconectando, 0);
  // O microfone e a câmera ficam como estavam, e a lista nova chega pelo canal novo.
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(passo(r.estado, lista([EU], [])).estado.lista, { participantes: [EU], pedidos: [] });
});

test('a volta sozinha que não dá certo é o deixou de cuidar, com a ligação de antes no ar', () => {
  const pedindo = rodar(noAppComPartida(), ...REINICIOU).estado;
  const abrindo = passo(pedindo, passeDoApp('q'.repeat(43))).estado;
  const entrando = rodar(abrindo, comPartida(abriuColega(4, COLEGA), 'partida-2'), CANAL_ABRIU).estado;
  const falhas = [
    [pedindo, tempo('passe:2'), []], // o app não mandou o passe
    [abrindo, abrirFalhou(4, 0), []], // a rede
    [abrindo, abrirFalhou(4, 429, 30), []],
    [abrindo, abrirFalhou(4, 404), []], // o link deixou de valer: quem está na reunião continua nela
    [abrindo, tempo('prazo:2'), []],
    [abrindo, comPartida(abriu(4), 'partida-2'), []], // o abrir que não reconheceu o colega
    [entrando, mensagem({ tipo: 'cheia' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'semServidor' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'linkInvalido' }), [FECHAR_CANAL]],
    [entrando, mensagem({ tipo: 'erro', erro: 'invalido' }), [FECHAR_CANAL]],
    [entrando, canalFechou(1006), []],
    [entrando, tempo('prazo:2'), [FECHAR_CANAL]],
  ];
  for (const [antes, evento, antesDoAviso] of falhas) {
    const r = passo(antes, evento);
    assert.deepEqual(r.efeitos, [...antesDoAviso, dizer(SEM_CUIDAR)], JSON.stringify(evento));
    assert.equal(r.estado.semCuidar, true);
    assert.equal(r.estado.reentrando, null);
    assert.equal(r.estado.principal, 'noAr');
    assert.equal(r.estado.canal, 'fechado');
    assert.equal(r.estado.esperandoPasse, false);
    assert.equal(r.estado.passe, null);
  }
});

test('na volta sozinha, o primeiro passe que não vale pede outro, e o segundo é o deixou de cuidar', () => {
  const abrindo = rodar(noAppComPartida(), ...REINICIOU, passeDoApp('q'.repeat(43))).estado;
  let r = passo(abrindo, passeRecusado(4));
  assert.deepEqual(r.efeitos, [PRONTA, prazoDoPasse(3)]);
  assert.equal(r.estado.reentrando, 'passe');
  r = rodar(r.estado, passeDoApp('r'.repeat(43)), passeRecusado(5));
  assert.deepEqual(r.efeitos, [dizer(SEM_CUIDAR)]);
  assert.equal(r.estado.semCuidar, true);
});

test('a chave recusada sem o chat ter reiniciado nunca entra de novo sozinha', () => {
  // A mesma partida: um colega tirou a pessoa, ou o servidor a esqueceu por outro motivo. Dentro do app, nada de pronta.
  const voltando = [canalFechou(1006), tempo('religar:1'), comPartida(abriu(3)), CANAL_ABRIU];
  const r = rodar(noAppComPartida(), ...voltando, RECUSADA_NO_RELIGAR);
  assert.deepEqual(doAppNos(r.efeitos), []);
  assert.equal(r.estado.reentrando, null);
  assert.equal(r.estado.semCuidar, true);
});

test('quem sai no meio da volta sozinha não vira de fora quando o prazo do passe vence', () => {
  const pedindo = rodar(noAppComPartida(), ...REINICIOU).estado;
  const fora = passo(pedindo, clique('sair')).estado;
  assert.equal(fora.reentrando, null);
  assert.equal(fora.esperandoPasse, false);
  semMudar(fora, tempo('passe:2'));
  assert.notEqual(fora.colega, null);
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os cinco falham (o primeiro dá o aviso da Task 4 no lugar do `pronta`).
- [ ] **Step 3: O cérebro.** O `reentrando: null` do `inicial()` e as regras acima, cada uma no lugar em que o evento dela já é tratado (`chatReiniciou`, `passeDoApp`, `abriu`, `abrirFalhou`, `canalAbriu`, `respostaDoVoltar`, `canalFechou`, `tempo` com o `passe` e o `prazo`, `soNaReuniao`). O comentário "O chat que reinicia" do alto do arquivo ganha a entrada de novo.
- [ ] **Step 4: O teste da Task 4** "o chat reiniciou e a ligação também caiu" continua valendo para os três; nenhum outro teste de hoje muda. Se algum mudar, é um achado, dito no relatório.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas.
- [ ] **Step 6: Commit.** `feat(pagina): dentro do app, a página entra de novo sozinha`

### Task 6: O servidor confirma cada resposta do colega

**Files:**
- Modify: `chat-servidor/internal/api/pagina.go` (`respostaDoColega`, um tipo `mensagemFeito`)
- Modify: `chat-servidor/internal/pagina/estatico/estado.js` (`mensagem`, `lista`, `responder`, `canalFechou`, uma função `feito`)
- Test: `chat-servidor/internal/api/pagina_colega_test.go`, `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces: a mensagem do servidor para a página `{"tipo": "feito", "de": "aceitar" | "recusar" | "tirar", "id": "<16 hex>"}`, mandada pelo canal que respondeu, logo depois de a resposta dar certo. O `encerrar` que dá certo não tem `feito`: o `encerrada` é o fim. A ordem entre o `feito` e o `participantes` novo não é garantida, e a página não depende dela.

- [ ] **Step 1: O teste do Go, que falha.** Um ajudante e o teste:

```go
// listaEFeito lê as duas mensagens que uma resposta que deu certo traz, em qualquer ordem, e devolve a lista.
func listaEFeito(t *testing.T, conn *websocket.Conn, de, id string) map[string]any {
	t.Helper()
	var lista map[string]any
	feito := false
	for i := 0; i < 2; i++ {
		m := aPagina(t, conn)
		switch m["tipo"] {
		case "participantes":
			lista = m
		case "feito":
			feito = len(m) == 3 && m["de"] == de && m["id"] == id
		}
	}
	if lista == nil || !feito {
		t.Fatalf("queria a lista e o feito de %s %s", de, id)
	}
	return lista
}

func TestCanalDeColega_Feito(t *testing.T) {
	c := novaCenaR(t)
	r := c.marcada(t, c.kAna)
	pagina, carlos, _ := c.carlosNaReuniao(t, r.Codigo)
	_, pedido := pedeAMaria(t, c, r.Codigo, pagina)

	daPagina(t, pagina, map[string]any{"tipo": "aceitar", "pedido": pedido})
	soOCarlos(t, listaEFeito(t, pagina, "aceitar", pedido), carlos)
	// A segunda resposta ao mesmo pedido falha, e a que falha não tem feito.
	daPagina(t, pagina, map[string]any{"tipo": "recusar", "pedido": pedido})
	recusaDoCanal(t, pagina, "recusar", "jaRespondido")
	semRecusa(t, pagina)
}
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor && go test ./internal/api -run TestCanalDeColega_Feito`. Esperado: FAIL (sem o `feito`).
- [ ] **Step 3: O servidor.** No `respostaDoColega`, depois de um `aceitar`, um `recusar` ou um `tirar` sem erro, `c.Mandar(mensagemFeito{Tipo: "feito", De: tipo, ID: id})`.
- [ ] **Step 4: Os testes de hoje do canal do colega** que leem a mensagem seguinte a uma resposta que deu certo passam a ler as duas pelo `listaEFeito`. O `TestCanalDeColega_Recusar` e o `TestCanalDeColega_Tirar` conferem o `feito` deles (`recusar` com o pedido; `tirar` com o participante). O `TestCanalDeColega_Encerrar` continua sem `feito`.
- [ ] **Step 5: Rodar o Go inteiro.** `cd chat-servidor && gofmt -l . && go vet ./... && go test -race ./...`.
- [ ] **Step 6: Os testes da página, que falham.**

```js
const feito = (de, id) => mensagem({ tipo: 'feito', de, id });

test('o resultado de uma resposta é dito quando o servidor a confirma', () => {
  const respondeu = passo(colegaComLista(), cliqueEm('aceitar', MARIA.id));
  assert.deepEqual(respondeu.efeitos, [mandar({ tipo: 'aceitar', pedido: MARIA.id })]);
  // A lista nova, sem o pedido, não diz nada sozinha: outro colega pode ter respondido antes.
  const semMaria = passo(respondeu.estado, lista([EU, PEDRO, MARIA_NA_REUNIAO], [BIA]));
  assert.deepEqual(semMaria.efeitos, []);
  assert.deepEqual(semMaria.estado.respondendo, [{ de: 'aceitar', id: MARIA.id, nome: 'Maria Lima' }]);
  // O feito diz, antes ou depois da lista.
  for (const antes of [respondeu.estado, semMaria.estado]) {
    const r = passo(antes, feito('aceitar', MARIA.id));
    assert.deepEqual(r.efeitos, [dizer('O pedido de Maria Lima foi aceito')]);
    assert.deepEqual(r.estado.respondendo, []);
  }
  // A recusa (outro colega respondeu antes) não diz nada, mesmo com a lista já sem o pedido.
  const perdeu = passo(semMaria.estado, recusa('aceitar', 'jaRespondido'));
  assert.deepEqual(perdeu.efeitos, []);
  assert.deepEqual(perdeu.estado.respondendo, []);
  // O feito de outra resposta, de outro pedido, ou sem resposta esperando, fica de fora.
  semMudar(respondeu.estado, feito('recusar', MARIA.id));
  semMudar(respondeu.estado, feito('aceitar', BIA.id));
  semMudar(colegaComLista(), feito('aceitar', MARIA.id));
});

test('o segundo clique na mesma resposta não manda de novo', () => {
  const respondeu = passo(colegaComLista(), cliqueEm('aceitar', MARIA.id)).estado;
  semMudar(respondeu, cliqueEm('aceitar', MARIA.id));
  // Outra resposta ao mesmo pedido sai: a pessoa mudou de ideia, e o servidor decide qual vale.
  const outra = passo(respondeu, cliqueEm('recusar', MARIA.id));
  assert.deepEqual(outra.efeitos, [mandar({ tipo: 'recusar', pedido: MARIA.id })]);
});

test('as respostas que esperavam saem com o canal que cai', () => {
  const r = rodar(colegaComLista(), cliqueEm('aceitar', MARIA.id), canalFechou(1006));
  assert.deepEqual(r.estado.respondendo, []);
});
```

- [ ] **Step 7: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os três falham.
- [ ] **Step 8: O cérebro.** O `feito` tira do `respondendo` a resposta com aquele `de` e aquele `id`, e diz o `ditoDaResposta` dela; sem ela, nada. A `lista` deixa de tirar respostas do `respondendo` e de dizer o resultado delas (o pedido que chega continua sendo dito). O `responder` não manda de novo a resposta que já espera com o mesmo `de` e o mesmo `id`. O canal que cai na reunião esvazia o `respondendo`.
- [ ] **Step 9: Os testes de hoje que ouviam o resultado na lista** passam a ouvi-lo no `feito`. Cada um que mudar é dito no relatório.
- [ ] **Step 10: Rodar tudo que a tarefa toca.** O Go, a unidade da página, os tipos e as telas (os testes de tela que ouvem o resultado mandam o `feito` pelo canal falso, como o servidor).
- [ ] **Step 11: Commit.** `feat(chat): o servidor confirma cada resposta do colega`

### Task 7: A tela do colega: o aviso, os botões sem o canal e a lista que ainda não chegou

**Files:**
- Modify: `chat-servidor/internal/pagina/pagina.html`, `chat-servidor/internal/pagina/estatico/pagina.css`, `chat-servidor/internal/pagina/estatico/participantes.js`, `chat-servidor/internal/pagina/estatico/pagina.js`, `chat-servidor/internal/pagina/estatico/estado.js` (o clique `encerrar` sem a lista)
- Test: `chat-servidor/pagina/testes/participantes.spec.ts`, `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Consumes: `semCuidar` (Task 4), `reentrando` (Task 5), `podeResponder` (o canal da pessoa aberto, na tela da reunião), a lista do estado.

**O desenho** (as escolhas 1, 2 e 4):
- **O aviso de quem deixou de cuidar** (com o `semCuidar`):
  - no lugar do cartão do pedido, com as medidas e as cores dele: uma `section` com o título "Você deixou de cuidar desta reunião" (um `h2`) e o texto "Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.", sem botões;
  - no painel "Participantes", no lugar das duas listas e do rodapé do "Encerrar para todos": um parágrafo com o aviso inteiro;
  - o botão "Participantes" continua nos controles, sem número.
- **Sem o canal, com a página tentando voltar** (o colega na tela da reunião, sem o `semCuidar`, e sem poder responder: o religar, ou a entrada de novo): o Aceitar e o Recusar (no cartão e no painel), o Tirar, o "Tirar" da pergunta e o "Encerrar para todos" ficam `disabled`; e o painel mostra, acima das listas, "Os pedidos voltam quando a conexão voltar.". O "Ver os pedidos" e o "Voltar" das perguntas continuam ligados.
- **Antes de a primeira lista chegar** (a lista sem participantes): a parte "NA REUNIÃO" fica escondida, e o "Encerrar para todos", `disabled`. No cérebro, o clique `encerrar` sem participantes na lista não abre a pergunta.

- [ ] **Step 1: O teste de unidade, que falha.**

```js
test('o Encerrar para todos não abre a pergunta antes de a lista chegar', () => {
  semMudar(colegaNaReuniao(), cliqueEm('encerrar'));
  assert.equal(passo(colegaComLista(), cliqueEm('encerrar')).estado.encerrando, true);
});
```

- [ ] **Step 2: Os testes de tela, que falham.** No `participantes.spec.ts`, pelo molde dos vizinhos (o `entrarComoColega`, o `mandarLista`, o `canal.fechar(1006)`, o `rede.canalNumero(n)`, o `rede.responder(…)` e o `page.clock.runFor(…)`). O aviso é procurado pelos textos exatos:

  - **"sem o canal, os botões do colega desligam, e voltam com ele":** com a lista (`CINCO` e um pedido da Maria) e o painel aberto, o canal cai. O Aceitar e o Recusar do cartão e do painel, o Tirar de uma linha e o "Encerrar para todos" ficam `toBeDisabled()`; a linha "Os pedidos voltam quando a conexão voltar." fica à vista. O relógio anda 2 s, o canal 2 recebe o `voltar` e responde `{tipo: 'voltou', volta: …}` e a lista de novo: os mesmos botões ficam `toBeEnabled()`, a linha some, e o Aceitar manda o `aceitar` pelo canal 2.
  - **"o chat reiniciou, no navegador: o aviso no lugar do cartão e no painel":** o abrir do carregar e o do Entrar respondem com `partida: 'partida-1'`; com a lista e um pedido, o canal cai; o abrir do voltar responde com `partida: 'partida-2'`. O título "Você deixou de cuidar desta reunião" e o texto "Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app." ficam à vista onde o cartão estava; o cartão "Maria Lima quer entrar" some; no painel, o aviso inteiro aparece, e as listas e o "Encerrar para todos" não; o botão "Participantes" não tem número; a região falada diz o aviso inteiro; nenhum canal 2 é aberto (`rede` não tem um segundo canal depois de 5 s do relógio). O "Sair" leva ao "Você saiu da reunião", sem o aviso.
  - **"antes de a lista chegar, o painel não diz zero":** o colega entra e abre o painel antes de qualquer `participantes`: a parte "NA REUNIÃO" não aparece e o "Encerrar para todos" está `toBeDisabled()`; com a lista de uma pessoa, aparece "NA REUNIÃO · 1" e o botão liga.
  - **"quem é de fora não vê nada disso":** com quem é de fora na reunião (o `naReuniao` da reunião falsa), o canal cai e o abrir do voltar responde com outra partida: nenhum dos dois textos do aviso existe na página, e a linha "Os pedidos voltam…" também não.

- [ ] **Step 3: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test && npx playwright test participantes`. Esperado: o de unidade e os quatro de tela falham.
- [ ] **Step 4: A tela e o cérebro.** O HTML (as duas peças do aviso e a linha, escondidas, com os textos fixos), o CSS (as classes novas pelas regras do cartão e do `.painel-sem-canal`, com os tokens de cor de hoje), o `participantes.js` e o `pagina.js` (o desenho pelos três estados acima), e o clique `encerrar` do cérebro.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas inteiras.
- [ ] **Step 6: Olhar.** Uma captura de cada estado novo (o aviso no cartão e no painel, no PC e no celular de 390×844; os botões desligados; o painel antes da lista), guardada em `work/telas-acertos/` (fora do git), e uma linha no relatório dizendo o que se vê em cada uma: nada sobreposto, nada cortado, o texto exato.
- [ ] **Step 7: Commit.** `feat(pagina): o aviso de quem deixou de cuidar, e os botões sem o canal`

### Task 8: A pausa e o bloqueio nas bordas da entrada e da volta

**Files:**
- Modify: `chat-servidor/internal/pagina/estatico/estado.js` (`calado`, `pausar`, `retomar`, `comAPausaGuardada`, `bloquear`, `comSenha`, `midia`, `ligacaoPrincipal`, `soNaReuniao`)
- Test: `chat-servidor/pagina/testes/estado.test.mjs`

**Interfaces:**
- Produces: o campo `camDaLigacao`; a `pausaPendente` passa a ser `{origem, vez, mic, cam}`, com o microfone e a câmera de antes dela.

**As regras:**
- **A pausa que chega com a página entrando** (a tela `entrando`) cala o som e desliga o microfone e a câmera **na hora** (pelo `levarAMidia`, como na reunião), e guarda como eles eram. Ao entrar, ela vira a pausa de sempre, com o que guardou. O `retomar` antes de entrar devolve os dois.
- **O bloqueio que chega com a página entrando** vale como na reunião: a câmera desliga, e volta ao desbloquear.
- **A câmera é acertada quando a ligação entra:** o cérebro guarda a câmera da hora de cada `ligar` da principal (o `camDaLigacao`); no `confirmada`, se a câmera do estado é outra (e nenhuma das duas é `indisponivel`), sai uma troca (`trocarCamera`, com o `trocandoCamera`). Vale para a entrada e para a volta depois de uma queda.

- [ ] **Step 1: Os testes, que falham.**

```js
test('a pausa que chega com a página entrando cala e desliga na hora', () => {
  let r = passo(noAppAceito(), PAUSAR);
  assert.deepEqual(r.efeitos, [trocarMicrofone(false), camera(false), calar(true)]);
  assert.equal(r.estado.mic, 'desligado');
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.pausaPendente, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  // Ao entrar, a pausa vale com o que era antes dela, e a câmera que subiu com a ligação é desligada nela.
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.estado.pausa, { origem: 'app', vez: null, mic: 'ligado', cam: 'ligado' });
  assert.equal(r.estado.pausaPendente, null);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(false)]);
  assert.equal(r.estado.trocandoCamera, true);
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'calar'), []); // já estava calado
  // O retomar devolve os dois.
  r = rodar(r.estado, CAMERA_TROCADA, RETOMAR);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
});

test('o retomar antes de entrar devolve o que a pausa guardada desligou', () => {
  const r = rodar(noAppAceito(), PAUSAR, RETOMAR);
  assert.equal(r.estado.pausaPendente, null);
  assert.equal(r.estado.mic, 'ligado');
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos, [trocarMicrofone(true), camera(true), calar(false)]);
  // A ligação subiu com a câmera, e o estado a quer ligada: nada a acertar ao entrar.
  const dentro = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(dentro.efeitos.filter((x) => x.tipo === 'trocarCamera'), []);
});

test('o bloqueio que chega com a página entrando desliga a câmera, e ela volta ao desbloquear', () => {
  let r = passo(noAppAceito(), bloqueio(true));
  assert.equal(r.estado.cam, 'desligado');
  assert.deepEqual(r.estado.bloqueio, { cam: 'ligado' });
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(false)]);
  r = rodar(r.estado, CAMERA_TROCADA, bloqueio(false));
  assert.equal(r.estado.cam, 'ligado');
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(true)]);
});

test('a câmera que mudou com a ligação da volta subindo é acertada quando ela entra', () => {
  // Na volta depois da conexão caída, em pausa: a ligação sobe sem a câmera, e o retomar chega com ela subindo.
  const queda = [ligacao('principal', 'semConexao'), tempo('reconectar:1'), mensagem({ tipo: 'senha', senha: 'senha-r1' })];
  const subindo = rodar(noAppNaReuniao(), PAUSAR, CAMERA_TROCADA, ...queda);
  assert.deepEqual(subindo.efeitos, [ligar('principal', 'senha-r1')]);
  let r = passo(subindo.estado, RETOMAR);
  assert.equal(r.estado.cam, 'ligado');
  r = passo(r.estado, ligacao('principal', 'confirmada'));
  assert.deepEqual(r.efeitos.filter((x) => x.tipo === 'trocarCamera'), [trocarCamera(true)]);
  assert.equal(r.estado.trocandoCamera, true);
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd chat-servidor/pagina && npm test`. Esperado: os quatro falham.
- [ ] **Step 3: O cérebro.** As regras acima. A pausa e o bloqueio continuam sendo da reunião: fora da tela `reuniao` e da `entrando`, os dois saem, e o microfone e a câmera ficam como a pausa os deixou (a regra de hoje, da nota de 23/11 da seção 7.9 da spec).
- [ ] **Step 4: Os testes de hoje da pausa guardada** (os que esperam a `pausaPendente` como `{origem, vez}`, e o som só calado ao entrar) passam a esperar a regra nova. Cada um que mudar é dito no relatório.
- [ ] **Step 5: Rodar tudo que a tarefa toca.** A unidade da página, os tipos e as telas (o `pausa.spec.ts` entre elas).
- [ ] **Step 6: Commit.** `fix(pagina): a pausa e o bloqueio valem com a página entrando`

### Task 9: De ponta a ponta: o chat reinicia com a colega na reunião

**Files:**
- Modify: `video-servidor/e2e/ambiente.ts` (anotar o processo do chat, e pará-lo no fim pelo que está anotado), `video-servidor/e2e/servidores.ts` (`reiniciarOChat`)
- Create: `video-servidor/e2e/reinicio.spec.ts`

**Interfaces:**
- Produces: `export async function reiniciarOChat(): Promise<void>` no `servidores.ts`.

**O `reiniciarOChat`:**
- O `ambiente.ts`, depois de subir o chat, escreve em `test-results/privado/chat-processo.json` o `pid`, o comando e os argumentos dele. No fim, ele para o processo que o arquivo diz (além dos que ele mesmo subiu; um filho que já saiu não é erro).
- O `reiniciarOChat()` lê o arquivo, manda o `SIGTERM` ao `pid`, espera a porta do chat deixar de aceitar conexões (até 10 s; depois, o `SIGKILL`), sobe o mesmo comando com os mesmos argumentos, com a saída **acrescentada** ao `test-results/chat.log` (o teste dos registros lê o arquivo inteiro), escreve o `pid` novo, espera o `GET /admin/entrar` responder `200` (até 30 s) e esquece a sessão da administração (a próxima chamada entra de novo).
- Os dados do chat (a pasta `privado/chat`) são os mesmos: a empresa, o computador da Ana e as reuniões marcadas continuam. O que some é o que o chat guarda na memória.

- [ ] **Step 1: Os dois testes, que falham** (o `reiniciarOChat` ainda não existe). Pelo molde do `colega.spec.ts` (as pessoas `A` e `C`, o `ana()`, o `Pagina.abrir`, o `entrarComoColega`, o `pedirEAceitarPelaPagina`, as cores e os sons):

  - **"o chat reinicia com a colega na reunião, dentro do app de mentira":**
    1. a Ana entra pelo app de mentira (`{ noApp: true }`), e a Maria, de fora, é aceita; as duas se veem e se ouvem;
    2. guarda o participante da Ana (`anaP.participante()`) e o número de `pronta` recebidos (1);
    3. `await reiniciarOChat()`;
    4. espera o segundo `pronta` do app de mentira (até 60 s) e responde com um passe novo: `await anaP.doApp('passe', { passe: await app.passe(codigo), aparelhos: {} })` (com o `anotarSegredos` do passe);
    5. confere, com `expect.poll` de até 60 s: a página da Ana recebeu um segundo `aceito`, com outro participante; depois dele chegou um `participantes` com a Ana (`voce` verdadeiro, o nome "Ana Souza") e mais uma pessoa de nome vazio; no agente, o participante antigo tem 0 ligações principais e o novo tem 1 (`ligacoesPrincipais`);
    6. a Maria continua vendo e ouvindo a Ana (`esperarCores` e `esperarFrequencia(A.som)`), e a Ana, a Maria;
    7. a Ana mandou o `entrar` duas vezes e nenhum `voltar` (`mensagensMandadas()`); a Maria, de fora, não mandou nenhum `voltar` depois do reinício;
    8. a Ana volta a cuidar: a Bia pede para entrar e a Ana a aceita pela página (`pedirEAceitarPelaPagina`);
    9. `conferirOConsole()` nas três.
  - **"o chat reinicia com a colega na reunião, no navegador":**
    1. a Ana entra pelo navegador, com o passe no endereço; a Maria, de fora, é aceita;
    2. `await reiniciarOChat()`;
    3. com `expect` de até 60 s: o título "Você deixou de cuidar desta reunião" e o texto "Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app." estão à vista na página da Ana; o painel "Participantes" mostra o aviso e nenhum "Encerrar para todos";
    4. a Ana não mandou nenhum `voltar` depois do reinício, e continua com 1 ligação principal no agente; a Maria continua ouvindo a Ana;
    5. a Ana clica em "Sair" e em "Entrar de novo": a entrada de quem é de fora aparece, com a faixa "Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.";
    6. `conferirOConsole()` nas duas, aceitando o erro de rede do `401` do abrir como os vizinhos aceitam os erros esperados.

- [ ] **Step 2: Rodar e ver falhar.** `cd video-servidor/e2e && npx playwright test reinicio`. Esperado: não compila (falta o `reiniciarOChat`).
- [ ] **Step 3: O `reiniciarOChat` e o `ambiente.ts`,** como descrito acima.
- [ ] **Step 4: Rodar os dois, e depois a prova de ponta a ponta inteira** (na fila da máquina, em segundo plano). Esperado: 57 testes passam. O teste dos registros, que roda depois, continua passando com o `chat.log` das duas partidas.
- [ ] **Step 5: Se um dos dois testes mostrar um defeito do servidor ou da página,** ele vai ao relatório com o que foi visto (as mensagens do canal, o registro do chat sem segredos), e não é contornado no teste.
- [ ] **Step 6: Commit.** `test(e2e): o chat reinicia com a colega na reunião`

### Task 10: Os documentos

**Files:**
- Modify: `docs/chat-protocolo.md` (as seções 9, 10 e 11), `docs/superpowers/specs/2026-11-23-starsonic-phone-reunioes-etapa-2a-design.md` (as notas datadas), `docs/chat-servidor.md`, `docs/teste-manual.md` (a seção 30)

- [ ] **Step 1: O protocolo,** na seção 10:
  - o abrir: o campo `partida` no exemplo do `200` e uma linha dizendo o que ele é (43 caracteres base64url, sorteado quando o servidor sobe, igual em todas as respostas até ele reiniciar) e para que a página o usa;
  - a chave do colega e "A chave de volta": o que a página faz quando o abrir de um `voltar` traz outra partida (não manda o `voltar`; quem é de fora segue na reunião sem o canal; o colega no navegador deixa de cuidar, com o aviso; o colega dentro do app pede outro passe com o `pronta`, abre com ele, manda o `entrar` e troca a ligação), e que a página não desiste de voltar ao chat (as três tentativas e, depois, uma a cada 30 s);
  - o canal do colega: a mensagem `feito` nos exemplos e na lista (passam a ser quatro do servidor para a página), e a frase "Quando dão certo, não têm resposta" trocada pela regra nova (o `aceitar`, o `recusar` e o `tirar` respondem `feito`; o `encerrar` não);
  - "A resposta que a página não consegue mandar": os botões desligados sem o canal, e o aviso de quem deixou de cuidar;
  - a tabela das mensagens do app: o `pronta` também no meio da reunião, quando o chat reinicia; e o app responde a todo `pronta` com um passe novo;
  - "Os `aparelhos`": a regra da Task 2, no lugar da mensagem ignorada inteira;
  - "Quando a página obedece": a pausa e o bloqueio que chegam com a página entrando (a Task 8).
  Na seção 9, a linha "Depois de o servidor do chat reiniciar" aponta para a seção 10. Na seção 11, a nota de 23/11 passa a dizer que a seção 10 traz a regra.
- [ ] **Step 2: A spec.** Uma nota datada de 24/11 ("o plano dos acertos") no item 3 da seção 12.1, com o que este plano decidiu (as escolhas 1 a 8, em uma linha cada), uma linha na 7.3 para o `feito`, e, na 7.5, a nota de 24/11 dos aparelhos passa a dizer "construída". Nada do que o responsável aprovou é reescrito.
- [ ] **Step 3: O guia do servidor** (`docs/chat-servidor.md`): um parágrafo, onde ele fala de atualizar ou reiniciar o chat, dizendo o que as pessoas em reunião veem: quem é de fora não vê nada; o colega no app some e volta em alguns segundos; o colega no navegador vê o aviso e tem de sair e abrir de novo pelo app.
- [ ] **Step 4: O roteiro** (`docs/teste-manual.md`, a seção 30): as linhas novas para reiniciar o chat com uma reunião acontecendo (no navegador já; dentro do app, com o app `0.5.0`), para o aviso, e para os botões desligados com a rede do PC cortada por alguns segundos.
- [ ] **Step 5: Rodar o que confere os textos.** `python3 build/check_source_text.py` e `env -u GITHUB_ACTIONS python3 -m unittest discover -s tests/python`. Esperado: tudo passa.
- [ ] **Step 6: Commit.** `docs: o chat que reinicia, a partida e o feito no protocolo`
