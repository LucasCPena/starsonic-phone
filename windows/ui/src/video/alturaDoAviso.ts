// A altura do aviso do canto (aviso.html): a janela é do executável, e a página diz de quanto ela precisa (o
// `noticeHeight`, que o núcleo aceita de 168 a 480). As três alturas são as do CSS do aviso: o de voz tem 150 px de
// conteúdo na janela de 168; o Atender com vídeo é uma segunda linha (10 + 44); e a imagem do porteiro soma 194 + 14.
import type { AppState, CallCard } from '../state';
import { oferecerAtenderComVideo, videoDe } from './estado';

export const ALTURA_DO_AVISO = { voz: 168, video: 222, porteiro: 430 } as const;

/** Sem ligação tocando: 168; o porteiro com a imagem (`cedo`): 430; o que oferece vídeo, com o vídeo do app ligado e sem outra ligação: 222. */
export function alturaDoAviso(state: AppState, card: CallCard | null): number {
  if (!card) return ALTURA_DO_AVISO.voz;
  const video = videoDe(state, card);
  if (video.cedo) return ALTURA_DO_AVISO.porteiro;
  if (oferecerAtenderComVideo(state, card)) return ALTURA_DO_AVISO.video;
  return ALTURA_DO_AVISO.voz;
}
