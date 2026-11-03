// (rc.6) Achar o contato pelo nome no Windows, contra a ponte falsa: o Transferir, o Consultar e a Nova ligação da tela
// da ligação (a lista dos meus contatos e dos da lista da empresa embaixo do campo, a busca da aba Contatos, a escolha
// pelo clique e pelas setas com o Enter, quem vai receber e o `contato` do que foi escolhido) e o Teclado (até 3
// sugestões, também da empresa, e o Enter e o Ligar com letras), com os textos exatos, os comandos que saem, o axe, os
// três tamanhos da janela e as fotos (test-results/capturas/) que vão ao responsável. O iPhone fica como estava: os
// testes dele são os ios*.spec.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PLANILHA_DA_EMPRESA } from '../src/fake-scenarios';
import { abrir, capturar, comandos, empurrar, esperarComando, mudarEstado, semViolacoesSerias, vezes } from './helpers';

/** A lista da empresa dos testes, na ordem da planilha: a de exemplo (a Ana Souza 2003 também é minha) e mais dois "jo". */
const DA_EMPRESA = [
  ...PLANILHA_DA_EMPRESA,
  { nome: 'João Pereira', numero: '3002', observacao: 'Vendas' },
  { nome: 'Jordana Alves', numero: '(11) 3003-1000', observacao: '' },
];

/** Os meus (do cenário) e os da empresa numa lista só, em ordem, com a Ana Souza uma vez (a minha). */
const TODOS: Array<[nome: string, linha: string]> = [
  ['Almoxarifado', 'Empresa · 3010'],
  ['Ana Souza', 'Contato · 2003'],
  ['Atendimento Starsonic', 'Contato · (11) 5060-3000'],
  ['Beatriz Ramos', 'Empresa · 3004'],
  ['Carlos Lima', 'Contato · 2007'],
  ['Coordenação de Logística e Transportes', 'Empresa · 3020'],
  ['Diretoria', 'Empresa · 3000'],
  ['Élcio Matos', 'Empresa · 3005'],
  ['Financeiro', 'Contato · 2010'],
  ['João Pereira', 'Empresa · 3002'],
  ['Jordana Alves', 'Empresa · (11) 3003-1000'],
  ['Recepção', 'Empresa · 3001'],
];

const NENHUM = 'Nenhum contato com esse nome';
const PLACEHOLDER = 'Digite o nome ou o número';

function botao(page: Page, nome: string): Locator {
  return page.getByRole('button', { name: nome, exact: true });
}

/** O C++ leu a planilha da empresa: o estado com o link e a `vez`, e a lista na contatosEmpresa. */
async function comListaDaEmpresa(page: Page, contatos: Array<{ nome: string; numero: string; observacao: string }> = DA_EMPRESA): Promise<void> {
  await mudarEstado(page, (s) => ({
    ...s,
    empresa: { link: '\\\\servidor\\contatos\\empresa.xlsx', situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: contatos.length, vez: 1 },
  }));
  await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 1, contatos });
}

/** O campo do painel de número (o Transferir ou a Nova ligação). */
function campo(page: Page, rotulo: 'Número para transferir' | 'Número da nova ligação'): Locator {
  return page.getByRole('combobox', { name: rotulo, exact: true });
}

/** A lista do painel. */
function lista(page: Page): Locator {
  return page.getByRole('listbox');
}

/** Os nomes da lista do painel, na ordem da tela. */
function nomes(page: Page): Locator {
  return lista(page).getByRole('option').locator('.row-title');
}

function opcao(page: Page, nome: string): Locator {
  return lista(page).getByRole('option').filter({ has: page.locator('.row-title').getByText(nome, { exact: true }) });
}

/** Quem vai receber, no Transferir e no Consultar. */
function para(page: Page): Locator {
  return page.locator('.call-panel .call-para');
}

/** O transfer e o consult que saíram, na ordem. */
async function transferencias(page: Page): Promise<unknown[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'transfer' || c.cmd === 'consult');
}

/** Os dial que saíram, na ordem. */
async function ligacoes(page: Page): Promise<unknown[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'dial');
}

