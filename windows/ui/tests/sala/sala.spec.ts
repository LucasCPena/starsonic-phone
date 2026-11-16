// (0.4.0) A sala de vídeo na tela da ligação (os quadros Sala, SalaEstados, SalaCheia, SalaCompacto e SalaMinimo), contra a
// ponte falsa: o mosaico com o nome de cada convidado na imagem dele, os quadros de quem ainda chama, está sem vídeo ou em
// espera, a sala cheia, o Adicionar pessoa dentro da sala, a videochamada que vira sala e volta a ser uma, a vista que
// nunca mostra um quadro de antes, a Câmera e o Abrir grande da sala, o convidado que não atende, os três tamanhos e o
// iPhone, onde nada da sala aparece.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { arrumacao } from '../../src/sala/mosaico';
import type { ParticipanteDaSala } from '../../src/state';
import { SEM_VIDEO } from '../../src/video/estado';
import { abrir, comandos, depoisDoQueChegou, esperarComando, estado, mudarEstado, segurarCpp, semViolacoesSerias, soltarCpp, vezes } from '../helpers';
import { corNoMeio, corNoPonto, FUNDO, perto, quadro, quadrosDeTela, VERMELHO } from '../video/video';
import { imagemDe, mosaicoDaSala, quadroDe, RGB } from './sala';

type Caixa = { x: number; y: number; width: number; height: number };

/** Os três tamanhos da janela e o layout de cada um (layout.ts). */
const TAMANHOS = [
  [400, 720, 'normal'],
  [360, 600, 'compacto'],
  [300, 440, 'minimo'],
] as const;

const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const adicionarPessoa = (page: Page) => botao(page, 'Adicionar pessoa');
const campo = (page: Page) => page.getByRole('combobox', { name: 'Adicionar à sala', exact: true });
const doPainel = (page: Page, nome: 'Adicionar' | 'Cancelar') => page.locator('.call-panel').getByRole('button', { name: nome, exact: true });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const mosaicoGrupo = (page: Page) => page.getByRole('group', { name: 'Mosaico da sala', exact: true });
/** A área do vídeo da sala (a caixa que guarda o mosaico e a sua imagem). */
const area = (page: Page) => page.locator('.sala-caixa');

async function caixa(alvo: Locator): Promise<Caixa> {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function dentro(b: Caixa, largura: number, altura: number): boolean {
  return b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= largura + 0.5 && b.y + b.height <= altura + 0.5;
}

/** `b` inteira dentro de `por`, com a folga de meio pixel. */
function noInteiro(b: Caixa, por: Caixa): boolean {
  return b.x >= por.x - 0.5 && b.y >= por.y - 0.5 && b.x + b.width <= por.x + por.width + 0.5 && b.y + b.height <= por.y + por.height + 0.5;
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

/** Cada botão à vista inteiro na janela. */
async function botoesNaJanela(page: Page, largura: number, altura: number, onde: string): Promise<void> {
  const botoes = page.locator('button:visible');
  expect(await botoes.count(), `nenhum botão em ${onde}`).toBeGreaterThan(0);
  for (const b of await botoes.all()) {
    const c = await caixa(b);
    const nome = (await b.getAttribute('aria-label')) ?? (await b.innerText());
    expect(dentro(c, largura, altura), `o botão ${nome} fora da janela em ${onde}: ${JSON.stringify(c)}`).toBe(true);
  }
}

/** Os salaAdicionar que saíram, na ordem. */
async function adicoes(page: Page): Promise<unknown[]> {
  return (await comandos(page)).filter((c) => c.cmd === 'salaAdicionar');
}

/** Os comandos depois do `antes`-ésimo, sem o `videoViews` (as vistas que voltam à tela são à parte). */
async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes).filter((c) => c.cmd !== 'videoViews');
}

const mandar = (page: Page, comando: Record<string, unknown>) =>
  page.evaluate((c) => (window as unknown as { __fake: { mandar(c: unknown): void } }).__fake.mandar(c), comando);

