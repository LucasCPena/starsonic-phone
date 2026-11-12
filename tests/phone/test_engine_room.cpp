// A sala de vídeo em grupo no motor do PJSIP, contra o registrador falso que faz de vários convidados: cada um com a
// imagem dele (VIDEO SOURCE), as contagens por convidado, o 180, o BYE e a espera. As ligações da sala (o nascimento,
// os convidados chamados e atendidos, a sala cheia, as recusas, as saídas e o fim), o som de todos com todos, o id da
// sala nos métodos de sempre, a ligação de fora (a que toca, a feita e a atendida, só com a voz, e a volta para a sala)
// e o convidado que põe a sala em espera. E os mosaicos: o de cada convidado (o eco do registrador devolve o que ele
// recebe) e o de quem montou (no FrameSink, com o id da sala), a nossa câmera neles e a lista de vídeo que muda no meio
// da sala. Com o PJSIP sem o vídeo (como o do Android), só o contrato do motor sem sala, o mesmo do motor do baresip
// (test_engine_baresip.cpp).
#include "call_fixture.h"

#include <pjsua-lib/pjsua.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <functional>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "RoomVideo.h"
#include "SipEngine.h"
#include "Video.h"
#include "video_devices_fixture.h"

using namespace starsonic;
using phone_test::Phone;

#if PJMEDIA_HAS_VIDEO

using phone_test::AddColorbar;
using phone_test::CallEvent;
using phone_test::FindDevice;
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::RemoveColorbar;
using phone_test::TestSink;
using phone_test::Transport;
using phone_test::WaitUntil;

namespace {

using State = RoomMember::State;
using Members = std::vector<RoomMember>;
using Clock = std::chrono::steady_clock;
using Yuv = TestSink::Yuv;

// Os quadros de dois convidados lado a lado no mosaico de quem montou (as MosaicCells de 2 em 1280x720).
const RoomTile kLeft{0, 0, 0.5, 1};
const RoomTile kRight{0.5, 0, 0.5, 1};

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

// Um convidado como o OnRoom o traz, sem a imagem dele (nenhum convidado destes testes manda imagem).
RoomMember Member(int callId, State state, const RoomTile& tile) {
    RoomMember member;
    member.callId = callId;
    member.state = state;
    member.tile = tile;
    return member;
}

// Os ids dos convidados, na ordem do OnRoom.
std::vector<int> MemberIds(const RoomInfo& room) {
    std::vector<int> ids;
    for (const RoomMember& member : room.members) ids.push_back(member.callId);
    return ids;
}

// Espera até kWaitSeconds que o último OnRoom satisfaça condition.
bool WaitRoom(Phone& phone, const std::function<bool(const RoomInfo&)>& condition) {
    return phone.listener.WaitForRoom(condition, kWaitSeconds);
}

// A posição do primeiro (ou, com last, do último) evento de ligação que satisfaz match; -1 sem nenhum.
int Position(const std::vector<CallEvent>& events, const std::function<bool(const CallEvent&)>& match,
             bool last = false) {
    int found = -1;
    for (size_t index = 0; index < events.size(); ++index) {
        if (!match(events[index])) continue;
        found = static_cast<int>(index);
        if (!last) break;
    }
    return found;
}

// Um OnRoom, entre os eventos de ligação.
bool IsRoomEvent(const CallEvent& event) { return event.kind == CallEvent::Room; }

// Quantas linhas do registro de ligações começam com prefix.
size_t LinesStartingWith(Phone& phone, const std::string& prefix) {
    const Lines log = phone.registrar.Log();
    return static_cast<size_t>(
        std::count_if(log.begin(), log.end(), [&](const std::string& line) { return line.rfind(prefix, 0) == 0; }));
}

// Nenhuma linha do registro de ligações começa com prefix.
bool NoLogLine(Phone& phone, const std::string& prefix) { return LinesStartingWith(phone, prefix) == 0; }

// A ligação de fora com a sala de pé: o 3005 liga, você atende (só com a voz) e sai da sala (o out). O id dela.
int AnswerOutside(Phone& phone) {
    const int id = phone.RingVideo("3005");
    REQUIRE(phone.engine->Answer(id));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.out; }));
    return id;
}

// As imagens dos convidados (o VIDEO SOURCE color do registrador) e o fundo do mosaico (o #04060e da página): nenhuma é
// uma das barras da câmera de teste (as barras coloridas da PJSIP).
const Yuv kOrange{150, 44, 200};
const Yuv kPurple{60, 200, 180};
const Yuv kTeal{180, 100, 60};
const Yuv kBackground{21, 132, 127};
// Cada espera de uma cor vai até kColorSeconds. As tolerâncias: a dos quadros que voltaram pelo codificador (o eco de
// um convidado), na cor de um convidado e no fundo, e a do mosaico de quem montou, que só passa pelo encaixe.
const int kColorSeconds = 8;
const int kEchoTolerance = 16;
const int kEchoBackground = 10;
const int kHostTolerance = 2;

// O motor sem as câmeras da PJSIP (como um computador sem câmera).
void NullVideo(EngineConfig& config) { config.nullVideo = true; }

// A imagem que o registrador manda como o convidado number: uma cor só, ou o eco do que ele recebe (o mosaico dele).
void ShowColor(Phone& phone, const std::string& number, const Yuv& color) {
    phone.registrar.VideoSource(number, "color " + std::to_string(color.y) + " " + std::to_string(color.u) + " " +
                                            std::to_string(color.v));
}

void ShowEcho(Phone& phone, const std::string& number) { phone.registrar.VideoSource(number, "echo"); }

// A sala com vídeo dos testes do mosaico: a videochamada ao 2002 e os convidados 2003, 2004..., cada um na sala. Os ids
// da ligação de onde a sala nasceu e dos convidados, na ordem de entrada.
std::vector<int> VideoRoom(Phone& phone, int guests) {
    std::vector<int> ids{VideoCall(phone, "2002")};
    for (int index = 0; index < guests; ++index) ids.push_back(Guest(phone, std::to_string(2003 + index)));
    return ids;
}

// O pixel (fx, fy) do último quadro do id está na cor, com a tolerância (um quadro do id chegou).
bool IsColor(const TestSink& sink, int id, double fx, double fy, const Yuv& color, int tolerance) {
    const std::optional<Yuv> pixel = sink.PixelAt(id, fx, fy);
    return pixel && std::abs(pixel->y - color.y) <= tolerance && std::abs(pixel->u - color.u) <= tolerance &&
           std::abs(pixel->v - color.v) <= tolerance;
}

// Espera até seconds que o pixel (fx, fy) do último quadro do id fique na cor.
bool SeesColor(const TestSink& sink, int id, double fx, double fy, const Yuv& color, int tolerance,
               int seconds = kColorSeconds) {
    return sink.WaitForColor(id, fx, fy, color, tolerance, seconds);
}

// Espera até seconds as barras da câmera na linha fy do último quadro do id, entre fromX e toX: o Y varia muito.
bool SeesBars(const TestSink& sink, int id, double fy, double fromX, double toX, int seconds = kColorSeconds) {
    return WaitUntil([&] { return sink.RowSpanY(id, fy, fromX, toX) > 100; }, seconds);
}

// Espera até 2 s pelos quadros de 1280x720 do mosaico de quem montou, com o id da sala: pelo menos 30 (os 25 qps).
bool HostFramesFlow(const TestSink& sink, int roomId) {
    const Clock::time_point since = Clock::now();
    return WaitUntil([&] { return sink.Count(roomId, 1280, 720, since) >= 30; }, 2);
}

