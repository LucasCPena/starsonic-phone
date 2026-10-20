#include "SipEngine.h"

#include <pjsua2.hpp>
#include <sys/socket.h>

#include <algorithm>
#include <cctype>
#include <exception>
#include <mutex>
#include <string>

#include "AccountConfig.h"
#include "AccountPolicy.h"
#include "EngineAccount.h"
#include "EngineCall.h"
#include "EngineEndpoint.h"
#include "EngineEvents.h"
#include "EngineLog.h"
#include "Text.h"

namespace starsonic {
namespace {

const char kThreadName[] = "starsonic-caller";
// Quanto o motor espera o servidor confirmar a saída de uma conta antes de seguir sem a resposta.
const int kUnregisterWaitMs = 3000;
// Quanto o motor espera uma ligação desligada acabar antes de seguir (conta saindo ou motor acabando).
const int kCallEndWaitMs = 2000;
// Quanto o motor espera o pjsua refazer os transportes depois de uma troca de rede (leva alguns ms).
const int kIpChangeWaitMs = 2000;

// O pjsua tem estado global: um motor por processo.
std::mutex g_aliveMutex;
bool g_alive = false;

bool SameCodecId(const std::string& a, const std::string& b) {
    return a.size() == b.size() &&
           std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) {
               return std::tolower(static_cast<unsigned char>(x)) == std::tolower(static_cast<unsigned char>(y));
           });
}

}  // namespace

// Travas: apiMutex_ põe um método público por vez e nunca é presa nos callbacks do PJSIP; a tabela de
// ligações, as contas e a fila de eventos têm travas próprias, curtas, que nunca ficam presas enquanto o
// listener é avisado (os eventos saem pela fila).
class SipEngine::Impl {
public:
    Impl(const EngineConfig& config, EngineListener* listener)
        : config_(config), listener_(listener), events_(listener), calls_(&events_, config.profile.global.dtmf) {}

