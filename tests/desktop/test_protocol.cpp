// Testes do protocolo da ponte (starsonic/desktop/Protocol.h; o contrato e o docs/ponte-windows.md).
#include <string>
#include <vector>

#include "Protocol.h"
#include "nlohmann/json.hpp"
#include "test_support.h"

using namespace starsonic;
using nlohmann::json;

namespace {

Command Parsed(const std::string& text) {
    std::string error;
    const std::optional<Command> command = ParseCommand(text, &error);
    INFO(text << " -> " << error);
    REQUIRE(command.has_value());
    return *command;
}

bool Refused(const std::string& text) {
    std::string error;
    const bool refused = !ParseCommand(text, &error).has_value();
    if (refused) CHECK_FALSE(error.empty());
    return refused;
}

json Parse(const std::string& message) { return json::parse(message); }

}  // namespace

TEST_CASE("every command of the protocol parses into its command") {
    struct Simple {
        const char* name;
        CommandKind kind;
    };
    const std::vector<Simple> simple = {
        {"ready", CommandKind::Ready},
        {"answer", CommandKind::Answer},
        {"reject", CommandKind::Reject},
        {"completeTransfer", CommandKind::CompleteTransfer},
        {"cancelConsult", CommandKind::CancelConsult},
        {"swap", CommandKind::Swap},
        {"join", CommandKind::Join},
        {"split", CommandKind::Split},
        {"sendDiagnostics", CommandKind::SendDiagnostics},
        {"minimize", CommandKind::Minimize},
        {"closeToTray", CommandKind::CloseToTray},
        {"quit", CommandKind::Quit},
        {"viewRecents", CommandKind::ViewRecents},
        {"updateNow", CommandKind::UpdateNow},
        {"updateLater", CommandKind::UpdateLater},
        {"cancelLogin", CommandKind::CancelLogin},
    };
    for (const Simple& s : simple) {
        const Command command = Parsed(std::string(R"({"v":1,"cmd":")") + s.name + "\"}");
        CHECK(command.kind == s.kind);
        CHECK(std::string(CommandName(command.kind)) == s.name);
    }

    SUBCASE("login") {
        Command c = Parsed(
            R"({"v":1,"cmd":"login","servidor":"pbx.example.com","protocolo":"tcp","ramal":"2001",)"
            R"("senha":"segredo","nome":"Recep\u00e7\u00e3o","contaId":"abc"})");
        CHECK(c.kind == CommandKind::Login);
        CHECK(c.server == "pbx.example.com");
        CHECK(c.transport == "tcp");
        CHECK(c.ramal == "2001");
        CHECK(c.password == "segredo");
        CHECK(c.name == "Recep\xc3\xa7\xc3\xa3o");
        CHECK(c.accountId == "abc");
        c = Parsed(R"({"v":1,"cmd":"login","servidor":"a","protocolo":"udp","ramal":"1","senha":""})");
        CHECK(c.name.empty());
        CHECK(c.accountId.empty());
        CHECK(c.transport == "udp");
    }
    SUBCASE("accounts") {
        Command c = Parsed(R"({"v":1,"cmd":"selectAccount","contaId":"a1"})");
        CHECK(c.kind == CommandKind::SelectAccount);
        CHECK(c.accountId == "a1");
        c = Parsed(R"({"v":1,"cmd":"removeAccount","contaId":"a2"})");
        CHECK(c.kind == CommandKind::RemoveAccount);
        CHECK(c.accountId == "a2");
    }
    SUBCASE("dial, transfer and consult") {
        Command c = Parsed(R"({"v":1,"cmd":"dial","numero":"2003"})");
        CHECK(c.kind == CommandKind::Dial);
        CHECK(c.number == "2003");
        CHECK_FALSE(c.contact);
        c = Parsed(R"({"v":1,"cmd":"dial","numero":"+55 11 5060-3000","contato":true})");
        CHECK(c.contact);
        c = Parsed(R"({"v":1,"cmd":"transfer","numero":"2004"})");
        CHECK(c.kind == CommandKind::Transfer);
        CHECK(c.number == "2004");
        c = Parsed(R"({"v":1,"cmd":"consult","numero":"2005"})");
        CHECK(c.kind == CommandKind::Consult);
        CHECK(c.number == "2005");
    }
    SUBCASE("hangup, hold and mute") {
        Command c = Parsed(R"({"v":1,"cmd":"hangup"})");
        CHECK(c.kind == CommandKind::Hangup);
        CHECK_FALSE(c.callId.has_value());
        c = Parsed(R"({"v":1,"cmd":"hangup","id":7})");
        CHECK(c.callId == 7);
        c = Parsed(R"({"v":1,"cmd":"hangup","id":0})");
        CHECK(c.callId == 0);
        c = Parsed(R"({"v":1,"cmd":"hold"})");
        CHECK(c.kind == CommandKind::Hold);
        CHECK_FALSE(c.on.has_value());
        c = Parsed(R"({"v":1,"cmd":"hold","on":true})");
        CHECK(c.on == true);
        c = Parsed(R"({"v":1,"cmd":"mute","on":false})");
        CHECK(c.kind == CommandKind::Mute);
        CHECK(c.on == false);
    }
    SUBCASE("dtmf") {
        const Command c = Parsed(R"({"v":1,"cmd":"dtmf","digitos":"12#"})");
        CHECK(c.kind == CommandKind::Dtmf);
        CHECK(c.digits == "12#");
    }
    SUBCASE("do not disturb and auto answer") {
        Command c = Parsed(R"({"v":1,"cmd":"setDnd","on":true})");
        CHECK(c.kind == CommandKind::SetDnd);
        CHECK(c.on == true);
        c = Parsed(R"({"v":1,"cmd":"setAutoAnswer","on":true,"segundos":5})");
        CHECK(c.kind == CommandKind::SetAutoAnswer);
        CHECK(c.on == true);
        CHECK(c.seconds == 5);
        c = Parsed(R"({"v":1,"cmd":"setAutoAnswer","on":false})");
        CHECK(c.on == false);
        CHECK_FALSE(c.seconds.has_value());
    }
    SUBCASE("contacts") {
        Command c = Parsed(R"({"v":1,"cmd":"saveContact","id":"c1","nome":"Ana","numero":"2005","observacao":"x"})");
        CHECK(c.kind == CommandKind::SaveContact);
        CHECK(c.contactId == "c1");
        CHECK(c.name == "Ana");
        CHECK(c.number == "2005");
        CHECK(c.note == "x");
        c = Parsed(R"({"v":1,"cmd":"saveContact","nome":"Bia","numero":"2006"})");
        CHECK(c.contactId.empty());
        CHECK(c.note.empty());
        c = Parsed(R"({"v":1,"cmd":"removeContact","id":"c2"})");
        CHECK(c.kind == CommandKind::RemoveContact);
        CHECK(c.contactId == "c2");
    }
    SUBCASE("audio") {
        Command c = Parsed(R"({"v":1,"cmd":"setAudio","microfone":"Headset","altoFalante":"","toque":"sink-1"})");
        CHECK(c.kind == CommandKind::SetAudio);
        CHECK(c.capture == std::string("Headset"));
        CHECK(c.playback == std::string(""));
        CHECK(c.ring == std::string("sink-1"));
        c = Parsed(R"({"v":1,"cmd":"setAudio","toque":""})");
        CHECK_FALSE(c.capture.has_value());
        CHECK_FALSE(c.playback.has_value());
        CHECK(c.ring == std::string(""));
    }
    SUBCASE("settings and links") {
        Command c = Parsed(R"({"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false})");
        CHECK(c.kind == CommandKind::SetSetting);
        CHECK(c.key == "iniciarComWindows");
        CHECK_FALSE(c.value);
        c = Parsed(R"({"v":1,"cmd":"openExternal","url":"https://starsonic.com.br"})");
        CHECK(c.kind == CommandKind::OpenExternal);
        CHECK(c.url == "https://starsonic.com.br");
    }
    SUBCASE("shortcuts (rc.3)") {
        Command c = Parsed(R"({"v":1,"cmd":"saveShortcut","nome":"Recep\u00e7\u00e3o","numero":"2007","acao":"consulta",)"
                           R"("blf":true})");
        CHECK(c.kind == CommandKind::SaveShortcut);
        CHECK(std::string(CommandName(c.kind)) == "saveShortcut");
        CHECK(c.shortcutId.empty());
        CHECK(c.name == "Recep\xc3\xa7\xc3\xa3o");
        CHECK(c.number == "2007");
        CHECK(c.action == "consulta");
        CHECK(c.blf);
        for (const char* action : {"ligar", "transferir", "consulta", "teclas"}) {
            c = Parsed(std::string(R"({"v":1,"cmd":"saveShortcut","id":"s1","nome":"A","numero":"1","acao":")") + action +
                       R"(","blf":false})");
            CHECK(c.shortcutId == "s1");
            CHECK(c.action == action);
            CHECK_FALSE(c.blf);
        }
        c = Parsed(R"({"v":1,"cmd":"removeShortcut","id":"s2"})");
        CHECK(c.kind == CommandKind::RemoveShortcut);
        CHECK(std::string(CommandName(c.kind)) == "removeShortcut");
        CHECK(c.shortcutId == "s2");
        c = Parsed(R"({"v":1,"cmd":"useShortcut","id":"s3"})");
        CHECK(c.kind == CommandKind::UseShortcut);
        CHECK(std::string(CommandName(c.kind)) == "useShortcut");
        CHECK(c.shortcutId == "s3");
    }
    SUBCASE("admin (rc.3)") {
        Command c = Parsed(R"({"v":1,"cmd":"adminLogin","senha":"x y"})");
        CHECK(c.kind == CommandKind::AdminLogin);
        CHECK(std::string(CommandName(c.kind)) == "adminLogin");
        CHECK(c.password == "x y");
        c = Parsed(R"({"v":1,"cmd":"adminLogout"})");
        CHECK(c.kind == CommandKind::AdminLogout);
        CHECK(std::string(CommandName(c.kind)) == "adminLogout");
        c = Parsed(R"({"v":1,"cmd":"adminSet","naoPerturbe":false,"atenderAuto":true,"blf":true,"puxar":false,)"
                   R"("codigoPuxar":"**{ramal}","servidores":[{"endereco":"pbx.example.com","porta":5070},)"
                   R"({"endereco":"Starcloud1-starsonic.com.br","porta":0}],"canal":"teste"})");
        CHECK(c.kind == CommandKind::AdminSet);
        CHECK(std::string(CommandName(c.kind)) == "adminSet");
        CHECK(c.admin.showDoNotDisturb == false);
        CHECK(c.admin.showAutoAnswer == true);
        CHECK(c.admin.blf == true);
        CHECK(c.admin.pickup == false);
        CHECK(c.admin.pickupCode == std::string("**{ramal}"));
        CHECK(c.admin.channel == std::string("teste"));
        REQUIRE(c.admin.servers.has_value());
        REQUIRE(c.admin.servers->size() == 2);
        CHECK(c.admin.servers->at(0).address == "pbx.example.com");
        CHECK(c.admin.servers->at(0).port == 5070);
        CHECK(c.admin.servers->at(1).address == "Starcloud1-starsonic.com.br");   // a loja normaliza e valida
        CHECK(c.admin.servers->at(1).port == 0);
        // So o que veio muda.
        c = Parsed(R"({"v":1,"cmd":"adminSet","blf":true})");
        CHECK(c.admin.blf == true);
        CHECK_FALSE(c.admin.showDoNotDisturb.has_value());
        CHECK_FALSE(c.admin.showAutoAnswer.has_value());
        CHECK_FALSE(c.admin.pickup.has_value());
        CHECK_FALSE(c.admin.pickupCode.has_value());
        CHECK_FALSE(c.admin.servers.has_value());
        CHECK_FALSE(c.admin.channel.has_value());
        c = Parsed(R"({"v":1,"cmd":"adminSet","servidores":[],"canal":""})");
        REQUIRE(c.admin.servers.has_value());
        CHECK(c.admin.servers->empty());
        CHECK(c.admin.channel == std::string(""));
    }
    SUBCASE("the end beep setting (rc.3)") {
        Command c = Parsed(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":true})");
        CHECK(c.kind == CommandKind::SetSetting);
        CHECK(c.key == "bipeFim");
        CHECK(c.value);
    }
    SUBCASE("resize: the edge the interface grabbed (rc.2)") {
        for (const char* edge : {"cima", "cima-esquerda", "cima-direita", "baixo-direita"}) {
            const Command c = Parsed(std::string(R"({"v":1,"cmd":"resize","borda":")") + edge + "\"}");
            CHECK(c.kind == CommandKind::Resize);
            CHECK(c.edge == edge);
            CHECK(std::string(CommandName(c.kind)) == "resize");
        }
    }
}

