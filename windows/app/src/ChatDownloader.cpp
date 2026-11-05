#include "ChatDownloader.h"

#include <windows.h>

#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>

#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <utility>

#include "Chat.h"
#include "ChatFiles.h"
#include "ChatSave.h"
#include "Http.h"
#include "Text.h"

namespace starsonic {

namespace {

const DWORD kStatusOk = 200;   // so o 200 traz o arquivo (o toast de cada status e o DownloadToast, ChatFiles.h)

// A pasta Downloads do usuario (criada se falta); "" se o Windows nao a deu.
std::wstring DownloadsFolder() {
    PWSTR path = nullptr;
    std::wstring out;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Downloads, KF_FLAG_CREATE, nullptr, &path)) && path) out = path;
    CoTaskMemFree(path);
    return out;
}

}  // namespace

struct ChatDownloader::Shared {
    struct Request {
        std::string arquivo;
        std::string nome;
        std::string chave;
        std::function<void(const std::string& toast)> done;
    };

    std::wstring userAgent;
    std::function<void(const std::string&)> log;
    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Request> queue;   // os pedidos, na ordem
    bool stopped = false;
};

ChatDownloader::ChatDownloader(std::wstring userAgent, std::function<void(const std::string&)> log)
    : shared_(std::make_shared<Shared>()) {
    shared_->userAgent = std::move(userAgent);
    shared_->log = std::move(log);
    std::thread(Work, shared_).detach();
}

ChatDownloader::~ChatDownloader() { Stop(); }

void ChatDownloader::Download(std::string arquivo, std::string nome, std::string chave,
                              std::function<void(const std::string& toast)> done) {
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        if (shared_->stopped) return;
        shared_->queue.push_back(
            Shared::Request{std::move(arquivo), std::move(nome), std::move(chave), std::move(done)});
    }
    shared_->wake.notify_one();
}

void ChatDownloader::Stop() {
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->stopped = true;
        shared_->queue.clear();   // os que esperavam: sem resposta
    }
    shared_->wake.notify_all();
}

void ChatDownloader::Work(std::shared_ptr<Shared> shared) {
    // O ShellExecuteW pede o COM na thread que o chama (sem o DDE do OLE1, como a documentacao dele recomenda).
    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    for (;;) {
        Shared::Request request;
        {
            std::unique_lock<std::mutex> lock(shared->mutex);
            shared->wake.wait(lock, [&shared] { return shared->stopped || !shared->queue.empty(); });
            if (shared->stopped) break;
            request = std::move(shared->queue.front());
            shared->queue.pop_front();
        }
        int status = 0;       // o status HTTP (0: sem resposta, ou o id fora da regra)
        bool saved = false;   // gravado na pasta Downloads (e aberto)
        std::string line;
        try {
            if (!ValidFileId(request.arquivo)) {
                line = "chat: download recusado (o id do arquivo)";
            } else {
                // Sem a trava: o download pode demorar, e o Stop nao o espera.
                const std::wstring url = Utf8ToWide(std::string(kChatOrigin) + "/api/v1/arquivos/" + request.arquivo);
                const HttpResponse response =
                    HttpsGetBearer(url, kChatMaxFileBytes, shared->userAgent, request.chave);
                status = static_cast<int>(response.status);
                line = "chat: download " + std::to_string(response.status) + " " + std::to_string(response.body.size());
                if (response.error == 0 && response.status == kStatusOk) {
                    // Parado no meio do download: nem grava nem abre (e a resposta tambem nao vai, abaixo).
                    bool stopped = false;
                    {
                        std::lock_guard<std::mutex> lock(shared->mutex);
                        stopped = shared->stopped;
                    }
                    const std::wstring folder = stopped ? std::wstring() : DownloadsFolder();
                    const std::wstring path =
                        folder.empty() ? std::wstring() : SaveChatFile(folder, request.nome, response.body);
                    if (!path.empty()) {
                        ShellExecuteW(nullptr, L"open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                        saved = true;
                    }
                }
            }
        } catch (...) {
            // Sem memoria (o processo e de 32 bits): o erro de sempre.
            saved = false;
        }
        // Com a trava: depois de o Stop voltar, nenhuma resposta e nenhuma linha (o DesktopApp e o diagnostico podem ja
        // ter saido); o Stop espera so um done que ja comecou (ele so poe o toast na fila do DesktopApp).
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (shared->stopped) break;
        try {
            if (!line.empty() && shared->log) shared->log(line);
        } catch (...) {
            // Sem memoria para a linha: a resposta vai assim mesmo.
        }
        try {
            if (request.done) request.done(DownloadToast(status, saved));
        } catch (...) {
            // Sem memoria na fila do DesktopApp: o toast se perde (nada mais a fazer aqui).
        }
    }
    if (SUCCEEDED(com)) CoUninitialize();
}

}  // namespace starsonic
