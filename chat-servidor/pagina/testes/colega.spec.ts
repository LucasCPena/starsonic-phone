// A página do colega (a etapa 2a), no Chromium, na reunião de mentira (reuniao-falsa.ts): a entrada de quem o passe
// reconheceu, o botão Participantes com o número de quem espera, e o cartão "<Nome> quer entrar", com o Recusar e o
// Aceitar. Quem entra é a Júlia Martins (o COLEGA da rede falsa). O relógio da página está parado às 10:00, e as
// listas chegam pelo canal falso, como o servidor as manda. Quem é de fora não vê nada disso.
import { expect, test, type Page } from '@playwright/test';
import { MARCADA } from '../ligacoes-falsas';
import { CODIGO, RedeFalsa, type Canal } from '../rede-falsa';
import {
  ACEITO,
  BIA,
  CARLOS,
  MARIA,
  ROBERTO,
  abrirComoColega,
  abrirNaEntrada,
  area,
  botao,
  caixa,
  conferir,
  doConsole,
  entrarComoColega,
  mandarLista,
  subir,
  vigiar,
  type Pessoa,
} from '../reuniao-falsa';

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// Nenhuma violação da CSP, nenhum erro, e nada dos nomes no console, em todos os testes daqui.
test.afterEach(async ({ page }) => {
  await conferir(page);
  expect(doConsole(page)).toEqual([]);
});

// ---- As peças. ----

const pedidoDe = (p: Pessoa) => ({ id: p.quem, nome: p.nome });
const controles = (page: Page) => page.getByRole('navigation', { name: 'Controles da reunião' });
const participantes = (page: Page) => page.locator('button[data-botao="participantes"]');
const numero = (page: Page) => participantes(page).locator('.contagem');
const cartao = (page: Page) => page.locator('.pedido');
const tituloDoCartao = (page: Page) => cartao(page).locator('.pedido-titulo');
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"]');
const aviso = (page: Page) => page.locator('.aviso-curto');
const CHEIA = 'A reunião está cheia: ninguém mais entra agora.';
const DE_FORA = 'É de fora da empresa, e espera até um colega responder.';

/** As respostas aos pedidos que a página mandou pelo canal. */
const respostas = (canal: Canal) => canal.recebidas.filter((m) => m.tipo === 'aceitar' || m.tipo === 'recusar');

/** O estilo calculado de um elemento. */
const estilo = (page: Page, seletor: string, propriedade: string) =>
  page.locator(seletor).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);

async function colegaNaReuniao(page: Page): Promise<Canal> {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  return entrarComoColega(page, rede);
}

// ---- A entrada. ----

