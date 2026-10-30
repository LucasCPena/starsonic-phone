// A agenda grande e bagunçada na aba Contatos do iPhone (Review Focus 1 da etapa 2): 5.000 contatos, com acentos, nomes
// vazios, contatos sem número e números repetidos. A aba abre e a busca responde em até 1 s, na ordem do português, cada
// número repetido aparece uma vez, e um estado novo ou a mesma agenda lida de novo não refazem a lista. Num arquivo
// próprio, como o contatos-lista-grande.spec.ts: o trace do Playwright tira uma foto do DOM inteiro (uns 60.000 nós com
// a lista cheia) a cada passo, e o `trace` só se desliga no arquivo inteiro. Só seletores CSS aqui (o getByRole varre os
// milhares de botões), e os tempos medidos dentro da página.
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

test('5,000 agenda contacts: the tab opens and the search answers within 1 s, in Portuguese order, each repeated number once', async ({ page }) => {
  await abrirIos(page, 'principal', TAMANHO);
  const agenda = agendaGrande();
  const comNumero = agenda.filter((c) => c.numeros.length > 0).length;
  // O núcleo leu a agenda (o SetAgenda): a lista e o estado com a `vez` seguinte e a contagem.
  await page.evaluate((contatos) => {
    const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
    const s = fake.state();
    const vez = s.agenda.vez + 1;
    fake.push({ v: 1, type: 'agenda', vez, contatos });
    fake.push({ v: 1, type: 'state', state: { ...s, agenda: { permissao: 'concedida', vez, quantos: contatos.filter((c) => c.numeros.length > 0).length } } });
  }, agenda);
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

  // A busca responde em até 1 s: pelo nome sem acento, pelos dígitos e de volta a todos.
  const conceicoes = agenda.filter((c) => c.numeros.length > 0 && c.nome.startsWith('Conceição')).length;
  for (const [texto, linhas] of [
    ['conceicao', conceicoes],
    ['943215678', 1],
    ['', comNumero],
  ] as const) {
    const ms = await buscarMedindo(page, texto, linhas);
    expect(ms, `"${texto}" em ${Math.round(ms)} ms`).toBeLessThan(1000);
  }
  await buscarMedindo(page, '943215678', 1);
  await expect(page.locator('main li.row .row-title')).toHaveText(['ana 4321']);
  await buscarMedindo(page, '', comNumero);

  // Um estado novo e a mesma agenda lida de novo (outra `vez`, a mesma lista) com a aba aberta não refazem as linhas:
  // com as linhas prontas reaproveitadas, uns 10 ms aqui; refazendo, a ordem e as milhares de linhas outra vez.
  const medir = (mesmaAgenda: boolean) =>
    page.evaluate(
      async ({ mesmaAgenda, agenda }) => {
        const fake = (window as unknown as { __fake: { state(): Record<string, any>; push(m: unknown): void } }).__fake;
        const medidas: number[] = [];
        for (let i = 0; i < 7; i++) {
          const s = fake.state();
          const t0 = performance.now();
          if (mesmaAgenda) {
            const vez = s.agenda.vez + 1;
            fake.push({ v: 1, type: 'agenda', vez, contatos: agenda });
            fake.push({ v: 1, type: 'state', state: { ...s, agenda: { ...s.agenda, vez } } });
          } else {
            fake.push({ v: 1, type: 'state', state: { ...s, perdidas: s.perdidas + 1 } });
          }
          // Cada mensagem chega numa tarefa e o Preact desenha logo depois dela: a tarefa seguinte já vê a tela nova.
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
          medidas.push(performance.now() - t0);
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        }
        return medidas.sort((a, b) => a - b);
      },
      { mesmaAgenda, agenda },
    );
  for (const mesmaAgenda of [false, true]) {
    const tempos = await medir(mesmaAgenda);
    expect(tempos[3], `${mesmaAgenda ? 'a mesma agenda' : 'um estado novo'}: ${tempos.map((t) => Math.round(t)).join(', ')} ms`).toBeLessThan(50);
  }
  await expect(page.locator('main li.row')).toHaveCount(comNumero);

  // Um contato sem nome, de um número só, liga por ele; um com dois números (o celular e o ramal) pergunta.
  await linha(page, '(11) 90050-9949').locator('.row-hit').click();
  await esperarComando(page, { cmd: 'dial', numero: '(11) 90050-9949', contato: true });
  await linha(page, 'Élcio 0021').locator('.row-hit').click();
  await expect(page.locator('dialog[open] button')).toHaveText(['(11) 90021-9978', 'Ramal 3021', 'Cancelar']);
});
