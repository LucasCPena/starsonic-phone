#pragma once
// O WebView2 da janela principal (spec 6, 6.1 e 6.4): o ambiente na pasta de dados do WebView2
// (%LOCALAPPDATA%\Starsonic Phone\WebView2), a interface servida da pasta ui\ do app pelo host virtual
// https://app.starsonic.local/ (SetVirtualHostNameToFolderMapping), nenhuma navegacao fora dele, a barra de titulo da
// interface arrastando a janela (app-region, IsNonClientRegionSupportEnabled) e a ponte: o postMessage da interface
// vira um comando (o JSON) e o C++ responde com PostWebMessageAsJson.
//
// O microfone e a reproducao automatica ficam permitidos so para a origem do app (WebPermissions.h), e toda outra
// permissao e negada.
//
// O aviso de ligacao recebida (NoticeWindow) tem o seu WebViewHost, com o mesmo ambiente (Options.environment: o
// mesmo perfil e a mesma pasta de dados) e a pagina aviso.html.
//
// O toque toca na interface (WebAudio): o ambiente tem --autoplay-policy=no-user-gesture-required (sem ele o primeiro
// toque, antes de um clique, pode sair mudo), e o WebView nunca e suspenso: nada de TrySuspend, e o IsVisible fica
// TRUE o tempo todo (tambem com a janela minimizada), para o WebAudio continuar tocando.
//
// Tudo na thread da janela (a do Create): os eventos do WebView2 chegam nela.
#include <windows.h>

#include <functional>
#include <string>

#include <wrl/client.h>

#include "WebView2.h"

namespace starsonic {

class WebViewHost {
public:
    // A origem do app (sem a barra do fim) e o host virtual.
    static const wchar_t kOrigin[];
    static const wchar_t kHost[];

    struct Callbacks {
        std::function<void(const std::string& json)> message;   // um comando da interface (o JSON, UTF-8)
        std::function<void(const std::string& line)> log;
        std::function<void(HRESULT error)> failed;              // o WebView2 nao abriu (sem o runtime, por exemplo)
        // O processo do navegador do WebView2 saiu (morto ou caido): este WebView morreu; o dono o refaz, fora do
        // evento (um WebViewHost novo, com um ambiente novo).
        std::function<void()> browserExited;
        // A pagina nao responde (o processo dela travou): o dono recarrega (Reload) depois de um tempo.
        std::function<void()> unresponsive;
    };

    struct Options {
        std::wstring userDataFolder;
        std::wstring uiFolder;   // a pasta com o index.html
        bool devTools = false;   // as ferramentas do desenvolvedor e o menu do botao direito (so no build de teste)
        // A pagina (do app) que abre; a MainWindow e o aviso poem a versao do app na URL (?v=<versao>), para o cache do
        // WebView2 nunca servir a interface de outra versao.
        std::wstring startPage = L"https://app.starsonic.local/index.html";
        // O ambiente de outro WebViewHost (o do aviso usa o da janela principal); vazio: cria um em userDataFolder.
        Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment;
    };

    WebViewHost(HWND parent, Callbacks callbacks);
    ~WebViewHost();

    WebViewHost(const WebViewHost&) = delete;
    WebViewHost& operator=(const WebViewHost&) = delete;

    // Comeca a criar o ambiente e o controlador (termina depois, nos eventos da janela). false: nem comecou.
    bool Create(const Options& options);
    // O tamanho da area do WebView (a area cliente inteira da janela).
    void Resize(const RECT& bounds);
    // Uma mensagem para a interface (JSON, UTF-8). Sem o WebView pronto, e descartada (a interface pede o estado
    // inteiro com o ready quando carrega).
    void Post(const std::string& json);
    void Focus();
    // Recarrega a pagina (a interface pede o estado de novo com o ready).
    void Reload();
    // Escreve no diagnostico os rotulos das saidas de som que o WebView2 ve (enumerateDevices, audiooutput).
    void LogAudioOutputs();
    // Fecha o WebView (antes de a janela sumir).
    void Close();

    bool Ready() const { return webview_ != nullptr; }
    // O ambiente (depois de o WebView abrir), para outro WebViewHost.
    Microsoft::WRL::ComPtr<ICoreWebView2Environment> Environment() const { return environment_; }

private:
    HRESULT OnEnvironment(HRESULT result, ICoreWebView2Environment* environment);
    HRESULT OnController(HRESULT result, ICoreWebView2Controller* controller);
    void Configure();
    void Log(const std::string& line) const;
    void Fail(HRESULT error, const char* what);

    HWND parent_;
    Callbacks callbacks_;
    Options options_;
    bool closed_ = false;
    Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webview_;
};

}  // namespace starsonic
