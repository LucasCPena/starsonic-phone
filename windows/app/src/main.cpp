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
#include <winhttp.h>

#include <algorithm>
#include <chrono>
#include <climits>
#include <cwchar>
#include <memory>
#include <mutex>
#include <set>
#include <system_error>
#include <thread>
#include <optional>
#include <string>
#include <vector>

#include "AppUpdater.h"
#include "Autostart.h"
#include "Bunzip.h"
#include "CameraPrivacy.h"
#include "ChatDownloader.h"
#include "CompanyFetcher.h"
#include "DesktopApp.h"
#include "DiagLog.h"
#include "Diagnostics.h"
#include "DpapiCipher.h"
#include "EngineHost.h"
#include "FilePicker.h"
#include "FrameRouter.h"
#include "H264Module.h"
#include "Http.h"
#include "LegacyCrypto.h"
#include "Links.h"
#include "MainWindow.h"
#include "NetworkMonitor.h"
#include "OpenH264Pin.h"
#include "OpenH264Shim.h"
#include "Profile.h"
#include "ShellState.h"
#include "SingleInstance.h"
#include "Stores.h"
#include "Text.h"
#include "Threads.h"
#include "UpdateChannel.h"
#include "VideoSink.h"
#include "WinFiles.h"
#include "app_build.h"
#include "resource.h"

using namespace starsonic;

// (0.3.0) O windows/app/CMakeLists.txt define o STARSONIC_H264_DOWNLOAD (0 ou 1); sem ele, o download fica desligado.
#ifndef STARSONIC_H264_DOWNLOAD
#define STARSONIC_H264_DOWNLOAD 0
#endif

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

// O nome do computador no Windows (o chat.computador, 0.2.0); "" se o Windows nao o deu.
std::string ComputerName() {
    wchar_t name[MAX_COMPUTERNAME_LENGTH + 1] = {};
    DWORD size = MAX_COMPUTERNAME_LENGTH + 1;
    if (!GetComputerNameW(name, &size)) return std::string();
    return WideToUtf8(std::wstring(name, size));
}

// As janelas de arquivo da rc.4 (FilePicker.h). So a thread da janela le e escreve: sem trava.
struct FileDialogs {
    bool open = false;     // uma esta aberta (o Show roda o laco de mensagens: outro pedido pode chegar dentro dele)
    bool closed = false;   // o DesktopApp parou, ou para agora: nenhuma abre, e a que volta nao responde
};

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

// (0.3.0) O relogio do credito do video (VideoSink): o monotonico, em milissegundos.
int64_t SteadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

