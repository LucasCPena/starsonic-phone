// Montagem do motor, igual para o do PJSIP e o do baresip: os codecs do perfil, o STUN, uma instância por
// processo, o que o Create exige e a conferência dos dados de push.
#include "engine_fixture.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::ConfigFor;
using phone_test::Contains;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::StartEngine;
using phone_test::ValidPushData;

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

TEST_CASE("SipEngine uses no STUN when the profile leaves stun empty") {
    RecordingListener listener;
    INFO(listener.LogTail());
    const Profile profile = LoadProfile();
    REQUIRE(profile.global.stun.empty());   // como no branding/perfil.ini de hoje (stun= vazio)
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, profile);

    // Sem servidor o pjsua nao escreve nada de STUN ao iniciar; com um, logo diz "Trying STUN server".
    CHECK_FALSE(Contains(listener.LogTail(), "STUN"));
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

TEST_CASE("SetPushData refuses data that would break the REGISTER and accepts nullopt") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // Sem conta o motor só confere (ou guarda) os dados: nada é registrado.
    PushData broken;
    broken.contactParams = {{"pn-prid", "a;b"}};
    CHECK_FALSE(engine->SetPushData(broken));
    CHECK(engine->SetPushData(ValidPushData()));
    CHECK(engine->SetPushData(std::nullopt));
    CHECK(listener.Registrations().empty());
}
