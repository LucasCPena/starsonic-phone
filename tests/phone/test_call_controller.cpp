// O controlador de ligações (starsonic/phone/CallController), o porte do CallManager da 0.2 do Android
// (android/.../call/CallManagerTest.kt), com o motor, o ouvinte, o relógio e os contatos falsos
// (fake_call_engine.h). O MakeCall roda na hora, dentro do Dial. Sem o Telecom: o que era dele (a
// ligação da operadora, a espera pedida por ele, a Connection que falha) não existe no Windows.
// Uma ligação (Task 2 da W1) e duas: a segunda que toca, Alternar, a volta sozinha, a em espera que cai
// e a Nova ligação (Task 3); a transferência com consulta e a conferência (Task 4).
#include "doctest/doctest.h"

#include <algorithm>
#include <chrono>
#include <future>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "CallController.h"
#include "CallMessages.h"
#include "Text.h"
#include "fake_call_engine.h"

namespace doctest {

// As listas e os pares nas mensagens do doctest quando uma comparação falha.
template <typename T>
struct StringMaker<std::vector<T>> {
    static String convert(const std::vector<T>& values) {
        std::ostringstream out;
        out << "[";
        for (size_t i = 0; i < values.size(); ++i) out << (i ? ", " : "") << toString(values[i]).c_str();
        out << "]";
        return out.str().c_str();
    }
};

template <typename A, typename B>
struct StringMaker<std::pair<A, B>> {
    static String convert(const std::pair<A, B>& value) {
        std::ostringstream out;
        out << "(" << toString(value.first).c_str() << ", " << toString(value.second).c_str() << ")";
        return out.str().c_str();
    }
};

}  // namespace doctest

using namespace starsonic;
using phone_test::FakeCallEngine;
using phone_test::FakeCallListener;
using phone_test::FakeContactNames;
using phone_test::FakeTime;

namespace {

// Os textos em pt-BR, em UTF-8 (os literais do C++ ficam em ASCII: build/check_source_text.py).
std::string U8(const std::wstring& text) { return WideToUtf8(text); }

std::string Missed(const std::string& who) { return U8(L"Liga\u00e7\u00e3o perdida de ") + who; }

std::string EndMessage(int sipCode) { return U8(CallEndMessage(sipCode)); }

const std::wstring kNoConnection = L"Sem conex\u00e3o com o servidor. Tente de novo em instantes.";
const std::wstring kTransferRefused = L"O servidor n\u00e3o aceitou a transfer\u00eancia.";

CallView View(int id, const std::string& number, const std::string& name, bool incoming, CallView::Phase phase,
              int64_t activeSinceMs = 0, bool held = false) {
    CallView view;
    view.id = id;
    view.number = number;
    view.name = name;
    view.incoming = incoming;
    view.phase = phase;
    view.activeSinceMs = activeSinceMs;
    view.held = held;
    return view;
}

Recent MakeRecent(const std::string& number, const std::string& name, Recent::Kind kind, int64_t startMs,
                  int64_t durationMs) {
    Recent recent;
    recent.number = number;
    recent.name = name;
    recent.kind = kind;
    recent.startMs = startMs;
    recent.durationMs = durationMs;
    return recent;
}

// O que a tela mostra com uma ligação (top) ou com duas (top e second, tocando ou em espera).
CallSnapshot One(const CallView& top) {
    CallSnapshot snapshot;
    snapshot.top = top;
    return snapshot;
}

CallSnapshot Two(const CallView& top, const CallView& second, CallSnapshot::SecondKind kind) {
    CallSnapshot snapshot;
    snapshot.top = top;
    snapshot.second = second;
    snapshot.secondKind = kind;
    return snapshot;
}

// A mesma ligação, em espera.
CallView Held(CallView view) {
    view.held = true;
    return view;
}

// O snapshot na consulta (colleagueActive: o colega é a de cima).
CallSnapshot Consulting(CallSnapshot snapshot, bool colleagueActive) {
    snapshot.consulting = true;
    snapshot.colleagueActive = colleagueActive;
    return snapshot;
}

// As duas em conferência desde sinceMs: nenhuma em espera.
CallSnapshot Conference(const CallView& top, const CallView& second, int64_t sinceMs) {
    CallSnapshot snapshot = Two(top, second, CallSnapshot::Held);
    snapshot.conference = true;
    snapshot.conferenceSinceMs = sinceMs;
    return snapshot;
}

// O snapshot com o aviso de agora.
CallSnapshot WithMessage(CallSnapshot snapshot, const std::string& message) {
    snapshot.endMessage = message;
    return snapshot;
}

// "<nome ou número> desligou".
std::string HungUp(const std::string& who) { return who + " desligou"; }

using Rings = std::vector<RingKind>;
using Holds = std::vector<std::pair<int, bool>>;
using Pairs = std::vector<std::pair<int, std::string>>;
using Ints = std::vector<int>;
using IntPairs = std::vector<std::pair<int, int>>;
using Recents = std::vector<Recent>;
using Strings = std::vector<std::string>;

// O controlador com os falsos; registered é o que o predicado do registro devolve.
struct Fixture {
    FakeCallEngine engine;
    FakeCallListener listener;
    FakeTime time;
    FakeContactNames contacts;
    bool registered = true;
    CallController calls{engine,   listener, time, time, contacts, [](std::string raw) { return raw; },
                         [this] { return registered; }};

    // Uma ligação chega e toca (o motor responde 180 sozinho).
    void Ring(int id = 1, const std::string& number = "3001", const std::string& name = "Cliente Teste") {
        calls.OnIncomingCall(id, number, name);
        calls.OnCallState(id, CallState::Early, 180);
    }

    // A pessoa atende, e o motor confirma.
    void AnswerCall(int id = 1) {
        calls.Answer();
        calls.OnCallState(id, CallState::Connecting, 200);
        calls.OnCallState(id, CallState::Confirmed, 200);
    }

    // Uma ligação feita: o Dial já chama o MakeCall (o id da ligação no motor).
    int DialOut(const std::string& raw) {
        REQUIRE(calls.Dial(raw));
        return engine.nextCallId - 1;
    }

    // O Consultar para raw, com o cliente em andamento: o MakeCall do colega já roda (o id do colega).
    int ConsultOut(const std::string& raw) {
        REQUIRE(calls.Consult(raw));
        return engine.nextCallId - 1;
    }

    // Duas ligações em andamento: a recebida 1 ("Cliente Teste"), em espera, e a feita para 2002, a
    // ativa, atendida 10 s depois da primeira (o id dela no motor).
    int TwoCalls() {
        Ring(1);
        AnswerCall(1);
        time.Advance(10000);
        const int id = DialOut("2002");
        calls.OnCallState(id, CallState::Confirmed, 200);
        return id;
    }

    CallSnapshot State() const { return listener.State(); }
    std::optional<CallView> Top() const { return listener.State().top; }
    std::string Message() const { return listener.State().endMessage; }
    CallView::Phase PhaseOfTop() const {
        REQUIRE(Top().has_value());
        return Top()->phase;
    }
};

}  // namespace

TEST_CASE_FIXTURE(Fixture, "incoming call while idle rings") {
    calls.OnIncomingCall(1, "3001", "Cliente Teste");
    CHECK(Top() == View(1, "3001", "Cliente Teste", true, CallView::Ringing));
    CHECK_FALSE(State().second.has_value());
    CHECK(State().secondKind == CallSnapshot::None);
    CHECK(listener.rings == Rings{RingKind::Full});
    CHECK(engine.rejects.empty());
    CHECK(listener.recents.empty());
    calls.Answer();
    CHECK(engine.answers == Ints{1});
    CHECK(listener.rings == Rings{RingKind::Full, RingKind::Stop});
}

TEST_CASE_FIXTURE(Fixture, "a call the engine refused as busy is missed") {
    calls.OnRejectedBusy("3003", "Fulano");
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3003", "Fulano", Recent::Missed, time.NowMs(), 0)});
    CHECK(listener.missed == Strings{Missed("3003")});
    CHECK_MESSAGE(listener.rings.empty(), "nada toca");
    CHECK_FALSE(Top().has_value());
}

TEST_CASE_FIXTURE(Fixture, "caller giving up before answer is a missed call") {
    const int64_t start = time.NowMs();
    Ring(1);
    time.Advance(5000);
    calls.OnCallState(1, CallState::Disconnected, 487);
    CHECK(listener.missed == Strings{Missed("3001")});
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Missed, start, 0)});
    CHECK_MESSAGE((listener.rings == Rings{RingKind::Full, RingKind::Stop}), "o toque para");
    CHECK_FALSE(Top().has_value());
    CHECK_MESSAGE(Message() == "", "o CallEndMessage e so das feitas");
}

TEST_CASE_FIXTURE(Fixture, "answered incoming call is received with its duration") {
    const int64_t start = time.NowMs();
    Ring(1);
    time.Advance(3000);
    calls.Answer();
    CHECK(engine.answers == Ints{1});
    CHECK_MESSAGE(listener.Ring() == RingKind::Stop, "o toque para ao atender");
    // Atendida aqui, esperando o motor confirmar: em andamento, sem o tempo contando.
    CHECK(Top() == View(1, "3001", "Cliente Teste", true, CallView::Active, 0));
    calls.OnCallState(1, CallState::Connecting, 200);
    calls.OnCallState(1, CallState::Confirmed, 200);
    CHECK(Top() == View(1, "3001", "Cliente Teste", true, CallView::Active, time.NowMs()));
    time.Advance(42000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 42000)});
    CHECK(listener.missed.empty());
    CHECK_FALSE(Top().has_value());
}

