// A aba Atalhos (rc.3, spec 3 e 4): até 8 atalhos em duas colunas, cada um com o ícone da ação, o nome, a ação e o
// número e o BLF (a palavra sempre ao lado da bolinha); "Adicionar atalho" nos espaços vazios e "<n> de 8" no alto. O
// clique usa o atalho (useShortcut); o botão direito, ou o "Mais opções" (⋯) pelo teclado, abre a edição. Na tela da
// ligação, o botão Atalhos abre o painel com os mesmos atalhos. A interface só manda os comandos: o que cada atalho
// faz (e o puxar ligação de um ramal tocando) é do C++.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECUSAS_DO_SALVAR } from '../src/recusas';
import {
  abrir,
  capturar,
  comandos,
  empurrar,
  entrarNaAdmin,
  esperarComando,
  estado,
  mudarEstado,
  segurarCpp,
  semViolacoesSerias,
  soltarCpp,
  verTextos,
} from './helpers';

const VERDE = 'rgb(34, 197, 94)'; // #22c55e
const CIANO = 'rgb(0, 194, 203)'; // #00c2cb
const VERMELHO = 'rgb(214, 69, 69)'; // #d64545
const CINZA = 'rgb(185, 196, 230)'; // #b9c4e6

// Os atalhos do cenário (os do canvas "Atalhos · aba nova").
const RECEPCAO = '5a1c0e9b2f3d4c67';
const FINANCEIRO = '0b2e7d4c1a9f3e58';
const SUPORTE = '7c3d9e1f5b2a4d60';
const COMERCIAL = '3e8f0a6b9c1d2e47';
const FILA = '9d4a2b7e6f0c1a35';

const NOMES = ['Recepção', 'Financeiro', 'Suporte', 'Comercial', 'Fila de espera', 'Celular plantão'];

/** O cartão de um atalho na aba (pelo nome). */
function cartao(page: Page, nome: string): Locator {
  return page.locator('li.atalho').filter({ has: page.locator('.atalho-nome').getByText(nome, { exact: true }) });
}

/** O botão que usa o atalho (o cartão inteiro, menos o "Mais opções"). */
function usar(page: Page, nome: string): Locator {
  return cartao(page, nome).locator('button.atalho-usar');
}

async function caixa(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'sem caixa: elemento invisível').not.toBeNull();
  return box!;
}

const nomeDoTema = (tema: 'light' | 'dark') => (tema === 'light' ? 'claro' : 'escuro');

/** Os motivos de recusa de `starsonic/desktop/Atalhos.cpp`: as constantes `kErr*` (ASCII, os acentos em \xNN de UTF-8). */
function motivosDaLoja(): string[] {
  const fonte = readFileSync(fileURLToPath(new URL('../../../starsonic/desktop/Atalhos.cpp', import.meta.url)), 'utf8');
  const motivos: string[] = [];
  for (const constante of fonte.matchAll(/const char kErr\w+\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);/g)) {
    const bytes: number[] = [];
    for (const literal of constante[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const corpo = literal[1];
      for (let i = 0; i < corpo.length; i++) {
        if (corpo[i] !== '\\') bytes.push(corpo.charCodeAt(i));
        else if (corpo[++i] === 'x') {
          bytes.push(parseInt(corpo.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(corpo.charCodeAt(i));
      }
    }
    motivos.push(Buffer.from(bytes).toString('utf8'));
  }
  return motivos;
}

const LAYOUTS: Array<[string, number, number]> = [
  ['normal', 400, 720],
  ['compacto', 340, 560],
  ['minimo', 300, 440],
];

for (const tema of ['light', 'dark'] as const) {
  for (const [layout, largura, altura] of LAYOUTS) {
    test.describe(`a aba Atalhos no ${layout} (${tema})`, () => {
      test.use({ viewport: { width: largura, height: altura }, colorScheme: tema });

      test('the Atalhos tab shows up to eight shortcuts with BLF word and color', async ({ page }) => {
        await abrir(page, 'atalhos');
        await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
        const aba = page.getByRole('main', { name: 'Atalhos' });
        await expect(aba.getByRole('heading', { name: 'Atalhos', level: 1 })).toBeVisible();
        await expect(aba.getByText('6 de 8', { exact: true })).toBeVisible();
        // Os seis atalhos na ordem, com a ação e o número; os dois espaços vazios com "Adicionar atalho".
        await expect(page.locator('li.atalho .atalho-nome')).toHaveText(NOMES);
        await expect(page.locator('li.atalho .atalho-detalhe')).toHaveText([
          'Ligar · 2000',
          'Transferir · 2010',
          'Consulta · 2007',
          'Ligar · 2003',
          'Enviar teclas · *88',
          'Ligar · 11988887777',
        ]);
        await expect(aba.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(2);
        // O administrador não ligou o puxar (nem pôs o código): a ajuda não promete que o clique puxa a ligação.
        await expect(aba.getByText('Clique para usar. Clique com o botão direito para editar.', { exact: true })).toBeAttached();

        // O BLF: a palavra inteira, logo à direita da bolinha da cor do estado, dentro do cartão.
        const blfs: Array<[string, string, string]> = [
          ['Recepção', 'Livre', VERDE],
          ['Financeiro', 'Ocupado', VERMELHO],
          ['Suporte', 'Tocando', CIANO],
          ['Comercial', 'Desconectado', CINZA],
        ];
        for (const [nome, palavra, cor] of blfs) {
          const c = cartao(page, nome);
          const blf = c.locator('.blf');
          await expect(blf, nome).toHaveText(palavra);
          const ponto = blf.locator('.blf-dot');
          expect(await ponto.evaluate((e) => getComputedStyle(e).backgroundColor), nome).toBe(cor);
          const p = await caixa(ponto);
          const w = await caixa(blf.locator('.blf-palavra'));
          const card = await caixa(c);
          expect(w.x, `${nome}: a palavra não está à direita da bolinha`).toBeGreaterThanOrEqual(p.x + p.width - 0.5);
          expect(Math.abs(w.y + w.height / 2 - (p.y + p.height / 2)), `${nome}: a palavra fora da linha da bolinha`).toBeLessThanOrEqual(3);
          expect(w.x + w.width, `${nome}: a palavra sai do cartão`).toBeLessThanOrEqual(card.x + card.width + 0.5);
          const cortada = await blf.locator('.blf-palavra').evaluate((e) => e.scrollWidth > e.clientWidth + 0.5);
          expect(cortada, `${nome}: a palavra está cortada`).toBe(false);
        }
        // Sem o BLF do atalho, nem a palavra nem a bolinha.
        for (const nome of ['Fila de espera', 'Celular plantão']) {
          await expect(cartao(page, nome).locator('.blf'), nome).toHaveCount(0);
          await expect(cartao(page, nome).locator('.blf-dot'), nome).toHaveCount(0);
        }

        // Duas colunas.
        const [a, b, c] = await Promise.all([0, 1, 2].map((i) => caixa(page.locator('li.atalho').nth(i))));
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.5);
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 0.5);
        expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 0.5);
        expect(Math.abs(c.x - a.x)).toBeLessThanOrEqual(0.5);

        // A navegação com as quatro abas (Atalhos marcada), inteira; a página não rola (só o corpo da aba, se precisar).
        const nav = page.getByRole('navigation', { name: 'Seções' });
        expect(await nav.locator('button.tab').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual([
          'Teclado',
          'Atalhos',
          'Recentes',
          'Contatos',
        ]);
        await expect(nav.getByRole('button', { name: 'Atalhos' })).toHaveAttribute('aria-current', 'page');
        const n = await caixa(nav);
        expect(n.y + n.height).toBeLessThanOrEqual(altura + 0.5);
        expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight), 'a página rola').toBeLessThanOrEqual(0.5);
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'a página rola na horizontal').toBeLessThanOrEqual(largura);

        await semViolacoesSerias(page);
        await capturar(page, `atalhos-${largura}x${altura}`, nomeDoTema(tema));
      });
    });
  }
}

