#pragma once
// O cifrador da senha das contas no Windows (spec 6.6): o DPAPI (CryptProtectData), no escopo do usuario (so aquele
// usuario naquele PC decifra), sem nenhuma janela do Windows. O resultado vai em base64 (sem quebras de linha) para o
// contas.json.
#include <optional>
#include <string>

#include "Cipher.h"

namespace starsonic {

class DpapiCipher : public SecretCipher {
public:
    std::optional<std::string> Protect(const std::string& utf8) override;
    std::optional<std::string> Unprotect(const std::string& base64) override;
};

}  // namespace starsonic
