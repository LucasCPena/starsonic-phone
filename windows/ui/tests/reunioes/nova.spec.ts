// A Nova reunião (Task 8, a tela 3): o formulário que cria uma reunião, os erros dele e o "Link copiado" da linha nova.
// O relógio da página é instalado e parado (pararORelogio): as horas vêm do noRelogioDaPagina, e o "Link copiado" some
// com o runFor. O contexto tem as permissões do clipboard, e o POST das reuniões é visto ou segurado pelo page.route.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacoesSerias, verTextos } from '../helpers';
import { pararORelogio } from '../chat/abrir';
import { empresaComReunioes, liberarReunioes } from '../chat/servidor';
import { abrirNasReunioes, noRelogioDaPagina } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true, permissions: ['clipboard-read', 'clipboard-write'] });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const LISTA = '/api/v1/reunioes';
const ASSUNTO_DO_TESTE = 'Planejamento de dezembro';

const abas = (page: Page) => page.locator('nav.nav button.tab');
const linhas = (page: Page) => page.getByRole('article');
const botaoNova = (page: Page) => page.getByRole('button', { name: 'Nova reunião' });
const tituloNova = (page: Page) => page.getByRole('heading', { name: 'Nova reunião', level: 1 });
const voltar = (page: Page) => page.getByRole('button', { name: 'Voltar para as reuniões' });
const criar = (page: Page) => page.getByRole('button', { name: 'Criar a reunião' });
const campoAssunto = (page: Page) => page.getByLabel('Assunto', { exact: true });
// O nome de cada campo é o calculado (o aria-labelledby dos dois do "Outro dia e hora" junta o rótulo da seção e o
// do campo).
const campoDia = (page: Page) => page.getByRole('textbox', { name: 'Dia', exact: true });
const campoHora = (page: Page) => page.getByRole('textbox', { name: 'Hora', exact: true });
const campoVale = (page: Page) => page.getByRole('combobox', { name: 'O link vale até', exact: true });
const campoAteDia = (page: Page) => page.getByRole('textbox', { name: 'O link vale até Dia', exact: true });
const campoAteHora = (page: Page) => page.getByRole('textbox', { name: 'O link vale até Hora', exact: true });
const alerta = (page: Page) => page.getByRole('alert');
const copiado = (page: Page) => page.getByRole('status').filter({ hasText: 'Link copiado' });
const ehOPost = (rota: Route) => rota.request().method() === 'POST';
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

/** O dia de uma hora no relógio da página, como o <input type="date"> o escreve: aaaa-mm-dd. */
const diaNaPagina = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);

/**
 * Abre o app nas Reuniões, com o relógio da página nesta hora (e parado), e abre a Nova reunião. `parado` falso: a hora
 * só fica fixa e os timers andam (o axe precisa deles).
 */
async function abrirANova(page: Page, agora: number, pessoa: { chave: string }, parado = true): Promise<void> {
  if (parado) await page.clock.install({ time: agora });
  else await page.clock.setFixedTime(agora);
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO });
  if (parado) await pararORelogio(page);
  await botaoNova(page).click();
  await expect(tituloNova(page)).toBeVisible();
}