TEST_CASE_FIXTURE(Fixture, "Recusar records a missed call without the notification") {
    Ring(1);
    calls.Reject();
    CHECK(engine.rejects == Ints{1});
    CHECK_MESSAGE(listener.Ring() == RingKind::Stop, "o toque para ao recusar");
    CHECK_MESSAGE(!Top().has_value(), "a tela sai na hora");
    calls.OnCallState(1, CallState::Disconnected, 486);
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Missed);
    CHECK(listener.missed.empty());
    CHECK_MESSAGE(Message() == "", "o 486 e a resposta daqui");
}

TEST_CASE_FIXTURE(Fixture, "dial without registration shows the message") {
    registered = false;
    CHECK_FALSE(calls.Dial("2002"));
    CHECK(Message() == U8(kNoConnection));
    CHECK(engine.made.empty());
    CHECK_FALSE(Top().has_value());
    time.Advance(2000);
    CHECK(Message() == "");
}

TEST_CASE_FIXTURE(Fixture, "dial normalizes the number") {
    CHECK_FALSE(calls.Dial(""));
    CHECK_FALSE(calls.Dial("   "));
    CHECK_FALSE_MESSAGE(calls.Dial("-()."), "sem nada depois de tirar os separadores");
    CHECK(listener.snapshots.empty());
    // A tela já tem a feita, sem o id do motor, antes de o MakeCall voltar; depois, com ele.
    std::vector<CallSnapshot> seenDuringMakeCall;
    engine.duringMakeCall = [&](int) { seenDuringMakeCall = listener.snapshots; };
    CHECK(calls.Dial("+55 (11) 5060-3000"));
    CHECK(engine.made == Strings{"+551150603000"});
    REQUIRE(seenDuringMakeCall.size() == 1);
    CHECK(seenDuringMakeCall[0].top == View(CallController::kNoId, "+551150603000", "", false, CallView::Dialing));
    REQUIRE(listener.snapshots.size() == 2);
    CHECK(listener.snapshots[0].top ==
          View(CallController::kNoId, "+551150603000", "", false, CallView::Dialing));
    CHECK(Top() == View(10, "+551150603000", "", false, CallView::Dialing));
}

TEST_CASE_FIXTURE(Fixture, "busy outgoing call shows Ocupado for 2 seconds") {
    const int64_t start = time.NowMs();
    const int id = DialOut("486");
    calls.OnCallState(id, CallState::Calling, 0);
    calls.OnCallState(id, CallState::Disconnected, 486);
    CHECK_MESSAGE(Message() == EndMessage(486), "o aviso do nucleo para o 486 (Ocupado)");
    CHECK(Message() == "Ocupado");
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("486", "", Recent::Outgoing, start, 0)});
    time.Advance(1999);
    CHECK(Message() == "Ocupado");
    time.Advance(1);
    CHECK(Message() == "");
}

TEST_CASE_FIXTURE(Fixture, "events before makeCall returns belong to the outgoing call") {
    // O motor avisa o Calling (e até o fim) antes de o MakeCall voltar a quem ligou.
    engine.duringMakeCall = [this](int id) { calls.OnCallState(id, CallState::Calling, 0); };
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(PhaseOfTop() == CallView::Active);
    engine.duringMakeCall = nullptr;
    calls.Hangup();
    CHECK(engine.hangups == Ints{id});
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK(Message() == "");

    engine.duringMakeCall = [this](int next) {
        calls.OnCallState(next, CallState::Calling, 0);
        calls.OnCallState(next, CallState::Disconnected, 404);
    };
    DialOut("9999");
    CHECK(Message() == EndMessage(404));
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents.size() == 2);
    engine.duringMakeCall = nullptr;
    CHECK_MESSAGE(calls.Dial("2002"), "uma ligacao nova depois");
}

TEST_CASE_FIXTURE(Fixture, "a late event of another call is not taken for the outgoing call") {
    engine.duringMakeCall = [this](int id) {
        calls.OnIncomingCall(1, "3001", "");   // chegou com a feita esperando o id: ocupado
        calls.OnCallState(1, CallState::Disconnected, 486);   // o fim da recusada não é da feita
        calls.OnCallState(id, CallState::Calling, 0);
    };
    const int id = DialOut("2002");
    CHECK(engine.rejects == Ints{1});
    CHECK(listener.missed == Strings{Missed("3001")});
    CHECK(PhaseOfTop() == CallView::Dialing);
    CHECK(Top()->id == id);
    CHECK(Message() == "");
    calls.OnCallState(1, CallState::Confirmed, 200);   // de outra ligação: nada
    CHECK(PhaseOfTop() == CallView::Dialing);
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(PhaseOfTop() == CallView::Active);
}

TEST_CASE_FIXTURE(Fixture, "a new call waits for the end of the rejected one") {
    calls.OnIncomingCall(1, "3001", "");
    calls.Reject();
    CHECK_FALSE_MESSAGE(calls.Dial("2002"), "a recusada ainda nao acabou no motor");
    CHECK(engine.made.empty());
    calls.OnCallState(1, CallState::Disconnected, 486);
    CHECK(calls.Dial("2002"));
}

TEST_CASE_FIXTURE(Fixture, "failed makeCall ends the outgoing call") {
    engine.refuse = true;
    DialOut("2002");
    CHECK_FALSE(Top().has_value());
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Outgoing);
    CHECK(engine.hangups.empty());
    CHECK(Message() == "");
    engine.refuse = false;
    CHECK(calls.Dial("2002"));
}

TEST_CASE_FIXTURE(Fixture, "hold, mute, keypad and transfer act on the active call") {
    const int id = DialOut("2002");
    calls.Hold(std::nullopt);   // ainda chamando: nada
    CHECK_FALSE(calls.Transfer("2003"));
    calls.Dtmf("1");
    CHECK(engine.holds.empty());
    CHECK(engine.transfers.empty());
    CHECK(engine.dtmfs.empty());
    calls.OnCallState(id, CallState::Confirmed, 200);
    calls.Hold(std::nullopt);
    CHECK(engine.holds == Holds{{id, true}});
    CHECK(Top()->held);
    calls.Hold(std::nullopt);
    CHECK(engine.holds == Holds{{id, true}, {id, false}});
    CHECK_FALSE(Top()->held);
    calls.Mute(std::nullopt);
    CHECK(engine.mutes == std::vector<bool>{true});
    CHECK(State().muted);
    calls.Dtmf("5");
    CHECK(engine.dtmfs == Pairs{{id, "5"}});
    CHECK(calls.Transfer(" 20-03 "));
    CHECK(engine.transfers == Pairs{{id, "2003"}});
    calls.OnCallState(id, CallState::Disconnected, 200);   // o PABX aceitou a transferência e o motor desligou
    CHECK_MESSAGE((engine.mutes == std::vector<bool>{true, false}), "o mudo sai no fim da ligacao");
    CHECK_FALSE(State().muted);
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Outgoing);
}

TEST_CASE_FIXTURE(Fixture, "Hold and Mute take the asked value, and mute waits for the answer") {
    Ring(1);
    calls.Mute(true);   // tocando: nada
    CHECK(engine.mutes.empty());
    calls.Answer();
    calls.Hold(true);   // atendida, mas o motor ainda não confirmou: nada
    CHECK(engine.holds.empty());
    calls.Mute(true);
    calls.Mute(true);   // já mudo: nada
    CHECK(engine.mutes == std::vector<bool>{true});
    CHECK(State().muted);
    calls.OnCallState(1, CallState::Confirmed, 200);
    calls.Hold(false);   // já fora da espera: nada
    calls.Hold(true);
    calls.Hold(true);
    CHECK(engine.holds == Holds{{1, true}});
    calls.Hold(false);
    CHECK(engine.holds == Holds{{1, true}, {1, false}});
    calls.Mute(false);
    calls.Mute(std::nullopt);
    CHECK(engine.mutes == std::vector<bool>{true, false, true});
    calls.Hangup();
    CHECK(engine.hangups == Ints{1});
    CHECK_FALSE_MESSAGE(Top().has_value(), "a tela sai na hora");
    calls.Mute(false);   // saindo: nada
    CHECK(engine.mutes == std::vector<bool>{true, false, true});
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_MESSAGE((engine.mutes == std::vector<bool>{true, false, true, false}), "o mudo sai com a ultima");
}

TEST_CASE_FIXTURE(Fixture, "CallController ignores engine events after logout") {
    Ring(1);
    calls.OnLogout();
    CHECK_FALSE(Top().has_value());
    CHECK_MESSAGE(engine.hangups == Ints{1}, "a que tocava sai");
    CHECK(listener.rings == Rings{RingKind::Full, RingKind::Stop});
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Missed);
    calls.OnIncomingCall(2, "3002", "");
    calls.OnCallState(1, CallState::Confirmed, 200);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRejectedBusy("3003", "");
    calls.OnTransfer(1, 603);
    CHECK(engine.rejects.empty());
    CHECK(engine.hangups == Ints{1});
    CHECK_FALSE(Top().has_value());
    CHECK(Message() == "");
    CHECK(listener.missed.empty());
    CHECK(listener.recents.size() == 1);
    CHECK(listener.rings.size() == 2);
    CHECK_MESSAGE(contacts.lookups == Strings{"3001"}, "nem a agenda e lida");
    CHECK_FALSE(calls.Dial("2002"));
    CHECK(engine.made.empty());
    calls.OnLogin();   // o próximo Entrar
    calls.OnIncomingCall(4, "3004", "");
    CHECK(Top() == View(4, "3004", "", true, CallView::Ringing));
    CHECK(listener.Ring() == RingKind::Full);
}

TEST_CASE_FIXTURE(Fixture, "hanging up while makeCall is on the way hangs up the call it returns") {
    engine.duringMakeCall = [this](int) { calls.Hangup(); };   // o MakeCall ainda não voltou: a feita não tem id
    const int id = DialOut("2002");
    CHECK(engine.hangups == Ints{id});
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(Message() == "");
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Outgoing);
}

