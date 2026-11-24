#include "WebViewHost.h"

#include <wrl.h>

#include <cstdio>
#include <memory>

#include "LogRedaction.h"
#include "Text.h"
#include "WebPermissions.h"
#include "WebView2EnvironmentOptions.h"
#include "nlohmann/json.hpp"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace starsonic {

const wchar_t WebViewHost::kOrigin[] = L"https://app.starsonic.local";
const wchar_t WebViewHost::kHost[] = L"app.starsonic.local";

namespace {

// O toque da interface toca antes de qualquer clique (Task 10).
const wchar_t kBrowserArguments[] = L"--autoplay-policy=no-user-gesture-required";
// O fundo antes de a interface pintar (o --navy-950 da interface): sem o clarao branco ao abrir.
const COREWEBVIEW2_COLOR kBackground = {255, 0x07, 0x0b, 0x18};

// Os rotulos das saidas de som (o Runtime.evaluate do DevTools espera a Promise do enumerateDevices).
const wchar_t kAudioOutputsScript[] =
    L"{\"expression\":\"navigator.mediaDevices.enumerateDevices().then(function(l){return l.filter(function(d)"
    L"{return d.kind==='audiooutput'}).map(function(d){return d.label})})\","
    L"\"awaitPromise\":true,\"returnByValue\":true}";

std::string Hex(HRESULT value) {
    char text[16];
    std::snprintf(text, sizeof(text), "0x%08lx", static_cast<unsigned long>(value));
    return text;
}

// Um texto do WebView2 (alocado com CoTaskMemAlloc) em UTF-8; libera o texto.
std::string TakeString(LPWSTR text) {
    if (!text) return std::string();
    std::string out = WideToUtf8(text);
    CoTaskMemFree(text);
    return out;
}

WebPermission PermissionOf(COREWEBVIEW2_PERMISSION_KIND kind) {
    if (kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE) return WebPermission::Microphone;
    if (kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA) return WebPermission::Camera;
    if (kind == COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY) return WebPermission::Autoplay;
    return WebPermission::Other;
}

std::string Short(const std::string& text) { return text.size() > 160 ? text.substr(0, 160) + "..." : text; }

// (0.5.0) A resposta vale so para este pedido: o perfil do WebView2 (o mesmo em todas as aberturas) nao a guarda, e o
// proximo pedido passa pela regra de novo. false: o WebView2 nao tem o ICoreWebView2PermissionRequestedEventArgs3.
bool KeepOutOfProfile(ICoreWebView2PermissionRequestedEventArgs* args) {
    ComPtr<ICoreWebView2PermissionRequestedEventArgs> event(args);
    ComPtr<ICoreWebView2PermissionRequestedEventArgs3> event3;
    if (FAILED(event.As(&event3))) return false;
    event3->put_SavesInProfile(FALSE);
    return true;
}

const char kNoProfileChoice[] = "WebView2 sem a resposta fora do perfil (ICoreWebView2PermissionRequestedEventArgs3)";

}  // namespace

WebViewHost::WebViewHost(HWND parent, Callbacks callbacks) : parent_(parent), callbacks_(std::move(callbacks)) {}

WebViewHost::~WebViewHost() { Close(); }

bool WebViewHost::Create(const Options& options) {
    options_ = options;
    if (options_.environment) {
        // O ambiente de outro WebViewHost (o mesmo perfil): direto para o controlador.
        OnEnvironment(S_OK, options_.environment.Get());
        return !closed_;
    }
    auto environmentOptions = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    environmentOptions->put_AdditionalBrowserArguments(kBrowserArguments);
    const HRESULT result = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, options_.userDataFolder.c_str(), environmentOptions.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT error, ICoreWebView2Environment* environment) -> HRESULT {
                return OnEnvironment(error, environment);
            })
            .Get());
    if (FAILED(result)) {
        Fail(result, "o ambiente do WebView2 nao abriu");
        return false;
    }
    return true;
}

