// A tela da ligação com vídeo (video etapa 2, Task 4; os quadros Video, VideoCompacto, VideoMinimo, VozComCamera e
// Avisos) contra a ponte falsa: a imagem da outra ponta grande, a sua no canto e o Abrir grande; a Câmera e a regra dela;
// a ligação só de voz com a sua imagem; o vídeo que pausa com duas ligações, com a segunda tocando e no iPhone; a vista
// que nunca mostra um quadro da ligação de antes (Review Focus 1); a sua imagem à vista com todo painel (Review Focus 2);
// a janela redimensionada (Review Focus 4); os três tamanhos; e os avisos do vídeo, que ficam 5 s.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AVISOS_DE_5_S } from '../../src/video/textos';
import { abrir, empurrar, esperarComando, mudarEstado, semViolacoesSerias } from '../helpers';
import { BRANCO, FUNDO, VERMELHO, corNoMeio, perto, quadro, quadrosDeTela } from './video';

const RGB_DO_VERMELHO = [255, 1, 0];
const RGB_DO_BRANCO = [255, 255, 255];
const SEM_VIDEO = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };

type Caixa = { x: number; y: number; width: number; height: number };

const remoto = (page: Page, nome = 'Ana Souza') => page.getByRole('img', { name: `Vídeo de ${nome}`, exact: true });
const qualquerRemoto = (page: Page) => page.getByRole('img', { name: /^Vídeo de / });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
/** O controle com o rótulo Câmera: o nome dele diz a ação (Ligar a câmera ou Desligar a câmera). */
const camera = (page: Page) => page.locator('.ctrls button.ctrl').filter({ hasText: /^Câmera$/ });
const qualquerCamera = (page: Page) => page.getByRole('button', { name: /câmera/i });

/** O Carlos (o id 12), em andamento há 41 s e sem vídeo, a não ser o que vier em `extra`. */
function carlos(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12,
    number: '2007',
    name: 'Carlos Lima',
    incoming: false,
    phase: 'active',
    activeSinceMs: Date.now() - 41_000,
    held: false,
    video: { ...SEM_VIDEO },
    ...extra,
  };
}

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function dentro(b: Caixa, largura: number, altura: number): boolean {
  return b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5;
}

/** Espera a cor (perto, com a tolerância de 2) no meio do alvo; na falha, mostra a última cor lida. */
async function esperarCorNoMeio(page: Page, alvo: Locator, esperada: number[]): Promise<void> {
  await expect
    .poll(async () => {
      const cor = await corNoMeio(page, alvo);
      return perto(cor, esperada) ? esperada : cor;
    })
    .toEqual(esperada);
}

/** Cada botão da tela da ligação (os controles, o Abrir grande e o Desligar) inteiro na janela. */
async function botoesNaJanela(page: Page, largura: number, altura: number): Promise<void> {
  const botoes = page.locator('main.call-body button');
  const n = await botoes.count();
  expect(n, 'os botões da tela da ligação').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = botoes.nth(i);
    const nome = (await b.getAttribute('aria-label')) ?? (await b.innerText());
    const c = await caixa(b);
    expect(dentro(c, largura, altura), `${nome} fora da janela de ${largura}×${altura}: ${JSON.stringify(c)}`).toBe(true);
  }
}

/**
 * A sua imagem não cobre nenhum botão, campo nem linha de lista da tela da ligação. Conta só a parte de cada um que está à
 * vista: uma linha que a lista rolou para fora (cortada pelo overflow dela) não está na tela.
 */
async function semCobrirNada(page: Page, sua: Caixa): Promise<void> {
  const cobertos = await page.evaluate((s) => {
    const aVista = (e: Element) => {
      const r = e.getBoundingClientRect();
      let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom];
      for (let a = e.parentElement; a && a.tagName !== 'MAIN'; a = a.parentElement) {
        const estilo = getComputedStyle(a);
        if (estilo.overflowX === 'visible' && estilo.overflowY === 'visible') continue;
        const q = a.getBoundingClientRect();
        [x0, y0, x1, y1] = [Math.max(x0, q.left), Math.max(y0, q.top), Math.min(x1, q.right), Math.min(y1, q.bottom)];
      }
      return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    };
    return [...document.querySelectorAll('main.call-body :is(button, input, [role="option"])')].flatMap((e) => {
      const v = aVista(e);
      const cobre = v !== null && v.x0 < s.x + s.width && s.x < v.x1 && v.y0 < s.y + s.height && s.y < v.y1;
      return cobre ? [`${e.getAttribute('aria-label') ?? e.textContent?.trim()} ${JSON.stringify(v)}`] : [];
    });
  }, sua);
  expect(cobertos, `a sua imagem (${JSON.stringify(sua)}) cobre`).toEqual([]);
}

