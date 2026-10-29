#include "call_fixture.h"

#include <chrono>
#include <thread>
#include <vector>

#include "SipEngine.h"

using namespace starsonic;
using phone_test::CallEvent;
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::Phone;
using phone_test::RecordingListener;

TEST_CASE("a second incoming call rings while one is active") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int first = phone.Answered();
    REQUIRE(phone.WaitLinks(first, {0}));

    const int second = phone.Ring();
    CHECK(second != first);
    const CallEvent incoming = Last(phone.listener.Calls(), CallEvent::Incoming);
    CHECK(incoming.user == "3001");
    CHECK(incoming.name == "Cliente Teste");
    CHECK(phone.Count(CallEvent::Busy) == 0);
    CHECK(phone.engine->CallCount() == 2);

    // Atender a segunda põe a primeira em espera (o re-INVITE vai ao Contact do INVITE do RING, que
    // é o de quem liga: 3001) e só a atendida fica com o dispositivo de som.
    REQUIRE(phone.engine->Answer(second));
    CHECK(phone.WaitForLogCount("inv-out 2001 200", 2));
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
    CHECK(phone.WaitState(second, CallState::Confirmed));
    CHECK(phone.WaitLinks(first, {}));
    CHECK(phone.WaitLinks(second, {0}));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.LogCount("reinv-in 3001 sendonly") == 1);
}

TEST_CASE("a third call gets busy") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);

    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    REQUIRE(phone.listener.WaitForCalls(RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    const CallEvent busy = Last(phone.listener.Calls(), CallEvent::Busy);
    CHECK(busy.user == "3001");
    CHECK(phone.Count(CallEvent::Incoming) == 2);   // a terceira não vira ligação
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->AudioLinks(second) == std::vector<int>{0});   // a ativa segue com o som
}

TEST_CASE("Activate switches the active call") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);
    REQUIRE(phone.LogCount("reinv-in 3001 sendonly") == 1);   // a espera da primeira

    // As duas ligações são do RING (o alvo dos re-INVITEs é o 3001 nas duas): a primeira é retomada
    // e a segunda vai para a espera.
    REQUIRE(phone.engine->Activate(first));
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(phone.WaitForLogCount("reinv-in 3001 sendonly", 2));
    CHECK(phone.WaitLinks(first, {0}));
    CHECK(phone.WaitLinks(second, {}));

    // De novo: já é a ativa, nada muda (nenhum re-INVITE).
    const Lines before = phone.registrar.Log();
    CHECK(phone.engine->Activate(first));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.registrar.Log() == before);
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(second).empty());
}

TEST_CASE("MakeCall during a confirmed call holds it") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int first = phone.Answered();
    const int second = phone.engine->MakeCall("2002");
    REQUIRE(second > 0);
    CHECK(second != first);
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
    CHECK(phone.registrar.LogHas("inv-in 2002 200"));
    CHECK(phone.WaitLinks(second, {0}));
    CHECK(phone.WaitLinks(first, {}));
    CHECK(phone.engine->CallCount() == 2);
}

TEST_CASE("hanging up the active call leaves the other on hold") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);

    REQUIRE(phone.engine->Hangup(second));
    CHECK(phone.WaitState(second, CallState::Disconnected));
    CHECK(phone.engine->CallCount() == 1);
    // A primeira não volta sozinha: segue em espera, sem som, até o Activate.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.engine->AudioLinks(first).empty());
    CHECK(phone.LogCount("reinv-in 3001 sendrecv") == 0);

    REQUIRE(phone.engine->Activate(first));
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(phone.WaitLinks(first, {0}));
}

TEST_CASE("SetHold right after another SetHold waits for the first re-INVITE") {
    Phone phone;
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2002");
    // O PJSIP só aceita um re-INVITE por vez: o segundo pedido espera o primeiro terminar.
    REQUIRE(phone.engine->SetHold(id, true));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv"});
}

TEST_CASE("destroying the engine with two calls is safe") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int first = phone.Answered();   // do RING: o BYE vai ao 3001
    const int second = phone.Dial("2002");
    REQUIRE(phone.engine->CallCount() == 2);
    phone.engine.reset();
    const size_t events = phone.listener.EventCount();
    // As duas saem do servidor e nenhum evento chega depois do destrutor.
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 3001", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.EventCount() == events);
    CHECK_FALSE(RecordingListener::StateReached(first, CallState::Disconnected)(phone.listener.Calls()));
    CHECK_FALSE(RecordingListener::StateReached(second, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("call methods refuse calls that do not exist and a third call") {
    Phone phone;
    INFO(phone.listener.CallsText());

    CHECK_FALSE(phone.engine->HasCall());
    CHECK(phone.engine->CallCount() == 0);
    CHECK_FALSE(phone.engine->Answer(1));
    CHECK_FALSE(phone.engine->Reject(1));
    CHECK_FALSE(phone.engine->Hangup(1));
    CHECK_FALSE(phone.engine->SetHold(1, true));
    CHECK_FALSE(phone.engine->Activate(1));
    CHECK(phone.engine->AudioLinks(1).empty());
    CHECK_FALSE(phone.engine->SendDtmf(1, "1"));
    CHECK_FALSE(phone.engine->Transfer(1, "2003"));
    CHECK(phone.engine->MakeCall("") == -1);

    const int id = phone.Dial("2002");
    const int other = phone.Dial("2003");           // a primeira vai para a espera
    CHECK(phone.engine->MakeCall("2004") == -1);   // duas ligações: não cabe uma terceira
    CHECK_FALSE(phone.engine->Answer(id));          // não há o que atender numa ligação feita
    CHECK_FALSE(phone.engine->Reject(id));
    CHECK_FALSE(phone.engine->SendDtmf(id, ""));
    CHECK_FALSE(phone.engine->Hangup(other + 1));
    CHECK(phone.engine->Hangup(id));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK_FALSE(phone.engine->Hangup(id));          // já acabou
    CHECK(phone.engine->CallCount() == 1);
}
