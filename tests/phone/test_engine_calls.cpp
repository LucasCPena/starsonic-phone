#include "engine_fixture.h"

#include <pjsua-lib/pjsua.h>

#include <atomic>
#include <chrono>
#include <functional>
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
using phone_test::Input;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::StartEngine;

namespace {

using Lines = std::vector<std::string>;

// O evento `kind` mais recente; em State, o mais recente OnCallState(callId, state). Falha o teste
// se não houve.
CallEvent Last(const std::vector<CallEvent>& events, CallEvent::Kind kind, int callId = 0,
               CallState state = CallState::Incoming) {
    for (auto it = events.rbegin(); it != events.rend(); ++it) {
        if (it->kind == kind && (kind != CallEvent::State || (it->callId == callId && it->state == state))) {
            return *it;
        }
    }
    FAIL("o evento esperado nao chegou");
    return CallEvent();
}

// Os eventos da ligação callId em ordem: "Incoming" para OnIncomingCall e "<estado>/<código>" para
// OnCallState, como "Incoming Early/180 Confirmed/200".
std::string History(const std::vector<CallEvent>& events, int callId) {
    std::string text;
    for (const CallEvent& event : events) {
        if (event.callId != callId) continue;
        if (!text.empty()) text += " ";
        if (event.kind == CallEvent::Incoming) {
            text += "Incoming";
        } else {
            text += std::string(phone_test::StateName(event.state)) + "/" + std::to_string(event.code);
        }
    }
    return text;
}

// Um motor registrado no registrador falso (ramal 2001). adjust muda o perfil antes do Create. A
// ordem dos campos importa: o motor some antes do listener, e o registrador por último.
struct Phone {
    explicit Phone(Transport transport = Transport::Udp, const std::function<void(Profile&)>& adjust = nullptr)
        : registrar("senha") {
        Profile profile = LoadProfile(registrar.port());
        if (adjust) adjust(profile);
        engine = StartEngine(&listener, profile);
        REQUIRE(engine->SetAccount(Input(transport)));
        REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    }

    // RING 2001 e o id que o motor deu à ligação.
    int Ring() {
        const size_t before = Count(CallEvent::Incoming);
        REQUIRE(registrar.Control("RING 2001") == Lines{"OK"});
        REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, before + 1), kWaitSeconds));
        return Last(listener.Calls(), CallEvent::Incoming).callId;
    }

    // MakeCall e a espera pelo Confirmed.
    int Dial(const std::string& number) {
        const int id = engine->MakeCall(number);
        REQUIRE(id >= 0);
        REQUIRE(WaitState(id, CallState::Confirmed));
        return id;
    }

    bool WaitState(int id, CallState state) {
        return listener.WaitForCalls(RecordingListener::StateReached(id, state), kWaitSeconds);
    }

    size_t Count(CallEvent::Kind kind) const {
        size_t count = 0;
        for (const CallEvent& event : listener.Calls()) count += event.kind == kind ? 1 : 0;
        return count;
    }

    FakeRegistrar registrar;
    RecordingListener listener;
    std::unique_ptr<SipEngine> engine;
};

}  // namespace

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

TEST_CASE("a second call gets busy while one is active") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Ring();
    REQUIRE(phone.engine->Answer(id));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));

    REQUIRE(phone.registrar.Control("RING 2001") == Lines{"OK"});
    CHECK(phone.registrar.WaitForLog("inv-out 2001 486", kWaitSeconds));
    REQUIRE(phone.listener.WaitForCalls(RecordingListener::Count(CallEvent::Busy, 1), kWaitSeconds));
    const CallEvent busy = Last(phone.listener.Calls(), CallEvent::Busy);
    CHECK(busy.user == "3001");
    CHECK(busy.name == "Cliente Teste");
    CHECK(phone.Count(CallEvent::Incoming) == 1);   // a segunda não vira ligação

    // A primeira continua: o HANGUP do registrador (na ligação viva) ainda a encerra.
    CHECK(phone.engine->HasCall());
    REQUIRE(phone.registrar.Control("HANGUP 2001") == Lines{"OK"});
    CHECK(phone.WaitState(id, CallState::Disconnected));
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

