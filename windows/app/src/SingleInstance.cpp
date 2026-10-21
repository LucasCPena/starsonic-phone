#include "SingleInstance.h"

#include <utility>

namespace starsonic {

const wchar_t SingleInstance::kAppName[] = L"StarsonicPhone";

SingleInstance::SingleInstance(std::wstring name) : name_(std::move(name)), className_(name_ + L".Instancia") {}

SingleInstance::~SingleInstance() {}

SingleInstance::Claim SingleInstance::Start(const std::vector<std::wstring>& /*arguments*/, DWORD /*waitMs*/) {
    return Claim::First;   // ainda nao (o teste vem antes)
}

bool SingleInstance::Listen(HINSTANCE /*instance*/, Receiver receiver) {
    receiver_ = std::move(receiver);
    return false;
}

LRESULT CALLBACK SingleInstance::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    return DefWindowProcW(window, message, wParam, lParam);
}

}  // namespace starsonic
