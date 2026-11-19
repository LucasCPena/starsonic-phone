// A memória do vídeo (docs/ponte-windows.md, "A memória do vídeo"): um cabeçalho de 64 bytes e dois lugares com um quadro
// I420 de até 1920×1080 cada, gravada só pelo executável (windows/app/src/FrameBuffer.cpp). A página só lê (copiarQuadro,
// aindaVale, lerQuadro). O escritor (escreverQuadro, esvaziar) é só dos testes, e imita o FrameBufferWriter.

export const MARCA = 0x31565353;
export const CABECALHO = 64;
/** 1920*1080 + 2*(960*540). */
export const TAMANHO_DO_LUGAR = 3_110_400;
/** 64 + 2 * TAMANHO_DO_LUGAR. */
export const TAMANHO_DA_MEMORIA = 6_220_864;

const LARGURA_MAXIMA = 1920;
const ALTURA_MAXIMA = 1080;

// Os deslocamentos do cabeçalho (u32 little-endian).
const DESL_MARCA = 0;
const DESL_SEQ = 4;
const DESL_LUGAR = 8;
const DESL_LARGURA = 12;
const DESL_ALTURA = 16;
const DESL_Y_PASSO = 20;
const DESL_UV_PASSO = 24;
const DESL_TAMANHO_DO_LUGAR = 28;

export interface QuadroI420 {
  seq: number;
  largura: number;
  altura: number;
  y: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
}

/** Um valor só (a cor lisa) ou o plano inteiro. */
export type Plano = number | Uint8Array;

const croma = (n: number) => (n + 1) >> 1;

/** O `seq` de agora, lido de forma atômica (o escritor grava por outro processo). */
export function seqDe(memoria: ArrayBuffer): number {
  return Atomics.load(new Int32Array(memoria, DESL_SEQ, 1), 0) >>> 0;
}

/**
 * Os passos 1 e 2 da leitura: o `seq` (s1), o cabeçalho conferido e os planos copiados para fora da memória. `null`: sem
 * quadro (seq 0, ímpar ou o já visto), um cabeçalho que não faz sentido, ou uma memória menor que a combinada.
 */
export function copiarQuadro(memoria: ArrayBuffer, jaVisto: number): QuadroI420 | null {
  if (memoria.byteLength < TAMANHO_DA_MEMORIA) return null;
  const s1 = seqDe(memoria);
  if (s1 === 0 || (s1 & 1) !== 0 || s1 === jaVisto) return null;
  const d = new DataView(memoria);
  const lugar = d.getUint32(DESL_LUGAR, true);
  const largura = d.getUint32(DESL_LARGURA, true);
  const altura = d.getUint32(DESL_ALTURA, true);
  if (
    d.getUint32(DESL_MARCA, true) !== MARCA ||
    lugar > 1 ||
    largura < 1 ||
    largura > LARGURA_MAXIMA ||
    altura < 1 ||
    altura > ALTURA_MAXIMA ||
    d.getUint32(DESL_Y_PASSO, true) !== largura ||
    d.getUint32(DESL_UV_PASSO, true) !== croma(largura) ||
    d.getUint32(DESL_TAMANHO_DO_LUGAR, true) !== TAMANHO_DO_LUGAR
  ) {
    return null;
  }
  const base = CABECALHO + lugar * TAMANHO_DO_LUGAR;
  const tamanhoY = largura * altura;
  const tamanhoCroma = croma(largura) * croma(altura);
  return {
    seq: s1,
    largura,
    altura,
    y: new Uint8Array(memoria, base, tamanhoY).slice(),
    u: new Uint8Array(memoria, base + tamanhoY, tamanhoCroma).slice(),
    v: new Uint8Array(memoria, base + tamanhoY + tamanhoCroma, tamanhoCroma).slice(),
  };
}

/** O passo 3: o `seq` não mudou desde a cópia (o escritor não virou o lugar no meio dela). */
export function aindaVale(memoria: ArrayBuffer, quadro: QuadroI420): boolean {
  return seqDe(memoria) === quadro.seq;
}

/** O quadro inteiro e atual, ou `null`: a cópia e a conferência juntas. */
export function lerQuadro(memoria: ArrayBuffer, jaVisto: number): QuadroI420 | null {
  const copia = copiarQuadro(memoria, jaVisto);
  return copia !== null && aindaVale(memoria, copia) ? copia : null;
}

// O que o escritor guarda por memória: o contador e o lugar do último quadro. Nunca são lidos de volta da memória (um
// `esvaziar` zera o `seq` dela, e a contagem continua).
const escritores = new WeakMap<ArrayBuffer, { seq: number; lugar: number }>();

function preencher(destino: Uint8Array, plano: Plano) {
  if (typeof plano === 'number') destino.fill(plano);
  else destino.set(plano.subarray(0, destino.length));
}

/**
 * Grava um quadro como o FrameBufferWriter do executável: o primeiro vai ao lugar 0 e os seguintes alternam; soma 1 ao
 * `seq` (ímpar), grava o cabeçalho e soma 1 de novo (par). Cada plano é o conteúdo inteiro ou um valor só.
 */
export function escreverQuadro(memoria: ArrayBuffer, largura: number, altura: number, y: Plano, u: Plano, v: Plano): void {
  const estado = escritores.get(memoria) ?? { seq: 0, lugar: 0 };
  const lugar = estado.seq === 0 ? 0 : 1 - estado.lugar;
  const d = new DataView(memoria);
  const seq = new Int32Array(memoria, DESL_SEQ, 1);
  if (d.getUint32(DESL_MARCA, true) !== MARCA) d.setUint32(DESL_MARCA, MARCA, true);

  const base = CABECALHO + lugar * TAMANHO_DO_LUGAR;
  const tamanhoY = largura * altura;
  const tamanhoCroma = croma(largura) * croma(altura);
  preencher(new Uint8Array(memoria, base, tamanhoY), y);
  preencher(new Uint8Array(memoria, base + tamanhoY, tamanhoCroma), u);
  preencher(new Uint8Array(memoria, base + tamanhoY + tamanhoCroma, tamanhoCroma), v);

  Atomics.store(seq, 0, estado.seq + 1);
  d.setUint32(DESL_LUGAR, lugar, true);
  d.setUint32(DESL_LARGURA, largura, true);
  d.setUint32(DESL_ALTURA, altura, true);
  d.setUint32(DESL_Y_PASSO, largura, true);
  d.setUint32(DESL_UV_PASSO, croma(largura), true);
  d.setUint32(DESL_TAMANHO_DO_LUGAR, TAMANHO_DO_LUGAR, true);
  Atomics.store(seq, 0, estado.seq + 2);
  escritores.set(memoria, { seq: estado.seq + 2, lugar });
}

/** Como o `Clear` do executável: só o `seq` do cabeçalho vai a 0, e a contagem do escritor continua. */
export function esvaziar(memoria: ArrayBuffer): void {
  Atomics.store(new Int32Array(memoria, DESL_SEQ, 1), 0, 0);
}
