#include "SipEngine.h"

#include <pjsua2.hpp>
#include <sys/socket.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <mutex>

#include "AccountConfig.h"
#include "AccountPolicy.h"
#include "Text.h"

namespace starsonic {
namespace {

const char kLogSender[] = "SipEngine";
const char kThreadName[] = "starsonic-caller";
// Quanto o motor espera o servidor confirmar a saída de uma conta antes de seguir sem a resposta.
const int kUnregisterWaitMs = 3000;
// Quanto o motor espera o pjsua refazer os transportes depois de uma troca de rede (leva alguns ms).
const int kIpChangeWaitMs = 2000;

// O pjsua tem estado global: um motor por processo.
std::mutex g_aliveMutex;
bool g_alive = false;

// Linha do motor no mesmo log do PJSIP (mesmo formato, mesmo filtro de nível, mesmo OnLog).
void Log(int level, const std::string& text) {
    try {
        pj::Endpoint::instance().utilLogWrite(level, kLogSender, text);
    } catch (...) {
    }
}

bool SameCodecId(const std::string& a, const std::string& b) {
    return a.size() == b.size() &&
           std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) {
               return std::tolower(static_cast<unsigned char>(x)) == std::tolower(static_cast<unsigned char>(y));
           });
}

// Entrega uma linha do PJSIP ao listener, sem o fim de linha.
void ForwardLog(EngineListener* listener, int level, std::string line) {
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    try {
        listener->OnLog(level, line);
    } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
    }
}

// O writer do pjsua2. O Endpoint é dono do objeto e o apaga no libDestroy.
class LogForwarder : public pj::LogWriter {
public:
    explicit LogForwarder(EngineListener* listener) : listener_(listener) {}

    void write(const pj::LogEntry& entry) override { ForwardLog(listener_, entry.level, entry.msg); }

private:
    EngineListener* listener_;
};

// O writer só entra no libInit, e o libCreate já escreve linhas: sem isto elas iriam para o terminal.
// Até lá o PJLIB entrega as linhas a EarlyLog, com o mesmo filtro de nível do writer. Só o Create
// mexe nestas variáveis, com g_aliveMutex.
std::atomic<EngineListener*> g_earlyListener{nullptr};
std::atomic<int> g_earlyLevel{0};

void EarlyLog(int level, const char* data, int length) {
    EngineListener* listener = g_earlyListener.load();
    if (listener && level <= g_earlyLevel.load() && data && length > 0) {
        ForwardLog(listener, level, std::string(data, static_cast<size_t>(length)));
    }
}

class EarlyLogScope {
public:
    EarlyLogScope(EngineListener* listener, int maxLevel) {
        g_earlyLevel = maxLevel;
        g_earlyListener = listener;
        pj_log_set_log_func(&EarlyLog);
    }
    ~EarlyLogScope() { g_earlyListener = nullptr; }

    EarlyLogScope(const EarlyLogScope&) = delete;
    EarlyLogScope& operator=(const EarlyLogScope&) = delete;
};

// O Endpoint do pjsua2 mais o aviso de quando a troca de rede termina.
class EngineEndpoint : public pj::Endpoint {
public:
    // Chamar antes de handleIpChange: o fim da troca anterior não vale para a próxima.
    void ExpectIpChange() {
        std::lock_guard<std::mutex> lock(mutex_);
        ipChangeDone_ = false;
    }

    // true: o pjsua refez os transportes e acabou de tratar as contas (ou nem havia conta).
    bool WaitIpChange(int timeoutMs) {
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return ipChangeDone_; });
    }

    // Chamado numa thread do PJSIP (ou na de handleIpChange), com a trava do pjsua; nada aqui pode
    // chamar o motor.
    void onIpChangeProgress(pj::OnIpChangeProgressParam& param) override {
        if (param.op != PJSUA_IP_CHANGE_OP_COMPLETED) return;
        try {
            std::lock_guard<std::mutex> lock(mutex_);
            ipChangeDone_ = true;
            changed_.notify_all();
        } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        }
    }

private:
    std::mutex mutex_;
    std::condition_variable changed_;
    bool ipChangeDone_ = false;
};

// A conta do pjsua2: repassa cada resposta do registro ao listener e deixa quem retira o registro
// esperar pela resposta do servidor.
class EngineAccount : public pj::Account {
public:
    explicit EngineAccount(EngineListener* listener) : listener_(listener) {}

    // Daqui em diante nenhuma resposta de registro vai ao listener (conta trocada ou motor
    // destruído: um 200 sem registro ativo seria lido como o resultado da conta nova).
    void Silence() { silent_ = true; }

