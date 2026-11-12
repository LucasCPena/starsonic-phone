#include "EngineCall.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <string>
#include <vector>

#include "EngineLog.h"

// O vídeo da tabela das ligações (ver o topo do EngineCall.h): a oferta que chega, as recusas, o desejo da câmera e as
// pausas, o envio (o SyncVideo, no temporizador da tabela) e o quadro-chave periódico dele, a imagem que chega (o
// portão dos quadros e o remote), a prévia, o teste e a releitura das câmeras, e os problemas da câmera. Os ganchos do
// vídeo nos métodos de sempre (o Incoming, o MediaChanged, o Make, o Answer...) ficam no EngineCall.cpp. Sem o
// PJMEDIA_HAS_VIDEO (o Android), nada daqui muda o que o motor faz.

namespace starsonic {
namespace {

#if PJMEDIA_HAS_VIDEO
// O remote desliga depois deste tempo sem quadro, conferido a cada kRemoteCheckMs.
const auto kRemoteTimeout = std::chrono::seconds(2);
const unsigned kRemoteCheckMs = 250;
// O quadro-chave que a nossa câmera manda sem esperar um pedido, a cada kKeyframeIntervalMs enquanto ela manda, em
// qualquer codec (decisão do responsável de 11/11/2026): uma central que responde ela mesma ao pedido de quadro-chave
// da outra ponta (o INFO do picture_fast_update) e não o repassa, e sem o RTCP PLI no SDP, deixaria a outra ponta sem
// imagem depois de uma perda de pacotes, ou de uma transferência, até o fim da ligação. Sem isto o H.264 da PJSIP só
// manda os quadros-chave do começo do stream, e o VP8, um a cada 60 s.
const unsigned kKeyframeIntervalMs = 3000;
// O pedido que a PJSIP recusa (o PJ_ETOOMANY: um quadro-chave há menos de 1 s, como os do começo do stream, que vêm um
// por segundo) volta depois deste tempo, e não depois de kKeyframeIntervalMs: sem isso, os pedidos que caem no começo
// do stream deixavam quase 4 s sem quadro-chave depois do último deles. Cada ligação que manda tem o seu prazo (na
// sala, todas mandam juntas): a recusada volta sozinha, sem adiantar o quadro-chave das outras.
const unsigned kKeyframeRetryMs = 1000;
// Um passo da sala que falhou (a troca da fonte ou o START de um lugar, a prévia do lugar 0) volta numa passada deste
// tempo depois, e não logo: a falha que segue não vira um laço.
const unsigned kSyncRetryMs = 1000;
// O re-INVITE da qualidade que encontra outro em andamento na ligação (o PJ_EINVALIDOP) volta numa passada deste tempo
// depois.
const unsigned kReinviteRetryMs = 200;

// O texto de um código do PJSIP, como no EngineCall.cpp.
std::string StatusText(pj_status_t status) { return pj::Endpoint::instance().utilStrError(status); }

bool SameName(const std::string& a, const std::string& b) {
    return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) {
               return std::toupper(static_cast<unsigned char>(x)) == std::toupper(static_cast<unsigned char>(y));
           });
}

// O id de agora da câmera com esse nome (o da PJSIP), ou PJMEDIA_VID_INVALID_DEV.
pjmedia_vid_dev_index CameraNamed(const std::string& name) {
    for (const auto& camera : Cameras()) {
        if (camera.second == name) return camera.first;
    }
    return PJMEDIA_VID_INVALID_DEV;
}

// A qualidade no codificador de cada codec de vídeo da PJSIP, para os próximos streams (também o que um re-INVITE
// refaz): o tamanho, os quadros por segundo e a taxa (o avg_bps e o max_bps), sem mexer no fmtp nem na prioridade, que
// são do ApplyVideoSettings do motor. Com a videoMutex_ presa (ver o topo do EngineCall.h).
void ApplyCodecQuality(const QualityValues& quality) {
    pjsua_codec_info codecs[32];
    unsigned count = PJ_ARRAY_SIZE(codecs);
    pj_status_t status = pjsua_vid_enum_codecs(codecs, &count);
    if (status != PJ_SUCCESS) {
        Log(1, "codecs de video: " + StatusText(status));
        return;
    }
    for (unsigned index = 0; index < count; ++index) {
        const pj_str_t& id = codecs[index].codec_id;
        pjmedia_vid_codec_param param;
        status = pjsua_vid_codec_get_param(&id, &param);
        if (status == PJ_SUCCESS) {
            pjmedia_video_format_detail& encoder = param.enc_fmt.det.vid;
            encoder.size.w = static_cast<unsigned>(quality.width);
            encoder.size.h = static_cast<unsigned>(quality.height);
            encoder.fps.num = quality.fps;
            encoder.fps.denum = 1;
            encoder.avg_bps = static_cast<pj_uint32_t>(quality.kbps) * 1000u;
            encoder.max_bps = encoder.avg_bps;
            status = pjsua_vid_codec_set_param(&id, &param);   // a PJSIP copia os textos do fmtp
        }
        if (status != PJ_SUCCESS) {
            Log(1, "parametros do codec " + std::string(id.ptr, static_cast<size_t>(id.slen)) + ": " +
                       StatusText(status));
        }
    }
}

