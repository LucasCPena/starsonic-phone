// O chat durante a ligação (video etapa 2, Task 8; spec do vídeo, 4.4; os quadros ConversaNaLigacao,
// ConversaNaLigacaoEscura e GrandeChat), contra o servidor do chat de teste e a ponte falsa: o Chat da tela da ligação,
// numa ligação com um colega do chat, abre a conversa com ele embaixo da faixa da ligação (o tempo, o Mudo, a Câmera, o
// Desligar e o Voltar para a ligação), sem o Ligar e o Ligar com vídeo do alto, e o servidor fica com uma conversa a dois
// só; a mensagem vai durante a ligação; a sua imagem na faixa com a câmera ligada (Review Focus 2); a ligação só de voz;
// nenhum Chat com um número de fora do chat ou com quem saiu dele; nenhum Chat, e nenhum aviso, com o chat fora ou com
// a busca dos colegas que falha (Review Focus 5); o fim da ligação com a conversa na tela (ela fica, com o que estava
// escrito) e sem ela (o Teclado); o clique duplo no Desligar da faixa (o segundo clique cai no Ligar da conversa, e não
// liga de volta); a segunda ligação que toca (a tela da ligação volta, com o cartão dela); o painel de 360 do grande; o
// Esc da tela cheia com a foto da conversa aberta; os três tamanhos; e a acessibilidade e o tema do app nos dois temas.
// Cada teste cria a própria empresa.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { comandos, esperarComando, estado, mudarEstado, semViolacoesSerias, vezes } from '../helpers';
import { corNoMeio, perto, quadro, VERMELHO } from '../video/video';
import { abrirNoChat, esperarOsEventos } from './abrir';
import { baseDoChat, empresaComPessoas, tirarPessoa } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };
/** A ligação com vídeo: a imagem da Ana chegando e a sua câmera ligada. */
const COM_VIDEO = { oferece: true, ativo: true, imagem: true, camera: true };
/** O GET dos colegas (a busca do colega da ligação, quando a lista não tem a conversa a dois com ele). */
const COLEGAS = `${baseDoChat()}/api/v1/pessoas`;
/** Um PNG de 1×1 (o servidor trata image/png como foto). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const RGB_DO_VERMELHO = [255, 1, 0];
/** Os três tamanhos da janela e o layout de cada um (layout.ts). */
const TAMANHOS: Array<[number, number, string]> = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
];

type Video = Partial<typeof SEM_VIDEO>;

/** Uma ligação só, recebida e atendida há 5 s (o id 51, a não ser outro), sem vídeo, a não ser o que vier em `video`. */
function ligacao(numero: string, nome: string, video: Video = {}, id = 51): Record<string, unknown> {
  return {
    top: {
      id,
      number: numero,
      name: nome,
      incoming: true,
      phase: 'active',
      activeSinceMs: Date.now() - 5_000,
      held: false,
      video: { ...SEM_VIDEO, ...video },
    },
    second: null,
    secondKind: 'none',
    muted: false,
    conference: false,
    conferenceSinceMs: 0,
    consulting: false,
    colleagueActive: false,
  };
}

/** A ligação chega (o estado do C++ de mentira com ela, e o `extra` por cima); com `null`, ela acaba. */
const chegaALigacao = (page: Page, l: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
  mudarEstado(page, (s) => ({ ...s, ...extra, ligacao: l }));

/** O vídeo da ligação de cima muda. */
const videoDaDeCima = (page: Page, video: Video) =>
  mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ...video } } } }));

const botao = (onde: Page | Locator, nome: string) => onde.getByRole('button', { name: nome, exact: true });
const faixa = (page: Page) => page.locator('.faixa-ligacao');
const topoDaConversa = (page: Page) => page.locator('.conversa-topo');
const conversaComAAna = (page: Page) => page.getByRole('log', { name: 'Mensagens com Ana Souza' });
const campoParaAAna = (page: Page) => page.getByRole('textbox', { name: 'Mensagem para Ana Souza' });
const telaDaLigacao = (page: Page) => page.getByRole('main', { name: 'Ligação' });
const remotoDaAna = (onde: Page | Locator) => onde.getByRole('img', { name: 'Vídeo de Ana Souza', exact: true });
const suaImagem = (onde: Page | Locator) => onde.getByRole('img', { name: 'Sua imagem', exact: true });
/** Um instante da página (o que acabou de chegar já foi tratado). */
const umInstante = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

