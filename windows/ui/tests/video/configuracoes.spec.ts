// O "Áudio e vídeo" das Configurações (spec do vídeo, 4.1; os quadros Configuracoes e ConfiguracoesEscuro) contra a ponte
// falsa: o campo Câmera, o Testar a câmera com a sua imagem desenhada pela vista de vídeo (o WebGL, ou o canvas 2D), o
// encaixe quando o tamanho do quadro muda, o teste que para quando a tela sai, a chave do H.264 da Cisco, as memórias
// que não conferem e o iPhone sem vídeo. E o contrato da página com as memórias, pela prévia: a imagem em pé e
// espelhada, a vista que volta só com um quadro mais novo, o `seq` 0 vazio e a memória nova que solta a velha.
import { expect, test, type Page } from '@playwright/test';
import { createScenario } from '../../src/fake-scenarios';
import { TAMANHO_DA_MEMORIA } from '../../src/video/memoria';
import { abrir, esperarComando, estado, mudarEstado, semViolacoesSerias, vezes } from '../helpers';
import { BRANCO, FUNDO, VERMELHO, corNoMeio, corNoPonto, perto, quadro, semWebGL } from './video';

const RGB_DO_VERMELHO = [255, 1, 0];
const RGB_DO_BRANCO = [255, 255, 255];
const AVISO_DA_CISCO = 'OpenH264 Video Codec provided by Cisco Systems, Inc.';

const campoCamera = (page: Page) => page.getByLabel('Câmera', { exact: true });
const testar = (page: Page) => page.getByRole('button', { name: 'Testar a câmera', exact: true });
const previa = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const chaveH264 = (page: Page) => page.getByRole('switch', { name: 'H.264 da Cisco', exact: true });

/** Espera a cor (perto, com a tolerância de 2) no ponto que `ler` lê; na falha, mostra a última cor lida. */
async function esperarCor(ler: () => Promise<[number, number, number]>, esperada: number[]): Promise<void> {
  await expect
    .poll(async () => {
      const cor = await ler();
      return perto(cor, esperada) ? esperada : cor;
    })
    .toEqual(esperada);
}

/** Liga o teste da câmera pelo botão: a prévia aparece com a memória da vista `local`. */
async function ligarOTeste(page: Page): Promise<void> {
  await testar(page).click();
  await esperarComando(page, { cmd: 'cameraTest', on: true });
  await expect(previa(page)).toBeVisible();
  await expect(previa(page)).toHaveAttribute('data-memoria');
}

/** Uma memória qualquer, com o `additionalData` dado (a ponte falsa a entrega como o executável). */
async function memoriaCrua(page: Page, dados: unknown, bytes: number): Promise<void> {
  await page.evaluate(
    ({ dados, bytes }) => (window as unknown as { __fake: { memoriaCrua(d: unknown, b: number): void } }).__fake.memoriaCrua(dados, bytes),
    { dados, bytes },
  );
}

const liberadas = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { liberadas(): number } }).__fake.liberadas());

/** Espera `n` quadros de tela da página (a leitura das vistas roda a cada um). */
async function quadrosDeTela(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((pronto) => {
        const proximo = () => (--n === 0 ? pronto() : requestAnimationFrame(proximo));
        requestAnimationFrame(proximo);
      }),
    n,
  );
}

test("Áudio e vídeo has the Câmera field with the computer's cameras", async ({ page }) => {
  await abrir(page, 'configuracoes');
  await expect(page.getByRole('heading', { name: 'Áudio e vídeo', exact: true, level: 2 })).toBeVisible();
  // Depois do Toque, como o Microfone e o Alto-falante.
  const toque = (await page.getByLabel('Toque', { exact: true }).boundingBox())!;
  const camera = campoCamera(page);
  expect((await camera.boundingBox())!.y).toBeGreaterThan(toque.y);
  await expect(camera.locator('option')).toHaveText(['Integrated Camera', 'Câmera USB']);
  await expect(camera.locator('option:checked')).toHaveText('Integrated Camera');
  await expect(camera).toBeEnabled();
  await camera.selectOption('Câmera USB');
  await esperarComando(page, { cmd: 'setVideo', camera: 'Câmera USB' });
  await expect(camera).toHaveValue('Câmera USB');
});

test('a chosen camera that is not connected shows (desconectada)', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, camera: 'Logitech C920', cameraDesconectada: true } }));
  const camera = campoCamera(page);
  await expect(camera.locator('option:checked')).toHaveText('Logitech C920 (desconectada)');
  await expect(camera.locator('option')).toHaveText(['Integrated Camera', 'Câmera USB', 'Logitech C920 (desconectada)']);
  await expect(camera).toHaveValue('Logitech C920');
});

