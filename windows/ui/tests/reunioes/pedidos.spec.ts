// Os pedidos de quem quer entrar numa reunião que o computador abriu no navegador (Task 11): os eventos e a conferência
// põem o pedido no aviso do Windows (o reuniaoPedido), o aviso responde (a mensagem reuniaoResposta) e a resposta chama
// a rota. Os eventos entram pelo comEventos (o chat de teste não tem servidor de vídeo, e nele ninguém "está na
// reunião"); a reunião é aberta pelo "Abrir no navegador", com o passe de verdade. Os testes que andam o relógio da
// página esperam antes o app tratar cada resposta (a leitura numerada, o comando do pedido): o relógio nunca anda logo
// depois de um pedido que o app ainda não tratou. Cada arquivo de teste provoca no máximo duas falhas de verdade do
// passe (nenhuma aqui); as outras respostas de erro são dadas pelo page.route.
import { expect, test, type Page } from '@playwright/test';
import { comandos, empurrar, esperarComando, vezes, type Comando } from '../helpers';
import { empresaComReunioes } from '../chat/servidor';
import { esperarOsEventos, pararORelogio } from '../chat/abrir';
import {
  abrirNasReunioes,
  comEventos,
  esperarALeitura,
  marcar,
  noRelogioDaPagina,
  numerarAsLeituras,
} from './abrir';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const PLANEJAMENTO = 'Planejamento de dezembro';
const MARIA = { id: '0123456789abcdef', nome: 'Maria Lima' };
const RUI = { id: 'fedcba9876543210', nome: 'Rui Alves' };
const VERA = { id: '1122334455667788', nome: 'Vera Costa' };
const OUTRA = 'abc-defg-hij';
const NAO_RESPONDEU = 'O servidor do chat não respondeu. Tente de novo.';
const CHEIA = 'A reunião está cheia: ninguém mais entra agora.';
const SEM_CONEXAO = 'Sem conexão com o chat. As reuniões voltam quando a conexão voltar.';
const SEM_PEDIDO = { cmd: 'reuniaoPedido' };
const ePassoDaRota = (url: URL) => /\/reunioes\/[^/]+\/(aceitar|recusar)$/.test(url.pathname);
const eAConferencia = (url: URL) => /\/reunioes\/[^/]+\/participantes$/.test(url.pathname);

/** O reuniaoPedido com o pedido, como o núcleo o recebe. */
const mostrando = (p: { id: string; nome: string }, assunto: string | null) => ({
  cmd: 'reuniaoPedido',
  pedido: { id: p.id, nome: p.nome, assunto },
  escondida: true,
});

/** Os reuniaoPedido que a ponte recebeu, na ordem. */
async function dosPedidos(page: Page): Promise<Comando[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'reuniaoPedido');
}

/** O reuniaoPedido exato, uma vez só na lista de tudo o que saiu (ele sai na ordem). */
const dizem = (...esperados: object[]) => esperados.map((e) => ({ v: 1, ...e }));

const participante = { id: 'aaaaaaaaaaaaaaaa', nome: RECEPCAO.nome, deFora: false, tela: true };
const comOsPedidos = (reuniao: string, ...pedidos: Array<{ id: string; nome: string }>) => ({
  tipo: 'reuniaoParticipantes',
  reuniao,
  participantes: [participante],
  pedidos,
});

interface Aberto {
  codigo: string;
  eventos: Awaited<ReturnType<typeof comEventos>>;
}

/**
 * Abre o app nas Reuniões, com uma reunião marcada (para amanhã), os eventos pelo comEventos e a reunião aberta no
 * navegador (`navegador: false` não a abre; `marcar: false` não a marca). `relogio`: o relógio da página fica parado e
 * só anda pelo runFor, depois de o app tratar a leitura da lista (a numerada: o assunto da primeira reunião vira
 * "Leitura N", e a linha dela se acha pelo nome sem ele) e de a reunião abrir.
 */
