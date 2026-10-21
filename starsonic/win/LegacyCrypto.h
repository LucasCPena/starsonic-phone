#pragma once
// A senha que a rc.7 (o MicroSIP 3.22 com a marca Starsonic) gravou no StarsonicPhone.ini: o IniDecrypt do MicroSIP
// sobre a CryptoAPI pura, sem MFC (spec 7.1). So no Windows.
#include <optional>
#include <string>

namespace starsonic {

// O password do .ini (hexadecimal, do IniEncrypt) -> a senha; nullopt se nao decifra (como o IniDecrypt devolvendo
// false). Texto vazio: senha vazia.
std::optional<std::wstring> LegacyDecrypt(const std::wstring& encrypted);

}  // namespace starsonic
