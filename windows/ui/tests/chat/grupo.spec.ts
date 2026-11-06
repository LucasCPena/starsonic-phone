// O novo grupo, os membros e o pôr pessoas (Task 5), contra o servidor do chat de teste: o grupo criado com o nome e as
// pessoas escolhidas (e os avisos dele na conversa), o botão que espera o nome e uma pessoa, o nome de até 60
// caracteres, a escolha que para em 199 (e o 409 grupoCheio), o Criar grupo sem rede (R31), quem cuida nos membros (o
// Tirar e o Pôr pessoas só para ela, o Sair para todos), o Tirar e o Sair com a confirmação, o pôr pessoas só com quem
// está fora do grupo, os eventos conversa e conversaSaiu na lista, o grupo que sai com os membros abertos (R26), os
// membros que acompanham quem cuida (R27), os nomes compridos sem rolar para o lado, a lista dos membros que rola pelo
// teclado e a acessibilidade nos dois temas (R32). Cada teste cria a própria empresa.
import { expect, test, type Page, type Route } from '@playwright/test';
import { capturar, semViolacoesSerias } from '../helpers';
import { abrirAConversa, abrirNoChat, esperarOsEventos } from './abrir';
import { baseDoChat, empresaComPessoas } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '3002', nome: 'João Pereira' };
const BEATRIZ = { ramal: '3004', nome: 'Beatriz Ramos' };
const CARLOS = { ramal: '2011', nome: 'Carlos Lima' };
const VOCE_CUIDA = 'Você cuida deste grupo: só você põe e tira pessoas. Quem está no grupo pode sair quando quiser.';
const GRUPO_CHEIO = 'O grupo já tem 200 pessoas.';
/** O POST e o GET das conversas (o criar e a lista). */
const CONVERSAS = `${baseDoChat()}/api/v1/conversas`;
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');
/** Um instante da página (um pedido que acabou de chegar já foi tratado). */
const umInstante = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

/** Da aba Chat para o Novo grupo, pelo "+". */
async function irParaONovoGrupo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
  await page.getByRole('menuitem', { name: 'Novo grupo' }).click();
  await expect(page.getByRole('heading', { name: 'Novo grupo', level: 1 })).toBeVisible();
}

/** Os membros do grupo pela conversa dele (a linha da lista e o "N pessoas · ver os membros" do cabeçalho). */
async function abrirOsMembros(page: Page, grupo: string): Promise<void> {
  await abrirAConversa(page, grupo);
  await page.getByRole('button', { name: `Ver os membros do grupo ${grupo}` }).click();
  await expect(page.getByRole('heading', { name: 'Membros do grupo', level: 1 })).toBeVisible();
}

const nomeDoGrupo = (page: Page) => page.getByRole('textbox', { name: 'Nome do grupo' });
const pessoa = (page: Page, nome: string) => page.getByRole('checkbox', { name: new RegExp(`^${nome}`) });
const criar = (page: Page) => page.getByRole('button', { name: /^Criar grupo/ });
const membros = (page: Page) => page.locator('.membros .chat-pessoa');
const nomesDosMembros = (page: Page) => membros(page).locator('.chat-pessoa-nome');
const linhasDosMembros = (page: Page) => membros(page).locator('.chat-pessoa-sub');
const avisosDe = (page: Page, grupo: string) => page.getByRole('log', { name: `Mensagens do grupo ${grupo}` }).locator('.conversa-aviso');
const nomesDaLista = (page: Page) => page.locator('.chat-linha .chat-nome');

