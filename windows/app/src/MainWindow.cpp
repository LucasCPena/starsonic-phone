#include "MainWindow.h"

#include <dwmapi.h>
#include <shellscalingapi.h>
#include <windowsx.h>

#include <utility>

#include "resource.h"

namespace starsonic {

const wchar_t MainWindow::kClassName[] = L"Starsonic Phone";

namespace {

const UINT kOutboxMessage = WM_APP + 1;   // ha mensagens para a interface na fila
const UINT kActionsMessage = WM_APP + 2;  // ha acoes para a janela na fila
const UINT_PTR kMoveTimer = 1;            // a janela parou de mover: grava a posicao
const UINT_PTR kQuitTimer = 2;            // o Sair nao terminou a tempo: fecha assim mesmo
const UINT kMoveDelayMs = 500;
const UINT kQuitTimeoutMs = 10000;

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

}  // namespace

MainWindow::~MainWindow() {
    if (window_) DestroyWindow(window_);
}

UINT MainWindow::QuitMessage() {
    static const UINT message = RegisterWindowMessageW(L"StarsonicPhone.Sair");
    return message;
}

bool MainWindow::Create(HINSTANCE instance, const Options& options, Callbacks callbacks) {
    callbacks_ = std::move(callbacks);
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

    WebViewHost::Callbacks webCallbacks;
    webCallbacks.message = [this](const std::string& json) {
        if (callbacks_.command) callbacks_.command(json);
    };
    webCallbacks.log = [this](const std::string& line) { Log(line); };
    webCallbacks.failed = [this](HRESULT error) {
        if (callbacks_.webViewFailed) callbacks_.webViewFailed(error);
    };
    webview_.reset(new WebViewHost(window_, std::move(webCallbacks)));
    WebViewHost::Options webOptions;
    webOptions.userDataFolder = options.userDataFolder;
    webOptions.uiFolder = options.uiFolder;
    webOptions.devTools = options.devTools;
    webview_->Create(webOptions);
    return true;
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
    // A bandeja chega na Task 12; ate la o "fechar" da barra minimiza (o app continua recebendo ligacoes).
    Minimize();
}

void MainWindow::Close() {
    if (window_) DestroyWindow(window_);
}

void MainWindow::LogAudioOutputs() {
    if (webview_) webview_->LogAudioOutputs();
}

void MainWindow::Place(const std::optional<POINT>& position) {
    UINT dpi = 96;
    POINT topLeft = {0, 0};
    bool placed = false;
    if (position) {
        // A posicao gravada vale se um ponto da barra de titulo ainda cai num monitor (um monitor que saiu, ou a
        // resolucao que mudou, deixam a janela fora da tela).
        const POINT probe = {position->x + 100, position->y + 10};
        const HMONITOR monitor = MonitorFromPoint(probe, MONITOR_DEFAULTTONULL);
        if (monitor) {
            dpi = MonitorDpi(monitor);
            topLeft = *position;
            placed = true;
        } else {
            Log("a posicao gravada da janela ficou fora da tela: ela volta para o monitor principal");
        }
    }
    if (!placed) {
        const POINT origin = {0, 0};
        const HMONITOR primary = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
        MONITORINFO info = {};
        info.cbSize = sizeof(info);
        GetMonitorInfoW(primary, &info);
        dpi = MonitorDpi(primary);
        const RECT& work = info.rcWork;
        topLeft.x = work.left + ((work.right - work.left) - Scale(kWidth, dpi)) / 2;
        topLeft.y = work.top + ((work.bottom - work.top) - Scale(kHeight, dpi)) / 2;
        if (topLeft.y < work.top) topLeft.y = work.top;
        if (topLeft.x < work.left) topLeft.x = work.left;
    }
    const UINT flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
    SetWindowPos(window_, nullptr, topLeft.x, topLeft.y, Scale(kWidth, dpi), Scale(kHeight, dpi), flags);
    // O Windows pode ter posto a janela noutro monitor (outra escala): o tamanho segue a escala dela.
    const UINT actual = GetDpiForWindow(window_);
    if (actual != 0 && actual != dpi) {
        SetWindowPos(window_, nullptr, 0, 0, Scale(kWidth, actual), Scale(kHeight, actual),
                     SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOMOVE);
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
    for (const std::string& json : pending) {
        if (webview_) webview_->Post(json);
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
    if (message == QuitMessage()) {
        // O "--sair" de outra abertura: como o Sair da interface.
        Log("pedido para sair (--sair)");
        message = WM_CLOSE;
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
            if (LOWORD(wParam) != WA_INACTIVE && webview_) webview_->Focus();
            return 0;
        case WM_SIZE:
            if (wParam != SIZE_MINIMIZED && webview_) {
                RECT client = {};
                GetClientRect(window_, &client);
                webview_->Resize(client);
            }
            return 0;
        case WM_MOVE:
            if (!IsIconic(window_)) SetTimer(window_, kMoveTimer, kMoveDelayMs, nullptr);
            return 0;
        case WM_DPICHANGED: {
            const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
            const UINT dpi = LOWORD(wParam);
            SetWindowPos(window_, nullptr, suggested->left, suggested->top, Scale(kWidth, dpi), Scale(kHeight, dpi),
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
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
            break;
        case WM_CLOSE:
            // Alt+F4, o menu da janela, o Gerenciador de Tarefas ou o --sair: o Sair do app (as ligacoes acabam e vao
            // aos Recentes; o DesktopApp chama o gancho quit, que fecha a janela).
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
            break;
    }
    return DefWindowProcW(window_, message, wParam, lParam);
}

void MainWindow::Log(const std::string& line) const {
    if (callbacks_.log) callbacks_.log(line);
}

}  // namespace starsonic
