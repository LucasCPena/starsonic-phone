// O chat no Windows de verdade (0.2.0): a chave do chat.json pelo DPAPI (windows/app/src/DpapiCipher.h) e o arquivo
// baixado gravado na pasta (windows/app/src/ChatSave.h), com o "(2)" e o fluxo Zone.Identifier (o "Mark of the Web").
// So no Windows: entra no desktop_tests do job windows (no Linux, este arquivo fica vazio).
#ifdef _WIN32
#include <windows.h>

#include <optional>
#include <string>

#include "Chat.h"
#include "ChatFiles.h"
#include "ChatSave.h"
#include "DpapiCipher.h"
#include "Text.h"
#include "WinFiles.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// Uma chave inventada (43 de [A-Za-z0-9_-], o formato do servidor do chat), nunca uma de verdade.
const char kKey[] = "Chave_de-teste-inventada-0123456789-ABCDxyz";

// Uma pasta nova no %TEMP%, apagada no fim com os arquivos que o teste gravou nela (os fluxos vao junto).
struct TempFolder {
    std::wstring path;

    TempFolder() {
        wchar_t base[MAX_PATH] = {};
        GetTempPathW(MAX_PATH, base);
        path = std::wstring(base) + L"starsonic-chat-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
               std::to_wstring(GetTickCount64());
        CreateDirectoryW(path.c_str(), nullptr);
    }
    ~TempFolder() {
        WIN32_FIND_DATAW found = {};
        const HANDLE search = FindFirstFileW((path + L"\\*").c_str(), &found);
        if (search != INVALID_HANDLE_VALUE) {
            do {
                if ((found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
                    DeleteFileW((path + L"\\" + found.cFileName).c_str());
                }
            } while (FindNextFileW(search, &found));
            FindClose(search);
        }
        RemoveDirectoryW(path.c_str());
    }
};

// O arquivo (ou o fluxo, com o ":nome") inteiro; nada se ele nao abre.
std::optional<std::string> ReadAll(const std::wstring& path) {
    const HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                    FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return std::nullopt;
    std::string bytes;
    char buffer[4096];
    DWORD read = 0;
    while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read > 0) bytes.append(buffer, read);
    CloseHandle(file);
    return bytes;
}

}  // namespace

TEST_CASE("the chat store keeps the key with the real DPAPI") {
    TempFolder folder;
    WinFiles files;
    DpapiCipher cipher;
    const std::string path = WideToUtf8(folder.path) + "\\chat.json";
    // "ACME Comercio Ltda", com o acento, em UTF-8.
    const std::string company = "ACME Com\xc3\xa9rcio Ltda";
    ChatStore store(files, cipher, path);
    REQUIRE(store.Load());
    REQUIRE(store.SetLink(ChatLink{kKey, company}));
    REQUIRE(store.AddRamal("pbx.exemplo.com", "2001"));

    // No disco, so o base64 do DPAPI (e o fim de linha): nem a chave, nem a empresa, nem o ramal em claro.
    const std::optional<std::string> bytes = files.Read(path);
    REQUIRE(bytes.has_value());
    CHECK(bytes->find(kKey) == std::string::npos);
    CHECK(bytes->find("ACME") == std::string::npos);
    CHECK(bytes->find("pbx.exemplo.com") == std::string::npos);
    CHECK(bytes->find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n") ==
          std::string::npos);

    // Outra abertura (outro cifrador, o mesmo usuario do Windows) le tudo de volta.
    DpapiCipher again;
    ChatStore reloaded(files, again, path);
    REQUIRE(reloaded.Load());
    REQUIRE(reloaded.Link().has_value());
    CHECK(reloaded.Link()->chave == kKey);
    CHECK(reloaded.Link()->empresa == company);
    CHECK(reloaded.HasRamal("pbx.exemplo.com", "2001"));
}

TEST_CASE("a saved download gets (2) the second time and the Zone.Identifier stream") {
    TempFolder folder;
    const std::string bytes("%PDF-1.4\r\n\0\x01\xff", 13);
    const std::wstring first = SaveChatFile(folder.path, "a.pdf", bytes);
    CHECK(first == folder.path + L"\\a.pdf");
    const std::wstring second = SaveChatFile(folder.path, "a.pdf", "outro");
    CHECK(second == folder.path + L"\\a (2).pdf");
    CHECK(ReadAll(first) == std::optional<std::string>(bytes));
    CHECK(ReadAll(second) == std::optional<std::string>("outro"));

    // O fluxo Zone.Identifier de cada um: a zona 3 (a internet), com o endereco do chat.
    CHECK(ReadAll(first + L":Zone.Identifier") == std::optional<std::string>(ZoneIdentifier()));
    CHECK(ReadAll(second + L":Zone.Identifier") == std::optional<std::string>(ZoneIdentifier()));

    // O nome do chat passa pelo SafeDownloadName: nunca fora da pasta, nunca cortado no NUL (o "nota.exe").
    CHECK(SaveChatFile(folder.path, std::string("..\\nota.exe\0.pdf", 16), "x") == folder.path + L"\\nota.exe.pdf");
    CHECK_FALSE(ReadAll(folder.path + L"\\nota.exe").has_value());

    // Uma pasta que nao existe: "", e nada gravado.
    CHECK(SaveChatFile(folder.path + L"\\nao-existe", "a.pdf", "x").empty());
}
#endif
