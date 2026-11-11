// Só o motor do PJSIP com o vídeo (o do Linux dos testes, como o do Windows): os codecs de vídeo, as ligações com
// vídeo (a oferta, o atender, a câmera e as recusas), as pausas (a espera, a segunda ligação, a conferência, a
// transferência e a tela bloqueada) e o 183 dos Porteiros, contra o registrador falso (a PORTA do vídeo conta os
// pacotes que a nossa câmera manda). E a imagem: o desenhista nosso (os quadros no FrameSink, com o id de cada
// ligação), a prévia e o teste da câmera, a escolha e a releitura das câmeras e os problemas da câmera. O motor é um
// só por processo: no lugar de uma segunda cópia dele, o VIDEO ECHO do registrador devolve a nossa imagem, que passa
// pelo codificador e pelo decodificador do mesmo motor. Com o PJSIP sem o vídeo (como o do Android), só o contrato do
// motor sem vídeo, o mesmo do motor do baresip (test_engine_baresip.cpp).
#include "call_fixture.h"

#include <pjsua-lib/pjsua.h>
#if PJMEDIA_HAS_VIDEO
#include <pjmedia-videodev/videodev_imp.h>
#include <pjmedia/event.h>

// A fábrica das câmeras de barras coloridas da PJSIP (PJMEDIA_VIDEO_DEV_HAS_CBAR_SRC, ligada no Linux dos testes).
// Nenhum cabeçalho da PJSIP a declara: ela só serve de chave para tirar a fábrica (pjmedia_vid_unregister_factory).
extern "C" pjmedia_vid_dev_factory* pjmedia_cbar_factory(pj_pool_factory* poolFactory);
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "SipEngine.h"
#include "Video.h"
#if PJMEDIA_HAS_VIDEO
#include "VideoRenderer.h"
#endif

using namespace starsonic;
using phone_test::Phone;

#if PJMEDIA_HAS_VIDEO
using phone_test::CallEvent;
using phone_test::Contains;
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::RecordingListener;
using phone_test::TestSink;
using phone_test::Transfers;
using phone_test::VideoEvent;
using phone_test::WaitUntil;
using phone_test::Transport;

