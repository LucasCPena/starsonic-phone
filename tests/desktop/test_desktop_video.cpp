// Testes das escolhas do video no nucleo do app de PC (Task 6 da etapa 1 do video): o cartao Video da area do
// administrador, a camera e a chave do H.264 da pessoa, a situacao do modulo H.264, os pedidos novos da ponte
// (setVideo, cameraTest, videoViews, videoWindow, h264Retry), o bloco video do estado e os avisos da camera. O Harness e
// os falsos ficam no desktop_fixture.h.
#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

#include "desktop_fixture.h"

using namespace starsonic;
using nlohmann::json;

namespace {

const char* const kAdminLogin = R"({"v":1,"cmd":"adminLogin","senha":"senha-de-teste"})";

std::string AdminSet(const std::string& fields) { return R"({"v":1,"cmd":"adminSet",)" + fields + "}"; }
std::string SetVideo(const std::string& fields) { return R"({"v":1,"cmd":"setVideo",)" + fields + "}"; }

// Os avisos da camera (UTF-8). Os escapes \x sao partidos onde a letra seguinte seria lida como digito hexadecimal.
const char kNoCamera[] = "Nenhuma c\xc3\xa2mera encontrada.";
const char kInUse[] = "A c\xc3\xa2mera est\xc3\xa1 sendo usada por outro programa.";
const char kDisconnected[] = "A c\xc3\xa2mera foi desconectada.";
const char kPrivacy[] =
    "O Windows bloqueou a c\xc3\xa2mera para este app. Libere em Configura\xc3\xa7\xc3\xb5" "es do Windows \xe2\x86\x92 "
    "Privacidade e seguran\xc3\xa7" "a \xe2\x86\x92 C\xc3\xa2mera.";

const VideoSettings& LastSettings(const Harness& h) {
    REQUIRE_FALSE(h.port.videoSettings.empty());
    return h.port.videoSettings.back();
}

// Abre a area do administrador (a abertura ja foi feita).
void OpenAdmin(Harness& h) {
    h.Send(kAdminLogin);
    REQUIRE(h.State()["admin"]["aberto"] == true);
}

// O texto em minusculas (para procurar sem olhar a caixa).
std::string Lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

// Alguma linha do diagnostico leva o texto (sem olhar a caixa)?
bool AnyLogHas(const Harness& h, const std::string& text) {
    const std::string wanted = Lower(text);
    for (const std::string& line : h.logs) {
        if (Lower(line).find(wanted) != std::string::npos) return true;
    }
    return false;
}

const char kPrivateCamera[] = "Webcam Particular Lucas 7";

json Strings(const std::vector<std::string>& items) { return json(items); }

}  // namespace

TEST_CASE("the video block starts with the defaults") {
    // Num build que baixa o modulo H.264 (o build de agora, sem o download, tem o teste dele mais abaixo).
    Harness h;
    h.AllowH264Download();
    h.Start();
    const json video = h.State()["video"];
    CHECK(video["ligado"] == true);
    CHECK(video["h264"] == json({{"cartao", true}, {"pessoa", true}, {"situacao", "baixando"}}));
    CHECK(video["janela"] == "normal");
    CHECK(video["cameras"] == json::array());
    CHECK(video["camera"] == "");
    CHECK(video["cameraDesconectada"] == false);
    CHECK(video["teste"] == false);
    CHECK(h.h264Ensures == 1);

    OpenAdmin(h);
    const json admin = h.State()["admin"];
    CHECK(admin["videoH264"] == true);
    CHECK(admin["videoVp8"] == true);
    CHECK(admin["videoVp9"] == false);
    CHECK(admin["videoPrimeiro"] == "h264");
    CHECK(admin["videoQualidade"] == "media");
    CHECK(admin["porteiros"] == json::array());
}

TEST_CASE("the closed admin area does not show the video card") {
    Harness h;
    h.Start();
    CHECK_FALSE(h.State()["admin"].contains("videoH264"));
    CHECK_FALSE(h.State()["admin"].contains("porteiros"));
}

TEST_CASE("the engine gets H264 only when installed") {
    Harness h;
    h.AllowH264Download();
    h.Start();
    VideoSettings first = LastSettings(h);
    CHECK(first.h264);
    CHECK(first.vp8);
    CHECK_FALSE(first.vp9);
    CHECK(first.first == VideoCodec::H264);
    CHECK(first.quality == VideoQuality::Medium);
    CHECK_FALSE(first.h264Available);
    CHECK(first.doorphones.empty());

    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(LastSettings(h).h264Available);
    CHECK(h.State()["video"]["h264"]["situacao"] == "instalado");

    h.app->SetH264State(H264State::Failed);
    h.Run();
    CHECK_FALSE(LastSettings(h).h264Available);
    CHECK(h.State()["video"]["h264"]["situacao"] == "falhou");
}

