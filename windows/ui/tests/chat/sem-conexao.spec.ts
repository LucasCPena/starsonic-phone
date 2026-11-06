// Sem conexão (Task 6, o quadro SemConexao): a faixa e as tentativas em 1, 2, 5, 10 e 30 s, as mensagens de enquanto
// isso que chegam uma vez só e em ordem, também com uma nova pelo WebSocket no meio da volta (Review Focus 2), a
// mensagem escrita sem conexão, a resposta que chega depois dos 15 s e o 429 limite. O WebSocket passa pelo
// page.routeWebSocket até o servidor de verdade (a rota derruba a conexão e recusa as próximas), e o Math.random fica em
// 0,5: cada espera é a da tabela, vezes 1. Depois que a página abre, o relógio dela fica parado e só anda pelo runFor;
// cada passo acaba na hora de uma tentativa, e o prazo de 20 s de um pedido nunca cabe nele.
import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { capturar } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { baseDoChat, empresaComPessoas } from './servidor';

test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };

const hora = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const faixa = (page: Page) => page.getByRole('status').filter({ hasText: 'Sem conexão com o chat. Tentando de novo…' });
const conversaCom = (page: Page, nome: string) => page.getByRole('log', { name: `Mensagens com ${nome}` });
const campoPara = (page: Page, nome: string) => page.getByRole('textbox', { name: `Mensagem para ${nome}` });
const envios = (conversa: number) => `${baseDoChat()}/api/v1/conversas/${conversa}/mensagens`;

/** O fator aleatório das esperas em 1 (0,5 + 0,5): cada espera é a da tabela. */
async function semSorteio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
}

/** O relógio da página parado: daqui em diante, ele só anda pelo runFor. */
async function pararORelogio(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

/**
 * Os eventos pela rota: cada WebSocket passa até o servidor de verdade, até o derrubar. Depois dele, a rota fecha cada
 * conexão nova antes de ela abrir (o `close` só volta depois de a página tratar o fechamento: a próxima tentativa já
 * está marcada), até o voltar.
 */
async function eventosPelaRota(page: Page): Promise<{ derrubar(): Promise<void>; voltar(): void; recusadas(): number }> {
  let cair = false;
  let recusadas = 0;
  const noAr: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/v1\/eventos\?/, async (ws) => {
    if (cair) {
      await ws.close();
      recusadas += 1;
      return;
    }
    ws.connectToServer();
    noAr.push(ws);
  });
  return {
    async derrubar() {
      cair = true;
      for (const ws of noAr.splice(0)) await ws.close();
    },
    voltar() {
      cair = false;
    },
    recusadas: () => recusadas,
  };
}

test('the WebSocket falls: the banner shows and it tries again at 1, 2, 5, 10 and 30 seconds', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  await semSorteio(page);
  await page.clock.install();
  const eventos = await eventosPelaRota(page);
  let bilhetes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === `${baseDoChat()}/api/v1/eventos/bilhete`) bilhetes += 1;
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  await esperarOsEventos(page);
  expect(bilhetes).toBe(1);
  await expect(faixa(page)).toHaveCount(0);

  await pararORelogio(page);
  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  await expect(faixa(page)).toHaveText('Sem conexão com o chat. Tentando de novo…');
  // Cada espera conta da tentativa que falhou: os bilhetes saem em 1, 3, 8, 18 e 48 s, e depois a cada 30 s.
  let decorrido = 0;
  for (const [i, espera] of [1000, 2000, 5000, 10000, 30000, 30000, 30000].entries()) {
    await page.clock.runFor(espera - 1);
    expect(bilhetes, `${decorrido + espera - 1} ms depois da queda`).toBe(i + 1);
    await page.clock.runFor(1);
    decorrido += espera;
    await expect.poll(() => bilhetes, { message: `${decorrido} ms depois da queda` }).toBe(i + 2);
    await expect.poll(() => eventos.recusadas()).toBe(i + 1);
  }
  expect(decorrido).toBe(108_000);
  await expect(faixa(page)).toBeVisible();
});

