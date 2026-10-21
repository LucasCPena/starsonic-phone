#include "Autostart.h"

#include <windows.h>

#include <vector>

namespace starsonic {

const wchar_t kRunKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const wchar_t kAutostartValue[] = L"Starsonic Phone";

std::wstring AutostartCommand(const std::wstring& exePath) { return L"\"" + exePath + L"\" --bandeja"; }

bool SetAutostart(bool on, const std::wstring& exePath, const std::wstring& runKey) {
    HKEY key = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, runKey.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr) !=
        ERROR_SUCCESS) {
        return false;
    }
    LSTATUS status = ERROR_SUCCESS;
    if (on) {
        const std::wstring command = AutostartCommand(exePath);
        status = RegSetValueExW(key, kAutostartValue, 0, REG_SZ, reinterpret_cast<const BYTE*>(command.c_str()),
                                static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
    } else {
        status = RegDeleteValueW(key, kAutostartValue);
        if (status == ERROR_FILE_NOT_FOUND) status = ERROR_SUCCESS;
    }
    RegCloseKey(key);
    return status == ERROR_SUCCESS;
}

std::optional<std::wstring> ReadAutostart(const std::wstring& runKey) {
    DWORD type = 0;
    DWORD size = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, runKey.c_str(), kAutostartValue, RRF_RT_REG_SZ, &type, nullptr, &size) !=
            ERROR_SUCCESS ||
        size < sizeof(wchar_t)) {
        return std::nullopt;
    }
    std::vector<wchar_t> buffer(size / sizeof(wchar_t) + 1, L'\0');
    size = static_cast<DWORD>(buffer.size() * sizeof(wchar_t));
    if (RegGetValueW(HKEY_CURRENT_USER, runKey.c_str(), kAutostartValue, RRF_RT_REG_SZ, &type, buffer.data(), &size) !=
        ERROR_SUCCESS) {
        return std::nullopt;
    }
    return std::wstring(buffer.data());
}

}  // namespace starsonic
