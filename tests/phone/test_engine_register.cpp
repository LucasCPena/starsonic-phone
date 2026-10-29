#include "engine_fixture.h"
#include "relay_fixture.h"

#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "RegistrationErrors.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::Contains;
using phone_test::DelayedUdpRelay;
using phone_test::FakeRegistrar;
using phone_test::Input;
using phone_test::kUserAgent;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::RegistrationEvent;
using phone_test::StartEngine;

namespace {

// O primeiro registro que falhou sem resposta do servidor (503 ou 408); 0 se ainda nao houve.
int FindServerFailure(const std::vector<RegistrationEvent>& events) {
    for (const RegistrationEvent& event : events) {
        if (!event.active && (event.code == 503 || event.code == 408)) return event.code;
    }
    return 0;
}

}  // namespace

TEST_CASE("SipEngine registers over UDP and sends the User-Agent") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK(registrar.UserAgent() == kUserAgent);
    CHECK(registrar.TransportUsed() == "udp");
}

TEST_CASE("SipEngine registers over TCP") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK(registrar.TransportUsed() == "tcp");
}

TEST_CASE("SipEngine registers on the port of [portas] for that server, over UDP and TCP") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile(registrar.port());
    const int wrongPort = registrar.port() == 5999 ? 5998 : 5999;   // ninguem atende nela
    profile.account.port = wrongPort;
    profile.account.serverPorts.clear();
    profile.account.serverPorts.push_back(ServerPort{Input(Transport::Udp).address, registrar.port()});
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK(registrar.TransportUsed() == "udp");
    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(registrar.TransportUsed() == "tcp");
}

TEST_CASE("SipEngine uses the server ports of the account input instead of the [portas] of the profile") {
    // A lista de servidores do administrador do app de PC (AccountInput::serverPorts) toma o lugar do [portas].
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile(registrar.port());
    const int wrongPort = registrar.port() == 5999 ? 5998 : 5999;   // ninguem atende nela
    profile.account.port = wrongPort;
    profile.account.serverPorts.clear();
    profile.account.serverPorts.push_back(ServerPort{Input(Transport::Udp).address, wrongPort});
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    AccountInput input = Input(Transport::Udp);
    input.serverPorts = std::vector<ServerPort>{ServerPort{input.address, registrar.port()}};
    REQUIRE(engine->SetAccount(input));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    // Uma lista vazia tambem vale: o servidor fora dela usa a porta da [conta].
    Profile byDefault = LoadProfile(registrar.port());
    byDefault.account.serverPorts.clear();
    byDefault.account.serverPorts.push_back(ServerPort{Input(Transport::Udp).address, wrongPort});
    engine.reset();
    RecordingListener second;
    engine = StartEngine(&second, byDefault);
    input.serverPorts = std::vector<ServerPort>();
    REQUIRE(engine->SetAccount(input));
    CHECK(second.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine.reset();   // antes do second (o motor escreve no listener ate o fim)
}

TEST_CASE("SipEngine reports a wrong password") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp, L"2001", L"errada")));
    CHECK(listener.WaitFor(RecordingListener::Reached(403, false, 1), kWaitSeconds));
    CHECK(RegistrationMessage(403, false) == L"Ramal ou senha incorretos.");
}

TEST_CASE("SipEngine registers with a UTF-8 password") {
    FakeRegistrar registrar("Senha#\xc3\xa7");   // a senha do registrador chega em UTF-8
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp, L"2001", L"Senha#\u00e7")));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
}

TEST_CASE("SipEngine reports an unreachable server") {
    RecordingListener listener;
    INFO(listener.LogTail());
    // Nada escuta nessa porta: o TCP e recusado na hora.
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(phone_test::FreePort()));

    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    REQUIRE(listener.WaitFor(
        [](const std::vector<RegistrationEvent>& events) { return FindServerFailure(events) != 0; }, kWaitSeconds));
    const int code = FindServerFailure(listener.Registrations());
    CHECK((code == 503 || code == 408));
    CHECK(RegistrationMessage(code, false) ==
          L"N\u00e3o foi poss\u00edvel falar com o servidor. Confira o endere\u00e7o e a sua internet.");
}

TEST_CASE("SipEngine registers again after HandleIpChange") {
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }

    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(transport)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->HandleIpChange();
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
}

