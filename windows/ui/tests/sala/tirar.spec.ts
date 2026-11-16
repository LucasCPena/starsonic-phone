// (0.4.0) O Tirar da sala em cada quadro da sala (o quadro SalaEstados e a nota dele), contra a ponte falsa: o botão que só
// aparece ao passar o mouse ou ao chegar nele com o Tab (um botão escondido não pega o clique), o contorno ciano do quadro,
// o `salaTirar` de quem chama também, o clique duplo (o segundo clique cairia no Tirar da sala do convidado que tomou o
// lugar) e cinco convidados com nomes longos ou só com o número nos três tamanhos, com só o ícone num quadro estreito.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { arrumacao } from '../../src/sala/mosaico';
import { abrir, comandos, depoisDoQueChegou, esperarComando, mudarEstado, vezes } from '../helpers';

type Caixa = { x: number; y: number; width: number; height: number };

/** Os três tamanhos da janela e o layout de cada um (layout.ts). */
const TAMANHOS = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
] as const;

const mosaicoGrupo = (page: Page) => page.getByRole('group', { name: 'Mosaico da sala', exact: true });
const quadroDe = (page: Page, nome: string) => mosaicoGrupo(page).getByRole('group', { name: nome, exact: true });
const tirarDe = (page: Page, nome: string) => quadroDe(page, nome).getByRole('button', { name: `Tirar da sala: ${nome}`, exact: true });

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

/** `b` inteira dentro de `por`, com a folga de meio pixel. */
function noInteiro(b: Caixa, por: Caixa): boolean {
  return b.x >= por.x - 0.5 && b.y >= por.y - 0.5 && b.x + b.width <= por.x + por.width + 0.5 && b.y + b.height <= por.y + por.height + 0.5;
}

/** O meio da caixa. */
const meio = (b: Caixa) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** O ponteiro fora de todos os quadros (a barra de título). */
const ponteiroFora = (page: Page) => page.mouse.move(2, 2);

/** O elemento que está no ponto (x, y) da tela, se for um Tirar da sala: o nome do quadro dele, senão null. */
const tirarNoPonto = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const alvo = document.elementFromPoint(px, py)?.closest('.sala-tirar');
      return alvo ? (alvo.closest('[role="group"]')?.getAttribute('aria-label') ?? '') : null;
    },
    [x, y],
  );

/** O quadro de `nome` está onde a arrumação de `quantos` o põe, em frações do mosaico (± 1 px). */
async function noLugar(page: Page, nome: string, indice: number, quantos: number): Promise<void> {
  const m = await caixa(mosaicoGrupo(page));
  const q = arrumacao(quantos)[indice];
  const c = await caixa(quadroDe(page, nome));
  const esperado = { x: m.x + q.x * m.width, y: m.y + q.y * m.height, width: q.largura * m.width, height: q.altura * m.height };
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(c[k] - esperado[k]), `${nome}: ${k} fora da arrumação de ${quantos} (${JSON.stringify({ c, esperado })})`).toBeLessThanOrEqual(1);
  }
}

test('Tirar da sala shows on hover and on Tab, and takes the guest out', async ({ page }) => {
  await abrir(page, 'sala-estados');
  await ponteiroFora(page);
  const carlos = tirarDe(page, 'Carlos Lima');
  // Com o ponteiro fora, o botão está escondido, e um botão escondido não pega o clique: no meio dele há outra coisa.
  await expect(carlos).toHaveCSS('opacity', '0');
  const escondido = meio(await caixa(carlos));
  expect(await tirarNoPonto(page, escondido.x, escondido.y), 'o Tirar da sala escondido pega o clique').toBeNull();
  // Com o ponteiro no quadro dele, o botão aparece (e os dos outros quadros continuam escondidos).
  await quadroDe(page, 'Carlos Lima').hover();
  await expect(carlos).toHaveCSS('opacity', '1');
  await expect(tirarDe(page, 'Ana Souza')).toHaveCSS('opacity', '0');
  await expect(tirarDe(page, 'Bia Ramos')).toHaveCSS('opacity', '0');
  const visivel = meio(await caixa(carlos));
  expect(await tirarNoPonto(page, visivel.x, visivel.y), 'o Tirar da sala à vista não pega o clique').toBe('Carlos Lima');
  await carlos.click();
  await esperarComando(page, { cmd: 'salaTirar', id: 12 });
  // O quadro dele sai, e os outros voltam à arrumação de 3.
  await expect(quadroDe(page, 'Carlos Lima')).toHaveCount(0);
  await noLugar(page, 'Ana Souza', 0, 3);
  await noLugar(page, 'Bia Ramos', 1, 3);
  await noLugar(page, 'Davi Nunes', 2, 3);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaTirar', id: 12 })).toBe(1);
});

