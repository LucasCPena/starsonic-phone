#include "BrowserRestarts.h"

namespace starsonic {

bool BrowserRestarts::OnBrowserExited() {
    restarting_ = true;
    createFailures_ = 0;
    return ++withoutReady_ <= kMaxWithoutReady;
}

bool BrowserRestarts::OnCreateFailed() {
    if (!restarting_ || createFailures_ >= kMaxCreateFailures) return false;
    ++createFailures_;
    return true;
}

void BrowserRestarts::OnReady() {
    restarting_ = false;
    withoutReady_ = 0;
    createFailures_ = 0;
}

}  // namespace starsonic