// O "Mais opções" (⋯) de cada cartão fica no canto de baixo à direita, na linha do BLF: a linha do nome fica inteira
// para o nome, e ele não cobre o nome, a linha da ação e do número nem o BLF, em nenhum tamanho (os limites de cada
// layout: Normal de 380 a 600, Compacto de 330 a 379, Mínimo de 300 a 329).
interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cruzam(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

for (const [largura, altura] of [
  [400, 720],
  [380, 640],
  [600, 900],
  [379, 639],
  [340, 560],
  [330, 540],
  [329, 499],
  [300, 440],
] as Array<[number, number]>) {
  test(`the Mais opções button sits on the BLF line in the bottom-right corner and covers no text at ${largura}×${altura}`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'atalhos');
    const cartoes = await page.locator('li.atalho').evaluateAll((lis) =>
      lis.map((li) => {
        const caixa = (seletor: string) => {
          const e = li.querySelector(seletor);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const nome = li.querySelector('.atalho-nome') as HTMLElement;
        return {
          nome: nome.textContent ?? '',
          nomeCortado: nome.scrollWidth > nome.clientWidth + 0.5,
          cartao: caixa('.atalho-usar')!,
          mais: caixa('.atalho-mais')!,
          nomeBox: caixa('.atalho-nome')!,
          detalhe: caixa('.atalho-detalhe')!,
          palavra: caixa('.blf-palavra'),
          ponto: caixa('.blf-dot'),
        };
      }),
    );
    expect(cartoes).toHaveLength(6);
    for (const c of cartoes) {
      const { cartao: k, mais: m } = c;
      const dentro = m.x >= k.x - 0.5 && m.y >= k.y - 0.5 && m.x + m.w <= k.x + k.w + 0.5 && m.y + m.h <= k.y + k.h + 0.5;
      expect(dentro, `${c.nome}: o Mais opções sai do cartão ${JSON.stringify({ k, m })}`).toBe(true);
      expect(m.x + m.w / 2, `${c.nome}: o Mais opções não está à direita`).toBeGreaterThan(k.x + k.w / 2);
      expect(m.y + m.h / 2, `${c.nome}: o Mais opções não está embaixo`).toBeGreaterThan(k.y + k.h / 2);
      expect(Math.min(m.w, m.h), `${c.nome}: o Mais opções menor que 24 px`).toBeGreaterThanOrEqual(24);
      const partes: Array<[string, Caixa | null]> = [
        ['o nome', c.nomeBox],
        ['a linha da ação e do número', c.detalhe],
        ['a palavra do BLF', c.palavra],
        ['a bolinha do BLF', c.ponto],
      ];
      for (const [parte, box] of partes) {
        if (box) expect(cruzam(m, box), `${c.nome}: o Mais opções cobre ${parte} ${JSON.stringify({ m, box })}`).toBe(false);
      }
      // Na linha do BLF: abaixo da linha do número, na altura da palavra (quando o atalho tem o BLF).
      expect(m.y, `${c.nome}: o Mais opções não está abaixo da linha do número`).toBeGreaterThanOrEqual(c.detalhe.y + c.detalhe.h - 0.5);
      if (c.palavra) {
        expect(Math.abs(m.y + m.h / 2 - (c.palavra.y + c.palavra.h / 2)), `${c.nome}: o Mais opções fora da linha do BLF`).toBeLessThanOrEqual(2);
      }
    }
    // A linha do nome fica toda para o nome: "Fila de espera" cabe inteiro.
    expect(cartoes.find((c) => c.nome === 'Fila de espera')!.nomeCortado, '"Fila de espera" cortado').toBe(false);
  });
}

// O menu do "Mais opções" (Editar e Remover, de 170 px) abre inteiro dentro da janela nas duas colunas: o cartão da
// esquerda do Compacto e do Mínimo tem só 132 a 152 px, e o menu preso à borda direita dele saía pela esquerda da
// janela. Vale o canto da janela e o corpo da aba (o que o corpo corta, o clique não alcança).
for (const [largura, altura] of [
  [300, 440],
  [340, 560],
  [400, 720],
] as Array<[number, number]>) {
  test(`the Mais opções menu opens inside the window for a card in each column at ${largura}×${altura}`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'atalhos');
    for (const nome of NOMES) {
      await page.getByRole('button', { name: `Mais opções para ${nome}` }).click();
      const menu = page.getByRole('menu', { name: `Opções de ${nome}` });
      await expect(menu, nome).toBeVisible();
      const m = await caixa(menu);
      const onde = JSON.stringify(m);
      expect(m.x, `${nome}: o menu sai pela esquerda da janela ${onde}`).toBeGreaterThanOrEqual(-0.5);
      expect(m.x + m.width, `${nome}: o menu sai pela direita da janela ${onde}`).toBeLessThanOrEqual(largura + 0.5);
      expect(m.y, `${nome}: o menu sai por cima da janela ${onde}`).toBeGreaterThanOrEqual(-0.5);
      expect(m.y + m.height, `${nome}: o menu sai por baixo da janela ${onde}`).toBeLessThanOrEqual(altura + 0.5);
      // Inteiro à vista: nenhum canto dele é cortado pelo corpo da aba (o ponto de dentro acerta no menu).
      const inteiro = await menu.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return [
          [r.left + 10, r.top + 10],
          [r.right - 10, r.top + 10],
          [r.left + 10, r.bottom - 10],
          [r.right - 10, r.bottom - 10],
        ].every(([x, y]) => {
          const alvo = document.elementFromPoint(x, y);
          return alvo !== null && e.contains(alvo);
        });
      });
      expect(inteiro, `${nome}: o menu está cortado ${onde}`).toBe(true);
      await page.keyboard.press('Escape');
      await expect(menu, nome).toHaveCount(0);
    }
  });
}

