// A pausa da reunião aberta no navegador numa ligação (Task 12; a spec, 7.8 e 7.9): a regra pura, no Node; o resto na
// tela, com os eventos pelo comEventos e a rota da pausa respondida pelo page.route (ela guarda os corpos). O relógio
// da página fica parado e só anda pelo runFor, depois de o app tratar a leitura da lista e de a reunião abrir. O fim de
// uma ligação traz a aba Reuniões de volta à vista, e ela lê a lista na hora (as leituras demoram 150 ms de propósito):
// o fimDaLigacao espera a resposta dela e dá tempo de o app tratá-la antes de o relógio andar. Antes dos outros runFor,
// um pedido de verdade ao servidor da página dá tempo de o app tratar o que ainda estava no ar.
import { expect, test, type Page, type Response } from '@playwright/test';
import { comandos, mudarEstado, semViolacoesSerias } from '../helpers';
import { empresaComReunioes } from '../chat/servidor';
import { esperarOsEventos, pararORelogio } from '../chat/abrir';
import { haPausa, novaVez } from '../../src/reunioes/pausa';
import { abrirNasReunioes, comEventos, esperarALeitura, marcar, noRelogioDaPagina, numerarAsLeituras } from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const FRASE = 'A reunião no navegador continua ouvindo você. Desligue o microfone lá.';
const FORA = { status: 409, json: { erro: 'foraDaReuniao' } };
const OK = { status: 204 };
const HORA = 3_600_000;
const participante = { id: 'aaaaaaaaaaaaaaaa', nome: RECEPCAO.nome, deFora: false, tela: true };
const naReuniao = (reuniao: string) => ({
  tipo: 'reuniaoParticipantes',
  reuniao,
  participantes: [participante],
  pedidos: [],
});

type Resposta = { status: number; json?: object } | 'abortar';
type Corpo = { codigo: string; pausada: boolean; vez: string };