test('Tirar da sala is reached with Tab, in the order of the guests, with the cyan contour on the tile', async ({ page }) => {
  await abrir(page, 'sala-estados');
  await ponteiroFora(page);
  // O ciano das variáveis do app.css, como o navegador o resolve.
  const ciano = await page.evaluate(() => {
    const sonda = document.createElement('i');
    sonda.style.color = 'var(--cyan)';
    document.body.append(sonda);
    const cor = getComputedStyle(sonda).color;
    sonda.remove();
    return cor;
  });
  const contorno = (nome: string) =>
    quadroDe(page, nome).evaluate((q) => {
      const c = getComputedStyle(q, '::after');
      return { opacidade: c.opacity, largura: c.borderTopWidth, cor: c.borderTopColor, cliques: c.pointerEvents };
    });
  const convidados = ['Ana Souza', 'Carlos Lima', 'Bia Ramos', 'Davi Nunes'];
  // Ninguém com o foco: sem contorno.
  for (const nome of convidados) expect((await contorno(nome)).opacidade, `${nome} sem o foco`).toBe('0');
  // A partir da barra de título: o Tab passa pelo Tirar da sala de cada quadro, na ordem dos convidados.
  await page.getByRole('button', { name: 'Fechar para a bandeja', exact: true }).focus();
  for (const nome of convidados) {
    await page.keyboard.press('Tab');
    await expect(tirarDe(page, nome), `o Tab em ${nome}`).toBeFocused();
    await expect(tirarDe(page, nome)).toHaveCSS('opacity', '1');
    const c = await contorno(nome);
    expect(c, `o contorno de ${nome}`).toEqual({ opacidade: '1', largura: '2px', cor: ciano, cliques: 'none' });
    // Só o quadro com o foco tem o contorno e o botão à vista.
    for (const outro of convidados.filter((x) => x !== nome)) {
      expect((await contorno(outro)).opacidade, `o contorno de ${outro} com o foco em ${nome}`).toBe('0');
      await expect(tirarDe(page, outro)).toHaveCSS('opacity', '0');
    }
  }
  // O Enter no botão com o foco tira o convidado.
  await page.keyboard.press('Enter');
  await esperarComando(page, { cmd: 'salaTirar', id: 14 });
});

test('a guest being called can be taken out too', async ({ page }) => {
  await abrir(page, 'sala-estados');
  const carlos = quadroDe(page, 'Carlos Lima');
  await expect(carlos.getByText('Chamando…', { exact: true })).toBeVisible();
  await carlos.hover();
  await tirarDe(page, 'Carlos Lima').click();
  await esperarComando(page, { cmd: 'salaTirar', id: 12 });
  await expect(carlos).toHaveCount(0);
  // Sem nenhum aviso (nem "Ocupado" nem outro).
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaTirar', id: 12 })).toBe(1);
  await expect(page.locator('.toast-box').filter({ hasNotText: /^Aviso de teste \d+\.$/ })).toHaveCount(0);
});

test('a double click on Tirar da sala takes out only one guest', async ({ page }) => {
  await abrir(page, 'sala-estados');
  await ponteiroFora(page);
  await quadroDe(page, 'Carlos Lima').hover();
  const carlos = tirarDe(page, 'Carlos Lima');
  await expect(carlos).toHaveCSS('opacity', '1');
  const ponto = meio(await caixa(carlos));
  // O primeiro clique tira o Carlos (o quadro de cima à direita).
  await page.mouse.move(ponto.x, ponto.y);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await esperarComando(page, { cmd: 'salaTirar', id: 12 });
  await expect(quadroDe(page, 'Carlos Lima')).toHaveCount(0);
  // Com a arrumação nova, a Bia é o quadro de cima à direita: o Tirar da sala dela fica embaixo do ponteiro, que não saiu do lugar.
  await noLugar(page, 'Bia Ramos', 1, 3);
  await page.mouse.move(ponto.x, ponto.y);
  await expect(tirarDe(page, 'Bia Ramos')).toHaveCSS('opacity', '1');
  expect(await tirarNoPonto(page, ponto.x, ponto.y), 'o Tirar da sala da Bia fora do ponteiro').toBe('Bia Ramos');
  // O segundo par do clique duplo (o clickCount 2) cai nele, e nada sai.
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await depoisDoQueChegou(page);
  expect((await comandos(page)).filter((c) => c.cmd === 'salaTirar')).toEqual([{ v: 1, cmd: 'salaTirar', id: 12 }]);
  await expect(quadroDe(page, 'Bia Ramos')).toBeVisible();
});

/** A sala cheia com nomes longos, só o número, chamando, em espera e sem imagem. */
async function salaDeCasosDificeis(page: Page): Promise<void> {
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      sala: {
        ...s.ligacao.sala,
        participantes: s.ligacao.sala.participantes.map((p: Record<string, any>) => {
          switch (p.numero) {
            case '2003':
              return { ...p, nome: 'Coordenação de Logística e Transportes' };
            case '2007':
              return { ...p, nome: '', numero: '+55 11 98888-7777' };
            case '2005':
              return { ...p, estado: 'chamando', imagem: false };
            case '2006':
              return { ...p, estado: 'emEspera', imagem: false };
            default:
              return { ...p, imagem: false };
          }
        }),
      },
    },
  }));
}

