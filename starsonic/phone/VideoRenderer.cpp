#include "VideoRenderer.h"

#if PJMEDIA_HAS_VIDEO

#include <pj/pool.h>
#include <pj/string.h>
#include <pjmedia-videodev/videodev_imp.h>
#include <pjmedia/errno.h>
#include <pjmedia/format.h>

#include <cstring>

namespace starsonic {
namespace {

// O nome do driver e do dispositivo na lista de vídeo da PJSIP.
const char kRendererName[] = "Starsonic";
// O formato que a fábrica anuncia (o I420 da libyuv; o tamanho é o de cada janela).
const unsigned kDefaultWidth = 640;
const unsigned kDefaultHeight = 480;
const unsigned kDefaultFps = 25;
const unsigned kClockRate = 90000;

// O primeiro campo de cada struct é o da PJSIP: ela só conhece esse, e o ponteiro dele é o da struct inteira.
struct RendererFactory {
    pjmedia_vid_dev_factory base;
    pj_pool_t* pool;
    pj_pool_factory* poolFactory;
    pjmedia_vid_dev_info info;
};

struct RendererStream {
    pjmedia_vid_dev_stream base;
    pj_pool_t* pool;
    pjmedia_vid_dev_param param;
};

RendererFactory* FactoryOf(pjmedia_vid_dev_factory* factory) { return reinterpret_cast<RendererFactory*>(factory); }
RendererStream* StreamOf(pjmedia_vid_dev_stream* stream) { return reinterpret_cast<RendererStream*>(stream); }

pj_status_t StreamGetParam(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_param* param) {
    *param = StreamOf(stream)->param;
    return PJ_SUCCESS;
}

pj_status_t StreamGetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, void* value) {
    RendererStream* renderer = StreamOf(stream);
    switch (cap) {
        case PJMEDIA_VID_DEV_CAP_FORMAT:
            pjmedia_format_copy(static_cast<pjmedia_format*>(value), &renderer->param.fmt);
            return PJ_SUCCESS;
        case PJMEDIA_VID_DEV_CAP_OUTPUT_HIDE:
            *static_cast<pj_bool_t*>(value) = renderer->param.window_hide;
            return PJ_SUCCESS;
        case PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW_FLAGS:
            *static_cast<unsigned*>(value) = renderer->param.window_flags;
            return PJ_SUCCESS;
        default:
            return PJMEDIA_EVID_INVCAP;
    }
}

// A janela escondida ou não e os flags dela só ficam guardados: não há janela. O formato novo (outro tamanho) vale
// para os próximos quadros.
pj_status_t StreamSetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, const void* value) {
    RendererStream* renderer = StreamOf(stream);
    switch (cap) {
        case PJMEDIA_VID_DEV_CAP_FORMAT: {
            const pjmedia_format* format = static_cast<const pjmedia_format*>(value);
            if (format->id != PJMEDIA_FORMAT_I420) return PJMEDIA_EVID_BADFORMAT;
            pjmedia_format_copy(&renderer->param.fmt, format);
            return PJ_SUCCESS;
        }
        case PJMEDIA_VID_DEV_CAP_OUTPUT_HIDE:
            renderer->param.window_hide = *static_cast<const pj_bool_t*>(value);
            return PJ_SUCCESS;
        case PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW_FLAGS:
            renderer->param.window_flags = *static_cast<const unsigned*>(value);
            return PJ_SUCCESS;
        default:
            return PJMEDIA_EVID_INVCAP;
    }
}

