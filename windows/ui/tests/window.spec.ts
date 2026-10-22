// A janela mais baixa que 720 px (a área de trabalho de um notebook de 1920×1080 a 150% tem uns 672 px lógicos; o
// executável corta a altura da janela na da área de trabalho). O teclado é a função da tela: as 12 teclas e o Ligar
// ficam sempre inteiros, sem rolar, de 720 até 640, com 0 a 3 sugestões de contatos; as sugestões ficam com o espaço
// que sobra, numa lista que rola sozinha e mostra pelo menos uma. Mais baixa que 640, a parte das teclas rola sem
// cobrir o Ligar.
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
  return box.y >= -0.5 && box.x >= -0.5 && box.y + box.height <= altura + 0.5 && box.x + box.width <= largura + 0.5;
}

function contem(fora: Caixa, box: Caixa): boolean {
  return box.y >= fora.y - 0.5 && box.y + box.height <= fora.y + fora.height + 0.5;
}

// O que digitar para ter 0, 1, 2 e 3 sugestões com os contatos do cenário principal (2003, 2007, 2010 e
// (11) 5060-3000).
const SUGESTOES: Array<[number, string]> = [
  [0, ''],
  [1, '2003'],
  [2, '200'],
  [3, '20'],
];

/** As 12 teclas, o Ligar e a navegação inteiros, sem rolar e sem um cobrir o outro. */
async function conferirTeclado(page: Page, altura: number, sugestoes: number): Promise<void> {
  const teclas = page.locator('.keys .key');
  await expect(teclas).toHaveCount(12);
  const ligar = await caixa(page.locator('button.btn-call'));
  const nav = await caixa(page.locator('nav.nav'));
  const meio = await caixa(page.locator('.teclado-meio'));
  expect(dentro(ligar, altura), `o Ligar fora da janela: ${JSON.stringify(ligar)}`).toBe(true);
  expect(dentro(nav, altura), `a navegação fora da janela: ${JSON.stringify(nav)}`).toBe(true);
  expect(ligar.y + ligar.height <= nav.y + 0.5, `o Ligar cobre a navegação: ${JSON.stringify({ ligar, nav })}`).toBe(true);
  // A parte das teclas não rola: nada escondido, nada deslocado.
  const rolagem = await page.locator('.teclado-meio').evaluate((e) => ({
    top: e.scrollTop,
    sobra: e.scrollHeight - e.clientHeight,
  }));
  expect(rolagem.top, 'a parte das teclas está rolada').toBe(0);
  expect(rolagem.sobra, 'a parte das teclas esconde algo embaixo').toBeLessThanOrEqual(0.5);
  for (let i = 0; i < 12; i++) {
    const tecla = await caixa(teclas.nth(i));
    expect(dentro(tecla, altura) && contem(meio, tecla), `a tecla ${i + 1} não está inteira: ${JSON.stringify({ tecla, meio })}`).toBe(
      true,
    );
    expect(tecla.y + tecla.height <= ligar.y + 0.5, `o Ligar cobre a tecla ${i + 1}`).toBe(true);
  }
  const lista = page.locator('.suggestions');
  if (sugestoes === 0) {
    await expect(lista).toHaveCount(0);
    return;
  }
  await expect(page.locator('.suggest')).toHaveCount(sugestoes);
  // Pelo menos uma sugestão inteira à vista, acima das teclas, dentro da lista (que rola sozinha).
  const area = await caixa(lista);
  const primeira = await caixa(page.locator('.suggest').first());
  expect(contem(area, primeira) && primeira.height >= 20, `nenhuma sugestão inteira: ${JSON.stringify({ area, primeira })}`).toBe(
    true,
  );
  const tecla1 = await caixa(teclas.nth(0));
  expect(area.y + area.height <= tecla1.y + 0.5, `as sugestões cobrem as teclas: ${JSON.stringify({ area, tecla1 })}`).toBe(true);
}

for (const altura of [720, 672, 640]) {
  test.describe(`a janela de 400×${altura}`, () => {
    test.use({ viewport: { width: 400, height: altura } });

    for (const [quantas, digitos] of SUGESTOES) {
      test(`the 12 keys and Ligar stay whole with ${quantas} suggestion(s)`, async ({ page }) => {
        await abrir(page, 'principal');
        if (digitos) await page.getByRole('textbox', { name: 'Número' }).fill(digitos);
        await conferirTeclado(page, altura, quantas);
        if (altura === 640 && (quantas === 0 || quantas === 3)) {
          await capturar(page, `janela-curta-${altura}-${quantas}-sugestoes`, 'claro');
        }
      });
    }

    test('the call screen keeps Desligar inside the window', async ({ page }) => {
      await abrir(page, 'ligacao');
      const desligar = await caixa(page.getByRole('button', { name: 'Desligar', exact: true }));
      expect(dentro(desligar, altura), JSON.stringify(desligar)).toBe(true);
    });
  });
}

test.describe('a janela mais baixa que 640', () => {
  test.use({ viewport: { width: 400, height: 480 } });

  test('the keys scroll instead of overlapping Ligar', async ({ page }) => {
    await abrir(page, 'principal');
    const ligar = await caixa(page.locator('button.btn-call'));
    const nav = await caixa(page.locator('nav.nav'));
    expect(dentro(ligar, 480) && dentro(nav, 480)).toBe(true);
    expect(ligar.y + ligar.height <= nav.y + 0.5).toBe(true);
    const meio = page.locator('.teclado-meio');
    expect(await meio.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await meio.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const area = await caixa(meio);
    const ultima = await caixa(page.locator('.keys .key').nth(11));
    expect(Math.abs(ultima.y + ultima.height - (area.y + area.height)) <= 1, JSON.stringify({ ultima, area })).toBe(true);
    expect(area.y + area.height <= ligar.y + 0.5, JSON.stringify({ area, ligar })).toBe(true);
  });
});
