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
    const std::wstring approved = parent + L"\\StartupApproved\\Run";   // nunca o de verdade
    const std::wstring exe = L"C:\\Users\\Jos\u00e9\\AppData\\Local\\Starsonic Phone\\StarsonicPhone.exe";

    CHECK(AutostartCommand(exe) == L"\"" + exe + L"\" --bandeja");
    CHECK_FALSE(ReadAutostart(key).has_value());
    // Desligar sem nada gravado nao e erro.
    CHECK(SetAutostart(false, exe, key, approved));

    REQUIRE(SetAutostart(true, exe, key, approved));
    const std::optional<std::wstring> written = ReadAutostart(key);
    REQUIRE(written.has_value());
    CHECK(*written == L"\"" + exe + L"\" --bandeja");

    REQUIRE(SetAutostart(false, exe, key, approved));
    CHECK_FALSE(ReadAutostart(key).has_value());

    RegDeleteTreeW(HKEY_CURRENT_USER, parent.c_str());
}

TEST_CASE("start with windows reads the Run value and the Task Manager switch in StartupApproved") {
    const std::wstring parent = L"Software\\Starsonic Phone Testes Aprovado " + std::to_wstring(GetCurrentProcessId());
    const std::wstring run = parent + L"\\Run";
    const std::wstring approved = parent + L"\\StartupApproved\\Run";
    const std::wstring exe = L"C:\\Starsonic Phone\\StarsonicPhone.exe";

    // Sem o valor no Run: desligado.
    CHECK_FALSE(ObserveAutostart(run, approved));

    // Com o valor e sem entrada no StartupApproved: ligado.
    REQUIRE(SetAutostart(true, exe, run, approved));
    CHECK(ObserveAutostart(run, approved));

    // Desligado no Gerenciador de Tarefas (o primeiro byte 0x03): desligado, mesmo com o valor no Run.
    HKEY key = nullptr;
    REQUIRE(RegCreateKeyExW(HKEY_CURRENT_USER, approved.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr) ==
            ERROR_SUCCESS);
    const BYTE disabled[12] = {0x03, 0, 0, 0, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x01};
    REQUIRE(RegSetValueExW(key, kAutostartValue, 0, REG_BINARY, disabled, sizeof(disabled)) == ERROR_SUCCESS);
    CHECK(ReadAutostart(run).has_value());
    CHECK_FALSE(ObserveAutostart(run, approved));

    // Ligado de novo no Gerenciador de Tarefas (0x02): ligado.
    const BYTE enabled[12] = {0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    REQUIRE(RegSetValueExW(key, kAutostartValue, 0, REG_BINARY, enabled, sizeof(enabled)) == ERROR_SUCCESS);
    CHECK(ObserveAutostart(run, approved));

    // A pessoa liga no app com o Gerenciador de Tarefas desligado: a entrada do StartupApproved sai (senao o Windows
    // continuaria sem abrir o app).
    REQUIRE(RegSetValueExW(key, kAutostartValue, 0, REG_BINARY, disabled, sizeof(disabled)) == ERROR_SUCCESS);
    RegCloseKey(key);
    REQUIRE(SetAutostart(true, exe, run, approved));
    CHECK(ObserveAutostart(run, approved));
    CHECK(*ReadAutostart(run) == L"\"" + exe + L"\" --bandeja");

    REQUIRE(SetAutostart(false, exe, run, approved));
    CHECK_FALSE(ObserveAutostart(run, approved));

    RegDeleteTreeW(HKEY_CURRENT_USER, parent.c_str());
}
