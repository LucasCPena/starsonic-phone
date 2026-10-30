// Testes do modo iPhone do nucleo (docs/ponte-windows.md, "O modo iPhone"; spec do iPhone, 4.2, 6.1, 6.4 e 7.1): o
// estado com a plataforma e os campos do PC neutros, a conta unica, o Sair, os comandos do PC recusados no iPhone e os
// do iPhone recusados no Windows, a abertura sem as partes do PC, o openExternal do iPhone e a agenda (a mensagem, os
// nomes nas ligacoes, a permissao, os ganchos e o diagnostico sem os contatos).
#include <map>
#include <string>
#include <vector>

#include "desktop_fixture.h"

using namespace starsonic;
using nlohmann::json;

namespace {

const char* const kReady = R"({"v":1,"cmd":"ready"})";
const char* const kContactsOpened = R"({"v":1,"cmd":"contactsOpened"})";
const char* const kAllowContacts = R"({"v":1,"cmd":"allowContacts"})";
const char* const kCompanyLink = "https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit";
const char* const kMissedAna = "Liga\xc3\xa7\xc3\xa3o perdida de Ana Souza";

// A agenda de exemplo (inventada), como o hospedeiro a entrega: a Ana com o celular (com o +55 e o DDD) e o ramal, um
// contato sem nome, o Elcio (com acento) com o fixo, e um contato sem numero (fica de fora).
std::vector<AgendaContact> SampleAgenda() {
    return {AgendaContact{"Ana Souza", {"+55 11 98888-7777", "2003"}},
            AgendaContact{"", {"(21) 97777-6666"}},
            AgendaContact{"\xc3\x89lcio Matos", {"(11) 3333-4040"}},
            AgendaContact{"Sem Numero", {}}};
}

// A mensagem agenda da agenda de exemplo, com a vez, no texto exato do contrato (a ordem das chaves), sem o contato sem
// numero.
std::string SampleAgendaMessage(int vez) {
    return R"({"v":1,"type":"agenda","vez":)" + std::to_string(vez) +
           R"(,"contatos":[{"nome":"Ana Souza","numeros":["+55 11 98888-7777","2003"]},)"
           R"({"nome":"","numeros":["(21) 97777-6666"]},{"nome":")" + "\xc3\x89lcio Matos" +
           R"(","numeros":["(11) 3333-4040"]}]})";
}

// O resumo da agenda de exemplo no estado, com a permissao concedida.
json GrantedSummary(int vez) { return json({{"permissao", "concedida"}, {"vez", vez}, {"quantos", 3}}); }

// O ultimo aviso de 2 s (o teste falha sem nenhum).
std::string LastToast(const Harness& h) {
    const std::vector<std::string> toasts = h.Toasts();
    REQUIRE_FALSE(toasts.empty());
    return toasts.back();
}

// A ultima mensagem agenda (o teste falha sem nenhuma).
json LastAgenda(const Harness& h) {
    const std::vector<json> messages = h.Messages("agenda");
    REQUIRE_FALSE(messages.empty());
    return messages.back();
}

// As chaves do estado de hoje (o do Windows), na ordem do docs/ponte-windows.md.
std::vector<std::string> PcKeys() {
    return {"tela",     "entrar",   "conta",    "contas",  "naoPerturbe",       "atenderAutomatico", "ligacao",
            "recentes", "perdidas", "contatos", "audio",   "iniciarComWindows", "versao",            "teclado",
            "tecladoVez", "atalhos", "admin",   "entrarAdmin", "config",        "empresa"};
}

const json& NeutralAdmin() {
    static const json admin = {{"aberto", false}, {"naoPerturbe", true}, {"atenderAuto", true}, {"blf", false},
                               {"puxa", false}};
    return admin;
}

// O texto da ultima mensagem state: a ordem das chaves (o json lido as poe em ordem alfabetica).
std::string LastStateText(const Harness& h) {
    for (auto it = h.posts.rbegin(); it != h.posts.rend(); ++it) {
        if (json::parse(*it)["type"] == "state") return *it;
    }
    FAIL("nenhuma mensagem state");
    return std::string();
}

// Tudo o que um comando pode mudar fora do diagnostico, num texto so: as mensagens para a interface, o disco, os
// ganchos do executavel, o registro, o motor e o agendador. Um comando recusado deixa o texto igual.
std::string Effects(const Harness& h) {
    std::string out = "mensagens " + std::to_string(h.posts.size());
    for (const auto& file : h.files.files) out += " | " + file.first + " = " + file.second;
    for (const std::string& call : h.host) out += " | gancho " + call;
    for (const std::string& url : h.opened) out += " | abriu " + url;
    for (const std::string& channel : h.channels) out += " | canal " + channel;
    out += " | janelas " + std::to_string(h.importPicks.size()) + " " + std::to_string(h.exportPicks.size());
    out += " | leituras " + std::to_string(h.fetches.size());
    out += " | registro " + std::to_string(h.port.accounts.size()) + " " + std::to_string(h.port.removes) + " " +
           std::to_string(h.port.audioCalls.size()) + " " + std::to_string(h.port.watches.size()) + " " +
           std::to_string(h.port.network.size());
    out += " | motor " + std::to_string(h.engine.made.size()) + " " + std::to_string(h.engine.answers.size()) + " " +
           std::to_string(h.engine.rejects.size()) + " " + std::to_string(h.engine.hangups.size()) + " " +
           std::to_string(h.engine.holds.size()) + " " + std::to_string(h.engine.mutes.size()) + " " +
           std::to_string(h.engine.dtmfs.size()) + " " + std::to_string(h.engine.transfers.size());
    out += " | tarefas " + std::to_string(h.time.Pending());
    return out;
}

