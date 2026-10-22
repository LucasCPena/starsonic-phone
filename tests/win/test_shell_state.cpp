// O que o executavel novo le do estado da ponte (windows/app/src/ShellState.h: o aviso e a bandeja) e as permissoes
// do WebView2 (WebPermissions.h: o toque nunca fica mudo por uma permissao de reproducao automatica negada).
// Entra no desktop_tests do job windows.
#include <optional>
#include <string>

#include "ShellState.h"
#include "WebPermissions.h"
#include "test_support.h"

using namespace starsonic;

namespace {

std::string State(const std::string& fields) { return R"({"v":1,"type":"state","state":{)" + fields + "}}"; }

const char kConnected[] = R"("conta":{"id":"a","status":"conectado","texto":"Conectado"},"naoPerturbe":false,"perdidas":0)";

}  // namespace

TEST_CASE("the shell reads the ringing call, the connection, do not disturb and the missed calls") {
    std::optional<ShellStatus> s = ReadShellStatus(State(std::string(kConnected) + R"(,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->ringing);
    CHECK(s->connected);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Connected);

    // Uma recebida tocando (a de cima).
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"ringing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->ringing);
    // A segunda tocando, com a de cima em andamento.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"active"},"second":{"id":5,"phase":"ringing"},"secondKind":"ringing","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->ringing);
    // Em andamento, sem nada tocando; e uma feita chamando.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"active"},"second":{"id":5,"phase":"active"},"secondKind":"held","conference":false})"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->ringing);
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":0,"phase":"dialing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->ringing);

    // Sem conexao, sem conta, Nao perturbe e perdidas.
    s = ReadShellStatus(State(R"("conta":{"status":"sem_conexao"},"naoPerturbe":false,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
    s = ReadShellStatus(State(R"("conta":null,"naoPerturbe":false,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado"},"naoPerturbe":true,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(s->doNotDisturb);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::DoNotDisturb);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado"},"naoPerturbe":true,"perdidas":2,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(s->missed == 2);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Missed);
}

TEST_CASE("a call on the connected account shows the in-call tray icon (red dot), ringing included") {
    // Uma ligacao em andamento: "em ligacao", acima do Nao perturbe e da perdida (a bandeja segue a bolinha da
    // interface: vermelho enquanto existe uma ligacao).
    std::optional<ShellStatus> s = ReadShellStatus(State(
        R"("conta":{"status":"conectado"},"naoPerturbe":true,"perdidas":2,)"
        R"("ligacao":{"top":{"id":4,"phase":"active"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->inCall);
    CHECK_FALSE(s->ringing);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::InCall);
    // Tocando tambem e "em ligacao" (a bandeja pisca entre ele e o de tocando).
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"ringing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->inCall);
    CHECK(s->ringing);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::InCall);
    // Uma feita chamando.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":0,"phase":"dialing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::InCall);
    // Sem ligacao: conectado de novo.
    s = ReadShellStatus(State(std::string(kConnected) + R"(,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->inCall);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Connected);
    // A ligacao com a conta sem conexao (o registro caiu no meio): a bandeja segue a conexao.
    s = ReadShellStatus(State(R"("conta":{"status":"sem_conexao"},"naoPerturbe":false,"perdidas":0,)"
                              R"("ligacao":{"top":{"id":4,"phase":"active"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->inCall);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
}

TEST_CASE("the shell ignores the other messages and invalid text") {
    CHECK_FALSE(ReadShellStatus(R"({"v":1,"type":"toast","texto":"state"})").has_value());
    CHECK_FALSE(ReadShellStatus(R"({"v":1,"type":"ring","tipo":"completo"})").has_value());
    CHECK_FALSE(ReadShellStatus(R"({"v":1,"type":"update","versao":"0.1.0","notas":""})").has_value());
    CHECK_FALSE(ReadShellStatus("nao e json \"state\"").has_value());
    CHECK(IsCommand(R"({"v":1,"cmd":"answer"})", "answer"));
    CHECK_FALSE(IsCommand(R"({"v":1,"cmd":"reject"})", "answer"));
    CHECK_FALSE(IsCommand(R"({"v":1,"cmd":"dial","numero":"answer"})", "answer"));
    CHECK_FALSE(IsCommand("answer", "answer"));
}

TEST_CASE("only the microphone and the autoplay of the app origin are allowed") {
    CHECK(AllowWebPermission(WebPermission::Microphone, "https://app.starsonic.local/index.html"));
    CHECK(AllowWebPermission(WebPermission::Autoplay, "https://app.starsonic.local/index.html"));
    CHECK(AllowWebPermission(WebPermission::Autoplay, "https://app.starsonic.local/aviso.html"));
    CHECK_FALSE(AllowWebPermission(WebPermission::Other, "https://app.starsonic.local/index.html"));
    CHECK_FALSE(AllowWebPermission(WebPermission::Autoplay, "https://app.starsonic.local.outro.com/index.html"));
    CHECK_FALSE(AllowWebPermission(WebPermission::Microphone, "https://starsonic.com.br/"));
    CHECK_FALSE(AllowWebPermission(WebPermission::Autoplay, ""));
}
