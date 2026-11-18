// Os quadros da reunião (quadros.js), no Chromium: a página de verdade, servida pelo chat no modo de teste, com a rede
// falsa, a ligação falsa e o relógio parado. O mosaico de mentira é um <canvas> com uma cor em cada célula, ligado ao
// #mosaico pelo captureStream(0): cada imagem sai quando o teste pede (o requestFrame() da faixa), e não por um
// relógio. O palco de mentira é a mensagem palco, mandada pelo canal falso. A cor de um quadro é a do ponto do meio do
// <canvas> dele. As cores: a Ana vermelha, o Carlos azul, a Maria amarela, e a tela verde.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AGORA, MARCADA } from '../ligacoes-falsas';
import { CODIGO, RedeFalsa, type Canal, type Mensagem } from '../rede-falsa';

/** O aceito, com um Acesso inventado (seção 10 do protocolo). */
const ACEITO: Mensagem = {
  tipo: 'aceito',
  participante: 'participante-1',
  senha: 'senha-1',
  turn: { urls: ['turns:turn.exemplo.com.br:5349'], usuario: 'usuario-1', senha: 'credencial-1' },
  video: { wss: 'wss://video.exemplo.com.br:7443/sip', uri: 'sip:reuniao@video.exemplo.com.br' },
  volta: 'volta-1',
};

// Uma ligação falsa no lugar do ligacao.js: ela confirma, e o teste dá os eventos dela. Ela não mexe no #mosaico: o
// mosaico de mentira é do teste.
const LIGACAO_FALSA = `
export function criarLigacoes(aoEvento) {
  window.ligacaoFalsa = aoEvento;
  return {
    ligar({ qual }) { setTimeout(() => aoEvento({ tipo: 'ligacao', qual, o: 'confirmada' }), 0); },
    desligar() {},
    trocarCamera() { setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0); },
    trocarMicrofone() {},
  };
}`;

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 1, name: nome, exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

async function caixa(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const c = await l.boundingBox();
  if (!c) throw new Error('o elemento não está na tela');
  return c;
}

// ---- As pessoas, as cores e os palcos. ----

interface Pessoa {
  quem: string;
  nome: string;
}

const ANA: Pessoa = { quem: 'a1a1a1a1a1a1a1a1', nome: 'Ana Souza' };
const CARLOS: Pessoa = { quem: 'c2c2c2c2c2c2c2c2', nome: 'Carlos Lima' };
const MARIA: Pessoa = { quem: 'e3e3e3e3e3e3e3e3', nome: 'Maria Lima' };
const BIA: Pessoa = { quem: 'b4b4b4b4b4b4b4b4', nome: 'Bia Ramos' };
const ROBERTO: Pessoa = { quem: 'f5f5f5f5f5f5f5f5', nome: 'Roberto Alves' };
const EU: Pessoa = { quem: '9696969696969696', nome: 'Maria Lima' };

const CORES = {
  vermelho: [255, 0, 0],
  azul: [0, 0, 255],
  amarelo: [255, 255, 0],
  verde: [0, 255, 0],
  cinza: [128, 128, 128],
} as const;
type Cor = keyof typeof CORES;

const camDe = (p: Pessoa) => `cam:${p.quem}`;
const telaDe = (p: Pessoa) => `tela:${p.quem}`;

/** Um quadro do palco, com a cor da célula dele no mosaico de mentira. */
interface Quadro {
  pessoa: Pessoa;
  voce?: boolean;
  tela?: boolean;
  semCamera?: boolean;
  cor: Cor;
  x: number;
  y: number;
  l: number;
  a: number;
}

interface Palco {
  largura: number;
  altura: number;
  quadros: Quadro[];
}

type Celula = Omit<Quadro, 'x' | 'y' | 'l' | 'a'>;

/** As células em colunas × linhas, na ordem de leitura, começando no y. */
function emGrade(largura: number, alturaDaGrade: number, colunas: number, linhas: number, celulas: Celula[], y = 0) {
  const l = largura / colunas;
  const a = alturaDaGrade / linhas;
  return celulas.map((c, i) => ({ ...c, x: (i % colunas) * l, y: y + Math.floor(i / colunas) * a, l, a }));
}

const ana: Celula = { pessoa: ANA, cor: 'vermelho' };
const carlos: Celula = { pessoa: CARLOS, cor: 'azul' };
const maria: Celula = { pessoa: MARIA, cor: 'amarelo' };
const bia: Celula = { pessoa: BIA, cor: 'cinza' };
const roberto: Celula = { pessoa: ROBERTO, cor: 'cinza', semCamera: true };
const eu: Celula = { pessoa: EU, voce: true, cor: 'cinza' };

/** O Carlos e Você, lado a lado. */
const DOIS: Palco = { largura: 1920, altura: 1080, quadros: emGrade(1920, 1080, 2, 1, [carlos, eu]) };
/** A Ana, o Carlos, a Maria e Você, em 2×2. */
const TRES: Palco = { largura: 1920, altura: 1080, quadros: emGrade(1920, 1080, 2, 2, [ana, carlos, maria, eu]) };
/** A Ana, o Carlos, a Maria, o Roberto sem câmera e Você, em 3×2. */
const QUATRO: Palco = {
  largura: 1920,
  altura: 1080,
  quadros: emGrade(1920, 1080, 3, 2, [ana, carlos, maria, roberto, eu]),
};

/** A tela de quem compartilha em cima, de 1920×1080, e as pessoas numa linha embaixo: o mosaico de 1920×1620. */
function comTela(dono: Pessoa, voce = false): Palco {
  return {
    largura: 1920,
    altura: 1620,
    quadros: [
      { pessoa: dono, tela: true, voce, cor: 'verde', x: 0, y: 0, l: 1920, a: 1080 },
      ...emGrade(1920, 540, 4, 1, [ana, carlos, maria, eu], 1080),
    ],
  };
}

/** A mensagem palco do canal. */
function mensagemDo(p: Palco): Mensagem {
  return {
    tipo: 'palco',
    largura: p.largura,
    altura: p.altura,
    quadros: p.quadros.map((q) => ({
      quem: q.pessoa.quem,
      nome: q.pessoa.nome,
      voce: q.voce ?? false,
      tela: q.tela ?? false,
      semCamera: q.semCamera ?? false,
      x: q.x,
      y: q.y,
      l: q.l,
      a: q.a,
    })),
  };
}

// ---- O mosaico de mentira. ----

/** O canvas do mosaico de mentira e a faixa dele, no window da página. */
type MosaicoFalso = { canvas: HTMLCanvasElement; faixa: CanvasCaptureMediaStreamTrack };
/** O requestVideoFrameCallback do teste, guardado antes de a página começar (um teste o tira da página). */
type QuandoMostrar = (video: HTMLVideoElement, fn: VideoFrameRequestCallback) => void;

/**
 * O mosaico de mentira fica com o tamanho e as células do palco (a de fora de qualquer célula, preta), e sai uma imagem
 * dele. A promessa acaba quando o #mosaico mostrou essa imagem (o requestVideoFrameCallback dele, com a moldura fora
 * da vista): o quadros.js, que pediu o dele antes, já a viu.
 */
async function mosaico(page: Page, p: Palco): Promise<void> {
  const celulas = p.quadros.map((q) => ({ x: q.x, y: q.y, l: q.l, a: q.a, cor: CORES[q.cor] }));
  const tamanho = await page.evaluate(
    ({ largura, altura, celulas }) => {
      const w = window as unknown as { mosaicoFalso?: MosaicoFalso; quandoMostrar: QuandoMostrar };
      const video = document.getElementById('mosaico') as HTMLVideoElement;
      if (!w.mosaicoFalso) {
        const canvas = document.createElement('canvas');
        const fluxo = canvas.captureStream(0);
        w.mosaicoFalso = { canvas, faixa: fluxo.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack };
        video.srcObject = fluxo;
      }
      const { canvas, faixa } = w.mosaicoFalso;
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(0, 0, largura, altura);
      for (const c of celulas) {
        ctx.fillStyle = `rgb(${c.cor.join(', ')})`;
        ctx.fillRect(c.x, c.y, c.l, c.a);
      }
      return new Promise<string>((r) => {
        w.quandoMostrar(video, (_, m) => r(`${m.width}x${m.height}`));
        faixa.requestFrame();
      });
    },
    { largura: p.largura, altura: p.altura, celulas },
  );
  expect(tamanho).toBe(`${p.largura}x${p.altura}`);
}