TEST_CASE_FIXTURE(Fixture, "an outgoing call hung up here shows no message whatever the code") {
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Calling, 0);
    calls.Hangup();
    CHECK(engine.hangups == Ints{id});
    calls.OnCallState(id, CallState::Disconnected, 603);   // a resposta daqui, não a do outro lado
    CHECK(Message() == "");
    CHECK(time.Pending() == 0);
}

TEST_CASE_FIXTURE(Fixture, "Desligar on the call screen while makeCall is on the way hangs up the call it returns") {
    // O MakeCall demora (o motor ocupado): a tela já mostra a feita, e a pessoa toca Desligar nela.
    std::vector<CallSnapshot> seen;
    engine.duringMakeCall = [&](int) {
        seen = listener.snapshots;
        if (!seen.empty() && seen.back().top && seen.back().top->phase == CallView::Dialing) calls.Hangup();
    };
    const int id = DialOut("2002");
    REQUIRE(seen.size() == 1);
    CHECK(seen[0].top == View(CallController::kNoId, "2002", "", false, CallView::Dialing));
    CHECK(engine.hangups == Ints{id});
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(Message() == "");
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "logout while makeCall is on the way hangs up the call it returns") {
    engine.duringMakeCall = [this](int) { calls.OnLogout(); };
    const int id = DialOut("2002");
    CHECK_MESSAGE(engine.hangups == Ints{id}, "a ligacao que ficou no motor sai");
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "an answered outgoing call that drops shows no message") {
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    time.Advance(30000);
    calls.OnCallState(id, CallState::Disconnected, 408);   // caiu depois da conversa (ex.: troca de rede)
    CHECK(Message() == "");
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].durationMs == 30000);
}

TEST_CASE_FIXTURE(Fixture, "a call ignored after logout is not taken for the outgoing call after login") {
    calls.OnLogout();
    calls.OnIncomingCall(5, "3005", "");   // ignorada: a conta saiu
    calls.OnLogin();
    engine.duringMakeCall = [this](int id) {
        calls.OnCallState(5, CallState::Disconnected, 480);   // o fim dela chega com a feita esperando o id
        calls.OnCallState(id, CallState::Calling, 0);
    };
    const int id = DialOut("2002");
    CHECK(PhaseOfTop() == CallView::Dialing);
    CHECK(Message() == "");
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(PhaseOfTop() == CallView::Active);
}

TEST_CASE_FIXTURE(Fixture, "the id from makeCall wins over an event of another call taken before it") {
    engine.duringMakeCall = [this](int) { calls.OnCallState(7, CallState::Calling, 0); };   // nunca vista
    const int id = DialOut("2002");
    CHECK(id == 10);
    CHECK_MESSAGE(engine.hangups == Ints{7}, "a outra sai");
    CHECK(Top()->id == id);
    calls.OnCallState(7, CallState::Confirmed, 200);   // não é dela
    CHECK(PhaseOfTop() == CallView::Dialing);
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(PhaseOfTop() == CallView::Active);
}

TEST_CASE_FIXTURE(Fixture, "an end of another call taken before makeCall returns does not leave the call in the engine") {
    engine.duringMakeCall = [this](int) { calls.OnCallState(7, CallState::Disconnected, 404); };
    const int id = DialOut("2002");
    CHECK_FALSE(Top().has_value());
    CHECK_MESSAGE(engine.hangups == Ints{id}, "a ligacao do motor, sem dono, sai");
}

TEST_CASE_FIXTURE(Fixture, "listener callbacks run without the CallController lock") {
    // Outra thread tenta usar o controlador por até 1 s dentro de cada aviso: se o aviso saísse com a
    // trava presa, ela não conseguiria.
    std::vector<std::thread> others;
    Strings heldDuring;
    listener.during = [&](const std::string& what) {
        auto done = std::make_shared<std::promise<void>>();
        std::future<void> finished = done->get_future();
        others.emplace_back([this, done] {
            calls.Dtmf("");
            done->set_value();
        });
        if (finished.wait_for(std::chrono::seconds(1)) != std::future_status::ready) heldDuring.push_back(what);
    };
    calls.OnIncomingCall(1, "3001", "");
    calls.Answer();
    calls.OnCallState(1, CallState::Confirmed, 200);
    calls.OnCallState(1, CallState::Disconnected, 200);
    calls.OnRejectedBusy("3003", "");
    registered = false;
    calls.Dial("2002");
    listener.during = nullptr;
    for (std::thread& other : others) other.join();
    CHECK(heldDuring.empty());
    CHECK_MESSAGE(others.size() >= 6, "snapshot, toque, Recentes e perdida");
}

TEST_CASE_FIXTURE(Fixture, "a listener calling the controller back sees its publications in order") {
    // O ouvinte desliga quando a ligação fica em andamento: o estado desse pedido sai depois do que o provocou.
    listener.during = [this](const std::string& what) {
        const CallSnapshot state = listener.State();
        if (what == "OnSnapshot" && state.top && state.top->phase == CallView::Active && state.top->activeSinceMs > 0) {
            calls.Hangup();
        }
    };
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    listener.during = nullptr;
    CHECK(engine.hangups == Ints{id});
    REQUIRE(listener.snapshots.size() >= 2);
    CHECK(listener.snapshots[listener.snapshots.size() - 2].top->phase == CallView::Active);
    CHECK_FALSE(Top().has_value());
}

TEST_CASE_FIXTURE(Fixture, "hanging up an outgoing call that took another call's event hangs up the call from makeCall") {
    // O evento de outra ligação foi tomado pela feita, e a pessoa desligou antes de o MakeCall voltar.
    engine.duringMakeCall = [this](int) {
        calls.OnCallState(7, CallState::Calling, 0);
        calls.Hangup();
    };
    const int id = DialOut("2002");
    CHECK(std::count(engine.hangups.begin(), engine.hangups.end(), id) == 1);
    CHECK(std::count(engine.hangups.begin(), engine.hangups.end(), 7) >= 1);
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(Message() == "");
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "a second incoming call while dialing is rejected busy") {
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Calling, 0);
    calls.OnIncomingCall(id + 1, "3002", "");
    CHECK(engine.rejects == Ints{id + 1});
    CHECK_MESSAGE(listener.rings.empty(), "nada toca");
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3002", "", Recent::Missed, time.NowMs(), 0)});
    CHECK(listener.missed == Strings{Missed("3002")});
    CHECK(Top() == View(id, "2002", "", false, CallView::Dialing));
    calls.OnCallState(id + 1, CallState::Disconnected, 486);   // o fim da recusada não mexe na feita
    CHECK(PhaseOfTop() == CallView::Dialing);
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(Top() == View(id, "2002", "", false, CallView::Active, time.NowMs()));
    CHECK_FALSE(State().second.has_value());
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "a refused direct transfer shows the message") {
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    const std::optional<CallView> call = Top();
    CHECK(calls.Transfer("2003"));
    CHECK(engine.transfers == Pairs{{id, "2003"}});
    CHECK_FALSE_MESSAGE(calls.Transfer("2004"), "um pedido por vez, ate o resultado");
    calls.OnTransfer(id, 603);
    CHECK(Message() == U8(kTransferRefused));
    CHECK_MESSAGE(Top() == call, "a ligacao continua");
    CHECK(engine.hangups.empty());
    time.Advance(1999);
    CHECK(Message() == U8(kTransferRefused));
    time.Advance(1);
    CHECK(Message() == "");
    calls.OnTransfer(99, 603);   // de outra ligação: nada
    calls.OnTransfer(id, 603);   // sem pedido esperando: nada
    CHECK(Message() == "");
    // De novo, e o servidor aceita: nada, até o fim que o motor manda.
    CHECK(calls.Transfer("2003"));
    calls.OnTransfer(id, 200);
    CHECK(Message() == "");
    CHECK(Top() == call);
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(Message() == "");
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0].kind == Recent::Outgoing);
}

TEST_CASE_FIXTURE(Fixture, "a new end message replaces the one on screen for 2 more seconds") {
    registered = false;
    calls.Dial("2002");
    time.Advance(1500);
    registered = true;
    const int id = DialOut("2003");
    CHECK_MESSAGE(Message() == "", "a feita limpa o aviso");
    calls.OnCallState(id, CallState::Disconnected, 480);
    CHECK(Message() == EndMessage(480));
    time.Advance(500);   // o prazo do primeiro aviso, que já saiu
    CHECK(Message() == EndMessage(480));
    time.Advance(1500);
    CHECK(Message() == "");
    CHECK(time.Pending() == 0);
}

TEST_CASE_FIXTURE(Fixture, "the ring follows the incoming call") {
    Ring(1);
    CHECK_MESSAGE(listener.snapshots.size() == 1, "o 180 nao muda nada na tela");
    CHECK(listener.rings == Rings{RingKind::Full});
    calls.Reject();
    calls.OnCallState(1, CallState::Disconnected, 486);
    Ring(2, "3002", "");
    calls.OnCallState(2, CallState::Disconnected, 487);   // quem ligou desistiu
    Ring(3, "3003", "");
    AnswerCall(3);
    calls.Hangup();
    calls.OnCallState(3, CallState::Disconnected, 200);
    Ring(4, "3004", "");
    calls.OnLogout();
    CHECK(listener.rings == Rings{RingKind::Full, RingKind::Stop, RingKind::Full, RingKind::Stop, RingKind::Full,
                                  RingKind::Stop, RingKind::Full, RingKind::Stop});
}

