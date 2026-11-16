// A segurança do servidor de vídeo de ponta a ponta (spec 9): a senha de uso único, o SIP por TLS do app (etapa 2),
// a origem do /sip e os registros dos três servidores.
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { connect, type TLSSocket } from 'node:tls';
import { A, B, MOSAICO_1, Navegador, VERMELHO } from './midia';
import { AGENTE, ipDaMaquina, NOMES, novaReuniaoDeTeste, PAGINA, registros, segredosUsados } from './servidores';

test('a senha não vale duas vezes nem sem o cabeçalho', async () => {
  const codigo = await novaReuniaoDeTeste();
  const a = await Navegador.abrir(A);
  const b = await Navegador.abrir(B);
  try {
    // Sem o X-Starsonic-Senha: o agente recusa na discagem.
    const agente = new URL(AGENTE);
    await b.ligar({ video: { wss: `ws://${agente.host}/sip`, uri: `sip:reuniao@${agente.hostname}` } });
    expect((await b.terminou(20_000))?.codigo).toBe(403);

    // A entra com a senha dele (sozinho, ele ocupa o quadro inteiro); depois, B liga com a mesma senha.
    await a.entrarPelaPagina(codigo, 'Carlos Lima');
    const aceito = await a.esperarMensagem('aceito');
    await a.esperarCores(MOSAICO_1, [VERMELHO]);
    await b.ligar({ senha: aceito.senha, video: aceito.video });
    expect((await b.terminou(20_000))?.codigo).toBe(403);
  } finally {
    await a.fechar();
    await b.fechar();
  }
});

// --- O SIP por TLS (o perfil tls, a 5061 do app) -------------------------------------------------------------------

/** Uma resposta SIP: a linha de status, o código e os cabeçalhos (os nomes em minúsculas). */
interface RespostaSip {
  status: number;
  linha: string;
  cabecalhos: Map<string, string>;
}

/** Uma conexão TLS que manda pedidos SIP e lê as respostas, linha por linha, até cada mensagem inteira. */
class SipPorTls {
  private texto = '';
  private acordar: (() => void) | null = null;
  private fechada = false;

  private constructor(readonly socket: TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => {
      this.texto += d;
      this.acordar?.();
    });
    socket.on('close', () => {
      this.fechada = true;
      this.acordar?.();
    });
  }

  /** M-10: o perfil tls escuta no IP da máquina, e o certificado de teste não é conferido (C-1). */
  static abrir(ip: string): Promise<SipPorTls> {
    return new Promise((ok, falha) => {
      const socket = connect({ host: ip, port: 5061, rejectUnauthorized: false }, () => ok(new SipPorTls(socket)));
      socket.once('error', falha);
    });
  }

  mandar(mensagem: string): void {
    this.socket.write(mensagem);
  }

  /** A próxima resposta inteira (os cabeçalhos e o corpo do Content-Length), em até prazo ms. */
  private async proxima(prazo: number): Promise<RespostaSip> {
    const fim = Date.now() + prazo;
    for (;;) {
      const separador = this.texto.indexOf('\r\n\r\n');
      if (separador >= 0) {
        const linhas = this.texto.slice(0, separador).split('\r\n');
        const cabecalhos = new Map<string, string>();
        for (const l of linhas.slice(1)) {
          const i = l.indexOf(':');
          if (i > 0) cabecalhos.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
        }
        const corpo = Number(cabecalhos.get('content-length') ?? cabecalhos.get('l') ?? '0');
        if (this.texto.length >= separador + 4 + corpo) {
          this.texto = this.texto.slice(separador + 4 + corpo);
          const status = /^SIP\/2\.0 (\d{3}) /.exec(linhas[0]);
          if (status) return { status: Number(status[1]), linha: linhas[0], cabecalhos };
          continue; // um pedido do outro lado: não é a resposta
        }
      }
      if (this.fechada) throw new Error('a conexão TLS fechou antes da resposta');
      const falta = fim - Date.now();
      if (falta <= 0) throw new Error('sem resposta SIP no prazo');
      await new Promise<void>((r) => {
        const t = setTimeout(r, falta);
        this.acordar = () => {
          clearTimeout(t);
          r();
        };
      });
      this.acordar = null;
    }
  }

  /** A resposta final, depois de qualquer 1xx (o 100 Trying). */
  async final(prazo = 10_000): Promise<RespostaSip> {
    const fim = Date.now() + prazo;
    for (;;) {
      const r = await this.proxima(fim - Date.now());
      if (r.status >= 200) return r;
    }
  }

  fechar(): void {
    this.socket.destroy();
  }
}

