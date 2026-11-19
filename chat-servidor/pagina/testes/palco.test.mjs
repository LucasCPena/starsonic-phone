// Os testes do palco da página (palco.js): a leitura da mensagem do palco, a sincronia do palco com o vídeo do mosaico,
// quem fica aumentado, a arrumação dos quadros na tela e o recorte de cada um. O módulo é puro: sem DOM, sem rede e sem
// relógio. Os palcos e as memórias dos testes estão congelados: o módulo, que é estrito, daria erro se os mudasse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ESPERA_DO_QUADRO_NOVO_MS,
  ESPERA_DO_TAMANHO_MS,
  MARGEM_DO_RECORTE,
  PRAZO_SEM_PALCO_MS,
  aoMudarOPalco,
  arrumar,
  chaveDe,
  lerPalco,
  recortar,
  sincroniaInicial,
  sincronizar,
} from '../../internal/pagina/estatico/palco.js';

function congelar(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) congelar(v);
  }
  return o;
}

// Os participantes de mentira: os ids são inventados, de 16 hex como os do chat.
const ANA = 'a000000000000001';
const CARLOS = 'a000000000000002';
const MARIA = 'a000000000000003';
const ROBERTO = 'a000000000000004';
const VOCE = 'a000000000000005';
const BIA = 'a000000000000006';

const cam = (quem, nome, x, y, l, a, extra = {}) => ({
  quem,
  nome,
  voce: false,
  tela: false,
  semCamera: false,
  x,
  y,
  l,
  a,
  ...extra,
});
const ana = cam(ANA, 'Ana Souza', 0, 0, 960, 540);
const carlos = cam(CARLOS, 'Carlos Lima', 960, 0, 960, 540);
const maria = cam(MARIA, 'Maria Lima', 0, 540, 960, 540);
const roberto = cam(ROBERTO, 'Roberto', 960, 540, 480, 540, { semCamera: true });
// O Você chega com o nome vazio: o chat reiniciou e não o conhece.
const voce = cam(VOCE, '', 1440, 540, 480, 270, { voce: true });
const bia = cam(BIA, 'Bia Ramos', 1440, 810, 480, 270);

// O P4: quatro outros e o Você, num mosaico de 1920x1080. Os menores tiram pessoas dele.
const P4 = congelar({ largura: 1920, altura: 1080, quadros: [ana, carlos, maria, roberto, voce] });
const comOs = (...quem) => congelar({ ...P4, quadros: P4.quadros.filter((q) => q.voce || quem.includes(q.quem)) });
const P_SO_O_VOCE = comOs();
const P1 = comOs(CARLOS);
const P2 = comOs(ANA, CARLOS);
const P3 = comOs(ANA, CARLOS, MARIA);
// O mesmo tamanho, mais a Bia (cinco outros).
const P4_COM_BIA = congelar({ ...P4, quadros: [...P4.quadros, bia] });
// O Roberto sai, e a Bia fica com a célula dele.
const P4_BIA_NO_LUGAR_DO_ROBERTO = congelar({
  ...P4,
  quadros: [ana, carlos, maria, cam(BIA, 'Bia Ramos', 960, 540, 480, 540), voce],
});
// Nove outros e o Você, num mosaico de 1920x1440.
const P9 = congelar({
  largura: 1920,
  altura: 1440,
  quadros: [
    ...Array.from({ length: 9 }, (_, i) =>
      cam(`b00000000000000${i + 1}`, `Pessoa ${i + 1}`, (i % 3) * 640, Math.floor(i / 3) * 360, 640, 360),
    ),
    cam(VOCE, '', 0, 1080, 640, 360, { voce: true }),
  ],
});
// Doze outros e o Você, num mosaico de 1920x1080 (o máximo de quadros: 13).
const P12 = congelar({
  largura: 1920,
  altura: 1080,
  quadros: [
    ...Array.from({ length: 12 }, (_, i) =>
      cam(`c00000000000000${(i + 1).toString(16)}`, `Pessoa ${i + 1}`, (i % 4) * 480, Math.floor(i / 4) * 270, 480, 270),
    ),
    cam(VOCE, '', 0, 810, 480, 270, { voce: true }),
  ],
});
// A tela da Ana em cima, e a Ana, o Carlos, a Maria e o Você embaixo, num mosaico de 1920x1620.
const telaDaAna = cam(ANA, 'Ana Souza', 0, 0, 1920, 1080, { tela: true });
const PT = congelar({
  largura: 1920,
  altura: 1620,
  quadros: [
    telaDaAna,
    cam(ANA, 'Ana Souza', 0, 1080, 480, 540),
    cam(CARLOS, 'Carlos Lima', 480, 1080, 480, 540),
    cam(MARIA, 'Maria Lima', 960, 1080, 480, 540),
    cam(VOCE, '', 1440, 1080, 480, 540, { voce: true }),
  ],
});
// A mesma tela, sem a Maria.
const PT_SEM_A_MARIA = congelar({ ...PT, quadros: PT.quadros.filter((q) => q.quem !== MARIA) });

const PC = congelar({ l: 1232, a: 608 });
const CELULAR = congelar({ l: 374, a: 640 });
const V = congelar({ l: 1920, a: 1080 });
const V2 = congelar({ l: 1920, a: 1620 });

const CHAVES_P4 = [`cam:${ANA}`, `cam:${CARLOS}`, `cam:${MARIA}`, `cam:${ROBERTO}`, 'voce'];
const CHAVES_PT = [`tela:${ANA}`, `cam:${ANA}`, `cam:${CARLOS}`, `cam:${MARIA}`, 'voce'];

// ---------------------------------------------------------------------------------------------------------------------
// As constantes, o lerPalco e o chaveDe.

