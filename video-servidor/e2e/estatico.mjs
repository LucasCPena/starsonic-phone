// O servidor do cliente mínimo, em http://127.0.0.1:<porta>: a página (cliente/index.html), o cliente.js, o JsSIP e o
// app de mentira (cliente/app-falso.html e app-falso.js). O JsSIP é o do chat
// (chat-servidor/internal/pagina/estatico/jssip.js, montado por chat-servidor/pagina/montar-jssip.mjs): o mesmo arquivo
// que a página da reunião carrega.
//
// Uso: node estatico.mjs <porta>
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const porta = Number(process.argv[2] ?? 4192);

const jssip = readFileSync(join(raiz, '..', '..', 'chat-servidor', 'internal', 'pagina', 'estatico', 'jssip.js'));
const arquivos = {
  '/': ['text/html; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'index.html'))],
  '/index.html': ['text/html; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'index.html'))],
  '/cliente.js': ['text/javascript; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'cliente.js'))],
  '/jssip.js': ['text/javascript; charset=utf-8', () => jssip],
  // O app de mentira (colega.spec.ts), que mostra a página da reunião num iframe.
  '/app-falso.html': ['text/html; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'app-falso.html'))],
  '/app-falso.js': ['text/javascript; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'app-falso.js'))],
};

createServer((req, res) => {
  const caminho = new URL(req.url ?? '/', 'http://x').pathname;
  const arquivo = arquivos[caminho];
  if (req.method !== 'GET' || !arquivo) {
    console.log(`${req.method} ${caminho} 404`);
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': arquivo[0], 'cache-control': 'no-store' });
  res.end(arquivo[1]());
}).listen(porta, '127.0.0.1', () => console.log(`o cliente está em http://127.0.0.1:${porta}`));
