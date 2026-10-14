#include "CallMessages.h"

namespace starsonic {

std::wstring CallEndMessage(int sipCode) {
    switch (sipCode) {
        case 486:
        case 600:
            return L"Ocupado";
        case 404:
        case 484:
        case 604:
            return L"N\u00famero n\u00e3o encontrado";
        case 408:
        case 480:
            return L"N\u00e3o atendeu";
        case 487:   // quem ligou desistiu: nada a avisar
            return L"";
        default:
            break;
    }
    if (sipCode >= 400 && sipCode <= 699) {
        return L"N\u00e3o foi poss\u00edvel completar a liga\u00e7\u00e3o (c\u00f3digo " + std::to_wstring(sipCode) + L").";
    }
    return L"";
}

std::wstring NormalizeDialString(const std::wstring& raw) {
    std::wstring number;
    number.reserve(raw.size());
    for (const wchar_t ch : raw) {
        switch (ch) {
            case L' ':
            case L'\t':
            case L'-':
            case L'.':
            case L'(':
            case L')':
                break;
            case L'+':
                if (number.empty()) number.push_back(ch);
                break;
            default:
                number.push_back(ch);
                break;
        }
    }
    return number;
}

}  // namespace starsonic
