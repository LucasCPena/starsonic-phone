// O tamanho da janela (rc.2: a pessoa arrasta a borda ou o canto, de 300×440 até a área de trabalho; o executável
// também corta a altura na da área de trabalho, e a de um notebook de 1920×1080 a 150% tem uns 672 px lógicos). A
// interface tem três layouts: Normal, Compacto e Mínimo (app.css). O teclado é a função da tela: as 12 teclas, o
// Rediscar, o Ligar e a navegação ficam sempre inteiros, sem rolar e sem um cobrir o outro, em todo tamanho que a
// janela pode ter, com 0 a 3 sugestões de contatos; as sugestões ficam com o espaço que sobra, numa lista que rola
// sozinha e mostra pelo menos uma.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, capturar, empurrar, esperarComando, semViolacoesSerias } from './helpers';

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

function dentro(box: Caixa, altura: number, largura: number): boolean {
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

/** As 12 teclas, o Rediscar, o Ligar e a navegação inteiros, sem rolar e sem um cobrir o outro. */
async function conferirTeclado(page: Page, altura: number, sugestoes: number, largura = 400): Promise<void> {
  const teclas = page.locator('.keys .key');
  await expect(teclas).toHaveCount(12);
  const ligar = await caixa(page.locator('button.btn-call'));
  const rediscar = await caixa(page.locator('button.btn-redial'));
  const nav = await caixa(page.locator('nav.nav'));
  const meio = await caixa(page.locator('.teclado-meio'));
  expect(dentro(ligar, altura, largura), `o Ligar fora da janela: ${JSON.stringify(ligar)}`).toBe(true);
  expect(dentro(rediscar, altura, largura), `o Rediscar fora da janela: ${JSON.stringify(rediscar)}`).toBe(true);
  expect(dentro(nav, altura, largura), `a navegação fora da janela: ${JSON.stringify(nav)}`).toBe(true);
  expect(ligar.y + ligar.height <= nav.y + 0.5, `o Ligar cobre a navegação: ${JSON.stringify({ ligar, nav })}`).toBe(true);
  expect(rediscar.y + rediscar.height <= nav.y + 0.5, `o Rediscar cobre a navegação: ${JSON.stringify({ rediscar, nav })}`).toBe(true);
  expect(rediscar.x + rediscar.width <= ligar.x + 0.5, `o Rediscar cobre o Ligar: ${JSON.stringify({ rediscar, ligar })}`).toBe(true);
  // Nada horizontal rola: a página inteira cabe na largura da janela.
  const larguraDaPagina = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(larguraDaPagina, 'a página rola na horizontal').toBeLessThanOrEqual(largura);
  // A parte das teclas não rola: nada escondido, nada deslocado.
  const rolagem = await page.locator('.teclado-meio').evaluate((e) => ({
    top: e.scrollTop,
    sobra: e.scrollHeight - e.clientHeight,
  }));
  expect(rolagem.top, 'a parte das teclas está rolada').toBe(0);
  expect(rolagem.sobra, 'a parte das teclas esconde algo embaixo').toBeLessThanOrEqual(0.5);
  for (let i = 0; i < 12; i++) {
    const tecla = await caixa(teclas.nth(i));
    expect(dentro(tecla, altura, largura) && contem(meio, tecla), `a tecla ${i + 1} não está inteira: ${JSON.stringify({ tecla, meio })}`).toBe(
      true,
    );
    expect(tecla.y + tecla.height <= ligar.y + 0.5, `o Ligar cobre a tecla ${i + 1}`).toBe(true);
    expect(tecla.y + tecla.height <= rediscar.y + 0.5, `o Rediscar cobre a tecla ${i + 1}`).toBe(true);
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

for (const altura of [720, 719, 710, 701, 672, 640]) {
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
      expect(dentro(desligar, altura, 400), JSON.stringify(desligar)).toBe(true);
    });
  });
}

