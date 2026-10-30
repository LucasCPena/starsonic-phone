// O que as specs do modo iPhone usam (spec do iPhone, 11.2; docs/ponte-windows.md, "O modo iPhone"): os três tamanhos
// do iPhone com a área segura de cada um, abrir um cenário da ponte falsa no modo iPhone (?plataforma=ios), conferir que
// nada fica embaixo do entalhe ou da barra de baixo, e as fotos que vão ao responsável. O Chromium não tem o entalhe: a
// área segura vem das variáveis --safe-* (o app.css as define com o env(safe-area-inset-*)), postas no style do :root.
import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgendaPermission } from '../src/state';

export { semViolacoesSerias } from './helpers';

const CAPTURAS = fileURLToPath(new URL('../test-results/capturas/', import.meta.url));

/** Um tamanho do iPhone, em pixels de CSS, com a área segura e a escala da tela do aparelho. */
export interface TamanhoIphone {
  largura: number;
  altura: number;
  /** A área segura de cima (a barra de status, ou o entalhe) e a de baixo (a barra de voltar ao início). */
  topo: number;
  base: number;
  /** Os pixels da tela por pixel de CSS: as fotos saem na resolução do aparelho. */
  escala: number;
}

/** Os tamanhos da spec (11.2): sem o entalhe (375×667), com o entalhe (390×844) e com a ilha (430×932). */
export const TAMANHOS_IPHONE: readonly TamanhoIphone[] = [
  { largura: 375, altura: 667, topo: 20, base: 0, escala: 2 },
  { largura: 390, altura: 844, topo: 47, base: 34, escala: 3 },
  { largura: 430, altura: 932, topo: 59, base: 34, escala: 3 },
];

/**
 * As opções do Playwright de um tamanho, para o `test.use` do describe: o viewport e a escala, com o toque (hasTouch) e
 * o modo móvel (isMobile, que lê o <meta name="viewport">). Elas são do contexto, e não da página: o abrirIos confere.
 */
export function noIphone(tamanho: TamanhoIphone) {
  return {
    viewport: { width: tamanho.largura, height: tamanho.altura },
    deviceScaleFactor: tamanho.escala,
    hasTouch: true,
    isMobile: true,
  };
}

/**
 * Abre o cenário da ponte falsa no modo iPhone (`agenda`: a permissão dos contatos; sem ela, concedida), no viewport do
 * tamanho com o toque e o modo móvel, e põe a área segura do tamanho nas variáveis --safe-* do style do :root.
 */
export async function abrirIos(page: Page, cenario: string, tamanho: TamanhoIphone, opcoes: { agenda?: AgendaPermission } = {}): Promise<void> {
  expect(page.viewportSize(), 'o viewport do tamanho: o describe usa o test.use(noIphone(tamanho))').toEqual({
    width: tamanho.largura,
    height: tamanho.altura,
  });
  const agenda = opcoes.agenda ? `&agenda=${opcoes.agenda}` : '';
  await page.goto(`/index.html?fake=${cenario}&plataforma=ios${agenda}`);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
  expect(await page.evaluate(() => navigator.maxTouchPoints), 'o toque: o describe usa o test.use(noIphone(tamanho))').toBeGreaterThan(0);
  await page.evaluate(({ topo, base }) => {
    const raiz = document.documentElement.style;
    raiz.setProperty('--safe-top', `${topo}px`);
    raiz.setProperty('--safe-bottom', `${base}px`);
    raiz.setProperty('--safe-left', '0px');
    raiz.setProperty('--safe-right', '0px');
  }, tamanho);
}

/**
 * A caixa de cada elemento que os seletores acham fica dentro da área segura: entre o --safe-top e a altura menos o
 * --safe-bottom (e entre o --safe-left e a largura menos o --safe-right). Meio pixel de folga, das escalas.
 */
export async function dentroDaAreaSegura(page: Page, seletores: string[]): Promise<void> {
  const area = await page.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);
    const px = (nome: string) => parseFloat(raiz.getPropertyValue(nome));
    return {
      topo: px('--safe-top'),
      base: px('--safe-bottom'),
      esquerda: px('--safe-left'),
      direita: px('--safe-right'),
      largura: window.innerWidth,
      altura: window.innerHeight,
    };
  });
  for (const [nome, valor] of Object.entries(area)) expect(Number.isFinite(valor), `${nome}: o abrirIos põe a área segura`).toBe(true);
  for (const seletor of seletores) {
    const caixas = await page.locator(seletor).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { cima: r.top, baixo: r.bottom, esquerda: r.left, direita: r.right };
      }),
    );
    expect(caixas.length, `${seletor}: nenhum na tela`).toBeGreaterThan(0);
    for (const c of caixas) {
      expect(c.cima, `${seletor}: embaixo dos ${area.topo} px de cima`).toBeGreaterThanOrEqual(area.topo - 0.5);
      expect(c.baixo, `${seletor}: em cima dos ${area.base} px de baixo`).toBeLessThanOrEqual(area.altura - area.base + 0.5);
      expect(c.esquerda, `${seletor}: à direita dos ${area.esquerda} px da esquerda`).toBeGreaterThanOrEqual(area.esquerda - 0.5);
      expect(c.direita, `${seletor}: à esquerda dos ${area.direita} px da direita`).toBeLessThanOrEqual(area.largura - area.direita + 0.5);
    }
  }
}

/** A foto da tela, em test-results/capturas/ios-<nome>-<largura>x<altura>-<tema>.png. */
export async function capturarIos(page: Page, nome: string, tamanho: TamanhoIphone, tema: string): Promise<void> {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  // O ponteiro na faixa de cima (a da barra de status): nenhum botão em hover na foto.
  await page.mouse.move(1, 1);
  await page.screenshot({ path: join(CAPTURAS, `ios-${nome}-${tamanho.largura}x${tamanho.altura}-${tema}.png`) });
}