TEST_CASE("the person turning H264 off stops it, and on asks for the module") {
    Harness h;
    h.AllowH264Download();
    h.Start();
    h.app->SetH264State(H264State::Installed);
    h.Run();
    REQUIRE(LastSettings(h).h264Available);
    REQUIRE(h.h264Ensures == 1);

    h.Send(SetVideo(R"("h264":false)"));
    CHECK(h.State()["video"]["h264"] == json({{"cartao", true}, {"pessoa", false}, {"situacao", "desligado"}}));
    CHECK_FALSE(LastSettings(h).h264Available);
    CHECK(h.File("dados/config.json")["h264"] == false);
    CHECK(h.h264Ensures == 1);

    h.Send(SetVideo(R"("h264":true)"));
    CHECK(h.State()["video"]["h264"]["situacao"] == "baixando");
    CHECK(h.h264Ensures == 2);
    CHECK_FALSE(LastSettings(h).h264Available);
    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(LastSettings(h).h264Available);
    CHECK(h.File("dados/config.json")["h264"] == true);

    // Ligar o que ja esta ligado nao pede o modulo de novo.
    h.Send(SetVideo(R"("h264":true)"));
    CHECK(h.h264Ensures == 2);
    CHECK(h.State()["video"]["h264"]["situacao"] == "instalado");
}

TEST_CASE("a late H264 result with H264 off changes nothing") {
    Harness h;
    h.AllowH264Download();
    h.Start();
    h.Send(SetVideo(R"("h264":false)"));
    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");
    CHECK_FALSE(LastSettings(h).h264Available);
    h.app->SetH264State(H264State::Failed);
    h.Run();
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");

    // O mesmo com o H.264 desligado no cartao.
    h.Send(SetVideo(R"("h264":true)"));
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false)"));
    CHECK(h.State()["video"]["h264"] == json({{"cartao", false}, {"pessoa", true}, {"situacao", "desligado"}}));
    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");
    CHECK_FALSE(LastSettings(h).h264Available);
    CHECK_FALSE(LastSettings(h).h264);
}

TEST_CASE("the admin card turning H264 back on asks for the module") {
    Harness h;
    h.AllowH264Download();
    h.Start();
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false)"));
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");
    CHECK(h.State()["video"]["ligado"] == true);   // o VP8 segue ligado
    h.Send(AdminSet(R"("videoH264":true)"));
    CHECK(h.State()["video"]["h264"]["situacao"] == "baixando");
    CHECK(h.h264Ensures == 2);
}

TEST_CASE("without the h264Ensure hook the state stays downloading") {
    Harness h;
    h.videoHooks = false;
    h.AllowH264Download();
    h.Start();
    CHECK(h.State()["video"]["h264"]["situacao"] == "baixando");
    h.Send(R"({"v":1,"cmd":"h264Retry"})");   // nada a repetir, e nenhum gancho
    CHECK(h.State()["video"]["h264"]["situacao"] == "baixando");
}

TEST_CASE("the admin card turning every codec off turns video off") {
    Harness h;
    h.Start();
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false,"videoVp8":false,"videoVp9":false)"));
    CHECK(h.State()["video"]["ligado"] == false);
    const VideoSettings& settings = LastSettings(h);
    CHECK_FALSE(settings.h264);
    CHECK_FALSE(settings.vp8);
    CHECK_FALSE(settings.vp9);
    CHECK_FALSE(settings.h264Available);
    CHECK_FALSE(VideoEnabled(settings));
    // Ligar o VP9 volta o video, e o resto das escolhas do cartao vai ao motor.
    h.Send(AdminSet(R"("videoVp9":true,"videoPrimeiro":"vp9","videoQualidade":"alta")"));
    CHECK(h.State()["video"]["ligado"] == true);
    CHECK(LastSettings(h).vp9);
    CHECK(LastSettings(h).first == VideoCodec::Vp9);
    CHECK(LastSettings(h).quality == VideoQuality::High);
    h.Send(AdminSet(R"("videoPrimeiro":"vp8","videoQualidade":"baixa")"));
    CHECK(LastSettings(h).first == VideoCodec::Vp8);
    CHECK(LastSettings(h).quality == VideoQuality::Low);
    CHECK(h.State()["admin"]["videoPrimeiro"] == "vp8");
    CHECK(h.State()["admin"]["videoQualidade"] == "baixa");
}

TEST_CASE("an adminSet that changes no video choice does not tell the engine again") {
    Harness h;
    h.Start();
    OpenAdmin(h);
    const size_t before = h.port.videoSettings.size();
    h.Send(AdminSet(R"("blf":true)"));
    CHECK(h.port.videoSettings.size() == before);
}

TEST_CASE("an invalid first codec or quality is refused when the command is read") {
    CHECK_FALSE(ParseCommand(AdminSet(R"("videoPrimeiro":"av1")")));
    CHECK_FALSE(ParseCommand(AdminSet(R"("videoQualidade":"ultra")")));
    CHECK_FALSE(ParseCommand(AdminSet(R"("videoH264":"sim")")));
    CHECK_FALSE(ParseCommand(AdminSet(R"("porteiros":"9001")")));
    CHECK_FALSE(ParseCommand(AdminSet(R"("porteiros":[9001])")));
    const std::optional<Command> command = ParseCommand(AdminSet(R"("videoPrimeiro":"vp9","porteiros":["9001"])"));
    REQUIRE(command);
    CHECK(command->admin.videoFirst == VideoCodec::Vp9);
    REQUIRE(command->admin.doorphones);
    CHECK(command->admin.doorphones->size() == 1);
}

