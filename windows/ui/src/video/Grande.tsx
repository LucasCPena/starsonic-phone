// (vídeo, etapa 2) O grande e a tela cheia (os quadros Grande e TelaCheia): a tela que a página mostra com a janela do
// vídeo em `grande` (1280×800; o executável redimensiona a janela quando a página manda o `videoWindow`) ou em
// `telaCheia`. Só o vídeo da outra ponta (a janela toda, encaixada no fundo #04060e), a sua imagem no canto (com a câmera
// ligada, sempre à vista), a etiqueta de quem fala, uma sombra embaixo e a barra de baixo: Mudo, Câmera, Chat, Tela cheia
// (ou Sair da tela cheia), Diminuir e Desligar. (Ruling 13) O vídeo e a Câmera seguem a regra da tela da ligação, do
// video/estado.ts: com duas ligações (a segunda tocando ou em espera, também na consulta), a imagem da outra ponta pausa
// (a vista fica só com o fundo: o imagemDaLigacao) e a Câmera só desliga (o cameraDaLigacaoDesativada); na conferência,
// nenhuma Câmera. O Chat só aparece com o `chat` (o main.tsx o passa numa ligação com um colega do chat): ele abre e
// fecha a conversa num painel de 360 à direita (o quadro GrandeChat), no tema do app, e o vídeo, a sua imagem e a barra
// de baixo ficam com o resto. O cartão da segunda ligação (o CartaoDaOutra) flutua em cima, no meio. O duplo clique no
// vídeo alterna o grande e a tela cheia (só o que começou no vídeo: o segundo clique de um clique duplo no Abrir grande
// cai aqui e não vale), e o Esc só vale na tela cheia (o ouvinte sai quando ela sai), fora de um diálogo aberto (a foto
// grande da conversa fecha com ele, e a tela cheia fica). Os botões ignoram o segundo clique de um clique duplo: o Tela
// cheia dá lugar ao Sair da tela cheia no mesmo ponto.
import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { contactNumberLine, nameOrNumber } from '../format';
import { IconExitFullscreen, IconFullscreen, IconMessage, IconMic, IconMicOff, IconPhone, IconShrink, IconVideo, IconVideoOff } from '../icons';
import { semSegundoClique } from '../plataforma';
import { CartaoDaOutra } from '../screens/Ligacao';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import type { AppState, CallState } from '../state';
import type { Send } from '../types';
import { cameraDaLigacaoDesativada, imagemDaLigacao, videoDe } from './estado';
import { CAMERA, CHAT, DESLIGAR_A_CAMERA, DIMINUIR, LIGAR_A_CAMERA, rotuloDoVideo, SAIR_DA_TELA_CHEIA, SUA_IMAGEM, TELA_CHEIA } from './textos';

/** O chat do grande (a Task 8): o botão Chat alterna o painel da direita, com a conversa (o `painel`) dentro. */
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
      {/* (Ruling 15) Numa barra estreita, o rótulo sai da vista e fica só para o leitor de tela (o app.css). */}
      <span class="grande-rotulo">{rotulo}</span>
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

  // (Ruling 14) O clique duplo no vídeo só alterna a tela quando o primeiro clique dele também caiu no vídeo: o segundo
  // clique de um clique duplo que começou em outro lugar (o Abrir grande, que abre o grande embaixo do ponteiro, ou um
  // botão do cartão da outra ligação, que sai dali) não vale. Cada primeiro clique (o `detail` 1), em qualquer lugar da
  // página, diz se caiu no vídeo.
  const areaDoVideo = useRef<HTMLDivElement>(null);
  const primeiroNoVideo = useRef(false);
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      if (e.detail === 1) primeiroNoVideo.current = areaDoVideo.current?.contains(e.target as Node) === true;
    };
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, []);
  const aoClicarDuasVezes = () => {
    if (!primeiroNoVideo.current) return;
    primeiroNoVideo.current = false;
    alternarTela();
  };

  // O Esc só vale na tela cheia; o ouvinte sai quando ela sai (ou a tela desmonta). Com um diálogo aberto (a foto grande
  // da conversa do painel), o Esc é dele: ele fecha, e a tela cheia fica (o preventDefault do Esc impediria o diálogo de
  // fechar).
  useEffect(() => {
    if (!telaCheia) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      send({ cmd: 'videoWindow', modo: 'grande' });
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [telaCheia, send]);

  // A Câmera: com duas ligações (a segunda tocando ou em espera, também na consulta), só desliga; na conferência, nenhuma.
  const camera = conferencia ? null : (
    <Botao
      rotulo={CAMERA}
      nome={video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA}
      icone={video.camera ? <IconVideo /> : <IconVideoOff />}
      aceso={video.camera}
      desligado={cameraDaLigacaoDesativada(l, video)}
      onClick={() => send({ cmd: 'camera', on: !video.camera })}
    />
  );

  return (
    <div class={chat?.aberto ? 'grande grande-com-chat' : 'grande'} data-modo={telaCheia ? 'tela-cheia' : 'grande'}>
      <div class="grande-video" ref={areaDoVideo} onDblClick={aoClicarDuasVezes}>
        <VistaDeVideo key={top.id} vista="remoto" desenhar={video.imagem && imagemDaLigacao(l)} rotulo={rotuloDoVideo(nome)} class="grande-remoto" />
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
      {/* O painel volta às cores do tema do app (o tema-do-app do app.css), por cima das da tela da ligação. */}
      {chat?.aberto && <div class="grande-chat tema-do-app">{chat.painel}</div>}
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