namespace {

using Clock = std::chrono::steady_clock;
using Problems = std::vector<CameraProblem>;

// As escolhas dos testes: as de fábrica, com o H.264 disponível (o OpenH264 do sistema).
VideoSettings TestSettings() {
    VideoSettings settings;
    settings.h264Available = true;
    return settings;
}

// O motor dos testes sem as câmeras da PJSIP (como um computador sem câmera).
void NullVideo(EngineConfig& config) { config.nullVideo = true; }

bool CameraOn(const CallVideo& video) { return video.active && video.camera; }

// A ligação em pausa: sem o vídeo, sem a câmera e sem a imagem da outra ponta.
bool VideoPaused(const CallVideo& video) { return !video.active && !video.camera && !video.remote; }

bool WaitVideo(Phone& phone, int id, const std::function<bool(const CallVideo&)>& condition) {
    return phone.listener.WaitForVideo(id, condition, kWaitSeconds);
}

// Espera até milliseconds que o último OnCallVideo da ligação satisfaça condition.
bool WaitVideoMs(Phone& phone, int id, const std::function<bool(const CallVideo&)>& condition, int milliseconds) {
    const auto deadline = Clock::now() + std::chrono::milliseconds(milliseconds);
    while (!condition(phone.listener.LastVideo(id))) {
        if (Clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return true;
}

// Espera até kWaitSeconds que os OnCameraProblem sejam exatamente expected.
bool WaitProblems(Phone& phone, const Problems& expected) {
    return WaitUntil([&] { return phone.listener.CameraProblems() == expected; }, kWaitSeconds);
}

// O trecho do m=video de um SDP (do m=video ao fim), ou vazio.
std::string VideoSection(const std::string& sdp) {
    const size_t start = sdp.find("m=video");
    return start == std::string::npos ? std::string() : sdp.substr(start);
}

// Os nomes do VideoDevices, numa linha só.
std::string DeviceNames(const std::vector<VideoDevice>& devices) {
    std::string names;
    for (const VideoDevice& device : devices) names += device.name + "; ";
    return names;
}

// O id de agora do dispositivo com esse nome (e a direção) na lista de vídeo da PJSIP, ou PJMEDIA_VID_INVALID_DEV.
pjmedia_vid_dev_index FindDevice(const std::string& name, pjmedia_dir dir) {
    for (unsigned id = 0; id < pjmedia_vid_dev_count(); ++id) {
        pjmedia_vid_dev_info info;
        if (pjmedia_vid_dev_get_info(static_cast<pjmedia_vid_dev_index>(id), &info) == PJ_SUCCESS &&
            name == info.name && (info.dir & dir) != 0) {
            return static_cast<pjmedia_vid_dev_index>(id);
        }
    }
    return PJMEDIA_VID_INVALID_DEV;
}

// A câmera que a conta do motor (a única do pjsua) guarda para as próximas ligações. Numa thread que já chamou o motor
// (ele a registra no PJLIB).
pjmedia_vid_dev_index AccountCamera() {
    pjsua_acc_id ids[PJSUA_MAX_ACC];
    unsigned count = PJ_ARRAY_SIZE(ids);
    if (pjsua_enum_accs(ids, &count) != PJ_SUCCESS || count != 1) return PJMEDIA_VID_INVALID_DEV;
    pj_pool_t* pool = pjsua_pool_create("teste-conta", 1024, 1024);
    if (!pool) return PJMEDIA_VID_INVALID_DEV;
    pjsua_acc_config config;
    const pj_status_t status = pjsua_acc_get_config(ids[0], pool, &config);
    pj_pool_release(pool);
    return status == PJ_SUCCESS ? config.vid_cap_dev : PJMEDIA_VID_INVALID_DEV;
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

// A câmera escolhida passa a ser a Quebrada: o START_TRANSMIT das ligações e a prévia do teste da câmera falham. Na
// thread do teste, que o motor já registrou no PJLIB (o SetAccount do Phone); a fábrica sai com o motor (o libDestroy
// desfaz todas).
void BreakCamera(Phone& phone) {
    REQUIRE(pjmedia_vid_register_factory(&CreateBroken, nullptr) == PJ_SUCCESS);
    REQUIRE(FindDevice(kBrokenCamera, PJMEDIA_DIR_CAPTURE) != PJMEDIA_VID_INVALID_DEV);
    REQUIRE(phone.engine->SetCaptureDevice(kBrokenCamera));
}

// A câmera de teste: uma fábrica de vídeo da PJSIP ("Teste") com g_testCameras dispositivos de captura I420 passivos
// ("Camera de teste" e "Camera de teste 2", no máximo dois), de quadros cinza ou, com o g_testCameraNoise, cinza com um
// canto de ruído (a imagem que muda a cada quadro, como a de uma câmera de verdade: cada quadro vira alguns pacotes; as
// barras coloridas da PJSIP quase não mudam e viram um pacote pequeno por quadro). A releitura da lista
// (pjmedia_vid_dev_refresh) lê o g_testCameras de novo: com 0, a câmera some. Com o g_testCameraErrorAt maior que zero,
// o quadro desse número avisa um erro da captura (o PJMEDIA_EVENT_VID_DEV_ERROR), e nenhum quadro vem depois dele. Com
// o g_testCameraOpenFails, a câmera não abre mais (ocupada por outro programa, por exemplo); a aberta segue.
std::atomic<unsigned> g_testCameras{1};
std::atomic<int> g_testCameraErrorAt{0};
std::atomic<bool> g_testCameraNoise{false};
std::atomic<bool> g_testCameraOpenFails{false};

const char kTestCamera[] = "Camera de teste";
const char kTestCameraDriver[] = "Teste";
const unsigned kMaxTestCameras = 2;
// O canto de ruído tem um quarto da largura e da altura: uns quatro pacotes VP8 por quadro na qualidade média (com o
// ruído no quadro todo, passa de 70 pacotes por quadro, e 300 datagramas guardados viram só 4 quadros).
const unsigned kNoiseDivisor = 4;

// Os valores de fábrica da câmera de teste em cada teste, e de volta no fim dele.
struct TestCameraScope {
    explicit TestCameraScope(unsigned cameras = 1, int errorAt = 0, bool noise = false) {
        g_testCameras = cameras;
        g_testCameraErrorAt = errorAt;
        g_testCameraNoise = noise;
    }
    ~TestCameraScope() {
        g_testCameras = 1;
        g_testCameraErrorAt = 0;
        g_testCameraNoise = false;
        g_testCameraOpenFails = false;
    }
};

struct TestCamera {
    pjmedia_vid_dev_factory base;   // o primeiro campo, como na Quebrada
    pj_pool_t* pool;
    pj_pool_factory* poolFactory;
    unsigned count;                 // os dispositivos de agora (o g_testCameras da última leitura)
    pjmedia_vid_dev_info info[kMaxTestCameras];
};

struct TestCameraStream {
    pjmedia_vid_dev_stream base;   // o primeiro campo
    pj_pool_t* pool;
    pjmedia_vid_dev_param param;
    int frames;                     // os quadros pedidos até agora
    pj_uint64_t timestamp;
};

TestCamera* TestCameraOf(pjmedia_vid_dev_factory* factory) { return reinterpret_cast<TestCamera*>(factory); }
TestCameraStream* TestStreamOf(pjmedia_vid_dev_stream* stream) { return reinterpret_cast<TestCameraStream*>(stream); }

pj_status_t TestStreamGetParam(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_param* param) {
    *param = TestStreamOf(stream)->param;
    return PJ_SUCCESS;
}

pj_status_t TestStreamGetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, void* value) {
    if (cap != PJMEDIA_VID_DEV_CAP_FORMAT) return PJMEDIA_EVID_INVCAP;
    pjmedia_format_copy(static_cast<pjmedia_format*>(value), &TestStreamOf(stream)->param.fmt);
    return PJ_SUCCESS;
}

pj_status_t TestStreamSetCap(pjmedia_vid_dev_stream* stream, pjmedia_vid_dev_cap cap, const void* value) {
    const pjmedia_format* format = static_cast<const pjmedia_format*>(value);
    if (cap != PJMEDIA_VID_DEV_CAP_FORMAT) return PJMEDIA_EVID_INVCAP;
    if (format->id != PJMEDIA_FORMAT_I420) return PJMEDIA_EVID_BADFORMAT;
    pjmedia_format_copy(&TestStreamOf(stream)->param.fmt, format);
    return PJ_SUCCESS;
}

pj_status_t TestStreamStart(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

// Na thread do relógio do vídeo da pjsua (a câmera é passiva: a pjsua pede cada quadro).
pj_status_t TestStreamGetFrame(pjmedia_vid_dev_stream* stream, pjmedia_frame* frame) {
    TestCameraStream* camera = TestStreamOf(stream);
    const int number = ++camera->frames;
    const int errorAt = g_testCameraErrorAt.load();
    if (errorAt > 0 && number >= errorAt) {
        if (number == errorAt) {
            pjmedia_event event;
            pjmedia_event_init(&event, PJMEDIA_EVENT_VID_DEV_ERROR, nullptr, stream);
            event.data.vid_dev_err.dir = PJMEDIA_DIR_CAPTURE;
            event.data.vid_dev_err.id = camera->param.cap_id;
            event.data.vid_dev_err.status = PJMEDIA_EVID_SYSERR;
            pjmedia_event_publish(nullptr, stream, &event, PJMEDIA_EVENT_PUBLISH_POST_EVENT);
        }
        return PJMEDIA_EVID_SYSERR;   // a câmera parou
    }
    const pjmedia_video_format_detail& detail = camera->param.fmt.det.vid;
    const pj_size_t bytes = static_cast<pj_size_t>(detail.size.w) * detail.size.h * 3 / 2;
    if (frame->size < bytes) return PJ_ETOOSMALL;
    pj_uint8_t* pixels = static_cast<pj_uint8_t*>(frame->buf);
    std::memset(pixels, 0x80, bytes);
    if (g_testCameraNoise) {
        const unsigned width = detail.size.w;
        const unsigned blockWidth = width / kNoiseDivisor;
        const unsigned blockHeight = detail.size.h / kNoiseDivisor;
        pj_uint32_t seed = 2166136261u ^ static_cast<pj_uint32_t>(number);
        for (unsigned row = 0; row < blockHeight; ++row) {
            for (unsigned column = 0; column < blockWidth; ++column) {
                seed = seed * 1664525u + 1013904223u;
                pixels[row * width + column] = static_cast<pj_uint8_t>(seed >> 24);
            }
        }
    }
    frame->type = PJMEDIA_FRAME_TYPE_VIDEO;
    frame->size = bytes;
    frame->bit_info = 0;
    frame->timestamp.u64 = camera->timestamp;
    camera->timestamp += detail.fps.num ? 90000u * detail.fps.denum / detail.fps.num : 3600u;
    return PJ_SUCCESS;
}

pj_status_t TestStreamStop(pjmedia_vid_dev_stream*) { return PJ_SUCCESS; }

pj_status_t TestStreamDestroy(pjmedia_vid_dev_stream* stream) {
    pj_pool_release(TestStreamOf(stream)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

pjmedia_vid_dev_stream_op kTestStreamOps = {&TestStreamGetParam, &TestStreamGetCap,  &TestStreamSetCap,
                                            &TestStreamStart,    &TestStreamGetFrame, nullptr,
                                            &TestStreamStop,     &TestStreamDestroy};

unsigned TestCameraCount() { return std::min(g_testCameras.load(), kMaxTestCameras); }

pj_status_t TestCameraInit(pjmedia_vid_dev_factory* factory) {
    TestCamera* camera = TestCameraOf(factory);
    for (unsigned index = 0; index < kMaxTestCameras; ++index) {
        pjmedia_vid_dev_info& info = camera->info[index];
        pj_bzero(&info, sizeof(info));
        const std::string name = index == 0 ? kTestCamera : std::string(kTestCamera) + " " + std::to_string(index + 1);
        pj_ansi_strxcpy(info.name, name.c_str(), sizeof(info.name));
        pj_ansi_strxcpy(info.driver, kTestCameraDriver, sizeof(info.driver));
        info.dir = PJMEDIA_DIR_CAPTURE;
        info.caps = PJMEDIA_VID_DEV_CAP_FORMAT;
        info.fmt_cnt = 1;
        pjmedia_format_init_video(&info.fmt[0], PJMEDIA_FORMAT_I420, 640, 480, 25, 1);
    }
    camera->count = TestCameraCount();
    return PJ_SUCCESS;
}

pj_status_t TestCameraDestroy(pjmedia_vid_dev_factory* factory) {
    pj_pool_release(TestCameraOf(factory)->pool);   // a struct mora no pool
    return PJ_SUCCESS;
}

unsigned TestCameraDevCount(pjmedia_vid_dev_factory* factory) { return TestCameraOf(factory)->count; }

pj_status_t TestCameraInfo(pjmedia_vid_dev_factory* factory, unsigned index, pjmedia_vid_dev_info* info) {
    if (index >= TestCameraOf(factory)->count) return PJMEDIA_EVID_INVDEV;
    *info = TestCameraOf(factory)->info[index];
    return PJ_SUCCESS;
}

pj_status_t TestCameraDefaultParam(pj_pool_t*, pjmedia_vid_dev_factory* factory, unsigned index,
                                   pjmedia_vid_dev_param* param) {
    if (index >= TestCameraOf(factory)->count) return PJMEDIA_EVID_INVDEV;
    pj_bzero(param, sizeof(*param));
    param->dir = PJMEDIA_DIR_CAPTURE;
    param->cap_id = static_cast<pjmedia_vid_dev_index>(index);
    param->rend_id = PJMEDIA_VID_INVALID_DEV;
    param->flags = PJMEDIA_VID_DEV_CAP_FORMAT;
    param->clock_rate = 90000;
    pjmedia_format_copy(&param->fmt, &TestCameraOf(factory)->info[index].fmt[0]);
    return PJ_SUCCESS;
}

pj_status_t TestCameraCreateStream(pjmedia_vid_dev_factory* factory, pjmedia_vid_dev_param* param,
                                   const pjmedia_vid_dev_cb*, void*, pjmedia_vid_dev_stream** stream) {
    if (param->dir != PJMEDIA_DIR_CAPTURE || param->fmt.id != PJMEDIA_FORMAT_I420) return PJMEDIA_EVID_BADFORMAT;
    if (g_testCameraOpenFails) return PJMEDIA_EVID_SYSERR;   // a câmera não abre
    pj_pool_t* pool = pj_pool_create(TestCameraOf(factory)->poolFactory, "teste-camera-stream", 512, 512, nullptr);
    if (!pool) return PJ_ENOMEM;
    TestCameraStream* camera = PJ_POOL_ZALLOC_T(pool, TestCameraStream);
    camera->pool = pool;
    camera->param = *param;
    camera->base.op = &kTestStreamOps;
    *stream = &camera->base;
    return PJ_SUCCESS;
}

pj_status_t TestCameraRefresh(pjmedia_vid_dev_factory* factory) {
    TestCameraOf(factory)->count = TestCameraCount();
    return PJ_SUCCESS;
}

pjmedia_vid_dev_factory_op kTestCameraOps = {&TestCameraInit,         &TestCameraDestroy,      &TestCameraDevCount,
                                             &TestCameraInfo,         &TestCameraDefaultParam, &TestCameraCreateStream,
                                             &TestCameraRefresh};

pjmedia_vid_dev_factory* CreateTestCamera(pj_pool_factory* poolFactory) {
    pj_pool_t* pool = pj_pool_create(poolFactory, "teste-camera", 512, 512, nullptr);
    if (!pool) return nullptr;
    TestCamera* factory = PJ_POOL_ZALLOC_T(pool, TestCamera);
    factory->pool = pool;
    factory->poolFactory = poolFactory;
    factory->base.op = &kTestCameraOps;
    return &factory->base;
}

// Registra a câmera de teste na PJSIP (depois do desenhista, no fim da lista). Na thread do teste, como a Quebrada.
void RegisterTestCamera() {
    REQUIRE(pjmedia_vid_register_factory(&CreateTestCamera, nullptr) == PJ_SUCCESS);
    REQUIRE(FindDevice(kTestCamera, PJMEDIA_DIR_CAPTURE) != PJMEDIA_VID_INVALID_DEV);
}

// Tira da PJSIP a fábrica das câmeras de barras coloridas, que vem antes do desenhista na lista: na próxima releitura,
// os ids dos dispositivos de depois dela mudam.
void RemoveColorbar() {
    REQUIRE(FindDevice("Colorbar generator", PJMEDIA_DIR_CAPTURE) != PJMEDIA_VID_INVALID_DEV);
    REQUIRE(pjmedia_vid_unregister_factory(&pjmedia_cbar_factory, nullptr) == PJ_SUCCESS);
}

// O porteiro tocando como a segunda ligação (com o TestCameraScope do ruído e o sink já no motor): uma ligação com
// vídeo ao 2003, com o eco, e depois o 9001, um Porteiro, com o 183 e a imagem dele chegando. A PORTA guarda os
// datagramas da primeira (VP8, a câmera de teste com o canto de ruído), que o registrador manda de volta como a imagem
// do porteiro: a reprodução dura uns 2,5 s depois do 183, e o que confere a imagem dele vem logo. *first: o id da
// primeira ligação.
int DoorphoneRingsAsSecond(Phone& phone, const TestSink& sink, int* first) {
    VideoSettings settings = TestSettings();
    settings.h264 = false;
    settings.doorphones = {"9001"};
    phone.engine->SetVideoSettings(settings);
    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    phone.registrar.ResetVideoPackets();
    *first = phone.engine->MakeCall("2003", true);
    REQUIRE(*first > 0);
    REQUIRE(phone.registrar.WaitForVideoPackets(300, 10));
    REQUIRE(sink.WaitFor(*first, 10, 5));
    const int doorphone = phone.RingVideo("9001", "VP8", true);
    REQUIRE(phone.registrar.WaitForLog("sdp-out 2001 183 video=sim", kWaitSeconds));
    return doorphone;
}

// Um porteiro com a imagem chegando e sem a nossa câmera.
bool DoorphoneImage(const CallVideo& video) { return video.doorphone && video.active && video.remote && !video.camera; }

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

TEST_CASE("our video sends a keyframe every 3 seconds without a request") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    // Nenhuma linha no log por quadro-chave (o diagnóstico do app grava o nível 4: seria uma a cada 3 s). O pjsua
    // escreve "set video stream, op=<op>" a cada pjsua_call_set_vid_strm, e o motor não passa adiante a do
    // quadro-chave; a do STOP_TRANSMIT, quando a câmera desliga, passa: a contagem enxerga a linha.
    const std::string setVideoStream = "set video stream, op=";
    phone.listener.CountLog(setVideoStream);

    // Os quadros-chave que saem em 7 s numa ligação com vídeo ao 2003, com as escolhas dadas, depois dos do começo do
    // stream (o primeiro e mais 5, um por segundo: o PJMEDIA_VID_STREAM_START_KEYFRAME_CNT da PJSIP), que a contagem
    // também enxerga; nos 7 s, nenhuma linha "set video stream". O registrador falso nunca pede um quadro-chave (nem o
    // INFO, nem o RTCP): os que chegam são os do motor. *call: a ligação, de pé.
    const auto afterStartKeyframes = std::chrono::milliseconds(5500);
    auto measure = [&](const VideoSettings& settings, int* call) {
        phone.engine->SetVideoSettings(settings);
        phone.registrar.ResetVideoPackets();
        *call = VideoCall(phone, "2003");
        std::this_thread::sleep_for(afterStartKeyframes);
        CHECK(phone.registrar.VideoKeyframes() >= 5);
        phone.registrar.ResetVideoPackets();
        const size_t setVideoStreamLines = phone.listener.LogCount(setVideoStream);
        std::this_thread::sleep_for(std::chrono::seconds(7));
        CHECK(phone.registrar.VideoPackets() > 0);   // a imagem seguiu saindo
        CHECK(phone.listener.LogCount(setVideoStream) == setVideoStreamLines);
        return phone.registrar.VideoKeyframes();
    };

    VideoSettings h264 = TestSettings();
    h264.vp8 = false;
    int call = 0;
    const int h264Keyframes = measure(h264, &call);
    CHECK(h264Keyframes >= 2);
    REQUIRE(phone.engine->Hangup(call));
    REQUIRE(phone.WaitState(call, CallState::Disconnected));

    VideoSettings vp8 = TestSettings();
    vp8.h264 = false;
    const int vp8Keyframes = measure(vp8, &call);
    CHECK(vp8Keyframes >= 2);

    // Com a nossa câmera desligada, nada sai: nem a imagem, nem um quadro-chave.
    const size_t linesBeforeCameraOff = phone.listener.LogCount(setVideoStream);
    REQUIRE(phone.engine->SetCamera(call, false));
    CHECK(PacketsStop(phone));
    CHECK(phone.listener.LogCount(setVideoStream) > linesBeforeCameraOff);   // a do STOP_TRANSMIT
    phone.registrar.ResetVideoPackets();
    std::this_thread::sleep_for(std::chrono::seconds(7));
    const int cameraOffKeyframes = phone.registrar.VideoKeyframes();
    CHECK(cameraOffKeyframes == 0);
    CHECK(phone.registrar.VideoPackets() == 0);
}

TEST_CASE("a camera that does not open logs camera: falhou once, at level 3") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());

    BreakCamera(phone);
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
    // Com a segunda tocando, a primeira para de mandar e fica sem imagem: com duas ligações, nenhuma tem vídeo (spec da
    // videochamada, 4.2).
    const int ringing = phone.Ring();
    CHECK(WaitVideo(phone, first, VideoPaused));
    CHECK(PacketsStop(phone));
    // A segunda recusada: a primeira, sozinha e fora da espera, manda de novo.
    REQUIRE(phone.engine->Reject(ringing));
    REQUIRE(phone.WaitState(ringing, CallState::Disconnected));
    CHECK(WaitVideo(phone, first, CameraOn));
    CHECK(PacketsRise(phone));
    // A segunda atendida: a primeira vai para a espera, sem imagem; com a segunda desligada, a retomada a devolve.
    const int second = phone.Ring();
    CHECK(WaitVideo(phone, first, [](const CallVideo& video) { return !video.camera && !video.active; }));
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
    // A segunda, com vídeo, põe a primeira em espera (com duas ligações, nenhuma manda a câmera).
    const int second = phone.engine->MakeCall("2003", true);
    REQUIRE(second > 0);
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
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

// --- a imagem: as câmeras, a prévia, o desenhista e os problemas da câmera ---

TEST_CASE("the test camera shows up and our renderer does not") {
    Phone phone;

    const std::vector<VideoDevice> devices = phone.engine->VideoDevices();
    INFO(DeviceNames(devices));
    CHECK(std::any_of(devices.begin(), devices.end(),
                      [](const VideoDevice& device) { return device.name == "Colorbar generator"; }));
    CHECK(std::none_of(devices.begin(), devices.end(),
                       [](const VideoDevice& device) { return Contains(device.name, "Starsonic"); }));
}

TEST_CASE("nullVideo hides the cameras and the camera test reports NoCamera") {
    TestSink sink;
    Phone phone(Transport::Udp, nullptr, NullVideo);
    INFO(phone.listener.CameraProblemsText());
    phone.engine->SetFrameSink(&sink);

    CHECK(phone.engine->VideoDevices().empty());
    CHECK_FALSE(phone.engine->StartCameraTest());
    CHECK(WaitProblems(phone, {CameraProblem::NoCamera}));
    CHECK(sink.Frames().empty());
}

TEST_CASE("a video call without a camera still offers the video to receive it") {
    Phone phone(Transport::Udp, nullptr, NullVideo);
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CameraProblemsText());
    INFO(phone.listener.LogTail());

    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(WaitProblems(phone, {CameraProblem::NoCamera}));
    CHECK(phone.registrar.WaitForLog("video-in 2003 H264,VP8", kWaitSeconds));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.active && !video.camera; }));
    // A oferta só recebe: sem câmera, a PJSIP não monta o envio do vídeo (e a ligação não cai).
    CHECK(Contains(VideoSection(phone.registrar.VideoSdp()), "a=recvonly"));
    CHECK(phone.registrar.VideoPacketsStay(1));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("the video answer and the camera button without a camera report NoCamera and still receive the video") {
    Phone phone(Transport::Udp, nullptr, NullVideo);
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CameraProblemsText());

