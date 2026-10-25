// As zonas de redimensionar da interface (rc.2): o WebView2 cobre o alto da janela (e, na barra, faz o papel da barra
// de título), então a borda de cima, os cantos de cima e o canto de baixo à direita (o desenho do canto) são zonas da
// página, com o cursor de cada uma, que mandam o `resize` ao C++ no botão esquerdo apertado. Elas nunca cobrem os botões
// da barra de título.
import { expect, test, type Page } from '@playwright/test';
import { abrir, comandos, esperarComando, mudarEstado } from './helpers';

const ZONAS: Array<{ borda: string; cursor: string }> = [
  { borda: 'cima', cursor: 'ns-resize' },
  { borda: 'cima-esquerda', cursor: 'nwse-resize' },
  { borda: 'cima-direita', cursor: 'nesw-resize' },
  { borda: 'baixo-direita', cursor: 'nwse-resize' },
];

async function zona(page: Page, borda: string) {
  return page.locator(`[data-resize="${borda}"]`);
}

for (const [largura, altura, cenario] of [
  [400, 720, 'principal'],
  [340, 560, 'principal'],
  [300, 440, 'principal'],
  [400, 720, 'ligacao'],
  [300, 440, 'configuracoes'],
  [400, 720, 'entrar'],
] as Array<[number, number, string]>) {
  test.describe(`${cenario} em ${largura}×${altura}`, () => {
    test.use({ viewport: { width: largura, height: altura } });

    test('the resize zones sit on the edges with their cursors and leave the title bar buttons free', async ({ page }) => {
      await abrir(page, cenario);
      for (const { borda, cursor } of ZONAS) {
        const z = await zona(page, borda);
        await expect(z, borda).toHaveCount(1);
        const s = await z.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const c = getComputedStyle(e);
          return { x: r.x, y: r.y, w: r.width, h: r.height, cursor: c.cursor, regiao: c.getPropertyValue('app-region') || c.getPropertyValue('-webkit-app-region') };
        });
        expect(s.cursor, borda).toBe(cursor);
        // Fora da região de arrastar (senão o WebView2 trata o clique como a barra de título).
        expect(s.regiao, borda).toBe('no-drag');
        if (borda.startsWith('cima')) {
          expect(s.y, borda).toBe(0);
          expect(s.h, borda).toBeGreaterThanOrEqual(4);
          expect(s.h, borda).toBeLessThanOrEqual(8);
        } else {
          expect(Math.round(s.x + s.w), borda).toBe(largura);
          expect(Math.round(s.y + s.h), borda).toBe(altura);
          expect(s.w, borda).toBeCloseTo(16, 0);
          expect(s.h, borda).toBeCloseTo(16, 0);
        }
        if (borda === 'cima-esquerda') expect(s.x).toBe(0);
        if (borda === 'cima-direita') expect(Math.round(s.x + s.w)).toBe(largura);
      }
      // A faixa de cima não passa por cima dos botões da barra; o meio e as laterais dos botões continuam deles.
      const faixa = (await (await zona(page, 'cima')).boundingBox())!;
      for (const nome of ['Minimizar', cenario === 'entrar' ? 'Fechar' : 'Fechar para a bandeja']) {
        const botao = page.getByRole('button', { name: nome, exact: true });
        const b = (await botao.boundingBox())!;
        expect(faixa.x + faixa.width, `a faixa de cima cobre ${nome}`).toBeLessThanOrEqual(b.x + 0.5);
        const livre = await botao.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return [
            [r.left + r.width / 2, r.top + r.height / 2],
            [r.left + r.width / 2, r.top + 9],
            [r.left + 10, r.top + r.height / 2],
            [r.right - 10, r.top + r.height / 2],
          ].every(([x, y]) => {
            const alvo = document.elementFromPoint(x, y);
            return alvo !== null && (alvo === e || e.contains(alvo));
          });
        });
        expect(livre, `${nome} coberto por uma zona`).toBe(true);
      }
    });
  });
}