HRESULT WebViewHost::OnEnvironment(HRESULT result, ICoreWebView2Environment* environment) {
    if (closed_) return S_OK;
    if (FAILED(result) || !environment) {
        Fail(FAILED(result) ? result : E_FAIL, "o ambiente do WebView2 nao abriu");
        return S_OK;
    }
    environment_ = environment;
    LPWSTR version = nullptr;
    if (SUCCEEDED(environment_->get_BrowserVersionString(&version))) Log("WebView2 " + TakeString(version));
    const HRESULT created = environment_->CreateCoreWebView2Controller(
        parent_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                     [this](HRESULT error, ICoreWebView2Controller* controller) -> HRESULT {
                         return OnController(error, controller);
                     })
                     .Get());
    if (FAILED(created)) Fail(created, "o WebView2 nao abriu");
    return S_OK;
}

HRESULT WebViewHost::OnController(HRESULT result, ICoreWebView2Controller* controller) {
    if (closed_) {
        if (controller) controller->Close();
        return S_OK;
    }
    if (FAILED(result) || !controller) {
        Fail(FAILED(result) ? result : E_FAIL, "o WebView2 nao abriu");
        return S_OK;
    }
    controller_ = controller;
    ComPtr<ICoreWebView2> webview;
    if (FAILED(controller_->get_CoreWebView2(&webview)) || !webview) {
        Fail(E_FAIL, "o WebView2 nao abriu");
        return S_OK;
    }
    webview_ = webview;
    Configure();
    return S_OK;
}

