// Testes do orquestrador do app de PC (starsonic/desktop/DesktopApp.h) com o motor falso do controlador
// (tests/phone/fake_call_engine.h, Ruling 2 da W1), um registro falso, o disco na memoria e uma fila de comandos que
// o teste roda na mao (Run): tudo numa thread so, na ordem em que a fila de verdade rodaria.
#include <algorithm>
#include <deque>
#include <functional>
#include <memory>
#include <ostream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "AccountPolicy.h"
#include "DesktopApp.h"
#include "nlohmann/json.hpp"
#include "phone/fake_call_engine.h"
#include "test_support.h"

using namespace starsonic;
using nlohmann::json;

namespace {

const char* const kNotice = "A troca de conta fica para o fim da liga\xc3\xa7\xc3\xa3o.";

// A fila de comandos do teste: guarda as tarefas, e Run as roda (tambem as que elas poem) ate a fila esvaziar.
class QueueExecutor : public Executor {
public:
    std::deque<std::function<void()>> tasks;
    bool stopped = false;

    bool Post(std::function<void()> task) override {
        if (stopped) return false;
        tasks.push_back(std::move(task));
        return true;
    }
    void Stop() override {
        RunAll();
        stopped = true;
    }
    void RunAll() {
        while (!tasks.empty()) {
            std::function<void()> task = std::move(tasks.front());
            tasks.pop_front();
            task();
        }
    }
};

// O registro falso: anota as contas pedidas (ids 1, 2, 3...), as saidas e as escolhas de som.
class FakePort : public RegistrationPort {
public:
    std::vector<AccountInput> accounts;
    int removes = 0;
    int nextId = 1;
    bool refuse = false;   // SetAccount devolve 0
    std::vector<AudioDevice> devices;
    std::vector<std::pair<int, int>> audio;
    // O que o sistema tem agora: a lista do motor (devices) so muda para ela no RefreshAudioDevices (como o
    // pjmedia, que guarda a lista da abertura). Nada: a lista do motor fica como esta.
    std::optional<std::vector<AudioDevice>> system;
    std::vector<std::string> audioCalls;   // "refresh", "list" e "set", na ordem

    std::function<void()> duringSetAccount;   // roda dentro do SetAccount (um evento do motor que chega antes da volta)

    int SetAccount(const AccountInput& input) override {
        accounts.push_back(input);
        if (duringSetAccount) duringSetAccount();
        return refuse ? 0 : nextId++;
    }
    void RemoveAccount() override { ++removes; }
    // O BLF (as listas pedidas, na ordem) e a rede (os valores pedidos, na ordem).
    std::vector<std::vector<std::string>> watches;
    std::vector<bool> network;
    void WatchBlf(const std::vector<std::string>& numbers) override { watches.push_back(numbers); }
    void SetNetworkAvailable(bool available) override { network.push_back(available); }
    std::vector<AudioDevice> AudioDevices() override {
        audioCalls.push_back("list");
        return devices;
    }
    bool SetAudioDevices(int captureId, int playbackId) override {
        audioCalls.push_back("set");
        audio.emplace_back(captureId, playbackId);
        return true;
    }
    void RefreshAudioDevices() override {
        audioCalls.push_back("refresh");
        if (system) devices = *system;
    }
    int LastId() const { return nextId - 1; }
};

// O cifrador de teste: "enc:" e os bytes em hexadecimal.
class HexCipher : public SecretCipher {
public:
    std::optional<std::string> Protect(const std::string& utf8) override {
        static const char digits[] = "0123456789abcdef";
        std::string out = "enc:";
        for (unsigned char ch : utf8) {
            out.push_back(digits[ch >> 4]);
            out.push_back(digits[ch & 0xf]);
        }
        return out;
    }
    std::optional<std::string> Unprotect(const std::string& sealed) override {
        if (sealed.compare(0, 4, "enc:") != 0 || sealed.size() % 2 != 0) return std::nullopt;
        std::string out;
        for (size_t i = 4; i + 1 < sealed.size(); i += 2) {
            out.push_back(static_cast<char>(std::stoi(sealed.substr(i, 2), nullptr, 16)));
        }
        return out;
    }
};

std::optional<std::wstring> ToyDecrypt(const std::wstring& encrypted) {
    const std::wstring prefix = L"cifrada:";
    if (encrypted.compare(0, prefix.size(), prefix) != 0) return std::nullopt;
    return encrypted.substr(prefix.size());
}

DesktopPaths Paths() {
    DesktopPaths paths;
    paths.accounts = "dados/contas.json";
    paths.contacts = "dados/contatos.json";
    paths.recents = "dados/recentes.json";
    paths.settings = "dados/config.json";
    paths.atalhos = "dados/atalhos.json";
    paths.admin = "dados/admin.json";
    paths.legacy.ini = "rc7/StarsonicPhone.ini";
    paths.legacy.contactsXml = "rc7/Contacts.xml";
    paths.legacy.callsDb = "rc7/call_log.db";
    return paths;
}

struct Harness {
    starsonic::MemoryFileSystem files;
    HexCipher cipher;
    phone_test::FakeCallEngine engine;
    FakePort port;
    phone_test::FakeTime time;
    QueueExecutor* queue = nullptr;
    std::vector<std::string> posts;
    std::vector<std::string> logs;
    std::vector<std::string> opened;
    std::vector<std::string> host;   // os outros ganchos, na ordem
    std::vector<std::string> channels;   // o gancho updateChannel, na ordem
    std::unique_ptr<DesktopApp> app;

    Harness() { Make(); }

    std::optional<bool> observedAutostart;   // o que o executavel viu no registro (nada: nao viu)
    void Make() {
        DesktopConfig config;
        config.paths = Paths();
        config.observedStartWithWindows = observedAutostart;
        config.version = "0.1.0-rc.1";
        config.decrypt = ToyDecrypt;
        config.profile.account.port = 5060;
        config.profile.account.serverPorts = {ServerPort{L"starcloud1-starsonic.com.br", 35060}};
        // A senha do administrador dos testes (Ruling 6: nunca a de verdade).
        config.checkAdminPassword = [](const std::string& typed) { return typed == "senha-de-teste"; };
        DesktopHooks hooks;
        hooks.post = [this](const std::string& message) { posts.push_back(message); };
        hooks.log = [this](const std::string& line) { logs.push_back(line); };
        hooks.openUrl = [this](const std::string& url) { opened.push_back(url); };
        hooks.minimize = [this] { host.push_back("minimize"); };
        hooks.closeToTray = [this] { host.push_back("closeToTray"); };
        hooks.resize = [this](const std::string& edge) { host.push_back("resize " + edge); };
        hooks.quit = [this] { host.push_back("quit"); };
        hooks.sendDiagnostics = [this] { host.push_back("sendDiagnostics"); };
        hooks.setStartWithWindows = [this](bool on) { host.push_back(on ? "autostart on" : "autostart off"); };
        hooks.updateAnswer = [this](bool now) { host.push_back(now ? "update now" : "update later"); };
        hooks.updateChannel = [this](const std::string& channel) { channels.push_back(channel); };
        auto executor = std::make_unique<QueueExecutor>();
        queue = executor.get();
        app = std::make_unique<DesktopApp>(config, hooks, engine, port, files, cipher, time, time, std::move(executor));
    }

    // Fecha o app (como o executavel) e abre um novo sobre o mesmo disco.
    void Restart() {
        app->Shutdown();
        app.reset();
        posts.clear();
        Make();
        Start();
    }

    void Start() {
        app->Start();
        Run();
    }
    void Run() { queue->RunAll(); }
    void Send(const std::string& command) {
        app->HandleCommand(command);
        Run();
    }

    std::vector<json> Messages(const std::string& type) const {
        std::vector<json> out;
        for (const std::string& post : posts) {
            json message = json::parse(post);
            if (message["type"] == type) out.push_back(message);
        }
        return out;
    }
    json State() const {
        const std::vector<json> states = Messages("state");
        REQUIRE_FALSE(states.empty());
        return states.back()["state"];
    }
    std::vector<std::string> Toasts() const {
        std::vector<std::string> out;
        for (const json& message : Messages("toast")) out.push_back(message["texto"]);
        return out;
    }
    bool Logged(const std::string& part) const {
        for (const std::string& line : logs) {
            if (line.find(part) != std::string::npos) return true;
        }
        return false;
    }
    json File(const std::string& path) const {
        const auto found = files.files.find(path);
        REQUIRE(found != files.files.end());
        return json::parse(found->second);
    }

    // Uma conta gravada no contas.json antes da abertura.
    std::string SeedAccount(const std::wstring& address, const std::wstring& ramal, const std::wstring& senha,
                            bool active, const std::wstring& name = L"") {
        AccountsStore store(files, cipher, Paths().accounts);
        store.Load();
        SavedAccount account;
        account.address = address;
        account.ramal = ramal;
        account.senha = senha;
        account.name = name;
        REQUIRE(store.Save(account));
        const std::string id = store.LastSavedId();
        if (active) REQUIRE(store.SetActive(id));
        return id;
    }

    // Abre com uma conta em uso, ja registrada.
    std::string StartRegistered() {
        const std::string id = SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
        Start();
        app->OnRegistration(200, true, port.LastId());
        Run();
        return id;
    }
};

std::string Login(const std::string& server, const std::string& ramal, const std::string& senha,
                  const std::string& extra = "") {
    return R"({"v":1,"cmd":"login","servidor":")" + server + R"(","protocolo":"tcp","ramal":")" + ramal +
           R"(","senha":")" + senha + R"(","nome":"Recep")" + extra + "}";
}

}  // namespace

TEST_CASE("ready replays the current state with the ringing call") {
    Harness h;
    h.StartRegistered();
    h.app->OnIncomingCall(4, "2002", "Fulano");
    h.Run();
    h.posts.clear();

    h.Send(R"({"v":1,"cmd":"ready"})");
    REQUIRE(h.posts.size() == 2);
    const json state = json::parse(h.posts[0]);
    CHECK(state["type"] == "state");
    const json& call = state["state"]["ligacao"];
    CHECK(call["top"]["id"] == 4);
    CHECK(call["top"]["number"] == "2002");
    CHECK(call["top"]["name"] == "Fulano");
    CHECK(call["top"]["incoming"] == true);
    CHECK(call["top"]["phase"] == "ringing");
    CHECK(json::parse(h.posts[1]) == json({{"v", 1}, {"type", "ring"}, {"tipo", "completo"}}));
    CHECK(state["state"]["tela"] == "principal");
    CHECK(h.Logged("interface pronta"));

    // Um segundo ready (a pagina recarregou) recebe o mesmo estado de novo.
    h.posts.clear();
    h.Send(R"({"v":1,"cmd":"ready"})");
    CHECK(h.posts.size() == 2);
}

