#include "EngineCall.h"

#include <algorithm>
#include <chrono>
#include <iterator>
#include <thread>
#include <utility>

#include "EngineLog.h"

namespace starsonic {
namespace {

const char kDtmfDigits[] = "0123456789*#ABCDabcd";

struct RemoteParty {
    std::string user;   // o usuário da URI (o número), sem o domínio
    std::string name;   // o nome de exibição, sem as aspas
};

// Quem está do outro lado da ligação pjsuaId, lido do From pelo analisador do PJSIP.
RemoteParty PartyOf(int pjsuaId) {
    RemoteParty party;
    pjsua_call_info info;
    if (pjsua_call_get_info(pjsuaId, &info) != PJ_SUCCESS) return party;
    pj_pool_t* pool = pjsua_pool_create("starsonic-party", 512, 512);
    if (!pool) return party;
    // pjsip_parse_uri quer um texto que ele possa alterar, terminado em zero.
    std::vector<char> text(info.remote_info.ptr, info.remote_info.ptr + info.remote_info.slen);
    text.push_back('\0');
    pjsip_uri* uri = pjsip_parse_uri(pool, text.data(), text.size() - 1, PJSIP_PARSE_URI_AS_NAMEADDR);
    if (uri) {
        const pjsip_name_addr* nameAddr = reinterpret_cast<const pjsip_name_addr*>(uri);
        party.name.assign(nameAddr->display.ptr, static_cast<size_t>(nameAddr->display.slen));
        if (PJSIP_URI_SCHEME_IS_SIP(uri) || PJSIP_URI_SCHEME_IS_SIPS(uri)) {
            const pjsip_sip_uri* sip = static_cast<const pjsip_sip_uri*>(pjsip_uri_get_uri(uri));
            party.user.assign(sip->user.ptr, static_cast<size_t>(sip->user.slen));
        }
    }
    pj_pool_release(pool);
    return party;
}

bool ToCallState(pjsip_inv_state state, CallState* out) {
    switch (state) {
        case PJSIP_INV_STATE_CALLING:
            *out = CallState::Calling;
            return true;
        case PJSIP_INV_STATE_INCOMING:
            *out = CallState::Incoming;
            return true;
        case PJSIP_INV_STATE_EARLY:
            *out = CallState::Early;
            return true;
        case PJSIP_INV_STATE_CONNECTING:
            *out = CallState::Connecting;
            return true;
        case PJSIP_INV_STATE_CONFIRMED:
            *out = CallState::Confirmed;
            return true;
        default:   // NULL; o DISCONNECTED é tratado antes
            return false;
    }
}

std::string StatusText(pj_status_t status) { return pj::Endpoint::instance().utilStrError(status); }

// A porta 0 da ponte de áudio: o microfone e o alto-falante (o dispositivo de som).
const pjsua_conf_port_id kSoundDevice = 0;

// A porta port da ponte transmite para a porta sink.
bool Transmits(pjsua_conf_port_id port, pjsua_conf_port_id sink) {
    pjsua_conf_port_info info;
    if (pjsua_conf_get_port_info(port, &info) != PJ_SUCCESS) return false;
    return std::find(info.listeners, info.listeners + info.listener_cnt, sink) != info.listeners + info.listener_cnt;
}

// A porta na ponte do áudio da ligação pjsuaId (PJSUA_INVALID_ID se não há) e, em *usable, se ela
// pode ficar ligada. Como o MicroSIP: a mídia ativa (ou em espera do outro lado) fala e ouve; em
// espera daqui ou sem mídia, fica fora do som.
pjsua_conf_port_id AudioPort(int pjsuaId, bool* usable) {
    *usable = false;
    pjsua_call_info info;
    if (pjsuaId == PJSUA_INVALID_ID || pjsua_call_get_info(pjsuaId, &info) != PJ_SUCCESS) return PJSUA_INVALID_ID;
    for (unsigned index = 0; index < info.media_cnt; ++index) {
        const pjsua_call_media_info& media = info.media[index];
        if (media.type != PJMEDIA_TYPE_AUDIO || media.stream.aud.conf_slot == PJSUA_INVALID_ID) continue;
        *usable = media.status == PJSUA_CALL_MEDIA_ACTIVE || media.status == PJSUA_CALL_MEDIA_REMOTE_HOLD;
        return media.stream.aud.conf_slot;
    }
    return PJSUA_INVALID_ID;
}

}  // namespace

EngineCall::EngineCall(pj::Account& account, int pjsuaId, CallTable* table) : pj::Call(account, pjsuaId), table_(table) {}

void EngineCall::onCallState(pj::OnCallStateParam&) {
    try {
        const pj::CallInfo info = getInfo();
        const int code = static_cast<int>(info.lastStatusCode);
        // O pjsua2 já desligou este objeto da ligação quando ela chega ao fim (o mesmo getInfo diz
        // DISCONNECTED): este é o último callback dele.
        if (info.state == PJSIP_INV_STATE_DISCONNECTED) {
            table_->Ended(this, code);   // apaga este objeto: nada depois daqui
            return;
        }
        CallState state;
        if (ToCallState(info.state, &state)) table_->StateChanged(this, state, code);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineCall::onCallMediaState(pj::OnCallMediaStateParam&) {
    try {
        table_->MediaChanged(this);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineCall::onCallTransferStatus(pj::OnCallTransferStatusParam& param) {
    try {
        const int code = static_cast<int>(param.statusCode);
        // O resultado é o NOTIFY com 2xx ou o último aviso da assinatura: o NOTIFY final ou a resposta
        // ao REFER fora de 2xx. O 202 do REFER chega aqui como 100, e os NOTIFY de andamento com 1xx.
        if (code / 100 != 2 && !param.finalNotify) return;
        param.cont = false;   // um aviso por pedido: o resto da assinatura não interessa
        table_->Transferred(this, code);   // com 2xx pode apagar este objeto: nada depois daqui
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineCall::onCallTransferRequest(pj::OnCallTransferRequestParam& param) {
    // Aceitar faria o pjsua abrir outra ligação presa a este objeto (uma ligação fora da tabela, que
    // ficaria com o objeto depois de ele se apagar): recusa.
    param.statusCode = PJSIP_SC_DECLINE;
    Log(2, "pedido de transferencia recebido e recusado (603)");
}

void EngineCall::onCallReplaceRequest(pj::OnCallReplaceRequestParam& param) {
    // Um INVITE com Replaces trocaria esta ligação por outra presa a este objeto; recusa pelo mesmo
    // motivo da transferência recebida.
    param.statusCode = PJSIP_SC_DECLINE;
    Log(2, "pedido de troca de ligacao (Replaces) recebido e recusado (603)");
}

CallTable::CallTable(EventQueue* events, DtmfMethod dtmf) : events_(events), dtmf_(dtmf) {}

void CallTable::Incoming(pj::Account& account, int pjsuaId, bool accepting, const VideoOffer& offer) {
    const RemoteParty party = PartyOf(pjsuaId);
    int callId = 0;
    bool busy = false;
    unsigned videoCount = 0;
    int recvOnly = -1;
    bool sendEarly = false;   // o 183 com o SDP (o early de um Porteiro) no lugar do 180
    {
        std::lock_guard<std::mutex> lock(mutex_);
        // Toca sem ligação nenhuma ou com uma só, já confirmada (a segunda ligação).
        Slot* slot = FreeSlot();
        const Slot* other = slot ? Other(slot) : nullptr;
        if (accepting && !closed_ && slot && (!other || other->confirmed)) {
            callId = nextId_++;
            slot->call = new EngineCall(account, pjsuaId, this);   // daqui em diante os callbacks vão a ele
            slot->callId = callId;
            slot->pjsuaId = pjsuaId;
            ++alive_;
            Emit(callId, [callId, party](EngineListener& listener) {
                listener.OnIncomingCall(callId, party.user, party.name);
            });
#if PJMEDIA_HAS_VIDEO
            // O vídeo da oferta, logo depois do aviso: com um codec em comum, a resposta o aceita (offered), e um
            // Porteiro ganha o 183 com o SDP no lugar do 180; sem, o vídeo é recusado (a resposta vai sem ele).
            if (offer.video) {
                slot->offered = CommonCodec(offer.codecs, settings_);
                slot->videoCount = slot->offered ? 1 : 0;
                slot->early = slot->offered && IsDoorphone(settings_, party.user);
                // O Porteiro segue sendo ele depois do atender (o early acaba no Answer): a imagem dele não pausa com a
                // outra ligação (ReceivePaused).
                slot->doorphone = slot->early;
                if (!slot->offered) Refuse(*slot);
            }
            // O vídeo da oferta, e o da outra ligação, se há: com a segunda tocando, ela pausa já (o envio, e a imagem
            // fora a de um Porteiro), também com uma oferta só de voz.
            PublishVideo();
            slot->ringVideoCount = slot->videoCount;
            // Sem câmera, a resposta aceita o vídeo só para receber.
            slot->ringRecvOnly = slot->videoCount > 0 && camera_ == PJMEDIA_VID_INVALID_DEV ? offer.index : -1;
            videoCount = slot->videoCount;
            recvOnly = slot->ringRecvOnly;
            sendEarly = slot->early;
#endif
        } else {
            busy = accepting && !closed_;
        }
    }
    if (callId == 0) {
        // Duas ligações, ou uma que ainda não foi confirmada: 486. A conta ou o motor saindo: 480.
        const unsigned code = busy ? PJSIP_SC_BUSY_HERE : PJSIP_SC_TEMPORARILY_UNAVAILABLE;
        Log(3, "ligacao de " + party.user + " recusada (" + std::to_string(code) + ")");
        pjsua_call_hangup(pjsuaId, code, nullptr, nullptr);
        if (busy) {
            events_->Post([party](EngineListener& listener) { listener.OnRejectedBusy(party.user, party.name); });
        }
        return;
    }
    // A outra ligação, se há, para de mandar a câmera (o SyncVideo, no temporizador).
    ScheduleSync();
    // O 180 vem depois do aviso: o Early que ele provoca chega ao listener depois do OnIncomingCall. Com o vídeo, o
    // número de vídeos da resposta já vai aqui, e o Answer repete o mesmo (o pjsua guarda o primeiro e ignora outro).
    // O 183 do Porteiro leva o SDP (a resposta à oferta), sem mandar nada: a câmera só manda depois do atender, e o
    // som fica fora da mesa até lá.
#if PJMEDIA_HAS_VIDEO
    const pjsua_call_setting setting = RingSetting(videoCount, recvOnly);
    const pjsua_call_setting* answer = &setting;
#else
    (void)offer;
    (void)videoCount;
    (void)recvOnly;
    const pjsua_call_setting* answer = nullptr;
#endif
    if (sendEarly) {
        const pj_status_t status = pjsua_call_answer2(pjsuaId, answer, PJSIP_SC_PROGRESS, nullptr, nullptr);
        if (status == PJ_SUCCESS) return;
        Log(2, "nao foi possivel mandar o 183 do porteiro: " + StatusText(status));
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot) {
            slot->early = false;
            PublishVideo();
        }
    }
    const pj_status_t status = pjsua_call_answer2(pjsuaId, answer, PJSIP_SC_RINGING, nullptr, nullptr);
    if (status != PJ_SUCCESS) Log(2, "nao foi possivel tocar a ligacao (180): " + StatusText(status));
}

void CallTable::StateChanged(EngineCall* call, CallState state, int sipCode) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (!slot) return;
        if (state == CallState::Confirmed) slot->confirmed = true;
        const int callId = slot->callId;
        Emit(callId, [callId, state, sipCode](EngineListener& listener) {
            listener.OnCallState(callId, state, sipCode);
        });
        // A ligação feita com o vídeo, confirmada sem ele: a resposta final o recusou (um 183 de antes pode ter vindo
        // sem o vídeo, e o 200 com ele).
        if (state == CallState::Confirmed && slot->askingVideo) {
            slot->askingVideo = false;
            if (!slot->videoUp) Refuse(*slot);
        }
    }
    // Confirmada, a câmera pode começar a mandar.
    if (state == CallState::Confirmed) ScheduleSync();
}

void CallTable::MediaChanged(EngineCall* call) {
    const int pjsuaId = call->getId();
    int callId = 0;
#if PJMEDIA_HAS_VIDEO
    // Com a trava do diálogo (este callback): o stream do vídeo não muda no meio da leitura.
    VideoMedia media = VideoMediaOf(pjsuaId);
    ReadVideoStream(pjsuaId, &media);
#endif
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (!slot) return;
        callId = slot->callId;
        // O id vem do objeto: numa ligação feita, a mídia pode chegar antes de o makeCall voltar.
        slot->pjsuaId = pjsuaId;
#if PJMEDIA_HAS_VIDEO
        // A negociação diz o vídeo da ligação: as próximas ofertas (a espera, a retomada) levam o mesmo número.
        const bool started = media.up && !slot->videoUp;
        slot->videoUp = media.up;
        slot->canSend = media.canSend;
        slot->videoCount = media.up ? 1 : 0;
        if (media.up && !media.codec.empty()) {
            slot->codec = media.codec;
            slot->width = media.width;
            slot->height = media.height;
            slot->fps = media.fps;
        }
        if (!media.up && slot->sending) {   // o vídeo saiu da ligação, e o envio com ele
            slot->sending = false;
            LogVideo(*slot);
        }
        if (started) LogVideo(*slot);
        // A resposta à nossa oferta com o vídeo: com ele, aceita; sem ele, recusa, mas a da oferta inicial só no
        // Confirmed (StateChanged), porque um 183 sem o vídeo ainda não é a resposta final.
        if (slot->askingVideo && (media.up || slot->confirmed)) {
            slot->askingVideo = false;
            if (!media.up) Refuse(*slot);
        }
        // A recebida que oferecia vídeo com um nome em comum, respondida por aqui (o 183 do Porteiro ou o 200, antes
        // do Confirmed) sem o vídeo: o fmtp não casou na PJSIP (o perfil do H.264). O vídeo é recusado uma vez, como
        // sem codec em comum, e o 183 deixa de ser o early.
        if (slot->offered && !slot->confirmed && !media.up) {
            slot->offered = false;
            slot->early = false;
            Refuse(*slot);
        }
        PublishVideo();
#endif
    }
#if PJMEDIA_HAS_VIDEO
    // A janela da imagem que chega é nova a cada stream de vídeo: os quadros dela saem com o id da ligação.
    if (media.up) BindCallWindow(pjsuaId, callId);
#else
    (void)callId;
#endif
    Route();
    ScheduleSync();
}

void CallTable::Ended(EngineCall* call, int sipCode) {
    bool found = false;
    int callId = 0;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (slot) {
            found = true;
            callId = slot->callId;
            *slot = Slot();
            if (conference_) {
                // Uma saiu da conferência: a outra vira a ativa, já com o som (a ligação entre as duas
                // some com a porta da que acabou).
                conference_ = false;
                const Slot* other = Other(slot);
                activeId_ = other ? other->callId : 0;
            } else if (activeId_ == callId) {
                activeId_ = 0;   // a outra não volta sozinha: quem a retoma é o app, pelo Activate
            }
            Emit(callId, [callId, sipCode](EngineListener& listener) {
                listener.OnCallState(callId, CallState::Disconnected, sipCode);
            });
            // A outra pode sair da pausa (a conferência acabou, ou ela ficou sozinha), depois do fim desta.
            PublishVideo();
        }
    }
#if PJMEDIA_HAS_VIDEO
    if (found) UnbindRendererCall(callId);   // um quadro atrasado da janela dela não sai mais
#endif
    delete call;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        --alive_;
    }
    gone_.notify_all();
    if (found) ScheduleSync();
}

void CallTable::Transferred(EngineCall* call, int sipCode) {
    int pjsuaId = PJSUA_INVALID_ID;
    int targetPjsuaId = PJSUA_INVALID_ID;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (!slot) return;
        const int callId = slot->callId;
        const Slot* target = Find(slot->transferTarget);
        slot->transferTarget = 0;
        Emit(callId, [callId, sipCode](EngineListener& listener) { listener.OnTransfer(callId, sipCode); });
        if (sipCode / 100 == 2) {   // a ligação acaba logo abaixo: a imagem segue pausada até o fim
            pjsuaId = slot->pjsuaId;
            if (target) targetPjsuaId = target->pjsuaId;
        } else {
            slot->transferring = false;
            PublishVideo();
        }
    }
    if (sipCode / 100 != 2) {   // as ligações seguem como estavam, e a imagem volta
        Log(2, "a transferencia nao deu certo (" + std::to_string(sipCode) + ")");
        ScheduleSync();
        return;
    }
    // Deu certo: esta ligação acabou, como no MicroSIP, e na consulta a do colega também (o outro lado
    // ligou um ao outro). Os fins chegam pelos callbacks de sempre, depois do aviso.
    Log(3, "transferencia aceita (" + std::to_string(sipCode) + "): desligando " +
               (targetPjsuaId != PJSUA_INVALID_ID ? "as ligacoes" : "a ligacao"));
    if (pjsuaId != PJSUA_INVALID_ID) pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);   // pode apagar call
    if (targetPjsuaId != PJSUA_INVALID_ID) pjsua_call_hangup(targetPjsuaId, 0, nullptr, nullptr);
}

