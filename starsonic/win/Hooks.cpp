#include "stdafx.h"
#include "Hooks.h"

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "LoginDialog.h"
#include "ProfilesStore.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "settings.h"

namespace {

CStarsonicLoginDlg* g_loginDlg = nullptr;

}  // namespace

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

void ShowLogin(CmainDlg* main, int accountId, bool focusPassword) {
    // Com a tela ja aberta (com login pendente ou mostrando um erro), so traz para a frente:
    // depois de um 401/403 o proprio MicroSIP pede a tela de conta de novo (UM_ON_ACCOUNT),
    // e recarregar apagaria a mensagem e o ramal digitado.
    if (g_loginDlg) {
        g_loginDlg->SetForegroundWindow();
        return;
    }
    g_loginDlg = new CStarsonicLoginDlg(main);
    g_loginDlg->Load(accountId, focusPassword);
}

void OnRegistrationState(CmainDlg* /*main*/, int sipCode) {
    if (g_loginDlg && g_loginDlg->IsPending()) {
        g_loginDlg->OnRegistrationState(sipCode);
    }
}

void OnMainWindowCreated(CmainDlg* main) {
    if (accountSettings.accountId == 0) {
        ShowLogin(main, -1, false);
    }
}

void OnLoginDialogDestroyed(CStarsonicLoginDlg* dialog) {
    if (g_loginDlg == dialog) {
        g_loginDlg = nullptr;
    }
}

void CheckUpdates(CmainDlg* /*main*/) {
}

void OnUpdateMessage(CmainDlg* /*main*/, WPARAM /*wParam*/, bool /*userAsked*/) {
}

}  // namespace starsonic