pj_status_t StreamStart(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

// Na thread do relógio do vídeo da pjsua: o quadro I420 é descartado.
pj_status_t StreamPutFrame(pjmedia_vid_dev_stream*, const pjmedia_frame*) { return PJ_SUCCESS; }

pj_status_t StreamStop(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

pj_status_t StreamDestroy(pjmedia_vid_dev_stream* stream) {
    pj_pool_release(StreamOf(stream)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

pjmedia_vid_dev_stream_op kStreamOps = {
    &StreamGetParam, &StreamGetCap, &StreamSetCap, &StreamStart, nullptr, &StreamPutFrame, &StreamStop, &StreamDestroy};

pj_status_t FactoryInit(pjmedia_vid_dev_factory* factory) {
    pjmedia_vid_dev_info& info = FactoryOf(factory)->info;
    pj_bzero(&info, sizeof(info));
    pj_ansi_strxcpy(info.name, kRendererName, sizeof(info.name));
    pj_ansi_strxcpy(info.driver, kRendererName, sizeof(info.driver));
    info.dir = PJMEDIA_DIR_RENDER;
    info.has_callback = PJ_FALSE;
    info.caps = PJMEDIA_VID_DEV_CAP_FORMAT | PJMEDIA_VID_DEV_CAP_OUTPUT_HIDE | PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW_FLAGS;
    info.fmt_cnt = 1;
    pjmedia_format_init_video(&info.fmt[0], PJMEDIA_FORMAT_I420, kDefaultWidth, kDefaultHeight, kDefaultFps, 1);
    return PJ_SUCCESS;
}

pj_status_t FactoryDestroy(pjmedia_vid_dev_factory* factory) {
    pj_pool_release(FactoryOf(factory)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

unsigned FactoryCount(pjmedia_vid_dev_factory*) { return 1; }

pj_status_t FactoryInfo(pjmedia_vid_dev_factory* factory, unsigned index, pjmedia_vid_dev_info* info) {
    if (index != 0) return PJMEDIA_EVID_INVDEV;
    *info = FactoryOf(factory)->info;
    return PJ_SUCCESS;
}

pj_status_t FactoryDefaultParam(pj_pool_t*, pjmedia_vid_dev_factory* factory, unsigned index,
                                pjmedia_vid_dev_param* param) {
    if (index != 0) return PJMEDIA_EVID_INVDEV;
    pj_bzero(param, sizeof(*param));
    param->dir = PJMEDIA_DIR_RENDER;
    param->cap_id = PJMEDIA_VID_INVALID_DEV;
    param->rend_id = static_cast<pjmedia_vid_dev_index>(index);
    param->flags = PJMEDIA_VID_DEV_CAP_FORMAT;
    param->clock_rate = kClockRate;
    pjmedia_format_copy(&param->fmt, &FactoryOf(factory)->info.fmt[0]);
    return PJ_SUCCESS;
}

// Uma janela da pjsua (uma ligação ou a prévia da câmera): só o I420, que a pjsua converte antes quando precisa.
pj_status_t FactoryCreateStream(pjmedia_vid_dev_factory* factory, pjmedia_vid_dev_param* param,
                                const pjmedia_vid_dev_cb*, void*, pjmedia_vid_dev_stream** stream) {
    if (param->dir != PJMEDIA_DIR_RENDER) return PJ_EINVAL;
    if (param->fmt.id != PJMEDIA_FORMAT_I420) return PJMEDIA_EVID_BADFORMAT;
    pj_pool_t* pool = pj_pool_create(FactoryOf(factory)->poolFactory, "starsonic-render", 512, 512, nullptr);
    if (!pool) return PJ_ENOMEM;
    RendererStream* renderer = PJ_POOL_ZALLOC_T(pool, RendererStream);
    renderer->pool = pool;
    renderer->param = *param;
    renderer->base.op = &kStreamOps;
    *stream = &renderer->base;
    return PJ_SUCCESS;
}

pj_status_t FactoryRefresh(pjmedia_vid_dev_factory*) { return PJ_SUCCESS; }

pjmedia_vid_dev_factory_op kFactoryOps = {&FactoryInit, &FactoryDestroy, &FactoryCount, &FactoryInfo,
                                          &FactoryDefaultParam, &FactoryCreateStream, &FactoryRefresh};

// Chamada pela PJSIP no registro (pjmedia_vid_register_factory), com o pool do vídeo dela.
pjmedia_vid_dev_factory* CreateFactory(pj_pool_factory* poolFactory) {
    pj_pool_t* pool = pj_pool_create(poolFactory, "starsonic-renderer", 512, 512, nullptr);
    if (!pool) return nullptr;
    RendererFactory* factory = PJ_POOL_ZALLOC_T(pool, RendererFactory);
    factory->pool = pool;
    factory->poolFactory = poolFactory;
    factory->base.op = &kFactoryOps;
    return &factory->base;
}

}  // namespace

pjmedia_vid_dev_index RegisterVideoRenderer(std::string* error) {
    const pj_status_t status = pjmedia_vid_register_factory(&CreateFactory, nullptr);
    if (status != PJ_SUCCESS) {
        char text[PJ_ERR_MSG_SIZE];
        pj_strerror(status, text, sizeof(text));
        if (error) *error = text;
        return PJMEDIA_VID_INVALID_DEV;
    }
    // O id dele na lista de agora: a PJSIP põe os dispositivos de cada fábrica nova no fim.
    const unsigned count = pjmedia_vid_dev_count();
    for (unsigned id = 0; id < count; ++id) {
        pjmedia_vid_dev_info info;
        if (pjmedia_vid_dev_get_info(static_cast<pjmedia_vid_dev_index>(id), &info) == PJ_SUCCESS &&
            std::strcmp(info.driver, kRendererName) == 0 && (info.dir & PJMEDIA_DIR_RENDER) != 0) {
            return static_cast<pjmedia_vid_dev_index>(id);
        }
    }
    if (error) *error = "o desenhista nao apareceu na lista de video";
    return PJMEDIA_VID_INVALID_DEV;
}

}  // namespace starsonic

#endif