int CallTable::Make(pj::Account& account, const std::string& uri, bool video) {
    EngineCall* call = nullptr;
    int callId = 0;
    unsigned videoCount = 0;
    bool refuse = false;
    bool recvOnly = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = FreeSlot();
        const Slot* other = slot ? Other(slot) : nullptr;
        if (closed_ || !slot || (other && !other->confirmed)) {
            const char* reason = closed_ ? "o motor esta saindo" : !slot ? "ja ha duas ligacoes"
                                                                          : "a outra ligacao nao foi confirmada";
            Log(2, "ligacao para " + uri + " recusada: " + reason);
            return -1;
        }
        // A vaga fica com a nova desde já: uma ligação que chegue agora recebe 486.
        callId = nextId_++;
        call = new EngineCall(account, PJSUA_INVALID_ID, this);
        slot->call = call;
        slot->callId = callId;
        ++alive_;
#if PJMEDIA_HAS_VIDEO
        // Com o vídeo nas escolhas, a oferta leva um vídeo e o desejo da câmera liga; sem ele, a ligação é só de voz
        // e a recusa sai logo depois do makeCall, atrás do primeiro estado da ligação. Sem câmera, a oferta leva o
        // vídeo só para receber, e a câmera fica desligada.
        if (video && VideoEnabled(settings_)) {
            recvOnly = camera_ == PJMEDIA_VID_INVALID_DEV;
            if (recvOnly) Problem(CameraProblem::NoCamera);
            slot->videoCount = 1;
            slot->wish = !recvOnly;
            slot->askingVideo = true;
        }
        refuse = video && !VideoEnabled(settings_);
        videoCount = slot->videoCount;
#else
        (void)video;
#endif
    }
    // A outra, se há, vai para a espera antes de a nova sair, e fica nela mesmo se a nova não sai.
    Focus(callId);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        dialing_ = true;
    }
    bool made = true;
    try {
        pj::CallOpParam param(true);
        param.opt.videoCount = videoCount;   // o pjsua oferece um vídeo por padrão com o vídeo compilado
#if PJMEDIA_HAS_VIDEO
        if (recvOnly) {
            // A oferta nova tem o áudio no primeiro m= e o vídeo no segundo (o pjsua guarda o media_dir na ligação).
            param.opt.flag |= PJSUA_CALL_SET_MEDIA_DIR;
            param.opt.mediaDir = {PJMEDIA_DIR_ENCODING_DECODING, PJMEDIA_DIR_DECODING};
        }
#else
        (void)recvOnly;
#endif
        call->makeCall(uri, param);
    } catch (const pj::Error& failure) {
        made = false;
        Log(2, "nao foi possivel ligar para " + uri + ": " + failure.info());
    }
    bool unused = false;   // o pjsua não chegou a usar o objeto
    {
        std::lock_guard<std::mutex> lock(mutex_);
        dialing_ = false;
        std::vector<HeldEvent> held;
        held.swap(held_);
        // Com a vaga ainda na tabela, Ended não apagou o objeto (ele limpa a vaga antes). Pelo id, e
        // não pelo endereço: um objeto novo pode nascer onde estava um que se apagou.
        Slot* slot = Find(callId);
        if (made) {
            if (slot) slot->pjsuaId = call->getId();
        } else if (slot) {   // sem callback de fim: o objeto é nosso para apagar
            *slot = Slot();
            if (activeId_ == callId) activeId_ = 0;
            unused = true;
        }
        // Se o makeCall falhou depois de um callback de fim, Ended já apagou o objeto; os eventos dela
        // que ficaram em held_ somem com ele: MakeCall devolve -1 sem evento nenhum. Os da outra
        // ligação seguem.
        for (HeldEvent& entry : held) {
            if (made || entry.callId != callId) events_->Post(std::move(entry.event));
        }
        // A recusa do vídeo sem o VideoEnabled, depois dos eventos que o makeCall deixou em held (o primeiro estado
        // da ligação vem antes de qualquer outro evento dela). Sem a ligação, nenhuma.
        if (made && refuse && slot) Refuse(*slot);
    }
    if (unused) {
        delete call;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            --alive_;
        }
        gone_.notify_all();
    }
    ScheduleSync();
    return made ? callId : -1;
}

