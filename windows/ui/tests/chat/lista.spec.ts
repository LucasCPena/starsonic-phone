// A aba Chat e a lista de conversas (Task 4), contra o servidor do chat de teste: a aba só com o computador ligado e
// com o número de não lidas, as linhas (as iniciais ou o ícone do grupo, a prévia, a hora e as não lidas, a mais nova
// primeiro), a mensagem que chega com a página aberta, a busca, a primeira vez e o "+", a conta que nunca se conectou
// aqui, o computador tirado do chat, o computador novo da mesma pessoa, a troca de conta (Review Focus 1), o Ctrl+5, o
// modo iPhone, o CSP e a acessibilidade nos dois temas. Cada teste cria a própria empresa.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { capturar, comandos, depoisDoQueChegou, empurrar, esperarComando, semViolacoesSerias, verTextos } from '../helpers';
import { abrirNoChat } from './abrir';
import { ApiDeTeste, baseDoChat, empresaComPessoas, ligarComputador } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '2004', nome: 'João Pereira' };
/** A segunda conta do cenário chat-duas-contas. */
const CAIXA = { ramal: '2015', nome: 'Caixa 2' };
const ID_DA_CAIXA = '41aa07c3d2e95b18';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Seções' });
const abaChat = (page: Page) => nav(page).locator('.tab-chat');
const linhas = (page: Page) => page.locator('.chat-linha');
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

// A hora como a página mostra (o timezoneId do playwright.config.ts).
const FUSO = 'America/Sao_Paulo';
const DIAS: Record<string, string> = { Sun: 'Dom', Mon: 'Seg', Tue: 'Ter', Wed: 'Qua', Thu: 'Qui', Fri: 'Sex', Sat: 'Sáb' };
const hora = (ms: number) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const diaDaSemana = (ms: number) => DIAS[new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(ms)];
function data(ms: number): { dia: string; mes: string; ano: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(ms).map((x) => [x.type, x.value]),
  );
  return { dia: p.day, mes: p.month, ano: p.year };
}

/** A hora da última mensagem da conversa, como o servidor a guardou. */
async function ultimaCriadaEm(api: ApiDeTeste, conversa: number): Promise<number> {
  return (await api.mensagens(conversa)).at(-1).criadaEm;
}

test('the Chat tab appears only with the computer linked, with the unread count', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;

  await abrirNoChat(page, { chave: '', ...RECEPCAO, cenario: 'chat-desligado' });
  await expect(nav(page).locator('button.tab')).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos']);

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(nav(page).locator('button.tab')).toHaveText(['Teclado', 'Atalhos', 'Recentes', 'Contatos', 'Chat']);
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
  await expect(abaChat(page)).toHaveAccessibleName('Chat');
  await expect(abaChat(page).locator('.tab-numero')).toHaveCount(0);

  // A Ana manda duas mensagens pela API: a aba conta cada uma, com o rótulo de leitor de tela e o número.
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 1 mensagem não lida');
  await ana.api.enviarTexto(dupla, 'O pedido chegou?');
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 2 mensagens não lidas');
  await expect(abaChat(page).locator('.tab-numero')).toHaveText('2');
  await esperarComando(page, { cmd: 'chatBadge', n: 2 });
});

