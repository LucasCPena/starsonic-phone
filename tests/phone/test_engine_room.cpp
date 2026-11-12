// A sala de vídeo em grupo no motor do PJSIP, contra o registrador falso que faz de vários convidados: cada um com a
// imagem dele (VIDEO SOURCE), as contagens por convidado, o 180, o BYE e a espera. As ligações da sala (o nascimento,
// os convidados chamados e atendidos, a sala cheia, as recusas, as saídas e o fim), o som de todos com todos e o id da
// sala nos métodos de sempre. Com o PJSIP sem o vídeo (como o do Android), só o contrato do motor sem sala, o mesmo do
// motor do baresip (test_engine_baresip.cpp).
#include "call_fixture.h"

#include <pjmedia/config.h>

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
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::TestSink;
using phone_test::WaitUntil;

namespace {

using State = RoomMember::State;
using Members = std::vector<RoomMember>;

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

// Nenhuma linha do registro de ligações começa com prefix.
bool NoLogLine(Phone& phone, const std::string& prefix) {
    const Lines log = phone.registrar.Log();
    return std::none_of(log.begin(), log.end(), [&](const std::string& line) { return line.rfind(prefix, 0) == 0; });
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

    // A oferta do convidado leva o vídeo, e ninguém vai para a espera.
    CHECK(phone.registrar.WaitForLog("video-in 2003 H264,VP8", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 2002 sendonly") == 0);
    CHECK(phone.engine->CallCount() == 2);
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

    // Sem ligação.
    CHECK(phone.engine->RoomAdd("2003") == -1);
    // Numa ligação só de voz.
    const int voice = phone.Dial("2002");
    CHECK(phone.engine->RoomAdd("2003") == -1);
    end(voice);
    // Numa ligação com vídeo em espera.
    const int held = VideoCall(phone, "2002");
    REQUIRE(phone.engine->SetHold(held, true));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    CHECK(phone.engine->RoomAdd("2003") == -1);
    end(held);
    // Com uma segunda tocando.
    const int call = VideoCall(phone, "2002");
    const int ringing = phone.Ring();
    CHECK(phone.engine->RoomAdd("2003") == -1);
    REQUIRE(phone.engine->Reject(ringing));
    REQUIRE(phone.WaitState(ringing, CallState::Disconnected));
    // Com o número vazio.
    CHECK(phone.engine->RoomAdd("") == -1);
    // Com as escolhas sem codec, aplicadas depois da ligação.
    VideoSettings noCodec = RoomSettings();
    noCodec.h264 = false;
    noCodec.vp8 = false;
    noCodec.vp9 = false;
    phone.engine->SetVideoSettings(noCodec);
    CHECK(phone.engine->RoomAdd("2003") == -1);
    end(call);

    // Nenhum OnRoom, e o convidado nunca foi chamado.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.Rooms().empty());
    CHECK(phone.engine->Room() == RoomInfo());
    CHECK(NoLogLine(phone, "inv-in 2003"));
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

TEST_CASE("while the room is up a call that arrives is busy and MakeCall is refused") {
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

    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.listener.WaitForCalls(phone_test::RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    phone.listener.CountLog("recusada: a sala esta de pe");
    CHECK(phone.engine->MakeCall("2009") == -1);
    CHECK(phone.engine->MakeCall("2009", true) == -1);
    CHECK(phone.listener.LogCount("recusada: a sala esta de pe") == 2);

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->Room() == room);
    CHECK(phone.WaitLinks(base, {0, g1}));
    CHECK(NoLogLine(phone, "inv-in 2009"));
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

#else

TEST_CASE("the engine without video has no room") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.CallsText());

    phone_test::CheckNoRoom(phone);
}

#endif  // PJMEDIA_HAS_VIDEO
