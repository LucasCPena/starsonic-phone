// Os links tel:, sip: e callto: do app novo (windows/app/src/Links.h): o argumento que o Windows passa ao
// StarsonicPhone.exe vira o numero do Teclado (spec da W1, 7.4). Entra no desktop_tests do job windows.
#include <optional>
#include <string>

#include "Links.h"
#include "test_support.h"

using starsonic::ParseLinkArgument;

namespace {

std::string Number(const std::wstring& argument) {
    const std::optional<std::string> number = ParseLinkArgument(argument);
    return number ? *number : std::string("(nada)");
}

}  // namespace

TEST_CASE("ParseLinkArgument maps tel, sip and callto to a number") {
    CHECK(Number(L"tel:+55 11 5060-3000") == "+551150603000");
    CHECK(Number(L"sip:2003@starcloud1-starsonic.com.br") == "2003");
    CHECK(Number(L"callto:2003") == "2003");

    // O esquema sem diferenciar maiusculas, as barras do callto:// e o que o navegador codifica.
    CHECK(Number(L"TEL:2003") == "2003");
    CHECK(Number(L"Sip:2003@starcloud1-starsonic.com.br") == "2003");
    CHECK(Number(L"callto://2003") == "2003");
    CHECK(Number(L"tel:+55%2011%205060-3000") == "+551150603000");
    CHECK(Number(L"tel:%2B551150603000") == "+551150603000");
    CHECK(Number(L"tel:(11) 5060.3000") == "1150603000");
    // Os parametros e os campos ficam de fora.
    CHECK(Number(L"tel:2003;phone-context=starsonic.com.br") == "2003");
    CHECK(Number(L"sip:2003@starcloud1-starsonic.com.br:5060;transport=udp") == "2003");
    CHECK(Number(L"sip:2003") == "2003");
    CHECK(Number(L"callto:2003?origem=site") == "2003");
    CHECK(Number(L"tel:*21#") == "*21#");
    CHECK(Number(L"  tel:2003  ") == "2003");

    // O resto: nada.
    CHECK(Number(L"") == "(nada)");
    CHECK(Number(L"2003") == "(nada)");
    CHECK(Number(L"tel:") == "(nada)");
    CHECK(Number(L"tel:+") == "(nada)");
    CHECK(Number(L"tel:abc") == "(nada)");
    CHECK(Number(L"tel:20+03") == "(nada)");
    CHECK(Number(L"sip:joao@starcloud1-starsonic.com.br") == "(nada)");
    CHECK(Number(L"sip:@starcloud1-starsonic.com.br") == "(nada)");
    CHECK(Number(L"sips:2003@starcloud1-starsonic.com.br") == "(nada)");
    CHECK(Number(L"mailto:2003@starsonic.com.br") == "(nada)");
    CHECK(Number(L"https://starsonic.com.br/") == "(nada)");
    CHECK(Number(L"--bandeja") == "(nada)");
    CHECK(Number(L"telefone:2003") == "(nada)");
    CHECK(Number(L"tel:2003%") == "(nada)");
    CHECK(Number(L"tel:2003%zz") == "(nada)");
}
