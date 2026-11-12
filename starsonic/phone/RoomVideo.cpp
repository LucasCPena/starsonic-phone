#include "RoomVideo.h"

#if PJMEDIA_HAS_VIDEO

#include <pj/pool.h>
#include <pj/string.h>
#include <pjmedia-videodev/videodev_imp.h>
#include <pjmedia/errno.h>
#include <pjmedia/format.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <map>
#include <mutex>

#include "RoomMosaic.h"

namespace starsonic {
namespace {

// Os dispositivos da fábrica: o lugar 0 (o mosaico de quem montou) e um por convidado.
const unsigned kRoomDevices = kRoomMaxGuests + 1;
// O nome do lugar 0; o de um convidado leva o número do lugar depois.
const char kRoomDeviceName[] = "Starsonic sala";
// Os tamanhos que cada lugar anuncia: o mosaico de quem montou e as imagens das qualidades. A janela da pjsua abre a
// captura no tamanho anunciado mais perto do pedido e converte o resto; com estes, o mosaico já sai no tamanho de cada
// codificador.
struct Size {
    unsigned width;
    unsigned height;
};
const Size kRoomSizes[] = {{1280, 720}, {640, 480}, {320, 240}};
const unsigned kDefaultFps = 25;
const unsigned kClockRate = 90000;

// Copia um plano columns x rows (com o passo stride) para copy, sem o passo.
void CopyPlane(const uint8_t* plane, int stride, int columns, int rows, std::vector<uint8_t>* copy) {
    copy->resize(static_cast<size_t>(columns) * rows);
    for (int row = 0; row < rows; ++row) {
        std::memcpy(copy->data() + static_cast<size_t>(row) * columns, plane + static_cast<size_t>(row) * stride,
                    static_cast<size_t>(columns));
    }
}

// A cópia de um quadro, com os planos sem os passos.
struct Image {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> y, u, v;

    void Copy(const I420Frame& frame) {
        width = frame.width;
        height = frame.height;
        const int chromaWidth = (width + 1) / 2, chromaHeight = (height + 1) / 2;
        CopyPlane(frame.y, frame.yStride, width, height, &y);
        CopyPlane(frame.u, frame.uStride, chromaWidth, chromaHeight, &u);
        CopyPlane(frame.v, frame.vStride, chromaWidth, chromaHeight, &v);
    }

    I420Frame View() const {
        I420Frame frame;
        frame.width = width;
        frame.height = height;
        frame.y = y.data();
        frame.yStride = width;
        frame.u = u.data();
        frame.uStride = (width + 1) / 2;
        frame.v = v.data();
        frame.vStride = (width + 1) / 2;
        return frame;
    }
};

// A loja das imagens (ver o topo do RoomVideo.h). Tudo com a trava dela, que é a última de todas.
struct Store final : FrameTap {
    std::mutex mutex;
    RoomPlan plan;
    std::map<int, Image> images;   // a última imagem de cada fonte do live que já chegou

    // Na thread que entrega o quadro, com a trava do desenhista presa.
    void OnFrame(int source, const I420Frame& frame) override {
        std::lock_guard<std::mutex> lock(mutex);
        if (plan.live.count(source) == 0 || frame.width <= 0 || frame.height <= 0 || !frame.y || !frame.u ||
            !frame.v) {
            return;
        }
        images[source].Copy(frame);
    }

