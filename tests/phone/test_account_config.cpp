#include "test_support.h"
#include "AccountConfig.h"
#include "AccountPolicy.h"
#include "Profile.h"

#include <string>
#include <vector>

using namespace starsonic;

namespace {

// O perfil de branding/perfil.ini no que importa para a conta: porta 5060, SRTP opcional, keep-alive 15.
AccountProfile TestProfile() {
    AccountProfile profile;
    profile.port = 5060;
    profile.transport = Transport::Udp;
    profile.srtp = SrtpMode::Optional;
    profile.keepAliveSeconds = 15;
    return profile;
}

PjAccountSettings Settings(const AccountProfile& profile, Transport transport = Transport::Tcp,
                           const std::wstring& password = L"senha") {
    return ToPjAccount(BuildAccount(profile, L"h.example", L"2001", password, transport, L""));
}

}  // namespace

TEST_CASE("ToPjAccount maps the account built from the profile") {
    const PjAccountSettings pj = Settings(TestProfile());
    CHECK(pj.idUri == "sip:2001@h.example");
    CHECK(pj.registrarUri == "sip:h.example:5060;transport=tcp");
    CHECK(pj.proxyUri == "");
    CHECK(pj.authUser == "2001");
    CHECK(pj.authPassword == "senha");
    CHECK(pj.transport == "tcp");
    CHECK(pj.srtpUse == 1);
    CHECK(pj.udpKeepAliveSec == 15);
    CHECK(pj.regTimeoutSec == 300);
}

TEST_CASE("ToPjAccount follows the transport of the account") {
    const PjAccountSettings pj = Settings(TestProfile(), Transport::Udp);
    CHECK(pj.registrarUri == "sip:h.example:5060;transport=udp");
    CHECK(pj.transport == "udp");
}

TEST_CASE("ToPjAccount adds the profile proxy with the transport") {
    AccountProfile profile = TestProfile();
    profile.proxy = L"proxy.example:5070";
    const PjAccountSettings pj = Settings(profile, Transport::Udp);
    CHECK(pj.proxyUri == "sip:proxy.example:5070;lr;transport=udp");
}

TEST_CASE("ToPjAccount keeps UTF-8 credentials") {
    const PjAccountSettings pj = Settings(TestProfile(), Transport::Tcp, L"Senha#\u00e7");
    CHECK(pj.authPassword == "Senha#\xc3\xa7");
}

TEST_CASE("ToPjAccount maps the SRTP mode to the pjsua value") {
    AccountProfile profile = TestProfile();
    profile.srtp = SrtpMode::Disabled;
    CHECK(Settings(profile).srtpUse == 0);
    profile.srtp = SrtpMode::Optional;
    CHECK(Settings(profile).srtpUse == 1);
    profile.srtp = SrtpMode::Mandatory;
    CHECK(Settings(profile).srtpUse == 2);
}

TEST_CASE("ToPjAccount takes the keep-alive and the refresh from the account") {
    AccountProfile profile = TestProfile();
    profile.keepAliveSeconds = 40;
    AccountFields account = BuildAccount(profile, L"h.example", L"2001", L"senha", Transport::Udp, L"");
    account.registerRefresh = 120;
    const PjAccountSettings pj = ToPjAccount(account);
    CHECK(pj.udpKeepAliveSec == 40);
    CHECK(pj.regTimeoutSec == 120);
}

TEST_CASE("ToPjAccount authenticates with the auth id when there is one") {
    AccountFields account = BuildAccount(TestProfile(), L"h.example", L"2001", L"senha", Transport::Udp, L"");
    account.authId = L"auth2001";
    const PjAccountSettings pj = ToPjAccount(account);
    CHECK(pj.idUri == "sip:2001@h.example");
    CHECK(pj.authUser == "auth2001");
}

TEST_CASE("CodecIds follows the profile order") {
    const std::vector<std::string> first = {"G722/16000/1", "PCMA/8000/1", "PCMU/8000/1"};
    CHECK(CodecIds({L"G722", L"PCMA", L"PCMU"}) == first);
    const std::vector<std::string> second = {"opus/48000/2", "G729/8000/1"};
    CHECK(CodecIds({L"opus", L"G729"}) == second);
}

TEST_CASE("CodecIds skips names that are not in the table") {
    const std::vector<std::string> expected = {"PCMU/8000/1"};
    CHECK(CodecIds({L"speex", L"PCMU"}) == expected);
    CHECK(CodecIds({}).empty());
}
