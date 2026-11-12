#pragma once
// Os mosaicos da sala de vídeo em grupo por dentro (interno): os dispositivos de captura nossos na lista de vídeo da
// PJSIP e a loja das imagens, com o plano de cada mosaico.
//
// A fábrica "Starsonic sala" (o driver kOurVideoDriver) tem kRoomMaxGuests + 1 dispositivos de captura passivos, só
// I420 e de qualquer tamanho (o set_cap do FORMAT): o lugar 0, "Starsonic sala", é o mosaico de quem montou, e os
// lugares 1 a 5, "Starsonic sala 1" a "Starsonic sala 5", o de cada convidado. A ligação de um convidado manda o lugar
// dele no lugar da câmera (o CHANGE_CAP_DEV e o START_TRANSMIT de sempre); os lugares 1 a 5 têm a prévia nativa (o
// INPUT_PREVIEW), e a janela deles na pjsua não ganha uma porta do desenhista. A pjsua pede cada quadro na thread do
// relógio do vídeo dela, e o get_frame do stream monta (ComposeMosaic) o plano do lugar dele no tamanho do formato de
// agora do stream, com a última imagem de cada fonte do plano; as fontes fora do live ficam com o fundo.
//
// A loja das imagens é o FrameTap do desenhista: ela copia a última imagem de cada fonte do live (os convidados, pelo
// id da ligação, e a nossa câmera, o kHostTile). A trava dela é só dela e a última de todas: o desenhista a pega com a
// trava dele presa, a tabela troca o plano com o mutex_ dela preso, e a montagem a pega sozinha. Com ela presa, nada de
// PJSIP, do desenhista nem da tabela. Uma fonte que sai do live perde a imagem guardada: uma imagem velha nunca
// aparece. Sem o PJMEDIA_HAS_VIDEO (o Android), nada daqui existe.
#include <pjmedia/config.h>

#if PJMEDIA_HAS_VIDEO
#include <pjmedia-videodev/videodev.h>

#include <array>
#include <set>
#include <string>
#include <vector>

#include "Video.h"
#include "VideoRenderer.h"

namespace starsonic {

// Registra a fábrica da sala na PJSIP: depois do libInit e antes do RegisterVideoRenderer (o desenhista segue logo
// antes das câmeras que entram depois na lista, como antes da sala). false: a PJSIP a recusou ou algum lugar ficou de
// fora da lista (o motivo vai em *error).
bool RegisterRoomDevices(std::string* error);   // antes do RegisterVideoRenderer, no Create

// Os ids de agora dos dispositivos da sala na lista de vídeo da PJSIP, ou PJMEDIA_VID_INVALID_DEV.
struct RoomDeviceIds {
    RoomDeviceIds() { seats.fill(PJMEDIA_VID_INVALID_DEV); }
    pjmedia_vid_dev_index host = PJMEDIA_VID_INVALID_DEV;     // "Starsonic sala"
    std::array<pjmedia_vid_dev_index, kRoomMaxGuests> seats;   // "Starsonic sala 1" a "5"
};

// Pelo nome: os ids mudam a cada releitura da lista (pjmedia_vid_dev_refresh).
RoomDeviceIds FindRoomDevices();

// O que cada mosaico mostra.
struct RoomPlan {
    std::vector<int> host;                                // os convidados no mosaico de quem montou, em ordem
    std::array<std::vector<int>, kRoomMaxGuests> seats;   // o GuestTiles de cada lugar (vazio: livre)
    std::set<int> live;                                   // as fontes cuja imagem vale; as outras ficam com o fundo
};

bool operator==(const RoomPlan& a, const RoomPlan& b);

// O plano novo vale para os próximos quadros; a loja esquece a imagem das fontes que saem do live.
void SetRoomPlan(const RoomPlan& plan);

// A loja das imagens, para o SetRendererTap. Ela vive até o fim do processo.
FrameTap* RoomFrameStore();

}  // namespace starsonic
#endif