// O painel Transferir com um cartão em cima (a outra em espera, ou a faixa da segunda que toca) e 0 a 2 sugestões:
// nada transborda da parte do meio, o título não encosta no tempo e o Cancelar não encosta no Desligar.
const TRANSFERIR: Array<[number, string]> = [
  [0, ''],
  [1, '2003'],
  [2, '20'],
];
for (const altura of [720, 701, 672, 640]) {
  test.describe(`o Transferir na janela de 400×${altura}`, () => {
    test.use({ viewport: { width: 400, height: altura } });

    for (const cenario of ['duas-ligacoes', 'ligacao-segunda']) {
      for (const [quantas, digitos] of TRANSFERIR) {
        test(`fits with a card on top (${cenario}) and ${quantas} suggestion(s)`, async ({ page }) => {
          await abrir(page, cenario);
          await page.getByRole('button', { name: 'Transferir', exact: true }).click();
          const campo = page.getByRole('textbox', { name: 'Número para transferir' });
          await expect(campo).toBeFocused();
          if (digitos) await campo.fill(digitos);
          await expect(page.locator('.call-panel .suggest')).toHaveCount(quantas);
          const meio = page.locator('.call-middle');
          const sobra = await meio.evaluate((e) => e.scrollHeight - e.clientHeight);
          expect(sobra, 'o painel transborda da parte do meio').toBeLessThanOrEqual(0.5);
          const area = await caixa(meio);
          const painel = await caixa(page.locator('.call-panel'));
          expect(contem(area, painel), `o painel sai da parte do meio: ${JSON.stringify({ area, painel })}`).toBe(true);
          const quem = page.locator('.who');
          if ((await quem.count()) > 0 && (await quem.isVisible())) {
            const bloco = await caixa(quem);
            expect(bloco.y + bloco.height <= painel.y + 0.5, `"Transferir para" encosta no tempo: ${JSON.stringify({ bloco, painel })}`).toBe(
              true,
            );
          }
          const cancelar = await caixa(page.locator('.call-panel').getByRole('button', { name: 'Cancelar' }));
          const desligar = await caixa(page.getByRole('button', { name: 'Desligar', exact: true }));
          expect(dentro(desligar, altura, 400), `o Desligar fora da janela: ${JSON.stringify(desligar)}`).toBe(true);
          expect(cancelar.y + cancelar.height <= desligar.y - 4, `o Cancelar encosta no Desligar: ${JSON.stringify({ cancelar, desligar })}`).toBe(
            true,
          );
          if (altura === 640 && quantas === 2) await capturar(page, `transferir-${cenario}-${altura}`, 'escuro');
        });
      }
    }
  });
}

// Os tamanhos da rc.2: os do canvas e os limites de cada layout (Normal a partir de 380×640, Compacto a partir de
// 330×540, Mínimo até 300×440, o menor), uma janela maior e a de 400×480 (baixa e larga: Mínimo).
const TAMANHOS: Array<[number, number]> = [
  [400, 720],
  [380, 640],
  [379, 639],
  [380, 600],
  [379, 599],
  [340, 560],
  [330, 540],
  [330, 539],
  [330, 500],
  [329, 499],
  [300, 440],
  [600, 900],
  [400, 480],
];
for (const [largura, altura] of TAMANHOS) {
  test.describe(`a janela de ${largura}×${altura}`, () => {
    test.use({ viewport: { width: largura, height: altura } });

    for (const [quantas, digitos] of SUGESTOES) {
      test(`the keys, Rediscar, Ligar and the nav stay whole with ${quantas} suggestion(s)`, async ({ page }) => {
        await abrir(page, 'principal');
        if (digitos) await page.getByRole('textbox', { name: 'Número' }).fill(digitos);
        await conferirTeclado(page, altura, quantas, largura);
        if (quantas === 3 && [340, 300, 600].includes(largura)) {
          await capturar(page, `janela-${largura}x${altura}-3-sugestoes`, 'claro');
        }
      });
    }
  });
}

/** O layout que a interface escolheu (o data-layout da janela). */
async function layout(page: Page): Promise<string | null> {
  return page.locator('.win').first().getAttribute('data-layout');
}

async function altura(locator: Locator): Promise<number> {
  return (await caixa(locator)).height;
}

