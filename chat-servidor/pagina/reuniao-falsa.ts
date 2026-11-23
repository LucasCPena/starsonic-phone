// A reunião de mentira dos testes da página, no Chromium: a página de verdade, servida pelo chat no modo de teste, com
// a rede falsa (rede-falsa.ts), a ligação falsa e o relógio parado. O mosaico de mentira é um <canvas> com uma cor em
// cada célula, ligado ao #mosaico pelo captureStream(0): cada imagem sai quando o teste pede (o requestFrame() da
// faixa), e não por um relógio. O palco de mentira é a mensagem palco, mandada pelo canal falso. As cores: a Ana
// vermelha, o Carlos azul, a Maria amarela, e a tela verde. Os números da ligação também são de mentira (o comARede):
// o sinalizador de qualidade lê o que o teste diz. Os testes dos quadros (palco.spec.ts), os do chat da reunião
// (painel.spec.ts) e os do sinalizador (qualidade.spec.ts) partem daqui.
import { expect, type Locator, type Page } from '@playwright/test';
import { AGORA, MARCADA } from './ligacoes-falsas';
import { CODIGO, RedeFalsa, type Canal, type Mensagem } from './rede-falsa';

/** O aceito, com um Acesso inventado (seção 10 do protocolo). */
export const ACEITO: Mensagem = {
  tipo: 'aceito',
  participante: 'participante-1',
  senha: 'senha-1',
  turn: { urls: ['turns:turn.exemplo.com.br:5349'], usuario: 'usuario-1', senha: 'credencial-1' },
  video: { wss: 'wss://video.exemplo.com.br:7443/sip', uri: 'sip:reuniao@video.exemplo.com.br' },
  volta: 'volta-1',
};

// Uma ligação falsa no lugar do ligacao.js: ela confirma, e o teste dá os eventos dela. Ela não mexe no #mosaico: o
// mosaico de mentira é do teste. Os números dela (o getStats de mentira) são os do window.numerosFalsos, que o
// comARede põe; sem ele, não há números. O window.leituras conta as vezes em que a página os pediu.
export const LIGACAO_FALSA = `
export function criarLigacoes(aoEvento) {
  window.ligacaoFalsa = aoEvento;
  window.leituras = 0;
  return {
    ligar({ qual }) { setTimeout(() => aoEvento({ tipo: 'ligacao', qual, o: 'confirmada' }), 0); },
    desligar() {},
    trocarCamera() { setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0); },
    trocarMicrofone() {},
    numeros() {
      window.leituras += 1;
      return Promise.resolve(window.numerosFalsos?.() ?? null);
    },
  };
}`;

export const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 1, name: nome, exact: true });
export const botao = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true });

export async function caixa(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const c = await l.boundingBox();
  if (!c) throw new Error('o elemento não está na tela');
  return c;
}

// ---- As pessoas, as cores e os palcos. ----

export interface Pessoa {
  quem: string;
  nome: string;
}

export const ANA: Pessoa = { quem: 'a1a1a1a1a1a1a1a1', nome: 'Ana Souza' };
export const CARLOS: Pessoa = { quem: 'c2c2c2c2c2c2c2c2', nome: 'Carlos Lima' };
export const MARIA: Pessoa = { quem: 'e3e3e3e3e3e3e3e3', nome: 'Maria Lima' };
export const BIA: Pessoa = { quem: 'b4b4b4b4b4b4b4b4', nome: 'Bia Ramos' };
export const ROBERTO: Pessoa = { quem: 'f5f5f5f5f5f5f5f5', nome: 'Roberto Alves' };
export const EU: Pessoa = { quem: '9696969696969696', nome: 'Maria Lima' };

export const CORES = {
  vermelho: [255, 0, 0],
  azul: [0, 0, 255],
  amarelo: [255, 255, 0],
  verde: [0, 255, 0],
  cinza: [128, 128, 128],
} as const;
export type Cor = keyof typeof CORES;

export const camDe = (p: Pessoa) => `cam:${p.quem}`;
export const telaDe = (p: Pessoa) => `tela:${p.quem}`;

/** Um quadro do palco, com a cor da célula dele no mosaico de mentira. */
export interface Quadro {
  pessoa: Pessoa;
  voce?: boolean;
  tela?: boolean;
  semCamera?: boolean;
  cor: Cor;
  x: number;
  y: number;
  l: number;
  a: number;
}

