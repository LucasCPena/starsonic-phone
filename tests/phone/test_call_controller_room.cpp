// A sala de vídeo em grupo no controlador (Task 7 da etapa 3a do vídeo): a sala como uma linha, com os convidados
// dentro, a ligação de fora em volta dela, os Recentes dos convidados e os avisos da sala (OnRoomEvent). O motor, o
// ouvinte, o relógio e os contatos são os falsos (fake_call_engine.h), como no test_call_controller.cpp, e os OnRoom
// são escritos aqui como o motor os avisa (SipEngine.h). A montagem: a ligação 1 chega, toca e é atendida, com o vídeo;
// a sala é a 30, e os convidados vêm a partir do 2 (Ruling M8: o nextCallId do motor falso).
#include "doctest/doctest.h"

#include <algorithm>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "CallController.h"
#include "CallMessages.h"
#include "Text.h"
#include "call_controller_helpers.h"
#include "fake_call_engine.h"

using namespace starsonic;
using phone_test::FakeCallEngine;
using phone_test::FakeCallListener;
using phone_test::FakeContactNames;
using phone_test::FakeTime;
using phone_test::Held;
using phone_test::MakeRecent;
using phone_test::One;
using phone_test::U8;
using phone_test::View;

namespace {

constexpr int kRoomId = 30;
constexpr RoomMember::State kCalling = RoomMember::State::Calling;
constexpr RoomMember::State kIn = RoomMember::State::In;

using Event = std::pair<RoomEvent, int>;
using Events = std::vector<Event>;
using Guests = std::vector<RoomMemberView>;
using Ints = std::vector<int>;
using Recents = std::vector<Recent>;
using Strings = std::vector<std::string>;

// O aviso de discar sem registro (os literais do C++ ficam em ASCII: build/check_source_text.py).
const std::wstring kNoConnection = L"Sem conex\u00e3o com o servidor. Tente de novo em instantes.";

RoomTile Tile(double x, double y, double width, double height) {
    RoomTile tile;
    tile.x = x;
    tile.y = y;
    tile.width = width;
    tile.height = height;
    return tile;
}

// Um convidado como o motor o avisa no OnRoom.
RoomMember Member(int callId, RoomMember::State state = kCalling, bool image = false, RoomTile tile = RoomTile()) {
    RoomMember member;
    member.callId = callId;
    member.state = state;
    member.image = image;
    member.tile = tile;
    return member;
}

// A sala 30 como o OnRoom a traz, com os convidados na ordem em que entraram.
RoomInfo Room(std::vector<RoomMember> members) {
    RoomInfo room;
    room.id = kRoomId;
    room.members = std::move(members);
    return room;
}

// A mesma sala com a nossa voz e a nossa câmera fora dela (a ligação de fora), com 5 convidados, ou no último OnRoom.
RoomInfo Out(RoomInfo room) {
    room.out = true;
    return room;
}

RoomInfo Full(RoomInfo room) {
    room.full = true;
    return room;
}

RoomInfo Ended(RoomInfo room) {
    room.ended = true;
    return room;
}

// Um convidado como a tela o vê (RoomView).
RoomMemberView Guest(int id, const std::string& number, const std::string& name, RoomMember::State state,
                     bool image = false, RoomTile tile = RoomTile()) {
    RoomMemberView guest;
    guest.id = id;
    guest.number = number;
    guest.name = name;
    guest.state = state;
    guest.image = image;
    guest.tile = tile;
    return guest;
}

// O vídeo de uma ligação com a imagem chegando e a nossa câmera mandando.
CallVideo Showing() {
    CallVideo video;
    video.active = true;
    video.remote = true;
    video.camera = true;
    return video;
}

// O controlador com os falsos, a ligação 1 em vídeo e os contatos do 2003 e do 2004. A regra dos contatos é a do
// DialContact (o ddi 55 e o prefixo 0); registered é o que o predicado do registro devolve.
struct RoomFixture {
    FakeCallEngine engine;
    FakeCallListener listener;
    FakeTime time;
    FakeContactNames contacts;
    bool registered = true;
    CallController calls{engine,
                         listener,
                         time,
                         time,
                         contacts,
                         [](std::string raw) { return WideToUtf8(ContactDialString(Utf8ToWide(raw), L"55", L"0")); },
                         [this] { return registered; }};
    const int64_t start = time.NowMs();   // quando a ligação 1 chegou
    int64_t answeredAt = 0;               // quando ela foi atendida (o activeSinceMs dela e o da sala)

    RoomFixture() {
        engine.nextCallId = 2;   // os convidados, a partir do 2 (a sala é a 30)
        contacts.names["2003"] = "Maria Silva";
        contacts.names["2004"] = "Carlos Lima";
        calls.OnIncomingCall(1, "3001", "Cliente Teste");
        calls.OnCallState(1, CallState::Early, 180);
        time.Advance(2000);
        calls.Answer(true);
        calls.OnCallState(1, CallState::Connecting, 200);
        calls.OnCallState(1, CallState::Confirmed, 200);
        answeredAt = time.NowMs();
        calls.OnCallVideo(1, Showing());
        // O Atender da ligação 1 é da montagem: os pedidos ao motor que os testes olham começam vazios.
        engine.answers.clear();
        engine.answersVideo.clear();
        time.Advance(10000);
    }