/** Mais uma imagem do mosaico de mentira, igual à última: o canvas só dá outra imagem depois de ser pintado de novo. */
async function outraImagem(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { mosaicoFalso: MosaicoFalso; quandoMostrar: QuandoMostrar };
    const { canvas, faixa } = w.mosaicoFalso;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.putImageData(ctx.getImageData(0, 0, 1, 1), 0, 0);
    const video = document.getElementById('mosaico') as HTMLVideoElement;
    return new Promise<void>((r) => {
      w.quandoMostrar(video, () => r());
      faixa.requestFrame();
    });
  });
}

// ---- Os quadros. ----

const quadro = (page: Page, chave: string) => page.locator(`[data-quadro="${chave}"]`);
const todosOsQuadros = (page: Page) => page.locator('[data-quadro]');
const area = (page: Page) => page.locator('.palco');
const moldura = (page: Page) => page.locator('.moldura');
const etiqueta = (page: Page, chave: string) => quadro(page, chave).locator('.etiqueta');

/** A cor do ponto do meio do <canvas> do quadro: o nome da mais perto, 'nenhuma' sem pintura, ou 'outra'. */
const corDo = (page: Page, chave: string) => corNoPonto(page, chave, { x: 0.5, y: 0.5 });

/** A cor de um ponto do <canvas> do quadro, em frações da largura e da altura dele, como no corDo. */
async function corNoPonto(page: Page, chave: string, ponto: { x: number; y: number }): Promise<string> {
  const [r, g, b, alfa] = await quadro(page, chave)
    .locator('canvas')
    .evaluate((c: HTMLCanvasElement, { x, y }) => {
      if (c.width === 0 || c.height === 0) return [0, 0, 0, 0];
      const px = Math.min(c.width - 1, Math.floor(c.width * x));
      const py = Math.min(c.height - 1, Math.floor(c.height * y));
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, ponto);
  if (alfa === 0) return 'nenhuma';
  for (const [nome, [cr, cg, cb]] of Object.entries(CORES)) {
    if (Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb) < 90) return nome;
  }
  return 'outra';
}

const mostraDe = (page: Page, chave: string) => quadro(page, chave).getAttribute('data-mostra');
/** O tamanho do <canvas> do quadro, em pixels, e o do quadro, em px (o que o quadros.js deu a ele). */
const pixelsDoCanvas = (q: Locator) =>
  q.locator('canvas').evaluate((c: HTMLCanvasElement) => ({ l: c.width, a: c.height }));
const tamanhoDoQuadro = (q: Locator, escala = 1) =>
  q.evaluate(
    (e: HTMLElement, escala) => ({
      l: Math.round(parseFloat(e.style.width) * escala),
      a: Math.round(parseFloat(e.style.height) * escala),
    }),
    escala,
  );
/** As chaves dos quadros da faixa, de cima para baixo (ou da esquerda para a direita). */
const daFaixa = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-papel="faixa"]')]
      .map((q) => ({ chave: q.dataset.quadro, c: q.getBoundingClientRect() }))
      .sort((p, q) => p.c.y - q.c.y || p.c.x - q.c.x)
      .map((q) => q.chave),
  );

/** Confere que a caixa de dentro está dentro da de fora (com 1 px de folga). */
function dentro(de: { x: number; y: number; width: number; height: number }, fora: typeof de, onde: string) {
  expect(de.x, `${onde}: a esquerda`).toBeGreaterThanOrEqual(fora.x - 1);
  expect(de.y, `${onde}: o topo`).toBeGreaterThanOrEqual(fora.y - 1);
  expect(de.x + de.width, `${onde}: a direita`).toBeLessThanOrEqual(fora.x + fora.width + 1);
  expect(de.y + de.height, `${onde}: o fundo`).toBeLessThanOrEqual(fora.y + fora.height + 1);
}

/**
 * A cor de verdade, na tela, de cada ponto (em px da página): a página é fotografada, e a foto é lida numa página em
 * branco do mesmo contexto (a da reunião tem o CSP, que não deixa ler a foto). O nome da cor mais perto, ou 'outra'.
 */
