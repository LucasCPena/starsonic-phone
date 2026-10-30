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
 * (o elementFromPoint, como o toque do iPhone), pela bissecção. O ponto cai no alvo quando acha ele ou algo dentro dele
 * (o ícone de um botão, o campo dentro do rótulo que o envolve). O alvo fica inteiro na tela: fora dela, o
 * elementFromPoint não acha nada.
 */
export async function areaDoToque(nome: string, alvo: Locator): Promise<AreaDoToque> {
  const medidas = await alvo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const acerta = (x: number, y: number) => {
      const achado = document.elementFromPoint(x, y);
      return achado !== null && el.contains(achado);
    };
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

/** As medidas de cada alvo, na ordem. */
export async function medirAreas(alvos: Array<[nome: string, alvo: Locator]>): Promise<AreaDoToque[]> {
  const areas: AreaDoToque[] = [];
  for (const [nome, alvo] of alvos) areas.push(await areaDoToque(nome, alvo));
  return areas;
}

/** Os alvos com a área do toque menor que 44×44 px, com a medida ("Menu: 40.0×40.0"). */
export function menoresQue44(areas: AreaDoToque[]): string[] {
  return areas
    .filter(({ toque }) => toque.direita - toque.esquerda < 43.99 || toque.baixo - toque.cima < 43.99)
    .map(({ nome, toque }) => `${nome}: ${(toque.direita - toque.esquerda).toFixed(1)}×${(toque.baixo - toque.cima).toFixed(1)}`);
}

/** Os pares de alvos com as áreas do toque uma por cima da outra. */
export function areasQueSeCobrem(areas: AreaDoToque[]): string[] {
  const pares: string[] = [];
  for (const [i, a] of areas.entries()) {
    for (const b of areas.slice(i + 1)) {
      const cruzam =
        a.toque.esquerda < b.toque.direita - 0.01 &&
        b.toque.esquerda < a.toque.direita - 0.01 &&
        a.toque.cima < b.toque.baixo - 0.01 &&
        b.toque.cima < a.toque.baixo - 0.01;
      if (cruzam) pares.push(`${a.nome} e ${b.nome}`);
    }
  }
  return pares;
}

/**
 * Cada alvo com a área do toque de pelo menos 44×44 px (os 44 pontos do iPhone) e nenhuma área cobrindo a de outro: cada
 * toque cai no alvo que a pessoa vê. Devolve as medidas, na ordem, para o caso conferir que o desenho continua o de
 * sempre.
 */
export async function areasDe44(alvos: Array<[nome: string, alvo: Locator]>): Promise<AreaDoToque[]> {
  const areas = await medirAreas(alvos);
  expect(menoresQue44(areas), 'os alvos com a área do toque menor que 44×44 px').toEqual([]);
  expect(areasQueSeCobrem(areas), 'as áreas do toque que se cobrem').toEqual([]);
  return areas;
}

/**
 * Os alvos de toque de uma parte da tela (`raiz`): cada botão, campo, lista de escolha, link, papel de botão ou de item
 * de menu, e cada rótulo que envolve um campo (o rótulo é o alvo dele: o toque nele vai ao campo, como nos segmentos
 * UDP/TCP e na busca), visível e inteiro na tela (fora dela e cortado por uma lista que rola, ele é medido quando chega à
 * vista). Cada um com um nome para as mensagens: o aria-label, o texto ou o placeholder.
 */
export async function alvosDeToque(raiz: Locator): Promise<Array<[nome: string, alvo: Locator]>> {
  const marcados = await raiz.evaluate((topo) => {
    for (const velho of document.querySelectorAll('[data-alvo-de-toque]')) velho.removeAttribute('data-alvo-de-toque');
    const SELETOR =
      'button, a[href], select, textarea, input:not([type="hidden"]), [role="button"], [role="switch"], [role="menuitem"], [role="menuitemradio"], label:has(input)';
    const inteiro = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) return false;
      for (let acima = el.parentElement; acima; acima = acima.parentElement) {
        const s = getComputedStyle(acima);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const c = acima.getBoundingClientRect();
        const esquerda = c.left + acima.clientLeft;
        const cima = c.top + acima.clientTop;
        if (r.left < esquerda - 0.5 || r.top < cima - 0.5 || r.right > esquerda + acima.clientWidth + 0.5 || r.bottom > cima + acima.clientHeight + 0.5) {
          return false;
        }
      }
      return true;
    };
    const alvos = Array.from(topo.querySelectorAll(SELETOR))
      // O campo dentro de um rótulo conta pelo rótulo.
      .filter((el) => !(el.matches('input, select, textarea') && el.closest('label')))
      .filter((el) => el.checkVisibility({ visibilityProperty: true }) && inteiro(el));
    return alvos.map((el, i) => {
      el.setAttribute('data-alvo-de-toque', String(i));
      const texto = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      return el.getAttribute('aria-label') || texto.slice(0, 40) || el.getAttribute('placeholder') || el.tagName.toLowerCase();
    });
  });
  return marcados.map((nome, i): [string, Locator] => [nome, raiz.page().locator(`[data-alvo-de-toque="${i}"]`)]);
}

/** A foto da tela (o `capturar` de sempre), em test-results/capturas/ios-<nome>-<largura>x<altura>-<tema>.png. */
export async function capturarIos(page: Page, nome: string, tamanho: TamanhoIphone, tema: string): Promise<void> {
  await capturar(page, `ios-${nome}-${tamanho.largura}x${tamanho.altura}`, tema);
}