std::string OpenExternal(const std::string& url) { return R"({"v":1,"cmd":"openExternal","url":")" + url + "\"}"; }

// Um comando e o nome dele no diagnostico (no setSetting, com a chave).
struct Named {
    const char* name;
    std::string command;
};

}  // namespace

TEST_CASE("the iPhone state carries the platform and the neutral PC fields") {
    Harness h(Platform::IPhone);
    // O que no Windows iria ao estado: os dispositivos de som que o motor ve.
    h.port.devices = {AudioDevice{0, "Microfone (Realtek)", true, false},
                      AudioDevice{1, "Alto-falantes (Realtek)", false, true}};
    const std::string id = h.StartRegistered();
    json state = h.State();   // sem const: uma chave que falta vale null (o CHECK falha, sem derrubar o teste)

    CHECK(state["plataforma"] == "ios");
    CHECK(state["agenda"] == json({{"permissao", "pendente"}, {"vez", 0}, {"quantos", 0}}));
    CHECK(state["rotaAudio"] == "");
    CHECK(state["config"] == json({{"bipeFim", true}, {"bipeTecla", true}}));
    // Os campos do PC, todos presentes, com o valor neutro (docs/ponte-windows.md, "O estado no iPhone").
    CHECK(state["atalhos"] == json::array());
    CHECK(state["contatos"] == json::array());
    CHECK(state["iniciarComWindows"] == false);
    CHECK(state["admin"] == NeutralAdmin());
    CHECK(state["entrarAdmin"] == json({{"erro", ""}, {"esperaAte", 0}, {"vez", 0}}));
    CHECK(state["empresa"] == json({{"link", ""},
                                    {"situacao", "nenhuma"},
                                    {"erro", ""},
                                    {"atualizadaEm", 0},
                                    {"quantos", 0},
                                    {"vez", 0}}));
    CHECK(state["audio"] == json({{"microfones", json::array()},
                                  {"altoFalantes", json::array()},
                                  {"microfone", ""},
                                  {"altoFalante", ""},
                                  {"toque", ""},
                                  {"desconectados", json::array()}}));
    // A conta em uso, como no Windows.
    CHECK(state["tela"] == "principal");
    CHECK(state["conta"]["id"] == id);
    CHECK(state["conta"]["status"] == "conectado");
    REQUIRE(state["contas"].size() == 1);
    CHECK(state["contas"][0]["emUso"] == true);

    // Todas as chaves de sempre e, no fim, as do iPhone, na ordem do contrato.
    for (const std::string& key : PcKeys()) {
        INFO(key);
        CHECK(state.contains(key));
    }
    CHECK(h.State().size() == PcKeys().size() + 3);   // de uma copia nova: no state acima, ler uma chave que falta a cria
    const std::string text = LastStateText(h);
    CHECK(text.find(R"("config":{"bipeFim":true,"bipeTecla":true},"empresa":)") != std::string::npos);
    const std::string end =
        R"(,"plataforma":"ios","agenda":{"permissao":"pendente","vez":0,"quantos":0},"rotaAudio":""}})";
    REQUIRE(text.size() > end.size());
    CHECK(text.substr(text.size() - end.size()) == end);

    // O ready repete o mesmo estado.
    h.posts.clear();
    h.Send(kReady);
    CHECK(h.State() == state);
}

TEST_CASE("the iPhone fields serialize with the names and values of the contract") {
    BridgeState state;
    IPhoneView iphone;
    iphone.permission = AgendaPermission::Granted;
    iphone.agendaSeq = 2;
    iphone.agendaCount = 312;
    iphone.audioRoute = "Viva-voz";
    iphone.keyBeep = false;
    state.iphone = iphone;
    const std::string text = StateMessage(state);
    CHECK(text.find(R"("config":{"bipeFim":true,"bipeTecla":false},"empresa":)") != std::string::npos);
    const std::string end =
        R"(,"plataforma":"ios","agenda":{"permissao":"concedida","vez":2,"quantos":312},"rotaAudio":"Viva-voz"}})";
    REQUIRE(text.size() > end.size());
    CHECK(text.substr(text.size() - end.size()) == end);
    state.iphone->permission = AgendaPermission::Denied;
    CHECK(json::parse(StateMessage(state))["state"]["agenda"]["permissao"] == "negada");
    state.iphone->permission = AgendaPermission::Pending;
    CHECK(json::parse(StateMessage(state))["state"]["agenda"]["permissao"] == "pendente");
    // Sem o iPhone, o estado de sempre.
    state.iphone.reset();
    const json windows = json::parse(StateMessage(state))["state"];
    CHECK(windows.size() == PcKeys().size());
    CHECK(windows["config"] == json({{"bipeFim", true}}));
}

