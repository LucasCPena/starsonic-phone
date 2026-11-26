// O "Telefone" da reunião dentro do app (plano 3b, Task 5): na reunião, a barra da vista tem o "Telefone", que mostra o
// app de sempre com a faixa da tela 14 ("Você está na reunião", o microfone e o "Voltar para a reunião") e deixa a
// reunião andando escondida (o mesmo documento do iframe). O aviso do canto leva o `escondida` da vista, o clique fora
// dos botões dele volta para a reunião, e a reunião de dentro do app não entra na pausa do navegador. A página é a
// paginaFalsa; os eventos da reunião entram pelo comEventos.
import { expect, test, type Page } from '@playwright/test';
import {
  capturar,
  comandos,
  empurrar,
  esperarComando,
  mudarEstado,
  semViolacoesSerias,
  type Comando,
} from '../helpers';
import { empresaComReunioes } from '../chat/servidor';
import { esperarOsEventos, pararORelogio } from '../chat/abrir';
import { abrirNasReunioes, comEventos, marcar, meioDiaDeHoje, noRelogioDaPagina, paginaFalsa } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2002', nome: 'Ana Souza' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const OUTRA = 'Reunião com a contabilidade';
const MARIA = { id: '0123456789abcdef', nome: 'Maria Lima' };
const OCUPADO = 'Ocupado · em reunião';
const NA_REUNIAO = 'Você está na reunião';
const LIGADO = 'O microfone está ligado';
const DESLIGADO = 'O microfone está desligado';
const VOLTAR = 'Voltar para a reunião';
const SAIA = 'Saia da reunião de agora para entrar em outra.';
const OUVINDO = 'A reunião no navegador continua ouvindo você. Desligue o microfone lá.';
const TAMANHOS: Array<[number, number, string]> = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const quadro = (page: Page) => page.locator('iframe[title="Reunião"]');
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const linhaDe = (page: Page, assunto: string) => page.getByRole('article').filter({ hasText: assunto });
const faixa = (page: Page) => page.getByRole('region', { name: NA_REUNIAO, exact: true });
/** A barra de título do app de sempre (a da vista escondida não conta). */
const barraDoApp = (page: Page) => page.locator('.win:not(.reuniao) .titlebar');
const abas = (page: Page) => page.locator('nav.nav button');
const doTipo = async (page: Page, cmd: string): Promise<Comando[]> =>
  (await comandos(page)).filter((c) => c.cmd === cmd);
const janelas = async (page: Page) => (await doTipo(page, 'videoWindow')).map((c) => c.modo);
const pedidoDoAviso = async (page: Page) => (await doTipo(page, 'reuniaoPedido')).at(-1);
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

interface Aberta {
  codigo: string;
  outra: string;
  pagina: Awaited<ReturnType<typeof paginaFalsa>>;
  eventos: Awaited<ReturnType<typeof comEventos>>;
}

/** Abre o app nas Reuniões com duas reuniões marcadas, entra na primeira e a página diz que a pessoa está nela. */
async function naReuniao(page: Page, o: { fase?: 'naReuniao' | 'entrada' } = {}): Promise<Aberta> {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = (await marcar(pessoas[0].api, noRelogioDaPagina(0, 14, 0), PLANEJAMENTO)).codigo;
  const outra = (await marcar(pessoas[0].api, noRelogioDaPagina(0, 16, 0), OUTRA)).codigo;
  const pagina = await paginaFalsa(page, codigo);
  const eventos = await comEventos(page);
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await linhaDe(page, PLANEJAMENTO).getByRole('button', { name: 'Entrar', exact: true }).click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(quadro(page)).toBeVisible();
  await expect
    .poll(async () => (await pagina.recebidas()).filter((m) => (m as { tipo?: string }).tipo === 'passe').length)
    .toBe(1);
  await pagina.mandar({ tipo: 'estado', fase: o.fase ?? 'naReuniao', microfone: true });
  return { codigo, outra, pagina, eventos };
}