// A fonte da imagem da ligação (a câmera ou um lugar da sala): sem mandar, o pjsua só troca o id para o próximo
// START_TRANSMIT; mandando, ele troca a janela ao vivo (a captura de antes sai do codificador e a nova entra). Um id
// igual não muda nada. O código do pjsua (a linha do log fica com quem chamou).
pj_status_t UseCamera(int pjsuaId, int mediaIndex, pjmedia_vid_dev_index device) {
    pjsua_call_vid_strm_op_param param;
    pjsua_call_vid_strm_op_param_default(&param);
    param.med_idx = mediaIndex;
    param.cap_dev = device;
    return pjsua_call_set_vid_strm(pjsuaId, PJSUA_CALL_VID_STRM_CHANGE_CAP_DEV, &param);
}

// Uma ligação numa passada do SyncVideo: o que a tabela quer dela e o que a passada fez.
struct SendPlan {
    int callId;
    int pjsuaId;
    bool send;                 // a ligação deve mandar a imagem agora
    int seat;                  // de onde: o lugar dela na sala (o mosaico), ou 0, a câmera
    bool sending;              // o envio de verdade, no fim da passada
    bool seatSending;          // ...e ele é o lugar da sala
    pj_status_t failure;       // o código do START_TRANSMIT da câmera que falhou (ela não abriu), ou PJ_SUCCESS
    pj_status_t seatFailure;   // o código do passo do lugar da sala que falhou (a troca da fonte ou o START)
    bool started;              // o START_TRANSMIT desta passada saiu: o envio começou, ou voltou num stream refeito
};

// O passo de uma ligação no SyncVideo (com a videoMutex_ presa, sem a trava da tabela), com a fonte do plano: o lugar
// da sala, pelos ids de agora (room), ou a câmera (device).
void ApplySendPlan(SendPlan* plan, const RoomDeviceIds& room, pjmedia_vid_dev_index device) {
    const VideoMedia media = VideoMediaOf(plan->pjsuaId);
    const pjmedia_vid_dev_index source = plan->seat > 0 ? room.seats[plan->seat - 1] : device;
    const bool send = plan->send && media.up && media.canSend && source != PJMEDIA_VID_INVALID_DEV;
    plan->sending = media.sending;
    if (!media.sending) plan->seatSending = false;
    // O STOP só numa ligação que manda: o do pjsua solta a câmera da ligação, e sem ela a conta dele erra.
    if (media.index < 0 || (!send && !media.sending)) return;
    // A fonte: mandando, o CHANGE_CAP_DEV troca a janela ao vivo; senão, só o id do próximo START. Sem a fonte do
    // lugar, nada sai (o START mandaria a de antes: a câmera da conta, que num computador sem câmera é o lugar 1, ou o
    // lugar de um envio de antes), e o seatFailure pede outra passada. A câmera que não troca segue como sempre.
    pj_status_t status = PJ_SUCCESS;
    if (send && media.device != source) status = UseCamera(plan->pjsuaId, media.index, source);
    if (status != PJ_SUCCESS) {
        if (plan->seat > 0) {
            plan->seatFailure = status;
            return;
        }
        Log(2, "camera da ligacao: " + StatusText(status));
    }
    if (send && media.sending) {
        if (status == PJ_SUCCESS) plan->seatSending = plan->seat > 0;
        return;
    }
    pjsua_call_vid_strm_op_param param;
    pjsua_call_vid_strm_op_param_default(&param);
    param.med_idx = media.index;
    status = pjsua_call_set_vid_strm(
        plan->pjsuaId, send ? PJSUA_CALL_VID_STRM_START_TRANSMIT : PJSUA_CALL_VID_STRM_STOP_TRANSMIT, &param);
    if (status == PJ_SUCCESS) {
        plan->sending = send;
        plan->seatSending = send && plan->seat > 0;
        plan->started = send;
    } else if (!send) {
        Log(2, "parar o envio da camera: " + StatusText(status));
    } else if (plan->seat > 0) {
        plan->seatFailure = status;
    } else {
        plan->failure = status;
    }
}

// Os quadros da prévia da câmera device (a janela dela na pjsua) passam a sair pelo OnLocalFrame.
void BindPreviewWindow(pjmedia_vid_dev_index device) {
    const pjsua_vid_win_id window = pjsua_vid_preview_get_win(device);
    pjsua_vid_win_info info;
    if (window == PJSUA_INVALID_ID || pjsua_vid_win_get_info(window, &info) != PJ_SUCCESS) {
        Log(2, "a previa da camera ficou sem a janela do desenhista");
        return;
    }
    BindRendererStream(info.hwnd.info.window, kLocalFrames);
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
    pjsua_call_info info;
    if (pjsuaId == PJSUA_INVALID_ID || pjsua_call_get_info(pjsuaId, &info) != PJ_SUCCESS) return VideoMedia();
    return VideoMediaOf(info);
}