// O convidado callId está na sala com a imagem dele chegando.
bool HasImage(const RoomInfo& room, int callId) {
    return std::any_of(room.members.begin(), room.members.end(),
                       [callId](const RoomMember& member) { return member.callId == callId && member.image; });
}

// A linha do motor quando uma releitura muda os ids dos dispositivos da sala (o envio dela recomeça), e a da mudança
// do envio de uma ligação para desligado (a "video: ...").
const char kRoomRestart[] = "os ids da sala mudaram na lista de video";
const char kSendOff[] = "envio desligado";

// Os valores de um plano da imagem, para a mensagem de um caso que falha.
std::string ValuesText(const std::set<int>& values) {
    std::string text;
    for (const int value : values) text += std::to_string(value) + " ";
    return text;
}

}  // namespace

TEST_CASE("the registrar's color source arrives as a solid image") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    phone.registrar.VideoSource("2003", "color 150 44 200");
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));

    CHECK(sink.WaitFor(id, 3, 5, 64, 48));   // a imagem do registrador, de 64x48
    CHECK(sink.WaitForColor(id, 0.5, 0.5, {150, 44, 200}, 2, 5));
    CHECK(phone.registrar.WaitForPacketsOf("2003", 1, 5));   // e a nossa câmera chega a ele
    phone.engine->SetFrameSink(nullptr);
}

TEST_CASE("RoomAdd makes a room of the only video call and calls the guest without holding anyone") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int guest = phone.engine->RoomAdd("2003");
    REQUIRE(guest > 0);
    // O nascimento: um id novo, a ligação de agora na sala e o convidado chamando.
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.id != 0; }));
    const RoomInfo born = phone.listener.Rooms().front();
    CHECK(born.id > 0);
    CHECK(born.id != base);
    CHECK(born.id != guest);
    CHECK(born.members == Members{Member(base, State::In, kLeft), Member(guest, State::Calling, kRight)});
    CHECK_FALSE(born.out);
    CHECK_FALSE(born.full);
    CHECK_FALSE(born.ended);

    // Ele chega antes do primeiro evento da ligação do convidado; atendido, o convidado entra na sala, os dois lado a
    // lado no mosaico de quem montou.
    REQUIRE(phone.WaitState(guest, CallState::Confirmed));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return room.members == Members{Member(base, State::In, kLeft), Member(guest, State::In, kRight)};
    }));
    const std::vector<CallEvent> calls = phone.listener.Calls();
    const int firstRoom = Position(calls, IsRoomEvent);
    const int firstState = Position(
        calls, [guest](const CallEvent& event) { return event.kind == CallEvent::State && event.callId == guest; });
    REQUIRE(firstRoom >= 0);
    REQUIRE(firstState >= 0);
    CHECK(firstRoom < firstState);
    const RoomInfo now = phone.listener.Rooms().back();
    CHECK(now.id == born.id);
    CHECK_FALSE(now.out);
    CHECK_FALSE(now.full);
    CHECK_FALSE(now.ended);
    CHECK(phone.engine->Room() == now);

    // A oferta do convidado leva o vídeo, e ninguém vai para a espera. Ele respondeu sem o vídeo (VIDEO SOURCE none):
    // é um convidado sem vídeo, sem o refused.
    CHECK(phone.registrar.WaitForLog("video-in 2003 H264,VP8", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 2002 sendonly") == 0);
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.listener.RefusedCount(guest) == 0);
    CHECK_FALSE(phone.engine->Video(guest).active);
}

TEST_CASE("everyone hears everyone in the room and the room id has no audio") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004", "2005"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");
    const int g3 = Guest(phone, "2005");
    const int roomId = phone.engine->Room().id;
    REQUIRE(roomId > 0);

    // Cada um com o nosso som e com cada outro, nos dois sentidos.
    CHECK(phone.WaitLinks(base, {0, g1, g2, g3}));
    CHECK(phone.WaitLinks(g1, {0, base, g2, g3}));
    CHECK(phone.WaitLinks(g2, {0, base, g1, g3}));
    CHECK(phone.WaitLinks(g3, {0, base, g1, g2}));
    CHECK(phone.engine->AudioLinks(roomId).empty());
    CHECK(phone.engine->CallCount() == 4);
}

TEST_CASE("RoomAdd needs a lone confirmed video call") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});
    const auto end = [&phone](int id) {
        REQUIRE(phone.engine->Hangup(id));
        REQUIRE(phone.WaitState(id, CallState::Disconnected));
    };
    // Cada caso dá -1 pelo motivo dele: a linha do log (sem o número) sai uma vez.
    const auto refused = [&phone](const std::string& number, const std::string& reason) {
        CAPTURE(reason);
        const std::string line = "convidado da sala recusado: " + reason;
        phone.listener.CountLog(line);
        const size_t before = phone.listener.LogCount(line);
        CHECK(phone.engine->RoomAdd(number) == -1);
        CHECK(phone.listener.LogCount(line) == before + 1);
    };

    // Sem ligação.
    refused("2003", "nenhuma ligacao");
    // Numa ligação que ainda chama (o 180 só toca).
    const int calling = phone.engine->MakeCall("180", true);
    REQUIRE(calling > 0);
    REQUIRE(phone.WaitState(calling, CallState::Early));
    refused("2003", "a ligacao nao foi confirmada");
    end(calling);
    // Numa ligação só de voz.
    const int voice = phone.Dial("2002");
    refused("2003", "a ligacao nao tem video");
    end(voice);
    // Numa ligação com vídeo em espera.
    const int held = VideoCall(phone, "2002");
    REQUIRE(phone.engine->SetHold(held, true));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    refused("2003", "a ligacao esta em espera");
    end(held);
    // Com uma segunda tocando.
    const int call = VideoCall(phone, "2002");
    const int ringing = phone.Ring();
    refused("2003", "mais de uma ligacao");
    REQUIRE(phone.engine->Reject(ringing));
    REQUIRE(phone.WaitState(ringing, CallState::Disconnected));
    // Com o número vazio.
    refused("", "numero vazio");
    // Com as escolhas sem codec, aplicadas depois da ligação.
    VideoSettings noCodec = RoomSettings();
    noCodec.h264 = false;
    noCodec.vp8 = false;
    noCodec.vp9 = false;
    phone.engine->SetVideoSettings(noCodec);
    refused("2003", "nenhum codec de video nas escolhas");
    end(call);

    // Nenhum OnRoom, e o convidado nunca foi chamado.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.Rooms().empty());
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(NoLogLine(phone, "inv-in 2003"));
}

TEST_CASE("a RoomAdd whose call cannot go out leaves the call and the room as they were") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});
    // Um número com @ e um endereço IPv6 dá uma URI que o PJSIP recusa na hora: o makeCall falha sem callback nenhum.
    const std::string unreachable = "2002@[::1]";
    const std::string failed = "nao foi possivel ligar para o convidado da sala";
    phone.listener.CountLog(failed);

    // Sem sala: ela não nasce, e a ligação segue como estava, com o nosso som e o vídeo.
    const int base = VideoCall(phone, "2002");
    CHECK(phone.engine->RoomAdd(unreachable) == -1);
    CHECK(phone.listener.LogCount(failed) == 1);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.Rooms().empty());
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(phone.WaitLinks(base, {0}));
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->Video(base).active);

    // Com a sala de pé: ela segue igual, e nenhum OnRoom chega.
    const int g1 = Guest(phone, "2003");
    const RoomInfo room = phone.engine->Room();
    const size_t rooms = phone.listener.Rooms().size();
    CHECK(phone.engine->RoomAdd(unreachable) == -1);
    CHECK(phone.listener.LogCount(failed) == 2);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.engine->Room() == room);
    CHECK(phone.listener.Rooms().size() == rooms);
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.engine->CallCount() == 2);
}

