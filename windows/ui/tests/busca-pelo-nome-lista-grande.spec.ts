// (rc.6) A lista da empresa no máximo da planilha (rc.4, spec 6.3: 10.000 contatos) no painel do Transferir e no
// Teclado: abrir o painel e digitar não travam. Conferido contando o trabalho, como nos testes da aba Contatos: a junção,
// a ordem e a busca usam o que cada linha já tem calculado (nenhum nome dobrado de novo, nenhuma lista ordenada de novo ao
// abrir o painel outra vez nem ao digitar: o String.prototype.normalize e o Array.prototype.sort das listas grandes da
// página contados), a lista do painel entra em pedaços (o primeiro logo, nenhum desenho com mais de um pedaço, e no fim
// todas as linhas, cada uma uma vez e na ordem) e um estado novo ou o relógio da ligação não mexem nela (um
// MutationObserver). Os tempos ficam só anotados. Num arquivo próprio, como o contatos-lista-grande.spec.ts: o trace do
// Playwright tira uma foto do DOM inteiro a cada passo, e o `trace` só se desliga no arquivo inteiro. Só seletores CSS na
// lista grande (o getByRole varre os milhares de linhas).
import { expect, test, type Page } from '@playwright/test';
import { abrir, empurrar, esperarComando, mudarEstado } from './helpers';

test.use({ trace: 'off' });

/** O primeiro pedaço e os seguintes da lista do painel (o PRIMEIRO_PEDACO e o PEDACO do Ligacao.tsx). */
const PRIMEIRO_PEDACO = 100;
const PEDACO = 200;

/** Os meus contatos do cenário, em ordem. */
const MEUS = ['Ana Souza', 'Atendimento Starsonic', 'Carlos Lima', 'Financeiro'];

/** As três letras do contato `i` da empresa (AAA, AAB, …, OPW): a busca pelo nome, sem nenhum dígito no texto. */
function letras(i: number): string {
  return [Math.floor(i / 676), Math.floor(i / 26) % 26, i % 26].map((n) => String.fromCharCode(65 + n)).join('');
}

/**
 * 10.000 da empresa, o `i` com o nome "Contato <letras>" e o ramal 30000 + i, na planilha de trás para a frente (a tela
 * ordena); um deles é a Ana Souza 2003, que também é minha: fica a minha.
 */
function muitos(): Array<{ nome: string; numero: string; observacao: string }> {
  const lista = Array.from({ length: 10_000 }, (_, i) => ({
    nome: `Contato ${letras(i)}`,
    numero: String(30_000 + i),
    observacao: i % 2 ? 'Galpão' : '',
  }));
  lista[1234] = { nome: 'Ana Souza', numero: '2003', observacao: '' };
  return lista.reverse();
}

/** A lista inteira do painel, na ordem: os meus (com os "Contato" da empresa no C) e os 9.999 da empresa, de A a Z. */
function emOrdem(): string[] {
  const daEmpresa = Array.from({ length: 10_000 }, (_, i) => `Contato ${letras(i)}`).filter((_, i) => i !== 1234);
  return ['Ana Souza', 'Atendimento Starsonic', 'Carlos Lima', ...daEmpresa, 'Financeiro'];
}
const TOTAL = 9_999 + MEUS.length;

/** Conta, antes de a página carregar, os nomes dobrados (o normalize do fold) e as listas grandes ordenadas. */
async function contarTrabalho(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __trabalho: { dobras: number; ordenacoes: number } };
    w.__trabalho = { dobras: 0, ordenacoes: 0 };
    const normalize = String.prototype.normalize;
    String.prototype.normalize = function (this: string, forma?: string) {
      w.__trabalho.dobras++;
      return normalize.call(this, forma);
    };
    const sort = Array.prototype.sort;
    Array.prototype.sort = function <T>(this: T[], comparar?: (a: T, b: T) => number): T[] {
      if (this.length >= 1000) w.__trabalho.ordenacoes++;
      return sort.call(this, comparar) as T[];
    };
  });
}

async function trabalho(page: Page): Promise<{ dobras: number; ordenacoes: number }> {
  return page.evaluate(() => ({ ...(window as unknown as { __trabalho: { dobras: number; ordenacoes: number } }).__trabalho }));
}

async function zerarTrabalho(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __trabalho: { dobras: number; ordenacoes: number } }).__trabalho = { dobras: 0, ordenacoes: 0 };
  });
}

async function comListaGrande(page: Page): Promise<void> {
  await mudarEstado(page, (s) => ({
    ...s,
    empresa: { link: '\\\\servidor\\contatos\\empresa.xlsx', situacao: 'ok', erro: '', atualizadaEm: Date.now(), quantos: 10_000, vez: 1 },
  }));
  await empurrar(page, { v: 1, type: 'contatosEmpresa', vez: 1, contatos: muitos() });
}