const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };
/** Uma ligação com a Ana (id 51): atendida, ou só tocando (recebida). */
function ligacao(fase: 'active' | 'ringing' = 'active'): Record<string, unknown> {
  return {
    top: {
      id: 51,
      number: '2003',
      name: 'Ana Souza',
      incoming: true,
      phase: fase,
      activeSinceMs: fase === 'active' ? Date.now() - 5_000 : 0,
      held: false,
      video: SEM_VIDEO,
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
}
/** O C++ de mentira entrega o estado num setTimeout(0): com o relógio parado, é o runFor(1) que o faz chegar. */
async function chegaALigacao(page: Page, l: Record<string, unknown> | null): Promise<void> {
  await mudarEstado(page, (s) => ({ ...s, ligacao: l }));
  await page.clock.runFor(1);
}
const eALista = (r: Response) => new URL(r.url()).pathname === '/api/v1/reunioes' && r.request().method() === 'GET';

/**
 * A ligação acaba. Se a aba Reuniões ainda está à vista (o app volta ao Teclado num efeito, que com o relógio parado só
 * roda quando ele anda), ela lê a lista na hora, e a leitura demora 150 ms de propósito: o teste espera a resposta
 * chegar e dá tempo de o app tratá-la antes de o relógio andar.
 */
async function fimDaLigacao(page: Page): Promise<void> {
  const leitura = page.waitForResponse(eALista, { timeout: 10_000 }).catch(() => null);
  await chegaALigacao(page, null);
  if (await page.getByRole('heading', { name: 'Reuniões', level: 1 }).isVisible()) {
    expect(await leitura, 'a leitura da lista no fim da ligação').not.toBeNull();
    await dandoTempo(page);
  }
}
const frase = (page: Page) => page.getByText(FRASE, { exact: true });
const eAConferencia = (url: URL) => /\/reunioes\/[^/]+\/participantes$/.test(url.pathname);

/** Um pedido de verdade ao servidor da página e duas idas e voltas: o que estava no ar chega a quem trata. */
async function dandoTempo(page: Page): Promise<void> {
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await page.evaluate(() => 0);
  await page.evaluate(() => 0);
}

/** A rota da pausa, respondida pelo teste: os corpos que chegaram, na ordem, e a resposta que troca. */
async function respondendoAPausa(page: Page, inicial: Resposta) {
  let resposta = inicial;
  const corpos: Corpo[] = [];
  /** Os corpos que chegaram e o "liberada" do momento em que o teste soltou os pedidos presos. */
  const ordem: Array<Corpo | 'liberada'> = [];
  let preso: Promise<void> | null = null;
  let soltar = () => {};
  await page.route(
    (url) => /\/reunioes\/[^/]+\/pausa$/.test(url.pathname),
    async (rota) => {
      const pedido = rota.request();
      if (pedido.method() !== 'POST') return rota.continue();
      const codigo = new URL(pedido.url()).pathname.split('/')[4];
      const corpo = { codigo, ...pedido.postDataJSON() };
      corpos.push(corpo);
      ordem.push(corpo);
      if (preso) await preso;
      return resposta === 'abortar' ? rota.abort() : rota.fulfill(resposta);
    },
  );
  return {
    corpos,
    ordem,
    responder(r: Resposta) {
      resposta = r;
    },
    /** Daqui em diante os pedidos chegam e ficam sem resposta, até o `liberar`. */
    prender() {
      preso = new Promise((r) => (soltar = r));
    },
    liberar() {
      ordem.push('liberada');
      preso = null;
      soltar();
    },
  };
}

/**
 * Abre o app nas Reuniões com uma reunião marcada, os eventos pelo comEventos, a reunião aberta no navegador e a rota
 * da pausa. O relógio da página (instalado na hora de agora) fica parado. `valeAte`: o link da reunião como o passe o
 * diz ao app.
 */
async function abrir(
  page: Page,
  o: { cenario?: 'chat-duas-contas'; valeAte?: number; pausa?: Resposta } = {},
) {
  const { pessoas } = await empresaComReunioes(EMPRESA, o.cenario ? [RECEPCAO, CAIXA] : [RECEPCAO]);
  const criada = await marcar(pessoas[0].api, noRelogioDaPagina(1, 10, 0), 'Planejamento de dezembro');
  await page.clock.install({ time: Date.now() });
  const leituras = await numerarAsLeituras(page, 150);
  const eventos = await comEventos(page);
  if (o.valeAte !== undefined) {
    const valeAte = o.valeAte;
    await page.route(
      (url) => url.pathname.endsWith('/passe'),
      async (rota) => {
        const r = await rota.fetch();
        const json = await r.json();
        json.reuniao.valeAte = valeAte;
        await rota.fulfill({ response: r, json });
      },
    );
  }
  const pausas = await respondendoAPausa(page, o.pausa ?? OK);
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO, ...(o.cenario ? { cenario: o.cenario } : {}) });
  await esperarOsEventos(page);
  await esperarALeitura(page, leituras, 2);
  const antes = (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length;
  await page.getByRole('button', { name: /^Mais opções de / }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Abrir no navegador' }).click();
  await expect
    .poll(async () => (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length)
    .toBe(antes + 1);
  await pararORelogio(page);
  return { codigo: criada.codigo, eventos, pausas };
}

// Uma leitura da lista ainda no ar (a numerada demora de propósito) quando o teste acaba não deve falhar o seguinte.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a regra da pausa: uma ligação só tocando não pausa nada', () => {
  type Ligacao = NonNullable<Parameters<typeof haPausa>[0]>;
  const cartao = (incoming: boolean, phase: 'ringing' | 'dialing' | 'active', held = false): Ligacao['top'] => ({
    id: 1,
    number: '2003',
    name: '',
    incoming,
    phase,
    activeSinceMs: 0,
    held,
  });
  const l = (top: Ligacao['top'], second: Ligacao['second'] = null): Ligacao => ({
    top,
    second,
    secondKind: 'none',
    muted: false,
    conference: false,
    conferenceSinceMs: 0,
    consulting: false,
    colleagueActive: false,
  });
  expect(haPausa(null)).toBe(false);
  expect(haPausa(l(cartao(true, 'ringing')))).toBe(false);
  expect(haPausa(l(cartao(false, 'dialing')))).toBe(true);
  expect(haPausa(l(cartao(true, 'active')))).toBe(true);
  expect(haPausa(l(cartao(true, 'active'), cartao(true, 'ringing')))).toBe(true);
  expect(haPausa(l(cartao(true, 'active', true)))).toBe(true);
  // A segunda atendida, com a de cima tocando, também pausa; as duas tocando, não.
  expect(haPausa(l(cartao(true, 'ringing'), cartao(true, 'ringing')))).toBe(false);
  expect(haPausa(l(cartao(true, 'ringing'), cartao(false, 'active')))).toBe(true);
  const sala = { id: 1, fora: false, cheia: false, participantes: [] };
  expect(haPausa({ ...l(cartao(true, 'ringing')), sala })).toBe(true);
});

test('o vez tem 12 caracteres de letras e números, e muda a cada pausa', () => {
  const vezes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const v = novaVez();
    expect(v).toMatch(/^[A-Za-z0-9]{12}$/);
    vezes.add(v);
  }
  expect(vezes.size).toBe(50);
});

