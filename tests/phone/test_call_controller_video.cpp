// As ligações com vídeo no controlador (Task 7 da etapa 1 do vídeo): o Dial e o Answer com vídeo, a câmera da
// ligação de cima, o vídeo de cada ligação (OnCallVideo) e o 488/415 que vira ligação só de voz. O motor, o ouvinte,
// o relógio e os contatos são os falsos (fake_call_engine.h), como no test_call_controller.cpp.
#include "doctest/doctest.h"

#include <string>
#include <utility>
#include <vector>

#include "CallController.h"
#include "fake_call_engine.h"

using namespace starsonic;
using phone_test::FakeCallEngine;
using phone_test::FakeCallListener;
using phone_test::FakeContactNames;
using phone_test::FakeTime;

namespace {

// O vídeo de uma ligação com os campos que a tela vê (o refused é do evento, não do estado).
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

struct VideoFixture {
    FakeCallEngine engine;
    FakeCallListener listener;
    FakeTime time;
    FakeContactNames contacts;
    CallController calls{engine, listener, time, time, contacts, [](std::string raw) { return raw; }};

    VideoFixture() { engine.nextCallId = 1; }

    // Uma ligação chega, toca e é atendida (id 1 se for a primeira).
    void RingAndAnswer(int id, bool video = false) {
        calls.OnIncomingCall(id, "3001", "Cliente Teste");
        calls.OnCallState(id, CallState::Early, 180);
        calls.Answer(video);
        calls.OnCallState(id, CallState::Connecting, 200);
        calls.OnCallState(id, CallState::Confirmed, 200);
    }

    std::optional<CallView> Top() const { return listener.State().top; }
};

}  // namespace

TEST_CASE_FIXTURE(VideoFixture, "Dial with video asks the engine for a video call") {
    REQUIRE(calls.Dial("2003", true));
    CHECK(engine.made == std::vector<std::string>{"2003"});
    CHECK(engine.madeVideo == std::vector<bool>{true});
    calls.OnCallState(1, CallState::Confirmed, 200);
    calls.Hangup();
    calls.OnCallState(1, CallState::Disconnected, 200);

    // Sem o pedido, e com o Dial de sempre, a ligação é só de voz.
    REQUIRE(calls.Dial("2004"));
    CHECK(engine.madeVideo == std::vector<bool>{true, false});
    calls.OnCallState(2, CallState::Confirmed, 200);
    calls.Hangup();
    calls.OnCallState(2, CallState::Disconnected, 200);

    // O contato também leva o vídeo.
    REQUIRE(calls.DialContact("2005", true));
    CHECK(engine.made == std::vector<std::string>{"2003", "2004", "2005"});
    CHECK(engine.madeVideo == std::vector<bool>{true, false, true});
}

TEST_CASE_FIXTURE(VideoFixture, "Answer with video passes the flag") {
    calls.OnIncomingCall(1, "3001", "Cliente Teste");
    calls.OnCallState(1, CallState::Early, 180);
    calls.Answer(true);
    CHECK(engine.answers == std::vector<int>{1});
    CHECK(engine.answersVideo == std::vector<bool>{true});
    calls.OnCallState(1, CallState::Confirmed, 200);
    calls.Hangup();
    calls.OnCallState(1, CallState::Disconnected, 200);

    calls.OnIncomingCall(2, "3002", "Outro");
    calls.OnCallState(2, CallState::Early, 180);
    calls.Answer();
    CHECK(engine.answersVideo == std::vector<bool>{true, false});
}

TEST_CASE_FIXTURE(VideoFixture, "Camera goes to the top call") {
    // Sem ligação, nada.
    calls.Camera(true);
    CHECK(engine.cameras.empty());

    RingAndAnswer(1);
    engine.nextCallId = 2;
    REQUIRE(calls.Dial("2002"));   // a Nova ligação: a feita (id 2) é a de cima, a recebida vai para a espera
    calls.OnCallState(2, CallState::Confirmed, 200);
    REQUIRE(Top().has_value());
    REQUIRE(Top()->id == 2);
    calls.Camera(false);
    CHECK(engine.cameras == std::vector<std::pair<int, bool>>{{2, false}});
    calls.Camera(true);
    CHECK(engine.cameras == std::vector<std::pair<int, bool>>{{2, false}, {2, true}});
}

TEST_CASE_FIXTURE(VideoFixture, "Camera does nothing for a call that has no engine id yet") {
    engine.duringMakeCall = [this](int) { calls.Camera(true); };   // o MakeCall ainda não voltou
    REQUIRE(calls.Dial("2003", true));
    CHECK(engine.cameras.empty());
}

TEST_CASE_FIXTURE(VideoFixture, "OnCallVideo fills the call view") {
    RingAndAnswer(1, true);
    REQUIRE(Top().has_value());
    CHECK(Top()->video == Video(false, false, false, false));

    calls.OnCallVideo(1, Video(true, true, false, true, false));
    CHECK(Top()->video == Video(true, true, false, true));
    calls.OnCallVideo(1, Video(true, true, true, true, false));
    CHECK(Top()->video == Video(true, true, true, true));

    const size_t before = listener.snapshots.size();
    calls.OnCallVideo(1, Video(true, true, true, true, false));   // o mesmo vídeo: nada novo na tela
    CHECK(listener.snapshots.size() == before);

    // O vídeo de outra ligação (ou de uma que já acabou) não mexe na de cima.
    calls.OnCallVideo(77, Video(true, true, true, true, false));
    CHECK(Top()->video == Video(true, true, true, true));
    CHECK(listener.videoRefused == 0);
}

