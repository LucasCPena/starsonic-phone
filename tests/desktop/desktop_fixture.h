#pragma once
// O apoio dos testes do orquestrador do app de PC (starsonic/desktop/DesktopApp.h): test_desktop_app.cpp e
// test_iphone_mode.cpp. O motor falso do controlador (tests/phone/fake_call_engine.h, Ruling 2 da W1), um registro
// falso, o disco na memoria e uma fila de comandos que o teste roda na mao (Run): tudo numa thread so, na ordem em que
// a fila de verdade rodaria. Tudo no namespace anonimo: cada arquivo de teste tem a sua copia.
#include <deque>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "DesktopApp.h"
#include "nlohmann/json.hpp"
#include "phone/fake_call_engine.h"
#include "test_support.h"

using namespace starsonic;
using nlohmann::json;

namespace {

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

inline std::optional<std::wstring> ToyDecrypt(const std::wstring& encrypted) {
    const std::wstring prefix = L"cifrada:";
    if (encrypted.compare(0, prefix.size(), prefix) != 0) return std::nullopt;
    return encrypted.substr(prefix.size());
}

inline DesktopPaths Paths() {
    DesktopPaths paths;
    paths.accounts = "dados/contas.json";
    paths.contacts = "dados/contatos.json";
    paths.recents = "dados/recentes.json";
    paths.settings = "dados/config.json";
    paths.atalhos = "dados/atalhos.json";
    paths.admin = "dados/admin.json";
    paths.companyList = "dados/contatos-empresa.json";
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
    // rc.4: as janelas de importar e de exportar e as leituras da lista da empresa, na ordem dos pedidos, com o
    // callback de cada um: o teste responde quando quiser (o callback so poe na fila; Run a roda).
    std::vector<std::function<void(const std::string& path)>> importPicks;
    std::vector<std::function<void(const std::string& path, const std::string& format)>> exportPicks;
    struct Fetch {
        CompanySource source;
        std::function<void(const CompanyFetch& result)> done;
    };
    std::vector<Fetch> fetches;
    bool sheetHooks = true;   // false: o executavel sem os tres ganchos (antes da Task 7)
    // O modo do nucleo (DesktopConfig::platform): o Windows, ou o iPhone com Harness h(Platform::IPhone). Vale tambem
    // no Restart.
    Platform platform = Platform::Windows;
    std::unique_ptr<DesktopApp> app;

    Harness() { Make(); }
    explicit Harness(Platform mode) : platform(mode) { Make(); }

    std::optional<bool> observedAutostart;   // o que o executavel viu no registro (nada: nao viu)
    void Make() {
        DesktopConfig config;
        config.platform = platform;
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
        // Os do iPhone: a aba Contatos que abriu (contactsOpened), o Permitir (allowContacts), o botao Audio
        // (audioRoute), o bipe de cada tecla (keyTone, com " na ligacao" quando ha uma), o bipe do fim e o aviso da
        // perdida (com o texto).
        hooks.readAgenda = [this] { host.push_back("readAgenda"); };
        hooks.allowContacts = [this] { host.push_back("allowContacts"); };
        hooks.chooseAudioRoute = [this] { host.push_back("chooseAudioRoute"); };
        hooks.keyTone = [this](const std::string& key, bool inCall) {
            host.push_back("keyTone " + key + (inCall ? " na ligacao" : ""));
        };
        hooks.endBeep = [this] { host.push_back("endBeep"); };
        hooks.missedCall = [this](const std::string& text) { host.push_back("missedCall " + text); };
        if (sheetHooks) {
            hooks.pickImportFile = [this](std::function<void(const std::string&)> done) {
                importPicks.push_back(std::move(done));
            };
            hooks.pickExportFile = [this](std::function<void(const std::string&, const std::string&)> done) {
                exportPicks.push_back(std::move(done));
            };
            hooks.fetchCompanyList = [this](const CompanySource& source,
                                            std::function<void(const CompanyFetch&)> done) {
                fetches.push_back(Fetch{source, std::move(done)});
            };
        }
        auto executor = std::make_unique<QueueExecutor>();
        queue = executor.get();
        app = std::make_unique<DesktopApp>(config, hooks, engine, port, files, cipher, time, time, std::move(executor));
    }

    // Fecha o app (como o executavel) e abre um novo sobre o mesmo disco.
    void Restart() {
        app->Shutdown();
        app.reset();
        posts.clear();
        // Os callbacks dos pedidos do app que fechou nao valem mais.
        importPicks.clear();
        exportPicks.clear();
        fetches.clear();
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

    // rc.4: a planilha da empresa gravada no config.json, e a ultima lista dela no contatos-empresa.json, antes da
    // abertura.
    void SeedCompanyLink(const std::string& link) {
        SettingsStore store(files, Paths().settings);
        store.Load();
        Settings settings = store.Get();
        settings.companyListLink = link;
        REQUIRE(store.Save(settings));
    }
    void SeedCompanyList(const std::vector<SheetContact>& contacts, int64_t updatedMs) {
        CompanyListStore store(files, Paths().companyList);
        REQUIRE(store.Replace(contacts, updatedMs));
    }
    // A janela de importar <index> (na ordem em que abriram) responde com o caminho, e a fila roda.
    void AnswerImport(size_t index, const std::string& path) {
        REQUIRE(index < importPicks.size());
        importPicks[index](path);
        Run();
    }
    // A janela de exportar <index> responde com o caminho e o formato, e a fila roda.
    void AnswerExport(size_t index, const std::string& path, const std::string& format) {
        REQUIRE(index < exportPicks.size());
        exportPicks[index](path, format);
        Run();
    }
    // A resposta da leitura <index> (na ordem dos pedidos) chega, e a fila roda.
    void AnswerFetch(size_t index, const CompanyFetch& result) {
        REQUIRE(index < fetches.size());
        fetches[index].done(result);
        Run();
    }
};

inline std::string Login(const std::string& server, const std::string& ramal, const std::string& senha,
                         const std::string& extra = "") {
    return R"({"v":1,"cmd":"login","servidor":")" + server + R"(","protocolo":"tcp","ramal":")" + ramal +
           R"(","senha":")" + senha + R"(","nome":"Recep")" + extra + "}";
}

}  // namespace
