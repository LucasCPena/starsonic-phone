#include "WebPermissions.h"

#include <cstring>

#include "ChatFiles.h"

namespace starsonic {

const char kAppOrigin[] = "https://app.starsonic.local";

bool IsAppUrl(const std::string& url) {
    const std::string origin = std::string(kAppOrigin) + "/";
    return url.compare(0, origin.size(), origin) == 0;
}

bool AllowWebPermission(WebPermission kind, const std::string& url) {
    return (kind == WebPermission::Microphone || kind == WebPermission::Autoplay) && IsAppUrl(url);
}

namespace {

// O alfabeto dos codigos de reuniao: sem i, l, o, u, 0 e 1 (os que se confundem), so minusculas.
constexpr char kCodeAlphabet[] = "abcdefghjkmnpqrstvwxyz23456789";
constexpr size_t kCodeLength = 10;

}  // namespace

bool IsMeetingUrl(const std::string& url) {
    const std::string prefix = std::string(kChatOrigin) + "/r/";
    if (url.size() != prefix.size() + kCodeLength || url.compare(0, prefix.size(), prefix) != 0) return false;
    for (size_t i = prefix.size(); i < url.size(); ++i) {
        // O '\0' e o terminador do alfabeto, nao um caractere dele.
        if (url[i] == '\0' || std::strchr(kCodeAlphabet, url[i]) == nullptr) return false;
    }
    return true;
}

bool AllowFrameNavigation(WebWindow window, const std::string& url) {
    return IsAppUrl(url) || (window == WebWindow::Main && IsMeetingUrl(url));
}

bool AllowFramePermission(WebWindow window, WebPermission kind, const std::string& frameUrl) {
    const bool wanted = kind == WebPermission::Camera || kind == WebPermission::Microphone ||
                        kind == WebPermission::Autoplay;
    return wanted && window == WebWindow::Main && IsMeetingUrl(frameUrl);
}

bool AllowFrameScreenCapture(WebWindow window, const std::string& frameUrl) {
    return window == WebWindow::Main && IsMeetingUrl(frameUrl);
}

namespace {

// O endereco sem o fragmento (o "#..."): a mesma pagina.
std::string WithoutFragment(const std::string& url) { return url.substr(0, url.find('#')); }

}  // namespace

void FrameAddress::Start(uint64_t navigation, const std::string& url) {
    Navigation& entry = navigations_[navigation];
    entry.url = url;
    entry.committed = false;
}

void FrameAddress::Commit(uint64_t navigation, bool errorPage) {
    const auto found = navigations_.find(navigation);
    if (found == navigations_.end()) {
        // Um documento que nao comecou por uma navegacao vista aqui: nao se sabe qual e.
        shown_.clear();
        return;
    }
    found->second.committed = true;
    shown_ = errorPage ? std::string() : found->second.url;
}

void FrameAddress::End(uint64_t navigation, bool success) {
    const auto found = navigations_.find(navigation);
    if (found == navigations_.end()) return;
    // Sem o ContentLoading (o WebView2 nem sempre o manda), a navegacao que deu certo tambem mostra o documento dela,
    // fora a que fica no mesmo documento (so o fragmento muda).
    if (success && !found->second.committed && WithoutFragment(found->second.url) != WithoutFragment(shown_)) {
        shown_ = found->second.url;
    }
    navigations_.erase(found);
}

const std::string& FrameAddress::Shown() const { return shown_; }

}  // namespace starsonic
