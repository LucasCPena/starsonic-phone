#include "EngineCall.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <string>
#include <thread>
#include <vector>

#include "EngineLog.h"

// O vídeo da tabela das ligações (ver o topo do EngineCall.h): a oferta que chega, as recusas, o desejo da câmera e
// a pausa, e o envio (o SyncVideo, no temporizador da tabela). Os ganchos do vídeo nos métodos de sempre (o Incoming,
// o MediaChanged, o Make, o Answer...) ficam no EngineCall.cpp. Sem o PJMEDIA_HAS_VIDEO (o Android), nada daqui muda
// o que o motor faz.

namespace starsonic {
namespace {

#if PJMEDIA_HAS_VIDEO
// O id do temporizador da tabela no EngineEndpoint: as contas usam os ids delas, que começam em 1.
const int kCallTableTimer = 0;

// O texto de um código do PJSIP, como no EngineCall.cpp.
std::string StatusText(pj_status_t status) { return pj::Endpoint::instance().utilStrError(status); }

bool SameName(const std::string& a, const std::string& b) {
    return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) {
               return std::toupper(static_cast<unsigned char>(x)) == std::toupper(static_cast<unsigned char>(y));
           });
}
#endif

}  // namespace

#if PJMEDIA_HAS_VIDEO
// A oferta e as escolhas têm um codec de vídeo em comum (um nome da oferta na ordem das escolhas).
bool CommonCodec(const std::vector<std::string>& offered, const VideoSettings& settings) {
    for (const VideoCodec codec : CodecOrder(settings)) {
        const std::string name = CodecName(codec);
        for (const std::string& candidate : offered) {
            if (SameName(candidate, name)) return true;
        }
    }
    return false;
}

VideoMedia VideoMediaOf(int pjsuaId) {
    VideoMedia media;
    pjsua_call_info info;
    if (pjsuaId == PJSUA_INVALID_ID || pjsua_call_get_info(pjsuaId, &info) != PJ_SUCCESS) return media;
    for (unsigned index = 0; index < info.media_cnt; ++index) {
        const pjsua_call_media_info& item = info.media[index];
        if (item.type != PJMEDIA_TYPE_VIDEO || item.status == PJSUA_CALL_MEDIA_NONE ||
            item.status == PJSUA_CALL_MEDIA_ERROR) {
            continue;
        }
        media.up = true;
        media.canSend = (item.dir & PJMEDIA_DIR_ENCODING) != 0;
        media.sending = item.stream.vid.cap_dev != PJMEDIA_VID_INVALID_DEV;
        media.index = static_cast<int>(item.index);
        break;
    }
    return media;
}

// O codec e o codificador do stream de vídeo de media. Só com a trava do diálogo da ligação: o stream não some no
// meio da leitura.
void ReadVideoStream(int pjsuaId, VideoMedia* media) {
    pjsua_stream_info info;
    if (!media->up || pjsua_call_get_stream_info(pjsuaId, static_cast<unsigned>(media->index), &info) != PJ_SUCCESS ||
        info.type != PJMEDIA_TYPE_VIDEO) {
        return;
    }
    const pj_str_t& name = info.info.vid.codec_info.encoding_name;
    media->codec.assign(name.ptr, static_cast<size_t>(name.slen));
    const pjmedia_vid_codec_param* param = info.info.vid.codec_param;
    if (!param) return;
    const pjmedia_video_format_detail& detail = param->enc_fmt.det.vid;
    media->width = static_cast<int>(detail.size.w);
    media->height = static_cast<int>(detail.size.h);
    media->fps = detail.fps.denum ? static_cast<int>(detail.fps.num / detail.fps.denum) : 0;
}
#endif

VideoOffer VideoOfferOf(void* rdata) {
    VideoOffer offer;
    if (!rdata) return offer;
    const pjsip_rdata_sdp_info* sdp = pjsip_rdata_get_sdp_info(static_cast<pjsip_rx_data*>(rdata));
    if (!sdp || !sdp->sdp) return offer;
    for (unsigned index = 0; index < sdp->sdp->media_count; ++index) {
        const pjmedia_sdp_media* media = sdp->sdp->media[index];
        if (pj_strcmp2(&media->desc.media, "video") != 0 || media->desc.port == 0) continue;
        offer.video = true;
        for (unsigned format = 0; format < media->desc.fmt_count; ++format) {
            const pjmedia_sdp_attr* attr = pjmedia_sdp_media_find_attr2(media, "rtpmap", &media->desc.fmt[format]);
            pjmedia_sdp_rtpmap rtpmap;
            if (!attr || pjmedia_sdp_attr_get_rtpmap(attr, &rtpmap) != PJ_SUCCESS) continue;
            offer.codecs.emplace_back(rtpmap.enc_name.ptr, static_cast<size_t>(rtpmap.enc_name.slen));
        }
        break;
    }
    return offer;
}