/** O rótulo de cada controle inteiro na coluna dele (nenhum passa por baixo do vizinho). */
async function rotulosInteiros(page: Page, onde: string): Promise<void> {
  const sobram = await page
    .locator('.ctrls button.ctrl')
    .evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => b.textContent?.trim()));
  expect(sobram, `rótulos maiores que a coluna em ${onde}`).toEqual([]);
}

/** A câmera da ligação de cima ligada (o motor deixa o vídeo da ligação ativa, também com a outra em espera). */
const comCameraNaDeCima = (s: Record<string, any>) => ({
  ...s,
  ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, camera: true } } },
});

/** A segunda ligação (o Carlos) tocando, na faixa de cima. */
const comASegundaTocando = (s: Record<string, any>) => ({
  ...s,
  ligacao: { ...s.ligacao, second: carlos({ incoming: true, phase: 'ringing', activeSinceMs: 0 }), secondKind: 'ringing' },
});

test('the video call shows the other side big, your image in the corner and Abrir grande', async ({ page }) => {
  await abrir(page, 'video');
  const area = remoto(page);
  const sua = suaImagem(page);
  await expect(area).toBeVisible();
  await expect(sua).toBeVisible();
  // A sua imagem dentro do retângulo da outra ponta, embaixo à direita, a 10 da borda, 96×72.
  const a = await caixa(area);
  const s = await caixa(sua);
  expect(s.x >= a.x && s.y >= a.y && s.x + s.width <= a.x + a.width && s.y + s.height <= a.y + a.height, JSON.stringify({ a, s })).toBe(true);
  expect(Math.abs(a.x + a.width - (s.x + s.width) - 10), JSON.stringify({ a, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y + a.height - (s.y + s.height) - 10), JSON.stringify({ a, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(s.width - 96)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.height - 72)).toBeLessThanOrEqual(1);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local', 'remoto'] });

  await quadro(page, 'remoto', VERMELHO);
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  // Quem fala, embaixo da imagem: o nome e o ramal com o tempo.
  await expect(page.getByText('Ana Souza', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Ramal 2003 · 03:1\d$/)).toBeVisible();
  expect((await caixa(page.getByText('Ana Souza', { exact: true }))).y).toBeGreaterThan(a.y + a.height);
  await semViolacoesSerias(page);

  // O Abrir grande em cima à direita, irmão das vistas (nunca dentro de uma imagem).
  const abrirGrande = botao(page, 'Abrir grande');
  const g = await caixa(abrirGrande);
  expect(Math.abs(a.x + a.width - (g.x + g.width) - 10), JSON.stringify({ a, g })).toBeLessThanOrEqual(1);
  expect(Math.abs(g.y - a.y - 10), JSON.stringify({ a, g })).toBeLessThanOrEqual(1);
  expect(Math.abs(g.height - 32)).toBeLessThanOrEqual(1);
  await expect(page.locator('[role="img"] button')).toHaveCount(0);
  await abrirGrande.click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
});

test('the Câmera button turns your camera off and on', async ({ page }) => {
  await abrir(page, 'video');
  // Os controles de uma ligação com o vídeo ligado, em quatro colunas (com o Chat, da Task 8, cinco).
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-4(\s|$)/);
  const c = camera(page);
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  // Acesa com a câmera ligada, sem o aria-pressed: o nome já diz a ação.
  await expect(c).toHaveClass(/(^|\s)ctrl-on(\s|$)/);
  await expect(c).not.toHaveAttribute('aria-pressed');
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).not.toHaveClass(/(^|\s)ctrl-on(\s|$)/);
  // Sem a câmera, a sua imagem sai da área do vídeo.
  await expect(suaImagem(page)).toHaveCount(0);
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: true });
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(suaImagem(page)).toBeVisible();
});