test('the list shows initials or the group icon, the start of the last message, the time and the unread, newest first', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  // As conversas e as mensagens na mesma ordem, a dos ids e a da hora (João Pereira, Comercial, Ana Souza): duas
  // mensagens no mesmo milissegundo dão a mesma ordem, porque no empate a conversa de id maior vem primeiro.
  const comJoao = await a.api.criarDupla(joao.pessoa.id);
  const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id, ana.pessoa.id]);
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await a.api.enviarTexto(comJoao, 'Combinado, te ligo depois.');
  await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  const lista = linhas(page);
  await expect(lista.locator('.chat-nome')).toHaveText(['Ana Souza', 'Comercial', 'João Pereira']);
  await expect(lista.locator('.chat-previa')).toHaveText([
    'Pode me mandar a proposta da ACME?',
    'João: Fechamos o pedido de hoje.',
    'Você: Combinado, te ligo depois.',
  ]);
  await expect(lista.nth(0).locator('.chat-avatar')).toHaveText('AS');
  await expect(lista.nth(1).locator('.chat-avatar')).toHaveCount(0);
  await expect(lista.nth(1).locator('.chat-avatar-grupo svg')).toHaveCount(1);
  await expect(lista.nth(2).locator('.chat-avatar')).toHaveText('JP');
  const horas = [];
  for (const conversa of [comAna, comercial, comJoao]) horas.push(hora(await ultimaCriadaEm(a.api, conversa)));
  await expect(lista.locator('.chat-hora')).toHaveText(horas);
  // As não lidas: a da Ana e a do João no grupo; a minha não conta.
  await expect(lista.nth(0).locator('.chat-numero')).toHaveText('1');
  await expect(lista.nth(1).locator('.chat-numero')).toHaveText('1');
  await expect(lista.nth(2).locator('.chat-numero')).toHaveCount(0);
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 2 mensagens não lidas');
});

