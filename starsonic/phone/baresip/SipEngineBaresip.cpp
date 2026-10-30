// O SipEngine (o contrato de SipEngine.h) sobre o baresip e a libre, para o iPhone (spec 6.1). A libre e o baresip
// rodam na thread do BaresipLoop; os métodos públicos só os usam dentro do BaresipLoop::Run.
#include "SipEngine.h"

#include <re.h>
#include <baresip.h>

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "AccountConfig.h"
#include "BaresipAccount.h"
#include "BaresipCalls.h"
#include "BaresipLoop.h"
#include "EngineEvents.h"
#include "NullAudio.h"
#include "PushDataCheck.h"
#include "SipEngineTestAccess.h"   // os métodos dela ficam aqui: eles leem o Impl

namespace starsonic {
namespace {

const int kNullAudioDevice = -2;      // o id do dispositivo nulo, o mesmo do motor do PJSIP
const int kDefaultAudioDevice = -1;   // o padrão do sistema
// Quanto um pedido que manda re-INVITE espera a renegociação anterior da ligação, como no motor do PJSIP.
const int kRenegotiationWaitMs = 2000;

// A libre e o baresip têm estado global: um motor por processo.
std::mutex g_aliveMutex;
bool g_alive = false;

// O codec do id (nome/taxa/canais, como G722/16000/1) está entre os que os módulos do baresip registraram. Na thread do
// laço (num Run).
bool HasCodec(const std::string& id) {
    const size_t first = id.find('/');
    const size_t second = first == std::string::npos ? first : id.find('/', first + 1);
    if (first == 0 || second == std::string::npos) return false;
    const unsigned long rate = std::strtoul(id.c_str() + first + 1, nullptr, 10);
    const unsigned long channels = std::strtoul(id.c_str() + second + 1, nullptr, 10);
    if (rate == 0 || channels == 0) return false;   // o aucodec_find leria o 0 como "qualquer um"
    return aucodec_find(baresip_aucodecl(), id.substr(0, first).c_str(), static_cast<uint32_t>(rate),
                        static_cast<uint8_t>(channels)) != nullptr;
}

// -1 é o padrão do sistema; outro id precisa estar na lista e servir ao papel (microfone ou alto-falante).
bool IsAudioDevice(const std::vector<AudioDevice>& devices, int id, bool capture) {
    if (id == kDefaultAudioDevice) return true;
    for (const AudioDevice& device : devices) {
        if (device.id == id) return capture ? device.capture : device.playback;
    }
    return false;
}

// O handler dos eventos do baresip (bevent), com a trava da libre (na thread do laço, ou num Run que provoca o evento):
// os das ligações vão ao BaresipCalls. Nenhuma exceção volta para o baresip, que é C.
void OnBaresipEvent(enum bevent_ev ev, struct bevent* event, void* arg) {
    try {
        static_cast<BaresipCalls*>(arg)->OnEvent(ev, event);
    } catch (...) {
    }
}

}  // namespace

// Travas: apiMutex_ põe um método público por vez e nunca é presa num handler do laço, que roda com a trava da libre. A
// ordem é sempre a apiMutex_ e depois a trava da libre (um Run de dentro de um método público), nunca o contrário. A
// fila dos eventos e o fim da saída da conta (BaresipAccount::WaitRetired) têm travas próprias, curtas, que nunca ficam
// presas enquanto o listener é avisado. Quem espera o servidor espera fora do Run.
class SipEngine::Impl {
public:
    Impl(const EngineConfig& config, EngineListener* listener)
        : config_(config),
          listener_(listener),
          events_(listener),
          calls_(events_, Sink(), config.profile.global.dtmf) {}

    // A fila dos eventos para antes de tudo (nada é avisado daqui em diante); as ligações acabam (BYE, CANCEL ou 603,
    // sem esperar as que ainda esperam a resposta do outro lado: ver o BaresipCalls::EndAll), a conta sai do servidor,
    // como no RemoveAccount mas sem o evento (até ~3 s com o servidor mudo), e o laço fecha o baresip e a libre. O
    // handler dos eventos do baresip sai depois da conta: até ela sair, a ligação que chega recebe 480.
    ~Impl() {
        events_.Stop();
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (loop_) {
            loop_->Run([&] { calls_.EndAll(); });
            RetireAccount(false);
            loop_->Run([&] { bevent_unregister(OnBaresipEvent); });
        }
        loop_.reset();
    }

