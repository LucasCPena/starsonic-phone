// Os avisos de licença do Windows (spec do vídeo, seção 6.3; o quadro Licencas), contra a ponte falsa: a linha "Avisos de
// licença" do Sobre, a tela com o OpenH264, a libvpx e a libyuv e o aviso da Cisco embaixo do OpenH264, o arquivo com cada
// licença como está no repositório e o pedido para reinstalar sem o arquivo.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AVISO_DA_CISCO } from '../../src/video/textos';
import { abrir, semViolacoesSerias } from '../helpers';

/** Os avisos de licença do Windows, como o build os põe no pacote. */
const LICENCAS = fileURLToPath(new URL('../../dist/assets/licencas-windows.txt', import.meta.url));
const PECAS = ['OpenH264 2.6.0', 'libvpx 1.16.0', 'libyuv 1678'];

/** Um arquivo do repositório, com o fim de linha do Windows trocado. */
function doRepositorio(caminho: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${caminho}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`os avisos de licença (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the Windows notices list OpenH264, libvpx and libyuv, with the Cisco notice', async ({ page }) => {
      await abrir(page, 'sobre');
      const cartao = page.locator('.about .card');
      // A linha vem depois do Código-fonte.
      const titulos = await cartao.locator('.row-title').allTextContents();
      expect(titulos.indexOf('Avisos de licença')).toBe(titulos.indexOf('Código-fonte') + 1);
      await page.getByRole('button', { name: 'Avisos de licença', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
      const avisos = page.getByRole('region', { name: 'Avisos de licença' });
      await expect(avisos.getByRole('heading', { level: 2 })).toHaveText(PECAS);
      // O destaque da Cisco logo embaixo do título do OpenH264, e só ali.
      const openh264 = avisos.locator('section').filter({ has: page.getByRole('heading', { name: 'OpenH264 2.6.0', exact: true }) });
      const destaque = openh264.getByText(AVISO_DA_CISCO, { exact: true });
      await expect(destaque).toHaveCount(1);
      expect(await destaque.evaluate((e) => e.previousElementSibling?.tagName)).toBe('H2');
      await expect(avisos.getByText(AVISO_DA_CISCO, { exact: true })).toHaveCount(1);
      await semViolacoesSerias(page);
    });
  });
}

test('the Windows notices file carries each license byte for byte', () => {
  const texto = readFileSync(LICENCAS, 'utf8').replace(/\r\n/g, '\n');
  const lock = JSON.parse(doRepositorio('build/deps.lock'));
  const libvpx = String(lock.vcpkg.versions.libvpx).split('#')[0];
  const esperadas = [
    { peca: `OpenH264 ${lock.openh264.version}`, licenca: doRepositorio('starsonic/third_party/openh264/BINARY_LICENSE.txt') },
    {
      peca: `libvpx ${libvpx}`,
      licenca: doRepositorio('starsonic/third_party/libvpx/LICENSE').replace(/\n+$/, '\n') + '\n' + doRepositorio('starsonic/third_party/libvpx/PATENTS'),
    },
    // A versão da libyuv é a do version.h do pjproject do deps.lock (LIBYUV_VERSION 1678), como diz o README dela.
    { peca: 'libyuv 1678', licenca: doRepositorio('starsonic/third_party/libyuv/LICENSE').replace(/\n+$/, '\n') + '\n' + doRepositorio('starsonic/third_party/libyuv/PATENTS') },
  ];
  expect(esperadas.map((e) => e.peca)).toEqual(PECAS);
  // Cada parte: o nome e a versão, sublinhados com "=", uma linha em branco e a licença; duas linhas em branco entre as partes.
  const titulos = Array.from(texto.matchAll(/^(\S.*)\n(=+)\n\n/gm)).filter((m) => m[1].length === m[2].length);
  expect(titulos.map((m) => m[1])).toEqual(PECAS);
  expect(titulos[0].index, 'o arquivo começa na primeira peça').toBe(0);
  for (const [i, titulo] of titulos.entries()) {
    const inicio = titulo.index! + titulo[0].length;
    const fim = i + 1 < titulos.length ? titulos[i + 1].index! - 2 : texto.length;
    if (i + 1 < titulos.length) expect(texto.slice(fim - 1, fim + 2), `${titulo[1]}: o fim`).toBe('\n\n\n');
    expect(texto.slice(inicio, fim), esperadas[i].peca).toBe(esperadas[i].licenca);
  }
});

test('the notices screen asks to reinstall when its text does not load', async ({ page }) => {
  await page.route('**/assets/licencas-windows.txt', (rota) => rota.abort());
  await abrir(page, 'sobre');
  await page.getByRole('button', { name: 'Avisos de licença', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Reinstale o Starsonic Phone.');
  await expect(page.getByRole('heading', { name: 'Avisos de licença', level: 1 })).toBeVisible();
  await semViolacoesSerias(page);
});
