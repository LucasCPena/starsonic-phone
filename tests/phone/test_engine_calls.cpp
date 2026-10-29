#include "call_fixture.h"

#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::CallEvent;
using phone_test::Contains;
using phone_test::FakeRegistrar;
using phone_test::History;
using phone_test::Input;
using phone_test::kWaitSeconds;
using phone_test::Last;
using phone_test::Lines;
using phone_test::LoadProfile;
using phone_test::Phone;
using phone_test::RecordingListener;
using phone_test::StartEngine;

TEST_CASE("incoming call rings, is answered and ends when the caller hangs up") {
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }

    Phone phone(transport);
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Ring();
    const CallEvent incoming = Last(phone.listener.Calls(), CallEvent::Incoming);
    CHECK(incoming.user == "3001");
    CHECK(incoming.name == "Cliente Teste");
    CHECK(phone.engine->HasCall());

    REQUIRE(phone.engine->Answer(id));
    CHECK(phone.registrar.WaitForLog("inv-out 2001 200", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Confirmed));

    REQUIRE(phone.registrar.Control("HANGUP 2001") == Lines{"OK"});
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK_FALSE(phone.engine->HasCall());
    CHECK(phone.registrar.WaitForLog("bye-out 2001 200", kWaitSeconds));
    // O aviso vem antes dos estados (o Incoming/100 é o do PJSIP, do 100 Trying) e o Disconnected é o
    // último.
    CHECK(History(phone.listener.Calls(), id) ==
          "Incoming Incoming/100 Early/180 Connecting/200 Confirmed/200 Disconnected/200");
}

TEST_CASE("incoming call that the caller gives up on ends with 487") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Ring();
    REQUIRE(phone.registrar.Control("HANGUP 2001") == Lines{"OK"});   // ainda tocando: CANCEL
    REQUIRE(phone.WaitState(id, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, id, CallState::Disconnected).code == 487);
    CHECK(phone.registrar.WaitForLog("inv-out 2001 487", kWaitSeconds));
    CHECK_FALSE(phone.engine->HasCall());
}

TEST_CASE("a second call gets busy while the first is still ringing") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Ring();   // não atende

    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    REQUIRE(phone.listener.WaitForCalls(RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    const CallEvent busy = Last(phone.listener.Calls(), CallEvent::Busy);
    CHECK(busy.user == "3001");
    CHECK(busy.name == "Cliente Teste");
    CHECK(phone.Count(CallEvent::Incoming) == 1);   // a segunda não vira ligação
    CHECK(phone.engine->CallCount() == 1);

    // A primeira continua tocando: o HANGUP do registrador (na ligação viva) ainda a encerra.
    CHECK(phone.engine->HasCall());
    REQUIRE(phone.registrar.Control("HANGUP 2001") == Lines{"OK"});
    CHECK(phone.WaitState(id, CallState::Disconnected));
}

TEST_CASE("MakeCall during a ringing call is refused") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Ring();   // não atende
    CHECK(phone.engine->MakeCall("2002") == -1);
    CHECK(phone.engine->CallCount() == 1);
    CHECK_FALSE(phone.engine->Activate(id));   // não confirmada
}

TEST_CASE("Reject answers busy") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Ring();
    REQUIRE(phone.engine->Reject(id));
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK_FALSE(phone.engine->HasCall());
}

TEST_CASE("outgoing call to a busy number ends with 486") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.engine->MakeCall("486");
    REQUIRE(id >= 0);
    REQUIRE(phone.WaitState(id, CallState::Disconnected));
    CHECK(Last(phone.listener.Calls(), CallEvent::State, id, CallState::Disconnected).code == 486);
    CHECK(phone.registrar.LogHas("inv-in 486 486"));
    CHECK_FALSE(phone.engine->HasCall());
}

TEST_CASE("Hangup ends an answered call") {
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }

    Phone phone(transport);
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Dial("2002");
    CHECK(phone.engine->HasCall());
    REQUIRE(phone.engine->Hangup(id));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK_FALSE(phone.engine->HasCall());
    CHECK(History(phone.listener.Calls(), id) == "Calling/0 Early/180 Connecting/200 Confirmed/200 Disconnected/200");
}

