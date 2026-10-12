#include "stdafx.h"
#include "Hooks.h"

#include <string>
#include <vector>

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "LoginDialog.h"
#include "ProfilesStore.h"
#include "StarsonicIds.h"
#include "Updater.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "settings.h"

namespace {

const UINT kUpdateIntervalMs = 24u * 60u * 60u * 1000u;

CStarsonicLoginDlg* g_loginDlg = nullptr;

// Nomes de todas as secoes do INI (GetPrivateProfileSectionNames).
std::vector<std::wstring> IniSectionNames(const CString& file) {
    std::vector<wchar_t> buffer(4096);
    DWORD length = 0;
    for (;;) {
        length = GetPrivateProfileSectionNamesW(buffer.data(), static_cast<DWORD>(buffer.size()), file);
        // Com o buffer pequeno demais, a funcao devolve tamanho - 2.
        if (length + 2 < buffer.size() || buffer.size() >= (1u << 22)) {
            break;
        }
        buffer.assign(buffer.size() * 2, L'\0');
    }
    std::vector<std::wstring> names;
    size_t start = 0;
    for (size_t i = 0; i < length; ++i) {
        if (buffer[i] == L'\0') {
            if (i > start) {
                names.emplace_back(&buffer[start], i - start);
            }
            start = i + 1;
        }
    }
    if (start < length) {
        names.emplace_back(&buffer[start], length - start);
    }
    return names;
}

}  // namespace

namespace starsonic {

void OnSettingsLoaded() {
    // Em /reset, /resetnoask e /exit o MicroSIP nao carrega as configuracoes (ou so repassa o
    // comando e sai): salvar aqui gravaria valores vazios por cima de tudo.
    if (!ShouldEnforceAtStartup(std::wstring(AfxGetApp()->m_lpCmdLine))) {
        return;
    }
    const Profiles& profiles = LoadedProfiles();
    // Todas as secoes [Account<n>] do INI, inclusive depois de um buraco na numeracao (o MicroSIP
    // carrega qualquer accountId) e as que ele nao carrega (dominio vazio).
    for (int i : AccountSectionNumbers(IniSectionNames(accountSettings.iniFile))) {
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

void EnforceActiveAccount() {
    // A tela Entrar montou a conta pelo perfil e so grava o servidor dela se o registro der certo.
    if (g_loginDlg && g_loginDlg->IsPending()) {
        return;
    }
    const int id = accountSettings.accountId;
    if (id <= 0) {
        return;
    }
    AccountFields fields = ToFields(accountSettings.account, ReadServerId(id));
    EnforceAccount(&fields, LoadedProfiles());
    FromFields(fields, &accountSettings.account);
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
    // A cada 24 h com o app aberto; a verificacao da abertura segue a regra do MicroSIP.
    ::SetTimer(main->m_hWnd, IDT_STARSONIC_UPDATES, kUpdateIntervalMs, UpdateTimerProc);
    if (accountSettings.accountId == 0) {
        ShowLogin(main, -1, false);
    }
}

void OnLoginDialogDestroyed(CStarsonicLoginDlg* dialog) {
    if (g_loginDlg == dialog) {
        g_loginDlg = nullptr;
    }
}

}  // namespace starsonic
