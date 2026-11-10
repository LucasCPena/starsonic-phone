// O Atender com vídeo e o porteiro no app (video etapa 2, Task 6; os quadros Tocando e TocandoPorteiro) contra a ponte
// falsa: os três botões redondos de uma ligação que oferece vídeo (o Atender de sempre não manda o `video`), o cartão da
// segunda que toca, a imagem do porteiro antes de atender, sem a sua câmera, nos três tamanhos, e o iPhone sem nada disso.
import { expect, test, type Page } from '@playwright/test';
import { abrir, comandos, esperarComando, mudarEstado, vezes } from '../helpers';
import { VERMELHO, corNoMeio, perto, quadro } from './video';

const RGB_DO_VERMELHO = [255, 1, 0];
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const imagemDoPorteiro = (page: Page) => page.getByRole('img', { name: 'Vídeo de Portaria', exact: true });

test('a call that offers video can be answered with or without your camera', async ({ page }) => {
  await abrir(page, 'video-tocando');
  await expect(page.locator('.round-action button.hang')).toHaveCount(3);
  await expect(botao(page, 'Recusar')).toBeVisible();
  await expect(botao(page, 'Atender')).toBeVisible();
  await expect(botao(page, 'Atender com vídeo')).toBeVisible();
  await botao(page, 'Atender').click();
  await esperarComando(page, { cmd: 'answer' });
  expect(await vezes(page, { cmd: 'answer' })).toBe(1);
  expect((await comandos(page)).filter((c) => c.cmd === 'answer' && 'video' in c)).toEqual([]);

  // Numa página nova: o Atender com vídeo manda o video: true.
  await abrir(page, 'video-tocando');
  await botao(page, 'Atender com vídeo').click();
  await esperarComando(page, { cmd: 'answer', video: true });
});

test('a call without the video offer keeps two buttons', async ({ page }) => {
  await abrir(page, 'tocando-antes-de-carregar');
  await expect(page.locator('.round-action button.hang')).toHaveCount(2);
  await expect(botao(page, 'Atender com vídeo')).toHaveCount(0);
});

const comVideoNaSegunda = (page: Page) =>
  mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, second: { ...s.ligacao.second, video: { oferece: true, ativo: false, imagem: false, camera: false, cedo: false } } },
  }));

test('the second call ringing with video has Atender com vídeo in its card', async ({ page }) => {
  await abrir(page, 'ligacao-segunda');
  const cartao = page.getByRole('alert').filter({ hasText: 'Ligação de Carlos Lima' });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Atender com vídeo' })).toHaveCount(0);
  await comVideoNaSegunda(page);
  await expect(cartao.getByRole('button', { name: 'Atender com vídeo' })).toBeVisible();
  await cartao.getByRole('button', { name: 'Atender com vídeo' }).click();
  await esperarComando(page, { cmd: 'answer', video: true });
  // O Atender do cartão segue sem o `video`.
  await abrir(page, 'ligacao-segunda');
  await comVideoNaSegunda(page);
  await page.getByRole('alert').filter({ hasText: 'Ligação de Carlos Lima' }).getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
  expect((await comandos(page)).filter((c) => c.cmd === 'answer' && 'video' in c)).toEqual([]);
});

test('the doorphone shows its image before answering, without your camera', async ({ page }) => {
  await abrir(page, 'video-porteiro');
  await expect(imagemDoPorteiro(page)).toBeVisible();
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['remoto'] });
  await quadro(page, 'remoto', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDoPorteiro(page)), RGB_DO_VERMELHO)).toBe(true);
  await expect(page.getByRole('img', { name: 'Sua imagem', exact: true })).toHaveCount(0);
});

test('the doorphone ringing screen fits the three sizes', async ({ page }) => {
  for (const [largura, altura] of [
    [400, 720],
    [360, 600],
    [300, 440],
  ] as const) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'video-porteiro');
    await expect(imagemDoPorteiro(page)).toBeVisible();
    const caixas = [await imagemDoPorteiro(page).boundingBox()];
    for (const nome of ['Recusar', 'Atender', 'Atender com vídeo']) caixas.push(await botao(page, nome).boundingBox());
    for (const c of caixas) {
      expect(c, onde).not.toBeNull();
      expect(c!.x, onde).toBeGreaterThanOrEqual(0);
      expect(c!.y, onde).toBeGreaterThanOrEqual(0);
      expect(c!.x + c!.width, onde).toBeLessThanOrEqual(largura);
      expect(c!.y + c!.height, onde).toBeLessThanOrEqual(altura);
    }
    expect(caixas[0]!.height, `a imagem sumiu: ${onde}`).toBeGreaterThan(60);
    // Os rótulos dos botões também ficam na janela.
    const rotulos = await page.locator('.round-action > span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    for (const fim of rotulos) expect(fim, onde).toBeLessThanOrEqual(altura);
    const sobra = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
    expect(sobra, `a página rola: ${onde}`).toBeLessThanOrEqual(0);
  }
});

test('on the iPhone there is no Atender com vídeo', async ({ page }) => {
  await abrir(page, 'video-tocando&plataforma=ios');
  await expect(botao(page, 'Atender')).toBeVisible();
  await expect(botao(page, 'Atender com vídeo')).toHaveCount(0);
  await expect(page.locator('.round-action button.hang')).toHaveCount(2);
});
