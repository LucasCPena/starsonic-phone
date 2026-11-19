// A memória do vídeo (docs/ponte-windows.md, "A memória do vídeo"): a leitura da página e o escritor que a imita (o
// FrameBufferWriter do executável). Roda no Node, sem a página.
import { expect, test } from '@playwright/test';
import {
  CABECALHO,
  MARCA,
  TAMANHO_DA_MEMORIA,
  TAMANHO_DO_LUGAR,
  aindaVale,
  copiarQuadro,
  escreverQuadro,
  esvaziar,
  lerQuadro,
  seqDe,
} from '../../src/video/memoria';

const nova = () => new ArrayBuffer(TAMANHO_DA_MEMORIA);
const cab = (m: ArrayBuffer) => new DataView(m);
const lugarDe = (m: ArrayBuffer) => cab(m).getUint32(8, true);

function quadroPequeno(m: ArrayBuffer) {
  escreverQuadro(m, 4, 2, Uint8Array.from([16, 17, 18, 19, 20, 21, 22, 23]), Uint8Array.from([100, 101]), Uint8Array.from([200, 201]));
}

test('the constants follow the bridge document', () => {
  expect(MARCA).toBe(0x31565353);
  expect(CABECALHO).toBe(64);
  expect(TAMANHO_DO_LUGAR).toBe(1920 * 1080 + 2 * (960 * 540));
  expect(TAMANHO_DA_MEMORIA).toBe(64 + 2 * TAMANHO_DO_LUGAR);
  expect(TAMANHO_DA_MEMORIA).toBe(6_220_864);
});

test('a written frame reads back with its size and planes', () => {
  const m = nova();
  quadroPequeno(m);
  const q = lerQuadro(m, 0);
  expect(q).not.toBeNull();
  expect(q!.largura).toBe(4);
  expect(q!.altura).toBe(2);
  expect(q!.seq).toBe(2);
  expect([...q!.y]).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);
  expect([...q!.u]).toEqual([100, 101]);
  expect([...q!.v]).toEqual([200, 201]);
});

test('an empty memory, a frame already seen or a header being written gives nothing', () => {
  const m = nova();
  expect(lerQuadro(m, 0)).toBeNull();
  quadroPequeno(m);
  const q = lerQuadro(m, 0)!;
  expect(lerQuadro(m, q.seq)).toBeNull();
  cab(m).setUint32(4, 3, true);
  expect(lerQuadro(m, 0)).toBeNull();
});

test('the writer alternates the slots and keeps counting after esvaziar', () => {
  const m = nova();
  const vistos: Array<[number, number]> = [];
  for (let i = 0; i < 3; i++) {
    quadroPequeno(m);
    vistos.push([seqDe(m), lugarDe(m)]);
  }
  expect(vistos).toEqual([
    [2, 0],
    [4, 1],
    [6, 0],
  ]);
  esvaziar(m);
  expect(seqDe(m)).toBe(0);
  expect(lerQuadro(m, 0)).toBeNull();
  quadroPequeno(m);
  expect(seqDe(m)).toBe(8);
  expect(lugarDe(m)).toBe(1);
});

test('a header that does not fit gives nothing', () => {
  const quebrar = (campo: (d: DataView) => void) => {
    const m = nova();
    quadroPequeno(m);
    expect(lerQuadro(m, 0)).not.toBeNull();
    campo(cab(m));
    expect(lerQuadro(m, 0)).toBeNull();
  };
  quebrar((d) => d.setUint32(0, 0x12345678, true));
  quebrar((d) => d.setUint32(12, 1921, true));
  quebrar((d) => d.setUint32(16, 0, true));
  quebrar((d) => d.setUint32(16, 1081, true));
  quebrar((d) => d.setUint32(20, 5, true));
  quebrar((d) => d.setUint32(24, 3, true));
  quebrar((d) => d.setUint32(8, 2, true));
  quebrar((d) => d.setUint32(28, 3_110_401, true));
  const curta = new ArrayBuffer(6_220_863);
  expect(lerQuadro(curta, 0)).toBeNull();
  const boa = nova();
  quadroPequeno(boa);
  const copia = new ArrayBuffer(6_220_863);
  new Uint8Array(copia).set(new Uint8Array(boa, 0, 6_220_863));
  expect(lerQuadro(copia, 0)).toBeNull();
});

test('a copy torn by the writer is dropped', () => {
  const m = nova();
  quadroPequeno(m);
  const copia = copiarQuadro(m, 0)!;
  expect(copia.seq).toBe(2);
  expect(aindaVale(m, copia)).toBe(true);
  escreverQuadro(m, 4, 2, 9, 9, 9);
  expect(aindaVale(m, copia)).toBe(false);
  const novo = lerQuadro(m, 0)!;
  expect(novo.seq).toBe(4);
  expect([...novo.y]).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
});

test('odd sizes round the chroma planes up', () => {
  const m = nova();
  const y = new Uint8Array(175 * 143).map((_, i) => i % 251);
  const u = new Uint8Array(88 * 72).map((_, i) => (i * 3) % 253);
  const v = new Uint8Array(88 * 72).map((_, i) => (i * 7) % 249);
  escreverQuadro(m, 175, 143, y, u, v);
  const q = lerQuadro(m, 0)!;
  expect(q.largura).toBe(175);
  expect(q.altura).toBe(143);
  expect(q.y.length).toBe(25025);
  expect(q.u.length).toBe(6336);
  expect(q.v.length).toBe(6336);
  expect(q.y).toEqual(y);
  expect(q.u).toEqual(u);
  expect(q.v).toEqual(v);
});

test('the biggest frame fills the slot', () => {
  const m = nova();
  escreverQuadro(m, 1920, 1080, 10, 20, 30);
  const q = lerQuadro(m, 0)!;
  expect(q.y.length).toBe(2_073_600);
  expect(q.u.length).toBe(518_400);
  expect(q.v.length).toBe(518_400);
  expect(q.y[2_073_599]).toBe(10);
  expect(q.u[518_399]).toBe(20);
  expect(q.v[518_399]).toBe(30);
});
