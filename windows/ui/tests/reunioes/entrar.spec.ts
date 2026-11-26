// As outras entradas da reunião dentro do app (plano 3b, Task 4): o "Entrar" do campo do link (e o Enter nele), o link
// do app (a mensagem `abrir` com a tela `reuniao`), o WebView2 antigo, que abre no navegador e diz por quê, e o
// servidor do chat antigo. O "Entrar" da linha é da vista.spec.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { comandos, empurrar, esperarComando, mudarEstado, type Comando } from '../helpers';
import { abrirNoChat, pararORelogio } from '../chat/abrir';
import { baseDoChat, empresaComReunioes } from '../chat/servidor';
import { versaoDoWebView2, WEBVIEW2_MINIMO } from '../../src/reunioes/vista';
import {
  abrirNasReunioes,
  marcar,
  meioDiaDeHoje,
  noRelogioDaPagina,
  numerarAsLeituras,
  paginaFalsa,
} from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const FORMATO_DO_PASSE = /^[A-Za-z0-9_-]{43}$/;
const DESLIGUE = 'Desligue a ligação para entrar na reunião.';
const SEM_CHAT = 'Este computador não está ligado ao chat da empresa. Entre pelo navegador.';
const WEBVIEW2_ANTIGO = 'Este Windows não abre a reunião dentro do app. Ela abriu no navegador.';
const NAO_RESPONDEU = 'O servidor do chat não respondeu. Tente de novo.';
const ATUALIZAR = 'O servidor do chat precisa ser atualizado para abrir reuniões pelo app.';
const OUTRA_EMPRESA = 'Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.';
const NAO_E_LINK = 'Este não é um link de reunião do Starsonic.';
const UA = (edge: string) =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${edge.split('.')[0]}.0.0.0 Safari/537.36 Edg/${edge}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const ePasse = (url: URL) => url.pathname.endsWith('/passe');
const quadro = (page: Page) => page.locator('iframe[title="Reunião"]');
const campo = (page: Page) => page.getByRole('textbox', { name: 'Entrar com o link de uma reunião' });
const doCampo = (page: Page) => page.locator('.reun-link');
const entrarDoCampo = (page: Page) => doCampo(page).getByRole('button', { name: 'Entrar', exact: true });
const navegadorDoCampo = (page: Page) => doCampo(page).getByRole('button', { name: 'Abrir no navegador' });
const alertaDoCampo = (page: Page) => doCampo(page).getByRole('alert');

async function marcarHoje(api: Parameters<typeof marcar>[0]): Promise<{ codigo: string; link: string }> {
  return marcar(api, noRelogioDaPagina(0, 14, 0), PLANEJAMENTO);
}

/** Abre o app nas Reuniões com a hora da página fixa no meio-dia (os timers andam). */
async function abrir(page: Page, pessoa: { chave: string }): Promise<void> {
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO });
}

async function doTipo(page: Page, cmd: string): Promise<Comando[]> {
  return (await comandos(page)).filter((c) => c.cmd === cmd);
}

/** Segura o POST do passe até o `soltar`, e conta quantos saíram. */
async function segurarOPasse(page: Page): Promise<{ soltar(): void; pedidos(): number }> {
  let n = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(ePasse, async (rota: Route) => {
    n += 1;
    await solto;
    await rota.continue();
  });
  return { soltar, pedidos: () => n };
}

/** O chat sem a operação do passe (404, com a reunião na lista): conta os pedidos, sem gastar a janela do endereço. */
async function passeAntigo(page: Page): Promise<{ pedidos(): number }> {
  let n = 0;
  await page.route(ePasse, (rota) => {
    n += 1;
    return rota.fulfill({ status: 404, json: { erro: 'naoEncontrado' } });
  });
  return { pedidos: () => n };
}

/** Conta os pedidos do passe que saem da página (e os deixa seguir). */
async function contarOsPasses(page: Page): Promise<{ pedidos(): number }> {
  let n = 0;
  await page.route(ePasse, (rota) => {
    n += 1;
    return rota.continue();
  });
  return { pedidos: () => n };
}

