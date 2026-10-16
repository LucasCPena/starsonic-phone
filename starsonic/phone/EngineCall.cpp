#include "EngineCall.h"

#include <algorithm>
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

// A porta 0 da ponte de áudio: o microfone e o alto-falante (o dispositivo de som).
const pjsua_conf_port_id kSoundDevice = 0;

// A porta port da ponte transmite para a porta sink.
bool Transmits(pjsua_conf_port_id port, pjsua_conf_port_id sink) {
    pjsua_conf_port_info info;
    if (pjsua_conf_get_port_info(port, &info) != PJ_SUCCESS) return false;
    return std::find(info.listeners, info.listeners + info.listener_cnt, sink) != info.listeners + info.listener_cnt;
}

// Liga ou desliga o áudio da ligação pjsuaId do dispositivo de som, nos dois sentidos. Como o
// MicroSIP: com linked, a mídia ativa (ou em espera do outro lado) fala e ouve pelo aparelho; em
// espera daqui ou sem mídia, fica fora do som. A ponte aplica a mudança no tique seguinte do relógio.
void RouteAudio(int pjsuaId, bool linked) {
    pjsua_call_info info;
    if (pjsuaId == PJSUA_INVALID_ID || pjsua_call_get_info(pjsuaId, &info) != PJ_SUCCESS) return;
    for (unsigned index = 0; index < info.media_cnt; ++index) {
        const pjsua_call_media_info& media = info.media[index];
        if (media.type != PJMEDIA_TYPE_AUDIO) continue;
        const pjsua_conf_port_id port = media.stream.aud.conf_slot;
        if (port == PJSUA_INVALID_ID) continue;
        const bool on = linked && (media.status == PJSUA_CALL_MEDIA_ACTIVE ||
                                   media.status == PJSUA_CALL_MEDIA_REMOTE_HOLD);
        if (on == Transmits(port, kSoundDevice)) continue;   // já está como deve
        pj_status_t status;
        if (on) {
            status = pjsua_conf_connect(kSoundDevice, port);
            if (status == PJ_SUCCESS) status = pjsua_conf_connect(port, kSoundDevice);
        } else {
            status = pjsua_conf_disconnect(kSoundDevice, port);
            if (status == PJ_SUCCESS) status = pjsua_conf_disconnect(port, kSoundDevice);
        }
        if (status != PJ_SUCCESS) Log(2, "audio da ligacao: " + StatusText(status));
    }
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

void CallTable::Incoming(pj::Account& account, int pjsuaId, bool accepting) {
    const RemoteParty party = PartyOf(pjsuaId);
    int callId = 0;
    bool busy = false;
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
    // O 180 vem depois do aviso: o Early que ele provoca chega ao listener depois do OnIncomingCall.
    const pj_status_t status = pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_RINGING, nullptr, nullptr);
    if (status != PJ_SUCCESS) Log(2, "nao foi possivel tocar a ligacao (180): " + StatusText(status));
}

void CallTable::StateChanged(EngineCall* call, CallState state, int sipCode) {
    std::lock_guard<std::mutex> lock(mutex_);
    Slot* slot = Find(call);
    if (!slot) return;
    if (state == CallState::Confirmed) slot->confirmed = true;
    const int callId = slot->callId;
    Emit(callId, [callId, state, sipCode](EngineListener& listener) { listener.OnCallState(callId, state, sipCode); });
}

void CallTable::MediaChanged(EngineCall* call) {
    bool active;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(call);
        active = slot && slot->callId == activeId_;
    }
    // O id vem do objeto: numa ligação feita, a vaga só recebe o id no pjsua depois do makeCall.
    RouteAudio(call->getId(), active);
}