TEST_CASE("the room holds five guests counting the ones being called") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004", "2005", "2006"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");
    const int g3 = Guest(phone, "2005");
    // O quinto, ainda chamando, já enche a sala.
    const int calling = phone.engine->RoomAdd("180");
    REQUIRE(calling > 0);
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return room.full && MemberIds(room) == std::vector<int>{base, g1, g2, g3, calling} &&
               HasMember(room, calling, State::Calling);
    }));
    CHECK(phone.engine->RoomAdd("2006") == -1);

    // O que chama desliga (CANCEL): a sala volta a ter lugar.
    REQUIRE(phone.registrar.WaitForLog("inv-in 180 180", kWaitSeconds));
    REQUIRE(phone.WaitState(calling, CallState::Early));
    REQUIRE(phone.engine->Hangup(calling));
    CHECK(phone.registrar.WaitForLog("cancel-in 180", kWaitSeconds));
    REQUIRE(phone.WaitState(calling, CallState::Disconnected));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return !room.full && MemberIds(room) == std::vector<int>{base, g1, g2, g3};
    }));

    const int g4 = phone.engine->RoomAdd("2006");
    CHECK(g4 > 0);
    CHECK(phone.WaitState(g4, CallState::Confirmed));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) { return room.full && HasMember(room, g4, State::In); }));
}

TEST_CASE("a guest the PBX refuses fails with its code and the room goes on") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int refused = phone.engine->RoomAdd("486");
    REQUIRE(refused > 0);
    REQUIRE(phone.WaitState(refused, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, refused, CallState::Disconnected).code == 486);

    // Ele esteve na sala, chamando, e a sala volta aos dois de antes, sem acabar.
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return room.members == Members{Member(base, State::In, kLeft), Member(g1, State::In, kRight)};
    }));
    const std::vector<RoomInfo> rooms = phone.listener.Rooms();
    CHECK(std::any_of(rooms.begin(), rooms.end(),
                      [refused](const RoomInfo& room) { return HasMember(room, refused, State::Calling); }));
    CHECK_FALSE(rooms.back().ended);
    CHECK(phone.engine->Room() == rooms.back());
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(g1, {0, base}));

    // Um aparelho que recusa a oferta de vídeo inteira (488) também fica de fora com o código, sem um convite de novo só
    // com a voz.
    REQUIRE(phone.registrar.Control("VIDEO 488 on") == Lines{"OK"});
    const int noVideo = phone.engine->RoomAdd("2004");
    REQUIRE(noVideo > 0);
    REQUIRE(phone.WaitState(noVideo, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, noVideo, CallState::Disconnected).code == 488);
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return room.members == Members{Member(base, State::In, kLeft), Member(g1, State::In, kRight)};
    }));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("inv-in 2004 488") == 1);
    CHECK(phone.LogCount("inv-in 2004 200") == 0);
    CHECK_FALSE(phone.listener.Rooms().back().ended);
}

TEST_CASE("a room born with a refused guest ends at once and the call goes on") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());

    const int base = VideoCall(phone, "2002");
    const int refused = phone.engine->RoomAdd("486");
    REQUIRE(refused > 0);
    REQUIRE(phone.WaitState(refused, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, refused, CallState::Disconnected).code == 486);

    // O nascimento e logo o fim, com a ligação de onde a sala nasceu.
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    const std::vector<RoomInfo> rooms = phone.listener.Rooms();
    REQUIRE(rooms.size() == 2);
    CHECK(rooms[0].members == Members{Member(base, State::In, kLeft), Member(refused, State::Calling, kRight)});
    CHECK_FALSE(rooms[0].ended);
    CHECK(rooms[1].id == rooms[0].id);
    CHECK(MemberIds(rooms[1]) == std::vector<int>{base});
    CHECK(rooms[1].members[0].state == State::In);
    // O fim da sala vem depois do fim da ligação que o causou.
    const std::vector<CallEvent> calls = phone.listener.Calls();
    const int refusal = Position(calls, [refused](const CallEvent& event) {
        return event.kind == CallEvent::State && event.callId == refused && event.state == CallState::Disconnected;
    });
    REQUIRE(refusal >= 0);
    CHECK(refusal < Position(calls, IsRoomEvent, true));

    // A ligação segue, comum: sozinha com o nosso som e com o vídeo.
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(phone.WaitLinks(base, {0}));
    CHECK(phone.engine->Video(base).active);
    CHECK(phone.engine->CallCount() == 1);
}

TEST_CASE("the room outlives the call it was born from") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");
    const int roomId = phone.engine->Room().id;
    REQUIRE(roomId > 0);

    // A ligação de onde a sala nasceu sai primeiro: a sala segue com o mesmo id, os dois lado a lado.
    REQUIRE(phone.registrar.Control("BYE 2002") == Lines{"OK"});
    CHECK(phone.WaitState(base, CallState::Disconnected));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return room.id == roomId && !room.ended &&
               room.members == Members{Member(g1, State::In, kLeft), Member(g2, State::In, kRight)};
    }));
    CHECK(phone.WaitLinks(g1, {0, g2}));
    CHECK(phone.WaitLinks(g2, {0, g1}));
}

TEST_CASE("a guest leaving rearranges the room, and with one guest left it is a normal call again") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");

    // O Tirar da sala: os dois que ficam, lado a lado.
    REQUIRE(phone.engine->Hangup(g1));
    REQUIRE(phone.WaitState(g1, CallState::Disconnected));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) {
        return !room.ended && room.members == Members{Member(base, State::In, kLeft), Member(g2, State::In, kRight)};
    }));

    // Com um só, a sala acaba, e ele é uma ligação comum: sozinha com o nosso som, e a espera de sempre.
    REQUIRE(phone.registrar.Control("BYE 2004") == Lines{"OK"});
    REQUIRE(phone.WaitState(g2, CallState::Disconnected));
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    CHECK(MemberIds(phone.listener.Rooms().back()) == std::vector<int>{base});
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(phone.WaitLinks(base, {0}));
    REQUIRE(phone.engine->SetHold(base, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
}

TEST_CASE("a room that ends with its guest on hold leaves a normal call with our audio") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    // O convidado põe a sala em espera: ele fica Held e fora da mesa (a música da central não chega a ninguém).
    REQUIRE(phone.registrar.Control("HOLD 2003 on") == Lines{"OK"});
    CHECK(WaitRoom(phone, [g1](const RoomInfo& room) { return HasMember(room, g1, State::Held); }));
    CHECK(phone.WaitLinks(g1, {}));
    CHECK(phone.WaitLinks(base, {0}));

    // A ligação de onde a sala nasceu sai: a sala acaba com ele em espera, e ele é uma ligação comum, a ativa, com o
    // nosso som (a espera do outro lado fala e ouve, como em qualquer ligação).
    REQUIRE(phone.registrar.Control("BYE 2002") == Lines{"OK"});
    REQUIRE(phone.WaitState(base, CallState::Disconnected));
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    CHECK(phone.listener.Rooms().back().members == Members{Member(g1, State::Held, {0, 0, 1, 1})});
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(phone.WaitLinks(g1, {0}));
}

