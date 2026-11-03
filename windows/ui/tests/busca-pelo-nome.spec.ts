// (rc.6) Achar o contato pelo nome no Windows, contra a ponte falsa: o Transferir, o Consultar e a Nova ligação da tela
// da ligação (a lista dos meus contatos e dos da lista da empresa embaixo do campo, a busca de ligar, a escolha pelo
// clique e pelas setas com o Enter, quem vai receber e o `contato` do que foi escolhido) e o Teclado (até 3 sugestões,
// também da empresa, e o Enter e o Ligar com letras), com os textos exatos, os comandos que saem, o axe, os três tamanhos
// da janela e as fotos (test-results/capturas/) que vão ao responsável. A busca de ligar é a do Android e do iPhone (com
// letras, só o nome; sem elas, os dígitos do número; nunca a observação). O iPhone fica como estava: os testes dele são
// os ios*.spec.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PLANILHA_DA_EMPRESA } from '../src/fake-scenarios';
import {
  abrir,
  capturar,
  comandos,
  depoisDoQueChegou,
  empurrar,
  esperarComando,
  mudarEstado,
  segurarCpp,
  semViolacoesSerias,
  soltarCpp,
  vezes,
} from './helpers';

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

/**
 * (Correção 1) A lista da empresa com nomes com número (o "loja 1" acha a "Loja 1" e a "Loja 10", e não a "Loja 2") e um
 * nome que também é a observação de um contato meu (a Ana Souza tem "Comercial"). O Almoxarifado 3010 vem antes na ordem
 * e tem o 1 no número.
 */
const COM_NUMEROS = [
  ...DA_EMPRESA,
  { nome: 'Loja 1', numero: '4001', observacao: '' },
  { nome: 'Loja 10', numero: '4010', observacao: '' },
  { nome: 'Loja 2', numero: '4002', observacao: '' },
  { nome: 'Comercial', numero: '3050', observacao: '' },
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

/**
 * As linhas da lista do painel à vista (pelo menos 10 px dentro dela), de cima para baixo: a parte de cada uma que está à
 * vista, o nome e o número.
 */
async function linhasVisiveis(page: Page): Promise<Array<Caixa & { nome: string; numero: string }>> {
  const l = await caixa(lista(page));
  const linhas: Array<Caixa & { nome: string; numero: string }> = [];
  for (const o of await lista(page).getByRole('option').all()) {
    const b = await caixa(o);
    const y = Math.max(b.y, l.y);
    const altura = Math.min(b.y + b.height, l.y + l.height) - y;
    if (altura < 10) continue;
    const nome = await o.locator('.row-title').innerText();
    const numero = (await o.locator('.row-sub').innerText()).replace(/^(Contato|Empresa) · /, '');
    linhas.push({ x: b.x, y, width: b.width, height: altura, nome, numero });
  }
  return linhas;
}

/** O que saiu para a ponte depois dos `antes` primeiros comandos. */
async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes);
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
    // A menor janela, antes de abrir (o layout Mínimo já desenhado: as linhas na altura delas).
    await page.setViewportSize({ width: 300, height: 440 });
    const numero = await abrirTransferir(page);
    await expect(page.locator('.win[data-layout="minimo"]')).toHaveCount(1);
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

  test('a new company sheet with the panel open keeps the marked contact in view', async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 440 });
    const numero = await abrirTransferir(page);
    for (let i = 0; i < TODOS.length; i++) await numero.press('ArrowDown');
    const ultima = opcao(page, 'Recepção');
    await expect(ultima).toHaveAttribute('aria-selected', 'true');
    // A releitura da planilha (de 15 em 15 minutos) traz um contato a mais: a lista na tela é outra, do começo, e a marca
    // fica no mesmo contato, à vista.
    await mudarEstado(page, (s) => ({ ...s, empresa: { ...s.empresa, quantos: DA_EMPRESA.length + 1, vez: 2 } }));
    await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 2, contatos: [...DA_EMPRESA, { nome: 'Bruno Dias', numero: '3006', observacao: '' }] });
    await expect(nomes(page)).toHaveCount(TODOS.length + 1);
    await expect(ultima).toHaveAttribute('aria-selected', 'true');
    await expect(numero).toHaveAttribute('aria-activedescendant', (await ultima.getAttribute('id'))!);
    const l = await caixa(lista(page));
    const u = await caixa(ultima);
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
    await numero.press('n');
    await expect(page.locator('.suggest .row-title')).toHaveText(['Ana Souza', 'Coordenação de Logística e Transportes', 'Financeiro']);
    const c = (await caixa.boundingBox())!;
    const primeira = (await page.locator('.suggest').first().boundingBox())!;
    expect(primeira.y >= c.y - 1 && primeira.y + primeira.height <= c.y + c.height + 1, 'a primeira sugestão fora da vista').toBe(true);
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
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

