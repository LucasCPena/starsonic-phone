// O grande e a tela cheia (video etapa 2, Task 7; os quadros Grande e TelaCheia) contra a ponte falsa: só o vídeo, a sua
// imagem no canto, a etiqueta de quem fala e a barra de baixo; o Diminuir, a Tela cheia, o duplo clique e o Esc; o cartão
// da segunda ligação; a sua imagem sempre à vista com a câmera ligada (Review Focus 2); e as medidas dos dois quadros. Do
// passe final: nada desenhado com a segunda ligação (Ruling 13), o clique duplo no Abrir grande que fica no grande (Ruling
// 14) e a barra de baixo numa área de trabalho pequena com o painel do chat (Ruling 15, com o servidor do chat de teste).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirNoChat, esperarOsEventos } from '../chat/abrir';
import { empresaComPessoas } from '../chat/servidor';
import { abrir, depoisDoQueChegou, esperarComando, estado, mudarEstado, semViolacoesSerias, vezes } from '../helpers';
import { BRANCO, FUNDO, VERMELHO, corNoMeio, perto, quadro, quadrosDeTela } from './video';

test.use({ viewport: { width: 1280, height: 800 } });

const RGB_DO_VERMELHO = [255, 1, 0];
const RGB_DO_BRANCO = [255, 255, 255];
/** O Carlos (o id 12), sem vídeo: a segunda ligação dos testes. */
const CARLOS = { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, video: { oferece: false, ativo: false, imagem: false, camera: false, cedo: false } };

const remoto = (page: Page) => page.getByRole('img', { name: 'Vídeo de Ana Souza', exact: true });
const suaImagem = (page: Page) => page.getByRole('img', { name: 'Sua imagem', exact: true });
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
/** Os botões da barra de baixo, na ordem da tela. */
const barraDeBaixo = (page: Page) => page.locator('.grande-barra button');
const nomes = (b: Locator) => b.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? ''));

async function caixa(alvo: Locator) {
  const b = await alvo.boundingBox();
  expect(b, 'o alvo na tela').not.toBeNull();
  return b!;
}

function quase(valor: number, esperado: number, msg: string) {
  expect(Math.abs(valor - esperado), `${msg}: ${valor} perto de ${esperado}`).toBeLessThanOrEqual(1);
}

test('the big window shows only the video, your image and the bottom bar', async ({ page }) => {
  await abrir(page, 'video-grande');
  await expect(page.getByRole('button', { name: 'Minimizar' })).toBeVisible();
  await expect(page.locator('[data-resize]')).toHaveCount(0);
  const r = await caixa(remoto(page));
  quase(r.x, 0, 'o vídeo à esquerda');
  quase(r.width, 1280, 'a largura do vídeo');
  await expect(page.getByText(/^Ana Souza · Ramal 2003 · 03:1\d$/)).toBeVisible();
  const s = await caixa(suaImagem(page));
  quase(s.width, 224, 'a largura da sua imagem');
  quase(s.height, 168, 'a altura da sua imagem');
  quase(1280 - (s.x + s.width), 24, 'a sua imagem a 24 da direita');
  quase(800 - (s.y + s.height), 128, 'a sua imagem a 128 de baixo');
  expect(await nomes(barraDeBaixo(page))).toEqual(['Mudo', 'Desligar a câmera', 'Tela cheia', 'Diminuir', 'Desligar']);
  await expect(botao(page, 'Chat')).toHaveCount(0);
  // A tela da ligação não está aqui: nem o Teclado, nem o Espera.
  await expect(page.getByRole('button', { name: 'Teclado', exact: true })).toHaveCount(0);
});

test('Diminuir and Tela cheia ask the window', async ({ page }) => {
  await abrir(page, 'video-grande');
  await botao(page, 'Diminuir').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'normal' });
  await abrir(page, 'video-grande');
  await botao(page, 'Tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(page.getByRole('button', { name: 'Minimizar' })).toHaveCount(0);
  await expect(botao(page, 'Tela cheia')).toHaveCount(0);
  await botao(page, 'Sair da tela cheia').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(page.getByRole('button', { name: 'Minimizar' })).toBeVisible();
});