    ~Impl() {
        // Daqui em diante nenhuma ligação nova e nenhum evento (o destrutor não avisa o listener).
        calls_.Close();
        events_.Stop();
        if (!endpoint_) return;
        if (RegisterThread()) {
            std::lock_guard<std::mutex> lock(apiMutex_);
            if (account_) {
                RetireAccount();
            } else if (!calls_.End(kCallEndWaitMs)) {
                Log(2, "a ligacao nao terminou a tempo; o PJSIP a encerra ao sair");
            }
        }
        // Um objeto de ligação que ainda exista se apaga no fim dela, que o libDestroy provoca; depois
        // do libDestroy nenhum pode ser apagado (o destrutor do pj::Call mexe no pjsua).
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
            // STUN do perfil (spec 6.3), global como no MicroSIP; vazio = sem STUN. As contas seguem o
            // global (sipStunUse e mediaStunUse ficam no padrão).
            ep.uaConfig.stunServer = StunServers(config_.profile.global.stun);
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
            // O pjsua2 cria o objeto do microfone e do alto-falante no primeiro uso, sem trava: aqui,
            // antes de qualquer ligação, ele nasce numa thread só.
            endpoint_->audDevManager().getCaptureDevMedia();
            ConfigureCodecs();
            return true;
        } catch (const pj::Error& failure) {
            if (error) *error = "nao foi possivel iniciar o PJSIP: " + failure.info();
        }
        Shutdown();
        return false;
    }

    int SetAccount(const AccountInput& input) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return 0;
        if (input.address.empty() || input.ramal.empty()) {
            Log(2, "conta recusada: endereco ou ramal vazio");
            return 0;
        }
        RetireAccount();
        const AccountFields fields = BuildAccount(config_.profile.account, input.address, input.ramal, input.senha,
                                                  input.transport, L"");
        const PjAccountSettings settings = ToPjAccount(fields);
        const pj::AccountConfig config = MakeAccountConfig(settings, settings.transport == "tcp" ? tcpId_ : udpId_);
        // O id vem antes do create(): uma resposta que chegue durante ele já sai com o id da conta.
        const int accountId = ++lastAccountId_;
        std::unique_ptr<EngineAccount> account(new EngineAccount(&events_, &calls_, accountId));
        try {
            account->create(config, true);
        } catch (const pj::Error& failure) {
            Log(1, "o PJSIP recusou a conta " + settings.idUri + ": " + failure.info());
            return 0;
        }
        account_ = std::move(account);
        callHost_ = WideToUtf8(fields.domain);   // o domínio já leva a porta fora da 5060 (BuildAccount)
        return accountId;
    }

    void RemoveAccount() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread() || !account_) return;
        const int accountId = account_->Id();
        RetireAccount();
        // A saída da conta, com ou sem a confirmação do servidor (o log diz qual).
        events_.Post([accountId](EngineListener& listener) { listener.OnRegistration(200, false, accountId); });
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

    int MakeCall(const std::string& number) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return -1;
        if (!account_ || number.empty()) {
            Log(2, account_ ? "ligacao recusada: numero vazio" : "ligacao recusada: nao ha conta");
            return -1;
        }
        return calls_.Make(*account_, CallUri(number));
    }

    bool Answer(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Answer(callId);
    }

    bool Reject(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Reject(callId);
    }

    bool Hangup(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Hangup(callId);
    }

    bool Activate(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Activate(callId);
    }

    bool SetHold(int callId, bool hold) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.SetHold(callId, hold);
    }

    void SetMute(bool muted) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        try {
            // O que a ponte de áudio recebe do microfone: zero é mudo.
            endpoint_->audDevManager().getCaptureDevMedia().adjustTxLevel(muted ? 0.0f : 1.0f);
        } catch (const pj::Error& failure) {
            Log(1, "mudo: " + failure.info());
        }
    }

    bool SendDtmf(int callId, const std::string& digits) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.SendDtmf(callId, digits);
    }

    bool Transfer(int callId, const std::string& number) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread() || !account_ || number.empty()) return false;
        return calls_.Transfer(callId, CallUri(number));
    }

    bool TransferAttended(int callId, int targetCallId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.TransferAttended(callId, targetCallId);
    }

    bool Join(int callId, int otherId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Join(callId, otherId);
    }

    bool Split(int callId, int otherId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return RegisterThread() && calls_.Split(callId, otherId);
    }

    int CallCount() { return calls_.CallCount(); }

    std::vector<int> AudioLinks(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return std::vector<int>();
        return calls_.AudioLinks(callId);
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

    // sip:<número>@<domínio da conta>. O transporte é o da conta (UDP ou TCP), que o pjsua usa
    // sozinho: a conta está presa a ele.
    std::string CallUri(const std::string& number) const { return "sip:" + number + "@" + callHost_; }

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

    // Desliga as ligações, tira a conta do servidor (esperando a resposta, até um limite) e a apaga.
    // Nenhuma resposta de registro desta conta vira evento daqui em diante.
    void RetireAccount() {
        if (!account_) return;
        account_->Retire();
        if (!calls_.End(kCallEndWaitMs)) Log(2, "a ligacao nao terminou a tempo; a conta sai assim mesmo");
        switch (account_->Unregister(kUnregisterWaitMs)) {
            case EngineAccount::Exit::Confirmed:
                Log(3, "a conta saiu do servidor");
                break;
            case EngineAccount::Exit::NothingToRemove:
                Log(3, "a conta nao estava registrada: nada a retirar do servidor");
                break;
            case EngineAccount::Exit::NoAnswer:
                Log(2, "sem resposta do servidor: a conta sai sem a confirmacao dele");
                break;
        }
        // Tira a conta do pjsua com o objeto ainda inteiro: depois disso nenhum resultado de REGISTER
        // atrasado chega a ele. Só o reset() faria isso dentro do ~Account, com os campos do
        // EngineAccount já desmontados.
        account_->shutdown();
        account_.reset();
        callHost_.clear();
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
    EventQueue events_;   // antes da tabela e das contas, que avisam por ela
    CallTable calls_;
    std::unique_ptr<EngineEndpoint> endpoint_;
    pj::TransportId udpId_ = -1;
    pj::TransportId tcpId_ = -1;
    std::mutex apiMutex_;   // um método público por vez; nunca presa nos callbacks do PJSIP
    std::unique_ptr<EngineAccount> account_;
    int lastAccountId_ = 0;   // o id da última conta criada (com a apiMutex_)
    std::string callHost_;   // <domínio>[:<porta>] da conta (UTF-8), para as URIs das ligações
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
    std::unique_ptr<Impl> impl;
    try {
        impl.reset(new Impl(config, listener));
    } catch (const std::exception& failure) {   // a thread dos eventos não nasceu
        reason = std::string("nao foi possivel iniciar o motor: ") + failure.what();
        return nullptr;
    }
    if (!impl->Start(&reason)) return nullptr;
    std::unique_ptr<SipEngine> engine(new SipEngine(std::move(impl)));
    g_alive = true;
    return engine;
}

int SipEngine::SetAccount(const AccountInput& input) { return impl_->SetAccount(input); }

void SipEngine::RemoveAccount() { impl_->RemoveAccount(); }

void SipEngine::Reregister() { impl_->Reregister(); }

void SipEngine::HandleIpChange() { impl_->HandleIpChange(); }

std::vector<std::string> SipEngine::ActiveCodecs() const { return impl_->ActiveCodecs(); }

int SipEngine::MakeCall(const std::string& number) { return impl_->MakeCall(number); }

bool SipEngine::Answer(int callId) { return impl_->Answer(callId); }

bool SipEngine::Reject(int callId) { return impl_->Reject(callId); }

bool SipEngine::Hangup(int callId) { return impl_->Hangup(callId); }

bool SipEngine::Activate(int callId) { return impl_->Activate(callId); }

bool SipEngine::SetHold(int callId, bool hold) { return impl_->SetHold(callId, hold); }

void SipEngine::SetMute(bool muted) { impl_->SetMute(muted); }

bool SipEngine::SendDtmf(int callId, const std::string& digits) { return impl_->SendDtmf(callId, digits); }

bool SipEngine::Transfer(int callId, const std::string& number) { return impl_->Transfer(callId, number); }

bool SipEngine::TransferAttended(int callId, int targetCallId) {
    return impl_->TransferAttended(callId, targetCallId);
}

bool SipEngine::Join(int callId, int otherId) { return impl_->Join(callId, otherId); }

bool SipEngine::Split(int callId, int otherId) { return impl_->Split(callId, otherId); }

int SipEngine::CallCount() const { return impl_->CallCount(); }

bool SipEngine::HasCall() const { return impl_->CallCount() > 0; }

std::vector<int> SipEngine::AudioLinks(int callId) const { return impl_->AudioLinks(callId); }

}  // namespace starsonic
