// O aviso do canto com um pedido para entrar na reunião (aviso.html, a tela 11): o texto, os botões, as respostas, o
// clique fora dos botões, a ligação que toma o aviso, o axe e o teclado, contra a ponte falsa (?fake=aviso-pedido).
import { test, expect, type Page } from '@playwright/test';
import { abrir, capturar, comandos, esperarComando, estado, mudarEstado, semViolacoesSerias, vezes } from '../helpers';

const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

const ID = '8899aabbccddeeff';
const NOME_DO_AVISO = 'Maria Lima quer entrar na reunião Planejamento de dezembro';

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

async function abrirAviso(page: Page, cenario = 'aviso-pedido'): Promise<void> {
  await page.setViewportSize({ width: 380, height: 168 });
  await abrir(page, cenario, 'aviso.html');
}

/** Um estado com o pedido da Maria Lima e o assunto dado. */
const comAssunto = (assunto: string | null) => (s: Record<string, any>) => ({
  ...s,
  reuniao: { pedido: { id: ID, nome: 'Maria Lima', assunto }, escondida: true },
});

test('o aviso mostra quem quer entrar, a reunião e os dois botões', async ({ page }) => {
  await abrirAviso(page);
  for (const texto of ['Starsonic Phone · Reuniões', 'Maria Lima quer entrar', 'Planejamento de dezembro']) {
    await expect(page.getByText(texto, { exact: true }), texto).toBeVisible();
  }
  await expect(page.getByRole('alertdialog', { name: NOME_DO_AVISO })).toBeVisible();
  await expect(botao(page, 'Recusar')).toBeVisible();
  await expect(botao(page, 'Aceitar')).toBeVisible();
  await expect(botao(page, 'Fechar o aviso')).toBeVisible();
  await esperarComando(page, { cmd: 'noticeHeight', altura: 168 });
  // Cabe nos 380×168 do aviso, sem rolagem.
  const raiz = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  expect(raiz).toEqual([380, 168]);
  for (const nome of ['Recusar', 'Aceitar', 'Fechar o aviso']) {
    const caixa = (await botao(page, nome).boundingBox())!;
    expect(caixa.x, nome).toBeGreaterThanOrEqual(0);
    expect(caixa.y, nome).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width, nome).toBeLessThanOrEqual(380);
    expect(caixa.y + caixa.height, nome).toBeLessThanOrEqual(168);
  }
});

test('a reunião sem assunto diz Reunião sem assunto; a de assunto desconhecido fica sem a linha', async ({ page }) => {
  await abrirAviso(page);
  await mudarEstado(page, comAssunto(''));
  await expect(page.getByText('Reunião sem assunto', { exact: true })).toBeVisible();
  await expect(page.getByText('Planejamento de dezembro')).toHaveCount(0);
  await expect(page.getByRole('alertdialog', { name: 'Maria Lima quer entrar na reunião' })).toBeVisible();

  await mudarEstado(page, comAssunto(null));
  await expect(page.getByText('Maria Lima quer entrar', { exact: true })).toBeVisible();
  await expect(page.getByText('Reunião sem assunto')).toHaveCount(0);
  await expect(page.locator('.aviso-reuniao-assunto')).toHaveCount(0);
  await expect(page.getByRole('alertdialog', { name: 'Maria Lima quer entrar na reunião' })).toBeVisible();
});

for (const [rotulo, resposta] of [
  ['Aceitar', 'aceitar'],
  ['Recusar', 'recusar'],
  ['Fechar o aviso', 'fechar'],
] as const) {
  test(`o ${rotulo} manda a resposta ${resposta} com o id do pedido`, async ({ page }) => {
    await abrirAviso(page);
    await botao(page, rotulo).click();
    await esperarComando(page, { cmd: 'reuniaoResposta', pedido: ID, resposta });
    expect(await vezes(page, { cmd: 'reuniaoMostrar' })).toBe(0);
    // A ponte falsa faz o que o núcleo faz: esquece o pedido, e o aviso fica vazio.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('.aviso-vazio')).toHaveCount(1);
    expect((await estado(page)).reuniao).toBeUndefined();
  });
}

test('o clique fora dos botões manda o reuniaoMostrar, e nenhuma resposta', async ({ page }) => {
  await abrirAviso(page);
  await page.getByText('Maria Lima quer entrar', { exact: true }).click();
  await esperarComando(page, { cmd: 'reuniaoMostrar' });
  await page.getByText('Planejamento de dezembro', { exact: true }).click();
  await expect.poll(() => vezes(page, { cmd: 'reuniaoMostrar' })).toBe(2);
  await page.locator('.aviso').click({ position: { x: 190, y: 150 } });
  await expect.poll(() => vezes(page, { cmd: 'reuniaoMostrar' })).toBe(3);
  expect((await comandos(page)).filter((c) => c.cmd === 'reuniaoResposta')).toEqual([]);
  // Um clique num botão não é um clique fora dos botões.
  await botao(page, 'Aceitar').click();
  await esperarComando(page, { cmd: 'reuniaoResposta', pedido: ID, resposta: 'aceitar' });
  expect(await vezes(page, { cmd: 'reuniaoMostrar' })).toBe(3);
});

