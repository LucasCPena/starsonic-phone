// A sala de vídeo em grupo no motor do PJSIP, contra o registrador falso que faz de vários convidados: cada um com a
// imagem dele (VIDEO SOURCE), as contagens por convidado, o 180, o BYE e a espera. Só com o vídeo (PJMEDIA_HAS_VIDEO).
#include <pjmedia/config.h>

#if PJMEDIA_HAS_VIDEO

#include "call_fixture.h"

#include "SipEngine.h"

using namespace starsonic;
using phone_test::kWaitSeconds;
using phone_test::Phone;
using phone_test::TestSink;

TEST_CASE("the registrar's color source arrives as a solid image") {
    TestSink sink;
    Phone phone;
    INFO(sink.Text());
    INFO(phone.registrar.LogText());
    INFO(phone.listener.LogTail());
    phone.engine->SetFrameSink(&sink);

    phone.registrar.VideoSource("2003", "color 150 44 200");
    const int id = phone.engine->MakeCall("2003", true);
    REQUIRE(id > 0);
    REQUIRE(phone.WaitState(id, CallState::Confirmed));

    CHECK(sink.WaitFor(id, 3, 5, 64, 48));   // a imagem do registrador, de 64x48
    CHECK(sink.WaitForColor(id, 0.5, 0.5, {150, 44, 200}, 2, 5));
    CHECK(phone.registrar.WaitForPacketsOf("2003", 1, 5));   // e a nossa câmera chega a ele
    phone.engine->SetFrameSink(nullptr);
}

#endif  // PJMEDIA_HAS_VIDEO
