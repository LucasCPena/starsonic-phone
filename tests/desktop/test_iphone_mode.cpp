// Testes do modo iPhone do nucleo (docs/ponte-windows.md, "O modo iPhone"; spec do iPhone, 4.2, 6.1, 6.4, 7.1 e 7.7 a
// 7.9): o estado com a plataforma e os campos do PC neutros, a conta unica, o Sair, os comandos do PC recusados no
// iPhone e os do iPhone recusados no Windows, a abertura sem as partes do PC, o openExternal do iPhone, a agenda (a
// mensagem, os nomes nas ligacoes, a permissao, os ganchos e o diagnostico sem os contatos), os bipes (o bipeTecla, o
// keyTone e o bipe do fim), a rota de audio, a perdida, o abrir dos Recentes e o ready sem toque nem atualizacao.
#include <algorithm>
#include <map>
#include <string>
#include <utility>
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

TEST_CASE("the iPhone start leaves only the account in use in contas.json") {
    // Um contas.json com outra conta (a limpeza de um Entrar que o disco recusou): a abertura a tira, sem registra-la,
    // e o diagnostico ganha uma linha so com a quantidade.
    Harness h(Platform::IPhone);
    h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    const std::string id = h.StartRegistered();
    const json saved = h.File("dados/contas.json")["contas"];
    REQUIRE(saved.size() == 1);
    CHECK(saved[0]["id"] == id);
    CHECK(h.port.accounts.size() == 1);   // so a em uso registrou
    CHECK(h.Logged("contas.json: contas fora de uso tiradas na abertura: 1"));
    for (const std::string& line : h.logs) {
        INFO(line);
        CHECK(line.find("outro.example.com") == std::string::npos);
        CHECK(line.find("3001") == std::string::npos);
    }
    // Sem conta em uso, nenhuma fica (o Entrar e a tela).
    Harness none(Platform::IPhone);
    none.SeedAccount(L"pbx.example.com", L"2001", L"segredo", false);
    none.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    none.Start();
    CHECK(none.File("dados/contas.json")["contas"] == json::array());
    CHECK(none.State()["tela"] == "entrar");
    CHECK(none.port.accounts.empty());
    CHECK(none.Logged("contas.json: contas fora de uso tiradas na abertura: 2"));

    // No Windows, as duas ficam (a lista de contas, como hoje).
    Harness pc;
    pc.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    pc.StartRegistered();
    CHECK(pc.File("dados/contas.json")["contas"].size() == 2);
    CHECK(pc.State()["contas"].size() == 2);
    CHECK_FALSE(pc.Logged("fora de uso"));
}

TEST_CASE("Sair on the iPhone goes back to Entrar even with another account left in contas.json") {
    // A outra conta ficou no contas.json: o disco recusou a limpeza da abertura (o mesmo que deixa a de um Entrar).
    Harness h(Platform::IPhone);
    h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    const std::string id = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    h.files.failWrites = true;
    h.Start();
    h.files.failWrites = false;
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    REQUIRE(h.File("dados/contas.json")["contas"].size() == 2);
    REQUIRE(h.State()["conta"]["id"] == id);
    REQUIRE(h.port.accounts.size() == 1);

    // O Sair da em uso: ela desregistra e sai, e a tela volta ao Entrar vazio; a outra nao registra.
    h.Send(R"({"v":1,"cmd":"removeAccount","contaId":")" + id + R"("})");
    CHECK(h.port.removes == 1);
    CHECK(h.port.accounts.size() == 1);
    const json state = h.State();
    CHECK(state["tela"] == "entrar");
    CHECK(state["conta"].is_null());
    CHECK(state["contas"] == json::array());
    CHECK(state["entrar"]["contaId"] == "");
    CHECK(state["entrar"]["servidor"] == "");
    CHECK(state["entrar"]["ramal"] == "");
    // A proxima abertura tira a outra, e nada registra.
    h.Restart();
    CHECK(h.File("dados/contas.json")["contas"] == json::array());
    CHECK(h.State()["tela"] == "entrar");
    CHECK(h.port.accounts.size() == 1);

    // No Windows, o mesmo Sair troca para a outra conta, como hoje.
    Harness pc;
    const std::string other = pc.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    const std::string pcId = pc.StartRegistered();
    pc.Send(R"({"v":1,"cmd":"removeAccount","contaId":")" + pcId + R"("})");
    CHECK(pc.State()["tela"] == "principal");
    CHECK(pc.State()["conta"]["id"] == other);
    REQUIRE(pc.port.accounts.size() == 2);
    CHECK(pc.port.accounts.back().address == L"outro.example.com");
}