TEST_CASE("version 2, an unknown command and a field of the wrong type parse into nothing") {
    CHECK(Refused(R"({"v":2,"cmd":"ready"})"));
    CHECK(Refused(R"({"cmd":"ready"})"));
    CHECK(Refused(R"({"v":"1","cmd":"ready"})"));
    CHECK(Refused(R"({"v":1.5,"cmd":"ready"})"));
    CHECK(Refused(R"({"v":1,"cmd":"format"})"));
    CHECK(Refused(R"({"v":1})"));
    CHECK(Refused(R"({"v":1,"cmd":7})"));
    CHECK(Refused("not json"));
    CHECK(Refused("[1,2]"));
    CHECK(Refused(""));
    // Campo com o tipo errado, ou obrigatorio que falta.
    CHECK(Refused(R"({"v":1,"cmd":"dial","numero":2003})"));
    CHECK(Refused(R"({"v":1,"cmd":"dial"})"));
    CHECK(Refused(R"({"v":1,"cmd":"dial","numero":"2003","contato":"sim"})"));
    CHECK(Refused(R"({"v":1,"cmd":"hangup","id":"7"})"));
    CHECK(Refused(R"({"v":1,"cmd":"hangup","id":1.5})"));
    CHECK(Refused(R"({"v":1,"cmd":"hangup","id":-1})"));
    CHECK(Refused(R"({"v":1,"cmd":"hold","on":1})"));
    CHECK(Refused(R"({"v":1,"cmd":"mute","on":"true"})"));
    CHECK(Refused(R"({"v":1,"cmd":"setDnd"})"));
    CHECK(Refused(R"({"v":1,"cmd":"setDnd","on":null})"));
    CHECK(Refused(R"({"v":1,"cmd":"setAutoAnswer","on":true,"segundos":"3"})"));
    CHECK(Refused(R"({"v":1,"cmd":"dtmf","digitos":5})"));
    CHECK(Refused(R"({"v":1,"cmd":"login","servidor":"a","protocolo":"tls","ramal":"1","senha":"x"})"));
    CHECK(Refused(R"({"v":1,"cmd":"login","servidor":"a","protocolo":"udp","ramal":1,"senha":"x"})"));
    CHECK(Refused(R"({"v":1,"cmd":"login","servidor":"a","protocolo":"udp","ramal":"1"})"));
    CHECK(Refused(R"({"v":1,"cmd":"login","servidor":"a","protocolo":"udp","ramal":"1","senha":"x","nome":3})"));
    CHECK(Refused(R"({"v":1,"cmd":"selectAccount"})"));
    CHECK(Refused(R"({"v":1,"cmd":"removeAccount","contaId":5})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveContact","nome":"Ana"})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveContact","nome":"Ana","numero":"1","observacao":false})"));
    CHECK(Refused(R"({"v":1,"cmd":"removeContact"})"));
    CHECK(Refused(R"({"v":1,"cmd":"setAudio","microfone":0})"));
    CHECK(Refused(R"({"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":"sim"})"));
    CHECK(Refused(R"({"v":1,"cmd":"setSetting","chave":"naoPerturbe","valor":true})"));
    CHECK(Refused(R"({"v":1,"cmd":"openExternal"})"));
    CHECK(Refused(R"({"v":1,"cmd":"openExternal","url":["x"]})"));
    CHECK(Refused(R"({"v":1,"cmd":"resize"})"));
    CHECK(Refused(R"({"v":1,"cmd":"resize","borda":1})"));
    CHECK(Refused(R"({"v":1,"cmd":"resize","borda":"esquerda"})"));
    CHECK(Refused(R"({"v":1,"cmd":"resize","borda":"baixo-esquerda"})"));
    // rc.3
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","nome":"A","numero":"1","acao":"ligar"})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","nome":"A","numero":"1","acao":"ligar","blf":"sim"})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","nome":"A","numero":"1","acao":"discar","blf":false})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","numero":"1","acao":"ligar","blf":false})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","nome":"A","acao":"ligar","blf":false})"));
    CHECK(Refused(R"({"v":1,"cmd":"saveShortcut","id":3,"nome":"A","numero":"1","acao":"ligar","blf":false})"));
    CHECK(Refused(R"({"v":1,"cmd":"removeShortcut"})"));
    CHECK(Refused(R"({"v":1,"cmd":"useShortcut","id":1})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminLogin"})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminLogin","senha":123})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","blf":"sim"})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","codigoPuxar":8})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","canal":null})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":{"endereco":"a","porta":1}})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":["a"]})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":[{"endereco":"a"}]})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":[{"porta":5060}]})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":[{"endereco":"a","porta":"5060"}]})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":[{"endereco":"a","porta":50.5}]})"));
    CHECK(Refused(R"({"v":1,"cmd":"adminSet","servidores":[{"endereco":"a","porta":99999999999}]})"));
    CHECK(Refused(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":1})"));
    // Campos a mais nao atrapalham.
    CHECK_FALSE(Refused(R"({"v":1,"cmd":"answer","extra":true})"));
}