test('o SIP por TLS na 5061 responde ao OPTIONS e recusa o INVITE sem senha', async () => {
  const ip = ipDaMaquina();
  const sip = await SipPorTls.abrir(ip);
  try {
    const local = `${sip.socket.localAddress}:${sip.socket.localPort}`;
    const destino = `sip:reuniao@${ip}:5061;transport=tls`;
    const hex = (n: number) => randomBytes(n).toString('hex');
    const cabecalhosDe = (metodo: string, ramo: string, chamada: string, etiqueta: string) => [
      `Via: SIP/2.0/TLS ${local};branch=z9hG4bK${ramo};rport`,
      'Max-Forwards: 70',
      `From: <sip:pagina@${ip}>;tag=${etiqueta}`,
      `To: <sip:reuniao@${ip}>`,
      `Call-ID: ${chamada}`,
      `CSeq: 1 ${metodo}`,
      `Contact: <sip:pagina@${local};transport=tls>`,
    ];

    // O OPTIONS: o perfil está no ar e responde.
    sip.mandar(
      [`OPTIONS ${destino} SIP/2.0`, ...cabecalhosDe('OPTIONS', hex(8), hex(12), hex(6)), 'Accept: application/sdp',
        'Content-Length: 0', '', ''].join('\r\n'),
    );
    const opcoes = await sip.final();
    expect(opcoes.linha).toMatch(/^SIP\/2\.0 200 /);

    // O INVITE do app sem a senha: um som PCMU em SRTP (RTP/SAVP, com a=crypto), como a etapa 2 manda. O agente
    // recusa na discagem: 403.
    const chave = randomBytes(30).toString('base64');
    const sdp = [
      'v=0',
      `o=pagina 1 1 IN IP4 ${sip.socket.localAddress}`,
      's=-',
      `c=IN IP4 ${sip.socket.localAddress}`,
      't=0 0',
      'm=audio 40000 RTP/SAVP 0',
      'a=rtpmap:0 PCMU/8000',
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${chave}`,
      'a=sendrecv',
      '',
    ].join('\r\n');
    const ramo = hex(8);
    const chamada = hex(12);
    const etiqueta = hex(6);
    sip.mandar(
      [`INVITE ${destino} SIP/2.0`, ...cabecalhosDe('INVITE', ramo, chamada, etiqueta), 'Content-Type: application/sdp',
        `Content-Length: ${Buffer.byteLength(sdp)}`, '', sdp].join('\r\n'),
    );
    const convite = await sip.final();
    expect(convite.linha).toMatch(/^SIP\/2\.0 403 /);

    // O ACK da resposta final, para a transação acabar.
    sip.mandar(
      [`ACK ${destino} SIP/2.0`, `Via: SIP/2.0/TLS ${local};branch=z9hG4bK${ramo};rport`, 'Max-Forwards: 70',
        `From: <sip:pagina@${ip}>;tag=${etiqueta}`, `To: ${convite.cabecalhos.get('to') ?? `<sip:reuniao@${ip}>`}`,
        `Call-ID: ${chamada}`, 'CSeq: 1 ACK', 'Content-Length: 0', '', ''].join('\r\n'),
    );
  } finally {
    sip.fechar();
  }
});

// --- A origem do /sip ----------------------------------------------------------------------------------------------

/** M-11: o aperto de mão do WebSocket ao /sip, pelo node:http (o fetch não manda o Upgrade), com a origem dada. */
function abrirSip(origem: string): Promise<number> {
  const agente = new URL(AGENTE);
  return new Promise((ok, falha) => {
    const pedido = request({
      host: agente.hostname,
      port: Number(agente.port),
      path: '/sip',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Protocol': 'sip',
        Origin: origem,
      },
    });
    pedido.setTimeout(10_000, () => pedido.destroy(new Error('o /sip não respondeu em 10 s')));
    pedido.on('upgrade', (resposta, socket) => {
      socket.destroy();
      ok(resposta.statusCode ?? 0);
    });
    pedido.on('response', (resposta) => {
      resposta.resume();
      ok(resposta.statusCode ?? 0);
    });
    pedido.on('error', falha);
    pedido.end();
  });
}

test('o WebSocket do navegador recusa outra origem', async () => {
  expect(await abrirSip('https://mal.example')).toBe(403);
  expect(await abrirSip(PAGINA)).toBe(101);
});

// --- Os registros ---------------------------------------------------------------------------------------------------

// O último: confere as saídas do FreeSWITCH, do agente e do chat depois de todos os outros testes.
test('os registros não têm nomes, códigos nem senhas', async () => {
  const usados = segredosUsados();
  expect(usados.codigos.length, 'os testes anotaram os códigos das reuniões').toBeGreaterThan(0);
  expect(usados.senhas.length, 'os testes anotaram as senhas').toBeGreaterThan(0);
  expect(usados.salas.length, 'os testes anotaram as salas').toBeGreaterThan(0);
  const proibidos: Array<[string, string[]]> = [
    ['um nome', NOMES],
    ['um código de reunião', usados.codigos],
    ['uma sala', usados.salas],
    ['um participante', usados.participantes],
    ['uma senha', usados.senhas],
  ];
  for (const { nome, texto } of registros()) {
    expect(texto.length, `a saída do ${nome} não está vazia`).toBeGreaterThan(0);
    const linhas = texto.split('\n');
    for (const [rotulo, valores] of proibidos) {
      for (const valor of valores) {
        const n = linhas.findIndex((l) => l.includes(valor));
        expect(n, `a saída do ${nome} tem ${rotulo} na linha ${n + 1}`).toBe(-1);
      }
    }
    // Toda senha de uso único começa pela carga {"v":1, em base64url: nenhuma, nem as que os testes não viram.
    const senha = linhas.findIndex((l) => l.includes('eyJ2IjoxL'));
    expect(senha, `a saída do ${nome} tem uma senha na linha ${senha + 1}`).toBe(-1);
  }
});
