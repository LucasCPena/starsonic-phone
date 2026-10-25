// Win32 puro (sem MFC e sem o cabecalho pre-compilado do app antigo: starsonic.targets): compilado tambem no app novo.
#include "Updater.h"

#include <shellapi.h>

#include <algorithm>
#include <atomic>
#include <exception>
#include <thread>
#include <utility>

#include "../../branding/branding.h"   // STARSONIC_REPO_URL
#include "Http.h"
#include "Sha256.h"
#include "Text.h"
#include "UpdateManifest.h"

namespace starsonic {

const wchar_t kUpdateLatestText[] = L"Voc\u00ea j\u00e1 est\u00e1 na vers\u00e3o mais recente.";
const wchar_t kUpdateFinishCallText[] = L"Termine a chamada para atualizar.";
const wchar_t kUpdateFailedText[] =
    L"N\u00e3o foi poss\u00edvel baixar a atualiza\u00e7\u00e3o. Tentaremos de novo mais tarde.";
const wchar_t kUpdateDownloadingText[] = L"Baixando atualiza\u00e7\u00e3o\u2026";

namespace {

const size_t kManifestMaxBytes = 1024 * 1024;
const size_t kInstallerMaxBytes = 150 * 1024 * 1024;

struct ManifestReply {
    DWORD status = 0;
    std::string body;
    std::string failure;   // motivo da falha, em ASCII, para o log
};

struct InstallerReply {
    DWORD status = 0;
    std::string failure;
    std::string version;          // versao do instalador baixado
    std::wstring installerPath;   // instalador gravado e conferido; vazio se falhou
};

}  // namespace

struct Updater::Shared {
    std::shared_ptr<UpdateUi> ui;
    UpdaterOptions options;
    // Aviso aberto ou download em andamento: novas verificacoes sao ignoradas.
    std::atomic<bool> busy{false};

    std::wstring UserAgent() const { return L"Starsonic Phone/" + Utf8ToWide(options.installedVersion); }

    void Log(int level, const std::string& line) const {
        if (options.log) options.log(level, "Atualizacao: " + line);
    }

    void Status(const std::wstring& text) const {
        if (options.status) options.status(text);
    }

    // Roda o passo na thread de quem mostra (ou na hora). false: descartado.
    bool Deliver(UpdateStep step) const {
        if (!options.post) {
            step(false);
            return true;
        }
        return options.post(std::move(step));
    }

