// (0.4.0) O Adicionar pessoa na videochamada (os quadros Main e Adicionar), contra a ponte falsa: o controle depois da
// Câmera, sem o destaque ciano do quadro Main (a decisão 1 do plano); o painel de adicionar (o alto com "Em videochamada",
// o campo "Adicionar à sala" com a lista dos contatos, a ajuda e o Adicionar); o `salaAdicionar`, com o `contato` só do
// contato escolhido e sem mudança depois, pelo Adicionar e pelo Enter; o clique duplo no Adicionar; quando o controle não
// aparece ou espera; o painel que fecha quando adicionar deixa de valer; a sua imagem à vista com o painel aberto; e os
// três tamanhos da janela.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEM_VIDEO } from '../../src/video/estado';
import { abrir, comandos, depoisDoQueChegou, esperarComando, mudarEstado, segurarCpp, semViolacoesSerias, soltarCpp, vezes } from '../helpers';

type Caixa = { x: number; y: number; width: number; height: number };

/** Os três tamanhos da janela e o layout de cada um (layout.ts). */
const TAMANHOS = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
] as const;

const AJUDA = 'O app liga para a pessoa com vídeo. Ela entra na sala quando atender.';

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const adicionarPessoa = (page: Page) => botao(page, 'Adicionar pessoa');
/** O campo do painel de adicionar. */
const campo = (page: Page) => page.getByRole('combobox', { name: 'Adicionar à sala', exact: true });
/** Um botão do painel de adicionar. */
const doPainel = (page: Page, nome: 'Adicionar' | 'Cancelar') => page.locator('.call-panel').getByRole('button', { name: nome, exact: true });
const ajuda = (page: Page) => page.locator('.call-panel').getByText(AJUDA, { exact: true });
/** Quem vai entrar na sala: o contato escolhido. */
const para = (page: Page) => page.locator('.call-panel .call-para');
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });

/** Os salaAdicionar que saíram, na ordem. */
async function adicoes(page: Page): Promise<unknown[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'salaAdicionar');
}

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function dentro(b: Caixa, largura: number, altura: number): boolean {
  return b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5;
}

function cobre(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** A página não rola, nem para o lado. */
async function semRolar(page: Page, onde: string): Promise<void> {
  const sobra = await page.evaluate(() => ({
    altura: document.scrollingElement!.scrollHeight - innerHeight,
    largura: document.scrollingElement!.scrollWidth - innerWidth,
  }));
  expect(sobra.altura, `a página rola em ${onde}`).toBeLessThanOrEqual(0);
  expect(sobra.largura, `a página rola para o lado em ${onde}`).toBeLessThanOrEqual(0);
}

/** A ligação de cima muda (o resto fica). */
const topo = (page: Page, mudar: Record<string, unknown>) =>
  mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, ...mudar } } }));

/** O vídeo da ligação de cima para: só o `video.ativo` em false. */
const semOVideoAtivo = (s: Record<string, any>) => ({
  ...s,
  ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...s.ligacao.top.video, ativo: false } } },
});

/** O vídeo do app ligado e o da ligação de cima ativo (o que o mostraAdicionar pede): sem o controle, quem decide é a tela. */
const comOVideoAtivo = (s: Record<string, any>) => ({
  ...s,
  video: { ...s.video, ligado: true },
  ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...SEM_VIDEO, ...s.ligacao.top.video, ativo: true, imagem: true } } },
});

/** A segunda ligação (o Carlos) tocando, na faixa de cima. */
const comASegundaTocando = (s: Record<string, any>) => ({
  ...s,
  ligacao: {
    ...s.ligacao,
    second: { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: { ...SEM_VIDEO } },
    secondKind: 'ringing',
  },
});

/** Abre o painel de adicionar na videochamada com a Ana. */
async function abrirOPainel(page: Page): Promise<void> {
  await abrir(page, 'video');
  await adicionarPessoa(page).click();
  await expect(campo(page)).toBeFocused();
}

test('a video call has Adicionar pessoa after Câmera', async ({ page }) => {
  await abrir(page, 'video');
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Adicionar pessoa', 'Teclado', 'Áudio', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-5(\s|$)/);
  // Como os outros controles: sem o destaque ciano do quadro Main.
  await expect(adicionarPessoa(page)).toBeEnabled();
  await expect(adicionarPessoa(page)).not.toHaveClass(/(^|\s)ctrl-on(\s|$)/);
});

