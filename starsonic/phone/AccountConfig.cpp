#include "AccountConfig.h"

#include "Profile.h"
#include "Text.h"

namespace starsonic {
namespace {

int SrtpUse(const std::wstring& srtp) {
    if (srtp == L"optional") return 1;
    if (srtp == L"mandatory") return 2;
    return 0;
}

}  // namespace

PjAccountSettings ToPjAccount(const AccountFields& account) {
    const std::string transport = WideToUtf8(account.transport);
    PjAccountSettings pj;
    pj.idUri = "sip:" + WideToUtf8(account.username) + "@" + WideToUtf8(account.domain);
    pj.registrarUri = "sip:" + WideToUtf8(account.server) + ";transport=" + transport;
    if (!account.proxy.empty()) {
        pj.proxyUri = "sip:" + WideToUtf8(account.proxy) + ";lr;transport=" + transport;
    }
    pj.authUser = WideToUtf8(account.authId.empty() ? account.username : account.authId);
    pj.authPassword = WideToUtf8(account.password);
    pj.transport = transport;
    pj.srtpUse = SrtpUse(account.srtp);
    pj.udpKeepAliveSec = account.keepAlive;
    pj.regTimeoutSec = account.registerRefresh;
    return pj;
}

std::vector<std::string> CodecIds(const std::vector<std::wstring>& profileCodecs) {
    std::vector<std::string> ids;
    for (const std::wstring& name : profileCodecs) {
        const std::wstring id = CodecsToMicrosip(std::vector<std::wstring>(1, name));
        if (!id.empty()) ids.push_back(WideToUtf8(id));
    }
    return ids;
}

}  // namespace starsonic
