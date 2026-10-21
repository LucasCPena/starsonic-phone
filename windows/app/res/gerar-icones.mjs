// Gera os ícones do app novo (windows/app/res/*.ico) no estilo da interface (design system "Starsonic"): o fone de
// linha da interface (o IconPhone de windows/ui/src/icons.tsx, traço arredondado) em branco sobre um quadrado de
// cantos arredondados com o gradient-brand (cyan #00c2cb para blue #0c2671, 135°), e os selos de estado em danger
// (#d64545). Cada .ico tem 16, 20, 24, 32, 40, 48 e 256 px (PNG dentro do .ico, como o Windows aceita desde o Vista).
//
// - app.ico           o ícone do executável e da janela (também o da bandeja conectado)
// - bandeja-conectado.ico, bandeja-sem-conexao.ico (cinza), bandeja-nao-perturbe.ico (selo com o traço),
//   bandeja-perdida.ico (selo vermelho no alto) e bandeja-tocando.ico (o fone escuro no ciano: a bandeja pisca
//   entre ele e o de estado enquanto uma ligação toca)
//
// Desenhado aqui em SVG e rasterizado pelo Chromium do Playwright (o mesmo dos testes da interface), então o
// resultado é sempre o mesmo. Não faz parte do build: rode à mão quando o desenho mudar e confira os .ico.
// Uso (da raiz do repositório, com o npm ci feito em windows/ui):
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node windows/app/res/gerar-icones.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'ui', 'package.json'));
const { chromium } = require('playwright-core');

const SIZES = [16, 20, 24, 32, 40, 48, 256];

// Os tokens (windows/ui/src/app.css).
const CYAN = '#00c2cb';
const BLUE = '#0c2671';
const DANGER = '#d64545';
const ON_CYAN = '#03222a';
const GREY_TOP = '#8a93a8';
const GREY_BOTTOM = '#3a4256';

// O fone da interface (lucide "phone", 24×24).
const PHONE =
  'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 ' +
  '4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 ' +
  '2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z';

/** O SVG de um ícone no tamanho `px` (o desenho num quadro de 64; o traço engrossa nos tamanhos pequenos). */
function svg(kind, px) {
  const glyph = 36; // o fone ocupa 36 de 64
  // Pelo menos ~1,5 px de traço na tela, nunca menos que o traço 2 da interface.
  const stroke = Math.max(2, (1.5 * 24) / ((glyph / 64) * px));
  const tile = { from: CYAN, to: BLUE, phone: '#ffffff' };
  if (kind === 'sem-conexao') Object.assign(tile, { from: GREY_TOP, to: GREY_BOTTOM });
  if (kind === 'tocando') Object.assign(tile, { from: CYAN, to: CYAN, phone: ON_CYAN });
  // Os selos encolhem o fone um pouco para o canto deles ficar livre.
  const badge = kind === 'nao-perturbe' || kind === 'perdida';
  const offset = (64 - glyph) / 2;
  const phone = `<g transform="translate(${badge ? offset - 3 : offset} ${badge ? offset + 1 : offset}) scale(${glyph / 24})">
    <path d="${PHONE}" fill="none" stroke="${tile.phone}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
  let extra = '';
  if (kind === 'nao-perturbe') {
    // O selo embaixo à direita: o círculo vermelho com o traço branco (o "proibido" do Não perturbe).
    extra = `<circle cx="47" cy="47" r="15" fill="${DANGER}" stroke="#ffffff" stroke-width="4"/>
      <rect x="38" y="44" width="18" height="6" rx="3" fill="#ffffff"/>`;
  } else if (kind === 'perdida') {
    extra = `<circle cx="48" cy="16" r="13" fill="${DANGER}" stroke="#ffffff" stroke-width="4"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${tile.from}"/><stop offset="1" stop-color="${tile.to}"/>
  </linearGradient></defs>
  <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#g)"/>
  ${phone}
  ${extra}
</svg>`;
}

/** Um .ico com os PNG de cada tamanho. */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ícone
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ px, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(px >= 256 ? 0 : px, at);
    header.writeUInt8(px >= 256 ? 0 : px, at + 1);
    header.writeUInt8(0, at + 2); // sem paleta
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4); // planos
    header.writeUInt16LE(32, at + 6); // bits por pixel
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const ICONS = {
  'app.ico': 'conectado',
  'bandeja-conectado.ico': 'conectado',
  'bandeja-sem-conexao.ico': 'sem-conexao',
  'bandeja-nao-perturbe.ico': 'nao-perturbe',
  'bandeja-perdida.ico': 'perdida',
  'bandeja-tocando.ico': 'tocando',
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, kind] of Object.entries(ICONS)) {
    const pngs = [];
    for (const px of SIZES) {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${svg(kind, px)}</body></html>`,
      );
      const data = await page.locator('svg').screenshot({ omitBackground: true, type: 'png' });
      pngs.push({ px, data });
    }
    writeFileSync(join(here, file), ico(pngs));
    console.log(`${file}: ${SIZES.join(', ')} px`);
  }
} finally {
  await browser.close();
}
