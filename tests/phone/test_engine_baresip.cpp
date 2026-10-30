// Só o motor do baresip: o que depende das linhas de log do baresip, os módulos que ele carrega, o que esse motor faz
// de diferente do do PJSIP (os dispositivos de som e o BLF, spec 6.1, os dados de push no REGISTER, spec 7.3, também
// durante uma ligação, a URI das ligações de uma conta TCP e o REFER do outro lado, recusado com 501) e o que só aqui
// é conferido (o keep-alive, o motor destruído e criado de novo com a conta, a troca de rede que lê de novo os
// endereços locais, os códigos das ligações encerradas aqui, o CANCEL e o BYE do Hangup que esperam a resposta do
// outro lado, sem que o limite de ligações do baresip recuse a que chega, a ligação que chega com a conta saindo, o
// OnLog que lança no fim de uma ligação, o INVITE com Replaces recusado, as teclas aceitas, uma transferência por vez,
// a que acaba com um erro sem evento do baresip (a linha "call: subscription closed"), o Join que espera a
// renegociação anterior ou o resultado da transferência com consulta e, pelo SipEngineTestAccess, o áudio, o mudo e a
// mistura de cada ligação: com duas, só a ativa fica com o microfone, spec 7.7, também com a espera ou a retomada que
// não sai e com a renegociação que não acaba, e na conferência as duas, na mistura do mixminus). O motor do PJSIP tem
// os testes dele (test_engine_pjsip.cpp).
#include "call_fixture.h"
#include "engine_fixture.h"
#include "relay_fixture.h"

#include <atomic>
#include <cerrno>
#include <chrono>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "nlohmann/json.hpp"

#include "BaresipCalls.h"
#include "BaresipLoop.h"
#include "SipEngine.h"
#include "SipEngineTestAccess.h"
// O dbg da libre (o dbg_printf), fora do re.h que o BaresipCalls.h inclui; este arquivo não usa as macros DEBUG_*.
#define DEBUG_MODULE "teste"
#define DEBUG_LEVEL 0
#include <re_dbg.h>

using namespace starsonic;
using phone_test::CallEvent;
using phone_test::Contains;
using phone_test::DelayedUdpRelay;
using phone_test::FakeRegistrar;
using phone_test::History;
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
using phone_test::Sorted;
using phone_test::StartEngine;
using phone_test::Transfers;
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

// Espera até kWaitSeconds que as ligações com o áudio aberto sejam as de expected (em ordem crescente).
bool WaitAudio(const SipEngine& engine, const std::vector<int>& expected) {
    return WaitUntil([&] { return SipEngineTestAccess::CallsWithAudio(engine) == expected; }, kWaitSeconds);
}

// Espera até kWaitSeconds que a ligação id tenha `times` OnTransfer.
bool WaitTransfers(RecordingListener& listener, int id, size_t times) {
    return listener.WaitForCalls(
        [id, times](const std::vector<CallEvent>& events) { return Transfers(events, id).size() >= times; },
        kWaitSeconds);
}

// Um RecordingListener que guarda também o maior nível de log que chegou.
struct LevelListener : RecordingListener {
    void OnLog(int level, const std::string& line) override {
        RecordingListener::OnLog(level, line);
        int seen = maxLevel_.load();
        while (level > seen && !maxLevel_.compare_exchange_weak(seen, level)) {
        }
    }
    int MaxLevel() const { return maxLevel_.load(); }

private:
    std::atomic<int> maxLevel_{0};
};

// Um RecordingListener cujo OnLog lança nas linhas que o laço escreve de dentro da libre e do baresip, que são C: as do
// trace do SIP ("SIP enviado" e "SIP recebido") e as do baresip que dizem os codecs ("aucodec: ").
struct ThrowingLogListener : RecordingListener {
    void OnLog(int level, const std::string& line) override {
        RecordingListener::OnLog(level, line);
        if (line.compare(0, 4, "SIP ") == 0 || line.compare(0, 9, "aucodec: ") == 0) {
            ++thrown_;
            throw std::runtime_error("o OnLog falhou");
        }
    }
    int Thrown() const { return thrown_.load(); }

private:
    std::atomic<int> thrown_{0};
};

// Um RecordingListener cujo OnLog, com o Throw ligado, lança em toda linha, como um bad_alloc do app ao montar a linha:
// também nas do motor que saem de dentro dos avisos do baresip (a do resultado de uma transferência).
struct ThrowingOnLogListener : RecordingListener {
    void OnLog(int level, const std::string& line) override {
        RecordingListener::OnLog(level, line);
        if (!throwing_.load()) return;
        throw std::runtime_error("o OnLog falhou");
    }
    void Throw(bool on) { throwing_ = on; }

private:
    std::atomic<bool> throwing_{false};
};

// Um RecordingListener que guarda também os REFER que o motor mandou, um por pedido. O log tem cada mensagem SIP que
// sai, também as repetições do UDP, e uma repetição é o mesmo pedido: o mesmo CSeq no mesmo diálogo (o Call-ID).
struct ReferListener : RecordingListener {
    void OnLog(int level, const std::string& line) override {
        RecordingListener::OnLog(level, line);
        static const std::string kSent = "SIP enviado (";
        const size_t start = line.find("):\n");
        if (line.compare(0, kSent.size(), kSent) != 0 || start == std::string::npos ||
            line.compare(start + 3, 10, "REFER sip:") != 0) {
            return;
        }
        const std::string referTo = Header(line, "Refer-To");
        const size_t user = referTo.find("sip:");
        const size_t at = referTo.find('@');
        if (user == std::string::npos || at == std::string::npos || at < user) return;
        const std::string number = referTo.substr(user + 4, at - user - 4);
        std::lock_guard<std::mutex> lock(refersMutex_);
        if (!requests_.insert(Header(line, "Call-ID") + " " + Header(line, "CSeq")).second) return;   // repetição
        refers_.push_back(number + (Contains(referTo, "Replaces=") ? " replaces" : ""));
    }

    // Os REFER que saíram, em ordem: o número do Refer-To e, na transferência com consulta, " replaces".
    Lines Refers() const {
        std::lock_guard<std::mutex> lock(refersMutex_);
        return refers_;
    }

private:
    // O valor do cabeçalho name na mensagem SIP (vazio se não há).
    static std::string Header(const std::string& message, const std::string& name) {
        const std::string prefix = "\n" + name + ": ";
        const size_t start = message.find(prefix);
        if (start == std::string::npos) return std::string();
        const size_t value = start + prefix.size();
        return message.substr(value, message.find_first_of("\r\n", value) - value);
    }

    mutable std::mutex refersMutex_;
    std::set<std::string> requests_;   // o Call-ID e o CSeq de cada REFER que saiu
    Lines refers_;
};

// Um motor registrado no registrador falso por um DelayedUdpRelay de 200 ms (cada resposta chega 400 ms depois do
// pedido), com uma ligação feita para 2002 já confirmada. A ordem dos campos importa: o motor some antes do listener,
// do relay e do registrador.
struct SlowPhone {
    SlowPhone() : registrar("senha"), relay(registrar.port(), 200) {
        engine = StartEngine(&listener, LoadProfile(relay.port()));
        REQUIRE(engine->SetAccount(Input(Transport::Udp)));
        REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
        client = Dial("2002");
    }

    int Dial(const std::string& number) {
        const int id = engine->MakeCall(number);
        REQUIRE(id > 0);
        REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed), kWaitSeconds));
        return id;
    }

    FakeRegistrar registrar;
    DelayedUdpRelay relay;
    ReferListener listener;
    std::unique_ptr<SipEngine> engine;
    int client = 0;
};

}  // namespace

