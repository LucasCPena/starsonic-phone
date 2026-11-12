// A sala de video em grupo no nucleo do app de PC (Task 8 da etapa 3a do video): os quatro pedidos da ponte
// (salaAdicionar, salaTirar, salaEncerrar e salaVoltar), o ligacao.sala do estado, as linhas "sala:" do diagnostico, o
// aviso do convidado que nao entra e o modo iPhone. O Harness e os falsos ficam no desktop_fixture.h; os OnRoom sao
// escritos aqui como o motor os avisa (SipEngine.h). A montagem: a ligacao 11 do 2002 em video, a sala 30 e os
// convidados a partir do 31 (Ruling M8: o nextCallId do motor falso).
#include <string>
#include <utility>
#include <vector>

#include "desktop_fixture.h"

using namespace starsonic;
using nlohmann::json;
using nlohmann::ordered_json;

namespace {

constexpr int kCall = 11;      // a ligacao de onde a sala nasce: a do 2002
constexpr int kRoomId = 30;    // a sala
constexpr int kGuest = 31;     // o primeiro convidado (o segundo e o 32)
constexpr int kOutside = 40;   // a ligacao de fora
constexpr RoomMember::State kCalling = RoomMember::State::Calling;
constexpr RoomMember::State kIn = RoomMember::State::In;

const char kRoomEnd[] = R"({"v":1,"cmd":"salaEncerrar"})";
const char kRoomReturn[] = R"({"v":1,"cmd":"salaVoltar"})";

// O ligacao.sala do exemplo de "A ponte nova" (docs/ponte-windows.md, "A sala de video (0.4.0)"), como esta la.
const char kRoomJson[] =
    R"({"id":30,"fora":false,"cheia":false,"participantes":[)"
    R"({"id":11,"numero":"2002","nome":"Ana Souza","estado":"naSala","imagem":true,)"
    R"("quadro":{"x":0,"y":0,"largura":0.5,"altura":1}},)"
    R"({"id":31,"numero":"2004","nome":"","estado":"chamando","imagem":false,)"
    R"("quadro":{"x":0.5,"y":0,"largura":0.5,"altura":1}}]})";

std::string RoomAdd(const std::string& number, const std::string& extra = "") {
    return R"({"v":1,"cmd":"salaAdicionar","numero":")" + number + "\"" + extra + "}";
}

std::string RoomRemove(int id) { return R"({"v":1,"cmd":"salaTirar","id":)" + std::to_string(id) + "}"; }

RoomTile Tile(double x, double y, double width, double height) {
    RoomTile tile;
    tile.x = x;
    tile.y = y;
    tile.width = width;
    tile.height = height;
    return tile;
}

// Um convidado como o motor o avisa no OnRoom.
RoomMember Member(int callId, RoomMember::State state, bool image = false, RoomTile tile = RoomTile()) {
    RoomMember member;
    member.callId = callId;
    member.state = state;
    member.image = image;
    member.tile = tile;
    return member;
}

// A sala 30 como o OnRoom a traz, com os convidados na ordem em que entraram (out: a nossa voz e a nossa camera fora
// dela, com a ligacao de fora).
RoomInfo Room(std::vector<RoomMember> members, bool out = false) {
    RoomInfo room;
    room.id = kRoomId;
    room.members = std::move(members);
    room.out = out;
    return room;
}

// O ultimo OnRoom da sala: o ended, com quem ficou.
RoomInfo Ended(std::vector<RoomMember> members) {
    RoomInfo room = Room(std::move(members));
    room.ended = true;
    return room;
}

// A ligacao 11 do 2002 (com o nome que a central mandou) chega e e atendida com o video, que fica ativo. O proximo id
// do motor falso e o do primeiro convidado.
void VideoCall(Harness& h) {
    h.StartRegistered();
    h.app->OnIncomingCall(kCall, "2002", "Ana Souza");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer","video":true})");
    h.app->OnCallState(kCall, CallState::Confirmed, 200);
    CallVideo video;
    video.active = true;
    video.remote = true;
    video.camera = true;
    h.app->OnCallVideo(kCall, video);
    h.Run();
    REQUIRE(h.State()["ligacao"]["top"]["id"] == kCall);
    h.engine.nextCallId = kGuest;
}

