// A agenda grande e bagunçada na aba Contatos do iPhone (Review Focus 1 da etapa 2): 5.000 contatos, com acentos, nomes
// vazios, contatos sem número e números repetidos. A aba abre e a busca responde em até 1 s, na ordem do português, cada
// número repetido aparece uma vez, e um estado novo ou a mesma agenda lida de novo não refazem a lista. Acima de 1.000
// linhas na tela, as de fora da tela ficam sem o estilo e o layout (a classe agenda-grande); com até 1.000 (uma agenda de
// algumas centenas, ou uma busca), cada botão de ligar fica na árvore de acessibilidade do Chromium (lida pelo CDP: o
// getByRole do Playwright vê o DOM, e não a árvore). Num arquivo próprio, como o contatos-lista-grande.spec.ts: o trace
// do Playwright tira uma foto do DOM inteiro (uns 60.000 nós com a lista cheia) a cada passo, e o `trace` só se desliga
// no arquivo inteiro. Só seletores CSS na lista grande (o getByRole varre os milhares de botões), e os tempos medidos
// dentro da página.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AgendaContact } from '../src/state';
import { esperarComando } from './helpers';
import { abrirIos, noIphone, TAMANHOS_IPHONE } from './ios-helpers';

const TAMANHO = TAMANHOS_IPHONE[1];
test.use({ ...noIphone(TAMANHO), trace: 'off' });

/** Os nomes da agenda grande (o primeiro de cada um, com os acentos; a "ana" em minúsculas). */
const PRENOMES = ['Álvaro', 'ana', 'Ângela', 'Beatriz', 'Cecília', 'Élcio', 'Érica', 'Íris', 'João', 'José', 'Luís', 'Mônica', 'Otávio', 'Úrsula', 'Zélia', 'Conceição'];

/**
 * A agenda inventada, na ordem em que o iPhone a entregaria: 5.000 contatos, cada um com um celular próprio e (1 a cada
 * 3) um ramal; 1 a cada 50 sem nome; 1 a cada 100 sem nenhum número (fora da lista: os "Sem Número"); e 1 a cada 7 com o
 * mesmo celular repetido em outros formatos (os mesmos dígitos: aparece uma vez).
 */
function agendaGrande(): AgendaContact[] {
  return Array.from({ length: 5000 }, (_, i) => {
    const sufixo = String(i).padStart(4, '0');
    if (i % 100 === 1) return { nome: `Sem Número ${sufixo}`, numeros: [] };
    const fim = String(9999 - i).padStart(4, '0');
    const celular = `(11) 9${sufixo}-${fim}`;
    const numeros = [celular];
    if (i % 7 === 0) numeros.push(`119${sufixo}${fim}`, `  ${celular}  `, `11 9${sufixo} ${fim}`);
    if (i % 3 === 0) numeros.push(String(3000 + i));
    return { nome: i % 50 === 0 ? '' : `${PRENOMES[i % PRENOMES.length]} ${sufixo}`, numeros };
  });
}

/** O núcleo leu a agenda (o SetAgenda): a lista e o estado com a `vez` seguinte e a contagem, de uma vez só na página. */
async function novaAgenda(page: Page, contatos: AgendaContact[]): Promise<void> {
  await page.evaluate((contatos) => {
    const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
    const s = fake.state();
    const vez = s.agenda.vez + 1;
    fake.push({ v: 1, type: 'agenda', vez, contatos });
    fake.push({ v: 1, type: 'state', state: { ...s, agenda: { permissao: 'concedida', vez, quantos: contatos.filter((c) => c.numeros.length > 0).length } } });
  }, contatos);
}

/** A linha de um contato, pelo título (o nome, ou o primeiro número num contato sem nome). */
function linha(page: Page, titulo: string): Locator {
  return page.locator('main li.row').filter({ has: page.locator('.row-title').getByText(titulo, { exact: true }) });
}

/** Os títulos de um grupo, na ordem da tela. */
function grupo(page: Page, letra: string): Promise<string[]> {
  return page.locator(`main section[aria-label="${letra}"] .row-title`).allTextContents();
}

/** O primeiro nome de cada título, sem os repetidos em seguida: a ordem dos prenomes dentro de um grupo. */
function emSeguida(titulos: string[]): string[] {
  const primeiras = titulos.map((t) => t.split(' ')[0]);
  return primeiras.filter((p, i) => i === 0 || p !== primeiras[i - 1]);
}