    const int incoming = phone.RingVideo("2003");
    REQUIRE(phone.engine->Answer(incoming, true));
    REQUIRE(phone.WaitState(incoming, CallState::Confirmed));
    CHECK(WaitProblems(phone, {CameraProblem::NoCamera}));
    CHECK(WaitVideo(phone, incoming, [](const CallVideo& video) { return video.active && !video.camera; }));
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=sim", kWaitSeconds));
    REQUIRE(phone.engine->Hangup(incoming));
    REQUIRE(phone.WaitState(incoming, CallState::Disconnected));

    // O botão Câmera numa ligação de voz pede o vídeo à outra ponta, só para receber.
    const int voice = phone.Dial("2003");
    CHECK(phone.engine->SetCamera(voice, true));
    CHECK(WaitProblems(phone, {CameraProblem::NoCamera, CameraProblem::NoCamera}));
    CHECK(phone.registrar.WaitForLog("video-reinv 2003 H264,VP8", kWaitSeconds));
    CHECK(WaitVideo(phone, voice, [](const CallVideo& video) { return video.active && !video.camera; }));
    CHECK(phone.registrar.VideoPackets() == 0);
    CHECK_FALSE(RecordingListener::StateReached(voice, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("the camera test delivers local frames and stops") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    phone.engine->SetFrameSink(&sink);

    REQUIRE(phone.engine->StartCameraTest());
    CHECK(sink.WaitFor(TestSink::kLocal, 5, 3));
    for (const TestSink::Frame& frame : sink.Frames()) {
        CHECK(frame.callId == TestSink::kLocal);
        CHECK(frame.width > 0);
        CHECK(frame.height > 0);
    }
    phone.engine->StopCameraTest();
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    const Clock::time_point stopped = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.CountAll(stopped) == 0);
    CHECK(phone.listener.CameraProblems().empty());
}

TEST_CASE("the locked screen pauses the camera test and the unlock brings it back") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.CameraProblemsText());
    phone.engine->SetFrameSink(&sink);

    REQUIRE(phone.engine->StartCameraTest());
    REQUIRE(sink.WaitFor(TestSink::kLocal, 5, 3));
    // A tela bloqueada fecha também a câmera do teste: depois de 500 ms (o que já estava a caminho), nenhum quadro.
    phone.engine->SetCameraPaused(true);
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    const Clock::time_point paused = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, paused) == 0);
    // O teste segue sendo o desejo da pessoa: o desbloqueio traz os quadros de volta, sem um pedido novo.
    phone.engine->SetCameraPaused(false);
    const size_t before = sink.Count(TestSink::kLocal);
    CHECK(sink.WaitFor(TestSink::kLocal, before + 5, 3));
    CHECK(phone.listener.CameraProblems().empty());
}

