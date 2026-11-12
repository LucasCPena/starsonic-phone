#include "EngineHost.h"

#include <cstdio>
#include <system_error>
#include <utility>

namespace starsonic {

EngineHost::EngineHost(EngineConfig config, LogFunction log) : config_(std::move(config)), log_(std::move(log)) {}

EngineHost::~EngineHost() { Stop(); }

void EngineHost::SetFrameSink(FrameSink* sink) {
    std::lock_guard<std::mutex> lock(mutex_);
    sink_ = sink;
    // Sem a espera do Ready: o SipEngine::SetFrameSink so pega a trava do desenhista (nunca a da API do motor).
    if (engine_) engine_->SetFrameSink(sink);
}

void EngineHost::Start() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (started_) return;
    started_ = true;
    // (0.3.0) O apartamento multithread do COM fica de pe do Create ate o motor sair (ver o Stop), antes de o criador
    // rodar o Create.
    CO_MTA_USAGE_COOKIE cookie = nullptr;
    const HRESULT mta = CoIncrementMTAUsage(&cookie);
    if (SUCCEEDED(mta)) {
        mtaCookie_ = cookie;
    } else if (log_) {
        char code[16];
        std::snprintf(code, sizeof(code), "0x%08lx", static_cast<unsigned long>(mta));
        log_(std::string("o COM multithread nao ficou reservado para o motor: ") + code);
    }
    creator_ = std::thread([this] { Create(); });
    // (0.3.0) A thread das pausas da camera (ver o SetCameraPaused). Sem ela, o valor fica guardado e nunca chega ao
    // motor: so a camera da sessao bloqueada deixa de pausar, o resto funciona.
    try {
        pauseWorker_ = std::thread([this] { PauseLoop(); });
    } catch (const std::system_error&) {
        if (log_) log_("a thread da pausa da camera nao abriu");
    }
}

// A camera pausada pela sessao do Windows. O SipEngine::SetCameraPaused faz o STOP_TRANSMIT de cada ligacao, que pode
// fechar a captura da DirectShow, e esses objetos do COM vivem no apartamento multithread (o do Create). Quem chama
// aqui e a thread da janela, que e STA: ela nunca toca o motor, nem espera por ele. Guarda o ultimo valor e acorda a
// thread propria (sem apartamento proprio: o multithread implicito, mantido pelo CoIncrementMTAUsage do Start), que o
// aplica. Varias mudancas seguidas viram a ultima. O valor que chega antes de o motor existir fica guardado, e a
// thread o aplica quando o Create termina: bloquear e desbloquear nesse intervalo nunca se perde.
void EngineHost::SetCameraPaused(bool paused) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (stopping_) return;
    paused_ = paused;
    pauseDirty_ = true;
    pauseWake_.notify_all();
}

