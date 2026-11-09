// Só o motor do PJSIP com o vídeo (o do Linux dos testes, como o do Windows): os codecs de vídeo, as ligações com
// vídeo (a oferta, o atender, a câmera e as recusas), as pausas (a espera, a segunda ligação, a conferência, a
// transferência e a tela bloqueada) e o 183 dos Porteiros, contra o registrador falso (a PORTA do vídeo conta os
// pacotes que a nossa câmera manda). Com o PJSIP sem o vídeo (como o do Android), só o contrato do motor sem vídeo,
// o mesmo do motor do baresip (test_engine_baresip.cpp).
#include "call_fixture.h"

#include <pjsua-lib/pjsua.h>
#if PJMEDIA_HAS_VIDEO
#include <pjmedia-videodev/videodev_imp.h>
#endif

#include <algorithm>
#include <chrono>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "SipEngine.h"
#include "Video.h"

using namespace starsonic;
using phone_test::Phone;

#if PJMEDIA_HAS_VIDEO
using phone_test::CallEvent;
using phone_test::Contains;
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::RecordingListener;
using phone_test::Transfers;
using phone_test::VideoEvent;
using phone_test::WaitUntil;

namespace {

// As escolhas dos testes: as de fábrica, com o H.264 disponível (o OpenH264 do sistema).
VideoSettings TestSettings() {
    VideoSettings settings;
    settings.h264Available = true;
    return settings;
}

bool CameraOn(const CallVideo& video) { return video.active && video.camera; }

bool WaitVideo(Phone& phone, int id, const std::function<bool(const CallVideo&)>& condition) {
    return phone.listener.WaitForVideo(id, condition, kWaitSeconds);
}

// A contagem da PORTA do vídeo sobe mais count pacotes em até 5 s.
bool PacketsRise(Phone& phone, int count = 10) {
    const int before = phone.registrar.VideoPackets();
    return phone.registrar.WaitForVideoPackets(before + count, 5);
}

// Depois de 500 ms (o que já estava a caminho chega), nada mais chega na PORTA do vídeo por 1 s.
bool PacketsStop(Phone& phone) {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    return phone.registrar.VideoPacketsStay(1);
}

// Uma ligação com vídeo para number, confirmada, com a câmera ligada e a imagem saindo.
int VideoCall(Phone& phone, const std::string& number) {
    const int before = phone.registrar.VideoPackets();
    const int id = phone.engine->MakeCall(number, true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(WaitVideo(phone, id, CameraOn));
    REQUIRE(phone.registrar.WaitForVideoPackets(before + 20, 5));
    return id;
}

// O evento de recusa da ligação (o primeiro); falha o teste se não houve.
CallVideo RefusedEvent(const Phone& phone, int id) {
    for (const VideoEvent& event : phone.listener.Videos()) {
        if (event.callId == id && event.video.refused) return event.video;
    }
    FAIL("nenhum evento com o refused");
    return CallVideo();
}

// As linhas do registro de ligações que começam com prefix.
size_t LinesStartingWith(const Phone& phone, const std::string& prefix) {
    const Lines log = phone.registrar.Log();
    return static_cast<size_t>(std::count_if(log.begin(), log.end(), [&](const std::string& line) {
        return line.rfind(prefix, 0) == 0;
    }));
}

// Um evento do Timeline: o OnCallVideo, e com o campo dele, se field não é vazio ("active", "refused"...).
bool IsVideoEvent(const std::string& event, const std::string& field = "") {
    return event.rfind("video(", 0) == 0 && (field.empty() || Contains(event, field));
}

// Uma câmera que não abre (ocupada por outro programa, por exemplo): a fábrica de vídeo "Quebrada" da PJSIP, com um
// dispositivo de captura I420 cujo stream nunca abre. A lista de vídeo e o stream da ligação a aceitam (o formato
// dela casa com o do codificador); só o START_TRANSMIT, que abre a câmera, falha.
struct BrokenCamera {
    pjmedia_vid_dev_factory base;   // o primeiro campo: a PJSIP só conhece este, e o ponteiro dele é o da struct
    pj_pool_t* pool;
    pjmedia_vid_dev_info info;
};

const char kBrokenCamera[] = "Quebrada";

BrokenCamera* BrokenOf(pjmedia_vid_dev_factory* factory) { return reinterpret_cast<BrokenCamera*>(factory); }

pj_status_t BrokenInit(pjmedia_vid_dev_factory* factory) {
    pjmedia_vid_dev_info& info = BrokenOf(factory)->info;
    pj_bzero(&info, sizeof(info));
    pj_ansi_strxcpy(info.name, kBrokenCamera, sizeof(info.name));
    pj_ansi_strxcpy(info.driver, kBrokenCamera, sizeof(info.driver));
    info.dir = PJMEDIA_DIR_CAPTURE;
    info.caps = PJMEDIA_VID_DEV_CAP_FORMAT;
    info.fmt_cnt = 1;
    pjmedia_format_init_video(&info.fmt[0], PJMEDIA_FORMAT_I420, 640, 480, 25, 1);
    return PJ_SUCCESS;
}

pj_status_t BrokenDestroy(pjmedia_vid_dev_factory* factory) {
    pj_pool_release(BrokenOf(factory)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

unsigned BrokenCount(pjmedia_vid_dev_factory*) { return 1; }

pj_status_t BrokenInfo(pjmedia_vid_dev_factory* factory, unsigned index, pjmedia_vid_dev_info* info) {
    if (index != 0) return PJMEDIA_EVID_INVDEV;
    *info = BrokenOf(factory)->info;
    return PJ_SUCCESS;
}

pj_status_t BrokenDefaultParam(pj_pool_t*, pjmedia_vid_dev_factory* factory, unsigned index,
                               pjmedia_vid_dev_param* param) {
    if (index != 0) return PJMEDIA_EVID_INVDEV;
    pj_bzero(param, sizeof(*param));
    param->dir = PJMEDIA_DIR_CAPTURE;
    param->cap_id = static_cast<pjmedia_vid_dev_index>(index);
    param->rend_id = PJMEDIA_VID_INVALID_DEV;
    param->flags = PJMEDIA_VID_DEV_CAP_FORMAT;
    param->clock_rate = 90000;
    pjmedia_format_copy(&param->fmt, &BrokenOf(factory)->info.fmt[0]);
    return PJ_SUCCESS;
}

pj_status_t BrokenCreateStream(pjmedia_vid_dev_factory*, pjmedia_vid_dev_param*, const pjmedia_vid_dev_cb*, void*,
                               pjmedia_vid_dev_stream**) {
    return PJMEDIA_EVID_SYSERR;   // a câmera não abre
}

pj_status_t BrokenRefresh(pjmedia_vid_dev_factory*) { return PJ_SUCCESS; }

pjmedia_vid_dev_factory_op kBrokenOps = {&BrokenInit,         &BrokenDestroy,      &BrokenCount,  &BrokenInfo,
                                         &BrokenDefaultParam, &BrokenCreateStream, &BrokenRefresh};

pjmedia_vid_dev_factory* CreateBroken(pj_pool_factory* poolFactory) {
    pj_pool_t* pool = pj_pool_create(poolFactory, "teste-camera", 512, 512, nullptr);
    if (!pool) return nullptr;
    BrokenCamera* factory = PJ_POOL_ZALLOC_T(pool, BrokenCamera);
    factory->pool = pool;
    factory->base.op = &kBrokenOps;
    return &factory->base;
}

// A câmera das contas passa a ser a Quebrada (o vid_cap_dev do pjsua): o START_TRANSMIT das ligações feitas depois
// falha (o motor desta etapa não escolhe a câmera). Na thread do teste, que o motor já registrou no PJLIB (o
// SetAccount do Phone); a fábrica sai com o motor (o libDestroy desfaz todas).
void BreakCamera() {
    REQUIRE(pjmedia_vid_register_factory(&CreateBroken, nullptr) == PJ_SUCCESS);
    pjmedia_vid_dev_index broken = PJMEDIA_VID_INVALID_DEV;
    for (unsigned id = 0; id < pjmedia_vid_dev_count(); ++id) {
        pjmedia_vid_dev_info info;
        if (pjmedia_vid_dev_get_info(static_cast<pjmedia_vid_dev_index>(id), &info) == PJ_SUCCESS &&
            std::string(info.driver) == kBrokenCamera) {
            broken = static_cast<pjmedia_vid_dev_index>(id);
        }
    }
    REQUIRE(broken != PJMEDIA_VID_INVALID_DEV);
    pjsua_acc_id ids[8];
    unsigned count = PJ_ARRAY_SIZE(ids);
    REQUIRE(pjsua_enum_accs(ids, &count) == PJ_SUCCESS);
    REQUIRE(count > 0);
    for (unsigned index = 0; index < count; ++index) {
        pj_pool_t* pool = pjsua_pool_create("teste-conta", 1024, 1024);
        REQUIRE(pool != nullptr);
        pjsua_acc_config config;
        pj_status_t status = pjsua_acc_get_config(ids[index], pool, &config);
        if (status == PJ_SUCCESS) {
            config.vid_cap_dev = broken;
            status = pjsua_acc_modify(ids[index], &config);
        }
        pj_pool_release(pool);
        REQUIRE(status == PJ_SUCCESS);
    }
}

}  // namespace

TEST_CASE("the video build offers H264 and VP8") {
    Phone phone;
    INFO(phone.listener.LogTail());

    const std::vector<std::string> codecs = phone.engine->VideoCodecs();
    auto has = [&](const std::string& prefix) {
        return std::any_of(codecs.begin(), codecs.end(), [&](const std::string& id) { return id.rfind(prefix, 0) == 0; });
    };
    CHECK(has("H264/"));
    CHECK(has("VP8/"));
}

TEST_CASE("a voice call offers no video") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    const int id = phone.Dial("2003");
    CHECK(phone.registrar.WaitForLog("video-in 2003 nao", kWaitSeconds));
    CHECK(phone.engine->Video(id) == CallVideo());
    CHECK(phone.listener.Videos().empty());
}

TEST_CASE("a video call offers H264 and VP8 and sends the image after the answer") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    phone.listener.CountLog("video: H264 640x480 25 qps, envio ligado");
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(phone.registrar.WaitForLog("video-in 2003 H264,VP8", kWaitSeconds));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.WaitForVideoPackets(20, 5));
    CHECK(WaitVideo(phone, id, CameraOn));
    const CallVideo video = phone.engine->Video(id);
    CHECK(video.active);
    CHECK(video.camera);
    CHECK_FALSE(video.offered);
    CHECK(CameraOn(phone.listener.LastVideo(id)));
    CHECK(phone.listener.LogCount("video: H264 640x480 25 qps, envio ligado") >= 1);
}

