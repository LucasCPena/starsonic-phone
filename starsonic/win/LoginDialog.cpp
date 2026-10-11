#include "stdafx.h"
#include "LoginDialog.h"

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "Hooks.h"
#include "Logo.h"
#include "ProfilesStore.h"
#include "StarsonicIds.h"
#include "generated/build_info.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "settings.h"

namespace {

const UINT kLoginTimeoutMs = 15000;
const COLORREF kErrorColor = RGB(0xD3, 0x2F, 0x2F);
const COLORREF kNeutralColor = RGB(0x80, 0x80, 0x80);
// Faixa dos erros de TLS do pjlib (pj/errno.h; a constante PJ_SSL_ERRNO_START e privada do ssl_sock_ossl.c).
const pj_status_t kSslErrnoStart = PJ_ERRNO_START_USER + PJ_ERRNO_SPACE_SIZE * 6;

std::wstring Wide(const CString& text) {
    return std::wstring(text.GetString(), static_cast<size_t>(text.GetLength()));
}

UINT LoginLogoResource() {
#if STARSONIC_HAS_LOGOS
    return IDR_STARSONIC_LOGO_LOGIN;
#else
    return 0;
#endif
}

}  // namespace

BEGIN_MESSAGE_MAP(CStarsonicLoginDlg, CThemeDialog)
    ON_WM_CLOSE()
    ON_WM_TIMER()
    ON_WM_DRAWITEM()
    ON_WM_CTLCOLOR()
    ON_BN_CLICKED(IDC_SS_ENTRAR, &CStarsonicLoginDlg::OnClickedEntrar)
    ON_NOTIFY(NM_CLICK, IDC_SS_REMOVE, &CStarsonicLoginDlg::OnClickedRemove)
    ON_NOTIFY(NM_RETURN, IDC_SS_REMOVE, &CStarsonicLoginDlg::OnClickedRemove)
END_MESSAGE_MAP()

CStarsonicLoginDlg::CStarsonicLoginDlg(CmainDlg* main)
    : CThemeDialog(IDD_STARSONIC_LOGIN, main), main_(main) {
    if (!Create(IDD_STARSONIC_LOGIN, main)) {
        AfxMessageBox(L"N\u00e3o foi poss\u00edvel abrir a tela Entrar.");
        exit(0);
    }
}

void CStarsonicLoginDlg::DoDataExchange(CDataExchange* pDX) {
    CThemeDialog::DoDataExchange(pDX);
    DDX_Control(pDX, IDC_SS_ENTRAR, entrar_);
}

BOOL CStarsonicLoginDlg::OnInitDialog() {
    m_bAllowDark = true;
    CThemeDialog::OnInitDialog();

    SetWindowText(L"Starsonic Phone \u2014 Entrar");
    SetDlgItemText(IDC_SS_ENTRAR, L"Entrar");
    SetDlgItemText(IDC_SS_REMOVE, L"<a>Remover conta</a>");
    SetDlgItemText(IDC_SS_HELP, L"Precisa de ajuda? " _T(STARSONIC_PHONE_SUPPORT));

    entrar_.m_FaceColor = STARSONIC_BRAND_COLOR;
    entrar_.m_TextColor = STARSONIC_BRAND_TEXT_COLOR;
    entrar_.EnableWindow(TRUE);

    CComboBox* servers = static_cast<CComboBox*>(GetDlgItem(IDC_SS_SERVER));
    for (const starsonic::ServerProfile& server : LoadedProfiles().servers) {
        servers->AddString(server.name.c_str());
    }
    servers->SetCurSel(0);
    return TRUE;
}

void CStarsonicLoginDlg::PostNcDestroy() {
    CThemeDialog::PostNcDestroy();
    starsonic::OnLoginDialogDestroyed(this);
    delete this;
}

bool CStarsonicLoginDlg::IsPending() const {
    return flow_.State() == starsonic::LoginState::Pending;
}

void CStarsonicLoginDlg::Load(int accountId, bool focusPassword) {
    if (IsPending()) {
        SetForegroundWindow();
        return;
    }
    accountId_ = accountId;
    const std::vector<starsonic::ServerProfile>& servers = LoadedProfiles().servers;
    int index = 0;
    CString ramal;
    CString message;
    if (accountId > 0) {
        Account stored;
        accountSettings.AccountLoad(accountId, &stored);
        ramal = stored.username;
        const std::wstring serverId = Wide(ReadServerId(accountId));
        int found = -1;
        for (size_t i = 0; i < servers.size(); ++i) {
            if (servers[i].id == serverId) {
                found = static_cast<int>(i);
                break;
            }
        }
        if (found >= 0) {
            index = found;
        } else {
            message = L"O servidor desta conta mudou. Entre novamente.";
        }
    }
    static_cast<CComboBox*>(GetDlgItem(IDC_SS_SERVER))->SetCurSel(index);
    SetDlgItemText(IDC_SS_RAMAL, ramal);
    SetDlgItemText(IDC_SS_SENHA, L"");
    ShowMessage(message, true);
    GetDlgItem(IDC_SS_REMOVE)->ShowWindow(accountId > 0 ? SW_SHOW : SW_HIDE);
    SetFieldsEnabled(true);
    ShowWindow(SW_SHOW);
    SetForegroundWindow();
    const bool password = focusPassword || !ramal.IsEmpty();
    GotoDlgCtrl(GetDlgItem(password ? IDC_SS_SENHA : IDC_SS_RAMAL));
}