TEST_CASE("DialContact dials the number from the contact rule") {
    FakeCallEngine engine;
    FakeCallListener listener;
    FakeTime time;
    FakeContactNames contacts;
    CallController calls(engine, listener, time, time, contacts, [](std::string raw) {
        return WideToUtf8(ContactDialString(Utf8ToWide(raw), L"55", L"0"));
    });
    CHECK(calls.DialContact("+55 11 98765-4321"));
    CHECK(engine.made == Strings{"011987654321"});
    calls.Hangup();
    calls.OnCallState(10, CallState::Disconnected, 487);
    CHECK_FALSE_MESSAGE(calls.DialContact(" - "), "a regra nao deu numero");
    CHECK(engine.made.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "the phone contact names the calls and the messages, and the Recents keep the server name") {
    contacts.names["3001"] = "Maria Silva";
    contacts.names["3002"] = U8(L"Jo\u00e3o Souza");
    const int64_t start = time.NowMs();
    Ring(1, "3001", "Cliente Teste");
    CHECK(Top() == View(1, "3001", "Maria Silva", true, CallView::Ringing));
    AnswerCall(1);
    CHECK(Top()->name == "Maria Silva");
    // A segunda, de outro contato: a faixa e, atendida, o cartão de cima; a primeira no cartão "Em espera".
    Ring(2, "3002", "Fulano");
    CHECK(State().second == View(2, "3002", U8(L"Jo\u00e3o Souza"), true, CallView::Ringing));
    CHECK(State().secondKind == CallSnapshot::Ringing);
    AnswerCall(2);
    CHECK(Top()->name == U8(L"Jo\u00e3o Souza"));
    CHECK(State().second == View(1, "3001", "Maria Silva", true, CallView::Active, start, true));
    CHECK(State().secondKind == CallSnapshot::Held);
    // A em espera cai do outro lado: o aviso com o nome do contato.
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(Message() == HungUp("Maria Silva"));
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 0)});
    CHECK_MESSAGE((contacts.lookups == Strings{"3001", "3002"}), "cada numero procurado uma vez, quando a ligacao chegou");
}

TEST_CASE_FIXTURE(Fixture, "a missed call from a phone contact names the contact") {
    contacts.names["3001"] = "Maria Silva";
    Ring(1, "3001", "Cliente Teste");
    calls.OnCallState(1, CallState::Disconnected, 487);
    calls.OnRejectedBusy("3001", "Cliente Teste");
    calls.OnRejectedBusy("3005", "Fulano");
    calls.OnRejectedBusy("", "Sem Numero");
    CHECK(listener.missed ==
          Strings{Missed("Maria Silva"), Missed("Maria Silva"), Missed("3005"), Missed("Sem Numero")});
    REQUIRE(listener.recents.size() == 4);
    CHECK(listener.recents[0].name == "Cliente Teste");
    CHECK(listener.recents[1].name == "Cliente Teste");
    CHECK(listener.recents[2].name == "Fulano");
}

TEST_CASE_FIXTURE(Fixture, "an outgoing call shows the phone contact name") {
    contacts.names["3001"] = "Maria Silva";
    const int id = DialOut("30-01");
    CHECK(Top()->name == "Maria Silva");
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(Top()->name == "Maria Silva");
    calls.Hangup();
    calls.OnCallState(id, CallState::Disconnected, 200);
    REQUIRE(listener.recents.size() == 1);
    CHECK_MESSAGE(listener.recents[0].name == "", "os Recentes guardam o nome que a central mandou (nenhum)");
    CHECK(contacts.lookups == Strings{"3001"});
}

// Duas ligações (spec da 0.2, 7.1 e 7.2): até duas, uma ativa; a outra toca, chama ou fica em espera.

TEST_CASE_FIXTURE(Fixture, "a second incoming call rings while one is active") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    CHECK_MESSAGE(engine.rejects.empty(), "a segunda toca, sem ocupado");
    const CallView first = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    CHECK(State() == Two(first, View(2, "3002", "Fulano", true, CallView::Ringing), CallSnapshot::Ringing));
    CHECK(listener.Ring() == RingKind::Waiting);
    CHECK_MESSAGE((engine.holds.empty() && engine.activated.empty()), "a primeira fica com o som ate atender");
    // Recusar: ocupado na segunda, perdida sem o aviso, e a primeira segue.
    calls.Reject();
    CHECK(engine.rejects == Ints{2});
    CHECK_MESSAGE(listener.Ring() == RingKind::Stop, "o toque da segunda para");
    CHECK_MESSAGE(State() == One(first), "a faixa sai na hora");
    calls.OnCallState(2, CallState::Disconnected, 486);
    CHECK(listener.missed.empty());
    CHECK(State() == One(first));
    // Com a primeira em espera, outra também toca; quem ligou desiste: perdida, com o aviso.
    calls.Hold(true);
    CHECK(engine.holds == Holds{{1, true}});
    time.Advance(1000);
    Ring(3, "3003", "");
    CallView firstHeld = first;
    firstHeld.held = true;
    CHECK(State() == Two(firstHeld, View(3, "3003", "", true, CallView::Ringing), CallSnapshot::Ringing));
    calls.OnCallState(3, CallState::Disconnected, 487);
    CHECK(listener.missed == Strings{Missed("3003")});
    CHECK(State() == One(firstHeld));
    CHECK_MESSAGE(engine.activated.empty(), "a em espera nao volta sozinha");
    CHECK(Message() == "");
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3002", "Fulano", Recent::Missed, start + 10000, 0),
                                                  MakeRecent("3003", "", Recent::Missed, start + 11000, 0)});
}

TEST_CASE_FIXTURE(Fixture, "answering the second call holds the first") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    time.Advance(2000);
    calls.Answer();
    CHECK(engine.answers == Ints{1, 2});
    CHECK_MESSAGE(listener.Ring() == RingKind::Stop, "o toque da segunda para");
    CHECK_MESSAGE((engine.holds.empty() && engine.activated.empty()), "o motor poe a primeira em espera no Answer");
    const CallView held = View(1, "3001", "Cliente Teste", true, CallView::Active, start, true);
    CHECK(State() == Two(View(2, "3002", "Fulano", true, CallView::Active, 0), held, CallSnapshot::Held));
    calls.OnCallState(2, CallState::Connecting, 200);
    calls.OnCallState(2, CallState::Confirmed, 200);
    CHECK(State() ==
          Two(View(2, "3002", "Fulano", true, CallView::Active, start + 12000), held, CallSnapshot::Held));
    // As duas acabam do outro lado, cada uma com a sua duração.
    time.Advance(30000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    time.Advance(5000);
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 42000),
                              MakeRecent("3002", "Fulano", Recent::Incoming, start + 10000, 35000)});
}

TEST_CASE_FIXTURE(Fixture, "a third incoming call is rejected busy") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    time.Advance(1000);
    calls.OnIncomingCall(3, "3003", "");
    CHECK(engine.rejects == Ints{3});
    CHECK_MESSAGE((listener.rings == Rings{RingKind::Full, RingKind::Stop, RingKind::Waiting, RingKind::Stop}),
                  "so as duas primeiras tocam");
    CHECK(listener.recents == std::vector<Recent>{MakeRecent("3003", "", Recent::Missed, start + 1000, 0)});
    CHECK(listener.missed == Strings{Missed("3003")});
    const CallSnapshot both = Two(View(2, "3002", "Fulano", true, CallView::Active, start),
                                  View(1, "3001", "Cliente Teste", true, CallView::Active, start, true),
                                  CallSnapshot::Held);
    CHECK(State() == both);
    calls.OnCallState(3, CallState::Disconnected, 486);   // o fim da recusada não mexe nas duas
    CHECK(State() == both);
    CHECK(listener.recents.size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "Alternar swaps the active call") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "");
    calls.Swap();   // a segunda ainda toca: nada
    CHECK(engine.activated.empty());
    AnswerCall(2);
    calls.Swap();
    CHECK(engine.activated == Ints{1});
    const CallSnapshot first = Two(View(1, "3001", "Cliente Teste", true, CallView::Active, start),
                                   View(2, "3002", "", true, CallView::Active, start + 10000, true),
                                   CallSnapshot::Held);
    CHECK(State() == first);
    calls.Swap();
    CHECK(engine.activated == Ints{1, 2});
    CHECK(State() == Two(View(2, "3002", "", true, CallView::Active, start + 10000),
                         View(1, "3001", "Cliente Teste", true, CallView::Active, start, true), CallSnapshot::Held));
    // Com duas, a Espera da ativa é o Alternar (o motor troca as duas; nada de SetHold).
    calls.Hold(std::nullopt);
    CHECK(engine.activated == Ints{1, 2, 1});
    CHECK(engine.holds.empty());
    CHECK(State() == first);
    calls.Hold(false);   // a ativa não está em espera: nada
    CHECK(engine.activated == Ints{1, 2, 1});
    CHECK(engine.holds.empty());
    // A em espera (sem nome) cai, e a ativa acaba depois: cada uma com a sua duração.
    time.Advance(20000);
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(Message() == HungUp("3002"));
    CHECK(State().top == View(1, "3001", "Cliente Teste", true, CallView::Active, start));
    CHECK_FALSE(State().second.has_value());
    calls.Swap();   // uma só: nada
    CHECK(engine.activated == Ints{1, 2, 1});
    time.Advance(10000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3002", "", Recent::Incoming, start + 10000, 20000),
                              MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 40000)});
}

TEST_CASE_FIXTURE(Fixture, "hanging up the active call resumes the held one") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    time.Advance(20000);
    calls.Hangup();
    CHECK_MESSAGE(engine.hangups == Ints{2}, "desliga a ativa");
    CHECK_MESSAGE(engine.activated.empty(), "a outra volta quando o fim chega");
    const CallView first = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    CallView firstHeld = first;
    firstHeld.held = true;
    CHECK_MESSAGE(State() == One(firstHeld), "ate la, a tela mostra a em espera");
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{1});
    CHECK_MESSAGE(State() == One(first), "a outra voltou sozinha");
    CHECK(Message() == "");
    time.Advance(5000);
    calls.Hangup();
    CHECK(engine.hangups == Ints{2, 1});
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_MESSAGE(engine.activated == Ints{1}, "nada mais volta");
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3002", "Fulano", Recent::Incoming, start + 10000, 20000),
                              MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 35000)});
}

