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

// Correcao final (H3, A-I1 e o probe A1 do revisor A): a conta perde o registro sem o SetNetworkAvailable(false) (um
// 503 na renovacao, a central reiniciada). Na volta do registro, as assinaturas de antes da queda sao feitas de novo: a
// central pode te-las perdido, e sem isso o cartao mostraria o estado velho como o de agora por ate ~10 min.
TEST_CASE("BLF subscriptions are renewed after a registration loss the host did not see") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(registrar.Control("EXPIRES 3") == kOk);   // a renovacao a cada ~2 s
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 confirmed") == kOk);
    REQUIRE(listener.WaitForBlf("2007", BlfState::Busy, kWaitSeconds));
    REQUIRE(LogCount(registrar, "sub-in 2007 200") == 1);

    // A central reinicia: esquece as assinaturas (sem NOTIFY nenhum) e responde 503 ao REGISTER por um tempo.
    REQUIRE(registrar.Control("FORGET") == kOk);
    REQUIRE(registrar.Control("FAIL REGISTER on") == kOk);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(503, false, 1), kWaitSeconds));
    // A central volta, e a conta registra de novo (aqui pelo Reregister; na vida, a nova tentativa do PJSIP).
    const size_t active = CountActive(listener.Registrations());
    REQUIRE(registrar.Control("FAIL REGISTER off") == kOk);
    engine->Reregister();
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));

    // A assinatura de antes da queda e feita de novo, e as mudancas do ramal voltam a chegar.
    CHECK(WaitUntil([&] { return LogCount(registrar, "sub-in 2007 200") == 2; }, kWaitSeconds));
    REQUIRE(registrar.Control("BLF 2007 terminated") == kOk);
    CHECK(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
}

TEST_CASE("the network coming back after a registration loss subscribes each BLF number once") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(listener.BlfText());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(registrar.Control("EXPIRES 3") == kOk);
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));

    // A renovacao falha (a perda que marca as assinaturas de antes), e depois a rede cai.
    REQUIRE(registrar.Control("FAIL REGISTER on") == kOk);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(503, false, 1), kWaitSeconds));
    engine->SetNetworkAvailable(false);
    REQUIRE(listener.WaitForBlf("2007", BlfState::Unknown, kWaitSeconds));

    // A rede volta: a assinatura volta uma vez (a da volta da rede), e a volta do registro nao assina de novo.
    const size_t active = CountActive(listener.Registrations());
    REQUIRE(registrar.Control("FAIL REGISTER off") == kOk);
    engine->SetNetworkAvailable(true);
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
    CHECK(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    CHECK(LogCount(registrar, "sub-in 2007 200") == 2);   // a de antes da queda e a da volta
}

namespace {

// A linha do RetryBlf no log: ele rodou, na thread dos eventos, com a trava da API.
const char kRetryBlfLine[] = "BLF: a conta registrou de novo";

// A conta perde o registro (a renovacao leva 503) e registra de novo: uma volta de sem registro a registrada.
void LoseAndRegain(const FakeRegistrar& registrar, RecordingListener& listener, SipEngine& engine) {
    const size_t failures = listener.Registrations().size() - CountActive(listener.Registrations());
    REQUIRE(registrar.Control("FAIL REGISTER on") == kOk);
    REQUIRE(listener.WaitFor(
        [failures](const std::vector<phone_test::RegistrationEvent>& events) {
            return events.size() - CountActive(events) > failures;
        },
        kWaitSeconds));
    const size_t active = CountActive(listener.Registrations());
    REQUIRE(registrar.Control("FAIL REGISTER off") == kOk);
    engine.Reregister();
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, active + 1), kWaitSeconds));
}

}  // namespace

// Correcao final (H5, A-M4): sem numeros de BLF (o Android), a volta do registro nao poe o RetryBlf na fila dos
// eventos: ele esperaria a trava da API (presa ate ~2 s num HandleIpChange), e a ligacao que chega depois na mesma fila
// atrasaria com ele.
TEST_CASE("a registration without BLF numbers never queues the BLF retry behind the API lock") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    listener.CountLog(kRetryBlfLine);
    INFO(listener.LogTail());
    INFO(RegistrationsText(listener));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(registrar.Control("EXPIRES 3") == kOk);   // a renovacao a cada ~2 s
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));   // a primeira volta
    LoseAndRegain(registrar, listener, *engine);                                         // e outra
    CHECK(listener.LogCount(kRetryBlfLine) == 0);

    // Com um numero de BLF, a volta passa pelo RetryBlf (a medida acha quando ele roda).
    engine->WatchBlf({"2007"});
    REQUIRE(listener.WaitForBlf("2007", BlfState::Free, kWaitSeconds));
    LoseAndRegain(registrar, listener, *engine);
    CHECK(listener.LogCount(kRetryBlfLine) == 1);

    // A lista vazia de novo: a volta nao passa mais por ele.
    engine->WatchBlf({});
    LoseAndRegain(registrar, listener, *engine);
    CHECK(listener.LogCount(kRetryBlfLine) == 1);
}