test('a ligação tocando toma o aviso, e o pedido volta quando ela para', async ({ page }) => {
  await abrirAviso(page, 'aviso');
  await mudarEstado(page, comAssunto('Planejamento de dezembro'));
  await expect(page.getByText('Ligação recebida · Recepção', { exact: true })).toBeVisible();
  await expect(page.getByText('quer entrar')).toHaveCount(0);
  await mudarEstado(page, ({ ligacao: _ligacao, ...s }) => s);
  await expect(page.getByRole('alertdialog', { name: NOME_DO_AVISO })).toBeVisible();
  await expect(page.getByText('Ligação recebida')).toHaveCount(0);
});

test('o pedido some do aviso quando o estado deixa de ter o reuniao', async ({ page }) => {
  await abrirAviso(page);
  await mudarEstado(page, ({ reuniao: _reuniao, ...s }) => s);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('a ponte falsa só aceita a resposta do pedido do estado', async ({ page }) => {
  await abrirAviso(page);
  await page.evaluate(() => {
    const w = (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake;
    w.mandar({ v: 1, cmd: 'reuniaoResposta', pedido: '0000000000000000', resposta: 'aceitar' });
  });
  const outra = { cmd: 'reuniaoResposta', pedido: '0000000000000000', resposta: 'aceitar' };
  await expect.poll(() => vezes(page, outra)).toBe(1);
  await expect(page.getByRole('alertdialog', { name: NOME_DO_AVISO })).toBeVisible();
  expect((await estado(page)).reuniao.pedido.id).toBe(ID);
});

test('a ponte falsa recusa o pedido sem assunto, sem escondida ou com pedido null, como o núcleo', async ({ page }) => {
  await abrirAviso(page, 'aviso');
  await mudarEstado(page, ({ ligacao: _ligacao, ...s }) => s);
  await page.evaluate(() => {
    const w = (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake;
    w.mandar({ v: 1, cmd: 'reuniaoPedido', pedido: { id: '1122334455667788', nome: 'Rui Alves' }, escondida: true });
    w.mandar({ v: 1, cmd: 'reuniaoPedido', pedido: { id: '1122334455667788', nome: 'Rui Alves', assunto: null } });
    w.mandar({ v: 1, cmd: 'reuniaoPedido', pedido: null });
  });
  await expect.poll(async () => (await comandos(page)).filter((c) => c.cmd === 'reuniaoPedido').length).toBe(3);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await estado(page)).reuniao).toBeUndefined();
});

test('o reuniaoPedido põe e tira o pedido; no modo iPhone nada acontece', async ({ page }) => {
  await abrirAviso(page, 'aviso');
  // Sem ligação: um pedido novo vem pelo comando.
  await mudarEstado(page, ({ ligacao: _ligacao, ...s }) => s);
  await expect(page.locator('.aviso-vazio')).toHaveCount(1);
  await page.evaluate(() => {
    const w = (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake;
    const rui = { id: '1122334455667788', nome: 'Rui Alves', assunto: null };
    w.mandar({ v: 1, cmd: 'reuniaoPedido', pedido: rui, escondida: true });
  });
  await expect(page.getByRole('alertdialog', { name: 'Rui Alves quer entrar na reunião' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar({ v: 1, cmd: 'reuniaoPedido' });
  });
  await expect(page.locator('.aviso-vazio')).toHaveCount(1);

  await page.goto('/aviso.html?fake=aviso-pedido&plataforma=ios');
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema });
    test(`o aviso do pedido não tem violações sérias (${tema})`, async ({ page }) => {
      await abrirAviso(page);
      await expect(botao(page, 'Aceitar')).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'reunioes-aviso', nomeDoTema(tema));
    });
  });
}

test('pelo teclado: o Tab passa pelo Recusar, pelo Aceitar e pelo fechar, e o Enter responde', async ({ page }) => {
  await abrirAviso(page);
  const foco = () =>
    page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  await page.keyboard.press('Tab');
  expect(await foco()).toBe('Recusar');
  await page.keyboard.press('Tab');
  expect(await foco()).toBe('Aceitar');
  await page.keyboard.press('Tab');
  expect(await foco()).toBe('Fechar o aviso');
  await page.keyboard.press('Enter');
  await esperarComando(page, { cmd: 'reuniaoResposta', pedido: ID, resposta: 'fechar' });
  expect(await vezes(page, { cmd: 'reuniaoMostrar' })).toBe(0);

  await abrirAviso(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await esperarComando(page, { cmd: 'reuniaoResposta', pedido: ID, resposta: 'recusar' });
});