test('the Câmera button waits for the call to be answered, but can always turn the camera off', async ({ page }) => {
  await abrir(page, 'ligacao');
  const c = camera(page);
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeEnabled();
  const topo = (mudar: Record<string, unknown>) =>
    mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, ...mudar } } }));

  // Chamando, com a câmera desligada: ela só liga depois do atender.
  await topo({ phase: 'dialing', activeSinceMs: 0, video: { ...SEM_VIDEO } });
  await expect(page.getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
  // Chamando, com a câmera ligada (o Ligar com vídeo): ligada, ela sempre desliga.
  await topo({ phase: 'dialing', activeSinceMs: 0, video: { ...SEM_VIDEO, camera: true } });
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(c).toBeEnabled();
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  // Na espera, com a câmera desligada.
  await topo({ phase: 'active', activeSinceMs: Date.now() - 60_000, held: true, video: { ...SEM_VIDEO } });
  await expect(botao(page, 'Espera')).toHaveAttribute('aria-pressed', 'true');
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
});

test("a voice call keeps today's screen, with your image when the camera is on", async ({ page }) => {
  await abrir(page, 'video-voz-camera');
  await expect(page.locator('.avatar-lg')).toBeVisible();
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(page.getByText('Ramal 2003', { exact: true })).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  const sua = suaImagem(page);
  await expect(sua).toBeVisible();
  // A 16 do canto de cima à direita da tela da ligação, 96×72.
  const corpo = await caixa(page.locator('main.call-body'));
  const s = await caixa(sua);
  expect(Math.abs(corpo.x + corpo.width - 16 - (s.x + s.width)), JSON.stringify({ corpo, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(corpo.y + 16 - s.y), JSON.stringify({ corpo, s })).toBeLessThanOrEqual(1);
  expect(Math.abs(s.width - 96)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.height - 72)).toBeLessThanOrEqual(1);
  await semCobrirNada(page, s);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local'] });
  await quadro(page, 'local', VERMELHO);
  await esperarCorNoMeio(page, sua, RGB_DO_VERMELHO);
  await expect(camera(page)).toHaveAccessibleName('Desligar a câmera');
  await semViolacoesSerias(page);

  await abrir(page, 'ligacao');
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(suaImagem(page)).toHaveCount(0);
  await expect(camera(page)).toHaveAccessibleName('Ligar a câmera');
});

test('with two calls the Câmera only turns the camera off', async ({ page }) => {
  // Duas ligações (a outra em espera): nenhum vídeo desenhado, e a Câmera, depois do Mudo, nunca liga a câmera.
  await abrir(page, 'duas-ligacoes');
  const c = camera(page);
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Alternar', 'Juntar', 'Atalhos']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-5(\s|$)/);
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
  // A câmera da de cima ligada (o motor deixa o vídeo da ativa), mesmo com a imagem da outra ponta chegando: ela desliga.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: true } } },
  }));
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(c).toBeEnabled();
  await expect(c).toHaveClass(/(^|\s)ctrl-on(\s|$)/);
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
  await expect(suaImagem(page)).toBeVisible();
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
  await expect(suaImagem(page)).toHaveCount(0);

  // A consulta com a câmera ligada: Mudo, Câmera, Alternar e Cancelar, numa fila.
  await abrir(page, 'consulta');
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();
  await mudarEstado(page, comCameraNaDeCima);
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(c).toBeEnabled();
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Alternar', 'Cancelar']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-4(\s|$)/);

  // A conferência (o motor pausa todo vídeo nela): nenhum vídeo, e nenhuma Câmera.
  await abrir(page, 'conferencia');
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, imagem: true } } },
  }));
  await expect(botao(page, 'Separar')).toBeVisible();
  await expect(camera(page)).toHaveCount(0);
  await expect(qualquerCamera(page)).toHaveCount(0);
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
});

