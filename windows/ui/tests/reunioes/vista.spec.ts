// A reunião dentro da janela do app (plano 3b, Task 3): o "Entrar" de cada linha da lista abre a vista com o iframe da
// página da reunião; o app e a página conversam por postMessage (o passe, os aparelhos, o estado, o link); a página que
// não abre em 15 s diz "A reunião não abriu."; a tela cheia não recria a reunião; a ligação e outra reunião impedem o
// Entrar. A página é a de verdade só no primeiro teste; nos outros, a paginaFalsa (tests/reunioes/abrir.ts).
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  capturar,
  comandos,
  esperarComando,
  estado,
  mudarEstado,
  semViolacoesSerias,
  type Comando,
} from '../helpers';
import { pararORelogio } from '../chat/abrir';
import { baseDoChat, empresaComReunioes } from '../chat/servidor';
import { abrirNasReunioes, marcar, meioDiaDeHoje, noRelogioDaPagina, paginaFalsa } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const OUTRA = 'Reunião com a contabilidade';
const FORMATO_DO_PASSE = /^[A-Za-z0-9_-]{43}$/;
const OCUPADO = 'Ocupado · em reunião';
const DESLIGUE = 'Desligue a ligação para entrar na reunião.';
const SAIA = 'Saia da reunião de agora para entrar em outra.';
const NAO_ABRIU = 'A reunião não abriu.';
const MUITAS = 'Muitas tentativas. Espere um pouco para tentar de novo.';
const OUTRA_EMPRESA = 'Esta reunião é de outra empresa. Ela abre no navegador, e você entra como convidado.';
const ORIGEM = new URL(baseDoChat()).origin;
const PERMISSOES = ['camera', 'microphone', 'display-capture', 'autoplay', 'speaker-selection']
  .map((p) => `${p} ${ORIGEM}`)
  .join('; ');

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const ePasse = (url: URL) => url.pathname.endsWith('/passe');
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
const quadro = (page: Page) => page.locator('iframe[title="Reunião"]');
const barra = (page: Page) => page.locator('.reuniao .titlebar');
const botaoEntrar = (page: Page, i = 0) =>
  page.getByRole('article').nth(i).getByRole('button', { name: 'Entrar', exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

/** Marca uma reunião de hoje, às 14:00, no relógio da página. */
async function marcarHoje(api: Parameters<typeof marcar>[0], assunto = PLANEJAMENTO): Promise<string> {
  return (await marcar(api, noRelogioDaPagina(0, 14, 0), assunto)).codigo;
}

/** Abre o app nas Reuniões com a hora da página fixa no meio-dia (os timers andam). */
async function abrir(page: Page, pessoa: { chave: string }): Promise<void> {
  await page.clock.setFixedTime(meioDiaDeHoje());
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO });
}

/** Conta os pedidos do passe que saem da página (e os deixa seguir). */
async function contarOsPasses(page: Page): Promise<{ pedidos(): number }> {
  let n = 0;
  await page.route(ePasse, (rota: Route) => {
    n += 1;
    return rota.continue();
  });
  return { pedidos: () => n };
}

/** Os comandos de um tipo que a ponte recebeu. */
async function doTipo(page: Page, cmd: string): Promise<Comando[]> {
  return (await comandos(page)).filter((c) => c.cmd === cmd);
}

/** Os `passe` que a página recebeu. */
const passesDaPagina = async (pagina: { recebidas(): Promise<object[]> }) =>
  (await pagina.recebidas()).filter((m) => (m as { tipo?: string }).tipo === 'passe') as Array<{
    starsonic: number;
    tipo: string;
    passe: string;
    aparelhos: Record<string, string>;
  }>;

test('o Entrar é o primeiro botão da linha e, no Mínimo, o primeiro item do menu', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  const linha = page.getByRole('article');
  await expect(linha).toHaveCount(1);
  await expect(linha.getByRole('button', { name: /^(Entrar|Copiar link)$/ })).toHaveText(['Entrar', 'Copiar link']);

  await page.setViewportSize({ width: 300, height: 440 });
  await expect(linha.locator('.reun-acoes').getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: `Mais opções de ${PLANEJAMENTO}` }).click();
  const menu = page.getByRole('menu', { name: `Opções de ${PLANEJAMENTO}` });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Entrar',
    'Copiar link',
    'Abrir no navegador',
    'Cancelar a reunião',
  ]);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
});