TEST_CASE("every PC command is refused on the iPhone without changing anything") {
    Harness h(Platform::IPhone);
    // Uma segunda conta no disco, para o selectAccount ter para onde trocar (ela fica porque o disco recusou a limpeza
    // da abertura): o estado do iPhone so mostra a em uso.
    const std::string other = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    const std::string id = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    h.files.failWrites = true;
    h.Start();
    h.files.failWrites = false;
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
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

TEST_CASE("transfer and consult with contato reach the engine with the text of dial with contato") {
    // O Transferir e o Consultar de uma sugestao da agenda (a interface manda o contato: true so no iPhone; o nucleo o
    // aceita dos dois): o numero passa pela mesma regra do dial com contato: true. Sem o contato, como hoje.
    for (const Platform platform : {Platform::IPhone, Platform::Windows}) {
        const char* const mode = platform == Platform::IPhone ? "iPhone" : "Windows";
        INFO(mode);
        Harness h(platform);
        h.StartRegistered();
        // O dial com contato: true do celular da agenda: o +55 sai (o perfil dos testes nao tem o prefixo de saida).
        h.Send(R"({"v":1,"cmd":"dial","numero":"+55 11 98888-7777","contato":true})");
        REQUIRE(h.engine.made.size() == 1);
        const std::string viaDial = h.engine.made[0];
        CHECK(viaDial == "11988887777");
        h.app->OnCallState(10, CallState::Confirmed, 200);
        h.Run();

        // O Consultar: o celular com o contato, o ramal com o contato e o celular sem ele (cada colega cancelado antes
        // do proximo; o cliente volta sozinho).
        int colleague = 11;
        for (const char* consult : {R"({"v":1,"cmd":"consult","numero":"+55 11 98888-7777","contato":true})",
                                    R"({"v":1,"cmd":"consult","numero":"2001","contato":true})",
                                    R"({"v":1,"cmd":"consult","numero":"+55 11 98888-7777"})"}) {
            INFO(consult);
            h.Send(consult);
            REQUIRE(h.State()["ligacao"]["consulting"] == true);
            h.Send(R"({"v":1,"cmd":"cancelConsult"})");
            h.app->OnCallState(colleague++, CallState::Disconnected, 487);
            h.Run();
        }
        CHECK(h.engine.made == std::vector<std::string>{viaDial, viaDial, "2001", "+5511988887777"});

        // O Transferir agora, do mesmo jeito (a central recusa cada um: a ligacao continua para o proximo).
        for (const char* transfer : {R"({"v":1,"cmd":"transfer","numero":"+55 11 98888-7777","contato":true})",
                                     R"({"v":1,"cmd":"transfer","numero":"2001","contato":true})",
                                     R"({"v":1,"cmd":"transfer","numero":"+55 11 98888-7777"})"}) {
            h.Send(transfer);
            h.app->OnTransfer(10, 486);
            h.Run();
        }
        std::vector<std::string> transfers;   // "<id> <numero>"
        for (const auto& asked : h.engine.transfers) {
            transfers.push_back(std::to_string(asked.first) + " " + asked.second);
        }
        CHECK(transfers == std::vector<std::string>{"10 " + viaDial, "10 2001", "10 +5511988887777"});
    }
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
    // a lista: a aba mostra a lista e os nomes valem, no mesmo app (sem abrir de novo). (A perdida de antes tambem foi
    // ao hospedeiro, no aviso do iPhone: com o numero, sem a permissao.)
    h.Send(kAllowContacts);
    CHECK(h.host == std::vector<std::string>{"readAgenda", "missedCall Liga\xc3\xa7\xc3\xa3o perdida de 011988887777",
                                             "allowContacts"});
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

// Os bipes, a rota de audio, a perdida e o abrir dos Recentes (spec do iPhone, 7.7 a 7.9).
namespace {

// A mensagem abrir do toque no aviso da perdida, no texto exato do contrato.
std::string OpenRecentsText() { return R"({"v":1,"type":"abrir","tela":"recentes"})"; }

std::string KeyTone(const std::string& key) { return R"({"v":1,"cmd":"keyTone","tecla":")" + key + R"("})"; }

std::string SetBipeTecla(bool on) {
    return std::string(R"({"v":1,"cmd":"setSetting","chave":"bipeTecla","valor":)") + (on ? "true" : "false") + "}";
}

// "Ligacao perdida de <quem>": o texto do aviso de 2 s, que o controlador monta.
std::string Missed(const std::string& who) { return "Liga\xc3\xa7\xc3\xa3o perdida de " + who; }

// Quantas vezes o gancho foi chamado (o registro dele no h.host).
size_t Calls(const Harness& h, const std::string& call) {
    return static_cast<size_t>(std::count(h.host.begin(), h.host.end(), call));
}

// Os textos do aviso da perdida do iPhone (o gancho missedCall), na ordem.
std::vector<std::string> MissedCalls(const Harness& h) {
    const std::string prefix = "missedCall ";
    std::vector<std::string> out;
    for (const std::string& call : h.host) {
        if (call.compare(0, prefix.size(), prefix) == 0) out.push_back(call.substr(prefix.size()));
    }
    return out;
}

// Os tipos das mensagens para a interface, a partir da de indice from, na ordem.
std::vector<std::string> TypesSince(const Harness& h, size_t from) {
    std::vector<std::string> out;
    for (size_t i = from; i < h.posts.size(); ++i) out.push_back(json::parse(h.posts[i])["type"]);
    return out;
}

}  // namespace

TEST_CASE("bipeTecla is on by default, survives a restart and setSetting changes it") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    CHECK(h.State()["config"] == json({{"bipeFim", true}, {"bipeTecla", true}}));   // de fabrica, ligado

    // O setSetting o desliga: o estado e o config.json (bipe_tecla), sem mexer no bipe do fim, sem gancho e sem linha
    // no diagnostico.
    h.logs.clear();
    h.Send(SetBipeTecla(false));
    CHECK(h.State()["config"] == json({{"bipeFim", true}, {"bipeTecla", false}}));
    CHECK(h.File("dados/config.json")["bipe_tecla"] == false);
    CHECK(h.File("dados/config.json")["bipe_fim"] == true);
    CHECK(h.host.empty());
    CHECK(h.logs.empty());

    // A proxima abertura le o config.json: continua desligado. O bipeFim e outra chave.
    h.Restart();
    CHECK(h.State()["config"] == json({{"bipeFim", true}, {"bipeTecla", false}}));
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":false})");
    CHECK(h.State()["config"] == json({{"bipeFim", false}, {"bipeTecla", false}}));
    CHECK(h.File("dados/config.json")["bipe_tecla"] == false);

    // Ligado de novo, tambem na abertura seguinte.
    h.Send(SetBipeTecla(true));
    CHECK(h.File("dados/config.json")["bipe_tecla"] == true);
    h.Restart();
    CHECK(h.State()["config"] == json({{"bipeFim", false}, {"bipeTecla", true}}));

    // Desligado, e depois o config.json sem a chave (o de antes desta versao) ou com um valor que nao e booleano:
    // ligado.
    h.Send(SetBipeTecla(false));
    json config = h.File("dados/config.json");
    REQUIRE(config["bipe_tecla"] == false);
    config.erase("bipe_tecla");
    h.files.files["dados/config.json"] = config.dump();
    h.Restart();
    CHECK(h.State()["config"]["bipeTecla"] == true);
    config["bipe_tecla"] = "desligado";
    h.files.files["dados/config.json"] = config.dump();
    h.Restart();
    CHECK(h.State()["config"]["bipeTecla"] == true);
}

