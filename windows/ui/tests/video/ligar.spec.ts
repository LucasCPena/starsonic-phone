// O "Ligar com vídeo" no Teclado, nos Contatos (os meus e os da empresa) e nos Recentes (video etapa 2, Task 3), contra a
// ponte falsa: o botão novo manda o `video: true` e o Ligar de sempre continua sem o campo; sem o vídeo ligado (o cenário
// sem-video, e o iPhone), nenhum botão de vídeo aparece; e nos três tamanhos eles ficam inteiros na janela.
import { expect, test, type Page } from '@playwright/test';
import { PLANILHA_DA_EMPRESA } from '../../src/fake-scenarios';
import { abrir, esperarComando, mudarEstado, vezes } from '../helpers';

const aba = (page: Page, nome: string) => page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: nome });
const comVideo = (page: Page) => page.getByRole('button', { name: 'Ligar com vídeo', exact: true });
const qualquerVideo = (page: Page) => page.getByRole('button', { name: /^Ligar com vídeo/ });

test('the keypad has Ligar com vídeo next to Ligar', async ({ page }) => {
  await abrir(page, 'principal');
  await page.getByLabel('Número', { exact: true }).fill('2003');
  await comVideo(page).click();
  await esperarComando(page, { cmd: 'dial', numero: '2003', video: true });
  await page.getByRole('button', { name: 'Ligar', exact: true }).click();
  await esperarComando(page, { cmd: 'dial', numero: '2003' });
  expect(await vezes(page, { cmd: 'dial', numero: '2003' })).toBe(1);
});

test('a name typed on the keypad calls the first suggestion with video', async ({ page }) => {
  await abrir(page, 'principal');
  await page.getByLabel('Número', { exact: true }).fill('carl');
  await comVideo(page).click();
  await esperarComando(page, { cmd: 'dial', numero: '2007', contato: true, video: true });
});

test('each contact has Ligar com vídeo before Ligar', async ({ page }) => {
  await abrir(page, 'principal');
  await aba(page, 'Contatos').click();
  const botao = page.getByRole('button', { name: 'Ligar com vídeo para Atendimento Starsonic', exact: true });
  const ligar = page.getByRole('button', { name: 'Ligar para Atendimento Starsonic', exact: true });
  const v = (await botao.boundingBox())!;
  const l = (await ligar.boundingBox())!;
  expect(v.x + v.width, 'o vídeo vem antes do ligar').toBeLessThanOrEqual(l.x + 0.5);
  await botao.click();
  await esperarComando(page, { cmd: 'dial', numero: '(11) 5060-3000', contato: true, video: true });
});

test('a company contact has Ligar com vídeo too', async ({ page }) => {
  await abrir(page, 'contatos-empresa');
  const primeira = PLANILHA_DA_EMPRESA[0]!;
  await page.getByRole('button', { name: `Ligar com vídeo para ${primeira.nome}`, exact: true }).click();
  await esperarComando(page, { cmd: 'dial', numero: primeira.numero, contato: true, video: true });
});

test('the open recent call has Ligar com vídeo', async ({ page }) => {
  await abrir(page, 'principal');
  await aba(page, 'Recentes').click();
  await page.locator('li.row-wrap .row-hit').first().click();
  await expect(qualquerVideo(page)).toHaveCount(1);
  await comVideo(page).click();
  await esperarComando(page, { cmd: 'dial', numero: '2003', video: true });
});

for (const [nome, rota] of [
  ['sem-video', 'sem-video'],
  ['iPhone', 'principal&plataforma=ios'],
] as const) {
  test(`without video the buttons are not there (${nome})`, async ({ page }) => {
    await abrir(page, rota);
    await expect(page.getByRole('button', { name: 'Ligar', exact: true })).toBeVisible();
    await expect(qualquerVideo(page)).toHaveCount(0);
    await aba(page, 'Recentes').click();
    await page.locator('li.row-wrap .row-hit').first().click();
    await expect(qualquerVideo(page)).toHaveCount(0);
    await aba(page, 'Contatos').click();
    await expect(page.locator('li.row').first()).toBeVisible();
    await expect(qualquerVideo(page)).toHaveCount(0);
  });
}

const TAMANHOS = [
  [400, 720],
  [360, 600],
  [300, 440],
] as const;

for (const [largura, altura] of TAMANHOS) {
  test.describe(`the video buttons fit ${largura}×${altura}`, () => {
    test.use({ viewport: { width: largura, height: altura } });

    test('keypad row and long contact row', async ({ page }) => {
      await abrir(page, 'principal');
      const dentro = async (nome: string, exato = true) => {
        const b = (await page.getByRole('button', { name: nome, exact: exato }).first().boundingBox())!;
        expect(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5, `${nome}: ${JSON.stringify(b)}`).toBe(true);
      };
      await dentro('Ligar com vídeo');
      await dentro('Ligar');
      await dentro('Rediscar', false);

      await mudarEstado(page, (s) => ({
        ...s,
        contatos: [{ id: 'aa11bb22cc33dd44', nome: 'Coordenação de Logística e Transportes', numero: '2099', observacao: 'Galpão 2' }],
      }));
      await aba(page, 'Contatos').click();
      const linha = page.locator('li.row').filter({ hasText: 'Coordenação de Logística e Transportes' });
      for (const nome of ['Ligar com vídeo para', 'Ligar para', 'Mais opções para']) {
        const b = (await linha.getByRole('button', { name: new RegExp(`^${nome} Coordenação`) }).boundingBox())!;
        expect(b.x >= -0.5 && b.x + b.width <= largura + 0.5, `${nome}: ${JSON.stringify(b)}`).toBe(true);
      }
    });
  });
}