TEST_CASE("login with a port in the address shows the address message") {
    Harness h;
    h.Start();
    CHECK(h.State()["tela"] == "entrar");
    h.Send(Login("starcloud1-starsonic.com.br:5060", "2001", "segredo"));
    const json entrar = h.State()["entrar"];
    CHECK(entrar["erro"] == "Digite s\xc3\xb3 o endere\xc3\xa7o do servidor, como starcloud1-starsonic.com.br.");
    CHECK(entrar["ocupado"] == false);
    CHECK(entrar["servidor"] == "starcloud1-starsonic.com.br:5060");
    CHECK(entrar["ramal"] == "2001");
    CHECK(h.port.accounts.empty());

    // As outras mensagens da tela Entrar, na ordem da spec do Windows (7.1).
    h.Send(Login("", "2001", "segredo"));
    CHECK(h.State()["entrar"]["erro"] == "Digite o endere\xc3\xa7o do servidor.");
    h.Send(Login("pbx.example.com", "20 01", "segredo"));
    CHECK(h.State()["entrar"]["erro"] == "Digite s\xc3\xb3 o n\xc3\xbamero do ramal.");
    h.Send(Login("pbx.example.com", "2001", ""));
    CHECK(h.State()["entrar"]["erro"] == "Digite a senha.");
    CHECK(h.port.accounts.empty());
}

TEST_CASE("a successful login saves the account and shows the main screen") {
    Harness h;
    h.Start();
    h.Send(Login(" PBX.Example.com ", "2001", "segredo"));
    REQUIRE(h.port.accounts.size() == 1);
    CHECK(h.port.accounts[0].address == L"pbx.example.com");
    CHECK(h.port.accounts[0].transport == Transport::Tcp);
    CHECK(h.port.accounts[0].ramal == L"2001");
    CHECK(h.port.accounts[0].senha == L"segredo");
    CHECK(h.State()["tela"] == "entrar");
    CHECK(h.State()["entrar"]["ocupado"] == true);
    CHECK(h.State()["entrar"]["erro"] == "");
    CHECK(h.State()["contas"].empty());

    h.app->OnRegistration(100, false, 1);   // provisoria: continua esperando
    h.Run();
    CHECK(h.State()["entrar"]["ocupado"] == true);
    h.app->OnRegistration(200, true, 1);
    h.Run();

    const json state = h.State();
    CHECK(state["tela"] == "principal");
    CHECK(state["entrar"]["ocupado"] == false);
    CHECK(state["entrar"]["erro"] == "");
    REQUIRE(state["contas"].size() == 1);
    CHECK(state["contas"][0]["servidor"] == "pbx.example.com");
    CHECK(state["contas"][0]["nome"] == "Recep");
    CHECK(state["contas"][0]["emUso"] == true);
    CHECK(state["conta"]["status"] == "conectado");
    CHECK(state["conta"]["texto"] == "Conectado \xc2\xb7 pbx.example.com");
    CHECK(state["conta"]["protocolo"] == "tcp");

    const json saved = h.File("dados/contas.json");
    REQUIRE(saved["contas"].size() == 1);
    CHECK(saved["contas"][0]["servidor"] == "pbx.example.com");
    CHECK(saved["contas"][0]["ramal"] == "2001");
    CHECK(saved["contas"][0]["em_uso"] == true);
    CHECK(h.files.files["dados/contas.json"].find("segredo") == std::string::npos);
    // Nenhum post traz a senha.
    for (const std::string& post : h.posts) CHECK(post.find("segredo") == std::string::npos);

    // Registrada, a ligacao sai.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    CHECK(h.engine.made == std::vector<std::string>{"2003"});
}

TEST_CASE("a failed login keeps the previous account and shows the registration message") {
    Harness h;
    const std::string first = h.StartRegistered();
    h.Send(Login("outro.example.com", "3001", "errada"));
    REQUIRE(h.port.accounts.size() == 2);
    const int candidate = h.port.LastId();
    // Uma resposta da conta anterior que ainda estava na fila nao conta.
    h.app->OnRegistration(403, false, 1);
    h.Run();
    CHECK(h.State()["entrar"]["ocupado"] == true);
    h.app->OnRegistration(403, false, candidate);
    h.Run();

    const json state = h.State();
    CHECK(state["entrar"]["erro"] == "Ramal ou senha incorretos.");
    CHECK(state["entrar"]["ocupado"] == false);
    CHECK(state["entrar"]["servidor"] == "outro.example.com");
    CHECK(state["contas"].size() == 1);
    CHECK(state["tela"] == "principal");
    // A conta anterior volta a registrar.
    REQUIRE(h.port.accounts.size() == 3);
    CHECK(h.port.accounts[2].address == L"pbx.example.com");
    CHECK(state["conta"]["id"] == first);
    CHECK(state["conta"]["status"] == "conectando");
    CHECK(h.File("dados/contas.json")["contas"].size() == 1);
}

TEST_CASE("the login gives up after 15 seconds and ignores a late answer") {
    Harness h;
    h.Start();
    h.Send(Login("pbx.example.com", "2001", "segredo"));
    h.time.Advance(DesktopApp::kLoginTimeoutMs - 1);
    h.Run();
    CHECK(h.State()["entrar"]["ocupado"] == true);
    h.time.Advance(1);
    h.Run();
    CHECK(h.State()["entrar"]["ocupado"] == false);
    CHECK(h.State()["entrar"]["erro"] ==
          "N\xc3\xa3o foi poss\xc3\xadvel falar com o servidor. Confira o endere\xc3\xa7o e a sua internet.");
    CHECK(h.port.removes == 1);   // sem conta anterior: a candidata sai
    h.app->OnRegistration(200, true, 1);
    h.Run();
    CHECK(h.State()["tela"] == "entrar");
    CHECK(h.State()["contas"].empty());
}

TEST_CASE("editing an account with an empty password keeps the saved one") {
    Harness h;
    const std::string id = h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"login","servidor":"pbx.example.com","protocolo":"udp","ramal":"2001","senha":"",)"
           R"("nome":"Novo nome","contaId":")" +
           id + R"("})");
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.port.accounts[1].senha == L"segredo");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    const json state = h.State();
    REQUIRE(state["contas"].size() == 1);
    CHECK(state["contas"][0]["id"] == id);
    CHECK(state["contas"][0]["nome"] == "Novo nome");
    CHECK(state["conta"]["status"] == "conectado");
}

TEST_CASE("switching accounts during a call waits for the end and shows the notice") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false, L"Filial");
    h.Start();
    h.app->OnRegistration(200, true, 1);
    h.app->OnIncomingCall(5, "2002", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(5, CallState::Confirmed, 200);
    h.Run();

    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    CHECK(h.Toasts() == std::vector<std::string>{kNotice});
    CHECK(h.port.accounts.size() == 1);
    CHECK(h.State()["conta"]["id"] == first);

    h.app->OnCallState(5, CallState::Disconnected, 200);
    h.Run();
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.port.accounts[1].address == L"outro.example.com");
    CHECK(h.port.accounts[1].senha == L"outra");
    const json state = h.State();
    CHECK(state["conta"]["id"] == second);
    CHECK(state["conta"]["status"] == "conectando");
    for (const json& account : state["contas"]) CHECK(account["emUso"] == (account["id"] == second));
    CHECK(h.State()["ligacao"].is_null());

    // Sem ligacao, a troca e na hora, sem o aviso.
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + first + R"("})");
    CHECK(h.port.accounts.size() == 3);
    CHECK(h.Toasts().size() == 1);
}

TEST_CASE("a call that arrives before the pending switch runs makes it wait for that call too") {
    Harness h;
    h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    h.Start();
    h.app->OnRegistration(200, true, 1);
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");

    // A ligacao acaba (o callback do WhenIdle poe a troca na fila) e outra chega antes de a fila rodar.
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.app->OnIncomingCall(11, "2003", "");
    h.Run();
    CHECK(h.port.accounts.size() == 1);
    CHECK(h.State()["ligacao"]["top"]["id"] == 11);

    h.app->OnCallState(11, CallState::Disconnected, 487);
    h.Run();
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.State()["conta"]["id"] == second);
}

TEST_CASE("quitting with a pending account switch keeps the chosen account for the next start") {
    Harness h;
    h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    h.Start();
    h.app->OnRegistration(200, true, 1);
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");

    h.Send(R"({"v":1,"cmd":"quit"})");
    CHECK(h.host == std::vector<std::string>{"quit"});
    CHECK(h.engine.hangups == std::vector<int>{10});   // o Sair encerra a ligacao
    CHECK(h.port.accounts.size() == 1);                 // saindo, a outra conta nao registra
    // A ligacao encerrada vai aos Recentes.
    CHECK(h.File("dados/recentes.json")["recentes"].size() == 1);
    // Depois do Sair, os comandos sao ignorados.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2004"})");
    CHECK(h.engine.made.size() == 1);

    h.Restart();
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.port.accounts[1].address == L"outro.example.com");
    CHECK(h.State()["conta"]["id"] == second);
}

TEST_CASE("do not disturb survives a restart") {
    Harness h;
    h.StartRegistered();
    CHECK(h.State()["naoPerturbe"] == false);
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    CHECK(h.State()["naoPerturbe"] == true);
    CHECK(h.File("dados/config.json")["nao_perturbe"] == true);

    h.Restart();
    CHECK(h.State()["naoPerturbe"] == true);
    h.app->OnIncomingCall(7, "2002", "");
    h.Run();
    CHECK(h.engine.rejects == std::vector<int>{7});   // ocupado
    CHECK(h.Messages("ring").empty());                 // nao tocou
    CHECK(h.State()["recentes"][0]["tipo"] == "perdida");

    // O Atender automatico tambem fica gravado, com o tempo.
    h.Send(R"({"v":1,"cmd":"setAutoAnswer","on":true,"segundos":45})");
    CHECK(h.State()["atenderAutomatico"] == json({{"on", true}, {"segundos", 30}}));
    h.Restart();
    CHECK(h.State()["atenderAutomatico"] == json({{"on", true}, {"segundos", 30}}));
    h.Send(R"({"v":1,"cmd":"setDnd","on":false})");
    h.app->OnIncomingCall(8, "2002", "");
    h.Run();
    h.time.Advance(30000);
    h.Run();
    CHECK(h.engine.answers == std::vector<int>{8});
}

