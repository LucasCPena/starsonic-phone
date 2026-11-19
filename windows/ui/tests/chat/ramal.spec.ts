// O estado do ramal contado ao chat (a spec do estado dos ramais, seções 4.3 e 7.3; docs/chat-protocolo.md, seção 5,
// "Dizer o estado do ramal"): o app diz ao chat como está o ramal da conta em uso, e com isso a página de administração
// do chat mostra "Online" e "Sem registro". Contra o servidor do chat de teste: os pedidos do ramal que a página faz são
// contados aqui, e o resultado é lido na página de administração dele. Nada disso aparece na interface.
//
// O relógio da página é o do Playwright, parado depois de ela abrir. Com ele parado, a ponte falsa só entrega uma
// mensagem quando o relógio anda (ela usa um setTimeout, como o C++ usa o PostWebMessageAsJson): o `mudar` daqui manda
// o estado e anda uns milissegundos.
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { mudarEstado } from '../helpers';
import { abrirNoChat, esperarOsEventos, pararORelogio } from './abrir';
import { baseDoChat, empresaComPessoas, estadoNaAdministracao } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const CAMINHO_DO_RAMAL = '/api/v1/computadores/eu/ramal';
const COMPUTADOR_SAIU = 'Este computador saiu do chat. Fale com o suporte da Starsonic.';

type Estado = Record<string, any>;

/** Os pedidos do ramal que a página faz daqui em diante, na ordem. */
function pedidosDoRamal(page: Page): Request[] {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && new URL(r.url()).pathname === CAMINHO_DO_RAMAL) pedidos.push(r);
  });
  return pedidos;
}

/** O corpo de cada pedido. */
const corpos = (pedidos: Request[]): Array<{ estado: string; segundos: number }> => pedidos.map((p) => p.postDataJSON());

/** Manda um estado novo com o relógio parado, e anda 5 ms para a ponte falsa o entregar (e a resposta de um comando). */
async function mudar(page: Page, f: (s: Estado) => Estado): Promise<void> {
  await mudarEstado(page, f);
  for (let i = 0; i < 5; i++) await page.clock.runFor(1);
}

/** A conta em uso passa ao `status` dado (o que o núcleo diz do registro do ramal). */
const comOStatus =
  (status: string) =>
  (s: Estado): Estado => ({ ...s, conta: { ...s.conta, status } });

/** A conta em uso já conectou neste computador: é o que falta para o chat começar no cenário `chat-sem-conta`. */
const comAContaConectada = (s: Estado): Estado => ({ ...s, chat: { ...s.chat, contaConectada: true } });

const NA_ABERTURA = [
  { status: 'conectado', estado: 'conectado', mostra: { estado: 'Online', detalhe: 'há menos de 1 min' } },
  { status: 'conectando', estado: 'conectando', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
  { status: 'erro', estado: 'erro', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
  { status: 'sem_conexao', estado: 'semConexao', mostra: { estado: 'No chat', detalhe: 'registrando o ramal…' } },
];

for (const caso of NA_ABERTURA) {
  test(`o estado do ramal vai quando o canal abre: ${caso.status}`, async ({ page }) => {
    const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
    const pedidos = pedidosDoRamal(page);
    await page.clock.install();
    await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta' });
    await pararORelogio(page);
    // O ramal chega ao estado do teste com o relógio parado (passando pelo outro lado, registrado ou sem registrar):
    // quando o canal abrir, o tempo dele é zero.
    await mudar(page, comOStatus(caso.status === 'conectado' ? 'erro' : 'conectado'));
    await mudar(page, comOStatus(caso.status));
    expect(pedidos).toHaveLength(0);

    await mudar(page, comAContaConectada);
    await esperarOsEventos(page);
    await expect.poll(() => corpos(pedidos)).toEqual([{ estado: caso.estado, segundos: 0 }]);
    expect((await pedidos[0].response())?.status()).toBe(204);
    await expect.poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome)).toEqual(caso.mostra);
    expect(pedidos).toHaveLength(1);
  });
}

