// Testes das reunioes no nucleo (starsonic/desktop/Reunioes.h, Protocol.h e DesktopApp.h; docs/ponte-windows.md, a
// etapa 2): as conferencias do codigo, do passe e do id de um pedido; o reuniaoNavegador que vai ao gancho
// openMeeting; o pedido que o aviso mostra, so na memoria, no estado; a resposta do aviso; o reuniaoMostrar; e a regra
// de nada da reuniao no diagnostico. Todos os valores sao inventados.
#include <string>
#include <vector>

#include "Reunioes.h"
#include "desktop_fixture.h"

using namespace starsonic;
using nlohmann::json;

namespace {

const char* const kCode = "k7q49xwpht";
const char* const kPass = "Passe_de-teste-inventado-0123456789-ABCDxyz";
const char* const kId = "8899aabbccddeeff";
const char* const kOtherId = "0011223344556677";
const char* const kName = "Maria Lima";
const char* const kSubject = "Planejamento de dezembro";

std::string BrowserCommand(const std::string& code, const std::string& pass) {
    json message = {{"v", 1}, {"cmd", "reuniaoNavegador"}, {"codigo", code}};
    if (!pass.empty()) message["passe"] = pass;
    return message.dump();
}
std::string RequestCommand(const std::string& id, const std::string& name, const json& subject, bool hidden = true) {
    return json({{"v", 1},
                 {"cmd", "reuniaoPedido"},
                 {"pedido", {{"id", id}, {"nome", name}, {"assunto", subject}}},
                 {"escondida", hidden}})
        .dump();
}
std::string AnswerCommand(const std::string& id, const std::string& answer) {
    return json({{"v", 1}, {"cmd", "reuniaoResposta"}, {"pedido", id}, {"resposta", answer}}).dump();
}
const char* const kNoRequest = R"({"v":1,"cmd":"reuniaoPedido"})";
const char* const kShow = R"({"v":1,"cmd":"reuniaoMostrar"})";
const char* const kReady = R"({"v":1,"cmd":"ready"})";

// As chamadas do openMeeting, na ordem.
std::vector<std::string> MeetingHooks(const Harness& h) {
    std::vector<std::string> out;
    for (const std::string& call : h.host) {
        if (call.compare(0, 11, "openMeeting") == 0) out.push_back(call);
    }
    return out;
}

}  // namespace

TEST_CASE("the meeting formats are checked") {
    // O codigo: 10 de "abcdefghjkmnpqrstvwxyz23456789".
    CHECK(ValidMeetingCode(kCode));
    CHECK(ValidMeetingCode("abcdefghjk"));
    CHECK(ValidMeetingCode("mnpqrstvwx"));
    CHECK(ValidMeetingCode("yz23456789"));
    CHECK_FALSE(ValidMeetingCode(""));
    CHECK_FALSE(ValidMeetingCode("k7q49xwph"));
    CHECK_FALSE(ValidMeetingCode("k7q49xwpht2"));
    CHECK_FALSE(ValidMeetingCode("K7Q49XWPHT"));
    for (const char ch : std::string("ilou01-_ +")) {
        INFO(ch);
        CHECK_FALSE(ValidMeetingCode(std::string("k7q49xwph") + ch));
    }
    // O passe: 43 de [A-Za-z0-9_-].
    CHECK(ValidMeetingPass(kPass));
    CHECK(ValidMeetingPass(std::string(43, '-')));
    CHECK(ValidMeetingPass(std::string(43, '_')));
    CHECK_FALSE(ValidMeetingPass(""));
    CHECK_FALSE(ValidMeetingPass(std::string(kPass).substr(0, 42)));
    CHECK_FALSE(ValidMeetingPass(std::string(kPass) + "a"));
    CHECK_FALSE(ValidMeetingPass(std::string(kPass).substr(0, 42) + "+"));
    CHECK_FALSE(ValidMeetingPass(std::string(kPass).substr(0, 42) + "/"));
    CHECK_FALSE(ValidMeetingPass(std::string(kPass).substr(0, 42) + "="));
    // O id de um pedido: 16 de [0-9a-f].
    CHECK(ValidMeetingRequestId(kId));
    CHECK(ValidMeetingRequestId("0123456789abcdef"));
    CHECK_FALSE(ValidMeetingRequestId(""));
    CHECK_FALSE(ValidMeetingRequestId("8899aabbccddeef"));
    CHECK_FALSE(ValidMeetingRequestId("8899aabbccddeeff0"));
    CHECK_FALSE(ValidMeetingRequestId("8899AABBCCDDEEFF"));
    CHECK_FALSE(ValidMeetingRequestId("8899aabbccddeefg"));
}

