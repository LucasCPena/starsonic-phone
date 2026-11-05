// Sobe o servidor do chat (Go) em modo de teste para as specs que falam com ele: o programa vem do STARSONIC_CHAT_BIN
// (o CI compila antes) ou é compilado aqui. A pasta de dados começa vazia a cada rodada.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDoChat, CHAT_PORTA } from './servidor';

const RAIZ_UI = fileURLToPath(new URL('../../', import.meta.url));
const SERVIDOR = fileURLToPath(new URL('../../../../chat-servidor/', import.meta.url));
const SAIDA = join(RAIZ_UI, 'test-results', 'chat');
const ORIGEM_DA_INTERFACE = 'http://127.0.0.1:4178';

function programa(): string {
  if (process.env.STARSONIC_CHAT_BIN) return process.env.STARSONIC_CHAT_BIN;
  const bin = join(SAIDA, 'starsonic-chat');
  const semProxy = 'localhost,127.0.0.1'; // o proxy do ambiente não alcança o servidor local
  const r = spawnSync('go', ['build', '-o', bin, './cmd/starsonic-chat'], {
    cwd: SERVIDOR,
    stdio: 'inherit',
    env: { ...process.env, NO_PROXY: semProxy, no_proxy: semProxy },
  });
  if (r.status !== 0) throw new Error('o go build do servidor do chat falhou');
  return bin;
}

async function esperarNoAr(filho: ChildProcess): Promise<void> {
  const fim = Date.now() + 10_000;
  while (Date.now() < fim) {
    if (filho.exitCode !== null) throw new Error(`o servidor do chat saiu (código ${filho.exitCode}); veja test-results/chat/servidor.log`);
    try {
      if ((await fetch(`${baseDoChat()}/admin/entrar`)).status === 200) return;
    } catch {
      // ainda não escuta
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('o servidor do chat não respondeu em 10 s');
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  rmSync(join(SAIDA, 'dados'), { recursive: true, force: true });
  mkdirSync(join(SAIDA, 'dados'), { recursive: true });
  const bin = programa();
  const dados = join(SAIDA, 'dados');

  // O administrador de teste, com uma senha sorteada a cada rodada: ela só vai para o ambiente dos testes.
  const senha = randomBytes(18).toString('base64url');
  const criar = spawnSync(bin, ['admin-criar', 'teste', '--dados', dados], { input: `${senha}\n${senha}\n`, encoding: 'utf8' });
  if (criar.status !== 0) throw new Error(`o admin-criar falhou: ${criar.stderr}${criar.stdout}`.replaceAll(senha, '***'));
  process.env.CHAT_ADMIN_SENHA = senha;

  const log = openSync(join(SAIDA, 'servidor.log'), 'w');
  const filho = spawn(
    bin,
    ['servir', '--teste', '--escutar', `127.0.0.1:${CHAT_PORTA}`, '--dados', dados, '--origem', ORIGEM_DA_INTERFACE],
    { stdio: ['ignore', log, log] },
  );
  closeSync(log);
  try {
    await esperarNoAr(filho);
  } catch (e) {
    filho.kill('SIGKILL');
    throw e;
  }

  return async () => {
    if (filho.exitCode !== null) return;
    const saiu = new Promise<void>((r) => filho.once('exit', () => r()));
    filho.kill('SIGTERM');
    const forca = setTimeout(() => filho.kill('SIGKILL'), 10_000);
    await saiu;
    clearTimeout(forca);
  };
}