test('o Entrar abre a reunião dentro do app, com a página de verdade até a entrada', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });

  await expect(quadro(page)).toHaveAttribute('src', `${baseDoChat()}/r/${codigo}`);
  await expect(quadro(page)).toHaveAttribute('allow', PERMISSOES);
  await expect(quadro(page)).toHaveAttribute('title', 'Reunião');
  await expect(quadro(page)).toBeFocused();
  // Os botões da barra vêm antes do iframe na ordem do Tab.
  expect(await page.evaluate(() => {
    const barra = document.querySelector('.reuniao .titlebar')!;
    const quadro = document.querySelector('iframe[title="Reunião"]')!;
    return (barra.compareDocumentPosition(quadro) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })).toBe(true);
  // A página de verdade recebe o passe e abre a entrada, com o colega reconhecido.
  const dentro = page.frameLocator('iframe[title="Reunião"]');
  await expect(dentro.getByText('Você entra como', { exact: true })).toBeVisible();
  await expect(barra(page)).not.toContainText(OCUPADO);
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  // A tela de baixo (a lista) fica inerte: fora do alcance do teclado e do leitor de tela.
  await expect(page.locator('[inert] .reun')).toHaveCount(1);
});

test('o passe vai na mensagem, e cada pronta ganha um passe novo', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  const passes = await contarOsPasses(page);
  await abrir(page, pessoas[0]);
  const s = await estado(page);
  await botaoEntrar(page).click();

  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  const [primeiro] = await passesDaPagina(pagina);
  expect(primeiro.passe).toMatch(FORMATO_DO_PASSE);
  expect(primeiro.aparelhos).toEqual({
    microfone: s.audio.microfone,
    altoFalante: s.audio.altoFalante,
    camera: s.video.camera,
  });
  expect(Object.keys(primeiro).sort()).toEqual(['aparelhos', 'passe', 'starsonic', 'tipo']);
  // O passe nunca vai no endereço do iframe.
  expect(await quadro(page).getAttribute('src')).not.toContain(primeiro.passe);
  expect(passes.pedidos()).toBe(1);

  await pagina.mandar({ tipo: 'pronta' });
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(2);
  const [, segundo] = await passesDaPagina(pagina);
  expect(segundo.passe).toMatch(FORMATO_DO_PASSE);
  expect(segundo.passe).not.toBe(primeiro.passe);
  expect(passes.pedidos()).toBe(2);
});

test('os aparelhos trocados nas Configurações vão à página', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  const s = await estado(page);

  await mudarEstado(page, (e) => ({ ...e, audio: { ...e.audio, microfone: 'Microfone da mesa' } }));
  await expect
    .poll(async () => (await pagina.recebidas()).filter((m) => (m as { tipo?: string }).tipo === 'aparelhos'))
    .toEqual([
      {
        starsonic: 1,
        tipo: 'aparelhos',
        aparelhos: { microfone: 'Microfone da mesa', altoFalante: s.audio.altoFalante, camera: s.video.camera },
      },
    ]);
  await mudarEstado(page, (e) => ({ ...e, video: { ...e.video, camera: 'Câmera USB' } }));
  await expect
    .poll(async () => (await pagina.recebidas()).filter((m) => (m as { tipo?: string }).tipo === 'aparelhos').length)
    .toBe(2);
  const ultima = (await pagina.recebidas()).at(-1) as { aparelhos: Record<string, string> };
  expect(ultima.aparelhos).toEqual({
    microfone: 'Microfone da mesa',
    altoFalante: s.audio.altoFalante,
    camera: 'Câmera USB',
  });
  // Um estado que não muda os aparelhos não manda nada.
  await mudarEstado(page, (e) => ({ ...e, tecladoVez: e.tecladoVez }));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect((await pagina.recebidas()).filter((m) => (m as { tipo?: string }).tipo === 'aparelhos')).toHaveLength(2);
});