    bool Start(std::string* error) {
        LoopConfig loop;
        loop.userAgent = config_.userAgent;
        loop.logLevel = config_.logLevel;
        loop.nullAudio = config_.nullAudio;
        // As linhas do baresip que as ligações leem (a do fim da assinatura de uma transferência com erro); o calls_
        // dura mais que o laço.
        BaresipCalls* calls = &calls_;
        loop.baresipLines = [calls](const std::string& line, bool onLoopThread) {
            calls->OnBaresipLine(line, onLoopThread);
        };
        EngineListener* listener = listener_;
        loop_ = BaresipLoop::Start(
            loop, [listener](int level, const std::string& line) { listener->OnLog(level, line); }, error);
        if (!loop_) return false;
        // Os codecs do perfil que os módulos registraram, na ordem do perfil (do mais para o menos preferido), e os
        // eventos do baresip, que trazem as ligações.
        const std::vector<std::string> wanted = CodecIds(config_.profile.global.codecs);
        std::vector<std::string> missing;
        int err = 0;
        loop_->Run([&] {
            for (const std::string& id : wanted) (HasCodec(id) ? activeCodecs_ : missing).push_back(id);
            err = bevent_register(OnBaresipEvent, &calls_);
        });
        for (const std::string& id : missing) Log(2, "codec sem suporte neste build: " + id);
        if (err) {
            if (error) *error = "bevent_register: " + BaresipLoop::ErrorText(err);
            return false;
        }
        return true;
    }

    int SetAccount(const AccountInput& input) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (input.address.empty() || input.ramal.empty()) {
            Log(2, "conta recusada: endereco ou ramal vazio");
            return 0;
        }
        RetireAccount(false);   // a conta anterior sai sem aviso (as ligações dela, com o Disconnected de sempre)
        // O id vem antes do Start: uma resposta que chegue logo depois dele já sai com o id da conta.
        const int accountId = ++lastAccountId_;
        std::unique_ptr<BaresipAccount> account(new BaresipAccount(events_, Sink()));
        const bool ran = loop_->Run([&] {
            account->SetPushData(pushData_);   // antes do Start: o primeiro REGISTER já leva os dados
            if (account->Start(config_.profile, input, accountId, networkAvailable_)) {
                account.reset();
            } else {
                calls_.Open();   // as ligações que chegam à conta nova tocam
            }
        });
        if (!ran) {
            (void)account.release();   // o laço parou: nada da libre é solto fora dele
            return 0;
        }
        if (!account) return 0;   // o baresip ou a libre recusaram a conta (o log diz por quê)
        account_ = std::move(account);
        return accountId;
    }

