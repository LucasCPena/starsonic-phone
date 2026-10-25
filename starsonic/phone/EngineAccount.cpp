#include "EngineAccount.h"

#include <chrono>
#include <cstring>
#include <string>

#include "EngineCall.h"
#include "EngineEvents.h"
#include "EngineLog.h"

namespace starsonic {

pj::AccountConfig MakeAccountConfig(const PjAccountSettings& settings, pj::TransportId transportId) {
    pj::AccountConfig config;
    config.idUri = settings.idUri;
    config.regConfig.registrarUri = settings.registrarUri;
    config.regConfig.timeoutSec = static_cast<unsigned>(settings.regTimeoutSec);
    if (!settings.proxyUri.empty()) config.sipConfig.proxies.push_back(settings.proxyUri);
    config.sipConfig.authCreds.push_back(pj::AuthCredInfo("digest", "*", settings.authUser, 0, settings.authPassword));
    config.sipConfig.transportId = transportId;
    // Como o MicroSIP: nada de reescrever Contact, Via ou SDP, sem ICE e SRTP sem exigir sinalização
    // segura (o perfil usa UDP e TCP).
    config.natConfig.udpKaIntervalSec = static_cast<unsigned>(settings.udpKeepAliveSec);
    config.natConfig.contactRewriteUse = 0;
    config.natConfig.viaRewriteUse = 0;
    config.natConfig.sdpNatRewriteUse = 0;
    config.natConfig.iceEnabled = false;
    config.mediaConfig.srtpUse = static_cast<pjmedia_srtp_use>(settings.srtpUse);
    config.mediaConfig.srtpSecureSignaling = 0;
    return config;
}

EngineAccount::EngineAccount(EventQueue* events, CallTable* calls, EngineEndpoint* endpoint, int id)
    : events_(events), calls_(calls), endpoint_(endpoint), id_(id) {
    endpoint_->AddTimerTarget(id_, this);
}

EngineAccount::~EngineAccount() { endpoint_->RemoveTimerTarget(id_); }

void EngineAccount::Retire() {
    retired_ = true;
    wantRegistered_ = false;
    endpoint_->RemoveTimerTarget(id_);   // espera um registro adiado que esteja saindo
}

void EngineAccount::Start(const pj::AccountConfig& config, bool paused, std::function<void()> onActive) {
    onActive_ = std::move(onActive);
    config_ = config;
    // Só o Modify troca a configuração depois: ele nunca registra nem retira o registro por conta própria.
    config_.regConfig.disableRegOnModify = true;
    pj::AccountConfig first = config_;
    if (paused) {
        first.regConfig.registerOnAdd = false;
        first.regConfig.retryIntervalSec = 0;
        paused_ = true;
    }
    create(first, true);
}

void EngineAccount::Modify(const pj::AccountConfig& config) {
    try {
        modify(config);
    } catch (const pj::Error& error) {
        Log(2, "nao foi possivel trocar a configuracao da conta: " + error.info());
    }
}

void EngineAccount::Pause() {
    paused_ = true;
    wantRegistered_ = false;
    staleInactive_ = false;
    // Com o intervalo em zero o pjsua não agenda nova tentativa: nem depois de uma falha (a renovação que não
    // chega, sem rede) nem quando a conexão TCP cai. O registro não sai do servidor: o pedido de saída só chegaria
    // a ele com o "sem rede" errado (a central alcançável), e aí ela apagaria o registro e o telefone não tocaria.
    pj::AccountConfig stopped = config_;
    stopped.regConfig.retryIntervalSec = 0;
    Modify(stopped);
}

void EngineAccount::Resume() {
    Modify(config_);
    resumed_ = true;   // antes do paused_: a primeira resposta boa daqui em diante é a volta (onActive)
    paused_ = false;
    Register();
}

void EngineAccount::Register() {
    // Antes do pedido: uma resposta que chegue entre o PJSIP_EBUSY e o fim daqui já encontra o pedido.
    wantRegistered_ = true;
    try {
        setRegistration(true);
        wantRegistered_ = false;
        return;
    } catch (const pj::Error& error) {
        if (error.status != PJSIP_EBUSY) {
            wantRegistered_ = false;
            Log(2, "nao foi possivel registrar de novo: " + error.info());
            return;
        }
    }
    // PJSIP_EBUSY: um pedido (renovação ou a saída de um Pause sem resposta) ainda está a caminho. Esperar a
    // resposta aqui não resolve (o UDP repete o pedido por até 32 s); o registro vai depois dela.
    staleInactive_ = true;
    Log(3, "um pedido de registro em andamento: o registro novo vai logo depois da resposta dele");
}

void EngineAccount::OnEngineTimer() {
    if (retired_ || paused_) return;
    try {
        setRegistration(true);
    } catch (const pj::Error& error) {
        Log(2, "registro adiado: " + error.info());
    }
}

EngineAccount::Exit EngineAccount::Unregister(int timeoutMs) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    try {
        if (!getInfo().regIsConfigured) return Exit::NothingToRemove;
    } catch (const pj::Error&) {
        return Exit::NothingToRemove;
    }
    for (;;) {
        unsigned seen;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            seen = results_;
            inactive_ = false;
        }
        try {
            setRegistration(false);
            break;
        } catch (const pj::Error& error) {
            // PJ_EINVALIDOP: a conta já não tem registro (o último pedido falhou), nada a retirar.
            if (error.status == PJ_EINVALIDOP) return Exit::NothingToRemove;
            if (error.status != PJSIP_EBUSY) {
                Log(2, "nao foi possivel retirar o registro: " + error.info());
                return Exit::NoAnswer;
            }
        }
        // PJSIP_EBUSY: um REGISTER ainda está a caminho. Sem esperar, o servidor ficaria com o registro
        // que ele vai aceitar; a saída vai depois da resposta dele.
        Log(3, "um REGISTER em andamento: a saida da conta espera a resposta dele");
        std::unique_lock<std::mutex> lock(mutex_);
        if (!changed_.wait_until(lock, deadline, [&] { return results_ != seen; })) return Exit::NoAnswer;
    }
    std::unique_lock<std::mutex> lock(mutex_);
    if (!changed_.wait_until(lock, deadline, [this] { return inactive_; })) return Exit::NoAnswer;
    if (lastCode_ / 100 == 2) return Exit::Confirmed;
    const int code = lastCode_;
    lock.unlock();
    Log(2, "o servidor respondeu " + std::to_string(code) + " ao pedido de saida");
    return Exit::NoAnswer;
}

