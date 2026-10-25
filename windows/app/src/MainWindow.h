#pragma once
// A janela principal (spec 7.4): sem a moldura do Windows (a barra de titulo e a da interface, que arrasta a janela
// pela regiao app-region e tem os botoes Minimizar e Fechar como comandos da ponte), acompanhando a escala de cada
// monitor (DPI por monitor v2), com a sombra e os cantos arredondados do Windows 11, e o WebView2 ocupando a area
// cliente inteira. A classe da janela e "Starsonic Phone".
//
// O tamanho (rc.2): a janela muda de tamanho pela borda e pelo canto, como no MicroSIP. O WS_THICKFRAME da as bordas
// de redimensionar; o WM_NCCALCSIZE tira so a barra do Windows e deixa as bordas invisiveis dos lados e de baixo fora
// da area cliente (o WebView2 nao as cobre: o Windows responde HTLEFT, HTRIGHT, HTBOTTOM e os cantos de baixo); a
// faixa de cima fica dentro da area cliente e o HitTest responde HTTOP nela. O tamanho e o da area cliente (a da
// interface), em pixels logicos: 400x720 por padrao ou o gravado no config.json, nunca menor que 300x440
// (WM_GETMINMAXINFO) nem maior que a area de trabalho (WindowFit); a mudanca de escala (WM_DPICHANGED) mantem o
// tamanho logico; o tamanho que a pessoa escolhe vai para o config.json 500 ms depois do ultimo WM_SIZE
// (callbacks.resized). As contas da propria janela (o encaixe na area de trabalho) nao contam como escolha.
//
// A posicao (o canto de cima a esquerda da area cliente): a gravada no config.json, se ela ainda cai num monitor;
// senao, o centro do monitor principal. Depois de mover, a posicao nova vai para o config.json (callbacks.moved).
//
// A janela tambem cuida da bandeja (Tray) e do aviso de ligacao recebida (NoticeWindow), lendo o estado que vai para
// a interface (ShellState): o "fechar" da barra esconde a janela na bandeja (o WebView continua rodando: o toque e
// dele); com uma ligacao tocando e a janela fora da frente (escondida, minimizada ou atras de outra), o aviso aparece
// no canto; o Atender do aviso traz a janela para a frente. O logoff ou o desligamento do Windows (WM_ENDSESSION)
// chama callbacks.endSession, que faz o Sair com uma espera curta. (rc.3) O icone da bandeja que muda vai ao
// diagnostico ("bandeja: <icone>"), e o servidor da conta e se ela esta conectada, ao monitor de rede
// (callbacks.account).
//
// O WebView2: a pagina abre com a versao na URL (index.html?v=<versao>, e o aviso.html tambem); o navegador que sai
// (morto ou caido) e refeito com um ambiente novo, a janela e o aviso ("navegador reiniciado" no diagnostico; o
// motor e as ligacoes continuam); a pagina que nao responde recarrega depois de 5 s.
//
// Os dispositivos de som: o WM_DEVICECHANGE (DBT_DEVNODES_CHANGED, e a chegada e a saida de uma interface de audio)
// espera 1 s sem outro e chama callbacks.devicesChanged (o DesktopApp rele os dispositivos na thread de comandos).
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

#include "BrowserRestarts.h"
#include "NoticeWindow.h"
#include "ShellState.h"
#include "Tray.h"
#include "WebViewHost.h"
#include "WindowFit.h"

namespace starsonic {

class MainWindow {
public:
    static const wchar_t kClassName[];   // "Starsonic Phone"
    static constexpr int kWidth = 400;    // em pixels de 100% de escala (WindowFit: a altura cabe na area de trabalho)
    static constexpr int kHeight = 720;

    struct Options {
        std::wstring userDataFolder;     // a do WebView2
        std::wstring uiFolder;           // a pasta da interface
        bool devTools = false;
        std::optional<POINT> position;   // o canto de cima da area cliente gravado (pixels da tela)
        std::optional<WindowSize> size;  // o tamanho gravado da area cliente (pixels logicos)
        std::wstring version;            // a versao do app (vai na URL das paginas: ?v=<versao>)
    };

