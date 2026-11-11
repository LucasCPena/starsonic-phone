// O que o executavel novo le do estado da ponte (windows/app/src/ShellState.h: o aviso, a bandeja e, 0.3.0, as
// ligacoes da rota do video) e as permissoes
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

TEST_CASE("the tray follows the rc.3 dot table: no internet, connecting and errors come before the call and Nao perturbe") {
    // Sem internet (conta.internet false) com a conta conectada, o Nao perturbe e uma ligacao: o de sem conexao.
    std::optional<ShellStatus> s = ReadShellStatus(State(
        R"("conta":{"status":"conectado","servidor":"127.0.0.1","internet":false},"naoPerturbe":true,"perdidas":0,)"
        R"("ligacao":{"top":{"id":4,"phase":"active"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->internet);
    CHECK(s->inCall);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":false},"naoPerturbe":true,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":false},"naoPerturbe":false,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);

    // Conectando, erro e sem_conexao (com a internet): o de sem conexao, tambem com o Nao perturbe ligado e com uma
    // ligacao (a bolinha nao fica vermelha).
    for (const char* account : {"conectando", "erro", "sem_conexao"}) {
        s = ReadShellStatus(State(std::string(R"("conta":{"status":")") + account +
                                  R"(","internet":true},"naoPerturbe":true,"perdidas":0,"ligacao":null)"));
        REQUIRE(s.has_value());
        CHECK_MESSAGE(ChooseTrayIcon(*s) == TrayIcon::Offline, account);
        s = ReadShellStatus(State(std::string(R"("conta":{"status":")") + account +
                                  R"(","internet":true},"naoPerturbe":false,"perdidas":0,)"
                                  R"("ligacao":{"top":{"id":4,"phase":"active"},"second":null,"secondKind":"none","conference":false})"));
        REQUIRE(s.has_value());
        CHECK_MESSAGE(ChooseTrayIcon(*s) == TrayIcon::Offline, account);
    }

    // Conectado com a internet: a ligacao (vermelho), depois o Nao perturbe (o vermelho dele), depois o verde.
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":true},"naoPerturbe":true,"perdidas":0,)"
                              R"("ligacao":{"top":{"id":4,"phase":"active"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->internet);
    CHECK(ChooseTrayIcon(*s) == TrayIcon::InCall);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":true},"naoPerturbe":true,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::DoNotDisturb);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":true},"naoPerturbe":false,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Connected);

    // A perdida fica onde estava na rc.2, entre a ligacao e o Nao perturbe: sem internet (e sem conexao), o de sem
    // conexao vem antes dela.
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":true},"naoPerturbe":true,"perdidas":3,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Missed);
    s = ReadShellStatus(State(R"("conta":{"status":"conectado","internet":false},"naoPerturbe":true,"perdidas":3,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
    s = ReadShellStatus(State(R"("conta":{"status":"sem_conexao"},"naoPerturbe":false,"perdidas":3,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(ChooseTrayIcon(*s) == TrayIcon::Offline);
}

TEST_CASE("the shell reads the account server and whether the admin shows the Nao perturbe item") {
    std::optional<ShellStatus> s = ReadShellStatus(State(
        R"("conta":{"status":"conectado","servidor":"starcloud1-starsonic.com.br","internet":true},"naoPerturbe":false,)"
        R"("perdidas":0,"ligacao":null,"admin":{"aberto":false,"naoPerturbe":false,"atenderAuto":true,"blf":false})"));
    REQUIRE(s.has_value());
    CHECK(s->server == "starcloud1-starsonic.com.br");
    CHECK_FALSE(s->doNotDisturbShown);
    s = ReadShellStatus(State(
        R"("conta":{"status":"conectado","servidor":"127.0.0.1"},"naoPerturbe":true,"perdidas":0,"ligacao":null,)"
        R"("admin":{"aberto":true,"naoPerturbe":true,"atenderAuto":false,"blf":true})"));
    REQUIRE(s.has_value());
    CHECK(s->server == "127.0.0.1");
    CHECK(s->doNotDisturbShown);
    // Sem conta: sem servidor (o monitor de rede nao testa o DNS). Sem o admin (um estado de antes da rc.3): o item
    // aparece, e a internet vale ate o executavel dizer o contrario.
    s = ReadShellStatus(State(R"("conta":null,"naoPerturbe":false,"perdidas":0,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(s->server.empty());
    CHECK(s->doNotDisturbShown);
    CHECK(s->internet);
}

TEST_CASE("the state gives the top call id and the ringing call id") {
    // A de cima tocando: as duas com o id dela.
    std::optional<ShellStatus> s = ReadShellStatus(State(std::string(kConnected) +
                                                         R"(,"ligacao":{"top":{"id":4,"phase":"ringing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->topCallId == 4);
    CHECK(s->ringingCallId == 4);
    // A de cima em andamento e a segunda tocando: o ringingCallId e o da segunda.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"active"},"second":{"id":5,"phase":"ringing"},"secondKind":"ringing","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->topCallId == 4);
    CHECK(s->ringingCallId == 5);
    // A segunda em espera, ou na conferencia: nenhuma tocando (a mesma regra do ringing).
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"active"},"second":{"id":5,"phase":"active"},"secondKind":"held","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->topCallId == 4);
    CHECK(s->ringingCallId == 0);
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"active"},"second":{"id":5,"phase":"active"},"secondKind":"ringing","conference":true})"));
    REQUIRE(s.has_value());
    CHECK(s->ringingCallId == 0);
    // Uma feita chamando, ainda sem o id do motor: 0.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":0,"phase":"dialing"},"second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->topCallId == 0);
    CHECK(s->ringingCallId == 0);
    // Sem ligacao: os dois 0.
    s = ReadShellStatus(State(std::string(kConnected) + R"(,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK(s->topCallId == 0);
    CHECK(s->ringingCallId == 0);
}

TEST_CASE("the state marks a doorphone ringing as the second call while its image arrives before the answer") {
    // A Ana (4) em andamento e a Portaria (5) tocando como a segunda, com o video dela.
    const std::string active = std::string(kConnected) + R"(,"ligacao":{"top":{"id":4,"phase":"active"},)";
    const std::string ringing = R"("secondKind":"ringing","conference":false)";
    auto second = [&](const std::string& video, const std::string& rest) {
        return ReadShellStatus(State(active + R"("second":{"id":5,"phase":"ringing")" + video + "}," + rest + "}"));
    };
    std::optional<ShellStatus> s = second(R"(,"video":{"oferece":true,"ativo":true,"imagem":true,"camera":false,)"
                                          R"("cedo":true,"porteiro":true})",
                                          ringing);
    REQUIRE(s.has_value());
    CHECK(s->ringing);
    CHECK(s->ringingCallId == 5);
    CHECK(s->doorphoneSecond);
    // Sem a imagem antes do atender (um porteiro sem ela, ou uma ligacao comum): nao.
    s = second(R"(,"video":{"oferece":true,"ativo":true,"imagem":true,"camera":false,"cedo":false,"porteiro":true})",
               ringing);
    REQUIRE(s.has_value());
    CHECK(s->ringing);
    CHECK_FALSE(s->doorphoneSecond);
    s = second(R"(,"video":{"oferece":false,"ativo":false,"imagem":false,"camera":false,)"
               R"("cedo":false,"porteiro":false})",
               ringing);
    REQUIRE(s.has_value());
    CHECK_FALSE(s->doorphoneSecond);
    // Na conferencia nada toca.
    s = second(R"(,"video":{"cedo":true,"porteiro":true})", R"("secondKind":"ringing","conference":true)");
    REQUIRE(s.has_value());
    CHECK_FALSE(s->ringing);
    CHECK_FALSE(s->doorphoneSecond);
    // O video, ou o cedo, que falta ou vem com outro tipo: false.
    for (const char* video : {"", R"(,"video":null)", R"(,"video":"cedo")", R"(,"video":{})",
                              R"(,"video":{"cedo":"true"})", R"(,"video":{"cedo":1})"}) {
        s = second(video, ringing);
        REQUIRE(s.has_value());
        CHECK(s->ringing);
        CHECK_MESSAGE(!s->doorphoneSecond, video);
    }

    // O porteiro tocando como a de cima (a tela da ligacao o mostra): nao e a segunda.
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"ringing","video":{"cedo":true,"porteiro":true}},)"
                              R"("second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK(s->ringing);
    CHECK_FALSE(s->doorphoneSecond);
    // O secondKind ringing sem o second (ou com ele de outro tipo), e sem ligacao: false.
    for (const char* rest : {R"("second":null,"secondKind":"ringing","conference":false)",
                             R"("secondKind":"ringing","conference":false)",
                             R"("second":"Portaria","secondKind":"ringing","conference":false)"}) {
        s = ReadShellStatus(State(active + rest + "}"));
        REQUIRE(s.has_value());
        CHECK_MESSAGE(!s->doorphoneSecond, rest);
    }
    s = ReadShellStatus(State(std::string(kConnected) + R"(,"ligacao":null)"));
    REQUIRE(s.has_value());
    CHECK_FALSE(s->doorphoneSecond);
}

TEST_CASE("the notice shows out of front, and in front only for a doorphone ringing as the second call") {
    // A tabela (tocando, janela na frente, porteiro como a segunda -> o aviso aparece).
    struct Row {
        bool ringing, inFront, doorphoneSecond, shows;
    };
    const Row rows[] = {
        {false, false, false, false}, {false, true, false, false}, {false, false, true, false},
        {false, true, true, false},   {true, false, false, true},  {true, true, false, false},
        {true, false, true, true},    {true, true, true, true},
    };
    for (const Row& row : rows) {
        ShellStatus status;
        status.ringing = row.ringing;
        status.doorphoneSecond = row.doorphoneSecond;
        CHECK_MESSAGE(ShowsNotice(status, row.inFront) == row.shows,
                      "ringing " << row.ringing << ", in front " << row.inFront << ", doorphone second "
                                 << row.doorphoneSecond);
    }

    // Do estado ao aviso, com a janela na frente: o porteiro tocando como a segunda, com a imagem, aparece; a segunda
    // comum, e o porteiro tocando como a de cima, nao (a tela da ligacao ja mostra os dois).
    const std::string active = std::string(kConnected) + R"(,"ligacao":{"top":{"id":4,"phase":"active"},)";
    auto second = [&](const std::string& video) {
        return ReadShellStatus(State(active + R"("second":{"id":5,"phase":"ringing","video":)" + video + "}," +
                                     R"("secondKind":"ringing","conference":false})"));
    };
    std::optional<ShellStatus> s = second(R"({"cedo":true,"porteiro":true})");
    REQUIRE(s.has_value());
    CHECK(ShowsNotice(*s, true));
    s = second(R"({"cedo":false,"porteiro":false})");
    REQUIRE(s.has_value());
    CHECK_FALSE(ShowsNotice(*s, true));
    CHECK(ShowsNotice(*s, false));
    s = ReadShellStatus(State(std::string(kConnected) +
                              R"(,"ligacao":{"top":{"id":4,"phase":"ringing","video":{"cedo":true,"porteiro":true}},)"
                              R"("second":null,"secondKind":"none","conference":false})"));
    REQUIRE(s.has_value());
    CHECK_FALSE(ShowsNotice(*s, true));
    CHECK(ShowsNotice(*s, false));
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