// (0.3.0) A gravacao atomica do modulo H.264: <arquivo>.part, descarregado no disco e trocado pelo arquivo de uma vez
// (MoveFileExW). Um .part que sobrar (o app fechado no meio) sai na limpeza do proximo Ensure.
bool WritePart(const std::wstring& path, const std::string& bytes) {
    const std::wstring part = path + L".part";
    const HANDLE file = CreateFileW(part.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL,
                                    nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool written = true;
    for (size_t done = 0; written && done < bytes.size();) {
        DWORD wrote = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<size_t>(bytes.size() - done, 1u << 20));
        written = WriteFile(file, bytes.data() + done, chunk, &wrote, nullptr) && wrote > 0;
        done += wrote;
    }
    written = written && FlushFileBuffers(file);
    CloseHandle(file);
    if (written && MoveFileExW(part.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        return true;
    }
    DeleteFileW(part.c_str());
    return false;
}

// (0.3.0) Os nomes simples dos arquivos da pasta (sem as pastas).
std::vector<std::string> FileNames(const std::wstring& folder) {
    std::vector<std::string> names;
    WIN32_FIND_DATAW found = {};
    const HANDLE find =
        FindFirstFileExW((folder + L"\\*").c_str(), FindExInfoBasic, &found, FindExSearchNameMatch, nullptr, 0);
    if (find == INVALID_HANDLE_VALUE) return names;
    do {
        if ((found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) names.push_back(WideToUtf8(found.cFileName));
    } while (FindNextFileW(find, &found));
    FindClose(find);
    return names;
}

// (0.3.0) O H264Io do Windows: os caminhos UTF-8 vao as APIs W, a rede e o HttpGetPinned (o user agent do app), e o
// bzip2, o Bunzip2. O log vai direto ao diagnostico (as linhas "h264:", sem o "motor N:" do motor).
H264Io WindowsH264Io(const std::wstring& userAgent, std::function<void(const std::string&)> log) {
    H264Io io;
    io.read = [](const std::string& path) { return WinFiles().Read(path); };
    io.write = [](const std::string& path, const std::string& bytes) { return WritePart(Utf8ToWide(path), bytes); };
    io.remove = [](const std::string& path) { return DeleteFileW(Utf8ToWide(path).c_str()) != FALSE; };
    io.list = [](const std::string& folder) { return FileNames(Utf8ToWide(folder)); };
    io.fetch = [userAgent](const std::string& url, size_t maxBytes, int timeoutMs) {
        HttpResponse response = HttpGetPinned(Utf8ToWide(url), maxBytes, userAgent, timeoutMs);
        FetchResult result;
        result.status = static_cast<int>(response.status);
        result.body = std::move(response.body);
        if (response.error == ERROR_WINHTTP_TIMEOUT) {
            result.error = "tempo";
        } else if (response.error == ERROR_FILE_TOO_LARGE) {
            result.error = "grande";
        } else if (response.error != 0) {
            result.error = "rede";
        }
        return result;
    };
    io.bunzip = [](const std::string& compressed, size_t maxOut) { return Bunzip2(compressed, maxOut); };
    io.log = std::move(log);
    return io;
}

// (0.3.0) O codigo curto de uma falha do LoadOpenH264, sem o caminho: o numero do erro do Windows, ou "funcao" (falta
// uma das quatro funcoes no modulo).
std::string LoadFailureCode(const std::string& error) {
    std::string digits;
    const size_t at = error.find("(erro ");
    if (at != std::string::npos) {
        for (size_t i = at + 6; i < error.size() && error[i] >= '0' && error[i] <= '9'; ++i) digits += error[i];
    }
    if (!digits.empty()) return digits;
    return error.find("funcao") != std::string::npos ? "funcao" : "outro";
}

// (0.3.0) O gancho h264Ensure: o H264Module::Ensure numa thread propria, um pedido por vez (um pedido no meio de outro
// e ignorado: a resposta do que roda vale pelos dois). Com o Installed, a impressao de novo (Verify) e o LoadOpenH264
// pelo caminho completo; so entao a resposta Installed. A falha do carregamento vira Failed, com a linha
// "h264: download falhou (carregar <codigo>)".
// O fechamento nao espera a thread: o download so desiste em 60 s, e o fechamento tem 5 s (o watchdog do main). Como a
// do CompanyFetcher, ela guarda o que precisa (o modulo, com um H264Io so de copias), e o diagnostico e a resposta ao
// DesktopApp passam pela trava, que o Stop fecha antes do Shutdown: depois do Stop, nenhuma linha e nenhum
// SetH264State, e a thread nunca toca no DesktopApp destruido. Uma thread presa no download termina com o processo (o
// .part que ela deixar sai no proximo Ensure).
class H264Installer {
public:
    // folder: a pasta codecs ("" sem o %LOCALAPPDATA%: o Ensure falha sem tocar no disco, "(pasta)").
    H264Installer(std::wstring folder, std::wstring userAgent, std::function<void(const std::string&)> log)
        : shared_(std::make_shared<Shared>()), folder_(std::move(folder)), userAgent_(std::move(userAgent)) {
        shared_->log = std::move(log);
    }
    ~H264Installer() { Stop(); }

    H264Installer(const H264Installer&) = delete;
    H264Installer& operator=(const H264Installer&) = delete;

    // Na thread de comandos; nunca espera. done, na thread do Ensure: Installed ou Failed (antes do Stop).
    void Ensure(std::function<void(H264State)> done) {
        {
            std::lock_guard<std::mutex> lock(shared_->mutex);
            if (shared_->stopped || shared_->running) return;
            shared_->running = true;
        }
        try {
            std::thread(Run, shared_, folder_, userAgent_, done).detach();
        } catch (const std::system_error&) {
            std::lock_guard<std::mutex> lock(shared_->mutex);
            shared_->running = false;
            if (shared_->stopped) return;
            if (shared_->log) shared_->log("h264: download falhou (thread)");
            if (done) done(H264State::Failed);
        }
    }

    // Antes do Shutdown do DesktopApp (e de o diagnostico sair). De novo, nada.
    void Stop() {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->stopped = true;
    }

private:
    struct Shared {
        std::mutex mutex;
        bool running = false;
        bool stopped = false;
        std::function<void(const std::string&)> log;
    };

    static bool Stopped(const std::shared_ptr<Shared>& shared) {
        std::lock_guard<std::mutex> lock(shared->mutex);
        return shared->stopped;
    }

    // O modulo que o Ensure deu como instalado: a impressao de novo (o arquivo pode ter mudado depois dele) e o
    // carregamento pelo caminho completo.
    static H264State Load(const H264Module& module, const std::function<void(const std::string&)>& log) {
        if (!module.Verify()) {
            log("h264: download falhou (conferir)");
            return H264State::Failed;
        }
        std::string error;
        if (!LoadOpenH264(Utf8ToWide(module.ModulePath()), &error)) {
            log("h264: download falhou (carregar " + LoadFailureCode(error) + ")");
            return H264State::Failed;
        }
        return H264State::Installed;
    }

    static void Run(std::shared_ptr<Shared> shared, std::wstring folder, std::wstring userAgent,
                    std::function<void(H264State)> done) {
        // O diagnostico so com a trava, e nunca depois do Stop.
        const std::function<void(const std::string&)> log = [shared](const std::string& line) {
            std::lock_guard<std::mutex> lock(shared->mutex);
            if (!shared->stopped && shared->log) shared->log(line);
        };
        H264State state = H264State::Failed;
        try {
            // A pasta (e a de cima) criada quando falta; sem ela, o Ensure falha sem tocar no disco ("pasta").
            const std::string path = !folder.empty() && CreateFolderTree(folder) ? WideToUtf8(folder) : std::string();
            H264Module module(kOpenH264Pin, path, WindowsH264Io(userAgent, log));
            state = module.Ensure();
            if (state == H264State::Installed) {
                if (Stopped(shared)) return;   // o app fechando: o modulo nao e carregado
                state = Load(module, log);
            }
        } catch (...) {
            // Sem memoria (o processo e de 32 bits): falhou, sem os bytes.
            state = H264State::Failed;
            try {
                log("h264: download falhou (memoria)");
            } catch (...) {
            }
        }
        std::lock_guard<std::mutex> lock(shared->mutex);
        shared->running = false;
        if (shared->stopped || !done) return;
        try {
            done(state);   // so poe na fila do DesktopApp
        } catch (...) {
            // Sem memoria na fila do DesktopApp: a resposta se perde (a situacao fica "baixando").
        }
    }

    std::shared_ptr<Shared> shared_;
    std::wstring folder_;
    std::wstring userAgent_;
};

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
    config.paths.companyList = data + "\\contatos-empresa.json";   // rc.4: a ultima lista boa da planilha da empresa
    config.paths.chat = data + "\\chat.json";   // 0.2.0: a chave do chat, pelo DPAPI (como o admin.json)
    // A rc.7 guardava tudo na mesma pasta (o %APPDATA%\Starsonic Phone do app antigo instalado).
    config.paths.legacy.ini = data + "\\StarsonicPhone.ini";
    config.paths.legacy.contactsXml = data + "\\Contacts.xml";
    config.paths.legacy.callsDb = data + "\\call_log.db";
    config.profile = profile;
    config.version = STARSONIC_VERSION;
    config.decrypt = [](const std::wstring& encrypted) { return LegacyDecrypt(encrypted); };
    config.computerName = ComputerName();
    // (0.3.0) O download do modulo H.264 da Cisco, so com a opcao STARSONIC_H264_DOWNLOAD do build (desligada ate a
    // etapa 2 do video trazer a chave, o aviso e a licenca da Cisco). Desligado, o nucleo nunca chama o h264Ensure: o
    // app nao baixa nem carrega o modulo.
    config.h264Download = STARSONIC_H264_DOWNLOAD != 0;
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
    // (rc.4) A leitura da planilha da empresa (CompanyFetcher.h), numa thread propria, com o user agent do atualizador.
    // Antes do DesktopApp (o gancho chega na abertura dele); o Stop roda antes do Shutdown dele: nenhuma resposta
    // depois.
    CompanyFetcher companyFetcher(L"Starsonic Phone/" + Utf8ToWide(STARSONIC_VERSION), log);
    // (0.2.0) O download dos arquivos do chat (ChatDownloader.h), numa thread propria, com o mesmo user agent. Antes do
    // DesktopApp (o gancho chega nele); o Stop roda antes do Shutdown dele, com o do companyFetcher: nenhum toast
    // depois. O toast de erro vai ao DesktopApp::Notify pelo chatApp, que aponta para ele antes do Start (nenhum
    // download antes).
    ChatDownloader chatDownloader(L"Starsonic Phone/" + Utf8ToWide(STARSONIC_VERSION), log);
    DesktopApp* chatApp = nullptr;
    FileDialogs fileDialogs;   // (rc.4) as janelas de importar e exportar (ver os ganchos)
    // (0.3.0) A imagem do video ate a pagina (VideoSink.h): o sink dos quadros do motor, com as memorias nos WebView da
    // janela. A rota (so na thread da janela) junta as vistas do gancho videoViews e as ligacoes do
    // callbacks.videoRoute. O VideoSink dura mais que o motor (o engine.Stop do fechamento vem antes de ele sair), e a
    // janela chama o Close dele antes de os WebView fecharem.
    VideoSink videoSink(window.VideoPages(), SteadyMs);
    RouteState routeState;
    // (0.3.0) O modulo H.264 da Cisco (H264Installer), na pasta %LOCALAPPDATA%\Starsonic Phone\codecs, com o mesmo user
    // agent. Antes do DesktopApp (o gancho chega na abertura dele); o Stop roda antes do Shutdown dele, com o do
    // companyFetcher: nenhuma resposta depois. A resposta vai ao DesktopApp::SetH264State pelo h264App, que aponta para
    // ele antes do Start (nenhum pedido antes).
    const std::wstring localData = KnownFolder(FOLDERID_LocalAppData);
    H264Installer h264Installer(localData.empty() ? std::wstring() : localData + L"\\" + kAppFolder + L"\\codecs",
                                L"Starsonic Phone/" + Utf8ToWide(STARSONIC_VERSION), log);
    DesktopApp* h264App = nullptr;

    // O gancho quit ja rodou (o DesktopApp encerrou as ligacoes): o logoff do Windows espera por ele.
    const HANDLE quitDone = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    DesktopHooks hooks;
    hooks.post = [&window](const std::string& json) { window.PostToWeb(json); };
    hooks.log = log;
    hooks.openUrl = [&window](const std::string& url) { window.RunOnWindow([url] { OpenUrl(url); }); };
    hooks.minimize = [&window] { window.RunOnWindow([&window] { window.Minimize(); }); };
    hooks.closeToTray = [&window] { window.RunOnWindow([&window] { window.CloseToTray(); }); };
    // (0.3.0) O modo da janela do video ("normal", "grande", "telaCheia"): da thread de comandos para a da janela.
    hooks.videoWindow = [&window](const std::string& mode) {
        const VideoMode wanted = mode == "grande"      ? VideoMode::Big
                                 : mode == "telaCheia" ? VideoMode::Fullscreen
                                                       : VideoMode::Normal;
        window.RunOnWindow([&window, wanted] { window.SetVideoMode(wanted); });
    };
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
    // (rc.4) As janelas de importar e exportar (FilePicker.h), na thread da janela, com o COM dela: o gancho so poe na
    // fila da janela e volta. Uma por vez: o pedido que chega com uma aberta volta cancelado (""). O callback do
    // DesktopApp (que so poe o resultado na fila de comandos) nunca roda depois do Shutdown dele: o fileDialogs.closed
    // sobe antes de cada Shutdown, na thread da janela (o do logoff, que pode rodar dentro do laco de uma janela de
    // arquivo aberta, e o do fim), e depois disso a janela que volta nao responde, e a que ainda nao abriu nem abre. O
    // Sair com uma janela aberta (o da bandeja, o --sair) fecha a janela principal, que leva a de arquivo junto: o Show
    // volta com nada, e a resposta ("", cancelado) sai ali, antes de o laco de mensagens acabar e do Shutdown.
    hooks.pickImportFile = [&window, &fileDialogs](std::function<void(const std::string& path)> done) {
        window.RunOnWindow([&window, &fileDialogs, done] {
            if (fileDialogs.closed) return;
            if (fileDialogs.open) {
                done(std::string());
                return;
            }
            fileDialogs.open = true;
            const std::optional<std::wstring> path = PickImportFile(window.Handle());
            fileDialogs.open = false;
            if (!fileDialogs.closed) done(path ? WideToUtf8(*path) : std::string());
        });
    };
    using ExportDone = std::function<void(const std::string& path, const std::string& format)>;
    hooks.pickExportFile = [&window, &fileDialogs](ExportDone done) {
        window.RunOnWindow([&window, &fileDialogs, done] {
            if (fileDialogs.closed) return;
            if (fileDialogs.open) {
                done(std::string(), std::string());
                return;
            }
            fileDialogs.open = true;
            const std::optional<ExportChoice> choice = PickExportFile(window.Handle());
            fileDialogs.open = false;
            if (fileDialogs.closed) return;
            if (choice) {
                done(WideToUtf8(choice->path), choice->format);
            } else {
                done(std::string(), std::string());
            }
        });
    };
    // (rc.4) A leitura da planilha da empresa: so poe na fila da thread do CompanyFetcher.
    using FetchDone = std::function<void(const CompanyFetch& result)>;
    hooks.fetchCompanyList = [&companyFetcher](const CompanySource& source, FetchDone done) {
        companyFetcher.Fetch(source, std::move(done));
    };
    // (0.2.0) O chat: o aviso e o numero vao a janela (a bandeja e o botao da barra de tarefas sao dela), e o download
    // a thread do chatDownloader. Os tres so poem na fila e voltam (a thread de comandos nunca espera a janela nem a
    // rede).
    hooks.chatNotice = [&window](int64_t conversa, const std::string& titulo, const std::string& texto) {
        const std::wstring title = Utf8ToWide(titulo);
        const std::wstring text = Utf8ToWide(texto);
        window.RunOnWindow([&window, title, text, conversa] { window.ShowChatNotice(title, text, conversa); });
    };
    hooks.chatBadge = [&window](int n) { window.RunOnWindow([&window, n] { window.SetChatBadge(n); }); };
    hooks.chatDownload = [&chatDownloader, &chatApp](const std::string& arquivo, const std::string& nome,
                                                     const std::string& chave) {
        chatDownloader.Download(arquivo, nome, chave, [&chatApp](const std::string& toast) {
            if (!toast.empty() && chatApp) chatApp->Notify(toast);
        });
    };
    // (0.3.0) O video. O videoViews e o h264Ensure so poem o trabalho na fila (a da janela, ou a thread do
    // h264Installer) e voltam; o cameraBlocked so le o registro. As vistas que uma pagina mostra trocam so as vistas
    // dela na rota (as da outra pagina ficam).
    hooks.videoViews = [&window, &routeState, &videoSink](const std::vector<std::string>& views, bool noticePage) {
        window.RunOnWindow([&routeState, &videoSink, views, noticePage] {
            std::set<ViewName> visible;
            for (const ViewName view : routeState.visible) {
                if ((view == ViewName::Porteiro) != noticePage) visible.insert(view);
            }
            for (const std::string& key : views) {
                for (const ViewName view : {ViewName::Remoto, ViewName::Local, ViewName::Porteiro}) {
                    if (key == ViewKey(view) && (view == ViewName::Porteiro) == noticePage) visible.insert(view);
                }
            }
            routeState.visible = visible;
            videoSink.SetRouteState(routeState);
        });
    };
    hooks.h264Ensure = [&h264Installer, &h264App] {
        h264Installer.Ensure([&h264App](H264State state) {
            if (h264App) h264App->SetH264State(state);
        });
    };
    hooks.cameraBlocked = [] { return CameraBlockedByWindows(); };

    DesktopApp app(config, hooks, engine, engine, files, cipher, clock, scheduler);
    chatApp = &app;
    h264App = &app;
    engine.SetListener(&app);
    engine.SetFrameSink(&videoSink);   // (0.3.0) nao espera o motor: vai a ele quando ele fica pronto
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

    // O monitor de rede (rc.3, spec 8 e os Rulings 16 e 23): a rede que o Windows ve e o teste DNS do servidor da conta
    // vao ao DesktopApp (SetInternet so poe na fila); o "sem internet" do Windows sozinho nunca tira o app do ar, e o
    // DNS sem resposta so muda a bolinha. O servidor e a conta conectada vem do estado que a janela le
    // (callbacks.account).
    NetworkMonitor::Hooks networkHooks;
    networkHooks.changed = [&app](InternetState state) { app.SetInternet(state); };
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
        // (0.3.0) Da pagina do aviso: o ready dela nao para o teste da camera (so o da janela principal).
        app.HandleCommand(json, /*noticePage=*/true);
    };
    // Um headset entrou ou saiu (a janela ja esperou 1 s sem outro aviso): o DesktopApp rele na thread de comandos.
    callbacks.devicesChanged = [&app] { app.RefreshAudioDevices(); };
    // (0.3.0) A sessao do Windows bloqueada ou desconectada pausa a camera: o EngineHost so guarda o valor (a thread da
    // janela nunca toca o motor) e o aplica fora dela.
    callbacks.cameraPaused = [&engine](bool paused) { engine.SetCameraPaused(paused); };
    callbacks.moved = [&app](int x, int y) { app.SaveWindowPosition(x, y); };
    callbacks.resized = [&app](int width, int height) { app.SaveWindowSize(width, height); };
    callbacks.account = [&network](const std::string& server, bool connected) {
        network.SetAccount(server, connected);
    };
    // (0.2.0) O chat: a janela na frente e o clique no aviso do chat (os dois so poem na fila do DesktopApp).
    callbacks.inFront = [&app](bool inFront) { app.SetWindowInFront(inFront); };
    callbacks.openChat = [&app](int64_t conversa) { app.OpenChat(conversa); };
    // (0.3.0) A rota do video: a ligacao de cima, a recebida tocando (a que o aviso mostra) e a janela fora da vista.
    callbacks.videoRoute = [&routeState, &videoSink](int topCallId, int ringingCallId, bool minimized) {
        routeState.topCallId = topCallId;
        routeState.noticeCallId = ringingCallId;
        routeState.minimized = minimized;
        videoSink.SetRouteState(routeState);
    };
    callbacks.quitRequested = [&app] { app.HandleCommand(kQuitCommand); };
    // O logoff ou o desligamento: o mesmo Sair, esperando pouco (o Windows encerra o processo depois de o
    // WM_ENDSESSION voltar). O Shutdown roda o que o Sair pos na fila (os Recentes das ligacoes encerradas).
    callbacks.endSession = [&app, &updater, &network, &companyFetcher, &chatDownloader, &h264Installer, &fileDialogs,
                            quitDone, log] {
        if (updater) updater->Close();
        app.HandleCommand(kQuitCommand);
        const bool done = quitDone && WaitForSingleObject(quitDone, kEndSessionWaitMs) == WAIT_OBJECT_0;
        // Depois do Sair (as ligacoes e os Recentes primeiro: o Unadvise do monitor pode demorar), antes do Shutdown:
        // nenhum SetInternet, nenhuma resposta da leitura da planilha, nenhum toast do download do chat, nenhuma
        // resposta do modulo H.264 e nenhuma das janelas de arquivo depois dele (uma pode estar aberta: este
        // WM_ENDSESSION pode rodar dentro do laco dela).
        network.Stop();
        companyFetcher.Stop();
        chatDownloader.Stop();
        h264Installer.Stop();
        fileDialogs.closed = true;
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
    options.videoSink = &videoSink;   // (0.3.0) a pagina pronta, o navegador refeito e o Close
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
    // Antes do Shutdown: nenhum SetInternet, nenhuma resposta da leitura da planilha (a leitura presa nao e esperada),
    // nenhum toast do download do chat (o download de agora tambem nao), nenhuma resposta do modulo H.264 (o download
    // de agora tambem nao) e nenhuma das janelas de arquivo depois dele (com o laco de mensagens no fim, nenhuma esta
    // aberta).
    network.Stop();
    companyFetcher.Stop();
    chatDownloader.Stop();
    h264Installer.Stop();
    fileDialogs.closed = true;
    app.Shutdown();
    scheduler.Stop();
    engine.Stop();   // (0.3.0) o ultimo quadro ao videoSink: ele sai so depois, com o fim do main
    if (closed) SetEvent(closed);
    watchdog.join();
    if (closed) CloseHandle(closed);
    log("fechado");
    updater.reset();
    if (quitDone) CloseHandle(quitDone);
    if (SUCCEEDED(com)) CoUninitialize();
    return exitCode;
}
