#include "test_support.h"
#include "registrar_fixture.h"
#include "stun_fixture.h"

#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "RegistrationErrors.h"
#include "SipEngine.h"
#include "Text.h"

using namespace starsonic;
using phone_test::FakeRegistrar;
using phone_test::FakeStunServer;
using phone_test::RecordingListener;
using phone_test::RegistrationEvent;

namespace {

const char kUserAgent[] = "Starsonic Phone Android/0.0.0-test";
const int kWaitSeconds = 10;

// branding/perfil.ini, o mesmo arquivo que vai no APK; port > 0 troca a porta do servidor (o
// registrador falso sobe numa porta livre).
Profile LoadProfile(int port = 0) {
    const std::string bytes = phone_test::ReadText(STARSONIC_REPO_DIR "/branding/perfil.ini");
    Profile profile;
    const ParseResult result = ParseProfile(Utf8ToWide(StripUtf8Bom(bytes)), &profile);
    REQUIRE_MESSAGE(result.ok, "branding/perfil.ini nao passou no ParseProfile");
    if (port > 0) profile.account.port = port;
    return profile;
}

EngineConfig ConfigFor(const Profile& profile) {
    EngineConfig config;
    config.userAgent = kUserAgent;
    config.profile = profile;
    config.nullAudio = true;
    return config;
}

std::unique_ptr<SipEngine> StartEngine(RecordingListener* listener, const Profile& profile) {
    std::string error;
    std::unique_ptr<SipEngine> engine = SipEngine::Create(ConfigFor(profile), listener, &error);
    REQUIRE_MESSAGE(engine != nullptr, error);
    return engine;
}

AccountInput Input(Transport transport, const std::wstring& ramal = L"2001",
                   const std::wstring& senha = L"senha") {
    AccountInput input;
    input.address = L"127.0.0.1";
    input.transport = transport;
    input.ramal = ramal;
    input.senha = senha;
    return input;
}

// O primeiro registro que falhou sem resposta do servidor (503 ou 408); 0 se ainda nao houve.
int FindServerFailure(const std::vector<RegistrationEvent>& events) {
    for (const RegistrationEvent& event : events) {
        if (!event.active && (event.code == 503 || event.code == 408)) return event.code;
    }
    return 0;
}

bool Contains(const std::string& text, const std::string& part) {
    return text.find(part) != std::string::npos;
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

TEST_CASE("SipEngine uses the profile codecs in order") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    const std::vector<std::string> expected = {"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"};
    CHECK(engine->ActiveCodecs() == expected);
}

TEST_CASE("SipEngine skips the profile codecs that the build lacks") {
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile();
    profile.global.codecs = {L"PCMU", L"G729", L"PCMA"};   // este build do PJSIP nao traz o G.729
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    const std::vector<std::string> expected = {"PCMU/8000/1", "PCMA/8000/1"};
    CHECK(engine->ActiveCodecs() == expected);
    CHECK(Contains(listener.LogTail(), "G729/8000/1"));
}

TEST_CASE("SipEngine uses the STUN server of the profile") {
    FakeStunServer stun;
    RecordingListener listener;
    INFO(listener.LogTail());
    Profile profile = LoadProfile();
    profile.global.stun = Utf8ToWide("127.0.0.1:" + std::to_string(stun.port()));
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    CHECK(stun.Requests() > 0);
    // O endereço que o STUN devolveu e o que o transporte UDP passa a anunciar.
    CHECK(Contains(listener.LogTail(), std::string("SIP UDP socket reachable at ") + FakeStunServer::MappedAddress()));
}

TEST_CASE("SipEngine uses no STUN when the profile leaves stun empty") {
    RecordingListener listener;
    INFO(listener.LogTail());
    const Profile profile = LoadProfile();
    REQUIRE(profile.global.stun.empty());   // branding/perfil.ini: stun= vazio
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    // Sem servidor o pjsua nao escreve nada de STUN ao iniciar; com um, logo diz "Trying STUN server".
    CHECK_FALSE(Contains(listener.LogTail(), "STUN"));
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

TEST_CASE("SetAccount refuses an account without address or extension") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    CHECK_FALSE(engine->SetAccount(Input(Transport::Udp, L"")));
    AccountInput noAddress = Input(Transport::Udp);
    noAddress.address.clear();
    CHECK_FALSE(engine->SetAccount(noAddress));
    CHECK(listener.Registrations().empty());
}

TEST_CASE("SipEngine sends the start-up lines of the PJSIP to OnLog") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // Escrita pelo libCreate, antes de o writer do pjsua2 existir: sem o desvio iria para o terminal.
    CHECK(Contains(listener.LogTail(), "for POSIX initialized"));
}

TEST_CASE("SipEngine allows one instance per process") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> first = StartEngine(&listener, LoadProfile());

    std::string error;
    std::unique_ptr<SipEngine> second = SipEngine::Create(ConfigFor(LoadProfile()), &listener, &error);
    CHECK(!second);
    CHECK_FALSE(error.empty());

    first.reset();
    std::unique_ptr<SipEngine> again = SipEngine::Create(ConfigFor(LoadProfile()), &listener, &error);
    CHECK(again != nullptr);
}

TEST_CASE("SipEngine needs a listener") {
    std::string error;
    std::unique_ptr<SipEngine> engine = SipEngine::Create(ConfigFor(LoadProfile()), nullptr, &error);
    CHECK(!engine);
    CHECK_FALSE(error.empty());
}