async function abrir(
  page: Page,
  o: { assunto?: string; relogio?: boolean; cenario?: 'chat-duas-contas'; marcar?: boolean; navegador?: boolean } = {},
): Promise<Aberto> {
  const { pessoas } = await empresaComReunioes(EMPRESA, o.cenario ? [RECEPCAO, CAIXA] : [RECEPCAO]);
  const criada =
    o.marcar === false ? { codigo: OUTRA } : await marcar(pessoas[0].api, noRelogioDaPagina(1, 10, 0), o.assunto);
  let leituras: Awaited<ReturnType<typeof numerarAsLeituras>> | null = null;
  if (o.relogio) {
    await page.clock.install({ time: Date.now() });
    leituras = await numerarAsLeituras(page, 150);
  }
  const eventos = await comEventos(page);
  await abrirNasReunioes(page, { chave: pessoas[0].chave, ...RECEPCAO, ...(o.cenario ? { cenario: o.cenario } : {}) });
  await esperarOsEventos(page);
  if (leituras) await esperarALeitura(page, leituras, 2);
  if (o.navegador !== false && o.marcar !== false) await abrirNoNavegador(page);
  if (leituras) await pararORelogio(page);
  return { codigo: criada.codigo, eventos };
}

/** Abre a reunião marcada pelo "Abrir no navegador" (o passe de verdade) e espera o comando sair. */
async function abrirNoNavegador(page: Page): Promise<void> {
  const antes = (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length;
  await page.getByRole('button', { name: /^Mais opções de / }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Abrir no navegador' }).click();
  await expect
    .poll(async () => (await comandos(page)).filter((c) => c.cmd === 'reuniaoNavegador').length)
    .toBe(antes + 1);
}

/** O aviso responde ao pedido (a mensagem do núcleo). */
const responder = (page: Page, pedido: string, resposta: 'aceitar' | 'recusar' | 'fechar') =>
  empurrar(page, { v: 1, type: 'reuniaoResposta', pedido, resposta });

/** As rotas aceitar e recusar, respondidas pelo teste: o que chegou a elas, na ordem. */
async function respondendoAsRotas(
  page: Page,
  resposta: { status: number; json?: object } | 'abortar',
): Promise<Array<{ caminho: string; corpo: unknown }>> {
  const chamadas: Array<{ caminho: string; corpo: unknown }> = [];
  await page.route(ePassoDaRota, (rota) => {
    const pedido = rota.request();
    if (pedido.method() !== 'POST') return rota.continue();
    chamadas.push({ caminho: new URL(pedido.url()).pathname, corpo: pedido.postDataJSON() });
    return resposta === 'abortar' ? rota.abort() : rota.fulfill(resposta);
  });
  return chamadas;
}

/**
 * Dá tempo de um pedido que saísse errado, ou de uma resposta que o app trata, chegar a quem confere. Não usa o relógio
 * da página (parado, em alguns testes): um pedido de verdade ao servidor da página e duas idas e voltas.
 */
async function dandoTempo(page: Page): Promise<void> {
  await page.evaluate(() => fetch('/index.html').then((r) => r.text()));
  await page.evaluate(() => 0);
  await page.evaluate(() => 0);
}

// Uma leitura da lista ainda no ar (a numerada demora de propósito) quando o teste acaba não deve falhar o seguinte.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const toast = (page: Page) => page.locator('.toast-box');

test('o pedido de uma reunião aberta no navegador vai ao aviso, com o nome e o assunto', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  // Nada sai antes de haver um pedido.
  expect(await dosPedidos(page)).toEqual([]);
  await eventos.mandar(comOsPedidos(codigo, { id: MARIA.id, nome: 'Maria Lima' }));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  // O mesmo pedido não é mandado duas vezes seguidas: a lista repetida, e só depois o fim dele.
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await eventos.mandar({ tipo: 'reuniaoPedido', reuniao: codigo, pedido: MARIA });
  await eventos.mandar({ tipo: 'reuniaoPedidoFim', reuniao: codigo, pedido: MARIA.id });
  await expect.poll(() => dosPedidos(page)).toEqual(dizem(mostrando(MARIA, PLANEJAMENTO), SEM_PEDIDO));
});

test('o nome vai com até 120 caracteres e sem caracteres de controle', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  // 100 letras e 14 emojis (um ponto de código cada, dois da UTF-16) depois de "Maria ": o corte é de 120 pontos.
  const corpo = `${'a'.repeat(100)}${'😀'.repeat(14)}`;
  const certo = `Maria ${corpo}`;
  const nome = `Ma\u0000ri\u009fa\u007f ${corpo}${'b'.repeat(30)}`;
  await eventos.mandar(comOsPedidos(codigo, { id: MARIA.id, nome }));
  await esperarComando(page, mostrando({ id: MARIA.id, nome: certo }, PLANEJAMENTO));
});

test('a reunião sem assunto manda o assunto vazio', async ({ page }) => {
  const { codigo, eventos } = await abrir(page);
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, ''));
});