test('o pronta no meio da reunião ganha um passe novo e não tira a pessoa da reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await expect(barra(page)).toContainText(OCUPADO);
  await pagina.marcar();

  await pagina.mandar({ tipo: 'pronta' });
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(2);
  await expect(barra(page)).toContainText(OCUPADO);
  // O mesmo documento, e o Entrar não foi refeito (um videoWindow só).
  expect(await pagina.marcada()).toBe(true);
  expect(await doTipo(page, 'videoWindow')).toEqual([{ v: 1, cmd: 'videoWindow', modo: 'grande' }]);
});

test('o link do chat da reunião abre no navegador', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);

  await pagina.mandar({ tipo: 'link', url: 'https://exemplo.com/a' });
  await esperarComando(page, { cmd: 'reuniaoLink', url: 'https://exemplo.com/a' });
  // O que não é http nem https, o que passa de 2.048 caracteres e o que não é texto não vão.
  await pagina.mandar({ tipo: 'link', url: 'javascript:alert(1)' });
  await pagina.mandar({ tipo: 'link', url: `https://exemplo.com/${'a'.repeat(2049 - 'https://exemplo.com/'.length)}` });
  await pagina.mandar({ tipo: 'link', url: 42 });
  await pagina.mandar({ tipo: 'link' });
  // Os 2.048 exatos vão.
  const limite = `https://exemplo.com/${'b'.repeat(2048 - 'https://exemplo.com/'.length)}`;
  await pagina.mandar({ tipo: 'link', url: limite });
  await esperarComando(page, { cmd: 'reuniaoLink', url: limite });
  expect((await doTipo(page, 'reuniaoLink')).map((c) => c.url)).toEqual(['https://exemplo.com/a', limite]);
});

test('a mensagem de outra janela ou de outra origem não vale', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);

  // Um segundo iframe da origem do chat, pela mesma rota, e a própria janela do app mandam o estado.
  await page.evaluate((url) => {
    const outro = document.createElement('iframe');
    outro.id = 'intruso';
    outro.src = url;
    document.body.append(outro);
  }, `${baseDoChat()}/r/${codigo}`);
  const intruso = await (await page.locator('#intruso').elementHandle())!.contentFrame();
  await intruso!.waitForLoadState('domcontentloaded');
  const estadoNaReuniao = { starsonic: 1, tipo: 'estado', fase: 'naReuniao', microfone: true };
  await intruso!.evaluate((m) => parent.postMessage(m, '*'), estadoNaReuniao);
  await page.evaluate((m) => window.postMessage(m, '*'), estadoNaReuniao);
  // A do iframe da reunião, mas sem o "starsonic": 1, com outro número, e com um tipo que o app não conhece.
  const ofuscadas = [
    { tipo: 'estado', fase: 'naReuniao', microfone: true },
    { starsonic: 2, tipo: 'estado', fase: 'naReuniao', microfone: true },
    { starsonic: 1, tipo: 'inventado', fase: 'naReuniao', microfone: true },
    { starsonic: 1, tipo: 'estado', fase: 'outra', microfone: true },
  ];
  const elemento = await quadro(page).elementHandle();
  const daReuniao = (await elemento!.contentFrame())!;
  for (const m of ofuscadas) await daReuniao.evaluate((m) => parent.postMessage(m, '*'), m);
  // O sentinela: uma mensagem que vale, depois delas.
  await pagina.mandar({ tipo: 'link', url: 'https://exemplo.com/sentinela' });
  await esperarComando(page, { cmd: 'reuniaoLink', url: 'https://exemplo.com/sentinela' });
  await expect(barra(page)).not.toContainText(OCUPADO);
  // O segundo iframe também manda um pronta (a página de teste manda ao carregar): nenhum passe a mais.
  expect(await passesDaPagina(pagina)).toHaveLength(1);
});