async function caixa(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function quase(valor: number, esperado: number, msg: string): void {
  expect(Math.abs(valor - esperado), `${msg}: ${valor} perto de ${esperado}`).toBeLessThanOrEqual(1);
}

/** A empresa com a Recepção e a Ana, e o app da Recepção aberto, com os eventos do chat no ar (a situação `pronto`). */
async function prontoNoChat(page: Page) {
  const empresa = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  await abrirNoChat(page, { chave: empresa.pessoas[0].chave, ...RECEPCAO });
  await esperarOsEventos(page);
  return empresa;
}

/** Da tela da ligação, o Chat: a conversa com a Ana abre embaixo da faixa. */
async function abrirOChat(page: Page): Promise<void> {
  await botao(page, 'Chat').click();
  await expect(conversaComAAna(page)).toBeVisible();
  await expect(faixa(page)).toBeVisible();
}

/** Guarda o texto de todo toast que aparecer na página daqui em diante (Review Focus 5: nenhum). */
async function vigiarOsToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const ver = () => {
      for (const t of document.querySelectorAll('.toast-box')) w.__toasts.push(t.textContent ?? '');
    };
    ver();
    new MutationObserver(ver).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

const toastsVistos = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

/** As conversas a dois da pessoa no servidor. */
async function duplas(api: { conversas(): Promise<any[]> }): Promise<number[]> {
  return (await api.conversas()).filter((c) => c.tipo === 'dupla').map((c) => c.id);
}

test('the Chat button opens the conversation with the colleague under the call strip', async ({ page }) => {
  const { pessoas } = await prontoNoChat(page);
  const [a, ana] = pessoas;
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO));

  // Os controles de uma ligação: o Chat depois da Câmera, em cinco colunas.
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Chat', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-5(\s|$)/);
  await abrirOChat(page);
  await expect(page.getByRole('heading', { name: 'Ana Souza', level: 1 })).toBeVisible();
  await expect(campoParaAAna(page)).toBeFocused();
  await expect(telaDaLigacao(page)).toHaveCount(0);

  // Em cima, a faixa: o tempo, o Voltar para a ligação, o Mudo, a Câmera e o Desligar.
  const f = faixa(page);
  await expect(f.getByText(/^Em ligação · 00:\d\d$/)).toBeVisible();
  await expect(botao(f, 'Voltar para a ligação')).toBeVisible();
  await expect(botao(f, 'Mudo')).toHaveAttribute('aria-pressed', 'false');
  await expect(botao(f, 'Desligar a câmera')).toBeEnabled();
  await expect(botao(f, 'Desligar')).toBeVisible();
  expect((await caixa(f)).y + (await caixa(f)).height).toBeLessThanOrEqual((await caixa(topoDaConversa(page))).y + 0.5);
  // O alto da conversa, sem o Ligar e o Ligar com vídeo; o Voltar dela volta para a ligação.
  await expect(page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ligar com vídeo para Ana Souza, ramal 2003' })).toHaveCount(0);
  await expect(botao(topoDaConversa(page), 'Voltar para a ligação')).toHaveAttribute('title', 'Voltar para a ligação');

  // O Mudo e a Câmera da faixa mandam os comandos da ligação, e a faixa acompanha.
  await botao(f, 'Mudo').click();
  await esperarComando(page, { cmd: 'mute', on: true });
  await expect(botao(f, 'Mudo')).toHaveAttribute('aria-pressed', 'true');
  await botao(f, 'Desligar a câmera').click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(botao(f, 'Ligar a câmera')).toBeEnabled();
  await expect(suaImagem(f)).toHaveCount(0);

  await botao(topoDaConversa(page), 'Voltar para a ligação').click();
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(conversaComAAna(page)).toHaveCount(0);
  await expect(faixa(page)).toHaveCount(0);
  // De novo, a mesma conversa; o Voltar para a ligação da faixa também volta.
  await abrirOChat(page);
  await botao(faixa(page), 'Voltar para a ligação').click();
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(conversaComAAna(page)).toHaveCount(0);

  // No servidor, uma conversa a dois só, a mesma para as duas pessoas.
  const daRecepcao = await duplas(a.api);
  expect(daRecepcao).toHaveLength(1);
  expect(await duplas(ana.api)).toEqual(daRecepcao);
});