TEST_CASE("RemoveAccount ends the call before the account leaves") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Dial("2002");
    phone.engine->RemoveAccount();
    CHECK_FALSE(phone.engine->HasCall());
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK(phone.listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    CHECK(phone.registrar.Control("RING 2001") == Lines{"ERR no-contact"});
}

TEST_CASE("destroying the engine during a call is safe") {
    bool incoming = false;
    SUBCASE("an answered outgoing call") { incoming = false; }
    SUBCASE("an incoming call that still rings") { incoming = true; }

    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = incoming ? phone.Ring() : phone.Dial("2002");
    phone.engine.reset();
    const size_t events = phone.listener.EventCount();
    // A ligação sai do servidor (BYE ou recusa) e nenhum evento chega depois do destrutor; o destrutor
    // também não avisa o fim da ligação.
    CHECK(phone.registrar.WaitForLog(incoming ? "inv-out 2001 603" : "bye-in 2002", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.EventCount() == events);
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
}

TEST_CASE("the engine works from a thread other than the one that created it") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    // Nada abaixo roda na thread que criou o motor: cada método registra a thread que chama no PJLIB
    // (sem isso o PJLIB aborta o processo).
    bool accountSet = false;
    bool registered = false;
    std::vector<std::string> codecs;
    int id = -1;
    bool confirmed = false;
    bool hungUp = false;
    std::thread other([&] {
        accountSet = engine->SetAccount(Input(Transport::Udp)) > 0;
        registered = listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds);
        codecs = engine->ActiveCodecs();
        id = engine->MakeCall("2002");
        confirmed = id >= 0 && listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed),
                                                     kWaitSeconds);
        engine->SetMute(true);
        hungUp = engine->Hangup(id);
        engine.reset();
    });
    other.join();

    CHECK(accountSet);
    CHECK(registered);
    CHECK(codecs == Lines{"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"});
    CHECK(confirmed);
    CHECK(hungUp);
    CHECK_FALSE(engine);
    CHECK(registrar.WaitForLog("bye-in 2002", kWaitSeconds));
}

TEST_CASE("the listener may call the engine from an event") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    std::atomic<bool> answered{false};
    SipEngine* engine = phone.engine.get();
    phone.listener.SetIncomingHook([&answered, engine](int id) { answered = engine->Answer(id); });

    const int id = phone.Ring();
    CHECK(phone.WaitState(id, CallState::Confirmed));
    CHECK(answered);
    CHECK(phone.registrar.LogHas("inv-out 2001 200"));
}

TEST_CASE("MakeCall dials sip:<number>@<domain> with the default port of the profile") {
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile();
    REQUIRE(profile.account.port == 5060);   // o branding/perfil.ini de hoje
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));   // ninguém responde em 127.0.0.1:5060: tanto faz

    const int id = engine->MakeCall("2002");
    REQUIRE(id >= 0);
    // O pjsua escreve no log cada pedido que sai, com a linha do pedido.
    CHECK(Contains(listener.LogTail(), "INVITE sip:2002@127.0.0.1 SIP/2.0"));
    CHECK(engine->Hangup(id));
}

TEST_CASE("MakeCall dials sip:<number>@<domain>:<port> with the port of [portas]") {
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile();
    profile.account.serverPorts.clear();
    profile.account.serverPorts.push_back(ServerPort{L"127.0.0.1", 35060});
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));   // ninguem responde em 127.0.0.1:35060: tanto faz

    const int id = engine->MakeCall("2002");
    REQUIRE(id >= 0);
    CHECK(Contains(listener.LogTail(), "INVITE sip:2002@127.0.0.1:35060 SIP/2.0"));
    CHECK(engine->Hangup(id));
}

TEST_CASE("MakeCall needs an account") {
    RecordingListener listener;
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());
    CHECK(engine->MakeCall("2002") == -1);
    CHECK_FALSE(engine->HasCall());
    CHECK(listener.Calls().empty());
}