const abrirReuniao = (page: Page, codigo: string) =>
  empurrar(page, { v: 1, type: 'abrir', tela: 'reuniao', codigo });

test('o Entrar do campo abre a reunião colada, e o Enter é o Entrar', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, criada.codigo);
  const passes = await contarOsPasses(page);
  await abrir(page, pessoas[0]);
  // Sem texto, sem botões; com texto, o Entrar (o botão principal, o primeiro) e o Abrir no navegador.
  await expect(doCampo(page).getByRole('button')).toHaveCount(0);
  await campo(page).fill(criada.link);
  await expect(doCampo(page).getByRole('button')).toHaveText(['Entrar', 'Abrir no navegador']);
  await entrarDoCampo(page).click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(quadro(page)).toHaveAttribute('src', `${baseDoChat()}/r/${criada.codigo}`);
  await expect.poll(async () => (await pagina.recebidas()).length).toBe(1);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  // O campo esvaziou. O link do app da reunião que já está na vista só a mostra: nenhum passe a mais, nenhum
  // tamanho novo da janela e nenhum navegador.
  await expect(campo(page)).toHaveValue('');
  const antes = passes.pedidos();
  await abrirReuniao(page, criada.codigo);
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(passes.pedidos()).toBe(antes);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  expect(await doTipo(page, 'videoWindow')).toHaveLength(1);
  await expect(quadro(page)).toHaveCount(1);
});

test('o Enter no campo, sem a reunião na vista, entra pelo passe', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, criada.codigo);
  await abrir(page, pessoas[0]);
  // Só o código, em maiúsculas (o código é lido em minúsculas).
  await campo(page).fill(criada.codigo.toUpperCase());
  await campo(page).press('Enter');
  await expect.poll(async () => (await pagina.recebidas()).length).toBe(1);
  await expect(quadro(page)).toHaveAttribute('src', `${baseDoChat()}/r/${criada.codigo}`);
  const [passe] = (await pagina.recebidas()) as Array<{ passe: string }>;
  expect(passe.passe).toMatch(FORMATO_DO_PASSE);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o Entrar do campo fica aria-disabled com o pedido no ar, sem tirar o foco', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  await paginaFalsa(page, criada.codigo);
  await abrir(page, pessoas[0]);
  const segurado = await segurarOPasse(page);
  await campo(page).fill(criada.codigo);
  await entrarDoCampo(page).click();
  await expect.poll(() => segurado.pedidos()).toBe(1);
  await expect(entrarDoCampo(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(navegadorDoCampo(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(entrarDoCampo(page)).toBeFocused();
  // O Playwright não clica no que está aria-disabled: o clique vai pelo elemento, como o de um clique já a caminho.
  await entrarDoCampo(page).evaluate((b) => (b as HTMLElement).click());
  await navegadorDoCampo(page).evaluate((b) => (b as HTMLElement).click());
  await campo(page).press('Enter');
  await page.evaluate(() => 0);
  expect(segurado.pedidos()).toBe(1);
  segurado.soltar();
  await expect(quadro(page)).toHaveCount(1);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o link do app abre a entrada da reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, criada.codigo);
  await abrir(page, pessoas[0]);
  // Longe da aba: o link do app leva de volta a ela, põe o link no campo e faz o Entrar dele.
  await page.locator('nav.nav button').first().click();
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toHaveCount(0);
  const segurado = await segurarOPasse(page);
  await abrirReuniao(page, criada.codigo);
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
  await expect(campo(page)).toHaveValue(`${baseDoChat()}/r/${criada.codigo}`);
  await expect.poll(() => segurado.pedidos()).toBe(1);
  segurado.soltar();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(quadro(page)).toHaveAttribute('src', `${baseDoChat()}/r/${criada.codigo}`);
  await expect.poll(async () => (await pagina.recebidas()).length).toBe(1);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o link do app de uma reunião de outra empresa oferece o navegador', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api);
  // O 403 vem do page.route: o limite de falhas do endereço é de todos os testes da rodada.
  await page.route(ePasse, (rota) => rota.fulfill({ status: 403, json: { erro: 'outraEmpresa' } }));
  await abrir(page, pessoas[0]);
  await abrirReuniao(page, 'abcdefghjk');
  await expect(alertaDoCampo(page)).toHaveText(OUTRA_EMPRESA);
  await expect(quadro(page)).toHaveCount(0);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  await expect(doCampo(page).getByRole('button')).toHaveText(['Abrir no navegador']);
  await navegadorDoCampo(page).click();
  await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(1);
  expect((await doTipo(page, 'reuniaoNavegador'))[0]).toEqual({ v: 1, cmd: 'reuniaoNavegador', codigo: 'abcdefghjk' });
});

test('o link do app sem o chat diz para entrar pelo navegador', async ({ page }) => {
  let pedidos = 0;
  await page.route(`${baseDoChat()}/**`, (rota) => {
    pedidos += 1;
    return rota.continue();
  });
  await abrirNoChat(page, { chave: 'sem-chave', ...RECEPCAO, cenario: 'chat-desligado' });
  await expect(page.locator('nav.nav button.tab-reunioes')).toHaveCount(0);
  await abrirReuniao(page, 'abcdefghjk');
  await expect(page.locator('.toast-box')).toHaveText(SEM_CHAT);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(pedidos).toBe(0);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  expect(await doTipo(page, 'videoWindow')).toEqual([]);
});

const CARTAO = { id: 51, number: '2003', name: 'Ana Souza', incoming: true, held: false };
const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };
const LIGACAO = {
  top: { ...CARTAO, phase: 'active', activeSinceMs: Date.now() - 5_000, video: SEM_VIDEO },
  second: null,
  secondKind: 'none',
  muted: false,
  conference: false,
  conferenceSinceMs: 0,
  consulting: false,
  colleagueActive: false,
  sala: null,
};

