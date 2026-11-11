// A ponte falsa com o vídeo: o C++ de mentira responde aos comandos do vídeo como o núcleo (docs/ponte-windows.md,
// "Vídeo (0.3.0)" e "O vídeo na ligação"). Ela é o núcleo de mentira de toda spec da interface.
import { expect, test, type Page } from '@playwright/test';
import { abrir, entrarNaAdmin, esperarComando, estado, mudarEstado } from '../helpers';

const mandar = (page: Page, comando: Record<string, unknown>) =>
  page.evaluate((c) => (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar(c), comando);

test('the fake core carries the video state of the core', async ({ page }) => {
  await abrir(page, 'principal');
  expect((await estado(page)).video).toEqual({
    ligado: true,
    cameras: ['Integrated Camera', 'Câmera USB'],
    camera: '',
    cameraDesconectada: false,
    teste: false,
    h264: { cartao: true, pessoa: true, situacao: 'instalado' },
    janela: 'normal',
  });
  await abrir(page, 'video');
  expect((await estado(page)).ligacao.top.video).toEqual({ oferece: false, ativo: true, imagem: true, camera: true, cedo: false, porteiro: false });
});

test('the fake core answers the video commands like the core', async ({ page }) => {
  await abrir(page, 'principal');
  // A câmera escolhida que não está na lista.
  await mandar(page, { cmd: 'setVideo', camera: 'Logitech C920' });
  await expect.poll(async () => (await estado(page)).video.cameraDesconectada).toBe(true);
  await mandar(page, { cmd: 'setVideo', camera: 'Câmera USB' });
  await expect.poll(async () => (await estado(page)).video.cameraDesconectada).toBe(false);
  expect((await estado(page)).video.camera).toBe('Câmera USB');

  // O H.264 da pessoa: desligar deixa o VP8 (o `ligado` segue); ligar baixa e instala.
  await mandar(page, { cmd: 'setVideo', h264: false });
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('desligado');
  let video = (await estado(page)).video;
  expect(video.h264.pessoa).toBe(false);
  expect(video.ligado).toBe(true);
  await mandar(page, { cmd: 'setVideo', h264: true });
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('baixando');
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('instalado');

  // O h264Retry só vale depois de falhou.
  await mandar(page, { cmd: 'h264Retry' });
  expect((await estado(page)).video.h264.situacao).toBe('instalado');
  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, h264: { ...s.video.h264, situacao: 'falhou' } } }));
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('falhou');
  await mandar(page, { cmd: 'h264Retry' });
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('baixando');
  await expect.poll(async () => (await estado(page)).video.h264.situacao).toBe('instalado');

  // O teste da câmera: o `ready` da página principal o desliga.
  await mandar(page, { cmd: 'cameraTest', on: true });
  await expect.poll(async () => (await estado(page)).video.teste).toBe(true);
  await page.evaluate(() => (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar({ cmd: 'ready' }));
  await expect.poll(async () => (await estado(page)).video.teste).toBe(false);

  // A janela do vídeo: um modo desconhecido não muda nada.
  await mandar(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect.poll(async () => (await estado(page)).video.janela).toBe('grande');
  await mandar(page, { cmd: 'videoWindow', modo: 'enorme' });
  await mandar(page, { cmd: 'noticeHeight', altura: 222 });
  await mandar(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local'] });
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local'] });
  expect((await estado(page)).video.janela).toBe('grande');
});

test('the fake core refuses the camera test without cameras', async ({ page }) => {
  await abrir(page, 'sem-camera');
  await mandar(page, { cmd: 'cameraTest', on: true });
  // O aviso (o campo Câmera das Configurações, desativado, diz o mesmo).
  await expect(page.getByRole('status').filter({ hasText: 'Nenhuma câmera encontrada.' })).toBeVisible();
  expect((await estado(page)).video.teste).toBe(false);
});

test('the fake core ends the big window with the call', async ({ page }) => {
  await abrir(page, 'video-grande');
  expect((await estado(page)).video.janela).toBe('grande');
  await mandar(page, { cmd: 'hangup' });
  await expect.poll(async () => (await estado(page)).ligacao).toBeNull();
  expect((await estado(page)).video.janela).toBe('normal');
});

test('the fake core turns the camera off and on in the call', async ({ page }) => {
  await abrir(page, 'video');
  await mandar(page, { cmd: 'camera', on: false });
  await expect.poll(async () => (await estado(page)).ligacao.top.video.camera).toBe(false);
  await mandar(page, { cmd: 'camera', on: true });
  await expect.poll(async () => (await estado(page)).ligacao.top.video.camera).toBe(true);
  expect((await estado(page)).ligacao.top.video.ativo).toBe(true);
});

test('the fake core answers with video like the core', async ({ page }) => {
  await abrir(page, 'video-tocando');
  await mandar(page, { cmd: 'answer', video: true });
  await expect.poll(async () => (await estado(page)).ligacao.top.phase).toBe('active');
  expect((await estado(page)).ligacao.top.video).toEqual({ oferece: true, ativo: true, imagem: true, camera: true, cedo: false, porteiro: false });

  await abrir(page, 'video-tocando');
  await mandar(page, { cmd: 'answer' });
  await expect.poll(async () => (await estado(page)).ligacao.top.phase).toBe('active');
  expect((await estado(page)).ligacao.top.video.camera).toBe(false);

  // O porteiro segue porteiro depois de atender, como no motor; o cedo acaba no atender.
  await abrir(page, 'video-porteiro');
  expect((await estado(page)).ligacao.top.video).toEqual({ oferece: true, ativo: false, imagem: true, camera: false, cedo: true, porteiro: true });
  await mandar(page, { cmd: 'answer' });
  await expect.poll(async () => (await estado(page)).ligacao.top.phase).toBe('active');
  expect((await estado(page)).ligacao.top.video).toEqual({ oferece: true, ativo: true, imagem: true, camera: false, cedo: false, porteiro: true });
});

test('the fake core refuses the doorphones like the core', async ({ page }) => {
  await abrir(page, 'principal');
  await entrarNaAdmin(page);
  const porteiros = async () => (await estado(page)).admin.porteiros;
  expect(await porteiros()).toEqual([]);

  const recusa = async (lista: string[], texto: string) => {
    await mandar(page, { cmd: 'adminSet', porteiros: lista });
    await expect(page.getByText(texto, { exact: true }).first()).toBeVisible();
    expect(await porteiros()).toEqual([]);
  };
  await recusa(Array.from({ length: 21 }, (_, i) => String(1000 + i)), 'No máximo 20 porteiros.');
  await recusa(['10a'], 'Cada porteiro só pode ter dígitos.');
  await recusa([''], 'Cada porteiro precisa ter de 1 a 15 dígitos.');
  await recusa(['1234567890123456'], 'Cada porteiro precisa ter de 1 a 15 dígitos.');
  await recusa(['1050', '1050'], 'Esse porteiro já está na lista.');

  await mandar(page, { cmd: 'adminSet', porteiros: [' 1050 ', '1051'] });
  await expect.poll(porteiros).toEqual(['1050', '1051']);

  // O cartão: sem o H.264 nem o VP8 (o VP9 vem desligado), não sobra codec.
  expect((await estado(page)).admin).toMatchObject({ videoH264: true, videoVp8: true, videoVp9: false, videoPrimeiro: 'h264', videoQualidade: 'media' });
  await mandar(page, { cmd: 'adminSet', videoH264: false, videoVp8: false });
  await expect.poll(async () => (await estado(page)).video.ligado).toBe(false);
  expect((await estado(page)).video.h264.cartao).toBe(false);

  await mandar(page, { cmd: 'adminSet', videoPrimeiro: 'av1' });
  expect((await estado(page)).admin.videoPrimeiro).toBe('h264');
  await mandar(page, { cmd: 'adminSet', videoPrimeiro: 'vp8', videoQualidade: 'alta', videoVp9: true });
  await expect.poll(async () => (await estado(page)).admin.videoPrimeiro).toBe('vp8');
  expect((await estado(page)).admin).toMatchObject({ videoQualidade: 'alta', videoVp9: true });
  expect((await estado(page)).video.ligado).toBe(true);
});

test('the iPhone fake has no video', async ({ page }) => {
  await page.goto('/index.html?fake=video&plataforma=ios');
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
  const s = await estado(page);
  expect(s.video.ligado).toBe(false);
  expect(s.ligacao.top.video).toEqual({ oferece: false, ativo: false, imagem: false, camera: false, cedo: false, porteiro: false });
});
