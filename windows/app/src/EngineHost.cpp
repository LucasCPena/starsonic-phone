#include "EngineHost.h"

#include <utility>

namespace starsonic {

EngineHost::EngineHost(EngineConfig config, LogFunction log) : config_(std::move(config)), log_(std::move(log)) {}

EngineHost::~EngineHost() { Stop(); }

void EngineHost::Start() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (started_) return;
    started_ = true;
    creator_ = std::thread([this] { Create(); });
}

void EngineHost::Create() {
    std::string error;
    std::unique_ptr<SipEngine> engine = SipEngine::Create(config_, this, &error);
    if (engine) {
        if (log_) log_("motor pronto: " + config_.userAgent);
        // Os nomes que o motor ve (o Configuracoes compara com os rotulos do WebView2).
        std::string names;
        for (const AudioDevice& device : engine->AudioDevices()) {
            if (!names.empty()) names += " | ";
            names += std::to_string(device.id) + (device.capture ? "e" : "") + (device.playback ? "s" : "") + " " +
                     device.name;
        }
        if (log_) log_("motor dispositivos de som: " + (names.empty() ? std::string("(nenhum)") : names));
    } else if (log_) {
        log_("o motor nao abriu: " + error);
    }
    std::lock_guard<std::mutex> lock(mutex_);
    engine_ = std::move(engine);
    live_.store(engine_.get());
    done_ = true;
    created_.notify_all();
}

SipEngine* EngineHost::Ready() {
    {
        std::unique_lock<std::mutex> lock(mutex_);
        if (!started_) return nullptr;
        created_.wait(lock, [this] { return done_; });
    }
    return live_.load();
}

void EngineHost::Stop() {
    std::thread creator;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        creator = std::move(creator_);
    }
    if (creator.joinable()) creator.join();
    std::unique_ptr<SipEngine> engine;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        live_.store(nullptr);
        engine = std::move(engine_);
        done_ = true;
        created_.notify_all();
    }
    engine.reset();   // fora da trava: o destrutor ainda manda linhas de log e espera o listener
}

int EngineHost::MakeCall(const std::string& number) {
    SipEngine* engine = Ready();
    return engine ? engine->MakeCall(number) : -1;
}

bool EngineHost::Answer(int callId) {
    SipEngine* engine = Ready();
    return engine && engine->Answer(callId);
}

bool EngineHost::Reject(int callId) {
    SipEngine* engine = Ready();
    return engine && engine->Reject(callId);
}

bool EngineHost::Hangup(int callId) {
    SipEngine* engine = Ready();
    return engine && engine->Hangup(callId);
}

bool EngineHost::Activate(int callId) {
    SipEngine* engine = Ready();
    return engine && engine->Activate(callId);
}

bool EngineHost::Join(int callId, int otherId) {
    SipEngine* engine = Ready();
    return engine && engine->Join(callId, otherId);
}

bool EngineHost::Split(int callId, int otherId) {
    SipEngine* engine = Ready();
    return engine && engine->Split(callId, otherId);
}

bool EngineHost::SetHold(int callId, bool hold) {
    SipEngine* engine = Ready();
    return engine && engine->SetHold(callId, hold);
}

void EngineHost::SetMute(bool muted) {
    SipEngine* engine = Ready();
    if (engine) engine->SetMute(muted);
}

bool EngineHost::SendDtmf(int callId, const std::string& digits) {
    SipEngine* engine = Ready();
    return engine && engine->SendDtmf(callId, digits);
}

bool EngineHost::Transfer(int callId, const std::string& number) {
    SipEngine* engine = Ready();
    return engine && engine->Transfer(callId, number);
}

bool EngineHost::TransferAttended(int callId, int targetCallId) {
    SipEngine* engine = Ready();
    return engine && engine->TransferAttended(callId, targetCallId);
}

int EngineHost::CallCount() const {
    const SipEngine* engine = live_.load();
    return engine ? engine->CallCount() : 0;
}

int EngineHost::SetAccount(const AccountInput& input) {
    SipEngine* engine = Ready();
    return engine ? engine->SetAccount(input) : 0;
}

void EngineHost::RemoveAccount() {
    SipEngine* engine = Ready();
    if (engine) engine->RemoveAccount();
}

std::vector<AudioDevice> EngineHost::AudioDevices() {
    SipEngine* engine = Ready();
    return engine ? engine->AudioDevices() : std::vector<AudioDevice>();
}

bool EngineHost::SetAudioDevices(int captureId, int playbackId) {
    SipEngine* engine = Ready();
    return engine && engine->SetAudioDevices(captureId, playbackId);
}

void EngineHost::RefreshAudioDevices() {
    if (SipEngine* engine = Ready()) engine->RefreshAudioDevices();
}

void EngineHost::OnRegistration(int sipCode, bool active, int accountId) {
    if (EngineListener* listener = listener_.load()) listener->OnRegistration(sipCode, active, accountId);
}

void EngineHost::OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) {
    if (EngineListener* listener = listener_.load()) listener->OnIncomingCall(callId, remoteUser, remoteName);
}

void EngineHost::OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) {
    if (EngineListener* listener = listener_.load()) listener->OnRejectedBusy(remoteUser, remoteName);
}

void EngineHost::OnCallState(int callId, CallState state, int sipCode) {
    if (EngineListener* listener = listener_.load()) listener->OnCallState(callId, state, sipCode);
}

void EngineHost::OnTransfer(int callId, int sipCode) {
    if (EngineListener* listener = listener_.load()) listener->OnTransfer(callId, sipCode);
}

void EngineHost::OnLog(int level, const std::string& line) {
    // Como o DesktopApp::OnLog, sem passar pela fila (o OnLog chega com as travas do motor presas).
    if (log_) log_("motor " + std::to_string(level) + ": " + line);
}

}  // namespace starsonic
