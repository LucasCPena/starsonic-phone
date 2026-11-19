// (vídeo, etapa 2) O grande e a tela cheia (os quadros Grande e TelaCheia): a tela que a página mostra com a janela do
// vídeo em `grande` (1280×800; o executável redimensiona a janela quando a página manda o `videoWindow`) ou em
// `telaCheia`. Só o vídeo da outra ponta (a janela toda, encaixada no fundo #04060e), a sua imagem no canto (com a
// câmera ligada, sempre à vista), a etiqueta de quem fala, uma sombra embaixo e a barra de baixo: Mudo, Câmera, Chat,
// Tela cheia (ou Sair da tela cheia), Diminuir e Desligar. (Ruling 13) O vídeo e a Câmera seguem a regra da tela da
// ligação, do video/estado.ts: com duas ligações (a segunda tocando ou em espera, também na consulta), a imagem da
// outra ponta pausa (a vista fica só com o fundo: o imagemDaLigacao), menos a de um porteiro em cima, que segue à vista
// (a exceção do porteiro), e a Câmera só desliga (o cameraDaLigacaoDesativada); na conferência, nenhuma imagem e
// nenhuma Câmera. O Chat só aparece com o `chat` (o main.tsx o passa numa ligação com um colega do chat): ele abre e
// fecha a conversa num painel de 360 à direita (o quadro GrandeChat), no tema do app, e o vídeo, a sua imagem e a barra
// de baixo ficam com o resto. O cartão da segunda ligação (o CartaoDaOutra) flutua em cima, no meio. O duplo clique no
// vídeo alterna o grande e a tela cheia (só o que começou no vídeo: o segundo clique de um clique duplo no Abrir grande
// cai aqui e não vale), e o Esc só vale na tela cheia (o ouvinte sai quando ela sai), fora de um diálogo aberto (a foto
// grande da conversa fecha com ele, e a tela cheia fica). Os botões ignoram o segundo clique de um clique duplo: o Tela
// cheia dá lugar ao Sair da tela cheia no mesmo ponto.
// (0.4.0) Com a sala em cima (o `salaDe` e o `salaEmCima`), o grande mostra a sala (os quadros Grande e TelaCheia): o
// `main` "Sala de vídeo, grande" (ou "tela cheia"), o mosaico no lugar do vídeo, a etiqueta com a sala, as pessoas e o tempo,
// e a barra da sala: Mudo, Câmera, Adicionar pessoa, Tela cheia, Diminuir e Desligar (que pergunta antes: o EncerrarSala). O
// Adicionar pessoa abre o painel à direita (o do chat, de 360), e o mosaico dá lugar a ele. Toda a sala fica no NoWindows: os
// botões dela ignoram o segundo clique de um clique duplo, e o clique duplo num botão do mosaico (o Tirar da sala) não alterna
// a tela. O resto é como o de uma videochamada: o clique duplo no vídeo, o Esc, o cartão da outra ligação e a sua imagem.
import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { VistaDeVideo } from '../components/VistaDeVideo';
import { contactNumberLine, nameOrNumber } from '../format';
import { IconAdicionarPessoa, IconExitFullscreen, IconFullscreen, IconMessage, IconMic, IconMicOff, IconPhone, IconShrink, IconVideo, IconVideoOff } from '../icons';
import { listaDeContatos } from '../lista-de-contatos';
import { semSegundoClique } from '../plataforma';
import { CartaoDaOutra } from '../screens/Ligacao';
import { NoWindows } from '../screens/controlesDaLigacao';
import { statusLine, useNow } from '../screens/tempoDaLigacao';
import { cameraDaSalaDesativada, pessoasNaSala, podeAdicionar, salaDe, salaEmCima } from '../sala/estado';
import { EncerrarSala } from '../sala/EncerrarSala';
import { MosaicoDaSala } from '../sala/MosaicoDaSala';
import { PainelDeAdicionar } from '../sala/PainelDeAdicionar';
import { ADICIONAR_PESSOA, pessoas, SALA_CHEIA, SALA_DE_VIDEO } from '../sala/textos';
import type { AppState, CallState, CompanyContact, Contact } from '../state';
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
  /** Os contatos do painel de adicionar da sala: os `contatos` do estado. */
  contatos?: Contact[];
  /** A lista da empresa (a última contatosEmpresa): entra na lista do painel com os `contatos`. */
  daEmpresa?: CompanyContact[];
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
  /** (0.4.0) O id do texto que descreve o botão (o motivo de ele estar desativado), e o `title` com o mesmo motivo. */
  descritoPor?: string;
  titulo?: string;
}