test('a entrada do colega', async ({ page }) => {
  await RedeFalsa.instalar(page, MARCADA);
  await abrirComoColega(page);
  const entrada = page.locator('section[data-tela="entrada"]');
  await expect(page.getByRole('heading', { level: 1, name: 'Planejamento de dezembro' })).toBeVisible();
  await expect(entrada.getByText('Você entra como', { exact: true })).toBeVisible();
  await expect(entrada.getByText('Júlia Martins', { exact: true })).toBeVisible();
  await expect(entrada.locator('.colega-iniciais')).toHaveText('JM');
  await expect(entrada.locator('.colega-iniciais')).toHaveAttribute('aria-hidden', 'true');
  const ajuda = 'É o seu nome no chat da empresa. Os colegas entram direto, sem esperar ser aceitos.';
  await expect(entrada.getByText(ajuda, { exact: true })).toBeVisible();
  await expect(botao(page, 'Entrar')).toBeEnabled();
  // O campo "Seu nome" não existe para o colega, nem o Pedir para entrar.
  await expect(page.getByLabel('Seu nome')).toBeHidden();
  await expect(botao(page, 'Pedir para entrar')).toBeHidden();
  await expect(entrada.getByText('Digite o seu nome para pedir.', { exact: true })).toBeHidden();
  // O resto é a entrada de hoje.
  await expect(entrada.getByText('A sua imagem', { exact: true })).toBeVisible();
  await expect(entrada.getByRole('button', { name: 'Microfone', exact: true })).toBeVisible();
  await expect(entrada.getByRole('button', { name: 'Câmera', exact: true })).toBeVisible();
  const escolha = 'Você escolhe aqui se entra com a câmera e o microfone ligados.';
  await expect(entrada.getByText(escolha, { exact: true })).toBeVisible();
  await expect(entrada.getByText('Nada é gravado.', { exact: true })).toBeVisible();
  // O desenho: o cartão branco, o círculo das iniciais, os dois textos e a frase de ajuda.
  const quem = '.colega-cartao';
  expect(await estilo(page, quem, 'background-color')).toBe('rgb(255, 255, 255)');
  expect(await estilo(page, quem, 'border-top-color')).toBe('rgb(231, 234, 242)');
  expect(await estilo(page, quem, 'border-top-left-radius')).toBe('14px');
  const circulo = await caixa(entrada.locator('.colega-iniciais'));
  expect([circulo.width, circulo.height]).toEqual([46, 46]);
  expect(await estilo(page, '.colega-iniciais', 'background-image')).toBe(
    'linear-gradient(135deg, rgb(0, 194, 203), rgb(12, 38, 113))',
  );
  expect(await estilo(page, '.colega-iniciais', 'font-size')).toBe('15px');
  expect(await estilo(page, '.colega-iniciais', 'font-weight')).toBe('800');
  expect(await estilo(page, '.colega-rotulo', 'font-size')).toBe('13px');
  expect(await estilo(page, '.colega-rotulo', 'color')).toBe('rgb(91, 100, 120)');
  expect(await estilo(page, '.colega-nome', 'font-size')).toBe('17px');
  expect(await estilo(page, '.colega-nome', 'font-weight')).toBe('800');
  expect(await estilo(page, '.colega-ajuda', 'font-size')).toBe('13.5px');
  // O Entrar tem o desenho do Pedir para entrar.
  await expect(botao(page, 'Entrar')).toHaveClass(/botao-pedir/);
});

test('o Entrar manda o entrar', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  expect(canal.tipos()).toContain('entrar');
  expect(canal.recebidas.find((m) => m.tipo === 'entrar')).toEqual({ tipo: 'entrar' });
  expect(canal.tipos()).not.toContain('pedir');
});

// ---- O botão Participantes. ----

