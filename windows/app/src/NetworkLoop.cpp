#include "NetworkLoop.h"

#include <cstdio>
#include <utility>

namespace starsonic {

namespace {

std::string Hex(int value) {
    char text[16];
    std::snprintf(text, sizeof(text), "0x%08x", static_cast<unsigned>(value));
    return text;
}

// O que cada estado faz, para o diagnostico.
const char* Describe(InternetState state) {
    switch (state) {
        case InternetState::NoNetwork:
            return "sem internet, sem rede: o motor para";
        case InternetState::NoDns:
            return "sem internet pelo DNS: o motor continua";
        case InternetState::Online:
            break;
    }
    return "com internet";
}

}  // namespace

NetworkLoop::NetworkLoop(Reader reader, int64_t intervalMs, bool verboseDns)
    : reader_(std::move(reader)), intervalMs_(intervalMs > 0 ? intervalMs : 1), verboseDns_(verboseDns) {}

NetworkLoop::Actions NetworkLoop::Open(int64_t nowMs) {
    Actions actions;
    wakeAtMs_ = nowMs + intervalMs_;
    Read(actions, /*logAlways=*/true);
    StartDns(actions, /*tick=*/false);
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnWindowsChanged() {
    Actions actions;
    Read(actions, /*logAlways=*/true);
    StartDns(actions, /*tick=*/false);
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnServer(const std::string& server) {
    Actions actions;
    server_ = server;
    dnsSeen_ = DnsSeen::None;
    Report(actions, "outra conta", decision_.OnServerChanged(server));
    StartDns(actions, /*tick=*/false);
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnConnected(bool connected) {
    Actions actions;
    Report(actions, connected ? "a conta conectou" : "a conta saiu do ar", decision_.OnConnectedChanged(connected));
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnForce(std::optional<bool> internet) {
    Actions actions;
    Report(actions, "forcado", decision_.Force(internet));
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnDnsResult(uint64_t ticket, bool answered, long status) {
    Actions actions;
    if (dnsRunning_ && ticket == dnsTicket_) dnsRunning_ = false;
    // Um teste de antes de a rede ou a conta mudarem: nem conta nem vai ao diagnostico.
    const bool current = ticket == decision_.Generation() && decision_.DnsCheckUseful();
    if (current) {
        const DnsSeen seen = answered ? DnsSeen::Answered : DnsSeen::Failed;
        if (verboseDns_ || seen != dnsSeen_) {
            actions.log.push_back(std::string("rede: o DNS ") + (answered ? "respondeu" : "nao respondeu") +
                                  " pelo servidor " + dnsServer_ + " (" + std::to_string(status) + ")");
        }
        dnsSeen_ = seen;
    }
    Report(actions, answered ? "o teste DNS respondeu" : "duas falhas seguidas do teste DNS",
           decision_.OnDnsResult(answered, ticket));
    StartDns(actions, /*tick=*/false);
    return actions;
}

void NetworkLoop::OnDnsNotStarted(uint64_t ticket) {
    if (dnsRunning_ && ticket == dnsTicket_) dnsRunning_ = false;
}

NetworkLoop::Actions NetworkLoop::OnTimer(int64_t nowMs) {
    Actions actions;
    wakeAtMs_ = nowMs + intervalMs_;
    Read(actions, /*logAlways=*/false);
    StartDns(actions, /*tick=*/true);
    return actions;
}

void NetworkLoop::Read(Actions& actions, bool logAlways) {
    const std::optional<int> connectivity = reader_ ? reader_() : std::nullopt;
    if (!connectivity) {
        if (!unreadLogged_) actions.log.push_back("rede: a conectividade do Windows nao foi lida (fica a de antes)");
        unreadLogged_ = true;
        return;
    }
    unreadLogged_ = false;
    if (logAlways || connectivity != lastConnectivity_) {
        actions.log.push_back("rede: conectividade do Windows " + Hex(*connectivity));
    }
    lastConnectivity_ = connectivity;
    const std::optional<InternetState> change = decision_.OnConnectivity(*connectivity);
    if (change) {
        Report(actions, *change == InternetState::NoNetwork ? "o Windows nao ve nenhuma rede" : "o Windows ve a rede",
               change);
    }
}

void NetworkLoop::Report(Actions& actions, const std::string& why, std::optional<InternetState> internet) {
    if (!internet) return;
    actions.internet = internet;
    actions.log.push_back(std::string("rede: ") + Describe(*internet) + " (" + why + ")");
}

void NetworkLoop::StartDns(Actions& actions, bool tick) {
    // Um de cada vez, com um servidor com nome e alguma rede; fora do intervalo, so quando a rede mudou.
    if (dnsRunning_ || server_.empty() || !decision_.DnsCheckUseful()) return;
    if (!tick && !decision_.DnsCheckNow()) return;
    if (!tick) actions.log.push_back("rede: a rede mudou: teste DNS de " + server_ + " agora");
    dnsRunning_ = true;
    dnsTicket_ = decision_.DnsCheckStarted();
    dnsServer_ = server_;
    actions.dnsServer = server_;
    actions.dnsTicket = dnsTicket_;
}

}  // namespace starsonic