TEST_CASE("a call from outside rings without video while the room goes on") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.VideosText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    // O 3005 é um Porteiro: com a sala de pé, nem ele ganha o 183 com a imagem (a ligação de fora é só de voz).
    VideoSettings settings = RoomSettings();
    settings.doorphones = {"3005"};
    phone.engine->SetVideoSettings(settings);
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const RoomInfo room = phone.engine->Room();
    // Ela toca, e a sala segue como estava (você nela): o nosso som com os convidados.
    const int outside = phone.RingVideo("3005");
    CHECK(phone.WaitState(outside, CallState::Early));
    CHECK(phone.engine->Room() == room);
    CHECK_FALSE(phone.engine->Room().out);
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(g1, {0, base}));

    // Recusada, todos os eventos dela já chegaram (nenhum OnCallVideo vem depois do Disconnected), e um 183 chegaria ao
    // registrador antes da resposta final: só com a voz, sem o offered, o early, o doorphone e o refused.
    REQUIRE(phone.engine->Reject(outside));
    REQUIRE(phone.WaitState(outside, CallState::Disconnected));
    REQUIRE(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    const CallVideo video = phone.listener.LastVideo(outside);
    CHECK_FALSE(video.offered);
    CHECK_FALSE(video.early);
    CHECK_FALSE(video.doorphone);
    CHECK(phone.listener.RefusedCount(outside) == 0);
    CHECK(NoLogLine(phone, "sdp-out 2001 183"));
}

TEST_CASE("answering the outside call takes us out of the room and returning puts it on hold") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowEcho(phone, "2002");
    ShowColor(phone, "2003", kPurple);
    const std::vector<int> ids = VideoRoom(phone, 1);
    const int base = ids[0];
    const int g1 = ids[1];
    const int roomId = phone.engine->Room().id;
    // O mosaico da base (o eco dela): a nossa câmera à esquerda e o g1 à direita.
    REQUIRE(SeesBars(sink, base, 0.5, 0.02, 0.48));
    REQUIRE(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));

    // Atendida, a ligação de fora (só com a voz) tira o nosso som e a nossa câmera da sala, sem re-INVITE para os
    // convidados: eles seguem se ouvindo, e o mosaico da base segue, com o fundo no nosso quadro. Nenhum re-INVITE
    // (de nenhuma direção) vai aos convidados, na ida nem na volta.
    const size_t toBase = LinesStartingWith(phone, "reinv-in 2002");
    const size_t toG1 = LinesStartingWith(phone, "reinv-in 2003");
    const int outside = phone.RingVideo("3005");
    REQUIRE(phone.engine->Answer(outside, true));
    CHECK(phone.registrar.WaitForLog("sdp-out 2001 200 video=nao", kWaitSeconds));
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return room.out; }));
    CHECK(phone.WaitLinks(base, {g1}));
    CHECK(phone.WaitLinks(g1, {base}));
    CHECK(phone.WaitLinks(outside, {0}));
    CHECK(SeesColor(sink, base, 0.25, 0.5, kBackground, kEchoBackground));
    CHECK(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));
    CHECK(LinesStartingWith(phone, "reinv-in 2002") == toBase);
    CHECK(LinesStartingWith(phone, "reinv-in 2003") == toG1);

    // O Voltar para a sala: a de fora vai para a espera, e o nosso som e as barras voltam.
    REQUIRE(phone.engine->Activate(roomId));
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return !room.out; }));
    CHECK(phone.registrar.WaitForLog("reinv-in 3005 sendonly", kWaitSeconds));
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(outside, {}));
    CHECK(SeesBars(sink, base, 0.5, 0.02, 0.48));
    CHECK(LinesStartingWith(phone, "reinv-in 2002") == toBase);
    CHECK(LinesStartingWith(phone, "reinv-in 2003") == toG1);
}

TEST_CASE("the outside call ending leaves us out until we return") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int roomId = phone.engine->Room().id;
    const int outside = AnswerOutside(phone);

    // Só uma de fora por vez, também com vagas livres na sala: outra que chega recebe 486.
    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.listener.WaitForCalls(phone_test::RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    REQUIRE(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    CHECK(phone.Count(CallEvent::Incoming) == 1);

    // A de fora acaba: o motor não volta sozinho para a sala, e os convidados seguem se ouvindo, sem o nosso som.
    REQUIRE(phone.registrar.Control("HANGUP 2001") == Lines{"OK"});
    REQUIRE(phone.WaitState(outside, CallState::Disconnected));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.engine->Room().out);
    CHECK(phone.WaitLinks(base, {g1}));

    // O Voltar para a sala, pelo SetHold(false) do id dela.
    REQUIRE(phone.engine->SetHold(roomId, false));
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return !room.out; }));
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(g1, {0, base}));
}

TEST_CASE("a second call from outside is busy, even with the room full") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    const std::vector<std::string> guests{"2003", "2004", "2005", "2006"};
    WithoutVideo(phone, guests);

    VideoCall(phone, "2002");
    for (const std::string& number : guests) Guest(phone, number);
    REQUIRE(phone.engine->Room().full);

    // A sala cheia deixa a vaga da ligação de fora: ela toca. A segunda, com ela tocando, recebe 486.
    const int outside = phone.Ring();
    CHECK(phone.WaitState(outside, CallState::Early));
    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.listener.WaitForCalls(phone_test::RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    CHECK(phone.Count(CallEvent::Incoming) == 1);

    // A primeira acaba, e a vaga dela serve também para ligar para fora com a sala ainda cheia: só com a voz, e você
    // sai da sala.
    REQUIRE(phone.engine->Hangup(outside));
    REQUIRE(phone.WaitState(outside, CallState::Disconnected));
    const int dialed = phone.engine->MakeCall("2009");
    REQUIRE(dialed > 0);
    CHECK(phone.registrar.WaitForLog("video-in 2009 nao", kWaitSeconds));
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return room.full && room.out; }));
}

TEST_CASE("a call made during the room is the outside call, voice only") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    // Com o vídeo pedido, ela sai só com a voz e sem o refused, e tira você da sala.
    const int outside = phone.engine->MakeCall("2009", true);
    REQUIRE(outside > 0);
    CHECK(phone.registrar.WaitForLog("video-in 2009 nao", kWaitSeconds));
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return room.out; }));
    REQUIRE(phone.WaitState(outside, CallState::Confirmed));
    CHECK(phone.WaitLinks(outside, {0}));
    CHECK(phone.WaitLinks(base, {g1}));
    CHECK(phone.listener.RefusedCount(outside) == 0);

    // Só uma de fora por vez, e você fora da sala não chama convidados: cada -1 pelo motivo dele.
    const std::string busy = "recusada: ja ha uma ligacao fora da sala";
    const std::string out = "convidado da sala recusado: voce esta fora da sala";
    phone.listener.CountLog(busy);
    phone.listener.CountLog(out);
    CHECK(phone.engine->MakeCall("2010") == -1);
    CHECK(phone.engine->RoomAdd("2011") == -1);
    CHECK(phone.listener.LogCount(busy) == 1);
    CHECK(phone.listener.LogCount(out) == 1);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(NoLogLine(phone, "inv-in 2010"));
    CHECK(NoLogLine(phone, "inv-in 2011"));
}

