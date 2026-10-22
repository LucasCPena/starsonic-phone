// O Rediscar (a opção A do canvas "tamanho, rediscar e status"): o botão redondo de contorno à esquerda do Ligar, que
// liga de novo para a feita mais nova dos Recentes, pelo mesmo comando do botão de ligar de uma linha dos Recentes.
// O nome e o title: "Rediscar <nome ou número>" ("Rediscar" e travado sem nenhuma feita). No hover e no foco, o balão
// do canvas: "Rediscar <número> · <nome>" (o title sai enquanto o balão aparece, para não aparecerem os dois).
import { useState } from 'preact/hooks';
import { lastOutgoing } from '../format';
import { IconRedial } from '../icons';
import type { RecentCall } from '../state';

interface Props {
  recentes: RecentCall[];
  /** Liga para o número (o mesmo caminho do Ligar da tela). */
  onDial(numero: string): void;
  /** O id do balão (um por tela). */
  id: string;
  class?: string;
}

export function Rediscar({ recentes, onDial, id, class: extra }: Props) {
  const [balao, setBalao] = useState(false);
  const feita = lastOutgoing(recentes);
  const rotulo = feita ? `Rediscar ${feita.nome || feita.numero}` : 'Rediscar';
  const dica = feita ? (feita.nome ? `Rediscar ${feita.numero} · ${feita.nome}` : `Rediscar ${feita.numero}`) : '';
  const mostrar = balao && feita !== null;
  return (
    <span class={extra ? `redial-wrap ${extra}` : 'redial-wrap'}>
      <button
        type="button"
        class="btn-redial"
        aria-label={rotulo}
        title={mostrar ? undefined : rotulo}
        aria-describedby={mostrar ? id : undefined}
        disabled={!feita}
        onMouseEnter={() => setBalao(true)}
        onMouseLeave={() => setBalao(false)}
        onFocus={() => setBalao(true)}
        onBlur={() => setBalao(false)}
        onClick={() => feita && (setBalao(false), onDial(feita.numero))}
      >
        <IconRedial />
      </button>
      {mostrar && (
        <span role="tooltip" id={id} class="redial-tip">
          {dica}
        </span>
      )}
    </span>
  );
}