test('a message goes in the conversation during the call', async ({ page }) => {
  const { pessoas } = await prontoNoChat(page);
  const [, ana] = pessoas;
  await chegaALigacao(page, ligacao('2003', 'Ana Souza'));
  await abrirOChat(page);
  await campoParaAAna(page).fill('Já te mando o pedido.');
  await campoParaAAna(page).press('Enter');
  await expect(conversaComAAna(page).locator('.balao-meu .balao-texto')).toHaveText(['Já te mando o pedido.']);
  const [dupla] = await duplas(ana.api);
  await expect.poll(async () => (await ana.api.mensagens(dupla)).map((m) => m.texto)).toEqual(['Já te mando o pedido.']);
  // A faixa continua em cima.
  await expect(faixa(page)).toBeVisible();
});

test('the call strip shows your image with the camera on', async ({ page }) => {
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO));
  await abrirOChat(page);
  const f = faixa(page);

  // A imagem da Ana, 64×48, com a sua dentro dela.
  const remoto = remotoDaAna(f);
  const sua = suaImagem(f);
  await expect(remoto).toBeVisible();
  await expect(sua).toBeVisible();
  const r = await caixa(remoto);
  const s = await caixa(sua);
  quase(r.width, 64, 'a largura da miniatura');
  quase(r.height, 48, 'a altura da miniatura');
  expect(s.x >= r.x && s.y >= r.y && s.x + s.width <= r.x + r.width && s.y + s.height <= r.y + r.height, JSON.stringify({ r, s })).toBe(true);
  expect(s.width).toBeLessThan(r.width);
  await expect(f.getByText(/^Em ligação · 00:\d\d$/)).toBeVisible();
  // A sua imagem desenha a câmera.
  await quadro(page, 'local', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, sua), RGB_DO_VERMELHO)).toBe(true);

  // Sem a imagem da Ana, com a câmera ligada: a miniatura é só a sua imagem.
  await videoDaDeCima(page, { ativo: true, camera: true });
  await expect(remotoDaAna(f)).toHaveCount(0);
  await expect(suaImagem(f)).toBeVisible();
  const so = await caixa(suaImagem(f));
  quase(so.width, 64, 'a largura da sua imagem');
  quase(so.height, 48, 'a altura da sua imagem');
  await expect(f.getByText(/^Em ligação · 00:\d\d$/)).toBeVisible();

  // Sem nenhuma das duas: nenhuma miniatura, e o nome no lugar do "Em ligação".
  await videoDaDeCima(page, {});
  await expect(f.getByRole('img')).toHaveCount(0);
  await expect(f.getByText(/^Ana Souza · 00:\d\d$/)).toBeVisible();
});

test('a voice call also has the Chat button, and the strip shows the name and the time', async ({ page }) => {
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza'));
  await expect(botao(page, 'Chat')).toBeVisible();
  await abrirOChat(page);
  const f = faixa(page);
  await expect(f.getByText(/^Ana Souza · 00:\d\d$/)).toBeVisible();
  await expect(f.getByRole('img')).toHaveCount(0);
  // Atendida e sem a câmera: a Câmera liga.
  await expect(botao(f, 'Ligar a câmera')).toBeEnabled();
  await botao(f, 'Ligar a câmera').click();
  await esperarComando(page, { cmd: 'camera', on: true });
  await expect(suaImagem(f)).toBeVisible();
  await expect(f.getByText(/^Em ligação · 00:\d\d$/)).toBeVisible();
});