test('o link do app com uma ligação diz para desligar', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  let pedidos = 0;
  await page.route(ePasse, (rota) => {
    pedidos += 1;
    return rota.continue();
  });
  await abrir(page, pessoas[0]);
  await mudarEstado(page, (s) => ({ ...s, ligacao: LIGACAO }));
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toHaveCount(0);
  await abrirReuniao(page, criada.codigo);
  await expect(page.getByText(DESLIGUE, { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(pedidos).toBe(0);
  expect(await doTipo(page, 'videoWindow')).toEqual([]);
  await expect(quadro(page)).toHaveCount(0);
  // Desligada a ligação, o link do app não fica à espera: a aba abre sem o link no campo e sem entrar sozinha.
  await mudarEstado(page, (s) => ({ ...s, ligacao: null }));
  await page.locator('nav.nav button.tab-reunioes').click();
  await expect(campo(page)).toHaveValue('');
  expect(pedidos).toBe(0);
});

test.describe('o WebView2 antigo', () => {
  test.use({ userAgent: UA('130.0.2849.80') });

  test('abre no navegador e diz por quê', async ({ page }) => {
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    const criada = await marcarHoje(pessoas[0].api);
    await abrir(page, pessoas[0]);
    // O Entrar da linha.
    await page.getByRole('article').getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(1);
    await expect(page.locator('.toast-box')).toHaveText(WEBVIEW2_ANTIGO);
    // O Entrar do campo.
    await campo(page).fill(criada.link);
    await entrarDoCampo(page).click();
    await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(2);
    await expect(campo(page)).toHaveValue('');
    // O link do app.
    await abrirReuniao(page, criada.codigo);
    await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(3);
    for (const c of await doTipo(page, 'reuniaoNavegador')) {
      expect(c.codigo).toBe(criada.codigo);
      expect(c.passe).toMatch(FORMATO_DO_PASSE);
    }
    await expect(quadro(page)).toHaveCount(0);
    expect(await doTipo(page, 'videoWindow')).toEqual([]);
  });
});

test.describe('o WebView2 no mínimo', () => {
  test.use({ userAgent: UA('131.0.2903.86') });

  test('abre a vista', async ({ page }) => {
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    const criada = await marcarHoje(pessoas[0].api);
    await paginaFalsa(page, criada.codigo);
    await abrir(page, pessoas[0]);
    await page.getByRole('article').getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(quadro(page)).toHaveCount(1);
    expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  });
});

test('o versaoDoWebView2 lê o Edg/<n> do userAgent', () => {
  expect(versaoDoWebView2('Mozilla/5.0 Chrome/158.0.0.0 Safari/537.36 Edg/158.0')).toBe(158);
  expect(versaoDoWebView2(UA('131.0.2903.86'))).toBe(131);
  expect(versaoDoWebView2('Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36')).toBeNull();
  expect(versaoDoWebView2('')).toBeNull();
  expect(WEBVIEW2_MINIMO).toBe(131);
});

test('o chat antigo diz que precisa ser atualizado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  // O chat sem a operação do passe: 404 numa reunião que continua na lista.
  const passes = await passeAntigo(page);
  await abrir(page, pessoas[0]);
  await campo(page).fill(criada.link);
  await entrarDoCampo(page).click();
  await expect(alertaDoCampo(page)).toHaveText(ATUALIZAR);
  // O link do app diz o mesmo, no campo. O erro de antes ainda está na tela: espera o segundo pedido e o campo
  // com o link (o app o serve depois de decidir), senão o que vem a seguir se mistura com ele.
  await abrirReuniao(page, criada.codigo);
  await expect.poll(() => passes.pedidos()).toBe(2);
  await expect(campo(page)).toHaveValue(criada.link);
  await expect(alertaDoCampo(page)).toHaveText(ATUALIZAR);
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(await doTipo(page, 'videoWindow')).toEqual([]);
  // O que não é link, no campo, continua dizendo o dele.
  await campo(page).fill('texto qualquer');
  await campo(page).press('Enter');
  await expect(alertaDoCampo(page)).toHaveText(NAO_E_LINK);
});

test('dois links do app seguidos, com a aba à vista, entram cada um uma vez e nunca de novo', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const a = await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'A');
  const b = await marcar(pessoas[0].api, noRelogioDaPagina(0, 15, 0), 'B');
  const passes = await passeAntigo(page);
  await abrir(page, pessoas[0]);
  await abrirReuniao(page, a.codigo);
  await expect(campo(page)).toHaveValue(`${baseDoChat()}/r/${a.codigo}`);
  await expect.poll(() => passes.pedidos()).toBe(1);
  await expect(alertaDoCampo(page)).toHaveText(ATUALIZAR);
  await abrirReuniao(page, b.codigo);
  await expect(campo(page)).toHaveValue(`${baseDoChat()}/r/${b.codigo}`);
  await expect.poll(() => passes.pedidos()).toBe(2);
  // Sair da aba e voltar, sem link novo, não entra em nada.
  await page.locator('nav.nav button').first().click();
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toHaveCount(0);
  await page.locator('nav.nav button.tab-reunioes').click();
  await expect(campo(page)).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  await expect(campo(page)).toHaveValue('');
  expect(passes.pedidos()).toBe(2);
});

