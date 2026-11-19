// O desenho de um quadro I420 num canvas (spec do vídeo, 6.4): pelo WebGL, com as três camadas da imagem (o Y, o U e o
// V) em três texturas e a conversão para RGB no shader; sem o WebGL, pelo canvas 2D, mais devagar (a conversão em JS para
// um ImageData do tamanho do quadro, num canvas de fora da tela). A imagem fica inteira, sem distorção e no meio do canvas
// (o `encaixar`); o resto é o fundo da área do vídeo, o #04060e.
import type { QuadroI420 } from './memoria';

/** O fundo da área do vídeo e das faixas da imagem encaixada: o #04060e. */
export const COR_DO_FUNDO: readonly [number, number, number] = [4, 6, 14];

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** O lugar da imagem de `largura`×`altura` inteira e sem distorção no meio da área, em pixels inteiros. */
export function encaixar(largura: number, altura: number, areaLargura: number, areaAltura: number): Retangulo {
  const escala = Math.min(areaLargura / largura, areaAltura / altura);
  const l = Math.round(largura * escala);
  const a = Math.round(altura * escala);
  return { x: Math.round((areaLargura - l) / 2), y: Math.round((areaAltura - a) / 2), largura: l, altura: a };
}

// A conversão BT.601 de faixa limitada (o Y de 16 a 235, o U e o V em volta de 128), a mesma no shader e no canvas 2D:
// R = 1.164(Y−16) + 1.596(V−128); G = 1.164(Y−16) − 0.392(U−128) − 0.813(V−128); B = 1.164(Y−16) + 2.017(U−128).
const K_Y = 1.164;
const K_RV = 1.596;
const K_GU = 0.392;
const K_GV = 0.813;
const K_BU = 2.017;

const byte = (x: number) => Math.min(255, Math.max(0, Math.round(x)));

/** A cor RGB de um pixel I420 (arredondada e cortada em 0 e 255). */
export function i420ParaRgb(y: number, u: number, v: number): [number, number, number] {
  const c = K_Y * (y - 16);
  const d = u - 128;
  const e = v - 128;
  return [byte(c + K_RV * e), byte(c - K_GU * d - K_GV * e), byte(c + K_BU * d)];
}

export interface Desenhista {
  readonly tipo: 'webgl' | '2d';
  /** O quadro encaixado no canvas inteiro (no tamanho de agora dele), com o fundo em volta. */
  desenhar(q: QuadroI420): void;
  /** Só o fundo. */
  limpar(): void;
  /** Solta o que o desenho guarda (as texturas e o programa do WebGL, o canvas de fora da tela). */
  liberar(): void;
}

/** O desenho pelo WebGL; sem ele, pelo canvas 2D. */
export function criarDesenhista(canvas: HTMLCanvasElement): Desenhista {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
  return gl ? desenhistaWebgl(gl) : desenhista2d(canvas);
}

const coeficiente = (k: number) => k.toFixed(3);

const SHADER_DOS_VERTICES = `
attribute vec2 aPosicao;
attribute vec2 aTextura;
varying vec2 vTextura;
void main() {
  vTextura = aTextura;
  gl_Position = vec4(aPosicao, 0.0, 1.0);
}`;

