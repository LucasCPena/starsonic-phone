// Só o motor do PJSIP: o que depende das linhas de log do PJSIP, do pjsua direto ou de o PJSIP não usar os
// dados de push. O motor do baresip tem os testes dele.
#include "engine_fixture.h"
#include "stun_fixture.h"

#include <pjsua-lib/pjsua.h>

#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"
#include "Text.h"

using namespace starsonic;
using phone_test::Contains;
using phone_test::FakeRegistrar;
using phone_test::FakeStunServer;
using phone_test::Input;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::Registers;
using phone_test::StartEngine;
using phone_test::ValidPushData;

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

TEST_CASE("SipEngine sends the start-up lines of the PJSIP to OnLog") {
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile());

    // Escrita pelo libCreate, antes de o writer do pjsua2 existir: sem o desvio iria para o terminal.
    CHECK(Contains(listener.LogTail(), "for POSIX initialized"));
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

TEST_CASE("the PJSIP engine checks push data and sends nothing") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    listener.CountLog("push: dados recusados: ");
    listener.CountLog("push: o motor do PJSIP nao usa os dados de push");
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    PushData broken;
    broken.contactParams = {{"pn-prid", "a;b"}};
    CHECK_FALSE(engine->SetPushData(broken));
    CHECK(listener.LogCount("push: dados recusados: ") == 1);
    CHECK(engine->SetPushData(ValidPushData()));
    CHECK(listener.LogCount("push: o motor do PJSIP nao usa os dados de push") == 1);

    // O PJSIP nao usa os dados: nenhum REGISTER novo, e o que ja foi registrado nao leva nada de push.
    std::this_thread::sleep_for(std::chrono::seconds(1));
    CHECK(listener.Registrations().size() == 1);
    CHECK(Registers(registrar) == 1);
    const std::vector<std::string> contact = registrar.Control("CONTACT 2001");
    REQUIRE(contact.size() == 1);
    CHECK(Contains(contact[0], "sip:"));
    CHECK_FALSE(Contains(contact[0], "pn-"));
    const std::vector<std::string> noHeader = {"ERR no-header"};
    CHECK(registrar.Control("HEADER 2001 X-Push-Token") == noHeader);
}