test.describe('os três layouts', () => {
  for (const [largura, alturaJanela, esperado] of [
    [400, 720, 'normal'],
    [380, 640, 'normal'],
    [600, 900, 'normal'],
    [379, 720, 'compacto'],
    [400, 639, 'compacto'],
    [380, 600, 'compacto'],
    [340, 560, 'compacto'],
    [330, 540, 'compacto'],
    [329, 720, 'minimo'],
    [400, 539, 'minimo'],
    [330, 500, 'minimo'],
    [300, 440, 'minimo'],
  ] as Array<[number, number, string]>) {
    test(`${largura}×${alturaJanela} is ${esperado}`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: alturaJanela });
      await abrir(page, 'principal');
      expect(await layout(page)).toBe(esperado);
    });
  }

  test('a resize switches the layout without reloading', async ({ page }) => {
    await abrir(page, 'principal');
    await page.getByRole('textbox', { name: 'Número' }).fill('2003');
    expect(await layout(page)).toBe('normal');
    await page.setViewportSize({ width: 340, height: 560 });
    await expect(page.locator('.win[data-layout="compacto"]')).toHaveCount(1);
    await page.setViewportSize({ width: 300, height: 440 });
    await expect(page.locator('.win[data-layout="minimo"]')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Número' })).toHaveValue('2003');
    await page.setViewportSize({ width: 400, height: 720 });
    await expect(page.locator('.win[data-layout="normal"]')).toHaveCount(1);
  });

  test('Normal: the logo, the pill toggles with text, the keys with letters and the nav with labels', async ({ page }) => {
    await abrir(page, 'principal');
    const logo = page.getByRole('img', { name: 'Starsonic soluções de voz e dados' });
    await expect(logo).toBeVisible();
    expect((await caixa(logo)).width).toBeCloseTo(160, 0);
    await expect(page.locator('.chip', { hasText: 'Não perturbe' })).toBeVisible();
    await expect(page.locator('.chip', { hasText: 'Atender automático' })).toBeVisible();
    await expect(page.locator('.keys .key small', { hasText: 'ABC' })).toBeVisible();
    expect(await altura(page.locator('.keys .key').first())).toBeCloseTo(54, 0);
    expect(await altura(page.locator('button.btn-call'))).toBeCloseTo(56, 0);
    expect(await altura(page.locator('button.btn-redial'))).toBeCloseTo(56, 0);
    expect((await caixa(page.locator('button.btn-redial'))).width).toBeCloseTo(56, 0);
    await expect(page.locator('nav.nav .tab-label', { hasText: 'Recentes' })).toBeVisible();
  });

  test.describe('Compacto (340×560)', () => {
    test.use({ viewport: { width: 340, height: 560 } });

    test('the small logo, round icon toggles, the one-line account and the smaller keys', async ({ page }) => {
      await abrir(page, 'principal');
      const logo = page.getByRole('img', { name: 'Starsonic soluções de voz e dados' });
      await expect(logo).toBeVisible();
      expect((await caixa(logo)).width).toBeCloseTo(118, 0);
      // Não perturbe e Atender automático: botões redondos de 32 px, só o ícone, com o nome e o aria-pressed.
      for (const nome of ['Não perturbe', 'Atender automático']) {
        const botao = page.getByRole('button', { name: nome, exact: true });
        await expect(botao).toBeVisible();
        await expect(botao).toHaveAttribute('aria-pressed', 'false');
        const b = await caixa(botao);
        expect(b.width).toBeCloseTo(32, 0);
        expect(b.height).toBeCloseTo(32, 0);
        expect((await botao.innerText()).trim()).toBe('');
      }
      await expect(page.locator('.chip')).toHaveCount(0);
      // Ao lado do Menu, na linha do logo.
      const menu = await caixa(page.getByRole('button', { name: 'Menu' }));
      const dnd = await caixa(page.getByRole('button', { name: 'Não perturbe', exact: true }));
      expect(Math.abs(menu.y - dnd.y)).toBeLessThanOrEqual(1);
      // A conta numa linha: a bolinha, o ramal e o estado com reticências.
      const conta = page.getByRole('button', { name: /Trocar de conta/ });
      expect(await altura(conta)).toBeLessThanOrEqual(40);
      await expect(conta.getByText('2001', { exact: true })).toBeVisible();
      const sub = conta.locator('.account-sub');
      expect(await sub.evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis');
      expect(await sub.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('nowrap');
      // As teclas de 44 px (raio 14), o Ligar e o Rediscar de 46, a navegação de 52 com os rótulos pequenos.
      const tecla = page.locator('.keys .key').first();
      expect(await altura(tecla)).toBeCloseTo(44, 0);
      expect(await tecla.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('14px');
      await expect(page.locator('.keys .key small', { hasText: 'ABC' })).toBeVisible();
      expect(await altura(page.locator('button.btn-call'))).toBeCloseTo(46, 0);
      expect(await altura(page.locator('button.btn-redial'))).toBeCloseTo(46, 0);
      expect(await altura(page.locator('nav.nav'))).toBeCloseTo(52, 0);
      const rotulo = page.locator('nav.nav .tab-label', { hasText: 'Recentes' });
      await expect(rotulo).toBeVisible();
      expect(await rotulo.evaluate((e) => getComputedStyle(e).fontSize)).toBe('11.5px');
    });

    test('the icon toggles send the commands and show the pressed state', async ({ page }) => {
      await abrir(page, 'principal');
      const dnd = page.getByRole('button', { name: 'Não perturbe', exact: true });
      await dnd.click();
      await esperarComando(page, { cmd: 'setDnd', on: true });
      await expect(dnd).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Atender automático', exact: true }).click();
      await esperarComando(page, { cmd: 'setAutoAnswer', on: true });
      await expect(page.getByRole('button', { name: 'Atender automático', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  test.describe('Mínimo (300×440)', () => {
    test.use({ viewport: { width: 300, height: 440 } });

    test('no logo, the 44 px status strip, digits-only keys and an icon-only nav', async ({ page }) => {
      await abrir(page, 'principal');
      await expect(page.getByRole('img', { name: 'Starsonic soluções de voz e dados' })).toHaveCount(0);
      const faixa = page.locator('.brand-strip');
      expect(await altura(faixa)).toBeCloseTo(44, 0);
      // A faixa: a bolinha, o ramal, o estado, o Não perturbe e o Menu; o Atender automático fica nas Configurações.
      await expect(faixa.locator('.dot')).toBeVisible();
      await expect(faixa.getByText('2001', { exact: true })).toBeVisible();
      await expect(faixa.getByText('Conectado', { exact: true })).toBeVisible();
      await expect(faixa.getByRole('button', { name: 'Não perturbe', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(faixa.getByRole('button', { name: 'Menu' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Atender automático' })).toHaveCount(0);
      // A troca de conta continua na faixa.
      await faixa.getByRole('button', { name: /Trocar de conta/ }).click();
      await expect(page.getByRole('menuitemradio', { name: /Caixa 2 · 2015/ })).toBeVisible();
      await page.keyboard.press('Escape');
      // As teclas de 38 px (raio 12), só os dígitos.
      const tecla = page.locator('.keys .key').nth(1);
      expect(await altura(tecla)).toBeCloseTo(38, 0);
      expect(await tecla.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('12px');
      await expect(page.locator('.keys .key small', { hasText: 'ABC' })).toBeHidden();
      await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible();
      expect(await altura(page.locator('button.btn-call'))).toBeCloseTo(42, 0);
      expect(await altura(page.locator('button.btn-redial'))).toBeCloseTo(42, 0);
      // A navegação de 44 px, só os ícones, com o nome de cada aba.
      const nav = page.getByRole('navigation', { name: 'Seções' });
      expect(await altura(nav)).toBeCloseTo(44, 0);
      for (const nome of ['Teclado', 'Recentes', 'Contatos']) {
        await expect(nav.getByRole('button', { name: nome })).toHaveAttribute('aria-label', nome);
      }
      await expect(nav.locator('.tab-label').first()).toBeHidden();
      await nav.getByRole('button', { name: 'Recentes' }).click();
      await expect(nav.getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
    });
  });

  test('a large window caps the body width and keeps it centered', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await abrir(page, 'principal');
    const corpo = await caixa(page.locator('.body.teclado'));
    expect(corpo.width).toBeLessThanOrEqual(480.5);
    expect(Math.abs(corpo.x + corpo.width / 2 - 450)).toBeLessThanOrEqual(1);
    // O cabeçalho continua com a largura toda.
    expect((await caixa(page.locator('header.brand'))).width).toBeCloseTo(900, 0);
  });
});

// As outras telas no Compacto e no Mínimo: nada rola na horizontal, a parte de cima e a de baixo ficam inteiras (o
// corpo rola dentro dele), os botões da ligação (Desligar, Atender, Recusar) nunca ficam cobertos nem cortados, e o
// axe passa nos dois temas.
/** O botão inteiro na janela e por cima de tudo (o ponto do meio e os quatro cantos de dentro acertam nele). */
async function conferirBotaoLivre(botao: Locator, largura: number, alturaJanela: number): Promise<void> {
  const b = await caixa(botao);
  expect(dentro(b, alturaJanela, largura), `fora da janela: ${JSON.stringify(b)}`).toBe(true);
  const livre = await botao.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const pontos = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 6, r.top + r.height / 2],
      [r.right - 6, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 6],
      [r.left + r.width / 2, r.bottom - 6],
    ];
    return pontos.every(([x, y]) => {
      const alvo = document.elementFromPoint(x, y);
      return alvo !== null && (alvo === e || e.contains(alvo));
    });
  });
  expect(livre, `o botão está coberto: ${JSON.stringify(b)}`).toBe(true);
}

async function semRolarNaHorizontal(page: Page, largura: number): Promise<void> {
  const larguraDaPagina = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(larguraDaPagina, 'a página rola na horizontal').toBeLessThanOrEqual(largura);
  const rolam = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.win *'))
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
      .map((e) => e.className),
  );
  expect(rolam, 'algo rola na horizontal').toEqual([]);
}

/** A janela inteira: o que é da janela (a barra de título, a navegação ou a barra) cabe nela. */
async function conferirMolde(page: Page, largura: number, alturaJanela: number): Promise<void> {
  await semRolarNaHorizontal(page, largura);
  const titulo = await caixa(page.locator('.titlebar'));
  expect(dentro(titulo, alturaJanela, largura)).toBe(true);
  for (const seletor of ['nav.nav', '.bar']) {
    const parte = page.locator(seletor);
    if ((await parte.count()) > 0) {
      const b = await caixa(parte.first());
      expect(dentro(b, alturaJanela, largura), `${seletor} fora da janela: ${JSON.stringify(b)}`).toBe(true);
    }
  }
  // A página não rola: só o corpo de cada tela.
  const sobra = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
  expect(sobra, 'a página rola').toBeLessThanOrEqual(0.5);
}

const OUTRAS: Array<{ nome: string; cenario: string; preparar?: (page: Page) => Promise<void>; botoes: string[] }> = [
  { nome: 'Recentes', cenario: 'recentes', botoes: [] },
  { nome: 'Contatos', cenario: 'contatos', botoes: [] },
  { nome: 'Configurações', cenario: 'configuracoes', botoes: [] },
  { nome: 'Sobre', cenario: 'sobre', botoes: [] },
  { nome: 'Entrar', cenario: 'entrar', botoes: [] },
  {
    nome: 'o formulário do contato',
    cenario: 'contatos',
    preparar: async (page) => {
      await page.getByRole('button', { name: 'Novo contato' }).click();
      await expect(page.getByLabel('Nome')).toBeVisible();
    },
    botoes: [],
  },
  {
    nome: 'a atualização',
    cenario: 'principal',
    preparar: async (page) => {
      await empurrar(page, { v: 1, type: 'update', versao: '0.1.0-rc.2', notas: 'Correções no aviso de ligação.' });
      await expect(page.getByRole('dialog', { name: 'Atualização' })).toBeVisible();
    },
    botoes: ['Depois', 'Atualizar agora'],
  },
  { nome: 'uma ligação', cenario: 'ligacao', botoes: ['Desligar'] },
  { nome: 'uma ligação tocando', cenario: 'aviso', botoes: ['Recusar', 'Atender'] },
  { nome: 'a segunda tocando', cenario: 'ligacao-segunda', botoes: ['Desligar', 'Recusar', 'Atender'] },
  { nome: 'duas ligações', cenario: 'duas-ligacoes', botoes: ['Desligar', 'Desligar Ana Souza'] },
  { nome: 'a consulta', cenario: 'consulta', botoes: ['Concluir transferência'] },
  { nome: 'a conferência', cenario: 'conferencia', botoes: ['Desligar para todos'] },
  {
    nome: 'o painel Transferir',
    cenario: 'duas-ligacoes',
    preparar: async (page) => {
      await page.getByRole('button', { name: 'Transferir', exact: true }).click();
      await page.getByRole('textbox', { name: 'Número para transferir' }).fill('20');
    },
    botoes: ['Desligar', 'Transferir agora', 'Cancelar'],
  },
  {
    nome: 'o teclado da ligação',
    cenario: 'ligacao',
    preparar: async (page) => {
      await page.getByRole('button', { name: 'Teclado', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Teclado da ligação' })).toBeVisible();
    },
    botoes: ['Desligar', 'Teclado'],
  },
  {
    nome: 'a nova ligação',
    cenario: 'ligacao',
    preparar: async (page) => {
      await page.getByRole('button', { name: 'Nova ligação', exact: true }).click();
      await page.getByRole('textbox', { name: 'Número da nova ligação' }).fill('20');
    },
    botoes: ['Desligar', 'Ligar', 'Cancelar'],
  },
];

for (const [largura, alturaJanela] of [
  [340, 560],
  [300, 440],
] as Array<[number, number]>) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`as outras telas em ${largura}×${alturaJanela} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: alturaJanela }, colorScheme: tema });

      for (const tela of OUTRAS) {
        test(`${tela.nome} fits`, async ({ page }) => {
          await abrir(page, tela.cenario);
          if (tela.preparar) await tela.preparar(page);
          await conferirMolde(page, largura, alturaJanela);
          for (const nome of tela.botoes) {
            await conferirBotaoLivre(page.getByRole('button', { name: nome, exact: true }).last(), largura, alturaJanela);
          }
          await semViolacoesSerias(page);
          if (tema === 'dark' && ['uma ligação', 'duas ligações', 'Configurações', 'Recentes'].includes(tela.nome)) {
            await capturar(page, `${tela.cenario}-${largura}x${alturaJanela}`, tema);
          }
        });
      }
    });
  }
}