TEST_CASE("the Windows state has none of the iPhone fields") {
    Harness h;   // o Windows: o padrao do DesktopConfig
    h.StartRegistered();
    const json state = h.State();
    for (const char* key : {"plataforma", "agenda", "rotaAudio"}) {
        INFO(key);
        CHECK_FALSE(state.contains(key));
    }
    CHECK(state["config"] == json({{"bipeFim", true}}));
    for (const std::string& key : PcKeys()) {
        INFO(key);
        CHECK(state.contains(key));
    }
    CHECK(state.size() == PcKeys().size());
    for (const std::string& post : h.posts) {
        CHECK(post.find("bipeTecla") == std::string::npos);
        CHECK(post.find("plataforma") == std::string::npos);
    }
    // Os campos do PC com o que o PC tem (o de fabrica do Iniciar com o Windows), sem os neutros do iPhone.
    CHECK(state["iniciarComWindows"] == true);
}

TEST_CASE("a new login on the iPhone keeps only that account") {
    Harness h(Platform::IPhone);
    h.Start();
    h.Send(Login("pbx.example.com", "2001", "segredo"));
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    REQUIRE(h.File("dados/contas.json")["contas"].size() == 1);
    const std::string first = h.State()["conta"]["id"];

    // Entrar com outra conta (sem contaId): enquanto ela registra, a de antes continua (e volta se o Entrar falhar).
    h.Send(Login("outro.example.com", "3001", "outra"));
    CHECK(h.File("dados/contas.json")["contas"].size() == 1);
    CHECK(h.State()["conta"]["id"] == first);
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    // Registrou: so ela fica, no contas.json e no estado.
    const json saved = h.File("dados/contas.json")["contas"];
    REQUIRE(saved.size() == 1);
    CHECK(saved[0]["servidor"] == "outro.example.com");
    CHECK(saved[0]["ramal"] == "3001");
    CHECK(saved[0]["em_uso"] == true);
    const json state = h.State();
    REQUIRE(state["contas"].size() == 1);
    const std::string second = state["contas"][0]["id"];
    CHECK(second != first);
    CHECK(state["conta"]["id"] == second);
    CHECK(state["conta"]["status"] == "conectado");
    CHECK(state["tela"] == "principal");

    // O Editar (o contaId da em uso) e o de hoje: a mesma conta, com a senha gravada e o nome novo.
    h.Send(R"({"v":1,"cmd":"login","servidor":"outro.example.com","protocolo":"udp","ramal":"3001","senha":"",)"
           R"("nome":"Filial","contaId":")" +
           second + R"("})");
    REQUIRE(h.port.accounts.size() == 3);
    CHECK(h.port.accounts.back().senha == L"outra");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    REQUIRE(h.File("dados/contas.json")["contas"].size() == 1);
    CHECK(h.State()["conta"]["id"] == second);
    CHECK(h.State()["conta"]["nome"] == "Filial");

    // Um Entrar novo que falha deixa a conta de antes, que volta a registrar.
    h.Send(Login("terceiro.example.com", "4001", "errada"));
    h.app->OnRegistration(403, false, h.port.LastId());
    h.Run();
    CHECK(h.State()["entrar"]["erro"] == "Ramal ou senha incorretos.");
    CHECK(h.File("dados/contas.json")["contas"].size() == 1);
    CHECK(h.State()["conta"]["id"] == second);
    CHECK(h.port.accounts.back().address == L"outro.example.com");

    // A proxima abertura entra na conta que ficou, ainda no modo iPhone.
    h.Restart();
    CHECK(h.State()["plataforma"] == "ios");
    CHECK(h.State()["contas"].size() == 1);
    CHECK(h.port.accounts.back().address == L"outro.example.com");

    // No Windows, o mesmo Entrar inclui a conta: as duas ficam (como hoje).
    Harness pc;
    pc.Start();
    pc.Send(Login("pbx.example.com", "2001", "segredo"));
    pc.app->OnRegistration(200, true, pc.port.LastId());
    pc.Run();
    pc.Send(Login("outro.example.com", "3001", "outra"));
    pc.app->OnRegistration(200, true, pc.port.LastId());
    pc.Run();
    CHECK(pc.File("dados/contas.json")["contas"].size() == 2);
    CHECK(pc.State()["contas"].size() == 2);
}

TEST_CASE("Sair on the iPhone is removeAccount: refused during a call, otherwise back to Entrar keeping the recents") {
    Harness h(Platform::IPhone);
    const std::string id = h.StartRegistered();
    const std::string sair = R"({"v":1,"cmd":"removeAccount","contaId":")" + id + R"("})";

    // Com uma ligacao, recusado: nada muda.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(sair);
    CHECK(h.Logged("removeAccount recusado: a conta em uso tem uma ligacao"));
    CHECK(h.port.removes == 0);
    CHECK(h.State()["tela"] == "principal");
    CHECK(h.State()["conta"]["id"] == id);
    CHECK(h.File("dados/contas.json")["contas"].size() == 1);

    // Sem ligacao: a conta desregistra e sai, e a tela volta ao Entrar.
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();
    h.Send(sair);
    CHECK(h.port.removes == 1);
    const json state = h.State();
    CHECK(state["tela"] == "entrar");
    CHECK(state["conta"].is_null());
    CHECK(state["contas"] == json::array());
    CHECK(state["entrar"]["contaId"] == "");
    CHECK(h.File("dados/contas.json")["contas"] == json::array());
    // Os Recentes ficam (spec do iPhone, 7.1), tambem na proxima abertura.
    REQUIRE(state["recentes"].size() == 1);
    CHECK(state["recentes"][0]["numero"] == "2002");
    CHECK(h.File("dados/recentes.json")["recentes"].size() == 1);
    h.Restart();
    CHECK(h.State()["tela"] == "entrar");
    CHECK(h.State()["recentes"].size() == 1);
    CHECK(h.port.accounts.size() == 1);   // nenhuma conta registrou na abertura
}