    // A sala nasce da ligação 1 com o 2003 (o convidado 2), que o motor ainda chama.
    void StartRoom() {
        REQUIRE(calls.RoomAdd("2003"));
        calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    }

    // A ligação de fora (a 5) chega, toca e é atendida: ela tira você da sala, que tem members.
    void TakeOutsideCall(std::vector<RoomMember> members) {
        calls.OnIncomingCall(5, "3005", "Fulano");
        calls.OnCallState(5, CallState::Early, 180);
        calls.Answer();
        calls.OnCallState(5, CallState::Confirmed, 200);
        calls.OnRoom(Out(Room(std::move(members))));
    }

    // A linha da sala na tela: o id dela, o número e o nome vazios, o activeSinceMs da ligação 1 e o vídeo da sala,
    // ativo desde o nascimento (até o OnCallVideo do id dela).
    CallView RoomLine() const {
        CallView line = View(kRoomId, "", "", false, CallView::Active, answeredAt);
        line.video.active = true;
        return line;
    }

    CallSnapshot State() const { return listener.State(); }
    std::optional<CallView> Top() const { return listener.State().top; }
    std::string Message() const { return listener.State().endMessage; }
};

}  // namespace

TEST_CASE_FIXTURE(RoomFixture, "RoomAdd asks the engine and the room line takes the call's place") {
    REQUIRE(calls.RoomAdd("2003"));
    CHECK(engine.roomAdds == Strings{"2003"});
    CHECK_MESSAGE(Top()->id == 1, "ate o OnRoom, a ligacao 1 segue sozinha");
    CHECK_FALSE(State().room.has_value());
    calls.OnRoom(Room({Member(1, kIn, true, Tile(0, 0.25, 0.5, 0.5)),
                       Member(2, kCalling, false, Tile(0.5, 0.25, 0.5, 0.5))}));
    CHECK(Top() == RoomLine());
    CHECK_FALSE(State().second.has_value());
    REQUIRE(State().room.has_value());
    CHECK(State().room->id == kRoomId);
    CHECK(State().room->members == Guests{Guest(1, "3001", "Cliente Teste", kIn, true, Tile(0, 0.25, 0.5, 0.5)),
                                          Guest(2, "2003", "Maria Silva", kCalling, false, Tile(0.5, 0.25, 0.5, 0.5))});
    CHECK_FALSE(State().room->out);
    CHECK_FALSE(State().room->full);
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}});
    CHECK(listener.recents.empty());
}

TEST_CASE_FIXTURE(RoomFixture, "RoomAdd needs a lone active video call or the room on top") {
    CHECK_FALSE(calls.RoomAdd(""));
    CHECK_FALSE(calls.RoomAdd("   "));
    CHECK_FALSE_MESSAGE(calls.RoomAdd("-()."), "sem nada depois de tirar os separadores");
    // Uma ligação só de voz.
    calls.OnCallVideo(1, CallVideo());
    CHECK_FALSE(calls.RoomAdd("2003"));
    calls.OnCallVideo(1, Showing());
    // Em espera.
    calls.Hold(true);
    CHECK_FALSE(calls.RoomAdd("2003"));
    calls.Hold(false);
    // Com uma transferência esperando o resultado.
    REQUIRE(calls.Transfer("2009"));
    CHECK_FALSE(calls.RoomAdd("2003"));
    calls.OnTransfer(1, 603);
    // Com duas: a segunda tocando.
    calls.OnIncomingCall(5, "3005", "Fulano");
    CHECK_FALSE(calls.RoomAdd("2003"));
    calls.Reject();
    calls.OnCallState(5, CallState::Disconnected, 486);
    CHECK(engine.roomAdds.empty());
    // A ligação 1 sozinha, em vídeo e fora da espera: a sala nasce.
    REQUIRE(calls.RoomAdd("2003"));
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    // Com a sala cheia.
    calls.OnRoom(Full(Room({Member(1, kIn), Member(2)})));
    CHECK_FALSE(calls.RoomAdd("2004"));
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    // Fora da sala: a ligação de fora atendida.
    calls.OnIncomingCall(6, "3006", "");
    calls.Answer();
    calls.OnCallState(6, CallState::Confirmed, 200);
    calls.OnRoom(Out(Room({Member(1, kIn), Member(2)})));
    CHECK_FALSE(calls.RoomAdd("2004"));
    CHECK(engine.roomAdds == Strings{"2003"});
    // De volta à sala, sem registro: o aviso, e nada vai ao motor.
    calls.RoomReturn();
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    registered = false;
    CHECK_FALSE(calls.RoomAdd("2004"));
    CHECK(Message() == U8(kNoConnection));
    CHECK(engine.roomAdds == Strings{"2003"});
    // Com o registro, a sala em cima recebe mais um.
    registered = true;
    CHECK(calls.RoomAdd("2004"));
    CHECK(engine.roomAdds == Strings{"2003", "2004"});
}