/** A tela da ligação com a lista da empresa e o painel do Transferir aberto. */
async function abrirTransferir(page: Page, cenario = 'ligacao'): Promise<Locator> {
  await abrir(page, cenario);
  await comListaDaEmpresa(page);
  await botao(page, 'Transferir').click();
  const numero = campo(page, 'Número para transferir');
  await expect(numero).toBeFocused();
  // A lista da empresa chegou: a lista do painel tem todos.
  await expect(nomes(page)).toHaveCount(TODOS.length);
  return numero;
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema });

    test('the empty Transferir field lists my contacts and the company ones in order, each once', async ({ page }) => {
      const numero = await abrirTransferir(page);
      await expect(numero).toHaveAttribute('type', 'text');
      await expect(numero).toHaveAttribute('placeholder', PLACEHOLDER);
      await expect(numero).toHaveValue('');
      // O padrão da lista com a opção marcada: o campo controla a lista aberta, sem nenhuma marcada ainda.
      await expect(numero).toHaveAttribute('aria-expanded', 'true');
      await expect(numero).toHaveAttribute('aria-autocomplete', 'list');
      await expect(numero).toHaveAttribute('aria-controls', (await lista(page).getAttribute('id'))!);
      await expect(numero).not.toHaveAttribute('aria-activedescendant', /./);
      await expect(page.getByRole('listbox', { name: 'Transferir para' })).toBeVisible();
      await expect(nomes(page)).toHaveText(TODOS.map(([nome]) => nome));
      await expect(lista(page).getByRole('option').locator('.row-sub')).toHaveText(TODOS.map(([, linha]) => linha));
      await expect(opcao(page, 'Coordenação de Logística e Transportes').locator('.avatar')).toHaveText('CT');
      await expect(lista(page).getByRole('option', { selected: true })).toHaveCount(0);
      // A Ana Souza 2003 da empresa também é minha: uma vez só, a minha.
      await expect(opcao(page, 'Ana Souza')).toHaveCount(1);
      // Sem número, nada a mandar.
      await expect(botao(page, 'Consultar')).toBeDisabled();
      await expect(botao(page, 'Transferir agora')).toBeDisabled();
      await expect(para(page)).toHaveCount(0);
      await semViolacoesSerias(page);
      await capturar(page, 'transferir-lista', tema);
    });

    test('typing a name finds it without accents and case, and digits find the number', async ({ page }) => {
      const numero = await abrirTransferir(page);
      await numero.fill('joao');
      await expect(nomes(page)).toHaveText(['João Pereira']);
      await numero.fill('JOÃO');
      await expect(nomes(page)).toHaveText(['João Pereira']);
      await numero.fill('2003');
      await expect(nomes(page)).toHaveText(['Ana Souza']);
      await expect(lista(page).getByRole('option').locator('.row-sub')).toHaveText(['Contato · 2003']);
      await numero.fill('elcio');
      await expect(nomes(page)).toHaveText(['Élcio Matos']);
      await numero.fill('jo');
      await expect(nomes(page)).toHaveText(['João Pereira', 'Jordana Alves']);
      await semViolacoesSerias(page);
      await capturar(page, 'transferir-jo', tema);
    });

    test('a contact chosen by click shows who receives, and Transferir agora sends it with contato', async ({ page }) => {
      const numero = await abrirTransferir(page);
      await numero.fill('jo');
      await opcao(page, 'João Pereira').click();
      // O número dele vai para o campo (que continua com o foco), a lista sai e o painel diz quem vai receber, antes dos
      // botões.
      await expect(numero).toHaveValue('3002');
      await expect(numero).toBeFocused();
      await expect(para(page)).toHaveText('Para: João Pereira · 3002');
      await expect(para(page)).toHaveAttribute('role', 'status');
      await expect(lista(page)).toHaveCount(0);
      await expect(numero).toHaveAttribute('aria-expanded', 'false');
      const recebe = (await para(page).boundingBox())!;
      const transferir = (await botao(page, 'Transferir agora').boundingBox())!;
      expect(recebe.y + recebe.height, 'quem vai receber fica antes dos botões').toBeLessThanOrEqual(transferir.y);
      await expect(botao(page, 'Consultar')).toBeEnabled();
      await expect(botao(page, 'Transferir agora')).toBeEnabled();
      await semViolacoesSerias(page);
      await capturar(page, 'transferir-escolhido', tema);
      await botao(page, 'Transferir agora').click();
      await esperarComando(page, { cmd: 'transfer', numero: '3002', contato: true });
      expect(await transferencias(page)).toEqual([{ v: 1, cmd: 'transfer', numero: '3002', contato: true }]);
    });
  });
}

