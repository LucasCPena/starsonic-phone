#include "MainWindow.h"

#include <dbt.h>
#include <dwmapi.h>
#include <shellscalingapi.h>
#include <windowsx.h>

#include <utility>

#include "WindowFit.h"
#include "resource.h"

namespace starsonic {

const wchar_t MainWindow::kClassName[] = L"Starsonic Phone";

namespace {

const UINT kOutboxMessage = WM_APP + 1;   // ha mensagens para a interface na fila
const UINT kActionsMessage = WM_APP + 2;  // ha acoes para a janela na fila
const UINT_PTR kMoveTimer = 1;            // a janela parou de mover: grava a posicao
const UINT_PTR kQuitTimer = 2;            // o Sair nao terminou a tempo: fecha assim mesmo
const UINT_PTR kRestartTimer = 3;         // o navegador do WebView2 saiu: abre de novo
const UINT_PTR kUnresponsiveTimer = 4;    // a pagina nao responde: recarrega
const UINT_PTR kDeviceTimer = 5;          // um dispositivo de som mudou: rele depois de 1 s sem outro aviso
const UINT kMoveDelayMs = 500;
const UINT kQuitTimeoutMs = 10000;
const UINT kRestartDelayMs = 1000;        // o navegador velho termina de sair antes do ambiente novo
const UINT kUnresponsiveGraceMs = 5000;
const UINT kDeviceDelayMs = 1000;

const wchar_t kMainPage[] = L"https://app.starsonic.local/index.html";
const wchar_t kNoticePage[] = L"https://app.starsonic.local/aviso.html";

// KSCATEGORY_AUDIO: as interfaces de audio (o headset USB ou Bluetooth que entra ou sai).
const GUID kAudioInterfaces = {0x6994AD04, 0x93EF, 0x11D0, {0xA3, 0xCC, 0x00, 0xA0, 0xC9, 0x22, 0x31, 0x96}};

// A pagina com a versao do app (o cache do WebView2 nunca serve a de outra versao).
std::wstring Versioned(const wchar_t* page, const std::wstring& version) {
    return version.empty() ? std::wstring(page) : std::wstring(page) + L"?v=" + version;
}

// A barra de titulo da interface (app.css: .titlebar com 32 px, dois botoes de 44 px a direita).
const int kTitleBarHeight = 32;
const int kCaptionButtonsWidth = 88;

// Os atributos do DWM do Windows 11 (os SDKs antigos nao tem os nomes; o Windows 10 ignora).
const DWORD kCornerPreference = 33;   // DWMWA_WINDOW_CORNER_PREFERENCE
const DWORD kCornerRound = 2;         // DWMWCP_ROUND

const COLORREF kBackground = RGB(0x07, 0x0b, 0x18);   // o --navy-950 da interface

UINT MonitorDpi(HMONITOR monitor) {
    UINT x = 96;
    UINT y = 96;
    if (!monitor || FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &x, &y)) || x == 0) return 96;
    return x;
}

int Scale(int value, UINT dpi) { return MulDiv(value, static_cast<int>(dpi), 96); }

FitArea WorkArea(HMONITOR monitor) {
    MONITORINFO info = {};
    info.cbSize = sizeof(info);
    FitArea area;
    if (monitor && GetMonitorInfoW(monitor, &info)) {
        area.left = info.rcWork.left;
        area.top = info.rcWork.top;
        area.right = info.rcWork.right;
        area.bottom = info.rcWork.bottom;
    }
    return area;
}

}  // namespace

MainWindow::~MainWindow() {
    if (window_) DestroyWindow(window_);
}

