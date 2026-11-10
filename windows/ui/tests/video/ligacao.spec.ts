// A tela da ligação com vídeo (video etapa 2, Task 4; os quadros Video, VideoCompacto, VideoMinimo, VozComCamera e
// Avisos) contra a ponte falsa: a imagem da outra ponta grande, a sua no canto e o Abrir grande; a Câmera e a regra dela;
// a ligação só de voz com a sua imagem; o vídeo que pausa com duas ligações, com a segunda tocando e no iPhone; a vista
// que nunca mostra um quadro da ligação de antes (Review Focus 1); a sua imagem à vista com todo painel (Review Focus 2);
// a janela redimensionada (Review Focus 4); os três tamanhos; e os avisos do vídeo, que ficam 5 s.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AVISOS_DE_5_S } from '../../src/video/textos';
import { abrir, empurrar, esperarComando, mudarEstado, semViolacoesSerias } from '../helpers';
import { BRANCO, FUNDO, VERMELHO, corNoMeio, perto, quadro } from './video';

const RGB_DO_VERMELHO = [255, 1, 0];
const RGB_DO_BRANCO = [255, 255, 255];
const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };

type Caixa = { x: number; y: number; width: number; height: number };

const remoto = (page: Page, nome = 'Ana Souza') => page.getByRole('img', { name: `Vídeo de ${nome}`, exact: true });
const qualquerRemoto = (page: Page) => page.getByRole('img', { name: /^Vídeo de / });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
/** O controle com o rótulo Câmera: o nome dele diz a ação (Ligar a câmera ou Desligar a câmera). */
const camera = (page: Page) => page.locator('.ctrls button.ctrl').filter({ hasText: /^Câmera$/ });
const qualquerCamera = (page: Page) => page.getByRole('button', { name: /câmera/i });

/** O Carlos (o id 12), em andamento há 41 s e sem vídeo, a não ser o que vier em `extra`. */
function carlos(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12,
    number: '2007',
    name: 'Carlos Lima',
    incoming: false,
    phase: 'active',
    activeSinceMs: Date.now() - 41_000,
    held: false,
    video: { ...SEM_VIDEO },
    ...extra,
  };
}

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function dentro(b: Caixa, largura: number, altura: number): boolean {
  return b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5;
}

function seCruzam(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Espera a cor (perto, com a tolerância de 2) no meio do alvo; na falha, mostra a última cor lida. */
async function esperarCorNoMeio(page: Page, alvo: Locator, esperada: number[]): Promise<void> {
  await expect
    .poll(async () => {
      const cor = await corNoMeio(page, alvo);
      return perto(cor, esperada) ? esperada : cor;
    })
    .toEqual(esperada);
}

/** Espera `n` quadros de tela da página (a leitura das vistas roda a cada um). */
async function quadrosDeTela(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((pronto) => {
        const proximo = () => (--n === 0 ? pronto() : requestAnimationFrame(proximo));
        requestAnimationFrame(proximo);
      }),
    n,
  );
}

/** Cada botão da tela da ligação (os controles, o Abrir grande e o Desligar) inteiro na janela. */
async function botoesNaJanela(page: Page, largura: number, altura: number): Promise<void> {
  const botoes = page.locator('main.call-body button');
  const n = await botoes.count();
  expect(n, 'os botões da tela da ligação').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = botoes.nth(i);
    const nome = (await b.getAttribute('aria-label')) ?? (await b.innerText());
    const c = await caixa(b);
    expect(dentro(c, largura, altura), `${nome} fora da janela de ${largura}×${altura}: ${JSON.stringify(c)}`).toBe(true);
  }
}

/** A sua imagem não cobre nenhum botão nem campo da tela da ligação. */
async function semCobrirNada(page: Page, sua: Caixa): Promise<void> {
  const alvos = page.locator('main.call-body :is(button, input)');
  const n = await alvos.count();
  for (let i = 0; i < n; i++) {
    const c = await alvos.nth(i).boundingBox();
    if (!c) continue;
    const nome = (await alvos.nth(i).getAttribute('aria-label')) ?? (await alvos.nth(i).innerText());
    expect(seCruzam(sua, c), `a sua imagem cobre ${nome}: ${JSON.stringify({ sua, c })}`).toBe(false);
  }
}

