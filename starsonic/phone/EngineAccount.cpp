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

EngineAccount::EngineAccount(EventQueue* events, CallTable* calls, int id) : events_(events), calls_(calls), id_(id) {}

void EngineAccount::Retire() { retired_ = true; }

void EngineAccount::Start(const pj::AccountConfig& config, bool paused) {
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

EngineAccount::Exit EngineAccount::Pause(int timeoutMs) {
    paused_ = true;
    // Com o intervalo em zero o pjsua não agenda nova tentativa: nem depois de uma falha (a do próprio
    // pedido de saída, sem rede) nem quando a conexão TCP cai.
    pj::AccountConfig stopped = config_;
    stopped.regConfig.retryIntervalSec = 0;
    Modify(stopped);
    return Unregister(timeoutMs);
}

bool EngineAccount::Resume(int timeoutMs) {
    Modify(config_);
    paused_ = false;
    return Register(timeoutMs);
}

bool EngineAccount::Register(int timeoutMs) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    for (;;) {
        unsigned seen;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            seen = results_;
        }
        try {
            setRegistration(true);
            return true;
        } catch (const pj::Error& error) {
            if (error.status != PJSIP_EBUSY) {
                Log(2, "nao foi possivel registrar de novo: " + error.info());
                return false;
            }
        }
        // PJSIP_EBUSY: um pedido (de registro ou de saída) ainda está a caminho; o novo vai depois dele.
        Log(3, "um pedido de registro em andamento: o registro novo espera a resposta dele");
        std::unique_lock<std::mutex> lock(mutex_);
        if (!changed_.wait_until(lock, deadline, [&] { return results_ != seen; })) {
            lock.unlock();
            Log(2, "o pedido de registro anterior nao terminou a tempo; o registro novo nao saiu");
            return false;
        }
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
        if (!retired_ && !paused_) {
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

BlfBuddy::BlfBuddy(EventQueue* events, const std::string& number) : events_(events) {
    const size_t size = number.size() < kMaxBlfNumber ? number.size() : kMaxBlfNumber;
    std::memcpy(number_, number.data(), size);
    number_[size] = '\0';
}

void BlfBuddy::onBuddyDlgEventState() {
    try {
        pjsua_buddy_dlg_event_info info;
        if (pjsua_buddy_get_dlg_event_info(getId(), &info) != PJ_SUCCESS) return;
        const bool ended = info.sub_state == PJSIP_EVSUB_STATE_TERMINATED;
        // O dialog-info traz state (full ou partial) e entity; sem eles ainda não chegou NOTIFY nenhum.
        const bool notified = info.dialog_info_state.slen > 0 || info.dialog_info_entity.slen > 0;
        const std::string dialog = info.dialog_state.slen > 0
                                       ? std::string(info.dialog_state.ptr, static_cast<size_t>(info.dialog_state.slen))
                                       : std::string();
        BlfState state;
        if (!BlfFromDialogInfo(ended, notified, dialog, &state)) return;
        const int value = static_cast<int>(state);
        if (last_.exchange(value) == value) return;
        const std::string number(number_);
        events_->Post([number, state](EngineListener& listener) { listener.OnBlf(number, state); });
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

}  // namespace starsonic
