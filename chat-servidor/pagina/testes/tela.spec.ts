// A tela compartilhada pela página (o desenho, item 4), no Chromium: a página de verdade, servida pelo chat no modo de
// teste, com a rede falsa (o abrir, o canal e o WSS do vídeo) e o relógio parado. As duas ligações são as do JsSIP de
// verdade, e o servidor falso as atende (o 200 com a resposta de outra conexão da página). A tela que a pessoa
// escolheria é um canvas: o getDisplayMedia falso.
//
// Os ajudantes da rede e das ligações repetem os de telas.spec.ts: a divisão dele em módulos ficou para depois (a M7 da
// revisão da Task 6), e estes testes ficam num arquivo deles.
import { expect, test, type Page } from '@playwright/test';
import { CODIGO, RedeFalsa, type Canal, type Mensagem, type Reuniao, type VideoFalso } from '../rede-falsa';

/** Hoje, 17/11/2026, às 10:00 em São Paulo (o fuso dos testes). */
const AGORA = new Date('2026-11-17T10:00:00-03:00').getTime();

const MARCADA: Reuniao = {
  tipo: 'marcada',
  assunto: 'Planejamento de dezembro',
  inicio: new Date('2026-11-17T14:00:00-03:00').getTime(),
};

/** O aceito, com um Acesso inventado e o TURN neste computador, numa porta fechada: as ligações não saem à rede. */
const ACEITO: Mensagem = {
  tipo: 'aceito',
  participante: 'participante-1',
  senha: 'senha-1',
  turn: {
    urls: ['turn:127.0.0.1:9?transport=udp', 'turns:127.0.0.1:9?transport=tcp'],
    usuario: 'usuario-1',
    senha: 'credencial-1',
  },
  video: { wss: 'wss://video.exemplo.com.br:7443/sip', uri: 'sip:reuniao@video.exemplo.com.br' },
  volta: 'volta-1',
};

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 1, name: nome, exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const controles = (page: Page) => page.getByRole('navigation', { name: 'Controles da reunião' });
const selo = (page: Page) => page.getByText('Você está compartilhando a tela', { exact: true });
/** O método de uma mensagem SIP (INVITE, ACK, BYE…). */
const metodo = (mensagem: string) => mensagem.split(' ', 1)[0];

interface CapturaFalsa {
  /** A resposta do getDisplayMedia só sai no window.soltarATela(). */
  segurada?: boolean;
  /** O erro com que o getDisplayMedia recusa (a escolha cancelada é o NotAllowedError). */
  recusa?: string;
  /** A captura chega com a faixa já acabada (a tela escolhida fechou antes da resposta). */
  acabada?: boolean;
}

/**
 * Antes da página: o getDisplayMedia dá um canvas, a tela que a pessoa escolheria. O window.registro guarda, na ordem,
 * cada chamada dele e cada AudioContext criado e cada resume(), com o evento que o navegador despachava naquela hora
 * (window.event), ou "-" fora de um evento. As restrições de cada chamada ficam em window.restricoes, a faixa de cada
 * captura em window.faixasDaTela, e os contextos do som em window.contextos.
 */
async function capturaFalsa(page: Page, opcoes: CapturaFalsa = {}): Promise<void> {
  await page.addInitScript((opcoes) => {
    const w = window as unknown as {
      registro: string[];
      restricoes: unknown[];
      faixasDaTela: MediaStreamTrack[];
      contextos: AudioContext[];
      soltarATela?: () => void;
    };
    w.registro = [];
    w.restricoes = [];
    w.faixasDaTela = [];
    w.contextos = [];
    const evento = () => window.event?.type ?? '-';
    const Contexto = window.AudioContext;
    const acordar = Contexto.prototype.resume;
    Contexto.prototype.resume = function (this: AudioContext) {
      w.registro.push(`resume ${evento()}`);
      return acordar.call(this);
    };
    window.AudioContext = class extends Contexto {
      constructor(...args: unknown[]) {
        super(...(args as [AudioContextOptions]));
        w.registro.push(`novo ${evento()}`);
        w.contextos.push(this);
      }
    };
    navigator.mediaDevices.getDisplayMedia = async (restricoes?: DisplayMediaStreamOptions) => {
      w.registro.push(`getDisplayMedia ${evento()}`);
      w.restricoes.push(restricoes);
      if (opcoes.segurada) {
        await new Promise<void>((r) => {
          w.soltarATela = r;
        });
      }
      if (opcoes.recusa) throw new DOMException('o erro do teste', opcoes.recusa);
      const quadro = document.createElement('canvas');
      quadro.width = 640;
      quadro.height = 360;
      quadro.getContext('2d')?.fillRect(0, 0, quadro.width, quadro.height);
      const fluxo = quadro.captureStream(15);
      w.faixasDaTela.push(...fluxo.getVideoTracks());
      if (opcoes.acabada) for (const faixa of fluxo.getTracks()) faixa.stop();
      return fluxo;
    };
  }, opcoes);
}