test('o tempo conta desde que o app abriu', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = pedidosDoRamal(page);
  await page.clock.install();
  // O app abre com o ramal sem registrar (o "Erro no cadastro"), e o chat ainda não começa: a conta não conectou aqui.
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta', extra: { status: 'erro' } });
  await pararORelogio(page);
  await page.clock.runFor(90_000);
  expect(pedidos).toHaveLength(0);

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  const [corpo] = corpos(pedidos);
  expect(corpo.estado).toBe('erro');
  // Os 90 s que o relógio andou, e mais o tempo de verdade que a página levou para abrir (o relógio só para depois).
  expect(corpo.segundos).toBeGreaterThanOrEqual(90);
  expect(corpo.segundos).toBeLessThan(120);
  await expect
    .poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome))
    .toEqual({ estado: 'Sem registro', detalhe: 'há 1 min · o app diz “Erro no cadastro”' });
});

test('a cada volta do canal, o estado vai de novo', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = pedidosDoRamal(page);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);

  // O mesmo computador abre outro canal por fora: o chat fecha o da página (4000), e ela abre o dela de novo em 0,5 a
  // 1,5 s (o que fecha o de fora).
  const porFora = await pessoas[0].api.abrirCanal();
  await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBe(2);
  expect(corpos(pedidos).map((c) => c.estado)).toEqual(['conectado', 'conectado']);
  expect((await pedidos[1].response())?.status()).toBe(204);
  porFora.close();
});

for (const caso of ['chat-desligado', 'chat-sem-conta', 'o computador tirado do chat'] as const) {
  test(`sem o chat, nada vai: ${caso}`, async ({ page }) => {
    const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
    const pedidos = pedidosDoRamal(page);
    const tirado = caso === 'o computador tirado do chat';
    // O computador tirado: a chave que o app guarda não vale mais.
    if (tirado) await pessoas[0].api.desligar();
    await page.clock.install();
    await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: tirado ? 'chat' : caso });
    if (tirado) await expect(page.getByText(COMPUTADOR_SAIU, { exact: true })).toBeVisible();
    await pararORelogio(page);

    for (const status of ['erro', 'conectando', 'conectado']) {
      await mudar(page, comOStatus(status));
      await page.clock.runFor(5000);
    }
    await page.clock.runFor(60_000);
    expect(pedidos).toHaveLength(0);
  });
}

// --- As mudanças, com a espera de 2 s (tarefa 2) -------------------------------------------------------------------

/**
 * Abre no chat, espera o canal dos eventos e o pedido da abertura (confirmado pelo chat), e para o relógio da página:
 * daqui em diante ele só anda pelo runFor.
 */
async function abrirComOCanal(page: Page, chave: string, cenario: 'chat' | 'chat-duas-contas' = 'chat'): Promise<Request[]> {
  const pedidos = pedidosDoRamal(page);
  await page.clock.install();
  await abrirNoChat(page, { chave, ...RECEPCAO, cenario });
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  await confirmado(page, pedidos[0]);
  await pararORelogio(page);
  return pedidos;
}

/**
 * O chat respondeu 204 ao pedido, e a página já viu a resposta. Antes de o relógio andar muito, é preciso esperar isto:
 * o prazo de 20 s de um pedido é do relógio da página, e passaria antes de a resposta de verdade chegar.
 */
async function confirmado(page: Page, pedido: Request): Promise<void> {
  expect((await pedido.response())?.status()).toBe(204);
  await page.evaluate(() => 0);
}

/** Quantos pedidos do ramal saíram até agora (com uma ida e volta à página antes, para os avisos do navegador chegarem). */
async function contar(page: Page, pedidos: Request[]): Promise<number> {
  await page.evaluate(() => 0);
  return pedidos.length;
}

/** A outra conta do cenário `chat-duas-contas` passa a ser a conta em uso, com o `status` dado; `comORamal`: o ramal dela. */
const trocarDeConta =
  (status: string, comORamal?: string) =>
  (s: Estado): Estado => {
    const outra = s.contas.find((c: Estado) => !c.emUso);
    const ramal = comORamal ?? outra.ramal;
    return {
      ...s,
      conta: { ...s.conta, id: outra.id, nome: outra.nome, ramal, status },
      contas: s.contas.map((c: Estado) => ({ ...c, emUso: c.id === outra.id, ramal: c.id === outra.id ? ramal : c.ramal })),
    };
  };