// (Correção 1) A busca para ligar e transferir é a do Android e do iPhone (o searchAgenda do format.ts): o nome, sempre;
// os dígitos do número, só num texto sem letras; a observação, não. A aba Contatos fica com a dela (contatos.spec.ts).
test.describe('a busca para ligar', () => {
  test('Teclado: "loja 1" suggests Loja 1 and Loja 10, and Enter dials Loja 1', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page, COM_NUMEROS);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('loja 1');
    // O 1 do texto não acha quem tem 1 no número (o Almoxarifado 3010 vem antes na ordem).
    await expect(page.locator('.suggest .row-title')).toHaveText(['Loja 1', 'Loja 10']);
    await expect(page.locator('.suggest .row-sub')).toHaveText(['Empresa · 4001', 'Empresa · 4010']);
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '4001', contato: true });
    expect(await ligacoes(page)).toEqual([{ v: 1, cmd: 'dial', numero: '4001', contato: true }]);
  });

  test('Teclado: "joao 2003" finds nobody, and Ligar is off', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page, COM_NUMEROS);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('joao 2003');
    // O 2003 é o da Ana Souza, mas o texto tem letras: só o nome vale, e nenhum tem "joao 2003".
    await expect(page.getByText(NENHUM, { exact: true })).toBeVisible();
    await expect(page.locator('.suggest')).toHaveCount(0);
    await expect(botao(page, 'Ligar')).toBeDisabled();
    await numero.press('Enter');
    await depoisDoQueChegou(page);
    expect(await ligacoes(page)).toEqual([]);
  });

  test('Teclado: "comercial" dials the company Comercial, not my contact with it in the observation', async ({ page }) => {
    await abrir(page, 'principal');
    await comListaDaEmpresa(page, COM_NUMEROS);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('comercial');
    // A Ana Souza (minha, com "Comercial" na observação) vem antes na ordem, mas a observação não entra.
    await expect(page.locator('.suggest .row-title')).toHaveText(['Comercial']);
    await expect(page.locator('.suggest .row-sub')).toHaveText(['Empresa · 3050']);
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'dial', numero: '3050', contato: true });
    expect(await ligacoes(page)).toEqual([{ v: 1, cmd: 'dial', numero: '3050', contato: true }]);
  });

  test('the panels: "loja 1" lists Loja 1 and Loja 10, "joao 2003" nobody, and the observation is not searched', async ({ page }) => {
    await abrir(page, 'ligacao');
    await comListaDaEmpresa(page, COM_NUMEROS);
    await botao(page, 'Transferir').click();
    let numero = campo(page, 'Número para transferir');
    await numero.fill('loja 1');
    await expect(nomes(page)).toHaveText(['Loja 1', 'Loja 10']);
    await numero.fill('joao 2003');
    await expect(lista(page)).toHaveCount(0);
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
    // A observação não entra: a Ana Souza (minha, "Comercial") e o João Pereira ("Vendas") não aparecem.
    await numero.fill('comercial');
    await expect(nomes(page)).toHaveText(['Comercial']);
    await numero.fill('vendas');
    await expect(lista(page)).toHaveCount(0);
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
    // Só números, pelos dígitos, como antes.
    await numero.fill('4001');
    await expect(nomes(page)).toHaveText(['Loja 1']);
    // A Nova ligação, com a mesma busca.
    await numero.press('Escape');
    await botao(page, 'Nova ligação').click();
    numero = campo(page, 'Número da nova ligação');
    await numero.fill('loja 1');
    await expect(nomes(page)).toHaveText(['Loja 1', 'Loja 10']);
    await numero.fill('joao 2003');
    await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
    await expect(botao(page, 'Ligar')).toBeDisabled();
    expect(await transferencias(page)).toEqual([]);
    expect(await ligacoes(page)).toEqual([]);
  });
});