async function coresNaTela(page: Page, pontos: Array<{ x: number; y: number }>): Promise<string[]> {
  const foto = (await page.screenshot()).toString('base64');
  const branca = await page.context().newPage();
  try {
    const rgbs = await branca.evaluate(
      async ({ foto, pontos }) => {
        const bytes = Uint8Array.from(atob(foto), (c) => c.charCodeAt(0));
        const imagem = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(imagem.width, imagem.height);
        const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(imagem, 0, 0);
        return pontos.map(({ x, y }) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
      },
      { foto, pontos },
    );
    const nomes: Record<string, readonly number[]> = { ...CORES, ciano: [0, 194, 203] };
    const distancia = (p: readonly number[], q: readonly number[]) => p.reduce((d, v, i) => d + Math.abs(v - q[i]), 0);
    return rgbs.map((rgb) => Object.entries(nomes).find(([, cor]) => distancia(rgb, cor) < 60)?.[0] ?? 'outra');
  } finally {
    await branca.close();
  }
}

/** A cor na tela da borda de dentro do quadro: no meio de cada lado, a 1 px da beira (longe da pílula e da etiqueta) */
async function bordaDo(page: Page, chave: string): Promise<string[]> {
  const c = await caixa(quadro(page, chave));
  const meio = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  return coresNaTela(page, [
    { x: meio.x, y: c.y + 1 },
    { x: c.x + 1, y: meio.y },
    { x: meio.x, y: c.y + c.height - 2 },
    { x: c.x + c.width - 2, y: meio.y },
  ]);
}

const CIANO = ['ciano', 'ciano', 'ciano', 'ciano'];
const longeDosQuadros = (page: Page) => page.mouse.move(640, 20);

// ---- A página na reunião. ----

// Todo teste confere, no fim, que a página não quebrou o CSP e que nada do palco (os nomes) foi ao console.
let mensagensDoConsole: string[] = [];

test.beforeEach(async ({ page }) => {
  mensagensDoConsole = [];
  page.on('console', (m) => mensagensDoConsole.push(`${m.type()} ${m.text()}`));
  page.on('pageerror', (e) => mensagensDoConsole.push(`pageerror ${e.message}`));
  await page.addInitScript(() => {
    const w = window as unknown as { violacoes: string[]; quandoMostrar: QuandoMostrar };
    const pedir = HTMLVideoElement.prototype.requestVideoFrameCallback;
    w.quandoMostrar = (video, fn) => pedir.call(video, fn);
    w.violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.violacoes.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
  const nomes = /Ana|Carlos|Maria|Bia|Roberto|Participante|palco/;
  expect(mensagensDoConsole.filter((m) => m.startsWith('error') || m.startsWith('pageerror') || nomes.test(m))).toEqual(
    [],
  );
});

interface NaReuniao {
  rede: RedeFalsa;
  canal: Canal;
}

/** A página na reunião, com a ligação falsa, o relógio parado e o canal 1 aberto. */
async function naReuniao(page: Page): Promise<NaReuniao> {
  await page.route('**/r/estatico/ligacao.js', (r) =>
    r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIGACAO_FALSA }),
  );
  await page.clock.install({ time: AGORA - 1000 });
  await page.clock.pauseAt(AGORA);
  const rede = await RedeFalsa.instalar(page, MARCADA);
  await page.goto(`/r/${CODIGO}`);
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  await botao(page, 'Pedir para entrar').click();
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
  await page.clock.runFor(10);
  await expect(page.getByRole('navigation', { name: 'Controles da reunião' })).toBeVisible();
  return { rede, canal: await rede.canalNumero(1) };
}

/** O palco chega, e o mosaico dele também; 600 ms depois, com a imagem seguinte, os quadros mostram o vídeo. */
async function comOPalco(page: Page, canal: Canal, p: Palco): Promise<void> {
  canal.mandar(mensagemDo(p));
  await mosaico(page, p);
  await page.clock.runFor(600);
  await outraImagem(page);
  const primeiro = p.quadros.find((q) => !q.voce && !q.semCamera);
  if (!primeiro) return;
  const chave = primeiro.tela ? telaDe(primeiro.pessoa) : camDe(primeiro.pessoa);
  await expect.poll(() => mostraDe(page, chave)).toBe('video');
}

async function naReuniaoCom(page: Page, p: Palco): Promise<NaReuniao> {
  const r = await naReuniao(page);
  await comOPalco(page, r.canal, p);
  return r;
}

const darNaLigacao = (page: Page, evento: object) =>
  page.evaluate((e) => (window as unknown as { ligacaoFalsa: (e: object) => void }).ligacaoFalsa(e), evento);

// ---- Os testes. ----

test('sem palco, o mosaico inteiro depois de 3 s', async ({ page }) => {
  await naReuniao(page);
  // O servidor de vídeo antigo não manda o palco: a moldura do mosaico fica fora da vista, e o mosaico toca.
  await mosaico(page, DOIS);
  expect((await caixa(moldura(page))).width).toBeLessThanOrEqual(1);
  // Fora da vista, ela fica fora dos leitores de tela também.
  await expect(moldura(page)).toHaveAttribute('aria-hidden', 'true');
  // A sincronia começou no ligar, até 10 ms antes do fim do naReuniao.
  await page.clock.runFor(2_980);
  expect((await caixa(moldura(page))).width).toBeLessThanOrEqual(1);
  await page.clock.runFor(20);
  await expect.poll(async () => (await caixa(moldura(page))).width).toBeGreaterThan(600);
  await expect(page.locator('#mosaico')).toBeVisible();
  await expect(moldura(page)).not.toHaveAttribute('aria-hidden');
  await expect(todosOsQuadros(page)).toHaveCount(0);
});

test('duas pessoas', async ({ page }) => {
  await naReuniaoCom(page, DOIS);
  const carlosQ = quadro(page, camDe(CARLOS));
  const a = await caixa(area(page));
  const c = await caixa(carlosQ);
  // O Carlos ocupa a área: a altura dela, e 95% ou mais da largura.
  expect(Math.abs(c.height - a.height)).toBeLessThanOrEqual(1);
  expect(c.width).toBeGreaterThanOrEqual(0.95 * a.width);
  expect(await corDo(page, camDe(CARLOS))).toBe('azul');
  await expect(etiqueta(page, camDe(CARLOS))).toHaveText('Carlos Lima');
  // Na escala 1, o canvas tem o tamanho do quadro; o mosaico, fora da vista, fica fora dos leitores de tela.
  expect(await pixelsDoCanvas(carlosQ)).toEqual(await tamanhoDoQuadro(carlosQ));
  await expect(moldura(page)).toHaveAttribute('aria-hidden', 'true');
  expect(await carlosQ.evaluate((e) => e.tagName)).not.toBe('BUTTON');
  await expect(carlosQ).toHaveAttribute('role', 'img');
  await expect(carlosQ).toHaveAttribute('data-papel', 'grade');

  // O Você no canto de baixo, à direita: 208 px de largura, em 16:9, a 16 px do canto.
  const voce = quadro(page, 'voce');
  await expect(voce).toHaveAttribute('data-papel', 'canto');
  await expect(voce.locator('.etiqueta')).toHaveText('Você');
  const v = await caixa(voce);
  expect(v.width).toBeCloseTo(208, 0);
  expect(v.height).toBeCloseTo(117, 0);
  expect(a.x + a.width - (v.x + v.width)).toBeCloseTo(16, 0);
  expect(a.y + a.height - (v.y + v.height)).toBeCloseTo(16, 0);
  // O vídeo dele toca o fluxo da câmera (o da prévia da entrada, o primeiro <video>), espelhado.
  const comoToca = await voce.locator('video').evaluate((video: HTMLVideoElement) => ({
    fluxo: video.srcObject !== null && video.srcObject === document.querySelector('video')?.srcObject,
    mudo: video.muted,
    espelho: getComputedStyle(video).transform,
  }));
  expect(comoToca).toEqual({ fluxo: true, mudo: true, espelho: 'matrix(-1, 0, 0, 1, 0, 0)' });
  await expect(voce).toHaveAttribute('data-mostra', 'video');
  // A Câmera desligada: o Você mostra o nome no centro, com 14 px, pelo cam da página.
  await botao(page, 'Câmera').click();
  await page.clock.runFor(10);
  await expect(voce).toHaveAttribute('data-mostra', 'sem-camera');
  await expect(voce.locator('.quadro-centro')).toHaveText('Você');
  await expect(voce.locator('.quadro-centro')).toHaveCSS('font-size', '14px');
  await expect(voce.locator('video')).toBeHidden();
});

test('a grade de quatro', async ({ page }) => {
  await naReuniaoCom(page, QUATRO);
  for (const [pessoa, cor] of [
    [ANA, 'vermelho'],
    [CARLOS, 'azul'],
    [MARIA, 'amarelo'],
  ] as const) {
    await expect(quadro(page, camDe(pessoa))).toHaveAttribute('data-mostra', 'video');
    expect(await corDo(page, camDe(pessoa))).toBe(cor);
    await expect(etiqueta(page, camDe(pessoa))).toHaveText(pessoa.nome);
    await expect(quadro(page, camDe(pessoa))).toHaveAttribute('data-papel', 'grade');
  }
  // O Roberto, sem câmera: o nome no centro, e sem a etiqueta de baixo.
  const r = quadro(page, camDe(ROBERTO));
  await expect(r).toHaveAttribute('data-mostra', 'sem-camera');
  await expect(r.locator('.quadro-centro')).toHaveText('Roberto Alves');
  await expect(r.locator('.quadro-centro')).toBeVisible();
  await expect(r.locator('.etiqueta')).toBeHidden();
  const caixaR = await caixa(r);
  const centro = await caixa(r.locator('.quadro-centro'));
  expect(Math.abs(centro.y + centro.height / 2 - (caixaR.y + caixaR.height / 2))).toBeLessThanOrEqual(2);
  // Quatro quadros na grade, um do lado do outro, sem se cobrir, e o Você no canto.
  const caixas = await Promise.all([ANA, CARLOS, MARIA, ROBERTO].map((p) => caixa(quadro(page, camDe(p)))));
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      const [p, q] = [caixas[i], caixas[j]];
      const lado = p.x + p.width <= q.x + 1 || q.x + q.width <= p.x + 1;
      const emCima = p.y + p.height <= q.y + 1 || q.y + q.height <= p.y + 1;
      expect(lado || emCima).toBe(true);
    }
  }
  await expect(quadro(page, 'voce')).toHaveAttribute('data-papel', 'canto');
});

test('o clique aumenta, e o Ver todos e o Esc voltam', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  // O Carlos é o grande; os outros vão à faixa, o Você por último; o foco vai ao Ver todos.
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  expect(await daFaixa(page)).toEqual([camDe(ANA), camDe(MARIA), 'voce']);
  await expect(botao(page, 'Ver todos')).toBeFocused();
  await expect(page.getByRole('group', { name: 'As outras pessoas', exact: true })).toBeVisible();
  await expect.poll(() => corDo(page, camDe(CARLOS))).toBe('azul');
  // A faixa: uma coluna de 228 px à direita, a 10 px do grande, com quadros de 228×128.
  const a = await caixa(area(page));
  const f = await caixa(page.locator('.faixa'));
  expect(f.width).toBe(228);
  expect(a.x + a.width - (f.x + f.width)).toBeCloseTo(0, 0);
  const anaNaFaixa = await caixa(quadro(page, camDe(ANA)));
  expect([anaNaFaixa.width, anaNaFaixa.height]).toEqual([228, 128]);
  const grande = await caixa(quadro(page, camDe(CARLOS)));
  expect(grande.x + grande.width).toBeLessThanOrEqual(f.x - 10 + 1);
  // O botão de voltar, a 14 px do canto do grande, com 44 px ou mais.
  const ver = await caixa(botao(page, 'Ver todos'));
  expect(ver.x - grande.x).toBeCloseTo(14, 0);
  expect(ver.y - grande.y).toBeCloseTo(14, 0);
  expect(ver.height).toBeGreaterThanOrEqual(44);

  // O clique na Ana da faixa: ela é a grande, e o Carlos vai à faixa.
  await quadro(page, camDe(ANA)).click();
  await expect(quadro(page, camDe(ANA))).toHaveAttribute('data-papel', 'grande');
  expect(await daFaixa(page)).toEqual([camDe(CARLOS), camDe(MARIA), 'voce']);
  await expect.poll(() => corDo(page, camDe(ANA))).toBe('vermelho');

  // O Ver todos volta à grade, com o foco no quadro de quem estava grande.
  await botao(page, 'Ver todos').click();
  for (const p of [ANA, CARLOS, MARIA]) await expect(quadro(page, camDe(p))).toHaveAttribute('data-papel', 'grade');
  await expect(quadro(page, camDe(ANA))).toBeFocused();
  await expect(botao(page, 'Ver todos')).toBeHidden();
  await expect(page.locator('.faixa')).toHaveCount(0);

  // De novo, e o Esc volta.
  await quadro(page, camDe(MARIA)).click();
  await expect(quadro(page, camDe(MARIA))).toHaveAttribute('data-papel', 'grande');
  await page.keyboard.press('Escape');
  await expect(quadro(page, camDe(MARIA))).toHaveAttribute('data-papel', 'grade');
  await expect(quadro(page, camDe(MARIA))).toBeFocused();
  // Sem nada aumentado, o Esc não faz nada.
  await page.keyboard.press('Escape');
  await expect(quadro(page, camDe(MARIA))).toHaveAttribute('data-papel', 'grade');
});

