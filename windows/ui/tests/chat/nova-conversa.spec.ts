// A nova conversa (Task 5), contra o servidor do chat de teste: os colegas que já usam o chat, com o nome e o ramal (sem
// a própria pessoa), a busca pelo nome sem acento e sem caixa ou pelo ramal, a empresa sem mais ninguém, a conversa a
// dois que abre (a mesma, uma só por par) e a acessibilidade nos dois temas. Cada teste cria a própria empresa.
import { expect, test, type Page, type Route } from '@playwright/test';
import { capturar, semViolacoesSerias } from '../helpers';
import { abrirNoChat } from './abrir';
import { baseDoChat, empresaComPessoas } from './servidor';

// O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
test.use({ bypassCSP: true });

const EMPRESA = 'ACME Comércio Ltda';
const RECEPCAO = { ramal: '2001', nome: 'Recepção' };
const ANA = { ramal: '2003', nome: 'Ana Souza' };
const JOAO = { ramal: '3002', nome: 'João Pereira' };
const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

/** Da aba Chat para a Nova conversa, pelo "+". */
async function irParaANovaConversa(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova conversa ou novo grupo' }).click();
  await page.getByRole('menuitem', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Nova conversa', level: 1 })).toBeVisible();
}

const busca = (page: Page) => page.getByRole('searchbox', { name: 'Procurar um colega pelo nome ou pelo ramal' });
const colegas = (page: Page) => page.getByRole('list', { name: 'Colegas no chat' }).getByRole('button');
const nomes = (page: Page) => colegas(page).locator('.chat-pessoa-nome');

test('Nova conversa lists the colleagues already in the chat with the name and the ramal', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await irParaANovaConversa(page);

  // O cabeçalho: "Chat" em cima do título e a seta de volta para a lista; as abas de baixo saem.
  await expect(page.locator('.bar-eyebrow')).toHaveText('Chat');
  await expect(page.getByRole('navigation', { name: 'Seções' })).toHaveCount(0);
  await expect(busca(page)).toBeFocused();
  await expect(busca(page)).toHaveAttribute('placeholder', 'Procurar pelo nome ou pelo ramal');
  await expect(page.getByRole('button', { name: 'Novo grupo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Colegas no chat', level: 2 })).toBeVisible();

  // Os colegas na ordem do servidor (o nome sem acento e sem caixa), sem a própria pessoa.
  await expect(nomes(page)).toHaveText(['Ana Souza', 'João Pereira']);
  await expect(colegas(page).locator('.chat-pessoa-sub')).toHaveText(['Ramal 2003', 'Ramal 3002']);
  await expect(colegas(page).locator('.chat-avatar')).toHaveText(['AS', 'JP']);
  await expect(colegas(page).first()).toHaveAccessibleName('Ana Souza Ramal 2003');
  await expect(colegas(page).filter({ hasText: 'Recepção' })).toHaveCount(0);
  await expect(page.getByText('Aparecem só os colegas da sua empresa que já usam o chat.', { exact: true })).toBeVisible();

  // O Novo grupo vai ao novo grupo, e o Voltar dele volta para cá; o Voltar daqui, para a lista.
  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await expect(page.getByRole('heading', { name: 'Novo grupo', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nova conversa', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.getByRole('main', { name: 'Chat' })).toBeVisible();
  await expect(page.getByText('Nenhuma conversa ainda', { exact: true })).toBeVisible();
});

test('it finds by the name without accent or case, or by the ramal', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await irParaANovaConversa(page);
  await expect(nomes(page)).toHaveText(['Ana Souza', 'João Pereira']);

  await busca(page).fill('joao');
  await expect(nomes(page)).toHaveText(['João Pereira']);
  await busca(page).fill('  SOUZA ');
  await expect(nomes(page)).toHaveText(['Ana Souza']);
  // O ramal: 3002 tem "300"; 2003, não.
  await busca(page).fill('300');
  await expect(nomes(page)).toHaveText(['João Pereira']);
  await busca(page).fill('xyz');
  await expect(colegas(page)).toHaveCount(0);
  await expect(page.getByText('Ninguém encontrado.', { exact: true })).toBeVisible();

  // O Esc limpa a busca, e a tela continua.
  await busca(page).press('Escape');
  await expect(busca(page)).toHaveValue('');
  await expect(nomes(page)).toHaveText(['Ana Souza', 'João Pereira']);
  await expect(page.getByText('Ninguém encontrado.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nova conversa', level: 1 })).toBeVisible();
});

test('a company with nobody else shows Nenhum colega no chat ainda.', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO]);
  // Os colegas ficam parados aqui até o teste soltar: antes da resposta, a tela não diz que não há ninguém.
  let preso: Route | null = null;
  await page.route(`${baseDoChat()}/api/v1/pessoas`, (rota) => {
    preso = rota;
  });
  await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
  await page.getByRole('button', { name: 'Começar uma conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Nova conversa', level: 1 })).toBeVisible();
  await expect.poll(() => preso !== null).toBe(true);
  await expect(page.getByText('Nenhum colega no chat ainda.', { exact: true })).toHaveCount(0);

  await preso!.continue();
  await expect(page.getByText('Nenhum colega no chat ainda.', { exact: true })).toBeVisible();
  await expect(colegas(page)).toHaveCount(0);
  await expect(page.getByText('Ninguém encontrado.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Aparecem só os colegas da sua empresa que já usam o chat.', { exact: true })).toBeVisible();
});

