#include "engine_fixture.h"

#include <chrono>
#include <memory>
#include <thread>
#include <vector>

#include "SipEngine.h"

using namespace starsonic;
using phone_test::CountActive;
using phone_test::FakeRegistrar;
using phone_test::Input;
using phone_test::kOk;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::LogCount;
using phone_test::RecordingListener;
using phone_test::Registers;
using phone_test::RegistrationsText;
using phone_test::StartEngine;
using phone_test::WaitUntil;

// Correcao final (H2, Ruling 25): sem rede, o motor nao tira o registro do servidor. So deixa de tentar de novo, e o
// registro vive ate vencer ou ate a proxima renovacao falhar (com o "sem rede" errado, a central continua entregando).
TEST_CASE("SetNetworkAvailable false keeps the binding, stops retries after a failure, and true re-registers") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    INFO(listener.CallsText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    // O registrador concede 3 s: o PJSIP renova o registro a cada 2 s. Com 2 s (renovar a cada 1 s) o pjsua daria a
    // renovacao como inativa: o regIsActive conta os segundos inteiros que faltam para a proxima.
    REQUIRE(registrar.Control("EXPIRES 3") == kOk);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    engine->SetNetworkAvailable(false);
    std::this_thread::sleep_for(std::chrono::milliseconds(500));   // os avisos de antes acabam de chegar
    const size_t events = listener.Registrations().size();
    // A central alcancavel continua com o registro: o PJSIP segue renovando, e a ligacao que ela manda chega.
    const int renewed = Registers(registrar);
    CHECK(WaitUntil([&] { return Registers(registrar) > renewed; }, kWaitSeconds));
    REQUIRE(registrar.Control("RING 2001") == kOk);
    REQUIRE(listener.WaitForCalls(RecordingListener::Count(phone_test::CallEvent::Incoming, 1), kWaitSeconds));
    const int callId = listener.Calls().front().callId;
    REQUIRE(registrar.Control("HANGUP 2001") == kOk);
    CHECK(listener.WaitForCalls(RecordingListener::StateReached(callId, CallState::Disconnected), kWaitSeconds));

    // A renovacao seguinte falha (503): nenhuma nova tentativa (fora do Pause o PJSIP tenta de novo em ate 10 s) e
    // nenhum aviso.
    REQUIRE(registrar.Control("FAIL REGISTER on") == kOk);
    REQUIRE(registrar.WaitForLog("register-503 2001", kWaitSeconds));
    CHECK_FALSE(WaitUntil([&] { return LogCount(registrar, "register-503 2001") > 1; }, 11));
    CHECK(listener.Registrations().size() == events);   // a conta parada nao avisa nada
    CHECK_FALSE(RecordingListener::Reached(200, false, 1)(listener.Registrations()));

    // A rede volta: registra de novo.
    const size_t active = CountActive(listener.Registrations());
    REQUIRE(registrar.Control("FAIL REGISTER off") == kOk);
    engine->SetNetworkAvailable(true);
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
    CHECK(registrar.Control("RING 2001") == kOk);
}

TEST_CASE("SetNetworkAvailable false returns at once and true registers again after a refresh still on the way") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(registrar.Control("EXPIRES 3") == kOk);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    // Os pacotes somem: a renovacao seguinte (a cada 2 s) fica sem resposta, e o UDP a repete (0,5 s, 1 s, 2 s...).
    REQUIRE(registrar.Control("DROP REGISTER on") == kOk);
    std::this_thread::sleep_for(std::chrono::milliseconds(2500));
    const auto start = std::chrono::steady_clock::now();
    engine->SetNetworkAvailable(false);   // nada a esperar: o motor nao pede a saida ao servidor
    CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(1));
    std::this_thread::sleep_for(std::chrono::milliseconds(500));

    // A rede volta com a renovacao ainda a caminho: a repeticao dela chega ao servidor e leva 200.
    const size_t active = CountActive(listener.Registrations());
    const size_t before = listener.Registrations().size();
    REQUIRE(registrar.Control("DROP REGISTER off") == kOk);
    engine->SetNetworkAvailable(true);
    // O registro sai logo depois da resposta da renovacao, sem esperar a nova tentativa do PJSIP (5 min).
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
    CHECK(registrar.Control("RING 2001") == kOk);
    // Nenhuma resposta deixou a conta sem registro.
    const std::vector<phone_test::RegistrationEvent> events = listener.Registrations();
    for (size_t i = before; i < events.size(); ++i) {
        CAPTURE(i);
        CHECK(events[i].active);
    }
}
