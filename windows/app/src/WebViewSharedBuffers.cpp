#include "WebViewSharedBuffers.h"

#include <string>
#include <utility>

namespace starsonic {

namespace {

// O additionalDataAsJson da entrega (docs/ponte-windows.md, "A memoria do video").
std::string BufferJson(ViewName view, size_t bytes) {
    return std::string("{\"v\":1,\"type\":\"videoBuffer\",\"vista\":\"") + ViewKey(view) + "\",\"bytes\":" +
           std::to_string(bytes) + "}";
}

}  // namespace

WebViewSharedBuffers::WebViewSharedBuffers(std::function<WebViewHost*()> mainPage,
                                           std::function<WebViewHost*()> noticePage)
    : mainPage_(std::move(mainPage)), noticePage_(std::move(noticePage)) {}

WebViewSharedBuffers::~WebViewSharedBuffers() { ReleaseAll(); }

uint8_t* WebViewSharedBuffers::Create(ViewName view, size_t bytes) {
    // As memorias sao do ambiente da janela principal: o aviso tem o mesmo, e a do porteiro vale nele tambem.
    WebViewHost* host = mainPage_ ? mainPage_() : nullptr;
    if (!host || bytes == 0) return nullptr;
    Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> buffer = host->CreateSharedBuffer(bytes);
    if (!buffer) return nullptr;
    BYTE* data = nullptr;
    UINT64 size = 0;
    if (FAILED(buffer->get_Buffer(&data)) || !data || FAILED(buffer->get_Size(&size)) || size < bytes) {
        buffer->Close();
        return nullptr;
    }
    Memory& memory = memories_[view];
    memory.buffer = buffer;
    memory.bytes = bytes;
    return data;
}

void WebViewSharedBuffers::Post(ViewName view) {
    const auto found = memories_.find(view);
    if (found == memories_.end() || !found->second.buffer) return;
    const std::function<WebViewHost*()>& page = view == ViewName::Porteiro ? noticePage_ : mainPage_;
    WebViewHost* host = page ? page() : nullptr;
    if (!host) return;
    host->PostSharedBuffer(found->second.buffer.Get(), BufferJson(view, found->second.bytes));
}

void WebViewSharedBuffers::ReleaseAll() {
    for (auto& entry : memories_) {
        if (entry.second.buffer) entry.second.buffer->Close();
    }
    memories_.clear();
}

}  // namespace starsonic