test('Adicionar pessoa opens the panel and Adicionar sends salaAdicionar once', async ({ page }) => {
  await abrirOPainel(page);
  // O alto do painel: a videochamada com a Ana (o .eyebrow põe o texto em maiúsculas), e o título do painel.
  const alto = page.locator('.who-compact');
  await expect(alto.locator('.eyebrow')).toHaveText('Em videochamada');
  await expect(alto.locator('.who-name')).toHaveText('Ana Souza');
  await expect(alto.getByText('Ramal 2003', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Adicionar à sala', exact: true })).toBeVisible();
  // A ajuda à vista (ela também descreve o campo), e o Adicionar desligado sem número.
  await expect(ajuda(page)).toBeVisible();
  await expect(campo(page)).toHaveAccessibleDescription(AJUDA);
  await expect(doPainel(page, 'Adicionar')).toBeDisabled();
  await semViolacoesSerias(page);

  // Com o 2010, um clique duplo no Adicionar manda um salaAdicionar só, e o painel fecha na hora, antes da resposta do
  // núcleo (o C++ lento): o segundo clique cai nos controles que voltam e não abre nada.
  await campo(page).fill('2010');
  await expect(doPainel(page, 'Adicionar')).toBeEnabled();
  const antes = (await comandos(page)).length;
  await segurarCpp(page);
  await doPainel(page, 'Adicionar').dblclick();
  await expect(campo(page)).toHaveCount(0);
  await expect(page.locator('.call-panel')).toHaveCount(0);
  await soltarCpp(page);
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '2010' });
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaAdicionar', numero: '2010' })).toBe(1);
  await expect(page.locator('.call-panel')).toHaveCount(0);
  // Nada mais sai (as vistas do vídeo que voltam à tela à parte).
  expect((await comandos(page)).slice(antes).filter((c) => c.cmd !== 'videoViews')).toEqual([{ v: 1, cmd: 'salaAdicionar', numero: '2010' }]);
});

test('a chosen contact goes with contato, also by Enter', async ({ page }) => {
  await abrirOPainel(page);
  // "car", a seta para baixo e o Enter escolhem o Carlos: o painel diz quem entra, e outro Enter o adiciona.
  await campo(page).fill('car');
  await campo(page).press('ArrowDown');
  await campo(page).press('Enter');
  await expect(para(page)).toHaveText('Para: Carlos Lima · 2007');
  await expect(campo(page)).toHaveValue('2007');
  await campo(page).press('Enter');
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '2007', contato: true });
  await expect(campo(page)).toHaveCount(0);
  // A sala nasce na ponte falsa, com a linha dela em cima: ela chega à tela antes do painel novo.
  await depoisDoQueChegou(page);

  // Num painel novo, o Carlos escolhido e um 8 digitado depois: o número do campo, sem o contato.
  await adicionarPessoa(page).click();
  await expect(campo(page)).toBeFocused();
  await campo(page).fill('car');
  await campo(page).press('ArrowDown');
  await campo(page).press('Enter');
  await expect(para(page)).toHaveText('Para: Carlos Lima · 2007');
  await campo(page).press('End');
  await campo(page).press('8');
  await expect(campo(page)).toHaveValue('20078');
  await expect(para(page)).toHaveCount(0);
  await doPainel(page, 'Adicionar').click();
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '20078' });
  expect(await adicoes(page)).toEqual([
    { v: 1, cmd: 'salaAdicionar', numero: '2007', contato: true },
    { v: 1, cmd: 'salaAdicionar', numero: '20078' },
  ]);
});

test('letters without a choice add nobody, and Esc and Cancelar close the panel', async ({ page }) => {
  await abrirOPainel(page);
  await campo(page).fill('xyz');
  await expect(page.locator('.call-panel').getByText('Nenhum contato com esse nome', { exact: true })).toBeVisible();
  await expect(doPainel(page, 'Adicionar')).toBeDisabled();
  await campo(page).press('Enter');
  await expect(campo(page)).toBeFocused();
  // O Esc fecha o painel, e o Cancelar também.
  await campo(page).press('Escape');
  await expect(campo(page)).toHaveCount(0);
  await adicionarPessoa(page).click();
  await expect(campo(page)).toBeFocused();
  await doPainel(page, 'Cancelar').click();
  await expect(campo(page)).toHaveCount(0);
  await expect(adicionarPessoa(page)).toBeEnabled();
  await depoisDoQueChegou(page);
  expect(await adicoes(page)).toEqual([]);
});

