// A janela do app de mentira dos testes da página (a etapa 2a, seção 7.5 da spec), no Chromium: uma janela de cima,
// servida pela rota do teste na origem que o chat dos testes deixa pôr a página num quadro (o ORIGEM_DE_CIMA), mostra
// a reunião num iframe com o allow da spec, e as duas conversam por postMessage. A rede, a ligação e o relógio são os
// de mentira da reuniao-falsa.ts; quem entra é a Júlia Martins (o COLEGA da rede falsa). Os testes da página dentro do
// app (app.spec.ts) e os da pausa (pausa.spec.ts) partem daqui.
import { expect, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { CHAT, ORIGEM_DE_CIMA } from './chat';
import { MARCADA } from './ligacoes-falsas';
import { CODIGO, RedeFalsa, type Canal } from './rede-falsa';
import { ACEITO, LIGACAO_FALSA, PASSE, prepararAPagina, subir } from './reuniao-falsa';

/** Uma origem que o chat não deixa pôr a página num quadro. */
export const OUTRA_ORIGEM = 'http://127.0.0.1:4195';
export const DO_CHAT = new URL(CHAT).origin;

/**
 * Os argumentos do Chromium para a página no quadro. A janela de cima de mentira vem da rota do teste, sem endereço de
 * rede, e o Chromium a conta como pública: sem o último, ele recusa a página do chat, num endereço local, no quadro
 * dela (o Local Network Access). Os outros são os do playwright.config.ts. (O quadro abre num navegador só dele.)
 */
export const NO_QUADRO = {
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-features=LocalNetworkAccessChecks',
    ],
  },
};

/**
 * A janela de cima de mentira: a reunião num iframe, com o allow da spec (a câmera, o microfone, a captura de tela, a
 * reprodução automática e a escolha do alto-falante, só para a origem do chat), e o que ela recebe de cada janela, com
 * a origem (o window.recebidas). Com o terceiras, mais dois quadros vazios: um de outra origem e um da mesma.
 */
function janelaDeCima(terceiras = false): string {
  const permite = ['camera', 'microphone', 'display-capture', 'autoplay']
    .map((p) => `${p} ${DO_CHAT}`)
    .join('; ');
  const outras = terceiras
    ? `<iframe name="terceira" src="${OUTRA_ORIGEM}/terceira"></iframe>` +
      `<iframe name="vizinha" src="${ORIGEM_DE_CIMA}/terceira"></iframe>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Starsonic Phone</title></head>
<body>
<iframe id="reuniao" title="Reunião" src="${CHAT}/r/${CODIGO}" allow="${permite}" width="1200" height="760"></iframe>
${outras}
<script>
window.recebidas = [];
addEventListener('message', (e) => window.recebidas.push({ origem: e.origin, m: e.data }));
</script>
</body></html>`;
}

/** As rotas das janelas de mentira: a de cima, a de outra origem e os quadros vazios. */
export async function rotas(page: Page, terceiras = false): Promise<void> {
  const html = (corpo: string) => ({ contentType: 'text/html; charset=utf-8', body: corpo });
  await page.route(`${ORIGEM_DE_CIMA}/`, (r) => r.fulfill(html(janelaDeCima(terceiras))));
  await page.route(`${OUTRA_ORIGEM}/`, (r) => r.fulfill(html(janelaDeCima())));
  for (const origem of [ORIGEM_DE_CIMA, OUTRA_ORIGEM]) {
    await page.route(`${origem}/terceira`, (r) => r.fulfill(html('<!doctype html><title>Outra</title>')));
  }
}

/** O que a janela de cima recebeu, na ordem. */
export const recebidas = (page: Page) =>
  page.evaluate(() => (window as unknown as { recebidas: Array<{ origem: string; m: unknown }> }).recebidas);
/** Só as mensagens, na ordem. */
export const mensagens = async (page: Page) => (await recebidas(page)).map((r) => r.m);

/** A janela de cima manda uma mensagem à página, para a origem do chat. */
export async function mandar(page: Page, m: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ m, chat }) => {
      const quadro = document.getElementById('reuniao') as HTMLIFrameElement;
      quadro.contentWindow?.postMessage({ starsonic: 1, ...m }, chat);
    },
    { m, chat: DO_CHAT },
  );
}

export const PRONTA = { starsonic: 1, tipo: 'pronta' };
export const estado = (fase: string, microfone = true) => ({ starsonic: 1, tipo: 'estado', fase, microfone });

export interface NoApp {
  rede: RedeFalsa;
  quadro: FrameLocator;
  frame: Frame;
  /** Os corpos dos abrir, na ordem. */
  corpos: unknown[];
}

/** A janela de cima com a reunião no iframe, até o pronta chegar a ela. A ligação é a falsa, ou a dada. */
export async function abrirNoApp(page: Page, terceiras = false, ligacao = LIGACAO_FALSA): Promise<NoApp> {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  const corpos: unknown[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/pagina/reunioes/')) corpos.push(r.postDataJSON());
  });
  await rotas(page, terceiras);
  await prepararAPagina(page, ligacao);
  await page.goto(`${ORIGEM_DE_CIMA}/`);
  await expect.poll(() => mensagens(page)).toContainEqual(PRONTA);
  const frame = page.frame({ url: new RegExp(`/r/${CODIGO}$`) });
  if (!frame) throw new Error('a reunião não está no quadro');
  return { rede, quadro: page.frameLocator('#reuniao'), frame, corpos };
}

export const botaoDe = (quadro: FrameLocator, nome: string) => quadro.getByRole('button', { name: nome, exact: true });
export const controles = (quadro: FrameLocator) => quadro.getByRole('navigation', { name: 'Controles da reunião' });

/** O passe chega, e a entrada do colega aparece, com a câmera e o microfone já na prévia. */
export async function comOPasse(page: Page, a: NoApp, aparelhos: Record<string, string> = {}): Promise<void> {
  await mandar(page, { tipo: 'passe', passe: PASSE, aparelhos });
  await expect(a.quadro.getByText('Você entra como', { exact: true })).toBeVisible();
  await expect
    .poll(() => a.frame.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
}

/** O colega no app, na reunião: o passe, o Entrar e o aceito. Devolve o canal 1. */
export async function naReuniaoNoApp(page: Page, a: NoApp): Promise<Canal> {
  await comOPasse(page, a);
  a.rede.aoEntrar = (c) => c.mandar(ACEITO);
  await botaoDe(a.quadro, 'Entrar').click();
  await subir(page, () => controles(a.quadro).isVisible());
  return a.rede.canalNumero(1);
}