/** A sala de agora do estado da ponte falsa. */
const salaDoEstado = async (page: Page) => (await estado(page)).ligacao.sala as { participantes: ParticipanteDaSala[]; id: number };

/** A sala com `mudar` aplicado (e o resto do estado como está). */
const naSala = (page: Page, mudar: (sala: Record<string, any>) => Record<string, any>) =>
  mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, sala: mudar(s.ligacao.sala) } }));

/** O convidado de número `numero` com o que mudar, nos mesmos quadros. */
const convidado = (numero: string, mudar: Record<string, unknown>) => (sala: Record<string, any>) => ({
  ...sala,
  participantes: sala.participantes.map((p: ParticipanteDaSala) => (p.numero === numero ? { ...p, ...mudar } : p)),
});

/** A Bia Ramos entra na sala, com a imagem, e todos vão para a arrumação de 3. */
const comABia = (sala: Record<string, any>) => {
  const quadros = arrumacao(sala.participantes.length + 1);
  const bia = { id: 13, numero: '2005', nome: 'Bia Ramos', estado: 'naSala', imagem: true };
  return { ...sala, participantes: [...sala.participantes, bia].map((p, i) => ({ ...p, quadro: quadros[i] })) };
};

/** Abre o painel de adicionar na sala. */
async function abrirOPainel(page: Page): Promise<void> {
  await adicionarPessoa(page).click();
  await expect(campo(page)).toBeFocused();
}

test('the room shows the mosaic with each name on its tile, your image and the room controls', async ({ page }) => {
  await abrir(page, 'sala');
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toBeVisible();
  const mosaico = mosaicoGrupo(page);
  await expect(mosaico).toBeVisible();
  for (const nome of ['Ana Souza', 'Carlos Lima']) {
    const q = mosaico.getByRole('group', { name: nome, exact: true });
    await expect(q).toBeVisible();
    await expect(q.getByRole('img', { name: `Vídeo de ${nome}`, exact: true })).toBeVisible();
    // O nome à vista, na imagem dele.
    await expect(q.getByText(nome, { exact: true })).toBeVisible();
  }
  // Quem fala: o nome da sala e a conta, com o tempo da sala.
  await expect(page.locator('.who-sala .who-name')).toHaveText('Sala de vídeo');
  await expect(page.getByText(/^3 pessoas · 05:4\d$/)).toBeVisible();
  // Os controles da sala, e só eles, e o Desligar.
  await expect(page.locator('.ctrls > *')).toHaveText(['Mudo', 'Câmera', 'Adicionar pessoa', 'Abrir grande']);
  await expect(page.locator('.ctrls')).toHaveClass(/(^|\s)ctrls-4(\s|$)/);
  await expect(botao(page, 'Desligar')).toBeVisible();
  for (const fora of ['Teclado', 'Espera', 'Transferir', 'Nova ligação', 'Atalhos', 'Áudio', 'Conferência', 'Chat']) {
    await expect(page.getByRole('button', { name: fora, exact: true }), fora).toHaveCount(0);
  }
  // A sua imagem dentro da área do vídeo, e as duas vistas à vista do núcleo.
  const sua = await caixa(suaImagem(page));
  expect(noInteiro(sua, await caixa(area(page))), 'a sua imagem dentro da área do vídeo').toBe(true);
  await esperarComando(page, { cmd: 'videoViews', pagina: 'principal', vistas: ['local', 'remoto'] });
  await semViolacoesSerias(page);
});

