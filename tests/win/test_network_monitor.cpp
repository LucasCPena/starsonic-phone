// A decisao do monitor de rede do executavel (windows/app/src/NetworkDecision.h, rc.3 spec 8 e Ruling 16): o que o
// Windows diz (INetworkListManager), o teste DNS do servidor da conta e o gancho de teste da fumaca. O "sem internet"
// do Windows sozinho nunca tira o app do ar (o NCSI erra atras de proxy, firewall e portal cativo). C++ portatil: entra no
// desktop_tests do Linux e do Windows.
#include <optional>

#include "NetworkDecision.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// Os NLM_CONNECTIVITY do netlistmgr.h (os valores do Windows).
const int kDisconnected = 0;
const int kIpv4NoTraffic = 0x1;
const int kIpv6NoTraffic = 0x2;
const int kIpv4Subnet = 0x10;
const int kIpv4LocalNetwork = 0x20;
const int kIpv4Internet = 0x40;
const int kIpv6LocalNetwork = 0x200;
const int kIpv6Internet = 0x400;

const std::optional<bool> kNoChange;
const char kServer[] = "starcloud1-starsonic.com.br";

// A conta num servidor com nome: o teste DNS vale.
NetworkDecision WithNamedServer() {
    NetworkDecision decision;
    decision.OnServerChanged(kServer);
    return decision;
}

}  // namespace

TEST_CASE("windows with a local network but no internet stays online while the dns answers") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.DnsCheckUseful());
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork | kIpv6LocalNetwork) == kNoChange);
    CHECK(decision.Internet());
    // O teste DNS vem agora, sem esperar os 30 s.
    CHECK(decision.DnsCheckNow());
    decision.DnsCheckStarted();
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK(decision.Internet());
    // Uma falha so nao tira do ar, e o sucesso seguinte zera a conta.
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());
}

TEST_CASE("windows with a local network but no internet and two dns failures in a row goes offline") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.OnConnectivity(kIpv4Subnet) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    // Qualquer sucesso do DNS volta na hora.
    CHECK(decision.OnDnsResult(true) == std::optional<bool>(true));
    // Com a internet do Windows vale o mesmo: a rede mudou (o teste vem agora) e duas falhas tiram do ar.
    CHECK(decision.OnConnectivity(kIpv4Internet) == kNoChange);
    CHECK(decision.DnsCheckNow());
    decision.DnsCheckStarted();
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    // O Windows dizer que ha internet nao traz de volta sozinho: so o DNS.
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK(decision.OnConnectivity(kIpv4Internet | kIpv6Internet) == kNoChange);
    CHECK(decision.DnsCheckNow());
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnDnsResult(true) == std::optional<bool>(true));
}

TEST_CASE("windows without any network goes offline at once and coming back is online at once with a dns check") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    CHECK_FALSE(decision.DnsCheckUseful());   // sem rede, nada a testar
    CHECK_FALSE(decision.DnsCheckNow());
    // So o "sem trafego" tambem e sem rede.
    CHECK(decision.OnConnectivity(kIpv4NoTraffic | kIpv6NoTraffic) == kNoChange);
    CHECK_FALSE(decision.DnsCheckUseful());
    // Um teste que ja estava a caminho nao conta.
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    // A rede volta (so a local): com internet na hora, as falhas de antes nao contam, e o teste DNS vem agora.
    CHECK(decision.OnConnectivity(kIpv6LocalNetwork) == std::optional<bool>(true));
    CHECK(decision.DnsCheckNow());
    decision.DnsCheckStarted();
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());
    // Com a internet do Windows, a mesma coisa (e a falha de antes da queda nao soma).
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    CHECK(decision.DnsCheckNow());
    decision.DnsCheckStarted();
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());
}

TEST_CASE("a server given as an IP address ignores the dns and only the lack of a network takes it offline") {
    NetworkDecision decision;
    CHECK(decision.OnServerChanged("127.0.0.1") == kNoChange);
    CHECK_FALSE(decision.DnsCheckUseful());
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    CHECK_FALSE(decision.DnsCheckNow());
    // Sem conta: nada a testar tambem.
    CHECK(decision.OnServerChanged("") == kNoChange);
    CHECK_FALSE(decision.DnsCheckUseful());
    // Um nome de novo: o teste volta a valer.
    CHECK(decision.OnServerChanged(kServer) == kNoChange);
    CHECK(decision.DnsCheckUseful());
}

TEST_CASE("an IP address is told apart from a server name") {
    CHECK(IsIpAddress("127.0.0.1"));
    CHECK(IsIpAddress("192.168.10.20"));
    CHECK(IsIpAddress("::1"));
    CHECK(IsIpAddress("fe80::1c2:3d"));
    CHECK(IsIpAddress("[2001:db8::7]"));
    CHECK_FALSE(IsIpAddress(kServer));
    CHECK_FALSE(IsIpAddress("pbx"));
    CHECK_FALSE(IsIpAddress("1.2.3"));
    CHECK_FALSE(IsIpAddress("1.2.3.4.5"));
    CHECK_FALSE(IsIpAddress("256.1.1.1"));
    CHECK_FALSE(IsIpAddress("10.0.0.1a"));
    CHECK_FALSE(IsIpAddress("1..2.3"));
    CHECK_FALSE(IsIpAddress(""));
}

TEST_CASE("another account server forgets the dns failures") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    CHECK(decision.OnServerChanged("starcloud-starsonic.com.br") == std::optional<bool>(true));
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnServerChanged(kServer) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);   // a falha antes da troca nao somou
    CHECK(decision.Internet());
    // Sem rede, a troca de servidor nao traz a internet de volta.
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnServerChanged("starcloud-starsonic.com.br") == kNoChange);
    CHECK_FALSE(decision.Internet());
}

TEST_CASE("the smoke test hook forces the view and gives the real one back") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.Force(false) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    // Forcado: o Windows e o DNS nao mudam o que vale.
    CHECK(decision.OnConnectivity(kIpv4Internet) == kNoChange);
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK(decision.Force(false) == kNoChange);
    // De volta a visao de verdade (online).
    CHECK(decision.Force(std::nullopt) == std::optional<bool>(true));
    CHECK(decision.Force(std::nullopt) == kNoChange);
    // A de verdade continua contando enquanto forcado: a rede caiu no meio.
    CHECK(decision.Force(false) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kDisconnected) == kNoChange);
    CHECK(decision.Force(std::nullopt) == kNoChange);
    CHECK_FALSE(decision.Internet());
    CHECK(decision.Force(true) == std::optional<bool>(true));
    CHECK(decision.Force(std::nullopt) == std::optional<bool>(false));
}
