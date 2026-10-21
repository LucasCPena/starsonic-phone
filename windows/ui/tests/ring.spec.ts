// A escolha da saída do bipe de espera: o alto-falante da ligação (o nome do motor) casado com o rótulo das
// saídas do WebView2 (enumerateDevices). Função pura: roda no Node, sem página.
import { test, expect } from '@playwright/test';
import { matchOutputDevice } from '../src/ring';

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