test('no Chat button for a number outside the chat or a colleague who left', async ({ page }) => {
  const pedidos: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url() === COLEGAS) pedidos.push(r.url());
  });
  const { empresaId, pessoas } = await prontoNoChat(page);
  const [, ana] = pessoas;

  // A Ana no chat: o Chat aparece (sem a conversa a dois na lista, os colegas vêm do servidor, uma vez).
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', {}, 61));
  await expect(botao(page, 'Chat')).toBeVisible();
  expect(pedidos).toHaveLength(1);
  await chegaALigacao(page, null);
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();

  // O porteiro (1050), fora do chat: os colegas de novo (outra ligação), e nenhum Chat.
  const doPorteiro = page.waitForResponse(COLEGAS);
  await chegaALigacao(page, ligacao('1050', 'Portaria', {}, 62));
  await doPorteiro;
  await umInstante(page);
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(botao(page, 'Chat')).toHaveCount(0);
  // A mesma ligação não pede os colegas de novo.
  await botao(page, 'Mudo').click();
  await esperarComando(page, { cmd: 'mute', on: true });
  await umInstante(page);
  expect(pedidos).toHaveLength(2);
  await chegaALigacao(page, null);
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();

  // A Ana fora do chat: nenhum Chat na ligação com ela.
  await tirarPessoa(empresaId, ana.pessoa.id);
  const semAAna = page.waitForResponse(COLEGAS);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', {}, 63));
  await semAAna;
  await umInstante(page);
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(botao(page, 'Chat')).toHaveCount(0);
  expect(pedidos).toHaveLength(3);
});

test('the Chat button stays away while the chat is not ready or the lookup fails, without a toast', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a] = pessoas;

  // O computador fora do chat.
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO, cenario: 'chat-desligado' });
  await vigiarOsToasts(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza'));
  await expect(botao(page, 'Mudo')).toBeVisible();
  await umInstante(page);
  await expect(botao(page, 'Chat')).toHaveCount(0);
  await botao(page, 'Mudo').click();
  await esperarComando(page, { cmd: 'mute', on: true });
  await expect(botao(page, 'Mudo')).toHaveAttribute('aria-pressed', 'true');
  expect(await toastsVistos(page)).toEqual([]);

  // O chat pronto, sem a conversa a dois, e a busca dos colegas que não chega.
  let pedidos = 0;
  await page.route('**/api/v1/pessoas', (rota) => {
    pedidos += 1;
    return rota.abort();
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await vigiarOsToasts(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza'));
  await expect.poll(() => pedidos).toBe(1);
  await umInstante(page);
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(botao(page, 'Chat')).toHaveCount(0);
  await botao(page, 'Mudo').click();
  await esperarComando(page, { cmd: 'mute', on: true });
  await expect(botao(page, 'Mudo')).toHaveAttribute('aria-pressed', 'true');
  await umInstante(page);
  // Uma vez só, sem aviso nenhum.
  expect(pedidos).toBe(1);
  expect(await toastsVistos(page)).toEqual([]);
});

test('at the end of the call the conversation stays; from the call screen it goes to the keypad', async ({ page }) => {
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO, 71));
  await abrirOChat(page);
  // O que estava escrito fica: a conversa é a mesma, no mesmo lugar.
  await campoParaAAna(page).fill('Até daqui a pouco.');

  await botao(faixa(page), 'Desligar').click();
  await esperarComando(page, { cmd: 'hangup', id: 71 });
  await expect(faixa(page)).toHaveCount(0);
  await expect(conversaComAAna(page)).toBeVisible();
  await expect(campoParaAAna(page)).toHaveValue('Até daqui a pouco.');
  // A conversa de sempre: o Voltar para as conversas e o Ligar.
  await expect(botao(page, 'Voltar para as conversas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' })).toBeVisible();
  await umInstante(page);
  await expect(conversaComAAna(page)).toBeVisible();
  await expect(campoParaAAna(page)).toHaveValue('Até daqui a pouco.');
  // O Voltar vai para a aba Chat.
  await botao(page, 'Voltar para as conversas').click();
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();

  // Sem a conversa na tela: o fim volta para o Teclado. Também depois de a conversa abrir e a pessoa voltar à ligação.
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', {}, 72));
  await abrirOChat(page);
  await botao(faixa(page), 'Voltar para a ligação').click();
  await expect(telaDaLigacao(page)).toBeVisible();
  await botao(page, 'Desligar').click();
  await esperarComando(page, { cmd: 'hangup', id: 72 });
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();
  await expect(conversaComAAna(page)).toHaveCount(0);
});

