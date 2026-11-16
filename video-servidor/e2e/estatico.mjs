// O servidor do cliente mínimo, em http://127.0.0.1:<porta>: a página (cliente/index.html), o cliente.js e o JsSIP do
// node_modules.
//
// O pacote do jssip 3.13.8 não traz o dist/jssip.min.js: só o lib/, em CommonJS, que pede o debug, o events e o
// sdp-transform. Em vez de outra dependência (um empacotador), este arquivo junta num script só os módulos que o
// lib/JsSIP.js alcança, com um require mínimo: o caminho relativo (com .js, .json ou index.js) e o pacote do
// node_modules pelo "browser" ou pelo "main" do package.json dele. O script põe o JsSIP em window.JsSIP.
//
// Uso: node estatico.mjs <porta>
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const modulos = join(raiz, 'node_modules');
const porta = Number(process.argv[2] ?? 4192);

const ehArquivo = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** O arquivo de entrada de um pacote do node_modules: o "browser" (quando é um texto), ou o "main", ou o index.js. */
function entradaDoPacote(nome) {
  const pasta = join(modulos, nome);
  const pacote = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'));
  const entrada = typeof pacote.browser === 'string' ? pacote.browser : pacote.main || 'index.js';
  return arquivoDe(resolve(pasta, entrada), nome);
}

function arquivoDe(base, pedido) {
  for (const c of [base, `${base}.js`, `${base}.json`, join(base, 'index.js')]) {
    if (ehArquivo(c)) return c;
  }
  throw new Error(`não achei o módulo ${pedido} (${base})`);
}

function resolver(pedido, de) {
  if (pedido.startsWith('./') || pedido.startsWith('../')) return arquivoDe(resolve(dirname(de), pedido), pedido);
  return entradaDoPacote(pedido);
}

/** O script do JsSIP para o navegador. */
function montarJsSIP() {
  const vistos = new Map(); // o arquivo → { id, codigo, json, mapa }
  const lista = [];
  const adicionar = (arquivo) => {
    if (vistos.has(arquivo)) return vistos.get(arquivo).id;
    const m = { id: lista.length, codigo: readFileSync(arquivo, 'utf8'), json: arquivo.endsWith('.json'), mapa: {} };
    vistos.set(arquivo, m);
    lista.push(m);
    if (!m.json) {
      for (const [, pedido] of m.codigo.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        m.mapa[pedido] = adicionar(resolver(pedido, arquivo));
      }
    }
    return m.id;
  };
  const entrada = adicionar(entradaDoPacote('jssip'));
  const definicoes = lista.map((m) =>
    m.json
      ? `function (module) { module.exports = ${m.codigo.trim()}; }`
      : `function (module, exports, require) {\n${m.codigo}\n}`,
  );
  return [
    '(function () {',
    `  var definicoes = [${definicoes.join(',\n')}];`,
    `  var mapas = ${JSON.stringify(lista.map((m) => m.mapa))};`,
    '  var prontos = [];',
    '  function carregar(id) {',
    '    if (prontos[id]) return prontos[id].exports;',
    '    var module = { exports: {} };',
    '    prontos[id] = module;',
    '    definicoes[id].call(module.exports, module, module.exports, function (pedido) {',
    '      if (!(pedido in mapas[id])) throw new Error("módulo desconhecido: " + pedido);',
    '      return carregar(mapas[id][pedido]);',
    '    });',
    '    return module.exports;',
    '  }',
    `  window.JsSIP = carregar(${entrada});`,
    '})();',
  ].join('\n');
}

const jssip = montarJsSIP();
const arquivos = {
  '/': ['text/html; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'index.html'))],
  '/index.html': ['text/html; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'index.html'))],
  '/cliente.js': ['text/javascript; charset=utf-8', () => readFileSync(join(raiz, 'cliente', 'cliente.js'))],
  '/jssip.js': ['text/javascript; charset=utf-8', () => jssip],
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