TEST_CASE("the empty state serializes with every key") {
    const json message = Parse(StateMessage(BridgeState()));
    CHECK(message["v"] == 1);
    CHECK(message["type"] == "state");
    const json& s = message["state"];
    const std::vector<std::string> keys = {"tela",      "entrar",     "conta",    "contas",
                                           "naoPerturbe", "atenderAutomatico", "ligacao", "recentes",
                                           "perdidas",  "contatos",   "audio",    "iniciarComWindows",
                                           "versao",    "teclado",    "tecladoVez", "atalhos",
                                           "admin",     "entrarAdmin", "config"};
    for (const std::string& key : keys) {
        INFO(key);
        CHECK(s.contains(key));
    }
    CHECK(s.size() == keys.size());
    CHECK(s["tela"] == "entrar");
    for (const char* key :
         {"servidor", "protocolo", "ramal", "nome", "erro", "ocupado", "pedeSenha", "podeCancelar", "contaId"}) {
        INFO(key);
        CHECK(s["entrar"].contains(key));
    }
    CHECK(s["entrar"]["protocolo"] == "udp");
    CHECK(s["entrar"]["ocupado"] == false);
    CHECK(s["conta"].is_null());
    CHECK(s["contas"] == json::array());
    CHECK(s["naoPerturbe"] == false);
    CHECK(s["atenderAutomatico"] == json({{"on", false}, {"segundos", 3}}));
    CHECK(s["ligacao"].is_null());
    CHECK(s["recentes"] == json::array());
    CHECK(s["perdidas"] == 0);
    CHECK(s["contatos"] == json::array());
    for (const char* key : {"microfones", "altoFalantes", "microfone", "altoFalante", "toque", "desconectados"}) {
        INFO(key);
        CHECK(s["audio"].contains(key));
    }
    CHECK(s["iniciarComWindows"] == true);
    CHECK(s["versao"] == "");
    CHECK(s["teclado"] == "");
    CHECK(s["tecladoVez"] == 0);
    CHECK(s["atalhos"] == json::array());
    CHECK(s["admin"] ==
          json({{"aberto", false}, {"naoPerturbe", true}, {"atenderAuto", true}, {"blf", false}, {"puxa", false}}));
    CHECK(s["entrarAdmin"] == json({{"erro", ""}, {"esperaAte", 0}, {"vez", 0}}));
    CHECK(s["config"] == json({{"bipeFim", true}}));
}