test('a double click on the strip Desligar hangs up once and never calls the colleague back', async ({ page }) => {
  await prontoNoChat(page);
  for (const [id, video] of [
    [91, COM_VIDEO],
    [92, {}],
  ] as const) {
    const onde = `a ligação ${id}`;
    await chegaALigacao(page, ligacao('2003', 'Ana Souza', video, id));
    await abrirOChat(page);
    // O clique duplo do softphone de mesa: o primeiro clique acaba a ligação, e a conversa fica, sem a faixa; o segundo
    // (o `detail` 2), no mesmo ponto, cai no Ligar do alto da conversa. Aqui ele vem depois de a ligação acabar na tela
    // (o núcleo pode responder antes do segundo clique): só o segundo par do clique duplo, com o clickCount 2.
    const d = await caixa(botao(faixa(page), 'Desligar'));
    const ponto = { x: d.x + d.width / 2, y: d.y + d.height / 2 };
    await page.mouse.click(ponto.x, ponto.y);
    await esperarComando(page, { cmd: 'hangup', id });
    await expect(faixa(page), onde).toHaveCount(0);
    const ligar = await caixa(page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' }));
    const embaixo = ponto.x > ligar.x && ponto.x < ligar.x + ligar.width && ponto.y > ligar.y && ponto.y < ligar.y + ligar.height;
    expect(embaixo, `o Ligar (${JSON.stringify(ligar)}) embaixo do Desligar (${JSON.stringify(ponto)}) em ${onde}`).toBe(true);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await umInstante(page);
    expect(await vezes(page, { cmd: 'hangup', id }), onde).toBe(1);
    expect((await comandos(page)).filter((c) => c.cmd === 'dial'), onde).toEqual([]);
    await expect(conversaComAAna(page), onde).toBeVisible();
  }
  // Fora disso, um clique duplo no Ligar da conversa liga uma vez só.
  await page.getByRole('button', { name: 'Ligar para Ana Souza, ramal 2003' }).dblclick();
  await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
  await umInstante(page);
  expect(await vezes(page, { cmd: 'dial', numero: '2003', contato: true })).toBe(1);
});

test('a second call brings back the call screen with its card, and the conversation comes back after it', async ({ page }) => {
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', {}, 81));
  await abrirOChat(page);

  // O Carlos chama: a tela da ligação volta, com o cartão dele (o Recusar e o Atender), e o Chat espera.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      second: { id: 82, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: SEM_VIDEO },
      secondKind: 'ringing',
    },
  }));
  const cartao = page.getByRole('alert').filter({ hasText: 'Ligação de Carlos Lima' });
  await expect(cartao).toBeVisible();
  await expect(conversaComAAna(page)).toHaveCount(0);
  await expect(botao(page, 'Chat')).toBeDisabled();
  await botao(cartao, 'Recusar').click();
  await esperarComando(page, { cmd: 'reject' });
  // Ele saiu: a conversa da ligação volta, com a faixa.
  await expect(conversaComAAna(page)).toBeVisible();
  await expect(faixa(page)).toBeVisible();

  // A de cima que muda (o Carlos atendido, a Ana em espera) fecha a conversa da ligação: ela não volta com a Ana.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      top: { id: 83, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'active', activeSinceMs: Date.now(), held: false, video: SEM_VIDEO },
      second: { ...s.ligacao.top, held: true },
      secondKind: 'held',
    },
  }));
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(botao(page, 'Chat')).toHaveCount(0);
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.second, held: false }, second: null, secondKind: 'none' } }));
  await expect(botao(page, 'Chat')).toBeVisible();
  await umInstante(page);
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(conversaComAAna(page)).toHaveCount(0);
});

