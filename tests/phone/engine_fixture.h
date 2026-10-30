#pragma once
// Apoio aos testes dos dois motores (o do PJSIP e o do baresip): o perfil de verdade (branding/perfil.ini), a
// configuração dos testes, a conta que entra no motor, os dados de push que o SetPushData aceita e os auxiliares
// das esperas e das contagens (WaitUntil, LogCount, Registers e o texto dos registros).
#include <algorithm>
#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "test_support.h"
#include "registrar_fixture.h"

#include "Profile.h"
#include "SipEngine.h"
#include "Text.h"

namespace phone_test {

const char kUserAgent[] = "Starsonic Phone Android/0.0.0-test";
const int kWaitSeconds = 10;

// branding/perfil.ini, o mesmo arquivo que vai no APK, sem STUN (os testes não saem da máquina; o
// teste do STUN põe o servidor dele). port > 0 troca a porta do servidor (o registrador falso sobe
// numa porta livre).
inline starsonic::Profile LoadProfile(int port = 0) {
    const std::string bytes = ReadText(STARSONIC_REPO_DIR "/branding/perfil.ini");
    starsonic::Profile profile;
    const starsonic::ParseResult result =
        starsonic::ParseProfile(starsonic::Utf8ToWide(starsonic::StripUtf8Bom(bytes)), &profile);
    REQUIRE_MESSAGE(result.ok, "branding/perfil.ini nao passou no ParseProfile");
    profile.global.stun.clear();
    if (port > 0) profile.account.port = port;
    return profile;
}

inline starsonic::EngineConfig ConfigFor(const starsonic::Profile& profile) {
    starsonic::EngineConfig config;
    config.userAgent = kUserAgent;
    config.profile = profile;
    config.nullAudio = true;
    return config;
}

inline std::unique_ptr<starsonic::SipEngine> StartEngine(RecordingListener* listener,
                                                         const starsonic::Profile& profile) {
    std::string error;
    std::unique_ptr<starsonic::SipEngine> engine = starsonic::SipEngine::Create(ConfigFor(profile), listener, &error);
    REQUIRE_MESSAGE(engine != nullptr, error);
    return engine;
}

inline starsonic::AccountInput Input(starsonic::Transport transport, const std::wstring& ramal = L"2001",
                                     const std::wstring& senha = L"senha") {
    starsonic::AccountInput input;
    input.address = L"127.0.0.1";
    input.transport = transport;
    input.ramal = ramal;
    input.senha = senha;
    return input;
}

inline bool Contains(const std::string& text, const std::string& part) {
    return text.find(part) != std::string::npos;
}

// Quantas vezes a linha está no registro de ligações do registrador.
inline size_t LogCount(const FakeRegistrar& registrar, const std::string& line) {
    const std::vector<std::string> log = registrar.Log();
    return static_cast<size_t>(std::count(log.begin(), log.end(), line));
}

// REGISTER aceitos do ramal (com Expires > 0); -1 se a porta de controle não respondeu.
inline int Registers(const FakeRegistrar& registrar, const std::string& ramal = "2001") {
    const std::vector<std::string> reply = registrar.Control("REGISTERS " + ramal);
    return reply.empty() ? -1 : std::stoi(reply[0]);
}

inline bool WaitUntil(const std::function<bool()>& condition, int seconds) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (!condition()) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return true;
}

inline size_t CountActive(const std::vector<phone_test::RegistrationEvent>& events) {
    return static_cast<size_t>(std::count_if(events.begin(), events.end(), [](const phone_test::RegistrationEvent& event) {
        return event.code == 200 && event.active;
    }));
}

// Os registros que chegaram, numa linha só, para as mensagens dos testes.
inline std::string RegistrationsText(const RecordingListener& listener) {
    std::string text;
    for (const phone_test::RegistrationEvent& event : listener.Registrations()) {
        text += std::to_string(event.code) + (event.active ? "+" : "-") + " ";
    }
    return text;
}

inline const std::vector<std::string> kOk = {"OK"};

// Os dados de push que o SetPushData aceita: os parâmetros do Contact da RFC 8599 e um token em cabeçalho.
inline starsonic::PushData ValidPushData() {
    starsonic::PushData data;
    data.contactParams = {{"pn-provider", "apns"}, {"pn-param", "ABCDE12345.br.com.starsonic.phone.voip"},
                          {"pn-prid", "00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0"}};
    data.headers = {{"X-Push-Token", "00fc13adff78512"}};
    return data;
}

}  // namespace phone_test
