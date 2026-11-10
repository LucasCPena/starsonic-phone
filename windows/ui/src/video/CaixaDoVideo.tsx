// (vídeo, etapa 2) A área do vídeo da tela da ligação (os quadros Video, VideoCompacto e VideoMinimo): a imagem da outra
// ponta grande, encaixada no fundo #04060e, com a sua imagem embaixo à direita (com a câmera ligada) e o Abrir grande em
// cima à direita; embaixo dela, quem fala (o nome e "Ramal 2003 · 03:12"; no Mínimo, uma linha só, "Ana Souza · 03:12").
// A vista da outra ponta leva o `key` do id da ligação: uma ligação nova monta uma vista nova, que nunca mostra um quadro
// da de antes (o contrato da página com as memórias). O Abrir grande é irmão das vistas, nunca filho de uma imagem (o
// role="img" esconde o que tem dentro do leitor de tela). A sua imagem flutuante (o quadro VozComCamera) é a sua imagem
// fora da área do vídeo: a tela da ligação a mostra com a câmera ligada (Ligacao.tsx).
import type { VNode } from 'preact';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { contactNumberLine, nameOrNumber } from '../format';
import { IconExpand } from '../icons';
import { useLayout } from '../layout';
import { isIos, semSegundoClique } from '../plataforma';
import { statusLine } from '../screens/tempoDaLigacao';
import type { AppState, CallCard } from '../state';
import type { Send } from '../types';
import { videoDe } from './estado';
import { ABRIR_GRANDE, rotuloDoVideo, SUA_IMAGEM } from './textos';

interface Props {
  state: AppState;
  /** A ligação de cima, a do vídeo. */
  card: CallCard;
  now: number;
  send: Send;
}

/** A área do vídeo e quem fala, no lugar do bloco de quem fala da ligação só de voz. */
export function CaixaDoVideo({ state, card, now, send }: Props): VNode {
  const video = videoDe(state, card);
  // No Mínimo, quem fala é outro texto (uma linha só, sem o ramal): o layout vem daqui, como o título da barra no main.tsx.
  const layout = useLayout();
  const nome = nameOrNumber(card);
  const tempo = statusLine(card, now);
  return (
    <>
      <div class="video-caixa">
        <VistaDeVideo key={card.id} vista="remoto" desenhar={video.imagem} rotulo={rotuloDoVideo(nome)} class="video-remoto" />
        {video.camera && <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class="video-sua" />}
        {/* O grande toma a tela: o segundo clique de um clique duplo não cai no que fica embaixo do ponteiro. */}
        <button
          type="button"
          class="video-abrir"
          onClick={semSegundoClique(!isIos(state), () => send({ cmd: 'videoWindow', modo: 'grande' }))}
        >
          <IconExpand size="sm" />
          {ABRIR_GRANDE}
        </button>
      </div>
      {layout === 'minimo' ? (
        <div class="who who-video">
          <p class="who-linha">
            <span class="who-linha-nome">{nome}</span>
            {tempo && (
              <span class="who-linha-tempo">
                {' · '}
                <span class="timer">{tempo}</span>
              </span>
            )}
          </p>
        </div>
      ) : (
        <div class="who who-video">
          <span class="who-name">{nome}</span>
          <span class="who-sub">
            {card.name && contactNumberLine(card.number)}
            {card.name && tempo && ' · '}
            {tempo && <span class="timer">{tempo}</span>}
          </span>
        </div>
      )}
    </>
  );
}

/** A sua imagem fora da área do vídeo, no canto de cima à direita da tela da ligação (quem a usa a mostra só com a câmera ligada). */
export function SuaImagemFlutuante(): VNode {
  return <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class="sua-flutuante" />;
}
