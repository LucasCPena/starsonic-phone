// A escolha da saída do bipe de espera: o alto-falante da ligação (o nome do motor) casado com o rótulo das
// saídas do WebView2 (enumerateDevices). Função pura: roda no Node, sem página.
import { test, expect } from '@playwright/test';
import { createRinger, matchOutputDevice } from '../src/ring';

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
