#include "NetworkLoop.h"

#include <algorithm>
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
    StartDns(actions, /*tick=*/false, nowMs);
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnWindowsChanged() {
    Actions actions;
    Read(actions, /*logAlways=*/true);
    StartDns(actions, /*tick=*/false, wakeAtMs_);
    return actions;
}

NetworkLoop::Actions NetworkLoop::OnServer(const std::string& server) {
    Actions actions;
    server_ = server;
    dnsSeen_ = DnsSeen::None;
    Report(actions, "outra conta", decision_.OnServerChanged(server));
    StartDns(actions, /*tick=*/false, wakeAtMs_);
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
    const auto lost = std::find(lostTickets_.begin(), lostTickets_.end(), ticket);
    if (lost != lostTickets_.end()) {
        // Um perdido que voltou tarde: a vaga dele fica livre, e o resultado nao vale.
        lostTickets_.erase(lost);
        StartDns(actions, /*tick=*/false, wakeAtMs_);
        return actions;
    }
    if (!dnsRunning_ || ticket != dnsTicket_) return actions;   // nao e o teste a caminho
    dnsRunning_ = false;
    // Um teste de antes de a rede ou a conta mudarem: nem conta nem vai ao diagnostico.
    const bool current = dnsGeneration_ == decision_.Generation() && decision_.DnsCheckUseful();
    if (current) {
        const DnsSeen seen = answered ? DnsSeen::Answered : DnsSeen::Failed;
        if (verboseDns_ || seen != dnsSeen_) {
            actions.log.push_back(std::string("rede: o DNS ") + (answered ? "respondeu" : "nao respondeu") +
                                  " pelo servidor " + dnsServer_ + " (" + std::to_string(status) + ")");
        }
        dnsSeen_ = seen;
    }
    Report(actions, answered ? "o teste DNS respondeu" : "duas falhas seguidas do teste DNS",
           decision_.OnDnsResult(answered, dnsGeneration_));
    StartDns(actions, /*tick=*/false, wakeAtMs_);
    return actions;
}

void NetworkLoop::OnDnsNotStarted(uint64_t ticket) {
    if (dnsRunning_ && ticket == dnsTicket_) dnsRunning_ = false;
}

NetworkLoop::Actions NetworkLoop::OnTimer(int64_t nowMs) {
    Actions actions;
    wakeAtMs_ = nowMs + intervalMs_;
    Read(actions, /*logAlways=*/false);
    DropLostDns(actions, nowMs);
    StartDns(actions, /*tick=*/true, nowMs);
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

// O teste a caminho ha dois intervalos ou mais (um DnsQuery_W preso): perdido. Outro pode sair, e o resultado dele, se
// chegar, nao vale (OnDnsResult).
void NetworkLoop::DropLostDns(Actions& actions, int64_t nowMs) {
    if (!dnsRunning_ || nowMs - dnsStampMs_ < 2 * intervalMs_) return;
    dnsRunning_ = false;
    lostTickets_.push_back(dnsTicket_);
    actions.log.push_back("rede: o teste DNS de " + dnsServer_ + " nao voltou em dois intervalos: perdido");
    if (lostTickets_.size() >= kMaxLostDnsChecks) {
        actions.log.push_back("rede: " + std::to_string(lostTickets_.size()) +
                              " testes DNS perdidos: nenhum outro ate um voltar");
    }
}

// stampMs: a hora do intervalo (tick) ou um limite de cima da hora de agora (o proximo intervalo).
void NetworkLoop::StartDns(Actions& actions, bool tick, int64_t stampMs) {
    // Um de cada vez, com um servidor com nome e alguma rede; fora do intervalo, so quando a rede mudou.
    if (dnsRunning_ || lostTickets_.size() >= kMaxLostDnsChecks || server_.empty() || !decision_.DnsCheckUseful()) {
        return;
    }
    if (!tick && !decision_.DnsCheckNow()) return;
    if (!tick) actions.log.push_back("rede: a rede mudou: teste DNS de " + server_ + " agora");
    dnsRunning_ = true;
    dnsTicket_ = ++lastTicket_;
    dnsGeneration_ = decision_.DnsCheckStarted();
    dnsStampMs_ = stampMs;
    dnsServer_ = server_;
    actions.dnsServer = server_;
    actions.dnsTicket = dnsTicket_;
}

}  // namespace starsonic
