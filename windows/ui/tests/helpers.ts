// O que as specs da tela da ligação e do aviso usam contra a ponte falsa (?fake=<cenario>).
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURAS = fileURLToPath(new URL('../test-results/capturas/', import.meta.url));

export type Comando = Record<string, unknown>;

export async function abrir(page: Page, cenario: string, pagina = 'index.html'): Promise<void> {
  await page.goto(`/${pagina}?fake=${cenario}`);
  await expect(page.locator('body[data-pronto]')).toHaveCount(1);
}

export async function comandos(page: Page): Promise<Comando[]> {
  return page.evaluate(() => (window as unknown as { __comandos: Comando[] }).__comandos);
}

export async function esperarComando(page: Page, esperado: Comando): Promise<void> {
  await expect.poll(() => comandos(page)).toContainEqual({ v: 1, ...esperado });
}

/** Quantas vezes o comando saiu (com exatamente estes campos). */
export async function vezes(page: Page, esperado: Comando): Promise<number> {
  const alvo = JSON.stringify({ v: 1, ...esperado });
  return (await comandos(page)).filter((c) => JSON.stringify(c) === alvo).length;
}

export async function empurrar(page: Page, mensagem: unknown): Promise<void> {
  await page.evaluate((m) => (window as unknown as { __fake: { push(m: unknown): void } }).__fake.push(m), mensagem);
}

/** O estado de agora do C++ de mentira. */
export async function estado(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as unknown as { __fake: { state(): Record<string, any> } }).__fake.state());
}

/** Manda um estado novo: o de agora com `mudar` aplicado. */
export async function mudarEstado(page: Page, mudar: (s: Record<string, any>) => Record<string, any>): Promise<void> {
  await empurrar(page, { v: 1, type: 'state', state: mudar(await estado(page)) });
}

export async function verTextos(page: Page, textos: string[]): Promise<void> {
  for (const texto of textos) {
    await expect(page.getByText(texto, { exact: true }).first(), texto).toBeVisible();
  }
}

export async function semViolacoesSerias(page: Page): Promise<void> {
  const resultado = await new AxeBuilder({ page }).analyze();
  const serias = resultado.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ regra: v.id, impacto: v.impact, onde: v.nodes.map((n) => n.target.join(' ')) }));
  expect(serias, JSON.stringify(serias, null, 2)).toEqual([]);
}

export async function capturar(page: Page, nome: string, tema: string): Promise<void> {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  // O ponteiro fora dos botões: nenhum em hover na captura.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(CAPTURAS, `${nome}-${tema}.png`) });
}

/** O que o AudioContext falso guardou (um por toque). */
export interface AudioGravado {
  sinkId: string;
  /** Cada setSinkId que deu certo, na ordem. */
  sinks: string[];
  closed: boolean;
  resumed: boolean;
  oscillators: Array<{ type: string; frequency: number; started: boolean; stopped: boolean }>;
  /** As automações do ganho: [tipo, valor, tempo em s do relógio do contexto]. */
  gains: Array<Array<[string, number, number]>>;
}

/**
 * Troca o AudioContext da página por um falso que grava o que o toque faz (o oscilador, o ganho, o setSinkId).
 * O `currentTime` segue o performance.now() da página (o relógio falso do Playwright, quando instalado).
 * `window.__audioSinkFalha = true` faz o setSinkId falhar (sem permissão, ou o dispositivo sumiu).
 */
export async function audioFalso(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const gravados: unknown[] = [];
    w.__audio = gravados;
    class Param {
      constructor(private log: Array<[string, number, number]>) {}
      value = 0;
      setValueAtTime(v: number, t: number) {
        this.log.push(['set', v, t]);
      }
      linearRampToValueAtTime(v: number, t: number) {
        this.log.push(['ramp', v, t]);
      }
      cancelScheduledValues(t: number) {
        this.log.push(['cancel', 0, t]);
      }
    }
    class FakeAudioContext {
      private t0 = performance.now();
      private rec = { sinkId: '', sinks: [] as string[], closed: false, resumed: false, oscillators: [] as unknown[], gains: [] as unknown[] };
      state = 'running';
      destination = { connect() {}, disconnect() {} };
      constructor() {
        gravados.push(this.rec);
      }
      get currentTime() {
        return (performance.now() - this.t0) / 1000;
      }
      get sinkId() {
        return this.rec.sinkId;
      }
      createOscillator() {
        const o = { type: 'sine', frequency: 0, started: false, stopped: false };
        this.rec.oscillators.push(o);
        return {
          set type(v: string) {
            o.type = v;
          },
          get type() {
            return o.type;
          },
          frequency: {
            set value(v: number) {
              o.frequency = v;
            },
            get value() {
              return o.frequency;
            },
            setValueAtTime(v: number) {
              o.frequency = v;
            },
          },
          connect() {},
          disconnect() {},
          start() {
            o.started = true;
          },
          stop() {
            o.stopped = true;
          },
        };
      }
      createGain() {
        const log: Array<[string, number, number]> = [];
        this.rec.gains.push(log);
        return { gain: new Param(log), connect() {}, disconnect() {} };
      }
      setSinkId(id: string) {
        if (w.__audioSinkFalha) return Promise.reject(new DOMException('sem permissão', 'NotAllowedError'));
        this.rec.sinkId = id;
        this.rec.sinks.push(id);
        return Promise.resolve();
      }
      resume() {
        this.rec.resumed = true;
        return Promise.resolve();
      }
      close() {
        this.rec.closed = true;
        this.state = 'closed';
        return Promise.resolve();
      }
    }
    w.AudioContext = FakeAudioContext;
  });
}

export async function audio(page: Page): Promise<AudioGravado[]> {
  return page.evaluate(() => (window as unknown as { __audio: AudioGravado[] }).__audio);
}

/** Os instantes (s) em que o ganho sobe (o começo de cada toque) e em que volta a zero. */
export function toques(gains: Array<[string, number, number]>): { liga: number[]; desliga: number[] } {
  const rampas = gains.filter(([tipo]) => tipo === 'ramp');
  return {
    liga: rampas.filter(([, v]) => v > 0).map(([, , t]) => t),
    desliga: rampas.filter(([, v]) => v === 0).map(([, , t]) => t),
  };
}

/** As saídas de som que o `navigator.mediaDevices.enumerateDevices()` da página devolve (com os rótulos). */
export async function saidasFalsas(page: Page, saidas: Array<{ deviceId: string; label: string }>): Promise<void> {
  await page.addInitScript((lista) => {
    const md = navigator.mediaDevices as unknown as Record<string, unknown> | undefined;
    const devolver = async () =>
      lista.map((d) => ({ ...d, kind: 'audiooutput', groupId: '', toJSON() { return this; } }));
    if (md) Object.defineProperty(md, 'enumerateDevices', { value: devolver, configurable: true });
  }, saidas);
}
