#include "WebViewHost.h"

#include <wrl.h>

#include <cstdio>

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
    if (kind == COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY) return WebPermission::Autoplay;
    return WebPermission::Other;
}

std::string Short(const std::string& text) { return text.size() > 160 ? text.substr(0, 160) + "..." : text; }

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
        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(options_.devTools ? TRUE : FALSE);
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
    // negado (WebPermissions.h).
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
                args->put_State(allowed ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
                if (!allowed) Log("permissao negada: " + std::to_string(static_cast<int>(kind)) + " " + Short(url));
                return S_OK;
            })
            .Get(),
        &token);

    // Nenhuma navegacao fora do app, nem janela nova.
    auto blockOutside = [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
        LPWSTR uri = nullptr;
        args->get_Uri(&uri);
        const std::string url = TakeString(uri);
        if (!IsAppUrl(url)) {
            args->put_Cancel(TRUE);
            Log("navegacao bloqueada: " + Short(url));
        }
        return S_OK;
    };
    webview_->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(blockOutside).Get(), &token);
    webview_->add_FrameNavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(blockOutside).Get(),
                                          &token);
    webview_->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                LPWSTR uri = nullptr;
                args->get_Uri(&uri);
                args->put_Handled(TRUE);
                Log("janela nova bloqueada: " + Short(TakeString(uri)));
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

void WebViewHost::Close() {
    if (closed_) return;
    closed_ = true;
    if (controller_) controller_->Close();
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
