#pragma once
// Apoio aos testes do motor: o perfil de verdade (branding/perfil.ini), a configuração dos testes e a
// conta que entra no motor.
#include <memory>
#include <string>

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

}  // namespace phone_test
