// O painel "Participantes" da página do colega (participantes.js), no Chromium, na reunião de mentira
// (reuniao-falsa.ts): quem espera para entrar, com o Recusar e o Aceitar; quem está na reunião, com o Tirar em dois
// cliques; e o Encerrar para todos, com a pergunta dele. Quem entra é a Júlia Martins (o COLEGA da rede falsa), numa
// reunião marcada cujo link vale até as 23:59 de hoje. O relógio da página está parado às 10:00, e as listas chegam
// pelo canal falso, como o servidor as manda. Quem é de fora não vê nada disso.
import { expect, test, type Page } from '@playwright/test';
import { MARCADA } from '../ligacoes-falsas';
import { PASSE_QUE_NAO_VALE, RedeFalsa, type Canal } from '../rede-falsa';
import {
  ACEITO,
  BIA,
  MARIA,
  abrirComoColega,
  area,
  botao,
  caixa,
  conferir,
  doConsole,
  entrarComoColega,
  esperadoNoConsole,
  mandarLista,
  subir,
  vigiar,
  type NaLista,
  type Pessoa,
} from '../reuniao-falsa';

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// O "nenhuma violação da CSP": em todos os testes daqui, nenhuma violação, nenhum erro, e nada dos nomes no console.
test.afterEach(async ({ page }) => {
  await conferir(page);
  expect(doConsole(page)).toEqual([]);
});

// ---- As pessoas da lista. ----

const JULIA: NaLista = { id: 'b000000000000001', nome: 'Júlia Martins', voce: true };
const ANA: NaLista = { id: 'b000000000000002', nome: 'Ana Souza', tela: true };
const CARLOS: NaLista = { id: 'b000000000000003', nome: 'Carlos Lima' };
const PEDRO: NaLista = { id: 'b000000000000004', nome: 'Pedro Nunes', deFora: true };
const ROBERTO: NaLista = { id: 'b000000000000005', nome: 'Roberto Alves' };
const CINCO = [JULIA, ANA, CARLOS, PEDRO, ROBERTO];
const pedidoDe = (p: Pessoa) => ({ id: p.quem, nome: p.nome });

// ---- As peças. ----

const painel = (page: Page) => page.getByRole('complementary', { name: 'Participantes' });
const tituloDoPainel = (page: Page) => painel(page).getByRole('heading', { level: 2, name: 'Participantes' });
const chat = (page: Page) => page.getByRole('complementary', { name: 'Chat da reunião' });
const oBotao = (page: Page) => page.locator('button[data-botao="participantes"]');
const oChat = (page: Page) => page.locator('button[data-botao="chat"]');
const controles = (page: Page) => page.getByRole('navigation', { name: 'Controles da reunião' });
const esperando = (page: Page) => page.locator('.gente-esperando');
const pedidos = (page: Page) => page.locator('.gente-pedido');
const pessoas = (page: Page) => page.locator('.gente-pessoa');
const pessoa = (page: Page, nome: string) => pessoas(page).filter({ hasText: nome });
const encerrar = (page: Page) => painel(page).getByRole('button', { name: 'Encerrar para todos', exact: true });
const dialogo = (page: Page) => page.getByRole('alertdialog', { name: 'Encerrar a reunião para todos?' });
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"]');
const cartao = (page: Page) => page.locator('.pedido');
/** O que fica atrás do painel que cobre a tela. */
const FUNDO = ['.reuniao-topo', '.palco', '.controles'];
const CHEIA = 'A reunião está cheia: ninguém mais entra agora.';
const ATE_HOJE = 'O link continua valendo até hoje, 23:59: a reunião recomeça se um colega entrar de novo.';

/** As respostas que a página mandou pelo canal: aceitar, recusar, tirar e encerrar. */
const respostas = (canal: Canal) =>
  canal.recebidas.filter((m) => ['aceitar', 'recusar', 'tirar', 'encerrar'].includes(m.tipo));

/** O estilo calculado de um elemento (o primeiro do seletor), ou de um pseudo-elemento dele. */
const estilo = (page: Page, seletor: string, propriedade: string, pseudo?: string) =>
  page
    .locator(seletor)
    .first()
    .evaluate((el, [p, ps]) => getComputedStyle(el, ps ?? null).getPropertyValue(p as string), [propriedade, pseudo]);