test('Ligar a câmera waits while a second call rings', async ({ page }) => {
  // A segunda tocando (Ruling 13): como com a outra em espera, nenhuma câmera liga com duas ligações; ligada, ela desliga.
  await abrir(page, 'ligacao');
  const c = camera(page);
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeEnabled();
  await mudarEstado(page, comASegundaTocando);
  await expect(page.getByText('Ligação de Carlos Lima', { exact: true })).toBeVisible();
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();

  await mudarEstado(page, comCameraNaDeCima);
  await expect(c).toHaveAccessibleName('Desligar a câmera');
  await expect(c).toBeEnabled();
  await c.click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(c).toHaveAccessibleName('Ligar a câmera');
  await expect(c).toBeDisabled();

  // A segunda sai: a ligação fica sozinha, e a Câmera liga de novo.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: null, secondKind: 'none' } }));
  await expect(page.getByText('Ligação de Carlos Lima', { exact: true })).toHaveCount(0);
  await expect(c).toBeEnabled();
});

test('the two-call and consultation controls fit the three sizes', async ({ page }) => {
  for (const [largura, altura] of [
    [400, 720],
    [360, 600],
    [300, 440],
  ] as const) {
    await page.setViewportSize({ width: largura, height: altura });
    for (const [cenario, quantos, grade] of [
      ['duas-ligacoes', 9, 'ctrls-5'],
      ['consulta', 4, 'ctrls-4'],
    ] as const) {
      const onde = `${cenario} em ${largura}×${altura}`;
      await abrir(page, cenario);
      await mudarEstado(page, comCameraNaDeCima);
      await expect(camera(page), onde).toHaveAccessibleName('Desligar a câmera');
      await expect(page.locator('.ctrls > *'), onde).toHaveCount(quantos);
      await expect(page.locator('.ctrls'), onde).toHaveClass(new RegExp(`(^|\\s)${grade}(\\s|$)`));
      const sobra = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
      expect(sobra, `a página rola: ${onde}`).toBeLessThanOrEqual(0);
      await botoesNaJanela(page, largura, altura);
      await rotulosInteiros(page, onde);
      const s = await caixa(suaImagem(page));
      expect(dentro(s, largura, altura), `a sua imagem fora da janela: ${onde}`).toBe(true);
      await semCobrirNada(page, s);
    }
  }
});

test('the remote view never shows a frame of the previous call', async ({ page }) => {
  await abrir(page, 'video');
  await quadro(page, 'remoto', VERMELHO);
  await esperarCorNoMeio(page, remoto(page), RGB_DO_VERMELHO);

  // A de cima vira o Carlos de uma vez, já com a imagem (a área fica na tela): a vista dele é outra (o `key` do id), só
  // com o fundo, mesmo com o vermelho da Ana ainda na memória.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: carlos({ video: { ...SEM_VIDEO, ativo: true, imagem: true } }) } }));
  const doCarlos = remoto(page, 'Carlos Lima');
  await expect(doCarlos).toBeVisible();
  await expect(doCarlos).toHaveAttribute('data-memoria');
  await quadrosDeTela(page, 10);
  const logo = await corNoMeio(page, doCarlos);
  expect(perto(logo, FUNDO), `o quadro da Ana apareceu na vista do Carlos: ${logo}`).toBe(true);
  await quadro(page, 'remoto', BRANCO);
  await esperarCorNoMeio(page, doCarlos, RGB_DO_BRANCO);

  // De novo, pela área que sai e volta: a Ana, com um quadro dela na memória, e o Carlos sem a imagem (a área sai).
  await abrir(page, 'video');
  await quadro(page, 'remoto', VERMELHO);
  await esperarCorNoMeio(page, remoto(page), RGB_DO_VERMELHO);
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: carlos({ video: { ...SEM_VIDEO, ativo: true } }) } }));
  await expect(page.locator('.who-name')).toHaveText('Carlos Lima');
  await expect(qualquerRemoto(page)).toHaveCount(0);

  // A imagem do Carlos começa: a área volta só com o fundo, mesmo com o vermelho da Ana ainda na memória.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: carlos({ video: { ...SEM_VIDEO, ativo: true, imagem: true } }) } }));
  const area = remoto(page, 'Carlos Lima');
  await expect(area).toBeVisible();
  await expect(area).toHaveAttribute('data-memoria');
  await quadrosDeTela(page, 10);
  const agora = await corNoMeio(page, area);
  expect(perto(agora, FUNDO), `o quadro da ligação de antes apareceu: ${agora}`).toBe(true);
  // O primeiro quadro do Carlos aparece.
  await quadro(page, 'remoto', BRANCO);
  await esperarCorNoMeio(page, area, RGB_DO_BRANCO);
});

