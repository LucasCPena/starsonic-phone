// (vídeo, etapa 2) O grande e a tela cheia (os quadros Grande e TelaCheia): a tela que a página mostra com a janela do
// vídeo em `grande` (1280×800; o executável redimensiona a janela quando a página manda o `videoWindow`) ou em
// `telaCheia`. Só o vídeo da outra ponta (a janela toda, encaixada no fundo #04060e), a sua imagem no canto (com a câmera
// ligada, sempre à vista), a etiqueta de quem fala, uma sombra embaixo e a barra de baixo: Mudo, Câmera, Chat, Tela cheia
// (ou Sair da tela cheia), Diminuir e Desligar. A Câmera segue a regra da tela da ligação: com uma ligação, o
// cameraDesativada; com duas (também na consulta), só desliga; na conferência, nenhuma. O Chat só aparece com o `chat`
// (a Task 8 o passa, com o painel). O cartão da segunda ligação (o CartaoDaOutra) flutua em cima, no meio. O duplo clique
// no vídeo alterna o grande e a tela cheia, e o Esc só vale na tela cheia (o ouvinte sai quando ela sai). Os botões
// ignoram o segundo clique de um clique duplo: o Tela cheia dá lugar ao Sair da tela cheia no mesmo ponto.
import type { ComponentChildren, VNode } from 'preact';
import { useEffect } from 'preact/hooks';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { contactNumberLine, nameOrNumber } from '../format';
import { IconExitFullscreen, IconFullscreen, IconMessage, IconMic, IconMicOff, IconPhone, IconShrink, IconVideo, IconVideoOff } from '../icons';
import { semSegundoClique } from '../plataforma';
import { CartaoDaOutra } from '../screens/Ligacao';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import type { AppState, CallState } from '../state';
import type { Send } from '../types';
import { cameraDesativada, videoDe } from './estado';
import { CAMERA, CHAT, DESLIGAR_A_CAMERA, DIMINUIR, LIGAR_A_CAMERA, rotuloDoVideo, SAIR_DA_TELA_CHEIA, SUA_IMAGEM, TELA_CHEIA } from './textos';

/** O chat do grande (a Task 8): o botão Chat alterna o painel, que a Task 8 desenha. */
export interface ChatDoGrande {
  aberto: boolean;
  alternar(): void;
  painel: ComponentChildren;
}

interface Props {
  state: AppState;
  ligacao: CallState;
  send: Send;
  chat?: ChatDoGrande | null;
}

interface BotaoProps {
  rotulo: string;
  nome?: string;
  icone: ComponentChildren;
  onClick(): void;
  aceso?: boolean;
  pressionado?: boolean;
  desligado?: boolean;
  perigo?: boolean;
}

function Botao({ rotulo, nome, icone, onClick, aceso, pressionado, desligado, perigo }: BotaoProps): VNode {
  return (
    <button
      type="button"
      class={`grande-item${aceso || pressionado ? ' grande-on' : ''}${perigo ? ' grande-perigo' : ''}`}
      aria-label={nome}
      aria-pressed={pressionado === undefined ? undefined : pressionado}
      disabled={desligado}
      onClick={semSegundoClique(true, onClick)}
    >
      <span class="grande-c">{icone}</span>
      {rotulo}
    </button>
  );
}

export function Grande({ state, ligacao: l, send, chat = null }: Props): VNode {
  const now = useNow();
  const top = l.top;
  const video = videoDe(state, top);
  const telaCheia = state.video?.janela === 'telaCheia';
  const conferencia = l.conference && l.second !== null;
  const nome = nameOrNumber(top);
  const tempo = statusLine(top, now);
  const alternarTela = () => send({ cmd: 'videoWindow', modo: telaCheia ? 'grande' : 'telaCheia' });

  // O Esc só vale na tela cheia; o ouvinte sai quando ela sai (ou a tela desmonta).
  useEffect(() => {
    if (!telaCheia) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      send({ cmd: 'videoWindow', modo: 'grande' });
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [telaCheia, send]);

  // A Câmera: com duas ligações (a outra em espera, também na consulta), só desliga; na conferência, nenhuma.
  const camera = conferencia ? null : (
    <Botao
      rotulo={CAMERA}
      nome={video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA}
      icone={video.camera ? <IconVideo /> : <IconVideoOff />}
      aceso={video.camera}
      desligado={l.second !== null ? !video.camera : cameraDesativada(top, video)}
      onClick={() => send({ cmd: 'camera', on: !video.camera })}
    />
  );

  return (
    <div class="grande" data-modo={telaCheia ? 'tela-cheia' : 'grande'}>
      <div class="grande-video" onDblClick={alternarTela}>
        <VistaDeVideo key={top.id} vista="remoto" desenhar={video.imagem} rotulo={rotuloDoVideo(nome)} class="grande-remoto" />
        <div class="grande-sombra" aria-hidden="true" />
      </div>
      <p class="grande-etiqueta">
        {nome}
        {top.name && ` · ${contactNumberLine(top.number)}`}
        {tempo && ` · ${tempo}`}
      </p>
      {video.camera && <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class="grande-sua" />}
      <div class="grande-cartao">
        <CartaoDaOutra state={state} ligacao={l} send={send} now={now} />
      </div>
      {chat?.aberto && chat.painel}
      <div class="grande-barra">
        <Botao rotulo="Mudo" icone={l.muted ? <IconMicOff /> : <IconMic />} pressionado={l.muted} onClick={() => send({ cmd: 'mute', on: !l.muted })} />
        {camera}
        {chat && <Botao rotulo={CHAT} icone={<IconMessage />} pressionado={chat.aberto} onClick={chat.alternar} />}
        <Botao
          rotulo={telaCheia ? SAIR_DA_TELA_CHEIA : TELA_CHEIA}
          icone={telaCheia ? <IconExitFullscreen /> : <IconFullscreen />}
          onClick={alternarTela}
        />
        <Botao rotulo={DIMINUIR} icone={<IconShrink />} onClick={() => send({ cmd: 'videoWindow', modo: 'normal' })} />
        <Botao rotulo="Desligar" icone={<IconPhone class="ic-hang" />} perigo onClick={() => send({ cmd: 'hangup', id: top.id })} />
      </div>
    </div>
  );
}