/** O valor que a regra da folha de estilo com aquele seletor declara. */
const declarado = (page: Page, seletor: string, propriedade: string) =>
  page.evaluate(
    ([s, p]) => {
      for (const folha of document.styleSheets) {
        for (const regra of folha.cssRules) {
          if (regra instanceof CSSStyleRule && regra.selectorText === s) {
            const v = regra.style.getPropertyValue(p);
            if (v !== '') return v;
          }
        }
      }
      return null;
    },
    [seletor, propriedade],
  );

/** O que tem o foco: o nome dado (o aria-label) ou o texto. */
const focado = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '';
  });

async function colegaNaReuniao(page: Page): Promise<Canal> {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  return entrarComoColega(page, rede);
}

/** O colega na reunião, com a lista dada e o painel aberto pelo botão Participantes. */
async function comOPainel(
  page: Page,
  lista: Parameters<typeof mandarLista>[1] = { participantes: CINCO, pedidos: [pedidoDe(MARIA)] },
): Promise<Canal> {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, lista);
  await oBotao(page).click();
  await expect(painel(page)).toBeVisible();
  return canal;
}

// ---- No PC (1280×800). ----

test('o painel', async ({ page }) => {
  const canal = await comOPainel(page);
  await expect(tituloDoPainel(page)).toBeVisible();
  await expect(botao(page, 'Fechar os participantes')).toBeVisible();
  // As duas partes, na ordem, com os números.
  await expect(painel(page).getByRole('heading', { level: 3 })).toHaveText([
    'ESPERANDO PARA ENTRAR · 1',
    'NA REUNIÃO · 5',
  ]);
  await expect(painel(page).getByRole('region', { name: 'ESPERANDO PARA ENTRAR · 1' })).toBeVisible();
  await expect(painel(page).getByRole('region', { name: 'NA REUNIÃO · 5' })).toBeVisible();
  // Quem espera, com o Recusar e o Aceitar.
  await expect(pedidos(page)).toHaveCount(1);
  await expect(pedidos(page).locator('.gente-pedido-nome')).toHaveText('Maria Lima');
  await expect(pedidos(page).getByRole('button')).toHaveText(['Recusar', 'Aceitar']);
  // Quem está na reunião, na ordem da lista, com as marcas.
  await expect(pessoas(page).locator('.gente-nome')).toHaveText([
    'Júlia Martins',
    'Ana Souza',
    'Carlos Lima',
    'Pedro Nunes',
    'Roberto Alves',
  ]);
  await expect(pessoa(page, 'Júlia Martins').locator('.gente-marca')).toHaveText(['você']);
  await expect(pessoa(page, 'Ana Souza').locator('.gente-marca')).toHaveText(['compartilhando a tela']);
  await expect(pessoa(page, 'Carlos Lima').locator('.gente-marca')).toHaveCount(0);
  await expect(pessoa(page, 'Pedro Nunes').locator('.gente-marca')).toHaveText(['de fora']);
  // A própria pessoa não tem o Tirar; os outros têm, com o nome para o leitor de tela.
  await expect(pessoa(page, 'Júlia Martins').getByRole('button')).toHaveCount(0);
  await expect(painel(page).getByRole('button', { name: /^Tirar / })).toHaveText(['Tirar', 'Tirar', 'Tirar', 'Tirar']);
  for (const nome of ['Ana Souza', 'Carlos Lima', 'Pedro Nunes', 'Roberto Alves']) {
    await expect(botao(page, `Tirar ${nome} da reunião`)).toBeVisible();
  }
  // O pé.
  await expect(encerrar(page)).toBeVisible();
  await expect(painel(page).getByText('Todos saem da reunião na hora.', { exact: true })).toBeVisible();

  // O desenho: a moldura do painel do chat, o cartão de quem espera, as linhas, as marcas, o Tirar e o pé.
  expect(await estilo(page, '.gente', 'background-color')).toBe('rgb(17, 24, 48)');
  expect(await estilo(page, '.gente', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '.gente-pedido', 'background-color')).toBe('rgb(10, 14, 26)');
  expect(await estilo(page, '.gente-pedido', 'border-top-color')).toBe('rgb(0, 194, 203)');
  expect(await estilo(page, '.gente-pedido-nome', 'font-size')).toBe('15px');
  expect(await estilo(page, '.gente-pedido-nome', 'font-weight')).toBe('700');
  for (const b of await pedidos(page).getByRole('button').all()) expect((await caixa(b)).height).toBe(40);
  expect(await estilo(page, '.gente-pedido [data-botao="recusar"]', 'background-color')).toBe('rgb(28, 37, 64)');
  expect(await estilo(page, '.gente-pedido [data-botao="aceitar"]', 'background-color')).toBe('rgb(0, 194, 203)');
  for (const l of await pessoas(page).all()) expect((await caixa(l)).height).toBeGreaterThanOrEqual(46);
  expect(await estilo(page, '.gente-nome', 'font-size')).toBe('14.5px');
  expect(await estilo(page, '.gente-nome', 'font-weight')).toBe('600');
  expect(await estilo(page, '.gente-marca', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '.gente-marca', 'color')).toBe('rgb(185, 196, 230)');
  expect(await estilo(page, '.gente-marca', 'font-size')).toBe('11.5px');
  expect((await caixa(botao(page, 'Tirar Ana Souza da reunião'))).height).toBe(34);
  expect(await estilo(page, '[data-botao="tirar"]', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '[data-botao="tirar"]', 'background-color')).toBe('rgba(0, 0, 0, 0)');
  expect((await caixa(encerrar(page))).height).toBe(44);
  // A borda de 1,5 px: a janela de 1 ponto por pixel a desenha com 1 px, e por isso vale a regra da folha de estilo.
  expect(await declarado(page, '.gente-encerrar', 'border-top-width')).toBe('1.5px');
  expect(await estilo(page, '.gente [data-botao="encerrar"]', 'border-top-color')).toBe('rgb(224, 106, 106)');
  expect(await estilo(page, '.gente [data-botao="encerrar"]', 'background-color')).toBe('rgba(0, 0, 0, 0)');
  expect(await estilo(page, '.gente [data-botao="encerrar"]', 'color')).toBe('rgb(255, 255, 255)');
  expect(await estilo(page, '.gente-pe-frase', 'font-size')).toBe('12px');
  expect(await estilo(page, '.gente-pe-frase', 'color')).toBe('rgb(154, 166, 201)');

  // Sem ninguém esperando, a primeira parte não existe, nem para o leitor de tela.
  mandarLista(canal, { participantes: CINCO });
  await expect(painel(page).getByRole('heading', { level: 3 })).toHaveText(['NA REUNIÃO · 5']);
  await expect(esperando(page)).toHaveAttribute('hidden', '');
  await expect(painel(page).getByRole('region', { name: /ESPERANDO/ })).toHaveCount(0);
  await expect(pedidos(page)).toHaveCount(0);
  // Os números acompanham a lista.
  mandarLista(canal, { participantes: [JULIA, PEDRO], pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
  await expect(painel(page).getByRole('heading', { level: 3 })).toHaveText([
    'ESPERANDO PARA ENTRAR · 2',
    'NA REUNIÃO · 2',
  ]);
  await expect(pedidos(page).locator('.gente-pedido-nome')).toHaveText(['Maria Lima', 'Bia Ramos']);
});

test('o painel no lugar do chat', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { participantes: CINCO });
  expect((await caixa(area(page))).width).toBe(1232);
  // Com o chat aberto, o Participantes fecha o chat e abre o painel no lugar dele.
  await oChat(page).click();
  await expect(chat(page)).toBeVisible();
  await oBotao(page).click();
  await expect(painel(page)).toBeVisible();
  await expect(chat(page)).toBeHidden();
  await expect(oChat(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(oBotao(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gente')).toHaveAttribute('data-modo', 'lado');
  // O painel: 360 px, a 24 px da direita da janela e a 12 px da área, com a altura dela; os quadros ficam com o resto.
  await expect.poll(async () => (await caixa(area(page))).width).toBe(860);
  const a = await caixa(area(page));
  const p = await caixa(painel(page));
  expect(p.width).toBe(360);
  expect(p.x + p.width).toBe(1280 - 24);
  expect(p.x - (a.x + a.width)).toBe(12);
  expect([p.y, p.height]).toEqual([a.y, a.height]);
  // Ao lado, nada fica fora do teclado.
  for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
  // E o contrário: o Chat fecha o painel.
  await oChat(page).click();
  await expect(chat(page)).toBeVisible();
  await expect(painel(page)).toBeHidden();
  await expect(oBotao(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await caixa(area(page))).width).toBe(860);
  // Os dois fechados, os quadros voltam à largura toda.
  await oBotao(page).click();
  await expect(painel(page)).toBeVisible();
  await botao(page, 'Fechar os participantes').click();
  await expect(painel(page)).toBeHidden();
  await expect(chat(page)).toBeHidden();
  await expect(oBotao(page)).toBeFocused();
  await expect.poll(async () => (await caixa(area(page))).width).toBe(1232);
  // A janela que cruza os 900 px com o painel aberto: ele passa a cobrir, com o que fica atrás fora do teclado (o chat
  // fechado não desfaz isso), e o foco que ficaria atrás vai ao título dele; de volta, ao lado de novo.
  await oBotao(page).click();
  await botao(page, 'Microfone').focus();
  await page.setViewportSize({ width: 880, height: 800 });
  await expect(page.locator('.gente')).toHaveAttribute('data-modo', 'cobre');
  await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 880, height: 800 });
  for (const s of FUNDO) await expect(page.locator(s)).toHaveAttribute('inert');
  await expect(tituloDoPainel(page)).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.gente')).toHaveAttribute('data-modo', 'lado');
  await expect.poll(async () => (await caixa(area(page))).width).toBe(860);
  for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
});

test('aceitar e recusar no painel', async ({ page }) => {
  const canal = await comOPainel(page, { participantes: CINCO, pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
  const deMaria = pedidos(page).filter({ hasText: 'Maria Lima' });
  const deBia = pedidos(page).filter({ hasText: 'Bia Ramos' });
  await deBia.getByRole('button', { name: 'Aceitar' }).click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: BIA.quem }]);
  await deMaria.getByRole('button', { name: 'Recusar' }).click();
  await expect
    .poll(() => respostas(canal))
    .toEqual([
      { tipo: 'aceitar', pedido: BIA.quem },
      { tipo: 'recusar', pedido: MARIA.quem },
    ]);
  // A lista nova: a Bia na reunião, e a Maria fora. O leitor de tela ouve os dois resultados.
  mandarLista(canal, { participantes: [...CINCO, { id: 'b000000000000006', nome: 'Bia Ramos', deFora: true }] });
  await expect(pedidos(page)).toHaveCount(0);
  await expect(painel(page).getByRole('heading', { level: 3 })).toHaveText(['NA REUNIÃO · 6']);
  await expect(anuncio(page)).toHaveText('O pedido de Bia Ramos foi aceito. O pedido de Maria Lima foi recusado');
});

test('o Ver os pedidos', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { participantes: CINCO, pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
  await botao(page, 'Ver os pedidos').click();
  await expect(painel(page)).toBeVisible();
  await expect(cartao(page)).toBeHidden();
  // O foco vai a quem espera: ao primeiro da lista, e o Tab segue para o Recusar dele.
  await expect(pedidos(page).first()).toBeFocused();
  await expect(pedidos(page).first()).toContainText('Maria Lima');
  await page.keyboard.press('Tab');
  await expect(pedidos(page).first().getByRole('button', { name: 'Recusar' })).toBeFocused();
  expect(respostas(canal)).toEqual([]);
});

test('o Tirar em dois cliques', async ({ page }) => {
  const canal = await comOPainel(page);
  // O primeiro clique só pergunta, e o foco vai ao Voltar.
  await botao(page, 'Tirar Pedro Nunes da reunião').click();
  await expect(pessoa(page, 'Pedro Nunes').getByText('Tirar Pedro Nunes?', { exact: true })).toBeVisible();
  await expect(pessoa(page, 'Pedro Nunes').getByRole('button')).toHaveText(['Voltar', 'Tirar']);
  await expect(botao(page, 'Voltar')).toBeFocused();
  expect(respostas(canal)).toEqual([]);
  // O Voltar desfaz, e o foco volta ao Tirar da linha.
  await botao(page, 'Voltar').click();
  await expect(page.getByText('Tirar Pedro Nunes?', { exact: true })).toHaveCount(0);
  await expect(botao(page, 'Tirar Pedro Nunes da reunião')).toBeFocused();
  expect(respostas(canal)).toEqual([]);
  // Uma pergunta por vez: a de outra pessoa toma o lugar.
  await botao(page, 'Tirar Pedro Nunes da reunião').click();
  await botao(page, 'Tirar Carlos Lima da reunião').click();
  await expect(page.getByText('Tirar Pedro Nunes?', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Tirar Carlos Lima?', { exact: true })).toBeVisible();
  // O segundo clique tira.
  await botao(page, 'Tirar Pedro Nunes da reunião').click();
  await expect(page.getByText('Tirar Carlos Lima?', { exact: true })).toHaveCount(0);
  await botao(page, 'Tirar').click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'tirar', participante: PEDRO.id }]);
  await expect(page.getByText('Tirar Pedro Nunes?', { exact: true })).toHaveCount(0);
  // A lista nova sem o Pedro: a linha sai, o leitor de tela ouve, e o foco fica no painel.
  mandarLista(canal, { participantes: [JULIA, ANA, CARLOS, ROBERTO], pedidos: [pedidoDe(MARIA)] });
  await expect(pessoa(page, 'Pedro Nunes')).toHaveCount(0);
  await expect(anuncio(page)).toHaveText('Pedro Nunes saiu da reunião');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.gente')?.contains(document.activeElement)))
    .toBe(true);
});

