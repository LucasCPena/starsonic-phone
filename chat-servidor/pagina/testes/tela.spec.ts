// A tela compartilhada pela página (o desenho, item 4), no Chromium: a página de verdade, servida pelo chat no modo de
// teste, com a rede falsa (o abrir, o canal e o WSS do vídeo) e o relógio parado. As duas ligações são as do JsSIP de
// verdade, e o servidor falso as atende (o 200 com a resposta de outra conexão da página: ligacoes-falsas.ts). A tela
// que a pessoa escolheria é um canvas: o getDisplayMedia falso.
import { expect, test, type Page } from '@playwright/test';
import {
  AGORA,
  atenderOInvite,
  cabecalhoSip,
  contarOClique,
  direcoes,
  inviteDe,
  MARCADA,
  registrarConexoes,
} from '../ligacoes-falsas';
import { CODIGO, RedeFalsa, type Canal, type Mensagem, type VideoFalso } from '../rede-falsa';

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

// Todo teste falha com um erro no console da página: o rodar do pagina.js transforma a exceção de um efeito numa linha
// do console.error e segue, e a tela pode continuar certa.
let errosDoConsole: string[] = [];

test.beforeEach(({ page }) => {
  errosDoConsole = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errosDoConsole.push(m.text());
  });
  page.on('pageerror', (e) => errosDoConsole.push(e.message));
});

test.afterEach(() => {
  expect(errosDoConsole, 'os erros no console da página').toEqual([]);
});

interface CapturaFalsa {
  /** A resposta do getDisplayMedia só sai no window.soltarATela(). */
  segurada?: boolean;
  /** O erro com que o getDisplayMedia recusa (a escolha cancelada é o NotAllowedError). */
  recusa?: string;
  /** A captura chega com a imagem já acabada (a tela escolhida fechou antes da resposta). */
  acabada?: boolean;
}

/**
 * Antes da página: o getDisplayMedia dá um canvas, a tela que a pessoa escolheria, com uma segunda faixa viva: outra
 * imagem do canvas, ou, na captura que chega acabada, um som (uma segunda imagem viva faria dela uma captura que
 * serve). Assim, uma captura só acaba com todas as faixas paradas. O window.registro guarda, na ordem, cada chamada do
 * getDisplayMedia, cada AudioContext criado e cada resume(), com "no clique" quando ela sai dentro de um manipulador
 * de click da página, antes de qualquer coisa assíncrona, ou "fora do clique" (o contador do clique). As restrições de
 * cada chamada ficam em window.restricoes, as faixas de cada captura em window.capturas (a imagem primeiro), e os
 * contextos do som em window.contextos.
 */
async function capturaFalsa(page: Page, opcoes: CapturaFalsa = {}): Promise<void> {
  await contarOClique(page);
  await page.addInitScript((opcoes) => {
    const w = window as unknown as {
      registro: string[];
      restricoes: unknown[];
      capturas: MediaStreamTrack[][];
      contextos: AudioContext[];
      soltarATela?: () => void;
      ondeEstaOClique: () => string;
    };
    w.registro = [];
    w.restricoes = [];
    w.capturas = [];
    w.contextos = [];
    const Contexto = window.AudioContext;
    const acordar = Contexto.prototype.resume;
    Contexto.prototype.resume = function (this: AudioContext) {
      w.registro.push(`resume ${w.ondeEstaOClique()}`);
      return acordar.call(this);
    };
    window.AudioContext = class extends Contexto {
      constructor(...args: unknown[]) {
        super(...(args as [AudioContextOptions]));
        w.registro.push(`novo ${w.ondeEstaOClique()}`);
        w.contextos.push(this);
      }
    };
    const imagem = () => {
      const quadro = document.createElement('canvas');
      quadro.width = 640;
      quadro.height = 360;
      quadro.getContext('2d')?.fillRect(0, 0, quadro.width, quadro.height);
      return quadro.captureStream(15).getVideoTracks()[0];
    };
    navigator.mediaDevices.getDisplayMedia = async (restricoes?: DisplayMediaStreamOptions) => {
      w.registro.push(`getDisplayMedia ${w.ondeEstaOClique()}`);
      w.restricoes.push(restricoes);
      if (opcoes.segurada) {
        await new Promise<void>((r) => {
          w.soltarATela = r;
        });
      }
      if (opcoes.recusa) throw new DOMException('o erro do teste', opcoes.recusa);
      const principal = imagem();
      let segunda: MediaStreamTrack;
      if (opcoes.acabada) {
        principal.stop();
        // O som de um contexto da classe original, que não entra no registro.
        segunda = new Contexto().createMediaStreamDestination().stream.getAudioTracks()[0];
      } else {
        segunda = imagem();
      }
      w.capturas.push([principal, segunda]);
      return new MediaStream([principal, segunda]);
    };
  }, opcoes);
}

