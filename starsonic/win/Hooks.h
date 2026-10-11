#pragma once
// Pontos de entrada chamados pelas edicoes E1-E13 no codigo do MicroSIP.
#include <windows.h>

class CmainDlg;

namespace starsonic {

// E4 (microsip.cpp, logo depois de accountSettings.Init()): reaplica os perfis embutidos
// em todas as contas e trava as configuracoes globais.
void OnSettingsLoaded();

// E12: substituem o verificador de versao do MicroSIP (que consultava update.microsip.org).
// O atualizador da Starsonic entra na Task 14; ate la, nao ha verificacao.
void CheckUpdates(CmainDlg* main);
void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool userAsked);

}  // namespace starsonic