TEST_CASE("reuniaoNavegador goes to the hook with the code and the pass") {
    Harness h;
    h.StartRegistered();
    h.Send(BrowserCommand(kCode, kPass));
    CHECK(MeetingHooks(h) == std::vector<std::string>{std::string("openMeeting ") + kCode + " " + kPass});
    CHECK(h.Logged("reunioes: reuniaoNavegador"));
    // Sem o passe: o gancho recebe o passe vazio.
    h.host.clear();
    h.Send(BrowserCommand(kCode, ""));
    CHECK(h.host == std::vector<std::string>{std::string("openMeeting ") + kCode + " "});
    // Nenhuma mensagem de reuniao para a interface, e nenhum estado novo com a reuniao.
    CHECK(h.Messages("reuniaoResposta").empty());
    CHECK_FALSE(h.State().contains("reuniao"));
}

TEST_CASE("the request goes to the state and leaves it") {
    Harness h;
    h.StartRegistered();
    CHECK_FALSE(h.State().contains("reuniao"));

    h.Send(RequestCommand(kId, kName, kSubject));
    CHECK(h.State()["reuniao"] ==
          json({{"pedido", {{"id", kId}, {"nome", kName}, {"assunto", kSubject}}}, {"escondida", true}}));
    CHECK(h.Logged("reunioes: reuniaoPedido"));

    // O mesmo pedido de novo: nenhum estado novo.
    const size_t states = h.Messages("state").size();
    h.Send(RequestCommand(kId, kName, kSubject));
    CHECK(h.Messages("state").size() == states);

    // Um pedido que muda (o assunto null, que o app nao sabe): o estado muda, e o null continua null.
    h.Send(RequestCommand(kOtherId, "Jos\xc3\xa9", nullptr));
    CHECK(h.Messages("state").size() == states + 1);
    CHECK(h.State()["reuniao"] ==
          json({{"pedido", {{"id", kOtherId}, {"nome", "Jos\xc3\xa9"}, {"assunto", nullptr}}}, {"escondida", true}}));
    // O assunto vazio (a reuniao sem assunto) vai vazio.
    h.Send(RequestCommand(kOtherId, "Jos\xc3\xa9", ""));
    CHECK(h.State()["reuniao"]["pedido"]["assunto"] == "");
    // O escondida vai como veio.
    h.Send(RequestCommand(kOtherId, "Jos\xc3\xa9", "", false));
    CHECK(h.State()["reuniao"]["escondida"] == false);

    // Sem o pedido: o estado seguinte nao tem a chave, e so uma vez.
    const size_t before = h.Messages("state").size();
    h.Send(kNoRequest);
    CHECK(h.Messages("state").size() == before + 1);
    CHECK_FALSE(h.State().contains("reuniao"));
    h.Send(kNoRequest);
    CHECK(h.Messages("state").size() == before + 1);
}

