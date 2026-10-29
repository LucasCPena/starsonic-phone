// A lista da empresa na tela Contatos e a parte "Contatos" das Configurações (rc.4, spec 4.1, 5.1 e 5.5), contra a
// ponte falsa: o teste manda o estado `empresa` e a mensagem `contatosEmpresa` pela mesma ponte de mentira e confere os
// textos exatos e os comandos que saem (importContacts, exportContacts, setCompanyList, refreshCompanyList e o dial).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, empurrar, esperarComando, mudarEstado, segurarCpp, semViolacoesSerias, soltarCpp, verTextos, vezes } from './helpers';

// Só de teste: nenhum link de cliente de verdade.
const LINK = 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456';
const CAMINHO = '\\\\servidor\\contatos\\empresa.xlsx';

interface ContatoDaEmpresa {
  nome: string;
  numero: string;
  observacao: string;
}

/** A lista da empresa, na ordem da planilha (a tela ordena e junta com os meus). */
const DA_EMPRESA: ContatoDaEmpresa[] = [
  { nome: 'Recepção', numero: '3001', observacao: 'Térreo' },
  { nome: 'Diretoria', numero: '3000', observacao: '' },
  { nome: 'Élcio Matos', numero: '3005', observacao: 'Compras' },
  { nome: 'Beatriz Ramos', numero: '3004', observacao: 'Contabilidade' },
  { nome: 'Almoxarifado', numero: '(11) 3003-1000', observacao: 'Galpão 2' },
];

/** Os meus contatos do cenário `contatos` (o `contatos` do estado), em ordem alfabética. */
const MEUS = ['Ana Souza', 'Atendimento Starsonic', 'Carlos Lima', 'Financeiro'];
const DA_EMPRESA_EM_ORDEM = ['Almoxarifado', 'Beatriz Ramos', 'Diretoria', 'Élcio Matos', 'Recepção'];
/** Os dois juntos, em ordem alfabética sem acento e sem caixa (o Élcio no E). */
const TODOS = ['Almoxarifado', 'Ana Souza', 'Atendimento Starsonic', 'Beatriz Ramos', 'Carlos Lima', 'Diretoria', 'Élcio Matos', 'Financeiro', 'Recepção'];

/** O `empresa` do estado: a planilha lida agora, com a lista de `quantos` contatos. */
function empresa(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { link: LINK, situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: DA_EMPRESA.length, vez: 1, ...extra };
}

/** O C++ leu a planilha da empresa: o estado com o link e a `vez`, e a lista na contatosEmpresa (como no `ready`). */
async function comListaDaEmpresa(page: Page, contatos: ContatoDaEmpresa[] = DA_EMPRESA, vez = 1): Promise<void> {
  await mudarEstado(page, (s) => ({ ...s, empresa: empresa({ quantos: contatos.length, vez }) }));
  await empurrar(page, { v: 1, type: 'contatosEmpresa', vez, contatos });
}

/** A linha de um contato, pelo nome (o título da linha). */
function linha(page: Page, nome: string): Locator {
  return page.locator('li.row').filter({ has: page.locator('.row-title').getByText(nome, { exact: true }) });
}

/** Os nomes da lista, na ordem da tela. */
function nomes(page: Page): Promise<string[]> {
  return page.locator('li.row .row-title').allTextContents();
}

function filtro(page: Page, nome: 'Todos' | 'Meus' | 'Empresa'): Locator {
  return page.getByRole('button', { name: nome, exact: true });
}

function etiqueta(page: Page, nome: string): Locator {
  return linha(page, nome).getByText('Empresa', { exact: true });
}