bool CallTable::Answer(int callId, bool video) {
    int pjsuaId = PJSUA_INVALID_ID;
    unsigned videoCount = 0;
    int recvOnly = -1;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (slot) {
            pjsuaId = slot->pjsuaId;
            videoCount = slot->ringVideoCount;
            recvOnly = slot->ringRecvOnly;
        }
    }
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    // Atende primeiro: se o 200 não sai, nada muda na outra. O 200 repete o setting do 180 (ou do 183), mesmo que a
    // negociação do 183 tenha recusado o vídeo: o pjsua guarda o primeiro e reclama de um diferente.
#if PJMEDIA_HAS_VIDEO
    const pjsua_call_setting setting = RingSetting(videoCount, recvOnly);
    const pjsua_call_setting* answer = &setting;
#else
    (void)videoCount;
    (void)recvOnly;
    const pjsua_call_setting* answer = nullptr;
#endif
    if (pjsua_call_answer2(pjsuaId, answer, PJSIP_SC_OK, nullptr, nullptr) != PJ_SUCCESS) return false;
#if PJMEDIA_HAS_VIDEO
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot) {
            // "Atender com vídeo": a câmera manda depois da confirmação; sem câmera, ela fica desligada.
            const bool noCamera = video && camera_ == PJMEDIA_VID_INVALID_DEV;
            if (noCamera) Problem(CameraProblem::NoCamera);
            slot->wish = video && !noCamera;
            slot->early = false;
            PublishVideo();
        }
    }