    // Volta a linha de status ao normal e libera novas verificacoes.
    void EndUpdate() {
        busy = false;
        Status(std::wstring());
    }
};

namespace {

using SharedPtr = std::shared_ptr<Updater::Shared>;

// %TEMP%\StarsonicPhone-<versao>-setup.exe; vazio se a pasta temporaria nao estiver disponivel.
std::wstring InstallerPath(const std::string& version) {
    wchar_t temp[MAX_PATH + 1] = {};
    const DWORD length = ::GetTempPathW(MAX_PATH + 1, temp);
    if (length == 0 || length > MAX_PATH) {
        return std::wstring();
    }
    return std::wstring(temp, length) + L"StarsonicPhone-" + Utf8ToWide(version) + L"-setup.exe";
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

void OnInstaller(const SharedPtr& shared, const InstallerReply& result) {
    UpdateUi& ui = *shared->ui;
    if (result.installerPath.empty()) {
        shared->Log(2, "download da versao " + result.version + " falhou: " + result.failure);
        shared->EndUpdate();
        ui.Show(kUpdateFailedText);
        return;
    }
    if (ui.Busy()) {
        ::DeleteFileW(result.installerPath.c_str());
        shared->EndUpdate();
        ui.Show(kUpdateFinishCallText);
        return;
    }
    const INT_PTR started = reinterpret_cast<INT_PTR>(
        ::ShellExecuteW(shared->options.owner, L"open", result.installerPath.c_str(), L"/S", NULL, SW_HIDE));
    if (started <= 32) {
        // Spec: falha do instalador nao mostra nada; o app continua na versao atual.
        shared->Log(1, "o instalador da versao " + result.version + " nao abriu (codigo " +
                           std::to_string(static_cast<int>(started)) + ")");
        ::DeleteFileW(result.installerPath.c_str());
        shared->EndUpdate();
        return;
    }
    shared->Log(3, "instalador da versao " + result.version + " iniciado; o app vai fechar");
    if (shared->options.quit) shared->options.quit();   // busy fica ligado ate o fim
}

void DownloadInstaller(SharedPtr shared, Manifest manifest) {
    InstallerReply result;
    std::wstring path;
    try {
        result.version = manifest.versionText;
        path = InstallerPath(manifest.versionText);
        const HttpResponse response =
            HttpsGet(Utf8ToWide(manifest.installerUrl), kInstallerMaxBytes, shared->UserAgent());
        result.status = response.status;
        DWORD saveError = 0;
        if (path.empty()) {
            result.failure = "pasta temporaria indisponivel";
        } else if (response.error) {
            result.failure = "erro " + std::to_string(response.error);
        } else if (response.status != 200) {
            result.failure = "HTTP " + std::to_string(response.status);
        } else if (Sha256Hex(response.body) != manifest.sha256) {
            result.failure = "SHA-256 diferente do versao.json";
        } else if ((saveError = SaveInstaller(response.body, path)) != 0) {
            result.failure = "gravacao falhou (erro " + std::to_string(saveError) + ")";
        } else {
            result.installerPath = path;
        }
    } catch (const std::exception&) {
        result.installerPath.clear();
        result.failure = "sem memoria";
    }
    if (result.installerPath.empty() && !path.empty()) {
        ::DeleteFileW(path.c_str());   // nao deixa instalador incompleto ou adulterado para tras
    }
    const std::wstring saved = result.installerPath;
    bool delivered = false;
    try {
        delivered = shared->Deliver([shared, result](bool) { OnInstaller(shared, result); });
    } catch (const std::exception&) {
        delivered = false;
    }
    if (!delivered && !saved.empty()) ::DeleteFileW(saved.c_str());
}

void OnManifest(const SharedPtr& shared, const ManifestReply& result, bool userAsked) {
    if (shared->busy) {
        return;   // outra verificacao ja abriu o aviso ou o download
    }
    if (!result.failure.empty() || result.status != 200) {
        shared->Log(3, "versao.json indisponivel (HTTP " + std::to_string(result.status) + " " + result.failure + ")");
        return;
    }
    Manifest manifest;
    std::string error;
    if (!ParseManifest(result.body, InstallerUrlPrefix(), &manifest, &error)) {
        shared->Log(2, "versao.json ignorado: " + error);
        return;
    }
    UpdateUi& ui = *shared->ui;
    Version installed;
    if (!ParseVersion(shared->options.installedVersion, &installed) || CompareVersions(manifest.version, installed) <= 0) {
        shared->Log(4, "nada novo (publicada " + manifest.versionText + ", instalada " +
                           shared->options.installedVersion + ")");
        if (userAsked) ui.Show(kUpdateLatestText);
        return;
    }

    if (shared->busy.exchange(true)) return;
    if (!ui.Ask(manifest.versionText, manifest.notes)) {
        shared->busy = false;
        return;
    }
    if (ui.Busy()) {
        shared->busy = false;
        ui.Show(kUpdateFinishCallText);
        return;
    }
    shared->Status(kUpdateDownloadingText);
    try {
        std::thread(DownloadInstaller, shared, manifest).detach();
    } catch (const std::exception&) {
        shared->Log(2, "nao foi possivel iniciar o download");
        shared->EndUpdate();
        ui.Show(kUpdateFailedText);
    }
}

void FetchManifest(SharedPtr shared, bool testChannel) {
    try {
        ManifestReply result;
        const HttpResponse response = HttpsGet(ManifestUrl(testChannel), kManifestMaxBytes, shared->UserAgent());
        result.status = response.status;
        if (response.error) {
            result.failure = "erro " + std::to_string(response.error);
        } else {
            result.body = response.body;
        }
        shared->Deliver([shared, result](bool userAsked) { OnManifest(shared, result, userAsked); });
    } catch (const std::exception&) {
        // Sem memoria: a proxima verificacao tenta de novo.
    }
}

}  // namespace

Updater::Updater(std::shared_ptr<UpdateUi> ui, UpdaterOptions options) : shared_(std::make_shared<Shared>()) {
    shared_->ui = std::move(ui);
    shared_->options = std::move(options);
}

Updater::~Updater() = default;

void Updater::Check() { Check(shared_->options.testChannel); }

void Updater::Check(bool testChannel) {
    if (shared_->busy) {
        return;
    }
    try {
        std::thread(FetchManifest, shared_, testChannel).detach();
    } catch (const std::exception&) {
        shared_->Log(2, "nao foi possivel iniciar a verificacao");
    }
}

std::wstring ManifestUrl(bool testChannel) {
    if (testChannel) return Utf8ToWide(STARSONIC_REPO_URL "/releases/download/canal-teste/versao.json");
    return Utf8ToWide(STARSONIC_REPO_URL "/releases/latest/download/versao.json");
}

std::string InstallerUrlPrefix() {
    return STARSONIC_REPO_URL "/releases/download/";
}

}  // namespace starsonic
