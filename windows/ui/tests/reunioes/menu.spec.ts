// O "Copiar link" de cada linha, o menu de uma reunião e o cancelar (Task 9, as telas 1, 2 e 5): o link copiado e o
// "Link copiado" por 2 s, o menu com até quando o link vale, o Copiar link do menu no tamanho Mínimo, a pergunta do
// cancelar (com o assunto, a hora e quem sai), o Voltar, o cancelar que falha ou que já não tem o que cancelar e a
// acessibilidade nos dois temas. As reuniões são criadas pela ApiDeTeste, com as horas do relógio da página
// (noRelogioDaPagina).
import { expect, test, type Page, type Route } from '@playwright/test';
import { capturar, semViolacoesSerias } from '../helpers';
import { pararORelogio } from '../chat/abrir';
import { empresaComReunioes, type ApiDeTeste } from '../chat/servidor';
import { abrirNasReunioes, meioDiaDeHoje, noRelogioDaPagina } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true, permissions: ['clipboard-read', 'clipboard-write'] });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const LISTA = '/api/v1/reunioes';
const PLANEJAMENTO = 'Planejamento de dezembro';
const FALHA = 'O servidor do chat não respondeu. Tente de novo.';

const linhas = (page: Page) => page.getByRole('article');
const botaoCopiar = (page: Page) => page.getByRole('button', { name: 'Copiar link' });
const botaoCopiado = (page: Page) => page.getByRole('button', { name: 'Link copiado' });
const botaoMais = (page: Page, assunto = PLANEJAMENTO) =>
  page.getByRole('button', { name: `Mais opções de ${assunto}` });
const menu = (page: Page, assunto = PLANEJAMENTO) => page.getByRole('menu', { name: `Opções de ${assunto}` });
const itemAbrir = (page: Page) => page.getByRole('menuitem', { name: 'Abrir no navegador' });
const itemCancelar = (page: Page) => page.getByRole('menuitem', { name: 'Cancelar a reunião' });
const pergunta = (page: Page) => page.getByRole('alertdialog', { name: 'Cancelar a reunião?' });
const voltar = (page: Page) => pergunta(page).getByRole('button', { name: 'Voltar' });
const cancelarNoDialogo = (page: Page) => pergunta(page).getByRole('button', { name: 'Cancelar a reunião' });
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
const eOCancelar = (url: URL) => url.pathname.startsWith(`${LISTA}/`) && url.pathname.split('/').length === 5;