bool MainWindow::Create(HINSTANCE instance, const Options& options, Callbacks callbacks) {
    callbacks_ = std::move(callbacks);
    instance_ = instance;
    options_ = options;
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.hIcon = static_cast<HICON>(LoadImageW(instance, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON,
                                                      GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0));
    windowClass.hIconSm = static_cast<HICON>(LoadImageW(instance, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON,
                                                        GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0));
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = CreateSolidBrush(kBackground);
    windowClass.lpszClassName = kClassName;
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        Log("a classe da janela nao foi registrada: " + std::to_string(GetLastError()));
        return false;
    }

    // Sem WS_THICKFRAME (o tamanho e fixo) e sem WS_MAXIMIZEBOX; o WS_CAPTION da a sombra, a animacao de minimizar e
    // os cantos do Windows 11, e o WM_NCCALCSIZE tira a barra do Windows (a da interface fica no lugar).
    const DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
    window_ = CreateWindowExW(WS_EX_APPWINDOW, kClassName, L"Starsonic Phone", style, CW_USEDEFAULT, CW_USEDEFAULT,
                              kWidth, kHeight, nullptr, nullptr, instance, this);
    if (!window_) {
        Log("a janela nao foi criada: " + std::to_string(GetLastError()));
        return false;
    }
    {
        std::lock_guard<std::mutex> lock(mutex_);
        target_ = window_;
    }
    Place(options.position);
    ApplyFrame();

    // A bandeja (o estado chega com o primeiro estado da ponte) e o aviso (o WebView dele abre depois do principal).
    if (!tray_.Create(window_, instance)) Log("a bandeja nao aceitou o icone (tenta de novo quando o Explorer voltar)");
    NoticeWindow::Callbacks noticeCallbacks;
    noticeCallbacks.command = [this](const std::string& json) {
        // O Atender do aviso traz a janela para a frente, na ligacao (spec da W1, 7.2).
        if (IsCommand(json, "answer")) BringToFront();
        if (callbacks_.noticeCommand) callbacks_.noticeCommand(json);
    };
    noticeCallbacks.log = [this](const std::string& line) { Log(line); };
    notice_.Create(instance, std::move(noticeCallbacks));

    webCallbacks_.message = [this](const std::string& json) {
        // O WebView do aviso abre depois que a interface principal carregou (a primeira mensagem dela e o ready): os
        // dois juntos atrasavam a primeira abertura, com o perfil do WebView2 ainda frio.
        if (!noticeStarted_) {
            noticeStarted_ = true;
            StartNotice();
        }
        if (IsCommand(json, "ready")) {
            if (restarts_.Restarting()) Log("navegador reiniciado: a interface voltou");
            restarts_.OnReady();
        }
        if (callbacks_.command) callbacks_.command(json);
    };
    webCallbacks_.log = [this](const std::string& line) { Log(line); };
    webCallbacks_.failed = [this](HRESULT error) {
        // O navegador novo ainda nao abriu (o velho terminando de sair): tenta de novo, algumas vezes.
        if (restarts_.OnCreateFailed()) {
            if (window_) SetTimer(window_, kRestartTimer, kRestartDelayMs, nullptr);
            return;
        }
        if (callbacks_.webViewFailed) callbacks_.webViewFailed(error);
    };
    webCallbacks_.browserExited = [this] {
        if (!restarts_.OnBrowserExited()) {
            // Saiu de novo antes de a interface carregar, 3 vezes seguidas: a mensagem do WebView2 (spec 11.1).
            Log("navegador reiniciado " + std::to_string(BrowserRestarts::kMaxWithoutReady) +
                " vezes sem a interface carregar: desistindo");
            if (window_) KillTimer(window_, kRestartTimer);
            if (callbacks_.webViewFailed) callbacks_.webViewFailed(E_FAIL);
            return;
        }
        // Fora do evento do WebView que morreu: o timer o troca por um novo.
        if (window_) SetTimer(window_, kRestartTimer, kRestartDelayMs, nullptr);
    };
    webCallbacks_.unresponsive = [this] {
        if (window_) SetTimer(window_, kUnresponsiveTimer, kUnresponsiveGraceMs, nullptr);
    };
    webOptions_.userDataFolder = options.userDataFolder;
    webOptions_.uiFolder = options.uiFolder;
    webOptions_.devTools = options.devTools;
    webOptions_.startPage = Versioned(kMainPage, options.version);
    CreateWebView();
    RegisterAudioNotifications();
    return true;
}