TEST_CASE("the window position is saved in config.json and kept by the other settings") {
    Harness early;
    // Antes da abertura (as configuracoes ainda nao foram lidas) nada e gravado: o config.json nao perde nada.
    early.app->SaveWindowPosition(5, 5);
    early.Run();
    CHECK(early.files.files.count("dados/config.json") == 0);

    Harness h;
    h.Start();
    h.app->SaveWindowPosition(-1200, 80);
    h.Run();
    CHECK(h.File("dados/config.json")["janela_x"] == -1200);
    CHECK(h.File("dados/config.json")["janela_y"] == 80);

    // Outra configuracao gravada depois mantem a posicao.
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    CHECK(h.File("dados/config.json")["janela_x"] == -1200);
    CHECK(h.File("dados/config.json")["nao_perturbe"] == true);

    // A mesma posicao de novo nao grava o disco.
    const int writes = h.files.writeCount;
    h.app->SaveWindowPosition(-1200, 80);
    h.Run();
    CHECK(h.files.writeCount == writes);

    h.Restart();
    SettingsStore store(h.files, Paths().settings);
    REQUIRE(store.Load());
    CHECK(store.Get().windowX == -1200);
    CHECK(store.Get().windowY == 80);
    CHECK(store.Get().doNotDisturb);
}

TEST_CASE("the window size is saved in config.json next to the position and kept by the other settings") {
    Harness early;
    // Antes da abertura nada e gravado (o config.json do disco ainda nao foi lido).
    early.app->SaveWindowSize(340, 560);
    early.Run();
    CHECK(early.files.files.count("dados/config.json") == 0);

    Harness h;
    h.Start();
    h.app->SaveWindowPosition(120, 80);
    h.app->SaveWindowSize(340, 560);
    h.Run();
    CHECK(h.File("dados/config.json")["janela_largura"] == 340);
    CHECK(h.File("dados/config.json")["janela_altura"] == 560);
    CHECK(h.File("dados/config.json")["janela_x"] == 120);

    // Outra configuracao gravada depois mantem o tamanho.
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    CHECK(h.File("dados/config.json")["janela_largura"] == 340);
    CHECK(h.File("dados/config.json")["nao_perturbe"] == true);

    // O mesmo tamanho de novo nao grava o disco; um tamanho invalido (zero ou negativo) e ignorado.
    const int writes = h.files.writeCount;
    h.app->SaveWindowSize(340, 560);
    h.app->SaveWindowSize(0, 560);
    h.app->SaveWindowSize(340, -1);
    h.Run();
    CHECK(h.files.writeCount == writes);

    h.Restart();
    SettingsStore store(h.files, Paths().settings);
    REQUIRE(store.Load());
    CHECK(store.Get().windowW == 340);
    CHECK(store.Get().windowH == 560);
    CHECK(store.Get().windowX == 120);
}

TEST_CASE("a dial link during a call only fills the keypad") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();

    h.app->DialLink("2003");
    h.Run();
    const json state = h.State();
    CHECK(state["teclado"] == "2003");
    CHECK(state["tecladoVez"] == 1);
    CHECK(h.engine.made == std::vector<std::string>{"2002"});
    CHECK(state["ligacao"]["top"]["number"] == "2002");
    CHECK(h.engine.holds.empty());
    CHECK(h.Logged("link recebido"));

    // O mesmo numero de novo: a vez sobe, para a interface por ele no Teclado outra vez.
    h.app->DialLink("2003");
    h.Run();
    CHECK(h.State()["tecladoVez"] == 2);
}

TEST_CASE("a missing audio device falls back to the default and keeps the choice") {
    Harness h;
    {
        SettingsStore settings(h.files, Paths().settings);
        Settings chosen;
        chosen.captureName = "Headset USB";
        chosen.captureDevice = 3;
        chosen.playbackName = "Headset USB";
        chosen.playbackDevice = 3;
        chosen.ringDeviceId = "sink-headset";
        REQUIRE(settings.Save(chosen));
    }
    h.port.devices = {AudioDevice{0, "Microfone (Realtek)", true, false},
                      AudioDevice{1, "Alto-falantes (Realtek)", false, true}};
    h.Start();
    REQUIRE_FALSE(h.port.audio.empty());
    CHECK(h.port.audio.back() == std::make_pair(-1, -1));
    json audio = h.State()["audio"];
    CHECK(audio["microfone"] == "Headset USB");
    CHECK(audio["altoFalante"] == "Headset USB");
    CHECK(audio["toque"] == "sink-headset");
    CHECK(audio["desconectados"] == json::array({"Headset USB"}));
    CHECK(audio["microfones"] == json::array({json({{"id", 0}, {"nome", "Microfone (Realtek)"}})}));
    CHECK(audio["altoFalantes"] == json::array({json({{"id", 1}, {"nome", "Alto-falantes (Realtek)"}})}));
    CHECK(h.File("dados/config.json")["microfone_nome"] == "Headset USB");

    // O headset volta: a escolha gravada vale de novo.
    h.port.devices.push_back(AudioDevice{2, "Headset USB", true, true});
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.port.audio.back() == std::make_pair(2, 2));
    audio = h.State()["audio"];
    CHECK(audio["desconectados"] == json::array());

    // A pessoa escolhe o padrao para o alto-falante: so ele muda.
    h.Send(R"({"v":1,"cmd":"setAudio","altoFalante":""})");
    CHECK(h.port.audio.back() == std::make_pair(2, -1));
    CHECK(h.File("dados/config.json")["microfone_nome"] == "Headset USB");
    CHECK(h.File("dados/config.json")["alto_falante_nome"] == "");
    CHECK(h.State()["audio"]["altoFalante"] == "");

    // O headset sai de novo: so o microfone fica desconectado (o alto-falante e o padrao).
    h.port.devices.pop_back();
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.port.audio.back() == std::make_pair(-1, -1));
    CHECK(h.State()["audio"]["desconectados"] == json::array({"Headset USB"}));
    CHECK(h.State()["audio"]["microfone"] == "Headset USB");
}

TEST_CASE("a device change rereads the engine list before choosing, and a headset that left shows as disconnected") {
    Harness h;
    {
        SettingsStore settings(h.files, Paths().settings);
        Settings chosen;
        chosen.captureName = "Headset USB";
        chosen.playbackName = "Headset USB";
        REQUIRE(settings.Save(chosen));
    }
    const std::vector<AudioDevice> withHeadset = {AudioDevice{0, "Microfone (Realtek)", true, false},
                                                  AudioDevice{1, "Alto-falantes (Realtek)", false, true},
                                                  AudioDevice{2, "Headset USB", true, true}};
    h.port.devices = withHeadset;
    h.Start();
    CHECK(h.port.audio.back() == std::make_pair(2, 2));
    CHECK(h.State()["audio"]["desconectados"] == json::array());

    // O headset sai com o app aberto: o motor ainda lista o de antes ate reler os dispositivos.
    h.port.system = std::vector<AudioDevice>{withHeadset[0], withHeadset[1]};
    h.port.audioCalls.clear();
    h.app->RefreshAudioDevices();
    h.Run();
    REQUIRE(h.port.audioCalls.size() >= 2);
    CHECK(h.port.audioCalls[0] == "refresh");
    CHECK(h.port.audioCalls[1] == "list");
    CHECK(h.port.audio.back() == std::make_pair(-1, -1));
    json audio = h.State()["audio"];
    CHECK(audio["desconectados"] == json::array({"Headset USB"}));
    CHECK(audio["microfones"] == json::array({json({{"id", 0}, {"nome", "Microfone (Realtek)"}})}));
    CHECK(audio["microfone"] == "Headset USB");
    CHECK(h.Logged("som: os dispositivos foram relidos"));

    // Ele volta (noutra posicao da lista): a escolha gravada vale de novo, pelo nome.
    h.port.system = std::vector<AudioDevice>{withHeadset[0], AudioDevice{1, "Headset USB", true, true},
                                             AudioDevice{2, "Alto-falantes (Realtek)", false, true}};
    h.app->RefreshAudioDevices();
    h.Run();
    CHECK(h.port.audio.back() == std::make_pair(1, 1));
    CHECK(h.State()["audio"]["desconectados"] == json::array());
}

TEST_CASE("openExternal refuses other urls") {
    Harness h;
    h.Start();
    for (const char* url : {"https://example.com", "https://starsonic.com.br.evil.com", "javascript:alert(1)",
                            "file:///C:/Windows", "tel:2003", "https://wa.me/5511999999999",
                            // O app e o tratador do tel: (o instalador o registra): o link so encheria o Teclado.
                            "tel:+551150603000"}) {
        h.Send(std::string(R"({"v":1,"cmd":"openExternal","url":")") + url + "\"}");
    }
    CHECK(h.opened.empty());
    CHECK(h.Logged("openExternal"));
    for (const char* url : {"https://starsonic.com.br", "https://starsonic.com.br/", "https://wa.me/551150603000",
                            "https://github.com/LucasCPena/starsonic-phone"}) {
        h.Send(std::string(R"({"v":1,"cmd":"openExternal","url":")") + url + "\"}");
    }
    CHECK(h.opened == std::vector<std::string>{"https://starsonic.com.br", "https://starsonic.com.br/",
                                               "https://wa.me/551150603000",
                                               "https://github.com/LucasCPena/starsonic-phone"});
}