void EngineAccount::onRegState(pj::OnRegStateParam& param) {
    try {
        bool active = param.code / 100 == 2 && param.expiration > 0;
        try {
            active = getInfo().regIsActive;
        } catch (const pj::Error&) {
        }
        bool stale = false;
        if (active) {
            wantRegistered_ = false;
            staleInactive_ = false;
        } else {
            stale = staleInactive_.exchange(false);
            // O registro que Register adiou: fora deste callback (a trava do pjsua está presa e o regc pode
            // ter acabado de sair), uma vez só; se ele falhar, as novas tentativas são as do PJSIP.
            if (wantRegistered_.exchange(false) && !retired_ && !paused_) endpoint_->ScheduleTimer(id_);
        }
        if (active && !retired_ && !paused_ && onActive_) {
            // A volta: de sem registro a registrada, ou a primeira resposta boa depois do Resume (sem o pedido de
            // saída no Pause, o registro pode ter continuado vivo, e o BLF recusado na volta precisa de outra
            // tentativa).
            const bool resumed = resumed_.exchange(false);
            if (!wasActive_ || resumed) onActive_();
        }
        wasActive_ = active;
        if (!retired_ && !paused_ && !stale) {
            const int code = static_cast<int>(param.code);
            const int id = id_;
            events_->Post([code, active, id](EngineListener& listener) { listener.OnRegistration(code, active, id); });
        }
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ++results_;
            inactive_ = !active;
            lastCode_ = static_cast<int>(param.code);
        }
        changed_.notify_all();
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

void EngineAccount::onIncomingCall(pj::OnIncomingCallParam& param) {
    try {
        calls_->Incoming(*this, param.callId, !retired_);
    } catch (...) {   // sem objeto de ligação, o pjsua2 recusa a ligação com 500
    }
}

void BlfTrack::OnNotify(bool full, const std::vector<std::pair<std::string, std::string>>& dialogs) {
    std::lock_guard<std::mutex> lock(mutex_);
    dialogs_.Apply(full, dialogs);
    Report(dialogs_.State());
}

void BlfTrack::SetUnknown(bool ended) {
    std::lock_guard<std::mutex> lock(mutex_);
    dialogs_.Clear();
    if (ended) ended_ = true;
    Report(BlfState::Unknown);
}

void BlfTrack::Restart() {
    std::lock_guard<std::mutex> lock(mutex_);
    dialogs_.Clear();
    ended_ = false;
}

bool BlfTrack::Ended() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return ended_;
}

