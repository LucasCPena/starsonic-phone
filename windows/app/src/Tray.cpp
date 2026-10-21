#include "Tray.h"

#include <commctrl.h>
#include <shellapi.h>
#include <windowsx.h>

#include <cwchar>

#include "resource.h"

namespace starsonic {

namespace {

const UINT kIconId = 1;
const UINT kBlinkMs = 600;
const wchar_t kTip[] = L"Starsonic Phone";

enum MenuItem : UINT { kOpen = 1, kDoNotDisturb = 2, kQuit = 3 };

int ResourceFor(int index) {
    switch (index) {
        case 0:
            return IDI_TRAY_CONNECTED;
        case 1:
            return IDI_TRAY_OFFLINE;
        case 2:
            return IDI_TRAY_DND;
        case 3:
            return IDI_TRAY_MISSED;
        default:
            return IDI_TRAY_RINGING;
    }
}

}  // namespace

Tray::~Tray() {
    Remove();
    for (HICON& icon : icons_) {
        if (icon) DestroyIcon(icon);
        icon = nullptr;
    }
}

UINT Tray::TaskbarCreatedMessage() {
    static const UINT message = RegisterWindowMessageW(L"TaskbarCreated");
    return message;
}

bool Tray::Create(HWND owner, HINSTANCE instance) {
    owner_ = owner;
    instance_ = instance;
    return Add();
}

void Tray::Recreate() {
    added_ = false;
    Add();
}

HICON Tray::IconFor(TrayIcon icon) {
    int index = static_cast<int>(icon);
    if (ringing_ && blinkOn_) index = 4;
    if (!icons_[index]) {
        // O tamanho pequeno da escala de agora (16 px em 100%).
        if (FAILED(LoadIconMetric(instance_, MAKEINTRESOURCEW(ResourceFor(index)), LIM_SMALL, &icons_[index]))) {
            icons_[index] = nullptr;
        }
    }
    return icons_[index];
}

bool Tray::Add() {
    if (!owner_) return false;
    NOTIFYICONDATAW data = {};
    data.cbSize = sizeof(data);
    data.hWnd = owner_;
    data.uID = kIconId;
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
    data.uCallbackMessage = kMessage;
    data.hIcon = IconFor(icon_);
    wcsncpy_s(data.szTip, kTip, _TRUNCATE);
    if (!Shell_NotifyIconW(NIM_ADD, &data)) {
        // Pode ter sobrado de antes (o Explorer reiniciou no meio): troca.
        if (!Shell_NotifyIconW(NIM_MODIFY, &data)) return false;
    }
    data.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &data);
    added_ = true;
    return true;
}

void Tray::Remove() {
    if (!added_ || !owner_) return;
    NOTIFYICONDATAW data = {};
    data.cbSize = sizeof(data);
    data.hWnd = owner_;
    data.uID = kIconId;
    Shell_NotifyIconW(NIM_DELETE, &data);
    KillTimer(owner_, kBlinkTimer);
    added_ = false;
}

void Tray::Update() {
    if (!added_) {
        Add();
        return;
    }
    NOTIFYICONDATAW data = {};
    data.cbSize = sizeof(data);
    data.hWnd = owner_;
    data.uID = kIconId;
    data.uFlags = NIF_ICON;
    data.hIcon = IconFor(icon_);
    Shell_NotifyIconW(NIM_MODIFY, &data);
}

void Tray::SetState(TrayIcon icon, bool doNotDisturb) {
    doNotDisturb_ = doNotDisturb;
    if (icon == icon_) return;
    icon_ = icon;
    Update();
}

void Tray::SetRinging(bool ringing) {
    if (ringing == ringing_) return;
    ringing_ = ringing;
    blinkOn_ = ringing;
    if (ringing) {
        SetTimer(owner_, kBlinkTimer, kBlinkMs, nullptr);
    } else {
        KillTimer(owner_, kBlinkTimer);
    }
    Update();
}

void Tray::Blink() {
    if (!ringing_) {
        KillTimer(owner_, kBlinkTimer);
        return;
    }
    blinkOn_ = !blinkOn_;
    Update();
}

Tray::Choice Tray::Handle(WPARAM wParam, LPARAM lParam) {
    // NOTIFYICON_VERSION_4: o evento no LOWORD do lParam e o ponto (da tela) no wParam.
    switch (LOWORD(lParam)) {
        case NIN_SELECT:
        case NIN_KEYSELECT:
        case WM_LBUTTONDBLCLK:
            return Choice::Open;
        case WM_CONTEXTMENU:
            return ShowMenu(GET_X_LPARAM(wParam), GET_Y_LPARAM(wParam));
        default:
            return Choice::None;
    }
}

Tray::Choice Tray::ShowMenu(int x, int y) {
    const HMENU menu = CreatePopupMenu();
    if (!menu) return Choice::None;
    AppendMenuW(menu, MF_STRING, kOpen, L"Abrir");
    AppendMenuW(menu, MF_STRING | (doNotDisturb_ ? MF_CHECKED : MF_UNCHECKED), kDoNotDisturb, L"N\u00e3o perturbe");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, kQuit, L"Sair");
    SetMenuDefaultItem(menu, kOpen, FALSE);
    // O menu fecha ao clicar fora so se a janela dona estiver na frente (a regra do TrackPopupMenu).
    SetForegroundWindow(owner_);
    UINT flags = TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON;
    flags |= GetSystemMetrics(SM_MENUDROPALIGNMENT) ? TPM_RIGHTALIGN : TPM_LEFTALIGN;
    const UINT chosen = static_cast<UINT>(TrackPopupMenuEx(menu, flags, x, y, owner_, nullptr));
    PostMessageW(owner_, WM_NULL, 0, 0);
    DestroyMenu(menu);
    switch (chosen) {
        case kOpen:
            return Choice::Open;
        case kDoNotDisturb:
            return Choice::ToggleDoNotDisturb;
        case kQuit:
            return Choice::Quit;
        default:
            return Choice::None;
    }
}

}  // namespace starsonic