void MainWindow::CreateWebView() {
    webview_.reset(new WebViewHost(window_, webCallbacks_));
    webview_->Create(webOptions_);
}

// O navegador do WebView2 saiu: a janela e o aviso abrem de novo com um ambiente novo (o motor, o DesktopApp e as
// ligacoes continuam; a interface nova pede o estado e o toque com o ready).
void MainWindow::RestartWebView() {
    Log("navegador reiniciado: abrindo o WebView2 de novo");
    KillTimer(window_, kUnresponsiveTimer);
    notice_.StopWebView();
    noticeStarted_ = false;
    if (webview_) webview_->Close();
    CreateWebView();
}

void MainWindow::RegisterAudioNotifications() {
    DEV_BROADCAST_DEVICEINTERFACE_W filter = {};
    filter.dbcc_size = sizeof(filter);
    filter.dbcc_devicetype = DBT_DEVTYP_DEVICEINTERFACE;
    filter.dbcc_classguid = kAudioInterfaces;
    audioNotify_ = RegisterDeviceNotificationW(window_, &filter, DEVICE_NOTIFY_WINDOW_HANDLE);
    if (!audioNotify_) Log("som: o aviso de dispositivos de audio nao foi registrado: " + std::to_string(GetLastError()));
}

void MainWindow::Show(int showCommand) {
    if (!window_) return;
    ShowWindow(window_, showCommand);
    UpdateWindow(window_);
}

void MainWindow::PostToWeb(const std::string& json) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!target_) return;
    outbox_.push_back(json);
    PostMessageW(target_, kOutboxMessage, 0, 0);
}

void MainWindow::RunOnWindow(std::function<void()> action) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!target_) return;
    actions_.push_back(std::move(action));
    PostMessageW(target_, kActionsMessage, 0, 0);
}

void MainWindow::Minimize() {
    if (window_) ShowWindow(window_, SW_MINIMIZE);
}

void MainWindow::CloseToTray() {
    // O app continua recebendo ligacoes: o WebView continua rodando escondido (nunca suspenso, IsVisible TRUE), e o
    // aviso do canto aparece quando uma toca.
    if (!window_) return;
    ShowWindow(window_, SW_HIDE);
    if (!trayLogged_) {
        trayLogged_ = true;
        Log("janela na bandeja");
    }
    RefreshNotice();
}

void MainWindow::BringToFront() {
    if (!window_) return;
    if (!IsWindowVisible(window_)) ShowWindow(window_, SW_SHOW);
    if (IsIconic(window_)) ShowWindow(window_, SW_RESTORE);
    SetForegroundWindow(window_);
    RefreshNotice();
}

void MainWindow::RequestQuit() {
    if (window_) PostMessageW(window_, WM_CLOSE, 0, 0);
}

void MainWindow::StartNotice() {
    if (!webview_) return;
    WebViewHost::Options noticeOptions;
    noticeOptions.userDataFolder = options_.userDataFolder;
    noticeOptions.uiFolder = options_.uiFolder;
    noticeOptions.devTools = options_.devTools;
    noticeOptions.startPage = Versioned(kNoticePage, options_.version);
    noticeOptions.environment = webview_->Environment();
    if (!noticeOptions.environment) return;
    notice_.StartWebView(noticeOptions);
}

void MainWindow::RefreshNotice() {
    if (!window_) return;
    const bool inFront = IsWindowVisible(window_) && !IsIconic(window_) && active_;
    if (status_.ringing && !inFront) {
        notice_.Show(window_);
    } else {
        notice_.Hide();
    }
}

