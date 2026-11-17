// O globalSetup: sobe o FreeSWITCH do nosso build, o agente de vídeo, o chat e o servidor do cliente mínimo, e prepara
// o chat (o administrador de teste, o cartão "Reuniões", a empresa ACME e o computador da Ana). A volta desliga tudo e
// confere que as saídas dos servidores não têm nenhum segredo.
//
// O FreeSWITCH vem do STARSONIC_FREESWITCH_DIR (o padrão é /opt/starsonic-freeswitch, onde o pacote do construir.sh
// se instala), e os programas, do STARSONIC_VIDEO_BIN e do STARSONIC_CHAT_BIN (o CI compila antes); sem eles, este
// arquivo os compila, como o windows/ui/tests/chat/global-setup.ts. A saída de cada servidor vai para um arquivo de
// test-results/, e o que não pode sair num artefato (a chave, a senha do ESL, os dados do chat) fica em
// test-results/privado/.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { gerarMidia } from './midia';
import { AGENTE, CHAT, PAGINA, prepararChat, PRIVADO, RAIZ, REGISTROS, SAIDA, segredosNosRegistros } from './servidores';

const VIDEO_SERVIDOR = join(RAIZ, '..');
const CHAT_SERVIDOR = join(RAIZ, '..', '..', 'chat-servidor');

/** O primeiro IPv4 da máquina que não é de loopback nem de uma ponte do Docker: o IP privado e o público do teste. */
function ipv4DaMaquina(): string {
  for (const [nome, enderecos] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth)/.test(nome)) continue;
    for (const e of enderecos ?? []) {
      if (e.family === 'IPv4' && !e.internal) return e.address;
    }
  }
  throw new Error('esta máquina não tem um IPv4 que não é de loopback');
}

/** O programa do servidor: o da variável, ou compilado aqui (sem o cgo, como os builds de publicação). */
function programa(variavel: string, pasta: string, pacote: string, nome: string): string {
  const pronto = process.env[variavel];
  if (pronto) return pronto;
  const bin = join(PRIVADO, nome);
  const semProxy = 'localhost,127.0.0.1'; // o proxy do ambiente não alcança os servidores locais
  const r = spawnSync('go', ['build', '-o', bin, pacote], {
    cwd: pasta,
    stdio: 'inherit',
    env: { ...process.env, NO_PROXY: semProxy, no_proxy: semProxy, CGO_ENABLED: '0' },
  });
  if (r.status !== 0) throw new Error(`o go build do ${nome} falhou`);
  return bin;
}

/** Confere que a porta está livre: um servidor de um teste anterior que ficou no ar faria tudo falhar mais adiante. */
function portaLivre(host: string, porta: number): Promise<void> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', () => falha(new Error(`a porta ${host}:${porta} está ocupada (um teste anterior ficou no ar?)`)));
    s.listen(porta, host, () => s.close(() => ok()));
  });
}

/** Sobe o programa com a saída (a padrão e a de erros) no arquivo. */
function subir(comando: string, args: string[], registro: string): ChildProcess {
  const log = openSync(registro, 'w');
  try {
    return spawn(comando, args, { stdio: ['ignore', log, log] });
  } finally {
    closeSync(log);
  }
}

interface Servidor {
  nome: string;
  filho: ChildProcess;
  registro: string;
}

