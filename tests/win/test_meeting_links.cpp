// O endereco de uma reuniao para o navegador padrao (windows/app/src/MeetingLinks.h): a origem do chat, o codigo e o
// passe depois do "#". C++ portatil: entra no desktop_tests do Linux e do Windows.
#include <string>

#include "ChatFiles.h"
#include "MeetingLinks.h"
#include "WebPermissions.h"
#include "test_support.h"

using namespace starsonic;

namespace {

const std::string kPass = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";   // 43 caracteres

}  // namespace

TEST_CASE("the browser address of a meeting is the chat origin, the code and the pass after the #") {
    REQUIRE(kPass.size() == 43);
    CHECK(MeetingBrowserUrl("k7q49xwpht", "") == std::string(kChatOrigin) + "/r/k7q49xwpht");
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass) == std::string(kChatOrigin) + "/r/k7q49xwpht#p=" + kPass);
    // O mesmo endereco que o quadro do app aceita.
    CHECK(IsMeetingUrl(MeetingBrowserUrl("k7q49xwpht", "")));
}

TEST_CASE("a meeting code or pass out of format opens nothing") {
    for (const char* code :
         {"K7Q49XWPHT", "k7q49xwph", "k7q49xwpht/x", "k7q49xwpht#p=x", "", "k7q49xwpht1", "k7q49xwphl"}) {
        CHECK_MESSAGE(MeetingBrowserUrl(code, "") == "", "code " << code);
        CHECK_MESSAGE(MeetingBrowserUrl(code, kPass) == "", "code " << code);
    }
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass.substr(1)) == "");              // 42 caracteres
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass + "a") == "");                  // 44 caracteres
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass.substr(0, 42) + "&") == "");
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass.substr(0, 42) + "=") == "");
    CHECK(MeetingBrowserUrl("k7q49xwpht", kPass.substr(0, 42) + "#") == "");
    CHECK(MeetingBrowserUrl("k7q49xwpht", std::string(kPass.substr(0, 42)) + '\0') == "");
}