/** O content-visibility calculado de cada linha da lista, e quantas linhas têm cada valor. */
function contencao(page: Page): Promise<Record<string, number>> {
  return page.locator('main li.row').evaluateAll((linhas) => {
    const valores: Record<string, number> = {};
    for (const l of linhas) {
      const v = getComputedStyle(l).contentVisibility;
      valores[v] = (valores[v] ?? 0) + 1;
    }
    return valores;
  });
}

/** Os botões "Ligar para <prefixo>…" na árvore de acessibilidade do próprio Chromium (os não ignorados), pelo CDP. */
async function ligarNaArvore(page: Page, prefixo: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return nodes.filter((n) => !n.ignored && n.role?.value === 'button' && String(n.name?.value ?? '').startsWith(`Ligar para ${prefixo}`)).length;
}

/**
 * Conta as comparações do Intl.Collator da página (a ordem do português, no format.ts), antes de a página carregar:
 * nenhuma comparação quer dizer que nenhuma lista foi ordenada de novo.
 */
async function contarComparacoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __comparacoes: number };
    w.__comparacoes = 0;
    const original = Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')!;
    Object.defineProperty(Intl.Collator.prototype, 'compare', {
      configurable: true,
      get() {
        const comparar = original.get!.call(this) as (a: string, b: string) => number;
        return (a: string, b: string) => {
          w.__comparacoes++;
          return comparar(a, b);
        };
      },
    });
  });
}

/**
 * O núcleo manda uma lista da agenda (a `vez` seguinte) e o estado, e um aviso depois deles. Dentro da página, até o
 * aviso aparecer (as mensagens chegam na ordem): o que mudou na aba (as mudanças, e os títulos das linhas que saem e das
 * que entram, por um MutationObserver no <main>: ele vê também a lista montada de novo inteira, que tira o .agenda de
 * antes) e quantas comparações do Intl.Collator a página fez.
 */
function mandarObservando(page: Page, contatos: AgendaContact[]): Promise<{ mudancas: number; saem: string[]; entram: string[]; comparacoes: number }> {
  return page.evaluate(async (contatos) => {
    const w = window as unknown as { __comparacoes: number; __fake: { state(): Record<string, any>; push(m: unknown): void } };
    const visto = { mudancas: 0, saem: [] as string[], entram: [] as string[] };
    const titulo = (n: Node) => (n instanceof HTMLElement && n.matches('li.row') ? (n.querySelector('.row-title')?.textContent ?? '') : null);
    const anotar = (registros: MutationRecord[]) => {
      for (const r of registros) {
        visto.mudancas++;
        for (const n of r.removedNodes) if (titulo(n) !== null) visto.saem.push(titulo(n)!);
        for (const n of r.addedNodes) if (titulo(n) !== null) visto.entram.push(titulo(n)!);
      }
    };
    const observador = new MutationObserver(anotar);
    observador.observe(document.querySelector('main')!, { childList: true, subtree: true, characterData: true, attributes: true });
    w.__comparacoes = 0;
    const s = w.__fake.state();
    const vez = s.agenda.vez + 1;
    const marca = `Agenda ${vez} lida.`;
    w.__fake.push({ v: 1, type: 'agenda', vez, contatos });
    w.__fake.push({ v: 1, type: 'state', state: { ...s, agenda: { ...s.agenda, vez, quantos: contatos.filter((c) => c.numeros.length > 0).length } } });
    w.__fake.push({ v: 1, type: 'toast', texto: marca });
    while (document.querySelector('.toast-box')?.textContent !== marca) await new Promise((r) => setTimeout(r, 0));
    anotar(observador.takeRecords());
    observador.disconnect();
    return { ...visto, comparacoes: w.__comparacoes };
  }, contatos);
}

/** Toca na aba Contatos da navegação e mede, dentro da página, até ela ter `linhas` linhas. */
function abrirMedindo(page: Page, linhas: number): Promise<number> {
  return page.evaluate(async (linhas) => {
    const t0 = performance.now();
    document.querySelector<HTMLButtonElement>('.nav .tab-contatos')!.click();
    while (document.querySelectorAll('main li.row').length !== linhas) {
      if (performance.now() - t0 > 10_000) throw new Error(`${document.querySelectorAll('main li.row').length} linhas`);
      await new Promise((r) => setTimeout(r, 0));
    }
    return performance.now() - t0;
  }, linhas);
}

