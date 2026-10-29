#include "CompanyFetcher.h"

#include <windows.h>

#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <utility>

#include "Http.h"
#include "Planilha.h"
#include "Text.h"

namespace starsonic {

namespace {

// O que uma leitura deu: o resultado e, quando ele e um erro, o motivo para o diagnostico (sem o link nem o caminho).
struct Reading {
    CompanyFetch result;
    std::string failure;
};

std::string WithCode(const char* what, DWORD code) {
    return std::string(what) + " (erro " + std::to_string(code) + ")";
}

// Fecha o arquivo em toda saida (tambem numa excecao do std::string).
class FileCloser {
public:
    explicit FileCloser(HANDLE file) : file_(file) {}
    ~FileCloser() { CloseHandle(file_); }
    FileCloser(const FileCloser&) = delete;
    FileCloser& operator=(const FileCloser&) = delete;

private:
    HANDLE file_;
};

// O arquivo do caminho (CompanyFetcher.h): qualquer falha e NotFound, e o grande demais e TooLarge sem ler.
Reading ReadPath(const std::string& path) {
    Reading reading;
    reading.result.error = CompanyFetchError::NotFound;
    // Os tres FILE_SHARE: a planilha aberta no Excel (que escreve nela) tambem abre.
    const HANDLE file = CreateFileW(Utf8ToWide(path).c_str(), GENERIC_READ,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                    FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        // ERROR_FILE_NOT_FOUND, ERROR_ACCESS_DENIED, ERROR_BAD_NETPATH (a pasta da rede fora do ar)...
        reading.failure = WithCode("o arquivo nao abriu", GetLastError());
        return reading;
    }
    const FileCloser closer(file);
    // Um caminho de outra coisa (um pipe, uma porta) nao e planilha, e a leitura dele poderia nunca voltar.
    if (GetFileType(file) != FILE_TYPE_DISK) {
        reading.failure = "o caminho nao e de um arquivo";
        return reading;
    }
    LARGE_INTEGER size = {};
    if (!GetFileSizeEx(file, &size)) {
        reading.failure = WithCode("o tamanho do arquivo nao foi lido", GetLastError());
        return reading;
    }
    if (size.QuadPart > static_cast<LONGLONG>(kSheetMaxBytes)) {
        reading.result.error = CompanyFetchError::TooLarge;
        reading.failure = "o arquivo tem mais de 10 MB";
        return reading;
    }
    std::string bytes(static_cast<size_t>(size.QuadPart), '\0');
    size_t done = 0;
    while (done < bytes.size()) {
        DWORD read = 0;
        if (!ReadFile(file, &bytes[done], static_cast<DWORD>(bytes.size() - done), &read, nullptr)) {
            reading.failure = WithCode("o arquivo nao foi lido", GetLastError());
            return reading;
        }
        if (read == 0) {   // o arquivo ficou menor no meio da leitura (alguem gravando nele)
            reading.failure = "o arquivo mudou durante a leitura";
            return reading;
        }
        done += read;
    }
    reading.result.error = CompanyFetchError::None;
    reading.result.bytes = std::move(bytes);
    return reading;
}

// O link (CompanyFetcher.h): a resposta pelo FromHttp.
Reading ReadLink(const std::string& url, const std::wstring& userAgent) {
    HttpResponse response = HttpsGet(Utf8ToWide(url), kSheetMaxBytes, userAgent);
    const bool tooLarge = response.error == ERROR_FILE_TOO_LARGE;
    const bool networkError = response.error != 0 && !tooLarge;
    Reading reading;
    reading.result = FromHttp(static_cast<int>(response.status), networkError, tooLarge, std::move(response.body));
    if (reading.result.error != CompanyFetchError::None) {
        if (networkError) {
            reading.failure = WithCode("o link nao respondeu", response.error);
        } else {
            reading.failure =
                "o link respondeu HTTP " + std::to_string(response.status) + (tooLarge ? " com mais de 10 MB" : "");
        }
    }
    return reading;
}

}  // namespace

struct CompanyFetcher::Shared {
    struct Request {
        CompanySource source;
        std::function<void(const CompanyFetch&)> done;
    };

    std::wstring userAgent;
    std::function<void(const std::string&)> log;
    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Request> queue;   // os pedidos, na ordem
    bool stopped = false;
};

CompanyFetcher::CompanyFetcher(std::wstring userAgent, std::function<void(const std::string&)> log)
    : shared_(std::make_shared<Shared>()) {
    shared_->userAgent = std::move(userAgent);
    shared_->log = std::move(log);
    std::thread(Work, shared_).detach();
}

CompanyFetcher::~CompanyFetcher() { Stop(); }

void CompanyFetcher::Fetch(const CompanySource& source, std::function<void(const CompanyFetch&)> done) {
    if (!done) return;
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        if (shared_->stopped) return;
        shared_->queue.push_back(Shared::Request{source, std::move(done)});
    }
    shared_->wake.notify_one();
}

void CompanyFetcher::Stop() {
    {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->stopped = true;
        shared_->queue.clear();   // os que esperavam: sem resposta
    }
    shared_->wake.notify_all();
}

void CompanyFetcher::Work(std::shared_ptr<Shared> shared) {
    for (;;) {
        Shared::Request request;
        {
            std::unique_lock<std::mutex> lock(shared->mutex);
            shared->wake.wait(lock, [&shared] { return shared->stopped || !shared->queue.empty(); });
            if (shared->stopped) return;
            request = std::move(shared->queue.front());
            shared->queue.pop_front();
        }
        // Sem a trava: a leitura pode demorar (a rede, a pasta da rede fora do ar), e o Stop nao a espera.
        const bool path = request.source.kind == CompanySourceKind::Path;
        Reading reading;
        try {
            reading = path ? ReadPath(request.source.location) : ReadLink(request.source.location, shared->userAgent);
        } catch (...) {
            // Sem memoria (o processo e de 32 bits): o erro da fonte, sem os bytes.
            reading = Reading();
            reading.result.error = path ? CompanyFetchError::NotFound : CompanyFetchError::Offline;
            reading.failure = "sem memoria";
        }
        // Com a trava: depois de o Stop voltar, nenhuma resposta e nenhuma linha (o DesktopApp e o diagnostico podem ja
        // ter saido); o Stop espera so um done que ja comecou (ele so poe o resultado na fila do DesktopApp).
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (shared->stopped) return;
        try {
            if (!reading.failure.empty() && shared->log) shared->log("lista da empresa: " + reading.failure);
        } catch (...) {
            // Sem memoria para a linha: a resposta vai assim mesmo.
        }
        try {
            request.done(reading.result);
        } catch (...) {
            // Sem memoria na fila do DesktopApp: a resposta se perde (nada mais a fazer aqui).
        }
    }
}

}  // namespace starsonic
