// O chat de verdade para os testes das telas (o globalSetup): compila o starsonic-chat e o sobe no modo de teste, numa
// pasta temporária que some no fim. Ele serve a página (/r/<código>, com a CSP), os arquivos dela e a fonte e o logo
// de /admin/estatico/; o abrir e o canal ficam com a rede falsa de cada teste (rede-falsa.ts). Para os testes da página
// de administração (admin.spec.ts), ele cria o usuário `teste`, com uma senha sorteada a cada rodada, que só vai para
// os testes (o CHAT_ADMIN_SENHA).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA = 4193;
/** O endereço do chat: o baseURL dos testes. */
export const CHAT = `http://127.0.0.1:${PORTA}`;
/** A origem da janela de cima de mentira dos testes da página dentro do app: o chat a põe no frame-ancestors. */
const ORIGEM_DE_CIMA = 'http://127.0.0.1:4194';

const SERVIDOR = fileURLToPath(new URL('../', import.meta.url));
/** A saída do chat, para ler numa falha. */
const REGISTRO = fileURLToPath(new URL('./test-results/chat.log', import.meta.url));

/** Confere que a porta está livre: um chat de uma rodada anterior que ficou no ar faria os testes falarem com ele. */
function portaLivre(): Promise<void> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', () => {
      falha(new Error(`a porta ${PORTA} está ocupada (um chat de uma rodada anterior ficou no ar?)`));
    });
    s.listen(PORTA, '127.0.0.1', () => s.close(() => ok()));
  });
}

function compilar(bin: string): void {
  const semProxy = 'localhost,127.0.0.1'; // o proxy do ambiente não alcança o chat local
  const r = spawnSync('go', ['build', '-o', bin, './cmd/starsonic-chat'], {
    cwd: SERVIDOR,
    encoding: 'utf8', // a saída do build só aparece quando ele falha: o teste que passa não leva o registro dele
    env: { ...process.env, NO_PROXY: semProxy, no_proxy: semProxy, CGO_ENABLED: '0' },
  });
  if (r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `${r.error.message}\n` : ''}`);
    throw new Error('o go build do chat falhou');
  }
}

/** Espera o chat servir os arquivos da página, até 15 s. */
async function esperarNoAr(filho: ChildProcess): Promise<void> {
  let erro: Error | undefined; // o 'error' do processo: ele nem subiu
  filho.on('error', (e) => {
    erro = e;
  });
  const fim = Date.now() + 15_000;
  while (Date.now() < fim) {
    if (erro) throw new Error(`o chat não subiu: ${erro.message}`);
    if (filho.exitCode !== null) throw new Error(`o chat saiu (código ${filho.exitCode}); veja ${REGISTRO}`);
    try {
      if ((await fetch(`${CHAT}/r/estatico/pagina.css`)).status === 200) return;
    } catch {
      // ainda não escuta
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`o chat não respondeu em 15 s; veja ${REGISTRO}`);
}

export default async function chat(): Promise<() => Promise<void>> {
  await portaLivre();
  const pasta = mkdtempSync(join(tmpdir(), 'starsonic-pagina-'));
  const parar: { filho?: ChildProcess } = {};
  const limpar = async () => {
    const { filho } = parar;
    if (filho && filho.exitCode === null && filho.signalCode === null) {
      const saiu = new Promise<void>((r) => filho.once('exit', () => r()));
      filho.kill('SIGTERM');
      const forca = setTimeout(() => filho.kill('SIGKILL'), 10_000);
      await saiu;
      clearTimeout(forca);
    }
    rmSync(pasta, { recursive: true, force: true });
  };
  try {
    const bin = join(pasta, 'starsonic-chat');
    compilar(bin);
    const dados = join(pasta, 'dados');
    mkdirSync(dados);
    const senha = randomBytes(18).toString('base64url');
    const criar = spawnSync(bin, ['admin-criar', 'teste', '--dados', dados], { input: `${senha}\n${senha}\n`, encoding: 'utf8' });
    if (criar.status !== 0) throw new Error(`o admin-criar falhou: ${criar.stderr}${criar.stdout}`.replaceAll(senha, '***'));
    process.env.CHAT_ADMIN_SENHA = senha;
    mkdirSync(join(REGISTRO, '..'), { recursive: true });
    const log = openSync(REGISTRO, 'w');
    try {
      parar.filho = spawn(bin, ['servir', '--teste', '--escutar', `127.0.0.1:${PORTA}`, '--origem', ORIGEM_DE_CIMA, '--dados', dados], {
        stdio: ['ignore', log, log],
      });
    } finally {
      closeSync(log);
    }
    await esperarNoAr(parar.filho);
  } catch (e) {
    await limpar();
    throw e;
  }
  return limpar;
}
