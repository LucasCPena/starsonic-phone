// A regra de quando uma ligação pausa a reunião aberta no navegador (a spec, 7.8 e 7.9).
import type { CallCard, CallState } from '../state';

/** Uma recebida que ainda toca não pausa nada. */
const soTocando = (c: CallCard): boolean => c.incoming && c.phase === 'ringing';

/**
 * A reunião fica em pausa do começo de uma ligação feita, ou do atender de uma recebida, até a última acabar: existe um
 * cartão (o de cima ou o segundo) que não é uma recebida ainda tocando. A sala de vídeo de pé conta como uma ligação.
 */
export function haPausa(l: CallState | null): boolean {
  if (!l) return false;
  if (l.sala) return true;
  return !soTocando(l.top) || (l.second !== null && !soTocando(l.second));
}

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** O `vez` de uma pausa: 12 caracteres de [A-Za-z0-9], sorteados pelo crypto.getRandomValues. */
export function novaVez(): string {
  // 248 é o maior múltiplo de 62 até 256: o resto fora dele é sorteado de novo, para nenhum caractere pesar mais.
  let vez = '';
  while (vez.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && vez.length < 12) vez += LETRAS[b % LETRAS.length];
    }
  }
  return vez;
}
