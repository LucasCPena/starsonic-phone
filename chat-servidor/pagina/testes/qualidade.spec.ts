// O sinalizador de qualidade da reunião, no Chromium, na reunião de mentira (reuniao-falsa.ts): o botão no alto da
// tela, o cartão que ele abre e o aviso de conexão ruim. Quem entra é a Maria Lima, e o palco é o TRES. Os números da
// ligação são de mentira (o comARede): a página os lê a cada 2 s, e o relógio dela só anda quando o teste manda (o
// medir). A conta do sinalizador tem os testes dela em qualidade.test.mjs, e o cérebro, em estado.test.mjs.
import { expect, test, type Page } from '@playwright/test';
import {
  ANA,
  CARLOS,
  SEM_CONEXAO,
  TRES,
  area,
  botao,
  caixa,
  camDe,
  cartaoDaQueda,
  comARede,
  conferir,
  darNaLigacao,
  dentro,
  doConsole,
  leituras,
  medir,
  naReuniaoCom,
  quadro,
  subir,
  titulo,
  vigiar,
  voltar,
  type NaReuniao,
  type RedeDeMentira,
} from '../reuniao-falsa';

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// O sinalizador não escreve nada no console: nos testes daqui, ele fica vazio.
test.afterEach(async ({ page }) => {
  await conferir(page);
  expect(doConsole(page)).toEqual([]);
});

// ---- O sinalizador e as peças dele. ----

const sinal = (page: Page) => page.locator('button[data-botao="qualidade"]');
const textoDoSinal = (page: Page) => sinal(page).locator('.sinal-texto');
const barras = (page: Page) => sinal(page).locator('.barra');
const cartao = (page: Page) => page.locator('#sinal-cartao');
const tituloDoCartao = (page: Page) => cartao(page).locator('.sinal-titulo');
const explicacao = (page: Page) => cartao(page).locator('.sinal-explicacao');
const dicas = (page: Page) => cartao(page).locator('.sinal-dicas > li:visible');
const numeros = (page: Page) => cartao(page).locator('.sinal-numeros');
const gravado = (page: Page) => page.getByText('Nada é gravado', { exact: true });
const aviso = (page: Page) => page.locator('.aviso-curto');
const linhaDoAviso = (page: Page) => aviso(page).locator('.aviso-curto-linha');
const verOsDetalhes = (page: Page) => aviso(page).getByRole('button', { name: 'Ver os detalhes', exact: true });
/** O aviso mais novo da região que os leitores de tela anunciam. */
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"] > :last-child');
/** A região inteira, a que os leitores de tela anunciam. */
const regiaoFalada = (page: Page) => page.locator('[data-campo="anuncio"]');
const painel = (page: Page) => page.getByRole('complementary', { name: 'Chat da reunião' });

// As redes de mentira: cada uma leva a um estado.
const BOA: RedeDeMentira = { perda: 0, atraso: 45 };
const INSTAVEL: RedeDeMentira = { perda: 0.04, atraso: 210 };
const RUIM: RedeDeMentira = { perda: 0.12, atraso: 640 };

const DICAS = [
  'Chegue mais perto do Wi-Fi, ou use o cabo de rede.',
  'Feche downloads e vídeos em outros programas.',
  'Se continuar, desligue a câmera: só o som precisa de bem menos internet.',
];

type Estado = 'medindo' | 'boa' | 'instavel' | 'ruim';

interface Desenho {
  texto: string;
  /** O nome do botão, para o leitor de tela. */
  nome: string;
  borda: string;
  fundo: string;
  letra: string;
  peso: string;
  /** Quantas barras estão acesas, na cor da letra; as outras ficam na cor apagada. */
  acesas: number;
  apagada: string;
  titulo: string;
  explicacao: string;
  dicas: number;
}

const SEM_FUNDO = 'rgba(0, 0, 0, 0)';

