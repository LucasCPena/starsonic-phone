// Empacota a interface em dist/ (o executável serve essa pasta pelo SetVirtualHostNameToFolderMapping).
// src/main.tsx → dist/app.js; src/aviso.tsx → dist/aviso.js (o aviso de ligação, quando existe);
// index.html, aviso.html, app.css, a fonte, os logos, o toque do MicroSIP (toque.wav, rc.4) e o aviso da licença do
// Preact são copiados. Nada é baixado: tudo vai dentro do app.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

cpSync(join(raiz, 'src', 'app.css'), join(dist, 'app.css'));
// As páginas pedem o script e os estilos com o conteúdo deles na URL (app.js?v=<12 do SHA-256>): o cache do WebView2
// nunca junta a página de uma versão com o app.js de outra (o executável abre a página com a versão: ?v=<versão>).
const marca = (arquivo) => createHash('sha256').update(readFileSync(join(dist, arquivo))).digest('hex').slice(0, 12);
for (const arquivo of ['index.html', 'aviso.html']) {
  if (!existsSync(join(raiz, arquivo))) continue;
  let html = readFileSync(join(raiz, arquivo), 'utf8');
  for (const recurso of ['app.js', 'aviso.js', 'app.css']) {
    if (!existsSync(join(dist, recurso))) continue;
    html = html.replace(new RegExp(`((?:src|href)=")${recurso.replace('.', '\\.')}"`, 'g'), `$1${recurso}?v=${marca(recurso)}"`);
  }
  writeFileSync(join(dist, arquivo), html);
}
for (const arquivo of [
  'PlusJakartaSans-Variable.woff2',
  'OFL.txt',
  'starsonic-logo-negativo.png',
  'starsonic-logo-principal.png',
  'toque.wav',
]) {
  cpSync(join(raiz, 'assets', arquivo), join(dist, 'assets', arquivo));
}
// O aviso da licença MIT do Preact, que vai dentro do app.js (a licença pede o aviso junto das cópias), ao lado do
// OFL.txt da fonte; o instalador leva a pasta ui\ inteira.
cpSync(join(raiz, 'node_modules', 'preact', 'LICENSE'), join(dist, 'assets', 'preact-LICENSE.txt'));
console.log(`dist/: ${entradas.map(([, s]) => s).join(', ')} e os arquivos estáticos`);
