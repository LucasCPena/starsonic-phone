// A câmera e o som falsos de cada pessoa do teste, e os pontos e as cores do mosaico que o navegador confere.
//
// Cada pessoa tem uma câmera de uma cor só (um Y4M de 320×180 a 15 quadros por segundo) e um microfone de um tom só
// (um WAV de 10 s), que o Chromium repete. O cliente mínimo (cliente/cliente.js) liga com eles, e o Navegador
// (navegador.ts) lê o vídeo e o som que chegam do FreeSWITCH: a cor em pontos do mosaico e a frequência mais forte do
// som.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAIDA } from './servidores';

export type Cor = readonly [number, number, number];
export type Ponto = readonly [number, number];

export const VERMELHO: Cor = [220, 30, 30];
export const AZUL: Cor = [30, 60, 220];
export const AMARELO: Cor = [220, 200, 30];
export const VERDE: Cor = [30, 180, 60]; // a tela compartilhada

export interface Pessoa {
  letra: 'A' | 'B' | 'C';
  cor: Cor;
  som: number; // em Hz
}

export const A: Pessoa = { letra: 'A', cor: VERMELHO, som: 440 };
export const B: Pessoa = { letra: 'B', cor: AZUL, som: 880 };
export const C: Pessoa = { letra: 'C', cor: AMARELO, som: 660 };

// Os pontos do mosaico, em frações do vídeo recebido (os layouts da seção 7 do docs/video-agente.md, num quadro de
// 360×360 esticado sobre os 1280×720): o centro de cada quadro.
export const MOSAICO_1: Ponto[] = [[0.5, 0.5]];
export const MOSAICO_2: Ponto[] = [
  [0.25, 0.5],
  [0.75, 0.5],
];
export const MOSAICO_4: Ponto[] = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];
// No mosaico de 2, a faixa de cima (y de 0 a 90 do quadro de 360) é o fundo; no de 4, é o meio dos quadros de cima.
export const FUNDO_DO_MOSAICO_2: Ponto[] = [
  [0.25, 0.125],
  [0.75, 0.125],
];
// A apresentação: a tela em (0,0,300) e as pessoas nos dez quadros de 60.
const centro = (x: number, y: number, lado: number): Ponto => [(x + lado / 2) / 360, (y + lado / 2) / 360];
export const TELA: Ponto = centro(0, 0, 300);
export const QUADROS_PEQUENOS: Ponto[] = [
  centro(300, 0, 60),
  centro(300, 60, 60),
  centro(300, 120, 60),
  centro(300, 180, 60),
  centro(300, 240, 60),
  centro(300, 300, 60),
  centro(60, 300, 60),
  centro(120, 300, 60),
  centro(180, 300, 60),
  centro(240, 300, 60),
];

// A faixa do nome nos dois quadros do mosaico de 2 (cada um de 640×360, de y 180 a 540 no vídeo de 720): o FreeSWITCH
// desenha o nome numa faixa de 2 × o tamanho da fonte (de 16 a 40 px) no pé do quadro, com o texto a meia fonte da
// borda esquerda. O retângulo pega a metade esquerda da faixa, de 28 a 6 px acima do pé.
export const FAIXAS_DO_MOSAICO_2: Array<[number, number, number, number]> = [
  [4 / 1280, 512 / 720, 320 / 1280, 534 / 720],
  [644 / 1280, 512 / 720, 960 / 1280, 534 / 720],
];

/** Uma cor confere com a esperada quando cada canal está a até 60 dela. */
export function perto(vista: Cor | null, esperada: Cor): boolean {
  return vista !== null && vista.every((c, i) => Math.abs(c - esperada[i]) <= 60);
}

export const escuro = (c: Cor | null) => c !== null && Math.max(...c) <= 60;

/** Diz se cada cor pode ficar com um ponto diferente, cada um com uma cor que confere. */
export function combinam(vistas: Array<Cor | null>, cores: readonly Cor[], usados = new Set<number>()): boolean {
  if (cores.length === 0) return true;
  const [primeira, ...resto] = cores;
  return vistas.some((v, i) => {
    if (usados.has(i) || !perto(v, primeira)) return false;
    usados.add(i);
    const ok = combinam(vistas, resto, usados);
    usados.delete(i);
    return ok;
  });
}

// --- Os arquivos --------------------------------------------------------------------------------------------------

/** A pasta dos arquivos da câmera e do som (o ambiente.ts os gera). */
export const PASTA_DA_MIDIA = join(SAIDA, 'midia');

/** A cor em YCbCr do BT.601 com a faixa de vídeo (16 a 235), a do I420 que o Chromium lê do Y4M. */
function ycbcr([r, g, b]: Cor): [number, number, number] {
  const y = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
  const cb = 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255;
  const cr = 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255;
  return [Math.round(y), Math.round(cb), Math.round(cr)];
}

/** Um Y4M de 320×180 a 15 quadros por segundo, com 15 quadros da cor. */
function y4m(cor: Cor): Buffer {
  const [w, h] = [320, 180];
  const [y, cb, cr] = ycbcr(cor);
  const quadro = Buffer.concat([
    Buffer.from('FRAME\n'),
    Buffer.alloc(w * h, y),
    Buffer.alloc((w / 2) * (h / 2), cb),
    Buffer.alloc((w / 2) * (h / 2), cr),
  ]);
  const cabecalho = Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`);
  return Buffer.concat([cabecalho, ...Array<Buffer>(15).fill(quadro)]);
}

/** Um WAV de 10 s, mono, 48 kHz e 16 bits, com o tom a meia escala. */
function wav(hz: number): Buffer {
  const taxa = 48_000;
  const amostras = taxa * 10;
  const dados = Buffer.alloc(amostras * 2);
  for (let i = 0; i < amostras; i++) {
    dados.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * hz * i) / taxa)), i * 2);
  }
  const cabecalho = Buffer.alloc(44);
  cabecalho.write('RIFF', 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write('WAVE', 8);
  cabecalho.write('fmt ', 12);
  cabecalho.writeUInt32LE(16, 16); // o tamanho do fmt
  cabecalho.writeUInt16LE(1, 20); // PCM
  cabecalho.writeUInt16LE(1, 22); // mono
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28); // bytes por segundo
  cabecalho.writeUInt16LE(2, 32); // bytes por amostra
  cabecalho.writeUInt16LE(16, 34); // bits por amostra
  cabecalho.write('data', 36);
  cabecalho.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cabecalho, dados]);
}

/** Escreve a câmera e o som de cada pessoa na pasta. */
export function gerarMidia(pasta = PASTA_DA_MIDIA): void {
  mkdirSync(pasta, { recursive: true });
  for (const p of [A, B, C]) {
    writeFileSync(join(pasta, `${p.letra}.y4m`), y4m(p.cor));
    writeFileSync(join(pasta, `${p.letra}.wav`), wav(p.som));
  }
}

/** As opções do Chromium que trocam a câmera e o microfone pelos arquivos da pessoa. */
export function argumentosDoChromium(p: Pessoa, pasta = PASTA_DA_MIDIA): string[] {
  return [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${join(pasta, `${p.letra}.y4m`)}`,
    `--use-file-for-fake-audio-capture=${join(pasta, `${p.letra}.wav`)}`,
    '--autoplay-policy=no-user-gesture-required',
  ];
}
