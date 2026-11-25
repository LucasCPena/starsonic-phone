// A aba Reuniões (Task 7): a sexta aba (Ctrl+6), só com as reuniões liberadas e depois da primeira resposta do chat; a
// lista (o assunto, o dia e a hora, o Acontecendo); a primeira vez; a falta de conexão; as leituras a cada 30 s com a
// aba à vista; a meia-noite; o semReunioes; a troca de pessoa; a acessibilidade e os três tamanhos da janela. As
// reuniões são criadas pela ApiDeTeste, com as horas do relógio da página (noRelogioDaPagina).
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacoesSerias } from '../helpers';
import { abrirNoChat, pararORelogio } from '../chat/abrir';
import { empresaComPessoas, empresaComReunioes, liberarReunioes } from '../chat/servidor';
import { abrirNasReunioes, anoNaPagina, diaDaLista, marcar, meioDiaDeHoje, noRelogioDaPagina } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
/** A segunda conta do cenário chat-duas-contas. */
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const LISTA = '/api/v1/reunioes';
const SEM_CONEXAO = 'Sem conexão com o chat. As reuniões voltam quando a conexão voltar.';

const abas = (page: Page) => page.locator('nav.nav button.tab');
const abaReunioes = (page: Page) => page.locator('nav.nav button.tab-reunioes');
const titulo = (page: Page) => page.getByRole('heading', { name: 'Reuniões', level: 1 });
const linhas = (page: Page) => page.getByRole('article');
const eAListaDasReunioes = (url: URL) => url.pathname === LISTA;
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

/** O dia por extenso como o leitor de tela o lê: "quinta-feira, 26 de novembro". */
const porExtenso = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(ms);

test('a aba Reuniões é a sexta, com o Ctrl+6, e só com as reuniões liberadas', async ({ page }) => {
  const sem = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  await abrirNoChat(page, { chave: sem.pessoas[0].chave, ...RECEPCAO });
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat']);

  const com = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await abrirNoChat(page, { chave: com.pessoas[0].chave, ...RECEPCAO });
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat', 'Reuniões']);
  await expect(abaReunioes(page)).toHaveAttribute('aria-keyshortcuts', 'Control+6');
  await expect(abaReunioes(page)).not.toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+6');
  await expect(abaReunioes(page)).toHaveAttribute('aria-current', 'page');
  await expect(titulo(page)).toBeVisible();
  await expect(page.getByText('As que você marcou', { exact: true })).toBeVisible();
});

test('a aba só aparece depois da primeira resposta do chat', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  let seguradas = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(eAListaDasReunioes, async (rota: Route) => {
    seguradas += 1;
    await solto;
    await rota.continue();
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect.poll(() => seguradas).toBeGreaterThan(0);
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat']);
  soltar();
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat', 'Reuniões']);
});

test('a lista mostra o assunto, o dia e a hora, da mais cedo para a mais tarde', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const api = pessoas[0].api;
  const hoje = noRelogioDaPagina(0, 14, 0);
  const amanha = noRelogioDaPagina(1, 9, 30);
  const depois = noRelogioDaPagina(3, 16, 0);
  // Fora de ordem: a ordem da tela é a do servidor.
  await marcar(api, depois);
  await marcar(api, hoje, 'Planejamento de dezembro');
  await marcar(api, amanha, 'Reunião com a contabilidade');
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });

  await expect(linhas(page)).toHaveCount(3);
  await expect(linhas(page).locator('.reun-assunto')).toHaveText([
    'Planejamento de dezembro',
    'Reunião com a contabilidade',
    'Reunião sem assunto',
  ]);
  await expect(linhas(page).locator('.reun-quando')).toHaveText([
    'Hoje, 14:00',
    'Amanhã, 09:30',
    `${diaDaLista(depois)}, 16:00`,
  ]);
  const ano = anoNaPagina(depois) === anoNaPagina(meioDiaDeHoje()) ? '' : ` de ${anoNaPagina(depois)}`;
  await expect(linhas(page).nth(0)).toHaveAccessibleName('Planejamento de dezembro, hoje às 14:00');
  await expect(linhas(page).nth(1)).toHaveAccessibleName('Reunião com a contabilidade, amanhã às 09:30');
  await expect(linhas(page).nth(2)).toHaveAccessibleName(`Reunião sem assunto, ${porExtenso(depois)}${ano}, às 16:00`);
  await expect(page.getByText('Nenhuma reunião marcada')).toHaveCount(0);
});

