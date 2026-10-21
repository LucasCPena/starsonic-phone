// O toque, gerado na interface por WebAudio (sem arquivos de som): 425 Hz, como o tom de chamada.
// - completo: 1 s ligado e 4 s desligado (uma recebida sem outra ligação);
// - espera: um bipe de 0,2 s a cada 3 s (a segunda ligação, sem cobrir a conversa);
// - parar: encerra na hora.
// Toca no dispositivo de Toque das Configurações (`audio.toque`, um deviceId de saída) pelo AudioContext.setSinkId;
// sem o id, sem o setSinkId, sem permissão ou com o dispositivo fora, toca no padrão. Só a janela principal toca
// (o aviso do canto recebe as mesmas mensagens e fica quieto, para o toque não sair em dobro).
// O relógio e o AudioContext são injetáveis (os testes usam um relógio falso e um contexto que grava o que acontece).
import type { RingKind } from './state';

/** O pedaço do AudioContext que o toque usa. */
export interface RingAudioContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  setSinkId?(sinkId: string): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface RingClock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface RingOptions {
  createContext?: () => RingAudioContext;
  clock?: RingClock;
}

export interface Ringer {
  /** O toque pedido pelo C++ (`completo`, `espera`, `parar`), no dispositivo `sinkId` ("" = o padrão). */
  play(tipo: RingKind, sinkId: string): void;
  /** O dispositivo de Toque mudou: o toque que está tocando passa para ele. */
  setDevice(sinkId: string): void;
  stop(): void;
}

export const RING_HZ = 425;

interface Cadence {
  /** Quanto tempo o tom fica ligado (s). */
  on: number;
  /** De um começo ao próximo (ms). */
  periodMs: number;
  /** O volume (o bipe de espera é mais baixo: a pessoa está falando). */
  level: number;
}

export const CADENCES: Record<Exclude<RingKind, 'parar'>, Cadence> = {
  completo: { on: 1, periodMs: 5000, level: 0.3 },
  espera: { on: 0.2, periodMs: 3000, level: 0.18 },
};

/** A subida e a descida de cada toque (evita o estalo no começo e no fim). */
const RAMPA = 0.01;

export function createRinger(options: RingOptions = {}): Ringer {
  const createContext = options.createContext ?? (() => new AudioContext() as unknown as RingAudioContext);
  const clock: RingClock = options.clock ?? {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };

  let current: { tipo: RingKind; ctx: RingAudioContext; osc: OscillatorNode; timer: number } | null = null;
  // Cada pedido ganha uma vez: um setSinkId que demora não liga um toque que já foi trocado ou parado.
  let vez = 0;

  const stop = () => {
    vez++;
    const atual = current;
    current = null;
    if (!atual) return;
    clock.clearTimeout(atual.timer);
    try {
      atual.osc.stop();
    } catch {
      // Já parado.
    }
    atual.osc.disconnect();
    void atual.ctx.close().catch(() => {});
  };

  /** "" é o padrão: um contexto novo já está nele, então só um toque que já toca troca para o "". */
  const trocarSaida = async (ctx: RingAudioContext, sinkId: string, mesmoVazio = false) => {
    if ((!sinkId && !mesmoVazio) || typeof ctx.setSinkId !== 'function') return;
    try {
      await ctx.setSinkId(sinkId);
    } catch {
      // Sem permissão, ou o dispositivo saiu: fica no padrão.
    }
  };

  const play = (tipo: RingKind, sinkId: string) => {
    if (tipo === 'parar') {
      stop();
      return;
    }
    if (current?.tipo === tipo) return;
    stop();
    const minhaVez = vez;
    const cadencia = CADENCES[tipo];
    let ctx: RingAudioContext;
    try {
      ctx = createContext();
    } catch {
      return; // Sem WebAudio: nada a tocar (a ligação aparece do mesmo jeito).
    }
    void (async () => {
      await trocarSaida(ctx, sinkId);
      if (minhaVez !== vez) {
        void ctx.close().catch(() => {});
        return;
      }
      void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = RING_HZ;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      const tocar = () => {
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(cadencia.level, t + RAMPA);
        gain.gain.setValueAtTime(cadencia.level, t + cadencia.on - RAMPA);
        gain.gain.linearRampToValueAtTime(0, t + cadencia.on);
        if (current) current.timer = clock.setTimeout(tocar, cadencia.periodMs);
      };
      current = { tipo, ctx, osc, timer: 0 };
      tocar();
    })();
  };

  return {
    play,
    stop,
    setDevice(sinkId) {
      if (current) void trocarSaida(current.ctx, sinkId, true);
    },
  };
}
