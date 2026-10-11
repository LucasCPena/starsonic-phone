#include "stdafx.h"
#include "AccountAdapter.h"

#include "global.h"
#include "settings.h"

namespace {

const wchar_t kServerIdKey[] = L"starsonicServer";

std::wstring Wide(const CString& text) {
    return std::wstring(text.GetString(), static_cast<size_t>(text.GetLength()));
}

CString AccountSection(int accountId) {
    CString section;
    section.Format(L"Account%d", accountId);
    return section;
}

}  // namespace

starsonic::AccountFields ToFields(const Account& account, const CString& serverId) {
    starsonic::AccountFields fields;
    fields.serverId = Wide(serverId);
    fields.label = Wide(account.label);
    fields.server = Wide(account.server);
    fields.proxy = Wide(account.proxy);
    fields.domain = Wide(account.domain);
    fields.username = Wide(account.username);
    fields.authId = Wide(account.authID);
    fields.password = Wide(account.password);
    fields.displayName = Wide(account.displayName);
    fields.transport = Wide(account.transport);
    fields.srtp = Wide(account.srtp);
    fields.publicAddr = Wide(account.publicAddr);
    fields.dialingPrefix = Wide(account.dialingPrefix);
    fields.dialPlan = Wide(account.dialPlan);
    fields.hideCid = Wide(account.hideCID);
    fields.voicemailNumber = Wide(account.voicemailNumber);
    fields.registerRefresh = account.registerRefresh;
    fields.keepAlive = account.keepAlive;
    fields.publish = account.publish;
    fields.ice = account.ice;
    fields.allowRewrite = account.allowRewrite;
    fields.disableSessionTimer = account.disableSessionTimer;
    return fields;
}

void FromFields(const starsonic::AccountFields& fields, Account* account) {
    account->label = fields.label.c_str();
    account->server = fields.server.c_str();
    account->proxy = fields.proxy.c_str();
    account->domain = fields.domain.c_str();
    account->username = fields.username.c_str();
    account->authID = fields.authId.c_str();
    account->password = fields.password.c_str();
    account->displayName = fields.displayName.c_str();
    account->transport = fields.transport.c_str();
    account->srtp = fields.srtp.c_str();
    account->publicAddr = fields.publicAddr.c_str();
    account->dialingPrefix = fields.dialingPrefix.c_str();
    account->dialPlan = fields.dialPlan.c_str();
    account->hideCID = fields.hideCid.c_str();
    account->voicemailNumber = fields.voicemailNumber.c_str();
    account->registerRefresh = fields.registerRefresh;
    account->keepAlive = fields.keepAlive;
    account->publish = fields.publish;
    account->ice = fields.ice;
    account->allowRewrite = fields.allowRewrite;
    account->disableSessionTimer = fields.disableSessionTimer;
    // O AccountSave do MicroSIP so grava usuario e senha com rememberPassword ligado.
    account->rememberPassword = !fields.username.empty();
}

CString ReadServerId(int accountId) {
    wchar_t buffer[256] = {0};
    GetPrivateProfileString(AccountSection(accountId), kServerIdKey, L"", buffer, 256, accountSettings.iniFile);
    return CString(buffer);
}

void WriteServerId(int accountId, const CString& serverId) {
    WritePrivateProfileString(AccountSection(accountId), kServerIdKey,
                              serverId.IsEmpty() ? NULL : serverId.GetString(), accountSettings.iniFile);
}

starsonic::GlobalFields GlobalsFrom(const AccountSettings& settings) {
    starsonic::GlobalFields globals;
    globals.audioCodecs = Wide(settings.audioCodecs);
    globals.stun = Wide(settings.stun);
    globals.updatesInterval = Wide(settings.updatesInterval);
    globals.enableStun = settings.enableSTUN;
    globals.rport = settings.rport;
    globals.dtmfMethod = settings.DTMFMethod;
    globals.sourcePort = settings.sourcePort;
    globals.rtpPortMin = settings.rtpPortMin;
    globals.rtpPortMax = settings.rtpPortMax;
    return globals;
}

void GlobalsTo(const starsonic::GlobalFields& globals, AccountSettings* settings) {
    settings->audioCodecs = globals.audioCodecs.c_str();
    settings->stun = globals.stun.c_str();
    settings->updatesInterval = globals.updatesInterval.c_str();
    settings->enableSTUN = globals.enableStun;
    settings->rport = globals.rport;
    settings->DTMFMethod = globals.dtmfMethod;
    settings->sourcePort = globals.sourcePort;
    settings->rtpPortMin = globals.rtpPortMin;
    settings->rtpPortMax = globals.rtpPortMax;
}