test('o Acontecendo aparece com alguém na reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'Planejamento de dezembro');
  await marcar(pessoas[0].api, noRelogioDaPagina(1, 9, 30), 'Reunião com a contabilidade');
  await page.route(eAListaDasReunioes, async (rota) => {
    const resposta = await rota.fetch();
    const json = await resposta.json();
    json.reunioes[0] = { ...json.reunioes[0], acontecendo: true, pessoas: 3 };
    json.reunioes[1] = { ...json.reunioes[1], acontecendo: true, pessoas: 1 };
    await rota.fulfill({ response: resposta, json });
  });
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(linhas(page).locator('.reun-acontecendo')).toHaveText([
    'Acontecendo · 3 pessoas',
    'Acontecendo · 1 pessoa',
  ]);
  await expect(linhas(page).nth(0)).toHaveAccessibleName(
    'Planejamento de dezembro, hoje às 14:00, acontecendo agora com 3 pessoas',
  );
  await expect(linhas(page).nth(1)).toHaveAccessibleName(
    'Reunião com a contabilidade, amanhã às 09:30, acontecendo agora com 1 pessoa',
  );
});

test('a primeira vez mostra Nenhuma reunião marcada', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(page.getByRole('heading', { name: 'Nenhuma reunião marcada', level: 2 })).toBeVisible();
  const texto = page.locator('.reun-vazio-texto');
  await expect(texto).toHaveText(
    'Marque uma no Nova reunião e mande o link para quem vai participar. ' +
      'Os colegas entram direto, e quem é de fora pede para entrar.',
  );
  await expect(texto.locator('strong')).toHaveText('Nova reunião');
  await expect(linhas(page)).toHaveCount(0);
});

test('sem conexão com o chat, a aba diz isso no lugar da lista, e a lista volta sozinha', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'Planejamento de dezembro');
  await page.clock.install({ time: meioDiaDeHoje() });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(abaReunioes(page)).toBeVisible();
  await pararORelogio(page);

  await page.route(eAListaDasReunioes, (rota) => rota.abort());
  await abaReunioes(page).click();
  const frase = page.getByRole('status').filter({ hasText: SEM_CONEXAO });
  await expect(frase).toHaveText(SEM_CONEXAO);
  await expect(linhas(page)).toHaveCount(0);
  await expect(page.getByText('Nenhuma reunião marcada')).toHaveCount(0);

  await page.unroute(eAListaDasReunioes);
  await page.clock.runFor(30_000);
  await expect(linhas(page)).toHaveCount(1);
  await expect(frase).toHaveCount(0);
});

test('a lista é lida de novo a cada 30 s com a aba à vista, e não fora dela', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await page.clock.install({ time: meioDiaDeHoje() });
  let leituras = 0;
  await page.route(eAListaDasReunioes, async (rota) => {
    leituras += 1;
    await rota.continue();
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(abaReunioes(page)).toBeVisible();
  await pararORelogio(page);

  leituras = 0;
  await abaReunioes(page).click();
  await expect.poll(() => leituras).toBe(1);
  await page.clock.runFor(30_000);
  await expect.poll(() => leituras).toBe(2);

  await abas(page).first().click();
  await expect(titulo(page)).toHaveCount(0);
  await page.clock.runFor(60_000);
  // Dá tempo de um pedido que saísse errado chegar ao contador.
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  expect(leituras).toBe(2);

  await abaReunioes(page).click();
  await expect.poll(() => leituras).toBe(3);
});

test('à meia-noite, o Amanhã vira Hoje sem recarregar', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcar(pessoas[0].api, noRelogioDaPagina(1, 9, 30), 'Reunião com a contabilidade');
  // 23:59:50 de hoje, no relógio da página: a hora anda com o runFor.
  await page.clock.install({ time: noRelogioDaPagina(0, 23, 59) + 50_000 });
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await pararORelogio(page);
  await expect(linhas(page).locator('.reun-quando')).toHaveText(['Amanhã, 09:30']);
  await page.clock.runFor(40_000);
  await expect(linhas(page).locator('.reun-quando')).toHaveText(['Hoje, 09:30']);
});

test('a aba some com o semReunioes e volta quando a empresa é liberada', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await page.clock.install({ time: meioDiaDeHoje() });
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await pararORelogio(page);
  await expect(abas(page)).toHaveCount(6);

  await liberarReunioes(empresaId, false);
  await page.clock.runFor(30_000);
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat']);
  await expect(titulo(page)).toHaveCount(0);
  await expect(abas(page).first()).toHaveAttribute('aria-current', 'page');

  await liberarReunioes(empresaId);
  await page.clock.runFor(300_000);
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat', 'Reuniões']);
  // A tela não volta sozinha para as Reuniões: o Teclado continua sendo a aba de agora.
  await expect(abas(page).first()).toHaveAttribute('aria-current', 'page');
  await expect(titulo(page)).toHaveCount(0);
});

