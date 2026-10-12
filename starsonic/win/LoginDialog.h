#pragma once
// Tela Entrar (spec 7.1): servidor + ramal + senha. Usada no primeiro acesso, em
// Contas > Adicionar/Editar e quando o servidor recusa a senha.
#include "ButtonEx.h"
#include "LoginFlow.h"
#include "ThemeDialog.h"
#include "global.h"

class CmainDlg;

class CStarsonicLoginDlg : public CThemeDialog {
public:
    explicit CStarsonicLoginDlg(CmainDlg* main);   // modeless (Create(IDD_STARSONIC_LOGIN))

    void Load(int accountId, bool focusPassword);   // -1 = nova conta
    bool IsPending() const;
    void OnRegistrationState(int sipCode);

protected:
    virtual void DoDataExchange(CDataExchange* pDX);
    virtual BOOL OnInitDialog();
    virtual void PostNcDestroy();
    virtual void OnOK();
    virtual void OnCancel();
    afx_msg void OnClose();
    afx_msg void OnTimer(UINT_PTR idEvent);
    afx_msg void OnDrawItem(int idCtl, LPDRAWITEMSTRUCT drawItem);
    afx_msg HBRUSH OnCtlColor(CDC* dc, CWnd* wnd, UINT ctlColor);
    afx_msg void OnClickedEntrar();
    afx_msg void OnClickedRemove(NMHDR* header, LRESULT* result);
    DECLARE_MESSAGE_MAP()

private:
    void ShowMessage(const CString& text, bool isError);
    void SetFieldsEnabled(bool enabled);
    void Apply(const starsonic::LoginOutcome& outcome);
    void RemoveAccount();
    static int FirstFreeAccountId();

    CmainDlg* main_;
    CButtonEx entrar_;
    starsonic::LoginFlow flow_;
    int accountId_ = -1;      // conta editada; -1 = nova
    int targetId_ = 0;        // conta sendo registrada
    CString targetServerId_;
    int prevId_ = 0;          // conta ativa antes de Entrar (volta se falhar)
    Account prevAccount_;
    bool messageIsError_ = false;
    unsigned long tlsFailuresAtStart_ = 0;   // TlsFailureCount() no comeco da tentativa
};