test('o Ocupado · em reunião só com a pessoa na reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  await expect(barra(page)).toContainText('Conectado');

  await pagina.mandar({ tipo: 'estado', fase: 'entrada', microfone: false });
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await expect(barra(page)).toContainText(OCUPADO);
  await expect(barra(page)).not.toContainText('Conectado');
  await pagina.mandar({ tipo: 'estado', fase: 'fora', microfone: false });
  await expect(barra(page)).not.toContainText(OCUPADO);
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await expect(barra(page)).toContainText(OCUPADO);
  await pagina.mandar({ tipo: 'estado', fase: 'entrada', microfone: false });
  await expect(barra(page)).not.toContainText(OCUPADO);
});

/** Abre a reunião na página sem o pronta, com o relógio da página parado, e deixa o iframe carregar. */
async function semPronta(page: Page, pessoa: { chave: string; api: Parameters<typeof marcar>[0] }) {
  const codigo = await marcarHoje(pessoa.api);
  const pagina = await paginaFalsa(page, codigo, { semPronta: true });
  await page.clock.install({ time: meioDiaDeHoje() });
  await abrirNasReunioes(page, { chave: pessoa.chave, ...RECEPCAO });
  await pararORelogio(page);
  await botaoEntrar(page).click();
  await expect(quadro(page)).toBeVisible();
  await pagina.marcar();
  expect(await pagina.marcada()).toBe(true);
  return { codigo, pagina };
}

const titulo = (page: Page) => page.getByRole('heading', { name: NAO_ABRIU });

test('sem o pronta em 15 s, A reunião não abriu, com Tentar de novo', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const passes = await contarOsPasses(page);
  const { pagina } = await semPronta(page, pessoas[0]);
  expect(passes.pedidos()).toBe(1);
  await page.clock.runFor(14_900);
  await expect(titulo(page)).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(titulo(page)).toBeVisible();
  await expect(quadro(page)).toHaveCount(0);
  const botoes = page.getByRole('button').filter({ hasText: /^(Tentar de novo|Fechar|Abrir no navegador)$/ });
  await expect(botoes).toHaveText(['Tentar de novo', 'Fechar', 'Abrir no navegador']);

  await botao(page, 'Tentar de novo').click();
  await expect(quadro(page)).toBeVisible();
  await expect(titulo(page)).toHaveCount(0);
  expect(passes.pedidos()).toBe(2);
  // Um documento novo, sem a marca, e os 15 s de novo.
  expect(await pagina.marcada()).toBe(false);
  await pagina.marcar();
  await page.clock.runFor(14_900);
  await expect(titulo(page)).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(titulo(page)).toBeVisible();
});

