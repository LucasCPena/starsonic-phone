#include "AudioDeviceName.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include "Text.h"
#endif

namespace starsonic {

std::string DeviceNameToUtf8(const std::string& pjName) {
#ifdef _WIN32
    if (pjName.empty()) return pjName;
    const int size = MultiByteToWideChar(CP_ACP, 0, pjName.data(), static_cast<int>(pjName.size()), nullptr, 0);
    if (size <= 0) return pjName;
    std::wstring wide(static_cast<size_t>(size), L'\0');
    if (MultiByteToWideChar(CP_ACP, 0, pjName.data(), static_cast<int>(pjName.size()), &wide[0], size) <= 0) {
        return pjName;
    }
    return WideToUtf8(wide);
#else
    return pjName;
#endif
}

}  // namespace starsonic
