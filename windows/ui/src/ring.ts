// O toque, gerado na interface por WebAudio (sem arquivos de som): 425 Hz, como o tom de chamada.
// - completo: 1 s ligado e 4 s desligado (uma recebida sem outra ligação);
// - espera: um bipe de 0,2 s a cada 3 s (a segunda ligação, sem cobrir a conversa);
// - parar: encerra na hora.
// A saída (AudioContext.setSinkId):
// - completo: o dispositivo de Toque das Configurações (`audio.toque`, um deviceId da própria interface);
// - espera: o alto-falante da ligação (a pessoa já está falando e ouve por ele). O `audio.altoFalante` é o nome do
//   motor, não um deviceId: a saída é a do `enumerateDevices` cujo rótulo é esse nome (ou começa com ele, ou ele
//   com o rótulo: o motor corta os nomes longos) — `matchOutputDevice`.
// Sem o id, sem nome, sem rótulos (sem a permissão de mídia), sem saída que case, sem o setSinkId ou com erro nele,
// toca no padrão: nunca fica mudo. Só a janela principal toca (o aviso do canto recebe as mesmas mensagens e fica
// quieto, para o toque não sair em dobro).
// O relógio, o AudioContext e a lista das saídas são injetáveis (os testes usam um relógio falso e um contexto que
// grava o que acontece).
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

/** Uma saída de som do WebView2 (o `MediaDeviceInfo` de `audiooutput`). */
export interface OutputDevice {
  deviceId: string;
  /** Vazio sem a permissão de mídia. */
  label: string;
}

/** As escolhas de som do estado que o toque usa (do `audio`). */
export interface RingOutputs {
  /** O deviceId do Toque ("" = o padrão): o toque completo. */
  toque: string;
  /** O nome do alto-falante da ligação no motor ("" = o padrão do Windows): o bipe de espera. */
  altoFalante: string;
}

export interface RingOptions {
  createContext?: () => RingAudioContext;
  clock?: RingClock;
  /** As saídas de som de agora (o padrão: `navigator.mediaDevices.enumerateDevices()`, só as `audiooutput`). */
  listOutputs?: () => Promise<OutputDevice[]>;
}

export interface Ringer {
  /** O toque pedido pelo C++ (`completo`, `espera`, `parar`), na saída que as escolhas de som pedem. */
  play(tipo: RingKind, saidas: RingOutputs): void;
  /** As escolhas mudaram: o toque que está tocando passa para a saída nova (o próximo toque já sai nela). */
  setOutputs(saidas: RingOutputs): void;
  stop(): void;
}

function normalizar(texto: string): string {
  return texto.trim().toLocaleLowerCase('pt-BR');
}

/** Sem o ")" do fim: um nome cortado que fechou o parêntese ("Alto-falantes (Realtek)") ainda é o começo de
 *  "Alto-falantes (Realtek(R) Audio)". */
function semFecho(texto: string): string {
  return texto.endsWith(')') ? texto.slice(0, -1) : texto;
}

/**
 * O deviceId da saída cujo rótulo é o nome do motor (`audio.altoFalante`): primeiro igual (sem caixa e sem os
 * espaços das pontas), depois um que começa com o outro (o motor corta os nomes longos). "" (o padrão) sem nome,
 * sem rótulos ou sem nenhuma que case.
 */
export function matchOutputDevice(nome: string, saidas: OutputDevice[]): string {
  const alvo = normalizar(nome);
  if (!alvo) return '';
  const comRotulo = saidas.map((s) => ({ id: s.deviceId, rotulo: normalizar(s.label) })).filter((s) => s.rotulo !== '');
  const igual = comRotulo.find((s) => s.rotulo === alvo);
  if (igual) return igual.id;
  const comeca = (longo: string, curto: string) => longo.startsWith(curto) || longo.startsWith(semFecho(curto));
  const prefixo = comRotulo.find((s) => comeca(s.rotulo, alvo) || comeca(alvo, s.rotulo));
  return prefixo?.id ?? '';
}

async function enumerateOutputs(): Promise<OutputDevice[]> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return [];
  const lista = await md.enumerateDevices();
  return lista.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
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
  const listOutputs = options.listOutputs ?? enumerateOutputs;
  const clock: RingClock = options.clock ?? {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };

  // sinkId: a saída em que o toque de agora está ("" = o padrão). As mesmas saídas de novo (o efeito do estado que
  // chega depois de o toque começar) não mexem nele.
  let current: { tipo: RingKind; ctx: RingAudioContext; osc: OscillatorNode; timer: number; sinkId: string } | null = null;
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

  /** O deviceId da saída do toque ("" = o padrão). Nunca falha: qualquer erro dá o padrão. */
  const saidaDo = async (tipo: RingKind, saidas: RingOutputs): Promise<string> => {
    if (tipo !== 'espera') return saidas.toque;
    if (!saidas.altoFalante) return '';
    try {
      return matchOutputDevice(saidas.altoFalante, await listOutputs());
    } catch {
      return '';
    }
  };

  const play = (tipo: RingKind, saidas: RingOutputs) => {
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
      const sinkId = await saidaDo(tipo, saidas);
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
      current = { tipo, ctx, osc, timer: 0, sinkId };
      tocar();
    })();
  };

  return {
    play,
    stop,
    setOutputs(saidas) {
      const atual = current;
      if (!atual) return;
      void (async () => {
        const sinkId = await saidaDo(atual.tipo, saidas);
        // O toque trocou ou parou enquanto a lista das saídas vinha: nada a fazer neste. A mesma saída: nada também.
        if (current !== atual || atual.sinkId === sinkId) return;
        atual.sinkId = sinkId;
        await trocarSaida(atual.ctx, sinkId, true);
      })();
    },
  };
}
