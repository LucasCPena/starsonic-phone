// O StarsonicPhone.exe do app novo (spec da W1, secao 6): a janela com o WebView2 (a interface de windows/ui), o
// nucleo do app de PC (DesktopApp) e o motor (SipEngine). O executavel so hospeda: as regras ficam no DesktopApp.
//
// Linha de comando:
//   StarsonicPhone.exe                  abre o app (dados em %APPDATA%\Starsonic Phone)
//   StarsonicPhone.exe --dados <pasta>  abre com outra pasta de dados (os testes)
//   StarsonicPhone.exe --sair           manda o Sair para o app aberto (codigo 0) e volta; 1 se nenhum esta aberto
// No build de teste (STARSONIC_TEST_HOOKS), a variavel STARSONIC_PERFIL troca o perfil embutido pelo texto dela (um
// perfil que aponta para o registrador falso).
#include <windows.h>

#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>

#include <climits>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "DesktopApp.h"
#include "DiagLog.h"
#include "DpapiCipher.h"
#include "EngineHost.h"
#include "LegacyCrypto.h"
#include "MainWindow.h"
#include "Profile.h"
#include "Stores.h"
#include "Text.h"
#include "Threads.h"
#include "WinFiles.h"
#include "app_build.h"
#include "nlohmann/json.hpp"
#include "resource.h"

using namespace starsonic;

namespace {

const wchar_t kAppFolder[] = L"Starsonic Phone";
const wchar_t kNoWebView[] = L"O Starsonic Phone precisa do WebView2 da Microsoft. Reinstale o Starsonic Phone.";
const char kQuitCommand[] = "{\"v\":1,\"cmd\":\"quit\"}";

struct Arguments {
    std::wstring dataFolder;   // "" = a pasta de sempre
    bool quit = false;         // --sair
};

Arguments ParseArguments() {
    Arguments arguments;
    int count = 0;
    LPWSTR* list = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!list) return arguments;
    for (int i = 1; i < count; ++i) {
        const std::wstring item = list[i];
        if (item == L"--dados" && i + 1 < count) {
            arguments.dataFolder = list[++i];
        } else if (item == L"--sair") {
            arguments.quit = true;
        }
        // Os links (tel:, sip:, callto:) e a segunda abertura chegam na Task 12.
    }
    LocalFree(list);
    return arguments;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr;
    std::wstring out;
    if (SUCCEEDED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &path)) && path) out = path;
    CoTaskMemFree(path);
    return out;
}

std::wstring FullPath(const std::wstring& path) {
    const DWORD size = GetFullPathNameW(path.c_str(), 0, nullptr, nullptr);
    if (size == 0) return path;
    std::wstring out(size, L'\0');
    const DWORD written = GetFullPathNameW(path.c_str(), size, &out[0], nullptr);
    out.resize(written);
    while (out.size() > 3 && (out.back() == L'\\' || out.back() == L'/')) out.pop_back();
    return out;
}

std::wstring ExeFolder() {
    std::wstring path(MAX_PATH, L'\0');
    for (;;) {
        const DWORD written = GetModuleFileNameW(nullptr, &path[0], static_cast<DWORD>(path.size()));
        if (written == 0) return L".";
        if (written < path.size()) {
            path.resize(written);
            break;
        }
        path.resize(path.size() * 2);
    }
    const size_t slash = path.find_last_of(L"\\/");
    return slash == std::wstring::npos ? L"." : path.substr(0, slash);
}

std::string ProfileText(HINSTANCE instance) {
#if STARSONIC_TEST_HOOKS
    // O perfil de teste (o registrador falso), so no build de teste.
    const DWORD size = GetEnvironmentVariableW(L"STARSONIC_PERFIL", nullptr, 0);
    if (size > 1) {
        std::wstring text(size, L'\0');
        text.resize(GetEnvironmentVariableW(L"STARSONIC_PERFIL", &text[0], size));
        return WideToUtf8(text);
    }
#endif
    const HRSRC found = FindResourceW(instance, MAKEINTRESOURCEW(IDR_PERFIL), MAKEINTRESOURCEW(10) /* RT_RCDATA */);
    if (!found) return std::string();
    const HGLOBAL loaded = LoadResource(instance, found);
    const void* data = loaded ? LockResource(loaded) : nullptr;
    if (!data) return std::string();
    std::string text(static_cast<const char*>(data), SizeofResource(instance, found));
    if (text.compare(0, 3, "\xEF\xBB\xBF") == 0) text.erase(0, 3);
    return text;
}

// --sair: o Sair para a janela do app aberto.
int SendQuit() {
    const HWND window = FindWindowW(MainWindow::kClassName, nullptr);
    if (!window) return 1;
    return PostMessageW(window, MainWindow::QuitMessage(), 0, 0) ? 0 : 1;
}

bool IsReady(const std::string& json) {
    const nlohmann::json parsed = nlohmann::json::parse(json, nullptr, /*allow_exceptions=*/false);
    if (!parsed.is_object()) return false;
    const auto found = parsed.find("cmd");
    return found != parsed.end() && found->is_string() && found->get<std::string>() == "ready";
}

