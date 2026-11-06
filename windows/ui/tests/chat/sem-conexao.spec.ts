// Sem conexão (Task 6, o quadro SemConexao): a faixa e as tentativas em 1, 2, 5, 10 e 30 s, as mensagens de enquanto
// isso que chegam uma vez só e em ordem, também com uma nova pelo WebSocket no meio da volta (Review Focus 2), a
// mensagem escrita sem conexão, a resposta que chega depois dos 15 s, o 429 limite, a faixa da conversa que sai com
// ela, a página anterior que falha (o 500 tenta de novo, o 404 relê a lista), o aria-busy da página da volta e o aviso
// do Windows depois da volta: um por conversa, só para a mensagem com menos de 2 minutos (depois de uma queda longa ou
// do PC dormindo, nenhum), e uma vez só quando o evento dela chega depois da releitura. O WebSocket passa pelo
// page.routeWebSocket até o servidor de verdade (a rota derruba a conexão e recusa as próximas, e pode calar ou segurar
// o que o servidor manda), e o Math.random fica em 0,5: cada espera é a da tabela, vezes 1. Depois que a página abre, o
// relógio dela fica parado e só anda pelo runFor (ou pelo fastForward do PC que dormiu); cada passo acaba na hora de uma
// tentativa, e o prazo de 20 s de um pedido nunca cabe nele.
import { expect, test, type APIResponse, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { capturar, comandos, esperarComando } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos, pararORelogio } from './abrir';
import { baseDoChat, empresaComPessoas } from './servidor';

test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '2004', nome: 'João Pereira' };

const hora = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const faixa = (page: Page) => page.getByRole('status').filter({ hasText: 'Sem conexão com o chat. Tentando de novo…' });
const conversaCom = (page: Page, nome: string) => page.getByRole('log', { name: `Mensagens com ${nome}` });
const campoPara = (page: Page, nome: string) => page.getByRole('textbox', { name: `Mensagem para ${nome}` });
const envios = (conversa: number) => `${baseDoChat()}/api/v1/conversas/${conversa}/mensagens`;
/** Os avisos do Windows de uma conversa. */
const avisosDe = async (page: Page, conversa: number) => (await comandos(page)).filter((c) => c.cmd === 'chatNotify' && c.conversa === conversa);
/** As mensagens de uma conversa: as páginas e o envio (o mesmo caminho; quem trata a rota confere o método). */
const mensagensDe = (conversa: number) => (url: URL) => url.pathname === `/api/v1/conversas/${conversa}/mensagens`;
const ERRO_DO_SERVIDOR = { status: 500, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ erro: 'servidor' }) };

/** O fator aleatório das esperas em 1 (0,5 + 0,5): cada espera é a da tabela. */
async function semSorteio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
}

/**
 * O relógio da página na hora de verdade: o servidor de teste marca o criadaEm com o relógio dele, e o aviso da volta
 * mede a idade da mensagem pelo relógio da página.
 */
async function relogioDeVerdade(page: Page): Promise<void> {
  await page.clock.install({ time: Date.now() });
}

interface EventosPelaRota {
  /** Fecha os WebSockets no ar e recusa os próximos, até o voltar. */
  derrubar(): Promise<void>;
  voltar(): void;
  /** As conexões que a rota recusou. */
  recusadas(): number;
  /** O PC dormindo: os WebSockets no ar continuam abertos, mas o que o servidor manda por eles não chega mais. */
  calar(): void;
  /** O que o servidor mandou depois do calar (e que não chegou). */
  caladas(): number;
  /** O que o servidor mandar pelos WebSockets que abrirem daqui em diante fica guardado, até o soltar. */
  guardar(): void;
  guardadas(): number;
  /** Entrega o que estava guardado, na ordem; o resto passa direto. */
  soltar(): void;
}

/**
 * Os eventos pela rota: cada WebSocket passa até o servidor de verdade, até o derrubar. Depois dele, a rota fecha cada
 * conexão nova antes de ela abrir (o `close` só volta depois de a página tratar o fechamento: a próxima tentativa já
 * está marcada), até o voltar. O que o servidor manda passa direto, menos depois do calar ou do guardar.
 */
