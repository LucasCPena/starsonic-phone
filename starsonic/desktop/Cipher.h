#pragma once
// O cifrador da senha das contas (spec 6.6). No Windows e o DPAPI (CryptProtectData: so aquele usuario naquele PC);
// os testes usam um cifrador de brinquedo.
#include <optional>
#include <string>

namespace starsonic {

class SecretCipher {
public:
    virtual ~SecretCipher() = default;

    // Cifra o texto UTF-8; devolve o resultado em base64, ou nullopt se nao conseguiu.
    virtual std::optional<std::string> Protect(const std::string& utf8) = 0;

    // O inverso: recebe o base64 de Protect e devolve o texto UTF-8, ou nullopt se nao decifra (outro usuario,
    // outro PC, texto estragado).
    virtual std::optional<std::string> Unprotect(const std::string& base64) = 0;
};

}  // namespace starsonic