test('o link que inicia o app espera a primeira leitura e então entra', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const passes = await passeAntigo(page);
  await numerarAsLeituras(page, 2000);
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(page.locator('nav.nav button.tab-reunioes')).toHaveCount(0);
  await abrirReuniao(page, criada.codigo);
  await expect(page.locator('nav.nav button.tab-reunioes')).toBeVisible({ timeout: 15_000 });
  await expect(campo(page)).toHaveValue(criada.link);
  await expect(alertaDoCampo(page)).toHaveText(ATUALIZAR);
  expect(passes.pedidos()).toBe(1);
  await expect(page.locator('.toast-box')).toHaveCount(0);
});

test('o link do app com o chat ligado e as reuniões liberadas só na empresa diz para entrar pelo navegador', async ({
  page,
}) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await page.route(
    (url) => url.pathname === '/api/v1/reunioes',
    (rota) => rota.fulfill({ status: 403, json: { erro: 'semReunioes' } }),
  );
  const passes = await contarOsPasses(page);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await abrirReuniao(page, 'abcdefghjk');
  await expect(page.locator('.toast-box')).toHaveText(SEM_CHAT);
  await expect(page.locator('nav.nav button.tab-reunioes')).toHaveCount(0);
  expect(passes.pedidos()).toBe(0);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o link do app com a primeira leitura falhando diz que o servidor não respondeu', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await page.route(
    (url) => url.pathname === '/api/v1/reunioes',
    (rota) => rota.fulfill({ status: 503, json: { erro: 'servidor' } }),
  );
  const passes = await contarOsPasses(page);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await abrirReuniao(page, 'abcdefghjk');
  await expect(page.locator('.toast-box')).toHaveText(NAO_RESPONDEU);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  expect(passes.pedidos()).toBe(0);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o link do app com o campo ocupado espera o pedido dele e depois entra', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const a = await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'A');
  const b = await marcar(pessoas[0].api, noRelogioDaPagina(0, 15, 0), 'B');
  let n = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(ePasse, async (rota) => {
    n += 1;
    if (n === 1) await solto;
    return rota.fulfill({ status: 404, json: { erro: 'naoEncontrado' } });
  });
  await abrir(page, pessoas[0]);
  await campo(page).fill(a.codigo);
  await campo(page).press('Enter');
  await expect.poll(() => n).toBe(1);
  await abrirReuniao(page, b.codigo);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  expect(n).toBe(1);
  soltar();
  await expect(campo(page)).toHaveValue(`${baseDoChat()}/r/${b.codigo}`);
  await expect.poll(() => n).toBe(2);
  await expect(alertaDoCampo(page)).toHaveText(ATUALIZAR);
});