TEST_CASE("a guest who puts the room on hold is held, out of the mix and gets no mosaic until it comes back") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    ShowColor(phone, "2004", kTeal);
    const std::vector<int> ids = VideoRoom(phone, 2);
    const int base = ids[0];
    const int g1 = ids[1];
    const int g2 = ids[2];
    const int roomId = phone.engine->Room().id;
    // O g1 no segundo quadro da linha de cima do mosaico de quem montou, e o mosaico dele chegando a ele.
    REQUIRE(SeesColor(sink, roomId, 0.75, 0.25, kPurple, kHostTolerance));
    REQUIRE(phone.registrar.WaitForPacketsOf("2003", 1, kColorSeconds));

    // O g1 põe a sala em espera (o Review Focus 1; num aparelho de verdade, com a música da central): ele fica Held e
    // sai da mesa de áudio, e os outros seguem se ouvindo.
    REQUIRE(phone.registrar.Control("HOLD 2003 on") == Lines{"OK"});
    CHECK(WaitRoom(phone, [g1](const RoomInfo& room) { return HasMember(room, g1, State::Held); }));
    CHECK(phone.WaitLinks(g1, {}));
    CHECK(phone.WaitLinks(base, {0, g2}));
    // O envio para ele para (a direção negociada não deixa mandar), e o quadro dele fica com o fundo, embora a imagem
    // dele continue chegando.
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(phone.registrar.PacketsStayOf("2003", 1));
    CHECK(SeesColor(sink, roomId, 0.75, 0.25, kBackground, kHostTolerance));
    const Clock::time_point held = Clock::now();
    CHECK(WaitUntil([&] { return sink.Count(g1, 0, 0, held) >= 5; }, kColorSeconds));
    CHECK(SeesColor(sink, g1, 0.5, 0.5, kPurple, kHostTolerance));

    // Ele volta: na sala de novo, com o som de todos, o mosaico dele e o quadro dele no de quem montou.
    const int packets = phone.registrar.PacketsOf("2003");
    REQUIRE(phone.registrar.Control("HOLD 2003 off") == Lines{"OK"});
    CHECK(WaitRoom(phone, [g1](const RoomInfo& room) { return HasMember(room, g1, State::In); }));
    CHECK(phone.WaitLinks(g1, {0, base, g2}));
    CHECK(phone.WaitLinks(base, {0, g1, g2}));
    CHECK(phone.registrar.WaitForPacketsOf("2003", packets + 20, 5));
    CHECK(SeesColor(sink, roomId, 0.75, 0.25, kPurple, kHostTolerance));
}

TEST_CASE("the last guest left while we are out waits without our audio until we go back") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    Guest(phone, "2003");
    const int outside = AnswerOutside(phone);

    // O g1 sai com você fora: a sala acaba, e a base, agora uma ligação comum, não é a ativa. Ela espera ligada, sem o
    // nosso som e sem re-INVITE (conferidos depois de 1 s, quando o motor já teria mexido nela).
    const size_t reinvites = LinesStartingWith(phone, "reinv-in 2002");
    REQUIRE(phone.registrar.Control("BYE 2003") == Lines{"OK"});
    const Clock::time_point bye = Clock::now();
    CHECK(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    std::this_thread::sleep_until(bye + std::chrono::seconds(1));
    CHECK(phone.WaitLinks(outside, {0}));
    CHECK(phone.WaitLinks(base, {}));
    CHECK(LinesStartingWith(phone, "reinv-in 2002") == reinvites);

    // Você volta para ela pelo Activate dela: a de fora vai para a espera, pelas regras das duas ligações.
    REQUIRE(phone.engine->Activate(base));
    CHECK(phone.WaitLinks(base, {0}));
    CHECK(phone.registrar.WaitForLog("reinv-in 3005 sendonly", kWaitSeconds));
}

TEST_CASE("Hangup with the room id ends every guest") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");
    const int roomId = phone.engine->Room().id;
    REQUIRE(roomId > 0);

    REQUIRE(phone.engine->Hangup(roomId));
    // Depois do Hangup do id dela, a sala não é mais para onde voltar: o Voltar para a sala dá false, com ela ainda
    // fechando ou já acabada (o pjsua avisa o fim de cada convidado dentro do Hangup, antes de mandar o BYE).
    CHECK_FALSE(phone.engine->Activate(roomId));
    CHECK_FALSE(phone.engine->SetHold(roomId, false));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2004", kWaitSeconds));
    for (const int id : {base, g1, g2}) CHECK(phone.WaitState(id, CallState::Disconnected));

    // Ninguém volta a ser uma ligação comum: o último OnRoom acaba a sala sem ninguém, e só ele tem o ended.
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    const std::vector<RoomInfo> rooms = phone.listener.Rooms();
    CHECK(rooms.back().id == roomId);
    CHECK(rooms.back().members.empty());
    CHECK(std::count_if(rooms.begin(), rooms.end(), [](const RoomInfo& room) { return room.ended; }) == 1);
    CHECK(WaitUntil([&phone] { return phone.engine->CallCount() == 0; }, kWaitSeconds));
    CHECK(phone.engine->Room() == RoomInfo());
}

TEST_CASE("RemoveAccount during the room hangs up every guest and ends the room with nobody") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003", "2004"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const int g2 = Guest(phone, "2004");
    const int roomId = phone.engine->Room().id;
    REQUIRE(roomId > 0);

    // A conta sai com a sala de pé (o fim de todas as ligações, o End da tabela): a sala fecha como no Hangup do id
    // dela, e ninguém volta a ser uma ligação comum.
    phone.engine->RemoveAccount();
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2004", kWaitSeconds));
    for (const int id : {base, g1, g2}) CHECK(phone.WaitState(id, CallState::Disconnected));
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    const std::vector<RoomInfo> rooms = phone.listener.Rooms();
    CHECK(rooms.back().id == roomId);
    CHECK(rooms.back().members.empty());
    CHECK(std::count_if(rooms.begin(), rooms.end(), [](const RoomInfo& room) { return room.ended; }) == 1);
    CHECK(WaitUntil([&phone] { return phone.engine->CallCount() == 0; }, kWaitSeconds));
    CHECK(phone.engine->Room() == RoomInfo());
}

TEST_CASE("the room id only works where a room makes sense") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const RoomInfo room = phone.engine->Room();
    REQUIRE(room.id > 0);

    CHECK_FALSE(phone.engine->SetHold(room.id, true));
    CHECK_FALSE(phone.engine->SendDtmf(room.id, "1"));
    CHECK_FALSE(phone.engine->Transfer(room.id, "2005"));
    CHECK_FALSE(phone.engine->TransferAttended(room.id, base));
    CHECK_FALSE(phone.engine->TransferAttended(base, room.id));
    CHECK_FALSE(phone.engine->Join(room.id, base));
    CHECK_FALSE(phone.engine->Join(base, room.id));
    CHECK_FALSE(phone.engine->Split(room.id, base));
    CHECK_FALSE(phone.engine->Answer(room.id));
    CHECK_FALSE(phone.engine->Answer(room.id, true));
    CHECK_FALSE(phone.engine->Reject(room.id));
    CHECK(phone.engine->AudioLinks(room.id).empty());
    // Você já está na sala: o Voltar para a sala não muda nada.
    CHECK(phone.engine->Activate(room.id));
    CHECK(phone.engine->SetHold(room.id, false));

    // A sala segue como estava, sem re-INVITE nem REFER.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(g1, {0, base}));
    CHECK(phone.engine->Room() == room);
    CHECK(NoLogLine(phone, "reinv-in"));
    CHECK(NoLogLine(phone, "refer-in"));
}

TEST_CASE("a guest is not a line: Activate, SetHold and Join refuse it and the room goes on") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.RoomsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetVideoSettings(RoomSettings());
    WithoutVideo(phone, {"2003"});

    const int base = VideoCall(phone, "2002");
    const int g1 = Guest(phone, "2003");
    const RoomInfo room = phone.engine->Room();

    CHECK_FALSE(phone.engine->Activate(g1));
    CHECK_FALSE(phone.engine->Activate(base));
    CHECK_FALSE(phone.engine->SetHold(g1, true));
    CHECK_FALSE(phone.engine->SetHold(base, false));
    CHECK_FALSE(phone.engine->Join(base, g1));
    CHECK_FALSE(phone.engine->Split(base, g1));

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(phone.WaitLinks(g1, {0, base}));
    CHECK(phone.engine->Room() == room);
    CHECK(NoLogLine(phone, "reinv-in"));
}

