// Os ajudantes dos testes das reuniões: abrir o app na aba Reuniões e as horas no relógio da página.
import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import { abrirNoChat } from '../chat/abrir';
import { baseDoChat, type ApiDeTeste } from '../chat/servidor';

/** Abre o app no chat de verdade e vai para a aba Reuniões (que só aparece depois da primeira leitura). */
export async function abrirNasReunioes(page: Page, o: Parameters<typeof abrirNoChat>[1]): Promise<void> {
  await abrirNoChat(page, o);
  const aba = page.locator('nav.nav button.tab-reunioes');
  await expect(aba).toBeVisible();
  await aba.click();
  await expect(page.getByRole('heading', { name: 'Reuniões', level: 1 })).toBeVisible();
}

/** O fuso da página (playwright.config.ts) é sempre −03:00. */
const HORAS_DO_FUSO = 3;

/** O dia de hoje no relógio da página: ano, mês (1 a 12) e dia. */
function hojeNaPagina(): { ano: number; mes: number; dia: number } {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = formato.formatToParts(Date.now());
  const de = (tipo: string) => Number(p.find((x) => x.type === tipo)!.value);
  return { ano: de('year'), mes: de('month'), dia: de('day') };
}

/**
 * Uma hora no relógio da página: o playwright.config.ts fixa o fuso dela em America/Sao_Paulo (sempre −03:00), e o
 * Node dos testes pode estar em outro. `dias`: 0 é hoje naquele fuso, 1 é amanhã.
 */
export function noRelogioDaPagina(dias: number, hora: number, minuto: number): number {
  const { ano, mes, dia } = hojeNaPagina();
  return Date.UTC(ano, mes - 1, dia + dias, hora + HORAS_DO_FUSO, minuto);
}

/** O meio-dia de hoje no relógio da página: os testes da lista fixam a hora da página nele. */
export function meioDiaDeHoje(): number {
  return noRelogioDaPagina(0, 12, 0);
}

/** O ano de uma hora no relógio da página. */
export function anoNaPagina(ms: number): number {
  return new Date(ms - HORAS_DO_FUSO * 3_600_000).getUTCFullYear();
}

/** O dia de uma hora no relógio da página, como a lista o escreve: "Dom, 29/11" (com o ano, se não é o de hoje). */
export function diaDaLista(ms: number): string {
  const d = new Date(ms - HORAS_DO_FUSO * 3_600_000);
  const dois = (n: number) => String(n).padStart(2, '0');
  const semana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getUTCDay()];
  const ano = d.getUTCFullYear() === hojeNaPagina().ano ? '' : `/${d.getUTCFullYear()}`;
  return `${semana}, ${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}${ano}`;
}

const DIA = 86_400_000;

