// Empacota a interface em dist/ (o executável serve essa pasta pelo SetVirtualHostNameToFolderMapping).
// src/main.tsx → dist/app.js; src/aviso.tsx → dist/aviso.js (o aviso de ligação, quando existe);
// index.html, aviso.html, app.css, a fonte e os logos são copiados. Nada é baixado: tudo vai dentro do app.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const dist = join(raiz, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });

const entradas = [
  ['src/main.tsx', 'app.js'],
  ['src/aviso.tsx', 'aviso.js'],
].filter(([fonte]) => existsSync(join(raiz, fonte)));

for (const [fonte, saida] of entradas) {
  await build({
    entryPoints: [join(raiz, fonte)],
    outfile: join(dist, saida),
    bundle: true,
    format: 'iife',
    // O WebView2 é o Chromium atual (Evergreen); o Playwright testa no Chromium 141.
    target: ['chrome120'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    charset: 'utf8',
    logLevel: 'warning',
  });
}

for (const arquivo of ['index.html', 'aviso.html']) {
  if (existsSync(join(raiz, arquivo))) cpSync(join(raiz, arquivo), join(dist, arquivo));
}
cpSync(join(raiz, 'src', 'app.css'), join(dist, 'app.css'));
for (const arquivo of [
  'PlusJakartaSans-Variable.woff2',
  'OFL.txt',
  'starsonic-logo-negativo.png',
  'starsonic-logo-principal.png',
]) {
  cpSync(join(raiz, 'assets', arquivo), join(dist, 'assets', arquivo));
}
console.log(`dist/: ${entradas.map(([, s]) => s).join(', ')} e os arquivos estáticos`);
