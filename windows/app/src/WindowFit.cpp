#include "WindowFit.h"

#include <algorithm>

namespace starsonic {

int ScaleToDpi(int value, unsigned dpi) {
    const long long product = static_cast<long long>(value) * static_cast<long long>(dpi);
    const long long rounded = product >= 0 ? (product + 48) / 96 : -((-product + 48) / 96);
    return static_cast<int>(rounded);
}

FitBox FitWindow(const FitArea& work, unsigned dpi, const std::optional<WindowPosition>& position) {
    if (dpi == 0) dpi = 96;
    const int workWidth = std::max(0, work.right - work.left);
    const int workHeight = std::max(0, work.bottom - work.top);
    FitBox box;
    box.width = ScaleToDpi(kWindowWidth, dpi);
    box.height = ScaleToDpi(kWindowHeight, dpi);
    if (workHeight > 0) box.height = std::min(box.height, workHeight);
    if (position) {
        box.x = position->x;
        box.y = position->y;
    } else {
        box.x = work.left + (workWidth - box.width) / 2;
        box.y = work.top + (workHeight - box.height) / 2;
    }
    box.x = std::max(work.left, std::min(box.x, work.right - box.width));
    box.y = std::max(work.top, std::min(box.y, work.bottom - box.height));
    return box;
}

}  // namespace starsonic