test('a reunião que o app não abriu manda null, ou o assunto da lista se ela é da pessoa', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, navegador: false });
  // Uma reunião que a lista da pessoa não tem: o assunto não é conhecido.
  await eventos.mandar(comOsPedidos(OUTRA, MARIA));
  await esperarComando(page, mostrando(MARIA, null));
  // Uma reunião dela que o app não abriu (o app foi reaberto com a do navegador em andamento): o assunto da lista.
  await eventos.mandar(comOsPedidos(codigo, RUI));
  await esperarComando(page, mostrando(MARIA, null));
  await responder(page, MARIA.id, 'fechar');
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
});

test('dois pedidos aparecem um de cada vez, o mais antigo primeiro', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await eventos.mandar({ tipo: 'reuniaoPedido', reuniao: codigo, pedido: MARIA });
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await eventos.mandar({ tipo: 'reuniaoPedido', reuniao: OUTRA, pedido: VERA });
  // O da outra reunião (que o app não conhece) é o mais novo dos três: o aviso ainda mostra o primeiro.
  await responder(page, MARIA.id, 'fechar');
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
  await responder(page, RUI.id, 'fechar');
  await esperarComando(page, mostrando(VERA, null));
  await responder(page, VERA.id, 'fechar');
  await expect
    .poll(() => dosPedidos(page))
    .toEqual(
      dizem(
        mostrando(MARIA, PLANEJAMENTO),
        mostrando(RUI, PLANEJAMENTO),
        mostrando(VERA, null),
        SEM_PEDIDO,
      ),
    );
});

test('o pedido respondido por outro colega sai do aviso', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await eventos.mandar({ tipo: 'reuniaoPedidoFim', reuniao: codigo, pedido: MARIA.id });
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
  await eventos.mandar({ tipo: 'reuniaoPedidoFim', reuniao: codigo, pedido: RUI.id });
  await esperarComando(page, SEM_PEDIDO);
});

test('a reunião que acabou limpa o aviso', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await eventos.mandar({ tipo: 'reuniaoAcabou', reuniao: codigo });
  await esperarComando(page, SEM_PEDIDO);
  expect(await vezes(page, SEM_PEDIDO)).toBe(1);
});

test('o pedido sai do aviso quando o computador sai da reunião, que o servidor não avisa (409)', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, relogio: true });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await page.route(eAConferencia, (rota) => rota.fulfill({ status: 409, json: { erro: 'foraDaReuniao' } }));
  await page.clock.runFor(10_000);
  await esperarComando(page, SEM_PEDIDO);
});

test('o pedido sai do aviso quando a conferência já não o traz', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, relogio: true });
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await page.route(eAConferencia, (rota) =>
    rota.fulfill({ status: 200, json: { participantes: [participante], pedidos: [RUI] } }),
  );
  await page.clock.runFor(10_000);
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
});

test('a conferência com um 200 de outro formato não muda nada', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, relogio: true });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  let conferencias = 0;
  await page.route(eAConferencia, (rota) => {
    conferencias += 1;
    return rota.fulfill({ status: 200, json: { participantes: 'ninguém', pedidos: [] } });
  });
  await page.clock.runFor(10_000);
  await expect.poll(() => conferencias).toBe(1);
  await dandoTempo(page);
  expect(await dosPedidos(page)).toEqual(dizem(mostrando(MARIA, PLANEJAMENTO)));
});

test('a reunião que o servidor não conhece (404) sai da lista, com os pedidos dela', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, relogio: true });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await page.route(eAConferencia, (rota) => rota.fulfill({ status: 404, json: { erro: 'naoEncontrado' } }));
  await page.clock.runFor(10_000);
  await esperarComando(page, SEM_PEDIDO);
});

test('o Aceitar do aviso chama a rota aceitar com o id, e o jaRespondido não é erro', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  const chamadas = await respondendoAsRotas(page, { status: 204 });
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'aceitar');
  // O pedido sai do aviso na hora: o próximo aparece.
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
  await expect.poll(() => chamadas.length).toBe(1);
  expect(chamadas[0]).toEqual({ caminho: `/api/v1/reunioes/${codigo}/aceitar`, corpo: { pedido: MARIA.id } });
  await dandoTempo(page);
  await expect(toast(page)).toHaveCount(0);

  // O jaRespondido (outro colega respondeu antes) também não diz nada, e o pedido não volta.
  await page.unroute(ePassoDaRota);
  const outras = await respondendoAsRotas(page, { status: 409, json: { erro: 'jaRespondido' } });
  await responder(page, RUI.id, 'aceitar');
  await expect.poll(() => outras.length).toBe(1);
  await dandoTempo(page);
  await expect(toast(page)).toHaveCount(0);
  expect(await dosPedidos(page)).toEqual(
    dizem(mostrando(MARIA, PLANEJAMENTO), mostrando(RUI, PLANEJAMENTO), SEM_PEDIDO),
  );
});