async function eventosPelaRota(page: Page): Promise<EventosPelaRota> {
  let cair = false;
  let recusadas = 0;
  let caladas = 0;
  let guardando = false;
  const guardadas: Array<() => void> = [];
  const noAr: Array<{ ws: WebSocketRoute; servidor: WebSocketRoute }> = [];
  await page.routeWebSocket(/\/api\/v1\/eventos\?/, async (ws) => {
    if (cair) {
      await ws.close();
      recusadas += 1;
      return;
    }
    const servidor = ws.connectToServer();
    if (guardando) {
      servidor.onMessage((m) => {
        if (guardando) guardadas.push(() => ws.send(m));
        else ws.send(m);
      });
    }
    noAr.push({ ws, servidor });
  });
  return {
    async derrubar() {
      cair = true;
      for (const { ws } of noAr.splice(0)) await ws.close();
    },
    voltar() {
      cair = false;
    },
    recusadas: () => recusadas,
    calar() {
      for (const { servidor } of noAr) {
        servidor.onMessage(() => {
          caladas += 1;
        });
      }
    },
    caladas: () => caladas,
    guardar() {
      guardando = true;
    },
    guardadas: () => guardadas.length,
    soltar() {
      guardando = false;
      for (const entregar of guardadas.splice(0)) entregar();
    },
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

test('leaving a conversation whose page failed takes its banner away, and nothing more goes out for it', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await semSorteio(page);
  await page.clock.install();
  await eventosPelaRota(page);
  // A primeira página responde 500 uma vez; o WebSocket continua no ar.
  let falhou = false;
  let fechada = false;
  const depoisDeFechar: string[] = [];
  await page.route(mensagensDe(dupla), (rota) => {
    if (fechada) depoisDeFechar.push(`${rota.request().method()} ${rota.request().url()}`);
    if (falhou || rota.request().method() !== 'GET') return rota.continue();
    falhou = true;
    return rota.fulfill(ERRO_DO_SERVIDOR);
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await pararORelogio(page);
  await abrirAConversa(page, 'Ana Souza');
  await expect(faixa(page)).toBeVisible();

  // O Esc volta para a lista: a faixa da conversa sai com ela.
  await page.keyboard.press('Escape');
  fechada = true;
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  // Passada a espera da outra tentativa (1 s), nada mais sai para a conversa, e a faixa não volta.
  await page.clock.runFor(2_000);
  await page.waitForTimeout(300);
  expect(depoisDeFechar).toEqual([]);
  await expect(faixa(page)).toHaveCount(0);
});

test('an older page that fails shows the banner and tries again after the wait', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  for (let i = 1; i <= 60; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await semSorteio(page);
  await page.clock.install();
  await eventosPelaRota(page);
  // A primeira página anterior responde 500; as outras passam.
  let anteriores = 0;
  await page.route(
    (url) => mensagensDe(dupla)(url) && url.searchParams.has('antes'),
    (rota) => (++anteriores === 1 ? rota.fulfill(ERRO_DO_SERVIDOR) : rota.continue()),
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  const textos = log.locator('.balao-texto');
  await expect(textos).toHaveCount(50);
  await esperarOsEventos(page);
  await pararORelogio(page);

  await log.evaluate((el) => (el.scrollTop = 0));
  await expect(faixa(page)).toBeVisible();
  expect(anteriores).toBe(1);
  // A espera da vez (1 s, com o sorteio em 0,5), e a mesma página de novo.
  await page.clock.runFor(999);
  expect(anteriores).toBe(1);
  await page.clock.runFor(1);
  await expect(textos).toHaveCount(60);
  expect(anteriores).toBe(2);
  await expect(faixa(page)).toHaveCount(0);
});

test('an older page answered 404 re-reads the list and stops', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  for (let i = 1; i <= 60; i++) await ana.api.enviarTexto(dupla, `Mensagem ${i}`);
  await semSorteio(page);
  await page.clock.install();
  await eventosPelaRota(page);
  let anteriores = 0;
  await page.route(
    (url) => mensagensDe(dupla)(url) && url.searchParams.has('antes'),
    (rota) => {
      anteriores += 1;
      return rota.fulfill({ status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ erro: 'naoEncontrado' }) });
    },
  );
  let listas = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url() === `${baseDoChat()}/api/v1/conversas`) listas += 1;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveCount(50);
  await esperarOsEventos(page);
  await pararORelogio(page);
  const antes = listas;

  // O 404 (a conversa não é mais minha): a lista é lida de novo, e a página não é pedida outra vez.
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => listas).toBe(antes + 1);
  await page.clock.runFor(2_000);
  await page.waitForTimeout(300);
  expect(anteriores).toBe(1);
  await expect(faixa(page)).toHaveCount(0);
});