TEST_CASE("keyTone calls the host only with bipeTecla, with inCall during a call") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    // Sem ligacao: cada tecla vai ao hospedeiro (inCall false), e so isso: nenhuma mensagem, nada no disco, nenhum dtmf
    // e nenhuma linha no diagnostico (as teclas sao o numero que a pessoa digita).
    const std::string before = Effects(h);
    h.logs.clear();
    std::vector<std::string> beeps;
    for (const char key : std::string("0123456789*#")) {
        h.Send(KeyTone(std::string(1, key)));
        beeps.push_back(std::string("keyTone ") + key);
    }
    CHECK(h.host == beeps);
    h.host.clear();
    CHECK(Effects(h) == before);
    CHECK(h.logs.empty());

    // Com uma ligacao (a feita chamando, e depois em andamento), inCall true. O dtmf e o comando de sempre: o bipe nao
    // manda nada ao motor.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.Send(KeyTone("1"));
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dtmf","digitos":"5"})");
    h.Send(KeyTone("5"));
    CHECK(h.host == std::vector<std::string>{"keyTone 1 na ligacao", "keyTone 5 na ligacao"});
    CHECK(h.engine.dtmfs == std::vector<std::pair<int, std::string>>{{10, "5"}});
    // A ligacao acabou: fora dela de novo.
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();
    h.host.clear();
    h.Send(KeyTone("2"));
    CHECK(h.host == std::vector<std::string>{"keyTone 2"});

    // Com o bipeTecla desligado, nenhum bipe (a interface que ainda nao viu o estado novo), tambem na ligacao.
    h.Send(SetBipeTecla(false));
    h.host.clear();
    h.logs.clear();
    h.Send(KeyTone("3"));
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    h.Send(KeyTone("4"));
    CHECK(h.host.empty());
    CHECK(h.logs.empty());
    h.app->OnCallState(11, CallState::Disconnected, 486);
    h.Run();
    // Ligado de novo, volta.
    h.Send(SetBipeTecla(true));
    h.host.clear();
    h.Send(KeyTone("#"));
    CHECK(h.host == std::vector<std::string>{"keyTone #"});

    // Outra tecla, ou sem ela: recusada na leitura do comando, com a linha de sempre (sem a tecla) e sem o bipe.
    const std::string badKey = "comando ignorado: keyTone: a tecla precisa ser de 0 a 9, * ou #";
    const std::vector<std::pair<std::string, std::string>> refused = {
        {KeyTone("+"), badKey},
        {KeyTone("55"), badKey},
        {KeyTone("a"), badKey},
        {KeyTone(""), badKey},
        {KeyTone("5 "), badKey},
        {R"({"v":1,"cmd":"keyTone","tecla":5})", "comando ignorado: keyTone: o campo tecla precisa ser texto"},
        {R"({"v":1,"cmd":"keyTone"})", "comando ignorado: keyTone: falta o campo tecla"},
    };
    h.host.clear();
    for (const auto& command : refused) {
        INFO(command.first);
        h.logs.clear();
        h.Send(command.first);
        CHECK(h.logs == std::vector<std::string>{command.second});
    }
    CHECK(h.host.empty());
}