test('Novo grupo creates the group with the name and the chosen people', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await irParaONovoGrupo(page);
  await expect(page.locator('.bar-eyebrow')).toHaveText('Chat');
  await expect(nomeDoGrupo(page)).toBeFocused();
  const busca = page.getByRole('searchbox', { name: 'Procurar uma pessoa pelo nome ou pelo ramal' });
  await expect(busca).toHaveAttribute('placeholder', 'Procurar pelo nome ou pelo ramal');
  await expect(page.locator('.escolher .chat-pessoa-nome')).toHaveText(['Ana Souza', 'João Pereira']);
  await expect(page.locator('.escolher .chat-pessoa-sub')).toHaveText(['Ramal 2003', 'Ramal 3002']);

  await nomeDoGrupo(page).fill('Financeiro');
  await pessoa(page, 'Ana Souza').check();
  await expect(page.getByText('Pessoas · 1 escolhida', { exact: true })).toBeVisible();
  await expect(criar(page)).toHaveText('Criar grupo com 2 pessoas');
  // A escolhida fica escolhida também fora da busca.
  await busca.fill('joao');
  await expect(page.locator('.escolher .chat-pessoa-nome')).toHaveText(['João Pereira']);
  await pessoa(page, 'João Pereira').check();
  await busca.fill('');
  await expect(pessoa(page, 'Ana Souza')).toBeChecked();
  await expect(page.getByText('Pessoas · 2 escolhidas', { exact: true })).toBeVisible();
  await expect(criar(page)).toHaveText('Criar grupo com 3 pessoas');
  await criar(page).click();

  // A conversa do grupo abre: o nome, as 3 pessoas e os avisos do servidor (quem fez sou eu: "Você").
  await expect(avisosDe(page, 'Financeiro')).toHaveText(['Você criou o grupo', 'Você pôs Ana Souza no grupo', 'Você pôs João Pereira no grupo']);
  const cabecalho = page.getByRole('button', { name: 'Ver os membros do grupo Financeiro' });
  await expect(cabecalho).toContainText('Financeiro');
  await expect(cabecalho).toContainText('3 pessoas · ver os membros');
  // O Voltar da conversa nova vai para a lista (não para o Novo grupo), e o grupo está nela.
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(nomesDaLista(page)).toHaveText(['Financeiro']);
  const grupos = (await a.api.conversas()).filter((c) => c.tipo === 'grupo');
  expect(grupos.map((c) => [c.nome, c.pessoas, c.cuida])).toEqual([['Financeiro', 3, true]]);
});

test('the create button waits for a name and one person', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await irParaONovoGrupo(page);
  await expect(pessoa(page, 'Ana Souza')).toBeVisible();

  await expect(criar(page)).toBeDisabled();
  await expect(criar(page)).toHaveText('Criar grupo');
  await nomeDoGrupo(page).fill('Financeiro');
  await expect(criar(page)).toBeDisabled();
  await expect(criar(page)).toHaveText('Criar grupo');
  await pessoa(page, 'Ana Souza').check();
  await expect(criar(page)).toBeEnabled();
  await expect(criar(page)).toHaveText('Criar grupo com 2 pessoas');
  // Um nome só de espaços não é nome.
  await nomeDoGrupo(page).fill('   ');
  await expect(criar(page)).toBeDisabled();
  await nomeDoGrupo(page).fill('');
  await expect(criar(page)).toBeDisabled();
  await expect(criar(page)).toHaveText('Criar grupo com 2 pessoas');
  await nomeDoGrupo(page).fill('Financeiro');
  await pessoa(page, 'Ana Souza').uncheck();
  await expect(criar(page)).toBeDisabled();
  await expect(criar(page)).toHaveText('Criar grupo');
});

test('the group name stops at 60 characters', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA]);
  const [a, ana] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await irParaONovoGrupo(page);
  // Digitando 70, ficam 60.
  await nomeDoGrupo(page).pressSequentially('Financeiro'.repeat(7));
  await expect(nomeDoGrupo(page)).toHaveValue('Financeiro'.repeat(6));
  // Um emoji conta 1 (no UTF-16 são 2), como no servidor.
  await nomeDoGrupo(page).fill(`${'a'.repeat(59)}😀😀`);
  await expect(nomeDoGrupo(page)).toHaveValue(`${'a'.repeat(59)}😀`);

  // O grupo sai com o nome de 60.
  const nome = 'ComercialDaACME'.repeat(4);
  await nomeDoGrupo(page).fill(`${nome}xyz`);
  await pessoa(page, 'Ana Souza').check();
  await criar(page).click();
  await expect(page.getByRole('log', { name: `Mensagens do grupo ${nome}` })).toBeVisible();
  expect((await ana.api.conversas()).map((c) => c.nome)).toEqual([nome]);
});

