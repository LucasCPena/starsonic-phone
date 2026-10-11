#include "stdafx.h"
#include "AboutDialog.h"

#include "Hooks.h"
#include "Logo.h"
#include "StarsonicIds.h"
#include "generated/build_info.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "resource.h"

namespace {

// Atribuicao exigida pela GPL; o verificador de marca aceita "Baseado no MicroSIP".
const wchar_t kAttribution[] = L"Baseado no MicroSIP \u2014 software livre sob a GNU GPL v3 \u2014 c\u00f3digo-fonte: ";

UINT AboutLogoResource() {
#if STARSONIC_HAS_LOGOS
    return IDR_STARSONIC_LOGO_LOGIN;
#else
    return 0;
#endif
}

CString Link(const CString& url, const CString& text) {
    CString link;
    link.Format(L"<a href=\"%s\">%s</a>", url.GetString(), text.GetString());
    return link;
}

}  // namespace

BEGIN_MESSAGE_MAP(CStarsonicAboutDlg, CThemeDialog)
    ON_WM_DRAWITEM()
    ON_NOTIFY(NM_CLICK, IDC_SS_ABOUT_LINKS, &CStarsonicAboutDlg::OnClickLink)
    ON_NOTIFY(NM_RETURN, IDC_SS_ABOUT_LINKS, &CStarsonicAboutDlg::OnClickLink)
    ON_NOTIFY(NM_CLICK, IDC_SS_ABOUT_LICENSE, &CStarsonicAboutDlg::OnClickLink)
    ON_NOTIFY(NM_RETURN, IDC_SS_ABOUT_LICENSE, &CStarsonicAboutDlg::OnClickLink)
END_MESSAGE_MAP()

CStarsonicAboutDlg::CStarsonicAboutDlg(CWnd* parent) : CThemeDialog(IDD_STARSONIC_ABOUT, parent) {
}

BOOL CStarsonicAboutDlg::OnInitDialog() {
    m_bAllowDark = true;
    CThemeDialog::OnInitDialog();
    SetWindowText(L"Sobre o Starsonic Phone");

    CString version;
    version.Format(L"Starsonic Phone %s (baseado no MicroSIP %s)", _T(STARSONIC_VERSION), _T(STARSONIC_UPSTREAM_VERSION));
    SetDlgItemText(IDC_SS_ABOUT_VERSION, version);

    CString links = Link(_T(STARSONIC_URL_SITE), L"starsonic.com.br") + L" \u00b7 " +
                    Link(_T(STARSONIC_URL_SUPPORT), L"WhatsApp") + L" \u00b7 " + _T(STARSONIC_PHONE_SUPPORT);
    SetDlgItemText(IDC_SS_ABOUT_LINKS, links);

    CString license = CString(kAttribution) + Link(_T(STARSONIC_REPO_URL), _T(STARSONIC_REPO_URL));
    SetDlgItemText(IDC_SS_ABOUT_LICENSE, license);
    SetDlgItemText(IDOK, L"Fechar");
    return TRUE;
}

void CStarsonicAboutDlg::OnDrawItem(int idCtl, LPDRAWITEMSTRUCT drawItem) {
    if (idCtl != IDC_SS_ABOUT_LOGO) {
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
    DrawLogo(dc, area, AboutLogoResource(), STARSONIC_BRAND_COLOR);
}

void CStarsonicAboutDlg::OnClickLink(NMHDR* header, LRESULT* result) {
    PNMLINK link = reinterpret_cast<PNMLINK>(header);
    if (link->item.szUrl[0]) {
        MSIP::OpenURL(link->item.szUrl);
    }
    *result = 0;
}

namespace starsonic {

void AddMenuItems(CMenu* menu) {
    menu->AppendMenu(MF_STRING, ID_CUSTOM_RANGE, L"Sobre o Starsonic Phone");
}

void OnCustomMenu(CmainDlg* main, UINT id) {
    if (id == ID_CUSTOM_RANGE) {
        CStarsonicAboutDlg dialog(main);
        dialog.DoModal();
    }
}

}  // namespace starsonic