TEST_CASE("the state serializes the shortcuts, the admin area, the internet and the end beep setting (rc.3)") {
    BridgeState state;
    AccountView account;
    account.id = "a1";
    account.internet = false;
    state.account = account;
    ShortcutView a;
    a.id = "s1";
    a.name = "Ana";
    a.number = "2007";
    a.action = "transferir";
    a.blf = true;
    a.state = "tocando";
    ShortcutView b;
    b.id = "s2";
    b.name = "Menu";
    b.number = "12#";
    b.action = "teclas";
    state.shortcuts = {a, b};
    state.admin.showDoNotDisturb = false;
    state.admin.blf = true;
    state.admin.picksUp = true;
    state.admin.pickup = true;
    state.admin.pickupCode = "**{ramal}";
    state.admin.servers.push_back(ServerView{"starcloud1-starsonic.com.br", 35060});
    state.admin.channel = "estavel";
    state.adminLogin.error = "Senha incorreta.";
    state.adminLogin.waitUntilMs = 1761062430000LL;
    state.adminLogin.seq = 3;
    state.endBeep = false;

    json s = Parse(StateMessage(state))["state"];
    CHECK(s["conta"]["internet"] == false);
    CHECK(s["atalhos"] == json::array({json({{"id", "s1"},
                                             {"nome", "Ana"},
                                             {"numero", "2007"},
                                             {"acao", "transferir"},
                                             {"blf", true},
                                             {"estado", "tocando"}}),
                                       json({{"id", "s2"},
                                             {"nome", "Menu"},
                                             {"numero", "12#"},
                                             {"acao", "teclas"},
                                             {"blf", false},
                                             {"estado", nullptr}})}));
    // Fechada, a area mostra so o que a interface precisa para esconder os botoes e para a ajuda do puxar.
    CHECK(s["admin"] ==
          json({{"aberto", false}, {"naoPerturbe", false}, {"atenderAuto", true}, {"blf", true}, {"puxa", true}}));
    CHECK(s["entrarAdmin"] == json({{"erro", "Senha incorreta."}, {"esperaAte", 1761062430000LL}, {"vez", 3}}));
    CHECK(s["config"] == json({{"bipeFim", false}}));

    state.admin.open = true;
    s = Parse(StateMessage(state))["state"];
    CHECK(s["admin"] == json({{"aberto", true},
                              {"naoPerturbe", false},
                              {"atenderAuto", true},
                              {"blf", true},
                              {"puxa", true},
                              {"puxar", true},
                              {"codigoPuxar", "**{ramal}"},
                              {"servidores", json::array({json({{"endereco", "starcloud1-starsonic.com.br"},
                                                                {"porta", 35060}})})},
                              {"canal", "estavel"}}));
}