/**
 * Toca no controle `nome` da ligação e acompanha, dentro da página, o desenho da lista em pedaços até ela ter `linhas`
 * linhas: quantas o primeiro desenho pôs na tela, o maior número de linhas que um desenho pôs de uma vez (um
 * MutationObserver vê cada desenho inteiro, antes do seguinte), quantos desenhos e os tempos.
 */
function abrirEmPedacos(page: Page, nome: string, linhas: number): Promise<{ primeiro: number; maior: number; desenhos: number; msPrimeiro: number; msTodas: number }> {
  return page.evaluate(
    async ({ nome, linhas }) => {
      const contar = () => document.querySelectorAll('.call-panel [role="option"]').length;
      const visto = { primeiro: 0, maior: 0, desenhos: 0, msPrimeiro: 0 };
      let antes = contar();
      const t0 = performance.now();
      const observador = new MutationObserver(() => {
        const n = contar();
        if (n === antes) return;
        visto.maior = Math.max(visto.maior, n - antes);
        antes = n;
        visto.desenhos++;
        if (visto.primeiro === 0) {
          visto.primeiro = n;
          visto.msPrimeiro = performance.now() - t0;
        }
      });
      observador.observe(document.body, { childList: true, subtree: true });
      [...document.querySelectorAll<HTMLButtonElement>('button.ctrl')].find((b) => b.textContent?.trim() === nome)!.click();
      while (contar() !== linhas) {
        if (performance.now() - t0 > 30_000) throw new Error(`${contar()} linhas`);
        await new Promise((r) => setTimeout(r, 0));
      }
      const msTodas = performance.now() - t0;
      observador.disconnect();
      return { ...visto, msTodas };
    },
    { nome, linhas },
  );
}

/**
 * Escreve no campo do painel e espera, dentro da página, a lista ter `linhas` linhas (0: o texto de nada achado): o tempo
 * e o maior número de linhas que um desenho pôs na tela de uma vez (um MutationObserver vê cada desenho inteiro).
 */
function buscar(page: Page, texto: string, linhas: number): Promise<{ ms: number; maior: number }> {
  return page.evaluate(
    async ({ texto, linhas }) => {
      const contar = () => document.querySelectorAll('.call-panel [role="option"]').length;
      let maior = 0;
      let antes = 0;
      const observador = new MutationObserver(() => {
        const n = contar();
        // Uma lista nova na tela começa do zero (a de antes sai inteira).
        maior = Math.max(maior, n - Math.min(antes, n));
        antes = n;
      });
      observador.observe(document.body, { childList: true, subtree: true });
      const campo = document.querySelector<HTMLInputElement>('.call-panel input')!;
      const t0 = performance.now();
      campo.value = texto;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      while (contar() !== linhas) {
        if (performance.now() - t0 > 30_000) throw new Error(`${texto}: ${contar()} linhas`);
        await new Promise((r) => setTimeout(r, 0));
      }
      observador.disconnect();
      return { ms: performance.now() - t0, maior };
    },
    { texto, linhas },
  );
}

function titulos(page: Page): Promise<string[]> {
  return page.locator('.call-panel [role="option"] .row-title').allTextContents();
}