test('a page of the return keeps the log busy for 1 second from the render that puts it in', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await semSorteio(page);
  await page.clock.install();
  const eventos = await eventosPelaRota(page);
  // A página da volta (a do depois) vem do servidor e espera o teste.
  let volta: { rota: Route; resposta: APIResponse } | null = null;
  await page.route(
    (url) => mensagensDe(dupla)(url) && url.searchParams.has('depois'),
    async (rota) => {
      volta = { rota, resposta: await rota.fetch() };
    },
  );
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // Os eventos no ar antes da primeira página: ela fecha sem buraco, e só a volta lê com o depois.
  await esperarOsEventos(page);
  await abrirAConversa(page, 'Ana Souza');
  const log = conversaCom(page, 'Ana Souza');
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia!']);
  await pararORelogio(page);

  await eventos.derrubar();
  await ana.api.enviarTexto(dupla, 'Pode me mandar a proposta da ACME?');
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  // Enquanto a página da volta espera a rede, o log não fica ocupado.
  await expect.poll(() => volta !== null).toBe(true);
  await expect(log).toHaveAttribute('aria-busy', 'false');
  await volta!.rota.fulfill({ response: volta!.resposta });
  await expect(log.locator('.balao-texto')).toHaveText(['Bom dia!', 'Pode me mandar a proposta da ACME?']);
  await expect(log).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(999);
  await expect(log).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(1);
  await expect(log).toHaveAttribute('aria-busy', 'false');
});

test('after a short drop, one notice per conversation, with its last message', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  await relogioDeVerdade(page);
  const eventos = await eventosPelaRota(page);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.locator('.chat-linha')).toHaveCount(2);
  await esperarOsEventos(page);
  await pararORelogio(page);

  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  await ana.api.enviarTexto(comAna, 'Bom dia!');
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await joao.api.enviarTexto(comJoao, 'Fechamos o pedido de hoje.');
  // Volta na primeira tentativa (1 s depois da queda): as mensagens têm menos de 2 minutos, e cada conversa tem um
  // aviso, com a última dela.
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  await esperarComando(page, { cmd: 'chatBadge', n: 3 });
  await expect
    .poll(() => avisosDe(page, comAna))
    .toEqual([{ v: 1, cmd: 'chatNotify', conversa: comAna, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?' }]);
  await expect
    .poll(() => avisosDe(page, comJoao))
    .toEqual([{ v: 1, cmd: 'chatNotify', conversa: comJoao, titulo: 'João Pereira', texto: 'Fechamos o pedido de hoje.' }]);
  await page.waitForTimeout(300);
  expect(await avisosDe(page, comAna)).toHaveLength(1);
  expect(await avisosDe(page, comJoao)).toHaveLength(1);
});

test('after a drop of more than 2 minutes, no notice, only the number', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  await relogioDeVerdade(page);
  const eventos = await eventosPelaRota(page);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.locator('.chat-linha')).toHaveCount(2);
  await esperarOsEventos(page);
  await pararORelogio(page);

  await eventos.derrubar();
  await ana.api.enviarTexto(comAna, 'Bom dia!');
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await joao.api.enviarTexto(comJoao, 'Fechamos o pedido de hoje.');
  // As tentativas em 1, 3, 8, 18, 48, 78 e 108 s são recusadas; a de 138 s volta, e as mensagens da queda já têm mais
  // de 2 minutos pelo relógio da página.
  for (const [i, espera] of [1000, 2000, 5000, 10000, 30000, 30000, 30000].entries()) {
    await page.clock.runFor(espera);
    await expect.poll(() => eventos.recusadas()).toBe(i + 1);
  }
  eventos.voltar();
  await page.clock.runFor(30_000);
  await esperarOsEventos(page);
  await esperarComando(page, { cmd: 'chatBadge', n: 3 });
  await page.waitForTimeout(300);
  expect(await avisosDe(page, comAna)).toEqual([]);
  expect(await avisosDe(page, comJoao)).toEqual([]);
});

