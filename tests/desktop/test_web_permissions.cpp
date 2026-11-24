// As regras do quadro da reuniao no executavel do Windows (windows/app/src/WebPermissions.h, spec 7.7): o endereco de
// uma reuniao, a navegacao de um quadro, a camera, o microfone e a reproducao automatica de um quadro, e a captura de
// tela. C++ portatil: roda tambem no Linux.
#include <string>

#include "WebPermissions.h"
#include "test_support.h"

using namespace starsonic;

namespace {
const std::string kChat = "https://chat.starcloud-starsonic.com.br:8443";
const std::string kMeeting = kChat + "/r/k7q49xwpht";
const std::string kApp = "https://app.starsonic.local/index.html";
}  // namespace

TEST_CASE("the meeting address is the chat origin, /r/ and a ten-character code, and nothing else") {
    CHECK(IsMeetingUrl(kMeeting));
    CHECK(IsMeetingUrl(kChat + "/r/abcdefghjk"));
    CHECK(IsMeetingUrl(kChat + "/r/mnpqrstvwx"));
    CHECK(IsMeetingUrl(kChat + "/r/yz23456789"));
    for (const char* bad : {"/r/k7q49xwph", "/r/k7q49xwphtt", "/r/K7Q49XWPHT", "/r/k7q49xwphi", "/r/k7q49xwphl",
                            "/r/k7q49xwpho", "/r/k7q49xwphu", "/r/k7q49xwph0", "/r/k7q49xwph1", "/r/k7q49xwph-",
                            "/r/k7q49xwpht/", "/r/k7q49xwpht?x=1", "/r/k7q49xwpht#p=abc", "/r/k7q49xwpht ",
                            "/r/", "/r", "/", "", "/admin/entrar", "/api/v1/r/k7q49xwpht", "//r/k7q49xwpht",
                            "/R/k7q49xwpht"}) {
        CAPTURE(bad);
        CHECK_FALSE(IsMeetingUrl(kChat + bad));
    }
    CHECK_FALSE(IsMeetingUrl("http://chat.starcloud-starsonic.com.br:8443/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br:84430/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://chat.starcloud-starsonic.com.br:8443.outro.com/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://outro.com/https://chat.starcloud-starsonic.com.br:8443/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl("https://app.starsonic.local/r/k7q49xwpht"));
    CHECK_FALSE(IsMeetingUrl(" " + kMeeting));
}

TEST_CASE("a frame navigates only inside the app, or to a meeting in the main window") {
    CHECK(AllowFrameNavigation(WebWindow::Main, kApp));
    CHECK(AllowFrameNavigation(WebWindow::Notice, "https://app.starsonic.local/aviso.html"));
    CHECK(AllowFrameNavigation(WebWindow::Main, kMeeting));
    CHECK_FALSE(AllowFrameNavigation(WebWindow::Notice, kMeeting));
    for (const std::string& bad : {kChat + "/", kChat + "/admin/entrar", kMeeting + "?x=1", kMeeting + "/",
                                   std::string("https://exemplo.com.br/"), std::string("about:blank"),
                                   std::string("about:srcdoc"), std::string("data:text/html,x"),
                                   std::string("blob:https://app.starsonic.local/0b6f6c1e"), std::string("")}) {
        CAPTURE(bad);
        CHECK_FALSE(AllowFrameNavigation(WebWindow::Main, bad));
    }
}

TEST_CASE("only a meeting frame of the main window gets the camera, the microphone and the autoplay") {
    for (WebPermission kind : {WebPermission::Camera, WebPermission::Microphone, WebPermission::Autoplay}) {
        CHECK(AllowFramePermission(WebWindow::Main, kind, kMeeting));
        CHECK_FALSE(AllowFramePermission(WebWindow::Notice, kind, kMeeting));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, ""));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kApp));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kChat + "/admin/entrar"));
        CHECK_FALSE(AllowFramePermission(WebWindow::Main, kind, kMeeting + "?x=1"));
    }
    CHECK_FALSE(AllowFramePermission(WebWindow::Main, WebPermission::Other, kMeeting));
}

TEST_CASE("only a meeting frame of the main window captures the screen") {
    CHECK(AllowFrameScreenCapture(WebWindow::Main, kMeeting));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Notice, kMeeting));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, kApp));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, kChat + "/admin/entrar"));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, ""));
}

TEST_CASE("the app origin never gets the camera") {
    CHECK_FALSE(AllowWebPermission(WebPermission::Camera, kApp));
    CHECK(AllowWebPermission(WebPermission::Microphone, kApp));
    CHECK(AllowWebPermission(WebPermission::Autoplay, kApp));
}
