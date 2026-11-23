// A página dentro do app (a etapa 2a, seção 7.5 da spec), no Chromium: uma janela de cima de mentira, servida pela
// rota do teste na origem que o chat dos testes deixa pôr a página num quadro (o ORIGEM_DE_CIMA), mostra a reunião num
// iframe com o allow da spec, e as duas conversam por postMessage. A página diz pronta, recebe o passe e os nomes dos
// aparelhos, diz a fase e o fim, e entrega os links do chat da reunião ao app. A rede, a ligação e o relógio são os de
// mentira da reuniao-falsa.ts; quem entra é a Júlia Martins (o COLEGA da rede falsa). A janela de cima e as conversas
// com ela são as da janela-do-app.ts.
import { expect, test } from '@playwright/test';
import { CHAT } from '../chat';
import {
  DO_CHAT,
  NO_QUADRO,
  OUTRA_ORIGEM,
  PRONTA,
  abrirNoApp,
  botaoDe,
  comOPasse,
  controles,
  estado,
  mandar,
  mensagens,
  naReuniaoNoApp,
  recebidas,
  rotas,
} from '../janela-do-app';
import { MARCADA } from '../ligacoes-falsas';
import { CODIGO, RedeFalsa, type Mensagem } from '../rede-falsa';
import { CARLOS, PASSE, conferir, doConsole, esperadoNoConsole, prepararAPagina, vigiar } from '../reuniao-falsa';