test('o Fechar de A reunião não abriu volta à aba Reuniões', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await semPronta(page, pessoas[0]);
  await page.clock.runFor(15_000);
  await expect(titulo(page)).toBeVisible();
  await expect(titulo(page)).toBeFocused();

  await botao(page, 'Fechar').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await expect(titulo(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
  await expect(botaoEntrar(page)).toBeVisible();
  // Nada de sair da reunião: ela não chegou a abrir.
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
});

test('o Abrir no navegador de A reunião não abriu abre a reunião lá e fecha a vista', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const { codigo } = await semPronta(page, pessoas[0]);
  await page.clock.runFor(15_000);
  await expect(titulo(page)).toBeVisible();

  await botao(page, 'Abrir no navegador').click();
  await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(1);
  const [comando] = await doTipo(page, 'reuniaoNavegador');
  expect(comando.codigo).toBe(codigo);
  expect(comando.passe).toMatch(FORMATO_DO_PASSE);
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await expect(titulo(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
});

/** Segura o primeiro pedido do passe até o `soltar`; os seguintes seguem. */
async function segurarOPrimeiro(page: Page): Promise<{ soltar(): void; pedidos(): number }> {
  let n = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(ePasse, async (rota) => {
    n += 1;
    if (n === 1) await solto;
    await rota.continue();
  });
  return { soltar, pedidos: () => n };
}

/** Abre a reunião sem o pronta e espera "A reunião não abriu." (com o relógio parado). */
async function ateONaoAbriu(page: Page, pessoa: { chave: string; api: Parameters<typeof marcar>[0] }) {
  const r = await semPronta(page, pessoa);
  await page.clock.runFor(15_000);
  await expect(titulo(page)).toBeVisible();
  return r;
}

test('o Fechar com a aba já sumida não leva à aba quando ela volta', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await ateONaoAbriu(page, pessoas[0]);
  // O Tentar de novo recebe o semReunioes: a aba some com a vista ainda aberta.
  const semReunioes = { status: 403, json: { erro: 'semReunioes' } };
  await page.route(ePasse, (rota) => rota.fulfill(semReunioes));
  await page.route((url) => url.pathname === '/api/v1/reunioes', (rota) => rota.fulfill(semReunioes));
  await botao(page, 'Tentar de novo').click();
  await expect(page.locator('nav.nav button.tab-reunioes')).toHaveCount(0);
  await botao(page, 'Fechar').click();
  await expect(titulo(page)).toHaveCount(0);
  // As reuniões voltam (a pergunta se repete a cada 5 minutos): a pessoa fica onde estava, no Teclado.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.clock.runFor(300_000);
  await expect(page.locator('nav.nav button.tab-reunioes')).toBeVisible();
  await expect(page.locator('nav.nav button.tab[aria-current="page"]')).toHaveText('Teclado');
});

test('o Entrar depois do Fechar não espera um Tentar de novo ainda no ar', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await ateONaoAbriu(page, pessoas[0]);
  const passes = await segurarOPrimeiro(page);
  await botao(page, 'Tentar de novo').click();
  await expect.poll(() => passes.pedidos()).toBe(1);
  await botao(page, 'Fechar').click();
  await expect(botaoEntrar(page)).toBeVisible();
  await botaoEntrar(page).click();
  await expect(quadro(page)).toBeVisible();
  expect(passes.pedidos()).toBe(2);
  // A resposta do Tentar de novo de antes não mexe na vista nova.
  passes.soltar();
  // O relógio da página está parado: uma ida ao servidor dá tempo de o app tratar a resposta.
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await expect(quadro(page)).toBeVisible();
  await expect(titulo(page)).toHaveCount(0);
});

test('o Abrir no navegador que volta depois do Fechar não fecha a vista nova', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await ateONaoAbriu(page, pessoas[0]);
  const passes = await segurarOPrimeiro(page);
  await botao(page, 'Abrir no navegador').click();
  await expect.poll(() => passes.pedidos()).toBe(1);
  await botao(page, 'Fechar').click();
  await botaoEntrar(page).click();
  await expect(quadro(page)).toBeVisible();
  passes.soltar();
  await expect.poll(async () => (await doTipo(page, 'reuniaoNavegador')).length).toBe(1);
  // O relógio da página está parado: uma ida ao servidor dá tempo de o app tratar a resposta.
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await expect(quadro(page)).toBeVisible();
  expect(await doTipo(page, 'videoWindow')).toEqual([
    { v: 1, cmd: 'videoWindow', modo: 'grande' },
    { v: 1, cmd: 'videoWindow', modo: 'normal' },
    { v: 1, cmd: 'videoWindow', modo: 'grande' },
  ]);
});

test('o Tentar de novo ocupado fica aria-disabled e ignora o clique', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  await ateONaoAbriu(page, pessoas[0]);
  const passes = await segurarOPrimeiro(page);
  await botao(page, 'Tentar de novo').click();
  await expect(botao(page, 'Tentar de novo')).toHaveAttribute('aria-disabled', 'true');
  await expect(botao(page, 'Tentar de novo')).toHaveJSProperty('disabled', false);
  await botao(page, 'Tentar de novo').click({ force: true });
  expect(passes.pedidos()).toBe(1);
  passes.soltar();
  await expect(quadro(page)).toBeVisible();
});

test('o Entrar do menu no Mínimo, ocupado, fica aria-disabled e ignora o clique', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  await paginaFalsa(page, codigo);
  const passes = await segurarOPrimeiro(page);
  await page.setViewportSize({ width: 300, height: 440 });
  await abrir(page, pessoas[0]);
  const mais = page.getByRole('button', { name: `Mais opções de ${PLANEJAMENTO}` });
  const item = page.getByRole('menuitem', { name: 'Entrar', exact: true });
  await mais.click();
  await item.click();
  await expect.poll(() => passes.pedidos()).toBe(1);
  await mais.click();
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toHaveJSProperty('disabled', false);
  await item.click({ force: true });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(passes.pedidos()).toBe(1);
  passes.soltar();
  await expect(quadro(page)).toBeVisible();
});