void CStarsonicLoginDlg::OnOK() {
    OnClickedEntrar();
}

void CStarsonicLoginDlg::OnCancel() {
    OnClose();
}

void CStarsonicLoginDlg::OnClose() {
    if (IsPending()) {
        Apply(flow_.OnTimeout());   // fechar no meio da tentativa desfaz a troca de conta
    }
    DestroyWindow();
}

void CStarsonicLoginDlg::OnClickedEntrar() {
    if (IsPending()) {
        return;
    }
    CString ramalText;
    GetDlgItemText(IDC_SS_RAMAL, ramalText);
    std::wstring ramal;
    if (starsonic::ValidateRamal(Wide(ramalText), &ramal) != starsonic::RamalCheck::Ok) {
        ShowMessage(L"Digite s\u00f3 o n\u00famero do ramal.", true);
        GotoDlgCtrl(GetDlgItem(IDC_SS_RAMAL));
        return;
    }
    CString senha;
    GetDlgItemText(IDC_SS_SENHA, senha);
    if (senha.IsEmpty()) {
        ShowMessage(L"Digite a senha.", true);
        GotoDlgCtrl(GetDlgItem(IDC_SS_SENHA));
        return;
    }
    const std::vector<starsonic::ServerProfile>& servers = LoadedProfiles().servers;
    int index = static_cast<CComboBox*>(GetDlgItem(IDC_SS_SERVER))->GetCurSel();
    if (index < 0 || index >= static_cast<int>(servers.size())) {
        index = 0;
    }
    const starsonic::ServerProfile& server = servers[index];

    prevId_ = accountSettings.accountId;
    prevAccount_ = accountSettings.account;
    targetId_ = accountId_ > 0 ? accountId_ : FirstFreeAccountId();
    targetServerId_ = server.id.c_str();

    flow_.Start();
    main_->PJAccountDelete(true);
    accountSettings.accountId = targetId_;
    FromFields(starsonic::BuildAccount(server, ramal, Wide(senha)), &accountSettings.account);
    main_->OnAccountChanged();
    main_->InitUI();
    SetFieldsEnabled(false);
    ShowMessage(L"Conectando\u2026", false);
    SetTimer(IDT_STARSONIC_LOGIN, kLoginTimeoutMs, NULL);
    main_->PJAccountAdd();
}

void CStarsonicLoginDlg::OnRegistrationState(int sipCode) {
    if (!IsPending() || !pjsua_acc_is_valid(account)) {
        return;
    }
    pjsua_acc_info info;
    if (pjsua_acc_get_info(account, &info) != PJ_SUCCESS) {
        return;
    }
    if (static_cast<int>(info.status) != sipCode) {
        return;   // resultado de outra conta (ex.: a anterior), ainda na fila
    }
    const bool tlsFailure = info.reg_last_err >= kSslErrnoStart &&
                            info.reg_last_err < kSslErrnoStart + PJ_ERRNO_SPACE_SIZE;
    Apply(flow_.OnRegistration(sipCode, tlsFailure));
}

void CStarsonicLoginDlg::OnTimer(UINT_PTR idEvent) {
    if (idEvent == IDT_STARSONIC_LOGIN) {
        KillTimer(IDT_STARSONIC_LOGIN);
        Apply(flow_.OnTimeout());
        return;
    }
    CThemeDialog::OnTimer(idEvent);
}

void CStarsonicLoginDlg::Apply(const starsonic::LoginOutcome& outcome) {
    if (outcome.commit) {
        KillTimer(IDT_STARSONIC_LOGIN);
        accountSettings.AccountSave(targetId_, &accountSettings.account);
        WriteServerId(targetId_, targetServerId_);
        accountSettings.SettingsSave();
        main_->OnAccountChanged();
        DestroyWindow();
        return;
    }
    if (outcome.rollback) {
        KillTimer(IDT_STARSONIC_LOGIN);
        main_->PJAccountDelete(true);
        accountSettings.accountId = prevId_;
        accountSettings.account = prevAccount_;
        main_->OnAccountChanged();
        main_->InitUI();
        // Sem usuario, PJAccountAdd so reabriria esta tela; nada a registrar.
        if (prevId_ > 0 && !prevAccount_.username.IsEmpty()) {
            main_->PJAccountAdd();
        }
        SetFieldsEnabled(true);
        ShowMessage(outcome.message.c_str(), true);
        GotoDlgCtrl(GetDlgItem(IDC_SS_SENHA));
    }
}

