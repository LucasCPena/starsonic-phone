// O que os testes da página (telas.spec.ts e tela.spec.ts) usam além da rede falsa: o relógio e a reunião dos testes,
// o servidor de vídeo falso do outro lado do JsSIP (o INVITE, o 200 com uma resposta de verdade, as direções do SDP e
// os cabeçalhos SIP) e o contador do clique, que prova que uma chamada saiu dentro do próprio clique.
import { expect, type Page } from '@playwright/test';
import type { Reuniao, VideoFalso } from './rede-falsa';

/** Hoje, 17/11/2026, às 10:00 em São Paulo (o fuso dos testes). */
export const AGORA = new Date('2026-11-17T10:00:00-03:00').getTime();

export const MARCADA: Reuniao = {
  tipo: 'marcada',
  assunto: 'Planejamento de dezembro',
  inicio: new Date('2026-11-17T14:00:00-03:00').getTime(),
};

/**
 * Cada RTCPeerConnection que a página cria (window.conexoes), na ordem, com a configuração dele
 * (window.configuracoes). A classe original fica em window.ConexaoDoTeste, para o lado do servidor que o teste faz (o
 * atenderOInvite).
 */
export async function registrarConexoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      conexoes: RTCPeerConnection[];
      configuracoes: unknown[];
      ConexaoDoTeste: typeof RTCPeerConnection;
    };
    w.conexoes = [];
    w.configuracoes = [];
    const Original = window.RTCPeerConnection;
    w.ConexaoDoTeste = Original;
    window.RTCPeerConnection = class extends Original {
      constructor(...args: unknown[]) {
        super(...(args as [RTCConfiguration])); // o JsSIP passa também as restrições antigas, como segundo argumento
        w.conexoes.push(this);
        w.configuracoes.push(args[0]);
      }
    };
  });
}

/** Um cabeçalho de uma mensagem SIP, sem o nome. */
export const cabecalhoSip = (mensagem: string, nome: string) =>
  mensagem
    .split('\r\n\r\n')[0]
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${nome.toLowerCase()}:`))
    ?.slice(nome.length + 1)
    .trim();

/** A direção de cada m= do SDP de uma mensagem SIP, como {audio: 'sendrecv', video: 'recvonly'}. */
export function direcoes(mensagem: string): Record<string, string> {
  const r: Record<string, string> = {};
  let tipo = '';
  for (const linha of mensagem.split('\r\n\r\n').slice(1).join('\r\n\r\n').split(/\r?\n/)) {
    tipo = /^m=(\w+) /.exec(linha)?.[1] ?? tipo;
    const direcao = /^a=(sendrecv|sendonly|recvonly|inactive)$/.exec(linha)?.[1];
    if (direcao && tipo) r[tipo] = direcao;
  }
  return r;
}

/**
 * O INVITE da ligação n da página (1, a primeira; na tela compartilhada, 2 é a primeira tela). A coleta dos candidatos
 * tem um prazo, contado do primeiro candidato, e o TURN do teste nunca responde: com a conexão da ligação criada (o
 * WSS abriu), o relógio anda até o INVITE sair. Pede o registrarConexoes.
 */
export async function inviteDe(page: Page, video: VideoFalso, n = 1): Promise<string> {
  const conexoes = () => page.evaluate(() => (window as unknown as { conexoes: unknown[] }).conexoes.length);
  await expect.poll(conexoes).toBeGreaterThanOrEqual(n);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return video.recebidas.some((m) => m.startsWith('INVITE '));
      },
      { message: `a página não mandou o INVITE da ligação ${n}`, timeout: 20_000 },
    )
    .toBe(true);
  return video.mensagem('INVITE');
}

/**
 * O servidor atende o INVITE: o 200 com a resposta de outra conexão da página (a do teste, a ConexaoDoTeste) à oferta
 * dele. O JsSIP manda o ACK e confirma a ligação, como com o servidor de vídeo. Pede o registrarConexoes.
 */
export async function atenderOInvite(page: Page, video: VideoFalso, invite: string): Promise<void> {
  const [cabecalho, ...corpo] = invite.split('\r\n\r\n');
  const resposta = await page.evaluate(async (oferta) => {
    const pc = new (window as unknown as { ConexaoDoTeste: typeof RTCPeerConnection }).ConexaoDoTeste();
    await pc.setRemoteDescription({ type: 'offer', sdp: oferta });
    await pc.setLocalDescription(await pc.createAnswer());
    return pc.localDescription?.sdp ?? '';
  }, corpo.join('\r\n\r\n'));
  const linhas = cabecalho.split('\r\n').slice(1);
  const os = (nome: string) => linhas.filter((l) => l.toLowerCase().startsWith(`${nome.toLowerCase()}:`));
  video.mandar(
    [
      'SIP/2.0 200 OK',
      ...os('Via'),
      ...os('From'),
      `${os('To')[0]};tag=servidor-1`,
      ...os('Call-ID'),
      ...os('CSeq'),
      'Contact: <sip:reuniao@video.exemplo.com.br;transport=ws>',
      'Content-Type: application/sdp',
      `Content-Length: ${new TextEncoder().encode(resposta).length}`,
      '',
      resposta,
    ].join('\r\n'),
  );
}

/**
 * Antes da página: o contador do clique. Cada manipulador de click que a página registra (o addEventListener) roda
 * entre um "entrou" e um "saiu" síncronos, e o window.ondeEstaOClique() diz "no clique" só enquanto um deles roda.
 * Uma chamada que espera qualquer coisa antes (até um await de uma promessa já resolvida) sai numa microtarefa, depois
 * do manipulador, e o contador a vê "fora do clique": o window.event não serve, porque ainda é o click nas
 * microtarefas do clique. Os registros dos testes (do play(), do getDisplayMedia, do resume()) o leem na hora da
 * chamada. O removeEventListener de um click não acharia o manipulador embrulhado: a página não o usa.
 */
export async function contarOClique(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { profundidadeDoClique?: number; ondeEstaOClique: () => string };
    if (w.profundidadeDoClique !== undefined) return; // já contado
    w.profundidadeDoClique = 0;
    w.ondeEstaOClique = () => ((w.profundidadeDoClique ?? 0) > 0 ? 'no clique' : 'fora do clique');
    const registrar = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      tipo: string,
      ouvinte: EventListenerOrEventListenerObject | null,
      opcoes?: boolean | AddEventListenerOptions,
    ) {
      if (tipo !== 'click' || !ouvinte) return registrar.call(this, tipo, ouvinte, opcoes);
      const noClique = function (this: unknown, ev: Event) {
        w.profundidadeDoClique = (w.profundidadeDoClique ?? 0) + 1;
        try {
          return typeof ouvinte === 'function' ? ouvinte.call(this, ev) : ouvinte.handleEvent(ev);
        } finally {
          w.profundidadeDoClique = (w.profundidadeDoClique ?? 1) - 1;
        }
      };
      return registrar.call(this, tipo, noClique, opcoes);
    };
  });
}