TEST_CASE("the codec settings order and filter the offer") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    // Cada ligação acaba antes da próxima: o registro de ligações mostra a oferta de cada uma.
    auto offer = [&](const VideoSettings& settings) {
        phone.engine->SetVideoSettings(settings);
        const int id = phone.engine->MakeCall("2003", true);
        REQUIRE(id > 0);
        REQUIRE(phone.WaitState(id, CallState::Confirmed));
        REQUIRE(phone.engine->Hangup(id));
        REQUIRE(phone.WaitState(id, CallState::Disconnected));
    };

    VideoSettings settings = TestSettings();
    settings.first = VideoCodec::Vp8;
    settings.vp9 = true;
    offer(settings);
    CHECK(phone.registrar.WaitForLog("video-in 2003 VP8,H264,VP9", kWaitSeconds));

    settings = TestSettings();
    settings.h264 = false;
    offer(settings);
    CHECK(phone.WaitForLogCount("video-in 2003 VP8", 1));

    settings = TestSettings();
    settings.h264Available = false;   // o H.264 fica de fora sem o módulo, embora a PJSIP o registre
    offer(settings);
    CHECK(phone.WaitForLogCount("video-in 2003 VP8", 2));
}

TEST_CASE("the H264 offer carries profile-level-id 42e01f and packetization-mode 1") {
    Phone phone;
    INFO(phone.registrar.LogText());

    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.registrar.WaitForLog("video-in 2003 H264,VP8", kWaitSeconds));
    const std::string sdp = phone.registrar.VideoSdp();
    INFO(sdp);
    CHECK(Contains(sdp, "profile-level-id=42e01f"));
    CHECK(Contains(sdp, "packetization-mode=1"));
}