test.describe('a aba Atalhos', () => {
  test('a click uses the shortcut, Enviar teclas waits for a call and the right button edits', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Recepção').click();
    await esperarComando(page, { cmd: 'useShortcut', id: RECEPCAO });
    await usar(page, 'Suporte').click();
    await esperarComando(page, { cmd: 'useShortcut', id: SUPORTE });

    // Enviar teclas fora da ligação: desativado (nada sai).
    const fila = usar(page, 'Fila de espera');
    await expect(fila).toBeDisabled();
    await fila.click({ force: true });
    await page.waitForTimeout(200);
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut').map((c) => c.id)).toEqual([RECEPCAO, SUPORTE]);

    // O botão direito abre a edição (também no desativado) e não usa o atalho.
    await fila.click({ button: 'right', force: true });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Fila de espera');
    await expect(page.getByLabel('Número', { exact: true })).toHaveValue('*88');
    await expect(page.getByRole('radio', { name: 'Enviar teclas' })).toBeChecked();
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toHaveLength(2);
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
  });

  test('the Mais opções menu edits and removes, and Remover asks first', async ({ page }) => {
    await abrir(page, 'atalhos');
    // Pelo teclado: o ⋯ do cartão abre o menu com Editar e Remover.
    await page.getByRole('button', { name: 'Mais opções para Comercial' }).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Opções de Comercial' });
    await expect(menu.getByRole('menuitem', { name: 'Editar' })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'Remover' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(page.getByLabel('Número', { exact: true })).toHaveValue('2003');
    await page.getByRole('button', { name: 'Voltar' }).click();

    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Remover' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Remover atalho' });
    await expect(dialogo).toContainText('Comercial sai da lista de atalhos.');
    // O botão de confirmar é o azul (como o de remover um contato).
    const confirmar = dialogo.getByRole('button', { name: 'Remover' });
    expect(await confirmar.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(12, 38, 113)');
    await semViolacoesSerias(page);
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toHaveCount(0);
    expect((await comandos(page)).some((c) => c.cmd === 'removeShortcut')).toBe(false);

    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Remover' }).click();
    await page.getByRole('dialog', { name: 'Remover atalho' }).getByRole('button', { name: 'Remover' }).click();
    await esperarComando(page, { cmd: 'removeShortcut', id: COMERCIAL });
    await expect(cartao(page, 'Comercial')).toHaveCount(0);
    await expect(page.getByText('5 de 8', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(3);
  });

  // A ajuda da aba (C-M5): a frase do puxar só aparece quando o clique num ramal tocando de fato puxa a ligação, ou seja,
  // com o `admin.puxa` (o BLF, o puxar e um código ligados). Sem isso, quem está numa ligação e confia na ajuda
  // transferiria a ligação dela, em vez de puxar a do colega.
  const AJUDA = 'Clique para usar. Clique com o botão direito para editar.';
  const AJUDA_COM_PUXAR = `${AJUDA} Num ramal tocando, o clique puxa a ligação.`;

  test('the help mentions the pickup only while admin.puxa is true', async ({ page }) => {
    await abrir(page, 'atalhos');
    const ajuda = page.getByRole('main', { name: 'Atalhos' }).locator('.atalhos-ajuda');
    await expect(ajuda).toHaveText(AJUDA);
    await mudarEstado(page, (s) => ({ ...s, admin: { ...s.admin, puxa: true } }));
    await expect(ajuda).toHaveText(AJUDA_COM_PUXAR);
    await mudarEstado(page, (s) => ({ ...s, admin: { ...s.admin, puxa: false } }));
    await expect(ajuda).toHaveText(AJUDA);
    // Sem o campo (um C++ que não o manda), e com algo que não é o booleano `true`: sem a frase.
    await mudarEstado(page, (s) => ({ ...s, admin: { ...s.admin, puxa: true } }));
    await expect(ajuda).toHaveText(AJUDA_COM_PUXAR);
    await mudarEstado(page, (s) => ({ ...s, admin: Object.fromEntries(Object.entries(s.admin).filter(([k]) => k !== 'puxa')) }));
    await expect(ajuda).toHaveText(AJUDA);
    await mudarEstado(page, (s) => ({ ...s, admin: { ...s.admin, puxa: 'true' } }));
    await expect(ajuda).toHaveText(AJUDA);
  });

  test('the fake bridge sets puxa only with BLF, the pickup and a code all on', async ({ page }) => {
    await abrir(page, 'atalhos');
    const ajuda = page.getByRole('main', { name: 'Atalhos' }).locator('.atalhos-ajuda');
    await expect(ajuda).toHaveText(AJUDA);
    await entrarNaAdmin(page);
    const puxar = page.getByRole('switch', { name: 'Puxar ligação pelo atalho' });
    const blf = page.getByRole('switch', { name: 'BLF nos atalhos' });
    const codigo = page.getByLabel('Código para puxar a ligação');
    const ajudaDepois = async (texto: string) => {
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(ajuda).toHaveText(texto);
      await page.keyboard.press('Control+KeyP');
      await expect(page.getByRole('heading', { name: 'Área do administrador', level: 1 })).toBeVisible();
    };
    // O BLF já estava ligado: o puxar sozinho, sem o código, não basta.
    await puxar.click();
    await esperarComando(page, { cmd: 'adminSet', puxar: true });
    await ajudaDepois(AJUDA);
    // Com o código, sim.
    await codigo.fill('**{ramal}');
    await codigo.press('Enter');
    await esperarComando(page, { cmd: 'adminSet', codigoPuxar: '**{ramal}' });
    await ajudaDepois(AJUDA_COM_PUXAR);
    // Sem o BLF dos atalhos, não puxa (o clique no atalho nem sabe que o ramal está tocando).
    await blf.click();
    await esperarComando(page, { cmd: 'adminSet', blf: false });
    await ajudaDepois(AJUDA);
    await blf.click();
    await esperarComando(page, { cmd: 'adminSet', blf: true });
    await ajudaDepois(AJUDA_COM_PUXAR);
    // O puxar desligado ou o código apagado: sem a frase.
    await puxar.click();
    await esperarComando(page, { cmd: 'adminSet', puxar: false });
    await ajudaDepois(AJUDA);
    await puxar.click();
    await esperarComando(page, { cmd: 'adminSet', puxar: true });
    await ajudaDepois(AJUDA_COM_PUXAR);
    await codigo.fill('');
    await codigo.press('Enter');
    await esperarComando(page, { cmd: 'adminSet', codigoPuxar: '' });
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(ajuda).toHaveText(AJUDA);
  });

  test('eight shortcuts fill the grid, and none leaves eight Adicionar atalho', async ({ page }) => {
    await abrir(page, 'atalhos');
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: [
        ...s.atalhos,
        { id: '1a2b3c4d5e6f7a8b', nome: 'Diretoria', numero: '2020', acao: 'ligar', blf: false, estado: null },
        { id: '8b7a6f5e4d3c2b1a', nome: 'Portaria', numero: '2030', acao: 'transferir', blf: true, estado: 'livre' },
      ],
    }));
    await expect(page.getByText('8 de 8', { exact: true })).toBeVisible();
    await expect(page.locator('li.atalho')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(0);
    await mudarEstado(page, (s) => ({ ...s, atalhos: [] }));
    await expect(page.getByText('0 de 8', { exact: true })).toBeVisible();
    await expect(page.locator('li.atalho')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar atalho', exact: true })).toHaveCount(8);
  });

  test('a shortcut without a BLF state shows neither the word nor the dot', async ({ page }) => {
    await abrir(page, 'atalhos');
    await expect(cartao(page, 'Recepção').locator('.blf')).toHaveText('Livre');
    // O C++ manda estado null (sem o BLF do administrador, por exemplo): nada de BLF, mesmo com o blf do atalho.
    await mudarEstado(page, (s) => ({ ...s, atalhos: s.atalhos.map((a: { id: string }) => (a.id === RECEPCAO ? { ...a, estado: null } : a)) }));
    await expect(cartao(page, 'Recepção').locator('.blf')).toHaveCount(0);
    await expect(cartao(page, 'Financeiro').locator('.blf')).toHaveText('Ocupado');
  });

  test('Tocando blinks slowly, the others do not, and reduced motion stops it', async ({ page }) => {
    await abrir(page, 'atalhos');
    const tocando = cartao(page, 'Suporte').locator('.blf-dot');
    const animacao = (l: Locator) =>
      l.evaluate((e) => {
        const s = getComputedStyle(e);
        return { nome: s.animationName, duracao: parseFloat(s.animationDuration), vezes: s.animationIterationCount };
      });
    const a = await animacao(tocando);
    expect(a.nome).not.toBe('none');
    expect(a.vezes).toBe('infinite');
    expect(a.duracao).toBeGreaterThanOrEqual(0.8);
    expect(a.duracao).toBeLessThanOrEqual(1.5);
    for (const nome of ['Recepção', 'Financeiro', 'Comercial']) {
      expect((await animacao(cartao(page, nome).locator('.blf-dot'))).nome, nome).toBe('none');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await animacao(tocando)).nome).toBe('none');
  });
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a edição do atalho (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('editing a shortcut saves name number action and blf', async ({ page }) => {
      await abrir(page, 'atalhos');
      await usar(page, 'Suporte').click({ button: 'right' });
      await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
      await verTextos(page, [
        '3 de 8',
        'Nome',
        'Número',
        'O que o atalho faz',
        'Ligar',
        'Liga para o número.',
        'Transferir',
        'Durante a ligação, passa direto para o número.',
        'Transferir com consulta',
        'Fala antes com o número e depois passa a ligação.',
        'Enviar teclas',
        'Durante a ligação, digita o número (ex.: *88).',
        'Mostrar se o ramal está livre',
        'Livre, ocupado ou tocando (BLF).',
        'Remover',
        'Salvar atalho',
      ]);
      // O botão direito só abre a edição.
      expect((await comandos(page)).some((c) => c.cmd === 'useShortcut')).toBe(false);
      await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Suporte');
      await expect(page.getByLabel('Número', { exact: true })).toHaveValue('2007');
      const consulta = page.getByRole('radio', { name: 'Transferir com consulta' });
      await expect(consulta).toBeChecked();
      await expect(consulta).toHaveAccessibleDescription('Fala antes com o número e depois passa a ligação.');
      const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
      await expect(blf).toBeEnabled();
      await expect(blf).toHaveAttribute('aria-checked', 'true');
      await expect(blf).toHaveAccessibleDescription('Livre, ocupado ou tocando (BLF).');
      await semViolacoesSerias(page);
      await capturar(page, 'atalho-editar', nomeDoTema(tema));

      await page.getByLabel('Nome', { exact: true }).fill('Suporte técnico');
      await page.getByLabel('Número', { exact: true }).fill('2008');
      await page.getByRole('radio', { name: 'Transferir', exact: true }).check();
      await blf.click();
      await expect(blf).toHaveAttribute('aria-checked', 'false');
      await page.getByRole('button', { name: 'Salvar atalho' }).click();
      await esperarComando(page, { cmd: 'saveShortcut', id: SUPORTE, nome: 'Suporte técnico', numero: '2008', acao: 'transferir', blf: false });
      // De volta à aba, com o atalho gravado (o C++ falso grava).
      await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
      await expect(cartao(page, 'Suporte técnico').locator('.atalho-detalhe')).toHaveText('Transferir · 2008');
    });
  });
}