TEST_CASE("the doorphones are validated") {
    Harness h;
    h.Start();
    OpenAdmin(h);
    const size_t before = h.port.videoSettings.size();

    std::vector<std::string> many;
    for (int i = 0; i < 21; ++i) many.push_back(std::to_string(9000 + i));
    const std::vector<std::vector<std::string>> bad = {
        many, {"90a1"}, {"1234567890123456"}, {""}, {"9001", "9002", "9001"}};
    const std::vector<std::string> messages = {
        "No m\xc3\xa1ximo 20 porteiros.",
        "Cada porteiro s\xc3\xb3 pode ter d\xc3\xadgitos.",
        "Cada porteiro precisa ter de 1 a 15 d\xc3\xadgitos.",
        "Cada porteiro precisa ter de 1 a 15 d\xc3\xadgitos.",
        "Esse porteiro j\xc3\xa1 est\xc3\xa1 na lista."};
    for (size_t i = 0; i < bad.size(); ++i) {
        const size_t toasts = h.Toasts().size();
        h.Send(AdminSet(R"("porteiros":)" + Strings(bad[i]).dump()));
        INFO("caso " << i);
        REQUIRE(h.Toasts().size() == toasts + 1);
        CHECK(h.Toasts().back() == messages[i]);
        CHECK(h.State()["admin"]["porteiros"] == json::array());
        CHECK(h.port.videoSettings.size() == before);
    }
    CHECK_FALSE(h.files.files.count("dados/admin.json"));

    // 15 digitos e 20 itens cabem.
    h.Send(AdminSet(R"("porteiros":["123456789012345"])"));
    CHECK(h.State()["admin"]["porteiros"] == Strings({"123456789012345"}));
    std::vector<std::string> twenty(many.begin(), many.begin() + 20);
    h.Send(AdminSet(R"("porteiros":)" + Strings(twenty).dump()));
    CHECK(h.State()["admin"]["porteiros"] == Strings(twenty));

    h.Send(AdminSet(R"("porteiros":["9001","9002"])"));
    CHECK(h.State()["admin"]["porteiros"] == Strings({"9001", "9002"}));
    CHECK(LastSettings(h).doorphones == std::vector<std::string>({"9001", "9002"}));
    CHECK(IsDoorphone(LastSettings(h), "9002"));
}

TEST_CASE("choosing a camera saves it and tells the engine") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}, VideoDevice{"Camera B"}};
    h.Start();
    CHECK(h.State()["video"]["cameras"] == Strings({"Camera A", "Camera B"}));

    h.Send(SetVideo(R"("camera":"Camera B")"));
    CHECK(h.File("dados/config.json")["camera"] == "Camera B");
    REQUIRE_FALSE(h.port.captureNames.empty());
    CHECK(h.port.captureNames.back() == "Camera B");
    CHECK(h.State()["video"]["camera"] == "Camera B");
    CHECK(h.State()["video"]["cameraDesconectada"] == false);

    // Um nome fora da lista fica gravado e avisa; "" volta para a primeira.
    h.Send(SetVideo(R"("camera":"Camera C")"));
    CHECK(h.port.captureNames.back() == "Camera C");
    CHECK(h.State()["video"]["cameraDesconectada"] == true);
    CHECK(h.File("dados/config.json")["camera"] == "Camera C");
    h.Send(SetVideo(R"("camera":"")"));
    CHECK(h.port.captureNames.back() == "");
    CHECK(h.State()["video"]["cameraDesconectada"] == false);

    // O nome da camera nao vai ao diagnostico.
    for (const std::string& line : h.logs) CHECK(line.find("Camera") == std::string::npos);
}

TEST_CASE("the camera test starts and stops") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}};
    h.Start();
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    CHECK(h.port.Count("start") == 1);
    CHECK(h.State()["video"]["teste"] == true);
    h.Send(R"({"v":1,"cmd":"cameraTest","on":false})");
    CHECK(h.port.Count("stop") == 1);
    CHECK(h.State()["video"]["teste"] == false);

    h.port.cameraTestStarts = false;
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    CHECK(h.port.Count("start") == 2);
    CHECK(h.State()["video"]["teste"] == false);
}

TEST_CASE("the camera test needs the on field") {
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"cameraTest"})"));
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"cameraTest","on":"sim"})"));
}

TEST_CASE("camera problems become the right toasts") {
    Harness h;
    h.Start();
    h.posts.clear();
    h.app->OnCameraProblem(CameraProblem::NoCamera);
    h.Run();
    h.app->OnCameraProblem(CameraProblem::OpenFailed);
    h.Run();
    h.app->OnCameraProblem(CameraProblem::Disconnected);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>({kNoCamera, kInUse, kDisconnected}));

    h.posts.clear();
    h.cameraBlockedValue = true;
    h.app->OnCameraProblem(CameraProblem::OpenFailed);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>({kPrivacy}));
    CHECK(h.cameraBlockedCalls >= 1);
}

TEST_CASE("an OpenFailed without the cameraBlocked hook counts as not blocked") {
    Harness h;
    h.videoHooks = false;
    h.Make();
    h.Start();
    h.app->OnCameraProblem(CameraProblem::OpenFailed);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>({kInUse}));
}

TEST_CASE("a camera problem from the engine thread goes through the command queue") {
    Harness h;
    h.Start();
    h.posts.clear();
    h.app->OnCameraProblem(CameraProblem::NoCamera);
    CHECK(h.Toasts().empty());   // so poe na fila
    h.Run();
    CHECK(h.Toasts().size() == 1);
}

TEST_CASE("a camera that goes away or does not open stops the camera test") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}};
    h.Start();
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    REQUIRE(h.State()["video"]["teste"] == true);
    h.app->OnCameraProblem(CameraProblem::Disconnected);
    h.Run();
    CHECK(h.State()["video"]["teste"] == false);
}