TEST_CASE("the camera stops and starts without a re-INVITE") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    const int id = VideoCall(phone, "2003");
    const size_t reinvites = LinesStartingWith(phone, "reinv-in");
    phone.listener.CountLog("video: H264 640x480 25 qps, envio desligado");

    REQUIRE(phone.engine->SetCamera(id, false));
    CHECK(PacketsStop(phone));
    CHECK_FALSE(phone.engine->Video(id).camera);
    CHECK(phone.engine->Video(id).active);
    CHECK(phone.listener.LogCount("video: H264 640x480 25 qps, envio desligado") >= 1);

    REQUIRE(phone.engine->SetCamera(id, true));
    CHECK(PacketsRise(phone));
    CHECK(WaitVideo(phone, id, CameraOn));
    CHECK(LinesStartingWith(phone, "reinv-in") == reinvites);
}

TEST_CASE("a camera that does not open logs camera: falhou once, at level 3") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    BreakCamera();
    phone.listener.CountLog("camera: falhou (");
    phone.registrar.ResetVideoPackets();
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(WaitUntil([&] { return phone.listener.LogCount("camera: falhou (") >= 1; }, kWaitSeconds));
    // Outra passada do envio, com a mesma vontade: a câmera falha de novo, sem outra linha.
    REQUIRE(phone.engine->SetCamera(id, true));
    CHECK(phone.registrar.VideoPacketsStay(1));
    const std::vector<int> levels = phone.listener.LogLevels("camera: falhou (");
    REQUIRE(levels.size() == 1);
    CHECK(levels[0] == 3);
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(phone.engine->Video(id).camera);
    CHECK(phone.engine->Video(id).active);
}

