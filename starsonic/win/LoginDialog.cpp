#include "stdafx.h"
#include "LoginDialog.h"

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "Hooks.h"
#include "Logo.h"
#include "ProfileStore.h"
#include "StarsonicIds.h"
#include "TlsWatch.h"
#include "generated/build_info.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "settings.h"

namespace {

const UINT kLoginTimeoutMs = 15000;
const COLORREF kErrorColor = RGB(0xD3, 0x2F, 0x2F);
const COLORREF kNeutralColor = RGB(0x80, 0x80, 0x80);

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

    SetDlgItemText(IDC_SS_SERVER_LABEL, L"Servidor (endere\u00e7o ou IP)");
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
    CString server;
    CString ramal;
    if (accountId > 0) {
        Account stored;
        accountSettings.AccountLoad(accountId, &stored);
        server = starsonic::AddressFromServer(Wide(stored.server)).c_str();
        ramal = stored.username;
    }
    SetDlgItemText(IDC_SS_SERVER, server);
    SetDlgItemText(IDC_SS_RAMAL, ramal);
    SetDlgItemText(IDC_SS_SENHA, L"");
    ShowMessage(L"", true);
    GetDlgItem(IDC_SS_REMOVE)->ShowWindow(accountId > 0 ? SW_SHOW : SW_HIDE);
    SetFieldsEnabled(true);
    ShowWindow(SW_SHOW);
    SetForegroundWindow();
    // Senha quando o servidor a recusou; senao, o primeiro campo vazio.
    int focus = IDC_SS_SENHA;
    if (!focusPassword) {
        if (server.IsEmpty()) {
            focus = IDC_SS_SERVER;
        } else if (ramal.IsEmpty()) {
            focus = IDC_SS_RAMAL;
        }
    }
    GotoDlgCtrl(GetDlgItem(focus));
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
    CString serverText;
    GetDlgItemText(IDC_SS_SERVER, serverText);
    std::wstring address;
    const starsonic::ServerCheck serverCheck = starsonic::ValidateServerAddress(Wide(serverText), &address);
    if (serverCheck != starsonic::ServerCheck::Ok) {
        ShowMessage(serverCheck == starsonic::ServerCheck::Empty
                        ? L"Digite o endere\u00e7o do servidor."
                        : L"Digite s\u00f3 o endere\u00e7o do servidor, como starcloud1-starsonic.com.br.",
                    true);
        GotoDlgCtrl(GetDlgItem(IDC_SS_SERVER));
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

    prevId_ = accountSettings.accountId;
    prevAccount_ = accountSettings.account;
    targetId_ = accountId_ > 0 ? accountId_ : FirstFreeAccountId();

    flow_.Start();
    main_->PJAccountDelete(true);
    accountSettings.accountId = targetId_;
    FromFields(starsonic::BuildAccount(LoadedProfile().account, address, ramal, Wide(senha),
                                       LoadedProfile().account.transport, L""),
               &accountSettings.account);
    main_->OnAccountChanged();
    main_->InitUI();
    SetFieldsEnabled(false);
    ShowMessage(L"Conectando\u2026", false);
    SetTimer(IDT_STARSONIC_LOGIN, kLoginTimeoutMs, NULL);
    WatchTlsFailures();
    tlsFailuresAtStart_ = TlsFailureCount();
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
    // Falha de TLS no handshake chega como 503 com reg_last_err = PJ_SUCCESS: vale o contador.
    const bool tlsFailure = IsTlsError(info.reg_last_err) || TlsFailureCount() != tlsFailuresAtStart_;
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
    // Como em AccountDlg::OnNMClickSyslinkDelete: as contas seguintes descem uma posicao.
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
