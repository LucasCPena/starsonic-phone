#include "SingleInstance.h"

#include <utility>

namespace starsonic {

const wchar_t SingleInstance::kAppName[] = L"StarsonicPhone";

namespace {

// A marca do WM_COPYDATA da instancia unica ("SPH1"): outro WM_COPYDATA que chegue na janela e ignorado.
const ULONG_PTR kCopyDataMark = 0x53504831;
// Um limite para o que chega (uma linha de comando do Windows tem no maximo 32767 caracteres).
const DWORD kMaxPayloadBytes = 64 * 1024;
const DWORD kPollMs = 50;

// Os argumentos em UTF-16, cada um terminado em zero.
std::wstring Pack(const std::vector<std::wstring>& arguments) {
    std::wstring out;
    for (const std::wstring& argument : arguments) {
        out += argument;
        out.push_back(L'\0');
    }
    return out;
}

bool Unpack(const COPYDATASTRUCT& data, std::vector<std::wstring>* arguments) {
    arguments->clear();
    if (data.cbData == 0) return true;
    if (!data.lpData || data.cbData > kMaxPayloadBytes || data.cbData % sizeof(wchar_t) != 0) return false;
    const wchar_t* text = static_cast<const wchar_t*>(data.lpData);
    const size_t count = data.cbData / sizeof(wchar_t);
    if (text[count - 1] != L'\0') return false;
    size_t start = 0;
    for (size_t i = 0; i < count; ++i) {
        if (text[i] == L'\0') {
            arguments->emplace_back(text + start, i - start);
            start = i + 1;
        }
    }
    return true;
}

}  // namespace

SingleInstance::SingleInstance(std::wstring name) : name_(std::move(name)), className_(name_ + L".Instancia") {}

SingleInstance::~SingleInstance() {
    if (window_) DestroyWindow(window_);
    window_ = nullptr;
    if (mutex_) CloseHandle(mutex_);
    mutex_ = nullptr;
}

SingleInstance::Claim SingleInstance::Start(const std::vector<std::wstring>& arguments, DWORD waitMs) {
    if (!mutex_) {
        const std::wstring mutexName = L"Local\\" + name_;
        mutex_ = CreateMutexW(nullptr, FALSE, mutexName.c_str());
        const DWORD error = GetLastError();
        // Sem o mutex (nao deveria acontecer): abre como a primeira, como antes da instancia unica.
        if (!mutex_) return Claim::First;
        if (error != ERROR_ALREADY_EXISTS) return Claim::First;
        // Outra ja tem o mutex: este so serve para saber disso.
        CloseHandle(mutex_);
        mutex_ = nullptr;
    }

    // A janela de mensagens da primeira (ela pode ainda estar abrindo).
    HWND target = nullptr;
    const ULONGLONG deadline = GetTickCount64() + waitMs;
    for (;;) {
        target = FindWindowExW(HWND_MESSAGE, nullptr, className_.c_str(), nullptr);
        if (target || GetTickCount64() >= deadline) break;
        Sleep(kPollMs);
    }
    if (!target) return Claim::NotDelivered;

    // A primeira pode vir para a frente (esta abertura foi da pessoa: ela tem o direito e o passa).
    DWORD processId = 0;
    GetWindowThreadProcessId(target, &processId);
    if (processId != 0) AllowSetForegroundWindow(processId);

    const std::wstring payload = Pack(arguments);
    COPYDATASTRUCT data = {};
    data.dwData = kCopyDataMark;
    data.cbData = static_cast<DWORD>(payload.size() * sizeof(wchar_t));
    data.lpData = payload.empty() ? nullptr : const_cast<wchar_t*>(payload.data());
    DWORD_PTR result = 0;
    const ULONGLONG now = GetTickCount64();
    const UINT timeout = static_cast<UINT>(now < deadline ? deadline - now : 0) + 1000;
    const LRESULT sent = SendMessageTimeoutW(target, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data),
                                             SMTO_ABORTIFHUNG | SMTO_BLOCK, timeout, &result);
    return sent != 0 && result == TRUE ? Claim::Delivered : Claim::NotDelivered;
}

bool SingleInstance::Listen(HINSTANCE instance, Receiver receiver) {
    if (window_) return true;
    receiver_ = std::move(receiver);
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = className_.c_str();
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    window_ = CreateWindowExW(0, className_.c_str(), name_.c_str(), 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, instance, this);
    if (!window_) return false;
    // O WM_COPYDATA tambem de uma abertura com outro nivel de integridade (o conteudo e conferido no Unpack).
    ChangeWindowMessageFilterEx(window_, WM_COPYDATA, MSGFLT_ALLOW, nullptr);
    return true;
}

LRESULT CALLBACK SingleInstance::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
        const CREATESTRUCTW* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
        return DefWindowProcW(window, message, wParam, lParam);
    }
    SingleInstance* self = reinterpret_cast<SingleInstance*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCDESTROY) {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        if (self) self->window_ = nullptr;
        return DefWindowProcW(window, message, wParam, lParam);
    }
    if (message == WM_COPYDATA && self) {
        const COPYDATASTRUCT* data = reinterpret_cast<const COPYDATASTRUCT*>(lParam);
        std::vector<std::wstring> arguments;
        if (!data || data->dwData != kCopyDataMark || !Unpack(*data, &arguments)) return FALSE;
        if (self->receiver_) self->receiver_(arguments);
        return TRUE;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

}  // namespace starsonic
