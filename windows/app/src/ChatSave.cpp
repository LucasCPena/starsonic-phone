#include "ChatSave.h"

#include <windows.h>

#include "ChatFiles.h"
#include "Text.h"

namespace starsonic {

namespace {

// Quantas vezes o CREATE_NEW pega o proximo nome livre (outro arquivo com o mesmo nome chegou entre o FreeName e ele).
const int kCreateAttempts = 20;

std::wstring PathIn(const std::wstring& folder, const std::string& name) {
    std::wstring path = folder;
    if (!path.empty() && path.back() != L'\\' && path.back() != L'/') path += L'\\';
    return path + Utf8ToWide(name);
}

bool WriteAll(HANDLE file, const std::string& bytes) {
    size_t done = 0;
    while (done < bytes.size()) {
        const size_t left = bytes.size() - done;
        const DWORD chunk = left > 0x10000000u ? 0x10000000u : static_cast<DWORD>(left);
        DWORD written = 0;
        if (!WriteFile(file, bytes.data() + done, chunk, &written, nullptr) || written == 0) return false;
        done += written;
    }
    return true;
}

// O texto inteiro num arquivo (ou num fluxo dele, com o ":nome"), no lugar do que estava.
bool WriteText(const std::wstring& path, const std::string& text) {
    const HANDLE file =
        CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    const bool written = WriteAll(file, text);
    CloseHandle(file);
    return written;
}

}  // namespace

std::wstring SaveChatFile(const std::wstring& pasta, const std::string& nome, const std::string& bytes) {
    // O nome limpo ja e UTF-8 valido e sem NUL: a conversao para o UTF-16 nunca o corta.
    const std::string safe = SafeDownloadName(nome);
    const auto exists = [&pasta](const std::string& candidate) {
        return GetFileAttributesW(PathIn(pasta, candidate).c_str()) != INVALID_FILE_ATTRIBUTES;
    };
    for (int attempt = 0; attempt < kCreateAttempts; ++attempt) {
        const std::string name = FreeName(safe, exists);
        if (name.empty()) return std::wstring();
        const std::wstring path = PathIn(pasta, name);
        // CREATE_NEW: nunca por cima de um arquivo que ja estava la.
        const HANDLE file =
            CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) {
            const DWORD error = GetLastError();
            if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) continue;   // outro chegou antes
            return std::wstring();
        }
        const bool written = WriteAll(file, bytes);
        CloseHandle(file);
        if (written && WriteText(path + L":Zone.Identifier", ZoneIdentifier())) return path;
        DeleteFileW(path.c_str());   // pela metade, ou sem a marca da internet
        return std::wstring();
    }
    return std::wstring();
}

}  // namespace starsonic