TEST_CASE_FIXTURE(RoomFixture, "a second RoomAdd waits until the first guest is in the room") {
    REQUIRE(calls.RoomAdd("2003"));   // o motor deu o 2, e o OnRoom que o traz ainda não chegou
    CHECK_FALSE(calls.RoomAdd("2004"));
    CHECK(engine.roomAdds == Strings{"2003"});
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    REQUIRE(calls.RoomAdd("2004"));
    calls.OnRoom(Room({Member(1, kIn), Member(2), Member(3)}));
    CHECK(engine.roomAdds == Strings{"2003", "2004"});
    REQUIRE(State().room.has_value());
    CHECK(State().room->members == Guests{Guest(1, "3001", "Cliente Teste", kIn),
                                          Guest(2, "2003", "Maria Silva", kCalling),
                                          Guest(3, "2004", "Carlos Lima", kCalling)});
}

TEST_CASE_FIXTURE(RoomFixture, "RoomAdd waits until the engine has us back in the room") {
    StartRoom();
    TakeOutsideCall({Member(1, kIn), Member(2)});
    // A de fora acaba: a sala volta aqui na hora (o Activate), mas o motor nos tem fora até o OnRoom dele.
    calls.OnCallState(5, CallState::Disconnected, 200);
    REQUIRE(engine.activated == Ints{kRoomId});
    REQUIRE(Top() == RoomLine());
    engine.refuseRoom = true;   // como o motor, que dá -1 com você fora da sala (SipEngine.h): ele nem é chamado
    CHECK_FALSE(calls.RoomAdd("2004"));
    CHECK(engine.roomAdds == Strings{"2003"});
    CHECK_MESSAGE(listener.recents.size() == 1, "so o Recente da ligacao de fora: nada de uma feita que nao tocou");
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}, {RoomEvent::Out, 0}});
    engine.refuseRoom = false;
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    CHECK(calls.RoomAdd("2004"));
    CHECK(engine.roomAdds == Strings{"2003", "2004"});
}

TEST_CASE_FIXTURE(RoomFixture, "a guest answering, leaving and failing") {
    const int64_t added = time.NowMs();
    StartRoom();
    time.Advance(1000);
    REQUIRE(calls.RoomAdd("2004"));   // o convidado 3
    calls.OnRoom(Room({Member(1, kIn), Member(2), Member(3)}));
    time.Advance(2000);
    calls.OnCallState(2, CallState::Early, 180);
    calls.OnCallState(2, CallState::Confirmed, 200);
    CHECK(listener.roomEvents.back() == Event{RoomEvent::Entered, 2});
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn, true), Member(3)}));
    REQUIRE(State().room.has_value());
    CHECK(State().room->members[1] == Guest(2, "2003", "Maria Silva", kIn, true));
    // O 2003 sai do outro lado: os Recentes dele, e a sala segue com quem ficou.
    time.Advance(20000);
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(listener.recents == Recents{MakeRecent("2003", "", Recent::Outgoing, added, 20000)});
    CHECK(listener.roomEvents.back() == Event{RoomEvent::Left, 1});
    CHECK(Message() == "");
    CHECK(State().room->members ==
          Guests{Guest(1, "3001", "Cliente Teste", kIn), Guest(3, "2004", "Carlos Lima", kCalling)});
    calls.OnRoom(Room({Member(1, kIn), Member(3)}));
    // O 2004 está ocupado: o aviso com o nome dele, por 2 s.
    calls.OnCallState(3, CallState::Disconnected, 486);
    CHECK(Message() == "Carlos Lima: Ocupado");
    CHECK(listener.recents.back() == MakeRecent("2004", "", Recent::Outgoing, added + 1000, 0));
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0},
                                        {RoomEvent::Entered, 2},
                                        {RoomEvent::Left, 1},
                                        {RoomEvent::Failed, 486}});
    CHECK(Top()->id == kRoomId);
    time.Advance(2000);
    CHECK(Message() == "");
}

