// (0.4.0) A sala no grande e na tela cheia (os quadros SalaGrande e SalaTelaCheia), contra a ponte falsa: o `main` com o
// mosaico, a etiqueta de três partes e a barra da sala; os nomes dos convidados sobre as imagens (e no alto da imagem na
// linha de baixo); o painel de adicionar à direita, que o mosaico abre espaço para; a pergunta do Desligar; a sala cheia
// com o motivo; as medidas da tela cheia; os cliques duplos (no Tirar da sala e nos botões da barra); o foco quando a sala
// acaba com a pergunta aberta; e a ligação de fora atendida no grande (Review Focus 5).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEM_VIDEO } from '../../src/video/estado';
import { abrir, comandos, depoisDoQueChegou, esperarComando, estado, mudarEstado, segurarCpp, soltarCpp, vezes } from '../helpers';
import { corNoMeio, perto } from '../video/video';
import { imagemDe, mosaicoDaSala, quadroDe, RGB } from './sala';

test.use({ viewport: { width: 1280, height: 800 } });

type Caixa = { x: number; y: number; width: number; height: number };

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const principal = (page: Page, nome: 'Sala de vídeo, grande' | 'Sala de vídeo, tela cheia' = 'Sala de vídeo, grande') => page.getByRole('main', { name: nome, exact: true });
const mosaicoGrupo = (page: Page) => page.getByRole('group', { name: 'Mosaico da sala', exact: true });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const barraDeBaixo = (page: Page) => page.locator('.grande-barra button');
const painel = (page: Page) => page.locator('.grande-adicionar');
const campo = (page: Page) => page.getByRole('combobox', { name: 'Adicionar à sala', exact: true });
const pergunta = (page: Page) => page.getByRole('alertdialog', { name: 'Encerrar a sala para todos?' });
const nomes = (b: Locator) => b.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? ''));

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function quase(valor: number, esperado: number, msg: string) {
  expect(Math.abs(valor - esperado), `${msg}: ${valor} perto de ${esperado}`).toBeLessThanOrEqual(1);
}

/** Os comandos depois do `antes`-ésimo, sem o `videoViews`. */
async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes).filter((c) => c.cmd !== 'videoViews');
}

/** As cores de quem tem imagem no `sala-grande` (a posição na lista, como o `mosaicoDaSala`). */
const CORES = [
  ['Ana Souza', RGB.BRANCO],
  ['Carlos Lima', RGB.VERDE],
  ['Bia Ramos', RGB.AZUL],
] as const;

/** O meio de cada imagem na cor do convidado (o nome, o Tirar da sala e a etiqueta ficam fora do meio). */
async function coresNoLugar(page: Page, onde: string): Promise<void> {
  await expect
    .poll(async () => (await Promise.all(CORES.map(async ([nome, cor]) => perto(await corNoMeio(page, imagemDe(page, nome)), cor)))).every(Boolean), {
      message: `as cores dos convidados ${onde}`,
    })
    .toBe(true);
}