test('a Nova reunião abre com hoje e a próxima meia hora, e os textos da tela 3', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const agora = noRelogioDaPagina(0, 14, 7);
  await abrirANova(page, agora, pessoas[0]);

  await expect(page.locator('.bar-eyebrow')).toHaveText('REUNIÕES');
  await expect(voltar(page)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções' })).toHaveCount(0);
  await verTextos(page, [
    'REUNIÕES',
    'Assunto',
    'Opcional',
    'Aparece no alto da reunião, para todos que entram.',
    'Dia',
    'Hora',
    'O link vale até',
    'Hoje, às 23:59. Depois dessa hora, ninguém novo entra pelo link.',
    'Os colegas da empresa entram direto. Quem é de fora digita o nome e espera um colega aceitar.',
    'Criar a reunião',
    'O link é copiado assim que a reunião é criada.',
  ]);
  await expect(campoVale(page).locator('option')).toHaveText(['O fim do dia da reunião', 'Outro dia e hora']);
  await expect(campoVale(page)).toHaveValue('fimDoDia');

  await expect(campoAssunto(page)).toBeFocused();
  await expect(campoAssunto(page)).toHaveValue('');
  await expect(campoAssunto(page)).toHaveAttribute('maxlength', '120');
  await expect(campoDia(page)).toHaveAttribute('type', 'date');
  await expect(campoDia(page)).toHaveAttribute('required', '');
  await expect(campoHora(page)).toHaveAttribute('type', 'time');
  await expect(campoHora(page)).toHaveAttribute('required', '');
  await expect(campoDia(page)).toHaveValue(diaNaPagina(agora));
  await expect(campoHora(page)).toHaveValue('14:30');
  await expect(alerta(page)).toHaveCount(0);
  await expect(campoAteDia(page)).toHaveCount(0);

  // Outro dia e hora: o dia e a hora abrem no fim do dia da reunião, e a frase diz até quando.
  await campoVale(page).selectOption('outra');
  await expect(campoAteDia(page)).toHaveValue(diaNaPagina(agora));
  await expect(campoAteHora(page)).toHaveValue('23:59');
  await campoAteDia(page).fill(diaNaPagina(noRelogioDaPagina(1, 0, 0)));
  await campoAteHora(page).fill('18:00');
  await expect(page.getByText('Amanhã, às 18:00. Depois dessa hora, ninguém novo entra pelo link.')).toBeVisible();

  // O Voltar volta para a lista, sem criar nada.
  await voltar(page).click();
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
  await expect(abas(page)).toHaveCount(6);
  await expect(page.getByText('Nenhuma reunião marcada')).toBeVisible();
});

test('o Criar a reunião cria, volta à lista e deixa o link copiado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await abrirANova(page, noRelogioDaPagina(0, 12, 0), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await criar(page).click();

  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
  await expect(linhas(page)).toHaveCount(1);
  await expect(linhas(page).locator('.reun-assunto')).toHaveText([ASSUNTO_DO_TESTE]);
  await expect(linhas(page).locator('.reun-quando')).toHaveText(['Hoje, 12:30']);
  // O link copiado é o que o servidor deu à reunião.
  const lida = await pessoas[0].api.pedir('GET', LISTA);
  const link: string = lida.json.reunioes[0].link;
  expect(link).toMatch(/^https?:\/\//);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  // A linha nova diz "Link copiado" por 2 s.
  await expect(linhas(page).first().getByRole('status')).toHaveText('Link copiado');
  await page.clock.runFor(1_900);
  await expect(copiado(page)).toHaveCount(1);
  await page.clock.runFor(200);
  await expect(copiado(page)).toHaveCount(0);
});

test('o valeAte mandado é o fim do dia no relógio do PC', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const corpos: Array<Record<string, unknown>> = [];
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      corpos.push(rota.request().postDataJSON());
      await rota.continue();
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 10, 0), pessoas[0]);
  await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(2, 0, 0)));
  await campoHora(page).fill('16:00');
  await criar(page).click();
  await expect(linhas(page)).toHaveCount(1);

  expect(corpos).toHaveLength(1);
  expect(corpos[0].valeAte).toBe(noRelogioDaPagina(2, 23, 59) + 59_999);
  expect(corpos[0].inicio).toBe(noRelogioDaPagina(2, 16, 0));
  // Sem assunto, a chave nem vai.
  expect(Object.keys(corpos[0]).sort()).toEqual(['inicio', 'valeAte']);
});