TEST_CASE("the baresip engine loads the modules of build/deps.lock, in order") {
    // O build/baresip/build-linux.sh confere o .a contra o deps.lock, mas o CI só roda o script quando o cache do
    // baresip falta: a lista do código é conferida aqui, em todo build.
    const nlohmann::json lock = nlohmann::json::parse(ReadText(STARSONIC_REPO_DIR "/build/deps.lock"));
    const std::vector<std::string> locked = lock.at("baresip").at("modules").get<std::vector<std::string>>();
    CHECK(BaresipLoop::Modules() == locked);
}

TEST_CASE("the baresip loop goes on when the hook of the baresip lines throws") {
    // Nenhuma exceção volta para o baresip, que é C: a linha se perde, e o laço segue.
    LoopConfig config;
    config.userAgent = phone_test::kUserAgent;
    config.nullAudio = true;
    std::atomic<int> lines{0};
    config.baresipLines = [&lines](const std::string&, bool) {
        ++lines;
        throw std::runtime_error("o gancho falhou");
    };
    std::string error;
    std::unique_ptr<BaresipLoop> loop = BaresipLoop::Start(config, nullptr, &error);
    REQUIRE_MESSAGE(loop != nullptr, error);
    CHECK(lines.load() > 0);   // as linhas da subida do baresip
    bool ran = false;
    CHECK(loop->Run([&ran] { ran = true; }));
    CHECK(ran);
}

TEST_CASE("the baresip loop goes on when its log sink throws") {
    // O LogSink recebe as linhas da libre e do baresip dentro deles, que são C: nenhuma exceção volta para eles. A
    // linha se perde, e o baresipLines, que vem depois dela, ainda a recebe.
    LoopConfig config;
    config.userAgent = phone_test::kUserAgent;
    config.nullAudio = true;
    std::atomic<int> lines{0};
    config.baresipLines = [&lines](const std::string&, bool) { ++lines; };
    std::atomic<int> logged{0};
    const BaresipLoop::LogSink sink = [&logged](int, const std::string&) {
        ++logged;
        throw std::runtime_error("o log falhou");
    };
    std::string error;
    std::unique_ptr<BaresipLoop> loop = BaresipLoop::Start(config, sink, &error);
    REQUIRE_MESSAGE(loop != nullptr, error);
    CHECK(logged.load() > 0);   // as linhas da subida do baresip
    CHECK(lines.load() > 0);
    // Uma linha da libre (o dbg dela, que nenhum outro teste provoca) chega pelo mesmo caminho.
    const int before = logged.load();
    CHECK(loop->Run([] { dbg_printf(DBG_WARNING, "teste: uma linha da libre\n"); }));
    CHECK(logged.load() == before + 1);
    bool ran = false;
    CHECK(loop->Run([&ran] { ran = true; }));
    CHECK(ran);
}

TEST_CASE("the engine goes on when OnLog throws on a line from inside libre or baresip") {
    FakeRegistrar registrar("senha");
    ThrowingLogListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    // O REGISTER e a resposta dele passam pelo trace do SIP, que lança a cada mensagem: o registro segue.
    CHECK(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    CHECK(listener.Thrown() > 0);
    CHECK(Contains(listener.LogTail(), "SIP enviado ("));
}

TEST_CASE("a call that ends while OnLog throws leaves no call behind in the engine") {
    // O SipEngine.h não promete que o OnLog não lança: a linha se perde, e o fim da ligação vai até o fim. Na
    // transferência que dá certo, o motor escreve uma linha de dentro do aviso do baresip que encerra a ligação, e o
    // baresip solta a ligação logo depois do aviso: uma vaga que ficasse com ela apontaria para memória já solta.
    FakeRegistrar registrar("senha");
    ThrowingOnLogListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const auto dial = [&engine, &listener](const std::string& number) {
        const int id = engine->MakeCall(number);
        REQUIRE(id > 0);
        REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed), kWaitSeconds));
        return id;
    };
    listener.CountLog("transferencia aceita (200)");
    std::vector<int> ended;
    size_t transferLines = 0;
    SUBCASE("a transfer ends the call") {
        const int id = dial("2002");
        listener.Throw(true);
        REQUIRE(engine->Transfer(id, "2004"));
        ended = {id};
        transferLines = 1;
    }
    SUBCASE("an attended transfer ends both calls") {
        const int client = dial("2002");
        const int colleague = dial("2003");   // o cliente vai para a espera
        REQUIRE(registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
        listener.Throw(true);
        REQUIRE(engine->TransferAttended(client, colleague));
        ended = {client, colleague};
        transferLines = 1;
    }
    SUBCASE("the other side hangs up") {
        REQUIRE(registrar.Control("RING 2001") == kOk);
        REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, 1), kWaitSeconds));
        const int id = listener.Calls().front().callId;
        REQUIRE(engine->Answer(id));
        REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed), kWaitSeconds));
        listener.Throw(true);
        REQUIRE(registrar.Control("HANGUP 2001") == kOk);
        ended = {id};
    }
    for (const int id : ended) {
        CAPTURE(id);
        CHECK(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Disconnected), kWaitSeconds));
    }
    listener.Throw(false);
    CHECK(listener.LogCount("transferencia aceita (200)") == transferLines);   // a linha chegou ao OnLog, que lançou
    // Nenhuma vaga ficou com uma ligação: a conta caiu a zero, a leitura do áudio passa pelas vagas, e uma nova sai.
    CHECK(engine->CallCount() == 0);
    CHECK(SipEngineTestAccess::CallsWithAudio(*engine).empty());
    const int next = dial("2005");
    CHECK(WaitAudio(*engine, {next}));
    CHECK(engine->AudioLinks(next) == std::vector<int>{0});
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

TEST_CASE("HandleIpChange reads the local addresses again before it binds the transports") {
    // O baresip lê os endereços locais ao subir, e o uag_reset_transp abre os transportes SIP nos da lista dele: numa
    // troca de rede de verdade (o Wi-Fi para o 4G), os da rede de antes. O Linux dos testes não troca de rede; a lista
    // vazia faz as vezes da velha (nenhum endereço de agora nela).
    Transport transport = Transport::Udp;
    SUBCASE("over UDP") { transport = Transport::Udp; }
    SUBCASE("over TCP") { transport = Transport::Tcp; }
    Phone phone(transport);
    INFO(phone.listener.LogTail());
    INFO(RegistrationsText(phone.listener));
    INFO(phone.listener.CallsText());
    SipEngineTestAccess::FlushLocalAddresses(*phone.engine);
    phone.engine->HandleIpChange();
    CHECK(phone.listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    // Os transportes estão abertos nos endereços de agora: a ligação que chega toca. A feita daqui tira o endereço da
    // mídia da mesma lista, que tem de novo o loopback dos testes.
    const int incoming = phone.Ring();
    REQUIRE(phone.engine->Reject(incoming));
    REQUIRE(phone.WaitState(incoming, CallState::Disconnected));
    const int outgoing = phone.Dial("2002");
    CHECK(WaitAudio(*phone.engine, {outgoing}));
    CHECK(phone.engine->AudioLinks(outgoing) == std::vector<int>{0});
}

TEST_CASE("a TCP account dials over TCP") {
    Phone phone(Transport::Tcp);
    const int id = phone.Dial("2002");
    CHECK(Contains(phone.listener.LogTail(),
                   "INVITE sip:2002@127.0.0.1:" + std::to_string(phone.registrar.port()) + ";transport=tcp SIP/2.0"));
    CHECK(phone.engine->Hangup(id));
}

TEST_CASE("Reject and Hangup of a ringing call end it with 486 and 603") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int rejected = phone.Ring();
    REQUIRE(phone.engine->Reject(rejected));
    REQUIRE(phone.WaitState(rejected, CallState::Disconnected));
    CHECK(History(phone.listener.Calls(), rejected) == "Incoming Incoming/100 Early/180 Disconnected/486");
    const int declined = phone.Ring();
    REQUIRE(phone.engine->Hangup(declined));
    REQUIRE(phone.WaitState(declined, CallState::Disconnected));
    CHECK(History(phone.listener.Calls(), declined) == "Incoming Incoming/100 Early/180 Disconnected/603");
    CHECK(phone.registrar.WaitForLog("inv-out 2001 603", kWaitSeconds));
}