TEST_CASE_FIXTURE(Fixture, "the held call dropping shows the message and keeps the active one") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "");
    AnswerCall(2);
    time.Advance(20000);
    calls.OnCallState(1, CallState::Disconnected, 200);   // a em espera desligou do outro lado
    CHECK_MESSAGE(Message() == HungUp("Cliente Teste"), "o nome que a central mandou");
    const CallView second = View(2, "3002", "", true, CallView::Active, start + 10000);
    CHECK(State().top == second);
    CHECK_FALSE(State().second.has_value());
    CHECK_MESSAGE((engine.activated.empty() && engine.hangups.empty()), "a ativa continua como estava");
    time.Advance(1999);
    CHECK(Message() == HungUp("Cliente Teste"));
    time.Advance(1);
    CHECK(Message() == "");
    CHECK(State() == One(second));
    time.Advance(13000);
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(Message() == "");
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                              MakeRecent("3002", "", Recent::Incoming, start + 10000, 35000)});
}

TEST_CASE_FIXTURE(Fixture, "dialing during an active call holds it and places the second") {
    const int64_t start = time.NowMs();
    Ring(1);
    CHECK_FALSE_MESSAGE(calls.Dial("2002"), "com uma ligacao que ainda toca, nao");
    AnswerCall(1);
    time.Advance(10000);
    const CallView held = View(1, "3001", "Cliente Teste", true, CallView::Active, start, true);
    // Dentro do MakeCall: a tela já tem a feita em cima, sem o id do motor, e a primeira em espera.
    std::vector<CallSnapshot> seenDuringMakeCall;
    bool thirdDialed = true;
    engine.duringMakeCall = [&](int) {
        seenDuringMakeCall = listener.snapshots;
        thirdDialed = calls.Dial("2003");
    };
    CHECK(calls.Dial("2002"));
    CHECK(engine.made == Strings{"2002"});
    CHECK_MESSAGE((engine.holds.empty() && engine.activated.empty()), "o motor poe a primeira em espera no MakeCall");
    REQUIRE_FALSE(seenDuringMakeCall.empty());
    CHECK(seenDuringMakeCall.back() ==
          Two(View(CallController::kNoId, "2002", "", false, CallView::Dialing), held, CallSnapshot::Held));
    CHECK_FALSE_MESSAGE(thirdDialed, "com duas, nenhuma outra");
    engine.duringMakeCall = nullptr;
    CHECK_FALSE(calls.Dial("2003"));
    CHECK(engine.made == Strings{"2002"});
    const int id = engine.nextCallId - 1;
    CHECK(State() == Two(View(id, "2002", "", false, CallView::Dialing), held, CallSnapshot::Held));
    calls.OnCallState(id, CallState::Calling, 0);
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK(State() == Two(View(id, "2002", "", false, CallView::Active, start + 10000), held, CallSnapshot::Held));
    // O outro lado da feita desliga: a primeira volta sozinha.
    time.Advance(20000);
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{1});
    CHECK(State() == One(View(1, "3001", "Cliente Teste", true, CallView::Active, start)));
    CHECK(Message() == "");
    time.Advance(5000);
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000),
                              MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 35000)});
}

TEST_CASE_FIXTURE(Fixture, "a failed second dial resumes the first call") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    // O motor pôs a primeira em espera e não ligou a nova: a primeira volta sozinha.
    engine.refuse = true;
    CHECK(calls.Dial("2002"));
    CHECK(engine.activated == Ints{1});
    CHECK(State() == One(View(1, "3001", "Cliente Teste", true, CallView::Active, start)));
    REQUIRE(listener.recents.size() == 1);
    CHECK(listener.recents[0] == MakeRecent("2002", "", Recent::Outgoing, start, 0));
    // Uma feita que não completou (Ocupado): o aviso, e a primeira volta também.
    engine.refuse = false;
    const int id = DialOut("2003");
    calls.OnCallState(id, CallState::Disconnected, 486);
    CHECK(Message() == "Ocupado");
    CHECK(engine.activated == Ints{1, 1});
    CHECK(State().top == View(1, "3001", "Cliente Teste", true, CallView::Active, start));
}

TEST_CASE_FIXTURE(Fixture, "disconnecting the held call by its id ends only that call") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    time.Advance(20000);
    calls.Hangup(1);   // o Desligar do cartão da em espera
    CHECK(engine.hangups == Ints{1});
    const CallView second = View(2, "3002", "Fulano", true, CallView::Active, start + 10000);
    CHECK_MESSAGE(State() == One(second), "o cartao da em espera sai na hora");
    calls.Hangup(1);   // já saindo: nada
    calls.Hangup(99);   // nenhuma: nada
    CHECK(engine.hangups == Ints{1});
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_MESSAGE(Message() == "", "desligada aqui: sem aviso");
    CHECK_MESSAGE(engine.activated.empty(), "a ativa continua como estava");
    CHECK(State() == One(second));
    time.Advance(5000);
    calls.Hangup(2);
    CHECK(engine.hangups == Ints{1, 2});
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(engine.activated.empty());
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                              MakeRecent("3002", "Fulano", Recent::Incoming, start + 10000, 25000)});
}

TEST_CASE_FIXTURE(Fixture, "Hangup with kNoId ends the call being dialed, and the held one returns") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    // O MakeCall ainda não voltou: o cartão da feita só tem o kNoId.
    engine.duringMakeCall = [this](int) { calls.Hangup(CallController::kNoId); };
    const int id = DialOut("2002");
    CHECK_MESSAGE(engine.hangups == Ints{id}, "desligada quando o id chega");
    CHECK(State() == One(View(1, "3001", "Cliente Teste", true, CallView::Active, start, true)));
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(Message() == "");
    CHECK(engine.activated == Ints{1});
    CHECK(State() == One(View(1, "3001", "Cliente Teste", true, CallView::Active, start)));
    // Uma ligação só, recebida: Hangup(kNoId) é a feita mais nova, e não há nenhuma.
    calls.Hangup(CallController::kNoId);
    CHECK(engine.hangups == Ints{id});
}

TEST_CASE_FIXTURE(Fixture, "a second Desligar while the active call is ending does nothing") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    time.Advance(20000);
    calls.Hangup();
    calls.Hangup();    // o segundo clique, antes de o fim da ativa chegar
    calls.Hangup(2);   // e o Desligar com o id da mesma
    CHECK_MESSAGE(engine.hangups == Ints{2}, "a em espera nao sai");
    const CallView first = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    CallView firstHeld = first;
    firstHeld.held = true;
    CHECK(State() == One(firstHeld));
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{1});
    CHECK(State() == One(first));
    // Com outra tocando: o segundo clique não a recusa.
    Ring(3, "3003", "");
    calls.Hangup();
    calls.Hangup();
    CHECK(engine.hangups == Ints{2, 1});
    CHECK_MESSAGE(engine.rejects.empty(), "a que toca nao e recusada");
    const CallSnapshot ringing = One(View(3, "3003", "", true, CallView::Ringing));
    CHECK(State() == ringing);
    CHECK(listener.Ring() == RingKind::Full);
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_MESSAGE(engine.activated == Ints{1}, "nada volta: a outra toca");
    CHECK(State() == ringing);
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3002", "Fulano", Recent::Incoming, start + 10000, 20000),
                              MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000)});
}

TEST_CASE_FIXTURE(Fixture, "the held call dropping while the active one is ending shows no message") {
    Ring(1);
    AnswerCall(1);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    calls.Hangup();   // a ativa sai
    calls.OnCallState(1, CallState::Disconnected, 200);   // a em espera cai do outro lado antes do fim da ativa
    CHECK_MESSAGE(Message() == "", "nenhuma continua: sem aviso");
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK(engine.activated.empty());
    CHECK(listener.recents.size() == 2);
    CHECK(time.Pending() == 0);
}

TEST_CASE_FIXTURE(Fixture, "logout with two calls hangs up both") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    time.Advance(20000);
    calls.OnLogout();
    CHECK(engine.hangups == Ints{1, 2});
    CHECK_MESSAGE(engine.activated.empty(), "nenhuma volta");
    CHECK_FALSE(Top().has_value());
    CHECK(Message() == "");
    calls.OnCallState(2, CallState::Disconnected, 200);   // os fins que chegam depois são ignorados
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(listener.missed.empty());
    CHECK(Message() == "");
    CHECK(listener.recents ==
          std::vector<Recent>{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                              MakeRecent("3002", "Fulano", Recent::Incoming, start + 10000, 20000)});
}

TEST_CASE_FIXTURE(Fixture, "the second call rings the waiting beep, not the full ring") {
    Ring(1);
    CHECK(listener.rings == Rings{RingKind::Full});
    AnswerCall(1);
    Ring(2, "3002", "");
    CHECK_MESSAGE(listener.Ring() == RingKind::Waiting, "com outra em andamento, o bipe");
    calls.OnCallState(2, CallState::Disconnected, 487);   // quem ligou desistiu
    CHECK(listener.Ring() == RingKind::Stop);
    Ring(3, "3003", "");
    CHECK(listener.Ring() == RingKind::Waiting);
    calls.OnCallState(1, CallState::Disconnected, 200);   // a primeira acaba com a segunda tocando
    CHECK_MESSAGE(listener.Ring() == RingKind::Full, "sozinha, ela toca o toque completo");
    AnswerCall(3);
    CHECK(listener.Ring() == RingKind::Stop);
    Ring(4, "3004", "");
    CHECK(listener.Ring() == RingKind::Waiting);
    calls.Hangup();   // a ativa sai com a outra tocando
    CHECK(listener.Ring() == RingKind::Full);
    calls.Reject();
    CHECK(listener.rings == Rings{RingKind::Full, RingKind::Stop, RingKind::Waiting, RingKind::Stop,
                                  RingKind::Waiting, RingKind::Full, RingKind::Stop, RingKind::Waiting,
                                  RingKind::Full, RingKind::Stop});
}