TEST_CASE("videoViews goes to the hook with its page") {
    Harness h;
    h.Start();
    h.Send(R"({"v":1,"cmd":"videoViews","pagina":"aviso","vistas":["porteiro"]})");
    REQUIRE(h.viewCalls.size() == 1);
    CHECK(h.viewCalls[0].first == std::vector<std::string>({"porteiro"}));
    CHECK(h.viewCalls[0].second == true);

    // Uma vista que nao e da pagina e ignorada.
    h.Send(R"({"v":1,"cmd":"videoViews","pagina":"aviso","vistas":["remoto"]})");
    REQUIRE(h.viewCalls.size() == 2);
    CHECK(h.viewCalls[1].first.empty());
    CHECK(h.viewCalls[1].second == true);

    h.Send(R"({"v":1,"cmd":"videoViews","pagina":"principal","vistas":["remoto","porteiro","local","remoto"]})");
    REQUIRE(h.viewCalls.size() == 3);
    CHECK(h.viewCalls[2].first == std::vector<std::string>({"remoto", "local"}));
    CHECK(h.viewCalls[2].second == false);

    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"videoViews","pagina":"outra","vistas":[]})"));
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"videoViews","pagina":"aviso"})"));
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"videoViews","pagina":"aviso","vistas":[1]})"));
}

TEST_CASE("videoWindow validates the mode and the window goes back to normal at the end of the call") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"enorme"})");
    CHECK(h.windowModes.empty());
    CHECK(h.State()["video"]["janela"] == "normal");

    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"grande"})");
    CHECK(h.windowModes == std::vector<std::string>({"grande"}));
    CHECK(h.State()["video"]["janela"] == "grande");
    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"telaCheia"})");
    CHECK(h.State()["video"]["janela"] == "telaCheia");

    // Uma ligacao em andamento: a janela segue; o fim da ultima a devolve a normal.
    h.app->OnIncomingCall(4, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(4, CallState::Confirmed, 200);
    h.Run();
    h.windowModes.clear();
    CHECK(h.State()["video"]["janela"] == "telaCheia");
    h.app->OnCallState(4, CallState::Disconnected, 0);
    h.Run();
    CHECK(h.State()["video"]["janela"] == "normal");
    CHECK(h.windowModes == std::vector<std::string>({"normal"}));

    // Um pedido valido sempre chega ao gancho, tambem o normal sem ligacao.
    h.windowModes.clear();
    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"normal"})");
    CHECK(h.windowModes == std::vector<std::string>({"normal"}));
}

TEST_CASE("the window mode stays while a second call remains and ends with the last one") {
    Harness h;
    h.StartRegistered();
    h.app->OnIncomingCall(4, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(4, CallState::Confirmed, 200);
    h.Run();
    h.app->OnIncomingCall(5, "2003", "Beltrano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"grande"})");
    h.windowModes.clear();
    h.app->OnCallState(4, CallState::Disconnected, 0);
    h.Run();
    CHECK(h.State()["video"]["janela"] == "grande");   // a segunda ainda toca
    CHECK(h.windowModes.empty());
    h.app->OnCallState(5, CallState::Disconnected, 0);
    h.Run();
    CHECK(h.State()["video"]["janela"] == "normal");
    CHECK(h.windowModes == std::vector<std::string>({"normal"}));
}

TEST_CASE("h264Retry asks again only after a failure") {
    Harness h;
    h.AllowH264Download();
    h.Start();
    REQUIRE(h.h264Ensures == 1);
    h.Send(R"({"v":1,"cmd":"h264Retry"})");   // baixando: nada
    CHECK(h.h264Ensures == 1);
    h.app->SetH264State(H264State::Installed);
    h.Run();
    h.Send(R"({"v":1,"cmd":"h264Retry"})");   // instalado: nada
    CHECK(h.h264Ensures == 1);

    h.app->SetH264State(H264State::Failed);
    h.Run();
    CHECK(h.State()["video"]["h264"]["situacao"] == "falhou");
    h.Send(R"({"v":1,"cmd":"h264Retry"})");
    CHECK(h.h264Ensures == 2);
    CHECK(h.State()["video"]["h264"]["situacao"] == "baixando");
    h.Send(R"({"v":1,"cmd":"h264Retry"})");   // ja baixando de novo: nada
    CHECK(h.h264Ensures == 2);
}

TEST_CASE("without the download allowed, H.264 stays off and is never fetched") {
    // O build de agora: o DesktopConfig::h264Download desligado ate a etapa 2 (a chave, o aviso e a licenca da Cisco).
    Harness h;
    h.Start();
    const json video = h.State()["video"];
    CHECK(video["h264"] == json({{"cartao", true}, {"pessoa", true}, {"situacao", "desligado"}}));
    CHECK(video["ligado"] == true);   // o VP8 segue ligado
    CHECK(h.h264Ensures == 0);
    CHECK_FALSE(LastSettings(h).h264Available);

    // Nada pede o modulo: a pessoa e o cartao ligando de novo, o h264Retry e um resultado que chegasse assim mesmo.
    h.Send(SetVideo(R"("h264":false)"));
    h.Send(SetVideo(R"("h264":true)"));
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false)"));
    h.Send(AdminSet(R"("videoH264":true)"));
    h.Send(R"({"v":1,"cmd":"h264Retry"})");
    h.app->SetH264State(H264State::Failed);
    h.Run();
    h.Send(R"({"v":1,"cmd":"h264Retry"})");
    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(h.h264Ensures == 0);
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");
    REQUIRE_FALSE(h.port.videoSettings.empty());
    for (const VideoSettings& settings : h.port.videoSettings) CHECK_FALSE(settings.h264Available);
    h.Restart();
    CHECK(h.h264Ensures == 0);
    CHECK(h.State()["video"]["h264"]["situacao"] == "desligado");
}