void EngineHost::PauseLoop() {
    std::unique_lock<std::mutex> lock(mutex_);
    for (;;) {
        pauseWake_.wait(lock, [this] { return stopping_ || (pauseDirty_ && done_); });
        if (stopping_) return;
        const bool paused = paused_;
        pauseDirty_ = false;
        SipEngine* engine = live_.load();
        if (!engine) continue;   // o motor nao abriu: nada a pausar
        // Fora da trava: o motor pode demorar (fechar a camera). O motor nao sai antes de o Stop juntar esta thread.
        lock.unlock();
        engine->SetCameraPaused(paused);
        lock.lock();
    }
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
    // (0.3.0) O sink que chegou antes do motor (o SetFrameSink nao espera a criacao).
    if (engine_ && sink_) engine_->SetFrameSink(sink_);
    live_.store(engine_.get());
    done_ = true;
    created_.notify_all();
    pauseWake_.notify_all();   // (0.3.0) a pausa que chegou antes do motor
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
    std::thread pauseWorker;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        creator = std::move(creator_);
        pauseWorker = std::move(pauseWorker_);
        stopping_ = true;
        pauseWake_.notify_all();
    }
    if (creator.joinable()) creator.join();
    // A thread das pausas sai antes de o motor ser destruido: nenhuma pausa toca o motor depois do Stop.
    if (pauseWorker.joinable()) pauseWorker.join();
    std::unique_ptr<SipEngine> engine;
    CO_MTA_USAGE_COOKIE cookie = nullptr;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        live_.store(nullptr);
        engine = std::move(engine_);
        cookie = mtaCookie_;
        mtaCookie_ = nullptr;
        done_ = true;
        created_.notify_all();
    }
    // Fora da trava: o destrutor ainda manda linhas de log e espera o listener.
    //
    // (0.3.0) E numa thread curta, que o Stop espera (nenhum evento depois de ele voltar, e o listener dura ate la,
    // como antes): quem chama o Stop e a thread da janela, que e STA (o CoInitializeEx do main.cpp). A fabrica das
    // cameras da PJSIP (a DirectShow) entra no COM multithread na thread do criador, durante o Create, e o
    // CoUninitialize dela roda no pjsua_destroy, que tambem fecha uma camera aberta. Na thread da janela, esse
    // CoUninitialize desfaria o apartamento dela, e a camera fecharia fora do apartamento em que abriu. Na thread curta
    // (sem apartamento proprio: o multithread implicito), a camera fecha no multithread, e o CoUninitialize nao chega a
    // STA da janela. O multithread fica de pe pelo CoIncrementMTAUsage do Start, ate depois de o motor sair (o
    // CoDecrementMTAUsage abaixo): ele nao depende da referencia que a thread do criador deixou ao sair.
    if (engine) {
        std::thread destroyer;
        try {
            destroyer = std::thread([&engine] { engine.reset(); });
        } catch (const std::system_error&) {
        }
        if (destroyer.joinable()) {
            destroyer.join();
        } else {
            engine.reset();   // a thread nao abriu: aqui mesmo, como antes
        }
    }
    if (cookie) CoDecrementMTAUsage(cookie);
}

int EngineHost::MakeCall(const std::string& number, bool video) {
    SipEngine* engine = Ready();
    return engine ? engine->MakeCall(number, video) : -1;
}

bool EngineHost::Answer(int callId, bool video) {
    SipEngine* engine = Ready();
    return engine && engine->Answer(callId, video);
}

bool EngineHost::SetCamera(int callId, bool on) {
    SipEngine* engine = Ready();
    return engine && engine->SetCamera(callId, on);
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

int EngineHost::RoomAdd(const std::string& number) {
    SipEngine* engine = Ready();
    return engine ? engine->RoomAdd(number) : -1;
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

void EngineHost::WatchBlf(const std::vector<std::string>& numbers) {
    if (SipEngine* engine = Ready()) engine->WatchBlf(numbers);
}

void EngineHost::SetNetworkAvailable(bool available) {
    if (SipEngine* engine = Ready()) engine->SetNetworkAvailable(available);
}

std::vector<VideoDevice> EngineHost::VideoDevices() {
    SipEngine* engine = Ready();
    return engine ? engine->VideoDevices() : std::vector<VideoDevice>();
}

bool EngineHost::SetCaptureDevice(const std::string& name) {
    SipEngine* engine = Ready();
    return engine && engine->SetCaptureDevice(name);
}

void EngineHost::RefreshVideoDevices() {
    if (SipEngine* engine = Ready()) engine->RefreshVideoDevices();
}

bool EngineHost::StartCameraTest() {
    SipEngine* engine = Ready();
    return engine && engine->StartCameraTest();
}

void EngineHost::StopCameraTest() {
    if (SipEngine* engine = Ready()) engine->StopCameraTest();
}

void EngineHost::SetVideoSettings(const VideoSettings& settings) {
    if (SipEngine* engine = Ready()) engine->SetVideoSettings(settings);
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

void EngineHost::OnBlf(const std::string& number, BlfState state) {
    if (EngineListener* listener = listener_.load()) listener->OnBlf(number, state);
}

void EngineHost::OnCallVideo(int callId, const CallVideo& video) {
    if (EngineListener* listener = listener_.load()) listener->OnCallVideo(callId, video);
}

void EngineHost::OnCameraProblem(CameraProblem problem) {
    if (EngineListener* listener = listener_.load()) listener->OnCameraProblem(problem);
}

void EngineHost::OnLog(int level, const std::string& line) {
    // Como o DesktopApp::OnLog, sem passar pela fila (o OnLog chega com as travas do motor presas).
    if (log_) log_("motor " + std::to_string(level) + ": " + line);
}

}  // namespace starsonic