test('double click on the video goes in and out of the full screen, and Esc goes out', async ({ page }) => {
  await abrir(page, 'video-grande');
  await remoto(page).dblclick();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'telaCheia' });
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  await remoto(page).dblclick();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await botao(page, 'Tela cheia').click();
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
  // Os efeitos do último desenho rodam depois da pintura: o ouvinte do Esc já está lá.
  await depoisDoQueChegou(page);
  const antes = await vezes(page, { cmd: 'videoWindow', modo: 'grande' });
  await page.keyboard.press('Escape');
  await expect.poll(() => vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(antes + 1);
  // No grande (a ponte falsa já respondeu e o ouvinte saiu), o Esc não faz nada.
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await depoisDoQueChegou(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(antes + 1);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(0);
});

test('Abrir grande opens the big window', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 700 });
  await abrir(page, 'video');
  await botao(page, 'Abrir grande').click();
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(botao(page, 'Diminuir')).toBeVisible();
  await expect(botao(page, 'Tela cheia')).toBeVisible();
  await expect(remoto(page)).toBeVisible();
});

test('a double click on Abrir grande opens the big window and stays there', async ({ page }) => {
  await abrir(page, 'video');
  // O clique duplo de quem vem de um softphone de mesa: o primeiro clique abre o grande, e o segundo (o `detail` 2), no
  // mesmo ponto, cai no vídeo dele. Aqui ele vem depois de o grande aparecer (o executável pode mudar a janela antes do
  // segundo clique): só o segundo par do clique duplo, com o clickCount 2.
  const a = await caixa(botao(page, 'Abrir grande'));
  const ponto = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  await page.mouse.click(ponto.x, ponto.y);
  await esperarComando(page, { cmd: 'videoWindow', modo: 'grande' });
  await expect(botao(page, 'Diminuir')).toBeVisible();
  const noVideo = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.grande-video') != null, ponto);
  expect(noVideo, `o vídeo do grande embaixo do Abrir grande (${JSON.stringify(ponto)})`).toBe(true);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'grande' })).toBe(1);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'telaCheia' })).toBe(0);
  await expect(botao(page, 'Tela cheia')).toBeVisible();
});

test('the call screen comes back when the call ends', async ({ page }) => {
  await abrir(page, 'video-grande');
  const id = (await estado(page)).ligacao.top.id;
  await botao(page, 'Desligar').click();
  await esperarComando(page, { cmd: 'hangup', id });
  await expect(page.getByRole('button', { name: 'Teclado', exact: true }).first()).toBeVisible();
  await expect(botao(page, 'Diminuir')).toHaveCount(0);
});