/** Escreve na busca e mede, dentro da página, até a lista ter `linhas` linhas. */
function buscarMedindo(page: Page, texto: string, linhas: number): Promise<number> {
  return page.evaluate(
    async ({ texto, linhas }) => {
      const campo = document.querySelector<HTMLInputElement>('main input[type="search"]')!;
      const t0 = performance.now();
      campo.value = texto;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      while (document.querySelectorAll('main li.row').length !== linhas) {
        if (performance.now() - t0 > 10_000) throw new Error(`${texto}: ${document.querySelectorAll('main li.row').length} linhas`);
        await new Promise((r) => setTimeout(r, 0));
      }
      return performance.now() - t0;
    },
    { texto, linhas },
  );
}

test('600 agenda contacts keep every call button in the accessibility tree', async ({ page }) => {
  // Uma agenda de algumas centenas (até 1.000 linhas na tela): sem a contenção da lista grande.
  await abrirIos(page, 'principal', TAMANHO);
  const agenda = Array.from({ length: 600 }, (_, i) => ({ nome: `Pessoa ${String(i).padStart(4, '0')}`, numeros: [`(11) 9${String(i).padStart(4, '0')}-0000`] }));
  await novaAgenda(page, agenda);
  await page.locator('.nav .tab-contatos').click();
  await expect(page.locator('main li.row')).toHaveCount(600);
  await expect(page.locator('main .agenda')).not.toHaveClass(/\bagenda-grande\b/);
  expect(await contencao(page)).toEqual({ visible: 600 });
  // Cada botão de ligar, também os das linhas fora da tela, na árvore do Chromium e pelo papel.
  await expect.poll(() => ligarNaArvore(page, 'Pessoa')).toBe(600);
  await expect(page.getByRole('button', { name: /^Ligar para Pessoa/ })).toHaveCount(600);
});

