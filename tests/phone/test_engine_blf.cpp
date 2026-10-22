#include "engine_fixture.h"

#include <algorithm>
#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "EngineEvents.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::FakeRegistrar;
using phone_test::Input;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::StartEngine;

namespace {

// Quantas vezes a linha está no registro de ligações do registrador.
size_t LogCount(const FakeRegistrar& registrar, const std::string& line) {
    const std::vector<std::string> log = registrar.Log();
    return static_cast<size_t>(std::count(log.begin(), log.end(), line));
}

// REGISTER aceitos do ramal (com Expires > 0); -1 se a porta de controle não respondeu.
int Registers(const FakeRegistrar& registrar, const std::string& ramal = "2001") {
    const std::vector<std::string> reply = registrar.Control("REGISTERS " + ramal);
    return reply.empty() ? -1 : std::stoi(reply[0]);
}

bool WaitUntil(const std::function<bool()>& condition, int seconds) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (!condition()) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return true;
}

size_t CountActive(const std::vector<phone_test::RegistrationEvent>& events) {
    return static_cast<size_t>(std::count_if(events.begin(), events.end(), [](const phone_test::RegistrationEvent& event) {
        return event.code == 200 && event.active;
    }));
}

// Os registros que chegaram, numa linha só, para as mensagens dos testes.
std::string RegistrationsText(const RecordingListener& listener) {
    std::string text;
    for (const phone_test::RegistrationEvent& event : listener.Registrations()) {
        text += std::to_string(event.code) + (event.active ? "+" : "-") + " ";
    }
    return text;
}

const std::vector<std::string> kOk = {"OK"};

}  // namespace

TEST_CASE("BlfDialogs aggregates the dialogs of a dialog-info") {
    using Dialogs = std::vector<std::pair<std::string, std::string>>;
    BlfDialogs dialogs;
    CHECK(dialogs.State() == BlfState::Free);   // nenhum diálogo

    dialogs.Apply(true, Dialogs{{"a", "terminated"}});
    CHECK(dialogs.State() == BlfState::Free);
    for (const char* ringing : {"early", "proceeding", "trying", "Early"}) {
        CAPTURE(ringing);
        dialogs.Apply(true, Dialogs{{"a", ringing}});
        CHECK(dialogs.State() == BlfState::Ringing);
    }
    dialogs.Apply(true, Dialogs{{"a", "confirmed"}});
    CHECK(dialogs.State() == BlfState::Busy);
    dialogs.Apply(true, Dialogs{{"a", "outro"}});   // um estado que a RFC 4235 não tem não conta
    CHECK(dialogs.State() == BlfState::Free);

    // Vários diálogos: tocando vale mais que ocupado, que vale mais que livre.
    dialogs.Apply(true, Dialogs{{"a", "confirmed"}, {"b", "early"}});
    CHECK(dialogs.State() == BlfState::Ringing);
    dialogs.Apply(true, Dialogs{{"a", "terminated"}, {"b", "confirmed"}});
    CHECK(dialogs.State() == BlfState::Busy);

    // partial muda só os diálogos que vieram; full troca todos.
    dialogs.Apply(true, Dialogs{{"a", "confirmed"}, {"b", "early"}});
    dialogs.Apply(false, Dialogs{{"b", "terminated"}});
    CHECK(dialogs.State() == BlfState::Busy);
    dialogs.Apply(false, Dialogs{{"c", "early"}});
    CHECK(dialogs.State() == BlfState::Ringing);
    dialogs.Apply(true, Dialogs{});
    CHECK(dialogs.State() == BlfState::Free);
    dialogs.Apply(false, Dialogs{{"a", "confirmed"}});
    dialogs.Clear();
    CHECK(dialogs.State() == BlfState::Free);
}

TEST_CASE("WatchBlf subscribes and reports each state") {
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }

    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(transport)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    // O primeiro NOTIFY não traz diálogo nenhum: livre.
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
    CHECK(registrar.LogHas("sub-in 2007 200"));

    REQUIRE(registrar.Control("BLF 2007 early") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Ringing, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 confirmed") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Busy, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 terminated") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    const std::vector<BlfState> expected = {BlfState::Free, BlfState::Ringing, BlfState::Busy, BlfState::Free};
    CHECK(listener.BlfStates("2007") == expected);   // um aviso por mudança, sem repetir o mesmo estado
}

