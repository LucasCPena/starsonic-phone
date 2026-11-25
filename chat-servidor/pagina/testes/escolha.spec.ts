// O passe no endereço e a tela "o app ou o navegador" (a etapa 2a), no Chromium, na reunião de mentira
// (reuniao-falsa.ts). O app abre a reunião no navegador do PC em /r/<código>#p=<passe>: a página lê o passe, tira-o do
// endereço antes de qualquer pedido e o leva no primeiro abrir. No Windows, quem a página não reconheceu escolhe antes
// entre o app (o link starsonic://reuniao/<código>) e o navegador; a reunião de teste nunca pergunta.
//
// O Windows, o Android e o Mac de mentira: o agente do contexto e o navigator.userAgentData, posto também à mão (o
// Playwright o tira do agente, e o navegador de verdade não). Os outros testes da página abrem com o agente do Linux
// (o playwright.config.ts), e nenhum cai na escolha.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { MARCADA } from '../ligacoes-falsas';
import { CODIGO, PASSE_QUE_NAO_VALE, RedeFalsa, type Reuniao } from '../rede-falsa';
import {
  ACEITO,
  PASSE,
  abrirComoColega,
  abrirNaEntrada,
  botao,
  caixa,
  conferir,
  doConsole,
  esperadoNoConsole,
  prepararAPagina,
  subir,
  vigiar,
} from '../reuniao-falsa';

// ---- Os aparelhos de mentira. ----

interface Aparelho {
  agente: string;
  plataforma: string;
  celular: boolean;
}

const WINDOWS: Aparelho = {
  agente:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  plataforma: 'Windows',
  celular: false,
};
const ANDROID: Aparelho = {
  agente:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  plataforma: 'Android',
  celular: true,
};
const MAC: Aparelho = {
  agente:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  plataforma: 'macOS',
  celular: false,
};

/** O navigator.userAgentData do aparelho, e os pedidos contados (o contarOsPedidos). */
async function comoNo(page: Page, a: Aparelho): Promise<void> {
  await page.addInitScript(
    ({ plataforma, celular }) => {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true,
        get: () => ({ platform: plataforma, mobile: celular, brands: [] }),
      });
    },
    { plataforma: a.plataforma, celular: a.celular },
  );
  await contarOsPedidos(page);
}

/**
 * Os pedidos da câmera e do microfone, contados (o window.pedidosDeMidia), o endereço da página na hora de cada fetch
 * (o window.enderecosDosPedidos) e o tamanho do histórico no começo da página (o window.historicoNoComeco).
 */
async function contarOsPedidos(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { pedidosDeMidia: number; enderecosDosPedidos: string[]; historicoNoComeco: number };
    w.pedidosDeMidia = 0;
    const pedir = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = function (...args) {
      w.pedidosDeMidia += 1;
      return pedir.apply(this, args);
    };
    w.historicoNoComeco = history.length;
    w.enderecosDosPedidos = [];
    const buscar = window.fetch;
    window.fetch = function (...args) {
      w.enderecosDosPedidos.push(location.href);
      return buscar.apply(this, args);
    };
  });
}

/** Uma página nova, noutro contexto, com o agente do aparelho; a vigia do CSP e do console vale nela também. */
async function paginaNo(browser: Browser, a: Aparelho): Promise<Page> {
  const contexto = await browser.newContext({ userAgent: a.agente });
  const page = await contexto.newPage();
  await vigiar(page);
  await comoNo(page, a);
  return page;
}

const pedidosDeMidia = (page: Page) =>
  page.evaluate(() => (window as unknown as { pedidosDeMidia: number }).pedidosDeMidia);
const enderecosDosPedidos = (page: Page) =>
  page.evaluate(() => (window as unknown as { enderecosDosPedidos: string[] }).enderecosDosPedidos);

// ---- As peças. ----

const DE_TESTE: Reuniao = { tipo: 'teste', assunto: null, inicio: null };
const FAIXA =
  'Não foi possível reconhecer você como colega. Abra a reunião de novo pelo app, ou entre como convidado.';

const escolha = (page: Page) => page.locator('section[data-tela="escolha"]');
const entrada = (page: Page) => page.locator('section[data-tela="entrada"]');
const abrirNoApp = (page: Page) => page.getByRole('link', { name: 'Abrir no app', exact: true });
const peloNavegador = (page: Page) => botao(page, 'Entrar pelo navegador');
/** O aviso mais novo da região que os leitores de tela anunciam. */
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"] > :last-child');

/** O estilo calculado de um elemento. */
const estilo = (page: Page, seletor: string, propriedade: string) =>
  page.locator(seletor).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);

