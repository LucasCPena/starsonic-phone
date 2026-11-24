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

}  // namespace starsonic