test.describe('o painel do Transferir', () => {
  test('the arrows mark a contact and Enter chooses it; without a mark Enter does nothing', async ({ page }) => {
    const numero = await abrirTransferir(page);
    await numero.fill('jo');
    const joao = opcao(page, 'João Pereira');
    const jordana = opcao(page, 'Jordana Alves');
    // Sem marca, o Enter faz o de hoje no Transferir: nada.
    await numero.press('Enter');
    await expect(para(page)).toHaveCount(0);
    // A seta para baixo marca o primeiro, depois o seguinte; no último, fica nele; a de cima volta, e no primeiro tira a
    // marca. O foco fica no campo, e ele aponta a marcada.
    await numero.press('ArrowDown');
    await expect(joao).toHaveAttribute('aria-selected', 'true');
    await expect(numero).toHaveAttribute('aria-activedescendant', (await joao.getAttribute('id'))!);
    await numero.press('ArrowDown');
    await expect(jordana).toHaveAttribute('aria-selected', 'true');
    await expect(joao).toHaveAttribute('aria-selected', 'false');
    await expect(numero).toHaveAttribute('aria-activedescendant', (await jordana.getAttribute('id'))!);
    await numero.press('ArrowDown');
    await expect(jordana).toHaveAttribute('aria-selected', 'true');
    await numero.press('ArrowUp');
    await numero.press('ArrowUp');
    await expect(lista(page).getByRole('option', { selected: true })).toHaveCount(0);
    await expect(numero).not.toHaveAttribute('aria-activedescendant', /./);
    await numero.press('ArrowDown');
    await numero.press('ArrowDown');
    await expect(numero).toBeFocused();
    await expect(numero).toHaveValue('jo');
    // O Enter na marcada escolhe ela.
    await numero.press('Enter');
    await expect(numero).toHaveValue('(11) 3003-1000');
    await expect(para(page)).toHaveText('Para: Jordana Alves · (11) 3003-1000');
    await botao(page, 'Transferir agora').click();
    await esperarComando(page, { cmd: 'transfer', numero: '(11) 3003-1000', contato: true });
  });

  test('the marked contact far down the list scrolls into view', async ({ page }) => {
    const numero = await abrirTransferir(page);
    await page.setViewportSize({ width: 300, height: 440 });
    for (let i = 0; i < TODOS.length; i++) await numero.press('ArrowDown');
    const ultima = opcao(page, 'Recepção');
    await expect(ultima).toHaveAttribute('aria-selected', 'true');
    // Inteira dentro da lista (meio pixel de folga de cada lado: o painel fica no meio, numa posição fracionária).
    const l = (await lista(page).boundingBox())!;
    const u = (await ultima.boundingBox())!;
    expect(u.y >= l.y - 1 && u.y + u.height <= l.y + l.height + 1, `a marcada fora da lista: ${JSON.stringify({ l, u })}`).toBe(true);
    await numero.press('Enter');
    await expect(para(page)).toHaveText('Para: Recepção · 3001');
  });

  test('editing the field after choosing drops the contact', async ({ page }) => {
    const numero = await abrirTransferir(page);
    await numero.fill('joao');
    await opcao(page, 'João Pereira').click();
    await expect(para(page)).toHaveText('Para: João Pereira · 3002');
    // O último dígito apagado e digitado de novo: o número do campo, sem o contato; a lista volta.
    await numero.press('End');
    await numero.press('Backspace');
    await expect(para(page)).toHaveCount(0);
    await expect(lista(page)).toBeVisible();
    await numero.press('2');
    await expect(numero).toHaveValue('3002');
    await expect(para(page)).toHaveCount(0);
    await botao(page, 'Transferir agora').click();
    await esperarComando(page, { cmd: 'transfer', numero: '3002' });
    expect(await transferencias(page)).toEqual([{ v: 1, cmd: 'transfer', numero: '3002' }]);
  });

  test('letters without a choice keep the buttons off, and nothing found says so', async ({ page }) => {
    const numero = await abrirTransferir(page);
    await numero.fill('jo');
    await expect(nomes(page)).toHaveText(['João Pereira', 'Jordana Alves']);
    // Um nome não é número.
    await expect(botao(page, 'Consultar')).toBeDisabled();
    await expect(botao(page, 'Transferir agora')).toBeDisabled();
    await numero.fill('zzz');
    await expect(lista(page)).toHaveCount(0);
    await expect(numero).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: NENHUM })).toHaveCount(1);
    await expect(botao(page, 'Consultar')).toBeDisabled();
    await expect(botao(page, 'Transferir agora')).toBeDisabled();
    await numero.press('Enter');
    await semViolacoesSerias(page);
    // O Esc continua cancelando.
    await numero.press('Escape');
    await expect(botao(page, 'Transferir agora')).toHaveCount(0);
    await expect(botao(page, 'Transferir')).toBeEnabled();
    expect(await transferencias(page)).toEqual([]);
  });

  test('only numbers work as before: the typed number goes without contato', async ({ page }) => {
    const numero = await abrirTransferir(page);
    await numero.fill('2004');
    // Nenhum contato com esse número: sem lista e sem o texto do nome.
    await expect(lista(page)).toHaveCount(0);
    await expect(page.getByText(NENHUM)).toHaveCount(0);
    await expect(botao(page, 'Transferir agora')).toBeEnabled();
    // O que não é de número sai, como antes.
    await numero.fill('(11) 3003-1000');
    await expect(numero).toHaveValue('1130031000');
    await expect(nomes(page)).toHaveText(['Jordana Alves']);
    await botao(page, 'Transferir agora').click();
    await esperarComando(page, { cmd: 'transfer', numero: '1130031000' });
    expect(await transferencias(page)).toEqual([{ v: 1, cmd: 'transfer', numero: '1130031000' }]);
  });
});

