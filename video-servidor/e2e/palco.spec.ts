// O palco de ponta a ponta: as páginas de verdade, o chat, o agente e o FreeSWITCH juntos. O agente escolhe a célula de
// cada pessoa no mosaico e diz ao chat quem está onde (o palco); o chat repassa às páginas, com os nomes; e cada página
// desenha um quadro por pessoa, recortado do mosaico, e o Você. Cada página é uma pessoa, com a câmera de uma cor
// (midia.ts): A (Carlos Lima, vermelho), B (Bia Ramos, azul) e C (Maria Lima, amarelo). O que se confere é o que a
// pessoa veria: a cor certa debaixo de cada nome, e ninguém mudando de lugar quando alguém entra, sai ou volta.
//
// A espera é sempre por uma condição, nesta ordem: o tamanho do vídeo, o data-mostra "video" dos quadros, e a cor.
import { expect, test, type Locator } from '@playwright/test';
import { repetirAte } from './espera';
import {
  A,
  AMARELO,
  AZUL,
  B,
  C,
  fundo,
  MOSAICO_4,
  perto,
  VERDE,
  VERMELHO,
  type Cor,
  type Ponto,
} from './midia';
import { Pagina, telaVerde } from './navegador';
import { ligacoesPrincipais, novaReuniaoDeTeste } from './servidores';

const CARLOS = 'Carlos Lima';
const BIA = 'Bia Ramos';
const MARIA = 'Maria Lima';

// As células da grade de 4, no mosaico de 1920×1080: a menor livre é de quem entra, na ordem.
const [C1, C2, C3, C4] = MOSAICO_4;

const texto = (x: unknown) => JSON.stringify(x);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a cor no quadro com o nome, na página, até prazo ms. */
async function esperarCor(p: Pagina, nome: string, cor: Cor, prazo = 20_000): Promise<void> {
  await repetirAte(
    prazo,
    100,
    () => p.corDoQuadro(nome),
    (vista) => perto(vista, cor),
    (vista) => `o quadro "${nome}" de ${p.pessoa.letra} não ficou com ${texto(cor)} em ${prazo / 1000} s; a última: ${texto(vista)}`,
  );
}

/** Espera, na página, cada quadro com a sua cor, depois de todos mostrarem o vídeo (os nomes são os quadros todos). */
async function esperarOsQuadros(p: Pagina, cores: Record<string, Cor>, prazo = 20_000): Promise<void> {
  await p.esperarQuadros([...Object.keys(cores), 'Você'], prazo);
  for (const [nome, cor] of Object.entries(cores)) await esperarCor(p, nome, cor, prazo);
}

/** Uma conferência de um ponto do mosaico: a cor, ou o fundo. */
type Conferencia = Cor | 'fundo';
const confere = (vista: Cor | null, c: Conferencia) => (c === 'fundo' ? fundo(vista) : perto(vista, c));

/** Espera cada ponto do #mosaico da página com a sua conferência, ao mesmo tempo, até prazo ms. */
async function esperarPontos(p: Pagina, pontos: readonly Ponto[], esperado: readonly Conferencia[], prazo = 20_000) {
  await repetirAte(
    prazo,
    150,
    () => p.amostras(pontos),
    (vistas) => vistas.every((v, i) => confere(v, esperado[i])),
    (vistas) =>
      `no #mosaico de ${p.pessoa.letra}, os pontos ${texto(pontos)} não ficaram ${texto(esperado)} em ${prazo / 1000} s; ` +
      `as últimas vistas: ${texto(vistas)}`,
  );
}

/** Olha os pontos do #mosaico da página, a cada 100 ms, até o parar: as leituras de cada ponto, na ordem. */
function vigiar(p: Pagina, pontos: readonly Ponto[]): { parar: () => Promise<Array<Array<Cor | null>>> } {
  const leituras: Array<Array<Cor | null>> = pontos.map(() => []);
  let olhando = true;
  const olhar = (async () => {
    while (olhando) {
      const vistas = await p.amostras(pontos);
      vistas.forEach((v, i) => leituras[i].push(v));
      await esperar(100);
    }
  })();
  return {
    parar: async () => {
      olhando = false;
      await olhar;
      return leituras;
    },
  };
}

/** As leituras de um ponto que não conferem (as cinco primeiras). */
const fora = (leituras: Array<Cor | null>, c: Conferencia) => leituras.filter((v) => !confere(v, c)).slice(0, 5);

/** A caixa do elemento na tela. */
async function caixa(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const c = await l.boundingBox();
  if (!c) throw new Error('o elemento não está na tela');
  return c;
}