VideoMedia VideoMediaOf(const pjsua_call_info& info) {
    VideoMedia media;
    for (unsigned index = 0; index < info.media_cnt; ++index) {
        const pjsua_call_media_info& item = info.media[index];
        if (item.type != PJMEDIA_TYPE_VIDEO || item.status == PJSUA_CALL_MEDIA_NONE ||
            item.status == PJSUA_CALL_MEDIA_ERROR) {
            continue;
        }
        media.up = true;
        media.canSend = (item.dir & PJMEDIA_DIR_ENCODING) != 0;
        media.sending = item.stream.vid.cap_dev != PJMEDIA_VID_INVALID_DEV;
        media.device = item.stream.vid.cap_dev;   // só com a captura ligada: senão, o inválido
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

pjsua_call_setting RingSetting(unsigned videoCount, int recvOnlyIndex) {
    pjsua_call_setting setting;
    pjsua_call_setting_default(&setting);
    setting.vid_cnt = videoCount;
    // Sem câmera, o vídeo só recebe: com o envio, a PJSIP procuraria a câmera ao montar o stream e derrubaria a
    // ligação (488). O pjsua guarda o media_dir para as próximas ofertas e respostas da ligação.
    if (recvOnlyIndex >= 0 && recvOnlyIndex < PJMEDIA_MAX_SDP_MEDIA) {
        setting.flag |= PJSUA_CALL_SET_MEDIA_DIR;
        setting.media_dir[recvOnlyIndex] = PJMEDIA_DIR_DECODING;
    }
    return setting;
}

void BindCallWindow(int pjsuaId, int callId) {
    const pjsua_vid_win_id window = pjsua_call_get_vid_win(pjsuaId);
    pjsua_vid_win_info info;
    if (window == PJSUA_INVALID_ID || pjsua_vid_win_get_info(window, &info) != PJ_SUCCESS) return;
    BindRendererStream(info.hwnd.info.window, callId);
}

std::vector<std::pair<pjmedia_vid_dev_index, std::string>> Cameras() {
    std::vector<std::pair<pjmedia_vid_dev_index, std::string>> cameras;
    const unsigned count = pjmedia_vid_dev_count();
    for (unsigned id = 0; id < count; ++id) {
        pjmedia_vid_dev_info info;
        const pjmedia_vid_dev_index index = static_cast<pjmedia_vid_dev_index>(id);
        if (pjmedia_vid_dev_get_info(index, &info) != PJ_SUCCESS || (info.dir & PJMEDIA_DIR_CAPTURE) == 0) continue;
        // Os dispositivos nossos (os da sala) não são câmeras.
        if (std::strcmp(info.driver, kOurVideoDriver) == 0) continue;
        cameras.emplace_back(index, info.name);
    }
    return cameras;
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
        offer.index = static_cast<int>(index);
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
        table_->ReofferFailed(this, tsx->status_code);
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
    remoteTimer_.table = this;
    endpoint->AddTimerTarget(kRemoteTimer, &remoteTimer_);
    keyframeTimer_.table = this;
    endpoint->AddTimerTarget(kKeyframeTimer, &keyframeTimer_);
    retryTimer_.table = this;
    endpoint->AddTimerTarget(kRetryTimer, &retryTimer_);
    reinviteTimer_.table = this;
    endpoint->AddTimerTarget(kReinviteTimer, &reinviteTimer_);
    frameGate_.table = this;
    SetRendererGate(&frameGate_);
    // Os erros da câmera aberta chegam ao gerenciador de eventos da PJSIP com a câmera (ou a porta dela) como
    // publicador: a tabela ouve todos os publicadores.
    const pj_status_t status = pjmedia_event_subscribe(nullptr, &CallTable::OnMediaEvent, this, nullptr);
    if (status != PJ_SUCCESS) Log(2, "avisos da camera: " + StatusText(status));
#endif
}

void CallTable::Stop() {
#if PJMEDIA_HAS_VIDEO
    SetRendererGate(nullptr);
    // A loja da sala também sai, vazia: ela dura até o fim do processo, e outro motor começa sem as imagens deste.
    SetRendererTap(nullptr);
    SetRoomPlan(RoomPlan());
    pjmedia_event_unsubscribe(nullptr, &CallTable::OnMediaEvent, this, nullptr);
#endif
}

void CallTable::ReofferFailed(EngineCall* call, int sipCode) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (!slot || !slot->confirmed) return;
        // O sendrecv da ligação de onde a sala nasceu (SendReceive) recusado: ela segue só recebendo, sem mandar o
        // mosaico dela, e nada tenta de novo.
        if (slot->askingSendRecv) {
            slot->askingSendRecv = false;
            Log(2, "o envio do mosaico da sala foi recusado (" + std::to_string(sipCode) + ")");
        }
        // Só o re-INVITE de uma ligação confirmada que pedia o vídeo (o 488 da oferta inicial acaba com a ligação).
        if (!slot->askingVideo) return;
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
        // Com a sala de pé, a câmera é a da sala: o id dela é o desejo da câmera na sala, e outro id (um convidado ou a
        // ligação de fora) não a muda.
        if (roomId_ != 0) {
            if (callId != roomId_ || !VideoEnabled(settings_)) return false;
            const bool noCamera = on && camera_ == PJMEDIA_VID_INVALID_DEV;
            if (noCamera) Problem(CameraProblem::NoCamera);
            roomWish_ = on && !noCamera;
            PublishVideo();
            ScheduleSync();
            return true;
        }
        Slot* slot = Find(callId);
        if (!slot) return false;
        if (!VideoEnabled(settings_)) {   // nenhum codec de vídeo nas escolhas: a câmera não tem para onde mandar
            if (on) Refuse(*slot);
            return false;
        }
        // Sem câmera, a ligação ainda pede o vídeo da outra ponta, só para receber; a câmera fica desligada.
        const bool noCamera = on && camera_ == PJMEDIA_VID_INVALID_DEV;
        if (noCamera) Problem(CameraProblem::NoCamera);
        if (on && slot->videoCount == 0) {   // sem vídeo: pede o vídeo à outra ponta
            if (!slot->confirmed) return false;
            add = true;
        }
        wished = slot->wish;
        slot->wish = on && !noCamera;
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

void CallTable::SetVideoSettings(const VideoSettings& settings, const std::function<void()>& engineCodecs) {
#if PJMEDIA_HAS_VIDEO
    {
        // Os parâmetros dos codecs só mudam com a videoMutex_ presa (ver o topo do EngineCall.h).
        std::lock_guard<std::mutex> videoLock(videoMutex_);
        if (engineCodecs) engineCodecs();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            settings_ = settings;
        }
        // A qualidade na hora; com a sala de pé, os re-INVITE dela saem no SyncVideo.
        ApplyQuality();
    }
    ScheduleSync();
#else
    (void)engineCodecs;
    std::lock_guard<std::mutex> lock(mutex_);
    settings_ = settings;
#endif
}

CallVideo CallTable::Video(int callId) {
    std::lock_guard<std::mutex> lock(mutex_);
#if PJMEDIA_HAS_VIDEO
    if (callId != 0 && callId == roomId_) return roomVideoShown_;
#endif
    const Slot* slot = Find(callId);
    return slot ? slot->shown : CallVideo();
}

bool CallTable::AddVideo(int callId) {
#if PJMEDIA_HAS_VIDEO
    bool found = true;   // a ligação seguia na tabela, com o id no pjsua, em cada tentativa
    const pj_status_t status = RetryWhileRenegotiating([&]() -> pj_status_t {
        int pjsuaId = PJSUA_INVALID_ID;
        pjmedia_vid_dev_index camera = PJMEDIA_VID_INVALID_DEV;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot && slot->pjsuaId != PJSUA_INVALID_ID) {
                pjsuaId = slot->pjsuaId;
                camera = camera_;
                // Antes do re-INVITE: a resposta pode chegar antes de o pjsua voltar.
                slot->videoCount = 1;
                slot->askingVideo = true;
            }
        }
        if (pjsuaId == PJSUA_INVALID_ID) {
            found = false;
            return PJ_ENOTFOUND;
        }
        pjsua_call_vid_strm_op_param param;
        pjsua_call_vid_strm_op_param_default(&param);
        // Sem câmera, o vídeo só recebe, e o id inválido evita que o pjsua procure a câmera padrão (que não há).
        param.dir = camera != PJMEDIA_VID_INVALID_DEV ? PJMEDIA_DIR_ENCODING_DECODING : PJMEDIA_DIR_DECODING;
        param.cap_dev = camera;
        const pj_status_t result = pjsua_call_set_vid_strm(pjsuaId, PJSUA_CALL_VID_STRM_ADD, &param);
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (!slot) return result;
        if (result != PJ_SUCCESS) {
            slot->askingVideo = false;
            slot->videoCount = slot->videoUp ? 1 : 0;
        } else if (camera == PJMEDIA_VID_INVALID_DEV) {
            slot->receiveOnly = true;   // o pjsua guarda a direção nas próximas ofertas
        }
        return result;
    });
    if (!found) return false;
    if (status != PJ_SUCCESS) {
        Log(2, "pedir o video: " + StatusText(status));
        return false;
    }
    return true;