TEST_CASE("a missing chosen camera falls back to the first") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    phone.engine->SetFrameSink(&sink);

    CHECK(phone.engine->SetCaptureDevice("Nao existe"));
    REQUIRE(phone.engine->StartCameraTest());
    CHECK(sink.WaitFor(TestSink::kLocal, 5, 3));
    CHECK(phone.listener.CameraProblems().empty());
}

TEST_CASE("an echo video call shows its own image as the remote image") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(sink.WaitFor(id, 10, 5, 640, 480));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.remote; }));
    CHECK(phone.engine->Video(id).remote);
}

TEST_CASE("remote goes false 2 seconds after the image stops") {
    Phone phone;
    INFO(phone.listener.VideosText());

    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    const int id = VideoCall(phone, "2003");
    REQUIRE(WaitVideo(phone, id, [](const CallVideo& video) { return video.remote; }));
    REQUIRE(phone.engine->SetCamera(id, false));
    const Clock::time_point stopped = Clock::now();
    CHECK(WaitVideoMs(phone, id, [](const CallVideo& video) { return !video.remote; }, 3500));
    // Os 2 s contam do último quadro: o remote não cai na hora em que a imagem para.
    CHECK(Clock::now() - stopped >= std::chrono::milliseconds(1500));
    CHECK(phone.engine->Video(id).active);
}