test.describe('o Consultar', () => {
  test('a contact chosen by click or by the arrows calls with contato, and an edit drops it', async ({ page }) => {
    let numero = await abrirTransferir(page);
    // Pelo clique: quem vai receber, e o Consultar com o contato.
    await numero.fill('beatriz');
    await opcao(page, 'Beatriz Ramos').click();
    await expect(para(page)).toHaveText('Para: Beatriz Ramos · 3004');
    await botao(page, 'Consultar').click();
    await esperarComando(page, { cmd: 'consult', numero: '3004', contato: true });
    await botao(page, 'Cancelar').click();
    await esperarComando(page, { cmd: 'cancelConsult' });
    // Pelas setas e o Enter: um contato meu.
    await botao(page, 'Transferir').click();
    numero = campo(page, 'Número para transferir');
    await numero.fill('carlos');
    await numero.press('ArrowDown');
    await numero.press('Enter');
    await expect(para(page)).toHaveText('Para: Carlos Lima · 2007');
    await botao(page, 'Consultar').click();
    await esperarComando(page, { cmd: 'consult', numero: '2007', contato: true });
    await botao(page, 'Cancelar').click();
    await expect.poll(() => vezes(page, { cmd: 'cancelConsult' })).toBe(2);
    // Mudado depois de escolher: o número do campo, sem o contato.
    await botao(page, 'Transferir').click();
    numero = campo(page, 'Número para transferir');
    await numero.fill('recep');
    await opcao(page, 'Recepção').click();
    await numero.press('End');
    await numero.press('Backspace');
    await numero.press('9');
    await expect(numero).toHaveValue('3009');
    await expect(para(page)).toHaveCount(0);
    await botao(page, 'Consultar').click();
    await esperarComando(page, { cmd: 'consult', numero: '3009' });
    expect(await transferencias(page)).toEqual([
      { v: 1, cmd: 'consult', numero: '3004', contato: true },
      { v: 1, cmd: 'consult', numero: '2007', contato: true },
      { v: 1, cmd: 'consult', numero: '3009' },
    ]);
  });

  test('letters without a choice keep Consultar off, also with two calls', async ({ page }) => {
    const numero = await abrirTransferir(page, 'duas-ligacoes');
    // Com duas ligações o Consultar fica travado (a consulta seria a terceira), também com um contato escolhido.
    await numero.fill('jo');
    await expect(botao(page, 'Consultar')).toBeDisabled();
    await expect(botao(page, 'Transferir agora')).toBeDisabled();
    await opcao(page, 'João Pereira').click();
    await expect(botao(page, 'Consultar')).toBeDisabled();
    await expect(botao(page, 'Transferir agora')).toBeEnabled();
    await numero.fill('zzz');
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
  });
});

