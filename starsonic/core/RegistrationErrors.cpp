#include "RegistrationErrors.h"

namespace starsonic {

std::wstring RegistrationMessage(int sipCode, bool tlsFailure) {
    if (tlsFailure) return L"N\u00e3o foi poss\u00edvel estabelecer uma conex\u00e3o segura com o servidor.";
    if (sipCode >= 100 && sipCode <= 299) return L"";
    if (sipCode == 401 || sipCode == 403 || sipCode == 407) return L"Ramal ou senha incorretos.";
    if (sipCode == 404) return L"Ramal n\u00e3o encontrado neste servidor.";
    if (sipCode <= 0 || sipCode == 408 || (sipCode >= 500 && sipCode <= 599)) {
        return L"N\u00e3o foi poss\u00edvel falar com o servidor. Verifique sua internet.";
    }
    return L"N\u00e3o foi poss\u00edvel entrar (c\u00f3digo " + std::to_wstring(sipCode) + L"). Fale com o suporte da Starsonic.";
}

}  // namespace starsonic
