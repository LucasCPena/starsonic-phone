// O toque, por WebAudio na interface:
// - completo (rc.4): o toque do MicroSIP (uma recebida sem outra ligação), o `assets/toque.wav`: a cópia do
//   `ringtone.wav` do MicroSIP, 3 s, 8 kHz, mono. A interface lê o arquivo e o decodifica uma vez, e ele toca em loop
//   (AudioBufferSourceNode) até o `parar`; o arquivo já traz o "trrim-trrim" e o silêncio depois, uma volta a cada 3 s.
//   Se o arquivo não carregar, não decodificar, ou o contexto não decodificar, a recebida cai nos 425 Hz de antes
//   (gerados, 1 s ligado e 4 s desligado): ela nunca fica muda. Os 425 Hz eram o "chamando" das centrais do Brasil, e a
//   recebida parecia a pessoa ligando (spec da rc.4, seção 3);
// - espera: um bipe de 425 Hz de 0,2 s a cada 3 s (a segunda ligação, sem cobrir a conversa);
// - parar: encerra na hora;
// - fim (rc.3): o bipe do fim da ligação, 0,25 s duas vezes com 0,15 s de intervalo, uma vez só; ele não mexe no
//   toque de agora (toca num contexto dele, que fecha sozinho depois).
// A saída (AudioContext.setSinkId):
// - completo: o dispositivo de Toque das Configurações (`audio.toque`, um deviceId da própria interface);
// - espera e fim: o alto-falante da ligação (a pessoa está, ou estava, falando e ouve por ele). O `audio.altoFalante`
//   é o nome do motor, não um deviceId: a saída é a do `enumerateDevices` cujo rótulo é esse nome (ou começa com ele,
//   ou ele com o rótulo: o motor corta os nomes longos) — `matchOutputDevice`.
// Sem o id, sem nome, sem rótulos (sem a permissão de mídia), sem saída que case, sem o setSinkId ou com erro nele,
// toca no padrão: nunca fica mudo. Só a janela principal toca (o aviso do canto recebe as mesmas mensagens e fica
// quieto, para o toque não sair em dobro).
// O relógio, o AudioContext, a lista das saídas e a leitura do arquivo do toque são injetáveis (os testes usam um
// relógio falso e um contexto que grava o que acontece).
import type { RingKind } from './state';

/** O pedaço do AudioContext que o toque usa. */
export interface RingAudioContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  /** O toque do MicroSIP (rc.4) precisa destes dois; sem eles a recebida toca os 425 Hz. */
  createBufferSource?(): AudioBufferSourceNode;
  decodeAudioData?(data: ArrayBuffer): Promise<AudioBuffer>;
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
  /** Os bytes do toque do MicroSIP (o padrão: `assets/toque.wav`, dentro do app); `null` em qualquer falha. */
  loadToque?: () => Promise<ArrayBuffer | null>;
}

