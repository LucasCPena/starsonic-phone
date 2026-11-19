# Reuniões com link, etapa 1b — a página no navegador — esboço do plano

Este é o esboço. O plano inteiro é escrito depois que o quadro da página for aprovado, com as medidas e os textos dele.

**Antes de escrever o plano:**
- o quadro "Starsonic — reunião no navegador" (spec 4.1), feito pelo controlador e aprovado pelo responsável, com:
  - a entrada: o nome, a câmera para conferir, o microfone, a câmera e o "Pedir para entrar", e, no PC, o "Abrir no app" com o "Entrar pelo navegador" ao lado;
  - a espera;
  - a reunião;
  - os avisos da spec 10;
  - no PC e no celular;
- a etapa 1a terminada na branch `reunioes-etapa-1`, com a revisão final.

**O que a 1b usa da 1a, sem mudar:**
- o abrir, o bilhete e o canal da página (`docs/chat-protocolo.md`, seção 10);
- o `wss`, a `uri`, a senha, o TURN e as regras da ligação (`docs/video-agente.md`, seção 6): o cabeçalho `X-Starsonic-Senha`, o som que manda sempre, e a segunda ligação da tela;
- o JsSIP 3.13.8, o mesmo do cliente mínimo do e2e;
- o job `ponta-a-ponta` do `video.yml`.

**As escolhas que o plano da 1b vai fazer** (com o padrão sugerido):
1. **A pilha da página:** TypeScript 5.9.3, Preact 10.29.8 e esbuild 0.28.2, como o `windows/ui`, em `chat-servidor/pagina/`.
   - O `dist/` vai embutido no binário do chat pelo `embed`. Para o `go build` não pedir o Node, o `dist/` entra no repositório, e o `chat.yml` confere que ele bate com as fontes (`npm run build` e depois `git diff --exit-code`).
   - As licenças do Preact e do JsSIP (MIT) vão junto, numa rota de estáticos.
2. **A câmera desligada:** o `track.enabled = false` (o quadro preto, com o nome), ou uma nova negociação só para receber (o quadro liso de `#1B2333` da 1a). O padrão é o que o quadro mostrar.
3. **O "Abrir no app":** aparece só no navegador do PC. O endereço `starsonic://` é registrado pelo instalador do app na etapa 2; até lá, o botão só abre o endereço, e o "Entrar pelo navegador" segue.
4. **A senha vencida:** a página pede outra uma vez (spec 11.1, item 4). Na segunda falha, ela mostra "O servidor de reuniões não respondeu".

## As tarefas (uma linha cada)
1. **A página no chat:** o projeto `chat-servidor/pagina/`, o `dist/` embutido, a rota `GET /r/{codigo}` com a CSP sem nada inline (e o `connect-src` com o `wss` do vídeo), os estáticos, e o `chat.yml` e o `chat-release.yml` conferindo o `dist/`.
2. **A entrada:** o nome (com a regra do nome de uma pessoa), a prévia da câmera, os botões do microfone e da câmera, o "Pedir para entrar", e o "Abrir no app" com o "Entrar pelo navegador" no PC.
3. **A espera e os avisos:**
   - "Aguardando ser aceito…" e "Desistir";
   - "A reunião ainda não começou", "A reunião está cheia", "O servidor de reuniões está cheio agora", "Este link não vale mais", "Não foi possível entrar" e "O servidor de reuniões não respondeu";
   - "Sem acesso à câmera ou ao microfone: libere no navegador".
4. **A reunião:**
   - a ligação pelo JsSIP, com o TURN do acesso, o mosaico em tela cheia e os botões Microfone, Câmera e Sair;
   - o silêncio gerado quando falta o microfone, e só ver e ouvir sem câmera nem microfone (spec 11.1, item 2);
   - a senha vencida pedida de novo uma vez;
   - o `tirado` e o `encerrada`.
5. **A tela compartilhada,** só no navegador do PC:
   - o `getDisplayMedia` e a segunda ligação com o silêncio no som;
   - "Compartilhar a tela" e "Parar de compartilhar";
   - a tela que outra pessoa tomou, que volta o botão ao começo.
6. **Os testes da página** (Playwright, contra o chat de verdade em modo de teste e um agente de mentira):
   - cada estado do quadro e cada aviso;
   - o axe;
   - as fotos nos tamanhos do PC e do celular aprovados no quadro.
7. **A página de ponta a ponta:** as cenas da Task 15 da 1a refeitas pela página, no job `ponta-a-ponta`:
   - dois navegadores, a sala de espera e o recusado;
   - a tela, com um `getDisplayMedia` falso que devolve um canvas;
   - o tirar e o Encerrar para todos.
8. **O guia, o roteiro e as notas:**
   - a reunião de teste pelo navegador no `docs/video-servidor.md`;
   - o roteiro de teste manual da etapa 1 (`docs/teste-manual-reunioes.md`, spec 11.3):
     - a instalação das duas VMs;
     - a reunião de teste no PC, num Android e num iPhone, pelo Safari (spec 13, o risco 3);
     - a tela compartilhada;
     - dez pessoas, olhando a CPU no cartão "Reuniões";
     - uma rede sem UDP, pelo TURN na 5349;
   - as notas do chat 0.2.0 e do servidor de vídeo 0.1.0.