export interface Palco {
  largura: number;
  altura: number;
  quadros: Quadro[];
}

export type Celula = Omit<Quadro, 'x' | 'y' | 'l' | 'a'>;

/** As células em colunas × linhas, na ordem de leitura, começando no y. */
export function emGrade(
  largura: number,
  alturaDaGrade: number,
  colunas: number,
  linhas: number,
  celulas: Celula[],
  y = 0,
) {
  const l = largura / colunas;
  const a = alturaDaGrade / linhas;
  return celulas.map((c, i) => ({ ...c, x: (i % colunas) * l, y: y + Math.floor(i / colunas) * a, l, a }));
}

export const ana: Celula = { pessoa: ANA, cor: 'vermelho' };
export const carlos: Celula = { pessoa: CARLOS, cor: 'azul' };
export const maria: Celula = { pessoa: MARIA, cor: 'amarelo' };
export const bia: Celula = { pessoa: BIA, cor: 'cinza' };
export const roberto: Celula = { pessoa: ROBERTO, cor: 'cinza', semCamera: true };
export const eu: Celula = { pessoa: EU, voce: true, cor: 'cinza' };

/** O Carlos e Você, lado a lado. */
export const DOIS: Palco = { largura: 1920, altura: 1080, quadros: emGrade(1920, 1080, 2, 1, [carlos, eu]) };
/** A Ana, o Carlos, a Maria e Você, em 2×2. */
export const TRES: Palco = {
  largura: 1920,
  altura: 1080,
  quadros: emGrade(1920, 1080, 2, 2, [ana, carlos, maria, eu]),
};
/** A Ana, o Carlos, a Maria, o Roberto sem câmera e Você, em 3×2. */
export const QUATRO: Palco = {
  largura: 1920,
  altura: 1080,
  quadros: emGrade(1920, 1080, 3, 2, [ana, carlos, maria, roberto, eu]),
};

/** A mensagem palco do canal. */
export function mensagemDo(p: Palco): Mensagem {
  return {
    tipo: 'palco',
    largura: p.largura,
    altura: p.altura,
    quadros: p.quadros.map((q) => ({
      quem: q.pessoa.quem,
      nome: q.pessoa.nome,
      voce: q.voce ?? false,
      tela: q.tela ?? false,
      semCamera: q.semCamera ?? false,
      x: q.x,
      y: q.y,
      l: q.l,
      a: q.a,
    })),
  };
}

// ---- O mosaico de mentira. ----

/** O canvas do mosaico de mentira e a faixa dele, no window da página. */
export type MosaicoFalso = { canvas: HTMLCanvasElement; faixa: CanvasCaptureMediaStreamTrack };
/** O requestVideoFrameCallback do teste, guardado antes de a página começar (um teste o tira da página). */
export type QuandoMostrar = (video: HTMLVideoElement, fn: VideoFrameRequestCallback) => void;

/**
 * O mosaico de mentira fica com o tamanho e as células do palco (a de fora de qualquer célula, preta), e sai uma imagem
 * dele. A promessa acaba quando o #mosaico mostrou essa imagem (o requestVideoFrameCallback dele, com a moldura fora
 * da vista): o quadros.js, que pediu o dele antes, já a viu.
 */
export async function mosaico(page: Page, p: Palco): Promise<void> {
  const celulas = p.quadros.map((q) => ({ x: q.x, y: q.y, l: q.l, a: q.a, cor: CORES[q.cor] }));
  const tamanho = await page.evaluate(
    ({ largura, altura, celulas }) => {
      const w = window as unknown as { mosaicoFalso?: MosaicoFalso; quandoMostrar: QuandoMostrar };
      const video = document.getElementById('mosaico') as HTMLVideoElement;
      if (!w.mosaicoFalso) {
        const canvas = document.createElement('canvas');
        const fluxo = canvas.captureStream(0);
        w.mosaicoFalso = { canvas, faixa: fluxo.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack };
        video.srcObject = fluxo;
      }
      const { canvas, faixa } = w.mosaicoFalso;
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(0, 0, largura, altura);
      for (const c of celulas) {
        ctx.fillStyle = `rgb(${c.cor.join(', ')})`;
        ctx.fillRect(c.x, c.y, c.l, c.a);
      }
      return new Promise<string>((r) => {
        w.quandoMostrar(video, (_, m) => r(`${m.width}x${m.height}`));
        faixa.requestFrame();
      });
    },
    { largura: p.largura, altura: p.altura, celulas },
  );
  expect(tamanho).toBe(`${p.largura}x${p.altura}`);
}