// A ligacao de fora chega, toca e e atendida: ela tira voce da sala, que tem members (o motor avisa o out).
void TakeOutsideCall(Harness& h, std::vector<RoomMember> members) {
    h.app->OnIncomingCall(kOutside, "3005", "Fulano");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(kOutside, CallState::Confirmed, 200);
    h.app->OnRoom(Room(std::move(members), /*out=*/true));
    h.Run();
}

// O ultimo estado, com as chaves na ordem em que sairam.
ordered_json StateInOrder(const Harness& h) {
    ordered_json state;
    for (const std::string& post : h.posts) {
        const ordered_json message = ordered_json::parse(post);
        if (message.at("type") == "state") state = message.at("state");
    }
    REQUIRE_FALSE(state.is_null());
    return state;
}

// As linhas da sala no diagnostico, na ordem.
std::vector<std::string> RoomLines(const Harness& h) {
    std::vector<std::string> lines;
    for (const std::string& line : h.logs) {
        if (line.rfind("sala:", 0) == 0) lines.push_back(line);
    }
    return lines;
}

}  // namespace

TEST_CASE("the room commands reach the engine") {
    Harness h;
    VideoCall(h);
    // salaAdicionar: o numero como veio, e a sala nasce no OnRoom que traz o convidado 31.
    h.Send(RoomAdd("2003"));
    CHECK(h.engine.roomAdds == std::vector<std::string>{"2003"});
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kCalling)}));
    h.Run();
    REQUIRE(h.State()["ligacao"]["top"]["id"] == kRoomId);
    // Com o contato, o numero passa pela regra dos contatos do perfil, como no dial (o +55 sai; o perfil dos testes nao
    // tem o prefixo de saida).
    h.Send(RoomAdd("+55 11 5060-3000", R"(,"contato":true)"));
    CHECK(h.engine.roomAdds == std::vector<std::string>{"2003", "1150603000"});
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kCalling), Member(kGuest + 1, kCalling)}));
    h.Run();
    // salaTirar: o motor desliga o convidado.
    h.Send(RoomRemove(kGuest));
    CHECK(h.engine.hangups == std::vector<int>{kGuest});
    h.app->OnCallState(kGuest, CallState::Disconnected, 487);
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest + 1, kCalling)}));
    h.Run();
    // salaVoltar, com a sala fora (a ligacao de fora atendida): o Activate do id da sala.
    TakeOutsideCall(h, {Member(kCall, kIn), Member(kGuest + 1, kCalling)});
    REQUIRE(h.State()["ligacao"]["sala"]["fora"] == true);
    h.Send(kRoomReturn);
    CHECK(h.engine.activated == std::vector<int>{kRoomId});
    // salaEncerrar: o Hangup do id da sala (o motor desliga todos).
    h.Send(kRoomEnd);
    CHECK(h.engine.hangups == std::vector<int>{kGuest, kRoomId});
}

TEST_CASE("the state carries the room") {
    Harness h;
    VideoCall(h);
    h.Send(RoomAdd("2004"));
    // Ate o OnRoom, nenhuma sala: null, como o second.
    json call = h.State()["ligacao"];
    REQUIRE(call.contains("sala"));
    CHECK(call["sala"].is_null());

    h.app->OnRoom(Room({Member(kCall, kIn, true, Tile(0, 0, 0.5, 1)),
                        Member(kGuest, kCalling, false, Tile(0.5, 0, 0.5, 1))}));
    h.Run();
    // A linha da sala em cima, e o ligacao.sala de "A ponte nova", com as chaves na ordem de la.
    const ordered_json inOrder = StateInOrder(h).at("ligacao");
    CHECK(inOrder.at("top").at("id") == kRoomId);
    CHECK(inOrder.at("sala") == ordered_json::parse(kRoomJson));

    // O 2004 nao atende, e a sala acaba com a ligacao 11, que volta a ser a linha de cima: null de novo.
    h.app->OnCallState(kGuest, CallState::Disconnected, 486);
    h.app->OnRoom(Ended({Member(kCall, kIn, true, Tile(0, 0, 0.5, 1))}));
    h.Run();
    call = h.State()["ligacao"];
    CHECK(call["top"]["id"] == kCall);
    REQUIRE(call.contains("sala"));
    CHECK(call["sala"].is_null());
}

