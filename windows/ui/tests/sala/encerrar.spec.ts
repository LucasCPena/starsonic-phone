// (0.4.0) O Desligar da sala (o quadro Encerrar): a pergunta "Encerrar a sala para todos?" com os nomes de quem está nela;
// o Encerrar manda o `salaEncerrar` (nunca o `hangup`) e o Cancelar e o Esc a deixam como estava, com o foco de volta no
// Desligar; a pergunta que acompanha os nomes e some, sem mandar nada, quando a sala acaba; o clique duplo no Encerrar; e os
// três tamanhos, no vermelho do Desligar que se lê.
import { expect, test, type Page } from '@playwright/test';
import { arrumacao } from '../../src/sala/mosaico';
import { abrir, comandos, depoisDoQueChegou, esperarComando, estado, mudarEstado, segurarCpp, semViolacoesSerias, soltarCpp, vezes } from '../helpers';

const TAMANHOS = [
  [400, 720],
  [360, 600],
  [300, 440],
] as const;

const NOME = 'Encerrar a sala para todos?';
const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });
const pergunta = (page: Page) => page.getByRole('alertdialog', { name: NOME, exact: true });
const doDialogo = (page: Page, nome: 'Cancelar' | 'Encerrar') => pergunta(page).getByRole('button', { name: nome, exact: true });

/** Abre a pergunta pelo Desligar. */
async function perguntar(page: Page): Promise<void> {
  await botao(page, 'Desligar').click();
  await expect(pergunta(page)).toBeVisible();
}

/** Os comandos depois do `antes`-ésimo, sem o `videoViews` (as vistas que voltam à tela são à parte). */
async function depois(page: Page, antes: number): Promise<unknown[]> {
  return (await comandos(page)).slice(antes).filter((c) => c.cmd !== 'videoViews');
}

test('Desligar asks Encerrar a sala para todos? with the names, and Encerrar ends the room', async ({ page }) => {
  await abrir(page, 'sala');
  const antes = (await comandos(page)).length;
  await perguntar(page);
  await expect(pergunta(page)).toHaveAccessibleDescription('As ligações com Ana Souza e Carlos Lima vão desligar.');
  // O foco no Cancelar, e nada saiu ainda.
  await expect(doDialogo(page, 'Cancelar')).toBeFocused();
  expect(await depois(page, antes)).toEqual([]);
  await semViolacoesSerias(page);
  await doDialogo(page, 'Encerrar').click();
  await esperarComando(page, { cmd: 'salaEncerrar' });
  // A sala acabou: a tela volta ao Teclado, sem nenhum `hangup`.
  await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
  await expect(pergunta(page)).toHaveCount(0);
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaEncerrar' })).toBe(1);
  expect((await comandos(page)).filter((c) => c.cmd === 'hangup')).toEqual([]);
});

test('Cancelar and Esc keep the room and send nothing', async ({ page }) => {
  await abrir(page, 'sala');
  const antes = (await comandos(page)).length;
  await perguntar(page);
  await doDialogo(page, 'Cancelar').click();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(botao(page, 'Desligar')).toBeFocused();
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toBeVisible();
  // O Esc também fecha, e o foco volta ao Desligar.
  await perguntar(page);
  await expect(doDialogo(page, 'Cancelar')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pergunta(page)).toHaveCount(0);
  await expect(botao(page, 'Desligar')).toBeFocused();
  await depoisDoQueChegou(page);
  expect(await depois(page, antes)).toEqual([]);
  // De novo, abre: a sala segue de pé.
  await perguntar(page);
  await expect(pergunta(page)).toHaveAccessibleDescription('As ligações com Ana Souza e Carlos Lima vão desligar.');
});

