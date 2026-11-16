// (0.4.0) O mosaico da sala (os quadros Sala, SalaEstados e SalaCheia): a vista `remoto` desenha o mosaico do núcleo (o
// 1280×720 de quem montou a sala, com o `video.imagem` da linha da sala, sem a regra das duas ligações: a ligação de fora
// tocando não pausa o mosaico), e a página põe por cima, no retângulo 16:9 encaixado na área do vídeo, um quadro por
// convidado, no `quadro` que o núcleo manda (em frações; a página não refaz a conta). O quadro de quem tem a imagem é
// transparente: dentro dele fica a imagem do convidado (4:3, encaixada) e o nome dele no canto de baixo à esquerda dela. O
// de quem chama, está sem vídeo ou em espera é um painel com as iniciais, o nome e o estado. A vista leva o `key` do id da
// sala: uma sala nova monta uma vista nova, que nunca mostra um quadro da ligação de antes (o contrato da página com as
// memórias). O `modo` (a tela da ligação, o grande ou a tela cheia) escolhe as medidas no app.css.
import type { VNode } from 'preact';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { initials } from '../format';
import { IconPause, IconPhone, IconVideoOff } from '../icons';
import type { AppState, CallCard, ParticipanteDaSala, SalaDaLigacao } from '../state';
import type { Send } from '../types';
import { videoDe } from '../video/estado';
import { rotuloDoVideo } from '../video/textos';
import { nomeNaSala } from './estado';
import { CHAMANDO, EM_ESPERA_NA_SALA, MOSAICO_DA_SALA, SEM_VIDEO_NA_SALA } from './textos';

interface Props {
  state: AppState;
  sala: SalaDaLigacao;
  /** A linha da sala: a de cima, ou a de baixo com você fora dela. */
  linha: CallCard;
  send: Send;
  modo: 'ligacao' | 'grande' | 'telaCheia';
}

/** Como os quadros se arrumam: 1 ou 2 convidados, 3 ou 4 (a grade 2×2) e 5 (3 + 2). O nome no quadro segue isto, não a conta. */
function arrumacaoDe(quantos: number): 'g2' | 'g4' | 'g5' {
  return quantos <= 2 ? 'g2' : quantos <= 4 ? 'g4' : 'g5';
}

/** O quadro de um convidado, em frações do mosaico. */
function Quadro({ p }: { p: ParticipanteDaSala }): VNode {
  const nome = nomeNaSala(p);
  const q = p.quadro;
  const posicao = { left: `${q.x * 100}%`, top: `${q.y * 100}%`, width: `${q.largura * 100}%`, height: `${q.altura * 100}%` };
  if (p.estado === 'naSala' && p.imagem) {
    return (
      <div role="group" aria-label={nome} class="sala-quadro" style={posicao}>
        <div class="sala-enc">
          <div role="img" aria-label={rotuloDoVideo(nome)} class="sala-imagem" />
          <span class="sala-nome" aria-hidden="true">
            {nome}
          </span>
        </div>
      </div>
    );
  }
  const estado =
    p.estado === 'chamando' ? (
      <span class="sala-estado sala-chamando">{CHAMANDO}</span>
    ) : p.estado === 'emEspera' ? (
      <span class="sala-estado">
        <IconPause size="sm" />
        {EM_ESPERA_NA_SALA}
      </span>
    ) : (
      <span class="sala-estado">
        <IconVideoOff size="sm" />
        {SEM_VIDEO_NA_SALA}
      </span>
    );
  return (
    <div role="group" aria-label={nome} class="sala-quadro sala-painel" style={posicao}>
      <span class={p.estado === 'chamando' ? 'sala-iniciais sala-iniciais-chamando' : p.estado === 'emEspera' ? 'sala-iniciais sala-iniciais-espera' : 'sala-iniciais'} aria-hidden="true">
        {p.nome ? initials(p.nome) : <IconPhone size="sm" />}
      </span>
      <span class="sala-nome-painel" aria-hidden="true">
        {nome}
      </span>
      {estado}
    </div>
  );
}

/** O que a área do vídeo da sala guarda: a vista do mosaico e os quadros dos convidados por cima. */
export function MosaicoDaSala({ state, sala, linha, modo }: Props): VNode {
  const video = videoDe(state, linha);
  return (
    <>
      <VistaDeVideo key={sala.id} vista="remoto" desenhar={video.imagem} rotulo={MOSAICO_DA_SALA} decorativa class="sala-vista" />
      <div role="group" aria-label={MOSAICO_DA_SALA} class={`sala-mosaico sala-${arrumacaoDe(sala.participantes.length)}`} data-modo={modo}>
        {sala.participantes.map((p) => (
          <Quadro key={p.id} p={p} />
        ))}
      </div>
    </>
  );
}
