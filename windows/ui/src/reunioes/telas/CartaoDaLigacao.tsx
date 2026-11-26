// Os cartões da ligação por cima da reunião dentro do app, no alto e no meio da página (o quadro, tela 12). O da
// ligação que toca: o avatar, "Ligação de <nome ou número>", "<ramal ou número> · tocando" (só "tocando" sem o nome,
// como o cartão da segunda na tela da ligação), o "Recusar" (o reject) e o "Atender" (o answer sem o vídeo: numa
// reunião, as ligações são só de voz), com esses nomes para o leitor de tela, e a linha "Atender tira você da reunião
// enquanto a ligação durar.". Com duas tocando, o cartão é o da de cima. O da ligação que o "Voltar para a reunião" pôs
// em espera: "<nome ou número> em espera", o "Voltar à ligação" e o "Desligar" (o hangup dela). Cada cartão é uma seção
// com o nome do título. Os botões mudam a tela: eles ignoram o segundo clique de um clique duplo (o semSegundoClique),
// como os da tela da ligação (a reunião é só do Windows).
import type { VNode } from 'preact';
import { contactNumberLine, nameOrNumber } from '../../format';
import { IconPhone } from '../../icons';
import { semSegundoClique } from '../../plataforma';
import { Avatar } from '../../screens/controlesDaLigacao';
import type { CallCard, CallState } from '../../state';
import type { Send } from '../../types';
import {
  ATENDER,
  ATENDER_TIRA_DA_REUNIAO,
  DESLIGAR,
  emEsperaDe,
  ligacaoDe,
  RECUSAR,
  tocando,
  VOLTAR_A_LIGACAO,
} from '../textos';

/** A recebida que toca: a de cima, ou a segunda (fora da conferência), como o answer e o reject do núcleo a acham. */
function aQueToca(l: CallState): CallCard | null {
  if (l.top.incoming && l.top.phase === 'ringing') return l.top;
  return !(l.conference && l.second !== null) && l.secondKind === 'ringing' ? l.second : null;
}

interface Props {
  ligacao: CallState;
  /** O id da ligação que o "Voltar para a reunião" pôs em espera, ou null. */
  emEspera: number | null;
  send: Send;
  /** O "Voltar à ligação" (o ReuniaoNoApp.voltarALigacao). */
  onVoltarALigacao(): void;
}

/** O cartão de agora por cima da reunião: o da ligação que toca, ou o da ligação em espera; sem os dois, nenhum. */
export function CartaoDaLigacao({ ligacao: l, emEspera, send, onVoltarALigacao }: Props): VNode | null {
  const toca = aQueToca(l);
  if (toca) {
    const titulo = ligacaoDe(nameOrNumber(toca));
    return (
      <section class="cartao-ligacao" aria-label={titulo}>
        <div class="cartao-ligacao-linha">
          <Avatar card={toca} />
          <span class="cartao-ligacao-textos">
            <span class="cartao-ligacao-titulo">{titulo}</span>
            <span class="cartao-ligacao-sub">{tocando(toca.name ? contactNumberLine(toca.number) : null)}</span>
          </span>
          <button
            type="button"
            class="cartao-ligacao-redondo cartao-ligacao-recusar"
            aria-label={RECUSAR}
            title={RECUSAR}
            onClick={semSegundoClique(true, () => send({ cmd: 'reject' }))}
          >
            <IconPhone class="ic-hang" />
          </button>
          <button
            type="button"
            class="cartao-ligacao-redondo cartao-ligacao-atender"
            aria-label={ATENDER}
            title={ATENDER}
            onClick={semSegundoClique(true, () => send({ cmd: 'answer' }))}
          >
            <IconPhone />
          </button>
        </div>
        <p class="cartao-ligacao-nota">{ATENDER_TIRA_DA_REUNIAO}</p>
      </section>
    );
  }
  const espera = emEspera === null ? null : ([l.top, l.second].find((c) => c !== null && c.id === emEspera) ?? null);
  if (!espera) return null;
  const titulo = emEsperaDe(nameOrNumber(espera));
  return (
    <section class="cartao-ligacao" aria-label={titulo}>
      <div class="cartao-ligacao-linha">
        <Avatar card={espera} />
        <span class="cartao-ligacao-textos">
          <span class="cartao-ligacao-titulo">{titulo}</span>
          {espera.name && <span class="cartao-ligacao-sub">{contactNumberLine(espera.number)}</span>}
        </span>
      </div>
      <div class="cartao-ligacao-botoes">
        <button type="button" class="cartao-ligacao-voltar" onClick={semSegundoClique(true, onVoltarALigacao)}>
          {VOLTAR_A_LIGACAO}
        </button>
        <button
          type="button"
          class="cartao-ligacao-desligar"
          onClick={semSegundoClique(true, () => send({ cmd: 'hangup', id: espera.id }))}
        >
          {DESLIGAR}
        </button>
      </div>
    </section>
  );
}