void CallTable::Ended(EngineCall* call, int sipCode) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Slot* slot = Find(call);
        if (slot) {
            const int callId = slot->callId;
            *slot = Slot();
            // A outra não volta sozinha: quem a retoma é o app, pelo Activate.
            if (activeId_ == callId) activeId_ = 0;
            Emit(callId, [callId, sipCode](EngineListener& listener) {
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
        if (sipCode / 100 == 2) {
            pjsuaId = slot->pjsuaId;
            if (target) targetPjsuaId = target->pjsuaId;
        }
    }
    if (sipCode / 100 != 2) {   // as ligações seguem como estavam
        Log(2, "a transferencia nao deu certo (" + std::to_string(sipCode) + ")");
        return;
    }
    // Deu certo: esta ligação acabou, como no MicroSIP, e na consulta a do colega também (o outro lado
    // ligou um ao outro). Os fins chegam pelos callbacks de sempre, depois do aviso.
    Log(3, "transferencia aceita (" + std::to_string(sipCode) + "): desligando " +
               (targetPjsuaId != PJSUA_INVALID_ID ? "as ligacoes" : "a ligacao"));
    if (pjsuaId != PJSUA_INVALID_ID) pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);   // pode apagar call
    if (targetPjsuaId != PJSUA_INVALID_ID) pjsua_call_hangup(targetPjsuaId, 0, nullptr, nullptr);
}

int CallTable::Make(pj::Account& account, const std::string& uri) {
    EngineCall* call = nullptr;
    int callId = 0;
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
    }
    // A outra, se há, vai para a espera antes de a nova sair, e fica nela mesmo se a nova não sai.
    Focus(callId);
    {
        std::lock_guard<std::mutex> lock(mutex_);
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
    // Atende primeiro: se o 200 não sai, nada muda na outra.
    if (pjsua_call_answer2(pjsuaId, nullptr, PJSIP_SC_OK, nullptr, nullptr) != PJ_SUCCESS) return false;
    Focus(callId);
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
    Focus(callId);
    return !resume || Renegotiate(callId, false);
}

bool CallTable::SetHold(int callId, bool hold) {
    if (!hold) return Activate(callId);   // retomar é tornar a ativa
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot || !slot->confirmed) return false;
        if (slot->held) return true;
    }
    return Renegotiate(callId, true);
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
        // Antes do REFER: o resultado pode chegar antes de o pjsua voltar.
        slot->transferTarget = targetCallId;
    }
    // O mesmo que pj::Call::xferReplaces, pelos ids: o Refer-To é o colega com o diálogo dele (Replaces) e
    // o Require: replaces.
    const pj_status_t status = pjsua_call_xfer_replaces(pjsuaId, targetPjsuaId, 0, nullptr);
    if (status == PJ_SUCCESS) return true;
    Log(2, "transferencia com consulta: " + StatusText(status));
    std::lock_guard<std::mutex> lock(mutex_);
    Slot* slot = Find(callId);
    if (slot && slot->transferTarget == targetCallId) slot->transferTarget = 0;
    return false;
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
    for (const int pjsuaId : pjsuaIds) pjsua_call_hangup(pjsuaId, 0, nullptr, nullptr);
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
    int pjsuaId;
    int otherId = 0;
    int otherPjsuaId = PJSUA_INVALID_ID;
    bool holdOther = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const Slot* slot = Find(callId);
        if (!slot) return;
        activeId_ = callId;
        pjsuaId = slot->pjsuaId;
        const Slot* other = Other(slot);
        if (other) {
            otherId = other->callId;
            otherPjsuaId = other->pjsuaId;
            holdOther = other->confirmed && !other->held;
        }
    }
    // A outra sai do som na hora; a espera dela (re-INVITE) vem em seguida.
    RouteAudio(otherPjsuaId, false);
    if (holdOther) Renegotiate(otherId, true);
    // Com a mídia já ativa, o som vem agora; senão, quando ela ficar ativa (MediaChanged).
    RouteAudio(pjsuaId, true);
}

bool CallTable::Renegotiate(int callId, bool hold) {
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
            if (status != PJ_SUCCESS) {
                Log(2, std::string(hold ? "espera: " : "retomar: ") + StatusText(status));
                return false;
            }
            std::lock_guard<std::mutex> lock(mutex_);
            Slot* slot = Find(callId);
            if (slot) slot->held = hold;
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
