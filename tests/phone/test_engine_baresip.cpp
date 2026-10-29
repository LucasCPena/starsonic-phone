// Só o motor do baresip: o que depende das linhas de log do baresip, os módulos que ele carrega, o que esse motor faz
// de diferente do do PJSIP (os dispositivos de som e o BLF, spec 6.1, e os dados de push no REGISTER, spec 7.3) e o que
// só aqui é conferido (o keep-alive e o motor destruído e criado de novo com a conta). O motor do PJSIP tem os testes
// dele (test_engine_pjsip.cpp).
#include "call_fixture.h"
#include "engine_fixture.h"
#include "relay_fixture.h"

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "nlohmann/json.hpp"

#include "BaresipLoop.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::Contains;
using phone_test::DelayedUdpRelay;
using phone_test::FakeRegistrar;
using phone_test::Input;
using phone_test::kOk;
using phone_test::kWaitSeconds;
using phone_test::Lines;
using phone_test::LoadProfile;
using phone_test::Phone;
using phone_test::ReadText;
using phone_test::RecordingListener;
using phone_test::Registers;
using phone_test::RegistrationsText;
using phone_test::StartEngine;
using phone_test::WaitUntil;

namespace {

// Dados de push nos dois formatos: os parâmetros do Contact da RFC 8599 e um token em cabeçalho (nenhum token de
// verdade).
const PushData kPush = {{{"pn-provider", "apns"},
                         {"pn-param", "ABCDE12345.br.com.starsonic.phone.voip"},
                         {"pn-prid", "00fc13adff78512"}},
                        {{"X-Push-Token", "00fc13adff78512"}}};

// O Contact do último REGISTER aceito do ramal 2001, como chegou ao registrador ("" se ainda não houve).
std::string LastContact(const FakeRegistrar& registrar) {
    const Lines reply = registrar.Control("CONTACT 2001");
    return reply.empty() ? std::string() : reply[0];
}

// O valor do X-Push-Token nesse REGISTER, ou o ERR do registrador.
Lines PushTokenHeader(const FakeRegistrar& registrar) { return registrar.Control("HEADER 2001 X-Push-Token"); }

// Os keep-alives que o registrador recebeu até agora (-1 se a porta de controle não respondeu).
int Keepalives(const FakeRegistrar& registrar) {
    const Lines reply = registrar.Control("KEEPALIVES");
    return reply.empty() ? -1 : std::stoi(reply[0]);
}

}  // namespace

TEST_CASE("the baresip engine loads the modules of build/deps.lock, in order") {
    // O build/baresip/build-linux.sh confere o .a contra o deps.lock, mas o CI só roda o script quando o cache do
    // baresip falta: a lista do código é conferida aqui, em todo build.
    const nlohmann::json lock = nlohmann::json::parse(ReadText(STARSONIC_REPO_DIR "/build/deps.lock"));
    const std::vector<std::string> locked = lock.at("baresip").at("modules").get<std::vector<std::string>>();
    CHECK(BaresipLoop::Modules() == locked);
}

TEST_CASE("the baresip engine sends the start-up lines of baresip to OnLog") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // Escrita pelo próprio baresip ao registrar o codec do módulo g711.
    CHECK(Contains(listener.LogTail(), "aucodec: PCMU/8000/1"));
}

TEST_CASE("the baresip engine can be created and destroyed three times in a row") {
    for (int round = 0; round < 3; ++round) {
        CAPTURE(round);
        RecordingListener listener;
        INFO(listener.LogTail());
        std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());
        CHECK(engine->ActiveCodecs() == std::vector<std::string>{"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"});
    }
}

TEST_CASE("the baresip engine lists only the null device and ignores BLF") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // Com o nullAudio dos testes, só o dispositivo nulo: o padrão (-1) não entra na lista.
    const std::vector<AudioDevice> devices = engine->AudioDevices();
    REQUIRE(devices.size() == 1);
    CHECK(devices[0].id == -2);
    CHECK(devices[0].name == "Null Audio");
    CHECK(devices[0].capture);
    CHECK(devices[0].playback);
    CHECK(engine->SetAudioDevices(-1, -1));
    CHECK(engine->SetAudioDevices(-2, -2));
    CHECK_FALSE(engine->SetAudioDevices(0, 0));

    // Sem conta: nenhum aviso de BLF, só a linha do log.
    engine->WatchBlf({"2002"});
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(listener.Blfs().empty());
    CHECK(Contains(listener.LogTail(), "BLF: sem suporte neste motor"));
}

TEST_CASE("SetPushData before SetAccount puts the push data in the REGISTER, in each format") {
    PushData push;
    bool inContact = false;
    SUBCASE("parameters in the Contact") {
        push.contactParams = kPush.contactParams;
        inContact = true;
    }
    SUBCASE("headers") { push.headers = kPush.headers; }

    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetPushData(push));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const std::string contact = LastContact(registrar);
    INFO(contact);
    if (inContact) {
        CHECK(Contains(contact,
                       ";pn-provider=apns;pn-param=ABCDE12345.br.com.starsonic.phone.voip;pn-prid=00fc13adff78512>"));
        CHECK(PushTokenHeader(registrar) == Lines{"ERR no-header"});
    } else {
        CHECK_FALSE(Contains(contact, "pn-"));
        CHECK(PushTokenHeader(registrar) == Lines{"00fc13adff78512"});
    }
}