#else
    (void)video;
#endif
    Focus(callId);   // e o SyncVideo, que liga a câmera depois da confirmação
    return true;
}

bool CallTable::Reject(int callId) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    return pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_BUSY_HERE, nullptr, nullptr) == PJ_SUCCESS;
}

bool CallTable::Hangup(int callId) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    // O fim desfaz a mídia da ligação: nunca no meio de um SyncVideo (ver o topo do arquivo).
    std::lock_guard<std::mutex> videoLock(videoMutex_);
    return pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr) == PJ_SUCCESS;
}

bool CallTable::Activate(int callId) {
    bool resume;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot || !slot->confirmed) return false;
        resume = slot->held;
    }
    Focus(callId);   // na conferência, a desfaz: é o Split(callId, a outra)
    const bool done = !resume || Renegotiate(callId, false);
    ScheduleSync();
    return done;
}

bool CallTable::SetHold(int callId, bool hold) {
    if (!hold) return Activate(callId);   // retomar é tornar a ativa
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot || !slot->confirmed) return false;
        if (slot->held) return true;
    }
    const bool done = Renegotiate(callId, true);
    ScheduleSync();
    return done;
}

bool CallTable::SendDtmf(int callId, const std::string& digits) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID || digits.empty() || digits.find_first_not_of(kDtmfDigits) != std::string::npos) {
        return false;
    }
    pjsua_call_send_dtmf_param param;
    pjsua_call_send_dtmf_param_default(&param);
    // O perfil manda: info vai por SIP INFO; rfc2833, auto e inband, por RFC 2833.
    param.method = dtmf_ == DtmfMethod::SipInfo ? PJSUA_DTMF_METHOD_SIP_INFO : PJSUA_DTMF_METHOD_RFC2833;
    param.digits = pj_str(const_cast<char*>(digits.c_str()));
    const pj_status_t status = pjsua_call_send_dtmf(pjsuaId, &param);
    if (status != PJ_SUCCESS) Log(2, "DTMF: " + StatusText(status));
    return status == PJ_SUCCESS;
}