TEST_CASE("every PC command is refused on the iPhone without changing anything") {
    Harness h(Platform::IPhone);
    // Uma segunda conta no disco, para o selectAccount ter para onde trocar: o estado do iPhone so mostra a em uso.
    const std::string other = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    const std::string id = h.StartRegistered();
    REQUIRE(h.File("dados/contas.json")["contas"].size() == 2);
    REQUIRE(h.State()["contas"].size() == 1);
    CHECK(h.State()["contas"][0]["id"] == id);
    // A lista do docs/ponte-windows.md ("Os comandos do PC, recusados no iPhone"), com campos que valem.
    const std::vector<Named> commands = {
        // a janela
        {"minimize", R"({"v":1,"cmd":"minimize"})"},
        {"closeToTray", R"({"v":1,"cmd":"closeToTray"})"},
        {"resize", R"({"v":1,"cmd":"resize","borda":"cima"})"},
        {"quit", R"({"v":1,"cmd":"quit"})"},
        // as contas e o som
        {"selectAccount", R"({"v":1,"cmd":"selectAccount","contaId":")" + other + R"("})"},
        {"setAudio", R"({"v":1,"cmd":"setAudio","microfone":"Headset USB","altoFalante":"Headset USB","toque":"x"})"},
        {"setSetting iniciarComWindows", R"({"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false})"},
        // os meus contatos
        {"saveContact", R"({"v":1,"cmd":"saveContact","nome":"Ana","numero":"2002"})"},
        {"removeContact", R"({"v":1,"cmd":"removeContact","id":"c1d2e3f4a5b60718"})"},
        // os atalhos
        {"saveShortcut", R"({"v":1,"cmd":"saveShortcut","nome":"Ana","numero":"2002","acao":"ligar","blf":true})"},
        {"removeShortcut", R"({"v":1,"cmd":"removeShortcut","id":"5a1c0e9b2f3d4c67"})"},
        {"useShortcut", R"({"v":1,"cmd":"useShortcut","id":"5a1c0e9b2f3d4c67"})"},
        // a area do administrador (com a senha dos testes, que no Windows abre a area)
        {"adminLogin", R"({"v":1,"cmd":"adminLogin","senha":"senha-de-teste"})"},
        {"adminLogout", R"({"v":1,"cmd":"adminLogout"})"},
        {"adminSet", R"({"v":1,"cmd":"adminSet","naoPerturbe":false,"blf":true})"},
        // as planilhas e a lista da empresa
        {"importContacts", R"({"v":1,"cmd":"importContacts"})"},
        {"exportContacts", R"({"v":1,"cmd":"exportContacts"})"},
        {"setCompanyList", std::string(R"({"v":1,"cmd":"setCompanyList","link":")") + kCompanyLink + R"("})"},
        {"refreshCompanyList", R"({"v":1,"cmd":"refreshCompanyList"})"},
        // a atualizacao
        {"updateNow", R"({"v":1,"cmd":"updateNow"})"},
        {"updateLater", R"({"v":1,"cmd":"updateLater"})"},
    };
    for (const Named& command : commands) {
        INFO(command.name);
        const std::string before = Effects(h);
        h.logs.clear();
        h.Send(command.command);
        CHECK(Effects(h) == before);   // o mesmo estado (nenhuma mensagem), o mesmo disco, nenhum gancho
        CHECK(h.logs == std::vector<std::string>{std::string("comando recusado no modo iPhone: ") + command.name});
    }
    // A area do administrador continua fechada, e o quit recusado nao parou o app: o proximo comando roda.
    CHECK(h.State()["admin"] == NeutralAdmin());
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    CHECK(h.engine.made == std::vector<std::string>{"2003"});
}

TEST_CASE("the iPhone commands are refused on Windows") {
    Harness h;
    h.StartRegistered();
    const std::vector<Named> commands = {
        {"contactsOpened", R"({"v":1,"cmd":"contactsOpened"})"},
        {"allowContacts", R"({"v":1,"cmd":"allowContacts"})"},
        {"audioRoute", R"({"v":1,"cmd":"audioRoute"})"},
        {"keyTone", R"({"v":1,"cmd":"keyTone","tecla":"5"})"},
        {"setSetting bipeTecla", R"({"v":1,"cmd":"setSetting","chave":"bipeTecla","valor":false})"},
    };
    for (const Named& command : commands) {
        INFO(command.name);
        const std::string before = Effects(h);
        h.logs.clear();
        h.Send(command.command);
        CHECK(Effects(h) == before);
        CHECK(h.logs == std::vector<std::string>{std::string("comando recusado no modo Windows: ") + command.name});
    }
    CHECK(h.State()["config"] == json({{"bipeFim", true}}));

    // Com a area do administrador aberta, um comando do iPhone nao recomeca os 10 min: ele nao vale no Windows.
    h.Send(R"({"v":1,"cmd":"adminLogin","senha":"senha-de-teste"})");
    REQUIRE(h.State()["admin"]["aberto"] == true);
    h.time.Advance(DesktopApp::kAdminIdleMs - 1000);
    h.Run();
    h.Send(R"({"v":1,"cmd":"contactsOpened"})");
    h.time.Advance(1000);
    h.Run();
    CHECK(h.State()["admin"]["aberto"] == false);
}

