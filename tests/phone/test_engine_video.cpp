// Só o motor do PJSIP com o vídeo (o do Linux dos testes, como o do Windows): os codecs de vídeo que o build oferece.
// O motor do baresip não tem vídeo, e o PJSIP do Android segue sem ele.
#include "call_fixture.h"

#include <algorithm>
#include <string>
#include <vector>

#include "SipEngine.h"

using phone_test::Phone;

TEST_CASE("the video build offers H264 and VP8") {
    Phone phone;
    INFO(phone.listener.LogTail());

    const std::vector<std::string> codecs = phone.engine->VideoCodecs();
    auto has = [&](const std::string& prefix) {
        return std::any_of(codecs.begin(), codecs.end(), [&](const std::string& id) { return id.rfind(prefix, 0) == 0; });
    };
    CHECK(has("H264/"));
    CHECK(has("VP8/"));
}