test('as esperas e a margem do recorte', () => {
  assert.equal(ESPERA_DO_TAMANHO_MS, 600);
  assert.equal(ESPERA_DO_QUADRO_NOVO_MS, 1000);
  assert.equal(PRAZO_SEM_PALCO_MS, 3000);
  assert.equal(MARGEM_DO_RECORTE, 2);
});

test('lerPalco: a mensagem vira uma cópia do palco, só com os campos conhecidos', () => {
  const m = congelar({
    tipo: 'palco',
    largura: 1920,
    altura: 1080,
    outro: 1,
    quadros: P4.quadros.map((q) => ({ ...q, sobra: 'x' })),
  });
  const p = lerPalco(m);
  assert.deepEqual(p, P4);
  assert.notEqual(p.quadros, m.quadros);
  assert.notEqual(p.quadros[0], m.quadros[0]);
  // Um palco sem quadros vale; um nome de 200 caracteres também.
  assert.deepEqual(lerPalco({ tipo: 'palco', largura: 1920, altura: 1080, quadros: [] }), {
    largura: 1920,
    altura: 1080,
    quadros: [],
  });
  const comprido = { ...m, quadros: [{ ...ana, nome: 'á'.repeat(200) }] };
  assert.equal(lerPalco(comprido).quadros[0].nome, 'á'.repeat(200));
  // O tela e o voce chegam como vieram.
  assert.deepEqual(lerPalco({ ...PT, tipo: 'palco' }), PT);
});

test('lerPalco: devolve null com a mensagem que não vale', () => {
  const com = (mudancas) => ({ tipo: 'palco', ...P4, ...mudancas });
  const comQuadro = (mudancas) => com({ quadros: [{ ...ana, ...mudancas }] });
  assert.equal(lerPalco(com({ largura: 0 })), null);
  assert.equal(lerPalco(com({ largura: 7681 })), null);
  assert.equal(lerPalco(com({ altura: 15 })), null);
  assert.equal(lerPalco(com({ altura: 4321 })), null);
  assert.equal(lerPalco(com({ largura: '1920' })), null);
  // Um quadro que passa do mosaico.
  assert.equal(lerPalco(comQuadro({ x: 961 })), null);
  assert.equal(lerPalco(comQuadro({ y: 541 })), null);
  assert.equal(lerPalco(comQuadro({ x: -1 })), null);
  assert.equal(lerPalco(comQuadro({ l: 15 })), null);
  assert.equal(lerPalco(comQuadro({ a: 15 })), null);
  // 14 quadros (13 valem).
  const muitos = (n) => com({ quadros: Array.from({ length: n }, () => ana) });
  assert.notEqual(lerPalco(muitos(13)), null);
  assert.equal(lerPalco(muitos(14)), null);
  // Um quem que não é texto, e um nome com mais de 200 caracteres.
  assert.equal(lerPalco(comQuadro({ quem: 123 })), null);
  assert.equal(lerPalco(comQuadro({ nome: 'a'.repeat(201) })), null);
  assert.equal(lerPalco(comQuadro({ nome: null })), null);
  // Os quadros que não são uma lista.
  assert.equal(lerPalco(com({ quadros: 'nada' })), null);
  assert.equal(lerPalco(com({ quadros: { 0: ana } })), null);
  assert.equal(lerPalco(com({ quadros: [null] })), null);
  assert.equal(lerPalco(null), null);
});

