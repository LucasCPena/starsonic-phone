#include "AppUpdater.h"

#include <chrono>
#include <optional>
#include <utility>

#include "Text.h"
#include "UpdateChannel.h"
#include "Updater.h"

namespace starsonic {

class AppUpdater::Ui : public UpdateUi {
public:
    explicit Ui(Hooks hooks) : hooks_(std::move(hooks)) {}

    bool Ask(const std::string& version, const std::wstring& notes) override {
        std::unique_lock<std::mutex> lock(mutex_);
        if (closed_) return false;
        answer_.reset();
        if (hooks_.offer) hooks_.offer(version, WideToUtf8(notes));
        // Sem prazo: a pergunta fica na interface ate a pessoa responder (ou o app sair).
        answered_.wait(lock, [this] { return closed_ || answer_.has_value(); });
        const bool now = !closed_ && answer_.value_or(false);
        answer_.reset();
        return now;
    }

    bool Busy() override {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return true;   // saindo: nada de baixar
        return hooks_.busy && hooks_.busy();
    }

    void Show(const std::wstring& text) override { Notify(WideToUtf8(text)); }

    void Notify(const std::string& text) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!closed_ && hooks_.notify) hooks_.notify(text);
    }

    void Log(const std::string& line) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!closed_ && hooks_.log) hooks_.log(line);
    }

    void Quit() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!closed_ && hooks_.quit) hooks_.quit();
    }

    void Answer(bool now) {
        std::lock_guard<std::mutex> lock(mutex_);
        answer_ = now;
        answered_.notify_all();
    }

    void Close() {
        std::lock_guard<std::mutex> lock(mutex_);
        closed_ = true;
        answered_.notify_all();
    }

private:
    Hooks hooks_;
    std::mutex mutex_;
    std::condition_variable answered_;
    std::optional<bool> answer_;
    bool closed_ = false;
};

AppUpdater::AppUpdater(std::string version, const UpdateChannel& channel, Hooks hooks)
    : channel_(channel), ui_(std::make_shared<Ui>(std::move(hooks))) {
    UpdaterOptions options;
    options.installedVersion = std::move(version);
    options.testChannel = channel.Test();   // a verificacao le o canal de novo (Check(test))
    std::shared_ptr<Ui> ui = ui_;
    options.log = [ui](int level, const std::string& line) {
        // O detalhe (nivel 4: "nada novo") tambem vai: o diagnostico e para o suporte.
        ui->Log(line + (level <= 2 ? " (erro)" : ""));
    };
    options.status = [ui](const std::wstring& text) {
        if (!text.empty()) ui->Notify(WideToUtf8(text));
    };
    options.quit = [ui] { ui->Quit(); };
    updater_.reset(new Updater(ui_, std::move(options)));
}

AppUpdater::~AppUpdater() {
    Close();
    if (timer_.joinable()) timer_.join();
}

void AppUpdater::Start(unsigned long firstDelayMs, unsigned long intervalMs) {
    if (timer_.joinable()) return;
    timer_ = std::thread([this, firstDelayMs, intervalMs] {
        std::unique_lock<std::mutex> lock(mutex_);
        std::chrono::milliseconds wait(firstDelayMs);
        for (;;) {
            if (wake_.wait_for(lock, wait, [this] { return stopping_; })) return;
            lock.unlock();
            updater_->Check(channel_.Test());   // o canal de agora (o administrador pode ter trocado)
            lock.lock();
            wait = std::chrono::milliseconds(intervalMs);
        }
    });
}

void AppUpdater::Answer(bool now) { ui_->Answer(now); }

void AppUpdater::Close() {
    ui_->Close();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_all();
}

}  // namespace starsonic