// A página no quadro abre num navegador só dela (o NO_QUADRO, da janela-do-app.ts).
test.use(NO_QUADRO);

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// Nenhuma violação da CSP, na janela de cima e na página da reunião, nenhum erro, e nada dos nomes, do passe ou das
// origens no console, em todos os testes daqui.
test.afterEach(async ({ page }) => {
  await conferir(page);
  for (const frame of page.frames()) {
    if (!frame.url().startsWith(`${CHAT}/r/`)) continue;
    expect(await frame.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
  }
  expect(doConsole(page).filter((m) => m.includes(PASSE) || m.includes('127.0.0.1') || m.includes('Fake'))).toEqual(
    [],
  );
  expect(doConsole(page)).toEqual([]);
});

test('a página aparece dentro da janela de teste', async ({ page }) => {
  const a = await abrirNoApp(page);
  // O pronta, uma vez, da origem do chat, e nada é aberto antes do passe.
  const r = await recebidas(page);
  expect(r).toEqual([{ origem: DO_CHAT, m: PRONTA }]);
  expect(a.rede.abrires).toEqual([]);
  // A página da reunião é a do chat, no quadro.
  expect(a.frame.url()).toBe(`${CHAT}/r/${CODIGO}`);
  await expect(a.quadro.locator('.carregando')).toBeVisible();
});

test('outra origem não mostra a página', async ({ page }) => {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  await rotas(page);
  await prepararAPagina(page);
  await page.goto(`${OUTRA_ORIGEM}/`);
  // O navegador recusa a página no quadro, pelo frame-ancestors, e diz isso no console dele.
  const recusa = (m: string) => m.includes('frame-ancestors');
  await expect.poll(() => doConsole(page).some(recusa)).toBe(true);
  esperadoNoConsole(page, recusa);
  const quadro = page.frames().find((f) => f !== page.mainFrame());
  expect(quadro?.url()).not.toBe(`${CHAT}/r/${CODIGO}`);
  await page.clock.runFor(1000);
  expect(await recebidas(page)).toEqual([]);
  expect(rede.abrires).toEqual([]);
});

test('o passe por mensagem', async ({ page }) => {
  const a = await abrirNoApp(page);
  await mandar(page, { tipo: 'passe', passe: PASSE, aparelhos: {} });
  // O abrir levou o passe, e a entrada do colega aparece.
  await expect(a.quadro.getByText('Você entra como', { exact: true })).toBeVisible();
  await expect(a.quadro.getByText('Júlia Martins', { exact: true })).toBeVisible();
  await expect(botaoDe(a.quadro, 'Entrar')).toBeVisible();
  expect(a.corpos).toEqual([{ passe: PASSE }]);
  // Dentro do app não há a tela "o app ou o navegador", nem a faixa.
  await expect(a.quadro.locator('section[data-tela="escolha"]')).toBeHidden();
  await expect(a.quadro.locator('.faixa-sem-colega:visible')).toHaveCount(0);
  // A câmera de mentira aparece na prévia, dentro do quadro.
  await expect
    .poll(() =>
      a.frame
        .locator('video.previa')
        .first()
        .evaluate(
          (v: HTMLVideoElement) =>
            v.videoWidth > 0 &&
            (v.srcObject as MediaStream | null)?.getVideoTracks().some((t) => t.readyState === 'live') === true,
        ),
    )
    .toBe(true);
  // A fase da entrada vai ao app, depois do pronta.
  await expect.poll(() => mensagens(page)).toEqual([PRONTA, estado('entrada')]);
});

test('o estado e o fim', async ({ page }) => {
  const a = await abrirNoApp(page);
  await naReuniaoNoApp(page, a);
  await expect.poll(() => mensagens(page)).toEqual([PRONTA, estado('entrada'), estado('naReuniao')]);
  // O microfone que os outros ouvem.
  await botaoDe(a.quadro, 'Microfone').click();
  await expect.poll(() => mensagens(page)).toContainEqual(estado('naReuniao', false));
  await botaoDe(a.quadro, 'Microfone').click();
  // O Sair: o fim com o saiu, e o estado da entrada (não é uma queda).
  await botaoDe(a.quadro, 'Sair').click();
  await expect(a.quadro.getByRole('heading', { level: 1, name: 'Você saiu da reunião' })).toBeVisible();
  await expect
    .poll(() => mensagens(page))
    .toEqual([
      PRONTA,
      estado('entrada'),
      estado('naReuniao'),
      estado('naReuniao', false),
      estado('naReuniao'),
      estado('entrada'),
      { starsonic: 1, tipo: 'fim', motivo: 'saiu' },
    ]);
  // Tudo da origem do chat.
  for (const r of await recebidas(page)) expect(r.origem).toBe(DO_CHAT);
});

test('o link do chat da reunião', async ({ page, context }) => {
  // O site do link é de mentira: nenhum pedido pode chegar a ele.
  const pedidosAoSite: string[] = [];
  await context.route('https://exemplo.com.br/**', (r) => {
    pedidosAoSite.push(r.request().url());
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Relatório</title>' });
  });
  const a = await abrirNoApp(page);
  const canal = await naReuniaoNoApp(page, a);
  const doCarlos: Mensagem = {
    tipo: 'mensagem',
    de: CARLOS.quem,
    nome: CARLOS.nome,
    voce: false,
    texto: 'O relatório: https://exemplo.com.br/relatorio',
  };
  canal.mandar(doCarlos);
  // O botão Chat, com o número da mensagem nova no nome dele.
  await a.quadro.locator('button[data-botao="chat"]').click();
  const link = a.quadro.locator('.painel').getByRole('link', { name: 'https://exemplo.com.br/relatorio' });
  await expect(link).toBeVisible();
  const paginas = context.pages().length;
  await link.click();
  await expect
    .poll(() => mensagens(page))
    .toContainEqual({ starsonic: 1, tipo: 'link', url: 'https://exemplo.com.br/relatorio' });
  // O clique do meio também vai ao app.
  await link.click({ button: 'middle' });
  await expect
    .poll(async () => (await mensagens(page)).filter((m) => (m as { tipo?: string }).tipo === 'link').length)
    .toBe(2);
  // Nenhuma janela nova, nenhum pedido ao site, e a reunião continua no quadro.
  await page.clock.runFor(1000);
  expect(context.pages().length).toBe(paginas);
  expect(pedidosAoSite).toEqual([]);
  expect(a.frame.url()).toBe(`${CHAT}/r/${CODIGO}`);
  await expect(controles(a.quadro)).toBeVisible();
});

test('os aparelhos pelo nome', async ({ page }) => {
  // Os pedidos da câmera e do microfone que a página faz, com o que cada um pede.
  await page.addInitScript(() => {
    const w = window as unknown as { pedidos: MediaStreamConstraints[] };
    w.pedidos = [];
    if (typeof MediaDevices === 'undefined') return; // a janela que não é segura (a página de erro do quadro)
    const pedir = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = function (restricoes) {
      w.pedidos.push(JSON.parse(JSON.stringify(restricoes ?? {})));
      return pedir.call(this, restricoes);
    };
  });
  const a = await abrirNoApp(page);
  // Os aparelhos de mentira do Chromium: o microfone e o alto-falante que não são os do padrão, e a câmera.
  const ids = await a.frame.evaluate(async () => {
    const lista = await navigator.mediaDevices.enumerateDevices();
    const id = (kind: string, label: string) => lista.find((d) => d.kind === kind && d.label === label)?.deviceId;
    return {
      microfone: id('audioinput', 'Fake Audio Input 1'),
      camera: id('videoinput', 'fake_device_0'),
      altoFalante: id('audiooutput', 'Fake Audio Output 1'),
    };
  });
  expect(ids.microfone).toBeTruthy();
  expect(ids.camera).toBeTruthy();
  expect(ids.altoFalante).toBeTruthy();
  await comOPasse(page, a, {
    microfone: 'Fake Audio Input 1',
    altoFalante: 'Fake Audio Output 1',
    camera: 'fake_device_0',
  });
  const naPagina = () =>
    a.frame.evaluate(() => {
      const fluxo = (document.querySelector('video.previa') as HTMLVideoElement).srcObject as MediaStream;
      const som = document.getElementById('som') as HTMLAudioElement & { sinkId: string };
      return {
        pedidos: (window as unknown as { pedidos: MediaStreamConstraints[] }).pedidos,
        microfone: fluxo.getAudioTracks()[0]?.label,
        camera: fluxo.getVideoTracks()[0]?.label,
        altoFalante: som.sinkId,
      };
    });
  // O pedido leva o deviceId de cada aparelho com aquele nome, e o som da reunião sai pelo alto-falante escolhido.
  await expect.poll(async () => (await naPagina()).altoFalante).toBe(ids.altoFalante);
  let agora = await naPagina();
  expect(agora.pedidos).toHaveLength(1);
  expect(agora.pedidos[0]).toMatchObject({
    audio: { deviceId: { exact: ids.microfone } },
    video: { deviceId: { exact: ids.camera }, width: { ideal: 1280 } },
  });
  expect(agora.microfone).toBe('Fake Audio Input 1');
  expect(agora.camera).toBe('fake_device_0');

  // Os nomes que o navegador não tem: a entrada pede de novo, com o padrão do sistema.
  await mandar(page, {
    tipo: 'aparelhos',
    aparelhos: { microfone: 'Headset que saiu', altoFalante: 'Caixa que saiu', camera: 'Câmera que saiu' },
  });
  await expect.poll(async () => (await naPagina()).pedidos.length).toBe(2);
  await expect.poll(async () => (await naPagina()).microfone).toBe('Fake Default Audio Input');
  agora = await naPagina();
  expect(agora.pedidos[1]).toEqual({
    audio: true,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      aspectRatio: { ideal: 16 / 9 },
      facingMode: { ideal: 'user' },
    },
  });
  expect(agora.camera).toBe('fake_device_0');
  await expect.poll(async () => (await naPagina()).altoFalante).toBe('');
});

