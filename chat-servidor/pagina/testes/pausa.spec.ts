// A pausa da reunião enquanto a pessoa está numa ligação no Starsonic Phone (a etapa 2a, 7.8 e 7.9 da spec), no
// Chromium. No navegador, a pausa chega pelo canal do colega (a mensagem pausa, que o app repete com a mesma vez), e o
// cartão "Você está numa ligação…" aparece por cima da reunião, com o Voltar para a reunião; dentro do app, ela chega
// pela janela de cima (o pausar e o retomar, da janela-do-app.ts), sem o cartão. Nos dois, o microfone e a câmera
// desligam e o som da reunião cala; a volta devolve tudo. A ligação daqui é uma falsa que mexe nas faixas do fluxo como
// a de verdade (o microfone pelo enabled, a câmera que para e sai do fluxo, ou é pedida e entra nele). Quem entra é a
// Júlia Martins (o COLEGA da rede falsa).
import { expect, test, type Frame, type Page } from '@playwright/test';
import { CHAT } from '../chat';
import { NO_QUADRO, abrirNoApp, estado, mandar, mensagens, naReuniaoNoApp } from '../janela-do-app';
import { MARCADA } from '../ligacoes-falsas';
import { RedeFalsa, type Canal } from '../rede-falsa';
import { CARLOS, botao, conferir, doConsole, entrarComoColega, vigiar } from '../reuniao-falsa';

// A página no quadro do app (o teste "a pausa do app") pede o navegador do NO_QUADRO; os outros vão nele também.
test.use(NO_QUADRO);

const FRASE = 'Você está numa ligação no Starsonic Phone. A reunião não ouve nem vê você.';

// Uma ligação falsa que mexe nas faixas do fluxo da principal como a de verdade: o microfone desligado é a faixa com o
// enabled falso; a câmera desligada para e sai do fluxo, e a ligada de novo é pedida e entra nele.
const LIGACAO_DA_PAUSA = `
export function criarLigacoes(aoEvento) {
  window.ligacaoFalsa = aoEvento;
  let fluxo = null;
  return {
    ligar({ qual, fluxo: f }) {
      if (qual === 'principal') fluxo = f;
      setTimeout(() => aoEvento({ tipo: 'ligacao', qual, o: 'confirmada' }), 0);
    },
    desligar() {},
    trocarCamera(ligada) {
      if (ligada) {
        navigator.mediaDevices.getUserMedia({ video: true }).then((f) => {
          fluxo.addTrack(f.getVideoTracks()[0]);
          aoEvento({ tipo: 'cameraTrocada', ok: true });
        });
        return;
      }
      for (const t of fluxo ? fluxo.getVideoTracks() : []) {
        t.stop();
        fluxo.removeTrack(t);
      }
      setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0);
    },
    trocarMicrofone(ligado) {
      for (const t of fluxo ? fluxo.getAudioTracks() : []) t.enabled = ligado;
    },
    numeros() {
      return Promise.resolve(null);
    },
  };
}`;

/** As faixas do fluxo da página: o microfone (ligado, para cada faixa viva) e o número de câmeras vivas. */
const faixas = (onde: Page | Frame) =>
  onde
    .locator('video.previa')
    .first()
    .evaluate((v: HTMLVideoElement) => {
      const f = v.srcObject as MediaStream;
      const vivas = (ts: MediaStreamTrack[]) => ts.filter((t) => t.readyState === 'live');
      return { microfone: vivas(f.getAudioTracks()).map((t) => t.enabled), cameras: vivas(f.getVideoTracks()).length };
    });
const LIGADAS = { microfone: [true], cameras: 1 };
const DESLIGADAS = { microfone: [false], cameras: 0 };
/** O aviso mais novo da região que os leitores de tela anunciam. */
const anuncio = (page: Page) => page.locator('[data-campo="anuncio"] > :last-child');
/** O som da reunião está calado. */
const calado = (onde: Page | Frame) => onde.locator('#som').evaluate((a: HTMLAudioElement) => a.muted);

/** Até a condição, com o relógio parado andando 10 ms de cada vez (as respostas da ligação falsa esperam por ele). */
const comORelogio =
  <T>(page: Page, fn: () => Promise<T>) =>
  async (): Promise<T> => {
    await page.clock.runFor(10);
    return fn();
  };

const cartao = (page: Page) => page.getByRole('alertdialog');
const voltar = (page: Page) => cartao(page).getByRole('button', { name: 'Voltar para a reunião', exact: true });
const pausa = (pausada: boolean, vez = 'ligacao1') => ({ tipo: 'pausa', pausada, vez });

/** O colega na reunião, no navegador, com a ligação daqui. Devolve o canal 1. */
async function naReuniao(page: Page): Promise<Canal> {
  const rede = await RedeFalsa.instalar(page, MARCADA);
  const canal = await entrarComoColega(page, rede, LIGACAO_DA_PAUSA);
  await expect.poll(() => faixas(page)).toEqual(LIGADAS);
  return canal;
}

/** O canal manda uma mensagem do chat, e ela aparece: o que o canal mandou antes dela já passou pela página. */
async function depoisDoQueVeio(page: Page, canal: Canal): Promise<void> {
  canal.mandar({ tipo: 'mensagem', de: CARLOS.quem, nome: CARLOS.nome, voce: false, texto: 'Bom dia' });
  await expect(page.locator('.aviso-curto')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await vigiar(page);
});