TEST_CASE("the end beep goes to the host hook, not to a ring message") {
    // A regra do ring fim do Windows ("the end beep plays only for answered calls with no other call left"), com o
    // gancho no lugar da mensagem.
    Harness h(Platform::IPhone);
    h.StartRegistered();
    // A feita que nao completou, a recebida perdida e a recusada: nada.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Disconnected, 486);
    h.app->OnIncomingCall(20, "2003", "");
    h.app->OnCallState(20, CallState::Disconnected, 487);
    h.app->OnIncomingCall(21, "2003", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"reject"})");
    h.app->OnCallState(21, CallState::Disconnected, 486);
    h.Run();
    CHECK(Calls(h, "endBeep") == 0);

    // A atendida acaba com a segunda tocando: nada; a segunda e perdida: nada.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(11, CallState::Confirmed, 200);
    h.app->OnIncomingCall(22, "2004", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"hangup","id":11})");
    h.app->OnCallState(11, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 0);
    h.app->OnCallState(22, CallState::Disconnected, 487);
    h.Run();
    CHECK(Calls(h, "endBeep") == 0);

    // A atendida que acaba sem outra: o bipe vai ao hospedeiro, pela fila de comandos (nunca na thread do motor).
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(12, CallState::Confirmed, 200);
    h.Run();
    h.app->OnCallState(12, CallState::Disconnected, 200);
    CHECK(Calls(h, "endBeep") == 0);
    h.Run();
    CHECK(Calls(h, "endBeep") == 1);

    // Duas atendidas: a primeira que acaba nao bipa (a outra continua); a ultima, sim.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(13, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2005"})");
    h.app->OnCallState(14, CallState::Confirmed, 200);
    h.Run();
    h.app->OnCallState(14, CallState::Disconnected, 200);   // o outro lado desligou
    h.Run();
    CHECK(Calls(h, "endBeep") == 1);
    h.Send(R"({"v":1,"cmd":"hangup","id":13})");          // a propria pessoa desligou
    h.app->OnCallState(13, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 2);

    // A conferencia: as duas acabam juntas, um bipe so.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(15, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2005"})");
    h.app->OnCallState(16, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"join"})");
    h.Send(R"({"v":1,"cmd":"hangup"})");
    h.app->OnCallState(15, CallState::Disconnected, 200);
    h.app->OnCallState(16, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 3);

    // A recebida atendida tambem bipa; o bipe nao volta no ready.
    h.app->OnIncomingCall(23, "2006", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(23, CallState::Confirmed, 200);
    h.app->OnCallState(23, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 4);
    h.Send(kReady);
    CHECK(Calls(h, "endBeep") == 4);

    // O bipeTecla nao cala o bipe do fim; o bipeFim desligado, sim.
    h.Send(SetBipeTecla(false));
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(17, CallState::Confirmed, 200);
    h.app->OnCallState(17, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 5);
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":false})");
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(18, CallState::Confirmed, 200);
    h.app->OnCallState(18, CallState::Disconnected, 200);
    h.Run();
    CHECK(Calls(h, "endBeep") == 5);

    // Nenhuma mensagem ring chegou a interface, nem a do fim.
    CHECK(h.Messages("ring").empty());
}

