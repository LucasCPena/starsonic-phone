#include "WebPermissions.h"

namespace starsonic {

const char kAppOrigin[] = "https://app.starsonic.local";

bool IsAppUrl(const std::string& url) {
    const std::string origin = std::string(kAppOrigin) + "/";
    return url.compare(0, origin.size(), origin) == 0;
}

bool AllowWebPermission(WebPermission kind, const std::string& url) {
    return (kind == WebPermission::Microphone || kind == WebPermission::Autoplay) && IsAppUrl(url);
}

}  // namespace starsonic