test('chaveDe', () => {
  assert.equal(chaveDe(ana), `cam:${ANA}`);
  assert.equal(chaveDe(roberto), `cam:${ROBERTO}`);
  assert.equal(chaveDe(voce), 'voce');
  assert.equal(chaveDe(telaDaAna), `tela:${ANA}`);
  // A tela do Você também é a tela de quem a manda.
  assert.equal(chaveDe({ ...telaDaAna, quem: VOCE, voce: true }), `tela:${VOCE}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// O recortar.

test('recortar: o cobrir corta o que sobra da célula, no centro', () => {
  assert.deepEqual(recortar({ x: 2, y: 2, l: 956, a: 536 }, { l: 600, a: 300 }, 'cobrir'), {
    sx: 2,
    sy: 31,
    sl: 956,
    sa: 478,
    dx: 0,
    dy: 0,
    dl: 600,
    da: 300,
  });
  const r = recortar({ x: 2, y: 2, l: 956, a: 536 }, { l: 184, a: 317 }, 'cobrir');
  assert.ok(Math.abs(r.sx - 324.44) < 0.01, `sx ${r.sx}`);
  assert.ok(Math.abs(r.sl - 311.12) < 0.01, `sl ${r.sl}`);
  assert.deepEqual({ sy: r.sy, sa: r.sa, dx: r.dx, dy: r.dy, dl: r.dl, da: r.da }, {
    sy: 2,
    sa: 536,
    dx: 0,
    dy: 0,
    dl: 184,
    da: 317,
  });
});

test('recortar: o quadro sem tamanho não dá NaN', () => {
  const vazio = { sx: 2, sy: 2, sl: 956, sa: 536, dx: 0, dy: 0, dl: 0, da: 0 };
  for (const corte of ['cobrir', 'inteiro']) {
    assert.deepEqual(recortar({ x: 2, y: 2, l: 956, a: 536 }, { l: 0, a: 0 }, corte), vazio);
    assert.deepEqual(recortar({ x: 2, y: 2, l: 956, a: 536 }, { l: 100, a: 0 }, corte), vazio);
    assert.deepEqual(recortar({ x: 2, y: 2, l: 956, a: 536 }, { l: 0, a: 100 }, corte), vazio);
  }
});

test('recortar: o inteiro mostra a célula inteira, com faixas no quadro', () => {
  const r = recortar({ x: 0, y: 0, l: 1920, a: 1080 }, { l: 994, a: 608 }, 'inteiro');
  assert.deepEqual({ sx: r.sx, sy: r.sy, sl: r.sl, sa: r.sa, dx: r.dx, dl: r.dl }, {
    sx: 0,
    sy: 0,
    sl: 1920,
    sa: 1080,
    dx: 0,
    dl: 994,
  });
  assert.ok(Math.abs(r.dy - 24.44) < 0.01, `dy ${r.dy}`);
  assert.ok(Math.abs(r.da - 559.13) < 0.01, `da ${r.da}`);
});

test('recortar: o inteiro num quadro mais largo que a célula deixa as faixas dos lados', () => {
  const r = recortar({ x: 0, y: 0, l: 1920, a: 1080 }, { l: 1200, a: 400 }, 'inteiro');
  assert.deepEqual({ sx: r.sx, sy: r.sy, sl: r.sl, sa: r.sa, dy: r.dy, da: r.da }, {
    sx: 0,
    sy: 0,
    sl: 1920,
    sa: 1080,
    dy: 0,
    da: 400,
  });
  assert.ok(Math.abs(r.dx - 244.44) < 0.01, `dx ${r.dx}`);
  assert.ok(Math.abs(r.dl - 711.11) < 0.01, `dl ${r.dl}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// O sincronizar. Cada passo confere o resultado sem a memória, e a memória segue para o próximo passo congelada.

function passo(mem, palco, video, agora) {
  const r = sincronizar(congelar(mem), { palco, video, agora });
  const { mem: proxima, ...resto } = r;
  return { mem: proxima, r: resto };
}
const esperado = (modo, palco, esperando, proximo) => ({ modo, palco, esperando, proximo });

test('sincronizar: sem palco, espera 3000 ms e mostra o mosaico', () => {
  const m0 = sincroniaInicial(0);
  let s = passo(m0, null, V, 2999);
  assert.deepEqual(s.r, esperado('espera', null, [], 1));
  s = passo(s.mem, null, V, 3000);
  assert.deepEqual(s.r, esperado('mosaico', null, [], null));
  // Direto da memória do começo, também.
  assert.deepEqual(passo(m0, null, null, 3000).r, esperado('mosaico', null, [], null));
});

test('sincronizar: o palco só vale com o vídeo do tamanho dele, e quem entra espera', () => {
  const m0 = sincroniaInicial(0);
  // O primeiro palco vira o visto na hora; o vídeo desse tamanho espera 600 ms.
  let s = passo(m0, P4, { ...V }, 100);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 600));
  s = passo(s.mem, P4, { ...V }, 699);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 1));
  // As chaves do primeiro palco só esperam os 600 ms do tamanho.
  s = passo(s.mem, P4, { ...V }, 700);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));

  // Um palco novo do mesmo tamanho toma o lugar na hora; só a Bia, que entrou, espera 1000 ms.
  s = passo(s.mem, P4_COM_BIA, { ...V }, 5000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1000));
  s = passo(s.mem, P4_COM_BIA, { ...V }, 5999);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1));
  s = passo(s.mem, P4_COM_BIA, { ...V }, 6000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [], null));

  // Um palco de outro tamanho espera enquanto o vídeo tem o tamanho do visto: os quadros seguem com o anterior.
  s = passo(s.mem, PT, { ...V }, 7000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [], null));
  s = passo(s.mem, PT, { ...V }, 7399);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [], null));
  // O vídeo muda de tamanho: o palco novo vira o visto, e o vídeo desse tamanho espera 600 ms.
  s = passo(s.mem, PT, { ...V2 }, 7400);
  assert.deepEqual(s.r, esperado('espera', PT, CHAVES_PT, 600));
  // As chaves do palco que virou o visto pelo tamanho não esperam mais que os 600 ms.
  s = passo(s.mem, PT, { ...V2 }, 8000);
  assert.deepEqual(s.r, esperado('quadros', PT, [], null));

  // O vídeo volta ao tamanho de antes sem um palco novo: espera, e, 3000 ms depois, o mosaico.
  s = passo(s.mem, PT, { ...V }, 9000);
  assert.deepEqual(s.r, esperado('espera', PT, CHAVES_PT, 3000));
  s = passo(s.mem, PT, { ...V }, 11999);
  assert.deepEqual(s.r, esperado('espera', PT, CHAVES_PT, 1));
  s = passo(s.mem, PT, { ...V }, 12000);
  assert.deepEqual(s.r, esperado('mosaico', PT, [], null));
  // O palco de 1920x1080 chega: o vídeo tem esse tamanho desde 9000, e os quadros voltam na hora.
  s = passo(s.mem, P4, { ...V }, 12100);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));

  // Com palco e sem vídeo, espera, sem prazo.
  s = passo(s.mem, P4, null, 60000);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, null));
  s = passo(s.mem, P4, null, 600000);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, null));
});

test('sincronizar: quem fica com a célula de quem saiu mostra o fundo escuro por 1000 ms', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 1000);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));
  // O Roberto sai e a Bia fica com a célula dele: a imagem dessa célula ainda pode ser a do Roberto.
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 2000);
  assert.deepEqual(s.r, esperado('quadros', P4_BIA_NO_LUGAR_DO_ROBERTO, [`cam:${BIA}`], 1000));
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 2999);
  assert.deepEqual(s.r, esperado('quadros', P4_BIA_NO_LUGAR_DO_ROBERTO, [`cam:${BIA}`], 1));
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 3000);
  assert.deepEqual(s.r, esperado('quadros', P4_BIA_NO_LUGAR_DO_ROBERTO, [], null));
});

