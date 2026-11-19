// (0.4.0) A ligação de fora e a faixa de fora da sala (os quadros LigacaoDeFora, ForaDaSala e a sala de volta), contra a ponte
// falsa: a de fora tocando por cima da sala, o atender que tira você da sala (só com a voz) e põe a faixa "Você está fora da
// sala" em cima da ligação, o Voltar para a sala e o Alternar, o fim da ligação de fora ou da sala, a miniatura da faixa, o
// aviso do canto, a de fora que ainda chama e os três tamanhos.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrir, comandos, depoisDoQueChegou, esperarComando, mudarEstado, vezes } from '../helpers';
import { arrumacao } from '../../src/sala/mosaico';

type Caixa = { x: number; y: number; width: number; height: number };

/** Os três tamanhos da janela. */
const TAMANHOS = [
  [400, 720],
  [360, 600],
  [300, 440],
] as const;

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const faixa = (page: Page) => page.getByRole('region', { name: 'Você está fora da sala', exact: true });
const voltar = (page: Page) => botao(page, 'Voltar para a sala');
const mosaicoGrupo = (page: Page) => page.getByRole('group', { name: 'Mosaico da sala', exact: true });
const telaDaLigacao = (page: Page) => page.getByRole('main', { name: 'Ligação', exact: true });
const telaDaSala = (page: Page) => page.getByRole('main', { name: 'Sala de vídeo', exact: true });
/** O cartão da ligação que toca, achado pelo texto (o alerta dele não tem nome). */
const alertaDe = (page: Page, texto: string) => page.locator('[role="alert"]', { hasText: texto });
const camera = (page: Page) => page.getByRole('button', { name: /a câmera$/ });

const mandar = (page: Page, comando: Record<string, unknown>) =>
  page.evaluate((c) => (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar(c), comando);

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

/** Os comandos depois do `antes`-ésimo, sem o `videoViews`. */
async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes).filter((c) => c.cmd !== 'videoViews');
}

/** A página não rola (nem na altura, nem na largura). */
async function semRolar(page: Page, onde: string): Promise<void> {
  const r = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight - window.innerHeight,
    w: document.documentElement.scrollWidth - window.innerWidth,
    main: (() => {
      const m = document.querySelector('main');
      return m ? m.scrollHeight - m.clientHeight : 0;
    })(),
  }));
  expect(r.h, `${onde}: a página rola na altura`).toBeLessThanOrEqual(0);
  expect(r.w, `${onde}: a página rola na largura`).toBeLessThanOrEqual(0);
  expect(r.main, `${onde}: a tela rola`).toBeLessThanOrEqual(0);
}

