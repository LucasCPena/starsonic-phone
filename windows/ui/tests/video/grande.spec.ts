// O grande e a tela cheia (video etapa 2, Task 7; os quadros Grande e TelaCheia) contra a ponte falsa: só o vídeo, a sua
// imagem no canto, a etiqueta de quem fala e a barra de baixo; o Diminuir, a Tela cheia, o duplo clique e o Esc; o cartão
// da segunda ligação; a sua imagem sempre à vista com a câmera ligada (Review Focus 2); e as medidas dos dois quadros.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, depoisDoQueChegou, esperarComando, estado, mudarEstado, vezes } from '../helpers';

test.use({ viewport: { width: 1280, height: 800 } });

const remoto = (page: Page) => page.getByRole('img', { name: 'Vídeo de Ana Souza', exact: true });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
/** Os botões da barra de baixo, na ordem da tela. */
const barraDeBaixo = (page: Page) => page.locator('.grande-barra button');
const nomes = (b: Locator) => b.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? ''));

async function caixa(alvo: Locator) {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function quase(valor: number, esperado: number, msg: string) {
  expect(Math.abs(valor - esperado), `${msg}: ${valor} perto de ${esperado}`).toBeLessThanOrEqual(1);
}

test('the big window shows only the video, your image and the bottom bar', async ({ page }) => {
  await abrir(page, 'video-grande');
  await expect(page.getByRole('button', { name: 'Minimizar' })).toBeVisible();
  await expect(page.locator('[data-resize]')).toHaveCount(0);
  const r = await caixa(remoto(page));
  quase(r.x, 0, 'o vídeo à esquerda');
  quase(r.width, 1280, 'a largura do vídeo');
  await expect(page.getByText(/^Ana Souza · Ramal 2003 · 03:1\d$/)).toBeVisible();
  const s = await caixa(suaImagem(page));
  quase(s.width, 224, 'a largura da sua imagem');
  quase(s.height, 168, 'a altura da sua imagem');
  quase(1280 - (s.x + s.width), 24, 'a sua imagem a 24 da direita');
  quase(800 - (s.y + s.height), 128, 'a sua imagem a 128 de baixo');
  expect(await nomes(barraDeBaixo(page))).toEqual(['Mudo', 'Desligar a câmera', 'Tela cheia', 'Diminuir', 'Desligar']);
  await expect(botao(page, 'Chat')).toHaveCount(0);
  // A tela da ligação não está aqui: nem o Teclado, nem o Espera.
  await expect(page.getByRole('button', { name: 'Teclado', exact: true })).toHaveCount(0);
});

test('Diminuir and Tela cheia ask the window', async ({ page }) => {
  await abrir(page, 'video-grande');
  await botao(page, 'Diminuir').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await abrir(page, 'video-grande');
  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(page.getByRole('button', { name: 'Minimizar' })).toHaveCount(0);
  await expect(botao(page, 'Tela cheia')).toHaveCount(0);
  await botao(page, 'Sair da tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(page.getByRole('button', { name: 'Minimizar' })).toBeVisible();
});

test('double click on the video goes in and out of the full screen, and Esc goes out', async ({ page }) => {
  await abrir(page, 'video-grande');
  await remoto(page).dblclick();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  await remoto(page).dblclick();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await botao(page, 'Tela cheia').click();
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  // Os efeitos do último desenho rodam depois da pintura: o ouvinte do Esc já está lá.
  await depoisDoQueChegou(page);
  const antes = await vezes(page, { cmd: 'videoWindow', modo: 'grande' });
  await page.keyboard.press('Escape');
  await expect.poll(() => vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(antes + 1);
  // No grande (a ponte falsa já respondeu e o ouvinte saiu), o Esc não faz nada.
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await depoisDoQueChegou(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(antes + 1);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(0);
});

test('Abrir grande opens the big window', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 700 });
  await abrir(page, 'video');
  await botao(page, 'Abrir grande').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(botao(page, 'Diminuir')).toBeVisible();
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await expect(remoto(page)).toBeVisible();
});

test('the call screen comes back when the call ends', async ({ page }) => {
  await abrir(page, 'video-grande');
  const id = (await estado(page)).ligacao.top.id;
  await botao(page, 'Desligar').click();
  await esperarComando(page, { cmd: 'hangup', id });
  await expect(page.getByRole('button', { name: 'Teclado', exact: true }).first()).toBeVisible();
  await expect(botao(page, 'Diminuir')).toHaveCount(0);
});

test('a second call in the big window shows its card', async ({ page }) => {
  await abrir(page, 'video-grande');
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      second: { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: { oferece: false, ativo: false, imagem: false, camera: false, cedo: false } },
      secondKind: 'ringing',
    },
  }));
  const cartao = page.getByRole('alert').filter({ hasText: 'Ligação de Carlos Lima' });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Recusar' })).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  const c = await caixa(cartao);
  quase(c.x + c.width / 2, 640, 'o cartão no meio');
  expect(c.y).toBeLessThan(120);
  // Com duas ligações, a Câmera só desliga: com a câmera ligada, ela está ativa.
  await expect(botao(page, 'Desligar a câmera')).toBeEnabled();
});

test('the big window always shows your image with the camera on', async ({ page }) => {
  await abrir(page, 'video-grande');
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...s.ligacao.top.video, imagem: false, camera: true } } } }));
  await expect(suaImagem(page)).toBeVisible();
});

test('the full screen keeps the sizes of the board', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await abrir(page, 'video-grande');
  await botao(page, 'Tela cheia').click();
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  const s = await caixa(suaImagem(page));
  quase(s.width, 288, 'a largura da sua imagem');
  quase(s.height, 216, 'a altura da sua imagem');
  quase(1920 - (s.x + s.width), 32, 'a sua imagem a 32 da direita');
  quase(1080 - (s.y + s.height), 156, 'a sua imagem a 156 de baixo');
  for (const c of await page.locator('.grande-barra .grande-c').all()) {
    const b = await caixa(c);
    quase(b.width, 60, 'o círculo');
    quase(b.height, 60, 'o círculo');
  }
});
