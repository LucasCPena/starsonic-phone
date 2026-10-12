#include "test_support.h"
#include "AccountPolicy.h"

#include <string>

using namespace starsonic;

namespace {

ServerProfile TestServer() {
    ServerProfile server;
    server.id = L"sp1";
    server.name = L"Servidor 1";
    server.host = L"h";
    server.domain = L"h";
    server.port = 5080;
    server.transport = Transport::Tls;
    server.proxy = L"";
    server.srtp = SrtpMode::Optional;
    server.keepAliveSeconds = 30;
    return server;
}

Profiles TestProfiles() {
    Profiles profiles;
    profiles.servers.push_back(TestServer());
    return profiles;
}

void CheckSameAccount(const AccountFields& actual, const AccountFields& expected) {
    CHECK(actual.serverId == expected.serverId);
    CHECK(actual.label == expected.label);
    CHECK(actual.server == expected.server);
    CHECK(actual.proxy == expected.proxy);
    CHECK(actual.domain == expected.domain);
    CHECK(actual.username == expected.username);
    CHECK(actual.authId == expected.authId);
    CHECK(actual.password == expected.password);
    CHECK(actual.displayName == expected.displayName);
    CHECK(actual.transport == expected.transport);
    CHECK(actual.srtp == expected.srtp);
    CHECK(actual.publicAddr == expected.publicAddr);
    CHECK(actual.dialingPrefix == expected.dialingPrefix);
    CHECK(actual.dialPlan == expected.dialPlan);
    CHECK(actual.hideCid == expected.hideCid);
    CHECK(actual.voicemailNumber == expected.voicemailNumber);
    CHECK(actual.registerRefresh == expected.registerRefresh);
    CHECK(actual.keepAlive == expected.keepAlive);
    CHECK(actual.publish == expected.publish);
    CHECK(actual.ice == expected.ice);
    CHECK(actual.allowRewrite == expected.allowRewrite);
    CHECK(actual.disableSessionTimer == expected.disableSessionTimer);
}

}  // namespace

TEST_CASE("ValidateRamal trims and accepts plain extensions") {
    std::wstring normalized;
    CHECK(ValidateRamal(L" 2001 ", &normalized) == RamalCheck::Ok);
    CHECK(normalized == L"2001");
    CHECK(ValidateRamal(L"1001-cliente", &normalized) == RamalCheck::Ok);
    CHECK(normalized == L"1001-cliente");
}

TEST_CASE("ValidateRamal reports empty input") {
    std::wstring normalized;
    CHECK(ValidateRamal(L"", &normalized) == RamalCheck::Empty);
    CHECK(ValidateRamal(L"   ", &normalized) == RamalCheck::Empty);
    CHECK(ValidateRamal(L"\t", &normalized) == RamalCheck::Empty);
}

TEST_CASE("ValidateRamal rejects addresses, inner blanks and control characters") {
    std::wstring normalized;
    CHECK(ValidateRamal(L"2001@sip.x", &normalized) == RamalCheck::Invalid);
    CHECK(ValidateRamal(L"20 01", &normalized) == RamalCheck::Invalid);
    CHECK(ValidateRamal(L"sip:2001", &normalized) == RamalCheck::Invalid);
    CHECK(ValidateRamal(L"20\t01", &normalized) == RamalCheck::Invalid);
    CHECK(ValidateRamal(L"2001\n", &normalized) == RamalCheck::Invalid);
    CHECK(ValidateRamal(std::wstring(L"20") + wchar_t(0x7F) + L"01", &normalized) == RamalCheck::Invalid);
}

TEST_CASE("BuildAccount fills locked fields from profile") {
    const AccountFields account = BuildAccount(TestServer(), L"2001", L"x");
    CHECK(account.serverId == L"sp1");
    CHECK(account.label == L"2001 \u00b7 Servidor 1");
    CHECK(account.server == L"h:5080");
    CHECK(account.proxy == L"");
    CHECK(account.domain == L"h");
    CHECK(account.username == L"2001");
    CHECK(account.authId == L"");
    CHECK(account.password == L"x");
    CHECK(account.displayName == L"2001");
    CHECK(account.transport == L"tls");
    CHECK(account.srtp == L"optional");
    CHECK(account.keepAlive == 30);
    CHECK(account.registerRefresh == 300);
    CHECK(account.publicAddr == L"");
    CHECK(account.dialingPrefix == L"");
    CHECK(account.dialPlan == L"");
    CHECK(account.hideCid == L"");
    CHECK(account.voicemailNumber == L"");
    CHECK_FALSE(account.publish);
    CHECK_FALSE(account.ice);
    CHECK_FALSE(account.allowRewrite);
    CHECK_FALSE(account.disableSessionTimer);
}

TEST_CASE("BuildAccount maps every transport, srtp mode and the proxy") {
    ServerProfile server = TestServer();
    server.transport = Transport::Udp;
    server.srtp = SrtpMode::Disabled;
    server.proxy = L"p.invalid:5070";
    AccountFields account = BuildAccount(server, L"1", L"p");
    CHECK(account.transport == L"udp");
    CHECK(account.srtp == L"");
    CHECK(account.proxy == L"p.invalid:5070");
    server.transport = Transport::Tcp;
    server.srtp = SrtpMode::Mandatory;
    account = BuildAccount(server, L"1", L"p");
    CHECK(account.transport == L"tcp");
    CHECK(account.srtp == L"mandatory");
}