test('each name sits on its guest image, in the three sizes', async ({ page }) => {
  const cores = [
    ['Ana Souza', RGB.BRANCO],
    ['Carlos Lima', RGB.VERDE],
  ] as const;
  /** O meio de cada imagem na cor do convidado, o nome no canto de baixo à esquerda dela, e o alto da área no fundo. */
  const conferir = async (onde: string) => {
    await expect
      .poll(async () => (await Promise.all(cores.map(async ([nome, cor]) => perto(await corNoMeio(page, imagemDe(page, nome)), cor)))).every(Boolean), { message: `as cores dos convidados em ${onde}` })
      .toBe(true);
    const a = await caixa(area(page));
    const acima = await corNoPonto(page, Math.floor(a.x + a.width / 2), Math.floor(a.y + 5));
    expect(perto(acima, FUNDO), `o alto da área do vídeo em ${onde}: ${acima}`).toBe(true);
    for (const [nome] of cores) {
      const imagem = await caixa(imagemDe(page, nome));
      const nomeNaImagem = await caixa(quadroDe(page, nome).getByText(nome, { exact: true }));
      expect(noInteiro(nomeNaImagem, imagem), `o nome de ${nome} dentro da imagem dele em ${onde}`).toBe(true);
      expect(nomeNaImagem.x - imagem.x, `o nome de ${nome} longe do canto esquerdo em ${onde}`).toBeLessThanOrEqual(12);
      expect(imagem.y + imagem.height - (nomeNaImagem.y + nomeNaImagem.height), `o nome de ${nome} longe do canto de baixo em ${onde}`).toBeLessThanOrEqual(12);
      // A imagem é 4:3, encaixada no quadro dele.
      expect(Math.abs(imagem.width / imagem.height - 4 / 3), `a imagem de ${nome} não é 4:3 em ${onde}`).toBeLessThan(0.02);
    }
  };
  for (const tema of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const [largura, altura] of TAMANHOS) {
      await page.setViewportSize({ width: largura, height: altura });
      await abrir(page, 'sala');
      await mosaicoDaSala(page);
      await conferir(`${largura}×${altura} (${tema})`);
    }
  }
  // O tamanho da janela que muda com a sala aberta: o mosaico se desenha de novo.
  await page.setViewportSize({ width: 400, height: 720 });
  await abrir(page, 'sala');
  await mosaicoDaSala(page);
  await conferir('400×720 antes de mudar');
  for (const [largura, altura] of [TAMANHOS[2], TAMANHOS[1], TAMANHOS[0]]) {
    await page.setViewportSize({ width: largura, height: altura });
    await conferir(`${largura}×${altura} depois de mudar`);
  }
});

test('the tiles show Chamando…, Sem vídeo and Em espera with the initials', async ({ page }) => {
  await abrir(page, 'sala-estados');
  // O Carlos ainda chama, a Bia está sem vídeo e o Davi pôs você em espera; a Ana tem a imagem.
  await expect(imagemDe(page, 'Ana Souza')).toBeVisible();
  for (const [nome, iniciais, estadoDele] of [
    ['Carlos Lima', 'CL', 'Chamando…'],
    ['Bia Ramos', 'BR', 'Sem vídeo'],
    ['Davi Nunes', 'DN', 'Em espera'],
  ] as const) {
    const q = quadroDe(page, nome);
    await expect(q.getByText(iniciais, { exact: true }), `as iniciais de ${nome}`).toBeVisible();
    await expect(q.getByText(nome, { exact: true }), `o nome de ${nome}`).toBeVisible();
    await expect(q.getByText(estadoDele, { exact: true }), `o estado de ${nome}`).toBeVisible();
    // Sem a imagem dele.
    await expect(imagemDe(page, nome)).toHaveCount(0);
  }
  // Os que chamam, quem está sem vídeo e quem está em espera contam como pessoas: os 4 convidados e você.
  await expect(page.getByText(/^5 pessoas · 08:\d\d$/)).toBeVisible();
  // Um convidado sem nome mostra o número, e o ícone do telefone no lugar das iniciais.
  await naSala(page, convidado('2006', { nome: '' }));
  const sem = quadroDe(page, '2006');
  await expect(sem.getByText('2006', { exact: true })).toBeVisible();
  await expect(sem.locator('.sala-iniciais svg')).toHaveCount(1);
  await expect(sem.getByText('?', { exact: true })).toHaveCount(0);
  await semViolacoesSerias(page);
});

