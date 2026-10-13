#include "stdafx.h"
#include "ProfileStore.h"

#include <string>

#include "StarsonicIds.h"
#include "Text.h"

namespace {

std::string ReadProfileResource() {
    HMODULE module = GetModuleHandle(NULL);
    HRSRC info = FindResource(module, MAKEINTRESOURCE(IDR_STARSONIC_PROFILE), RT_RCDATA);
    if (!info) {
        return std::string();
    }
    HGLOBAL handle = LoadResource(module, info);
    const char* data = handle ? static_cast<const char*>(LockResource(handle)) : nullptr;
    if (!data) {
        return std::string();
    }
    return std::string(data, SizeofResource(module, info));
}

}  // namespace

const starsonic::Profile& LoadedProfile() {
    static starsonic::Profile profile;
    static bool loaded = false;
    if (!loaded) {
        loaded = true;
        const std::wstring text = starsonic::Utf8ToWide(starsonic::StripUtf8Bom(ReadProfileResource()));
        const starsonic::ParseResult result = starsonic::ParseProfile(text, &profile);
        if (!result.ok) {
            CString message;
            message.Format(L"Perfil inv\u00e1lido (linha %d): %s", result.errorLine, result.errorMessage.c_str());
            AfxMessageBox(message, MB_ICONERROR | MB_OK);
            ExitProcess(1);
        }
    }
    return profile;
}