TEST_CASE_FIXTURE(Fixture, "logout after Alternar resumes nothing") {
    // A ativa é a primeira da lista: o fim dela no Sair não traz a outra de volta.
    Ring(1);
    AnswerCall(1);
    Ring(2, "3002", "");
    AnswerCall(2);
    calls.Swap();
    CHECK(engine.activated == Ints{1});
    calls.OnLogout();
    CHECK(engine.hangups == Ints{1, 2});
    CHECK_MESSAGE((engine.activated == Ints{1}), "nenhuma volta");
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents.size() == 2);
}

// A transferência com consulta (spec da 0.2, 7.3): o cliente (a recebida 1) em espera e o colega (a feita pelo
// Consultar) a ativa; Concluir, Cancelar, o colega que não atende e o cliente que desliga. E o resultado da direta.

TEST_CASE_FIXTURE(Fixture, "Consultar holds the client and dials the colleague") {
    const int64_t start = time.NowMs();
    CHECK_FALSE_MESSAGE(calls.Consult("2002"), "sem ligacao, nada a consultar");
    Ring(1);
    CHECK_FALSE_MESSAGE(calls.Consult("2002"), "com a recebida tocando, nao");
    AnswerCall(1);
    time.Advance(10000);
    CHECK_FALSE(calls.Consult(""));
    CHECK_FALSE(calls.Consult(" - "));
    registered = false;
    CHECK_FALSE(calls.Consult("2002"));
    CHECK_MESSAGE(Message() == U8(kNoConnection), "como no Dial");
    registered = true;
    CHECK(engine.made.empty());
    const CallView client = Held(View(1, "3001", "Cliente Teste", true, CallView::Active, start));
    // Dentro do MakeCall: a tela já tem o colega em cima, sem o id do motor, e o cliente em espera.
    std::vector<CallSnapshot> seenDuringMakeCall;
    bool otherPlaced = true;
    engine.duringMakeCall = [&](int) {
        seenDuringMakeCall = listener.snapshots;
        otherPlaced = calls.Consult("2003") || calls.Dial("2003");
    };
    CHECK(calls.Consult("2002"));
    CHECK(engine.made == Strings{"2002"});
    CHECK_MESSAGE((engine.holds.empty() && engine.activated.empty()), "o motor poe o cliente em espera no MakeCall");
    REQUIRE_FALSE(seenDuringMakeCall.empty());
    CHECK(seenDuringMakeCall.back() ==
          Consulting(Two(View(CallController::kNoId, "2002", "", false, CallView::Dialing), client, CallSnapshot::Held),
                     true));
    CHECK_FALSE_MESSAGE(otherPlaced, "com duas, nenhuma outra");
    engine.duringMakeCall = nullptr;
    CHECK_FALSE(calls.Consult("2003"));
    CHECK_FALSE(calls.Dial("2003"));
    CHECK(engine.made == Strings{"2002"});
    const int id = engine.nextCallId - 1;
    calls.OnCallState(id, CallState::Calling, 0);
    CHECK(State() == Consulting(Two(View(id, "2002", "", false, CallView::Dialing), client, CallSnapshot::Held), true));
    // Chamando: nem Concluir nem Alternar.
    calls.CompleteTransfer();
    calls.Swap();
    CHECK(engine.attended.empty());
    CHECK(engine.activated.empty());
    calls.OnCallState(id, CallState::Confirmed, 200);
    const CallView colleague = View(id, "2002", "", false, CallView::Active, start + 10000);
    CHECK(State() == Consulting(Two(colleague, client, CallSnapshot::Held), true));
    // Alternar: a pessoa fala com o cliente de novo, e o colega fica em espera (a consulta continua).
    calls.Swap();
    CHECK(engine.activated == Ints{1});
    CHECK(State() == Consulting(Two(View(1, "3001", "Cliente Teste", true, CallView::Active, start), Held(colleague),
                                    CallSnapshot::Held),
                                false));
    CHECK_MESSAGE(engine.hangups.empty(), "nada sai");
    CHECK(listener.recents.empty());
}

TEST_CASE_FIXTURE(Fixture, "Concluir transferencia sends the attended transfer and both calls end") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    time.Advance(20000);
    calls.CompleteTransfer();
    CHECK_MESSAGE((engine.attended == IntPairs{{1, id}}), "o cliente para o colega");
    calls.CompleteTransfer();   // o segundo clique, antes do resultado: nada
    CHECK(engine.attended.size() == 1);
    // A central aceitou: o motor desliga as duas (os fins chegam por ele), e a tela de chamada fecha.
    calls.OnTransfer(1, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(Message() == "");
    CHECK_MESSAGE(engine.hangups.empty(), "o motor e quem desliga");
    calls.OnCallState(1, CallState::Disconnected, 200);   // o BYE do cliente primeiro
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_MESSAGE(Message() == "", "sem aviso");
    CHECK_MESSAGE(engine.activated.empty(), "nada volta");
    CHECK(State() == CallSnapshot());
    CHECK(listener.missed.empty());
    CHECK(time.Pending() == 0);
    CHECK(listener.recents == Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                                      MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000)});
    CHECK_MESSAGE(calls.Dial("2003"), "uma ligacao nova depois");
}

TEST_CASE_FIXTURE(Fixture, "Concluir transferencia ends both calls when the colleague's BYE comes first") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    time.Advance(20000);
    calls.CompleteTransfer();
    calls.OnTransfer(1, 202);
    CHECK_FALSE(Top().has_value());
    // O colega (a ativa) sai primeiro: o cliente, já saindo, não volta sozinho.
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_MESSAGE(engine.activated.empty(), "o cliente nao volta");
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(engine.activated.empty());
    CHECK(engine.hangups.empty());
    CHECK(State() == CallSnapshot());
    CHECK(listener.recents == Recents{MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000),
                                      MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000)});
}

TEST_CASE_FIXTURE(Fixture, "a refused attended transfer shows the message and keeps both calls") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    calls.CompleteTransfer();
    const CallSnapshot both =
        Consulting(Two(View(id, "2002", "", false, CallView::Active, start + 10000),
                       Held(View(1, "3001", "Cliente Teste", true, CallView::Active, start)), CallSnapshot::Held),
                   true);
    CHECK(State() == both);
    calls.OnTransfer(1, 603);   // o REFER recusado
    CHECK(Message() == U8(kTransferRefused));
    CHECK_MESSAGE(State() == WithMessage(both, U8(kTransferRefused)), "as duas continuam como estavam");
    CHECK(engine.hangups.empty());
    CHECK(engine.activated.empty());
    time.Advance(1999);
    CHECK(Message() == U8(kTransferRefused));
    time.Advance(1);
    CHECK(Message() == "");
    // De novo, do lado do cliente (Alternar): Concluir vale com qualquer um dos dois ativo.
    calls.Swap();
    calls.CompleteTransfer();
    CHECK(engine.attended == IntPairs{{1, id}, {1, id}});
    calls.OnTransfer(1, 486);   // o NOTIFY com erro
    CHECK(Message() == U8(kTransferRefused));
    CHECK(Top()->id == 1);
    CHECK(State().consulting);
    CHECK_FALSE(State().colleagueActive);
    CHECK(engine.hangups.empty());
    CHECK(listener.recents.empty());
}

TEST_CASE_FIXTURE(Fixture, "the colleague ending before the attended transfer is accepted frees the client for a new transfer") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    calls.CompleteTransfer();
    CHECK(engine.attended == IntPairs{{1, id}});
    // O colega desliga junto com o clique em Concluir: o motor recusa o REFER (o colega já não está), e o
    // resultado nunca chega. O cliente volta sozinho, e pode ser transferido de novo.
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK(engine.activated == Ints{1});
    CHECK(State() == One(View(1, "3001", "Cliente Teste", true, CallView::Active, start)));
    CHECK(calls.Transfer("2003"));
    CHECK(engine.transfers == Pairs{{1, "2003"}});
}

TEST_CASE_FIXTURE(Fixture, "Cancelar ends the colleague and resumes the client") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Calling, 0);
    calls.CancelConsult();
    CHECK_MESSAGE((engine.hangups == Ints{id}), "o colega sai");
    CHECK_MESSAGE(engine.activated.empty(), "o cliente volta quando o fim chega");
    const CallView client = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    CHECK_MESSAGE(State() == One(Held(client)), "ate la, o cliente em espera, sem a consulta");
    calls.CancelConsult();   // repetido: nada
    CHECK(engine.hangups == Ints{id});
    calls.OnCallState(id, CallState::Disconnected, 487);
    CHECK(engine.activated == Ints{1});
    CHECK_MESSAGE(State() == One(client), "o cliente voltou sozinho");
    CHECK_MESSAGE(Message() == "", "cancelada aqui: sem aviso");
    // Com o colega atendido e o cliente de volta pelo Alternar: o colega (em espera) sai, e o cliente segue.
    time.Advance(5000);
    const int next = ConsultOut("2003");
    calls.OnCallState(next, CallState::Confirmed, 200);
    calls.Swap();
    CHECK(engine.activated == Ints{1, 1});
    time.Advance(5000);
    calls.CancelConsult();
    CHECK(engine.hangups == Ints{id, next});
    CHECK(State() == One(client));
    calls.OnCallState(next, CallState::Disconnected, 200);
    CHECK_MESSAGE((engine.activated == Ints{1, 1}), "o cliente ja estava com o som");
    CHECK(Message() == "");
    CHECK(State() == One(client));
    // Cancelar com o MakeCall do colega a caminho: o colega sai quando o id chega.
    engine.duringMakeCall = [this](int) { calls.CancelConsult(); };
    const int third = ConsultOut("2004");
    engine.duringMakeCall = nullptr;
    CHECK(engine.hangups == Ints{id, next, third});
    calls.OnCallState(third, CallState::Disconnected, 487);
    CHECK(engine.activated == Ints{1, 1, 1});
    CHECK(State() == One(client));
    CHECK(listener.recents == Recents{MakeRecent("2002", "", Recent::Outgoing, start + 10000, 0),
                                      MakeRecent("2003", "", Recent::Outgoing, start + 15000, 5000),
                                      MakeRecent("2004", "", Recent::Outgoing, start + 20000, 0)});
}