#else
    (void)callId;
    return false;
#endif
}

bool CallTable::SendPaused(const Slot& slot) {
    // Um convidado da sala não pausa por outra ligação, da sala ou de fora (spec do vídeo em grupo, 4.2).
    if (slot.member) return slot.held || slot.transferring;
    if (slot.held || slot.transferring || conference_) return true;
    // Com duas ligações, nenhuma câmera manda, com a segunda ainda tocando ou já atendida (spec da videochamada, 4.2),
    // também a de um Porteiro: o envio volta quando a ligação fica sozinha, fora da espera.
    return Other(&slot) != nullptr;
}

bool CallTable::ReceivePaused(const Slot& slot) {
    if (slot.member) return slot.held || slot.transferring;   // como no SendPaused
    if (slot.held || slot.transferring || conference_) return true;
    // Com duas ligações, a imagem que chega também pausa, menos a de um Porteiro (decisão do responsável de 11/11/2026,
    // spec 4.2): tocando ou atendido, a dele segue à vista, só chegando.
    return !slot.doorphone && Other(&slot) != nullptr;
}

bool CallTable::WantsToSend(const Slot& slot) {
#if PJMEDIA_HAS_VIDEO
    // Um convidado manda a nossa câmera direto só sozinho na sala (os outros, se há, ainda chamando), com o desejo da
    // câmera da sala e você nela; com dois ou mais que já atenderam, ele manda o mosaico dele (SendsSeat).
    if (slot.member && (RoomMosaic() || activeId_ != roomId_)) return false;
#endif
    const bool wish = slot.member ? roomWish_ : slot.wish;
    return wish && slot.confirmed && !slot.early && slot.videoUp && slot.canSend && !cameraPaused_ &&
           !SendPaused(slot);
}

bool CallTable::SendsImage(const Slot& slot) {
#if PJMEDIA_HAS_VIDEO
    if (slot.seatSending) return slot.sending && SendsSeat(slot);
#endif
    return slot.sending && WantsToSend(slot);
}

CallVideo CallTable::Current(const Slot& slot) {
    CallVideo video;
    video.offered = slot.offered;
    video.active = slot.videoUp && !ReceivePaused(slot);
    video.remote = slot.remote && video.active;
    // A câmera mandando: o envio aplicado, da câmera, e a tabela ainda o quer (a pausa do envio já desliga a câmera no
    // aviso, antes do STOP_TRANSMIT do SyncVideo). O mosaico de um convidado não é a câmera.
    video.camera = slot.sending && !slot.seatSending && WantsToSend(slot);
    video.early = slot.early;
    video.doorphone = slot.doorphone;
    return video;
}