test('uma mudança espera 2 segundos', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  await mudar(page, comOStatus('erro'));
  // Com 1,9 s (os 5 ms do `mudar` já contam), nenhum pedido novo.
  await page.clock.runFor(1890);
  expect(await contar(page, pedidos)).toBe(1);
  // Com 2 s, um pedido, com o estado novo e os 2 s que ele tem.
  await page.clock.runFor(120);
  await expect.poll(() => pedidos.length).toBe(2);
  expect(corpos(pedidos)[1]).toEqual({ estado: 'erro', segundos: 2 });
  expect((await pedidos[1].response())?.status()).toBe(204);
});

test('o ramal que pisca manda só o último valor', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  // Cinco estados em 1 s (um a cada 200 ms).
  for (const status of ['conectando', 'erro', 'conectando', 'sem_conexao', 'erro']) {
    await mudar(page, comOStatus(status));
    await page.clock.runFor(195);
  }
  // A última mudança foi há 200 ms: com 1,9 s dela, nada; com 2 s, um pedido só, com o último estado.
  await page.clock.runFor(1690);
  expect(await contar(page, pedidos)).toBe(1);
  await page.clock.runFor(120);
  await expect.poll(() => pedidos.length).toBe(2);
  // O ramal está sem registrar desde o primeiro dos cinco estados: 0,8 s e mais os 2 s da espera.
  expect(corpos(pedidos)[1]).toEqual({ estado: 'erro', segundos: 2 });
  await page.clock.runFor(10_000);
  expect(await contar(page, pedidos)).toBe(2);
});

test('o que volta ao valor de antes não manda nada', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(500);
  await mudar(page, comOStatus('conectado'));
  await page.clock.runFor(5000);
  expect(await contar(page, pedidos)).toBe(1);
});

test('o tempo não zera entre o Conectando e o Erro no cadastro', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  // O ramal cai e fica tentando registrar por 75 s (o pedido do "conectando" sai aos 2 s).
  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(2095);
  await expect.poll(() => pedidos.length).toBe(2);
  await confirmado(page, pedidos[1]);
  await page.clock.runFor(72_900);
  // A central recusa o cadastro: o estado muda, e o tempo sem registrar continua contando do começo.
  await mudar(page, comOStatus('erro'));
  await page.clock.runFor(2100);
  await expect.poll(() => pedidos.length).toBe(3);
  expect(corpos(pedidos).slice(1)).toEqual([
    { estado: 'conectando', segundos: 2 },
    { estado: 'erro', segundos: 77 },
  ]);
  await expect
    .poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome))
    .toEqual({ estado: 'Sem registro', detalhe: 'há 1 min · o app diz “Erro no cadastro”' });
});

test('o tempo zera quando o ramal registra, e quando ele cai', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(2095);
  await expect.poll(() => pedidos.length).toBe(2);
  await confirmado(page, pedidos[1]);
  await page.clock.runFor(72_900);
  // O ramal registra, 75 s depois de cair: o tempo recomeça (o pedido leva os 2 s da espera).
  await mudar(page, comOStatus('conectado'));
  await page.clock.runFor(2100);
  await expect.poll(() => pedidos.length).toBe(3);
  expect(corpos(pedidos)[2]).toEqual({ estado: 'conectado', segundos: 2 });
  await confirmado(page, pedidos[2]);
  await expect.poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome)).toEqual({ estado: 'Online', detalhe: 'há menos de 1 min' });
  // E cai de novo, 30 s depois: o tempo recomeça outra vez.
  await page.clock.runFor(30_000);
  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(2100);
  await expect.poll(() => pedidos.length).toBe(4);
  expect(corpos(pedidos)[3]).toEqual({ estado: 'conectando', segundos: 2 });
});