test('the video call shows the other side big, your image in the corner and Abrir grande', async ({ page }) => {
  await abrir(page, 'video');
  const area = remoto(page);
  const sua = suaImagem(page);
  await expect(area).toBeVisible();
  await expect(sua).toBeVisible();
  // A sua imagem dentro do retângulo da outra ponta, embaixo à direita, a 10 da borda, 96×72.
  const a = await caixa(area);
  const s = await caixa(sua);
  expect(s.x >= a.x && s.y >= a.y && s.x + s.width <= a.x + a.width && s.y + s.height <= a.y + a.height, JSON.stringify({ a, s })).toBe(true);
  expect(Math.abs(a.x + a.width - (s.x + s.width) - 10), JSON.stringify({ a, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y + a.height - (s.y + s.height) - 10), JSON.stringify({ a, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(s.width - 96)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.height - 72)).toBeLessThanOrEqual(1);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local', 'remoto'] });

  await quadro(page, 'remoto', VERMELHO);
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  // Quem fala, embaixo da imagem: o nome e o ramal com o tempo.
  await expect(page.getByText('Ana Souza', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Ramal 2003 · 03:1\d$/)).toBeVisible();
  expect((await caixa(page.getByText('Ana Souza', { exact: true }))).y).toBeGreaterThan(a.y + a.height);
  await semViolacoesSerias(page);

  // O Abrir grande em cima à direita, irmão das vistas (nunca dentro de uma imagem).
  const abrirGrande = botao(page, 'Abrir grande');
  const g = await caixa(abrirGrande);
  expect(Math.abs(a.x + a.width - (g.x + g.width) - 10), JSON.stringify({ a, g })).toBeLessThanOrEqual(1);
  expect(Math.abs(g.y - a.y - 10), JSON.stringify({ a, g })).toBeLessThanOrEqual(1);
  expect(Math.abs(g.height - 32)).toBeLessThanOrEqual(1);
  await expect(page.locator('[role="img"] button')).toHaveCount(0);
  await abrirGrande.click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
});

test('the Câmera button turns your camera off and on', async ({ page }) => {
  await abrir(page, 'video');
  // Os controles de uma ligação com o vídeo ligado, em quatro colunas (com o Chat, da Task 8, cinco).
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-4(\s|$)/);
  const c = camera(page);
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  // Acesa com a câmera ligada, sem o aria-pressed: o nome já diz a ação.
  await expect(c).toHaveClass(/(^|\s)ctrl-on(\s|$)/);
  await expect(c).not.toHaveAttribute('aria-pressed');
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).not.toHaveClass(/(^|\s)ctrl-on(\s|$)/);
  // Sem a câmera, a sua imagem sai da área do vídeo.
  await expect(suaImagem(page)).toHaveCount(0);
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: true });
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(suaImagem(page)).toBeVisible();
});

test('the Câmera button waits for the call to be answered, but can always turn the camera off', async ({ page }) => {
  await abrir(page, 'ligacao');
  const c = camera(page);
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeEnabled();
  const topo = (mudar: Record<string, unknown>) =>
    mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, ...mudar } } }));

  // Chamando, com a câmera desligada: ela só liga depois do atender.
  await topo({ phase: 'dialing', activeSinceMs: 0, video: { ...SEM_VIDEO } });
  await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
  // Chamando, com a câmera ligada (o Ligar com vídeo): ligada, ela sempre desliga.
  await topo({ phase: 'dialing', activeSinceMs: 0, video: { ...SEM_VIDEO, camera: true } });
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(c).toBeEnabled();
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  // Na espera, com a câmera desligada.
  await topo({ phase: 'active', activeSinceMs: Date.now() - 60_000, held: true, video: { ...SEM_VIDEO } });
  await expect(botao(page, 'Espera')).toHaveAttribute('aria-pressed', 'true');
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
});

