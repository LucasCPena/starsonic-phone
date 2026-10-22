// O BLF de um atalho (rc.3, spec 4): a bolinha da cor do estado e, sempre ao lado, a palavra (Livre, Tocando,
// Ocupado, Desconectado). A bolinha nunca aparece sozinha; Tocando pisca devagar (sem piscar com o movimento reduzido).
import { blfWord } from '../format';
import type { BlfState } from '../state';

export function BlfBadge({ estado }: { estado: BlfState }) {
  return (
    <span class={`blf blf-${estado}`}>
      <span class="blf-dot" aria-hidden="true" />
      <span class="blf-palavra">{blfWord(estado)}</span>
    </span>
  );
}
