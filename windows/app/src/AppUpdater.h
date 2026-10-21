#pragma once
// O atualizador no app novo (spec 7.3; o mesmo Updater do app antigo, starsonic/win/Updater.h): a pergunta vira um
// aviso dentro da interface ({"type":"update"}, DesktopApp::OfferUpdate) e a resposta volta pelos comandos
// updateNow/updateLater (DesktopApp -> Answer). Os avisos ("Termine a chamada para atualizar." e os outros) vao como
// toast. A verificacao roda um tempo depois de abrir e a cada 24 h, numa thread propria.
//
// Threads: os passos do Updater rodam nas threads dele (sem post): o Ask espera a resposta ali, sem travar a janela
// nem a thread de comandos. Close() (antes do DesktopApp sair) solta um Ask que espera (vale "Depois") e, dali em
// diante, nenhum gancho e chamado: as threads do Updater podem durar mais que o app.
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace starsonic {

class Updater;

class AppUpdater {
public:
    struct Hooks {
        std::function<void(const std::string& version, const std::string& notes)> offer;   // DesktopApp::OfferUpdate
        std::function<bool()> busy;                                    // ha ligacao em andamento
        std::function<void(const std::string& text)> notify;          // DesktopApp::Notify (toast)
        std::function<void(const std::string& line)> log;
        std::function<void()> quit;                                    // o instalador abriu: o Sair
    };

    AppUpdater(std::string version, bool testChannel, Hooks hooks);
    ~AppUpdater();   // Close() e espera a thread do relogio

    AppUpdater(const AppUpdater&) = delete;
    AppUpdater& operator=(const AppUpdater&) = delete;

    // A primeira verificacao depois de firstDelayMs, e as outras a cada intervalMs.
    void Start(unsigned long firstDelayMs, unsigned long intervalMs);
    // A resposta da interface (o hooks.updateAnswer do DesktopApp, na thread de comandos).
    void Answer(bool now);
    void Close();

private:
    class Ui;
    std::shared_ptr<Ui> ui_;
    std::unique_ptr<Updater> updater_;
    std::thread timer_;
    std::mutex mutex_;
    std::condition_variable wake_;
    bool stopping_ = false;
};

}  // namespace starsonic