test('the question follows the room and closes when it ends', async ({ page }) => {
  await abrir(page, 'sala');
  const antes = (await comandos(page)).length;
  const emCima = (await estado(page)).ligacao;
  await perguntar(page);
  // A Bia entra: os nomes da pergunta acompanham a sala.
  await mudarEstado(page, (s) => {
    const participantes = [...s.ligacao.sala.participantes, { id: 13, numero: '2005', nome: 'Bia Ramos', estado: 'naSala', imagem: true }];
    const quadros = arrumacao(participantes.length);
    return { ...s, ligacao: { ...s.ligacao, sala: { ...s.ligacao.sala, participantes: participantes.map((p, i) => ({ ...p, quadro: quadros[i] })) } } };
  });
  await expect(pergunta(page)).toHaveAccessibleDescription('As ligações com Ana Souza, Carlos Lima e Bia Ramos vão desligar.');
  await expect(pergunta(page)).toBeVisible();
  // A sala acaba sozinha: a Ana de volta como a ligação, sem a sala. A pergunta some, sem mandar nada.
  const ana = { id: 11, number: '2003', name: 'Ana Souza', incoming: false, phase: 'active', activeSinceMs: emCima.top.activeSinceMs, held: false, video: { ...emCima.top.video } };
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: ana, sala: null } }));
  await expect(pergunta(page)).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Ligação', exact: true })).toBeVisible();
  await depoisDoQueChegou(page);
  expect(await depois(page, antes)).toEqual([]);
  expect(await vezes(page, { cmd: 'salaEncerrar' })).toBe(0);
});

test('the focus stays on the screen that remains when the room ends with the question open', async ({ page }) => {
  // A sala acaba sozinha e a Ana fica como a ligação; depois, a ligação acaba e fica o Teclado. Nos dois, o foco que estava
  // na pergunta não se perde no `body`: ele vai para um controle da tela que fica.
  const foco = () =>
    page.evaluate(() => {
      const e = document.activeElement;
      return { corpo: e === document.body || e === null, dentroDoMain: !!e?.closest('main'), dentroDoDialogo: !!e?.closest('dialog') };
    });
  await abrir(page, 'sala');
  const emCima = (await estado(page)).ligacao;
  await perguntar(page);
  await expect(doDialogo(page, 'Cancelar')).toBeFocused();
  const ana = { id: 11, number: '2003', name: 'Ana Souza', incoming: false, phase: 'active', activeSinceMs: emCima.top.activeSinceMs, held: false, video: { ...emCima.top.video } };
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, top: ana, sala: null } }));
  await expect(page.getByRole('main', { name: 'Ligação', exact: true })).toBeVisible();
  await expect(pergunta(page)).toHaveCount(0);
  await expect.poll(foco, 'o foco na ligação que fica').toEqual({ corpo: false, dentroDoMain: true, dentroDoDialogo: false });
  // O mesmo com o Teclado.
  await abrir(page, 'sala');
  await perguntar(page);
  await mudarEstado(page, (s) => ({ ...s, ligacao: null }));
  await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
  await expect(pergunta(page)).toHaveCount(0);
  await expect.poll(foco, 'o foco no Teclado').toEqual({ corpo: false, dentroDoMain: true, dentroDoDialogo: false });
});

test('a double click on Encerrar ends the room once and sends nothing else', async ({ page }) => {
  await abrir(page, 'sala');
  await perguntar(page);
  const antes = (await comandos(page)).length;
  // O C++ lento: o segundo clique cai no mesmo Encerrar, com a pergunta ainda aberta (ela só some quando a sala acaba).
  await segurarCpp(page);
  await doDialogo(page, 'Encerrar').dblclick();
  await expect(pergunta(page)).toBeVisible();
  await soltarCpp(page);
  await esperarComando(page, { cmd: 'salaEncerrar' });
  await expect(page.getByRole('textbox', { name: 'Número' })).toBeVisible();
  await depoisDoQueChegou(page);
  // Um `salaEncerrar` só, e nenhum outro comando (nem `hangup`, `dial` ou `dtmf`) depois dele.
  expect(await depois(page, antes)).toEqual([{ v: 1, cmd: 'salaEncerrar' }]);
});