const registro = (page: Page) => page.evaluate(() => (window as unknown as { registro: string[] }).registro);
const restricoes = (page: Page) => page.evaluate(() => (window as unknown as { restricoes: unknown[] }).restricoes);
/** O readyState das faixas de cada captura, na ordem das capturas (a imagem primeiro). */
const capturas = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { capturas: MediaStreamTrack[][] }).capturas.map((c) => c.map((t) => t.readyState)),
  );
const soltarATela = (page: Page) =>
  page.evaluate(() => (window as unknown as { soltarATela: () => void }).soltarATela());

/**
 * O "Parar de compartilhar" do próprio navegador, na captura i: a imagem acaba, e ele dispara o ended (o stop() da
 * página não o dispara). Com parar falso, só o ended, numa imagem que já acabou.
 */
const oNavegadorPara = (page: Page, i: number, parar = true) =>
  page.evaluate(
    ([i, parar]) => {
      const [imagem] = (window as unknown as { capturas: MediaStreamTrack[][] }).capturas[i];
      if (parar) imagem.stop();
      imagem.dispatchEvent(new Event('ended'));
    },
    [i, parar] as const,
  );

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
  await atenderOInvite(page, principal, await inviteDe(page, principal));
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
    const w = window as unknown as { conexoes: RTCPeerConnection[]; capturas: MediaStreamTrack[][] };
    const pc = w.conexoes[n - 1];
    const fluxo = (document.querySelector('video.previa') as HTMLVideoElement).srcObject as MediaStream;
    const de = (tipo: string) => pc.getSenders().filter((s) => s.track?.kind === tipo).map((s) => s.track!);
    const naPrincipal = w.conexoes[0].getSenders().map((s) => s.track);
    const daCaptura = (t: MediaStreamTrack) => w.capturas.some((c) => c.includes(t));
    return {
      imagem: de('video').map((t) => (daCaptura(t) ? `a captura ${t.readyState}` : 'outra')),
      som: de('audio').map((t) =>
        fluxo.getTracks().includes(t) || naPrincipal.includes(t) || daCaptura(t)
          ? 'o microfone ou a captura'
          : `outro som ${t.readyState}`,
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

  // Dentro do próprio manipulador do clique, antes de qualquer coisa assíncrona (nem uma microtarefa), o silêncio
  // acorda e a tela é pedida: o Safari e o Firefox só deixam pedir a tela dentro do gesto. Só a imagem, sem o som.
  await expect
    .poll(async () => (await registro(page)).slice(antes))
    .toEqual(['resume no clique', 'getDisplayMedia no clique']);
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
  // A imagem é a da captura, e o som é o silêncio gerado: nunca o microfone.
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

  await atenderOInvite(page, video, invite);
  await expect(selo(page)).toBeVisible();
  await expect(page.getByText('Nada é gravado', { exact: true })).toBeHidden();

  await botao(page, 'Parar de compartilhar').click();
  await video.mensagem('BYE');
  await expect(selo(page)).toBeHidden();
  await expect(page.getByText('Nada é gravado', { exact: true })).toBeVisible();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  // O pararCaptura para todas as faixas da captura, e não só a imagem que a ligação mandava.
  expect(await capturas(page)).toEqual([['ended', 'ended']]);
  // A principal e o fluxo continuam como estavam.
  expect(await comoEstaAPrincipal(page)).toEqual(antes);
  expect(reuniao.principal.recebidas.map(metodo)).toEqual(['INVITE', 'ACK']);

  // A captura que a própria página parou não avisa nada: o ended dela, que viesse agora, não para a tela seguinte.
  const segunda = await compartilhar(page, reuniao, 3);
  await atenderOInvite(page, segunda.video, segunda.invite);
  await expect(selo(page)).toBeVisible();
  await oNavegadorPara(page, 0, false);
  await expect(selo(page)).toBeVisible();
  expect(await capturas(page)).toEqual([
    ['ended', 'ended'],
    ['live', 'live'],
  ]);
});

