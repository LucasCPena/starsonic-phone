// O "Abrir no navegador" do menu da reunião e do campo do link (Task 10, a tela 1): o app pede o passe como a pessoa da
// vez e manda o reuniaoNavegador com o código e o passe; a outra empresa abre sem o passe; cada erro diz a sua frase; o
// passe não aparece no console, na tela nem em outro comando; a troca de pessoa no meio não abre nada; um pedido por
// código de cada vez; a acessibilidade nos dois temas. O passe é de verdade: a página da reunião o aceita.
import { expect, test, type Page, type Route } from '@playwright/test';
import { capturar, comandos, semViolacoesSerias, type Comando } from '../helpers';
import { baseDoChat, empresaComReunioes, type ApiDeTeste } from '../chat/servidor';
import { abrirNasReunioes, meioDiaDeHoje, noRelogioDaPagina } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
/** A segunda conta do cenário chat-duas-contas. */
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const LISTA = '/api/v1/reunioes';
const FORMATO_DO_PASSE = /^[A-Za-z0-9_-]{43}$/;
const NAO_E_LINK = 'Este não é um link de reunião do Starsonic.';
const OUTRA_EMPRESA = 'Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.';
const SEM_VALOR = 'Este link não vale mais';
const ATUALIZAR = 'O servidor do chat precisa ser atualizado para abrir reuniões pelo app.';
const MUITAS = 'Muitas tentativas. Espere um pouco para tentar de novo.';
const NAO_RESPONDEU = 'O servidor do chat não respondeu. Tente de novo.';

const campo = (page: Page) => page.getByRole('textbox', { name: 'Entrar com o link de uma reunião' });
const abrirNoNavegador = (page: Page) => page.getByRole('button', { name: 'Abrir no navegador' });
// O alerta do campo (as linhas têm o delas, sempre montado).
const alerta = (page: Page) => page.locator('.reun-link').getByRole('alert');
const botaoMais = (page: Page) => page.getByRole('button', { name: `Mais opções de ${PLANEJAMENTO}` });
const menu = (page: Page) => page.getByRole('menu', { name: `Opções de ${PLANEJAMENTO}` });
const itemDoMenu = (page: Page) => menu(page).getByRole('menuitem', { name: 'Abrir no navegador' });
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
const ePasse = (url: URL) => url.pathname.endsWith('/passe');

/** Os comandos reuniaoNavegador que a ponte recebeu. */
async function doNavegador(page: Page): Promise<Comando[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador');
}

