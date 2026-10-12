#include "stdafx.h"
#include "Updater.h"

#include <algorithm>
#include <ctime>
#include <exception>
#include <memory>
#include <thread>

#include "Hooks.h"
#include "Http.h"
#include "Sha256.h"
#include "Text.h"
#include "UpdateManifest.h"
#include "generated/build_info.h"
#include "global.h"
#include "mainDlg.h"
#include "resource.h"
#include "settings.h"

namespace {

const char kLogSender[] = "Updater";
const wchar_t kTitle[] = L"Starsonic Phone";
const size_t kManifestMaxBytes = 1024 * 1024;
const size_t kInstallerMaxBytes = 150 * 1024 * 1024;

// So os enderecos importam: identificam, em userData, qual das duas respostas chegou.
char g_manifestTag;
char g_installerTag;

// Aviso aberto ou download em andamento (so na thread da janela): novas verificacoes sao ignoradas.
bool g_busy = false;

// Resposta das threads de trabalho. Chega pela UM_UPDATE_CHECKER_LOADED (a mensagem do verificador
// do MicroSIP) como URLGetAsyncData*: statusCode, body (versao.json) e userData (a etiqueta).
struct UpdateResult : URLGetAsyncData {
    std::string failure;          // motivo da falha, em ASCII, para o log
    std::string version;          // versao do instalador baixado
    std::wstring installerPath;   // instalador gravado e conferido; vazio se falhou
};

// Entrega a resposta a janela principal. Sem a janela, ninguem vai trata-la.
void PostResult(HWND window, UpdateResult* result) {
    URLGetAsyncData* data = result;
    if (!::PostMessage(window, UM_UPDATE_CHECKER_LOADED, reinterpret_cast<WPARAM>(data), 0)) {
        if (!result->installerPath.empty()) {
            ::DeleteFileW(result->installerPath.c_str());
        }
        delete result;
    }
}

void FetchManifest(HWND window, std::wstring url) {
    try {
        std::unique_ptr<UpdateResult> result(new UpdateResult());
        result->userData = &g_manifestTag;
        const HttpResponse response = HttpsGet(url, kManifestMaxBytes);
        result->statusCode = response.status;
        if (response.error) {
            result->failure = "erro " + std::to_string(response.error);
        } else {
            result->body = CStringA(response.body.data(), static_cast<int>(response.body.size()));
        }
        PostResult(window, result.release());
    } catch (const std::exception&) {
        // Sem memoria: a proxima verificacao tenta de novo.
    }
}

// %TEMP%\StarsonicPhone-<versao>-setup.exe; vazio se a pasta temporaria nao estiver disponivel.
std::wstring InstallerPath(const std::string& version) {
    wchar_t temp[MAX_PATH + 1] = {};
    const DWORD length = ::GetTempPathW(MAX_PATH + 1, temp);
    if (length == 0 || length > MAX_PATH) {
        return std::wstring();
    }
    return std::wstring(temp, length) + L"StarsonicPhone-" + starsonic::Utf8ToWide(version) + L"-setup.exe";
}

// Grava o instalador; devolve 0 ou o codigo do erro.
DWORD SaveInstaller(const std::string& bytes, const std::wstring& path) {
    const HANDLE file = ::CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        return ::GetLastError();
    }
    DWORD error = 0;
    size_t offset = 0;
    while (error == 0 && offset < bytes.size()) {
        const DWORD chunk = static_cast<DWORD>((std::min)(bytes.size() - offset, static_cast<size_t>(1) << 20));
        DWORD written = 0;
        if (!::WriteFile(file, bytes.data() + offset, chunk, &written, NULL) || written != chunk) {
            const DWORD last = ::GetLastError();
            error = last ? last : ERROR_WRITE_FAULT;
        }
        offset += written;
    }
    if (!::CloseHandle(file) && error == 0) {
        error = ::GetLastError();
    }
    return error;
}