test('o botão Participantes', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  // Entre o Chat e o Sair.
  await expect(controles(page).getByRole('button')).toHaveText([
    'Microfone',
    'Câmera',
    'Compartilhar a tela',
    'Chat',
    'Participantes',
    'Sair',
  ]);
  // Sem pedidos, sem número.
  await expect(botao(page, 'Participantes')).toBeVisible();
  await expect(numero(page)).toBeHidden();
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(botao(page, 'Participantes, 1 pessoa quer entrar')).toBeVisible();
  await expect(numero(page)).toHaveText('1');
  mandarLista(canal, { pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
  await expect(numero(page)).toHaveText('2');
  await expect(numero(page)).toBeVisible();
  await expect(botao(page, 'Participantes, 2 pessoas querem entrar')).toBeVisible();
  // O desenho dos outros botões da barra; aberto, a borda ciano e o fundo do Chat aberto.
  await expect(participantes(page)).toHaveClass(/controle/);
  await expect(participantes(page)).toHaveAttribute('aria-pressed', 'false');
  await participantes(page).click();
  await expect(participantes(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await estilo(page, 'button[data-botao="participantes"]', 'border-top-color')).toBe('rgb(0, 194, 203)');
  expect(await estilo(page, 'button[data-botao="participantes"]', 'background-color')).toBe('rgb(11, 61, 71)');
  // Sem pedidos de novo, o número sai.
  mandarLista(canal, { pedidos: [] });
  await expect(numero(page)).toBeHidden();
  await expect(botao(page, 'Participantes')).toBeVisible();
});

// ---- O cartão do pedido. ----

test('o cartão do pedido', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  await expect(cartao(page)).toBeHidden();
  mandarLista(canal, { participantes: [{ id: CARLOS.quem, nome: CARLOS.nome }], pedidos: [pedidoDe(MARIA)] });
  await expect(cartao(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Maria Lima quer entrar' })).toBeVisible();
  await expect(tituloDoCartao(page)).toHaveText('Maria Lima quer entrar');
  await expect(cartao(page).getByText(DE_FORA, { exact: true })).toBeVisible();
  await expect(cartao(page).getByRole('button')).toHaveText(['Recusar', 'Aceitar']);
  // No alto à direita da área dos quadros, com 400 px.
  const c = await caixa(cartao(page));
  const a = await caixa(area(page));
  expect(c.width).toBe(400);
  expect(c.y - a.y).toBe(28);
  expect(a.x + a.width - (c.x + c.width)).toBe(40);
  // O desenho.
  expect(await estilo(page, '.pedido', 'background-color')).toBe('rgb(17, 24, 48)');
  expect(await estilo(page, '.pedido', 'border-top-width')).toBe('1px');
  expect(await estilo(page, '.pedido', 'border-top-color')).toBe('rgb(0, 194, 203)');
  expect(await estilo(page, '.pedido', 'border-top-left-radius')).toBe('14px');
  expect(await estilo(page, '.pedido', 'padding-top')).toBe('16px');
  expect(await estilo(page, '.pedido-titulo', 'font-size')).toBe('16px');
  expect(await estilo(page, '.pedido-titulo', 'font-weight')).toBe('800');
  expect(await estilo(page, '.pedido-texto', 'font-size')).toBe('13px');
  expect(await estilo(page, '.pedido-texto', 'color')).toBe('rgb(185, 196, 230)');
  const recusar = await caixa(botao(page, 'Recusar'));
  const aceitar = await caixa(botao(page, 'Aceitar'));
  expect([recusar.height, aceitar.height]).toEqual([44, 44]);
  expect(recusar.y).toBe(aceitar.y);
  expect(recusar.x).toBeLessThan(aceitar.x);
  expect(await estilo(page, '.pedido [data-botao="recusar"]', 'background-color')).toBe('rgb(28, 37, 64)');
  expect(await estilo(page, '.pedido [data-botao="recusar"]', 'border-top-color')).toBe('rgb(44, 55, 87)');
  expect(await estilo(page, '.pedido [data-botao="aceitar"]', 'background-color')).toBe('rgb(0, 194, 203)');
  expect(await estilo(page, '.pedido [data-botao="aceitar"]', 'color')).toBe('rgb(3, 34, 42)');
  // O Aceitar e o Recusar mandam a resposta com o pedido.
  await botao(page, 'Aceitar').click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: MARIA.quem }]);
  await botao(page, 'Recusar').click();
  await expect
    .poll(() => respostas(canal))
    .toEqual([
      { tipo: 'aceitar', pedido: MARIA.quem },
      { tipo: 'recusar', pedido: MARIA.quem },
    ]);
  // A lista nova sem o pedido: o cartão some.
  mandarLista(canal, { participantes: [{ id: CARLOS.quem, nome: CARLOS.nome }], pedidos: [] });
  await expect(cartao(page)).toBeHidden();
});