    // Com a trava presa: o mosaico do lugar seat (0: o de quem montou) em out, com o fundo no lugar das fontes sem
    // imagem.
    void Compose(unsigned seat, const I420Target& out) {
        static const std::vector<int> kNone;
        const std::vector<int>& sources = seat == 0 ? plan.host : seat < kRoomDevices ? plan.seats[seat - 1] : kNone;
        std::vector<I420Frame> views(sources.size());
        std::vector<const I420Frame*> tiles(sources.size(), nullptr);
        for (size_t index = 0; index < sources.size(); ++index) {
            const auto found = images.find(sources[index]);
            if (found == images.end()) continue;
            views[index] = found->second.View();
            tiles[index] = &views[index];
        }
        ComposeMosaic(tiles, out);
    }
};

Store& TheStore() {
    static Store store;
    return store;
}

// O primeiro campo de cada struct é o da PJSIP: ela só conhece esse, e o ponteiro dele é o da struct inteira.
struct RoomFactory {
    pjmedia_vid_dev_factory base;
    pj_pool_t* pool;
    pj_pool_factory* poolFactory;
    pjmedia_vid_dev_info info[kRoomDevices];
};

// A captura de um lugar, que a pjsua abre na janela dele. O param, com a trava da loja.
struct SeatStream {
    pjmedia_vid_dev_stream base;
    pj_pool_t* pool;
    pjmedia_vid_dev_param param;   // o formato de agora (o set_cap troca o tamanho)
    unsigned seat;                 // 0: o mosaico de quem montou; de 1 a kRoomMaxGuests: o de um convidado
    pj_uint64_t timestamp;         // o do próximo quadro (só o get_frame, na thread do relógio da pjsua)
};

RoomFactory* FactoryOf(pjmedia_vid_dev_factory* factory) { return reinterpret_cast<RoomFactory*>(factory); }
SeatStream* SeatOf(pjmedia_vid_dev_stream* stream) { return reinterpret_cast<SeatStream*>(stream); }

// O nome do lugar seat na lista de vídeo.
void SeatName(unsigned seat, char* name, size_t size) {
    if (seat == 0) {
        pj_ansi_snprintf(name, size, "%s", kRoomDeviceName);
    } else {
        pj_ansi_snprintf(name, size, "%s %u", kRoomDeviceName, seat);
    }
}

// Um formato que o mosaico monta: o I420, com largura e altura.
bool IsI420(const pjmedia_format& format) {
    return format.id == PJMEDIA_FORMAT_I420 && format.type == PJMEDIA_TYPE_VIDEO &&
           format.detail_type == PJMEDIA_FORMAT_DETAIL_VIDEO && format.det.vid.size.w > 0 && format.det.vid.size.h > 0;
}

pj_status_t SeatGetParam(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_param* param) {
    std::lock_guard<std::mutex> lock(TheStore().mutex);
    *param = SeatOf(stream)->param;
    return PJ_SUCCESS;
}

pj_status_t SeatGetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, void* value) {
    if (cap != PJMEDIA_VID_DEV_CAP_FORMAT) return PJMEDIA_EVID_INVCAP;
    std::lock_guard<std::mutex> lock(TheStore().mutex);
    pjmedia_format_copy(static_cast<pjmedia_format*>(value), &SeatOf(stream)->param.fmt);
    return PJ_SUCCESS;
}

// O formato novo (outro tamanho) vale para os próximos quadros. A prévia nativa (a janela de um lugar de convidado) e a
// janela escondida ou não só são aceitas: não há janela, e o mosaico vai só para o codificador da ligação.
pj_status_t SeatSetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, const void* value) {
    switch (cap) {
        case PJMEDIA_VID_DEV_CAP_FORMAT: {
            const pjmedia_format* format = static_cast<const pjmedia_format*>(value);
            if (!IsI420(*format)) return PJMEDIA_EVID_BADFORMAT;
            std::lock_guard<std::mutex> lock(TheStore().mutex);
            pjmedia_format_copy(&SeatOf(stream)->param.fmt, format);
            return PJ_SUCCESS;
        }
        case PJMEDIA_VID_DEV_CAP_INPUT_PREVIEW:
            return SeatOf(stream)->seat > 0 ? PJ_SUCCESS : PJMEDIA_EVID_INVCAP;
        case PJMEDIA_VID_DEV_CAP_OUTPUT_HIDE:
        case PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW_FLAGS:
            return PJ_SUCCESS;
        default:
            return PJMEDIA_EVID_INVCAP;
    }
}

