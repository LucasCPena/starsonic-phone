import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