test('a full room disables Adicionar pessoa and says why', async ({ page }) => {
  await abrir(page, 'sala-cheia');
  await expect(adicionarPessoa(page)).toBeDisabled();
  await expect(adicionarPessoa(page)).toHaveAccessibleDescription('A sala já tem 6 pessoas.');
  await expect(page.getByText('A sala já tem 6 pessoas.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^6 pessoas · 12:\d\d$/)).toBeVisible();
  // Os cinco quadros, nas posições da arrumação do núcleo para 5, em frações do mosaico.
  const g = await caixa(mosaicoGrupo(page));
  const quadros = arrumacao(5);
  const nomes = ['Ana Souza', 'Carlos Lima', 'Bia Ramos', 'Davi Nunes', 'Elisa Prado'];
  for (const [i, nome] of nomes.entries()) {
    const b = await caixa(quadroDe(page, nome));
    const q = quadros[i];
    expect(Math.abs(b.x - (g.x + q.x * g.width)), `x de ${nome}`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - (g.y + q.y * g.height)), `y de ${nome}`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - q.largura * g.width), `largura de ${nome}`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - q.altura * g.height), `altura de ${nome}`).toBeLessThanOrEqual(1);
  }
  await semViolacoesSerias(page);
});

test('the name tag follows the layout, not the count', async ({ page }) => {
  // O texto do nome (o tamanho, o recuo e o canto) por layout e por como os quadros se arrumam: 1 ou 2 convidados, 3 ou 4
  // (a grade 2×2) e 5 (3 + 2).
  const esperado = {
    normal: { 2: ['11px', '3px 8px', '6px'], 3: ['10.5px', '2px 7px', '6px'], 5: ['9.5px', '2px 6px', '4px'] },
    compacto: { 2: ['10.5px', '2px 7px', '5px'], 3: ['10px', '2px 6px', '5px'], 5: ['9.5px', '2px 6px', '4px'] },
    minimo: { 2: ['10px', '2px 6px', '4px'], 3: ['9.5px', '1px 5px', '4px'], 5: ['9px', '1px 5px', '3px'] },
  } as const;
  const davi = (sala: Record<string, any>) => ({
    ...sala,
    participantes: [...sala.participantes, { id: 14, numero: '2006', nome: 'Davi Nunes', estado: 'naSala', imagem: true }].map((p, i) => ({ ...p, quadro: arrumacao(4)[i] })),
  });
  for (const [largura, altura, layout] of TAMANHOS) {
    await page.setViewportSize({ width: largura, height: altura });
    const conferir = async (quantos: 2 | 3 | 5, nome: string) => {
      const [tamanho, recuo, canto] = esperado[layout][quantos];
      const onde = `${nome} com ${quantos} em ${layout}`;
      await expect
        .poll(
          () =>
            quadroDe(page, nome)
              .locator('.sala-nome')
              .evaluate((e) => {
                const c = getComputedStyle(e);
                return [c.fontSize, `${c.paddingTop} ${c.paddingLeft}`, c.left, c.bottom];
              }),
          { message: `o nome em ${onde}` },
        )
        .toEqual([tamanho, recuo, canto, canto]);
    };
    await abrir(page, 'sala');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    await conferir(2, 'Ana Souza');
    // Três e quatro convidados: a mesma grade, o mesmo nome.
    await naSala(page, comABia);
    await expect(quadroDe(page, 'Bia Ramos')).toBeVisible();
    await conferir(3, 'Ana Souza');
    await naSala(page, davi);
    await expect(quadroDe(page, 'Davi Nunes')).toBeVisible();
    await conferir(3, 'Davi Nunes');
    await abrir(page, 'sala-cheia');
    await conferir(5, 'Ana Souza');
  }
});

