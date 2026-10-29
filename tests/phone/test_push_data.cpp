// PushDataProblem (spec 7.3): a conferência que os dois motores fazem nos dados de push antes de guardá-los ou
// de escrevê-los no REGISTER. Pura: sem motor e sem registrador.
#include "test_support.h"
#include "PushDataCheck.h"

#include <string>

using namespace starsonic;

namespace {

// Dados de push só com um parâmetro do Contact.
PushData OneParam(const std::string& name, const std::string& value) {
    PushData data;
    data.contactParams = {{name, value}};
    return data;
}

// Dados de push só com um cabeçalho.
PushData OneHeader(const std::string& name, const std::string& value) {
    PushData data;
    data.headers = {{name, value}};
    return data;
}

bool IsAsciiAlnum(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

bool OneOf(char c, const std::string& set) { return set.find(c) != std::string::npos; }

// O motivo vai para uma linha do log: uma linha só, de ASCII visível.
bool IsLogLine(const std::string& text) {
    for (char c : text) {
        if (c < 0x20 || c > 0x7e) return false;
    }
    return true;
}

}  // namespace

TEST_CASE("PushDataProblem accepts the RFC 8599 parameters and a token header") {
    PushData data;
    data.contactParams = {{"pn-provider", "apns"}, {"pn-param", "ABCDE12345.br.com.starsonic.phone.voip"},
                          {"pn-prid", "00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0"}};
    data.headers = {{"X-Push-Token", "00fc13adff78512"}};
    CHECK(PushDataProblem(data).empty());
}

TEST_CASE("PushDataProblem refuses what would break the REGISTER") {
    SUBCASE("a parameter value with ';'") { CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a;b")).empty()); }
    SUBCASE("a parameter value with '>'") { CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a>b")).empty()); }
    SUBCASE("a parameter value with a double quote") {
        CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a\"b")).empty());
    }
    SUBCASE("a parameter value with a space") { CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a b")).empty()); }
    SUBCASE("a parameter value with a '%' that lacks the two hex digits") {
        CHECK(PushDataProblem(OneParam("pn-prid", "a%4fb")).empty());   // com os dois dígitos serve
        CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a%4")).empty());
        CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "a%zzb")).empty());
        CHECK_FALSE(PushDataProblem(OneParam("pn-prid", "100%")).empty());
    }
    SUBCASE("a parameter value of 513 characters") {
        CHECK(PushDataProblem(OneParam("pn-prid", std::string(512, 'a'))).empty());   // 512 ainda serve
        CHECK_FALSE(PushDataProblem(OneParam("pn-prid", std::string(513, 'a'))).empty());
    }
    SUBCASE("each byte that is not a character of a parameter value") {
        // A RFC 3261 (paramchar): letras, dígitos e estes. O '%' fica de fora: só vale com dois dígitos depois.
        const std::string allowed = "-_.!~*'()[]/:&+$";
        for (int byte = 0; byte < 256; ++byte) {
            const char c = static_cast<char>(byte);
            INFO("byte " << byte);
            CHECK(PushDataProblem(OneParam("pn-prid", std::string("a") + c + "b")).empty() ==
                  (IsAsciiAlnum(c) || OneOf(c, allowed)));
        }
    }
    SUBCASE("the parameter transport, in any case") {
        CHECK(PushDataProblem(OneParam("transports", "udp")).empty());   // só o nome transport é do motor
        CHECK_FALSE(PushDataProblem(OneParam("transport", "udp")).empty());
        CHECK_FALSE(PushDataProblem(OneParam("Transport", "udp")).empty());
        CHECK_FALSE(PushDataProblem(OneParam("TRANSPORT", "udp")).empty());
    }
    SUBCASE("an empty parameter name") { CHECK_FALSE(PushDataProblem(OneParam("", "a")).empty()); }
    SUBCASE("a parameter name with a space") { CHECK_FALSE(PushDataProblem(OneParam("pn prid", "a")).empty()); }
    SUBCASE("a parameter name of 65 characters") {
        CHECK(PushDataProblem(OneParam(std::string(64, 'p'), "a")).empty());   // 64 ainda serve
        CHECK_FALSE(PushDataProblem(OneParam(std::string(65, 'p'), "a")).empty());
    }
    SUBCASE("each byte that is not a character of a parameter or header name") {
        // A RFC 3261 (token): letras, dígitos e estes.
        const std::string allowed = "-.!%*_+`'~";
        for (int byte = 0; byte < 256; ++byte) {
            const char c = static_cast<char>(byte);
            const bool good = IsAsciiAlnum(c) || OneOf(c, allowed);
            INFO("byte " << byte);
            CHECK(PushDataProblem(OneParam(std::string("p") + c + "q", "a")).empty() == good);
            CHECK(PushDataProblem(OneHeader(std::string("X") + c + "Y", "a")).empty() == good);
        }
    }
    SUBCASE("a header value with CR LF") {
        CHECK_FALSE(PushDataProblem(OneHeader("X-Push-Token", "abc\r\nVia: x")).empty());
    }
    SUBCASE("each byte that is not visible ASCII or a space in a header value") {
        for (int byte = 0; byte < 256; ++byte) {
            const std::string value = std::string("a") + static_cast<char>(byte) + "b";
            INFO("byte " << byte);
            CHECK(PushDataProblem(OneHeader("X-Push-Token", value)).empty() == (byte >= 0x20 && byte <= 0x7e));
        }
    }
    SUBCASE("an empty header name") { CHECK_FALSE(PushDataProblem(OneHeader("", "abc")).empty()); }
    SUBCASE("a header name with a space") { CHECK_FALSE(PushDataProblem(OneHeader("X Push", "abc")).empty()); }
    SUBCASE("an empty header value") { CHECK_FALSE(PushDataProblem(OneHeader("X-Push-Token", "")).empty()); }
    SUBCASE("a header name of 65 characters") {
        CHECK(PushDataProblem(OneHeader(std::string(64, 'X'), "abc")).empty());   // 64 ainda serve
        CHECK_FALSE(PushDataProblem(OneHeader(std::string(65, 'X'), "abc")).empty());
    }
    SUBCASE("a header value of 513 characters") {
        CHECK(PushDataProblem(OneHeader("X-Push-Token", std::string(512, 'a'))).empty());   // 512 ainda serve
        CHECK_FALSE(PushDataProblem(OneHeader("X-Push-Token", std::string(513, 'a'))).empty());
    }
    SUBCASE("the header contact") { CHECK_FALSE(PushDataProblem(OneHeader("contact", "<sip:a@b>")).empty()); }
    SUBCASE("the header User-Agent") { CHECK_FALSE(PushDataProblem(OneHeader("User-Agent", "x")).empty()); }
    SUBCASE("each header that the engine or the libre already writes, in any case") {
        const char* const names[] = {"Via", "from", "TO", "Call-ID", "cseq", "Contact", "EXPIRES", "Max-Forwards",
                                     "route", "Authorization", "User-Agent", "content-length"};
        for (const char* name : names) {
            INFO("cabecalho " << name);
            CHECK_FALSE(PushDataProblem(OneHeader(name, "x")).empty());
        }
        CHECK(PushDataProblem(OneHeader("X-Contact", "x")).empty());   // só os nomes inteiros são do motor
    }
    SUBCASE("a bad parameter or header after good ones") {
        PushData data;
        data.contactParams = {{"pn-provider", "apns"}, {"pn-prid", "abc"}};
        data.headers = {{"X-Push-Token", "abc"}};
        REQUIRE(PushDataProblem(data).empty());
        PushData badParam = data;
        badParam.contactParams.push_back({"pn-param", "a;b"});
        CHECK_FALSE(PushDataProblem(badParam).empty());
        PushData badHeader = data;
        badHeader.headers.push_back({"Via", "x"});
        CHECK_FALSE(PushDataProblem(badHeader).empty());
    }
    SUBCASE("the reason is one line of ASCII and does not repeat the value") {
        const std::string secret = "tok\xc3\xa7" "en;\r\nsegredo";
        const PushData cases[] = {OneParam("pn-prid", secret), OneHeader("X-Push-Token", secret),
                                  OneParam("pn\xc3\xa7", "a"), OneHeader("X Push", "a"), OneHeader("Via", "a"),
                                  OneParam("transport", "udp"), OneHeader("X-Push-Token", ""),
                                  OneParam("pn-prid", std::string(513, 'a'))};
        for (const PushData& data : cases) {
            const std::string problem = PushDataProblem(data);
            INFO("motivo: " << problem);
            CHECK_FALSE(problem.empty());
            CHECK(IsLogLine(problem));
            CHECK(problem.find("segredo") == std::string::npos);
        }
    }
}

TEST_CASE("PushDataProblem accepts a flag parameter without value") {
    PushData data;
    data.contactParams = {{"ob", ""}};
    CHECK(PushDataProblem(data).empty());
}
