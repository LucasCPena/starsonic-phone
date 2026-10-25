// O monitor de rede do executavel sem o COM e sem threads (rc.3 spec 8 e Ruling 16): a decisao
// (windows/app/src/NetworkDecision.h: o que o Windows diz, o teste DNS do servidor da conta e o gancho de teste da
// fumaca) e o passo a passo dela (NetworkLoop.h: a conectividade lida de novo a cada intervalo e a cada aviso, um teste
// DNS de cada vez, o diagnostico). O "sem internet" do Windows sozinho nunca tira o app do ar (o NCSI erra atras de
// proxy, firewall e portal cativo). C++ portatil: entra no desktop_tests do Linux e do Windows.
#include <cstdint>
#include <optional>
#include <string>

#include "NetworkDecision.h"
#include "NetworkLoop.h"
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

// Um teste DNS que sai agora e volta com o resultado.
std::optional<bool> Dns(NetworkDecision& decision, bool answered) {
    return decision.OnDnsResult(answered, decision.DnsCheckStarted());
}

// O "Windows" do NetworkLoop: a conectividade que ele diz agora (nada: nao deu para ler) e quantas vezes foi lida.
struct FakeWindows {
    std::optional<int> connectivity = kIpv4Internet;
    int reads = 0;

    NetworkLoop::Reader Reader() {
        return [this] {
            ++reads;
            return connectivity;
        };
    }
};

bool Logged(const NetworkLoop::Actions& actions, const std::string& text) {
    for (const std::string& line : actions.log) {
        if (line.find(text) != std::string::npos) return true;
    }
    return false;
}

}  // namespace

TEST_CASE("windows with a local network but no internet stays online while the dns answers") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.DnsCheckUseful());
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork | kIpv6LocalNetwork) == kNoChange);
    CHECK(decision.Internet());
    // O teste DNS vem agora, sem esperar os 30 s.
    CHECK(decision.DnsCheckNow());
    const uint64_t now = decision.DnsCheckStarted();
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(decision.OnDnsResult(true, now) == kNoChange);
    CHECK(decision.Internet());
    // Uma falha so nao tira do ar, e o sucesso seguinte zera a conta.
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, true) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(decision.Internet());
}

TEST_CASE("windows with a local network but no internet and two dns failures in a row goes offline") {
    NetworkDecision decision = WithNamedServer();
    CHECK(decision.OnConnectivity(kIpv4Subnet) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, false) == std::optional<bool>(false));
    CHECK_FALSE(decision.Internet());
    CHECK(Dns(decision, false) == kNoChange);
    // Qualquer sucesso do DNS volta na hora.
    CHECK(Dns(decision, true) == std::optional<bool>(true));
    // Com a internet do Windows vale o mesmo: a rede mudou (o teste vem agora) e duas falhas tiram do ar.
    CHECK(decision.OnConnectivity(kIpv4Internet) == kNoChange);
    CHECK(decision.DnsCheckNow());
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, false) == std::optional<bool>(false));
    // O Windows dizer que ha internet nao traz de volta sozinho: so o DNS.
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK(decision.OnConnectivity(kIpv4Internet | kIpv6Internet) == kNoChange);
    CHECK(decision.DnsCheckNow());
    CHECK_FALSE(decision.Internet());
    CHECK(Dns(decision, true) == std::optional<bool>(true));
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
    // Sem rede, um resultado nao conta.
    CHECK(Dns(decision, true) == kNoChange);
    CHECK_FALSE(decision.Internet());
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
    // A rede volta (so a local): com internet na hora, as falhas de antes nao contam, e o teste DNS vem agora.
    CHECK(decision.OnConnectivity(kIpv6LocalNetwork) == std::optional<bool>(true));
    CHECK(decision.DnsCheckNow());
    const uint64_t now = decision.DnsCheckStarted();
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(decision.OnDnsResult(false, now) == kNoChange);
    CHECK(decision.Internet());
    // Com a internet do Windows, a mesma coisa (e a falha de antes da queda nao soma).
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    CHECK(decision.DnsCheckNow());
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(decision.Internet());
}

