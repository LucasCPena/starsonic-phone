#include "Autostart.h"

#include <windows.h>

#include <vector>

namespace starsonic {

const wchar_t kRunKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const wchar_t kApprovedKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const wchar_t kAutostartValue[] = L"Starsonic Phone";

namespace {

// O primeiro byte do valor do StartupApproved quando o Gerenciador de Tarefas desabilitou o item.
const BYTE kApprovedDisabled = 0x03;

}  // namespace

std::wstring AutostartCommand(const std::wstring& exePath) { return L"\"" + exePath + L"\" --bandeja"; }

bool SetAutostart(bool on, const std::wstring& exePath, const std::wstring& runKey, const std::wstring& approvedKey) {
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
    if (status == ERROR_SUCCESS && on) {
        // Ligar no app tambem tira o "Desabilitado" do Gerenciador de Tarefas.
        const LSTATUS removed = RegDeleteKeyValueW(HKEY_CURRENT_USER, approvedKey.c_str(), kAutostartValue);
        if (removed != ERROR_SUCCESS && removed != ERROR_FILE_NOT_FOUND && removed != ERROR_PATH_NOT_FOUND) {
            status = removed;
        }
    }
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

bool ObserveAutostart(const std::wstring& runKey, const std::wstring& approvedKey) {
    if (!ReadAutostart(runKey)) return false;
    BYTE state[256] = {};
    DWORD size = sizeof(state);
    DWORD type = 0;
    const LSTATUS status =
        RegGetValueW(HKEY_CURRENT_USER, approvedKey.c_str(), kAutostartValue, RRF_RT_REG_BINARY, &type, state, &size);
    // Sem a entrada (ou ilegivel): habilitado.
    if (status != ERROR_SUCCESS || size == 0) return true;
    return state[0] != kApprovedDisabled;
}

}  // namespace starsonic