test('atender uma ligação pausa a reunião aberta no navegador, e de novo a cada 10 s', async ({ page }) => {
  const { codigo, pausas } = await abrir(page);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  const vez = pausas.corpos[0].vez;
  expect(vez).toMatch(/^[A-Za-z0-9]{12}$/);
  expect(pausas.corpos[0]).toEqual({ codigo, pausada: true, vez });
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await expect.poll(() => pausas.corpos.length).toBe(2);
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await expect.poll(() => pausas.corpos.length).toBe(3);
  expect(pausas.corpos).toEqual([1, 2, 3].map(() => ({ codigo, pausada: true, vez })));
});

test('o fim da ligação manda o pausada falso com o mesmo vez, e as repetições param', async ({ page }) => {
  const { codigo, pausas } = await abrir(page);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  const vez = pausas.corpos[0].vez;
  await dandoTempo(page);
  await fimDaLigacao(page);
  await expect.poll(() => pausas.corpos.length).toBe(2);
  expect(pausas.corpos[1]).toEqual({ codigo, pausada: false, vez });
  await dandoTempo(page);
  await page.clock.runFor(30_000);
  await dandoTempo(page);
  expect(pausas.corpos).toHaveLength(2);
  // Uma pausa nova tem um vez novo.
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(3);
  expect(pausas.corpos[2].vez).not.toBe(vez);
});

test('uma ligação só tocando não manda nada', async ({ page }) => {
  const { pausas } = await abrir(page);
  await chegaALigacao(page, ligacao('ringing'));
  await expect(page.getByRole('main', { name: 'Ligação' })).toBeVisible();
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await dandoTempo(page);
  expect(pausas.corpos).toEqual([]);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
});

test('o 409 não é para sempre: a rodada seguinte tenta de novo', async ({ page }) => {
  const { pausas } = await abrir(page, { pausa: FORA });
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  await dandoTempo(page);
  pausas.responder(OK);
  await page.clock.runFor(10_000);
  await expect.poll(() => pausas.corpos.length).toBe(2);
  expect(pausas.corpos[1].vez).toBe(pausas.corpos[0].vez);
  await expect(frase(page)).toHaveCount(0);
});

test('a pausa vai na hora em que um evento mostra que o computador entrou', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: FORA });
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  await dandoTempo(page);
  // Sem avançar o relógio: o evento tira a pausa dela da fila.
  await eventos.mandar(naReuniao(codigo));
  await expect.poll(() => pausas.corpos.length).toBe(2);
  expect(pausas.corpos[1]).toEqual({ ...pausas.corpos[0] });
});

test('a reunião cujo link venceu não é tentada', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { valeAte: Date.now() - 60_000 });
  await chegaALigacao(page, ligacao());
  await expect(page.getByRole('main', { name: 'Ligação' })).toBeVisible();
  await eventos.mandar(naReuniao(codigo));
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await dandoTempo(page);
  expect(pausas.corpos).toEqual([]);
});