    void RemoveAccount() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        // As ligações acabam antes, com o Disconnected de sempre; no fim, OnRegistration(200, false, <id da conta que
        // saiu>), uma vez.
        RetireAccount(true);
    }

    void Reregister() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!account_) return;
        if (!networkAvailable_) {
            Log(3, "renovar o registro: sem rede, nada a fazer");
            return;
        }
        loop_->Run([&] { account_->Refresh(); });
    }

    // Os transportes de novo, nos endereços de agora, e, com conta e rede, um REGISTER na hora (sem conta, volta na
    // hora).
    void HandleIpChange() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        int err = 0;
        loop_->Run([&] {
            err = uag_reset_transp(false, false);
            if (account_) account_->OnIpChange();
        });
        if (err) Log(1, "troca de rede: " + BaresipLoop::ErrorText(err));
    }

    void SetNetworkAvailable(bool available) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!available) {
            if (!networkAvailable_) return;
            networkAvailable_ = false;
            Log(3, "sem rede: o registro para de tentar (o do servidor fica ate vencer)");
            if (account_) loop_->Run([&] { account_->SetNetworkAvailable(false); });
            return;
        }
        const bool wasDown = !networkAvailable_;
        networkAvailable_ = true;
        if (!account_) return;   // sem conta, só guarda o estado
        Log(3, wasDown ? "a rede voltou: registrando de novo" : "rede disponivel: renovando o registro");
        loop_->Run([&] { account_->SetNetworkAvailable(true); });
    }

    // A conta basta, mesmo sem registro. A URI é sip:<número>@<domínio da conta>[:<porta>], e numa conta TCP leva o
    // ;transport=tcp. Com uma ligação confirmada fora da espera, ela vai para a espera antes (RunRenegotiating).
    int MakeCall(const std::string& number) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!account_ || number.empty()) {
            Log(2, account_ ? "ligacao recusada: numero vazio" : "ligacao recusada: nao ha conta");
            return -1;
        }
        int id = -1;
        RunRenegotiating([&](bool lastTry) {
            const std::string uri =
                "sip:" + number + "@" + account_->CallHost() + (account_->Tcp() ? ";transport=tcp" : "");
            id = calls_.Make(account_->Ua(), uri, lastTry);
        });
        return id;
    }

    // A atendida vira a ativa, e a outra vai para a espera antes do 200 (RunRenegotiating).
    bool Answer(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        RunRenegotiating([&](bool lastTry) { done = calls_.Answer(callId, lastTry); });
        return done;
    }

    bool Reject(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        loop_->Run([&] { done = calls_.Reject(callId); });
        return done;
    }

    bool Hangup(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        loop_->Run([&] { done = calls_.Hangup(callId); });
        return done;
    }

    // A troca da ativa, a espera e a retomada, cada uma depois da renegociação anterior da ligação (RunRenegotiating).
    bool Activate(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        RunRenegotiating([&](bool lastTry) { done = calls_.Activate(callId, lastTry); });
        return done;
    }

    bool SetHold(int callId, bool hold) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        RunRenegotiating([&](bool lastTry) { done = calls_.SetHold(callId, hold, lastTry); });
        return done;
    }

    // O mudo das ligações de agora e das próximas, até trocar de novo.
    void SetMute(bool muted) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        loop_->Run([&] { calls_.SetMute(muted); });
    }

    bool SendDtmf(int callId, const std::string& digits) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        loop_->Run([&] { done = calls_.SendDtmf(callId, digits); });
        return done;
    }

    // O REFER para sip:<número>@<domínio da conta>[:<porta>], sem o ;transport=tcp da conta TCP, como no motor do
    // PJSIP (o REFER sai pelo diálogo da ligação, que já está no transporte dela).
    bool Transfer(int callId, const std::string& number) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!account_ || number.empty()) return false;
        bool done = false;
        loop_->Run([&] { done = calls_.Transfer(callId, "sip:" + number + "@" + account_->CallHost()); });
        return done;
    }

    bool TransferAttended(int callId, int targetCallId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        loop_->Run([&] { done = calls_.TransferAttended(callId, targetCallId); });
        return done;
    }

    // A conferência a três, na mesa de áudio daqui (o mixminus): a que está em espera é retomada depois da renegociação
    // anterior dela (RunRenegotiating). O Join não tem o que fazer no prazo: o que ainda esbarra é recusado.
    bool Join(int callId, int otherId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        RunRenegotiating([&](bool /*lastTry*/) { done = calls_.Join(callId, otherId); });
        return done;
    }

    // O Activate(callId), que desfaz a conferência: otherId vai para a espera (RunRenegotiating).
    bool Split(int callId, int otherId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        bool done = false;
        RunRenegotiating([&](bool lastTry) { done = calls_.Split(callId, otherId, lastTry); });
        return done;
    }

    int CallCount() const { return calls_.Count(); }   // nunca espera: sem a apiMutex_ e sem o Run

    std::vector<int> AudioLinks(int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        std::vector<int> links;
        loop_->Run([&] { links = calls_.AudioLinks(callId); });
        return links;
    }

    // Confere os dados e os guarda para cada REGISTER da conta. Com a conta e a rede, registra de novo na hora, mesmo
    // sem registro (com outro REGISTER a caminho, logo depois da resposta dele); sem uma ou outra, só guarda.
    bool SetPushData(const std::optional<PushData>& data) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        const std::string problem = data ? PushDataProblem(*data) : std::string();
        if (!problem.empty()) {
            Log(2, "push: dados recusados: " + problem);
            return false;
        }
        pushData_ = data;
        if (account_) loop_->Run([&] { account_->SetPushData(pushData_); });
        return true;
    }

    // O BLF fica só no motor do PJSIP (spec 6.1): nada é assinado e nada é avisado.
    void WatchBlf(const std::vector<std::string>& numbers) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!numbers.empty()) Log(2, "BLF: sem suporte neste motor");
    }

    std::vector<std::string> ActiveCodecs() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return activeCodecs_;
    }

    // O caminho do som é do iPhone (spec 6.1): a lista só tem o dispositivo nulo, com nullAudio, e escolher um
    // dispositivo não muda nada no som.
    std::vector<AudioDevice> AudioDevices() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        return ListAudioDevices();
    }

    bool SetAudioDevices(int captureId, int playbackId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        const std::vector<AudioDevice> devices = ListAudioDevices();
        return IsAudioDevice(devices, captureId, true) && IsAudioDevice(devices, playbackId, false);
    }

    void RefreshAudioDevices() {}

    // Os testes (SipEngineTestAccess), dentro do Run: o laço já acabou a volta de agora, com os eventos e os
    // temporizadores dela.
    std::vector<int> CallsWithAudio() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        std::vector<int> ids;
        loop_->Run([&] { ids = calls_.CallsWithAudio(); });
        return ids;
    }

    // Sem a apiMutex_, ao contrário dos outros: lê também no meio de um pedido que espera fora do Run (o Activate que
    // espera a renegociação da outra). Só o Run, que já põe a leitura no fim de uma volta do laço.
    int OpenMicrophones() {
        int count = 0;
        loop_->Run([&] { count = OpenNullSources(); });
        return count;
    }

    void FailReinvites(bool on, int callId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        loop_->Run([&] { calls_.FailReinvites(on, callId); });
    }

    std::vector<int> MutedCalls() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        std::vector<int> ids;
        loop_->Run([&] { ids = calls_.MutedCalls(); });
        return ids;
    }

    std::vector<int> ConferenceCalls() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        std::vector<int> ids;
        loop_->Run([&] { ids = calls_.ConferenceCalls(); });
        return ids;
    }