/** A página no link, sem o passe, até a tela da escolha. */
async function naEscolha(page: Page, reuniao: Reuniao = MARCADA): Promise<RedeFalsa> {
  const rede = await RedeFalsa.instalar(page, reuniao);
  await prepararAPagina(page);
  await page.goto(`/r/${CODIGO}`);
  await expect(escolha(page)).toBeVisible();
  return rede;
}

/** A entrada de quem é de fora, com o campo "Seu nome", e a câmera e o microfone já chegaram. */
async function naEntradaDeFora(page: Page): Promise<void> {
  await expect(page.getByLabel('Seu nome')).toBeVisible();
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// Nenhuma violação da CSP, nenhum erro, e nada dos nomes no console, em todos os testes daqui.
test.afterEach(async ({ page }) => {
  await conferir(page);
  expect(doConsole(page)).toEqual([]);
});

// ---- No Windows. ----

test.describe('no Windows', () => {
  test.use({ userAgent: WINDOWS.agente });

  test.beforeEach(async ({ page }) => {
    await comoNo(page, WINDOWS);
  });

  test('a tela no Windows', async ({ page }) => {
    await naEscolha(page);
    await expect(entrada(page)).toBeHidden();
    const tela = escolha(page);
    // Os textos, na ordem da tela.
    await expect(page.locator('.topo-rotulo')).toHaveText('Reunião');
    await expect(tela.locator('[data-campo="tipo"]')).toHaveText('Reunião marcada');
    await expect(tela.getByRole('heading', { level: 1, name: 'Planejamento de dezembro', exact: true })).toBeVisible();
    await expect(tela.locator('[data-campo="dia"]')).toHaveText('Hoje, 14:00');
    for (const texto of [
      'Tem o Starsonic Phone neste computador?',
      'Colegas da empresa entram direto pelo app, sem passar pela espera.',
      'Abrir no app',
      'Se o app não abrir, entre pelo navegador.',
      'Vai entrar pelo navegador?',
      'Para quem é de fora, ou para quem não tem o app aqui. Você digita o seu nome e espera um colega aceitar o pedido.',
      'Entrar pelo navegador',
      'Funciona no navegador do PC e do celular, sem instalar nada.',
      'Nada é gravado. O seu nome só aparece para quem está na reunião.',
    ]) {
      await expect(tela.getByText(texto, { exact: true })).toBeVisible();
    }
    await expect(tela.getByRole('heading', { level: 2 })).toHaveText([
      'Tem o Starsonic Phone neste computador?',
      'Vai entrar pelo navegador?',
    ]);
    // Sem o passe que não valeu, sem a faixa.
    await expect(page.locator('.faixa-sem-colega:visible')).toHaveCount(0);
    // O Abrir no app é um link de verdade, com o código do endereço.
    await expect(abrirNoApp(page)).toHaveAttribute('href', `starsonic://reuniao/${CODIGO}`);
    // A câmera e o microfone não foram pedidos.
    expect(await pedidosDeMidia(page)).toBe(0);
    // O desenho: dois cartões brancos lado a lado; o Abrir no app ciano, e o Entrar pelo navegador branco.
    const cartoes = tela.locator('.escolha-cartao');
    await expect(cartoes).toHaveCount(2);
    expect(await estilo(page, '.escolha-cartao >> nth=0', 'background-color')).toBe('rgb(255, 255, 255)');
    const [app, navegador] = [await caixa(cartoes.nth(0)), await caixa(cartoes.nth(1))];
    expect(navegador.y).toBe(app.y);
    expect(navegador.x).toBeGreaterThan(app.x + app.width);
    expect(await estilo(page, '[data-link="app"]', 'background-color')).toBe('rgb(0, 194, 203)');
    expect(await estilo(page, '[data-link="app"]', 'color')).toBe('rgb(3, 34, 42)');
    const doNavegador = '[data-botao="peloNavegador"]';
    expect(await estilo(page, doNavegador, 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await estilo(page, doNavegador, 'border-top-color')).toBe('rgb(207, 213, 227)');
    expect(await estilo(page, doNavegador, 'color')).toBe('rgb(12, 38, 113)');
    // Na janela estreita, um embaixo do outro.
    await page.setViewportSize({ width: 390, height: 844 });
    const [app2, navegador2] = [await caixa(cartoes.nth(0)), await caixa(cartoes.nth(1))];
    expect(navegador2.y).toBeGreaterThanOrEqual(app2.y + app2.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // O clique no Abrir no app deixa a página na escolha. (O Chromium dos testes não conhece o starsonic://, e diz
    // isso no console dele.)
    await abrirNoApp(page).click();
    await page.clock.runFor(1000);
    esperadoNoConsole(page, (m) => m.includes('starsonic://'));
    await expect(escolha(page)).toBeVisible();
    expect(page.url()).toBe(new URL(`/r/${CODIGO}`, page.url()).href);
    expect(await pedidosDeMidia(page)).toBe(0);
  });

  test('o Abrir no app leva o código como o servidor o escreve', async ({ page }) => {
    // O servidor abre a reunião com o código em maiúsculas; o app só aceita o código exato, em minúsculas.
    await RedeFalsa.instalar(page, MARCADA);
    await prepararAPagina(page);
    await page.goto(`/r/${CODIGO.toUpperCase()}`);
    await expect(escolha(page)).toBeVisible();
    await expect(abrirNoApp(page)).toHaveAttribute('href', `starsonic://reuniao/${CODIGO}`);
  });

  test('Entrar pelo navegador', async ({ page }) => {
    const rede = await naEscolha(page);
    await peloNavegador(page).click();
    // A entrada de hoje: o campo "Seu nome", e a câmera e o microfone pedidos só agora.
    await expect(escolha(page)).toBeHidden();
    await naEntradaDeFora(page);
    expect(await pedidosDeMidia(page)).toBeGreaterThan(0);
    await expect(entrada(page).getByRole('heading', { level: 1, name: 'Planejamento de dezembro' })).toBeFocused();
    await expect(botao(page, 'Pedir para entrar')).toBeVisible();
    await expect(page.locator('.faixa-sem-colega:visible')).toHaveCount(0);
    // E o pedido de hoje, pela espera.
    await page.getByLabel('Seu nome').fill('Maria Lima');
    await botao(page, 'Pedir para entrar').click();
    const canal = await rede.canalNumero(1);
    await expect.poll(() => canal.tipos()).toContain('pedir');
    expect(rede.abrires).toHaveLength(2);
  });

  test('a reunião de teste não pergunta', async ({ page }) => {
    await RedeFalsa.instalar(page, DE_TESTE);
    await abrirNaEntrada(page, `/r/${CODIGO}`);
    await expect(page.getByLabel('Seu nome')).toBeVisible();
    await expect(escolha(page)).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Reunião', exact: true })).toBeVisible();
  });

  test('o teclado e o leitor de tela', async ({ page }) => {
    await naEscolha(page);
    // O título da tela é o primeiro foco, e o leitor de tela o ouve.
    const tituloDaTela = escolha(page).getByRole('heading', { level: 1, name: 'Planejamento de dezembro' });
    await expect(tituloDaTela).toBeFocused();
    await expect(anuncio(page)).toHaveText('Planejamento de dezembro');
    // Os dois têm nome: o link e o botão.
    await expect(abrirNoApp(page)).toBeVisible();
    await expect(peloNavegador(page)).toBeVisible();
    // O Tab segue a ordem da tela: o Abrir no app, e depois o Entrar pelo navegador.
    await page.keyboard.press('Tab');
    await expect(abrirNoApp(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(peloNavegador(page)).toBeFocused();
    // O Enter no botão entra pelo navegador, e o foco vai ao título da entrada.
    await page.keyboard.press('Enter');
    await expect(entrada(page).getByRole('heading', { level: 1, name: 'Planejamento de dezembro' })).toBeFocused();
    await naEntradaDeFora(page);
  });
});

// ---- Fora do Windows. ----

test('fora do Windows', async ({ browser, page }) => {
  // A página de cada teste, que abre com o userAgentData do Linux, também.
  for (const p of [await paginaNo(browser, ANDROID), await paginaNo(browser, MAC), page]) {
    await RedeFalsa.instalar(p, MARCADA);
    await abrirNaEntrada(p, `/r/${CODIGO}`);
    await expect(p.getByLabel('Seu nome')).toBeVisible();
    await expect(escolha(p)).toBeHidden();
    if (p !== page) {
      await conferir(p);
      expect(doConsole(p)).toEqual([]);
      await p.context().close();
    }
  }
});

// ---- O passe no endereço. ----

test('o passe sai do endereço', async ({ page }) => {
  await contarOsPedidos(page);
  const rede = await RedeFalsa.instalar(page, MARCADA);
  // Os corpos dos abrir, na ordem.
  const corpos: unknown[] = [];
  await page.route('**/api/v1/pagina/reunioes/*', async (route) => {
    corpos.push(route.request().postDataJSON());
    await route.fallback();
  });
  await abrirComoColega(page);
  await expect(page.getByText('Você entra como', { exact: true })).toBeVisible();
  // O endereço ficou sem o passe antes do primeiro pedido, e o caminho ficou.
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(page.url()).toBe(new URL(`/r/${CODIGO}`, page.url()).href);
  const enderecos = await enderecosDosPedidos(page);
  expect(enderecos.length).toBeGreaterThan(0);
  for (const e of enderecos) expect(e).toBe(page.url());
  // O abrir levou o passe.
  expect(rede.abrires).toEqual([`/api/v1/pagina/reunioes/${CODIGO}`]);
  expect(corpos).toEqual([{ passe: PASSE }]);
  // O histórico tem uma entrada só para a página: o tirar não deixou outra, e o voltar do navegador não traz o passe
  // de volta.
  const historico = await page.evaluate(() => ({
    agora: history.length,
    noComeco: (window as unknown as { historicoNoComeco: number }).historicoNoComeco,
  }));
  expect(historico.agora).toBe(historico.noComeco);
});

test('o passe não vai ao console nem a outro pedido', async ({ page }) => {
  const pedidos: Array<{ url: string; corpo: string }> = [];
  page.on('request', (r) => pedidos.push({ url: r.url(), corpo: r.postData() ?? '' }));
  const rede = await RedeFalsa.instalar(page, MARCADA);
  await abrirComoColega(page);
  // O colega entra na reunião: o abrir com a chave, o canal e o entrar.
  rede.aoEntrar = (c) => c.mandar(ACEITO);
  await botao(page, 'Entrar').click();
  await subir(page, () => page.getByRole('navigation', { name: 'Controles da reunião' }).isVisible());
  const canal = await rede.canalNumero(1);
  // Só o primeiro abrir levou o passe.
  const comOPasse = pedidos.filter((p) => p.url.includes(PASSE) || p.corpo.includes(PASSE));
  const abrir = new URL(`/api/v1/pagina/reunioes/${CODIGO}`, page.url()).href;
  expect(comOPasse).toEqual([{ url: abrir, corpo: JSON.stringify({ passe: PASSE }) }]);
  expect(pedidos.filter((p) => p.url.includes('/api/v1/pagina/reunioes/')).length).toBe(2);
  // Nem o canal: o bilhete do endereço dele e as mensagens da página.
  expect(canal.bilhete).not.toContain(PASSE);
  expect(JSON.stringify(canal.recebidas)).not.toContain(PASSE);
  // Nem o console.
  expect(doConsole(page).filter((m) => m.includes(PASSE) || m.includes('#p='))).toEqual([]);
  expect(await page.evaluate(() => location.href)).not.toContain(PASSE);
});

test('o passe que não vale', async ({ browser, page }) => {
  // No Windows: a escolha, com a faixa no alto; e a faixa fica na entrada de quem é de fora.
  const noWindows = await paginaNo(browser, WINDOWS);
  const rede = await RedeFalsa.instalar(noWindows, MARCADA);
  rede.responder(PASSE_QUE_NAO_VALE);
  await prepararAPagina(noWindows);
  await noWindows.goto(`/r/${CODIGO}#p=${PASSE}`);
  await expect(escolha(noWindows)).toBeVisible();
  await expect(escolha(noWindows).getByText(FAIXA, { exact: true })).toBeVisible();
  expect(await pedidosDeMidia(noWindows)).toBe(0);
  // O primeiro abrir levou o passe, e o segundo foi o de quem é de fora, sem ele.
  expect(rede.abrires).toHaveLength(2);
  await peloNavegador(noWindows).click();
  await naEntradaDeFora(noWindows);
  await expect(entrada(noWindows).getByText(FAIXA, { exact: true })).toBeVisible();
  esperadoNoConsole(noWindows, (m) => m.includes('status of 401'));
  await conferir(noWindows);
  expect(doConsole(noWindows)).toEqual([]);
  await noWindows.context().close();

  // Fora do Windows: direto na entrada de quem é de fora, com a faixa no alto.
  const deFora = await RedeFalsa.instalar(page, MARCADA);
  deFora.responder(PASSE_QUE_NAO_VALE);
  await abrirComoColega(page);
  esperadoNoConsole(page, (m) => m.includes('status of 401'));
  await naEntradaDeFora(page);
  await expect(escolha(page)).toBeHidden();
  const faixa = entrada(page).getByText(FAIXA, { exact: true });
  await expect(faixa).toBeVisible();
  // O leitor de tela a ouve.
  await expect(anuncio(page)).toHaveText(FAIXA);
  await expect(page.getByText('Você entra como', { exact: true })).toBeHidden();
  // A faixa fica no alto da entrada, por cima do título.
  const titulo = await caixa(entrada(page).getByRole('heading', { level: 1 }));
  expect((await caixa(faixa)).y).toBeLessThan(titulo.y);
  // O desenho: a faixa de alerta.
  expect(await estilo(page, 'section[data-tela="entrada"] .faixa-sem-colega', 'background-color')).toBe(
    'rgb(255, 241, 220)',
  );
});
