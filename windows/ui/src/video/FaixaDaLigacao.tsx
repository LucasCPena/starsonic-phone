// (vídeo, etapa 2) A faixa da ligação, em cima da conversa que o Chat da ligação abriu (spec do vídeo, 4.4; os quadros
// ConversaNaLigacao e ConversaNaLigacaoEscura): navy-950 nos dois temas. À esquerda, a miniatura de 64×48: a imagem da
// outra ponta (o `remoto`, com o `key` do id da ligação), com a sua imagem pequena dentro com a câmera ligada; sem a
// imagem da outra ponta, a sua imagem (com a câmera ligada, ela está sempre à vista); sem nenhuma das duas, nenhuma. No
// meio, "Em ligação · <tempo>" com a miniatura, ou "<nome> · <tempo>" sem ela (o nome sai com as reticências, e o tempo
// fica inteiro), e o "Voltar para a ligação". (Ruling 16) Como nos quadros: a faixa é a seção "Ligação com <nome>"; o
// "Em ligação ·" vai no cinza-azulado e menor, o nome em branco e mais forte, e o tempo em ciano (com o "·" antes dele
// quando vem o nome). À direita, os botões redondos: o Mudo, a Câmera (só com o vídeo ligado, com
// a regra da tela da ligação: o cameraDesativada) e o Desligar (o hangup com o id). A conversa só fica com uma ligação
// (main.tsx). Os botões ignoram o segundo clique de um clique duplo, como os da tela da ligação.
import type { VNode } from 'preact';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { nameOrNumber } from '../format';
import { IconMic, IconMicOff, IconPhone, IconVideo, IconVideoOff } from '../icons';
import { semSegundoClique } from '../plataforma';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import type { AppState, CallState } from '../state';
import type { Send } from '../types';
import { cameraDesativada, videoDe, videoDoApp } from './estado';
import { DESLIGAR_A_CAMERA, EM_LIGACAO, LIGAR_A_CAMERA, ligacaoCom, rotuloDoVideo, SUA_IMAGEM, VOLTAR_PARA_A_LIGACAO } from './textos';

interface Props {
  state: AppState;
  ligacao: CallState;
  send: Send;
  /** O "Voltar para a ligação": a tela da ligação no lugar da conversa. */
  onVoltar(): void;
}

export function FaixaDaLigacao({ state, ligacao: l, send, onVoltar }: Props): VNode {
  const now = useNow();
  const top = l.top;
  const video = videoDe(state, top);
  const nome = nameOrNumber(top);
  const tempo = statusLine(top, now);
  const miniatura = video.imagem || video.camera;
  const aoClicar = (acao: () => void) => semSegundoClique(true, acao);
  const camera = video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA;
  return (
    <section class="faixa-ligacao" aria-label={ligacaoCom(nome)}>
      {/* A vista da sua imagem é a mesma quando a da outra ponta chega ou sai (ela não remonta): só a medida muda. */}
      {miniatura && (
        <div class="faixa-miniatura">
          {video.imagem && <VistaDeVideo key={top.id} vista="remoto" desenhar rotulo={rotuloDoVideo(nome)} class="faixa-remoto" />}
          {video.camera && <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class={video.imagem ? 'faixa-sua' : 'faixa-sua-so'} />}
        </div>
      )}
      <div class="faixa-textos">
        <p class="faixa-titulo">
          {miniatura ? (
            <>
              <span class="faixa-nome faixa-em-ligacao">{tempo ? `${EM_LIGACAO} ·` : EM_LIGACAO}</span>
              {tempo && <span class="faixa-tempo">{` ${tempo}`}</span>}
            </>
          ) : (
            <>
              <span class="faixa-nome">{nome}</span>
              {tempo && <span class="faixa-tempo">{` · ${tempo}`}</span>}
            </>
          )}
        </p>
        <button type="button" class="faixa-voltar" onClick={aoClicar(onVoltar)}>
          {VOLTAR_PARA_A_LIGACAO}
        </button>
      </div>
      <div class="faixa-botoes">
        <button
          type="button"
          class={l.muted ? 'faixa-botao faixa-on' : 'faixa-botao'}
          aria-label="Mudo"
          title="Mudo"
          aria-pressed={l.muted}
          onClick={aoClicar(() => send({ cmd: 'mute', on: !l.muted }))}
        >
          {l.muted ? <IconMicOff /> : <IconMic />}
        </button>
        {videoDoApp(state).ligado && (
          <button
            type="button"
            class={video.camera ? 'faixa-botao faixa-on' : 'faixa-botao'}
            aria-label={camera}
            title={camera}
            disabled={cameraDesativada(top, video)}
            onClick={aoClicar(() => send({ cmd: 'camera', on: !video.camera }))}
          >
            {video.camera ? <IconVideo /> : <IconVideoOff />}
          </button>
        )}
        <button
          type="button"
          class="faixa-botao faixa-desligar"
          aria-label="Desligar"
          title="Desligar"
          onClick={aoClicar(() => send({ cmd: 'hangup', id: top.id }))}
        >
          <IconPhone class="ic-hang" />
        </button>
      </div>
    </section>
  );
}