void CStarsonicLoginDlg::OnClickedRemove(NMHDR* /*header*/, LRESULT* result) {
    *result = 0;
    if (accountId_ <= 0 || IsPending()) {
        return;
    }
    if (AfxMessageBox(L"Remover esta conta?", MB_YESNO | MB_ICONQUESTION) != IDYES) {
        return;
    }
    RemoveAccount();
}

void CStarsonicLoginDlg::RemoveAccount() {
    // Como em AccountDlg::OnNMClickSyslinkDelete: as contas seguintes descem uma posicao,
    // levando junto o servidor (starsonicServer).
    const int removed = accountId_;
    int last = removed;
    for (;;) {
        CString next;
        next.Format(L"Account%d", last + 1);
        if (!MSIP::IniSectionExists(next, accountSettings.iniFile)) {
            break;
        }
        Account moved;
        accountSettings.AccountLoad(last + 1, &moved);
        accountSettings.AccountSave(last, &moved);
        WriteServerId(last, ReadServerId(last + 1));
        ++last;
    }
    accountSettings.AccountDelete(last);
    const bool othersRemain = last > 1;
    const bool wasActive = accountSettings.accountId == removed;
    if (accountSettings.accountId > removed) {
        accountSettings.accountId--;
        accountSettings.SettingsSave();
    }
    CmainDlg* main = main_;
    if (othersRemain) {
        DestroyWindow();   // a partir daqui, so variaveis locais
    }
    if (wasActive) {
        main->PJAccountDelete(true);
        if (othersRemain) {
            accountSettings.accountId = 1;
            accountSettings.AccountLoad(accountSettings.accountId, &accountSettings.account);
            main->OnAccountChanged();
            main->InitUI();
            main->PJAccountAdd();
        } else {
            accountSettings.accountId = 0;
            main->OnAccountChanged();
            main->InitUI();
        }
        accountSettings.SettingsSave();
    }
    if (!othersRemain) {
        Load(-1, false);
    }
}

int CStarsonicLoginDlg::FirstFreeAccountId() {
    Account dummy;
    int id = 1;
    while (accountSettings.AccountLoad(id, &dummy)) {
        ++id;
    }
    return id;
}

void CStarsonicLoginDlg::ShowMessage(const CString& text, bool isError) {
    messageIsError_ = isError;
    SetDlgItemText(IDC_SS_MESSAGE, text);
    GetDlgItem(IDC_SS_MESSAGE)->Invalidate();
}

void CStarsonicLoginDlg::SetFieldsEnabled(bool enabled) {
    GetDlgItem(IDC_SS_SERVER)->EnableWindow(enabled);
    GetDlgItem(IDC_SS_RAMAL)->EnableWindow(enabled);
    GetDlgItem(IDC_SS_SENHA)->EnableWindow(enabled);
    GetDlgItem(IDC_SS_REMOVE)->EnableWindow(enabled);
    entrar_.EnableWindow(enabled);
}

HBRUSH CStarsonicLoginDlg::OnCtlColor(CDC* dc, CWnd* wnd, UINT ctlColor) {
    HBRUSH brush = CThemeDialog::OnCtlColor(dc, wnd, ctlColor);
    if (wnd && wnd->GetDlgCtrlID() == IDC_SS_MESSAGE) {
        dc->SetTextColor(messageIsError_ ? kErrorColor : kNeutralColor);
    }
    return brush;
}

void CStarsonicLoginDlg::OnDrawItem(int idCtl, LPDRAWITEMSTRUCT drawItem) {
    if (idCtl != IDC_SS_LOGO) {
        CThemeDialog::OnDrawItem(idCtl, drawItem);
        return;
    }
    CDC* dc = CDC::FromHandle(drawItem->hDC);
    CRect area(drawItem->rcItem);
    HBRUSH background = reinterpret_cast<HBRUSH>(SendMessage(WM_CTLCOLORDLG, reinterpret_cast<WPARAM>(drawItem->hDC),
                                                             reinterpret_cast<LPARAM>(m_hWnd)));
    if (background) {
        FillRect(drawItem->hDC, &area, background);
    }
    DrawLogo(dc, area, LoginLogoResource(), STARSONIC_BRAND_COLOR);
}