TEST_CASE("the state serializes the accounts, the recents, the contacts and the audio") {
    BridgeState state;
    state.mainScreen = true;
    AccountView account;
    account.id = "a1";
    account.name = "Recep";
    account.ramal = "2001";
    account.server = "pbx.example.com";
    account.transport = "tcp";
    account.status = AccountStatus::Connected;
    account.text = "Conectado \xc2\xb7 pbx.example.com";
    state.account = account;
    account.inUse = true;
    state.accounts.push_back(account);
    RecentView recent;
    recent.number = "2002";
    recent.name = "Ana";
    recent.kind = Recent::Missed;
    recent.startMs = 1761062400000LL;
    recent.durationMs = 0;
    recent.contactId = "c1";
    state.recents.push_back(recent);
    state.missed = 1;
    state.contacts.push_back(ContactView{"c1", "Ana", "2002", "cliente"});
    state.audio.captures.push_back(AudioOption{0, "Microfone"});
    state.audio.playbacks.push_back(AudioOption{1, "Alto-falantes"});
    state.audio.capture = "Headset";
    state.audio.disconnected.push_back("Headset");
    state.doNotDisturb = true;
    state.autoAnswer = true;
    state.autoAnswerSeconds = 5;
    state.version = "0.1.0-rc.1";
    state.keypad = "2003";
    state.keypadSeq = 2;

    const json s = Parse(StateMessage(state))["state"];
    CHECK(s["tela"] == "principal");
    CHECK(s["conta"] == json({{"id", "a1"},
                              {"nome", "Recep"},
                              {"ramal", "2001"},
                              {"servidor", "pbx.example.com"},
                              {"protocolo", "tcp"},
                              {"status", "conectado"},
                              {"texto", "Conectado \xc2\xb7 pbx.example.com"},
                              {"internet", true}}));
    CHECK(s["contas"][0] == json({{"id", "a1"},
                                  {"nome", "Recep"},
                                  {"ramal", "2001"},
                                  {"servidor", "pbx.example.com"},
                                  {"protocolo", "tcp"},
                                  {"emUso", true}}));
    CHECK(s["recentes"][0] == json({{"numero", "2002"},
                                    {"nome", "Ana"},
                                    {"tipo", "perdida"},
                                    {"inicio", 1761062400000LL},
                                    {"duracao", 0},
                                    {"contatoId", "c1"}}));
    CHECK(s["perdidas"] == 1);
    CHECK(s["contatos"][0] == json({{"id", "c1"}, {"nome", "Ana"}, {"numero", "2002"}, {"observacao", "cliente"}}));
    CHECK(s["audio"]["microfones"] == json::array({json({{"id", 0}, {"nome", "Microfone"}})}));
    CHECK(s["audio"]["altoFalantes"] == json::array({json({{"id", 1}, {"nome", "Alto-falantes"}})}));
    CHECK(s["audio"]["microfone"] == "Headset");
    CHECK(s["audio"]["altoFalante"] == "");
    CHECK(s["audio"]["desconectados"] == json::array({"Headset"}));
    CHECK(s["naoPerturbe"] == true);
    CHECK(s["atenderAutomatico"] == json({{"on", true}, {"segundos", 5}}));
    CHECK(s["versao"] == "0.1.0-rc.1");
    CHECK(s["teclado"] == "2003");
    CHECK(s["tecladoVez"] == 2);

    for (AccountStatus status : {AccountStatus::Connecting, AccountStatus::NoConnection, AccountStatus::Error}) {
        state.account->status = status;
        const std::string text = Parse(StateMessage(state))["state"]["conta"]["status"];
        CHECK(text == (status == AccountStatus::Connecting     ? "conectando"
                       : status == AccountStatus::NoConnection ? "sem_conexao"
                                                               : "erro"));
    }
    state.recents[0].kind = Recent::Outgoing;
    CHECK(Parse(StateMessage(state))["state"]["recentes"][0]["tipo"] == "feita");
    state.recents[0].kind = Recent::Incoming;
    CHECK(Parse(StateMessage(state))["state"]["recentes"][0]["tipo"] == "recebida");
}