test('Adicionar pessoa in the room opens the panel, and the new guest is called', async ({ page }) => {
  await abrir(page, 'sala');
  await abrirOPainel(page);
  // O alto do painel: Em videochamada, o nome da sala e a conta com o tempo; o mosaico sai, e a sua imagem flutua no canto.
  const alto = page.locator('.who-compact');
  await expect(alto.locator('.eyebrow')).toHaveText('Em videochamada');
  await expect(alto.locator('.who-name')).toHaveText('Sala de vídeo');
  await expect(alto.getByText(/^3 pessoas · 05:\d\d$/)).toBeVisible();
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(suaImagem(page)).toBeVisible();
  await semViolacoesSerias(page);
  // A sua imagem no canto de baixo à direita: a 24 de cada borda da tela da sala, no máximo (a regra da Task 3).
  const corpo = await caixa(page.locator('.call-body'));
  const sua = await caixa(suaImagem(page));
  expect(corpo.x + corpo.width - (sua.x + sua.width), 'a sua imagem longe da borda direita').toBeLessThanOrEqual(24);
  expect(corpo.y + corpo.height - (sua.y + sua.height), 'a sua imagem longe da borda de baixo').toBeLessThanOrEqual(24);

  await campo(page).fill('2005');
  await doPainel(page, 'Adicionar').click();
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '2005' });
  // O painel fecha, e o quadro novo chama, já contado: 4 pessoas.
  await expect(campo(page)).toHaveCount(0);
  const novo = quadroDe(page, '2005');
  await expect(novo.getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(page.getByText(/^4 pessoas · /)).toBeVisible();
  // Atende em 1,5 s: a imagem dele, e ainda 4 pessoas.
  await expect(imagemDe(page, '2005')).toBeVisible({ timeout: 4000 });
  await expect(novo.getByText('Chamando…', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^4 pessoas · /)).toBeVisible();
  expect(await adicoes(page)).toEqual([{ v: 1, cmd: 'salaAdicionar', numero: '2005' }]);
});

test('the add panel closes when the room fills up or you leave it', async ({ page }) => {
  await abrir(page, 'sala');
  const inicial = await estado(page);
  const emCima = inicial.ligacao;
  await abrirOPainel(page);
  // A sala enche: o painel fecha, e o aviso aparece.
  await naSala(page, (sala) => ({ ...sala, cheia: true }));
  await expect(campo(page)).toHaveCount(0);
  await expect(adicionarPessoa(page)).toBeDisabled();
  // Ela deixa de estar cheia: o pedido de antes não vale mais, e o painel não volta sozinho (Task 3, Minor 2).
  await naSala(page, (sala) => ({ ...sala, cheia: false }));
  await expect(adicionarPessoa(page)).toBeEnabled();
  await depoisDoQueChegou(page);
  await expect(campo(page)).toHaveCount(0);
  // Aberto de novo, você sai da sala: o Roberto atendido em cima, e a sala em espera embaixo (com o `fora`).
  await abrirOPainel(page);
  const roberto = { id: 16, number: '2012', name: 'Roberto Lima', incoming: true, phase: 'active', activeSinceMs: Date.now() - 42_000, held: false, video: { ...SEM_VIDEO } };
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      top: roberto,
      second: { ...emCima.top, held: true },
      secondKind: 'held',
      sala: { ...s.ligacao.sala, fora: true },
    },
  }));
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toHaveCount(0);
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(campo(page)).toHaveCount(0);
  // De volta à sala, em cima: ela vem sem o painel.
  await mudarEstado(page, () => inicial);
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toBeVisible();
  await expect(mosaicoGrupo(page)).toBeVisible();
  await expect(campo(page)).toHaveCount(0);
  expect(await adicoes(page)).toEqual([]);
});

