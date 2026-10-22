// A escolha da saída do bipe de espera: o alto-falante da ligação (o nome do motor) casado com o rótulo das
// saídas do WebView2 (enumerateDevices). Função pura: roda no Node, sem página.
// (rc.3) O bipe do fim da ligação (`ring fim`): 425 Hz por 0,25 s, duas vezes com 0,15 s de intervalo, no alto-falante
// da ligação, uma vez, sem mexer no toque de agora; e a chave "Bipe quando a ligação cai ou termina" das Configurações.
import { test, expect } from '@playwright/test';
import { createRinger, matchOutputDevice } from '../src/ring';
import { abrir, audio, audioFalso, empurrar, esperarComando, mudarEstado, saidasFalsas, semViolacoesSerias, toques } from './helpers';

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
function contextoGravado() {
  const rec = {
    sinks: [] as string[],
    oscillators: [] as Array<{ frequency: number; started: boolean; stopped: boolean }>,
    gains: [] as Array<[string, number, number]>,
    closed: false,
  };
  const ctx = {
    currentTime: 10,
    destination: {} as AudioNode,
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
    createGain: () =>
      ({
        gain: {
          value: 0,
          setValueAtTime(v: number, t: number) {
            rec.gains.push(['set', v, t - 10]);
          },
          linearRampToValueAtTime(v: number, t: number) {
            rec.gains.push(['ramp', v, t - 10]);
          },
        },
        connect() {},
        disconnect() {},
      }) as unknown as GainNode,
    async setSinkId(id: string) {
      rec.sinks.push(id);
    },
    resume: async () => {},
    close: async () => {
      rec.closed = true;
    },
  };
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