test('the choice stops at 199 people and says the group is full', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  // 250 colegas inventados (o servidor de teste nem os tem): o GET /api/v1/pessoas vem daqui.
  const inventados = Array.from({ length: 250 }, (_, i) => ({
    id: 100_000 + i,
    ramal: String(5000 + i),
    nome: `Pessoa ${String(i + 1).padStart(3, '0')}`,
    saiu: false,
  }));
  await page.route(`${baseDoChat()}/api/v1/pessoas`, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ pessoas: inventados }) }),
  );
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await irParaONovoGrupo(page);
  const caixas = page.getByRole('checkbox');
  await expect(caixas).toHaveCount(250);

  // 198 de uma vez (o clique de cada caixa, na página), e a 199ª pelo Playwright.
  await caixas.evaluateAll((todas) => todas.slice(0, 198).forEach((c) => (c as HTMLInputElement).click()));
  await expect(page.getByText('Pessoas · 198 escolhidas', { exact: true })).toBeVisible();
  await expect(page.getByText(GRUPO_CHEIO, { exact: true })).toHaveCount(0);
  await expect(caixas.nth(249)).toBeEnabled();
  await caixas.nth(198).check();
  await expect(page.getByText('Pessoas · 199 escolhidas', { exact: true })).toBeVisible();
  await expect(page.getByText(GRUPO_CHEIO, { exact: true })).toBeVisible();
  // As outras ficam desligadas; as escolhidas, não (dá para tirar uma).
  await expect(caixas.nth(199)).toBeDisabled();
  await expect(caixas.nth(249)).toBeDisabled();
  await expect(caixas.nth(0)).toBeEnabled();
  await nomeDoGrupo(page).fill('Todos');
  await expect(criar(page)).toHaveText('Criar grupo com 200 pessoas');

  // Uma a menos: as outras voltam, e o aviso sai.
  await caixas.nth(0).uncheck();
  await expect(page.getByText(GRUPO_CHEIO, { exact: true })).toHaveCount(0);
  await expect(caixas.nth(249)).toBeEnabled();

  // Um 409 grupoCheio do servidor mostra o mesmo texto, e a tela fica como estava.
  await page.route(CONVERSAS, (rota) =>
    rota.request().method() === 'POST'
      ? rota.fulfill({ status: 409, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ erro: 'grupoCheio' }) })
      : rota.continue(),
  );
  await criar(page).click();
  await expect(page.getByText(GRUPO_CHEIO, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Novo grupo', level: 1 })).toBeVisible();
  await expect(nomeDoGrupo(page)).toHaveValue('Todos');
  await expect(page.getByText('Pessoas · 198 escolhidas', { exact: true })).toBeVisible();
});

test('Criar grupo without the network says so and keeps the screen as it was', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a] = pessoas;
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await irParaONovoGrupo(page);
  await nomeDoGrupo(page).fill('Financeiro');
  await pessoa(page, 'Ana Souza').check();
  // O criar não chega ao servidor (a lista e os eventos passam).
  await page.route(CONVERSAS, (rota) => (rota.request().method() === 'POST' ? rota.abort() : rota.continue()));
  await criar(page).click();

  await expect(page.getByRole('status').filter({ hasText: 'Sem conexão com o chat. Tente de novo.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Novo grupo', level: 1 })).toBeVisible();
  await expect(nomeDoGrupo(page)).toHaveValue('Financeiro');
  await expect(pessoa(page, 'Ana Souza')).toBeChecked();
  await expect(pessoa(page, 'João Pereira')).not.toBeChecked();
  await expect(criar(page)).toBeEnabled();
  expect(await a.api.conversas()).toEqual([]);

  // Com a rede de volta, o Criar grupo cria.
  await page.unroute(CONVERSAS);
  await criar(page).click();
  await expect(avisosDe(page, 'Financeiro')).toHaveText(['Você criou o grupo', 'Você pôs Ana Souza no grupo']);
  expect((await a.api.conversas()).map((c) => c.nome)).toEqual(['Financeiro']);
});

