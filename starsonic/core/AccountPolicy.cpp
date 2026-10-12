#include "AccountPolicy.h"

#include <algorithm>

#include "Text.h"

namespace starsonic {
namespace {

const int kRegisterRefreshSeconds = 300;

const wchar_t* TransportName(Transport transport) {
    switch (transport) {
        case Transport::Udp: return L"udp";
        case Transport::Tcp: return L"tcp";
        case Transport::Tls: return L"tls";
    }
    return L"udp";
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

AccountFields BuildAccount(const ServerProfile& server, const std::wstring& ramal, const std::wstring& senha) {
    AccountFields account;
    account.serverId = server.id;
    account.label = ramal + L" \u00b7 " + server.name;
    account.server = server.host + L":" + std::to_wstring(server.port);
    account.proxy = server.proxy;
    account.domain = server.domain;
    account.username = ramal;
    account.password = senha;
    account.displayName = ramal;
    account.transport = TransportName(server.transport);
    account.srtp = SrtpName(server.srtp);
    account.registerRefresh = kRegisterRefreshSeconds;
    account.keepAlive = server.keepAliveSeconds;
    return account;
}

bool EnforceAccount(AccountFields* account, const Profiles& profiles) {
    const ServerProfile* server = FindServer(profiles, account->serverId);
    if (!server) {
        account->username.clear();
        account->password.clear();
        account->server.clear();
        account->domain.clear();
        account->proxy.clear();
        return false;
    }
    AccountFields locked = BuildAccount(*server, account->username, account->password);
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