// O "nenhuma violação da CSP": em todos os testes daqui, nenhuma violação (na página e na reunião dentro do quadro),
// nenhum erro, e nada dos nomes no console.
test.afterEach(async ({ page }) => {
  await conferir(page);
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || !frame.url().startsWith(`${CHAT}/r/`)) continue;
    expect(await frame.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
  }
  expect(doConsole(page)).toEqual([]);
});

test('a pausa do canal mostra o cartão', async ({ page }) => {
  const canal = await naReuniao(page);
  expect(await calado(page)).toBe(false);
  canal.mandar(pausa(true));
  // O cartão, com a frase e o Voltar para a reunião, por cima da reunião.
  await expect(cartao(page)).toBeVisible();
  await expect(cartao(page)).toHaveAccessibleName(FRASE);
  await expect(cartao(page).getByText(FRASE, { exact: true })).toBeVisible();
  await expect(voltar(page)).toBeVisible();
  // O som calado, e as faixas do microfone e da câmera desligadas; os botões mostram os dois desligados.
  expect(await calado(page)).toBe(true);
  await expect.poll(comORelogio(page, () => faixas(page))).toEqual(DESLIGADAS);
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'false');
  await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'false');
  // Os outros veem o quadro sem a imagem.
  expect(canal.recebidas).toContainEqual({ tipo: 'camera', ligada: false });
});

test('o Voltar para a reunião', async ({ page }) => {
  const canal = await naReuniao(page);
  canal.mandar(pausa(true));
  await expect(voltar(page)).toBeVisible();
  await expect.poll(comORelogio(page, () => faixas(page))).toEqual(DESLIGADAS);
  await voltar(page).click();
  // O cartão some, o som volta, e o microfone e a câmera voltam como eram.
  await expect(cartao(page)).toBeHidden();
  expect(await calado(page)).toBe(false);
  await expect.poll(comORelogio(page, () => faixas(page))).toEqual(LIGADAS);
  await expect(botao(page, 'Microfone')).toHaveAttribute('aria-pressed', 'true');
  await expect(botao(page, 'Câmera')).toHaveAttribute('aria-pressed', 'true');
  expect(canal.recebidas).toContainEqual({ tipo: 'camera', ligada: true });
  // A repetição da mesma vez, 10 s depois, não traz o cartão de volta.
  canal.mandar(pausa(true));
  await depoisDoQueVeio(page, canal);
  await expect(cartao(page)).toBeHidden();
  expect(await calado(page)).toBe(false);
  // A ligação seguinte (outra vez) traz.
  canal.mandar(pausa(true, 'ligacao2'));
  await expect(cartao(page)).toBeVisible();
  // E o pausada falso, no fim da ligação, o tira.
  canal.mandar(pausa(false, 'ligacao2'));
  await expect(cartao(page)).toBeHidden();
  expect(await calado(page)).toBe(false);
});

test('a pausa do app', async ({ page }) => {
  const a = await abrirNoApp(page, false, LIGACAO_DA_PAUSA);
  const canal = await naReuniaoNoApp(page, a);
  await expect.poll(() => faixas(a.frame)).toEqual(LIGADAS);
  // O pausar, pela janela de cima: o som calado e as faixas desligadas, sem o cartão (quem mostra a ligação é o app).
  await mandar(page, { tipo: 'pausar' });
  await expect.poll(() => calado(a.frame)).toBe(true);
  await expect.poll(comORelogio(page, () => faixas(a.frame))).toEqual(DESLIGADAS);
  await expect(a.quadro.getByRole('alertdialog')).toHaveCount(0);
  await expect(a.quadro.getByText(FRASE, { exact: true })).toBeHidden();
  // O app fica sabendo que os outros não ouvem a pessoa, e os outros veem o quadro sem a imagem.
  await expect.poll(() => mensagens(page)).toContainEqual(estado('naReuniao', false));
  expect(canal.recebidas).toContainEqual({ tipo: 'camera', ligada: false });
  // A pausa do canal não vale dentro do app.
  canal.mandar(pausa(true));
  // O retomar devolve tudo.
  await mandar(page, { tipo: 'retomar' });
  await expect.poll(() => calado(a.frame)).toBe(false);
  await expect.poll(comORelogio(page, () => faixas(a.frame))).toEqual(LIGADAS);
  await expect(a.quadro.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(async () => (await mensagens(page)).at(-1)).toEqual(estado('naReuniao'));
});

test('o foco e o leitor de tela', async ({ page }) => {
  const canal = await naReuniao(page);
  canal.mandar(pausa(true));
  // O foco vai ao botão do cartão, e o leitor de tela ouve a frase.
  await expect(voltar(page)).toBeFocused();
  await expect(anuncio(page)).toHaveText(FRASE);
  // O foco fica preso nele: o Tab, o Shift+Tab e o Esc não o tiram dali, e o cartão fica.
  for (const tecla of ['Tab', 'Shift+Tab', 'Tab', 'Escape']) {
    await page.keyboard.press(tecla);
    await expect(voltar(page)).toBeFocused();
  }
  await expect(cartao(page)).toBeVisible();
});