test('o Recusar do aviso chama a rota recusar com o id, e o 404 não é erro', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  const chamadas = await respondendoAsRotas(page, { status: 404, json: { erro: 'naoEncontrado' } });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'recusar');
  await expect.poll(() => chamadas.length).toBe(1);
  expect(chamadas[0]).toEqual({ caminho: `/api/v1/reunioes/${codigo}/recusar`, corpo: { pedido: MARIA.id } });
  await dandoTempo(page);
  await expect(toast(page)).toHaveCount(0);
  await esperarComando(page, SEM_PEDIDO);
});

test('o fechar tira o pedido do aviso sem rota, e a resposta de um pedido desconhecido é ignorada', async ({
  page,
}) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  const chamadas = await respondendoAsRotas(page, { status: 204 });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, VERA.id, 'aceitar');
  await responder(page, MARIA.id, 'fechar');
  await esperarComando(page, SEM_PEDIDO);
  // A resposta de novo, de um pedido que já saiu do aviso, também nada.
  await responder(page, MARIA.id, 'aceitar');
  await dandoTempo(page);
  expect(chamadas).toEqual([]);
  expect(await dosPedidos(page)).toEqual(dizem(mostrando(MARIA, PLANEJAMENTO), SEM_PEDIDO));
});

test('a reunião cheia diz A reunião está cheia, e o pedido não volta ao aviso', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  const chamadas = await respondendoAsRotas(page, { status: 409, json: { erro: 'cheia' } });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'aceitar');
  await expect(toast(page)).toHaveText(CHEIA);
  expect(chamadas).toHaveLength(1);
  // O servidor ainda lista o pedido (ele continua esperando): o aviso mostra o seguinte, e o Maria não volta.
  await eventos.mandar(comOsPedidos(codigo, MARIA, RUI));
  await esperarComando(page, mostrando(RUI, PLANEJAMENTO));
  expect(await dosPedidos(page)).toEqual(
    dizem(mostrando(MARIA, PLANEJAMENTO), SEM_PEDIDO, mostrando(RUI, PLANEJAMENTO)),
  );
});

test('o servidor que não responde diz a frase, e o pedido volta ao aviso', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await respondendoAsRotas(page, 'abortar');
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'aceitar');
  await expect(toast(page)).toHaveText(NAO_RESPONDEU);
  await expect
    .poll(() => dosPedidos(page))
    .toEqual(dizem(mostrando(MARIA, PLANEJAMENTO), SEM_PEDIDO, mostrando(MARIA, PLANEJAMENTO)));
});

test('um 500 devolve o pedido ao aviso, e o foraDaReuniao da rota tira o computador da reunião', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await page.route(ePassoDaRota, (rota) => rota.fulfill({ status: 500, json: { erro: 'servidor' } }));
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'recusar');
  await expect(toast(page)).toHaveText(NAO_RESPONDEU);
  await expect.poll(() => vezes(page, mostrando(MARIA, PLANEJAMENTO))).toBe(2);
  // O 409 foraDaReuniao: o computador deixa de estar na reunião, e os pedidos dela saem.
  await page.unroute(ePassoDaRota);
  await page.route(ePassoDaRota, (rota) => rota.fulfill({ status: 409, json: { erro: 'foraDaReuniao' } }));
  await responder(page, MARIA.id, 'aceitar');
  await esperarComando(page, SEM_PEDIDO);
});

test('a troca de conta limpa o aviso, e a resposta que chega depois não sai', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, cenario: 'chat-duas-contas' });
  const chamadas = await respondendoAsRotas(page, { status: 204 });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await page.getByRole('button', { name: /Trocar de conta/ }).click();
  await page.getByRole('menuitemradio', { name: /Caixa 2/ }).click();
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await esperarComando(page, SEM_PEDIDO);
  await responder(page, MARIA.id, 'aceitar');
  await dandoTempo(page);
  expect(chamadas).toEqual([]);
  expect(await dosPedidos(page)).toEqual(dizem(mostrando(MARIA, PLANEJAMENTO), SEM_PEDIDO));
});