TEST_CASE("the call serializes with the names of the snapshot and the second of a conference as active") {
    BridgeState state;
    CallView top;
    top.id = 11;
    top.number = "2002";
    top.name = "Ana";
    top.incoming = false;
    top.phase = CallView::Active;
    top.activeSinceMs = 1761062400000LL;
    CallView second;
    second.id = 12;
    second.number = "2003";
    second.name = "";
    second.incoming = true;
    second.phase = CallView::Ringing;
    state.call.top = top;
    state.call.second = second;
    state.call.secondKind = CallSnapshot::Ringing;
    state.call.muted = true;
    state.call.endMessage = "Ocupado";   // vai como toast, nao no estado

    json call = Parse(StateMessage(state))["state"]["ligacao"];
    CHECK(call == json({{"top",
                         {{"id", 11},
                          {"number", "2002"},
                          {"name", "Ana"},
                          {"incoming", false},
                          {"phase", "active"},
                          {"activeSinceMs", 1761062400000LL},
                          {"held", false}}},
                        {"second",
                         {{"id", 12},
                          {"number", "2003"},
                          {"name", ""},
                          {"incoming", true},
                          {"phase", "ringing"},
                          {"activeSinceMs", 0},
                          {"held", false}}},
                        {"secondKind", "ringing"},
                        {"muted", true},
                        {"conference", false},
                        {"conferenceSinceMs", 0},
                        {"consulting", false},
                        {"colleagueActive", false}}));

    state.call.second->phase = CallView::Active;
    state.call.second->held = true;
    state.call.secondKind = CallSnapshot::Held;
    CHECK(Parse(StateMessage(state))["state"]["ligacao"]["secondKind"] == "held");

    // Na conferencia o controlador deixa o secondKind Held (com held false): a ponte o mostra como ativa.
    state.call.second->held = false;
    state.call.conference = true;
    state.call.conferenceSinceMs = 1761062500000LL;
    call = Parse(StateMessage(state))["state"]["ligacao"];
    CHECK(call["secondKind"] == "active");
    CHECK(call["second"]["held"] == false);
    CHECK(call["conference"] == true);
    CHECK(call["conferenceSinceMs"] == 1761062500000LL);

    state.call.second.reset();
    state.call.secondKind = CallSnapshot::None;
    state.call.conference = false;
    state.call.top->phase = CallView::Dialing;
    state.call.top->id = 0;
    call = Parse(StateMessage(state))["state"]["ligacao"];
    CHECK(call["second"].is_null());
    CHECK(call["secondKind"] == "none");
    CHECK(call["top"]["phase"] == "dialing");
    CHECK(call["top"]["id"] == 0);

    // So o aviso (sem ligacao): ligacao null.
    state.call = CallSnapshot();
    state.call.endMessage = "Ocupado";
    CHECK(Parse(StateMessage(state))["state"]["ligacao"].is_null());
}

