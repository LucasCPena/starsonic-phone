#pragma once
// A janela principal (spec 7.4): sem a moldura do Windows (a barra de titulo e a da interface, que arrasta a janela
// pela regiao app-region e tem os botoes Minimizar e Fechar como comandos da ponte), 400x720 em 100% de escala,
// acompanhando a escala de cada monitor (DPI por monitor v2), com a sombra e os cantos arredondados do Windows 11, e
// o WebView2 ocupando a area inteira. A classe da janela e "Starsonic Phone".
//
// A posicao: a gravada no config.json, se ela ainda cai num monitor; senao, o centro do monitor principal. Depois de
// mover, a posicao nova vai para o config.json (callbacks.moved).
//
// Threads: Create, Show e as acoes rodam na thread da janela. PostToWeb e RunOnWindow podem ser chamados de qualquer
// thread (a de comandos do DesktopApp): so poem na fila e avisam a janela com PostMessage (nunca SendMessage: a thread
// de comandos nunca espera a janela). Os callbacks rodam na thread da janela e nao podem esperar a de comandos.
#include <windows.h>

#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#include "WebViewHost.h"

namespace starsonic {

class MainWindow {
public:
    static const wchar_t kClassName[];   // "Starsonic Phone"
    static constexpr int kWidth = 400;    // em pixels de 100% de escala
    static constexpr int kHeight = 720;

    struct Options {
        std::wstring userDataFolder;     // a do WebView2
        std::wstring uiFolder;           // a pasta da interface
        bool devTools = false;
        std::optional<POINT> position;   // o canto de cima gravado (pixels da tela)
    };

    struct Callbacks {
        std::function<void(const std::string& json)> command;   // um comando da interface (DesktopApp::HandleCommand)
        std::function<void(int x, int y)> moved;                 // a janela parou num lugar novo
        std::function<void()> quitRequested;                     // o Windows pediu para fechar, ou o --sair
        std::function<void(const std::string& line)> log;
        std::function<void(HRESULT error)> webViewFailed;
    };

    MainWindow() = default;
    ~MainWindow();

    MainWindow(const MainWindow&) = delete;
    MainWindow& operator=(const MainWindow&) = delete;

    // Cria a janela (ainda escondida) e comeca a abrir o WebView2. false: a janela nao foi criada.
    bool Create(HINSTANCE instance, const Options& options, Callbacks callbacks);
    void Show(int showCommand);

    // De qualquer thread.
    void PostToWeb(const std::string& json);
    void RunOnWindow(std::function<void()> action);

    // Na thread da janela.
    void Minimize();
    void CloseToTray();
    void Close();   // fecha de vez (depois do Sair): o WebView, a janela e o laco de mensagens
    void LogAudioOutputs();

    // A mensagem que o "StarsonicPhone.exe --sair" manda para a janela aberta.
    static UINT QuitMessage();

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT Handle(UINT message, WPARAM wParam, LPARAM lParam);
    void Place(const std::optional<POINT>& position);
    void ApplyFrame();
    void DrainOutbox();
    void RunActions();
    LRESULT HitTest(LPARAM lParam) const;
    void Log(const std::string& line) const;

    HWND window_ = nullptr;
    Callbacks callbacks_;
    std::unique_ptr<WebViewHost> webview_;
    bool quitting_ = false;

    std::mutex mutex_;
    HWND target_ = nullptr;   // a janela para o PostMessage das outras threads (nullptr: fechada)
    std::deque<std::string> outbox_;
    std::deque<std::function<void()>> actions_;
};

}  // namespace starsonic
