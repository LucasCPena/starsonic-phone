// A qualidade da sala de vídeo em grupo no motor do PJSIP, contra o registrador falso que faz de vários convidados
// (como no test_engine_room.cpp, de onde estes casos vieram: cada arquivo cabe nos 3 minutos dele). A qualidade da sala
// pelo número de convidados (o re-INVITE de quem já está nela), a escolhida que volta no fim dela, o re-INVITE que
// encontra outro em andamento e o quadro-chave de cada convidado. Com o PJSIP sem o vídeo (como o do Android), nada: o
// contrato do motor sem sala fica no test_engine_room.cpp.
#include "call_fixture.h"

#include <pjsua-lib/pjsua.h>

#include <algorithm>
#include <chrono>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "SipEngine.h"
#include "Video.h"

using namespace starsonic;
using phone_test::Phone;

#if PJMEDIA_HAS_VIDEO

using phone_test::kWaitSeconds;
using phone_test::Lines;
using phone_test::TestSink;
using phone_test::WaitUntil;

namespace {

using State = RoomMember::State;
using Clock = std::chrono::steady_clock;
using Yuv = TestSink::Yuv;

// As escolhas dos testes da sala: as de fábrica, com o H.264 disponível (o OpenH264 do sistema), na qualidade Baixa (a
// máquina dos testes tem 2 processadores).
VideoSettings RoomSettings() {
    VideoSettings settings;
    settings.h264Available = true;
    settings.quality = VideoQuality::Low;
    return settings;
}

// A videochamada de onde a sala nasce: o MakeCall com o vídeo, o Confirmed e o active.
int VideoCall(Phone& phone, const std::string& number) {
    const int id = phone.engine->MakeCall(number, true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(phone.listener.WaitForVideo(id, [](const CallVideo& video) { return video.active; }, kWaitSeconds));
    return id;
}

// O convidado callId está na sala, no estado state.
bool HasMember(const RoomInfo& room, int callId, State state) {
    return std::any_of(room.members.begin(), room.members.end(),
                       [&](const RoomMember& member) { return member.callId == callId && member.state == state; });
}

// Um convidado: o RoomAdd, o Confirmed e o OnRoom com ele na sala.
int Guest(Phone& phone, const std::string& number) {
    const int id = phone.engine->RoomAdd(number);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(phone.listener.WaitForRoom([id](const RoomInfo& room) { return HasMember(room, id, State::In); },
                                       kWaitSeconds));
    return id;
}

// Os convidados atendem sem o vídeo: a imagem deles não importa nestes testes.
void WithoutVideo(Phone& phone, const std::vector<std::string>& numbers) {
    for (const std::string& number : numbers) phone.registrar.VideoSource(number, "none");
}

// Quantas linhas do registro de ligações começam com prefix.
size_t LinesStartingWith(Phone& phone, const std::string& prefix) {
    const Lines log = phone.registrar.Log();
    return static_cast<size_t>(
        std::count_if(log.begin(), log.end(), [&](const std::string& line) { return line.rfind(prefix, 0) == 0; }));
}

// Nenhuma linha do registro de ligações começa com prefix.
bool NoLogLine(Phone& phone, const std::string& prefix) { return LinesStartingWith(phone, prefix) == 0; }

// As imagens dos convidados (o VIDEO SOURCE color do registrador): nenhuma é uma das barras da câmera de teste (as
// barras coloridas da PJSIP).
const Yuv kOrange{150, 44, 200};
const Yuv kPurple{60, 200, 180};
const Yuv kTeal{180, 100, 60};
// Cada espera de uma cor (e dos primeiros pacotes da imagem de um convidado) vai até kColorSeconds.
const int kColorSeconds = 8;

// A imagem que o registrador manda como o convidado number: uma cor só.
void ShowColor(Phone& phone, const std::string& number, const Yuv& color) {
    phone.registrar.VideoSource(number, "color " + std::to_string(color.y) + " " + std::to_string(color.u) + " " +
                                            std::to_string(color.v));
}

// A sala com vídeo dos testes: a videochamada ao 2002 e os convidados 2003, 2004..., cada um na sala. Os ids da ligação
// de onde a sala nasceu e dos convidados, na ordem de entrada.
std::vector<int> VideoRoom(Phone& phone, int guests) {
    std::vector<int> ids{VideoCall(phone, "2002")};
    for (int index = 0; index < guests; ++index) ids.push_back(Guest(phone, std::to_string(2003 + index)));
    return ids;
}

// A linha "video: ..." do envio que liga (também o que volta num stream refeito por um re-INVITE), no H.264 de cada
// qualidade dos testes: a Alta, a Média (também o teto de dois ou três convidados) e a Média da sala (quatro ou cinco).
const char kSendsHigh[] = "video: H264 1280x720 30 qps, envio ligado";
const char kSendsMedium[] = "video: H264 640x480 25 qps, envio ligado";
const char kSendsRoomMedium[] = "video: H264 640x480 15 qps, envio ligado";

// A linha do motor quando o re-INVITE da qualidade de um convidado deixa de esperar outro re-INVITE dele, e a da PJSIP
// a cada tentativa que encontra outro em andamento.
const char kReinviteGaveUp[] = "o re-INVITE da qualidade da sala ficou para a proxima mudanca";
const char kReinviteBusy[] = "Unable to create re-INVITE";

// As escolhas dos testes da sala, na qualidade dada.
VideoSettings RoomSettings(VideoQuality quality) {
    VideoSettings settings = RoomSettings();
    settings.quality = quality;
    return settings;
}

// A porta do m=audio de um SDP (a de cada ligação), ou vazio sem ele.
std::string AudioPort(const std::string& sdp) {
    std::istringstream lines(sdp);
    std::string line;
    while (std::getline(lines, line)) {
        if (line.rfind("m=audio ", 0) == 0) return line.substr(8, line.find(' ', 8) - 8);
    }
    return std::string();
}

}  // namespace

TEST_CASE("from four guests the room uses the room medium and the guests already in are rebuilt") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings(VideoQuality::Medium));
    for (const char* number : {"2002", "2003", "2004", "2005"}) ShowColor(phone, number, kOrange);
    phone.listener.CountLog(kSendsMedium);
    phone.listener.CountLog(kSendsRoomMedium);
    // Os re-INVITE de cada um dos que já estavam (a lista de codecs deles é a da PJSIP).
    const std::vector<std::string> already{"2002", "2003", "2004"};
    const auto reinvites = [&phone](const std::string& number) {
        return LinesStartingWith(phone, "video-reinv " + number + " ");
    };

    // Com três convidados, o teto da sala não muda a Média escolhida: cada um manda em 640x480, a 25 qps.
    VideoRoom(phone, 2);
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsMedium) >= 3; }, kWaitSeconds));

    // O quarto põe a sala na Média da sala (640x480, a 15 qps): ele já nasce nela, e cada um dos que já estavam ganha
    // um re-INVITE e volta a mandar no stream refeito. Um só: depois que todos voltaram, nenhum segundo.
    const int g3 = Guest(phone, "2005");
    for (const std::string& number : already) {
        CAPTURE(number);
        CHECK(WaitUntil([&] { return reinvites(number) == 1; }, kWaitSeconds));
    }
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsRoomMedium) >= 4; }, kWaitSeconds));
    CHECK(NoLogLine(phone, "video-reinv 2005"));
    for (const std::string& number : already) {
        CAPTURE(number);
        CHECK(reinvites(number) == 1);
    }

    // Ele sai: a sala volta à Média escolhida, e os três que ficam ganham mais um re-INVITE cada e mandam de novo em
    // 640x480, a 25 qps.
    const size_t medium = phone.listener.LogCount(kSendsMedium);
    REQUIRE(phone.engine->Hangup(g3));
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsMedium) >= medium + 3; }, kWaitSeconds));
    for (const std::string& number : already) {
        CAPTURE(number);
        CHECK(reinvites(number) == 2);
    }
}