test('5,000 agenda contacts: the tab opens and the search answers within 1 s, in Portuguese order, each repeated number once', async ({ page }) => {
  await contarComparacoes(page);
  await abrirIos(page, 'principal', TAMANHO);
  const agenda = agendaGrande();
  const comNumero = agenda.filter((c) => c.numeros.length > 0).length;
  await novaAgenda(page, agenda);
  // A lista chegou: o Teclado já sugere o celular de um deles.
  await page.locator('input.number-text').fill('943215678');
  await expect(page.locator('.suggest .row-title')).toHaveText(['ana 4321']);

  // A aba abre em até 1 s, do toque até as linhas na tela; de novo, depois do Teclado (a agenda lida outra vez).
  const primeira = await abrirMedindo(page, comNumero);
  expect(primeira, `a aba abriu em ${Math.round(primeira)} ms`).toBeLessThan(1000);
  await esperarComando(page, { cmd: 'contactsOpened' });
  await page.locator('.nav .tab-teclado').click();
  await expect(page.locator('main li.row')).toHaveCount(0);
  const segunda = await abrirMedindo(page, comNumero);
  expect(segunda, `a aba abriu de novo em ${Math.round(segunda)} ms`).toBeLessThan(1000);
  // Mais de 1.000 linhas na tela: as de fora da tela ficam sem o estilo e o layout.
  await expect(page.locator('main .agenda')).toHaveClass(/\bagenda-grande\b/);
  expect(await contencao(page)).toEqual({ auto: comNumero });

  // A ordem do português: o "#" (os sem nome, pelo primeiro número) e depois as letras, cada grupo uma vez; no grupo, os
  // acentos no lugar da letra deles e a caixa sem contar.
  await expect(page.locator('main h2.group')).toHaveText(['#', 'A', 'B', 'C', 'E', 'I', 'J', 'L', 'M', 'O', 'U', 'Z']);
  expect(emSeguida(await grupo(page, 'A'))).toEqual(['Álvaro', 'ana', 'Ângela']);
  expect(emSeguida(await grupo(page, 'C'))).toEqual(['Cecília', 'Conceição']);
  expect(emSeguida(await grupo(page, 'E'))).toEqual(['Élcio', 'Érica']);
  expect(emSeguida(await grupo(page, 'J'))).toEqual(['João', 'José']);
  expect((await grupo(page, 'A')).slice(0, 3)).toEqual(['Álvaro 0016', 'Álvaro 0032', 'Álvaro 0048']);
  const semNome = await grupo(page, '#');
  expect(semNome.length).toBe(100);
  expect(semNome.slice(0, 3)).toEqual(['(11) 90000-9999', '(11) 90050-9949', '(11) 90100-9899']);
  await expect(page.locator('main section[aria-label="#"] li.row .avatar').first()).toHaveText('?');
  // Cada número repetido aparece uma vez (o primeiro formato), e nenhum contato sem número.
  await expect(linha(page, 'Íris 0007').locator('.row-sub')).toHaveText('(11) 90007-9992');
  await expect(linha(page, 'Élcio 0021').locator('.row-sub')).toHaveText('(11) 90021-9978 · Ramal 3021');
  await expect(linha(page, '(11) 90000-9999').locator('.row-sub')).toHaveText('(11) 90000-9999 · Ramal 3000');
  await expect(page.locator('main li.row', { hasText: 'Sem Número' })).toHaveCount(0);

  // A busca responde em até 1 s: pelo nome sem acento, pelos dígitos e de volta a todos. A que deixa até 1.000 linhas
  // tira a contenção: cada botão de ligar delas fica na árvore de acessibilidade; de volta a todos, ela volta.
  const conceicoes = agenda.filter((c) => c.numeros.length > 0 && c.nome.startsWith('Conceição')).length;
  const msNome = await buscarMedindo(page, 'conceicao', conceicoes);
  expect(msNome, `"conceicao" em ${Math.round(msNome)} ms`).toBeLessThan(1000);
  await expect(page.locator('main .agenda')).not.toHaveClass(/\bagenda-grande\b/);
  expect(await contencao(page)).toEqual({ visible: conceicoes });
  await expect.poll(() => ligarNaArvore(page, 'Conceição')).toBe(conceicoes);
  const msDigitos = await buscarMedindo(page, '943215678', 1);
  expect(msDigitos, `"943215678" em ${Math.round(msDigitos)} ms`).toBeLessThan(1000);
  await expect(page.locator('main li.row .row-title')).toHaveText(['ana 4321']);
  const msTodos = await buscarMedindo(page, '', comNumero);
  expect(msTodos, `"" em ${Math.round(msTodos)} ms`).toBeLessThan(1000);
  await expect(page.locator('main .agenda')).toHaveClass(/\bagenda-grande\b/);

  // Um estado novo com a aba aberta não refaz as linhas: com as linhas prontas reaproveitadas, a mediana de sete fica em
  // 1 ou 2 ms aqui; refazendo as milhares de linhas outra vez (sem o vnode guardado de cada linha), passa dos 20 ms (de
  // 24 a 46 ms aqui, e a mais rápida das sete em 22 ms). O limite de 20 ms fica uns 10 vezes acima do tempo de agora e
  // abaixo de todo tempo sem as linhas guardadas.
  const tempos = await page.evaluate(async () => {
    const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
    const medidas: number[] = [];
    for (let i = 0; i < 7; i++) {
      const s = fake.state();
      const t0 = performance.now();
      fake.push({ v: 1, type: 'state', state: { ...s, perdidas: s.perdidas + 1 } });
      // A mensagem chega numa tarefa e o Preact desenha logo depois dela: a tarefa seguinte já vê a tela nova.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      medidas.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    return medidas.sort((a, b) => a - b);
  });
  expect(tempos[3], `um estado novo: ${tempos.map((t) => Math.round(t)).join(', ')} ms`).toBeLessThan(20);

  // A mesma agenda lida de novo (outra `vez`, a mesma lista: a aba que abre) não refaz nada: nenhuma mudança na lista e
  // nenhuma lista ordenada de novo. Uma agenda diferente (um contato com outro nome) troca só a linha dele, e a lista nova
  // é ordenada.
  expect(await mandarObservando(page, agenda)).toEqual({ mudancas: 0, saem: [], entram: [], comparacoes: 0 });
  const outra = agenda.map((c) => (c.nome === 'Íris 0007' ? { ...c, nome: 'Íris 0007 B' } : c));
  const trocada = await mandarObservando(page, outra);
  expect(trocada).toMatchObject({ saem: ['Íris 0007'], entram: ['Íris 0007 B'] });
  expect(trocada.comparacoes).toBeGreaterThan(0);
  await expect(page.locator('main li.row')).toHaveCount(comNumero);

  // Um contato sem nome, de um número só, liga por ele; um com dois números (o celular e o ramal) pergunta.
  await linha(page, '(11) 90050-9949').locator('.row-hit').click();
  await esperarComando(page, { cmd: 'dial', numero: '(11) 90050-9949', contato: true });
  await linha(page, 'Élcio 0021').locator('.row-hit').click();
  await expect(page.locator('dialog[open] button')).toHaveText(['(11) 90021-9978', 'Ramal 3021', 'Cancelar']);
});