TEST_CASE("EnforceAccount restores tampered fields") {
    AccountFields account = BuildAccount(TestServer(), L"2001", L"x");
    const AccountFields expected = account;
    account.label = L"outro";
    account.server = L"evil:1";
    account.proxy = L"evil-proxy:1";
    account.domain = L"evil";
    account.transport = L"udp";
    account.srtp = L"";
    account.publicAddr = L"1.2.3.4";
    account.dialingPrefix = L"0";
    account.dialPlan = L"x";
    account.hideCid = L"hard";
    account.voicemailNumber = L"*97";
    account.registerRefresh = 60;
    account.keepAlive = 5;
    account.publish = true;
    account.ice = true;
    account.allowRewrite = true;
    account.disableSessionTimer = true;
    CHECK(EnforceAccount(&account, TestProfiles()));
    CheckSameAccount(account, expected);
}

TEST_CASE("EnforceAccount keeps the fields the user owns") {
    AccountFields account = BuildAccount(TestServer(), L"2001", L"x");
    account.username = L"2002";
    account.authId = L"auth-2002";
    account.password = L"y";
    account.displayName = L"Recep\u00e7\u00e3o";
    CHECK(EnforceAccount(&account, TestProfiles()));
    CHECK(account.username == L"2002");
    CHECK(account.authId == L"auth-2002");
    CHECK(account.password == L"y");
    CHECK(account.displayName == L"Recep\u00e7\u00e3o");
    CHECK(account.label == L"2002 \u00b7 Servidor 1");
}

TEST_CASE("EnforceAccount relabels after profile rename") {
    AccountFields account = BuildAccount(TestServer(), L"2001", L"x");
    Profiles profiles = TestProfiles();
    profiles.servers[0].name = L"Novo";
    CHECK(EnforceAccount(&account, profiles));
    CHECK(account.label == L"2001 \u00b7 Novo");
}

TEST_CASE("account without server id is unknown and cleared") {
    const std::wstring ids[] = {L"", L"sumiu"};
    for (const std::wstring& id : ids) {
        CAPTURE(id);
        AccountFields account = BuildAccount(TestServer(), L"2001", L"x");
        account.serverId = id;
        account.proxy = L"p.invalid";
        CHECK_FALSE(EnforceAccount(&account, TestProfiles()));
        CHECK(account.username == L"");
        CHECK(account.password == L"");
        CHECK(account.server == L"");
        CHECK(account.domain == L"");
        CHECK(account.proxy == L"");
        CHECK(account.serverId == id);
    }
}

TEST_CASE("EnforceGlobal writes locked globals") {
    GlobalProfile profile;
    profile.codecs = {L"G722", L"PCMA"};
    profile.stun = L"stun.x:3478";
    profile.dtmf = DtmfMethod::Rfc2833;
    GlobalFields globals;
    globals.audioCodecs = L"opus/48000/2";
    globals.dtmfMethod = 0;
    globals.sourcePort = 5070;
    globals.rtpPortMin = 10000;
    globals.rtpPortMax = 20000;
    globals.rport = false;
    globals.updatesInterval = L"never";
    EnforceGlobal(&globals, profile);
    CHECK(globals.audioCodecs == L"G722/16000/1 PCMA/8000/1");
    CHECK(globals.stun == L"stun.x:3478");
    CHECK(globals.enableStun);
    CHECK(globals.dtmfMethod == 2);
    CHECK(globals.sourcePort == 0);
    CHECK(globals.rtpPortMin == 0);
    CHECK(globals.rtpPortMax == 0);
    CHECK(globals.rport);
    CHECK(globals.updatesInterval == L"daily");
}

TEST_CASE("EnforceGlobal disables STUN when the profile has none") {
    GlobalProfile profile;
    GlobalFields globals;
    globals.stun = L"old.invalid:3478";
    globals.enableStun = true;
    EnforceGlobal(&globals, profile);
    CHECK(globals.stun == L"");
    CHECK_FALSE(globals.enableStun);
}

TEST_CASE("AccountSectionNumbers lists every [Account<n>] the MicroSIP would load") {
    const std::vector<std::wstring> names = {
        L"Global", L"Settings", L"Account1", L"account3", L"ACCOUNT10", L"Account0", L"Account01",
        L"Account2x", L"Account", L"Account-1", L"Account 5", L"Account1234567890", L"Account4"};
    const std::vector<int> expected = {1, 3, 4, 10};
    CHECK(AccountSectionNumbers(names) == expected);
}

TEST_CASE("AccountSectionNumbers sorts and drops repeated sections") {
    const std::vector<std::wstring> names = {L"Account7", L"account2", L"ACCOUNT2", L"Account7"};
    const std::vector<int> expected = {2, 7};
    CHECK(AccountSectionNumbers(names) == expected);
    CHECK(AccountSectionNumbers(std::vector<std::wstring>()).empty());
}

TEST_CASE("ShouldEnforceAtStartup skips the command lines where settings are not loaded") {
    CHECK_FALSE(ShouldEnforceAtStartup(L"/reset"));
    CHECK_FALSE(ShouldEnforceAtStartup(L"/resetnoask"));
    CHECK_FALSE(ShouldEnforceAtStartup(L"/exit"));
    CHECK(ShouldEnforceAtStartup(L""));
    CHECK(ShouldEnforceAtStartup(L"/minimized"));
    CHECK(ShouldEnforceAtStartup(L"sip:2001"));
    // O MicroSIP compara a linha inteira, ao pe da letra.
    CHECK(ShouldEnforceAtStartup(L"/reset "));
    CHECK(ShouldEnforceAtStartup(L"/RESET"));
}