test('o cartão com vários pedidos', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA), pedidoDe(BIA), pedidoDe(ROBERTO)] });
  await expect(tituloDoCartao(page)).toHaveText('Maria Lima e mais 2 querem entrar');
  await expect(cartao(page).getByRole('button')).toHaveText(['Ver os pedidos']);
  await expect(botao(page, 'Aceitar')).toBeHidden();
  await expect(botao(page, 'Recusar')).toBeHidden();
  // Com dois pedidos, "e mais 1".
  mandarLista(canal, { pedidos: [pedidoDe(BIA), pedidoDe(ROBERTO)] });
  await expect(tituloDoCartao(page)).toHaveText('Bia Ramos e mais 1 querem entrar');
  // O Ver os pedidos abre o painel Participantes, que fica no lugar do cartão; nada vai pelo canal.
  await botao(page, 'Ver os pedidos').click();
  await expect(participantes(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(cartao(page)).toBeHidden();
  expect(respostas(canal)).toEqual([]);
});

test('a reunião cheia ao aceitar', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(cartao(page).getByText(CHEIA, { exact: true })).toBeHidden();
  await botao(page, 'Aceitar').click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: MARIA.quem }]);
  canal.mandar({ tipo: 'recusa', de: 'aceitar', motivo: 'cheia' });
  await expect(cartao(page).getByText(CHEIA, { exact: true })).toBeVisible();
  // A lista nova tira a frase.
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(cartao(page).getByText(CHEIA, { exact: true })).toBeHidden();
});

test('o servidor de vídeo que não respondeu ao aceitar', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await botao(page, 'Aceitar').click();
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: MARIA.quem }]);
  canal.mandar({ tipo: 'recusa', de: 'aceitar', motivo: 'servidorVideo' });
  await expect(aviso(page)).toBeVisible();
  await expect(aviso(page).locator('.aviso-curto-linha')).toHaveText('O servidor de reuniões não respondeu');
  await expect(aviso(page).locator('.aviso-curto-quem')).toBeHidden();
  await expect(aviso(page).getByRole('button', { name: 'Abrir o chat' })).toBeHidden();
  await expect(aviso(page).getByRole('button', { name: 'Ver os detalhes' })).toBeHidden();
  await expect(anuncio(page)).toHaveText('O servidor de reuniões não respondeu');
  // O aviso vive o tempo dos outros avisos curtos.
  await page.clock.runFor(4_900);
  await expect(aviso(page)).toBeVisible();
  await page.clock.runFor(100);
  await expect(aviso(page)).toBeHidden();
});

test('sem o canal o Aceitar desliga, e a chave recusada mostra o aviso de quem deixou de cuidar', async ({ page }) => {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  const canal = await entrarComoColega(page, rede);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(tituloDoCartao(page)).toHaveText('Maria Lima quer entrar');
  await expect(botao(page, 'Aceitar')).toBeEnabled();
  // O canal cai, e a página tenta religar por trás: o Aceitar e o Recusar do cartão ficam desligados, e o aviso curto
  // do servidor não aparece (a regra do cérebro, de a resposta que não sai mostrar o aviso, fica nos testes dele).
  await canal.fechar(1006);
  await page.clock.runFor(2_000);
  const volta = await rede.canalNumero(2);
  await expect.poll(() => volta.tipos()).toEqual(['voltar']);
  await expect(botao(page, 'Aceitar')).toBeDisabled();
  await expect(botao(page, 'Recusar')).toBeDisabled();
  await expect(aviso(page)).toBeHidden();
  // A chave recusada no religar: o colega deixa de cuidar da reunião. O canal fecha, o aviso fica à vista no lugar do
  // cartão (o título e o texto), o leitor de tela ouve o aviso inteiro, e o cartão do pedido some.
  volta.mandar({ tipo: 'erro', erro: 'invalido' });
  await expect.poll(() => volta.fechadoPelaPagina).not.toBeUndefined();
  const noLugar = page.getByRole('region', { name: 'Você deixou de cuidar desta reunião' });
  await expect(noLugar.getByRole('heading', { level: 2, name: 'Você deixou de cuidar desta reunião' })).toBeVisible();
  await expect(
    noLugar.getByText('Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.', { exact: true }),
  ).toBeVisible();
  await expect(anuncio(page)).toHaveText(
    'Você deixou de cuidar desta reunião. Para aceitar pedidos ou encerrar, saia e abra a reunião de novo pelo app.',
  );
  await expect(cartao(page)).toBeHidden();
  await expect(aviso(page)).toBeHidden();
  // Nada foi pelos canais.
  expect(respostas(canal)).toEqual([]);
  expect(respostas(volta)).toEqual([]);
  expect(volta.tipos()).toEqual(['voltar']);
});