test('a outra conta, com o mesmo ramal', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave, 'chat-duas-contas');
  let canaisNovos = 0;
  page.on('websocket', () => (canaisNovos += 1));

  // A primeira conta fica sem registrar por 12 s.
  await mudar(page, comOStatus('erro'));
  await page.clock.runFor(2095);
  await expect.poll(() => pedidos.length).toBe(2);
  await confirmado(page, pedidos[1]);
  await page.clock.runFor(10_000);
  // A segunda conta, posta com o mesmo ramal da primeira, passa a ser a conta em uso, também com o ramal sem registrar.
  // No chat a pessoa é a mesma (o ramal), e o canal dos eventos não abre de novo.
  await mudar(page, trocarDeConta('erro', RECEPCAO.ramal));
  await page.clock.runFor(2100);
  await expect.poll(() => pedidos.length).toBe(3);
  // O estado que vale é o da conta nova, e o tempo dela começou na troca (os 2 s da espera, e não os 14 da primeira).
  expect(corpos(pedidos).slice(1)).toEqual([
    { estado: 'erro', segundos: 2 },
    { estado: 'erro', segundos: 2 },
  ]);
  expect(canaisNovos).toBe(0);
  await esperarOsEventos(page);
});

test('a troca para a conta de outro ramal', async ({ page }) => {
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave, 'chat-duas-contas');

  // A Recepção fica registrando por 12 s.
  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(2095);
  await expect.poll(() => pedidos.length).toBe(2);
  await confirmado(page, pedidos[1]);
  await page.clock.runFor(10_000);
  // A conta em uso passa a ser a Caixa 2 (2015), também registrando. O chat entra como a pessoa nova, o canal abre de
  // novo, e o pedido da abertura leva o estado dela, com o tempo dela (zero, e não os 12 s da Recepção).
  await mudar(page, trocarDeConta('conectando'));
  await expect.poll(() => pedidos.length).toBe(3);
  expect(corpos(pedidos)[2]).toEqual({ estado: 'conectando', segundos: 0 });
  await confirmado(page, pedidos[2]);
  await expect.poll(() => estadoNaAdministracao(empresaId, 'Caixa 2')).toEqual({ estado: 'No chat', detalhe: 'registrando o ramal…' });
  // O computador conta só para quem está nele agora.
  expect((await estadoNaAdministracao(empresaId, RECEPCAO.nome)).estado).toBe('Offline');
  await page.clock.runFor(10_000);
  expect(await contar(page, pedidos)).toBe(3);
});

test('um pedido de cada vez', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);
  // A rota do ramal segura a primeira resposta que passar por ela, até o teste soltar.
  let soltar!: () => void;
  const solta = new Promise<void>((f) => (soltar = f));
  let naRota = 0;
  await page.route(`${baseDoChat()}${CAMINHO_DO_RAMAL}`, async (rota) => {
    naRota += 1;
    if (naRota === 1) await solta;
    await rota.continue();
  });

  // A primeira mudança sai aos 2 s, e a resposta dela fica presa.
  await mudar(page, comOStatus('erro'));
  await page.clock.runFor(2995);
  await expect.poll(() => naRota).toBe(1);
  // A segunda mudança, 3 s depois da primeira: a espera dela passa, e o pedido não sai enquanto o outro está no ar
  // (o mais velho poderia chegar por último ao chat, e ficar valendo).
  await mudar(page, comOStatus('conectando'));
  await page.clock.runFor(3000);
  expect(await contar(page, pedidos)).toBe(2);
  expect(naRota).toBe(1);
  // A resposta chega: o segundo pedido sai, com o valor de agora.
  soltar();
  await expect.poll(() => pedidos.length).toBe(3);
  expect(corpos(pedidos).map((c) => c.estado)).toEqual(['conectado', 'erro', 'conectando']);
  expect((await pedidos[2].response())?.status()).toBe(204);
});

test('a abertura no meio da espera', async ({ page }) => {
  // O fator das esperas da volta do canal em 1: a primeira tentativa é em 1 s.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirComOCanal(page, pessoas[0].chave);

  await mudar(page, comOStatus('erro'));
  await page.clock.runFor(995);
  // Com 1 s da espera de 2 s, o canal cai (o mesmo computador abre outro por fora) e volta 1 s depois.
  const porFora = await pessoas[0].api.abrirCanal();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __eventosNoAr?: number }).__eventosNoAr)).toBe(0);
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  // O pedido da abertura já leva o valor novo, e a espera que estava correndo não manda o mesmo valor de novo.
  await expect.poll(() => pedidos.length).toBe(2);
  expect(corpos(pedidos)[1].estado).toBe('erro');
  await page.clock.runFor(5000);
  expect(await contar(page, pedidos)).toBe(2);
  porFora.close();
});