const SHADER_DAS_CORES = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uY;
uniform sampler2D uU;
uniform sampler2D uV;
varying vec2 vTextura;
void main() {
  float c = ${coeficiente(K_Y)} * (texture2D(uY, vTextura).r * 255.0 - 16.0);
  float d = texture2D(uU, vTextura).r * 255.0 - 128.0;
  float e = texture2D(uV, vTextura).r * 255.0 - 128.0;
  vec3 rgb = vec3(c + ${coeficiente(K_RV)} * e, c - ${coeficiente(K_GU)} * d - ${coeficiente(K_GV)} * e, c + ${coeficiente(K_BU)} * d);
  gl_FragColor = vec4(clamp(rgb / 255.0, 0.0, 1.0), 1.0);
}`;

function compilar(gl: WebGLRenderingContext, tipo: number, fonte: string): WebGLShader | null {
  const shader = gl.createShader(tipo);
  if (!shader) return null;
  gl.shaderSource(shader, fonte);
  gl.compileShader(shader);
  return shader;
}

function desenhistaWebgl(gl: WebGLRenderingContext): Desenhista {
  const programa = gl.createProgram();
  const shaders = [compilar(gl, gl.VERTEX_SHADER, SHADER_DOS_VERTICES), compilar(gl, gl.FRAGMENT_SHADER, SHADER_DAS_CORES)];
  for (const s of shaders) {
    if (!s) continue;
    gl.attachShader(programa, s);
    // Só marcados: saem junto com o programa.
    gl.deleteShader(s);
  }
  gl.linkProgram(programa);
  gl.useProgram(programa);

  // Um retângulo de dois triângulos: x e y do espaço do WebGL, s e t da textura. A primeira linha do quadro é a de cima.
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
  const posicao = gl.getAttribLocation(programa, 'aPosicao');
  const textura = gl.getAttribLocation(programa, 'aTextura');
  gl.enableVertexAttribArray(posicao);
  gl.vertexAttribPointer(posicao, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(textura);
  gl.vertexAttribPointer(textura, 2, gl.FLOAT, false, 16, 8);

  // As três camadas, cada uma na sua unidade de textura (0, 1 e 2), de uma linha sem sobra (o UNPACK_ALIGNMENT 1).
  const texturas = ['uY', 'uU', 'uV'].map((nome, i) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(programa, nome), i);
    return t;
  });
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.clearColor(COR_DO_FUNDO[0] / 255, COR_DO_FUNDO[1] / 255, COR_DO_FUNDO[2] / 255, 1);
  // O tamanho das texturas de agora: o texSubImage2D enquanto o quadro não muda de tamanho.
  let largura = 0;
  let altura = 0;

  return {
    tipo: 'webgl',
    desenhar(q) {
      const mesmoTamanho = q.largura === largura && q.altura === altura;
      const croma = [(q.largura + 1) >> 1, (q.altura + 1) >> 1];
      const planos: Array<[Uint8Array, number, number]> = [
        [q.y, q.largura, q.altura],
        [q.u, croma[0], croma[1]],
        [q.v, croma[0], croma[1]],
      ];
      planos.forEach(([dados, l, a], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        if (mesmoTamanho) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, l, a, gl.LUMINANCE, gl.UNSIGNED_BYTE, dados);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, l, a, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, dados);
      });
      largura = q.largura;
      altura = q.altura;
      const areaLargura = gl.drawingBufferWidth;
      const areaAltura = gl.drawingBufferHeight;
      gl.clear(gl.COLOR_BUFFER_BIT);
      const r = encaixar(q.largura, q.altura, areaLargura, areaAltura);
      // O viewport do WebGL conta de baixo para cima.
      gl.viewport(r.x, areaAltura - r.y - r.altura, r.largura, r.altura);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    limpar() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    liberar() {
      for (const t of texturas) gl.deleteTexture(t);
      gl.deleteBuffer(vertices);
      gl.deleteProgram(programa);
      // O contexto sai na hora (o Chromium só deixa alguns abertos), sem esperar o coletor de lixo.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** O quadro em RGBA, com a conta do i420ParaRgb: o Uint8ClampedArray arredonda e corta em 0 e 255. */
function converter(q: QuadroI420, rgba: Uint8ClampedArray) {
  const larguraCroma = (q.largura + 1) >> 1;
  for (let linha = 0; linha < q.altura; linha++) {
    const inicioY = linha * q.largura;
    const inicioCroma = (linha >> 1) * larguraCroma;
    for (let coluna = 0; coluna < q.largura; coluna++) {
      const c = K_Y * (q.y[inicioY + coluna] - 16);
      const d = q.u[inicioCroma + (coluna >> 1)] - 128;
      const e = q.v[inicioCroma + (coluna >> 1)] - 128;
      const k = (inicioY + coluna) * 4;
      rgba[k] = c + K_RV * e;
      rgba[k + 1] = c - K_GU * d - K_GV * e;
      rgba[k + 2] = c + K_BU * d;
      rgba[k + 3] = 255;
    }
  }
}

function desenhista2d(canvas: HTMLCanvasElement): Desenhista {
  const g = canvas.getContext('2d', { alpha: false });
  const fundo = `rgb(${COR_DO_FUNDO.join(', ')})`;
  // O canvas de fora da tela, do tamanho do quadro, com o ImageData dele.
  let fora: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; imagem: ImageData } | null = null;
  const limpar = () => {
    if (!g) return;
    g.fillStyle = fundo;
    g.fillRect(0, 0, canvas.width, canvas.height);
  };
  return {
    tipo: '2d',
    desenhar(q) {
      if (!g) return;
      if (!fora || fora.imagem.width !== q.largura || fora.imagem.height !== q.altura) {
        const novo = fora?.canvas ?? document.createElement('canvas');
        novo.width = q.largura;
        novo.height = q.altura;
        const gFora = novo.getContext('2d');
        if (!gFora) return;
        fora = { canvas: novo, g: gFora, imagem: gFora.createImageData(q.largura, q.altura) };
      }
      converter(q, fora.imagem.data);
      fora.g.putImageData(fora.imagem, 0, 0);
      limpar();
      const r = encaixar(q.largura, q.altura, canvas.width, canvas.height);
      g.drawImage(fora.canvas, r.x, r.y, r.largura, r.altura);
    },
    limpar,
    liberar() {
      fora = null;
    },
  };
}
