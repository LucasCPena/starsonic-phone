#include "stdafx.h"
#include "Hooks.h"

#include <ctime>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "AccountAdapter.h"
#include "AccountPolicy.h"
#include "LoginDialog.h"
#include "ProfileStore.h"
#include "StarsonicIds.h"
#include "Updater.h"
#include "generated/build_info.h"
#include "global.h"
#include "lib/MSIP.h"
#include "mainDlg.h"
#include "resource.h"
#include "settings.h"

namespace {

const UINT kUpdateIntervalMs = 24u * 60u * 60u * 1000u;
const char kUpdateLogSender[] = "Updater";
const wchar_t kUpdateTitle[] = L"Starsonic Phone";

CStarsonicLoginDlg* g_loginDlg = nullptr;

// O atualizador (Updater.h, sem MFC) com a cara de sempre no app antigo: a pergunta e os avisos em caixas de mensagem
// da janela principal, o status na linha da janela, e cada passo rodando na thread da janela, pela
// UM_UPDATE_CHECKER_LOADED (a mensagem do verificador de versao original).
CmainDlg* g_updateMain = nullptr;

// So o endereco importa: identifica, em userData, uma mensagem do atualizador.
char g_updateTag;

// Um passo do atualizador a caminho da janela principal.
struct UpdateStepMessage : URLGetAsyncData {
    starsonic::UpdateStep step;
};

class DialogUpdateUi : public starsonic::UpdateUi {
public:
    bool Ask(const std::string& version, const std::wstring& notes) override {
        CString question;
        question.Format(L"Nova vers\u00e3o do Starsonic Phone dispon\u00edvel (%s). Atualizar agora?",
                        CString(version.c_str()).GetString());
        if (!notes.empty()) {
            question += L"\r\n\r\n";
            question += notes.c_str();
        }
        return ::MessageBoxW(Owner(), question, kUpdateTitle, MB_YESNO | MB_ICONQUESTION) == IDYES;
    }
    bool Busy() override { return pjsua_call_get_count() > 0; }
    void Show(const std::wstring& text) override {
        const UINT icon = text == starsonic::kUpdateFailedText ? MB_ICONWARNING : MB_ICONINFORMATION;
        ::MessageBoxW(Owner(), text.c_str(), kUpdateTitle, MB_OK | icon);
    }

private:
    static HWND Owner() { return g_updateMain ? g_updateMain->m_hWnd : NULL; }
};

void LogUpdate(int level, const std::string& line) {
    // O PJ_LOG pede o nivel como constante.
    switch (level) {
        case 1:
            PJ_LOG(1, (kUpdateLogSender, "%s", line.c_str()));
            break;
        case 2:
            PJ_LOG(2, (kUpdateLogSender, "%s", line.c_str()));
            break;
        case 3:
            PJ_LOG(3, (kUpdateLogSender, "%s", line.c_str()));
            break;
        default:
            PJ_LOG(4, (kUpdateLogSender, "%s", line.c_str()));
            break;
    }
}

starsonic::Updater& UpdaterFor(CmainDlg* main) {
    g_updateMain = main;
    static starsonic::Updater* updater = nullptr;   // dura o processo inteiro (as threads guardam o que precisam)
    if (!updater) {
        starsonic::UpdaterOptions options;
        options.installedVersion = STARSONIC_VERSION;
        options.testChannel = STARSONIC_UPDATE_CHANNEL_TEST != 0;
        options.owner = main->m_hWnd;
        const HWND window = main->m_hWnd;
        options.post = [window](starsonic::UpdateStep step) {
            std::unique_ptr<UpdateStepMessage> message(new UpdateStepMessage());
            message->userData = &g_updateTag;
            message->step = std::move(step);
            URLGetAsyncData* data = message.get();
            if (!::PostMessage(window, UM_UPDATE_CHECKER_LOADED, reinterpret_cast<WPARAM>(data), 0)) return false;
            message.release();
            return true;
        };
        options.log = LogUpdate;
        options.status = [](const std::wstring& text) {
            if (!g_updateMain) return;
            if (text.empty()) {
                g_updateMain->UpdateWindowText();
            } else {
                g_updateMain->UpdateWindowText(text.c_str(), -1);
            }
        };
        options.quit = [] {
            if (g_updateMain) g_updateMain->PostMessage(WM_COMMAND, ID_EXIT);
        };
        updater = new starsonic::Updater(std::make_shared<DialogUpdateUi>(), std::move(options));
    }
    return *updater;
}

// Timer de 24 h da janela principal (IDT_STARSONIC_UPDATES), ligado no OnMainWindowCreated.
void CALLBACK UpdateTimerProc(HWND /*window*/, UINT /*message*/, UINT_PTR /*id*/, DWORD /*tickCount*/) {
    if (!mainDlg) {
        return;
    }
    mainDlg->CheckUpdates();
    // Como na verificacao da abertura (OnCreated do MicroSIP).
    accountSettings.checkUpdatesTime = static_cast<int>(time(NULL));
}

// Nomes de todas as secoes do INI (GetPrivateProfileSectionNames).
std::vector<std::wstring> IniSectionNames(const CString& file) {
    std::vector<wchar_t> buffer(4096);
    DWORD length = 0;
    for (;;) {
        length = GetPrivateProfileSectionNamesW(buffer.data(), static_cast<DWORD>(buffer.size()), file);
        // Com o buffer pequeno demais, a funcao devolve tamanho - 2.
        if (length + 2 < buffer.size() || buffer.size() >= (1u << 22)) {
            break;
        }
        buffer.assign(buffer.size() * 2, L'\0');
    }
    std::vector<std::wstring> names;
    size_t start = 0;
    for (size_t i = 0; i < length; ++i) {
        if (buffer[i] == L'\0') {
            if (i > start) {
                names.emplace_back(&buffer[start], i - start);
            }
            start = i + 1;
        }
    }
    if (start < length) {
        names.emplace_back(&buffer[start], length - start);
    }
    return names;
}

}  // namespace

