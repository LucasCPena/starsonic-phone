// O aviso de ligação recebida: a janela de 380 de largura que o executável mostra no canto da tela (168 de altura; 222
// com o Atender com vídeo, 430 com a imagem do porteiro: a página pede o `noticeHeight`), sempre por cima e
// sem tomar o foco, quando uma ligação toca com a janela principal fora da frente (spec da W1, 4.1 e 7.2) e
// (0.3.0-rc.2), com ela na frente, quando um Porteiro toca como a segunda ligação com a imagem dele chegando (o
// `video.cedo`).
// Usa a mesma ponte da janela principal: recebe o mesmo `state` e manda `answer`/`reject` (o executável traz a
// janela principal para a frente no Atender). Mostra a que toca: a de cima (uma recebida) ou a segunda. Sem
// nenhuma tocando, fica vazio (o executável esconde a janela). O toque é da janela principal: o aviso não toca.
// Com a imagem do porteiro (`video.cedo`), a vista `porteiro` fica em cima, pela memória da página `aviso`, também com
// outra ligação em andamento (a exceção do porteiro: a imagem dele chega com outra ligação; o Atender com vídeo, não).
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createBridge } from './bridge';
import { contactNumberLine, initials, nameOrNumber } from './format';
import { VistaDeVideo } from './components/VistaDeVideo';
import { IconPhone, IconVideo } from './icons';
import type { AppState, CallCard } from './state';
import { ALTURA_DO_AVISO, alturaDoAviso } from './video/alturaDoAviso';
import { oferecerAtenderComVideo, videoDe } from './video/estado';
import { ATENDER_COM_VIDEO, rotuloDoVideo } from './video/textos';
import { criarVideoDaPagina, VideoContexto } from './video/vistas';

const bridge = createBridge();
// As vistas de vídeo desta página (só o `porteiro`); o núcleo cria a memória quando ela aparece no `videoViews`.
const videoDaPagina = criarVideoDaPagina(bridge, 'aviso');
// (0.2.0, R39, como na janela principal) Um arquivo arrastado para o aviso nunca navega, em lugar nenhum dele: sem
// isto, o WebView2 abriria o file:// do arquivo (e o núcleo gravaria o caminho dele no diagnóstico). Um texto
// arrastado fica com o navegador.
for (const tipo of ['dragover', 'drop'] as const) {
  document.addEventListener(tipo, (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
}

/** A ligação que toca agora (a conferência nunca tem uma segunda tocando). */
function ringingCard(state: AppState): CallCard | null {
  const l = state.ligacao;
  if (!l) return null;
  if (l.top.phase === 'ringing') return l.top;
  if (!l.conference && l.secondKind === 'ringing' && l.second) return l.second;
  return null;
}

function Aviso() {
  const [state, setState] = useState<AppState | null>(null);
  const [reinstalar, setReinstalar] = useState(false);

  useEffect(() => {
    bridge.onVersionMismatch(() => setReinstalar(true));
    const parar = bridge.subscribe((msg) => {
      if (msg.type === 'state') setState(msg.state);
      // O `ring` e o `toast` são da janela principal.
    });
    bridge.send({ cmd: 'ready' });
    return parar;
  }, []);

  useEffect(() => {
    if (state) document.body.dataset.pronto = '1';
  }, [state !== null]);

  const card = state ? ringingCard(state) : null;
  // A altura que o aviso pede: no primeiro desenho e a cada mudança (sem ninguém tocando, 168: o executável guarda a
  // última, mesmo com o aviso escondido).
  const altura = state && card ? alturaDoAviso(state, card) : ALTURA_DO_AVISO.voz;
  useEffect(() => {
    bridge.send({ cmd: 'noticeHeight', altura });
  }, [altura]);

  if (!bridge.available || reinstalar) {
    return (
      <div class="aviso aviso-erro" role="alert">
        {reinstalar ? 'Reinstale o Starsonic Phone.' : 'Não foi possível iniciar a interface. Reinstale o Starsonic Phone.'}
      </div>
    );
  }
  if (!state || !card) return <div class="aviso aviso-vazio" />;
  const conta = state.conta ? state.conta.nome || state.conta.ramal : '';
  const nome = nameOrNumber(card);
  const video = videoDe(state, card);
  const atenderComVideo = oferecerAtenderComVideo(state, card);
  return (
    <div class="aviso" role="alertdialog" aria-label={`Ligação recebida de ${nome}`}>
      {video.cedo && <VistaDeVideo key={card.id} vista="porteiro" desenhar={video.cedo} rotulo={rotuloDoVideo(nome)} class="aviso-imagem" />}
      <div class="aviso-quem">
        <span class="avatar aviso-avatar" aria-hidden="true">
          {card.name ? initials(card.name) : <IconPhone size="sm" />}
        </span>
        <div class="aviso-texto">
          <span class="eyebrow">{conta ? `Ligação recebida · ${conta}` : 'Ligação recebida'}</span>
          <span class="aviso-nome">{nome}</span>
          {card.name && <span class="aviso-sub">{contactNumberLine(card.number)}</span>}
        </div>
      </div>
      <div class="aviso-botoes">
        <button type="button" class="btn aviso-recusar" onClick={() => bridge.send({ cmd: 'reject' })}>
          <IconPhone size="sm" class="ic-hang" />
          Recusar
        </button>
        <button type="button" class="btn btn-cyan" onClick={() => bridge.send({ cmd: 'answer' })}>
          <IconPhone size="sm" />
          Atender
        </button>
        {atenderComVideo && (
          <button type="button" class="btn aviso-video" onClick={() => bridge.send({ cmd: 'answer', video: true })}>
            <IconVideo size="sm" />
            {ATENDER_COM_VIDEO}
          </button>
        )}
      </div>
    </div>
  );
}

render(
  <VideoContexto.Provider value={videoDaPagina}>
    <Aviso />
  </VideoContexto.Provider>,
  document.getElementById('aviso')!,
);