TEST_CASE("the camera on a voice call asks for video with a re-INVITE") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2003");
    REQUIRE(phone.engine->SetCamera(id, true));
    CHECK(phone.registrar.WaitForLog("video-reinv 2003 H264,VP8", kWaitSeconds));
    CHECK(PacketsRise(phone, 20));
    CHECK(WaitVideo(phone, id, CameraOn));
    CHECK(CameraOn(phone.engine->Video(id)));
}

TEST_CASE("the other side refusing the video keeps the voice") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CallsText());

    REQUIRE(phone.registrar.Control("VIDEO REJECT on") == Lines{"OK"});
    phone.registrar.ResetVideoPackets();
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    CHECK_FALSE(RefusedEvent(phone, id).active);
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(phone.engine->Video(id).active);
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.listener.RefusedCount(id) == 1);
}

TEST_CASE("the camera re-INVITE refused keeps the voice") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    REQUIRE(phone.registrar.Control("VIDEO REJECT on") == Lines{"OK"});
    phone.registrar.ResetVideoPackets();
    const int id = phone.Dial("2003");
    REQUIRE(phone.engine->SetCamera(id, true));
    CHECK(phone.registrar.WaitForLog("video-reinv 2003 H264,VP8", kWaitSeconds));
    CHECK(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("a 488 to the camera re-INVITE reports refused and the next offers carry no video") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    const int id = phone.Dial("2003");
    REQUIRE(phone.registrar.Control("VIDEO 488 on") == Lines{"OK"});
    REQUIRE(phone.engine->SetCamera(id, true));
    CHECK(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    CHECK_FALSE(phone.engine->Video(id).active);
    // A voz segue, e a espera e a retomada de depois não pedem o vídeo de novo.
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendrecv", kWaitSeconds));
    CHECK(phone.LogCount("video-reinv 2003 nao") == 2);
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("a 488 to a video call ends it with the code 488") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.CallsText());

    REQUIRE(phone.registrar.Control("VIDEO 488 on") == Lines{"OK"});
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, id, CallState::Disconnected).code == 488);
    phone.Dial("2003");   // a mesma ligação, só com a voz, passa
}

TEST_CASE("a video call without any available codec is a voice call that reports refused") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    VideoSettings settings = TestSettings();
    settings.vp8 = false;
    settings.h264Available = false;
    phone.engine->SetVideoSettings(settings);
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(phone.registrar.WaitForLog("video-in 2003 nao", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.listener.RefusedCount(id) == 1);
}

TEST_CASE("the refusal of a video call without any codec comes after the call's first state") {
    Phone phone;
    INFO(phone.listener.VideosText());

    VideoSettings settings = TestSettings();
    settings.vp8 = false;
    settings.h264Available = false;
    phone.engine->SetVideoSettings(settings);
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    const std::vector<std::string> timeline = phone.listener.Timeline(id);
    INFO(phone.listener.TimelineText(id));
    REQUIRE_FALSE(timeline.empty());
    CHECK(timeline.front().rfind("state(", 0) == 0);
    const auto refused = std::find_if(timeline.begin(), timeline.end(),
                                      [](const std::string& event) { return IsVideoEvent(event, "refused"); });
    REQUIRE(refused != timeline.end());
    CHECK(refused != timeline.begin());
}

TEST_CASE("an incoming video call answered without the camera sends no image") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    phone.registrar.ResetVideoPackets();
    const int id = phone.RingVideo("2003");
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.offered; }));
    REQUIRE(phone.engine->Answer(id, false));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.active && !video.camera; }));
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=sim", kWaitSeconds));
}