// (Correção 1) O segundo clique de um clique duplo: o primeiro muda a tela (escolhe, liga, abre o painel), e o segundo
// cai no que ficou embaixo do ponteiro. No Windows, ele não faz nada nos botões do painel, nos da ligação e no Desligar.
// O segundo clique sozinho (o down e o up com o clickCount 2, o `detail` 2 do navegador) vale pelo do clique duplo de
// verdade quando a tela muda só com a resposta do C++.
test.describe('o clique duplo', () => {
  for (const [largura, altura, cenario] of [
    [400, 720, 'ligacao'],
    [400, 640, 'duas-ligacoes'],
  ] as Array<[number, number, string]>) {
    test(`a double-click on the 3rd and 4th rows of the Transferir list only chooses the contact (${largura}×${altura}, ${cenario})`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      const numero = await abrirTransferir(page, cenario);
      // A 3ª e a 4ª à vista (com duas ligações em 400×640, a 4ª fica fora da lista: só a 3ª).
      const linhas = (await linhasVisiveis(page)).slice(2, 4);
      expect(linhas.length, 'menos de 3 linhas à vista').toBeGreaterThanOrEqual(1);
      for (const linha of linhas) {
        // Na metade da esquerda (antes, o Consultar caía embaixo) e na da direita (o Transferir agora), em cima, no meio e
        // embaixo da linha (o Cancelar também).
        for (const [fx, fy] of [0.25, 0.75].flatMap((x) => [0.25, 0.5, 0.75].map((y) => [x, y]))) {
          await numero.fill('');
          await expect(nomes(page)).toHaveCount(TODOS.length);
          await page.mouse.dblclick(linha.x + linha.width * fx, linha.y + linha.height * fy);
          await expect(para(page), `${linha.nome}, em ${fx} × ${fy}`).toHaveText(`Para: ${linha.nome} · ${linha.numero}`);
          await expect(numero).toBeVisible();
        }
      }
      await depoisDoQueChegou(page);
      expect(await transferencias(page)).toEqual([]);
    });

    const controles: Array<[string, 'Número para transferir' | 'Número da nova ligação']> =
      cenario === 'ligacao'
        ? [
            ['Transferir', 'Número para transferir'],
            ['Nova ligação', 'Número da nova ligação'],
          ]
        : [['Transferir', 'Número para transferir']];
    for (const [controle, rotulo] of controles) {
      test(`a double-click on the ${controle} control leaves the panel open (${largura}×${altura}, ${cenario})`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: altura });
        await abrir(page, cenario);
        await comListaDaEmpresa(page);
        const c = await caixa(botao(page, controle));
        // O Cancelar do painel aberto fica embaixo de uma parte do controle.
        await botao(page, controle).click();
        const cancelar = await caixa(page.locator('.call-panel').getByRole('button', { name: 'Cancelar' }));
        await campo(page, rotulo).press('Escape');
        await expect(page.locator('.call-panel')).toHaveCount(0);
        const y0 = Math.max(c.y, cancelar.y);
        const y1 = Math.min(c.y + c.height, cancelar.y + cancelar.height);
        expect(y1 - y0, `o Cancelar não fica embaixo do ${controle}: ${JSON.stringify({ c, cancelar })}`).toBeGreaterThanOrEqual(4);
        await page.mouse.dblclick(c.x + c.width / 2, (y0 + y1) / 2);
        await expect(campo(page, rotulo)).toBeVisible();
        await depoisDoQueChegou(page);
        await expect(campo(page, rotulo)).toBeVisible();
      });
    }
  }

  test('Nova ligação: a double-click on a lower row dials once, and the second click reaches neither Mudo nor Espera', async ({ page }) => {
    for (const controle of ['Mudo', 'Espera']) {
      // O C++ que demora a responder (o segundo clique cai nos controles de uma ligação) e o de sempre.
      for (const lento of [true, false]) {
        await abrir(page, 'ligacao');
        await comListaDaEmpresa(page);
        const c = await caixa(botao(page, controle));
        await botao(page, 'Nova ligação').click();
        await expect(nomes(page)).toHaveCount(TODOS.length);
        // Uma linha da lista em cima do controle, que fica no lugar dela quando o painel fecha.
        const linha = (await linhasVisiveis(page)).find((r) => Math.min(r.y + r.height, c.y + c.height) - Math.max(r.y, c.y) >= 8);
        expect(linha, `nenhuma linha em cima do ${controle}`).toBeDefined();
        const x = c.x + c.width / 2;
        const y = (Math.max(linha!.y, c.y) + Math.min(linha!.y + linha!.height, c.y + c.height)) / 2;
        const antes = (await comandos(page)).length;
        if (lento) {
          await segurarCpp(page);
          await page.mouse.click(x, y);
          await expect(campo(page, 'Número da nova ligação')).toHaveCount(0);
          const embaixo = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.textContent?.trim(), [x, y]);
          expect(embaixo, 'o segundo clique não cai no controle').toBe(controle);
          await page.mouse.down({ clickCount: 2 });
          await page.mouse.up({ clickCount: 2 });
          await soltarCpp(page);
        } else {
          await page.mouse.dblclick(x, y);
        }
        await expect(page.locator('.vcard').filter({ hasText: 'Ana Souza' }).getByText('Em espera', { exact: true })).toBeVisible();
        await depoisDoQueChegou(page);
        expect(await depois(page, antes), `${controle}, ${lento ? 'o C++ lento' : 'o C++ de sempre'}`).toEqual([
          { v: 1, cmd: 'dial', numero: linha!.numero, contato: true },
        ]);
      }
    }
  });

  test('Teclado: a double-click on a suggestion or on Ligar dials once', async ({ page }) => {
    // A ponte falsa não abre a tela da ligação: o segundo clique cai no mesmo botão.
    await abrir(page, 'principal');
    await comListaDaEmpresa(page);
    const numero = page.getByRole('textbox', { name: 'Número' });
    await numero.fill('jo');
    await expect(page.locator('.suggest .row-title')).toHaveText(['João Pereira', 'Jordana Alves']);
    const antes = (await comandos(page)).length;
    await page.locator('.suggest').first().dblclick();
    await esperarComando(page, { cmd: 'dial', numero: '3002', contato: true });
    await numero.fill('2004');
    await botao(page, 'Ligar').dblclick();
    await esperarComando(page, { cmd: 'dial', numero: '2004' });
    await depoisDoQueChegou(page);
    expect(await depois(page, antes)).toEqual([
      { v: 1, cmd: 'dial', numero: '3002', contato: true },
      { v: 1, cmd: 'dial', numero: '2004' },
    ]);
  });

  for (const [largura, altura] of [
    [400, 720],
    [300, 440],
  ] as Array<[number, number]>) {
    test(`Teclado: a double-click on Ligar dials, and the second click does not hang up (${largura}×${altura})`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: altura });
      // O Desligar da tela da ligação e o Ligar do Teclado: o ponto do meio da parte de um embaixo do outro.
      await abrir(page, 'ligacao');
      const d = await caixa(botao(page, 'Desligar'));
      await abrir(page, 'principal');
      const numero = page.getByRole('textbox', { name: 'Número' });
      await numero.fill('2004');
      const g = await caixa(botao(page, 'Ligar'));
      const x0 = Math.max(d.x, g.x);
      const x1 = Math.min(d.x + d.width, g.x + g.width);
      const y0 = Math.max(d.y, g.y);
      const y1 = Math.min(d.y + d.height, g.y + g.height);
      expect(x1 - x0 >= 8 && y1 - y0 >= 8, `o Desligar não fica embaixo do Ligar: ${JSON.stringify({ d, g })}`).toBe(true);
      const x = (x0 + x1) / 2;
      const y = (y0 + y1) / 2;
      const antes = (await comandos(page)).length;
      await page.mouse.click(x, y);
      await esperarComando(page, { cmd: 'dial', numero: '2004' });
      // O C++ começa a ligação: a tela dela, com o Desligar embaixo do ponteiro.
      await mudarEstado(page, (s) => ({
        ...s,
        ligacao: {
          top: { id: 31, number: '2004', name: '', incoming: false, phase: 'dialing', activeSinceMs: 0, held: false },
          second: null,
          secondKind: 'none',
          muted: false,
          conference: false,
          conferenceSinceMs: 0,
          consulting: false,
          colleagueActive: false,
        },
      }));
      await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
      const embaixo = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label'), [x, y]);
      expect(embaixo, 'o segundo clique não cai no Desligar').toBe('Desligar');
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
      await depoisDoQueChegou(page);
      expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'dial', numero: '2004' }]);
      await expect(botao(page, 'Desligar')).toBeVisible();
    });
  }
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