test("the big window shows the room's mosaic with the names, the label and the room's bar", async ({ page }) => {
  // O relógio parado desde antes de a página abrir (docs/build-notes.md): com as vistas de vídeo na tela, o `pauseAt` de uma
  // página já aberta pode voltar o relógio, e o tempo da etiqueta (09:12 mais os segundos do teste) sairia do `09:1x`.
  const inicio = new Date('2026-11-10T14:00:00-03:00').getTime();
  await page.clock.install({ time: inicio });
  await page.clock.pauseAt(inicio + 60_000);
  await page.goto('/index.html?fake=sala-grande');
  await page.clock.runFor(1_000);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);

  await expect(principal(page)).toBeVisible();
  await expect(mosaicoGrupo(page)).toBeVisible();
  for (const [nome] of CORES) await expect(mosaicoGrupo(page).getByRole('group', { name: nome, exact: true })).toBeVisible();
  for (const [nome] of CORES) await expect(quadroDe(page, nome).getByText(nome, { exact: true })).toBeVisible();

  // A etiqueta: a sala, as pessoas (os três convidados e você) e o tempo.
  const etiqueta = page.locator('.grande-etiqueta');
  await expect(etiqueta.getByText('Sala de vídeo', { exact: true })).toBeVisible();
  await expect(etiqueta.getByText('4 pessoas', { exact: true })).toBeVisible();
  await expect(etiqueta.getByText(/^09:1\d$/)).toBeVisible();

  const s = await caixa(suaImagem(page));
  quase(s.width, 224, 'a largura da sua imagem');
  quase(s.height, 168, 'a altura da sua imagem');
  quase(1280 - (s.x + s.width), 24, 'a sua imagem a 24 da direita');
  quase(800 - (s.y + s.height), 128, 'a sua imagem a 128 de baixo');
  expect(await nomes(barraDeBaixo(page))).toEqual(['Mudo', 'Desligar a câmera', 'Adicionar pessoa', 'Tela cheia', 'Diminuir', 'Desligar']);
  // Dentro da sala só ficam estes: nada de Chat nem de Hang up da ligação.
  await expect(botao(page, 'Chat')).toHaveCount(0);
});

test('the names of the bottom row sit at the top of their images', async ({ page }) => {
  await abrir(page, 'sala-grande');
  for (const [nome, naLinhaDeBaixo] of [
    ['Bia Ramos', true],
    ['Ana Souza', false],
  ] as const) {
    const imagem = await caixa(imagemDe(page, nome));
    const n = await caixa(quadroDe(page, nome).getByText(nome, { exact: true }));
    const meio = imagem.y + imagem.height / 2;
    if (naLinhaDeBaixo) {
      expect(n.y + n.height, `o nome de ${nome} acima do meio da imagem`).toBeLessThan(meio);
      quase(n.y - imagem.y, 12, `o nome de ${nome} a 12 do alto da imagem`);
    } else {
      expect(n.y, `o nome de ${nome} abaixo do meio da imagem`).toBeGreaterThan(meio);
      quase(imagem.y + imagem.height - (n.y + n.height), 12, `o nome de ${nome} a 12 de baixo da imagem`);
    }
    quase(n.x - imagem.x, 12, `o nome de ${nome} a 12 da esquerda da imagem`);
  }
});