test('o Telefone mostra o app de sempre, com a faixa, e a reunião continua', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await pagina.marcar();
  await botao(page, 'Telefone').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });

  await expect(quadro(page)).toBeHidden();
  await expect(faixa(page)).toBeVisible();
  await expect(page.getByText(NA_REUNIAO, { exact: true })).toBeVisible();
  await expect(page.getByText(LIGADO, { exact: true })).toBeVisible();
  await expect(botao(page, VOLTAR)).toBeVisible();
  await expect(abas(page)).toHaveCount(6);
  for (const aba of await abas(page).all()) await expect(aba).toBeVisible();
  // A barra de título (a tela 14) diz o estado e a conta; o cabeçalho da conta não muda.
  await expect(barraDoApp(page).locator('.account-status-text')).toHaveText(OCUPADO);
  await expect(barraDoApp(page).locator('.titlebar-text')).toHaveText('Starsonic Phone · Recepção · 2001');
  await expect(page.locator('.account-sub')).not.toContainText(OCUPADO);
  // A faixa tem nome, e o microfone e o botão estão nela.
  await expect(faixa(page).getByRole('status')).toHaveText(LIGADO);
  await expect(faixa(page).getByRole('button', { name: VOLTAR, exact: true })).toBeVisible();
  // A tela de baixo é a que a pessoa usa: nada inerte; e a vista escondida fica fora do Tab e do leitor de tela.
  await expect(page.locator('.tela-de-baixo[inert]')).toHaveCount(0);
  await expect(page.locator('.reuniao-vista[inert]')).toHaveCount(1);
  await expect(page.locator('.reuniao-vista')).toHaveCSS('visibility', 'hidden');
  expect(await pagina.marcada()).toBe(true);

  await botao(page, VOLTAR).click();
  await expect(quadro(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande']);
  expect(await pagina.marcada()).toBe(true);
  // A tela de baixo volta a ficar inerte.
  await expect(page.locator('.tela-de-baixo[inert]')).toHaveCount(1);
  await expect(page.locator('.reuniao-vista[inert]')).toHaveCount(0);
});

test('a faixa diz o microfone da página', async ({ page }) => {
  const { pagina } = await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(page.getByText(LIGADO, { exact: true })).toBeVisible();
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: false });
  await expect(page.getByText(DESLIGADO, { exact: true })).toBeVisible();
  await expect(page.getByText(LIGADO, { exact: true })).toHaveCount(0);
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await expect(page.getByText(LIGADO, { exact: true })).toBeVisible();
});