/** Mais uma imagem do mosaico de mentira, igual à última: o canvas só dá outra imagem depois de ser pintado de novo. */
export async function outraImagem(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { mosaicoFalso: MosaicoFalso; quandoMostrar: QuandoMostrar };
    const { canvas, faixa } = w.mosaicoFalso;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.putImageData(ctx.getImageData(0, 0, 1, 1), 0, 0);
    const video = document.getElementById('mosaico') as HTMLVideoElement;
    return new Promise<void>((r) => {
      w.quandoMostrar(video, () => r());
      faixa.requestFrame();
    });
  });
}

// ---- Os quadros. ----

export const quadro = (page: Page, chave: string) => page.locator(`[data-quadro="${chave}"]`);
export const todosOsQuadros = (page: Page) => page.locator('[data-quadro]');
export const area = (page: Page) => page.locator('.palco');

export const mostraDe = (page: Page, chave: string) => quadro(page, chave).getAttribute('data-mostra');

/** Confere que a caixa de dentro está dentro da de fora (com 1 px de folga). */
export function dentro(de: { x: number; y: number; width: number; height: number }, fora: typeof de, onde: string) {
  expect(de.x, `${onde}: a esquerda`).toBeGreaterThanOrEqual(fora.x - 1);
  expect(de.y, `${onde}: o topo`).toBeGreaterThanOrEqual(fora.y - 1);
  expect(de.x + de.width, `${onde}: a direita`).toBeLessThanOrEqual(fora.x + fora.width + 1);
  expect(de.y + de.height, `${onde}: o fundo`).toBeLessThanOrEqual(fora.y + fora.height + 1);
}

// ---- A vigia de cada teste: o CSP e o console. ----

const consoles = new WeakMap<Page, string[]>();

/** O que a página escreveu no console até agora: "<tipo> <texto>", e "pageerror <mensagem>" para o erro sem dono. */
export function doConsole(page: Page): string[] {
  const lista = consoles.get(page);
  if (!lista) throw new Error('faltou o vigiar(page) no beforeEach');
  return lista;
}

/** Tira do console o que o teste esperava ver nele: o conferir não reclama do que saiu. */
export function esperadoNoConsole(page: Page, qual: (mensagem: string) => boolean): void {
  const lista = doConsole(page);
  for (let i = lista.length - 1; i >= 0; i--) {
    if (qual(lista[i])) lista.splice(i, 1);
  }
}

/**
 * No beforeEach: o console da página passa a ser guardado, as violações do CSP também, e o requestVideoFrameCallback
 * fica guardado para o mosaico de mentira (um teste o tira da página).
 */
export async function vigiar(page: Page): Promise<void> {
  const lista: string[] = [];
  consoles.set(page, lista);
  page.on('console', (m) => lista.push(`${m.type()} ${m.text()}`));
  page.on('pageerror', (e) => lista.push(`pageerror ${e.message}`));
  await page.addInitScript(() => {
    const w = window as unknown as { violacoes: string[]; quandoMostrar: QuandoMostrar };
    const pedir = HTMLVideoElement.prototype.requestVideoFrameCallback;
    w.quandoMostrar = (video, fn) => pedir.call(video, fn);
    w.violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.violacoes.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

/** No afterEach: a página não quebrou o CSP, não deu erro, e nada do palco (os nomes) foi ao console. */
export async function conferir(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { violacoes: string[] }).violacoes)).toEqual([]);
  const nomes = /Ana|Carlos|Maria|Bia|Roberto|Participante|palco/;
  expect(doConsole(page).filter((m) => m.startsWith('error') || m.startsWith('pageerror') || nomes.test(m))).toEqual(
    [],
  );
}

// ---- A página na reunião. ----

export interface NaReuniao {
  rede: RedeFalsa;
  canal: Canal;
}

/** A página na reunião, com a ligação falsa, o relógio parado e o canal 1 aberto. */
export async function naReuniao(page: Page): Promise<NaReuniao> {
  await page.route('**/r/estatico/ligacao.js', (r) =>
    r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIGACAO_FALSA }),
  );
  await page.clock.install({ time: AGORA - 1000 });
  await page.clock.pauseAt(AGORA);
  const rede = await RedeFalsa.instalar(page, MARCADA);
  await page.goto(`/r/${CODIGO}`);
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
  rede.aoPedir = (c) => c.mandar(ACEITO);
  await page.getByLabel('Seu nome').fill('Maria Lima');
  await botao(page, 'Pedir para entrar').click();
  await expect(titulo(page, 'Entrando na reunião…')).toBeVisible();
  await page.clock.runFor(10);
  await expect(page.getByRole('navigation', { name: 'Controles da reunião' })).toBeVisible();
  return { rede, canal: await rede.canalNumero(1) };
}