test('10,000 company contacts: the Transferir panel opens in pieces, finds by name and number and never redoes the rows', async ({ page }) => {
  await contarTrabalho(page);
  await abrir(page, 'ligacao');
  await comListaGrande(page);

  // A primeira vez: a lista do painel entra em pedaços, o primeiro logo; no fim, todas, cada uma uma vez e na ordem.
  const aberto = await abrirEmPedacos(page, 'Transferir', TOTAL);
  const tempos = `o primeiro desenho com ${aberto.primeiro} linhas em ${Math.round(aberto.msPrimeiro)} ms; as ${TOTAL} em ${Math.round(aberto.msTodas)} ms, em ${aberto.desenhos} desenhos`;
  test.info().annotations.push({ type: 'tempos', description: tempos });
  expect(aberto.primeiro, tempos).toBeGreaterThan(0);
  expect(aberto.primeiro, tempos).toBeLessThanOrEqual(PRIMEIRO_PEDACO);
  expect(aberto.maior, tempos).toBeLessThanOrEqual(PEDACO);
  expect(aberto.desenhos, tempos).toBeGreaterThan(1);
  expect(await titulos(page)).toEqual(emOrdem());
  await expect(page.locator('.call-panel [role="option"] .row-sub').nth(3)).toHaveText('Empresa · 30000');

  // Aberto de novo, o painel não dobra os nomes nem ordena a lista outra vez (o do campo vazio, no máximo).
  await page.locator('.call-panel button.btn-ghost-dark').click();
  await expect(page.locator('.call-panel')).toHaveCount(0);
  await zerarTrabalho(page);
  const reaberto = await abrirEmPedacos(page, 'Transferir', TOTAL);
  expect(reaberto.primeiro).toBeLessThanOrEqual(PRIMEIRO_PEDACO);
  expect(reaberto.maior).toBeLessThanOrEqual(PEDACO);
  let feito = await trabalho(page);
  expect(feito.ordenacoes, 'uma lista grande ordenada de novo').toBe(0);
  expect(feito.dobras, 'nomes dobrados de novo').toBeLessThanOrEqual(2);

  // A busca olha a lista inteira na hora, também no meio dos pedaços: pelo número, pelo nome e nada; de volta a todos,
  // em pedaços de novo. Só o texto digitado é dobrado.
  await page.locator('.call-panel button.btn-ghost-dark').click();
  await zerarTrabalho(page);
  await abrirEmPedacos(page, 'Transferir', TOTAL);
  const ms: Record<string, number> = {};
  ms['39876'] = (await buscar(page, '39876', 1)).ms;
  expect(await titulos(page)).toEqual(['Contato OPW']);
  ms['contato op'] = (await buscar(page, 'contato op', 26)).ms;
  expect(await titulos(page)).toEqual(Array.from({ length: 26 }, (_, i) => `Contato OP${String.fromCharCode(65 + i)}`));
  ms['zzz'] = (await buscar(page, 'zzz', 0)).ms;
  await expect(page.locator('.call-panel').getByText('Nenhum contato com esse nome', { exact: true })).toBeVisible();
  // De volta ao campo vazio (a mesma lista da abertura), a lista inteira de novo em pedaços, e não de uma vez.
  const todos = await buscar(page, '', TOTAL);
  ms[''] = todos.ms;
  test.info().annotations.push({ type: 'busca', description: Object.entries(ms).map(([t, v]) => `"${t}" em ${Math.round(v)} ms`).join('; ') });
  expect(todos.maior, 'a lista inteira de uma vez, de volta ao campo vazio').toBeLessThanOrEqual(PEDACO);
  feito = await trabalho(page);
  expect(feito.ordenacoes, 'uma lista grande ordenada de novo na busca').toBe(0);
  expect(feito.dobras, 'nomes dobrados de novo na busca').toBeLessThanOrEqual(10);
  expect(await titulos(page)).toEqual(emOrdem());

  // Um estado novo (um BLF, uma perdida) e o relógio da ligação, com o painel aberto e a lista inteira: nada muda nela.
  const mudancas = await page.evaluate(async () => {
    const lista = document.querySelector('.call-panel [role="listbox"]')!;
    let vistas = 0;
    const observador = new MutationObserver((registros) => (vistas += registros.length));
    observador.observe(lista, { childList: true, subtree: true, attributes: true, characterData: true });
    const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
    const s = fake.state();
    fake.push({ v: 1, type: 'state', state: { ...s, perdidas: s.perdidas + 1 } });
    // O relógio anda (a tela redesenha a cada segundo) e o estado chegou.
    const relogio = document.querySelector('.timer')?.textContent;
    const t0 = performance.now();
    while (document.querySelector('.timer')?.textContent === relogio && performance.now() - t0 < 5_000) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    observador.disconnect();
    return vistas + observador.takeRecords().length;
  });
  expect(mudancas, 'a lista mudou com um estado novo ou o relógio').toBe(0);
  await expect(page.locator('.call-panel [role="option"]')).toHaveCount(TOTAL);

  // O último da lista, lá embaixo, também se escolhe.
  const ultimo = page.locator('.call-panel [role="option"]').last();
  await ultimo.scrollIntoViewIfNeeded();
  await ultimo.click();
  await expect(page.locator('.call-panel .call-para')).toHaveText('Para: Financeiro · 2010');
  await page.locator('.call-panel .btn-cyan').click();
  await esperarComando(page, { cmd: 'transfer', numero: '2010', contato: true });
});

test('10,000 company contacts: the Teclado suggests by name and number without redoing the list', async ({ page }) => {
  await contarTrabalho(page);
  await abrir(page, 'principal');
  await comListaGrande(page);
  const numero = page.locator('input.number-text');
  const sugestoes = page.locator('.suggest .row-title');
  await numero.fill('contato op');
  await expect(sugestoes).toHaveText(['Contato OPA', 'Contato OPB', 'Contato OPC']);
  await expect(page.locator('.suggest .row-sub')).toHaveText(['Empresa · 39854', 'Empresa · 39855', 'Empresa · 39856']);
  // A lista já pronta: digitar de novo não dobra os nomes nem ordena a lista outra vez.
  await zerarTrabalho(page);
  await numero.fill('contato ab');
  await expect(sugestoes).toHaveText(['Contato ABA', 'Contato ABB', 'Contato ABC']);
  await numero.fill('39876');
  await expect(sugestoes).toHaveText(['Contato OPW']);
  await numero.fill('ana s');
  await expect(sugestoes).toHaveText(['Ana Souza']);
  const feito = await trabalho(page);
  expect(feito.ordenacoes, 'uma lista grande ordenada de novo').toBe(0);
  expect(feito.dobras, 'nomes dobrados de novo').toBeLessThanOrEqual(10);
  await numero.press('Enter');
  await esperarComando(page, { cmd: 'dial', numero: '2003', contato: true });
});