/** Espera a condição, até prazo ms. Um servidor que sai antes disso é o erro. */
async function esperarAte(descricao: string, prazo: number, servidores: Servidor[], condicao: () => Promise<boolean>): Promise<void> {
  const fim = Date.now() + prazo;
  for (;;) {
    for (const s of servidores) {
      if (s.filho.exitCode !== null || s.filho.signalCode !== null) {
        throw new Error(`o ${s.nome} saiu (${s.filho.exitCode ?? s.filho.signalCode}); veja ${s.registro}`);
      }
    }
    try {
      if (await condicao()) return;
    } catch {
      // ainda não responde
    }
    if (Date.now() > fim) throw new Error(`${descricao}: nada em ${prazo / 1000} s`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A porta TCP aceita uma conexão. */
function aceita(host: string, porta: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createConnection({ host, port: porta });
    s.once('connect', () => {
      s.destroy();
      ok(true);
    });
    s.once('error', () => ok(false));
  });
}

/** Para o servidor: o SIGTERM e, se ele não sair em prazo ms, o SIGKILL. */
async function parar(s: Servidor, prazo: number): Promise<void> {
  const { filho } = s;
  if (filho.exitCode !== null || filho.signalCode !== null) return;
  const saiu = new Promise<void>((r) => filho.once('exit', () => r()));
  filho.kill('SIGTERM');
  const forca = setTimeout(() => filho.kill('SIGKILL'), prazo);
  await saiu;
  clearTimeout(forca);
}

export default async function ambiente(): Promise<() => Promise<void>> {
  const pastaFS = process.env.STARSONIC_FREESWITCH_DIR || '/opt/starsonic-freeswitch';
  const freeswitch = join(pastaFS, 'bin', 'freeswitch');
  if (!existsSync(freeswitch)) {
    throw new Error(`falta o FreeSWITCH em ${pastaFS} (instale o pacote do construir.sh ou dê o STARSONIC_FREESWITCH_DIR)`);
  }

  rmSync(PRIVADO, { recursive: true, force: true });
  mkdirSync(PRIVADO, { recursive: true, mode: 0o700 });
  for (const r of Object.values(REGISTROS)) rmSync(r, { force: true });
  gerarMidia();

  const ip = ipv4DaMaquina();
  process.env.STARSONIC_E2E_IP = ip;
  for (const [host, porta] of [
    ['127.0.0.1', Number(new URL(PAGINA).port)], // o cliente
    ['127.0.0.1', 4191], // o chat
    ['127.0.0.1', 8095], // o agente
    ['127.0.0.1', 8091], // a discagem do agente
    ['127.0.0.1', 8021], // o ESL
    ['127.0.0.1', 5066], // o WebSocket do perfil navegador
    ['127.0.0.1', 5070], // o SIP do perfil navegador
    [ip, 5061], // o SIP por TLS do perfil tls
    [ip, 5080],
  ] as const) {
    await portaLivre(host, porta);
  }

  const video = programa('STARSONIC_VIDEO_BIN', VIDEO_SERVIDOR, './cmd/starsonic-video', 'starsonic-video');
  const chat = programa('STARSONIC_CHAT_BIN', CHAT_SERVIDOR, './cmd/starsonic-chat', 'starsonic-chat');

  // A configuração de teste do agente: o IP da máquina é o privado e o público, e a senha do ESL é sorteada.
  const chave = spawnSync(video, ['chave'], { encoding: 'utf8' }).stdout.trim();
  const config = join(PRIVADO, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      endereco: 'video.exemplo.com.br',
      chat: 'chat.exemplo.com.br',
      chave,
      senhaEsl: randomBytes(24).toString('hex'),
      ipPrivado: ip,
      ipPublico: ip,
    }),
    { mode: 0o600 },
  );
  const etc = join(PRIVADO, 'etc');
  const configurar = spawnSync(video, ['configurar', '--config', config, '--saida', etc, '--teste'], { encoding: 'utf8' });
  if (configurar.status !== 0) throw new Error(`o configurar --teste falhou: ${configurar.stderr}`);

  const servidores: Servidor[] = [];
  const pararTudo = async () => {
    for (const s of [...servidores].reverse()) await parar(s, 20_000);
  };
  try {
    // O FreeSWITCH, com as pastas da unidade do systemd (as que ele escreve juntas, numa pasta que some). O stdbuf
    // deixa a saída linha por linha: o console do FreeSWITCH não esvazia o buffer, e o teste dos registros a lê
    // com ele no ar.
    const conf = join(etc, 'freeswitch');
    const run = join(PRIVADO, 'run');
    mkdirSync(run);
    servidores.push({
      nome: 'FreeSWITCH',
      registro: REGISTROS.freeswitch,
      filho: subir(
        'stdbuf',
        ['-oL', '-eL', freeswitch, '-c', '-nonat', '-conf', conf, '-log', run, '-db', run, '-run', run, '-temp', run,
          '-certs', join(conf, 'tls')],
        REGISTROS.freeswitch,
      ),
    });
    await esperarAte('o FreeSWITCH (o perfil tls na 5061 e o WebSocket do navegador)', 60_000, servidores, async () =>
      (await aceita(ip, 5061)) && (await aceita('127.0.0.1', 5066)),
    );

    servidores.push({
      nome: 'agente',
      registro: REGISTROS.agente,
      filho: subir(video, ['servir', '--teste', '--escutar', '127.0.0.1:8095', '--config', config, '--origem', PAGINA],
        REGISTROS.agente),
    });
    await esperarAte('o agente ligado ao FreeSWITCH', 60_000, servidores, async () => {
      const r = await fetch(`${AGENTE}/agente/v1/estado`, { headers: { authorization: `Bearer ${chave}` } });
      return r.status === 200 && (await r.json()).freeswitch === true;
    });

    // O chat, com o administrador de teste (uma senha sorteada a cada rodada, que só vai para os testes).
    const dados = join(PRIVADO, 'chat');
    mkdirSync(dados);
    const senha = randomBytes(18).toString('base64url');
    const criar = spawnSync(chat, ['admin-criar', 'teste', '--dados', dados], { input: `${senha}\n${senha}\n`, encoding: 'utf8' });
    if (criar.status !== 0) throw new Error(`o admin-criar falhou: ${criar.stdout}`.replaceAll(senha, '***'));
    process.env.CHAT_ADMIN_SENHA = senha;
    servidores.push({
      nome: 'chat',
      registro: REGISTROS.chat,
      filho: subir(chat, ['servir', '--teste', '--escutar', '127.0.0.1:4191', '--dados', dados, '--origem', PAGINA],
        REGISTROS.chat),
    });
    await esperarAte('o chat', 30_000, servidores, async () => (await fetch(`${CHAT}/admin/entrar`)).status === 200);

    servidores.push({
      nome: 'servidor do cliente',
      registro: REGISTROS.estatico,
      filho: subir(process.execPath, [join(RAIZ, 'estatico.mjs'), new URL(PAGINA).port], REGISTROS.estatico),
    });
    await esperarAte('o servidor do cliente', 30_000, servidores, async () => (await fetch(`${PAGINA}/`)).status === 200);

    process.env.STARSONIC_E2E_ANA = await prepararChat(chave);
  } catch (e) {
    await pararTudo();
    throw e;
  }
  console.log(`ambiente no ar: o FreeSWITCH em ${ip}, as saídas em ${SAIDA}`);
  // A volta: desliga tudo e confere as saídas inteiras, com as linhas do desligamento, que o teste dos registros não
  // vê. Um segredo nelas falha a rodada.
  return async () => {
    await pararTudo();
    const achados = segredosNosRegistros();
    if (achados.length > 0) throw new Error(`as saídas dos servidores têm o que não podiam ter: ${achados.join('; ')}`);
  };
}
