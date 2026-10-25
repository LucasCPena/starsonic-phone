#include "NetworkDecision.h"

namespace starsonic {

std::optional<bool> NetworkDecision::OnConnectivity(int connectivity) {
    const bool internet = (connectivity & (kIpv4Internet | kIpv6Internet)) != 0;
    if (internet && !windows_) dnsFailures_ = 0;   // a internet voltou: as falhas de antes nao contam
    windows_ = internet;
    return Report();
}

std::optional<bool> NetworkDecision::OnDnsResult(bool resolved) {
    if (!windows_) return std::nullopt;   // um teste que ja estava a caminho: o Windows manda
    if (resolved) {
        dnsFailures_ = 0;
    } else if (dnsFailures_ < kDnsFailuresOffline) {
        ++dnsFailures_;
    }
    return Report();
}

std::optional<bool> NetworkDecision::OnServerChanged() {
    dnsFailures_ = 0;
    return Report();
}

std::optional<bool> NetworkDecision::Force(std::optional<bool> internet) {
    forced_ = internet;
    return Report();
}

bool NetworkDecision::Internet() const {
    if (forced_) return *forced_;
    return windows_ && dnsFailures_ < kDnsFailuresOffline;
}

std::optional<bool> NetworkDecision::Report() {
    const bool now = Internet();
    if (now == reported_) return std::nullopt;
    reported_ = now;
    return now;
}

}  // namespace starsonic