TEST_CASE("outgoing call is held, resumed, sends DTMF and is transferred") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(phone.engine->HasCall());
    // Só os pedidos que o teste fez: nenhum re-INVITE a mais.
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv"});

    CHECK(phone.engine->SendDtmf(id, "12"));

    REQUIRE(phone.engine->Transfer(id, "2003"));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003", kWaitSeconds));
    CHECK(phone.WaitState(id, CallState::Disconnected));   // o NOTIFY 200 encerra a ligação
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv",
                                         "refer-in 2002 2003", "bye-in 2002"});
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

TEST_CASE("call methods refuse calls that do not exist and a second call") {
    Phone phone;
    INFO(phone.listener.CallsText());

    CHECK_FALSE(phone.engine->HasCall());
    CHECK_FALSE(phone.engine->Answer(1));
    CHECK_FALSE(phone.engine->Reject(1));
    CHECK_FALSE(phone.engine->Hangup(1));
    CHECK_FALSE(phone.engine->SetHold(1, true));
    CHECK_FALSE(phone.engine->SendDtmf(1, "1"));
    CHECK_FALSE(phone.engine->Transfer(1, "2003"));
    CHECK(phone.engine->MakeCall("") == -1);

    const int id = phone.Dial("2002");
    CHECK(phone.engine->MakeCall("2003") == -1);   // uma ligação por vez
    CHECK_FALSE(phone.engine->Answer(id));          // não há o que atender numa ligação feita
    CHECK_FALSE(phone.engine->Reject(id));
    CHECK_FALSE(phone.engine->SendDtmf(id, ""));
    CHECK_FALSE(phone.engine->Hangup(id + 1));
    CHECK(phone.engine->Hangup(id));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK_FALSE(phone.engine->Hangup(id));          // já acabou
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

TEST_CASE("MakeCall needs an account") {
    RecordingListener listener;
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());
    CHECK(engine->MakeCall("2002") == -1);
    CHECK_FALSE(engine->HasCall());
    CHECK(listener.Calls().empty());
}

TEST_CASE("SendDtmf uses the DTMF method of the profile") {
    DtmfMethod method = DtmfMethod::Rfc2833;
    std::string expected = "using RFC2833 method";
    SUBCASE("rfc2833") { method = DtmfMethod::Rfc2833; }
    SUBCASE("auto goes by RFC 2833") { method = DtmfMethod::Auto; }
    SUBCASE("inband goes by RFC 2833") { method = DtmfMethod::Inband; }
    SUBCASE("info goes by SIP INFO") {
        method = DtmfMethod::SipInfo;
        expected = "using SIP INFO method";
    }

    Phone phone(Transport::Udp, [method](Profile& profile) { profile.global.dtmf = method; });
    INFO(phone.listener.LogTail());

    const int id = phone.Dial("2002");
    CHECK(phone.engine->SendDtmf(id, "1"));
    // O pjsua escreve o método que usou; no INFO, o corpo da mensagem que saiu.
    CHECK(Contains(phone.listener.LogTail(), expected));
    if (method == DtmfMethod::SipInfo) {
        CHECK(Contains(phone.listener.LogTail(), "Signal=1"));
    }
}

TEST_CASE("SetMute silences the microphone") {
    RecordingListener listener;
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // O microfone é a porta 0 da ponte de áudio; o mudo zera o que a ponte recebe dela.
    pjsua_conf_port_info info;
    engine->SetMute(true);
    REQUIRE(pjsua_conf_get_port_info(0, &info) == PJ_SUCCESS);
    CHECK(info.rx_level_adj == doctest::Approx(0.0f));
    engine->SetMute(false);
    REQUIRE(pjsua_conf_get_port_info(0, &info) == PJ_SUCCESS);
    CHECK(info.rx_level_adj == doctest::Approx(1.0f));
}
