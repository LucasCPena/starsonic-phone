// O vídeo no estado (docs/ponte-windows.md, "Vídeo (0.3.0)"): a interface lê o vídeo só por aqui. No iPhone, ou num estado
// sem o campo (montado à mão nos testes de antes), o vídeo é o neutro: nada de vídeo aparece.
import { isIos } from '../plataforma';
import type { AppState, CallCard, CallVideo, VideoSettings } from '../state';

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
