#pragma once
// O passo a passo do monitor de rede (rc.3, spec 8 e Ruling 16), sem o COM e sem threads: a thread do NetworkMonitor
// chama os passos e faz o que cada um pede (Actions: o SetInternet, um teste DNS e as linhas do diagnostico, tudo fora da
// trava dela), e acorda de novo em WakeAtMs(). A decisao e a do NetworkDecision.h.
// - A conectividade do Windows (reader) e lida de novo na abertura, a cada aviso do Windows (o argumento do aviso pode
//   ser velho: os avisos do COM chegam em qualquer ordem) e a cada intervalo, tambem sem rede e sem teste DNS: sem um
//   aviso que chegue (o Advise que falhou, um aviso perdido, o servico do Windows que reiniciou, o Iniciar com o
//   Windows antes da rede), o app nunca fica preso no "sem internet". Nao deu para ler: fica a de antes.
// - O teste DNS do servidor da conta: no intervalo e na hora quando a rede muda, um de cada vez (o resultado volta com
//   a vez dele, e um teste de antes de a rede ou a conta mudarem nao conta).
// - O diagnostico: a conectividade na abertura, em cada aviso e quando muda; o resultado do DNS na primeira vez depois da
//   abertura ou de outra conta e quando muda (de respondeu para nao respondeu e de volta), nada que repita a cada
//   intervalo; com verboseDns (so o build de teste, com o intervalo curto da fumaca), cada resultado.
//
// C++ portatil, sem trava: so a thread do monitor o usa.
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "NetworkDecision.h"

namespace starsonic {

class NetworkLoop {
public:
    // Os NLM_CONNECTIVITY de agora (nada: nao deu para ler).
    using Reader = std::function<std::optional<int>()>;

    // O que um passo pede.
    struct Actions {
        std::optional<bool> internet;           // vai ao SetInternet (o que vale mudou)
        std::optional<std::string> dnsServer;   // um teste DNS deste servidor sai agora
        uint64_t dnsTicket = 0;                 // a vez do teste: volta no OnDnsResult (ou no OnDnsNotStarted)
        std::vector<std::string> log;           // as linhas do diagnostico
    };

    NetworkLoop(Reader reader, int64_t intervalMs, bool verboseDns);

    // A abertura: le a conectividade, e o primeiro intervalo fica para nowMs + o intervalo.
    Actions Open(int64_t nowMs);
    // Um aviso do Windows (ConnectivityChanged): le de novo.
    Actions OnWindowsChanged();
    // O servidor da conta em uso ("" sem conta).
    Actions OnServer(const std::string& server);
    // O gancho de teste (NetworkMonitor::Force).
    Actions OnForce(std::optional<bool> internet);
    // O teste DNS da vez ticket terminou (status: o codigo do DnsQuery_W, para o diagnostico).
    Actions OnDnsResult(uint64_t ticket, bool answered, long status);
    // O teste da vez ticket nem saiu (a thread nao abriu): os proximos continuam.
    void OnDnsNotStarted(uint64_t ticket);
    // A hora do intervalo chegou (nowMs >= WakeAtMs()): le de novo, e o teste DNS do intervalo.
    Actions OnTimer(int64_t nowMs);
    int64_t WakeAtMs() const { return wakeAtMs_; }

private:
    enum class DnsSeen { None, Answered, Failed };

    void Read(Actions& actions, bool logAlways);
    static void Report(Actions& actions, const std::string& why, std::optional<bool> internet);
    void StartDns(Actions& actions, bool tick);

    NetworkDecision decision_;
    Reader reader_;
    int64_t intervalMs_;
    bool verboseDns_;
    int64_t wakeAtMs_ = 0;
    std::optional<int> lastConnectivity_;   // a ultima lida (vai ao diagnostico quando muda)
    bool unreadLogged_ = false;
    std::string server_;
    bool dnsRunning_ = false;
    uint64_t dnsTicket_ = 0;
    std::string dnsServer_;            // o servidor do teste a caminho
    DnsSeen dnsSeen_ = DnsSeen::None;  // o ultimo resultado no diagnostico (None: abertura ou outra conta)
};

}  // namespace starsonic
