// O diagnostico.log do executavel novo (windows/app/src/DiagLog.h): cada linha com a data e a hora, uma linha por
// Write, e a troca para o diagnostico.log.1 passando de 1 MB (spec 6.6). So no Windows: entra no desktop_tests do job
// windows.
#include <windows.h>

#include <optional>
#include <string>

#include "DiagLog.h"
#include "Text.h"
#include "WinFiles.h"
#include "test_support.h"

using starsonic::DiagLog;
using starsonic::WinFiles;

namespace {

bool HasStamp(const std::string& line) {
    // "2026-10-21 19:30:00.123 "
    if (line.size() < 24) return false;
    const char* pattern = "dddd-dd-dd dd:dd:dd.ddd ";
    for (size_t i = 0; i < 24; ++i) {
        if (pattern[i] == 'd' ? (line[i] < '0' || line[i] > '9') : line[i] != pattern[i]) return false;
    }
    return true;
}

long long SizeOf(const std::string& path) {
    WIN32_FILE_ATTRIBUTE_DATA data = {};
    if (!GetFileAttributesExW(starsonic::Utf8ToWide(path).c_str(), GetFileExInfoStandard, &data)) return -1;
    return (static_cast<long long>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
}

}  // namespace

TEST_CASE("diagnostico.log stamps each line and rotates at 1 MB keeping one .1 copy") {
    wchar_t base[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, base);
    const std::string folder = starsonic::WideToUtf8(base) + "starsonic-log-" + std::to_string(GetCurrentProcessId()) +
                               "-" + std::to_string(GetTickCount64());
    REQUIRE(starsonic::CreateFolderTree(starsonic::Utf8ToWide(folder)));
    const std::string path = folder + "\\diagnostico.log";
    WinFiles files;
    {
        DiagLog log(starsonic::Utf8ToWide(path));
        log.Write("primeira linha");
        log.Write("com\r\nquebra");
        const std::optional<std::string> text = files.Read(path);
        REQUIRE(text.has_value());
        const size_t end = text->find("\r\n");
        REQUIRE(end != std::string::npos);
        CHECK(HasStamp(text->substr(0, end)));
        CHECK(text->substr(24, end - 24) == "primeira linha");
        CHECK(text->find("com  quebra\r\n") != std::string::npos);   // a quebra virou espaco: uma linha so

        // Mais de 1 MB: o arquivo vira o .1 e um novo comeca, sem passar de 1 MB.
        const std::string filler(1000, 'x');
        for (int i = 0; i < 1100; ++i) log.Write(filler);
        CHECK(files.Exists(path + ".1"));
        CHECK(SizeOf(path + ".1") <= DiagLog::kMaxBytes);
        CHECK(SizeOf(path + ".1") > DiagLog::kMaxBytes - 2000);
        CHECK(SizeOf(path) < 200 * 1024);
        const std::optional<std::string> first = files.Read(path + ".1");
        REQUIRE(first.has_value());
        CHECK(first->find("primeira linha") != std::string::npos);

        // Outra troca: o .1 de antes sai (so uma copia fica).
        for (int i = 0; i < 1100; ++i) log.Write(filler);
        const std::optional<std::string> second = files.Read(path + ".1");
        REQUIRE(second.has_value());
        CHECK(second->find("primeira linha") == std::string::npos);
        CHECK_FALSE(files.Exists(path + ".2"));
        CHECK(SizeOf(path) <= DiagLog::kMaxBytes);
    }
    DeleteFileW(starsonic::Utf8ToWide(path).c_str());
    DeleteFileW(starsonic::Utf8ToWide(path + ".1").c_str());
    RemoveDirectoryW(starsonic::Utf8ToWide(folder).c_str());
}

TEST_CASE("diagnostico.log never keeps the Authorization digest of the engine messages") {
    wchar_t base[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, base);
    const std::string folder = starsonic::WideToUtf8(base) + "starsonic-log-auth-" +
                               std::to_string(GetCurrentProcessId()) + "-" + std::to_string(GetTickCount64());
    REQUIRE(starsonic::CreateFolderTree(starsonic::Utf8ToWide(folder)));
    const std::string path = folder + "\\diagnostico.log";
    WinFiles files;
    {
        DiagLog log(starsonic::Utf8ToWide(path));
        // Como o motor escreve no nivel 4: a mensagem SIP inteira numa linha do OnLog.
        log.Write("motor 4: .TX 612 bytes Request msg REGISTER/cseq=2 (tdta0x1) to UDP 1.2.3.4:5060:\r\n"
                  "REGISTER sip:pbx.example.com SIP/2.0\r\n"
                  "Authorization: Digest username=\"2001\", realm=\"asterisk\", nonce=\"6f1c\", "
                  "response=\"0123456789abcdef0123456789abcdef\"\r\n"
                  "Proxy-Authorization: Digest response=\"fedcba9876543210fedcba9876543210\"\r\n"
                  "Content-Length:  0\r\n");
    }
    const std::optional<std::string> text = files.Read(path);
    REQUIRE(text.has_value());
    CHECK(text->find("0123456789abcdef0123456789abcdef") == std::string::npos);
    CHECK(text->find("fedcba9876543210fedcba9876543210") == std::string::npos);
    CHECK(text->find("nonce") == std::string::npos);
    CHECK(text->find("Authorization: <oculto>  Proxy-Authorization: <oculto>  Content-Length:  0") != std::string::npos);
    CHECK(text->find("REGISTER sip:pbx.example.com SIP/2.0") != std::string::npos);
    DeleteFileW(starsonic::Utf8ToWide(path).c_str());
    RemoveDirectoryW(starsonic::Utf8ToWide(folder).c_str());
}