test('a troca de pessoa esquece a lista', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO, CAIXA]);
  await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'Planejamento de dezembro');
  await marcar(pessoas[1].api, noRelogioDaPagina(1, 9, 30), 'Reunião com a contabilidade');
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-duas-contas' });
  await expect(linhas(page).locator('.reun-assunto')).toHaveText(['Planejamento de dezembro']);

  let segurada = false;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(eAListaDasReunioes, async (rota) => {
    segurada = true;
    await solto;
    await rota.continue();
  });
  // Uma leitura da primeira pessoa que ficou no ar não pode ser a que segura: a rota entra depois da troca.
  await page.getByRole('button', { name: /Trocar de conta/ }).click();
  await page.getByRole('menuitemradio', { name: /Caixa 2/ }).click();
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await expect.poll(() => segurada).toBe(true);
  await expect(page.getByText('Planejamento de dezembro')).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(0);
  soltar();
  await expect(linhas(page).locator('.reun-assunto')).toHaveText(['Reunião com a contabilidade']);
  await expect(page.getByText('Planejamento de dezembro')).toHaveCount(0);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a aba Reuniões (${nomeDoTema(tema)})`, () => {
    test.use({ colorScheme: tema });

    test(`a aba não tem violações sérias (${tema})`, async ({ page }) => {
      const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
      await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'Planejamento de dezembro');
      await marcar(pessoas[0].api, noRelogioDaPagina(1, 9, 30), 'Reunião com a contabilidade');
      await page.clock.setFixedTime(meioDiaDeHoje());
      await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await expect(linhas(page)).toHaveCount(2);
      await semViolacoesSerias(page);

      // A primeira vez e a falta de conexão.
      const vazia = await empresaComReunioes(EMPRESA, [RECEPCAO]);
      await abrirNasReunioes(page, { chave: vazia.pessoas[0].chave, ...RECEPCAO });
      await expect(page.getByRole('heading', { name: 'Nenhuma reunião marcada' })).toBeVisible();
      await semViolacoesSerias(page);
      await page.route(eAListaDasReunioes, (rota) => rota.abort());
      await abas(page).first().click();
      await abaReunioes(page).click();
      await expect(page.getByRole('status').filter({ hasText: SEM_CONEXAO })).toBeVisible();
      await semViolacoesSerias(page);
    });
  });
}

test('a aba cabe nos três tamanhos, com as seis abas', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const comprido = 'Planejamento de dezembro com um assunto bem comprido para quebrar';
  await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), comprido);
  await marcar(pessoas[0].api, noRelogioDaPagina(1, 9, 30));
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(linhas(page)).toHaveCount(2);
  for (const [width, height] of [
    [400, 720],
    [360, 600],
    [300, 440],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(abas(page)).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      const caixa = (await abas(page).nth(i).boundingBox())!;
      expect(caixa.x, `${width}: aba ${i}`).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width, `${width}: aba ${i}`).toBeLessThanOrEqual(width);
      expect(caixa.width, `${width}: aba ${i}`).toBeGreaterThan(20);
    }
    const raiz = await page.evaluate(() => {
      const e = document.documentElement;
      return [e.scrollWidth, e.clientWidth];
    });
    expect(raiz[0], `${width}: rola na horizontal`).toBeLessThanOrEqual(raiz[1]);
    for (const linha of await linhas(page).all()) {
      const caixa = (await linha.boundingBox())!;
      expect(caixa.x + caixa.width, `${width}: linha`).toBeLessThanOrEqual(width);
    }
  }
});

test('nada das reuniões vai ao console', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const criada = await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), 'Planejamento de dezembro');
  const mensagens: string[] = [];
  page.on('console', (m) => {
    // As linhas do próprio navegador para um pedido que falhou não são do app.
    if (!m.text().startsWith('Failed to load resource')) mensagens.push(m.text());
  });
  page.on('pageerror', (e) => mensagens.push(e.message));
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(linhas(page)).toHaveCount(1);
  // Uma falha de leitura também não escreve nada.
  await page.route(eAListaDasReunioes, (rota) => rota.abort());
  await abas(page).first().click();
  await abaReunioes(page).click();
  await expect(page.getByRole('status').filter({ hasText: SEM_CONEXAO })).toBeVisible();
  for (const m of mensagens) {
    for (const segredo of [criada.codigo, criada.link, 'Planejamento de dezembro']) expect(m).not.toContain(segredo);
  }
});
