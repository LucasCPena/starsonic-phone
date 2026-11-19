// O cartão Vídeo da área do administrador (spec do vídeo; os quadros AdmVideo e AdmVideoEscuro) contra a ponte falsa:
// os codecs, o Primeiro, a Qualidade, os Porteiros (vão no blur e no Enter, uma vez por valor, e o núcleo recusa com o
// motivo) e a situação do H.264 da Cisco.
import { expect, test, type Page } from '@playwright/test';
import { abrir, entrarNaAdmin, esperarComando, mudarEstado, vezes } from '../helpers';

const porteiros = (page: Page) => page.getByLabel('Porteiros', { exact: true });
const situacao = (page: Page) => page.getByRole('status').filter({ hasText: 'H.264 da Cisco' });
const AJUDA = 'Ramais dos porteiros, separados por vírgula: o app mostra a imagem deles antes de atender.';

test.describe('o cartão Vídeo da área do administrador', () => {
  test('the Vídeo card shows the codecs, the first one, the quality and the doorphones', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    const titulos = await page.locator('.adm h2.eyebrow').allTextContents();
    expect(titulos.indexOf('Vídeo')).toBeGreaterThanOrEqual(0);
    expect(titulos.indexOf('Vídeo')).toBeLessThan(titulos.indexOf('Atualizações'));
    await expect(page.getByRole('switch', { name: 'H.264', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'VP8', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'VP9', exact: true })).toHaveAttribute('aria-checked', 'false');
    const primeiro = page.getByLabel('Primeiro', { exact: true });
    await expect(primeiro).toHaveValue('h264');
    await expect(primeiro.locator('option')).toHaveText(['H.264', 'VP8', 'VP9']);
    const qualidade = page.getByRole('group', { name: 'Qualidade' });
    await expect(qualidade.getByRole('radio', { name: 'Média' })).toBeChecked();
    await expect(porteiros(page)).toHaveValue('');
    await expect(porteiros(page)).toHaveAccessibleDescription(AJUDA);
    await expect(situacao(page)).toHaveText('H.264 da Cisco: instalado');
  });

  test('each change goes to the core', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    await page.getByRole('switch', { name: 'VP9', exact: true }).click();
    await esperarComando(page, { cmd: 'adminSet', videoVp9: true });
    await page.getByLabel('Primeiro', { exact: true }).selectOption('vp8');
    await esperarComando(page, { cmd: 'adminSet', videoPrimeiro: 'vp8' });
    await page.getByRole('group', { name: 'Qualidade' }).getByRole('radio', { name: 'Alta' }).check({ force: true });
    await esperarComando(page, { cmd: 'adminSet', videoQualidade: 'alta' });
  });

  test('the doorphones go on blur or Enter, once per value', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    const campo = porteiros(page);
    const lista = { cmd: 'adminSet', porteiros: ['1050', '1051'] };
    await campo.fill('1050, 1051');
    await page.keyboard.press('Tab');
    await esperarComando(page, lista);
    expect(await vezes(page, lista)).toBe(1);
    await campo.focus();
    await page.keyboard.press('Tab');
    await campo.press('Enter');
    await campo.focus();
    await campo.press('Enter');
    await expect(campo).toHaveValue('1050, 1051');
    expect(await vezes(page, lista)).toBe(1);
    await campo.fill('');
    await campo.press('Enter');
    await esperarComando(page, { cmd: 'adminSet', porteiros: [] });
  });

  test('a doorphone list the core refuses shows the reason', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    await porteiros(page).fill('10a');
    await page.keyboard.press('Tab');
    await expect(page.getByText('Cada porteiro só pode ter dígitos.', { exact: true })).toBeVisible();
    await porteiros(page).fill('1050, 1050');
    await page.keyboard.press('Tab');
    await expect(page.getByText('Esse porteiro já está na lista.', { exact: true })).toBeVisible();
  });

  test('the H.264 status follows the download, with Tentar de novo after a failure', async ({ page }) => {
    await abrir(page, 'principal');
    await entrarNaAdmin(page);
    const com = (s: string) => mudarEstado(page, (st) => ({ ...st, video: { ...st.video, h264: { ...st.video.h264, situacao: s } } }));
    await com('baixando');
    await expect(situacao(page)).toHaveText('H.264 da Cisco: baixando…');
    await expect(page.getByRole('button', { name: 'Tentar de novo', exact: true })).toHaveCount(0);
    await com('falhou');
    await expect(situacao(page)).toHaveText('H.264 da Cisco: não foi possível baixar');
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await esperarComando(page, { cmd: 'h264Retry' });
    await com('desligado');
    await expect(situacao(page)).toHaveCount(0);
  });
});