test('a second call in the big window shows its card', async ({ page }) => {
  await abrir(page, 'video-grande');
  await mudarEstado(page, (s) => ({
    ...s,
    ligacao: {
      ...s.ligacao,
      second: { id: 12, number: '2007', name: 'Carlos Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: { oferece: false, ativo: false, imagem: false, camera: false, cedo: false } },
      secondKind: 'ringing',
    },
  }));
  const cartao = page.getByRole('alert').filter({ hasText: 'Ligação de Carlos Lima' });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Recusar' })).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  const c = await caixa(cartao);
  quase(c.x + c.width / 2, 640, 'o cartão no meio');
  expect(c.y).toBeLessThan(120);
  // Com duas ligações, a Câmera só desliga: com a câmera ligada, ela está ativa; desligada, ela espera.
  await expect(botao(page, 'Desligar a câmera')).toBeEnabled();
  await botao(page, 'Desligar a câmera').click();
  await esperarComando(page, { cmd: 'camera', on: false });
  await expect(botao(page, 'Ligar a câmera')).toBeDisabled();
});

test('the big window draws nothing with a second call, ringing or held', async ({ page }) => {
  // Spec 4.2 (Ruling 13): com duas ligações o vídeo pausa, também no grande. A vista da outra ponta fica só com o fundo,
  // mesmo com um quadro novo chegando, e o quadro de agora volta quando a ligação fica sozinha.
  await abrir(page, 'video-grande');
  const area = remoto(page);
  await quadro(page, 'remoto', VERMELHO);
  await expect.poll(async () => perto(await corNoMeio(page, area), RGB_DO_VERMELHO)).toBe(true);
  for (const [segunda, tipo, cor, rgb] of [
    [{ ...CARLOS, phase: 'ringing', activeSinceMs: 0, held: false }, 'ringing', BRANCO, RGB_DO_BRANCO],
    [{ ...CARLOS, phase: 'active', activeSinceMs: Date.now() - 41_000, held: true }, 'held', VERMELHO, RGB_DO_VERMELHO],
  ] as const) {
    await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: segunda, secondKind: tipo } }));
    await expect(page.locator('.grande-cartao .vcard'), tipo).toBeVisible();
    await expect(area, tipo).toBeVisible();
    await quadro(page, 'remoto', cor);
    await quadrosDeTela(page, 10);
    const agora = await corNoMeio(page, area);
    expect(perto(agora, FUNDO), `a imagem da outra ponta com a segunda (${tipo}): ${agora}`).toBe(true);

    await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: null, secondKind: 'none' } }));
    await expect(page.locator('.grande-cartao .vcard'), tipo).toHaveCount(0);
    await expect.poll(async () => perto(await corNoMeio(page, area), rgb), `a imagem de volta depois da segunda (${tipo})`).toBe(true);
  }
});

test('the big window always shows your image with the camera on', async ({ page }) => {
  await abrir(page, 'video-grande');
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: { ...s.ligacao.top, video: { ...s.ligacao.top.video, imagem: false, camera: true } } } }));
  await expect(suaImagem(page)).toBeVisible();
});

test('the full screen keeps the sizes of the board', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await abrir(page, 'video-grande');
  await botao(page, 'Tela cheia').click();
  await expect(botao(page, 'Sair da tela cheia')).toBeVisible();
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
});

test('a call left ringing in the big window goes back to the call screen', async ({ page }) => {
  await abrir(page, 'video-grande');
  const tocando = {
    id: 12,
    number: '2007',
    name: 'Carlos Lima',
    incoming: true,
    phase: 'ringing',
    activeSinceMs: 0,
    held: false,
    video: { oferece: true, ativo: false, imagem: false, camera: false, cedo: false },
  };
  const soTocando = (s: Record<string, any>) => ({ ...s, ligacao: { ...s.ligacao, top: tocando, second: null, secondKind: 'none' } });
  await mudarEstado(page, soTocando);
  await expect(botao(page, 'Atender com vídeo')).toBeVisible();
  await expect(botao(page, 'Recusar')).toBeVisible();
  await expect(botao(page, 'Atender')).toBeVisible();
  await expect(botao(page, 'Diminuir')).toHaveCount(0);
  await expect.poll(() => vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(1);
  await mudarEstado(page, soTocando);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'videoWindow', modo: 'normal' })).toBe(1);
});

type Caixa = { x: number; y: number; width: number; height: number };
const cruzam = (a: Caixa, b: Caixa) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** As linhas do texto do rótulo de um botão da barra (o texto fora do círculo), pela altura de cada pedaço dele. */
const linhasDoRotulo = (b: Locator) =>
  b.evaluate((botao) => {
    const intervalo = document.createRange();
    const linhas = new Set<number>();
    const andar = (no: Node) => {
      if (no.nodeType === Node.TEXT_NODE && no.textContent?.trim()) {
        intervalo.selectNodeContents(no);
        for (const r of intervalo.getClientRects()) if (r.width > 1) linhas.add(Math.round(r.top));
      } else if (no instanceof Element && !no.classList.contains('grande-c')) {
        no.childNodes.forEach(andar);
      }
    };
    botao.childNodes.forEach(andar);
    return linhas.size;
  });

