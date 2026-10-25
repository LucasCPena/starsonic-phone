#pragma once
// A decisao do monitor de rede do executavel (rc.3, spec 8; NetworkMonitor.h faz o resto): a internet que vale para o
// DesktopApp (DesktopApp::SetInternet, conta.internet) a partir do que o Windows diz e do teste DNS do servidor da conta.
// - O Windows (INetworkListManager: a leitura da abertura e o ConnectivityChanged) sem internet no IPv4 e no IPv6: sem
//   internet, na hora. A internet do Windows voltando: com internet, na hora, e as falhas de DNS de antes nao contam.
// - Com a internet do Windows: duas falhas seguidas do teste DNS (a cada 30 s) sao sem internet; um sucesso e com
//   internet, na hora (e a conta das falhas recomeca). Sem a internet do Windows, o resultado de um teste nao conta.
// - Outra conta (outro servidor) ou nenhuma: as falhas de antes nao contam.
// - O gancho de teste da fumaca (so no build de teste, NetworkMonitor::Force) forca o que vale; sem ele, volta a visao
//   de verdade, que continuou contando.
// Cada chamada devolve o valor novo quando o que vale mudou (o que vai ao SetInternet) e nada quando continua igual.
// Antes de tudo, com internet (o DesktopApp tambem comeca assim).
//
// C++ portatil, sem trava: o NetworkMonitor so a usa na thread dele.
#include <optional>

namespace starsonic {

class NetworkDecision {
public:
    // Os NLM_CONNECTIVITY de internet do netlistmgr.h (o NetworkMonitor.cpp confere os valores).
    static constexpr int kIpv4Internet = 0x40;    // NLM_CONNECTIVITY_IPV4_INTERNET
    static constexpr int kIpv6Internet = 0x400;   // NLM_CONNECTIVITY_IPV6_INTERNET
    // Quantas falhas seguidas do teste DNS sao sem internet.
    static constexpr int kDnsFailuresOffline = 2;

    // A conectividade do Windows (os NLM_CONNECTIVITY juntos).
    std::optional<bool> OnConnectivity(int connectivity);
    // Um teste DNS do servidor da conta terminou (resolved: o nome resolveu).
    std::optional<bool> OnDnsResult(bool resolved);
    // A conta em uso mudou de servidor, ou nao ha conta.
    std::optional<bool> OnServerChanged();
    // O gancho de teste: o que vale a partir de agora (nada: a visao de verdade de novo).
    std::optional<bool> Force(std::optional<bool> internet);

    // O que vale agora.
    bool Internet() const;
    // O Windows ve a internet (o teste DNS so roda assim).
    bool WindowsInternet() const { return windows_; }

private:
    std::optional<bool> Report();

    bool windows_ = true;
    int dnsFailures_ = 0;
    std::optional<bool> forced_;
    bool reported_ = true;
};

}  // namespace starsonic