TEST_CASE("the iPhone commands are read on the iPhone and, until they are wired, only leave a line") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    // O contactsOpened e o allowContacts ja chamam os ganchos (o caso "contactsOpened and allowContacts call the host
    // hooks", abaixo).
    std::vector<Named> commands = {
        {"audioRoute", R"({"v":1,"cmd":"audioRoute"})"},
        {"setSetting bipeTecla", R"({"v":1,"cmd":"setSetting","chave":"bipeTecla","valor":false})"},
    };
    for (const char key : std::string("0123456789*#")) {
        commands.push_back(Named{"keyTone", std::string(R"({"v":1,"cmd":"keyTone","tecla":")") + key + R"("})"});
    }
    for (const Named& command : commands) {
        INFO(command.command);
        const std::string before = Effects(h);
        h.logs.clear();
        h.Send(command.command);
        CHECK(Effects(h) == before);
        // So o nome do comando (nunca a tecla), e nao a linha da recusa.
        CHECK(h.logs == std::vector<std::string>{std::string("comando ainda sem efeito no iPhone: ") + command.name});
    }
    CHECK(h.State()["config"]["bipeTecla"] == true);   // o de fabrica: nada foi gravado

    // Outra tecla, ou sem ela: o comando e ignorado, como um campo errado de qualquer comando.
    for (const char* bad : {R"({"v":1,"cmd":"keyTone","tecla":"+"})", R"({"v":1,"cmd":"keyTone","tecla":"55"})",
                            R"({"v":1,"cmd":"keyTone","tecla":"a"})", R"({"v":1,"cmd":"keyTone","tecla":""})",
                            R"({"v":1,"cmd":"keyTone","tecla":5})", R"({"v":1,"cmd":"keyTone"})"}) {
        INFO(bad);
        h.logs.clear();
        h.Send(bad);
        REQUIRE(h.logs.size() == 1);
        CHECK(h.logs[0].find("comando ignorado: keyTone") == 0);
    }
}

TEST_CASE("the iPhone start does not migrate, read the company list or watch BLF") {
    Harness h(Platform::IPhone);
    // O que o disco de um PC teria: a rc.7, os meus contatos, os atalhos com o BLF, a area do administrador (o Nao
    // perturbe escondido, o BLF ligado, outra porta e o canal de teste) e a lista da empresa, com o link.
    h.files.files["rc7/StarsonicPhone.ini"] =
        "[Settings]\r\naccountId=1\r\n"
        "[Account1]\r\nlabel=1001\r\nserver=pbx.example.com:5060\r\nusername=1001\r\npassword=cifrada:segredo\r\n"
        "transport=udp\r\n";
    h.files.files["rc7/Contacts.xml"] =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<contacts>\r\n"
        "<contact name=\"Bia\" number=\"2005\" comment=\"\" />\r\n</contacts>\r\n";
    {
        ContactsStore contacts(h.files, Paths().contacts);
        Contact contact;
        contact.name = L"Ana";
        contact.number = "2002";
        REQUIRE(contacts.Save(contact));
        AtalhosStore atalhos(h.files, Paths().atalhos);
        Atalho atalho;
        atalho.nome = "Ana";
        atalho.numero = "2007";
        atalho.blf = true;
        std::string error;
        REQUIRE_FALSE(atalhos.Save(atalho, &error).empty());
        Profile profile;
        profile.account.serverPorts = {ServerPort{L"starcloud1-starsonic.com.br", 35060}};
        AdminStore admin(h.files, h.cipher, Paths().admin, profile);
        AdminConfig config = admin.Get();
        config.mostrarNaoPerturbe = false;
        config.blf = true;
        config.servidores = {ServerPort{L"pbx.example.com", 7000}};
        config.canal = "teste";
        REQUIRE(admin.Save(config, &error));
        SettingsStore settings(h.files, Paths().settings);
        Settings saved = settings.Get();
        saved.doNotDisturb = true;
        saved.bipeFim = false;
        saved.companyListLink = kCompanyLink;
        REQUIRE(settings.Save(saved));
    }
    h.SeedCompanyList({SheetContact{L"Empresa Teste", "3001", L""}}, 1761062400000LL);
    const std::map<std::string, std::string> disk = h.files.files;
    h.Start();

    // Nada no disco muda: sem a migracao (a rc.7 fica como estava), sem a lista da empresa e sem o admin.json.
    CHECK(h.files.files == disk);
    CHECK_FALSE(h.Logged("migracao"));
    CHECK(h.port.accounts.empty());   // nenhuma conta da rc.7
    // Sem a lista da empresa: nenhuma leitura, nem a de 15 min; e sem o canal de atualizacao do admin.json.
    CHECK(h.fetches.empty());
    CHECK(h.time.Pending() == 0);
    h.time.Advance(DesktopApp::kCompanyListRefreshMs);
    h.Run();
    CHECK(h.fetches.empty());
    CHECK(h.channels.empty());
    const json state = h.State();
    CHECK(state["tela"] == "entrar");
    CHECK(state["contas"] == json::array());
    CHECK(state["contatos"] == json::array());
    CHECK(state["atalhos"] == json::array());
    CHECK(state["admin"] == NeutralAdmin());
    CHECK(state["empresa"]["situacao"] == "nenhuma");
    CHECK(state["empresa"]["link"] == "");
    // O config.json vale como no Windows: o Nao perturbe (que o admin.json do PC desligaria) e o bipe do fim.
    CHECK(state["naoPerturbe"] == true);
    CHECK(state["config"]["bipeFim"] == false);

    // O Entrar registra com os servidores do perfil (nao os do admin.json), e o BLF nao e pedido.
    h.Send(Login("pbx.example.com", "2001", "segredo"));
    REQUIRE(h.port.accounts.size() == 1);
    REQUIRE(h.port.accounts[0].serverPorts.has_value());
    REQUIRE(h.port.accounts[0].serverPorts->size() == 1);
    CHECK((*h.port.accounts[0].serverPorts)[0].address == L"starcloud1-starsonic.com.br");
    CHECK((*h.port.accounts[0].serverPorts)[0].port == 35060);
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    CHECK(h.State()["conta"]["status"] == "conectado");
    CHECK(h.port.watches.empty());

    // Os nomes nao vem dos meus contatos nem da lista da empresa do PC: so o que a central mandou.
    h.Send(R"({"v":1,"cmd":"setDnd","on":false})");
    h.app->OnIncomingCall(4, "2002", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Central");
    h.app->OnCallState(4, CallState::Disconnected, 487);
    h.Run();
    h.time.Advance(1000);
    h.app->OnIncomingCall(5, "3001", "");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "");
    h.app->OnCallState(5, CallState::Disconnected, 487);
    h.Run();
    const json recentes = h.State()["recentes"];
    REQUIRE(recentes.size() == 2);
    CHECK(recentes[0]["numero"] == "3001");
    CHECK(recentes[0]["nome"] == "");
    CHECK(recentes[1]["nome"] == "Central");
    CHECK(recentes[1]["contatoId"] == "");
}