void MainWindow::OnTray(WPARAM wParam, LPARAM lParam) {
    switch (tray_.Handle(wParam, lParam)) {
        case Tray::Choice::Open:
            BringToFront();
            break;
        case Tray::Choice::ToggleDoNotDisturb:
            if (callbacks_.command) {
                callbacks_.command(status_.doNotDisturb ? "{\"v\":1,\"cmd\":\"setDnd\",\"on\":false}"
                                                        : "{\"v\":1,\"cmd\":\"setDnd\",\"on\":true}");
            }
            break;
        case Tray::Choice::Quit:
            Log("pedido para sair (bandeja)");
            RequestQuit();
            break;
        case Tray::Choice::None:
            break;
    }
}

void MainWindow::Close() {
    if (window_) DestroyWindow(window_);
}

void MainWindow::LogAudioOutputs() {
    if (webview_) webview_->LogAudioOutputs();
}

void MainWindow::Place(const std::optional<POINT>& position) {
    HMONITOR monitor = nullptr;
    std::optional<WindowPosition> wanted;
    if (position) {
        // A posicao gravada vale se um ponto da barra de titulo ainda cai num monitor (um monitor que saiu, ou a
        // resolucao que mudou, deixam a janela fora da tela).
        const POINT probe = {position->x + 100, position->y + 10};
        monitor = MonitorFromPoint(probe, MONITOR_DEFAULTTONULL);
        if (monitor) {
            wanted = WindowPosition{position->x, position->y};
        } else {
            Log("a posicao gravada da janela ficou fora da tela: ela volta para o monitor principal");
        }
    }
    if (!monitor) {
        const POINT origin = {0, 0};
        monitor = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
    }
    // 400x720 logicos, a altura cortada na da area de trabalho, e a janela inteira dentro dela (WindowFit).
    const UINT dpi = MonitorDpi(monitor);
    const FitBox box = FitWindow(WorkArea(monitor), dpi, wanted);
    SetWindowPos(window_, nullptr, box.x, box.y, box.width, box.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    if (box.height < Scale(kHeight, dpi)) {
        Log("a janela ficou com " + std::to_string(MulDiv(box.height, 96, static_cast<int>(dpi))) +
            " de altura (a area de trabalho e menor que 720)");
    }
    // O Windows pode ter posto a janela noutro monitor (outra escala): o tamanho segue a escala dela.
    const UINT actual = GetDpiForWindow(window_);
    if (actual != 0 && actual != dpi) Refit();
}

void MainWindow::Refit() {
    RECT rect = {};
    if (!window_ || IsIconic(window_) || !GetWindowRect(window_, &rect)) return;
    const HMONITOR monitor = MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST);
    UINT dpi = GetDpiForWindow(window_);
    if (dpi == 0) dpi = MonitorDpi(monitor);
    const FitBox box = FitWindow(WorkArea(monitor), dpi, WindowPosition{rect.left, rect.top});
    if (box.x == rect.left && box.y == rect.top && box.width == rect.right - rect.left &&
        box.height == rect.bottom - rect.top) {
        return;
    }
    SetWindowPos(window_, nullptr, box.x, box.y, box.width, box.height, SWP_NOZORDER | SWP_NOACTIVATE);
}

void MainWindow::ApplyFrame() {
    // Um pixel do quadro do DWM sob a area cliente: a sombra continua sem a moldura.
    const MARGINS margins = {0, 0, 0, 1};
    DwmExtendFrameIntoClientArea(window_, &margins);
    DwmSetWindowAttribute(window_, kCornerPreference, &kCornerRound, sizeof(kCornerRound));
}