test('in the big window the conversation opens at the right, 360 wide', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO), { video: { ...(await estado(page)).video, janela: 'grande' } });
  const barraDeBaixo = page.locator('.grande-barra');
  const chat = botao(barraDeBaixo, 'Chat');
  await expect(chat).toHaveAttribute('aria-pressed', 'false');
  await expect(conversaComAAna(page)).toHaveCount(0);
  quase((await caixa(remotoDaAna(page))).width, 1280, 'o vídeo sem o painel');

  await chat.click();
  await expect(chat).toHaveAttribute('aria-pressed', 'true');
  await expect(conversaComAAna(page)).toBeVisible();
  const painel = page.locator('.grande-chat');
  const p = await caixa(painel);
  quase(p.width, 360, 'a largura do painel');
  quase(p.x + p.width, 1280, 'o painel à direita');
  quase(p.y + p.height, 800, 'o painel até embaixo');
  expect(p.y).toBeGreaterThanOrEqual(32 - 0.5);
  const r = await caixa(remotoDaAna(page));
  quase(r.x, 0, 'o vídeo à esquerda');
  quase(r.width, 920, 'a largura do vídeo');
  // A sua imagem continua à vista, ao lado do painel (Review Focus 2); a barra de baixo, embaixo do vídeo.
  const s = await caixa(suaImagem(page));
  expect(s.x + s.width).toBeLessThanOrEqual(920 + 0.5);
  const b = await caixa(barraDeBaixo);
  expect(b.x + b.width).toBeLessThanOrEqual(920 + 0.5);
  // O painel no tema do app (o claro): a minha mensagem em blue, o lugar de escrever em branco.
  await campoParaAAna(page).fill('Te vejo na reunião.');
  await campoParaAAna(page).press('Enter');
  await expect(painel.locator('.balao-meu .balao-texto')).toHaveCSS('background-color', 'rgb(12, 38, 113)');
  await expect(painel.locator('.escrever')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  // Sem o Ligar do alto; o Voltar dele fecha o painel, e o Chat o abre e fecha.
  await expect(page.getByRole('button', { name: /^Ligar/ })).toHaveCount(0);
  await botao(painel, 'Voltar para a ligação').click();
  await expect(painel).toHaveCount(0);
  await expect(chat).toHaveAttribute('aria-pressed', 'false');
  quase((await caixa(remotoDaAna(page))).width, 1280, 'o vídeo sem o painel');
  await chat.click();
  await expect(painel).toBeVisible();
  await chat.click();
  await expect(painel).toHaveCount(0);
});

test('in the full screen, Esc closes the photo of the conversation and keeps the full screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarArquivo(dupla, PNG, 'Vitrine da loja.png', 'image/png');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO), { video: { ...(await estado(page)).video, janela: 'telaCheia' } });
  await botao(page.locator('.grande-barra'), 'Chat').click();
  await conversaComAAna(page).getByRole('button', { name: 'Abrir a foto Vitrine da loja.png' }).click();
  const foto = page.getByRole('dialog');
  await expect(foto).toBeVisible();

  // O Esc fecha a foto, e a tela cheia fica.
  await page.keyboard.press('Escape');
  await expect(foto).toHaveCount(0);
  await umInstante(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(0);
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  // Sem a foto, o Esc sai da tela cheia.
  await page.keyboard.press('Escape');
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
});