TEST_CASE("no ring message reaches the interface on the iPhone") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.Run();
    // A recebida toca (no Windows, o ring completo): quem toca e a tela de chamada do iPhone.
    h.app->OnIncomingCall(4, "2002", "Fulano");
    h.Run();
    REQUIRE(h.State()["ligacao"]["top"]["phase"] == "ringing");
    // O ready com ela tocando: o estado e a agenda, nada de toque.
    size_t from = h.posts.size();
    h.Send(kReady);
    CHECK(TypesSince(h, from) == std::vector<std::string>{"state", "agenda"});
    CHECK(h.State()["ligacao"]["top"]["phase"] == "ringing");

    // Atendida, e uma segunda toca (no Windows, o ring espera); o ready de novo.
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(4, CallState::Confirmed, 200);
    h.app->OnIncomingCall(5, "2003", "");
    h.Run();
    REQUIRE(h.State()["ligacao"]["secondKind"] == "ringing");
    from = h.posts.size();
    h.Send(kReady);
    CHECK(TypesSince(h, from) == std::vector<std::string>{"state", "agenda"});

    // A segunda recusada e a primeira desligada (no Windows, o ring parar), e o ready sem ligacao.
    h.Send(R"({"v":1,"cmd":"reject"})");
    h.app->OnCallState(5, CallState::Disconnected, 486);
    h.Send(R"({"v":1,"cmd":"hangup"})");
    h.app->OnCallState(4, CallState::Disconnected, 200);
    h.Run();
    CHECK(h.State()["ligacao"].is_null());
    from = h.posts.size();
    h.Send(kReady);
    CHECK(TypesSince(h, from) == std::vector<std::string>{"state", "agenda"});

    // Em nenhum momento um ring: nem o completo, nem o espera, nem o parar.
    CHECK(h.Messages("ring").empty());
}