test('o Encerrar para todos', async ({ page }) => {
  const canal = await comOPainel(page);
  await encerrar(page).click();
  // A pergunta, com as frases de 5 pessoas; o foco começa no Voltar.
  await expect(dialogo(page)).toBeVisible();
  await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText('Encerrar a reunião para todos?');
  await expect(dialogo(page)).toHaveAccessibleDescription(`As 5 pessoas saem agora. ${ATE_HOJE}`);
  await expect(dialogo(page).getByRole('button')).toHaveText(['Voltar', 'Encerrar para todos']);
  await expect(dialogo(page).getByRole('button', { name: 'Voltar' })).toBeFocused();
  // O desenho: 480 px no meio, sobre o véu; os botões à direita.
  const d = await caixa(dialogo(page));
  expect(d.width).toBe(480);
  expect(d.x + d.width / 2).toBeCloseTo(640, 0);
  expect(d.y + d.height / 2).toBeCloseTo(400, 0);
  expect(await estilo(page, '.encerrar', 'background-color', '::backdrop')).toBe('rgba(4, 6, 14, 0.74)');
  expect(await estilo(page, '.encerrar', 'background-color')).toBe('rgb(17, 24, 48)');
  expect(await estilo(page, '.encerrar', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '.encerrar', 'border-top-left-radius')).toBe('16px');
  expect(await estilo(page, '.encerrar', 'padding-top')).toBe('24px');
  expect(await estilo(page, '.encerrar h2', 'font-size')).toBe('20px');
  expect(await estilo(page, '.encerrar h2', 'font-weight')).toBe('800');
  const voltar = await caixa(dialogo(page).getByRole('button', { name: 'Voltar' }));
  const sim = await caixa(dialogo(page).getByRole('button', { name: 'Encerrar para todos' }));
  expect([voltar.height, sim.height]).toEqual([46, 46]);
  expect(voltar.y).toBe(sim.y);
  // À direita, dentro dos 24 px por dentro e da borda de 1 px.
  expect(Math.round(d.x + d.width - (sim.x + sim.width))).toBe(1 + 24);
  expect(await estilo(page, '.encerrar [data-botao="naoEncerrar"]', 'background-color')).toBe('rgb(28, 37, 64)');
  expect(await estilo(page, '.encerrar [data-botao="naoEncerrar"]', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '.encerrar [data-botao="encerrarMesmo"]', 'background-color')).toBe('rgb(194, 59, 59)');

  // O foco fica preso no diálogo: o Tab e o Shift+Tab só passam pelos dois botões.
  const voltas: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    voltas.push(await focado(page));
  }
  expect(voltas).toEqual(['Encerrar para todos', 'Voltar', 'Encerrar para todos', 'Voltar']);
  await page.keyboard.press('Shift+Tab');
  expect(await focado(page)).toBe('Encerrar para todos');
  await page.keyboard.press('Shift+Tab');
  expect(await focado(page)).toBe('Voltar');

  // O Voltar fecha, sem mandar nada, e o foco volta ao Encerrar para todos do painel.
  await dialogo(page).getByRole('button', { name: 'Voltar' }).click();
  await expect(dialogo(page)).toBeHidden();
  await expect(encerrar(page)).toBeFocused();
  // O Esc também fecha, e o painel continua aberto.
  await encerrar(page).click();
  await expect(dialogo(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogo(page)).toBeHidden();
  await expect(painel(page)).toBeVisible();
  await expect(encerrar(page)).toBeFocused();
  expect(respostas(canal)).toEqual([]);

  // Com uma pessoa só na reunião, a primeira frase é outra.
  mandarLista(canal, { participantes: [JULIA] });
  await expect(painel(page).getByRole('heading', { level: 3 })).toHaveText(['NA REUNIÃO · 1']);
  await encerrar(page).click();
  await expect(dialogo(page)).toHaveAccessibleDescription(`Você sai agora. ${ATE_HOJE}`);
  // O Encerrar para todos manda o encerrar, e o encerrada é o fim.
  await dialogo(page).getByRole('button', { name: 'Encerrar para todos' }).click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'encerrar' }]);
  await expect(dialogo(page)).toBeHidden();
  canal.mandar({ tipo: 'encerrada' });
  await expect(page.getByRole('heading', { level: 1, name: 'A reunião acabou' })).toBeVisible();
  await expect(painel(page)).toBeHidden();
});

