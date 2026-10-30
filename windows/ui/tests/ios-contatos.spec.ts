// A aba Contatos do iPhone (spec do iPhone, 4.1 e 11.2; docs/ponte-windows.md, "O modo iPhone"), contra a ponte falsa
// no modo iPhone, em cada tamanho do iPhone e nos dois temas: a agenda do iPhone (a mensagem `agenda`) em ordem
// alfabética do português, a busca pelo nome e pelos dígitos, o ligar e a escolha do número, a permissão (o aviso e o
// Permitir, também dada depois), o contactsOpened a cada abertura e as sugestões do Teclado e da ligação, com o axe e as
// fotos (test-results/capturas/ios-contatos*.png). A agenda grande (Review Focus 1) fica em ios-contatos-lista-grande.spec.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AGENDA_DE_EXEMPLO } from '../src/fake-scenarios';
import type { AgendaContact, AgendaPermission } from '../src/state';
import { comandos, empurrar, esperarComando, mudarEstado } from './helpers';
import { abrirIos, capturarIos, dentroDaAreaSegura, noIphone, semViolacoesSerias, TAMANHOS_IPHONE } from './ios-helpers';

/** A agenda de exemplo na ordem da tela: a alfabética do português (a Ângela no A, o Élcio no E, a Íris no I). */
const EM_ORDEM = ['Ana Souza', 'Ângela Prado', 'Beatriz Ramos', 'Cecília Duarte', 'Élcio Matos', 'Íris Lopes', 'Otávio Nunes', 'Portaria'];
const GRUPOS = ['A', 'B', 'C', 'E', 'I', 'O', 'P'];
const AVISO = 'Permita o acesso aos contatos para ligar pelo nome.';
const SEM_NUMERO = 'Nenhum contato com número no iPhone.';
const NAO_ACHOU = 'Nenhum contato encontrado.';
const AVISO_DE_TESTE = 'Sem conexão com o servidor. Tente de novo em instantes.';

