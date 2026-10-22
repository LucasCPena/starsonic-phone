#include "SipEngine.h"

#include <pjsua2.hpp>
#ifndef _WIN32
#include <sys/socket.h>   // SO_REUSEPORT (no Windows o pjlib ja traz o winsock2.h)
#endif

#include <algorithm>
#include <cctype>
#include <exception>
#include <map>
#include <mutex>
#include <string>

#include "AccountConfig.h"
#include "AccountPolicy.h"
#include "AudioDeviceName.h"
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
const int kNullAudioDevice = -2;   // PJSUA_SND_NULL_DEV: o id do dispositivo nulo, que o PJSIP não lista
const int kDefaultAudioDevice = -1;   // o padrão do sistema (PJMEDIA_AUD_DEFAULT_CAPTURE_DEV e ..._PLAYBACK_DEV)
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
            // O SockOpt aponta optVal para o próprio optValInt: a cópia do push_back ainda apontava para o
            // temporário, que já saiu da pilha quando o transportCreate o lê.
            transport.sockOptParams.sockOpts.back().setOptValInt(1);
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
        AccountProfile profile = config_.profile.account;
        if (input.serverPorts) profile.serverPorts = *input.serverPorts;
        const AccountFields fields =
            BuildAccount(profile, input.address, input.ramal, input.senha, input.transport, L"");
        const PjAccountSettings settings = ToPjAccount(fields);
        const pj::AccountConfig config = MakeAccountConfig(settings, settings.transport == "tcp" ? tcpId_ : udpId_);
        // O id vem antes do create(): uma resposta que chegue durante ele já sai com o id da conta.
        const int accountId = ++lastAccountId_;
        std::unique_ptr<EngineAccount> account(new EngineAccount(&events_, &calls_, endpoint_.get(), accountId));
        try {
            // Sem rede a conta nasce parada: registra quando SetNetworkAvailable(true) chegar. Cada vez que
            // ela volta a ficar registrada, o BLF que tinha acabado é assinado de novo (na thread dos
            // eventos, fora do callback do PJSIP).
            account->Start(config, !networkAvailable_, [this, accountId] {
                events_.Post([this, accountId](EngineListener&) { RetryBlf(accountId); });
            });
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
        if (!networkAvailable_) {
            Log(3, "renovar o registro: sem rede, nada a fazer");
            return;
        }
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
        if (account_ && networkAvailable_) RefreshRegistration();
    }

    void SetNetworkAvailable(bool available) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        if (!available) {
            if (!networkAvailable_) return;
            networkAvailable_ = false;
            Log(3, "sem rede: o registro e o BLF param");
            if (!account_) return;
            DropBlf();
            for (auto& entry : blf_) entry.second.track->SetUnknown(false);
            switch (account_->Pause(kUnregisterWaitMs)) {
                case EngineAccount::Exit::Confirmed:
                    Log(3, "sem rede: o registro saiu do servidor");
                    break;
                case EngineAccount::Exit::NothingToRemove:
                    Log(3, "sem rede: a conta nao estava registrada");
                    break;
                case EngineAccount::Exit::NoAnswer:
                    Log(3, "sem rede: o servidor nao confirmou a saida (o registro para assim mesmo)");
                    break;
            }
            return;
        }
        const bool wasDown = !networkAvailable_;
        networkAvailable_ = true;
        if (!account_) return;
        Log(3, wasDown ? "a rede voltou: registrando de novo" : "rede disponivel: renovando o registro");
        if (wasDown) {
            account_->Resume();
        } else {
            account_->Register();
        }
        for (const std::string& number : blfNumbers_) {
            if (!blf_[number].buddy) SubscribeBlf(number);
        }
    }

    void WatchBlf(const std::vector<std::string>& numbers) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        if (!account_) {
            if (!numbers.empty()) Log(2, "BLF sem conta: nada a assinar");
            return;
        }
        // A lista nova, sem vazios nem repetidos, na ordem em que veio.
        std::vector<std::string> wanted;
        for (const std::string& number : numbers) {
            if (number.empty() || std::find(wanted.begin(), wanted.end(), number) != wanted.end()) continue;
            if (number.size() > kMaxBlfNumber) {
                Log(2, "BLF: numero longo demais, ignorado");
                continue;
            }
            wanted.push_back(number);
        }
        // Quem saiu da lista: o ~Buddy manda o SUBSCRIBE com Expires: 0 (o buddy sai antes do track).
        for (auto it = blf_.begin(); it != blf_.end();) {
            if (std::find(wanted.begin(), wanted.end(), it->first) == wanted.end()) {
                it = blf_.erase(it);
            } else {
                ++it;
            }
        }
        blfNumbers_ = wanted;
        for (const std::string& number : wanted) {
            BlfEntry& entry = Entry(number);
            if (!networkAvailable_) {
                entry.track->SetUnknown(false);   // só avisa os que entraram (os outros já estão assim)
            } else if (!entry.buddy) {
                SubscribeBlf(number);
            }
        }
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

    std::vector<AudioDevice> AudioDevices() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return std::vector<AudioDevice>();
        return ListAudioDevices();
    }

    bool SetAudioDevices(int captureId, int playbackId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return false;
        try {
            const std::vector<AudioDevice> devices = ListAudioDevices();
            const bool captureOk = IsAudioDevice(devices, captureId, true);
            const bool playbackOk = IsAudioDevice(devices, playbackId, false);
            if (!captureOk) Log(2, "microfone " + std::to_string(captureId) + " desconhecido; usando o padrao");
            if (!playbackOk) Log(2, "alto-falante " + std::to_string(playbackId) + " desconhecido; usando o padrao");
            // Com nullAudio o motor fica no dispositivo nulo: trocar o dispositivo o tiraria dele.
            if (!config_.nullAudio) {
                pj::AudDevManager& manager = endpoint_->audDevManager();
                manager.setCaptureDev(captureOk ? captureId : PJMEDIA_AUD_DEFAULT_CAPTURE_DEV);
                manager.setPlaybackDev(playbackOk ? playbackId : PJMEDIA_AUD_DEFAULT_PLAYBACK_DEV);
            }
            return captureOk && playbackOk;
        } catch (const pj::Error& failure) {
            Log(1, "escolha dos dispositivos de som: " + failure.info());
            return false;
        }
    }

    void RefreshAudioDevices() {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread()) return;
        try {
            pj::AudDevManager& manager = endpoint_->audDevManager();
            if (config_.nullAudio) {
                // O motor fica no dispositivo nulo: so a lista muda.
                manager.refreshDevs();
                Log(3, "dispositivos de som relidos (dispositivo nulo)");
                return;
            }
            // Os nomes dos dispositivos de agora, na lista velha (o id e a posicao nela); -1 e o padrao.
            const std::vector<AudioDevice> old = ListAudioDevices();
            const std::string captureName = NameOf(old, manager.getCaptureDev());
            const std::string playbackName = NameOf(old, manager.getPlaybackDev());
            // Com o som aberto, o PJSIP nao pode reler debaixo dele (pjmedia_aud_dev_refresh): o nulo entra antes.
            const bool active = manager.sndIsActive();
            if (active) manager.setNullDev();
            manager.refreshDevs();
            const std::vector<AudioDevice> fresh = ListAudioDevices();
            const int captureId = IdOf(fresh, captureName, true);
            const int playbackId = IdOf(fresh, playbackName, false);
            manager.setCaptureDev(captureId);
            manager.setPlaybackDev(playbackId);
            Log(3, "dispositivos de som relidos: " + std::to_string(fresh.size()) + (active ? " (com o som aberto)" : ""));
        } catch (const pj::Error& failure) {
            Log(1, "reler os dispositivos de som: " + failure.info());
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
    // Os dispositivos do PJSIP (o id é a posição na lista) e, com nullAudio, mais o dispositivo nulo, que o
    // PJSIP não lista (sem som no sistema, como nos testes, a lista dele é vazia). Vazio se o PJSIP falha.
    std::vector<AudioDevice> ListAudioDevices() {
        std::vector<AudioDevice> devices;
        try {
            const pj::AudioDevInfoVector2& infos = endpoint_->audDevManager().enumDev2();
            for (size_t i = 0; i < infos.size(); ++i) {
                AudioDevice device;
                device.id = static_cast<int>(i);
                device.name = DeviceNameToUtf8(infos[i].name);
                device.capture = infos[i].inputCount > 0;
                device.playback = infos[i].outputCount > 0;
                devices.push_back(device);
            }
        } catch (const pj::Error& failure) {
            Log(1, "dispositivos de som: " + failure.info());
        }
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

    // O nome do dispositivo id na lista ("" para o padrão, o nulo ou um id que não está nela).
    static std::string NameOf(const std::vector<AudioDevice>& devices, int id) {
        if (id < 0) return std::string();
        for (const AudioDevice& device : devices) {
            if (device.id == id) return device.name;
        }
        return std::string();
    }

    // O id do dispositivo com esse nome que serve ao papel; -1 (o padrão) sem nome ou sem ele na lista.
    static int IdOf(const std::vector<AudioDevice>& devices, const std::string& name, bool capture) {
        if (name.empty()) return kDefaultAudioDevice;
        for (const AudioDevice& device : devices) {
            if (device.name == name && device.id >= 0 && (capture ? device.capture : device.playback)) return device.id;
        }
        return kDefaultAudioDevice;
    }

    // -1 é o padrão do sistema; outro id precisa estar na lista e servir ao papel (microfone ou alto-falante).
    static bool IsAudioDevice(const std::vector<AudioDevice>& devices, int id, bool capture) {
        if (id == kDefaultAudioDevice) return true;
        for (const AudioDevice& device : devices) {
            if (device.id == id) return capture ? device.capture : device.playback;
        }
        return false;
    }

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

    // Um ramal do BLF: o que se sabe dele e a assinatura de agora (vazia sem rede ou se o PJSIP a recusou).
    // O buddy é declarado depois: sai antes do track, que os avisos dele usam.
    struct BlfEntry {
        std::unique_ptr<BlfTrack> track;
        std::unique_ptr<BlfBuddy> buddy;
    };

    BlfEntry& Entry(const std::string& number) {
        BlfEntry& entry = blf_[number];
        if (!entry.track) entry.track.reset(new BlfTrack(&events_, number));
        return entry;
    }

    // Assina o BLF do número na conta de agora (a assinatura de antes, se havia, sai antes); se o PJSIP
    // recusa, o ramal fica Unknown.
    void SubscribeBlf(const std::string& number) {
        BlfEntry& entry = Entry(number);
        entry.buddy.reset();
        entry.track->Restart();
        pj::BuddyConfig config;
        config.uri = CallUri(number);
        config.subscribe = false;
        config.subscribe_dlg_event = true;
        std::unique_ptr<BlfBuddy> buddy(new BlfBuddy(entry.track.get()));
        try {
            buddy->create(*account_, config);
        } catch (const pj::Error& failure) {
            Log(1, "BLF: o PJSIP recusou a assinatura de " + config.uri + ": " + failure.info());
            entry.track->SetUnknown(true);
            return;
        }
        entry.buddy = std::move(buddy);
    }

    // Retira as assinaturas de BLF (a lista e o que se sabe de cada ramal ficam). Os avisos delas param aqui.
    void DropBlf() {
        for (auto& entry : blf_) entry.second.buddy.reset();
    }

    // A conta accountId voltou a ficar registrada (thread dos eventos): assina de novo os ramais cuja
    // assinatura acabou (recusada, vencida, sem resposta), sem esperar a nova tentativa do PJSIP (~5 min).
    void RetryBlf(int accountId) {
        std::lock_guard<std::mutex> lock(apiMutex_);
        if (!RegisterThread() || !account_ || account_->Id() != accountId || !networkAvailable_) return;
        for (const std::string& number : blfNumbers_) {
            BlfEntry& entry = Entry(number);
            if (!entry.buddy || entry.track->Ended()) SubscribeBlf(number);
        }
    }

    // Desliga as ligações, tira a conta do servidor (esperando a resposta, até um limite) e a apaga.
    // Nenhuma resposta de registro desta conta vira evento daqui em diante. As assinaturas de BLF saem
    // antes (o pjsua2 pede os buddies apagados antes da conta) e a lista delas se esvazia.
    void RetireAccount() {
        if (!account_) return;
        account_->Retire();
        blf_.clear();   // cada buddy antes do track dele
        blfNumbers_.clear();
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
    // Com a apiMutex_: a rede como o app a vê (SetNetworkAvailable), os ramais do BLF da conta, na ordem, e
    // cada um com o que se sabe dele e a assinatura de agora (vazia sem rede). Saem antes da conta
    // (RetireAccount).
    bool networkAvailable_ = true;
    std::vector<std::string> blfNumbers_;
    std::map<std::string, BlfEntry> blf_;
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

void SipEngine::SetNetworkAvailable(bool available) { impl_->SetNetworkAvailable(available); }

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

}  // namespace starsonic