TEST_CASE("SetAudioRoute changes rotaAudio and audioRoute asks the host") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    CHECK(h.State()["rotaAudio"] == "");   // sem saber
    // O botao Audio da ligacao: o hospedeiro mostra a escolha do iPhone, e so (a saida escolhida volta pelo
    // SetAudioRoute): nenhuma mensagem.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    const size_t posts = h.posts.size();
    h.logs.clear();
    h.Send(R"({"v":1,"cmd":"audioRoute"})");
    CHECK(h.host == std::vector<std::string>{"chooseAudioRoute"});
    CHECK(h.posts.size() == posts);

    // A saida que a pessoa escolheu (ou a trocada fora do app) so vai para a fila; nela, o estado com a rotaAudio.
    h.app->SetAudioRoute("Viva-voz");
    CHECK(h.posts.size() == posts);
    h.Run();
    REQUIRE(h.posts.size() == posts + 1);
    CHECK(h.State()["rotaAudio"] == "Viva-voz");
    // A mesma de novo: nada sai.
    h.app->SetAudioRoute("Viva-voz");
    h.Run();
    CHECK(h.posts.size() == posts + 1);
    // Um fone que liga, o alto-falante do ouvido e "" (sem saber).
    for (const char* route : {"Fone de Teste", "iPhone", ""}) {
        h.app->SetAudioRoute(route);
        h.Run();
        CHECK(h.State()["rotaAudio"] == route);
    }
    // Nenhuma linha no diagnostico: nem a do botao, nem a da saida (o nome de um fone pode levar o nome de uma pessoa).
    CHECK(h.logs.empty());

    // Sem ligacao tambem; a rota so fica na memoria: nada no disco, e a proxima abertura nao sabe a saida ate o
    // hospedeiro mandar.
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();
    h.app->SetAudioRoute("Fone de Teste");
    h.Run();
    CHECK(h.State()["rotaAudio"] == "Fone de Teste");
    for (const auto& file : h.files.files) {
        INFO(file.first);
        CHECK(file.second.find("Fone de Teste") == std::string::npos);
        CHECK(file.second.find("Viva-voz") == std::string::npos);
    }
    h.Restart();
    CHECK(h.State()["rotaAudio"] == "");

    // No Windows, nada: nenhuma mensagem, o estado sem a rotaAudio, e a linha no diagnostico.
    Harness pc;
    pc.StartRegistered();
    const std::string before = Effects(pc);
    pc.logs.clear();
    pc.app->SetAudioRoute("Viva-voz");
    pc.Run();
    CHECK(Effects(pc) == before);
    CHECK(pc.logs == std::vector<std::string>{"rota de audio: recusada no modo Windows"});
    CHECK_FALSE(pc.State().contains("rotaAudio"));
}

