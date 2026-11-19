// O tempo da ligação: o relógio que redesenha a cada segundo e a linha do estado da ligação de cima. Saem do Ligacao.tsx
// sem mudar (vídeo, etapa 2), para a área do vídeo, a faixa da conversa e o grande usarem também.
import { useEffect, useState } from 'preact/hooks';
import { callTimer } from '../format';
import type { CallCard } from '../state';

/** Re-renderiza a cada segundo (o tempo da ligação). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** O estado da ligação de cima: "Chamando…", "Conectando…" (atendida, sem a confirmação) ou o tempo. */
export function statusLine(card: CallCard, now: number): string {
  if (card.phase === 'dialing') return 'Chamando…';
  if (card.phase === 'ringing') return '';
  if (card.activeSinceMs <= 0) return 'Conectando…';
  return callTimer(now - card.activeSinceMs);
}