/**
 * Abre cada painel da lista, um de cada vez, e confere a sua imagem à vista, inteira na janela e sem cobrir nenhum botão,
 * campo ou linha. Depois de cada um, a tela da ligação volta (`voltou`).
 */
async function comCadaPainel(page: Page, onde: string, paineis: string[], voltou: () => Promise<void>): Promise<void> {
  const { width: largura, height: altura } = page.viewportSize()!;
  const sua = suaImagem(page);
  const aVista = async (painel: string) => {
    await expect(sua, `${painel}, ${onde}`).toBeVisible();
    const s = await caixa(sua);
    expect(dentro(s, largura, altura), `${painel}, ${onde}: ${JSON.stringify(s)}`).toBe(true);
    await semCobrirNada(page, s);
  };
  for (const painel of paineis) {
    await botao(page, painel).click();
    if (painel === 'Teclado') {
      await expect(page.getByRole('group', { name: 'Teclado da ligação' })).toBeVisible();
      await aVista(painel);
      await botao(page, 'Teclado').click();
    } else if (painel === 'Atalhos') {
      await expect(botao(page, 'Fechar atalhos')).toBeVisible();
      await aVista(painel);
      await botao(page, 'Fechar atalhos').click();
    } else {
      const rotulo = painel === 'Transferir' ? 'Número para transferir' : 'Número da nova ligação';
      await expect(page.getByRole('combobox', { name: rotulo })).toBeVisible();
      await aVista(painel);
      await page.locator('.call-panel').getByRole('button', { name: 'Cancelar', exact: true }).click();
    }
    await voltou();
  }
}

// Uma ligação só (com o vídeo) e um cartão em cima, nos três tamanhos e na janela do Normal mais baixa que 720 (onde quem
// fala sai com um painel aberto e um cartão em cima).
for (const [largura, altura] of [
  [400, 720],
  [400, 680],
  [400, 600],
  [360, 600],
  [300, 440],
] as const) {
  test(`your image stays in sight with every panel (${largura}×${altura})`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'video');
    await expect(suaImagem(page)).toBeVisible();
    await comCadaPainel(page, 'uma ligação', ['Teclado', 'Transferir', 'Nova ligação', 'Atalhos'], () => expect(remoto(page)).toBeVisible());

    // Com um cartão em cima (sem a Nova ligação, que espera a outra sair): a outra em espera com a câmera da de cima
    // ligada, e a segunda tocando numa ligação com vídeo.
    for (const [cenario, mudar, onde] of [
      ['duas-ligacoes', comCameraNaDeCima, 'a outra em espera'],
      ['video', comASegundaTocando, 'a segunda tocando'],
    ] as const) {
      await abrir(page, cenario);
      await mudarEstado(page, mudar);
      await expect(page.locator('.vcard')).toBeVisible();
      await expect(suaImagem(page), onde).toBeVisible();
      await comCadaPainel(page, onde, ['Teclado', 'Transferir', 'Atalhos'], () => expect(botao(page, 'Mudo')).toBeVisible());
    }
  });
}

test('the video problem notices stay 5 seconds, the others 2', async ({ page }) => {
  const inicio = new Date('2026-11-10T14:00:00-03:00').getTime();
  await page.clock.install({ time: inicio });
  await abrir(page, 'video');
  // O relógio parado: só anda com o runFor (as mensagens da ponte falsa também saem por um setTimeout).
  await page.clock.pauseAt(inicio + 60_000);
  const aviso = (texto: string) => page.locator('.toast').getByText(texto, { exact: true });
  for (const texto of AVISOS_DE_5_S) {
    await empurrar(page, { v: 1, type: 'toast', texto });
    await page.clock.runFor(10);
    await expect(aviso(texto)).toBeVisible();
    await page.clock.runFor(4_490);
    await expect(aviso(texto), `${texto} em +4,5 s`).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(aviso(texto), `${texto} em +5,5 s`).toHaveCount(0);
  }
  await empurrar(page, { v: 1, type: 'toast', texto: 'Ocupado' });
  await page.clock.runFor(10);
  await expect(aviso('Ocupado')).toBeVisible();
  await page.clock.runFor(1_490);
  await expect(aviso('Ocupado'), 'Ocupado em +1,5 s').toBeVisible();
  await page.clock.runFor(1_000);
  await expect(aviso('Ocupado'), 'Ocupado em +2,5 s').toHaveCount(0);
});