test('no Adicionar pessoa without video, with two calls, ringing or on the iPhone', async ({ page }) => {
  // Com duas ligações, na conferência, tocando e no iPhone, também com o vídeo ativo na de cima: quem decide é a tela.
  for (const [cenario, aVista, comVideo] of [
    ['ligacao', 'Mudo', false],
    ['duas-ligacoes', 'Mudo', true],
    ['conferencia', 'Mudo', true],
    ['video-tocando', 'Atender', true],
    ['video&plataforma=ios', 'Mudo', true],
  ] as const) {
    await abrir(page, cenario);
    if (comVideo) await mudarEstado(page, comOVideoAtivo);
    await expect(botao(page, aVista), cenario).toBeVisible();
    await depoisDoQueChegou(page);
    await expect(adicionarPessoa(page), cenario).toHaveCount(0);
  }
  // A videochamada com o vídeo que para.
  await abrir(page, 'video');
  await expect(adicionarPessoa(page)).toBeVisible();
  await mudarEstado(page, semOVideoAtivo);
  await expect(adicionarPessoa(page)).toHaveCount(0);
});

test('Adicionar pessoa waits for the answered call out of hold', async ({ page }) => {
  await abrir(page, 'video');
  await expect(adicionarPessoa(page)).toBeEnabled();
  // Ainda sem o tempo do motor (o atender não confirmado).
  await topo(page, { activeSinceMs: 0 });
  await expect(adicionarPessoa(page)).toBeDisabled();
  // Atendida, em espera.
  await topo(page, { activeSinceMs: Date.now() - 60_000, held: true });
  await expect(botao(page, 'Espera')).toHaveAttribute('aria-pressed', 'true');
  await expect(adicionarPessoa(page)).toBeDisabled();
  // Fora da espera, ele volta.
  await topo(page, { held: false });
  await expect(adicionarPessoa(page)).toBeEnabled();
});

test('the panel closes when adding stops being possible', async ({ page }) => {
  await abrirOPainel(page);
  // A segunda ligação tocando: o cartão dela aparece, e o painel fecha.
  await mudarEstado(page, comASegundaTocando);
  await expect(page.getByText('Ligação de Carlos Lima', { exact: true })).toBeVisible();
  await expect(campo(page)).toHaveCount(0);
  await expect(adicionarPessoa(page)).toBeDisabled();
  // Aberto de novo, o vídeo que para também o fecha.
  await abrirOPainel(page);
  await mudarEstado(page, semOVideoAtivo);
  await expect(campo(page)).toHaveCount(0);
  await expect(adicionarPessoa(page)).toHaveCount(0);
  expect(await adicoes(page)).toEqual([]);
});

/** A sua imagem à vista, inteira na janela e sem cobrir o alto do painel, o campo, os botões do painel e o Desligar. */
async function suaImagemAVista(page: Page, largura: number, altura: number, onde: string): Promise<void> {
  const sua = suaImagem(page);
  await expect(sua, onde).toBeVisible();
  const s = await caixa(sua);
  expect(dentro(s, largura, altura), `a sua imagem fora da janela em ${onde}: ${JSON.stringify(s)}`).toBe(true);
  for (const [nome, alvo] of [
    ['o alto do painel', page.locator('.who-compact')],
    ['o campo', campo(page)],
    ['o Adicionar', doPainel(page, 'Adicionar')],
    ['o Cancelar', doPainel(page, 'Cancelar')],
    ['o Desligar', botao(page, 'Desligar')],
  ] as const) {
    const c = await caixa(alvo);
    expect(cobre(s, c), `a sua imagem cobre ${nome} em ${onde}: ${JSON.stringify({ s, c })}`).toBe(false);
  }
}