test('o clique fora dos botões do aviso leva à aba Reuniões', async ({ page }) => {
  await abrir(page, { assunto: PLANEJAMENTO });
  const titulo = page.getByRole('heading', { name: 'Reuniões', level: 1 });
  await page.locator('nav.nav button.tab-teclado').click();
  await expect(titulo).toHaveCount(0);
  await empurrar(page, { v: 1, type: 'abrir', tela: 'reunioes' });
  await expect(titulo).toBeVisible();
});

test('na volta da conexão, a conferência sai na hora', async ({ page }) => {
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO, relogio: true });
  await eventos.mandar(comOsPedidos(codigo, MARIA));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  let conferencias = 0;
  await page.route(eAConferencia, (rota) => {
    conferencias += 1;
    return rota.fallback();
  });
  await eventos.derrubar();
  // A aba das reuniões diz a falta de conexão: o app tratou a queda.
  await expect(page.getByRole('status').filter({ hasText: SEM_CONEXAO })).toBeVisible();
  eventos.voltar();
  // A nova tentativa sai 1 s depois da queda; a conferência dos 10 s está longe.
  await page.clock.runFor(1_000);
  await expect.poll(() => conferencias).toBe(1);
  expect(await dosPedidos(page)).toEqual(dizem(mostrando(MARIA, PLANEJAMENTO)));
});

test('um evento malformado é ignorado, e um válido não mexe na lista de conversas', async ({ page }) => {
  const { eventos } = await abrir(page, { marcar: false });
  const mal: object[] = [
    { tipo: 'reuniaoPedido', reuniao: 5, pedido: MARIA },
    { tipo: 'reuniaoPedido', reuniao: OUTRA, pedido: { id: MARIA.id } },
    { tipo: 'reuniaoPedido', reuniao: OUTRA },
    { tipo: 'reuniaoPedidoFim', reuniao: OUTRA },
    { tipo: 'reuniaoParticipantes', reuniao: OUTRA, participantes: 'nenhum', pedidos: [MARIA] },
    { tipo: 'reuniaoParticipantes', reuniao: OUTRA, participantes: [{ id: 'a', nome: 'b' }], pedidos: [MARIA] },
    { tipo: 'reuniaoParticipantes', reuniao: OUTRA, participantes: [], pedidos: [{ nome: 'sem id' }] },
    { tipo: 'reuniaoAcabou' },
  ];
  for (const e of mal) await eventos.mandar(e);
  await eventos.mandar(comOsPedidos(OUTRA, MARIA));
  await esperarComando(page, mostrando(MARIA, null));
  // Os malformados, que vieram antes, não puseram nada no aviso.
  expect(await dosPedidos(page)).toEqual(dizem(mostrando(MARIA, null)));
  // O evento das reuniões não vira conversa nem mensagem.
  await page.locator('nav.nav button.tab-chat').click();
  await expect(page.getByRole('heading', { name: 'Nenhuma conversa ainda' })).toBeVisible();
  await expect(page.locator('.chat-linha')).toHaveCount(0);
});

test('nada do pedido vai ao console', async ({ page }) => {
  const mensagens: string[] = [];
  page.on('console', (m) => {
    if (!m.text().startsWith('Failed to load resource')) mensagens.push(m.text());
  });
  page.on('pageerror', (e) => mensagens.push(e.message));
  const { codigo, eventos } = await abrir(page, { assunto: PLANEJAMENTO });
  await respondendoAsRotas(page, { status: 500, json: { erro: 'servidor' } });
  await eventos.mandar(comOsPedidos(codigo, MARIA, { id: RUI.id, nome: 'Rui\u0000 Alves' }));
  await esperarComando(page, mostrando(MARIA, PLANEJAMENTO));
  await responder(page, MARIA.id, 'aceitar');
  await expect(toast(page)).toHaveText(NAO_RESPONDEU);
  await eventos.mandar({ tipo: 'reuniaoPedidoFim', reuniao: codigo, pedido: MARIA.id });
  await eventos.mandar({ tipo: 'reuniaoAcabou', reuniao: codigo });
  await esperarComando(page, SEM_PEDIDO);
  for (const segredo of [MARIA.id, RUI.id, 'Maria Lima', 'Rui Alves', PLANEJAMENTO, codigo]) {
    expect(mensagens.filter((m) => m.includes(segredo))).toEqual([]);
  }
  expect(mensagens).toEqual([]);
});
