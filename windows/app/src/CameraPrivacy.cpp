#include "CameraPrivacy.h"

#ifdef _WIN32
#include <windows.h>

#include "Text.h"
#endif

namespace starsonic {

bool CameraConsentDenied(const std::string& deviceWide, const std::string& user, const std::string& userDesktopApps) {
    return deviceWide == "Deny" || user == "Deny" || userDesktopApps == "Deny";
}

#ifdef _WIN32

namespace {

const wchar_t kWebcam[] =
    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam";
const wchar_t kWebcamDesktopApps[] =
    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged";

// O texto do "Value" da chave: "" sem a chave, sem o valor, com outro tipo ou com um texto grande demais (os do
// Windows sao "Allow" e "Deny").
std::string ConsentValue(HKEY root, const wchar_t* path, REGSAM view) {
    HKEY key = nullptr;
    if (RegOpenKeyExW(root, path, 0, KEY_QUERY_VALUE | view, &key) != ERROR_SUCCESS) return std::string();
    wchar_t text[64] = {};
    DWORD bytes = sizeof(text);
    const LSTATUS status = RegGetValueW(key, nullptr, L"Value", RRF_RT_REG_SZ, nullptr, text, &bytes);
    RegCloseKey(key);
    return status == ERROR_SUCCESS ? WideToUtf8(text) : std::string();
}

}  // namespace

bool CameraBlockedByWindows() {
    return CameraConsentDenied(ConsentValue(HKEY_LOCAL_MACHINE, kWebcam, KEY_WOW64_64KEY),
                               ConsentValue(HKEY_CURRENT_USER, kWebcam, 0),
                               ConsentValue(HKEY_CURRENT_USER, kWebcamDesktopApps, 0));
}

#endif

}  // namespace starsonic
