#pragma once
// Pontos de entrada chamados pelas edicoes E1-E14 no codigo do MicroSIP.
#include <windows.h>

class CDialog;
class CmainDlg;
class CMenu;
class CStarsonicLoginDlg;

namespace starsonic {

// E4 (microsip.cpp, logo depois de accountSettings.Init()): reaplica o perfil embutido em todas
// as contas, cada uma com o proprio endereco do servidor, e trava as configuracoes globais (nada
// em /reset, /resetnoask e /exit).
void OnSettingsLoaded();

// E14 (inicio de PJAccountAdd, depois de conferir accountId): reaplica o perfil, na memoria, a
// conta que vai registrar — cobre a importacao, a troca de conta pelo menu e o /account:N com o
// app aberto. Endereco vazio ou invalido: a conta fica vazia e o MicroSIP abre a tela Entrar.
void EnforceActiveAccount();

// E8: Contas > Adicionar/Editar e o OnAccount do MicroSIP abrem a tela Entrar.
// Com a tela ja aberta, so a traz para a frente.
void ShowLogin(CmainDlg* main, int accountId, bool focusPassword);

// E9 (onRegState2): repassa o resultado do registro para a tela Entrar, se houver login pendente.
void OnRegistrationState(CmainDlg* main, int sipCode);

// E7 (fim de OnCreated): sem conta ativa, abre a tela Entrar.
void OnMainWindowCreated(CmainDlg* main);

// Chamado pela propria tela Entrar ao ser destruida.
void OnLoginDialogDestroyed(CStarsonicLoginDlg* dialog);

// E6 (OnInitDialog, logo depois de CBaseDialog::OnInitDialog): faixa da marca no topo da janela.
void InstallBrandBand(CmainDlg* main);

// E10 (UpdateWindowText): status da faixa = texto da barra + rotulo da conta ativa.
void OnStatusText(CmainDlg* main, const CString& text);

// E11: item "Sobre o Starsonic Phone" no menu principal (ID_CUSTOM_RANGE) e sua acao.
void AddMenuItems(CMenu* menu);
void OnCustomMenu(CmainDlg* main, UINT id);

// E13 (fim de SettingsDlg::OnInitDialog): esconde os campos travados pelo perfil e fecha os buracos.
void FilterSettings(CDialog* settingsDlg);

// E12: substituem o verificador de versao do MicroSIP (que consultava update.microsip.org).
// O atualizador e o Updater.cpp (sem MFC, o mesmo do app novo); estes dois, em Hooks.cpp, sao o adaptador dele
// para a janela do MicroSIP: versao.json dos releases do GitHub (spec 7.3). OnUpdateMessage recebe os passos das
// threads do atualizador pela UM_UPDATE_CHECKER_LOADED, roda e apaga.
void CheckUpdates(CmainDlg* main);
void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool userAsked);

}  // namespace starsonic