TEST_CASE("the first start migrates the rc.7 and logs in the active account") {
    Harness h;
    h.files.files["rc7/StarsonicPhone.ini"] =
        "[Settings]\r\naccountId=2\r\n"
        "[Account1]\r\nlabel=1001 \xc2\xb7 pbx.example.com\r\nserver=pbx.example.com:5060\r\nusername=1001\r\n"
        "password=cifrada:segredo\r\ntransport=udp\r\n"
        "[Account2]\r\nlabel=Escrit\xc3\xb3rio\r\nserver=starcloud1.example.com:35060\r\nusername=2002\r\n"
        "password=cifrada:outra\r\ntransport=tcp\r\n";
    h.files.files["rc7/Contacts.xml"] =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<contacts>\r\n"
        "<contact name=\"Ana\" number=\"2005\" comment=\"cliente\" />\r\n</contacts>\r\n";
    h.Start();

    REQUIRE(h.port.accounts.size() == 1);
    CHECK(h.port.accounts[0].address == L"starcloud1.example.com");
    CHECK(h.port.accounts[0].ramal == L"2002");
    CHECK(h.port.accounts[0].senha == L"outra");
    CHECK(h.port.accounts[0].transport == Transport::Tcp);
    json state = h.State();
    CHECK(state["tela"] == "principal");
    CHECK(state["contas"].size() == 2);
    CHECK(state["conta"]["nome"] == "Escrit\xc3\xb3rio");
    CHECK(state["conta"]["status"] == "conectando");
    REQUIRE(state["contatos"].size() == 1);
    CHECK(state["contatos"][0]["nome"] == "Ana");
    CHECK(h.files.Exists("rc7/StarsonicPhone.ini.migrado"));
    CHECK(h.Logged("migra"));
    h.app->OnRegistration(200, true, 1);
    h.Run();
    CHECK(h.State()["conta"]["status"] == "conectado");

    // A proxima abertura nao migra de novo.
    h.Restart();
    CHECK(h.State()["contas"].size() == 2);
    CHECK(h.State()["contatos"].size() == 1);
}

TEST_CASE("an account that came without its password asks for it on the login screen") {
    Harness h;
    const std::string id = h.SeedAccount(L"pbx.example.com", L"2001", L"", true, L"Recep");
    h.Start();
    CHECK(h.port.accounts.empty());
    json entrar = h.State()["entrar"];
    CHECK(h.State()["tela"] == "entrar");
    CHECK(entrar["pedeSenha"] == true);
    CHECK(entrar["servidor"] == "pbx.example.com");
    CHECK(entrar["ramal"] == "2001");
    CHECK(entrar["nome"] == "Recep");
    CHECK(entrar["contaId"] == id);
    CHECK(entrar["erro"] == "Digite a senha de novo para continuar.");

    // Sem a senha, nada (nao ha senha gravada para manter).
    h.Send(R"({"v":1,"cmd":"login","servidor":"pbx.example.com","protocolo":"udp","ramal":"2001","senha":"",)"
           R"("contaId":")" + id + R"("})");
    CHECK(h.State()["entrar"]["erro"] == "Digite a senha.");
    CHECK(h.port.accounts.empty());
    h.Send(R"({"v":1,"cmd":"login","servidor":"pbx.example.com","protocolo":"udp","ramal":"2001","senha":"nova",)"
           R"("nome":"Recep","contaId":")" + id + R"("})");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    CHECK(h.State()["tela"] == "principal");
    CHECK(h.State()["entrar"]["pedeSenha"] == false);
    CHECK(h.State()["contas"].size() == 1);
}

namespace {

// A conta em uso no contas.json ("" sem nenhuma).
std::string ActiveInFile(const Harness& h) {
    const json file = h.File("dados/contas.json");
    for (const json& account : file["contas"]) {
        if (account.value("em_uso", false)) return account["id"].get<std::string>();
    }
    return std::string();
}

}  // namespace

TEST_CASE("switching to an account without its password keeps the working one, and Cancelar goes back to it") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true, L"Recep");
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"", false, L"Outra");
    h.Start();
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    REQUIRE(h.State()["conta"]["status"] == "conectado");

    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    json state = h.State();
    CHECK(state["tela"] == "entrar");
    CHECK(state["entrar"]["pedeSenha"] == true);
    CHECK(state["entrar"]["podeCancelar"] == true);
    CHECK(state["entrar"]["contaId"] == second);
    CHECK(state["entrar"]["servidor"] == "outro.example.com");
    CHECK(state["entrar"]["ramal"] == "3001");
    CHECK(state["entrar"]["erro"] == "Digite a senha de novo para continuar.");
    // A que funcionava continua em uso e registrada (no motor e no contas.json).
    CHECK(state["conta"]["id"] == first);
    CHECK(state["conta"]["status"] == "conectado");
    CHECK(h.port.removes == 0);
    CHECK(h.port.accounts.size() == 1);
    CHECK(ActiveInFile(h) == first);

    // Cancelar: volta para a que funcionava, sem registrar de novo.
    h.Send(R"({"v":1,"cmd":"cancelLogin"})");
    state = h.State();
    CHECK(state["tela"] == "principal");
    CHECK(state["entrar"]["podeCancelar"] == false);
    CHECK(state["entrar"]["pedeSenha"] == false);
    CHECK(state["entrar"]["contaId"] == "");
    CHECK(state["conta"]["id"] == first);
    CHECK(state["conta"]["status"] == "conectado");
    CHECK(h.port.removes == 0);
    CHECK(h.port.accounts.size() == 1);

    // Sem cancelar, a proxima abertura tambem entra na que funcionava.
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    REQUIRE(h.State()["tela"] == "entrar");
    h.Restart();
    CHECK(h.State()["tela"] == "principal");
    CHECK(h.State()["conta"]["id"] == first);
    CHECK(h.State()["entrar"]["podeCancelar"] == false);
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.port.accounts.back().ramal == L"2001");
    CHECK(ActiveInFile(h) == first);
}

TEST_CASE("a call on the working account shows over the password request of a switch, which comes back after it") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true, L"Recep");
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"", false, L"Outra");
    h.Start();
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    REQUIRE(h.State()["tela"] == "entrar");

    // Uma ligacao chega na conta que continua registrada: a tela da ligacao, nao a Entrar.
    h.app->OnIncomingCall(7, "2002", "Fulano");
    h.Run();
    json state = h.State();
    CHECK(state["tela"] == "principal");
    REQUIRE_FALSE(state["ligacao"].is_null());
    CHECK(state["ligacao"]["top"]["phase"] == "ringing");
    CHECK(state["conta"]["id"] == first);
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(7, CallState::Confirmed, 200);
    h.Run();
    CHECK(h.State()["tela"] == "principal");
    CHECK(h.State()["ligacao"]["top"]["phase"] == "active");

    // A ligacao acaba: a troca ainda pede a senha, com o Cancelar.
    h.Send(R"({"v":1,"cmd":"hangup","id":7})");
    h.app->OnCallState(7, CallState::Disconnected, 200);
    h.Run();
    state = h.State();
    CHECK(state["ligacao"].is_null());
    CHECK(state["tela"] == "entrar");
    CHECK(state["entrar"]["podeCancelar"] == true);
    CHECK(state["entrar"]["contaId"] == second);
}

TEST_CASE("quitting with a switch to an account without its password waiting for the call keeps the working one") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true, L"Recep");
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"", false, L"Outra");
    h.Start();
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    CHECK(h.Toasts().back() == kNotice);
    h.Send(R"({"v":1,"cmd":"quit"})");
    CHECK(ActiveInFile(h) == first);
    h.Restart();
    CHECK(h.State()["tela"] == "principal");
    CHECK(h.State()["conta"]["id"] == first);
}

TEST_CASE("the password typed for a switch commits the new account, and a wrong one brings the working one back") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true, L"Recep");
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"", false, L"Outra");
    h.Start();
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");

    // A senha errada: a que funcionava volta a registrar, e a tela continua pedindo a senha (com o Cancelar).
    h.Send(R"({"v":1,"cmd":"login","servidor":"outro.example.com","protocolo":"udp","ramal":"3001","senha":"errada",)"
           R"("nome":"Outra","contaId":")" + second + R"("})");
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.port.accounts[1].ramal == L"3001");
    h.app->OnRegistration(401, false, h.port.LastId());
    h.Run();
    REQUIRE(h.port.accounts.size() == 3);
    CHECK(h.port.accounts[2].ramal == L"2001");
    json state = h.State();
    CHECK(state["tela"] == "entrar");
    CHECK(state["entrar"]["erro"] == "Ramal ou senha incorretos.");
    CHECK(state["entrar"]["podeCancelar"] == true);
    CHECK(state["conta"]["id"] == first);
    CHECK(ActiveInFile(h) == first);

    // A certa: a conta nova fica em uso (e gravada).
    h.Send(R"({"v":1,"cmd":"login","servidor":"outro.example.com","protocolo":"udp","ramal":"3001","senha":"certa",)"
           R"("nome":"Outra","contaId":")" + second + R"("})");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    state = h.State();
    CHECK(state["tela"] == "principal");
    CHECK(state["conta"]["id"] == second);
    CHECK(state["entrar"]["podeCancelar"] == false);
    CHECK(ActiveInFile(h) == second);
}

TEST_CASE("removing the account in use is refused during a call and hands over to another one") {
    Harness h;
    const std::string first = h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    h.Start();
    h.app->OnRegistration(200, true, 1);
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.Send(R"({"v":1,"cmd":"removeAccount","contaId":")" + first + R"("})");
    CHECK(h.State()["contas"].size() == 2);
    CHECK(h.Logged("removeAccount"));

    h.app->OnCallState(10, CallState::Disconnected, 486);
    h.Run();
    h.Send(R"({"v":1,"cmd":"removeAccount","contaId":")" + first + R"("})");
    CHECK(h.State()["contas"].size() == 1);
    CHECK(h.port.removes == 1);
    REQUIRE(h.port.accounts.size() == 2);
    CHECK(h.State()["conta"]["id"] == second);

    h.Send(R"({"v":1,"cmd":"removeAccount","contaId":")" + second + R"("})");
    CHECK(h.State()["contas"].empty());
    CHECK(h.State()["conta"].is_null());
    CHECK(h.State()["tela"] == "entrar");
}

