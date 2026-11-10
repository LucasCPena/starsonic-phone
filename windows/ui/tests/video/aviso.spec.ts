// O aviso do canto (aviso.html) com o vídeo (video etapa 2, Task 6; os quadros Aviso e AvisoPorteiro): o Atender com vídeo,
// a imagem do porteiro, a altura que a página pede ao executável (o `noticeHeight`) e o encaixe de cada altura.
import { expect, test, type Page } from '@playwright/test';
import { ALTURA_DO_AVISO } from '../../src/video/alturaDoAviso';
import { abrir, comandos, esperarComando, mudarEstado } from '../helpers';
import { VERMELHO, corNoMeio, perto, quadro } from './video';

const RGB_DO_VERMELHO = [255, 1, 0];
const imagemDoPorteiro = (page: Page) => page.getByRole('img', { name: 'Vídeo de Portaria', exact: true });
const alturas = async (page: Page) => (await comandos(page)).filter((c) => c.cmd === 'noticeHeight').map((c) => c.altura);

test('the notice offers Atender com vídeo and asks for its height', async ({ page }) => {
  await abrir(page, 'video-tocando', 'aviso.html');
  await page.getByRole('button', { name: 'Atender com vídeo', exact: true }).click();
  await esperarComando(page, { cmd: 'answer', video: true });
  await esperarComando(page, { cmd: 'noticeHeight', altura: 222 });
  expect((await comandos(page)).filter((c) => c.cmd === 'answer' && !('video' in c))).toEqual([]);
});

test('a voice notice keeps 168', async ({ page }) => {
  await abrir(page, 'aviso', 'aviso.html');
  await esperarComando(page, { cmd: 'noticeHeight', altura: 168 });
  await expect(page.getByRole('button', { name: 'Atender com vídeo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
});

test('the doorphone notice shows the image and grows to 430', async ({ page }) => {
  await abrir(page, 'video-porteiro', 'aviso.html');
  await expect(imagemDoPorteiro(page)).toBeVisible();
  await esperarComando(page, { cmd: 'videoViews', pagina: 'aviso', vistas: ['porteiro'] });
  await esperarComando(page, { cmd: 'noticeHeight', altura: 430 });
  await quadro(page, 'porteiro', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDoPorteiro(page)), RGB_DO_VERMELHO)).toBe(true);

  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...s.ligacao.top.video, cedo: false } } },
  }));
  await expect(imagemDoPorteiro(page)).toHaveCount(0);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'aviso', vistas: [] });
  await esperarComando(page, { cmd: 'noticeHeight', altura: 222 });
});

test('each notice height fits its content', async ({ page }) => {
  for (const [cenario, altura] of [
    ['aviso', ALTURA_DO_AVISO.voz],
    ['video-tocando', ALTURA_DO_AVISO.video],
    ['video-porteiro', ALTURA_DO_AVISO.porteiro],
  ] as const) {
    await page.setViewportSize({ width: 380, height: altura });
    await abrir(page, cenario, 'aviso.html');
    await esperarComando(page, { cmd: 'noticeHeight', altura });
    // O brilho do fundo (o ::before, de 520 px) sai da conta: ele só enfeita e passa da janela de propósito.
    await page.addStyleTag({ content: '.aviso::before { display: none !important; }' });
    const medidas = await page.evaluate(() => {
      const aviso = document.querySelector('.aviso')!;
      const quem = document.querySelector('.aviso-quem')!.getBoundingClientRect();
      const botoes = document.querySelector('.aviso-botoes')!.getBoundingClientRect();
      return { rolagem: aviso.scrollHeight, folga: botoes.top - quem.bottom };
    });
    expect(medidas.rolagem, `${cenario}: o conteúdo passa de ${altura}`).toBeLessThanOrEqual(altura);
    expect(Math.abs(medidas.folga - 32), `${cenario}: entre o quem e os botões`).toBeLessThanOrEqual(1);
  }
});

test('the empty notice goes back to 168', async ({ page }) => {
  await abrir(page, 'video-porteiro', 'aviso.html');
  await esperarComando(page, { cmd: 'noticeHeight', altura: 430 });
  // O Recusar: o estado sem ninguém tocando deixa o aviso vazio, e a altura volta (o executável guarda a última).
  await page.getByRole('button', { name: 'Recusar', exact: true }).click();
  await esperarComando(page, { cmd: 'reject' });
  await expect.poll(async () => (await alturas(page)).at(-1)).toBe(168);
});