test('sincronizar: um palco do mesmo tamanho durante a espera do tamanho', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  // A Bia entra aos 400: a espera do tamanho segue até os 700, e a da Bia até os 1400.
  s = passo(s.mem, P4_COM_BIA, V, 400);
  assert.deepEqual(s.r, esperado('espera', P4_COM_BIA, [...CHAVES_P4, `cam:${BIA}`], 300));
  s = passo(s.mem, P4_COM_BIA, V, 700);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 700));
  s = passo(s.mem, P4_COM_BIA, V, 1400);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [], null));
});

test('sincronizar: o palco de outro tamanho que vira o visto só espera os 600 ms', () => {
  let s = passo(sincroniaInicial(0), P1, V, 100);
  s = passo(s.mem, P1, V, 700);
  // A Ana e a Maria entram aos 1000, num palco do mesmo tamanho.
  s = passo(s.mem, P3, V, 1000);
  assert.deepEqual(s.r, esperado('quadros', P3, [`cam:${ANA}`, `cam:${MARIA}`], 1000));
  // Aos 1100, a tela: o vídeo já tem o tamanho dela, e o palco dela vira o visto.
  s = passo(s.mem, PT, V2, 1100);
  assert.deepEqual(s.r, esperado('espera', PT, CHAVES_PT, 600));
  // Aos 1700, a Ana e a Maria não esperam mais: a espera do tamanho já cobriu a troca da imagem.
  s = passo(s.mem, PT, V2, 1700);
  assert.deepEqual(s.r, esperado('quadros', PT, [], null));
});

test('sincronizar: quem troca de célula num palco do mesmo tamanho espera como quem entrou', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  // A Ana e o Carlos trocam de célula: a imagem de cada célula ainda pode ser a do outro.
  const trocados = congelar({
    ...P4,
    quadros: [{ ...ana, x: 960 }, { ...carlos, x: 0 }, maria, roberto, voce],
  });
  s = passo(s.mem, trocados, V, 1000);
  assert.deepEqual(s.r, esperado('quadros', trocados, [`cam:${ANA}`, `cam:${CARLOS}`], 1000));
  s = passo(s.mem, trocados, V, 1999);
  assert.deepEqual(s.r, esperado('quadros', trocados, [`cam:${ANA}`, `cam:${CARLOS}`], 1));
  s = passo(s.mem, trocados, V, 2000);
  assert.deepEqual(s.r, esperado('quadros', trocados, [], null));
});

test('sincronizar: um palco do mesmo tamanho em que ninguém mudou de célula não faz ninguém esperar', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  s = passo(s.mem, P4_COM_BIA, V, 5000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1000));
  // Outro objeto com as mesmas células: a Bia segue com a espera dela, e ninguém mais entra.
  const igual = congelar(structuredClone(P4_COM_BIA));
  s = passo(s.mem, igual, V, 5500);
  assert.deepEqual(s.r, esperado('quadros', igual, [`cam:${BIA}`], 500));
  // O nome e o semCamera que mudam, na mesma célula, também não fazem esperar.
  const renomeados = congelar({
    ...igual,
    quadros: igual.quadros.map((q) =>
      q.quem === ANA ? { ...q, nome: '' } : q.quem === ROBERTO ? { ...q, semCamera: false } : q,
    ),
  });
  s = passo(s.mem, renomeados, V, 5600);
  assert.deepEqual(s.r, esperado('quadros', renomeados, [`cam:${BIA}`], 400));
  s = passo(s.mem, renomeados, V, 6000);
  assert.deepEqual(s.r, esperado('quadros', renomeados, [], null));
});

test('sincronizar: o palco do mesmo tamanho descarta o de outro tamanho que esperava', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  s = passo(s.mem, PT, V, 1000);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));
  // O servidor mudou de ideia: o palco do mesmo tamanho é o de agora, e a tela, que esperava, ficou velha.
  s = passo(s.mem, P4_COM_BIA, V, 1100);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1000));
  s = passo(s.mem, P4_COM_BIA, V2, 1500);
  assert.deepEqual(s.r, esperado('espera', P4_COM_BIA, [...CHAVES_P4, `cam:${BIA}`], 3000));
});

test('sincronizar: o palco que some volta ao prazo de 3000 ms', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 1000);
  s = passo(s.mem, null, V, 20000);
  assert.deepEqual(s.r, esperado('espera', null, [], 3000));
  s = passo(s.mem, null, V, 23000);
  assert.deepEqual(s.r, esperado('mosaico', null, [], null));
  // Quando ele volta, é como o primeiro: o vídeo já tem o tamanho dele há mais de 600 ms.
  s = passo(s.mem, P4, V, 24000);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));
});

test('sincronizar: a memória recebida nunca muda', () => {
  const m0 = congelar(sincroniaInicial(0));
  const copia = structuredClone(m0);
  const r1 = sincronizar(m0, { palco: P4, video: V, agora: 100 });
  assert.deepEqual(m0, copia);
  assert.notEqual(r1.mem, m0);
  const m1 = congelar(r1.mem);
  const copia1 = structuredClone(m1);
  const r2 = sincronizar(m1, { palco: P4_COM_BIA, video: V2, agora: 5000 });
  assert.deepEqual(m1, copia1);
  assert.notEqual(r2.mem, m1);
  // O mesmo passo, de novo, dá o mesmo resultado.
  assert.deepEqual(sincronizar(m1, { palco: P4_COM_BIA, video: V2, agora: 5000 }), r2);
});

