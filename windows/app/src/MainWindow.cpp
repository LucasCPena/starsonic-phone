#include "MainWindow.h"

#include <dbt.h>
#include <dwmapi.h>
#include <shellscalingapi.h>
#include <windowsx.h>

#include <algorithm>
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
const UINT_PTR kSizeTimer = 6;            // a pessoa parou de mudar o tamanho: grava o tamanho
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

// As bordas de redimensionar do Windows (as invisiveis, dos lados e de baixo), em pixels fisicos no DPI dado: o que o
// WM_NCCALCSIZE deixa fora da area cliente.
struct ResizeFrame {
    int x = 0;
    int y = 0;
};

ResizeFrame FrameFor(UINT dpi) {
    if (dpi == 0) dpi = 96;
    const int padded = GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
    ResizeFrame frame;
    frame.x = GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) + padded;
    frame.y = GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + padded;
    return frame;
}

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

    // O WS_THICKFRAME da as bordas de redimensionar (rc.2), sem WS_MAXIMIZEBOX; o WS_CAPTION da a sombra, a animacao
    // de minimizar e os cantos do Windows 11, e o WM_NCCALCSIZE tira a barra do Windows (a da interface fica no lugar)
    // e deixa as bordas invisiveis fora da area cliente.
    const DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_THICKFRAME | WS_CLIPCHILDREN;
    desired_ = options.size.value_or(WindowSize{});
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
            // A janela ja estava ativa quando o WebView2 abriu (a abertura, o navegador novo, a pagina recarregada): o
            // teclado vai para a pagina sem um clique antes (o Ctrl + P, o Teclado), como depois de um WM_ACTIVATE.
            if (active_ && webview_) webview_->Focus();
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

void MainWindow::StartResize(const std::string& edge) {
    if (!window_) return;
    LRESULT hit = HTNOWHERE;
    if (edge == "cima") hit = HTTOP;
    else if (edge == "cima-esquerda") hit = HTTOPLEFT;
    else if (edge == "cima-direita") hit = HTTOPRIGHT;
    else if (edge == "baixo-direita") hit = HTBOTTOMRIGHT;
    if (hit == HTNOWHERE) return;
    // O botao "esquerdo" e o principal (com os botoes trocados no Windows, o do lado direito).
    const int button = GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON;
    const bool pressed = (GetAsyncKeyState(button) & 0x8000) != 0;
    if (!pressed || IsZoomed(window_) || IsIconic(window_) || !IsWindowVisible(window_)) {
        // Um clique rapido (o botao ja solto quando o comando chega) nao pode cair no redimensionar pelo teclado.
        Log("redimensionar: " + edge + " (ignorado: " +
            (!pressed ? "o botao ja foi solto" : IsZoomed(window_) ? "maximizada" : "minimizada ou escondida") + ")");
        return;
    }
    Log("redimensionar: " + edge);
    POINT cursor = {};
    GetCursorPos(&cursor);
    // O WebView2 pode estar com o mouse capturado: solta, e o Windows roda o redimensionar de sempre pela borda.
    ReleaseCapture();
    PostMessageW(window_, WM_NCLBUTTONDOWN, static_cast<WPARAM>(hit), MAKELPARAM(cursor.x, cursor.y));
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
    noticeOptions.pageGetsCtrlP = false;   // o aviso nao reage ao Ctrl + P (e nunca imprime)
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
    // O tamanho escolhido (400x720 logicos por padrao), nunca menor que 300x440, cortado na area de trabalho, e a
    // janela inteira dentro dela (WindowFit).
    const UINT dpi = MonitorDpi(monitor);
    const FitBox box = FitWindow(WorkArea(monitor), dpi, wanted, desired_);
    SetClientBox(box, dpi);
    placed_ = true;
    const int logicalWidth = ScaleFromDpi(box.width, dpi);
    const int logicalHeight = ScaleFromDpi(box.height, dpi);
    Log("janela de " + std::to_string(logicalWidth) + "x" + std::to_string(logicalHeight) + " logicos");
    if (logicalHeight < desired_.height && logicalHeight > kMinWindowHeight) {
        Log("a janela ficou com " + std::to_string(logicalHeight) + " de altura (a area de trabalho e menor que " +
            std::to_string(desired_.height) + ")");
    }
    // O Windows pode ter posto a janela noutro monitor (outra escala): o tamanho segue a escala dela.
    const UINT actual = GetDpiForWindow(window_);
    if (actual != 0 && actual != dpi) Refit();
}

