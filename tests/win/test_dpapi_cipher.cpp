// O cifrador da senha das contas no Windows (windows/app/src/DpapiCipher.h): o DPAPI (CryptProtectData, escopo do
// usuario) com o resultado em base64 (spec 6.6). So no Windows: entra no desktop_tests do job windows.
#include <optional>
#include <string>

#include "DpapiCipher.h"
#include "test_support.h"

using starsonic::DpapiCipher;

TEST_CASE("DPAPI round trip and refusal of tampered data") {
    DpapiCipher cipher;
    // "Senha com acento: coração" em UTF-8.
    const std::string secret = "Senha com acento: cora\xc3\xa7\xc3\xa3o #2001";

    const std::optional<std::string> sealed = cipher.Protect(secret);
    REQUIRE(sealed.has_value());
    CHECK_FALSE(sealed->empty());
    // O texto nunca aparece no resultado, e o resultado e base64 (sem quebras de linha).
    CHECK(sealed->find("Senha") == std::string::npos);
    CHECK(sealed->find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") ==
          std::string::npos);

    const std::optional<std::string> opened = cipher.Unprotect(*sealed);
    REQUIRE(opened.has_value());
    CHECK(*opened == secret);

    // Um segundo cifrador (outra abertura do app, o mesmo usuario) tambem decifra.
    DpapiCipher again;
    const std::optional<std::string> reopened = again.Unprotect(*sealed);
    REQUIRE(reopened.has_value());
    CHECK(*reopened == secret);

    // Um caractere trocado no meio do base64 estraga os bytes: o DPAPI recusa.
    std::string tampered = *sealed;
    const size_t middle = tampered.size() / 2;
    tampered[middle] = tampered[middle] == 'A' ? 'B' : 'A';
    CHECK_FALSE(cipher.Unprotect(tampered).has_value());

    // Pela metade, vazio ou fora do base64: recusado.
    CHECK_FALSE(cipher.Unprotect(sealed->substr(0, sealed->size() / 2)).has_value());
    CHECK_FALSE(cipher.Unprotect("").has_value());
    CHECK_FALSE(cipher.Unprotect("isto nao e base64 !!!").has_value());
}
