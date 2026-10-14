#include "EngineCall.h"

#include <chrono>
#include <thread>
#include <utility>

#include "EngineLog.h"

namespace starsonic {
namespace {

// Quanto SetHold espera uma renegociação anterior terminar (o PJSIP só aceita um re-INVITE por vez).
const int kRenegotiationWaitMs = 2000;
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
        const pj::CallInfo info = getInfo();
        pj::AudDevManager& devices = pj::Endpoint::instance().audDevManager();
        for (unsigned index = 0; index < info.media.size(); ++index) {
            const pj::CallMediaInfo& media = info.media[index];
            if (media.type != PJMEDIA_TYPE_AUDIO) continue;
            try {
                pj::AudioMedia audio = getAudioMedia(static_cast<int>(index));
                // Como o MicroSIP: ativa (ou em espera do outro lado), a ligação fala e ouve pelo
                // aparelho; em espera daqui ou sem mídia, fica fora do som.
                if (media.status == PJSUA_CALL_MEDIA_ACTIVE || media.status == PJSUA_CALL_MEDIA_REMOTE_HOLD) {
                    devices.getCaptureDevMedia().startTransmit(audio);
                    audio.startTransmit(devices.getPlaybackDevMedia());
                } else {
                    devices.getCaptureDevMedia().stopTransmit(audio);
                    audio.stopTransmit(devices.getPlaybackDevMedia());
                }
            } catch (const pj::Error& failure) {
                Log(2, "audio da ligacao: " + failure.info());
            }
        }
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineCall::onCallTransferStatus(pj::OnCallTransferStatusParam& param) {
    try {
        if (param.statusCode / 100 != 2) return;
        // O outro lado avisou que a transferência deu certo (NOTIFY 2xx): esta ligação acabou, como no
        // MicroSIP. O 202 do REFER chega aqui como 100.
        param.cont = false;
        const int pjsuaId = getId();
        Log(3, "transferencia aceita (" + std::to_string(param.statusCode) + "): desligando a ligacao");
        pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);   // pode apagar este objeto: nada depois daqui
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineCall::onCallTransferRequest(pj::OnCallTransferRequestParam& param) {
    // Aceitar faria o pjsua abrir outra ligação presa a este objeto (uma segunda ligação, fora da
    // tabela, que ficaria com o objeto depois de ele se apagar). Uma ligação por vez: recusa.
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

void CallTable::Incoming(pj::Account& account, int pjsuaId, bool accepting) {
    const RemoteParty party = PartyOf(pjsuaId);
    int callId = 0;
    bool busy = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (accepting && !closed_ && callId_ == 0) {
            callId = nextId_++;
            call_ = new EngineCall(account, pjsuaId, this);   // daqui em diante os callbacks vão a ele
            callId_ = callId;
            pjsuaId_ = pjsuaId;
            ++alive_;
            Emit([callId, party](EngineListener& listener) { listener.OnIncomingCall(callId, party.user, party.name); });
        } else {
            busy = accepting && !closed_;
        }
    }
    if (callId == 0) {
        // Outra ligação em andamento: 486. A conta ou o motor saindo: 480.
        const unsigned code = busy ? PJSIP_SC_BUSY_HERE : PJSIP_SC_TEMPORARILY_UNAVAILABLE;
        Log(3, "ligacao de " + party.user + " recusada (" + std::to_string(code) + ")");
        pjsua_call_hangup(pjsuaId, code, nullptr, nullptr);
        if (busy) {
            events_->Post([party](EngineListener& listener) { listener.OnRejectedBusy(party.user, party.name); });
        }
        return;
    }
    // O 180 vem depois do aviso: o Early que ele provoca chega ao listener depois do OnIncomingCall.
    const pj_status_t status = pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_RINGING, nullptr, nullptr);
    if (status != PJ_SUCCESS) Log(2, "nao foi possivel tocar a ligacao (180): " + StatusText(status));
}

void CallTable::StateChanged(EngineCall* call, CallState state, int sipCode) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (call != call_) return;
    const int callId = callId_;
    Emit([callId, state, sipCode](EngineListener& listener) { listener.OnCallState(callId, state, sipCode); });
}

void CallTable::Ended(EngineCall* call, int sipCode) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (call == call_) {
            const int callId = callId_;
            call_ = nullptr;
            callId_ = 0;
            pjsuaId_ = PJSUA_INVALID_ID;
            Emit([callId, sipCode](EngineListener& listener) {
                listener.OnCallState(callId, CallState::Disconnected, sipCode);
            });
        }
    }
    delete call;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        --alive_;
    }
    gone_.notify_all();
}