const registro = (page: Page) => page.evaluate(() => (window as unknown as { registro: string[] }).registro);
const restricoes = (page: Page) => page.evaluate(() => (window as unknown as { restricoes: unknown[] }).restricoes);
/** O readyState da faixa de cada captura, na ordem. */
const faixasDaTela = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { faixasDaTela: MediaStreamTrack[] }).faixasDaTela.map((t) => t.readyState),
  );
const soltarATela = (page: Page) =>
  page.evaluate(() => (window as unknown as { soltarATela: () => void }).soltarATela());

/**
 * O "Parar de compartilhar" do próprio navegador, na captura i: a faixa acaba, e ele dispara o ended (o stop() da
 * página não o dispara). Com parar falso, só o ended, numa faixa que já acabou.
 */
const oNavegadorPara = (page: Page, i: number, parar = true) =>
  page.evaluate(
    ([i, parar]) => {
      const faixa = (window as unknown as { faixasDaTela: MediaStreamTrack[] }).faixasDaTela[i];
      if (parar) faixa.stop();
      faixa.dispatchEvent(new Event('ended'));
    },
    [i, parar] as const,
  );

/**
 * Cada RTCPeerConnection que a página cria (window.conexoes), na ordem: a principal, e depois as da tela. A classe
 * original fica em window.ConexaoDoTeste, para o lado do servidor que o teste faz (o atender).
 */
async function registrarConexoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { conexoes: RTCPeerConnection[]; ConexaoDoTeste: typeof RTCPeerConnection };
    w.conexoes = [];
    const Original = window.RTCPeerConnection;
    w.ConexaoDoTeste = Original;
    window.RTCPeerConnection = class extends Original {
      constructor(...args: unknown[]) {
        super(...(args as [RTCConfiguration])); // o JsSIP passa também as restrições antigas, como segundo argumento
        w.conexoes.push(this);
      }
    };
  });
}

