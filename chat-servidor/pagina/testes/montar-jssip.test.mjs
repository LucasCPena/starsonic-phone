import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..');
const montador = join(pasta, 'montar-jssip.mjs');
const modulos = join(pasta, 'node_modules');
const CABECALHO =
  '// Gerado por chat-servidor/pagina/montar-jssip.mjs a partir do jssip 3.13.8 (MIT). Não edite.';

const temporarias = [];
const temporaria = () => {
  const d = mkdtempSync(join(tmpdir(), 'jssip-'));
  temporarias.push(d);
  return d;
};
after(() => temporarias.forEach((d) => rmSync(d, { recursive: true, force: true })));

const rodar = (saida, ...extra) =>
  spawnSync(process.execPath, [montador, '--modulos', modulos, '--saida', saida, ...extra], { encoding: 'utf8' });

test('montar duas vezes dá os mesmos bytes', () => {
  const a = join(temporaria(), 'jssip.js');
  const b = join(temporaria(), 'jssip.js');
  assert.equal(rodar(a).status, 0);
  assert.equal(rodar(b).status, 0);
  assert.ok(readFileSync(a).equals(readFileSync(b)));
});

test('o arquivo começa com o cabeçalho', () => {
  const a = join(temporaria(), 'jssip.js');
  assert.equal(rodar(a).status, 0);
  assert.equal(readFileSync(a, 'utf8').split('\n')[0], CABECALHO);
});

// Os pacotes que o lib/ do jssip pede e que vão dentro do jssip.js, cada um com o arquivo da licença dele.
const PACOTES = [
  ['debug', 'LICENSE'],
  ['events', 'LICENSE'],
  ['ms', 'license.md'],
  ['sdp-transform', 'LICENSE'],
];

test('a licença leva a de cada pacote que vai no jssip.js, e o cabeçalho os nomeia', () => {
  const dir = temporaria();
  const a = join(dir, 'jssip.js');
  assert.equal(rodar(a).status, 0);
  const licenca = readFileSync(join(dir, 'jssip-licenca.txt'), 'utf8');
  // A do JsSIP primeiro, como vem no pacote.
  assert.ok(licenca.startsWith(readFileSync(join(modulos, 'jssip', 'LICENSE.md'), 'utf8')));
  const script = readFileSync(a, 'utf8');
  const cabecalho = script.slice(0, script.indexOf('(function () {')).split('\n');
  const nomeados = [];
  for (const [nome, arquivo] of PACOTES) {
    const { version, license } = JSON.parse(readFileSync(join(modulos, nome, 'package.json'), 'utf8'));
    const texto = readFileSync(join(modulos, nome, arquivo), 'utf8').trim();
    assert.match(licenca, new RegExp(`\\n${nome} ${version.replaceAll('.', '\\.')}\\n-+\\n\\n`), `a linha do ${nome}`);
    assert.ok(licenca.includes(`\n\n${texto}\n`), `o texto da licença do ${nome}`);
    nomeados.push(`//   ${nome} ${version} (${license})`);
  }
  // O cabeçalho nomeia esses quatro, e só eles: um pacote novo no jssip.js pede outra olhada na licença dele.
  assert.deepEqual(
    cabecalho.filter((l) => l.startsWith('//   ')),
    nomeados,
  );
});

test('um pacote sem o arquivo da licença é erro, e nada é escrito', () => {
  // Uma cópia do node_modules com os cinco pacotes, sem a licença do ms.
  const copia = temporaria();
  for (const nome of ['jssip', ...PACOTES.map(([n]) => n)]) {
    cpSync(join(modulos, nome), join(copia, nome), { recursive: true });
  }
  rmSync(join(copia, 'ms', 'license.md'));
  const a = join(temporaria(), 'jssip.js');
  const r = spawnSync(process.execPath, [montador, '--modulos', copia, '--saida', a], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /o pacote ms não tem o arquivo da licença/);
  assert.equal(existsSync(a), false);
});

test('o --conferir acusa um byte trocado', () => {
  const dir = temporaria();
  const a = join(dir, 'jssip.js');
  assert.equal(rodar(a).status, 0);
  assert.equal(rodar(a, '--conferir').status, 0);
  const bytes = readFileSync(a);
  bytes[bytes.length - 10] ^= 1;
  writeFileSync(a, bytes);
  const r = rodar(a, '--conferir');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /difere/);
});

test('o --conferir diz que o arquivo não existe, e sai com 1', () => {
  const dir = temporaria();
  const a = join(dir, 'jssip.js');
  assert.equal(rodar(a).status, 0);
  rmSync(a);
  const r = rodar(a, '--conferir');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não existe/);
});

test('o --conferir acusa a licença que difere', () => {
  const dir = temporaria();
  const a = join(dir, 'jssip.js');
  assert.equal(rodar(a).status, 0);
  writeFileSync(join(dir, 'jssip-licenca.txt'), 'outra licença\n');
  const r = rodar(a, '--conferir');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /jssip-licenca\.txt difere/);
});

test('o --conferir não engole um erro de leitura que não é arquivo faltando', () => {
  const dir = temporaria();
  const a = join(dir, 'jssip.js');
  assert.equal(rodar(a).status, 0);
  rmSync(a);
  mkdirSync(a); // ler uma pasta dá EISDIR, e não ENOENT
  const r = rodar(a, '--conferir');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /EISDIR/);
});