TEST_CASE("WatchBlf with a refused subscription reports Unknown") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    SUBCASE("the SUBSCRIBE is refused") {
        REQUIRE(registrar.Control("BLF 2007 refuse") == kOk);
        engine->WatchBlf({"2007"});
        CHECK(listener.WaitForBlf("2007", BlfState::Unknown, kWaitSeconds));
        CHECK(registrar.LogHas("sub-in 2007 403"));
        CHECK(listener.BlfStates("2007") == std::vector<BlfState>{BlfState::Unknown});
    }
    SUBCASE("the server ends the subscription") {
        engine->WatchBlf({"2007"});
        REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
        REQUIRE(registrar.Control("BLF 2007 refuse") == kOk);   // NOTIFY terminated;reason=rejected
        CHECK(listener.WaitForBlf("2007", BlfState::Unknown, kWaitSeconds));
    }
}

TEST_CASE("WatchBlf removes subscriptions for numbers no longer watched") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007", "2008"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
    REQUIRE(listener.WaitForBlf("2008", BlfState::Free, kWaitSeconds));

    engine->WatchBlf({"2008"});
    CHECK(registrar.WaitForLog("unsub-in 2007", kWaitSeconds));   // SUBSCRIBE com Expires: 0
    CHECK_FALSE(registrar.LogHas("unsub-in 2008"));
    CHECK(LogCount(registrar, "sub-in 2008 200") == 1);   // o que continua não assina de novo

    // Só o ramal que continua na lista avisa.
    REQUIRE(registrar.Control("BLF 2007 early") == kOk);
    REQUIRE(registrar.Control("BLF 2008 early") == kOk);
    CHECK(listener.WaitForBlf("2008", BlfState::Ringing, kWaitSeconds));
    CHECK(listener.BlfStates("2007") == std::vector<BlfState>{BlfState::Free});

    engine->WatchBlf({});
    CHECK(registrar.WaitForLog("unsub-in 2008", kWaitSeconds));
}

TEST_CASE("SetAccount drops the BLF subscriptions of the previous account") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp, L"2001")));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    REQUIRE(engine->SetAccount(Input(Transport::Tcp, L"2002")));
    CHECK(registrar.WaitForLog("unsub-in 2007", kWaitSeconds));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    // A conta nova não herda a lista: nada assina o 2007 de novo.
    REQUIRE(registrar.Control("BLF 2007 early") == kOk);
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(LogCount(registrar, "sub-in 2007 200") == 1);
    CHECK(listener.BlfStates("2007") == std::vector<BlfState>{BlfState::Free});
}

TEST_CASE("SetNetworkAvailable false stops retries and true re-registers") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    // O registrador concede 3 s: o PJSIP renova o registro a cada 2 s, menos que a espera de 3 s abaixo. Com
    // 2 s (renovar a cada 1 s) o pjsua daria a renovação como inativa: o regIsActive conta os segundos
    // inteiros que faltam para a próxima.
    REQUIRE(registrar.Control("EXPIRES 3") == kOk);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    REQUIRE(WaitUntil([&] { return Registers(registrar) >= 3; }, kWaitSeconds));

    engine->SetNetworkAvailable(false);
    std::this_thread::sleep_for(std::chrono::milliseconds(500));   // os avisos de antes acabam de chegar
    const int stopped = Registers(registrar);
    const size_t events = listener.Registrations().size();
    std::this_thread::sleep_for(std::chrono::seconds(3));
    CHECK(Registers(registrar) == stopped);              // nenhuma renovação e nenhuma nova tentativa
    CHECK(listener.Registrations().size() == events);    // a conta parada não avisa nada
    CHECK_FALSE(RecordingListener::Reached(200, false, 1)(listener.Registrations()));
    // A conta saiu do servidor (sem rede de verdade o pedido de saída não chega, e tanto faz).
    CHECK(registrar.Control("RING 2001") == std::vector<std::string>{"ERR no-contact"});

    const size_t active = CountActive(listener.Registrations());
    engine->SetNetworkAvailable(true);
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
    CHECK(Registers(registrar) > stopped);
}

