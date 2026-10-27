// A escolha da saída do bipe de espera: o alto-falante da ligação (o nome do motor) casado com o rótulo das
// saídas do WebView2 (enumerateDevices). Função pura: roda no Node, sem página.
// (rc.3) O bipe do fim da ligação (`ring fim`): 425 Hz por 0,25 s, duas vezes com 0,15 s de intervalo, no alto-falante
// da ligação, uma vez, sem mexer no toque de agora; e a chave "Bipe quando a ligação cai ou termina" das Configurações.
// (rc.4) O toque da recebida (`ring completo`) é o do MicroSIP (`assets/toque.wav`), em loop no dispositivo de Toque;
// sem o arquivo (não carrega, não decodifica, ou o contexto não decodifica) volta aos 425 Hz de antes. A espera e o fim
// seguem nos 425 Hz e nunca leem o arquivo.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CADENCES, createRinger, matchOutputDevice } from '../src/ring';
import {
  abrir,
  audio,
  audioFalso,
  empurrar,
  esperarComando,
  estado,
  mudarEstado,
  saidasFalsas,
  semViolacoesSerias,
  toqueIndisponivel,
  toques,
} from './helpers';

const saidas = [
  { deviceId: 'default', label: 'Padrão - Alto-falantes (Realtek(R) Audio)' },
  { deviceId: 'id-realtek', label: 'Alto-falantes (Realtek(R) Audio)' },
  { deviceId: 'id-headset', label: 'Headset USB' },
  { deviceId: 'id-monitor', label: 'LG HDR 4K (Áudio de alta definição Intel)' },
];

test.describe('matchOutputDevice', () => {
  test('an exact label wins', () => {
    expect(matchOutputDevice('Headset USB', saidas)).toBe('id-headset');
    expect(matchOutputDevice('Alto-falantes (Realtek(R) Audio)', saidas)).toBe('id-realtek');
  });

  test('a truncated engine name matches the start of the label', () => {
    expect(matchOutputDevice('LG HDR 4K (Áudio de alta defini', saidas)).toBe('id-monitor');
    // O nome cortado que fechou o parêntese, como "Alto-falantes (Realtek)".
    expect(matchOutputDevice('Alto-falantes (Realtek)', saidas)).toBe('id-realtek');
  });

  test('a truncated label matches the start of the engine name', () => {
    expect(matchOutputDevice('Headset USB (Fone de ouvido estéreo)', saidas)).toBe('id-headset');
  });

  test('case and spaces around do not matter', () => {
    expect(matchOutputDevice('  headset usb ', saidas)).toBe('id-headset');
    expect(matchOutputDevice('HEADSET USB', [{ deviceId: 'x', label: ' Headset USB ' }])).toBe('x');
  });

  test('an exact match is preferred over a prefix match', () => {
    const lista = [
      { deviceId: 'longo', label: 'Headset USB 2' },
      { deviceId: 'exato', label: 'Headset USB' },
    ];
    expect(matchOutputDevice('Headset USB', lista)).toBe('exato');
  });

  test('no match, no name or no labels give the default', () => {
    expect(matchOutputDevice('Fone Bluetooth', saidas)).toBe('');
    expect(matchOutputDevice('', saidas)).toBe('');
    expect(matchOutputDevice('   ', saidas)).toBe('');
    expect(matchOutputDevice('Headset USB', [{ deviceId: 'a', label: '' }, { deviceId: 'b', label: '' }])).toBe('');
    expect(matchOutputDevice('Headset USB', [])).toBe('');
  });
});

// O toque em si (createRinger) com um AudioContext e um relógio de mentira: roda no Node, sem página.
// O estado novo chega à interface antes do efeito que repassa as saídas ao toque (o useEffect do Preact roda
// depois de pintar): um `ring` que chega no meio já toca nas saídas novas, e o efeito atrasado repete as mesmas.
// Saídas que não mudaram não podem mexer no toque (a spec call.spec.ts:446 via `[""]` no lugar de `[]`).
function contextoFalso() {
  const sinks: string[] = [];
  const ctx = {
    currentTime: 0,
    destination: {} as AudioNode,
    createOscillator: () =>
      ({ type: 'sine', frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {} }) as unknown as OscillatorNode,
    createGain: () =>
      ({
        gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      }) as unknown as GainNode,
    async setSinkId(id: string) {
      sinks.push(id);
    },
    resume: async () => {},
    close: async () => {},
  };
  return { ctx, sinks };
}