/** Marca uma reunião como a pessoa da `api`: o início dado e o link valendo 2 dias depois. Devolve a criada. */
export async function marcar(
  api: ApiDeTeste,
  inicio: number,
  assunto?: string,
): Promise<{ codigo: string; link: string }> {
  const corpo = { ...(assunto === undefined ? {} : { assunto }), inicio, valeAte: inicio + 2 * DIA };
  const r = await api.pedir('POST', '/api/v1/reunioes', corpo);
  if (r.status !== 201) throw new Error(`marcar a reunião respondeu ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json.reuniao;
}

/**
 * Marca cada leitura da lista com o número dela: o assunto da primeira reunião chega como "Leitura N". Assim o teste
 * sabe que o app TRATOU a resposta da leitura N (o assunto está na tela), e não só que o pedido saiu. O relógio da
 * página só deve andar depois disso: a leitura arma o relógio dos 30 s quando trata a resposta. `atraso`: espera, em
 * tempo real, antes de entregar cada resposta (a máquina lenta do GitHub, de propósito).
 */
export async function numerarAsLeituras(page: Page, atraso = 0): Promise<{ lidas(): number }> {
  let n = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/reunioes',
    async (rota) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      const esta = ++n;
      if (atraso > 0) await new Promise((r) => setTimeout(r, atraso));
      const resposta = await rota.fetch();
      const json = await resposta.json();
      if (json.reunioes?.[0]) json.reunioes[0].assunto = `Leitura ${esta}`;
      await rota.fulfill({ response: resposta, json });
    },
  );
  return { lidas: () => n };
}

/** Espera o app tratar a última leitura numerada (com pelo menos `minimo` leituras), com a aba Reuniões na tela. */
export async function esperarALeitura(page: Page, l: { lidas(): number }, minimo = 1): Promise<void> {
  await expect.poll(() => l.lidas()).toBeGreaterThanOrEqual(minimo);
  await expect
    .poll(async () => (await page.locator('.reun-assunto').allTextContents())[0] === `Leitura ${l.lidas()}`)
    .toBe(true);
}

/** O que o `comEventos` guarda de cada reunião: as listas do último evento dela. */
interface ListasDaReuniao {
  participantes: unknown[];
  pedidos: Array<{ id: string }>;
}

/**
 * Faz de conta que o computador está numa reunião aberta no navegador: o chat de teste não tem servidor de vídeo, e
 * nele ninguém "está na reunião". Chame antes de abrir a página. Fica entre a página e o chat de verdade no WebSocket
 * dos eventos (o molde é o do tests/chat/sem-conexao.spec.ts, com o Math.random em 0,5: a primeira nova tentativa sai
 * 1 s depois da queda) e responde ao GET …/participantes de cada reunião com as listas do último evento mandado (409
 * foraDaReuniao antes do primeiro evento dela e depois do reuniaoAcabou). Um page.route do teste, posto depois dele,
 * passa na frente.
 */
export async function comEventos(page: Page): Promise<{
  /** Entrega um evento à página, como se viesse do servidor. */
  mandar(evento: object): Promise<void>;
  /**
   * Fecha a conexão dos eventos e recusa as próximas, até o `voltar`. Com o `desligando`, fecha com o código 1001 e
   * esquece as reuniões, como o servidor que reiniciou (o GET …/participantes volta a responder 409 foraDaReuniao até o
   * próximo evento mandado); sem ele, é uma queda da rede.
   */
  derrubar(o?: { desligando?: boolean }): Promise<void>;
  voltar(): void;
}> {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  let cair = false;
  const noAr: Array<{ ws: WebSocketRoute; servidor: WebSocketRoute }> = [];
  const reunioes = new Map<string, ListasDaReuniao>();
  await page.routeWebSocket(/\/api\/v1\/eventos\?/, async (ws) => {
    if (cair) {
      await ws.close();
      return;
    }
    const conexao = { ws, servidor: ws.connectToServer() };
    noAr.push(conexao);
    // Uma conexão que a página fechou (a troca de conta, a queda) já não recebe os eventos.
    ws.onClose(() => {
      const i = noAr.indexOf(conexao);
      if (i >= 0) noAr.splice(i, 1);
    });
  });
  await page.route(
    (url) => /^\/api\/v1\/reunioes\/[^/]+\/participantes$/.test(url.pathname),
    (rota) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      const codigo = new URL(rota.request().url()).pathname.split('/')[4];
      const listas = reunioes.get(codigo);
      if (!listas) return rota.fulfill({ status: 409, json: { erro: 'foraDaReuniao' } });
      return rota.fulfill({ status: 200, json: { participantes: listas.participantes, pedidos: listas.pedidos } });
    },
  );
  return {
    async mandar(evento) {
      const e = evento as { tipo?: string; reuniao?: string; pedido?: any; participantes?: unknown[]; pedidos?: any[] };
      if (typeof e.reuniao === 'string') {
        const listas = reunioes.get(e.reuniao) ?? { participantes: [], pedidos: [] };
        if (e.tipo === 'reuniaoParticipantes' && Array.isArray(e.participantes) && Array.isArray(e.pedidos)) {
          reunioes.set(e.reuniao, { participantes: e.participantes, pedidos: e.pedidos });
        } else if (e.tipo === 'reuniaoPedido' && e.pedido) {
          reunioes.set(e.reuniao, { ...listas, pedidos: [...listas.pedidos, e.pedido] });
        } else if (e.tipo === 'reuniaoPedidoFim') {
          reunioes.set(e.reuniao, { ...listas, pedidos: listas.pedidos.filter((p) => p.id !== e.pedido) });
        } else if (e.tipo === 'reuniaoAcabou') {
          reunioes.delete(e.reuniao);
        }
      }
      const ultima = noAr[noAr.length - 1];
      if (!ultima) throw new Error('comEventos.mandar: nenhum WebSocket dos eventos no ar');
      ultima.ws.send(JSON.stringify(evento));
      // O evento chega à página e é tratado antes de qualquer coisa que o teste mande depois (os dois vão em ordem pelo
      // mesmo canal do Playwright): o que o teste manda em seguida (a resposta do aviso, o relógio) já o encontra.
      await page.evaluate(() => 0);
    },
    async derrubar(o) {
      cair = true;
      if (o?.desligando) reunioes.clear();
      for (const { ws } of noAr.splice(0)) await ws.close(o?.desligando ? { code: 1001 } : undefined);
    },
    voltar() {
      cair = false;
    },
  };
}

/** A página de teste que toma o lugar da reunião: guarda o que o app manda e manda o que o teste quer. */
function paginaDeTeste(semPronta: boolean): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Página de teste</title></head>
<body><p>Página de teste</p>
<script>
window.recebidas = [];
addEventListener('message', (e) => { if (e.source === parent) window.recebidas.push(e.data); });
${semPronta ? '' : "parent.postMessage({ starsonic: 1, tipo: 'pronta' }, '*');"}
</script></body></html>`;
}

/**
 * Troca a página /r/<código> do chat por uma página da mesma origem, sem o servidor de vídeo, que guarda o que o app
 * manda e manda o que o teste quer. Chame antes do "Entrar". A página manda o `pronta` ao carregar, a não ser com o
 * `semPronta`. As funções falam sempre com o documento que o `iframe` da reunião mostra agora.
 */
export async function paginaFalsa(
  page: Page,
  codigo: string,
  o: { semPronta?: boolean } = {},
): Promise<{
  /** Da página para o app, com o "starsonic": 1 já posto. */
  mandar(m: object): Promise<void>;
  /** O que o app mandou à página, na ordem. */
  recebidas(): Promise<object[]>;
  /** Põe uma marca no documento de agora. */
  marcar(): Promise<void>;
  /** O documento de agora tem a marca (é o mesmo documento). */
  marcada(): Promise<boolean>;
}> {
  await page.route(`${baseDoChat()}/r/${codigo}`, (rota) =>
    rota.fulfill({ contentType: 'text/html; charset=utf-8', body: paginaDeTeste(o.semPronta === true) }),
  );
  const quadro = async () => {
    const elemento = await page.locator('iframe[title="Reunião"]').elementHandle({ timeout: 10_000 });
    const frame = await elemento!.contentFrame();
    if (!frame) throw new Error('o iframe da reunião não tem documento');
    await frame.waitForLoadState('domcontentloaded');
    return frame;
  };
  return {
    async mandar(m) {
      await (await quadro()).evaluate((m) => parent.postMessage({ starsonic: 1, ...m }, '*'), m);
    },
    async recebidas() {
      return (await quadro()).evaluate(() => (window as unknown as { recebidas: object[] }).recebidas);
    },
    async marcar() {
      await (await quadro()).evaluate(() => ((window as unknown as { marca: boolean }).marca = true));
    },
    async marcada() {
      return (await quadro()).evaluate(() => (window as unknown as { marca?: boolean }).marca === true);
    },
  };
}