TEST_CASE_FIXTURE(Fixture, "the colleague not answering resumes the client with the message") {
    const int64_t start = time.NowMs();
    contacts.names["2003"] = "Maria Silva";
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Calling, 0);
    time.Advance(30000);
    calls.OnCallState(id, CallState::Disconnected, 480);
    CHECK_MESSAGE(Message() == "2002: " + EndMessage(480), "o motivo do nucleo, com o numero do colega");
    CHECK_MESSAGE((engine.activated == Ints{1}), "o cliente volta sozinho");
    const CallView client = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    CHECK(State() == WithMessage(One(client), "2002: " + EndMessage(480)));
    time.Advance(1999);
    CHECK(Message() == "2002: " + EndMessage(480));
    time.Advance(1);
    CHECK(Message() == "");
    calls.CompleteTransfer();   // sem consulta: nada
    CHECK(engine.attended.empty());
    // Outra consulta, e o colega (um contato) está ocupado.
    const int next = ConsultOut("2003");
    calls.OnCallState(next, CallState::Disconnected, 486);
    CHECK_MESSAGE(Message() == "Maria Silva: Ocupado", "o nome do contato do colega");
    CHECK(engine.activated == Ints{1, 1});
    CHECK(State().top == client);
    CHECK(listener.recents == Recents{MakeRecent("2002", "", Recent::Outgoing, start + 10000, 0),
                                      MakeRecent("2003", "", Recent::Outgoing, start + 42000, 0)});
}

TEST_CASE_FIXTURE(Fixture, "the client hanging up during the consult leaves a normal call with the colleague") {
    const int64_t start = time.NowMs();
    Ring(1);
    AnswerCall(1);
    time.Advance(10000);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    time.Advance(20000);
    calls.OnCallState(1, CallState::Disconnected, 200);   // o cliente, em espera, desligou
    CHECK(Message() == HungUp("Cliente Teste"));
    const CallView colleague = View(id, "2002", "", false, CallView::Active, start + 10000);
    CHECK_MESSAGE(State() == WithMessage(One(colleague), HungUp("Cliente Teste")),
                  "uma ligacao normal, sem a consulta");
    CHECK_MESSAGE((engine.activated.empty() && engine.hangups.empty()), "o colega continua como estava");
    calls.CompleteTransfer();   // sem consulta: nada
    calls.CancelConsult();
    CHECK(engine.attended.empty());
    CHECK(engine.hangups.empty());
    time.Advance(5000);
    calls.Hangup();
    CHECK(engine.hangups == Ints{id});
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents == Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                                      MakeRecent("2002", "", Recent::Outgoing, start + 10000, 25000)});
}

TEST_CASE_FIXTURE(Fixture, "a direct transfer waiting for its result refuses Consultar, and a consult refuses the direct transfer") {
    Ring(1);
    AnswerCall(1);
    CHECK(calls.Transfer("2003"));
    // O REFER espera o NOTIFY final (o destino ainda não atendeu): nem Consultar nem outro Transferir agora.
    CHECK_FALSE(calls.Consult("2002"));
    CHECK_FALSE(calls.Transfer("2004"));
    CHECK_MESSAGE(engine.made.empty(), "nada discado");
    CHECK(engine.transfers == Pairs{{1, "2003"}});
    CHECK_FALSE(State().consulting);
    // A central aceitou: o motor desliga só ela, e nada fica de pé escondido.
    calls.OnTransfer(1, 200);
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(engine.hangups.empty());
    const int dialed = DialOut("2005");   // uma ligação nova depois
    calls.Hangup();
    calls.OnCallState(dialed, CallState::Disconnected, 487);
    // Na consulta, a transferência é o Concluir: o Transferir agora não vale, de nenhum dos lados.
    Ring(2, "3002", "");
    AnswerCall(2);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    CHECK_FALSE(calls.Transfer("2004"));
    calls.Swap();
    CHECK_FALSE(calls.Transfer("2004"));
    CHECK(engine.transfers == Pairs{{1, "2003"}});
    // Um 2xx no cliente sem o Concluir pedido não é da consulta: as duas continuam.
    calls.OnTransfer(2, 200);
    CHECK(State().consulting);
    CHECK_FALSE(State().colleagueActive);
    CHECK(State().second == View(id, "2002", "", false, CallView::Active, time.NowMs(), true));
    calls.CompleteTransfer();
    CHECK(engine.attended == IntPairs{{2, id}});
    calls.OnTransfer(2, 200);
    CHECK_FALSE_MESSAGE(Top().has_value(), "o Concluir pedido: as duas saem");
}

TEST_CASE_FIXTURE(Fixture, "an attended transfer the engine refuses at once shows the message and can be asked again") {
    Ring(1);
    AnswerCall(1);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    const CallSnapshot both = State();
    REQUIRE(both.consulting);
    // O motor devolve false (sem OnTransfer): o pedido não fica esperando um resultado que nunca vem.
    engine.refuseTransfers = true;
    calls.CompleteTransfer();
    CHECK(engine.attended == IntPairs{{1, id}});
    CHECK(Message() == U8(kTransferRefused));
    CHECK_MESSAGE(State() == WithMessage(both, U8(kTransferRefused)), "as duas continuam como estavam");
    CHECK(engine.hangups.empty());
    engine.refuseTransfers = false;
    calls.CompleteTransfer();
    CHECK_MESSAGE((engine.attended == IntPairs{{1, id}, {1, id}}), "o pedido vale de novo");
    calls.OnTransfer(1, 200);
    CHECK_FALSE(Top().has_value());
}

TEST_CASE_FIXTURE(Fixture, "a direct transfer the engine refuses at once shows the message and can be asked again") {
    const int id = DialOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    const std::optional<CallView> call = Top();
    engine.refuseTransfers = true;
    CHECK_FALSE_MESSAGE(calls.Transfer("2003"), "o motor recusou na hora");
    CHECK(engine.transfers == Pairs{{id, "2003"}});
    CHECK(Message() == U8(kTransferRefused));
    CHECK(Top() == call);
    engine.refuseTransfers = false;
    CHECK_MESSAGE(calls.Consult("2004"), "sem pedido esperando, o Consultar vale");
    calls.CancelConsult();
    calls.OnCallState(engine.nextCallId - 1, CallState::Disconnected, 487);
    CHECK(calls.Transfer("2003"));
    CHECK(engine.transfers == Pairs{{id, "2003"}, {id, "2003"}});
}

// A conferência (spec da 0.2, 7.4): as duas ligações juntas na mesa de áudio do motor, Separar, Desligar
// para as duas, uma que sai e Sair.

TEST_CASE_FIXTURE(Fixture, "Juntar joins both calls into a conference") {
    const int64_t start = time.NowMs();
    Ring(1);
    calls.Join();   // tocando: nada
    AnswerCall(1);
    calls.Join();   // uma só: nada
    time.Advance(10000);
    const int id = DialOut("2002");
    calls.Join();   // a feita ainda chama: nada
    CHECK(engine.joined.empty());
    calls.OnCallState(id, CallState::Confirmed, 200);
    time.Advance(5000);
    calls.Join();
    CHECK_MESSAGE((engine.joined == IntPairs{{id, 1}}), "a ativa e a outra");
    CHECK_MESSAGE((engine.activated.empty() && engine.holds.empty()), "o motor retoma a em espera no Join");
    const CallSnapshot conference = Conference(View(id, "2002", "", false, CallView::Active, start + 10000),
                                               View(1, "3001", "Cliente Teste", true, CallView::Active, start),
                                               start + 15000);
    CHECK(State() == conference);
    calls.Join();   // já em conferência: nada
    CHECK(engine.joined.size() == 1);
    // Na conferência, nem Espera, nem Alternar, nem Transferir, nem Consultar, nem Nova ligação.
    calls.Hold(std::nullopt);
    calls.Hold(true);
    calls.Swap();
    CHECK_FALSE(calls.Transfer("2003"));
    CHECK_FALSE(calls.Consult("2003"));
    CHECK_FALSE(calls.Dial("2003"));
    CHECK(engine.holds.empty());
    CHECK(engine.activated.empty());
    CHECK(engine.transfers.empty());
    CHECK(engine.made == Strings{"2002"});
    CHECK(State() == conference);
    // O mudo vale para as duas, e o teclado manda na de cima.
    calls.Mute(std::nullopt);
    CHECK(engine.mutes == std::vector<bool>{true});
    calls.Dtmf("1");
    CHECK(engine.dtmfs == Pairs{{id, "1"}});
    CallSnapshot muted = conference;
    muted.muted = true;
    CHECK(State() == muted);
    // Uma terceira recebe ocupado, e a conferência segue.
    calls.OnIncomingCall(id + 1, "3003", "");
    CHECK(engine.rejects == Ints{id + 1});
    calls.OnCallState(id + 1, CallState::Disconnected, 486);
    CHECK(State() == muted);
    CHECK(listener.recents == Recents{MakeRecent("3003", "", Recent::Missed, start + 15000, 0)});
    CHECK(engine.hangups.empty());
    CHECK(engine.split.empty());
}