test('a reunião cheia ao aceitar', async ({ page }) => {
  const canal = await comOPainel(page);
  await expect(painel(page).getByText(CHEIA, { exact: true })).toBeHidden();
  await pedidos(page).getByRole('button', { name: 'Aceitar' }).click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: MARIA.quem }]);
  canal.mandar({ tipo: 'recusa', de: 'aceitar', motivo: 'cheia' });
  // A frase aparece no painel (o cartão está fechado com o painel aberto), e o leitor de tela a ouve.
  await expect(painel(page).getByText(CHEIA, { exact: true })).toBeVisible();
  await expect(cartao(page)).toBeHidden();
  await expect(anuncio(page)).toHaveText(CHEIA);
  // A lista nova tira a frase.
  mandarLista(canal, { participantes: CINCO, pedidos: [pedidoDe(MARIA)] });
  await expect(painel(page).getByText(CHEIA, { exact: true })).toBeHidden();
});

test('o nome não vira HTML', async ({ page }) => {
  const nome = '<img src=x onerror=alert(1)>';
  await comOPainel(page, {
    participantes: [JULIA, { id: 'b000000000000009', nome }],
    pedidos: [{ id: 'a000000000000009', nome: `${nome}!` }],
  });
  await expect(pedidos(page).locator('.gente-pedido-nome')).toHaveText(`${nome}!`);
  await expect(pessoas(page).locator('.gente-nome')).toHaveText(['Júlia Martins', nome]);
  await expect(botao(page, `Tirar ${nome} da reunião`)).toBeVisible();
  await botao(page, `Tirar ${nome} da reunião`).click();
  await expect(page.getByText(`Tirar ${nome}?`, { exact: true })).toBeVisible();
  // A página não ganhou um img: os únicos são os dois logos de sempre.
  await expect(page.locator('img:not(.logo)')).toHaveCount(0);
  await expect(page.locator('img')).toHaveCount(2);
});