const relogioParado = { setTimeout: () => 1, clearTimeout: () => {} };
const esperar = () => new Promise((r) => setTimeout(r, 20));

test.describe('createRinger', () => {
  test('the same outputs again do not move the ring that is playing', async () => {
    const { ctx, sinks } = contextoFalso();
    const ringer = createRinger({ createContext: () => ctx, clock: relogioParado, listOutputs: async () => saidas });
    // O bipe no padrão (nenhuma saída com esse nome): nenhum setSinkId.
    ringer.play('espera', { toque: 'saida-toque-1', altoFalante: 'Fone Bluetooth' });
    await esperar();
    ringer.setOutputs({ toque: 'saida-toque-1', altoFalante: 'Fone Bluetooth' });
    await esperar();
    expect(sinks).toEqual([]);
    ringer.stop();
  });

  test('the same Toque again does not repeat the setSinkId of the full ring', async () => {
    const { ctx, sinks } = contextoFalso();
    const ringer = createRinger({ createContext: () => ctx, clock: relogioParado, listOutputs: async () => saidas });
    ringer.play('completo', { toque: 'saida-toque-1', altoFalante: '' });
    await esperar();
    // Só o alto-falante da ligação mudou: o toque completo continua no Toque, sem outro setSinkId.
    ringer.setOutputs({ toque: 'saida-toque-1', altoFalante: 'Headset USB' });
    await esperar();
    expect(sinks).toEqual(['saida-toque-1']);
    ringer.stop();
  });

  test('a new output moves the ring that is playing', async () => {
    const { ctx, sinks } = contextoFalso();
    const ringer = createRinger({ createContext: () => ctx, clock: relogioParado, listOutputs: async () => saidas });
    ringer.play('espera', { toque: '', altoFalante: 'Alto-falantes (Realtek)' });
    await esperar();
    ringer.setOutputs({ toque: '', altoFalante: 'Headset USB' });
    await esperar();
    ringer.setOutputs({ toque: '', altoFalante: '' });
    await esperar();
    expect(sinks).toEqual(['id-realtek', 'id-headset', '']);
    ringer.stop();
  });
});