test('sincronizar: o mosaico continua com palcos do tamanho errado, e os quadros voltam 600 ms depois do tamanho', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  // O vídeo muda de tamanho sem um palco dele: espera, e, 3000 ms depois, o mosaico.
  s = passo(s.mem, P4, V2, 1000);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 3000));
  s = passo(s.mem, P4, V2, 4000);
  assert.deepEqual(s.r, esperado('mosaico', P4, [], null));
  // Chegam palcos do tamanho de antes, que não é o do vídeo: eles tomam o lugar do visto, e o mosaico continua.
  s = passo(s.mem, P4_COM_BIA, V2, 4500);
  assert.deepEqual(s.r, esperado('mosaico', P4_COM_BIA, [], null));
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V2, 5000);
  assert.deepEqual(s.r, esperado('mosaico', P4_BIA_NO_LUGAR_DO_ROBERTO, [], null));
  // O vídeo volta ao tamanho do palco: 600 ms de espera, e os quadros. A Bia, que mudou de célula aos 5000, já esperou
  // os 1000 ms dela.
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 6000);
  assert.deepEqual(s.r, esperado('espera', P4_BIA_NO_LUGAR_DO_ROBERTO, CHAVES_P4.toSpliced(3, 1, `cam:${BIA}`), 600));
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 6599);
  assert.deepEqual(s.r.modo, 'espera');
  s = passo(s.mem, P4_BIA_NO_LUGAR_DO_ROBERTO, V, 6600);
  assert.deepEqual(s.r, esperado('quadros', P4_BIA_NO_LUGAR_DO_ROBERTO, [], null));
});

// O relógio da página é o do sistema, que pode voltar (um acerto da hora). A espera em curso recomeça no agora da volta,
// com a duração inteira, em vez de esticar pelo tamanho da volta.
const VOLTA_DO_RELOGIO = 30000;

test('sincronizar: o relógio que volta recomeça a espera do tamanho (600 ms)', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 600));
  const volta = 400 - VOLTA_DO_RELOGIO;
  s = passo(s.mem, P4, V, volta);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 600));
  s = passo(s.mem, P4, V, volta + 599);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 1));
  s = passo(s.mem, P4, V, volta + 600);
  assert.deepEqual(s.r, esperado('quadros', P4, [], null));
});

test('sincronizar: o relógio que volta recomeça a espera de quem entrou (1000 ms)', () => {
  let s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  s = passo(s.mem, P4_COM_BIA, V, 5000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1000));
  // O tamanho do vídeo também recomeça a conta: os 600 ms dele e os 1000 ms da Bia, desde a volta.
  const volta = 5500 - VOLTA_DO_RELOGIO;
  s = passo(s.mem, P4_COM_BIA, V, volta);
  assert.deepEqual(s.r, esperado('espera', P4_COM_BIA, [...CHAVES_P4, `cam:${BIA}`], 600));
  s = passo(s.mem, P4_COM_BIA, V, volta + 600);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 400));
  s = passo(s.mem, P4_COM_BIA, V, volta + 999);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [`cam:${BIA}`], 1));
  s = passo(s.mem, P4_COM_BIA, V, volta + 1000);
  assert.deepEqual(s.r, esperado('quadros', P4_COM_BIA, [], null));
});

test('sincronizar: o relógio que volta recomeça o prazo do mosaico (3000 ms)', () => {
  // Sem palco.
  let s = passo(sincroniaInicial(0), null, V, 1000);
  assert.deepEqual(s.r, esperado('espera', null, [], 2000));
  let volta = 1000 - VOLTA_DO_RELOGIO;
  s = passo(s.mem, null, V, volta);
  assert.deepEqual(s.r, esperado('espera', null, [], 3000));
  s = passo(s.mem, null, V, volta + 2999);
  assert.deepEqual(s.r, esperado('espera', null, [], 1));
  s = passo(s.mem, null, V, volta + 3000);
  assert.deepEqual(s.r, esperado('mosaico', null, [], null));
  // Com o vídeo de outro tamanho que o palco.
  s = passo(sincroniaInicial(0), P4, V, 100);
  s = passo(s.mem, P4, V, 700);
  s = passo(s.mem, P4, V2, 1000);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 3000));
  volta = 2000 - VOLTA_DO_RELOGIO;
  s = passo(s.mem, P4, V2, volta);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 3000));
  s = passo(s.mem, P4, V2, volta + 2999);
  assert.deepEqual(s.r, esperado('espera', P4, CHAVES_P4, 1));
  s = passo(s.mem, P4, V2, volta + 3000);
  assert.deepEqual(s.r, esperado('mosaico', P4, [], null));
});

// ---------------------------------------------------------------------------------------------------------------------
// O aoMudarOPalco.

