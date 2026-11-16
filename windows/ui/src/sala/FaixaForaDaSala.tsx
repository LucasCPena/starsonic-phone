// (0.4.0) A faixa de fora da sala (os quadros LigacaoDeFora e ForaDaSala): com você na ligação de fora e a sala em espera,
// ela fica entre a barra da ligação e a tela, com a miniatura do mosaico (64×36, um bloco por convidado no quadro dele, em frações, só
// enfeite), "Você está fora da sala", os nomes de quem ficou nela e o tempo dela, e o Voltar para a sala (o `salaVoltar`),
// que ignora o segundo clique de um clique duplo: a sala que volta põe o Desligar do cartão da ligação de fora no lugar
// dele. A sala vem do estado (sala/estado.ts): em cima ainda em espera, ou embaixo.
import type { VNode } from 'preact';
import { semSegundoClique } from '../plataforma';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import type { AppState, CallCard, CallState, SalaDaLigacao } from '../state';
import type { Send } from '../types';
import { nomesDaSala, salaEmbaixo } from './estado';
import { FORA_DA_SALA, VOLTAR_PARA_A_SALA } from './textos';

interface Props {
  state: AppState;
  ligacao: CallState;
  sala: SalaDaLigacao;
  send: Send;
}

export function FaixaForaDaSala({ ligacao: l, sala, send }: Props): VNode {
  const now = useNow();
  // A linha da sala: a de baixo (a ligação de fora em cima) ou a de cima, ainda em espera.
  const linha: CallCard = salaEmbaixo(l, sala) && l.second ? l.second : l.top;
  const tempo = statusLine(linha, now);
  return (
    <section class="fora-faixa" aria-label={FORA_DA_SALA}>
      <div class="fora-miniatura" aria-hidden="true">
        {sala.participantes.map((p) => (
          <span
            key={p.id}
            class={p.imagem ? 'fora-bloco fora-bloco-imagem' : 'fora-bloco'}
            style={{
              left: `${p.quadro.x * 100}%`,
              top: `${p.quadro.y * 100}%`,
              width: `${p.quadro.largura * 100}%`,
              height: `${p.quadro.altura * 100}%`,
            }}
          />
        ))}
      </div>
      <div class="fora-textos">
        <span class="fora-titulo">{FORA_DA_SALA}</span>
        <span class="fora-sub">
          <span class="fora-nomes">{nomesDaSala(sala)}</span>
          {tempo && <span class="fora-tempo">{` · ${tempo}`}</span>}
        </span>
      </div>
      <button type="button" class="fora-voltar" onClick={semSegundoClique(true, () => send({ cmd: 'salaVoltar' }))}>
        {VOLTAR_PARA_A_SALA}
      </button>
    </section>
  );
}
