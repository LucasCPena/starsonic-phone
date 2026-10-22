// A aba Atalhos (rc.3, spec 3 e 4): até 8 atalhos em duas colunas, cada um com o ícone da ação, o nome, a ação e o
// número e o BLF (a palavra sempre ao lado da bolinha); "Adicionar atalho" nos espaços vazios e "<n> de 8" no alto. O
// clique usa o atalho (useShortcut); o botão direito, ou o "Mais opções" (⋯) pelo teclado, abre a edição. Na tela da
// ligação, o botão Atalhos abre o painel com os mesmos atalhos. A interface só manda os comandos: o que cada atalho
// faz (e o puxar ligação de um ramal tocando) é do C++.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, capturar, comandos, esperarComando, mudarEstado, semViolacoesSerias, verTextos } from './helpers';

const VERDE = 'rgb(34, 197, 94)'; // #22c55e
const CIANO = 'rgb(0, 194, 203)'; // #00c2cb
const VERMELHO = 'rgb(214, 69, 69)'; // #d64545
const CINZA = 'rgb(185, 196, 230)'; // #b9c4e6

// Os atalhos do cenário (os do canvas "Atalhos · aba nova").
const RECEPCAO = '5a1c0e9b2f3d4c67';
const FINANCEIRO = '0b2e7d4c1a9f3e58';
const SUPORTE = '7c3d9e1f5b2a4d60';
const COMERCIAL = '3e8f0a6b9c1d2e47';
const FILA = '9d4a2b7e6f0c1a35';

const NOMES = ['Recepção', 'Financeiro', 'Suporte', 'Comercial', 'Fila de espera', 'Celular plantão'];

/** O cartão de um atalho na aba (pelo nome). */
function cartao(page: Page, nome: string): Locator {
  return page.locator('li.atalho').filter({ has: page.locator('.atalho-nome').getByText(nome, { exact: true }) });
}

/** O botão que usa o atalho (o cartão inteiro, menos o "Mais opções"). */
function usar(page: Page, nome: string): Locator {
  return cartao(page, nome).locator('button.atalho-usar');
}

async function caixa(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'sem caixa: elemento invisível').not.toBeNull();
  return box!;
}

const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

const LAYOUTS: Array<[string, number, number]> = [
  ['normal', 400, 720],
  ['compacto', 340, 560],
  ['minimo', 300, 440],
];

