// As regras do quadro da reuniao no executavel do Windows (windows/app/src/WebPermissions.h, spec 7.7): o endereco de
// uma reuniao, a navegacao de um quadro, a camera, o microfone e a reproducao automatica de um quadro, e a captura de
// tela; (0.5.0) e o endereco do documento que um quadro mostra (FrameAddress). C++ portatil: roda tambem no Linux.
#include <string>

#include "WebPermissions.h"
#include "test_support.h"

using namespace starsonic;

namespace {
const std::string kChat = "https://chat.starcloud-starsonic.com.br:8443";
const std::string kMeeting = kChat + "/r/k7q49xwpht";
const std::string kApp = "https://app.starsonic.local/index.html";
const std::string kOther = kChat + "/admin/entrar";

// Um quadro que ja mostra a reuniao (a navegacao 1, carregada e acabada).
FrameAddress ShowingMeeting() {
    FrameAddress frame;
    frame.Start(1, kMeeting);
    frame.Commit(1, false);
    frame.End(1, true);
    return frame;
}
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
    // Dois bytes fora do alfabeto que o texto dele nao mostra: o NUL (o terminador do texto) e um fora do ASCII.
    CHECK_FALSE(IsMeetingUrl(kChat + std::string("/r/k7q49\0xwph", 13)));
    CHECK_FALSE(IsMeetingUrl(kChat + std::string("/r/k7q49\xe9xwph", 13)));
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

TEST_CASE("a frame shows nothing before a document loads") {
    FrameAddress frame;
    CHECK(frame.Shown() == "");
    frame.Start(1, kMeeting);
    CHECK(frame.Shown() == "");
}

TEST_CASE("the document of a navigation is shown when its content loads") {
    FrameAddress frame;
    frame.Start(1, kMeeting);
    frame.Commit(1, false);
    CHECK(frame.Shown() == kMeeting);
    frame.End(1, true);
    CHECK(frame.Shown() == kMeeting);
}

TEST_CASE("a navigation that starts and never loads changes nothing") {
    FrameAddress frame = ShowingMeeting();
    REQUIRE(frame.Shown() == kMeeting);
    frame.Start(2, kOther);
    CHECK(frame.Shown() == kMeeting);
    frame.End(2, false);
    CHECK(frame.Shown() == kMeeting);
}

TEST_CASE("a frame that leaves the meeting stops being a meeting frame") {
    FrameAddress frame = ShowingMeeting();
    REQUIRE(frame.Shown() == kMeeting);
    frame.Start(2, kOther);
    frame.Commit(2, false);
    CHECK(frame.Shown() == kOther);
    CHECK_FALSE(AllowFramePermission(WebWindow::Main, WebPermission::Camera, frame.Shown()));
    CHECK_FALSE(AllowFrameScreenCapture(WebWindow::Main, frame.Shown()));
}

TEST_CASE("a redirect counts by its last address") {
    FrameAddress frame;
    frame.Start(3, kOther);
    frame.Start(3, kMeeting);
    frame.Commit(3, false);
    CHECK(frame.Shown() == kMeeting);
}

TEST_CASE("an error page and an unknown navigation show nothing") {
    FrameAddress frame;
    frame.Start(4, kMeeting);
    frame.Commit(4, true);
    CHECK(frame.Shown() == "");
    FrameAddress other;
    other.Commit(9, false);
    CHECK(other.Shown() == "");
}

TEST_CASE("a navigation that ends well without the content event shows nothing") {
    FrameAddress frame;
    frame.Start(5, kMeeting);
    frame.End(5, true);
    CHECK(frame.Shown() == "");
}

TEST_CASE("an older navigation that ends after another loaded does not bring its address back") {
    FrameAddress frame;
    frame.Start(1, kMeeting);
    frame.Start(2, kOther);
    frame.Commit(2, false);
    frame.End(1, true);
    CHECK(frame.Shown() != kMeeting);
}

TEST_CASE("a navigation inside the same document changes nothing") {
    FrameAddress frame = ShowingMeeting();
    REQUIRE(frame.Shown() == kMeeting);
    frame.Start(6, kMeeting + "#a");
    frame.End(6, true);
    CHECK(frame.Shown() == kMeeting);
}

TEST_CASE("an unknown navigation over a shown meeting shows nothing") {
    FrameAddress frame = ShowingMeeting();
    REQUIRE(frame.Shown() == kMeeting);
    frame.Commit(9, false);
    CHECK(frame.Shown() == "");
}