namespace starsonic {

void OnSettingsLoaded() {
    // Em /reset, /resetnoask e /exit o MicroSIP nao carrega as configuracoes (ou so repassa o
    // comando e sai): salvar aqui gravaria valores vazios por cima de tudo.
    if (!ShouldEnforceAtStartup(std::wstring(AfxGetApp()->m_lpCmdLine))) {
        return;
    }
    const Profile& profile = LoadedProfile();
    // Todas as secoes [Account<n>] do INI, inclusive depois de um buraco na numeracao (o MicroSIP
    // carrega qualquer accountId) e as que ele nao carrega (dominio vazio). Cada conta fica com o
    // proprio endereco do servidor; o resto vem do perfil.
    for (int i : AccountSectionNumbers(IniSectionNames(accountSettings.iniFile))) {
        Account account;
        accountSettings.AccountLoad(i, &account);
        AccountFields fields = ToFields(account);
        EnforceAccount(&fields, profile.account);
        FromFields(fields, &account);
        accountSettings.AccountSave(i, &account);
    }
    GlobalFields globals = GlobalsFrom(accountSettings);
    EnforceGlobal(&globals, profile.global);
    GlobalsTo(globals, &accountSettings);
    accountSettings.SettingsSave();
    if (accountSettings.accountId > 0) {
        accountSettings.AccountLoad(accountSettings.accountId, &accountSettings.account);
    }
}

void EnforceActiveAccount() {
    // A tela Entrar acabou de montar a conta pelo perfil e so a grava se o registro der certo.
    if (g_loginDlg && g_loginDlg->IsPending()) {
        return;
    }
    if (accountSettings.accountId <= 0) {
        return;
    }
    AccountFields fields = ToFields(accountSettings.account);
    EnforceAccount(&fields, LoadedProfile().account);
    FromFields(fields, &accountSettings.account);
}

void ShowLogin(CmainDlg* main, int accountId, bool focusPassword) {
    // Com a tela ja aberta (com login pendente ou mostrando um erro), so traz para a frente:
    // depois de um 401/403 o proprio MicroSIP pede a tela de conta de novo (UM_ON_ACCOUNT),
    // e recarregar apagaria a mensagem e o ramal digitado.
    if (g_loginDlg) {
        g_loginDlg->SetForegroundWindow();
        return;
    }
    g_loginDlg = new CStarsonicLoginDlg(main);
    g_loginDlg->Load(accountId, focusPassword);
}

void OnRegistrationState(CmainDlg* /*main*/, int sipCode) {
    if (g_loginDlg && g_loginDlg->IsPending()) {
        g_loginDlg->OnRegistrationState(sipCode);
    }
}

void OnMainWindowCreated(CmainDlg* main) {
    // A cada 24 h com o app aberto; a verificacao da abertura segue a regra do MicroSIP.
    ::SetTimer(main->m_hWnd, IDT_STARSONIC_UPDATES, kUpdateIntervalMs, UpdateTimerProc);
    if (accountSettings.accountId == 0) {
        ShowLogin(main, -1, false);
    }
}

void OnLoginDialogDestroyed(CStarsonicLoginDlg* dialog) {
    if (g_loginDlg == dialog) {
        g_loginDlg = nullptr;
    }
}

void CheckUpdates(CmainDlg* main) {
    UpdaterFor(main).Check();
}

void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool userAsked) {
    URLGetAsyncData* data = reinterpret_cast<URLGetAsyncData*>(wParam);
    if (!data) {
        return;
    }
    if (data->userData != &g_updateTag) {
        delete data;   // nao veio do atualizador
        return;
    }
    g_updateMain = main;
    std::unique_ptr<UpdateStepMessage> message(static_cast<UpdateStepMessage*>(data));
    if (message->step) message->step(userAsked);
}

}  // namespace starsonic