test('o teclado e os nomes ditos', async ({ page }) => {
  await naReuniaoCom(page, QUATRO);
  await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
  // O Tab chega a cada quadro da grade, na ordem; o Você não é botão, e o próximo é o Microfone.
  const nomes = [
    'Aumentar a câmera de Ana Souza',
    'Aumentar a câmera de Carlos Lima',
    'Aumentar a câmera de Maria Lima',
    'Aumentar o quadro de Roberto Alves, que está com a câmera desligada',
  ];
  for (const nome of nomes) {
    await page.keyboard.press('Tab');
    await expect(botao(page, nome)).toBeFocused();
  }
  // Com o foco do teclado, a borda ciano por dentro e a pílula Aumentar.
  const contorno = await botao(page, nomes[3]).evaluate((b) => {
    const s = getComputedStyle(b, '::after');
    return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`;
  });
  expect(contorno).toBe('solid 3px rgb(0, 194, 203) -3px');
  await expect(quadro(page, camDe(ROBERTO)).locator('.pilula')).toBeVisible();
  await expect(quadro(page, camDe(ROBERTO)).locator('.pilula')).toHaveText('Aumentar');
  await expect(quadro(page, camDe(ANA)).locator('.pilula')).toBeHidden();
  await expect(page.getByRole('img', { name: 'A sua câmera', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(botao(page, 'Microfone')).toBeFocused();

  // O Enter aumenta o Roberto: o grande, sem câmera, não é botão.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'Roberto Alves, com a câmera desligada', exact: true })).toBeVisible();
  await expect(botao(page, 'Ver todos')).toBeFocused();
  await expect(page.getByRole('group', { name: 'As outras pessoas', exact: true })).toBeVisible();
  // Na faixa, os outros são botões, e o Você não.
  await expect(botao(page, 'Aumentar a câmera de Carlos Lima')).toHaveAttribute('data-papel', 'faixa');
  await expect(page.getByRole('img', { name: 'A sua câmera', exact: true })).toHaveAttribute('data-papel', 'faixa');
  // O Tab do Ver todos vai à faixa, e o Enter aumenta o Carlos, que é dito sem o Aumentar.
  await page.keyboard.press('Tab');
  await expect(botao(page, 'Aumentar a câmera de Ana Souza')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'A câmera de Carlos Lima', exact: true })).toHaveAttribute(
    'data-papel',
    'grande',
  );
  await expect(botao(page, 'Aumentar o quadro de Roberto Alves, que está com a câmera desligada')).toHaveAttribute(
    'data-papel',
    'faixa',
  );
  // O Espaço também vale, num botão de verdade.
  await botao(page, 'Aumentar a câmera de Maria Lima').focus();
  await page.keyboard.press('Space');
  await expect(quadro(page, camDe(MARIA))).toHaveAttribute('data-papel', 'grande');
});

test('a tela compartilhada', async ({ page }) => {
  await naReuniaoCom(page, comTela(ANA));
  const tela = quadro(page, telaDe(ANA));
  await expect(tela).toHaveAttribute('data-papel', 'grande');
  await expect(page.getByRole('img', { name: 'A tela de Ana Souza', exact: true })).toBeVisible();
  expect(await corDo(page, telaDe(ANA))).toBe('verde');
  await expect(etiqueta(page, telaDe(ANA))).toHaveText('Tela de Ana Souza');
  await expect(etiqueta(page, telaDe(ANA)).locator('use')).toHaveAttribute('href', '#i-tela');
  await expect(page.getByRole('group', { name: 'As pessoas', exact: true })).toBeVisible();
  expect(await daFaixa(page)).toEqual([camDe(ANA), camDe(CARLOS), camDe(MARIA), 'voce']);
  expect(await corDo(page, camDe(CARLOS))).toBe('azul');
  // A tela inteira, no centro: o <canvas> do grande tem a proporção do quadro, e a imagem fica em 16:9 dentro dele. A
  // faixa que sobra (dos lados, ou em cima e embaixo) fica sem imagem.
  const t = await caixa(tela);
  const sobra = t.width / t.height > 16 / 9 ? { x: 0.005, y: 0.5 } : { x: 0.5, y: 0.005 };
  expect(await corNoPonto(page, telaDe(ANA), sobra)).toBe('nenhuma');
  await expect(botao(page, 'Voltar para a tela')).toBeHidden();
  await expect(botao(page, 'Ver todos')).toBeHidden();

  // O clique no Carlos da faixa: ele é o grande, a tela é a primeira da faixa, e aparece o Voltar para a tela.
  const aumentarOCarlos = async () => {
    await quadro(page, camDe(CARLOS)).click();
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
    expect(await daFaixa(page)).toEqual([telaDe(ANA), camDe(ANA), camDe(MARIA), 'voce']);
    await expect(botao(page, 'Voltar para a tela')).toBeVisible();
    await expect(botao(page, 'Voltar para a tela')).toBeFocused();
    await expect(page.getByRole('group', { name: 'A tela e as outras pessoas', exact: true })).toBeVisible();
    await expect(botao(page, 'Aumentar a tela de Ana Souza')).toHaveAttribute('data-papel', 'faixa');
    await expect(etiqueta(page, telaDe(ANA))).toHaveText('Tela de Ana Souza');
  };
  const aTelaVoltou = async () => {
    await expect(tela).toHaveAttribute('data-papel', 'grande');
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'faixa');
    await expect(botao(page, 'Voltar para a tela')).toBeHidden();
    await expect(quadro(page, camDe(CARLOS))).toBeFocused();
    await expect.poll(() => corDo(page, telaDe(ANA))).toBe('verde');
  };
  await aumentarOCarlos();
  await expect.poll(() => corDo(page, telaDe(ANA))).toBe('verde');
  await botao(page, 'Voltar para a tela').click();
  await aTelaVoltou();

  await aumentarOCarlos();
  await page.keyboard.press('Escape');
  await aTelaVoltou();
  // Com a tela grande e nenhuma câmera aumentada, o Esc não faz nada.
  await page.keyboard.press('Escape');
  await expect(tela).toHaveAttribute('data-papel', 'grande');

  await aumentarOCarlos();
  await quadro(page, telaDe(ANA)).click();
  await aTelaVoltou();
});

test('quem compartilha vê A sua tela', async ({ page }) => {
  await naReuniaoCom(page, comTela(EU, true));
  const minha = quadro(page, telaDe(EU));
  await expect(minha).toHaveAttribute('data-papel', 'grande');
  await expect(etiqueta(page, telaDe(EU))).toHaveText('A sua tela');
  await expect(page.getByRole('img', { name: 'A sua tela', exact: true })).toBeVisible();
  await quadro(page, camDe(CARLOS)).click();
  await expect(botao(page, 'Aumentar a sua tela')).toHaveAttribute('data-papel', 'faixa');
  await expect(etiqueta(page, telaDe(EU))).toHaveText('A sua tela');
});

test('o compartilhamento começa com uma câmera aumentada', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');

  // A Ana compartilha: o palco de 1920×1620 chega, e o mosaico muda de tamanho depois.
  await comOPalco(page, canal, comTela(ANA));
  await expect(quadro(page, telaDe(ANA))).toHaveAttribute('data-papel', 'grande');
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'faixa');
  await expect(botao(page, 'Voltar para a tela')).toBeHidden();
  await expect(botao(page, 'Ver todos')).toBeHidden();

  // O compartilhamento acaba: volta a grade.
  await comOPalco(page, canal, TRES);
  for (const p of [ANA, CARLOS, MARIA]) await expect(quadro(page, camDe(p))).toHaveAttribute('data-papel', 'grade');
  await expect(quadro(page, telaDe(ANA))).toHaveCount(0);
});

test('a pessoa aumentada sai', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, QUATRO);
  await quadro(page, camDe(CARLOS)).click();
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  // O Carlos sai: o palco do mesmo tamanho, sem ele.
  canal.mandar(mensagemDo({ ...QUATRO, quadros: QUATRO.quadros.filter((q) => q.pessoa !== CARLOS) }));
  await expect(quadro(page, camDe(CARLOS))).toHaveCount(0);
  for (const p of [ANA, MARIA, ROBERTO]) await expect(quadro(page, camDe(p))).toHaveAttribute('data-papel', 'grade');
  await expect(botao(page, 'Ver todos')).toBeHidden();
  // Ele volta, e entra na grade: ninguém ficou aumentado.
  canal.mandar(mensagemDo(QUATRO));
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grade');
  await expect(page.locator('[data-papel="grande"]')).toHaveCount(0);
});

test('o palco novo espera o tamanho do vídeo', async ({ page }) => {
  // A rede lenta (Review Focus 1): o palco novo chega bem antes da imagem nova.
  const { canal } = await naReuniaoCom(page, TRES);
  const pessoas = [
    [ANA, 'vermelho'],
    [CARLOS, 'azul'],
    [MARIA, 'amarelo'],
  ] as const;
  const novo = comTela(ANA);
  canal.mandar(mensagemDo(novo));
  // O vídeo ainda é o de 1920×1080: os quadros continuam com as cores de antes, na grade de antes.
  await outraImagem(page);
  for (const [p, cor] of pessoas) {
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-mostra', 'video');
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-papel', 'grade');
    expect(await corDo(page, camDe(p))).toBe(cor);
  }
  await expect(quadro(page, telaDe(ANA))).toHaveCount(0);

  // O mosaico vira 1920×1620: todos mostram a espera, sem cor.
  await mosaico(page, novo);
  for (const chave of [telaDe(ANA), camDe(ANA), camDe(CARLOS), camDe(MARIA)]) {
    await expect(quadro(page, chave)).toHaveAttribute('data-mostra', 'espera');
    expect(await corDo(page, chave)).toBe('nenhuma');
  }
  await expect(etiqueta(page, camDe(CARLOS))).toHaveText('Carlos Lima');
  await expect(etiqueta(page, camDe(CARLOS))).toBeVisible();

  // 600 ms depois, sem imagem nova, todos continuam na espera: a imagem que o vídeo tem é a de antes do fim dela, e
  // pode ser de outra pessoa. Com a imagem seguinte, a tela tem o verde, e as pessoas, as cores delas.
  await page.clock.runFor(590);
  await expect(quadro(page, telaDe(ANA))).toHaveAttribute('data-mostra', 'espera');
  await page.clock.runFor(10);
  for (const chave of [telaDe(ANA), camDe(ANA), camDe(CARLOS), camDe(MARIA)]) {
    await expect(quadro(page, chave)).toHaveAttribute('data-mostra', 'espera');
    expect(await corDo(page, chave)).toBe('nenhuma');
  }
  await expect(etiqueta(page, camDe(CARLOS))).toHaveText('Carlos Lima');
  await outraImagem(page);
  await expect(quadro(page, telaDe(ANA))).toHaveAttribute('data-mostra', 'video');
  await expect.poll(() => corDo(page, telaDe(ANA))).toBe('verde');
  for (const [p, cor] of pessoas) await expect.poll(() => corDo(page, camDe(p))).toBe(cor);
});

test('quem acabou de entrar espera 1 s', async ({ page }) => {
  // Review Focus 3: a Bia fica com a célula que era do Carlos, que ainda é azul no mosaico.
  const { canal } = await naReuniaoCom(page, TRES);
  const comABia: Palco = {
    ...TRES,
    quadros: TRES.quadros.map((q) => (q.pessoa === CARLOS ? { ...q, pessoa: BIA } : q)),
  };
  canal.mandar(mensagemDo(comABia));
  await outraImagem(page);
  await expect(quadro(page, camDe(BIA))).toHaveAttribute('data-mostra', 'espera');
  await expect(etiqueta(page, camDe(BIA))).toHaveText('Bia Ramos');
  expect(await corDo(page, camDe(BIA))).toBe('nenhuma');
  // Quem já estava continua com o vídeo.
  await expect(quadro(page, camDe(ANA))).toHaveAttribute('data-mostra', 'video');
  expect(await corDo(page, camDe(ANA))).toBe('vermelho');
  await outraImagem(page);
  await page.clock.runFor(990);
  await outraImagem(page);
  await expect(quadro(page, camDe(BIA))).toHaveAttribute('data-mostra', 'espera');
  expect(await corDo(page, camDe(BIA))).toBe('nenhuma');
  // 1000 ms depois, sem imagem nova, ela continua na espera, com o nome: a imagem que o vídeo tem ainda é a de antes.
  // Nem a janela que muda de tamanho nem um desenho do estado a pintam.
  await page.clock.runFor(10);
  const aindaEspera = async () => {
    await expect(quadro(page, camDe(BIA))).toHaveAttribute('data-mostra', 'espera');
    await expect(etiqueta(page, camDe(BIA))).toHaveText('Bia Ramos');
    expect(await corDo(page, camDe(BIA))).toBe('nenhuma');
  };
  await aindaEspera();
  await page.setViewportSize({ width: 1200, height: 760 });
  await expect.poll(async () => (await caixa(area(page))).width).toBeLessThan(1200);
  await aindaEspera();
  await botao(page, 'Microfone').click();
  await page.clock.runFor(10);
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
  await aindaEspera();
  expect(await corDo(page, camDe(ANA))).toBe('vermelho');
  // A imagem seguinte: ela mostra o vídeo (o mosaico de mentira ainda tem o azul nessa célula).
  await outraImagem(page);
  await expect(quadro(page, camDe(BIA))).toHaveAttribute('data-mostra', 'video');
  await expect.poll(() => corDo(page, camDe(BIA))).toBe('azul');
});

test('o tamanho que não confere vira o mosaico inteiro', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  // O mosaico muda de tamanho sem palco novo: a espera em todos.
  const menor: Palco = { largura: 1280, altura: 720, quadros: emGrade(1280, 720, 2, 2, [ana, carlos, maria, eu]) };
  await mosaico(page, menor);
  for (const p of [ANA, CARLOS, MARIA]) {
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-mostra', 'espera');
    expect(await corDo(page, camDe(p))).toBe('nenhuma');
  }
  await page.clock.runFor(2_990);
  expect((await caixa(moldura(page))).width).toBeLessThanOrEqual(1);
  // 3000 ms depois, a moldura do mosaico, sem quadro nenhum.
  await page.clock.runFor(10);
  await expect.poll(async () => (await caixa(moldura(page))).width).toBeGreaterThan(600);
  await expect(todosOsQuadros(page)).toHaveCount(0);
  // Um palco desse tamanho traz os quadros de volta.
  canal.mandar(mensagemDo(menor));
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-mostra', 'video');
  await expect.poll(() => corDo(page, camDe(CARLOS))).toBe('azul');
  expect((await caixa(moldura(page))).width).toBeLessThanOrEqual(1);
});

test.describe('o celular em pé', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a grade, e a tela em cima', async ({ page }) => {
    const QUATRO_OUTROS: Palco = {
      largura: 1920,
      altura: 1080,
      quadros: emGrade(1920, 1080, 3, 2, [ana, carlos, maria, bia, eu]),
    };
    const { canal } = await naReuniaoCom(page, QUATRO_OUTROS);
    const a = await caixa(area(page));
    // A margem de 8 px da área.
    expect(a.x).toBeCloseTo(8, 0);
    expect(a.width).toBeCloseTo(390 - 16, 0);
    // Os 4 outros em duas colunas, que ocupam a área.
    const caixas = await Promise.all([ANA, CARLOS, MARIA, BIA].map((p) => caixa(quadro(page, camDe(p)))));
    expect(new Set(caixas.map((c) => Math.round(c.x))).size).toBe(2);
    expect(Math.min(...caixas.map((c) => c.x))).toBeCloseTo(a.x, 0);
    expect(Math.max(...caixas.map((c) => c.x + c.width))).toBeCloseTo(a.x + a.width, 0);
    expect(Math.min(...caixas.map((c) => c.y))).toBeCloseTo(a.y, 0);
    expect(Math.max(...caixas.map((c) => c.y + c.height))).toBeCloseTo(a.y + a.height, 0);
    expect(await corDo(page, camDe(MARIA))).toBe('amarelo');
    // O Você no canto: 84 px, em 3:4, a 10 px de baixo e da direita.
    const v = await caixa(quadro(page, 'voce'));
    await expect(quadro(page, 'voce')).toHaveAttribute('data-papel', 'canto');
    expect(v.width).toBeCloseTo(84, 0);
    expect(v.height).toBeCloseTo(112, 0);
    expect(a.x + a.width - (v.x + v.width)).toBeCloseTo(10, 0);
    expect(a.y + a.height - (v.y + v.height)).toBeCloseTo(10, 0);
    await expect(page.getByText('Gire o celular para ver a tela maior.', { exact: true })).toBeHidden();

    // Com a tela: a tela em cima, o aviso de girar, e as pessoas embaixo.
    await comOPalco(page, canal, comTela(ANA));
    const t = await caixa(quadro(page, telaDe(ANA)));
    expect(t.y).toBeCloseTo(a.y, 0);
    expect(t.width).toBeCloseTo(a.width, 0);
    const gire = page.getByText('Gire o celular para ver a tela maior.', { exact: true });
    await expect(gire).toBeVisible();
    const g = await caixa(gire);
    expect(g.y).toBeGreaterThanOrEqual(t.y + t.height);
    for (const chave of [camDe(ANA), camDe(CARLOS), camDe(MARIA), 'voce']) {
      const q = await caixa(quadro(page, chave));
      expect(q.y).toBeGreaterThanOrEqual(g.y + g.height);
      dentro(q, a, chave);
    }
    await expect(botao(page, 'Aumentar a câmera de Carlos Lima')).toBeVisible();
    await expect(page.getByText('Gire o celular para ver a reunião maior.')).toHaveCount(0);
  });
});

test('girar o celular e mudar a janela', async ({ page }) => {
  // Review Focus 4: com o Carlos aumentado, a janela muda de tamanho e o celular gira.
  await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');

  const conferir = async (onde: string) => {
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
    const a = await caixa(area(page));
    const f = await caixa(page.locator('.faixa'));
    dentro(f, a, `${onde}: a faixa`);
    dentro(await caixa(quadro(page, camDe(CARLOS))), a, `${onde}: o grande`);
    for (const chave of [camDe(CARLOS), camDe(ANA), camDe(MARIA)]) {
      const proporcoes = await quadro(page, chave).evaluate((q) => {
        const c = q.querySelector('canvas') as HTMLCanvasElement;
        const r = q.getBoundingClientRect();
        return { canvas: c.width / c.height, quadro: r.width / r.height };
      });
      expect(Math.abs(proporcoes.canvas - proporcoes.quadro), `${onde}: ${chave}`).toBeLessThan(0.02);
    }
    await expect.poll(() => corDo(page, camDe(CARLOS))).toBe('azul');
  };
  await conferir('1280×800');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await caixa(area(page))).height).toBeLessThan(300);
  await conferir('844×390');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await caixa(page.locator('.faixa'))).height).toBe(72);
  await conferir('390×844');
  // Em pé, a faixa é uma linha de quadros de 128×72 embaixo.
  const ana = await caixa(quadro(page, camDe(ANA)));
  expect([ana.width, ana.height]).toEqual([128, 72]);
});

test('os nomes fora do comum', async ({ page }) => {
  // Review Focus 5: o nome vazio, o nome com sinais de HTML e o nome de 80 letras.
  const vazio: Pessoa = { quem: '1111111111111111', nome: '' };
  const html: Pessoa = { quem: '2222222222222222', nome: '<b>Ana</b>' };
  const comprido: Pessoa = { quem: '3333333333333333', nome: 'Maria'.repeat(16) };
  expect(comprido.nome).toHaveLength(80);
  await naReuniaoCom(page, {
    largura: 1920,
    altura: 1080,
    quadros: emGrade(1920, 1080, 2, 2, [
      { pessoa: vazio, cor: 'vermelho' },
      { pessoa: html, cor: 'azul' },
      { pessoa: comprido, cor: 'amarelo' },
      eu,
    ]),
  });
  await expect(etiqueta(page, camDe(vazio))).toHaveText('Participante');
  await expect(botao(page, 'Aumentar a câmera de Participante')).toBeVisible();
  await expect(etiqueta(page, camDe(html))).toHaveText('<b>Ana</b>');
  await expect(botao(page, 'Aumentar a câmera de <b>Ana</b>')).toBeVisible();
  await expect(page.locator('.palco b')).toHaveCount(0);
  // O nome de 80 letras fica numa linha, dentro do quadro, cortado com reticências.
  const e = etiqueta(page, camDe(comprido));
  await expect(e).toHaveText(comprido.nome);
  dentro(await caixa(e), await caixa(quadro(page, camDe(comprido))), 'a etiqueta');
  const corte = await e.locator('span').last().evaluate((s) => ({
    linhas: s.getClientRects().length,
    alto: s.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(s).fontSize),
    cortado: s.scrollWidth > s.clientWidth,
    reticencias: getComputedStyle(s).textOverflow,
  }));
  expect(corte).toEqual({ linhas: 1, alto: true, cortado: true, reticencias: 'ellipsis' });
});

test('a conexão caída cobre o palco', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await darNaLigacao(page, { tipo: 'ligacao', qual: 'principal', o: 'semConexao' });
  const cartao = page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' });
  await expect(cartao).toBeVisible();
  const c = await caixa(page.locator('.caiu'));
  const a = await caixa(area(page));
  dentro(a, c, 'a área');
  // O cartão fica por cima dos quadros: o ponto do meio da área é dele.
  const deCima = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.caiu') !== null, {
    x: a.x + a.width / 2,
    y: a.y + a.height / 2,
  });
  expect(deCima).toBe(true);
});

const SEM_CONEXAO = { tipo: 'ligacao', qual: 'principal', o: 'semConexao' };
const cartaoDaQueda = (page: Page) => page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' });

/** A volta da conexão caída: depois da espera de 2 s, a página pede a senha pelo canal, ela chega, e a ligação sobe. */
async function voltar(page: Page, canal: Canal): Promise<void> {
  const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
  const antes = senhas();
  await page.clock.runFor(2_000);
  await expect.poll(senhas).toBe(antes + 1);
  canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  await subir(page, () => page.locator('.caiu').isHidden());
  await expect(cartaoDaQueda(page)).toBeHidden();
}

/** A ligação falsa confirma num setTimeout, que o relógio parado só roda quando o teste anda com ele: até a condição. */
async function subir(page: Page, pronto: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(async () => {
      await page.clock.runFor(10);
      return pronto();
    })
    .toBe(true);
}

/** O que o Tab alcança, a partir do título, numa volta pela página (até o primeiro que se repete). */
async function oQueOTabAlcanca(page: Page): Promise<string[]> {
  await titulo(page, 'Planejamento de dezembro').focus();
  const vistos: string[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    const qual = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'body';
      return el.dataset.quadro ?? el.dataset.voltar ?? el.dataset.botao ?? el.tagName;
    });
    if (vistos.includes(qual)) break;
    vistos.push(qual);
  }
  return vistos;
}

test('na conexão caída, o teclado não chega aos quadros, e a volta os traz de novo', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  await expect(botao(page, 'Ver todos')).toBeFocused();
  await darNaLigacao(page, SEM_CONEXAO);
  await expect(cartaoDaQueda(page)).toBeVisible();
  // Embaixo do cartão, nem os quadros nem o Ver todos recebem o Tab; os controles continuam.
  const naQueda = await oQueOTabAlcanca(page);
  expect(naQueda).toContain('microfone');
  expect(naQueda.filter((q) => q.includes(':') || q === 'voce' || q === 'verTodos')).toEqual([]);

  // A volta: a sincronia começa de novo, e o Carlos continua grande, com as cores e os nomes certos.
  await voltar(page, canal);
  await outraImagem(page);
  await page.clock.runFor(600);
  await outraImagem(page);
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  for (const [p, cor] of [
    [ANA, 'vermelho'],
    [CARLOS, 'azul'],
    [MARIA, 'amarelo'],
  ] as const) {
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-mostra', 'video');
    await expect.poll(() => corDo(page, camDe(p))).toBe(cor);
    await expect(etiqueta(page, camDe(p))).toHaveText(p.nome);
  }
  const depois = await oQueOTabAlcanca(page);
  expect(depois).toContain('verTodos');
  expect(depois).toContain(camDe(ANA));
});

test('depois do Sair e do Entrar de novo, os quadros voltam sem ninguém aumentado', async ({ page }) => {
  const { canal } = await naReuniaoCom(page, TRES);
  await quadro(page, camDe(CARLOS)).click();
  await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
  await botao(page, 'Sair').click();
  await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
  await expect(todosOsQuadros(page)).toHaveCount(0);

  const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
  const antes = senhas();
  await botao(page, 'Entrar de novo').click();
  await expect.poll(senhas).toBe(antes + 1);
  canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  await subir(page, () => page.getByRole('navigation', { name: 'Controles da reunião' }).isVisible());
  await comOPalco(page, canal, TRES);
  await expect(page.locator('[data-papel="grande"]')).toHaveCount(0);
  await expect(botao(page, 'Ver todos')).toBeHidden();
  for (const [p, cor] of [
    [ANA, 'vermelho'],
    [CARLOS, 'azul'],
    [MARIA, 'amarelo'],
  ] as const) {
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-papel', 'grade');
    await expect(quadro(page, camDe(p))).toHaveAttribute('data-mostra', 'video');
    await expect.poll(() => corDo(page, camDe(p))).toBe(cor);
    await expect(etiqueta(page, camDe(p))).toHaveText(p.nome);
  }
  await expect(quadro(page, 'voce')).toHaveAttribute('data-papel', 'canto');
});

/** O próximo getContext do <canvas> do quadro não dá o contexto: ele dá null, ou lança. Só uma vez. */
const falharOCanvas = (page: Page, chave: string, como: 'null' | 'lanca') =>
  quadro(page, chave)
    .locator('canvas')
    .evaluate((c: HTMLCanvasElement, como) => {
      const falso = c as unknown as { getContext?: () => null };
      falso.getContext = () => {
        delete falso.getContext;
        if (como === 'lanca') throw new Error('canvas de teste');
        return null;
      };
    }, como);

/** Os canvas dos quadros, apagados: o que aparecer depois foi pintado de novo. */
const apagarOsQuadros = (page: Page) =>
  page.evaluate(() => {
    for (const c of document.querySelectorAll<HTMLCanvasElement>('[data-quadro] canvas')) {
      (c.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, c.width, c.height);
    }
  });

test('um quadro que não pinta não para os outros', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  const cores = () => Promise.all([ANA, CARLOS, MARIA].map((p) => corDo(page, camDe(p))));
  // O getContext que dá null (o limite de memória dos canvas do Safari): o Carlos fica sem a pintura dessa imagem, e
  // os outros a recebem.
  await apagarOsQuadros(page);
  await falharOCanvas(page, camDe(CARLOS), 'null');
  await outraImagem(page);
  expect(await cores()).toEqual(['vermelho', 'nenhuma', 'amarelo']);
  await apagarOsQuadros(page);
  await outraImagem(page);
  expect(await cores()).toEqual(['vermelho', 'azul', 'amarelo']);
  // O que lança: as imagens seguintes pintam de novo.
  await falharOCanvas(page, camDe(CARLOS), 'lanca');
  await outraImagem(page);
  await expect.poll(() => mensagensDoConsole.some((m) => m.includes('canvas de teste'))).toBe(true);
  mensagensDoConsole = mensagensDoConsole.filter((m) => !m.includes('canvas de teste'));
  await apagarOsQuadros(page);
  await outraImagem(page);
  expect(await cores()).toEqual(['vermelho', 'azul', 'amarelo']);
});

test('o desenho que lança não leva os efeitos do evento', async ({ page }) => {
  // A conexão caída com um canvas que lança no desenho dela: a volta (o pedido da senha, 2 s depois) sai mesmo assim.
  const { canal } = await naReuniaoCom(page, TRES);
  await falharOCanvas(page, camDe(CARLOS), 'lanca');
  await darNaLigacao(page, SEM_CONEXAO);
  await expect(cartaoDaQueda(page)).toBeVisible();
  await voltar(page, canal);
  expect(mensagensDoConsole.filter((m) => m.startsWith('error'))).toEqual(['error desenhar']);
  mensagensDoConsole = mensagensDoConsole.filter((m) => m !== 'error desenhar');
  await outraImagem(page);
  await page.clock.runFor(600);
  await outraImagem(page);
  await expect.poll(() => corDo(page, camDe(CARLOS))).toBe('azul');
});

test.describe('na escala 3', () => {
  test.use({ deviceScaleFactor: 3 });

  test('o canvas tem até 2 pixels por ponto', async ({ page }) => {
    await naReuniaoCom(page, DOIS);
    const q = quadro(page, camDe(CARLOS));
    expect(await page.evaluate(() => devicePixelRatio)).toBe(3);
    expect(await pixelsDoCanvas(q)).toEqual(await tamanhoDoQuadro(q, 2));
    expect(await corDo(page, camDe(CARLOS))).toBe('azul');
  });
});

test.describe('sem o requestVideoFrameCallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const p = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
      delete p.requestVideoFrameCallback;
      delete p.cancelVideoFrameCallback;
    });
  });

  test('os quadros pintam pelo requestAnimationFrame', async ({ page }) => {
    const { canal } = await naReuniao(page);
    expect(await page.evaluate(() => 'requestVideoFrameCallback' in HTMLVideoElement.prototype)).toBe(false);
    canal.mandar(mensagemDo(TRES));
    await mosaico(page, TRES);
    await page.clock.runFor(600);
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-mostra', 'espera');
    await page.clock.runFor(50);
    for (const [p, cor] of [
      [ANA, 'vermelho'],
      [CARLOS, 'azul'],
      [MARIA, 'amarelo'],
    ] as const) {
      await expect(quadro(page, camDe(p))).toHaveAttribute('data-mostra', 'video');
      expect(await corDo(page, camDe(p))).toBe(cor);
    }
  });
});

test('a borda ciano aparece por cima da imagem', async ({ page }) => {
  // O que se vê de verdade: com o mouse em cima, ou com o foco do teclado, a borda de dentro do quadro é ciano; sem os
  // dois, é a imagem.
  await naReuniaoCom(page, TRES);
  await longeDosQuadros(page);
  expect(await bordaDo(page, camDe(CARLOS))).toEqual(['azul', 'azul', 'azul', 'azul']);
  await quadro(page, camDe(CARLOS)).hover();
  expect(await bordaDo(page, camDe(CARLOS))).toEqual(CIANO);
  await longeDosQuadros(page);
  expect(await bordaDo(page, camDe(CARLOS))).toEqual(['azul', 'azul', 'azul', 'azul']);
  // O foco do teclado: o Tab do título vai à Ana, e depois ao Carlos.
  await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(quadro(page, camDe(CARLOS))).toBeFocused();
  expect(await bordaDo(page, camDe(CARLOS))).toEqual(CIANO);
  expect(await bordaDo(page, camDe(ANA))).toEqual(['vermelho', 'vermelho', 'vermelho', 'vermelho']);

  // Na faixa também: o Enter aumenta o Carlos, e o Tab do Ver todos vai à Ana da faixa.
  await page.keyboard.press('Enter');
  await expect(botao(page, 'Ver todos')).toBeFocused();
  await expect.poll(() => corDo(page, camDe(ANA))).toBe('vermelho');
  expect(await bordaDo(page, camDe(ANA))).toEqual(['vermelho', 'vermelho', 'vermelho', 'vermelho']);
  await page.keyboard.press('Tab');
  await expect(quadro(page, camDe(ANA))).toBeFocused();
  expect(await bordaDo(page, camDe(ANA))).toEqual(CIANO);
});

test('a borda ciano fica dentro do quadro, e o Você por cima dela', async ({ page }) => {
  // Com 2 outros, o Você do canto fica por cima da beira de baixo do Carlos: a borda do Carlos não passa por ele.
  await naReuniaoCom(page, { largura: 1920, altura: 1080, quadros: emGrade(1920, 1080, 2, 2, [ana, carlos, eu]) });
  await quadro(page, camDe(CARLOS)).hover();
  const c = await caixa(quadro(page, camDe(CARLOS)));
  const v = await caixa(quadro(page, 'voce'));
  expect(v.y).toBeLessThan(c.y + c.height - 2);
  expect(v.x).toBeGreaterThan(c.x);
  const [noVoce] = await coresNaTela(page, [{ x: v.x + v.width / 2, y: c.y + c.height - 2 }]);
  expect(noVoce).not.toBe('ciano');
  // Fora do Você, a borda continua por cima da imagem do próprio quadro.
  expect(await bordaDo(page, camDe(CARLOS)).then((b) => [b[0], b[1]])).toEqual(['ciano', 'ciano']);
  expect(await coresNaTela(page, [{ x: c.x + (v.x - c.x) / 2, y: c.y + c.height - 2 }])).toEqual(['ciano']);
});

test.describe('o celular em pé, com o teclado', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('o toque não deixa a borda nem a pílula', async ({ page }) => {
    // Sem mouse, o :hover cai no que fica embaixo do último toque: as regras do mouse em cima só valem com um mouse.
    await naReuniaoCom(page, TRES);
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    const regras = await page.evaluate(() => {
      const achadas: string[] = [];
      const ler = (lista: CSSRuleList, dentroDe: string) => {
        for (const r of lista) {
          if (r instanceof CSSMediaRule) ler(r.cssRules, r.conditionText);
          else if (r instanceof CSSStyleRule && /quadro:hover/.test(r.selectorText)) {
            achadas.push(`${dentroDe} ${r.selectorText}`);
          }
        }
      };
      for (const folha of document.styleSheets) ler(folha.cssRules, '');
      return achadas;
    });
    expect(regras.length).toBeGreaterThanOrEqual(2);
    for (const r of regras) expect(r).toMatch(/^\(hover: hover\) /);
    // O toque não pisca e o toque duplo não seleciona o nome.
    const toque = await quadro(page, camDe(ANA)).evaluate((q) => {
      const s = getComputedStyle(q);
      return { selecao: s.userSelect, brilho: s.getPropertyValue('-webkit-tap-highlight-color') };
    });
    expect(toque).toEqual({ selecao: 'none', brilho: 'rgba(0, 0, 0, 0)' });

    // O toque no Carlos e no Ver todos: o quadro que fica embaixo do toque não tem a borda nem a pílula.
    await quadro(page, camDe(CARLOS)).tap();
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grande');
    const ver = await caixa(botao(page, 'Ver todos'));
    await botao(page, 'Ver todos').tap();
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('data-papel', 'grade');
    const embaixo = await page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-quadro]') as HTMLElement | null)?.dataset.quadro,
      { x: ver.x + ver.width / 2, y: ver.y + ver.height / 2 },
    );
    expect(embaixo).toBe(camDe(ANA));
    await expect(quadro(page, camDe(ANA)).locator('.pilula')).toBeHidden();
    const contorno = await quadro(page, camDe(ANA)).evaluate((b) => getComputedStyle(b, '::after').outlineStyle);
    expect(contorno).toBe('none');
  });

  test('a borda ciano do foco', async ({ page }) => {
    await naReuniaoCom(page, TRES);
    await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
    expect(await bordaDo(page, camDe(ANA))).toEqual(['vermelho', 'vermelho', 'vermelho', 'vermelho']);
    await page.keyboard.press('Tab');
    await expect(quadro(page, camDe(ANA))).toBeFocused();
    expect(await bordaDo(page, camDe(ANA))).toEqual(CIANO);
  });
});

test.describe('o foco não se perde quando a tela se arruma', () => {
  const noBody = (page: Page) => page.evaluate(() => document.activeElement === document.body);

  test('o Ver todos com o foco, e o compartilhamento começa', async ({ page }) => {
    // O palco da tela é de outro tamanho: ele entra pela imagem do mosaico, e não por um desenho do pagina.js.
    const { canal } = await naReuniaoCom(page, TRES);
    await quadro(page, camDe(CARLOS)).click();
    await expect(botao(page, 'Ver todos')).toBeFocused();
    canal.mandar(mensagemDo(comTela(ANA)));
    await outraImagem(page);
    await expect(botao(page, 'Ver todos')).toBeFocused();
    await mosaico(page, comTela(ANA));
    await expect(botao(page, 'Ver todos')).toBeHidden();
    // O foco vai ao quadro de quem era o grande, que agora é um botão da faixa.
    await expect(quadro(page, camDe(CARLOS))).toBeFocused();
    expect(await noBody(page)).toBe(false);
  });

  test('o Ver todos com o foco, e a pessoa aumentada sai', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, TRES);
    await quadro(page, camDe(CARLOS)).click();
    await expect(botao(page, 'Ver todos')).toBeFocused();
    canal.mandar(mensagemDo({ ...TRES, quadros: TRES.quadros.filter((q) => q.pessoa !== CARLOS) }));
    await expect(quadro(page, camDe(CARLOS))).toHaveCount(0);
    await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
  });

  test('o quadro com o foco, e a pessoa dele sai', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, QUATRO);
    await quadro(page, camDe(ANA)).focus();
    canal.mandar(mensagemDo({ ...QUATRO, quadros: QUATRO.quadros.filter((q) => q.pessoa !== ANA) }));
    await expect(quadro(page, camDe(ANA))).toHaveCount(0);
    await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
  });

  test('o quadro com o foco deixa de ser botão', async ({ page }) => {
    // A grade cai para um outro só: o quadro do Carlos vira uma imagem, e não um botão.
    const { canal } = await naReuniaoCom(page, TRES);
    await quadro(page, camDe(CARLOS)).focus();
    canal.mandar(mensagemDo({ ...TRES, quadros: TRES.quadros.filter((q) => q.pessoa === CARLOS || q.voce) }));
    await expect(quadro(page, camDe(CARLOS))).toHaveAttribute('role', 'img');
    await expect(titulo(page, 'Planejamento de dezembro')).toBeFocused();
  });

  test('o foco nos controles não é tocado', async ({ page }) => {
    const { canal } = await naReuniaoCom(page, TRES);
    await botao(page, 'Câmera').focus();
    await comOPalco(page, canal, comTela(ANA));
    await expect(quadro(page, telaDe(ANA))).toHaveAttribute('data-papel', 'grande');
    await expect(botao(page, 'Câmera')).toBeFocused();
    canal.mandar(mensagemDo(DOIS));
    await mosaico(page, DOIS);
    await page.clock.runFor(3_000);
    await expect(botao(page, 'Câmera')).toBeFocused();
  });
});

test('a página não quebra o CSP', async ({ page }) => {
  // As telas todas numa reunião: a grade, o mouse em cima (a pílula), a câmera aumentada, a tela, e o mosaico inteiro.
  const { canal } = await naReuniaoCom(page, QUATRO);
  await quadro(page, camDe(ANA)).hover();
  await expect(quadro(page, camDe(ANA)).locator('.pilula')).toBeVisible();
  await quadro(page, camDe(ANA)).click();
  await expect(botao(page, 'Ver todos')).toBeVisible();
  await comOPalco(page, canal, comTela(ANA));
  await quadro(page, camDe(CARLOS)).click();
  await expect(botao(page, 'Voltar para a tela')).toBeVisible();
  await mosaico(page, DOIS);
  await page.clock.runFor(3_000);
  await expect(todosOsQuadros(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
});
