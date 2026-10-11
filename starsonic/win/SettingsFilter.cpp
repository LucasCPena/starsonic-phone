#include "stdafx.h"
#include "Hooks.h"

#include <vector>

#include "LayoutCollapse.h"
#include "resource.h"

namespace {

// Campos que o perfil da Starsonic trava (codecs, portas, STUN, DTMF e verificacao de versao).
const int kLockedIds[] = {
    IDC_SETTINGS_AUDIO_CODECS_ALL, IDC_SETTINGS_AUDIO_CODECS,    IDC_SETTINGS_SPIN_MODIFY,
    IDC_SETTINGS_SPIN_ORDER,       IDC_SETTINGS_HELP_AUDIO_CODECS, IDC_SETTINGS_SOURCE_PORT,
    IDC_SETTINGS_RPORT,            IDC_SETTINGS_RTP_PORT_MIN,     IDC_SETTINGS_RTP_PORT_MAX,
    IDC_SETTINGS_HELP_PORTS,       IDC_SETTINGS_STUN_CHECKBOX,    IDC_SETTINGS_STUN,
    IDC_SETTINGS_HELP_STUN_SERVER, IDC_SETTINGS_DTMF_METHOD,      IDC_SETTINGS_HELP_DTMF_METHOD,
    IDC_SETTINGS_UPDATES_INTERVAL,
};

// Coluna da direita da tela de Configuracoes (IDD_SETTINGS_OFFSET_COLUMN em res/dialog.rc2).
const int kColumnSplitDlu = 290;

bool IsLocked(int id) {
    for (int locked : kLockedIds) {
        if (locked == id) return true;
    }
    return false;
}

bool IsStaticLabel(HWND window, int id) {
    wchar_t name[32] = {0};
    GetClassName(window, name, 32);
    return wcscmp(name, L"Static") == 0 && (id == 0xFFFF || id == -1);
}

}  // namespace

namespace starsonic {

void FilterSettings(CDialog* settingsDlg) {
    std::vector<LayoutBox> boxes;
    std::vector<HWND> windows;
    for (CWnd* child = settingsDlg->GetWindow(GW_CHILD); child; child = child->GetWindow(GW_HWNDNEXT)) {
        CRect rect;
        child->GetWindowRect(&rect);
        settingsDlg->ScreenToClient(&rect);
        const int id = child->GetDlgCtrlID();
        LayoutBox box = {id, rect.left, rect.top, rect.right, rect.bottom, IsLocked(id), IsStaticLabel(child->m_hWnd, id)};
        boxes.push_back(box);
        windows.push_back(child->m_hWnd);
    }
    CRect split(0, 0, kColumnSplitDlu, 0);
    settingsDlg->MapDialogRect(&split);
    const CollapseResult result = CollapseHidden(boxes, split.right);
    for (size_t i = 0; i < windows.size(); ++i) {
        const LayoutBox& box = result.boxes[i];
        if (box.hidden) {
            ::ShowWindow(windows[i], SW_HIDE);
            ::EnableWindow(windows[i], FALSE);
        } else if (box.top != boxes[i].top) {
            ::SetWindowPos(windows[i], NULL, box.left, box.top, 0, 0, SWP_NOZORDER | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
    if (result.heightReduction > 0) {
        CRect window;
        settingsDlg->GetWindowRect(&window);
        settingsDlg->SetWindowPos(NULL, 0, 0, window.Width(), window.Height() - result.heightReduction,
                                  SWP_NOZORDER | SWP_NOMOVE | SWP_NOACTIVATE);
    }
}

}  // namespace starsonic
