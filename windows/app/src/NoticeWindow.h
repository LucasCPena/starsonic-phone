#pragma once
// O aviso de ligacao recebida (spec da W1, 4.1 e 7.2): a janela de 380 de largura e 168 de altura (em 100% de escala; a altura muda, pedida pela pagina: SetHeight) no canto de baixo a
// direita da area de trabalho do monitor da janela principal, sempre por cima e sem tomar o foco
// (WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW: fora da barra de tarefas e do Alt+Tab), com o seu WebView2 em
// aviso.html. A MainWindow mostra o aviso quando ha uma ligacao tocando e ela nao esta na frente, e esconde quando
// para de tocar ou quando ela vem para a frente ((0.3.0-rc.2) menos o do porteiro tocando como a segunda ligacao, com
// a imagem dele, que aparece e fica tambem com ela na frente: ShowsNotice).
//
// O WebView2 do aviso usa o ambiente da janela principal (o mesmo perfil), recebe as mesmas mensagens da ponte (menos
// a chatChave, que vai so para a janela principal: NoticeMayGet, ChatFiles.h) e manda os comandos dele ao mesmo
// DesktopApp (callbacks.command). O aviso nunca toca: o aviso.html nao tem som (so a
// janela principal toca), e a navegacao fica presa ao host do app como na principal (WebViewHost).
//
// Tudo na thread da janela principal.
#include <windows.h>

#include <functional>
#include <memory>
#include <string>

#include "WebViewHost.h"
#include "WindowFit.h"

namespace starsonic {

class NoticeWindow {
public:
    static const wchar_t kClassName[];   // "Starsonic Phone Aviso"
    // Os tamanhos (380 de largura, 168 de altura de fabrica e a margem de 12 do canto, em pixels de 100% de escala)
    // estao no WindowFit.h (kNoticeWidth, kNoticeHeight, kNoticeMargin); a altura muda com o SetHeight.

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
    // Abre o WebView2 do aviso com o ambiente da janela principal (options.environment) e a pagina options.startPage
    // (o aviso.html com a versao). Uma pagina que nao responde recarrega depois de um tempo.
    void StartWebView(const WebViewHost::Options& options);
    // Fecha o WebView2 do aviso (o navegador saiu: a janela principal abre outro com o ambiente novo).
    void StopWebView();

    void Post(const std::string& json);
    // (0.3.0) O WebView do aviso agora (nullptr antes do StartWebView e depois do StopWebView): a memoria do video do
    // porteiro vai a ele (WebViewSharedBuffers).
    WebViewHost* WebView() const { return webview_.get(); }
    // Mostra (sem ativar) no canto do monitor de anchor (a janela principal), ou esconde.
    void Show(HWND anchor);
    // (0.3.0) A altura pedida pela pagina, em pixels logicos (de 168 a 480). Com o aviso a vista, refaz o tamanho e o
    // lugar no monitor onde ele esta; escondido, so guarda para o proximo Show.
    void SetHeight(int logicalHeight);
    void Hide();
    bool Visible() const;
    void Close();

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT Handle(UINT message, WPARAM wParam, LPARAM lParam);
    void Log(const std::string& line) const;

    // Poe o aviso no canto do monitor, com a altura de height_; show: tambem mostra (sem ativar).
    void Place(HMONITOR monitor, bool show);

    HWND window_ = nullptr;
    int height_ = kNoticeHeight;   // logica
    Callbacks callbacks_;
    std::unique_ptr<WebViewHost> webview_;
};

}  // namespace starsonic