test('o Outro dia e hora manda o que foi escolhido, e o assunto vai sem os espaços das pontas', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const corpos: Array<Record<string, unknown>> = [];
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      corpos.push(rota.request().postDataJSON());
      await rota.continue();
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 10, 0), pessoas[0]);
  await campoAssunto(page).fill(`  ${ASSUNTO_DO_TESTE}  `);
  await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(1, 0, 0)));
  await campoHora(page).fill('09:30');
  await campoVale(page).selectOption('outra');
  // O dia e a hora do "até" abrem no fim do dia da reunião.
  await expect(campoAteDia(page)).toHaveValue(diaNaPagina(noRelogioDaPagina(1, 0, 0)));
  await campoAteDia(page).fill(diaNaPagina(noRelogioDaPagina(4, 0, 0)));
  await campoAteHora(page).fill('18:00');
  await criar(page).click();
  await expect(linhas(page)).toHaveCount(1);

  expect(corpos).toEqual([
    { assunto: ASSUNTO_DO_TESTE, inicio: noRelogioDaPagina(1, 9, 30), valeAte: noRelogioDaPagina(4, 18, 0) },
  ]);
});

test('o dia que já passou e a validade além dos 31 dias dizem o erro, e nada é mandado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  let posts = 0;
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (ehOPost(rota)) posts += 1;
      await rota.fallback();
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);

  await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(-1, 0, 0)));
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O dia da reunião já passou.');
  await expect(campoDia(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(campoDia(page)).toHaveAccessibleDescription('O dia da reunião já passou.');
  // O formulário fica como estava, e escrever de novo tira o erro.
  await expect(campoAssunto(page)).toHaveValue(ASSUNTO_DO_TESTE);
  await expect(tituloNova(page)).toBeVisible();
  await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(0, 0, 0)));
  await expect(alerta(page)).toHaveCount(0);

  await campoVale(page).selectOption('outra');
  await campoAteDia(page).fill(diaNaPagina(noRelogioDaPagina(40, 0, 0)));
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O link pode valer até 31 dias depois da reunião.');
  await expect(campoAteDia(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(campoAssunto(page)).toHaveValue(ASSUNTO_DO_TESTE);
  expect(posts).toBe(0);
});

test('a centésima primeira diz Você já tem 100 reuniões marcadas', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      await rota.fulfill({ status: 409, json: { erro: 'muitasReunioes' } });
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await criar(page).click();
  await expect(alerta(page)).toHaveText('Você já tem 100 reuniões marcadas. Cancele uma para marcar outra.');
  await expect(campoAssunto(page)).toHaveValue(ASSUNTO_DO_TESTE);
  await expect(criar(page)).toBeEnabled();
  await expect(copiado(page)).toHaveCount(0);
});

test('o servidor que não responde diz O servidor do chat não respondeu, e o formulário fica', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  let como: 'cai' | 'cinco' = 'cai';
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      if (como === 'cai') await rota.abort();
      else await rota.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O servidor do chat não respondeu. Tente de novo.');
  await expect(campoAssunto(page)).toHaveValue(ASSUNTO_DO_TESTE);
  await expect(criar(page)).toBeEnabled();

  // Um 5xx diz o mesmo; um clique de novo manda de novo (o erro de antes sai).
  como = 'cinco';
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O servidor do chat não respondeu. Tente de novo.');
  await expect(alerta(page)).toHaveCount(1);
  await expect(tituloNova(page)).toBeVisible();
});

test('o 429 e o 400 do servidor dizem a frase de cada um', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  let resposta: { status: number; json: object } = { status: 429, json: { erro: 'limite', esperarSegundos: 30 } };
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      await rota.fulfill(resposta);
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await criar(page).click();
  await expect(alerta(page)).toHaveText('Muitas tentativas. Espere um pouco para tentar de novo.');

  resposta = { status: 400, json: { erro: 'invalido', campo: 'inicio' } };
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O dia da reunião já passou.');
  await expect(campoDia(page)).toHaveAttribute('aria-invalid', 'true');

  resposta = { status: 400, json: { erro: 'invalido', campo: 'valeAte' } };
  await criar(page).click();
  await expect(alerta(page)).toHaveText('O link pode valer até 31 dias depois da reunião.');
  await expect(alerta(page)).toHaveCount(1);
  await expect(tituloNova(page)).toBeVisible();
});

test('o semReunioes na hora de criar esconde a aba', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await liberarReunioes(empresaId, false);
  await criar(page).click();
  await expect(abas(page)).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat']);
  await expect(tituloNova(page)).toHaveCount(0);
  await expect(abas(page).first()).toHaveAttribute('aria-current', 'page');
});