bool CallTable::Transfer(int callId, const std::string& uri) {
    int pjsuaId;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (!slot || slot->pjsuaId == PJSUA_INVALID_ID) return false;
        pjsuaId = slot->pjsuaId;
        // Antes do REFER (o resultado pode chegar antes de o pjsua voltar): até ele, a imagem pausa.
        slot->transferring = true;
        PublishVideo();
    }
    pj_str_t destination = pj_str(const_cast<char*>(uri.c_str()));
    const pj_status_t status = pjsua_call_xfer(pjsuaId, &destination, nullptr);
    if (status != PJ_SUCCESS) {
        Log(2, "transferencia para " + uri + ": " + StatusText(status));
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot) {
            slot->transferring = false;
            PublishVideo();
        }
    }
    ScheduleSync();
    return status == PJ_SUCCESS;
}

bool CallTable::TransferAttended(int callId, int targetCallId) {
    int pjsuaId;
    int targetPjsuaId;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        const Slot* target = Find(targetCallId);
        if (callId == targetCallId || !slot || !target || !slot->confirmed || !target->confirmed) return false;
        pjsuaId = slot->pjsuaId;
        targetPjsuaId = target->pjsuaId;
        if (pjsuaId == PJSUA_INVALID_ID || targetPjsuaId == PJSUA_INVALID_ID) return false;
        // Antes do REFER: o resultado pode chegar antes de o pjsua voltar. Até ele, a imagem pausa.
        slot->transferTarget = targetCallId;
        slot->transferring = true;
        PublishVideo();
    }
    // O mesmo que pj::Call::xferReplaces, pelos ids: o Refer-To é o colega com o diálogo dele (Replaces) e
    // o Require: replaces.
    const pj_status_t status = pjsua_call_xfer_replaces(pjsuaId, targetPjsuaId, 0, nullptr);
    if (status != PJ_SUCCESS) {
        Log(2, "transferencia com consulta: " + StatusText(status));
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(callId);
        if (slot && slot->transferTarget == targetCallId) slot->transferTarget = 0;
        if (slot) {
            slot->transferring = false;
            PublishVideo();
        }
    }
    ScheduleSync();
    return status == PJ_SUCCESS;
}