void MainWindow::DrainOutbox() {
    std::deque<std::string> pending;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending.swap(outbox_);
    }
    bool changed = false;
    for (const std::string& json : pending) {
        if (webview_) webview_->Post(json);
        notice_.Post(json);
        const std::optional<ShellStatus> status = ReadShellStatus(json);
        if (status) {
            status_ = *status;
            changed = true;
        }
    }
    if (changed) {
        tray_.SetState(ChooseTrayIcon(status_), status_.doNotDisturb);
        tray_.SetRinging(status_.ringing);
        RefreshNotice();
    }
}

void MainWindow::RunActions() {
    std::deque<std::function<void()>> pending;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending.swap(actions_);
    }
    for (std::function<void()>& action : pending) {
        if (action) action();
    }
}

// Normalmente o WebView2 cobre a janela inteira e responde ele mesmo (a regiao app-region: drag da barra da
// interface). Se ele deixa o clique passar (HTTRANSPARENT), ou antes de ele abrir, a faixa da barra de titulo (menos
// os dois botoes) arrasta a janela.
LRESULT MainWindow::HitTest(LPARAM lParam) const {
    POINT point = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
    ScreenToClient(window_, &point);
    const UINT dpi = GetDpiForWindow(window_);
    RECT client = {};
    GetClientRect(window_, &client);
    if (point.y >= 0 && point.y < Scale(kTitleBarHeight, dpi) && point.x >= 0 &&
        point.x < client.right - Scale(kCaptionButtonsWidth, dpi)) {
        return HTCAPTION;
    }
    return HTCLIENT;
}

LRESULT CALLBACK MainWindow::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    MainWindow* self = nullptr;
    if (message == WM_NCCREATE) {
        const CREATESTRUCTW* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        self = static_cast<MainWindow*>(create->lpCreateParams);
        self->window_ = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    } else {
        self = reinterpret_cast<MainWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    }
    if (!self) return DefWindowProcW(window, message, wParam, lParam);
    if (message == WM_NCDESTROY) {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        self->window_ = nullptr;
        return DefWindowProcW(window, message, wParam, lParam);
    }
    return self->Handle(message, wParam, lParam);
}

