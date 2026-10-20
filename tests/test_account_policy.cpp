#include "test_support.h"
#include "AccountPolicy.h"

#include <string>

using namespace starsonic;

namespace {

AccountProfile TestProfile() {
    AccountProfile profile;
    profile.port = 5080;
    profile.transport = Transport::Tcp;
    profile.proxy = L"";
    profile.srtp = SrtpMode::Optional;
    profile.keepAliveSeconds = 30;
    return profile;
}

void CheckSameAccount(const AccountFields& actual, const AccountFields& expected) {
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

TEST_CASE("ValidateServerAddress accepts host names and IPv4") {
    const std::wstring valid[] = {L"starcloud1-starsonic.com.br", L"200.100.50.10", L"localhost", L"a", L"x-1.b2"};
    for (const std::wstring& address : valid) {
        CAPTURE(address);
        std::wstring normalized;
        CHECK(ValidateServerAddress(address, &normalized) == ServerCheck::Ok);
        CHECK(normalized == address);
    }
}

TEST_CASE("ValidateServerAddress trims and lowercases") {
    std::wstring normalized;
    CHECK(ValidateServerAddress(L" Starcloud-Starsonic.COM.br\t", &normalized) == ServerCheck::Ok);
    CHECK(normalized == L"starcloud-starsonic.com.br");
}

TEST_CASE("ValidateServerAddress reports empty input") {
    std::wstring normalized = L"antes";
    CHECK(ValidateServerAddress(L"", &normalized) == ServerCheck::Empty);
    CHECK(ValidateServerAddress(L"   ", &normalized) == ServerCheck::Empty);
    CHECK(ValidateServerAddress(L"\t", &normalized) == ServerCheck::Empty);
    CHECK(normalized == L"antes");
}

TEST_CASE("ValidateServerAddress rejects ports, users, schemes and other characters") {
    const std::wstring invalid[] = {L"host:5060",      L"2001@host",      L"sip:host",         L"http://host",
                                    L"host/x",         L"star cloud.com", L"star_cloud.com",   L"stars\u00f4nic.com.br",
                                    L"[::1]",          L"fe80::1"};
    for (const std::wstring& address : invalid) {
        CAPTURE(address);
        std::wstring normalized = L"antes";
        CHECK(ValidateServerAddress(address, &normalized) == ServerCheck::Invalid);
        CHECK(normalized == L"antes");
    }
}

TEST_CASE("ValidateServerAddress rejects malformed labels and lengths") {
    const std::wstring a63(63, L'a');
    // 3 partes de 63 + 1 parte de 61 + 3 pontos = 253 caracteres (o maximo).
    const std::wstring longest = a63 + L"." + a63 + L"." + a63 + L"." + std::wstring(61, L'a');
    const std::wstring malformed[] = {L"-host.com", L"host-.com", L"host..com", L".host.com", L"host.com.",
                                      std::wstring(64, L'a') + L".com", longest + L"a"};
    for (const std::wstring& address : malformed) {
        CAPTURE(address);
        CHECK(ValidateServerAddress(address, nullptr) == ServerCheck::Invalid);
    }
    std::wstring normalized;
    CHECK(ValidateServerAddress(a63 + L".com", &normalized) == ServerCheck::Ok);
    REQUIRE(longest.size() == 253);
    CHECK(ValidateServerAddress(longest, &normalized) == ServerCheck::Ok);
    CHECK(normalized == longest);
}

TEST_CASE("ServerCheckMessage gives the Entrar text of each result") {
    CHECK(ServerCheckMessage(ServerCheck::Ok).empty());
    CHECK(ServerCheckMessage(ServerCheck::Empty) == L"Digite o endere\u00e7o do servidor.");
    CHECK(ServerCheckMessage(ServerCheck::Invalid) ==
          L"Digite s\u00f3 o endere\u00e7o do servidor, como starcloud1-starsonic.com.br.");
}

TEST_CASE("RamalCheckMessage gives the Entrar text of each result") {
    CHECK(RamalCheckMessage(RamalCheck::Ok).empty());
    CHECK(RamalCheckMessage(RamalCheck::Empty) == L"Digite s\u00f3 o n\u00famero do ramal.");
    CHECK(RamalCheckMessage(RamalCheck::Invalid) == L"Digite s\u00f3 o n\u00famero do ramal.");
}

TEST_CASE("AddressFromServer drops only a numeric port") {
    CHECK(AddressFromServer(L"h:5060") == L"h");
    CHECK(AddressFromServer(L"h") == L"h");
    CHECK(AddressFromServer(L"h:abc") == L"h:abc");
    CHECK(AddressFromServer(L"h:") == L"h:");
    CHECK(AddressFromServer(L"[::1]:5060") == L"[::1]");
    CHECK(AddressFromServer(L"h:123456") == L"h:123456");
    CHECK(AddressFromServer(L"") == L"");
}

TEST_CASE("BuildAccount fills locked fields from profile and address") {
    const AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    CHECK(account.label == L"2001 \u00b7 h");
    CHECK(account.server == L"h:5080");
    CHECK(account.proxy == L"");
    CHECK(account.domain == L"h");
    CHECK(account.username == L"2001");
    CHECK(account.authId == L"");
    CHECK(account.password == L"x");
    CHECK(account.displayName == L"2001");
    CHECK(account.transport == L"tcp");
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
    AccountProfile profile = TestProfile();
    profile.transport = Transport::Udp;
    profile.srtp = SrtpMode::Disabled;
    profile.proxy = L"p.invalid:5070";
    AccountFields account = BuildAccount(profile, L"h", L"1", L"p", profile.transport, L"");
    CHECK(account.transport == L"udp");
    CHECK(account.srtp == L"");
    CHECK(account.proxy == L"p.invalid:5070");
    profile.transport = Transport::Tcp;
    profile.srtp = SrtpMode::Mandatory;
    account = BuildAccount(profile, L"h", L"1", L"p", profile.transport, L"");
    CHECK(account.transport == L"tcp");
    CHECK(account.srtp == L"mandatory");
}

TEST_CASE("EnforceAccount restores tampered fields") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    const AccountFields expected = account;
    account.server = L"h:1";
    account.proxy = L"evil-proxy:1";
    account.domain = L"evil";
    account.transport = L"tls";
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
    CHECK(EnforceAccount(&account, TestProfile()));
    CheckSameAccount(account, expected);
}

TEST_CASE("EnforceAccount keeps the account address, normalized") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    account.server = L"Novo.Host:5999";
    account.domain = L"outro";
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.server == L"novo.host:5080");
    CHECK(account.domain == L"novo.host");
    CHECK(account.label == L"2001 \u00b7 novo.host");
}