// (Correção 1) O painel parado: ele ocupa a parte do meio inteira (o campo em cima, a lista com o espaço que sobra e os
// botões embaixo), e o campo e o Cancelar ficam no mesmo lugar com o campo vazio, digitando, sem nada achado, só com um
// número e depois da escolha (também a de um nome longo).
async function topos(page: Page, rotulo: 'Número para transferir' | 'Número da nova ligação'): Promise<[campo: number, cancelar: number]> {
  const c = await caixa(campo(page, rotulo));
  const x = await caixa(page.locator('.call-panel').getByRole('button', { name: 'Cancelar' }));
  return [c.y, x.y];
}

function parado(antes: [number, number], agora: [number, number], situacao: string): void {
  const onde = `${situacao}: ${JSON.stringify(antes)} → ${JSON.stringify(agora)}`;
  expect(Math.abs(agora[0] - antes[0]), `o campo mexeu (${onde})`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(agora[1] - antes[1]), `o Cancelar mexeu (${onde})`).toBeLessThanOrEqual(0.5);
}

for (const [largura, altura, cenario] of [
  [400, 720, 'ligacao'],
  [340, 560, 'ligacao'],
  [300, 440, 'ligacao'],
  [400, 640, 'duas-ligacoes'],
] as Array<[number, number, string]>) {
  test.describe(`o painel parado em ${largura}×${altura} (${cenario})`, () => {
    test.use({ viewport: { width: largura, height: altura } });

    test('Transferir: the field and Cancelar stay put while typing and after choosing', async ({ page }) => {
      const rotulo = 'Número para transferir';
      const numero = await abrirTransferir(page, cenario);
      const vazio = await topos(page, rotulo);
      await numero.fill('jo');
      await expect(nomes(page)).toHaveText(['João Pereira', 'Jordana Alves']);
      parado(vazio, await topos(page, rotulo), '"jo"');
      await numero.fill('zzz');
      await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
      parado(vazio, await topos(page, rotulo), 'nada achado');
      await numero.fill('2004');
      await expect(lista(page)).toHaveCount(0);
      await expect(page.getByText(NENHUM)).toHaveCount(0);
      parado(vazio, await topos(page, rotulo), 'só um número');
      await numero.fill('jo');
      await opcao(page, 'João Pereira').click();
      await expect(para(page)).toHaveText('Para: João Pereira · 3002');
      parado(vazio, await topos(page, rotulo), 'escolhido');
      await numero.fill('coordenacao');
      await opcao(page, 'Coordenação de Logística e Transportes').click();
      await expect(para(page)).toHaveText('Para: Coordenação de Logística e Transportes · 3020');
      parado(vazio, await topos(page, rotulo), 'nome longo escolhido');
      await conferirPainel(page, largura, altura);
    });

    // Com duas ligações, sem a Nova ligação; nela, a escolha liga e fecha o painel.
    if (cenario === 'ligacao') {
      test('Nova ligação: the field and Cancelar stay put while typing', async ({ page }) => {
        const rotulo = 'Número da nova ligação';
        await abrir(page, cenario);
        await comListaDaEmpresa(page);
        await botao(page, 'Nova ligação').click();
        const numero = campo(page, rotulo);
        await expect(nomes(page)).toHaveCount(TODOS.length);
        const vazio = await topos(page, rotulo);
        await numero.fill('jo');
        await expect(nomes(page)).toHaveText(['João Pereira', 'Jordana Alves']);
        parado(vazio, await topos(page, rotulo), '"jo"');
        await numero.fill('zzz');
        await expect(page.locator('.call-panel').getByText(NENHUM, { exact: true })).toBeVisible();
        parado(vazio, await topos(page, rotulo), 'nada achado');
        await numero.fill('2004');
        await expect(lista(page)).toHaveCount(0);
        await expect(page.getByText(NENHUM)).toHaveCount(0);
        parado(vazio, await topos(page, rotulo), 'só um número');
        await conferirPainel(page, largura, altura);
      });
    }
  });
}