TEST_CASE_FIXTURE(RoomFixture, "removing a guest still being called shows no failure") {
    StartRoom();
    calls.OnCallState(2, CallState::Confirmed, 200);
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn)}));
    const int64_t added = time.NowMs();
    REQUIRE(calls.RoomAdd("2004"));   // o convidado 3
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn), Member(3)}));
    calls.Hangup(3);   // um convidado não é uma linha: nada
    CHECK(engine.hangups.empty());
    calls.RoomRemove(3);
    CHECK(engine.hangups == Ints{3});
    calls.RoomRemove(3);    // já saindo: nada
    calls.RoomRemove(99);   // nenhum: nada
    CHECK(engine.hangups == Ints{3});
    calls.OnCallState(3, CallState::Disconnected, 487);
    CHECK(listener.roomEvents.back() == Event{RoomEvent::Left, 2});
    CHECK(Message() == "");
    CHECK(time.Pending() == 0);
    CHECK(listener.recents == Recents{MakeRecent("2004", "", Recent::Outgoing, added, 0)});
    CHECK(Top() == RoomLine());
    CHECK(State().room->members ==
          Guests{Guest(1, "3001", "Cliente Teste", kIn), Guest(2, "2003", "Maria Silva", kIn)});
}

TEST_CASE_FIXTURE(RoomFixture, "the room ending with one guest gives back a normal call") {
    const int64_t added = time.NowMs();
    StartRoom();
    time.Advance(1000);
    REQUIRE(calls.RoomAdd("2004"));   // o convidado 3
    calls.OnRoom(Room({Member(1, kIn), Member(2), Member(3)}));
    time.Advance(2000);
    calls.OnCallState(3, CallState::Confirmed, 200);
    const int64_t since = time.NowMs();
    CallVideo video3;
    video3.active = true;
    video3.remote = true;
    calls.OnCallVideo(3, video3);   // o vídeo do convidado fica com ele
    calls.OnRoom(Room({Member(1, kIn), Member(2), Member(3, kIn)}));
    calls.OnCallState(2, CallState::Disconnected, 480);
    calls.OnRoom(Room({Member(1, kIn), Member(3, kIn)}));
    time.Advance(5000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Room({Member(3, kIn)})));
    CallView stayed = View(3, "2004", "Carlos Lima", false, CallView::Active, since);
    stayed.video = video3;
    CHECK(Top() == stayed);
    CHECK_FALSE(State().second.has_value());
    CHECK_FALSE(State().room.has_value());
    CHECK(listener.roomEvents.back() == Event{RoomEvent::Ended, 0});
    // Uma ligação comum de novo: o Desligar é dela, e o fim dela entra nos Recentes como sempre.
    time.Advance(4000);
    calls.Hangup();
    CHECK(engine.hangups == Ints{3});
    calls.OnCallState(3, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents ==
          Recents{MakeRecent("2003", "", Recent::Outgoing, added, 0),
                  MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, added + 8000 - answeredAt),
                  MakeRecent("2004", "", Recent::Outgoing, added + 1000, 9000)});
}

TEST_CASE_FIXTURE(RoomFixture, "the call the room hands back while we are out waits on hold") {
    StartRoom();
    calls.OnCallState(2, CallState::Confirmed, 200);
    const int64_t since2 = time.NowMs();
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn)}));
    TakeOutsideCall({Member(1, kIn), Member(2, kIn)});
    const int64_t since5 = time.NowMs();
    time.Advance(5000);
    // A ligação 1 sai do outro lado, e o motor acaba a sala com o 2003, fora do nosso som: ele não é a ativa.
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Out(Room({Member(2, kIn)}))));
    const CallView stayed = View(2, "2003", "Maria Silva", false, CallView::Active, since2);
    CHECK(Top() == View(5, "3005", "Fulano", true, CallView::Active, since5));
    CHECK(State().second == Held(stayed));
    CHECK(State().secondKind == CallSnapshot::Held);
    CHECK_FALSE(State().room.has_value());
    CHECK(engine.activated.empty());
    // A de fora acaba: o 2003 volta sozinho, como a outra de duas ligações.
    calls.OnCallState(5, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{2});
    CHECK(State() == One(stayed));
}

TEST_CASE_FIXTURE(RoomFixture, "salaEncerrar and the hang up of the room line end every guest") {
    const int64_t added = time.NowMs();
    StartRoom();
    SUBCASE("salaEncerrar") { calls.RoomEnd(); }
    SUBCASE("Desligar with the room on top") { calls.Hangup(); }
    CHECK(engine.hangups == Ints{kRoomId});
    CHECK_MESSAGE(!Top().has_value(), "a tela sai na hora");
    CHECK_FALSE(State().room.has_value());
    calls.RoomEnd();   // já saindo: nada
    calls.Hangup();
    calls.Hangup(kRoomId);
    CHECK(engine.hangups == Ints{kRoomId});
    // O motor desliga cada convidado (o 2003 ainda era chamado), e a sala acaba sem ninguém.
    time.Advance(5000);
    calls.OnCallState(2, CallState::Disconnected, 487);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Room({})));
    CHECK(Message() == "");
    CHECK(time.Pending() == 0);
    CHECK(listener.recents ==
          Recents{MakeRecent("2003", "", Recent::Outgoing, added, 0),
                  MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, added + 5000 - answeredAt)});
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0},
                                        {RoomEvent::Left, 1},
                                        {RoomEvent::Left, 0},
                                        {RoomEvent::Ended, 0}});
    CHECK(State() == CallSnapshot());
    CHECK_FALSE(calls.HasCalls());
    CHECK(engine.activated.empty());
}

