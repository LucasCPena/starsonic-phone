#pragma once
// O aviso de ligacao recebida (spec da W1, 4.1 e 7.2): a janela de 380x168 (em 100% de escala) no canto de baixo a
// direita da area de trabalho do monitor da janela principal, sempre por cima e sem tomar o foco
// (WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW: fora da barra de tarefas e do Alt+Tab), com o seu WebView2 em
// aviso.html. A MainWindow mostra o aviso quando ha uma ligacao tocando e ela nao esta na frente, e esconde quando
// para de tocar ou quando ela vem para a frente.
//
// O WebView2 do aviso usa o ambiente da janela principal (o mesmo perfil), recebe as mesmas mensagens da ponte e
// manda os comandos dele ao mesmo DesktopApp (callbacks.command). O aviso nunca toca: o aviso.html nao tem som (so a
// janela principal toca), e a navegacao fica presa ao host do app como na principal (WebViewHost).
//
// Tudo na thread da janela principal.
#include <windows.h>

#include <functional>
#include <memory>
#include <string>

#include "WebViewHost.h"

namespace starsonic {

class NoticeWindow {
public:
    static const wchar_t kClassName[];   // "Starsonic Phone Aviso"
    static constexpr int kWidth = 380;   // em pixels de 100% de escala
    static constexpr int kHeight = 168;
    static constexpr int kMargin = 12;   // do canto da area de trabalho

    struct Callbacks {
        std::function<void(const std::string& json)> command;   // um comando da interface do aviso
        std::function<void(const std::string& line)> log;
    };

    NoticeWindow() = default;
    ~NoticeWindow();

    NoticeWindow(const NoticeWindow&) = delete;
    NoticeWindow& operator=(const NoticeWindow&) = delete;

    // Cria a janela (escondida). false: nao deu.
    bool Create(HINSTANCE instance, Callbacks callbacks);
    // Abre o WebView2 do aviso com o ambiente da janela principal (options.environment) e o aviso.html.
    void StartWebView(const WebViewHost::Options& options);

    void Post(const std::string& json);
    // Mostra (sem ativar) no canto do monitor de anchor (a janela principal), ou esconde.
    void Show(HWND anchor);
    void Hide();
    bool Visible() const;
    void Close();

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT Handle(UINT message, WPARAM wParam, LPARAM lParam);
    void Log(const std::string& line) const;

    HWND window_ = nullptr;
    Callbacks callbacks_;
    std::unique_ptr<WebViewHost> webview_;
};

}  // namespace starsonic