// (Correção 1) A linha única da menor janela (o painel no Mínimo e o Teclado numa janela baixa): o nome encolhe primeiro,
// com as reticências, e o "Empresa · <número>" fica inteiro, como no "Para:". E as fotos do painel nela.
async function numeroInteiro(linha: Locator, sub: string): Promise<void> {
  await expect(linha.locator('.row-sub')).toHaveText(sub);
  expect(await linha.locator('.row-sub').evaluate((e) => e.scrollWidth <= e.clientWidth), `o "${sub}" cortado`).toBe(true);
  const titulo = linha.locator('.row-title');
  expect(await titulo.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'), 'o nome longo sem as reticências').toBe(true);
  const l = await caixa(linha);
  const s = await caixa(linha.locator('.row-sub'));
  expect(s.x + s.width, 'o número sai da linha').toBeLessThanOrEqual(l.x + l.width + 0.5);
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a janela de 300×440, o nome longo (${tema})`, () => {
    test.use({ viewport: { width: 300, height: 440 }, colorScheme: tema });

    test('the panel list cuts the long name and keeps "Empresa · 3020" whole', async ({ page }) => {
      const numero = await abrirTransferir(page);
      await expect(page.locator('.win[data-layout="minimo"]')).toHaveCount(1);
      // O nome longo no alto da lista, com os de nome curto embaixo (só a lista rola: o scrollIntoView rolaria também a
      // janela, que tem o brilho do fundo escondido embaixo dela).
      const longo = opcao(page, 'Coordenação de Logística e Transportes');
      await longo.evaluate((o) => {
        const l = o.closest('[role="listbox"]')!;
        l.scrollTop += o.getBoundingClientRect().top - l.getBoundingClientRect().top;
      });
      await expect(longo).toBeInViewport();
      expect(await page.locator('.win').evaluate((e) => e.scrollTop), 'a janela rolou').toBe(0);
      await numeroInteiro(longo, 'Empresa · 3020');
      await semRolarParaOLado(page, 300);
      await semViolacoesSerias(page);
      await capturar(page, 'transferir-nome-longo-300x440', tema);
      await numero.fill('jo');
      await expect(nomes(page)).toHaveText(['João Pereira', 'Jordana Alves']);
      for (const o of await lista(page).getByRole('option').all()) {
        expect(await o.locator('.row-sub').evaluate((e) => e.scrollWidth <= e.clientWidth), 'um número cortado').toBe(true);
      }
      expect(await page.locator('.win').evaluate((e) => e.scrollTop), 'a janela rolou').toBe(0);
      await semRolarParaOLado(page, 300);
      await semViolacoesSerias(page);
      await capturar(page, 'transferir-jo-300x440', tema);
    });

    test('the Teclado suggestion cuts the long name and keeps "Empresa · 3020" whole', async ({ page }) => {
      await abrir(page, 'principal');
      await comListaDaEmpresa(page);
      await page.getByRole('textbox', { name: 'Número' }).fill('coordenacao');
      const sugestao = page.locator('.suggest');
      await expect(sugestao).toHaveCount(1);
      await numeroInteiro(sugestao, 'Empresa · 3020');
      await semRolarParaOLado(page, 300);
    });
  });
}
