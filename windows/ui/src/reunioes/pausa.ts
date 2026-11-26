// A regra de quando uma ligação pausa a reunião, a de dentro do app e a aberta no navegador (a spec, 7.8 e 7.9).
import type { CallCard, CallState } from '../state';

/** Uma recebida que ainda toca não pausa nada. */
const soTocando = (c: CallCard): boolean => c.incoming && c.phase === 'ringing';

/**
 * Há pausa enquanto existe uma ligação que não está em espera pelo "Voltar para a reunião" (`emEspera`: o id da
 * ligação que o Voltar pôs em espera, ou null): do começo de uma ligação feita, ou do atender de uma recebida, até a
 * última acabar; só tocando não pausa; a sala de vídeo de pé conta como uma ligação. A ligação do `emEspera` só deixa
 * de contar já em espera (o `held`): até o núcleo dizer que ela está em espera, a pausa continua.
 */
export function haPausa(l: CallState | null, emEspera: number | null = null): boolean {
  if (!l) return false;
  if (l.sala) return true;
  const conta = (c: CallCard | null): boolean =>
    c !== null && !soTocando(c) && !(emEspera !== null && c.id === emEspera && c.held);
  return conta(l.top) || conta(l.second);
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