bool CallTable::Join(int callId, int otherId) {
    bool resume;
    bool resumeOther;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        const Slot* other = Find(otherId);
        if (callId == otherId || !slot || !other || !slot->confirmed || !other->confirmed) return false;
        // Com uma consulta em andamento, primeiro ela termina (concluída ou cancelada).
        if (slot->transferTarget != 0 || other->transferTarget != 0) return false;
        if (conference_) return true;
        resume = slot->held;
        resumeOther = other->held;
    }
    // Retoma a que está em espera (as duas, se as duas estão); se o PJSIP recusa, nada muda.
    if (resume && !Renegotiate(callId, false)) return false;
    if (resumeOther && !Renegotiate(otherId, false)) return false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!Find(callId) || !Find(otherId)) return false;   // uma acabou no meio
        conference_ = true;
        activeId_ = 0;
        PublishVideo();   // na conferência, as duas ficam só com a voz
    }
    // A retomada liga a que estava em espera quando a mídia dela voltar (MediaChanged).
    Route();
    ScheduleSync();
    return true;
}

bool CallTable::Split(int callId, int otherId) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        const Slot* other = Find(otherId);
        if (callId == otherId || !slot || !other || !slot->confirmed || !other->confirmed) return false;
    }
    // As duas são as da tabela: callId ativa, a outra (otherId) em espera.
    return Activate(callId);
}