void OpenUrl(const std::string& url) {
    // O DesktopApp so deixa passar os links do Sobre e da ajuda (AllowedUrl).
    ShellExecuteW(nullptr, L"open", Utf8ToWide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

// "Enviar diagnostico": a pasta do diagnostico.log aberta, com ele selecionado (a copia e o envio chegam na Task 12).
void ShowDiagnostics(const std::wstring& logPath) {
    const std::wstring parameters = L"/select,\"" + logPath + L"\"";
    ShellExecuteW(nullptr, L"open", L"explorer.exe", parameters.c_str(), nullptr, SW_SHOWNORMAL);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    const Arguments arguments = ParseArguments();
    if (arguments.quit) return SendQuit();

    // A pasta de dados (spec 6.6) e o diagnostico.
    const bool customData = !arguments.dataFolder.empty();
    const std::wstring dataFolder =
        customData ? FullPath(arguments.dataFolder) : KnownFolder(FOLDERID_RoamingAppData) + L"\\" + kAppFolder;
    if (!CreateFolderTree(dataFolder)) return 2;
    const std::wstring logPath = dataFolder + L"\\diagnostico.log";
    DiagLog diag(logPath);
    auto log = [&diag](const std::string& line) { diag.Write(line); };
    log(std::string("Starsonic Phone ") + STARSONIC_VERSION + " abrindo" + (customData ? " (pasta de dados do --dados)" : ""));

    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    // O perfil embutido (ou o de teste).
    Profile profile;
    const ParseResult parsed = ParseProfile(Utf8ToWide(ProfileText(instance)), &profile);
    if (!parsed.ok) {
        log("perfil invalido (linha " + std::to_string(parsed.errorLine) + "): " + WideToUtf8(parsed.errorMessage));
        if (SUCCEEDED(com)) CoUninitialize();
        return 3;
    }

    const std::string data = WideToUtf8(dataFolder);
    DesktopConfig config;
    config.paths.accounts = data + "\\contas.json";
    config.paths.contacts = data + "\\contatos.json";
    config.paths.recents = data + "\\recentes.json";
    config.paths.settings = data + "\\config.json";
    // A rc.7 guardava tudo na mesma pasta (o %APPDATA%\Starsonic Phone do MicroSIP instalado).
    config.paths.legacy.ini = data + "\\StarsonicPhone.ini";
    config.paths.legacy.contactsXml = data + "\\Contacts.xml";
    config.paths.legacy.callsDb = data + "\\call_log.db";
    config.profile = profile;
    config.version = STARSONIC_VERSION;
    config.decrypt = [](const std::wstring& encrypted) { return LegacyDecrypt(encrypted); };

    WinFiles files;
    DpapiCipher cipher;
    SystemClock clock;
    ThreadScheduler scheduler;

    EngineConfig engineConfig;
    engineConfig.userAgent = std::string("Starsonic Phone/") + STARSONIC_VERSION;
    engineConfig.profile = profile;
    EngineHost engine(engineConfig, log);

    // A posicao gravada da janela (o DesktopApp le o config.json de novo na abertura dele).
    std::optional<POINT> position;
    {
        SettingsStore stored(files, config.paths.settings);
        stored.Load();
        const Settings settings = stored.Get();
        if (settings.windowX != INT_MIN && settings.windowY != INT_MIN) position = POINT{settings.windowX, settings.windowY};
    }

    MainWindow window;   // antes do DesktopApp: os ganchos dele chegam na janela ate o Shutdown

    DesktopHooks hooks;
    hooks.post = [&window](const std::string& json) { window.PostToWeb(json); };
    hooks.log = log;
    hooks.openUrl = [&window](const std::string& url) { window.RunOnWindow([url] { OpenUrl(url); }); };
    hooks.minimize = [&window] { window.RunOnWindow([&window] { window.Minimize(); }); };
    hooks.closeToTray = [&window] { window.RunOnWindow([&window] { window.CloseToTray(); }); };
    hooks.quit = [&window] { window.RunOnWindow([&window] { window.Close(); }); };
    hooks.sendDiagnostics = [&window, logPath] { window.RunOnWindow([logPath] { ShowDiagnostics(logPath); }); };
    // O Iniciar com o Windows (HKCU\...\Run) chega na Task 12: por ora so fica gravado no config.json.

    DesktopApp app(config, hooks, engine, engine, files, cipher, clock, scheduler);
    engine.SetListener(&app);
    engine.Start();
    app.Start();

    bool outputsLogged = false;
    MainWindow::Callbacks callbacks;
    callbacks.command = [&app, &window, &outputsLogged](const std::string& json) {
        if (!outputsLogged && IsReady(json)) {
            outputsLogged = true;
            window.LogAudioOutputs();   // os rotulos do WebView2, para comparar com os nomes do motor
        }
        app.HandleCommand(json);
    };
    callbacks.moved = [&app](int x, int y) { app.SaveWindowPosition(x, y); };
    callbacks.quitRequested = [&app] { app.HandleCommand(kQuitCommand); };
    callbacks.log = log;
    callbacks.webViewFailed = [&app, &window](HRESULT) {
        window.RunOnWindow([&app] {
            MessageBoxW(nullptr, kNoWebView, L"Starsonic Phone", MB_ICONERROR | MB_OK);
            app.HandleCommand(kQuitCommand);
        });
    };

    MainWindow::Options options;
    options.userDataFolder = KnownFolder(FOLDERID_LocalAppData) + L"\\" + kAppFolder + L"\\WebView2";
    options.uiFolder = ExeFolder() + L"\\ui";
    options.devTools = STARSONIC_TEST_HOOKS != 0;
    options.position = position;
    int exitCode = 0;
    if (window.Create(instance, options, callbacks)) {
        window.Show(SW_SHOWNORMAL);   // abrir na bandeja (o Iniciar com o Windows) chega na Task 12
        MSG message;
        while (GetMessageW(&message, nullptr, 0, 0) > 0) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    } else {
        exitCode = 4;
    }

    // Fechar (DesktopApp.h): a fila roda o que tinha (os Recentes das ligacoes que o Sair encerrou), o agendador
    // para, e o motor sai antes de o DesktopApp ser destruido.
    log("fechando");
    app.Shutdown();
    scheduler.Stop();
    engine.Stop();
    log("fechado");
    if (SUCCEEDED(com)) CoUninitialize();
    return exitCode;
}