TEST_CASE("Hangup of an outgoing call without an answer ends it with 487") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 60000);   // nada volta durante o teste
    RecordingListener listener;
    INFO(listener.CallsText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));   // a conta basta, sem registro
    const int id = engine->MakeCall("2002");
    REQUIRE(id >= 0);
    REQUIRE(engine->Hangup(id));
    CHECK_FALSE(engine->HasCall());
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Disconnected), kWaitSeconds));
    CHECK(History(listener.Calls(), id) == "Calling/0 Disconnected/487");
}

TEST_CASE("Hangup right after MakeCall cancels the call at the far end once the first answer arrives") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 300);   // as respostas ao INVITE só chegam depois do Hangup
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const int id = engine->MakeCall("2002");
    REQUIRE(id >= 0);
    REQUIRE(engine->Hangup(id));   // antes de qualquer resposta: o CANCEL ainda não pode sair
    CHECK_FALSE(engine->HasCall());
    // O registrador responde sozinho 100, 180 e 200: o CANCEL sai no 180, ou o BYE depois do 200.
    CHECK(WaitUntil([&registrar] { return registrar.LogHas("cancel-in 2002") || registrar.LogHas("bye-in 2002"); },
                    kWaitSeconds));
    CHECK(History(listener.Calls(), id) == "Calling/0 Disconnected/487");
}

TEST_CASE("Hangup of an answered call that still waits for the ACK sends the BYE after the ACK") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 300);   // o ACK do nosso 200 chega 600 ms depois dele
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    REQUIRE(registrar.Control("RING 2001") == kOk);
    REQUIRE(listener.WaitForCalls(RecordingListener::Count(phone_test::CallEvent::Incoming, 1), kWaitSeconds));
    const int id = listener.Calls().front().callId;
    REQUIRE(engine->Answer(id));
    REQUIRE(engine->Hangup(id));   // o 200 saiu, e o ACK ainda não chegou
    CHECK(registrar.WaitForLog("bye-in 3001", kWaitSeconds));
    // Cada mensagem SIP que sai ou chega vira uma linha de log, na hora: o BYE saiu depois de o ACK chegar.
    const std::string log = listener.LogTail();
    const size_t ack = log.find("\nACK sip:");
    const size_t bye = log.find("\nBYE sip:");
    CHECK(ack != std::string::npos);
    CHECK(bye != std::string::npos);
    CHECK(ack < bye);
    CHECK(History(listener.Calls(), id) == "Incoming Incoming/100 Early/180 Connecting/200 Disconnected/200");
}

TEST_CASE("a call that arrives while hung-up calls still wait for the far end rings by the rules of the engine") {
    // A ligação desligada que ainda espera a resposta do outro lado (aqui, o 18x para o CANCEL) conta no limite de
    // ligações do próprio baresip. O 486 desse limite não passa pelo motor: a regra das duas ligações é do motor.
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 500);   // cada resposta chega 1 s depois do pedido
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    // Quatro ligações desligadas logo depois do MakeCall: as quatro esperam o 18x, que só chega 1 s depois.
    for (const char* number : {"2002", "2003", "2004", "2005"}) {
        const int id = engine->MakeCall(number);
        REQUIRE(id > 0);
        REQUIRE(engine->Hangup(id));
    }
    REQUIRE_FALSE(engine->HasCall());
    REQUIRE(registrar.Control("RING 2001") == kOk);   // o INVITE chega em 0,5 s, antes do 18x de qualquer uma delas
    CHECK(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, 1), kWaitSeconds));
    CHECK_FALSE(registrar.LogHas("inv-out 2001 486"));
}

TEST_CASE("an outgoing call that cannot reach the server ends with 503") {
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(listener.LogTail());
    // Ninguém escuta na porta: a conexão TCP é recusada. O 503 é o código do PJSIP para o erro de transporte
    // (PJSIP_SC_TSX_TRANSPORT_ERROR).
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(phone_test::FreePort()));
    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    const int id = engine->MakeCall("2002");
    REQUIRE(id >= 0);
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Disconnected), kWaitSeconds));
    CHECK(History(listener.Calls(), id) == "Calling/0 Disconnected/503");
    CHECK_FALSE(engine->HasCall());
}

TEST_CASE("a call that arrives while the account leaves gets 480 and no event") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    // O registrador descarta a saída: o RemoveAccount espera a resposta dela (~3 s), e o contato continua lá.
    REQUIRE(phone.registrar.Control("DROP REGISTER on") == kOk);
    phone.listener.CountLog("REGISTER sip:");
    std::thread remover([&phone] { phone.engine->RemoveAccount(); });
    // O REGISTER com Expires 0 já saiu: a conta está saindo.
    CHECK(WaitUntil([&phone] { return phone.listener.LogCount("REGISTER sip:") > 0; }, kWaitSeconds));
    CHECK(phone.registrar.Control("RING 2001") == kOk);
    CHECK(phone.registrar.WaitForLog("inv-out 2001 480", kWaitSeconds));
    remover.join();
    CHECK(phone.listener.Calls().empty());
}

TEST_CASE("SetPushData during a call registers again and keeps the call") {
    Phone phone;
    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->SetPushData(kPush));
    CHECK(phone.listener.WaitFor(RecordingListener::Reached(200, true, 2), kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(phone.listener.Calls()));
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});
}

TEST_CASE("only the active call has the microphone and the speaker open") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);
    CHECK(WaitAudio(*phone.engine, {second}));
    REQUIRE(phone.engine->Activate(first));
    CHECK(WaitAudio(*phone.engine, {first}));
    REQUIRE(phone.engine->Hangup(first));
    REQUIRE(phone.WaitState(first, CallState::Disconnected));
    CHECK(WaitAudio(*phone.engine, {}));   // a outra segue em espera
    REQUIRE(phone.engine->Activate(second));
    CHECK(WaitAudio(*phone.engine, {second}));
}

TEST_CASE("the microphone of a call on hold stays closed after the answer to each re-INVITE") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    // Ao aplicar cada SDP de uma ligação só de envio (a em espera), o baresip abre de novo a fonte de som dela, e o
    // audio_started dela continua false: só a conta das fontes abertas mostra esse microfone.
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);
    // O 200 do re-INVITE da espera da primeira chegou antes do ACK da segunda: o registrador responde na ordem.
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    REQUIRE(phone.engine->Activate(first));   // a segunda vai para a espera, e depois a primeira volta
    // A resposta à retomada da primeira (o áudio dela aberto) vem depois da resposta à espera da segunda.
    REQUIRE(WaitAudio(*phone.engine, {first}));
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
}

TEST_CASE("a call loses its audio as soon as it is put on hold, before the answer to the re-INVITE") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 300);   // cada resposta chega 600 ms depois do pedido
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const int id = engine->MakeCall("2002");
    REQUIRE(id > 0);
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed), kWaitSeconds));
    REQUIRE(WaitAudio(*engine, {id}));
    REQUIRE(engine->SetHold(id, true));
    CHECK(SipEngineTestAccess::CallsWithAudio(*engine).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*engine) == 0);
    CHECK(engine->AudioLinks(id).empty());
    CHECK(registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
}