test('o teclado', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { participantes: [JULIA, ANA, PEDRO], pedidos: [pedidoDe(MARIA)] });
  // O Enter no botão Participantes abre o painel, com o foco no título.
  await oBotao(page).focus();
  await page.keyboard.press('Enter');
  await expect(painel(page)).toBeVisible();
  await expect(tituloDoPainel(page)).toBeFocused();
  // O Tab passa pelo painel na ordem da tela, e depois segue para os controles.
  const focados: string[] = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    focados.push(await focado(page));
  }
  expect(focados).toEqual([
    'Fechar os participantes',
    'Recusar',
    'Aceitar',
    'Tirar Ana Souza da reunião',
    'Tirar Pedro Nunes da reunião',
    'Encerrar para todos',
    'Microfone',
  ]);
  // O Esc, com o foco no painel, fecha o painel, e o foco volta ao botão Participantes.
  await botao(page, 'Tirar Ana Souza da reunião').focus();
  await page.keyboard.press('Escape');
  await expect(painel(page)).toBeHidden();
  await expect(oBotao(page)).toBeFocused();
  await expect(controles(page)).toBeVisible();
});

// ---- No celular (390×844, com o toque). ----

test.describe('no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no celular, o painel cobre a tela', async ({ page }) => {
    const canal = await colegaNaReuniao(page);
    mandarLista(canal, { participantes: CINCO, pedidos: [pedidoDe(MARIA)] });
    await page.evaluate(() => {
      (window as unknown as { aMesmaPagina?: boolean }).aMesmaPagina = true;
    });
    const estadoDoHistorico = () => page.evaluate(() => history.state as unknown);
    expect(await estadoDoHistorico()).toBeNull();
    await oBotao(page).tap();
    await expect(painel(page)).toBeVisible();
    await expect(page.locator('.gente')).toHaveAttribute('data-modo', 'cobre');
    await expect.poll(() => caixa(painel(page))).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(tituloDoPainel(page)).toBeFocused();
    await expect(botao(page, 'Fechar os participantes')).toBeVisible();
    expect((await caixa(botao(page, 'Fechar os participantes'))).width).toBeGreaterThanOrEqual(44);
    // O que fica atrás sai do teclado e dos leitores de tela; o painel cabe na largura, sem rolar para o lado.
    for (const s of FUNDO) await expect(page.locator(s)).toHaveAttribute('inert');
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBe(larguras[1]);
    await expect(encerrar(page)).toBeVisible();
    await expect.poll(estadoDoHistorico).toEqual({ participantesDaReuniao: true });

    // O Voltar do aparelho fecha o painel, e a pessoa continua na mesma página, na reunião.
    await page.goBack();
    expect(await page.evaluate(() => (window as unknown as { aMesmaPagina?: boolean }).aMesmaPagina)).toBe(true);
    await expect(painel(page)).toBeHidden();
    await expect(controles(page)).toBeVisible();
    for (const s of FUNDO) await expect(page.locator(s)).not.toHaveAttribute('inert');
    await expect(oBotao(page)).toBeFocused();
    expect(await estadoDoHistorico()).toBeNull();

    // Fechado pelo botão dele, a entrada sai do histórico.
    await oBotao(page).tap();
    await expect.poll(estadoDoHistorico).toEqual({ participantesDaReuniao: true });
    await botao(page, 'Fechar os participantes').tap();
    await expect(painel(page)).toBeHidden();
    await expect.poll(estadoDoHistorico).toBeNull();
    await expect(oBotao(page)).toBeFocused();
    // O Ver os pedidos também cobre a tela.
    mandarLista(canal, { participantes: CINCO, pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
    await botao(page, 'Ver os pedidos').tap();
    await expect(page.locator('.gente')).toHaveAttribute('data-modo', 'cobre');
    await expect(pedidos(page).first()).toBeFocused();
  });
});