TEST_CASE("the update message carries the version and the notes") {
    CHECK(Parse(UpdateMessage("0.1.0-rc.2", "Corre\xc3\xa7\xc3\xb5" "es no aviso")) ==
          json({{"v", 1}, {"type", "update"}, {"versao", "0.1.0-rc.2"}, {"notas", "Corre\xc3\xa7\xc3\xb5" "es no aviso"}}));
    CHECK(Parse(UpdateMessage("0.1.0", "")) == json({{"v", 1}, {"type", "update"}, {"versao", "0.1.0"}, {"notas", ""}}));
}

TEST_CASE("toast and ring messages") {
    CHECK(Parse(ToastMessage("A troca de conta fica para o fim da liga\xc3\xa7\xc3\xa3o.")) ==
          json({{"v", 1}, {"type", "toast"}, {"texto", "A troca de conta fica para o fim da liga\xc3\xa7\xc3\xa3o."}}));
    CHECK(Parse(RingMessage(RingKind::Full)) == json({{"v", 1}, {"type", "ring"}, {"tipo", "completo"}}));
    CHECK(Parse(RingMessage(RingKind::Waiting)) == json({{"v", 1}, {"type", "ring"}, {"tipo", "espera"}}));
    CHECK(Parse(RingMessage(RingKind::Stop)) == json({{"v", 1}, {"type", "ring"}, {"tipo", "parar"}}));
    // rc.3: o bipe do fim da ligacao, uma vez.
    CHECK(Parse(EndBeepMessage()) == json({{"v", 1}, {"type", "ring"}, {"tipo", "fim"}}));
    // Um nome da central com bytes que nao sao UTF-8 nao impede a mensagem.
    CHECK_NOTHROW(Parse(ToastMessage("Liga\xc3\xa7\xc3\xa3o perdida de \xff\xfe")));
}
