#include "NoticeWindow.h"

#include <dwmapi.h>
#include <shellscalingapi.h>

#include <utility>

namespace starsonic {

const wchar_t NoticeWindow::kClassName[] = L"Starsonic Phone Aviso";

namespace {

const wchar_t kNoticePage[] = L"https://app.starsonic.local/aviso.html";
const COLORREF kBackground = RGB(0x07, 0x0b, 0x18);   // o --navy-950 (o aviso e sempre escuro)
const DWORD kCornerPreference = 33;                    // DWMWA_WINDOW_CORNER_PREFERENCE (Windows 11)
const DWORD kCornerRound = 2;                          // DWMWCP_ROUND

UINT MonitorDpi(HMONITOR monitor) {
    UINT x = 96;
    UINT y = 96;
    if (!monitor || FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &x, &y)) || x == 0) return 96;
    return x;
}

int Scale(int value, UINT dpi) { return MulDiv(value, static_cast<int>(dpi), 96); }

}  // namespace

NoticeWindow::~NoticeWindow() { Close(); }

bool NoticeWindow::Create(HINSTANCE instance, Callbacks callbacks) {
    callbacks_ = std::move(callbacks);
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = CreateSolidBrush(kBackground);
    windowClass.lpszClassName = kClassName;
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        Log("a classe do aviso nao foi registrada: " + std::to_string(GetLastError()));
        return false;
    }
    // Sem dono: uma janela com dono some quando a dona e minimizada (e o aviso e para a principal fora da frente).
    window_ = CreateWindowExW(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, kClassName, L"Starsonic Phone",
                              WS_POPUP | WS_CLIPCHILDREN, 0, 0, kWidth, kHeight, nullptr, nullptr, instance, this);
    if (!window_) {
        Log("o aviso nao foi criado: " + std::to_string(GetLastError()));
        return false;
    }
    DwmSetWindowAttribute(window_, kCornerPreference, &kCornerRound, sizeof(kCornerRound));
    return true;
}

void NoticeWindow::StartWebView(const WebViewHost::Options& options) {
    if (!window_ || webview_) return;
    WebViewHost::Callbacks callbacks;
    callbacks.message = [this](const std::string& json) {
        if (callbacks_.command) callbacks_.command(json);
    };
    callbacks.log = [this](const std::string& line) { Log("aviso: " + line); };
    callbacks.failed = [this](HRESULT) { Log("aviso: o WebView2 do aviso nao abriu (a ligacao aparece so na janela)"); };
    webview_.reset(new WebViewHost(window_, std::move(callbacks)));
    WebViewHost::Options noticeOptions = options;
    noticeOptions.startPage = kNoticePage;
    webview_->Create(noticeOptions);
}

void NoticeWindow::Post(const std::string& json) {
    if (webview_) webview_->Post(json);
}

void NoticeWindow::Show(HWND anchor) {
    if (!window_) return;
    const HMONITOR monitor = MonitorFromWindow(anchor ? anchor : window_, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO info = {};
    info.cbSize = sizeof(info);
    GetMonitorInfoW(monitor, &info);
    const UINT dpi = MonitorDpi(monitor);
    const int width = Scale(kWidth, dpi);
    const int height = Scale(kHeight, dpi);
    const int margin = Scale(kMargin, dpi);
    const RECT& work = info.rcWork;
    const int x = work.right - width - margin;
    const int y = work.bottom - height - margin;
    const bool wasVisible = Visible();
    SetWindowPos(window_, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    if (!wasVisible) Log("aviso de ligacao recebida aberto");
}

void NoticeWindow::Hide() {
    if (!Visible()) return;
    ShowWindow(window_, SW_HIDE);
    Log("aviso de ligacao recebida fechado");
}

bool NoticeWindow::Visible() const { return window_ && IsWindowVisible(window_); }

void NoticeWindow::Close() {
    if (webview_) webview_->Close();
    webview_.reset();
    if (window_) DestroyWindow(window_);
    window_ = nullptr;
}

LRESULT CALLBACK NoticeWindow::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    NoticeWindow* self = nullptr;
    if (message == WM_NCCREATE) {
        const CREATESTRUCTW* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        self = static_cast<NoticeWindow*>(create->lpCreateParams);
        self->window_ = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    } else {
        self = reinterpret_cast<NoticeWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    }
    if (!self) return DefWindowProcW(window, message, wParam, lParam);
    if (message == WM_NCDESTROY) {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        self->window_ = nullptr;
        return DefWindowProcW(window, message, wParam, lParam);
    }
    return self->Handle(message, wParam, lParam);
}

LRESULT NoticeWindow::Handle(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_MOUSEACTIVATE:
            // Um clique (no Atender, no Recusar) nao tira o foco de quem a pessoa estava usando.
            return MA_NOACTIVATE;
        case WM_SIZE:
            if (webview_) {
                RECT client = {};
                GetClientRect(window_, &client);
                webview_->Resize(client);
            }
            return 0;
        case WM_DPICHANGED: {
            const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
            SetWindowPos(window_, nullptr, suggested->left, suggested->top, suggested->right - suggested->left,
                         suggested->bottom - suggested->top, SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_CLOSE:
            // Alt+F4 nunca chega (sem foco); o Windows fechando: so esconde (quem fecha de vez e a janela principal).
            Hide();
            return 0;
        default:
            break;
    }
    return DefWindowProcW(window_, message, wParam, lParam);
}

void NoticeWindow::Log(const std::string& line) const {
    if (callbacks_.log) callbacks_.log(line);
}

}  // namespace starsonic