/** A pessoa entra na reunião de teste (o aceito vem na hora) e a página dela mostra os controles. */
async function entrar(p: Pagina, codigo: string, nome: string): Promise<void> {
  await p.entrar(codigo, nome);
  await expect(p.controles()).toBeVisible({ timeout: 30_000 });
}

/** A câmera dos controles. */
const camera = (p: Pagina) => p.controles().getByRole('button', { name: 'Câmera', exact: true });

// As três páginas na mesma reunião de teste, nesta ordem: A fica com o c1, B com o c2, e C com o c3. O canal e o WSS
// do vídeo de C passam pelas rotas do teste, que os derrubam no terceiro.
test.describe.serial('as três páginas', () => {
  let a: Pagina | undefined;
  let b: Pagina | undefined;
  let c: Pagina | undefined;

  test.afterAll(async () => {
    await c?.fechar();
    await b?.fechar();
    await a?.fechar();
  });

  test('cada página mostra as outras duas, com os nomes certos', async () => {
    const codigo = await novaReuniaoDeTeste();
    a = await Pagina.abrir(A);
    b = await Pagina.abrir(B);
    c = await Pagina.abrir(C, { derrubavel: true });
    // Cada uma entra depois de a anterior estar no palco: a célula de cada uma é a da ordem.
    await entrar(a, codigo, CARLOS);
    await entrar(b, codigo, BIA);
    await esperarOsQuadros(a, { [BIA]: AZUL });
    await entrar(c, codigo, MARIA);

    for (const [p, cores] of [
      [a, { [BIA]: AZUL, [MARIA]: AMARELO }],
      [b, { [CARLOS]: VERMELHO, [MARIA]: AMARELO }],
      [c, { [CARLOS]: VERMELHO, [BIA]: AZUL }],
    ] as const) {
      await p.esperarTamanho(1920, 1080);
      await esperarOsQuadros(p, cores);
      await expect(p.quadro('Você')).toHaveAttribute('data-papel', 'canto');
    }
    // A ordem da entrada é a das células, no mosaico de A.
    await esperarPontos(a, [C1, C2, C3, C4], [VERMELHO, AZUL, AMARELO, 'fundo']);
    for (const p of [a, b, c]) await p.conferirOConsole();
  });

  test('quem entra e quem sai não muda os outros de lugar', async () => {
    if (!a || !b || !c) throw new Error('o teste anterior não pôs as três na reunião');
    await esperarPontos(a, [C1, C2, C3], [VERMELHO, AZUL, AMARELO]);
    const vigia = vigiar(a, [C3]);
    let leituras: Array<Array<Cor | null>> = [];
    try {
      // B sai: em A, a Maria continua amarela, no quadro e na célula dela; a de B fica vazia.
      await b.controles().getByRole('button', { name: 'Sair', exact: true }).click();
      await expect(b.titulo('Você saiu da reunião')).toBeVisible();
      await esperarPontos(a, [C2, C3], ['fundo', AMARELO]);
      await esperarOsQuadros(a, { [MARIA]: AMARELO });
      await expect(a.quadro(BIA)).toHaveCount(0);

      // B entra de novo: ela volta ao c2, e o quadro dela é azul.
      await b.botao('Entrar de novo').click();
      await expect(b.controles()).toBeVisible({ timeout: 30_000 });
      await esperarPontos(a, [C2, C3], [AZUL, AMARELO]);
      await esperarOsQuadros(a, { [BIA]: AZUL, [MARIA]: AMARELO });
      await esperarOsQuadros(b, { [CARLOS]: VERMELHO, [MARIA]: AMARELO });
    } finally {
      leituras = await vigia.parar();
    }
    // A célula da Maria não mudou em nenhuma leitura.
    expect(fora(leituras[0], AMARELO), 'as leituras do c3 em A que não são o amarelo').toEqual([]);
    expect(leituras[0].length, 'as leituras do c3 em A').toBeGreaterThan(20);
    await a.conferirOConsole();
    await b.conferirOConsole();
  });

  // Review Focus 2: a ligação nova da mesma pessoa fica com a célula da anterior, e a anterior, quando sai, não a solta.
  test('quem entra de novo fica no mesmo lugar', async () => {
    if (!a || !b || !c) throw new Error('o teste anterior não pôs as três na reunião');
    await esperarPontos(a, [C1, C2, C3, C4], [VERMELHO, AZUL, AMARELO, 'fundo']);
    const vigia = vigiar(a, [C1, C2, C4]);
    let leituras: Array<Array<Cor | null>> = [];
    try {
      // O WSS do vídeo de C cai, e a página volta sozinha: o c3 volta a ser amarelo.
      await c.derrubarOVideo();
      await expect(c.caiu()).toBeVisible();
      await expect(c.caiu()).toBeHidden({ timeout: 30_000 });
      await expect(c.controles()).toBeVisible();
      await expect.poll(() => ligacoesPrincipais(c!.participante()), { timeout: 20_000 }).toBe(1);
      await esperarPontos(a, [C3], [AMARELO]);
      await esperarOsQuadros(a, { [BIA]: AZUL, [MARIA]: AMARELO });
      // E a página que voltou mostra as outras duas de novo, nos lugares delas.
      await c.esperarTamanho(1920, 1080);
      await esperarOsQuadros(c, { [CARLOS]: VERMELHO, [BIA]: AZUL });
    } finally {
      leituras = await vigia.parar();
    }
    // O c1 e o c2 não mudaram em nenhuma leitura, e a ligação nova de C nunca foi para o c4.
    expect(fora(leituras[0], VERMELHO), 'as leituras do c1 em A que não são o vermelho').toEqual([]);
    expect(fora(leituras[1], AZUL), 'as leituras do c2 em A que não são o azul').toEqual([]);
    expect(fora(leituras[2], 'fundo'), 'as leituras do c4 em A que não são o fundo').toEqual([]);
    expect(leituras[0].length, 'as leituras em A').toBeGreaterThan(20);
    await c.conferirOConsole();
    await a.conferirOConsole();
  });
});