TEST_CASE_FIXTURE(RoomFixture, "the outside call comes back by itself when the active room ends with nobody") {
    StartRoom();
    TakeOutsideCall({Member(1, kIn), Member(2)});
    const CallView outside = View(5, "3005", "Fulano", true, CallView::Active, time.NowMs());
    calls.RoomReturn();   // a sala em cima, e a de fora em espera embaixo
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    calls.RoomEnd();
    CHECK(engine.hangups == Ints{kRoomId});
    CHECK_MESSAGE(State() == One(Held(outside)), "ate o fim da sala, a de fora segue em espera");
    calls.OnCallState(2, CallState::Disconnected, 487);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Room({})));
    CHECK(engine.activated == Ints{kRoomId, 5});
    CHECK(State() == One(outside));
}

TEST_CASE_FIXTURE(RoomFixture, "the outside call rings as the second line and answering takes us out") {
    StartRoom();
    calls.OnIncomingCall(5, "3005", "Fulano");
    calls.OnCallState(5, CallState::Early, 180);
    CHECK(Top() == RoomLine());
    CHECK(State().second == View(5, "3005", "Fulano", true, CallView::Ringing));
    CHECK(State().secondKind == CallSnapshot::Ringing);
    CHECK(listener.Ring() == RingKind::Waiting);
    CHECK(engine.rejects.empty());
    calls.Answer(true);
    CHECK(engine.answers == Ints{5});
    CHECK(engine.answersVideo == std::vector<bool>{false});
    CHECK(Top() == View(5, "3005", "Fulano", true, CallView::Active));
    CHECK(State().second == Held(RoomLine()));
    CHECK(State().secondKind == CallSnapshot::Held);
    CHECK_MESSAGE(State().room.has_value(), "a sala segue de pe, como a outra linha");
    calls.OnCallState(5, CallState::Confirmed, 200);
    calls.OnRoom(Out(Room({Member(1, kIn), Member(2)})));
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}, {RoomEvent::Out, 0}});
    REQUIRE(State().room.has_value());
    CHECK(State().room->out);
}

TEST_CASE_FIXTURE(RoomFixture, "returning to the room puts the outside call on hold") {
    StartRoom();
    TakeOutsideCall({Member(1, kIn), Member(2)});
    const int64_t since = time.NowMs();
    calls.RoomReturn();
    CHECK(engine.activated == Ints{kRoomId});
    CHECK(Top() == RoomLine());
    CHECK(State().second == View(5, "3005", "Fulano", true, CallView::Active, since, true));
    CHECK(State().secondKind == CallSnapshot::Held);
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    CHECK(listener.roomEvents.back() == Event{RoomEvent::Back, 0});
    CHECK_FALSE(State().room->out);
    calls.RoomReturn();   // já na sala: nada
    CHECK(engine.activated == Ints{kRoomId});
}

TEST_CASE_FIXTURE(RoomFixture, "returning to the room without the outside call is just the Activate") {
    StartRoom();
    SUBCASE("the outside call on its way out") {
        TakeOutsideCall({Member(1, kIn), Member(2)});
        calls.Hangup();   // a de fora sai: até o fim dela, a sala fica embaixo, em espera
        CHECK(engine.hangups == Ints{5});
        CHECK(Top() == Held(RoomLine()));
        calls.RoomReturn();
        CHECK(engine.activated == Ints{kRoomId});
        CHECK(Top() == RoomLine());
        calls.OnCallState(5, CallState::Disconnected, 200);
        CHECK_MESSAGE(engine.activated == Ints{kRoomId}, "a sala ja estava de volta");
    }
    SUBCASE("the engine still has us out of the room") {
        calls.OnRoom(Out(Room({Member(1, kIn), Member(2)})));
        calls.RoomReturn();
        CHECK(engine.activated == Ints{kRoomId});
        CHECK(Top() == RoomLine());
    }
    CHECK_FALSE(State().second.has_value());
}

TEST_CASE_FIXTURE(RoomFixture, "returning to the room while the outside call still rings cancels it") {
    StartRoom();
    const int64_t dialed = time.NowMs();
    REQUIRE(calls.Dial("2009"));
    const int id = engine.nextCallId - 1;
    calls.OnCallState(id, CallState::Early, 180);
    calls.OnRoom(Out(Room({Member(1, kIn), Member(2)})));   // a feita tira você da sala
    REQUIRE(State().second == Held(RoomLine()));
    // Ela ainda chama: uma ligação chamando não vai para a espera (o motor a ligaria depois, sem o som). O Voltar a
    // desliga, como o Desligar dela, e a sala volta para cima.
    time.Advance(3000);
    calls.RoomReturn();
    CHECK(engine.hangups == Ints{id});
    CHECK(engine.activated == Ints{kRoomId});
    CHECK(engine.holds.empty());
    CHECK(Top() == RoomLine());
    CHECK_FALSE(State().second.has_value());
    // O fim dela: o Recente de uma feita que não completou, sem aviso, e nada volta sozinho (a sala já voltou).
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(listener.recents == Recents{MakeRecent("2009", "", Recent::Outgoing, dialed, 0)});
    CHECK(Message() == "");
    CHECK(time.Pending() == 0);
    CHECK(engine.activated == Ints{kRoomId});
    CHECK(Top() == RoomLine());
    // O motor nos tem de volta na sala.
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}, {RoomEvent::Out, 0}, {RoomEvent::Back, 0}});
    REQUIRE(State().room.has_value());
    CHECK_FALSE(State().room->out);
}