    // Retira o registro e espera até timeoutMs pela resposta do servidor. false: o tempo acabou ou o
    // PJSIP recusou o pedido. Sem registro (a conta nem chegou a registrar), não há o que esperar.
    bool Unregister(int timeoutMs) {
        try {
            if (!getInfo().regIsConfigured) return true;
        } catch (const pj::Error&) {
            return false;
        }
        {
            std::lock_guard<std::mutex> lock(mutex_);
            unregistering_ = true;
            unregistered_ = false;
        }
        try {
            setRegistration(false);
        } catch (const pj::Error& error) {
            // PJ_EINVALIDOP: a conta já não tem registro (o último pedido falhou), nada a retirar.
            if (error.status == PJ_EINVALIDOP) return true;
            Log(3, "nao foi possivel retirar o registro: " + error.info());
            return false;
        }
        std::unique_lock<std::mutex> lock(mutex_);
        return changed_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return unregistered_; });
    }

    // Chamado numa thread do PJSIP, com a trava do pjsua; nada aqui pode chamar o motor.
    void onRegState(pj::OnRegStateParam& param) override {
        try {
            bool active = param.code / 100 == 2 && param.expiration > 0;
            try {
                active = getInfo().regIsActive;
            } catch (const pj::Error&) {
            }
            if (!silent_) listener_->OnRegistration(static_cast<int>(param.code), active);
            if (!active) {
                std::lock_guard<std::mutex> lock(mutex_);
                if (unregistering_) {
                    unregistered_ = true;
                    changed_.notify_all();
                }
            }
        } catch (...) {   // o PJSIP é C: nenhuma exceção volta para ele
        }
    }

private:
    EngineListener* listener_;
    std::atomic<bool> silent_{false};
    std::mutex mutex_;
    std::condition_variable changed_;
    bool unregistering_ = false;
    bool unregistered_ = false;
};

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

}  // namespace

class SipEngine::Impl {
public:
    Impl(const EngineConfig& config, EngineListener* listener) : config_(config), listener_(listener) {}

    ~Impl() {
        if (!endpoint_) return;
        if (RegisterThread()) {
            std::lock_guard<std::mutex> lock(apiMutex_);
            RetireAccount(true);
        }
        Shutdown();
    }

    bool Start(std::string* error) {
        try {
            EarlyLogScope earlyLog(listener_, config_.logLevel);
            endpoint_.reset(new EngineEndpoint);
            endpoint_->libCreate();

            pj::EpConfig ep;
            ep.uaConfig.userAgent = config_.userAgent;
            ep.uaConfig.threadCnt = 1;
            ep.medConfig.ecTailLen = 0;   // o eco fica com o do aparelho
            ep.logConfig.level = static_cast<unsigned>(config_.logLevel);
            // O pjsua só entrega ao writer as linhas até o consoleLevel; com um writer o PJSIP não
            // escreve no terminal.
            ep.logConfig.consoleLevel = static_cast<unsigned>(config_.logLevel);
            ep.logConfig.writer = new LogForwarder(listener_);
            endpoint_->libInit(ep);

            pj::TransportConfig transport;   // porta 0: o sistema escolhe
            udpId_ = endpoint_->transportCreate(PJSIP_TRANSPORT_UDP, transport);
            // Na troca de rede o pjsua fecha o listener TCP e abre outro na mesma porta, no mesmo instante.
            // O socket fechado só é solto quando a thread do PJLIB volta do select(); sem SO_REUSEPORT a
            // porta ainda está ocupada, a segunda tentativa do pjsua nada recria e a fábrica TCP sai do
            // gerenciador ("Specified factory for creating transport is not found") até o motor acabar.
#ifdef SO_REUSEPORT
            transport.sockOptParams.sockOpts.push_back(pj::SockOpt(SOL_SOCKET, SO_REUSEPORT, 1));
#endif
            tcpId_ = endpoint_->transportCreate(PJSIP_TRANSPORT_TCP, transport);
            endpoint_->libStart();
            if (config_.nullAudio) endpoint_->audDevManager().setNullDev();
            ConfigureCodecs();
            return true;
        } catch (const pj::Error& failure) {
            if (error) *error = "nao foi possivel iniciar o PJSIP: " + failure.info();
        }
        Shutdown();
        return false;
    }