test('aoMudarOPalco', () => {
  const carlosAumentado = `cam:${CARLOS}`;
  // A tela aparece, e a tela some.
  assert.equal(aoMudarOPalco(carlosAumentado, P4, PT), null);
  assert.equal(aoMudarOPalco(carlosAumentado, PT, P4), null);
  // O Carlos sai.
  assert.equal(aoMudarOPalco(carlosAumentado, P4, comOs(ANA, MARIA, ROBERTO)), null);
  assert.equal(aoMudarOPalco(carlosAumentado, P4, null), null);
  // A Bia entra.
  assert.equal(aoMudarOPalco(carlosAumentado, P4, P4_COM_BIA), carlosAumentado);
  // Sem ninguém aumentado, fica sem.
  assert.equal(aoMudarOPalco(null, P4, PT), null);
  assert.equal(aoMudarOPalco(null, P4, P4_COM_BIA), null);
  // Durante o compartilhamento, outro palco com a mesma tela.
  assert.equal(aoMudarOPalco(carlosAumentado, PT, PT_SEM_A_MARIA), carlosAumentado);
  // A tela troca de dono (a do Carlos no lugar da da Ana): o que é o grande mudou, e ninguém fica aumentado.
  const telaDoCarlos = congelar({
    ...PT,
    quadros: PT.quadros.map((q) => (q.tela ? { ...q, quem: CARLOS, nome: 'Carlos Lima' } : q)),
  });
  assert.equal(aoMudarOPalco(`cam:${MARIA}`, PT, telaDoCarlos), null);
  assert.equal(aoMudarOPalco(carlosAumentado, PT, telaDoCarlos), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// O arrumar. lugar(r, chave) é o lugar e o papel de um quadro do resultado.

const lugar = (r, chave) => {
  const q = r.quadros.find((x) => x.chave === chave);
  assert.ok(q, `sem o quadro ${chave}`);
  return { papel: q.papel, botao: q.botao, x: q.x, y: q.y, l: q.l, a: q.a };
};
const em = (papel, botao, x, y, l, a) => ({ papel, botao, x, y, l, a });
const chaves = (r, papel) => r.quadros.filter((q) => q.papel === papel).map((q) => q.chave);
const noPC = (palco, aumentado = null, area = PC) => arrumar({ palco, area, emPe: false, aumentado });
const noCelular = (palco, aumentado = null) => arrumar({ palco, area: CELULAR, emPe: true, aumentado });

const quadroDoVoce = (papel, x, y, l, a, quem = VOCE) => ({
  chave: 'voce',
  tipo: 'voce',
  quem,
  nome: '',
  semCamera: false,
  papel,
  botao: false,
  x,
  y,
  l,
  a,
  recorte: null,
  corte: 'cobrir',
});

test('arrumar no PC: sozinho, o Você fica na grade', () => {
  const grade = { modo: 'grade', grande: null, voltar: null, gire: null, faixa: null };
  assert.deepEqual(noPC(null), { ...grade, quadros: [quadroDoVoce('grade', 8, 0, 1216, 608, null)] });
  assert.deepEqual(noPC(P_SO_O_VOCE), { ...grade, quadros: [quadroDoVoce('grade', 8, 0, 1216, 608)] });
});

test('arrumar no PC: 1 outro, na grade sem botão, e o Você no canto', () => {
  assert.deepEqual(noPC(P1), {
    modo: 'grade',
    grande: null,
    voltar: null,
    gire: null,
    faixa: null,
    quadros: [
      {
        chave: `cam:${CARLOS}`,
        tipo: 'camera',
        quem: CARLOS,
        nome: 'Carlos Lima',
        semCamera: false,
        papel: 'grade',
        botao: false,
        x: 8,
        y: 0,
        l: 1216,
        a: 608,
        recorte: { x: 962, y: 2, l: 956, a: 536 },
        corte: 'cobrir',
      },
      quadroDoVoce('canto', 1008, 475, 208, 117),
    ],
  });
});

test('arrumar no PC: 4 outros, em duas colunas com botão', () => {
  const r = noPC(P4);
  assert.equal(r.modo, 'grade');
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 12, 0, 600, 300));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 620, 0, 600, 300));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 12, 308, 600, 300));
  assert.deepEqual(lugar(r, `cam:${ROBERTO}`), em('grade', true, 620, 308, 600, 300));
  assert.deepEqual(lugar(r, 'voce'), em('canto', false, 1008, 475, 208, 117));
  const anaQ = r.quadros.find((q) => q.chave === `cam:${ANA}`);
  assert.deepEqual(anaQ.recorte, { x: 2, y: 2, l: 956, a: 536 });
  assert.equal(anaQ.corte, 'cobrir');
  // O semCamera e o nome saem como vieram do palco.
  const robertoQ = r.quadros.find((q) => q.chave === `cam:${ROBERTO}`);
  assert.equal(robertoQ.semCamera, true);
  assert.equal(robertoQ.nome, 'Roberto');
  assert.equal(r.quadros.length, 5);
});

test('arrumar no PC: 3 outros, e a última linha no centro', () => {
  const r = noPC(P3);
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 12, 0, 600, 300));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 620, 0, 600, 300));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 316, 308, 600, 300));
});

test('arrumar no PC: 9 outros, em três colunas', () => {
  const r = noPC(P9);
  const outros = r.quadros.filter((q) => q.tipo === 'camera');
  assert.equal(outros.length, 9);
  for (const q of outros) {
    assert.equal(q.l, 395);
    assert.equal(q.a, 197);
  }
  assert.equal(new Set(outros.map((q) => q.x)).size, 3);
  assert.equal(new Set(outros.map((q) => q.y)).size, 3);
});

test('arrumar no PC: de 5 a 8 outros, e a última linha incompleta no centro', () => {
  // n outros, cada um numa célula qualquer do mosaico: o arrumar só olha a ordem.
  const comN = (n) =>
    congelar({
      largura: 1920,
      altura: 1080,
      quadros: [
        ...Array.from({ length: n }, (_, i) => cam(`d00000000000000${i + 1}`, `Pessoa ${i + 1}`, 0, 0, 480, 270)),
        voce,
      ],
    });
  const grade = (n) => {
    const r = noPC(comN(n));
    assert.equal(r.modo, 'grade');
    assert.deepEqual(lugar(r, 'voce'), em('canto', false, 1008, 475, 208, 117));
    return r.quadros.filter((q) => q.tipo === 'camera').map((q) => [q.x, q.y, q.l, q.a]);
  };
  // 5 e 6: três colunas e duas linhas de 405x300; com 5, os dois da última linha no centro.
  assert.deepEqual(grade(5), [
    [0, 0, 405, 300],
    [413, 0, 405, 300],
    [827, 0, 405, 300],
    [207, 308, 405, 300],
    [620, 308, 405, 300],
  ]);
  assert.deepEqual(grade(6), [
    [0, 0, 405, 300],
    [413, 0, 405, 300],
    [827, 0, 405, 300],
    [0, 308, 405, 300],
    [413, 308, 405, 300],
    [827, 308, 405, 300],
  ]);
  // 7 e 8: três colunas e três linhas de 395x197; com 7, o último no centro, e com 8, os dois.
  const seis = [
    [16, 0, 395, 197],
    [419, 0, 395, 197],
    [821, 0, 395, 197],
    [16, 205, 395, 197],
    [419, 205, 395, 197],
    [821, 205, 395, 197],
  ];
  assert.deepEqual(grade(7), [...seis, [419, 411, 395, 197]]);
  assert.deepEqual(grade(8), [...seis, [217, 411, 395, 197], [620, 411, 395, 197]]);
});