TEST_CASE("the answer of the notice reaches the interface only for the request on show") {
    Harness h;
    h.StartRegistered();
    h.Send(RequestCommand(kId, kName, kSubject));

    // Um pedido que nao e o do aviso: nada.
    h.logs.clear();
    h.SendFromNotice(AnswerCommand(kOtherId, "aceitar"));
    CHECK(h.Messages("reuniaoResposta").empty());
    CHECK(h.State().contains("reuniao"));
    CHECK(h.Logged("reunioes: reuniaoResposta ignorada (outro pedido)"));

    // O do aviso: uma mensagem, e o estado seguinte sem o pedido.
    h.logs.clear();
    h.SendFromNotice(AnswerCommand(kId, "aceitar"));
    const std::vector<json> answers = h.Messages("reuniaoResposta");
    REQUIRE(answers.size() == 1);
    CHECK(answers[0] == json({{"v", 1}, {"type", "reuniaoResposta"}, {"pedido", kId}, {"resposta", "aceitar"}}));
    CHECK_FALSE(h.State().contains("reuniao"));
    CHECK(h.Logged("reunioes: reuniaoResposta"));
    CHECK_FALSE(h.Logged("ignorada"));

    // A mesma resposta de novo, atrasada: nada, e a linha do outro pedido.
    h.logs.clear();
    h.SendFromNotice(AnswerCommand(kId, "aceitar"));
    CHECK(h.Messages("reuniaoResposta").size() == 1);
    CHECK(h.Logged("reunioes: reuniaoResposta ignorada (outro pedido)"));

    // As outras duas respostas (recusar e fechar) tambem vao, cada uma com o pedido que estava no aviso.
    for (const char* answer : {"recusar", "fechar"}) {
        INFO(answer);
        h.Send(RequestCommand(kOtherId, kName, kSubject));
        h.SendFromNotice(AnswerCommand(kOtherId, answer));
        CHECK(h.Messages("reuniaoResposta").back()["resposta"] == answer);
        CHECK(h.Messages("reuniaoResposta").back()["pedido"] == kOtherId);
        CHECK_FALSE(h.State().contains("reuniao"));
    }
}

TEST_CASE("reuniaoMostrar asks the interface for the Reunioes tab") {
    Harness h;
    h.StartRegistered();
    const size_t from = h.posts.size();
    h.logs.clear();
    h.SendFromNotice(kShow);
    REQUIRE(h.posts.size() == from + 1);
    CHECK(json::parse(h.posts[from]) == json({{"v", 1}, {"type", "abrir"}, {"tela", "reunioes"}}));
    CHECK(h.Logged("reunioes: reuniaoMostrar"));
    // Nenhum gancho: so a mensagem.
    CHECK(h.host.empty());
}

TEST_CASE("the request shows with Nao perturbe on") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    h.Send(RequestCommand(kId, kName, kSubject));
    CHECK(h.State()["reuniao"]["pedido"]["id"] == kId);
    h.SendFromNotice(AnswerCommand(kId, "recusar"));
    CHECK(h.Messages("reuniaoResposta").size() == 1);
}

TEST_CASE("the ready of the main page forgets the request, and the ready of the notice keeps it") {
    Harness h;
    h.StartRegistered();
    h.Send(RequestCommand(kId, kName, kSubject));
    h.SendFromNotice(kReady);
    CHECK(h.State().contains("reuniao"));
    CHECK(h.State()["reuniao"]["pedido"]["id"] == kId);
    h.Send(kReady);
    CHECK_FALSE(h.State().contains("reuniao"));
    // A resposta de um pedido que a interface recarregada nao conhece mais: ignorada.
    h.SendFromNotice(AnswerCommand(kId, "aceitar"));
    CHECK(h.Messages("reuniaoResposta").empty());
}

