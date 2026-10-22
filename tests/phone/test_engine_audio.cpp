#include "engine_fixture.h"

#include <memory>
#include <string>
#include <vector>

#include "AudioDeviceName.h"
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

TEST_CASE("DeviceNameToUtf8 keeps ASCII names and, outside Windows, every byte") {
    CHECK(DeviceNameToUtf8("") == "");
    CHECK(DeviceNameToUtf8("Microfone (USB Audio)") == "Microfone (USB Audio)");
#ifndef _WIN32
    // Fora do Windows o PJSIP ja devolve UTF-8: "Alto-falantes (Realtek) \xC3\x81udio" passa sem mudar.
    const std::string utf8 = std::string("Alto-falantes (Realtek) ") + "\xC3\x81" + "udio";
    CHECK(DeviceNameToUtf8(utf8) == utf8);
#endif
}

TEST_CASE("RefreshAudioDevices rereads the devices and a call still completes after it") {
    FakeRegistrar registrar("senha");
    RecordingListener listener;
    INFO(listener.LogTail());
    INFO(registrar.LogText());
    std::unique_ptr<SipEngine> engine = StartEngine(&listener, LoadProfile(registrar.port()));
    REQUIRE(engine->SetAccount(Input(Transport::Udp)));
    REQUIRE(listener.WaitFor(RecordingListener::Reached(200, true, 1), kWaitSeconds));

    const std::vector<AudioDevice> before = engine->AudioDevices();
    engine->RefreshAudioDevices();
    CHECK(listener.LogTail().find("dispositivos de som relidos") != std::string::npos);
    const std::vector<AudioDevice> after = engine->AudioDevices();
    REQUIRE(after.size() == before.size());   // nada mudou no sistema: a mesma lista
    for (size_t i = 0; i < after.size(); ++i) CHECK(after[i].name == before[i].name);
    CHECK(engine->SetAudioDevices(-1, -1));

    // Uma ligacao recebida e atendida depois de reler, e reler de novo com ela em andamento.
    REQUIRE(registrar.Control("RING 2001") == std::vector<std::string>{"OK"});
    REQUIRE(listener.WaitForCalls(RecordingListener::Count(CallEvent::Incoming, 1), kWaitSeconds));
    int callId = -1;
    for (const CallEvent& event : listener.Calls()) {
        if (event.kind == CallEvent::Incoming) callId = event.callId;
    }
    REQUIRE(callId >= 0);
    REQUIRE(engine->Answer(callId));
    REQUIRE(listener.WaitForCalls(RecordingListener::StateReached(callId, CallState::Confirmed), kWaitSeconds));
    engine->RefreshAudioDevices();
    CHECK(engine->Hangup(callId));
    CHECK(listener.WaitForCalls(RecordingListener::StateReached(callId, CallState::Disconnected), kWaitSeconds));
}
