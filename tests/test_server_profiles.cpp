#include "test_support.h"
#include "ServerProfiles.h"
#include "Text.h"

#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace starsonic;

namespace {

const std::wstring base =
    L"[sp1]\nnome=Servidor 1\nendereco=sip1.exemplo.invalid\nporta=5060\ntransporte=udp\n";

// Recusa = ok falso e uma mensagem para mostrar a quem editou o arquivo.
bool Rejects(const std::wstring& text) {
    Profiles profiles;
    const ParseResult result = ParseProfiles(text, &profiles);
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

TEST_CASE("parses geral and one server with defaults") {
    Profiles profiles;
    const ParseResult result = ParseProfiles(
        L"[geral]\nstun=stun.exemplo.invalid:3478\ncodecs=G722,PCMA\ndtmf=rfc2833\n" + base, &profiles);
    REQUIRE(result.ok);
    REQUIRE(profiles.servers.size() == 1);
    const ServerProfile& server = profiles.servers[0];
    CHECK(server.id == L"sp1");
    CHECK(server.name == L"Servidor 1");
    CHECK(server.host == L"sip1.exemplo.invalid");
    CHECK(server.domain == L"sip1.exemplo.invalid");
    CHECK(server.port == 5060);
    CHECK(server.transport == Transport::Udp);
    CHECK(server.proxy == L"");
    CHECK(server.srtp == SrtpMode::Disabled);
    CHECK(server.keepAliveSeconds == 15);
    CHECK(profiles.global.stun == L"stun.exemplo.invalid:3478");
    const std::vector<std::wstring> codecs = {L"G722", L"PCMA"};
    CHECK(profiles.global.codecs == codecs);
    CHECK(profiles.global.dtmf == DtmfMethod::Rfc2833);
}

TEST_CASE("missing geral uses MicroSIP defaults") {
    Profiles profiles;
    REQUIRE(ParseProfiles(base, &profiles).ok);
    const std::vector<std::wstring> codecs = {L"PCMA", L"PCMU"};
    CHECK(profiles.global.codecs == codecs);
    CHECK(profiles.global.stun == L"");
    CHECK(profiles.global.dtmf == DtmfMethod::Auto);
}

TEST_CASE("parses BOM, CRLF and comments") {
    Profiles profiles;
    const std::wstring text = Utf8ToWide(StripUtf8Bom(
        "\xEF\xBB\xBF; comentario\r\n[sp1] ; servidor\r\nnome=S1\r\nendereco=h\r\n"
        "porta=5061 ; padrao\r\ntransporte=TLS\r\n"));
    REQUIRE(ParseProfiles(text, &profiles).ok);
    REQUIRE(profiles.servers.size() == 1);
    CHECK(profiles.servers[0].name == L"S1");
    CHECK(profiles.servers[0].port == 5061);
    CHECK(profiles.servers[0].transport == Transport::Tls);
}

TEST_CASE("parses every optional server key") {
    Profiles profiles;
    REQUIRE(ParseProfiles(
        L"[sp-2_b]\nnome=Servidor 2\nendereco=h.invalid\ndominio=d.invalid\nporta=5070\n"
        L"transporte=Tcp\nproxy=p.invalid:5080\nsrtp=Obrigatorio\nkeepalive=30\n",
        &profiles).ok);
    REQUIRE(profiles.servers.size() == 1);
    const ServerProfile& server = profiles.servers[0];
    CHECK(server.id == L"sp-2_b");
    CHECK(server.domain == L"d.invalid");
    CHECK(server.transport == Transport::Tcp);
    CHECK(server.proxy == L"p.invalid:5080");
    CHECK(server.srtp == SrtpMode::Mandatory);
    CHECK(server.keepAliveSeconds == 30);
}

TEST_CASE("srtp opcional and dtmf names map to MicroSIP values") {
    Profiles profiles;
    REQUIRE(ParseProfiles(L"[geral]\ndtmf=INFO\n" + base + L"srtp=opcional\n", &profiles).ok);
    CHECK(profiles.global.dtmf == DtmfMethod::SipInfo);
    CHECK(profiles.servers[0].srtp == SrtpMode::Optional);
    REQUIRE(ParseProfiles(L"[geral]\ndtmf=inband\n" + base, &profiles).ok);
    CHECK(profiles.global.dtmf == DtmfMethod::Inband);
    REQUIRE(ParseProfiles(L"[geral]\ndtmf=auto\n" + base, &profiles).ok);
    CHECK(profiles.global.dtmf == DtmfMethod::Auto);
}

TEST_CASE("codecs are trimmed and normalized to the canonical spelling") {
    Profiles profiles;
    REQUIRE(ParseProfiles(L"[geral]\ncodecs= g722 , OPUS,pcmu,Pcma,g729\n" + base, &profiles).ok);
    const std::vector<std::wstring> codecs = {L"G722", L"opus", L"PCMU", L"PCMA", L"G729"};
    CHECK(profiles.global.codecs == codecs);
}

TEST_CASE("empty optional values keep their defaults") {
    Profiles profiles;
    REQUIRE(ParseProfiles(L"[geral]\nstun=   ; vazio\n" + base + L"dominio=\nproxy= ; sem proxy\n", &profiles).ok);
    CHECK(profiles.global.stun == L"");
    CHECK(profiles.servers[0].domain == L"sip1.exemplo.invalid");
    CHECK(profiles.servers[0].proxy == L"");
}

TEST_CASE("servers keep file order") {
    Profiles profiles;
    REQUIRE(ParseProfiles(
        base + L"[rj]\nnome=Rio\nendereco=rj.invalid\nporta=5060\ntransporte=udp\n", &profiles).ok);
    REQUIRE(profiles.servers.size() == 2);
    CHECK(profiles.servers[0].id == L"sp1");
    CHECK(profiles.servers[1].id == L"rj");
}

TEST_CASE("reports line of unknown key") {
    Profiles profiles;
    const ParseResult result =
        ParseProfiles(L"[sp1]\nnome=a\nendreco=h\nporta=5060\ntransporte=udp\n", &profiles);
    CHECK_FALSE(result.ok);
    CHECK(result.errorLine == 3);
    CHECK(Contains(result.errorMessage, L"endreco"));
}

TEST_CASE("rejects missing required field") {
    Profiles profiles;
    const ParseResult result = ParseProfiles(
        L"[sp1]\nnome=Servidor 1\nendereco=sip1.exemplo.invalid\ntransporte=udp\n", &profiles);
    CHECK_FALSE(result.ok);
    CHECK(Contains(result.errorMessage, L"porta"));
}

TEST_CASE("rejects invalid files") {
    const std::wstring rest = L"\nnome=a\nendereco=h\nporta=5060\ntransporte=udp\n";
    CHECK(Rejects(base + base));                                   // id repetido
    CHECK(Rejects(L"[Sp 1]" + rest));                              // id fora do padrao
    CHECK(Rejects(L"[geral]\ncodecs=G711\n" + base));             // codec desconhecido
    CHECK(Rejects(L"[geral]\ncodecs=\n" + base));                 // lista vazia
    CHECK(Rejects(L"[geral]\ncodecs=PCMA,\n" + base));            // item vazio
    CHECK(Rejects(L"[geral]\ndtmf=tom\n" + base));                // dtmf fora das opcoes
    CHECK(Rejects(L"[geral]\nnome=a\n" + base));                  // chave de servidor em [geral]
    CHECK(Rejects(L"[geral]\n[geral]\n" + base));                 // [geral] repetida
    CHECK(Rejects(L"[sp1]\nnome=a\nendereco=h\nporta=70000\ntransporte=udp\n"));
    CHECK(Rejects(L"[sp1]\nnome=a\nendereco=h\nporta=0\ntransporte=udp\n"));
    CHECK(Rejects(L"[sp1]\nnome=a\nendereco=h\nporta=50a\ntransporte=udp\n"));
    CHECK(Rejects(L"[sp1]\nnome=a\nendereco=h\nporta=5060\ntransporte=sctp\n"));
    CHECK(Rejects(L"[sp1]\nnome=\nendereco=h\nporta=5060\ntransporte=udp\n"));
    CHECK(Rejects(base + L"keepalive=0\n"));
    CHECK(Rejects(base + L"keepalive=3601\n"));
    CHECK(Rejects(base + L"srtp=sim\n"));
    CHECK(Rejects(base + L"isso nao tem igual\n"));               // linha sem '='
    CHECK(Rejects(L"nome=a\n" + base));                           // chave antes de qualquer secao
    CHECK(Rejects(L"[geral]\ncodecs=PCMA\n"));                     // nenhum servidor
    CHECK(Rejects(L""));
}

TEST_CASE("failed parse leaves output untouched") {
    Profiles profiles;
    REQUIRE(ParseProfiles(base, &profiles).ok);
    CHECK_FALSE(ParseProfiles(L"[geral]\ncodecs=PCMA\n", &profiles).ok);
    REQUIRE(profiles.servers.size() == 1);
    CHECK(profiles.servers[0].id == L"sp1");
}

TEST_CASE("FindServer returns null for unknown id") {
    Profiles profiles;
    REQUIRE(ParseProfiles(base, &profiles).ok);
    CHECK(FindServer(profiles, L"sp2") == nullptr);
    const ServerProfile* found = FindServer(profiles, L"sp1");
    REQUIRE(found != nullptr);
    CHECK(found->name == L"Servidor 1");
}

TEST_CASE("CodecsToMicrosip maps names in order") {
    const std::vector<std::wstring> codecs = {L"opus", L"G722", L"PCMA", L"PCMU", L"G729"};
    CHECK(CodecsToMicrosip(codecs) == L"opus/48000/2 G722/16000/1 PCMA/8000/1 PCMU/8000/1 G729/8000/1");
    const std::vector<std::wstring> reversed = {L"PCMU", L"PCMA"};
    CHECK(CodecsToMicrosip(reversed) == L"PCMU/8000/1 PCMA/8000/1");
}

TEST_CASE("real branding file is valid") {
    const std::string bytes = ReadFileBytes(STARSONIC_REPO_DIR "/branding/servidores.ini");
    REQUIRE_FALSE(bytes.empty());
    Profiles profiles;
    const ParseResult result = ParseProfiles(Utf8ToWide(StripUtf8Bom(bytes)), &profiles);
    CHECK_MESSAGE(result.ok, "linha " << result.errorLine << ": " << doctest::toString(result.errorMessage));
    CHECK(profiles.servers.size() >= 1);
}

TEST_CASE("CI fixture profile is valid") {
    const std::string bytes = ReadFileBytes(STARSONIC_REPO_DIR "/tests/fixtures/servidores-ci.ini");
    Profiles profiles;
    REQUIRE(ParseProfiles(Utf8ToWide(StripUtf8Bom(bytes)), &profiles).ok);
    REQUIRE(profiles.servers.size() == 2);
    CHECK(profiles.servers[0].id == L"local");
    CHECK(profiles.servers[0].host == L"127.0.0.1");
    // Servidor TLS em que o registrador falso responde texto puro (falha de TLS no Test-Login).
    CHECK(profiles.servers[1].id == L"tls");
    CHECK(profiles.servers[1].transport == Transport::Tls);
    CHECK(profiles.servers[1].port == 5071);
    CHECK(profiles.global.dtmf == DtmfMethod::Rfc2833);
}