private:
    // Sem o padrão (-1), como no motor do PJSIP; com nullAudio, o dispositivo nulo.
    std::vector<AudioDevice> ListAudioDevices() const {
        std::vector<AudioDevice> devices;
        if (config_.nullAudio) {
            AudioDevice device;
            device.id = kNullAudioDevice;
            device.name = "Null Audio";
            device.capture = true;
            device.playback = true;
            devices.push_back(device);
        }
        return devices;
    }

    void Log(int level, const std::string& line) const {
        if (level <= config_.logLevel) listener_->OnLog(level, line);
    }

    // O log do motor, para a conta e as ligações (qualquer thread).
    BaresipLoop::LogSink Sink() const {
        return [this](int level, const std::string& line) { Log(level, line); };
    }

    // Com a apiMutex_: um pedido do BaresipCalls que manda re-INVITE (Make, Answer, Activate, SetHold, Join ou Split),
    // no laço. Se ele esbarra numa renegociação ainda no ar (Blocked), a espera é aqui, fora do Run, pelo fim dela (até
    // ~2 s desde o primeiro pedido), e ele vai de novo; passado o prazo, ele vai uma última vez, com lastTry: o Make, o
    // Answer e o Activate (e o Split) seguem sem a espera da outra, e o que ainda esbarra (a espera do SetHold, a
    // retomada da escolhida no Activate ou a retomada do Join) é recusado. O pedido começa aqui (o BeginRequest, na
    // primeira tentativa): o que um pedido de antes guardou para as tentativas dele não vale para este.
    void RunRenegotiating(const std::function<void(bool lastTry)>& work) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kRenegotiationWaitMs);
        for (bool first = true;; first = false) {
            const bool lastTry = std::chrono::steady_clock::now() >= deadline;
            bool blocked = false;
            uint64_t seen = 0;
            const bool ran = loop_->Run([&] {
                if (first) calls_.BeginRequest();
                work(lastTry);
                blocked = calls_.Blocked();
                seen = calls_.Negotiations();
            });
            if (!ran || !blocked) return;
            if (lastTry) {
                Log(2, "a renegociacao anterior da ligacao nao terminou a tempo: pedido recusado");
                return;
            }
            calls_.WaitNegotiation(seen, deadline);
        }
    }

    // Com a apiMutex_: as ligações da conta acabam, com o Disconnected de sempre, e as que chegarem até a conta sair
    // recebem 480; a conta sai do servidor (o BaresipAccount::Retire, esperado fora do Run) e é apagada; com
    // reportExit, no fim chega OnRegistration(200, false, <id>). Sem conta, nada. Ao contrário do motor do PJSIP, não
    // há o que esperar das ligações: cada uma sai das vagas dentro do Run. O pedido de uma que ainda espera a resposta
    // do outro lado (o CANCEL da feita sem 18x, o BYE da atendida sem o ACK; ver o BaresipCalls::Hangup) sai se ela
    // chegar durante a saída da conta; senão a ligação acaba com a ua (ver o BaresipCalls::EndAll).
    void RetireAccount(bool reportExit) {
        if (!account_) return;
        const bool ran = loop_->Run([&] {
            calls_.HangupAll();
            account_->Retire(reportExit);
        });
        if (!ran) {
            (void)account_.release();   // o laço parou: nada da libre é solto fora dele
            return;
        }
        if (!account_->WaitRetired()) Log(2, "a saida da conta nao terminou a tempo");
        if (!loop_->Run([&] { account_.reset(); })) (void)account_.release();
    }

    const EngineConfig config_;
    EngineListener* const listener_;
    EventQueue events_;     // antes da conta e das ligações, que avisam por ela
    // As ligações: só dentro do Run e no handler dos eventos do baresip (o Count, de qualquer thread).
    BaresipCalls calls_;
    std::mutex apiMutex_;   // um método público por vez; nunca presa num handler do laço
    std::unique_ptr<BaresipLoop> loop_;
    // Com a apiMutex_ (o Start escreve antes de o motor sair do Create). A conta é montada (o Start dela), usada e
    // apagada só dentro do Run, e sai antes do laço (o destrutor).
    std::vector<std::string> activeCodecs_;
    std::optional<PushData> pushData_;
    std::unique_ptr<BaresipAccount> account_;
    int lastAccountId_ = 0;         // o id da última conta criada
    bool networkAvailable_ = true;  // a rede como o app a vê (SetNetworkAvailable)
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
        reason = "ja ha um motor neste processo";
        return nullptr;
    }
    std::unique_ptr<Impl> impl;
    try {
        impl.reset(new Impl(config, listener));
    } catch (const std::exception& failure) {   // a thread dos eventos não nasceu
        reason = std::string("nao foi possivel iniciar o motor: ") + failure.what();
        return nullptr;
    }
    std::string problem;
    if (!impl->Start(&problem)) {
        reason = "nao foi possivel iniciar o baresip: " + problem;
        return nullptr;
    }
    std::unique_ptr<SipEngine> engine(new SipEngine(std::move(impl)));
    g_alive = true;
    return engine;
}