/** Um cabeçalho de uma mensagem SIP, sem o nome. */
const cabecalhoSip = (mensagem: string, nome: string) =>
  mensagem
    .split('\r\n\r\n')[0]
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${nome.toLowerCase()}:`))
    ?.slice(nome.length + 1)
    .trim();

/** A direção de cada m= do SDP de uma mensagem SIP, como {audio: 'sendrecv', video: 'recvonly'}. */
function direcoes(mensagem: string): Record<string, string> {
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
 * O INVITE da ligação n (1, a principal; 2, a primeira tela). A coleta dos candidatos tem um prazo, contado do primeiro
 * candidato, e o TURN do teste nunca responde: com a conexão da ligação criada, o relógio anda até o INVITE sair.
 */
async function inviteDe(page: Page, video: VideoFalso, n: number): Promise<string> {
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
 * O servidor atende o INVITE: o 200 com a resposta de outra conexão da página (a do teste) à oferta dele. O JsSIP manda
 * o ACK e confirma a ligação, como com o servidor de vídeo.
 */
async function atender(page: Page, video: VideoFalso, invite: string): Promise<void> {
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

interface NaReuniao {
  rede: RedeFalsa;
  canal: Canal;
  /** O WSS da ligação principal. */
  principal: VideoFalso;
}

/** A página na reunião: o aceito, a ligação principal atendida pelo servidor falso, e os controles da reunião. */
async function naReuniao(page: Page): Promise<NaReuniao> {
  await registrarConexoes(page);
  // O relógio parado e a rede falsa antes de a página abrir (a regra do clock na 1.56.1).
  await page.clock.install({ time: AGORA - 1000 });
  await page.clock.pauseAt(AGORA);
  const rede = await RedeFalsa.instalar(page, MARCADA);
  rede.videosAbrem = true;
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await page.goto(`/r/${CODIGO}`);
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  await botao(page, 'Pedir para entrar').click();
  const principal = await rede.videoNumero(1);
  await atender(page, principal, await inviteDe(page, principal, 1));
  await expect(controles(page)).toBeVisible();
  return { rede, canal: await rede.canalNumero(1), principal };
}

/**
 * O clique no Compartilhar a tela e a senha da tela, que o servidor dá pelo canal: a ligação da tela, a n-ésima da
 * página, liga. Devolve o WSS dela e o INVITE.
 */
async function compartilhar(
  page: Page,
  { rede, canal }: NaReuniao,
  n: number,
  senha = 'senha-tela',
): Promise<{ video: VideoFalso; invite: string }> {
  const pedidos = () => canal.tipos().filter((t) => t === 'tela').length;
  const antes = pedidos();
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(pedidos, { message: 'a página não pediu a senha da tela' }).toBe(antes + 1);
  canal.mandar({ tipo: 'tela', senha });
  const video = await rede.videoNumero(n);
  return { video, invite: await inviteDe(page, video, n) };
}

/**
 * A ligação principal e o fluxo da câmera e do microfone, como estão: as faixas que a principal manda, e as faixas do
 * fluxo das prévias (o que a principal usa), com o estado de cada uma.
 */
const comoEstaAPrincipal = (page: Page) =>
  page.evaluate(() => {
    const [pc] = (window as unknown as { conexoes: RTCPeerConnection[] }).conexoes;
    const fluxo = (document.querySelector('video.previa') as HTMLVideoElement).srcObject as MediaStream;
    const faixa = (t: MediaStreamTrack) => `${t.kind} ${t.id} ${t.readyState} ${t.enabled}`;
    return {
      manda: pc.getSenders().map((s) => (s.track ? faixa(s.track) : null)),
      fluxo: fluxo.getTracks().map(faixa),
    };
  });

/** O que a ligação da tela n (a segunda conexão da página, na primeira tela) manda: a imagem e o som. */
const oQueATelaManda = (page: Page, n = 2) =>
  page.evaluate((n) => {
    const w = window as unknown as { conexoes: RTCPeerConnection[]; faixasDaTela: MediaStreamTrack[] };
    const pc = w.conexoes[n - 1];
    const fluxo = (document.querySelector('video.previa') as HTMLVideoElement).srcObject as MediaStream;
    const de = (tipo: string) => pc.getSenders().filter((s) => s.track?.kind === tipo).map((s) => s.track!);
    const naPrincipal = w.conexoes[0].getSenders().map((s) => s.track);
    return {
      imagem: de('video').map((t) => (w.faixasDaTela.includes(t) ? `a captura ${t.readyState}` : 'outra')),
      som: de('audio').map((t) =>
        fluxo.getTracks().includes(t) || naPrincipal.includes(t) ? 'o microfone' : `outro som ${t.readyState}`,
      ),
    };
  }, n);

test('a captura nasce no clique, com o silêncio acordado', async ({ page }) => {
  await capturaFalsa(page);
  const { canal } = await naReuniao(page);
  // O contexto do silêncio, que nasceu no Pedir para entrar, parado de fora (o Safari faz isso com a página que ficou
  // para trás).
  await page.evaluate(() => (window as unknown as { contextos: AudioContext[] }).contextos[0].suspend());
  const antes = (await registro(page)).length;
  expect((await registro(page)).filter((l) => l.startsWith('getDisplayMedia '))).toEqual([]);

  await botao(page, 'Compartilhar a tela').click();

  // Dentro do clique (o window.event é ele), o silêncio acorda e a tela é pedida, antes de tudo o que é assíncrono: o
  // Safari e o Firefox só deixam pedir a tela dentro do gesto. Só a imagem, sem o som da tela.
  await expect.poll(async () => (await registro(page)).slice(antes)).toEqual(['resume click', 'getDisplayMedia click']);
  expect(await restricoes(page)).toEqual([{ video: true, audio: false }]);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { contextos: AudioContext[] }).contextos.map((c) => c.state)))
    .toEqual(['running']);
  // A captura vai ao cérebro, que pede a senha da tela pelo canal.
  await expect.poll(() => canal.recebidas.slice(1)).toEqual([{ tipo: 'tela' }]);
});

test('a ligação da tela só manda a captura e o silêncio, com a senha dela', async ({ page }) => {
  // Com o debug do JsSIP ligado no navegador (o localStorage de quem já o usou), o INVITE iria ao console.
  const doConsole: string[] = [];
  page.on('console', (m) => doConsole.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('debug', 'JsSIP:*'));
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);
  const antes = await comoEstaAPrincipal(page);

  const { video, invite } = await compartilhar(page, reuniao, 2);

  // Um UA só para ela, no WSS do Acesso, com o From neutro e a senha da tela; os dois só mandam.
  expect(video.url).toBe('wss://video.exemplo.com.br:7443/sip');
  expect(invite.split('\r\n')[0]).toBe('INVITE sip:reuniao@video.exemplo.com.br SIP/2.0');
  expect(cabecalhoSip(invite, 'From')).toMatch(/^"pagina" <sip:pagina@video\.exemplo\.com\.br>;tag=/);
  expect(cabecalhoSip(invite, 'X-Starsonic-Senha')).toBe('senha-tela');
  expect(direcoes(invite)).toEqual({ audio: 'sendonly', video: 'sendonly' });
  // A imagem é a da captura, e o som é o silêncio gerado, nunca o microfone.
  expect(await oQueATelaManda(page)).toEqual({ imagem: ['a captura live'], som: ['outro som live'] });
  // A principal, a câmera e o microfone ficam como estavam: nada de outra oferta, e o fluxo é o mesmo.
  expect(await comoEstaAPrincipal(page)).toEqual(antes);
  expect(reuniao.principal.recebidas.map(metodo)).toEqual(['INVITE', 'ACK']);
  // Nem a senha da tela nem as do aceito vão ao console.
  const segredos = ['senha-tela', 'senha-1', 'usuario-1', 'credencial-1', 'volta-1'];
  expect(doConsole.filter((l) => segredos.some((s) => l.includes(s)))).toEqual([]);
});

test('a tela no ar, e o Parar de compartilhar a desliga e para a captura', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);
  const antes = await comoEstaAPrincipal(page);
  const { video, invite } = await compartilhar(page, reuniao, 2);
  // Até a ligação da tela confirmar, o selo não aparece; o Parar de compartilhar já vale.
  await expect(selo(page)).toBeHidden();
  await expect(botao(page, 'Compartilhar a tela')).toBeHidden();
  await expect(botao(page, 'Parar de compartilhar')).toBeVisible();

  await atender(page, video, invite);
  await expect(selo(page)).toBeVisible();
  await expect(page.getByText('Nada é gravado', { exact: true })).toBeHidden();

  await botao(page, 'Parar de compartilhar').click();
  await video.mensagem('BYE');
  await expect(selo(page)).toBeHidden();
  await expect(page.getByText('Nada é gravado', { exact: true })).toBeVisible();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  expect(await faixasDaTela(page)).toEqual(['ended']);
  // A principal e o fluxo continuam como estavam.
  expect(await comoEstaAPrincipal(page)).toEqual(antes);
  expect(reuniao.principal.recebidas.map(metodo)).toEqual(['INVITE', 'ACK']);

  // A captura que a própria página parou não avisa nada: o ended dela, que viesse agora, não para a tela seguinte.
  const segunda = await compartilhar(page, reuniao, 3);
  await atender(page, segunda.video, segunda.invite);
  await expect(selo(page)).toBeVisible();
  await oNavegadorPara(page, 0, false);
  await expect(selo(page)).toBeVisible();
  expect(await faixasDaTela(page)).toEqual(['ended', 'live']);
});

test('a tela que o navegador para é um Parar de compartilhar, uma vez', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);
  const primeira = await compartilhar(page, reuniao, 2);
  await atender(page, primeira.video, primeira.invite);
  await expect(selo(page)).toBeVisible();

  await oNavegadorPara(page, 0);
  await primeira.video.mensagem('BYE');
  await expect(selo(page)).toBeHidden();
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  // O fim da captura não é o de um aparelho: o Microfone e a Câmera continuam ligados.
  for (const nome of ['Microfone', 'Câmera']) {
    await expect(botao(page, nome)).toBeEnabled();
    await expect(botao(page, nome)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('alert')).toBeHidden();

  // Outra tela. O ended que se repete na captura de antes não a para: ele vale uma vez.
  const segunda = await compartilhar(page, reuniao, 3);
  await atender(page, segunda.video, segunda.invite);
  await expect(selo(page)).toBeVisible();
  await oNavegadorPara(page, 0, false);
  await expect(selo(page)).toBeVisible();
  expect(await faixasDaTela(page)).toEqual(['ended', 'live']);
});

test('o Parar de compartilhar vale antes de a tela ficar no ar', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);

  // Antes da senha da tela: a captura para, e a senha que chega depois não liga nada.
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => reuniao.canal.tipos()).toEqual(['pedir', 'tela']);
  await botao(page, 'Parar de compartilhar').click();
  await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  reuniao.canal.mandar({ tipo: 'tela', senha: 'senha-velha' });

  // Com a ligação da tela ainda nascendo (o INVITE saiu, sem resposta): ela desce, e a captura para.
  const { video, invite } = await compartilhar(page, reuniao, 2, 'senha-nova');
  expect(cabecalhoSip(invite, 'X-Starsonic-Senha')).toBe('senha-nova');
  expect(reuniao.rede.videos).toHaveLength(2);
  await botao(page, 'Parar de compartilhar').click();
  await expect.poll(() => faixasDaTela(page)).toEqual(['ended', 'ended']);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  // O 200 que chegasse agora não põe a tela no ar.
  await atender(page, video, invite);
  await page.clock.runFor(10);
  await expect(selo(page)).toBeHidden();
});

test('a escolha da tela cancelada não faz nada', async ({ page }) => {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(e.message));
  await capturaFalsa(page, { recusa: 'NotAllowedError' });
  const { canal } = await naReuniao(page);

  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(1);
  await page.clock.runFor(10);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  expect(canal.tipos()).toEqual(['pedir']);
  expect(erros).toEqual([]);
  // A pessoa pode escolher de novo.
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(2);
});

test('a captura que já chega acabada não serve', async ({ page }) => {
  await capturaFalsa(page, { acabada: true });
  const { canal } = await naReuniao(page);
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(1);
  await page.clock.runFor(10);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  expect(canal.tipos()).toEqual(['pedir']);
  expect(await faixasDaTela(page)).toEqual(['ended']);
});

test('um pedido da tela de cada vez', async ({ page }) => {
  await capturaFalsa(page, { segurada: true });
  const reuniao = await naReuniao(page);
  // Com a escolha da tela ainda aberta, o Compartilhar a tela continua valendo, e o segundo clique não pede outra.
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(1);
  await botao(page, 'Compartilhar a tela').click();
  await soltarATela(page);
  await expect.poll(() => reuniao.canal.tipos()).toEqual(['pedir', 'tela']);
  expect(await restricoes(page)).toHaveLength(1);
  expect(await faixasDaTela(page)).toEqual(['live']);

  // A captura que veio é a da ligação da tela.
  reuniao.canal.mandar({ tipo: 'tela', senha: 'senha-tela' });
  const video = await reuniao.rede.videoNumero(2);
  await atender(page, video, await inviteDe(page, video, 2));
  await expect(selo(page)).toBeVisible();
  expect((await oQueATelaManda(page)).imagem).toEqual(['a captura live']);
});

test('a captura que chega depois do fim da reunião para', async ({ page }) => {
  await capturaFalsa(page, { segurada: true });
  const { canal } = await naReuniao(page);
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(1);

  // Com a escolha da tela ainda aberta, a colega tira a pessoa; a tela escolhida chega depois.
  canal.mandar({ tipo: 'tirado' });
  await expect(titulo(page, 'Você foi tirado da reunião')).toBeVisible();
  await soltarATela(page);
  await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
  expect(canal.tipos()).toEqual(['pedir']);
  await expect(titulo(page, 'Você foi tirado da reunião')).toBeVisible();
});

test('o servidor que recusa a tela para a captura', async ({ page }) => {
  await capturaFalsa(page);
  const { canal } = await naReuniao(page);
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => canal.tipos()).toEqual(['pedir', 'tela']);
  await expect(botao(page, 'Parar de compartilhar')).toBeVisible();

  canal.mandar({ tipo: 'erro', erro: 'foraDaReuniao' });
  await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  await expect(controles(page)).toBeVisible();
});

test('a ligação da tela que falha para a captura, e a principal fica', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);
  const antes = await comoEstaAPrincipal(page);
  const { video } = await compartilhar(page, reuniao, 2);

  // O WSS da tela cai antes do 200: a ligação dela falhou.
  await video.fechar();
  await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(controles(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' })).toBeHidden();
  expect(await comoEstaAPrincipal(page)).toEqual(antes);
  expect(reuniao.principal.recebidas.map(metodo)).toEqual(['INVITE', 'ACK']);
});

test.describe('a saída da reunião para a captura', () => {
  test('o Sair', async ({ page }) => {
    await capturaFalsa(page);
    const reuniao = await naReuniao(page);
    const { video, invite } = await compartilhar(page, reuniao, 2);
    await atender(page, video, invite);
    await expect(selo(page)).toBeVisible();

    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await video.mensagem('BYE');
    await reuniao.principal.mensagem('BYE');
    await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
  });

  test('a conexão do vídeo que cai', async ({ page }) => {
    await capturaFalsa(page);
    const reuniao = await naReuniao(page);
    const { video, invite } = await compartilhar(page, reuniao, 2);
    await atender(page, video, invite);
    await expect(selo(page)).toBeVisible();

    // O WSS da principal cai: as duas descem, e a página volta sozinha, sem a tela.
    await reuniao.principal.fechar();
    await expect(page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' })).toBeVisible();
    await video.mensagem('BYE');
    await expect.poll(() => faixasDaTela(page)).toEqual(['ended']);
    await expect(selo(page)).toBeHidden();
    await expect(botao(page, 'Compartilhar a tela')).toBeDisabled();
  });
});