test('the call screen with the Chat and the strip fit the three sizes', async ({ page }) => {
  await prontoNoChat(page);
  await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO));
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await expect(page.locator('.win')).toHaveAttribute('data-layout', layout);
    // A tela da ligação: os nove controles em cinco colunas, cada botão inteiro na janela, e nada rola.
    await expect(page.locator('.ctrls'), onde).toHaveClass(/(^|\s)ctrls-5(\s|$)/);
    await dentroDaJanela(page.locator('main.call-body button'), largura, altura, onde);
    await semRolar(page, onde);
    const sobram = await page
      .locator('.ctrls button.ctrl')
      .evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => b.textContent?.trim()));
    expect(sobram, `rótulos maiores que a coluna em ${onde}`).toEqual([]);

    // A faixa: os botões inteiros na janela, e o "Em ligação", o tempo e o Voltar para a ligação inteiros.
    await abrirOChat(page);
    const f = faixa(page);
    await dentroDaJanela(f.locator('button'), largura, altura, onde);
    await semRolar(page, onde);
    const cortados = await f
      .locator('.faixa-nome, .faixa-tempo, .faixa-voltar')
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 0.5 || e.getBoundingClientRect().width < 1).map((e) => e.textContent));
    expect(cortados, `cortados na faixa em ${onde}`).toEqual([]);
    const tempo = await caixa(f.locator('.faixa-tempo'));
    expect(tempo.x + tempo.width, `o tempo fora da faixa em ${onde}`).toBeLessThanOrEqual((await caixa(f.locator('.faixa-botoes'))).x + 0.5);
    await botao(f, 'Voltar para a ligação').click();
    await expect(telaDaLigacao(page)).toBeVisible();
  }
});

/** Cada um dos alvos inteiro na janela. */
async function dentroDaJanela(alvos: Locator, largura: number, altura: number, onde: string): Promise<void> {
  const n = await alvos.count();
  expect(n, `os botões em ${onde}`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = await caixa(alvos.nth(i));
    const nome = (await alvos.nth(i).getAttribute('aria-label')) ?? (await alvos.nth(i).innerText());
    const dentro = b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5;
    expect(dentro, `${nome} fora da janela de ${onde}: ${JSON.stringify(b)}`).toBe(true);
  }
}

/** A página não rola, nem para o lado. */
async function semRolar(page: Page, onde: string): Promise<void> {
  const sobra = await page.evaluate(() => ({
    altura: document.scrollingElement!.scrollHeight - innerHeight,
    largura: document.scrollingElement!.scrollWidth - innerWidth,
  }));
  expect(sobra, `a página rola em ${onde}`).toEqual({ altura: 0, largura: 0 });
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o chat na ligação (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the conversation in the call has no serious accessibility violations and keeps the app theme', async ({ page }) => {
      const { pessoas } = await prontoNoChat(page);
      const [a, ana] = pessoas;
      const dupla = await ana.api.criarDupla(a.pessoa.id);
      await ana.api.enviarTexto(dupla, 'Te liguei por causa do pedido.');
      await a.api.enviarTexto(dupla, 'Já te atendo.');
      const minha = (onde: Page | Locator) => onde.locator('.balao-meu .balao-texto');
      const azulOuCiano = tema === 'light' ? 'rgb(12, 38, 113)' : 'rgb(0, 194, 203)';

      // Na janela normal: a faixa e a conversa.
      await chegaALigacao(page, ligacao('2003', 'Ana Souza', COM_VIDEO));
      await abrirOChat(page);
      await expect(minha(page)).toHaveCSS('background-color', azulOuCiano);
      await semViolacoesSerias(page);
      await botao(faixa(page), 'Voltar para a ligação').click();

      // No grande: o painel, também no tema do app.
      await page.setViewportSize({ width: 1280, height: 800 });
      await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, janela: 'grande' } }));
      await botao(page.locator('.grande-barra'), 'Chat').click();
      const painel = page.locator('.grande-chat');
      await expect(minha(painel)).toHaveCSS('background-color', azulOuCiano);
      await expect(painel.locator('.escrever')).toHaveCSS('background-color', tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(10, 19, 48)');
      await semViolacoesSerias(page);
    });
  });
}