TEST_CASE_FIXTURE(VideoFixture, "OnCallVideo reaches the second call too") {
    RingAndAnswer(1);
    engine.nextCallId = 2;
    REQUIRE(calls.Dial("2002"));
    calls.OnCallState(2, CallState::Confirmed, 200);
    calls.OnCallVideo(1, Video(true, true, false, false));
    REQUIRE(listener.State().second.has_value());
    CHECK(listener.State().second->video == Video(true, true, false, false));
    CHECK(Top()->video == Video(false, false, false, false));
}

TEST_CASE_FIXTURE(VideoFixture, "a refused video event warns once") {
    RingAndAnswer(1, true);
    calls.OnCallVideo(1, Video(false, false, false, false, false, true));
    CHECK(listener.videoRefused == 1);
    CHECK(Top()->video == Video(false, false, false, false));   // a recusa não fica no estado

    // Cada recusa do motor é um aviso.
    calls.OnCallVideo(1, Video(false, false, false, false, false, true));
    CHECK(listener.videoRefused == 2);
}

TEST_CASE_FIXTURE(VideoFixture, "a 488 to a video call redials once without video and warns") {
    REQUIRE(calls.Dial("2003", true));
    CHECK(engine.made == std::vector<std::string>{"2003"});
    CHECK(engine.madeVideo == std::vector<bool>{true});
    calls.OnCallState(1, CallState::Early, 183);

    calls.OnCallState(1, CallState::Disconnected, 488);
    REQUIRE(engine.made.size() == 2);
    CHECK(engine.made[1] == "2003");
    CHECK(engine.madeVideo == std::vector<bool>{true, false});
    CHECK(listener.videoRefused == 1);
    // A ligação segue na tela, "Chamando", e nada do fim da primeira tentativa aparece.
    REQUIRE(Top().has_value());
    CHECK(Top()->phase == CallView::Dialing);
    CHECK(Top()->number == "2003");
    CHECK(Top()->id == 2);
    CHECK(listener.recents.empty());
    CHECK(listener.State().endMessage.empty());

    // A nova ligação é a de agora: ela atende e fecha normalmente.
    calls.OnCallState(2, CallState::Confirmed, 200);
    CHECK(Top()->phase == CallView::Active);
    CHECK(Top()->id == 2);
    calls.Hangup();
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Outgoing);
    CHECK(engine.made.size() == 2);
}

TEST_CASE_FIXTURE(VideoFixture, "a 488 to the redialed call ends it without a third dial") {
    REQUIRE(calls.Dial("2003", true));
    calls.OnCallState(1, CallState::Disconnected, 488);
    REQUIRE(engine.made.size() == 2);

    calls.OnCallState(2, CallState::Disconnected, 488);
    CHECK(engine.made.size() == 2);
    CHECK(listener.videoRefused == 1);
    CHECK_FALSE(Top().has_value());
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].number == "2003");
    CHECK(listener.recents[0].kind == Recent::Outgoing);
    CHECK_FALSE(listener.State().endMessage.empty());
}

TEST_CASE_FIXTURE(VideoFixture, "a 415 redials the same way and a 486 does not") {
    REQUIRE(calls.Dial("2003", true));
    calls.OnCallState(1, CallState::Disconnected, 415);
    CHECK(engine.madeVideo == std::vector<bool>{true, false});
    CHECK(listener.videoRefused == 1);
    CHECK(Top().has_value());
    CHECK(listener.recents.empty());
    calls.Hangup();
    calls.OnCallState(2, CallState::Disconnected, 487);
    CHECK_FALSE(Top().has_value());

    // O 486 (ocupado) termina como sempre: o aviso, os Recentes e nenhuma discagem nova.
    VideoFixture busy;
    REQUIRE(busy.calls.Dial("2003", true));
    busy.calls.OnCallState(1, CallState::Disconnected, 486);
    CHECK(busy.engine.made.size() == 1);
    CHECK(busy.listener.videoRefused == 0);
    CHECK_FALSE(busy.Top().has_value());
    CHECK(busy.listener.recents.size() == 1);
    CHECK_FALSE(busy.listener.State().endMessage.empty());
}

TEST_CASE_FIXTURE(VideoFixture, "a 488 to a voice call or a hung up call does not redial") {
    REQUIRE(calls.Dial("2003"));
    calls.OnCallState(1, CallState::Disconnected, 488);
    CHECK(engine.made.size() == 1);
    CHECK(listener.videoRefused == 0);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents.size() == 1);

    // A pessoa desligou a de vídeo antes: o 488 que chega depois não disca de novo.
    REQUIRE(calls.Dial("2004", true));
    calls.Hangup();
    calls.OnCallState(2, CallState::Disconnected, 488);
    CHECK(engine.made.size() == 2);
    CHECK(listener.videoRefused == 0);
    CHECK_FALSE(Top().has_value());
}

TEST_CASE_FIXTURE(VideoFixture, "a redial that the engine refuses ends the call") {
    REQUIRE(calls.Dial("2003", true));
    engine.refuse = true;
    calls.OnCallState(1, CallState::Disconnected, 488);
    CHECK(engine.made.size() == 2);
    CHECK(listener.videoRefused == 1);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(VideoFixture, "the Hangup of a redialed call before its id arrives still ends it") {
    REQUIRE(calls.Dial("2003", true));
    engine.duringMakeCall = [this](int) { calls.Hangup(CallController::kNoId); };
    calls.OnCallState(1, CallState::Disconnected, 488);
    CHECK(engine.hangups == std::vector<int>{2});
}