test('o link que deixou de valer mostra o aviso do link, e não o de sempre', async ({ page }) => {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  const canal = await entrarComoColega(page, rede);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(tituloDoCartao(page)).toHaveText('Maria Lima quer entrar');
  // O canal cai, a página tenta religar, e a resposta do voltar é o linkInvalido.
  await canal.fechar(1006);
  await page.clock.runFor(2_000);
  const volta = await rede.canalNumero(2);
  await expect.poll(() => volta.tipos()).toEqual(['voltar']);
  volta.mandar({ tipo: 'linkInvalido' });
  await expect.poll(() => volta.fechadoPelaPagina).not.toBeUndefined();
  // No lugar do cartão: a região com o nome do título, o título e o texto; o leitor de tela ouve os dois.
  const titulo = 'O link desta reunião deixou de valer';
  const texto =
    'Você continua na reunião, mas não pode mais aceitar pedidos nem encerrar. Se sair, não consegue voltar.';
  const noLugar = page.getByRole('region', { name: titulo });
  await expect(noLugar.getByRole('heading', { level: 2, name: titulo })).toBeVisible();
  await expect(noLugar.getByText(texto, { exact: true })).toBeVisible();
  await expect(anuncio(page)).toHaveText(`${titulo}. ${texto}`);
  await expect(cartao(page)).toBeHidden();
  // Nada do aviso de sempre está à vista.
  await expect(page.getByText('saia e abra a reunião de novo pelo app')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Você deixou de cuidar desta reunião' })).toHaveCount(0);
  // Nada foi pelos canais.
  expect(respostas(canal)).toEqual([]);
  expect(respostas(volta)).toEqual([]);
});

test('o nome não vira HTML', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  const nome = '<img src=x onerror=alert(1)>';
  mandarLista(canal, { pedidos: [{ id: 'a000000000000009', nome }] });
  await expect(tituloDoCartao(page)).toHaveText(`${nome} quer entrar`);
  await expect(anuncio(page)).toHaveText(`${nome} quer entrar`);
  // A página não ganhou um img: os únicos são os dois logos de sempre.
  await expect(page.locator('img:not(.logo)')).toHaveCount(0);
  await expect(page.locator('img')).toHaveCount(2);
});

// ---- O teclado e o leitor de tela. ----

test('o teclado', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  await expect(cartao(page)).toBeVisible();
  // Do sinalizador, no alto, o Tab passa pelo cartão (o Recusar e o Aceitar) antes dos controles, embaixo.
  await page.locator('.sinal-botao').focus();
  const focados: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    focados.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
  }
  expect(focados).toEqual(['Recusar', 'Aceitar', 'Microfone']);
  // O Enter no Aceitar aceita.
  await page.keyboard.press('Shift+Tab');
  await expect(botao(page, 'Aceitar')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => respostas(canal)).toEqual([{ tipo: 'aceitar', pedido: MARIA.quem }]);
});

test('o leitor de tela', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  const carlos = { id: CARLOS.quem, nome: CARLOS.nome };
  mandarLista(canal, { participantes: [carlos], pedidos: [pedidoDe(MARIA)] });
  await expect(anuncio(page)).toHaveText('Maria Lima quer entrar');
  await botao(page, 'Aceitar').click();
  await expect.poll(() => respostas(canal)).toHaveLength(1);
  // A lista nova, sem o pedido, não diz o resultado: quem diz é o feito, que o servidor manda.
  mandarLista(canal, { participantes: [carlos, { id: 'b000000000000003', nome: 'Maria Lima', deFora: true }] });
  canal.mandar({ tipo: 'feito', de: 'aceitar', id: MARIA.quem });
  await expect(anuncio(page)).toHaveText('O pedido de Maria Lima foi aceito');
});