test('without cameras the field says Nenhuma câmera encontrada. and the test is off', async ({ page }) => {
  await abrir(page, 'sem-camera');
  const camera = campoCamera(page);
  await expect(camera).toBeDisabled();
  await expect(camera.locator('option')).toHaveText(['Nenhuma câmera encontrada.']);
  await expect(testar(page)).toBeDisabled();
  await semViolacoesSerias(page);
});

test('Testar a câmera shows your image until Parar o teste', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await expect(previa(page)).toHaveCount(0);
  await ligarOTeste(page);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local'] });
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
  const comWebGL = await page.evaluate(() => document.createElement('canvas').getContext('webgl') !== null);
  await expect(previa(page).locator('canvas')).toHaveAttribute('data-desenho', comWebGL ? 'webgl' : '2d');
  // A prévia 16:9 na largura do cartão.
  const caixa = (await previa(page).boundingBox())!;
  expect(caixa.width / caixa.height).toBeCloseTo(16 / 9, 1);
  await semViolacoesSerias(page);

  await page.getByRole('button', { name: 'Parar o teste', exact: true }).click();
  await esperarComando(page, { cmd: 'cameraTest', on: false });
  await expect(previa(page)).toHaveCount(0);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: [] });
  await expect(testar(page)).toBeVisible();
});

test('without WebGL the preview draws with the 2D canvas', async ({ page }) => {
  await semWebGL(page);
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await expect(previa(page).locator('canvas')).toHaveAttribute('data-desenho', '2d');
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
});

test('a size change in the middle letterboxes the new size', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  // Um quadro 4:3 na prévia 16:9: as faixas do fundo dos lados.
  await quadro(page, 'local', VERMELHO, 640, 480);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
  const caixa = (await previa(page).boundingBox())!;
  const naBorda = () => corNoPonto(page, Math.floor(caixa.x) + 3, Math.floor(caixa.y + caixa.height / 2));
  await esperarCor(naBorda, FUNDO);
  // Um 16:9 no meio do teste: a imagem nova ocupa a prévia de lado a lado.
  await quadro(page, 'local', BRANCO, 1280, 720);
  await esperarCor(naBorda, RGB_DO_BRANCO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_BRANCO);
});

test('your image shows upright and mirrored, like a mirror', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
  // Um quadro 16:9 (sem as faixas) só com o quarto de cima à esquerda branco, o resto preto.
  await page.evaluate(() => {
    const largura = 640;
    const altura = 360;
    const y = new Uint8Array(largura * altura).fill(16);
    for (let linha = 0; linha < altura / 2; linha++) y.fill(235, linha * largura, linha * largura + largura / 2);
    (window as unknown as { __fake: { quadro(...a: unknown[]): boolean } }).__fake.quadro('local', largura, altura, y, 128, 128);
  });
  const caixa = (await previa(page).boundingBox())!;
  const ponto = (fx: number, fy: number) => corNoPonto(page, Math.floor(caixa.x + caixa.width * fx), Math.floor(caixa.y + caixa.height * fy));
  // Como num espelho: o branco em cima, à direita.
  await esperarCor(() => ponto(0.75, 0.25), RGB_DO_BRANCO);
  for (const [fx, fy] of [
    [0.25, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]) {
    await esperarCor(() => ponto(fx, fy), [0, 0, 0]);
  }
});

test('a preview that comes back draws only a newer frame, and an emptied memory shows only the background', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
  await page.getByRole('button', { name: 'Parar o teste', exact: true }).click();
  await expect(previa(page)).toHaveCount(0);

  // De volta, com a mesma memória (o quadro vermelho ainda nela): a vista que monta só desenha um quadro mais novo.
  await ligarOTeste(page);
  await quadrosDeTela(page, 10);
  const agora = await corNoMeio(page, previa(page));
  expect(perto(agora, FUNDO), `o quadro de antes apareceu: ${agora}`).toBe(true);
  await quadro(page, 'local', BRANCO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_BRANCO);

  // A memória esvaziada (o `seq` 0): sem imagem, só o fundo.
  await page.evaluate(() => (window as unknown as { __fake: { esvaziar(v: string): void } }).__fake.esvaziar('local'));
  await esperarCor(() => corNoMeio(page, previa(page)), FUNDO);
});