test('uma mensagem de outra origem é ignorada', async ({ page }) => {
  const a = await abrirNoApp(page, true);
  // Duas terceiras janelas mandam um passe à reunião: uma de outra origem, e uma da origem do app que não é a de
  // cima. Nada acontece.
  const FALSO = 'passeDeOutraJanelaQueNaoVale'.padEnd(43, '0');
  for (const nome of ['terceira', 'vizinha']) {
    const terceira = page.frame({ name: nome });
    if (!terceira) throw new Error(`falta o quadro ${nome}`);
    await terceira.evaluate(
      ({ passe, chat }) => window.parent.frames[0].postMessage({ starsonic: 1, tipo: 'passe', passe, aparelhos: {} }, chat),
      { passe: FALSO, chat: DO_CHAT },
    );
  }
  await page.clock.runFor(1000);
  expect(a.rede.abrires).toEqual([]);
  await expect(a.quadro.locator('.carregando')).toBeVisible();
  // O passe da janela de cima, depois, vale: o abrir leva só ele.
  await mandar(page, { tipo: 'passe', passe: PASSE, aparelhos: {} });
  await expect(a.quadro.getByText('Você entra como', { exact: true })).toBeVisible();
  expect(a.corpos).toEqual([{ passe: PASSE }]);
});
