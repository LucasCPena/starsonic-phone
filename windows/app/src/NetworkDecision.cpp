#include "NetworkDecision.h"

#include <cctype>

namespace starsonic {

std::optional<bool> NetworkDecision::OnConnectivity(int connectivity) {
    Network network = Network::None;
    if ((connectivity & (kIpv4Internet | kIpv6Internet)) != 0) {
        network = Network::Internet;
    } else if ((connectivity & (kIpv4Subnet | kIpv4LocalNetwork | kIpv6Subnet | kIpv6LocalNetwork)) != 0) {
        network = Network::Local;
    }
    if (network != Network::None && network_ == Network::None) dnsFailures_ = 0;   // a rede voltou: as falhas nao contam
    // A rede voltou ou mudou (so a local, sem a internet do Windows, por exemplo): o DNS confere agora.
    if (network != Network::None && network != network_) dnsNow_ = true;
    network_ = network;
    return Report();
}

std::optional<bool> NetworkDecision::OnDnsResult(bool answered) {
    if (!DnsCheckUseful()) return std::nullopt;   // um teste que ja estava a caminho quando a rede caiu
    if (answered) {
        dnsFailures_ = 0;
    } else if (dnsFailures_ < kDnsFailuresOffline) {
        ++dnsFailures_;
    }
    return Report();
}

std::optional<bool> NetworkDecision::OnServerChanged(const std::string& server) {
    namedServer_ = !server.empty() && !IsIpAddress(server);
    dnsFailures_ = 0;
    return Report();
}

std::optional<bool> NetworkDecision::Force(std::optional<bool> internet) {
    forced_ = internet;
    return Report();
}

bool NetworkDecision::Internet() const {
    if (forced_) return *forced_;
    return network_ != Network::None && dnsFailures_ < kDnsFailuresOffline;
}

bool NetworkDecision::DnsCheckUseful() const { return namedServer_ && network_ != Network::None; }

std::optional<bool> NetworkDecision::Report() {
    const bool now = Internet();
    if (now == reported_) return std::nullopt;
    reported_ = now;
    return now;
}

namespace {

// a.b.c.d com cada parte de 0 a 255 (de 1 a 3 digitos).
bool IsIpv4(const std::string& text) {
    int parts = 0;
    size_t i = 0;
    while (i <= text.size()) {
        size_t digits = 0;
        int value = 0;
        while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) {
            value = value * 10 + (text[i] - '0');
            ++digits;
            ++i;
            if (digits > 3) return false;
        }
        if (digits == 0 || value > 255) return false;
        ++parts;
        if (i == text.size()) break;
        if (text[i] != '.') return false;
        ++i;
    }
    return parts == 4;
}

// Um IPv6: digitos hexadecimais e ":" (com um IPv4 no fim, como em ::ffff:1.2.3.4), com pelo menos dois ":".
bool IsIpv6(const std::string& text) {
    int colons = 0;
    for (const char ch : text) {
        if (ch == ':') {
            ++colons;
        } else if (!std::isxdigit(static_cast<unsigned char>(ch)) && ch != '.') {
            return false;
        }
    }
    return colons >= 2;
}

}  // namespace

bool IsIpAddress(const std::string& server) {
    if (server.size() >= 2 && server.front() == '[' && server.back() == ']') {
        return IsIpv6(server.substr(1, server.size() - 2));
    }
    return IsIpv4(server) || IsIpv6(server);
}

}  // namespace starsonic