/** O botão inteiro dentro da janela. */
async function dentroDaJanela(page: Page, alvo: Locator, onde: string): Promise<void> {
  const b = await caixa(alvo);
  const v = page.viewportSize()!;
  expect(b.x, `${onde}: à esquerda`).toBeGreaterThanOrEqual(-0.5);
  expect(b.y, `${onde}: em cima`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${onde}: à direita`).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height, `${onde}: embaixo`).toBeLessThanOrEqual(v.height + 0.5);
}

/** O texto inteiro: sem reticências nem corte (o scrollWidth não passa do clientWidth). */
async function inteiro(alvo: Locator, onde: string): Promise<void> {
  const [rolagem, largura] = await alvo.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(rolagem, `${onde}: o texto passa da caixa`).toBeLessThanOrEqual(largura);
}

test('an outside call rings over the room without Atender com vídeo, and the mosaic stays', async ({ page }) => {
  await abrir(page, 'sala-ligacao-de-fora');
  const alerta = alertaDe(page, 'Ligação de Roberto Lima');
  await expect(alerta).toBeVisible();
  await expect(alerta.getByText('Ramal 2012 · tocando', { exact: true })).toBeVisible();
  await expect(alerta.getByRole('button', { name: 'Recusar', exact: true })).toBeVisible();
  await expect(alerta.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await expect(botao(page, 'Atender com vídeo')).toHaveCount(0);
  // A sala segue de pé: o mosaico, com a Ana e o Carlos.
  await expect(mosaicoGrupo(page)).toBeVisible();
  await expect(mosaicoGrupo(page).getByRole('group', { name: 'Ana Souza', exact: true })).toBeVisible();
  await expect(mosaicoGrupo(page).getByRole('group', { name: 'Carlos Lima', exact: true })).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
});

test('answering takes you out: the strip with Voltar para a sala over the outside call, voice only', async ({ page }) => {
  await abrir(page, 'sala-ligacao-de-fora');
  await alertaDe(page, 'Ligação de Roberto Lima').getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
  // Só com a voz: o `answer` sai sem o `video`.
  expect((await comandos(page)).filter((c) => c.cmd === 'answer')).toEqual([{ v: 1, cmd: 'answer' }]);

  // A faixa em cima: "Você está fora da sala", os nomes, o tempo da sala e o Voltar para a sala.
  await expect(faixa(page)).toBeVisible();
  await expect(faixa(page).getByText('Ana Souza e Carlos Lima', { exact: true })).toBeVisible();
  await expect(faixa(page).getByText(/· \d{2}:\d{2}/)).toBeVisible();
  await expect(voltar(page)).toBeVisible();

  // Embaixo, a tela da ligação com o Roberto.
  const tela = telaDaLigacao(page);
  await expect(tela).toBeVisible();
  await expect(tela.getByText('Roberto Lima', { exact: true })).toBeVisible();
  await expect(tela.getByText('Ramal 2012', { exact: true })).toBeVisible();
  for (const nome of ['Mudo', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos']) {
    await expect(tela.getByRole('button', { name: nome, exact: true }), nome).toBeVisible();
  }
  await expect(tela.getByRole('button', { name: 'Ligar a câmera', exact: true })).toBeDisabled();
  await expect(tela.getByRole('button', { name: 'Nova ligação', exact: true })).toBeDisabled();
  await expect(tela.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-4(\s|$)/);
  await expect(tela.locator('.ctrls button')).toHaveCount(8);
  // A sala em espera não é o cartão "Em espera" sem nome, nem o mosaico, nem a sua imagem.
  await expect(page.getByText('Em espera', { exact: true })).toHaveCount(0);
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Sua imagem', exact: true })).toHaveCount(0);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: [] });
});

test('Voltar para a sala brings the room back with the outside call on hold, and Alternar goes out again', async ({ page }) => {
  await abrir(page, 'sala-fora');
  await expect(faixa(page)).toBeVisible();
  await voltar(page).click();
  await esperarComando(page, { cmd: 'salaVoltar' });
  // A tela da sala volta, sem a faixa; em cima, o cartão do Roberto em espera.
  await expect(telaDaSala(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  await expect(telaDaLigacao(page)).toHaveCount(0);
  const cartao = telaDaSala(page).locator('.vcard');
  await expect(cartao.getByText('Roberto Lima', { exact: true })).toBeVisible();
  await expect(cartao.getByText('Em espera', { exact: true })).toBeVisible();
  await expect(botao(page, 'Desligar Roberto Lima')).toBeVisible();
  // Os controles da sala e o Alternar, antes do Abrir grande.
  const controles = telaDaSala(page).locator('.ctrls');
  await expect(controles).toHaveClass(/(^|\s)ctrls-5(\s|$)/);
  await expect(controles.getByRole('button')).toHaveCount(5);
  await expect(controles.getByRole('button').nth(0)).toHaveAccessibleName('Mudo');
  await expect(controles.getByRole('button').nth(1)).toHaveAccessibleName(/a câmera$/);
  await expect(controles.getByRole('button').nth(2)).toHaveAccessibleName('Adicionar pessoa');
  await expect(controles.getByRole('button').nth(3)).toHaveAccessibleName('Alternar');
  await expect(controles.getByRole('button').nth(4)).toHaveAccessibleName('Abrir grande');
  await expect(botao(page, 'Alternar')).toBeEnabled();

  await botao(page, 'Alternar').click();
  await esperarComando(page, { cmd: 'swap' });
  await expect(faixa(page)).toBeVisible();
  await expect(telaDaLigacao(page)).toBeVisible();
  await expect(telaDaSala(page)).toHaveCount(0);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaVoltar' })).toBe(1);
  expect(await vezes(page, { cmd: 'swap' })).toBe(1);
});

test('the end of the outside call brings the room back', async ({ page }) => {
  await abrir(page, 'sala-fora');
  await telaDaLigacao(page).getByRole('button', { name: 'Desligar', exact: true }).click();
  await esperarComando(page, { cmd: 'hangup', id: 16 });
  await expect(telaDaSala(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  await expect(telaDaSala(page).locator('.vcard')).toHaveCount(0);
  await expect(mosaicoGrupo(page)).toBeVisible();
});

test('the room ending while you are out leaves the outside call alone', async ({ page }) => {
  await abrir(page, 'sala-fora');
  await expect(faixa(page)).toBeVisible();
  // O núcleo: a sala acabou (ninguém nela), e a ligação do Roberto fica sozinha, em cima.
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, sala: null, second: null, secondKind: 'none' } }));
  await expect(faixa(page)).toHaveCount(0);
  const tela = telaDaLigacao(page);
  await expect(tela.getByText('Roberto Lima', { exact: true })).toBeVisible();
  await expect(tela.getByRole('button', { name: 'Nova ligação', exact: true })).toBeEnabled();
  await expect(page.getByText('Em espera', { exact: true })).toHaveCount(0);
});

test("the strip's picture has one block per guest, in its place", async ({ page }) => {
  await abrir(page, 'sala-fora');
  const miniatura = faixa(page).locator('.fora-miniatura');
  await expect(miniatura).toHaveAttribute('aria-hidden', 'true');
  expect(await caixa(miniatura)).toMatchObject({ width: 64, height: 36 });

  /** Cada bloco no quadro do convidado, em frações dos 64×36 (± 1). */
  async function noLugar(quantos: number): Promise<void> {
    const m = await caixa(miniatura);
    const blocos = miniatura.locator('.fora-bloco');
    await expect(blocos).toHaveCount(quantos);
    const quadros = arrumacao(quantos);
    for (let i = 0; i < quantos; i++) {
      const b = await caixa(blocos.nth(i));
      const q = quadros[i];
      const esperado = { x: m.x + q.x * m.width, y: m.y + q.y * m.height, width: q.largura * m.width, height: q.altura * m.height };
      for (const k of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(b[k] - esperado[k]), `bloco ${i} de ${quantos}: ${k} fora do quadro (${JSON.stringify({ b, esperado })})`).toBeLessThanOrEqual(1);
      }
    }
  }
  await noLugar(2);
  // Com a imagem, o degradê; sem ela, o #0b1226.
  await expect(miniatura.locator('.fora-bloco').nth(0)).toHaveCSS('background-image', /linear-gradient/);

  // Quatro convidados, o último sem a imagem.
  await mudarEstado(page, (s) => {
    const mais = [
      { id: 13, numero: '2005', nome: 'Bia Ramos', estado: 'naSala', imagem: true },
      { id: 14, numero: '2008', nome: 'Davi Nunes', estado: 'naSala', imagem: false },
    ];
    const participantes = [...s.ligacao.sala.participantes, ...mais];
    const quadros = arrumacao(participantes.length);
    return { ...s, ligacao: { ...s.ligacao, sala: { ...s.ligacao.sala, participantes: participantes.map((p, i) => ({ ...p, quadro: quadros[i] })) } } };
  });
  await expect(faixa(page).getByText('Ana Souza, Carlos Lima, Bia Ramos e Davi Nunes', { exact: true })).toBeVisible();
  await noLugar(4);
  await expect(miniatura.locator('.fora-bloco').nth(3)).toHaveCSS('background-image', 'none');
  await expect(miniatura.locator('.fora-bloco').nth(3)).toHaveCSS('background-color', 'rgb(11, 18, 38)');
});

test('the strip and the outside call fit the three sizes', async ({ page }) => {
  for (const [largura, altura] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala-fora');
    await expect(faixa(page)).toBeVisible();
    await inteiro(faixa(page).getByText('Você está fora da sala', { exact: true }), `${onde}: o título da faixa`);
    await inteiro(faixa(page).getByText(/· \d{2}:\d{2}/), `${onde}: o tempo da faixa`);
    await dentroDaJanela(page, voltar(page), `${onde}: Voltar para a sala`);
    for (const b of await telaDaLigacao(page).getByRole('button').all()) {
      await dentroDaJanela(page, b, `${onde}: ${(await b.getAttribute('aria-label')) ?? (await b.innerText())}`);
    }
    await semRolar(page, onde);
  }
});

test('the room with the outside call on hold fits the three sizes', async ({ page }) => {
  for (const [largura, altura] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala-de-volta');
    const cartao = telaDaSala(page).locator('.vcard');
    await expect(cartao).toBeVisible();
    await dentroDaJanela(page, cartao, `${onde}: o cartão do Roberto`);
    for (const b of await telaDaSala(page).getByRole('button').all()) {
      await dentroDaJanela(page, b, `${onde}: ${(await b.getAttribute('aria-label')) ?? (await b.innerText())}`);
    }
    expect((await caixa(mosaicoGrupo(page))).height, `${onde}: o mosaico`).toBeGreaterThan(100);
    await semRolar(page, onde);
    if (largura === 300) {
      // No Mínimo, os cinco controles e o Desligar numa fila só (o meio de cada um na mesma altura), em 274 dos 276.
      const fila = [...(await telaDaSala(page).locator('.ctrls button').all()), botao(page, 'Desligar')];
      expect(fila).toHaveLength(6);
      const caixas = await Promise.all(fila.map(caixa));
      const meios = caixas.map((b) => b.y + b.height / 2);
      for (const m of meios) expect(Math.abs(m - meios[0]), `${onde}: a fila dos controles ${JSON.stringify(meios)}`).toBeLessThanOrEqual(1);
      const esquerda = Math.min(...caixas.map((b) => b.x));
      const direita = Math.max(...caixas.map((b) => b.x + b.width));
      expect(Math.abs(direita - esquerda - 274), `${onde}: a largura da fila (${direita - esquerda}, esperados 274 dos 276)`).toBeLessThanOrEqual(1);
    }
  }
});

test('a double click on Voltar para a sala sends it once', async ({ page }) => {
  await abrir(page, 'sala-fora');
  const b = await caixa(voltar(page));
  const antes = (await comandos(page)).length;
  // Na parte de baixo, a 70% da largura do botão: aí a sala que volta põe o Desligar do cartão do Roberto, e o segundo clique do
  // clique duplo o apertaria sem a guarda.
  const x = b.x + b.width * 0.7;
  const y = b.y + b.height - 8;
  // O segundo clique chega depois de a tela da sala voltar (o que o estado leva): é o dele, com o `detail` 2, que cai no Desligar.
  await page.mouse.move(x, y);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await esperarComando(page, { cmd: 'salaVoltar' });
  await expect(telaDaSala(page)).toBeVisible();
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  // O teste só vale se o Desligar do cartão está debaixo do clique.
  const d = await caixa(botao(page, 'Desligar Roberto Lima'));
  expect(x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height, `o Desligar ${JSON.stringify(d)} não está em (${x}, ${y})`).toBe(true);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaVoltar' })).toBe(1);
  expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'salaVoltar' }]);
  // A ligação de fora segue em espera, no cartão.
  await expect(botao(page, 'Desligar Roberto Lima')).toBeVisible();
});

test('the corner notice during a room shows the outside call without Atender com vídeo', async ({ page }) => {
  await abrir(page, 'sala-ligacao-de-fora', 'aviso.html');
  await expect(page.getByText('Roberto Lima', { exact: true })).toBeVisible();
  await expect(botao(page, 'Recusar')).toBeVisible();
  await expect(botao(page, 'Atender')).toBeVisible();
  await expect(botao(page, 'Atender com vídeo')).toHaveCount(0);
});

test('an outside dial that nobody answers shows the strip, and Voltar para a sala brings the room back alone', async ({ page }) => {
  await abrir(page, 'sala');
  // O 180 só toca. A Nova ligação não está na sala; o comando sai de fora da tela dela.
  await mandar(page, { cmd: 'dial', numero: '180' });
  await expect(faixa(page)).toBeVisible();
  await expect(telaDaLigacao(page).getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await voltar(page).click();
  await esperarComando(page, { cmd: 'salaVoltar' });
  await expect(telaDaSala(page)).toBeVisible();
  await expect(faixa(page)).toHaveCount(0);
  await expect(telaDaSala(page).locator('.vcard')).toHaveCount(0);
  await expect(camera(page)).toBeVisible();
  await expect(page.locator('.toast-box')).toHaveCount(0);
});