int SipEngine::SetAccount(const AccountInput& input) { return impl_->SetAccount(input); }

void SipEngine::RemoveAccount() { impl_->RemoveAccount(); }

void SipEngine::Reregister() { impl_->Reregister(); }

void SipEngine::HandleIpChange() { impl_->HandleIpChange(); }

void SipEngine::SetNetworkAvailable(bool available) { impl_->SetNetworkAvailable(available); }

bool SipEngine::SetPushData(const std::optional<PushData>& data) { return impl_->SetPushData(data); }

void SipEngine::WatchBlf(const std::vector<std::string>& numbers) { impl_->WatchBlf(numbers); }

std::vector<std::string> SipEngine::ActiveCodecs() const { return impl_->ActiveCodecs(); }

int SipEngine::MakeCall(const std::string& number) { return impl_->MakeCall(number); }

bool SipEngine::Answer(int callId) { return impl_->Answer(callId); }

bool SipEngine::Reject(int callId) { return impl_->Reject(callId); }

bool SipEngine::Hangup(int callId) { return impl_->Hangup(callId); }

bool SipEngine::Activate(int callId) { return impl_->Activate(callId); }

bool SipEngine::SetHold(int callId, bool hold) { return impl_->SetHold(callId, hold); }

void SipEngine::SetMute(bool muted) { impl_->SetMute(muted); }

std::vector<AudioDevice> SipEngine::AudioDevices() const { return impl_->AudioDevices(); }

bool SipEngine::SetAudioDevices(int captureId, int playbackId) {
    return impl_->SetAudioDevices(captureId, playbackId);
}

void SipEngine::RefreshAudioDevices() { impl_->RefreshAudioDevices(); }

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

std::vector<int> SipEngineTestAccess::CallsWithAudio(const SipEngine& engine) {
    return engine.impl_->CallsWithAudio();
}

int SipEngineTestAccess::OpenMicrophones(const SipEngine& engine) { return engine.impl_->OpenMicrophones(); }

void SipEngineTestAccess::FailReinvites(SipEngine& engine, bool on, int callId) {
    engine.impl_->FailReinvites(on, callId);
}

std::vector<int> SipEngineTestAccess::MutedCalls(const SipEngine& engine) { return engine.impl_->MutedCalls(); }

std::vector<int> SipEngineTestAccess::ConferenceCalls(const SipEngine& engine) {
    return engine.impl_->ConferenceCalls();
}

}  // namespace starsonic