test.describe('Contatos com a lista da empresa', () => {
  test('the more button offers import and export', async ({ page }) => {
    await abrir(page, 'contatos');
    const mais = page.getByRole('button', { name: 'Mais opções', exact: true });
    await expect(mais).toHaveAttribute('title', 'Mais opções');
    await expect(mais).toHaveAttribute('aria-haspopup', 'menu');
    await expect(mais).toHaveAttribute('aria-expanded', 'false');
    // Ao lado do "+", na mesma linha da busca.
    const novo = await page.getByRole('button', { name: 'Novo contato' }).boundingBox();
    const caixa = await mais.boundingBox();
    expect(caixa!.x, 'o "⋯" não está ao lado do "+"').toBeGreaterThanOrEqual(novo!.x + novo!.width - 0.5);
    expect(caixa!.x - (novo!.x + novo!.width), 'o "⋯" longe do "+"').toBeLessThanOrEqual(16);
    expect(Math.abs(caixa!.y + caixa!.height / 2 - (novo!.y + novo!.height / 2))).toBeLessThanOrEqual(1);

    await mais.click();
    const menu = page.getByRole('menu', { name: 'Mais opções' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Importar planilha…', 'Exportar planilha…']);
    await expect(mais).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem', { name: 'Importar planilha…' })).toBeFocused();
    await semViolacoesSerias(page);
    await menu.getByRole('menuitem', { name: 'Importar planilha…' }).click();
    await esperarComando(page, { cmd: 'importContacts' });
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Só pelo teclado: o Enter abre (o foco no primeiro), a seta desce, o Enter escolhe e o foco volta ao "⋯".
    await mais.focus();
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem', { name: 'Importar planilha…' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Exportar planilha…' })).toBeFocused();
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'exportContacts' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(mais).toBeFocused();
    // O Esc fecha sem mandar nada (o foco chega ao primeiro item depois de o menu abrir: só então o Esc o fecha).
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem', { name: 'Importar planilha…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(mais).toBeFocused();
    expect(await vezes(page, { cmd: 'importContacts' })).toBe(1);
    expect(await vezes(page, { cmd: 'exportContacts' })).toBe(1);
  });

  test('company contacts show the Empresa tag and have no menu', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    await expect.poll(() => nomes(page)).toEqual(TODOS);
    await expect(page.locator('h2.group')).toHaveText(['A', 'B', 'C', 'D', 'E', 'F', 'R']);
    for (const c of DA_EMPRESA) {
      await expect(etiqueta(page, c.nome), c.nome).toBeVisible();
      await expect(linha(page, c.nome).getByRole('button', { name: `Mais opções para ${c.nome}` }), c.nome).toHaveCount(0);
      await expect(linha(page, c.nome).getByRole('button', { name: `Ligar para ${c.nome}`, exact: true }), c.nome).toBeVisible();
    }
    for (const nome of MEUS) {
      await expect(etiqueta(page, nome), nome).toHaveCount(0);
      await expect(linha(page, nome).getByRole('button', { name: `Mais opções para ${nome}`, exact: true }), nome).toBeVisible();
    }
    // A linha de baixo é a dos meus: o ramal ou o número e a observação; sem a observação, só o número.
    await expect(linha(page, 'Recepção').locator('.row-sub')).toHaveText('Ramal 3001 · Térreo');
    await expect(linha(page, 'Diretoria').locator('.row-sub')).toHaveText('Ramal 3000');
    await expect(linha(page, 'Almoxarifado').locator('.row-sub')).toHaveText('(11) 3003-1000 · Galpão 2');
    await expect(linha(page, 'Recepção').locator('.avatar')).toHaveText('RE');
    // A etiqueta fica na linha do nome, logo depois dele.
    const nome = (await linha(page, 'Recepção').locator('.row-title').boundingBox())!;
    const tag = (await etiqueta(page, 'Recepção').boundingBox())!;
    expect(tag.x, 'a etiqueta antes do fim do nome').toBeGreaterThanOrEqual(nome.x + nome.width - 0.5);
    expect(tag.x - (nome.x + nome.width), 'a etiqueta longe do nome').toBeLessThanOrEqual(12);
    expect(Math.abs(tag.y + tag.height / 2 - (nome.y + nome.height / 2)), 'a etiqueta fora da linha do nome').toBeLessThanOrEqual(3);
    await semViolacoesSerias(page);
  });

  test('the menu of my contact opens over the company row below it', async ({ page }) => {
    // O menu de um contato meu abre por cima da linha da empresa de baixo.
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    await expect.poll(() => nomes(page)).toEqual(TODOS);
    await page.getByRole('button', { name: 'Mais opções para Atendimento Starsonic', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Opções de Atendimento Starsonic' });
    await expect(menu.getByRole('menuitem', { name: 'Editar' })).toBeFocused();
    const m = (await menu.boundingBox())!;
    const embaixo = (await linha(page, 'Beatriz Ramos').boundingBox())!;
    expect(m.y + m.height, 'o menu não chega à linha da empresa de baixo').toBeGreaterThan(embaixo.y + 10);
    const porCima = await page.evaluate((b) => {
      const pontos: boolean[] = [];
      for (const fy of [0.2, 0.5, 0.8]) {
        for (const fx of [0.2, 0.5, 0.8]) pontos.push(document.elementFromPoint(b.x + b.width * fx, b.y + b.height * fy)?.closest('[role="menu"]') != null);
      }
      return pontos;
    }, m);
    expect(porCima, 'a linha da empresa cobre o menu').toEqual(Array(9).fill(true));
    await menu.getByRole('menuitem', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar contato' })).toBeVisible();
  });

  test('the filters show only when a company list is set, and filter', async ({ page }) => {
    await abrir(page, 'contatos');
    for (const nome of ['Todos', 'Meus', 'Empresa'] as const) await expect(filtro(page, nome), nome).toHaveCount(0);
    await comListaDaEmpresa(page);
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expect(filtro(page, 'Todos')).toHaveClass('pill pill-on');
    for (const nome of ['Meus', 'Empresa'] as const) {
      await expect(filtro(page, nome), nome).toHaveAttribute('aria-pressed', 'false');
      await expect(filtro(page, nome), nome).toHaveClass('pill');
    }
    // Em cima da lista: embaixo da busca e antes do primeiro grupo, na ordem Todos, Meus, Empresa.
    const busca = (await page.getByRole('searchbox', { name: 'Buscar contato' }).boundingBox())!;
    const [todos, meus, daEmpresa] = await Promise.all((['Todos', 'Meus', 'Empresa'] as const).map(async (n) => (await filtro(page, n).boundingBox())!));
    const grupo = (await page.locator('h2.group').first().boundingBox())!;
    expect(todos.y).toBeGreaterThanOrEqual(busca.y + busca.height - 0.5);
    expect(grupo.y).toBeGreaterThanOrEqual(todos.y + todos.height - 0.5);
    expect(meus.x).toBeGreaterThan(todos.x);
    expect(daEmpresa.x).toBeGreaterThan(meus.x);
    await expect.poll(() => nomes(page)).toEqual(TODOS);

    await filtro(page, 'Meus').click();
    await expect(filtro(page, 'Meus')).toHaveAttribute('aria-pressed', 'true');
    await expect(filtro(page, 'Meus')).toHaveClass('pill pill-on');
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => nomes(page)).toEqual(MEUS);
    await filtro(page, 'Empresa').click();
    await expect(filtro(page, 'Empresa')).toHaveAttribute('aria-pressed', 'true');
    await expect(filtro(page, 'Meus')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => nomes(page)).toEqual(DA_EMPRESA_EM_ORDEM);
    // Pelo teclado também (são botões).
    await filtro(page, 'Todos').focus();
    await page.keyboard.press('Enter');
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => nomes(page)).toEqual(TODOS);
    await filtro(page, 'Meus').focus();
    await page.keyboard.press('Space');
    await expect.poll(() => nomes(page)).toEqual(MEUS);

    // A planilha lida sem nenhum contato (só o cabeçalho: uma lista vazia que vale): os filtros ficam, com o de agora.
    await comListaDaEmpresa(page, [], 2);
    await expect(filtro(page, 'Todos')).toBeVisible();
    await expect(filtro(page, 'Meus')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => nomes(page)).toEqual(MEUS);
    await filtro(page, 'Todos').click();
    await expect.poll(() => nomes(page)).toEqual(MEUS);
  });

  test('each filter has its own empty list text', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    await filtro(page, 'Empresa').click();
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 2, contatos: [] });
    await verTextos(page, ['Nenhum contato da empresa.']);
    await expect.poll(() => nomes(page)).toEqual([]);
    await filtro(page, 'Meus').click();
    await expect.poll(() => nomes(page)).toEqual(MEUS);
    await mudarEstado(page, (s) => ({ ...s, contatos: [] }));
    await verTextos(page, ['Nenhum contato seu ainda.']);
    await filtro(page, 'Todos').click();
    await verTextos(page, ['Nenhum contato ainda.']);
    // Com a busca, o texto da busca, em qualquer filtro.
    await comListaDaEmpresa(page, DA_EMPRESA, 3);
    await page.getByRole('searchbox', { name: 'Buscar contato' }).fill('xyz');
    for (const nome of ['Todos', 'Meus', 'Empresa'] as const) {
      await filtro(page, nome).click();
      await verTextos(page, ['Nenhum contato encontrado.']);
    }
  });

  test('removing the company sheet with the Empresa filter on shows the whole list again', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    await filtro(page, 'Empresa').click();
    await expect.poll(() => nomes(page)).toEqual(DA_EMPRESA_EM_ORDEM);
    // O link saiu (setCompanyList ""): o estado sem o link e a lista vazia, com a `vez` nova.
    await mudarEstado(page, (s) => ({ ...s, empresa: { link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0, vez: 2 } }));
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 2, contatos: [] });
    await expect(filtro(page, 'Todos')).toHaveCount(0);
    await expect.poll(() => nomes(page)).toEqual(MEUS);
    await expect(page.getByText('Nenhum contato da empresa.')).toHaveCount(0);
    // Uma planilha de novo: volta no Todos (o padrão).
    await comListaDaEmpresa(page, DA_EMPRESA, 3);
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => nomes(page)).toEqual(TODOS);
  });

  test('a company contact that is also mine shows once in Todos, as mine, and in Empresa as the company row', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page, [
      // A Ana Souza 2003 é minha: o mesmo nome (sem caixa e sem acento) e os mesmos dígitos ficam só uma vez, a minha.
      { nome: 'ANA SOUZA', numero: '20-03', observacao: 'Vendas' },
      { nome: 'Âna Souza', numero: '(2003)', observacao: '' },
      // O mesmo nome com outro número, e o mesmo número com outro nome: são outros.
      { nome: 'Ana Souza', numero: '3002', observacao: 'Recepção 2' },
      { nome: 'Ramal da Ana', numero: '2003', observacao: '' },
    ]);
    await expect.poll(() => nomes(page)).toEqual(['Ana Souza', 'Ana Souza', 'Atendimento Starsonic', 'Carlos Lima', 'Financeiro', 'Ramal da Ana']);
    const anas = page.locator('li.row').filter({ has: page.locator('.row-title').getByText('Ana Souza', { exact: true }) });
    // A minha primeiro (com o menu), depois a da empresa com o outro número (com a etiqueta).
    await expect(anas.nth(0).locator('.row-sub')).toHaveText('Ramal 2003 · Comercial');
    await expect(anas.nth(0).getByRole('button', { name: 'Mais opções para Ana Souza', exact: true })).toBeVisible();
    await expect(anas.nth(0).getByText('Empresa', { exact: true })).toHaveCount(0);
    await expect(anas.nth(1).locator('.row-sub')).toHaveText('Ramal 3002 · Recepção 2');
    await expect(anas.nth(1).getByText('Empresa', { exact: true })).toBeVisible();
    await expect(page.getByText('ANA SOUZA', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Âna Souza', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Ramal 2003 · Vendas', { exact: true })).toHaveCount(0);
    // Nos Meus, só os meus. Na Empresa, a planilha inteira (Ruling R16), também os que são meus: com a etiqueta e sem o menu.
    await filtro(page, 'Meus').click();
    await expect.poll(() => nomes(page)).toEqual(MEUS);
    await filtro(page, 'Empresa').click();
    const planilha = ['ANA SOUZA', 'Âna Souza', 'Ana Souza', 'Ramal da Ana'];
    await expect.poll(() => nomes(page)).toEqual(planilha);
    await expect(page.locator('li.row .row-sub')).toHaveText(['20-03 · Vendas', '(2003)', 'Ramal 3002 · Recepção 2', 'Ramal 2003']);
    for (const nome of planilha) await expect(etiqueta(page, nome), nome).toBeVisible();
    await expect(page.getByRole('button', { name: /^Mais opções para/ })).toHaveCount(0);
    // De volta ao Todos: uma vez só, a minha.
    await filtro(page, 'Todos').click();
    await expect.poll(() => nomes(page)).toEqual(['Ana Souza', 'Ana Souza', 'Atendimento Starsonic', 'Carlos Lima', 'Financeiro', 'Ramal da Ana']);
    await expect(page.getByText('ANA SOUZA', { exact: true })).toHaveCount(0);
  });

  test('a new company list keeps the focus on the same contact', async ({ page }) => {
    // Os três na mesma letra (o mesmo grupo): a linha segue o contato, não a posição dele na planilha.
    const lista = [
      { nome: 'Contato 1', numero: '3101', observacao: '' },
      { nome: 'Contato 2', numero: '3102', observacao: '' },
      { nome: 'Contato 3', numero: '3103', observacao: '' },
    ];
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page, lista);
    const ligar = page.getByRole('button', { name: 'Ligar para Contato 2', exact: true });
    await ligar.focus();
    await expect(ligar).toBeFocused();
    // A planilha mudou com o foco nele: um contato novo no começo dela.
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 2, contatos: [{ nome: 'Contato 0', numero: '3100', observacao: '' }, ...lista] });
    await expect(linha(page, 'Contato 0')).toHaveCount(1);
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Ligar para Contato 2');
    // O Enter liga para ele, não para o vizinho.
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '3102', contato: true });
    expect(await vezes(page, { cmd: 'dial', numero: '3101', contato: true })).toBe(0);
  });

  test('company contacts off the screen are in the accessibility tree', async ({ page }) => {
    // O leitor de tela chega a todos: o botão de ligar de um contato da empresa fora da tela está na árvore de
    // acessibilidade do navegador (não só no DOM).
    const muitos = Array.from({ length: 300 }, (_, i) => ({ nome: `Contato ${String(i).padStart(3, '0')}`, numero: String(31_000 + i), observacao: '' }));
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page, muitos);
    await expect(page.locator('li.row-empresa')).toHaveCount(300);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const botoes = async (nome: string) =>
      (await cdp.send('Accessibility.queryAXTree', { objectId: result.objectId!, accessibleName: nome, role: 'button' })).nodes.filter((n) => !n.ignored)
        .length;
    // O primeiro está na tela; o último, bem abaixo dela.
    expect(await botoes('Ligar para Contato 000'), 'na tela').toBe(1);
    expect(await botoes('Ligar para Contato 299'), 'fora da tela').toBe(1);
  });

  test('search finds company contacts', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    const busca = page.getByRole('searchbox', { name: 'Buscar contato' });
    // Pelo nome, sem acento e sem caixa.
    await busca.fill('elcio');
    await expect.poll(() => nomes(page)).toEqual(['Élcio Matos']);
    await busca.fill('RECEP');
    await expect.poll(() => nomes(page)).toEqual(['Recepção']);
    // Pela observação.
    await busca.fill('galpao');
    await expect.poll(() => nomes(page)).toEqual(['Almoxarifado']);
    // Pelos dígitos do número.
    await busca.fill('3003 1000');
    await expect.poll(() => nomes(page)).toEqual(['Almoxarifado']);
    await busca.fill('3004');
    await expect.poll(() => nomes(page)).toEqual(['Beatriz Ramos']);
    // Nos dois juntos: os meus e os da empresa.
    await busca.fill('os');
    await expect.poll(() => nomes(page)).toEqual(['Beatriz Ramos', 'Carlos Lima', 'Élcio Matos']);
    // Com um filtro, só nele.
    await filtro(page, 'Empresa').click();
    await expect.poll(() => nomes(page)).toEqual(['Beatriz Ramos', 'Élcio Matos']);
    await filtro(page, 'Meus').click();
    await expect.poll(() => nomes(page)).toEqual(['Carlos Lima']);
    await busca.fill('recep');
    await verTextos(page, ['Nenhum contato encontrado.']);
    // O Esc limpa a busca: a lista do filtro inteira.
    await busca.press('Escape');
    await expect(busca).toHaveValue('');
    await expect.poll(() => nomes(page)).toEqual(MEUS);
  });

  test('tapping a company contact dials it as a contact', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page);
    await page.getByRole('button', { name: /^Recepção/ }).click();
    await esperarComando(page, { cmd: 'dial', numero: '3001', contato: true });
    // O número vai como está na planilha.
    await page.getByRole('button', { name: 'Ligar para Almoxarifado', exact: true }).click();
    await esperarComando(page, { cmd: 'dial', numero: '(11) 3003-1000', contato: true });
    await linha(page, 'Diretoria').locator('button.row-hit').click();
    await esperarComando(page, { cmd: 'dial', numero: '3000', contato: true });
    // Nenhum formulário nem menu abriu: a lista continua.
    await expect(page.getByRole('searchbox', { name: 'Buscar contato' })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the newest company list stays and an older one is ignored', async ({ page }) => {
    await abrir(page, 'contatos');
    await comListaDaEmpresa(page, DA_EMPRESA, 2);
    await expect.poll(() => nomes(page)).toEqual(TODOS);
    // Uma lista mais velha que chega atrasada (vez 1): fica a de agora.
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 1, contatos: [{ nome: 'Lista velha', numero: '3999', observacao: '' }] });
    // As mensagens chegam na ordem: o estado de depois mostra que a de antes já foi lida.
    await mudarEstado(page, (s) => ({ ...s, contatos: [...s.contatos, { id: 'f0e1d2c3b4a59687', nome: 'Zélia Prado', numero: '2020', observacao: '' }] }));
    await expect(linha(page, 'Zélia Prado')).toHaveCount(1);
    await expect(linha(page, 'Lista velha')).toHaveCount(0);
    await expect(etiqueta(page, 'Recepção')).toBeVisible();
    // A mesma planilha lida de novo (vez 3) e depois com só uma observação mudada (vez 4, o mesmo tamanho): a mudança aparece.
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 3, contatos: DA_EMPRESA });
    const mudada = DA_EMPRESA.map((c) => (c.nome === 'Recepção' ? { ...c, observacao: '1º andar' } : c));
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 4, contatos: mudada });
    await expect(linha(page, 'Recepção').locator('.row-sub')).toHaveText('Ramal 3001 · 1º andar');
    // Uma nova (vez 5) troca a lista inteira.
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 5, contatos: [{ nome: 'Portaria', numero: '3020', observacao: 'Bloco B' }] });
    await expect.poll(() => nomes(page)).toEqual([...MEUS, 'Portaria', 'Zélia Prado']);
    await expect(etiqueta(page, 'Portaria')).toBeVisible();
    // A vazia (vez 6) também.
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 6, contatos: [] });
    await expect.poll(() => nomes(page)).toEqual([...MEUS, 'Zélia Prado']);
  });

  test('a company list that arrives before the first state shows', async ({ page }) => {
    // A leitura acabou com a página abrindo: a contatosEmpresa chega antes do primeiro estado (e o `ready` não a repete).
    await abrir(page, 'empresa-antes-do-estado');
    await expect(etiqueta(page, 'Recepção')).toBeVisible();
    await expect(etiqueta(page, 'Almoxarifado')).toBeVisible();
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Configurações → Contatos', () => {
  const salvar = (page: Page) => page.getByRole('button', { name: 'Salvar', exact: true });
  const campo = (page: Page) => page.getByLabel('Planilha da empresa', { exact: true });

  test('the company sheet field saves the link', async ({ page }) => {
    await abrir(page, 'configuracoes');
    // A parte "Contatos", depois de "Ligações".
    expect(await page.locator('h2.eyebrow').allTextContents()).toEqual(['Contas', 'Áudio', 'Ligações', 'Contatos']);
    await verTextos(page, [
      'Planilha da empresa',
      'Salvar',
      'Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede.',
      'Atualizar agora',
    ]);
    await expect(campo(page)).toHaveAttribute('id', 'cfg-planilha');
    await expect(campo(page)).toHaveValue('');
    await expect(campo(page)).toHaveAccessibleDescription(
      'Cole o link do Google Planilhas ou do OneDrive/SharePoint, compartilhado para qualquer pessoa com o link, ou o caminho do arquivo na rede.',
    );
    // O Salvar.
    await campo(page).fill(LINK);
    await salvar(page).click();
    await esperarComando(page, { cmd: 'setCompanyList', link: LINK });
    // O Enter no campo.
    await campo(page).fill(CAMINHO);
    await campo(page).press('Enter');
    await esperarComando(page, { cmd: 'setCompanyList', link: CAMINHO });
    // Vazio: tira a lista.
    await campo(page).fill('');
    await salvar(page).click();
    await esperarComando(page, { cmd: 'setCompanyList', link: '' });
    expect(await vezes(page, { cmd: 'setCompanyList', link: LINK })).toBe(1);
    expect(await vezes(page, { cmd: 'setCompanyList', link: CAMINHO })).toBe(1);
    expect(await vezes(page, { cmd: 'setCompanyList', link: '' })).toBe(1);
    // O campo segue o link salvo que vem no estado.
    await expect(campo(page)).toHaveValue('');
    await mudarEstado(page, (s) => ({ ...s, empresa: empresa() }));
    await expect(campo(page)).toHaveValue(LINK);
  });

  test('what is typed after Salvar stays when the saved link arrives', async ({ page }) => {
    await abrir(page, 'configuracoes');
    // O C++ lento: o estado do Salvar chega com a pessoa já digitando outro link, que fica no campo.
    await segurarCpp(page);
    await campo(page).fill(CAMINHO);
    await campo(page).press('Enter');
    await esperarComando(page, { cmd: 'setCompanyList', link: CAMINHO });
    await campo(page).fill(LINK);
    await soltarCpp(page);
    await expect(page.locator('#cfg-planilha-situacao')).toHaveText('Lendo a planilha…');
    await expect(campo(page)).toHaveValue(LINK);
    await salvar(page).click();
    await esperarComando(page, { cmd: 'setCompanyList', link: LINK });
    // Sem nada digitado depois do Salvar, o campo mostra o link como o C++ gravou (sem os espaços das pontas).
    await campo(page).fill(`  ${CAMINHO}  `);
    await campo(page).press('Enter');
    await esperarComando(page, { cmd: 'setCompanyList', link: `  ${CAMINHO}  ` });
    await expect(campo(page)).toHaveValue(CAMINHO);
  });

  test('the status line shows reading, updated, error with the last list, and nothing', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-27T15:00:00-03:00'));
    await abrir(page, 'configuracoes');
    const situacao = page.locator('#cfg-planilha-situacao');
    const hoje = new Date('2026-10-27T14:32:00-03:00').getTime();
    const outroDia = new Date('2026-10-26T14:32:00-03:00').getTime();
    const com = (extra: Record<string, unknown>) => mudarEstado(page, (s) => ({ ...s, empresa: empresa({ atualizadaEm: hoje, quantos: 230, ...extra }) }));
    const linhas = () => situacao.locator('p').allTextContents();

    // Sem a planilha: nada.
    await expect(situacao).toHaveText('');
    await com({ situacao: 'lendo', atualizadaEm: 0, quantos: 0 });
    await expect.poll(linhas).toEqual(['Lendo a planilha…']);
    await com({});
    await expect.poll(linhas).toEqual(['Atualizada às 14:32 · 230 contatos']);
    await com({ atualizadaEm: outroDia });
    await expect.poll(linhas).toEqual(['Atualizada em 26/10 às 14:32 · 230 contatos']);
    await com({ atualizadaEm: new Date('2026-03-05T09:07:00-03:00').getTime() });
    await expect.poll(linhas).toEqual(['Atualizada em 05/03 às 09:07 · 230 contatos']);
    // Um contato vai no singular; nenhum, no plural.
    await com({ quantos: 1 });
    await expect.poll(linhas).toEqual(['Atualizada às 14:32 · 1 contato']);
    await com({ quantos: 0 });
    await expect.poll(linhas).toEqual(['Atualizada às 14:32 · 0 contatos']);
    // Lendo de novo, com uma lista de antes: só "Lendo".
    await com({ situacao: 'lendo' });
    await expect.poll(linhas).toEqual(['Lendo a planilha…']);

    // O erro (o texto do C++, como está) e, com uma lista de antes, a hora e o tamanho dela.
    const fechado = 'Não consegui abrir o link. Confira se a planilha está compartilhada para qualquer pessoa com o link.';
    await com({ situacao: 'erro', erro: fechado });
    await expect.poll(linhas).toEqual([fechado, 'Última lista: às 14:32 · 230 contatos']);
    await com({ situacao: 'erro', erro: 'Sem conexão com a planilha. Fica a última lista.', atualizadaEm: outroDia, quantos: 1 });
    await expect.poll(linhas).toEqual(['Sem conexão com a planilha. Fica a última lista.', 'Última lista: em 26/10 às 14:32 · 1 contato']);
    // Sem uma lista de antes: só o erro.
    await com({ situacao: 'erro', erro: 'Use um link https:// ou o caminho de um arquivo.', atualizadaEm: 0, quantos: 0 });
    await expect.poll(linhas).toEqual(['Use um link https:// ou o caminho de um arquivo.']);
    await semViolacoesSerias(page);

    // A planilha tirada: nada de novo.
    await com({ link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0 });
    await expect(situacao).toHaveText('');
    await expect.poll(linhas).toEqual([]);
  });

  test('refresh now is disabled without a link and while reading', async ({ page }) => {
    await abrir(page, 'configuracoes');
    const atualizar = page.getByRole('button', { name: 'Atualizar agora', exact: true });
    // Sem o link.
    await expect(atualizar).toBeDisabled();
    await mudarEstado(page, (s) => ({ ...s, empresa: empresa({ situacao: 'lendo', atualizadaEm: 0, quantos: 0, vez: 0 }) }));
    await expect(atualizar).toBeDisabled();
    await mudarEstado(page, (s) => ({ ...s, empresa: empresa({ situacao: 'erro', erro: 'Sem conexão com a planilha. Fica a última lista.' }) }));
    await expect(atualizar).toBeEnabled();
    await mudarEstado(page, (s) => ({ ...s, empresa: empresa() }));
    await expect(atualizar).toBeEnabled();
    await atualizar.click();
    await esperarComando(page, { cmd: 'refreshCompanyList' });
    // O C++ (de mentira) lê: "lendo" (desligado) e depois a leitura boa (ligado de novo).
    await expect(atualizar).toBeDisabled();
    await expect(atualizar).toBeEnabled();
    await expect.poll(() => vezes(page, { cmd: 'refreshCompanyList' })).toBe(1);
    // O link tirado: desligado.
    await mudarEstado(page, (s) => ({ ...s, empresa: { link: '', situacao: 'nenhuma', erro: '', atualizadaEm: 0, quantos: 0, vez: 3 } }));
    await expect(atualizar).toBeDisabled();
  });

  test('saving the company sheet reads it and its contacts show in Contatos', async ({ page }) => {
    // O caminho da fumaça do Windows: o caminho em "Planilha da empresa", o Salvar, "Atualizada às" e a aba Contatos.
    await page.clock.setFixedTime(new Date('2026-10-27T15:00:00-03:00'));
    await abrir(page, 'principal');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Configurações' }).click();
    await campo(page).fill(CAMINHO);
    await salvar(page).click();
    await esperarComando(page, { cmd: 'setCompanyList', link: CAMINHO });
    await verTextos(page, ['Lendo a planilha…']);
    // A planilha de exemplo da ponte falsa tem 7 contatos (um deles a Ana Souza, que também é minha).
    await verTextos(page, ['Atualizada às 15:00 · 7 contatos']);
    await page.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: 'Contatos' }).click();
    await expect(etiqueta(page, 'Recepção')).toBeVisible();
    await expect(filtro(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expect(linha(page, 'Ana Souza')).toHaveCount(1);
  });
});