test.describe('um atalho novo', () => {
  test('a new shortcut starts as Ligar, turns BLF on for an extension and keeps the limits', async ({ page }) => {
    await abrir(page, 'atalhos');
    // Voltar sai sem gravar.
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill('Rascunho');
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    expect((await comandos(page)).some((c) => c.cmd === 'saveShortcut')).toBe(false);

    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    await verTextos(page, ['7 de 8']);
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Remover' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Ligar' })).toBeChecked();
    const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
    await expect(blf).toHaveAttribute('aria-checked', 'false');

    // A chave segue o número enquanto a pessoa não mexe nela: liga num ramal (só dígitos, de 2 a 6).
    const numero = page.getByLabel('Número', { exact: true });
    for (const [digitado, ligado] of [
      ['2005', 'true'],
      ['1150603000', 'false'],
      ['20', 'true'],
      ['2', 'false'],
      ['200500', 'true'],
      ['2005001', 'false'],
      ['*2005', 'false'],
      ['2005', 'true'],
    ] as Array<[string, string]>) {
      await numero.fill(digitado);
      await expect(blf, digitado).toHaveAttribute('aria-checked', ligado);
    }
    // Desligada pela pessoa, a chave não volta sozinha.
    await blf.click();
    await expect(blf).toHaveAttribute('aria-checked', 'false');
    await numero.fill('2006');
    await expect(blf).toHaveAttribute('aria-checked', 'false');

    // O número só com dígitos, *, # e +, até 32; o nome até 24 caracteres (um emoji conta um).
    await numero.fill('(11) 2005-30a#*+');
    await expect(numero).toHaveValue('11200530#*+');
    await numero.fill('1'.repeat(40));
    await expect(numero).toHaveValue('1'.repeat(32));
    const nome = page.getByLabel('Nome', { exact: true });
    await nome.fill('Á'.repeat(30));
    await expect(nome).toHaveValue('Á'.repeat(24));
    await nome.fill('📞'.repeat(30));
    await expect(nome).toHaveValue('📞'.repeat(24));

    await nome.fill('Portaria');
    await numero.fill('2030');
    await page.getByRole('radio', { name: 'Enviar teclas' }).check();
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2030', acao: 'teclas', blf: false });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Portaria').locator('.atalho-detalhe')).toHaveText('Enviar teclas · 2030');
  });

  test('the BLF switch is disabled when the admin has BLF off', async ({ page }) => {
    await abrir(page, 'atalhos');
    await mudarEstado(page, (s) => ({
      ...s,
      admin: { ...s.admin, blf: false },
      atalhos: s.atalhos.map((a: Record<string, unknown>) => ({ ...a, estado: null })),
    }));
    await expect(page.locator('li.atalho .blf')).toHaveCount(0);
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    const blf = page.getByRole('switch', { name: 'Mostrar se o ramal está livre' });
    await expect(blf).toBeDisabled();
    await expect(blf).toHaveAccessibleDescription('O administrador não ligou o BLF');
    await expect(page.getByText('O administrador não ligou o BLF', { exact: true })).toBeVisible();
    await expect(page.getByText('Livre, ocupado ou tocando (BLF).', { exact: true })).toHaveCount(0);
    // Um ramal não liga a chave sem o BLF do administrador.
    await page.getByLabel('Número', { exact: true }).fill('2005');
    await expect(blf).toHaveAttribute('aria-checked', 'false');
    await semViolacoesSerias(page);
    await page.getByLabel('Nome', { exact: true }).fill('Portaria');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2005', acao: 'ligar', blf: false });

    // Um atalho gravado com o BLF continua com ele (só vale quando o administrador ligar o BLF). O nome muda: um
    // Salvar sem mudança só fecha a edição.
    await usar(page, 'Recepção').click({ button: 'right' });
    await expect(blf).toBeDisabled();
    await expect(blf).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Nome', { exact: true }).fill('Recepção 2');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', id: RECEPCAO, nome: 'Recepção 2', numero: '2000', acao: 'ligar', blf: true });
  });

  test('a blank name is refused in the form, without asking the C++', async ({ page }) => {
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    const nome = page.getByLabel('Nome', { exact: true });
    await nome.fill('   ');
    await page.getByLabel('Número', { exact: true }).fill('2030');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    const erro = page.getByRole('alert');
    await expect(erro).toHaveText('Digite o nome do atalho.');
    await expect(nome).toHaveAttribute('aria-invalid', 'true');
    await expect(nome).toHaveAccessibleDescription('Digite o nome do atalho.');
    await expect(nome).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    expect((await comandos(page)).some((c) => c.cmd === 'saveShortcut')).toBe(false);
    await semViolacoesSerias(page);
    // Com um nome, o erro sai e o Salvar manda.
    await nome.fill('Portaria');
    await expect(erro).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2030', acao: 'ligar', blf: true });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
  });

  test('a refused save keeps the editor open with what was typed', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Suporte').click({ button: 'right' });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    // O Suporte saiu em outro lugar: o C++ recusa ("Esse atalho não existe mais.") e nada muda nos atalhos.
    await mudarEstado(page, (s) => ({ ...s, atalhos: s.atalhos.filter((a: { id: string }) => a.id !== SUPORTE) }));
    const nome = page.getByLabel('Nome', { exact: true });
    await nome.fill('Suporte técnico');
    const salvar = page.getByRole('button', { name: 'Salvar atalho' });
    await salvar.click();
    await esperarComando(page, { cmd: 'saveShortcut', id: SUPORTE, nome: 'Suporte técnico', numero: '2007', acao: 'consulta', blf: true });
    await expect(page.getByText('Esse atalho não existe mais.', { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(nome).toHaveValue('Suporte técnico');
    // Recusado, o Salvar volta a valer.
    await expect(salvar).toBeEnabled();
  });

  // Recusado o Salvar, o foco fica no formulário: no campo de que o motivo fala, se dá para saber, senão no "Salvar
  // atalho" (o foco caía no <body>: o Salvar fica desativado esperando a resposta).
  test('a refused save puts focus on the field the reason is about', async ({ page }) => {
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    const nome = page.getByLabel('Nome', { exact: true });
    const numero = page.getByLabel('Número', { exact: true });
    // Um tab no meio do nome: a loja recusa ("O nome não pode ter caracteres de controle."). O Enter sai do Número.
    await nome.fill('Por\ttaria');
    await numero.fill('2030');
    await numero.press('Enter');
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Por\ttaria', numero: '2030', acao: 'ligar', blf: true });
    await expect(page.getByText('O nome não pode ter caracteres de controle.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    await expect(nome).toBeFocused();
    await expect(page.getByRole('button', { name: 'Salvar atalho' })).toBeEnabled();
    // Corrigido o nome, o Salvar grava.
    await nome.fill('Portaria');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Portaria')).toHaveCount(1);
  });

  test('a refused save without a field to blame puts focus on Salvar atalho', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Suporte').click({ button: 'right' });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    // O Suporte saiu em outro lugar: "Esse atalho não existe mais." não é de um campo.
    await mudarEstado(page, (s) => ({ ...s, atalhos: s.atalhos.filter((a: { id: string }) => a.id !== SUPORTE) }));
    await page.getByLabel('Nome', { exact: true }).fill('Suporte técnico');
    const salvar = page.getByRole('button', { name: 'Salvar atalho' });
    await salvar.click();
    await expect(page.getByText('Esse atalho não existe mais.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(salvar).toBeEnabled();
    await expect(salvar).toBeFocused();
  });

  test('a ninth shortcut refused by the store puts focus on Salvar atalho too', async ({ page }) => {
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    // Outro lugar completou os 8 atalhos com o editor aberto: "Você já tem 8 atalhos…" também não é de um campo.
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: [
        ...s.atalhos,
        { id: '1a2b3c4d5e6f7a8b', nome: 'Diretoria', numero: '2020', acao: 'ligar', blf: false, estado: null },
        { id: '8b7a6f5e4d3c2b1a', nome: 'Garagem', numero: '2040', acao: 'ligar', blf: false, estado: null },
      ],
    }));
    await page.getByLabel('Nome', { exact: true }).fill('Portaria');
    await page.getByLabel('Número', { exact: true }).fill('2030');
    const salvar = page.getByRole('button', { name: 'Salvar atalho' });
    await salvar.click();
    await expect(page.getByText('Você já tem 8 atalhos. Remova um para adicionar outro.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    await expect(salvar).toBeEnabled();
    await expect(salvar).toBeFocused();
  });

  // A edição só destrava o Salvar com o toast da loja: se um motivo do Atalhos.cpp faltasse na lista dela (recusas.ts),
  // o Salvar travaria para sempre depois dessa recusa. O campo de cada motivo é o de que ele fala.
  test('the refusal texts the editor waits for are the ones the C++ store sends', () => {
    const daLoja = motivosDaLoja();
    expect(daLoja.length, 'o Atalhos.cpp não tem as constantes kErr* esperadas').toBeGreaterThanOrEqual(10);
    expect([...RECUSAS_DO_SALVAR.keys()].sort()).toEqual([...daLoja].sort());
    for (const motivo of daLoja) {
      const campo = /\bnome\b/.test(motivo) ? 'nome' : /\bnúmero\b/.test(motivo) ? 'numero' : 'salvar';
      expect(RECUSAS_DO_SALVAR.get(motivo), motivo).toBe(campo);
    }
  });

  // O Salvar fica travado até a resposta DESTE Salvar: os atalhos gravados mudaram, ou a loja recusou (o toast com o
  // motivo dela). Um aviso de outra coisa no meio da espera não destrava: um clique duplo nesse instante criaria dois
  // "Portaria".
  test('an unrelated toast during a pending save leaves Salvar locked, and a double click saves one shortcut', async ({ page }) => {
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill('Portaria');
    await page.getByLabel('Número', { exact: true }).fill('2030');
    // O C++ lento: a resposta ao Salvar espera.
    await segurarCpp(page);
    const salvar = page.getByRole('button', { name: 'Salvar atalho' });
    await salvar.click();
    await esperarComando(page, { cmd: 'saveShortcut', nome: 'Portaria', numero: '2030', acao: 'ligar', blf: true });
    await expect(salvar).toBeDisabled();
    // Um aviso que não é a resposta (o C++ avisa de outra coisa no mesmo instante).
    await empurrar(page, { v: 1, type: 'toast', texto: 'Sem conexão com o servidor. Tente de novo em instantes.' });
    await expect(page.getByText('Sem conexão com o servidor. Tente de novo em instantes.', { exact: true })).toBeVisible();
    await expect(salvar).toBeDisabled();
    await salvar.dblclick({ force: true });
    expect((await comandos(page)).filter((c) => c.cmd === 'saveShortcut')).toHaveLength(1);
    // A resposta chega: o editor fecha, com um atalho só.
    await soltarCpp(page);
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Portaria')).toHaveCount(1);
    expect((await comandos(page)).filter((c) => c.cmd === 'saveShortcut')).toHaveLength(1);
  });

  test('a double Enter saves one shortcut, and the editor closes when the C++ saves it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-22T10:00:00-03:00') });
    await abrir(page, 'atalhos');
    await page.getByRole('button', { name: 'Adicionar atalho', exact: true }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill('Portaria');
    const numero = page.getByLabel('Número', { exact: true });
    await numero.fill('2030');
    // O relógio parado: a resposta do C++ (falso) não chega entre os dois Enter.
    await page.clock.pauseAt(new Date('2026-10-22T10:05:00-03:00'));
    await numero.press('Enter');
    await numero.press('Enter');
    expect((await comandos(page)).filter((c) => c.cmd === 'saveShortcut')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Salvar atalho' })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
    // O C++ gravou: a edição fecha, com um atalho só.
    await page.clock.runFor(200);
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Portaria')).toHaveCount(1);
  });

  test('saving an unchanged shortcut just closes the editor', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Recepção').click({ button: 'right' });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    // Só os espaços das pontas (o C++ tira): nada muda.
    await page.getByLabel('Nome', { exact: true }).fill('Recepção ');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    expect((await comandos(page)).some((c) => c.cmd === 'saveShortcut')).toBe(false);
  });

  // A loja tira das pontas só o espaço, o tab e as quebras de linha (o TrimAscii): um espaço não separável fica. A
  // edição compara como ela, senão um Salvar sem mudança esperaria para sempre um estado que não muda.
  test('a name the store keeps with a no-break space at the end saves untouched without waiting', async ({ page }) => {
    await abrir(page, 'atalhos');
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: s.atalhos.map((a: { id: string; nome: string }) => (a.id === RECEPCAO ? { ...a, nome: 'Recepção ' } : a)),
    }));
    await usar(page, 'Recepção').click({ button: 'right' });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    expect((await comandos(page)).some((c) => c.cmd === 'saveShortcut')).toBe(false);
  });

  test('a no-break space added at the end is a change the store keeps', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Recepção').click({ button: 'right' });
    await page.getByLabel('Nome', { exact: true }).fill('Recepção ');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await esperarComando(page, { cmd: 'saveShortcut', id: RECEPCAO, nome: 'Recepção ', numero: '2000', acao: 'ligar', blf: true });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    expect((await estado(page)).atalhos.find((a: { id: string }) => a.id === RECEPCAO).nome).toBe('Recepção ');
  });

  test('Remover in the editor asks first and removes', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Financeiro').click({ button: 'right' });
    await page.getByRole('button', { name: 'Remover' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Remover atalho' });
    await expect(dialogo).toContainText('Financeiro sai da lista de atalhos.');
    await dialogo.getByRole('button', { name: 'Remover' }).click();
    await esperarComando(page, { cmd: 'removeShortcut', id: FINANCEIRO });
    await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    await expect(cartao(page, 'Financeiro')).toHaveCount(0);
  });
});

