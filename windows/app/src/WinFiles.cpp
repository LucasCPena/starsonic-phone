#include "WinFiles.h"

#include <windows.h>

#include "Text.h"

namespace starsonic {

namespace {

const DWORD kMoveFlags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;

std::wstring Wide(const std::string& utf8) { return Utf8ToWide(utf8); }

bool IsSeparator(wchar_t ch) { return ch == L'\\' || ch == L'/'; }

// A pasta do arquivo ("" sem pasta no caminho).
std::wstring ParentOf(const std::wstring& path) {
    size_t end = path.size();
    while (end > 0 && !IsSeparator(path[end - 1])) --end;
    while (end > 0 && IsSeparator(path[end - 1])) --end;
    return path.substr(0, end);
}

bool IsFolder(const std::wstring& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
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

}  // namespace

bool CreateFolderTree(const std::wstring& folder) {
    if (folder.empty() || IsFolder(folder)) return true;
    // "C:" (a raiz do disco) e "\\servidor\pasta" ja existem ou nao podem ser criados.
    if (folder.size() == 2 && folder[1] == L':') return true;
    const std::wstring parent = ParentOf(folder);
    if (!parent.empty() && parent != folder && !CreateFolderTree(parent)) return false;
    if (CreateDirectoryW(folder.c_str(), nullptr)) return true;
    return GetLastError() == ERROR_ALREADY_EXISTS && IsFolder(folder);
}

std::optional<std::string> WinFiles::Read(const std::string& path) const {
    const HANDLE file = CreateFileW(Wide(path).c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return std::nullopt;
    std::optional<std::string> out;
    LARGE_INTEGER size = {};
    if (GetFileSizeEx(file, &size) && size.QuadPart >= 0 && size.QuadPart < 0x40000000LL) {
        std::string bytes(static_cast<size_t>(size.QuadPart), '\0');
        size_t done = 0;
        bool ok = true;
        while (done < bytes.size()) {
            DWORD read = 0;
            if (!ReadFile(file, &bytes[done], static_cast<DWORD>(bytes.size() - done), &read, nullptr) || read == 0) {
                ok = false;
                break;
            }
            done += read;
        }
        if (ok) out = std::move(bytes);
    }
    CloseHandle(file);
    return out;
}

bool WinFiles::WriteAtomic(const std::string& path, const std::string& bytes) {
    const std::wstring target = Wide(path);
    const std::wstring temporary = target + L".tmp";
    if (!CreateFolderTree(ParentOf(target))) return false;
    const HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL,
                                    nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    const bool written = WriteAll(file, bytes) && FlushFileBuffers(file);
    CloseHandle(file);
    if (written && MoveFileExW(temporary.c_str(), target.c_str(), kMoveFlags)) return true;
    DeleteFileW(temporary.c_str());
    return false;
}

bool WinFiles::Exists(const std::string& path) const {
    return GetFileAttributesW(Wide(path).c_str()) != INVALID_FILE_ATTRIBUTES;
}

bool WinFiles::Rename(const std::string& from, const std::string& to) {
    return MoveFileExW(Wide(from).c_str(), Wide(to).c_str(), kMoveFlags) != 0;
}

}  // namespace starsonic
