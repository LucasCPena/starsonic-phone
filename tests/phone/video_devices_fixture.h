#pragma once
// Apoio aos testes do motor do PJSIP com o vídeo que leem e mudam a lista de vídeo da PJSIP de verdade: o id de um
// dispositivo pelo nome, e a fábrica das câmeras de barras coloridas que sai e volta. Inclua depois do
// <pjsua-lib/pjsua.h>: os testes do motor do baresip não têm a PJSIP (eles incluem só o call_fixture.h).
#include <pjsua-lib/pjsua.h>

#if PJMEDIA_HAS_VIDEO
#include <string>

#include "test_support.h"

// A fábrica das câmeras de barras coloridas da PJSIP (PJMEDIA_VIDEO_DEV_HAS_CBAR_SRC, ligada no Linux dos testes).
// Nenhum cabeçalho da PJSIP a declara: ela só serve de chave para tirar a fábrica (pjmedia_vid_unregister_factory) e
// para registrá-la de novo.
extern "C" pjmedia_vid_dev_factory* pjmedia_cbar_factory(pj_pool_factory* poolFactory);

namespace phone_test {

// O id de agora do dispositivo com esse nome (e a direção) na lista de vídeo da PJSIP, ou PJMEDIA_VID_INVALID_DEV.
inline pjmedia_vid_dev_index FindDevice(const std::string& name, pjmedia_dir dir) {
    for (unsigned id = 0; id < pjmedia_vid_dev_count(); ++id) {
        pjmedia_vid_dev_info info;
        if (pjmedia_vid_dev_get_info(static_cast<pjmedia_vid_dev_index>(id), &info) == PJ_SUCCESS &&
            name == info.name && (info.dir & dir) != 0) {
            return static_cast<pjmedia_vid_dev_index>(id);
        }
    }
    return PJMEDIA_VID_INVALID_DEV;
}

// Tira da PJSIP a fábrica das câmeras de barras coloridas, que vem antes do desenhista na lista: na próxima releitura,
// os ids dos dispositivos de depois dela mudam. Na thread do teste, que o motor já registrou no PJLIB (o SetAccount do
// Phone).
inline void RemoveColorbar() {
    REQUIRE(FindDevice("Colorbar generator", PJMEDIA_DIR_CAPTURE) != PJMEDIA_VID_INVALID_DEV);
    REQUIRE(pjmedia_vid_unregister_factory(&pjmedia_cbar_factory, nullptr) == PJ_SUCCESS);
}

// Registra de novo a fábrica das barras coloridas, agora no fim da lista (depois do desenhista e dos dispositivos da
// sala). Como no RemoveColorbar.
inline void AddColorbar() {
    REQUIRE(pjmedia_vid_register_factory(&pjmedia_cbar_factory, nullptr) == PJ_SUCCESS);
    REQUIRE(FindDevice("Colorbar generator", PJMEDIA_DIR_CAPTURE) != PJMEDIA_VID_INVALID_DEV);
}

}  // namespace phone_test
#endif
