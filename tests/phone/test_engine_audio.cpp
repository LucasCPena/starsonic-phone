#include "engine_fixture.h"

#include <memory>
#include <string>
#include <vector>

#include "Profile.h"
#include "SipEngine.h"

using namespace starsonic;
using phone_test::CallEvent;
using phone_test::FakeRegistrar;
using phone_test::Input;
using phone_test::kWaitSeconds;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::StartEngine;

TEST_CASE("AudioDevices lists at least one device") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));

    const std::vector<AudioDevice> devices = engine->AudioDevices();
    REQUIRE_FALSE(devices.empty());
    for (const AudioDevice& device : devices) {
        CHECK_FALSE(device.name.empty());
        CHECK((device.capture || device.playback));
    }
}

TEST_CASE("SetAudioDevices accepts the defaults and refuses an unknown device") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    CHECK(engine->SetAudioDevices(-1, -1));
    CHECK_FALSE(engine->SetAudioDevices(9999, 9999));

    // Depois da recusa o motor segue no dispositivo padrao e a ligacao completa.
    REQUIRE(registrar.Control("RING 2001") == std::vector<std::string>{"OK"});
    REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, 1), kWaitSeconds));
    int callId = -1;
    for (const CallEvent& event : listener.Calls()) {
        if (event.kind == CallEvent::Incoming) callId = event.callId;
    }
    REQUIRE(callId >= 0);
    REQUIRE(engine->Answer(callId));
    CHECK(listener.WaitForCalls(RecordingListener::StateReached(callId, CallState::Confirmed), kWaitSeconds));
}