test('o leitor de tela ouve dois pedidos que chegam juntos', async ({ page }) => {
  const canal = await colegaNaReuniao(page);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA), pedidoDe(BIA)] });
  await expect(anuncio(page)).toHaveText('Maria Lima quer entrar. Bia Ramos quer entrar');
});

// ---- O celular. ----

test.describe('no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no celular', async ({ page }) => {
    const canal = await colegaNaReuniao(page);
    const botoes = controles(page).getByRole('button');
    await expect(botoes).toHaveText(['Microfone', 'Câmera', 'Chat', 'Participantes', 'Sair']);
    mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
    await expect(cartao(page)).toBeVisible();
    // O cartão ocupa a largura da área dos quadros menos 24 px: 12 px de cada lado.
    const c = await caixa(cartao(page));
    const a = await caixa(area(page));
    expect(c.width).toBe(a.width - 24);
    expect(c.x - a.x).toBe(12);
    // Os cinco controles, com o número, cabem na janela, numa linha só, sem rolagem para o lado.
    await expect(numero(page)).toHaveText('1');
    const caixas = await Promise.all((await botoes.all()).map((b) => caixa(b)));
    for (const b of caixas) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.y).toBe(caixas[0].y);
    }
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBe(larguras[1]);
    // O texto de cada um cabe nele.
    const cortados = await botoes.evaluateAll((bs) =>
      bs.filter((b) => [...b.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1)).length,
    );
    expect(cortados).toBe(0);
  });
});

// ---- Quem é de fora. ----

test('quem é de fora não vê nada disso', async ({ page }) => {
  // A página sem o passe: a entrada de quem é de fora, com o campo "Seu nome". (O passe que não vale dá a mesma
  // entrada, com a faixa de cima: o escolha.spec.ts.)
  const rede = await RedeFalsa.instalar(page, MARCADA);
  await abrirNaEntrada(page, `/r/${CODIGO}`);
  await expect(page.getByLabel('Seu nome')).toBeVisible();
  await expect(page.getByText('Você entra como', { exact: true })).toBeHidden();
  await expect(botao(page, 'Entrar')).toBeHidden();
  // Na reunião, nenhum botão Participantes e nenhum cartão, mesmo com uma lista mandada pelo canal.
  const { canal } = await naReuniaoDeFora(page, rede);
  await expect(controles(page).getByRole('button')).toHaveText([
    'Microfone',
    'Câmera',
    'Compartilhar a tela',
    'Chat',
    'Sair',
  ]);
  mandarLista(canal, { pedidos: [pedidoDe(MARIA)] });
  canal.mandar({ tipo: 'mensagem', de: CARLOS.quem, nome: CARLOS.nome, voce: false, texto: 'Oi' });
  // A mensagem do chat, que chegou depois da lista, já está na tela: a lista também passou pelo cérebro.
  await expect(aviso(page).locator('.aviso-curto-linha')).toHaveText('Oi');
  await expect(participantes(page)).toBeHidden();
  await expect(cartao(page)).toBeHidden();
  await expect(page.getByText('Maria Lima quer entrar')).toBeHidden();
});

// O pedido de quem é de fora, na página que já está na entrada: o nome, o Pedir para entrar e o aceito.
async function naReuniaoDeFora(page: Page, rede: RedeFalsa): Promise<{ canal: Canal }> {
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  await botao(page, 'Pedir para entrar').click();
  await subir(page, () => controles(page).isVisible());
  return { canal: await rede.canalNumero(1) };
}