void DownloadInstaller(HWND window, starsonic::Manifest manifest) {
    std::unique_ptr<UpdateResult> result;
    std::wstring path;
    try {
        result.reset(new UpdateResult());
        result->userData = &g_installerTag;
        result->version = manifest.versionText;
        path = InstallerPath(manifest.versionText);
        const HttpResponse response = HttpsGet(starsonic::Utf8ToWide(manifest.installerUrl), kInstallerMaxBytes);
        result->statusCode = response.status;
        DWORD saveError = 0;
        if (path.empty()) {
            result->failure = "pasta temporaria indisponivel";
        } else if (response.error) {
            result->failure = "erro " + std::to_string(response.error);
        } else if (response.status != 200) {
            result->failure = "HTTP " + std::to_string(response.status);
        } else if (Sha256Hex(response.body) != manifest.sha256) {
            result->failure = "SHA-256 diferente do versao.json";
        } else if ((saveError = SaveInstaller(response.body, path)) != 0) {
            result->failure = "gravacao falhou (erro " + std::to_string(saveError) + ")";
        } else {
            result->installerPath = path;
        }
    } catch (const std::exception&) {
        if (result) {
            result->installerPath.clear();
            result->failure = "sem memoria";
        }
    }
    if ((!result || result->installerPath.empty()) && !path.empty()) {
        ::DeleteFileW(path.c_str());   // nao deixa instalador incompleto ou adulterado para tras
    }
    if (result) {
        PostResult(window, result.release());
    }
}

void ShowMessage(CmainDlg* main, const wchar_t* text, UINT icon) {
    ::MessageBoxW(main->m_hWnd, text, kTitle, MB_OK | icon);
}

// Volta a linha de status ao estado da conta e libera novas verificacoes.
void EndUpdate(CmainDlg* main) {
    g_busy = false;
    main->UpdateWindowText();
}

void OnManifest(CmainDlg* main, const UpdateResult& result, bool userAsked) {
    if (g_busy) {
        return;   // outra verificacao ja abriu o aviso ou o download
    }
    if (!result.failure.empty() || result.statusCode != 200) {
        PJ_LOG(3, (kLogSender, "Atualizacao: versao.json indisponivel (HTTP %lu %s)", result.statusCode,
                   result.failure.c_str()));
        return;
    }
    starsonic::Manifest manifest;
    std::string error;
    const std::string body(result.body.GetString(), result.body.GetLength());
    if (!starsonic::ParseManifest(body, InstallerUrlPrefix(), &manifest, &error)) {
        PJ_LOG(2, (kLogSender, "Atualizacao: versao.json ignorado: %s", error.c_str()));
        return;
    }
    starsonic::Version installed;
    if (!starsonic::ParseVersion(STARSONIC_VERSION, &installed) ||
        starsonic::CompareVersions(manifest.version, installed) <= 0) {
        PJ_LOG(4, (kLogSender, "Atualizacao: nada novo (publicada %s, instalada %s)", manifest.versionText.c_str(),
                   STARSONIC_VERSION));
        if (userAsked) {
            ShowMessage(main, L"Voc\u00ea j\u00e1 est\u00e1 na vers\u00e3o mais recente.", MB_ICONINFORMATION);
        }
        return;
    }

    g_busy = true;
    CString question;
    question.Format(L"Nova vers\u00e3o do Starsonic Phone dispon\u00edvel (%s). Atualizar agora?",
                    CString(manifest.versionText.c_str()).GetString());
    if (!manifest.notes.empty()) {
        question += L"\r\n\r\n";
        question += manifest.notes.c_str();
    }
    if (::MessageBoxW(main->m_hWnd, question, kTitle, MB_YESNO | MB_ICONQUESTION) != IDYES) {
        g_busy = false;
        return;
    }
    if (pjsua_call_get_count() > 0) {
        g_busy = false;
        ShowMessage(main, L"Termine a chamada para atualizar.", MB_ICONINFORMATION);
        return;
    }
    main->UpdateWindowText(L"Baixando atualiza\u00e7\u00e3o\u2026", -1);
    try {
        std::thread(DownloadInstaller, main->m_hWnd, manifest).detach();
    } catch (const std::exception&) {
        PJ_LOG(2, (kLogSender, "Atualizacao: nao foi possivel iniciar o download"));
        EndUpdate(main);
        ShowMessage(main, L"N\u00e3o foi poss\u00edvel baixar a atualiza\u00e7\u00e3o. Tentaremos de novo mais tarde.", MB_ICONWARNING);
    }
}