void CallTable::PublishVideo() {
#if PJMEDIA_HAS_VIDEO
    for (Slot& slot : slots_) {
        if (slot.callId == 0) continue;
        // A imagem que chega some na hora com a pausa dela e sem o vídeo: depois, só um quadro novo a liga de novo.
        if (ReceivePaused(slot) || !slot.videoUp) slot.remote = false;
        const CallVideo video = Current(slot);
        if (video == slot.shown) continue;
        slot.shown = video;
        const int callId = slot.callId;
        Emit(callId, [callId, video](EngineListener& listener) { listener.OnCallVideo(callId, video); });
    }
    // A imagem de cada convidado (o image do OnRoom) é o remote dele: a sala depois do vídeo que a mudou.
    PublishRoom();
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
    // A qualidade primeiro: o alvo de agora nos codecs (uma saída ou o fim da sala o mudam), e o re-INVITE de quem
    // ainda não o recebeu por esta mudança.
    ApplyQuality();
    const bool reinviteBusy = ReinviteForQuality();
    std::vector<SendPlan> plans;
    pjmedia_vid_dev_index device = PJMEDIA_VID_INVALID_DEV;
    bool restart = false;
    bool restartRoom = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        // A câmera aberta segue até fechar: o envio que começa usa a da prévia (a do teste ou a de outro envio).
        device = previewRunning_ && !cameraLost_ ? previewDevice_ : camera_;
        // A câmera em uso mudou de lugar na lista (RefreshCameras): esta passada fecha tudo, e a próxima abre de novo.
        restart = restartCamera_;
        restartCamera_ = false;
        // Uma releitura mudou algum id da sala de pé: a pjsua acha as janelas pelo id de antes, e um id novo pode ser o
        // da janela de outro lugar. Esta passada para o envio das ligações da sala (os ids de antes são os delas) e o
        // mosaico de quem montou, e a próxima liga tudo de novo com os ids novos.
        restartRoom = restartRoom_;
        restartRoom_ = false;
        for (const Slot& slot : slots_) {
            if (slot.callId == 0 || slot.pjsuaId == PJSUA_INVALID_ID) continue;
            SendPlan plan{slot.callId, slot.pjsuaId, false, 0, false, slot.seatSending, PJ_SUCCESS, PJ_SUCCESS, false};
            if (!restart && !(restartRoom && (slot.member || slot.seatSending))) {
                if (SendsSeat(slot)) {
                    plan.send = true;
                    plan.seat = slot.seat;
                } else {
                    plan.send = WantsToSend(slot);
                }
            }
            plans.push_back(plan);
        }
    }
    const RoomDeviceIds room = FindRoomDevices();   // os ids de agora: a lista só muda com o videoMutex_ presa
    // Primeiro o que para, depois o que começa ou troca de fonte: fora da sala, duas ligações nunca mandam juntas (a
    // câmera é uma só); na sala, cada convidado manda o lugar dele, ou um convidado só, a câmera.
    std::stable_sort(plans.begin(), plans.end(),
                     [](const SendPlan& a, const SendPlan& b) { return !a.send && b.send; });
    for (SendPlan& plan : plans) ApplySendPlan(&plan, room, device);
    bool reported = false;   // um START desta passada já deu a linha e o OpenFailed
    bool retry = false;      // um passo da sala falhou: outra passada daqui a kSyncRetryMs
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        for (const SendPlan& plan : plans) {
            Slot* slot = Find(plan.callId);
            if (!slot) continue;
            // A câmera que não abre: uma linha e um OpenFailed por sequência de falhas (o SyncVideo tenta de novo a
            // cada passada).
            const bool failed = plan.failure != PJ_SUCCESS;
            if (failed && !slot->sendFailed) {
                Log(3, "camera: falhou (" + std::to_string(plan.failure) + ")");
                Problem(CameraProblem::OpenFailed);
                reported = true;
            }
            slot->sendFailed = failed;
            // O lugar da sala que não sai: uma linha por sequência de falhas, e a passada que tenta de novo.
            const bool seatFailed = plan.seatFailure != PJ_SUCCESS;
            if (seatFailed && !slot->seatFailed) Log(2, "mandar o mosaico da sala: " + StatusText(plan.seatFailure));
            slot->seatFailed = seatFailed;
            if (seatFailed) retry = true;
            slot->seatSending = plan.sending && plan.seatSending;
            // Um stream refeito (um re-INVITE, como o da qualidade, faz a pjsua refazê-lo) volta sem o envio, que esta
            // passada liga de novo: a linha sai como numa mudança, uma vez por stream.
            const bool restarted = plan.started && slot->sending;
            if (slot->sending == plan.sending && !restarted) continue;
            slot->sending = plan.sending;
            // A imagem que começa a sair já leva quadros-chave (os do começo do stream, ou o da retomada): o pedido
            // dela vem kKeyframeIntervalMs depois.
            if (slot->sending) slot->keyframeAt = now + std::chrono::milliseconds(kKeyframeIntervalMs);
            LogVideo(*slot);   // a cada mudança do envio, e a cada volta dele num stream refeito
        }
    }
    // O mosaico de quem montou segue a sala (na passada da releitura, ele fecha, e a próxima o abre de novo); o que não
    // abre tenta de novo, como um lugar.
    if (!SyncHostMosaic(restartRoom, room.host)) retry = true;
    // A prévia segue o envio da câmera, o mosaico da sala e o teste da câmera; na troca de lugar da câmera, ela fecha
    // também, e a próxima passada abre a câmera de novo, com os ids novos.
    bool again = restart || restartRoom;
    if (restart) {
        StopPreview();
    } else {
        const pj_status_t status = SyncPreview(device);
        if (status != PJ_SUCCESS && PreviewFailed(status, reported)) again = true;
    }
    bool keyframes = false;
    unsigned keyframeDelayMs = 0;
    bool retrying = false;
    bool reinviting = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        PublishVideo();
        // A imagem que começa a sair ganha o quadro-chave periódico; o temporizador para sozinho quando nenhuma manda.
        keyframes = KeyframeTimerNeeded(&keyframeDelayMs);
        // Uma passada só marcada para tentar de novo, por mais passadas que falhem até ela; e outra para o re-INVITE.
        retrying = retry && !retryPending_;
        if (retrying) retryPending_ = true;
        reinviting = reinviteBusy && !reinvitePending_;
        if (reinviting) reinvitePending_ = true;
    }
    if (keyframes) ScheduleKeyframes(keyframeDelayMs);
    if (retrying) ScheduleRetry();
    if (reinviting) ScheduleReinvite();
    if (again) ScheduleSync();
