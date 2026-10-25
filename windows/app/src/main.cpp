// O StarsonicPhone.exe do app novo (spec da W1, secao 6): a janela com o WebView2 (a interface de windows/ui), o
// nucleo do app de PC (DesktopApp) e o motor (SipEngine). O executavel so hospeda: as regras ficam no DesktopApp.
//
// Linha de comando:
//   StarsonicPhone.exe                  abre o app (dados em %APPDATA%\Starsonic Phone)
//   StarsonicPhone.exe --dados <pasta>  abre com outra pasta de dados (os testes; so como o primeiro argumento)
//   StarsonicPhone.exe --bandeja        abre escondido na bandeja (o Iniciar com o Windows; o /minimized da rc.7 tambem)
//   StarsonicPhone.exe --link tel:2003  abre com o numero no Teclado (tambem sip: e callto:; nunca liga sozinho); o
//                                       registro dos links; tudo depois do --link e o link, e nenhuma opcao vale
//   StarsonicPhone.exe --sair           manda o Sair para o app aberto (codigo 0) e volta; 1 se nenhum esta aberto
// Com o app ja aberto, uma abertura nova so entrega os argumentos dela ao aberto (SingleInstance) e sai com o codigo 0:
// o link vai para o Teclado, o --sair fecha o app, e sem nada a janela vem para a frente.
// No build de teste (STARSONIC_TEST_HOOKS), a variavel STARSONIC_PERFIL troca o perfil embutido pelo texto dela (um
// perfil que aponta para o registrador falso), e a STARSONIC_SOM_NULO poe o motor no dispositivo nulo do PJSIP (o
// runner do CI nao tem placa de som, e sem nenhum dispositivo o PJSIP nao faz nem atende ligacoes), e a
// STARSONIC_TRAVAR_SAIR trava a thread de comandos no Sair (a fumaca confere o fechamento com limite). (rc.3) A
// STARSONIC_SENHA_ADMIN_TESTE troca a senha do administrador pelo texto dela (a fumaca entra na area sem a senha de
// verdade), uma abertura com "--teste-internet off" (ou "on") com o app aberto forca o monitor de rede a ver a internet
// fora (ou devolve a visao de verdade), e a STARSONIC_TESTE_DNS_MS encurta o intervalo do monitor de rede (o teste DNS),
// com cada resultado no diagnostico (a fumaca com o servidor por nome).
//
// Fechar: todo Sair (o da interface, o da bandeja, o --sair, o Alt+F4, o do atualizador) passa pelo WM_CLOSE da
// janela, que fecha no maximo 10 s depois mesmo sem o DesktopApp terminar (Ruling 16); depois da janela, o fechamento
// do DesktopApp e do motor tem 5 s: passou disso, "fechamento forcado" no diagnostico e o processo sai (codigo 0),
// sem deixar um processo sem janela segurando a instancia unica.
#include <windows.h>

#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>

#include <climits>
#include <cwchar>
#include <memory>
#include <thread>
#include <optional>
#include <string>
#include <vector>

#include "AppUpdater.h"
#include "Autostart.h"
#include "DesktopApp.h"
#include "DiagLog.h"
#include "Diagnostics.h"
#include "DpapiCipher.h"
#include "EngineHost.h"
#include "LegacyCrypto.h"
#include "Links.h"
#include "MainWindow.h"
#include "NetworkMonitor.h"
#include "Profile.h"
#include "ShellState.h"
#include "SingleInstance.h"
#include "Stores.h"
#include "Text.h"
#include "Threads.h"
#include "UpdateChannel.h"
#include "WinFiles.h"
#include "app_build.h"
#include "resource.h"

using namespace starsonic;

namespace {

const wchar_t kAppFolder[] = L"Starsonic Phone";
const wchar_t kNoWebView[] = L"O Starsonic Phone precisa do WebView2 da Microsoft. Reinstale o Starsonic Phone.";
const char kQuitCommand[] = "{\"v\":1,\"cmd\":\"quit\"}";
// A verificacao de atualizacao: um minuto depois de abrir (a rede e o registro primeiro) e a cada 24 h.
const unsigned long kFirstUpdateCheckMs = 60UL * 1000UL;
const unsigned long kUpdateIntervalMs = 24UL * 60UL * 60UL * 1000UL;
// O logoff do Windows: quanto o Sair espera o DesktopApp encerrar as ligacoes (os Recentes delas).
const DWORD kEndSessionWaitMs = 3000;
// Depois de a janela fechar: quanto o DesktopApp e o motor tem para fechar antes de o processo sair assim mesmo.
const DWORD kShutdownLimitMs = 5000;


std::vector<std::wstring> CommandLineArguments() {
    std::vector<std::wstring> out;
    int count = 0;
    LPWSTR* list = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!list) return out;
    for (int i = 1; i < count; ++i) out.emplace_back(list[i]);
    LocalFree(list);
    return out;
}

