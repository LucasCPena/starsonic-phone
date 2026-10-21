#include "Diagnostics.h"

#include <shellapi.h>

#include <cwchar>
#include <vector>

namespace starsonic {

namespace {

// Junta o arquivo ao destino. false: o destino recusou. Sem o arquivo: nada (true), e *found fica false.
bool AppendFile(const std::wstring& path, HANDLE target, bool* found) {
    *found = false;
    // O app continua escrevendo no diagnostico.log: le sem travar (o DiagLog abre com FILE_SHARE_READ).
    const HANDLE source = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (source == INVALID_HANDLE_VALUE) return true;
    *found = true;
    std::vector<char> buffer(64 * 1024);
    bool ok = true;
    for (;;) {
        DWORD read = 0;
        if (!ReadFile(source, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr) || read == 0) break;
        DWORD written = 0;
        if (!WriteFile(target, buffer.data(), read, &written, nullptr) || written != read) {
            ok = false;
            break;
        }
    }
    CloseHandle(source);
    return ok;
}

}  // namespace

std::wstring DiagnosticsCopyName(const SYSTEMTIME& now) {
    wchar_t text[96];
    std::swprintf(text, sizeof(text) / sizeof(text[0]), L"Starsonic Phone diagnostico %04u-%02u-%02u %02u-%02u-%02u.log",
                  now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);
    return text;
}

std::optional<std::wstring> CopyDiagnostics(const std::wstring& logPath, const std::wstring& folder,
                                            const SYSTEMTIME& now) {
    if (GetFileAttributesW(logPath.c_str()) == INVALID_FILE_ATTRIBUTES) return std::nullopt;
    const std::wstring copy = folder + L"\\" + DiagnosticsCopyName(now);
    const HANDLE target =
        CreateFileW(copy.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (target == INVALID_HANDLE_VALUE) return std::nullopt;
    bool foundOld = false;
    bool foundLog = false;
    const bool ok = AppendFile(logPath + L".1", target, &foundOld) && AppendFile(logPath, target, &foundLog);
    CloseHandle(target);
    if (!ok || !foundLog) {
        DeleteFileW(copy.c_str());
        return std::nullopt;
    }
    return copy;
}

std::wstring TempFolder() {
    wchar_t temp[MAX_PATH + 1] = {};
    const DWORD length = GetTempPathW(MAX_PATH + 1, temp);
    if (length == 0 || length > MAX_PATH) return std::wstring();
    std::wstring out(temp, length);
    while (out.size() > 3 && (out.back() == L'\\' || out.back() == L'/')) out.pop_back();
    return out;
}

void ShowInExplorer(const std::wstring& path) {
    const std::wstring parameters = L"/select,\"" + path + L"\"";
    ShellExecuteW(nullptr, L"open", L"explorer.exe", parameters.c_str(), nullptr, SW_SHOWNORMAL);
}

}  // namespace starsonic