void WebViewHost::Configure() {
    // O tamanho e o fundo.
    RECT bounds = {};
    GetClientRect(parent_, &bounds);
    controller_->put_Bounds(bounds);
    controller_->put_IsVisible(TRUE);   // e fica TRUE (ver o WebViewHost.h)
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(controller_.As(&controller2))) controller2->put_DefaultBackgroundColor(kBackground);

    // As configuracoes: um app, nao um navegador.
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(webview_->get_Settings(&settings))) {
        settings->put_IsScriptEnabled(TRUE);
        settings->put_IsWebMessageEnabled(TRUE);
        settings->put_AreDefaultScriptDialogsEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings->put_AreDevToolsEnabled(options_.devTools ? TRUE : FALSE);
        settings->put_AreDefaultContextMenusEnabled(options_.devTools ? TRUE : FALSE);
        // As teclas do navegador: so no build de teste, e nunca no aviso.
        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3))) {
            settings3->put_AreBrowserAcceleratorKeysEnabled(options_.devTools && options_.pageGetsCtrlP ? TRUE : FALSE);
        }
        // A senha da tela Entrar nunca fica guardada no WebView (so no contas.json, cifrada).
        ComPtr<ICoreWebView2Settings4> settings4;
        if (SUCCEEDED(settings.As(&settings4))) {
            settings4->put_IsPasswordAutosaveEnabled(FALSE);
            settings4->put_IsGeneralAutofillEnabled(FALSE);
        }
        ComPtr<ICoreWebView2Settings5> settings5;
        if (SUCCEEDED(settings.As(&settings5))) settings5->put_IsPinchZoomEnabled(FALSE);
        ComPtr<ICoreWebView2Settings6> settings6;
        if (SUCCEEDED(settings.As(&settings6))) settings6->put_IsSwipeNavigationEnabled(FALSE);
        // A barra de titulo da interface (app-region: drag) arrasta a janela (Task 9).
        ComPtr<ICoreWebView2Settings9> settings9;
        if (SUCCEEDED(settings.As(&settings9))) {
            settings9->put_IsNonClientRegionSupportEnabled(TRUE);
        } else {
            Log("WebView2 sem a regiao de arrastar (ICoreWebView2Settings9)");
        }
    }

    // A interface: a pasta ui\ no host virtual.
    ComPtr<ICoreWebView2_3> webview3;
    if (FAILED(webview_.As(&webview3)) ||
        FAILED(webview3->SetVirtualHostNameToFolderMapping(kHost, options_.uiFolder.c_str(),
                                                           COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
        Fail(E_NOINTERFACE, "o WebView2 nao serve a pasta da interface");
        return;
    }

    // O microfone (os rotulos dos dispositivos) e a reproducao automatica (o toque) so para a origem do app; o resto,
    // negado (WebPermissions.h). So essas duas ficam guardadas no perfil (o SetPermissionState); uma recusa vale so
    // para o pedido.
    ComPtr<ICoreWebView2_13> webview13;
    ComPtr<ICoreWebView2Profile> profile;
    ComPtr<ICoreWebView2Profile4> profile4;
    if (SUCCEEDED(webview_.As(&webview13)) && SUCCEEDED(webview13->get_Profile(&profile)) && profile &&
        SUCCEEDED(profile.As(&profile4))) {
        profile4->SetPermissionState(COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, kOrigin, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                                     Callback<ICoreWebView2SetPermissionStateCompletedHandler>([this](HRESULT error) -> HRESULT {
                                         if (FAILED(error)) Log("permissao do microfone nao gravada: " + Hex(error));
                                         return S_OK;
                                     }).Get());
        profile4->SetPermissionState(COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY, kOrigin, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                                     Callback<ICoreWebView2SetPermissionStateCompletedHandler>([this](HRESULT error) -> HRESULT {
                                         if (FAILED(error)) Log("permissao do toque nao gravada: " + Hex(error));
                                         return S_OK;
                                     }).Get());
    }
    EventRegistrationToken token = {};
    webview_->add_PermissionRequested(
        Callback<ICoreWebView2PermissionRequestedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                args->get_Uri(&uri);
                args->get_PermissionKind(&kind);
                const std::string url = TakeString(uri);
                const bool allowed = AllowWebPermission(PermissionOf(kind), url);
                if (!allowed && !KeepOutOfProfile(args)) Log(kNoProfileChoice);
                args->put_State(allowed ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
                if (!allowed) Log("permissao negada: " + std::to_string(static_cast<int>(kind)) + " " + RedactUrl(url));
                return S_OK;
            })
            .Get(),
        &token);

    // Nenhuma navegacao fora do app, nem janela nova. O diagnostico leva so o esquema (e o host no http, https, ws e
    // wss: RedactUrl), nunca o caminho: um arquivo solto na janela navega para o file:// dele, com o nome do arquivo.
    webview_->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                const std::string url = TakeString(uri);
                if (!IsAppUrl(url)) {
                    args->put_Cancel(TRUE);
                    Log("navegacao bloqueada: " + RedactUrl(url));
                }
                return S_OK;
            })
            .Get(),
        &token);
    // (0.5.0) Um quadro (iframe): dentro do app ou, na janela principal, uma reuniao do chat (AllowFrameNavigation). O
    // cancelamento e pedido aqui e de novo no NavigationStarting do proprio quadro (FrameCreated, abaixo), que roda
    // por ultimo: no WebView2 131, o pedido so daqui nao parou o quadro. As linhas sao so daqui, uma por navegacao.
    webview_->add_FrameNavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                const std::string url = TakeString(uri);
                if (!AllowFrameNavigation(options_.window, url)) {
                    const HRESULT cancelled = args->put_Cancel(TRUE);
                    if (FAILED(cancelled)) Log("navegacao nao cancelada: " + Hex(cancelled));
                    Log("navegacao bloqueada: " + RedactUrl(url));
                } else if (!IsAppUrl(url)) {
                    Log("navegacao do quadro permitida: " + RedactUrl(url));
                }
                return S_OK;
            })
            .Get(),
        &token);
    webview_->add_FrameNavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                BOOL success = FALSE;
                args->get_IsSuccess(&success);
                if (!success) {
                    COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                    args->get_WebErrorStatus(&status);
                    Log("o quadro nao carregou (erro " + std::to_string(static_cast<int>(status)) + ")");
                }
                return S_OK;
            })
            .Get(),
        &token);

    // (0.5.0) Os quadros (WebPermissions.h): cada um sabe o endereco do documento que mostra (FrameAddress, pelas
    // navegacoes dele) e responde com ele aos seus pedidos, antes do evento da janela (Handled). Sem os eventos do
    // quadro, o quadro nao ganha nada: o pedido chega a janela, que so deixa o da pagina do app.
    ComPtr<ICoreWebView2_4> webview4;
    if (SUCCEEDED(webview_.As(&webview4))) {
        webview4->add_FrameCreated(
            Callback<ICoreWebView2FrameCreatedEventHandler>(
                [this](ICoreWebView2*, ICoreWebView2FrameCreatedEventArgs* args) -> HRESULT {
                    ComPtr<ICoreWebView2Frame> frame;
                    if (FAILED(args->get_Frame(&frame)) || !frame) return S_OK;
                    // O endereco do documento que o quadro mostra, dividido entre os tratadores dele ("" ate o
                    // primeiro documento).
                    auto address = std::make_shared<FrameAddress>();
                    // Um documento que a regra nao deixa e que o quadro passou a mostrar: o bloqueio nao valeu. O
                    // quadro fica sem nada (o Shown nao e uma reuniao); so a linha.
                    auto outsideRule = [this, address]() {
                        const std::string& shown = address->Shown();
                        if (!shown.empty() && !AllowFrameNavigation(options_.window, shown)) {
                            Log("quadro fora da regra: " + RedactUrl(shown));
                        }
                    };
                    EventRegistrationToken frameToken = {};
                    ComPtr<ICoreWebView2Frame2> frame2;
                    if (SUCCEEDED(frame.As(&frame2))) {
                        frame2->add_NavigationStarting(
                            Callback<ICoreWebView2FrameNavigationStartingEventHandler>(
                                [this, address](ICoreWebView2Frame*, ICoreWebView2NavigationStartingEventArgs* event)
                                    -> HRESULT {
                                    LPWSTR uri = nullptr;
                                    event->get_Uri(&uri);
                                    const std::string url = TakeString(uri);
                                    UINT64 navigation = 0;
                                    if (SUCCEEDED(event->get_NavigationId(&navigation))) {
                                        address->Start(navigation, url);
                                    }
                                    // O ultimo a mexer no Cancel decide: este roda depois do FrameNavigationStarting
                                    // da janela (que escreve a linha).
                                    if (!AllowFrameNavigation(options_.window, url)) {
                                        const HRESULT cancelled = event->put_Cancel(TRUE);
                                        if (FAILED(cancelled)) Log("navegacao nao cancelada: " + Hex(cancelled));
                                    }
                                    return S_OK;
                                })
                                .Get(),
                            &frameToken);
                        frame2->add_ContentLoading(
                            Callback<ICoreWebView2FrameContentLoadingEventHandler>(
                                [address, outsideRule](ICoreWebView2Frame*, ICoreWebView2ContentLoadingEventArgs* event)
                                    -> HRESULT {
                                    UINT64 navigation = 0;
                                    BOOL errorPage = TRUE;
                                    if (FAILED(event->get_NavigationId(&navigation)) ||
                                        FAILED(event->get_IsErrorPage(&errorPage))) {
                                        // Sem saber qual documento e: o quadro nao mostra nada conhecido.
                                        address->Commit(navigation, true);
                                        return S_OK;
                                    }
                                    address->Commit(navigation, errorPage != FALSE);
                                    outsideRule();
                                    return S_OK;
                                })
                                .Get(),
                            &frameToken);
                        frame2->add_NavigationCompleted(
                            Callback<ICoreWebView2FrameNavigationCompletedEventHandler>(
                                [address, outsideRule](ICoreWebView2Frame*,
                                                       ICoreWebView2NavigationCompletedEventArgs* event) -> HRESULT {
                                    UINT64 navigation = 0;
                                    BOOL success = FALSE;
                                    if (FAILED(event->get_NavigationId(&navigation))) return S_OK;
                                    event->get_IsSuccess(&success);
                                    const std::string before = address->Shown();
                                    address->End(navigation, success != FALSE);
                                    if (address->Shown() != before) outsideRule();
                                    return S_OK;
                                })
                                .Get(),
                            &frameToken);
                    } else {
                        Log("WebView2 sem a navegacao do quadro (ICoreWebView2Frame2)");
                    }
                    ComPtr<ICoreWebView2Frame3> frame3;
                    if (SUCCEEDED(frame.As(&frame3))) {
                        frame3->add_PermissionRequested(
                            Callback<ICoreWebView2FramePermissionRequestedEventHandler>(
                                [this, address](ICoreWebView2Frame*, ICoreWebView2PermissionRequestedEventArgs2* event)
                                    -> HRESULT {
                                    LPWSTR uri = nullptr;
                                    COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                                    event->get_Uri(&uri);
                                    event->get_PermissionKind(&kind);
                                    const std::string url = TakeString(uri);
                                    bool allowed =
                                        AllowFramePermission(options_.window, PermissionOf(kind), address->Shown());
                                    // Uma resposta que ficaria no perfil, nao: fica no lado fechado.
                                    if (!KeepOutOfProfile(event)) {
                                        Log(kNoProfileChoice);
                                        allowed = false;
                                    }
                                    event->put_State(allowed ? COREWEBVIEW2_PERMISSION_STATE_ALLOW
                                                             : COREWEBVIEW2_PERMISSION_STATE_DENY);
                                    event->put_Handled(TRUE);   // o evento da janela nao vem
                                    Log(std::string(allowed ? "permissao permitida (quadro): "
                                                            : "permissao negada (quadro): ") +
                                        std::to_string(static_cast<int>(kind)) + " " + RedactUrl(url));
                                    return S_OK;
                                })
                                .Get(),
                            &frameToken);
                    } else {
                        Log("WebView2 sem as permissoes do quadro (ICoreWebView2Frame3)");
                    }
                    ComPtr<ICoreWebView2Frame6> frame6;
                    if (SUCCEEDED(frame.As(&frame6))) {
                        frame6->add_ScreenCaptureStarting(
                            Callback<ICoreWebView2FrameScreenCaptureStartingEventHandler>(
                                [this, address](ICoreWebView2Frame*, ICoreWebView2ScreenCaptureStartingEventArgs* event)
                                    -> HRESULT {
                                    const bool allowed = AllowFrameScreenCapture(options_.window, address->Shown());
                                    event->put_Cancel(allowed ? FALSE : TRUE);
                                    event->put_Handled(TRUE);   // o evento da janela nao vem
                                    Log(allowed ? "captura de tela permitida (quadro)"
                                                : "captura de tela cancelada (quadro)");
                                    return S_OK;
                                })
                                .Get(),
                            &frameToken);
                    } else {
                        Log("WebView2 sem a captura de tela do quadro (ICoreWebView2Frame6)");
                    }
                    // O quadro fica vivo (com os tratadores) ate o Destroyed dele. O tratador guarda o ponteiro cru:
                    // um ComPtr nele seria um ciclo (o quadro segura o tratador).
                    ICoreWebView2Frame* const alive = frame.Get();
                    frame->add_Destroyed(
                        Callback<ICoreWebView2FrameDestroyedEventHandler>(
                            [this, alive](ICoreWebView2Frame*, IUnknown*) -> HRESULT {
                                for (auto it = frames_.begin(); it != frames_.end(); ++it) {
                                    if (it->Get() == alive) {
                                        frames_.erase(it);
                                        break;
                                    }
                                }
                                return S_OK;
                            })
                            .Get(),
                        &frameToken);
                    frames_.push_back(frame);
                    return S_OK;
                })
                .Get(),
            &token);
    } else {
        Log("WebView2 sem os quadros (ICoreWebView2_4)");
    }
    // (0.5.0) Uma captura de tela que chega a janela nao e de um quadro de reuniao (esse responde antes, acima):
    // cancela.
    ComPtr<ICoreWebView2_27> webview27;
    if (SUCCEEDED(webview_.As(&webview27))) {
        webview27->add_ScreenCaptureStarting(
            Callback<ICoreWebView2ScreenCaptureStartingEventHandler>(
                [this](ICoreWebView2*, ICoreWebView2ScreenCaptureStartingEventArgs* args) -> HRESULT {
                    args->put_Cancel(TRUE);
                    Log("captura de tela cancelada");
                    return S_OK;
                })
                .Get(),
            &token);
    } else {
        Log("WebView2 sem o aviso da captura de tela (ICoreWebView2_27)");
    }
    webview_->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                args->put_Handled(TRUE);
                Log("janela nova bloqueada: " + RedactUrl(TakeString(uri)));
                return S_OK;
            })
            .Get(),
        &token);

    // O Ctrl + P (com ou sem Shift) nunca imprime (spec 6.1 da rc.3), tambem com as teclas do navegador ligadas (o build
    // de teste): o navegador nao trata a tecla. A pagina principal continua recebendo (a area do administrador); a do
    // aviso, nao.
    controller_->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [this](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
                COREWEBVIEW2_KEY_EVENT_KIND kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP;
                UINT key = 0;
                if (FAILED(args->get_KeyEventKind(&kind)) || FAILED(args->get_VirtualKey(&key))) return S_OK;
                const bool down =
                    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
                if (!down || key != 'P' || GetKeyState(VK_CONTROL) >= 0) return S_OK;
                ComPtr<ICoreWebView2AcceleratorKeyPressedEventArgs> event(args);
                ComPtr<ICoreWebView2AcceleratorKeyPressedEventArgs2> event2;
                if (SUCCEEDED(event.As(&event2))) event2->put_IsBrowserAcceleratorKeyEnabled(FALSE);
                if (!options_.pageGetsCtrlP) args->put_Handled(TRUE);
                return S_OK;
            })
            .Get(),
        &token);

    // A ponte: so mensagens da pagina do app.
    webview_->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                LPWSTR source = nullptr;
                args->get_Source(&source);
                const std::string from = TakeString(source);
                if (!IsAppUrl(from)) {
                    Log("mensagem ignorada de " + Short(from));
                    return S_OK;
                }
                LPWSTR json = nullptr;
                if (SUCCEEDED(args->get_WebMessageAsJson(&json)) && json) {
                    const std::string message = TakeString(json);
                    if (callbacks_.message) callbacks_.message(message);
                }
                return S_OK;
            })
            .Get(),
        &token);

    webview_->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                BOOL success = FALSE;
                args->get_IsSuccess(&success);
                if (!success) {
                    COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                    args->get_WebErrorStatus(&status);
                    Log("a interface nao carregou (erro " + std::to_string(static_cast<int>(status)) + ")");
                }
                return S_OK;
            })
            .Get(),
        &token);

    webview_->add_ProcessFailed(
        Callback<ICoreWebView2ProcessFailedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
                COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
                args->get_ProcessFailedKind(&kind);
                Log("o WebView2 caiu (tipo " + std::to_string(static_cast<int>(kind)) + ")");
                if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) {
                    // A pagina caiu e o WebView continua: recarrega (a interface pede o estado de novo com o ready).
                    if (webview_) webview_->Reload();
                } else if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
                    if (callbacks_.unresponsive) callbacks_.unresponsive();
                } else if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) {
                    // O navegador saiu: os WebViews dele morreram (o dono refaz, fora deste evento).
                    if (callbacks_.browserExited) callbacks_.browserExited();
                }
                return S_OK;
            })
            .Get(),
        &token);

    const HRESULT navigated = webview_->Navigate(options_.startPage.c_str());
    if (FAILED(navigated)) Log("a interface nao abriu: " + Hex(navigated));
}