    bool SetAccount(const AccountInput& input) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return false;
        if (input.address.empty() || input.ramal.empty()) {
            Log(2, "conta recusada: endereco ou ramal vazio");
            return false;
        }
        RetireAccount(true);
        const AccountFields fields = BuildAccount(config_.profile.account, input.address, input.ramal, input.senha,
                                                  input.transport, L"");
        const PjAccountSettings settings = ToPjAccount(fields);
        const pj::AccountConfig config = MakeAccountConfig(settings, settings.transport == "tcp" ? tcpId_ : udpId_);
        std::unique_ptr<EngineAccount> account(new EngineAccount(listener_));
        try {
            account->create(config, true);
        } catch (const pj::Error& failure) {
            Log(1, "o PJSIP recusou a conta " + settings.idUri + ": " + failure.info());
            return false;
        }
        account_ = std::move(account);
        return true;
    }

    void RemoveAccount() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        RetireAccount(false);
    }

    void Reregister() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread() || !account_) return;
        RefreshRegistration();
    }

    void HandleIpChange() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        bool started = true;
        endpoint_->ExpectIpChange();
        try {
            endpoint_->handleIpChange(pj::IpChangeParam());
        } catch (const pj::Error& failure) {
            Log(1, "troca de rede: " + failure.info());
            started = false;
        }
        if (started && !endpoint_->WaitIpChange(kIpChangeWaitMs)) Log(2, "a troca de rede nao terminou a tempo");
        // Com o Contact sem reescrita o pjsua não refaz o registro por conta própria (UDP) ou só o faz
        // depois de 0 a 10 s (TCP). O MicroSIP também registra de novo à mão (mainDlg.cpp).
        if (account_) RefreshRegistration();
    }

    std::vector<std::string> ActiveCodecs() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        std::vector<std::string> ids;
        if (!RegisterThread()) return ids;
        try {
            pj::CodecInfoVector2 codecs = endpoint_->codecEnum2();
            std::stable_sort(codecs.begin(), codecs.end(),
                             [](const pj::CodecInfo& a, const pj::CodecInfo& b) { return a.priority > b.priority; });
            for (const pj::CodecInfo& codec : codecs) {
                if (codec.priority > 0) ids.push_back(codec.codecId);
            }
        } catch (const pj::Error& failure) {
            Log(1, "codecs: " + failure.info());
        }
        return ids;
    }

private:
    // O PJLIB só aceita chamadas de threads que ele conhece.
    bool RegisterThread() {
        try {
            if (!endpoint_->libIsThreadRegistered()) endpoint_->libRegisterThread(kThreadName);
            return true;
        } catch (const pj::Error&) {
            return false;
        }
    }

    // Todos os codecs desligados, menos os do perfil, do mais para o menos preferido.
    void ConfigureCodecs() {
        const pj::CodecInfoVector2 available = endpoint_->codecEnum2();
        for (const pj::CodecInfo& codec : available) endpoint_->codecSetPriority(codec.codecId, 0);
        int priority = 255;
        for (const std::string& id : CodecIds(config_.profile.global.codecs)) {
            const bool present = std::any_of(available.begin(), available.end(), [&id](const pj::CodecInfo& codec) {
                return SameCodecId(codec.codecId, id);
            });
            if (!present) {
                Log(2, "codec do perfil ausente neste build, ignorado: " + id);
                continue;
            }
            endpoint_->codecSetPriority(id, static_cast<pj_uint8_t>(priority--));
        }
    }

    // Retira o registro da conta atual (esperando o servidor, até um limite) e a apaga. silent: o
    // listener não recebe a resposta do servidor.
    void RetireAccount(bool silent) {
        if (!account_) return;
        if (silent) account_->Silence();
        if (!account_->Unregister(kUnregisterWaitMs)) Log(2, "o servidor nao confirmou a saida da conta");
        account_.reset();
    }

    void RefreshRegistration() {
        try {
            account_->setRegistration(true);
        } catch (const pj::Error& failure) {
            // PJSIP_EBUSY: já há um registro em andamento, que vale como a renovação.
            Log(3, "renovar o registro: " + failure.info());
        }
    }

    void Shutdown() {
        if (!endpoint_) return;
        try {
            endpoint_->libDestroy();
        } catch (const pj::Error&) {
        }
        endpoint_.reset();
    }

    EngineConfig config_;
    EngineListener* listener_;
    std::unique_ptr<EngineEndpoint> endpoint_;
    pj::TransportId udpId_ = -1;
    pj::TransportId tcpId_ = -1;
    std::mutex apiMutex_;   // um método público por vez; nunca segurada nos callbacks do PJSIP
    std::unique_ptr<EngineAccount> account_;
};

SipEngine::SipEngine(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

SipEngine::~SipEngine() {
    impl_.reset();
    std::lock_guard<std::mutex> lock(g_aliveMutex);
    g_alive = false;
}

std::unique_ptr<SipEngine> SipEngine::Create(const EngineConfig& config, EngineListener* listener,
                                             std::string* error) {
    std::string ignored;
    std::string& reason = error ? *error : ignored;
    reason.clear();
    if (!listener) {
        reason = "falta o listener dos eventos";
        return nullptr;
    }
    std::lock_guard<std::mutex> lock(g_aliveMutex);
    if (g_alive) {
        reason = "ja existe um motor neste processo";
        return nullptr;
    }
    std::unique_ptr<Impl> impl(new Impl(config, listener));
    if (!impl->Start(&reason)) return nullptr;
    std::unique_ptr<SipEngine> engine(new SipEngine(std::move(impl)));
    g_alive = true;
    return engine;
}

bool SipEngine::SetAccount(const AccountInput& input) { return impl_->SetAccount(input); }

void SipEngine::RemoveAccount() { impl_->RemoveAccount(); }

void SipEngine::Reregister() { impl_->Reregister(); }

void SipEngine::HandleIpChange() { impl_->HandleIpChange(); }

std::vector<std::string> SipEngine::ActiveCodecs() const { return impl_->ActiveCodecs(); }

}  // namespace starsonic