void OnInstaller(CmainDlg* main, const UpdateResult& result) {
    if (result.installerPath.empty()) {
        PJ_LOG(2, (kLogSender, "Atualizacao: download da versao %s falhou: %s", result.version.c_str(),
                   result.failure.c_str()));
        EndUpdate(main);
        ShowMessage(main, L"N\u00e3o foi poss\u00edvel baixar a atualiza\u00e7\u00e3o. Tentaremos de novo mais tarde.", MB_ICONWARNING);
        return;
    }
    if (pjsua_call_get_count() > 0) {
        ::DeleteFileW(result.installerPath.c_str());
        EndUpdate(main);
        ShowMessage(main, L"Termine a chamada para atualizar.", MB_ICONINFORMATION);
        return;
    }
    const INT_PTR started = reinterpret_cast<INT_PTR>(
        ::ShellExecuteW(main->m_hWnd, L"open", result.installerPath.c_str(), L"/S", NULL, SW_HIDE));
    if (started <= 32) {
        // Spec: falha do instalador nao mostra nada; o app continua na versao atual.
        PJ_LOG(1, (kLogSender, "Atualizacao: o instalador da versao %s nao abriu (codigo %d)", result.version.c_str(),
                   static_cast<int>(started)));
        ::DeleteFileW(result.installerPath.c_str());
        EndUpdate(main);
        return;
    }
    PJ_LOG(3, (kLogSender, "Atualizacao: instalador da versao %s iniciado; o app vai fechar", result.version.c_str()));
    main->PostMessage(WM_COMMAND, ID_EXIT);   // g_busy fica ligado ate o fim
}

}  // namespace

std::wstring ManifestUrl() {
#if STARSONIC_UPDATE_CHANNEL_TEST
    return starsonic::Utf8ToWide(STARSONIC_REPO_URL "/releases/download/canal-teste/versao.json");
#else
    return starsonic::Utf8ToWide(STARSONIC_REPO_URL "/releases/latest/download/versao.json");
#endif
}

std::string InstallerUrlPrefix() {
    return STARSONIC_REPO_URL "/releases/download/";
}

void CALLBACK UpdateTimerProc(HWND /*window*/, UINT /*message*/, UINT_PTR /*id*/, DWORD /*tickCount*/) {
    if (!mainDlg) {
        return;
    }
    mainDlg->CheckUpdates();
    // Como na verificacao da abertura (OnCreated do MicroSIP).
    accountSettings.checkUpdatesTime = static_cast<int>(time(NULL));
}

namespace starsonic {

void CheckUpdates(CmainDlg* main) {
    if (g_busy) {
        return;
    }
    try {
        std::thread(FetchManifest, main->m_hWnd, ManifestUrl()).detach();
    } catch (const std::exception&) {
        PJ_LOG(2, (kLogSender, "Atualizacao: nao foi possivel iniciar a verificacao"));
    }
}

void OnUpdateMessage(CmainDlg* main, WPARAM wParam, bool userAsked) {
    URLGetAsyncData* data = reinterpret_cast<URLGetAsyncData*>(wParam);
    if (!data) {
        return;
    }
    if (data->userData != &g_manifestTag && data->userData != &g_installerTag) {
        delete data;   // nao veio do atualizador
        return;
    }
    std::unique_ptr<UpdateResult> result(static_cast<UpdateResult*>(data));
    if (result->userData == &g_manifestTag) {
        OnManifest(main, *result, userAsked);
    } else {
        OnInstaller(main, *result);
    }
}

}  // namespace starsonic
