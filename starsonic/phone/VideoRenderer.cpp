#include "VideoRenderer.h"

#if PJMEDIA_HAS_VIDEO

#include <pj/pool.h>
#include <pj/string.h>
#include <pjmedia-videodev/videodev_imp.h>
#include <pjmedia/errno.h>
#include <pjmedia/format.h>

#include <algorithm>
#include <cstring>
#include <mutex>
#include <vector>

namespace starsonic {
namespace {

// O nome do dispositivo na lista de vídeo da PJSIP (o driver é o kOurVideoDriver, o mesmo da sala).
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

// Uma janela da pjsua. Do param em diante, só com a trava do desenhista.
struct RendererStream {
    pjmedia_vid_dev_stream base;
    pj_pool_t* pool;
    pjmedia_vid_dev_param param;   // o formato de agora (o set_cap troca o tamanho) e a janela: o próprio endereço
    bool running;                  // entre o start e o stop
    bool bound;                    // o BindRendererStream já disse de quem são os quadros
    int callId;                    // a ligação dos quadros, ou kLocalFrames (a prévia)
};

// O que os streams dividem com o motor: o sink, o gate, o tap e os streams vivos (só o handle de um deles vale no
// BindRendererStream). A trava fica presa durante a entrega de cada quadro.
struct Hub {
    std::mutex mutex;
    FrameSink* sink = nullptr;
    RemoteFrameGate* gate = nullptr;
    FrameTap* tap = nullptr;
    std::vector<RendererStream*> streams;
};

Hub& TheHub() {
    static Hub hub;
    return hub;
}

RendererFactory* FactoryOf(pjmedia_vid_dev_factory* factory) { return reinterpret_cast<RendererFactory*>(factory); }
RendererStream* StreamOf(pjmedia_vid_dev_stream* stream) { return reinterpret_cast<RendererStream*>(stream); }

// Um formato que o desenhista desenha: o I420, com largura e altura.
bool IsI420(const pjmedia_format& format) {
    return format.id == PJMEDIA_FORMAT_I420 && format.type == PJMEDIA_TYPE_VIDEO &&
           format.detail_type == PJMEDIA_FORMAT_DETAIL_VIDEO && format.det.vid.size.w > 0 && format.det.vid.size.h > 0;
}

pj_status_t StreamGetParam(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_param* param) {
    std::lock_guard<std::mutex> lock(TheHub().mutex);
    *param = StreamOf(stream)->param;
    return PJ_SUCCESS;
}

pj_status_t StreamGetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, void* value) {
    std::lock_guard<std::mutex> lock(TheHub().mutex);
    const RendererStream* renderer = StreamOf(stream);
    switch (cap) {
        case PJMEDIA_VID_DEV_CAP_FORMAT:
            pjmedia_format_copy(static_cast<pjmedia_format*>(value), &renderer->param.fmt);
            return PJ_SUCCESS;
        case PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW:
            *static_cast<pjmedia_vid_dev_hwnd*>(value) = renderer->param.window;
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

// O formato novo (outro tamanho: o PJMEDIA_EVENT_FMT_CHANGED que a porta da pjsua aplica aqui) vale para os próximos
// quadros. A janela escondida ou não e os flags dela só ficam guardados: não há janela, e a escondida também entrega.
// A janela é o próprio stream: outra não serve.
pj_status_t StreamSetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, const void* value) {
    std::lock_guard<std::mutex> lock(TheHub().mutex);
    RendererStream* renderer = StreamOf(stream);
    switch (cap) {
        case PJMEDIA_VID_DEV_CAP_FORMAT: {
            const pjmedia_format* format = static_cast<const pjmedia_format*>(value);
            if (!IsI420(*format)) return PJMEDIA_EVID_BADFORMAT;
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

pj_status_t StreamStart(pjmedia_vid_dev_stream* stream) {
    std::lock_guard<std::mutex> lock(TheHub().mutex);
    StreamOf(stream)->running = true;
    return PJ_SUCCESS;
}

// Na thread do relógio do vídeo da pjsua (ou na que chamou a pjmedia): o quadro I420 vai ao tap e ao sink, com a trava
// presa. Sem buffer é o "batimento" da pjsua, sem quadro.
pj_status_t StreamPutFrame(pjmedia_vid_dev_stream* stream, const pjmedia_frame* frame) {
    if (!frame || !frame->buf || frame->size == 0) return PJ_SUCCESS;
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    const RendererStream* renderer = StreamOf(stream);
    if (!renderer->running || !renderer->bound) return PJ_SUCCESS;
    // Os planos pelo tamanho de agora; um quadro de outro tamanho (a troca ainda a caminho) não é lido.
    const pjmedia_video_format_info* info = pjmedia_get_video_format_info(nullptr, PJMEDIA_FORMAT_I420);
    pjmedia_video_apply_fmt_param planes;
    pj_bzero(&planes, sizeof(planes));
    planes.size = renderer->param.fmt.det.vid.size;
    planes.buffer = static_cast<pj_uint8_t*>(frame->buf);
    if (!info || info->apply_fmt(info, &planes) != PJ_SUCCESS || planes.framebytes != frame->size) {
        return PJ_SUCCESS;
    }
    const int callId = renderer->callId;
    if (callId != kLocalFrames && hub.gate && !hub.gate->OnRemoteFrameArrived(callId)) return PJ_SUCCESS;
    if (!hub.tap && !hub.sink) return PJ_SUCCESS;
    I420Frame image;
    image.width = static_cast<int>(planes.size.w);
    image.height = static_cast<int>(planes.size.h);
    image.y = planes.planes[0];
    image.yStride = planes.strides[0];
    image.u = planes.planes[1];
    image.uStride = planes.strides[1];
    image.v = planes.planes[2];
    image.vStride = planes.strides[2];
    // A loja da sala guarda a imagem também sem sink: os mosaicos não dependem de o app desenhar.
    if (hub.tap) {
        try {
            hub.tap->OnFrame(callId, image);
        } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        }
    }
    if (!hub.sink) return PJ_SUCCESS;
    try {
        if (callId == kLocalFrames) {
            hub.sink->OnLocalFrame(image);
        } else {
            hub.sink->OnRemoteFrame(callId, image);
        }
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
    return PJ_SUCCESS;
}

pj_status_t StreamStop(pjmedia_vid_dev_stream* stream) {
    std::lock_guard<std::mutex> lock(TheHub().mutex);
    StreamOf(stream)->running = false;
    return PJ_SUCCESS;
}

pj_status_t StreamDestroy(pjmedia_vid_dev_stream* stream) {
    RendererStream* renderer = StreamOf(stream);
    {
        Hub& hub = TheHub();
        std::lock_guard<std::mutex> lock(hub.mutex);
        hub.streams.erase(std::remove(hub.streams.begin(), hub.streams.end(), renderer), hub.streams.end());
    }
    pj_pool_release(renderer->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

pjmedia_vid_dev_stream_op kStreamOps = {
    &StreamGetParam, &StreamGetCap, &StreamSetCap, &StreamStart, nullptr, &StreamPutFrame, &StreamStop, &StreamDestroy};

pj_status_t FactoryInit(pjmedia_vid_dev_factory* factory) {
    pjmedia_vid_dev_info& info = FactoryOf(factory)->info;
    pj_bzero(&info, sizeof(info));
    pj_ansi_strxcpy(info.name, kRendererName, sizeof(info.name));
    pj_ansi_strxcpy(info.driver, kOurVideoDriver, sizeof(info.driver));
    info.dir = PJMEDIA_DIR_RENDER;
    info.has_callback = PJ_FALSE;
    info.caps = PJMEDIA_VID_DEV_CAP_FORMAT | PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW | PJMEDIA_VID_DEV_CAP_OUTPUT_HIDE |
                PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW_FLAGS;
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

// Uma janela da pjsua (uma ligação ou a prévia da câmera): só o I420, que a pjsua converte antes quando precisa. O
// stream nasce parado e sem dono (BindRendererStream).
pj_status_t FactoryCreateStream(pjmedia_vid_dev_factory* factory, pjmedia_vid_dev_param* param,
                                const pjmedia_vid_dev_cb*, void*, pjmedia_vid_dev_stream** stream) {
    if (param->dir != PJMEDIA_DIR_RENDER) return PJ_EINVAL;
    if (!IsI420(param->fmt)) return PJMEDIA_EVID_BADFORMAT;
    pj_pool_t* pool = pj_pool_create(FactoryOf(factory)->poolFactory, "starsonic-render", 512, 512, nullptr);
    if (!pool) return PJ_ENOMEM;
    RendererStream* renderer = PJ_POOL_ZALLOC_T(pool, RendererStream);
    renderer->pool = pool;
    renderer->param = *param;
    renderer->param.flags |= PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW;
    renderer->param.window.type = PJMEDIA_VID_DEV_HWND_TYPE_NONE;
    renderer->param.window.info.window = renderer;
    renderer->callId = kLocalFrames;
    renderer->base.op = &kStreamOps;
    {
        Hub& hub = TheHub();
        std::lock_guard<std::mutex> lock(hub.mutex);
        try {
            hub.streams.push_back(renderer);
        } catch (...) {
            pj_pool_release(pool);
            return PJ_ENOMEM;
        }
    }
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
    const pjmedia_vid_dev_index id = FindVideoRenderer();
    if (id == PJMEDIA_VID_INVALID_DEV && error) *error = "o desenhista nao apareceu na lista de video";
    return id;
}

pjmedia_vid_dev_index FindVideoRenderer() {
    const unsigned count = pjmedia_vid_dev_count();
    for (unsigned id = 0; id < count; ++id) {
        pjmedia_vid_dev_info info;
        if (pjmedia_vid_dev_get_info(static_cast<pjmedia_vid_dev_index>(id), &info) == PJ_SUCCESS &&
            std::strcmp(info.driver, kOurVideoDriver) == 0 && (info.dir & PJMEDIA_DIR_RENDER) != 0) {
            return static_cast<pjmedia_vid_dev_index>(id);
        }
    }
    return PJMEDIA_VID_INVALID_DEV;
}

void BindRendererStream(void* handle, int callId) {
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    for (RendererStream* renderer : hub.streams) {
        if (static_cast<void*>(renderer) != handle) continue;
        renderer->bound = true;
        renderer->callId = callId;
        return;
    }
}

void UnbindRendererCall(int callId) {
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    for (RendererStream* renderer : hub.streams) {
        if (renderer->bound && renderer->callId == callId) renderer->bound = false;
    }
}

void SetRendererSink(FrameSink* sink) {
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    hub.sink = sink;
}

void SetRendererGate(RemoteFrameGate* gate) {
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    hub.gate = gate;
}

void SetRendererTap(FrameTap* tap) {
    Hub& hub = TheHub();
    std::lock_guard<std::mutex> lock(hub.mutex);
    hub.tap = tap;
}

}  // namespace starsonic

#endif