test('each name sits on its guest\'s image in the big window and in the full screen', async ({ page }) => {
  await abrir(page, 'sala-grande');
  await mosaicoDaSala(page);
  await coresNoLugar(page, 'no grande');
  for (const [nome] of CORES) {
    const imagem = await caixa(imagemDe(page, nome));
    const n = await caixa(quadroDe(page, nome).getByText(nome, { exact: true }));
    expect(n.x, `o nome de ${nome} dentro da imagem`).toBeGreaterThanOrEqual(imagem.x - 0.5);
    expect(n.x + n.width, `o nome de ${nome} dentro da imagem`).toBeLessThanOrEqual(imagem.x + imagem.width + 0.5);
    expect(n.y, `o nome de ${nome} dentro da imagem`).toBeGreaterThanOrEqual(imagem.y - 0.5);
    expect(n.y + n.height, `o nome de ${nome} dentro da imagem`).toBeLessThanOrEqual(imagem.y + imagem.height + 0.5);
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await botao(page, 'Tela cheia').click();
  await expect(principal(page, 'Sala de vídeo, tela cheia')).toBeVisible();
  await mosaicoDaSala(page);
  await coresNoLugar(page, 'na tela cheia');
  for (const [nome] of CORES) {
    const imagem = await caixa(imagemDe(page, nome));
    const n = await caixa(quadroDe(page, nome).getByText(nome, { exact: true }));
    expect(n.x, `o nome de ${nome} dentro da imagem na tela cheia`).toBeGreaterThanOrEqual(imagem.x - 0.5);
    expect(n.x + n.width, `o nome de ${nome} dentro da imagem na tela cheia`).toBeLessThanOrEqual(imagem.x + imagem.width + 0.5);
    expect(n.y, `o nome de ${nome} dentro da imagem na tela cheia`).toBeGreaterThanOrEqual(imagem.y - 0.5);
    expect(n.y + n.height, `o nome de ${nome} dentro da imagem na tela cheia`).toBeLessThanOrEqual(imagem.y + imagem.height + 0.5);
  }
});

test('Adicionar pessoa opens the panel at the right and the mosaic makes room', async ({ page }) => {
  await abrir(page, 'sala-grande');
  await mosaicoDaSala(page);
  await botao(page, 'Adicionar pessoa').click();
  await expect(campo(page)).toBeFocused();

  const p = await caixa(painel(page));
  quase(p.width, 360, 'a largura do painel');
  quase(p.x + p.width, 1280, 'o painel à direita');
  const m = await caixa(mosaicoGrupo(page));
  quase(m.x, 0, 'o mosaico à esquerda');
  quase(m.width, 920, 'o mosaico nos 920 da esquerda');
  await coresNoLugar(page, 'com o painel aberto');
  // A sua imagem inteira à vista, à esquerda do painel.
  const s = await caixa(suaImagem(page));
  expect(s.x + s.width, 'a sua imagem à esquerda do painel').toBeLessThanOrEqual(p.x + 0.5);
  expect(s.x, 'a sua imagem dentro da janela').toBeGreaterThanOrEqual(0);
  expect(await nomes(barraDeBaixo(page))).toContain('Adicionar pessoa');

  // O 2005 e o Adicionar: o `salaAdicionar` e o painel fecha.
  await campo(page).fill('2005');
  await painel(page).getByRole('button', { name: 'Adicionar', exact: true }).click();
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '2005' });
  await expect(painel(page)).toHaveCount(0);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaAdicionar', numero: '2005' })).toBe(1);

  // O Cancelar também fecha, sem mandar nada.
  await botao(page, 'Adicionar pessoa').click();
  await expect(painel(page)).toBeVisible();
  const antes = (await comandos(page)).length;
  await painel(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(painel(page)).toHaveCount(0);
  expect(await depois(page, antes)).toEqual([]);
});