pj_status_t SeatStart(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

// Na thread do relógio do vídeo da pjsua (a captura é passiva: a pjsua pede cada quadro): o mosaico do lugar, no
// tamanho de agora do stream.
pj_status_t SeatGetFrame(pjmedia_vid_dev_stream* stream, pjmedia_frame* frame) {
    SeatStream* seat = SeatOf(stream);
    Store& store = TheStore();
    try {
        std::lock_guard<std::mutex> lock(store.mutex);
        const pjmedia_video_format_info* info = pjmedia_get_video_format_info(nullptr, PJMEDIA_FORMAT_I420);
        pjmedia_video_apply_fmt_param planes;
        pj_bzero(&planes, sizeof(planes));
        planes.size = seat->param.fmt.det.vid.size;
        planes.buffer = static_cast<pj_uint8_t*>(frame->buf);
        if (!info || info->apply_fmt(info, &planes) != PJ_SUCCESS) return PJMEDIA_EVID_BADFORMAT;
        if (!frame->buf || frame->size < planes.framebytes) return PJ_ETOOSMALL;
        I420Target out;
        out.width = static_cast<int>(planes.size.w);
        out.height = static_cast<int>(planes.size.h);
        out.y = planes.planes[0];
        out.yStride = planes.strides[0];
        out.u = planes.planes[1];
        out.uStride = planes.strides[1];
        out.v = planes.planes[2];
        out.vStride = planes.strides[2];
        store.Compose(seat->seat, out);
        const pjmedia_ratio& fps = seat->param.fmt.det.vid.fps;
        frame->type = PJMEDIA_FRAME_TYPE_VIDEO;
        frame->size = planes.framebytes;
        frame->bit_info = 0;
        frame->timestamp.u64 = seat->timestamp;
        const unsigned ticks =
            fps.num > 0 ? kClockRate * fps.denum / static_cast<unsigned>(fps.num) : kClockRate / kDefaultFps;
        seat->timestamp += ticks;
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        return PJ_ENOMEM;
    }
    return PJ_SUCCESS;
}

pj_status_t SeatStop(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

pj_status_t SeatDestroy(pjmedia_vid_dev_stream* stream) {
    pj_pool_release(SeatOf(stream)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

pjmedia_vid_dev_stream_op kSeatOps = {&SeatGetParam, &SeatGetCap, &SeatSetCap, &SeatStart,
                                      &SeatGetFrame, nullptr,      &SeatStop,   &SeatDestroy};

pj_status_t FactoryInit(pjmedia_vid_dev_factory* factory) {
    RoomFactory* room = FactoryOf(factory);
    for (unsigned seat = 0; seat < kRoomDevices; ++seat) {
        pjmedia_vid_dev_info& info = room->info[seat];
        pj_bzero(&info, sizeof(info));
        SeatName(seat, info.name, sizeof(info.name));
        pj_ansi_strxcpy(info.driver, kOurVideoDriver, sizeof(info.driver));
        info.dir = PJMEDIA_DIR_CAPTURE;
        info.has_callback = PJ_FALSE;
        info.caps = PJMEDIA_VID_DEV_CAP_FORMAT;
        if (seat > 0) info.caps |= PJMEDIA_VID_DEV_CAP_INPUT_PREVIEW;
        info.fmt_cnt = static_cast<unsigned>(PJ_ARRAY_SIZE(kRoomSizes));
        for (unsigned index = 0; index < info.fmt_cnt; ++index) {
            pjmedia_format_init_video(&info.fmt[index], PJMEDIA_FORMAT_I420, kRoomSizes[index].width,
                                      kRoomSizes[index].height, kDefaultFps, 1);
        }
    }
    return PJ_SUCCESS;
}

pj_status_t FactoryDestroy(pjmedia_vid_dev_factory* factory) {
    pj_pool_release(FactoryOf(factory)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

unsigned FactoryCount(pjmedia_vid_dev_factory*) { return kRoomDevices; }

pj_status_t FactoryInfo(pjmedia_vid_dev_factory* factory, unsigned index, pjmedia_vid_dev_info* info) {
    if (index >= kRoomDevices) return PJMEDIA_EVID_INVDEV;
    *info = FactoryOf(factory)->info[index];
    return PJ_SUCCESS;
}

pj_status_t FactoryDefaultParam(pj_pool_t*, pjmedia_vid_dev_factory* factory, unsigned index,
                                pjmedia_vid_dev_param* param) {
    if (index >= kRoomDevices) return PJMEDIA_EVID_INVDEV;
    pj_bzero(param, sizeof(*param));
    param->dir = PJMEDIA_DIR_CAPTURE;
    param->cap_id = static_cast<pjmedia_vid_dev_index>(index);
    param->rend_id = PJMEDIA_VID_INVALID_DEV;
    param->flags = PJMEDIA_VID_DEV_CAP_FORMAT;
    param->clock_rate = kClockRate;
    pjmedia_format_copy(&param->fmt, &FactoryOf(factory)->info[index].fmt[0]);
    return PJ_SUCCESS;
}

// A captura de um lugar: o cap_id já é o índice dele na fábrica (a pjmedia o traduz antes).
pj_status_t FactoryCreateStream(pjmedia_vid_dev_factory* factory, pjmedia_vid_dev_param* param,
                                const pjmedia_vid_dev_cb*, void*, pjmedia_vid_dev_stream** stream) {
    if (param->dir != PJMEDIA_DIR_CAPTURE || param->cap_id < 0 ||
        param->cap_id >= static_cast<pjmedia_vid_dev_index>(kRoomDevices)) {
        return PJ_EINVAL;
    }
    if (!IsI420(param->fmt)) return PJMEDIA_EVID_BADFORMAT;
    pj_pool_t* pool = pj_pool_create(FactoryOf(factory)->poolFactory, "starsonic-sala", 512, 512, nullptr);
    if (!pool) return PJ_ENOMEM;
    SeatStream* seat = PJ_POOL_ZALLOC_T(pool, SeatStream);
    seat->pool = pool;
    seat->param = *param;
    seat->seat = static_cast<unsigned>(param->cap_id);
    seat->base.op = &kSeatOps;
    *stream = &seat->base;
    return PJ_SUCCESS;
}

pj_status_t FactoryRefresh(pjmedia_vid_dev_factory*) { return PJ_SUCCESS; }

pjmedia_vid_dev_factory_op kFactoryOps = {&FactoryInit, &FactoryDestroy, &FactoryCount, &FactoryInfo,
                                          &FactoryDefaultParam, &FactoryCreateStream, &FactoryRefresh};

// Chamada pela PJSIP no registro (pjmedia_vid_register_factory), com o pool do vídeo dela.
pjmedia_vid_dev_factory* CreateFactory(pj_pool_factory* poolFactory) {
    pj_pool_t* pool = pj_pool_create(poolFactory, "starsonic-salas", 512, 512, nullptr);
    if (!pool) return nullptr;
    RoomFactory* factory = PJ_POOL_ZALLOC_T(pool, RoomFactory);
    factory->pool = pool;
    factory->poolFactory = poolFactory;
    factory->base.op = &kFactoryOps;
    return &factory->base;
}

}  // namespace

bool RegisterRoomDevices(std::string* error) {
    const pj_status_t status = pjmedia_vid_register_factory(&CreateFactory, nullptr);
    if (status != PJ_SUCCESS) {
        char text[PJ_ERR_MSG_SIZE];
        pj_strerror(status, text, sizeof(text));
        if (error) *error = text;
        return false;
    }
    const RoomDeviceIds ids = FindRoomDevices();
    const bool all = ids.host != PJMEDIA_VID_INVALID_DEV &&
                     std::none_of(ids.seats.begin(), ids.seats.end(),
                                  [](pjmedia_vid_dev_index id) { return id == PJMEDIA_VID_INVALID_DEV; });
    if (!all && error) *error = "os dispositivos da sala nao apareceram todos na lista de video";
    return all;
}

RoomDeviceIds FindRoomDevices() {
    RoomDeviceIds ids;
    const unsigned count = pjmedia_vid_dev_count();
    for (unsigned id = 0; id < count; ++id) {
        pjmedia_vid_dev_info info;
        const pjmedia_vid_dev_index index = static_cast<pjmedia_vid_dev_index>(id);
        if (pjmedia_vid_dev_get_info(index, &info) != PJ_SUCCESS || std::strcmp(info.driver, kOurVideoDriver) != 0 ||
            (info.dir & PJMEDIA_DIR_CAPTURE) == 0) {
            continue;
        }
        for (unsigned seat = 0; seat < kRoomDevices; ++seat) {
            char name[sizeof(info.name)];
            SeatName(seat, name, sizeof(name));
            if (std::strcmp(info.name, name) != 0) continue;
            if (seat == 0) {
                ids.host = index;
            } else {
                ids.seats[seat - 1] = index;
            }
        }
    }
    return ids;
}

bool operator==(const RoomPlan& a, const RoomPlan& b) {
    return a.host == b.host && a.seats == b.seats && a.live == b.live;
}

void SetRoomPlan(const RoomPlan& plan) {
    Store& store = TheStore();
    std::lock_guard<std::mutex> lock(store.mutex);
    store.plan = plan;
    for (auto it = store.images.begin(); it != store.images.end();) {
        it = plan.live.count(it->first) != 0 ? std::next(it) : store.images.erase(it);
    }
}

FrameTap* RoomFrameStore() { return &TheStore(); }

}  // namespace starsonic

#endif  // PJMEDIA_HAS_VIDEO