void BlfTrack::Report(BlfState state) {
    const int value = static_cast<int>(state);
    if (last_ == value) return;
    last_ = value;
    const std::string number = number_;
    events_->Post([number, state](EngineListener& listener) { listener.OnBlf(number, state); });
}

namespace {

pj_str_t Str(const char* text) {
    pj_str_t value;
    value.ptr = const_cast<char*>(text);
    value.slen = static_cast<pj_ssize_t>(std::strlen(text));
    return value;
}

std::string Text(const pj_str_t& value) {
    return value.slen > 0 ? std::string(value.ptr, static_cast<size_t>(value.slen)) : std::string();
}

// Os <dialog> de um dialog-info (RFC 4235): (id, <state>), na ordem; full: state="full" (o padrão) ou
// "partial". false se o corpo não é um dialog-info. Um diálogo sem id leva o número dele na lista.
bool ParseDialogInfo(const std::string& body, bool* full, std::vector<std::pair<std::string, std::string>>* dialogs) {
    pj_pool_t* pool = pjsua_pool_create("blf", 1024, 1024);
    if (!pool) return false;
    std::vector<char> text(body.begin(), body.end());
    text.push_back('\0');
    bool ok = false;
    const pj_xml_node* root = pj_xml_parse(pool, text.data(), body.size());
    pj_str_t name = Str("dialog-info");
    if (root && pj_stricmp(&root->name, &name) == 0) {
        ok = true;
        pj_str_t stateName = Str("state");
        pj_str_t dialogName = Str("dialog");
        pj_str_t idName = Str("id");
        const pj_xml_attr* state = pj_xml_find_attr(root, &stateName, nullptr);
        *full = !state || Text(state->value) != "partial";
        int index = 0;
        for (const pj_xml_node* dialog = pj_xml_find_node(root, &dialogName); dialog;
             dialog = pj_xml_find_next_node(root, dialog, &dialogName)) {
            ++index;
            const pj_xml_attr* id = pj_xml_find_attr(dialog, &idName, nullptr);
            const pj_xml_node* node = pj_xml_find_node(dialog, &stateName);
            dialogs->push_back(std::make_pair(id ? Text(id->value) : "#" + std::to_string(index),
                                              node ? Text(node->content) : std::string()));
        }
    }
    pj_pool_release(pool);
    return ok;
}

}  // namespace

void BlfBuddy::onBuddyEvSubDlgEventState(pj::OnBuddyEvSubStateParam& param) {
    try {
        pjsua_buddy_dlg_event_info info;
        if (pjsua_buddy_get_dlg_event_info(getId(), &info) != PJ_SUCCESS) return;
        if (info.sub_state == PJSIP_EVSUB_STATE_TERMINATED) {
            track_->SetUnknown(true);
            return;
        }
        // Só um NOTIFY com corpo traz diálogos (o 200 do SUBSCRIBE e as renovações não).
        const pjsip_event* event = static_cast<const pjsip_event*>(param.e.pjEvent);
        if (!event || event->type != PJSIP_EVENT_TSX_STATE || event->body.tsx_state.type != PJSIP_EVENT_RX_MSG) return;
        const pjsip_rx_data* rdata = event->body.tsx_state.src.rdata;
        const pjsip_msg* msg = rdata ? rdata->msg_info.msg : nullptr;
        if (!msg || msg->type != PJSIP_REQUEST_MSG || !msg->body ||
            pjsip_method_cmp(&msg->line.req.method, pjsip_get_notify_method()) != 0) {
            return;
        }
        const std::string body(static_cast<const char*>(msg->body->data), msg->body->len);
        bool full = true;
        std::vector<std::pair<std::string, std::string>> dialogs;
        if (!ParseDialogInfo(body, &full, &dialogs)) {
            Log(2, "BLF: NOTIFY sem dialog-info valido, ignorado");
            return;
        }
        track_->OnNotify(full, dialogs);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

}  // namespace starsonic