test('o Telefone antes de entrar fecha a entrada', async ({ page }) => {
  await naReuniao(page, { fase: 'entrada' });
  await botao(page, 'Telefone').click();
  await expect(quadro(page)).toHaveCount(0);
  await expect(faixa(page)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal']);
  // Voltou à aba de onde a pessoa saiu: as Reuniões.
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
});

test('a volta vai ao tamanho em que a reunião estava', async ({ page }) => {
  await naReuniao(page);
  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await botao(page, 'Telefone').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await botao(page, VOLTAR).click();
  await expect(quadro(page)).toBeVisible();
  expect(await janelas(page)).toEqual(['grande', 'telaCheia', 'normal', 'telaCheia']);
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
});

test('no Telefone, o pedido da reunião vai ao aviso como escondido', async ({ page }) => {
  const { codigo, eventos } = await naReuniao(page);
  const comPedido = { tipo: 'reuniaoParticipantes', reuniao: codigo, participantes: [], pedidos: [MARIA] };
  const pedido = { id: MARIA.id, nome: MARIA.nome, assunto: PLANEJAMENTO };
  await eventos.mandar(comPedido);
  await expect.poll(() => pedidoDoAviso(page)).toEqual({ v: 1, cmd: 'reuniaoPedido', pedido, escondida: false });
  await botao(page, 'Telefone').click();
  await expect.poll(() => pedidoDoAviso(page)).toEqual({ v: 1, cmd: 'reuniaoPedido', pedido, escondida: true });
  await botao(page, VOLTAR).click();
  await expect.poll(() => pedidoDoAviso(page)).toEqual({ v: 1, cmd: 'reuniaoPedido', pedido, escondida: false });
});

test('o clique fora dos botões do aviso volta para a reunião', async ({ page }) => {
  await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(faixa(page)).toBeVisible();
  await empurrar(page, { v: 1, type: 'abrir', tela: 'reunioes' });
  await expect(quadro(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande']);
});

test('no Telefone, outra reunião não abre, e a mesma volta', async ({ page }) => {
  await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(faixa(page)).toBeVisible();
  await linhaDe(page, OUTRA).getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(SAIA, { exact: true })).toBeVisible();
  await expect(faixa(page)).toBeVisible();
  await expect(quadro(page)).toBeHidden();
  await linhaDe(page, PLANEJAMENTO).getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(quadro(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  expect(await janelas(page)).toEqual(['grande', 'normal', 'grande']);
});

test('a reunião de dentro do app não entra na pausa do navegador', async ({ page }) => {
  const pausas: string[] = [];
  await page.route(
    (url) => /\/reunioes\/[^/]+\/pausa$/.test(url.pathname),
    (rota) => {
      if (rota.request().method() === 'POST') pausas.push(new URL(rota.request().url()).pathname);
      return rota.abort();
    },
  );
  const { codigo, eventos } = await naReuniao(page);
  await eventos.mandar({ tipo: 'reuniaoParticipantes', reuniao: codigo, participantes: [], pedidos: [] });
  await botao(page, 'Telefone').click();
  const ligacao = {
    top: {
      id: 51,
      number: '2003',
      name: 'Ana Souza',
      incoming: true,
      phase: 'active',
      activeSinceMs: Date.now() - 5_000,
      held: false,
      video: { oferece: false, ativo: false, imagem: false, camera: false, cedo: false },
    },
    second: null,
    secondKind: 'none',
    muted: false,
    conference: false,
    conferenceSinceMs: 0,
    consulting: false,
    colleagueActive: false,
    sala: null,
  };
  await mudarEstado(page, (s) => ({ ...s, ligacao }));
  // Um pedido de verdade ao servidor da página e duas idas e voltas: o que estava no ar chega a quem trata.
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await page.evaluate(() => 0);
  await page.evaluate(() => 0);
  expect(pausas).toEqual([]);
  await expect(page.getByText(OUVINDO, { exact: true })).toHaveCount(0);
});

test('o Abrir no navegador de A reunião não abriu guarda o assunto dos pedidos no aviso', async ({ page }) => {
  // A reunião é de uma colega: não está na lista da pessoa, e o assunto só vem da resposta do passe.
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO, ANA]);
  const criada = await marcar(pessoas[1].api, noRelogioDaPagina(0, 14, 0), PLANEJAMENTO);
  await paginaFalsa(page, criada.codigo, { semPronta: true });
  await page.clock.install({ time: meioDiaDeHoje() });
  const eventos = await comEventos(page);
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await pararORelogio(page);
  await page.getByRole('textbox', { name: 'Entrar com o link de uma reunião' }).fill(criada.link);
  await page.locator('.reun-link').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(quadro(page)).toBeVisible();
  await page.clock.runFor(15_000);
  await botao(page, 'Abrir no navegador').click();
  await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(1);
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await expect(quadro(page)).toHaveCount(0);
  const comPedido = { tipo: 'reuniaoParticipantes', reuniao: criada.codigo, participantes: [], pedidos: [MARIA] };
  await eventos.mandar(comPedido);
  const pedido = { id: MARIA.id, nome: MARIA.nome, assunto: PLANEJAMENTO };
  await expect.poll(() => pedidoDoAviso(page)).toEqual({ v: 1, cmd: 'reuniaoPedido', pedido, escondida: true });
});

for (const tema of ['light', 'dark'] as const) {
  test(`a faixa do Telefone não tem violações sérias (${nomeDoTema(tema)})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    await naReuniao(page);
    await botao(page, 'Telefone').click();
    await expect(faixa(page)).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-telefone', tema);
  });
}

test('a faixa do Telefone cabe nos três tamanhos', async ({ page }) => {
  await naReuniao(page);
  await botao(page, 'Telefone').click();
  await expect(faixa(page)).toBeVisible();
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await expect(page.locator('.win:not(.reuniao)')).toHaveAttribute('data-layout', layout);
    for (const texto of [NA_REUNIAO, LIGADO, VOLTAR]) {
      const alvo = page.getByText(texto, { exact: true });
      await expect(alvo, onde).toBeVisible();
      const caixa = (await alvo.boundingBox())!;
      expect(caixa.x, onde).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width, onde).toBeLessThanOrEqual(largura);
      const cortado = await alvo.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
      expect(cortado, `${texto} cortado em ${onde}`).toBe(false);
    }
    // A barra de título cabe: o estado inteiro e a conta (com reticências, sem estourar a janela).
    const estado = barraDoApp(page).locator('.account-status-text');
    await expect(estado, onde).toHaveText(OCUPADO);
    expect(await estado.evaluate((e) => e.scrollWidth > e.clientWidth + 0.5), `estado cortado em ${onde}`).toBe(false);
    const caixaDaBarra = (await barraDoApp(page).boundingBox())!;
    expect(caixaDaBarra.x + caixaDaBarra.width, onde).toBeLessThanOrEqual(largura);
    expect(await barraDoApp(page).evaluate((e) => e.scrollWidth > e.clientWidth + 0.5), `barra em ${onde}`).toBe(false);
    const caixaDaFaixa = (await faixa(page).boundingBox())!;
    expect(caixaDaFaixa.x + caixaDaFaixa.width, onde).toBeLessThanOrEqual(largura);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), onde).toBeLessThanOrEqual(largura);
    await semViolacoesSerias(page);
  }
});