for (const tema of ['light', 'dark'] as const) {
  for (const [layout, largura, altura] of LAYOUTS) {
    test.describe(`a aba Atalhos no ${layout} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: tema });

      test('the Atalhos tab shows up to eight shortcuts with BLF word and color', async ({ page }) => {
        await abrir(page, 'atalhos');
        await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
        const aba = page.getByRole('main', { name: 'Atalhos' });
        await expect(aba.getByRole('heading', { name: 'Atalhos', level: 1 })).toBeVisible();
        await expect(aba.getByText('6 de 8', { exact: true })).toBeVisible();
        // Os seis atalhos na ordem, com a ação e o número; os dois espaços vazios com "Adicionar atalho".
        await expect(page.locator('li.atalho .atalho-nome')).toHaveText(NOMES);
        await expect(page.locator('li.atalho .atalho-detalhe')).toHaveText([
          'Ligar · 2000',
          'Transferir · 2010',
          'Consulta · 2007',
          'Ligar · 2003',
          'Enviar teclas · *88',
          'Ligar · 11988887777',
        ]);
        await expect(aba.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(2);
        await expect(
          aba.getByText('Clique para usar. Clique com o botão direito para editar. Num ramal tocando, o clique puxa a ligação.', { exact: true }),
        ).toBeAttached();

        // O BLF: a palavra inteira, logo à direita da bolinha da cor do estado, dentro do cartão.
        const blfs: Array<[string, string, string]> = [
          ['Recepção', 'Livre', VERDE],
          ['Financeiro', 'Ocupado', VERMELHO],
          ['Suporte', 'Tocando', CIANO],
          ['Comercial', 'Desconectado', CINZA],
        ];
        for (const [nome, palavra, cor] of blfs) {
          const c = cartao(page, nome);
          const blf = c.locator('.blf');
          await expect(blf, nome).toHaveText(palavra);
          const ponto = blf.locator('.blf-dot');
          expect(await ponto.evaluate((e) => getComputedStyle(e).backgroundColor), nome).toBe(cor);
          const p = await caixa(ponto);
          const w = await caixa(blf.locator('.blf-palavra'));
          const card = await caixa(c);
          expect(w.x, `${nome}: a palavra não está à direita da bolinha`).toBeGreaterThanOrEqual(p.x + p.width - 0.5);
          expect(Math.abs(w.y + w.height / 2 - (p.y + p.height / 2)), `${nome}: a palavra fora da linha da bolinha`).toBeLessThanOrEqual(3);
          expect(w.x + w.width, `${nome}: a palavra sai do cartão`).toBeLessThanOrEqual(card.x + card.width + 0.5);
          const cortada = await blf.locator('.blf-palavra').evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
          expect(cortada, `${nome}: a palavra está cortada`).toBe(false);
        }
        // Sem o BLF do atalho, nem a palavra nem a bolinha.
        for (const nome of ['Fila de espera', 'Celular plantão']) {
          await expect(cartao(page, nome).locator('.blf'), nome).toHaveCount(0);
          await expect(cartao(page, nome).locator('.blf-dot'), nome).toHaveCount(0);
        }

        // Duas colunas.
        const [a, b, c] = await Promise.all([0, 1, 2].map((i) => caixa(page.locator('li.atalho').nth(i))));
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.5);
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 0.5);
        expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 0.5);
        expect(Math.abs(c.x - a.x)).toBeLessThanOrEqual(0.5);

        // A navegação com as quatro abas (Atalhos marcada), inteira; a página não rola (só o corpo da aba, se precisar).
        const nav = page.getByRole('navigation', { name: 'Seções' });
        expect(await nav.locator('button.tab').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual([
          'Teclado',
          'Atalhos',
          'Recentes',
          'Contatos',
        ]);
        await expect(nav.getByRole('button', { name: 'Atalhos' })).toHaveAttribute('aria-current', 'page');
        const n = await caixa(nav);
        expect(n.y + n.height).toBeLessThanOrEqual(altura + 0.5);
        expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight), 'a página rola').toBeLessThanOrEqual(0.5);
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'a página rola na horizontal').toBeLessThanOrEqual(largura);

        await semViolacoesSerias(page);
        await capturar(page, `atalhos-${largura}x${altura}`, nomeDoTema(tema));
      });
    });
  }
}

test.describe('a aba Atalhos', () => {
  test('a click uses the shortcut, Enviar teclas waits for a call and the right button edits', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Recepção').click();
    await esperarComando(page, { cmd: 'useShortcut', id: RECEPCAO });
    await usar(page, 'Suporte').click();
    await esperarComando(page, { cmd: 'useShortcut', id: SUPORTE });

    // Enviar teclas fora da ligação: desativado (nada sai).
    const fila = usar(page, 'Fila de espera');
    await expect(fila).toBeDisabled();
    await fila.click({ force: true });
    await page.waitForTimeout(200);
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut').map((c) => c.id)).toEqual([RECEPCAO, SUPORTE]);

    // O botão direito abre a edição (também no desativado) e não usa o atalho.
    await fila.click({ button: 'right', force: true });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Fila de espera');
    await expect(page.getByLabel('Número', { exact: true })).toHaveValue('*88');
    await expect(page.getByRole('radio', { name: 'Enviar teclas' })).toBeChecked();
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toHaveLength(2);
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
  });

  test('the Mais opções menu edits and removes, and Remover asks first', async ({ page }) => {
    await abrir(page, 'atalhos');
    // Pelo teclado: o ⋯ do cartão abre o menu com Editar e Remover.
    await page.getByRole('button', { name: 'Mais opções para Comercial' }).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Opções de Comercial' });
    await expect(menu.getByRole('menuitem', { name: 'Editar' })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'Remover' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(page.getByLabel('Número', { exact: true })).toHaveValue('2003');
    await page.getByRole('button', { name: 'Voltar' }).click();

    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Remover' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Remover atalho' });
    await expect(dialogo).toContainText('Comercial sai da lista de atalhos.');
    // O botão de confirmar é o azul (como o de remover um contato).
    const confirmar = dialogo.getByRole('button', { name: 'Remover' });
    expect(await confirmar.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(12, 38, 113)');
    await semViolacoesSerias(page);
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toHaveCount(0);
    expect((await comandos(page)).some((c) => c.cmd === 'removeShortcut')).toBe(false);

    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Remover' }).click();
    await page.getByRole('dialog', { name: 'Remover atalho' }).getByRole('button', { name: 'Remover' }).click();
    await esperarComando(page, { cmd: 'removeShortcut', id: COMERCIAL });
    await expect(cartao(page, 'Comercial')).toHaveCount(0);
    await expect(page.getByText('5 de 8', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(3);
  });

  test('eight shortcuts fill the grid, and none leaves eight Adicionar atalho', async ({ page }) => {
    await abrir(page, 'atalhos');
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: [
        ...s.atalhos,
        { id: '1a2b3c4d5e6f7a8b', nome: 'Diretoria', numero: '2020', acao: 'ligar', blf: false, estado: null },
        { id: '8b7a6f5e4d3c2b1a', nome: 'Portaria', numero: '2030', acao: 'transferir', blf: true, estado: 'livre' },
      ],
    }));
    await expect(page.getByText('8 de 8', { exact: true })).toBeVisible();
    await expect(page.locator('li.atalho')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(0);
    await mudarEstado(page, (s) => ({ ...s, atalhos: [] }));
    await expect(page.getByText('0 de 8', { exact: true })).toBeVisible();
    await expect(page.locator('li.atalho')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(8);
  });

  test('a shortcut without a BLF state shows neither the word nor the dot', async ({ page }) => {
    await abrir(page, 'atalhos');
    await expect(cartao(page, 'Recepção').locator('.blf')).toHaveText('Livre');
    // O C++ manda estado null (sem o BLF do administrador, por exemplo): nada de BLF, mesmo com o blf do atalho.
    await mudarEstado(page, (s) => ({ ...s, atalhos: s.atalhos.map((a: { id: string }) => (a.id === RECEPCAO ? { ...a, estado: null } : a)) }));
    await expect(cartao(page, 'Recepção').locator('.blf')).toHaveCount(0);
    await expect(cartao(page, 'Financeiro').locator('.blf')).toHaveText('Ocupado');
  });

  test('Tocando blinks slowly, the others do not, and reduced motion stops it', async ({ page }) => {
    await abrir(page, 'atalhos');
    const tocando = cartao(page, 'Suporte').locator('.blf-dot');
    const animacao = (l: Locator) =>
      l.evaluate((e) => {
        const s = getComputedStyle(e);
        return { nome: s.animationName, duracao: parseFloat(s.animationDuration), vezes: s.animationIterationCount };
      });
    const a = await animacao(tocando);
    expect(a.nome).not.toBe('none');
    expect(a.vezes).toBe('infinite');
    expect(a.duracao).toBeGreaterThanOrEqual(0.8);
    expect(a.duracao).toBeLessThanOrEqual(1.5);
    for (const nome of ['Recepção', 'Financeiro', 'Comercial']) {
      expect((await animacao(cartao(page, nome).locator('.blf-dot'))).nome, nome).toBe('none');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await animacao(tocando)).nome).toBe('none');
  });
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a edição do atalho (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('editing a shortcut saves name number action and blf', async ({ page }) => {
      await abrir(page, 'atalhos');
      await usar(page, 'Suporte').click({ button: 'right' });
      await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
      await verTextos(page, [
        '3 de 8',
        'Nome',
        'Número',
        'O que o atalho faz',
        'Ligar',
        'Liga para o número.',
        'Transferir',
        'Durante a ligação, passa direto para o número.',
        'Transferir com consulta',
        'Fala antes com o número e depois passa a ligação.',
        'Enviar teclas',
        'Durante a ligação, digita o número (ex.: *88).',
        'Mostrar se o ramal está livre',
        'Livre, ocupado ou tocando (BLF).',
        'Remover',
        'Salvar atalho',
      ]);
      // O botão direito só abre a edição.
      expect((await comandos(page)).some((c) => c.cmd === 'useShortcut')).toBe(false);
      await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Suporte');
      await expect(page.getByLabel('Número', { exact: true })).toHaveValue('2007');
      const consulta = page.getByRole('radio', { name: 'Transferir com consulta' });
      await expect(consulta).toBeChecked();
      await expect(consulta).toHaveAccessibleDescription('Fala antes com o número e depois passa a ligação.');
      const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
      await expect(blf).toBeEnabled();
      await expect(blf).toHaveAttribute('aria-checked', 'true');
      await expect(blf).toHaveAccessibleDescription('Livre, ocupado ou tocando (BLF).');
      await semViolacoesSerias(page);
      await capturar(page, 'atalho-editar', nomeDoTema(tema));

      await page.getByLabel('Nome', { exact: true }).fill('Suporte técnico');
      await page.getByLabel('Número', { exact: true }).fill('2008');
      await page.getByRole('radio', { name: 'Transferir', exact: true }).check();
      await blf.click();
      await expect(blf).toHaveAttribute('aria-checked', 'false');
      await page.getByRole('button', { name: 'Salvar atalho' }).click();
      await esperarComando(page, { cmd: 'saveShortcut', id: SUPORTE, nome: 'Suporte técnico', numero: '2008', acao: 'transferir', blf: false });
      // De volta à aba, com o atalho gravado (o C++ falso grava).
      await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
      await expect(cartao(page, 'Suporte técnico').locator('.atalho-detalhe')).toHaveText('Transferir · 2008');
    });
  });
}

test.describe('um atalho novo', () => {
  test('a new shortcut starts as Ligar, turns BLF on for an extension and keeps the limits', async ({ page }) => {
    await abrir(page, 'atalhos');
    // Voltar sai sem gravar.
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill('Rascunho');
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    expect((await comandos(page)).some((c) => c.cmd === 'saveShortcut')).toBe(false);

    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    await verTextos(page, ['7 de 8']);
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Remover' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Ligar' })).toBeChecked();
    const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
    await expect(blf).toHaveAttribute('aria-checked', 'false');

    // A chave segue o número enquanto a pessoa não mexe nela: liga num ramal (só dígitos, de 2 a 6).
    const numero = page.getByLabel('Número', { exact: true });
    for (const [digitado, ligado] of [
      ['2005', 'true'],
      ['1150603000', 'false'],
      ['20', 'true'],
      ['2', 'false'],
      ['200500', 'true'],
      ['2005001', 'false'],
      ['*2005', 'false'],
      ['2005', 'true'],
    ] as Array<[string, string]>) {
      await numero.fill(digitado);
      await expect(blf, digitado).toHaveAttribute('aria-checked', ligado);
    }
    // Desligada pela pessoa, a chave não volta sozinha.
    await blf.click();
    await expect(blf).toHaveAttribute('aria-checked', 'false');
    await numero.fill('2006');
    await expect(blf).toHaveAttribute('aria-checked', 'false');

    // O número só com dígitos, *, # e +, até 32; o nome até 24 caracteres (um emoji conta um).
    await numero.fill('(11) 2005-30a#*+');
    await expect(numero).toHaveValue('11200530#*+');
    await numero.fill('1'.repeat(40));
    await expect(numero).toHaveValue('1'.repeat(32));
    const nome = page.getByLabel('Nome', { exact: true });
    await nome.fill('Á'.repeat(30));
    await expect(nome).toHaveValue('Á'.repeat(24));
    await nome.fill('📞'.repeat(30));
    await expect(nome).toHaveValue('📞'.repeat(24));

    await nome.fill('Portaria');
    await numero.fill('2030');
    await page.getByRole('radio', { name: 'Enviar teclas' }).check();
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2030', acao: 'teclas', blf: false });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Portaria').locator('.atalho-detalhe')).toHaveText('Enviar teclas · 2030');
  });

  test('the BLF switch is disabled when the admin has BLF off', async ({ page }) => {
    await abrir(page, 'atalhos');
    await mudarEstado(page, (s) => ({
      ...s,
      admin: { ...s.admin, blf: false },
      atalhos: s.atalhos.map((a: Record<string, unknown>) => ({ ...a, estado: null })),
    }));
    await expect(page.locator('li.atalho .blf')).toHaveCount(0);
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
    await expect(blf).toBeDisabled();
    await expect(blf).toHaveAccessibleDescription('O administrador não ligou o BLF');
    await expect(page.getByText('O administrador não ligou o BLF', { exact: true })).toBeVisible();
    await expect(page.getByText('Livre, ocupado ou tocando (BLF).', { exact: true })).toHaveCount(0);
    // Um ramal não liga a chave sem o BLF do administrador.
    await page.getByLabel('Número', { exact: true }).fill('2005');
    await expect(blf).toHaveAttribute('aria-checked', 'false');
    await semViolacoesSerias(page);
    await page.getByLabel('Nome', { exact: true }).fill('Portaria');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2005', acao: 'ligar', blf: false });

    // Um atalho gravado com o BLF continua com ele (só vale quando o administrador ligar o BLF).
    await usar(page, 'Recepção').click({ button: 'right' });
    await expect(blf).toBeDisabled();
    await expect(blf).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', id: RECEPCAO, nome: 'Recepção', numero: '2000', acao: 'ligar', blf: true });
  });

  test('Remover in the editor asks first and removes', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Financeiro').click({ button: 'right' });
    await page.getByRole('button', { name: 'Remover' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Remover atalho' });
    await expect(dialogo).toContainText('Financeiro sai da lista de atalhos.');
    await dialogo.getByRole('button', { name: 'Remover' }).click();
    await esperarComando(page, { cmd: 'removeShortcut', id: FINANCEIRO });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Financeiro')).toHaveCount(0);
  });
});

test.describe('o painel Atalhos na ligação', () => {
  const botaoAtalhos = (page: Page) => page.getByRole('button', { name: 'Atalhos', exact: true });
  const painel = (page: Page) => page.getByRole('region', { name: 'Atalhos' });

  test('the call screen Atalhos panel runs transfer consult and keys', async ({ page }) => {
    await abrir(page, 'ligacao');
    await expect(botaoAtalhos(page)).toBeEnabled();
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    await expect(painel(page).getByRole('heading', { name: 'Atalhos' })).toBeVisible();
    // O foco no Fechar (um Enter de quem estava nos controles nunca transfere a ligação).
    await expect(painel(page).getByRole('button', { name: 'Fechar atalhos' })).toBeFocused();
    // Os mesmos atalhos, com o que cada um faz durante a ligação, e o BLF.
    await expect(painel(page).locator('.atalho-linha .row-title')).toHaveText(NOMES);
    await expect(painel(page).locator('.atalho-linha .row-sub')).toHaveText([
      'Nova ligação para 2000',
      'Transferir para 2010',
      'Consulta com 2007',
      'Nova ligação para 2003',
      'Enviar as teclas *88',
      'Nova ligação para 11988887777',
    ]);
    await expect(painel(page).locator('.atalho-linha .blf')).toHaveText(['Livre', 'Ocupado', 'Tocando', 'Desconectado']);
    // O painel fica no lugar dos controles; o Desligar continua.
    await expect(page.getByRole('button', { name: 'Mudo', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'ligacao-atalhos', 'escuro');

    // Transferir: o useShortcut do atalho, e o painel fecha.
    await painel(page).getByRole('button', { name: /^Financeiro/ }).click();
    await esperarComando(page, { cmd: 'useShortcut', id: FINANCEIRO });
    await expect(painel(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mudo', exact: true })).toBeVisible();
    // Consulta.
    await botaoAtalhos(page).click();
    await painel(page).getByRole('button', { name: /^Suporte/ }).click();
    await esperarComando(page, { cmd: 'useShortcut', id: SUPORTE });
    // Enviar teclas vale na ligação.
    await botaoAtalhos(page).click();
    const teclas = painel(page).getByRole('button', { name: /^Fila de espera/ });
    await expect(teclas).toBeEnabled();
    await teclas.click();
    await esperarComando(page, { cmd: 'useShortcut', id: FILA });

    // Esc e o Fechar atalhos fecham sem usar nada, e o foco volta ao botão Atalhos.
    const usados = (await comandos(page)).filter((c) => c.cmd === 'useShortcut').length;
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(painel(page)).toHaveCount(0);
    await expect(botaoAtalhos(page)).toBeFocused();
    await botaoAtalhos(page).click();
    await painel(page).getByRole('button', { name: 'Fechar atalhos' }).click();
    await expect(painel(page)).toHaveCount(0);
    await expect(botaoAtalhos(page)).toBeFocused();
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toHaveLength(usados);
  });

  test('the Atalhos button needs an answered call and a shortcut, and is there with two calls', async ({ page }) => {
    await abrir(page, 'ligacao');
    // Chamando (ainda sem atender): travado, como o Transferir.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, id: 0, number: '2010', name: '', phase: 'dialing', activeSinceMs: 0 } },
    }));
    await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
    await expect(botaoAtalhos(page)).toBeDisabled();
    // Atendida, mas sem nenhum atalho: travado também.
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: [],
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, id: 41, phase: 'active', activeSinceMs: Date.now() } },
    }));
    await expect(page.getByRole('button', { name: 'Transferir', exact: true })).toBeEnabled();
    await expect(botaoAtalhos(page)).toBeDisabled();
    // Duas ligações: o botão está nos controles e abre o painel.
    await abrir(page, 'duas-ligacoes');
    await expect(botaoAtalhos(page)).toBeEnabled();
    await botaoAtalhos(page).click();
    await expect(painel(page).locator('.atalho-linha')).toHaveCount(6);
    await semViolacoesSerias(page);
  });

  test('with only an unanswered ringing call no shortcut can be used', async ({ page }) => {
    await abrir(page, 'ligacao');
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    // A ligação de cima acabou e ficou só uma recebida tocando, ainda sem atender.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: {
        ...s.ligacao,
        top: { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false },
        second: null,
        secondKind: 'none',
      },
    }));
    await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
    await expect(painel(page)).toHaveCount(0);
    await expect(page.locator('.atalho-linha')).toHaveCount(0);
    await expect(botaoAtalhos(page)).toHaveCount(0);
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toEqual([]);
  });
});