TEST_CASE("openExternal on the iPhone opens the support number and refuses the source code") {
    Harness h(Platform::IPhone);
    h.Start();
    const std::vector<std::string> allowed = {"https://starsonic.com.br", "https://starsonic.com.br/",
                                              "https://wa.me/551150603000", "tel:+551150603000"};
    for (const std::string& url : allowed) h.Send(OpenExternal(url));
    CHECK(h.opened == allowed);

    // O codigo-fonte (o Sobre do iPhone nao tem a linha), outro tel: e o resto: recusados, com a linha de sempre.
    h.opened.clear();
    h.logs.clear();
    const std::vector<std::string> refused = {"https://github.com/LucasCPena/starsonic-phone",
                                              "tel:2003",
                                              "tel:+5511999999999",
                                              "tel:+55 11 5060-3000",
                                              "tel:+551150603000 ",
                                              "TEL:+551150603000",
                                              "sip:2003",
                                              "https://example.com"};
    for (const std::string& url : refused) h.Send(OpenExternal(url));
    CHECK(h.opened.empty());
    CHECK(h.logs.size() == refused.size());
    for (const std::string& line : h.logs) CHECK(line.find("openExternal recusado") == 0);

    // No Windows, nada muda: o tel: do suporte continua recusado e o codigo-fonte abre.
    Harness pc;
    pc.Start();
    pc.Send(OpenExternal("tel:+551150603000"));
    pc.Send(OpenExternal("https://github.com/LucasCPena/starsonic-phone"));
    CHECK(pc.opened == std::vector<std::string>{"https://github.com/LucasCPena/starsonic-phone"});
}

TEST_CASE("SetAgenda sends the agenda message and the summary, and ready repeats it") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    // Sem nenhuma lista desde a abertura (vez 0): o ready nao manda a agenda, e a interface comeca vazia.
    h.posts.clear();
    h.Send(kReady);
    CHECK(h.Messages("agenda").empty());
    CHECK(h.State()["agenda"] == json({{"permissao", "pendente"}, {"vez", 0}, {"quantos", 0}}));

    // A lista do hospedeiro so vai para a fila. Nela: a mensagem agenda com a vez nova e o estado com o resumo, nessa
    // ordem, e a linha do diagnostico so com a contagem e a permissao.
    h.posts.clear();
    h.logs.clear();
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    CHECK(h.posts.empty());
    h.Run();
    REQUIRE(h.posts.size() == 2);
    CHECK(h.posts[0] == SampleAgendaMessage(1));
    CHECK(json::parse(h.posts[1])["type"] == "state");
    CHECK(h.State()["agenda"] == GrantedSummary(1));
    CHECK(h.logs == std::vector<std::string>{"agenda: 3 contatos, permissao concedida"});

    // O ready (a pagina que recarregou): o estado e, logo depois dele (antes do resto), a mesma agenda.
    h.posts.clear();
    h.Send(kReady);
    REQUIRE(h.posts.size() >= 2);
    CHECK(json::parse(h.posts[0])["type"] == "state");
    CHECK(h.posts[1] == SampleAgendaMessage(1));
    CHECK(h.Messages("agenda").size() == 1);
    CHECK(h.State()["agenda"] == GrantedSummary(1));

    // Cada lista nova sobe a vez, tambem com os mesmos contatos (a aba Contatos que abre le a agenda de novo).
    h.posts.clear();
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.Run();
    REQUIRE(h.posts.size() == 2);
    CHECK(h.posts[0] == SampleAgendaMessage(2));
    CHECK(h.State()["agenda"] == GrantedSummary(2));

    // No Windows, nada: nenhuma mensagem, o estado de sempre (sem a agenda, tambem nos nomes) e a linha no diagnostico.
    Harness pc;
    pc.StartRegistered();
    pc.posts.clear();
    pc.logs.clear();
    pc.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    pc.Run();
    CHECK(pc.posts.empty());
    CHECK(pc.logs == std::vector<std::string>{"agenda: recusada no modo Windows"});
    pc.Send(kReady);
    CHECK(pc.Messages("agenda").empty());
    CHECK_FALSE(pc.State().contains("agenda"));
    pc.app->OnIncomingCall(4, "011988887777", "Central");
    pc.Run();
    CHECK(pc.State()["ligacao"]["top"]["name"] == "Central");
}

