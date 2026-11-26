// A pausa da reunião aberta no navegador numa ligação (Task 12; a spec, 7.8 e 7.9): a regra pura, no Node; o resto na
// tela, com os eventos pelo comEventos e a rota da pausa respondida pelo page.route (ela guarda os corpos). O relógio
// da página fica parado e só anda pelo runFor, depois de o app tratar a leitura da lista e de a reunião abrir; antes de
// cada runFor, um pedido de verdade ao servidor da página dá tempo de o app tratar o que ainda estava no ar.
import { expect, test, type Page } from '@playwright/test';
import { comandos, mudarEstado } from '../helpers';
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
  await page.route(
    (url) => /\/reunioes\/[^/]+\/pausa$/.test(url.pathname),
    (rota) => {
      const pedido = rota.request();
      if (pedido.method() !== 'POST') return rota.continue();
      const codigo = new URL(pedido.url()).pathname.split('/')[4];
      corpos.push({ codigo, ...pedido.postDataJSON() });
      return resposta === 'abortar' ? rota.abort() : rota.fulfill(resposta);
    },
  );
  return {
    corpos,
    responder(r: Resposta) {
      resposta = r;
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
  o: { cenario?: 'chat-duas-contas'; valeAte?: number; pausa?: Resposta; semRelogio?: boolean } = {},
) {
  const { pessoas } = await empresaComReunioes(EMPRESA, o.cenario ? [RECEPCAO, CAIXA] : [RECEPCAO]);
  const criada = await marcar(pessoas[0].api, noRelogioDaPagina(1, 10, 0), 'Planejamento de dezembro');
  if (!o.semRelogio) await page.clock.install({ time: Date.now() });
  const leituras = o.semRelogio ? null : await numerarAsLeituras(page, 150);
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
  if (leituras) await esperarALeitura(page, leituras, 2);
  const antes = (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length;
  await page.getByRole('button', { name: /^Mais opções de / }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Abrir no navegador' }).click();
  await expect
    .poll(async () => (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length)
    .toBe(antes + 1);
  if (leituras) await pararORelogio(page);
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
  expect(haPausa({ ...l(cartao(false, 'active')), sala })).toBe(true);
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
  await chegaALigacao(page, null);
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
  await chegaALigacao(page, null);
  await expect(frase(page)).toHaveCount(0);
  await dandoTempo(page);
  await page.clock.fastForward(11 * HORA);
  let n = pausas.corpos.length;
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThan(n);
  await expect(frase(page)).toBeVisible();
  await chegaALigacao(page, null);
  await expect(frase(page)).toHaveCount(0);
  await dandoTempo(page);
  await page.clock.fastForward(2 * HORA);
  n = pausas.corpos.length;
  await chegaALigacao(page, ligacao());
  await expect.poll(() => pausas.corpos.length).toBeGreaterThan(n);
  await dandoTempo(page);
  await expect(frase(page)).toHaveCount(0);
});

test('a troca de conta para a pausa', async ({ page }) => {
  const { codigo, eventos, pausas } = await abrir(page, { cenario: 'chat-duas-contas', semRelogio: true });
  await eventos.mandar(naReuniao(codigo));
  await page.getByRole('button', { name: /Trocar de conta/ }).click();
  await page.getByRole('menuitemradio', { name: /Caixa 2/ }).click();
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  // O relógio só entra depois da troca (o menu da conta precisa dele andando).
  await page.clock.install({ time: Date.now() });
  await pararORelogio(page);
  await chegaALigacao(page, ligacao());
  await expect(page.getByRole('main', { name: 'Ligação' })).toBeVisible();
  await dandoTempo(page);
  await page.clock.runFor(30_000);
  await dandoTempo(page);
  expect(pausas.corpos).toEqual([]);
});
