// O que as specs do vídeo usam contra a ponte falsa: as cores I420 lisas (e o RGB em que o desenho as põe), o quadro
// gravado na memória de uma vista (o escritor do executável, pelo `__fake.quadro`), a cor de um ponto da tela e a página
// sem o WebGL (o desenho cai no canvas 2D).
import { expect, type Locator, type Page } from '@playwright/test';
import type { Plano } from '../../src/video/memoria';
import type { VistaDeVideoNome } from '../../src/state';

/** Vira [255, 1, 0]. */
export const VERMELHO: [number, number, number] = [82, 90, 240];
/** Vira [255, 255, 255]. */
export const BRANCO: [number, number, number] = [235, 128, 128];
/** Vira [0, 0, 0]. */
export const PRETO: [number, number, number] = [16, 128, 128];
/** O fundo da área do vídeo e das faixas da imagem encaixada (o #04060e), em RGB. */
export const FUNDO: [number, number, number] = [4, 6, 14];

interface Escritor {
  quadro(vista: VistaDeVideoNome, largura: number, altura: number, y: Plano, u: Plano, v: Plano): boolean;
}

/**
 * Grava um quadro de uma cor só (Y, U e V) na memória da vista: espera uma vista da página com o `data-vista` dela e o
 * `data-memoria` (a memória já chegou à página) e grava pelo `__fake.quadro`.
 */
export async function quadro(page: Page, vista: VistaDeVideoNome, yuv: [number, number, number], largura = 640, altura = 480): Promise<void> {
  await expect(page.locator(`[data-vista="${vista}"][data-memoria]`).first(), `a vista ${vista} com a memória`).toBeAttached();
  const gravou = await page.evaluate(
    ({ vista, largura, altura, yuv: [y, u, v] }) => (window as unknown as { __fake: Escritor }).__fake.quadro(vista, largura, altura, y, u, v),
    { vista, largura, altura, yuv },
  );
  expect(gravou, `a ponte falsa sem a memória da vista ${vista}`).toBe(true);
}

/**
 * A cor do pixel (x, y) da tela, como ela aparece: uma captura de 1×1, lida na própria página (o PNG em `data:`, desenhado
 * num canvas e lido pelo getImageData).
 */
export async function corNoPonto(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (url) => {
    const imagem = new Image();
    imagem.src = url;
    await imagem.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const g = canvas.getContext('2d')!;
    g.drawImage(imagem, 0, 0);
    const [r, verde, b] = g.getImageData(0, 0, 1, 1).data;
    return [r, verde, b] as [number, number, number];
  }, `data:image/png;base64,${png.toString('base64')}`);
}

/** A cor do meio do alvo. */
export async function corNoMeio(page: Page, alvo: Locator): Promise<[number, number, number]> {
  const caixa = await alvo.boundingBox();
  expect(caixa, 'o alvo na tela').not.toBeNull();
  return corNoPonto(page, Math.floor(caixa!.x + caixa!.width / 2), Math.floor(caixa!.y + caixa!.height / 2));
}

/** A página sem o WebGL: o `getContext` devolve `null` para o `webgl`, o `webgl2` e o `experimental-webgl`. */
export async function semWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    const semEstes = ['webgl', 'webgl2', 'experimental-webgl'];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, tipo: string, ...resto: unknown[]) {
      return semEstes.includes(tipo) ? null : original.call(this, tipo, ...resto);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

/** A cor perto da esperada: cada canal a no máximo `tolerancia` (o arredondamento da placa de vídeo pode mudar um). */
export function perto(cor: number[], esperada: number[], tolerancia = 2): boolean {
  return cor.length === esperada.length && cor.every((c, i) => Math.abs(c - esperada[i]) <= tolerancia);
}

/** Espera `n` quadros de tela da página (a leitura das vistas roda a cada um). */
export async function quadrosDeTela(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((pronto) => {
        const proximo = () => (--n === 0 ? pronto() : requestAnimationFrame(proximo));
        requestAnimationFrame(proximo);
      }),
    n,
  );
}