void EngineCall::onCallTsxState(pj::OnCallTsxStateParam& param) {
#if PJMEDIA_HAS_VIDEO
    try {
        // A resposta final fora de 2xx a um INVITE nosso, uma vez (a transação passa a COMPLETED). O 401 e o 407 o
        // PJSIP repete com a senha, e o 422 com outro intervalo de sessão: não são o fim do pedido.
        const pjsip_event* event = static_cast<const pjsip_event*>(param.e.pjEvent);
        if (!event || event->type != PJSIP_EVENT_TSX_STATE) return;
        const pjsip_transaction* tsx = event->body.tsx_state.tsx;
        if (!tsx || tsx->role != PJSIP_ROLE_UAC || pjsip_method_cmp(&tsx->method, pjsip_get_invite_method()) != 0 ||
            tsx->state != PJSIP_TSX_STATE_COMPLETED || event->body.tsx_state.prev_state >= PJSIP_TSX_STATE_COMPLETED ||
            tsx->status_code < 300 || tsx->status_code == 401 || tsx->status_code == 407 || tsx->status_code == 422) {
            return;
        }
        table_->ReofferFailed(this);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
#else
    (void)param;
#endif
}

void CallTable::Start(EngineEndpoint* endpoint) {
    endpoint_ = endpoint;
#if PJMEDIA_HAS_VIDEO
    endpoint->AddTimerTarget(kCallTableTimer, this);
#endif
}

void CallTable::ReofferFailed(EngineCall* call) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        // Só o re-INVITE de uma ligação confirmada que pedia o vídeo (o 488 da oferta inicial acaba com a ligação).
        if (!slot || !slot->confirmed || !slot->askingVideo) return;
        slot->askingVideo = false;
        slot->videoCount = slot->videoUp ? 1 : 0;
        Refuse(*slot);
        PublishVideo();
    }
    ScheduleSync();
}

void CallTable::OnEngineTimer() { SyncVideo(); }

bool CallTable::SetCamera(int callId, bool on) {
#if PJMEDIA_HAS_VIDEO
    bool add = false;
    bool wished = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (!slot) return false;
        if (!VideoEnabled(settings_)) {   // nenhum codec de vídeo nas escolhas: a câmera não tem para onde mandar
            if (on) Refuse(*slot);
            return false;
        }
        if (on && slot->videoCount == 0) {   // sem vídeo: pede o vídeo à outra ponta
            if (!slot->confirmed) return false;
            add = true;
        }
        wished = slot->wish;
        slot->wish = on;
        PublishVideo();
    }
    if (add && !AddVideo(callId)) {   // o pedido não saiu: o desejo volta ao de antes
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot) slot->wish = wished;
        return false;
    }
    ScheduleSync();
    return true;
#else
    (void)callId;
    (void)on;
    return false;
#endif
}

void CallTable::SetCameraPaused(bool paused) {
#if PJMEDIA_HAS_VIDEO
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cameraPaused_ = paused;
        PublishVideo();
    }
    ScheduleSync();
#else
    (void)paused;
#endif
}

void CallTable::SetVideoSettings(const VideoSettings& settings) {
    std::lock_guard<std::mutex> lock(mutex_);
    settings_ = settings;
}

CallVideo CallTable::Video(int callId) {
    std::lock_guard<std::mutex> lock(mutex_);
    const Slot* slot = Find(callId);
    return slot ? slot->shown : CallVideo();
}

bool CallTable::AddVideo(int callId) {
#if PJMEDIA_HAS_VIDEO
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kRenegotiationWaitMs);
    for (;;) {
        int pjsuaId = PJSUA_INVALID_ID;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot && slot->pjsuaId != PJSUA_INVALID_ID) {
                pjsuaId = slot->pjsuaId;
                // Antes do re-INVITE: a resposta pode chegar antes de o pjsua voltar.
                slot->videoCount = 1;
                slot->askingVideo = true;
            }
        }
        if (pjsuaId == PJSUA_INVALID_ID) return false;
        pjsua_call_vid_strm_op_param param;
        pjsua_call_vid_strm_op_param_default(&param);
        param.dir = PJMEDIA_DIR_ENCODING_DECODING;
        const pj_status_t status = pjsua_call_set_vid_strm(pjsuaId, PJSUA_CALL_VID_STRM_ADD, &param);
        if (status == PJ_SUCCESS) return true;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot) {
                slot->askingVideo = false;
                slot->videoCount = slot->videoUp ? 1 : 0;
            }
        }
        // PJ_EINVALIDOP: outra renegociação da ligação ainda não terminou, como no Renegotiate.
        if (status != PJ_EINVALIDOP || std::chrono::steady_clock::now() >= deadline) {
            Log(2, "pedir o video: " + StatusText(status));
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
#else
    (void)callId;
    return false;
#endif
}

bool CallTable::Paused(const Slot& slot) {
    if (slot.held || slot.transferring || conference_) return true;
    // Com duas ligações, só a ativa fica com o vídeo (a segunda que ainda toca também pausa).
    return Other(&slot) != nullptr && activeId_ != slot.callId;
}

