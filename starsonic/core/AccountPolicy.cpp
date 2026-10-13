#include "AccountPolicy.h"

#include <algorithm>

#include "Text.h"

namespace starsonic {
namespace {

const int kRegisterRefreshSeconds = 300;

const wchar_t kLabelSeparator[] = L" \u00b7 ";

const wchar_t* TransportName(Transport transport) {
    return transport == Transport::Tcp ? L"tcp" : L"udp";
}

bool IsHighSurrogate(wchar_t ch) {
    return ch >= 0xD800 && ch <= 0xDBFF;
}

const wchar_t* SrtpName(SrtpMode srtp) {
    switch (srtp) {
        case SrtpMode::Disabled: return L"";
        case SrtpMode::Optional: return L"optional";
        case SrtpMode::Mandatory: return L"mandatory";
    }
    return L"";
}

bool IsForbiddenInRamal(wchar_t ch) {
    return ch == L'@' || ch == L':' || ch == L' ' || ch == L'\t' || ch < 0x20 || (ch >= 0x7F && ch <= 0x9F);
}

// Endereço do servidor (spec 7.1): nome de host em minúsculas, com IPv4 incluído.
const size_t kMaxAddressLength = 253;
const size_t kMaxLabelLength = 63;

bool IsLabelChar(wchar_t ch) {
    return (ch >= L'a' && ch <= L'z') || (ch >= L'0' && ch <= L'9') || ch == L'-';
}

}  // namespace

RamalCheck ValidateRamal(const std::wstring& raw, std::wstring* normalized) {
    const std::wstring ramal = Trim(raw);
    if (ramal.empty()) return RamalCheck::Empty;
    for (wchar_t ch : ramal) {
        if (IsForbiddenInRamal(ch)) return RamalCheck::Invalid;
    }
    if (normalized) *normalized = ramal;
    return RamalCheck::Ok;
}

ServerCheck ValidateServerAddress(const std::wstring& raw, std::wstring* normalized) {
    std::wstring address = Trim(raw);
    if (address.empty()) return ServerCheck::Empty;
    for (wchar_t& ch : address) {
        if (ch >= L'A' && ch <= L'Z') ch = static_cast<wchar_t>(ch - L'A' + L'a');
    }
    if (address.size() > kMaxAddressLength) return ServerCheck::Invalid;
    size_t start = 0;
    for (;;) {
        const size_t dot = address.find(L'.', start);
        const size_t end = (dot == std::wstring::npos) ? address.size() : dot;
        const size_t length = end - start;
        if (length == 0 || length > kMaxLabelLength) return ServerCheck::Invalid;
        if (address[start] == L'-' || address[end - 1] == L'-') return ServerCheck::Invalid;
        for (size_t i = start; i < end; ++i) {
            if (!IsLabelChar(address[i])) return ServerCheck::Invalid;
        }
        if (dot == std::wstring::npos) break;
        start = dot + 1;
    }
    if (normalized) *normalized = address;
    return ServerCheck::Ok;
}

std::wstring AddressFromServer(const std::wstring& server) {
    const size_t colon = server.rfind(L':');
    if (colon == std::wstring::npos) return server;
    const size_t digits = server.size() - colon - 1;
    if (digits < 1 || digits > 5) return server;
    for (size_t i = colon + 1; i < server.size(); ++i) {
        if (server[i] < L'0' || server[i] > L'9') return server;
    }
    return server.substr(0, colon);
}

std::wstring NormalizeAccountName(const std::wstring& raw) {
    std::wstring name = Trim(raw);
    if (name.size() > kMaxAccountNameLength) {
        size_t keep = kMaxAccountNameLength;
        if (IsHighSurrogate(name[keep - 1])) --keep;
        name.resize(keep);
    }
    return name;
}

std::wstring AccountNameFromLabel(const std::wstring& label) {
    const std::wstring trimmed = Trim(label);
    const std::wstring separator = kLabelSeparator;
    const size_t at = trimmed.find(separator);
    if (at != std::wstring::npos &&
        ValidateRamal(trimmed.substr(0, at), nullptr) == RamalCheck::Ok &&
        ValidateServerAddress(trimmed.substr(at + separator.size()), nullptr) == ServerCheck::Ok) {
        return L"";
    }
    return NormalizeAccountName(trimmed);
}

Transport TransportFromName(const std::wstring& name, Transport fallback) {
    std::wstring lower = Trim(name);
    for (wchar_t& ch : lower) {
        if (ch >= L'A' && ch <= L'Z') ch = static_cast<wchar_t>(ch - L'A' + L'a');
    }
    if (lower == L"udp") return Transport::Udp;
    if (lower == L"tcp") return Transport::Tcp;
    return fallback;
}

AccountFields BuildAccount(const AccountProfile& profile, const std::wstring& address, const std::wstring& ramal,
                           const std::wstring& senha, Transport transport, const std::wstring& accountName) {
    AccountFields account;
    const std::wstring name = NormalizeAccountName(accountName);
    account.label = name.empty() ? ramal + kLabelSeparator + address : name;
    account.server = address + L":" + std::to_wstring(profile.port);
    account.proxy = profile.proxy;
    account.domain = address;
    account.username = ramal;
    account.password = senha;
    account.displayName = ramal;
    account.transport = TransportName(transport);
    account.srtp = SrtpName(profile.srtp);
    account.registerRefresh = kRegisterRefreshSeconds;
    account.keepAlive = profile.keepAliveSeconds;
    return account;
}

bool EnforceAccount(AccountFields* account, const AccountProfile& profile) {
    std::wstring address;
    if (ValidateServerAddress(AddressFromServer(account->server), &address) != ServerCheck::Ok) {
        account->username.clear();
        account->password.clear();
        account->server.clear();
        account->domain.clear();
        account->proxy.clear();
        return false;
    }
    AccountFields locked = BuildAccount(profile, address, account->username, account->password,
                                        TransportFromName(account->transport, profile.transport),
                                        AccountNameFromLabel(account->label));
    locked.authId = account->authId;
    locked.displayName = account->displayName;
    *account = locked;
    return true;
}

void EnforceGlobal(GlobalFields* globals, const GlobalProfile& profile) {
    globals->audioCodecs = CodecsToMicrosip(profile.codecs);
    globals->stun = profile.stun;
    globals->enableStun = !profile.stun.empty();
    globals->dtmfMethod = static_cast<int>(profile.dtmf);
    globals->sourcePort = 0;
    globals->rtpPortMin = 0;
    globals->rtpPortMax = 0;
    globals->rport = true;
    globals->updatesInterval = L"daily";
}

std::vector<int> AccountSectionNumbers(const std::vector<std::wstring>& sectionNames) {
    static const wchar_t kPrefix[] = L"account";
    const size_t prefixLength = sizeof(kPrefix) / sizeof(kPrefix[0]) - 1;
    std::vector<int> numbers;
    for (const std::wstring& name : sectionNames) {
        if (name.size() <= prefixLength || name.size() > prefixLength + 9) {
            continue;
        }
        bool prefixMatches = true;
        for (size_t i = 0; i < prefixLength && prefixMatches; ++i) {
            const wchar_t ch = name[i];
            const wchar_t lower = (ch >= L'A' && ch <= L'Z') ? static_cast<wchar_t>(ch - L'A' + L'a') : ch;
            prefixMatches = lower == kPrefix[i];
        }
        if (!prefixMatches || name[prefixLength] == L'0') {
            continue;   // "Account01" não é a seção que o MicroSIP lê para a conta 1
        }
        int number = 0;
        bool digits = true;
        for (size_t i = prefixLength; i < name.size() && digits; ++i) {
            digits = name[i] >= L'0' && name[i] <= L'9';
            if (digits) {
                number = number * 10 + (name[i] - L'0');
            }
        }
        if (digits && number >= 1) {
            numbers.push_back(number);
        }
    }
    std::sort(numbers.begin(), numbers.end());
    numbers.erase(std::unique(numbers.begin(), numbers.end()), numbers.end());
    return numbers;
}

bool ShouldEnforceAtStartup(const std::wstring& commandLine) {
    return commandLine != L"/reset" && commandLine != L"/resetnoask" && commandLine != L"/exit";
}

}  // namespace starsonic