TEST_CASE("SetNetworkAvailable brings the BLF subscriptions back") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    // Sem rede: as assinaturas saem e os ramais ficam desconhecidos.
    engine->SetNetworkAvailable(false);
    CHECK(listener.WaitForBlf("2007", BlfState::Unknown, kWaitSeconds));
    CHECK(registrar.WaitForLog("unsub-in 2007", kWaitSeconds));
    // A lista muda sem rede: o ramal novo fica desconhecido e nada é assinado ainda.
    engine->WatchBlf({"2007", "2008"});
    CHECK(listener.WaitForBlf("2008", BlfState::Unknown, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 early") == kOk);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(LogCount(registrar, "sub-in 2007 200") == 1);
    CHECK_FALSE(registrar.LogHas("sub-in 2008 200"));

    // A rede volta: a conta registra e as assinaturas voltam, com o estado de agora.
    engine->SetNetworkAvailable(true);
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(listener.WaitForBlf("2007", BlfState::Ringing, kWaitSeconds));
    CHECK(listener.WaitForBlf("2008", BlfState::Free, kWaitSeconds));
    CHECK(LogCount(registrar, "sub-in 2007 200") == 2);
}

TEST_CASE("WatchBlf aggregates several dialogs of the same extension") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    // Uma ligação em andamento e outra tocando no mesmo ramal: tocando (dá para puxar).
    REQUIRE(registrar.Control("BLF 2007 confirmed+early") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Ringing, kWaitSeconds));
    // Um NOTIFY partial encerra só a que tocava: a outra continua, ocupado.
    REQUIRE(registrar.Control("BLF 2007 terminated@2") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Busy, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 terminated@1") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    const std::vector<BlfState> expected = {BlfState::Free, BlfState::Ringing, BlfState::Busy, BlfState::Free};
    CHECK(listener.BlfStates("2007") == expected);
}

TEST_CASE("SetNetworkAvailable true registers again after an unregister that was still on the way") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    // Os pacotes somem: o pedido de saída fica sem resposta, e o UDP o repete (0,5 s, 1,5 s, 3,5 s, 7,5 s...).
    REQUIRE(registrar.Control("DROP REGISTER on") == kOk);
    const auto start = std::chrono::steady_clock::now();
    engine->SetNetworkAvailable(false);   // espera a resposta da saída até ~3 s e segue sem ela
    CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(5));
    std::this_thread::sleep_for(std::chrono::seconds(1));

    // A rede volta com a saída ainda a caminho: a repetição dela chega ao servidor e leva 200 (Expires: 0).
    const size_t active = CountActive(listener.Registrations());
    const size_t before = listener.Registrations().size();
    REQUIRE(registrar.Control("DROP REGISTER off") == kOk);
    engine->SetNetworkAvailable(true);
    // O registro vai logo depois da resposta da saída, sem esperar a nova tentativa do PJSIP (5 min).
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
    CHECK(registrar.Control("RING 2001") == kOk);
    // A resposta da saída de antes não chega ao listener: a conta não "saiu".
    const std::vector<phone_test::RegistrationEvent> events = listener.Registrations();
    for (size_t i = before; i < events.size(); ++i) {
        CAPTURE(i);
        CHECK(events[i].active);
    }
}

TEST_CASE("BLF comes back when the account registers again") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    // Sem rede o servidor passa a recusar o BLF, e o REGISTER da volta se perde no começo.
    engine->SetNetworkAvailable(false);
    REQUIRE(listener.WaitForBlf("2007", BlfState::Unknown, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 refuse") == kOk);
    REQUIRE(registrar.Control("DROP REGISTER on") == kOk);
    engine->SetNetworkAvailable(true);
    // O SUBSCRIBE da volta é recusado (403): o ramal segue desconhecido.
    REQUIRE(registrar.WaitForLog("sub-in 2007 403", kWaitSeconds));
    CHECK(listener.BlfStates("2007").back() == BlfState::Unknown);

    // O servidor volta a aceitar e o REGISTER passa: o BLF volta junto com o registro, sem esperar a nova
    // tentativa do PJSIP (cerca de 5 min).
    REQUIRE(registrar.Control("BLF 2007 early") == kOk);
    REQUIRE(registrar.Control("DROP REGISTER off") == kOk);
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    CHECK(listener.WaitForBlf("2007", BlfState::Ringing, kWaitSeconds));
    CHECK(LogCount(registrar, "sub-in 2007 200") == 2);   // a de antes da queda e a que voltou
}
