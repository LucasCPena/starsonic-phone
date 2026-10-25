#pragma once
// A decisao do monitor de rede do executavel (rc.3, spec 8 e os Rulings 16 e 23; NetworkMonitor.h faz o resto): a
// internet que vale para o DesktopApp (DesktopApp::SetInternet, os estados de InternetState.h) a partir do que o
// Windows diz, do teste DNS do servidor da conta e de a conta estar conectada. O "sem internet" do Windows sozinho
// nunca tira o app do ar: o teste dele (o NCSI) erra atras de proxy, firewall e portal cativo, com o SIP funcionando.
// - Sem nenhuma rede no Windows (desconectado, ou sem nenhuma das redes IPv4/IPv6 de internet, local ou de sub-rede):
//   sem rede (NoNetwork, o "sem internet" forte: o motor para), na hora.
// - A rede voltando: com internet, na hora (as falhas de DNS de antes nao contam), e um teste DNS na hora.
// - So a rede local, sem a internet do Windows (ou outra mudanca da rede): continua como estava, e um teste DNS na hora
//   em vez de esperar os 30 s.
// - Duas falhas seguidas do teste DNS com a conta fora do ar: sem o DNS (NoDns, o "sem internet" fraco: so a bolinha,
//   e o motor segue como esta). Com a conta conectada (conta.status "conectado"), a falha nao conta: o registro vivo
//   prova que a central responde (o motor acha o servidor pelo cache do Windows); a conta conectar zera a conta das
//   falhas e tira do NoDns na hora. Um sucesso do DNS: com internet, na hora (e a conta das falhas recomeca). O
//   resultado de um teste que saiu antes de a rede mudar (cair, voltar, ficar so local) ou de outra conta nao conta (a
//   vez do teste, DnsCheckStarted); sem rede, tambem nao.
// - Um servidor dado por IP (ou nenhuma conta) nao tem teste DNS: so a falta de rede vale. Outra conta (outro servidor):
//   as falhas de antes nao contam.
// - O gancho de teste da fumaca (so no build de teste, NetworkMonitor::Force) forca o que vale (fora: sem rede, como a
//   rede que cai); sem ele, volta a visao de verdade, que continuou contando.
// Cada mudanca devolve o estado novo quando o que vale mudou (o que vai ao SetInternet) e nada quando continua igual.
// Antes de tudo, com internet (o DesktopApp tambem comeca assim), com a rede do Windows e com a conta fora do ar.
//
// C++ portatil, sem trava: o NetworkMonitor so a usa na thread dele.
#include <cstdint>
#include <optional>
#include <string>

#include "InternetState.h"

namespace starsonic {

class NetworkDecision {
public:
    // Os NLM_CONNECTIVITY do netlistmgr.h (o NetworkMonitor.cpp confere os valores).
    static constexpr int kIpv4Subnet = 0x10;          // NLM_CONNECTIVITY_IPV4_SUBNET
    static constexpr int kIpv4LocalNetwork = 0x20;    // NLM_CONNECTIVITY_IPV4_LOCALNETWORK
    static constexpr int kIpv4Internet = 0x40;        // NLM_CONNECTIVITY_IPV4_INTERNET
    static constexpr int kIpv6Subnet = 0x100;         // NLM_CONNECTIVITY_IPV6_SUBNET
    static constexpr int kIpv6LocalNetwork = 0x200;   // NLM_CONNECTIVITY_IPV6_LOCALNETWORK
    static constexpr int kIpv6Internet = 0x400;       // NLM_CONNECTIVITY_IPV6_INTERNET
    // Quantas falhas seguidas do teste DNS sao sem internet.
    static constexpr int kDnsFailuresOffline = 2;

    // A conectividade do Windows (os NLM_CONNECTIVITY juntos).
    std::optional<InternetState> OnConnectivity(int connectivity);
    // Um teste DNS do servidor da conta terminou (answered: o DNS respondeu pelo nome); generation: a vez de quando ele
    // saiu (DnsCheckStarted).
    std::optional<InternetState> OnDnsResult(bool answered, uint64_t generation);
    // O servidor da conta em uso ("" sem conta).
    std::optional<InternetState> OnServerChanged(const std::string& server);
    // A conta em uso esta conectada (conta.status "conectado") ou nao.
    std::optional<InternetState> OnConnectedChanged(bool connected);
    // O gancho de teste: com internet (true), sem rede (false) ou a visao de verdade de novo (nada).
    std::optional<InternetState> Force(std::optional<bool> internet);

    // O que vale agora.
    InternetState State() const;
    // O teste DNS serve agora: a conta tem um servidor com nome (nao um IP) e o Windows ve alguma rede.
    bool DnsCheckUseful() const;
    // Um teste DNS deve sair agora, sem esperar os 30 s (a rede mudou), e serve.
    bool DnsCheckNow() const { return dnsNow_ && DnsCheckUseful(); }
    // Um teste DNS saiu: devolve a vez dele (vai no OnDnsResult).
    uint64_t DnsCheckStarted() {
        dnsNow_ = false;
        return generation_;
    }
    // A vez de agora: sobe quando a rede muda de classe e quando a conta muda de servidor.
    uint64_t Generation() const { return generation_; }

private:
    enum class Network { None, Local, Internet };

    std::optional<InternetState> Report();

    Network network_ = Network::Internet;
    bool namedServer_ = false;   // a conta tem um servidor com nome: o teste DNS vale
    bool connected_ = false;     // a conta em uso esta conectada: uma falha do DNS nao conta
    int dnsFailures_ = 0;        // as falhas seguidas do teste DNS com a conta fora do ar
    bool dnsNow_ = false;
    uint64_t generation_ = 0;
    std::optional<bool> forced_;
    InternetState reported_ = InternetState::Online;
};

// O servidor e um endereco IP (IPv4 a.b.c.d, ou IPv6, com ou sem os colchetes), sem nome para o DNS.
bool IsIpAddress(const std::string& server);

}  // namespace starsonic