test('a video call becomes the room after Adicionar, and back to the call with one guest left', async ({ page }) => {
  await abrir(page, 'video');
  await adicionarPessoa(page).click();
  await expect(campo(page)).toBeFocused();
  // O Carlos pelo contato: "car", a seta para baixo e o Enter.
  await campo(page).fill('car');
  await campo(page).press('ArrowDown');
  await campo(page).press('Enter');
  await doPainel(page, 'Adicionar').click();
  await esperarComando(page, { cmd: 'salaAdicionar', numero: '2007', contato: true });
  // A sala com a Ana e o Carlos: ele chama, e depois a imagem dele chega.
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toBeVisible();
  await expect(mosaicoGrupo(page)).toBeVisible();
  await expect(imagemDe(page, 'Ana Souza')).toBeVisible();
  await expect(quadroDe(page, 'Carlos Lima').getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(imagemDe(page, 'Carlos Lima')).toBeVisible({ timeout: 4000 });
  // Quem ficou sozinho é a ligação de novo: a Ana, na videochamada comum (o `salaTirar` do Carlos).
  const carlos = (await salaDoEstado(page)).participantes.find((p) => p.numero === '2007')!;
  await mandar(page, { cmd: 'salaTirar', id: carlos.id });
  await expect(page.getByRole('main', { name: 'Ligação', exact: true })).toBeVisible();
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(imagemDe(page, 'Ana Souza')).toBeVisible();
  await expect(page.getByText('Ramal 2003', { exact: false }).first()).toBeVisible();
  const grande = await caixa(imagemDe(page, 'Ana Souza'));
  expect(grande.height, 'a imagem da Ana grande').toBeGreaterThan(150);
});

test("the room's view never shows a frame of the call before it, nor the call after it a frame of the room", async ({ page }) => {
  await abrir(page, 'video');
  // Um quadro vermelho da Ana na videochamada.
  await quadro(page, 'remoto', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDe(page, 'Ana Souza')), RGB.VERMELHO), { message: 'o vermelho da Ana' }).toBe(true);
  // O Adicionar pessoa com o 2007: a sala nasce, com o vermelho ainda na memória do `remoto`.
  await adicionarPessoa(page).click();
  await campo(page).fill('2007');
  await doPainel(page, 'Adicionar').click();
  await expect(mosaicoGrupo(page)).toBeVisible();
  await expect(imagemDe(page, 'Ana Souza')).toBeVisible();
  await quadrosDeTela(page, 4);
  const naSalaAgora = await corNoMeio(page, imagemDe(page, 'Ana Souza'));
  expect(perto(naSalaAgora, FUNDO), `um quadro da ligação na sala: ${naSalaAgora}`).toBe(true);
  // O mosaico da sala chega: branco.
  await mosaicoDaSala(page);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDe(page, 'Ana Souza')), RGB.BRANCO), { message: 'o mosaico da sala' }).toBe(true);
  // O Carlos sai: a videochamada de volta, sem um quadro do mosaico, e depois só o que chega nela.
  const carlos = (await salaDoEstado(page)).participantes.find((p) => p.numero === '2007')!;
  await mandar(page, { cmd: 'salaTirar', id: carlos.id });
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(imagemDe(page, 'Ana Souza')).toBeVisible();
  await quadrosDeTela(page, 4);
  const deVolta = await corNoMeio(page, imagemDe(page, 'Ana Souza'));
  expect(perto(deVolta, FUNDO), `um quadro da sala na ligação: ${deVolta}`).toBe(true);
  await quadro(page, 'remoto', [145, 54, 34]);
  await expect.poll(async () => perto(await corNoMeio(page, imagemDe(page, 'Ana Souza')), RGB.VERDE), { message: 'o verde da Ana' }).toBe(true);
});

test("the room's Câmera and Abrir grande", async ({ page }) => {
  await abrir(page, 'sala');
  await expect(suaImagem(page)).toBeVisible();
  await botao(page, 'Desligar a câmera').click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(suaImagem(page)).toHaveCount(0);
  await botao(page, 'Ligar a câmera').click();
  await esperarComando(page, { cmd: 'camera', on: true });
  await expect(suaImagem(page)).toBeVisible();
  // O Abrir grande pede a janela grande.
  await botao(page, 'Abrir grande').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
});

