#include "stdafx.h"
#include "BrandBand.h"

#include "Hooks.h"
#include "Logo.h"
#include "StarsonicIds.h"
#include "generated/build_info.h"
#include "mainDlg.h"
#include "settings.h"

namespace {

const int kBandHeightDlu = 22;
CStarsonicBrandBand* g_band = nullptr;

UINT BandLogoResource() {
#if STARSONIC_HAS_LOGOS
    return IDR_STARSONIC_LOGO_BAND;
#else
    return 0;
#endif
}

void MoveDown(CmainDlg* main, CWnd* control, int offset) {
    CRect rect;
    control->GetWindowRect(&rect);
    main->ScreenToClient(&rect);
    control->SetWindowPos(NULL, rect.left, rect.top + offset, 0, 0, SWP_NOZORDER | SWP_NOSIZE);
}

}  // namespace

void CStarsonicBrandBand::SetStatus(const CString& text) {
    SetWindowText(text);
    Invalidate(FALSE);
}

void CStarsonicBrandBand::DrawItem(LPDRAWITEMSTRUCT drawItem) {
    CDC* dc = CDC::FromHandle(drawItem->hDC);
    CRect area(drawItem->rcItem);
    dc->FillSolidRect(&area, STARSONIC_BRAND_COLOR);

    const int margin = 8;
    const int logoHeight = (std::max)(8, area.Height() - 12);
    CRect logo(area.left + margin, area.top + (area.Height() - logoHeight) / 2, 0, 0);
    logo.bottom = logo.top + logoHeight;
    logo.right = logo.left + (std::min)(area.Width() * 2 / 5, logoHeight * 5);
    DrawLogo(dc, logo, BandLogoResource(), STARSONIC_BRAND_TEXT_COLOR, true);

    CString status;
    GetWindowText(status);
    CRect text(logo.right + margin, area.top, area.right - margin, area.bottom);
    CFont* font = GetParent() ? GetParent()->GetFont() : nullptr;
    CFont* oldFont = font ? dc->SelectObject(font) : nullptr;
    const int oldMode = dc->SetBkMode(TRANSPARENT);
    const COLORREF oldColor = dc->SetTextColor(STARSONIC_BRAND_TEXT_COLOR);
    dc->DrawText(status, &text, DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    dc->SetTextColor(oldColor);
    dc->SetBkMode(oldMode);
    if (oldFont) {
        dc->SelectObject(oldFont);
    }
}

namespace starsonic {

void InstallBrandBand(CmainDlg* main) {
    CRect dlu(0, 0, 0, kBandHeightDlu);
    main->MapDialogRect(&dlu);
    const int height = dlu.bottom;

    MoveDown(main, &main->m_mainTab, height);
    MoveDown(main, &main->m_ButtonMenu, height);

    CRect window;
    main->GetWindowRect(&window);
    main->SetWindowPos(NULL, 0, 0, window.Width(), window.Height() + height, SWP_NOZORDER | SWP_NOMOVE);

    CRect client;
    main->GetClientRect(&client);
    g_band = new CStarsonicBrandBand();
    g_band->Create(L"", WS_CHILD | WS_VISIBLE | SS_OWNERDRAW, CRect(0, 0, client.Width(), height), main,
                   IDC_STARSONIC_BAND);
    main->AutoMove(g_band->m_hWnd, 0, 0, 100, 0);
}

void OnStatusText(CmainDlg* /*main*/, const CString& text) {
    if (!g_band || !::IsWindow(g_band->m_hWnd)) {
        return;
    }
    CString status = text;
    if (accountSettings.accountId > 0 && !accountSettings.account.label.IsEmpty()) {
        status += L" \u00b7 " + accountSettings.account.label;
    }
    g_band->SetStatus(status);
}

}  // namespace starsonic
