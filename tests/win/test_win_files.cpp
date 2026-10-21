// O disco do app de PC no Windows (windows/app/src/WinFiles.h): a gravacao atomica (temporario + MoveFileExW) e os
// caminhos UTF-8 (spec 6.6). So no Windows: entra no desktop_tests do job windows.
#include <windows.h>

#include <optional>
#include <string>

#include "WinFiles.h"
#include "test_support.h"

using starsonic::WinFiles;

namespace {

std::wstring Wide(const std::string& utf8) {
    if (utf8.empty()) return std::wstring();
    const int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), &out[0], size);
    return out;
}

std::string Utf8(const std::wstring& wide) {
    if (wide.empty()) return std::string();
    const int size =
        WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), &out[0], size, nullptr, nullptr);
    return out;
}

// Uma pasta nova no %TEMP% (com acento no nome: os caminhos sao UTF-8), apagada no fim.
struct TempFolder {
    std::string path;

    TempFolder() {
        wchar_t base[MAX_PATH] = {};
        GetTempPathW(MAX_PATH, base);
        // "Configura\u00e7\u00f5es" em UTF-8.
        path = Utf8(base) + "starsonic-teste-" + std::to_string(GetCurrentProcessId()) + "-" +
               std::to_string(GetTickCount64()) + "\\Configura\xc3\xa7\xc3\xb5" "es";
    }
    ~TempFolder() {
        // So os arquivos que o teste cria (sem apagar nada fora da pasta).
        for (const char* name : {"\\sub\\contas.json", "\\sub\\contas.json.tmp", "\\sub\\outro.json"}) {
            DeleteFileW(Wide(path + name).c_str());
        }
        RemoveDirectoryW(Wide(path + "\\sub").c_str());
        RemoveDirectoryW(Wide(path).c_str());
        const std::string parent = path.substr(0, path.find_last_of('\\'));
        RemoveDirectoryW(Wide(parent).c_str());
    }
};

}  // namespace

TEST_CASE("WriteAtomic replaces the file and leaves no temporary") {
    TempFolder folder;
    WinFiles files;
    // A pasta (e a subpasta) ainda nao existem: o WriteAtomic as cria.
    const std::string path = folder.path + "\\sub\\contas.json";
    CHECK_FALSE(files.Exists(path));
    CHECK_FALSE(files.Read(path).has_value());

    REQUIRE(files.WriteAtomic(path, "{\"versao\":1}"));
    CHECK(files.Exists(path));
    CHECK(files.Read(path) == std::optional<std::string>("{\"versao\":1}"));
    CHECK_FALSE(files.Exists(path + ".tmp"));

    // Gravar de novo troca o conteudo inteiro (mais curto que o de antes: nada sobra do antigo), sem temporario.
    const std::string bytes = std::string("a\0b\r\n", 5) + "\xc3\xa7";
    REQUIRE(files.WriteAtomic(path, bytes));
    CHECK(files.Read(path) == std::optional<std::string>(bytes));
    CHECK_FALSE(files.Exists(path + ".tmp"));

    REQUIRE(files.WriteAtomic(path, ""));
    CHECK(files.Read(path) == std::optional<std::string>(""));
    CHECK_FALSE(files.Exists(path + ".tmp"));

    // Rename troca o destino que ja existe; sem a origem, false.
    const std::string other = folder.path + "\\sub\\outro.json";
    REQUIRE(files.WriteAtomic(other, "outro"));
    CHECK(files.Rename(other, path));
    CHECK(files.Read(path) == std::optional<std::string>("outro"));
    CHECK_FALSE(files.Exists(other));
    CHECK_FALSE(files.Rename(other, path));
    CHECK(files.Read(path) == std::optional<std::string>("outro"));

    // Um arquivo aberto por outro programa (sem compartilhar a escrita) nao e trocado: false, e o de antes fica.
    const HANDLE held = CreateFileW(Wide(path).c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                    FILE_ATTRIBUTE_NORMAL, nullptr);
    REQUIRE(held != INVALID_HANDLE_VALUE);
    CHECK_FALSE(files.WriteAtomic(path, "novo"));
    CloseHandle(held);
    CHECK(files.Read(path) == std::optional<std::string>("outro"));
    CHECK_FALSE(files.Exists(path + ".tmp"));
}
