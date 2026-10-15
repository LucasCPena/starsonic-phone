#include "EngineAccount.h"

#include <chrono>
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
        if (!retired_) {
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

}  // namespace starsonic