TEST_CASE("each guest receives the others and not itself") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    ShowEcho(phone, "2004");
    const std::vector<int> ids = VideoRoom(phone, 2);
    const int base = ids[0];
    const int g1 = ids[1];
    const int g2 = ids[2];
    const int roomId = phone.engine->Room().id;
    REQUIRE(roomId > 0);

    // O mosaico do g2 (o eco dele): a nossa câmera e a base em cima, e o g1 no centro da linha de baixo. O fundo dos
    // dois lados do g1 mostra que não há um quarto quadro: o g2 não recebe a própria imagem.
    CHECK(SeesBars(sink, g2, 0.25, 0.02, 0.48));
    CHECK(SeesColor(sink, g2, 0.75, 0.25, kOrange, kEchoTolerance));
    CHECK(SeesColor(sink, g2, 0.5, 0.75, kPurple, kEchoTolerance));
    CHECK(SeesColor(sink, g2, 0.1, 0.75, kBackground, kEchoBackground));
    CHECK(SeesColor(sink, g2, 0.9, 0.75, kBackground, kEchoBackground));

    // A troca: o g1 no eco e o g2 em verde-água. O mosaico do g1 tem a base em cima e o g2 embaixo.
    ShowEcho(phone, "2003");
    ShowColor(phone, "2004", kTeal);
    CHECK(SeesColor(sink, g1, 0.75, 0.25, kOrange, kEchoTolerance));
    CHECK(SeesColor(sink, g1, 0.5, 0.75, kTeal, kEchoTolerance));
    CHECK(SeesColor(sink, g1, 0.1, 0.75, kBackground, kEchoBackground));
    CHECK(SeesColor(sink, g1, 0.9, 0.75, kBackground, kEchoBackground));

    // O mosaico de quem montou, com o id da sala: os três, na ordem de entrada. A base encaixa no primeiro quadro com
    // as faixas do fundo dos lados, e o terceiro fica no centro da linha de baixo.
    CHECK(HostFramesFlow(sink, roomId));
    CHECK(SeesColor(sink, roomId, 0.25, 0.25, kOrange, kHostTolerance));
    CHECK(SeesColor(sink, roomId, 0.03, 0.25, kBackground, kHostTolerance));
    CHECK(SeesColor(sink, roomId, 0.1, 0.75, kBackground, kHostTolerance));
    CHECK(SeesColor(sink, roomId, 0.9, 0.75, kBackground, kHostTolerance));
    const CallVideo video = phone.engine->Video(roomId);
    CHECK(video.active);
    CHECK(video.remote);
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) { return HasImage(room, base) && HasImage(room, g2); }));

    // A terceira troca: a base no eco, o g1 em roxo e o g2 em verde-água. O mosaico da base tem a nossa câmera, o g1
    // e o g2.
    ShowEcho(phone, "2002");
    ShowColor(phone, "2003", kPurple);
    CHECK(SeesBars(sink, base, 0.25, 0.02, 0.48));
    CHECK(SeesColor(sink, base, 0.75, 0.25, kPurple, kEchoTolerance));
    CHECK(SeesColor(sink, base, 0.5, 0.75, kTeal, kEchoTolerance));
    CHECK(SeesColor(sink, base, 0.1, 0.75, kBackground, kEchoBackground));
    CHECK(SeesColor(sink, base, 0.9, 0.75, kBackground, kEchoBackground));
}

TEST_CASE("a guest without video is a background tile and still hears and is heard") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    WithoutVideo(phone, {"2003"});
    ShowColor(phone, "2004", kPurple);
    const std::vector<int> ids = VideoRoom(phone, 2);
    const int base = ids[0];
    const int g1 = ids[1];
    const int g2 = ids[2];
    const int roomId = phone.engine->Room().id;

    // No mosaico de quem montou, o g1 (um telefone sem câmera) fica com o fundo entre as imagens dos outros dois.
    CHECK(SeesColor(sink, roomId, 0.25, 0.25, kOrange, kHostTolerance));
    CHECK(SeesColor(sink, roomId, 0.5, 0.75, kPurple, kHostTolerance));
    CHECK(SeesColor(sink, roomId, 0.75, 0.25, kBackground, kHostTolerance));
    CHECK(WaitRoom(phone, [&](const RoomInfo& room) { return HasImage(room, base) && HasImage(room, g2); }));
    CHECK_FALSE(HasImage(phone.engine->Room(), g1));
    // Ele ouve e é ouvido por todos.
    CHECK(phone.WaitLinks(g1, {0, base, g2}));
}

TEST_CASE("the host's mosaic rearranges when a guest leaves") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    ShowColor(phone, "2004", kTeal);
    const std::vector<int> ids = VideoRoom(phone, 2);
    const int base = ids[0];
    const int roomId = phone.engine->Room().id;
    REQUIRE(SeesColor(sink, roomId, 0.5, 0.75, kTeal, kHostTolerance));

    // A ligação de onde a sala nasceu sai primeiro (o Review Focus 3): os dois que ficam, lado a lado, no mesmo id.
    REQUIRE(phone.registrar.Control("BYE 2002") == Lines{"OK"});
    REQUIRE(phone.WaitState(base, CallState::Disconnected));
    CHECK(SeesColor(sink, roomId, 0.25, 0.5, kPurple, kHostTolerance, 2));
    CHECK(SeesColor(sink, roomId, 0.75, 0.5, kTeal, kHostTolerance, 2));
    // Cada imagem de 64x48 encaixa em 640x480 na célula de 640x720, a partir do y 120: o fundo acima dela.
    CHECK(SeesColor(sink, roomId, 0.25, 0.08, kBackground, kHostTolerance, 2));
    CHECK(phone.engine->Room().id == roomId);
}

TEST_CASE("a room in VP8 sends each guest its mosaic") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    VideoSettings settings = RoomSettings();
    settings.h264 = false;
    phone.engine->SetVideoSettings(settings);
    ShowEcho(phone, "2002");
    ShowEcho(phone, "2003");

    // Cada um recebe o mosaico dele em 320x240: a nossa câmera encaixada no quadro da esquerda, com o fundo em cima
    // dela (a câmera direto ocuparia a imagem toda).
    for (const int id : VideoRoom(phone, 1)) {
        CAPTURE(id);
        CHECK(sink.WaitFor(id, 5, kColorSeconds, 320, 240));
        CHECK(SeesBars(sink, id, 0.5, 0.02, 0.48));
        CHECK(SeesColor(sink, id, 0.25, 0.1, kBackground, kEchoBackground));
    }
    CHECK(phone.registrar.KeyframesOf("2002") > 0);
    CHECK(phone.registrar.KeyframesOf("2003") > 0);
}

