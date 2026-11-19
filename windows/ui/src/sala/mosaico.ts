// O mosaico de quem montou a sala (docs/ponte-windows.md, "O mosaico no `remoto`"): a arrumação do núcleo em frações (o
// MosaicCells e o UnitTile do starsonic/phone/RoomMosaic.cpp), que a ponte falsa e os testes usam, e a linha de baixo. A
// página não refaz a conta: ela põe cada convidado no `quadro` que o núcleo manda.
import type { QuadroDaSala } from '../state';

export const LARGURA_DO_MOSAICO = 1280;
export const ALTURA_DO_MOSAICO = 720;

/** O maior par que não passa de v (v ≥ 0): o `Even` do núcleo. */
const par = (v: number) => Math.floor(v) & ~1;

/**
 * Os quadros de n convidados (1 a 5), em frações: o MosaicCells(n, 1280, 720) e o UnitTile do RoomMosaic.cpp. [] fora de
 * 1 a 5. Um por linha com 1 convidado, dois com 2 a 4 e três com 5; as células iguais, em pixels pares, e a linha
 * incompleta no centro.
 */
export function arrumacao(n: number): QuadroDaSala[] {
  if (!Number.isInteger(n) || n < 1 || n > 5) return [];
  const porLinha = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const linhas = Math.ceil(n / porLinha);
  const largura = par(LARGURA_DO_MOSAICO / porLinha);
  const altura = par(ALTURA_DO_MOSAICO / linhas);
  const y0 = par((ALTURA_DO_MOSAICO - linhas * altura) / 2);
  const quadros: QuadroDaSala[] = [];
  for (let linha = 0; linha < linhas; linha++) {
    const nestaLinha = Math.min(porLinha, n - linha * porLinha);
    const x0 = par((LARGURA_DO_MOSAICO - nestaLinha * largura) / 2);
    for (let i = 0; i < nestaLinha; i++) {
      // Cada número em pixels e depois a divisão, como o UnitTile.
      quadros.push({
        x: (x0 + i * largura) / LARGURA_DO_MOSAICO,
        y: (y0 + linha * altura) / ALTURA_DO_MOSAICO,
        largura: largura / LARGURA_DO_MOSAICO,
        altura: altura / ALTURA_DO_MOSAICO,
      });
    }
  }
  return quadros;
}

/** O quadro na linha de baixo de um mosaico de duas linhas (3 a 5 convidados). */
export function naLinhaDeBaixo(q: QuadroDaSala): boolean {
  return q.y > 0;
}
