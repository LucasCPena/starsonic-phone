#pragma once
// O motor de verdade (o SipEngine, starsonic/phone) para o DesktopApp: o CallEngine do controlador e o
// RegistrationPort do registro e do som, e os eventos do motor repassados ao listener (o DesktopApp).
//
// O SipEngine::Create pode demorar (o PJSIP e os dispositivos de som; com stun= no perfil, uns 8 s por servidor que
// nao responde): Start o cria numa thread propria, e a janela abre sem esperar. Os metodos que precisam do motor
// esperam ele ficar pronto: so a thread de comandos do DesktopApp (e a de eventos do proprio motor) os chama, nunca a
// da janela. CallCount nunca espera (sem motor: 0). Se o Create falha, os metodos devolvem o "nao deu" de cada um
// (0, -1, false, a lista vazia), e o diagnostico diz por que.
//
// Fechar (DesktopApp.h): depois do Shutdown do DesktopApp e do Stop do agendador, Stop() destroi o motor (nenhum
// evento depois); o listener precisa durar ate la.
//
// (0.3.0) O video: o sink dos quadros (SetFrameSink) nao espera o motor; ele e guardado e passado ao motor quando ele
// fica pronto, e precisa durar ate o Stop. O apartamento multithread do COM (o das cameras da DirectShow) fica
// reservado do Start ao fim do Stop, e o Stop destroi o motor numa thread fora da STA da janela (EngineHost.cpp).
// SetCameraPaused (a sessao do Windows bloqueada ou desconectada) tambem nao espera o motor nem o toca na thread de
// quem chama (a da janela, STA): guarda o valor e uma thread propria do EngineHost o aplica (ver o .cpp).
#include <windows.h>

#include <objbase.h>

#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "CallEngine.h"
#include "DesktopApp.h"
#include "SipEngine.h"

namespace starsonic {

class EngineHost : public CallEngine, public RegistrationPort, public EngineListener {
public:
    using LogFunction = std::function<void(const std::string& line)>;

    // config.userAgent: "Starsonic Phone/<versao>". log: o diagnostico (de qualquer thread).
    EngineHost(EngineConfig config, LogFunction log);
    ~EngineHost() override;   // Stop()

    EngineHost(const EngineHost&) = delete;
    EngineHost& operator=(const EngineHost&) = delete;

    // Os eventos do motor vao para listener (que precisa durar ate o Stop). Antes do Start.
    void SetListener(EngineListener* listener) { listener_.store(listener); }
    // (0.3.0) Os quadros do video vao para sink (SipEngine::SetFrameSink). Nunca espera a criacao: guarda o sink e o
    // passa ao motor quando ele fica pronto (ja pronto: agora). O sink precisa durar ate o Stop.
    void SetFrameSink(FrameSink* sink);
    // (0.3.0) Pausa ou volta a camera de todas as ligacoes (SipEngine::SetCameraPaused: a sessao bloqueada ou
    // desconectada). Da thread da janela: so guarda o valor e acorda a thread que o aplica ao motor (a ultima mudanca
    // vale; varias seguidas viram uma). Antes de o motor ficar pronto, o valor espera e e aplicado ao ficar pronto.
    // Depois do Stop, nao faz nada.
    void SetCameraPaused(bool paused);
    // Cria o motor numa thread propria (uma vez).
    void Start();
    // Espera a criacao terminar e destroi o motor (demora ~1 s; ate ~5 s se o servidor nao responde), numa thread curta
    // fora da STA de quem chama, que o Stop espera.
    void Stop();

    // CallEngine
    int MakeCall(const std::string& number, bool video) override;
    bool Answer(int callId, bool video) override;
    bool SetCamera(int callId, bool on) override;
    bool Reject(int callId) override;
    bool Hangup(int callId) override;
    bool Activate(int callId) override;
    bool Join(int callId, int otherId) override;
    bool Split(int callId, int otherId) override;
    bool SetHold(int callId, bool hold) override;
    void SetMute(bool muted) override;
    bool SendDtmf(int callId, const std::string& digits) override;
    bool Transfer(int callId, const std::string& number) override;
    bool TransferAttended(int callId, int targetCallId) override;
    int CallCount() const override;
    int RoomAdd(const std::string& number) override;   // (0.4.0) a sala de video: espera o motor, como o MakeCall

    // RegistrationPort
    int SetAccount(const AccountInput& input) override;
    void RemoveAccount() override;
    std::vector<AudioDevice> AudioDevices() override;
    bool SetAudioDevices(int captureId, int playbackId) override;
    void RefreshAudioDevices() override;
    void WatchBlf(const std::vector<std::string>& numbers) override;   // rc.3
    void SetNetworkAvailable(bool available) override;                 // rc.3
    // Video (0.3.0): as cameras e as escolhas do video. Rodam na thread de comandos do DesktopApp, que nao e a STA da
    // janela (SipEngine.h: as cameras abrem, fecham e leem na thread de quem chama).
    std::vector<VideoDevice> VideoDevices() override;
    bool SetCaptureDevice(const std::string& name) override;
    void RefreshVideoDevices() override;
    bool StartCameraTest() override;
    void StopCameraTest() override;
    void SetVideoSettings(const VideoSettings& settings) override;

    // EngineListener (do SipEngine): repassados ao listener; o OnLog vai direto ao diagnostico.
    void OnRegistration(int sipCode, bool active, int accountId) override;
    void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) override;
    void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) override;
    void OnCallState(int callId, CallState state, int sipCode) override;
    void OnTransfer(int callId, int sipCode) override;
    void OnBlf(const std::string& number, BlfState state) override;
    void OnCallVideo(int callId, const CallVideo& video) override;
    void OnCameraProblem(CameraProblem problem) override;
    void OnRoom(const RoomInfo& room) override;   // (0.4.0) a sala de video
    void OnLog(int level, const std::string& line) override;

private:
    void Create();
    // A thread das pausas: espera o motor ficar pronto e um valor novo, e o aplica fora da trava.
    void PauseLoop();
    // O motor, depois de esperar a criacao (nullptr: falhou, ou ja parou).
    SipEngine* Ready();

    EngineConfig config_;
    LogFunction log_;
    std::atomic<EngineListener*> listener_{nullptr};

    std::mutex mutex_;
    std::condition_variable created_;
    bool started_ = false;
    bool done_ = false;                    // a criacao terminou (com ou sem motor)
    std::unique_ptr<SipEngine> engine_;    // escrito na criacao e no Stop
    std::atomic<SipEngine*> live_{nullptr};   // o motor para os metodos (nullptr antes, se falhou e no Stop)
    std::thread creator_;
    // (0.3.0) A pausa da camera, com o mutex_: o ultimo valor pedido, se ainda falta aplica-lo, e a thread que o faz.
    std::condition_variable pauseWake_;
    std::thread pauseWorker_;
    bool paused_ = false;
    bool pauseDirty_ = false;
    bool stopping_ = false;
    FrameSink* sink_ = nullptr;                    // (0.3.0) com o mutex_: o sink dos quadros, para o motor
    CO_MTA_USAGE_COOKIE mtaCookie_ = nullptr;      // (0.3.0) com o mutex_: o CoIncrementMTAUsage do Start
};

}  // namespace starsonic