test('the time of the last message is Ontem, the weekday, dd/mm or dd/mm/aaaa', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  const criadaEm = await ultimaCriadaEm(a.api, dupla);
  const DIA = 86_400_000;
  const { dia, mes, ano } = data(criadaEm);
  // O relógio da página parado alguns dias depois da mensagem (os timers continuam).
  const casos: Array<[number, string]> = [
    [1, 'Ontem'],
    [3, diaDaSemana(criadaEm)],
    [6, diaDaSemana(criadaEm)],
    [8, data(criadaEm + 8 * DIA).ano === ano ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`],
    [400, `${dia}/${mes}/${ano}`],
  ];
  for (const [dias, esperado] of casos) {
    await page.clock.setFixedTime(criadaEm + dias * DIA);
    await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
    await expect(linhas(page).locator('.chat-hora'), `${dias} dias depois`).toHaveText([esperado]);
  }
});

test('a new message arrives live and moves its conversation to the top', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(comAna, 'Bom dia!');
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await joao.api.enviarTexto(comJoao, 'Tudo certo por aí?');

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  const nomes = linhas(page).locator('.chat-nome');
  await expect(nomes).toHaveText(['João Pereira', 'Ana Souza']);
  await page.evaluate(() => ((window as unknown as { __semRecarregar: boolean }).__semRecarregar = true));

  // A primeira chega pelos eventos ou pela releitura de quando eles ligam; a segunda, só pelos eventos, já ligados.
  await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
  await expect(nomes).toHaveText(['Ana Souza', 'João Pereira']);
  await expect(linhas(page).first().locator('.chat-previa')).toHaveText('Pode me mandar a proposta da ACME?');
  await expect(linhas(page).first().locator('.chat-numero')).toHaveText('2');
  await joao.api.enviarTexto(comJoao, 'Fechamos o pedido de hoje.');
  await expect(nomes).toHaveText(['João Pereira', 'Ana Souza']);
  await expect(linhas(page).first().locator('.chat-previa')).toHaveText('Fechamos o pedido de hoje.');
  await expect(linhas(page).first().locator('.chat-numero')).toHaveText('2');
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 4 mensagens não lidas');
  expect(await page.evaluate(() => (window as unknown as { __semRecarregar?: boolean }).__semRecarregar)).toBe(true);
});

test('Procurar conversa finds by the name without accent or case', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const comJoao = await joao.api.criarDupla(a.pessoa.id);
  await joao.api.enviarTexto(comJoao, 'Tudo certo por aí?');
  // O João fala no grupo, mas a busca é pelo nome da conversa.
  const comercial = await ana.api.criarGrupo('Comercial', [a.pessoa.id, joao.pessoa.id]);
  await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
  const comAna = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(comAna, 'Bom dia!');

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  const nomes = linhas(page).locator('.chat-nome');
  await expect(nomes).toHaveText(['Ana Souza', 'Comercial', 'João Pereira']);
  const busca = page.getByRole('searchbox', { name: 'Procurar conversa' });
  await expect(busca).toHaveAttribute('placeholder', 'Procurar conversa');
  await busca.fill('joao');
  await expect(nomes).toHaveText(['João Pereira']);
  await busca.fill('  JOÃO ');
  await expect(nomes).toHaveText(['João Pereira']);
  await busca.fill('xyz');
  await expect(linhas(page)).toHaveCount(0);
  await expect(page.getByText('Nenhuma conversa encontrada.', { exact: true })).toBeVisible();
  await busca.fill('');
  await expect(nomes).toHaveText(['Ana Souza', 'Comercial', 'João Pereira']);
  await expect(page.getByText('Nenhuma conversa encontrada.', { exact: true })).toHaveCount(0);
});

test('the first time shows Nenhuma conversa ainda and the + menu', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await verTextos(page, [
    'Chat',
    'Nenhuma conversa ainda',
    'Converse com os colegas da sua empresa, mande arquivos e fotos, e monte grupos.',
    'Começar uma conversa',
  ]);
  await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Começar uma conversa' })).toBeVisible();
  // Sem nenhuma conversa, sem a busca (o quadro Vazio).
  await expect(page.getByRole('searchbox', { name: 'Procurar conversa' })).toHaveCount(0);

  const mais = page.getByRole('button', { name: 'Nova conversa ou novo grupo' });
  await expect(mais).toHaveAttribute('aria-expanded', 'false');
  await mais.click();
  const menu = page.getByRole('menu', { name: 'Nova conversa ou novo grupo' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Nova conversa', 'Novo grupo']);
  await expect(menu.getByRole('menuitem', { name: 'Nova conversa' })).toBeFocused();
  await expect(mais).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(mais).toBeFocused();
  await expect(mais).toHaveAttribute('aria-expanded', 'false');
});

test('an account never connected here shows Conecte a sua conta para usar o chat.', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(baseDoChat())) pedidos.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, cenario: 'chat-sem-conta' });
  await expect(abaChat(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Conecte a sua conta para usar o chat.', { exact: true })).toBeVisible();
  await expect(linhas(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova conversa ou novo grupo' })).toHaveCount(0);
  // Sem a conta conectada aqui, o chat nem pede a chave nem fala com o servidor.
  await depoisDoQueChegou(page);
  expect((await comandos(page)).filter((c) => c.cmd === 'chatKey')).toEqual([]);
  expect(pedidos).toEqual([]);
});

test('a computer taken out shows the message and stops trying', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  await page.clock.install();
  let bilhetes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === `${baseDoChat()}/api/v1/eventos/bilhete`) bilhetes += 1;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // Os eventos ligados: a mensagem da Ana chega por eles ou pela releitura de quando eles ligam.
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await expect(linhas(page)).toHaveCount(1);
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 1 mensagem não lida');

  // O DELETE com a chave deste computador (a mesma da página).
  await a.api.desligar();
  await expect(page.getByText('Este computador saiu do chat. Fale com o suporte da Starsonic.', { exact: true })).toBeVisible();
  await expect(linhas(page)).toHaveCount(0);
  await expect(abaChat(page)).toHaveAccessibleName('Chat');
  await esperarComando(page, { cmd: 'chatBadge', n: 0 });

  // Dois minutos depois, nenhuma tentativa de ligar os eventos de novo.
  const antes = bilhetes;
  await page.clock.runFor(120_000);
  await page.waitForTimeout(500);
  expect(bilhetes).toBe(antes);
  await expect(page.getByText('Este computador saiu do chat. Fale com o suporte da Starsonic.', { exact: true })).toBeVisible();
});

test('a new computer of the same person shows the notice', async ({ page }) => {
  const { codigo, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  // Os eventos ligados (a mensagem chega por eles ou pela releitura de quando eles ligam): o aviso só vem por eles.
  const dupla = await ana.api.criarDupla(a.pessoa.id);
  await ana.api.enviarTexto(dupla, 'Bom dia!');
  await expect(linhas(page)).toHaveCount(1);

  // A mesma pessoa entra num segundo computador.
  const outro = await ligarComputador(codigo, 'RECEPCAO-02');
  await new ApiDeTeste(outro.chave).entrar(RECEPCAO.ramal, RECEPCAO.nome);
  const texto = 'Seu chat entrou em outro computador: RECEPCAO-02';
  const faixa = page.getByRole('status').filter({ hasText: texto });
  await expect(faixa).toBeVisible();
  await expect(faixa).toHaveText(texto);
  await esperarComando(page, { cmd: 'chatNotify', conversa: 0, titulo: 'Chat', texto });
  await faixa.getByRole('button', { name: 'Fechar o aviso' }).click();
  await expect(page.getByText(texto)).toHaveCount(0);
  // A lista continua.
  await expect(linhas(page)).toHaveCount(1);
});

test("switching the account clears the first person's chat before the second one's arrives", async ({ page }) => {
  // As duas contas do cenário são da mesma empresa: a Recepção (2001) e a Caixa 2 (2015).
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, CAIXA, ANA, JOAO]);
  const [a, caixa, ana, joao] = pessoas;
  const comA = await ana.api.criarDupla(a.pessoa.id);
  for (const texto of ['Bom dia!', 'Pode me mandar a proposta da ACME?']) await ana.api.enviarTexto(comA, texto);
  const comCaixa = await joao.api.criarDupla(caixa.pessoa.id);
  for (const texto of ['Oi!', 'Fechamos o pedido de hoje.', 'Combinado?']) await joao.api.enviarTexto(comCaixa, texto);

  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO, cenario: 'chat-duas-contas' });
  await expect(linhas(page).locator('.chat-nome')).toHaveText(['Ana Souza']);
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 2 mensagens não lidas');

  // A cada mudança da página com a segunda conta no cabeçalho: nem a conversa da primeira pessoa, nem o número dela.
  await page.evaluate(() => {
    const w = window as unknown as { __misturas: unknown[] };
    w.__misturas = [];
    new MutationObserver(() => {
      if (!document.querySelector('.account-name')?.textContent?.includes('2015')) return;
      const nomes = [...document.querySelectorAll('.chat-nome')].map((n) => n.textContent);
      const rotulo = document.querySelector('.tab-chat')?.getAttribute('aria-label');
      if (nomes.includes('Ana Souza') || rotulo === 'Chat, 2 mensagens não lidas') w.__misturas.push({ nomes, rotulo });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.getByRole('button', { name: /Trocar de conta/ }).click();
  await page.getByRole('menuitemradio', { name: /Caixa 2/ }).click();
  await esperarComando(page, { cmd: 'selectAccount', contaId: ID_DA_CAIXA });
  await expect(page.locator('.account-name')).toHaveText('Caixa 2 · 2015');
  await expect(linhas(page).locator('.chat-nome')).toHaveText(['João Pereira']);
  await expect(abaChat(page)).toHaveAccessibleName('Chat, 3 mensagens não lidas');
  await expect(abaChat(page).locator('.tab-numero')).toHaveText('3');
  expect(await page.evaluate(() => (window as unknown as { __misturas: unknown[] }).__misturas)).toEqual([]);
  // O número no ícone: o da primeira pessoa, 0 na troca e o da segunda.
  expect((await comandos(page)).filter((c) => c.cmd === 'chatBadge').map((c) => c.n)).toEqual([2, 0, 3]);
});

test('Ctrl+5 opens the Chat tab only with the computer linked', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  await abrirNoChat(page, { chave: '', ...RECEPCAO, cenario: 'chat-desligado' });
  await page.keyboard.press('Control+5');
  await expect(nav(page).getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Teclado' })).toBeVisible();
  await expect(abaChat(page)).toHaveCount(0);

  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await expect(abaChat(page)).toHaveAttribute('aria-keyshortcuts', 'Control+5');
  await page.keyboard.press('Control+1');
  await expect(nav(page).getByRole('button', { name: 'Teclado' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+5');
  await expect(abaChat(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
});

test('a click on a chat notice (abrir) opens the Chat tab', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await page.keyboard.press('Control+3');
  await expect(nav(page).getByRole('button', { name: 'Recentes' })).toHaveAttribute('aria-current', 'page');
  await empurrar(page, { v: 1, type: 'abrir', tela: 'chat', conversa: 0 });
  await expect(abaChat(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
});

test('in iPhone mode there is no Chat tab', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  const pedidos: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(baseDoChat())) pedidos.push(r.url());
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO, extra: { plataforma: 'ios' } });
  await expect(nav(page).locator('button.tab')).toHaveText(['Teclado', 'Recentes', 'Contatos']);
  await expect(abaChat(page)).toHaveCount(0);
  await depoisDoQueChegou(page);
  expect((await comandos(page)).filter((c) => String(c.cmd).startsWith('chat'))).toEqual([]);
  expect(pedidos).toEqual([]);
});

test('the page CSP lets the app reach only the chat server', () => {
  const html = readFileSync(fileURLToPath(new URL('../../dist/index.html', import.meta.url)), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1];
  expect(csp).toBe(
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; " +
      "connect-src 'self' https://chat.starcloud-starsonic.com.br:8443 wss://chat.starcloud-starsonic.com.br:8443; media-src 'self'",
  );
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a lista do chat (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the list has no serious accessibility violations', async ({ page }) => {
      const { codigo, pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
      const [a, ana, joao] = pessoas;
      const comJoao = await a.api.criarDupla(joao.pessoa.id);
      await a.api.enviarTexto(comJoao, 'Combinado, te ligo depois.');
      const comercial = await joao.api.criarGrupo('Comercial', [a.pessoa.id, ana.pessoa.id]);
      await joao.api.enviarTexto(comercial, 'Fechamos o pedido de hoje.');
      const comAna = await ana.api.criarDupla(a.pessoa.id);
      await ana.api.enviarTexto(comAna, 'Bom dia!');

      await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
      await expect(linhas(page)).toHaveCount(3);
      // Os eventos ligados (a mensagem chega por eles ou pela releitura de quando eles ligam), e o aviso do computador novo.
      await ana.api.enviarTexto(comAna, 'Pode me mandar a proposta da ACME?');
      await expect(linhas(page).first().locator('.chat-numero')).toHaveText('2');
      const outro = await ligarComputador(codigo, 'RECEPCAO-02');
      await new ApiDeTeste(outro.chave).entrar(RECEPCAO.ramal, RECEPCAO.nome);
      await expect(page.getByText('Seu chat entrou em outro computador: RECEPCAO-02', { exact: true })).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'chat-lista', nomeDoTema(tema));

      await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
      await expect(page.getByRole('menu', { name: 'Nova conversa ou novo grupo' })).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'chat-lista-menu', nomeDoTema(tema));
    });

    test('the banner Sem conexão com o chat. Tentando de novo… shows while the server is out, and it tries again', async ({ page }) => {
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
      const api = `${baseDoChat()}/api/**`;
      await page.route(api, (rota) => rota.abort());
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      const faixa = page.getByRole('status').filter({ hasText: 'Sem conexão com o chat. Tentando de novo…' });
      await expect(faixa).toBeVisible();
      await expect(faixa).toHaveText('Sem conexão com o chat. Tentando de novo…');
      await semViolacoesSerias(page);
      await capturar(page, 'chat-sem-conexao', nomeDoTema(tema));

      // O servidor volta: na próxima tentativa, a primeira vez.
      await page.unroute(api);
      await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(faixa).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'chat-vazio', nomeDoTema(tema));
      await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
      await expect(page.getByRole('menu', { name: 'Nova conversa ou novo grupo' })).toBeVisible();
      await capturar(page, 'chat-vazio-menu', nomeDoTema(tema));
    });
  });
}
