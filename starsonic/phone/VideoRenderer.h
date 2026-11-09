#pragma once
// O desenhista nosso (interno): o dispositivo de vídeo de saída "Starsonic" da PJSIP, uma pjmedia_vid_dev_factory com
// um dispositivo só, que recebe os quadros I420 das janelas da pjsua (as que chegam de cada ligação e a da prévia da
// câmera) e os entrega ao FrameSink do motor. Sem um dispositivo de saída a pjsua não cria essas janelas (o SDL e o
// desenhista da DirectShow ficam de fora da PJSIP), e a ligação que negocia o vídeo cai com 488 ("Unable to create
// media session").
//
// Cada janela da pjsua é um stream do desenhista. O stream põe o próprio endereço na janela dela (a capacidade
// OUTPUT_WINDOW: o hwnd do pjsua_vid_win_get_info), e o motor diz de quem são os quadros dele pelo BindRendererStream:
// o id da ligação ou o kLocalFrames, a prévia. Um stream sem o BindRendererStream, parado ou com um quadro de outro
// tamanho (a troca ainda a caminho) não entrega nada; a janela escondida da pjsua entrega do mesmo jeito.
//
// A trava do desenhista (uma só, de todos os streams) fica presa durante a entrega de cada quadro: o SetRendererSink
// espera a entrega em andamento, e ao voltar nenhum quadro chega ao sink antigo. Com ela presa, o desenhista só chama o
// RemoteFrameGate e o sink. Sem o PJMEDIA_HAS_VIDEO (o Android), nada daqui existe.
#include <pjmedia/config.h>

#include <string>

#include "Video.h"

#if PJMEDIA_HAS_VIDEO
#include <pjmedia-videodev/videodev.h>

namespace starsonic {

// O id dos quadros da prévia da câmera (OnLocalFrame) no BindRendererStream; os outros ids são os das ligações.
const int kLocalFrames = -1;

// Quem diz se o quadro de uma ligação sai (o motor). Implementado fora daqui.
class RemoteFrameGate {
public:
    // Na thread que entrega o quadro (a do relógio do vídeo da pjsua), com a trava do desenhista presa: chegou um
    // quadro da ligação callId, que sai para o sink só com true (false: a ligação está pausada). Também sem sink: o
    // motor acompanha a imagem que chega. Não pode chamar o desenhista nem esperar por outra thread.
    virtual bool OnRemoteFrameArrived(int callId) = 0;

protected:
    ~RemoteFrameGate() {}
};

// Registra o desenhista na PJSIP: depois do libInit (com o vídeo da PJSIP de pé) e antes das contas. Devolve o id
// dele na lista de vídeo da PJSIP (o defaultRenderDevice das contas), ou PJMEDIA_VID_INVALID_DEV se a PJSIP o recusou
// (o motivo vai em *error). O id vale até a lista ser relida (pjmedia_vid_dev_refresh): ver FindVideoRenderer.
pjmedia_vid_dev_index RegisterVideoRenderer(std::string* error);

// O id de agora do desenhista na lista de vídeo da PJSIP (pelo nome), ou PJMEDIA_VID_INVALID_DEV.
pjmedia_vid_dev_index FindVideoRenderer();

// Os quadros do stream handle (o endereço que ele dá pela capacidade OUTPUT_WINDOW) passam a sair com o id callId, ou
// pelo OnLocalFrame com o kLocalFrames. Um handle que não é de um stream vivo do desenhista não muda nada.
void BindRendererStream(void* handle, int callId);

// Os streams ligados a callId deixam de entregar (a ligação acabou).
void UnbindRendererCall(int callId);

// O sink dos quadros; nullptr descarta. Síncrono: ao voltar, nenhum quadro chega ao sink antigo. Não pode ser chamado
// de dentro do sink nem do gate.
void SetRendererSink(FrameSink* sink);

// Quem decide os quadros das ligações (o motor, antes do primeiro quadro), ou nullptr: com nullptr, todos saem.
void SetRendererGate(RemoteFrameGate* gate);

}  // namespace starsonic
#endif