TEST_CASE("a call confirmed while the other one is the active stays without audio until Activate") {
    FakeRegistrar registrar("senha");
    DelayedUdpRelay relay(registrar.port(), 300);   // cada resposta chega 600 ms depois do pedido
    RecordingListener listener;
    INFO(listener.CallsText());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(relay.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const int first = engine->MakeCall("2002");
    REQUIRE(first > 0);
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(first, CallState::Confirmed), kWaitSeconds));
    // A resposta à espera (o SDP espelhado, recvonly) entra no log quando chega, na mesma volta do laço que a trata: o
    // pedido seguinte ao motor já a encontra tratada.
    listener.CountLog("a=recvonly");
    REQUIRE(engine->SetHold(first, true));
    REQUIRE(WaitUntil([&listener] { return listener.LogCount("a=recvonly") > 0; }, kWaitSeconds));
    // A segunda chama (a ativa), e a primeira volta a ser a ativa antes de a segunda ser confirmada: como no motor do
    // PJSIP, a segunda fica sem o som e fora da espera.
    const int second = engine->MakeCall("2003");
    REQUIRE(second > 0);
    REQUIRE(engine->Activate(first));
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(second, CallState::Confirmed), kWaitSeconds));
    CHECK(WaitAudio(*engine, {first}));
    CHECK(engine->AudioLinks(second).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*engine) == 1);
    // A segunda vira a ativa sem re-INVITE dela, e a primeira vai para a espera.
    REQUIRE(engine->Activate(second));
    CHECK(WaitAudio(*engine, {second}));
    CHECK(engine->AudioLinks(second) == std::vector<int>{0});
    CHECK(WaitUntil([&registrar] { return phone_test::LogCount(registrar, "reinv-in 2002 sendonly") == 2; },
                    kWaitSeconds));
    CHECK(registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "inv-in 2003 200",
                                   "reinv-in 2002 sendrecv", "reinv-in 2002 sendonly"});
}

TEST_CASE("a resume that cannot go out leaves the call on hold, and the next one sends it") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int id = phone.Dial("2002");
    REQUIRE(phone.engine->SetHold(id, true));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    SipEngineTestAccess::FailReinvites(*phone.engine, true);   // a rede cai: nenhum re-INVITE sai
    CHECK_FALSE(phone.engine->SetHold(id, false));
    CHECK(phone.engine->AudioLinks(id).empty());   // segue em espera, sem áudio
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 0);
    SipEngineTestAccess::FailReinvites(*phone.engine, false);   // a rede volta: o pedido seguinte manda a retomada
    REQUIRE(phone.engine->SetHold(id, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {id}));
    CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly", "reinv-in 2002 sendrecv"});
}

TEST_CASE("a hold that cannot go out leaves the call active, and the next one sends it") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int id = phone.Dial("2002");
    REQUIRE(WaitAudio(*phone.engine, {id}));
    SipEngineTestAccess::FailReinvites(*phone.engine, true);   // a rede cai: nenhum re-INVITE sai
    CHECK_FALSE(phone.engine->SetHold(id, true));
    CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});   // segue a ativa, com o áudio
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine) == std::vector<int>{id});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    SipEngineTestAccess::FailReinvites(*phone.engine, false);   // a rede volta: o pedido seguinte manda a espera
    REQUIRE(phone.engine->SetHold(id, true));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    CHECK(phone.engine->AudioLinks(id).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 0);
    CHECK(phone.registrar.Log() == Lines{"inv-in 2002 200", "reinv-in 2002 sendonly"});
}

TEST_CASE("Answer and MakeCall go ahead after ~2 s when the renegotiation of the other call does not end") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int first = phone.Answered();
    REQUIRE(phone.engine->SetHold(first, true));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
    // A retomada da primeira sai e fica sem resposta (a libre a repete até o tempo esgotar, em 32 s): a renegociação
    // dela não acaba, e a espera dela, antes da segunda, não pode sair.
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    phone.listener.CountLog("ela fica sem audio");
    int second = 0;
    SUBCASE("Answer") {
        second = phone.Ring();
        REQUIRE(phone.engine->SetHold(first, false));
        const auto start = std::chrono::steady_clock::now();
        REQUIRE(phone.engine->Answer(second));
        CHECK(std::chrono::steady_clock::now() - start >= std::chrono::milliseconds(1900));
    }
    SUBCASE("MakeCall") {
        REQUIRE(phone.engine->SetHold(first, false));
        const auto start = std::chrono::steady_clock::now();
        second = phone.engine->MakeCall("2002");
        REQUIRE(second > 0);
        CHECK(std::chrono::steady_clock::now() - start >= std::chrono::milliseconds(1900));
    }
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
    // A primeira fica sem o áudio daqui e fora da espera, e o outro lado dela não fica sabendo.
    CHECK(phone.engine->AudioLinks(first).empty());
    CHECK(phone.engine->AudioLinks(second) == std::vector<int>{0});
    CHECK(WaitAudio(*phone.engine, {second}));
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    CHECK(phone.listener.LogCount("ela fica sem audio") == 1);
}

TEST_CASE("Activate swaps the audio even when the hold of the other call cannot go out") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    phone.listener.CountLog("ela fica sem audio");
    SipEngineTestAccess::FailReinvites(*phone.engine, true, second);   // só o re-INVITE da segunda não sai
    CHECK(phone.engine->Activate(first));   // a retomada da primeira sai
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    CHECK(phone.listener.LogCount("ela fica sem audio") == 1);
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {first}));
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(second).empty());   // fora da espera, sem o áudio daqui
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    CHECK(phone.LogCount("reinv-in 3001 sendonly") == 1);   // só a espera da primeira, a do TwoCalls
}

TEST_CASE("Activate takes the audio from the other call at once and swaps after ~2 s without its hold") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    REQUIRE(phone.engine->SetHold(second, true));
    REQUIRE(phone.WaitForLogCount("reinv-in 3001 sendonly", 2));
    // A retomada da segunda sai e fica sem resposta: a renegociação dela não acaba, e a espera dela não pode sair.
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    REQUIRE(phone.engine->SetHold(second, false));
    phone.listener.CountLog("ela fica sem audio");
    bool activated = false;
    std::thread swap([&phone, first, &activated] { activated = phone.engine->Activate(first); });
    // Enquanto o Activate espera, a segunda, que o app já mostra em espera, deixa de ter o microfone na hora; a
    // primeira ainda está em espera.
    CHECK(WaitUntil([&phone] { return SipEngineTestAccess::OpenMicrophones(*phone.engine) == 0; }, 1));
    swap.join();
    CHECK(activated);   // a retomada da primeira saiu (sem resposta, por ora)
    CHECK(phone.listener.LogCount("ela fica sem audio") == 1);
    REQUIRE(phone.registrar.Control("DROP REINVITE off") == kOk);   // a repetição da retomada é respondida
    CHECK(WaitAudio(*phone.engine, {first}));
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});
    CHECK(phone.engine->AudioLinks(second).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
}

TEST_CASE("a MakeCall that cannot go out after the fallback leaves the other call as it was, with no silence line") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int first = phone.Answered();
    REQUIRE(phone.engine->SetHold(first, true));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    REQUIRE(phone.engine->SetHold(first, false));   // a retomada sai e fica sem resposta
    phone.listener.CountLog("ela fica sem audio");
    // Depois do prazo, a nova não sai: a ua_connect recusa na hora (Invalid argument) um número com @ e um endereço
    // IPv6.
    CHECK(phone.engine->MakeCall("2002@[::1]") == -1);
    CHECK(phone.listener.LogCount("ela fica sem audio") == 0);
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});   // a primeira segue a ativa, com o áudio
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
}