TEST_CASE("BuildAccount uses the port of [portas] for that server and the default for the others") {
    AccountProfile profile = TestProfile();
    profile.serverPorts.push_back(ServerPort{L"starcloud1-starsonic.com.br", 35060});
    CHECK(BuildAccount(profile, L"starcloud1-starsonic.com.br", L"2001", L"x", Transport::Udp, L"").server ==
          L"starcloud1-starsonic.com.br:35060");
    CHECK(BuildAccount(profile, L"starcloud1-starsonic.com.br", L"2001", L"x", Transport::Tcp, L"").server ==
          L"starcloud1-starsonic.com.br:35060");
    const AccountFields other = BuildAccount(profile, L"starcloud-starsonic.com.br", L"2001", L"x", Transport::Udp, L"");
    CHECK(other.server == L"starcloud-starsonic.com.br:5080");
    CHECK(other.domain == L"starcloud-starsonic.com.br");
    CHECK(PortForServer(profile, L"starcloud1-starsonic.com.br") == 35060);
    CHECK(PortForServer(profile, L"starcloud-starsonic.com.br") == 5080);
    CHECK(PortForServer(profile, L"sub.starcloud1-starsonic.com.br") == 5080);   // so o nome exato
}

TEST_CASE("EnforceAccount moves a saved account to the port of [portas]") {
    AccountFields account = BuildAccount(TestProfile(), L"starcloud1-starsonic.com.br", L"2001", L"x",
                                         Transport::Udp, L"");
    CHECK(account.server == L"starcloud1-starsonic.com.br:5080");   // gravada antes da tabela
    AccountProfile profile = TestProfile();
    profile.serverPorts.push_back(ServerPort{L"starcloud1-starsonic.com.br", 35060});
    CHECK(EnforceAccount(&account, profile));
    CHECK(account.server == L"starcloud1-starsonic.com.br:35060");
    CHECK(account.domain == L"starcloud1-starsonic.com.br");
    CHECK(account.username == L"2001");
    CHECK(account.password == L"x");
}