TEST_CASE_FIXTURE(Fixture, "Separar holds the last call again") {
    const int64_t start = time.NowMs();
    const int id = TwoCalls();
    calls.Split();   // sem conferência: nada
    CHECK(engine.split.empty());
    calls.Join();   // com a feita em cima
    time.Advance(5000);
    calls.Split();
    // A última que entrou (a feita) vai para a espera, e a primeira fica a ativa, em cima.
    CHECK(engine.split == IntPairs{{1, id}});
    CHECK_MESSAGE((engine.order == Strings{"join " + std::to_string(id) + " 1", "split 1 " + std::to_string(id)}),
                  "o Split poe a outra em espera no motor");
    const CallView first = View(1, "3001", "Cliente Teste", true, CallView::Active, start);
    const CallView last = View(id, "2002", "", false, CallView::Active, start + 10000);
    CHECK(State() == Two(first, Held(last), CallSnapshot::Held));
    calls.Split();   // repetido: nada
    CHECK(engine.split.size() == 1);
    // Juntar de novo, agora com a primeira em cima: Separar põe de novo a feita (a última que entrou) em espera.
    calls.Join();
    CHECK(engine.joined == IntPairs{{id, 1}, {1, id}});
    CHECK(State() == Conference(first, last, start + 15000));
    calls.Split();
    CHECK(engine.split == IntPairs{{1, id}, {1, id}});
    CHECK(State() == Two(first, Held(last), CallSnapshot::Held));
    // Separadas, o Alternar vale de novo.
    calls.Swap();
    CHECK(engine.activated == Ints{id});
    CHECK(Top()->id == id);
    CHECK(engine.holds.empty());
    CHECK(engine.hangups.empty());
}

TEST_CASE_FIXTURE(Fixture, "hanging up a conference ends both calls") {
    const int64_t start = time.NowMs();
    const int id = TwoCalls();
    calls.Join();
    time.Advance(20000);
    calls.Hangup();
    CHECK_MESSAGE((engine.hangups == Ints{1, id}), "as duas saem");
    CHECK_FALSE_MESSAGE(Top().has_value(), "a tela sai na hora");
    calls.Hangup();   // o segundo clique, antes dos fins: nada
    calls.Hangup(1);
    calls.Hangup(id);
    CHECK(engine.hangups.size() == 2);
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_MESSAGE(engine.activated.empty(), "nada volta");
    CHECK_FALSE(Top().has_value());
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(engine.activated.empty());
    CHECK(engine.holds.empty());
    CHECK_MESSAGE(Message() == "", "desligadas aqui: sem aviso");
    CHECK(State() == CallSnapshot());
    CHECK(listener.recents == Recents{MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000),
                                      MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000)});
    CHECK_MESSAGE(calls.Dial("2003"), "uma ligacao nova depois");
    CHECK_FALSE(State().conference);
}

namespace {

// A conferência do TwoCalls (a feita em cima), e o Desligar com o id de uma das duas (top: a de cima): as
// duas saem, como no Desligar da tela, e nenhuma fica com o som.
struct ConferenceLeg : Fixture {
    void HangUpLeg(bool top) {
        const int64_t start = time.NowMs();
        const int id = TwoCalls();
        calls.Join();
        time.Advance(20000);
        const int leg = top ? id : 1;
        const int other = top ? 1 : id;
        calls.Hangup(leg);
        CHECK_MESSAGE((engine.hangups == Ints{1, id}), "as duas saem");
        CHECK_FALSE_MESSAGE(Top().has_value(), "a tela sai na hora");
        calls.Hangup(other);   // o Desligar da outra, antes dos fins: nada
        CHECK(engine.hangups.size() == 2);
        calls.OnCallState(leg, CallState::Disconnected, 200);
        CHECK_FALSE(Top().has_value());
        CHECK_MESSAGE((engine.activated.empty() && engine.holds.empty()), "a outra nao volta");
        calls.OnCallState(other, CallState::Disconnected, 200);
        CHECK(State() == CallSnapshot());
        CHECK(engine.activated.empty());
        CHECK_MESSAGE(Message() == "", "desligadas aqui: sem aviso");
        const Recent outgoing = MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000);
        const Recent incoming = MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000);
        CHECK(listener.recents == (top ? Recents{outgoing, incoming} : Recents{incoming, outgoing}));
    }
};

}  // namespace

TEST_CASE_FIXTURE(ConferenceLeg, "disconnecting the top call of a conference by its id ends both calls") {
    HangUpLeg(true);
}

TEST_CASE_FIXTURE(ConferenceLeg, "disconnecting the other call of a conference by its id ends both calls") {
    HangUpLeg(false);
}

TEST_CASE_FIXTURE(Fixture, "a party leaving the conference leaves a normal call") {
    const int64_t start = time.NowMs();
    const int id = TwoCalls();
    calls.Join();
    time.Advance(20000);
    // O cliente (o de baixo) desliga: a conferência vira uma ligação normal com o colega.
    calls.OnCallState(1, CallState::Disconnected, 200);
    CHECK(Message() == HungUp("Cliente Teste"));
    const CallView colleague = View(id, "2002", "", false, CallView::Active, start + 10000);
    CHECK(State() == WithMessage(One(colleague), HungUp("Cliente Teste")));
    CHECK_MESSAGE((engine.activated.empty() && engine.holds.empty() && engine.hangups.empty()),
                  "o motor ja a deixa com o som: nada de Activate");
    time.Advance(1999);
    CHECK(Message() == HungUp("Cliente Teste"));
    time.Advance(1);
    CHECK(Message() == "");
    // Uma ligação normal: Separar não faz nada, e a Espera é a de sempre.
    calls.Split();
    CHECK(engine.split.empty());
    calls.Hold(std::nullopt);
    calls.Hold(std::nullopt);
    CHECK(engine.holds == Holds{{id, true}, {id, false}});
    CHECK(State() == One(colleague));
    // De novo com uma segunda, e quem sai é a de cima: a outra fica, também sem Activate.
    time.Advance(5000);
    Ring(2, "3002", "Fulano");
    AnswerCall(2);
    calls.Join();
    CHECK(engine.joined == IntPairs{{id, 1}, {2, id}});
    time.Advance(10000);
    calls.OnCallState(2, CallState::Disconnected, 200);
    CHECK_MESSAGE(Message() == HungUp("Fulano"), "qualquer uma da conferencia que cai deixa o aviso");
    CHECK(State() == WithMessage(One(colleague), HungUp("Fulano")));
    CHECK(engine.activated.empty());
    time.Advance(7000);
    calls.Hangup();
    CHECK(engine.hangups == Ints{id});
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK_FALSE(Top().has_value());
    CHECK(listener.recents == Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                                      MakeRecent("3002", "Fulano", Recent::Incoming, start + 37000, 10000),
                                      MakeRecent("2002", "", Recent::Outgoing, start + 10000, 44000)});
}

TEST_CASE_FIXTURE(Fixture, "logout during a conference ends both calls") {
    const int64_t start = time.NowMs();
    const int id = TwoCalls();
    calls.Join();
    calls.Mute(std::nullopt);
    time.Advance(20000);
    calls.OnLogout();
    CHECK(engine.hangups == Ints{1, id});
    CHECK_MESSAGE(engine.activated.empty(), "nenhuma volta");
    CHECK_MESSAGE((engine.mutes == std::vector<bool>{true, false}), "o mudo sai");
    CHECK(State() == CallSnapshot());
    calls.OnCallState(1, CallState::Disconnected, 200);   // os fins que chegam depois são ignorados
    calls.OnCallState(id, CallState::Disconnected, 200);
    CHECK(listener.missed.empty());
    CHECK(listener.recents == Recents{MakeRecent("3001", "Cliente Teste", Recent::Incoming, start, 30000),
                                      MakeRecent("2002", "", Recent::Outgoing, start + 10000, 20000)});
    // A conferência não passa para o próximo Entrar: a ligação nova é uma só.
    calls.OnLogin();
    Ring(15, "3005", "");
    AnswerCall(15);
    CHECK(State() == One(View(15, "3005", "", true, CallView::Active, start + 30000)));
}

TEST_CASE_FIXTURE(Fixture, "Juntar during a consult is not offered") {
    Ring(1);
    AnswerCall(1);
    const int id = ConsultOut("2002");
    calls.OnCallState(id, CallState::Confirmed, 200);
    const CallSnapshot consult = State();
    CHECK(consult.consulting);
    CHECK(consult.colleagueActive);
    calls.Join();
    CHECK(State() == consult);
    calls.Swap();   // do lado do cliente, também não
    const CallSnapshot client = State();
    calls.Join();
    CHECK(engine.joined.empty());
    CHECK(State() == client);
    CHECK(client.consulting);
    CHECK_FALSE(client.colleagueActive);
    CHECK_FALSE(client.conference);
    // Nem com uma transferência esperando o resultado, em qualquer das duas.
    calls.CancelConsult();
    calls.OnCallState(id, CallState::Disconnected, 200);
    Ring(12, "3002", "");
    AnswerCall(12);
    CHECK_FALSE_MESSAGE(calls.Consult("2004"), "com duas em andamento, nenhum Consultar");
    CHECK(calls.Transfer("2003"));   // a direta da ativa (12), esperando o NOTIFY
    calls.Join();
    calls.Swap();   // a 12, com o pedido, vai para a espera
    calls.Join();
    CHECK(engine.joined.empty());
    calls.OnTransfer(12, 603);   // recusada: as duas continuam, e o Juntar vale
    calls.Join();
    CHECK(engine.joined == IntPairs{{1, 12}});
    CHECK(State().conference);
}
