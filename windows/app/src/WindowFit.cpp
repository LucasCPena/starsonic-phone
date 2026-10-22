#include "WindowFit.h"

#include <algorithm>

namespace starsonic {

namespace {

// value * numerator / denominator, arredondado como o MulDiv do Windows.
int MulDivRound(int value, int numerator, int denominator) {
    const long long product = static_cast<long long>(value) * static_cast<long long>(numerator);
    const long long half = denominator / 2;
    const long long rounded = product >= 0 ? (product + half) / denominator : -((-product + half) / denominator);
    return static_cast<int>(rounded);
}

}  // namespace

int ScaleToDpi(int value, unsigned dpi) { return MulDivRound(value, static_cast<int>(dpi), 96); }

int ScaleFromDpi(int value, unsigned dpi) {
    if (dpi == 0) dpi = 96;
    return MulDivRound(value, 96, static_cast<int>(dpi));
}

FitBox FitWindow(const FitArea& work, unsigned dpi, const std::optional<WindowPosition>& position,
                 const std::optional<WindowSize>& size) {
    if (dpi == 0) dpi = 96;
    const int workWidth = std::max(0, work.right - work.left);
    const int workHeight = std::max(0, work.bottom - work.top);
    const WindowSize wanted = size.value_or(WindowSize{});
    const int minWidth = ScaleToDpi(kMinWindowWidth, dpi);
    const int minHeight = ScaleToDpi(kMinWindowHeight, dpi);
    FitBox box;
    box.width = std::max(minWidth, ScaleToDpi(wanted.width, dpi));
    box.height = std::max(minHeight, ScaleToDpi(wanted.height, dpi));
    // Cortada na area de trabalho, mas nunca abaixo do minimo.
    if (workWidth > 0) box.width = std::max(minWidth, std::min(box.width, workWidth));
    if (workHeight > 0) box.height = std::max(minHeight, std::min(box.height, workHeight));
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