void MainWindow::Refit() {
    if (!window_ || IsIconic(window_)) return;
    const FitBox current = ClientBox();
    const HMONITOR monitor = MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST);
    UINT dpi = GetDpiForWindow(window_);
    if (dpi == 0) dpi = MonitorDpi(monitor);
    const FitBox box = FitWindow(WorkArea(monitor), dpi, WindowPosition{current.x, current.y}, desired_);
    if (box.x == current.x && box.y == current.y && box.width == current.width && box.height == current.height) return;
    SetClientBox(box, dpi);
}

FitBox MainWindow::ClientBox() const {
    FitBox box;
    RECT client = {};
    POINT origin = {0, 0};
    if (!window_ || !GetClientRect(window_, &client) || !ClientToScreen(window_, &origin)) return box;
    box.x = origin.x;
    box.y = origin.y;
    box.width = client.right - client.left;
    box.height = client.bottom - client.top;
    return box;
}

void MainWindow::SetClientBox(const FitBox& box, UINT dpi) {
    // A janela e a area cliente mais as bordas invisiveis dos lados e de baixo (o WM_NCCALCSIZE).
    const ResizeFrame frame = FrameFor(dpi);
    const bool wasFitting = fitting_;
    fitting_ = true;
    SetWindowPos(window_, nullptr, box.x - frame.x, box.y, box.width + 2 * frame.x, box.height + frame.y,
                 SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    fitting_ = wasFitting;
}

void MainWindow::OnMinMaxInfo(MINMAXINFO* info) const {
    // O minimo de 300x440 logicos da area cliente e o maximo da area de trabalho do monitor da janela.
    UINT dpi = GetDpiForWindow(window_);
    if (dpi == 0) dpi = 96;
    const ResizeFrame frame = FrameFor(dpi);
    const LONG minWidth = ScaleToDpi(kMinWindowWidth, dpi) + 2 * frame.x;
    const LONG minHeight = ScaleToDpi(kMinWindowHeight, dpi) + frame.y;
    info->ptMinTrackSize.x = minWidth;
    info->ptMinTrackSize.y = minHeight;
    const FitArea work = WorkArea(MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST));
    if (work.right > work.left && work.bottom > work.top) {
        info->ptMaxTrackSize.x = std::max(minWidth, static_cast<LONG>(work.right - work.left + 2 * frame.x));
        info->ptMaxTrackSize.y = std::max(minHeight, static_cast<LONG>(work.bottom - work.top + frame.y));
    }
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
        const TrayIcon icon = ChooseTrayIcon(status_);
        if (icon != trayIcon_) {
            trayIcon_ = icon;
            Log(std::string("bandeja: ") + TrayIconName(icon));
        }
        tray_.SetState(icon, status_.doNotDisturb, status_.doNotDisturbShown);
        tray_.SetRinging(status_.ringing);
        RefreshNotice();
        if (status_.server != server_ || status_.connected != connected_) {
            server_ = status_.server;
            connected_ = status_.connected;
            if (callbacks_.account) callbacks_.account(server_, connected_);
        }
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

// As bordas dos lados e de baixo ficam fora da area cliente (o WM_NCCALCSIZE): o Windows responde HTLEFT, HTRIGHT,
// HTBOTTOM e os cantos de baixo, e o WebView2 (que so cobre a area cliente) nao as engole. Dentro da area cliente,
// normalmente o WebView2 responde ele mesmo (a regiao app-region: drag da barra da interface); se ele deixa o clique
// passar (HTTRANSPARENT), ou antes de ele abrir, a faixa de cima redimensiona (HTTOP e os cantos de cima) e o resto da
// barra de titulo (menos os dois botoes) arrasta a janela.
LRESULT MainWindow::HitTest(WPARAM wParam, LPARAM lParam) const {
    const LRESULT frame = DefWindowProcW(window_, WM_NCHITTEST, wParam, lParam);
    if (frame != HTCLIENT) return frame;
    POINT point = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
    ScreenToClient(window_, &point);
    const UINT dpi = GetDpiForWindow(window_);
    RECT client = {};
    GetClientRect(window_, &client);
    const ResizeFrame border = FrameFor(dpi);
    if (!IsZoomed(window_) && point.y >= 0 && point.y < border.y) {
        if (point.x < 2 * border.x) return HTTOPLEFT;
        if (point.x >= client.right - 2 * border.x) return HTTOPRIGHT;
        return HTTOP;
    }
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
            if (wParam) {
                // Sem a barra do Windows (a da interface fica no lugar): a area cliente vai ate o alto da janela, e as
                // bordas invisiveis de redimensionar dos lados e de baixo ficam fora dela.
                NCCALCSIZE_PARAMS* params = reinterpret_cast<NCCALCSIZE_PARAMS*>(lParam);
                const ResizeFrame frame = FrameFor(GetDpiForWindow(window_));
                RECT& rect = params->rgrc[0];
                rect.left += frame.x;
                rect.right -= frame.x;
                rect.bottom -= frame.y;
                if (IsZoomed(window_)) rect.top += frame.y;
                return 0;
            }
            break;
        case WM_GETMINMAXINFO:
            OnMinMaxInfo(reinterpret_cast<MINMAXINFO*>(lParam));
            return 0;
        case WM_NCACTIVATE:
            // Sem area nao cliente: nada a redesenhar (o -1 evita que o Windows pinte a moldura antiga).
            return DefWindowProcW(window_, message, wParam, -1);
        case WM_NCHITTEST:
            return HitTest(wParam, lParam);
        case WM_ACTIVATE:
            active_ = LOWORD(wParam) != WA_INACTIVE;
            if (active_ && webview_) webview_->Focus();
            RefreshNotice();
            return 0;
        case WM_SIZE:
            if (wParam != SIZE_MINIMIZED && webview_) {
                // O WebView2 acompanha cada passo do arrasto.
                RECT client = {};
                GetClientRect(window_, &client);
                webview_->Resize(client);
            }
            if (wParam == SIZE_RESTORED && placed_ && !fitting_) {
                // A pessoa (ou o Windows, num encaixe na borda da tela) escolheu um tamanho: e o novo ponto de partida,
                // e vai para o config.json depois de 500 ms sem outro.
                const UINT dpi = GetDpiForWindow(window_);
                desired_ = WindowSize{ScaleFromDpi(LOWORD(lParam), dpi), ScaleFromDpi(HIWORD(lParam), dpi)};
                SetTimer(window_, kSizeTimer, kMoveDelayMs, nullptr);
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
            // A escala nova (ou outro monitor): o mesmo tamanho logico na escala dela, cortado na area de trabalho do
            // monitor do retangulo sugerido, a janela dentro dela.
            const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
            const UINT dpi = LOWORD(wParam);
            const HMONITOR monitor = MonitorFromRect(suggested, MONITOR_DEFAULTTONEAREST);
            const ResizeFrame frame = FrameFor(dpi);
            const FitBox box =
                FitWindow(WorkArea(monitor), dpi, WindowPosition{suggested->left + frame.x, suggested->top}, desired_);
            SetClientBox(box, dpi);
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
                // O canto de cima a esquerda da area cliente (o da interface; as bordas invisiveis ficam fora).
                if (!IsIconic(window_) && callbacks_.moved) {
                    const FitBox box = ClientBox();
                    callbacks_.moved(box.x, box.y);
                }
                return 0;
            }
            if (wParam == kSizeTimer) {
                KillTimer(window_, kSizeTimer);
                if (callbacks_.resized) callbacks_.resized(desired_.width, desired_.height);
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
            KillTimer(window_, kSizeTimer);
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