TEST_CASE("the chosen quality comes back when the room ends") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings(VideoQuality::High));
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    phone.listener.CountLog(kSendsHigh);
    phone.listener.CountLog(kSendsMedium);

    // A videochamada na Alta escolhida.
    VideoCall(phone, "2002");
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsHigh) >= 1; }, kWaitSeconds));

    // Com a sala, o teto de dois convidados: a base passa a 640x480, a 25 qps, por um re-INVITE, e o convidado já nasce
    // assim (uma linha de cada um).
    const int g1 = Guest(phone, "2003");
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsMedium) >= 2; }, kWaitSeconds));
    CHECK(LinesStartingWith(phone, "video-reinv 2002 ") == 1);

    // A sala acaba, e a Alta volta para quem ficou: mais um re-INVITE, e a base manda de novo em 1280x720, a 30 qps.
    REQUIRE(phone.engine->Hangup(g1));
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kSendsHigh) >= 2; }, kWaitSeconds));
    CHECK(LinesStartingWith(phone, "video-reinv 2002 ") == 2);
}

TEST_CASE("a quality re-INVITE blocked by a pending one stops retrying after the renegotiation wait") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings(VideoQuality::High));
    WithoutVideo(phone, {"2003"});

    // A videochamada na Alta. O registrador deixa os re-INVITE sem resposta (como um pacote perdido): o da sala, que
    // leva a base ao teto de dois convidados, fica em andamento.
    VideoCall(phone, "2002");
    const std::string base = AudioPort(phone.registrar.VideoSdp());   // a oferta dela é o último SDP do telefone
    REQUIRE_FALSE(base.empty());
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == Lines{"OK"});
    Guest(phone, "2003");
    // O re-INVITE da sala para a base já chegou ao registrador (que o deixa sem resposta): o último SDP do telefone é o
    // dela de novo, e não o do convite do 2003, de outra porta. Sem esta espera, a Baixa podia sair antes dele, e o
    // re-INVITE sem resposta seria o dela, sem outro em andamento para encontrar.
    REQUIRE(WaitUntil([&] { return AudioPort(phone.registrar.VideoSdp()) == base; }, kWaitSeconds));

    // Outro alvo (a Baixa, escolhida no meio da sala): o re-INVITE dele para a base encontra o primeiro em andamento e
    // tenta de novo a cada 200 ms, por 2 s (o tempo do RetryWhileRenegotiating). Aí sai uma linha, e a base fica para a
    // próxima mudança: nenhuma tentativa depois.
    phone.listener.CountLog(kReinviteGaveUp);
    phone.listener.CountLog(kReinviteBusy);
    const Clock::time_point changed = Clock::now();
    phone.engine->SetVideoSettings(RoomSettings(VideoQuality::Low));
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kReinviteGaveUp) >= 1; }, kWaitSeconds));
    CHECK(Clock::now() - changed >= std::chrono::seconds(2));
    const size_t busy = phone.listener.LogCount(kReinviteBusy);
    CHECK(busy > 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    CHECK(phone.listener.LogCount(kReinviteBusy) == busy);
    CHECK(phone.listener.LogCount(kReinviteGaveUp) == 1);
}