#endif
}

void CallTable::ScheduleSync() {
#if PJMEDIA_HAS_VIDEO
    if (endpoint_) endpoint_->ScheduleTimer(kCallTableTimer);
#endif
}

#if PJMEDIA_HAS_VIDEO
void CallTable::SetVideoDevices(const VideoDeviceIds& ids) {
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    std::lock_guard<std::mutex> lock(mutex_);
    camera_ = ids.camera;
    renderer_ = ids.renderer;
}

void CallTable::RefreshCameras(const std::function<VideoDeviceIds()>& refresh) {
    {
        std::lock_guard<std::mutex> videoLock(videoMutex_);
        // A câmera em uso, pelo nome de quando ela abriu: o id dela é o da lista daquela hora, que uma releitura que
        // ainda espera a passada que a abre de novo deixa com outro dispositivo, ou com nenhum.
        pjmedia_vid_dev_index inUse = PJMEDIA_VID_INVALID_DEV;
        std::string name;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (previewRunning_ && !cameraLost_) {
                inUse = previewDevice_;
                name = previewName_;
            }
        }
        const RoomDeviceIds roomBefore = FindRoomDevices();
        const VideoDeviceIds ids = refresh();
        const RoomDeviceIds room = FindRoomDevices();
        const pjmedia_vid_dev_index now = name.empty() ? PJMEDIA_VID_INVALID_DEV : CameraNamed(name);
        std::lock_guard<std::mutex> lock(mutex_);
        camera_ = ids.camera;
        renderer_ = ids.renderer;
        // Fora da lista nova, ela sumiu (também a de um driver que saiu da PJSIP antes da releitura); noutro id, ela
        // fecha e abre de novo. Uma volta já pedida segue pedida.
        if (!name.empty() && now == PJMEDIA_VID_INVALID_DEV) {
            LoseCamera();
        } else if (!name.empty() && now != inUse) {
            restartCamera_ = true;
        }
        // Um dispositivo da sala com outro id: a pjsua acha as janelas deles pelos ids de antes, e a próxima passada
        // para tudo da sala com eles (ver o SyncVideo). Com os mesmos ids, nada da sala recomeça.
        const bool moved = room.host != roomBefore.host || room.seats != roomBefore.seats;
        const bool seats = std::any_of(std::begin(slots_), std::end(slots_),
                                       [](const Slot& slot) { return slot.callId != 0 && slot.seatSending; });
        if (moved && (roomId_ != 0 || hostRoom_ != 0 || seats)) {
            restartRoom_ = true;
            Log(3, "os ids da sala mudaram na lista de video: o envio dela recomeca");
        }
    }
    ScheduleSync();
}

bool CallTable::StartCameraTest() {
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    pjmedia_vid_dev_index device = PJMEDIA_VID_INVALID_DEV;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (cameraTest_) return true;
        device = previewRunning_ && !cameraLost_ ? previewDevice_ : camera_;
        if (device == PJMEDIA_VID_INVALID_DEV) {
            Problem(CameraProblem::NoCamera);
            return false;
        }
        cameraTest_ = true;
    }
    const pj_status_t status = SyncPreview(device);
    if (status == PJ_SUCCESS) return true;
    std::lock_guard<std::mutex> lock(mutex_);
    cameraTest_ = false;
    Log(3, "camera: falhou (" + std::to_string(status) + ")");
    Problem(CameraProblem::OpenFailed);
    return false;
}

void CallTable::StopCameraTest() {
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!cameraTest_) return;
        cameraTest_ = false;
    }
    // A prévia segue aberta se alguma ligação ainda manda a imagem.
    SyncPreview(PJMEDIA_VID_INVALID_DEV);
}