TEST_CASE("VP8 alone and H264 alone both decode") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});

    // Cada ligação acaba antes da próxima.
    auto decodes = [&](const VideoSettings& settings, const std::string& codec) {
        phone.engine->SetVideoSettings(settings);
        phone.listener.CountLog("video: " + codec + " ");
        const int id = phone.engine->MakeCall("2003", true);
        REQUIRE(id > 0);
        CHECK(sink.WaitFor(id, 10, 5));
        CHECK(phone.listener.LogCount("video: " + codec + " ") >= 1);
        REQUIRE(phone.engine->Hangup(id));
        REQUIRE(phone.WaitState(id, CallState::Disconnected));
    };
    VideoSettings vp8 = TestSettings();
    vp8.h264 = false;
    decodes(vp8, "VP8");
    VideoSettings h264 = TestSettings();
    h264.vp8 = false;
    decodes(h264, "H264");
}

TEST_CASE("the low quality gives 320x240 frames") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    phone.engine->SetFrameSink(&sink);

    VideoSettings settings = TestSettings();
    settings.quality = VideoQuality::Low;
    phone.engine->SetVideoSettings(settings);
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(sink.WaitFor(id, 10, 5, 320, 240));
    CHECK(sink.WaitFor(TestSink::kLocal, 5, 5, 320, 240));
}