void WebViewHost::Resize(const RECT& bounds) {
    if (controller_) controller_->put_Bounds(bounds);
}

void WebViewHost::Post(const std::string& json) {
    if (!webview_) return;
    const HRESULT result = webview_->PostWebMessageAsJson(Utf8ToWide(json).c_str());
    if (FAILED(result)) Log("mensagem para a interface nao saiu: " + Hex(result));
}

void WebViewHost::Reload() {
    if (webview_) webview_->Reload();
}

void WebViewHost::Focus() {
    if (controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

void WebViewHost::LogAudioOutputs() {
    if (!webview_) return;
    webview_->CallDevToolsProtocolMethod(
        L"Runtime.evaluate", kAudioOutputsScript,
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this](HRESULT error, LPCWSTR resultJson) -> HRESULT {
                if (FAILED(error) || !resultJson) {
                    Log("webview saidas de som: nao foi possivel listar (" + Hex(error) + ")");
                    return S_OK;
                }
                const std::string raw = WideToUtf8(resultJson);
                std::string names;
                bool listed = false;
                try {
                    const nlohmann::json parsed = nlohmann::json::parse(raw);
                    const nlohmann::json& value = parsed.at("result").at("value");
                    if (value.is_array()) {
                        listed = true;
                        for (const nlohmann::json& label : value) {
                            if (!names.empty()) names += " | ";
                            names += label.is_string() ? "\"" + label.get<std::string>() + "\"" : label.dump();
                        }
                    }
                } catch (const std::exception&) {
                }
                if (!listed) {
                    Log("webview saidas de som: " + Short(raw));
                } else {
                    Log("webview saidas de som: " + (names.empty() ? std::string("(nenhuma)") : names));
                }
                return S_OK;
            })
            .Get());
}

