// (rc.6, correção 2) O clique duplo nos botões que o núcleo aplica "na primeira ligação que toca" (o Recusar e o Atender
// da tela e da faixa da segunda) e no Rediscar do Teclado: no Windows, o segundo clique do clique duplo não manda nada.
// O segundo clique sozinho (o down e o up com o clickCount 2) vale pelo do clique duplo depois de o estado mudar.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, comandos, depoisDoQueChegou, esperarComando, mudarEstado } from './helpers';

function botao(page: Page, nome: string): Locator {
  return page.getByRole('button', { name: nome, exact: true });
}

async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes);
}

function cartaoTocando(id: number, number: string, name: string) {
  return { id, number, name, incoming: true, phase: 'ringing', activeSinceMs: 0, held: false };
}

/** Os botões grandes da tela da ligação que toca (com a faixa da segunda no alto, o nome também é o dos pequenos dela). */
function grande(page: Page, nome: 'Recusar' | 'Atender'): Locator {
  return page.locator('.call-actions').getByRole('button', { name: nome, exact: true });
}

/** Duas ligações tocando: a primeira em cima, a segunda na faixa. */
async function duasTocando(page: Page): Promise<void> {
  await abrir(page, 'aviso');
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, second: cartaoTocando(22, '2007', 'Carlos Lima'), secondKind: 'ringing' },
  }));
}

test.describe('o clique duplo no Recusar e no Atender', () => {
  test('Recusar, com duas tocando: o segundo clique, com a tela da segunda no lugar, não recusa a segunda', async ({ page }) => {
    await duasTocando(page);
    const b = (await grande(page, 'Recusar').boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const antes = (await comandos(page)).length;
    await page.mouse.click(x, y);
    await esperarComando(page, { cmd: 'reject' });
    // O núcleo recusou a primeira: só a segunda toca, com o Recusar no mesmo lugar.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: { ...s.ligacao, top: cartaoTocando(22, '2007', 'Carlos Lima'), second: null, secondKind: 'none' },
    }));
    await expect(page.getByText('Carlos Lima', { exact: true }).first()).toBeVisible();
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await depoisDoQueChegou(page);
    expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'reject' }]);
  });

  test('Atender: um clique duplo manda um answer', async ({ page }) => {
    await duasTocando(page);
    const antes = (await comandos(page)).length;
    await grande(page, 'Atender').dblclick();
    await depoisDoQueChegou(page);
    expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'answer' }]);
  });

  test('Atender, com o teclado do computador: o Enter ainda manda o answer', async ({ page }) => {
    await abrir(page, 'aviso');
    const antes = (await comandos(page)).length;
    await grande(page, 'Atender').focus();
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'answer' });
    expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'answer' }]);
  });

  test('a faixa da segunda: um clique duplo no Recusar manda um reject, e no Atender, um answer', async ({ page }) => {
    for (const [nome, cmd] of [
      ['Recusar', 'reject'],
      ['Atender', 'answer'],
    ] as const) {
      await abrir(page, 'ligacao-segunda');
      const antes = (await comandos(page)).length;
      await botao(page, nome).dblclick();
      await depoisDoQueChegou(page);
      expect(await depois(page, antes), nome).toEqual([{ v: 1, cmd }]);
    }
  });

  test('a faixa da segunda, com o teclado do computador: o Enter no Atender manda o answer', async ({ page }) => {
    await abrir(page, 'ligacao-segunda');
    const antes = (await comandos(page)).length;
    await botao(page, 'Atender').focus();
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'answer' });
    expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'answer' }]);
  });
});

test.describe('o clique duplo no Rediscar', () => {
  test('Teclado: um clique duplo manda um dial', async ({ page }) => {
    await abrir(page, 'principal');
    // O Windows liga o modo do nome quando chega a lista da empresa (a daEmpresa deixa de ser null).
    await mudarEstado(page, (s) => ({
      ...s,
      empresa: { link: '\\\\servidor\\contatos\\empresa.xlsx', situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: 0, vez: 1 },
    }));
    await page.evaluate(() =>
      (window as unknown as { __fake: { push(m: unknown): void } }).__fake.push({ v: 1, type: 'contatosEmpresa', vez: 1, contatos: [] }),
    );
    const antes = (await comandos(page)).length;
    await page.getByRole('button', { name: /^Rediscar/ }).dblclick();
    await depoisDoQueChegou(page);
    const saiu = (await depois(page, antes)).filter((c) => (c as { cmd: string }).cmd === 'dial');
    expect(saiu).toHaveLength(1);
  });
});
