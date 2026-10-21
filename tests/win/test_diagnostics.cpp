// O "Enviar diagnostico" do app novo (windows/app/src/Diagnostics.h): a copia do diagnostico.log (com o .1 antes) na
// pasta temporaria, com a data no nome, lida com o DiagLog ainda escrevendo. So no Windows.
#include <windows.h>

#include <optional>
#include <string>

#include "DiagLog.h"
#include "Diagnostics.h"
#include "Text.h"
#include "WinFiles.h"
#include "test_support.h"

using namespace starsonic;

TEST_CASE("send diagnostics copies the log with the older part first and the date in the name") {
    SYSTEMTIME when = {};
    when.wYear = 2026;
    when.wMonth = 10;
    when.wDay = 21;
    when.wHour = 19;
    when.wMinute = 30;
    when.wSecond = 5;
    CHECK(DiagnosticsCopyName(when) == L"Starsonic Phone diagnostico 2026-10-21 19-30-05.log");

    const std::wstring temp = TempFolder();
    REQUIRE_FALSE(temp.empty());
    CHECK(temp.back() != L'\\');
    const std::wstring folder = temp + L"\\starsonic-diag-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
                                std::to_wstring(GetTickCount64());
    REQUIRE(CreateFolderTree(folder));
    const std::wstring log = folder + L"\\diagnostico.log";

    // Sem o diagnostico.log: nada.
    CHECK_FALSE(CopyDiagnostics(log, folder, when).has_value());

    WinFiles files;
    REQUIRE(files.WriteAtomic(WideToUtf8(log + L".1"), "parte antiga\r\n"));
    {
        DiagLog diag(log);   // aberto, como no app
        diag.Write("parte nova");
        const std::optional<std::wstring> copy = CopyDiagnostics(log, folder, when);
        REQUIRE(copy.has_value());
        CHECK(*copy == folder + L"\\Starsonic Phone diagnostico 2026-10-21 19-30-05.log");
        const std::optional<std::string> text = files.Read(WideToUtf8(*copy));
        REQUIRE(text.has_value());
        const size_t old = text->find("parte antiga");
        const size_t now = text->find("parte nova");
        CHECK(old == 0);
        CHECK(now != std::string::npos);
        CHECK(now > old);
        DeleteFileW(copy->c_str());
    }
    DeleteFileW(log.c_str());
    DeleteFileW((log + L".1").c_str());
    RemoveDirectoryW(folder.c_str());
}
