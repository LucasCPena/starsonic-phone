#pragma once
// O desenhista nosso (interno): o dispositivo de vídeo de saída "Starsonic" da PJSIP, uma pjmedia_vid_dev_factory com
// um dispositivo só, que recebe os quadros I420 das janelas da pjsua: os que chegam de cada ligação e os da prévia da
// câmera. Sem um dispositivo de saída a pjsua não cria essas janelas (o SDL e o desenhista da DirectShow ficam de fora
// da PJSIP), e a ligação que negocia o vídeo cai com 488 ("Unable to create media session"). Por enquanto os quadros
// são descartados. Sem o PJMEDIA_HAS_VIDEO (o Android), nada daqui existe.
#include <pjmedia/config.h>

#include <string>

#if PJMEDIA_HAS_VIDEO
#include <pjmedia-videodev/videodev.h>

namespace starsonic {

// Registra o desenhista na PJSIP: depois do libInit (com o vídeo da PJSIP de pé) e antes das contas. Devolve o id
// dele na lista de vídeo da PJSIP (o defaultRenderDevice das contas), ou PJMEDIA_VID_INVALID_DEV se a PJSIP o recusou
// (o motivo vai em *error). O id vale até a lista ser relida (pjmedia_vid_dev_refresh).
pjmedia_vid_dev_index RegisterVideoRenderer(std::string* error);

}  // namespace starsonic
#endif
