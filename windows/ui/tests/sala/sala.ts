// O que as specs da sala usam contra a ponte falsa: as cores do mosaico (e o RGB em que o desenho as põe), o mosaico de
// quem montou gravado na memória do `remoto` (o escritor do executável, pelo `__fake.quadro`) e o quadro e a imagem de
// cada convidado. As specs usam também o `quadro`, o `corNoMeio`, o `corNoPonto`, o `perto`, o `VERMELHO`, o `BRANCO` e o
// `FUNDO` do tests/video/video.ts: o fundo do mosaico vira [4, 5, 14], a 1 do `FUNDO` (o #04060e).
import { expect, type Page } from '@playwright/test';
import type { QuadroDaSala, SalaDaLigacao } from '../../src/state';
import { i420ParaRgb } from '../../src/video/desenho';
import { estado } from '../helpers';
import { BRANCO, VERMELHO } from '../video/video';

/** Vira [0, 255, 1]. */
export const VERDE: [number, number, number] = [145, 54, 34];
/** Vira [0, 0, 255]. */
export const AZUL: [number, number, number] = [41, 240, 110];
/** Vira [255, 255, 0]. */
export const AMARELO: [number, number, number] = [210, 16, 146];

/** O RGB de cada cor do video.ts e daqui (o i420ParaRgb). */
export const RGB: Record<'VERMELHO' | 'BRANCO' | 'VERDE' | 'AZUL' | 'AMARELO', [number, number, number]> = {
  VERMELHO: i420ParaRgb(...VERMELHO),
  BRANCO: i420ParaRgb(...BRANCO),
  VERDE: i420ParaRgb(...VERDE),
  AZUL: i420ParaRgb(...AZUL),
  AMARELO: i420ParaRgb(...AMARELO),
};

/** O fundo do mosaico do núcleo (o kMosaicBackground do RoomMosaic.h): o #04060e em I420. */
const FUNDO_DO_MOSAICO: [number, number, number] = [21, 132, 127];

/** A cor de cada convidado no `mosaicoDaSala`, pela posição dele na lista. */
const CORES_DOS_CONVIDADOS = [BRANCO, VERDE, AZUL, AMARELO, VERMELHO];

interface Escritor {
  quadro(vista: 'remoto', largura: number, altura: number, y: Uint8Array, u: Uint8Array, v: Uint8Array): boolean;
}

/**
 * Grava no `remoto` um mosaico de `largura`×`altura`: o fundo do núcleo e cada quadro inteiro numa cor (Y, U e V). Espera
 * a vista `remoto` com o `data-memoria` (a memória já chegou à página), monta os planos dentro da página e grava pelo
 * `__fake.quadro`.
 */
export async function mosaico(
  page: Page,
  quadros: Array<{ quadro: QuadroDaSala; cor: [number, number, number] }>,
  largura = 1280,
  altura = 720,
): Promise<void> {
  await expect(page.locator('[data-vista="remoto"][data-memoria]').first(), 'a vista remoto com a memória').toBeAttached();
  const gravou = await page.evaluate(
    ({ quadros, largura, altura, fundo }) => {
      const passoDoCroma = (largura + 1) >> 1;
      const y = new Uint8Array(largura * altura).fill(fundo[0]);
      const u = new Uint8Array(passoDoCroma * ((altura + 1) >> 1)).fill(fundo[1]);
      const v = new Uint8Array(u.length).fill(fundo[2]);
      /** Pinta as linhas de y0 a y1 (sem a y1), das colunas de x0 a x1 (sem a x1), de um plano com esse passo. */
      const pintar = (plano: Uint8Array, passo: number, x0: number, y0: number, x1: number, y1: number, valor: number) => {
        for (let linha = y0; linha < y1; linha++) plano.fill(valor, linha * passo + x0, linha * passo + x1);
      };
      for (const { quadro, cor } of quadros) {
        const x0 = Math.round(quadro.x * largura);
        const y0 = Math.round(quadro.y * altura);
        const x1 = Math.round((quadro.x + quadro.largura) * largura);
        const y1 = Math.round((quadro.y + quadro.altura) * altura);
        pintar(y, largura, x0, y0, x1, y1, cor[0]);
        pintar(u, passoDoCroma, x0 >> 1, y0 >> 1, (x1 + 1) >> 1, (y1 + 1) >> 1, cor[1]);
        pintar(v, passoDoCroma, x0 >> 1, y0 >> 1, (x1 + 1) >> 1, (y1 + 1) >> 1, cor[2]);
      }
      return (window as unknown as { __fake: Escritor }).__fake.quadro('remoto', largura, altura, y, u, v);
    },
    { quadros, largura, altura, fundo: FUNDO_DO_MOSAICO },
  );
  expect(gravou, 'a ponte falsa sem a memória do remoto').toBe(true);
}

/**
 * O mosaico da sala de agora (o estado da ponte falsa): os convidados `naSala` com `imagem` nas cores BRANCO, VERDE, AZUL,
 * AMARELO e VERMELHO, pela posição na lista (o primeiro em BRANCO); os outros com o fundo.
 */
export async function mosaicoDaSala(page: Page): Promise<void> {
  const sala: SalaDaLigacao | null | undefined = (await estado(page)).ligacao?.sala;
  expect(sala, 'a sala no estado da ponte falsa').toBeTruthy();
  await mosaico(
    page,
    sala!.participantes.flatMap((p, i) => (p.estado === 'naSala' && p.imagem ? [{ quadro: p.quadro, cor: CORES_DOS_CONVIDADOS[i] }] : [])),
  );
}

/** O quadro de um convidado no mosaico (o grupo com o nome dele, ou o número). */
export const quadroDe = (page: Page, nome: string) => page.getByRole('group', { name: nome, exact: true });
/** A imagem de um convidado no quadro dele. */
export const imagemDe = (page: Page, nome: string) => page.getByRole('img', { name: `Vídeo de ${nome}`, exact: true });
