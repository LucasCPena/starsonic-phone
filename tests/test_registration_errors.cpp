#include "test_support.h"
#include "RegistrationErrors.h"

using namespace starsonic;

namespace {
const std::wstring kWrongPassword = L"Ramal ou senha incorretos.";
const std::wstring kNotFound = L"Ramal n\u00e3o encontrado neste servidor.";
const std::wstring kNoServer = L"N\u00e3o foi poss\u00edvel falar com o servidor. Confira o endere\u00e7o e a sua internet.";
const std::wstring kTls = L"N\u00e3o foi poss\u00edvel estabelecer uma conex\u00e3o segura com o servidor.";
}  // namespace

TEST_CASE("success and provisional codes have no message") {
    CHECK(RegistrationMessage(200, false) == L"");
    CHECK(RegistrationMessage(100, false) == L"");
    CHECK(RegistrationMessage(180, false) == L"");
    CHECK(RegistrationMessage(299, false) == L"");
}

TEST_CASE("authentication failures ask to check ramal and senha") {
    CHECK(RegistrationMessage(401, false) == kWrongPassword);
    CHECK(RegistrationMessage(403, false) == kWrongPassword);
    CHECK(RegistrationMessage(407, false) == kWrongPassword);
}

TEST_CASE("404 says the ramal does not exist on this server") {
    CHECK(RegistrationMessage(404, false) == kNotFound);
}

TEST_CASE("no answer, timeout and server errors point to the connection") {
    CHECK(RegistrationMessage(0, false) == kNoServer);
    CHECK(RegistrationMessage(-1, false) == kNoServer);
    CHECK(RegistrationMessage(408, false) == kNoServer);
    CHECK(RegistrationMessage(500, false) == kNoServer);
    CHECK(RegistrationMessage(503, false) == kNoServer);
    CHECK(RegistrationMessage(599, false) == kNoServer);
}

TEST_CASE("other codes show the code and point to support") {
    CHECK(RegistrationMessage(480, false) == L"N\u00e3o foi poss\u00edvel entrar (c\u00f3digo 480). Fale com o suporte da Starsonic.");
    CHECK(RegistrationMessage(302, false) == L"N\u00e3o foi poss\u00edvel entrar (c\u00f3digo 302). Fale com o suporte da Starsonic.");
    CHECK(RegistrationMessage(603, false) == L"N\u00e3o foi poss\u00edvel entrar (c\u00f3digo 603). Fale com o suporte da Starsonic.");
}

TEST_CASE("TLS failure wins over the SIP code") {
    CHECK(RegistrationMessage(503, true) == kTls);
    CHECK(RegistrationMessage(200, true) == kTls);
}