pj_status_t CallTable::SyncPreview(pjmedia_vid_dev_index device) {
    bool wanted = false;
    bool running = false;
    bool lost = false;
    pjmedia_vid_dev_index renderer = PJMEDIA_VID_INVALID_DEV;
    QualityValues quality = ValuesOf(VideoQuality::Medium);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        // A tela bloqueada (cameraPaused_) fecha também a câmera do teste, como a das ligações. O cameraTest_ segue
        // sendo o desejo da pessoa (o teste continua ligado): o desbloqueio abre a câmera de novo, sem um pedido novo.
        // Os mosaicos da sala também a querem (o kHostTile), se há uma câmera; o envio de um lugar da sala, não.
        wanted = (cameraTest_ && !cameraPaused_) ||
                 std::any_of(std::begin(slots_), std::end(slots_),
                             [](const Slot& slot) { return slot.callId != 0 && slot.sending && !slot.seatSending; }) ||
                 (RoomCameraWanted() && device != PJMEDIA_VID_INVALID_DEV);
        running = previewRunning_;
        lost = cameraLost_;
        renderer = renderer_;
        quality = ValuesOf(settings_.quality);
    }
    // A câmera que sumiu fecha antes de outra abrir.
    if (running && (!wanted || lost)) {
        StopPreview();
        running = false;
    }
    if (!wanted || running) return PJ_SUCCESS;
    if (device == PJMEDIA_VID_INVALID_DEV) return PJMEDIA_EVID_NODEFDEV;
    // A janela da prévia: a câmera no desenhista nosso, à vista (a pjsua só liga a câmera ao desenhista assim), no
    // tamanho e nos quadros por segundo da qualidade. Com uma ligação mandando, a janela já existe (a do envio).
    pjsua_vid_preview_param param;
    pjsua_vid_preview_param_default(&param);
    if (renderer != PJMEDIA_VID_INVALID_DEV) param.rend_id = renderer;
    param.show = PJ_TRUE;
    pjmedia_format_init_video(&param.format, PJMEDIA_FORMAT_I420, static_cast<unsigned>(quality.width),
                              static_cast<unsigned>(quality.height), static_cast<unsigned>(quality.fps), 1);
    const pj_status_t status = pjsua_vid_preview_start(device, &param);
    if (status != PJ_SUCCESS) return status;
    BindPreviewWindow(device);
    // O nome dela na lista de agora (a lista só muda com a videoMutex_ presa), para a próxima releitura.
    pjmedia_vid_dev_info info;
    const std::string name = pjmedia_vid_dev_get_info(device, &info) == PJ_SUCCESS ? info.name : "";
    std::lock_guard<std::mutex> lock(mutex_);
    previewRunning_ = true;
    previewDevice_ = device;
    previewName_ = name;
    return PJ_SUCCESS;
}

void CallTable::StopPreview() {
    pjmedia_vid_dev_index device = PJMEDIA_VID_INVALID_DEV;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!previewRunning_) return;
        device = previewDevice_;
    }
    // Pelo id com que a prévia abriu: a pjsua acha a janela por ele, também depois de uma releitura da lista.
    const pj_status_t status = pjsua_vid_preview_stop(device);
    if (status != PJ_SUCCESS) Log(2, "parar a previa da camera: " + StatusText(status));
    std::lock_guard<std::mutex> lock(mutex_);
    previewRunning_ = false;
    previewDevice_ = PJMEDIA_VID_INVALID_DEV;
    previewName_.clear();
    cameraLost_ = false;
}

bool CallTable::PreviewFailed(pj_status_t status, bool reported) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!reported) {
        Log(3, "camera: falhou (" + std::to_string(status) + ")");
        Problem(CameraProblem::OpenFailed);
    }
    // Nada tenta de novo sozinho: o teste da câmera para, e as ligações que mandam a câmera ficam com camera=false (o
    // desejo da câmera desliga, e a próxima passada para o envio delas). Os mosaicos da sala seguem, com o fundo no
    // lugar da câmera (o desejo da câmera da sala desliga também).
    cameraTest_ = false;
    if (RoomCameraWanted()) roomWish_ = false;
    bool sending = false;
    for (Slot& slot : slots_) {
        if (slot.callId == 0 || !slot.sending || slot.seatSending) continue;
        slot.wish = false;
        if (slot.member) roomWish_ = false;   // um convidado só manda a câmera com o desejo da sala
        sending = true;
    }
    return sending;
}

bool CallTable::FrameGate::OnRemoteFrameArrived(int callId) { return table->RemoteFrameArrived(callId); }

void CallTable::RemoteTimer::OnEngineTimer() { table->CheckRemote(); }

void CallTable::KeyframeTimer::OnEngineTimer() { table->SendKeyframes(); }

bool CallTable::KeyframeTimerNeeded(unsigned* delayMs) {
    if (keyframePending_ || closed_) return false;
    const auto now = std::chrono::steady_clock::now();
    auto next = now + std::chrono::milliseconds(kKeyframeIntervalMs);
    for (const Slot& slot : slots_) {
        if (slot.callId == 0 || !SendsImage(slot)) continue;
        keyframePending_ = true;
        next = std::min(next, slot.keyframeAt);
    }
    *delayMs = next > now ? static_cast<unsigned>(std::chrono::ceil<std::chrono::milliseconds>(next - now).count()) : 0;
    return keyframePending_;
}

void CallTable::SendKeyframes() {
    // Como no SyncVideo: o fim de uma ligação pela API não desfaz a mídia no meio do pedido ao pjsua.
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    std::vector<std::pair<int, int>> due;   // o id e o id no pjsua das ligações que mandam a imagem, no prazo delas
    {
        std::lock_guard<std::mutex> lock(mutex_);
        keyframePending_ = false;
        if (closed_) return;
        const auto now = std::chrono::steady_clock::now();
        for (const Slot& slot : slots_) {
            if (slot.callId != 0 && slot.pjsuaId != PJSUA_INVALID_ID && SendsImage(slot) && slot.keyframeAt <= now) {
                due.emplace_back(slot.callId, slot.pjsuaId);
            }
        }
    }
    // Nenhuma linha no diagnóstico (uma a cada 3 s o encheria): nenhuma nossa, e a do pjsua o LogForwarder segura. O
    // pedido recusado por um quadro-chave há menos de 1 s (o limite da PJSIP) volta em kKeyframeRetryMs, só o dessa
    // ligação; o recusado por outro motivo (o envio que acabou de parar) espera o prazo de sempre.
    std::vector<pj_status_t> results;
    for (const auto& call : due) {
        results.push_back(pjsua_call_set_vid_strm(call.second, PJSUA_CALL_VID_STRM_SEND_KEYFRAME, nullptr));
    }
    unsigned delayMs = 0;
    bool schedule = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        for (size_t index = 0; index < due.size(); ++index) {
            Slot* slot = Find(due[index].first);
            if (!slot) continue;
            const unsigned waitMs = results[index] == PJ_ETOOMANY ? kKeyframeRetryMs : kKeyframeIntervalMs;
            slot->keyframeAt = now + std::chrono::milliseconds(waitMs);
        }
        // O prazo mais cedo das que mandam; sem nenhuma mandando, o temporizador para.
        schedule = KeyframeTimerNeeded(&delayMs);
    }
    if (schedule) ScheduleKeyframes(delayMs);
}