test('sem o chat, a tela da ligação diz que a reunião do navegador continua ouvindo', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: 'abortar' });
  await eventos.mandar(naReuniao(codigo));
  await chegaALigacao(page, ligacao());
  await expect(frase(page)).toBeVisible();
  expect(pausas.corpos.length).toBeGreaterThanOrEqual(1);
  await dandoTempo(page);
  pausas.responder(OK);
  await page.clock.runFor(10_000);
  await expect(frase(page)).toHaveCount(0);
});

test('com o computador fora da reunião, a pausa que falha não mostra a frase', async ({ page }) => {
  const { pausas } = await abrir(page, { pausa: 'abortar' });
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  await dandoTempo(page);
  await expect(frase(page)).toHaveCount(0);
});

test('depois de um reinício do chat, a tela da ligação avisa, até o computador voltar à reunião', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: FORA });
  await eventos.mandar(naReuniao(codigo));
  await eventos.derrubar({ desligando: true });
  await dandoTempo(page);
  await chegaALigacao(page, ligacao());
  await expect(frase(page)).toBeVisible();
  eventos.voltar();
  await page.clock.runFor(1_000);
  await esperarOsEventos(page);
  await dandoTempo(page);
  await expect(frase(page)).toBeVisible();
  const antes = pausas.corpos.length;
  await expect(async () => eventos.mandar(naReuniao(codigo))).toPass();
  await expect.poll(() => pausas.corpos.length).toBeGreaterThan(antes);
  await expect(frase(page)).toHaveCount(0);
});

test('quem saiu da reunião não deixa dúvida', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: FORA });
  await eventos.mandar(naReuniao(codigo));
  await page.route(eAConferencia, (rota) => rota.fulfill(FORA));
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await dandoTempo(page);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThanOrEqual(1);
  await dandoTempo(page);
  await expect(frase(page)).toHaveCount(0);
});

test('quem ficou sem rede não deixa dúvida', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: FORA });
  await eventos.mandar(naReuniao(codigo));
  await eventos.derrubar();
  await dandoTempo(page);
  eventos.voltar();
  await page.clock.runFor(1_000);
  await esperarOsEventos(page);
  await dandoTempo(page);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThanOrEqual(1);
  await dandoTempo(page);
  await expect(frase(page)).toHaveCount(0);
});

test('a dúvida acaba 12 horas depois', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: FORA });
  await eventos.mandar(naReuniao(codigo));
  await eventos.derrubar({ desligando: true });
  await dandoTempo(page);
  await chegaALigacao(page, ligacao());
  await expect(frase(page)).toBeVisible();
  await fimDaLigacao(page);
  await expect(frase(page)).toHaveCount(0);
  await page.clock.fastForward(11 * HORA);
  let n = pausas.corpos.length;
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThan(n);
  // Só depois de o app tratar o 409 dessa pausa: a frase continua lá.
  await dandoTempo(page);
  await expect(frase(page)).toBeVisible();
  await fimDaLigacao(page);
  await expect(frase(page)).toHaveCount(0);
  await page.clock.fastForward(2 * HORA);
  n = pausas.corpos.length;
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThan(n);
  await dandoTempo(page);
  await expect(frase(page)).toHaveCount(0);
});

test('a troca de conta para a pausa que está rodando', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { cenario: 'chat-duas-contas' });
  await eventos.mandar(naReuniao(codigo));
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  expect(pausas.corpos[0]).toMatchObject({ codigo, pausada: true });
  await dandoTempo(page);
  // A tela da ligação não tem o menu das contas: a troca é a do selectAccount da ponte falsa, pelo estado.
  const novaConexao = page.waitForEvent('websocket');
  const listaDaNova = page.waitForResponse(eALista);
  await mudarEstado(page, (s) => {
    const conta = s.contas.find((c: { ramal: string }) => c.ramal === CAIXA.ramal);
    return {
      ...s,
      contas: s.contas.map((c: { id: string }) => ({ ...c, emUso: c.id === conta.id })),
      conta: { ...conta, status: 'conectado', texto: `Conectado · ${conta.servidor}`, internet: true },
    };
  });
  await page.clock.runFor(1);
  // A sessão da Caixa 2: os eventos no ar de novo e a lista dela lida.
  await novaConexao;
  await esperarOsEventos(page);
  await listaDaNova;
  await dandoTempo(page);
  await page.clock.runFor(30_000);
  await dandoTempo(page);
  expect(pausas.corpos).toHaveLength(1);
  // O fim da ligação, depois do parou, também não manda o pausada falso.
  await fimDaLigacao(page);
  await page.clock.runFor(10_000);
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await dandoTempo(page);
  expect(pausas.corpos).toHaveLength(1);
});

