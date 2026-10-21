// O "Iniciar com o Windows" do app novo (windows/app/src/Autostart.h): o valor "Starsonic Phone" na chave Run do
// HKCU com "<exe>" --bandeja. O teste usa uma chave propria (nunca a Run de verdade da maquina). So no Windows.
#include <windows.h>

#include <optional>
#include <string>

#include "Autostart.h"
#include "test_support.h"

using namespace starsonic;

TEST_CASE("start with windows writes and removes the Run value with --bandeja") {
    const std::wstring parent = L"Software\\Starsonic Phone Testes " + std::to_wstring(GetCurrentProcessId());
    const std::wstring key = parent + L"\\Run";
    const std::wstring exe = L"C:\\Users\\Jos\u00e9\\AppData\\Local\\Starsonic Phone\\StarsonicPhone.exe";

    CHECK(AutostartCommand(exe) == L"\"" + exe + L"\" --bandeja");
    CHECK_FALSE(ReadAutostart(key).has_value());
    // Desligar sem nada gravado nao e erro.
    CHECK(SetAutostart(false, exe, key));

    REQUIRE(SetAutostart(true, exe, key));
    const std::optional<std::wstring> written = ReadAutostart(key);
    REQUIRE(written.has_value());
    CHECK(*written == L"\"" + exe + L"\" --bandeja");

    REQUIRE(SetAutostart(false, exe, key));
    CHECK_FALSE(ReadAutostart(key).has_value());

    RegDeleteKeyW(HKEY_CURRENT_USER, key.c_str());
    RegDeleteKeyW(HKEY_CURRENT_USER, parent.c_str());
}