/** O desenho de cada estado (o quadro, tela 22) e os textos dele (a seção 4.4 do desenho). */
const DESENHOS: Record<Estado, Desenho> = {
  medindo: {
    texto: 'Medindo a conexão…',
    nome: 'Medindo a conexão',
    borda: 'rgb(44, 55, 87)',
    fundo: SEM_FUNDO,
    letra: 'rgb(154, 166, 201)',
    peso: '600',
    acesas: 0,
    apagada: 'rgb(58, 68, 102)',
    titulo: 'Medindo a conexão…',
    explicacao: 'Os números aparecem aqui em alguns segundos.',
    dicas: 0,
  },
  boa: {
    texto: 'Conexão boa',
    nome: 'Conexão boa. Ver os detalhes',
    borda: 'rgb(44, 55, 87)',
    fundo: SEM_FUNDO,
    letra: 'rgb(185, 196, 230)',
    peso: '600',
    acesas: 3,
    apagada: '',
    titulo: 'Sua conexão está boa',
    explicacao: 'A imagem e o som estão chegando bem.',
    dicas: 0,
  },
  instavel: {
    texto: 'Conexão instável',
    nome: 'Conexão instável. Ver os detalhes',
    borda: 'rgb(255, 183, 3)',
    fundo: SEM_FUNDO,
    letra: 'rgb(255, 209, 102)',
    peso: '700',
    acesas: 2,
    apagada: 'rgb(58, 68, 102)',
    titulo: 'Sua conexão está instável',
    explicacao: 'A imagem ou o som podem falhar de vez em quando.',
    dicas: 2,
  },
  ruim: {
    texto: 'Conexão ruim',
    nome: 'Conexão ruim. Ver os detalhes',
    borda: 'rgb(255, 138, 138)',
    fundo: 'rgb(42, 16, 22)',
    letra: 'rgb(255, 179, 179)',
    peso: '700',
    acesas: 1,
    apagada: 'rgb(74, 48, 64)',
    titulo: 'Sua conexão está ruim',
    explicacao: 'Os outros podem não ver ou ouvir você direito, e a imagem deles pode travar para você.',
    dicas: 3,
  },
};

/** O botão no estado: o texto, o nome, as cores e as barras acesas. */
async function conferirOBotao(page: Page, estado: Estado): Promise<void> {
  const d = DESENHOS[estado];
  await expect(sinal(page)).toHaveAttribute('data-estado', estado);
  await expect(textoDoSinal(page)).toHaveText(d.texto);
  await expect(sinal(page)).toHaveAccessibleName(d.nome);
  await expect(sinal(page)).toHaveCSS('border-top-color', d.borda);
  await expect(sinal(page)).toHaveCSS('border-top-width', '1px');
  await expect(sinal(page)).toHaveCSS('background-color', d.fundo);
  await expect(sinal(page)).toHaveCSS('color', d.letra);
  await expect(sinal(page)).toHaveCSS('font-weight', d.peso);
  await expect(barras(page)).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(barras(page).nth(i), `a barra ${i + 1}`).toHaveCSS('fill', i < d.acesas ? d.letra : d.apagada);
  }
}

/** O cartão aberto no estado: o título, a explicação, as dicas, os números (null sem eles) e a cor da borda. */
async function conferirOCartao(page: Page, estado: Estado, osNumeros: string | null): Promise<void> {
  const d = DESENHOS[estado];
  await expect(cartao(page)).toBeVisible();
  await expect(sinal(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(tituloDoCartao(page)).toHaveText(d.titulo);
  await expect(explicacao(page)).toHaveText(d.explicacao);
  await expect(dicas(page)).toHaveText(DICAS.slice(0, d.dicas));
  // Sem números, a linha deles sai do cartão (o hidden): vazia, ela ainda deixaria um espaço embaixo.
  await expect(numeros(page)).toHaveJSProperty('hidden', osNumeros === null);
  await expect(numeros(page)).toHaveText(osNumeros ?? '');
  await expect(cartao(page).locator('.sinal-dicas')).toHaveJSProperty('hidden', d.dicas === 0);
  await expect(cartao(page)).toHaveCSS('border-top-color', d.borda);
}

/**
 * Na reunião, com a rede dada e o sinalizador já fora do medindo: a primeira leitura com números é só a base, e as
 * duas medidas seguintes dizem o estado.
 */
async function comOSinal(page: Page, rede: RedeDeMentira = BOA): Promise<NaReuniao> {
  const r = await naReuniaoCom(page, TRES);
  await comARede(page, rede);
  await medir(page, 3);
  return r;
}

/** A rede muda, e o sinalizador a acompanha: 2 medidas para piorar, 5 para melhorar. */
async function mudarARede(page: Page, rede: RedeDeMentira, medidas: number): Promise<void> {
  await comARede(page, rede);
  await medir(page, medidas);
}

/** As duas caixas não se tocam. */
function separadas(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
}

/** O ponto do meio do elemento é dele: nada o cobre. */
const porCima = (page: Page, seletor: string) =>
  page.locator(seletor).evaluate((el) => {
    const c = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2));
  });

// ---- No PC (1280×800). ----