TEST_CASE("an invalid command is ignored with a line in the diagnostics") {
    Harness h;
    h.StartRegistered();
    const size_t before = h.posts.size();
    h.Send(R"({"v":2,"cmd":"dial","numero":"2002"})");
    h.Send(R"({"v":1,"cmd":"dial","numero":2002})");
    h.Send(R"({"v":1,"cmd":"formatDisk"})");
    h.Send("{nao e json");
    CHECK(h.engine.made.empty());
    CHECK(h.posts.size() == before);
    const auto ignored = std::count_if(h.logs.begin(), h.logs.end(), [](const std::string& line) {
        return line.find("comando ignorado") != std::string::npos;
    });
    CHECK(ignored == 4);
}

TEST_CASE("call commands reach the controller and the call end message becomes a toast") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    // O Desligar do cartao da feita sem id ainda: id 0 (a feita mais nova).
    h.Send(R"({"v":1,"cmd":"hangup","id":0})");
    CHECK(h.engine.hangups == std::vector<int>{10});
    h.app->OnCallState(10, CallState::Disconnected, 487);
    h.Run();

    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    h.app->OnCallState(11, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"mute","on":true})");
    CHECK(h.State()["ligacao"]["muted"] == true);
    h.Send(R"({"v":1,"cmd":"dtmf","digitos":"1#"})");
    CHECK(h.engine.dtmfs == std::vector<std::pair<int, std::string>>{{11, "1#"}});
    h.Send(R"({"v":1,"cmd":"hold","on":true})");
    CHECK(h.engine.holds == std::vector<std::pair<int, bool>>{{11, true}});
    h.Send(R"({"v":1,"cmd":"hold"})");
    CHECK(h.engine.holds.back() == std::make_pair(11, false));
    h.Send(R"({"v":1,"cmd":"hangup","id":11})");
    CHECK(h.engine.hangups.back() == 11);
    h.app->OnCallState(11, CallState::Disconnected, 200);
    h.Run();

    // A feita que recebe ocupado: o aviso do nucleo vai como toast, e a ligacao some do estado.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2004"})");
    h.app->OnCallState(12, CallState::Disconnected, 486);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>{"Ocupado"});
    CHECK(h.State()["ligacao"].is_null());
    CHECK(h.File("dados/recentes.json")["recentes"].size() == 3);
}

TEST_CASE("the second call of a conference is presented as active") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    h.app->OnCallState(11, CallState::Confirmed, 200);
    h.Run();
    CHECK(h.State()["ligacao"]["secondKind"] == "held");
    h.Send(R"({"v":1,"cmd":"join"})");
    const json call = h.State()["ligacao"];
    CHECK(call["conference"] == true);
    CHECK(call["secondKind"] == "active");
    CHECK(call["second"]["held"] == false);
    h.Send(R"({"v":1,"cmd":"split"})");
    CHECK(h.State()["ligacao"]["secondKind"] == "held");
}

TEST_CASE("missed calls count until the recents are viewed, with the contact name") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"saveContact","nome":"Ana","numero":"(11) 2002","observacao":"cliente"})");
    REQUIRE(h.State()["contatos"].size() == 1);
    const std::string contactId = h.State()["contatos"][0]["id"];
    h.time.Advance(1000);
    h.app->OnIncomingCall(4, "112002", "Central");
    h.Run();
    CHECK(h.State()["ligacao"]["top"]["name"] == "Ana");
    h.time.Advance(1000);
    h.app->OnCallState(4, CallState::Disconnected, 487);
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>{"Liga\xc3\xa7\xc3\xa3o perdida de Ana"});
    json state = h.State();
    CHECK(state["perdidas"] == 1);
    REQUIRE(state["recentes"].size() == 1);
    CHECK(state["recentes"][0]["nome"] == "Ana");
    CHECK(state["recentes"][0]["contatoId"] == contactId);
    CHECK(state["recentes"][0]["tipo"] == "perdida");

    h.time.Advance(1000);
    h.Send(R"({"v":1,"cmd":"viewRecents"})");
    CHECK(h.State()["perdidas"] == 0);

    h.Send(R"({"v":1,"cmd":"removeContact","id":")" + contactId + R"("})");
    CHECK(h.State()["contatos"].empty());
    CHECK(h.State()["recentes"][0]["nome"] == "Central");
    CHECK(h.State()["recentes"][0]["contatoId"] == "");
}

TEST_CASE("window, diagnostics and the start with windows go to the host") {
    Harness h;
    h.Start();
    h.Send(R"({"v":1,"cmd":"minimize"})");
    h.Send(R"({"v":1,"cmd":"closeToTray"})");
    h.Send(R"({"v":1,"cmd":"sendDiagnostics"})");
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false})");
    // O redimensionar pelas zonas da interface (a borda de cima, os cantos de cima e o canto de baixo a direita).
    h.Send(R"({"v":1,"cmd":"resize","borda":"cima"})");
    h.Send(R"({"v":1,"cmd":"resize","borda":"baixo-direita"})");
    h.Send(R"({"v":1,"cmd":"resize","borda":"meio"})");   // recusado: nada vai ao executavel
    CHECK(h.host == std::vector<std::string>{"minimize", "closeToTray", "sendDiagnostics", "autostart off", "resize cima",
                                             "resize baixo-direita"});
    CHECK(h.State()["iniciarComWindows"] == false);
    CHECK(h.File("dados/config.json")["iniciar_com_windows"] == false);
    CHECK(h.State()["versao"] == "0.1.0-rc.1");
}

TEST_CASE("an update offer reaches the interface, comes back on ready and is answered once") {
    Harness h;
    h.StartRegistered();
    h.posts.clear();
    h.app->OfferUpdate("0.1.0-rc.2", "Notas da vers\xc3\xa3o");
    h.Run();
    REQUIRE(h.Messages("update").size() == 1);
    CHECK(h.Messages("update")[0] ==
          json({{"v", 1}, {"type", "update"}, {"versao", "0.1.0-rc.2"}, {"notas", "Notas da vers\xc3\xa3o"}}));

    // A interface recarregou (ou o aviso abriu): a pergunta volta depois do estado e do toque.
    h.posts.clear();
    h.Send(R"({"v":1,"cmd":"ready"})");
    REQUIRE(h.posts.size() == 3);
    CHECK(json::parse(h.posts[0])["type"] == "state");
    CHECK(json::parse(h.posts[1])["type"] == "ring");
    CHECK(json::parse(h.posts[2])["type"] == "update");

    // Depois: a resposta vai ao executavel uma vez, e a pergunta nao volta mais.
    h.Send(R"({"v":1,"cmd":"updateLater"})");
    h.Send(R"({"v":1,"cmd":"updateNow"})");
    CHECK(h.host == std::vector<std::string>{"update later"});
    h.posts.clear();
    h.Send(R"({"v":1,"cmd":"ready"})");
    CHECK(h.Messages("update").empty());

    // Uma nova pergunta, respondida com Atualizar agora.
    h.app->OfferUpdate("0.1.0-rc.3", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"updateNow"})");
    CHECK(h.host == std::vector<std::string>{"update later", "update now"});
    // Sem pergunta aberta, uma resposta e ignorada.
    h.Send(R"({"v":1,"cmd":"updateLater"})");
    CHECK(h.host.size() == 2);
}

TEST_CASE("quitting with an update question open answers it as later") {
    Harness h;
    h.StartRegistered();
    h.app->OfferUpdate("0.1.0-rc.2", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"quit"})");
    CHECK(h.host == std::vector<std::string>{"update later", "quit"});
}

TEST_CASE("a notice from the host becomes a toast") {
    Harness h;
    h.Start();
    h.app->Notify("Termine a chamada para atualizar.");
    h.Run();
    CHECK(h.Toasts() == std::vector<std::string>{"Termine a chamada para atualizar."});
}

TEST_CASE("the start with windows seen in the registry wins over the saved setting, without the hook") {
    // O padrao do config.json e ligado; o Run do Windows sem o valor (o instalador nao gravou, a rc.7 estava sem,
    // desligado no Gerenciador de Tarefas): vale o desligado, gravado, e a interface mostra desligado.
    Harness h;
    h.observedAutostart = false;
    h.Make();
    h.Start();
    CHECK(h.State()["iniciarComWindows"] == false);
    CHECK(h.File("dados/config.json")["iniciar_com_windows"] == false);
    CHECK(h.host.empty());   // so o que a pessoa muda vai ao registro

    // O contrario: gravado desligado, o registro ligado.
    h.observedAutostart = true;
    h.Restart();
    CHECK(h.State()["iniciarComWindows"] == true);
    CHECK(h.File("dados/config.json")["iniciar_com_windows"] == true);
    CHECK(h.host.empty());

    // Sem o que o executavel viu (os testes, outra plataforma): vale o gravado.
    h.observedAutostart.reset();
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"iniciarComWindows","valor":false})");
    CHECK(h.host == std::vector<std::string>{"autostart off"});
    h.host.clear();
    h.Restart();
    CHECK(h.State()["iniciarComWindows"] == false);
    CHECK(h.host.empty());
}

TEST_CASE("commands run on the command thread, never on the caller") {
    starsonic::MemoryFileSystem files;
    HexCipher cipher;
    phone_test::FakeCallEngine engine;
    FakePort port;
    phone_test::FakeTime time;
    std::thread::id dialedOn;
    engine.duringMakeCall = [&dialedOn](int) { dialedOn = std::this_thread::get_id(); };
    {
        AccountsStore store(files, cipher, Paths().accounts);
        SavedAccount account;
        account.address = L"pbx.example.com";
        account.ramal = L"2001";
        account.senha = L"segredo";
        REQUIRE(store.Save(account));
        REQUIRE(store.SetActive(store.LastSavedId()));
    }
    DesktopConfig config;
    config.paths = Paths();
    DesktopApp app(config, DesktopHooks(), engine, port, files, cipher, time, time);   // o SerialExecutor de verdade
    app.Start();
    app.OnRegistration(200, true, 1);
    app.HandleCommand(R"({"v":1,"cmd":"dial","numero":"2002"})");
    app.Shutdown();   // roda o que estava na fila e para
    CHECK(engine.made == std::vector<std::string>{"2002"});
    CHECK(dialedOn != std::thread::id());
    CHECK(dialedOn != std::this_thread::get_id());
    // Depois do Shutdown, nada mais entra.
    app.HandleCommand(R"({"v":1,"cmd":"dial","numero":"2003"})");
    CHECK(engine.made.size() == 1);
}

