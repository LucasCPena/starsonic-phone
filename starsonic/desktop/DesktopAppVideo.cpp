#include "DesktopApp.h"

#include <algorithm>
#include <string>
#include <vector>

// O video do DesktopApp (0.3.0): as escolhas que vao ao motor, a situacao do modulo H.264, a camera e o teste dela, as
// vistas e o modo da janela, e os avisos da camera. Os mesmos metodos da classe, em um arquivo so (o DesktopApp.cpp
// ficou grande); os ganchos dentro dos outros metodos (Execute, BuildState, AdminSet...) ficam la.
namespace starsonic {

namespace {

// 0.3.0: os avisos da camera (o OnCameraProblem).
const char kNoCamera[] = "Nenhuma c\xc3\xa2mera encontrada.";
const char kCameraInUse[] = "A c\xc3\xa2mera est\xc3\xa1 sendo usada por outro programa.";
const char kCameraGone[] = "A c\xc3\xa2mera foi desconectada.";
const char kCameraBlocked[] =
    "O Windows bloqueou a c\xc3\xa2mera para este app. Libere em Configura\xc3\xa7\xc3\xb5" "es do Windows \xe2\x86\x92 "
    "Privacidade e seguran\xc3\xa7" "a \xe2\x86\x92 C\xc3\xa2mera.";

}  // namespace

// ---------------------------------------------------------------- 0.3.0: o video

// A abertura do video (so no Windows): a camera escolhida vai ao motor, a lista de cameras entra no estado, o modulo
// H.264 e pedido se esta ligado e as escolhas vao ao motor.
void DesktopApp::StartVideo() {
    const Settings settings = settings_.Get();
    if (!settings.cameraName.empty() && !port_.SetCaptureDevice(settings.cameraName)) {
        Log("video: o motor nao aceitou a camera escolhida");
    }
    RefreshCameras();
    ApplyH264Wish();
    PushVideoSettings();
}

// Le as cameras que o motor lista agora (so os nomes, na ordem dele).
void DesktopApp::RefreshCameras() {
    cameras_.clear();
    for (const VideoDevice& device : port_.VideoDevices()) cameras_.push_back(device.name);
    Log("video: " + std::to_string(cameras_.size()) + " camera(s)");
}

// O H.264 que vale: ligado no cartao do administrador e pela pessoa.
bool DesktopApp::H264Wanted() const { return admin_.Get().videoH264 && settings_.Get().h264Person; }

// As escolhas que o motor recebe: o cartao, os Porteiros e o h264Available (o H.264 que vale e o modulo instalado).
VideoSettings DesktopApp::VideoChoices() const {
    const AdminConfig& admin = admin_.Get();
    VideoSettings choices;
    choices.h264 = admin.videoH264;
    choices.vp8 = admin.videoVp8;
    choices.vp9 = admin.videoVp9;
    choices.first = admin.videoFirst;
    choices.quality = admin.videoQuality;
    choices.h264Available = H264Wanted() && h264State_ == H264State::Installed;
    choices.doorphones = admin.doorphones;
    return choices;
}

// Manda ao motor as escolhas de agora, se mudaram desde a ultima vez.
void DesktopApp::PushVideoSettings() {
    const VideoSettings choices = VideoChoices();
    if (videoSent_ && videoSent_->h264 == choices.h264 && videoSent_->vp8 == choices.vp8 &&
        videoSent_->vp9 == choices.vp9 && videoSent_->first == choices.first &&
        videoSent_->quality == choices.quality && videoSent_->h264Available == choices.h264Available &&
        videoSent_->doorphones == choices.doorphones) {
        return;
    }
    videoSent_ = choices;
    port_.SetVideoSettings(choices);
}

// O cartao ou a pessoa mudou o H.264: desligado, a situacao e "desligado"; ligado de novo (ou na abertura) sem estar
// instalado, vira "baixando" e o executavel baixa e confere o modulo (hooks.h264Ensure), que responde pelo SetH264State.
void DesktopApp::ApplyH264Wish() {
    if (!H264Wanted()) {
        h264State_ = H264State::Off;
        return;
    }
    if (h264State_ != H264State::Off) return;
    h264State_ = H264State::Downloading;
    Log("video: o modulo H.264 foi pedido");
    if (hooks_.h264Ensure) hooks_.h264Ensure();
}

void DesktopApp::HandleH264State(H264State state) {
    if (IPhone() || !H264Wanted()) return;   // um resultado atrasado, com o H.264 desligado: nada muda
    if (state != H264State::Installed && state != H264State::Failed) return;
    h264State_ = state;
    Log(state == H264State::Installed ? "video: o modulo H.264 esta instalado" : "video: o modulo H.264 falhou");
    PushVideoSettings();
}

void DesktopApp::H264Retry() {
    if (h264State_ != H264State::Failed || !H264Wanted()) {
        Log("h264Retry ignorado: nao houve falha");
        return;
    }
    h264State_ = H264State::Downloading;
    Log("video: o modulo H.264 foi pedido de novo");
    if (hooks_.h264Ensure) hooks_.h264Ensure();
}

// Primeiro grava (como o setAudio): o motor so recebe o que ficou gravado. Se o disco recusa, nada muda (a linha do
// SaveSettings vai ao diagnostico) e a escolha nao chega ao motor.
void DesktopApp::SetVideoChoices(const Command& command) {
    Settings settings = settings_.Get();
    if (command.cameraName) settings.cameraName = *command.cameraName;
    if (command.h264) settings.h264Person = *command.h264;
    SaveSettings(settings);
    const Settings saved = settings_.Get();
    if (command.cameraName && saved.cameraName == *command.cameraName &&
        !port_.SetCaptureDevice(saved.cameraName)) {
        Log("video: o motor nao aceitou a camera escolhida");
    }
    ApplyH264Wish();
    PushVideoSettings();
}

void DesktopApp::CameraTest(bool on) {
    if (on) {
        if (cameraTest_) return;   // ja ligado: o motor nao abre a camera duas vezes
        cameraTest_ = port_.StartCameraTest();
        if (!cameraTest_) Log("video: o teste da camera nao ligou");
        return;
    }
    port_.StopCameraTest();
    cameraTest_ = false;
}

// Uma vista que nao e da pagina e ignorada (a "principal" tem remoto e local; o "aviso", o porteiro).
void DesktopApp::VideoViews(const Command& command) {
    const bool notice = command.page == "aviso";
    std::vector<std::string> views;
    for (const std::string& view : command.views) {
        const bool fits = notice ? view == "porteiro" : (view == "remoto" || view == "local");
        if (fits && std::find(views.begin(), views.end(), view) == views.end()) views.push_back(view);
    }
    if (hooks_.videoViews) hooks_.videoViews(views, notice);
}

void DesktopApp::VideoWindow(const std::string& mode) {
    if (mode != "normal" && mode != "grande" && mode != "telaCheia") {
        Log("videoWindow ignorado: modo desconhecido");
        return;
    }
    videoWindow_ = mode;
    if (hooks_.videoWindow) hooks_.videoWindow(mode);
}

// O aviso da camera (o toast). O que o motor parou (a camera que some ou que nao abre de novo) para tambem o teste.
void DesktopApp::HandleCameraProblem(CameraProblem problem) {
    if (IPhone()) return;
    switch (problem) {
        case CameraProblem::NoCamera:
            Log("video: nenhuma camera");
            Toast(kNoCamera);
            break;
        case CameraProblem::OpenFailed: {
            const bool blocked = hooks_.cameraBlocked && hooks_.cameraBlocked();
            Log(blocked ? "video: a camera nao abriu (bloqueada pelo Windows)" : "video: a camera nao abriu");
            Toast(blocked ? kCameraBlocked : kCameraInUse);
            cameraTest_ = false;
            break;
        }
        case CameraProblem::Disconnected:
            Log("video: a camera foi desconectada");
            Toast(kCameraGone);
            cameraTest_ = false;
            break;
    }
}

}  // namespace starsonic