TEST_CASE("the agenda names the incoming call, the recents and the missed call") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.engine.nextCallId = 100;   // a feita, longe dos ids das recebidas
    // Uma perdida antes da agenda: o nome da central nos Recentes, e o numero no aviso.
    h.app->OnIncomingCall(4, "011988887777", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Central");
    h.time.Advance(1000);
    h.app->OnCallState(4, CallState::Disconnected, 487);
    h.Run();
    CHECK(LastToast(h) == "Liga\xc3\xa7\xc3\xa3o perdida de 011988887777");
    CHECK(h.State()["recentes"][0]["nome"] == "Central");

    // A agenda chega: os Recentes de antes ja mostram o nome dela (procurado a cada estado), com o contatoId "".
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.Run();
    CHECK(h.State()["recentes"][0]["nome"] == "Ana Souza");
    CHECK(h.State()["recentes"][0]["contatoId"] == "");

    // A recebida em cada formato que a central manda (o celular gravado "+55 11 98888-7777"): o nome da agenda na tela,
    // no aviso da perdida e nos Recentes.
    int id = 5;
    for (const char* sent : {"011988887777", "11988887777", "988887777", "+5511988887777"}) {
        INFO(sent);
        h.time.Advance(1000);
        h.app->OnIncomingCall(id, sent, "Central");
        h.Run();
        CHECK(h.State()["ligacao"]["top"]["name"] == "Ana Souza");
        h.time.Advance(1000);
        h.app->OnCallState(id, CallState::Disconnected, 487);
        h.Run();
        CHECK(LastToast(h) == kMissedAna);
        const json recent = h.State()["recentes"][0];
        CHECK(recent["numero"] == sent);
        CHECK(recent["nome"] == "Ana Souza");
        CHECK(recent["tipo"] == "perdida");
        CHECK(recent["contatoId"] == "");
        ++id;
    }

    // O ramal curto so bate com o mesmo numero: o 2003 da Ana sim (aqui atendida); um fixo terminado em 2003, nao.
    h.time.Advance(1000);
    h.app->OnIncomingCall(id, "2003", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Ana Souza");
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(id, CallState::Confirmed, 200);
    h.time.Advance(1000);
    h.app->OnCallState(id, CallState::Disconnected, 200);
    h.Run();
    CHECK(h.State()["recentes"][0]["tipo"] == "recebida");
    CHECK(h.State()["recentes"][0]["nome"] == "Ana Souza");
    ++id;
    h.time.Advance(1000);
    h.app->OnIncomingCall(id, "1133332003", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Central");
    h.app->OnCallState(id, CallState::Disconnected, 487);
    h.Run();
    CHECK(h.State()["recentes"][0]["nome"] == "Central");
    ++id;

    // O contato sem nome nao da nome: vale o da central (e o numero no aviso).
    h.time.Advance(1000);
    h.app->OnIncomingCall(id, "21977776666", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Central");
    h.app->OnCallState(id, CallState::Disconnected, 487);
    h.Run();
    CHECK(LastToast(h) == "Liga\xc3\xa7\xc3\xa3o perdida de 21977776666");

    // A feita para um numero da agenda, como a aba Contatos manda (contato: true): o nome na tela e nos Recentes.
    h.time.Advance(1000);
    h.Send(R"({"v":1,"cmd":"dial","numero":"(11) 3333-4040","contato":true})");
    CHECK(h.State()["ligacao"]["top"]["name"] == "\xc3\x89lcio Matos");
    h.app->OnCallState(100, CallState::Disconnected, 486);
    h.Run();
    CHECK(h.State()["recentes"][0]["tipo"] == "feita");
    CHECK(h.State()["recentes"][0]["nome"] == "\xc3\x89lcio Matos");
}

TEST_CASE("denied then granted shows the list without restarting") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    // A aba Contatos abre: o hospedeiro le a agenda e pede a permissao; a pessoa nega. Fora da concedida, a lista e
    // vazia, tambem se o hospedeiro mandar os contatos.
    h.Send(kContactsOpened);
    CHECK(h.host == std::vector<std::string>{"readAgenda"});
    h.app->SetAgenda(AgendaPermission::Denied, SampleAgenda());
    h.Run();
    CHECK(h.State()["agenda"] == json({{"permissao", "negada"}, {"vez", 1}, {"quantos", 0}}));
    CHECK(LastAgenda(h) == json({{"v", 1}, {"type", "agenda"}, {"vez", 1}, {"contatos", json::array()}}));
    // Sem a permissao, nenhum nome vem da agenda.
    h.app->OnIncomingCall(4, "011988887777", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Central");
    h.time.Advance(1000);
    h.app->OnCallState(4, CallState::Disconnected, 487);
    h.Run();
    CHECK(h.State()["recentes"][0]["nome"] == "Central");

    // O Permitir: o hospedeiro abre os Ajustes do iPhone. A pessoa da a permissao e volta ao app, e o hospedeiro manda
    // a lista: a aba mostra a lista e os nomes valem, no mesmo app (sem abrir de novo).
    h.Send(kAllowContacts);
    CHECK(h.host == std::vector<std::string>{"readAgenda", "allowContacts"});
    h.posts.clear();
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.Run();
    REQUIRE(h.posts.size() == 2);
    CHECK(h.posts[0] == SampleAgendaMessage(2));
    CHECK(h.State()["agenda"] == GrantedSummary(2));
    CHECK(h.State()["recentes"][0]["nome"] == "Ana Souza");
    h.time.Advance(1000);
    h.app->OnIncomingCall(5, "011988887777", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Ana Souza");
    h.app->OnCallState(5, CallState::Disconnected, 487);
    h.Run();
    // A pagina que recarrega recebe a lista de agora; nada recomecou (a conta registrou uma vez so).
    h.posts.clear();
    h.Send(kReady);
    REQUIRE(h.posts.size() >= 2);
    CHECK(h.posts[1] == SampleAgendaMessage(2));
    CHECK(h.port.accounts.size() == 1);

    // A permissao tirada de novo nos Ajustes: a lista sai, e os nomes voltam a ser os da central.
    h.app->SetAgenda(AgendaPermission::Denied, {});
    h.Run();
    CHECK(h.State()["agenda"] == json({{"permissao", "negada"}, {"vez", 3}, {"quantos", 0}}));
    CHECK(h.State()["recentes"][0]["nome"] == "Central");
}

TEST_CASE("contactsOpened and allowContacts call the host hooks") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    const size_t posts = h.posts.size();
    const std::map<std::string, std::string> disk = h.files.files;
    h.logs.clear();
    // A cada vez que a aba Contatos abre, o hospedeiro le a agenda; o Permitir pede a permissao (ou abre os Ajustes).
    h.Send(kContactsOpened);
    CHECK(h.host == std::vector<std::string>{"readAgenda"});
    h.Send(kContactsOpened);
    h.Send(kAllowContacts);
    CHECK(h.host == std::vector<std::string>{"readAgenda", "readAgenda", "allowContacts"});
    // So os ganchos (a resposta vem pelo SetAgenda): o estado e o disco ficam como estavam, e o diagnostico sem linha.
    CHECK(h.posts.size() == posts);
    CHECK(h.files.files == disk);
    CHECK(h.logs.empty());

    // No Windows, recusados: nenhum gancho.
    Harness pc;
    pc.StartRegistered();
    pc.Send(kContactsOpened);
    pc.Send(kAllowContacts);
    CHECK(pc.host.empty());
    CHECK(pc.Logged("comando recusado no modo Windows: contactsOpened"));
    CHECK(pc.Logged("comando recusado no modo Windows: allowContacts"));
}

TEST_CASE("the diagnostics never carry agenda names or numbers") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.engine.nextCallId = 100;
    // Tudo o que passa pela agenda: as tres permissoes, os dois comandos, o ready, os nomes numa perdida, numa atendida
    // e numa feita, e os Recentes.
    for (const AgendaPermission permission :
         {AgendaPermission::Pending, AgendaPermission::Denied, AgendaPermission::Granted}) {
        h.app->SetAgenda(permission, SampleAgenda());
    }
    h.Run();
    h.Send(kContactsOpened);
    h.Send(kAllowContacts);
    h.Send(kReady);
    h.app->OnIncomingCall(4, "011988887777", "Central");
    h.Run();
    h.time.Advance(1000);
    h.app->OnCallState(4, CallState::Disconnected, 487);
    h.Run();
    h.app->OnIncomingCall(5, "2003", "Central");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(5, CallState::Confirmed, 200);
    h.app->OnCallState(5, CallState::Disconnected, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"(11) 3333-4040","contato":true})");
    h.app->OnCallState(100, CallState::Disconnected, 486);
    h.Run();
    h.Send(R"({"v":1,"cmd":"viewRecents"})");
    const json recentes = h.State()["recentes"];
    REQUIRE(recentes.size() == 3);
    CHECK(recentes[2]["nome"] == "Ana Souza");   // os nomes foram a interface

    // O diagnostico so com a contagem e a permissao.
    CHECK(h.Logged("agenda: 0 contatos, permissao pendente"));
    CHECK(h.Logged("agenda: 0 contatos, permissao negada"));
    CHECK(h.Logged("agenda: 3 contatos, permissao concedida"));
    const std::vector<std::string> agenda = {"Ana",  "Souza", "\xc3\x89lcio", "Matos", "Sem Numero", "98888",
                                             "7777", "2003",  "97777",        "6666",  "3333",       "4040"};
    for (const std::string& line : h.logs) {
        INFO(line);
        for (const std::string& part : agenda) CHECK(line.find(part) == std::string::npos);
    }
    // E os nomes da agenda nao vao ao disco (spec do iPhone, 6.4: so na memoria): os Recentes guardam o da central.
    for (const auto& file : h.files.files) {
        INFO(file.first);
        for (const char* name : {"Ana", "\xc3\x89lcio", "Matos", "Sem Numero"}) {
            CHECK(file.second.find(name) == std::string::npos);
        }
    }
}