bool CallTable::WantsToSend(const Slot& slot) {
    return slot.wish && slot.confirmed && !slot.early && slot.videoUp && slot.canSend && !cameraPaused_ &&
           !Paused(slot);
}

CallVideo CallTable::Current(const Slot& slot) {
    CallVideo video;
    video.offered = slot.offered;
    video.active = slot.videoUp && !Paused(slot);
    // A câmera mandando: o envio aplicado, e a tabela ainda o quer (a pausa já desliga a câmera no aviso, antes do
    // STOP_TRANSMIT do SyncVideo).
    video.camera = slot.sending && WantsToSend(slot);
    video.early = slot.early;
    return video;
}

void CallTable::PublishVideo() {
#if PJMEDIA_HAS_VIDEO
    for (Slot& slot : slots_) {
        if (slot.callId == 0) continue;
        const CallVideo video = Current(slot);
        if (video == slot.shown) continue;
        slot.shown = video;
        const int callId = slot.callId;
        Emit(callId, [callId, video](EngineListener& listener) { listener.OnCallVideo(callId, video); });
    }
#endif
}

void CallTable::Refuse(Slot& slot) {
#if PJMEDIA_HAS_VIDEO
    // Um evento só da recusa, com os outros campos de agora; o próximo aviso compara com eles, sem o refused.
    CallVideo video = Current(slot);
    slot.shown = video;
    video.refused = true;
    const int callId = slot.callId;
    Emit(callId, [callId, video](EngineListener& listener) { listener.OnCallVideo(callId, video); });
#else
    (void)slot;
#endif
}

void CallTable::LogVideo(const Slot& slot) {
    // O codificador da ligação: o tamanho e os quadros por segundo da qualidade (o stream os diz; sem ele, a escolha).
    const QualityValues quality = ValuesOf(settings_.quality);
    const int width = slot.width > 0 ? slot.width : quality.width;
    const int height = slot.height > 0 ? slot.height : quality.height;
    const int fps = slot.fps > 0 ? slot.fps : quality.fps;
    Log(3, "video: " + (slot.codec.empty() ? std::string("?") : slot.codec) + " " + std::to_string(width) + "x" +
               std::to_string(height) + " " + std::to_string(fps) + " qps, envio " +
               (slot.sending ? "ligado" : "desligado"));
}

void CallTable::SyncVideo() {
#if PJMEDIA_HAS_VIDEO
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    struct Plan {
        int callId;
        int pjsuaId;
        bool send;
        bool sending;
        pj_status_t failure;   // o código do START_TRANSMIT que falhou (a câmera não abriu), ou PJ_SUCCESS
    };
    std::vector<Plan> plans;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        for (const Slot& slot : slots_) {
            if (slot.callId != 0 && slot.pjsuaId != PJSUA_INVALID_ID) {
                plans.push_back(Plan{slot.callId, slot.pjsuaId, WantsToSend(slot), false, PJ_SUCCESS});
            }
        }
    }
    // Primeiro o que para, depois o que começa: duas ligações nunca mandam juntas (a câmera é uma só).
    std::stable_sort(plans.begin(), plans.end(), [](const Plan& a, const Plan& b) { return !a.send && b.send; });
    for (Plan& plan : plans) {
        const VideoMedia media = VideoMediaOf(plan.pjsuaId);
        const bool send = plan.send && media.up && media.canSend;
        plan.sending = media.sending;
        // O STOP só numa ligação que manda: o do pjsua solta a câmera da ligação, e sem ela a conta dele erra.
        if (send == media.sending || media.index < 0) continue;
        pjsua_call_vid_strm_op_param param;
        pjsua_call_vid_strm_op_param_default(&param);
        param.med_idx = media.index;
        const pj_status_t status = pjsua_call_set_vid_strm(
            plan.pjsuaId, send ? PJSUA_CALL_VID_STRM_START_TRANSMIT : PJSUA_CALL_VID_STRM_STOP_TRANSMIT, &param);
        if (status == PJ_SUCCESS) {
            plan.sending = send;
        } else if (send) {
            plan.failure = status;
        } else {
            Log(2, "parar o envio da camera: " + StatusText(status));
        }
    }
    std::lock_guard<std::mutex> lock(mutex_);
    for (const Plan& plan : plans) {
        Slot* slot = Find(plan.callId);
        if (!slot) continue;
        // A câmera que não abre: uma linha por sequência de falhas (o SyncVideo tenta de novo a cada passada).
        const bool failed = plan.failure != PJ_SUCCESS;
        if (failed && !slot->sendFailed) Log(3, "camera: falhou (" + std::to_string(plan.failure) + ")");
        slot->sendFailed = failed;
        if (slot->sending == plan.sending) continue;
        slot->sending = plan.sending;
        LogVideo(*slot);   // a cada mudança do envio
    }
    PublishVideo();
#endif
}

void CallTable::ScheduleSync() {
#if PJMEDIA_HAS_VIDEO
    if (endpoint_) endpoint_->ScheduleTimer(kCallTableTimer);
#endif
}

}  // namespace starsonic