export interface Ringer {
  /** O toque pedido pelo C++ (`completo`, `espera`, `parar`, `fim`), na saída que as escolhas de som pedem. */
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

/** Os bytes de `assets/toque.wav`, ao lado da página. `null` em qualquer falha (sem fetch, sem o arquivo, resposta de erro). */
async function lerToque(): Promise<ArrayBuffer | null> {
  try {
    const resposta = await fetch('assets/toque.wav');
    return resposta.ok ? await resposta.arrayBuffer() : null;
  } catch {
    return null;
  }
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

export const CADENCES: Record<Exclude<RingKind, 'parar' | 'fim'>, Cadence> = {
  // Desde a rc.4 o completo só toca assim quando o toque do MicroSIP não toca (o arquivo não veio).
  completo: { on: 1, periodMs: 5000, level: 0.3 },
  espera: { on: 0.2, periodMs: 3000, level: 0.18 },
};

/** O bipe do fim da ligação (spec 5 da rc.3): 0,25 s ligado, duas vezes, com 0,15 s entre os dois. */
export const BIPE_FIM = { on: 0.25, gap: 0.15, vezes: 2, level: 0.18 };

/** A subida e a descida de cada toque (evita o estalo no começo e no fim). */
const RAMPA = 0.01;

export function createRinger(options: RingOptions = {}): Ringer {
  const createContext = options.createContext ?? (() => new AudioContext() as unknown as RingAudioContext);
  const listOutputs = options.listOutputs ?? enumerateOutputs;
  const loadToque = options.loadToque ?? lerToque;
  const clock: RingClock = options.clock ?? {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };

  // fonte: o nó que toca (a fonte de buffer do toque do MicroSIP, ou o oscilador de 425 Hz).
  // sinkId: a saída em que o toque de agora está ("" = o padrão). As mesmas saídas de novo (o efeito do estado que
  // chega depois de o toque começar) não mexem nele.
  let current: { tipo: RingKind; ctx: RingAudioContext; fonte: AudioScheduledSourceNode; timer: number; sinkId: string } | null = null;
  // Cada pedido ganha uma vez: um setSinkId que demora não liga um toque que já foi trocado ou parado.
  let vez = 0;
  // O toque do MicroSIP: os bytes do arquivo são lidos uma vez por ringer (fica a promessa) e o AudioBuffer é decodificado
  // uma vez, e serve para os contextos seguintes. Um decode que falha não fica guardado: o contexto pode ter fechado no
  // meio (o `parar` chegou cedo), e o próximo toque tenta de novo.
  let bytesDoToque: Promise<ArrayBuffer | null> | null = null;
  let toqueDecodificado: AudioBuffer | null = null;

  const stop = () => {
    vez++;
    const atual = current;
    current = null;
    if (!atual) return;
    clock.clearTimeout(atual.timer);
    try {
      atual.fonte.stop();
    } catch {
      // Já parado.
    }
    atual.fonte.disconnect();
    void atual.ctx.close().catch(() => {});
  };

  /**
   * O toque do MicroSIP decodificado. `null` quando a recebida deve cair nos 425 Hz: o contexto não decodifica, o
   * arquivo não carregou ou não decodificou. Nunca falha.
   */
  const bufferDoToque = async (ctx: RingAudioContext): Promise<AudioBuffer | null> => {
    if (toqueDecodificado) return toqueDecodificado;
    if (typeof ctx.decodeAudioData !== 'function' || typeof ctx.createBufferSource !== 'function') return null;
    try {
      bytesDoToque ??= loadToque();
      const bytes = await bytesDoToque;
      if (!bytes) return null;
      // O decodeAudioData esvazia o ArrayBuffer que recebe: a cópia deixa os bytes inteiros para outra tentativa.
      toqueDecodificado = await ctx.decodeAudioData(bytes.slice(0));
      return toqueDecodificado;
    } catch {
      return null;
    }
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
    if (tipo === 'completo') return saidas.toque;
    if (!saidas.altoFalante) return '';
    try {
      return matchOutputDevice(saidas.altoFalante, await listOutputs());
    } catch {
      return '';
    }
  };

  /** O bipe do fim: um contexto só dele (o toque de agora continua como está), que fecha depois dos dois bipes. */
  const bipeDoFim = (saidas: RingOutputs) => {
    let ctx: RingAudioContext;
    try {
      ctx = createContext();
    } catch {
      return; // Sem WebAudio: nada a tocar.
    }
    void (async () => {
      await trocarSaida(ctx, await saidaDo('fim', saidas));
      void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = RING_HZ;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime;
      osc.start();
      for (let i = 0; i < BIPE_FIM.vezes; i++) {
        const t = t0 + i * (BIPE_FIM.on + BIPE_FIM.gap);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(BIPE_FIM.level, t + RAMPA);
        gain.gain.setValueAtTime(BIPE_FIM.level, t + BIPE_FIM.on - RAMPA);
        gain.gain.linearRampToValueAtTime(0, t + BIPE_FIM.on);
      }
      const duracao = BIPE_FIM.vezes * BIPE_FIM.on + (BIPE_FIM.vezes - 1) * BIPE_FIM.gap;
      osc.stop(t0 + duracao + 0.05);
      clock.setTimeout(
        () => {
          osc.disconnect();
          void ctx.close().catch(() => {});
        },
        Math.ceil((duracao + 0.2) * 1000),
      );
    })();
  };

  const play = (tipo: RingKind, saidas: RingOutputs) => {
    if (tipo === 'fim') {
      bipeDoFim(saidas);
      return;
    }
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
    /** Este toque foi trocado ou parado enquanto a saída (ou o arquivo) vinha: não liga, e o contexto fecha. */
    const cancelado = () => {
      if (minhaVez === vez) return false;
      void ctx.close().catch(() => {});
      return true;
    };
    void (async () => {
      const sinkId = await saidaDo(tipo, saidas);
      await trocarSaida(ctx, sinkId);
      if (cancelado()) return;
      // Só o completo toca o toque do MicroSIP (a espera é o bipe); sem ele, o oscilador de 425 Hz de antes.
      const buffer = tipo === 'completo' ? await bufferDoToque(ctx) : null;
      if (cancelado()) return;
      void ctx.resume().catch(() => {});
      const fonteDoToque = buffer ? ctx.createBufferSource?.() : undefined;
      if (buffer && fonteDoToque) {
        // Em loop até o `parar`, como foi gravado (ganho 1): o "trrim-trrim" e o silêncio depois são do arquivo.
        const ganho = ctx.createGain();
        fonteDoToque.buffer = buffer;
        fonteDoToque.loop = true;
        ganho.gain.value = 1;
        fonteDoToque.connect(ganho);
        ganho.connect(ctx.destination);
        fonteDoToque.start();
        current = { tipo, ctx, fonte: fonteDoToque, timer: 0, sinkId };
        return;
      }
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
      current = { tipo, ctx, fonte: osc, timer: 0, sinkId };
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