TEST_CASE_FIXTURE(RoomFixture, "the outside call ending brings us back to the room") {
    StartRoom();
    const int64_t rang = time.NowMs();
    TakeOutsideCall({Member(1, kIn), Member(2)});
    time.Advance(30000);
    calls.OnCallState(5, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{kRoomId});
    CHECK(Top() == RoomLine());
    CHECK_FALSE(State().second.has_value());
    CHECK(Message() == "");
    CHECK(listener.recents == Recents{MakeRecent("3005", "Fulano", Recent::Incoming, rang, 30000)});
}

TEST_CASE_FIXTURE(RoomFixture, "the room ending while we are out leaves the outside call alone and quiet") {
    const int64_t added = time.NowMs();
    StartRoom();
    calls.OnCallState(2, CallState::Confirmed, 200);
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn)}));
    TakeOutsideCall({Member(1, kIn), Member(2, kIn)});
    const int64_t since = time.NowMs();
    time.Advance(10000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnCallState(2, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Out(Room({}))));
    CHECK(State() == One(View(5, "3005", "Fulano", true, CallView::Active, since)));
    CHECK(engine.activated.empty());
    CHECK(time.Pending() == 0);
    CHECK(listener.recents ==
          Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, added + 10000 - answeredAt),
                  MakeRecent("2003", "", Recent::Outgoing, added, 10000)});
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0},
                                        {RoomEvent::Entered, 2},
                                        {RoomEvent::Out, 0},
                                        {RoomEvent::Left, 1},
                                        {RoomEvent::Left, 0},
                                        {RoomEvent::Ended, 0}});
}

TEST_CASE_FIXTURE(RoomFixture, "a third call is busy during the room") {
    StartRoom();
    calls.OnIncomingCall(5, "3005", "Fulano");
    calls.OnCallState(5, CallState::Early, 180);
    calls.OnIncomingCall(6, "3006", "");
    CHECK(engine.rejects == Ints{6});
    CHECK(listener.recents == Recents{MakeRecent("3006", "", Recent::Missed, time.NowMs(), 0)});
    CHECK(listener.missed == Strings{U8(L"Liga\u00e7\u00e3o perdida de ") + "3006"});
    calls.OnCallState(6, CallState::Disconnected, 486);   // o fim da recusada não mexe em nada
    CHECK(Top() == RoomLine());
    CHECK(State().second == View(5, "3005", "Fulano", true, CallView::Ringing));
    CHECK(listener.Ring() == RingKind::Waiting);
}

TEST_CASE_FIXTURE(RoomFixture, "Dial during the room is the outside call, voice only") {
    StartRoom();
    REQUIRE(calls.Dial("2009", true));
    CHECK(engine.made == Strings{"2009"});
    CHECK(engine.madeVideo == std::vector<bool>{false});
    const int id = engine.nextCallId - 1;
    CHECK(Top() == View(id, "2009", "", false, CallView::Dialing));
    CHECK(State().second == Held(RoomLine()));
    CHECK(State().secondKind == CallSnapshot::Held);
    // Só com a voz: um 488 dela não disca de novo, e o fim dela traz você de volta à sala.
    calls.OnCallState(id, CallState::Disconnected, 488);
    CHECK(engine.made.size() == 1);
    CHECK(listener.videoRefused == 0);
    CHECK(engine.activated == Ints{kRoomId});
    CHECK(Top() == RoomLine());
}

TEST_CASE_FIXTURE(RoomFixture, "an OnRoom's room and guest ids are never taken for the outside call being dialed") {
    StartRoom();
    // A ligação de fora sai, e chega, antes de o MakeCall voltar, o evento de um id abaixo de um que o OnRoom trouxe:
    // ele não é de uma ligação nova (não é dela).
    SUBCASE("below the room id") {
        engine.duringMakeCall = [this](int) { calls.OnCallState(20, CallState::Calling, 0); };
    }
    SUBCASE("below a guest id") {
        calls.OnRoom(Room({Member(1, kIn), Member(2), Member(45)}));   // um convidado que nenhum RoomAdd espera
        engine.duringMakeCall = [this](int) { calls.OnCallState(40, CallState::Calling, 0); };
    }
    REQUIRE(calls.Dial("2009"));
    CHECK(engine.hangups.empty());
    CHECK(Top() == View(3, "2009", "", false, CallView::Dialing));
}