std::vector<int> CallTable::AudioLinks(int callId) {
    std::vector<int> links;
    int pjsuaId;
    int otherId = 0;
    int otherPjsuaId = PJSUA_INVALID_ID;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot) return links;
        pjsuaId = slot->pjsuaId;
        const Slot* other = Other(slot);
        if (other) {
            otherId = other->callId;
            otherPjsuaId = other->pjsuaId;
        }
    }
    if (pjsuaId == PJSUA_INVALID_ID) return links;
    const pjsua_conf_port_id port = pjsua_call_get_conf_port(pjsuaId);
    pjsua_conf_port_info info;
    if (port == PJSUA_INVALID_ID || pjsua_conf_get_port_info(port, &info) != PJ_SUCCESS) return links;
    const pjsua_conf_port_id otherPort =
        otherPjsuaId == PJSUA_INVALID_ID ? PJSUA_INVALID_ID : pjsua_call_get_conf_port(otherPjsuaId);
    for (unsigned index = 0; index < info.listener_cnt; ++index) {
        const pjsua_conf_port_id sink = info.listeners[index];
        if (sink == kSoundDevice) {
            links.push_back(0);
        } else if (otherPort != PJSUA_INVALID_ID && sink == otherPort) {
            links.push_back(otherId);
        }
    }
    return links;
}

int CallTable::CallCount() {
    std::lock_guard<std::mutex> lock(mutex_);
    int count = 0;
    for (const Slot& slot : slots_) count += slot.callId != 0 ? 1 : 0;
    return count;
}

bool CallTable::End(int timeoutMs) {
    std::vector<int> pjsuaIds;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (alive_ == 0) return true;
        for (const Slot& slot : slots_) {
            if (slot.pjsuaId != PJSUA_INVALID_ID) pjsuaIds.push_back(slot.pjsuaId);
        }
    }
    {
        std::lock_guard<std::mutex> videoLock(videoMutex_);   // como no Hangup
        for (const int pjsuaId : pjsuaIds) pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);
    }
    std::unique_lock<std::mutex> lock(mutex_);
    return gone_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return alive_ == 0; });
}

void CallTable::Close() {
    std::lock_guard<std::mutex> lock(mutex_);
    closed_ = true;
}

CallTable::Slot* CallTable::Find(int callId) {
    if (callId == 0) return nullptr;
    for (Slot& slot : slots_) {
        if (slot.callId == callId) return &slot;
    }
    return nullptr;
}

CallTable::Slot* CallTable::Find(const EngineCall* call) {
    if (!call) return nullptr;
    for (Slot& slot : slots_) {
        if (slot.call == call) return &slot;
    }
    return nullptr;
}

CallTable::Slot* CallTable::FreeSlot() {
    for (Slot& slot : slots_) {
        if (slot.callId == 0) return &slot;
    }
    return nullptr;
}

CallTable::Slot* CallTable::Other(const Slot* slot) {
    Slot* other = slot == &slots_[0] ? &slots_[1] : &slots_[0];
    return other->callId != 0 ? other : nullptr;
}

int CallTable::PjsuaId(int callId) {
    std::lock_guard<std::mutex> lock(mutex_);
    const Slot* slot = Find(callId);
    return slot ? slot->pjsuaId : PJSUA_INVALID_ID;
}

