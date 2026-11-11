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

test('with another call up the notice offers no Atender com vídeo and asks 168', async ({ page }) => {
  await abrir(page, 'video-tocando', 'aviso.html');
  const comVideo = page.getByRole('button', { name: 'Atender com vídeo', exact: true });
  await expect(comVideo).toBeVisible();
  await esperarComando(page, { cmd: 'noticeHeight', altura: 222 });
  // Outra ligação (em espera) entra: a que toca, de cima, segue oferecendo vídeo, mas o vídeo pausa.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      second: { ...s.ligacao.top, id: 22, number: '2007', name: 'Carlos Lima', incoming: false, phase: 'active', held: true, activeSinceMs: 1, video: { ...s.ligacao.top.video, oferece: false } },
      secondKind: 'held',
    },
  }));
  await expect(comVideo).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await expect.poll(async () => (await alturas(page)).at(-1)).toBe(168);
  // A outra termina e a mesma ainda toca, sozinha: o botão e os 222 voltam.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: null, secondKind: 'none' } }));
  await expect(comVideo).toBeVisible();
  await expect.poll(async () => (await alturas(page)).at(-1)).toBe(222);
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

test('a doorphone ringing during another call shows its image in the notice', async ({ page }) => {
  // A Ana em ligação e o Carlos tocando como a segunda: o aviso de voz. A segunda passa a ser a Portaria (um Porteiro), já
  // com a imagem (o 183): a exceção do porteiro (decisão do responsável de 11/11/2026) a põe no aviso também com outra
  // ligação, nos 430; o Atender com vídeo continua fora, com a outra ligação em andamento.
  await abrir(page, 'ligacao-segunda', 'aviso.html');
  await esperarComando(page, { cmd: 'noticeHeight', altura: 168 });
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      second: {
        ...s.ligacao.second,
        id: 31,
        number: '1050',
        name: 'Portaria',
        video: { oferece: true, ativo: true, imagem: true, camera: false, cedo: true, porteiro: true },
      },
    },
  }));
  await expect(page.getByRole('alertdialog', { name: 'Ligação recebida de Portaria' })).toBeVisible();
  await expect(imagemDoPorteiro(page)).toBeVisible();
  await esperarComando(page, { cmd: 'videoViews', pagina: 'aviso', vistas: ['porteiro'] });
  await quadro(page, 'porteiro', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDoPorteiro(page)), RGB_DO_VERMELHO)).toBe(true);
  await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atender com vídeo' })).toHaveCount(0);
  await expect.poll(async () => (await alturas(page)).at(-1)).toBe(430);
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