// A e C, e depois B, com a tela verde de C (o canvas no lugar da tela que ela escolheria).
test.describe.serial('a tela no palco', () => {
  let a: Pagina | undefined;
  let b: Pagina | undefined;
  let c: Pagina | undefined;
  let codigo = '';

  test.afterAll(async () => {
    await c?.fechar();
    await b?.fechar();
    await a?.fechar();
  });

  const TELA = `Tela de ${MARIA}`;

  /** C compartilha, e o selo aparece. */
  async function compartilhar(p: Pagina): Promise<void> {
    await p.botao('Compartilhar a tela').click();
    await expect(p.page.getByText('Você está compartilhando a tela', { exact: true })).toBeVisible({ timeout: 20_000 });
  }

  test('a tela compartilhada no palco, com 2 pessoas', async () => {
    codigo = await novaReuniaoDeTeste();
    a = await Pagina.abrir(A);
    c = await Pagina.abrir(C);
    await c.page.addInitScript(telaVerde);
    await entrar(a, codigo, CARLOS);
    await entrar(c, codigo, MARIA);
    await a.esperarTamanho(1920, 1080);
    await esperarOsQuadros(a, { [MARIA]: AMARELO });

    // C compartilha: em A, o vídeo vira a apresentação de 2, e a tela de C é a grande, verde.
    await compartilhar(c);
    await a.esperarTamanho(1920, 1620);
    await esperarOsQuadros(a, { [TELA]: VERDE, [MARIA]: AMARELO });
    await expect(a.quadro(TELA)).toHaveAttribute('data-papel', 'grande');
    await expect(a.quadro(MARIA)).toHaveAttribute('data-papel', 'faixa');

    // O clique na Maria da faixa: a câmera dela é a grande, amarela, e aparece o Voltar para a tela.
    await a.quadro(MARIA).click();
    await expect(a.quadro(MARIA)).toHaveAttribute('data-papel', 'grande');
    await expect(a.quadro(TELA)).toHaveAttribute('data-papel', 'faixa');
    await esperarCor(a, MARIA, AMARELO);
    await expect(a.botao('Voltar para a tela')).toBeVisible();

    // O Voltar para a tela: a tela é a grande de novo, verde.
    await a.botao('Voltar para a tela').click();
    await expect(a.quadro(TELA)).toHaveAttribute('data-papel', 'grande');
    await expect(a.quadro(MARIA)).toHaveAttribute('data-papel', 'faixa');
    await expect(a.botao('Voltar para a tela')).toBeHidden();
    await esperarCor(a, TELA, VERDE);

    // C para: o vídeo volta a 1920×1080, e a grade volta, sem a tela.
    await c.botao('Parar de compartilhar').click();
    await a.esperarTamanho(1920, 1080);
    await esperarOsQuadros(a, { [MARIA]: AMARELO });
    await expect(a.quadro(MARIA)).toHaveAttribute('data-papel', 'grade');
    await expect(a.quadro(TELA)).toHaveCount(0);
    await a.conferirOConsole();
    await c.conferirOConsole();
  });

  test('a tela com 3 pessoas', async () => {
    if (!a || !c) throw new Error('o teste anterior não pôs A e C na reunião');
    await compartilhar(c);
    await a.esperarTamanho(1920, 1620);
    await esperarOsQuadros(a, { [TELA]: VERDE, [MARIA]: AMARELO });

    // B entra durante o compartilhamento: a apresentação de 4, e os quadros continuam certos nas três páginas.
    b = await Pagina.abrir(B);
    await entrar(b, codigo, BIA);
    for (const [p, cores] of [
      [a, { [TELA]: VERDE, [MARIA]: AMARELO, [BIA]: AZUL }],
      [b, { [TELA]: VERDE, [CARLOS]: VERMELHO, [MARIA]: AMARELO }],
      [c, { 'A sua tela': VERDE, [CARLOS]: VERMELHO, [BIA]: AZUL }],
    ] as const) {
      await p.esperarTamanho(1920, 1350);
      await esperarOsQuadros(p, cores);
    }
    await expect(a.quadro(TELA)).toHaveAttribute('data-papel', 'grande');
    await expect(b.quadro(TELA)).toHaveAttribute('data-papel', 'grande');
    await expect(c.quadro('A sua tela')).toHaveAttribute('data-papel', 'grande');
    for (const p of [a, b, c]) await p.conferirOConsole();
  });
});