test('the question fits the three sizes, in a red that reads', async ({ page }) => {
  for (const [largura, altura] of TAMANHOS) {
    const onde = `${largura}×${altura}`;
    await page.setViewportSize({ width: largura, height: altura });
    await abrir(page, 'sala');
    await perguntar(page);
    const caixa = (await pergunta(page).boundingBox())!;
    expect(caixa.x, `o diálogo fora da janela em ${onde}`).toBeGreaterThanOrEqual(0);
    expect(caixa.y, `o diálogo fora da janela em ${onde}`).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width, `o diálogo fora da janela em ${onde}`).toBeLessThanOrEqual(largura);
    expect(caixa.y + caixa.height, `o diálogo fora da janela em ${onde}`).toBeLessThanOrEqual(altura);
    expect(caixa.width, `o diálogo largo demais em ${onde}`).toBeLessThanOrEqual(352 + 0.5);
    for (const nome of ['Cancelar', 'Encerrar'] as const) {
      const b = (await doDialogo(page, nome).boundingBox())!;
      expect(b.x >= caixa.x - 0.5 && b.x + b.width <= caixa.x + caixa.width + 0.5, `${nome} fora do diálogo em ${onde}`).toBe(true);
      expect(b.height, `a altura de ${nome} em ${onde}`).toBeCloseTo(46, 0);
    }
    const cores = await doDialogo(page, 'Encerrar').evaluate((e) => ({ fundo: getComputedStyle(e).backgroundColor, texto: getComputedStyle(e).color }));
    expect(cores, `as cores do Encerrar em ${onde}`).toEqual({ fundo: 'rgb(194, 59, 59)', texto: 'rgb(255, 255, 255)' });
    await semViolacoesSerias(page);
  }
});

test('the question gives way to an outside call that starts ringing: it closes as Cancelar, and Atender can be clicked', async ({ page }) => {
  await abrir(page, 'sala');
  const antes = (await comandos(page)).length;
  await perguntar(page);
  // Uma ligação de fora começa a tocar com a pergunta aberta.
  const roberto = { id: 31, number: '2012', name: 'Roberto Lima', incoming: true, phase: 'ringing', activeSinceMs: 0, held: false, video: null };
  await mudarEstado(page, (s) => ({ ...s, ligacao: { ...s.ligacao, second: roberto, secondKind: 'ringing' } }));
  await expect(pergunta(page)).toHaveCount(0);
  // O foco voltou ao Desligar, que abriu a pergunta, como no Cancelar.
  await expect(botao(page, 'Desligar')).toBeFocused();
  await expect(page.getByRole('main', { name: 'Sala de vídeo', exact: true })).toBeVisible();
  const alerta = page.locator('[role="alert"]', { hasText: 'Ligação de Roberto Lima' });
  await expect(alerta.getByRole('button', { name: 'Atender', exact: true })).toBeVisible();
  await alerta.getByRole('button', { name: 'Atender', exact: true }).click();
  await esperarComando(page, { cmd: 'answer' });
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaEncerrar' })).toBe(0);
  expect((await depois(page, antes)).filter((c) => (c as { cmd: string }).cmd !== 'answer')).toEqual([]);
});

test('a question opened while an outside call already rings stays open; Cancelar and Encerrar still work', async ({ page }) => {
  await abrir(page, 'sala-ligacao-de-fora');
  const antes = (await comandos(page)).length;
  await perguntar(page);
  await expect(doDialogo(page, 'Cancelar')).toBeFocused();
  // Ela segue aberta: quem escolheu encerrar a sala viu a ligação que toca.
  await page.waitForTimeout(300);
  await expect(pergunta(page)).toBeVisible();
  await doDialogo(page, 'Cancelar').click();
  await expect(pergunta(page)).toHaveCount(0);
  await expect(botao(page, 'Desligar')).toBeFocused();
  await perguntar(page);
  await doDialogo(page, 'Encerrar').click();
  await esperarComando(page, { cmd: 'salaEncerrar' });
  await depoisDoQueChegou(page);
  expect(await vezes(page, { cmd: 'salaEncerrar' })).toBe(1);
  expect((await depois(page, antes)).filter((c) => (c as { cmd: string }).cmd !== 'salaEncerrar')).toEqual([]);
});