test.describe('a Nova ligação', () => {
  test('the list, the search and choosing a contact dials it with contato', async ({ page }) => {
    await abrir(page, 'ligacao');
    await comListaDaEmpresa(page);
    await botao(page, 'Nova ligação').click();
    const numero = campo(page, 'Número da nova ligação');
    await expect(numero).toBeFocused();
    await expect(numero).toHaveAttribute('placeholder', PLACEHOLDER);
    await expect(nomes(page)).toHaveText(TODOS.map(([nome]) => nome));
    await expect(page.getByRole('listbox', { name: 'Nova ligação' })).toBeVisible();
    await numero.fill('joao');
    await expect(nomes(page)).toHaveText(['João Pereira']);
    // Escolher liga para ele, com a regra dos contatos (como antes, a sugestão).
    await opcao(page, 'João Pereira').click();
    await esperarComando(page, { cmd: 'dial', numero: '3002', contato: true });
    await expect(numero).toHaveCount(0);
    await expect(page.locator('.vcard').filter({ hasText: 'Ana Souza' }).getByText('Em espera', { exact: true })).toBeVisible();
  });

  test('the arrows and Enter dial the marked contact', async ({ page }) => {
    await abrir(page, 'ligacao');
    await comListaDaEmpresa(page);
    await botao(page, 'Nova ligação').click();
    const numero = campo(page, 'Número da nova ligação');
    await numero.fill('jo');
    await numero.press('ArrowDown');
    await numero.press('ArrowDown');
    await expect(opcao(page, 'Jordana Alves')).toHaveAttribute('aria-selected', 'true');
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '(11) 3003-1000', contato: true });
    await expect(numero).toHaveCount(0);
  });

  test('letters without a choice keep Ligar off; only numbers dial as before', async ({ page }) => {
    await abrir(page, 'ligacao');
    await comListaDaEmpresa(page);
    await botao(page, 'Nova ligação').click();
    const numero = campo(page, 'Número da nova ligação');
    await numero.fill('jo');
    await expect(botao(page, 'Ligar')).toBeDisabled();
    // O Rediscar não usa o campo: continua.
    await expect(botao(page, 'Rediscar 1150603000')).toBeEnabled();
    // Sem marca, o Enter faz o do Ligar: com letras, nada.
    await numero.press('Enter');
    await numero.fill('zzz');
    await expect(lista(page)).toHaveCount(0);
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
    await expect(botao(page, 'Ligar')).toBeDisabled();
    await numero.press('Enter');
    expect(await ligacoes(page)).toEqual([]);
    await semViolacoesSerias(page);
    // Só números: o Enter liga para o número digitado, sem o contato.
    await numero.fill('2004');
    await expect(botao(page, 'Ligar')).toBeEnabled();
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '2004' });
    expect(await ligacoes(page)).toEqual([{ v: 1, cmd: 'dial', numero: '2004' }]);
  });
});