TEST_CASE("the camera list refreshes with the device notice") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}};
    h.port.systemCameras = std::vector<VideoDevice>{VideoDevice{"Camera A"}, VideoDevice{"Camera B"}};
    h.Start();
    CHECK(h.State()["video"]["cameras"] == Strings({"Camera A"}));
    h.Send(SetVideo(R"("camera":"Camera B")"));
    CHECK(h.State()["video"]["cameraDesconectada"] == true);

    h.port.videoCalls.clear();
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.port.Count("refresh") == 1);
    CHECK(h.State()["video"]["cameras"] == Strings({"Camera A", "Camera B"}));
    CHECK(h.State()["video"]["cameraDesconectada"] == false);

    h.port.systemCameras = std::vector<VideoDevice>{VideoDevice{"Camera A"}};
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.State()["video"]["cameras"] == Strings({"Camera A"}));
    CHECK(h.State()["video"]["cameraDesconectada"] == true);
}

TEST_CASE("the choices survive a restart") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}, VideoDevice{"Camera B"}};
    h.Start();
    h.Send(SetVideo(R"("camera":"Camera B","h264":false)"));
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoVp9":true,"videoPrimeiro":"vp8","videoQualidade":"alta","porteiros":["9001"])"));

    h.port.captureNames.clear();
    h.port.videoSettings.clear();
    h.Restart();
    const json video = h.State()["video"];
    CHECK(video["camera"] == "Camera B");
    CHECK(video["h264"] == json({{"cartao", true}, {"pessoa", false}, {"situacao", "desligado"}}));
    REQUIRE_FALSE(h.port.captureNames.empty());
    CHECK(h.port.captureNames.back() == "Camera B");
    const VideoSettings& settings = LastSettings(h);
    CHECK(settings.vp9);
    CHECK(settings.first == VideoCodec::Vp8);
    CHECK(settings.quality == VideoQuality::High);
    CHECK(settings.doorphones == std::vector<std::string>({"9001"}));
    CHECK_FALSE(settings.h264Available);

    OpenAdmin(h);
    const json admin = h.State()["admin"];
    CHECK(admin["videoVp9"] == true);
    CHECK(admin["videoPrimeiro"] == "vp8");
    CHECK(admin["videoQualidade"] == "alta");
    CHECK(admin["porteiros"] == Strings({"9001"}));
}

TEST_CASE("a config without the video keys takes the defaults") {
    Harness h;
    h.files.files["dados/config.json"] = R"({"versao":1,"nao_perturbe":false})";
    h.Start();
    CHECK(h.State()["video"]["camera"] == "");
    CHECK(h.State()["video"]["h264"]["pessoa"] == true);
}

TEST_CASE("the admin file keeps the video choices and an invalid saved value takes the default") {
    MemoryFileSystem files;
    HexCipher cipher;
    Profile profile;
    AdminStore store(files, cipher, "dados/admin.json", profile);
    REQUIRE(store.Load());
    CHECK(store.Get().videoH264);
    CHECK(store.Get().videoVp8);
    CHECK_FALSE(store.Get().videoVp9);
    CHECK(store.Get().videoFirst == VideoCodec::H264);
    CHECK(store.Get().videoQuality == VideoQuality::Medium);
    CHECK(store.Get().doorphones.empty());

    AdminConfig config = store.Get();
    config.videoH264 = false;
    config.videoVp9 = true;
    config.videoFirst = VideoCodec::Vp9;
    config.videoQuality = VideoQuality::Low;
    config.doorphones = {"9001", "9002"};
    REQUIRE(store.Save(config));
    AdminStore again(files, cipher, "dados/admin.json", profile);
    REQUIRE(again.Load());
    CHECK_FALSE(again.Get().videoH264);
    CHECK(again.Get().videoVp9);
    CHECK(again.Get().videoFirst == VideoCodec::Vp9);
    CHECK(again.Get().videoQuality == VideoQuality::Low);
    CHECK(again.Get().doorphones == std::vector<std::string>({"9001", "9002"}));

    // Um arquivo gravado com valores que nao servem: o codigo e a qualidade voltam ao padrao, e a lista fica so com os
    // itens bons (sem repetidos, ate 20), como os servidores.
    json root = {{"versao", 1},
                 {"videoH264", "sim"},
                 {"videoVp9", true},
                 {"videoPrimeiro", "av1"},
                 {"videoQualidade", 3},
                 {"porteiros", json::array({"9001", "90a1", "", "1234567890123456", "9001", 7, "9003"})}};
    REQUIRE(files.WriteAtomic("dados/admin2.json", *cipher.Protect(root.dump()) + "\n"));
    AdminStore odd(files, cipher, "dados/admin2.json", profile);
    REQUIRE(odd.Load());
    CHECK(odd.Get().videoH264);   // nao e booleano: o padrao
    CHECK(odd.Get().videoVp9);
    CHECK(odd.Get().videoFirst == VideoCodec::H264);
    CHECK(odd.Get().videoQuality == VideoQuality::Medium);
    CHECK(odd.Get().doorphones == std::vector<std::string>({"9001", "9003"}));
}