test('leaving Configurações by any way stops the camera test', async ({ page }) => {
  const parar = { cmd: 'cameraTest', on: false };
  const saiu = async () => {
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true, level: 1 })).toHaveCount(0);
    await expect.poll(() => vezes(page, parar)).toBe(1);
    await expect.poll(async () => (await estado(page)).video.teste).toBe(false);
    expect(await vezes(page, parar)).toBe(1);
  };

  // O Voltar.
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await saiu();

  // Uma ligação que chega.
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await mudarEstado(page, (s) => ({ ...s, ligacao: createScenario('aviso')!.state.ligacao }));
  await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await saiu();

  // O Ctrl + 1.
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await page.keyboard.press('Control+1');
  await saiu();
});

test("the H.264 switch shows the Cisco notice and follows the person's choice", async ({ page }) => {
  await abrir(page, 'configuracoes');
  const chave = chaveH264(page);
  await expect(chave).toHaveAttribute('aria-checked', 'true');
  await expect(chave).toHaveAccessibleDescription(AVISO_DA_CISCO);
  await expect(page.getByText(AVISO_DA_CISCO, { exact: true })).toBeVisible();
  await chave.click();
  await esperarComando(page, { cmd: 'setVideo', h264: false });
  await expect(chave).toHaveAttribute('aria-checked', 'false');
});

test('the H.264 switch stays while the person turned video off, and goes with the admin card', async ({ page }) => {
  await abrir(page, 'configuracoes');
  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, ligado: false, h264: { ...s.video.h264, cartao: true, pessoa: false } } }));
  await expect(chaveH264(page)).toHaveAttribute('aria-checked', 'false');
  await expect(campoCamera(page)).toHaveCount(0);
  await expect(testar(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Áudio e vídeo', exact: true, level: 2 })).toBeVisible();

  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, ligado: false, h264: { ...s.video.h264, cartao: false } } }));
  await expect(page.getByRole('heading', { name: 'Áudio', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Áudio e vídeo', exact: true })).toHaveCount(0);
  await expect(chaveH264(page)).toHaveCount(0);
  await expect(campoCamera(page)).toHaveCount(0);
  await expect(testar(page)).toHaveCount(0);
});

test('a buffer with wrong data is released and never drawn', async ({ page }) => {
  await abrir(page, 'configuracoes');
  // Uma memória boa com o additionalData em texto JSON (a do `remoto`, que esta tela não mostra) fica com a página.
  await memoriaCrua(page, JSON.stringify({ v: 1, type: 'videoBuffer', vista: 'remoto', bytes: TAMANHO_DA_MEMORIA }), TAMANHO_DA_MEMORIA);
  // Menor que a combinada, e de uma vista que não existe: soltas na hora.
  await memoriaCrua(page, { v: 1, type: 'videoBuffer', vista: 'local', bytes: TAMANHO_DA_MEMORIA }, 100);
  await memoriaCrua(page, { v: 1, type: 'videoBuffer', vista: 'outra', bytes: TAMANHO_DA_MEMORIA }, TAMANHO_DA_MEMORIA);
  await expect.poll(() => liberadas(page)).toBe(2);

  await ligarOTeste(page);
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);
  expect(await liberadas(page)).toBe(2);
});

test('a new memory of a view releases the old one, which the view never reads again', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, 'configuracoes');
  await ligarOTeste(page);
  await quadro(page, 'local', VERMELHO);
  await esperarCor(() => corNoMeio(page, previa(page)), RGB_DO_VERMELHO);

  // Outra memória da mesma vista: a velha é solta (e fica inacessível na página, como no WebView2).
  await memoriaCrua(page, { v: 1, type: 'videoBuffer', vista: 'local', bytes: TAMANHO_DA_MEMORIA }, TAMANHO_DA_MEMORIA);
  await expect.poll(() => liberadas(page)).toBe(1);
  // A nova, ainda sem quadro: só o fundo, e a leitura nunca mais toca a velha.
  await esperarCor(() => corNoMeio(page, previa(page)), FUNDO);
  await quadrosDeTela(page, 10);
  expect(erros).toEqual([]);
});

test('on the iPhone the settings have no video', async ({ page }) => {
  await page.goto('/index.html?fake=configuracoes&plataforma=ios');
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ligações', exact: true })).toBeVisible();
  await expect(campoCamera(page)).toHaveCount(0);
  await expect(testar(page)).toHaveCount(0);
  await expect(page.getByText('H.264 da Cisco')).toHaveCount(0);
  await expect(chaveH264(page)).toHaveCount(0);
});