// rc.3: os atalhos, o BLF, o puxar ligacao, a area do administrador, a internet e o bipe do fim (spec 3 a 8).
namespace {

const char* const kAdminLogin = R"({"v":1,"cmd":"adminLogin","senha":"senha-de-teste"})";
const char* const kWrongAdmin = R"({"v":1,"cmd":"adminLogin","senha":"outra-senha"})";
const char* const kWrongPassword = "Senha incorreta.";
const char* const kNoConnection = "Sem conex\xc3\xa3o com o servidor. Tente de novo em instantes.";

std::string SaveShortcut(const std::string& nome, const std::string& numero, const std::string& acao, bool blf,
                         const std::string& id = "") {
    std::string out = R"({"v":1,"cmd":"saveShortcut",)";
    if (!id.empty()) out += R"("id":")" + id + R"(",)";
    return out + R"("nome":")" + nome + R"(","numero":")" + numero + R"(","acao":")" + acao + R"(","blf":)" +
           (blf ? "true" : "false") + "}";
}

std::string UseShortcut(const std::string& id) { return R"({"v":1,"cmd":"useShortcut","id":")" + id + R"("})"; }
std::string RemoveShortcut(const std::string& id) {
    return R"({"v":1,"cmd":"removeShortcut","id":")" + id + R"("})";
}
std::string AdminSet(const std::string& fields) { return R"({"v":1,"cmd":"adminSet",)" + fields + "}"; }

// O atalho do estado com esse nome (o teste falha se nao ha).
json ShortcutNamed(const Harness& h, const std::string& nome) {
    const json state = h.State();
    for (const json& atalho : state["atalhos"]) {
        if (atalho["nome"] == nome) return atalho;
    }
    FAIL("sem o atalho " << nome);
    return json();
}
std::string IdOf(const Harness& h, const std::string& nome) { return ShortcutNamed(h, nome)["id"]; }

size_t EndBeeps(const Harness& h) {
    size_t count = 0;
    for (const json& ring : h.Messages("ring")) {
        if (ring == json({{"v", 1}, {"type", "ring"}, {"tipo", "fim"}})) ++count;
    }
    return count;
}

}  // namespace

TEST_CASE("useShortcut runs each action outside and during a call") {
    Harness h;
    h.StartRegistered();
    h.Send(SaveShortcut("Ana", "2002", "ligar", false));
    h.Send(SaveShortcut("Recep", "2003", "transferir", false));
    h.Send(SaveShortcut("Bia", "2004", "consulta", false));
    h.Send(SaveShortcut("Menu", "12#", "teclas", false));
    h.Send(SaveShortcut("Fora", "+551150603000", "ligar", false));
    const json atalhos = h.State()["atalhos"];
    REQUIRE(atalhos.size() == 5);
    CHECK(atalhos[0]["nome"] == "Ana");
    CHECK(atalhos[0]["numero"] == "2002");
    CHECK(atalhos[0]["acao"] == "ligar");
    CHECK(atalhos[0]["blf"] == false);
    CHECK(atalhos[0]["estado"].is_null());
    CHECK_FALSE(atalhos[0]["id"].get<std::string>().empty());
    CHECK(atalhos[1]["acao"] == "transferir");
    CHECK(atalhos[2]["acao"] == "consulta");
    CHECK(atalhos[3]["acao"] == "teclas");
    CHECK(h.File("dados/atalhos.json")["atalhos"].size() == 5);

    // Fora de ligacao: Ligar, Transferir e Consulta ligam para o numero, pela regra dos contatos; Enviar teclas nao.
    h.Send(UseShortcut(IdOf(h, "Ana")));
    CHECK(h.engine.made == std::vector<std::string>{"2002"});
    h.app->OnCallState(10, CallState::Disconnected, 487);
    h.Send(UseShortcut(IdOf(h, "Recep")));
    CHECK(h.engine.made.back() == "2003");
    h.app->OnCallState(11, CallState::Disconnected, 487);
    h.Send(UseShortcut(IdOf(h, "Bia")));
    CHECK(h.engine.made.back() == "2004");
    h.app->OnCallState(12, CallState::Disconnected, 487);
    h.Send(UseShortcut(IdOf(h, "Fora")));
    CHECK(h.engine.made.back() == "1150603000");   // o +55 sai (a regra dos contatos do perfil)
    h.app->OnCallState(13, CallState::Disconnected, 487);
    h.Run();
    h.Send(UseShortcut(IdOf(h, "Menu")));
    CHECK(h.engine.made.size() == 4);
    CHECK(h.engine.dtmfs.empty());
    CHECK(h.Logged("useShortcut"));

    // Durante a ligacao.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2010"})");
    h.app->OnCallState(14, CallState::Confirmed, 200);
    h.Run();
    h.Send(UseShortcut(IdOf(h, "Menu")));
    CHECK(h.engine.dtmfs == std::vector<std::pair<int, std::string>>{{14, "12#"}});
    // Transferir com consulta: consulta o numero.
    h.Send(UseShortcut(IdOf(h, "Bia")));
    CHECK(h.engine.made.back() == "2004");
    CHECK(h.State()["ligacao"]["consulting"] == true);
    h.Send(R"({"v":1,"cmd":"cancelConsult"})");
    h.app->OnCallState(15, CallState::Disconnected, 200);
    h.Run();
    CHECK(h.State()["ligacao"]["second"].is_null());
    // Ligar: a Nova ligacao (a atual fica em espera).
    h.Send(UseShortcut(IdOf(h, "Ana")));
    CHECK(h.engine.made.back() == "2002");
    h.app->OnCallState(16, CallState::Confirmed, 200);
    h.Run();
    CHECK(h.State()["ligacao"]["second"]["id"] == 14);
    h.Send(R"({"v":1,"cmd":"hangup","id":16})");
    h.app->OnCallState(16, CallState::Disconnected, 200);
    h.Run();
    // Transferir: transfere direto.
    h.Send(UseShortcut(IdOf(h, "Recep")));
    CHECK(h.engine.transfers == std::vector<std::pair<int, std::string>>{{14, "2003"}});
    CHECK(h.engine.made.size() == 7);

    // Um atalho que nao existe: nada.
    h.Send(UseShortcut("nao-existe"));
    CHECK(h.engine.made.size() == 7);

    // Editar e remover; o erro da loja vai como toast.
    const std::string ana = IdOf(h, "Ana");
    h.Send(SaveShortcut("Ana Souza", "2012", "consulta", false, ana));
    CHECK(ShortcutNamed(h, "Ana Souza")["numero"] == "2012");
    CHECK(h.State()["atalhos"].size() == 5);
    h.Send(SaveShortcut("", "2012", "ligar", false));
    CHECK(h.Toasts().back() == "Digite o nome do atalho.");
    CHECK(h.State()["atalhos"].size() == 5);
    h.Send(RemoveShortcut(ana));
    CHECK(h.State()["atalhos"].size() == 4);
    h.Restart();
    CHECK(h.State()["atalhos"].size() == 4);
}

TEST_CASE("useShortcut on a ringing BLF with pickup dials the pickup code") {
    Harness h;
    h.StartRegistered();
    h.Send(kAdminLogin);
    h.Send(AdminSet(R"("blf":true,"puxar":true,"codigoPuxar":"**{ramal}")"));
    h.Send(SaveShortcut("Ana", "2007", "transferir", true));
    const std::string id = IdOf(h, "Ana");
    CHECK(ShortcutNamed(h, "Ana")["estado"] == "desconectado");

    h.app->OnBlf("2007", BlfState::Ringing);
    h.Run();
    CHECK(ShortcutNamed(h, "Ana")["estado"] == "tocando");
    h.Send(UseShortcut(id));
    CHECK(h.engine.made == std::vector<std::string>{"**2007"});
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();

    // Fora de tocando: a acao normal.
    h.app->OnBlf("2007", BlfState::Busy);
    h.Run();
    CHECK(ShortcutNamed(h, "Ana")["estado"] == "ocupado");
    h.Send(UseShortcut(id));
    CHECK(h.engine.made.back() == "2007");
    h.app->OnCallState(11, CallState::Disconnected, 487);
    h.app->OnBlf("2007", BlfState::Free);
    h.Run();
    CHECK(ShortcutNamed(h, "Ana")["estado"] == "livre");

    // Um codigo sem {ramal} vai como esta.
    h.app->OnBlf("2007", BlfState::Ringing);
    h.Send(AdminSet(R"("codigoPuxar":"*8")"));
    h.Send(UseShortcut(id));
    CHECK(h.engine.made.back() == "*8");
    h.app->OnCallState(12, CallState::Disconnected, 200);
    h.Run();

    // Sem o puxar, ou com o codigo vazio: a acao normal.
    h.Send(AdminSet(R"("puxar":false)"));
    h.Send(UseShortcut(id));
    CHECK(h.engine.made.back() == "2007");
    h.app->OnCallState(13, CallState::Disconnected, 487);
    h.Send(AdminSet(R"("puxar":true,"codigoPuxar":"")"));
    h.Send(UseShortcut(id));
    CHECK(h.engine.made.back() == "2007");
    h.app->OnCallState(14, CallState::Disconnected, 487);
    // Com o BLF do administrador desligado, o estado some e o atalho faz a acao normal.
    h.Send(AdminSet(R"("blf":false,"codigoPuxar":"**{ramal}")"));
    CHECK(ShortcutNamed(h, "Ana")["estado"].is_null());
    h.Send(UseShortcut(id));
    CHECK(h.engine.made.back() == "2007");
    CHECK(h.engine.made.size() == 6);
}