test('five guests with long names or only numbers fit their tiles in the three sizes', async ({ page }) => {
  const nomes = ['Coordenação de Logística e Transportes', '+55 11 98888-7777', 'Bia Ramos', 'Davi Nunes', 'Elisa Prado'];
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala-cheia');
    await salaDeCasosDificeis(page);
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    await expect(quadroDe(page, nomes[0])).toBeVisible();
    await expect(quadroDe(page, nomes[1])).toBeVisible();
    for (const nome of nomes) {
      const q = quadroDe(page, nome);
      const tirar = tirarDe(page, nome);
      // Com o foco, o Tirar da sala fica à vista.
      await tirar.focus();
      await expect(tirar).toHaveCSS('opacity', '1');
      const dele = await caixa(q);
      expect(dele.width, `o quadro de ${nome} em ${onde}`).toBeGreaterThan(40);
      // Cada parte do quadro (nome, estado, iniciais e o botão) inteira dentro dele.
      const partes = q.locator('.sala-nome-painel, .sala-estado, .sala-iniciais, .sala-nome, .sala-tirar');
      expect(await partes.count(), `as partes de ${nome} em ${onde}`).toBeGreaterThanOrEqual(2);
      for (const parte of await partes.all()) {
        const c = await caixa(parte);
        const quem = await parte.evaluate((e) => e.className);
        expect(noInteiro(c, dele), `${quem} de ${nome} fora do quadro em ${onde}: ${JSON.stringify({ c, dele })}`).toBe(true);
      }
    }
    const sobra = await page.evaluate(() => ({
      altura: document.scrollingElement!.scrollHeight - innerHeight,
      largura: document.scrollingElement!.scrollWidth - innerWidth,
    }));
    expect(sobra.altura, `a página rola em ${onde}`).toBeLessThanOrEqual(0);
    expect(sobra.largura, `a página rola para o lado em ${onde}`).toBeLessThanOrEqual(0);
  }
});

test('in a narrow tile Tirar da sala shows only the icon and keeps its name', async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 440 });
  await abrir(page, 'sala-cheia');
  await salaDeCasosDificeis(page);
  // Os cinco quadros: os de 3 + 2 são estreitos em 300×440, e todos os botões têm o nome.
  const quadros = mosaicoGrupo(page).getByRole('group');
  await expect(quadros).toHaveCount(5);
  let estreitos = 0;
  for (const q of await quadros.all()) {
    const nome = (await q.getAttribute('aria-label'))!;
    const dele = await caixa(q);
    const tirar = q.getByRole('button', { name: `Tirar da sala: ${nome}`, exact: true });
    await tirar.focus();
    await expect(tirar).toHaveAccessibleName(`Tirar da sala: ${nome}`);
    const texto = tirar.locator('.sala-tirar-texto');
    const t = await caixa(texto);
    const b = await caixa(tirar);
    expect(noInteiro(b, dele), `o botão de ${nome} fora do quadro: ${JSON.stringify({ b, dele })}`).toBe(true);
    if (dele.width < 112) {
      estreitos++;
      // Só o ícone: o texto sai da vista (o .sr-only), e o botão fica com 24×24.
      expect(t.width, `o texto de ${nome} à vista`).toBeLessThanOrEqual(1);
      expect(t.height, `o texto de ${nome} à vista`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.width - 24), `a largura do botão de ${nome}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(b.height - 24), `a altura do botão de ${nome}`).toBeLessThanOrEqual(0.5);
    } else {
      expect(t.width, `o texto de ${nome} fora da vista`).toBeGreaterThan(30);
    }
  }
  expect(estreitos, 'os quadros estreitos em 300×440').toBeGreaterThanOrEqual(3);
});

test('each Tirar da sala button names its person and starts with the visible text', async ({ page }) => {
  await abrir(page, 'sala');
  const botoes = mosaicoGrupo(page).getByRole('button', { name: /^Tirar da sala/ });
  await expect(botoes).toHaveCount(2);
  // Os dois nomes são diferentes, cada um com a sua pessoa, e o texto à vista ("Tirar da sala") abre o nome (WCAG 2.5.3).
  await expect(botoes.nth(0)).toHaveAccessibleName('Tirar da sala: Ana Souza');
  await expect(botoes.nth(1)).toHaveAccessibleName('Tirar da sala: Carlos Lima');
  await expect(botoes.nth(0).getByText('Tirar da sala', { exact: true })).toHaveCount(1);
  await expect(tirarDe(page, 'Ana Souza')).toHaveCount(1);
  await expect(tirarDe(page, 'Carlos Lima')).toHaveCount(1);
});