TEST_CASE("two video calls keep their frames apart and the paused one shows nothing") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    phone.engine->SetFrameSink(&sink);
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});

    const int first = VideoCall(phone, "2002");
    REQUIRE(sink.WaitFor(first, 10, 5));
    // A segunda põe a primeira em espera, e com duas ligações nenhuma manda nem mostra (spec da videochamada, 4.2).
    const int second = phone.engine->MakeCall("2003", true);
    REQUIRE(second > 0);
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    for (const int id : {first, second}) {
        CHECK(WaitVideo(phone, id, VideoPaused));
    }
    CHECK(PacketsStop(phone));
    const Clock::time_point paused = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.Count(first, 0, 0, paused) == 0);
    CHECK(sink.Count(second) == 0);
    CHECK_FALSE(phone.engine->Video(first).remote);
    CHECK_FALSE(phone.engine->Video(second).remote);

    // A primeira acaba: a segunda, sozinha e fora da espera, manda e mostra, com o id dela; a primeira, nada mais.
    REQUIRE(phone.engine->Hangup(first));
    REQUIRE(phone.WaitState(first, CallState::Disconnected));
    CHECK(WaitVideo(phone, second, CameraOn));
    CHECK(PacketsRise(phone));
    REQUIRE(sink.WaitFor(second, 10, 5));
    CHECK(sink.Count(first, 0, 0, paused) == 0);
    for (const TestSink::Frame& frame : sink.Frames()) {
        CHECK((frame.callId == first || frame.callId == second || frame.callId == TestSink::kLocal));
    }
}

TEST_CASE("no frame reaches the sink after SetFrameSink(nullptr)") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    phone.engine->SetFrameSink(&sink);
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});

    const int id = VideoCall(phone, "2003");
    REQUIRE(sink.WaitFor(id, 5, 5));
    phone.engine->SetFrameSink(nullptr);
    const Clock::time_point detached = Clock::now();   // o SetFrameSink voltou
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.CountAll(detached) == 0);
    // A imagem segue chegando ao motor: só o sink saiu.
    CHECK(phone.engine->Video(id).remote);
}

TEST_CASE("the renderer follows a size change") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    phone.engine->SetFrameSink(&sink);

    // Um stream do nosso dispositivo, pela pjmedia, como a pjsua cria o de cada janela.
    const pjmedia_vid_dev_index renderer = FindDevice("Starsonic", PJMEDIA_DIR_RENDER);
    REQUIRE(renderer != PJMEDIA_VID_INVALID_DEV);
    pjmedia_vid_dev_param param;
    REQUIRE(pjmedia_vid_dev_default_param(nullptr, renderer, &param) == PJ_SUCCESS);
    pjmedia_format_init_video(&param.fmt, PJMEDIA_FORMAT_I420, 640, 480, 25, 1);
    pjmedia_vid_dev_stream* stream = nullptr;
    REQUIRE(pjmedia_vid_dev_stream_create(&param, nullptr, nullptr, &stream) == PJ_SUCCESS);
    pjmedia_vid_dev_hwnd window;
    REQUIRE(pjmedia_vid_dev_stream_get_cap(stream, PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW, &window) == PJ_SUCCESS);
    REQUIRE(window.info.window != nullptr);
    BindRendererStream(window.info.window, 7);
    REQUIRE(pjmedia_vid_dev_stream_start(stream) == PJ_SUCCESS);

    std::vector<pj_uint8_t> large(640 * 480 * 3 / 2, 0x10);
    pjmedia_frame frame;
    pj_bzero(&frame, sizeof(frame));
    frame.type = PJMEDIA_FRAME_TYPE_VIDEO;
    frame.buf = large.data();
    frame.size = large.size();
    CHECK(pjmedia_vid_dev_stream_put_frame(stream, &frame) == PJ_SUCCESS);

    pjmedia_format small;
    pjmedia_format_init_video(&small, PJMEDIA_FORMAT_I420, 320, 240, 25, 1);
    CHECK(pjmedia_vid_dev_stream_set_cap(stream, PJMEDIA_VID_DEV_CAP_FORMAT, &small) == PJ_SUCCESS);
    std::vector<pj_uint8_t> little(320 * 240 * 3 / 2, 0x20);
    frame.buf = little.data();
    frame.size = little.size();
    CHECK(pjmedia_vid_dev_stream_put_frame(stream, &frame) == PJ_SUCCESS);
    // Um quadro do tamanho de antes, ainda a caminho, não é lido com o tamanho novo.
    frame.buf = large.data();
    frame.size = large.size();
    CHECK(pjmedia_vid_dev_stream_put_frame(stream, &frame) == PJ_SUCCESS);

    pjmedia_vid_dev_stream_stop(stream);
    pjmedia_vid_dev_stream_destroy(stream);
    const std::vector<TestSink::Frame> frames = sink.Frames();
    REQUIRE(frames.size() == 2);
    CHECK(frames[0].callId == 7);
    CHECK(frames[0].width == 640);
    CHECK(frames[0].height == 480);
    CHECK(frames[1].callId == 7);
    CHECK(frames[1].width == 320);
    CHECK(frames[1].height == 240);
}

TEST_CASE("a doorphone's image arrives before the answer and nothing goes out") {
    TestCameraScope cameras(1, 0, true);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    VideoSettings settings = TestSettings();
    settings.h264 = false;
    settings.doorphones = {"9001"};
    phone.engine->SetVideoSettings(settings);
    // Uma ligação com vídeo, sem o eco, com o canto de ruído da câmera de teste (com as barras coloridas, 300 pacotes
    // levam mais de 10 s): a PORTA guarda os primeiros datagramas da nossa câmera (VP8), que o registrador manda de
    // volta como a imagem do porteiro.
    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    phone.registrar.ResetVideoPackets();
    const int recorded = phone.engine->MakeCall("2003", true);
    REQUIRE(recorded > 0);
    REQUIRE(phone.registrar.WaitForVideoPackets(300, 10));
    REQUIRE(phone.engine->Hangup(recorded));
    REQUIRE(phone.WaitState(recorded, CallState::Disconnected));

    const int sent = phone.registrar.VideoPackets();
    const int id = phone.RingVideo("9001", "VP8", true);
    CHECK(sink.WaitFor(id, 5, 5));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.remote && video.early; }));
    const CallVideo early = phone.engine->Video(id);
    CHECK(early.remote);
    CHECK(early.early);
    // Antes do atender, nada sai daqui: nenhum pacote de vídeo e o microfone fora da ligação.
    CHECK(phone.registrar.VideoPacketsStay(2));
    CHECK(phone.registrar.VideoPackets() == sent);
    CHECK(phone.engine->AudioLinks(id).empty());

    REQUIRE(phone.engine->Answer(id, false));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return !video.early; }));
    CHECK_FALSE(phone.engine->Video(id).early);
}

