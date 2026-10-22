// A rc.2: o Rediscar (a opção A do canvas "tamanho, rediscar e status": o botão redondo à esquerda do Ligar) e a
// bolinha de status da conta (verde conectado, vermelho em ligação, ciano conectando, cinza sem conexão e no erro do
// cadastro, com o triângulo de atenção).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, comandos, esperarComando, estado, mudarEstado, semViolacoesSerias, vezes } from './helpers';

const VERDE = 'rgb(34, 197, 94)'; // --status-online #22c55e
const VERMELHO = 'rgb(214, 69, 69)'; // --danger #d64545
const CIANO = 'rgb(0, 194, 203)'; // --cyan #00c2cb
const CINZA = 'rgb(185, 196, 230)'; // #b9c4e6

async function cor(dot: Locator): Promise<{ fundo: string; halo: string }> {
  return dot.evaluate((e) => {
    const s = getComputedStyle(e);
    return { fundo: s.backgroundColor, halo: s.boxShadow };
  });
}

/** Os recentes com a mais nova feita primeiro (as outras como no cenário principal). */
async function comFeita(page: Page, numero: string, nome: string): Promise<void> {
  await mudarEstado(page, (s) => ({
    ...s,
    recentes: [
      { numero: '3001', nome: '', tipo: 'perdida', inicio: Date.now() - 60_000, duracao: 0, contatoId: '' },
      { numero, nome, tipo: 'feita', inicio: Date.now() - 120_000, duracao: 30_000, contatoId: nome ? 'c1d2e3f4a5b60718' : '' },
      ...s.recentes,
    ],
  }));
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`Rediscar (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('redials the newest outgoing call with the same dial as calling it back from Recentes', async ({ page }) => {
      await abrir(page, 'principal');
      // No cenário principal, a feita mais nova é o (11) 5060-3000, sem nome.
      const rediscar = page.getByRole('button', { name: 'Rediscar 1150603000', exact: true });
      await expect(rediscar).toBeEnabled();
      await expect(rediscar).toHaveAttribute('title', 'Rediscar 1150603000');
      await semViolacoesSerias(page);
      await rediscar.click();
      await esperarComando(page, { cmd: 'dial', numero: '1150603000' });

      // O mesmo comando do botão de ligar da linha nos Recentes.
      const nav = page.getByRole('navigation', { name: 'Seções' });
      await nav.getByRole('button', { name: 'Recentes' }).click();
      await page.getByRole('button', { name: 'Ligar para 1150603000', exact: true }).click();
      expect(await vezes(page, { cmd: 'dial', numero: '1150603000' })).toBe(2);
    });

    test('the label, the title and the tooltip name the number and the contact', async ({ page }) => {
      await abrir(page, 'principal');
      await comFeita(page, '2003', 'Ana Souza');
      const rediscar = page.getByRole('button', { name: 'Rediscar Ana Souza', exact: true });
      await expect(rediscar).toHaveAttribute('title', 'Rediscar Ana Souza');
      // O balão do canvas no hover: o número e o nome.
      const balao = page.getByRole('tooltip');
      await expect(balao).toHaveCount(0);
      await rediscar.hover();
      await expect(balao).toHaveText('Rediscar 2003 · Ana Souza');
      await expect(rediscar).toHaveAccessibleDescription('Rediscar 2003 · Ana Souza');
      // A borda fica ciano no hover.
      expect(await rediscar.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(CIANO);
      await semViolacoesSerias(page);
      await page.mouse.move(5, 5);
      await expect(balao).toHaveCount(0);
      // Também no foco do teclado.
      await rediscar.focus();
      await expect(balao).toHaveText('Rediscar 2003 · Ana Souza');
      await page.keyboard.press('Enter');
      await esperarComando(page, { cmd: 'dial', numero: '2003' });
    });

    test('without an outgoing call it is disabled and says only Rediscar', async ({ page }) => {
      await abrir(page, 'principal');
      await mudarEstado(page, (s) => ({ ...s, recentes: s.recentes.filter((r: { tipo: string }) => r.tipo !== 'feita') }));
      const rediscar = page.getByRole('button', { name: 'Rediscar', exact: true });
      await expect(rediscar).toBeDisabled();
      await expect(rediscar).toHaveAttribute('title', 'Rediscar');
      await rediscar.click({ force: true });
      await page.waitForTimeout(200);
      expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([]);
      await semViolacoesSerias(page);
    });
  });
}

test('the redial button is an outline circle with the blue icon left of Ligar', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await abrir(page, 'principal');
  const rediscar = page.locator('button.btn-redial');
  const ligar = page.locator('button.btn-call');
  const r = (await rediscar.boundingBox())!;
  const l = (await ligar.boundingBox())!;
  expect(r.x + r.width).toBeLessThanOrEqual(l.x);
  expect(Math.abs(r.y + r.height / 2 - (l.y + l.height / 2))).toBeLessThanOrEqual(1);
  const estilo = await rediscar.evaluate((e) => {
    const s = getComputedStyle(e);
    return { raio: s.borderTopLeftRadius, borda: s.borderTopColor, cor: s.color, largura: s.borderTopWidth };
  });
  expect(estilo.borda).toBe('rgb(231, 234, 242)'); // --line
  expect(estilo.cor).toBe('rgb(12, 38, 113)'); // --blue
  // 1,5 px no CSS; o Chromium arredonda a borda para pixels inteiros do dispositivo (1 px a 100%).
  expect(parseFloat(estilo.largura)).toBeGreaterThanOrEqual(1);
  expect(parseFloat(estilo.raio)).toBeGreaterThanOrEqual(28);
});

test('the Nova ligação panel redials through the same path as its Ligar; the call keypad has no redial', async ({ page }) => {
  await abrir(page, 'ligacao');
  await page.getByRole('button', { name: 'Teclado', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Teclado da ligação' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rediscar/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Teclado', exact: true }).click();
  await page.getByRole('button', { name: 'Nova ligação', exact: true }).click();
  const rediscar = page.getByRole('button', { name: 'Rediscar 1150603000', exact: true });
  await expect(rediscar).toBeEnabled();
  await semViolacoesSerias(page);
  await rediscar.click();
  await esperarComando(page, { cmd: 'dial', numero: '1150603000' });
  await expect(page.getByRole('textbox', { name: 'Número da nova ligação' })).toHaveCount(0);
});

test.describe('a bolinha de status', () => {
  const dotDoCabecalho = (page: Page) => page.locator('header .account .dot');

  test('connected and free is green', async ({ page }) => {
    await abrir(page, 'principal');
    const c = await cor(dotDoCabecalho(page));
    expect(c.fundo).toBe(VERDE);
    expect(c.halo).toContain('rgba(34, 197, 94, 0.22)');
    await expect(page.getByText('Conectado · starcloud1-starsonic.com.br', { exact: true })).toBeVisible();
    // O token novo.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--status-online').trim())).toBe('#22c55e');
  });

  test('connecting is cyan and without connection is grey, as before', async ({ page }) => {
    await abrir(page, 'principal');
    await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'conectando', texto: 'Conectando…' } }));
    await expect(page.getByText('Conectando…', { exact: true })).toBeVisible();
    expect((await cor(dotDoCabecalho(page))).fundo).toBe(CIANO);
    await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'sem_conexao', texto: '' } }));
    await expect(page.getByText('Sem conexão', { exact: true })).toBeVisible();
    expect((await cor(dotDoCabecalho(page))).fundo).toBe(CINZA);
    await expect(page.getByRole('img', { name: 'Atenção' })).toHaveCount(0);
  });

  for (const tema of ['light', 'dark'] as const) {
    test(`a registration error is grey with the warning triangle and keeps its text (${tema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: tema });
      await abrir(page, 'principal');
      await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'erro', texto: 'Ramal ou senha incorretos.' } }));
      await expect(page.getByText('Ramal ou senha incorretos.', { exact: true })).toBeVisible();
      expect((await cor(dotDoCabecalho(page))).fundo).toBe(CINZA);
      const aviso = page.locator('header .account').getByRole('img', { name: 'Atenção' });
      await expect(aviso).toBeVisible();
      const icone = await aviso.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { traco: getComputedStyle(e).stroke, w: r.width, h: r.height };
      });
      expect(icone.traco).toBe('rgb(255, 183, 3)'); // #ffb703
      expect(icone.w).toBeCloseTo(18, 0);
      expect(icone.h).toBeCloseTo(18, 0);
      // À direita do texto, antes da seta.
      const texto = (await page.locator('header .account .account-text').boundingBox())!;
      const a = (await aviso.boundingBox())!;
      expect(a.x).toBeGreaterThanOrEqual(texto.x + texto.width - 0.5);
      await semViolacoesSerias(page);
    });
  }

  test('a call in progress, ringing included, is red with "Ocupado · em ligação" wherever the account shows', async ({ page }) => {
    await abrir(page, 'principal');
    await expect(page.locator('.status-busy')).toHaveCount(0);
    for (const phase of ['ringing', 'active']) {
      await mudarEstado(page, (s) => ({
        ...s,
        ligacao: {
          top: { id: 31, number: '2003', name: 'Ana Souza', incoming: true, phase, activeSinceMs: phase === 'active' ? Date.now() : 0, held: false },
          second: null,
          secondKind: 'none',
          muted: false,
          conference: false,
          conferenceSinceMs: 0,
          consulting: false,
          colleagueActive: false,
        },
      }));
      // A tela da ligação toma a janela: a conta em uso aparece na barra de título, com a bolinha vermelha.
      const ocupado = page.locator('.titlebar .account-status');
      await expect(ocupado).toBeVisible();
      await expect(ocupado.getByText('Ocupado · em ligação', { exact: true })).toBeAttached();
      const c = await cor(ocupado.locator('.dot'));
      expect(c.fundo).toBe(VERMELHO);
      expect(c.halo).toContain('rgba(214, 69, 69, 0.28)');
      await semViolacoesSerias(page);
    }
    // A ligação acabou: verde de novo.
    await mudarEstado(page, (s) => ({ ...s, ligacao: null }));
    await expect(page.getByRole('navigation', { name: 'Seções' })).toBeVisible();
    expect((await cor(dotDoCabecalho(page))).fundo).toBe(VERDE);
  });

  test('the Configurações accounts list follows the same mapping for the account in use', async ({ page }) => {
    await abrir(page, 'configuracoes');
    const linhas = page.locator('.card .set-row');
    const emUso = linhas.filter({ hasText: 'Recepção · 2001' }).locator('.dot');
    const outra = linhas.filter({ hasText: 'Caixa 2 · 2015' }).locator('.dot');
    expect((await cor(emUso)).fundo).toBe(VERDE);
    expect((await cor(outra)).fundo).toBe(CINZA);
    await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'conectando', texto: 'Conectando…' } }));
    await expect.poll(async () => (await cor(emUso)).fundo).toBe(CIANO);
    await mudarEstado(page, (s) => ({ ...s, conta: { ...s.conta, status: 'erro', texto: 'Ramal ou senha incorretos.' } }));
    await expect.poll(async () => (await cor(emUso)).fundo).toBe(CINZA);
    expect((await estado(page)).conta.status).toBe('erro');
  });

  test('the status text is always next to the dot in the three layouts', async ({ page }) => {
    for (const [w, h] of [
      [400, 720],
      [340, 560],
      [300, 440],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await abrir(page, 'principal');
      const dot = page.locator('header .dot').first();
      await expect(dot).toBeVisible();
      expect((await cor(dot)).fundo).toBe(VERDE);
      await expect(page.locator('header').getByText(/^Conectado/).first()).toBeVisible();
    }
  });
});