test('arrumar no PC: o Carlos aumentado, e as outras pessoas na faixa', () => {
  const r = noPC(P4, `cam:${CARLOS}`);
  assert.equal(r.modo, 'grande');
  assert.equal(r.grande, `cam:${CARLOS}`);
  assert.equal(r.voltar, 'verTodos');
  assert.equal(r.gire, null);
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grande', false, 0, 0, 994, 608));
  assert.deepEqual(r.faixa, { eixo: 'y', x: 1004, y: 0, l: 228, a: 608, rotulo: 'As outras pessoas' });
  assert.deepEqual(chaves(r, 'faixa'), [`cam:${ANA}`, `cam:${MARIA}`, `cam:${ROBERTO}`, 'voce']);
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('faixa', true, 0, 0, 228, 128));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('faixa', true, 0, 136, 228, 128));
  assert.deepEqual(lugar(r, `cam:${ROBERTO}`), em('faixa', true, 0, 272, 228, 128));
  assert.deepEqual(lugar(r, 'voce'), em('faixa', false, 0, 408, 228, 128));
  assert.equal(r.quadros.length, 5);
});

test('arrumar no PC: a chave aumentada que não está no palco vale como nenhuma', () => {
  assert.deepEqual(noPC(P4, `cam:${BIA}`), noPC(P4));
  assert.deepEqual(noPC(P4, 'voce'), noPC(P4));
});

test('arrumar no PC: a tela grande, e as pessoas na faixa', () => {
  const r = noPC(PT);
  assert.equal(r.modo, 'grande');
  assert.equal(r.grande, `tela:${ANA}`);
  assert.equal(r.voltar, null);
  const tela = r.quadros.find((q) => q.chave === `tela:${ANA}`);
  assert.deepEqual(tela, {
    chave: `tela:${ANA}`,
    tipo: 'tela',
    quem: ANA,
    nome: 'Ana Souza',
    semCamera: false,
    papel: 'grande',
    botao: false,
    x: 0,
    y: 0,
    l: 994,
    a: 608,
    recorte: { x: 0, y: 0, l: 1920, a: 1080 },
    corte: 'inteiro',
  });
  assert.deepEqual(r.faixa, { eixo: 'y', x: 1004, y: 0, l: 228, a: 608, rotulo: 'As pessoas' });
  assert.deepEqual(chaves(r, 'faixa'), [`cam:${ANA}`, `cam:${CARLOS}`, `cam:${MARIA}`, 'voce']);
  assert.deepEqual(
    r.quadros.filter((q) => q.papel === 'faixa').map((q) => q.botao),
    [true, true, true, false],
  );
});

test('arrumar no PC: a tela e o Carlos aumentado', () => {
  const r = noPC(PT, `cam:${CARLOS}`);
  assert.equal(r.modo, 'grande');
  assert.equal(r.grande, `cam:${CARLOS}`);
  assert.equal(r.voltar, 'voltarParaATela');
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grande', false, 0, 0, 994, 608));
  assert.equal(r.faixa.rotulo, 'A tela e as outras pessoas');
  assert.deepEqual(chaves(r, 'faixa'), [`tela:${ANA}`, `cam:${ANA}`, `cam:${MARIA}`, 'voce']);
  assert.deepEqual(lugar(r, `tela:${ANA}`), em('faixa', true, 0, 0, 228, 128));
  const tela = r.quadros.find((q) => q.chave === `tela:${ANA}`);
  assert.deepEqual([tela.recorte, tela.corte], [{ x: 0, y: 0, l: 1920, a: 1080 }, 'inteiro']);
});

test('arrumar no PC: a área de 796x250 com 2 outros', () => {
  const r = noPC(P2, null, { l: 796, a: 250 });
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 0, 0, 394, 250));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 402, 0, 394, 250));
  assert.deepEqual(lugar(r, 'voce'), em('canto', false, 645, 158, 135, 76));
});

test('arrumar: não muda o que recebe', () => {
  const entrada = congelar({ palco: PT, area: PC, emPe: false, aumentado: `cam:${CARLOS}` });
  const copia = structuredClone(entrada);
  arrumar(entrada);
  arrumar({ ...entrada, emPe: true, area: CELULAR });
  assert.deepEqual(entrada, copia);
});

// ---------------------------------------------------------------------------------------------------------------------
// O arrumar no celular em pé.

test('arrumar no celular: sozinho, o Você ocupa a área inteira', () => {
  const r = noCelular(null);
  assert.deepEqual(r.quadros, [quadroDoVoce('grade', 0, 0, 374, 640, null)]);
  assert.deepEqual(noCelular(P_SO_O_VOCE).quadros, [quadroDoVoce('grade', 0, 0, 374, 640)]);
});

test('arrumar no celular: 1 outro, e o Você no canto', () => {
  const r = noCelular(P1);
  assert.equal(r.modo, 'grade');
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', false, 0, 0, 374, 640));
  assert.deepEqual(lugar(r, 'voce'), em('canto', false, 272, 507, 92, 123));
});

test('arrumar no celular: 3 outros, numa coluna', () => {
  const r = noCelular(P3);
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 0, 0, 374, 209));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 0, 215, 374, 209));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 0, 431, 374, 209));
});

test('arrumar no celular: 4 outros, em duas colunas', () => {
  const r = noCelular(P4);
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 0, 0, 184, 317));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 190, 0, 184, 317));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 0, 323, 184, 317));
  assert.deepEqual(lugar(r, `cam:${ROBERTO}`), em('grade', true, 190, 323, 184, 317));
  assert.deepEqual(lugar(r, 'voce'), em('canto', false, 280, 518, 84, 112));
});