test('when it comes back the banner leaves and the messages from meanwhile arrive once, in order', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  const bomDia = await ana.api.enviarTexto(dupla, 'Bom dia!');
  await semSorteio(page);
  await page.clock.install();
  const eventos = await eventosPelaRota(page);
  // A volta lê uma mensagem por página aqui: ela tem de ler de novo com o depois, até o temMais dar false. Com o
  // `segurar`, a próxima resposta da volta espera o teste.
  const voltas: Array<{ depois: number; ids: number[]; temMais: boolean }> = [];
  let segurar: Promise<void> | null = null;
  await page.route(
    (url) => url.pathname === `/api/v1/conversas/${dupla}/mensagens` && url.searchParams.has('depois'),
    async (rota) => {
      const resposta = await rota.fetch();
      const corpo = await resposta.json();
      if (corpo.mensagens.length > 1) {
        corpo.mensagens = corpo.mensagens.slice(0, 1);
        corpo.temMais = true;
      }
      const depois = Number(new URL(rota.request().url()).searchParams.get('depois'));
      voltas.push({ depois, ids: corpo.mensagens.map((m: { id: number }) => m.id), temMais: corpo.temMais });
      const espera = segurar;
      segurar = null;
      if (espera) await espera;
      await rota.fulfill({ response: resposta, json: corpo });
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const textos = conversaCom(page, 'Ana Souza').locator('.balao-texto');
  await expect(textos).toHaveText(['Bom dia!']);
  await esperarOsEventos(page);
  await pararORelogio(page);

  // Cai, e a Ana manda três enquanto isso: nenhuma chega.
  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  const tres: number[] = [];
  for (const texto of ['Primeira de três.', 'Segunda de três.', 'Terceira de três.']) tres.push(await ana.api.enviarTexto(dupla, texto));
  await expect(textos).toHaveText(['Bom dia!']);
  voltas.length = 0;
  // Volta na primeira tentativa (1 s depois da queda): a faixa sai, e as três chegam uma vez, em ordem.
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  await expect(faixa(page)).toHaveCount(0);
  await expect(textos).toHaveText(['Bom dia!', 'Primeira de três.', 'Segunda de três.', 'Terceira de três.']);
  expect(voltas).toEqual([
    { depois: bomDia, ids: [tres[0]], temMais: true },
    { depois: tres[0], ids: [tres[1]], temMais: true },
    { depois: tres[1], ids: [tres[2]], temMais: false },
  ]);

  // Cai de novo, mais duas; na volta, uma nova chega pelo WebSocket antes da primeira resposta da volta.
  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  const quatro = await ana.api.enviarTexto(dupla, 'Quarta, sem conexão.');
  const cinco = await ana.api.enviarTexto(dupla, 'Quinta, sem conexão.');
  voltas.length = 0;
  let soltar = () => {};
  segurar = new Promise<void>((r) => (soltar = r));
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  await expect.poll(() => voltas.length).toBe(1);
  const seis = await ana.api.enviarTexto(dupla, 'Sexta, pelo WebSocket.');
  await expect(textos.last()).toHaveText('Sexta, pelo WebSocket.');
  soltar();
  await expect(textos).toHaveText([
    'Bom dia!',
    'Primeira de três.',
    'Segunda de três.',
    'Terceira de três.',
    'Quarta, sem conexão.',
    'Quinta, sem conexão.',
    'Sexta, pelo WebSocket.',
  ]);
  // A volta seguiu da última que ela leu, e não da que chegou pelo WebSocket.
  expect(voltas).toEqual([
    { depois: tres[2], ids: [quatro], temMais: true },
    { depois: quatro, ids: [cinco], temMais: true },
    { depois: cinco, ids: [seis], temMais: false },
  ]);
  await expect(faixa(page)).toHaveCount(0);
});

test('a message written without connection is Não enviada right away', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Recebi a proposta, obrigada. Falta só o contrato.');
  await semSorteio(page);
  await page.clock.install();
  const eventos = await eventosPelaRota(page);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await expect(conversaCom(page, 'Ana Souza').locator('.balao-texto')).toHaveCount(1);
  await esperarOsEventos(page);
  await pararORelogio(page);
  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  // Sem rede, o POST falha na hora (o erro `rede`).
  await page.route(envios(dupla), (rota) => (rota.request().method() === 'POST' ? rota.abort() : rota.continue()));

  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Te mando o contrato em 5 minutos.');
  await campo.press('Enter');
  // O relógio está parado: o "Não enviada" vem do erro, sem os 15 s.
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();
  await expect(minha.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(minha.locator('.balao-hora')).toHaveCount(0);
  await capturar(page, 'chat-sem-conexao-conversa', 'claro');
});

test('an answer that arrives after 15 seconds still counts', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  await page.clock.install();
  const eventos = await eventosPelaRota(page);
  let preso: Route | null = null;
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    preso = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  await esperarOsEventos(page);
  await pararORelogio(page);
  // Sem os eventos, só a resposta do POST diz que a mensagem chegou.
  await eventos.derrubar();
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Te mando o contrato em 5 minutos.');
  await campo.press('Enter');
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  await expect.poll(() => preso !== null).toBe(true);
  await page.clock.runFor(15_000);
  await expect(minha.getByText('Não enviada', { exact: true })).toBeVisible();

  // A resposta chega entre os 15 e os 20 s (o prazo do pedido): ainda vale, e o balão passa a enviado.
  await preso!.continue();
  await expect.poll(async () => (await a.api.mensagens(dupla)).length).toBe(1);
  const [m] = await a.api.mensagens(dupla);
  await expect(minha.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
  await expect(minha.getByText('Não enviada', { exact: true })).toHaveCount(0);
  await expect(minha).toHaveCount(1);
});

test('a 429 limite waits the time asked and tries again', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  // A hora (no relógio da página) em que cada POST de mensagem sai e em que a resposta dele chega.
  await page.addInitScript((endereco) => {
    const w = window as unknown as { __envios: Array<{ saiu: number; voltou?: number; status?: number }> };
    w.__envios = [];
    const original = window.fetch;
    window.fetch = (entrada, opcoes) => {
      if (opcoes?.method !== 'POST' || String(entrada) !== endereco) return original(entrada, opcoes);
      const envio: { saiu: number; voltou?: number; status?: number } = { saiu: Date.now() };
      w.__envios.push(envio);
      return original(entrada, opcoes).then((r) => {
        envio.voltou = Date.now();
        envio.status = r.status;
        return r;
      });
    };
  }, `${envios(dupla)}`);
  await page.clock.install();
  await eventosPelaRota(page);
  const corpos: Array<{ idLocal: string }> = [];
  await page.route(envios(dupla), (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    corpos.push(rota.request().postDataJSON());
    if (corpos.length > 1) return rota.continue();
    return rota.fulfill({ status: 429, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ erro: 'limite', esperarSegundos: 3 }) });
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const campo = campoPara(page, 'Ana Souza');
  await campo.fill('Segue a proposta.');
  await campo.press('Enter');
  const minha = conversaCom(page, 'Ana Souza').locator('.balao-meu');
  const enviosDaPagina = () => page.evaluate(() => (window as unknown as { __envios: Array<{ saiu: number; voltou?: number; status?: number }> }).__envios);
  await expect.poll(async () => (await enviosDaPagina()).map((e) => e.status)).toEqual([429]);
  // Esperando o tempo pedido, a mensagem continua "Enviando…".
  await expect(minha.locator('.balao-hora')).toHaveText(['Enviando…']);
  expect(corpos).toHaveLength(1);

  await page.clock.runFor(3_000);
  await expect.poll(async () => (await enviosDaPagina()).map((e) => e.status)).toEqual([429, 201]);
  const [limite, deNovo] = await enviosDaPagina();
  expect(deNovo.saiu - limite.voltou!).toBeGreaterThanOrEqual(3_000);
  expect(deNovo.saiu - limite.voltou!).toBeLessThan(3_100);
  expect(corpos[1]).toEqual(corpos[0]);
  const [m] = await a.api.mensagens(dupla);
  await expect(minha.locator('.balao-hora')).toHaveText([hora(m.criadaEm)]);
});
