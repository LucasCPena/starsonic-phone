// Só o motor do baresip: o que depende das linhas de log do baresip ou do que esse motor faz de diferente do do PJSIP
// (os dispositivos de som e o BLF, spec 6.1). O motor do PJSIP tem os testes dele (test_engine_pjsip.cpp).
#include "engine_fixture.h"

#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "SipEngine.h"

using namespace starsonic;
using phone_test::Contains;
using phone_test::LoadProfile;
using phone_test::RecordingListener;
using phone_test::StartEngine;

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
