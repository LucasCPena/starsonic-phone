#include "engine_fixture.h"

#include <pjsua-lib/pjsua.h>

#include <algorithm>
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

// Os eventos da ligação callId em ordem: "Incoming" para OnIncomingCall, "<estado>/<código>" para
// OnCallState e "Transfer/<código>" para OnTransfer, como "Incoming Early/180 Confirmed/200".
std::string History(const std::vector<CallEvent>& events, int callId) {
    std::string text;
    for (const CallEvent& event : events) {
        if (event.callId != callId) continue;
        if (!text.empty()) text += " ";
        if (event.kind == CallEvent::Incoming) {
            text += "Incoming";
        } else if (event.kind == CallEvent::Transfer) {
            text += "Transfer/" + std::to_string(event.code);
        } else {
            text += std::string(phone_test::StateName(event.state)) + "/" + std::to_string(event.code);
        }
    }
    return text;
}

// Os códigos dos OnTransfer da ligação callId, em ordem.
std::vector<int> Transfers(const std::vector<CallEvent>& events, int callId) {
    std::vector<int> codes;
    for (const CallEvent& event : events) {
        if (event.kind == CallEvent::Transfer && event.callId == callId) codes.push_back(event.code);
    }
    return codes;
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

    // RING 2001, Answer e a espera pelo Confirmed.
    int Answered() {
        const int id = Ring();
        REQUIRE(engine->Answer(id));
        REQUIRE(WaitState(id, CallState::Confirmed));
        return id;
    }

    // Duas ligações do RING atendidas: first em espera e second, a ativa, já com o áudio de cada uma
    // no lugar.
    void TwoCalls(int* first, int* second) {
        *first = Answered();
        *second = Answered();
        REQUIRE(WaitLinks(*first, {}));
        REQUIRE(WaitLinks(*second, {0}));
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

    // Espera até kWaitSeconds pelo primeiro OnTransfer da ligação id.
    bool WaitTransfer(int id) {
        return listener.WaitForCalls([id](const std::vector<CallEvent>& events) { return !Transfers(events, id).empty(); },
                                     kWaitSeconds);
    }

    // Duas ligações feitas daqui: client (2002), que vai para a espera, e colleague (2003), a ativa,
    // com o som; como numa consulta antes da transferência.
    void Consultation(int* client, int* colleague) {
        *client = Dial("2002");
        *colleague = Dial("2003");
        REQUIRE(registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
        REQUIRE(WaitLinks(*client, {}));
        REQUIRE(WaitLinks(*colleague, {0}));
    }

    // Espera até kWaitSeconds que AudioLinks(id) seja `expected` (a ponte de áudio aplica as ligações
    // no tique seguinte do relógio dela).
    bool WaitLinks(int id, const std::vector<int>& expected) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kWaitSeconds);
        while (engine->AudioLinks(id) != expected) {
            if (std::chrono::steady_clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    // Espera até kWaitSeconds que a linha apareça `times` vezes no registro de ligações.
    bool WaitForLogCount(const std::string& line, size_t times) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kWaitSeconds);
        while (LogCount(line) < times) {
            if (std::chrono::steady_clock::now() >= deadline) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return true;
    }

    size_t LogCount(const std::string& line) const {
        const Lines log = registrar.Log();
        return static_cast<size_t>(std::count(log.begin(), log.end(), line));
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

TEST_CASE("MakeCall during a ringing call is refused") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    const int id = phone.Ring();   // não atende
    CHECK(phone.engine->MakeCall("2002") == -1);
    CHECK(phone.engine->CallCount() == 1);
    CHECK_FALSE(phone.engine->Activate(id));   // não confirmada
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

TEST_CASE("attended transfer sends REFER with Replaces and ends both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    // O REFER vai na ligação do cliente e aponta para a do colega (o Replaces traz o diálogo dela).
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    CHECK(phone.WaitTransfer(client));
    // O NOTIFY 200 encerra as duas: o aviso primeiro, depois o fim de cada uma.
    CHECK(phone.WaitState(client, CallState::Disconnected));
    CHECK(phone.WaitState(colleague, CallState::Disconnected));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
    CHECK(phone.engine->CallCount() == 0);
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{200});
    CHECK(Transfers(phone.listener.Calls(), colleague).empty());
    CHECK(Contains(History(phone.listener.Calls(), client), "Transfer/200 Disconnected/"));
}

TEST_CASE("attended transfer refused by the server keeps both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == Lines{"OK"});
    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    REQUIRE(phone.WaitTransfer(client));
    // Só o aviso, um: as duas seguem como estavam, o colega com o som e o cliente em espera.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{603});
    CHECK_FALSE(RecordingListener::StateReached(client, CallState::Disconnected)(phone.listener.Calls()));
    CHECK_FALSE(RecordingListener::StateReached(colleague, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(client).empty());
    CHECK(phone.LogCount("bye-in 2002") == 0);
    CHECK(phone.LogCount("bye-in 2003") == 0);
}

TEST_CASE("attended transfer that fails in the NOTIFY keeps both calls") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    REQUIRE(phone.registrar.Control("REFER_NOTIFY 486") == Lines{"OK"});
    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);

    // O REFER é aceito (202) e o NOTIFY diz que a transferência não deu certo.
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
    REQUIRE(phone.WaitTransfer(client));
    // Só o aviso, um: as duas seguem como estavam.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{486});
    CHECK_FALSE(RecordingListener::StateReached(client, CallState::Disconnected)(phone.listener.Calls()));
    CHECK_FALSE(RecordingListener::StateReached(colleague, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
}

TEST_CASE("direct transfer reports its result") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());

    // Aceita: o aviso com o código do NOTIFY e o fim da ligação. O REFER vai sem Replaces.
    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->Transfer(id, "2003"));
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003", kWaitSeconds));
    CHECK(phone.WaitTransfer(id));
    CHECK(phone.WaitState(id, CallState::Disconnected));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    CHECK(Transfers(phone.listener.Calls(), id) == std::vector<int>{200});
    CHECK(Contains(History(phone.listener.Calls(), id), "Transfer/200 Disconnected/"));

    // Recusada pelo servidor: o aviso com o código da resposta ao REFER, e a ligação continua.
    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == Lines{"OK"});
    const int other = phone.Dial("2002");
    REQUIRE(phone.WaitLinks(other, {0}));
    REQUIRE(phone.engine->Transfer(other, "2003"));
    CHECK(phone.WaitForLogCount("refer-in 2002 2003", 2));
    REQUIRE(phone.WaitTransfer(other));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(Transfers(phone.listener.Calls(), other) == std::vector<int>{603});
    CHECK_FALSE(RecordingListener::StateReached(other, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->AudioLinks(other) == std::vector<int>{0});
    CHECK(phone.LogCount("bye-in 2002") == 1);   // só o da primeira
}

TEST_CASE("TransferAttended with one call is refused") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());

    CHECK_FALSE(phone.engine->TransferAttended(1, 2));   // nenhuma ligação

    // Uma ligação confirmada: ela mesma ou um id que não existe não servem de alvo.
    const int id = phone.Answered();
    CHECK_FALSE(phone.engine->TransferAttended(id, id));
    CHECK_FALSE(phone.engine->TransferAttended(id, id + 100));
    CHECK_FALSE(phone.engine->TransferAttended(id + 100, id));

    // A segunda ligação ainda toca (não confirmada): também não.
    const int ringing = phone.Ring();
    CHECK_FALSE(phone.engine->TransferAttended(id, ringing));
    CHECK_FALSE(phone.engine->TransferAttended(ringing, id));

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    for (const std::string& line : phone.registrar.Log()) CHECK_FALSE(Contains(line, "refer-in"));
    CHECK(Transfers(phone.listener.Calls(), id).empty());
    CHECK(phone.engine->CallCount() == 2);
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