TEST_CASE("an Activate that waits for the other call gets its audio back when the other call ends during the wait") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    // A primeira é feita daqui (2002) e a segunda é do RING (3001): os re-INVITE de cada uma vão a um nome.
    const int first = phone.Dial("2002");
    const int second = phone.Answered();   // a primeira vai para a espera
    REQUIRE(phone.engine->Activate(first));   // a segunda vai para a espera, e a primeira volta
    REQUIRE(WaitAudio(*phone.engine, {first}));
    // O registrador já tratou os re-INVITE de até aqui: o comando de controle abaixo, que corre numa thread própria
    // dele, não passa na frente de nenhum.
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    // A segunda volta a ser a ativa sem a espera da primeira (o re-INVITE dela não sai), e a retomada da segunda sai e
    // fica sem resposta: a primeira fica confirmada, fora da espera e sem áudio, e a segunda, com uma oferta no ar.
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    SipEngineTestAccess::FailReinvites(*phone.engine, true, first);
    REQUIRE(phone.engine->Activate(second));
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    REQUIRE(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);   // o da segunda
    // Daqui em diante, cada INVITE que o motor manda à primeira (o log tem cada mensagem que sai, também as que o
    // registrador descarta) conta.
    phone.listener.CountLog("\nINVITE sip:2002@");
    // O Activate da primeira tira o áudio da segunda e espera a oferta dela, e a segunda acaba nessa espera.
    bool activated = false;
    std::thread swap([&phone, first, &activated] { activated = phone.engine->Activate(first); });
    CHECK(WaitUntil([&phone] { return SipEngineTestAccess::OpenMicrophones(*phone.engine) == 0; }, kWaitSeconds));
    CHECK(phone.registrar.Control("HANGUP 2001") == kOk);   // o BYE da segunda, a única do RING
    swap.join();
    CHECK(activated);
    REQUIRE(phone.WaitState(second, CallState::Disconnected));
    // A primeira é a ativa, e o áudio dela volta sem re-INVITE.
    CHECK(WaitAudio(*phone.engine, {first}));
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.LogCount("\nINVITE sip:2002@") == 0);
}

TEST_CASE("an Activate that waits for its own earlier re-INVITE tries the hold of the other call once") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int first = phone.Answered();
    // A espera da primeira, antes do 200 da segunda, sai e fica sem resposta (a libre a repete).
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    const int second = phone.Ring();
    REQUIRE(phone.engine->Answer(second));
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
    phone.listener.CountLog("ela fica sem audio");
    SipEngineTestAccess::FailReinvites(*phone.engine, true, second);   // a espera da segunda não sai
    // Como no Focus do motor do PJSIP, a espera da segunda é tentada uma vez, e a retomada da primeira espera a
    // espera dela; com a repetição dessa espera respondida, a retomada sai.
    bool activated = false;
    std::thread swap([&phone, first, &activated] { activated = phone.engine->Activate(first); });
    CHECK(WaitUntil([&phone] { return phone.listener.LogCount("ela fica sem audio") > 0; }, kWaitSeconds));
    CHECK(phone.registrar.Control("DROP REINVITE off") == kOk);
    swap.join();
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    CHECK(activated);
    CHECK(phone.listener.LogCount("ela fica sem audio") == 1);
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {first}));
    CHECK(phone.engine->AudioLinks(second).empty());   // fora da espera, sem o áudio daqui
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    // O pedido seguinte tenta a espera da segunda de novo, e ela sai (a repetição da espera da primeira e esta).
    REQUIRE(phone.engine->Activate(first));
    CHECK(phone.WaitForLogCount("reinv-in 3001 sendonly", 2));
}

TEST_CASE("a Split refused because its call ended leaves the next request free to hold the other call") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    // b (2002) fica fora da espera sem ser a ativa: a espera dela não sai quando a (a do RING) é atendida.
    const int b = phone.Dial("2002");
    SipEngineTestAccess::FailReinvites(*phone.engine, true, b);
    const int a = phone.Answered();
    // A espera de a sai e fica sem resposta (a libre a repete).
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    REQUIRE(phone.engine->SetHold(a, true));
    phone.listener.CountLog("ela fica sem audio");
    // O Split(a, b) deixa de lado a espera de b, que não sai, e espera a de a. Nessa espera, a acaba, e a tentativa
    // seguinte do mesmo Split é recusada logo na conferência dos ids.
    bool split = true;
    std::thread separate([&phone, a, b, &split] { split = phone.engine->Split(a, b); });
    CHECK(WaitUntil([&phone] { return phone.listener.LogCount("ela fica sem audio") > 0; }, kWaitSeconds));
    CHECK(phone.registrar.Control("HANGUP 2001") == kOk);   // o BYE de a, a única do RING
    separate.join();
    CHECK_FALSE(split);
    REQUIRE(phone.WaitState(a, CallState::Disconnected));
    // Uma nova (c, 2003) vira a ativa, ainda sem a espera de b. O pedido seguinte que tem b como a outra tenta a espera
    // dela: o que o Split de antes deixou de lado não vale para ele.
    const int c = phone.Dial("2003");
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    REQUIRE(phone.registrar.Control("DROP REINVITE off") == kOk);
    REQUIRE(phone.engine->Activate(c));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    CHECK(phone.engine->AudioLinks(b).empty());
    CHECK(phone.engine->AudioLinks(c) == std::vector<int>{0});
}

TEST_CASE("SetMute mutes every call now and the next ones") {
    Phone phone;
    const int first = phone.Dial("2002");
    phone.engine->SetMute(true);
    CHECK(SipEngineTestAccess::MutedCalls(*phone.engine) == std::vector<int>{first});
    const int second = phone.Dial("2003");   // a primeira vai para a espera
    CHECK(SipEngineTestAccess::MutedCalls(*phone.engine) == std::vector<int>{first, second});
    phone.engine->SetMute(false);
    CHECK(SipEngineTestAccess::MutedCalls(*phone.engine).empty());
}

TEST_CASE("SendDtmf sends 0-9, *, # and A-D in a confirmed call, and the log line has the count, not the digits") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.listener.LogTail());
    const int id = phone.Ring();
    CHECK_FALSE(phone.engine->SendDtmf(id, "1"));   // ainda toca
    REQUIRE(phone.engine->Answer(id));
    REQUIRE(phone.WaitState(id, CallState::Confirmed));
    phone.listener.CountLog("SendDtmf: ");
    for (const std::string digits : {"", "1x", "1 2", "a", "E"}) {
        CAPTURE(digits);
        CHECK_FALSE(phone.engine->SendDtmf(id, digits));
    }
    CHECK(phone.listener.LogCount("SendDtmf: ") == 0);   // nada saiu
    // Cada tecla do RFC 2833 termina com a soltura, que o baresip escreve no log ao mandar o fim do evento.
    phone.listener.CountLog("audio: send DTMF digit end: ");
    CHECK(phone.engine->SendDtmf(id, "0123456789*#ABCD"));
    CHECK(phone.listener.LogCount("SendDtmf: ") == 1);
    CHECK(Contains(phone.listener.LogTail(), "\nSendDtmf: 16 digito(s), using RFC2833 method\n"));
    CHECK(phone.listener.LogCount("audio: send DTMF digit end: ") == 16);
}

TEST_CASE("a REFER from the other side in a call is refused with 501, and the call goes on as it was") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int id = phone.Answered();
    REQUIRE(WaitAudio(*phone.engine, {id}));
    REQUIRE(phone.registrar.Control("REFER 2001 2003") == kOk);
    // A ligação não tem o handler de REFER do baresip (o call_transfer da conta desligado): a libre responde 501.
    CHECK(phone.registrar.WaitForLog("refer-out 2001 501", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(History(phone.listener.Calls(), id) == "Incoming Incoming/100 Early/180 Connecting/200 Confirmed/200");
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine) == std::vector<int>{id});
    REQUIRE(phone.engine->SetHold(id, true));   // a ligação segue como antes: a espera sai
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
}