TEST_CASE("HandleIpChange without an account returns at once and keeps TCP working") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    // A thread de eventos do pjsua já está no select() quando o pjsua fecha e reabre os listeners.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const auto start = std::chrono::steady_clock::now();
    engine->HandleIpChange();
    const auto elapsed = std::chrono::steady_clock::now() - start;
    CHECK(elapsed < std::chrono::milliseconds(1500));   // sem conta o pjsua termina na hora
    CHECK(listener.Registrations().empty());

    // O listener TCP que o pjsua refaz continua servindo as contas novas.
    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK(registrar.TransportUsed() == "tcp");
}

TEST_CASE("SipEngine registers again on demand") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->Reregister();
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
}

TEST_CASE("RemoveAccount unregisters") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->RemoveAccount();
    CHECK(listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    // O servidor tirou o contato: o RING não tem para onde ir.
    CHECK(registrar.Control("RING 2001") == std::vector<std::string>{"ERR no-contact"});
    CHECK_FALSE(RecordingListener::Reached(200, false, 2)(listener.Registrations()));
}

TEST_CASE("RemoveAccount waits for a REGISTER in flight and then leaves the server") {
    bool renewal = false;
    SUBCASE("the first REGISTER") { renewal = false; }
    SUBCASE("a renewal") { renewal = true; }

    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 150);   // cada pacote leva 150 ms em cada sentido
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    if (renewal) {
        REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
        engine->Reregister();
    }
    // O REGISTER ainda está no retransmissor: o PJSIP recusa o pedido de saída (PJSIP_EBUSY).
    engine->RemoveAccount();

    CHECK(Contains(listener.LogTail(), "REGISTER em andamento"));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    // O REGISTER chegou ao servidor e a saída veio depois dele: sem contato, o RING não tem destino.
    CHECK(registrar.Control("REGISTERS 2001") == std::vector<std::string>{renewal ? "2" : "1"});
    CHECK(registrar.Control("RING 2001") == std::vector<std::string>{"ERR no-contact"});
    CHECK_FALSE(RecordingListener::Reached(200, false, 2)(listener.Registrations()));
}

TEST_CASE("RemoveAccount reports that the account left even without an answer from the server") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 60000);   // nada volta durante o teste
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    const auto start = std::chrono::steady_clock::now();
    engine->RemoveAccount();
    CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(5));   // espera limitada (~3 s)
    CHECK(listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    CHECK(listener.Registrations().size() == 1);
    CHECK(Contains(listener.LogTail(), "sem resposta do servidor"));
}

TEST_CASE("SetAccount replaces the account and only reports the new one") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp, L"2001")));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    REQUIRE(engine->SetAccount(Input(Transport::Tcp, L"2002")));
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(registrar.TransportUsed() == "tcp");
    // A conta antiga sai sem avisar: um 200 sem registro ativo seria lido como o resultado da nova.
    CHECK_FALSE(RecordingListener::Reached(200, false, 1)(listener.Registrations()));
}

TEST_CASE("SetAccount returns increasing account ids that the registration events carry") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    const int first = engine->SetAccount(Input(Transport::Udp, L"2001"));
    REQUIRE(first > 0);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->Reregister();
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    const int second = engine->SetAccount(Input(Transport::Tcp, L"2002"));
    CHECK(second > first);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 3), kWaitSeconds));
    engine->RemoveAccount();
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    const int third = engine->SetAccount(Input(Transport::Udp, L"2001", L"errada"));
    CHECK(third > second);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(403, false, 1), kWaitSeconds));

    const std::vector<RegistrationEvent> events = listener.Registrations();
    REQUIRE(events.size() == 5);
    CHECK(events[0].accountId == first);    // o registro
    CHECK(events[1].accountId == first);    // a renovação
    CHECK(events[2].accountId == second);   // a conta que entrou no lugar
    CHECK(events[3].accountId == second);   // a saída (200, false): o id da conta que saiu
    CHECK(events[4].accountId == third);    // a recusa da conta seguinte
}

TEST_CASE("SetAccount refuses an account without address or extension") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    CHECK(engine->SetAccount(Input(Transport::Udp, L"")) == 0);
    AccountInput noAddress = Input(Transport::Udp);
    noAddress.address.clear();
    CHECK(engine->SetAccount(noAddress) == 0);
    CHECK(listener.Registrations().empty());
}