TEST_CASE("EnforceAccount keeps the fields the user owns") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    account.username = L"2002";
    account.authId = L"auth-2002";
    account.password = L"y";
    account.displayName = L"Recep\u00e7\u00e3o";
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.username == L"2002");
    CHECK(account.authId == L"auth-2002");
    CHECK(account.password == L"y");
    CHECK(account.displayName == L"Recep\u00e7\u00e3o");
    CHECK(account.label == L"2002 \u00b7 h");
}

TEST_CASE("EnforceAccount empties accounts with an empty or invalid address") {
    const std::wstring servers[] = {L"", L":5060", L"bad host:5060", L"[::1]:5060", L"h:abc"};
    for (const std::wstring& server : servers) {
        CAPTURE(server);
        AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
        account.server = server;
        account.proxy = L"p.invalid";
        CHECK_FALSE(EnforceAccount(&account, TestProfile()));
        CHECK(account.username == L"");
        CHECK(account.password == L"");
        CHECK(account.server == L"");
        CHECK(account.domain == L"");
        CHECK(account.proxy == L"");
    }
}

TEST_CASE("NormalizeAccountName trims and keeps up to 40 characters") {
    CHECK(NormalizeAccountName(L"  PA 3 - Recep\u00e7\u00e3o\t") == L"PA 3 - Recep\u00e7\u00e3o");
    CHECK(NormalizeAccountName(L"   ") == L"");
    CHECK(NormalizeAccountName(std::wstring(45, L'a')) == std::wstring(40, L'a'));
}

TEST_CASE("NormalizeAccountName never splits a surrogate pair") {
    const std::wstring name = std::wstring(39, L'a') + std::wstring{wchar_t(0xD83D), wchar_t(0xDE00)};
    CHECK(NormalizeAccountName(name) == std::wstring(39, L'a'));
}

TEST_CASE("AccountNameFromLabel treats the automatic label as no name") {
    CHECK(AccountNameFromLabel(L"") == L"");
    CHECK(AccountNameFromLabel(L"2001 \u00b7 h") == L"");
    CHECK(AccountNameFromLabel(L"2002 \u00b7 novo.host") == L"");
    CHECK(AccountNameFromLabel(L"PA 3 - Recep\u00e7\u00e3o") == L"PA 3 - Recep\u00e7\u00e3o");
    CHECK(AccountNameFromLabel(L"PA 3 \u00b7 sala 2") == L"PA 3 \u00b7 sala 2");
    CHECK(AccountNameFromLabel(L"  Vendas  ") == L"Vendas");
}

TEST_CASE("TransportFromName accepts only udp and tcp") {
    CHECK(TransportFromName(L"udp", Transport::Tcp) == Transport::Udp);
    CHECK(TransportFromName(L" TCP ", Transport::Udp) == Transport::Tcp);
    CHECK(TransportFromName(L"tls", Transport::Udp) == Transport::Udp);
    CHECK(TransportFromName(L"", Transport::Tcp) == Transport::Tcp);
}

TEST_CASE("BuildAccount uses the chosen protocol and the account name") {
    const AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L" PA 3 ");
    CHECK(account.transport == L"udp");
    CHECK(account.label == L"PA 3");
    CHECK(account.displayName == L"2001");
}

TEST_CASE("EnforceAccount keeps the protocol and the name of each account") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L"PA 3 - Recep\u00e7\u00e3o");
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.transport == L"udp");
    CHECK(account.label == L"PA 3 - Recep\u00e7\u00e3o");
}

TEST_CASE("EnforceAccount resets unknown protocols to the profile default") {
    const std::wstring transports[] = {L"tls", L"sctp", L""};
    for (const std::wstring& transport : transports) {
        CAPTURE(transport);
        AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Udp, L"");
        account.transport = transport;
        CHECK(EnforceAccount(&account, TestProfile()));
        CHECK(account.transport == L"tcp");
    }
}

TEST_CASE("EnforceAccount cuts long names") {
    AccountFields account = BuildAccount(TestProfile(), L"h", L"2001", L"x", Transport::Tcp, L"");
    account.label = std::wstring(50, L'n');
    CHECK(EnforceAccount(&account, TestProfile()));
    CHECK(account.label == std::wstring(40, L'n'));
}

TEST_CASE("EnforceAccount keeps accounts saved before revision 1.4") {
    AccountProfile profile = TestProfile();
    profile.transport = Transport::Udp;
    AccountFields account = BuildAccount(profile, L"h", L"2001", L"x", Transport::Udp, L"");
    const AccountFields expected = account;
    CHECK(EnforceAccount(&account, profile));
    CheckSameAccount(account, expected);
    CHECK(account.label == L"2001 \u00b7 h");
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
