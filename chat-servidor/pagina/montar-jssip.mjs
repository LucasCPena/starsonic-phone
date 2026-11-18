// Monta o JsSIP da página: chat-servidor/internal/pagina/estatico/jssip.js, e a licença dele ao lado.
//
// O pacote do jssip 3.13.8 não traz o dist/jssip.min.js: só o lib/, em CommonJS, que pede o debug, o events e o
// sdp-transform (e o debug pede o ms). Em vez de outra dependência (um empacotador), este arquivo junta num script só
// os módulos que o lib/JsSIP.js alcança, com um require mínimo: o caminho relativo (com .js, .json ou index.js) e o
// pacote do node_modules pelo "browser" ou pelo "main" do package.json dele. O script põe o JsSIP em window.JsSIP.
// A ordem dos módulos é a da primeira vez que o require aparece, e nada no resultado depende da data nem do
// caminho da máquina: dois montadores dão os mesmos bytes.
//
// A licença, o jssip-licenca.txt, é a do JsSIP e, depois dela, a de cada pacote que vai junto no script (o arquivo
// LICENSE dele, ou o license.md), embaixo de uma linha com o nome e a versão. O cabeçalho do script nomeia os pacotes.
//
// Uso: node montar-jssip.mjs [--conferir] [--modulos <pasta do node_modules>] [--saida <jssip.js>]
//   sem argumentos: o node_modules desta pasta, e a saída em ../internal/pagina/estatico/jssip.js;
//   --conferir: não escreve; sai com 1 e diz a diferença quando o arquivo não é o do pacote.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CABECALHO = '// Gerado por chat-servidor/pagina/montar-jssip.mjs a partir do jssip 3.13.8 (MIT). Não edite.';
const VERSAO = '3.13.8';
// A linha em cima e embaixo do nome de cada pacote, na licença.
const TRACO = '-'.repeat(72);

const ehArquivo = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function arquivoDe(base, pedido) {
  for (const c of [base, `${base}.js`, `${base}.json`, join(base, 'index.js')]) {
    if (ehArquivo(c)) return c;
  }
  throw new Error(`não achei o módulo ${pedido} (${base})`);
}

// O texto da licença de um pacote: o arquivo LICENSE, LICENSE.md ou license.md da pasta dele (o primeiro na ordem, se
// houver mais de um). Sem nenhum, é erro: o pacote não iria junto sem a licença.
function licencaDe(pasta, nome) {
  const [arquivo] = readdirSync(pasta)
    .filter((a) => /^licen[cs]e(\.(md|txt))?$/i.test(a))
    .sort();
  if (!arquivo) throw new Error(`o pacote ${nome} não tem o arquivo da licença`);
  return readFileSync(join(pasta, arquivo), 'utf8');
}

/**
 * O que o montador escreve: o script do JsSIP para o navegador, com o cabeçalho que nomeia os pacotes que vão junto,
 * e a licença, a do JsSIP seguida da de cada um desses pacotes.
 */
export function montarJsSIP(modulos) {
  const pacotes = new Map(); // o nome → {versao, licenca, pasta}, de cada pacote do node_modules que entra, sem o jssip
  /** O arquivo de entrada de um pacote do node_modules: o "browser" (quando é um texto), ou o "main", ou o index.js. */
  const entradaDoPacote = (nome) => {
    const pasta = join(modulos, nome);
    const pacote = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'));
    if (nome !== 'jssip' && !pacotes.has(nome)) {
      pacotes.set(nome, { versao: pacote.version, licenca: pacote.license, pasta });
    }
    const entrada = typeof pacote.browser === 'string' ? pacote.browser : pacote.main || 'index.js';
    return arquivoDe(resolve(pasta, entrada), nome);
  };
  const resolver = (pedido, de) =>
    pedido.startsWith('./') || pedido.startsWith('../')
      ? arquivoDe(resolve(dirname(de), pedido), pedido)
      : entradaDoPacote(pedido);

  const pacoteJssip = JSON.parse(readFileSync(join(modulos, 'jssip', 'package.json'), 'utf8'));
  if (pacoteJssip.version !== VERSAO) throw new Error(`o jssip é o ${pacoteJssip.version}, e o montador é do ${VERSAO}`);

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
  const junto = [...pacotes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const licenca =
    readFileSync(join(modulos, 'jssip', 'LICENSE.md'), 'utf8') +
    junto
      .map(([nome, p]) => `\n${TRACO}\n${nome} ${p.versao}\n${TRACO}\n\n${licencaDe(p.pasta, nome).trim()}\n`)
      .join('');
  const jssip =
    [
      CABECALHO,
      '// Vêm junto os pacotes que o JsSIP pede, cada um com a licença dele no jssip-licenca.txt:',
      ...junto.map(([nome, p]) => `//   ${nome} ${p.versao} (${p.licenca})`),
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
    ].join('\n') + '\n';
  return { jssip, licenca };
}

function argumentos(args) {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const r = {
    conferir: false,
    modulos: join(aqui, 'node_modules'),
    saida: join(aqui, '..', 'internal', 'pagina', 'estatico', 'jssip.js'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--conferir') r.conferir = true;
    else if (args[i] === '--modulos' && args[i + 1]) r.modulos = resolve(args[++i]);
    else if (args[i] === '--saida' && args[i + 1]) r.saida = resolve(args[++i]);
    else throw new Error(`argumento desconhecido: ${args[i]}`);
  }
  return r;
}

function principal() {
  const { conferir, modulos, saida } = argumentos(process.argv.slice(2));
  const { jssip, licenca } = montarJsSIP(modulos);
  const esperado = [
    [saida, Buffer.from(jssip, 'utf8')],
    [join(dirname(saida), 'jssip-licenca.txt'), Buffer.from(licenca, 'utf8')],
  ];
  if (!conferir) {
    for (const [arquivo, bytes] of esperado) writeFileSync(arquivo, bytes);
    return 0;
  }
  let status = 0;
  for (const [arquivo, bytes] of esperado) {
    let atual = null;
    try {
      atual = readFileSync(arquivo);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // só o arquivo que falta é a diferença a dizer; o resto é erro de verdade
    }
    if (atual && atual.equals(bytes)) continue;
    status = 1;
    if (!atual) {
      console.error(`${arquivo} não existe; rode "node montar-jssip.mjs".`);
      continue;
    }
    let i = 0;
    while (i < atual.length && i < bytes.length && atual[i] === bytes[i]) i++;
    const linha = atual.subarray(0, i).toString('utf8').split('\n').length;
    console.error(
      `${arquivo} difere do jssip ${VERSAO} do pacote: ${atual.length} bytes contra ${bytes.length}, ` +
        `o primeiro byte diferente é o ${i} (linha ${linha}). Rode "node montar-jssip.mjs" e não edite o arquivo.`,
    );
  }
  return status;
}

try {
  process.exitCode = principal();
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
}