std::wstring ExePath() {
    std::wstring path(MAX_PATH, L'\0');
    for (;;) {
        const DWORD written = GetModuleFileNameW(nullptr, &path[0], static_cast<DWORD>(path.size()));
        if (written == 0) return std::wstring();
        if (written < path.size()) {
            path.resize(written);
            return path;
        }
        path.resize(path.size() * 2);
    }
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
    const std::wstring path = ExePath();
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

void OpenUrl(const std::string& url) {
    // O DesktopApp so deixa passar os links do Sobre (AllowedUrl).
    ShellExecuteW(nullptr, L"open", Utf8ToWide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

#if STARSONIC_TEST_HOOKS
// O texto de uma variavel de ambiente ("" sem ela).
std::wstring Environment(const wchar_t* name) {
    const DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
    if (size <= 1) return std::wstring();
    std::wstring text(size, L'\0');
    text.resize(GetEnvironmentVariableW(name, &text[0], size));
    return text;
}
#endif

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    // Os links nunca carregam opcoes (ParseCommandLine, Links.h).
    const std::vector<std::wstring> rawArguments = CommandLineArguments();
    const CommandLine arguments = ParseCommandLine(rawArguments);

    // A instancia unica: com o app ja aberto, os argumentos vao para ele (que os le do mesmo jeito) e esta abertura sai.
    SingleInstance single;
    const SingleInstance::Claim claim = single.Start(rawArguments);
    if (claim == SingleInstance::Claim::Delivered) return 0;
    if (claim == SingleInstance::Claim::NotDelivered) return 1;   // o aberto nao respondeu: nunca dois apps
    if (arguments.quit) return 1;                                 // --sair sem nenhum app aberto

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
    config.paths.atalhos = data + "\\atalhos.json";
    config.paths.admin = data + "\\admin.json";   // pelo DPAPI (o mesmo cifrador das senhas)
    // A rc.7 guardava tudo na mesma pasta (o %APPDATA%\Starsonic Phone do app antigo instalado).
    config.paths.legacy.ini = data + "\\StarsonicPhone.ini";
    config.paths.legacy.contactsXml = data + "\\Contacts.xml";
    config.paths.legacy.callsDb = data + "\\call_log.db";
    config.profile = profile;
    config.version = STARSONIC_VERSION;
    config.decrypt = [](const std::wstring& encrypted) { return LegacyDecrypt(encrypted); };
#if STARSONIC_TEST_HOOKS
    // O build de teste: a senha do administrador da fumaca (Ruling 11; a de verdade nunca vai ao CI). O texto nunca
    // vai ao diagnostico.
    const std::string testAdminPassword = WideToUtf8(Environment(L"STARSONIC_SENHA_ADMIN_TESTE"));
    if (!testAdminPassword.empty()) {
        config.checkAdminPassword = [testAdminPassword](const std::string& typed) { return typed == testAdminPassword; };
        log("STARSONIC_SENHA_ADMIN_TESTE: a area do administrador entra com a senha de teste (build de teste)");
    }
#endif

    // O Iniciar com o Windows: o registro vale mais que o config.json (o instalador pode nao ter gravado o Run, a rc.7
    // podia estar sem, a pessoa pode ter tirado no Gerenciador de Tarefas). Ligado, o valor e regravado com o caminho
    // e o --bandeja de agora (o exe que mudou de lugar, o "/minimized" da rc.7).
    const std::wstring exePath = ExePath();
    const bool autostart = ObserveAutostart();
    config.observedStartWithWindows = autostart;
    if (autostart && !SetAutostart(true, exePath)) log("iniciar com o Windows: o valor do Run nao foi regravado");

    WinFiles files;
    DpapiCipher cipher;
    SystemClock clock;
    ThreadScheduler scheduler;

    EngineConfig engineConfig;
    engineConfig.userAgent = std::string("Starsonic Phone/") + STARSONIC_VERSION;
    engineConfig.profile = profile;
#if STARSONIC_TEST_HOOKS
    if (GetEnvironmentVariableW(L"STARSONIC_SOM_NULO", nullptr, 0) > 1) {
        engineConfig.nullAudio = true;
        log("som: o dispositivo nulo (STARSONIC_SOM_NULO, build de teste)");
    }
#endif
    EngineHost engine(engineConfig, log);

    // A posicao e o tamanho gravados da janela (o DesktopApp le o config.json de novo na abertura dele).
    std::optional<POINT> position;
    std::optional<WindowSize> windowSize;
    {
        SettingsStore stored(files, config.paths.settings);
        stored.Load();
        const Settings settings = stored.Get();
        if (settings.windowX != INT_MIN && settings.windowY != INT_MIN) position = POINT{settings.windowX, settings.windowY};
        if (settings.windowW > 0 && settings.windowH > 0) windowSize = WindowSize{settings.windowW, settings.windowH};
    }

    MainWindow window;   // antes do DesktopApp: os ganchos dele chegam na janela ate o Shutdown
    std::unique_ptr<AppUpdater> updater;   // criado depois do DesktopApp; Close() antes do Shutdown dele
    // O canal de atualizacao que vale (o do administrador, pelo gancho updateChannel, ou o do build): o atualizador le a
    // cada verificacao. Antes do DesktopApp: o gancho chega na abertura dele, talvez antes de o atualizador existir.
    UpdateChannel updateChannel(STARSONIC_UPDATE_CHANNEL_TEST != 0);

    // O gancho quit ja rodou (o DesktopApp encerrou as ligacoes): o logoff do Windows espera por ele.
    const HANDLE quitDone = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    DesktopHooks hooks;
    hooks.post = [&window](const std::string& json) { window.PostToWeb(json); };
    hooks.log = log;
    hooks.openUrl = [&window](const std::string& url) { window.RunOnWindow([url] { OpenUrl(url); }); };
    hooks.minimize = [&window] { window.RunOnWindow([&window] { window.Minimize(); }); };
    hooks.closeToTray = [&window] { window.RunOnWindow([&window] { window.CloseToTray(); }); };
    // O resize das zonas da interface: so poe na fila da janela (a thread de comandos nunca espera a janela).
    hooks.resize = [&window](const std::string& edge) { window.RunOnWindow([&window, edge] { window.StartResize(edge); }); };
#if STARSONIC_TEST_HOOKS
    // O build de teste: a thread de comandos trava no Sair (a fumaca confere o fechamento com limite).
    const bool hangOnQuit = GetEnvironmentVariableW(L"STARSONIC_TRAVAR_SAIR", nullptr, 0) > 1;
    if (hangOnQuit) log("STARSONIC_TRAVAR_SAIR: o Sair trava a thread de comandos (build de teste)");
#else
    const bool hangOnQuit = false;
#endif
    hooks.quit = [&window, quitDone, hangOnQuit] {
        if (hangOnQuit) Sleep(INFINITE);
        if (quitDone) SetEvent(quitDone);
        window.RunOnWindow([&window] { window.Close(); });
    };
    // "Enviar diagnostico": a copia na thread de comandos (le o disco), o Explorer na da janela.
    hooks.sendDiagnostics = [&window, &diag, logPath] {
        diag.Write("enviar diagnostico: copiando o diagnostico.log");
        SYSTEMTIME now = {};
        GetLocalTime(&now);
        const std::optional<std::wstring> copy = CopyDiagnostics(logPath, TempFolder(), now);
        if (!copy) {
            diag.Write("enviar diagnostico: a copia nao foi gravada; abrindo a pasta do diagnostico.log");
            window.RunOnWindow([logPath] { ShowInExplorer(logPath); });
            return;
        }
        diag.Write("enviar diagnostico: " + WideToUtf8(*copy));
        const std::wstring path = *copy;
        window.RunOnWindow([path] { ShowInExplorer(path); });
    };
    hooks.setStartWithWindows = [&diag, exePath](bool on) {
        const bool ok = SetAutostart(on, exePath);
        diag.Write(std::string("iniciar com o Windows: ") + (on ? "ligado" : "desligado") + (ok ? "" : " (o registro recusou)"));
    };
    hooks.updateAnswer = [&updater](bool now) {
        if (updater) updater->Answer(now);
    };
    // O canal do administrador (na abertura e quando ele muda): so guarda (vale a partir da proxima verificacao).
    hooks.updateChannel = [&updateChannel, log](const std::string& channel) {
        updateChannel.Set(channel);
        log(std::string("atualizacao: canal ") + (updateChannel.Test() ? "teste" : "estavel") +
            (channel.empty() ? " (o do build)" : " (o do administrador)"));
    };

    DesktopApp app(config, hooks, engine, engine, files, cipher, clock, scheduler);
    engine.SetListener(&app);
    engine.Start();
    app.Start();
    if (arguments.link) app.DialLink(*arguments.link);

    AppUpdater::Hooks updateHooks;
    updateHooks.offer = [&app](const std::string& version, const std::string& notes) { app.OfferUpdate(version, notes); };
    updateHooks.busy = [&engine] { return engine.CallCount() > 0; };
    updateHooks.notify = [&app](const std::string& text) { app.Notify(text); };
    updateHooks.log = log;
    updateHooks.quit = [&window] { window.RunOnWindow([&window] { window.RequestQuit(); }); };
    updater.reset(new AppUpdater(STARSONIC_VERSION, updateChannel, updateHooks));

    // O monitor de rede (rc.3, spec 8 e Ruling 16): a rede que o Windows ve e o teste DNS do servidor da conta vao ao
    // DesktopApp (SetInternet so poe na fila); o "sem internet" do Windows sozinho nunca tira o app do ar. O servidor vem
    // do estado que a janela le (callbacks.accountServer).
    NetworkMonitor::Hooks networkHooks;
    networkHooks.changed = [&app](bool internet) { app.SetInternet(internet); };
    networkHooks.log = log;
#if STARSONIC_TEST_HOOKS
    // O build de teste: o intervalo do monitor de rede em ms (a fumaca: o teste DNS a cada poucos segundos), com cada
    // resultado do DNS no diagnostico.
    unsigned networkIntervalMs = NetworkMonitor::kIntervalMs;
    bool verboseDns = false;
    {
        const std::wstring text = Environment(L"STARSONIC_TESTE_DNS_MS");
        const unsigned long value = text.empty() ? 0 : std::wcstoul(text.c_str(), nullptr, 10);
        if (value >= 100 && value <= NetworkMonitor::kIntervalMs) {
            networkIntervalMs = static_cast<unsigned>(value);
            verboseDns = true;
            log("STARSONIC_TESTE_DNS_MS: o monitor de rede a cada " + std::to_string(value) + " ms (build de teste)");
        }
    }
    NetworkMonitor network(networkHooks, networkIntervalMs, verboseDns);
#else
    NetworkMonitor network(networkHooks);
#endif
    network.Start();

    // As proximas aberturas (um link, o atalho de novo, o --sair) chegam aqui, na thread da janela, dentro do
    // WM_COPYDATA: so poe o trabalho na fila e volta.
    single.Listen(instance, [&app, &window, &diag, &network](const std::vector<std::wstring>& raw) {
#if STARSONIC_TEST_HOOKS
        // O build de teste: "--teste-internet off" forca o monitor de rede a ver a internet fora, e "on" devolve a visao
        // de verdade (a fumaca confere a bolinha cinza e a volta ao verde).
        if (raw.size() == 2 && raw[0] == L"--teste-internet" && (raw[1] == L"off" || raw[1] == L"on")) {
            const bool off = raw[1] == L"off";
            diag.Write(std::string("--teste-internet ") + (off ? "off" : "on") + " (build de teste)");
            network.Force(off ? std::optional<bool>(false) : std::nullopt);
            return;
        }
#endif
        const CommandLine next = ParseCommandLine(raw);
        if (next.quit) {
            diag.Write("pedido para sair (--sair)");
            window.RunOnWindow([&window] { window.RequestQuit(); });
            return;
        }
        if (next.link) app.DialLink(*next.link);
        if (next.tray && !next.link) return;   // o Iniciar com o Windows com o app ja aberto: fica como esta
        window.RunOnWindow([&window] { window.BringToFront(); });
    });

    bool outputsLogged = false;
    MainWindow::Callbacks callbacks;
    callbacks.command = [&app, &window, &outputsLogged, &diag](const std::string& json) {
        if (!outputsLogged && IsCommand(json, "ready")) {
            outputsLogged = true;
            window.LogAudioOutputs();   // os rotulos do WebView2, para comparar com os nomes do motor
        }
        if (IsCommand(json, "quit")) {
            // O Sair da interface vai pelo mesmo caminho dos outros (o WM_CLOSE, com os limites do fechamento).
            diag.Write("pedido para sair (interface)");
            window.RequestQuit();
            return;
        }
        app.HandleCommand(json);
    };
    callbacks.noticeCommand = [&app, &window](const std::string& json) {
        if (IsCommand(json, "quit")) {
            window.RequestQuit();
            return;
        }
        app.HandleCommand(json);
    };
    // Um headset entrou ou saiu (a janela ja esperou 1 s sem outro aviso): o DesktopApp rele na thread de comandos.
    callbacks.devicesChanged = [&app] { app.RefreshAudioDevices(); };
    callbacks.moved = [&app](int x, int y) { app.SaveWindowPosition(x, y); };
    callbacks.resized = [&app](int width, int height) { app.SaveWindowSize(width, height); };
    callbacks.accountServer = [&network](const std::string& server) { network.SetServer(server); };
    callbacks.quitRequested = [&app] { app.HandleCommand(kQuitCommand); };
    // O logoff ou o desligamento: o mesmo Sair, esperando pouco (o Windows encerra o processo depois de o
    // WM_ENDSESSION voltar). O Shutdown roda o que o Sair pos na fila (os Recentes das ligacoes encerradas).
    callbacks.endSession = [&app, &updater, &network, quitDone, log] {
        if (updater) updater->Close();
        app.HandleCommand(kQuitCommand);
        const bool done = quitDone && WaitForSingleObject(quitDone, kEndSessionWaitMs) == WAIT_OBJECT_0;
        // Depois do Sair (as ligacoes e os Recentes primeiro: o Unadvise do monitor pode demorar), antes do Shutdown.
        network.Stop();
        app.Shutdown();
        log(done ? "sessao do Windows encerrando: o Sair terminou" : "sessao do Windows encerrando: o Sair nao terminou a tempo");
    };
    callbacks.log = log;
    callbacks.webViewFailed = [&window](HRESULT) {
        window.RunOnWindow([&window] {
            MessageBoxW(nullptr, kNoWebView, L"Starsonic Phone", MB_ICONERROR | MB_OK);
            window.RequestQuit();
        });
    };

    MainWindow::Options options;
    options.userDataFolder = KnownFolder(FOLDERID_LocalAppData) + L"\\" + kAppFolder + L"\\WebView2";
    options.uiFolder = ExeFolder() + L"\\ui";
    options.devTools = STARSONIC_TEST_HOOKS != 0;
    options.position = position;
    options.size = windowSize;
    options.version = Utf8ToWide(STARSONIC_VERSION);
    int exitCode = 0;
    if (window.Create(instance, options, callbacks)) {
        if (arguments.tray) {
            log("aberto na bandeja (--bandeja)");
        } else {
            window.Show(SW_SHOWNORMAL);
        }
        updater->Start(kFirstUpdateCheckMs, kUpdateIntervalMs);
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
    // Com limite: uma thread de comandos ou um motor travados nao deixam o processo aberto sem janela, segurando a
    // instancia unica (toda abertura nova sairia com 1).
    log("fechando");
    const HANDLE closed = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    std::thread watchdog([closed, &diag] {
        if (!closed || WaitForSingleObject(closed, kShutdownLimitMs) == WAIT_OBJECT_0) return;
        diag.Write("fechamento forcado: o app nao fechou em " + std::to_string(kShutdownLimitMs / 1000) + " s");
        ExitProcess(0);
    });
    updater->Close();
    network.Stop();   // antes do Shutdown: nenhum SetInternet depois dele
    app.Shutdown();
    scheduler.Stop();
    engine.Stop();
    if (closed) SetEvent(closed);
    watchdog.join();
    if (closed) CloseHandle(closed);
    log("fechado");
    updater.reset();
    if (quitDone) CloseHandle(quitDone);
    if (SUCCEEDED(com)) CoUninitialize();
    return exitCode;
}