TEST_CASE("nothing of the meeting is ever logged") {
    Harness h;
    h.StartRegistered();
    // Os bons.
    h.Send(BrowserCommand(kCode, kPass));
    h.Send(BrowserCommand(kCode, ""));
    h.Send(RequestCommand(kId, kName, kSubject));
    h.Send(RequestCommand(kOtherId, kName, nullptr));
    h.SendFromNotice(AnswerCommand(kId, "aceitar"));       // outro pedido
    h.SendFromNotice(AnswerCommand(kOtherId, "recusar"));   // o do aviso
    h.SendFromNotice(AnswerCommand(kOtherId, "recusar"));   // atrasada
    h.SendFromNotice(kShow);
    h.Send(kNoRequest);
    // Os recusados na leitura (o motivo diz o campo, nunca o valor).
    h.Send(BrowserCommand("k7q49xwph", kPass));
    h.Send(BrowserCommand(kCode, std::string(kPass) + "+"));
    h.Send(RequestCommand("8899AABBCCDDEEFF", kName, kSubject));
    h.Send(RequestCommand(kId, std::string(kName) + "\n", kSubject));
    h.Send(RequestCommand(kId, kName, std::string(121, 'x') + kSubject));
    h.Send(AnswerCommand(kId, "sim"));
    // Depois do Sair.
    h.Send(R"({"v":1,"cmd":"quit"})");
    h.Send(BrowserCommand(kCode, kPass));
    h.Send(RequestCommand(kId, kName, kSubject));
    h.Send(AnswerCommand(kId, "aceitar"));

    REQUIRE_FALSE(h.logs.empty());
    for (const std::string& line : h.logs) {
        INFO(line);
        for (const char* secret : {kCode, kPass, kId, kOtherId, kName, kSubject, "Planejamento", "Maria"}) {
            CHECK(line.find(secret) == std::string::npos);
        }
    }
    CHECK(h.Logged("comando ignorado: reuniaoNavegador: codigo invalido"));
}

TEST_CASE("the meeting commands do nothing after quit") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"quit"})");
    h.host.clear();
    h.logs.clear();
    const size_t posts = h.posts.size();
    h.Send(BrowserCommand(kCode, kPass));
    h.Send(RequestCommand(kId, kName, kSubject));
    h.Send(AnswerCommand(kId, "aceitar"));
    h.Send(kShow);
    CHECK(h.host.empty());
    CHECK(h.posts.size() == posts);
    CHECK(h.logs == std::vector<std::string>{"comando ignorado depois do Sair: reuniaoNavegador",
                                             "comando ignorado depois do Sair: reuniaoPedido",
                                             "comando ignorado depois do Sair: reuniaoResposta",
                                             "comando ignorado depois do Sair: reuniaoMostrar"});
}

TEST_CASE("OpenMeeting waits for the first ready of the main window") {
    // O link starsonic://reuniao/<codigo> chega antes de a pagina carregar: nada vai, e no ready o abrir vem depois do
    // estado (e do resto), no fim, como o do chat.
    Harness h;
    h.app->OpenMeeting("abcdefghjk");
    h.StartRegistered();
    h.Run();
    CHECK(h.Messages("abrir").empty());
    size_t from = h.posts.size();
    h.Send(kReady);
    REQUIRE(h.posts.size() > from + 1);
    CHECK(h.posts[from].find(R"("type":"state")") != std::string::npos);
    CHECK(h.posts.back() == R"({"v":1,"type":"abrir","tela":"reuniao","codigo":"abcdefghjk"})");
    CHECK(h.Messages("abrir").size() == 1);

    // Uma vez so: a pagina que recarrega depois nao volta a reuniao.
    h.Send(kReady);
    CHECK(h.Messages("abrir").size() == 1);

    // Depois do ready, vai na hora, sozinho.
    from = h.posts.size();
    h.app->OpenMeeting("yz23456789");
    h.Run();
    REQUIRE(h.posts.size() == from + 1);
    CHECK(h.posts.back() == R"({"v":1,"type":"abrir","tela":"reuniao","codigo":"yz23456789"})");
}

TEST_CASE("OpenMeeting: the last one wins, and the ready of the notice page does not release it") {
    Harness h;
    h.app->OpenMeeting("abcdefghjk");
    h.StartRegistered();
    h.app->OpenMeeting("mnpqrstvwx");
    h.Run();
    // O ready da pagina do aviso nao e o da janela principal: nada sai.
    h.SendFromNotice(kReady);
    CHECK(h.Messages("abrir").empty());
    // Um link depois do ready do aviso, ainda sem o da principal: continua esperando.
    h.app->OpenMeeting("yz23456789");
    h.Run();
    CHECK(h.Messages("abrir").empty());
    h.Send(kReady);
    REQUIRE(h.Messages("abrir").size() == 1);
    CHECK(h.posts.back() == R"({"v":1,"type":"abrir","tela":"reuniao","codigo":"yz23456789"})");
}