TEST_CASE("an incoming video call answered with the camera sends the image") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    const int id = phone.RingVideo("2003");
    REQUIRE(phone.engine->Answer(id, true));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.WaitForVideoPackets(20, 5));
    CHECK(WaitVideo(phone, id, CameraOn));
}

TEST_CASE("an incoming H264-only offer without H264 reports refused") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    VideoSettings settings = TestSettings();
    settings.h264Available = false;
    phone.engine->SetVideoSettings(settings);
    phone.registrar.ResetVideoPackets();
    const int id = phone.RingVideo("2003", "H264");
    REQUIRE(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    CHECK_FALSE(phone.listener.LastVideo(id).offered);
    REQUIRE(phone.engine->Answer(id, true));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=nao", kWaitSeconds));
    CHECK_FALSE(phone.engine->Video(id).active);
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK(phone.listener.RefusedCount(id) == 1);
}

TEST_CASE("an incoming H264 that PJSIP cannot answer reports refused once") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    phone.registrar.ResetVideoPackets();
    // O nome do codec é um dos nossos (o offered), mas o H.264 do perfil High não casa com o nosso na PJSIP.
    const int id = phone.RingVideo("2003", "H264HIGH");
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.offered; }));
    REQUIRE(phone.engine->Answer(id, true));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=nao", kWaitSeconds));
    REQUIRE(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    const CallVideo refused = RefusedEvent(phone, id);
    CHECK_FALSE(refused.early);
    CHECK_FALSE(refused.active);
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(phone.engine->Video(id).active);
    CHECK(phone.listener.RefusedCount(id) == 1);
}

TEST_CASE("a doorphone whose H264 PJSIP cannot answer reports refused once and leaves the early state") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    VideoSettings settings = TestSettings();
    settings.doorphones = {"9001"};
    phone.engine->SetVideoSettings(settings);
    phone.listener.CountLog("The call setting changes is ignored");
    phone.registrar.ResetVideoPackets();
    const int id = phone.RingVideo("9001", "H264HIGH");
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 183 video=nao", kWaitSeconds));
    REQUIRE(WaitUntil([&] { return phone.listener.RefusedCount(id) == 1; }, kWaitSeconds));
    CHECK_FALSE(RefusedEvent(phone, id).early);
    CHECK_FALSE(phone.engine->Video(id).early);
    REQUIRE(phone.engine->Answer(id, true));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK(phone.listener.RefusedCount(id) == 1);
    // O 200 leva o mesmo número de vídeos do 183: o pjsua guarda o primeiro e reclama de um diferente.
    CHECK(phone.listener.LogCount("The call setting changes is ignored") == 0);
}

TEST_CASE("a doorphone in the list gets a 183 with SDP and nothing goes out before the answer") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    VideoSettings settings = TestSettings();
    settings.doorphones = {"9001"};
    phone.engine->SetVideoSettings(settings);
    phone.registrar.ResetVideoPackets();
    const int id = phone.RingVideo("9001");
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 183 video=sim", kWaitSeconds));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.early && video.offered; }));
    // Por 2 s: nenhum pacote de vídeo e o microfone fora da ligação.
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (std::chrono::steady_clock::now() < deadline) {
        REQUIRE(phone.registrar.VideoPackets() == 0);
        REQUIRE(phone.engine->AudioLinks(id).empty());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    CHECK_FALSE(phone.engine->Video(id).camera);
    REQUIRE(phone.engine->Answer(id, false));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.early && video.active; }));
    CHECK_FALSE(phone.engine->Video(id).early);
    CHECK(phone.WaitLinks(id, {0}));
}

TEST_CASE("a number outside the list rings without early media") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    VideoSettings settings = TestSettings();
    settings.doorphones = {"9001"};
    phone.engine->SetVideoSettings(settings);
    const int id = phone.RingVideo("9002");
    // O inv-out do registro só leva o código final: o 183 apareceria como sdp-out.
    std::this_thread::sleep_for(std::chrono::seconds(2));
    CHECK(LinesStartingWith(phone, "sdp-out 2001 183") == 0);
    const CallVideo video = phone.listener.LastVideo(id);
    CHECK(video.offered);
    CHECK_FALSE(video.early);
}