// ---- A página do colega. ----

/** O passe que a página do colega recebe (43 caracteres base64url, como o de verdade). */
export const PASSE = 'passeDoColegaNosTestesDaPagina'.padEnd(43, '0');

/** A ligação falsa e o relógio parado às 10:00, antes de a página abrir. */
export async function prepararAPagina(page: Page): Promise<void> {
  await page.route('**/r/estatico/ligacao.js', (r) =>
    r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIGACAO_FALSA }),
  );
  await page.clock.install({ time: AGORA - 1000 });
  await page.clock.pauseAt(AGORA);
}

/**
 * A página aberta no endereço (o caminho do link e, se houver, o que vem depois do #), com a ligação falsa e o relógio
 * parado, até a entrada: a câmera e o microfone já chegaram.
 */
export async function abrirNaEntrada(page: Page, endereco: string): Promise<void> {
  await prepararAPagina(page);
  await page.goto(endereco);
  await expect
    .poll(() => page.locator('video.previa').first().evaluate((v: HTMLVideoElement) => v.srcObject !== null))
    .toBe(true);
}

/**
 * A página do colega na entrada dele: o PASSE no fim do endereço, depois do #, como o app a abre no navegador; a rede
 * falsa (já instalada) o reconhece pelo colega dela.
 */
export async function abrirComoColega(page: Page): Promise<void> {
  await abrirNaEntrada(page, `/r/${CODIGO}#p=${PASSE}`);
}

/** O colega na reunião, pelo Entrar, sem a espera: a rede (já instalada) aceita o entrar. Devolve o canal 1. */
export async function entrarComoColega(page: Page, rede: RedeFalsa): Promise<Canal> {
  await abrirComoColega(page);
  rede.aoEntrar = (c) => c.mandar(ACEITO);
  await botao(page, 'Entrar').click();
  // A ligação falsa confirma num setTimeout, que só roda com o relógio andando.
  await subir(page, () => page.getByRole('navigation', { name: 'Controles da reunião' }).isVisible());
  return rede.canalNumero(1);
}

/** Uma pessoa da lista da reunião, como a mensagem participantes a traz. */
export interface NaLista {
  id: string;
  nome: string;
  deFora?: boolean;
  tela?: boolean;
  voce?: boolean;
}

/** O servidor manda a lista inteira ao colega: quem está na reunião e quem espera para entrar ({id, nome}). */
export function mandarLista(
  canal: Canal,
  lista: { participantes?: NaLista[]; pedidos?: Array<{ id: string; nome: string }> },
): void {
  canal.mandar({
    tipo: 'participantes',
    participantes: (lista.participantes ?? []).map((p) => ({
      deFora: false,
      tela: false,
      voce: false,
      ...p,
    })),
    pedidos: lista.pedidos ?? [],
  });
}

/** O palco chega, e o mosaico dele também; 600 ms depois, com a imagem seguinte, os quadros mostram o vídeo. */
export async function comOPalco(page: Page, canal: Canal, p: Palco): Promise<void> {
  canal.mandar(mensagemDo(p));
  await mosaico(page, p);
  await page.clock.runFor(600);
  await outraImagem(page);
  const primeiro = p.quadros.find((q) => !q.voce && !q.semCamera);
  if (!primeiro) return;
  const chave = primeiro.tela ? telaDe(primeiro.pessoa) : camDe(primeiro.pessoa);
  await expect.poll(() => mostraDe(page, chave)).toBe('video');
}

export async function naReuniaoCom(page: Page, p: Palco): Promise<NaReuniao> {
  const r = await naReuniao(page);
  await comOPalco(page, r.canal, p);
  return r;
}

// ---- A rede de mentira do sinalizador de qualidade. ----

/** A rede que os números de mentira mostram: a perda, uma fração (0.04 são 4%), e o atraso, em ms. */
export interface RedeDeMentira {
  perda: number;
  /** Sem ele, o navegador de mentira não dá o atraso. */
  atraso?: number;
}