test('o falso do fim da ligação não passa na frente de um verdadeiro ainda no ar', async ({ page }) => {
  const { codigo, pausas } = await abrir(page);
  pausas.prender();
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  const vez = pausas.corpos[0].vez;
  await fimDaLigacao(page);
  await dandoTempo(page);
  // O falso espera: o servidor o repassaria à página antes do verdadeiro, e ela ficaria em pausa depois da ligação.
  expect(pausas.corpos).toHaveLength(1);
  pausas.liberar();
  await expect.poll(() => pausas.corpos.length).toBe(2);
  expect(pausas.ordem).toEqual([
    { codigo, pausada: true, vez },
    'liberada',
    { codigo, pausada: false, vez },
  ]);
});

test('o 404 do falso do fim tira a reunião da lista: a pausa seguinte não a tenta', async ({ page }) => {
  const { pausas } = await abrir(page);
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBe(1);
  await dandoTempo(page);
  pausas.responder({ status: 404, json: { erro: 'naoEncontrado' } });
  await fimDaLigacao(page);
  await expect.poll(() => pausas.corpos.length).toBe(2);
  expect(pausas.corpos[1].pausada).toBe(false);
  await dandoTempo(page);
  await chegaALigacao(page, ligacao());
  await dandoTempo(page);
  await page.clock.runFor(10_000);
  await dandoTempo(page);
  expect(pausas.corpos).toHaveLength(2);
});

test('a região da frase fica na página, vazia sem a frase', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { pausa: 'abortar' });
  await eventos.mandar(naReuniao(codigo));
  await chegaALigacao(page, ligacao());
  const regiao = page.getByRole('status').and(page.locator('.call-ouvindo'));
  await expect(regiao).toHaveText(FRASE);
  await dandoTempo(page);
  pausas.responder(OK);
  await page.clock.runFor(10_000);
  await expect(regiao).toHaveText('');
  await expect(regiao).toHaveCount(1);
});

const TAMANHOS: Array<[number, number, string]> = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
];
for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema });

    test('a frase na tela da ligação: sem violação séria, e inteira nos três tamanhos', async ({ page }) => {
      const { codigo, eventos } = await abrir(page, { pausa: 'abortar' });
      await eventos.mandar(naReuniao(codigo));
      await chegaALigacao(page, ligacao());
      await expect(frase(page)).toBeVisible();
      // O axe usa timers: com o relógio parado ele não termina. A frase fica (a rota continua abortando a pausa).
      await page.clock.resume();
      for (const [largura, altura, layout] of TAMANHOS) {
        const onde = `${largura}×${altura}`;
        await page.setViewportSize({ width: largura, height: altura });
        await expect(page.locator('.win')).toHaveAttribute('data-layout', layout);
        await expect(frase(page), onde).toBeVisible();
        const caixa = (await frase(page).boundingBox())!;
        expect(caixa.x, onde).toBeGreaterThanOrEqual(0);
        expect(caixa.x + caixa.width, onde).toBeLessThanOrEqual(largura);
        expect(caixa.y + caixa.height, onde).toBeLessThanOrEqual(altura);
        const cortada = await frase(page).evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
        expect(cortada, `a frase cortada em ${onde}`).toBe(false);
        const rola = await page.evaluate(() => document.scrollingElement!.scrollWidth);
        expect(rola, `a página rola na horizontal em ${onde}`).toBeLessThanOrEqual(largura);
        await semViolacoesSerias(page);
      }
    });
  });
}