test('resizing the window keeps the video fitted', async ({ page }) => {
  await abrir(page, 'video');
  const area = remoto(page);
  await quadro(page, 'remoto', VERMELHO, 640, 480);
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  const tamanho = () =>
    area.evaluate((e) => {
      const c = e.querySelector('canvas')!;
      return { canvas: [c.width, c.height], caixa: [e.clientWidth, e.clientHeight] };
    });
  const antes = await tamanho();

  await page.setViewportSize({ width: 300, height: 440 });
  await expect(page.locator('.win[data-layout="minimo"]')).toHaveCount(1);
  // O canvas com a largura e a altura da caixa (o devicePixelRatio é 1), menor que antes.
  await expect
    .poll(async () => {
      const { canvas, caixa } = await tamanho();
      return Math.abs(canvas[0] - caixa[0]) <= 1 && Math.abs(canvas[1] - caixa[1]) <= 1 && canvas[0] < antes.canvas[0];
    })
    .toBe(true);
  // O último quadro desenhado de novo, encaixado na caixa nova.
  await esperarCorNoMeio(page, area, RGB_DO_VERMELHO);
  await botoesNaJanela(page, 300, 440);
});

test('the video screen fits the three sizes', async ({ page }) => {
  for (const [largura, altura, layout] of [
    [400, 720, 'normal'],
    [360, 600, 'compacto'],
    [300, 440, 'minimo'],
  ] as const) {
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'video');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    const area = remoto(page);
    await expect(area).toBeVisible();
    expect((await caixa(area)).height, `a área do vídeo em ${largura}×${altura}`).toBeGreaterThan(100);
    await expect(suaImagem(page)).toBeVisible();
    const sobra = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
    expect(sobra, `a página rola em ${largura}×${altura}`).toBeLessThanOrEqual(0);
    await botoesNaJanela(page, largura, altura);
    if (layout === 'minimo') {
      // Quem fala numa linha só.
      const linha = page.getByText(/^Ana Souza · 03:1\d$/);
      await expect(linha).toBeVisible();
      expect((await caixa(linha)).height).toBeLessThan(26);
    } else {
      await expect(page.getByText('Ana Souza', { exact: true })).toBeVisible();
      await expect(page.getByText(/^Ramal 2003 · 03:1\d$/)).toBeVisible();
    }
  }
});

test('the second call ringing pauses the video layout', async ({ page }) => {
  await abrir(page, 'video');
  await expect(remoto(page)).toBeVisible();
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: { ...s.ligacao, second: carlos({ incoming: true, phase: 'ringing', activeSinceMs: 0 }), secondKind: 'ringing' },
  }));
  await expect(page.getByText('Ligação de Carlos Lima', { exact: true })).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
  // A câmera da Ana continua ligada: a sua imagem fica à vista, embaixo do cartão, sem cobrir o Recusar e o Atender.
  const sua = suaImagem(page);
  await expect(sua).toBeVisible();
  const s = await caixa(sua);
  const cartao = await caixa(page.locator('.vcard'));
  expect(s.y, JSON.stringify({ s, cartao })).toBeGreaterThanOrEqual(cartao.y + cartao.height);
  await semCobrirNada(page, s);
  await semViolacoesSerias(page);
});

test('on the iPhone a call never shows video', async ({ page }) => {
  await abrir(page, 'video&plataforma=ios');
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  // Mesmo que o estado traga o vídeo ligado e a ligação com a imagem e a câmera.
  await mudarEstado(page, (s) => ({
    ...s,
    video: { ligado: true, cameras: ['Câmera'], camera: '', cameraDesconectada: false, teste: false, h264: { cartao: true, pessoa: true, situacao: 'instalado' }, janela: 'normal' },
    ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ativo: true, imagem: true, camera: true } } },
  }));
  await expect(page.locator('.who-name')).toHaveText('Ana Souza');
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(qualquerRemoto(page)).toHaveCount(0);
  await expect(suaImagem(page)).toHaveCount(0);
  await expect(camera(page)).toHaveCount(0);
  await expect(qualquerCamera(page)).toHaveCount(0);
  await expect(botao(page, 'Abrir grande')).toHaveCount(0);
});