/**
 * Os números de mentira da ligação falsa (o window.numerosFalsos, que o numeros() dela devolve): um relatório como o
 * do getStats, com contadores que andam a cada leitura (100 pacotes de som e 250 de vídeo, com a perda pedida, e 50
 * imagens) e o atraso pedido no par de endereços em uso. Chamado de novo, muda a perda e o atraso das próximas
 * leituras.
 */
export async function comARede(page: Page, rede: RedeDeMentira): Promise<void> {
  await page.evaluate((rede) => {
    const w = window as unknown as {
      redeFalsa?: { perda: number; atraso: number | null };
      numerosFalsos?: () => Map<string, object>;
    };
    w.redeFalsa = { perda: rede.perda, atraso: rede.atraso ?? null };
    if (w.numerosFalsos) return;
    const som = { recebidos: 0, perdidos: 0 };
    const video = { recebidos: 0, perdidos: 0 };
    let imagens = 0;
    const andar = (c: { recebidos: number; perdidos: number }, pacotes: number, perda: number) => {
      const perdidos = Math.round(pacotes * perda);
      c.perdidos += perdidos;
      c.recebidos += pacotes - perdidos;
    };
    w.numerosFalsos = () => {
      const { perda, atraso } = w.redeFalsa ?? { perda: 0, atraso: null };
      andar(som, 100, perda);
      andar(video, 250, perda);
      imagens += 50;
      const timestamp = Date.now();
      const par: Record<string, unknown> = { id: 'par', type: 'candidate-pair', timestamp, state: 'succeeded' };
      if (atraso !== null) par.currentRoundTripTime = atraso / 1000;
      return new Map<string, object>([
        [
          'som',
          {
            id: 'som',
            type: 'inbound-rtp',
            kind: 'audio',
            timestamp,
            packetsReceived: som.recebidos,
            packetsLost: som.perdidos,
          },
        ],
        [
          'video',
          {
            id: 'video',
            type: 'inbound-rtp',
            kind: 'video',
            timestamp,
            packetsReceived: video.recebidos,
            packetsLost: video.perdidos,
            framesDecoded: imagens,
          },
        ],
        ['transporte', { id: 'transporte', type: 'transport', timestamp, selectedCandidatePairId: 'par' }],
        ['par', par],
      ]);
    };
  }, rede);
}

/** Quantas vezes a página pediu os números à ligação falsa. */
export const leituras = (page: Page) =>
  page.evaluate(() => (window as unknown as { leituras?: number }).leituras ?? 0);

/**
 * O relógio anda 2 s de cada vez, e a página pede os números uma vez em cada uma: a medida já passou pelo cérebro
 * quando a promessa acaba.
 */
export async function medir(page: Page, vezes = 1): Promise<void> {
  for (let i = 0; i < vezes; i++) {
    const antes = await leituras(page);
    await page.clock.runFor(2_000);
    await expect.poll(() => leituras(page), { message: 'uma leitura a cada 2 s' }).toBe(antes + 1);
  }
}

// ---- A ligação que cai e volta. ----

/** Um evento da ligação falsa, como o ligacao.js o daria. */
export const darNaLigacao = (page: Page, evento: object) =>
  page.evaluate((e) => (window as unknown as { ligacaoFalsa: (e: object) => void }).ligacaoFalsa(e), evento);

export const SEM_CONEXAO = { tipo: 'ligacao', qual: 'principal', o: 'semConexao' };
export const cartaoDaQueda = (page: Page) =>
  page.getByRole('heading', { level: 2, name: 'A conexão caiu. Entrando de novo…' });

/** A volta da conexão caída: depois da espera de 2 s, a página pede a senha pelo canal, ela chega, e a ligação sobe. */
export async function voltar(page: Page, canal: Canal): Promise<void> {
  const senhas = () => canal.tipos().filter((t) => t === 'senha').length;
  const antes = senhas();
  await page.clock.runFor(2_000);
  await expect.poll(senhas).toBe(antes + 1);
  canal.mandar({ tipo: 'senha', senha: 'senha-2' });
  await subir(page, () => page.locator('.caiu').isHidden());
  await expect(cartaoDaQueda(page)).toBeHidden();
}

/** A ligação falsa confirma num setTimeout, que o relógio parado só roda quando o teste anda com ele: até a condição. */
export async function subir(page: Page, pronto: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(async () => {
      await page.clock.runFor(10);
      return pronto();
    })
    .toBe(true);
}