test.describe('o grande com o chat numa área de trabalho pequena', () => {
  // O CSP da página só deixa falar com o endereço do chat de verdade; o servidor de teste fica no 127.0.0.1:4180.
  test.use({ bypassCSP: true });

  test('the big window bar fits a small work area with the chat open', async ({ page }) => {
    // (Ruling 15) A área de trabalho é o grande quando ela é menor que 1280×800 (a de 1920×1080 a 200%, a de 1366×768 a
    // 150%): com o painel de 360 do chat, a barra de baixo fica toda na janela e fora do painel, sem um botão em cima do
    // outro e com o nome de cada um.
    const { pessoas } = await empresaComPessoas('ACME Comércio Ltda', [
      { ramal: '2001', nome: 'Recepção' },
      { ramal: '2003', nome: 'Ana Souza' },
    ]);
    await abrirNoChat(page, { chave: pessoas[0].chave, ramal: '2001', nome: 'Recepção' });
    await esperarOsEventos(page);
    await mudarEstado(page, (s) => ({
      ...s,
      video: { ...s.video, janela: 'grande' },
      ligacao: {
        top: { id: 51, number: '2003', name: 'Ana Souza', incoming: true, phase: 'active', activeSinceMs: Date.now() - 5_000, held: false, video: { oferece: true, ativo: true, imagem: true, camera: true, cedo: false } },
        second: null,
        secondKind: 'none',
        muted: false,
        conference: false,
        conferenceSinceMs: 0,
        consulting: false,
        colleagueActive: false,
      },
    }));
    await page.locator('.grande-barra').getByRole('button', { name: 'Chat', exact: true }).click();
    const painel = page.locator('.grande-chat');
    await expect(painel).toBeVisible();
    for (const [largura, altura] of [
      [960, 540],
      [800, 500],
    ] as const) {
      for (const modo of ['grande', 'telaCheia'] as const) {
        const onde = `${modo} em ${largura}×${altura}`;
        await page.setViewportSize({ width: largura, height: altura });
        await mudarEstado(page, (s) => ({ ...s, video: { ...s.video, janela: modo } }));
        const tela = modo === 'grande' ? 'Tela cheia' : 'Sair da tela cheia';
        await expect(page.locator('.grande-barra').getByRole('button', { name: tela, exact: true }), onde).toBeVisible();
        await expect(painel, onde).toBeVisible();
        const p = await caixa(painel);
        const botoes = barraDeBaixo(page);
        const esperados = ['Mudo', 'Desligar a câmera', 'Chat', tela, 'Diminuir', 'Desligar'];
        await expect(botoes, onde).toHaveCount(esperados.length);
        let anterior: Caixa | null = null;
        for (const [i, nome] of esperados.entries()) {
          const b = botoes.nth(i);
          await expect(b, onde).toHaveAccessibleName(nome);
          const c = await caixa(b);
          const circulo = await caixa(b.locator('.grande-c'));
          const dentro = c.x >= -0.5 && c.y >= -0.5 && c.x + c.width <= largura + 0.5 && c.y + c.height <= altura + 0.5;
          expect(dentro, `${nome} fora da janela, ${onde}: ${JSON.stringify(c)}`).toBe(true);
          expect(cruzam(c, p), `${nome} embaixo do painel do chat, ${onde}: ${JSON.stringify({ c, p })}`).toBe(false);
          expect(circulo.x >= c.x - 0.5 && circulo.x + circulo.width <= c.x + c.width + 0.5, `o círculo de ${nome} fora dele, ${onde}`).toBe(true);
          // O rótulo numa linha só embaixo do círculo, ou nenhum à vista (o nome fica para o leitor de tela): nunca quebrado.
          expect(await linhasDoRotulo(b), `o rótulo de ${nome} em mais de uma linha, ${onde}`).toBeLessThanOrEqual(1);
          if (anterior) expect(cruzam(c, anterior), `${nome} em cima do anterior, ${onde}`).toBe(false);
          anterior = c;
        }
        await semViolacoesSerias(page);
      }
    }
  });
});