test("a voice call keeps today's screen, with your image when the camera is on", async ({ page }) => {
  await abrir(page, 'video-voz-camera');
  await expect(page.locator('.avatar-lg')).toBeVisible();
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(page.getByText('Ramal 2003', { exact: true })).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  const sua = suaImagem(page);
  await expect(sua).toBeVisible();
  // A 16 do canto de cima à direita da tela da ligação, 96×72.
  const corpo = await caixa(page.locator('main.call-body'));
  const s = await caixa(sua);
  expect(Math.abs(corpo.x + corpo.width - 16 - (s.x + s.width)), JSON.stringify({ corpo, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(corpo.y + 16 - s.y), JSON.stringify({ corpo, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(s.width - 96)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.height - 72)).toBeLessThanOrEqual(1);
  await semCobrirNada(page, s);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local'] });
  await quadro(page, 'local', VERMELHO);
  await esperarCorNoMeio(page, sua, RGB_DO_VERMELHO);
  await expect(camera(page)).toHaveAccessibleName('Desligar a câmera');
  await semViolacoesSerias(page);

  await abrir(page, 'ligacao');
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(suaImagem(page)).toHaveCount(0);
  await expect(camera(page)).toHaveAccessibleName('Ligar a câmera');
});

test('with two calls there is no video and no Câmera', async ({ page }) => {
  for (const cenario of ['duas-ligacoes', 'conferencia']) {
    await abrir(page, cenario);
    await expect(botao(page, 'Mudo'), cenario).toBeVisible();
    // Mesmo com a imagem da de cima chegando.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, imagem: true } } },
    }));
    await expect(botao(page, 'Mudo'), cenario).toBeVisible();
    await expect(camera(page), cenario).toHaveCount(0);
    await expect(qualquerCamera(page), cenario).toHaveCount(0);
    await expect(qualquerRemoto(page), cenario).toHaveCount(0);
    await expect(botao(page, 'Abrir grande'), cenario).toHaveCount(0);
  }
});

test('the remote view never shows a frame of the previous call', async ({ page }) => {
  await abrir(page, 'video');
  await quadro(page, 'remoto', VERMELHO);
  await esperarCorNoMeio(page, remoto(page), RGB_DO_VERMELHO);

  // A de cima vira o Carlos, ainda sem a imagem: a área do vídeo sai.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: carlos({ video: { ...SEM_VIDEO, ativo: true } }) } }));
  await expect(page.locator('.who-name')).toHaveText('Carlos Lima');
  await expect(qualquerRemoto(page)).toHaveCount(0);

  // A imagem do Carlos começa: a área volta só com o fundo, mesmo com o vermelho da Ana ainda na memória.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: carlos({ video: { ...SEM_VIDEO, ativo: true, imagem: true } }) } }));
  const area = remoto(page, 'Carlos Lima');
  await expect(area).toBeVisible();
  await expect(area).toHaveAttribute('data-memoria');
  await quadrosDeTela(page, 10);
  const agora = await corNoMeio(page, area);
  expect(perto(agora, FUNDO), `o quadro da ligação de antes apareceu: ${agora}`).toBe(true);
  // O primeiro quadro do Carlos aparece.
  await quadro(page, 'remoto', BRANCO);
  await esperarCorNoMeio(page, area, RGB_DO_BRANCO);
});

test('your image stays in sight with every panel', async ({ page }) => {
  await abrir(page, 'video');
  const sua = suaImagem(page);
  await expect(sua).toBeVisible();
  const aVista = async (painel: string) => {
    await expect(sua, painel).toBeVisible();
    const s = await caixa(sua);
    expect(dentro(s, 400, 720), `${painel}: ${JSON.stringify(s)}`).toBe(true);
    await semCobrirNada(page, s);
  };

  await botao(page, 'Teclado').click();
  await expect(page.getByRole('group', { name: 'Teclado da ligação' })).toBeVisible();
  await aVista('Teclado');
  await botao(page, 'Teclado').click();
  await expect(remoto(page)).toBeVisible();

  await botao(page, 'Transferir').click();
  await expect(page.getByRole('combobox', { name: 'Número para transferir' })).toBeVisible();
  await aVista('Transferir');
  await botao(page, 'Cancelar').click();
  await expect(remoto(page)).toBeVisible();

  await botao(page, 'Nova ligação').click();
  await expect(page.getByRole('combobox', { name: 'Número da nova ligação' })).toBeVisible();
  await aVista('Nova ligação');
  await botao(page, 'Cancelar').click();
  await expect(remoto(page)).toBeVisible();

  await botao(page, 'Atalhos').click();
  await expect(botao(page, 'Fechar atalhos')).toBeVisible();
  await aVista('Atalhos');
  await botao(page, 'Fechar atalhos').click();
  await expect(remoto(page)).toBeVisible();
  await expect(sua).toBeVisible();
});

