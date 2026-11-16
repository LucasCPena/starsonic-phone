// (0.4.0) A sala de vídeo na tela da ligação (os quadros Sala, SalaEstados, SalaCheia, SalaCompacto e SalaMinimo): quem
// montou a sala e está nela, na janela normal. No alto fica o cartão da ligação de fora, tocando ou em espera (o
// CartaoDaOutra de sempre); depois a área do vídeo, com o mosaico (o MosaicoDaSala) e a sua imagem no canto de baixo à
// direita, com a câmera ligada; quem fala ("Sala de vídeo" e "<n> pessoas · <tempo>"; no Mínimo, numa linha só); os
// controles da sala, e só eles (o Mudo, a Câmera, o Adicionar pessoa e o Abrir grande); o aviso da sala cheia, que
// também descreve o Adicionar pessoa; e o Desligar, que pergunta antes (o EncerrarSala). Com o painel de adicionar (o
// mesmo da videochamada), a área do vídeo sai: o alto do painel diz "Em videochamada", a sala e as pessoas, e a sua
// imagem flutua no canto de baixo. O painel só vale enquanto o Adicionar pessoa vale (o podeAdicionar): o pedido dele
// cai com o painel, e não volta sozinho. Os botões ignoram o segundo clique de um clique duplo (o NoWindows): a sala
// nunca aparece no iPhone. A regra do que vale vem toda do estado (sala/estado.ts).
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { IconAdicionarPessoa, IconExpand, IconMic, IconMicOff, IconSwap, IconVideo, IconVideoOff } from '../icons';
import { useLayout } from '../layout';
import { listaDeContatos } from '../lista-de-contatos';
import { semSegundoClique } from '../plataforma';
import { CartaoDaOutra } from '../screens/Ligacao';
import { confirmada, Ctrl, NoWindows, RoundAction } from '../screens/controlesDaLigacao';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import type { AppState, CallState, CompanyContact, Contact, SalaDaLigacao } from '../state';
import type { Send } from '../types';
import { SuaImagemFlutuante } from '../video/CaixaDoVideo';
import { videoDe, videoDoApp } from '../video/estado';
import { ABRIR_GRANDE, CAMERA, DESLIGAR_A_CAMERA, LIGAR_A_CAMERA, SUA_IMAGEM } from '../video/textos';
import { cameraDaSalaDesativada, pessoasNaSala, podeAdicionar } from './estado';
import { EncerrarSala } from './EncerrarSala';
import { MosaicoDaSala } from './MosaicoDaSala';
import { PainelDeAdicionar } from './PainelDeAdicionar';
import { ADICIONAR_PESSOA, EM_VIDEOCHAMADA, pessoas, SALA_CHEIA, SALA_DE_VIDEO } from './textos';

interface Props {
  state: AppState;
  ligacao: CallState;
  sala: SalaDaLigacao;
  /** Os contatos do painel de adicionar: os `contatos` do estado. */
  contatos: Contact[];
  /** A lista da empresa (a última contatosEmpresa): entra na lista do painel com os `contatos`. */
  daEmpresa: CompanyContact[];
  send: Send;
}

/** O rótulo de um controle da sala: no Mínimo ele sai da vista (o app.css), e o nome do botão fica. */
const rotulo = (texto: string) => <span class="ctrl-rotulo">{texto}</span>;

