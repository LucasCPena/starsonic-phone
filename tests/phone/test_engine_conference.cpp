#include "call_fixture.h"

#include <chrono>
#include <thread>
#include <vector>

#include "SipEngine.h"

using namespace starsonic;
using phone_test::kWaitSeconds;
using phone_test::Lines;
using phone_test::Phone;
using phone_test::RecordingListener;
using phone_test::Sorted;

TEST_CASE("Join resumes the held call and links the two") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int a = 0, b = 0;
    phone.Consultation(&a, &b);   // a (2002) em espera, b (2003) a ativa

    // A em espera é retomada; as duas ficam com o dispositivo de som e ligadas entre si.
    REQUIRE(phone.engine->Join(a, b));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(phone.WaitLinks(a, {0, b}));
    CHECK(phone.WaitLinks(b, {0, a}));
    // A ativa não vai para a espera, e nada mais muda.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 2003 sendonly") == 0);
    CHECK(phone.LogCount("reinv-in 2002 sendrecv") == 1);
    CHECK(Sorted(phone.engine->AudioLinks(a)) == Sorted({0, b}));
    CHECK(Sorted(phone.engine->AudioLinks(b)) == Sorted({0, a}));
    CHECK(phone.engine->CallCount() == 2);

    // Já em conferência: nada muda (nenhum re-INVITE).
    const Lines before = phone.registrar.Log();
    CHECK(phone.engine->Join(b, a));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.registrar.Log() == before);
}

TEST_CASE("Split holds the second call again") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int a = 0, b = 0;
    phone.Conference(&a, &b);

    // b vai para a espera e as duas deixam de se ouvir; a segue a ativa, com o som, sem re-INVITE.
    REQUIRE(phone.engine->Split(a, b));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    CHECK(phone.WaitLinks(a, {0}));
    CHECK(phone.WaitLinks(b, {}));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 2002 sendonly") == 1);   // só a da consulta
    CHECK(phone.LogCount("reinv-in 2002 sendrecv") == 1);   // só a do Join
    CHECK(phone.LogCount("reinv-in 2003 sendonly") == 1);
    CHECK(phone.engine->AudioLinks(a) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(b).empty());
}

TEST_CASE("when one party leaves the conference the other stays active") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int a = 0, b = 0;
    phone.Conference(&a, &b);

    // b acaba: a vira uma ligação normal, a ativa, ainda com o som e sem re-INVITE.
    REQUIRE(phone.engine->Hangup(b));
    CHECK(phone.WaitState(b, CallState::Disconnected));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.WaitLinks(a, {0}));
    CHECK(phone.engine->CallCount() == 1);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK_FALSE(RecordingListener::StateReached(a, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.LogCount("reinv-in 2002 sendonly") == 1);   // só a da consulta
    CHECK(phone.engine->AudioLinks(a) == std::vector<int>{0});
}

TEST_CASE("Activate during a conference splits it") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int a = 0, b = 0;
    phone.Conference(&a, &b);

    // É o Split(b, a): a volta para a espera (a segunda vez: a primeira foi a da consulta) e b fica a
    // ativa.
    REQUIRE(phone.engine->Activate(b));
    CHECK(phone.WaitForLogCount("reinv-in 2002 sendonly", 2));
    CHECK(phone.WaitLinks(b, {0}));
    CHECK(phone.WaitLinks(a, {}));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 2003 sendonly") == 0);
    CHECK(phone.engine->AudioLinks(b) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(a).empty());
}

TEST_CASE("Join with a ringing call is refused") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    CHECK_FALSE(phone.engine->Join(1, 2));   // nenhuma ligação
    CHECK_FALSE(phone.engine->Split(1, 2));

    // Uma feita (2002) e uma do RING que ainda toca (não confirmada): não se juntam nem se separam.
    const int made = phone.Dial("2002");
    REQUIRE(phone.WaitLinks(made, {0}));
    const int ringing = phone.Ring();
    CHECK_FALSE(phone.engine->Join(made, ringing));
    CHECK_FALSE(phone.engine->Join(ringing, made));
    CHECK_FALSE(phone.engine->Split(made, ringing));
    CHECK_FALSE(phone.engine->Split(ringing, made));
    // Ela mesma ou um id que não existe também não.
    CHECK_FALSE(phone.engine->Join(made, made));
    CHECK_FALSE(phone.engine->Join(made, ringing + 100));
    CHECK_FALSE(phone.engine->Split(made, made));
    CHECK_FALSE(phone.engine->Split(made, ringing + 100));

    // Nada mudou: nenhum re-INVITE, a feita segue com o som e a outra tocando.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200"});
    CHECK(phone.engine->AudioLinks(made) == std::vector<int>{0});
    CHECK(phone.engine->CallCount() == 2);
}