test('the video problem notices stay 5 seconds, the others 2', async ({ page }) => {
  const inicio = new Date('2026-11-10T14:00:00-03:00').getTime();
  await page.clock.install({ time: inicio });
  await abrir(page, 'video');
  // O relógio parado: só anda com o runFor (as mensagens da ponte falsa também saem por um setTimeout).
  await page.clock.pauseAt(inicio + 60_000);
  const aviso = (texto: string) => page.locator('.toast').getByText(texto, { exact: true });
  for (const texto of AVISOS_DE_5_S) {
    await empurrar(page, { v: 1, type: 'toast', texto });
    await page.clock.runFor(10);
    await expect(aviso(texto)).toBeVisible();
    await page.clock.runFor(4_490);
    await expect(aviso(texto), `${texto} em +4,5 s`).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(aviso(texto), `${texto} em +5,5 s`).toHaveCount(0);
  }
  await empurrar(page, { v: 1, type: 'toast', texto: 'Ocupado' });
  await page.clock.runFor(10);
  await expect(aviso('Ocupado')).toBeVisible();
  await page.clock.runFor(1_490);
  await expect(aviso('Ocupado'), 'Ocupado em +1,5 s').toBeVisible();
  await page.clock.runFor(1_000);
  await expect(aviso('Ocupado'), 'Ocupado em +2,5 s').toHaveCount(0);
});

test('resizing the window keeps the video fitted', async ({ page }) => {
  await abrir(page, 'video');
  const area = remoto(page);
  await quadro(page, 'remoto', VERMELHO, 640, 480);
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  const tamanho = () =>
    area.evaluate((e) => {
      const c = e.querySelector('canvas')!;
      return { canvas: [c.width, c.height], caixa: [e.clientWidth, e.clientHeight] };
    });
  const antes = await tamanho();

  await page.setViewportSize({ width: 300, height: 440 });
  await expect(page.locator('.win[data-layout="minimo"]')).toHaveCount(1);
  // O canvas com a largura e a altura da caixa (o devicePixelRatio é 1), menor que antes.
  await expect
    .poll(async () => {
      const { canvas, caixa } = await tamanho();
      return Math.abs(canvas[0] - caixa[0]) <= 1 && Math.abs(canvas[1] - caixa[1]) <= 1 && canvas[0] < antes.canvas[0];
    })
    .toBe(true);
  // O último quadro desenhado de novo, encaixado na caixa nova.
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  await botoesNaJanela(page, 300, 440);
});

test('the video screen fits the three sizes', async ({ page }) => {
  for (const [largura, altura, layout] of [
    [400, 720, 'normal'],
    [360, 600, 'compacto'],
    [300, 440, 'minimo'],
  ] as const) {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'video');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    const area = remoto(page);
    await expect(area).toBeVisible();
    expect((await caixa(area)).height, `a área do vídeo em ${largura}×${altura}`).toBeGreaterThan(100);
    await expect(suaImagem(page)).toBeVisible();
    const sobra = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
    expect(sobra, `a página rola em ${largura}×${altura}`).toBeLessThanOrEqual(0);
    await botoesNaJanela(page, largura, altura);
    if (layout === 'minimo') {
      // Quem fala numa linha só.
      const linha = page.getByText(/^Ana Souza · 03:1\d$/);
      await expect(linha).toBeVisible();
      expect((await caixa(linha)).height).toBeLessThan(26);
    } else {
      await expect(page.getByText('Ana Souza', { exact: true })).toBeVisible();
      await expect(page.getByText(/^Ramal 2003 · 03:1\d$/)).toBeVisible();
    }
  }
});

test('the second call ringing pauses the video layout', async ({ page }) => {
  await abrir(page, 'video');
  await expect(remoto(page)).toBeVisible();
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, second: carlos({ incoming: true, phase: 'ringing', activeSinceMs: 0 }), secondKind: 'ringing' },
  }));
  await expect(page.getByText('Ligação de Carlos Lima', { exact: true })).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
  // A câmera da Ana continua ligada: a sua imagem fica à vista, embaixo do cartão, sem cobrir o Recusar e o Atender.
  const sua = suaImagem(page);
  await expect(sua).toBeVisible();
  const s = await caixa(sua);
  const cartao = await caixa(page.locator('.vcard'));
  expect(s.y, JSON.stringify({ s, cartao })).toBeGreaterThanOrEqual(cartao.y + cartao.height);
  await semCobrirNada(page, s);
  await semViolacoesSerias(page);
});

test('on the iPhone a call never shows video', async ({ page }) => {
  await abrir(page, 'video&plataforma=ios');
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  // Mesmo que o estado traga o vídeo ligado e a ligação com a imagem e a câmera.
  await mudarEstado(page, (s) => ({
    ...s,
    video: { ligado: true, cameras: ['Câmera'], camera: '', cameraDesconectada: false, teste: false, h264: { cartao: true, pessoa: true, situacao: 'instalado' }, janela: 'normal' },
    ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: true } } },
  }));
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(suaImagem(page)).toHaveCount(0);
  await expect(camera(page)).toHaveCount(0);
  await expect(qualquerCamera(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
});