ComPtr<ICoreWebView2SharedBuffer> WebViewHost::CreateSharedBuffer(size_t bytes) {
    ComPtr<ICoreWebView2SharedBuffer> buffer;
    if (!environment_) return buffer;
    ComPtr<ICoreWebView2Environment12> environment12;
    if (FAILED(environment_.As(&environment12))) {
        Log("WebView2 sem a memoria dividida (ICoreWebView2Environment12)");
        return buffer;
    }
    const HRESULT created = environment12->CreateSharedBuffer(static_cast<UINT64>(bytes), &buffer);
    if (FAILED(created) || !buffer) {
        Log("a memoria do video nao foi criada: " + Hex(FAILED(created) ? created : E_FAIL));
        buffer.Reset();
    }
    return buffer;
}

bool WebViewHost::PostSharedBuffer(ICoreWebView2SharedBuffer* buffer, const std::string& json) {
    if (!webview_ || !buffer) return false;
    ComPtr<ICoreWebView2_17> webview17;
    if (FAILED(webview_.As(&webview17))) {
        Log("WebView2 sem a entrega da memoria dividida (ICoreWebView2_17)");
        return false;
    }
    // So para leitura: a pagina nunca escreve na memoria do video (o cabecalho e os quadros sao do executavel).
    const HRESULT posted = webview17->PostSharedBufferToScript(buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
                                                               Utf8ToWide(json).c_str());
    if (FAILED(posted)) {
        Log("a memoria do video nao foi entregue: " + Hex(posted));
        return false;
    }
    return true;
}

void WebViewHost::Close() {
    if (closed_) return;
    closed_ = true;
    if (controller_) controller_->Close();
    frames_.clear();
    webview_.Reset();
    controller_.Reset();
    environment_.Reset();
}

void WebViewHost::Log(const std::string& line) const {
    if (callbacks_.log) callbacks_.log(line);
}

void WebViewHost::Fail(HRESULT error, const char* what) {
    Log(std::string(what) + ": " + Hex(error));
    if (callbacks_.failed) callbacks_.failed(error);
}

}  // namespace starsonic