TEST_CASE("the iPhone platform has no video") {
    // Nem com o download do H.264 liberado.
    Harness h(Platform::IPhone);
    h.AllowH264Download();
    h.Start();
    CHECK(h.State()["video"]["ligado"] == false);
    CHECK(h.State()["video"]["cameras"] == json::array());
    CHECK(h.h264Ensures == 0);
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    h.Send(SetVideo(R"("camera":"Camera A","h264":false)"));
    h.Send(R"({"v":1,"cmd":"h264Retry"})");
    h.Send(R"({"v":1,"cmd":"videoViews","pagina":"aviso","vistas":["porteiro"]})");
    h.Send(R"({"v":1,"cmd":"videoWindow","modo":"grande"})");
    CHECK(h.port.videoCalls.empty());
    CHECK(h.State()["video"]["ligado"] == false);
    CHECK(h.State()["video"]["teste"] == false);
    CHECK(h.State()["video"]["janela"] == "normal");
    CHECK(h.viewCalls.empty());
    CHECK(h.windowModes.empty());
    h.app->SetH264State(H264State::Installed);
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.port.videoCalls.empty());
    h.app->OnCameraProblem(CameraProblem::NoCamera);
    h.Run();
    CHECK(h.Toasts().empty());
}

TEST_CASE("the codec and quality keys map both ways, in one place") {
    CHECK(std::string(CodecKey(VideoCodec::H264)) == "h264");
    CHECK(std::string(CodecKey(VideoCodec::Vp8)) == "vp8");
    CHECK(std::string(CodecKey(VideoCodec::Vp9)) == "vp9");
    for (VideoCodec codec : {VideoCodec::H264, VideoCodec::Vp8, VideoCodec::Vp9}) {
        const std::optional<VideoCodec> back = ParseCodecKey(CodecKey(codec));
        REQUIRE(back);
        CHECK(*back == codec);
    }
    CHECK_FALSE(ParseCodecKey("av1"));
    CHECK_FALSE(ParseCodecKey(""));
    CHECK_FALSE(ParseCodecKey("H264"));   // as chaves sao minusculas

    CHECK(std::string(QualityKey(VideoQuality::Low)) == "baixa");
    CHECK(std::string(QualityKey(VideoQuality::Medium)) == "media");
    CHECK(std::string(QualityKey(VideoQuality::High)) == "alta");
    for (VideoQuality quality : {VideoQuality::Low, VideoQuality::Medium, VideoQuality::High}) {
        const std::optional<VideoQuality> back = ParseQualityKey(QualityKey(quality));
        REQUIRE(back);
        CHECK(*back == quality);
    }
    CHECK_FALSE(ParseQualityKey("ultra"));
    CHECK_FALSE(ParseQualityKey(""));
}

TEST_CASE("an over-long camera name or a too long list of views is refused like the chat fields") {
    std::string error;
    CHECK(ParseCommand(SetVideo(R"("camera":")" + std::string(200, 'a') + R"(")"), &error));
    CHECK_FALSE(ParseCommand(SetVideo(R"("camera":")" + std::string(201, 'a') + R"(")"), &error));
    CHECK(error == "setVideo: camera invalida");   // o motivo diz o comando e o campo, nunca o valor
    // Os caracteres contam como pontos de codigo, nao como bytes.
    std::string accented;
    for (int i = 0; i < 200; ++i) accented += "\xc3\xa9";
    CHECK(ParseCommand(SetVideo(R"("camera":")" + accented + R"(")")));
    CHECK_FALSE(ParseCommand(SetVideo(R"("camera":")" + accented + "x" + R"(")")));

    json views = json::array();
    for (int i = 0; i < 8; ++i) views.push_back("local");
    const std::string head = R"({"v":1,"cmd":"videoViews","pagina":"principal","vistas":)";
    CHECK(ParseCommand(head + views.dump() + "}"));
    views.push_back("local");
    CHECK_FALSE(ParseCommand(head + views.dump() + "}", &error));
    CHECK(error == "videoViews: vistas invalidas");
    CHECK(ParseCommand(head + R"(["remoto"])" + "}"));
    CHECK_FALSE(ParseCommand(head + "[\"" + std::string(33, 'x') + "\"]}", &error));
    CHECK(error == "videoViews: vistas invalidas");
    CHECK(error.find("xxx") == std::string::npos);
}

TEST_CASE("a camera test already running does not start again") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}};
    h.Start();
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    CHECK(h.port.Count("start") == 1);
    CHECK(h.State()["video"]["teste"] == true);
    h.Send(R"({"v":1,"cmd":"cameraTest","on":false})");
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    CHECK(h.port.Count("start") == 2);
}

TEST_CASE("a camera choice the disk refuses changes neither the engine nor the state") {
    Harness h;
    h.port.cameras = {VideoDevice{"Camera A"}, VideoDevice{"Camera B"}};
    h.Start();
    h.Send(SetVideo(R"("camera":"Camera A")"));
    const size_t captures = h.port.captureNames.size();
    h.files.failWrites = true;
    h.Send(SetVideo(R"("camera":"Camera B","h264":false)"));
    CHECK(h.port.captureNames.size() == captures);   // o motor so recebe o que ficou gravado
    CHECK(h.State()["video"]["camera"] == "Camera A");
    CHECK(h.State()["video"]["h264"]["pessoa"] == true);
    CHECK(h.Logged("config.json: as configuracoes nao foram gravadas"));
    h.files.failWrites = false;
    h.Send(SetVideo(R"("camera":"Camera B")"));
    CHECK(h.port.captureNames.back() == "Camera B");
}