// O foco da edição (C-M2). Na abertura, o Nome ganha o foco nos dois modos e toda vez: o `autofocus` só vale uma vez por
// documento (a segunda abertura ficava no <body>) e a edição de um atalho não tinha foco nenhum. Ao fechar, o foco
// volta ao que a abriu (o Mais opções ou o cartão do atalho, o "Adicionar atalho"); sem ele (o atalho saiu, a grade
// encheu), vai ao título da aba: nunca fica no <body>.
test.describe('o foco da edição do atalho', () => {
  const nome = (page: Page) => page.getByLabel('Nome', { exact: true });
  const voltar = (page: Page) => page.getByRole('button', { name: 'Voltar' });
  const adicionar = (page: Page) => page.getByRole('button', { name: 'Adicionar atalho', exact: true });
  const tituloDaAba = (page: Page) => page.getByRole('main', { name: 'Atalhos' }).getByRole('heading', { name: 'Atalhos', level: 1 });

  test('a new shortcut focuses Nome every time it opens, not only the first', async ({ page }) => {
    await abrir(page, 'atalhos');
    for (const vez of [1, 2, 3]) {
      await adicionar(page).first().click();
      await expect(page.getByRole('heading', { name: 'Adicionar atalho' })).toBeVisible();
      await expect(nome(page), `abertura ${vez}`).toBeFocused();
      await voltar(page).click();
      await expect(page.getByRole('main', { name: 'Atalhos' })).toBeVisible();
    }
  });

  test('an existing shortcut focuses Nome too, from the right button and from Mais opções', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Suporte').click({ button: 'right' });
    await expect(page.getByRole('heading', { name: 'Editar atalho' })).toBeVisible();
    await expect(nome(page)).toHaveValue('Suporte');
    await expect(nome(page), 'pelo botão direito').toBeFocused();
    await voltar(page).click();
    await page.getByRole('button', { name: 'Mais opções para Comercial' }).click();
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    await expect(nome(page)).toHaveValue('Comercial');
    await expect(nome(page), 'pelo Mais opções').toBeFocused();
  });

  test('Voltar and Salvar give the focus back to Adicionar atalho, and to the tab title when none is left', async ({ page }) => {
    await abrir(page, 'atalhos');
    await adicionar(page).first().click();
    await voltar(page).click();
    await expect(adicionar(page).first(), 'Voltar').toBeFocused();
    // Salvar: o atalho novo ocupa o primeiro espaço, sobra um, e o foco volta a ele.
    await adicionar(page).first().click();
    await nome(page).fill('Portaria');
    await page.getByLabel('Número', { exact: true }).fill('2030');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(cartao(page, 'Portaria')).toHaveCount(1);
    await expect(adicionar(page)).toHaveCount(1);
    await expect(adicionar(page).first(), 'Salvar').toBeFocused();
    // O oitavo atalho enche a grade: nenhum "Adicionar atalho" sobra, e o foco vai ao título da aba.
    await adicionar(page).first().click();
    await nome(page).fill('Garagem');
    await page.getByLabel('Número', { exact: true }).fill('2040');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(cartao(page, 'Garagem')).toHaveCount(1);
    await expect(adicionar(page)).toHaveCount(0);
    await expect(tituloDaAba(page), 'a grade cheia').toBeFocused();
  });

  test('a shortcut opened by the right button gives the focus back to its card', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Suporte').click({ button: 'right' });
    await voltar(page).click();
    await expect(usar(page, 'Suporte'), 'Voltar').toBeFocused();
    await usar(page, 'Suporte').click({ button: 'right' });
    await nome(page).fill('Suporte 2');
    await page.getByRole('button', { name: 'Salvar atalho' }).click();
    await expect(cartao(page, 'Suporte 2')).toHaveCount(1);
    await expect(usar(page, 'Suporte 2'), 'Salvar').toBeFocused();
  });

  test('a shortcut opened from Mais opções gives the focus back to Mais opções, all by keyboard', async ({ page }) => {
    await abrir(page, 'atalhos');
    const mais = page.getByRole('button', { name: 'Mais opções para Comercial' });
    // O Enter no Mais opções abre o menu (o foco vai ao Editar, o primeiro item); o outro Enter abre a edição.
    const editarPeloMais = async () => {
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu', { name: 'Opções de Comercial' }).getByRole('menuitem', { name: 'Editar' })).toBeFocused();
      await page.keyboard.press('Enter');
    };
    await mais.focus();
    await editarPeloMais();
    await expect(nome(page)).toHaveValue('Comercial');
    await expect(nome(page)).toBeFocused();
    // Do Nome ao Voltar (o botão da barra vem antes do campo) e Enter.
    await page.keyboard.press('Shift+Tab');
    await expect(voltar(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(mais, 'Voltar').toBeFocused();
    // Salvar com um nome novo, pelo Enter no campo.
    await editarPeloMais();
    await expect(nome(page)).toBeFocused();
    await nome(page).fill('Comercial 2');
    await nome(page).press('Enter');
    await expect(cartao(page, 'Comercial 2')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Mais opções para Comercial 2' }), 'Salvar').toBeFocused();
  });

  test('removing the shortcut in its editor leaves the focus on the tab title', async ({ page }) => {
    await abrir(page, 'atalhos');
    await usar(page, 'Financeiro').click({ button: 'right' });
    await page.getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('dialog', { name: 'Remover atalho' }).getByRole('button', { name: 'Remover' }).click();
    await expect(cartao(page, 'Financeiro')).toHaveCount(0);
    await expect(tituloDaAba(page)).toBeFocused();
  });
});

test.describe('o painel Atalhos na ligação', () => {
  const botaoAtalhos = (page: Page) => page.getByRole('button', { name: 'Atalhos', exact: true });
  const painel = (page: Page) => page.getByRole('region', { name: 'Atalhos' });

  test('the call screen Atalhos panel runs transfer consult and keys', async ({ page }) => {
    await abrir(page, 'ligacao');
    await expect(botaoAtalhos(page)).toBeEnabled();
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    await expect(painel(page).getByRole('heading', { name: 'Atalhos' })).toBeVisible();
    // O foco no Fechar (um Enter de quem estava nos controles nunca transfere a ligação).
    await expect(painel(page).getByRole('button', { name: 'Fechar atalhos' })).toBeFocused();
    // Os mesmos atalhos, com o que cada um faz durante a ligação, e o BLF.
    await expect(painel(page).locator('.atalho-linha .row-title')).toHaveText(NOMES);
    await expect(painel(page).locator('.atalho-linha .row-sub')).toHaveText([
      'Nova ligação para 2000',
      'Transferir para 2010',
      'Consulta com 2007',
      'Nova ligação para 2003',
      'Enviar as teclas *88',
      'Nova ligação para 11988887777',
    ]);
    await expect(painel(page).locator('.atalho-linha .blf')).toHaveText(['Livre', 'Ocupado', 'Tocando', 'Desconectado']);
    // O painel fica no lugar dos controles; o Desligar continua.
    await expect(page.getByRole('button', { name: 'Mudo', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();
    await semViolacoesSerias(page);
    await capturar(page, 'ligacao-atalhos', 'escuro');

    // Transferir: o useShortcut do atalho, e o painel fecha.
    await painel(page).getByRole('button', { name: /^Financeiro/ }).click();
    await esperarComando(page, { cmd: 'useShortcut', id: FINANCEIRO });
    await expect(painel(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mudo', exact: true })).toBeVisible();
    // Consulta.
    await botaoAtalhos(page).click();
    await painel(page).getByRole('button', { name: /^Suporte/ }).click();
    await esperarComando(page, { cmd: 'useShortcut', id: SUPORTE });
    // Enviar teclas vale na ligação; depois de usar, o foco volta ao botão Atalhos.
    await botaoAtalhos(page).click();
    const teclas = painel(page).getByRole('button', { name: /^Fila de espera/ });
    await expect(teclas).toBeEnabled();
    await teclas.click();
    await esperarComando(page, { cmd: 'useShortcut', id: FILA });
    await expect(painel(page)).toHaveCount(0);
    await expect(botaoAtalhos(page)).toBeFocused();

    // Esc e o Fechar atalhos fecham sem usar nada, e o foco volta ao botão Atalhos.
    const usados = (await comandos(page)).filter((c) => c.cmd === 'useShortcut').length;
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(painel(page)).toHaveCount(0);
    await expect(botaoAtalhos(page)).toBeFocused();
    await botaoAtalhos(page).click();
    await painel(page).getByRole('button', { name: 'Fechar atalhos' }).click();
    await expect(painel(page)).toHaveCount(0);
    await expect(botaoAtalhos(page)).toBeFocused();
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toHaveLength(usados);
  });

  test('the Atalhos button needs an answered call and a shortcut, and is there with two calls', async ({ page }) => {
    await abrir(page, 'ligacao');
    // Chamando (ainda sem atender): travado, como o Transferir.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, id: 0, number: '2010', name: '', phase: 'dialing', activeSinceMs: 0 } },
    }));
    await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
    await expect(botaoAtalhos(page)).toBeDisabled();
    // Atendida, mas sem nenhum atalho: travado também.
    await mudarEstado(page, (s) => ({
      ...s,
      atalhos: [],
      ligacao: { ...s.ligacao, top: { ...s.ligacao.top, id: 41, phase: 'active', activeSinceMs: Date.now() } },
    }));
    await expect(page.getByRole('button', { name: 'Transferir', exact: true })).toBeEnabled();
    await expect(botaoAtalhos(page)).toBeDisabled();
    // Duas ligações: o botão está nos controles e abre o painel.
    await abrir(page, 'duas-ligacoes');
    await expect(botaoAtalhos(page)).toBeEnabled();
    await botaoAtalhos(page).click();
    await expect(painel(page).locator('.atalho-linha')).toHaveCount(6);
    await semViolacoesSerias(page);
  });

  test('with a second call, Ligar and Consulta wait (as Nova ligação and Consultar do) and the others work', async ({ page }) => {
    // Duas em andamento, e a segunda tocando na faixa: uma terceira ligação não cabe.
    for (const cenario of ['duas-ligacoes', 'ligacao-segunda']) {
      await abrir(page, cenario);
      await botaoAtalhos(page).click();
      const linha = (nome: string) => painel(page).getByRole('button', { name: new RegExp(`^${nome}`) });
      for (const nome of ['Recepção', 'Suporte', 'Comercial', 'Celular plantão']) {
        await expect(linha(nome), `${cenario}: ${nome}`).toBeDisabled();
      }
      await expect(linha('Financeiro'), cenario).toBeEnabled();
      await expect(linha('Fila de espera'), cenario).toBeEnabled();
      // O clique num travado não manda nada e não fecha o painel.
      await linha('Recepção').click({ force: true });
      await linha('Suporte').click({ force: true });
      await page.waitForTimeout(200);
      expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut'), cenario).toEqual([]);
      await expect(painel(page), cenario).toBeVisible();
      await linha('Financeiro').click();
      await esperarComando(page, { cmd: 'useShortcut', id: FINANCEIRO });
    }
  });

  test('with only an unanswered ringing call no shortcut can be used', async ({ page }) => {
    await abrir(page, 'ligacao');
    await botaoAtalhos(page).click();
    await expect(painel(page)).toBeVisible();
    // A ligação de cima acabou e ficou só uma recebida tocando, ainda sem atender.
    await mudarEstado(page, (s) => ({
      ...s,
      ligacao: {
        ...s.ligacao,
        top: { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false },
        second: null,
        secondKind: 'none',
      },
    }));
    await expect(page.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
    await expect(painel(page)).toHaveCount(0);
    await expect(page.locator('.atalho-linha')).toHaveCount(0);
    await expect(botaoAtalhos(page)).toHaveCount(0);
    expect((await comandos(page)).filter((c) => c.cmd === 'useShortcut')).toEqual([]);
  });
});