test('a câmera desligada escurece na hora', async () => {
  const codigo = await novaReuniaoDeTeste();
  let a: Pagina | undefined;
  let c: Pagina | undefined;
  try {
    a = await Pagina.abrir(A);
    c = await Pagina.abrir(C);
    await entrar(a, codigo, CARLOS);
    await entrar(c, codigo, MARIA);
    await a.esperarTamanho(1920, 1080);
    await esperarOsQuadros(a, { [MARIA]: AMARELO });

    // C desliga a Câmera: em até 2 s, o quadro dela em A mostra o nome no centro, sem a imagem.
    const desligou = Date.now();
    await camera(c).click();
    await expect(a.quadro(MARIA)).toHaveAttribute('data-mostra', 'sem-camera', { timeout: 2_000 });
    const ms = Date.now() - desligou;
    test.info().annotations.push({ type: 'sem-camera em A', description: `${ms} ms` });
    expect(ms, 'o tempo até o quadro escurecer em A').toBeLessThanOrEqual(2_000);
    await expect(a.quadro(MARIA).locator('.quadro-centro')).toBeVisible();
    await expect(a.quadro(MARIA).locator('.quadro-centro')).toHaveText(MARIA);
    expect(await a.corDoQuadro(MARIA), 'a pintura do quadro sem câmera').toBeNull();

    // C liga: o amarelo volta.
    await camera(c).click();
    await expect(camera(c)).toHaveAttribute('aria-pressed', 'true');
    await esperarOsQuadros(a, { [MARIA]: AMARELO });
    await a.conferirOConsole();
    await c.conferirOConsole();
  } finally {
    await c?.fechar();
    await a?.fechar();
  }
});

test('o celular em pé na reunião de três', async () => {
  const codigo = await novaReuniaoDeTeste();
  let a: Pagina | undefined;
  let b: Pagina | undefined;
  let c: Pagina | undefined;
  try {
    a = await Pagina.abrir(A);
    b = await Pagina.abrir(B);
    c = await Pagina.abrir(C, { celular: true });
    await entrar(a, codigo, CARLOS);
    await entrar(b, codigo, BIA);
    await entrar(c, codigo, MARIA);
    await c.esperarTamanho(1920, 1080);
    await esperarOsQuadros(c, { [CARLOS]: VERMELHO, [BIA]: AZUL });

    // Os dois quadros ocupam a largura da área, um embaixo do outro, dentro dela.
    const area = await caixa(c.page.locator('.palco'));
    const [cima, baixo] = (await Promise.all([caixa(c.quadro(CARLOS)), caixa(c.quadro(BIA))])).sort((p, q) => p.y - q.y);
    for (const q of [cima, baixo]) {
      expect(Math.abs(q.x - area.x), 'a esquerda do quadro').toBeLessThanOrEqual(1);
      expect(Math.abs(q.width - area.width), 'a largura do quadro').toBeLessThanOrEqual(1);
      expect(q.y, 'o topo do quadro').toBeGreaterThanOrEqual(area.y - 1);
      expect(q.y + q.height, 'o fundo do quadro').toBeLessThanOrEqual(area.y + area.height + 1);
    }
    expect(baixo.y, 'o de baixo começa depois do de cima').toBeGreaterThanOrEqual(cima.y + cima.height);
    await c.conferirOConsole();
  } finally {
    await c?.fechar();
    await b?.fechar();
    await a?.fechar();
  }
});