TEST_CASE("no log line carries the camera name, whatever the case") {
    Harness h;
    h.port.cameras = {VideoDevice{kPrivateCamera}};
    h.port.systemCameras = std::vector<VideoDevice>{};
    h.Start();
    h.Send(SetVideo(std::string(R"("camera":")") + kPrivateCamera + R"(")"));
    h.Send(R"({"v":1,"cmd":"cameraTest","on":true})");
    h.Send(R"({"v":1,"cmd":"cameraTest","on":false})");
    h.app->OnCameraProblem(CameraProblem::OpenFailed);
    h.app->OnCameraProblem(CameraProblem::Disconnected);
    h.Run();
    h.app->RefreshAudioDevices();   // a camera some: cameraDesconectada
    h.Run();
    REQUIRE(h.State()["video"]["cameraDesconectada"] == true);
    h.Restart();
    CHECK_FALSE(h.logs.empty());
    CHECK_FALSE(AnyLogHas(h, kPrivateCamera));
    CHECK_FALSE(AnyLogHas(h, "WEBCAM PARTICULAR"));
    CHECK_FALSE(AnyLogHas(h, "lucas"));
    // O nome so aparece onde a interface o le: no estado.
    CHECK(h.State()["video"]["camera"] == kPrivateCamera);
}

// ---------------------------------------------------------------- Task 7: as ligacoes com video na ponte

namespace {

// Os avisos da recusa do video (UTF-8).
const char kOtherEndRefused[] = "A outra ponta n\xc3\xa3o aceitou o v\xc3\xad" "deo.";
const char kNeedsH264[] = "Este v\xc3\xad" "deo precisa do H.264, que ainda n\xc3\xa3o foi baixado.";

CallVideo Video(bool offered, bool active, bool remote, bool camera, bool early = false, bool refused = false) {
    CallVideo video;
    video.offered = offered;
    video.active = active;
    video.remote = remote;
    video.camera = camera;
    video.early = early;
    video.refused = refused;
    return video;
}

// Uma ligacao feita ao 2003 (id do motor falso: 10), ja atendida.
void DialAndConfirm(Harness& h, const std::string& extra = "") {
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003")" + extra + "}");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
}

// O aviso da recusa do video numa ligacao em andamento (o evento do motor, na thread dele).
std::vector<std::string> RefusedToasts(Harness& h) {
    h.posts.clear();
    h.app->OnCallVideo(10, Video(false, false, false, false, false, true));
    h.Run();
    return h.Toasts();
}

}  // namespace

TEST_CASE("dial and answer pass video only when video is on") {
    Harness h;
    h.StartRegistered();

    // Sem o "video", ou com false, a ligacao e so de voz; com true, e de video.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":false})");   // ja ha uma ligacao: o motor nao e chamado
    CHECK(h.engine.madeVideo == std::vector<bool>({false}));
    h.app->OnCallState(10, CallState::Disconnected, 0);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    CHECK(h.engine.madeVideo == std::vector<bool>({false, true}));
    h.app->OnCallState(11, CallState::Disconnected, 0);
    h.Run();

    // O contato leva o video tambem.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","contato":true,"video":true})");
    CHECK(h.engine.madeVideo == std::vector<bool>({false, true, true}));
    h.app->OnCallState(12, CallState::Disconnected, 0);
    h.Run();

    // O answer.
    h.app->OnIncomingCall(20, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer","video":true})");
    CHECK(h.engine.answers == std::vector<int>({20}));
    CHECK(h.engine.answersVideo == std::vector<bool>({true}));
    h.app->OnCallState(20, CallState::Disconnected, 0);
    h.Run();
    h.app->OnIncomingCall(21, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    CHECK(h.engine.answersVideo == std::vector<bool>({true, false}));
    h.app->OnCallState(21, CallState::Disconnected, 0);
    h.Run();

    // Com todos os codecs desligados no cartao (video.ligado false), o pedido de video vira voz.
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false,"videoVp8":false,"videoVp9":false)"));
    REQUIRE(h.State()["video"]["ligado"] == false);
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    CHECK(h.engine.made.back() == "2003");
    CHECK(h.engine.madeVideo.back() == false);
    h.app->OnCallState(h.engine.nextCallId - 1, CallState::Disconnected, 0);
    h.Run();
    h.app->OnIncomingCall(22, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer","video":true})");
    CHECK(h.engine.answersVideo.back() == false);
}

TEST_CASE("video on with only H264 and no module still asks for video") {
    // O ligado olha so as escolhas: com so o H.264 ligado e o modulo ainda baixando, o nucleo pede o video e o motor
    // responde com a recusa (o aviso do H.264, abaixo).
    Harness h;
    h.AllowH264Download();
    h.StartRegistered();
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoVp8":false,"videoVp9":false)"));
    REQUIRE(h.State()["video"]["ligado"] == true);
    REQUIRE(h.State()["video"]["h264"]["situacao"] == "baixando");
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    CHECK(h.engine.madeVideo == std::vector<bool>({true}));
}