TEST_CASE("with one guest left the guest gets our camera directly again") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowEcho(phone, "2002");
    ShowColor(phone, "2003", kPurple);
    const std::vector<int> ids = VideoRoom(phone, 1);
    const int base = ids[0];
    const int g1 = ids[1];
    const int roomId = phone.engine->Room().id;
    REQUIRE(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));
    // O mosaico de quem montou chega com o id da sala: a conta do fim, lá embaixo, não passa à toa.
    REQUIRE(HostFramesFlow(sink, roomId));

    // O g1 sai: a sala acaba, e a base, uma ligação comum de novo, recebe a nossa câmera direto, na imagem toda (as
    // barras na linha inteira, e o roxo some do lado direito).
    REQUIRE(phone.engine->Hangup(g1));
    REQUIRE(WaitRoom(phone, [](const RoomInfo& room) { return room.ended; }));
    const Clock::time_point ended = Clock::now();
    CHECK(WaitUntil([&] {
        return sink.RowSpanY(base, 0.5, 0.02, 0.98) > 100 && !IsColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance);
    }, 6));
    CHECK(phone.listener.WaitForVideo(base, [](const CallVideo& video) { return video.camera; }, kWaitSeconds));
    CHECK(phone.engine->Video(base).camera);
    // Nenhum quadro com o id da sala 500 ms depois do fim dela.
    std::this_thread::sleep_until(ended + std::chrono::seconds(1));
    CHECK(sink.Count(roomId, 0, 0, ended + std::chrono::milliseconds(500)) == 0);
}

TEST_CASE("our camera off, or the screen locked, empties our tile and the room goes on") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.VideosText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowEcho(phone, "2003");
    const std::vector<int> ids = VideoRoom(phone, 1);
    const int roomId = phone.engine->Room().id;
    const int g1 = ids[1];
    // O mosaico do g1: a nossa câmera à esquerda e a base à direita.
    REQUIRE(SeesBars(sink, g1, 0.5, 0.02, 0.48));
    REQUIRE(SeesColor(sink, g1, 0.75, 0.5, kOrange, kEchoTolerance));
    // A nossa câmera chega aos dois pelo mosaico (o camera da sala), e não direto (o de cada um). Ela é a da sala: o
    // id de um convidado não a muda.
    CHECK(phone.listener.WaitForVideo(roomId, [](const CallVideo& video) { return video.camera; }, kWaitSeconds));
    for (const int id : ids) {
        CAPTURE(id);
        CHECK_FALSE(phone.engine->Video(id).camera);
        CHECK_FALSE(phone.engine->SetCamera(id, false));
    }

    // A câmera desligada na sala: o quadro dela fica com o fundo, e ela fecha.
    REQUIRE(phone.engine->SetCamera(roomId, false));
    CHECK(SeesColor(sink, g1, 0.25, 0.5, kBackground, kEchoBackground));
    CHECK_FALSE(phone.engine->Video(roomId).camera);
    const Clock::time_point closed = Clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(sink.Count(TestSink::kLocal, 0, 0, closed) == 0);
    // Ligada de novo, as barras voltam.
    REQUIRE(phone.engine->SetCamera(roomId, true));
    CHECK(SeesBars(sink, g1, 0.5, 0.02, 0.48));

    // A tela bloqueada também esvazia o quadro, e a sala segue: o mosaico continua chegando ao g1.
    phone.engine->SetCameraPaused(true);
    CHECK(SeesColor(sink, g1, 0.25, 0.5, kBackground, kEchoBackground));
    const Clock::time_point paused = Clock::now();
    CHECK(WaitUntil([&] { return sink.Count(g1, 0, 0, paused) >= 5; }, kColorSeconds));
    phone.engine->SetCameraPaused(false);
    CHECK(SeesBars(sink, g1, 0.5, 0.02, 0.48));
}

TEST_CASE("without a camera the guests still get the mosaic") {
    TestSink sink;
    Phone phone(Transport::Udp, nullptr, NullVideo);
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowEcho(phone, "2003");

    // Sem câmera, a videochamada só recebe: nada vai para o 2002.
    const int base = VideoCall(phone, "2002");
    REQUIRE(SeesColor(sink, base, 0.5, 0.5, kOrange, kHostTolerance));
    CHECK(phone.registrar.PacketsOf("2002") == 0);

    // A sala nasce dela com um re-INVITE sendrecv: a base passa a mandar, o mosaico dela.
    const int g1 = Guest(phone, "2003");
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(phone.registrar.WaitForPacketsOf("2002", 1, kColorSeconds));
    // O g1 recebe o mosaico dele: o fundo no lugar da nossa câmera e a base à direita.
    CHECK(phone.registrar.WaitForPacketsOf("2003", 1, kColorSeconds));
    CHECK(SeesColor(sink, g1, 0.75, 0.5, kOrange, kEchoTolerance));
    CHECK(SeesColor(sink, g1, 0.25, 0.5, kBackground, kEchoBackground));
    const int packets = phone.registrar.PacketsOf("2003");
    CHECK(phone.registrar.WaitForPacketsOf("2003", packets + 10, kColorSeconds));
}

TEST_CASE("a camera that leaves and comes back during the room keeps every guest's mosaic") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.CameraProblemsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowEcho(phone, "2002");
    ShowColor(phone, "2003", kPurple);
    const int base = VideoRoom(phone, 1)[0];
    const int roomId = phone.engine->Room().id;
    REQUIRE(SeesBars(sink, base, 0.5, 0.02, 0.48));
    REQUIRE(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));

    // A câmera em uso sai (as barras coloridas, que vêm antes dos dispositivos da sala na lista, e a releitura muda os
    // ids deles): o Disconnected, o fundo no quadro dela, e o g1 segue no mosaico da base.
    const std::vector<CameraProblem> disconnected{CameraProblem::Disconnected};
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    CHECK(WaitUntil([&] { return phone.listener.CameraProblems() == disconnected; }, kWaitSeconds));
    CHECK(SeesColor(sink, base, 0.25, 0.5, kBackground, kEchoBackground));
    CHECK(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));

    // Ela volta, agora no fim da lista, e o pedido de agora a liga de novo na sala.
    AddColorbar();
    phone.engine->RefreshVideoDevices();
    REQUIRE(phone.engine->SetCamera(roomId, true));
    CHECK(SeesBars(sink, base, 0.5, 0.02, 0.48));
    CHECK(SeesColor(sink, base, 0.75, 0.5, kPurple, kEchoTolerance));
    const int packets = phone.registrar.PacketsOf("2002");
    CHECK(phone.registrar.WaitForPacketsOf("2002", packets + 10, kColorSeconds));
}

TEST_CASE("a device refresh during the room re-attaches each guest to its own mosaic") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowEcho(phone, "2003");
    ShowEcho(phone, "2004");
    const std::vector<int> ids = VideoRoom(phone, 2);
    const std::vector<int> echoes{ids[1], ids[2]};
    const int roomId = phone.engine->Room().id;
    for (const int id : echoes) REQUIRE(SeesColor(sink, id, 0.75, 0.25, kOrange, kEchoTolerance));

    // Sem as barras coloridas, a releitura muda o id de cada dispositivo da sala (e a câmera em uso sai). Cada
    // convidado volta ao mosaico dele, agora com o fundo no lugar da nossa câmera: a base em cima, à direita.
    phone.listener.CountLog(kRoomRestart);
    RemoveColorbar();
    phone.engine->RefreshVideoDevices();
    CHECK(WaitUntil([&] { return phone.listener.LogCount(kRoomRestart) == 1; }, kWaitSeconds));
    for (const int id : echoes) {
        CAPTURE(id);
        CHECK(SeesColor(sink, id, 0.25, 0.25, kBackground, kEchoBackground));
        CHECK(SeesColor(sink, id, 0.75, 0.25, kOrange, kEchoTolerance));
    }
    // O mosaico de quem montou segue chegando, a 25 qps.
    CHECK(HostFramesFlow(sink, roomId));
}

