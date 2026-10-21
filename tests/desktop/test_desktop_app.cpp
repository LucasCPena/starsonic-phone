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

    int SetAccount(const AccountInput& input) override {
        accounts.push_back(input);
        return refuse ? 0 : nextId++;
    }
    void RemoveAccount() override { ++removes; }
    std::vector<AudioDevice> AudioDevices() override { return devices; }
    bool SetAudioDevices(int captureId, int playbackId) override {
        audio.emplace_back(captureId, playbackId);
        return true;
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
    std::unique_ptr<DesktopApp> app;

    Harness() { Make(); }

    void Make() {
        DesktopConfig config;
        config.paths = Paths();
        config.version = "0.1.0-rc.1";
        config.decrypt = ToyDecrypt;
        DesktopHooks hooks;
        hooks.post = [this](const std::string& message) { posts.push_back(message); };
        hooks.log = [this](const std::string& line) { logs.push_back(line); };
        hooks.openUrl = [this](const std::string& url) { opened.push_back(url); };
        hooks.minimize = [this] { host.push_back("minimize"); };
        hooks.closeToTray = [this] { host.push_back("closeToTray"); };
        hooks.quit = [this] { host.push_back("quit"); };
        hooks.sendDiagnostics = [this] { host.push_back("sendDiagnostics"); };
        hooks.setStartWithWindows = [this](bool on) { host.push_back(on ? "autostart on" : "autostart off"); };
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

TEST_CASE("openExternal refuses other urls") {
    Harness h;
    h.Start();
    for (const char* url : {"https://example.com", "https://starsonic.com.br.evil.com", "javascript:alert(1)",
                            "file:///C:/Windows", "tel:2003", "https://wa.me/5511999999999"}) {
        h.Send(std::string(R"({"v":1,"cmd":"openExternal","url":")") + url + "\"}");
    }
    CHECK(h.opened.empty());
    CHECK(h.Logged("openExternal"));
    for (const char* url : {"https://starsonic.com.br", "https://starsonic.com.br/", "https://wa.me/551150603000",
                            "tel:+551150603000", "https://github.com/LucasCPena/starsonic-phone"}) {
        h.Send(std::string(R"({"v":1,"cmd":"openExternal","url":")") + url + "\"}");
    }
    CHECK(h.opened == std::vector<std::string>{"https://starsonic.com.br", "https://starsonic.com.br/",
                                               "https://wa.me/551150603000", "tel:+551150603000",
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
    CHECK(h.host == std::vector<std::string>{"minimize", "closeToTray", "sendDiagnostics", "autostart off"});
    CHECK(h.State()["iniciarComWindows"] == false);
    CHECK(h.File("dados/config.json")["iniciar_com_windows"] == false);
    CHECK(h.State()["versao"] == "0.1.0-rc.1");
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