// Um AudioContext de mentira que grava as saídas, o oscilador, o ganho e o fechamento (o relógio parado em 10 s).
// (rc.4) Ele também decodifica e toca o toque do MicroSIP: `decodes` guarda o tamanho de cada arquivo que chegou ao
// decodeAudioData (que, como o de verdade, esvazia o ArrayBuffer que recebe) e `sources` cada fonte de buffer, com o
// buffer, o loop, o começo, o fim e o nó para onde ela vai. `decodeFalha` faz o decodeAudioData rejeitar (o arquivo que
// não decodifica); `semDecodificar` tira o decodeAudioData e o createBufferSource (um contexto que não toca arquivo).
function contextoGravado(opcoes: { decodeFalha?: boolean; semDecodificar?: boolean } = {}) {
  const destination = {} as AudioNode;
  const rec = {
    destination,
    sinks: [] as string[],
    oscillators: [] as Array<{ frequency: number; started: boolean; stopped: boolean }>,
    sources: [] as Array<{ buffer: unknown; loop: boolean; started: boolean; stopped: boolean; saida: unknown }>,
    decodes: [] as number[],
    gains: [] as Array<[string, number, number]>,
    gainNodes: [] as Array<{ gain: { value: number }; saida: unknown }>,
    closed: false,
  };
  const ctx = {
    currentTime: 10,
    destination,
    createOscillator: () => {
      const o = { frequency: 0, started: false, stopped: false };
      rec.oscillators.push(o);
      return {
        type: 'sine',
        frequency: {
          set value(v: number) {
            o.frequency = v;
          },
          get value() {
            return o.frequency;
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
      } as unknown as OscillatorNode;
    },
    createBufferSource: () => {
      const s = {
        buffer: null as unknown,
        loop: false,
        started: false,
        stopped: false,
        saida: null as unknown,
        connect(alvo: unknown) {
          s.saida = alvo;
        },
        disconnect() {},
        start() {
          s.started = true;
        },
        stop() {
          s.stopped = true;
        },
      };
      rec.sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    },
    async decodeAudioData(dados: ArrayBuffer) {
      rec.decodes.push(dados.byteLength);
      structuredClone(dados, { transfer: [dados] });
      if (opcoes.decodeFalha) throw new DOMException('Unable to decode audio data', 'EncodingError');
      return { duration: 3 } as unknown as AudioBuffer;
    },
    createGain: () => {
      const g = {
        gain: {
          value: 0,
          setValueAtTime(v: number, t: number) {
            rec.gains.push(['set', v, t - 10]);
          },
          linearRampToValueAtTime(v: number, t: number) {
            rec.gains.push(['ramp', v, t - 10]);
          },
        },
        saida: null as unknown,
        connect(alvo: unknown) {
          g.saida = alvo;
        },
        disconnect() {},
      };
      rec.gainNodes.push(g);
      return g as unknown as GainNode;
    },
    async setSinkId(id: string) {
      rec.sinks.push(id);
    },
    resume: async () => {},
    close: async () => {
      rec.closed = true;
    },
  };
  if (opcoes.semDecodificar) {
    delete (ctx as Partial<typeof ctx>).decodeAudioData;
    delete (ctx as Partial<typeof ctx>).createBufferSource;
  }
  return { ctx, rec };
}

test.describe('o bipe do fim da ligação', () => {
  test('fim beeps twice for 0.25 s with 0.15 s between, on the call speaker, once', async () => {
    const contextos: Array<ReturnType<typeof contextoGravado>['rec']> = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const relogio = {
      setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      clearTimeout: () => {},
    };
    const ringer = createRinger({
      createContext: () => {
        const { ctx, rec } = contextoGravado();
        contextos.push(rec);
        return ctx;
      },
      clock: relogio,
      listOutputs: async () => saidas,
    });
    ringer.play('fim', { toque: 'saida-toque-1', altoFalante: 'Headset USB' });
    await esperar();
    expect(contextos).toHaveLength(1);
    const [fim] = contextos;
    // No alto-falante da ligação (o nome do motor casado com o rótulo), nunca no Toque.
    expect(fim.sinks).toEqual(['id-headset']);
    expect(fim.oscillators).toHaveLength(1);
    expect(fim.oscillators[0]).toMatchObject({ frequency: 425, started: true });
    // Dois bipes: sobe em 0 e em 0,4 s, desce em 0,25 e em 0,65 s.
    const t = toques(fim.gains);
    expect(t.liga).toHaveLength(2);
    expect(t.desliga).toHaveLength(2);
    expect(t.liga[0]).toBeCloseTo(0, 1);
    expect(t.desliga[0]).toBeCloseTo(0.25, 1);
    expect(t.liga[1]).toBeCloseTo(0.4, 1);
    expect(t.desliga[1]).toBeCloseTo(0.65, 1);
    // Uma vez só: depois dos dois bipes o contexto fecha, e nada toca de novo.
    expect(fim.closed).toBe(false);
    for (const { fn } of timers.splice(0)) fn();
    expect(fim.closed).toBe(true);
    expect(timers).toEqual([]);
    expect(toques(fim.gains).liga).toHaveLength(2);
  });

  test('fim leaves the ring that is playing alone, and the ring goes on after it', async () => {
    const contextos: Array<ReturnType<typeof contextoGravado>['rec']> = [];
    const ringer = createRinger({
      createContext: () => {
        const { ctx, rec } = contextoGravado();
        contextos.push(rec);
        return ctx;
      },
      clock: { setTimeout: () => 1, clearTimeout: () => {} },
      listOutputs: async () => saidas,
    });
    ringer.play('espera', { toque: '', altoFalante: 'Headset USB' });
    await esperar();
    ringer.play('fim', { toque: '', altoFalante: 'Headset USB' });
    await esperar();
    expect(contextos).toHaveLength(2);
    const [espera] = contextos;
    expect(espera.closed).toBe(false);
    expect(espera.oscillators[0].stopped).toBe(false);
    // O mesmo bipe de espera de novo continua o de agora (nada recomeça por causa do fim).
    ringer.play('espera', { toque: '', altoFalante: 'Headset USB' });
    await esperar();
    expect(contextos).toHaveLength(2);
    ringer.play('parar', { toque: '', altoFalante: '' });
    expect(espera.closed).toBe(true);
  });
});

test.describe('o bipe do fim na página', () => {
  test('the end beep plays on the speaker device', async ({ page }) => {
    await audioFalso(page);
    await saidasFalsas(page, [
      { deviceId: 'default', label: 'Padrão - Alto-falantes (Realtek(R) Audio)' },
      { deviceId: 'id-realtek', label: 'Alto-falantes (Realtek(R) Audio)' },
      { deviceId: 'id-headset', label: 'Headset USB' },
    ]);
    await abrir(page, 'principal');
    // O alto-falante da ligação é o Headset USB; o Toque é outra saída.
    await mudarEstado(page, (s) => ({ ...s, audio: { ...s.audio, toque: 'saida-toque-1', altoFalante: 'Headset USB' } }));
    await empurrar(page, { v: 1, type: 'ring', tipo: 'fim' });
    await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);
    const [ctx] = await audio(page);
    expect(ctx.sinks).toEqual(['id-headset']);
    expect(ctx.oscillators[0]).toMatchObject({ type: 'sine', frequency: 425 });
    expect(ctx.resumed).toBe(true);
    const t = toques(ctx.gains[0]);
    expect(t.liga).toHaveLength(2);
    expect(t.desliga).toHaveLength(2);
    expect(t.desliga[0] - t.liga[0]).toBeCloseTo(0.25, 1);
    expect(t.liga[1] - t.desliga[0]).toBeCloseTo(0.15, 1);
    expect(t.desliga[1] - t.liga[1]).toBeCloseTo(0.25, 1);
    // Toca uma vez e fecha sozinho.
    await expect.poll(async () => (await audio(page))[0].closed, { timeout: 5000 }).toBe(true);
    expect(await audio(page)).toHaveLength(1);
  });

  test('the notice window never plays the end beep', async ({ page }) => {
    await audioFalso(page);
    await page.setViewportSize({ width: 380, height: 168 });
    await abrir(page, 'aviso', 'aviso.html');
    await empurrar(page, { v: 1, type: 'ring', tipo: 'fim' });
    await page.waitForTimeout(300);
    expect(await audio(page)).toEqual([]);
  });
});

// (rc.4) O toque do MicroSIP na recebida. O `loadToque` entrega os bytes do arquivo (aqui, os 48028 bytes do
// `ringtone.wav`, sem o conteúdo: o decodeAudioData é de mentira) e cada toque nasce num contexto gravado novo.
const TAMANHO_DO_TOQUE = 48028;
const bytesDoToque = async () => new ArrayBuffer(TAMANHO_DO_TOQUE);
const naSaidaDeToque = { toque: 'saida-toque-1', altoFalante: '' };

type Gravacao = ReturnType<typeof contextoGravado>['rec'];

/** Um ringer sobre contextos gravados (um por toque, na ordem em que nascem) e um relógio que só guarda os temporizadores. */
function ringerComToque(loadToque: () => Promise<ArrayBuffer | null>, opcoes: (n: number) => Parameters<typeof contextoGravado>[0] = () => ({})) {
  const contextos: Gravacao[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const ringer = createRinger({
    createContext: () => {
      const { ctx, rec } = contextoGravado(opcoes(contextos.length));
      contextos.push(rec);
      return ctx;
    },
    clock: { setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {} },
    listOutputs: async () => saidas,
    loadToque,
  });
  return { ringer, contextos, timers };
}

/** A recebida de antes: o oscilador de 425 Hz com a cadência de `CADENCES.completo` (1 s ligado, de 5 em 5 s), no Toque. */
function conferirOs425Hz(rec: Gravacao, timers: Array<{ fn: () => void; ms: number }>) {
  expect(rec.sinks).toEqual(['saida-toque-1']);
  expect(rec.sources).toEqual([]);
  expect(rec.oscillators).toHaveLength(1);
  expect(rec.oscillators[0]).toMatchObject({ frequency: 425, started: true, stopped: false });
  const { on, periodMs } = CADENCES.completo;
  const t = toques(rec.gains);
  expect(t.liga).toHaveLength(1);
  expect(t.desliga[0] - t.liga[0]).toBeCloseTo(on, 1);
  // O próximo toque, um período depois.
  expect(timers.map((x) => x.ms)).toEqual([periodMs]);
  timers.splice(0)[0].fn();
  expect(toques(rec.gains).liga).toHaveLength(2);
  expect(timers.map((x) => x.ms)).toEqual([periodMs]);
}

test.describe('o toque do MicroSIP na recebida', () => {
  test('the full ring plays the MicroSIP ringtone in a loop on the Toque device', async () => {
    const { ringer, contextos } = ringerComToque(bytesDoToque);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(contextos).toHaveLength(1);
    const [rec] = contextos;
    // No dispositivo de Toque (nunca no alto-falante da ligação), com o arquivo decodificado.
    expect(rec.sinks).toEqual(['saida-toque-1']);
    expect(rec.decodes).toEqual([TAMANHO_DO_TOQUE]);
    // Uma fonte de buffer em loop que já começou, com o toque decodificado, e nenhum oscilador ligado.
    expect(rec.sources).toHaveLength(1);
    expect(rec.sources[0]).toMatchObject({ loop: true, started: true, stopped: false });
    expect(rec.sources[0].buffer).toMatchObject({ duration: 3 });
    expect(rec.oscillators.filter((o) => o.started)).toEqual([]);
    // Como foi gravado (ganho 1, sem rampa) e chega à saída: o toque nunca fica mudo.
    expect(rec.gainNodes.map((g) => g.gain.value)).toEqual([1]);
    expect(rec.gains).toEqual([]);
    expect(rec.sources[0].saida).toBe(rec.gainNodes[0]);
    expect(rec.gainNodes[0].saida).toBe(rec.destination);
    // O parar encerra a fonte e fecha o contexto.
    ringer.stop();
    expect(rec.sources[0].stopped).toBe(true);
    expect(rec.closed).toBe(true);
  });

  test('without the ringtone file the full ring falls back to 425 Hz', async () => {
    const { ringer, contextos, timers } = ringerComToque(async () => null);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(contextos).toHaveLength(1);
    expect(contextos[0].decodes).toEqual([]);
    conferirOs425Hz(contextos[0], timers);
    ringer.stop();
  });

  test('when the ringtone does not decode the full ring falls back to 425 Hz', async () => {
    const { ringer, contextos, timers } = ringerComToque(bytesDoToque, () => ({ decodeFalha: true }));
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(contextos).toHaveLength(1);
    expect(contextos[0].decodes).toEqual([TAMANHO_DO_TOQUE]);
    conferirOs425Hz(contextos[0], timers);
    ringer.stop();
  });

  test('a context that cannot decode plays the full ring at 425 Hz and never reads the file', async () => {
    let leituras = 0;
    const { ringer, contextos, timers } = ringerComToque(
      async () => {
        leituras++;
        return new ArrayBuffer(TAMANHO_DO_TOQUE);
      },
      () => ({ semDecodificar: true }),
    );
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(leituras).toBe(0);
    conferirOs425Hz(contextos[0], timers);
    ringer.stop();
  });

  test('the ringtone file is loaded once', async () => {
    let leituras = 0;
    const { ringer, contextos } = ringerComToque(async () => {
      leituras++;
      return new ArrayBuffer(TAMANHO_DO_TOQUE);
    });
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    ringer.play('parar', naSaidaDeToque);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(leituras).toBe(1);
    expect(contextos).toHaveLength(2);
    // Decodificado uma vez só (no primeiro contexto): o segundo toca o mesmo AudioBuffer.
    expect(contextos.map((c) => c.decodes)).toEqual([[TAMANHO_DO_TOQUE], []]);
    expect(contextos[0].closed).toBe(true);
    expect(contextos[1].sources[0]).toMatchObject({ loop: true, started: true, stopped: false });
    expect(contextos[0].sources[0].buffer).toMatchObject({ duration: 3 });
    expect(contextos[1].sources[0].buffer).toBe(contextos[0].sources[0].buffer);
    ringer.stop();
  });

  test('a ringtone that did not decode is decoded again on the next full ring', async () => {
    // O decode que falha pode ser o de um contexto que fechou no meio (o parar chegou cedo): o toque seguinte não fica
    // nos 425 Hz por causa dele, e os bytes continuam inteiros (o decodeAudioData esvazia o ArrayBuffer que recebe).
    let leituras = 0;
    const { ringer, contextos } = ringerComToque(
      async () => {
        leituras++;
        return new ArrayBuffer(TAMANHO_DO_TOQUE);
      },
      (n) => ({ decodeFalha: n === 0 }),
    );
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(contextos[0].sources).toEqual([]);
    expect(contextos[0].oscillators.filter((o) => o.started)).toHaveLength(1);
    ringer.play('parar', naSaidaDeToque);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(leituras).toBe(1);
    expect(contextos[1].decodes).toEqual([TAMANHO_DO_TOQUE]);
    expect(contextos[1].sources[0]).toMatchObject({ loop: true, started: true });
    expect(contextos[1].oscillators).toEqual([]);
    ringer.stop();
  });

  test('a full ring stopped while the file loads never starts', async () => {
    let chegou!: (bytes: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>((resolve) => (chegou = resolve));
    const { ringer, contextos } = ringerComToque(() => bytes);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    expect(contextos[0].sources).toEqual([]);
    // O parar chega antes do arquivo: nada nasce quando ele chega, e o contexto fecha.
    ringer.play('parar', naSaidaDeToque);
    chegou(new ArrayBuffer(TAMANHO_DO_TOQUE));
    await esperar();
    expect(contextos[0].sources).toEqual([]);
    expect(contextos[0].oscillators).toEqual([]);
    expect(contextos[0].closed).toBe(true);
  });

  test('a new Toque device moves the ringtone that is playing', async () => {
    const { ringer, contextos } = ringerComToque(bytesDoToque);
    ringer.play('completo', naSaidaDeToque);
    await esperar();
    ringer.setOutputs({ toque: 'saida-toque-2', altoFalante: '' });
    await esperar();
    ringer.setOutputs({ toque: '', altoFalante: '' });
    await esperar();
    // A mesma fonte segue tocando, sem recomeçar; só a saída muda.
    expect(contextos[0].sinks).toEqual(['saida-toque-1', 'saida-toque-2', '']);
    expect(contextos[0].sources).toHaveLength(1);
    expect(contextos[0].sources[0]).toMatchObject({ started: true, stopped: false });
    ringer.stop();
  });

  test('espera and fim never load the ringtone', async () => {
    let leituras = 0;
    const { ringer, contextos } = ringerComToque(async () => {
      leituras++;
      return new ArrayBuffer(TAMANHO_DO_TOQUE);
    });
    ringer.play('espera', { toque: 'saida-toque-1', altoFalante: 'Headset USB' });
    await esperar();
    ringer.play('parar', naSaidaDeToque);
    ringer.play('fim', { toque: 'saida-toque-1', altoFalante: 'Headset USB' });
    await esperar();
    expect(leituras).toBe(0);
    // Os dois bipes: o oscilador de 425 Hz no alto-falante da ligação, nunca uma fonte de buffer.
    expect(contextos).toHaveLength(2);
    for (const rec of contextos) {
      expect(rec.decodes).toEqual([]);
      expect(rec.sources).toEqual([]);
      expect(rec.sinks).toEqual(['id-headset']);
      expect(rec.oscillators).toHaveLength(1);
      expect(rec.oscillators[0]).toMatchObject({ frequency: 425, started: true });
    }
  });

  test('dist/assets/toque.wav is the MicroSIP ringtone', () => {
    const sha256 = (arquivo: string) => createHash('sha256').update(readFileSync(arquivo)).digest('hex');
    const copia = fileURLToPath(new URL('../dist/assets/toque.wav', import.meta.url));
    const original = fileURLToPath(new URL('../../../microsip-dist/ringtone.wav', import.meta.url));
    expect(sha256(copia)).toBe(sha256(original));
  });
});

test.describe('o toque do MicroSIP na página', () => {
  test('the page loops assets/toque.wav on the full ring', async ({ page }) => {
    await audioFalso(page);
    await abrir(page, 'principal');
    await mudarEstado(page, (s) => ({ ...s, audio: { ...s.audio, toque: 'saida-toque-1' } }));
    await expect.poll(async () => (await estado(page)).audio.toque).toBe('saida-toque-1');
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await expect.poll(async () => (await audio(page))[0]?.sources[0]?.started).toBe(true);
    const [ctx] = await audio(page);
    // O arquivo de verdade (assets/toque.wav, lido do dist) chegou ao decodeAudioData e toca em loop no Toque.
    expect(ctx.decodes).toEqual([TAMANHO_DO_TOQUE]);
    expect(ctx.sources).toEqual([{ loop: true, started: true, stopped: false }]);
    expect(ctx.oscillators).toEqual([]);
    expect(ctx.sinks).toEqual(['saida-toque-1']);
    expect(ctx.resumed).toBe(true);
    await empurrar(page, { v: 1, type: 'ring', tipo: 'parar' });
    await expect.poll(async () => (await audio(page))[0].closed).toBe(true);
    expect((await audio(page))[0].sources[0].stopped).toBe(true);
    // O arquivo é decodificado uma vez: o toque seguinte usa o mesmo buffer.
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await expect.poll(async () => (await audio(page))[1]?.sources[0]?.started).toBe(true);
    expect((await audio(page))[1].decodes).toEqual([]);
    expect((await audio(page))[1].sinks).toEqual(['saida-toque-1']);
  });

  // O arquivo que não vem: a conexão cai, ou o servidor responde com um erro (o texto do erro nunca vai ao decodeAudioData).
  for (const [caso, status] of [
    ['does not load', undefined],
    ['answers with an error', 404],
  ] as const) {
    test(`the page falls back to 425 Hz when assets/toque.wav ${caso}`, async ({ page }) => {
      await audioFalso(page);
      await toqueIndisponivel(page, status);
      await abrir(page, 'principal');
      await mudarEstado(page, (s) => ({ ...s, audio: { ...s.audio, toque: 'saida-toque-1' } }));
      await expect.poll(async () => (await estado(page)).audio.toque).toBe('saida-toque-1');
      await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
      await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);
      const [ctx] = await audio(page);
      expect(ctx.oscillators[0]).toMatchObject({ type: 'sine', frequency: 425 });
      expect(ctx.decodes).toEqual([]);
      expect(ctx.sources).toEqual([]);
      expect(ctx.sinks).toEqual(['saida-toque-1']);
    });
  }

  test('the page falls back to 425 Hz when assets/toque.wav does not decode', async ({ page }) => {
    await audioFalso(page);
    await abrir(page, 'principal');
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__toqueDecodeFalha = true));
    await empurrar(page, { v: 1, type: 'ring', tipo: 'completo' });
    await expect.poll(async () => (await audio(page))[0]?.oscillators[0]?.started).toBe(true);
    const [ctx] = await audio(page);
    expect(ctx.oscillators[0]).toMatchObject({ type: 'sine', frequency: 425 });
    expect(ctx.decodes).toEqual([TAMANHO_DO_TOQUE]);
    expect(ctx.sources).toEqual([]);
  });
});

for (const tema of ['light', 'dark'] as const) {
  test.describe(`a chave do bipe (${tema})`, () => {
    test.use({ colorScheme: tema });

    test('the bipeFim switch sends setSetting', async ({ page }) => {
      await abrir(page, 'configuracoes');
      const bipe = page.getByRole('switch', { name: 'Bipe quando a ligação cai ou termina' });
      await expect(bipe).toHaveAttribute('aria-checked', 'true');
      await expect(bipe).toHaveAccessibleDescription('Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai.');
      // A primeira linha de Ligações, acima do Atender automaticamente.
      const b = (await bipe.boundingBox())!;
      const auto = (await page.getByRole('switch', { name: 'Atender automaticamente' }).boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(auto.y);
      await semViolacoesSerias(page);
      await bipe.click();
      await esperarComando(page, { cmd: 'setSetting', chave: 'bipeFim', valor: false });
      await expect(bipe).toHaveAttribute('aria-checked', 'false');
      await bipe.click();
      await esperarComando(page, { cmd: 'setSetting', chave: 'bipeFim', valor: true });
      await expect(bipe).toHaveAttribute('aria-checked', 'true');
    });
  });
}