/** Marca uma reunião de hoje, às 14:00, com o link valendo até 23:59 (no relógio da página). */
async function marcarHoje(api: ApiDeTeste, assunto?: string): Promise<{ codigo: string; link: string }> {
  const corpo = {
    ...(assunto === undefined ? {} : { assunto }),
    inicio: noRelogioDaPagina(0, 14, 0),
    valeAte: noRelogioDaPagina(0, 23, 59),
  };
  const r = await api.pedir('POST', LISTA, corpo);
  if (r.status !== 201) throw new Error(`marcar respondeu ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json.reuniao;
}

/** Abre o app nas Reuniões com a hora da página fixa no meio-dia (os timers andam). */
async function abrir(page: Page, pessoa: { chave: string }): Promise<void> {
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO });
}

/** Troca o que o GET /reunioes diz da primeira reunião (acontecendo, com tantas pessoas). */
async function acontecendoCom(page: Page, pessoas: number): Promise<void> {
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota: Route) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      const resposta = await rota.fetch();
      const json = await resposta.json();
      json.reunioes[0].acontecendo = true;
      json.reunioes[0].pessoas = pessoas;
      await rota.fulfill({ response: resposta, json });
    },
  );
}

test('o Copiar link copia o link e diz Link copiado por 2 s', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await page.clock.install({ time: meioDiaDeHoje() });
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await pararORelogio(page);
  await expect(linhas(page)).toHaveCount(1);
  await expect(botaoCopiar(page)).toBeVisible();
  await botaoCopiar(page).click();
  await expect(botaoCopiado(page)).toBeVisible();
  await expect(botaoCopiar(page)).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(criada.link);
  await page.clock.runFor(1_900);
  await expect(botaoCopiado(page)).toBeVisible();
  await page.clock.runFor(200);
  await expect(botaoCopiar(page)).toBeVisible();
  await expect(botaoCopiado(page)).toHaveCount(0);
});

test('o menu diz até quando o link vale e tem o Cancelar a reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  await expect(linhas(page)).toHaveCount(1);
  await expect(menu(page)).toHaveCount(0);
  await expect(botaoMais(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(botaoMais(page)).toHaveAttribute('aria-expanded', 'false');
  await botaoMais(page).click();
  await expect(botaoMais(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByText('O link vale até hoje, 23:59', { exact: true })).toBeVisible();
  // A linha da validade é um texto, não um item.
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Abrir no navegador', 'Cancelar a reunião']);
  // O foco começa no primeiro item; as setas e o Home/End andam entre os itens.
  await expect(itemAbrir(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(itemCancelar(page)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(itemAbrir(page)).toBeFocused();
  await page.keyboard.press('End');
  await expect(itemCancelar(page)).toBeFocused();
  // O Esc fecha e devolve o foco ao botão.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(botaoMais(page)).toBeFocused();
  // O Enter no item abre a pergunta.
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  // O foco vai ao primeiro item depois do desenho: o Enter só vale com ele lá (no botão, o Enter fecharia o menu).
  await expect(itemAbrir(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(itemCancelar(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  await expect(pergunta(page)).toBeVisible();
});

test('o menu fecha com um clique fora', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  await expect(menu(page)).toBeVisible();
  await page.getByRole('heading', { name: 'Reuniões', level: 1 }).click();
  await expect(menu(page)).toHaveCount(0);
});

test('a reunião sem assunto tem o botão e o menu com o nome dela', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  await botaoMais(page, 'Reunião sem assunto').click();
  await expect(menu(page, 'Reunião sem assunto')).toBeVisible();
});

test('no tamanho Mínimo, o Copiar link é do menu', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await page.setViewportSize({ width: 300, height: 440 });
  await abrir(page, pessoas[0]);
  await expect(linhas(page)).toHaveCount(1);
  // Sem o botão na linha.
  await expect(botaoCopiar(page)).toHaveCount(0);
  await botaoMais(page).click();
  await expect(menu(page).getByRole('menuitem')).toHaveText([
    'Entrar',
    'Copiar link',
    'Abrir no navegador',
    'Cancelar a reunião',
  ]);
  // O primeiro item é o Entrar (a Task 3 do plano 3b); o Copiar link é o segundo.
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Copiar link' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(criada.link);
  await expect(linhas(page).first().getByRole('status')).toHaveText('Link copiado');
  // A linha cabe no tamanho Mínimo.
  const caixa = (await linhas(page).first().boundingBox())!;
  expect(caixa.x + caixa.width).toBeLessThanOrEqual(300);
  // Nos outros tamanhos, o menu não tem o Copiar link.
  await page.setViewportSize({ width: 400, height: 720 });
  await expect(botaoCopiar(page).or(botaoCopiado(page))).toHaveCount(1);
  await botaoMais(page).click();
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Abrir no navegador', 'Cancelar a reunião']);
});

test('o cancelar pergunta antes, com o assunto e a hora', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await expect(pergunta(page)).toBeVisible();
  await expect(pergunta(page).getByRole('heading', { name: 'Cancelar a reunião?' })).toBeVisible();
  await expect(pergunta(page).getByText(`${PLANEJAMENTO} · hoje, 14:00`, { exact: true })).toBeVisible();
  await expect(pergunta(page).getByText('O link para de valer na hora.', { exact: true })).toBeVisible();
  await expect(pergunta(page)).toHaveAccessibleDescription('O link para de valer na hora.');
  await expect(pergunta(page).getByRole('button')).toHaveText(['Voltar', 'Cancelar a reunião']);
  await expect(voltar(page)).toBeFocused();
  await expect(pergunta(page).getByRole('alert')).toHaveCount(0);
});

test('com a reunião acontecendo, o cancelar diz quantas pessoas saem', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await acontecendoCom(page, 3);
  await abrir(page, pessoas[0]);
  await expect(page.getByText('Acontecendo · 3 pessoas')).toBeVisible();
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await expect(
    pergunta(page).getByText('O link para de valer na hora. Como a reunião está acontecendo, as 3 pessoas saem.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('com uma pessoa na reunião, o cancelar diz que a pessoa sai', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await acontecendoCom(page, 1);
  await abrir(page, pessoas[0]);
  await expect(page.getByText('Acontecendo · 1 pessoa')).toBeVisible();
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await expect(
    pergunta(page).getByText(
      'O link para de valer na hora. Como a reunião está acontecendo, a pessoa que está nela sai.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('o Voltar e o Esc deixam a reunião, e o foco volta ao botão do menu', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  for (const sair of ['Voltar', 'Esc']) {
    await botaoMais(page).click();
    await itemCancelar(page).click();
    await expect(pergunta(page)).toBeVisible();
    if (sair === 'Voltar') await voltar(page).click();
    else await page.keyboard.press('Escape');
    await expect(pergunta(page)).toHaveCount(0);
    await expect(botaoMais(page)).toBeFocused();
    await expect(linhas(page)).toHaveCount(1);
  }
  const lida = await pessoas[0].api.pedir('GET', LISTA);
  expect(lida.json.reunioes).toHaveLength(1);
});

test('o Cancelar a reunião tira a reunião da lista, e só ela', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await marcarHoje(pessoas[0].api, 'Reunião com a contabilidade');
  await abrir(page, pessoas[0]);
  await expect(linhas(page)).toHaveCount(2);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(1);
  await expect(linhas(page).locator('.reun-assunto')).toHaveText(['Reunião com a contabilidade']);
  const lida = await pessoas[0].api.pedir('GET', LISTA);
  expect(lida.json.reunioes.map((r: { assunto: string }) => r.assunto)).toEqual(['Reunião com a contabilidade']);
});

test('o cancelar feito pelo teclado deixa o foco no Nova reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  await botaoMais(page).focus();
  await page.keyboard.press('Enter');
  await itemCancelar(page).focus();
  await page.keyboard.press('Enter');
  await expect(voltar(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancelarNoDialogo(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pergunta(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova reunião' }).first()).toBeFocused();
});

test('o cancelar que falha fica aberto e diz O servidor do chat não respondeu', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  let derrubar = true;
  await page.route(eOCancelar, async (rota: Route) => {
    if (rota.request().method() === 'DELETE' && derrubar) return rota.abort();
    return rota.continue();
  });
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page).getByRole('alert')).toHaveText(FALHA);
  await expect(pergunta(page)).toBeVisible();
  await expect(cancelarNoDialogo(page)).toBeEnabled();
  expect((await pessoas[0].api.pedir('GET', LISTA)).json.reunioes).toHaveLength(1);
  // De novo, com o servidor de volta: o erro sai e a reunião é cancelada.
  derrubar = false;
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(0);
});

test('um erro 5xx e o 429 também ficam no diálogo', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  let status = 503;
  await page.route(eOCancelar, async (rota: Route) => {
    if (rota.request().method() !== 'DELETE') return rota.continue();
    return rota.fulfill({ status, json: { erro: status === 429 ? 'muitasTentativas' : 'indisponivel' } });
  });
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page).getByRole('alert')).toHaveText(FALHA);
  status = 429;
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page).getByRole('alert')).toHaveText(FALHA);
  await expect(pergunta(page)).toBeVisible();
  expect((await pessoas[0].api.pedir('GET', LISTA)).json.reunioes).toHaveLength(1);
});

test('enquanto o pedido está no ar, o Cancelar a reunião fica desligado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  let pedidos = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(eOCancelar, async (rota: Route) => {
    if (rota.request().method() !== 'DELETE') return rota.continue();
    pedidos += 1;
    await solto;
    return rota.continue();
  });
  await abrir(page, pessoas[0]);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await cancelarNoDialogo(page).click();
  await expect.poll(() => pedidos).toBe(1);
  await expect(cancelarNoDialogo(page)).toBeDisabled();
  await cancelarNoDialogo(page).click({ force: true });
  soltar();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(0);
  expect(pedidos).toBe(1);
});

test('a reunião que já não existe sai da lista sem erro', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  await abrir(page, pessoas[0]);
  await expect(linhas(page)).toHaveCount(1);
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await expect(pergunta(page)).toBeVisible();
  // Alguém a cancela antes do clique.
  const feito = await pessoas[0].api.pedir('DELETE', `${LISTA}/${criada.codigo}`);
  expect(feito.status).toBeLessThan(300);
  await cancelarNoDialogo(page).click();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(0);
});

test('nada do menu e do cancelar vai ao console', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api, PLANEJAMENTO);
  const mensagens: string[] = [];
  page.on('console', (m) => {
    if (!m.text().startsWith('Failed to load resource')) mensagens.push(m.text());
  });
  page.on('pageerror', (e) => mensagens.push(e.message));
  await abrir(page, pessoas[0]);
  await botaoCopiar(page).click();
  await expect(botaoCopiado(page)).toBeVisible();
  await botaoMais(page).click();
  await itemCancelar(page).click();
  await cancelarNoDialogo(page).click();
  await expect(linhas(page)).toHaveCount(0);
  expect(mensagens).toEqual([]);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o menu e o cancelar (${nomeDoTema(tema)})`, () => {
    test.use({ colorScheme: tema });

    test(`o menu e o cancelar não têm violações sérias (${tema})`, async ({ page }) => {
      const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
      await marcarHoje(pessoas[0].api, PLANEJAMENTO);
      await acontecendoCom(page, 3);
      await abrir(page, pessoas[0]);
      await expect(linhas(page)).toHaveCount(1);
      await semViolacoesSerias(page);
      await botaoMais(page).click();
      await expect(menu(page)).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'reunioes-menu', nomeDoTema(tema));
      await itemCancelar(page).click();
      await expect(pergunta(page)).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'reunioes-cancelar', nomeDoTema(tema));
      // A falha dentro do diálogo.
      await page.route(eOCancelar, (rota: Route) => rota.abort());
      await cancelarNoDialogo(page).click();
      await expect(pergunta(page).getByRole('alert')).toHaveText(FALHA);
      await semViolacoesSerias(page);
    });
  });
}