test('a double click on Adicionar pessoa and on Diminuir in the big window counts once', async ({ page }) => {
  // O `NoWindows` da sala no grande (Task 5): sem ele, o segundo clique de um clique duplo valeria nos botões da barra.
  await abrir(page, 'sala-grande');
  await botao(page, 'Adicionar pessoa').dblclick();
  await expect(painel(page)).toBeVisible();
  // O segundo clique não fechou nem reabriu nada: o painel ficou aberto uma vez só, sem mandar nada.
  expect(await vezes(page, { cmd: 'salaAdicionar', numero: '' })).toBe(0);
  await painel(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(painel(page)).toHaveCount(0);

  const antes = (await comandos(page)).length;
  await botao(page, 'Diminuir').dblclick();
  await expect.poll(() => vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBeGreaterThanOrEqual(1);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(1);
  expect((await depois(page, antes)).filter((c) => (c as { cmd: string }).cmd !== 'videoWindow')).toEqual([]);
});

test('a double click on Tirar da sala in the big window takes out one guest and keeps the window mode', async ({ page }) => {
  await abrir(page, 'sala-grande');
  const antes = (await comandos(page)).length;
  const bia = quadroDe(page, 'Bia Ramos');
  await bia.hover();
  // O C++ lento: o segundo clique cai no mesmo ponto, ainda com o quadro (o `.grande-video` embaixo dele).
  await segurarCpp(page);
  await bia.getByRole('button', { name: 'Tirar da sala', exact: true }).dblclick();
  await soltarCpp(page);
  await expect.poll(async () => ((await depois(page, antes)) as Array<{ cmd: string }>).filter((c) => c.cmd === 'salaTirar').length).toBe(1);
  await depoisDoQueChegou(page);
  const saiu = (await depois(page, antes)) as Array<{ cmd: string }>;
  expect(saiu.filter((c) => c.cmd === 'salaTirar')).toHaveLength(1);
  expect(saiu.filter((c) => c.cmd === 'videoWindow')).toEqual([]);
  // A janela segue no grande.
  await expect(principal(page)).toBeVisible();
  await expect(botao(page, 'Tela cheia')).toBeVisible();
});

test('a double click on the room video still goes to the full screen', async ({ page }) => {
  await abrir(page, 'sala-grande');
  // O quadro vazio do mosaico (a faixa de cima da área, fora dos convidados): o duplo clique no vídeo alterna como sempre.
  await page.locator('.grande-video').dblclick({ position: { x: 640, y: 36 } });
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(principal(page, 'Sala de vídeo, tela cheia')).toBeVisible();
});

test('Desligar asks Encerrar a sala para todos?', async ({ page }) => {
  await abrir(page, 'sala-grande');
  const antes = (await comandos(page)).length;
  await botao(page, 'Desligar').click();
  await expect(pergunta(page)).toBeVisible();
  await expect(pergunta(page).getByText('As ligações com Ana Souza, Carlos Lima e Bia Ramos vão desligar.', { exact: true })).toBeVisible();
  await expect(pergunta(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  // Perguntar não manda nada, e o `hangup` nunca sai.
  expect(await depois(page, antes)).toEqual([]);
  await pergunta(page).getByRole('button', { name: 'Encerrar', exact: true }).click();
  await esperarComando(page, { cmd: 'salaEncerrar' });
  expect(await vezes(page, { cmd: 'hangup', id: (await estado(page)).ligacao?.top?.id ?? -1 })).toBe(0);
});

test('the focus stays on the screen that remains when the room ends with the question open in the big window', async ({ page }) => {
  await abrir(page, 'sala-grande');
  const emCima = (await estado(page)).ligacao;
  await botao(page, 'Desligar').click();
  await expect(pergunta(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  // A sala acaba sozinha e a Ana fica como a videochamada, ainda no grande: o foco vai para um controle do `main` que fica.
  const ana = { id: 11, number: '2003', name: 'Ana Souza', incoming: false, phase: 'active', activeSinceMs: emCima.top.activeSinceMs, held: false, video: { ...emCima.top.video } };
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: ana, sala: null } }));
  await expect(pergunta(page)).toHaveCount(0);
  await expect(principal(page)).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const e = document.activeElement;
          return { corpo: e === document.body || e === null, dentroDoMain: !!e?.closest('main, .grande'), dentroDoDialogo: !!e?.closest('dialog') };
        }),
      'o foco na ligação que fica',
    )
    .toEqual({ corpo: false, dentroDoMain: true, dentroDoDialogo: false });
});

test('a full room in the full screen disables Adicionar pessoa with the reason', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await abrir(page, 'sala-cheia');
  await botao(page, 'Abrir grande').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(principal(page, 'Sala de vídeo, tela cheia')).toBeVisible();
  const adicionar = botao(page, 'Adicionar pessoa');
  await expect(adicionar).toBeDisabled();
  await expect(adicionar).toHaveAttribute('title', 'A sala já tem 6 pessoas.');
  await expect(adicionar).toHaveAccessibleDescription('A sala já tem 6 pessoas.');
  await expect(page.locator('.grande-etiqueta').getByText('6 pessoas', { exact: true })).toBeVisible();
});

