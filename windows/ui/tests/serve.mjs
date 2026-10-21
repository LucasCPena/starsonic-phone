// Servidor estático mínimo do dist/ para os testes (o WebView2 serve a mesma pasta por um host virtual).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const porta = Number(process.argv[2] ?? 4178);
const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const arquivo = normalize(join(raiz, caminho === '/' ? 'index.html' : caminho));
  if (!arquivo.startsWith(raiz)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'content-type': tipos[extname(arquivo)] ?? 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404).end();
  }
}).listen(porta, '127.0.0.1');