TEST_CASE("blf follows the shortcut list and the account in use") {
    Harness h;
    h.SeedAccount(L"pbx.example.com", L"2001", L"segredo", true);
    const std::string second = h.SeedAccount(L"outro.example.com", L"3001", L"outra", false);
    h.Start();
    h.app->OnRegistration(200, true, 1);
    h.Run();
    h.Send(SaveShortcut("A", "2007", "ligar", true));
    h.Send(SaveShortcut("B", "2008", "ligar", false));
    h.Send(SaveShortcut("C", "2007", "consulta", true));
    // O BLF do administrador vem desligado: nada e assinado, e o estado e null.
    CHECK(h.port.watches.empty());
    CHECK(ShortcutNamed(h, "A")["estado"].is_null());

    h.Send(kAdminLogin);
    h.Send(AdminSet(R"("blf":true)"));
    REQUIRE(h.port.watches.size() == 1);
    CHECK(h.port.watches.back() == std::vector<std::string>{"2007"});
    CHECK(ShortcutNamed(h, "A")["estado"] == "desconectado");
    CHECK(ShortcutNamed(h, "B")["estado"].is_null());
    h.app->OnBlf("2007", BlfState::Busy);
    h.app->OnBlf("2008", BlfState::Busy);   // nao assinado: ignorado
    h.Run();
    CHECK(ShortcutNamed(h, "A")["estado"] == "ocupado");
    CHECK(ShortcutNamed(h, "C")["estado"] == "ocupado");   // o mesmo numero

    // O B passa a ter o BLF.
    h.Send(SaveShortcut("B", "2008", "ligar", true, IdOf(h, "B")));
    CHECK(h.port.watches.back() == std::vector<std::string>{"2007", "2008"});
    CHECK(ShortcutNamed(h, "B")["estado"] == "desconectado");
    // Sai o A: o C ainda tem o 2007, nada muda no motor.
    h.Send(RemoveShortcut(IdOf(h, "A")));
    CHECK(h.port.watches.size() == 2);
    // Sai o C: o 2007 sai, e um aviso atrasado dele nao volta como estado de um atalho novo com o mesmo numero.
    h.Send(RemoveShortcut(IdOf(h, "C")));
    CHECK(h.port.watches.back() == std::vector<std::string>{"2008"});
    h.app->OnBlf("2007", BlfState::Free);
    h.Run();
    h.Send(SaveShortcut("D", "2007", "ligar", true));
    CHECK(h.port.watches.back() == std::vector<std::string>{"2008", "2007"});
    CHECK(ShortcutNamed(h, "D")["estado"] == "desconectado");
    h.app->OnBlf("2008", BlfState::Ringing);
    h.Run();
    CHECK(ShortcutNamed(h, "B")["estado"] == "tocando");

    // Troca de conta: assina de novo na conta nova, do zero. Um aviso da conta que sai, entregue antes de o
    // SetAccount voltar, nao vale.
    const size_t before = h.port.watches.size();
    h.port.duringSetAccount = [&h] { h.app->OnBlf("2008", BlfState::Busy); };
    h.Send(R"({"v":1,"cmd":"selectAccount","contaId":")" + second + R"("})");
    h.port.duringSetAccount = nullptr;
    REQUIRE(h.port.accounts.size() == 2);
    REQUIRE(h.port.watches.size() == before + 1);
    CHECK(h.port.watches.back() == std::vector<std::string>{"2008", "2007"});
    CHECK(ShortcutNamed(h, "B")["estado"] == "desconectado");

    // A conta registra de novo: assina de novo (a lista e a mesma).
    h.app->OnRegistration(200, true, 2);
    h.Run();
    CHECK(h.port.watches.size() == before + 2);
    h.app->OnRegistration(200, true, 2);   // a renovacao nao muda nada
    h.Run();
    CHECK(h.port.watches.size() == before + 2);
    h.app->OnRegistration(503, false, 2);
    h.app->OnRegistration(200, true, 2);
    h.Run();
    CHECK(h.port.watches.size() == before + 3);

    // O administrador desliga o BLF: a lista fica vazia e o estado some.
    h.Send(AdminSet(R"("blf":false)"));
    CHECK(h.port.watches.back().empty());
    CHECK(ShortcutNamed(h, "B")["estado"].is_null());
}

TEST_CASE("hiding Nao perturbe forces it off") {
    Harness h;
    h.StartRegistered();
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    h.Send(R"({"v":1,"cmd":"setAutoAnswer","on":true,"segundos":5})");
    CHECK(h.State()["naoPerturbe"] == true);

    // Sem a area aberta, o adminSet e recusado.
    h.Send(AdminSet(R"("naoPerturbe":false)"));
    CHECK(h.State()["admin"]["naoPerturbe"] == true);
    CHECK(h.State()["naoPerturbe"] == true);
    CHECK(h.Logged("adminSet"));

    h.Send(kAdminLogin);
    h.Send(AdminSet(R"("naoPerturbe":false)"));
    json state = h.State();
    CHECK(state["admin"]["naoPerturbe"] == false);
    CHECK(state["naoPerturbe"] == false);
    CHECK(h.File("dados/config.json")["nao_perturbe"] == false);
    // As ligacoes tocam de novo.
    h.app->OnIncomingCall(7, "2002", "");
    h.Run();
    CHECK(h.engine.rejects.empty());
    CHECK(h.Messages("ring").back()["tipo"] == "completo");
    h.app->OnCallState(7, CallState::Disconnected, 487);
    h.Run();
    // Escondido, o setDnd que liga e recusado (o que desliga passa).
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    CHECK(h.State()["naoPerturbe"] == false);
    CHECK(h.Logged("setDnd recusado"));

    // O Atender automatico, do mesmo jeito.
    CHECK(h.State()["atenderAutomatico"]["on"] == true);
    h.Send(AdminSet(R"("atenderAuto":false)"));
    CHECK(h.State()["atenderAutomatico"]["on"] == false);
    CHECK(h.File("dados/config.json")["atender_automatico"] == false);
    h.Send(R"({"v":1,"cmd":"setAutoAnswer","on":true})");
    CHECK(h.State()["atenderAutomatico"]["on"] == false);
    CHECK(h.Logged("setAutoAnswer recusado"));
    h.app->OnIncomingCall(8, "2002", "");
    h.Run();
    h.time.Advance(10000);
    h.Run();
    CHECK(h.engine.answers.empty());
    h.app->OnCallState(8, CallState::Disconnected, 487);
    h.Run();

    // Mostrar de novo nao liga de volta.
    h.Send(AdminSet(R"("naoPerturbe":true)"));
    CHECK(h.State()["naoPerturbe"] == false);
    h.Send(R"({"v":1,"cmd":"setDnd","on":true})");
    CHECK(h.State()["naoPerturbe"] == true);

    // Gravado no admin.json: a proxima abertura tambem esconde (e desliga, mesmo com o config.json ligado).
    h.Send(AdminSet(R"("naoPerturbe":false)"));
    {
        SettingsStore settings(h.files, Paths().settings);
        REQUIRE(settings.Load());
        Settings changed = settings.Get();
        changed.doNotDisturb = true;
        REQUIRE(settings.Save(changed));
    }
    h.Restart();
    state = h.State();
    CHECK(state["admin"] == json({{"aberto", false}, {"naoPerturbe", false}, {"atenderAuto", false}, {"blf", false}}));
    CHECK(state["naoPerturbe"] == false);
    CHECK(h.File("dados/config.json")["nao_perturbe"] == false);
}

TEST_CASE("admin commands need an open session and lock after five wrong passwords") {
    Harness h;
    h.Start();
    CHECK(h.channels == std::vector<std::string>{""});   // o canal do build
    json state = h.State();
    CHECK(state["admin"] == json({{"aberto", false}, {"naoPerturbe", true}, {"atenderAuto", true}, {"blf", false}}));
    CHECK(state["entrarAdmin"] == json({{"erro", ""}, {"esperaAte", 0}}));

    h.Send(AdminSet(R"("blf":true)"));
    CHECK(h.State()["admin"]["blf"] == false);
    CHECK(h.files.files.count("dados/admin.json") == 0);

    for (int i = 0; i < 4; ++i) h.Send(kWrongAdmin);
    state = h.State();
    CHECK(state["admin"]["aberto"] == false);
    CHECK(state["entrarAdmin"] == json({{"erro", kWrongPassword}, {"esperaAte", 0}}));
    h.Send(kWrongAdmin);
    const int64_t until = h.time.NowMs() + 30000;
    CHECK(h.State()["entrarAdmin"] == json({{"erro", kWrongPassword}, {"esperaAte", until}}));
    // Na espera, nem a certa entra.
    h.Send(kAdminLogin);
    CHECK(h.State()["admin"]["aberto"] == false);
    CHECK(h.State()["entrarAdmin"]["esperaAte"] == until);
    h.time.Advance(29999);
    h.Send(kAdminLogin);
    CHECK(h.State()["admin"]["aberto"] == false);
    h.time.Advance(1);
    h.Send(kAdminLogin);
    state = h.State();
    CHECK(state["entrarAdmin"] == json({{"erro", ""}, {"esperaAte", 0}}));
    CHECK(state["admin"] == json({{"aberto", true},
                                  {"naoPerturbe", true},
                                  {"atenderAuto", true},
                                  {"blf", false},
                                  {"puxar", false},
                                  {"codigoPuxar", ""},
                                  {"servidores", json::array({json({{"endereco", "starcloud1-starsonic.com.br"},
                                                                    {"porta", 35060}})})},
                                  {"canal", ""}}));

    h.Send(AdminSet(R"("blf":true,"puxar":true,"codigoPuxar":"*8","canal":"estavel")"));
    state = h.State();
    CHECK(state["admin"]["blf"] == true);
    CHECK(state["admin"]["puxar"] == true);
    CHECK(state["admin"]["codigoPuxar"] == "*8");
    CHECK(state["admin"]["canal"] == "estavel");
    CHECK(h.channels == std::vector<std::string>{"", "estavel"});
    REQUIRE(h.files.files.count("dados/admin.json") == 1);
    CHECK(h.files.files["dados/admin.json"].compare(0, 4, "enc:") == 0);   // pelo cifrador
    // Um valor que a loja recusa: nada muda, e o motivo vai como toast.
    h.Send(AdminSet(R"("canal":"beta","blf":false)"));
    CHECK(h.State()["admin"]["canal"] == "estavel");
    CHECK(h.State()["admin"]["blf"] == true);
    CHECK(h.Toasts().back() == "Escolha o canal Teste ou Est\xc3\xa1vel.");
    CHECK(h.channels.size() == 2);

    h.Send(R"({"v":1,"cmd":"adminLogout"})");
    CHECK(h.State()["admin"] == json({{"aberto", false}, {"naoPerturbe", true}, {"atenderAuto", true}, {"blf", true}}));
    h.Send(AdminSet(R"("puxar":false)"));
    h.Send(kAdminLogin);
    CHECK(h.State()["admin"]["puxar"] == true);

    // A certa zera a conta dos erros seguidos.
    h.Send(R"({"v":1,"cmd":"adminLogout"})");
    for (int i = 0; i < 3; ++i) h.Send(kWrongAdmin);
    h.Send(kAdminLogin);
    h.Send(R"({"v":1,"cmd":"adminLogout"})");
    for (int i = 0; i < 4; ++i) h.Send(kWrongAdmin);
    CHECK(h.State()["entrarAdmin"]["esperaAte"] == 0);

    // A senha digitada nunca vai ao diagnostico nem ao estado.
    for (const std::string& line : h.logs) {
        CHECK(line.find("senha-de-teste") == std::string::npos);
        CHECK(line.find("outra-senha") == std::string::npos);
    }
    for (const std::string& post : h.posts) CHECK(post.find("senha-de-teste") == std::string::npos);
    // O canal gravado vale na proxima abertura.
    h.Restart();
    CHECK(h.channels.back() == "estavel");
}

