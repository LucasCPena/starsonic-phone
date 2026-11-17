// A câmera e o som falsos de cada pessoa do teste, e o navegador que os usa.
//
// Cada pessoa tem uma câmera de uma cor só (um Y4M de 320×180 a 15 quadros por segundo) e um microfone de um tom só
// (um WAV de 10 s), que o Chromium repete. O cliente mínimo (cliente/cliente.js) liga com eles, e o Navegador lê o
// vídeo e o som que chegam do FreeSWITCH: a cor em pontos do mosaico e a frequência mais forte do som.
import { chromium, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anotarSegredos, CHAT, PAGINA, SAIDA } from './servidores';

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
const FUNDO_DO_MOSAICO_2: Ponto[] = [
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
const FAIXAS_DO_MOSAICO_2: Array<[number, number, number, number]> = [
  [4 / 1280, 512 / 720, 320 / 1280, 534 / 720],
  [644 / 1280, 512 / 720, 960 / 1280, 534 / 720],
];

/** Uma cor confere com a esperada quando cada canal está a até 60 dela. */
export function perto(vista: Cor | null, esperada: Cor): boolean {
  return vista !== null && vista.every((c, i) => Math.abs(c - esperada[i]) <= 60);
}

const escuro = (c: Cor | null) => c !== null && Math.max(...c) <= 60;

/** Diz se cada cor pode ficar com um ponto diferente, cada um com uma cor que confere. */
function combinam(vistas: Array<Cor | null>, cores: readonly Cor[], usados = new Set<number>()): boolean {
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

// --- O navegador -----------------------------------------------------------------------------------------------------

/** O Acesso de quem entra (seção 9 do protocolo); sem a senha, a ligação vai sem o X-Starsonic-Senha. */
export interface AcessoDoNavegador {
  senha?: string;
  video: { wss: string; uri: string };
}

/** Como uma ligação terminou: o código SIP da resposta final (um 403), ou null quando terminou por um BYE. */
export interface Fim {
  codigo: number | null;
  causa: string;
  originador: string;
}

export interface Mensagem {
  tipo: string;
  [campo: string]: any;
}

/** O cliente mínimo, como o cliente.js o põe em window.cliente. */
interface Cliente {
  diagnostico(): unknown;
  estatisticas(): Promise<unknown>;
  entrarPelaPagina(opcoes: { chat: string; codigo: string; nome: string }): Promise<{ bilhete: string }>;
  ligar(acesso: AcessoDoNavegador): Promise<void>;
  mensagens(): Mensagem[];
  amostra(fx: number, fy: number): Cor | null;
  faixa(x0: number, y0: number, x1: number, y1: number): { claros: number; escuros: number; total: number } | null;
  frequencia(): { hz: number; db: number } | null;
  pedirTela(): Promise<string>;
  compartilhar(senha: string): Promise<void>;
  telaNoAr(): boolean;
  pararDeCompartilhar(): Promise<void>;
  pararDeMandar(): void;
  sair(): Promise<void>;
  terminou(prazo: number): Promise<Fim | null>;
}

declare global {
  interface Window {
    cliente: Cliente;
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const texto = (x: unknown) => JSON.stringify(x);

/** Um Chromium com a câmera e o microfone de uma pessoa, na página do cliente mínimo. */
export class Navegador {
  private fechado = false;
  private readonly console: string[] = [];

  private constructor(
    readonly pessoa: Pessoa,
    private readonly browser: Browser,
    readonly page: Page,
  ) {}

  static async abrir(p: Pessoa): Promise<Navegador> {
    const browser = await chromium.launch({ args: argumentosDoChromium(p) });
    try {
      // A permissão da câmera e do microfone dada à página, como a pessoa a dá. Sem ela, o Chromium esconde o IP
      // dos candidatos atrás de um nome mDNS (<uuid>.local), que o FreeSWITCH não resolve e descarta, e a
      // ligação não acha caminho (no teste não há TURN). Com ela, a coleta dos candidatos também acaba logo.
      const contexto = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const page = await contexto.newPage();
      const n = new Navegador(p, browser, page);
      page.on('console', (m) => n.console.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => n.console.push(`[pageerror] ${e.message}`));
      await page.goto(`${PAGINA}/`);
      await page.waitForFunction(() => window.cliente !== undefined);
      return n;
    } catch (e) {
      await browser.close();
      throw e;
    }
  }

  /** O abrir, o canal e o pedir; com o aceito, o cliente liga sozinho. O bilhete do abrir fica anotado. */
  async entrarPelaPagina(codigo: string, nome: string): Promise<void> {
    anotarSegredos({ codigo });
    anotarSegredos(await this.page.evaluate((o) => window.cliente.entrarPelaPagina(o), { chat: CHAT, codigo, nome }));
  }

  async ligar(acesso: AcessoDoNavegador): Promise<void> {
    anotarSegredos(acesso);
    await this.page.evaluate((a) => window.cliente.ligar(a), acesso);
  }

  async mensagens(): Promise<Mensagem[]> {
    const lista = await this.page.evaluate(() => window.cliente.mensagens());
    anotarSegredos(lista);
    return lista;
  }

  /** A primeira mensagem do tipo no canal da página, esperando até prazo ms. */
  async esperarMensagem(tipo: string, prazo = 20_000): Promise<Mensagem> {
    const fim = Date.now() + prazo;
    for (;;) {
      const lista = await this.mensagens();
      const m = lista.find((x) => x.tipo === tipo);
      if (m) return m;
      if (Date.now() > fim) {
        throw new Error(`${this.pessoa.letra} não recebeu ${tipo} em ${prazo / 1000} s; recebeu ${texto(lista.map((x) => x.tipo))}`);
      }
      await esperar(200);
    }
  }

  private amostras(pontos: readonly Ponto[]): Promise<Array<Cor | null>> {
    return this.page.evaluate((ps) => ps.map(([x, y]) => window.cliente.amostra(x, y)), pontos);
  }

  /** O estado das ligações e do vídeo do cliente, com os contadores do RTP e do ICE, para as mensagens de erro. */
  private async diagnostico(): Promise<string> {
    try {
      return texto(
        await this.page.evaluate(async () => ({
          estado: window.cliente.diagnostico(),
          midia: await window.cliente.estatisticas(),
        })),
      );
    } catch (e) {
      return `(sem diagnóstico: ${(e as Error).message})`;
    }
  }

  /** Espera cada cor num ponto diferente do vídeo recebido, em qualquer ordem, até prazo ms. */
  async esperarCores(pontos: readonly Ponto[], cores: readonly Cor[], prazo = 20_000): Promise<void> {
    const fim = Date.now() + prazo;
    for (;;) {
      const vistas = await this.amostras(pontos);
      if (combinam(vistas, cores)) return;
      if (Date.now() > fim) {
        throw new Error(
          `no vídeo de ${this.pessoa.letra}, as cores ${texto(cores)} não apareceram nos pontos ${texto(pontos)} ` +
            `em ${prazo / 1000} s; as últimas vistas: ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
        );
      }
      await esperar(250);
    }
  }

  /** Espera o mosaico de 2: as duas cores nos dois quadros e o fundo escuro em cima deles (o de 4 tem gente ali). */
  async esperarMosaicoDe2(cores: readonly Cor[], prazo = 20_000): Promise<void> {
    const fim = Date.now() + prazo;
    for (;;) {
      const vistas = await this.amostras([...MOSAICO_2, ...FUNDO_DO_MOSAICO_2]);
      if (combinam(vistas.slice(0, 2), cores) && vistas.slice(2).every(escuro)) return;
      if (Date.now() > fim) {
        throw new Error(
          `o vídeo de ${this.pessoa.letra} não voltou ao mosaico de 2 com ${texto(cores)} em ${prazo / 1000} s; ` +
            `as últimas vistas (os dois quadros e o fundo): ${texto(vistas)}; o cliente: ${await this.diagnostico()}`,
        );
      }
      await esperar(250);
    }
  }

  /** Espera a faixa do nome de cada quadro do mosaico de 2 com o texto claro sobre o fundo escuro. */
  async esperarNomesNoMosaicoDe2(prazo = 20_000): Promise<void> {
    const fim = Date.now() + prazo;
    for (;;) {
      const faixas = await this.page.evaluate(
        (fs) => fs.map(([x0, y0, x1, y1]) => window.cliente.faixa(x0, y0, x1, y1)),
        FAIXAS_DO_MOSAICO_2,
      );
      if (faixas.every((f) => f !== null && f.claros >= 20 && f.escuros >= f.total / 2)) return;
      if (Date.now() > fim) {
        throw new Error(
          `as faixas dos nomes no vídeo de ${this.pessoa.letra} não têm texto: ${texto(faixas)}; o cliente: ${await this.diagnostico()}`,
        );
      }
      await esperar(250);
    }
  }

  /** Espera a frequência mais forte do som recebido a até 25 Hz de hz. */
  async esperarFrequencia(hz: number, prazo = 20_000): Promise<void> {
    const fim = Date.now() + prazo;
    for (;;) {
      const f = await this.page.evaluate(() => window.cliente.frequencia());
      if (f !== null && f.db > -80 && Math.abs(f.hz - hz) <= 25) return;
      if (Date.now() > fim) {
        throw new Error(
          `${this.pessoa.letra} não ouviu ${hz} Hz em ${prazo / 1000} s; o último: ${texto(f)}; o cliente: ${await this.diagnostico()}`,
        );
      }
      await esperar(250);
    }
  }

  /** A senha da tela compartilhada, pedida pelo canal da página. */
  async pedirTela(): Promise<string> {
    const senha = await this.page.evaluate(() => window.cliente.pedirTela());
    anotarSegredos({ senha });
    return senha;
  }

  async compartilhar(senha: string): Promise<void> {
    await this.page.evaluate((s) => window.cliente.compartilhar(s), senha);
  }

  telaNoAr(): Promise<boolean> {
    return this.page.evaluate(() => window.cliente.telaNoAr());
  }

  async pararDeCompartilhar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeCompartilhar());
  }

  /** Nada mais sai da ligação da câmera (a RTCPeerConnection fecha sem o BYE), com o WebSocket aberto. */
  async pararDeMandar(): Promise<void> {
    await this.page.evaluate(() => window.cliente.pararDeMandar());
  }

  async sair(): Promise<void> {
    await this.page.evaluate(() => window.cliente.sair());
  }

  /** Como a ligação da câmera terminou, esperando até prazo ms; null se ela não terminou. */
  terminou(prazo = 10_000): Promise<Fim | null> {
    return this.page.evaluate((p) => window.cliente.terminou(p), prazo);
  }

  /** Sai da reunião (o BYE das ligações) e fecha o navegador: uma ligação esquecida no FreeSWITCH mandaria a mídia
   * para uma porta que o navegador do teste seguinte pode pegar. Pode ser chamado de novo. */
  async fechar(): Promise<void> {
    if (this.fechado) return;
    try {
      await this.sair();
    } catch {
      // a página já não responde
    }
    await this.fecharAba();
  }

  /** Fecha o navegador inteiro (o browser.close()), sem o sair() e sem o BYE, como quem fecha a aba. */
  async fecharAba(): Promise<void> {
    if (this.fechado) return;
    this.fechado = true;
    try {
      await this.mensagens();
    } catch {
      // a página já não responde: o que ela tinha já foi anotado
    }
    await this.browser.close();
    try {
      await test.info().attach(`console-${this.pessoa.letra}`, { body: this.console.join('\n'), contentType: 'text/plain' });
    } catch {
      // fora de um teste
    }
  }
}