TEST_CASE("hold pauses the image and unhold brings it back") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    const int id = VideoCall(phone, "2003");
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.camera && !video.active; }));
    CHECK(PacketsStop(phone));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(WaitVideo(phone, id, CameraOn));
    CHECK(PacketsRise(phone));
    // A espera e a retomada mantêm o vídeo da ligação na oferta.
    CHECK(phone.LogCount("video-reinv 2003 H264,VP8") == 2);
}

TEST_CASE("a second call pauses the first call's image") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CallsText());

    const int first = VideoCall(phone, "2003");
    // Com a segunda tocando, a primeira continua mandando.
    const int second = phone.Ring();
    CHECK(PacketsRise(phone));
    CHECK(CameraOn(phone.engine->Video(first)));
    // A segunda atendida: a primeira vai para a espera, sem imagem.
    REQUIRE(phone.engine->Answer(second));
    CHECK(WaitVideo(phone, first, [](const CallVideo& video) { return !video.camera; }));
    CHECK(PacketsStop(phone));
    REQUIRE(phone.engine->Hangup(second));
    REQUIRE(phone.WaitState(second, CallState::Disconnected));
    REQUIRE(phone.engine->SetHold(first, false));
    CHECK(PacketsRise(phone));
    CHECK(WaitVideo(phone, first, CameraOn));
}

TEST_CASE("the conference has no image") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    const int first = VideoCall(phone, "2002");
    const int second = VideoCall(phone, "2003");   // a primeira vai para a espera
    REQUIRE(phone.engine->Join(first, second));
    for (const int id : {first, second}) {
        CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.active && !video.camera; }));
    }
    CHECK(PacketsStop(phone));
}

TEST_CASE("a pending transfer pauses the image") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    REQUIRE(phone.registrar.Control("REFER_NOTIFY none") == Lines{"OK"});
    const int id = VideoCall(phone, "2003");
    REQUIRE(phone.engine->Transfer(id, "2004"));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.camera && !video.active; }));
    CHECK(PacketsStop(phone));
}

TEST_CASE("a refused transfer gives the image back") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CallsText());

    REQUIRE(phone.registrar.Control("REFER_REPLY 403") == Lines{"OK"});
    const int id = VideoCall(phone, "2003");
    REQUIRE(phone.engine->Transfer(id, "2004"));
    REQUIRE(phone.WaitTransfer(id));
    CHECK(Transfers(phone.listener.Calls(), id) == std::vector<int>{403});
    CHECK(WaitVideo(phone, id, CameraOn));
    CHECK(PacketsRise(phone));
}

TEST_CASE("a successful transfer keeps the image paused until the call ends") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.CallsText());

    const int id = VideoCall(phone, "2003");
    REQUIRE(phone.engine->Transfer(id, "2004"));
    REQUIRE(phone.WaitState(id, CallState::Disconnected));
    CHECK(Transfers(phone.listener.Calls(), id) == std::vector<int>{200});
    const std::vector<std::string> timeline = phone.listener.Timeline(id);
    INFO(phone.listener.TimelineText(id));
    const auto transfer = std::find(timeline.begin(), timeline.end(), "transfer(200)");
    REQUIRE(transfer != timeline.end());
    CHECK(std::none_of(transfer, timeline.end(),
                       [](const std::string& event) { return IsVideoEvent(event, "active"); }));
}

TEST_CASE("SetCameraPaused stops the image and gives back the wish") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());

    const int id = VideoCall(phone, "2003");
    phone.engine->SetCameraPaused(true);
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.camera && video.active; }));
    CHECK(PacketsStop(phone));
    phone.engine->SetCameraPaused(false);
    CHECK(WaitVideo(phone, id, CameraOn));
    CHECK(PacketsRise(phone));

    // Uma ligação cujo desejo era a câmera desligada continua sem câmera.
    REQUIRE(phone.engine->SetCamera(id, false));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.camera; }));
    phone.engine->SetCameraPaused(true);
    phone.engine->SetCameraPaused(false);
    CHECK(PacketsStop(phone));
    CHECK_FALSE(phone.engine->Video(id).camera);
}

TEST_CASE("video calls refuse unknown ids") {
    Phone phone;

    CHECK(phone.engine->Video(999) == CallVideo());
    CHECK_FALSE(phone.engine->SetCamera(999, true));
    CHECK_FALSE(phone.engine->Answer(999, true));
}

#else

TEST_CASE("the PJSIP engine without video refuses the video requests and never reports video") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.CallsText());
    INFO(phone.listener.VideosText());

    phone_test::CheckNoVideo(phone);
}

#endif