TEST_CASE("an INVITE that replaces a call is refused with 603, with no event, and the call goes on as it was") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int id = phone.Answered();
    REQUIRE(WaitAudio(*phone.engine, {id}));
    const size_t events = phone.listener.EventCount();
    REQUIRE(phone.registrar.Control("REPLACES 2001") == kOk);
    CHECK(phone.registrar.WaitForLog("inv-out 2001 603", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.listener.EventCount() == events);   // nenhum OnIncomingCall, e a de agora não acabou
    CHECK(Contains(phone.listener.LogTail(), "pedido de troca de ligacao (Replaces) recebido e recusado (603)"));
    CHECK(phone.engine->CallCount() == 1);
    CHECK(phone.engine->AudioLinks(id) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine) == std::vector<int>{id});
    REQUIRE(phone.engine->SetHold(id, true));   // a ligação segue como antes: a espera sai
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendonly", kWaitSeconds));
}

TEST_CASE("a transfer goes one at a time: the next one waits for the result of the one on the way") {
    SlowPhone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == kOk);   // o servidor recusa: as ligações seguem
    // O REFER sai dentro do pedido (o destino é um endereço IP, sem DNS): os recusados são conferidos na hora. A conta
    // é a dos pedidos, e não a do registrador, que registra também cada repetição do UDP (sem a resposta em 500 ms,
    // numa máquina lenta).
    const int client = phone.client;
    REQUIRE(phone.engine->Transfer(client, "2003"));
    CHECK_FALSE(phone.engine->Transfer(client, "2004"));   // a resposta ao REFER ainda não chegou
    CHECK(phone.listener.Refers() == Lines{"2003"});   // e nada saiu dele
    REQUIRE(WaitTransfers(phone.listener, client, 1));
    CHECK(phone.engine->Transfer(client, "2004"));   // com o resultado, vale de novo
    REQUIRE(WaitTransfers(phone.listener, client, 2));

    const int colleague = phone.Dial("2003");   // o cliente vai para a espera
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    CHECK_FALSE(phone.engine->TransferAttended(client, colleague));
    CHECK_FALSE(phone.engine->TransferAttended(colleague, client));
    CHECK_FALSE(phone.engine->Transfer(client, "2004"));
    CHECK(phone.listener.Refers() == Lines{"2003", "2004", "2003 replaces"});
    REQUIRE(WaitTransfers(phone.listener, client, 3));
    CHECK(phone.engine->TransferAttended(client, colleague));
    REQUIRE(WaitTransfers(phone.listener, client, 4));
    CHECK(Transfers(phone.listener.Calls(), client) == std::vector<int>{603, 603, 603, 603});
    CHECK(Transfers(phone.listener.Calls(), colleague).empty());
    CHECK(phone.engine->CallCount() == 2);
    CHECK(phone.listener.Refers() == Lines{"2003", "2004", "2003 replaces", "2003 replaces"});
    CHECK(phone.registrar.LogHas("refer-in 2002 2003"));
    CHECK(phone.registrar.LogHas("refer-in 2002 2004"));
    CHECK(phone.registrar.LogHas("refer-in 2002 2003 replaces=known"));
}

TEST_CASE("a call that ends before the result of its transfer reports no OnTransfer") {
    SlowPhone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int id = phone.client;
    REQUIRE(phone.engine->Transfer(id, "2003"));
    REQUIRE(phone.engine->Hangup(id));   // antes do 202 e do NOTIFY 200
    CHECK(phone.registrar.WaitForLog("refer-in 2002 2003", kWaitSeconds));
    CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
    std::this_thread::sleep_for(std::chrono::milliseconds(800));   // as respostas já voltaram ao motor
    CHECK(History(phone.listener.Calls(), id) == "Calling/0 Early/180 Connecting/200 Confirmed/200 Disconnected/200");
}

TEST_CASE("a transfer whose REFER cannot reach the other side reports 503, and the call goes on as it was") {
    // O registrador sai com a ligação de pé: no TCP, o REFER não acha mais ninguém na porta, e a libre fecha a
    // assinatura dele com o erro da conexão, sem resposta nenhuma; o baresip só escreve "call: subscription closed",
    // uma linha de informação, também com o logLevel 2, e o log do motor continua sem as linhas acima dele.
    int logLevel = 4;
    SUBCASE("logLevel 4") { logLevel = 4; }
    SUBCASE("logLevel 2") { logLevel = 2; }
    std::unique_ptr<FakeRegistrar> registrar(new FakeRegistrar("senha"));
    LevelListener listener;
    INFO(listener.CallsText());
    INFO(listener.LogTail());
    EngineConfig config = phone_test::ConfigFor(LoadProfile(registrar->port()));
    config.logLevel = logLevel;
    std::string error;
    std::unique_ptr<SipEngine> engine = SipEngine::Create(config, &listener, &error);
    REQUIRE_MESSAGE(engine != nullptr, error);
    REQUIRE(engine->SetAccount(Input(Transport::Tcp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));
    const int id = engine->MakeCall("2002");
    REQUIRE(id > 0);
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(id, CallState::Confirmed), kWaitSeconds));
    registrar.reset();   // a conexão TCP fecha, e ninguém mais escuta na porta
    std::this_thread::sleep_for(std::chrono::milliseconds(500));   // a libre já tratou o fim da conexão
    REQUIRE(engine->Transfer(id, "2003"));
    REQUIRE(WaitTransfers(listener, id, 1));
    CHECK(Transfers(listener.Calls(), id) == std::vector<int>{503});
    // A linha do motor sai na thread do laço logo depois do aviso, que pode chegar antes dela (o OnLog não passa pela
    // fila dos eventos).
    const std::string failed = "a transferencia nao deu certo (503)";
    CHECK(WaitUntil([&listener, &failed] { return Contains(listener.LogTail(), failed); }, kWaitSeconds));
    // A linha do baresip (de informação: só com o logLevel 3 ou mais) sai no log antes da do motor, que ela causou.
    const std::string log = listener.LogTail();
    if (logLevel >= 3) CHECK(log.find("call: subscription closed: ") < log.find(failed));
    // A ligação segue como estava, com o áudio, e uma transferência nova pode sair.
    CHECK_FALSE(RecordingListener::StateReached(id, CallState::Disconnected)(listener.Calls()));
    CHECK(engine->CallCount() == 1);
    CHECK(engine->AudioLinks(id) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::CallsWithAudio(*engine) == std::vector<int>{id});
    REQUIRE(engine->Transfer(id, "2004"));
    CHECK(WaitTransfers(listener, id, 2));
    CHECK(Transfers(listener.Calls(), id) == std::vector<int>{503, 503});
    CHECK(listener.MaxLevel() <= logLevel);
}

TEST_CASE("while a transfer waits for its result, no other transfer of either call goes out") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    REQUIRE(phone.registrar.Control("REFER_NOTIFY none") == kOk);   // o 202 sem NOTIFY: o resultado não vem
    int client = 0, colleague = 0;
    phone.Consultation(&client, &colleague);
    REQUIRE(phone.engine->Transfer(client, "2004"));
    REQUIRE(phone.registrar.WaitForLog("refer-in 2002 2004", kWaitSeconds));
    // O fim de uma assinatura com erro não diz de qual ligação ela é: uma transferência no ar por vez, das duas.
    CHECK_FALSE(phone.engine->Transfer(colleague, "2004"));
    CHECK_FALSE(phone.engine->TransferAttended(colleague, client));
    CHECK_FALSE(phone.engine->TransferAttended(client, colleague));
    CHECK_FALSE(phone.engine->Transfer(client, "2005"));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    size_t refers = 0;
    for (const std::string& line : phone.registrar.Log()) refers += line.compare(0, 9, "refer-in ") == 0 ? 1 : 0;
    CHECK(refers == 1);   // só o primeiro REFER saiu
    CHECK(Transfers(phone.listener.Calls(), client).empty());
    CHECK(Transfers(phone.listener.Calls(), colleague).empty());
}