    struct Callbacks {
        std::function<void(const std::string& json)> command;   // um comando da interface (DesktopApp::HandleCommand)
        std::function<void(const std::string& json)> noticeCommand;   // um comando da interface do aviso
        std::function<void(int x, int y)> moved;                 // a janela parou num lugar novo
        std::function<void(int width, int height)> resized;      // a pessoa mudou o tamanho (logicos, da area cliente)
        std::function<void()> quitRequested;                     // Alt+F4, o Sair da bandeja, o --sair
        std::function<void()> endSession;                        // o Windows esta encerrando a sessao (logoff)
        std::function<void(const std::string& line)> log;
        std::function<void(HRESULT error)> webViewFailed;
        std::function<void()> devicesChanged;   // um dispositivo de som entrou ou saiu (1 s depois do ultimo aviso)
        // (rc.3) A conta em uso mudou para o monitor de rede: o servidor (conta.servidor, "" sem conta: o teste DNS) ou
        // se ela esta conectada (conta.status "conectado": as falhas do DNS so contam sem isso, Ruling 23).
        std::function<void(const std::string& server, bool connected)> account;
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
    void CloseToTray();     // esconde na bandeja
    void BringToFront();    // da bandeja, minimizada ou atras de outra: na frente
    void RequestQuit();     // o Sair (como o Alt+F4): o DesktopApp encerra e o gancho quit fecha a janela
    // O resize da interface (rc.2): a borda que o WebView2 cobre ("cima", "cima-esquerda", "cima-direita",
    // "baixo-direita"). Com o botao esquerdo ainda apertado, comeca o redimensionar do Windows por ela (o
    // WM_NCLBUTTONDOWN postado, que nunca espera); solto, maximizada ou minimizada, nada.
    void StartResize(const std::string& edge);
    void Close();   // fecha de vez (depois do Sair): o WebView, a janela e o laco de mensagens
    void LogAudioOutputs();

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT Handle(UINT message, WPARAM wParam, LPARAM lParam);
    void Place(const std::optional<POINT>& position);
    // Refaz o tamanho e a posicao no monitor e na escala de agora (a area de trabalho ou a resolucao mudaram).
    void Refit();
    void ApplyFrame();
    // Poe a area cliente nesse lugar e tamanho (pixels fisicos), com as bordas invisiveis em volta.
    void SetClientBox(const FitBox& box, UINT dpi);
    FitBox ClientBox() const;   // a area cliente na tela
    void OnMinMaxInfo(MINMAXINFO* info) const;
    void DrainOutbox();
    void RunActions();
    void StartNotice();
    // Cria o WebViewHost da janela principal (na abertura e quando o navegador sai).
    void CreateWebView();
    void RestartWebView();
    void RegisterAudioNotifications();
    void RefreshNotice();
    void OnTray(WPARAM wParam, LPARAM lParam);
    LRESULT HitTest(WPARAM wParam, LPARAM lParam) const;
    void Log(const std::string& line) const;

    HWND window_ = nullptr;
    HINSTANCE instance_ = nullptr;
    Options options_;
    Callbacks callbacks_;
    std::unique_ptr<WebViewHost> webview_;
    NoticeWindow notice_;
    Tray tray_;
    ShellStatus status_;
    TrayIcon trayIcon_ = TrayIcon::Offline;   // o da bandeja agora (vai ao diagnostico quando muda)
    std::string server_;                       // o conta.servidor que o monitor de rede tem
    bool connected_ = false;                   // e se a conta esta conectada, para ele
    bool active_ = false;        // a janela e a ativa (na frente)
    bool trayLogged_ = false;
    bool noticeStarted_ = false;   // o WebView do aviso ja abriu (depois da primeira mensagem da interface)
    bool quitting_ = false;
    WindowSize desired_;           // o tamanho escolhido (logico, da area cliente): o encaixe parte dele
    bool placed_ = false;          // o Place ja rodou (antes, os WM_SIZE sao da criacao)
    bool fitting_ = false;         // o SetWindowPos e da propria janela (o encaixe): o WM_SIZE nao e uma escolha
    WebViewHost::Callbacks webCallbacks_;
    WebViewHost::Options webOptions_;
    BrowserRestarts restarts_;     // o navegador que sai: refaz ou desiste (3 seguidas sem o ready)
    HDEVNOTIFY audioNotify_ = nullptr;

    std::mutex mutex_;
    HWND target_ = nullptr;   // a janela para o PostMessage das outras threads (nullptr: fechada)
    std::deque<std::string> outbox_;
    std::deque<std::function<void()>> actions_;
};

}  // namespace starsonic