TEST_CASE("each room event writes one sala line without names or numbers") {
    Harness h;
    VideoCall(h);
    // A sala nasce da ligacao do 2002 com o 2003, que atende.
    h.Send(RoomAdd("2003"));
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kCalling)}));
    h.app->OnCallState(kGuest, CallState::Confirmed, 200);
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kIn)}));
    h.Run();
    // O 2004 (o convidado 32) esta ocupado.
    h.Send(RoomAdd("2004"));
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kIn), Member(kGuest + 1, kCalling)}));
    h.app->OnCallState(kGuest + 1, CallState::Disconnected, 486);
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kIn)}));
    h.Run();
    // Voce vai para fora (a ligacao de fora) e volta para a sala.
    TakeOutsideCall(h, {Member(kCall, kIn), Member(kGuest, kIn)});
    h.Send(kRoomReturn);
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kIn)}));
    h.Run();
    // O 2003 sai, e a sala acaba com o 2002, que volta a ser uma ligacao comum.
    h.app->OnCallState(kGuest, CallState::Disconnected, 200);
    h.app->OnRoom(Ended({Member(kCall, kIn)}));
    h.Run();
    CHECK(RoomLines(h) == std::vector<std::string>{"sala: comecou", "sala: entrou (2 na sala)", "sala: falhou (486)",
                                                   "sala: fora", "sala: voltou", "sala: saiu (1 na sala)",
                                                   "sala: acabou"});
}

TEST_CASE("a guest that does not get in shows the reason") {
    Harness h;
    VideoCall(h);
    h.Send(R"({"v":1,"cmd":"saveContact","nome":"Carlos Lima","numero":"2003"})");
    h.Send(RoomAdd("2003"));
    h.app->OnRoom(Room({Member(kCall, kIn), Member(kGuest, kCalling)}));
    h.Run();
    h.posts.clear();
    // O 2003 esta ocupado: o aviso de 2 s com o nome do contato, como o do colega da consulta (o endMessage).
    h.app->OnCallState(kGuest, CallState::Disconnected, 486);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>{"Carlos Lima: Ocupado"});
}

TEST_CASE("the iPhone has no room") {
    // A mesma ligacao em video do Windows (o motor do iPhone nao avisa o video; aqui ele vem, e o controlador deixaria
    // a sala nascer): so a recusa do iPhone deixa os pedidos longe do motor.
    Harness h(Platform::IPhone);
    VideoCall(h);
    const std::vector<std::pair<std::string, std::string>> commands = {
        {"salaAdicionar", RoomAdd("2003")},
        {"salaAdicionar", RoomAdd("+55 11 98888-7777", R"(,"contato":true)")},
        {"salaTirar", RoomRemove(kGuest)},
        {"salaEncerrar", kRoomEnd},
        {"salaVoltar", kRoomReturn},
    };
    for (const auto& [name, command] : commands) {
        INFO(command);
        h.logs.clear();
        h.Send(command);
        CHECK(h.logs == std::vector<std::string>{"comando recusado no modo iPhone: " + name});
    }
    CHECK(h.engine.roomAdds.empty());
    const json call = h.State()["ligacao"];
    REQUIRE(call.is_object());
    REQUIRE(call.contains("sala"));
    CHECK(call["sala"].is_null());
}