test('a tela cheia e a volta não recriam a reunião', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  await pagina.marcar();

  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  await expect(botao(page, 'Tela cheia')).toHaveCount(0);
  await botao(page, 'Sair da tela cheia').click();
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  expect((await doTipo(page, 'videoWindow')).map((c) => c.modo)).toEqual(['grande', 'telaCheia', 'grande']);
  expect(await pagina.marcada()).toBe(true);
  expect(await passesDaPagina(pagina)).toHaveLength(1);
});

/**
 * Um clique no Entrar que já estava a caminho quando a ligação chegou: o botão guardado da lista continua com o clique
 * (a lista sai da tela com a ligação, e o Entrar do link de fora da lista é da Task 4).
 */
async function guardarOsBotoes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const botoes = [...document.querySelectorAll('article')].map(
      (a) => [...a.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Entrar')!,
    );
    (window as unknown as { botoes: HTMLElement[] }).botoes = botoes;
  });
}
const clicarNoGuardado = (page: Page, i: number) =>
  page.evaluate((i) => (window as unknown as { botoes: HTMLElement[] }).botoes[i].click(), i);

const CARTAO = { id: 51, number: '2003', name: 'Ana Souza', incoming: true, held: false };
const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };
const LIGACAO = (phase: 'active' | 'ringing', sala: object | null = null) => ({
  top: { ...CARTAO, phase, activeSinceMs: phase === 'active' ? Date.now() - 5_000 : 0, video: SEM_VIDEO },
  second: null,
  secondKind: 'none',
  muted: false,
  conference: false,
  conferenceSinceMs: 0,
  consulting: false,
  colleagueActive: false,
  sala,
});
const SALA = { id: 51, fora: false, cheia: false, participantes: [] };