// ---- Quem é de fora. ----

test('quem é de fora não vê nada disso', async ({ page }) => {
  // O passe que não vale: a página segue como quem é de fora, e entra pela espera.
  const rede = await RedeFalsa.instalar(page, MARCADA);
  rede.responder(PASSE_QUE_NAO_VALE);
  await abrirComoColega(page);
  esperadoNoConsole(page, (m) => m.includes('status of 401'));
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  await botao(page, 'Pedir para entrar').click();
  await subir(page, () => controles(page).isVisible());
  const canal = await rede.canalNumero(1);
  // Mesmo com uma lista mandada pelo canal, o painel e o diálogo não existem para o leitor de tela nem para o Tab.
  mandarLista(canal, { participantes: CINCO, pedidos: [pedidoDe(BIA)] });
  canal.mandar({ tipo: 'mensagem', de: CARLOS.id, nome: CARLOS.nome, voce: false, texto: 'Oi' });
  await expect(page.locator('.aviso-curto-linha')).toHaveText('Oi');
  await expect(page.locator('.gente')).toHaveAttribute('hidden', '');
  await expect(painel(page)).toHaveCount(0);
  await expect(dialogo(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Participantes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Encerrar para todos' })).toHaveCount(0);
  await page.locator('.sinal-botao').focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const dentro = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('.gente, .encerrar, [data-botao="participantes"]')),
    );
    expect(dentro).toBe(false);
  }
});