TEST_CASE("admin session closes after ten idle minutes") {
    Harness h;
    h.Start();
    h.Send(kAdminLogin);
    REQUIRE(h.State()["admin"]["aberto"] == true);
    h.time.Advance(9 * 60000);
    h.Run();
    h.Send(AdminSet(R"("blf":true)"));   // um comando do administrador recomeca a contagem
    h.time.Advance(9 * 60000);
    h.Run();
    CHECK(h.State()["admin"]["aberto"] == true);
    h.Send(R"({"v":1,"cmd":"viewRecents"})");   // qualquer comando com a area aberta tambem
    h.time.Advance(9 * 60000);
    h.Run();
    CHECK(h.State()["admin"]["aberto"] == true);
    h.time.Advance(60000);
    h.Run();
    CHECK(h.State()["admin"] == json({{"aberto", false}, {"naoPerturbe", true}, {"atenderAuto", true}, {"blf", true}}));
    h.Send(AdminSet(R"("blf":false)"));
    CHECK(h.State()["admin"]["blf"] == true);

    // Fechar a janela (para a bandeja) tambem fecha a area.
    h.Send(kAdminLogin);
    h.Send(R"({"v":1,"cmd":"closeToTray"})");
    CHECK(h.State()["admin"]["aberto"] == false);
}

TEST_CASE("admin servers change the account port") {
    Harness h;
    h.SeedAccount(L"starcloud1-starsonic.com.br", L"2001", L"segredo", true);
    h.Start();
    REQUIRE(h.port.accounts.size() == 1);
    // Sem admin.json: as portas do perfil.
    REQUIRE(h.port.accounts[0].serverPorts.has_value());
    REQUIRE(h.port.accounts[0].serverPorts->size() == 1);
    CHECK(h.port.accounts[0].serverPorts->at(0).address == L"starcloud1-starsonic.com.br");
    CHECK(h.port.accounts[0].serverPorts->at(0).port == 35060);
    h.app->OnRegistration(200, true, 1);
    h.Run();

    h.Send(kAdminLogin);
    h.Send(AdminSet(R"("servidores":[{"endereco":"starcloud1-starsonic.com.br","porta":5090},)"
                    R"({"endereco":"pbx.example.com","porta":5070}])"));
    // A porta do servidor em uso mudou: a conta registra de novo com ela.
    REQUIRE(h.port.accounts.size() == 2);
    const AccountInput& input = h.port.accounts[1];
    REQUIRE(input.serverPorts.has_value());
    AccountProfile profile;
    profile.port = 5060;
    profile.serverPorts = *input.serverPorts;
    CHECK(BuildAccount(profile, input.address, input.ramal, input.senha, input.transport, L"").server ==
          L"starcloud1-starsonic.com.br:5090");
    CHECK(BuildAccount(profile, L"pbx.example.com", L"1", L"x", Transport::Udp, L"").server == L"pbx.example.com:5070");
    CHECK(h.State()["admin"]["servidores"] ==
          json::array({json({{"endereco", "starcloud1-starsonic.com.br"}, {"porta", 5090}}),
                       json({{"endereco", "pbx.example.com"}, {"porta", 5070}})}));
    h.app->OnRegistration(200, true, 2);
    h.Run();

    // Outro servidor muda: a conta em uso fica como esta.
    h.Send(AdminSet(R"("servidores":[{"endereco":"starcloud1-starsonic.com.br","porta":5090}])"));
    CHECK(h.port.accounts.size() == 2);

    // Com uma ligacao, a conta registra de novo so no fim dela.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.Send(AdminSet(R"("servidores":[])"));   // sem a linha: a porta padrao do perfil
    CHECK(h.port.accounts.size() == 2);
    CHECK(h.port.removes == 0);
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();
    REQUIRE(h.port.accounts.size() == 3);
    CHECK(h.port.accounts[2].serverPorts->empty());
    CHECK(h.State()["conta"]["status"] == "conectando");

    // Uma porta invalida e recusada (com o motivo), e nada muda.
    h.Send(AdminSet(R"("servidores":[{"endereco":"pbx.example.com","porta":70000}])"));
    CHECK(h.State()["admin"]["servidores"] == json::array());
    CHECK(h.port.accounts.size() == 3);
    CHECK_FALSE(h.Toasts().empty());

    // O Entrar de uma conta nova tambem usa a lista do administrador.
    h.Send(AdminSet(R"("servidores":[{"endereco":"pbx.example.com","porta":5070}])"));
    h.Send(Login("pbx.example.com", "3001", "outra"));
    REQUIRE(h.port.accounts.size() == 4);
    REQUIRE(h.port.accounts[3].serverPorts->size() == 1);
    CHECK(h.port.accounts[3].serverPorts->at(0).port == 5070);
}

TEST_CASE("internet loss mid-call drops to gray and beeps once") {
    Harness h;
    h.StartRegistered();
    CHECK(h.State()["conta"]["internet"] == true);
    h.app->SetInternet(true);   // sem mudanca: nada
    h.Run();
    CHECK(h.port.network.empty());

    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.Run();
    h.app->SetInternet(false);
    h.Run();
    CHECK(h.port.network == std::vector<bool>{false});
    CHECK(h.State()["conta"]["internet"] == false);
    CHECK(EndBeeps(h) == 0);
    // O motor encerra a ligacao que caiu: um bipe, e nada e discado de novo.
    h.app->OnCallState(10, CallState::Disconnected, 408);
    h.Run();
    CHECK(EndBeeps(h) == 1);
    CHECK(h.engine.made == std::vector<std::string>{"2002"});
    CHECK(h.State()["ligacao"].is_null());
    // Sem internet, o Ligar avisa que nao ha conexao.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2003"})");
    CHECK(h.engine.made.size() == 1);
    CHECK(h.Toasts().back() == kNoConnection);
    h.app->SetInternet(false);
    h.Run();
    CHECK(h.port.network.size() == 1);

    // Volta: o motor registra de novo (Conectando, depois Conectado).
    h.app->SetInternet(true);
    h.Run();
    CHECK(h.port.network == std::vector<bool>{false, true});
    CHECK(h.State()["conta"]["internet"] == true);
    CHECK(h.State()["conta"]["status"] == "conectando");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Run();
    CHECK(h.State()["conta"]["status"] == "conectado");
    CHECK(EndBeeps(h) == 1);
}

TEST_CASE("the end beep plays only for answered calls with no other call left") {
    Harness h;
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
    CHECK(EndBeeps(h) == 0);

    // A atendida acaba com a segunda tocando: nada; a segunda e perdida: nada.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(11, CallState::Confirmed, 200);
    h.app->OnIncomingCall(22, "2004", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"hangup","id":11})");
    h.app->OnCallState(11, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 0);
    h.app->OnCallState(22, CallState::Disconnected, 487);
    h.Run();
    CHECK(EndBeeps(h) == 0);

    // Duas atendidas: a primeira que acaba nao bipa (a outra continua); a ultima, sim.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(12, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2005"})");
    h.app->OnCallState(13, CallState::Confirmed, 200);
    h.Run();
    h.app->OnCallState(13, CallState::Disconnected, 200);   // o outro lado desligou
    h.Run();
    CHECK(EndBeeps(h) == 0);
    h.Send(R"({"v":1,"cmd":"hangup","id":12})");          // a propria pessoa desligou
    h.app->OnCallState(12, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 1);

    // A conferencia: as duas acabam juntas, um bipe so.
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(14, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"dial","numero":"2005"})");
    h.app->OnCallState(15, CallState::Confirmed, 200);
    h.Run();
    h.Send(R"({"v":1,"cmd":"join"})");
    h.Send(R"({"v":1,"cmd":"hangup"})");
    h.app->OnCallState(14, CallState::Disconnected, 200);
    h.app->OnCallState(15, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 2);

    // A recebida atendida tambem bipa; o bipe nao volta no ready.
    h.app->OnIncomingCall(23, "2006", "");
    h.Run();
    h.Send(R"({"v":1,"cmd":"answer"})");
    h.app->OnCallState(23, CallState::Confirmed, 200);
    h.app->OnCallState(23, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 3);
    h.Send(R"({"v":1,"cmd":"ready"})");
    CHECK(EndBeeps(h) == 3);
}

TEST_CASE("bipeFim off silences the end beep") {
    Harness h;
    h.StartRegistered();
    CHECK(h.State()["config"] == json({{"bipeFim", true}}));
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":false})");
    CHECK(h.State()["config"]["bipeFim"] == false);
    CHECK(h.File("dados/config.json")["bipe_fim"] == false);
    CHECK(h.host.empty());   // nao e o Iniciar com o Windows
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(10, CallState::Confirmed, 200);
    h.app->OnCallState(10, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 0);

    h.Restart();
    CHECK(h.State()["config"]["bipeFim"] == false);
    h.Send(R"({"v":1,"cmd":"setSetting","chave":"bipeFim","valor":true})");
    h.app->OnRegistration(200, true, h.port.LastId());
    h.Send(R"({"v":1,"cmd":"dial","numero":"2002"})");
    h.app->OnCallState(11, CallState::Confirmed, 200);
    h.app->OnCallState(11, CallState::Disconnected, 200);
    h.Run();
    CHECK(EndBeeps(h) == 1);
}