test('a double click on Abrir grande asks for the big window once', async ({ page }) => {
  await abrir(page, 'sala');
  // O C++ lento: o segundo clique cai no mesmo botão, com a tela ainda a da sala.
  await segurarCpp(page);
  await botao(page, 'Abrir grande').dblclick();
  await soltarCpp(page);
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(1);
});

test('a guest who does not answer leaves with the reason', async ({ page }) => {
  await abrir(page, 'sala');
  await abrirOPainel(page);
  await campo(page).fill('486');
  await doPainel(page, 'Adicionar').click();
  await expect(quadroDe(page, '486').getByText('Chamando…', { exact: true })).toBeVisible();
  await expect(page.getByText(/^4 pessoas · /)).toBeVisible();
  // Ocupado em 1,5 s: ele sai, com o motivo, e os outros voltam à arrumação de 2.
  await expect(quadroDe(page, '486')).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByText('486: Ocupado', { exact: true })).toBeVisible();
  await expect(page.getByText(/^3 pessoas · /)).toBeVisible();
  const g = await caixa(mosaicoGrupo(page));
  for (const [i, nome] of ['Ana Souza', 'Carlos Lima'].entries()) {
    const b = await caixa(quadroDe(page, nome));
    const q = arrumacao(2)[i];
    expect(Math.abs(b.x - (g.x + q.x * g.width)), `x de ${nome}`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - q.largura * g.width), `largura de ${nome}`).toBeLessThanOrEqual(1);
  }
});

test('the room screen fits the three sizes', async ({ page }) => {
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    await expect(mosaicoGrupo(page)).toBeVisible();
    await semRolar(page, onde);
    await botoesNaJanela(page, largura, altura, onde);
    // O mosaico dentro da área do vídeo, na largura 16/9 da altura.
    const a = await caixa(area(page));
    const g = await caixa(mosaicoGrupo(page));
    expect(noInteiro(g, a), `o mosaico fora da área do vídeo em ${onde}: ${JSON.stringify({ a, g })}`).toBe(true);
    expect(Math.abs(g.width - (g.height * 16) / 9), `o mosaico não é 16/9 em ${onde}: ${JSON.stringify(g)}`).toBeLessThanOrEqual(1);
    expect(a.height, `a área do vídeo em ${onde}`).toBeGreaterThan(100);
    // O Desligar e os controles: cada um inteiro; a conta numa linha só no Mínimo, com os quatro controles e o Desligar numa fila.
    const sala = page.getByText(/^(Sala de vídeo · )?3 pessoas · 05:\d\d$/);
    await expect(sala, onde).toBeVisible();
    if (layout === 'minimo') {
      await expect(page.getByText(/^Sala de vídeo · 3 pessoas · 05:\d\d$/)).toBeVisible();
      const linha = await caixa(page.locator('.who-linha'));
      const fonte = await page.locator('.who-linha').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      expect(linha.height, `a conta em mais de uma linha em ${onde}`).toBeLessThan(fonte * 1.8);
      const meios = [];
      for (const b of [...(await page.locator('.ctrls button').all()), botao(page, 'Desligar')]) {
        const c = await caixa(b);
        meios.push(c.y + c.height / 2);
      }
      expect(meios).toHaveLength(5);
      expect(Math.max(...meios) - Math.min(...meios), `os controles e o Desligar numa fila em ${onde}: ${meios}`).toBeLessThanOrEqual(1);
      // Os rótulos fora da vista, e o nome de cada botão fica.
      for (const nome of ['Mudo', 'Desligar a câmera', 'Adicionar pessoa', 'Abrir grande']) await expect(botao(page, nome), nome).toBeVisible();
    } else {
      await expect(page.locator('.who-sala .who-name')).toHaveText('Sala de vídeo');
    }
  }
});