test('o sinalizador começa medindo e passa a Conexão boa', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await expect(sinal(page)).toBeVisible();
  await expect(textoDoSinal(page)).toHaveText('Medindo a conexão…');
  await expect(botao(page, 'Medindo a conexão')).toBeVisible();
  await expect(sinal(page)).toHaveAttribute('data-estado', 'medindo');
  await expect(sinal(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(sinal(page)).toHaveAttribute('aria-controls', 'sinal-cartao');
  await expect(cartao(page)).toBeHidden();
  // No alto, antes do "Nada é gravado", com 14 px entre os dois; o botão tem 36 px de altura, e o desenho, 16 px.
  const s = await caixa(sinal(page));
  const g = await caixa(page.locator('.selo-gravado'));
  expect(g.x - (s.x + s.width)).toBeCloseTo(14, 0);
  expect(s.height).toBe(36);
  expect(g.x + g.width).toBe(1280 - 24);
  const desenho = await caixa(sinal(page).locator('svg'));
  expect([desenho.width, desenho.height]).toEqual([16, 16]);
  await expect(sinal(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');

  // Com a rede boa: a primeira leitura é só a base, a primeira medida ainda mostra o medindo, e a segunda, o estado.
  await comARede(page, BOA);
  await medir(page, 2);
  await expect(textoDoSinal(page)).toHaveText('Medindo a conexão…');
  await medir(page);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await expect(botao(page, 'Conexão boa. Ver os detalhes')).toBeVisible();
  await expect(sinal(page)).toHaveAttribute('data-estado', 'boa');
  // Nenhum aviso, e nada dito ao leitor de tela: só a conexão ruim avisa.
  await expect(aviso(page)).toBeHidden();
  await expect(anuncio(page)).toHaveText('Planejamento de dezembro');
});

test('os quatro estados, com o desenho e o texto', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await conferirOBotao(page, 'medindo');
  await comARede(page, BOA);
  await medir(page, 3);
  await conferirOBotao(page, 'boa');
  // A perda de 4%: duas medidas piores, e o estado piora.
  await mudarARede(page, INSTAVEL, 1);
  await conferirOBotao(page, 'boa');
  await medir(page);
  await conferirOBotao(page, 'instavel');
  // A perda de 12%.
  await mudarARede(page, RUIM, 2);
  await conferirOBotao(page, 'ruim');
  // O tamanho do botão não muda com o estado: a letra é a mesma, e a borda também.
  expect((await caixa(sinal(page))).height).toBe(36);
});

test('o cartão de cada estado', async ({ page }) => {
  await naReuniaoCom(page, TRES);
  await sinal(page).click();
  await conferirOCartao(page, 'medindo', null);
  // Com o cartão aberto, as medidas chegam a ele. No medindo, nem a primeira medida mostra os números.
  await comARede(page, BOA);
  await medir(page, 2);
  await conferirOCartao(page, 'medindo', null);
  await medir(page);
  await conferirOCartao(page, 'boa', 'Perda: 0% · Atraso: 45 ms');
  await mudarARede(page, INSTAVEL, 2);
  await conferirOCartao(page, 'instavel', 'Perda: 4% · Atraso: 210 ms');
  // Os números mudam a cada medida, arredondados para o inteiro; o que o navegador não dá aparece como "—". O atraso é
  // o menor das duas últimas amostras: a amostra nova só aparece sozinha na medida seguinte.
  await mudarARede(page, { perda: 0.04, atraso: 299.6 }, 1);
  await conferirOCartao(page, 'instavel', 'Perda: 4% · Atraso: 210 ms');
  await medir(page);
  await conferirOCartao(page, 'instavel', 'Perda: 4% · Atraso: 300 ms');
  await mudarARede(page, { perda: 0.04 }, 1);
  await conferirOCartao(page, 'instavel', 'Perda: 4% · Atraso: —');
  await mudarARede(page, RUIM, 2);
  await conferirOCartao(page, 'ruim', 'Perda: 12% · Atraso: 640 ms');
  await conferirOBotao(page, 'ruim');
  // Com o cartão aberto, a conexão que vira ruim não mostra o aviso: a pessoa já está olhando os detalhes.
  await expect(aviso(page)).toBeHidden();
});

test('o cartão abre embaixo do botão, por cima da área dos quadros', async ({ page }) => {
  await comOSinal(page, INSTAVEL);
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  const s = await caixa(sinal(page));
  const c = await caixa(cartao(page));
  // A 8 px do botão, alinhado à direita dele, com 340 px.
  expect(c.y - (s.y + s.height)).toBeCloseTo(8, 0);
  expect(c.x + c.width).toBeCloseTo(s.x + s.width, 0);
  expect(c.width).toBe(340);
  // Ele passa por cima da área dos quadros, sem empurrar nada: a área não muda de lugar nem de tamanho.
  const a = await caixa(area(page));
  expect(c.y + c.height).toBeGreaterThan(a.y);
  expect(await porCima(page, '#sinal-cartao')).toBe(true);
  await sinal(page).click();
  await expect(cartao(page)).toBeHidden();
  expect(await caixa(area(page))).toEqual(a);
  // O que o cartão mostra: o título mais forte, a explicação, as dicas com marcadores e os números mais apagados.
  await sinal(page).click();
  await expect(tituloDoCartao(page)).toHaveCSS('font-size', '15px');
  await expect(tituloDoCartao(page)).toHaveCSS('font-weight', '800');
  await expect(explicacao(page)).toHaveCSS('font-size', '14px');
  await expect(explicacao(page)).toHaveCSS('color', 'rgb(223, 229, 245)');
  await expect(dicas(page).first()).toHaveCSS('list-style-type', 'disc');
  await expect(dicas(page).first()).toHaveCSS('font-size', '14px');
  await expect(numeros(page)).toHaveCSS('font-size', '12.5px');
  await expect(numeros(page)).toHaveCSS('color', 'rgb(154, 166, 201)');
  await expect(cartao(page)).toHaveCSS('background-color', 'rgb(17, 24, 48)');
});

test('o clique no botão, o Esc e o clique fora fecham o cartão', async ({ page }) => {
  await comOSinal(page);
  // O clique no botão abre e fecha, e o foco fica nele.
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  await expect(sinal(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(sinal(page)).toBeFocused();
  await sinal(page).click();
  await expect(cartao(page)).toBeHidden();
  await expect(sinal(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(sinal(page)).toBeFocused();
  // O teclado: o Enter no botão abre, outra tecla não fecha, e o Esc fecha, com o foco ainda no botão.
  await page.keyboard.press('Enter');
  await expect(cartao(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(cartao(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cartao(page)).toBeHidden();
  await expect(sinal(page)).toBeFocused();
  // O clique dentro do cartão não o fecha; o clique fora, sim.
  await sinal(page).click();
  await tituloDoCartao(page).click();
  await expect(cartao(page)).toBeVisible();
  await titulo(page, 'Planejamento de dezembro').click();
  await expect(cartao(page)).toBeHidden();
  // O clique fora num botão vale para os dois: o cartão fecha, e o botão faz o que faz.
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  await botao(page, 'Chat').click();
  await expect(cartao(page)).toBeHidden();
  await expect(painel(page)).toBeVisible();
});

test('o Esc com o cartão aberto fecha só o cartão', async ({ page }) => {
  await comOSinal(page);
  // Com um quadro aumentado: o primeiro Esc fecha o cartão, e o quadro continua aumentado; o segundo volta à grade.
  await quadro(page, camDe(ANA)).click();
  await expect(botao(page, 'Ver todos')).toBeVisible();
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cartao(page)).toBeHidden();
  await expect(botao(page, 'Ver todos')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(botao(page, 'Ver todos')).toBeHidden();

  // Com o chat aberto e o foco no campo dele: o primeiro Esc fecha o cartão, e o chat continua aberto.
  await botao(page, 'Chat').click();
  await expect(painel(page)).toBeVisible();
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  await page.getByLabel('Mensagem para todos da reunião', { exact: true }).focus();
  await expect(cartao(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cartao(page)).toBeHidden();
  await expect(painel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(painel(page)).toBeHidden();
});

test('o Esc que cancela uma composição não fecha o cartão', async ({ page }) => {
  await comOSinal(page);
  await sinal(page).click();
  await expect(cartao(page)).toBeVisible();
  // O Esc no meio de uma composição (o teclado de outra língua) é dela; e o que outro já tratou não fecha nada.
  const escDe = (como: { isComposing?: boolean; keyCode?: number; tratado?: boolean }) =>
    sinal(page).evaluate((b, como) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        isComposing: como.isComposing ?? false,
        keyCode: como.keyCode ?? 27,
      });
      if (como.tratado) ev.preventDefault();
      b.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, como);
  expect(await escDe({ isComposing: true })).toBe(false);
  await expect(cartao(page)).toBeVisible();
  expect(await escDe({ keyCode: 229 })).toBe(false);
  await expect(cartao(page)).toBeVisible();
  expect(await escDe({ tratado: true })).toBe(true);
  await expect(cartao(page)).toBeVisible();
  // O Esc de verdade fecha, e marca o evento como tratado.
  expect(await escDe({})).toBe(true);
  await expect(cartao(page)).toBeHidden();
  // Sem o cartão, o Esc não é do sinalizador.
  expect(await escDe({})).toBe(false);
});

// O critério 6 do desenho, com as medidas de mentira.
test('a perda de 10% vira Conexão ruim em até 10 s, e a rede boa de novo vira Conexão boa em até 20 s', async ({
  page,
}) => {
  await comOSinal(page);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');

  await comARede(page, { perda: 0.1, atraso: 45 });
  await page.clock.runFor(10_000);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await expect(sinal(page)).toHaveAttribute('data-estado', 'ruim');

  await comARede(page, BOA);
  // Ele não pisca: nos primeiros segundos da rede boa, continua ruim.
  await page.clock.runFor(8_000);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await page.clock.runFor(12_000);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await expect(sinal(page)).toHaveAttribute('data-estado', 'boa');
});

test('o aviso de conexão ruim, no máximo um a cada 2 minutos', async ({ page }) => {
  await comOSinal(page);
  await expect(aviso(page)).toBeHidden();

  // A virada para ruim: o aviso, com uma linha só e o Ver os detalhes, e o que o leitor de tela ouve.
  await mudarARede(page, RUIM, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await expect(aviso(page)).toBeVisible();
  // O aviso nasceu na medida, que foi nos últimos 2 s do relógio da página: os tempos daqui contam de agora, e cada
  // conferência deixa essa folga.
  const agora = () => page.evaluate(() => Date.now());
  const nasceu = await agora();
  const ate = async (ms: number) => page.clock.runFor(nasceu + ms - (await agora()));
  await expect(aviso(page)).toHaveAttribute('data-tipo', 'conexao');
  await expect(linhaDoAviso(page)).toHaveText('Sua conexão está ruim');
  await expect(linhaDoAviso(page)).toHaveCSS('font-size', '14px');
  await expect(linhaDoAviso(page)).toHaveCSS('font-weight', '700');
  await expect(aviso(page).locator('.aviso-curto-quem')).toHaveJSProperty('hidden', true);
  await expect(aviso(page)).toHaveCSS('border-top-color', 'rgb(255, 138, 138)');
  await expect(verOsDetalhes(page)).toBeVisible();
  await expect(aviso(page).getByRole('button')).toHaveText(['Ver os detalhes']);
  await expect(verOsDetalhes(page)).toHaveCSS('background-color', 'rgb(28, 37, 64)');
  await expect(verOsDetalhes(page)).toHaveCSS('border-top-color', 'rgb(44, 55, 87)');
  await expect(verOsDetalhes(page)).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect((await caixa(verOsDetalhes(page))).height).toBeGreaterThanOrEqual(44);
  await expect(anuncio(page)).toHaveText('Sua conexão está ruim');
  // No meio da área dos quadros, a 8 px do fundo dela, por cima deles.
  const a = await caixa(area(page));
  const t = await caixa(aviso(page));
  expect(Math.abs(t.x + t.width / 2 - (a.x + a.width / 2))).toBeLessThanOrEqual(2);
  expect(a.y + a.height - (t.y + t.height)).toBeCloseTo(8, 0);
  expect(t.width).toBe(440);
  expect(await porCima(page, '.aviso-curto')).toBe(true);

  // 5 s depois de nascer, ele some: aos 2.999 ms daqui ele ainda está, e aos 5.000 ms já saiu. O sinalizador continua
  // ruim.
  await ate(2_999);
  await expect(aviso(page)).toBeVisible();
  await ate(5_000);
  await expect(aviso(page)).toBeHidden();
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');

  // Boa e ruim de novo, 1 minuto depois: nenhum aviso.
  await mudarARede(page, BOA, 5);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await ate(60_000);
  await mudarARede(page, RUIM, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await expect(aviso(page)).toBeHidden();
  // Outra vez, com a virada entre os 114 e os 116 s: ainda dentro dos 2 minutos, e nenhum aviso.
  await mudarARede(page, BOA, 5);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await ate(112_000);
  await mudarARede(page, RUIM, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await expect(aviso(page)).toBeHidden();

  // Passados os 2 minutos (aos 126 s daqui), a virada seguinte avisa.
  await mudarARede(page, BOA, 5);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await expect(aviso(page)).toBeHidden();
  await mudarARede(page, RUIM, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
  await expect(aviso(page)).toBeVisible();
  await expect(linhaDoAviso(page)).toHaveText('Sua conexão está ruim');

  // O Ver os detalhes: o cartão abre, o aviso some, e o foco vai ao botão do sinalizador.
  await verOsDetalhes(page).click();
  await conferirOCartao(page, 'ruim', 'Perda: 12% · Atraso: 640 ms');
  await expect(aviso(page)).toBeHidden();
  await expect(sinal(page)).toBeFocused();
});

test('o leitor de tela ouve a conexão ruim uma vez só', async ({ page }) => {
  await comOSinal(page);
  // Cada texto que entra na região que os leitores de tela anunciam.
  await page.evaluate(() => {
    const w = window as unknown as { ditos: string[] };
    w.ditos = [];
    const regiao = document.querySelector('[data-campo="anuncio"]') as HTMLElement;
    new MutationObserver((mudancas) => {
      for (const m of mudancas) for (const no of m.addedNodes) w.ditos.push(no.textContent ?? '');
    }).observe(regiao, { childList: true });
  });
  const ditos = () => page.evaluate(() => (window as unknown as { ditos: string[] }).ditos);

  await mudarARede(page, RUIM, 2);
  await expect(aviso(page)).toBeVisible();
  await expect.poll(ditos).toEqual(['Sua conexão está ruim']);
  // As medidas seguintes desenham a tela de novo, com o aviso ainda nela: nada é dito outra vez.
  await medir(page, 2);
  await expect(aviso(page)).toBeVisible();
  expect(await ditos()).toEqual(['Sua conexão está ruim']);
  // Nem quando o aviso sai, nem quando a conexão melhora.
  await mudarARede(page, BOA, 5);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await expect(aviso(page)).toBeHidden();
  expect(await ditos()).toEqual(['Sua conexão está ruim']);
  // Quem fala é a região de sempre: o aviso que aparece não é uma região falada, para não ser dito duas vezes.
  await expect(regiaoFalada(page)).toHaveAttribute('aria-live', 'polite');
  expect(
    await aviso(page).evaluate((el) => [
      el.getAttribute('role'),
      el.getAttribute('aria-live'),
      el.closest('[aria-live], [role="status"], [role="alert"]') === null,
    ]),
  ).toEqual([null, null, true]);
});

test('o aviso da conexão e o da mensagem: um por vez', async ({ page }) => {
  const { canal } = await comOSinal(page);
  await mudarARede(page, RUIM, 2);
  await expect(linhaDoAviso(page)).toHaveText('Sua conexão está ruim');
  // A mensagem nova toma o lugar do aviso da conexão: quem escreveu, o texto e o Abrir o chat, com a borda de sempre.
  canal.mandar({ tipo: 'mensagem', de: CARLOS.quem, nome: CARLOS.nome, voce: false, texto: 'Bom dia a todos' });
  await expect(aviso(page)).toHaveAttribute('data-tipo', 'mensagem');
  await expect(aviso(page).locator('.aviso-curto-quem')).toBeVisible();
  await expect(aviso(page).locator('.aviso-curto-quem')).toHaveText('Carlos Lima escreveu');
  await expect(linhaDoAviso(page)).toHaveText('Bom dia a todos');
  await expect(linhaDoAviso(page)).toHaveCSS('font-weight', '400');
  await expect(aviso(page).getByRole('button')).toHaveText(['Abrir o chat']);
  await expect(aviso(page)).toHaveCSS('border-top-color', 'rgb(44, 55, 87)');
  await expect(anuncio(page)).toHaveText('Carlos Lima escreveu: Bom dia a todos');
});

test.describe('na janela de 1000×700', () => {
  test.use({ viewport: { width: 1000, height: 700 } });

  // A escolha 10 do plano: com o chat ao lado, a área fica estreita, e o aviso no meio cobriria o Você.
  test('o aviso de conexão ruim com o chat aberto não cobre o Você', async ({ page }) => {
    await comOSinal(page);
    await botao(page, 'Chat').click();
    await expect(painel(page)).toHaveAttribute('data-modo', 'lado');
    await mudarARede(page, RUIM, 2);
    await expect(aviso(page)).toBeVisible();
    await expect(linhaDoAviso(page)).toHaveText('Sua conexão está ruim');
    const a = await caixa(area(page));
    const v = await caixa(page.locator('[data-papel="canto"]'));
    const t = await caixa(aviso(page));
    expect(a.width).toBe(580);
    dentro(t, a, 'o aviso');
    expect(separadas(t, v), `o aviso ${JSON.stringify(t)} e o Você ${JSON.stringify(v)}`).toBe(true);
    expect(v.y - (t.y + t.height)).toBeCloseTo(8, 0);
    // O texto cabe inteiro numa linha, ao lado do botão.
    expect(
      await linhaDoAviso(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
      'o texto do aviso inteiro',
    ).toBe(true);
  });
});

test('com a conexão caída, Medindo a conexão…', async ({ page }) => {
  const { canal } = await comOSinal(page);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  const antes = await leituras(page);

  await darNaLigacao(page, SEM_CONEXAO);
  await expect(cartaoDaQueda(page)).toBeVisible();
  await conferirOBotao(page, 'medindo');
  // O botão continua valendo embaixo do cartão da queda, e o cartão dele diz o medindo.
  await sinal(page).click();
  await conferirOCartao(page, 'medindo', null);
  await sinal(page).click();
  await expect(cartao(page)).toBeHidden();

  // Na volta: medindo, e depois Conexão boa. Com a ligação fora do ar, a página não pede os números.
  await voltar(page, canal);
  await expect(textoDoSinal(page)).toHaveText('Medindo a conexão…');
  expect(await leituras(page)).toBe(antes + 1); // a da volta, na hora: a base das seguintes
  await medir(page);
  await expect(textoDoSinal(page)).toHaveText('Medindo a conexão…');
  await medir(page);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
});

test('compartilhando a tela, o sinalizador continua no alto', async ({ page }) => {
  // A tela que a pessoa escolheria é um canvas.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const tela = document.createElement('canvas');
      tela.width = 640;
      tela.height = 360;
      tela.getContext('2d')?.fillRect(0, 0, tela.width, tela.height);
      return tela.captureStream(15);
    };
  });
  const { canal } = await comOSinal(page);
  await botao(page, 'Compartilhar a tela').click();
  await expect.poll(() => canal.tipos().filter((t) => t === 'tela').length).toBe(1);
  canal.mandar({ tipo: 'tela', senha: 'senha-tela' });
  const selo = page.getByText('Você está compartilhando a tela', { exact: true });
  await subir(page, () => selo.isVisible());
  await expect(gravado(page)).toBeHidden();
  // O sinalizador fica ao lado do selo, antes dele, na mesma linha, e continua valendo.
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  const s = await caixa(sinal(page));
  const t = await caixa(page.locator('.selo-tela'));
  expect(t.x - (s.x + s.width)).toBeCloseTo(14, 0);
  expect(Math.abs(s.y + s.height / 2 - (t.y + t.height / 2))).toBeLessThanOrEqual(1);
  expect(t.x + t.width).toBe(1280 - 24);
  await sinal(page).click();
  await conferirOCartao(page, 'boa', 'Perda: 0% · Atraso: 45 ms');
});

test('o medidor para fora da reunião', async ({ page }) => {
  const { canal } = await comOSinal(page);
  const antes = await leituras(page);
  await medir(page);
  expect(await leituras(page)).toBe(antes + 1);

  await botao(page, 'Sair').click();
  await expect(titulo(page, 'Você saiu da reunião')).toBeVisible();
  await expect(sinal(page)).toBeHidden();
  await page.clock.runFor(10_000);
  expect(await leituras(page)).toBe(antes + 1);

  // O Entrar de novo mede de novo, do começo.
  const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
  const pedidas = senhas();
  await botao(page, 'Entrar de novo').click();
  await expect.poll(senhas).toBe(pedidas + 1);
  canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  await subir(page, () => sinal(page).isVisible());
  await expect(textoDoSinal(page)).toHaveText('Medindo a conexão…');
  expect(await leituras(page)).toBe(antes + 2); // a primeira, na hora
  await medir(page, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
});

test('com a aba escondida, a página não pede os números', async ({ page }) => {
  await comOSinal(page);
  const antes = await leituras(page);
  const aAba = (estado: string) =>
    page.evaluate((estado) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
    }, estado);

  await aAba('hidden');
  await page.clock.runFor(10_000);
  expect(await leituras(page)).toBe(antes);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');

  // A aba volta: a primeira leitura é só a base, e o estado fica como estava até as medidas seguintes.
  await aAba('visible');
  await medir(page);
  await expect(textoDoSinal(page)).toHaveText('Conexão boa');
  await mudarARede(page, RUIM, 2);
  await expect(textoDoSinal(page)).toHaveText('Conexão ruim');
});

// ---- O celular (390×844, com o toque). ----

test.describe('no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no celular, só o desenho', async ({ page }) => {
    await comOSinal(page);
    // O botão é só o desenho, de 20 px, num botão de 44×44 px, sem borda e sem fundo, na cor do estado.
    const s = await caixa(sinal(page));
    expect([s.width, s.height]).toEqual([44, 44]);
    const desenho = await caixa(sinal(page).locator('svg'));
    expect([desenho.width, desenho.height]).toEqual([20, 20]);
    await expect(sinal(page)).toHaveCSS('border-top-width', '0px');
    await expect(sinal(page)).toHaveCSS('background-color', SEM_FUNDO);
    await expect(sinal(page)).toHaveCSS('color', 'rgb(185, 196, 230)');
    // O texto fica só para o leitor de tela, e o nome continua o do estado.
    const texto = await caixa(textoDoSinal(page));
    expect(texto.width).toBeLessThanOrEqual(1);
    expect(texto.height).toBeLessThanOrEqual(1);
    await expect(sinal(page)).toHaveAccessibleName('Conexão boa. Ver os detalhes');
    await expect(gravado(page)).toBeHidden();
    // O alto da reunião: 6 px em cima e embaixo, 18 px à esquerda e 8 px à direita.
    const alto = await caixa(page.locator('.reuniao-topo'));
    expect(alto.height).toBe(44 + 6 + 6 + 1);
    expect(alto.width - (s.x + s.width)).toBe(8);
    expect(s.y - alto.y).toBe(6);

    // O cartão aberto cabe na janela: a largura dela, com 8 px de cada lado.
    await sinal(page).tap();
    await conferirOCartao(page, 'boa', 'Perda: 0% · Atraso: 45 ms');
    const c = await caixa(cartao(page));
    expect([c.x, c.width]).toEqual([8, 390 - 16]);
    expect(c.y - (s.y + s.height)).toBeCloseTo(8, 0);
    expect(c.y + c.height).toBeLessThanOrEqual(844);
    expect(await porCima(page, '#sinal-cartao')).toBe(true);
    // O toque fora fecha.
    await titulo(page, 'Planejamento de dezembro').tap();
    await expect(cartao(page)).toBeHidden();
  });

  test('no celular, os estados mudam a cor do desenho, e o cartão do ruim cabe na janela', async ({ page }) => {
    await comOSinal(page, RUIM);
    await expect(sinal(page)).toHaveAttribute('data-estado', 'ruim');
    await expect(sinal(page)).toHaveCSS('color', 'rgb(255, 179, 179)');
    await expect(sinal(page)).toHaveCSS('background-color', SEM_FUNDO);
    await expect(barras(page).nth(0)).toHaveCSS('fill', 'rgb(255, 179, 179)');
    await expect(barras(page).nth(2)).toHaveCSS('fill', 'rgb(74, 48, 64)');
    // O aviso da conexão ruim fica acima do Você, dentro da área.
    await expect(aviso(page)).toBeVisible();
    const a = await caixa(area(page));
    const v = await caixa(page.locator('[data-papel="canto"]'));
    const t = await caixa(aviso(page));
    dentro(t, a, 'o aviso');
    expect(separadas(t, v)).toBe(true);
    // O Ver os detalhes: o cartão do ruim, o maior de todos, cabe na janela.
    await verOsDetalhes(page).tap();
    await conferirOCartao(page, 'ruim', 'Perda: 12% · Atraso: 640 ms');
    const c = await caixa(cartao(page));
    expect([c.x, c.width]).toEqual([8, 390 - 16]);
    expect(c.y + c.height).toBeLessThanOrEqual(844);
    await expect(sinal(page)).toBeFocused();
  });
});

// ---- A tela de toque larga: o celular deitado e o tablet (a escolha 19 do plano). ----

for (const [nome, viewport] of [
  ['o celular deitado', { width: 844, height: 390 }],
  ['o tablet', { width: 1180, height: 820 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test(`${nome}: o botão do sinalizador tem 44 px de altura, com o texto`, async ({ page }) => {
      await comOSinal(page);
      await expect(textoDoSinal(page)).toBeVisible();
      await expect(textoDoSinal(page)).toHaveText('Conexão boa');
      const s = await caixa(sinal(page));
      expect(s.height).toBe(44);
      expect(s.width).toBeGreaterThan(44);
      // O alto da reunião não passa da altura do botão no celular deitado: a área dos quadros fica com o resto.
      const alto = await caixa(page.locator('.reuniao-topo'));
      if (viewport.height < 500) expect(alto.height).toBe(44 + 1);
      dentro(s, alto, 'o botão no alto');
      // O cartão cabe na janela.
      await sinal(page).tap();
      await conferirOCartao(page, 'boa', 'Perda: 0% · Atraso: 45 ms');
      const c = await caixa(cartao(page));
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(viewport.width);
      expect(c.y + c.height).toBeLessThanOrEqual(viewport.height);
    });
  });
}