test('Membros shows who takes care, with Tirar and Pôr pessoas only for the caretaker and Sair for all', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  await a.api.criarGrupo('Comercial', [ana.pessoa.id, joao.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirOsMembros(page, 'Comercial');

  // Eu cuido: o texto, o Tirar ao lado de cada outra pessoa (nunca ao meu), o Pôr pessoas e o Sair.
  await expect(page.locator('.bar-eyebrow')).toHaveText('Comercial');
  await expect(page.getByText(VOCE_CUIDA, { exact: true })).toBeVisible();
  await expect(page.getByText('3 pessoas', { exact: true })).toBeVisible();
  await expect(nomesDosMembros(page)).toHaveText(['Recepção (você)', 'Ana Souza', 'João Pereira']);
  await expect(linhasDosMembros(page)).toHaveText(['Ramal 2001 · criou o grupo', 'Ramal 2003', 'Ramal 3002']);
  await expect(membros(page).nth(0).getByRole('button')).toHaveCount(0);
  await expect(membros(page).nth(1).getByRole('button', { name: 'Tirar Ana Souza do grupo' })).toHaveText('Tirar');
  await expect(membros(page).nth(2).getByRole('button', { name: 'Tirar João Pereira do grupo' })).toHaveText('Tirar');
  await expect(page.getByRole('button', { name: 'Pôr pessoas no grupo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair do grupo' })).toBeVisible();

  // A Ana, numa segunda página, não cuida: só o Sair do grupo.
  const daAna = await page.context().newPage();
  await abrirNoChat(daAna, { chave: ana.chave, ...ANA });
  await abrirOsMembros(daAna, 'Comercial');
  await expect(nomesDosMembros(daAna)).toHaveText(['Recepção', 'Ana Souza (você)', 'João Pereira']);
  await expect(linhasDosMembros(daAna)).toHaveText(['Ramal 2001 · criou o grupo', 'Ramal 2003', 'Ramal 3002']);
  await expect(daAna.getByRole('button', { name: /^Tirar/ })).toHaveCount(0);
  await expect(daAna.getByRole('button', { name: 'Pôr pessoas no grupo' })).toHaveCount(0);
  await expect(daAna.getByText(VOCE_CUIDA, { exact: true })).toHaveCount(0);
  await expect(daAna.getByRole('button', { name: 'Sair do grupo' })).toBeVisible();
  await daAna.close();

  // O Voltar volta para a conversa.
  await page.getByRole('button', { name: 'Voltar para a conversa' }).click();
  await expect(page.getByRole('log', { name: 'Mensagens do grupo Comercial' })).toBeVisible();
});

test('Tirar asks first and takes the person out, with the notice in the conversation', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const grupo = await a.api.criarGrupo('Comercial', [ana.pessoa.id, joao.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirOsMembros(page, 'Comercial');
  await esperarOsEventos(page);

  const tirarAna = page.getByRole('button', { name: 'Tirar Ana Souza do grupo' });
  await tirarAna.click();
  const dialogo = page.getByRole('dialog', { name: 'Tirar Ana Souza do grupo?' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toHaveAccessibleDescription('Ana Souza deixa de ver as mensagens novas do grupo.');
  await expect(dialogo.getByRole('button')).toHaveText(['Cancelar', 'Tirar']);
  // O Cancelar não tira ninguém, e o foco volta ao Tirar.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(tirarAna).toBeFocused();
  await expect(nomesDosMembros(page)).toHaveText(['Recepção (você)', 'Ana Souza', 'João Pereira']);

  await tirarAna.click();
  await dialogo.getByRole('button', { name: 'Tirar' }).click();
  await expect(nomesDosMembros(page)).toHaveText(['Recepção (você)', 'João Pereira']);
  await expect(page.getByText('2 pessoas', { exact: true })).toBeVisible();
  expect((await a.api.membros(grupo)).map((m) => m.pessoa.nome)).toEqual(['Recepção', 'João Pereira']);

  // A conversa mostra o aviso, e o cabeçalho, as 2 pessoas.
  await page.getByRole('button', { name: 'Voltar para a conversa' }).click();
  await expect(avisosDe(page, 'Comercial').last()).toHaveText('Você tirou Ana Souza do grupo');
  await expect(page.getByRole('button', { name: 'Ver os membros do grupo Comercial' })).toContainText('2 pessoas · ver os membros');
});

test('Sair do grupo asks first and leaves, back to the list without the group', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const grupo = await ana.api.criarGrupo('Comercial', [a.pessoa.id, joao.pessoa.id]);
  const dupla = await joao.api.criarDupla(a.pessoa.id);
  await joao.api.enviarTexto(dupla, 'Bom dia!');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(nomesDaLista(page)).toHaveText(['João Pereira', 'Comercial']);
  await abrirOsMembros(page, 'Comercial');

  const sair = page.getByRole('button', { name: 'Sair do grupo' });
  await sair.click();
  const dialogo = page.getByRole('dialog', { name: 'Sair do grupo?' });
  await expect(dialogo).toHaveAccessibleDescription('Para voltar, quem cuida do grupo precisa pôr você de novo.');
  await expect(dialogo.getByRole('button')).toHaveText(['Cancelar', 'Sair do grupo']);
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(sair).toBeFocused();
  await expect(nomesDosMembros(page)).toHaveText(['Ana Souza', 'João Pereira', 'Recepção (você)']);

  await sair.click();
  await dialogo.getByRole('button', { name: 'Sair do grupo' }).click();
  // De volta à lista, sem o grupo.
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(nomesDaLista(page)).toHaveText(['João Pereira']);
  expect((await ana.api.membros(grupo)).map((m) => m.pessoa.nome)).toEqual(['Ana Souza', 'João Pereira']);
  await expect(page.getByRole('heading', { name: 'Membros do grupo' })).toHaveCount(0);
});

test('Pôr pessoas no grupo lists only who is out of the group and puts the chosen ones', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO, BEATRIZ, CARLOS]);
  const [a, ana, joao] = pessoas;
  const grupo = await a.api.criarGrupo('Comercial', [ana.pessoa.id, joao.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirOsMembros(page, 'Comercial');
  await page.getByRole('button', { name: 'Pôr pessoas no grupo' }).click();
  await expect(page.getByRole('heading', { name: 'Pôr pessoas no grupo', level: 1 })).toBeVisible();
  await expect(page.locator('.bar-eyebrow')).toHaveText('Comercial');

  // Só quem está fora do grupo: nem eu, nem a Ana, nem o João.
  await expect(page.locator('.escolher .chat-pessoa-nome')).toHaveText(['Beatriz Ramos', 'Carlos Lima']);
  const por = page.getByRole('button', { name: /^Pôr .*no grupo$/ });
  await expect(por).toBeDisabled();
  await expect(por).toHaveText('Pôr pessoas no grupo');
  await pessoa(page, 'Beatriz Ramos').check();
  await pessoa(page, 'Carlos Lima').check();
  await expect(page.getByText('Pessoas · 2 escolhidas', { exact: true })).toBeVisible();
  await expect(por).toHaveText('Pôr 2 pessoas no grupo');
  await pessoa(page, 'Beatriz Ramos').uncheck();
  await expect(page.getByText('Pessoas · 1 escolhida', { exact: true })).toBeVisible();
  await expect(por).toHaveText('Pôr 1 pessoa no grupo');
  await por.click();

  // De volta aos membros, com o Carlos.
  await expect(page.getByRole('heading', { name: 'Membros do grupo', level: 1 })).toBeVisible();
  await expect(nomesDosMembros(page)).toHaveText(['Recepção (você)', 'Ana Souza', 'Carlos Lima', 'João Pereira']);
  expect((await a.api.membros(grupo)).map((m) => m.pessoa.nome)).toEqual(['Recepção', 'Ana Souza', 'Carlos Lima', 'João Pereira']);
  await page.getByRole('button', { name: 'Voltar para a conversa' }).click();
  await expect(avisosDe(page, 'Comercial').last()).toHaveText('Você pôs Carlos Lima no grupo');
});

test('the conversa and conversaSaiu events change the list live', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const dupla = await joao.api.criarDupla(a.pessoa.id);
  await joao.api.enviarTexto(dupla, 'Bom dia!');
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await expect(nomesDaLista(page)).toHaveText(['João Pereira']);
  await esperarOsEventos(page);
  await page.evaluate(() => ((window as unknown as { __semRecarregar: boolean }).__semRecarregar = true));

  // A Ana cria um grupo com a Recepção pela API: ele aparece na lista (o evento conversa).
  const grupo = await ana.api.criarGrupo('Comercial', [a.pessoa.id]);
  await expect(nomesDaLista(page)).toHaveText(['Comercial', 'João Pereira']);
  // A Ana tira a Recepção: o grupo sai (o evento conversaSaiu).
  await ana.api.tirarDoGrupo(grupo, a.pessoa.id);
  await expect(nomesDaLista(page)).toHaveText(['João Pereira']);

  // Com o grupo aberto, a tela volta para a lista.
  await ana.api.porNoGrupo(grupo, [a.pessoa.id]);
  await expect(nomesDaLista(page)).toHaveText(['Comercial', 'João Pereira']);
  await abrirAConversa(page, 'Comercial');
  await expect(avisosDe(page, 'Comercial')).toHaveText(['Ana Souza pôs você no grupo']);
  await ana.api.tirarDoGrupo(grupo, a.pessoa.id);
  await expect(page.getByRole('log')).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(nomesDaLista(page)).toHaveText(['João Pereira']);
  expect(await page.evaluate(() => (window as unknown as { __semRecarregar?: boolean }).__semRecarregar)).toBe(true);
});

test('a group that leaves the list takes its Membros back to the list, and its unsent message with it', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  const grupo = await ana.api.criarGrupo('Comercial', [a.pessoa.id, joao.pessoa.id]);
  // O envio da Recepção no grupo fica parado aqui (nem chega ao servidor) até o teste soltar.
  let preso: Route | null = null;
  await page.route(`${CONVERSAS}/${grupo}/mensagens`, (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue();
    preso = rota;
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirAConversa(page, 'Comercial');
  await esperarOsEventos(page);
  const campo = page.getByRole('textbox', { name: 'Mensagem para o grupo Comercial' });
  await campo.fill('Confirmei com o cliente agora.');
  await campo.press('Enter');
  await expect(page.getByText('Enviando…', { exact: true })).toBeVisible();
  await expect.poll(() => preso !== null).toBe(true);

  // Nos membros, a Ana tira a Recepção: a tela volta para a lista, sem o grupo.
  await page.getByRole('button', { name: 'Ver os membros do grupo Comercial' }).click();
  await expect(membros(page)).toHaveCount(3);
  await ana.api.tirarDoGrupo(grupo, a.pessoa.id);
  await expect(page.getByRole('heading', { name: 'Membros do grupo' })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();

  // O envio a caminho falha agora; a Ana põe a Recepção de volta, e o grupo volta sem a mensagem que não foi.
  await preso!.abort();
  await umInstante(page);
  await ana.api.porNoGrupo(grupo, [a.pessoa.id]);
  await abrirAConversa(page, 'Comercial');
  await expect(avisosDe(page, 'Comercial')).toHaveText(['Ana Souza pôs você no grupo']);
  await umInstante(page);
  await expect(page.locator('.balao')).toHaveCount(0);
  await expect(page.getByText('Não enviada', { exact: true })).toHaveCount(0);
});

test('Membros stays current: when the caretaker leaves, the one who takes care now sees Tirar and Pôr pessoas', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana, joao] = pessoas;
  // A Ana cria e cuida. A Recepção e o João entraram juntos, e a Recepção tem o id menor: ela passa a cuidar.
  const grupo = await ana.api.criarGrupo('Comercial', [a.pessoa.id, joao.pessoa.id]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirOsMembros(page, 'Comercial');
  await esperarOsEventos(page);
  await expect(nomesDosMembros(page)).toHaveText(['Ana Souza', 'João Pereira', 'Recepção (você)']);
  await expect(linhasDosMembros(page)).toHaveText(['Ramal 2003 · criou o grupo', 'Ramal 3002', 'Ramal 2001']);
  await expect(page.getByRole('button', { name: /^Tirar/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pôr pessoas no grupo' })).toHaveCount(0);
  await expect(page.getByText(VOCE_CUIDA, { exact: true })).toHaveCount(0);

  // A Ana sai: sem fechar a tela, a Recepção vê que cuida.
  await ana.api.tirarDoGrupo(grupo, ana.pessoa.id);
  await expect(nomesDosMembros(page)).toHaveText(['Recepção (você)', 'João Pereira']);
  await expect(linhasDosMembros(page)).toHaveText(['Ramal 2001 · cuida do grupo', 'Ramal 3002']);
  await expect(page.getByText(VOCE_CUIDA, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tirar João Pereira do grupo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pôr pessoas no grupo' })).toBeVisible();
  await expect(page.getByText('2 pessoas', { exact: true })).toBeVisible();
});

test('a 60-character group name and an 80-character person name never scroll the members sideways', async ({ page }) => {
  const comprido = { ramal: '2020', nome: 'Pedro'.repeat(16) };
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, comprido, CARLOS]);
  const [a, ana, longo] = pessoas;
  const nome = 'ComercialDaACME'.repeat(4);
  expect([...nome]).toHaveLength(60);
  expect([...longo.pessoa.nome]).toHaveLength(80);
  await a.api.criarGrupo(nome, [ana.pessoa.id, longo.pessoa.id]);

  for (const largura of [400, 300]) {
    await page.setViewportSize({ width: largura, height: 720 });
    await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
    await abrirOsMembros(page, nome);
    await expect(membros(page)).toHaveCount(3);
    for (const tela of ['os membros', 'o pôr pessoas']) {
      const medidas = await page.evaluate(() => ({
        janela: document.documentElement.scrollWidth,
        direita: Math.max(...[...document.querySelectorAll('.win *')].map((e) => e.getBoundingClientRect().right)),
      }));
      expect(medidas.janela, `${tela}, ${largura} px`).toBeLessThanOrEqual(largura);
      expect(medidas.direita, `${tela}, ${largura} px`).toBeLessThanOrEqual(largura + 0.5);
      if (tela === 'os membros') {
        await page.getByRole('button', { name: 'Pôr pessoas no grupo' }).click();
        await expect(page.locator('.escolher .chat-pessoa-nome')).toHaveText(['Carlos Lima']);
      }
    }
  }
});

test('the members list scrolls by the keyboard also for who does not take care', async ({ page }) => {
  // Na janela mínima, seis membros passam do cartão: a lista rola por dentro, e quem não cuida não tem nenhum botão nela.
  await page.setViewportSize({ width: 300, height: 440 });
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, { ramal: '3005', nome: 'Jordana Alves' }]);
  const [a, ana, ...outras] = pessoas;
  await ana.api.criarGrupo('Comercial', [a.pessoa.id, ...outras.map((p) => p.pessoa.id)]);
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await abrirOsMembros(page, 'Comercial');
  await expect(membros(page)).toHaveCount(6);
  const lista = page.locator('.membros-lista');
  expect(await lista.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await expect(lista.getByRole('button')).toHaveCount(0);
  await semViolacoesSerias(page);
  await lista.focus();
  await page.keyboard.press('End');
  await expect.poll(() => lista.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`o grupo (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('Novo grupo has no serious accessibility violations', async ({ page }) => {
      // As pessoas do quadro NovoGrupo, com a Beatriz e o Carlos escolhidos.
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, { ramal: '3005', nome: 'Jordana Alves' }]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await irParaONovoGrupo(page);
      await nomeDoGrupo(page).fill('Financeiro');
      await pessoa(page, 'Beatriz Ramos').check();
      await pessoa(page, 'Carlos Lima').check();
      await expect(criar(page)).toHaveText('Criar grupo com 3 pessoas');
      await semViolacoesSerias(page);
      await capturar(page, 'chat-novo-grupo', nomeDoTema(tema));
    });

    test('Membros has no serious accessibility violations, with the confirmation and Pôr pessoas', async ({ page }) => {
      // O grupo do quadro Membros: eu cuido, com 4 pessoas; a Jordana fica de fora.
      const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, BEATRIZ, CARLOS, JOAO, { ramal: '3005', nome: 'Jordana Alves' }]);
      const [a, ...outras] = pessoas;
      await a.api.criarGrupo('Comercial', outras.slice(0, 4).map((p) => p.pessoa.id));
      await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
      await abrirOsMembros(page, 'Comercial');
      await expect(membros(page)).toHaveCount(5);
      await semViolacoesSerias(page);
      await capturar(page, 'chat-membros', nomeDoTema(tema));

      await page.getByRole('button', { name: 'Tirar Ana Souza do grupo' }).click();
      await expect(page.getByRole('dialog', { name: 'Tirar Ana Souza do grupo?' })).toBeVisible();
      await semViolacoesSerias(page);
      await capturar(page, 'chat-membros-tirar', nomeDoTema(tema));
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

      await page.getByRole('button', { name: 'Pôr pessoas no grupo' }).click();
      await pessoa(page, 'Jordana Alves').check();
      await expect(page.getByRole('button', { name: 'Pôr 1 pessoa no grupo' })).toBeEnabled();
      await semViolacoesSerias(page);
      await capturar(page, 'chat-por-pessoas', nomeDoTema(tema));
    });
  });
}
