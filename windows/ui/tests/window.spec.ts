// A janela mais baixa que 720 px (a área de trabalho de um notebook de 1920×1080 a 150% tem uns 672 px lógicos; o
// executável corta a altura da janela na da área de trabalho): o teclado, o Ligar e a navegação continuam inteiros,
// dentro da janela e sem um cobrir o outro. Mais baixa que isso, o corpo rola em vez de sobrepor.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, capturar } from './helpers';

interface Caixa {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function caixa(locator: Locator): Promise<Caixa> {
  const box = await locator.boundingBox();
  expect(box, 'sem caixa: elemento invisível').not.toBeNull();
  return box!;
}

function dentro(box: Caixa, altura: number, largura = 400): boolean {
  return box.y >= 0 && box.x >= 0 && box.y + box.height <= altura + 0.5 && box.x + box.width <= largura + 0.5;
}

/**
 * O Ligar e a navegação inteiros na janela, nessa ordem, sem sobrepor, e a parte que rola (as sugestões e as teclas)
 * acima do Ligar. `inteiro`: as 12 teclas cabem sem rolar. Sem `inteiro`, a última tecla aparece rolando, acima do
 * Ligar.
 */
async function conferirTeclado(page: Page, altura: number, inteiro: boolean): Promise<void> {
  const teclas = page.locator('.keys .key');
  await expect(teclas).toHaveCount(12);
  const meio = await caixa(page.locator('.teclado-meio'));
  const ligar = await caixa(page.locator('button.btn-call'));
  const nav = await caixa(page.locator('nav.nav'));
  for (const [nome, box] of [['Ligar', ligar], ['navegação', nav], ['teclas e sugestões', meio]] as const) {
    expect(dentro(box, altura), `${nome} fora da janela de ${altura} px: ${JSON.stringify(box)}`).toBe(true);
  }
  expect(meio.y + meio.height <= ligar.y + 0.5, `o Ligar cobre as teclas: ${JSON.stringify({ meio, ligar })}`).toBe(true);
  expect(ligar.y + ligar.height <= nav.y + 0.5, `o Ligar cobre a navegação: ${JSON.stringify({ ligar, nav })}`).toBe(true);
  if (inteiro) {
    const primeira = await caixa(teclas.nth(0));
    const ultima = await caixa(teclas.nth(11));
    expect(primeira.y >= meio.y - 0.5 && ultima.y + ultima.height <= meio.y + meio.height + 0.5,
      `as teclas não cabem sem rolar: ${JSON.stringify({ primeira, ultima, meio })}`).toBe(true);
    expect(await page.locator('.teclado-meio').evaluate((e) => e.scrollHeight <= e.clientHeight + 0.5)).toBe(true);
  } else {
    // A parte das teclas rola: no fim dela, a última tecla termina acima do Ligar.
    expect(await page.locator('.teclado-meio').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await page.locator('.teclado-meio').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const ultima = await caixa(teclas.nth(11));
    expect(Math.abs(ultima.y + ultima.height - (meio.y + meio.height)) <= 1 && ultima.y + ultima.height <= ligar.y + 0.5,
      `a última tecla, rolando, não fica acima do Ligar: ${JSON.stringify({ ultima, meio, ligar })}`).toBe(true);
  }
  // Cada tecla continua do tamanho de um dedo (o mínimo do grid é 40 px).
  for (let i = 0; i < 12; i++) {
    expect((await caixa(teclas.nth(i))).height).toBeGreaterThanOrEqual(39.5);
  }
}

for (const altura of [672, 640]) {
  test.describe(`a janela de 400×${altura}`, () => {
    test.use({ viewport: { width: 400, height: altura } });

    test('the keypad, Ligar and the nav fit without overlapping', async ({ page }) => {
      await abrir(page, 'principal');
      await conferirTeclado(page, altura, true);
      await capturar(page, `janela-curta-${altura}`, 'claro');
    });

    test('with the contact suggestions Ligar stays in view and the keys scroll', async ({ page }) => {
      await abrir(page, 'principal');
      await page.getByRole('textbox', { name: 'Número' }).fill('200');
      await expect(page.locator('.suggestions')).toBeVisible();
      await conferirTeclado(page, altura, false);
      await capturar(page, `janela-curta-${altura}-sugestoes`, 'claro');
    });

    test('the call screen keeps Desligar inside the window', async ({ page }) => {
      await abrir(page, 'ligacao');
      const desligar = await caixa(page.getByRole('button', { name: 'Desligar', exact: true }));
      expect(dentro(desligar, altura), JSON.stringify(desligar)).toBe(true);
    });
  });
}

test.describe('a janela mais baixa que o mínimo', () => {
  test.use({ viewport: { width: 400, height: 480 } });

  test('the keys scroll instead of overlapping Ligar', async ({ page }) => {
    await abrir(page, 'principal');
    await conferirTeclado(page, 480, false);
  });
});