TEST_CASE_FIXTURE(RoomFixture, "Hold, Transfer, Consult, Join and Dtmf do nothing on the room") {
    StartRoom();
    const CallSnapshot alone = State();
    calls.Hold(true);
    calls.Hold(std::nullopt);
    CHECK_FALSE(calls.Transfer("2009"));
    CHECK_FALSE(calls.Consult("2009"));
    calls.Dtmf("1");
    calls.Join();
    calls.Split();
    CHECK(State() == alone);
    // Com a ligação de fora em espera embaixo da sala: nem Juntar nem Separar, e nada na sala de cima.
    TakeOutsideCall({Member(1, kIn), Member(2)});
    calls.RoomReturn();
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    const CallSnapshot both = State();
    REQUIRE(both.second.has_value());
    calls.Join();
    calls.Split();
    calls.Hold(true);
    CHECK_FALSE(calls.Transfer("2009"));
    calls.Dtmf("1");
    CHECK(State() == both);
    CHECK(engine.holds.empty());
    CHECK(engine.transfers.empty());
    CHECK(engine.made.empty());
    CHECK(engine.dtmfs.empty());
    CHECK(engine.joined.empty());
    CHECK(engine.split.empty());
    CHECK(engine.activated == Ints{kRoomId});
}

TEST_CASE_FIXTURE(RoomFixture, "logging out ends the room with every guest in the Recents") {
    const int64_t added = time.NowMs();
    StartRoom();
    time.Advance(1000);
    calls.OnCallState(2, CallState::Confirmed, 200);
    calls.OnRoom(Room({Member(1, kIn), Member(2, kIn)}));
    time.Advance(5000);
    calls.OnLogout();
    CHECK(engine.hangups == Ints{kRoomId});
    CHECK(State() == CallSnapshot());
    CHECK(listener.recents ==
          Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, added + 6000 - answeredAt),
                  MakeRecent("2003", "", Recent::Outgoing, added, 5000)});
    CHECK(listener.missed.empty());
    CHECK_MESSAGE((listener.roomEvents.back() == Event{RoomEvent::Ended, 0}), "o Started ganha o par dele");
    // Os fins que chegam depois são ignorados, sem avisos.
    calls.OnCallState(2, CallState::Disconnected, 200);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRoom(Ended(Room({})));
    CHECK(listener.recents.size() == 2);
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}, {RoomEvent::Entered, 2}, {RoomEvent::Ended, 0}});
    CHECK(Message() == "");
    CHECK_FALSE(calls.HasCalls());
    CHECK(engine.hangups == Ints{kRoomId});
}

TEST_CASE_FIXTURE(RoomFixture, "the room line carries the room video and the camera goes to the room") {
    StartRoom();
    const CallVideo video = Showing();
    calls.OnCallVideo(kRoomId, video);
    CHECK(Top()->video == video);
    calls.Camera(false);
    CHECK(engine.cameras == std::vector<std::pair<int, bool>>{{kRoomId, false}});
    // O vídeo de um convidado fica com ele, sem o aviso da recusa: a linha da sala segue com o da sala.
    CallVideo refused;
    refused.refused = true;
    calls.OnCallVideo(2, refused);
    CHECK(listener.videoRefused == 0);
    CHECK(Top()->video == video);
}

TEST_CASE_FIXTURE(RoomFixture, "the first state with the room already has the room video active") {
    // O OnCallVideo do id da sala vem logo atrás do primeiro OnRoom: até ele, o cartão da sala não fica sem o vídeo.
    StartRoom();
    const auto first = std::find_if(listener.snapshots.begin(), listener.snapshots.end(),
                                    [](const CallSnapshot& snapshot) { return snapshot.room.has_value(); });
    REQUIRE(first != listener.snapshots.end());
    REQUIRE(first->top.has_value());
    CHECK(*first->top == RoomLine());
    CHECK(first->top->video.active);
}

// As regras do RoomAdd que os testes acima não pegam: o -1 do motor, o OnRoom antes de ele voltar (e o id dele, que
// vale mais), a regra dos contatos e o Sair no meio dele; e quem a sala devolve depois do Encerrar ou do Tirar.

TEST_CASE_FIXTURE(RoomFixture, "a RoomAdd the engine refuses goes to the Recents and fails without a message") {
    const int64_t added = time.NowMs();
    engine.refuseRoom = true;
    CHECK_MESSAGE(calls.RoomAdd("20-03"), "o motor foi chamado, com o numero sem os separadores");
    CHECK(engine.roomAdds == Strings{"2003"});
    CHECK(listener.recents == Recents{MakeRecent("2003", "", Recent::Outgoing, added, 0)});
    CHECK(listener.roomEvents == Events{{RoomEvent::Failed, 0}});
    CallView first = View(1, "3001", "Cliente Teste", true, CallView::Active, answeredAt);
    first.video = Showing();
    CHECK_MESSAGE(State() == One(first), "a ligacao 1 segue sozinha, sem sala");
    // O pedido vale de novo.
    engine.refuseRoom = false;
    CHECK(calls.RoomAdd("2003"));
    CHECK(engine.roomAdds == Strings{"2003", "2003"});
}