/** Marca uma reunião de hoje, às 14:00, com o link valendo até 23:59 (no relógio da página). */
async function marcarHoje(api: ApiDeTeste) {
  const corpo = {
    assunto: PLANEJAMENTO,
    inicio: noRelogioDaPagina(0, 14, 0),
    valeAte: noRelogioDaPagina(0, 23, 59),
  };
  const r = await api.pedir('POST', LISTA, corpo);
  if (r.status !== 201) throw new Error(`marcar respondeu ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json.reuniao as { codigo: string; link: string };
}

/** Abre o app nas Reuniões com a hora da página fixa no meio-dia (os timers andam). */
async function abrir(page: Page, pessoa: { chave: string }, extra: { cenario?: 'chat-duas-contas' } = {}) {
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO, ...extra });
}

/** O abrir da página da reunião com o passe (como o video-servidor/e2e): o colega vem reconhecido. */
async function abrirAPagina(codigo: string, passe: string): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseDoChat()}/api/v1/pagina/reunioes/${codigo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passe }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
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

test('o Abrir no navegador do menu pede o passe e manda o reuniaoNavegador', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  // O item vem antes do Cancelar a reunião, e a linha da validade continua um texto.
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Abrir no navegador', 'Cancelar a reunião']);
  await expect(itemDoMenu(page)).toBeFocused();
  await itemDoMenu(page).click();
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  const [comando] = await doNavegador(page);
  expect(Object.keys(comando).sort()).toEqual(['cmd', 'codigo', 'passe', 'v']);
  expect(comando.codigo).toBe(criada.codigo);
  expect(comando.passe).toMatch(FORMATO_DO_PASSE);
  // O passe é de verdade: a página da reunião o aceita e reconhece a pessoa.
  const aberta = await abrirAPagina(criada.codigo, comando.passe as string);
  expect(aberta.status).toBe(200);
  expect(aberta.json.colega.nome).toBe(RECEPCAO.nome);
  // Nenhum aviso: deu certo.
  await expect(page.locator('.toast-box')).toHaveCount(0);
});

test('o campo aceita o link inteiro e só o código', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  await expect(campo(page)).toHaveAttribute('placeholder', 'Cole aqui o link de uma reunião');
  // Sem texto, sem botão.
  await expect(abrirNoNavegador(page)).toHaveCount(0);
  // O link inteiro, com o botão.
  await campo(page).fill(criada.link);
  await abrirNoNavegador(page).click();
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  // Deu certo: o campo esvazia e o botão some.
  await expect(campo(page)).toHaveValue('');
  await expect(abrirNoNavegador(page)).toHaveCount(0);
  // Só o código, com o Enter no campo (e em maiúsculas: o código é lido em minúsculas).
  await campo(page).fill(criada.codigo.toUpperCase());
  await campo(page).press('Enter');
  await expect.poll(async () => (await doNavegador(page)).length).toBe(2);
  await expect(campo(page)).toHaveValue('');
  const comandosDoNavegador = await doNavegador(page);
  for (const c of comandosDoNavegador) {
    expect(c.codigo).toBe(criada.codigo);
    expect(c.passe).toMatch(FORMATO_DO_PASSE);
  }
  // Cada abrir pediu um passe novo.
  expect(comandosDoNavegador[0].passe).not.toBe(comandosDoNavegador[1].passe);
  await expect(alerta(page)).toHaveCount(0);
});

test('um texto que não é um link diz Este não é um link de reunião do Starsonic, sem pedir nada', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api);
  let pedidos = 0;
  await page.route(ePasse, (rota) => {
    pedidos += 1;
    return rota.continue();
  });
  await abrir(page, pessoas[0]);
  await campo(page).fill('https://exemplo.com/r/abcdefghjk');
  await abrirNoNavegador(page).click();
  await expect(alerta(page)).toHaveText(NAO_E_LINK);
  await campo(page).fill('qualquer coisa');
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(NAO_E_LINK);
  // Mexer no texto tira o erro.
  await campo(page).fill('qualquer coisa 2');
  await expect(alerta(page)).toHaveCount(0);
  await page.evaluate(() => 0);
  expect(pedidos).toBe(0);
  expect(await doNavegador(page)).toEqual([]);
});

test('a reunião de outra empresa oferece o navegador sem o passe', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const outra = await empresaComReunioes('Outra Empresa Ltda', [{ ramal: '3001', nome: 'Carla' }]);
  const delaCriada = await marcarHoje(outra.pessoas[0].api);
  // A primeira vez vai ao servidor (o 403 de verdade); as seguintes, o page.route as responde (o limite do endereço).
  let pedidos = 0;
  await page.route(ePasse, (rota) => {
    pedidos += 1;
    if (pedidos === 1) return rota.continue();
    return rota.fulfill({ status: 403, json: { erro: 'outraEmpresa' } });
  });
  await abrir(page, pessoas[0]);
  await campo(page).fill(delaCriada.link);
  await abrirNoNavegador(page).click();
  await expect(alerta(page)).toHaveText(OUTRA_EMPRESA);
  // Nada foi aberto ainda, e o texto continua no campo.
  expect(await doNavegador(page)).toEqual([]);
  await expect(campo(page)).toHaveValue(delaCriada.link);
  // O botão do erro abre como convidado: o comando não tem a chave passe.
  await abrirNoNavegador(page).click();
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  expect(await doNavegador(page)).toEqual([{ v: 1, cmd: 'reuniaoNavegador', codigo: delaCriada.codigo }]);
  await expect(campo(page)).toHaveValue('');
  await expect(alerta(page)).toHaveCount(0);
  expect(pedidos).toBe(1);
  // O Enter no campo faz o que o botão à vista faz: com o erro da outra empresa, abre como convidado, sem outro passe.
  await campo(page).fill(delaCriada.codigo);
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(OUTRA_EMPRESA);
  expect(pedidos).toBe(2);
  await campo(page).press('Enter');
  await expect.poll(async () => (await doNavegador(page)).length).toBe(2);
  expect((await doNavegador(page))[1]).toEqual({ v: 1, cmd: 'reuniaoNavegador', codigo: delaCriada.codigo });
  expect(pedidos).toBe(2);
  await expect(campo(page)).toHaveValue('');
});

test('o link que não vale mais diz Este link não vale mais', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  await expect(page.getByRole('article')).toHaveCount(1);
  // Uma reunião cancelada por outro lado, que a lista do app ainda mostra: o 404 relê a lista, e ela sumiu.
  expect((await pessoas[0].api.pedir('DELETE', `${LISTA}/${criada.codigo}`)).status).toBe(204);
  await campo(page).fill(criada.codigo);
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(SEM_VALOR);
  await expect(page.getByRole('article')).toHaveCount(0);
  // Um código que nunca foi de uma reunião: o mesmo (o page.route responde o 404, sem gastar o limite do endereço).
  await page.route(ePasse, (rota) => rota.fulfill({ status: 404, json: { erro: 'naoEncontrado' } }));
  await campo(page).fill('abcdefghjk');
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(SEM_VALOR);
  expect(await doNavegador(page)).toEqual([]);
});

test('o servidor antigo diz que precisa ser atualizado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api);
  // O chat sem a operação do passe: 404 numa reunião que continua na lista.
  await page.route(ePasse, (rota) => rota.fulfill({ status: 404, json: { erro: 'naoEncontrado' } }));
  await abrir(page, pessoas[0]);
  // O menu diz no aviso curto do app.
  await botaoMais(page).click();
  await itemDoMenu(page).click();
  await expect(page.locator('.toast-box')).toHaveText(ATUALIZAR);
  await expect(page.getByRole('article')).toHaveCount(1);
  // O campo diz embaixo dele.
  const link = (await pessoas[0].api.pedir('GET', LISTA)).json.reunioes[0].link;
  await campo(page).fill(link);
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(ATUALIZAR);
  expect(await doNavegador(page)).toEqual([]);
});

test('as muitas tentativas e o servidor que não responde dizem cada um a sua frase', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  let modo: '429' | 'cair' | 'segue' = '429';
  await page.route(ePasse, (rota) => {
    if (modo === '429') return rota.fulfill({ status: 429, json: { erro: 'tentativas', esperarSegundos: 30 } });
    if (modo === 'cair') return rota.abort();
    return rota.continue();
  });
  await abrir(page, pessoas[0]);
  await campo(page).fill(criada.codigo);
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(MUITAS);
  modo = 'cair';
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(NAO_RESPONDEU);
  // Um 5xx diz o mesmo.
  await page.unroute(ePasse);
  await page.route(ePasse, (rota) => rota.fulfill({ status: 503, json: { erro: 'servidor' } }));
  await campo(page).press('Enter');
  await expect(alerta(page)).toHaveText(NAO_RESPONDEU);
  expect(await doNavegador(page)).toEqual([]);
  // O texto continua no campo para tentar de novo, e com o servidor de volta dá certo.
  await expect(campo(page)).toHaveValue(criada.codigo);
  await page.unroute(ePasse);
  modo = 'segue';
  await campo(page).press('Enter');
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  await expect(alerta(page)).toHaveCount(0);
});

test('o passe não aparece no console, na tela nem em outro comando', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  const mensagens: string[] = [];
  page.on('console', (m) => {
    if (!m.text().startsWith('Failed to load resource')) mensagens.push(m.text());
  });
  page.on('pageerror', (e) => mensagens.push(e.message));
  await abrir(page, pessoas[0]);
  await campo(page).fill(criada.link);
  await abrirNoNavegador(page).click();
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  await botaoMais(page).click();
  await itemDoMenu(page).click();
  await expect.poll(async () => (await doNavegador(page)).length).toBe(2);
  const passes = (await doNavegador(page)).map((c) => c.passe as string);
  expect(passes).toHaveLength(2);
  for (const passe of passes) {
    expect(passe).toMatch(FORMATO_DO_PASSE);
    expect(mensagens.filter((m) => m.includes(passe))).toEqual([]);
    expect(await page.content()).not.toContain(passe);
    // Nem na tela (um campo, um atributo), nem numa chave do que a página guardou.
    expect(await page.evaluate((p) => document.documentElement.outerHTML.includes(p), passe)).toBe(false);
    const guardado = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(guardado).not.toContain(passe);
    // No window.__comandos, só o reuniaoNavegador o tem.
    const comPasse = (await comandos(page)).filter((c) => JSON.stringify(c).includes(passe));
    expect(comPasse).toHaveLength(1);
    expect(comPasse[0].cmd).toBe('reuniaoNavegador');
  }
  expect(mensagens).toEqual([]);
});

test('a troca de pessoa no meio do pedido não abre nada', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO, CAIXA]);
  const criada = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0], { cenario: 'chat-duas-contas' });
  await expect(page.getByRole('article')).toHaveCount(1);
  const segurado = await segurarOPasse(page);
  const resposta = page.waitForResponse((r) => ePasse(new URL(r.url())));
  await campo(page).fill(criada.codigo);
  await campo(page).press('Enter');
  await expect.poll(() => segurado.pedidos()).toBe(1);
  await page.getByRole('button', { name: /Trocar de conta/ }).click();
  await page.getByRole('menuitemradio', { name: /Caixa 2/ }).click();
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  segurado.soltar();
  expect((await resposta).status()).toBe(200);
  // O app trata a resposta, e ela não vale mais: nenhum comando, nenhum aviso.
  await page.evaluate(() => 0);
  await page.evaluate(() => 0);
  expect(await doNavegador(page)).toEqual([]);
  await expect(page.locator('.toast-box')).toHaveCount(0);
  await expect(alerta(page)).toHaveCount(0);
});

test('um segundo clique com o pedido no ar não pede outro passe', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  const segurado = await segurarOPasse(page);
  await campo(page).fill(criada.codigo);
  await abrirNoNavegador(page).click();
  await expect.poll(() => segurado.pedidos()).toBe(1);
  // O botão espera, o Enter no campo e o item do menu da mesma reunião também.
  await expect(abrirNoNavegador(page)).toBeDisabled();
  await campo(page).press('Enter');
  await botaoMais(page).click();
  await itemDoMenu(page).click();
  await page.evaluate(() => 0);
  expect(segurado.pedidos()).toBe(1);
  segurado.soltar();
  await expect.poll(async () => (await doNavegador(page)).length).toBe(1);
  await page.evaluate(() => 0);
  expect(await doNavegador(page)).toHaveLength(1);
  expect(segurado.pedidos()).toBe(1);
  // Terminado o pedido, um novo é permitido.
  await campo(page).fill(criada.codigo);
  await campo(page).press('Enter');
  await expect.poll(async () => (await doNavegador(page)).length).toBe(2);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o campo do link (${nomeDoTema(tema)})`, () => {
    test.use({ colorScheme: tema });

    test(`o campo do link e os erros dele não têm violações sérias (${tema})`, async ({ page }) => {
      const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
      await marcarHoje(pessoas[0].api);
      // O 403 vem do page.route: o limite de falhas do endereço é de todos os testes da rodada.
      await page.route(ePasse, (rota) => rota.fulfill({ status: 403, json: { erro: 'outraEmpresa' } }));
      await abrir(page, pessoas[0]);
      await expect(campo(page)).toBeVisible();
      await semViolacoesSerias(page);
      await campo(page).fill('abcdefghjk');
      await expect(abrirNoNavegador(page)).toBeVisible();
      await capturar(page, 'reunioes-link', nomeDoTema(tema));
      await campo(page).fill('texto qualquer');
      await expect(abrirNoNavegador(page)).toBeVisible();
      await semViolacoesSerias(page);
      await campo(page).press('Enter');
      await expect(alerta(page)).toHaveText(NAO_E_LINK);
      await semViolacoesSerias(page);
      await campo(page).fill('abcdefghjk');
      await campo(page).press('Enter');
      await expect(alerta(page)).toHaveText(OUTRA_EMPRESA);
      await expect(abrirNoNavegador(page)).toBeVisible();
      await semViolacoesSerias(page);
    });
  });
}
