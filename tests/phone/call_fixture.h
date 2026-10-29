#pragma once
// Apoio aos testes de ligações do motor: o Phone (um motor registrado no registrador falso, com as esperas das
// ligações) e as funções que leem os eventos de ligação que o listener guardou.
#include "engine_fixture.h"

#include <algorithm>
#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"

namespace phone_test {

using starsonic::CallState;
using starsonic::Profile;
using starsonic::SipEngine;
using starsonic::Transport;

using Lines = std::vector<std::string>;

// O evento `kind` mais recente; em State, o mais recente OnCallState(callId, state). Falha o teste
// se não houve.
inline CallEvent Last(const std::vector<CallEvent>& events, CallEvent::Kind kind, int callId = 0,
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
inline std::string History(const std::vector<CallEvent>& events, int callId) {
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
inline std::vector<int> Transfers(const std::vector<CallEvent>& events, int callId) {
    std::vector<int> codes;
    for (const CallEvent& event : events) {
        if (event.kind == CallEvent::Transfer && event.callId == callId) codes.push_back(event.code);
    }
    return codes;
}

// Os itens em ordem crescente: o AudioLinks não promete ordem.
inline std::vector<int> Sorted(std::vector<int> items) {
    std::sort(items.begin(), items.end());
    return items;
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

    // Duas ligações feitas daqui, first (2002) e second (2003), juntas na conferência: as duas com o
    // som e ligadas entre si.
    void Conference(int* first, int* second) {
        Consultation(first, second);
        REQUIRE(engine->Join(*first, *second));
        REQUIRE(registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
        REQUIRE(WaitLinks(*first, {0, *second}));
        REQUIRE(WaitLinks(*second, {0, *first}));
    }

    // Espera até kWaitSeconds que AudioLinks(id) tenha os itens de `expected`, em qualquer ordem (a
    // ponte de áudio aplica as ligações no tique seguinte do relógio dela).
    bool WaitLinks(int id, const std::vector<int>& expected) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kWaitSeconds);
        while (Sorted(engine->AudioLinks(id)) != Sorted(expected)) {
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

}  // namespace phone_test
