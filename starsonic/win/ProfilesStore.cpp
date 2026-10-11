#include "stdafx.h"
#include "ProfilesStore.h"

#include <string>

#include "StarsonicIds.h"
#include "Text.h"

namespace {

std::string ReadServersResource() {
    HMODULE module = GetModuleHandle(NULL);
    HRSRC info = FindResource(module, MAKEINTRESOURCE(IDR_STARSONIC_SERVERS), RT_RCDATA);
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

const starsonic::Profiles& LoadedProfiles() {
    static starsonic::Profiles profiles;
    static bool loaded = false;
    if (!loaded) {
        loaded = true;
        const std::wstring text = starsonic::Utf8ToWide(starsonic::StripUtf8Bom(ReadServersResource()));
        const starsonic::ParseResult result = starsonic::ParseProfiles(text, &profiles);
        if (!result.ok) {
            CString message;
            message.Format(L"Arquivo de servidores inv\u00e1lido (linha %d): %s", result.errorLine,
                           result.errorMessage.c_str());
            AfxMessageBox(message, MB_ICONERROR | MB_OK);
            ExitProcess(1);
        }
    }
    return profiles;
}