function Botao({ rotulo, nome, icone, onClick, aceso, pressionado, desligado, perigo, descritoPor, titulo }: BotaoProps): VNode {
  return (
    <button
      type="button"
      class={`grande-item${aceso || pressionado ? ' grande-on' : ''}${perigo ? ' grande-perigo' : ''}`}
      aria-label={nome}
      aria-describedby={descritoPor}
      title={titulo}
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

export function Grande({ state, ligacao: l, send, chat = null, contatos = [], daEmpresa = [] }: Props): VNode {
  const now = useNow();
  const top = l.top;
  // (0.4.0) Com a sala em cima, o grande mostra a sala: o mosaico, a etiqueta de três partes e a barra da sala. O painel de
  // adicionar vale enquanto o Adicionar pessoa vale (o pedido cai com ele), e a pergunta do Desligar fica até acabar.
  const salaAgora = salaDe(state);
  const sala = salaAgora !== null && salaEmCima(l, salaAgora) ? salaAgora : null;
  const [pedido, setPedido] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  const pode = sala !== null && podeAdicionar(state, l);
  const painelAberto = pedido && pode;
  useEffect(() => {
    if (pedido && !pode) setPedido(false);
  }, [pedido, pode]);
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
      // Um botão dentro da área do vídeo (o Tirar da sala de um quadro da sala) não é o vídeo: o clique duplo nele não alterna.
      if (e.detail === 1) primeiroNoVideo.current = areaDoVideo.current?.contains(e.target as Node) === true && !(e.target as Element).closest('button');
    };
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, []);
  const aoClicarDuasVezes = (e: MouseEvent) => {
    if ((e.target as Element).closest('button')) return;
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

  // A Câmera: com duas ligações (a segunda tocando ou em espera, também na consulta), só desliga; na conferência, nenhuma. Na
  // sala, só desliga enquanto ela está em espera (o cameraDaSalaDesativada).
  const camera = conferencia ? null : (
    <Botao
      rotulo={CAMERA}
      nome={video.camera ? DESLIGAR_A_CAMERA : LIGAR_A_CAMERA}
      icone={video.camera ? <IconVideo /> : <IconVideoOff />}
      aceso={video.camera}
      desligado={sala ? cameraDaSalaDesativada(top, video) : cameraDaLigacaoDesativada(l, video)}
      onClick={() => send({ cmd: 'camera', on: !video.camera })}
    />
  );

  if (sala) {
    const contaDeGente = pessoas(pessoasNaSala(sala));
    const adicionar = (numero: string, doContato: boolean) => {
      setPedido(false);
      send({ cmd: 'salaAdicionar', numero, ...(doContato ? { contato: true } : {}) });
    };
    // O NoWindows em toda a sala: no Windows, todo botão dela (o Tirar da sala, a barra, o painel e a pergunta) ignora o
    // segundo clique de um clique duplo.
    return (
      <NoWindows.Provider value={true}>
        <div
          role="main"
          aria-label={telaCheia ? 'Sala de vídeo, tela cheia' : 'Sala de vídeo, grande'}
          class={painelAberto ? 'grande grande-com-chat' : 'grande'}
          data-modo={telaCheia ? 'tela-cheia' : 'grande'}
        >
          <div class="grande-video grande-video-sala" ref={areaDoVideo} onDblClick={aoClicarDuasVezes}>
            <MosaicoDaSala state={state} sala={sala} linha={top} send={send} modo={telaCheia ? 'telaCheia' : 'grande'} />
            <div class="grande-sombra" aria-hidden="true" />
          </div>
          <p class="grande-etiqueta grande-etiqueta-sala">
            <span class="sala-et-nome">{SALA_DE_VIDEO}</span>
            <span class="sala-et-pessoas">{contaDeGente}</span>
            {tempo && <span class="sala-et-tempo">{tempo}</span>}
          </p>
          {video.camera && <VistaDeVideo vista="local" desenhar rotulo={SUA_IMAGEM} espelhar class="grande-sua" />}
          <div class="grande-cartao">
            <CartaoDaOutra state={state} ligacao={l} send={send} now={now} />
          </div>
          {painelAberto && (
            <div class="grande-chat grande-adicionar">
              <div class="call-middle">
                <PainelDeAdicionar lista={listaDeContatos(contatos, daEmpresa).todas} onAdicionar={adicionar} onCancel={() => setPedido(false)} />
              </div>
            </div>
          )}
          {sala.cheia && (
            <span id="sala-cheia-grande" class="sr-only">
              {SALA_CHEIA}
            </span>
          )}
          <div class="grande-barra">
            <Botao rotulo="Mudo" icone={l.muted ? <IconMicOff /> : <IconMic />} pressionado={l.muted} onClick={() => send({ cmd: 'mute', on: !l.muted })} />
            {camera}
            <Botao
              rotulo={ADICIONAR_PESSOA}
              icone={<IconAdicionarPessoa />}
              desligado={!pode}
              titulo={sala.cheia ? SALA_CHEIA : undefined}
              descritoPor={sala.cheia ? 'sala-cheia-grande' : undefined}
              onClick={() => setPedido(true)}
            />
            <Botao
              rotulo={telaCheia ? SAIR_DA_TELA_CHEIA : TELA_CHEIA}
              icone={telaCheia ? <IconExitFullscreen /> : <IconFullscreen />}
              onClick={alternarTela}
            />
            <Botao rotulo={DIMINUIR} icone={<IconShrink />} onClick={() => send({ cmd: 'videoWindow', modo: 'normal' })} />
            <Botao rotulo="Desligar" icone={<IconPhone class="ic-hang" />} perigo onClick={() => setPerguntando(true)} />
          </div>
          {perguntando && <EncerrarSala sala={sala} send={send} tocando={l.secondKind === 'ringing'} onFechar={() => setPerguntando(false)} />}
        </div>
      </NoWindows.Provider>
    );
  }

  return (
    <div class={chat?.aberto ? 'grande grande-com-chat' : 'grande'} data-modo={telaCheia ? 'tela-cheia' : 'grande'}>
      <div class="grande-video" ref={areaDoVideo} onDblClick={aoClicarDuasVezes}>
        <VistaDeVideo key={top.id} vista="remoto" desenhar={video.imagem && imagemDaLigacao(l, video)} rotulo={rotuloDoVideo(nome)} class="grande-remoto" />
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