TEST_CASE("a missed call calls missedCall with the text, but not with do not disturb") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.engine.nextCallId = 100;   // a feita, longe dos ids das recebidas
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.Run();
    // Quem ligou desistiu: o aviso de 2 s, como hoje, e o aviso do iPhone com o mesmo texto (com o nome da agenda),
    // pela fila de comandos (nunca na thread do motor).
    h.app->OnIncomingCall(4, "011988887777", "Central");
    h.Run();
    h.time.Advance(1000);
    h.app->OnCallState(4, CallState::Disconnected, 487);
    CHECK(MissedCalls(h).empty());
    h.Run();
    CHECK(LastToast(h) == kMissedAna);
    CHECK(MissedCalls(h) == std::vector<std::string>{kMissedAna});

    // Sem o nome da agenda, o numero: o mesmo texto do aviso de 2 s.
    h.time.Advance(1000);
    h.app->OnIncomingCall(5, "3001", "Central");
    h.Run();
    h.app->OnCallState(5, CallState::Disconnected, 487);
    h.Run();
    CHECK(LastToast(h) == Missed("3001"));
    CHECK(MissedCalls(h) == std::vector<std::string>{kMissedAna, Missed("3001")});

    // Ocupado com outra ligacao: a que chega com a feita ainda chamando, e a que o motor recusou sozinho.
    h.time.Advance(1000);
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnIncomingCall(6, "2003", "Central");
    h.Run();
    CHECK(h.engine.rejects == std::vector<int>{6});
    h.app->OnRejectedBusy("21977776666", "Central");
    h.Run();
    CHECK(MissedCalls(h) == std::vector<std::string>{kMissedAna, Missed("3001"), kMissedAna, Missed("21977776666")});
    h.app->OnCallState(100, CallState::Disconnected, 486);
    h.Run();

    // A atendida e a recusada pela pessoa: nenhum aviso.
    h.time.Advance(1000);
    h.app->OnIncomingCall(7, "2003", "Central");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(7, CallState::Confirmed, 200);
    h.app->OnCallState(7, CallState::Disconnected, 200);
    h.app->OnIncomingCall(8, "2003", "Central");
    h.Run();
    h.Send(R"({"v":1,"cmd":"reject"})");
    h.app->OnCallState(8, CallState::Disconnected, 486);
    h.Run();
    CHECK(MissedCalls(h).size() == 4);

    // Com o Nao perturbe: ocupado, e a perdida nos Recentes, sem tocar e sem aviso (nem o de 2 s, nem o do iPhone),
    // tambem a que o motor recusou sozinho.
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    const size_t toasts = h.Toasts().size();
    const size_t recents = h.State()["recentes"].size();
    h.time.Advance(1000);
    h.app->OnIncomingCall(9, "011988887777", "Central");
    h.Run();
    CHECK(h.engine.rejects == std::vector<int>{6, 8, 9});   // o ocupado, a recusada pela pessoa e o Nao perturbe
    CHECK(h.State()["ligacao"].is_null());
    h.app->OnRejectedBusy("011988887777", "Central");
    h.Run();
    const json state = h.State();
    REQUIRE(state["recentes"].size() == recents + 2);
    CHECK(state["recentes"][0]["tipo"] == "perdida");
    CHECK(state["recentes"][1]["tipo"] == "perdida");
    CHECK(h.Toasts().size() == toasts);
    CHECK(MissedCalls(h).size() == 4);

    // A que ja tocava quando o Nao perturbe ligou continua tocando: quem ligou desistiu, e ela tem os dois avisos
    // (tocou).
    h.Send(R"({"v":1,"cmd":"setDnd","on":false})");
    h.time.Advance(1000);
    h.app->OnIncomingCall(12, "2003", "Central");
    h.Run();
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    h.app->OnCallState(12, CallState::Disconnected, 487);
    h.Run();
    CHECK(LastToast(h) == kMissedAna);
    CHECK(MissedCalls(h) ==
          std::vector<std::string>{kMissedAna, Missed("3001"), kMissedAna, Missed("21977776666"), kMissedAna});

    // No Windows, so o aviso de 2 s.
    Harness pc;
    pc.StartRegistered();
    pc.app->OnIncomingCall(4, "2002", "Central");
    pc.Run();
    pc.app->OnCallState(4, CallState::Disconnected, 487);
    pc.Run();
    CHECK(pc.Toasts() == std::vector<std::string>{Missed("2002")});
    CHECK(pc.host.empty());
}