test('your image stays in sight with the panel open', async ({ page }) => {
  await abrirOPainel(page);
  await suaImagemAVista(page, 400, 720, '400×720');
  // Nem a ajuda.
  expect(cobre(await caixa(suaImagem(page)), await caixa(ajuda(page))), 'a sua imagem cobre a ajuda').toBe(false);
});

test('the panel fits the three sizes', async ({ page }) => {
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrirOPainel(page);
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    await campo(page).fill('car');
    const lista = page.getByRole('listbox');
    await expect(lista.getByRole('option')).toHaveText([/Carlos Lima/]);
    // O campo, o Adicionar, o Cancelar e o Desligar inteiros na janela; o painel inteiro na parte do meio, e o Cancelar
    // acima do Desligar.
    for (const [nome, alvo] of [
      ['o campo', campo(page)],
      ['o Adicionar', doPainel(page, 'Adicionar')],
      ['o Cancelar', doPainel(page, 'Cancelar')],
      ['o Desligar', botao(page, 'Desligar')],
    ] as const) {
      const c = await caixa(alvo);
      expect(dentro(c, largura, altura), `${nome} fora da janela em ${onde}: ${JSON.stringify(c)}`).toBe(true);
    }
    expect(await page.locator('.call-middle').evaluate((e) => e.scrollHeight - e.clientHeight), `o painel transborda em ${onde}`).toBeLessThanOrEqual(0.5);
    const cancelar = await caixa(doPainel(page, 'Cancelar'));
    expect(cancelar.y + cancelar.height, `o Cancelar encosta no Desligar em ${onde}`).toBeLessThanOrEqual((await caixa(botao(page, 'Desligar'))).y);
    await semRolar(page, onde);
    // Pelo menos uma linha de contato inteira à vista na lista.
    const l = await caixa(lista);
    const linha = await caixa(lista.getByRole('option').first());
    expect(linha.y >= l.y - 0.5 && linha.y + linha.height <= l.y + l.height + 0.5, `nenhum contato inteiro na lista em ${onde}`).toBe(true);
    // A ajuda à vista, menos no Mínimo (como o Transferir, sem ela, para o resto caber); ela sempre descreve o campo.
    if (layout === 'minimo') await expect(ajuda(page), onde).toBeHidden();
    else await expect(ajuda(page), onde).toBeVisible();
    await expect(campo(page), onde).toHaveAccessibleDescription(AJUDA);
    // A sua imagem à vista, e o "Em videochamada" numa linha só.
    await suaImagemAVista(page, largura, altura, onde);
    const eyebrow = await page
      .locator('.who-compact .eyebrow')
      .evaluate((e) => ({ altura: e.getBoundingClientRect().height, linha: parseFloat(getComputedStyle(e).fontSize) * 1.5 }));
    expect(eyebrow.altura, `o "Em videochamada" em duas linhas em ${onde}`).toBeLessThan(eyebrow.linha);
  }
});

test('the video call controls fit the three sizes with Adicionar pessoa', async ({ page }) => {
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'video');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    const controles = page.locator('.ctrls button.ctrl');
    await expect(controles).toHaveCount(9);
    // Cada controle inteiro na janela, com o rótulo inteiro na coluna: o Adicionar pessoa quebra em duas linhas, como o
    // Nova ligação.
    for (const c of await controles.all()) {
      const b = await caixa(c);
      expect(dentro(b, largura, altura), `${await c.innerText()} fora da janela em ${onde}: ${JSON.stringify(b)}`).toBe(true);
    }
    const sobram = await controles.evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => b.textContent?.trim()));
    expect(sobram, `rótulos maiores que a coluna em ${onde}`).toEqual([]);
    const adicionar = await caixa(adicionarPessoa(page));
    const nova = await caixa(botao(page, 'Nova ligação'));
    expect(Math.abs(adicionar.height - nova.height), `o Adicionar pessoa e o Nova ligação em ${onde}`).toBeLessThanOrEqual(1);
    // A área do vídeo passa de 100 de altura, e a página não rola.
    const area = await caixa(page.getByRole('img', { name: 'Vídeo de Ana Souza', exact: true }));
    expect(area.height, `a área do vídeo em ${onde}`).toBeGreaterThan(100);
    await semRolar(page, onde);
  }
});