test('the full screen keeps the board\'s sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await abrir(page, 'sala-grande');
  await botao(page, 'Tela cheia').click();
  await expect(principal(page, 'Sala de vídeo, tela cheia')).toBeVisible();
  const s = await caixa(suaImagem(page));
  quase(s.width, 288, 'a largura da sua imagem');
  quase(s.height, 216, 'a altura da sua imagem');
  quase(1920 - (s.x + s.width), 32, 'a sua imagem a 32 da direita');
  quase(1080 - (s.y + s.height), 156, 'a sua imagem a 156 de baixo');
  for (const c of await page.locator('.grande-barra .grande-c').all()) {
    const b = await caixa(c);
    quase(b.width, 60, 'o círculo');
    quase(b.height, 60, 'o círculo');
  }
  for (const [nome] of CORES) {
    const tamanho = await quadroDe(page, nome).getByText(nome, { exact: true }).evaluate((e) => getComputedStyle(e).fontSize);
    expect(tamanho, `o nome de ${nome}`).toBe('16px');
  }
  quase((await caixa(page.locator('.grande-etiqueta'))).height, 46, 'a altura da etiqueta');
  // Nenhum botão sai da janela.
  for (const b of await barraDeBaixo(page).all()) {
    const c = await caixa(b);
    expect(c.x + c.width, 'o botão à direita').toBeLessThanOrEqual(1920 + 0.5);
    expect(c.y + c.height, 'o botão embaixo').toBeLessThanOrEqual(1080 + 0.5);
  }
});

test('the big window sizes of the tiles without an image and of Tirar da sala', async ({ page }) => {
  await abrir(page, 'sala-estados');
  const medidas = () =>
    page.evaluate(() => {
      const px = (sel: string) => {
        const e = document.querySelector(sel);
        return e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10 : -1;
      };
      const larg = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().width ?? -1;
      return {
        iniciais: larg('.sala-iniciais'),
        letrasIniciais: px('.sala-iniciais'),
        nome: px('.sala-nome-painel'),
        estado: px('.sala-estado'),
        tirar: document.querySelector('.sala-tirar')?.getBoundingClientRect().height ?? -1,
        tirarLetra: px('.sala-tirar'),
      };
    });
  await page.setViewportSize({ width: 1280, height: 800 });
  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, janela: 'grande' } }));
  await expect(principal(page)).toBeVisible();
  await expect.poll(medidas).toEqual({ iniciais: 64, letrasIniciais: 22, nome: 16, estado: 14, tirar: 30, tirarLetra: 12.5 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, janela: 'telaCheia' } }));
  await expect(principal(page, 'Sala de vídeo, tela cheia')).toBeVisible();
  await expect.poll(medidas).toEqual({ iniciais: 76, letrasIniciais: 26, nome: 18, estado: 15, tirar: 32, tirarLetra: 13 });
});

test('answering the outside call in the big window brings the call screen with the strip', async ({ page }) => {
  await abrir(page, 'sala-grande');
  const roberto = { id: 16, number: '2012', name: 'Roberto Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: { ...SEM_VIDEO } };
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: roberto, secondKind: 'ringing' } }));
  // O cartão da ligação de fora flutua em cima, no meio, e o grande segue.
  const cartao = page.locator('.grande-cartao [role="alert"]', { hasText: 'Ligação de Roberto Lima' });
  await expect(cartao).toBeVisible();
  const c = await caixa(cartao);
  quase(c.x + c.width / 2, 640, 'o cartão no meio');
  expect(c.y, 'o cartão em cima').toBeLessThan(120);
  await expect(principal(page)).toBeVisible();

  await cartao.getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
  // A tela da ligação de fora e a faixa aparecem na hora: o grande escuro sem o Voltar para a sala não fica.
  await expect(page.getByRole('region', { name: 'Você está fora da sala', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Ligação', exact: true }).getByText('Roberto Lima', { exact: true })).toBeVisible();
  await expect(botao(page, 'Voltar para a sala')).toBeVisible();
  await expect(principal(page)).toHaveCount(0);
  await expect(botao(page, 'Diminuir')).toHaveCount(0);
  // A página pede a janela normal uma vez só.
  await expect.poll(() => vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(1);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(1);
});
