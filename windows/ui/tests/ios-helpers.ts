// O que as specs do modo iPhone usam (spec do iPhone, 11.2; docs/ponte-windows.md, "O modo iPhone"): os três tamanhos
// do iPhone com a área segura de cada um, abrir um cenário da ponte falsa no modo iPhone (?plataforma=ios), conferir que
// nada fica embaixo do entalhe ou da barra de baixo, a área do toque de 44×44 px dos alvos pequenos, e as fotos que vão
// ao responsável. O Chromium não tem o entalhe: a área segura vem das variáveis --safe-* (o app.css as define com o
// env(safe-area-inset-*)), postas no style do :root.
import { expect, type Locator, type Page } from '@playwright/test';
import type { AgendaPermission } from '../src/state';
import { capturar } from './helpers';

export { semViolacoesSerias } from './helpers';

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
 * Abre o cenário da ponte falsa no modo iPhone, no viewport do tamanho com o toque e o modo móvel, e põe a área segura
 * do tamanho nas variáveis --safe-* do style do :root. `agenda`: a permissão dos contatos (sem ela, concedida);
 * `abrir`: um `abrir` pedido antes do `ready` (o app aberto pelo aviso da perdida), que vem no `ready`.
 */
export async function abrirIos(
  page: Page,
  cenario: string,
  tamanho: TamanhoIphone,
  opcoes: { agenda?: AgendaPermission; abrir?: 'recentes' } = {},
): Promise<void> {
  expect(page.viewportSize(), 'o viewport do tamanho: o describe usa o test.use(noIphone(tamanho))').toEqual({
    width: tamanho.largura,
    height: tamanho.altura,
  });
  const agenda = opcoes.agenda ? `&agenda=${opcoes.agenda}` : '';
  const abrir = opcoes.abrir ? `&abrir=${opcoes.abrir}` : '';
  await page.goto(`/index.html?fake=${cenario}&plataforma=ios${agenda}${abrir}`);
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

/** Uma caixa na tela, em pixels de CSS. */
export interface Caixa {
  esquerda: number;
  direita: number;
  cima: number;
  baixo: number;
}

/** Uma área do toque medida: o nome do alvo, a caixa do desenho dele e a área do toque. */
export interface AreaDoToque {
  nome: string;
  desenho: Caixa;
  toque: Caixa;
}

/** A largura e a altura de uma caixa, arredondadas (o desenho de um alvo). */
export function tamanhoDe(c: Caixa): [number, number] {
  return [Math.round(c.direita - c.esquerda), Math.round(c.baixo - c.cima)];
}

/**
 * A caixa do desenho de um alvo e a área do toque dele: até onde, do meio do alvo para cada lado, um ponto ainda cai nele
 * (o elementFromPoint, como o toque do iPhone), pela bissecção. O ponto acha o controle (o botão, a lista de escolha ou o
 * campo) em que cai. O alvo fica inteiro na tela: fora dela, o elementFromPoint não acha nada.
 */
export async function areaDoToque(nome: string, alvo: Locator): Promise<AreaDoToque> {
  const medidas = await alvo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const acerta = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('button, select, input') === el;
    const alcance = (ponto: (d: number) => [number, number]) => {
      let dentro = 0;
      let fora = 500;
      for (let i = 0; i < 40; i++) {
        const meio = (dentro + fora) / 2;
        if (acerta(...ponto(meio))) dentro = meio;
        else fora = meio;
      }
      return dentro;
    };
    return {
      naTela: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      desenho: { esquerda: r.left, direita: r.right, cima: r.top, baixo: r.bottom },
      toque: {
        esquerda: cx - alcance((d) => [cx - d, cy]),
        direita: cx + alcance((d) => [cx + d, cy]),
        cima: cy - alcance((d) => [cx, cy - d]),
        baixo: cy + alcance((d) => [cx, cy + d]),
      },
    };
  });
  expect(medidas.naTela, `${nome}: inteiro na tela`).toBe(true);
  return { nome, desenho: medidas.desenho, toque: medidas.toque };
}

/**
 * Cada alvo com a área do toque de pelo menos 44×44 px (os 44 pontos do iPhone) e nenhuma área cobrindo a de outro: cada
 * toque cai no alvo que a pessoa vê. Devolve as medidas, na ordem, para o caso conferir que o desenho continua o de
 * sempre.
 */
export async function areasDe44(alvos: Array<[nome: string, alvo: Locator]>): Promise<AreaDoToque[]> {
  const areas: AreaDoToque[] = [];
  for (const [nome, alvo] of alvos) areas.push(await areaDoToque(nome, alvo));
  for (const { nome, toque } of areas) {
    expect(toque.direita - toque.esquerda, `${nome}: a largura do toque`).toBeGreaterThanOrEqual(43.99);
    expect(toque.baixo - toque.cima, `${nome}: a altura do toque`).toBeGreaterThanOrEqual(43.99);
  }
  for (const [i, a] of areas.entries()) {
    for (const b of areas.slice(i + 1)) {
      const cruzam =
        a.toque.esquerda < b.toque.direita - 0.01 &&
        b.toque.esquerda < a.toque.direita - 0.01 &&
        a.toque.cima < b.toque.baixo - 0.01 &&
        b.toque.cima < a.toque.baixo - 0.01;
      expect(cruzam, `${a.nome} e ${b.nome} não se cobrem`).toBe(false);
    }
  }
  return areas;
}

/** A foto da tela (o `capturar` de sempre), em test-results/capturas/ios-<nome>-<largura>x<altura>-<tema>.png. */
export async function capturarIos(page: Page, nome: string, tamanho: TamanhoIphone, tema: string): Promise<void> {
  await capturar(page, `ios-${nome}-${tamanho.largura}x${tamanho.altura}`, tema);
}
