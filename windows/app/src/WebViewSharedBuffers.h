#pragma once
// As memorias do video no WebView2 (docs/ponte-windows.md, "A memoria do video"): o SharedMemoryPages do VideoSink
// sobre os dois WebViewHost, o da janela principal e o do aviso. Cada memoria e criada no ambiente da janela principal
// (o aviso usa o mesmo ambiente) e entregue so a pagina da vista, so para leitura, com o JSON da ponte
// {"v":1,"type":"videoBuffer","vista":"<vista>","bytes":<n>}: a do porteiro vai ao aviso, e a do remoto e a do local, a
// janela principal. Uma pagina que ainda nao existe (o aviso antes de abrir, o navegador sendo refeito) nao recebe nada
// agora: ela recebe a memoria no ready dela (VideoSink::PageReady).
//
// So do Windows. Tudo na thread da janela (o WebView2 so aceita essa thread).
#include <windows.h>

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>

#include <wrl/client.h>

#include "VideoSink.h"
#include "WebView2.h"
#include "WebViewHost.h"

namespace starsonic {

class WebViewSharedBuffers : public SharedMemoryPages {
public:
    // O WebViewHost de agora da janela principal e o do aviso (nullptr: a pagina ainda nao existe). Os dois mudam
    // quando o navegador e refeito.
    WebViewSharedBuffers(std::function<WebViewHost*()> mainPage, std::function<WebViewHost*()> noticePage);
    ~WebViewSharedBuffers() override;   // ReleaseAll()

    WebViewSharedBuffers(const WebViewSharedBuffers&) = delete;
    WebViewSharedBuffers& operator=(const WebViewSharedBuffers&) = delete;

    // Uma memoria nova para a vista (o VideoSink so pede para uma vista sem memoria). nullptr: sem o ambiente, ou o
    // WebView2 nao deu.
    uint8_t* Create(ViewName view, size_t bytes) override;
    // A memoria da vista a pagina dela; sem memoria, ou sem a pagina, nada.
    void Post(ViewName view) override;
    // O Close de cada memoria (o lado do app: o ponteiro do Create deixa de valer).
    void ReleaseAll() override;

private:
    struct Memory {
        Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> buffer;
        size_t bytes = 0;
    };

    std::function<WebViewHost*()> mainPage_;
    std::function<WebViewHost*()> noticePage_;
    std::map<ViewName, Memory> memories_;
};

}  // namespace starsonic