TEST_CASE("a doorphone ringing as the second call shows its image and the first call keeps only voice") {
    TestCameraScope cameras(1, 0, true);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    phone.engine->SetFrameSink(&sink);

    // Com duas ligações o vídeo pausa (spec da videochamada, 4.2), menos a imagem do porteiro: ela passa do desenhista,
    // também com ele tocando como a segunda (a exceção do porteiro, decisão do responsável de 11/11/2026). A primeira
    // fica só com a voz, e nada é mandado, nem a ela nem ao porteiro.
    int first = 0;
    const int ringing = DoorphoneRingsAsSecond(phone, sink, &first);
    const Clock::time_point rang = Clock::now();
    CHECK(sink.WaitFor(ringing, 5, 5));
    CHECK(WaitVideo(phone, ringing,
                    [](const CallVideo& video) { return video.offered && video.early && DoorphoneImage(video); }));
    CHECK(WaitVideo(phone, first, VideoPaused));
    CHECK(PacketsStop(phone));
    CHECK(sink.Count(first, 0, 0, rang) == 0);
    CHECK_FALSE(phone.engine->Video(first).doorphone);
}

TEST_CASE("a doorphone answered with the first call on hold keeps its image and our camera stays off") {
    TestCameraScope cameras(1, 0, true);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    phone.engine->SetFrameSink(&sink);

    int first = 0;
    const int doorphone = DoorphoneRingsAsSecond(phone, sink, &first);
    REQUIRE(sink.WaitFor(doorphone, 5, 5));
    // Atendido, o porteiro fica com a imagem, e a primeira vai para a espera. O envio segue a regra das duas ligações:
    // a câmera não manda ao porteiro enquanto a outra existir, nem com o desejo dela ligado (o Atender com vídeo).
    REQUIRE(phone.engine->Answer(doorphone, true));
    REQUIRE(phone.WaitState(doorphone, CallState::Confirmed));
    const Clock::time_point answered = Clock::now();
    CHECK(WaitUntil([&] { return sink.Count(doorphone, 0, 0, answered) >= 5; }, 5));
    CHECK(WaitVideo(phone, doorphone, [](const CallVideo& video) { return !video.early && DoorphoneImage(video); }));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    CHECK(PacketsStop(phone));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, answered) == 0);   // a câmera nem abre
    CHECK_FALSE(phone.engine->Video(doorphone).camera);
    CHECK(VideoPaused(phone.engine->Video(first)));
}

TEST_CASE("a doorphone on hold pauses its image") {
    TestCameraScope cameras(1, 0, true);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    phone.engine->SetFrameSink(&sink);

    int first = 0;
    const int doorphone = DoorphoneRingsAsSecond(phone, sink, &first);
    REQUIRE(sink.WaitFor(doorphone, 5, 5));
    REQUIRE(phone.engine->Answer(doorphone, false));
    REQUIRE(phone.WaitState(doorphone, CallState::Confirmed));
    const Clock::time_point answered = Clock::now();
    REQUIRE(WaitUntil([&] { return sink.Count(doorphone, 0, 0, answered) >= 3; }, 5));
    // A espera pausa a imagem do porteiro como a de qualquer ligação: a exceção é só a da outra ligação.
    REQUIRE(phone.engine->SetHold(doorphone, true));
    CHECK(WaitVideo(phone, doorphone, VideoPaused));
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    const Clock::time_point held = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.Count(doorphone, 0, 0, held) == 0);
    CHECK(phone.engine->Video(doorphone).doorphone);
}

TEST_CASE("a doorphone in a conference pauses its image") {
    TestCameraScope cameras(1, 0, true);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    phone.engine->SetFrameSink(&sink);

    int first = 0;
    const int doorphone = DoorphoneRingsAsSecond(phone, sink, &first);
    REQUIRE(sink.WaitFor(doorphone, 5, 5));
    REQUIRE(phone.engine->Answer(doorphone, false));
    REQUIRE(phone.WaitState(doorphone, CallState::Confirmed));
    // Na conferência as duas ficam só com a voz, também o porteiro: a imagem dele ainda chega ao motor (a reprodução
    // segue), mas para no desenhista.
    REQUIRE(phone.engine->Join(first, doorphone));
    for (const int id : {first, doorphone}) CHECK(WaitVideo(phone, id, VideoPaused));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const Clock::time_point joined = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.Count(doorphone, 0, 0, joined) == 0);
}

TEST_CASE("a refresh finds our renderer and the camera again by name") {
    TestCameraScope cameras(2);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    // Antes: as barras coloridas, o desenhista e as duas câmeras de teste. Sem as barras, a releitura muda os ids
    // de todos (o desenhista e as câmeras de teste vêm depois delas na lista).
    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    const pjmedia_vid_dev_index rendererBefore = FindDevice("Starsonic", PJMEDIA_DIR_RENDER);
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    CHECK(FindDevice("Starsonic", PJMEDIA_DIR_RENDER) != rendererBefore);
    const std::vector<VideoDevice> devices = phone.engine->VideoDevices();
    INFO(DeviceNames(devices));
    REQUIRE(devices.size() == 2);
    CHECK(devices[0].name == kTestCamera);
    // As próximas ligações também: a conta fica com o id novo da câmera escolhida.
    CHECK(AccountCamera() == FindDevice(kTestCamera, PJMEDIA_DIR_CAPTURE));

    REQUIRE(phone.engine->StartCameraTest());
    CHECK(sink.WaitFor(TestSink::kLocal, 5, 3));
    phone.engine->StopCameraTest();

    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    CHECK(sink.WaitFor(id, 10, 5));
    CHECK(phone.listener.CameraProblems().empty());
}