LRESULT MainWindow::Handle(UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == Tray::TaskbarCreatedMessage()) {
        tray_.Recreate();   // o Explorer reiniciou: o icone volta
        return 0;
    }
    switch (message) {
        case WM_NCCALCSIZE:
            if (wParam) return 0;   // a area cliente e a janela inteira
            break;
        case WM_NCACTIVATE:
            // Sem area nao cliente: nada a redesenhar (o -1 evita que o Windows pinte a moldura antiga).
            return DefWindowProcW(window_, message, wParam, -1);
        case WM_NCHITTEST:
            return HitTest(lParam);
        case WM_ACTIVATE:
            active_ = LOWORD(wParam) != WA_INACTIVE;
            if (active_ && webview_) webview_->Focus();
            RefreshNotice();
            return 0;
        case WM_SIZE:
            if (wParam != SIZE_MINIMIZED && webview_) {
                RECT client = {};
                GetClientRect(window_, &client);
                webview_->Resize(client);
            }
            RefreshNotice();
            return 0;
        case WM_QUERYENDSESSION:
            return TRUE;   // o Windows pode encerrar: o Sair roda no WM_ENDSESSION
        case WM_ENDSESSION:
            if (wParam && callbacks_.endSession) {
                Log("o Windows esta encerrando a sessao");
                callbacks_.endSession();
            }
            return 0;
        case WM_MOVE:
            if (!IsIconic(window_)) SetTimer(window_, kMoveTimer, kMoveDelayMs, nullptr);
            return 0;
        case WM_DPICHANGED: {
            // A escala nova (ou outro monitor): 400x720 logicos na escala dela, a altura cortada na area de trabalho do
            // monitor do retangulo sugerido, a janela dentro dela.
            const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
            const UINT dpi = LOWORD(wParam);
            const HMONITOR monitor = MonitorFromRect(suggested, MONITOR_DEFAULTTONEAREST);
            const FitBox box = FitWindow(WorkArea(monitor), dpi, WindowPosition{suggested->left, suggested->top});
            SetWindowPos(window_, nullptr, box.x, box.y, box.width, box.height, SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_DEVICECHANGE:
            // Um headset entrou ou saiu: o Windows manda varios avisos seguidos; a releitura vem 1 s depois do ultimo.
            if (wParam == DBT_DEVNODES_CHANGED || wParam == DBT_DEVICEARRIVAL || wParam == DBT_DEVICEREMOVECOMPLETE) {
                SetTimer(window_, kDeviceTimer, kDeviceDelayMs, nullptr);
            }
            return TRUE;
        case WM_SETTINGCHANGE:
            // A area de trabalho mudou (a barra de tarefas cresceu, mudou de lado ou deixou de se esconder).
            if (wParam == SPI_SETWORKAREA) Refit();
            break;
        case WM_DISPLAYCHANGE:
            // A resolucao mudou.
            Refit();
            break;
        case WM_TIMER:
            if (wParam == kMoveTimer) {
                KillTimer(window_, kMoveTimer);
                RECT rect = {};
                if (!IsIconic(window_) && GetWindowRect(window_, &rect) && callbacks_.moved) {
                    callbacks_.moved(rect.left, rect.top);
                }
                return 0;
            }
            if (wParam == kQuitTimer) {
                KillTimer(window_, kQuitTimer);
                Log("o Sair nao terminou em 10 s: a janela fecha assim mesmo");
                Close();
                return 0;
            }
            if (wParam == kRestartTimer) {
                KillTimer(window_, kRestartTimer);
                RestartWebView();
                return 0;
            }
            if (wParam == kUnresponsiveTimer) {
                KillTimer(window_, kUnresponsiveTimer);
                Log("a interface nao respondeu: recarregando");
                if (webview_) webview_->Reload();
                return 0;
            }
            if (wParam == kDeviceTimer) {
                KillTimer(window_, kDeviceTimer);
                Log("som: um dispositivo mudou no Windows");
                if (callbacks_.devicesChanged) callbacks_.devicesChanged();
                return 0;
            }
            if (wParam == Tray::kBlinkTimer) {
                tray_.Blink();
                return 0;
            }
            break;
        case WM_CLOSE:
            // Alt+F4, o menu da janela, o Gerenciador de Tarefas, o Sair da bandeja ou o --sair: o Sair do app (as
            // ligacoes acabam e vao aos Recentes; o DesktopApp chama o gancho quit, que fecha a janela).
            if (!quitting_) {
                quitting_ = true;
                SetTimer(window_, kQuitTimer, kQuitTimeoutMs, nullptr);
                if (callbacks_.quitRequested) {
                    callbacks_.quitRequested();
                } else {
                    Close();
                }
            }
            return 0;
        case WM_DESTROY: {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                target_ = nullptr;
                outbox_.clear();
                actions_.clear();
            }
            KillTimer(window_, kMoveTimer);
            KillTimer(window_, kQuitTimer);
            KillTimer(window_, kRestartTimer);
            KillTimer(window_, kUnresponsiveTimer);
            KillTimer(window_, kDeviceTimer);
            if (audioNotify_) UnregisterDeviceNotification(audioNotify_);
            audioNotify_ = nullptr;
            tray_.Remove();
            notice_.Close();
            if (webview_) webview_->Close();
            PostQuitMessage(0);
            return 0;
        }
        default:
            if (message == kOutboxMessage) {
                DrainOutbox();
                return 0;
            }
            if (message == kActionsMessage) {
                RunActions();
                return 0;
            }
            if (message == Tray::kMessage) {
                OnTray(wParam, lParam);
                return 0;
            }
            break;
    }
    return DefWindowProcW(window_, message, wParam, lParam);
}

void MainWindow::Log(const std::string& line) const {
    if (callbacks_.log) callbacks_.log(line);
}

}  // namespace starsonic