void CallTable::ScheduleKeyframes(unsigned delayMs) {
    if (endpoint_ && endpoint_->ScheduleTimer(kKeyframeTimer, delayMs)) return;
    std::lock_guard<std::mutex> lock(mutex_);
    keyframePending_ = false;
}

void CallTable::ScheduleRemoteCheck() {
    if (endpoint_ && endpoint_->ScheduleTimer(kRemoteTimer, kRemoteCheckMs)) return;
    std::lock_guard<std::mutex> lock(mutex_);
    remoteCheckPending_ = false;
}

void CallTable::RetryTimer::OnEngineTimer() {
    {
        std::lock_guard<std::mutex> lock(table->mutex_);
        table->retryPending_ = false;   // a passada que falhar daqui em diante marca a próxima
    }
    table->SyncVideo();
}

void CallTable::ScheduleRetry() {
    if (endpoint_ && endpoint_->ScheduleTimer(kRetryTimer, kSyncRetryMs)) return;
    std::lock_guard<std::mutex> lock(mutex_);
    retryPending_ = false;
}

void CallTable::ReinviteTimer::OnEngineTimer() {
    {
        std::lock_guard<std::mutex> lock(table->mutex_);
        table->reinvitePending_ = false;   // a passada que encontrar outro re-INVITE daqui em diante marca a próxima
    }
    table->SyncVideo();
}

void CallTable::ScheduleReinvite() {
    if (endpoint_ && endpoint_->ScheduleTimer(kReinviteTimer, kReinviteRetryMs)) return;
    std::lock_guard<std::mutex> lock(mutex_);
    reinvitePending_ = false;
}

void CallTable::ApplyQuality() {
    QualityValues target{};
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        target = TargetQuality();
        if (target.width == quality_.width && target.height == quality_.height && target.fps == quality_.fps &&
            target.kbps == quality_.kbps) {
            return;
        }
        quality_ = target;
        ++qualitySerial_;   // os re-INVITE desta mudança (ReinviteForQuality), um por ligação
    }
    ApplyCodecQuality(target);
}

bool CallTable::RemoteFrameArrived(int callId) {
    bool schedule = false;
    try {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        if (callId != 0 && callId == roomId_) {
            // O mosaico de quem montou: o primeiro quadro liga o remote da sala.
            roomLastFrame_ = now;
            if (!roomRemote_) {
                roomRemote_ = true;
                PublishVideo();
            }
        } else if (callId != 0 && callId == hostRoom_) {
            return false;   // o mosaico de uma sala que acabou, até o SyncVideo fechar a janela dele
        } else {
            Slot* slot = Find(callId);
            if (!slot) return true;   // uma janela que a tabela não conhece (a dos testes do desenhista): o quadro sai
            if (ReceivePaused(*slot)) return false;
            slot->lastFrame = now;
            if (!slot->remote) {
                slot->remote = true;
                PublishVideo();
            }
        }
        schedule = !remoteCheckPending_;
        remoteCheckPending_ = true;
    } catch (...) {   // o desenhista é chamado pelo PJSIP, que é C
    }
    try {
        if (schedule) ScheduleRemoteCheck();
    } catch (...) {
    }
    return true;
}

void CallTable::CheckRemote() {
    bool again = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        for (Slot& slot : slots_) {
            if (slot.callId == 0 || !slot.remote) continue;
            if (now - slot.lastFrame >= kRemoteTimeout) {
                slot.remote = false;
            } else {
                again = true;
            }
        }
        // O mosaico de quem montou, como a imagem de uma ligação.
        if (roomRemote_) {
            if (now - roomLastFrame_ >= kRemoteTimeout) {
                roomRemote_ = false;
            } else {
                again = true;
            }
        }
        PublishVideo();
        remoteCheckPending_ = again;
    }
    if (again) ScheduleRemoteCheck();
}

pj_status_t CallTable::OnMediaEvent(pjmedia_event* event, void* table) {
    if (!event || event->type != PJMEDIA_EVENT_VID_DEV_ERROR ||
        (event->data.vid_dev_err.dir & PJMEDIA_DIR_CAPTURE) == 0) {
        return PJ_SUCCESS;
    }
    CallTable* calls = static_cast<CallTable*>(table);
    try {
        {
            // O aviso chega duas vezes (da câmera e da porta dela na pjsua): um Disconnected só.
            std::lock_guard<std::mutex> lock(calls->mutex_);
            if (!calls->previewRunning_ || calls->cameraLost_) return PJ_SUCCESS;
            calls->LoseCamera();
        }
        calls->ScheduleSync();
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
    return PJ_SUCCESS;
}

void CallTable::LoseCamera() {
    cameraLost_ = true;
    cameraTest_ = false;
    for (Slot& slot : slots_) slot.wish = false;   // a câmera não volta sozinha: só com um pedido novo
    roomWish_ = false;                             // também a da sala
    PublishVideo();
    Problem(CameraProblem::Disconnected);
}

void CallTable::Problem(CameraProblem problem) {
    try {
        events_->Post([problem](EngineListener& listener) { listener.OnCameraProblem(problem); });
    } catch (...) {   // sem memória: o aviso se perde
    }
}
#endif

}  // namespace starsonic
