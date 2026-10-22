// O refazer do WebView2 quando o navegador sai (windows/app/src/BrowserRestarts.h): C++ portatil, testado no Linux e
// no job windows. Um navegador que sai antes da interface mandar o ready nao pode refazer para sempre.
#include "BrowserRestarts.h"
#include "test_support.h"

using starsonic::BrowserRestarts;

TEST_CASE("a browser that exits again before ready gives up after 3 restarts in a row") {
    BrowserRestarts restarts;
    CHECK(restarts.OnBrowserExited());
    CHECK(restarts.OnBrowserExited());
    CHECK(restarts.OnBrowserExited());
    CHECK_FALSE(restarts.OnBrowserExited());   // a quarta seguida, sem nenhum ready: a mensagem do WebView2
    CHECK_FALSE(restarts.OnBrowserExited());
}

TEST_CASE("a ready resets the restarts") {
    BrowserRestarts restarts;
    for (int round = 0; round < 5; ++round) {
        CHECK(restarts.OnBrowserExited());
        CHECK(restarts.OnBrowserExited());
        restarts.OnReady();
    }
    CHECK(restarts.OnBrowserExited());
    CHECK(restarts.OnBrowserExited());
    CHECK(restarts.OnBrowserExited());
    CHECK_FALSE(restarts.OnBrowserExited());
}

TEST_CASE("an environment that does not open during a restart is tried again a few times") {
    BrowserRestarts restarts;
    CHECK_FALSE(restarts.Restarting());
    CHECK_FALSE(restarts.OnCreateFailed());   // fora de um refazer: a falha vale (a mensagem do WebView2)
    CHECK(restarts.OnBrowserExited());
    CHECK(restarts.Restarting());
    for (int i = 0; i < BrowserRestarts::kMaxCreateFailures; ++i) CHECK(restarts.OnCreateFailed());
    CHECK_FALSE(restarts.OnCreateFailed());
    restarts.OnReady();
    CHECK_FALSE(restarts.Restarting());
}
