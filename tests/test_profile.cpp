#include "test_support.h"
#include "Profile.h"
#include "Text.h"

#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace starsonic;

namespace {

const std::wstring base = L"[conta]\nporta=5060\ntransporte=udp\n";

// Recusa = ok falso e uma mensagem para mostrar a quem editou o arquivo.
bool Rejects(const std::wstring& text) {
    Profile profile;
    const ParseResult result = ParseProfile(text, &profile);
    return !result.ok && !result.errorMessage.empty();
}

bool Contains(const std::wstring& text, const std::wstring& part) {
    return text.find(part) != std::wstring::npos;
}

std::string ReadFileBytes(const std::string& path) {
    std::ifstream file(path.c_str(), std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

}  // namespace

TEST_CASE("parses geral and conta with defaults") {
    Profile profile;
    const ParseResult result = ParseProfile(
        L"[geral]\nstun=stun.exemplo.invalid:3478\ncodecs=G722,PCMA\ndtmf=rfc2833\n" + base, &profile);
    REQUIRE(result.ok);
    const AccountProfile& account = profile.account;
    CHECK(account.port == 5060);
    CHECK(account.transport == Transport::Udp);
    CHECK(account.proxy == L"");
    CHECK(account.srtp == SrtpMode::Disabled);
    CHECK(account.keepAliveSeconds == 15);
    CHECK(profile.global.stun == L"stun.exemplo.invalid:3478");
    const std::vector<std::wstring> codecs = {L"G722", L"PCMA"};
    CHECK(profile.global.codecs == codecs);
    CHECK(profile.global.dtmf == DtmfMethod::Rfc2833);
}

TEST_CASE("missing geral uses MicroSIP defaults") {
    Profile profile;
    REQUIRE(ParseProfile(base, &profile).ok);
    const std::vector<std::wstring> codecs = {L"PCMA", L"PCMU"};
    CHECK(profile.global.codecs == codecs);
    CHECK(profile.global.stun == L"");
    CHECK(profile.global.dtmf == DtmfMethod::Auto);
}

TEST_CASE("parses BOM, CRLF and comments") {
    Profile profile;
    const std::wstring text = Utf8ToWide(StripUtf8Bom(
        "\xEF\xBB\xBF; comentario\r\n[conta] ; vale para todas as contas\r\n"
        "porta=5061 ; padrao\r\ntransporte=TCP\r\n"));
    REQUIRE(ParseProfile(text, &profile).ok);
    CHECK(profile.account.port == 5061);
    CHECK(profile.account.transport == Transport::Tcp);
}

TEST_CASE("parses every optional conta key") {
    Profile profile;
    REQUIRE(ParseProfile(
        L"[conta]\nporta=5070\ntransporte=Tcp\nproxy=p.invalid:5080\nsrtp=Obrigatorio\nkeepalive=30\n",
        &profile).ok);
    CHECK(profile.account.port == 5070);
    CHECK(profile.account.transport == Transport::Tcp);
    CHECK(profile.account.proxy == L"p.invalid:5080");
    CHECK(profile.account.srtp == SrtpMode::Mandatory);
    CHECK(profile.account.keepAliveSeconds == 30);
}

TEST_CASE("srtp opcional and dtmf names map to MicroSIP values") {
    Profile profile;
    REQUIRE(ParseProfile(L"[geral]\ndtmf=INFO\n" + base + L"srtp=opcional\n", &profile).ok);
    CHECK(profile.global.dtmf == DtmfMethod::SipInfo);
    CHECK(profile.account.srtp == SrtpMode::Optional);
    REQUIRE(ParseProfile(L"[geral]\ndtmf=inband\n" + base, &profile).ok);
    CHECK(profile.global.dtmf == DtmfMethod::Inband);
    REQUIRE(ParseProfile(L"[geral]\ndtmf=auto\n" + base, &profile).ok);
    CHECK(profile.global.dtmf == DtmfMethod::Auto);
}

TEST_CASE("codecs are trimmed and normalized to the canonical spelling") {
    Profile profile;
    REQUIRE(ParseProfile(L"[geral]\ncodecs= g722 , OPUS,pcmu,Pcma,g729\n" + base, &profile).ok);
    const std::vector<std::wstring> codecs = {L"G722", L"opus", L"PCMU", L"PCMA", L"G729"};
    CHECK(profile.global.codecs == codecs);
}

TEST_CASE("ParseProfile reads ddi and prefixo_externo") {
    Profile profile;
    REQUIRE(ParseProfile(base + L"ddi=351\nprefixo_externo=0\n", &profile).ok);
    CHECK(profile.account.ddi == L"351");
    CHECK(profile.account.externalPrefix == L"0");
    REQUIRE(ParseProfile(base + L"ddi=55\nprefixo_externo=0\n", &profile).ok);
    CHECK(profile.account.ddi == L"55");
    CHECK(profile.account.externalPrefix == L"0");

    REQUIRE(ParseProfile(base, &profile).ok);   // sem as chaves: ddi do Brasil, sem prefixo
    CHECK(profile.account.ddi == L"55");
    CHECK(profile.account.externalPrefix == L"");

    REQUIRE(ParseProfile(base + L"prefixo_externo= ; sem prefixo\n", &profile).ok);
    CHECK(profile.account.externalPrefix == L"");
    REQUIRE(ParseProfile(base + L"prefixo_externo=0*#9\n", &profile).ok);
    CHECK(profile.account.externalPrefix == L"0*#9");
    REQUIRE(ParseProfile(base + L"prefixo_externo=0*\n", &profile).ok);
    CHECK(profile.account.externalPrefix == L"0*");

    const ParseResult bad = ParseProfile(base + L"ddi=abc\n", &profile);
    CHECK_FALSE(bad.ok);
    CHECK(bad.errorLine == 4);
}

TEST_CASE("ParseProfile rejects an invalid ddi or prefixo_externo with the line") {
    Profile profile;
    ParseResult result = ParseProfile(base + L"ddi=abc\n", &profile);
    CHECK_FALSE(result.ok);
    CHECK(result.errorLine == 4);
    CHECK(Contains(result.errorMessage, L"ddi"));
    CHECK(Contains(result.errorMessage, L"abc"));
    CHECK(Rejects(base + L"ddi=\n"));
    CHECK(Rejects(base + L"ddi=1234\n"));
    CHECK(Rejects(base + L"ddi=+55\n"));
    CHECK(Rejects(base + L"ddi=5 5\n"));

    result = ParseProfile(base + L"prefixo_externo=0a\n", &profile);
    CHECK_FALSE(result.ok);
    CHECK(result.errorLine == 4);
    CHECK(Contains(result.errorMessage, L"prefixo_externo"));
    CHECK(Contains(result.errorMessage, L"0a"));
    CHECK(Rejects(base + L"prefixo_externo=+0\n"));
    CHECK(Rejects(base + L"prefixo_externo=0 1\n"));
    CHECK(Rejects(L"[geral]\nddi=55\n" + base));   // ddi é chave de [conta]
}

TEST_CASE("empty optional values keep their defaults") {
    Profile profile;
    REQUIRE(ParseProfile(L"[geral]\nstun=   ; vazio\n" + base + L"proxy= ; sem proxy\n", &profile).ok);
    CHECK(profile.global.stun == L"");
    CHECK(profile.account.proxy == L"");
}

TEST_CASE("reports line of unknown key") {
    Profile profile;
    const ParseResult result = ParseProfile(L"[conta]\nporta=5060\nendereco=h\ntransporte=udp\n", &profile);
    CHECK_FALSE(result.ok);
    CHECK(result.errorLine == 3);
    CHECK(Contains(result.errorMessage, L"endereco"));
}

TEST_CASE("rejects the old server-list format") {
    Profile profile;
    const ParseResult result = ParseProfile(
        L"[geral]\ncodecs=PCMA\n[sp1]\nnome=Servidor 1\nendereco=sip1.exemplo.invalid\nporta=5060\ntransporte=udp\n",
        &profile);
    CHECK_FALSE(result.ok);
    CHECK(result.errorLine == 3);
    CHECK(Contains(result.errorMessage, L"[sp1]"));
}

TEST_CASE("rejects missing required field") {
    Profile profile;
    ParseResult result = ParseProfile(L"[conta]\ntransporte=udp\n", &profile);
    CHECK_FALSE(result.ok);
    CHECK(Contains(result.errorMessage, L"porta"));
    CHECK(Contains(result.errorMessage, L"[conta]"));
    result = ParseProfile(L"[conta]\nporta=5060\n", &profile);
    CHECK_FALSE(result.ok);
    CHECK(Contains(result.errorMessage, L"transporte"));
}

TEST_CASE("rejects invalid files") {
    CHECK(Rejects(base + base));                                   // [conta] repetida
    CHECK(Rejects(L"[geral]\n[geral]\n" + base));                 // [geral] repetida
    CHECK(Rejects(base + L"[outra]\n"));                           // secao desconhecida
    CHECK(Rejects(L"[Conta]\nporta=5060\ntransporte=udp\n"));      // nome da secao fora do padrao
    CHECK(Rejects(L"[geral]\ncodecs=PCMA\n"));                     // sem [conta]
    CHECK(Rejects(L""));
    CHECK(Rejects(L"[geral]\ncodecs=G711\n" + base));             // codec desconhecido
    CHECK(Rejects(L"[geral]\ncodecs=\n" + base));                 // lista vazia
    CHECK(Rejects(L"[geral]\ncodecs=PCMA,\n" + base));            // item vazio
    CHECK(Rejects(L"[geral]\ndtmf=tom\n" + base));                // dtmf fora das opcoes
    CHECK(Rejects(L"[geral]\nporta=5060\n" + base));              // chave de [conta] em [geral]
    CHECK(Rejects(L"[conta]\nporta=70000\ntransporte=udp\n"));
    CHECK(Rejects(L"[conta]\nporta=0\ntransporte=udp\n"));
    CHECK(Rejects(L"[conta]\nporta=50a\ntransporte=udp\n"));
    CHECK(Rejects(L"[conta]\nporta=5060\ntransporte=sctp\n"));
    CHECK(Rejects(L"[conta]\nporta=5061\ntransporte=tls\n"));         // TLS saiu na revisao 1.4
    CHECK(Rejects(base + L"keepalive=0\n"));
    CHECK(Rejects(base + L"keepalive=3601\n"));
    CHECK(Rejects(base + L"srtp=sim\n"));
    CHECK(Rejects(base + L"isso nao tem igual\n"));               // linha sem '='
    CHECK(Rejects(L"porta=5060\n" + base));                       // chave antes de qualquer secao
}

TEST_CASE("failed parse leaves output untouched") {
    Profile profile;
    REQUIRE(ParseProfile(L"[conta]\nporta=5070\ntransporte=tcp\n", &profile).ok);
    CHECK_FALSE(ParseProfile(L"[geral]\ncodecs=PCMA\n", &profile).ok);
    CHECK(profile.account.port == 5070);
    CHECK(profile.account.transport == Transport::Tcp);
}

TEST_CASE("CodecsToMicrosip maps names in order") {
    const std::vector<std::wstring> codecs = {L"opus", L"G722", L"PCMA", L"PCMU", L"G729"};
    CHECK(CodecsToMicrosip(codecs) == L"opus/48000/2 G722/16000/1 PCMA/8000/1 PCMU/8000/1 G729/8000/1");
    const std::vector<std::wstring> reversed = {L"PCMU", L"PCMA"};
    CHECK(CodecsToMicrosip(reversed) == L"PCMU/8000/1 PCMA/8000/1");
}

TEST_CASE("real branding file is valid") {
    const std::string bytes = ReadFileBytes(STARSONIC_REPO_DIR "/branding/perfil.ini");
    REQUIRE_FALSE(bytes.empty());
    Profile profile;
    const ParseResult result = ParseProfile(Utf8ToWide(StripUtf8Bom(bytes)), &profile);
    CHECK_MESSAGE(result.ok, "linha " << result.errorLine << ": " << doctest::toString(result.errorMessage));
}