test.describe('o Teclado', () => {
  for (const tema of ['light', 'dark'] as const) {
    test(`letters give up to 3 suggestions, also from the company (${tema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: tema });
      await abrir(page, 'principal');
      await comListaDaEmpresa(page);
      const numero = page.getByRole('textbox', { name: 'Número' });
      await expect(numero).toHaveAttribute('type', 'text');
      await expect(numero).toHaveAttribute('placeholder', PLACEHOLDER);
      const sugestoes = page.locator('.suggest');
      await numero.fill('a');
      await expect(sugestoes.locator('.row-title')).toHaveText(['Almoxarifado', 'Ana Souza', 'Atendimento Starsonic']);
      await expect(sugestoes.locator('.row-sub')).toHaveText(['Empresa · 3010', 'Contato · 2003', 'Contato · (11) 5060-3000']);
      await numero.fill('ana');
      await expect(sugestoes.locator('.row-title')).toHaveText(['Ana Souza', 'Jordana Alves']);
      await expect(sugestoes.locator('.row-sub')).toHaveText(['Contato · 2003', 'Empresa · (11) 3003-1000']);
      await numero.fill('jo');
      await expect(sugestoes.locator('.row-title')).toHaveText(['João Pereira', 'Jordana Alves']);
      await expect(sugestoes.locator('.row-sub')).toHaveText(['Empresa · 3002', 'Empresa · (11) 3003-1000']);
      await expect(botao(page, 'Ligar')).toBeEnabled();
      await semViolacoesSerias(page);
      await capturar(page, 'teclado-nome', tema);
    });
  }

  test('a new text shows the suggestions from the top: the first one, the one Enter dials, is in view', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('a');
    await expect(page.locator('.suggest .row-title')).toHaveText(['Almoxarifado', 'Ana Souza', 'Atendimento Starsonic']);
    // As sugestões rolam sozinhas (a janela não tem lugar para as três): roladas até a última, e o texto muda.
    const caixa = page.locator('.teclado-meio > .suggestions');
    expect(await caixa.evaluate((e) => e.scrollHeight > e.clientHeight), 'as sugestões não rolam').toBe(true);
    await caixa.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await numero.press('l');
    await expect(page.locator('.suggest .row-title')).toHaveText(['Almoxarifado', 'Ana Souza', 'Coordenação de Logística e Transportes']);
    const c = (await caixa.boundingBox())!;
    const primeira = (await page.locator('.suggest').first().boundingBox())!;
    expect(primeira.y >= c.y - 1 && primeira.y + primeira.height <= c.y + c.height + 1, 'a primeira sugestão fora da vista').toBe(true);
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '3010', contato: true });
  });

  test('with letters, Enter and Ligar dial the first suggestion with contato; a tap dials that one', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('jo');
    await expect(page.locator('.suggest .row-title')).toHaveText(['João Pereira', 'Jordana Alves']);
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '3002', contato: true });
    await botao(page, 'Ligar').click();
    await page.getByRole('button', { name: /Jordana Alves/ }).click();
    await esperarComando(page, { cmd: 'dial', numero: '(11) 3003-1000', contato: true });
    expect(await ligacoes(page)).toEqual([
      { v: 1, cmd: 'dial', numero: '3002', contato: true },
      { v: 1, cmd: 'dial', numero: '3002', contato: true },
      { v: 1, cmd: 'dial', numero: '(11) 3003-1000', contato: true },
    ]);
  });

  test('without a suggestion, Ligar is off and the text says so', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('zzz');
    await expect(page.locator('.suggest')).toHaveCount(0);
    await expect(page.getByText(NENHUM, { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: NENHUM })).toHaveCount(1);
    await expect(botao(page, 'Ligar')).toBeDisabled();
    await numero.press('Enter');
    await semViolacoesSerias(page);
    // O Apagar e o Esc, como antes.
    await botao(page, 'Apagar').click();
    await expect(numero).toHaveValue('zz');
    await numero.press('Escape');
    await expect(numero).toHaveValue('');
    await expect(page.getByText(NENHUM)).toHaveCount(0);
    await expect(botao(page, 'Ligar')).toBeEnabled();
    expect(await ligacoes(page)).toEqual([]);
  });

  test('only numbers work as before, also with the company list', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    // Um dígito: nenhuma sugestão, como antes; dois ou mais: os meus e os da empresa pelos dígitos.
    await numero.fill('3');
    await expect(page.locator('.suggest')).toHaveCount(0);
    await numero.fill('300');
    await expect(page.locator('.suggest .row-title')).toHaveText(['Atendimento Starsonic', 'Beatriz Ramos', 'Diretoria']);
    await expect(page.locator('.suggest .row-sub')).toHaveText(['Contato · (11) 5060-3000', 'Empresa · 3004', 'Empresa · 3000']);
    await numero.fill('2003');
    await expect(page.locator('.suggest .row-title')).toHaveText(['Ana Souza']);
    await expect(page.getByText(NENHUM)).toHaveCount(0);
    // O Enter liga para o número digitado, sem o contato; o número sem contato também.
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '2003' });
    await numero.fill('2004');
    await expect(page.getByText(NENHUM)).toHaveCount(0);
    await botao(page, 'Ligar').click();
    await esperarComando(page, { cmd: 'dial', numero: '2004' });
    expect(await ligacoes(page)).toEqual([
      { v: 1, cmd: 'dial', numero: '2003' },
      { v: 1, cmd: 'dial', numero: '2004' },
    ]);
  });

  test('letters typed with the focus out of the field go into it; the keys stay numbers', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    // Com o foco numa tecla, a letra vai para o campo, e o foco também: o resto do nome, com o espaço, é digitado nele.
    await page.locator('.keys').getByRole('button', { name: '3', exact: true }).click();
    await expect(numero).toHaveValue('3');
    await page.keyboard.press('Backspace');
    await expect(numero).toHaveValue('');
    await page.keyboard.type('ana s');
    await expect(numero).toHaveValue('ana s');
    await expect(numero).toBeFocused();
    await expect(page.locator('.suggest .row-title')).toHaveText(['Ana Souza']);
    // As teclas da tela continuam só números.
    await expect(page.locator('.keys .key b')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']);
    await page.keyboard.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
  });
});

// A janela pequena: nada rola para o lado, o painel cabe entre quem fala (ou o cartão de cima) e o Desligar, a lista
// rola sozinha e mostra pelo menos um contato inteiro, e o axe não acha nada sério.
interface Caixa {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function caixa(locator: Locator): Promise<Caixa> {
  const box = await locator.boundingBox();
  expect(box, 'sem caixa: elemento invisível').not.toBeNull();
  return box!;
}

async function semRolarParaOLado(page: Page, largura: number): Promise<void> {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'a página rola na horizontal').toBeLessThanOrEqual(largura);
  const rolam = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.win *'))
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
      .map((e) => e.className),
  );
  expect(rolam, 'algo rola na horizontal').toEqual([]);
}

/** O painel inteiro na parte do meio, o Cancelar acima do Desligar, e (com a lista) pelo menos um contato inteiro nela. */
async function conferirPainel(page: Page, largura: number, altura: number): Promise<void> {
  await semRolarParaOLado(page, largura);
  const meio = page.locator('.call-middle');
  expect(await meio.evaluate((e) => e.scrollHeight - e.clientHeight), 'o painel transborda da parte do meio').toBeLessThanOrEqual(0.5);
  const area = await caixa(meio);
  const painel = await caixa(page.locator('.call-panel'));
  expect(painel.y >= area.y - 0.5 && painel.y + painel.height <= area.y + area.height + 0.5, 'o painel sai da parte do meio').toBe(true);
  const cancelar = await caixa(page.locator('.call-panel').getByRole('button', { name: 'Cancelar' }));
  const desligar = await caixa(botao(page, 'Desligar'));
  expect(desligar.y + desligar.height, 'o Desligar fora da janela').toBeLessThanOrEqual(altura + 0.5);
  expect(cancelar.y + cancelar.height, 'o Cancelar encosta no Desligar').toBeLessThanOrEqual(desligar.y - 4);
  if ((await lista(page).count()) > 0) {
    const l = await caixa(lista(page));
    const primeira = await caixa(lista(page).getByRole('option').first());
    expect(primeira.y >= l.y - 0.5 && primeira.y + primeira.height <= l.y + l.height + 0.5, 'nenhum contato inteiro na lista').toBe(true);
  }
  await semViolacoesSerias(page);
}

for (const [largura, altura] of [
  [400, 720],
  [340, 560],
  [300, 440],
] as Array<[number, number]>) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`a janela de ${largura}×${altura} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: tema });

      test('the Transferir panel fits with the whole list, a search, a choice and nothing found', async ({ page }) => {
        const numero = await abrirTransferir(page);
        await conferirPainel(page, largura, altura);
        // A lista rola sozinha (12 contatos não cabem), e o último chega à vista.
        expect(await lista(page).evaluate((e) => e.scrollHeight > e.clientHeight), 'a lista não rola').toBe(true);
        await opcao(page, 'Recepção').scrollIntoViewIfNeeded();
        await expect(opcao(page, 'Recepção')).toBeInViewport();
        await numero.fill('jo');
        await conferirPainel(page, largura, altura);
        await opcao(page, 'João Pereira').click();
        await expect(para(page)).toBeVisible();
        await conferirPainel(page, largura, altura);
        // O nome comprido inteiro, sem rolar para o lado.
        await numero.fill('coordenacao');
        await opcao(page, 'Coordenação de Logística e Transportes').click();
        await expect(para(page)).toHaveText('Para: Coordenação de Logística e Transportes · 3020');
        await conferirPainel(page, largura, altura);
        // O número inteiro à vista, também quando o nome não cabe (na menor janela, ele sai com as reticências).
        const numeroDele = para(page).getByText('· 3020');
        if ((await numeroDele.count()) > 0) {
          expect(await numeroDele.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5), 'o número cortado').toBe(true);
        }
        const p = (await para(page).boundingBox())!;
        const painel = (await page.locator('.call-panel').boundingBox())!;
        expect(p.x + p.width, 'quem vai receber sai do painel').toBeLessThanOrEqual(painel.x + painel.width + 0.5);
        await numero.fill('zzz');
        await expect(page.getByText(NENHUM, { exact: true })).toBeVisible();
        await conferirPainel(page, largura, altura);
      });

      test('the Transferir panel fits under the held card, and the Nova ligação one too', async ({ page }) => {
        await abrirTransferir(page, 'duas-ligacoes');
        await conferirPainel(page, largura, altura);
        await abrir(page, 'ligacao');
        await comListaDaEmpresa(page);
        await botao(page, 'Nova ligação').click();
        await expect(nomes(page)).toHaveCount(TODOS.length);
        await conferirPainel(page, largura, altura);
        await expect(botao(page, 'Rediscar 1150603000')).toBeInViewport({ ratio: 1 });
        await expect(botao(page, 'Ligar')).toBeInViewport({ ratio: 1 });
      });

      test('the Teclado fits with a name and with nothing found', async ({ page }) => {
        await abrir(page, 'principal');
        await comListaDaEmpresa(page);
        const numero = page.getByRole('textbox', { name: 'Número' });
        for (const [texto, quantas] of [
          ['a', 3],
          ['coordenacao', 1],
          ['zzz', 0],
        ] as Array<[string, number]>) {
          await numero.fill(texto);
          await expect(page.locator('.suggest')).toHaveCount(quantas);
          if (quantas === 0) await expect(page.getByText(NENHUM, { exact: true })).toBeVisible();
          await semRolarParaOLado(page, largura);
          // As 12 teclas e o Ligar inteiros, sem cobrir a navegação.
          const ligar = await caixa(page.locator('button.btn-call'));
          const nav = await caixa(page.locator('nav.nav'));
          expect(ligar.y + ligar.height, `o Ligar cobre a navegação (${texto})`).toBeLessThanOrEqual(nav.y + 0.5);
          const rolagem = await page.locator('.teclado-meio').evaluate((e) => e.scrollHeight - e.clientHeight);
          expect(rolagem, `a parte das teclas esconde algo embaixo (${texto})`).toBeLessThanOrEqual(0.5);
          for (const tecla of await page.locator('.keys .key').all()) {
            const t = await caixa(tecla);
            expect(t.y + t.height, `uma tecla embaixo do Ligar (${texto})`).toBeLessThanOrEqual(ligar.y + 0.5);
          }
          await semViolacoesSerias(page);
        }
      });
    });
  }
}