void CallTable::Focus(int callId) {
    int otherId = 0;
    bool holdOther = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot) return;
        activeId_ = callId;
        conference_ = false;
        const Slot* other = Other(slot);
        if (other) {
            otherId = other->callId;
            holdOther = other->confirmed && !other->held;
        }
        PublishVideo();   // a outra, se há, pausa o vídeo já
    }
    // A outra sai do som na hora e callId entra (com a mídia já ativa; senão, quando ela ficar ativa:
    // MediaChanged); a câmera dela para logo (SyncVideo), e a espera dela (re-INVITE) vem em seguida.
    Route();
    ScheduleSync();
    if (holdOther) Renegotiate(otherId, true);
}

void CallTable::Route() {
    std::lock_guard<std::mutex> routeLock(routeMutex_);
    int pjsuaIds[2];
    bool sound[2];
    bool conference;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (int index = 0; index < 2; ++index) {
            const Slot& slot = slots_[index];
            pjsuaIds[index] = slot.pjsuaId;
            sound[index] = slot.callId != 0 && (conference_ || slot.callId == activeId_);
        }
        conference = conference_;
    }
    pjsua_conf_port_id ports[2];
    bool usable[2];
    for (int index = 0; index < 2; ++index) {
        ports[index] = AudioPort(pjsuaIds[index], &usable[index]);
        if (ports[index] == PJSUA_INVALID_ID) continue;
        const bool on = sound[index] && usable[index];
        Link(kSoundDevice, ports[index], on);
        Link(ports[index], kSoundDevice, on);
    }
    if (ports[0] != PJSUA_INVALID_ID && ports[1] != PJSUA_INVALID_ID) {
        const bool on = conference && usable[0] && usable[1];
        Link(ports[0], ports[1], on);
        Link(ports[1], ports[0], on);
    }
    // Os pedidos de portas que já não são das ligações saem da conta: a mesa desfaz as ligações de uma
    // porta quando a tira (mídia recriada ou ligação acabada), e o número dela pode voltar noutra.
    const auto ours = [&ports](int port) { return port == kSoundDevice || port == ports[0] || port == ports[1]; };
    for (auto it = linksAsked_.begin(); it != linksAsked_.end();) {
        it = ours(it->first) && ours(it->second) ? std::next(it) : linksAsked_.erase(it);
    }
}

void CallTable::Link(int source, int sink, bool on) {
    const std::pair<int, int> link(source, sink);
    const bool asked = linksAsked_.count(link) != 0;
    // Pula só quando o último pedido e o estado aplicado já são o que se quer. O estado aplicado sozinho
    // não basta: um pedido ainda na fila da mesa não aparece nele, e o pedido que o desfaz seria pulado.
    if (asked == on && Transmits(source, sink) == on) return;
    const pj_status_t status = on ? pjsua_conf_connect(source, sink) : pjsua_conf_disconnect(source, sink);
    if (on) {
        linksAsked_.insert(link);
    } else {
        linksAsked_.erase(link);
    }
    if (status != PJ_SUCCESS) Log(2, "audio da ligacao: " + StatusText(status));
}

bool CallTable::Renegotiate(int callId, bool hold) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kRenegotiationWaitMs);
    for (;;) {
        int pjsuaId = PJSUA_INVALID_ID;
        unsigned videoCount = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            const Slot* slot = Find(callId);
            if (slot) {
                pjsuaId = slot->pjsuaId;
                videoCount = slot->videoCount;
            }
        }
        if (pjsuaId == PJSUA_INVALID_ID) return false;
        pj_status_t status;
        if (hold) {
            status = pjsua_call_set_hold(pjsuaId, nullptr);   // a oferta é a mídia de agora, com o vídeo dela
        } else {
            pjsua_call_setting setting;
            pjsua_call_setting_default(&setting);
            setting.flag |= PJSUA_CALL_UNHOLD;
            setting.vid_cnt = videoCount;   // a oferta nova leva o mesmo número de vídeos da ligação
            status = pjsua_call_reinvite2(pjsuaId, &setting, nullptr);
        }
        // PJ_EINVALIDOP: o re-INVITE anterior ainda não terminou (o PJSIP só aceita um por vez).
        if (status != PJ_EINVALIDOP || std::chrono::steady_clock::now() >= deadline) {
            if (status != PJ_SUCCESS) {
                Log(2, std::string(hold ? "espera: " : "retomar: ") + StatusText(status));
                return false;
            }
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot) slot->held = hold;
            PublishVideo();   // na espera daqui, o vídeo pausa; fora dela, volta
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

void CallTable::Emit(int callId, EventQueue::Event event) {
    try {
        if (dialing_) {
            held_.push_back(HeldEvent{callId, std::move(event)});
        } else {
            events_->Post(std::move(event));
        }
    } catch (...) {   // sem memória: o evento se perde, a ligação segue
    }
}

}  // namespace starsonic