TEST_CASE("the baresip line of a transfer subscription closed by an error gives 408 on timeout and 503 otherwise") {
    // O texto do erro é o %m da libre, o mesmo do BaresipLoop::ErrorText.
    const std::string closed = "call: subscription closed: ";
    CHECK(BaresipCalls::SubscriptionClosedCode(closed + BaresipLoop::ErrorText(ETIMEDOUT)) == 408);
    CHECK(BaresipCalls::SubscriptionClosedCode(closed + BaresipLoop::ErrorText(ECONNREFUSED)) == 503);
    CHECK(BaresipCalls::SubscriptionClosedCode(closed + BaresipLoop::ErrorText(ECONNRESET)) == 503);
    CHECK(BaresipCalls::SubscriptionClosedCode("call: transfer failed: 486 Busy Here") == 0);
    CHECK(BaresipCalls::SubscriptionClosedCode("audio: send DTMF digit: '1'") == 0);
}

TEST_CASE("both calls of the conference have audio, and Split leaves only the active one") {
    Phone phone;
    int a = 0, b = 0;
    phone.Conference(&a, &b);
    CHECK(WaitAudio(*phone.engine, Sorted({a, b})));
    REQUIRE(phone.engine->Split(a, b));
    CHECK(WaitAudio(*phone.engine, {a}));
}

TEST_CASE("after a Split, Join joins the two calls again") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int a = 0, b = 0;
    phone.Conference(&a, &b);
    REQUIRE(phone.engine->Split(a, b));   // a conferência acaba, e b vai para a espera
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->Join(a, b));   // b volta
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {a, b}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{a, b});
}

TEST_CASE("the conference mixes the two calls, and when it ends the call that stays has the audio alone") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    REQUIRE(phone.engine->Join(first, second));   // a primeira volta
    REQUIRE(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    REQUIRE(WaitAudio(*phone.engine, {first, second}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{first, second});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 2);
    // A primeira fica. No Split e no Activate dela, a segunda vai para a espera; nos outros, a segunda acaba.
    size_t holds = 1;   // a espera da primeira, no TwoCalls
    SUBCASE("Split") {
        REQUIRE(phone.engine->Split(first, second));
        holds = 2;
    }
    SUBCASE("Activate") {
        REQUIRE(phone.engine->Activate(first));
        holds = 2;
    }
    SUBCASE("Hangup") {
        REQUIRE(phone.engine->Hangup(second));
        REQUIRE(phone.WaitState(second, CallState::Disconnected));
    }
    SUBCASE("the other side hangs up") {
        REQUIRE(phone.registrar.Control("HANGUP 2001") == kOk);   // o BYE da segunda (a última do RING)
        REQUIRE(phone.WaitState(second, CallState::Disconnected));
    }
    CHECK(phone.WaitForLogCount("reinv-in 3001 sendonly", holds));
    CHECK(WaitAudio(*phone.engine, {first}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    CHECK(phone.engine->AudioLinks(first) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    // A que fica não manda re-INVITE nenhum.
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 3001 sendonly") == holds);
    CHECK(phone.LogCount("reinv-in 3001 sendrecv") == 1);   // a do Join
}

TEST_CASE("SetHold of a call in the conference takes it out of the mix, and the other one keeps the audio") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int a = 0, b = 0;
    phone.Conference(&a, &b);   // a (2002) e b (2003)
    REQUIRE(WaitAudio(*phone.engine, {a, b}));
    // Como no motor do PJSIP: a espera tira a ligação do som e da mistura, e a conferência segue com a outra.
    REQUIRE(phone.engine->SetHold(a, true));
    CHECK(phone.WaitForLogCount("reinv-in 2002 sendonly", 2));   // a da consulta e esta
    CHECK(WaitAudio(*phone.engine, {b}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    CHECK(phone.engine->AudioLinks(a).empty());
    CHECK(phone.engine->AudioLinks(b) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    // Ainda é a conferência: o Join não muda nada.
    const Lines before = phone.registrar.Log();
    CHECK(phone.engine->Join(a, b));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.registrar.Log() == before);
    // A retomada é o Activate: a conferência acaba, a outra vai para a espera e só a retomada tem o áudio.
    REQUIRE(phone.engine->SetHold(a, false));
    CHECK(phone.registrar.WaitForLog("reinv-in 2003 sendonly", kWaitSeconds));
    CHECK(phone.WaitForLogCount("reinv-in 2002 sendrecv", 2));   // a do Join e esta
    CHECK(WaitAudio(*phone.engine, {a}));
    CHECK(phone.engine->AudioLinks(b).empty());
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
}

TEST_CASE("Join gives the audio back to a call that stayed out of the hold, without a re-INVITE") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    SipEngineTestAccess::FailReinvites(*phone.engine, true, second);   // a espera da segunda não sai
    REQUIRE(phone.engine->Activate(first));   // a segunda fica fora da espera, sem o áudio daqui
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    REQUIRE(WaitAudio(*phone.engine, {first}));
    // O registro de antes do Join já tem a retomada da primeira (o registrador a registra quando a trata).
    REQUIRE(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    const Lines before = phone.registrar.Log();
    REQUIRE(phone.engine->Join(first, second));   // nenhuma em espera: nada a retomar
    CHECK(WaitAudio(*phone.engine, {first, second}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{first, second});
    CHECK(Sorted(phone.engine->AudioLinks(first)) == Sorted({0, second}));
    CHECK(Sorted(phone.engine->AudioLinks(second)) == Sorted({0, first}));
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.registrar.Log() == before);   // nenhum re-INVITE
}

TEST_CASE("a Join whose resume cannot go out leaves both calls as they were") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    SipEngineTestAccess::FailReinvites(*phone.engine, true, first);   // a retomada da primeira não sai
    CHECK_FALSE(phone.engine->Join(first, second));
    SipEngineTestAccess::FailReinvites(*phone.engine, false);
    CHECK(Contains(phone.listener.LogTail(), "retomar: "));
    // Como no motor do PJSIP, a conferência não começa: a primeira em espera, e a segunda a ativa, com o áudio.
    CHECK(phone.engine->AudioLinks(first).empty());
    CHECK(phone.engine->AudioLinks(second) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine) == std::vector<int>{second});
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    CHECK(SipEngineTestAccess::OpenMicrophones(*phone.engine) == 1);
    REQUIRE(phone.engine->Join(first, second));   // o seguinte junta as duas
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {first, second}));
}

TEST_CASE("Join is refused while an attended transfer waits for its result, and joins the calls after the result") {
    SlowPhone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    REQUIRE(phone.registrar.Control("REFER_REPLY 603") == kOk);   // o servidor recusa: as ligações seguem
    const int client = phone.client;
    const int colleague = phone.Dial("2003");   // o cliente vai para a espera
    REQUIRE(phone.engine->TransferAttended(client, colleague));
    // A resposta ao REFER ainda não chegou: a conferência não começa, e nada muda.
    CHECK_FALSE(phone.engine->Join(client, colleague));
    CHECK_FALSE(phone.engine->Join(colleague, client));
    CHECK(phone.engine->AudioLinks(client).empty());
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    REQUIRE(WaitTransfers(phone.listener, client, 1));
    REQUIRE(phone.engine->Join(client, colleague));   // com o resultado, vale
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {client, colleague}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{client, colleague});
}