for (const [nome, ligacao] of [
  ['a ligação atendida', LIGACAO('active')],
  ['a ligação tocando', LIGACAO('ringing')],
  ['a sala de vídeo de pé', LIGACAO('active', SALA)],
] as const) {
  test(`${nome} impede o Entrar, sem pedir o passe`, async ({ page }) => {
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    await marcarHoje(pessoas[0].api);
    const passes = await contarOsPasses(page);
    await abrir(page, pessoas[0]);
    await expect(botaoEntrar(page)).toBeVisible();
    await guardarOsBotoes(page);
    await mudarEstado(page, (s) => ({ ...s, ligacao }));
    await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toHaveCount(0);

    await clicarNoGuardado(page, 0);
    await expect(page.getByText(DESLIGUE, { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    expect(passes.pedidos()).toBe(0);
    expect(await doTipo(page, 'videoWindow')).toEqual([]);
    await expect(quadro(page)).toHaveCount(0);
  });
}

test('com uma reunião na vista, o Entrar de outra é recusado e o da mesma só a mostra', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const primeira = await marcarHoje(pessoas[0].api);
  await marcar(pessoas[0].api, noRelogioDaPagina(0, 15, 0), OUTRA);
  const pagina = await paginaFalsa(page, primeira);
  const passes = await contarOsPasses(page);
  await abrir(page, pessoas[0]);
  await expect(page.getByRole('article')).toHaveCount(2);
  await guardarOsBotoes(page);
  await botaoEntrar(page, 0).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  expect(passes.pedidos()).toBe(1);

  // A outra reunião: o aviso curto, sem passe.
  await clicarNoGuardado(page, 1);
  await expect(page.getByText(SAIA, { exact: true })).toBeVisible();
  // A mesma: só a mostra, sem outro passe nem outro videoWindow.
  await clicarNoGuardado(page, 0);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  expect(passes.pedidos()).toBe(1);
  expect(await doTipo(page, 'videoWindow')).toEqual([{ v: 1, cmd: 'videoWindow', modo: 'grande' }]);
  await expect(quadro(page)).toHaveCount(1);
});

test('um segundo Entrar com o passe no ar não pede outro', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  await paginaFalsa(page, codigo);
  let pedidos = 0;
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await page.route(ePasse, async (rota) => {
    pedidos += 1;
    await solto;
    await rota.continue();
  });
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  // O botão ocupado fica com o foco: aria-disabled, nunca disabled, e o clique não faz nada.
  await expect(botaoEntrar(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(botaoEntrar(page)).toHaveJSProperty('disabled', false);
  await expect(botaoEntrar(page)).toBeFocused();
  // O Playwright não clica no que tem aria-disabled: o clique é forçado.
  await botaoEntrar(page).click({ force: true });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(pedidos).toBe(1);
  soltar();
  await expect(quadro(page)).toBeVisible();
  expect(pedidos).toBe(1);
});

test('o erro do passe aparece na aba, e a reunião de outra empresa oferece o navegador', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  let resposta = { status: 429, json: { erro: 'muitasTentativas', esperarSegundos: 30 } as object };
  await page.route(ePasse, (rota) => rota.fulfill(resposta));
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect(page.getByRole('alert')).toHaveText(MUITAS);
  await expect(quadro(page)).toHaveCount(0);
  expect(await doTipo(page, 'videoWindow')).toEqual([]);
  // O botão volta a valer, e um Entrar novo tira o erro de antes.
  await expect(botaoEntrar(page)).not.toHaveAttribute('aria-disabled', 'true');
  resposta = { status: 403, json: { erro: 'outraEmpresa' } };
  await botaoEntrar(page).click();
  await expect(page.getByRole('alert')).toHaveText(OUTRA_EMPRESA);
  expect(await doTipo(page, 'reuniaoNavegador')).toEqual([]);
  // O Abrir no navegador do erro abre como convidado, sem o passe.
  await botao(page, 'Abrir no navegador').click();
  await expect.poll(async () => await doTipo(page, 'reuniaoNavegador')).toEqual([
    { v: 1, cmd: 'reuniaoNavegador', codigo },
  ]);
  await expect(page.getByRole('alert')).toHaveText('');
  await expect(quadro(page)).toHaveCount(0);
});

test('nada da reunião vai ao console', async ({ page }) => {
  const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
  const codigo = await marcarHoje(pessoas[0].api);
  const linhas: string[] = [];
  page.on('console', (m) => linhas.push(m.text()));
  page.on('pageerror', (e) => linhas.push(String(e)));
  const pagina = await paginaFalsa(page, codigo);
  await abrir(page, pessoas[0]);
  await botaoEntrar(page).click();
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
  const [{ passe }] = await passesDaPagina(pagina);
  await pagina.mandar({ tipo: 'estado', fase: 'naReuniao', microfone: true });
  await pagina.mandar({ tipo: 'link', url: 'https://exemplo.com/segredo' });
  await pagina.mandar({ tipo: 'pronta' });
  await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(2);
  await pagina.mandar({ tipo: 'inventado' });
  await botao(page, 'Tela cheia').click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  const tudo = linhas.join('\n');
  for (const segredo of [codigo, passe, 'segredo', PLANEJAMENTO, '/r/']) expect(tudo).not.toContain(segredo);
});

for (const tema of ['light', 'dark'] as const) {
  test(`a vista não tem violações sérias (${nomeDoTema(tema)})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    const codigo = await marcarHoje(pessoas[0].api);
    const pagina = await paginaFalsa(page, codigo);
    await abrir(page, pessoas[0]);
    await botaoEntrar(page).click();
    await expect.poll(async () => (await passesDaPagina(pagina)).length).toBe(1);
    await expect(quadro(page)).toBeFocused();
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-vista', tema);
  });

  test(`A reunião não abriu não tem violações sérias (${nomeDoTema(tema)})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    const { pessoas } = await empresaComReunioes(EMPRESA, [RECEPCAO]);
    await semPronta(page, pessoas[0]);
    await page.clock.runFor(15_000);
    await expect(titulo(page)).toBeVisible();
    // O axe usa os temporizadores da página: o relógio parado o seguraria.
    await page.clock.resume();
    await semViolacoesSerias(page);
    await capturar(page, 'reuniao-nao-abriu', tema);
  });
}