TEST_CASE("OpenRecents sends the abrir message on the iPhone and nothing on Windows") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(kReady);
    // O toque no aviso da perdida so vai para a fila; nela, a mensagem abrir, sozinha (o estado nao muda), sem linha no
    // diagnostico.
    const size_t posts = h.posts.size();
    h.logs.clear();
    h.app->OpenRecents();
    CHECK(h.posts.size() == posts);
    h.Run();
    REQUIRE(h.posts.size() == posts + 1);
    CHECK(h.posts.back() == OpenRecentsText());
    CHECK(h.logs.empty());
    // A cada toque, uma; o ready seguinte nao a repete.
    h.app->OpenRecents();
    h.Run();
    CHECK(h.Messages("abrir").size() == 2);
    const size_t from = h.posts.size();
    h.Send(kReady);
    CHECK(TypesSince(h, from) == std::vector<std::string>{"state"});

    // No Windows, nada, tambem antes do ready (que entao nao leva nenhum abrir): so a linha no diagnostico.
    Harness pc;
    pc.StartRegistered();
    const std::string before = Effects(pc);
    pc.logs.clear();
    pc.app->OpenRecents();
    pc.Run();
    CHECK(Effects(pc) == before);
    CHECK(pc.logs == std::vector<std::string>{"abrir os recentes: recusado no modo Windows"});
    pc.Send(kReady);
    pc.app->OpenRecents();
    pc.Run();
    CHECK(pc.Messages("abrir").empty());
}

TEST_CASE("an abrir asked before the ready goes in the ready, after the state and the agenda") {
    // O app que o iOS tinha fechado abre pelo toque no aviso: o OpenRecents chega antes de a pagina carregar (antes do
    // primeiro ready).
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.app->SetAgenda(AgendaPermission::Granted, SampleAgenda());
    h.app->OpenRecents();
    h.app->OpenRecents();   // dois toques: um abrir so
    h.Run();
    CHECK(h.Messages("abrir").empty());
    // O ready: o estado, a agenda e o abrir, nessa ordem (docs/ponte-windows.md, "O modo iPhone").
    h.posts.clear();
    h.Send(kReady);
    REQUIRE(h.posts.size() == 3);
    CHECK(json::parse(h.posts[0])["type"] == "state");
    CHECK(h.posts[1] == SampleAgendaMessage(1));
    CHECK(h.posts[2] == OpenRecentsText());
    // Uma vez so: a pagina que recarrega depois nao volta aos Recentes.
    h.posts.clear();
    h.Send(kReady);
    CHECK(TypesSince(h, 0) == std::vector<std::string>{"state", "agenda"});

    // Sem nenhuma agenda desde a abertura (vez 0): o estado e o abrir. O toque aqui chega ate antes da abertura.
    Harness cold(Platform::IPhone);
    cold.app->OpenRecents();
    cold.StartRegistered();
    cold.posts.clear();
    cold.Send(kReady);
    REQUIRE(cold.posts.size() == 2);
    CHECK(json::parse(cold.posts[0])["type"] == "state");
    CHECK(cold.posts[1] == OpenRecentsText());
}

TEST_CASE("no update message reaches the interface on the iPhone") {
    Harness h(Platform::IPhone);
    h.StartRegistered();
    h.Send(kReady);
    // Uma oferta (o hospedeiro do iPhone nao tem atualizador: a atualizacao e a da App Store) nao vai a interface nem
    // fica guardada: so a linha no diagnostico.
    const std::string before = Effects(h);
    h.logs.clear();
    h.app->OfferUpdate("1.0.1", "Notas da vers\xc3\xa3o");
    h.Run();
    CHECK(Effects(h) == before);
    CHECK(h.logs == std::vector<std::string>{"atualizacao: recusada no modo iPhone"});
    // O ready nao a repete: so o estado.
    const size_t from = h.posts.size();
    h.Send(kReady);
    CHECK(TypesSince(h, from) == std::vector<std::string>{"state"});
    // As respostas sao comandos do PC (recusados), e o gancho da resposta nunca e chamado.
    h.Send(R"({"v":1,"cmd":"updateNow"})");
    h.Send(R"({"v":1,"cmd":"updateLater"})");
    CHECK(h.host.empty());
    CHECK(h.Messages("update").empty());
}