test.describe('o WebView2 antigo, com uma ligação', () => {
  test.use({ userAgent: UA('130.0.2849.80') });

  test('o link do app diz o erro do caminho do navegador', async ({ page }) => {
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    const criada = await marcarHoje(pessoas[0].api);
    const passes = await passeAntigo(page);
    await abrir(page, pessoas[0]);
    await mudarEstado(page, (s) => ({ ...s, ligacao: LIGACAO }));
    await abrirReuniao(page, criada.codigo);
    await expect.poll(() => passes.pedidos()).toBe(1);
    await expect(page.locator('.toast-box')).toHaveText(ATUALIZAR);
    expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  });
});

test('o link do app espera no máximo 30 s a conta do telefone, e então diz o sem chat', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const passes = await passeAntigo(page);
  await page.clock.install({ time: meioDiaDeHoje() });
  // O chat fica em `precisaConta`: a conta do telefone ainda não conectou.
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta' });
  await pararORelogio(page);
  await abrirReuniao(page, criada.codigo);
  // O app trata a mensagem antes de o relógio andar (as mensagens vão em ordem pelo mesmo canal).
  await page.evaluate(() => 0);
  await page.clock.runFor(29_000);
  await expect(page.locator('.toast-box')).toHaveCount(0);
  await page.clock.runFor(2_000);
  await expect(page.locator('.toast-box')).toHaveText(SEM_CHAT);
  // A conta conecta depois: o link foi largado de vez, e nada entra sozinho.
  await mudarEstado(page, (s) => ({ ...s, chat: { ...s.chat, contaConectada: true } }));
  await page.clock.runFor(5_000);
  await page.evaluate(() => 0);
  expect(passes.pedidos()).toBe(0);
  expect(await doTipo(page, 'videoWindow')).toEqual([]);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});