test('um segundo clique enquanto o pedido está no ar não cria outra', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  let posts = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(
    (url) => url.pathname === LISTA,
    async (rota) => {
      if (!ehOPost(rota)) return rota.fallback();
      posts += 1;
      await solto;
      await rota.continue();
    },
  );
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await criar(page).click();
  await expect.poll(() => posts).toBe(1);
  await expect(criar(page)).toBeDisabled();
  await criar(page).click({ force: true });
  await campoAssunto(page).press('Enter');
  soltar();
  await expect(linhas(page)).toHaveCount(1);
  expect(posts).toBe(1);
  const lida = await pessoas[0].api.pedir('GET', LISTA);
  expect(lida.json.reunioes).toHaveLength(1);
});

test('a cópia que falha não diz Link copiado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  // O writeText que rejeita: a permissão negada, ou a janela sem o foco.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('negado')) });
  });
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await criar(page).click();
  await expect(linhas(page)).toHaveCount(1);
  await expect(linhas(page).locator('.reun-assunto')).toHaveText([ASSUNTO_DO_TESTE]);
  await expect(copiado(page)).toHaveCount(0);
  await page.clock.runFor(2_500);
  await expect(copiado(page)).toHaveCount(0);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a Nova reunião (${nomeDoTema(tema)})`, () => {
    test.use({ colorScheme: tema });

    test(`a Nova reunião não tem violações sérias (${tema})`, async ({ page }) => {
      const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
      await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0], false);
      await semViolacoesSerias(page);
      await campoVale(page).selectOption('outra');
      await expect(campoAteDia(page)).toBeVisible();
      await semViolacoesSerias(page);
      // O erro de um campo.
      await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(-1, 0, 0)));
      await criar(page).click();
      await expect(alerta(page)).toHaveText('O dia da reunião já passou.');
      await semViolacoesSerias(page);
    });
  });
}

test('a Nova reunião cabe nos três tamanhos e anda pelo teclado', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await abrirANova(page, noRelogioDaPagina(0, 14, 7), pessoas[0]);
  await campoVale(page).selectOption('outra');
  await campoDia(page).fill(diaNaPagina(noRelogioDaPagina(-1, 0, 0)));
  await criar(page).click();
  await expect(alerta(page)).toBeVisible();
  for (const [width, height] of [
    [400, 720],
    [360, 600],
    [300, 440],
  ]) {
    await page.setViewportSize({ width, height });
    const raiz = await page.evaluate(() => {
      const e = document.documentElement;
      return [e.scrollWidth, e.clientWidth];
    });
    expect(raiz[0], `${width}: rola na horizontal`).toBeLessThanOrEqual(raiz[1]);
    const campos = [campoAssunto, campoDia, campoHora, campoVale, campoAteDia, criar].map((f) => f(page));
    for (const campo of campos) {
      await campo.scrollIntoViewIfNeeded();
      const caixa = (await campo.boundingBox())!;
      expect(caixa.x, `${width}: campo`).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width, `${width}: campo`).toBeLessThanOrEqual(width);
      // A rolagem leva o campo até a borda da janela: um pixel de folga para a fração.
      expect(caixa.y + caixa.height, `${width}: campo`).toBeLessThanOrEqual(height + 1);
    }
  }
  await page.setViewportSize({ width: 400, height: 720 });

  // O teclado: o Assunto tem o foco; o Tab vai ao Dia, e o Shift+Tab duas vezes ao Voltar, que volta para a lista.
  await campoAssunto(page).focus();
  await page.keyboard.press('Tab');
  await expect(campoDia(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(voltar(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();

  // E o Enter no Assunto cria a reunião.
  await botaoNova(page).click();
  await campoAssunto(page).fill(ASSUNTO_DO_TESTE);
  await page.keyboard.press('Enter');
  await expect(linhas(page).locator('.reun-assunto')).toHaveText([ASSUNTO_DO_TESTE]);
});
