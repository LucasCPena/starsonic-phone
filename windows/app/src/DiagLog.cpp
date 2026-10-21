#include "DiagLog.h"

#include <windows.h>

#include <cstdio>
#include <utility>

#include "LogRedaction.h"

namespace starsonic {

namespace {

std::string Stamp() {
    SYSTEMTIME now = {};
    GetLocalTime(&now);
    char text[32];
    std::snprintf(text, sizeof(text), "%04u-%02u-%02u %02u:%02u:%02u.%03u ", now.wYear, now.wMonth, now.wDay, now.wHour,
                  now.wMinute, now.wSecond, now.wMilliseconds);
    return text;
}

std::string OneLine(const std::string& line) {
    std::string out = line;
    for (char& ch : out) {
        if (ch == '\r' || ch == '\n') ch = ' ';
    }
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

}  // namespace

DiagLog::DiagLog(std::wstring path) : path_(std::move(path)) {
    std::lock_guard<std::mutex> lock(mutex_);
    OpenLocked();
}

DiagLog::~DiagLog() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (file_) CloseHandle(static_cast<HANDLE>(file_));
    file_ = nullptr;
}

void DiagLog::Write(const std::string& line) {
    // O valor do Authorization sai antes de as quebras virarem espaco (o RedactSecrets le linha por linha).
    const std::string text = Stamp() + OneLine(RedactSecrets(line)) + "\r\n";
    std::lock_guard<std::mutex> lock(mutex_);
    if (size_ + static_cast<long long>(text.size()) > kMaxBytes) RotateLocked();
    if (!file_) OpenLocked();
    if (!file_) return;
    DWORD written = 0;
    if (WriteFile(static_cast<HANDLE>(file_), text.data(), static_cast<DWORD>(text.size()), &written, nullptr)) {
        size_ += written;
    }
}

void DiagLog::OpenLocked() {
    // FILE_SHARE_READ | FILE_SHARE_DELETE: o "Enviar diagnostico" e o teste leem o arquivo com o app aberto.
    const HANDLE file = CreateFileW(path_.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        file_ = nullptr;
        return;
    }
    file_ = file;
    LARGE_INTEGER size = {};
    size_ = GetFileSizeEx(file, &size) ? size.QuadPart : 0;
}

void DiagLog::RotateLocked() {
    if (file_) CloseHandle(static_cast<HANDLE>(file_));
    file_ = nullptr;
    const std::wstring old = path_ + L".1";
    if (!MoveFileExW(path_.c_str(), old.c_str(), MOVEFILE_REPLACE_EXISTING)) {
        // Sem a troca (o .1 aberto por outro programa): comeca de novo no mesmo arquivo, sem passar de 1 MB.
        const HANDLE file = CreateFileW(path_.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                        nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    }
    OpenLocked();
}

}  // namespace starsonic
