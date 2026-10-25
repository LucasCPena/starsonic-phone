// A decisao do monitor de rede do executavel (windows/app/src/NetworkDecision.h, rc.3 spec 8): o que o Windows diz
// (INetworkListManager), o teste DNS do servidor da conta a cada 30 s e o gancho de teste da fumaca. C++ portatil:
// entra no desktop_tests do Linux e do Windows.
#include <optional>

#include "NetworkDecision.h"
#include "test_support.h"

using namespace starsonic;

namespace {

// Os NLM_CONNECTIVITY do netlistmgr.h (os valores do Windows).
const int kDisconnected = 0;
const int kIpv4NoTraffic = 0x1;
const int kIpv4Subnet = 0x10;
const int kIpv4LocalNetwork = 0x20;
const int kIpv4Internet = 0x40;
const int kIpv6LocalNetwork = 0x200;
const int kIpv6Internet = 0x400;

const std::optional<bool> kNoChange;

}  // namespace

TEST_CASE("windows without internet on IPv4 and IPv6 means offline at once, and online again at once") {
    NetworkDecision decision;
    CHECK(decision.Internet());
    CHECK(decision.OnConnectivity(kIpv4Internet) == kNoChange);   // ja era true: nada a dizer
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork | kIpv6LocalNetwork) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnConnectivity(kIpv4Subnet) == kNoChange);
    CHECK(decision.OnConnectivity(kDisconnected) == kNoChange);
    CHECK(decision.OnConnectivity(kIpv4NoTraffic) == kNoChange);
    // So o IPv6 com internet ja vale.
    CHECK(decision.OnConnectivity(kIpv6Internet | kIpv4LocalNetwork) == std::optional<bool>(true));
    CHECK(decision.Internet());
    CHECK(decision.OnConnectivity(kIpv4Internet | kIpv6Internet) == kNoChange);
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
}

TEST_CASE("with windows online two dns failures in a row mean offline and one success means online at once") {
    NetworkDecision decision;
    CHECK(decision.OnDnsResult(false) == kNoChange);   // uma so: ainda online
    CHECK(decision.Internet());
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(true) == std::optional<bool>(true));
    CHECK(decision.Internet());
    // A conta recomeca do zero depois de um sucesso.
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
}

TEST_CASE("dns results while windows has no internet do not count, and windows coming back forgets the failures") {
    NetworkDecision decision;
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == std::optional<bool>(false));
    CHECK_FALSE(decision.WindowsInternet());
    // Um teste que ja estava a caminho quando o Windows perdeu a internet: o Windows manda.
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK_FALSE(decision.Internet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);
    // A internet volta: as falhas de antes nao contam.
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    CHECK(decision.WindowsInternet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.Internet());

    // Duas falhas com o Windows online, e o Windows cai e volta: online de novo, sem esperar o proximo teste.
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kDisconnected) == kNoChange);
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    // Outra mudanca do Windows sem perder a internet (o IPv6 chegou) nao apaga as falhas.
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnConnectivity(kIpv4Internet | kIpv6Internet) == kNoChange);
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
}

TEST_CASE("another account server or no account forgets the dns failures") {
    NetworkDecision decision;
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnDnsResult(false) == std::optional<bool>(false));
    CHECK(decision.OnServerChanged() == std::optional<bool>(true));
    CHECK(decision.Internet());
    CHECK(decision.OnDnsResult(false) == kNoChange);
    CHECK(decision.OnServerChanged() == kNoChange);
    CHECK(decision.OnDnsResult(false) == kNoChange);   // a falha antes da troca nao somou
    CHECK(decision.Internet());
    // Sem a internet do Windows, a troca de servidor nao a traz de volta.
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnServerChanged() == kNoChange);
    CHECK_FALSE(decision.Internet());
}

TEST_CASE("the smoke test hook forces the view and gives the real one back") {
    NetworkDecision decision;
    CHECK(decision.Force(false) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    // Forcado: o Windows e o DNS nao mudam o que vale.
    CHECK(decision.OnConnectivity(kIpv4Internet) == kNoChange);
    CHECK(decision.OnDnsResult(true) == kNoChange);
    CHECK(decision.Force(false) == kNoChange);
    // De volta a visao de verdade (online).
    CHECK(decision.Force(std::nullopt) == std::optional<bool>(true));
    CHECK(decision.Force(std::nullopt) == kNoChange);
    // A de verdade continua contando enquanto forcado: o Windows caiu no meio.
    CHECK(decision.Force(false) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK(decision.Force(std::nullopt) == kNoChange);
    CHECK_FALSE(decision.Internet());
    CHECK(decision.Force(true) == std::optional<bool>(true));
    CHECK(decision.Force(std::nullopt) == std::optional<bool>(false));
}