TEST_CASE("SetPushData with a registered account registers again, the next REGISTERs keep the data, and nullopt "
          "takes them out") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK_FALSE(Contains(LastContact(registrar), "pn-"));

    REQUIRE(engine->SetPushData(kPush));   // registra de novo na hora
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(Contains(LastContact(registrar), ";pn-prid="));
    CHECK(PushTokenHeader(registrar) == Lines{"00fc13adff78512"});

    engine->Reregister();
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 3), kWaitSeconds));
    CHECK(Contains(LastContact(registrar), ";pn-prid="));
    CHECK(PushTokenHeader(registrar) == Lines{"00fc13adff78512"});

    engine->HandleIpChange();   // o iPhone trocou de rede
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 4), kWaitSeconds));
    CHECK(Contains(LastContact(registrar), ";pn-prid="));
    CHECK(PushTokenHeader(registrar) == Lines{"00fc13adff78512"});

    REQUIRE(engine->SetPushData(std::nullopt));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 5), kWaitSeconds));
    CHECK_FALSE(Contains(LastContact(registrar), "pn-"));
    CHECK(PushTokenHeader(registrar) == Lines{"ERR no-header"});
}

TEST_CASE("SetPushData without network only stores the data, and the REGISTER after the network comes back carries "
          "it") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->SetNetworkAvailable(false);
    const int before = Registers(registrar);

    REQUIRE(engine->SetPushData(kPush));   // sem rede: só guarda
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(Registers(registrar) == before);

    engine->SetNetworkAvailable(true);   // o primeiro REGISTER da volta já leva os dados
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(Contains(LastContact(registrar), ";pn-prid=00fc13adff78512"));
}

TEST_CASE("keep-alives go to the server every keepalive seconds") {
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }

    Phone phone(transport, [](Profile& profile) { profile.account.keepAliveSeconds = 1; });
    INFO(phone.listener.LogTail());
    const int start = Keepalives(phone.registrar);
    REQUIRE(start >= 0);
    CHECK(WaitUntil([&] { return Keepalives(phone.registrar) >= start + 2; }, 4));
}

TEST_CASE("destroying the engine with a REGISTER on the way returns within 5 s and reports nothing") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 60000);   // nada volta durante o teste
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    const size_t events = listener.EventCount();
    const auto start = std::chrono::steady_clock::now();
    engine.reset();
    CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(5));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(listener.EventCount() == events);
}

TEST_CASE("the engine registers each time it is created again in the same process") {
    FakeRegistrar registrar("senha");
    for (int round = 0; round < 3; ++round) {
        CAPTURE(round);
        RecordingListener listener;
        INFO(listener.LogTail());
        std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

        REQUIRE(engine->SetAccount(Input(Transport::Udp)));
        REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
        engine.reset();   // a conta sai do servidor
        CHECK(registrar.Control("RING 2001") == Lines{"ERR no-contact"});
    }
}

TEST_CASE("SetPushData with an account that is not registered sends a new REGISTER at once") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp, L"2001", L"errada")));
    // Depois de um 403 não há nova tentativa: o segundo 403 só pode vir do REGISTER do SetPushData.
    REQUIRE(listener.WaitFor(RecordingListener::Reached(403, false, 1), kWaitSeconds));
    REQUIRE(engine->SetPushData(kPush));   // com a conta e a rede, mesmo sem registro
    CHECK(listener.WaitFor(RecordingListener::Reached(403, false, 2), kWaitSeconds));
    CHECK(registrar.Control("CONTACT 2001") == Lines{"ERR no-contact"});
}

TEST_CASE("RemoveAccount with an account that is not registered sends no REGISTER and reports the exit once") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    const int id = engine->SetAccount(Input(Transport::Udp, L"2001", L"errada"));
    REQUIRE(id > 0);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(403, false, 1), kWaitSeconds));
    // Cada mensagem SIP que sai vira uma linha de log, na hora; só os pedidos têm a linha "REGISTER sip:".
    listener.CountLog("REGISTER sip:");
    engine->RemoveAccount();
    CHECK(listener.LogCount("REGISTER sip:") == 0);   // nenhum REGISTER com Expires 0
    CHECK(Contains(listener.LogTail(), "a conta nao estava registrada: nada a retirar do servidor"));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, false, 1), kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK_FALSE(RecordingListener::Reached(200, false, 2)(listener.Registrations()));
    CHECK(listener.Registrations().back().accountId == id);
}

TEST_CASE("HandleIpChange over TCP with a REGISTER on the way registers again within a few seconds") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    REQUIRE(registrar.Control("DROP REGISTER on") == kOk);
    engine->Reregister();   // o REGISTER fica a caminho, sem resposta
    // O registrador recebe e descarta o REGISTER: na conexão TCP local, em bem menos que isto.
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    REQUIRE(registrar.Control("DROP REGISTER off") == kOk);
    // O REGISTER a caminho ia pela conexão que a troca de rede fecha: sem resposta dele, o da troca não espera os 32 s
    // em que a libre o daria por perdido.
    engine->HandleIpChange();
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), 5));
}