test('arrumar no celular: 5 outros, e o último na linha inteira', () => {
  const r = noCelular(P4_COM_BIA);
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 0, 0, 184, 209));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 190, 0, 184, 209));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 0, 215, 184, 209));
  assert.deepEqual(lugar(r, `cam:${ROBERTO}`), em('grade', true, 190, 215, 184, 209));
  assert.deepEqual(lugar(r, `cam:${BIA}`), em('grade', true, 0, 431, 374, 209));
  assert.deepEqual(lugar(r, 'voce'), em('canto', false, 280, 518, 84, 112));
});

test('arrumar no celular: o Carlos aumentado, e a faixa embaixo', () => {
  const r = noCelular(P4, `cam:${CARLOS}`);
  assert.equal(r.modo, 'grande');
  assert.equal(r.voltar, 'verTodos');
  assert.equal(r.gire, null);
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grande', false, 0, 0, 374, 562));
  assert.deepEqual(r.faixa, { eixo: 'x', x: 0, y: 568, l: 374, a: 72, rotulo: 'As outras pessoas' });
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('faixa', true, 0, 0, 128, 72));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('faixa', true, 134, 0, 128, 72));
  assert.deepEqual(lugar(r, `cam:${ROBERTO}`), em('faixa', true, 268, 0, 128, 72));
  assert.deepEqual(lugar(r, 'voce'), em('faixa', false, 402, 0, 128, 72));
});

test('arrumar no celular: a tela em cima, o aviso de girar e as pessoas embaixo', () => {
  const r = noCelular(PT);
  assert.equal(r.modo, 'grande');
  assert.equal(r.grande, `tela:${ANA}`);
  assert.equal(r.voltar, null);
  assert.equal(r.faixa, null);
  assert.deepEqual(lugar(r, `tela:${ANA}`), em('grande', false, 0, 0, 374, 210));
  assert.deepEqual(r.gire, { x: 0, y: 216, l: 374, a: 28 });
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('grade', true, 0, 250, 184, 192));
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grade', true, 190, 250, 184, 192));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('grade', true, 0, 448, 184, 192));
  assert.deepEqual(lugar(r, 'voce'), em('grade', false, 190, 448, 184, 192));
});

test('arrumar no celular: a tela com uma câmera aumentada', () => {
  const r = noCelular(PT, `cam:${CARLOS}`);
  assert.equal(r.modo, 'grande');
  assert.equal(r.grande, `cam:${CARLOS}`);
  assert.equal(r.voltar, 'voltarParaATela');
  assert.equal(r.gire, null);
  assert.deepEqual(lugar(r, `cam:${CARLOS}`), em('grande', false, 0, 0, 374, 562));
  assert.deepEqual(r.faixa, { eixo: 'x', x: 0, y: 568, l: 374, a: 72, rotulo: 'A tela e as outras pessoas' });
  assert.deepEqual(chaves(r, 'faixa'), [`tela:${ANA}`, `cam:${ANA}`, `cam:${MARIA}`, 'voce']);
  assert.deepEqual(lugar(r, `tela:${ANA}`), em('faixa', true, 0, 0, 128, 72));
  assert.deepEqual(lugar(r, `cam:${ANA}`), em('faixa', true, 134, 0, 128, 72));
  assert.deepEqual(lugar(r, `cam:${MARIA}`), em('faixa', true, 268, 0, 128, 72));
  assert.deepEqual(lugar(r, 'voce'), em('faixa', false, 402, 0, 128, 72));
});

// ---------------------------------------------------------------------------------------------------------------------
// As áreas pequenas demais: 0x0 antes do layout, num contêiner escondido ou no meio do giro.

test('arrumar e recortar: nenhuma área dá número negativo, infinito ou NaN', () => {
  const bom = (n) => Number.isFinite(n) && n >= 0;
  const primeiro = (p) => p?.quadros.find((q) => !q.tela && !q.voce);
  const palcos = { null: null, soOVoce: P_SO_O_VOCE, P1, P2, P3, P4, P4_COM_BIA, P9, P12, PT, PT_SEM_A_MARIA };
  let casos = 0;
  for (const area of [{ l: 0, a: 0 }, { l: 10, a: 10 }, { l: 100, a: 50 }]) {
    for (const [nome, palco] of Object.entries(palcos)) {
      const outro = primeiro(palco);
      for (const aumentado of [null, ...(outro ? [chaveDe(outro)] : [])]) {
        for (const emPe of [false, true]) {
          const caso = `${area.l}x${area.a} ${nome} ${aumentado ?? '-'} ${emPe ? 'em pé' : 'PC'}`;
          const r = arrumar({ palco, area, emPe, aumentado });
          const retangulos = [...r.quadros, ...(r.faixa ? [r.faixa] : []), ...(r.gire ? [r.gire] : [])];
          for (const q of retangulos) {
            for (const k of ['x', 'y', 'l', 'a']) {
              assert.ok(bom(q[k]), `${caso}: ${q.chave ?? 'faixa/gire'}.${k} = ${q[k]}`);
            }
          }
          for (const q of r.quadros) {
            const c = recortar(q.recorte ?? { x: 0, y: 0, l: 640, a: 480 }, { l: q.l, a: q.a }, q.corte);
            for (const [k, v] of Object.entries(c)) assert.ok(bom(v), `${caso}: recorte de ${q.chave}.${k} = ${v}`);
          }
          casos++;
        }
      }
    }
  }
  // 3 áreas; 9 palcos com outros (sem e com aumentado) e 2 sem; as duas orientações.
  assert.equal(casos, 3 * (9 * 2 + 2) * 2);
});