TEST_CASE("OpenMeeting leaves a line in the diagnostics without the code") {
    Harness h;
    h.StartRegistered();
    h.Send(kReady);
    h.logs.clear();
    h.app->OpenMeeting("abcdefghjk");
    h.Run();
    CHECK(h.logs == std::vector<std::string>{"reunioes: link do app"});
    for (const std::string& line : h.logs) CHECK(line.find("abcdefghjk") == std::string::npos);

    // Tambem o que espera o ready.
    Harness other;
    other.app->OpenMeeting("mnpqrstvwx");
    other.StartRegistered();
    other.Run();
    CHECK(other.Logged("reunioes: link do app"));
    for (const std::string& line : other.logs) CHECK(line.find("mnpqrstvwx") == std::string::npos);
}

TEST_CASE("OpenMeeting is refused on the iPhone") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(kReady);
    const size_t from = h.posts.size();
    h.logs.clear();
    h.app->OpenMeeting("abcdefghjk");
    h.Run();
    CHECK(h.posts.size() == from);
    CHECK(h.logs == std::vector<std::string>{"abrir a reuniao: recusado no modo iPhone"});
    h.Send(kReady);
    CHECK(h.Messages("abrir").empty());
}

// As chamadas do openMeetingLink, na ordem.
static std::vector<std::string> LinkHooks(const Harness& h) {
    std::vector<std::string> out;
    for (const std::string& call : h.host) {
        if (call.compare(0, 15, "openMeetingLink") == 0) out.push_back(call);
    }
    return out;
}

static std::string LinkCommand(const std::string& url) {
    return json({{"v", 1}, {"cmd", "reuniaoLink"}, {"url", url}}).dump();
}

TEST_CASE("ValidMeetingLinkUrl: the limits") {
    CHECK(ValidMeetingLinkUrl("https://exemplo.com"));
    CHECK(ValidMeetingLinkUrl("http://exemplo.com/a?b=1#c"));
    CHECK(ValidMeetingLinkUrl("HtTpS://exemplo.com"));
    CHECK(ValidMeetingLinkUrl("https://exemplo.com/" + std::string(2028, 'a')));   // 2048
    CHECK_FALSE(ValidMeetingLinkUrl("https://exemplo.com/" + std::string(2029, 'a')));   // 2049
    CHECK_FALSE(ValidMeetingLinkUrl(""));
    CHECK_FALSE(ValidMeetingLinkUrl("https://"));
    CHECK_FALSE(ValidMeetingLinkUrl("https:///x"));
    CHECK_FALSE(ValidMeetingLinkUrl("ftp://exemplo.com"));
    CHECK_FALSE(ValidMeetingLinkUrl("javascript:alert(1)"));
    CHECK_FALSE(ValidMeetingLinkUrl("exemplo.com"));
    CHECK_FALSE(ValidMeetingLinkUrl("https://exemplo.com/a b"));
    CHECK_FALSE(ValidMeetingLinkUrl("https://exemplo.com/a\tb"));
    CHECK_FALSE(ValidMeetingLinkUrl(std::string("https://exemplo.com/a\x07")));
    CHECK_FALSE(ValidMeetingLinkUrl("https://exemplo.com/a\x7f"));
    CHECK_FALSE(ValidMeetingLinkUrl("https://exemplo.com/a\xc2\x85"));   // U+0085
    CHECK(ValidMeetingLinkUrl("https://exemplo.com/\xc3\xa7"));
}

TEST_CASE("MeetingLink opens and logs only the host") {
    Harness h;
    h.StartRegistered();
    h.Send(kReady);
    h.logs.clear();
    h.Send(LinkCommand("https://exemplo.com/sala/segredo?x=1"));
    CHECK(LinkHooks(h) == std::vector<std::string>{"openMeetingLink https://exemplo.com/sala/segredo?x=1"});
    CHECK(h.logs == std::vector<std::string>{"reunioes: link aberto: https://exemplo.com"});
    CHECK(h.opened.empty());   // nao passa pelo openUrl da lista de links permitidos
    for (const std::string& line : h.logs) CHECK(line.find("segredo") == std::string::npos);
}