/** Abre a aba Contatos pela navegação de baixo. */
async function abrirContatos(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('button', { name: 'Contatos', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Contatos' })).toBeVisible();
}

/** Os nomes da lista, na ordem da tela. */
function nomes(page: Page): Locator {
  return page.locator('main li.row .row-title');
}

/** A linha de um contato, pelo nome (o título da linha). */
function linha(page: Page, nome: string): Locator {
  return page.locator('main li.row').filter({ has: page.locator('.row-title').getByText(nome, { exact: true }) });
}

function busca(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Buscar contato' });
}

async function vezesQueAbriu(page: Page): Promise<number> {
  return (await comandos(page)).filter((c) => c.cmd === 'contactsOpened').length;
}

/** Um aviso empurrado depois das mensagens de antes: na tela, ele diz que todas já passaram (as mensagens vão na ordem). */
async function depoisDoQueChegou(page: Page): Promise<void> {
  await empurrar(page, { v: 1, type: 'toast', texto: AVISO_DE_TESTE });
  await expect(page.getByText(AVISO_DE_TESTE)).toBeVisible();
  // E os efeitos do último desenho (o Preact os roda depois da pintura).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
}

/**
 * O núcleo com uma lista nova da agenda (o SetAgenda): a mensagem `agenda` com a `vez` seguinte e depois o estado com
 * ela, a contagem (os contatos com algum número) e a permissão. Numa avaliação só da página: nenhuma resposta da ponte
 * falsa (a releitura do contactsOpened) entra no meio.
 */
async function novaAgenda(page: Page, contatos: AgendaContact[], permissao: AgendaPermission = 'concedida'): Promise<void> {
  await page.evaluate(
    ({ contatos, permissao }) => {
      const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
      const s = fake.state();
      const vez = (s.agenda?.vez ?? 0) + 1;
      fake.push({ v: 1, type: 'agenda', vez, contatos });
      fake.push({ v: 1, type: 'state', state: { ...s, agenda: { permissao, vez, quantos: contatos.filter((c) => c.numeros.length > 0).length } } });
    },
    { contatos, permissao },
  );
}

for (const tamanho of TAMANHOS_IPHONE) {
  for (const tema of ['light', 'dark'] as const) {
    test.describe(`Contatos no iPhone ${tamanho.largura}×${tamanho.altura} (${tema})`, () => {
      test.use({ ...noIphone(tamanho), colorScheme: tema });

      test('Contatos lists the agenda, searches by name and digits, and calls', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        await abrirContatos(page);
        // A agenda em ordem alfabética do português, nos grupos pela letra, com as iniciais e os números juntos (o ramal
        // como "Ramal").
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        await expect(page.locator('main h2.group')).toHaveText(GRUPOS);
        await expect(linha(page, 'Ana Souza').locator('.row-sub')).toHaveText('+55 11 98888-7777 · Ramal 2003');
        await expect(linha(page, 'Portaria').locator('.row-sub')).toHaveText('Ramal 2000');
        await expect(linha(page, 'Élcio Matos').locator('.avatar')).toHaveText('ÉM');
        await expect(linha(page, 'Portaria').locator('.avatar')).toHaveText('PO');
        // Uma agenda pequena fica sem a contenção da lista grande: cada botão de ligar é alcançado pelo papel.
        await expect(page.locator('main .agenda')).not.toHaveClass(/\bagenda-grande\b/);
        await expect(page.getByRole('button', { name: /^Ligar para / })).toHaveCount(EM_ORDEM.length);
        // Só para ver e ligar: sem o "+", sem o "⋯" e sem os filtros da lista da empresa (a agenda muda no iPhone).
        await expect(page.getByRole('button', { name: 'Novo contato' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Mais opções' })).toHaveCount(0);
        await expect(page.locator('main .filters')).toHaveCount(0);
        await dentroDaAreaSegura(page, ['.brand', 'main label.search', '.nav']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'contatos', tamanho, tema);

        // A busca, sem os espaços das pontas: o nome sem acento e sem caixa, para qualquer texto; sem letras, também os
        // dígitos dentro de algum número (os parênteses e o traço não contam).
        for (const [texto, achados] of [
          ['élcio', ['Élcio Matos']],
          ['ELCIO', ['Élcio Matos']],
          ['  portaria  ', ['Portaria']],
          ['2000', ['Portaria']],
          ['98888-77', ['Ana Souza']],
          ['(11)', ['Ana Souza', 'Ângela Prado', 'Cecília Duarte', 'Élcio Matos', 'Íris Lopes']],
          ['', EM_ORDEM],
        ] as const) {
          await busca(page).fill(texto);
          await expect(nomes(page), texto).toHaveText([...achados]);
        }

        // Um contato de um número só liga direto, pela linha ou pelo botão redondo, com a regra dos contatos.
        await linha(page, 'Élcio Matos').locator('.row-hit').click();
        await esperarComando(page, { cmd: 'dial', numero: '(11) 3333-4444', contato: true });
        await page.getByRole('button', { name: 'Ligar para Portaria', exact: true }).click();
        await esperarComando(page, { cmd: 'dial', numero: '2000', contato: true });
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([
          { v: 1, cmd: 'dial', numero: '(11) 3333-4444', contato: true },
          { v: 1, cmd: 'dial', numero: '2000', contato: true },
        ]);

        // O nome vale para qualquer texto, também um sem letras (como no Android e na aba Contatos do Windows): "101" acha o
        // "Apto 101", cujo número não tem esses dígitos.
        await esperarComando(page, { cmd: 'contactsOpened' });
        await novaAgenda(page, [...AGENDA_DE_EXEMPLO, { nome: 'Apto 101', numeros: ['(11) 3456-7890'] }]);
        await expect(nomes(page)).toHaveCount(EM_ORDEM.length + 1);
        await busca(page).fill('101');
        await expect(nomes(page)).toHaveText(['Apto 101']);
      });

      test('a contact with two numbers asks which one', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        await abrirContatos(page);
        const dialogo = page.getByRole('dialog', { name: 'Ana Souza' });
        const ligarAna = page.getByRole('button', { name: 'Ligar para Ana Souza', exact: true });
        // Pela linha: a escolha, com o nome no título, um botão por número (o ramal como "Ramal") e o Cancelar.
        await linha(page, 'Ana Souza').locator('.row-hit').click();
        await expect(dialogo).toBeVisible();
        await expect(dialogo.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
        await expect(dialogo.getByRole('button')).toHaveText(['+55 11 98888-7777', 'Ramal 2003', 'Cancelar']);
        await dentroDaAreaSegura(page, ['dialog[open]']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'contatos-escolha', tamanho, tema);
        // O Cancelar não manda nada, e o foco volta a quem abriu a escolha; o Esc também cancela.
        await dialogo.getByRole('button', { name: 'Cancelar' }).click();
        await expect(dialogo).toHaveCount(0);
        await expect(linha(page, 'Ana Souza').locator('.row-hit')).toBeFocused();
        await ligarAna.click();
        await expect(dialogo).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialogo).toHaveCount(0);
        await expect(ligarAna).toBeFocused();
        expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([]);
        // Pelo botão redondo, a escolha de novo; o número escolhido liga, com a regra dos contatos.
        await ligarAna.click();
        await dialogo.getByRole('button', { name: 'Ramal 2003' }).click();
        await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
        await expect(dialogo).toHaveCount(0);
        expect((await comandos(page)).filter((c) => c.cmd === 'dial')).toEqual([{ v: 1, cmd: 'dial', numero: '2003', contato: true }]);
      });

      test('opening the tab sends contactsOpened each time', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        expect(await vezesQueAbriu(page), 'no Teclado, ainda nenhum').toBe(0);
        await abrirContatos(page);
        await expect.poll(() => vezesQueAbriu(page)).toBe(1);
        // A resposta do hospedeiro (a agenda lida de novo), um estado novo e o toque na aba que já está aberta não abrem
        // a aba de novo.
        await page.getByRole('button', { name: 'Contatos', exact: true }).click();
        await mudarEstado(page, (s) => ({ ...s, perdidas: s.perdidas + 1 }));
        await depoisDoQueChegou(page);
        expect(await vezesQueAbriu(page)).toBe(1);
        // Do Teclado e dos Recentes, a aba abre de novo: um a mais a cada vez.
        await page.getByRole('button', { name: 'Teclado', exact: true }).click();
        await abrirContatos(page);
        await expect.poll(() => vezesQueAbriu(page)).toBe(2);
        await page.getByRole('button', { name: 'Recentes', exact: true }).click();
        await abrirContatos(page);
        await expect.poll(() => vezesQueAbriu(page)).toBe(3);
        await depoisDoQueChegou(page);
        expect(await vezesQueAbriu(page)).toBe(3);
      });

      test('without permission shows the notice and Permitir sends allowContacts', async ({ page }) => {
        // Pendente (o iPhone ainda não perguntou) e negada: só o aviso e o Permitir, sem a busca e sem a lista. A aba que
        // abre manda o contactsOpened também sem a permissão (com a pendente, o hospedeiro pergunta).
        for (const permissao of ['pendente', 'negada'] as const) {
          await abrirIos(page, 'principal', tamanho, { agenda: permissao });
          await abrirContatos(page);
          const aba = page.getByRole('main', { name: 'Contatos' });
          await expect(aba.getByText(AVISO, { exact: true }), permissao).toBeVisible();
          await expect(aba.getByRole('button')).toHaveText(['Permitir']);
          await expect(busca(page)).toHaveCount(0);
          await expect(aba.locator('li.row')).toHaveCount(0);
          await expect(page.getByText(SEM_NUMERO)).toHaveCount(0);
          await esperarComando(page, { cmd: 'contactsOpened' });
        }
        await dentroDaAreaSegura(page, ['.brand', 'main p', 'main button', '.nav']);
        await semViolacoesSerias(page);
        await capturarIos(page, 'contatos-sem-permissao', tamanho, tema);
        // O Permitir manda o allowContacts (com a negada, o hospedeiro abre os Ajustes). A ponte falsa dá a permissão, e a
        // lista aparece na aba aberta.
        await page.getByRole('button', { name: 'Permitir', exact: true }).click();
        await esperarComando(page, { cmd: 'allowContacts' });
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        await expect(page.getByText(AVISO)).toHaveCount(0);
        expect(await vezesQueAbriu(page)).toBe(1);
      });

      test('the permission given later shows the list without reopening', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho, { agenda: 'negada' });
        await abrirContatos(page);
        const aviso = page.getByText(AVISO, { exact: true });
        await expect(aviso).toBeVisible();
        await esperarComando(page, { cmd: 'contactsOpened' });
        // A pessoa dá a permissão nos Ajustes do iPhone e volta ao app: o núcleo manda o estado (concedida, com a `vez` e
        // a contagem da lista nova) e a lista. Aqui o estado chega antes: até a lista chegar, a busca sem nenhum contato e
        // sem o texto da agenda vazia (a agenda tem contatos; a lista está a caminho).
        await mudarEstado(page, (s) => ({ ...s, agenda: { permissao: 'concedida', vez: 1, quantos: AGENDA_DE_EXEMPLO.length } }));
        await expect(aviso).toHaveCount(0);
        await expect(busca(page)).toBeVisible();
        await depoisDoQueChegou(page);
        await expect(nomes(page)).toHaveCount(0);
        await expect(page.getByText(SEM_NUMERO)).toHaveCount(0);
        await empurrar(page, { v: 1, type: 'agenda', vez: 1, contatos: AGENDA_DE_EXEMPLO });
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        // Tirada e dada de novo, com a lista antes do estado (como o núcleo manda): o aviso, e depois a lista.
        await empurrar(page, { v: 1, type: 'agenda', vez: 2, contatos: [] });
        await mudarEstado(page, (s) => ({ ...s, agenda: { permissao: 'negada', vez: 2, quantos: 0 } }));
        await expect(aviso).toBeVisible();
        await expect(nomes(page)).toHaveCount(0);
        await empurrar(page, { v: 1, type: 'agenda', vez: 3, contatos: AGENDA_DE_EXEMPLO });
        await depoisDoQueChegou(page);
        await expect(aviso, 'a lista chegou, e o estado ainda diz negada').toBeVisible();
        await mudarEstado(page, (s) => ({ ...s, agenda: { permissao: 'concedida', vez: 3, quantos: AGENDA_DE_EXEMPLO.length } }));
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        // Uma lista mais velha que chega atrasada não vale (a de `vez` mais alta fica).
        await empurrar(page, { v: 1, type: 'agenda', vez: 2, contatos: [] });
        await depoisDoQueChegou(page);
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        // Tudo sem abrir a aba de novo.
        expect(await vezesQueAbriu(page)).toBe(1);
      });

      test('an empty agenda and an empty search show their texts', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        await abrirContatos(page);
        await expect(nomes(page)).toHaveText(EM_ORDEM);
        // Com um contato sem nome na agenda (na lista, o número no lugar do nome).
        await esperarComando(page, { cmd: 'contactsOpened' });
        await novaAgenda(page, [...AGENDA_DE_EXEMPLO, { nome: '', numeros: ['(51) 94444-3333'] }]);
        await expect(nomes(page)).toHaveText(['(51) 94444-3333', ...EM_ORDEM]);
        // Uma busca sem resultado. Com letras, só o nome vale (os dígitos do texto não contam); sem letras e sem dígitos,
        // nenhum número bate, e o nome de verdade (o do contato sem nome é vazio) não tem o traço.
        for (const texto of ['Zuleica', 'Ana 2003', '-']) {
          await busca(page).fill(texto);
          await expect(page.getByText(NAO_ACHOU, { exact: true }), texto).toBeVisible();
          await expect(nomes(page)).toHaveCount(0);
          await expect(page.getByText(SEM_NUMERO)).toHaveCount(0);
        }
        await busca(page).fill('');
        await expect(nomes(page)).toHaveText(['(51) 94444-3333', ...EM_ORDEM]);
        // A agenda sem nenhum contato com número (o contato sem número fica de fora): o texto da agenda vazia; com uma
        // busca, o da busca.
        await novaAgenda(page, [{ nome: 'Ana Sem Número', numeros: [] }]);
        await expect(page.getByText(SEM_NUMERO, { exact: true })).toBeVisible();
        await expect(nomes(page)).toHaveCount(0);
        await busca(page).fill('ana');
        await expect(page.getByText(NAO_ACHOU, { exact: true })).toBeVisible();
        await expect(page.getByText(SEM_NUMERO)).toHaveCount(0);
      });

      test('the keypad suggests numbers from the agenda', async ({ page }) => {
        await abrirIos(page, 'principal', tamanho);
        const numero = page.getByRole('textbox', { name: 'Número' });
        const sugestoes = page.locator('.suggest');
        // "988": o celular da Ana Souza (uma sugestão por número da agenda).
        await numero.fill('988');
        await expect(sugestoes.locator('.row-title')).toHaveText(['Ana Souza']);
        await expect(sugestoes.locator('.row-sub')).toHaveText(['Contato · +55 11 98888-7777']);
        await expect(sugestoes.locator('.avatar')).toHaveText(['AS']);
        // "200": os dois ramais, na ordem da aba Contatos.
        await numero.fill('200');
        await expect(sugestoes.locator('.row-title')).toHaveText(['Ana Souza', 'Portaria']);
        await expect(sugestoes.locator('.row-sub')).toHaveText(['Contato · 2003', 'Contato · 2000']);
        // O toque na sugestão liga, com a regra dos contatos.
        await numero.fill('988');
        await sugestoes.click();
        await esperarComando(page, { cmd: 'dial', numero: '+55 11 98888-7777', contato: true });
        // As sugestões vêm da agenda, no lugar dos `contatos` do estado (no iPhone, vazios; aqui um, com o número do
        // Élcio, para conferir).
        await mudarEstado(page, (s) => ({ ...s, contatos: [{ id: 'c1d2e3f4a5b60718', nome: 'Atendimento', numero: '(11) 3333-4444', observacao: '' }] }));
        await depoisDoQueChegou(page);
        await numero.fill('33334444');
        await expect(sugestoes.locator('.row-title')).toHaveText(['Élcio Matos']);
        // Um contato sem nome: o número no lugar do nome, e o "?" das iniciais.
        await novaAgenda(page, [...AGENDA_DE_EXEMPLO, { nome: '', numeros: ['(51) 94444-3333'] }]);
        await depoisDoQueChegou(page);
        await numero.fill('944443');
        await expect(sugestoes.locator('.row-title')).toHaveText(['(51) 94444-3333']);
        await expect(sugestoes.locator('.row-sub')).toHaveText(['Contato · (51) 94444-3333']);
        await expect(sugestoes.locator('.avatar')).toHaveText(['?']);
      });

      test('the call screen suggests numbers from the agenda', async ({ page }) => {
        await abrirIos(page, 'ligacao', tamanho);
        const sugestoes = page.locator('.call-suggest');
        // Transferir: a sugestão preenche o número.
        await page.getByRole('button', { name: 'Transferir', exact: true }).click();
        const transferir = page.getByRole('textbox', { name: 'Número para transferir' });
        await transferir.fill('988');
        await expect(sugestoes.locator('.row-title')).toHaveText(['Ana Souza']);
        await expect(sugestoes.locator('.row-sub')).toHaveText(['Contato · +55 11 98888-7777']);
        await sugestoes.click();
        await expect(transferir).toHaveValue('+55 11 98888-7777');
        await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
        // Nova ligação: a sugestão liga, com a regra dos contatos.
        await page.getByRole('button', { name: 'Nova ligação', exact: true }).click();
        await page.getByRole('textbox', { name: 'Número da nova ligação' }).fill('2000');
        await expect(sugestoes.locator('.row-title')).toHaveText(['Portaria']);
        await sugestoes.click();
        await esperarComando(page, { cmd: 'dial', numero: '2000', contato: true });
      });
    });
  }
}