test('after the PC sleeps, the messages of the sleep are too old for a notice', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  await relogioDeVerdade(page);
  const eventos = await eventosPelaRota(page);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.locator('.chat-linha')).toHaveCount(2);
  await esperarOsEventos(page);
  await pararORelogio(page);

  // O PC dorme: o WebSocket continua aberto, mas o que o servidor manda não chega mais.
  eventos.calar();
  await ana.api.enviarTexto(comAna, 'Bom dia!');
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await joao.api.enviarTexto(comJoao, 'Fechamos o pedido de hoje.');
  await expect.poll(() => eventos.caladas()).toBe(3);
  // Dois minutos e meio depois, ele acorda. Só agora o WebSocket fecha (a queda que o app vê dura 1 s), e ele volta na
  // primeira tentativa.
  await page.clock.fastForward(150_000);
  await eventos.derrubar();
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  // A releitura traz as três (o número), mas elas têm mais de 2 minutos: nenhum aviso.
  await esperarComando(page, { cmd: 'chatBadge', n: 3 });
  await page.waitForTimeout(300);
  expect(await avisosDe(page, comAna)).toEqual([]);
  expect(await avisosDe(page, comJoao)).toEqual([]);
});

test('a message the re-read already brought gets no second notice when its event comes later', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await semSorteio(page);
  await relogioDeVerdade(page);
  const eventos = await eventosPelaRota(page);
  // A releitura da volta espera o teste; as leituras da lista de antes passam.
  const conversas = `${baseDoChat()}/api/v1/conversas`;
  let segurarALista = false;
  let lista: Route | null = null;
  let listasLidas = 0;
  await page.route(conversas, (rota) => {
    if (rota.request().method() !== 'GET' || !segurarALista || lista !== null) return rota.continue();
    lista = rota;
  });
  page.on('requestfinished', (r) => {
    if (r.method() === 'GET' && r.url() === conversas) listasLidas += 1;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(page.locator('.chat-linha')).toHaveCount(1);
  await esperarOsEventos(page);
  // A lista da partida e a releitura do primeiro `conectou`.
  await expect.poll(() => listasLidas).toBe(2);
  await pararORelogio(page);

  await eventos.derrubar();
  await expect(faixa(page)).toBeVisible();
  // Na volta, o que o servidor manda pelo WebSocket fica guardado, e a releitura espera.
  eventos.guardar();
  segurarALista = true;
  eventos.voltar();
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  await expect.poll(() => lista !== null).toBe(true);
  // A Ana manda agora: a releitura traz a mensagem, e o evento dela chega só depois.
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await expect.poll(() => eventos.guardadas()).toBe(1);
  await lista!.continue();
  const aviso = { v: 1, cmd: 'chatNotify', conversa: comAna, titulo: 'Ana Souza', texto: 'Pode me mandar a proposta da ACME?' };
  await expect.poll(() => avisosDe(page, comAna)).toEqual([aviso]);
  eventos.soltar();
  await page.waitForTimeout(300);
  expect(await avisosDe(page, comAna)).toEqual([aviso]);
});