test('the room screen with the outside call card and the add panel fits the three sizes', async ({ page }) => {
  for (const [largura, altura, layout] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala-de-volta');
    await expect(page.locator(`.win[data-layout="${layout}"]`)).toHaveCount(1);
    // O cartão da ligação de fora em espera, em cima, e o painel de adicionar aberto.
    await expect(page.locator('.vcard').getByText('Roberto Lima', { exact: true })).toBeVisible();
    await abrirOPainel(page);
    await campo(page).fill('car');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveText([/Carlos Lima/]);
    await botoesNaJanela(page, largura, altura, onde);
    await semRolar(page, onde);
    expect(await page.locator('.call-middle').evaluate((e) => e.scrollHeight - e.clientHeight), `o painel transborda em ${onde}`).toBeLessThanOrEqual(0.5);
    const cancelar = await caixa(doPainel(page, 'Cancelar'));
    expect(cancelar.y + cancelar.height, `o Cancelar encosta no Desligar em ${onde}`).toBeLessThanOrEqual((await caixa(botao(page, 'Desligar'))).y);
    // O cartão e o painel não se cobrem, e a sua imagem fica no canto, sem cobrir o painel nem o Desligar.
    const cartao = await caixa(page.locator('.vcard'));
    const campoCaixa = await caixa(campo(page));
    expect(cartao.y + cartao.height, `o cartão cobre o campo em ${onde}`).toBeLessThanOrEqual(campoCaixa.y + 0.5);
    const sua = await caixa(suaImagem(page));
    expect(dentro(sua, largura, altura), `a sua imagem fora da janela em ${onde}`).toBe(true);
    for (const [nome, alvo] of [
      ['o campo', campo(page)],
      ['o Adicionar', doPainel(page, 'Adicionar')],
      ['o Cancelar', doPainel(page, 'Cancelar')],
      ['o Desligar', botao(page, 'Desligar')],
      ['o cartão', page.locator('.vcard')],
    ] as const) {
      const c = await caixa(alvo);
      const cobre = sua.x < c.x + c.width && c.x < sua.x + sua.width && sua.y < c.y + c.height && c.y < sua.y + sua.height;
      expect(cobre, `a sua imagem cobre ${nome} em ${onde}: ${JSON.stringify({ sua, c })}`).toBe(false);
    }
    // A sua imagem no canto de baixo à direita.
    const corpo = await caixa(page.locator('.call-body'));
    expect(corpo.x + corpo.width - (sua.x + sua.width), `a sua imagem longe da borda direita em ${onde}`).toBeLessThanOrEqual(24);
    expect(corpo.y + corpo.height - (sua.y + sua.height), `a sua imagem longe da borda de baixo em ${onde}`).toBeLessThanOrEqual(24);
  }
});

test('on the iPhone nothing of the room shows', async ({ page }) => {
  await abrir(page, 'video&plataforma=ios');
  // Um estado com o `ligacao.sala` e a linha da sala em cima: no iPhone, é uma ligação comum.
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      sala: {
        id: s.ligacao.top.id,
        fora: false,
        cheia: false,
        participantes: [
          { id: 11, numero: '2003', nome: 'Ana Souza', estado: 'naSala', imagem: true, quadro: arrumacao(2)[0] },
          { id: 12, numero: '2007', nome: 'Carlos Lima', estado: 'naSala', imagem: true, quadro: arrumacao(2)[1] },
        ],
      },
    },
  }));
  await depoisDoQueChegou(page);
  await expect(botao(page, 'Mudo')).toBeVisible();
  await expect(page.getByText('Sala de vídeo')).toHaveCount(0);
  await expect(mosaicoGrupo(page)).toHaveCount(0);
  await expect(adicionarPessoa(page)).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Ligação', exact: true })).toBeVisible();
  // O Desligar de sempre.
  const id = (await estado(page)).ligacao.top.id;
  await botao(page, 'Desligar').click();
  await esperarComando(page, { cmd: 'hangup', id });
  expect(await vezes(page, { cmd: 'salaEncerrar' })).toBe(0);
  expect(await depois(page, 0)).toContainEqual({ v: 1, cmd: 'hangup', id });
});