test('a colleague opens the one conversation of the pair', async ({ page }) => {
  const { pessoas } = await empresaComPessoas(EMPRESA, [RECEPCAO, ANA, JOAO]);
  const [a, ana] = pessoas;
  // O id de cada conversa que o POST devolve.
  const devolvidas: number[] = [];
  page.on('response', async (r) => {
    if (r.request().method() === 'POST' && r.url() === `${baseDoChat()}/api/v1/conversas`) devolvidas.push((await r.json()).conversa.id);
  });
  await abrirNoChat(page, { chave: a.chave, ...RECEPCAO });
  await irParaANovaConversa(page);
  await colegas(page).filter({ hasText: 'Ana Souza' }).click();

  // A conversa a dois abre: o nome e o ramal no cabeçalho.
  await expect(page.getByRole('heading', { name: 'Ana Souza', level: 1 })).toBeVisible();
  await expect(page.getByText('Ramal 2003', { exact: true })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Mensagens com Ana Souza' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensagem para Ana Souza' })).toBeFocused();

  // De volta, a lista tem a conversa; com a Ana de novo, a mesma conversa abre.
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.locator('.chat-linha .chat-nome')).toHaveText(['Ana Souza']);
  await irParaANovaConversa(page);
  await colegas(page).filter({ hasText: 'Ana Souza' }).click();
  await expect(page.getByRole('log', { name: 'Mensagens com Ana Souza' })).toBeVisible();
  await expect.poll(() => devolvidas.length).toBe(2);
  expect(devolvidas[1]).toBe(devolvidas[0]);
  await page.getByRole('button', { name: 'Voltar para as conversas' }).click();
  await expect(page.locator('.chat-linha .chat-nome')).toHaveText(['Ana Souza']);

  // No servidor, uma conversa a dois só, a mesma para as duas pessoas.
  const duplas = async (api: typeof a.api) => (await api.conversas()).filter((c) => c.tipo === 'dupla').map((c) => c.id);
  expect(await duplas(a.api)).toEqual([devolvidas[0]]);
  expect(await duplas(ana.api)).toEqual([devolvidas[0]]);
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a nova conversa (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('Nova conversa has no serious accessibility violations', async ({ page }) => {
      // Os colegas do quadro NovaConversa.
      const { pessoas } = await empresaComPessoas(EMPRESA, [
        RECEPCAO,
        ANA,
        { ramal: '3004', nome: 'Beatriz Ramos' },
        { ramal: '2011', nome: 'Carlos Lima' },
        JOAO,
        { ramal: '3005', nome: 'Jordana Alves' },
        { ramal: '2015', nome: 'Marcos Teixeira' },
      ]);
      await abrirNoChat(page, { chave: pessoas[0].chave, ...RECEPCAO });
      await irParaANovaConversa(page);
      await expect(colegas(page)).toHaveCount(6);
      await semViolacoesSerias(page);
      await capturar(page, 'chat-nova-conversa', nomeDoTema(tema));

      await busca(page).fill('xyz');
      await expect(page.getByText('Ninguém encontrado.', { exact: true })).toBeVisible();
      await semViolacoesSerias(page);
    });
  });
}