TEST_CASE_FIXTURE(RoomFixture, "the OnRoom that brings the guest may come before RoomAdd returns") {
    // O motor avisa a sala com o convidado novo antes de o RoomAdd voltar: ele adota o primeiro id desconhecido.
    std::optional<RoomView> seen;
    engine.duringRoomAdd = [this, &seen](int id) {
        calls.OnRoom(Room({Member(1, kIn), Member(id)}));
        seen = State().room;
    };
    REQUIRE(calls.RoomAdd("2003"));
    REQUIRE(seen.has_value());
    CHECK(seen->members == Guests{Guest(1, "3001", "Cliente Teste", kIn), Guest(2, "2003", "Maria Silva", kCalling)});
    CHECK(State().room == seen);
    CHECK(Top() == RoomLine());
    calls.OnCallState(2, CallState::Confirmed, 200);
    CHECK(listener.roomEvents == Events{{RoomEvent::Started, 0}, {RoomEvent::Entered, 2}});
    // Um OnRoom com outro id antes de o RoomAdd voltar: o id do RoomAdd vale mais, e a ligação do outro sai.
    engine.duringRoomAdd = [this](int) { calls.OnRoom(Room({Member(1, kIn), Member(2, kIn), Member(9)})); };
    REQUIRE(calls.RoomAdd("2004"));   // o motor deu o 3
    CHECK(engine.hangups == Ints{9});
    REQUIRE(State().room.has_value());
    REQUIRE(State().room->members.size() == 3);
    CHECK(State().room->members[2].id == 3);
    CHECK(State().room->members[2].number == "2004");
    CHECK(engine.hangups == Ints{9});
}

TEST_CASE_FIXTURE(RoomFixture, "RoomAddContact takes the number through the contact rule, like DialContact") {
    CHECK(calls.RoomAddContact("+55 11 98765-4321"));
    CHECK(engine.roomAdds == Strings{"011987654321"});
    calls.OnRoom(Room({Member(1, kIn), Member(2)}));
    CHECK_FALSE_MESSAGE(calls.RoomAddContact(" - "), "a regra nao deu numero");
    CHECK(engine.roomAdds.size() == 1);
}

TEST_CASE_FIXTURE(RoomFixture, "a call the room hands back after salaEncerrar or salaTirar leaves too") {
    SUBCASE("salaEncerrar crossing the end the engine gave the room on its own") {
        StartRoom();
        calls.RoomEnd();
        // O motor já tinha acabado a sala (o 2003 recusou) e devolve a ligação 1: o Hangup do id da sala não a acha.
        calls.OnCallState(2, CallState::Disconnected, 486);
        calls.OnRoom(Ended(Room({Member(1, kIn)})));
        CHECK(engine.hangups == Ints{kRoomId, 1});
        CHECK_FALSE(Top().has_value());
        calls.OnCallState(1, CallState::Disconnected, 200);
    }
    SUBCASE("salaTirar of the guest the room hands back") {
        StartRoom();
        calls.OnCallState(2, CallState::Confirmed, 200);
        calls.OnRoom(Room({Member(1, kIn), Member(2, kIn)}));
        calls.RoomRemove(2);
        // A ligação 1 sai do outro lado antes do fim do 2003, e a sala devolve o 2003, que já está saindo.
        calls.OnCallState(1, CallState::Disconnected, 200);
        calls.OnRoom(Ended(Room({Member(2, kIn)})));
        CHECK(engine.hangups == Ints{2});
        CHECK_FALSE(Top().has_value());
        calls.OnCallState(2, CallState::Disconnected, 200);
    }
    CHECK(Message() == "");
    CHECK_FALSE(calls.HasCalls());
    CHECK(listener.recents.size() == 2);
}

TEST_CASE_FIXTURE(RoomFixture, "logging out while RoomAdd is on the way hangs up the guest it returns") {
    const int64_t added = time.NowMs();
    engine.duringRoomAdd = [this](int) { calls.OnLogout(); };
    REQUIRE(calls.RoomAdd("2003"));
    CHECK_MESSAGE((engine.hangups == Ints{1, 2}), "a ligacao 1 e o convidado que ficou no motor");
    CHECK(State() == CallSnapshot());
    CHECK(listener.recents ==
          Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, added - answeredAt),
                  MakeRecent("2003", "", Recent::Outgoing, added, 0)});
    CHECK(listener.roomEvents.empty());
    CHECK_FALSE(calls.HasCalls());
}