TEST_CASE("Join waits for the earlier re-INVITE of the held call and is refused after ~2 s with nothing changed") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int client = phone.Dial("2002");
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    const int colleague = phone.Dial("2003");   // a espera do cliente sai e fica sem resposta (a libre a repete)
    // Como a retomada do motor do PJSIP, o Join espera até ~2 s a renegociação anterior da que está em espera.
    const auto start = std::chrono::steady_clock::now();
    CHECK_FALSE(phone.engine->Join(client, colleague));
    CHECK(std::chrono::steady_clock::now() - start >= std::chrono::milliseconds(1900));
    CHECK(Contains(phone.listener.LogTail(),
                   "a renegociacao anterior da ligacao nao terminou a tempo: pedido recusado"));
    // Nada mudou: o cliente em espera, sem áudio, o colega a ativa, e nada na mistura.
    CHECK(phone.engine->AudioLinks(client).empty());
    CHECK(phone.engine->AudioLinks(colleague) == std::vector<int>{0});
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine) == std::vector<int>{colleague});
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    // A repetição da espera do cliente é respondida, e o Join seguinte junta as duas.
    REQUIRE(phone.registrar.Control("DROP REINVITE off") == kOk);
    REQUIRE(phone.registrar.WaitForLog("reinv-in 2002 sendonly", kWaitSeconds));
    REQUIRE(phone.engine->Join(client, colleague));
    CHECK(phone.registrar.WaitForLog("reinv-in 2002 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {client, colleague}));
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{client, colleague});
}

TEST_CASE("a call that ends while Join waits leaves the other one as it was") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    const int first = phone.Answered();
    REQUIRE(phone.registrar.Control("DROP REINVITE on") == kOk);
    const int second = phone.Ring();
    REQUIRE(phone.engine->Answer(second));   // a espera da primeira sai e fica sem resposta
    REQUIRE(phone.WaitState(second, CallState::Confirmed));
    bool joined = true;
    std::atomic<bool> done{false};
    std::thread conference([&phone, first, second, &joined, &done] {
        joined = phone.engine->Join(first, second);
        done = true;
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK_FALSE(done.load());   // o Join espera a espera da primeira
    CHECK(phone.registrar.Control("HANGUP 2001") == kOk);   // e a segunda, a ativa, acaba
    conference.join();
    CHECK_FALSE(joined);
    REQUIRE(phone.WaitState(second, CallState::Disconnected));
    // Como no motor do PJSIP, o Join não acontece; aqui, a primeira nem foi retomada: segue em espera, sem áudio, e o
    // Activate a retoma.
    CHECK(phone.engine->AudioLinks(first).empty());
    CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine).empty());
    CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
    REQUIRE(phone.registrar.Control("DROP REINVITE off") == kOk);   // a repetição da espera é respondida
    REQUIRE(phone.engine->Activate(first));
    CHECK(phone.registrar.WaitForLog("reinv-in 3001 sendrecv", kWaitSeconds));
    CHECK(WaitAudio(*phone.engine, {first}));
}

TEST_CASE("Join resumes both calls when both are on hold") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int first = 0, second = 0;
    phone.TwoCalls(&first, &second);   // a primeira em espera, a segunda a ativa
    REQUIRE(phone.engine->SetHold(second, true));   // as duas em espera
    REQUIRE(phone.WaitForLogCount("reinv-in 3001 sendonly", 2));
    SUBCASE("both resumes go out") {
        REQUIRE(phone.engine->Join(first, second));
        CHECK(phone.WaitForLogCount("reinv-in 3001 sendrecv", 2));
        CHECK(WaitAudio(*phone.engine, {first, second}));
        CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{first, second});
        CHECK(Sorted(phone.engine->AudioLinks(first)) == Sorted({0, second}));
        CHECK(Sorted(phone.engine->AudioLinks(second)) == Sorted({0, first}));
    }
    SUBCASE("the second resume cannot go out") {
        SipEngineTestAccess::FailReinvites(*phone.engine, true, second);
        CHECK_FALSE(phone.engine->Join(first, second));
        SipEngineTestAccess::FailReinvites(*phone.engine, false);
        CHECK(Contains(phone.listener.LogTail(), "retomar: "));
        // A conferência não começa. Como no motor do PJSIP, a retomada da primeira já saiu: ela fica fora da espera e,
        // por não ser a ativa, sem o áudio daqui; a segunda segue em espera.
        CHECK(phone.WaitForLogCount("reinv-in 3001 sendrecv", 1));
        CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
        CHECK(SipEngineTestAccess::CallsWithAudio(*phone.engine).empty());
        CHECK(phone.engine->AudioLinks(first).empty());
        CHECK(phone.engine->AudioLinks(second).empty());
        // O Join seguinte só retoma a segunda e junta as duas.
        REQUIRE(phone.engine->Join(first, second));
        CHECK(phone.WaitForLogCount("reinv-in 3001 sendrecv", 2));
        CHECK(WaitAudio(*phone.engine, {first, second}));
        CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine) == std::vector<int>{first, second});
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(phone.LogCount("reinv-in 3001 sendrecv") == 2);   // uma retomada de cada
}

TEST_CASE("a transfer that succeeds during the conference ends it like the end of a call") {
    Phone phone;
    INFO(phone.listener.CallsText());
    INFO(phone.registrar.LogText());
    int a = 0, b = 0;
    phone.Conference(&a, &b);   // a (2002) e b (2003)
    REQUIRE(WaitAudio(*phone.engine, {a, b}));
    // Como no motor do PJSIP: o NOTIFY 200 encerra a ligação transferida, e a conferência acaba com ela.
    SUBCASE("Transfer: the other call stays, the active one, with its audio and with no re-INVITE") {
        REQUIRE(phone.engine->Transfer(a, "2004"));
        CHECK(phone.registrar.WaitForLog("refer-in 2002 2004", kWaitSeconds));
        CHECK(phone.WaitState(a, CallState::Disconnected));
        CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
        CHECK(Contains(History(phone.listener.Calls(), a), "Transfer/200 Disconnected/200"));
        CHECK(WaitAudio(*phone.engine, {b}));
        CHECK(SipEngineTestAccess::ConferenceCalls(*phone.engine).empty());
        CHECK(phone.engine->AudioLinks(b) == std::vector<int>{0});
        CHECK(phone.engine->CallCount() == 1);
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        CHECK_FALSE(RecordingListener::StateReached(b, CallState::Disconnected)(phone.listener.Calls()));
        CHECK(phone.LogCount("reinv-in 2003 sendonly") == 0);
        CHECK(phone.LogCount("reinv-in 2003 sendrecv") == 0);
    }
    SUBCASE("TransferAttended: both calls end") {
        REQUIRE(phone.engine->TransferAttended(a, b));
        CHECK(phone.registrar.WaitForLog("refer-in 2002 2003 replaces=known", kWaitSeconds));
        CHECK(phone.WaitState(a, CallState::Disconnected));
        CHECK(phone.WaitState(b, CallState::Disconnected));
        CHECK(phone.registrar.WaitForLog("bye-in 2002", kWaitSeconds));
        CHECK(phone.registrar.WaitForLog("bye-in 2003", kWaitSeconds));
        CHECK(phone.engine->CallCount() == 0);
        CHECK(Transfers(phone.listener.Calls(), a) == std::vector<int>{200});
        CHECK(Transfers(phone.listener.Calls(), b).empty());
        CHECK(Contains(History(phone.listener.Calls(), b), "Disconnected/200"));
    }
}