test('a left-button mousedown on each zone sends resize with the edge, and nothing else', async ({ page }) => {
  await abrir(page, 'principal');
  for (const { borda } of ZONAS) {
    const b = (await (await zona(page, borda)).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await esperarComando(page, { cmd: 'resize', borda });
  }
  // O botão direito não redimensiona.
  const antes = (await comandos(page)).filter((c) => c.cmd === 'resize').length;
  const b = (await (await zona(page, 'baixo-direita')).boundingBox())!;
  await page.mouse.move(b.x + 8, b.y + 8);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  expect((await comandos(page)).filter((c) => c.cmd === 'resize').length).toBe(antes);
  // Nem o clique na zona chega ao que está embaixo (a aba Contatos fica onde estava).
  await expect(page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
});

test('the corner drawing sits inside the grip zone', async ({ page }) => {
  await abrir(page, 'principal');
  const desenho = (await page.locator('nav .grip').boundingBox())!;
  const z = (await (await zona(page, 'baixo-direita')).boundingBox())!;
  expect(desenho.x).toBeGreaterThanOrEqual(z.x - 0.5);
  expect(desenho.y).toBeGreaterThanOrEqual(z.y - 0.5);
  expect(desenho.x + desenho.width).toBeLessThanOrEqual(z.x + z.width + 0.5);
  expect(desenho.y + desenho.height).toBeLessThanOrEqual(z.y + z.height + 0.5);
});

test('the notice window has no resize zones', async ({ page }) => {
  await page.goto('/aviso.html?fake=aviso');
  await expect(page.locator('[role="alertdialog"]')).toBeVisible();
  await expect(page.locator('[data-resize]')).toHaveCount(0);
});

test('the Rediscar tooltip closes with Esc and stays closed until the pointer leaves', async ({ page }) => {
  await abrir(page, 'principal');
  const rediscar = page.getByRole('button', { name: 'Rediscar 1150603000', exact: true });
  await rediscar.hover();
  const balao = page.getByRole('tooltip');
  await expect(balao).toHaveText('Rediscar 1150603000');
  await page.keyboard.press('Escape');
  await expect(balao).toHaveCount(0);
  await page.waitForTimeout(200);
  await expect(balao).toHaveCount(0);
  await page.mouse.move(5, 300);
  await rediscar.hover();
  await expect(balao).toHaveText('Rediscar 1150603000');
  // No foco também.
  await page.mouse.move(5, 300);
  await rediscar.focus();
  await expect(balao).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(balao).toHaveCount(0);
});

for (const [largura, altura, titulo] of [
  [340, 560, 'Recepção · 2001'],
  [300, 440, '2001'],
] as Array<[number, number, string]>) {
  test(`the call title bar at ${largura}×${altura} shows the busy status and the whole account`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'ligacao');
    await expect(page.locator('.titlebar .account-status')).toContainText('Ocupado · em ligação');
    const texto = page.locator('.titlebar .titlebar-text');
    await expect(texto).toHaveText(titulo);
    const corta = await texto.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
    expect(corta, 'a conta na barra de título está cortada').toBe(false);
  });
}

test('the call title bar in Normal keeps "Starsonic Phone · <conta>"', async ({ page }) => {
  await abrir(page, 'ligacao');
  await expect(page.locator('.titlebar .titlebar-text')).toHaveText('Starsonic Phone · Recepção · 2001');
});

// Na ligação, a barra de título mostra o estado da conta, e o erro de cadastro vence o "Ocupado · em ligação" (a tabela da
// rc.3): uma mensagem longa do C++ não empurra o Minimizar e o Fechar para fora da janela. O estado encolhe com
// reticências, os dois botões ficam onde estavam, inteiros na janela e livres (o ponto de dentro acerta neles).
const MENSAGEM_LONGA = 'Não foi possível falar com o servidor. Confira o endereço e a sua internet.';
for (const [largura, altura] of [
  [300, 440],
  [340, 560],
  [380, 640],
  [400, 720],
] as Array<[number, number]>) {
  test(`a long registration message in the call title bar keeps Minimizar and Fechar in the window at ${largura}×${altura}`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'ligacao');
    const nomes = ['Minimizar', 'Fechar para a bandeja'];
    const caixas = async () => Promise.all(nomes.map(async (nome) => (await page.getByRole('button', { name: nome, exact: true }).boundingBox())!));
    // Onde os botões ficam com o "Ocupado · em ligação" (o estado curto).
    const antes = await caixas();
    await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'erro', texto: MENSAGEM_LONGA } }));
    const estado = page.locator('.titlebar .account-status');
    await expect(estado).toContainText('Não foi possível falar com o servidor.');
    const depois = await caixas();
    for (const [i, nome] of nomes.entries()) {
      const b = depois[i];
      expect(b.x + b.width, `${nome} sai pela direita da janela: ${JSON.stringify(b)}`).toBeLessThanOrEqual(largura + 0.5);
      expect(Math.abs(b.x - antes[i].x), `${nome} saiu do lugar: ${JSON.stringify({ antes: antes[i], depois: b })}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(b.width - antes[i].width), `${nome} espremido: ${JSON.stringify({ antes: antes[i], depois: b })}`).toBeLessThanOrEqual(0.5);
      const livre = await page.getByRole('button', { name: nome, exact: true }).evaluate((e) => {
        const r = e.getBoundingClientRect();
        return [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + r.width / 2, r.top + 9],
          [r.left + 8, r.top + r.height / 2],
          [r.right - 8, r.top + r.height / 2],
        ].every(([x, y]) => {
          const alvo = document.elementFromPoint(x, y);
          return alvo !== null && (alvo === e || e.contains(alvo));
        });
      });
      expect(livre, `${nome} fora do alcance do clique: ${JSON.stringify(b)}`).toBe(true);
    }
    // O estado fica antes dos botões, com a bolinha e o começo do texto, e a página não rola na horizontal.
    const e = (await estado.boundingBox())!;
    expect(e.x + e.width, 'o estado passa do começo dos botões').toBeLessThanOrEqual(depois[0].x + 0.5);
    expect(e.width, 'o estado sumiu').toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'a página rola na horizontal').toBeLessThanOrEqual(largura);
  });
}