TEST_CASE("MeetingLink with a bad url does nothing and logs without it") {
    Harness h;
    h.StartRegistered();
    h.Send(kReady);
    h.logs.clear();
    h.Send(LinkCommand("ftp://exemplo.com/segredo"));
    CHECK(LinkHooks(h).empty());
    CHECK(h.Logged("comando ignorado: reuniaoLink: endereco invalido"));
    for (const std::string& line : h.logs) CHECK(line.find("segredo") == std::string::npos);
}

TEST_CASE("MeetingLink is refused on the iPhone") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(kReady);
    h.logs.clear();
    h.Send(LinkCommand("https://exemplo.com/a"));
    CHECK(LinkHooks(h).empty());
    CHECK(h.Logged("comando recusado no modo iPhone: reuniaoLink"));
}

TEST_CASE("SetSessionLocked posts only when it changes") {
    Harness h;
    h.StartRegistered();
    h.Send(kReady);
    const size_t before = h.Messages("sessao").size();
    h.logs.clear();
    h.app->SetSessionLocked(true);
    h.app->SetSessionLocked(true);
    h.Run();
    REQUIRE(h.Messages("sessao").size() == before + 1);
    CHECK(h.posts.back() == R"({"v":1,"type":"sessao","bloqueada":true})");
    h.app->SetSessionLocked(false);
    h.Run();
    REQUIRE(h.Messages("sessao").size() == before + 2);
    CHECK(h.posts.back() == R"({"v":1,"type":"sessao","bloqueada":false})");
    // Nada vai ao diagnostico.
    CHECK(h.logs.empty());
}

TEST_CASE("SetSessionLocked does nothing on the iPhone") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(kReady);
    h.logs.clear();
    h.app->SetSessionLocked(true);
    h.Run();
    CHECK(h.Messages("sessao").empty());
    CHECK(h.logs.empty());
    h.Send(kReady);
    CHECK(h.Messages("sessao").empty());
}

TEST_CASE("SetSessionLocked: the current value goes on every ready of the main window, after the state") {
    Harness h;
    h.app->SetSessionLocked(true);   // antes do primeiro ready
    h.StartRegistered();
    h.Run();
    size_t from = h.posts.size();
    h.Send(kReady);
    REQUIRE(h.posts.size() > from + 1);
    CHECK(h.posts[from].find(R"("type":"state")") != std::string::npos);
    std::vector<size_t> at;
    for (size_t i = from; i < h.posts.size(); ++i) {
        if (h.posts[i] == R"({"v":1,"type":"sessao","bloqueada":true})") at.push_back(i);
    }
    CHECK(at.size() == 1);

    // Outro ready da principal: o valor de agora de novo.
    from = h.posts.size();
    h.Send(kReady);
    size_t again = 0;
    for (size_t i = from; i < h.posts.size(); ++i) {
        if (h.posts[i] == R"({"v":1,"type":"sessao","bloqueada":true})") ++again;
    }
    CHECK(again == 1);

    // O ready do aviso nao a recebe.
    from = h.posts.size();
    h.SendFromNotice(kReady);
    for (size_t i = from; i < h.posts.size(); ++i) CHECK(h.posts[i].find("sessao") == std::string::npos);

    // Antes do abrir da reuniao que esperava o ready.
    Harness other;
    other.app->OpenMeeting("abcdefghjk");
    other.app->SetSessionLocked(false);
    other.StartRegistered();
    other.Send(kReady);
    REQUIRE(other.posts.size() > 2);
    CHECK(other.posts.back() == R"({"v":1,"type":"abrir","tela":"reuniao","codigo":"abcdefghjk"})");
    CHECK(other.posts[other.posts.size() - 2] == R"({"v":1,"type":"sessao","bloqueada":false})");
}
