#include "OpenH264Shim.h"

#include <windows.h>

#include <wels/codec_api.h>

#include <atomic>
#include <mutex>

namespace {

// As quatro funcoes do modulo, com os tipos das declaracoes do codec_api.h.
struct OpenH264Api {
    decltype(&WelsCreateSVCEncoder) createEncoder = nullptr;
    decltype(&WelsDestroySVCEncoder) destroyEncoder = nullptr;
    decltype(&WelsCreateDecoder) createDecoder = nullptr;
    decltype(&WelsDestroyDecoder) destroyDecoder = nullptr;
};

std::mutex g_loadMutex;   // um LoadOpenH264 por vez
OpenH264Api g_api;        // preenchida uma vez so, antes de g_loaded
// A tabela de g_api, depois que as quatro funcoes estao nela (e entao ela nunca mais muda); nulo sem o modulo. As
// funcoes da PJSIP leem sem trava: o store com release no LoadOpenH264 e o load com acquire nelas.
std::atomic<const OpenH264Api*> g_loaded{nullptr};

template <typename Function>
bool Resolve(HMODULE module, const char* name, Function* out, std::string* error) {
    const FARPROC address = GetProcAddress(module, name);
    if (!address) {
        if (error) *error = std::string("o modulo do OpenH264 nao tem a funcao ") + name;
        return false;
    }
    *out = reinterpret_cast<Function>(address);
    return true;
}

}  // namespace

namespace starsonic {

bool LoadOpenH264(const std::wstring& dllPath, std::string* error) {
    std::lock_guard<std::mutex> lock(g_loadMutex);
    if (g_loaded.load(std::memory_order_acquire)) return true;
    // So pelo caminho completo (o LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR recusa um caminho relativo), e as dependencias do
    // modulo so da pasta dele e do System32: nunca da pasta de trabalho nem do PATH.
    const HMODULE module =
        LoadLibraryExW(dllPath.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!module) {
        if (error) *error = "o Windows nao abriu o modulo do OpenH264 (erro " + std::to_string(GetLastError()) + ")";
        return false;
    }
    OpenH264Api api;
    if (!Resolve(module, "WelsCreateSVCEncoder", &api.createEncoder, error) ||
        !Resolve(module, "WelsDestroySVCEncoder", &api.destroyEncoder, error) ||
        !Resolve(module, "WelsCreateDecoder", &api.createDecoder, error) ||
        !Resolve(module, "WelsDestroyDecoder", &api.destroyDecoder, error)) {
        FreeLibrary(module);
        return false;
    }
    g_api = api;
    g_loaded.store(&g_api, std::memory_order_release);
    return true;
}

bool OpenH264Loaded() { return g_loaded.load(std::memory_order_acquire) != nullptr; }

}  // namespace starsonic

// As quatro funcoes que a PJSIP chama, como o codec_api.h 2.6.0 as declara (extern "C"). Sao as unicas definicoes no
// link do app, que ignora o openh264.lib que a PJSIP pede (/NODEFAULTLIB:openh264.lib).
extern "C" {

int WelsCreateSVCEncoder(ISVCEncoder** ppEncoder) {
    const OpenH264Api* api = g_loaded.load(std::memory_order_acquire);
    if (!api) {
        if (ppEncoder) *ppEncoder = nullptr;
        return 1;
    }
    return api->createEncoder(ppEncoder);
}

void WelsDestroySVCEncoder(ISVCEncoder* pEncoder) {
    const OpenH264Api* api = g_loaded.load(std::memory_order_acquire);
    if (api) api->destroyEncoder(pEncoder);
}

long WelsCreateDecoder(ISVCDecoder** ppDecoder) {
    const OpenH264Api* api = g_loaded.load(std::memory_order_acquire);
    if (!api) {
        if (ppDecoder) *ppDecoder = nullptr;
        return 1;
    }
    return api->createDecoder(ppDecoder);
}

void WelsDestroyDecoder(ISVCDecoder* pDecoder) {
    const OpenH264Api* api = g_loaded.load(std::memory_order_acquire);
    if (api) api->destroyDecoder(pDecoder);
}

}  // extern "C"
