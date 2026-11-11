// O vídeo no estado (docs/ponte-windows.md, "Vídeo (0.3.0)"): a interface lê o vídeo só por aqui. No iPhone, ou num estado
// sem o campo (montado à mão nos testes de antes), o vídeo é o neutro: nada de vídeo aparece. (Task 4) A regra da Câmera,
// a mesma em toda tela que tem o botão. (Ruling 13) O vídeo que pausa com duas ligações e a regra da Câmera com elas, num
// lugar só: a tela da ligação e o grande leem daqui.
import { isIos } from '../plataforma';
import type { AppState, CallCard, CallState, CallVideo, VideoSettings } from '../state';

export const SEM_VIDEO: CallVideo = { oferece: false, ativo: false, imagem: false, camera: false, cedo: false };

export const VIDEO_DESLIGADO: VideoSettings = {
  ligado: false,
  cameras: [],
  camera: '',
  cameraDesconectada: false,
  teste: false,
  h264: { cartao: false, pessoa: false, situacao: 'desligado' },
  janela: 'normal',
};

/** As escolhas do vídeo do app (`VIDEO_DESLIGADO` no iPhone ou sem o campo). */
export function videoDoApp(state: AppState): VideoSettings {
  return isIos(state) || !state.video ? VIDEO_DESLIGADO : state.video;
}

/** O vídeo de uma ligação (`SEM_VIDEO` no iPhone ou sem o campo). */
export function videoDe(state: AppState, card: CallCard): CallVideo {
  return isIos(state) || !card.video ? SEM_VIDEO : card.video;
}

/**
 * O aviso do canto oferece o Atender com vídeo: a ligação que toca oferece vídeo, o vídeo do app está ligado e não há
 * outra ligação em andamento. Com duas ligações o vídeo pausa (spec 4.2), e um Atender com vídeo não cumpriria a
 * promessa (a câmera ligaria sozinha, só quando a outra terminasse). A segunda que toca também fica sem ele.
 */
export function oferecerAtenderComVideo(state: AppState, card: CallCard): boolean {
  return videoDoApp(state).ligado && videoDe(state, card).oferece && (state.ligacao?.second ?? null) === null;
}

/**
 * A regra da Câmera (a tela da ligação, o grande e a faixa da conversa): a câmera desligada só liga numa ligação
 * atendida (activeSinceMs > 0) e fora da espera; ligada, ela sempre desliga.
 */
export function cameraDesativada(card: CallCard, video: CallVideo): boolean {
  return !video.camera && (card.activeSinceMs <= 0 || card.held);
}

/**
 * (Ruling 13) A imagem da outra ponta pode ser desenhada: só numa ligação sozinha (spec do vídeo, 4.2). Com a segunda
 * tocando ou em espera (também na consulta) e na conferência (que sempre tem a segunda), o vídeo pausa: nada é desenhado,
 * na tela da ligação e no grande.
 */
export function imagemDaLigacao(l: CallState): boolean {
  return l.second === null;
}

/**
 * (Ruling 13) A Câmera desativada, na tela da ligação e no grande (na conferência, nenhuma Câmera): ligada, ela sempre
 * desliga; desligada, ela não liga com duas ligações (a segunda tocando ou em espera, também na consulta, que tem o
 * cliente em espera) e, numa ligação sozinha, segue o cameraDesativada da de cima.
 */
export function cameraDaLigacaoDesativada(l: CallState, video: CallVideo): boolean {
  return !video.camera && (l.second !== null || cameraDesativada(l.top, video));
}