int CallTable::Make(pj::Account& account, const std::string& uri) {
    EngineCall* call = nullptr;
    int callId = 0;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_ || callId_ != 0) {
            Log(2, "ligacao para " + uri + (closed_ ? " recusada: o motor esta saindo" : " recusada: ja ha uma ligacao"));
            return -1;
        }
        callId = nextId_++;
        call = new EngineCall(account, PJSUA_INVALID_ID, this);
        call_ = call;
        callId_ = callId;
        pjsuaId_ = PJSUA_INVALID_ID;
        ++alive_;
        dialing_ = true;
    }
    bool made = true;
    try {
        call->makeCall(uri, pj::CallOpParam(true));
    } catch (const pj::Error& failure) {
        made = false;
        Log(2, "nao foi possivel ligar para " + uri + ": " + failure.info());
    }
    bool unused = false;   // o pjsua não chegou a usar o objeto
    {
        std::lock_guard<std::mutex> lock(mutex_);
        dialing_ = false;
        std::vector<EventQueue::Event> held;
        held.swap(held_);
        if (made) {
            // Enquanto a trava está presa, Ended não apagou o objeto (ele limpa call_ antes).
            if (call_ == call) pjsuaId_ = call->getId();
            for (EventQueue::Event& event : held) events_->Post(std::move(event));
        } else if (call_ == call) {   // sem callback de fim: o objeto é nosso para apagar
            call_ = nullptr;
            callId_ = 0;
            unused = true;
        }
        // Se o makeCall falhou depois de um callback de fim, Ended já apagou o objeto; os eventos que
        // ficaram em held_ somem com ele: MakeCall devolve -1 sem evento nenhum.
    }
    if (unused) {
        delete call;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            --alive_;
        }
        gone_.notify_all();
    }
    return made ? callId : -1;
}

bool CallTable::Answer(int callId) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    return pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_OK, nullptr, nullptr) == PJ_SUCCESS;
}

bool CallTable::Reject(int callId) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    return pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_BUSY_HERE, nullptr, nullptr) == PJ_SUCCESS;
}

bool CallTable::Hangup(int callId) {
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    return pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr) == PJ_SUCCESS;
}

bool CallTable::SetHold(int callId, bool hold) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kRenegotiationWaitMs);
    for (;;) {
        const int pjsuaId = PjsuaId(callId);
        if (pjsuaId == PJSUA_INVALID_ID) return false;
        pj_status_t status;
        if (hold) {
            status = pjsua_call_set_hold(pjsuaId, nullptr);
        } else {
            pjsua_call_setting setting;
            pjsua_call_setting_default(&setting);
            setting.flag |= PJSUA_CALL_UNHOLD;
            status = pjsua_call_reinvite2(pjsuaId, &setting, nullptr);
        }
        // PJ_EINVALIDOP: o re-INVITE anterior ainda não terminou (o PJSIP só aceita um por vez).
        if (status != PJ_EINVALIDOP || std::chrono::steady_clock::now() >= deadline) {
            if (status != PJ_SUCCESS) Log(2, std::string(hold ? "espera: " : "retomar: ") + StatusText(status));
            return status == PJ_SUCCESS;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
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
    const int pjsuaId = PjsuaId(callId);
    if (pjsuaId == PJSUA_INVALID_ID) return false;
    pj_str_t destination = pj_str(const_cast<char*>(uri.c_str()));
    const pj_status_t status = pjsua_call_xfer(pjsuaId, &destination, nullptr);
    if (status != PJ_SUCCESS) Log(2, "transferencia para " + uri + ": " + StatusText(status));
    return status == PJ_SUCCESS;
}

bool CallTable::HasCall() {
    std::lock_guard<std::mutex> lock(mutex_);
    return callId_ != 0;
}

bool CallTable::End(int timeoutMs) {
    int pjsuaId;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (alive_ == 0) return true;
        pjsuaId = pjsuaId_;
    }
    if (pjsuaId != PJSUA_INVALID_ID) pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);
    std::unique_lock<std::mutex> lock(mutex_);
    return gone_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return alive_ == 0; });
}

void CallTable::Close() {
    std::lock_guard<std::mutex> lock(mutex_);
    closed_ = true;
}

int CallTable::PjsuaId(int callId) {
    std::lock_guard<std::mutex> lock(mutex_);
    return callId != 0 && callId == callId_ ? pjsuaId_ : PJSUA_INVALID_ID;
}

void CallTable::Emit(EventQueue::Event event) {
    try {
        if (dialing_) {
            held_.push_back(std::move(event));
        } else {
            events_->Post(std::move(event));
        }
    } catch (...) {   // sem memória: o evento se perde, a ligação segue
    }
}

}  // namespace starsonic