// --- As falhas (tarefa 3) -------------------------------------------------------------------------------------------

const ROTA_DO_RAMAL = `${baseDoChat()}${CAMINHO_DO_RAMAL}`;
const resposta = (status: number, corpo: object) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(corpo) });

/** Os erros que a página escreve no console, fora os do próprio navegador para um pedido que falhou. */
function errosDaPagina(page: Page): string[] {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(e.message));
  return erros;
}

/** Nada apareceu para a pessoa: nenhum aviso na tela (um toast, uma faixa, um erro), e nenhum erro no console. */
async function nadaApareceu(page: Page, erros: string[]): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  expect(erros).toEqual([]);
}

/**
 * Abre com o chat ainda sem começar (a conta não conectou neste computador) e com o relógio parado: o teste põe a rota
 * do ramal e só então deixa o chat começar (o `comAContaConectada`).
 */
async function abrirAntesDoChat(page: Page, chave: string, status = 'conectado'): Promise<Request[]> {
  const pedidos = pedidosDoRamal(page);
  await page.clock.install();
  await abrirNoChat(page, { chave, ...RECEPCAO, cenario: 'chat-sem-conta', extra: { status } });
  await pararORelogio(page);
  return pedidos;
}

/** A resposta do pedido chegou (ou a conexão dele caiu), e a página já viu. */
async function voltou(page: Page, pedido: Request): Promise<void> {
  await pedido.response();
  await page.evaluate(() => 0);
}

test('o chat antigo: um 404 faz parar', async ({ page }) => {
  // O fator das esperas da volta do canal em 1: a primeira tentativa é em 1 s.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const erros = errosDaPagina(page);
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirAntesDoChat(page, pessoas[0].chave);
  // Um chat que ainda não tem a operação responde 404.
  await page.route(ROTA_DO_RAMAL, (rota) => rota.fulfill(resposta(404, { erro: 'naoEncontrado' })));

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  await voltou(page, pedidos[0]);
  // O ramal muda três vezes, com 5 s entre uma e outra: nenhum pedido novo.
  for (const status of ['erro', 'conectando', 'conectado']) {
    await mudar(page, comOStatus(status));
    await page.clock.runFor(5000);
  }
  expect(await contar(page, pedidos)).toBe(1);

  // O canal cai e volta: o app tenta uma vez, e só uma (o chat pode ter sido atualizado enquanto isso).
  const porFora = await pessoas[0].api.abrirCanal();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __eventosNoAr?: number }).__eventosNoAr)).toBe(0);
  await page.clock.runFor(1000);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(2);
  await voltou(page, pedidos[1]);
  await page.clock.runFor(60_000);
  expect(await contar(page, pedidos)).toBe(2);
  porFora.close();
  await nadaApareceu(page, erros);
});

const FALHAS: Array<{ nome: string; falhar(rota: Route): Promise<void> }> = [
  { nome: 'o 500', falhar: (rota) => rota.fulfill(resposta(500, { erro: 'servidor' })) },
  { nome: 'o 409 semLigacao', falhar: (rota) => rota.fulfill(resposta(409, { erro: 'semLigacao' })) },
  { nome: 'a conexão cortada', falhar: (rota) => rota.abort() },
];

for (const caso of FALHAS) {
  test(`uma falha tenta de novo: ${caso.nome}`, async ({ page }) => {
    const erros = errosDaPagina(page);
    const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
    const pedidos = await abrirAntesDoChat(page, pessoas[0].chave);
    // A rota falha nas duas primeiras vezes, e depois deixa passar.
    let naRota = 0;
    await page.route(ROTA_DO_RAMAL, (rota) => {
      naRota += 1;
      return naRota <= 2 ? caso.falhar(rota) : rota.continue();
    });

    await mudar(page, comAContaConectada);
    await esperarOsEventos(page);
    await expect.poll(() => pedidos.length).toBe(1);
    await voltou(page, pedidos[0]);
    // A primeira espera é de 0,5 a 1,5 s: com 1,5 s, a segunda tentativa saiu.
    await page.clock.runFor(1500);
    await expect.poll(() => pedidos.length).toBe(2);
    await voltou(page, pedidos[1]);
    // A segunda é de 1 a 3 s: com mais 3 s, sai a terceira, que passa.
    await page.clock.runFor(3000);
    await expect.poll(() => pedidos.length).toBe(3);
    await confirmado(page, pedidos[2]);
    // E mais nenhuma.
    await page.clock.runFor(60_000);
    expect(await contar(page, pedidos)).toBe(3);
    await expect.poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome)).toEqual({ estado: 'Online', detalhe: 'há menos de 1 min' });
    await nadaApareceu(page, erros);
  });
}