export function TelaDaSala({ state, ligacao: l, sala, contatos, daEmpresa, send }: Props): VNode {
  const now = useNow();
  const layout = useLayout();
  // O pedido do painel de adicionar e a pergunta do Desligar. O painel vale enquanto o Adicionar pessoa vale.
  const [pedido, setPedido] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  // A sala só chega aqui em cima (o main.tsx): a linha dela é a de cima.
  const linha = l.top;
  const video = videoDe(state, linha);
  const pode = podeAdicionar(state, l);
  const painel = pedido && pode;
  // O pedido cai com o painel: sem isto, o painel voltaria sozinho quando adicionar voltasse a valer.
  useEffect(() => {
    if (pedido && !pode) setPedido(false);
  }, [pedido, pode]);

  const conferencia = l.conference && l.second !== null;
  const temCartao = !conferencia && l.second !== null && (l.secondKind === 'ringing' || l.secondKind === 'held');
  const tempo = statusLine(linha, now);
  const contaDeGente = pessoas(pessoasNaSala(sala));
  // O Alternar, com a ligação de fora em espera (atendida): volta a ela, e a faixa "Você está fora da sala" volta.
  const comAlternar = !conferencia && l.second !== null && l.secondKind === 'held';
  const alternarDesativado = l.second === null || !confirmada(l.second);

  const cartao = temCartao ? (
    <div class="call-alto">
      <CartaoDaOutra state={state} ligacao={l} send={send} now={now} />
      {/* Com o painel e o cartão, a sua imagem fica no canto de baixo, sem cobrir o cartão (o app.css). */}
      {painel && video.camera && <SuaImagemFlutuante />}
    </div>
  ) : null;
  // Sem o cartão, a sua imagem flutuante com o painel é irmã do resto, no canto de baixo.
  const suaDoPainel = painel && video.camera && !temCartao ? <SuaImagemFlutuante /> : null;

  const desligar = (
    <div class="call-actions">
      <RoundAction label="Desligar" kind="hang" onClick={semSegundoClique(true, () => setPerguntando(true))} />
    </div>
  );

  let corpo: VNode;
  if (painel) {
    // O alto do painel: a sala, com "Em videochamada" em cima, as pessoas e o tempo.
    corpo = (
      <>
        <div class="who who-compact who-sala">
          <span class="eyebrow">{EM_VIDEOCHAMADA}</span>
          <span class="who-name">{SALA_DE_VIDEO}</span>
          <span class="who-sub">
            {contaDeGente}
            {tempo && ' · '}
            {tempo && <span class="timer">{tempo}</span>}
          </span>
        </div>
        <div class="call-middle">
          <PainelDeAdicionar
            lista={listaDeContatos(contatos, daEmpresa).todas}
            onAdicionar={(numero, doContato) => {
              setPedido(false);
              send({ cmd: 'salaAdicionar', numero, ...(doContato ? { contato: true } : {}) });
            }}
            onCancel={() => setPedido(false)}
          />
        </div>
        {desligar}
      </>
    );
  } else {
    // As colunas seguem quantos controles há: Mudo, Adicionar pessoa e Abrir grande, e a Câmera e o Alternar quando vêm.
    const quantos = 3 + (videoDoApp(state).ligado ? 1 : 0) + (comAlternar ? 1 : 0);
    const grade = quantos >= 5 ? 'ctrls ctrls-5' : quantos === 4 ? 'ctrls ctrls-4' : 'ctrls';
    corpo = (
      <>
        <div class="sala-caixa">
          <MosaicoDaSala state={state} sala={sala} linha={linha} send={send} modo="ligacao" />
          {video.camera && <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class="video-sua" />}
        </div>
        {layout === 'minimo' ? (
          <div class="who who-video who-sala">
            <p class="who-linha">
              <span class="who-linha-nome">{SALA_DE_VIDEO}</span>
              <span class="who-linha-tempo">
                {` · ${contaDeGente}`}
                {tempo && ' · '}
                {tempo && <span class="timer">{tempo}</span>}
              </span>
            </p>
          </div>
        ) : (
          <div class="who who-video who-sala">
            <span class="who-name">{SALA_DE_VIDEO}</span>
            <span class="who-sub">
              {contaDeGente}
              {tempo && ' · '}
              {tempo && <span class="timer">{tempo}</span>}
            </span>
          </div>
        )}
        <div class={quantos >= 5 ? 'sala-baixo sala-baixo-5' : 'sala-baixo'}>
          <div class="call-middle">
            <div class={grade}>
              <Ctrl
                label={rotulo('Mudo')}
                nome="Mudo"
                icon={l.muted ? <IconMicOff /> : <IconMic />}
                pressed={l.muted}
                onClick={() => send({ cmd: 'mute', on: !l.muted })}
              />
              {videoDoApp(state).ligado && (
                <Ctrl
                  label={rotulo(CAMERA)}
                  nome={video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA}
                  icon={video.camera ? <IconVideo /> : <IconVideoOff />}
                  aceso={video.camera}
                  disabled={cameraDaSalaDesativada(linha, video)}
                  onClick={() => send({ cmd: 'camera', on: !video.camera })}
                />
              )}
              <Ctrl
                label={rotulo(ADICIONAR_PESSOA)}
                nome={ADICIONAR_PESSOA}
                icon={<IconAdicionarPessoa />}
                disabled={!pode}
                descritoPor={sala.cheia ? 'sala-cheia' : undefined}
                onClick={() => setPedido(true)}
              />
              {comAlternar && (
                <Ctrl label={rotulo('Alternar')} nome="Alternar" icon={<IconSwap />} disabled={alternarDesativado} onClick={() => send({ cmd: 'swap' })} />
              )}
              <Ctrl
                label={rotulo(ABRIR_GRANDE)}
                nome={ABRIR_GRANDE}
                icon={<IconExpand />}
                onClick={() => send({ cmd: 'videoWindow', modo: 'grande' })}
              />
            </div>
          </div>
          {sala.cheia && (
            <p id="sala-cheia" class="sala-cheia">
              {SALA_CHEIA}
            </p>
          )}
          {desligar}
        </div>
      </>
    );
  }

  const classes = [
    'call-body',
    'call-sala',
    painel ? '' : 'call-com-video',
    painel && temCartao ? 'call-painel-cartao' : '',
    painel && !temCartao && video.camera ? 'call-sua-embaixo' : '',
  ].filter(Boolean);
  return (
    <NoWindows.Provider value={true}>
      <main class={classes.join(' ')} aria-label={SALA_DE_VIDEO}>
        {cartao}
        {corpo}
        {suaDoPainel}
        {perguntando && <EncerrarSala sala={sala} send={send} onFechar={() => setPerguntando(false)} />}
      </main>
    </NoWindows.Provider>
  );
}