TEST_CASE("every guest sending gets a keyframe every 3 seconds") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    ShowColor(phone, "2004", kTeal);
    VideoRoom(phone, 2);

    // Os quadros-chave do começo do stream do último que entrou (os da PJSIP: o primeiro quadro e mais 5, um por
    // segundo, por uns 5,3 s) acabam antes da contagem, que começa 6 s depois do primeiro pacote dele no registrador.
    // Nos 7 s dela, cada um manda o seu a cada 3 s, no prazo dele: 2 ou 3. Mais seria o ritmo de antes, um temporizador
    // só para todos, que voltava em 1 s a cada recusa de um (e cada um ficava com um a cada 2 s, uns 4 em 7 s).
    REQUIRE(phone.registrar.WaitForPacketsOf("2004", 1, kColorSeconds));
    const Clock::time_point firstPacket = Clock::now();
    std::this_thread::sleep_until(firstPacket + std::chrono::seconds(6));
    phone.registrar.ResetVideoPackets();
    std::this_thread::sleep_for(std::chrono::seconds(7));
    for (const std::string number : {"2002", "2003", "2004"}) {
        CAPTURE(number);
        const int keyframes = phone.registrar.KeyframesOf(number);
        CHECK(keyframes >= 2);
        CHECK(keyframes <= 3);
    }
}

#endif  // PJMEDIA_HAS_VIDEO