TEST_CASE("the iPhone platform passes no video to dial and answer and refuses camera") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    CHECK(h.engine.madeVideo == std::vector<bool>({false}));
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"camera","on":true})");
    CHECK(h.engine.cameras.empty());
    CHECK(h.Logged("recusado no modo iPhone"));
    h.app->OnCallState(10, CallState::Disconnected, 0);
    h.Run();
    h.app->OnIncomingCall(20, "2002", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer","video":true})");
    CHECK(h.engine.answersVideo == std::vector<bool>({false}));
}

TEST_CASE("the camera request goes to the top call") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"camera","on":true})");   // sem ligacao: nada
    CHECK(h.engine.cameras.empty());
    DialAndConfirm(h);
    h.Send(R"({"v":1,"cmd":"camera","on":true})");
    h.Send(R"({"v":1,"cmd":"camera","on":false})");
    CHECK(h.engine.cameras == std::vector<std::pair<int, bool>>({{10, true}, {10, false}}));
}

TEST_CASE("the video fields of dial, answer and camera are read strictly") {
    const auto dial = ParseCommand(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    REQUIRE(dial);
    CHECK(dial->video == true);
    CHECK(ParseCommand(R"({"v":1,"cmd":"dial","numero":"2003"})")->video == false);
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"dial","numero":"2003","video":"sim"})"));
    CHECK(ParseCommand(R"({"v":1,"cmd":"answer","video":true})")->video == true);
    CHECK(ParseCommand(R"({"v":1,"cmd":"answer"})")->video == false);
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"answer","video":1})"));
    const auto camera = ParseCommand(R"({"v":1,"cmd":"camera","on":true})");
    REQUIRE(camera);
    CHECK(camera->kind == CommandKind::Camera);
    CHECK(camera->on == std::optional<bool>(true));
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"camera"})"));
    CHECK_FALSE(ParseCommand(R"({"v":1,"cmd":"camera","on":"sim"})"));
}

TEST_CASE("the refused video toast depends on the H264 situation") {
    Harness h;
    h.AllowH264Download();
    h.StartRegistered();
    DialAndConfirm(h, R"(,"video":true)");

    // Cartao e pessoa com o H.264 ligado, o modulo ainda baixando: o aviso do H.264.
    REQUIRE(h.State()["video"]["h264"]["situacao"] == "baixando");
    CHECK(RefusedToasts(h) == std::vector<std::string>({kNeedsH264}));
    // Falhou: o mesmo aviso.
    h.app->SetH264State(H264State::Failed);
    h.Run();
    CHECK(RefusedToasts(h) == std::vector<std::string>({kNeedsH264}));
    // Instalado: a outra ponta e que nao aceitou.
    h.app->SetH264State(H264State::Installed);
    h.Run();
    CHECK(RefusedToasts(h) == std::vector<std::string>({kOtherEndRefused}));
    // A pessoa desliga o H.264: a outra ponta.
    h.Send(SetVideo(R"("h264":false)"));
    CHECK(RefusedToasts(h) == std::vector<std::string>({kOtherEndRefused}));
    // Ligado de novo, sem o modulo instalado, volta o aviso do H.264.
    h.Send(SetVideo(R"("h264":true)"));
    h.app->SetH264State(H264State::Failed);
    h.Run();
    CHECK(RefusedToasts(h) == std::vector<std::string>({kNeedsH264}));
    // O cartao sem o H.264: a outra ponta.
    OpenAdmin(h);
    h.Send(AdminSet(R"("videoH264":false)"));
    CHECK(RefusedToasts(h) == std::vector<std::string>({kOtherEndRefused}));
}

TEST_CASE("a video event that is not a refusal shows no toast") {
    Harness h;
    h.StartRegistered();
    DialAndConfirm(h, R"(,"video":true)");
    h.posts.clear();
    h.app->OnCallVideo(10, Video(true, true, true, true));
    h.Run();
    CHECK(h.Toasts().empty());
}

TEST_CASE("a 488 to a video dial redials as voice and shows the refused toast") {
    Harness h;
    h.AllowH264Download();
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003","video":true})");
    h.posts.clear();
    h.app->OnCallState(10, CallState::Disconnected, 488);
    h.Run();
    CHECK(h.engine.made == std::vector<std::string>({"2003", "2003"}));
    CHECK(h.engine.madeVideo == std::vector<bool>({true, false}));
    CHECK(h.Toasts() == std::vector<std::string>({kNeedsH264}));
    CHECK(h.State()["ligacao"]["top"]["phase"] == "dialing");
}

TEST_CASE("the call state carries the video block") {
    Harness h;
    h.StartRegistered();
    DialAndConfirm(h, R"(,"video":true)");
    json top = h.State()["ligacao"]["top"];
    CHECK(top["video"] == json({{"oferece", false}, {"ativo", false}, {"imagem", false}, {"camera", false}, {"cedo", false}}));

    h.app->OnCallVideo(10, Video(true, true, false, true, false));
    h.Run();
    top = h.State()["ligacao"]["top"];
    CHECK(top["video"] == json({{"oferece", true}, {"ativo", true}, {"imagem", false}, {"camera", true}, {"cedo", false}}));

    // A segunda ligacao tambem leva o bloco.
    h.app->OnIncomingCall(20, "2002", "Fulano");
    h.app->OnCallVideo(20, Video(true, false, false, false, true));
    h.Run();
    const json second = h.State()["ligacao"]["second"];
    CHECK(second["video"] == json({{"oferece", true}, {"ativo", false}, {"imagem", false}, {"camera", false}, {"cedo", true}}));
}