TEST_CASE("a video call keeps its image through a hold and a resume after a refresh changes the ids") {
    TestCameraScope cameras(2);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    REQUIRE(phone.registrar.Control("VIDEO ECHO on") == Lines{"OK"});
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(sink.WaitFor(id, 5, 5));

    // Sem as barras, a releitura muda os ids: o id de antes do desenhista passa a ser o da segunda câmera de teste
    // (como uma câmera que entra antes dele na lista). A retomada monta a imagem que chega de novo, com o desenhista da
    // ligação.
    const pjmedia_vid_dev_index rendererBefore = FindDevice("Starsonic", PJMEDIA_DIR_RENDER);
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    REQUIRE(FindDevice(std::string(kTestCamera) + " 2", PJMEDIA_DIR_CAPTURE) == rendererBefore);
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendrecv", kWaitSeconds));
    const Clock::time_point resumed = Clock::now();
    CHECK(WaitUntil([&] { return sink.Count(id, 0, 0, resumed) >= 5; }, 5));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.active && video.remote && video.camera; }));
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.listener.CameraProblems().empty());
}

TEST_CASE("the camera in use that disappears on a refresh reports Disconnected and its image stops") {
    TestCameraScope cameras(1);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CameraProblemsText());
    phone.engine->SetFrameSink(&sink);

    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    const int id = VideoCall(phone, "2003");
    REQUIRE(sink.WaitFor(TestSink::kLocal, 5, 5));   // a sua imagem, enquanto a câmera manda

    g_testCameras = 0;   // a câmera saiu
    phone.engine->RefreshVideoDevices();
    CHECK(WaitProblems(phone, {CameraProblem::Disconnected}));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.active && !video.camera; }));
    CHECK(PacketsStop(phone));
    const Clock::time_point stopped = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, stopped) == 0);
    const std::vector<VideoDevice> devices = phone.engine->VideoDevices();
    INFO(DeviceNames(devices));
    CHECK(std::none_of(devices.begin(), devices.end(),
                       [](const VideoDevice& device) { return device.name == kTestCamera; }));
}

TEST_CASE("a capture error reports Disconnected and stops the camera test") {
    TestCameraScope cameras(1, 30);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.CameraProblemsText());
    phone.engine->SetFrameSink(&sink);

    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    REQUIRE(phone.engine->StartCameraTest());
    CHECK(sink.WaitFor(TestSink::kLocal, 5, 3));
    // O quadro 30 avisa o erro (o aviso vem duas vezes da PJSIP, da câmera e da porta dela): um Disconnected só.
    CHECK(WaitProblems(phone, {CameraProblem::Disconnected}));
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    const Clock::time_point stopped = Clock::now();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(sink.CountAll(stopped) == 0);
    CHECK(phone.listener.CameraProblems() == Problems{CameraProblem::Disconnected});
}

TEST_CASE("a camera that does not open reports OpenFailed, in the camera test and in a call") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.CameraProblemsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    BreakCamera(phone);
    phone.listener.CountLog("camera: falhou (");
    CHECK_FALSE(phone.engine->StartCameraTest());
    CHECK(WaitProblems(phone, {CameraProblem::OpenFailed}));
    CHECK(phone.listener.LogLevels("camera: falhou (") == std::vector<int>{3});

    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    CHECK(WaitProblems(phone, {CameraProblem::OpenFailed, CameraProblem::OpenFailed}));
    CHECK(phone.listener.LogLevels("camera: falhou (") == std::vector<int>{3, 3});
    CHECK_FALSE(phone.engine->Video(id).camera);
    CHECK(sink.Frames().empty());
}

TEST_CASE("a camera test whose camera does not open again after a refresh reports OpenFailed once and stops") {
    TestCameraScope cameras(1);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.CameraProblemsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    REQUIRE(phone.engine->StartCameraTest());
    REQUIRE(sink.WaitFor(TestSink::kLocal, 5, 3));

    // Sem as barras, a câmera do teste muda de lugar na lista: a releitura a fecha, e o SyncVideo a abre de novo com o
    // id novo, mas agora ela não abre.
    g_testCameraOpenFails = true;
    phone.listener.CountLog("camera: ");
    phone.listener.CountLog("camera: falhou (");
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    CHECK(WaitProblems(phone, {CameraProblem::OpenFailed}));
    CHECK(phone.listener.LogLevels("camera: falhou (") == std::vector<int>{3});
    // O teste da câmera parou: as próximas passadas do SyncVideo não tentam de novo, e nenhuma linha nova sai.
    for (int pass = 0; pass < 3; ++pass) {
        phone.engine->SetCameraPaused(false);   // uma passada do SyncVideo
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    CHECK(phone.listener.LogCount("camera: ") == 1);
    CHECK(phone.listener.CameraProblems() == Problems{CameraProblem::OpenFailed});
    const Clock::time_point stopped = Clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, stopped) == 0);
    // Desligado, o teste não volta sozinho: um pedido novo tenta abrir a câmera de novo (e ela não abre).
    CHECK_FALSE(phone.engine->StartCameraTest());
    CHECK(WaitProblems(phone, {CameraProblem::OpenFailed, CameraProblem::OpenFailed}));
}

TEST_CASE("a moved camera that does not open again for a call and the camera test reports OpenFailed once") {
    TestCameraScope cameras(1);
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.CameraProblemsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    RegisterTestCamera();
    REQUIRE(phone.engine->SetCaptureDevice(kTestCamera));
    const int id = VideoCall(phone, "2003");
    REQUIRE(phone.engine->StartCameraTest());   // a mesma câmera aberta, a do envio
    REQUIRE(sink.WaitFor(TestSink::kLocal, 5, 3));

    // A câmera muda de lugar e não abre mais: o START da ligação e a prévia do teste falham na mesma passada, e sai um
    // OpenFailed só. A ligação fica com camera=false, e o teste da câmera para.
    g_testCameraOpenFails = true;
    phone.listener.CountLog("camera: ");
    phone.listener.CountLog("camera: falhou (");
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    CHECK(WaitProblems(phone, {CameraProblem::OpenFailed}));
    CHECK(WaitVideo(phone, id, [](const CallVideo& video) { return video.active && !video.camera; }));
    for (int pass = 0; pass < 3; ++pass) {
        phone.engine->SetCameraPaused(false);   // uma passada do SyncVideo
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    CHECK(phone.listener.LogLevels("camera: falhou (") == std::vector<int>{3});
    CHECK(phone.listener.LogCount("camera: ") == 1);
    CHECK(phone.listener.CameraProblems() == Problems{CameraProblem::OpenFailed});
    CHECK(PacketsStop(phone));
    const Clock::time_point stopped = Clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, stopped) == 0);
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