TEST_CASE("a device refresh that moves no room device leaves every send and the host's mosaic running") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowEcho(phone, "2003");
    ShowEcho(phone, "2004");
    const std::vector<int> ids = VideoRoom(phone, 2);
    const std::vector<int> echoes{ids[1], ids[2]};
    const int roomId = phone.engine->Room().id;
    for (const int id : echoes) REQUIRE(SeesColor(sink, id, 0.75, 0.25, kOrange, kEchoTolerance));
    REQUIRE(HostFramesFlow(sink, roomId));

    // A mesma lista relida (no Windows, um fone que entra também relê a lista de vídeo): nenhum id da sala muda, e nada
    // da sala recomeça. Nenhum envio para no segundo seguinte (a passada que recomeça vem logo depois da releitura).
    phone.listener.CountLog(kRoomRestart);
    phone.listener.CountLog(kSendOff);
    phone.engine->RefreshVideoDevices();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(phone.listener.LogCount(kRoomRestart) == 0);
    CHECK(phone.listener.LogCount(kSendOff) == 0);
    // Cada convidado segue no mosaico dele, com a nossa câmera, e o mosaico de quem montou segue chegando.
    for (const int id : echoes) {
        CAPTURE(id);
        CHECK(SeesBars(sink, id, 0.25, 0.02, 0.48));
        CHECK(SeesColor(sink, id, 0.75, 0.25, kOrange, kEchoTolerance));
    }
    CHECK(HostFramesFlow(sink, roomId));
}

TEST_CASE("destroying the engine during a room hangs up every guest and no frame arrives after SetFrameSink(nullptr)") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.RoomsText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);
    phone.engine->SetVideoSettings(RoomSettings());
    ShowColor(phone, "2002", kOrange);
    ShowColor(phone, "2003", kPurple);
    ShowColor(phone, "2004", kTeal);
    VideoRoom(phone, 2);
    const int roomId = phone.engine->Room().id;
    REQUIRE(SeesColor(sink, roomId, 0.5, 0.75, kTeal, kHostTolerance));

    // O app fechando com a sala de pé (o Review Focus 5): o sink sai, e o motor acaba.
    phone.engine->SetFrameSink(nullptr);
    const Clock::time_point detached = Clock::now();
    phone.engine.reset();
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2004", kWaitSeconds));
    CHECK(sink.CountAll(detached) == 0);
}

TEST_CASE("the test camera shows up and no room device does") {
    Phone phone;
    const std::vector<VideoDevice> devices = phone.engine->VideoDevices();
    std::string names;
    for (const VideoDevice& device : devices) names += device.name + "; ";
    INFO(names);
    CHECK(std::any_of(devices.begin(), devices.end(),
                      [](const VideoDevice& device) { return device.name == "Colorbar generator"; }));
    CHECK(std::none_of(devices.begin(), devices.end(), [](const VideoDevice& device) {
        return device.name.find("Starsonic") != std::string::npos;
    }));
}

TEST_CASE("an image of odd size reaches a guest's mosaic without the bytes after its frame") {
    Phone phone;   // os dispositivos da sala e o desenhista: o motor os registra
    // A loja e o desenhista são um só no programa: no fim, a loja volta vazia e sem o tap.
    struct Restore {
        ~Restore() {
            SetRendererTap(nullptr);
            SetRoomPlan(RoomPlan());
        }
    } restore;
    const int source = 7;   // uma ligação que a tabela não conhece: o portão deixa o quadro sair
    RoomPlan plan;
    plan.seats[0] = {source};
    plan.live = {source};
    SetRoomPlan(plan);
    SetRendererTap(RoomFrameStore());

    // Um stream do desenhista em 175x99, como a pjsua cria o de uma ligação, e um quadro no I420 da pjmedia: o croma
    // com 87 colunas (w>>1) e cada plano dele com Y/4 bytes. Depois do quadro, bytes que não são dele.
    const int width = 175, height = 99;
    const pjmedia_vid_dev_index renderer = FindDevice("Starsonic", PJMEDIA_DIR_RENDER);
    REQUIRE(renderer != PJMEDIA_VID_INVALID_DEV);
    pjmedia_vid_dev_param param;
    REQUIRE(pjmedia_vid_dev_default_param(nullptr, renderer, &param) == PJ_SUCCESS);
    pjmedia_format_init_video(&param.fmt, PJMEDIA_FORMAT_I420, width, height, 25, 1);
    pjmedia_vid_dev_stream* stream = nullptr;
    REQUIRE(pjmedia_vid_dev_stream_create(&param, nullptr, nullptr, &stream) == PJ_SUCCESS);
    pjmedia_vid_dev_hwnd window;
    REQUIRE(pjmedia_vid_dev_stream_get_cap(stream, PJMEDIA_VID_DEV_CAP_OUTPUT_WINDOW, &window) == PJ_SUCCESS);
    BindRendererStream(window.info.window, source);
    REQUIRE(pjmedia_vid_dev_stream_start(stream) == PJ_SUCCESS);
    const size_t luma = static_cast<size_t>(width) * height;
    const size_t chroma = luma / 4;
    std::vector<pj_uint8_t> bytes(luma + 2 * chroma + 64, 0);
    std::fill_n(bytes.begin(), luma, pj_uint8_t{200});
    std::fill_n(bytes.begin() + luma, chroma, pj_uint8_t{60});
    std::fill_n(bytes.begin() + luma + chroma, chroma, pj_uint8_t{200});
    pjmedia_frame frame;
    pj_bzero(&frame, sizeof(frame));
    frame.type = PJMEDIA_FRAME_TYPE_VIDEO;
    frame.buf = bytes.data();
    frame.size = luma + 2 * chroma;
    CHECK(pjmedia_vid_dev_stream_put_frame(stream, &frame) == PJ_SUCCESS);
    pjmedia_vid_dev_stream_stop(stream);
    pjmedia_vid_dev_stream_destroy(stream);

    // O mosaico do lugar 1, em 320x240: no croma, só a cor da imagem e a do fundo, nada dos bytes de depois do quadro.
    const pjmedia_vid_dev_index seat = FindDevice("Starsonic sala 1", PJMEDIA_DIR_CAPTURE);
    REQUIRE(seat != PJMEDIA_VID_INVALID_DEV);
    REQUIRE(pjmedia_vid_dev_default_param(nullptr, seat, &param) == PJ_SUCCESS);
    pjmedia_format_init_video(&param.fmt, PJMEDIA_FORMAT_I420, 320, 240, 25, 1);
    REQUIRE(pjmedia_vid_dev_stream_create(&param, nullptr, nullptr, &stream) == PJ_SUCCESS);
    std::vector<pj_uint8_t> mosaic(320 * 240 * 3 / 2, 0);
    pjmedia_frame out;
    pj_bzero(&out, sizeof(out));
    out.buf = mosaic.data();
    out.size = mosaic.size();
    const pj_status_t got = pjmedia_vid_dev_stream_get_frame(stream, &out);
    pjmedia_vid_dev_stream_destroy(stream);
    REQUIRE(got == PJ_SUCCESS);
    const auto u = mosaic.begin() + 320 * 240;
    const auto v = u + 320 * 240 / 4;
    const std::set<int> uValues(u, v), vValues(v, mosaic.end());
    INFO("U: " << ValuesText(uValues) << "; V: " << ValuesText(vValues));
    CHECK(uValues == std::set<int>{60, kBackground.u});
    CHECK(vValues == std::set<int>{200, kBackground.v});
}

#else

TEST_CASE("the engine without video has no room") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.CallsText());

    phone_test::CheckNoRoom(phone);
}

#endif  // PJMEDIA_HAS_VIDEO