TEST_CASE("a dns result from before the network came back does not count") {
    NetworkDecision decision = WithNamedServer();
    const uint64_t before = decision.DnsCheckStarted();   // um teste a caminho quando a rede cai
    CHECK(decision.OnConnectivity(kDisconnected) == std::optional<bool>(false));
    CHECK(decision.OnConnectivity(kIpv4Internet) == std::optional<bool>(true));
    CHECK(decision.OnDnsResult(false, before) == kNoChange);   // o de antes da queda nao conta
    CHECK(Dns(decision, false) == kNoChange);                  // a primeira falha de verdade: ainda com internet
    CHECK(decision.Internet());
    CHECK(Dns(decision, false) == std::optional<bool>(false));
    // A rede muda (local) com um teste a caminho: ele tambem nao conta.
    CHECK(Dns(decision, true) == std::optional<bool>(true));
    const uint64_t onInternet = decision.DnsCheckStarted();
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK(decision.OnDnsResult(false, onInternet) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(decision.Internet());
    // Outra conta: o teste do servidor de antes tambem nao conta.
    const uint64_t oldServer = decision.DnsCheckStarted();
    CHECK(decision.OnServerChanged("starcloud-starsonic.com.br") == kNoChange);
    CHECK(decision.OnDnsResult(false, oldServer) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(decision.Internet());
}

TEST_CASE("a server given as an IP address ignores the dns and only the lack of a network takes it offline") {
    NetworkDecision decision;
    CHECK(decision.OnServerChanged("127.0.0.1") == kNoChange);
    CHECK_FALSE(decision.DnsCheckUseful());
    CHECK(decision.OnConnectivity(kIpv4LocalNetwork) == kNoChange);
    CHECK_FALSE(decision.DnsCheckNow());
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);
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
    CHECK_FALSE(IsIpAddress("sip.fumaca-starsonic.test"));
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
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(Dns(decision, false) == std::optional<bool>(false));
    CHECK(decision.OnServerChanged("starcloud-starsonic.com.br") == std::optional<bool>(true));
    CHECK(Dns(decision, false) == kNoChange);
    CHECK(decision.OnServerChanged(kServer) == kNoChange);
    CHECK(Dns(decision, false) == kNoChange);   // a falha antes da troca nao somou
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
    CHECK(Dns(decision, true) == kNoChange);
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

TEST_CASE("the monitor reads the windows connectivity again on every tick and leaves no network without any event") {
    FakeWindows windows;
    windows.connectivity = kDisconnected;
    NetworkLoop loop(windows.Reader(), 30000, false);
    NetworkLoop::Actions actions = loop.Open(1000);
    CHECK(actions.internet == std::optional<bool>(false));
    CHECK(loop.WakeAtMs() == 31000);
    // Sem rede e sem aviso do Windows: o intervalo continua e le de novo.
    actions = loop.OnTimer(31000);
    CHECK(actions.internet == kNoChange);
    CHECK(loop.WakeAtMs() == 61000);
    // A rede voltou e nenhum aviso chegou (o Advise falhou, um aviso se perdeu, o servico do Windows reiniciou): o
    // proximo intervalo ve.
    windows.connectivity = kIpv4Internet;
    actions = loop.OnTimer(61000);
    CHECK(actions.internet == std::optional<bool>(true));
    CHECK(windows.reads == 3);
    CHECK(loop.WakeAtMs() == 91000);
}

TEST_CASE("a windows event reads the connectivity again instead of trusting the event") {
    FakeWindows windows;
    NetworkLoop loop(windows.Reader(), 30000, false);
    CHECK(loop.Open(0).internet == kNoChange);
    windows.connectivity = kDisconnected;
    CHECK(loop.OnWindowsChanged().internet == std::optional<bool>(false));
    // Avisos fora de ordem: vale o que o Windows diz agora.
    windows.connectivity = kIpv4LocalNetwork;
    CHECK(loop.OnWindowsChanged().internet == std::optional<bool>(true));
    CHECK(loop.OnWindowsChanged().internet == kNoChange);
    CHECK(windows.reads == 4);
    // Sem conseguir ler (o servico do Windows fora): fica o que era.
    windows.connectivity = std::nullopt;
    CHECK(loop.OnWindowsChanged().internet == kNoChange);
    CHECK(loop.OnTimer(30000).internet == kNoChange);
}

TEST_CASE("the monitor runs one dns check at a time, at the tick and right away when the network changes") {
    FakeWindows windows;
    NetworkLoop loop(windows.Reader(), 30000, false);
    loop.Open(0);
    NetworkLoop::Actions actions = loop.OnServer(kServer);
    CHECK_FALSE(actions.dnsServer.has_value());   // o primeiro vem no intervalo
    actions = loop.OnTimer(30000);
    REQUIRE(actions.dnsServer.has_value());
    CHECK(*actions.dnsServer == kServer);
    const uint64_t first = actions.dnsTicket;
    // Ainda a caminho: nenhum outro.
    CHECK_FALSE(loop.OnTimer(60000).dnsServer.has_value());
    // A rede mudou com o teste a caminho: o teste da hora espera o de antes, cujo resultado nao conta.
    windows.connectivity = kIpv4LocalNetwork;
    CHECK_FALSE(loop.OnWindowsChanged().dnsServer.has_value());
    actions = loop.OnDnsResult(first, false, 1460);
    CHECK(actions.internet == kNoChange);
    REQUIRE(actions.dnsServer.has_value());
    const uint64_t second = actions.dnsTicket;
    // Duas falhas de verdade tiram do ar.
    CHECK(loop.OnDnsResult(second, false, 1460).internet == kNoChange);
    actions = loop.OnTimer(90000);
    REQUIRE(actions.dnsServer.has_value());
    CHECK(loop.OnDnsResult(actions.dnsTicket, false, 1460).internet == std::optional<bool>(false));
    // Um teste que nem saiu (sem thread) nao trava os proximos.
    actions = loop.OnTimer(120000);
    REQUIRE(actions.dnsServer.has_value());
    loop.OnDnsNotStarted(actions.dnsTicket);
    CHECK(loop.OnTimer(150000).dnsServer.has_value());
}

TEST_CASE("without an account or with an IP server the tick only reads windows") {
    FakeWindows windows;
    NetworkLoop loop(windows.Reader(), 30000, false);
    loop.Open(0);
    CHECK_FALSE(loop.OnTimer(30000).dnsServer.has_value());   // sem conta
    loop.OnServer("127.0.0.1");
    windows.connectivity = kIpv4LocalNetwork;
    CHECK_FALSE(loop.OnWindowsChanged().dnsServer.has_value());
    CHECK_FALSE(loop.OnTimer(60000).dnsServer.has_value());
    CHECK(loop.WakeAtMs() == 90000);
    CHECK(windows.reads == 4);
}

TEST_CASE("the dns result goes to the diagnostic when it changes, and every time only when verbose") {
    FakeWindows windows;
    NetworkLoop loop(windows.Reader(), 1000, false);
    loop.Open(0);
    loop.OnServer(kServer);
    // A primeira resposta depois de abrir vai ao diagnostico.
    NetworkLoop::Actions actions = loop.OnTimer(1000);
    actions = loop.OnDnsResult(actions.dnsTicket, true, 0);
    CHECK(Logged(actions, "o DNS respondeu pelo servidor starcloud1-starsonic.com.br (0)"));
    // A mesma de novo: nenhuma linha (nada repete a cada intervalo).
    actions = loop.OnTimer(2000);
    actions = loop.OnDnsResult(actions.dnsTicket, true, 0);
    CHECK(actions.log.empty());
    // A primeira falha vai, com o codigo; a segunda so diz que ficou sem internet.
    actions = loop.OnTimer(3000);
    actions = loop.OnDnsResult(actions.dnsTicket, false, 1460);
    CHECK(Logged(actions, "o DNS nao respondeu pelo servidor starcloud1-starsonic.com.br (1460)"));
    actions = loop.OnTimer(4000);
    actions = loop.OnDnsResult(actions.dnsTicket, false, 1460);
    CHECK_FALSE(Logged(actions, "o DNS nao respondeu"));
    CHECK(Logged(actions, "rede: sem internet"));
    // A resposta de volta vai, com a internet.
    actions = loop.OnTimer(5000);
    actions = loop.OnDnsResult(actions.dnsTicket, true, 0);
    CHECK(Logged(actions, "o DNS respondeu pelo servidor"));
    CHECK(Logged(actions, "rede: com internet"));
    // Outra conta: a primeira resposta dela vai.
    loop.OnServer("starcloud-starsonic.com.br");
    actions = loop.OnTimer(6000);
    actions = loop.OnDnsResult(actions.dnsTicket, true, 0);
    CHECK(Logged(actions, "o DNS respondeu pelo servidor starcloud-starsonic.com.br (0)"));

    // Com verboseDns (so o build de teste): cada resultado.
    NetworkLoop verbose(windows.Reader(), 1000, true);
    verbose.Open(0);
    verbose.OnServer(kServer);
    for (int64_t at = 1000; at <= 3000; at += 1000) {
        actions = verbose.OnTimer(at);
        actions = verbose.OnDnsResult(actions.dnsTicket, true, 0);
        CHECK(Logged(actions, "o DNS respondeu pelo servidor starcloud1-starsonic.com.br (0)"));
    }
}

TEST_CASE("the smoke test hook goes through the monitor loop") {
    FakeWindows windows;
    NetworkLoop loop(windows.Reader(), 30000, false);
    loop.Open(0);
    CHECK(loop.OnForce(false).internet == std::optional<bool>(false));
    CHECK(loop.OnTimer(30000).internet == kNoChange);
    CHECK(loop.OnForce(std::nullopt).internet == std::optional<bool>(true));
}