test('o limite espera o que o chat pede', async ({ page }) => {
  const erros = errosDaPagina(page);
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirAntesDoChat(page, pessoas[0].chave);
  let naRota = 0;
  await page.route(ROTA_DO_RAMAL, (rota) => {
    naRota += 1;
    return naRota === 1 ? rota.fulfill(resposta(429, { erro: 'limite', esperarSegundos: 7 })) : rota.continue();
  });

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  await voltou(page, pedidos[0]);
  // Com 6,9 s, nenhum pedido novo; com 7 s, a segunda tentativa.
  await page.clock.runFor(6900);
  expect(await contar(page, pedidos)).toBe(1);
  await page.clock.runFor(110);
  await expect.poll(() => pedidos.length).toBe(2);
  await confirmado(page, pedidos[1]);
  await nadaApareceu(page, erros);
});

test('um 429 sem o tempo de espera não vira um laço de pedidos', async ({ page }) => {
  const erros = errosDaPagina(page);
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos = await abrirAntesDoChat(page, pessoas[0].chave);
  // Um 429 que não é o do chat (o de um proxy no caminho, por exemplo): sem o `esperarSegundos`.
  let naRota = 0;
  await page.route(ROTA_DO_RAMAL, (rota) => {
    naRota += 1;
    return naRota <= 2 ? rota.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' }) : rota.continue();
  });

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  await voltou(page, pedidos[0]);
  // A tentativa seguinte espera como depois de uma falha comum (de 0,5 a 1,5 s), e não vai na mesma hora.
  await page.clock.runFor(400);
  expect(await contar(page, pedidos)).toBe(1);
  await page.clock.runFor(1100);
  await expect.poll(() => pedidos.length).toBe(2);
  await voltou(page, pedidos[1]);
  await page.clock.runFor(3000);
  await expect.poll(() => pedidos.length).toBe(3);
  await confirmado(page, pedidos[2]);
  await nadaApareceu(page, erros);
});

test('a tentativa leva o valor de agora', async ({ page }) => {
  const erros = errosDaPagina(page);
  const { empresaId, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  // O app abre com o ramal sem registrar.
  const pedidos = await abrirAntesDoChat(page, pessoas[0].chave, 'erro');
  let naRota = 0;
  await page.route(ROTA_DO_RAMAL, (rota) => {
    naRota += 1;
    return naRota === 1 ? rota.fulfill(resposta(500, { erro: 'servidor' })) : rota.continue();
  });

  await mudar(page, comAContaConectada);
  await esperarOsEventos(page);
  await expect.poll(() => pedidos.length).toBe(1);
  expect(corpos(pedidos)[0].estado).toBe('erro');
  await voltou(page, pedidos[0]);
  // Antes da segunda tentativa (de 0,5 a 1,5 s depois), o ramal registra: ela leva o estado novo, com o tempo dele.
  await mudar(page, comOStatus('conectado'));
  await page.clock.runFor(1500);
  await expect.poll(() => pedidos.length).toBe(2);
  expect(corpos(pedidos)[1].estado).toBe('conectado');
  expect(corpos(pedidos)[1].segundos).toBeLessThanOrEqual(1);
  await confirmado(page, pedidos[1]);
  // A espera de 2 s da mudança acaba sem outro pedido: o valor já foi confirmado.
  await page.clock.runFor(5000);
  expect(await contar(page, pedidos)).toBe(2);
  await expect.poll(() => estadoNaAdministracao(empresaId, RECEPCAO.nome)).toEqual({ estado: 'Online', detalhe: 'há menos de 1 min' });
  await nadaApareceu(page, erros);
});