test('a tela que o navegador para é um Parar de compartilhar, uma vez', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);
  const primeira = await compartilhar(page, reuniao, 2);
  await atenderOInvite(page, primeira.video, primeira.invite);
  await expect(selo(page)).toBeVisible();

  await oNavegadorPara(page, 0);
  await primeira.video.mensagem('BYE');
  await expect(selo(page)).toBeHidden();
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  expect(await capturas(page)).toEqual([['ended', 'ended']]);
  // O fim da captura não é o de um aparelho: o Microfone e a Câmera continuam ligados.
  for (const nome of ['Microfone', 'Câmera']) {
    await expect(botao(page, nome)).toBeEnabled();
    await expect(botao(page, nome)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('alert')).toBeHidden();

  // Outra tela. O ended que se repete na captura de antes não a para: ele vale uma vez.
  const segunda = await compartilhar(page, reuniao, 3);
  await atenderOInvite(page, segunda.video, segunda.invite);
  await expect(selo(page)).toBeVisible();
  await oNavegadorPara(page, 0, false);
  await expect(selo(page)).toBeVisible();
  expect(await capturas(page)).toEqual([
    ['ended', 'ended'],
    ['live', 'live'],
  ]);
});

test('o Parar de compartilhar vale antes de a tela ficar no ar', async ({ page }) => {
  await capturaFalsa(page);
  const reuniao = await naReuniao(page);

  // Antes da senha da tela: a captura para, e a senha que chega depois não liga nada.
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => reuniao.canal.tipos()).toEqual(['pedir', 'tela']);
  await botao(page, 'Parar de compartilhar').click();
  await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  reuniao.canal.mandar({ tipo: 'tela', senha: 'senha-velha' });

  // Com a ligação da tela ainda nascendo (o INVITE saiu, sem resposta): ela desce, e a captura para.
  const { video, invite } = await compartilhar(page, reuniao, 2, 'senha-nova');
  expect(cabecalhoSip(invite, 'X-Starsonic-Senha')).toBe('senha-nova');
  expect(reuniao.rede.videos).toHaveLength(2);
  await botao(page, 'Parar de compartilhar').click();
  await expect.poll(() => capturas(page)).toEqual([
    ['ended', 'ended'],
    ['ended', 'ended'],
  ]);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  // O 200 que chega agora não põe a tela no ar: o JsSIP o recebe na ligação que desistiu e a encerra (o ACK e o BYE).
  await atenderOInvite(page, video, invite);
  await video.mensagem('BYE');
  await expect(selo(page)).toBeHidden();
});

test('a escolha da tela cancelada não faz nada', async ({ page }) => {
  await capturaFalsa(page, { recusa: 'NotAllowedError' });
  const { canal } = await naReuniao(page);

  // A recusa é o ok falso, sem aviso: nada no canal, e nenhum erro no console (o afterEach confere).
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => restricoes(page)).toHaveLength(1);
  await page.clock.runFor(10);
  await expect(botao(page, 'Compartilhar a tela')).toBeEnabled();
  await expect(botao(page, 'Parar de compartilhar')).toBeHidden();
  expect(canal.tipos()).toEqual(['pedir']);
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
  // A imagem chegou acabada; o som, que ainda estava vivo, a página parou.
  expect(await capturas(page)).toEqual([['ended', 'ended']]);
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
  expect(await capturas(page)).toEqual([['live', 'live']]);

  // A captura que veio é a da ligação da tela.
  reuniao.canal.mandar({ tipo: 'tela', senha: 'senha-tela' });
  const video = await reuniao.rede.videoNumero(2);
  await atenderOInvite(page, video, await inviteDe(page, video, 2));
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
  await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
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
  await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
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
  await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
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
    await atenderOInvite(page, video, invite);
    await expect(selo(page)).toBeVisible();

    await botao(page, 'Sair').click();
    await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
    await video.mensagem('BYE');
    await reuniao.principal.mensagem('BYE');
    await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
  });

  test('a conexão do vídeo que cai', async ({ page }) => {
    await capturaFalsa(page);
    const reuniao = await naReuniao(page);
    const { video, invite } = await compartilhar(page, reuniao, 2);
    await atenderOInvite(page, video, invite);
    await expect(selo(page)).toBeVisible();

    // O WSS da principal cai: as duas descem, e a página volta sozinha, sem a tela.
    await reuniao.principal.fechar();
    await expect(page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' })).toBeVisible();
    await video.mensagem('BYE');
    await expect.poll(() => capturas(page)).toEqual([['ended', 'ended']]);
    await expect(selo(page)).toBeHidden();
    await expect(botao(page, 'Compartilhar a tela')).toBeDisabled();
  });
});
