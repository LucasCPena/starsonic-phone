// O desenho de um quadro (src/video/desenho.ts): a imagem inteira e sem distorção no meio da área (o encaixar) e a
// conversão BT.601 de faixa limitada, a mesma do shader e do canvas 2D. Roda no Node, sem a página.
import { expect, test } from '@playwright/test';
import { encaixar, i420ParaRgb } from '../../src/video/desenho';

test('encaixar fits without distortion and centers', () => {
  expect(encaixar(640, 480, 356, 300)).toEqual({ x: 0, y: 17, largura: 356, altura: 267 });
  expect(encaixar(1280, 720, 308, 195)).toEqual({ x: 0, y: 11, largura: 308, altura: 173 });
  expect(encaixar(640, 480, 308, 195)).toEqual({ x: 24, y: 0, largura: 260, altura: 195 });
  expect(encaixar(640, 480, 640, 480)).toEqual({ x: 0, y: 0, largura: 640, altura: 480 });
});

test('i420ParaRgb uses BT.601 limited range', () => {
  expect(i420ParaRgb(235, 128, 128)).toEqual([255, 255, 255]);
  expect(i420ParaRgb(16, 128, 128)).toEqual([0, 0, 0]);
  expect(i420ParaRgb(82, 90, 240)).toEqual([255, 1, 0]);
});
