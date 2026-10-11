#include "stdafx.h"
#include "Hooks.h"

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "ProfilesStore.h"
#include "lib/MSIP.h"
#include "settings.h"

namespace starsonic {

void OnSettingsLoaded() {
    const Profiles& profiles = LoadedProfiles();
    // Percorre todas as secoes [Account<i>] existentes, inclusive as que o MicroSIP nao carrega
    // (dominio vazio): parar na primeira falha de AccountLoad deixaria contas seguintes sem a trava.
    for (int i = 1;; ++i) {
        CString section;
        section.Format(L"Account%d", i);
        if (!MSIP::IniSectionExists(section, accountSettings.iniFile)) {
            break;
        }
        Account account;
        accountSettings.AccountLoad(i, &account);
        AccountFields fields = ToFields(account, ReadServerId(i));
        EnforceAccount(&fields, profiles);
        FromFields(fields, &account);
        accountSettings.AccountSave(i, &account);
    }
    GlobalFields globals = GlobalsFrom(accountSettings);
    EnforceGlobal(&globals, profiles.global);
    GlobalsTo(globals, &accountSettings);
    accountSettings.SettingsSave();
    if (accountSettings.accountId > 0) {
        accountSettings.AccountLoad(accountSettings.accountId, &accountSettings.account);
    }
}

void CheckUpdates(CmainDlg* /*main*/) {
}

void OnUpdateMessage(CmainDlg* /*main*/, WPARAM /*wParam*/, bool /*userAsked*/) {
}

}  // namespace starsonic
