#pragma once
// Tela Sobre: versao, contatos da Starsonic e atribuicao ao MicroSIP (GPL v3).
#include "ThemeDialog.h"

class CStarsonicAboutDlg : public CThemeDialog {
public:
    explicit CStarsonicAboutDlg(CWnd* parent);   // modal (DoModal)

protected:
    virtual BOOL OnInitDialog();
    afx_msg void OnDrawItem(int idCtl, LPDRAWITEMSTRUCT drawItem);
    afx_msg void OnClickLink(NMHDR* header, LRESULT* result);
    DECLARE_MESSAGE_MAP()
};
