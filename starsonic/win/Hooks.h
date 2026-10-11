#pragma once
// Pontos de entrada chamados pelas edicoes E1-E13 no codigo do MicroSIP.
#include <windows.h>

class CmainDlg;
class CStarsonicLoginDlg;

namespace starsonic {

// E4 (microsip.cpp, logo depois de accountSettings.Init()): reaplica os perfis embutidos
// em todas as contas e trava as configuracoes globais.
void OnSettingsLoaded();

// E8: Contas > Adicionar/Editar e o OnAccount do MicroSIP abrem a tela Entrar.
// Com a tela ja aberta, so a traz para a frente.
void ShowLogin(CmainDlg* main, int accountId, bool focusPassword);

// E9 (onRegState2): repassa o resultado do registro para a tela Entrar, se houver login pendente.
void OnRegistrationState(CmainDlg* main, int sipCode);

// E7 (fim de OnCreated): sem conta ativa, abre a tela Entrar.
void OnMainWindowCreated(CmainDlg* main);

// Chamado pela propria tela Entrar ao ser destruida.
void OnLoginDialogDestroyed(CStarsonicLoginDlg* dialog);

// E12: substituem o verificador de versao do MicroSIP (que consultava update.microsip.org).
// O atualizador da Starsonic entra na Task 14; ate la, nao ha verificacao.
void CheckUpdates(CmainDlg* main);
void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool userAsked);

}  // namespace starsonic
